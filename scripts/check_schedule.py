#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
部署前新鮮度防呆：印出 data/tra_schedule_dense.json 的涵蓋日期區間、天數、
今天起還剩幾天，以及每日車次數。若今天已超出涵蓋範圍、或剩餘天數過少，以非零 exit code 收場，
方便 CI／部署前擋一手（多日班表過期＝週末限定班次又會失準，需重跑 npm run fetch-schedule）。

另驗幽靈通過站與槽位鍵撞號（見 slot_key_collisions）。

用法：python3 scripts/check_schedule.py   （或 npm run check-schedule）
      python3 scripts/check_schedule.py --slot-keys   只驗槽位鍵撞號（fetch-schedule 與 ship-web 閘門用，不管新鮮度）
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


def prev_night_borrowed(data, day):
    """照 railcore ScheduleDay.kt 借班：前一天名冊裡、今天名冊沒有的索引，非環島、末站
    max(arrSec, depSec) > 86400（跨過午夜還沒到站）就借進今天。回傳借來的索引（照前一天順序、不去重）。"""
    dates, trains = data["dates"], data["trains"]
    prev = (datetime.date.fromisoformat(day) - datetime.timedelta(days=1)).isoformat()
    today = set(dates[day])
    out = []
    for i in dates.get(prev) or []:
        t = trains[i]
        if i in today or t.get("loop") or not t.get("stops"):
            continue
        last = t["stops"][-1]
        if max(last["arrSec"], last["depSec"]) > 86400:
            out.append(i)
    return out


def slot_key_collisions(data):
    """槽位鍵撞號：App 的槽位鍵是「名冊日|tra_sched:車次」，借來的班名冊日也是今天，所以同一天名冊
    （含借班）車次重複就同鍵。iOS 1.7.6 以前遇重複鍵開機就當（2026-11-01：10/31 跨夜到臺南的 3348
    借進 11/1，撞上 11/1 自己的 3348）。回傳 [(日期, 車次, [今天的索引], [借來的索引]), ...]。"""
    trains = data["trains"]
    out = []
    for day in sorted(data["dates"]):
        by_train = {}
        for i in data["dates"][day]:
            by_train.setdefault(str(trains[i]["train"]), ([], []))[0].append(i)
        for i in prev_night_borrowed(data, day):
            by_train.setdefault(str(trains[i]["train"]), ([], []))[1].append(i)
        for no, (own, borrowed) in by_train.items():
            if len(own) + len(borrowed) > 1:
                out.append((day, no, own, borrowed))
    return out


def trim_prev_night_collisions(data):
    """把撞號的借班改成在午夜前最後一個停靠站收班，就不會被借進隔天：新增一份截尾的定義，只換掉前一天
    名冊裡那一格（同一份定義別天照用原版）。代價是那一晚少畫過午夜那一段；截完不足兩站就從前一天拿掉。
    換掉之後，再前一天若也跑同一份定義，它會改被借進前一天、撞上截尾版，所以反覆截到沒有撞號為止
    （同一版本連跑幾天就連截幾晚）。同一天自己名冊重複的車次截不掉，留給 slot_key_collisions 擋。
    已上架的 iOS 1.7.6 以前沒人用了就可以拿掉。回傳 [(前一天, 車次, 處理說明), ...]。"""
    trains, dates = data["trains"], data["dates"]
    trimmed = {}  # 原索引 → 截尾後的新索引（None＝整班拿掉）
    log = []
    changed = True
    while changed:
        changed = False
        for day, no, _, borrowed in slot_key_collisions(data):
            prev = (datetime.date.fromisoformat(day) - datetime.timedelta(days=1)).isoformat()
            for i in borrowed:
                if i not in dates[prev]:
                    continue
                if i not in trimmed:
                    stops = trains[i]["stops"]
                    keep = [k for k, s in enumerate(stops) if s.get("stop") is not False and s["arrSec"] <= 86400]
                    if keep and keep[-1] >= 1:
                        new_stops = [dict(s) for s in stops[:keep[-1] + 1]]
                        new_stops[-1]["depSec"] = new_stops[-1]["arrSec"]  # 變成終點站：到站即收班
                        trains.append(dict(trains[i], stops=new_stops))
                        trimmed[i] = len(trains) - 1
                    else:
                        trimmed[i] = None
                j = trimmed[i]
                changed = True
                if j is None:
                    dates[prev] = [k for k in dates[prev] if k != i]
                    log.append((prev, no, "截完不足兩站，整班拿掉"))
                else:
                    dates[prev] = [j if k == i else k for k in dates[prev]]
                    end = trains[j]["stops"][-1]
                    log.append((prev, no, f"截到 {end['name']} {end['arrSec'] // 3600:02d}:{end['arrSec'] % 3600 // 60:02d}"
                                          f"（原終點 {trains[i]['stops'][-1]['name']}）"))
    return log


def report_slot_key_collisions(data):
    """有撞號就印到 stderr 並回傳 True。"""
    bad = slot_key_collisions(data)
    if not bad:
        print("槽位鍵撞號：0")
        return False
    print("\n[FAIL] 槽位鍵撞號（同一天名冊含跨夜借班車次重複，iOS 1.7.6 以前開機就當）：", file=sys.stderr)
    for day, no, own, borrowed in bad:
        print(f"  {day} 車次 {no}：今天的索引 {own}、從前一天借來的索引 {borrowed}", file=sys.stderr)
    print("  densify_schedule.py 會自動把撞號的借班截到午夜前收班；請重跑：npm run fetch-schedule"
          "（同一天自己名冊重複的車次截不掉，要查 fetch_tra_schedule.py 的去重）", file=sys.stderr)
    return True


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
    if "--slot-keys" in sys.argv[1:]:
        return 1 if report_slot_key_collisions(data) else 0

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
    if report_slot_key_collisions(data):
        return 1

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
