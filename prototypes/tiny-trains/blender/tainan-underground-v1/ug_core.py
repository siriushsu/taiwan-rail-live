"""臺南地下化模型的共用計算：座標、參考線與剖面座標、高程剖面、站體與月台的配置。

座標：x=(lon−lon0)·111320·cos(lat0)、y=(lat−lat0)·111320，單位公尺（與重播頁 replay.js 的 world() 相同）。

剖面座標 (d, s)：d＝沿參考線（params.alignment.referenceChain，西側正線一路接到兩端地面段）從南端起算的累計長度；
s＝垂直於參考線的橫向位置，向東為正。參考線折點上用角平分線方向（miter），所以隧道、引道、站體的剖面線（rung）彼此一致。
高程剖面 z(d) 只有一個定義：控制點之間線性內插（Profile.z）。任何一個點要查 z，先投影到參考線取得 d 再內插。

這支只讀檔、做幾何計算，不寫檔。數字全部來自 params.json；這裡的常數只有容差與取樣步長。
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from shapely.geometry import LineString, Point

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
SNAPSHOT = REPO / 'memories' / 'tainan-2026-09-12' / 'snapshot.json'
OLD_STATION = HERE.parent / 'tainan-memory-v1' / 'station-footprint.json'

ORIGIN = (120.21295, 22.99681)
KX = 111320.0 * math.cos(math.radians(ORIGIN[1]))
KY = 111320.0

# 容差與取樣步長（不是尺寸）
VERTEX_EPS = 1e-6        # 判定 d 落在折點上的容差（m）
D_MERGE = 0.25           # 兩個剖面線的 d 相差不到這個值就合併（避免 float32 下的極薄三角形；折角 5° 時最多讓折線偏 0.5 cm）
SAMPLE_STEP = 0.25       # 找「中心距 ≥ 門檻」區段時沿外側股道的取樣步長（m）
# 平台中心規則的門檻：params.station.platform.center 的說明文字寫「中心距 ≥ 10 m」，數字只在文字裡，所以這裡寫成常數
PLATFORM_CENTER_MIN_SPACING_M = 10.0


def to_world(lon, lat):
    return ((lon - ORIGIN[0]) * KX, (lat - ORIGIN[1]) * KY)


def load_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def val(node):
    """params 節點的數值（{"value": …, "label": …} 取 value）。"""
    return node['value'] if isinstance(node, dict) and 'value' in node else node


# ---------------------------------------------------------------- 折線
class Poly:
    def __init__(self, pts):
        self.pts = np.asarray(pts, dtype=float)
        v = np.diff(self.pts, axis=0)
        self.seg_len = np.hypot(v[:, 0], v[:, 1])
        if (self.seg_len <= 0).any():
            raise ValueError('折線有重複頂點')
        self.t = v / self.seg_len[:, None]
        self.cum = np.concatenate(([0.0], np.cumsum(self.seg_len)))
        self.length = float(self.cum[-1])
        self.ls = LineString(self.pts)

    def seg_index(self, d):
        i = int(np.searchsorted(self.cum, d, side='right')) - 1
        return min(max(i, 0), len(self.t) - 1)

    def point(self, d):
        d = min(max(d, 0.0), self.length)
        i = self.seg_index(d)
        return self.pts[i] + self.t[i] * (d - self.cum[i])

    def project(self, xy):
        """最近點的累計長度。"""
        return float(self.ls.project(Point(float(xy[0]), float(xy[1]))))

    def dist(self, xy):
        return float(self.ls.distance(Point(float(xy[0]), float(xy[1]))))


class Frame(Poly):
    """參考線：提供 d 位置上垂直於參考線的剖面線（rung）。"""

    def vertex_at(self, d):
        j = int(np.argmin(np.abs(self.cum - d)))
        return j if abs(self.cum[j] - d) < VERTEX_EPS else None

    @staticmethod
    def _east(t):
        return np.array([t[1], -t[0]])

    def east(self, d):
        """(向東單位向量, miter 倍率)。折點上取兩段法線的角平分線，倍率讓兩段都保持垂直距離 s。"""
        j = self.vertex_at(d)
        if j is not None and 0 < j < len(self.pts) - 1:
            e0, e1 = self._east(self.t[j - 1]), self._east(self.t[j])
            b = e0 + e1
            b = b / np.hypot(b[0], b[1])
            return b, 1.0 / float(b @ e1)
        if j is None:
            i = self.seg_index(d)
        else:
            i = 0 if j == 0 else len(self.t) - 1
        return self._east(self.t[i]), 1.0

    def tangent(self, d):
        e, _ = self.east(d)
        return np.array([-e[1], e[0]])

    def at(self, d, s=0.0):
        e, m = self.east(d)
        return self.point(d) + e * (s * m)

    def lateral(self, other, d):
        """d 處的剖面線與 other 折線的交點，回傳 s（垂直距離單位，向東為正）。"""
        e, m = self.east(d)
        base = self.point(d)
        A = other.pts[:-1]
        v = other.pts[1:] - A
        w = A - base
        den = e[0] * v[:, 1] - e[1] * v[:, 0]
        ok = np.abs(den) > 1e-12
        q = np.full(len(A), np.nan)
        u = np.full(len(A), np.nan)
        q[ok] = (w[ok, 0] * v[ok, 1] - w[ok, 1] * v[ok, 0]) / den[ok]
        u[ok] = (w[ok, 0] * e[1] - w[ok, 1] * e[0]) / den[ok]
        good = ok & (u >= -1e-9) & (u <= 1 + 1e-9)
        if not good.any():
            raise ValueError(f'd={d:.2f} 的剖面線沒有穿過另一條折線')
        k = int(np.argmin(np.where(good, np.abs(q), np.inf)))
        return float(q[k] / m)


# ---------------------------------------------------------------- 高程剖面
class Profile:
    def __init__(self, cps):
        self.cps = sorted(cps, key=lambda c: c['d'])
        for a, b in zip(self.cps, self.cps[1:]):
            if not b['d'] > a['d'] + 1e-6:
                raise ValueError(f"控制點順序錯誤：{a['id']} d={a['d']:.3f}、{b['id']} d={b['d']:.3f}")
        self.ds = np.array([c['d'] for c in self.cps])
        self.zs = np.array([c['z'] for c in self.cps])

    def z(self, d):
        return float(np.interp(d, self.ds, self.zs))

    def segments(self):
        out = []
        for a, b in zip(self.cps, self.cps[1:]):
            L = b['d'] - a['d']
            dz = b['z'] - a['z']
            out.append({'from': a['id'], 'to': b['id'], 'd0': a['d'], 'd1': b['d'], 'lengthM': L, 'dz': dz,
                        'slopePermille': 1000.0 * dz / L})
        return out


# ---------------------------------------------------------------- 尺寸（全部來自 params.json）
class Dims:
    def __init__(self, P):
        t, r, s = P['tunnel'], P['ramps'], P['station']
        pf = s['platform']
        self.tun_outer = val(t['outerWidthM'])
        self.tun_wall = val(t['wallThicknessM'])
        self.tun_inner = self.tun_outer - 2 * self.tun_wall
        self.soffit = val(t['soffitAboveTrackM'])
        self.roof_t = val(t['roofThicknessM'])
        self.base_below = val(t['baseBottomBelowTrackM'])
        self.tun_top = self.soffit + self.roof_t          # 頂板頂高於軌道面
        self.ramp_wall = val(r['wallThicknessM'])
        self.ramp_top = val(r['wallTopAboveGroundM'])
        self.ramp_inner = self.tun_inner                  # params.ramps.innerWidth：與隧道內淨寬相同
        self.ramp_outer = self.ramp_inner + 2 * self.ramp_wall
        self.st_len = val(s['lengthM'])
        self.st_inset = val(s['wallInsetFromOuterTrackM'])
        self.st_wall = val(s['wallThicknessM'])
        self.st_base_below = val(s['baseBottomBelowTrackM'])
        self.st_b1_top = val(s['b1FloorTopAboveTrackM'])
        self.st_b1_t = val(s['b1SlabThicknessM'])
        self.st_roof_top_z = val(s['roofTopZ'])
        self.pf_len = val(pf['lengthM'])
        self.pf_edge = val(pf['edgeFromTrackCenterM'])
        self.pf_top = val(pf['topAboveTrackM'])


# ---------------------------------------------------------------- 世界（所有衍生量）
class World:
    pass


def _chain(ids, ways, nodes):
    pts = [tuple(ways[ids[0]][0])]
    start, end = {}, {}
    for k, wid in enumerate(ids):
        p = ways[wid]
        if k and nodes[ids[k - 1]][-1] != nodes[wid][0]:
            raise ValueError(f'way {wid} 的第一個節點不是前一條 way 的最後一個節點')
        start[wid] = len(pts) - 1
        pts.extend(tuple(q) for q in p[1:])
        end[wid] = len(pts) - 1
    return pts, start, end


def _road_crossings(frame, feats):
    out = []
    for f in feats:
        inter = f.intersection(frame.ls)
        if inter.is_empty:
            continue
        geoms = [inter] if inter.geom_type == 'Point' else list(getattr(inter, 'geoms', []))
        for g in geoms:
            if g.geom_type != 'Point':
                raise ValueError(f'道路與參考線的交集不是點：{g.geom_type}')
            out.append({'xy': (g.x, g.y), 'd': frame.project((g.x, g.y))})
    return out


def _run_interval(loop, main, frame):
    """外側股道上「與正線中心距 ≥ 門檻」的連續段，回傳投影到參考線的 [d_lo, d_hi]（兩端用線性內插到門檻）。"""
    n = max(2, int(math.ceil(loop.length / SAMPLE_STEP)) + 1)
    ss = np.linspace(0.0, loop.length, n)
    pts = [loop.point(s) for s in ss]
    gap = np.array([main.dist(p) for p in pts])
    ds = np.array([frame.project(p) for p in pts])
    ok = gap >= PLATFORM_CENTER_MIN_SPACING_M
    if not ok.any():
        raise ValueError('外側股道與正線的中心距從沒到過門檻')
    idx = np.flatnonzero(ok)
    if (np.diff(idx) != 1).any():
        raise ValueError('中心距 ≥ 門檻的段不連續')
    i0, i1 = int(idx[0]), int(idx[-1])
    thr = PLATFORM_CENTER_MIN_SPACING_M

    def cross(ia, ib):
        ga, gb = gap[ia], gap[ib]
        t = (thr - ga) / (gb - ga)
        return float(ds[ia] + t * (ds[ib] - ds[ia]))

    a = cross(i0 - 1, i0) if i0 > 0 else float(ds[i0])
    b = cross(i1, i1 + 1) if i1 < n - 1 else float(ds[i1])
    return (a, b) if a <= b else (b, a)           # 外側股道的走向可能與參考線相反


def build_world(P, A, snapshot):
    """P＝params.json，A＝input/alignment.json，snapshot＝9/12 快照。"""
    w = World()
    w.P, w.dims = P, Dims(P)
    if tuple(snapshot['origin']) != ORIGIN:
        raise ValueError(f"快照的 origin {snapshot['origin']} 與 {ORIGIN} 不同")
    ways, nodes, tags = {}, {}, {}
    for x in A['ways']:
        ways[x['id']] = np.array([to_world(*c) for c in x['coordinates']])
        nodes[x['id']] = x['nodes']
        tags[x['id']] = x['tags']
    w.ways, w.way_tags = ways, tags
    al = P['alignment']
    ref_ids = al['referenceChain']['ways']
    pts, st, en = _chain(ref_ids, ways, nodes)
    w.ref = Frame(pts)
    w.ref_ids = ref_ids
    w.ref_range = {wid: (float(w.ref.cum[st[wid]]), float(w.ref.cum[en[wid]])) for wid in ref_ids}
    epts, _, _ = _chain(al['eastChain'], ways, nodes)
    w.east = Poly(epts)
    w.east_ids = al['eastChain']
    w.east_proj = [w.ref.project(p) for p in w.east.pts]           # 東側折點投影到參考線的 d（剖面線一定要經過這些點）
    # 隧道內的兩條正線、外側股道
    w.tun = {'west': Poly(ways[al['tunnel']['west']]), 'east': Poly(ways[al['tunnel']['east']])}
    w.loop = {'west': Poly(ways[al['stationLoops']['west']]), 'east': Poly(ways[al['stationLoops']['east']])}
    # 道路
    w.roads = {}
    for f in snapshot['features']:
        nm = f['tags'].get('name')
        if nm in ('林森地下道', '小東路', '民族路一段'):
            w.roads.setdefault(nm, []).append(LineString([to_world(*c) for c in f['coordinates']]))
    w.road_cross = {nm: _road_crossings(w.ref, fs) for nm, fs in w.roads.items()}
    for nm in ('林森地下道', '小東路', '民族路一段'):
        if not w.road_cross.get(nm):
            raise ValueError(f'參考線與「{nm}」沒有交點')
    # 站體：外側股道各自兩端的分岔點投影到參考線後的中點，再取兩條的中點
    mids = []
    w.loop_ends_d = {}
    for side in ('west', 'east'):
        lp = w.loop[side]
        a, b = w.ref.project(lp.pts[0]), w.ref.project(lp.pts[-1])
        w.loop_ends_d[side] = (a, b)
        mids.append((a + b) / 2)
    w.st_center = sum(mids) / 2
    w.st_south = w.st_center - w.dims.st_len / 2
    w.st_north = w.st_center + w.dims.st_len / 2
    # 月台中心：兩側「外側股道與正線中心距 ≥ 門檻」的段投影到參考線後的重疊部分的中點
    runs = {'west': _run_interval(w.loop['west'], w.tun['west'], w.ref),
            'east': _run_interval(w.loop['east'], w.tun['east'], w.ref)}
    lo, hi = max(runs['west'][0], runs['east'][0]), min(runs['west'][1], runs['east'][1])
    if not hi > lo:
        raise ValueError('兩側中心距 ≥ 門檻的段沒有重疊')
    w.pf_runs = runs
    w.pf_overlap = (lo, hi)
    w.pf_center = (lo + hi) / 2
    w.pf_d0 = w.pf_center - w.dims.pf_len / 2
    w.pf_d1 = w.pf_center + w.dims.pf_len / 2
    # 控制點
    cps = []
    for c in P['profile']['controlPoints']:
        a = c['anchor']
        t = a['type']
        if t == 'chainStart':
            d = 0.0
        elif t == 'chainEnd':
            d = w.ref.length
        elif t == 'wayEnd':
            lo_, hi_ = w.ref_range[a['way']]
            d = lo_ if a['end'] == 'south' else hi_
        elif t == 'roadCrossing':
            xs = w.road_cross[a['name']]
            d = float(sum(x['d'] for x in xs) / len(xs))
        elif t == 'stationEnd':
            d = w.st_south if a['end'] == 'south' else w.st_north
        else:
            raise ValueError(f'未知的錨點型別 {t}')
        cps.append({'id': c['id'], 'd': float(d), 'z': float(c['z']), 'label': c['label'], 'basis': c['basis'], 'anchor': a})
    w.profile = Profile(cps)
    w.cp = {c['id']: c for c in w.profile.cps}
    return w


# ---------------------------------------------------------------- 剖面線的 d 序列
def rung_ds(w, d0, d1, extra=()):
    """[d0, d1] 內所有需要剖面線的位置：兩端、參考線折點、東側折點的投影、控制點、extra（呼叫端指定的位置）。
    兩端、控制點、extra 優先保留；其餘的和它們（或彼此）相差不到 D_MERGE 就合併。"""
    cand = [(d0, 0), (d1, 0)]
    cand += [(float(d), 0) for d in extra if d0 + VERTEX_EPS < d < d1 - VERTEX_EPS]
    cand += [(float(d), 1) for d in w.ref.cum if d0 + VERTEX_EPS < d < d1 - VERTEX_EPS]
    cand += [(float(d), 1) for d in w.east_proj if d0 + VERTEX_EPS < d < d1 - VERTEX_EPS]
    cand += [(c['d'], 0) for c in w.profile.cps if d0 + VERTEX_EPS < c['d'] < d1 - VERTEX_EPS]
    cand.sort()
    out = []
    for d, pr in cand:
        if out and d - out[-1][0] < D_MERGE:
            if pr == 0 and out[-1][1] == 0:
                if d - out[-1][0] > VERTEX_EPS:
                    raise ValueError(f'兩個必要的剖面線太近：{out[-1][0]:.3f} 與 {d:.3f}')
                continue
            if pr == 0:
                out[-1] = (d, 0)          # 後者優先，取代前一個
            continue
        out.append((d, pr))
    return [d for d, _ in out]
