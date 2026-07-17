#!/usr/bin/env python3
"""車種分類稽核:我們的班表(ODS 原始 CarClass)逐班比對 TDX 官方車種名。

背景(issue #7, 2026-07-17):ODS 時刻表只給原始代碼,官方代碼表未收錄的新碼
(如 110K/110M)先前靠報導推定,結果 7/1 改點換車後推定過期(E500→EMU3000)。
TDX DailyTrainTimetable 直接給車種全名,一次呼叫(1 點)可對全日所有班次。

用法:.env 放 TDX_CLIENT_ID/TDX_CLIENT_SECRET,然後
    python3 scripts/audit_train_types.py
每次台鐵改點(慣例 4/7/10 月)後跑一次;人工檢視配對表,
「ours[代碼] <-> TDX[名稱]」對不上車型家族的就是要修的。
"""
import collections
import gzip
import json
import os
import sys
import urllib.parse
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

for line in open(os.path.join(ROOT, ".env")):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ.setdefault(k, v.strip().strip('"').strip("'"))

cid = os.environ.get("TDX_CLIENT_ID")
sec = os.environ.get("TDX_CLIENT_SECRET")
if not cid or not sec:
    sys.exit("ERROR: .env 需含 TDX_CLIENT_ID / TDX_CLIENT_SECRET")

data = urllib.parse.urlencode({
    "grant_type": "client_credentials", "client_id": cid, "client_secret": sec,
}).encode()
tok = json.loads(urllib.request.urlopen(urllib.request.Request(
    "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token",
    data=data)).read())["access_token"]

url = "https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/DailyTrainTimetable/Today?%24format=JSON"
raw = urllib.request.urlopen(urllib.request.Request(
    url, headers={"authorization": "Bearer " + tok})).read()
if raw[:2] == b"\x1f\x8b":
    raw = gzip.decompress(raw)
tdx = {}
for t in json.loads(raw).get("TrainTimetables", []):
    ti = t["TrainInfo"]
    tdx[str(ti["TrainNo"])] = (ti.get("TrainTypeID"), ti.get("TrainTypeName", {}).get("Zh_tw"))
print(f"TDX 今日班次: {len(tdx)}")

ours = json.load(open(os.path.join(ROOT, "data/tra_schedule.json")))["trains"]
pairs = collections.Counter()
missing = []
for t in ours:
    got = tdx.get(str(t["train"]))
    if not got:
        missing.append(t["train"])
        continue
    pairs[(t["carName"], got[0], got[1])] += 1

print(f"我們有、TDX 今日沒有(多為班表日期差,非車種問題): {len(missing)} {missing[:10]}")
print()
for (car, tid, tname), n in sorted(pairs.items(), key=lambda x: -x[1]):
    print(f"{n:4d} 班  ours[{car}]  <->  TDX[{tid} {tname}]")
