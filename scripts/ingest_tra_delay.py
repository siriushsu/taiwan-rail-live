#!/usr/bin/env python3
"""
ingest_tra_delay.py —— 台鐵誤點歷史「每日增量」腳本（TDX Historical LiveTrainDelay -> D1）

用途
----
每天跑一次（建議排程在台北時間 09:30 之後，因為 TDX 歷史服務每天 08:00(TW) 才把「昨天」
的資料補齊；09:00 前跑會抓不到昨天）：

    python3 ingest_tra_delay.py

會自動：
  1. 算出 D1 近 35 天（到「TDX 目前應該已更新到的最後一天」為止）缺哪些 service_date。
  2. 依時間序（舊到新）逐日各發一次 TDX 請求（上限 --max-dates，預設 7 天／次，
     避免單次執行抓太多天、也避免超過節流時間太久）。
  3. 把每天的原始逐站事件解析成 per (service_date, train_no) 一列，套用「00:00–03:00
     事件併回前一天」的跨日規則，INSERT OR REPLACE 冪等寫回 D1 tra_delay_daily。
  4. 重建近 30 天（日曆窗，非「有資料的 30 天」）逐車次統計，寫回 D1 kv_blobs
     （key='tra_delay_stats_30d'），供 worker.js 的 /api/delay-stats 唯讀查詢直接吐回。

模式
----
    python3 ingest_tra_delay.py                     # 預設：抓缺日（上限 --max-dates）＋重建 blob
    python3 ingest_tra_delay.py --status             # 只查近 35 天缺哪些 service_date，不寫入
    python3 ingest_tra_delay.py --dry-run            # 照常抓 TDX 資料，但所有 D1 寫入改成印出 SQL 摘要
    python3 ingest_tra_delay.py --rebuild-blob-only  # 不抓新資料，只用現有 D1 資料重建 30 天 blob
    python3 ingest_tra_delay.py --max-dates 3        # 本次最多抓 3 天（預設 7）

環境需求
--------
- 只用 python3 標準庫，無第三方套件依賴（stdlib-only，故意如此，避免正式環境要另外裝套件）。
- 讀取 repo 的 .env（固定路徑，見 ENV_PATH）取得 TDX_CLIENT_ID / TDX_CLIENT_SECRET，
  只在記憶體使用，絕不印出、絕不落地（見 redact_check）。
- 遠端 D1 讀寫一律 shell out 給 wrangler CLI（不直連 D1 HTTP API）。執行檔由環境變數
  WRANGLER_BIN 指定，預設 "npx wrangler"——需在裝有 wrangler 的目錄下執行（例如 repo
  根目錄），或把 WRANGLER_BIN 設成已安裝執行檔的絕對路徑。D1 database name 固定
  "railisland-delay-history"（wrangler.jsonc 的 d1_databases binding 需對應同一個庫，
  binding 名稱 DELAY_DB，見 worker.js 的 /api/delay-stats）。

已知地雷（P0 實測，本腳本已處理，見對應函式註解）
--------------------------------------------
- TDX JSONL 回應開頭有 BOM -> 一律用 utf-8-sig 解碼（parse_jsonl_body）。
- SrcUpdateTime 是 UTC，不是台北時間（OAS 範例的 +08:06 是誤導性佔位符）-> 一律
  astimezone(+8) 後才能判斷日期／跨日（group_and_sort）。
- $top 不帶或帶小值只回 30 筆 -> 固定帶 $top=1000000（fetch_day）。
- 單次 Dates 最多查 7 天 -> 本腳本刻意逐日各發一次請求（不做多日批次一次拉），確保
  「一天一次寫入、失敗只影響那一天」的原子性，也符合「按時間序逐日抓」的規格。
- 呼叫間隔 >= 1.6 秒（節流，見 _throttle）；429 時等 5 秒重試一次，仍失敗則該日視為
  失敗、中止本次執行（不繼續抓更晚的日期，因為跨日規則要求嚴格時間序；下次執行的
  缺日偵測會自動從失敗的那天重新開始，不需要人工介入）。
- 終點站永遠不會出現「離站」事件（欄位說明：事件是離站壓軌觸發）-> 本資料集的
  final_delay 其實是「離開終點前一站當下的誤點」，不是嚴格意義的抵達終點誤點；
  UI／文案措辭不要寫死「抵達終點誤點」。

跨日規則（核心邏輯，process_day）
--------------------------------
台北時間 00:00–03:00 的事件，若 D1 裡 (前一天, 同車次) 那列存在、且其 last_seen
（轉台北時間後）日期仍是前一天、時間 >= 22:00，代表前一天那班車跑到深夜、這些早班
事件是它的尾段 -> UPDATE 前一天那列的 final_delay/max_delay/events/last_station/
last_seen 併入這些事件；其餘（>=03:00 的）事件才組成當天自己的一列，INSERT OR REPLACE。
若前一天那列不存在、或存在但沒有跨午夜（last_seen 判定不成立），當天的列就用當天
「全部」事件（不分早晚）組成——沒有合併對象，不能無中生有把早班事件切給不存在的前一天。

冪等重跑保護：若前一天那列的 last_seen 已經落在「今天」的 00:00–03:00（代表前一次
執行已經把今天的早班事件併過去了），本次不會重複再併一次（避免同一批事件被計兩次），
今天自己的列一樣只取 >=03:00 的事件（早班事件視為已經歸屬前一天，不會回流到今天）。

未在本次任務驗證的風險（寫腳本時全程禁止對遠端 D1／TDX 呼叫，見交付回報）
------------------------------------------------------------------
- wrangler d1 execute --file ... --remote --json 的實際輸出 JSON 形狀，是依 wrangler
  公開文件與常見慣例假設實作（見 _parse_wrangler_json 的容錯設計），未能在本任務內對
  真正的遠端 D1 實跑驗證。首次正式使用前，建議先用一句無害查詢
  （例如 SELECT COUNT(*) FROM tra_delay_daily）手動確認 wrangler 版本的 --json 輸出
  形狀與本腳本的解析邏輯相符。
- 本機這份 repo 的 node_modules 目前有平台不符的問題（workerd darwin-arm64 vs
  darwin-64），導致本機連 `npx wrangler --help` 都跑不動；這與本腳本邏輯無關，但代表
  「實際執行」這一步在這台機器上可能需要先修好 wrangler 安裝，或換一台機器/CI 執行。
"""
import argparse
import datetime
import decimal
import gzip
import json
import math
import os
import re
import shlex
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

# ---------------------------------------------------------------------------
# 常數
# ---------------------------------------------------------------------------

ENV_PATH = "/Users/xuxiang/Code/捷運小動畫/.env"  # 只讀，不寫；金鑰只進記憶體
AUTH_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token"
HIST_BASE = "https://tdx.transportdata.tw/api/historical"
HIST_PATH = "/v2/Historical/Rail/TRA/LiveTrainDelay"

D1_DB_NAME = "railisland-delay-history"
TABLE = "tra_delay_daily"
KV_TABLE = "kv_blobs"
KV_BLOB_KEY = "tra_delay_stats_30d"

TW = datetime.timezone(datetime.timedelta(hours=8))
UTC = datetime.timezone.utc

MIN_INTERVAL = 1.6  # 秒；節流鐵則 >=1.5s，抓多一點餘裕
WINDOW_DAYS_STATUS = 35  # --status／缺日偵測的觀察窗
BLOB_WINDOW_DAYS = 30  # 統計 blob 的日曆窗
DEFAULT_MAX_DATES = 7  # 單次執行最多抓幾天

SCHEMA_SQL = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
  service_date  TEXT NOT NULL,
  train_no      TEXT NOT NULL,
  final_delay   INTEGER NOT NULL,
  max_delay     INTEGER NOT NULL,
  events        INTEGER NOT NULL,
  last_station  TEXT NOT NULL,
  last_seen     TEXT NOT NULL,
  PRIMARY KEY (service_date, train_no)
);
CREATE TABLE IF NOT EXISTS {KV_TABLE} (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
"""
# 注意：正式環境的 D1 schema 由另一支匯入管線建立（見 staging/scripts/step7_export_d1.py
# ／step8_gen_sql.py），本腳本假設 schema 已存在，正常執行路徑不會主動 CREATE TABLE——
# 這裡的 SCHEMA_SQL 只給本機 sqlite3 回歸測試模擬 D1 用（單一事實來源，避免測試 schema
# 與本腳本假設的欄位漂移）。


# ---------------------------------------------------------------------------
# .env / OAuth（自成一體，不依賴 staging 的 tdx_lib.py——本檔要能單獨搬進 repo/scripts/）
# ---------------------------------------------------------------------------

def load_env():
    cid = sec = None
    with open(ENV_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k == "TDX_CLIENT_ID":
                cid = v
            elif k == "TDX_CLIENT_SECRET":
                sec = v
    if not cid or not sec:
        sys.exit(f"ERROR: TDX_CLIENT_ID / TDX_CLIENT_SECRET 未在 {ENV_PATH} 找到")
    return cid, sec


def redact_check(s):
    """安全網：任何要印出/寫檔的字串，若不慎含金鑰片段就中止。"""
    cid, sec = load_env()
    if cid in s or sec in s:
        raise RuntimeError("安全中止：偵測到金鑰片段出現在輸出內容中")


def get_token():
    cid, sec = load_env()
    body = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": cid,
        "client_secret": sec,
    }).encode()
    req = urllib.request.Request(AUTH_URL, data=body,
        headers={"content-type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=60) as r:
        tok = json.loads(r.read().decode())["access_token"]
    return tok  # 只回傳給呼叫端記憶體變數，不落地、不印出


# ---------------------------------------------------------------------------
# TDX 歷史服務 HTTP（節流、gzip、BOM、429 重試一次）
# ---------------------------------------------------------------------------

_last_call_ts = [0.0]


def _throttle():
    dt = time.time() - _last_call_ts[0]
    if dt < MIN_INTERVAL:
        time.sleep(MIN_INTERVAL - dt)
    _last_call_ts[0] = time.time()


def _hist_get_raw(params, token, timeout=180):
    _throttle()
    url = HIST_BASE + HIST_PATH + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "authorization": "Bearer " + token,
        "accept": "application/json, text/plain, */*",
        "accept-encoding": "gzip",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, dict(e.headers) if e.headers else {}, raw


def maybe_gunzip(raw_bytes, headers):
    enc = (headers.get("Content-Encoding") or headers.get("content-encoding") or "").lower()
    if enc == "gzip":
        try:
            return gzip.decompress(raw_bytes), True
        except OSError:
            return raw_bytes, False
    return raw_bytes, False


def fetch_day(date_obj, token):
    """抓單一 TW-local 日期的 LiveTrainDelay。429 等 5 秒重試一次；其餘非 200 直接丟例外
    （呼叫端負責決定要不要中止整批）。回傳 (records: list[dict], wire_bytes: int)。"""
    params = {"Dates": date_obj.isoformat(), "$format": "JSONL", "$top": "1000000"}
    status, headers, raw = _hist_get_raw(params, token)
    if status == 429:
        print("  429 rate limited，等 5 秒後重試一次...", flush=True)
        time.sleep(5)
        status, headers, raw = _hist_get_raw(params, token)
    if status != 200:
        body, _ = maybe_gunzip(raw, headers)
        err_txt = body.decode("utf-8", errors="replace")[:500]
        redact_check(err_txt)
        raise RuntimeError(f"TDX 非 200：status={status} date={date_obj.isoformat()} body={err_txt!r}")

    wire_bytes = len(raw)
    body, _ = maybe_gunzip(raw, headers)
    text = body.decode("utf-8-sig")  # BOM 地雷
    records = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return records, wire_bytes


# ---------------------------------------------------------------------------
# SQL escape / 建構
# ---------------------------------------------------------------------------

def sql_str(s):
    """SQL 字串常值跳脫（單引號雙寫），回傳含外層單引號的字面值。車次/站碼理應是英數，
    仍一律 escape（不可因為「應該安全」就跳過）。"""
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def sql_int(n):
    return str(int(n))


def build_upsert_sql(service_date, train_no, final_delay, max_delay, events, last_station, last_seen):
    return (
        f"INSERT OR REPLACE INTO {TABLE} "
        "(service_date, train_no, final_delay, max_delay, events, last_station, last_seen) VALUES ("
        f"{sql_str(service_date.isoformat())}, {sql_str(train_no)}, {sql_int(final_delay)}, "
        f"{sql_int(max_delay)}, {sql_int(events)}, {sql_str(last_station)}, {sql_str(last_seen)});"
    )


def build_merge_update_sql(prev_date, train_no, final_delay, max_delay, events, last_station, last_seen):
    return (
        f"UPDATE {TABLE} SET "
        f"final_delay={sql_int(final_delay)}, max_delay={sql_int(max_delay)}, events={sql_int(events)}, "
        f"last_station={sql_str(last_station)}, last_seen={sql_str(last_seen)} "
        f"WHERE service_date={sql_str(prev_date.isoformat())} AND train_no={sql_str(train_no)};"
    )


def build_blob_upsert_sql(key, value_json):
    return (f"INSERT OR REPLACE INTO {KV_TABLE} (k, v, updated) "
            f"VALUES ({sql_str(key)}, {sql_str(value_json)}, datetime('now'));")


# ---------------------------------------------------------------------------
# 四捨五入（Decimal 版 ROUND_HALF_UP，避免 Python 內建 round() 的 banker's rounding
# 跟中文「四捨五入」直覺不一致）
# ---------------------------------------------------------------------------

def round_half_up(value, ndigits=0):
    d = decimal.Decimal(str(value))
    if ndigits <= 0:
        q = d.quantize(decimal.Decimal("1"), rounding=decimal.ROUND_HALF_UP)
        return int(q)
    quant = decimal.Decimal("1").scaleb(-ndigits)
    q = d.quantize(quant, rounding=decimal.ROUND_HALF_UP)
    return float(q)


# ---------------------------------------------------------------------------
# 解析＋跨日合併核心邏輯（DB-adapter 無關，SqliteDB／D1Remote 皆可餵）
# ---------------------------------------------------------------------------

def group_and_sort(records):
    """把單日原始 TDX JSONL 記錄依 TrainNo 分組、SrcUpdateTime 轉台北時間並依時間排序。
    回傳 dict：train_no(str) -> list[(dt_tw, delay:int, station:str, src_iso:str)]。
    src_iso 保留原始 SrcUpdateTime 字串（UTC ISO，未經任何格式轉換），供 last_seen 落地用。
    欄位缺漏或型別不對的記錄直接跳過（不中止整批）。"""
    by_train = defaultdict(list)
    for r in records:
        try:
            src_iso = r["SrcUpdateTime"]
            dt_tw = datetime.datetime.fromisoformat(src_iso).astimezone(TW)
            train_no = str(r["TrainNo"])
            delay = int(r["DelayTime"])
            station = str(r["StationID"])
        except (KeyError, ValueError, TypeError):
            continue
        by_train[train_no].append((dt_tw, delay, station, src_iso))
    for k in by_train:
        by_train[k].sort(key=lambda e: e[0])
    return dict(by_train)


def process_day(db, service_date, records):
    """處理一天的原始事件，套用跨日合併規則，把結果 UPSERT 進 db（SqliteDB 或 D1Remote）。
    db 介面：query(sql)->list[dict]、execute(sql)（sql 可含多條 ;分隔陳述式）。
    回傳統計 dict：{'own_rows', 'merged_into_prev', 'trains'}。"""
    prev_date = service_date - datetime.timedelta(days=1)
    by_train = group_and_sort(records)

    # 一次查昨天全部列（不要逐車查——讀寫都走 wrangler shell out，次數要省）
    prev_rows = {}
    for r in db.query(f"SELECT * FROM {TABLE} WHERE service_date = {sql_str(prev_date.isoformat())};"):
        prev_rows[str(r["train_no"])] = r

    statements = []
    own_rows = 0
    merged_into_prev = 0

    for train_no, events in by_train.items():
        early = [e for e in events if e[0].hour < 3]
        rest = [e for e in events if e[0].hour >= 3]
        prev = prev_rows.get(train_no)

        merge_now = False
        already_absorbed = False
        if prev is not None and early:
            prev_last_tw = datetime.datetime.fromisoformat(str(prev["last_seen"])).astimezone(TW)
            if prev_last_tw.date() == prev_date and prev_last_tw.hour >= 22:
                # 前一天最後一筆事件確實落在 22:00 之後 -> 今天的早班事件是它的尾段
                merge_now = True
            elif prev_last_tw.date() == service_date and prev_last_tw.hour < 3:
                # 前一天那列的 last_seen 已經是「今天凌晨」-> 上一次執行已經併過了，
                # 冪等重跑保護：不要再併一次，但早班事件依然視為已歸屬前一天
                already_absorbed = True

        if merge_now:
            last_ev = early[-1]
            new_max = max(int(prev["max_delay"]), max(e[1] for e in early))
            new_events = int(prev["events"]) + len(early)
            statements.append(build_merge_update_sql(
                prev_date, train_no,
                final_delay=last_ev[1], max_delay=new_max, events=new_events,
                last_station=last_ev[2], last_seen=last_ev[3]))
            merged_into_prev += 1

        own_events = rest if (merge_now or already_absorbed) else (early + rest)
        if own_events:
            last_ev = own_events[-1]
            statements.append(build_upsert_sql(
                service_date, train_no,
                final_delay=last_ev[1],
                max_delay=max(e[1] for e in own_events),
                events=len(own_events),
                last_station=last_ev[2],
                last_seen=last_ev[3]))
            own_rows += 1
        # else: 全部事件都被併走且沒有剩餘 -> 今天這個車次沒有列（呼應 step6 的邏輯：
        # 純延續組不重複建列）

    if statements:
        db.execute("\n".join(statements))

    return {"own_rows": own_rows, "merged_into_prev": merged_into_prev, "trains": len(by_train)}


def rebuild_blob(db):
    """用 D1 目前的 tra_delay_daily 重建近 30 天（日曆窗，從 max(service_date) 往前
    29 天）逐車次統計，寫回 kv_blobs。D1 完全沒資料時回傳 None（不寫入、印警告）。"""
    max_rows = db.query(f"SELECT MAX(service_date) AS max_date FROM {TABLE};")
    max_date_str = max_rows[0].get("max_date") if max_rows else None
    if not max_date_str:
        print("警告：D1 內尚無任何 tra_delay_daily 資料，略過 blob 重建", flush=True)
        return None

    max_date = datetime.date.fromisoformat(max_date_str)
    start_date = max_date - datetime.timedelta(days=BLOB_WINDOW_DAYS - 1)

    rows = db.query(
        f"SELECT service_date, train_no, final_delay, max_delay FROM {TABLE} "
        f"WHERE service_date >= {sql_str(start_date.isoformat())} "
        f"AND service_date <= {sql_str(max_date.isoformat())};"
    )

    by_train = defaultdict(list)
    for r in rows:
        by_train[str(r["train_no"])].append(r)

    trains = {}
    for train_no, rs in by_train.items():
        finals = [int(r["final_delay"]) for r in rs]
        maxes = [int(r["max_delay"]) for r in rs]
        on_time = sum(1 for d in finals if d <= 5)
        trains[train_no] = {
            "a": round_half_up(sum(finals) / len(finals), 1),
            "p": round_half_up(100 * on_time / len(finals), 0),
            "d": len(rs),
            "m": max(maxes),
        }

    blob = {
        "_meta": {
            "window_days": BLOB_WINDOW_DAYS,
            "date_range": [start_date.isoformat(), max_date.isoformat()],
            "n_trains": len(trains),
            "generated": datetime.datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "note": "a=平均最終誤點(分,1位小數) p=準點率%(final_delay≤5,四捨五入整數) "
                    "d=有紀錄天數 m=單日最大誤點(分)。最終誤點=最後回報站(終點前一站)離站時誤點",
        },
        "trains": trains,
    }
    blob_json = json.dumps(blob, ensure_ascii=False, separators=(",", ":"))
    db.execute(build_blob_upsert_sql(KV_BLOB_KEY, blob_json))
    return blob


# ---------------------------------------------------------------------------
# 日期窗口計算
# ---------------------------------------------------------------------------

def taipei_now():
    return datetime.datetime.now(UTC).astimezone(TW)


def compute_latest_available_date():
    """TDX 每天台北時間 08:00 才把「昨天」的資料補齊。09:00 前執行（留 1 小時緩衝）
    就當昨天還沒到，最新可用日期退到前天。"""
    now_tw = taipei_now()
    yesterday = now_tw.date() - datetime.timedelta(days=1)
    if now_tw.hour < 9:
        return yesterday - datetime.timedelta(days=1)
    return yesterday


def compute_expected_window(window_days=WINDOW_DAYS_STATUS):
    latest = compute_latest_available_date()
    start = latest - datetime.timedelta(days=window_days - 1)
    return [start + datetime.timedelta(days=i) for i in range(window_days)]


def query_existing_dates(db, since_date):
    rows = db.query(
        f"SELECT DISTINCT service_date FROM {TABLE} "
        f"WHERE service_date >= {sql_str(since_date.isoformat())} ORDER BY service_date;"
    )
    return set(str(r["service_date"]) for r in rows)


# ---------------------------------------------------------------------------
# DB adapters
# ---------------------------------------------------------------------------

class SqliteDB:
    """本機 sqlite3 模擬 D1，供離線回歸測試用。與 D1Remote 共用同一組 SQL 字串
    （INSERT OR REPLACE / UPDATE 語法在 SQLite 與 D1 相容），確保測試真的在測
    ingest_tra_delay 會送去 D1 的那些陳述式，而不是另一套邏輯。"""

    def __init__(self, conn):
        self.conn = conn
        self.conn.row_factory = _sqlite3_row_factory()

    def query(self, sql):
        cur = self.conn.execute(sql)
        return [dict(r) for r in cur.fetchall()]

    def execute(self, sql):
        self.conn.executescript(sql)
        self.conn.commit()


def _sqlite3_row_factory():
    import sqlite3
    return sqlite3.Row


_STMT_HEAD_RE = re.compile(
    r"^\s*(INSERT OR REPLACE INTO|UPDATE|INSERT INTO|DELETE FROM)\s+(\w+)", re.IGNORECASE)


def summarize_sql(sql):
    stmts = [s.strip() for s in sql.split(";") if s.strip()]
    kinds = Counter()
    for s in stmts:
        m = _STMT_HEAD_RE.match(s)
        key = f"{m.group(1).upper()} {m.group(2)}" if m else "(其他/無法辨識)"
        kinds[key] += 1
    lines = [f"    共 {len(stmts)} 條陳述式："]
    for k, c in kinds.most_common():
        lines.append(f"      {k}: {c} 條")
    if stmts:
        sample = stmts[0][:200]
        lines.append(f"    範例(第1條前200字): {sample}")
    return "\n".join(lines)


def _parse_wrangler_json(stdout):
    """盡量寬容解析 wrangler d1 execute --json 的輸出。
    已知常見形狀（未在本任務內對真環境驗證，見腳本開頭風險註記）：
        [ { "results": [ {...column:value...}, ... ], "success": true, "meta": {...} }, ... ]
    也容忍：單一 dict（非 list）、results 缺失視為空、success=false 視為失敗中止。
    實測（2026-07-17）：--file 模式 stdout 前面會有「├ 🌀 Uploading…」等進度行，
    JSON 本體從第一個獨立成行的 [ 或 { 開始——先剝掉前綴再解析。"""
    lines = stdout.splitlines()
    start = next((i for i, ln in enumerate(lines) if ln.lstrip().startswith(("[", "{"))), None)
    if start is None:
        raise RuntimeError(f"wrangler --json 輸出找不到 JSON 本體: {stdout[:300]!r}")
    data = json.loads("\n".join(lines[start:]))
    if isinstance(data, dict):
        data = [data]
    if not isinstance(data, list):
        raise RuntimeError(f"wrangler --json 輸出非預期形狀: {type(data)}")
    rows = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        if entry.get("success") is False:
            raise RuntimeError(f"wrangler d1 execute 回報失敗: {entry}")
        for row in entry.get("results") or []:
            rows.append(row)
    return rows


class D1Remote:
    """透過 wrangler CLI shell out 讀寫遠端 D1。dry_run=True 時 execute() 只印 SQL 摘要、
    不實際送出（query() 不受 dry_run 影響——預覽模式仍要讀真實現況才有意義，只有「寫」
    被攔下）。"""

    def __init__(self, wrangler_bin, db_name, dry_run=False):
        self.base_argv = shlex.split(wrangler_bin) + ["d1", "execute", db_name, "--remote"]
        self.dry_run = dry_run
        self.dry_run_statements = []

    def _run_argv(self, extra_argv):
        argv = list(self.base_argv) + extra_argv + ["--json"]
        proc = subprocess.run(argv, capture_output=True, text=True, timeout=300)
        if proc.returncode != 0:
            raise RuntimeError(
                f"wrangler d1 execute 失敗 rc={proc.returncode}\n"
                f"stdout(前500)={proc.stdout[:500]!r}\nstderr(前500)={proc.stderr[:500]!r}")
        return proc.stdout

    def query(self, sql):
        # 「讀」必須走 --command：實測 --file 走批次匯入 API，SELECT 只回
        # 「Total queries executed / Rows read」摘要，拿不到真正的結果列。
        stdout = self._run_argv(["--command", sql])
        return _parse_wrangler_json(stdout)

    def execute(self, sql):
        if self.dry_run:
            self.dry_run_statements.append(sql)
            print("  [DRY-RUN] 略過遠端寫入，SQL 摘要：")
            print(summarize_sql(sql))
            return
        # 「寫」維持 --file（批次匯入 API）：多語句/大語句穩定，且不佔 argv 長度上限。
        fd, path = tempfile.mkstemp(suffix=".sql", prefix="tra_delay_")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(sql)
            self._run_argv(["--file", path])
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# 模式
# ---------------------------------------------------------------------------

def mode_status(db):
    expected = compute_expected_window(WINDOW_DAYS_STATUS)
    existing = query_existing_dates(db, expected[0])
    missing = [d for d in expected if d.isoformat() not in existing]
    print(f"預期範圍: {expected[0].isoformat()} ~ {expected[-1].isoformat()} (共 {len(expected)} 天)")
    print(f"已有: {len(expected) - len(missing)} 天")
    print(f"缺: {len(missing)} 天")
    for d in missing:
        print(f"  缺: {d.isoformat()}")
    return missing


def mode_rebuild_blob_only(db):
    blob = rebuild_blob(db)
    if blob:
        print(f"blob 重建完成: n_trains={blob['_meta']['n_trains']} "
              f"range={blob['_meta']['date_range']}", flush=True)


def mode_ingest(db, max_dates):
    expected = compute_expected_window(WINDOW_DAYS_STATUS)
    existing = query_existing_dates(db, expected[0])
    missing = sorted(d for d in expected if d.isoformat() not in existing)
    todo = missing[:max_dates]
    print(f"缺日共 {len(missing)} 天，本次處理前 {len(todo)} 天: "
          f"{[d.isoformat() for d in todo]}", flush=True)

    had_failure = False
    n_calls = 0
    total_wire = 0
    fetched_dates = []

    if not todo:
        print("無缺日，略過抓取", flush=True)
    else:
        token = get_token()
        for d in todo:
            print(f"抓取 {d.isoformat()} ...", flush=True)
            try:
                records, wire_bytes = fetch_day(d, token)
                n_calls += 1
                total_wire += wire_bytes
                stats = process_day(db, d, records)
                fetched_dates.append(d.isoformat())
                print(f"  {d.isoformat()}: 原始事件 {len(records)} 筆, 本日列 {stats['own_rows']}, "
                      f"併回前一天 {stats['merged_into_prev']} 車次 (共 {stats['trains']} 車次)",
                      flush=True)
            except Exception as e:
                print(f"  {d.isoformat()} 失敗: {e}", flush=True)
                had_failure = True
                break

        points = (math.ceil(n_calls / 10) + math.ceil((total_wire / 1_000_000) / 20)) if n_calls else 0
        print(f"TDX 呼叫 {n_calls} 次, wire {total_wire/1_000_000:.2f}MB, 估計點數 {points}",
              flush=True)

    blob = rebuild_blob(db)
    if blob:
        print(f"blob 重建完成: n_trains={blob['_meta']['n_trains']} "
              f"range={blob['_meta']['date_range']}", flush=True)

    print(f"\n=== 完成 === 本次成功寫入的日期: {fetched_dates}", flush=True)
    if had_failure:
        sys.exit(1)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="台鐵誤點歷史每日增量腳本 (TDX Historical -> D1)")
    ap.add_argument("--status", action="store_true",
                     help="只查近 35 天缺哪些 service_date，不寫入")
    ap.add_argument("--max-dates", type=int, default=DEFAULT_MAX_DATES,
                     help=f"本次最多抓幾天 (預設 {DEFAULT_MAX_DATES})")
    ap.add_argument("--dry-run", action="store_true",
                     help="所有遠端寫入改為印出 SQL 摘要，不實際執行")
    ap.add_argument("--rebuild-blob-only", action="store_true",
                     help="不抓新資料，只用現有 D1 資料重建 30 天統計 blob")
    args = ap.parse_args()

    wrangler_bin = os.environ.get("WRANGLER_BIN", "npx wrangler")
    db = D1Remote(wrangler_bin, D1_DB_NAME, dry_run=args.dry_run)

    if args.status:
        mode_status(db)
    elif args.rebuild_blob_only:
        mode_rebuild_blob_only(db)
    else:
        mode_ingest(db, args.max_dates)


if __name__ == "__main__":
    main()
