#!/usr/bin/env python3
"""
把 tra_schedule.json 的每個車次 stops 加密成「沿實際路線經過的每一站」序列。

做法：
1. 用 tra.json 的 9 條線建站點圖（節點=站名，同名站在不同線出現時自動合併，
   已驗證 tra.json 內同名站座標完全一致，不需額外聚類）。
2. 對 schedule 每個 stop，用座標找 tra.json 中最近的節點（球面距離），
   >2 公里視為對不上（fallback，僅在該節點所屬列車段落，其餘照常）。
3. 對每個車次每組相鄰「排定停靠」站，在圖上用 Dijkstra 找最短路徑，把路徑中間
   的節點插入為「通過站」（stop=false），時刻依累積距離比例在兩站 depSec/arrSec
   之間內插。任一端對不上、或找不到路徑 → 保留原本直線（不插點），計入 fallback。

輸出：data/tra_schedule_dense.json，結構同輸入，stops 多了 stop 欄位；
matched 的 stop 座標改用 tra.json 節點座標（讓插入的通過站與排定站座標同源、
前端沿線內插才會貼著鐵軌）；fallback 的 stop 保留原始座標。
"""
import json
import math
import heapq
from collections import defaultdict

IN_SCHEDULE = "data/tra_schedule.json"
IN_TRA = "data/tra.json"
OUT_PATH = "data/tra_schedule_dense.json"

MATCH_THRESHOLD_KM = 2.0


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def build_graph(tra):
    """節點 = 站名（tra.json 內同名站座標完全一致，已驗證），邊 = 各線相鄰站。"""
    node_coord = {}  # name -> (lat, lon)
    adj = defaultdict(dict)  # name -> {neighbor_name: weight_km} (取最小權重，若重複邊)
    for line in tra["lines"]:
        st = line["stations"]
        for s in st:
            node_coord[s["name"]] = (s["lat"], s["lon"])
        for i in range(len(st) - 1):
            a, b = st[i], st[i + 1]
            w = haversine_km(a["lat"], a["lon"], b["lat"], b["lon"])
            na, nb = a["name"], b["name"]
            if nb not in adj[na] or w < adj[na][nb]:
                adj[na][nb] = w
                adj[nb][na] = w
    return node_coord, adj


def dijkstra_all(node_coord, adj):
    """對每個節點跑一次 Dijkstra，回傳 dist[src][dst]、prev[src][dst]（用於回溯路徑）。"""
    dist_all = {}
    prev_all = {}
    nodes = list(node_coord.keys())
    for src in nodes:
        dist = {src: 0.0}
        prev = {}
        pq = [(0.0, src)]
        visited = set()
        while pq:
            d, u = heapq.heappop(pq)
            if u in visited:
                continue
            visited.add(u)
            for v, w in adj[u].items():
                nd = d + w
                if v not in dist or nd < dist[v]:
                    dist[v] = nd
                    prev[v] = u
                    heapq.heappush(pq, (nd, v))
        dist_all[src] = dist
        prev_all[src] = prev
    return dist_all, prev_all


def get_path(prev_all, dist_all, a, b):
    """回傳 a->b 的節點名序列（含頭尾），或 None（不可達）。"""
    if a == b:
        return [a]
    if b not in dist_all.get(a, {}):
        return None
    path = [b]
    cur = b
    prev = prev_all[a]
    while cur != a:
        if cur not in prev:
            return None
        cur = prev[cur]
        path.append(cur)
    path.reverse()
    return path


def nearest_node(lat, lon, node_coord, cache):
    key = (round(lat, 6), round(lon, 6))
    if key in cache:
        return cache[key]
    best_name, best_d = None, None
    for name, (nlat, nlon) in node_coord.items():
        d = haversine_km(lat, lon, nlat, nlon)
        if best_d is None or d < best_d:
            best_d, best_name = d, name
    result = (best_name, best_d) if best_d is not None and best_d <= MATCH_THRESHOLD_KM else (None, best_d)
    cache[key] = result
    return result


def main():
    with open(IN_SCHEDULE, encoding="utf-8") as f:
        sch = json.load(f)
    with open(IN_TRA, encoding="utf-8") as f:
        tra = json.load(f)

    node_coord, adj = build_graph(tra)
    print(f"graph nodes={len(node_coord)} building shortest paths...")
    dist_all, prev_all = dijkstra_all(node_coord, adj)
    print("shortest paths done")

    match_cache = {}
    unmatched_names = set()
    fallback_segments = 0
    total_segments = 0

    out_trains = []
    for t in sch["trains"]:
        stops = t["stops"]
        new_stops = []
        prev_stop = None
        prev_node = None
        for s in stops:
            node_name, dist_km = nearest_node(s["lat"], s["lon"], node_coord, match_cache)
            if node_name is None:
                unmatched_names.add(s["name"])
                cur_lat, cur_lon = s["lat"], s["lon"]
            else:
                cur_lat, cur_lon = node_coord[node_name]

            if prev_stop is None:
                new_stops.append({
                    "name": s["name"],
                    "lat": cur_lat,
                    "lon": cur_lon,
                    "order": s["order"],
                    "arrSec": s["arrSec"],
                    "depSec": s["depSec"],
                    "stop": True,
                })
                prev_stop = s
                prev_node = node_name
                continue

            total_segments += 1
            is_fallback = True
            if prev_node is not None and node_name is not None:
                path = get_path(prev_all, dist_all, prev_node, node_name)
                if path is not None:
                    # 兩端都對得上圖、且找得到路徑（不論是否需要插點）都不算 fallback
                    is_fallback = False
                if path is not None and len(path) > 2:
                    # 累積距離比例內插
                    edge_dists = []
                    for i in range(len(path) - 1):
                        edge_dists.append(adj[path[i]][path[i + 1]])
                    total_dist = sum(edge_dists)
                    if total_dist > 0:
                        cum = 0.0
                        t0 = prev_stop["depSec"]
                        t1 = s["arrSec"]
                        for i in range(1, len(path) - 1):
                            cum += edge_dists[i - 1]
                            frac = cum / total_dist
                            tsec = round(t0 + frac * (t1 - t0))
                            plat, plon = node_coord[path[i]]
                            new_stops.append({
                                "name": path[i],
                                "lat": plat,
                                "lon": plon,
                                "order": None,
                                "arrSec": tsec,
                                "depSec": tsec,
                                "stop": False,
                            })

            if is_fallback:
                fallback_segments += 1

            new_stops.append({
                "name": s["name"],
                "lat": cur_lat,
                "lon": cur_lon,
                "order": s["order"],
                "arrSec": s["arrSec"],
                "depSec": s["depSec"],
                "stop": True,
            })
            prev_stop = s
            prev_node = node_name

        out_trains.append({
            "train": t["train"],
            "typeName": t["typeName"],
            "color": t["color"],
            "stops": new_stops,
        })

    source_notes = (
        sch.get("source_notes", "") +
        " | 加密方法：以 tra.json 9 條線建站點圖（節點=站名，跨線同名站自動合併），"
        "每個排定停靠站以座標比對最近節點（>2km 視為對不上，沿用原座標且不插點），"
        "相鄰排定站之間用 Dijkstra 最短路徑（權重=球面距離 km）插入沿線通過站，"
        "時刻依路徑累積距離比例在兩站 depSec/arrSec 間內插；找不到路徑或站點對不上則保留原直線。"
        f" fallback 區段數={fallback_segments}/{total_segments}；"
        f"對不上 tra.json 節點的站名共 {len(unmatched_names)} 個：{sorted(unmatched_names)}。"
        " 已知限制：竹南–彰化間山線／海線為平行路徑，Dijkstra 一律選較短者（海線，約83.8km "
        "對山線約84.2km），故完全跳過整段的列車其加密路徑不一定對應該車實際行經的線別；"
        "有在該區間內停靠任一站的列車則會正確經過該站。"
    )

    out = {
        "system": sch.get("system"),
        "date": sch.get("date"),
        "source_notes": source_notes,
        "types": sch.get("types"),
        "trains": out_trains,
    }

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    print(f"fallback_segments={fallback_segments} total_segments={total_segments}")
    print(f"unmatched_names={len(unmatched_names)}: {sorted(unmatched_names)}")


if __name__ == "__main__":
    main()
