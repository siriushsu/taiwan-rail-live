#!/usr/bin/env python3
"""把小工具背景 A（車模）／C（場景）的母圖轉成 Android 資源。

母圖與 iOS 共用（iOS session 算的，不在 repo 裡）：
  車模：~/Desktop/軌島小工具背景方案/素材/正式車模/<id>.png（hero-l 斜角、車頭朝左下、透明底）
  場景：~/Desktop/軌島小工具背景方案/素材/正式場景/<scene>-<day|night>.png（車庫頁 2 倍重拍，2880×2000）
用法：python3 app/scripts/build_widget_backgrounds_android.py [母圖根目錄]

🔴 只轉 Android 小工具目錄真的會用到的車：捷運目錄只有 trtc／krtc／tymc，台中、淡海、安坑、三鶯
   的車進 APK 也永遠不會顯示。對照表在 WidgetBackground.java，兩邊要一起改。
🔴 場景裁切取「該尺寸最寬的長寬比」：ImageView 用 centerCrop，卡片比這個比例窄時左右被裁、
   中心不動；反過來若裁得比卡片窄，寬卡會被放大、上下被裁掉，構圖整個跑掉。
"""
import os
import sys

from PIL import Image

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else
                       os.path.expanduser('~/Desktop/軌島小工具背景方案/素材'))
RES = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../android/app/src/main/res')

CARS = ['emu3000', 'emu900', 'emu800', 'e400', 'blue', '700t',
        'c381', 'c371', 'c341', 'val256', 'y100', 'kaohsiung', 'citadis', 'airportlocal']
CAR_WIDTH = 480  # 頭帶的車最大 118dp；xxxhdpi 約 4 倍 ⇒ 480px 足夠，再大只是 APK 變胖

# 場景：(母圖名, 資源名, 中心 x, 中心 y, 裁切寬, 最寬長寬比, 輸出寬)。中心與寬沿用 iOS 的試裁。
SCENES = [
    ('viaduct', 'wg_scene_large', 1700, 1060, 2000, 2.8, 1200),   # 大卡：高 150dp，寬 280–420dp
    ('duoliang', 'wg_scene_medium', 1660, 900, 2400, 4.8, 1200),  # 中卡：高 88dp，寬 280–420dp
    ('crossing', 'wg_scene_small', 1640, 1000, 1400, 2.1, 520),   # 小卡：高 84dp，寬 140–180dp
]


def save_webp(image, path, **kw):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    image.save(path, 'WEBP', method=6, **kw)
    print(f'{os.path.relpath(path, RES)}  {image.size[0]}×{image.size[1]}  {os.path.getsize(path) // 1024} KB')


for car in CARS:
    src = Image.open(os.path.join(ROOT, '正式車模', f'{car}.png')).convert('RGBA')
    height = round(src.height * CAR_WIDTH / src.width)
    out = src.resize((CAR_WIDTH, height), Image.LANCZOS)
    save_webp(out, os.path.join(RES, 'drawable-nodpi', f'wg_car_{car}.webp'), quality=90, alpha_quality=100)

for scene, name, cx, cy, width, aspect, out_w in SCENES:
    height = round(width / aspect)
    box = (cx - width // 2, cy - height // 2, cx - width // 2 + width, cy - height // 2 + height)
    for mode, folder in (('day', 'drawable-nodpi'), ('night', 'drawable-night-nodpi')):
        src = Image.open(os.path.join(ROOT, '正式場景', f'{scene}-{mode}.png')).convert('RGB')
        assert 0 <= box[0] and box[2] <= src.width and 0 <= box[1] and box[3] <= src.height, (scene, box)
        out = src.crop(box).resize((out_w, round(out_w / aspect)), Image.LANCZOS)
        save_webp(out, os.path.join(RES, folder, f'{name}.webp'), quality=86)
