#!/usr/bin/env python3
"""讀 rail-3d/assets/garage-coast-v1/station.json + .bin.gz，把站房（牆＋屋頂＋3 扇窗＋門＋雨庇）、
一張長椅、一盞路燈、一個垃圾桶，依 south-coast.js 實際會用的相對位置組回一個完整場景，旁邊擺
render_coast_flora_sheet.py 同一支「1.7m 人形比例尺」（身高 .754，同一套換算，不是另外重算）。
不是最終驗收（最終驗收是 verify_garage_south_coast_stop.mjs 讀瀏覽器裡真正的 InstancedMesh 矩陣
＋ verify_garage_south_coast.mjs 讀夜景像素），純粹是接進場景前、給人看零件本身刻得對不對的複核。

用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/coast-20260928/render_coast_station_sheet.py
輸出：/Users/xuxiang/Desktop/車庫B-檢查點/01-南迴/polish/coast-station-sheet-{side,oblique,low}-v2.png
"""
import bpy, sys, json, gzip, array
from pathlib import Path
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(W / 'scripts/blender/emu3000-20260912'))
import blender_parts as p  # noqa: E402

ASSET_DIR = W / 'rail-3d/assets/garage-coast-v1'
OUT_DIR = Path('/Users/xuxiang/Desktop/車庫B-檢查點/01-南迴/polish')
OUT_DIR.mkdir(parents=True, exist_ok=True)

meta = json.loads((ASSET_DIR / 'station.json').read_text(encoding='utf-8'))
raw = gzip.decompress((ASSET_DIR / 'station.bin.gz').read_bytes())
F = array.array('f')
F.frombytes(raw)
PARTS = {q['name']: q for q in meta['parts']}


def part_verts(name):
    q = PARTS[name]
    s, c = q['start'], q['count']
    return [(F[v*6], F[v*6+1], F[v*6+2]) for v in range(s, s + c)]


def part_faces(name):
    c = PARTS[name]['count']
    return [(i, i+1, i+2) for i in range(0, c, 3)]


p.reset({'id': 'coast-station-sheet', 'body': 'FFFFFF', 'accent': '888888'})
p.use('01')
SCENE = bpy.context.scene
SCENE.render.engine = 'BLENDER_WORKBENCH'
SCENE.display.shading.light = 'STUDIO'
SCENE.display.shading.color_type = 'MATERIAL'
SCENE.display.shading.show_cavity = True
SCENE.display.shading.show_shadows = True

MATS = {}


def mat_hex(hexcolor, tag):
    hexcolor = hexcolor.lstrip('#')
    if hexcolor not in MATS:
        MATS[hexcolor] = p.mat('c_' + tag + '_' + hexcolor, hexcolor, 0, .65)
    return MATS[hexcolor]


_uid = [0]


def uid_next():
    _uid[0] += 1
    return _uid[0]


def add_part(name, mw, hexcolor, tag):
    verts, faces = part_verts(name), part_faces(name)
    obj = p.mesh(f'{tag}_{name}_{uid_next()}', verts, faces, mat_hex(hexcolor, tag), 0, True)
    obj.matrix_world = mw
    return obj


def Txyz(x, y, z):
    return Matrix.Translation((x, y, z))


def add_person_proxy(x0, y0):
    h = .754
    skin, top, bottom = mat_hex('e0b088', 'skin'), mat_hex('6f8fa8', 'top'), mat_hex('3d4450', 'bottom')
    p.box('person_legs_' + str(uid_next()), (x0, y0, h * .27), (h * .16, h * .16, h * .54), bottom, bevel=0)
    p.box('person_torso_' + str(uid_next()), (x0, y0, h * .27 + h * .27 + h * .19), (h * .30, h * .18, h * .38), top, bevel=0)
    import bmesh as _bm
    bm = _bm.new()
    _bm.ops.create_icosphere(bm, subdivisions=1, radius=h * .09)
    bm.verts.ensure_lookup_table()
    idx = {v: i for i, v in enumerate(bm.verts)}
    verts = [(v.co.x, v.co.y, v.co.z) for v in bm.verts]
    faces = [tuple(idx[v] for v in f.verts) for f in bm.faces]
    bm.free()
    head = p.mesh('person_head_' + str(uid_next()), verts, faces, skin, 0, True)
    head.location = (x0, y0, h * .27 + h * .27 + h * .38 + h * .09)
    return h


# ---- 依 south-coast.js 實際會用的相對位置組一個完整站房（牆頂 z=1.8，屋頂/窗/門都相對這個基準）----
add_part('wall', Txyz(0, 0, 0), 'E9DFC3', 'wall')
add_part('roof', Txyz(0, 0, 1.8), '557F7B', 'roof')
for wx in [-1.55, 0, 1.55]:
    add_part('window-frame', Txyz(wx, -1.15, 1.05), '5B4C3A', 'winf')
    add_part('window-glass', Txyz(wx, -1.15, 1.05), '718E8A', 'wing')
add_part('door', Txyz(-2.05, -1.15, .55), '5B4C3A', 'door')
add_part('canopy', Txyz(-2.05, -1.15, 1.18), '5B4C3A', 'canopy')

# ---- 長椅（原點在地面）----
BENCH_X = 3.4
add_part('bench-seat', Txyz(BENCH_X, 0, .54 + .35), '5B4C3A', 'seat')
add_part('bench-back', Txyz(BENCH_X, -.10, .54 + .35 + .045), '5B4C3A', 'back')
for dx in [-.58, .58]:
    add_part('bench-leg', Txyz(BENCH_X + dx, 0, .54), '5B4C3A', 'leg')

# ---- 路燈（四個零件同一個貼地點）----
LAMP_AT = (5.6, 0, 0)
for part, hexcolor, tag in [('lamp-pole', '5B4C3A', 'pole'), ('lamp-arm', '5B4C3A', 'arm'),
                            ('lamp-head', '8A9291', 'head'), ('lamp-glass', 'F6D797', 'glass')]:
    add_part(part, Txyz(*LAMP_AT), hexcolor, tag)

# ---- 垃圾桶 ----
BIN_AT = (-4.2, .6, 0)
add_part('bin-body', Txyz(*BIN_AT), '2B2620', 'binbody')
add_part('bin-rim', Txyz(*BIN_AT), '8A9291', 'binrim')

add_person_proxy(-2.05, -2.2)
add_person_proxy(BENCH_X, 1.1)

note_path = W / 'output/coast-station/NOTES.md'
with open(note_path, 'a', encoding='utf-8') as fh:
    fh.write('- [render_coast_station_sheet] 站房＋長椅＋路燈＋垃圾桶＋2 個 1.7m 人形比例尺，'
             '三個角度算圖完成。\n')


def frame_ortho(loc, target, scale, res):
    camdata = bpy.data.cameras.new('cam_' + str(uid_next()))
    camera = bpy.data.objects.new('camobj_' + str(uid_next()), camdata)
    bpy.context.collection.objects.link(camera)
    SCENE.camera = camera
    camdata.type = 'ORTHO'
    camera.location = Vector(loc)
    camera.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    camdata.ortho_scale = scale
    SCENE.render.resolution_x, SCENE.render.resolution_y = res
    SCENE.render.resolution_percentage = 100
    return camera


mid = (1, -.6, 1.0)
# 側面（沿 -Y 看向 +Y，跟第 2 項 sheet 同一個角度）。
frame_ortho((mid[0], -14, mid[2] + .3), (mid[0], 0, mid[2] + .3), 11.5, (2200, 1100))
SCENE.render.filepath = str(OUT_DIR / 'coast-station-sheet-side-v2.png')
bpy.ops.render.render(write_still=True)
print('rendered side')

# 斜上方 45 度。
frame_ortho((mid[0] + 9, -9, mid[2] + 6), (mid[0], 0, mid[2]), 12.5, (2200, 1400))
SCENE.render.filepath = str(OUT_DIR / 'coast-station-sheet-oblique-v2.png')
bpy.ops.render.render(write_still=True)
print('rendered oblique')

# 低角度（貼近地面看，驗屋簷/窗框/門的細節）。
frame_ortho((mid[0] + 2, -10, .35), (mid[0], -1, 1.0), 8, (2200, 1300))
SCENE.render.filepath = str(OUT_DIR / 'coast-station-sheet-low-v2.png')
bpy.ops.render.render(write_still=True)
print('rendered low')

bpy.ops.wm.save_as_mainfile(filepath=str((W / 'output/coast-station/coast-station-sheet.blend')))
print('GD_COAST_STATION_SHEET_OK')
