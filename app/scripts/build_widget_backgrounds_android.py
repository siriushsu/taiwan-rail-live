#!/usr/bin/env python3
"""把小工具背景 A（車模）／C（場景）的母圖轉成 Android 資源。

母圖與 iOS 共用（iOS session 算的，不在 repo 裡）：
  車模：~/Desktop/軌島小工具背景方案/素材/正式車模/<id>.png（hero-l 斜角、車頭朝左下、透明底）
  場景：~/Desktop/軌島小工具背景方案/素材/正式場景-軌道車/<scene>-<day|night>.png（車庫頁 2 倍重拍，2880×2000）
        09-23 使用者：「要看到車 但是也要跟背景符合，我是要車子跑在場景的軌道上的圖」⇒ iOS session 用車庫
        setTime(t) 把場景自己的車停在右上角可見區再重拍；舊的 正式場景/ 作廢。
        多良、平交道再依使用者在車庫頁自己轉的「鐵道迷拍火車」角度重拍（拍攝參數在同目錄
        拍攝紀錄-20260923鐵道迷角度/，重拍用 ~/Desktop/軌島小工具背景方案/產生器/shoot_railfan/shoot2.mjs）：
          多良 yaw 0.4937、仰角 0.4212、t=5.5（先是「車子可以再後退一點，剛出隧道的時候的圖」取 t=2；
              A54 看過後改「車子在往前一點 要能看到欄杆、海、列車與一些遊客」）
          平交道 yaw −1.1327、仰角 0.4932、t=11.38（兩台 DR1000 都在平交道上、柵欄放下、車在等）
        裁切必須落在畫布內（2 倍座標 x 515–2795、y 190–1745），超出會拍到畫布的橘色外框。
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

# 場景：(母圖名, 資源名, 中心 x, 中心 y, 裁切寬, 最寬長寬比, 輸出寬)。中心與寬兩平台共用（iOS session 定的）。
# 列車外框在 Android 裁切框內的位置（u 水平、v 垂直，0 在左上）都落在站名牌右邊、淡出（v 0.40）之前：
#   大 u .614–.915 v .113–.304；中 u .50–.72 v −.08–.61（整列車出隧道、車頭在月台遊客旁，最後一節車頂被上緣切掉，接受）；
#   小 u .578–1.05 v .036–.431（平交道與兩台車頭在右上角，車尾超出右緣，接受）。
SCENES = [
    ('viaduct', 'wg_scene_large', 1838, 1315, 1330, 2.8, 1200),   # 大卡 t=10：高 150dp，寬 280–420dp
    ('duoliang', 'wg_scene_medium', 1652, 886, 1100, 4.8, 1200),  # 中卡 t=5.5：高 88dp，寬 280–420dp
    ('crossing', 'wg_scene_small', 1395, 1174, 1000, 2.1, 520),   # 小卡 t=11.38：高 84dp，寬 140–180dp
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
        src = Image.open(os.path.join(ROOT, '正式場景-軌道車', f'{scene}-{mode}.png')).convert('RGB')
        assert 0 <= box[0] and box[2] <= src.width and 0 <= box[1] and box[3] <= src.height, (scene, box)
        out = src.crop(box).resize((out_w, round(out_w / aspect)), Image.LANCZOS)
        save_webp(out, os.path.join(RES, folder, f'{name}.webp'), quality=86)
