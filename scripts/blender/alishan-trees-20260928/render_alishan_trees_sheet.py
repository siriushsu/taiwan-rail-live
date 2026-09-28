#!/usr/bin/env python3
"""讀已安裝的 rail-3d/assets/garage-alishan-trees-v1/alishan-trees.json + .bin.gz，用跟
alishan.js 同一套比例公式（見腳本內 SUGI/HINOKI/GIANT 常數，與場景端 TREE_SPECIES 定義一致）
組出「中等尺寸」柳杉 a／b、紅檜 a／b 各一棵＋神木一棵，各配一位 1.7 m 高的簡化人形比例尺，
拍側面（含比例尺）與低角度（看剪影）兩張。不是最終驗收（最終驗收讀瀏覽器裡真正的
InstancedMesh，見 scripts/verify_garage_alishan.mjs 的森林判準），這裡是把「看起來像不像笑話」
擋在接進場景之前的視覺複核，比照 palms-20260928/render_palms_sheet.py 的做法。

用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/alishan-trees-20260928/render_alishan_trees_sheet.py
輸出：/Users/xuxiang/Desktop/車庫B-檢查點/02-阿里山/trees-sheet-side.png
      /Users/xuxiang/Desktop/車庫B-檢查點/02-阿里山/trees-sheet-low.png
"""
import bpy, sys, json, gzip, math, array
from pathlib import Path
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(W / 'scripts/blender/emu3000-20260912'))
import blender_parts as p  # noqa: E402

ASSET_DIR = W / 'rail-3d/assets/garage-alishan-trees-v1'
OUT_DIR = Path('/Users/xuxiang/Desktop/車庫B-檢查點/02-阿里山')
OUT_DIR.mkdir(parents=True, exist_ok=True)

meta = json.loads((ASSET_DIR / 'alishan-trees.json').read_text(encoding='utf-8'))
raw = gzip.decompress((ASSET_DIR / 'alishan-trees.bin.gz').read_bytes())
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


p.reset({'id': 'alishan-trees-sheet', 'body': 'FFFFFF', 'accent': '888888'})
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


TRUNK_SUGI_HEX, TRUNK_HINOKI_HEX = '6b5334', '7a5a3c'
SUGI_A_HEX, SUGI_B_HEX = '3f6b3a', '4d7a42'
HINOKI_A_HEX, HINOKI_B_HEX = '355c42', '2f5240'
GIANT_HEX = '5c6b45'

# 中等尺寸（u=.5），跟 rail-3d/garage-scenes/alishan.js 的 TREE_SPECIES 公式同一組數字
# （trunkFrac／crownWidthFrac／半徑 lerp 端點）——改任一邊記得同步另一邊。
SUGI = dict(totalH=lambda u: 4.2 + (8.6 - 4.2) * u, trunkFrac=.38, crownWFrac=.62, r0=lambda u: .10 + (.20 - .10) * u)
HINOKI = dict(totalH=lambda u: 3.6 + (7.4 - 3.6) * u, trunkFrac=.30, crownWFrac=.95, r0=lambda u: .14 + (.30 - .14) * u)
GIANT = dict(totalH=11.0, trunkFrac=.42, crownWFrac=.8, r0=.62)


def crown_bbox_wh(name):
    """讀零件包圍盒，回傳(半寬 halfWidth=max(x,y)方向, 全高 z)——跟 alishan.js 執行期用
    geometry.boundingBox 換算縮放同一個量法。"""
    verts = part_verts(name)
    xs = [v[0] for v in verts]
    ys = [v[1] for v in verts]
    zs = [v[2] for v in verts]
    half_w = max(max(xs) - min(xs), max(ys) - min(ys)) / 2
    height = max(zs) - min(zs)
    z_min = min(zs)
    return half_w, height, z_min


def build_tree(x0, y0, u, spec, trunk_name, trunk_hex, crown_name, crown_hex, tag):
    total_h = spec['totalH'](u) if callable(spec['totalH']) else spec['totalH']
    r0 = spec['r0'](u) if callable(spec['r0']) else spec['r0']
    trunk_h = total_h * spec['trunkFrac']
    crown_h_target = total_h - trunk_h
    add_part(trunk_name, Txyz(x0, y0, 0) @ Sxyz(r0, r0, trunk_h), trunk_hex, tag + '_trunk')
    half_w, unit_h, z_min = crown_bbox_wh(crown_name)
    crown_w_target = crown_h_target * spec['crownWFrac']
    s_xy = (crown_w_target / 2) / half_w
    s_z = crown_h_target / unit_h
    mw = Txyz(x0, y0, trunk_h - z_min * s_z * 0) @ Sxyz(s_xy, s_xy, s_z)
    # 樹冠零件底部 z=0 對接樹幹頂端。
    mw = Txyz(x0, y0, trunk_h) @ Sxyz(s_xy, s_xy, s_z)
    add_part(crown_name, mw, crown_hex, tag + '_crown')
    return total_h


def add_person_proxy(x0, y0):
    """1.7 m 高的簡化人形比例尺（非真正 kit 拼裝，純視覺比例參考，跟 palms-20260928 同做法）。"""
    h = 1.7
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


SLOTS = [
    (-9, SUGI, 'sugi-trunk', TRUNK_SUGI_HEX, 'sugi-crown-a', SUGI_A_HEX, 'sugiA'),
    (-4.5, SUGI, 'sugi-trunk', TRUNK_SUGI_HEX, 'sugi-crown-b', SUGI_B_HEX, 'sugiB'),
    (4.5, HINOKI, 'hinoki-trunk', TRUNK_HINOKI_HEX, 'hinoki-crown-a', HINOKI_A_HEX, 'hinokiA'),
    (9, HINOKI, 'hinoki-trunk', TRUNK_HINOKI_HEX, 'hinoki-crown-b', HINOKI_B_HEX, 'hinokiB'),
]
heights = {}
for x0, spec, tn, th, cn, ch, tag in SLOTS:
    heights[tag] = build_tree(x0, 0, .5, spec, tn, th, cn, ch, tag)
    add_person_proxy(x0 + 1.3, 0)

# 神木：獨立放在最右側，固定尺寸（全場最粗樹幹的地標樹，不用 u 內插）。
giant_h = build_tree(15.5, 0, .5, {**GIANT, 'totalH': GIANT['totalH'], 'r0': GIANT['r0']},
                      'hinoki-trunk', TRUNK_HINOKI_HEX, 'giant-crown', GIANT_HEX, 'giant')
add_person_proxy(15.5 + 2.4, 0)
heights['giant'] = giant_h

note_path = W / 'output/alishan-trees/NOTES.md'
with open(note_path, 'a', encoding='utf-8') as fh:
    fh.write(f'- [render_alishan_trees_sheet] 中等尺寸(u=.5)總高：{json.dumps(heights, ensure_ascii=False)}（人形比例尺 1.7 m）\n')


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


mid_x = 4.2
mid_z = 5.4
# 側面（沿 -Y 看向 +Y）：五棵樹＋人形比例尺一字排開，最容易讀出「像不像笑話」。
frame_ortho((mid_x, -40, mid_z), (mid_x, 0, mid_z), 34, (2400, 1050))
SCENE.render.filepath = str(OUT_DIR / 'trees-sheet-side.png')
bpy.ops.render.render(write_still=True)
print('GD_ALISHAN_TREES_SHEET_SIDE_OK', str(OUT_DIR / 'trees-sheet-side.png'))

# 低角度（貼地水平看過去）：專看剪影——阿里山評審明講「近看與側面低角度都要經得起看」。
frame_ortho((mid_x, -22, 0.55), (mid_x, 0, 4.0), 30, (2400, 1000))
SCENE.render.filepath = str(OUT_DIR / 'trees-sheet-low.png')
bpy.ops.render.render(write_still=True)
print('GD_ALISHAN_TREES_SHEET_LOW_OK', str(OUT_DIR / 'trees-sheet-low.png'))

# 樹幹基部特寫（紅檜＋神木，看板根凸稜與縱向溝紋是否讀得出來，近看是否經得起看）。
frame_ortho((9, -6, 0.9), (9, 0, 0.9), 3.2, (1400, 900))
SCENE.render.filepath = str(OUT_DIR / 'trees-sheet-trunk-base.png')
bpy.ops.render.render(write_still=True)
print('GD_ALISHAN_TREES_SHEET_TRUNK_OK', str(OUT_DIR / 'trees-sheet-trunk-base.png'))

bpy.ops.wm.save_as_mainfile(filepath=str((W / 'output/alishan-trees/trees-sheet.blend')))
