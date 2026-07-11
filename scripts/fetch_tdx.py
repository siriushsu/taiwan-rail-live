#!/usr/bin/env python3
"""
Fetch data from TDX (運輸資料流通服務) using OAuth2 client credentials.

Credentials are read from environment variables ONLY — never hard-coded, never
written to any file (per project policy). Run like:

    export TDX_CLIENT_ID='你的ClientId'
    export TDX_CLIENT_SECRET='你的ClientSecret'
    python3 scripts/fetch_tdx.py

Saves raw datasets to data/tdx/*.json. Default target: 台北捷運 (TRTC) — the
pieces needed to drive an accurate metro animation (real headways + real
station-to-station travel times + geometry).
"""
import os, sys, json, time, urllib.request, urllib.parse

AUTH_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token"
API_BASE = "https://tdx.transportdata.tw/api/basic/v2"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "data", "tdx")

def get_token():
    cid = os.environ.get("TDX_CLIENT_ID")
    sec = os.environ.get("TDX_CLIENT_SECRET")
    if not cid or not sec:
        sys.exit("ERROR: set TDX_CLIENT_ID and TDX_CLIENT_SECRET environment variables first.")
    body = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": cid,
        "client_secret": sec,
    }).encode()
    req = urllib.request.Request(AUTH_URL, data=body,
        headers={"content-type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=60) as r:
        tok = json.loads(r.read().decode())["access_token"]
    print("  got access token (expires in 1 day)", flush=True)
    return tok

def api_get(path, token):
    url = f"{API_BASE}/{path}"
    url += ("&" if "?" in url else "?") + "$format=JSON&$top=100000"
    req = urllib.request.Request(url, headers={
        "authorization": "Bearer " + token,
        "accept": "application/json",
        "accept-encoding": "identity",
    })
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print(f"    rate-limited, waiting…", flush=True); time.sleep(20); continue
            raise
    raise SystemExit("too many retries")

# operators to fetch: 台北捷運 TRTC、高雄捷運 KRTC、高雄輕軌 KLRT、台中捷運 TMRT、
# 桃園機捷 TYMC、淡海輕軌 NTDLRT、安坑輕軌 NTALRT、新北捷運(環狀線) NTMC
OPERATORS = os.environ.get("TDX_OPERATORS", "TRTC,KRTC,KLRT,TMRT,TYMC,NTDLRT,NTALRT,NTMC").split(",")
DATASET_NAMES = [
    ("Line",          "路線清單+顏色"),
    ("Station",       "站點座標"),
    ("StationOfLine", "每條線的站序"),
    ("Frequency",     "各線各時段班距"),
    ("S2STravelTime", "站間行駛+停靠時間"),
    ("Shape",         "路線幾何"),
    ("StationTimeTable",   "逐站發車時刻表(build_metro_times.mjs 用;TMRT 無)"),
    ("FirstLastTimetable", "首末班車(文湖線/台中捷運班距合成用)"),
]

def main():
    os.makedirs(OUT, exist_ok=True)
    token = get_token()
    for op in [o.strip() for o in OPERATORS if o.strip()]:
        print(f"=== {op} ===", flush=True)
        for name, _desc in DATASET_NAMES:
            try:
                data = api_get(f"Rail/Metro/{name}/{op}", token)
                fp = os.path.join(OUT, f"{op}_{name}.json")
                json.dump(data, open(fp, "w"), ensure_ascii=False)
                n = len(data) if isinstance(data, list) else "?"
                print(f"  {name:14s} -> {fp}  ({n} records)", flush=True)
            except Exception as e:
                print(f"  {name:14s} FAILED: {e}", flush=True)
            time.sleep(1.2)  # be gentle with rate limits
    print("DONE", flush=True)

if __name__ == "__main__":
    main()
