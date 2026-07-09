#!/usr/bin/env python3
"""
抓高鐵(THSR)資料,供 sched 真實時刻表動畫用。與 fetch_tdx.py 同樣走 TDX OAuth2,
但高鐵在 Rail/THSR/* 群組(非 Rail/Metro)。憑證讀環境變數(見 .env)。

輸出 data/tdx/THSR_*.json:
  Station          12 站座標
  StationOfLine    站序(單線)
  Shape            路線幾何(WKT)
  DailyTimetable   當日逐車次時刻表(含加開/停駛;結構 {TrainDate,DailyTrainInfo,StopTimes})

用法:  set -a && . ./.env && set +a && python3 scripts/fetch_thsr.py
"""
import os, sys, json, time, urllib.request, urllib.parse

AUTH = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token"
BASE = "https://tdx.transportdata.tw/api/basic/v2"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "data", "tdx")

def token():
    cid, sec = os.environ.get("TDX_CLIENT_ID"), os.environ.get("TDX_CLIENT_SECRET")
    if not cid or not sec:
        sys.exit("ERROR: set TDX_CLIENT_ID and TDX_CLIENT_SECRET first.")
    body = urllib.parse.urlencode({"grant_type": "client_credentials",
        "client_id": cid, "client_secret": sec}).encode()
    req = urllib.request.Request(AUTH, data=body,
        headers={"content-type": "application/x-www-form-urlencoded"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())["access_token"]

def api_get(path, tok):
    url = f"{BASE}/{path}?$format=JSON&$top=100000"
    req = urllib.request.Request(url, headers={"authorization": "Bearer " + tok,
        "accept": "application/json", "accept-encoding": "identity"})
    for _ in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(20); continue
            raise
    raise SystemExit("too many retries")

def main():
    os.makedirs(OUT, exist_ok=True)
    tok = token(); print("  got token", flush=True)
    jobs = [
        ("Station",        "Rail/THSR/Station"),
        ("StationOfLine",  "Rail/THSR/StationOfLine"),
        ("Shape",          "Rail/THSR/Shape"),
        ("DailyTimetable", "Rail/THSR/DailyTimetable/Today"),
    ]
    for name, path in jobs:
        try:
            data = api_get(path, tok)
            fp = os.path.join(OUT, f"THSR_{name}.json")
            json.dump(data, open(fp, "w"), ensure_ascii=False)
            n = len(data) if isinstance(data, list) else "?"
            print(f"  {name:14s} -> {fp}  ({n} records)", flush=True)
        except Exception as e:
            print(f"  {name:14s} FAILED: {e}", flush=True)
        time.sleep(1.2)
    print("DONE", flush=True)

if __name__ == "__main__":
    main()
