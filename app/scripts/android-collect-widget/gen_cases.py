#!/usr/bin/env python3
"""產生車站收集 Android 小工具的裝置端測試案例：payload 變體＋cases.json。

輸入：app/ios/App/RailBoardWidget/CollectionWidgetPreview.json（iOS 小工具預覽用的示範 payload，
網頁端 collectionWidgetPayload() 產生；兩個平台的示範資料因此是同一份）。
只生輸入，不含期望值；期望值由 app/scripts/verify_android_collect_widget.mjs 從 payload 獨立重算。
用法：python3 gen_cases.py [輸出目錄]（預設 tmp/collect-widget/android/cases，tmp/ 已被忽略）。"""
import json, copy, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..', '..'))
SRC = os.path.join(ROOT, 'app', 'ios', 'App', 'RailBoardWidget', 'CollectionWidgetPreview.json')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tmp', 'collect-widget', 'android', 'cases')
os.makedirs(OUT, exist_ok=True)

sample = json.load(open(SRC, encoding='utf-8'))

def dump(name, obj):
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))

dump('sample.json', sample)

# 空狀態：同一份 payload 歸零（n、各系統 v、每點 s、最近蓋章）。與網頁端在沒有任何蓋章時送出的 payload 相同
# （2026-09-30 對過：網頁產生的空 payload 與這樣歸零的結果，扣掉 at 逐欄相等）。
empty = copy.deepcopy(sample)
empty['n'] = 0
empty['recent'] = []
for p in empty['pts']: p[3] = 0
for s in empty['sys']: s['v'] = 0
dump('empty.json', empty)

# 只收 1 站：挑台鐵一個點設 s=2，其餘全 0；n=1；台鐵 v=1、其餘系統 v=0；recent 只留那一站
one = copy.deepcopy(sample)
keep = next(i for i, p in enumerate(one['pts']) if p[4] == 0)
for i, p in enumerate(one['pts']): p[3] = 2 if i == keep else 0
one['n'] = 1
for s in one['sys']: s['v'] = 1 if s['k'] == 'tra' else 0
one['recent'] = [{'name': '菁桐', 'line': '平溪線', 'k': 'tra', 'd': '2026-09-27'}]
dump('one.json', one)

# 全收滿：所有點 s=2，n=total，各系統 v=n
full = copy.deepcopy(sample)
for p in full['pts']: p[3] = 2
full['n'] = full['total']
for s in full['sys']: s['v'] = s['n']
dump('full.json', full)

# 差 1 站收滿：537/538 → 四捨五入 100 但標「99%」
n99 = copy.deepcopy(full)
n99['n'] = n99['total'] - 1
last = next(i for i in range(len(n99['pts']) - 1, -1, -1) if n99['pts'][i][4] == 0)
n99['pts'][last][3] = 0
for s in n99['sys']:
    if s['k'] == 'tra': s['v'] -= 1
dump('n99.json', n99)

# 英文 payload：標籤是網頁端依語言送來的英文簡稱（index.html COLLECT_SYS 的 en；Kaohsiung 最長）
en = copy.deepcopy(sample)
en['lang'] = 'en'
lab = {'tra': 'TRA', 'thsr': 'THSR', 'trtc': 'Taipei', 'tymc': 'Airport', 'tmrt': 'Taichung', 'krtc': 'Kaohsiung',
       'ntdlrt': 'Danhai', 'ntalrt': 'Ankeng', 'sanying': 'Sanying', 'afr': 'Alishan'}
for s in en['sys']: s['label'] = lab[s['k']]
en['recent'] = [{'name': 'Jingtong', 'line': 'Pingxi Line', 'k': 'tra', 'd': '2026-09-27'},
                {'name': 'Shifen', 'line': 'Pingxi Line', 'k': 'tra', 'd': '2026-09-27'},
                {'name': 'Chishang', 'line': 'Taitung Line', 'k': 'tra', 'd': '2026-09-21'},
                {'name': 'Terminal 1', 'line': 'Airport MRT', 'k': 'tymc', 'd': '2026-09-14'}]
dump('sample-en.json', en)

# 壞檔：v=2（widget 端應退回「打開軌島一次」）
bad = copy.deepcopy(sample); bad['v'] = 2
dump('bad-v2.json', bad)

cases = []
def add(cid, payload, scope, family, theme, w, h, lang='zh-TW'):
    cases.append({'id': cid, 'payload': payload, 'scope': scope, 'family': family, 'theme': theme,
                  'wDp': w, 'hDp': h, 'lang': lang})

SM = [('s158', 158, 158), ('s110', 110, 110), ('stall', 140, 222), ('s137', 137, 137)]
MD = [('m320', 320, 110), ('m250', 250, 110), ('m360', 360, 158), ('m368h221', 368, 221)]
for theme in ('light', 'dark'):
    for tag, w, h in SM: add(f'sample-all-small-{tag}-{theme}', 'sample.json', 'all', 'small', theme, w, h)
    for tag, w, h in MD: add(f'sample-all-medium-{tag}-{theme}', 'sample.json', 'all', 'medium', theme, w, h)
    for sc in ('krtc', 'trtc', 'tra', 'ntdlrt'):
        add(f'sample-{sc}-small-s158-{theme}', 'sample.json', sc, 'small', theme, 158, 158)
        add(f'sample-{sc}-medium-m360-{theme}', 'sample.json', sc, 'medium', theme, 360, 158)
        add(f'sample-{sc}-medium-m320-{theme}', 'sample.json', sc, 'medium', theme, 320, 110)
for sc in ('ntalrt', 'sanying', 'afr', 'thsr'):
    add(f'sample-{sc}-small-s158-light', 'sample.json', sc, 'small', 'light', 158, 158)
    add(f'sample-{sc}-medium-m360-light', 'sample.json', sc, 'medium', 'light', 360, 158)
for sc in ('krtc', 'tra'):
    add(f'sample-{sc}-medium-m368h221-light', 'sample.json', sc, 'medium', 'light', 368, 221)
    add(f'sample-{sc}-medium-m368h221-dark', 'sample.json', sc, 'medium', 'dark', 368, 221)
    add(f'sample-{sc}-small-stall-light', 'sample.json', sc, 'small', 'light', 140, 222)
add('empty-all-medium-m368h221-light', 'empty.json', 'all', 'medium', 'light', 368, 221)
add('empty-all-small-stall-light', 'empty.json', 'all', 'small', 'light', 140, 222)
add('full-all-medium-m368h221-light', 'full.json', 'all', 'medium', 'light', 368, 221)
add('n99-all-medium-m368h221-light', 'n99.json', 'all', 'medium', 'light', 368, 221)
add('one-all-medium-m368h221-light', 'one.json', 'all', 'medium', 'light', 368, 221)
add('n99-all-small-stall-light', 'n99.json', 'all', 'small', 'light', 140, 222)
add('one-all-small-stall-light', 'one.json', 'all', 'small', 'light', 140, 222)
add('full-all-small-stall-light', 'full.json', 'all', 'small', 'light', 140, 222)
for lang in ('en', 'ja'):
    payload = 'sample-en.json' if lang == 'en' else 'sample.json'
    add(f'{lang}-all-medium-m368h221-light', payload, 'all', 'medium', 'light', 368, 221, lang)
    add(f'{lang}-krtc-medium-m368h221-light', payload, 'krtc', 'medium', 'light', 368, 221, lang)
for theme in ('light', 'dark'):
    add(f'empty-all-small-s158-{theme}', 'empty.json', 'all', 'small', theme, 158, 158)
    add(f'empty-all-medium-m360-{theme}', 'empty.json', 'all', 'medium', theme, 360, 158)
    add(f'empty-all-medium-m320-{theme}', 'empty.json', 'all', 'medium', theme, 320, 110)
add('nofile-small-s158-light', '', 'all', 'small', 'light', 158, 158)
add('nofile-medium-m360-light', '', 'all', 'medium', 'light', 360, 158)
add('bad-v2-small-s158-light', 'bad-v2.json', 'all', 'small', 'light', 158, 158)
for name in ('one', 'full', 'n99'):
    for theme in ('light', 'dark'):
        add(f'{name}-all-small-s158-{theme}', f'{name}.json', 'all', 'small', theme, 158, 158)
        add(f'{name}-all-medium-m360-{theme}', f'{name}.json', 'all', 'medium', theme, 360, 158)
add('one-tra-small-s158-light', 'one.json', 'tra', 'small', 'light', 158, 158)
add('one-tra-medium-m360-light', 'one.json', 'tra', 'medium', 'light', 360, 158)
add('full-krtc-small-s158-light', 'full.json', 'krtc', 'small', 'light', 158, 158)
add('full-krtc-medium-m360-light', 'full.json', 'krtc', 'medium', 'light', 360, 158)
for lang in ('en', 'ja'):
    payload = 'sample-en.json' if lang == 'en' else 'sample.json'
    for fam, tag, w, h in (('small', 's158', 158, 158), ('medium', 'm360', 360, 158), ('medium', 'm320', 320, 110)):
        add(f'{lang}-all-{fam}-{tag}-light', payload, 'all', fam, 'light', w, h, lang)
        add(f'{lang}-krtc-{fam}-{tag}-light', payload, 'krtc', fam, 'light', w, h, lang)
# 窄而高的中卡（4×3 之類）：圖例與副標在窄欄寬下的折行／截斷
for lang in ('zh-TW', 'en', 'ja'):
    payload = 'sample-en.json' if lang == 'en' else 'sample.json'
    tag = lang.split('-')[0]
    for sc in ('krtc', 'all'):
        add(f'{tag}-{sc}-medium-m250t-light', payload, sc, 'medium', 'light', 250, 158, lang)
json.dump(cases, open(os.path.join(OUT, 'cases.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(cases), 'cases →', OUT)
