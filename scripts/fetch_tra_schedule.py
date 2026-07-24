#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
產生 data/tra_schedule.json：台鐵「未來 14 天逐日真實時刻表」（逐站到離站時刻），供前端動畫用。

過去是抓「今天一天」的快照全站每天重播，導致週末限定班次（如 21、213）在平日
永遠缺席、且對節日連假天生失準。改為抓今天起連續 14 天的官方逐日檔，做跨日去重聯集
（相同班次定義只存一份），前端 boot 時依台北營運日挑當日清單。

資料來源（皆為官方 ods.railway.gov.tw 開放資料，免註冊、免金鑰）：
1. 鐵路時刻表資料集：
   - 列表頁 https://ods.railway.gov.tw/tra-ods-web/ods/download/dataResource/railway_schedule/JSON/list
     內含近 60 天（含未來）每一天一個 JSON 檔連結，檔名 YYYYMMDD.json，
     連結網址為 exceptionDataResource/<id>。本腳本抓「今天起連續 14 天」中清單裡發佈得到的每一天
     （清單通常只發佈到某天為止，抓得到幾天算幾天，至少 7 天才算成功）。
   - 內容結構：{ "TrainInfos":[ {Train, Type, CarClass, Line, LineDir, Note,
     TimeInfos:[{Station, Order, ARRTime, DEPTime}]} ... ], "UpdateTime" }。
     Station 為台鐵站碼（4 碼字串），時間格式 HH:MM:SS。
2. 車站基本資料集（官方，含站碼→站名→GPS 經緯度）：
   - 固定下載網址 https://ods.railway.gov.tw/tra-ods-web/ods/download/dataResource/0518b833e8964d53bfea3f7691aea0ee
   - 內容為 list[{stationCode, stationName, gps: "lat lon", ...}]。
   - 實測：當日時刻表用到的 239 個站碼，100% 都能在這份站點清單裡查到座標
     （0 個 stop 因查無座標被丟棄），故本腳本不需要退而使用專案內
     data/tra.json 的站名比對。
3. CarClass 列車種類代碼表：官方 PDF 開發文件
   https://ods.railway.gov.tw/tra-ods-web/ods/download/devDoc/8ae4cac27f4c0348017f4dbdd21d0181
   第 8–9 頁「CarClass列車種類代碼表」。本腳本內 CARCLASS_TABLE 為該表全文
   手key（非臆測），並依中文名稱關鍵字（自強／莒光／復興／區間快／區間車）
   分成 5 大類上色。少數新代碼（110K、110M）在該 PDF（最新版 V1.6, 113.01.01）
   未收錄，但同屬「110X」自強號系列命名慣例（比照已知的 110G/110H 皆為
   EMU3000 型自強號變體），本腳本依此慣例歸類為「自強」類，並在
   source_notes 註明這是慣例推斷、非官方文件逐字確認。
"""

import collections
import datetime
import hashlib
import json
import re
import sys
import urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

LIST_URL = "https://ods.railway.gov.tw/tra-ods-web/ods/download/dataResource/railway_schedule/JSON/list"
SCHEDULE_URL_TMPL = "https://ods.railway.gov.tw/tra-ods-web/ods/download/dataResource/exceptionDataResource/{id}"
STATIONS_URL = "https://ods.railway.gov.tw/tra-ods-web/ods/download/dataResource/0518b833e8964d53bfea3f7691aea0ee"

LAT_MIN, LAT_MAX = 21.9, 25.3
LON_MIN, LON_MAX = 120.0, 122.0

DAYS_AHEAD = 14   # 今天起連續抓幾天
MIN_DAYS_OK = 7   # 至少抓到幾天才算成功（清單通常只發佈到某天為止）

# 官方「CarClass列車種類代碼表」全文（devDoc PDF 第 8–9 頁手key）。
CARCLASS_TABLE = {
    "1101": "自強(太,障)",
    "1105": "自強(郵)",
    "1104": "自強(專)",
    "1112": "莒光(專)",
    "1120": "復興",
    "1131": "區間車",
    "1132": "區間快",
    "1140": "普快車",
    "1141": "柴快車",
    "1150": "普通車(專)",
    "1151": "普通車",
    "1152": "行包專車",
    "1134": "兩鐵(專)",
    "1270": "普通貨車",
    "1280": "客迴",
    "1281": "柴迴",
    "12A0": "調車列車",
    "12A1": "單機迴送",
    "12B0": "試運轉",
    "4200": "特種(戰)",
    "5230": "特種(警)",
    "1111": "莒光(障)",
    "1103": "自強(障)",
    "1102": "自強(腳,障)",
    "1100": "自強",
    "1110": "莒光",
    "1121": "復興(專)",
    "1122": "復興(郵)",
    "1113": "莒光(郵)",
    "1282": "臨時客迴",
    "1130": "電車(專)",
    "1133": "電車(郵)",
    "1154": "柴客(專)",
    "1155": "柴客(郵)",
    "1107": "自強(普,障)",
    "1135": "區間車(腳,障)",
    "1108": "自強(PP障)",
    "1114": "莒光(腳)",
    "1115": "莒光(腳,障)",
    "1109": "自強(PP親)",
    "110A": "自強(PP障12)",
    "110B": "自強(E12)",
    "110C": "自強(E3)",
    "110D": "自強(D28)",
    "110E": "自強(D29)",
    "110F": "自強(D31)",
    "1106": "自強(商專)",
    "110G": "自強(3000障)",
    "110H": "自強(3000親障)",
}

# 5 大分組上色（依 CARCLASS_TABLE 中文名稱關鍵字判斷）
GROUPS = [
    ("自強", "自強", "#C0392B"),
    ("莒光", "莒光/復興", "#E8792B"),
    ("復興", "莒光/復興", "#E8792B"),
    ("區間快", "區間快", "#16A085"),
    ("區間車", "區間車", "#2E6FB0"),
]
OTHER_TYPENAME, OTHER_COLOR = "其他", "#8E44AD"


def classify_carclass(car_class, unknown_codes_seen):
    name = CARCLASS_TABLE.get(car_class)
    if name is None:
        # 未收錄代碼：110 開頭比照自強號慣例（110G/110H 已驗證皆為自強）
        unknown_codes_seen[car_class] += 1
        if car_class.startswith("110"):
            return "自強", "#C0392B"
        return OTHER_TYPENAME, OTHER_COLOR
    for keyword, type_name, color in GROUPS:
        if keyword in name:
            return type_name, color
    return OTHER_TYPENAME, OTHER_COLOR


def http_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def parse_list_page(list_html):
    """回傳 {YYYYMMDD: resource_id}。"""
    rows = re.findall(
        r'exceptionDataResource/([0-9a-f]+)">(\d{8})\.json</a>', list_html
    )
    if not rows:
        raise RuntimeError("列表頁解析不到任何 exceptionDataResource 連結，頁面格式可能已變更")
    return {date: rid for rid, date in rows}


def pick_days(by_date, start_date, days):
    """從 start_date 起連續 days 天中，挑出清單裡真的發佈得到的每一天。
    回傳 [(YYYYMMDD, resource_id), ...] 依日期遞增。"""
    out = []
    for i in range(days):
        ds = (start_date + datetime.timedelta(days=i)).strftime("%Y%m%d")
        if ds in by_date:
            out.append((ds, by_date[ds]))
    return out


def parse_hms_to_sec(hms):
    h, m, s = hms.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def build_trains_for_day(train_infos, station_index, unknown_codes_seen,
                         typename_color_seen, drop_stats):
    """把單日 TrainInfos 清洗成 train 物件清單（schema 與舊單日版逐欄相同：
    train/typeName/carName/color/stops）。跨午夜、丟站清洗邏輯與舊版一致。
    drop_stats 為累加用的 Counter。"""
    trains_out = []
    for t in train_infos:
        car_class = t.get("CarClass", "")
        type_name, color = classify_carclass(car_class, unknown_codes_seen)
        typename_color_seen[type_name] = color

        time_infos = sorted(t["TimeInfos"], key=lambda ti: int(ti["Order"]))

        raw_stops = []
        for ti in time_infos:
            code = ti["Station"]
            st = station_index.get(code)
            if st is None:
                drop_stats["dropped_stops"] += 1
                continue
            raw_stops.append((ti, st))

        if len(raw_stops) < 2:
            drop_stats["dropped_trains_no_coord"] += 1
            continue

        offset = 0
        prev_abs = None
        stops_out = []
        for ti, st in raw_stops:
            arr_raw = parse_hms_to_sec(ti["ARRTime"])
            dep_raw = parse_hms_to_sec(ti["DEPTime"])
            arr_abs = arr_raw + offset
            if prev_abs is not None and arr_abs < prev_abs:
                offset += 86400
                arr_abs = arr_raw + offset
            dep_abs = dep_raw + offset
            if dep_abs < arr_abs:
                offset += 86400
                dep_abs = dep_raw + offset
            prev_abs = dep_abs
            stops_out.append(
                {
                    "name": st["name"],
                    "lat": st["lat"],
                    "lon": st["lon"],
                    "order": int(ti["Order"]),
                    "arrSec": arr_abs,
                    "depSec": dep_abs,
                }
            )

        if len(stops_out) < 2:
            drop_stats["dropped_trains_too_short"] += 1
            continue

        trains_out.append(
            {
                "train": t["Train"],
                "typeName": type_name,
                "carName": CARCLASS_TABLE.get(car_class, car_class),
                "color": color,
                "stops": stops_out,
            }
        )
    return trains_out


def train_identity(tr):
    """班次定義內容 hash：車次號 + 全部停靠（站名/順序/到站秒/離站秒）。
    跨日相同者共用一份；同車次不同日時刻不同（臨時改點）→ hash 不同 → 各存一份。"""
    parts = [str(tr["train"])]
    for s in tr["stops"]:
        parts.append("{name}|{order}|{arr}|{dep}".format(
            name=s["name"], order=s["order"], arr=s["arrSec"], dep=s["depSec"]))
    return hashlib.md5("\n".join(parts).encode("utf-8")).hexdigest()


def yyyymmdd_to_dash(ds):
    return "{}-{}-{}".format(ds[0:4], ds[4:6], ds[6:8])


def main():
    today = datetime.date.today()
    today_str = today.strftime("%Y%m%d")

    print("下載鐵路時刻表清單頁 ...", file=sys.stderr)
    list_html = http_get(LIST_URL).decode("utf-8")
    by_date = parse_list_page(list_html)
    days = pick_days(by_date, today, DAYS_AHEAD)
    if len(days) < MIN_DAYS_OK:
        raise RuntimeError(
            f"今天({today_str})起 {DAYS_AHEAD} 天內清單只發佈了 {len(days)} 天"
            f"（需 ≥{MIN_DAYS_OK}）：{[d for d, _ in days]}。清單頁最新日期={max(by_date) if by_date else '無'}"
        )
    print(f"將抓取 {len(days)} 天：{days[0][0]}…{days[-1][0]}", file=sys.stderr)

    print("下載官方車站基本資料集（站碼→站名→GPS）...", file=sys.stderr)
    stations_raw = http_get(STATIONS_URL)
    stations_list = json.loads(stations_raw.decode("utf-8"))
    station_index = {}
    bad_gps_codes = []
    for s in stations_list:
        code = s.get("stationCode")
        gps = (s.get("gps") or "").split()
        if len(gps) != 2:
            bad_gps_codes.append(code)
            continue
        try:
            lat, lon = float(gps[0]), float(gps[1])
        except ValueError:
            bad_gps_codes.append(code)
            continue
        if not (LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX):
            bad_gps_codes.append(code)
            continue
        station_index[code] = {"name": s.get("stationName"), "lat": lat, "lon": lon}
    print(f"車站清單共 {len(stations_list)} 站，可用座標 {len(station_index)} 站（不可用：{bad_gps_codes}）", file=sys.stderr)

    unknown_codes_seen = collections.Counter()
    drop_stats = collections.Counter()
    typename_color_seen = {}

    # 跨日去重聯集：hash → union 索引；dates: 日期(YYYY-MM-DD) → [union 索引,...]
    union_trains = []
    hash_to_idx = {}
    dates_map = {}
    per_day_counts = {}       # 日期 → 該日產出車次數（供 G1 對帳）
    raw_counts = {}           # 日期 → 該日官方原始車次數
    update_times = {}         # 日期 → 該日檔 UpdateTime

    for ds, rid in days:
        dash = yyyymmdd_to_dash(ds)
        raw = json.loads(http_get(SCHEDULE_URL_TMPL.format(id=rid)).decode("utf-8"))
        train_infos = raw["TrainInfos"]
        update_times[dash] = raw.get("UpdateTime", "")
        raw_counts[dash] = len(train_infos)
        day_trains = build_trains_for_day(
            train_infos, station_index, unknown_codes_seen, typename_color_seen, drop_stats
        )
        per_day_counts[dash] = len(day_trains)
        idxs = []
        for tr in day_trains:
            h = train_identity(tr)
            idx = hash_to_idx.get(h)
            if idx is None:
                idx = len(union_trains)
                hash_to_idx[h] = idx
                union_trains.append(tr)
            idxs.append(idx)
        dates_map[dash] = idxs
        print(f"  {dash}: 原始 {len(train_infos)} → 產出 {len(day_trains)} 車次"
              f"（聯集累計 {len(union_trains)} 份唯一定義）", file=sys.stderr)

    date_keys = sorted(dates_map)
    types_out = [{"key": k, "color": v} for k, v in sorted(typename_color_seen.items())]

    source_notes = (
        f"時刻表來源：{LIST_URL} 清單頁，抓取今天({yyyymmdd_to_dash(today_str)})起連續 {DAYS_AHEAD} 天中"
        f"實際發佈得到的 {len(date_keys)} 天（{date_keys[0]}…{date_keys[-1]}），"
        f"各日下載自 {SCHEDULE_URL_TMPL.format(id='<resourceId>')}。各日 UpdateTime：{update_times}。"
        f" 跨日去重聯集：班次定義以「車次號＋全部停靠(站名/順序/到站秒/離站秒)」內容 hash，"
        f"跨日相同者共用一份；輸出 dates:{{日期→[trains 索引]}}，trains 為唯一定義聯集（共 {len(union_trains)} 份）。"
        f"同車次不同日時刻不同（臨時改點）→ hash 不同 → 各存一份、各日各指各的。"
        f" 站碼→站名→座標來源：官方車站基本資料集 {STATIONS_URL}"
        f"（{len(stations_list)} 站，gps 欄位為 \"lat lon\"）；未使用專案內 data/tra.json 的站名比對退路。"
        f" 車種分類依官方 CarClass 列車種類代碼表"
        "（devDoc: https://ods.railway.gov.tw/tra-ods-web/ods/download/devDoc/"
        "8ae4cac27f4c0348017f4dbdd21d0181 第8-9頁）依中文名稱關鍵字分 5 組："
        "自強→#C0392B、莒光/復興→#E8792B、區間快→#16A085、區間車→#2E6FB0、其他→#8E44AD。"
        f" 代碼表未收錄、依「110」開頭自強號系列命名慣例歸類為自強的未知代碼與出現次數："
        f"{dict(unknown_codes_seen) if unknown_codes_seen else '無'}（此為命名慣例推斷，非官方逐字確認）。"
        " 跨午夜處理：同一車次內若後一停靠站原始時刻小於前一站，累加 86400 秒使 arrSec/depSec 全程單調遞增。"
        f" 資料清洗（跨全部日期累計）：因查無站碼座標而整站被丟棄的 stop 數={drop_stats['dropped_stops']}；"
        f"因清洗後剩不足 2 站而整筆丟棄的車次數="
        f"{drop_stats['dropped_trains_no_coord'] + drop_stats['dropped_trains_too_short']}。"
        f" 各日產出車次數：{per_day_counts}。"
    )

    output = {
        "system": "台鐵時刻表",
        "date": date_keys[0],
        "dateRange": [date_keys[0], date_keys[-1]],
        "dates": dates_map,
        "source_notes": source_notes,
        "types": types_out,
        "trains": union_trains,
    }

    out_path = "data/tra_schedule.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"已寫入 {out_path}：{len(date_keys)} 天、{len(union_trains)} 份唯一班次定義", file=sys.stderr)
    print(f"丟棄統計：dropped_stops={drop_stats['dropped_stops']}, "
          f"dropped_trains(too_short_after_cleaning)="
          f"{drop_stats['dropped_trains_no_coord'] + drop_stats['dropped_trains_too_short']}", file=sys.stderr)


if __name__ == "__main__":
    main()
