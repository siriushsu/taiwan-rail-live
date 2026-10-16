#!/usr/bin/env python3
"""檢查 build.py 的輸出（網格、淨空、地板高程、站體位置、坡度、月台、公開邊界）。

用法：python3 check.py OUT_DIR
結束碼：項目 1–6 與 8 全 PASS 才是 0；項目 7 只回報數字，不判 FAIL。

做法
- 只讀輸出檔（model.json、near.mesh.bin.gz、profile.json）、params.json、input/alignment.json、9/12 快照與舊站體外框；
  不 import build 端的 ug_core／ug_mesh，控制點的 d、站體中心（月台中心）、U 槽應有的寬度（兩股中心距從股道座標量）也在這裡另外獨立算一次
  （ug_out.py 只是讀檔工具）。
- 殼（隧道、站體）只畫外側面，內側面（淨空判斷要用）由外側面往內平移牆厚／頂板厚合成；牆厚、頂板厚讀 params.json，
  哪個三角形屬於站體、哪個屬於隧道，用 model.json 的 footprints 判斷。
- 規格給定的檢查值（車輛限界、取樣間距、坡度上限、四個停車點、容差）是下面的常數；尺寸一律讀 params.json。
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

import hashlib
import math
import subprocess
from collections import defaultdict
from pathlib import Path

import numpy as np
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.ops import unary_union
from shapely.strtree import STRtree

import ug_out as U

# ---- 檢查用的常數（規格給定，不是尺寸）----
SAMPLE_STEP_M = 5.0                 # 股道取樣間距
ENVELOPE_HALF_WIDTH_M = 1.6         # 車輛限界：軌道中心左右各 1.6 m
ENVELOPE_HEIGHT_M = 4.5             # 車輛限界：軌道面往上 4.5 m
MAX_SLOPE_PERMILLE = 25.0           # 坡度上限
FLOOR_TOL_M = 0.01                  # 地板高程與剖面 z 的容差
DIM_TOL_M = 0.005                   # 網格量到的尺寸與 params 的容差（座標最大約 5000 m，float32 解析度約 0.5 mm）
BOUNDS_TOL_M = 2e-4                 # model.json bounds 與實際網格的容差（build 往外進位到 1e-4）
MIN_TRI_AREA = 1e-6
OVERLAP_PLANE_TOL_M = 0.002         # 共面稽核：平面距離容差
OVERLAP_MIN_AREA_M2 = 1e-4          # 共面稽核：重疊面積門檻
COVER_TOL_M = 2e-3                  # 取樣點算不算「落在三角形上」的容差（座標存 float32，y 到 5000 m 時解析度約 0.5 mm）
CAND_RADIUS_M = 4.0                 # 淨空候選：離車輛限界邊緣 4 m 內的結構才算（再遠就是「≥ 4 m」）
PLATFORM_EXTENT_TOL_M = 0.5         # 月台沿參考線的範圍與 params 長度的容差
CP_D_TOL_M = 0.005                  # 獨立重算的控制點 d 與 profile.json 的容差
PLATFORM_CENTER_TOL_M = 0.05        # 月台中心（網格量到）與獨立重算的站體中心的容差
PLATFORM_END_MIN_SPACING_M = 10.0   # 月台兩端外側股道與正線的中心距下限（params.station.platform.center 的 basis 寫「≥ 10 m」，數字只在文字裡）
PLATFORM_SCAN_STEP_M = 0.1          # 量月台兩端中心距時，沿外側股道的取樣步長
ENDWALL_COVER_MIN = 0.99            # 洞口端牆覆蓋率下限
ENDWALL_BLOCK_MAX = 0.01            # 洞口開口被端牆面擋住的面積比上限
PLANE_TOL_M = 2e-3                  # 三角形算「在洞口平面上」的容差（座標存 float32）
Z_TOUCH_TOL_M = 1e-3                # 結構面的頂緣只比車輛限界底（軌道面）高出這麼多以內，算相接不算碰到
TROUGH_SCAN_STEP_M = 25.0           # U 槽沿線寬度掃描的間距
TROUGH_SCAN_MARGIN_M = 3.0          # 掃描離 U 槽兩端的距離（端面與洞口牆不在掃描範圍）
TROUGH_SCAN_TOL_M = 0.015           # 掃描的容差：剖面線之間的牆是直線，但 OSM 折點離必要剖面線不到 0.25 m 時剖面線會合併（ug_core.D_MERGE），折線最多偏約 1 cm
BUDGET = {'maxTriangles': 60000, 'maxGzipBytes': 350000, 'maxDrawGroups': 16}
# 9/12 重播頁的四個停車點（世界座標 x, y）
STOP_POINTS = [('西側正線', (28.5, -5.0)), ('西側外側股道', (17.0, -3.0)),
               ('東側正線', (32.7, -5.7)), ('東側外側股道', (43.6, -7.5))]
ALLOWED_PREFIX = 'prototypes/tiny-trains/blender/tainan-underground-v1/'
EXPECTED_FILES = {'README.md', 'build.py', 'check.py', 'crosscheck.py', 'extract_alignment.py', 'params.json', 'preview.py',
                  'preview_blender.py', 'preview_figs.py', 'ug_core.py', 'ug_materials.py', 'ug_mesh.py', 'ug_out.py', 'input/alignment.json'}


class Report:
    def __init__(self):
        self.rows = []

    def add(self, item, status, text):
        self.rows.append((item, status, text))
        print(f'[{status}] {text}', flush=True)

    def passed(self, item):
        rows = [r for r in self.rows if r[0] == item]
        return bool(rows) and all(r[1] != 'FAIL' for r in rows)


def ok_text(ok):
    return 'PASS' if ok else 'FAIL'


# ---------------------------------------------------------------- 共用幾何
def face_normals(tris):
    cr = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    L = np.linalg.norm(cr, axis=1)
    n = np.zeros_like(cr)
    good = L > 1e-12
    n[good] = cr[good] / L[good, None]
    return n, L / 2


def plan_geom(tri):
    """三角形的平面投影：有面積就是多邊形，垂直面（共線）就是線段（取最遠兩點）。"""
    p = tri[:, :2]
    poly = Polygon(p)
    if poly.area > 1e-9:
        return poly
    best, pair = -1.0, (0, 1)
    for i, j in ((0, 1), (0, 2), (1, 2)):
        d = float(np.hypot(*(p[i] - p[j])))
        if d > best:
            best, pair = d, (i, j)
    return LineString([p[pair[0]], p[pair[1]]])


def plane_z(tri, x, y):
    """三角形所在平面在 (x, y) 的 z（要求不是垂直面）。"""
    n = np.cross(tri[1] - tri[0], tri[2] - tri[0])
    return float((n @ tri[0] - n[0] * x - n[1] * y) / n[2])


# ---------------------------------------------------------------- 項目 1：網格
def audit_overlap(tris, mats):
    """共面重疊：平面距離 ≤ 容差、面積重疊 > 門檻的三角形對（含朝向相反的共面對）。回傳 {(i,j): (面積, 同朝向?)}。"""
    T = len(tris)
    n, area = face_normals(tris)
    ax = np.argmax(np.abs(n), axis=1)
    sg = np.where(n[np.arange(T), ax] < 0, -1.0, 1.0)
    nc = n * sg[:, None]
    dc = np.einsum('ij,ij->i', nc, tris[:, 0])
    pairs = {}
    for off in (0.0, 0.5):                       # 兩套量化格線，避免法線剛好落在格線邊界而被分到不同桶
        key = np.floor(nc * 1000 + off).astype(np.int64)
        buckets = defaultdict(list)
        for i in range(T):
            if area[i] > 1e-12:
                buckets[tuple(key[i])].append(i)
        for idx in buckets.values():
            if len(idx) < 2:
                continue
            idx.sort(key=lambda i: dc[i])
            groups, cur = [], [idx[0]]
            for a, b in zip(idx, idx[1:]):
                if dc[b] - dc[a] <= OVERLAP_PLANE_TOL_M:
                    cur.append(b)
                else:
                    groups.append(cur)
                    cur = [b]
            groups.append(cur)
            for g in groups:
                if len(g) < 2:
                    continue
                n0 = nc[g[0]]
                a0 = np.array([1.0, 0, 0]) if abs(n0[0]) < 0.9 else np.array([0, 1.0, 0])
                u = np.cross(n0, a0)
                u /= np.linalg.norm(u)
                v = np.cross(n0, u)
                polys = [Polygon([(float(p @ u), float(p @ v)) for p in tris[i]]) for i in g]
                tree = STRtree(polys)
                for ai, pa in enumerate(polys):
                    for bi in tree.query(pa):
                        bi = int(bi)
                        if bi <= ai:
                            continue
                        inter = pa.intersection(polys[bi]).area
                        if inter > OVERLAP_MIN_AREA_M2:
                            i, j = g[ai], g[bi]
                            pairs[(min(i, j), max(i, j))] = (float(inter), bool(sg[i] == sg[j]))
    return pairs


def item1(R, out):
    it = 1
    T = len(out.tris)
    a = out.mesh.astype(np.float64)
    pos = a[:, :3].reshape(-1, 3, 3)
    nrm = a[:, 3:].reshape(-1, 3, 3)
    finite = bool(np.isfinite(a).all())
    nlen = np.abs(np.linalg.norm(nrm, axis=2) - 1).max()
    same_n = np.abs(nrm - nrm[:, :1, :]).max()
    fn, area = face_normals(pos)
    agree = float((fn * nrm[:, 0, :]).sum(axis=1).min())
    amin = float(area.min())
    R.add(it, ok_text(finite and nlen < 1e-3 and same_n < 1e-6 and agree > 0.999 and amin >= MIN_TRI_AREA),
          f'1.1 網格品質：有限值={finite}、單位法線誤差 {nlen:.2e}、同面法線一致誤差 {same_n:.1e}、繞序與法線最小內積 {agree:.6f}、'
          f'最小三角形面積 {amin:.4f} m²（門檻 {MIN_TRI_AREA:g}）')
    lo, hi = pos.reshape(-1, 3).min(axis=0), pos.reshape(-1, 3).max(axis=0)
    nb, mb = out.near['bounds'], out.model['bounds']
    err = max(float(np.abs(np.array(nb['min']) - lo).max()), float(np.abs(np.array(nb['max']) - hi).max()))
    contains = bool((np.array(nb['min']) <= lo + 1e-9).all() and (np.array(nb['max']) >= hi - 1e-9).all())
    same = nb == mb
    R.add(it, ok_text(err <= BOUNDS_TOL_M and contains and same),
          f'1.2 bounds：model.json 與實際網格最大差 {err:.2e} m（容差 {BOUNDS_TOL_M:g}）、宣告範圍包住實際={contains}、model.bounds＝near.bounds={same}；'
          f'實際 min={np.round(lo, 3).tolist()} max={np.round(hi, 3).tolist()}')
    sha_ok = hashlib.sha256(out.raw).hexdigest() == out.near['sha256']
    counts_ok = (out.near['triangleCount'] == T and out.near['vertexCount'] == len(out.mesh) and out.near['byteLength'] == len(out.raw)
                 and out.near['gzipBytes'] == out.gz_bytes and out.near['strideBytes'] == 24)
    budget_ok = T <= BUDGET['maxTriangles'] and out.gz_bytes <= BUDGET['maxGzipBytes'] and len(out.groups) <= BUDGET['maxDrawGroups']
    R.add(it, ok_text(sha_ok and counts_ok and budget_ok and out.model['budget'] == BUDGET),
          f'1.3 預算與內容：{T} 三角形（≤{BUDGET["maxTriangles"]}）、gzip {out.gz_bytes} B（≤{BUDGET["maxGzipBytes"]}）、'
          f'drawGroups {len(out.groups)}（≤{BUDGET["maxDrawGroups"]}）；sha256 相符={sha_ok}、計數欄位相符={counts_ok}')
    gs = sorted(out.groups, key=lambda g: g['start'])
    contiguous = gs[0]['start'] == 0 and all(g['start'] + g['count'] == h['start'] for g, h in zip(gs, gs[1:])) \
        and gs[-1]['start'] + gs[-1]['count'] == len(out.mesh) and all(g['count'] % 3 == 0 and g['start'] % 3 == 0 for g in gs)
    names_ok = len({g['name'] for g in gs}) == len(gs)
    R.add(it, ok_text(contiguous and names_ok),
          f'1.4 drawGroups 連續覆蓋全部頂點、名稱不重複：{[(g["name"], g["count"] // 3) for g in gs]}')
    pairs = audit_overlap(pos, out.mat)
    cross = [(k, v) for k, v in pairs.items() if out.mat[k[0]] != out.mat[k[1]]]
    samem = [(k, v) for k, v in pairs.items() if out.mat[k[0]] == out.mat[k[1]]]
    detail = ''
    if cross:
        agg = defaultdict(lambda: [0, 0.0])
        for (i, j), (ar, sm) in cross:
            kk = tuple(sorted((out.mat[i], out.mat[j])))
            agg[kk][0] += 1
            agg[kk][1] += ar
        detail = '；不同材質重疊：' + '、'.join(f'{k[0]}×{k[1]} {v[0]} 對 {v[1]:.3f} m²' for k, v in agg.items())
    R.add(it, ok_text(not cross),
          f'1.5 共面重疊稽核（平面距離 ≤ {OVERLAP_PLANE_TOL_M} m、面積 > {OVERLAP_MIN_AREA_M2:g} m²，含朝向相反的共面對）：'
          f'不同材質 {len(cross)} 對（要 0）、同材質 {len(samem)} 對（資訊）{detail}')
    same_params = out.model['params'] == out.params and out.model['paramsSha256'] == hashlib.sha256((U.HERE / 'params.json').read_bytes()).hexdigest()
    R.add(it, ok_text(same_params), f'1.6 model.json 內的 params 與 params.json 逐欄相同、paramsSha256 相符={same_params}')


# ---------------------------------------------------------------- 剖面探針（網格量尺寸；也供剖面圖用）
def section_segments(out, d):
    """垂直於參考線、過 d 的鉛直平面切網格：回傳 {材質: [(s0, z0, s1, z1)]}，s＝相對參考線向東的橫向位置。"""
    p0 = out.ref_point(d)
    t = out.ref_tangent(d)
    east = np.array([t[1], -t[0]])
    P = out.tris
    dist = (P[:, :, :2] - p0) @ t
    if np.abs(dist).min() < 1e-6:
        return section_segments(out, d + 0.37)
    straddle = (dist.min(axis=1) < 0) & (dist.max(axis=1) > 0)
    segs = defaultdict(list)
    for i in np.flatnonzero(straddle):
        pts = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            da, db = dist[i, a], dist[i, b]
            if (da < 0) != (db < 0):
                q = P[i, a] + (P[i, b] - P[i, a]) * (da / (da - db))
                pts.append((float((q[:2] - p0) @ east), float(q[2])))
        if len(pts) == 2:
            segs[out.mat[i]].append((pts[0][0], pts[0][1], pts[1][0], pts[1][1]))
    return segs, p0, t


def horiz_extent(segs, z, tol=2e-3):
    """材質的水平線段（高程 ≈ z）聯集的橫向範圍 [(s0, s1)]（合併相連的）。"""
    iv = sorted((min(s0, s1), max(s0, s1)) for s0, z0, s1, z1 in segs if abs(z0 - z) < tol and abs(z1 - z) < tol and abs(s1 - s0) > 1e-6)
    merged = []
    for a, b in iv:
        if merged and a <= merged[-1][1] + 1e-3:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return [(a, b) for a, b in merged]


def vertical_s(segs, tol=2e-3):
    """鉛直線段的橫向位置與高程範圍：[(s, zmin, zmax)]（同一個 s 合併）。"""
    by = defaultdict(lambda: [1e9, -1e9])
    for s0, z0, s1, z1 in segs:
        if abs(s1 - s0) < tol:
            k = round((s0 + s1) / 2, 3)
            by[k][0] = min(by[k][0], z0, z1)
            by[k][1] = max(by[k][1], z0, z1)
    return sorted((k, v[0], v[1]) for k, v in by.items())


def trough_tracks(out):
    """兩條正線的折線（西側＝參考線、東側），從 input/alignment.json 的股道座標串起來；U 槽應有的寬度由它們量。"""
    ways = U.alignment_ways(out)
    al = out.params['alignment']
    return [LineString(chain_points(ways, al['referenceChain']['ways'])), LineString(chain_points(ways, al['eastChain']))]


def track_s(lines, p0, t):
    """過 p0、垂直於 t 的剖面線與各條折線的交點，回傳橫向位置 s（向東為正，原點在 p0）。"""
    east = np.array([t[1], -t[0]])
    cut = LineString([p0 - east * 30, p0 + east * 30])
    res = []
    for ls in lines:
        x = cut.intersection(ls)
        if x.is_empty or x.geom_type != 'Point':
            raise ValueError(f'剖面線與股道的交集不是一個點：{x.geom_type}')
        res.append(float((np.array([x.x, x.y]) - p0) @ east))
    return res


def item_dims(R, out):
    """網格量到的剖面尺寸對 params（隧道、U 槽、站體各一個剖面）。"""
    it = 1
    P = out.params
    val = lambda n: n['value'] if isinstance(n, dict) and 'value' in n else n
    t, rp, st = P['tunnel'], P['ramps'], P['station']
    cps = out.cp
    rows, ok_all = [], True

    def cmp(label, got, want):
        nonlocal ok_all
        good = abs(got - want) <= DIM_TOL_M
        ok_all &= good
        rows.append(f'{label} {got:.3f}（params {want:.3f}）{"" if good else " ✗"}')

    # 隧道剖面：南隧道中段
    d = (cps['south-portal']['d'] + cps['station-south']['d']) / 2
    segs, p0, tt = section_segments(out, d)
    z = out.z_of_d(d)
    wall = vertical_s(segs['ug_shell'])
    if len(wall) != 2:
        ok_all = False
        rows.append(f'隧道剖面的外牆數 {len(wall)}（應為 2）')
    else:
        cmp('隧道外寬', wall[1][0] - wall[0][0], val(t['outerWidthM']))
        cmp('隧道牆底低於軌道面', z - wall[0][1], val(t['baseBottomBelowTrackM']))
        cmp('隧道頂板頂高於軌道面', wall[0][2] - z, val(t['soffitAboveTrackM']) + val(t['roofThicknessM']))
    fl = horiz_extent(segs['ug_floor'], z)
    if len(fl) != 1:
        ok_all = False
        rows.append(f'隧道地板段數 {len(fl)}（應為 1，高程 {z:.3f}）')
    else:
        cmp('隧道地板寬（內淨寬）', fl[0][1] - fl[0][0], val(t['outerWidthM']) - 2 * val(t['wallThicknessM']))
        if len(wall) == 2:
            cmp('地板中心對外牆中心的偏差（應 0）', (fl[0][0] + fl[0][1]) / 2 - (wall[0][0] + wall[1][0]) / 2, 0.0)
    # U 槽剖面：南引道中段。內淨寬＝該處兩股中心距（從股道座標另外量）＋兩側各 wallInsetFromTrackM
    d = (cps['south-cut-outer']['d'] + cps['south-portal']['d']) / 2
    segs, p0, tt = section_segments(out, d)
    z = out.z_of_d(d)
    wv = vertical_s(segs['ug_trough'])
    s_w, s_e = track_s(trough_tracks(out), p0, tt)
    inset = val(rp['wallInsetFromTrackM'])
    inner_w = (s_e - s_w) + 2 * inset
    outer_w = inner_w + 2 * val(rp['wallThicknessM'])
    if len(wv) != 4:
        ok_all = False
        rows.append(f'U 槽剖面的牆面數 {len(wv)}（應為 4：兩側各內外面）')
    else:
        cmp(f'U 槽外寬（內寬＋2×牆厚 {val(rp["wallThicknessM"]):g}）', wv[3][0] - wv[0][0], outer_w)
        cmp(f'U 槽內寬（兩股中心距 {s_e - s_w:.3f} ＋ 2×{inset:g}）', wv[2][0] - wv[1][0], inner_w)
        cmp('西內牆離西正線中心（wallInsetFromTrackM）', s_w - wv[1][0], inset)
        cmp('東內牆離東正線中心（wallInsetFromTrackM）', wv[2][0] - s_e, inset)
        cmp('U 槽牆頂（地面＋wallTopAboveGroundM）', wv[0][2], val(rp['wallTopAboveGroundM']))
        cmp('U 槽牆底低於軌道面', z - wv[0][1], val(t['baseBottomBelowTrackM']))
    tf = horiz_extent(segs['ug_trough_floor'], z)
    if len(tf) == 1:
        cmp('U 槽地板寬', tf[0][1] - tf[0][0], inner_w)
    else:
        ok_all = False
        rows.append(f'U 槽地板段數 {len(tf)}（應為 1）')
    # 站體剖面：月台中心
    dc = out.profile['derived']['platform']['centerD']
    segs, p0, tt = section_segments(out, dc)
    z0 = out.z_of_d(dc)
    wv = vertical_s(segs['ug_shell'])
    if len(wv) < 2:
        ok_all = False
        rows.append(f'站體剖面的外牆數 {len(wv)}')
    else:
        cmp('站體外牆底低於軌道面', z0 - min(v[1] for v in wv), val(st['baseBottomBelowTrackM']))
        cmp('站體頂板頂高程', max(v[2] for v in wv), val(st['roofTopZ']))
    cmp('站體地板高程', out.z_of_d(dc), z0)
    b1 = segs['ug_b1']
    top = horiz_extent(b1, z0 + val(st['b1FloorTopAboveTrackM']))
    bot = horiz_extent(b1, z0 + val(st['b1FloorTopAboveTrackM']) - val(st['b1SlabThicknessM']))
    ok_all &= len(top) == 1 and len(bot) == 1
    rows.append(f'B1 樓板上緣 z={z0 + val(st["b1FloorTopAboveTrackM"]):.3f}、下緣 z={z0 + val(st["b1FloorTopAboveTrackM"]) - val(st["b1SlabThicknessM"]):.3f}'
                f'（上、下段數 {len(top)}、{len(bot)}）')
    pt = horiz_extent(segs['ug_platform'], z0 + val(st['platform']['topAboveTrackM']))
    ok_all &= len(pt) == 2
    rows.append(f'月台頂高 z={z0 + val(st["platform"]["topAboveTrackM"]):.3f}、頂面段數 {len(pt)}（應為 2）、橫向寬 '
                + '、'.join(f'{b - a:.3f}' for a, b in pt))
    R.add(it, ok_text(ok_all), '1.7 剖面尺寸對 params（網格切面實量）：' + '；'.join(rows))


# ---------------------------------------------------------------- 洞口端牆、U 槽沿線寬度
def portal_plane(out, d):
    """洞口平面：回傳 (參考線上 d 點, 平面法向（沿參考線的水平單位向量）, 平面內向東的單位向量)。
    d 剛好落在參考線折點時（洞口在 way 的端點），平面垂直於前後兩段方向的角平分線，建模的剖面線也是這樣切。"""
    j = int(np.argmin(np.abs(out.ref_d - d)))
    if abs(out.ref_d[j] - d) < 5e-3 and 0 < j < len(out.ref_d) - 1:
        t0, t1 = out.ref_xy[j] - out.ref_xy[j - 1], out.ref_xy[j + 1] - out.ref_xy[j]
        n = t0 / np.hypot(*t0) + t1 / np.hypot(*t1)
        n = n / np.hypot(*n)
        p0 = out.ref_xy[j]
    else:
        p0, n = out.ref_point(d), out.ref_tangent(d)
    return p0, n, np.array([n[1], -n[0]])


def item_endwall(R, out):
    """洞口端牆覆蓋率：洞口平面上「隧道外框（外寬 × 箱底到頂板頂）扣掉開口（U 槽內淨寬 × 軌道面到頂板底）」
    被朝向 U 槽的 ug_trough 面蓋到的面積比例；另量開口被 ug_trough 面擋住的面積比例。
    外框與開口的尺寸讀 params；開口的左右邊界由該處兩股中心距（股道座標另外量）加 wallInsetFromTrackM 算出。"""
    P = out.params
    val = lambda n: n['value'] if isinstance(n, dict) and 'value' in n else n
    tn, rp = P['tunnel'], P['ramps']
    ow, below, soffit, roof_t = val(tn['outerWidthM']), val(tn['baseBottomBelowTrackM']), val(tn['soffitAboveTrackM']), val(tn['roofThicknessM'])
    inset = val(rp['wallInsetFromTrackM'])
    tracks = trough_tracks(out)
    idx = [i for i in range(len(out.tris)) if out.mat[i] == 'ug_trough']
    msgs, ok_all = [], True
    for label, pid, toward in (('南洞口', 'south-portal', -1.0), ('北洞口', 'north-portal', 1.0)):
        d, zp = out.cp[pid]['d'], out.cp[pid]['z']
        p0, n, e = portal_plane(out, d)
        s_w, s_e = track_s(tracks, p0, n)
        mid = (s_w + s_e) / 2
        outer = box(mid - ow / 2, zp - below, mid + ow / 2, zp + soffit + roof_t)
        opening = box(s_w - inset, zp, s_e + inset, zp + soffit)
        region = outer.difference(opening)
        polys = []
        for i in idx:
            tri = out.tris[i]
            if np.abs((tri[:, :2] - p0) @ n).max() > PLANE_TOL_M:
                continue                                              # 不在洞口平面上
            if float(out.nrm[i][:2] @ n) * toward < 0.99:
                continue                                              # 不是朝向 U 槽
            polys.append(Polygon([(float((q[:2] - p0) @ e), float(q[2])) for q in tri]))
        u = unary_union(polys) if polys else Polygon()
        cover = u.intersection(region).area / region.area
        block = u.intersection(opening).area / opening.area
        ok = cover >= ENDWALL_COVER_MIN and block <= ENDWALL_BLOCK_MAX
        ok_all &= ok
        msgs.append(f'{label}（d={d:.2f}，z={zp:g}）：覆蓋 {100 * cover:.2f}%（區域 {region.area:.2f} m²＝外框 {outer.area:.2f} 扣開口 {opening.area:.2f}，'
                    f'開口寬 {s_e - s_w + 2 * inset:.3f} m；朝向 U 槽的面 {len(polys)} 個）、開口被擋 {100 * block:.3f}%{"" if ok else " ✗"}')
    R.add(1, ok_text(ok_all), f'1.8 洞口端牆覆蓋率（洞口平面上隧道外框扣掉開口，被朝向 U 槽的 ug_trough 面蓋到的比例，要 ≥ {100 * ENDWALL_COVER_MIN:g}%；'
                              f'開口被擋住的比例要 ≤ {100 * ENDWALL_BLOCK_MAX:g}%）：' + '；'.join(msgs))


def item_trough_scan(R, out):
    """U 槽寬度沿線掃描：南北兩段每 TROUGH_SCAN_STEP_M 量一個剖面（離兩端各 TROUGH_SCAN_MARGIN_M 以內不量）。
    每個剖面量牆面的橫向位置，對照「兩股中心距（股道座標另外量）＋2×wallInsetFromTrackM」，並對 model.json 的 footprints（外框）與 cutouts（內側）。"""
    P = out.params
    val = lambda n: n['value'] if isinstance(n, dict) and 'value' in n else n
    inset, rwall = val(P['ramps']['wallInsetFromTrackM']), val(P['ramps']['wallThicknessM'])
    tracks = trough_tracks(out)
    fps = {f['id']: Polygon(f['ring']) for f in out.model['footprints']}
    cuts = {c['id']: Polygon(c['ring']) for c in out.model['cutouts']}
    cp = out.cp
    spans = (('南', 'trough-south', cp['south-cut-outer']['d'], cp['south-portal']['d']),
             ('北', 'trough-north', cp['north-portal']['d'], cp['north-cut-outer']['d']))
    msgs, ok_all = [], True
    for label, fid, d0, d1 in spans:
        ds = np.arange(d0 + TROUGH_SCAN_MARGIN_M, d1 - TROUGH_SCAN_MARGIN_M + 1e-9, TROUGH_SCAN_STEP_M)
        inner, worst, bad = [], 0.0, 0
        for d in ds:
            segs, p0, tt = section_segments(out, float(d))
            wv = vertical_s(segs['ug_trough'])
            if len(wv) != 4:
                bad += 1
                continue
            s_w, s_e = track_s(tracks, p0, tt)
            want_in = (s_e - s_w) + 2 * inset
            east = np.array([tt[1], -tt[0]])
            cut = LineString([p0 - east * 30, p0 + east * 30])

            def extent(poly):
                g = poly.intersection(cut)
                cs = np.array([c for ls in (g.geoms if hasattr(g, 'geoms') else [g]) for c in ls.coords])
                s_ = (cs - p0) @ east
                return float(s_.min()), float(s_.max())

            fa, fb = extent(fps[fid])
            ca, cb = extent(cuts[fid + '-inner'])
            devs = [wv[2][0] - wv[1][0] - want_in, wv[3][0] - wv[0][0] - (want_in + 2 * rwall),
                    s_w - wv[1][0] - inset, wv[2][0] - s_e - inset,
                    fa - wv[0][0], fb - wv[3][0], ca - wv[1][0], cb - wv[2][0]]
            worst = max(worst, max(abs(x) for x in devs))
            inner.append(wv[2][0] - wv[1][0])
        good = bad == 0 and len(inner) > 0 and worst <= TROUGH_SCAN_TOL_M
        ok_all &= good
        msgs.append(f'{label}段（d={d0:.0f}～{d1:.0f}）{len(inner)} 個剖面：內淨寬 {min(inner):.3f}～{max(inner):.3f} m、最大偏差 {1000 * worst:.2f} mm'
                    f'{"" if bad == 0 else "，牆面數不是 4 的剖面 %d 個" % bad}{"" if good else " ✗"}' if inner else f'{label}段沒有量到剖面 ✗')
    R.add(1, ok_text(ok_all), f'1.9 U 槽寬度沿線掃描（每 {TROUGH_SCAN_STEP_M:g} m 一個剖面）：內牆離最近股道中心＝wallInsetFromTrackM {inset:g} m、內寬＝兩股中心距＋2×{inset:g}、'
                              f'外寬＝內寬＋2×牆厚 {rwall:g}，且 footprints 外框與 cutouts 內側的寬度、位置與牆面相符（容差 {1000 * TROUGH_SCAN_TOL_M:g} mm）：' + '；'.join(msgs))


# ---------------------------------------------------------------- 股道取樣
def chain_points(ways, ids):
    return np.vstack([ways[i] if k == 0 else ways[i][1:] for k, i in enumerate(ids)])


def sample_tracks(out):
    """回傳 {軌道名: [(x, y, z, d)]}：兩條正線（南引道外端到北引道外端）＋兩條外側股道（整條）。z 取自 profile.json。"""
    ways = U.alignment_ways(out)
    al = out.params['alignment']
    d_lo, d_hi = out.cp['south-cut-outer']['d'], out.cp['north-cut-outer']['d']
    tracks = {}
    for name, pts in (('西正線', chain_points(ways, al['referenceChain']['ways'])), ('東正線', chain_points(ways, al['eastChain'])),
                      ('西外側', ways[al['stationLoops']['west']]), ('東外側', ways[al['stationLoops']['east']])):
        rows = []
        for x, y, s in U.sample_polyline(pts, SAMPLE_STEP_M):
            d = out.project_d((x, y))
            if name in ('西正線', '東正線') and not (d_lo - 1e-6 <= d <= d_hi + 1e-6):
                continue
            rows.append((x, y, out.z_of_d(d), d))
        tracks[name] = rows
    return tracks


# ---------------------------------------------------------------- 項目 2：淨空
def collect_obstacles(out):
    """回傳 (lateral, ceilings)。lateral＝[(平面幾何, zmin, zmax, 類別)]；ceilings＝[(3x3 頂點, 類別)]（朝下的天花面）。
    殼只有外側面：牆往內平移牆厚、隧道頂板往下平移頂板厚，合成內側面。"""
    P = out.params
    val = lambda n: n['value'] if isinstance(n, dict) and 'value' in n else n
    wall_tun, roof_tun = val(P['tunnel']['wallThicknessM']), val(P['tunnel']['roofThicknessM'])
    wall_st = val(P['station']['wallThicknessM'])
    fps = {f['id']: f for f in out.model['footprints']}
    st_poly = Polygon(fps['station']['ring'])
    lateral, ceilings = [], []
    fn, _ = face_normals(out.tris)
    for i, tri in enumerate(out.tris):
        m, n = out.mat[i], fn[i]
        vertical = abs(n[2]) < 1e-3
        if m in ('ug_floor', 'ug_trough_floor'):
            continue
        if m == 'ug_shell':
            c = tri.mean(axis=0)
            on_station = st_poly.exterior.distance(Point(c[0], c[1])) <= 1e-3
            if vertical:
                t = wall_st if on_station else wall_tun
                inner = tri - n * t
                lateral.append((plan_geom(inner), float(inner[:, 2].min()), float(inner[:, 2].max()),
                                '站體牆內面' if on_station else '隧道牆內面'))
            elif n[2] > 0.9:
                if st_poly.contains(Point(c[0], c[1])):
                    ceilings.append((tri.copy(), '站體頂板（只有外側頂面）'))
                else:
                    t3 = tri.copy()
                    t3[:, 2] -= roof_tun
                    ceilings.append((t3, '隧道頂板內面'))
        elif m == 'ug_b1':
            if n[2] < -0.9:
                ceilings.append((tri.copy(), 'B1 樓板下緣'))
        elif m == 'ug_trough':
            if vertical:
                lateral.append((plan_geom(tri), float(tri[:, 2].min()), float(tri[:, 2].max()), 'U 槽牆面'))
            elif n[2] < -0.9:
                ceilings.append((tri.copy(), '洞口牆底面'))
        elif m == 'ug_platform':
            lateral.append((plan_geom(tri), float(tri[:, 2].min()), float(tri[:, 2].max()), '月台'))
    return lateral, ceilings


def item2_3(R, out, tracks):
    lateral, ceilings = collect_obstacles(out)
    lat_tree = STRtree([g for g, *_ in lateral])
    lat_zt = [out.z_of_xy((g.centroid.x, g.centroid.y)) for g, *_ in lateral]          # 結構所在位置的軌道面高程（profile.json）
    cei_polys = [Polygon(t[:, :2]) for t, _ in ceilings]
    cei_tree = STRtree(cei_polys)
    best_lat = {}                 # 類別 → (淨空, 軌道, d)
    best_vert = {}
    n_seg = 0
    for name, rows in tracks.items():
        for (xa, ya, za, da), (xb, yb, zb, db) in zip(rows, rows[1:]):
            seg = LineString([(xa, ya), (xb, yb)])
            if seg.length < 1e-6:
                continue
            n_seg += 1
            for gi in lat_tree.query(seg.buffer(ENVELOPE_HALF_WIDTH_M + CAND_RADIUS_M)):
                g, gz0, gz1, cls = lateral[int(gi)]
                zt = lat_zt[int(gi)]
                # 車輛限界在結構那裡的高度範圍＝結構所在位置的軌道面高程往上 ENVELOPE_HEIGHT_M（不用取樣線兩端的高程範圍：
                # 洞口端牆的底帶頂緣剛好在軌道面，橫過股道，用取樣線兩端的高程在斜坡上會誤判成相交）
                if gz1 < zt + Z_TOUCH_TOL_M or gz0 > zt + ENVELOPE_HEIGHT_M:
                    continue
                c = seg.distance(g) - ENVELOPE_HALF_WIDTH_M
                if cls not in best_lat or c < best_lat[cls][0]:
                    best_lat[cls] = (c, name, da)
        # 頂部淨空：包絡頂面上的取樣點（軌道取樣點，橫向 −1.6／0／+1.6 m）到天花面的鉛直距離
        pts = rows
        for k, (x, y, z, d) in enumerate(pts):
            k2 = min(k + 1, len(pts) - 1)
            k1 = max(k - 1, 0)
            tv = np.array([pts[k2][0] - pts[k1][0], pts[k2][1] - pts[k1][1]])
            if np.hypot(*tv) < 1e-9:
                continue
            tv /= np.hypot(*tv)
            nv = np.array([-tv[1], tv[0]])
            for off in (-ENVELOPE_HALF_WIDTH_M, 0.0, ENVELOPE_HALF_WIDTH_M):
                qx, qy = x + nv[0] * off, y + nv[1] * off
                q = Point(qx, qy)
                for ci in cei_tree.query(q.buffer(COVER_TOL_M)):
                    tri, cls = ceilings[int(ci)]
                    if cei_polys[int(ci)].distance(q) > COVER_TOL_M:
                        continue
                    c = plane_z(tri, qx, qy) - (z + ENVELOPE_HEIGHT_M)
                    if cls not in best_vert or c < best_vert[cls][0]:
                        best_vert[cls] = (c, name, d)
    all_lat = min((v[0] for v in best_lat.values()), default=float('inf'))
    all_vert = min((v[0] for v in best_vert.values()), default=float('inf'))
    fmt = lambda dct: '、'.join(f'{k} {v[0]:.3f} m（{v[1]} d={v[2]:.0f}）' for k, v in sorted(dct.items(), key=lambda kv: kv[1][0]))
    R.add(2, ok_text(all_lat > 0 and all_vert > 0 and n_seg > 0),
          f'2.1 車輛限界（軌道中心 ±{ENVELOPE_HALF_WIDTH_M} m、軌道面 +0～{ENVELOPE_HEIGHT_M} m）沿 {len(tracks)} 條軌道每 {SAMPLE_STEP_M:g} m 取樣（{n_seg} 段）'
          f'都不碰牆／頂板／月台：最小側向淨空 {all_lat:.3f} m、最小頂部淨空 {all_vert:.3f} m')
    R.add(2, 'INFO', f'2.2 側向淨空依結構類別的最小值（超過 {CAND_RADIUS_M:g} m 的結構不列）：{fmt(best_lat)}')
    R.add(2, 'INFO', f'2.3 頂部淨空依結構類別的最小值：{fmt(best_vert)}')

    # 項目 3：地板高程
    floors = [(i, Polygon(out.tris[i][:, :2])) for i in range(len(out.tris)) if out.mat[i] in ('ug_floor', 'ug_trough_floor')]
    floors = [(i, p) for i, p in floors if p.area > 1e-9]
    ftree = STRtree([p for _, p in floors])
    worst_dz, n_pts, missing = 0.0, 0, []
    where = None
    for name, rows in tracks.items():
        for x, y, z, d in rows:
            n_pts += 1
            pt = Point(x, y)
            zs = []
            for k in ftree.query(pt.buffer(COVER_TOL_M)):
                i, p = floors[int(k)]
                if p.distance(pt) <= COVER_TOL_M:
                    zs.append(plane_z(out.tris[i], x, y))
            if not zs:
                missing.append((name, d))
                continue
            dz = max(abs(zz - z) for zz in zs)
            if dz > worst_dz:
                worst_dz, where = dz, (name, d, z, zs)
    R.add(3, ok_text(not missing and worst_dz <= FLOOR_TOL_M and n_pts > 0),
          f'3.1 地板網格在 {n_pts} 個取樣點的高程與 profile 的最大差 {worst_dz * 1000:.2f} mm（容差 {FLOOR_TOL_M * 1000:g} mm）；'
          f'沒有地板蓋到的取樣點 {len(missing)} 個' + (f'（{missing[:3]}）' if missing else ''))
    # 控制點處的網格地板高程：每個控制點 d 在參考線上的點（以一條正線的軌道點代表）直接量
    return best_lat, best_vert


# ---------------------------------------------------------------- 項目 4、5：站體位置、坡度、控制點獨立重算
def station_center_from_loops(ways, al, ref_ls):
    """站體中心的 d：兩條外側股道（stationLoops）各自兩端的分岔點投影到參考線後的中點，再取兩條的中點。"""
    mids = []
    for side in ('west', 'east'):
        lp = ways[al['stationLoops'][side]]
        mids.append((ref_ls.project(Point(*lp[0])) + ref_ls.project(Point(*lp[-1]))) / 2)
    return float(sum(mids) / 2)


def independent_control_points(out):
    """另外獨立算一次每個控制點的 d：串接參考線 ways、算累計長度，roadCrossing 用快照道路與參考線的交點，站端用外側股道兩端分岔點。"""
    P = out.params
    al = P['alignment']
    ways = U.alignment_ways(out)
    ids = al['referenceChain']['ways']
    pts = chain_points(ways, ids)
    ls = LineString(pts)
    lens = [LineString(ways[i]).length for i in ids]
    starts = np.concatenate(([0.0], np.cumsum(lens)))
    way_d = {i: (float(starts[k]), float(starts[k + 1])) for k, i in enumerate(ids)}
    snap = U.load_json(U.SNAPSHOT)
    roads = defaultdict(list)
    for f in snap['features']:
        nm = f['tags'].get('name')
        if nm in ('林森地下道', '小東路', '民族路一段'):
            roads[nm].append(LineString([out.proj(*c) for c in f['coordinates']]))

    def crossings(name):
        ds = []
        for r in roads[name]:
            inter = r.intersection(ls)
            if inter.is_empty:
                continue
            for g in (inter.geoms if hasattr(inter, 'geoms') else [inter]):
                ds.append(float(ls.project(g)))
        return sorted(ds)

    val = lambda n: n['value'] if isinstance(n, dict) and 'value' in n else n
    center = station_center_from_loops(ways, al, ls)
    half = val(P['station']['lengthM']) / 2
    res = {}
    for c in P['profile']['controlPoints']:
        a = c['anchor']
        if a['type'] == 'chainStart':
            d = 0.0
        elif a['type'] == 'chainEnd':
            d = float(ls.length)
        elif a['type'] == 'wayEnd':
            d = way_d[a['way']][0 if a['end'] == 'south' else 1]
        elif a['type'] == 'roadCrossing':
            xs = crossings(a['name'])
            d = float(sum(xs) / len(xs))
        else:
            d = center - half if a['end'] == 'south' else center + half
        res[c['id']] = d
    return res, {nm: crossings(nm) for nm in roads}, pts, float(ls.length)


def item4_5(R, out):
    ind, roads, ref_pts, ref_len = independent_control_points(out)
    diffs = {k: abs(out.cp[k]['d'] - v) for k, v in ind.items()}
    ref_ok = np.abs(out.ref_xy - ref_pts).max() <= 1.5e-3 and abs(out.profile['reference']['lengthM'] - ref_len) <= 1.5e-3
    R.add(5, ok_text(max(diffs.values()) <= CP_D_TOL_M and ref_ok),
          f'5.1 控制點 d 另外獨立重算：最大差 {max(diffs.values()) * 1000:.2f} mm（{max(diffs, key=diffs.get)}）、'
          f'參考線座標與長度相符={ref_ok}（長度 {ref_len:.3f} m）')
    cps = sorted(out.profile['controlPoints'], key=lambda c: c['d'])
    rows, worst = [], 0.0
    for a, b in zip(cps, cps[1:]):
        sl = 1000 * (b['z'] - a['z']) / (b['d'] - a['d'])
        worst = max(worst, abs(sl))
        rows.append(f'{a["id"]}→{b["id"]} d {a["d"]:.1f}→{b["d"]:.1f}（{b["d"] - a["d"]:.1f} m）Δz {b["z"] - a["z"]:+.1f} 坡度 {sl:+.3f}‰')
    prof_slopes = {(s['from'], s['to']): s['slopePermille'] for s in out.profile['segments']}
    consistent = all(abs(prof_slopes[(a['id'], b['id'])] - 1000 * (b['z'] - a['z']) / (b['d'] - a['d'])) < 2e-3 for a, b in zip(cps, cps[1:]))
    R.add(5, ok_text(worst <= MAX_SLOPE_PERMILLE and consistent),
          f'5.2 每段坡度都 ≤ {MAX_SLOPE_PERMILLE:g}‰：最大 {worst:.3f}‰；profile.json 的 segments 與重算一致={consistent}')
    for r in rows:
        R.add(5, 'INFO', '    ' + r)
    # 項目 4：站端在民族路一段與小東路交點之間
    fps = {f['id']: f for f in out.model['footprints']}
    ring = np.array(fps['station']['ring'])
    ds = [out.project_d(p) for p in ring]
    ds_lo, ds_hi = min(ds), max(ds)
    mz, xd = roads['民族路一段'], roads['小東路']
    south_ok = ds_lo > max(mz)
    north_ok = ds_hi < min(xd)
    der = out.profile['derived']['station']
    ext_ok = abs(ds_lo - der['southD']) < 0.05 and abs(ds_hi - der['northD']) < 0.05
    R.add(4, ok_text(south_ok and north_ok and ext_ok),
          f'4.1 站體外框沿參考線 d={ds_lo:.2f}～{ds_hi:.2f}（profile.json 站端 {der["southD"]}～{der["northD"]}，相符={ext_ok}）：'
          f'南端離民族路一段交點（d={max(mz):.2f}）{ds_lo - max(mz):+.2f} m、北端離小東路最近交點（d={min(xd):.2f}）{min(xd) - ds_hi:+.2f} m；'
          f'民族路一段交點 {len(mz)} 個、小東路交點 {len(xd)} 個（d={[round(v, 1) for v in xd]}）')
    return roads


# ---------------------------------------------------------------- 項目 6：月台
def independent_station_center(out):
    """月台中心＝站體中心，另外獨立算一次：由兩條外側股道（stationLoops）各自兩端的端點算出
    （params.station.platform.center 與 station.placement 的規則）。"""
    al = out.params['alignment']
    ways = U.alignment_ways(out)
    ref = LineString(chain_points(ways, al['referenceChain']['ways']))
    return station_center_from_loops(ways, al, ref)


def platform_end_spacing(out, poly, d_ends):
    """一座月台兩端（沿參考線的 d）的外側股道與同側正線的中心距。月台屬於哪一側，看它離哪一條外側股道比較近。
    回傳 (側, [各個 d 的中心距])。外側股道每 PLATFORM_SCAN_STEP_M 取樣、投影到參考線，在樣點之間內插。"""
    al = out.params['alignment']
    ways = U.alignment_ways(out)
    ref = LineString(chain_points(ways, al['referenceChain']['ways']))
    loops = {s: LineString(ways[al['stationLoops'][s]]) for s in ('west', 'east')}
    side = min(loops, key=lambda s: poly.distance(loops[s]))
    loop, main = loops[side], LineString(ways[al['tunnel'][side]])
    n = int(math.ceil(loop.length / PLATFORM_SCAN_STEP_M)) + 1
    pts = [loop.interpolate(float(s_)) for s_ in np.linspace(0.0, loop.length, n)]
    ds = np.array([ref.project(q) for q in pts])
    gap = np.array([main.distance(q) for q in pts])
    o = np.argsort(ds)
    return side, [float(np.interp(d, ds[o], gap[o])) for d in d_ends]


def platform_polys(out):
    P = out.tris
    fn, _ = face_normals(P)
    idx = [i for i in range(len(P)) if out.mat[i] == 'ug_platform' and fn[i][2] > 0.9]
    u = unary_union([Polygon(P[i][:, :2]) for i in idx]).buffer(0)
    polys = [g for g in (u.geoms if hasattr(u, 'geoms') else [u]) if g.area > 1.0]
    tops = sorted({round(float(P[i][:, 2].mean()), 3) for i in idx})
    return sorted(polys, key=lambda g: g.centroid.x), tops


def cross_section_width(out, poly, d):
    p0 = out.ref_point(d)
    t = out.ref_tangent(d)
    e = np.array([t[1], -t[0]])
    line = LineString([p0 - e * 60, p0 + e * 60])
    inter = poly.intersection(line)
    return float(inter.length)


def item6(R, out):
    polys, tops = platform_polys(out)
    pf = out.profile['derived']['platform']
    pc = independent_station_center(out)
    plen_params = out.params['station']['platform']['lengthM']['value']
    names = {}
    for f in out.model['footprints']:
        if f['kind'] == 'platform':
            fp = Polygon(f['ring'])
            for k, p in enumerate(polys):
                if p.intersection(fp).area / max(p.area, 1e-9) > 0.9:
                    names[k] = f['name']
    info = []
    ext_ok = len(polys) == 2
    plen = {}
    for k, p in enumerate(polys):
        ds = [out.project_d(q) for q in p.exterior.coords]
        d0, d1 = min(ds), max(ds)
        ws = [cross_section_width(out, p, d) for d in np.arange(d0 + 0.05, d1 - 0.05, 1.0)]
        plen[k] = (d0, d1, min(ws), max(ws))
        ok_k = abs(d0 - pf['d0']) <= PLATFORM_EXTENT_TOL_M and abs(d1 - pf['d1']) <= PLATFORM_EXTENT_TOL_M \
            and abs((d1 - d0) - plen_params) <= PLATFORM_EXTENT_TOL_M \
            and abs((d0 + d1) / 2 - pc) <= PLATFORM_CENTER_TOL_M
        ext_ok &= ok_k
        info.append(f'{names.get(k, "月台" + str(k + 1))}：寬 {min(ws):.3f}～{max(ws):.3f} m（{len(ws)} 個剖面）、沿參考線 d={d0:.2f}～{d1:.2f}'
                    f'（長 {d1 - d0:.2f} m，params {plen_params}，中心 {(d0 + d1) / 2:.2f}，獨立重算的站體中心 {pc:.2f}（容差 {PLATFORM_CENTER_TOL_M:g}），profile.json {pf["centerD"]}）{"" if ok_k else " ✗"}')
    R.add(6, ok_text(ext_ok), '6.1 月台寬度與沿參考線範圍（網格頂面量；月台中心＝由外側股道端點獨立重算的站體中心）：' + '；'.join(info))
    # 停車點
    rows = []
    for label, (x, y) in STOP_POINTS:
        d = out.project_d((x, y))
        best = None
        for k, p in enumerate(polys):
            dist = p.distance(Point(x, y))
            if best is None or dist < best[1]:
                best = (k, dist)
        k, dist = best
        d0, d1 = plen[k][0], plen[k][1]
        inside = d0 <= d <= d1
        end_gap = min(d - d0, d1 - d)
        rows.append(f'{label} ({x}, {y}) d={d:.2f} → 最近的 {names.get(k, "月台" + str(k + 1))}（平面距 {dist:.2f} m）：'
                    f'{"在範圍內" if inside else "在範圍外"}，離最近一端 {end_gap:+.2f} m（離南端 {d - d0:+.2f}、離北端 {d1 - d:+.2f}）')
    R.add(6, 'INFO', '6.2 四個停車點與月台：' + '；'.join(rows))
    # 月台兩端：外側股道與正線的中心距都要 ≥ 下限（量法與月台中心無關：外側股道取樣、投影到參考線、內插）
    sp_rows, sp_ok = [], len(plen) == 2
    for k, p in enumerate(polys):
        side, gaps = platform_end_spacing(out, p, (plen[k][0], plen[k][1]))
        good = all(g >= PLATFORM_END_MIN_SPACING_M for g in gaps)
        sp_ok &= good
        sp_rows.append(f'{names.get(k, "月台" + str(k + 1))}（{"西" if side == "west" else "東"}側）南端 d={plen[k][0]:.2f} 中心距 {gaps[0]:.3f} m、'
                       f'北端 d={plen[k][1]:.2f} 中心距 {gaps[1]:.3f} m{"" if good else " ✗"}')
    R.add(6, ok_text(sp_ok), f'6.3 月台兩端外側股道與同側正線的中心距都 ≥ {PLATFORM_END_MIN_SPACING_M:g} m：' + '；'.join(sp_rows))
    return polys


# ---------------------------------------------------------------- 項目 7：只回報
def wall_lines(out, ring):
    """U 槽外框上的外牆線：外環扣掉兩條端面邊（兩端點的 d 幾乎相同；外牆邊的兩端是相鄰兩條剖面線，d 至少差 0.25 m）。"""
    edges = []
    for p, q in zip(ring, ring[1:] + ring[:1]):
        if abs(out.project_d(p) - out.project_d(q)) < 0.05:
            continue
        edges.append(LineString([p, q]))
    return edges


def item7(R, out, polys):
    snap = U.load_json(U.SNAPSHOT)
    rails = [(r['id'], r['tags'].get('name', ''), LineString([out.proj(*c) for c in r['coordinates']])) for r in snap['rails']]
    fps = {f['id']: f for f in out.model['footprints']}
    msgs = []
    for fid in ('trough-south', 'trough-north'):
        ring = fps[fid]['ring']
        poly = Polygon(ring)
        pts, total = [], 0.0
        for e in wall_lines(out, ring):
            n = max(2, int(math.ceil(e.length / 0.5)) + 1)
            pts += [e.interpolate(t, normalized=True) for t in np.linspace(0, 1, n)]
            total += e.length
        step = total / max(len(pts), 1)
        dm = np.array([[float(Point(p).distance(ls)) for _, _, ls in rails] for p in pts])
        near = dm.min(axis=1)
        arg = dm.argmin(axis=1)
        dd = np.array([out.project_d((p.x, p.y)) for p in pts])
        k = int(near.argmin())
        within = near < 2.5
        ids = sorted({rails[int(a)][0] for a in arg[within]})
        crossing = [(rid, round(poly.intersection(ls).length, 1)) for rid, nm, ls in rails if poly.intersection(ls).length > 0.01]
        txt = (f'{fid}（d={dd.min():.0f}～{dd.max():.0f}）：外牆線到 rails 中心線最近 {near[k]:.2f} m（d={dd[k]:.0f}，way {rails[int(arg[k])][0]} {rails[int(arg[k])][1]}）；'
               f'不到 2.5 m 的外牆長約 {within.sum() * step:.0f} m／{total:.0f} m（rails：{ids if ids else "無"}'
               + (f'，d={dd[within].min():.0f}～{dd[within].max():.0f}' if within.any() else '') + f'）；與外框面積相交的 rails {len(crossing)} 條' + (f' {crossing}' if crossing else ''))
        msgs.append(txt)
    R.add(7, 'INFO', '7.1 U 槽外牆到 9/12 快照 rails 的距離（設計原則 ≥ 2.5 m，只回報不判）：' + '；'.join(msgs))
    # 舊站體
    old = U.load_json(U.OLD_STATION)
    ll = Polygon([out.proj(*c) for c in old['coordinates']])
    ax, ay = out.proj(*old['anchor'])
    th = math.radians(old['rotationDeg'])
    local = np.array(old['local'])
    rot = np.column_stack([ax + local[:, 0] * math.cos(th) - local[:, 1] * math.sin(th), ay + local[:, 0] * math.sin(th) + local[:, 1] * math.cos(th)])
    pl = Polygon(rot)
    agree = max(np.abs(np.array(ll.exterior.coords) - np.array(pl.exterior.coords)).max(), 0.0) if len(ll.exterior.coords) == len(pl.exterior.coords) else float('nan')
    st = Polygon(fps['station']['ring'])
    gap = st.distance(ll)
    inter = st.intersection(ll).area
    msgs = [f'舊站體外框（relation {old["id"]}）面積 {ll.area:.1f} m²，lon/lat 換算與「local＋anchor＋rotationDeg·π/180」兩種放法的頂點最大差 {agree:.3f} m']
    msgs.append(f'與站體外框：{"重疊面積 %.1f m²" % inter if inter > 0 else "不相交，最近距離 %.2f m" % gap}（舊站體在站體外框的{"內" if st.contains(ll) else "外／跨"}）')
    R.add(7, 'INFO', '7.2 站體外框與 9/12 舊站體外框：' + '；'.join(msgs))


# ---------------------------------------------------------------- 項目 8：只動這個資料夾
def item8(R):
    wt = U.REPO
    st = subprocess.run(['git', '-C', str(wt), 'status', '--porcelain'], capture_output=True, text=True)
    lines = [l for l in st.stdout.splitlines() if l.strip()]
    bad = [l for l in lines if not l[3:].strip('"').startswith(ALLOWED_PREFIX)]
    df = subprocess.run(['git', '-C', str(wt), 'diff', '--stat', '--', 'memories', 'prototypes/tiny-trains/blender/tainan-memory-v1'],
                        capture_output=True, text=True)
    R.add(8, ok_text(st.returncode == 0 and not bad and df.returncode == 0 and not df.stdout.strip()),
          f'8.1 git status --porcelain {len(lines)} 行、不在 {ALLOWED_PREFIX} 之下的 {len(bad)} 行{bad[:5] if bad else ""}；'
          f'git diff --stat -- memories 與 tainan-memory-v1 {"為空" if not df.stdout.strip() else "非空：" + df.stdout.strip()}')
    here = U.HERE
    found = {str(p.relative_to(here)) for p in here.rglob('*') if p.is_file()}
    extra = sorted(found - EXPECTED_FILES)
    missing = sorted(EXPECTED_FILES - found)
    R.add(8, ok_text(not extra and not missing), f'8.2 資料夾內只有預期的檔案（沒有建置輸出、__pycache__、圖）：多出 {extra}、缺少 {missing}')


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    out = U.Out(sys.argv[1])
    R = Report()
    print(f'check {out.dir}  三角形 {len(out.tris)}、drawGroups {[g["name"] for g in out.groups]}', flush=True)
    item1(R, out)
    item_dims(R, out)
    item_endwall(R, out)
    item_trough_scan(R, out)
    tracks = sample_tracks(out)
    item2_3(R, out, tracks)
    item4_5(R, out)
    polys = item6(R, out)
    item7(R, out, polys)
    item8(R)
    names = {1: '網格', 2: '淨空', 3: '地板高程', 4: '站端位置', 5: '坡度', 6: '月台', 7: '回報（不判）', 8: '只動這個資料夾'}
    print('—— 總結 ——')
    fail = False
    for it in range(1, 9):
        if it == 7:
            print(f'  項目 7 {names[it]}：只回報')
            continue
        ok = R.passed(it)
        fail |= not ok
        print(f'  項目 {it} {names[it]}：{"PASS" if ok else "FAIL"}')
    print('RESULT', 'FAIL' if fail else 'PASS')
    sys.exit(1 if fail else 0)


if __name__ == '__main__':
    main()
