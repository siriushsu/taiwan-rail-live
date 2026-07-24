#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抓 TDX v3 Rail/TRA/StationOfLine（各線站序＋官方累計里程 CumulativeDistance），
落地 data/tra_station_of_line.json，供 densify_schedule.py 的跳站段內插改用真實
軌道里程（取代目前的 haversine 球面直線距離）。

背景研究：研究_快車跳站校正_2026-07-24.md §6（本次已實際呼叫驗證這支 API 的回應形狀）。

用法：
    python3 scripts/fetch_tra_station_of_line.py

金鑰讀取：固定讀 /Users/xuxiang/Code/捷運小動畫/.env（本專案 TDX 金鑰的唯一存放位置，
與 scripts/ingest_tra_delay.py 的 ENV_PATH 做法一致）；只在記憶體使用，不落地、不印出。

輸出格式（data/tra_station_of_line.json）：
    {
      "source": "TDX v3 Rail/TRA/StationOfLine",
      "fetched_at": "<UTC ISO>",
      "tdx_update_time": "<TDX 回應的 UpdateTime>",
      "lines": [ {"lineId": "CZ", "stations": [{"id":"3350","name":"成功","seq":0,"cumKm":0.0}, ...]}, ... ]
    }

只存「抓到什麼」的乾淨快照，不在這支腳本內做任何 join／內插邏輯 ——
邊權重計算（含站名比對、退回 haversine 的判斷）留給 densify_schedule.py，
避免同一份邏輯在兩支腳本各寫一次而漂移。
"""
import datetime
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

ENV_PATH = "/Users/xuxiang/Code/捷運小動畫/.env"  # 只讀，不寫；金鑰只進記憶體
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(HERE, "data", "tra_station_of_line.json")

AUTH_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token"
API_URL = "https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/StationOfLine?$format=JSON"


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
        return json.loads(r.read().decode())["access_token"]


def main():
    print("取得 TDX token ...", file=sys.stderr)
    token = get_token()

    print("下載 Rail/TRA/StationOfLine ...", file=sys.stderr)
    req = urllib.request.Request(API_URL, headers={"authorization": "Bearer " + token})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit(f"ERROR: StationOfLine API 回應 {e.code}")

    raw_lines = data.get("StationOfLines")
    if not isinstance(raw_lines, list) or not raw_lines:
        sys.exit(f"ERROR: 回應形狀不符預期（缺 StationOfLines 或為空）：keys={list(data.keys())}")

    lines_out = []
    total_stations = 0
    for ln in raw_lines:
        stations = []
        for s in sorted(ln.get("Stations", []), key=lambda x: x.get("Sequence", 0)):
            name = (s.get("StationName") or {}).get("Zh_tw")
            sid = s.get("StationID")
            cum = s.get("CumulativeDistance")
            if name is None or sid is None or cum is None:
                continue
            stations.append({"id": sid, "name": name, "seq": s.get("Sequence"), "cumKm": cum})
        lines_out.append({"lineId": ln.get("LineID"), "stations": stations})
        total_stations += len(stations)

    out = {
        "source": "TDX v3 Rail/TRA/StationOfLine",
        "fetched_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tdx_update_time": data.get("UpdateTime", ""),
        "lines": lines_out,
    }

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    print(f"已寫入 {OUT_PATH}：{len(lines_out)} 條線、共 {total_stations} 筆站序記錄", file=sys.stderr)
    for ln in lines_out:
        print(f"  {ln['lineId']}: {len(ln['stations'])} 站", file=sys.stderr)


if __name__ == "__main__":
    main()
