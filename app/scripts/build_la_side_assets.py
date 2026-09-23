"""等車卡進站軌道（B 方案）的正側面車模素材。

兩段：
  1. Blender 背景模式算正側面（透明底）：
     Blender -b <M>/<id>/<id>.blend --python app/scripts/build_la_side_assets.py -- render <M>/<id> <輸出目錄> <id>
     M＝/Users/xuxiang/Code/捷運小動畫/prototypes/tiny-trains/blender/fleet-v1/models（主工作樹未追蹤）。
     🔴 固定 CPU：Blender 5.2.1 背景模式用 Metal GPU 會卡死（CPU 0%）。
     相機與 桌面/軌島小工具背景方案/產生器/render_cutout.py 的 side 視角相同（正側面、車頭朝右）。
  2. 一般 python3 裁切並寫出兩平台素材：
     python3 app/scripts/build_la_side_assets.py cut <輸出目錄> c381 c321 y100 val256
     - 展示台是 shadow catcher，會留一層低 alpha 的灰陰影 ⇒ alpha<0.5 清掉、其餘拉回實心，再裁到墨跡框。
     - iOS：RailBoardWidget/Assets.xcassets/la-side-<id>.imageset（高 18pt 的 @2x／@3x）。
     - Android：res/drawable-nodpi/la_side_<id>.png（高 96px，通知 tracker 圖示的最終尺寸由系統縮）。
     印出的寬高比要同步到 MetroWaitHop.carAspect（捷運）／TraWaitHop.carAspect（台鐵）；
     Android（RailWaitTrack）直接讀圖的像素尺寸，不必同步，但台鐵新車型要補進 traCarDrawable 的 switch。
路線→車型對照同網站 3D 列車（rail-3d/integration/formations.js）：R/G/O/支線 c381、BL c321、Y y100、BR val256。
台鐵（09-23 等站卡 B）：emu3000 temu1000 temu2000 e1000 dr3100 emu800 e200 dr1000 blue haifeng shanlan mingri e500
——formations.js baseFormation 對台鐵回得出的每一種，網頁 traWaitCarModel 送的就是這個 id。
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)


def render(model_dir, out_dir, mid):
    import bpy
    from mathutils import Vector
    S = bpy.context.scene
    S.cycles.device = 'CPU'
    S.render.engine = 'CYCLES'; S.cycles.samples = int(os.environ.get('SAMPLES', '32')); S.cycles.use_denoising = True
    S.render.film_transparent = True
    S.render.image_settings.file_format = 'PNG'; S.render.image_settings.color_mode = 'RGBA'
    floor = bpy.data.objects.get('展示台')
    if floor: floor.is_shadow_catcher = True
    meta = json.load(open(os.path.join(model_dir, f'{mid}.model.json')))
    bmin, bmax = Vector(meta['bounds']['min']), Vector(meta['bounds']['max'])
    mid_pt = (bmin + bmax) / 2; size = bmax - bmin
    cam = S.camera
    cam.location = Vector((0, -24, .65)) + mid_pt
    cam.rotation_euler = (mid_pt - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.ortho_scale = size.x * 1.10
    S.render.resolution_x, S.render.resolution_y = (1400, 650); S.render.resolution_percentage = 100
    S.render.filepath = os.path.join(out_dir, f'{mid}-side.png'); bpy.ops.render.render(write_still=True)
    print('CUTOUT_OK', mid)


def cut(out_dir, ids):
    from PIL import Image
    import numpy as np
    for mid in ids:
        a = np.array(Image.open(os.path.join(out_dir, f'{mid}-side.png')).convert('RGBA')).astype(float)
        a[..., 3] = np.clip((a[..., 3] / 255 - 0.5) / 0.4, 0, 1) * 255
        im = Image.fromarray(a.astype(np.uint8))
        im = im.crop(im.getbbox())
        d = os.path.join(APP, f'ios/App/RailBoardWidget/Assets.xcassets/la-side-{mid}.imageset')
        os.makedirs(d, exist_ok=True)
        imgs = []
        for sc, h in [(2, 36), (3, 54)]:
            fn = f'la-side-{mid}@{sc}x.png'
            im.resize((round(im.size[0] * h / im.size[1]), h), Image.LANCZOS).save(os.path.join(d, fn), optimize=True)
            imgs.append({'idiom': 'universal', 'filename': fn, 'scale': f'{sc}x'})
        json.dump({'images': [{'idiom': 'universal', 'scale': '1x'}] + imgs, 'info': {'author': 'xcode', 'version': 1}},
                  open(os.path.join(d, 'Contents.json'), 'w'), indent=2)
        ad = os.path.join(APP, 'android/app/src/main/res/drawable-nodpi')
        os.makedirs(ad, exist_ok=True)
        im.resize((round(im.size[0] * 96 / im.size[1]), 96), Image.LANCZOS).save(os.path.join(ad, f'la_side_{mid}.png'), optimize=True)
        print(mid, 'aspect %.3f' % (im.size[0] / im.size[1]))


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    if argv[0] == 'render':
        render(argv[1], argv[2], argv[3])
    else:
        cut(argv[1], argv[2:])
