#!/usr/bin/env python3
"""讀已安裝的 rail-3d/assets/garage-people-v1/people.json + .bin.gz，依計畫 Task 8 Step 6 的組裝規則
（T(pivot′)·R 零件變換、T(pos)·Rz(heading)·S(scale) 根變換、走路/坐姿擺動公式）把零件拼成不同外型的人，
畫兩張一覽圖：
  output/people/contact-sheet.png：12 種站姿外型（含 2 個小孩；每種配件／上身／髮型至少各一次）
    排成兩排，另加 1 個走路中（φ=π/2，側面示範步伐）與 1 個坐著的人。
  output/people/parts-sheet.png：16 個零件各一格、標上零件名。

兩張圖都讀「匯出後」的 people.json/.bin.gz 重建幾何，不是畫 build 階段 .blend 裡的原始物件——Task 4/5
的教訓是 .blend 看不出匯出時可能引入的差異，一律以匯出檔案為準。

用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/people-20260924/render_people_sheets.py
"""
import bpy, sys, json, gzip, math, array
from pathlib import Path
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(W / 'scripts/blender/emu3000-20260912'))
import blender_parts as p  # noqa: E402

ASSET_DIR = W / 'rail-3d/assets/garage-people-v1'
OUT_DIR = W / 'output/people'
OUT_DIR.mkdir(parents=True, exist_ok=True)

meta = json.loads((ASSET_DIR / 'people.json').read_text(encoding='utf-8'))
raw = gzip.decompress((ASSET_DIR / 'people.bin.gz').read_bytes())
F = array.array('f')
F.frombytes(raw)
PARTS = {q['name']: q for q in meta['parts']}
RIG = meta['rig']
NAMES = ['head', 'hair-short', 'hair-long', 'hair-bun', 'torso-shirt', 'torso-jacket', 'torso-hoodie', 'torso-dress',
         'arm', 'hand', 'leg', 'shoe', 'acc-backpack', 'acc-suitcase', 'acc-handbag', 'acc-hat']


def part_verts_faces(name):
    q = PARTS[name]
    s, c = q['start'], q['count']
    verts = [(F[v*6], F[v*6+1], F[v*6+2]) for v in range(s, s + c)]
    faces = [(i, i+1, i+2) for i in range(0, c, 3)]
    return verts, faces


def part_bounds_center(name):
    verts, _ = part_verts_faces(name)
    xs = [v[0] for v in verts]; ys = [v[1] for v in verts]; zs = [v[2] for v in verts]
    return Vector(((min(xs)+max(xs))/2, (min(ys)+max(ys))/2, (min(zs)+max(zs))/2))


# ---- 場景 ----
p.reset({'id': 'people-sheets', 'body': 'FFFFFF', 'accent': '888888'})
p.use('01')
SCENE = bpy.context.scene
SCENE.render.engine = 'BLENDER_WORKBENCH'
# FLAT（不是 STUDIO）：STUDIO 的雙色 matcap 會在陰影側染出偏冷色調，量出來的顏色會跟材質本身的
# base color 對不上（實測第一版 STUDIO 光讓腿部的深藍看起來偏紫、判讀不出「配色可換」）。FLAT 純看
# 材質色，配合 cavity 保留邊緣可讀性但不染色。
SCENE.display.shading.light = 'FLAT'
SCENE.display.shading.color_type = 'MATERIAL'
SCENE.display.shading.show_cavity = True
SCENE.display.shading.show_shadows = False
SCENE.render.film_transparent = False

MATS = {}


def mat_hex(hexcolor, tag):
    hexcolor = hexcolor.lstrip('#')
    if hexcolor not in MATS:
        MATS[hexcolor] = p.mat('c_' + tag + '_' + hexcolor, hexcolor, 0, .6)
    return MATS[hexcolor]


FIXED_MATS = {}


def mat_linear(rgb, tag):
    key = tuple(round(c, 4) for c in rgb)
    if key not in FIXED_MATS:
        m = bpy.data.materials.new('cfix_' + tag)
        m.diffuse_color = (*rgb, 1); m.use_nodes = True
        bsdf = m.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = (*rgb, 1)
        bsdf.inputs['Metallic'].default_value = 0
        bsdf.inputs['Roughness'].default_value = .6
        FIXED_MATS[key] = m
    return FIXED_MATS[key]


def material_for(tint, look, part):
    if tint == 'fixed':
        return mat_linear(part['color'], part['name'])
    hexcolor = {'top': look['top'], 'bottom': look['bottom'], 'skin': look['skin'],
                'hair': look['hairColor'], 'accent': look['accent']}[tint]
    return mat_hex(hexcolor, tint)


_uid = [0]


def add_part_object(name, matrix_world, material, label):
    verts, faces = part_verts_faces(name)
    obj = p.mesh(label, verts, faces, material, 0, True)
    obj.matrix_world = matrix_world
    return obj


def Ry(t):
    return Matrix.Rotation(t, 4, 'Y')


def Rz(t):
    return Matrix.Rotation(t, 4, 'Z')


def Txyz(x, y, z):
    return Matrix.Translation((x, y, z))


def Sxyz(s):
    m = Matrix.Identity(4); m[0][0] = m[1][1] = m[2][2] = s
    return m


# ============================================================
# 組裝一個人（計畫 Task 8 Step 6：根變換 T(pos)·Rz(heading)·S(s)；零件變換 T(pivot′)·R；
# 走路擺動 leg/shoe=Ry(±.45 sinφ) 第一份+第二份−、arm/hand/acc-handbag=Ry(∓.35 sinφ)；
# 坐姿 leg/shoe=Ry(−π/2) 且根下移使 hip 落在椅面；acc-suitcase 用專屬 T(−.35,−shoulder.y,0)·Ry(.35)）。
# 靜態 idle sway（Rz(.03 sin(.8t+h))）省略：幅度 <2°，對一覽圖判讀無影響。
# ============================================================
def add_person(pos, heading, look, pose='stand', phase=0.0, row_z=0.0):
    s = look['scale']
    z0 = row_z
    if pose == 'walk':
        z0 += .015 * abs(math.sin(phase))
    if pose == 'sit':
        bench_seat = .46
        z0 = row_z + bench_seat - RIG['hip'][2] * s
    root = Txyz(pos[0], pos[1], z0) @ Rz(heading) @ Sxyz(s)

    def place(name, second=False, extra_r=None, custom_local=None):
        q = PARTS[name]
        if custom_local is not None:
            local = custom_local
        else:
            piv = q['pivot']
            piv2 = (piv[0], -piv[1] if second else piv[1], piv[2])
            local = Txyz(*piv2) @ (extra_r if extra_r is not None else Matrix.Identity(4))
        mw = root @ local
        mat = material_for(q['tint'], look, q)
        add_part_object(name, mw, mat, f'p{uid_next()}_{name}{"_2" if second else ""}')

    if pose == 'sit':
        swing_leg, swing_leg2 = Ry(-math.pi/2), Ry(-math.pi/2)
    else:
        swing_leg, swing_leg2 = Ry(.45*math.sin(phase)), Ry(-.45*math.sin(phase))
    swing_arm, swing_arm2 = Ry(-.35*math.sin(phase)), Ry(.35*math.sin(phase))

    place('head')
    place('hair-' + look['hair'])
    place('torso-' + look['torso'])
    place('arm', second=False, extra_r=swing_arm)
    place('arm', second=True, extra_r=swing_arm2)
    place('hand', second=False, extra_r=swing_arm)
    place('hand', second=True, extra_r=swing_arm2)
    place('leg', second=False, extra_r=swing_leg)
    place('leg', second=True, extra_r=swing_leg2)
    place('shoe', second=False, extra_r=swing_leg)
    place('shoe', second=True, extra_r=swing_leg2)
    acc = look.get('accessory')
    if acc == 'suitcase':
        place('acc-suitcase', custom_local=Txyz(-.35, -RIG['shoulder'][1], 0) @ Ry(.35))
    elif acc == 'handbag':
        place('acc-handbag', second=False, extra_r=swing_arm)
    elif acc == 'backpack':
        place('acc-backpack')
    elif acc == 'hat':
        place('acc-hat')


def uid_next():
    _uid[0] += 1
    return _uid[0]


def make_look(torso, hair, accessory, top, bottom, hair_color, skin, accent, scale=1.0):
    return dict(torso=torso, hair=hair, accessory=accessory, top=top, bottom=bottom,
                hairColor=hair_color, skin=skin, accent=accent, scale=scale)


TOPS = ['d9c7a3', '6f8fa8', 'b8574a', 'e8e3d6', '4e5d6c', '8a9a5b', 'c98f5d', '7b6a8f']
BOTTOMS = ['3d4450', '6b5a48', '2f3a4c', '8c8374']
HAIRC = ['2b2320', '4a3426', '1f1f24', '7a5a3a']
SKINS = ['e9c8a8', 'd6a987', 'b98663', 'f1d3b8']
ACCENTS = ['c9463d', '2f6f8f', 'e0b44c', '3b3b3b']

# 12 種站姿外型：torso/hair 各出現 ≥1 次，4 種配件（backpack/suitcase/handbag/hat）各 ≥1 次，2 個小孩。
LOOKS = [
    make_look('shirt', 'short', None, TOPS[0], BOTTOMS[0], HAIRC[0], SKINS[0], ACCENTS[0]),
    make_look('jacket', 'long', 'backpack', TOPS[1], BOTTOMS[1], HAIRC[1], SKINS[1], ACCENTS[1]),
    make_look('hoodie', 'bun', 'suitcase', TOPS[2], BOTTOMS[2], HAIRC[2], SKINS[2], ACCENTS[2]),
    make_look('dress', 'short', 'handbag', TOPS[3], BOTTOMS[0], HAIRC[3], SKINS[3], ACCENTS[3]),
    make_look('shirt', 'long', 'hat', TOPS[4], BOTTOMS[1], HAIRC[0], SKINS[0], ACCENTS[0]),
    make_look('jacket', 'bun', None, TOPS[5], BOTTOMS[2], HAIRC[1], SKINS[1], ACCENTS[1]),
    make_look('hoodie', 'short', 'backpack', TOPS[6], BOTTOMS[3], HAIRC[2], SKINS[2], ACCENTS[2]),
    make_look('dress', 'long', None, TOPS[7], BOTTOMS[0], HAIRC[3], SKINS[3], ACCENTS[3]),
    make_look('shirt', 'short', None, TOPS[2], BOTTOMS[1], HAIRC[0], SKINS[0], ACCENTS[0], scale=.7),
    make_look('hoodie', 'bun', None, TOPS[5], BOTTOMS[2], HAIRC[1], SKINS[1], ACCENTS[1], scale=.7),
    make_look('jacket', 'short', 'suitcase', TOPS[1], BOTTOMS[3], HAIRC[2], SKINS[2], ACCENTS[2]),
    make_look('dress', 'bun', 'handbag', TOPS[3], BOTTOMS[0], HAIRC[3], SKINS[3], ACCENTS[3]),
]
WALK_LOOK = make_look('shirt', 'long', None, TOPS[0], BOTTOMS[1], HAIRC[1], SKINS[1], ACCENTS[0])
SIT_LOOK = make_look('hoodie', 'short', None, TOPS[6], BOTTOMS[2], HAIRC[2], SKINS[2], ACCENTS[1])

# 退件修：改兩排（原本單排，使用者要求「每個人在圖上至少 300 px 高」，兩排＋放大版面才做得到
# 兼顧「看得清楚」與「圖不會過寬」）。14 人分兩排各 7 個：上排 LOOKS[0..6]、下排 LOOKS[7..11]＋
# 走路＋坐姿。用 row_z 把整個人（含站姿/走路擺盪/坐姿下沉）一起往上平移到另一排的高度——
# 兩排各自站在自己的（看不見的）地面，不是同一個地面上「疊」在一起。
COL = 1.4
ROW_TOP_Z = 2.0  # 下排地面在 0、上排在 2.0（夠清淨身高上限 ~1.93 含帽子，見下方相機框景註解）
row0 = [(i, LOOKS[i], 'stand') for i in range(7)]
row1 = [(i - 7, LOOKS[i], 'stand') for i in range(7, 12)] + [(5, WALK_LOOK, 'walk'), (6, SIT_LOOK, 'sit')]
lineup = [(c, look, pose, ROW_TOP_Z) for c, look, pose in row0] + [(c, look, pose, 0.0) for c, look, pose in row1]

for col, look, pose, row_z in lineup:
    # 坐姿的腿轉成水平朝 local +X；heading=-90° 時 local +X 恰好指向鏡頭方向，腿會整段透視縮成一個
    # 小點（實測第一版就是這樣，幾乎看不到腿）。跟走路一樣改側面（heading=0）水平伸出的腿才看得見。
    heading = 0.0 if pose in ('walk', 'sit') else -math.pi/2
    add_person(((col-3)*COL, 0.0), heading, look, pose=pose, phase=math.pi/2 if pose == 'walk' else 0.0, row_z=row_z)

note_path = OUT_DIR / 'NOTES.md'
with open(note_path, 'a', encoding='utf-8') as fh:
    fh.write(f'- [render_people_sheets] contact-sheet：{len(lineup)} 人兩排各 7（上排 7 站姿／下排 5 站姿＋1 走路＋1 坐），退件修：每人 ≥300px 高。\n')


def frame_camera(loc, target, ortho_scale, res):
    camdata = bpy.data.cameras.new('cam_' + str(uid_next()))
    camera = bpy.data.objects.new('camobj_' + str(uid_next()), camdata)
    bpy.context.collection.objects.link(camera)
    SCENE.camera = camera
    camdata.type = 'ORTHO'
    camera.location = Vector(loc)
    camera.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    camdata.ortho_scale = ortho_scale
    SCENE.render.resolution_x, SCENE.render.resolution_y = res
    SCENE.render.resolution_percentage = 100
    return camera


# 退件修：兩排＋每人 ≥300px 高的框景計算——下排地面 z=0（坐姿可下沉到約 -.1）、上排地面
# ROW_TOP_Z=2.0，人身高上限（大人 scale 1.06、戴帽子）約 1.93（1.7 基準×1.06 再加帽頂超出頭頂
# 的量），上排最高點約 2.0+1.93=3.93；取 VERT_SPAN=4.5（留邊界）。HORIZ_SPAN 依 7 欄×COL=1.4
# 間距抓 10.6。px_per_unit=260：一個 1.7～1.8 高的人約 440～470px，遠高於「至少 300px」的要求。
VERT_SPAN, HORIZ_SPAN, PX = 4.5, 10.6, 260
img_w, img_h = round(HORIZ_SPAN * PX), round(VERT_SPAN * PX)
mid_z = (-.1 + (ROW_TOP_Z + 1.93)) / 2
frame_camera((0, -20, mid_z), (0, .4, mid_z), HORIZ_SPAN, (img_w, img_h))
SCENE.render.filepath = str(OUT_DIR / 'contact-sheet.png')
bpy.ops.render.render(write_still=True)
print('GD_CONTACT_SHEET_OK', str(OUT_DIR / 'contact-sheet.png'), img_w, img_h)

# ============================================================
# parts-sheet：16 個零件各一格（4x4），每個零件用自己的包圍盒中心對齊格子中心，格子下方放文字標籤。
# ============================================================
for obj in list(bpy.data.objects):
    if obj.type in ('MESH', 'CAMERA'):
        bpy.data.objects.remove(obj, do_unlink=True)

CELL, TOP = 1.5, 1.2


def add_label(text, loc):
    d = bpy.data.curves.new('lbl_' + text, 'FONT')
    d.body = text; d.size = .12; d.align_x = 'CENTER'; d.align_y = 'TOP'; d.extrude = 0
    o = bpy.data.objects.new('lbl_obj_' + text, d)
    bpy.context.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (math.radians(90), 0, 0)  # 讓文字正面朝 -Y（鏡頭方向）
    if 'lbl_black' not in bpy.data.materials:
        m = bpy.data.materials.new('lbl_black'); m.diffuse_color = (0, 0, 0, 1); m.use_nodes = True
        m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0, 0, 0, 1)
    d.materials.append(bpy.data.materials['lbl_black'])
    return o


for idx, name in enumerate(NAMES):
    col, row = idx % 4, idx // 4
    cx, cz = (col - 1.5) * CELL, TOP - row * CELL
    q = PARTS[name]
    look0 = make_look('shirt', 'short', None, TOPS[0], BOTTOMS[0], HAIRC[0], SKINS[0], ACCENTS[0])
    mat = material_for(q['tint'], look0, q)
    center = part_bounds_center(name)
    mw = Txyz(cx, 0, cz) @ Txyz(-center.x, -center.y, -center.z)
    add_part_object(name, mw, mat, 'ps_' + name)
    add_label(name, (cx, -.55, cz - .6))

# 4 排（TOP 到 TOP-3*CELL）＋最下一排的標籤（再往下 .6）決定整體要框住的範圍，置中後留約 15% 邊界。
bottom = TOP - 3 * CELL - .6 - .15
top = TOP + .15 + .2
target_z = (top + bottom) / 2
span = max(top - bottom, 4 * CELL + 1.0) * 1.08
frame_camera((0, -9.5, target_z), (0, 0, target_z), span, (1700, 1700))
SCENE.render.filepath = str(OUT_DIR / 'parts-sheet.png')
bpy.ops.render.render(write_still=True)
print('GD_PARTS_SHEET_OK', str(OUT_DIR / 'parts-sheet.png'))

bpy.ops.wm.save_as_mainfile(filepath=str(OUT_DIR / 'people-sheets.blend'))
