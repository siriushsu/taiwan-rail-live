#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
產生 data/tra.json：台鐵環島路網（9 段）供網頁小動畫用。

做法說明（見腳本內 NOTE）：
- 原計畫用 Overpass 抓 route=train 且 name 對應「縱貫線／山線／海線…」的 relation，
  逐條取用其 member 順序建站序。實測後發現 OSM 上台鐵的 route=train relation
  對應的是「個別車次」（如「自強108」「區間1112」），並沒有以官方路線名稱
  （縱貫線/山線/海線/屏東線/南迴線/臺東線/北迴線/宜蘭線）命名、涵蓋整段
  的 route relation，也沒有 route=railway 的路線 relation 可用。
- 因此改為：用 Overpass 一次性抓「全部台鐵車站/招呼站節點」（railway=station
  或 halt，operator 含台鐵字樣）取得即時的站名＋經緯度（245 站），
  再依台鐵官方公開的路線站序（本腳本內 LINE_DEFS 手工列出，為公開常識性資料，
  非臆測）比對站名取得座標，組成 9 段路線。座標一律來自 OSM 即時查詢，
  不是手填。
- overpass-api.de 與 lz4.overpass-api.de 兩個節點在本次執行環境對含中文字
  查詢一律回 HTTP 406（疑似該節點的 mod_security/WAF 規則問題，與查詢語法
  無關；純 ASCII 查詢在同節點則是逾時 504，代表節點當時單純過載）。
  改用 z.overpass-api.de 鏡像後查詢正常（HTTP 200）。腳本對每個鏡像皆有
  重試與逾時，找不到才報錯。
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import urllib.error

OVERPASS_MIRRORS = [
    "https://z.overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]

# 台灣本島合理座標範圍（含離島誤差保守值，用於清洗雜訊節點）
LAT_MIN, LAT_MAX = 21.9, 25.3
LON_MIN, LON_MAX = 120.0, 122.0

BBOX = f"{LAT_MIN},{LON_MIN},{LAT_MAX},{LON_MAX}"

QUERY = (
    "[out:json][timeout:90][bbox:{bbox}];"
    'node["railway"~"^(station|halt)$"]'
    '["operator"~"台鐵|臺灣鐵路|Taiwan Railway"];'
    "out body;"
).format(bbox=BBOX)


def fetch_overpass(query, mirrors=OVERPASS_MIRRORS, retries=3, timeout=100):
    """對每個鏡像重試；全部失敗才丟例外。回傳 (parsed JSON dict, 實際成功的鏡像 URL)。"""
    last_err = None
    for mirror in mirrors:
        for attempt in range(1, retries + 1):
            try:
                body_str = "data=" + urllib.parse.quote(query, safe="")
                req = urllib.request.Request(
                    mirror,
                    data=body_str.encode("ascii"),
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    body = resp.read()
                    return json.loads(body.decode("utf-8")), mirror
            except Exception as e:  # noqa: BLE001 - 記下來換下一個鏡像/重試
                last_err = e
                print(f"  [warn] {mirror} attempt {attempt} failed: {e}", file=sys.stderr)
                time.sleep(3)
    raise RuntimeError(f"所有 Overpass 鏡像都失敗：{last_err}")


def build_station_index(elements):
    """回傳 name -> list[(lat, lon, id)]，並套用座標範圍清洗。"""
    index = {}
    for el in elements:
        if el.get("type") != "node":
            continue
        tags = el.get("tags", {})
        name = tags.get("name")
        if not name:
            continue
        lat, lon = el.get("lat"), el.get("lon")
        if lat is None or lon is None:
            continue
        if not (LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX):
            continue
        index.setdefault(name, []).append((lat, lon, el["id"]))
    return index


# 站名重複（同名新舊站址）時，指定要取哪個 node id。
# 泰安：山線舊站/新站兩個節點同名。註：此 OSM node 其實距新泰安站 1.24km（2026-07-11
# 對 TDX 站點驗出），OSM 消歧義只當粗定位，最終座標一律由下方 TDX 覆寫修正。
DISAMBIGUATE_NODE_ID = {
    "泰安": 774940566,
}


def resolve_station(index, name, notes, line_id):
    candidates = index.get(name)
    if not candidates:
        notes.append(f"{line_id}: 找不到站點「{name}」，已略過")
        return None
    if len(candidates) == 1:
        lat, lon, _id = candidates[0]
        return {"name": name, "lat": lat, "lon": lon}
    want_id = DISAMBIGUATE_NODE_ID.get(name)
    if want_id is not None:
        for lat, lon, nid in candidates:
            if nid == want_id:
                return {"name": name, "lat": lat, "lon": lon}
    # 沒有指定就取第一個，並記錄有重名節點
    lat, lon, _id = candidates[0]
    notes.append(f"{line_id}: 站點「{name}」在 OSM 有 {len(candidates)} 個同名節點，取第一個")
    return {"name": name, "lat": lat, "lon": lon}


# 9 段路線的官方站序（公開常識性資料：台鐵官網時刻表/ 路線圖）。
# 顏色：相鄰路線不同色，非官方配色，純為動畫辨識用。
LINE_DEFS = [
    {
        "id": "縱貫線北段",
        "name": "縱貫線北段（基隆–竹南）",
        "color": "#2E6FB0",
        "peakHeadwaySec": 600,
        "offpeakHeadwaySec": 1200,
        "stations": [
            "基隆", "三坑", "八堵", "七堵", "百福", "五堵", "汐止", "汐科", "南港", "松山",
            "臺北", "萬華", "板橋", "浮洲", "樹林", "南樹林", "山佳", "鶯歌", "桃園", "鳳鳴",
            "內壢", "中壢", "埔心", "楊梅", "富岡", "新富", "北湖", "湖口", "新豐",
            "竹北", "北新竹", "新竹", "三姓橋", "香山", "崎頂", "竹南",
        ],
    },
    {
        "id": "山線",
        "name": "山線（竹南–彰化）",
        "color": "#E8792B",
        "peakHeadwaySec": 720,
        "offpeakHeadwaySec": 1200,
        "stations": [
            "竹南", "造橋", "豐富", "苗栗", "南勢", "銅鑼", "三義", "泰安",
            "后里", "豐原", "栗林", "潭子", "頭家厝", "松竹", "太原", "精武", "臺中",
            "五權", "大慶", "烏日", "新烏日", "彰化",
        ],
    },
    {
        "id": "海線",
        "name": "海線（竹南–彰化）",
        "color": "#3AA76D",
        "peakHeadwaySec": 900,
        "offpeakHeadwaySec": 1500,
        "stations": [
            "竹南", "談文", "大山", "後龍", "龍港", "白沙屯", "新埔", "通霄", "苑裡",
            "日南", "大甲", "臺中港", "清水", "沙鹿", "龍井", "大肚", "追分", "彰化",
        ],
    },
    {
        "id": "縱貫線南段",
        "name": "縱貫線南段（彰化–高雄）",
        "color": "#C0392B",
        "peakHeadwaySec": 600,
        "offpeakHeadwaySec": 1200,
        "stations": [
            "彰化", "花壇", "大村", "員林", "永靖", "社頭", "田中", "二水", "林內",
            "石榴", "斗六", "斗南", "石龜", "大林", "民雄", "嘉北", "嘉義", "水上",
            "南靖", "後壁", "新營", "柳營", "林鳳營", "隆田", "拔林", "善化", "南科",
            "新市", "永康", "大橋", "臺南", "保安", "仁德", "中洲", "大湖", "路竹",
            "岡山", "橋頭", "楠梓", "新左營", "左營(舊城)", "內惟", "美術館", "鼓山",
            "三塊厝", "高雄",
        ],
    },
    {
        "id": "屏東線",
        "name": "屏東線（高雄–枋寮）",
        "color": "#8E44AD",
        "peakHeadwaySec": 720,
        "offpeakHeadwaySec": 1200,
        "stations": [
            "高雄", "民族", "科工館", "正義", "鳳山", "後庄", "九曲堂", "六塊厝",
            "屏東", "歸來", "麟洛", "西勢", "竹田", "潮州", "崁頂", "南州", "鎮安",
            "林邊", "佳冬", "東海", "枋寮",
        ],
    },
    {
        "id": "南迴線",
        "name": "南迴線（枋寮–臺東）",
        "color": "#16A085",
        "peakHeadwaySec": 1800,
        "offpeakHeadwaySec": 3600,
        "stations": [
            "枋寮", "加祿", "內獅", "枋山", "枋野", "大武", "瀧溪", "金崙", "太麻里",
            "知本", "康樂", "臺東",
        ],
    },
    {
        "id": "臺東線",
        "name": "臺東線（臺東–花蓮）",
        "color": "#D4A017",
        "peakHeadwaySec": 900,
        "offpeakHeadwaySec": 1500,
        "stations": [
            "臺東", "山里", "鹿野", "瑞源", "瑞和", "關山", "海端", "池上", "富里",
            "東竹", "東里", "玉里", "三民", "瑞穗", "富源", "大富", "光復", "萬榮",
            "鳳林", "南平", "林榮新光", "豐田", "壽豐", "平和", "志學", "吉安", "花蓮",
        ],
    },
    {
        "id": "北迴線",
        "name": "北迴線（花蓮–蘇澳新）",
        "color": "#5D6D7E",
        "peakHeadwaySec": 900,
        "offpeakHeadwaySec": 1500,
        "stations": [
            "花蓮", "北埔", "景美", "新城 (太魯閣)", "崇德", "和仁", "和平", "漢本",
            "武塔", "南澳", "東澳", "永樂", "蘇澳新",
        ],
    },
    {
        "id": "宜蘭線",
        "name": "宜蘭線（蘇澳–八堵）",
        "color": "#C2185B",
        "peakHeadwaySec": 720,
        "offpeakHeadwaySec": 1200,
        "stations": [
            "蘇澳", "蘇澳新", "新馬", "冬山", "羅東", "中里", "二結", "宜蘭", "四城",
            "礁溪", "頂埔", "頭城", "外澳", "龜山", "大溪", "大里", "石城", "福隆",
            "貢寮", "雙溪", "牡丹", "三貂嶺", "猴硐", "瑞芳", "四腳亭", "暖暖", "八堵",
        ],
    },
]


def main():
    print("查詢 Overpass：全部台鐵車站/招呼站節點 ...", file=sys.stderr)
    result, used_mirror = fetch_overpass(QUERY)
    elements = result.get("elements", [])
    print(f"取得 {len(elements)} 個節點（來源：{used_mirror}）", file=sys.stderr)
    index = build_station_index(elements)
    print(f"去重後 {len(index)} 個站名", file=sys.stderr)

    notes = [
        f"Overpass 節點來源：{used_mirror}（node railway~station|halt, "
        f"operator~台鐵/臺灣鐵路/Taiwan Railway，bbox={BBOX}），共取得 {len(elements)} 個站點節點。"
        " 註：overpass-api.de 與 lz4.overpass-api.de 對含中文字查詢在本次執行環境一律回 "
        "HTTP 406，改用備援鏡像清單依序重試取得。",
        "OSM 並無以「縱貫線/山線/海線/屏東線/南迴線/臺東線/北迴線/宜蘭線」命名、"
        "涵蓋整段的 route=train relation（該 tag 對應的是個別車次如「自強108」），"
        "故 9 段路線站序改採台鐵官方公開站序（本腳本 LINE_DEFS 手工列出）比對站名取得座標，"
        "座標本身全部即時查自 OSM。",
        "班距（headwaySec）為粗估值，headway_estimated=true。",
    ]

    lines_out = []
    for line_def in LINE_DEFS:
        stations = []
        for name in line_def["stations"]:
            st = resolve_station(index, name, notes, line_def["id"])
            if st:
                stations.append(st)
        lines_out.append(
            {
                "id": line_def["id"],
                "name": line_def["name"],
                "color": line_def["color"],
                "peakHeadwaySec": line_def["peakHeadwaySec"],
                "offpeakHeadwaySec": line_def["offpeakHeadwaySec"],
                "headway_estimated": True,
                "stations": stations,
            }
        )
        missing = len(line_def["stations"]) - len(stations)
        print(
            f"  {line_def['id']}: {len(stations)}/{len(line_def['stations'])} 站"
            + (f"（缺 {missing}）" if missing else ""),
            file=sys.stderr,
        )

    # 座標以 TDX 站點資料為準（data/tra_station_info.json，fetch_tra_station_info.mjs 產出），
    # OSM 節點只當 fallback。2026-07-11 起加入：OSM 同名節點誤選曾造成
    # 泰安(舊站,偏1.24km)/千甲(偏2km)/汐科(偏0.4km) 三站錯位，並連帶把山線
    # 三義–后里段 Dijkstra 誘導到 1998 年停用的舊山線（勝興）。
    info_path = "data/tra_station_info.json"
    if os.path.exists(info_path):
        info = json.load(open(info_path))
        def _norm(n):
            return re.sub(r"\s*[（(].*$", "", n).replace("臺", "台")
        info_by_norm = {_norm(k): v for k, v in info.items()}
        overridden = 0
        for ln in lines_out:
            for st in ln["stations"]:
                t = info_by_norm.get(_norm(st["name"]))
                if t:
                    st["lat"], st["lon"] = t["lat"], t["lon"]
                    overridden += 1
        notes.append(f"站點座標以 TDX 站點資料覆寫（{overridden} 站），OSM 座標僅作 fallback。")
        print(f"TDX 座標覆寫 {overridden} 站", file=sys.stderr)
    else:
        notes.append("警告：找不到 data/tra_station_info.json，座標未經 TDX 覆寫，僅為 OSM 節點。")

    output = {
        "system": "台鐵",
        "source_notes": " ".join(notes),
        "lines": lines_out,
    }

    out_path = "data/tra.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"已寫入 {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
