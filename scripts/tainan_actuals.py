#!/usr/bin/env python3
# 台南重播：TDX 即時動態的逐站紀錄 → 每班車逐站的到站／離站秒數（docs/tainan-memory-2026-10-16-design.md 第 3 節）。
#
#   python3 -I scripts/tainan_actuals.py --date 2026-10-16              範圍內各班的實際時刻，寫到設定的 actuals.out（.cache 內）
#   python3 -I scripts/tainan_actuals.py --backtest [--date 2026-09-12]  以當天秒級歷史當真值回測重建誤差（不寫檔）
#
# 參數與輸入路徑都由 scripts/tainan_memory_config.mjs 提供（用 node 印出 JSON）。
# 時間一律是「相對目標日 00:00 +08:00 的秒數」；前一個營運日的班次是負值。
#
# 演算法（參數見 P）：
#   1. 節點鏈：班表停靠站＋區域內（嘉義 4080～橋頭 4320、沙崙線）的通過站；通過站的表定時刻沿站間大圓距離比例內插。
#   2. 有實測的站給兩個錨點：
#        A 到站／通過：歷史資料取該次到訪第一筆 SrcUpdateTime；D1 取 obs_at − 32 秒（以秒級歷史校準）。
#        D 離站：表定離站 + max(0, 60×延誤分 − 30)，不早於 A + 20 秒。通過站只有 D 晚於 A 90 秒以上（被留置）才給。
#        歷史的延誤取該次到訪最後一列（同次到訪內會上下跳一分鐘，最後一列誤差較小）；D1 取 delay_max。
#        起點站的紀錄是看板佔位，不當 A，只用延誤給 D。
#        同一站的紀錄被別站的紀錄隔成兩次以上到訪（例：中洲→保安→中洲→保安），分不出哪一次才是真的到站：
#        這種站當作沒有可用的紀錄，歷史與 D1 都不取，由前後站內插（split_stations；回測同樣拿掉）。
#   3. 錨點互相矛盾時，用帶最小間隔的加權保序回歸（PAV）修正。最小間隔：停站 20 秒、跑行 0.7×表定，
#      另外不得短於該車種以極速梯形剖面跑完那一段的時間（物理下限；段長與性能參數由 build 的 --export-run-floor 匯出，
#      與網站畫車用的同一組 schedSegKmOf／resolvePerf）。
#      有實測的通過站會成為 build 剖面的折點；網站的 buildObsProfile 對折點之間的平均速度設上限（與跑段端點相鄰的區間
#      knot_end_ratio×極速、中段＝極速），超過就丟掉該區間內側的折點，丟到一個不剩就整段退回梯形，通過站時刻改由梯形
#      回填，與實測紀錄可差到兩分多鐘。所以折點區間的最小間隔再加一條：段長÷上限＋knot_margin_s（見 floor_gaps）。
#   4. 錨點之間沒有實測的節點：停站照表定、只伸縮跑行（上限 1.3×表定），多出來的時間判為留置，
#      放在區間內第一個沒有實測的停靠站；完全沒有停靠站才攤到跑行。
#   5. 首尾錨點之外照延誤平移；整班沒有實測＝表定。
import collections
import datetime
import gzip
import hashlib
import json
import math
import os
import random
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TZ = datetime.timezone(datetime.timedelta(hours=8))

P = dict(
    A_off_d1=32.0,      # D1 的 obs_at 是下一個 :04 取樣戳，平均比秒級第一筆晚 32 秒（標準差 17 秒）
    dep_bias=30.0,      # DelayTime 近似延誤分鐘的上取整
    min_dwell=20.0,     # 停靠站最短停站秒數
    k_floor=0.7,        # 跑行時間下限＝0.7×表定（9/12 歷史：實際／表定 p5 0.77；更低的多是量測雜訊）
    k_max=1.3,          # 跑行時間伸縮上限（p95 約 1.26）；超出的時間判為留置
    sig_A_hist=25.0, sig_A_d1=30.0, sig_D=50.0,    # 權重＝1/σ²（秒）
    max_incons=900.0,   # 非起點站的 A 與（表定到站＋60×首見延誤）差超過 15 分鐘＝佔位／重拍／路線結構假象，捨棄
    hold_flag_s=90.0,   # 比表定多停 90 秒以上才算留置
    floor_margin_s=1.0, # 物理下限多留 1 秒，剖面解出的巡航速度才會嚴格低於極速
    knot_end_ratio=0.85,  # 折點區間與跑段端點相鄰時的平均速度上限／極速（index.html buildObsProfile 的 VS_END＝VS_MID×0.85）
    knot_margin_s=2.0,  # 折點區間多留 2 秒：build 把跑段端點時刻取整到秒、剖面再把折點時刻取整，區間最多短 1 秒
)


# ───────────────────────── 設定與輸入 ─────────────────────────
def load_config(date):
    args = ['node', os.path.join(HERE, 'tainan_memory_config.mjs'), '--json']
    if date:
        args += ['--date', date]
    return json.loads(subprocess.run(args, check=True, capture_output=True, text=True).stdout)


def cache_path(cfg, ref):
    if isinstance(ref, str):
        return os.path.join(cfg['cacheRoot'], ref)
    if 'file' in ref:
        return os.path.join(cfg['root'], ref['file'])
    return os.path.join(cfg['cacheRoot'], ref['cache'])


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def day0_epoch(date):
    y, m, d = map(int, date.split('-'))
    return datetime.datetime(y, m, d, 0, 0, 0, tzinfo=TZ).timestamp()


def norm_name(n):
    return n.replace('臺', '台').replace(' ', '')


class Stations:
    """臺鐵 ODS 車站基本資料：站碼、站名、GPS（lat lon）。"""
    def __init__(self, path):
        st = json.load(open(path, encoding='utf-8'))
        self.c2n = {s['stationCode']: s['stationName'] for s in st}
        self.n2c = {norm_name(n): c for c, n in self.c2n.items()}
        self.gps = {}
        for s in st:
            parts = (s.get('gps') or '').split()
            if len(parts) == 2:
                self.gps[s['stationCode']] = (float(parts[0]), float(parts[1]))
        # 嘉義(4080)～橋頭(4320) 主線依站碼數字序＝線路序；沙崙線 4270→4271→4272 是支線
        self.main = sorted(c for c in self.c2n if c.isdigit() and 4080 <= int(c) <= 4320 and c not in ('4271', '4272'))
        self.branch = ['4270', '4271', '4272']

    def hav_km(self, a, b):
        la1, lo1 = self.gps[a]; la2, lo2 = self.gps[b]
        p = math.pi / 180
        dp = (la2 - la1) * p; dl = (lo2 - lo1) * p
        h = math.sin(dp / 2) ** 2 + math.cos(la1 * p) * math.cos(la2 * p) * math.sin(dl / 2) ** 2
        return 2 * 6371.0088 * math.asin(math.sqrt(h))

    def in_region(self, c):
        return c in self.main or c in self.branch

    def edge_toward(self, c):
        """區域外的站從區域哪一端出去：緯度在橋頭以南走南端、在嘉義以北走北端（區域內只有西部幹線與沙崙線，
        出入區域只能經過這兩端）；其他（例如緯度介於兩者之間的別條線）回 None。"""
        if c not in self.gps:
            return None
        lat = self.gps[c][0]
        if lat < self.gps[self.main[-1]][0]:
            return self.main[-1]
        if lat > self.gps[self.main[0]][0]:
            return self.main[0]
        return None

    def path_between(self, a, b):
        """a→b 之間依序經過的站碼（含兩端）。一端在區域外時，區域內那一段照樣列出（例如臺南→新左營會經過保安～橋頭）；
        兩端都在區域外回 None。"""
        ia, ib = self.in_region(a), self.in_region(b)
        if not (ia and ib):
            if ia == ib:
                return None
            e = self.edge_toward(a if ib else b)
            if e is None:
                return None
            return self.path_between(a, e) + [b] if ia else [a] + self.path_between(e, b)
        if a == b:
            return [a]
        ba = a in ('4271', '4272'); bb = b in ('4271', '4272')
        br = self.branch
        if ba and bb:
            i, j = br.index(a), br.index(b)
            return br[i:j + 1] if i <= j else br[j:i + 1][::-1]
        if ba:
            return br[:br.index(a) + 1][::-1] + self.path_between('4270', b)[1:]
        if bb:
            return self.path_between(a, '4270') + br[:br.index(b) + 1][1:]
        i, j = self.main.index(a), self.main.index(b)
        return self.main[i:j + 1] if i <= j else self.main[j:i + 1][::-1]

    def interp_times(self, stops):
        """列出的站 stop=True；相鄰兩站之間的通過站沿大圓距離比例線性內插，stop=False。"""
        out = {}
        for k, s in enumerate(stops):
            if s['sta'] not in out:
                out[s['sta']] = {'arr': s['arr'], 'dep': s['dep'], 'stop': True, 'idx': k}
        for k in range(len(stops) - 1):
            a, b = stops[k], stops[k + 1]
            p = self.path_between(a['sta'], b['sta'])
            if not p or len(p) <= 2:
                continue
            d = [0.0]
            for u, v in zip(p[:-1], p[1:]):
                d.append(d[-1] + self.hav_km(u, v))
            tot = d[-1]
            if tot <= 0:
                continue
            t0, t1 = a['dep'], b['arr']
            for i in range(1, len(p) - 1):
                c = p[i]
                if c in out:
                    continue
                t = t0 + (t1 - t0) * d[i] / tot
                out[c] = {'arr': t, 'dep': t, 'stop': False, 'idx': k + 0.5}
        return out


# ───────────────────────── 班表實例 ─────────────────────────
def proc_instances(sched, date, ST, shift):
    """密化班表某營運日的列車 → 實例。dense 檔的通過站（stop=False）不算停靠站，之後自己內插。"""
    out = {}
    for i in sched['dates'][date]:
        t = sched['trains'][i]
        stops = []
        for s in t['stops']:
            code = ST.n2c.get(norm_name(s['name']))
            if code is None or s.get('stop') is False:
                continue
            stops.append({'sta': code, 'arr': s['arrSec'] + shift, 'dep': s['depSec'] + shift, 'name': s['name']})
        out[t['train']] = {'train': t['train'], 'serviceDate': date, 'sourceIndex': i, 'stops': stops,
                           'times': ST.interp_times(stops), 'meta': t}
    return out


def instances_for(cfg_sched_refs, target, ST, cfg):
    """前一天、當天、後一天的實例（時間軸相對 target 00:00）。回傳 (label→{train→inst}, 讀到的班表檔)。"""
    d = datetime.date.fromisoformat(target)
    res, used, loaded = {}, [], {}
    for off in (-1, 0, 1):
        dd = (d + datetime.timedelta(days=off)).isoformat()
        ref = cfg_sched_refs.get(dd)
        if ref is None:
            continue
        path = cache_path(cfg, ref)
        if path not in loaded:
            loaded[path] = json.load(open(path, encoding='utf-8'))
            used.append(path)
        sched = loaded[path]
        if dd not in sched['dates']:
            continue
        res['d%+d' % off] = proc_instances(sched, dd, ST, 86400 * off)
    return res, used


# ───────────────────────── 實測 ─────────────────────────
def load_hist_rows(path, target):
    """TDX 歷史 LiveTrainDelay（gzip JSONL）→ 列，s／u 為相對 target 00:00 +08:00 的秒數。"""
    t0 = day0_epoch(target)
    rows = []
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            r['s'] = datetime.datetime.fromisoformat(r['SrcUpdateTime']).timestamp() - t0
            r['u'] = datetime.datetime.fromisoformat(r['UpdateTime']).timestamp() - t0
            r['d'] = r['DelayTime']
            rows.append(r)
    return rows


def load_d1_rows(path, target):
    t0 = day0_epoch(target)
    d = json.load(open(path, encoding='utf-8'))
    rows = d[0]['results']
    for r in rows:
        dt = datetime.datetime.fromisoformat(r['obs_at'])
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=TZ)
        r['t'] = dt.timestamp() - t0
    return rows


def visits(rows):
    """依車次分組、依 SrcUpdateTime 排序，連續相同 StationID 合為一次到訪。"""
    by = collections.defaultdict(list)
    for r in rows:
        by[r['TrainNo']].append(r)
    out = {}
    for tn, rs in by.items():
        rs.sort(key=lambda r: (r['s'], r['u']))
        vs = []
        for r in rs:
            if vs and vs[-1]['sta'] == r['StationID']:
                v = vs[-1]
                v['last'] = r['s']; v['n'] += 1; v['delays'].append(r['d']); v['rows'].append(r)
            else:
                vs.append({'sta': r['StationID'], 'first': r['s'], 'last': r['s'], 'n': 1, 'delays': [r['d']], 'rows': [r]})
        out[tn] = vs
    return out


def assign_hist_visits(insts, vis, tol=3 * 3600):
    """每次到訪配到「首筆時刻最接近 表定到站＋60×首筆延誤」的班表實例。回傳 {(label, train): [visit…]}。"""
    groups = {}
    for tn, vs in vis.items():
        for v in vs:
            best = None
            for lab, m in insts.items():
                inst = m.get(tn)
                if not inst or v['sta'] not in inst['times']:
                    continue
                dev = v['first'] - (inst['times'][v['sta']]['arr'] + 60 * v['delays'][0])
                if best is None or abs(dev) < abs(best[1]):
                    best = (lab, dev)
            if best and abs(best[1]) <= tol:
                groups.setdefault((best[0], tn), []).append(v)
    return groups


def assign_d1_rows(insts, rows, tol=3 * 3600):
    groups = {}
    for r in rows:
        tr, sta = r['train_no'], r['sta']
        best = None
        for lab, m in insts.items():
            inst = m.get(tr)
            if not inst or sta not in inst['times']:
                continue
            dev = r['t'] - (inst['times'][sta]['arr'] + 60 * r['delay'])
            if best is None or abs(dev) < abs(best[1]):
                best = (lab, dev)
        if best and abs(best[1]) <= tol:
            groups.setdefault((best[0], tr), []).append(r)
    return groups


def obs_from_d1(rows):
    """同一站有多列（午夜看板重拍）：A 與首見延誤取最早一列，d_dep 取 delay_max 的最大值。"""
    out = {}
    for r in sorted(rows, key=lambda r: r['t']):
        o = out.get(r['sta'])
        if o is None:
            out[r['sta']] = {'src': 'd1', 'A': r['t'] - P['A_off_d1'], 'd_first': r['delay'], 'd_dep': r['delay_max'], 'n': 1, 't_raw': r['t']}
        else:
            o['d_dep'] = max(o['d_dep'], r['delay_max']); o['n'] += 1
    return out


def split_stations(visit_list):
    """被別站的紀錄隔成兩次以上到訪的站（例：中洲→保安→中洲→保安）。分不出哪一次才是真的到站，重建與回測都當作沒有可用的紀錄。"""
    c = collections.Counter(v['sta'] for v in visit_list)
    return sorted(s for s, k in c.items() if k > 1)


def obs_from_hist(visit_list):
    """同站多次到訪取第一次。"""
    out = {}
    for v in visit_list:
        if v['sta'] in out:
            continue
        out[v['sta']] = {'src': 'hist', 'A': v['first'], 'd_first': v['delays'][0], 'd_dep': v['delays'][-1], 'n': v['n'], 't_raw': v['first'], 'last': v['last']}
    return out


def merge_obs(primary, fallback):
    out = dict(fallback)
    out.update(primary)           # 同站以歷史為準
    return out


# ───────────────────────── 重建 ─────────────────────────
def build_chain(inst, ST):
    """依行車順序列出節點 [{'sta','sa','sd','stop'}…]；通過站取內插值。"""
    stops = inst['stops']
    nodes, seen = [], set()
    for k, s in enumerate(stops):
        if k > 0:
            p = ST.path_between(stops[k - 1]['sta'], s['sta'])
            if p and len(p) > 2:
                for c in p[1:-1]:
                    if c in inst['times'] and c not in seen:
                        t = inst['times'][c]
                        nodes.append({'sta': c, 'sa': t['arr'], 'sd': t['dep'], 'stop': False})
                        seen.add(c)
        if s['sta'] in seen:
            continue
        nodes.append({'sta': s['sta'], 'sa': s['arr'], 'sd': s['dep'], 'stop': True, 'name': s.get('name')})
        seen.add(s['sta'])
    return nodes


def pav(y, w):
    blocks = []
    for yi, wi in zip(y, w):
        blocks.append([yi * wi, wi, 1])
        while len(blocks) > 1 and blocks[-2][0] / blocks[-2][1] > blocks[-1][0] / blocks[-1][1]:
            b = blocks.pop()
            blocks[-1][0] += b[0]; blocks[-1][1] += b[1]; blocks[-1][2] += b[2]
    out = []
    for b in blocks:
        out += [b[0] / b[1]] * b[2]
    return out


def reconstruct(inst, obs, ST, params=None, floor_q=None):
    """回傳 (nodes, res, info)。res: {sta: {arr, dep, src, hold_s, held, …}}。floor_q: {區間 q: 物理最短秒數}。"""
    p = dict(P)
    if params:
        p.update(params)
    nodes = build_chain(inst, ST)
    m = len(nodes)
    info = {'dropped': [], 'hold_inferred': [], 'n_anchor': 0, 'anchors': []}
    if m == 0:
        return nodes, {}, info
    # 鏈上時間點：q = 2*i（到）、2*i+1（離）；區間 q＝點 q-1 → 點 q（奇數 q＝停站，偶數 q＝跑行）
    sched = []
    for nd in nodes:
        sched += [nd['sa'], nd['sd']]
    nq = len(sched)
    kind = ['dwell' if q % 2 == 1 else 'run' for q in range(nq)]
    sl = [0.0] + [sched[q] - sched[q - 1] for q in range(1, nq)]
    gap = [0.0] * nq
    for q in range(1, nq):
        if kind[q] == 'dwell':
            nd = nodes[q // 2]
            gap[q] = min(p['min_dwell'], max(sl[q], 0.0)) if nd['stop'] else 0.0
        else:
            gap[q] = p['k_floor'] * max(sl[q], 0.0)
            if floor_q and q in floor_q:
                gap[q] = max(gap[q], floor_q[q])
    cum = [0.0] * nq
    for q in range(1, nq):
        cum[q] = cum[q - 1] + gap[q]

    anchors = []          # (q, y, w, tag, i, src)
    for i, nd in enumerate(nodes):
        o = obs.get(nd['sta'])
        if not o:
            continue
        sig_a = p['sig_A_hist'] if o['src'] == 'hist' else p['sig_A_d1']
        cand = nd['sd'] + max(0.0, 60.0 * o['d_dep'] - p['dep_bias'])
        if i == 0:
            anchors.append((2 * i + 1, cand, 1.0 / p['sig_D'] ** 2, 'D-origin', i, o['src']))
            continue
        A = o['A']
        if abs(A - (nd['sa'] + 60.0 * o['d_first'])) > p['max_incons']:
            info['dropped'].append({'sta': nd['sta'], 'why': 'inconsistent', 'dev': round(A - (nd['sa'] + 60.0 * o['d_first'])), 'A': A})
            continue
        anchors.append((2 * i, A, 1.0 / sig_a ** 2, 'A', i, o['src']))
        if nd['stop']:
            anchors.append((2 * i + 1, max(A + p['min_dwell'], cand), 1.0 / p['sig_D'] ** 2, 'D', i, o['src']))
        elif cand - A >= p['hold_flag_s']:
            anchors.append((2 * i + 1, max(A, cand), 1.0 / p['sig_D'] ** 2, 'D', i, o['src']))
    anchors.sort(key=lambda a: a[0])
    info['n_anchor'] = len(anchors)
    T = [None] * nq
    if not anchors:
        T = list(sched)
    else:
        u = [a[1] - cum[a[0]] for a in anchors]
        ustar = pav(u, [a[2] for a in anchors])
        for a, us in zip(anchors, ustar):
            T[a[0]] = us + cum[a[0]]
            info['anchors'].append({'sta': nodes[a[4]]['sta'], 'kind': a[3], 'src': a[5], 'y': a[1], 'fit': T[a[0]]})
        qs = [a[0] for a in anchors]
        for q in range(qs[0] - 1, -1, -1):            # 首錨點之前：延誤原樣往回推
            T[q] = T[q + 1] - sl[q + 1]
        for q in range(qs[-1] + 1, nq):               # 末錨點之後：延誤原樣往後推；停靠站不早於表定離站
            T[q] = T[q - 1] + sl[q]
            if kind[q] == 'dwell' and nodes[q // 2]['stop']:
                T[q] = max(T[q], sched[q], T[q - 1] + gap[q])
        for j in range(len(qs) - 1):                  # 相鄰錨點之間
            qa, qb = qs[j], qs[j + 1]
            if qb - qa <= 1:
                continue
            delta = T[qb] - T[qa]
            idx = list(range(qa + 1, qb + 1))
            g = [gap[q] for q in idx]
            s = [max(sl[q], 0.0) for q in idx]
            kd = [kind[q] for q in idx]
            el = [max(0.0, s[k] - g[k]) for k in range(len(idx))]
            base, E = sum(g), sum(el)
            R = delta - base
            if R <= 0 or E <= 0:
                lens = [gg + (max(R, 0.0) / len(idx)) for gg in g]
                if base > 0 and delta < base:
                    lens = [gg * delta / base for gg in g]
            elif R <= E:
                phi = R / E
                lens = [g[k] + phi * el[k] for k in range(len(idx))]
            else:
                # 超過表定：跑行最多伸到 k_max×表定；再多的視為留置，放在第一個未實測的停靠站
                run_idx = [k for k in range(len(idx)) if kd[k] == 'run']
                run_sum = sum(s[k] for k in run_idx)
                if all(g[k] <= s[k] for k in range(len(idx))):
                    lens = [s[k] for k in range(len(idx))]
                    extra = R - E
                    take = min(extra, (p['k_max'] - 1.0) * run_sum)
                    if run_sum > 0:
                        for k in run_idx:
                            lens[k] += take * s[k] / run_sum
                else:
                    # 物理下限比表定還長的跑行：從下限起算，伸縮餘裕只算到 k_max×表定為止
                    lens = [max(s[k], g[k]) for k in range(len(idx))]
                    extra = delta - sum(lens)
                    room = [max(0.0, p['k_max'] * s[k] - lens[k]) for k in run_idx]
                    take = min(max(extra, 0.0), sum(room))
                    if take > 0:
                        for k, rk in zip(run_idx, room):
                            lens[k] += take * rk / sum(room)
                extra -= take
                if extra > 1e-6:
                    hold_k = None
                    for k in range(len(idx)):
                        if kd[k] == 'dwell' and nodes[idx[k] // 2]['stop']:
                            hold_k = k; break
                    if hold_k is not None:
                        lens[hold_k] += extra
                        info['hold_inferred'].append({'sta': nodes[idx[hold_k] // 2]['sta'], 'sec': extra})
                    elif run_sum > 0:
                        for k in run_idx:
                            lens[k] += extra * s[k] / run_sum
                    else:
                        lens[0] += extra
            t = T[qa]
            for k, q in enumerate(idx[:-1]):
                t += lens[k]
                T[q] = t
    res = {}
    qa_ = [a[0] for a in anchors]
    for i, nd in enumerate(nodes):
        o = obs.get(nd['sta'])
        a, d = T[2 * i], T[2 * i + 1]
        has_A = any(x[4] == i and x[3] == 'A' for x in anchors)
        has_D = any(x[4] == i and x[3] in ('D', 'D-origin') for x in anchors)
        if has_A:
            src = 'obs-' + o['src']
        elif has_D:
            src = 'dep-only-' + o['src']
        elif not anchors:
            src = 'sched'
        else:
            src = 'interp' if (min(qa_) < 2 * i < max(qa_)) else 'extrap'
        hold_s = max(0.0, (d - a) - (nd['sd'] - nd['sa']))
        res[nd['sta']] = {'origin': i == 0, 'terminal': i == m - 1, 'arr': a, 'dep': d, 'src': src, 'hold_s': hold_s,
                          'held': hold_s >= p['hold_flag_s'], 'stop': nd['stop'], 'sa': nd['sa'], 'sd': nd['sd']}
    return nodes, res, info


# ───────────────────────── 物理下限 ─────────────────────────
def tmin_run(L_km, perf):
    """以極速梯形剖面（index.html buildProfile 的 ρ=1 解）跑完 L_km 的最短秒數。"""
    L = L_km * 1000.0
    if L <= 0:
        return 0.0
    a, b, v = perf['a'] / 3.6, perf['b'] / 3.6, perf['v'] / 3.6
    D = 1 / (2 * a) + 1 / (2 * b)
    return 2 * math.sqrt(D * L) if L <= D * v * v else L / v + D * v


def floor_gaps(nodes, rec, ST, held_pass, knots=frozenset()):
    """依 build 匯出的逐段段長，把每個跑段（停靠站與被留置的通過站之間）的物理下限攤到鏈上的跑行區間。
    knots：會成為 build 剖面折點的節點序（knot_nodes）。跑段內有折點時，再加折點閘門：相鄰兩個剖面點（跑段端點與折點）
    之間至少要 段長÷上限＋knot_margin_s 秒（上限＝極速；與跑段端點相鄰的區間＝knot_end_ratio×極速，同 buildObsProfile），
    依段長攤到其中的跑行區間，與物理下限取大。
    回傳 ({q: 秒}, [跑段診斷])。rec 為 None（沒有匯出）時不設下限。"""
    if not rec:
        return {}, []
    codes = [ST.n2c.get(norm_name(n)) for n in rec['names']]
    km = rec['segKm']
    bnd = [i for i, nd in enumerate(nodes) if i == 0 or i == len(nodes) - 1 or nd['stop'] or nd['sta'] in held_pass]
    out, diag, pos = {}, [], 0
    dense_at = []
    for nd in nodes:                                     # 鏈節點 → 密化班表節點序（依序往後找）
        k = None
        for j in range(pos, len(codes)):
            if codes[j] == nd['sta']:
                k = j; break
        dense_at.append(k)
        if k is not None:
            pos = k + 1
    for i, j in zip(bnd[:-1], bnd[1:]):
        di, dj = dense_at[i], dense_at[j]
        if di is None or dj is None or dj <= di:
            diag.append({'from': nodes[i]['sta'], 'to': nodes[j]['sta'], 'skip': 'node-not-in-dense'})
            continue
        L = sum(km[di:dj])
        tmin = tmin_run(L, rec['perf']) + P['floor_margin_s']
        qs = [2 * k for k in range(i + 1, j + 1)]        # 跑行區間（點 2k-1 → 2k）
        sl = [max(0.0, nodes[k]['sa'] - nodes[k - 1]['sd']) for k in range(i + 1, j + 1)]
        tot = sum(sl)
        for q, s in zip(qs, sl):
            out[q] = tmin * (s / tot if tot > 0 else 1.0 / len(qs))
        d = {'from': nodes[i]['sta'], 'to': nodes[j]['sta'], 'km': L, 'tmin': tmin, 'sched': nodes[j]['sa'] - nodes[i]['sd']}
        pts = [i] + [k for k in range(i + 1, j) if k in knots] + [j]
        if len(pts) > 2:                                 # 沒有折點的跑段畫梯形，閘門不適用
            vmax, gates = rec['perf']['v'] / 3.6, []
            for m, (p0, p1) in enumerate(zip(pts[:-1], pts[1:])):
                lim = vmax * (P['knot_end_ratio'] if m == 0 or m == len(pts) - 2 else 1.0)
                seg = {}
                for k in range(p0 + 1, p1 + 1):
                    a, b = dense_at[k - 1], dense_at[k]
                    if a is None or b is None or b <= a:
                        seg = None; break
                    seg[2 * k] = sum(km[a:b]) * 1000.0
                Lm = sum(seg.values()) if seg else 0.0
                if not seg or Lm <= 0:
                    gates.append({'to': nodes[p1]['sta'], 'skip': 'node-not-in-dense'})
                    continue
                need = Lm / lim + P['knot_margin_s']
                for q, Lq in seg.items():
                    out[q] = max(out.get(q, 0.0), need * Lq / Lm)
                gates.append({'to': nodes[p1]['sta'], 'm': round(Lm, 1), 'need': round(need, 1), 'end': lim < vmax})
            d['knotGates'] = gates
        diag.append(d)
    return out, diag


def knot_nodes(nodes, obs, held_pass):
    """build 剖面會當折點的節點序：有到站錨點、沒被留置的通過站（與 reconstruct 給 A 錨點的規則相同：起點不給、
    與首見延誤推的時刻差超過 max_incons 的捨棄）。build 端以 src 為 obs-*、held 為否選折點，兩邊一致。"""
    out = set()
    for i, nd in enumerate(nodes):
        o = obs.get(nd['sta'])
        if i == 0 or nd['stop'] or not o or nd['sta'] in held_pass:
            continue
        if abs(o['A'] - (nd['sa'] + 60.0 * o['d_first'])) > P['max_incons']:
            continue
        out.add(i)
    return out


def reconstruct_physical(inst, obs, ST, rec):
    """物理下限依跑段邊界而定；留置的通過站會變成新的邊界，所以重算到邊界不再增加為止。"""
    held = set()
    for _ in range(5):
        nodes0 = build_chain(inst, ST)
        fq, diag = floor_gaps(nodes0, rec, ST, held, knot_nodes(nodes0, obs, held))
        nodes, res, info = reconstruct(inst, obs, ST, floor_q=fq)
        now = {sta for sta, r in res.items() if not r['stop'] and r['held']}
        if now <= held:
            break
        held |= now
    info['runs'] = diag
    info['held_pass'] = sorted(held)
    return nodes, res, info


# ───────────────────────── 10/16 產出 ─────────────────────────
def run_date(cfg):
    act = cfg['actuals']
    ST = Stations(cache_path(cfg, act['stations']))
    target = cfg['date']
    insts, sched_files = instances_for(cfg['schedules'], target, ST, cfg)
    inputs = [{'path': os.path.relpath(f, cfg['cacheRoot']) if f.startswith(cfg['cacheRoot']) else os.path.relpath(f, cfg['root']),
               'sha256': sha256_file(f)} for f in sched_files]
    inputs.append({'path': act['stations'], 'sha256': sha256_file(cache_path(cfg, act['stations']))})
    hist_rows, hist_used = [], []
    for ref in act['hist']:
        f = cache_path(cfg, ref)
        if not os.path.exists(f):
            continue
        rows = load_hist_rows(f, target)
        for r in rows:
            r['_file'] = ref
        hist_rows += rows
        hist_used.append(ref)
        inputs.append({'path': ref, 'sha256': sha256_file(f), 'rows': len(rows)})
    d1_groups, d1_rows_all = {}, []
    for ref in act['d1']:
        f = cache_path(cfg, ref)
        if not os.path.exists(f):
            continue
        rows = load_d1_rows(f, target)
        for r in rows:
            r['_file'] = ref
        d1_rows_all += rows
        inputs.append({'path': ref, 'sha256': sha256_file(f), 'rows': len(rows)})
    for (k, v) in assign_d1_rows(insts, d1_rows_all).items():
        d1_groups.setdefault(k, []).extend(v)
    hist_groups = assign_hist_visits(insts, visits(hist_rows)) if hist_rows else {}
    floor_path = cache_path(cfg, act['runFloor'])
    if not os.path.exists(floor_path):
        sys.exit('缺少物理下限檔 ' + floor_path + '；先跑 node scripts/build_tainan_memory.mjs --date ' + target + ' --export-run-floor')
    floor = json.load(open(floor_path, encoding='utf-8'))
    inputs.append({'path': act['runFloor'], 'sha256': sha256_file(floor_path)})
    floor_by = {(r['serviceDate'], r['train']): r for r in floor['trains']}
    sel_codes = [ST.n2c[norm_name(n)] for n in cfg['selection']['stations']]
    trains, missing_floor = [], []
    for lab in ('d-1', 'd+0', 'd+1'):
        for no, inst in insts.get(lab, {}).items():
            ts = [inst['times'][c] for c in sel_codes if c in inst['times']]
            if not ts:
                continue
            w0, w1 = min(t['arr'] for t in ts), max(t['dep'] for t in ts)
            if w1 < 0 or w0 >= 86400:
                continue
            key = (inst['serviceDate'], no)
            rec = floor_by.get(key)
            if rec is None:
                missing_floor.append('%s:%s' % key)
            hv = hist_groups.get((lab, no), [])
            dr = d1_groups.get((lab, no), [])
            # 紀錄被別站隔開的站，歷史與 D1 都不取（D1 是同一份看板的分鐘取樣，一樣分不出來），由前後站內插。
            split = split_stations(hv)
            obs = merge_obs(obs_from_hist([v for v in hv if v['sta'] not in split]), obs_from_d1([r for r in dr if r['sta'] not in split]))
            nodes, res, info = reconstruct_physical(inst, obs, ST, rec)
            out_nodes = []
            for nd in nodes:
                r = res[nd['sta']]
                o = obs.get(nd['sta'])
                out_nodes.append({'sta': nd['sta'], 'name': nd.get('name') or ST.c2n.get(nd['sta']), 'stop': nd['stop'],
                                  'schedArr': nd['sa'], 'schedDep': nd['sd'], 'arr': r['arr'], 'dep': r['dep'], 'src': r['src'],
                                  'holdSec': r['hold_s'], 'held': r['held'],
                                  'obs': None if not o else {k: o[k] for k in ('src', 'A', 'd_first', 'd_dep', 'n', 't_raw') if k in o}})
            raw = observation_rows(nodes, hv, dr)
            trains.append({'key': '%s:%s' % key, 'serviceDate': inst['serviceDate'], 'train': no, 'sourceIndex': inst['sourceIndex'],
                           'label': lab, 'timing': 'observed' if info['n_anchor'] else 'scheduled',
                           'nAnchors': info['n_anchor'], 'nHistVisits': len(hv), 'nD1Rows': len(dr),
                           'splitStations': [{'sta': s, 'name': ST.c2n.get(s), 'firsts': [v['first'] for v in hv if v['sta'] == s]} for s in split],
                           'window': [w0, w1], 'anchors': info['anchors'], 'dropped': info['dropped'],
                           'holdInferred': info['hold_inferred'], 'heldPass': info['held_pass'], 'runs': info['runs'],
                           'nodes': out_nodes, 'raw': raw})
    if missing_floor:
        sys.exit('物理下限檔缺少這些班次（先重跑 --export-run-floor）：' + ','.join(missing_floor))
    trains.sort(key=lambda t: (t['serviceDate'], t['window'][0], t['train']))
    keys = [t['key'] for t in trains]
    assert len(set(keys)) == len(keys), '同一營運日同車次出現兩次'
    used_hist_rows = sum(len(v['rows']) for t in trains for v in hist_groups.get((t['label'], t['train']), []))
    used_d1_rows = sum(t['nD1Rows'] for t in trains)
    out = {'schema': 1, 'date': target, 'params': P, 'inputs': inputs, 'histFilesUsed': hist_used,
           'primary': 'tdx-historical' if hist_used else 'd1',
           'counts': {'trains': len(trains), 'observed': sum(1 for t in trains if t['timing'] == 'observed'),
                      'scheduled': [t['key'] for t in trains if t['timing'] == 'scheduled'],
                      'histRowsLoaded': len(hist_rows), 'd1RowsLoaded': len(d1_rows_all),
                      'histRowsUsed': used_hist_rows, 'd1RowsUsed': used_d1_rows},
           'trains': trains}
    path = cache_path(cfg, act['out'])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    src = collections.Counter(n['src'] for t in trains for n in t['nodes'])
    print(json.dumps({'out': path, 'trains': len(trains), 'byDate': dict(collections.Counter(t['serviceDate'] for t in trains)),
                      'observed': out['counts']['observed'], 'scheduled': out['counts']['scheduled'], 'primary': out['primary'],
                      'histFilesUsed': hist_used, 'histRowsUsed': used_hist_rows, 'd1RowsUsed': used_d1_rows,
                      'nodeSources': dict(src), 'heldPass': {t['key']: t['heldPass'] for t in trains if t['heldPass']},
                      'splitStations': {t['key']: [s['name'] for s in t['splitStations']] for t in trains if t['splitStations']}}, ensure_ascii=False))


R5 = ('4200', '4210', '4220', '4250', '4260')   # 永康、大橋、臺南、保安、仁德


def observation_rows(nodes, hv, dr):
    """範圍站（永康～仁德）與鏈上前後各一站的原始觀測列，標明來源檔。"""
    idx = [i for i, nd in enumerate(nodes) if nd['sta'] in R5]
    if not idx:
        return []
    keep = {nodes[i]['sta'] for i in range(max(0, idx[0] - 1), min(len(nodes), idx[-1] + 2))}
    out = []
    for v in hv:
        if v['sta'] in keep:
            for r in v['rows']:
                out.append({'source': 'tdx-historical', 'file': r['_file'], 'TrainNo': r['TrainNo'], 'StationID': r['StationID'],
                            'StationName': (r.get('StationName') or {}).get('Zh_tw'), 'DelayTime': r['DelayTime'],
                            'SrcUpdateTime': r['SrcUpdateTime'], 'UpdateTime': r['UpdateTime']})
    for r in dr:
        if r['sta'] in keep:
            out.append({'source': 'd1', 'file': r['_file'], **{k: r[k] for k in ('service_date', 'train_no', 'sta', 'status', 'delay', 'delay_max', 'obs_at')}})
    return out


# ───────────────────────── 回測（9/12） ─────────────────────────
def pctl(xs, ps):
    xs = sorted(xs)
    n = len(xs)
    return {p: xs[min(n - 1, max(0, int(round(p / 100.0 * (n - 1)))))] for p in ps}


def stat(xs, name, ps=(1, 5, 25, 50, 75, 95, 99)):
    if not xs:
        print('  %-46s n=0' % name)
        return None
    p = pctl(xs, ps)
    ab = sorted(abs(x) for x in xs)
    r = {'n': len(xs), 'p50abs': ab[len(ab) // 2], 'p90abs': ab[int(len(ab) * .9)]}
    print('  %-46s n=%6d ' % (name, len(xs)) + ' '.join('p%d %6.0f' % (k, p[k]) for k in ps) + '  |err| p50 %5.0f p90 %5.0f' % (r['p50abs'], r['p90abs']))
    return r


def backtest(cfg):
    """V1 保留測試：內部已實測節點隨機拿掉 30%，用其餘錨點重建，和歷史第一筆比（量未實測站的內插誤差）。
    V2 偽 D1：把每次到訪壓成 D1 型的分鐘戳列，重建後與秒級重建逐節點比（量分鐘級資料的代價）。"""
    bt = cfg['backtest']
    ST = Stations(cache_path(cfg, bt['stations']))
    date = cfg['date']
    sp = cache_path(cfg, bt['schedule'])
    got = sha256_file(sp)
    assert got == bt['schedule']['sha256'], '回測班表雜湊不符：' + got
    insts, _ = instances_for({d: bt['schedule'] for d in (cfg['previous'], date, (datetime.date.fromisoformat(date) + datetime.timedelta(days=1)).isoformat())}, date, ST, cfg)
    V = visits(load_hist_rows(cache_path(cfg, bt['hist']), date))

    def pick(train, sta, first, d):
        best = None
        for lab, m in insts.items():
            inst = m.get(train)
            if not inst or sta not in inst['times']:
                continue
            dev = first - (inst['times'][sta]['arr'] + 60 * d)
            if best is None or abs(dev) < abs(best[2]):
                best = (lab, inst, dev)
        return best

    groups = {}
    for tn, vs in V.items():
        for v in vs:
            b = pick(tn, v['sta'], v['first'], v['delays'][0])
            if b is None or abs(b[2]) > 3600:
                continue
            groups.setdefault((b[0], tn), (b[1], []))[1].append(v)
    for inst, vs in groups.values():   # 紀錄被別站隔開的站不當真值、也不當錨點（與重建同一條規則）
        split = split_stations(vs)
        vs[:] = [v for v in vs if v['sta'] not in split]
    print('train instances with hist visits:', len(groups))
    random.seed(20261016)
    e_recon, e_b2, e_b3 = {'stop': [], 'pass': []}, {'stop': [], 'pass': []}, {'stop': [], 'pass': []}
    by_gap = collections.defaultdict(list)
    n_trains = 0
    for (lab, tn), (inst, vs) in groups.items():
        obs = obs_from_hist(vs)
        nodes = build_chain(inst, ST)
        idx_obs = [i for i, nd in enumerate(nodes) if nd['sta'] in obs and i != 0]
        if len(idx_obs) < 4:
            continue
        interior = idx_obs[1:-1]
        held = set(random.sample(interior, max(1, int(round(0.3 * len(interior))))))
        obs_cut = {nodes[i]['sta']: obs[nodes[i]['sta']] for i in range(len(nodes)) if nodes[i]['sta'] in obs and i not in held}
        _, res, _ = reconstruct(inst, obs_cut, ST)
        n_trains += 1
        for i in held:
            nd = nodes[i]
            truth = obs[nd['sta']]['A']
            kind = 'stop' if nd['stop'] else 'pass'
            e_recon[kind].append(res[nd['sta']]['arr'] - truth)
            prev = [j for j in range(i) if nodes[j]['sta'] in obs_cut and j != 0]
            nxt = [j for j in range(i + 1, len(nodes)) if nodes[j]['sta'] in obs_cut]
            if prev:
                e_b2[kind].append(nd['sa'] + 60 * obs_cut[nodes[prev[-1]]['sta']]['d_first'] - truth)
            if prev and nxt:
                j1, j2 = prev[-1], nxt[0]
                L1 = obs_cut[nodes[j1]['sta']]['A'] - nodes[j1]['sa']
                L2 = obs_cut[nodes[j2]['sta']]['A'] - nodes[j2]['sa']
                f = (nd['sa'] - nodes[j1]['sa']) / max(1.0, (nodes[j2]['sa'] - nodes[j1]['sa']))
                e_b3[kind].append(nd['sa'] + L1 + f * (L2 - L1) - truth)
                gapS = nodes[j2]['sa'] - nodes[j1]['sa']
                by_gap['<=5min' if gapS <= 300 else ('5-15min' if gapS <= 900 else '>15min')].append(res[nd['sta']]['arr'] - truth)
    print('V1 hold-out trains:', n_trains)
    result = {}
    for kind in ('stop', 'pass'):
        print('== held-out node kind:', kind)
        result[kind] = stat(e_recon[kind], 'recon (PAV+stretch) arr error vs hist first')
        stat(e_b3[kind], 'baseline B3: linear lateness interpolation')
        stat(e_b2[kind], 'baseline B2: sched + 60*d(prev observed)')
    print('== recon error by anchor-gap (sched seconds between neighbouring observed nodes)')
    for k in ('<=5min', '5-15min', '>15min'):
        stat(by_gap[k], 'gap ' + k)

    def ceil_stamp(t):
        k = -(-(t - 4) // 60)
        return 60 * k + 4
    dA, dD, nn = [], [], 0
    for (lab, tn), (inst, vs) in groups.items():
        obs_h = obs_from_hist(vs)
        rows = []
        for v in vs:
            if v['sta'] in [r['sta'] for r in rows]:
                continue
            rows.append({'sta': v['sta'], 't': ceil_stamp(v['first'] + 7), 'delay': v['delays'][0], 'delay_max': max(v['delays'])})
        _, r_h, _ = reconstruct(inst, obs_h, ST)
        _, r_d, _ = reconstruct(inst, obs_from_d1(rows), ST)
        nn += 1
        for sta, a in r_h.items():
            b = r_d[sta]
            if a['src'].startswith('obs'):
                dA.append(b['arr'] - a['arr'])
                if a['stop']:
                    dD.append(b['dep'] - a['dep'])
    print('V2 pseudo-D1 vs hist reconstruction, trains', nn)
    result['d1A'] = stat(dA, 'arr diff (D1-like minus hist) at observed nodes')
    result['d1D'] = stat(dD, 'dep diff (D1-like minus hist) at observed stops')
    print('BACKTEST ' + json.dumps({'date': date, **result}))
    if bt.get('out'):
        path = cache_path(cfg, bt['out'])
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump({'date': date, 'params': P, 'holdOutSeed': 20261016, **result}, f, ensure_ascii=False, indent=1)
            f.write('\n')


def date_from_argv(argv):
    """與 tainan_memory_config.mjs 的 dateFromArgv 同一套規則：--date X 或 --date=X，只能給一次，要接 YYYY-MM-DD；沒給回傳 None。"""
    eq = [a for a in argv if a.startswith('--date=')]
    if len(eq) + argv.count('--date') > 1:
        sys.exit('--date 只能給一次')
    if eq:
        d = eq[0][len('--date='):]
    elif '--date' in argv:
        i = argv.index('--date')
        d = argv[i + 1] if i + 1 < len(argv) else ''
    else:
        return None
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', d):
        sys.exit('--date 要接 YYYY-MM-DD')
    return d


def main(argv):
    date = date_from_argv(argv)
    if '--backtest' in argv:
        backtest(load_config(date or '2026-09-12'))
        return
    cfg = load_config(date)
    if 'actuals' not in cfg:
        sys.exit(cfg['date'] + ' 的設定沒有實測輸入（actuals）；這一天是照表定封存的。')
    run_date(cfg)


if __name__ == '__main__':
    main(sys.argv[1:])
