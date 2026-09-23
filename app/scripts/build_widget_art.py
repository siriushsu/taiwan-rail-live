#!/usr/bin/env python3
"""把小工具背景（A 車模頭帶／C 小世界場景）的母圖縮成小工具實際像素，寫進 widget 的 asset catalog。

2026-09-23 使用者裁示「就用 A 跟 C，開始實作到 App 小工具」。

母圖不在 repo 裡（車模是 prototypes/tiny-trains 的 Blender 檔算出來的，場景是車庫分支
garage/scene-03 的頁面重拍），放在：
  ~/Desktop/軌島小工具背景方案/素材/正式車模/<id>.png   hero-l 斜角、透明底、已去地板陰影
  ~/Desktop/軌島小工具背景方案/素材/正式場景-軌道車/<scene>-<day|night>.png   2880×2000

09-23 使用者：「要看到車 但是也要跟背景符合，我是要車子跑在場景的軌道上的圖」——
場景裡本來那台車要停在【右上角看得到的地方】，不是另外疊車圖。做法是重拍母圖時用車庫頁的
setTime(t) 把車停到軌道上的指定位置，再調裁切讓它落在右上角的可見區（站名牌右邊、淡出開始前；
取 iOS 與 Android 兩邊可見區的交集，兩平台用同一組母圖與裁切）。
重拍法：~/Desktop/軌島小工具背景方案/產生器/shoot_scenes/（與舊母圖同一套拍法，t＝舊值時逐像素相同）。
舊母圖（車在左下被淡出蓋掉的那一版）留在 素材/正式場景/，不要再用。
🔴 62 款車模的【參考照片】永遠不進 repo 與出貨產物——這裡只收自家模型的算繪圖。

🔴 為什麼一定要縮到小工具的像素：WidgetKit 會拒絕比小工具像素面積還大的圖片（不算繪），
   所以每張都給 @2x／@3x 兩份，各自不超過最小機型那個尺寸的面積：
   大卡場景 364×150pt、中卡 364×96pt、小卡 170×96pt（Pro Max 的內容寬），車模 120pt 寬。

用法：python3 app/scripts/build_widget_art.py [母圖根目錄]
"""
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CATALOG = os.path.join(HERE, '../ios/App/RailBoardWidget/Assets.xcassets')
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/Desktop/軌島小工具背景方案/素材')

# 車種／路線 → 代表車的對照表住在 RailWidgetArt.swift；這裡只列要出貨的那幾台。
TRAINS = ['emu3000', 'emu900', 'emu800', 'e400', '700t', 'blue',
          'c381', 'c371', 'c341', 'val256', 'y100', 'kaohsiung', 'citadis', 'airportlocal']
TRAIN_WIDTH_PT = 120

# 場景：(資產名, 母圖, 點數寬高, 原圖上的裁切中心 x／y 與寬)。
# 裁切是對著「列車落在右上角」挑的（見檔頭）：t 是重拍母圖時 setTime 的值，列車外框是母圖 px，
# 列車框（場景圖 pt）＝兩平台可見區的交集：小 x110–150／中 x113–335／大 x160–335，y 約 10–44／13–38／14–60。
#   viaduct  t=10  新自強在高架環線右段   外框 (1990, 1131, 2390, 1222) → 大卡 pt (224, 25, 333, 49)
#   duoliang t=18  藍皮沿海邊軌道        外框 (1851, 1107, 2216, 1203) → 中卡 pt (254, 15, 333, 36)
#   crossing t=18  兩台對開剛過平交道     右邊那台 (1889, 1064, 2193, 1192) → 小卡 pt (114, 20, 148, 34)
#                                        另一台在站名牌上方的後排軌道
SCENES = [
    ('widget-scene-viaduct-l', 'viaduct', (364, 150), (1838, 1315, 1330)),
    ('widget-scene-duoliang-m', 'duoliang', (364, 96), (1519, 1259, 1680)),
    ('widget-scene-crossing-s', 'crossing', (170, 96), (1637, 1313, 1500)),
]


def write_set(name, files):
    """files: [(檔名, scale, 是否深色)]"""
    folder = os.path.join(CATALOG, f'{name}.imageset')
    os.makedirs(folder, exist_ok=True)
    for old in os.listdir(folder):
        if old != 'Contents.json' and old not in [f for f, _, _ in files]:
            os.remove(os.path.join(folder, old))
    images = []
    for filename, scale, dark in files:
        entry = {'filename': filename, 'idiom': 'universal', 'scale': f'{scale}x'}
        if dark:
            entry['appearances'] = [{'appearance': 'luminosity', 'value': 'dark'}]
        images.append(entry)
    with open(os.path.join(folder, 'Contents.json'), 'w') as f:
        json.dump({'images': images, 'info': {'author': 'xcode', 'version': 1}}, f, indent=2)
        f.write('\n')
    return folder


def build_trains():
    for tid in TRAINS:
        src = Image.open(os.path.join(SRC, '正式車模', f'{tid}.png')).convert('RGBA')
        name = f'widget-train-{tid}'
        folder = write_set(name, [(f'{name}@2x.png', 2, False), (f'{name}@3x.png', 3, False)])
        for scale in (2, 3):
            w = TRAIN_WIDTH_PT * scale
            h = round(src.height * w / src.width)
            src.resize((w, h), Image.LANCZOS).save(os.path.join(folder, f'{name}@{scale}x.png'), optimize=True)
        print('車模', name, src.size)


def build_scenes():
    for name, scene, (wpt, hpt), (cx, cy, cw) in SCENES:
        ch = cw * hpt / wpt
        box = (round(cx - cw / 2), round(cy - ch / 2), round(cx + cw / 2), round(cy + ch / 2))
        files = []
        for period, dark in (('day', False), ('night', True)):
            for scale in (2, 3):
                files.append((f'{name}{"-dark" if dark else ""}@{scale}x.jpg', scale, dark))
        folder = write_set(name, files)
        for period, dark in (('day', False), ('night', True)):
            src = Image.open(os.path.join(SRC, '正式場景-軌道車', f'{scene}-{period}.png')).convert('RGB')
            crop = src.crop(box)
            for scale in (2, 3):
                out = crop.resize((wpt * scale, hpt * scale), Image.LANCZOS)
                out.save(os.path.join(folder, f'{name}{"-dark" if dark else ""}@{scale}x.jpg'),
                         quality=86, optimize=True, progressive=False)
        print('場景', name, box)


if __name__ == '__main__':
    build_trains()
    build_scenes()
