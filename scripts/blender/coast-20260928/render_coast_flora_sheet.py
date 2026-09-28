#!/usr/bin/env python3
"""讀已安裝的 rail-3d/assets/garage-palms-v1/palms.json + .bin.gz，把 4 個新零件組
（彎幹椰子 A/B、闊葉樹 A/B）各拼一棵，旁邊擺簡化人形比例尺（身高 .754，跟
palms-20260928/render_palms_sheet.py 同一個換算：南迴這個場景座標系裡，1.7 m 真人＝.754
模型單位——這裡沿用同一支比例尺，不是另外重算）。四棵並排各拍側面＋斜上方＋45°斜看低角度
三張（低角度是使用者要求的驗收角度之一：彎幹要「側面看得出來」、闊葉要「經得起近看側面低角度」）。

不是最終驗收（最終驗收是 verify_garage_south_coast_stop.mjs 讀瀏覽器裡真正的 InstancedMesh 矩陣），
純粹是接進場景前的視覺複核。

用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/coast-20260928/render_coast_flora_sheet.py
輸出：/Users/xuxiang/Desktop/車庫B-檢查點/01-南迴/polish/coast-flora-sheet-{side,oblique,low}.png
"""
import bpy, sys, json, gzip, math, array
from pathlib import Path
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(W / 'scripts/blender/emu3000-20260912'))
import blender_parts as p  # noqa: E402

ASSET_DIR = W / 'rail-3d/assets/garage-palms-v1'
OUT_DIR = Path('/Users/xuxiang/Desktop/車庫B-檢查點/01-南迴/polish')
OUT_DIR.mkdir(parents=True, exist_ok=True)

meta = json.loads((ASSET_DIR / 'palms.json').read_text(encoding='utf-8'))
raw = gzip.decompress((ASSET_DIR / 'palms.bin.gz').read_bytes())
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


p.reset({'id': 'coast-flora-sheet', 'body': 'FFFFFF', 'accent': '888888'})
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


def Sxyz(sx, sy, sz):
    m = Matrix.Identity(4)
    m[0][0], m[1][1], m[2][2] = sx, sy, sz
    return m


def Txyz(x, y, z):
    return Matrix.Translation((x, y, z))


def Rz(t):
    return Matrix.Rotation(t, 4, 'Z')


TRUNK_HEX = '71664e'
COCO_FROND_HEX = '3f6a5a'
BL_TRUNK_HEX = '6b5d4a'
BL_CANOPY_A_HEX, BL_CANOPY_B_HEX = '4a7048', '5c8a4f'

# 跟 south-coast.js 的常數一致（build_coast_flora.py NOTES 也記錄了同一組數字）：
REF_HEIGHT, REF_R0, REF_R1 = 2.2, .125, .0775
COCO_FRONDS, COCO_DROOP, COCO_DROOP_AMP, COCO_SPREAD_MULT, COCO_DIAM_FRAC = 13, .68, .25, 1.40, .70


def build_curved(x0, y0, trunk_part, s):
    """s＝目標最終高度/REF_HEIGHT（跟 south-coast.js 的換算一致），這裡固定 s=1（參考尺寸本身）。"""
    add_part(trunk_part, Txyz(x0, y0, 0) @ Sxyz(s, s, s), TRUNK_HEX, 'trunk')
    height = REF_HEIGHT * s
    diam = height * COCO_DIAM_FRAC
    spread = (diam / 2) * COCO_SPREAD_MULT
    topA = (.42, 0.0) if 'curved-a' in trunk_part else (.377, 0.0)
    hub = (x0 + topA[0] * s, y0 + topA[1] * s, height)
    for j in range(COCO_FRONDS):
        yaw = j * 2.399963
        droop = COCO_DROOP + COCO_DROOP_AMP * math.sin(j * 2.399963)
        length = spread * (.85 if j < 3 else .9)
        mw = Txyz(*hub) @ Rz(yaw) @ Matrix.Rotation(droop, 4, 'Y') @ Sxyz(length, length, length)
        add_part('coco-fronds', mw, COCO_FROND_HEX, 'cfrond')
    return height, diam


def build_broadleaf(x0, y0, variant):
    trunk = f'broadleaf-{variant}-trunk'
    canopy = f'broadleaf-{variant}-canopy'
    canopy_hex = BL_CANOPY_A_HEX if variant == 'a' else BL_CANOPY_B_HEX
    add_part(trunk, Txyz(x0, y0, 0) @ Sxyz(1, 1, 1), BL_TRUNK_HEX, 'bltrunk')
    add_part(canopy, Txyz(x0, y0, 0) @ Sxyz(1, 1, 1), canopy_hex, 'blcanopy')


def add_person_proxy(x0, y0):
    h = .754
    skin, top, bottom = mat_hex('e0b088', 'skin'), mat_hex('6f8fa8', 'top'), mat_hex('3d4450', 'bottom')
    p.box('person_legs_' + str(uid_next()), (x0, y0, h * .27), (h * .16, h * .16, h * .54), bottom, bevel=0)
    p.box('person_torso_' + str(uid_next()), (x0, y0, h * .27 + h * .27 + h * .19), (h * .30, h * .18, h * .38), top, bevel=0)
    head_verts, head_faces = _ico(radius=h * .09)
    head = p.mesh('person_head_' + str(uid_next()), head_verts, head_faces, skin, 0, True)
    head.location = (x0, y0, h * .27 + h * .27 + h * .38 + h * .09)
    return h


def _ico(radius):
    import bmesh as _bm
    bm = _bm.new()
    _bm.ops.create_icosphere(bm, subdivisions=1, radius=radius)
    bm.verts.ensure_lookup_table()
    idx = {v: i for i, v in enumerate(bm.verts)}
    verts = [(v.co.x, v.co.y, v.co.z) for v in bm.verts]
    faces = [tuple(idx[v] for v in f.verts) for f in bm.faces]
    bm.free()
    return verts, faces


SLOTS = [-6, -2, 2, 6]
hA, dA = build_curved(SLOTS[0], 0, 'coco-curved-a-trunk', 1.0)
add_person_proxy(SLOTS[0] + .8, 0)
hB, dB = build_curved(SLOTS[1], 0, 'coco-curved-b-trunk', 1.0)
add_person_proxy(SLOTS[1] + .8, 0)
build_broadleaf(SLOTS[2], 0, 'a')
add_person_proxy(SLOTS[2] + 1.3, 0)
build_broadleaf(SLOTS[3], 0, 'b')
add_person_proxy(SLOTS[3] + 1.4, 0)

note_path = W / 'output/coast-flora/NOTES.md'
with open(note_path, 'a', encoding='utf-8') as fh:
    fh.write(f'- [render_coast_flora_sheet] 彎幹椰子 A：height={hA:.3f} diam={dA:.3f}；B：height={hB:.3f} diam={dB:.3f}（s=1，即 REF_HEIGHT 本身；人形比例尺高 .754）\n')


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


mid_z = 1.5
# 側面（沿 -Y 看向 +Y，跟棕櫚 sheet 同一個角度：從外側平視，最容易看穿「側面變一條線」類問題）。
frame_ortho((0, -16, mid_z), (0, 0, mid_z), 11, (2000, 1000))
SCENE.render.filepath = str(OUT_DIR / 'coast-flora-sheet-side.png')
bpy.ops.render.render(write_still=True)
print('GD_COAST_FLORA_SHEET_SIDE_OK', str(OUT_DIR / 'coast-flora-sheet-side.png'))

# 斜上方 45°。
frame_ortho((10, -14, mid_z + 4), (0, 0, mid_z), 11, (2000, 1000))
SCENE.render.filepath = str(OUT_DIR / 'coast-flora-sheet-oblique.png')
bpy.ops.render.render(write_still=True)
print('GD_COAST_FLORA_SHEET_OBLIQUE_OK', str(OUT_DIR / 'coast-flora-sheet-oblique.png'))

# 側面低角度（使用者要求「經得起側面低角度」，相機幾乎貼地）。
frame_ortho((0, -16, .35), (0, 0, 1.0), 11, (2000, 1000))
SCENE.render.filepath = str(OUT_DIR / 'coast-flora-sheet-low.png')
bpy.ops.render.render(write_still=True)
print('GD_COAST_FLORA_SHEET_LOW_OK', str(OUT_DIR / 'coast-flora-sheet-low.png'))

bpy.ops.wm.save_as_mainfile(filepath=str((W / 'output/coast-flora/coast-flora-sheet.blend')))
