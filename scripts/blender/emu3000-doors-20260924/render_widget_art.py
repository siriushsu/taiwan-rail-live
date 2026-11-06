"""EMU3000 小工具與等車卡用的透明底車模圖：hero-l 斜角與正側面各一張，裁到墨跡框。

讀 build_doors.py 另存的 .blend，燈光照 render_thumbnail.py，不放展示台，所以沒有地板陰影。
母圖不進 repo；縮成各平台尺寸的步驟在 native 的 widget 素材那邊做。

  ~/Applications/Blender-5.2.1.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
    --python scripts/blender/emu3000-doors-20260924/render_widget_art.py

輸出：output/emu3000-doors/renders/widget-hero-l.png、widget-side.png
"""
import sys, math, os
from pathlib import Path

sys.dont_write_bytecode = True

W = Path(__file__).resolve().parents[3]
OUT = W / 'output/emu3000-doors/renders'
SNAP = W / 'scripts/blender/emu3000-20260912'
sys.path.insert(0, str(SNAP))
import bpy
import numpy as np
from mathutils import Vector
import blender_parts as p

bpy.ops.wm.open_mainfile(filepath=str(W / 'output/emu3000-doors/emu3000-doors.blend'))
S = p.SCENE = bpy.context.scene
p.COL = {c.name[:2]: c for c in S.collection.children}
p.MODEL = [o for key, c in p.COL.items() if key != '90' for o in c.objects]
S.render.engine = 'CYCLES'
S.cycles.device = 'CPU'
S.cycles.samples = int(os.environ.get('FLEET_SAMPLES', '48'))
S.cycles.use_denoising = True
S.view_settings.view_transform = 'AgX'
S.render.image_settings.file_format = 'PNG'
S.render.image_settings.color_mode = 'RGBA'
S.render.film_transparent = True
S.render.resolution_x, S.render.resolution_y = 1600, 1000
S.render.resolution_percentage = 100

p.use('90')
lights = []
for name, loc, energy, size in [('主柔光', (4, -6, 10), 1600, 7), ('車頭補光', (8, 4, 6), 1000, 5), ('頂部輪廓光', (-5, 2, 8), 1800, 6)]:
    data = bpy.data.lights.new(name, 'AREA')
    o = bpy.data.objects.new(name, data)
    p.ACTIVE.objects.link(o)
    data.energy = energy
    data.shape = 'DISK'
    data.size = size
    lights.append((o, loc))

cam_data = bpy.data.cameras.new('透明底相機')
cam = bpy.data.objects.new('透明底相機', cam_data)
p.ACTIVE.objects.link(cam)
S.camera = cam
cam_data.type = 'ORTHO'
mid = Vector((-.17, 0, 1.8))


def shot(name, offset, scale):
    # 三盞燈照 render_thumbnail.py，鏡頭在車的哪一側就跟到哪一側
    side = 1 if offset[1] < 0 else -1
    for o, (x, y, z) in lights:
        o.location = (x, y * side, z)
        o.rotation_euler = (Vector((0, 0, 1.4)) - o.location).to_track_quat('-Z', 'Y').to_euler()
    cam.location = mid + Vector(offset)
    cam.rotation_euler = (mid - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam_data.ortho_scale = scale
    path = OUT / f'{name}.png'
    S.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(str(path))
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    ys, xs = np.where(px[..., 3] > .5)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    crop = np.ascontiguousarray(px[y0:y1, x0:x1])
    out = bpy.data.images.new(name + '-crop', x1 - x0, y1 - y0, alpha=True)
    out.pixels.foreach_set(crop.ravel())
    out.filepath_raw = str(path)
    out.file_format = 'PNG'
    out.save()
    print('GD_WIDGET_ART', name, x1 - x0, y1 - y0, flush=True)


shot('widget-hero-l', (11, 16, 10), 13.5)
shot('widget-side', (0, -30, 0), 11.5)
