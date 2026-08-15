#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
部署前新鮮度防呆：印出 data/tra_schedule_dense.json 的涵蓋日期區間、天數、
今天起還剩幾天，以及每日車次數。若今天已超出涵蓋範圍、或剩餘天數過少，以非零 exit code 收場，
方便 CI／部署前擋一手（多日班表過期＝週末限定班次又會失準，需重跑 npm run fetch-schedule）。

用法：python3 scripts/check_schedule.py   （或 npm run check-schedule）
"""
import datetime
import json
import sys

PATH = "data/tra_schedule_dense.json"
WARN_REMAINING_DAYS = 3   # 今天起涵蓋不足這麼多天就警告


def phantom_pass_stations(data):
    """幽靈通過站：只以「通過」(stop=false) 身分出現、從未當過停靠站的站名，卻與某個停靠站名
    共用同一座標——這是 densify 把 tra.json 節點名（「左營(舊城)」）與班表站名（「左營」）當成
    兩座站的症狀：前端會長出兩顆同座標的站、點站彈疊站選單、其中一顆看板永遠空
    （2026-08-16 網友回報）。回傳 [(幽靈通過站名, 同座標的停靠站名), ...]。
    只有停靠紀錄的別名（如台鐵官方站碼 1001「臺北-環島」）是真站，不在此列。"""
    stop_names = set()
    stop_by_coord = {}
    pass_by_coord = {}
    for t in data.get("trains", []):
        for s in t.get("stops", []):
            key = (s.get("lat"), s.get("lon"))
            if s.get("stop") is False:
                pass_by_coord.setdefault(key, set()).add(s["name"])
            else:
                stop_names.add(s["name"])
                stop_by_coord.setdefault(key, set()).add(s["name"])
    bad = set()
    for key, names in pass_by_coord.items():
        for n in names:
            if n in stop_names:
                continue
            for sn in stop_by_coord.get(key, ()):
                bad.add((n, sn))
    return sorted(bad)


def main():
    try:
        with open(PATH, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"找不到 {PATH}，請先跑 npm run fetch-schedule", file=sys.stderr)
        return 2

    dates = data.get("dates")
    if not isinstance(dates, dict) or not dates:
        print(f"{PATH} 沒有多日 dates 欄位（可能是舊單日快照格式）", file=sys.stderr)
        return 2

    keys = sorted(dates)
    today = datetime.date.today()
    today_str = today.strftime("%Y-%m-%d")
    last = datetime.datetime.strptime(keys[-1], "%Y-%m-%d").date()
    remaining = (last - today).days  # 今天到最後一天還有幾天

    wd = ["一", "二", "三", "四", "五", "六", "日"]
    print(f"班表涵蓋：{keys[0]} → {keys[-1]}（{len(keys)} 天，{len(data.get('trains', []))} 份唯一班次定義）")
    print(f"今天：{today_str}（{'在涵蓋範圍內' if today_str in dates else '不在涵蓋範圍內!'}）")
    print(f"今天起剩餘涵蓋天數：{remaining}")
    print("每日車次數：")
    for k in keys:
        d = datetime.datetime.strptime(k, "%Y-%m-%d").date()
        mark = "  ← 今天" if k == today_str else ""
        print(f"  {k}（週{wd[d.weekday()]}）：{len(dates[k])} 車次{mark}")

    ghosts = phantom_pass_stations(data)
    if ghosts:
        print("\n[FAIL] 幽靈通過站（只當通過站的名字與停靠站同座標＝同一座站被拆成兩顆）：", file=sys.stderr)
        for ghost, real in ghosts:
            print(f"  通過站「{ghost}」 ↔ 停靠站「{real}」", file=sys.stderr)
        print("  densify_schedule.py 補通過站時應改用班表（官方）站名；請重跑：npm run fetch-schedule", file=sys.stderr)
        return 1
    print("幽靈通過站：0")

    if today_str not in dates:
        print("\n[FAIL] 今天已超出班表涵蓋範圍，前端會退回同週幾最近日（行為不劣於單日快照，但已非當日真實班表）。"
              "請重跑：npm run fetch-schedule", file=sys.stderr)
        return 1
    if remaining < WARN_REMAINING_DAYS:
        print(f"\n[WARN] 今天起只剩 {remaining} 天涵蓋（< {WARN_REMAINING_DAYS}），建議盡快重跑 npm run fetch-schedule", file=sys.stderr)
        return 1
    print("\n[OK] 班表新鮮度充足。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
