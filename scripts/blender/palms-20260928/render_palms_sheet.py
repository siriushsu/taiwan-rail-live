#!/usr/bin/env python3
"""讀已安裝的 rail-3d/assets/garage-palms-v1/palms.json + .bin.gz，用跟 south-coast.js 相同量級的
公式組一棵「中等尺寸」檳榔＋一棵「中等尺寸」椰子，各拍側面與斜上方兩張，旁邊擺一個簡化人形當比例尺
（身高 .754，取自 south-coast.js 執行期 peopleBounds() 量到的站姿乘客身高，同一個場景座標系）。
不是最終驗收（最終驗收是 verify_garage_south_coast_stop.mjs 讀瀏覽器裡真正的 InstancedMesh），
這裡純粹是形狀／比例的視覺複核，用來在接進場景前先擋掉「看起來像個笑話」這類問題。

用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/palms-20260928/render_palms_sheet.py
輸出：/Users/xuxiang/Desktop/車庫B-檢查點/01-南迴/palms-sheet-side.png
      /Users/xuxiang/Desktop/車庫B-檢查點/01-南迴/palms-sheet-oblique.png
"""
import bpy, sys, json, gzip, math, array
from pathlib import Path
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(W / 'scripts/blender/emu3000-20260912'))
import blender_parts as p  # noqa: E402

ASSET_DIR = W / 'rail-3d/assets/garage-palms-v1'
OUT_DIR = Path('/Users/xuxiang/Desktop/車庫B-檢查點/01-南迴')
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


p.reset({'id': 'palms-sheet', 'body': 'FFFFFF', 'accent': '888888'})
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


def Ry(t):
    return Matrix.Rotation(t, 4, 'Y')


TRUNK_HEX, CROWN_HEX = '71664e', '4f7a4a'
BETEL_FROND_HEX, COCO_FROND_HEX = '5a7a3f', '3f6a5a'
FRUIT_HEX = '5b4530'

# 中等尺寸（u=.5，公式跟 south-coast.js 的新版一致，見該檔 palmSize()/palmFrondSpread() 注解）：
# 檳榔 trunkH=lerp(1.95,2.4,.5)=2.175、椰子 trunkH=lerp(1.85,2.55,.5)=2.2。
BETEL = dict(trunkH=2.175, trunkR=.06, crownFrac=.13, crownRFactor=1.18, count=9,
             droopBase=-.15, droopAmp=.35, spreadFactor=1.15, diamFrac=.45)
COCO = dict(trunkH=2.2, trunkR=.125, count=13,
            droopBase=.68, droopAmp=.25, spreadFactor=1.40, diamFrac=.70, fruitN=8)


def build_betel(x0, y0):
    b = BETEL
    trunkH, trunkR = b['trunkH'], b['trunkR']
    crownH = trunkH * b['crownFrac']
    crownBase = trunkH - crownH * .3
    topZ = crownBase + crownH
    add_part('betel-trunk', Txyz(x0, y0, 0) @ Sxyz(trunkR, trunkR, trunkH), TRUNK_HEX, 'trunk')
    add_part('betel-crownshaft', Txyz(x0, y0, crownBase) @ Sxyz(trunkR * b['crownRFactor'], trunkR * b['crownRFactor'], crownH), CROWN_HEX, 'crown')
    totalTop = topZ
    crownDiam = totalTop * b['diamFrac']
    spread = (crownDiam / 2) * b['spreadFactor']
    for j in range(b['count']):
        yaw = j * 2.399963
        droop = b['droopBase'] + b['droopAmp'] * math.sin(j * 2.399963)
        length = spread * (.85 if j < 3 else .9)
        mw = Txyz(x0, y0, topZ) @ Rz(yaw) @ Ry(droop) @ Sxyz(length, length, length)
        add_part('betel-fronds', mw, BETEL_FROND_HEX, 'bfrond')
    return topZ, crownDiam


def build_coco(x0, y0):
    c = COCO
    trunkH, trunkR = c['trunkH'], c['trunkR']
    topZ = trunkH
    add_part('coco-trunk', Txyz(x0, y0, 0) @ Sxyz(trunkR, trunkR, trunkH), TRUNK_HEX, 'trunk')
    crownDiam = topZ * c['diamFrac']
    crownR = crownDiam / 2
    spread = crownR * c['spreadFactor']
    for j in range(c['count']):
        yaw = j * 2.399963
        droop = c['droopBase'] + c['droopAmp'] * math.sin(j * 2.399963)
        length = spread * (.85 if j < 3 else .9)
        mw = Txyz(x0, y0, topZ) @ Rz(yaw) @ Ry(droop) @ Sxyz(length, length, length)
        add_part('coco-fronds', mw, COCO_FROND_HEX, 'cfrond')
    fruitZ = topZ - trunkH * .08
    for k in range(c['fruitN']):
        a = k * 2.399963
        r = crownR * .12
        fx, fy = x0 + r * math.cos(a), y0 + r * math.sin(a)
        add_part('coco-fruit', Txyz(fx, fy, fruitZ - k * .01) @ Sxyz(.09, .09, .09), FRUIT_HEX, 'fruit')
    return topZ, crownDiam


def add_person_proxy(x0, y0):
    """簡化人形比例尺（非真正 kit 拼裝）：身高 .754，取自 south-coast.js peopleBounds() 量到的
    站姿乘客實際身高——這裡只是視覺比例參考，不是最終驗收（最終驗收讀真正的 people 零件庫）。"""
    h = .754
    skin, top, bottom = mat_hex('e0b088', 'skin'), mat_hex('6f8fa8', 'top'), mat_hex('3d4450', 'bottom')
    # 用 box()/mesh() 原語直接搭一個簡化人形（腿＋身體＋頭），不必載入完整 people 零件庫——
    # 這裡純粹是視覺比例參考，材質物件直接傳給 box()/mesh()（不是 blender_parts.py 的字串色鍵）。
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


betelTop, betelDiam = build_betel(-1.6, 0)
add_person_proxy(-1.6 + .9, 0)
cocoTop, cocoDiam = build_coco(1.6, 0)
add_person_proxy(1.6 + 1.1, 0)

note_path = W / 'output/palms/NOTES.md'
with open(note_path, 'a', encoding='utf-8') as fh:
    fh.write(f'- [render_palms_sheet] betel: topZ={betelTop:.3f} diam={betelDiam:.3f}；coco: topZ={cocoTop:.3f} diam={cocoDiam:.3f}（中等尺寸 u=.5，人形比例尺高 .754）\n')


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


mid_z = 1.4
# 側面（沿 -Y 看向 +Y，跟使用者截圖那個角度一致：從外側平視，最容易看穿「葉片側看變一條線」）。
frame_ortho((0, -14, mid_z), (0, 0, mid_z), 6.6, (1500, 1000))
SCENE.render.filepath = str(OUT_DIR / 'palms-sheet-side.png')
bpy.ops.render.render(write_still=True)
print('GD_PALMS_SHEET_SIDE_OK', str(OUT_DIR / 'palms-sheet-side.png'))

# 斜上方 45°。
frame_ortho((9, -9, mid_z + 2.6), (0, 0, mid_z), 6.6, (1500, 1000))
SCENE.render.filepath = str(OUT_DIR / 'palms-sheet-oblique.png')
bpy.ops.render.render(write_still=True)
print('GD_PALMS_SHEET_OBLIQUE_OK', str(OUT_DIR / 'palms-sheet-oblique.png'))

bpy.ops.wm.save_as_mainfile(filepath=str((W / 'output/palms/palms-sheet.blend')))
