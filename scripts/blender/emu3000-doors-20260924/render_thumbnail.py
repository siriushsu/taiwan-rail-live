"""EMU3000 車庫縮圖：照 fleet-v1 工坊同一套攝影棚與 hero 鏡頭拍一張，縮成 360×240 WebP。

其他 61 款的縮圖都是 blender_parts.export_model() 算繪的 hero.png，縮成 360×240（cwebp q85 m6，
見 prototypes/tiny-trains/blender/tw-v2/finalize_tw.py）。這裡讀 build_doors.py 另存的 .blend，
只補上 export_model() 的算繪設定、展示台、三盞柔光燈與 hero 鏡頭，不動任何幾何。

  FLEET_RENDER=0 /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
    --python scripts/blender/emu3000-doors-20260924/build_doors.py
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
    --python scripts/blender/emu3000-doors-20260924/render_thumbnail.py

輸出：output/emu3000-doors/renders/thumb-hero.png（1200×800，不進 repo）、
rail-3d/assets/garage-blender-v1/emu3000.webp（會進 repo）。
"""
import sys, math, os, subprocess
from pathlib import Path

sys.dont_write_bytecode = True

W = Path(__file__).resolve().parents[3]  # repo 根目錄
SNAP = W / 'scripts/blender/emu3000-20260912'
OUT_ROOT = W / 'output/emu3000-doors'
BLEND_PATH = OUT_ROOT / 'emu3000-doors.blend'
HERO_PATH = OUT_ROOT / 'renders/thumb-hero.png'
THUMB_PATH = W / 'rail-3d/assets/garage-blender-v1/emu3000.webp'

sys.path.insert(0, str(SNAP))
import bpy
from mathutils import Vector
import blender_parts as p

bpy.ops.wm.open_mainfile(filepath=str(BLEND_PATH))
SCENE = p.SCENE = bpy.context.scene
p.COL = {c.name[:2]: c for c in SCENE.collection.children}
p.MODEL = [o for key, c in p.COL.items() if key != '90' for o in c.objects]

# 以下照 blender_parts.export_model()：算繪設定、包圍盒、攝影棚、hero 鏡頭。
SCENE.render.engine = 'CYCLES'
SCENE.cycles.samples = int(os.environ.get('FLEET_SAMPLES', '24'))
SCENE.cycles.use_denoising = True
SCENE.view_settings.view_transform = 'AgX'
SCENE.render.image_settings.file_format = 'PNG'
SCENE.render.film_transparent = False

deps = bpy.context.evaluated_depsgraph_get()
lo, hi = Vector((math.inf,) * 3), Vector((-math.inf,) * 3)
for obj in p.MODEL:
    if obj.type not in ['MESH', 'FONT', 'CURVE']:
        continue
    ev = obj.evaluated_get(deps)
    d = ev.to_mesh()
    d.calc_loop_triangles()
    for tri in d.loop_triangles:
        for li in tri.loops:
            pos = obj.matrix_world @ d.vertices[d.loops[li].vertex_index].co
            for j in range(3):
                lo[j] = min(lo[j], pos[j])
                hi[j] = max(hi[j], pos[j])
    ev.to_mesh_clear()

p.use('90')
p.box('展示台', (0, 0, -.060), (200, 200, .10), p.mat('攝影棚紙白', 'F0EBDF', 0, .8), .02, model=False)
for name, loc, energy, size in [('主柔光', (4, -6, 10), 1600, 7), ('車頭補光', (8, 4, 6), 1000, 5), ('頂部輪廓光', (-5, 2, 8), 1800, 6)]:
    data = bpy.data.lights.new(name, 'AREA')
    o = bpy.data.objects.new(name, data)
    p.ACTIVE.objects.link(o)
    o.location = loc
    data.energy = energy
    data.shape = 'DISK'
    data.size = size
    o.rotation_euler = (Vector((0, 0, 1.4)) - o.location).to_track_quat('-Z', 'Y').to_euler()

camdata = bpy.data.cameras.new('工坊正交相機')
camera = bpy.data.objects.new('工坊相機', camdata)
p.ACTIVE.objects.link(camera)
SCENE.camera = camera
camdata.type = 'ORTHO'
mid, size = (lo + hi) / 2, hi - lo
camera.location = Vector((11, -16, 10)) + mid
camera.rotation_euler = (mid - camera.location).to_track_quat('-Z', 'Y').to_euler()
camdata.ortho_scale = max(size.x * .96, size.z * 2.4, 8.5)
SCENE.render.resolution_x, SCENE.render.resolution_y = 1200, 800
SCENE.render.resolution_percentage = 100

HERO_PATH.parent.mkdir(parents=True, exist_ok=True)
SCENE.render.filepath = str(HERO_PATH)
bpy.ops.render.render(write_still=True)
subprocess.run(['cwebp', '-quiet', '-q', '85', '-m', '6', '-resize', '360', '240', str(HERO_PATH), '-o', str(THUMB_PATH)], check=True)
print('GD_THUMB_OK', {'objects': len(p.MODEL), 'size': [round(v, 3) for v in size], 'orthoScale': round(camdata.ortho_scale, 3)}, flush=True)
