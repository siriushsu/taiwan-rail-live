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
