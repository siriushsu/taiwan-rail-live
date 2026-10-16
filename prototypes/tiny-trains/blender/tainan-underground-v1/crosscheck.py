#!/usr/bin/env python3
"""input/alignment.json 與 OSM API 抽取檔（params.alignment.crossCheck）逐點比對座標。

抽取檔是網路下載來的資料，所以這支只用標準函式庫、請用 python3 -I 執行（不載入目前資料夾或使用者目錄的模組），
抽取檔路徑一律由命令列給，建模腳本（build.py）不讀它。
抽取檔的座標是 [緯度, 經度]，alignment.json 是 [經度, 緯度]。
alignment.json 裡可能有 network.json 為了放停靠點而插入的 'estimated:…' 節點（不是 OSM 節點）：
它們不在 API 的 way 裡，改量「到 API 折線的距離」（應該≈0，代表只是插在線上）。

用法：python3 -I crosscheck.py <alignment.json> <osm_api_extract.json>
tags 不同只印出來、不算失敗（切換期間 OSM 可能把 railway=rail 改成 railway=construction，幾何沒變）。
結束碼：座標最大差異 > 0.01 m、節點 id 對不上、或有 way 缺失時回 1。
"""
import json
import math
import sys

LAT0 = 22.99681
KX = 111320 * math.cos(math.radians(LAT0))
KY = 111320.0
TOL_M = 0.01


def xy(lon, lat):
    return (lon * KX, lat * KY)


def dist_to_polyline(p, pts):
    best = float('inf')
    for a, b in zip(pts, pts[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
        best = min(best, math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)))
    return best


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    al = json.load(open(sys.argv[1], encoding='utf-8'))
    api = json.load(open(sys.argv[2], encoding='utf-8'))
    api_ways = {str(w['id']): w for w in api['ways']}
    worst = 0.0
    worst_where = None
    problems = []
    notes = []
    print(f"API 抽取檔 generated={api.get('generated')}  ways={len(api['ways'])}")
    for w in al['ways']:
        a = api_ways.get(w['id'])
        if a is None:
            problems.append(f"way {w['id']} 不在 API 抽取檔")
            print(f"  {w['id']:>11}  MISSING")
            continue
        nds = [str(n) for n in a['nds']]
        coords = a['coords']                       # [緯度, 經度]
        if len(nds) != len(coords):
            problems.append(f"way {w['id']} API 的 nds 與 coords 長度不同")
        api_by_id = {n: (c[1], c[0]) for n, c in zip(nds, coords)}      # → [經度, 緯度]
        api_poly = [xy(*(c[1], c[0])) for c in coords]
        real = [(n, c) for n, c in zip(w['nodes'], w['coordinates']) if not str(n).startswith('estimated:')]
        est = [(n, c) for n, c in zip(w['nodes'], w['coordinates']) if str(n).startswith('estimated:')]
        ids_ok = [str(n) for n, _ in real] == nds
        if not ids_ok:
            problems.append(f"way {w['id']} 節點 id 順序與 API 不同（alignment {len(real)} 個真實節點、API {len(nds)} 個）")
        wmax, wn = 0.0, None
        for n, c in real:
            o = api_by_id.get(str(n))
            if o is None:
                problems.append(f"way {w['id']} 節點 {n} 不在 API 的該 way")
                continue
            p, q = xy(*c), xy(*o)
            d = math.hypot(p[0] - q[0], p[1] - q[1])
            if d > wmax:
                wmax, wn = d, n
        emax = max((dist_to_polyline(xy(*c), api_poly) for _, c in est), default=0.0)
        tags_ok = all(a['tags'].get(k) == v for k, v in w['tags'].items())
        print(f"  {w['id']:>11}  真實節點 {len(real):>2}/API {len(nds):>2}  id 順序 {'一致' if ids_ok else '不同'}  "
              f"最大座標差 {wmax:.6f} m（節點 {wn}）  插入節點 {len(est)} 個、離折線最遠 {emax:.4f} m  tags {'一致' if tags_ok else '不同'}")
        if not tags_ok:
            diff = {k: (w['tags'].get(k), a['tags'].get(k)) for k in sorted(set(w['tags']) | set(a['tags'])) if w['tags'].get(k) != a['tags'].get(k)}
            notes.append(f"way {w['id']} tags 不同（alignment, API）：{diff}")
        if wmax > worst:
            worst, worst_where = wmax, (w['id'], wn)
        if emax > TOL_M:
            problems.append(f"way {w['id']} 的插入節點離 API 折線 {emax:.4f} m")
    print(f"最大座標差異 {worst:.6f} m @ way/節點 {worst_where}（門檻 {TOL_M} m）")
    for n in notes:
        print('NOTE', n)
    for p in problems:
        print('FAIL', p)
    ok = not problems and worst <= TOL_M
    print('CROSSCHECK', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
