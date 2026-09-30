"""共面重疊稽核：找出「同一平面、朝向相同、面積有重疊」的三角形對。

這種面在網頁（WebGL 深度緩衝）會 z-fighting（顏色不同時肉眼可見），在 Cycles 會出黑斑。
純 Python（不需要 Blender），需要 numpy、shapely。
用法：python3 audit_overlap.py [--lod near|far|wrap] [--min-area 1e-4] [--tol 0.002] [--top 25]
結束碼：有「不同材質」的共面重疊就回 1（同材質的重疊在網頁上看不出來，只算警告）。
"""
import sys
import math
from pathlib import Path
from collections import defaultdict

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import numpy as np
from shapely.geometry import Polygon
from shapely.strtree import STRtree

argv = sys.argv[1:]


def opt(name, default):
    return type(default)(argv[argv.index(name) + 1]) if name in argv else default


LOD = opt('--lod', 'near')
MIN_AREA = opt('--min-area', 1e-4)
TOL = opt('--tol', 0.002)
TOP = opt('--top', 25)

import station
import wrap as wrapmod

if LOD == 'wrap':
    G, lods = wrapmod.build(), ('both', 'near', 'far')
else:
    G, lods = station.build(), (('both', 'near') if LOD == 'near' else ('both', 'far'))

tris = []       # (mat, P(3x3), n, d)
for (mat, lod), buf in G.buf.items():
    if lod not in lods:
        continue
    a = np.asarray(buf, dtype=np.float64).reshape(-1, 3, 6)[:, :, :3]
    for P in a:
        g = np.cross(P[1] - P[0], P[2] - P[0])
        L = np.linalg.norm(g)
        if L < 1e-9:
            continue
        n = g / L
        tris.append((mat, P, n, float(n @ P[0])))
print(f'LOD={LOD} triangles={len(tris)}')

buckets = defaultdict(list)
for i, (mat, P, n, d) in enumerate(tris):
    key = tuple(round(float(x), 3) + 0.0 for x in n)
    buckets[key].append(i)


def basis(n):
    a = np.array([1.0, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1.0, 0])
    u = np.cross(n, a)
    u /= np.linalg.norm(u)
    return u, np.cross(n, u)


hits = []       # (area, matA, matB, centroid, n, dd)
for key, idx in buckets.items():
    if len(idx) < 2:
        continue
    idx.sort(key=lambda i: tris[i][3])
    n0 = np.array(key)
    n0 = n0 / np.linalg.norm(n0)
    u, v = basis(n0)
    # 依平面距離切成「相鄰差 ≤ TOL」的群
    groups, cur = [], [idx[0]]
    for a, b in zip(idx, idx[1:]):
        if tris[b][3] - tris[a][3] <= TOL:
            cur.append(b)
        else:
            groups.append(cur)
            cur = [b]
    groups.append(cur)
    for gi in groups:
        if len(gi) < 2:
            continue
        polys = []
        for i in gi:
            P = tris[i][1]
            polys.append(Polygon([(float(p @ u), float(p @ v)) for p in P]))
        tree = STRtree(polys)
        for ai, pa in enumerate(polys):
            for bi in tree.query(pa):
                bi = int(bi)
                if bi <= ai:
                    continue
                inter = pa.intersection(polys[bi]).area
                if inter > MIN_AREA:
                    ia, ib = gi[ai], gi[bi]
                    c = (tris[ia][1].mean(axis=0) + tris[ib][1].mean(axis=0)) / 2
                    hits.append((inter, tris[ia][0], tris[ib][0], c, n0, abs(tris[ia][3] - tris[ib][3])))

hits.sort(key=lambda h: -h[0])
cross = [h for h in hits if h[1] != h[2]]
same = [h for h in hits if h[1] == h[2]]
print(f'共面重疊 {len(hits)} 對：不同材質 {len(cross)}（會 z-fighting）、同材質 {len(same)}（僅 Cycles 黑斑）')
agg = defaultdict(lambda: [0, 0.0])
for h in hits:
    k = tuple(sorted((h[1], h[2])))
    agg[k][0] += 1
    agg[k][1] += h[0]
for k, (n, area) in sorted(agg.items(), key=lambda kv: -kv[1][1]):
    print(f'  {k[0]:>8} × {k[1]:<8} {n:4d} 對，面積 {area:8.3f} m²')
print(f'—— 前 {TOP} 大（先列不同材質）——')
for h in (cross + same)[:TOP]:
    area, ma, mb, c, n, dd = h
    print(f'  {area:8.4f} m²  {ma}/{mb}  @({c[0]:7.2f},{c[1]:7.2f},{c[2]:6.2f})  n=({n[0]:+.0f},{n[1]:+.0f},{n[2]:+.0f}) Δd={dd * 1000:.2f}mm')
# 依（材質對、朝向、平面位置）聚成「群」：一群通常對應程式裡的一個疊放動作
clusters = defaultdict(list)
for h in (hits if '--all' in argv else cross):
    area, ma, mb, c, n, dd = h
    ax = int(np.argmax(np.abs(n)))
    plane = round(float(c[ax]), 1)
    clusters[(tuple(sorted((ma, mb))), ax, int(np.sign(n[ax])), plane)].append(h)
print(f'—— 聚成 {len(clusters)} 群（{"全部" if "--all" in argv else "僅不同材質"}），依面積排序 ——')
for k, hs in sorted(clusters.items(), key=lambda kv: -sum(h[0] for h in kv[1]))[:opt('--clusters', 40)]:
    cs = np.array([h[3] for h in hs])
    lo, hi = cs.min(axis=0), cs.max(axis=0)
    print(f'  {k[0][0]:>6}×{k[0][1]:<6} 軸{"XYZ"[k[1]]}{"+" if k[2] > 0 else "-"}={k[3]:8.1f}  {len(hs):4d} 對 {sum(h[0] for h in hs):7.3f} m²  x[{lo[0]:.1f},{hi[0]:.1f}] y[{lo[1]:.1f},{hi[1]:.1f}] z[{lo[2]:.1f},{hi[2]:.1f}]')
sys.exit(1 if cross else 0)
