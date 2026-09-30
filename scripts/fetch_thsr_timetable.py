#!/usr/bin/env python3
"""
抓「車站時刻頁」用的兩份資料(只給靜態頁產生器 build_aeo_pages 用,正式站與 App 執行時都不讀):

1. 高鐵逐日時刻表:TDX v2 Rail/THSR/DailyTimetable/TrainDates 查可用日期,
   再逐日打 Rail/THSR/DailyTimetable/TrainDate/{date}(站上 Worker 用的是同一端點,見 worker.js
   fetchThsrDaily)。取「今天(台北時間)起」最多 14 個可用日;可用日不足 14 就抓有的,
   dateRange 照實記。
   → scripts/seo_data/thsr_timetable.json(形狀比照 data/tra_schedule_dense.json 的多日格式)
2. 台鐵路線名:TDX v3 Rail/TRA/Line(與 data/tra_station_of_line.json 同為 v3 家族,
   lineId 逐一對得上)。→ scripts/seo_data/tra_line_names.json,{lineId: {zh, en}}。
   TDX 沒有日文,不在這裡編;對不上 station_of_line 的 lineId 只列出來(WARN),不編名稱。

為什麼放 scripts/seo_data/ 而不是 data/:
  - wrangler 出貨:.assetsignore 有 `scripts`(整個目錄不當靜態資產上傳)。
  - App bundle:app/scripts/prepare-web.mjs 的 copyTree 會把 data/ 底下**所有 git 追蹤檔**打包,
    沒有排除名單可掛;scripts/ 不在它複製的目錄內。放 data/ 就得改 prepare-web,放這裡零改動。

失敗(HTTP 非 200、可用日為 0、某天回空陣列、JSON 形狀不對)一律非零離開,
兩個輸出檔都先寫暫存檔、全部備妥才 rename,不會留半份。

決定性:同一份原始回應永遠產出逐 byte 相同的檔(排序與 key 順序固定,不讀時鐘——
fetched_at 是抓取當下記進 raw 目錄 meta.json 的值,離線重建沿用它)。

用法:
  set -a && . ./.env && set +a          # 或 .env 在 repo 根
  python3 scripts/fetch_thsr_timetable.py                       # 線上抓、寫輸出
  python3 scripts/fetch_thsr_timetable.py --raw-dir /tmp/raw    # 同上,並把原始回應存下(不進 repo)
  python3 scripts/fetch_thsr_timetable.py --from-raw /tmp/raw   # 離線重建(驗決定性用,不碰網路)
  選項:--days N(預設 14)、--start YYYY-MM-DD(預設今天台北時間)、--out-dir DIR
"""
import os, sys, json, time, argparse, datetime, urllib.request, urllib.parse, urllib.error

AUTH = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token"
BASE = "https://tdx.transportdata.tw/api/basic"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(HERE, "scripts", "seo_data")
THSR_FILE, LINE_FILE = "thsr_timetable.json", "tra_line_names.json"
TAIPEI = datetime.timezone(datetime.timedelta(hours=8))


def die(msg):
    print("ERROR: " + msg, file=sys.stderr)
    sys.exit(1)


# ── 網路 ────────────────────────────────────────────────────────────────

def _dotenv(name):
    try:
        with open(os.path.join(HERE, ".env"), encoding="utf-8") as f:
            for ln in f:
                ln = ln.strip()
                if ln and not ln.startswith("#") and "=" in ln:
                    k, v = ln.split("=", 1)
                    if k.strip() == name:
                        return v.strip().strip('"').strip("'")
    except OSError:
        pass
    return None


def get_token():
    cid = os.environ.get("TDX_CLIENT_ID") or _dotenv("TDX_CLIENT_ID")
    sec = os.environ.get("TDX_CLIENT_SECRET") or _dotenv("TDX_CLIENT_SECRET")
    if not cid or not sec:
        die("找不到 TDX_CLIENT_ID / TDX_CLIENT_SECRET(環境變數與 repo 根的 .env 都沒有)")
    body = urllib.parse.urlencode({"grant_type": "client_credentials",
                                   "client_id": cid, "client_secret": sec}).encode()
    req = urllib.request.Request(AUTH, data=body,
                                 headers={"content-type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())["access_token"]


def api_get(path, tok):
    """回傳原始 bytes(存 raw 用),呼叫端再 json.loads。429 退避重試;其餘非 200 直接丟例外。"""
    url = f"{BASE}/{path}" + ("&" if "?" in path else "?") + "$format=JSON"
    req = urllib.request.Request(url, headers={"authorization": "Bearer " + tok,
                                               "accept": "application/json",
                                               "accept-encoding": "identity"})
    for _ in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                if r.status != 200:
                    die(f"{path} HTTP {r.status}")
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(20)
                continue
            die(f"{path} HTTP {e.code}")
    die(f"{path} 429 重試耗盡")


# ── 原始回應 → 兩份輸出(純函式,不讀時鐘、不碰網路)──────────────────────────

def hms_to_sec(t):
    """'HH:MM' 或 'HH:MM:SS' → 午夜起算秒(語意同 worker.js thsrHmsToSec)。"""
    p = [int(x) for x in str(t).split(":")]
    if len(p) < 2 or not all(0 <= x for x in p):
        raise ValueError(f"時間格式不對:{t!r}")
    return p[0] * 3600 + p[1] * 60 + (p[2] if len(p) > 2 else 0)


def convert_day(day_iso, records):
    """TDX TrainDate/{date}(陣列)→ [{train, stops:[{name, arrSec, depSec}]}]。
    跨午夜:時間比前一個時間小就 +86400(同 worker.js thsrConvertDaily;秒數 ≥86400 即隔日)。"""
    if not isinstance(records, list) or not records:
        raise ValueError(f"{day_iso}:回應不是非空陣列")
    out = []
    for rec in records:
        info = rec.get("DailyTrainInfo") if isinstance(rec, dict) else None
        stops = rec.get("StopTimes") if isinstance(rec, dict) else None
        if not isinstance(info, dict) or not info.get("TrainNo") or not isinstance(stops, list) or len(stops) < 2:
            raise ValueError(f"{day_iso}:班次形狀不對:{json.dumps(rec, ensure_ascii=False)[:200]}")
        seq = sorted(stops, key=lambda s: s["StopSequence"])
        prev, conv = -1, []
        for s in seq:
            name = (s.get("StationName") or {}).get("Zh_tw")
            a, d = s.get("ArrivalTime") or s.get("DepartureTime"), s.get("DepartureTime") or s.get("ArrivalTime")
            if not name or not a or not d:
                raise ValueError(f"{day_iso} 車次 {info['TrainNo']}:停靠點缺站名或時間:{s}")
            arr, dep = hms_to_sec(a), hms_to_sec(d)
            while arr < prev:
                arr += 86400
            while dep < arr:
                dep += 86400
            conv.append({"name": name, "arrSec": arr, "depSec": dep})
            prev = dep
        out.append({"train": str(info["TrainNo"]), "stops": conv})
    return out


def build_thsr(raw):
    """raw = {meta, dates_resp, days:{date: records}} → 輸出物件。"""
    days = sorted(raw["days"])
    if not days:
        raise ValueError("沒有任何日期")
    uniq = {}                      # key → 暫定物件;key 是內容,與抓取順序無關
    per_day = {}
    for d in days:
        keys = []
        for tr in convert_day(d, raw["days"][d]):
            key = json.dumps(tr, ensure_ascii=False, separators=(",", ":"))
            uniq.setdefault(key, tr)
            keys.append(key)
        per_day[d] = keys
    # 固定順序:車次號 → 首站開車秒 → 內容字串(同車次改點前後各一版時靠它定序)
    order = sorted(uniq, key=lambda k: (uniq[k]["train"], uniq[k]["stops"][0]["depSec"], k))
    index = {k: i for i, k in enumerate(order)}
    dates = {d: sorted(set(index[k] for k in per_day[d])) for d in days}
    # 同一天內同一份定義不該出現兩次(會讓「每天班數」對不上原始筆數)
    for d in days:
        if len(per_day[d]) != len(dates[d]):
            raise ValueError(f"{d}:同日出現完全相同的重複班次")
    dr = raw["dates_resp"]
    return {
        "source": "TDX v2 Rail/THSR/DailyTimetable/TrainDate/{date}(逐日,本檔為 dateRange 內各日的去重聯集);"
                  "可用日期取自 Rail/THSR/DailyTimetable/TrainDates。時刻只到分,秒數從當日 00:00 起算,"
                  "跨午夜 ≥86400。同車次、同停靠、同時刻的班次在各日之間共用一筆,dates 是「日期→trains 索引」。",
        "fetched_at": raw["meta"]["fetched_at"],
        "availableRange": [dr["StartDate"], dr["EndDate"]],
        "dateRange": [days[0], days[-1]],
        "dates": dates,
        "trains": [uniq[k] for k in order],
    }


def build_lines(raw):
    resp = raw["line_resp"]
    lines = resp.get("Lines") if isinstance(resp, dict) else None
    if not isinstance(lines, list) or not lines:
        raise ValueError("Rail/TRA/Line 回應沒有 Lines 陣列")
    names = {}
    for x in lines:
        lid, nm = x.get("LineID"), x.get("LineName") or {}
        if not lid or not nm.get("Zh_tw") or not nm.get("En"):
            raise ValueError(f"路線缺 LineID 或中英名:{x}")
        if lid in names:
            raise ValueError(f"LineID 重複:{lid}")
        names[lid] = {"zh": nm["Zh_tw"], "en": nm["En"]}
    return {
        "source": "TDX v3 Rail/TRA/Line(LineName.Zh_tw / LineName.En 字面照抄;TDX 沒有日文)",
        "fetched_at": raw["meta"]["fetched_at"],
        "tdx_update_time": resp.get("UpdateTime"),
        "lines": {k: names[k] for k in sorted(names)},
    }


def dump_thsr(obj):
    """key 順序固定;trains 一班一行,git diff 看得懂。"""
    head = [f'"{k}":{json.dumps(obj[k], ensure_ascii=False, separators=(",", ":"))}'
            for k in ("source", "fetched_at", "availableRange", "dateRange", "dates")]
    trains = ",\n".join(json.dumps(t, ensure_ascii=False, separators=(",", ":")) for t in obj["trains"])
    return "{" + ",\n".join(head) + ',\n"trains":[\n' + trains + "\n]}\n"


def dump_lines(obj):
    rows = ",\n".join(f'{json.dumps(k, ensure_ascii=False)}:{json.dumps(v, ensure_ascii=False, separators=(",", ":"))}'
                      for k, v in obj["lines"].items())
    head = ",\n".join(f'"{k}":{json.dumps(obj[k], ensure_ascii=False)}' for k in ("source", "fetched_at", "tdx_update_time"))
    return "{" + head + ',\n"lines":{\n' + rows + "\n}}\n"


# ── 原始回應的存取 ────────────────────────────────────────────────────────

def save_raw(d, raw_bytes, meta):
    os.makedirs(d, exist_ok=True)
    for name, b in raw_bytes.items():
        with open(os.path.join(d, name), "wb") as f:
            f.write(b)
    with open(os.path.join(d, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)


def load_raw(d):
    def rd(n):
        with open(os.path.join(d, n), "rb") as f:
            return json.loads(f.read().decode("utf-8"))
    meta = rd("meta.json")
    return {"meta": meta, "dates_resp": rd("TrainDates.json"), "line_resp": rd("TraLine_v3.json"),
            "days": {dt: rd(f"TrainDate_{dt}.json") for dt in meta["days"]}}


# ── 主流程 ────────────────────────────────────────────────────────────────

def fetch_online(days_n, start_override):
    tok = get_token()                      # 整支腳本只拿這一次(token 端點每 IP 每分鐘 20 次)
    print("  got token", flush=True)
    raw_bytes = {}
    b = api_get("v2/Rail/THSR/DailyTimetable/TrainDates", tok)
    raw_bytes["TrainDates.json"] = b
    dr = json.loads(b)
    avail = dr.get("TrainDates") if isinstance(dr, dict) else None
    if not isinstance(avail, list) or not avail or "StartDate" not in dr or "EndDate" not in dr:
        die("TrainDates 回應形狀不對或沒有可用日期")
    today = datetime.datetime.now(TAIPEI).date().isoformat()
    start = start_override or today
    pick = sorted(d for d in avail if d >= start)[:days_n]
    if not pick:
        die(f"可用日期 {avail[0]}…{avail[-1]} 裡沒有 {start} 之後的日子")
    print(f"  可用 {avail[0]}…{avail[-1]}({len(avail)} 天);抓 {pick[0]}…{pick[-1]}({len(pick)} 天,起點 {start})", flush=True)
    for d in pick:
        raw_bytes[f"TrainDate_{d}.json"] = api_get(f"v2/Rail/THSR/DailyTimetable/TrainDate/{d}", tok)
        time.sleep(0.3)
    raw_bytes["TraLine_v3.json"] = api_get("v3/Rail/TRA/Line", tok)
    meta = {"fetched_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "start": start, "days": pick}
    return raw_bytes, meta


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=14)
    ap.add_argument("--start", help="起始日 YYYY-MM-DD(預設今天,台北時間)")
    ap.add_argument("--raw-dir", help="線上抓取時,把原始回應存到這裡(不進 repo)")
    ap.add_argument("--from-raw", help="離線:從這個原始回應目錄重建,不碰網路")
    ap.add_argument("--out-dir", default=DEFAULT_OUT)
    a = ap.parse_args()

    try:
        if a.from_raw:
            raw = load_raw(a.from_raw)
        else:
            try:
                raw_bytes, meta = fetch_online(a.days, a.start)
            except (urllib.error.URLError, OSError, json.JSONDecodeError) as e:
                die(f"抓取失敗:{type(e).__name__}: {e}")
            if a.raw_dir:
                save_raw(a.raw_dir, raw_bytes, meta)
            raw = {"meta": meta, "dates_resp": json.loads(raw_bytes["TrainDates.json"]),
                   "line_resp": json.loads(raw_bytes["TraLine_v3.json"]),
                   "days": {d: json.loads(raw_bytes[f"TrainDate_{d}.json"]) for d in meta["days"]}}
        thsr, lines = build_thsr(raw), build_lines(raw)
    except (ValueError, KeyError, TypeError) as e:
        die(f"原始回應不符預期:{type(e).__name__}: {e}")

    # 路線名對照:只列出對不上的,不編名稱
    try:
        with open(os.path.join(HERE, "data", "tra_station_of_line.json"), encoding="utf-8") as f:
            sol = {l["lineId"] for l in json.load(f)["lines"]}
        miss, extra = sorted(sol - set(lines["lines"])), sorted(set(lines["lines"]) - sol)
        print(f"  路線名:TDX {len(lines['lines'])} 條;station_of_line {len(sol)} 條;"
              f"station_of_line 缺名稱={miss};TDX 多出={extra}")
        if miss:
            print(f"  WARN: 這些 lineId 沒有 TDX 名稱,產生器必須處理(不可自編):{miss}", file=sys.stderr)
    except OSError:
        print("  WARN: 找不到 data/tra_station_of_line.json,略過路線名對照", file=sys.stderr)

    # 印每天班數(該日 TDX 回應的班次數)
    print(f"  高鐵涵蓋 {thsr['dateRange'][0]}…{thsr['dateRange'][1]}(可用 {thsr['availableRange'][0]}…{thsr['availableRange'][1]}),"
          f"trains {len(thsr['trains'])} 份定義")
    print("  每天班數:" + "、".join(f"{d}={len(ix)}" for d, ix in thsr["dates"].items()))

    os.makedirs(a.out_dir, exist_ok=True)
    targets = [(os.path.join(a.out_dir, THSR_FILE), dump_thsr(thsr)),
               (os.path.join(a.out_dir, LINE_FILE), dump_lines(lines))]
    tmps = []
    try:
        for path, text in targets:
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(text)
            tmps.append((tmp, path))
        for tmp, path in tmps:
            os.replace(tmp, path)
    finally:
        for tmp, _ in tmps:
            if os.path.exists(tmp):
                os.remove(tmp)
    for path, text in targets:
        print(f"  → {os.path.relpath(path, HERE)}  ({len(text.encode('utf-8'))} bytes)")
    print("DONE")


if __name__ == "__main__":
    main()
