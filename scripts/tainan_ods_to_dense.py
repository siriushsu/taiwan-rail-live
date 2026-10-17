#!/usr/bin/env python3
# 臺鐵 ODS 逐日時刻表（單日 JSON）→ 只含該日的密化班表（格式同 data/tra_schedule_dense.json）。
# 給台南重播用：定版或預覽版的逐日檔先落在 .cache，轉成密化班表放進 .cache，再由 tainan_memory_config.mjs 的 schedules 指過去；
# 不寫 data/，主站的班表管線不受影響。
#
#   python3 -I scripts/tainan_ods_to_dense.py --date 2026-10-23 --ods <20261023.json> --stations <stations.json> --out <輸出.json>
#
# 解析與密化都重用主站管線，這裡不複製邏輯：
#   scripts/fetch_tra_schedule.py 的 main()（ODS 清洗、站碼對照、車種分類、跨日去重聯集）
#   scripts/densify_schedule.py 的 main()（沿 data/tra.json 的路網加密通過站）
# 這兩支都用相對路徑讀寫 data/，所以在暫存目錄裡跑：data/ 底下只連回唯讀的輸入（tra.json、tra_station_info.json、
# tra_station_of_line.json），輸出落在暫存目錄，跑完搬到 --out 並刪掉暫存目錄。下載（http_get）換成讀本機檔，挑日期（pick_days）
# 只留指定的一天，「今天」固定成營運日（fetch_tra_schedule.py 會把今天寫進 source_notes，不固定的話同樣的輸入每天轉出不同的檔）；
# 除此之外兩支腳本原樣執行。
import argparse
import contextlib
import datetime
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import types

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)          # python3 -I 不會把腳本所在目錄放進 sys.path


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def main(argv):
    ap = argparse.ArgumentParser(description='臺鐵 ODS 逐日時刻表 → 單日密化班表（只寫 --out）')
    ap.add_argument('--date', required=True, help='營運日 YYYY-MM-DD')
    ap.add_argument('--ods', required=True, help='ODS 逐日時刻表 JSON（YYYYMMDD.json）')
    ap.add_argument('--stations', required=True, help='ODS 車站基本資料 JSON（stations.json）')
    ap.add_argument('--out', required=True, help='輸出的密化班表 JSON（目錄不存在會建）')
    ap.add_argument('--downloaded-at', default='', help='ODS 檔的實際下載時間（只寫進 source_notes 當出處，例如 DOWNLOADED_AT 檔的內容）')
    args = ap.parse_args(argv)
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', args.date):
        sys.exit('--date 要接 YYYY-MM-DD')
    ymd = args.date.replace('-', '')
    ods_bytes = open(args.ods, 'rb').read()
    stations_bytes = open(args.stations, 'rb').read()
    ods = json.loads(ods_bytes.decode('utf-8'))
    if not isinstance(ods.get('TrainInfos'), list) or not ods['TrainInfos']:
        sys.exit('ODS 檔沒有 TrainInfos：' + args.ods)
    out_path = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    import fetch_tra_schedule as F
    import densify_schedule as D

    rid = sha256_bytes(ods_bytes)[:32]          # 清單頁連結 id（十六進位）；本機檔沒有真的 id，用內容雜湊代替
    list_html = '<a href="/x/exceptionDataResource/%s">%s.json</a>' % (rid, ymd)

    def http_get(url, attempts=4):
        if url == F.LIST_URL:
            return list_html.encode('utf-8')
        if url == F.STATIONS_URL:
            return stations_bytes
        if url == F.SCHEDULE_URL_TMPL.format(id=rid):
            return ods_bytes
        raise RuntimeError('轉換腳本不連網，沒有預期的網址：' + url)

    class FixedDate(datetime.date):
        @classmethod
        def today(cls):
            return cls.fromisoformat(args.date)

    F.http_get = http_get
    F.pick_days = lambda by_date, start_date, days: [(ymd, by_date[ymd])]
    F.MIN_DAYS_OK = 1
    F.datetime = types.SimpleNamespace(date=FixedDate, timedelta=datetime.timedelta)

    # 暫存目錄放在輸出檔旁邊（同一個 .cache），不放 /tmp、不放 repo。
    work = tempfile.mkdtemp(prefix='.ods-to-dense-', dir=os.path.dirname(out_path))
    old_cwd = os.getcwd()
    try:
        os.makedirs(os.path.join(work, 'data'))
        for name in ('tra.json', 'tra_station_info.json', 'tra_station_of_line.json'):
            os.symlink(os.path.join(ROOT, 'data', name), os.path.join(work, 'data', name))
        os.chdir(work)
        # 兩支腳本的進度訊息都擋到 stderr，stdout 只留一行結果給呼叫端
        with contextlib.redirect_stdout(sys.stderr):
            F.main()
            D.main()
        dense_path = os.path.join(work, 'data', 'tra_schedule_dense.json')
        dense = json.load(open(dense_path, encoding='utf-8'))
    finally:
        os.chdir(old_cwd)

    if list(dense.get('dates', {})) != [args.date]:
        shutil.rmtree(work, ignore_errors=True)
        sys.exit('轉換結果的日期不是只有 %s：%s' % (args.date, list(dense.get('dates', {}))))
    dl = ('，下載時間 ' + args.downloaded_at.strip()) if args.downloaded_at.strip() else ''
    note = ('【轉換】臺鐵 ODS 逐日時刻表 %s.json（%d 列次，UpdateTime %s，sha256 %s%s）與車站基本資料（sha256 %s）'
            '經 scripts/tainan_ods_to_dense.py 轉成只含 %s 的密化班表；解析重用 scripts/fetch_tra_schedule.py、'
            '密化重用 scripts/densify_schedule.py，兩支腳本原樣執行，只把下載換成讀本機檔。'
            '接在後面的「抓取今天(…)起連續 14 天…」是 fetch_tra_schedule.py 的固定句型；轉換時把「今天」固定成營運日本身，'
            '讓同樣的輸入永遠轉出同樣的檔，它不是下載日期。 | ') % (
        ymd, len(ods['TrainInfos']), ods.get('UpdateTime'), sha256_bytes(ods_bytes), dl, sha256_bytes(stations_bytes), args.date)
    dense['source_notes'] = note + dense['source_notes']
    tmp = out_path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(dense, f, ensure_ascii=False, indent=1)
    os.replace(tmp, out_path)
    shutil.rmtree(work, ignore_errors=True)
    out_bytes = open(out_path, 'rb').read()
    print(json.dumps({'out': out_path, 'date': args.date, 'trains': len(dense['trains']), 'dayTrains': len(dense['dates'][args.date]),
                      'odsTrainInfos': len(ods['TrainInfos']), 'odsUpdateTime': ods.get('UpdateTime'),
                      'odsSha256': sha256_bytes(ods_bytes), 'stationsSha256': sha256_bytes(stations_bytes),
                      'outSha256': sha256_bytes(out_bytes)}, ensure_ascii=False))


if __name__ == '__main__':
    main(sys.argv[1:])
