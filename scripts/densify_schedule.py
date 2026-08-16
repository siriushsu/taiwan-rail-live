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

   內插與最短路徑選擇用的邊權重（快車跳站校正 Phase 1，研究_快車跳站校正_2026-07-24.md）：
   優先用 data/tra_station_of_line.json（TDX v3 Rail/TRA/StationOfLine 官方累計里程，
   scripts/fetch_tra_station_of_line.py 抓取）算出的沿線實際里程，取代 haversine 直線距離；
   該站對若不同屬 TDX 任一條線（快取檔不存在或站名比對不到），退回 haversine，並統計退回邊
   數/比例、清單列進 source_notes（不是「靜默丟棄」）。此權重同時用於 Dijkstra 最短路徑選擇
   （例如竹南–彰化平行的山線／海線，官方里程下山線 85.6km 明顯短於海線 90.3km，
   與舊版 haversine 估計的「海線 83.8km 略短於山線 84.2km」相反 —— 換里程後不只內插更準，
   平行路徑的路線選擇本身也修正了）。

輸出：data/tra_schedule_dense.json，結構同輸入，stops 多了 stop 欄位；
matched 的 stop 座標改用 tra.json 節點座標（讓插入的通過站與排定站座標同源、
前端沿線內插才會貼著鐵軌）；fallback 的 stop 保留原始座標。

多日格式（fetch_tra_schedule.py 產出 dates:{日期→[trains 索引]} 的聯集檔）：
本腳本逐一 densify sch["trains"]（聯集後的唯一定義），輸出順序與輸入完全一致，
因此 dates 的索引維持有效，原樣 passthrough 到輸出。只 densify 一次（非每日一次）。
"""
import json
import math
import heapq
from collections import defaultdict

IN_SCHEDULE = "data/tra_schedule.json"
IN_TRA = "data/tra.json"
IN_STATION_OF_LINE = "data/tra_station_of_line.json"
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


def load_line_maps(path):
    """讀 data/tra_station_of_line.json（TDX 官方 StationOfLine 快取），回傳
    [(lineId, {站名: 累計里程km}), ...]。檔案不存在時回傳空清單（全面退回 haversine，
    行為等同改動前）。"""
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    except FileNotFoundError:
        return []
    out = []
    for ln in raw.get("lines", []):
        m = {}
        for s in ln.get("stations", []):
            name, cum = s.get("name"), s.get("cumKm")
            if name is None or cum is None or name in m:
                continue
            m[name] = cum
        out.append((ln.get("lineId"), m))
    return out


def strip_paren(name):
    """去除站名尾端括號別名（tra.json 專有的消歧義後綴，如「新城 (太魯閣)」「左營(舊城)」），
    只用於比對 TDX 官方站名（不含這類後綴），不改動節點本身的顯示名稱。"""
    cuts = [i for i in (name.find("("), name.find("（")) if i >= 0]
    if not cuts:
        return name
    return name[:min(cuts)].rstrip()


def official_km(a, b, line_maps):
    """在各線 name->累計里程 對照表中找 a、b 是否同屬一條 TDX 線，回傳沿線里程差
    （非直線距離）；任一站在該線站序中不存在則換下一條線；全部線都找不到回傳 None。"""
    cands_a = [a] if a == strip_paren(a) else [a, strip_paren(a)]
    cands_b = [b] if b == strip_paren(b) else [b, strip_paren(b)]
    for _lid, m in line_maps:
        for ca in cands_a:
            if ca not in m:
                continue
            for cb in cands_b:
                if cb in m:
                    return abs(m[ca] - m[cb])
    return None


def build_mileage_adj(adj, line_maps):
    """adj = build_graph() 產出的 haversine 權重圖。回傳 (adj_mi, fallback_edges)：
    adj_mi 同構，每條邊優先取官方里程（official_km），找不到才退回 haversine 原值；
    fallback_edges = [(a, b, haversine_km), ...]，每條無向邊只列一次（a<b），供
    G3 驗收（退回比例、清單）與 source_notes 記錄。"""
    adj_mi = defaultdict(dict)
    fallback_edges = []
    seen = set()
    for a in adj:
        for b, hv in adj[a].items():
            key = tuple(sorted((a, b)))
            if key in seen:
                continue
            seen.add(key)
            km = official_km(a, b, line_maps)
            if km is None:
                km = hv
                fallback_edges.append((key[0], key[1], round(hv, 3)))
            adj_mi[a][b] = km
            adj_mi[b][a] = km
    return dict(adj_mi), fallback_edges


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
    line_maps = load_line_maps(IN_STATION_OF_LINE)
    adj_mi, mileage_fallback_edges = build_mileage_adj(adj, line_maps)
    total_edges = sum(len(v) for v in adj.values()) // 2
    print(f"graph nodes={len(node_coord)} edges={total_edges} "
          f"official-mileage lines={len(line_maps)} "
          f"mileage-fallback-edges={len(mileage_fallback_edges)}/{total_edges} "
          "building shortest paths...")
    dist_all, prev_all = dijkstra_all(node_coord, adj_mi)
    print("shortest paths done")

    match_cache = {}
    unmatched_names = set()
    fallback_segments = 0
    total_segments = 0

    # 通過站正名：tra.json 節點名是手打站列（「左營(舊城)」「新城 (太魯閣)」），班表停靠站用的是
    # 台鐵 ODS 官方站名（「左營」「新城」）。兩者吸附到同一個節點座標後，若通過站沿用節點名，
    # 前端以「系統|站名」去重就會長出兩顆同座標的站——點站彈疊站選單、「左營(舊城)」看板永遠空
    # （2026-08-16 網友回報）。規則：節點名本身從未以停靠站身分出現、且恰有一個班表站名吸附到它
    # → 通過站改用那個官方站名；多個站名吸到同一節點（臺北／臺北-環島）就維持節點名不猜。
    stop_names = {s["name"] for t in sch["trains"] for s in t["stops"]}
    node_stop_names = {}
    for t in sch["trains"]:
        for s in t["stops"]:
            node_name, _d = nearest_node(s["lat"], s["lon"], node_coord, match_cache)
            if node_name is not None and node_name not in stop_names:
                node_stop_names.setdefault(node_name, set()).add(s["name"])
    pass_alias = {n: next(iter(v)) for n, v in node_stop_names.items() if len(v) == 1}
    alias_ambiguous = {n: sorted(v) for n, v in node_stop_names.items() if len(v) > 1}
    print(f"pass-through alias={sorted(pass_alias.items())} ambiguous(kept)={alias_ambiguous}")

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
                    # 累積距離比例內插（權重優先用官方里程 adj_mi，退回 haversine 的邊
                    # 已在 build_mileage_adj 統計進 mileage_fallback_edges）
                    edge_dists = []
                    for i in range(len(path) - 1):
                        edge_dists.append(adj_mi[path[i]][path[i + 1]])
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
                                "name": pass_alias.get(path[i], path[i]),
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
            "carName": t.get("carName"),
            "color": t["color"],
            "stops": new_stops,
        })

    source_notes = (
        sch.get("source_notes", "") +
        " | 加密方法：以 tra.json 9 條線建站點圖（節點=站名，跨線同名站自動合併），"
        "每個排定停靠站以座標比對最近節點（>2km 視為對不上，沿用原座標且不插點），"
        "相鄰排定站之間用 Dijkstra 最短路徑插入沿線通過站，時刻依路徑累積距離比例在兩站 "
        "depSec/arrSec 間內插；找不到路徑或站點對不上則保留原直線。"
        f" fallback 區段數={fallback_segments}/{total_segments}；"
        f"對不上 tra.json 節點的站名共 {len(unmatched_names)} 個：{sorted(unmatched_names)}。"
        f" 通過站正名（tra.json 節點名從未當停靠站、且恰有一個班表官方站名吸附到該節點時，通過站改用官方站名，"
        f"避免同座標長出兩顆站）：{sorted(pass_alias.items())}；多站名吸附到同一節點而保留節點名者：{alias_ambiguous}。"
        " 快車跳站校正 Phase 1（研究_快車跳站校正_2026-07-24.md）：Dijkstra 與內插的邊權重"
        "優先用 data/tra_station_of_line.json（TDX v3 Rail/TRA/StationOfLine 官方累計里程）"
        "取代 haversine 直線距離；"
        f"graph 邊總數={total_edges}，退回 haversine 的邊數="
        f"{len(mileage_fallback_edges)}（{(len(mileage_fallback_edges) / total_edges * 100 if total_edges else 0):.1f}%）："
        f"{mileage_fallback_edges}。"
        " 已知限制：竹南–彰化間山線／海線為平行路徑，Dijkstra 一律選較短者——改用官方里程後"
        "為山線(WL)約85.6km 短於海線(WL-C)約90.3km（舊版 haversine 估計海線83.8km 略短於"
        "山線84.2km，與官方里程結論相反，已隨本次改動修正），故完全跳過整段的列車其加密路徑"
        "不一定對應該車實際行經的線別；有在該區間內停靠任一站的列車則會正確經過該站。"
    )

    out = {
        "system": sch.get("system"),
        "date": sch.get("date"),
        "source_notes": source_notes,
        "types": sch.get("types"),
        "trains": out_trains,
    }
    # 多日格式:dates/dateRange 原樣帶過(out_trains 與 sch["trains"] 順序一致,索引維持有效)
    if "dates" in sch:
        out["dates"] = sch["dates"]
    if "dateRange" in sch:
        out["dateRange"] = sch["dateRange"]

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    print(f"fallback_segments={fallback_segments} total_segments={total_segments}")
    print(f"unmatched_names={len(unmatched_names)}: {sorted(unmatched_names)}")
    print(f"mileage_fallback_edges={len(mileage_fallback_edges)}/{total_edges}: {mileage_fallback_edges}")


if __name__ == "__main__":
    main()
