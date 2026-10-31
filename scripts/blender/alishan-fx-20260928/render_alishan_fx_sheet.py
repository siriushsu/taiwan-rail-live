#!/usr/bin/env python3
"""讀已安裝的 rail-3d/assets/garage-alishan-fx-v1/alishan-fx.json + .bin.gz 重建幾何，畫審查圖：
(1) fx-sheet-overview.png：4 種雲團（cloud-a/b/c/d）一字排開，各自旁邊配一位零件庫站姿乘客
    （借用 garage-people-v1，同一個 look，靜態站姿無擺盪）當比例尺，斜角俯視看整體圓潤蓬鬆的頂部。
(2) fx-sheet-medium.png：另開乾淨場景，只留一顆雲（cloud-a）＋一位參考乘客站在正旁邊，鏡頭拉近到
    人可以看清楚的距離，直接讀出「雲比人大幾倍」的比例感（總覽圖裡人縮成一個色塊看不清楚，補一張
    中距特寫）。
(3) fx-sheet-low-angle.png：另外單獨放一顆雲＋一位參考乘客，相機貼地水平看過去，專看
    「底部較平」的剪影——呼應驗收要用的低角度截圖角度。
(4) fx-sheet-firefly.png：firefly 零件單獨放大一格（暗色背景，看形狀是不是渾圓的小光點）。

雲團的比例尺換算：雲的網格本身以「模型單位＝阿里山場景單位」建模（半徑約 1），但場景端會在
InstancedMesh 上再乘一個場景縮放（計畫落在 3～5 之間，讓雲叢跨度約 6～10 個場景單位、明顯大於
車與人）。這裡直接套用 CLOUD_PREVIEW_SCALE 預覽「進場景後」的實際觀感，不是畫原始模型單位。

只讀「匯出後」的 json/bin.gz 重建幾何，不是畫 build 階段 .blend 裡的原始物件（沿用
people-20260924/render_people_sheets.py 的教訓：一律以匯出檔案為準）。

用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/alishan-fx-20260928/render_alishan_fx_sheet.py
輸出：/Users/xuxiang/Desktop/車庫B-檢查點/02-阿里山/fx-sheet-*.png
"""
import bpy, sys, json, gzip, math, array
from pathlib import Path
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(W / 'scripts/blender/emu3000-20260912'))
import blender_parts as p  # noqa: E402

FX_DIR = W / 'rail-3d/assets/garage-alishan-fx-v1'
PPL_DIR = W / 'rail-3d/assets/garage-people-v1'
OUT_DIR = Path('/Users/xuxiang/Desktop/車庫B-檢查點/02-阿里山')
OUT_DIR.mkdir(parents=True, exist_ok=True)

CLOUD_PREVIEW_SCALE = 4.0  # 預計進場景後的實際縮放，見檔頭說明


def load_kit(json_path, bin_path):
    meta = json.loads(json_path.read_text(encoding='utf-8'))
    raw = gzip.decompress(bin_path.read_bytes())
    f = array.array('f')
    f.frombytes(raw)
    parts = {q['name']: q for q in meta['parts']}
    return meta, f, parts


FX_META, FX_F, FX_PARTS = load_kit(FX_DIR / 'alishan-fx.json', FX_DIR / 'alishan-fx.bin.gz')
PPL_META, PPL_F, PPL_PARTS = load_kit(PPL_DIR / 'people.json', PPL_DIR / 'people.bin.gz')
RIG = PPL_META['rig']

# ---- 場景（沿用 render_people_sheets.py 的 FLAT shading 設定：純看材質色，不被光照染色）----
p.reset({'id': 'alishan-fx-sheet', 'body': 'FFFFFF', 'accent': '888888'})
p.use('01')
SCENE = bpy.context.scene
SCENE.render.engine = 'BLENDER_WORKBENCH'
# 第二輪修：改用 STUDIO（不是 FLAT）——這批資產只看形狀是否夠圓潤，不像 people 那組要精準比色；
# FLAT 配合非等比縮放的橢球會把稜角放得更明顯（第一輪審查圖看起來像硬石片），STUDIO 的方向性
# 光源才顯得出「圓」。cavity 關掉，避免在平滑法向量上疊加稜線暗邊，反而誤導成多面體觀感。
SCENE.display.shading.light = 'STUDIO'
SCENE.display.shading.studio_light = 'Default'
SCENE.display.shading.color_type = 'MATERIAL'
SCENE.display.shading.show_cavity = False
SCENE.display.shading.show_shadows = False
SCENE.render.film_transparent = False
SCENE.world = bpy.data.worlds.new('sky')
SCENE.world.use_nodes = True
SCENE.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.62, .74, .82, 1)

MAT_CLOUD = p.mat('preview_cloud', 'FFFFFF', 0, .9)
MAT_FIREFLY = p.mat('preview_firefly', 'E7FF6B', 0, .2)
MAT_SKIN = p.mat('preview_skin', 'E9C8A8', 0, .5)
MAT_HAIR = p.mat('preview_hair', '4A3426', 0, .5)
MAT_TOP = p.mat('preview_top', '6F8FA8', 0, .5)
MAT_BOTTOM = p.mat('preview_bottom', '3D4450', 0, .5)
MAT_SHOE = p.mat('preview_shoe', '2E2A28', 0, .5)
PPL_TINT = {'head': MAT_SKIN, 'hair-short': MAT_HAIR, 'torso-shirt': MAT_TOP, 'arm': MAT_TOP,
            'hand': MAT_SKIN, 'leg': MAT_BOTTOM, 'shoe': MAT_SHOE}

_uid = [0]


def uid():
    _uid[0] += 1
    return _uid[0]


def verts_faces(F, q):
    s, c = q['start'], q['count']
    verts = [(F[v*6], F[v*6+1], F[v*6+2]) for v in range(s, s + c)]
    faces = [(i, i+1, i+2) for i in range(0, c, 3)]
    return verts, faces


def add_part(F, q, matrix_world, material, label):
    verts, faces = verts_faces(F, q)
    obj = p.mesh(label, verts, faces, material, 0, True)
    obj.matrix_world = matrix_world
    return obj


def Txyz(x, y, z):
    return Matrix.Translation((x, y, z))


def Rz(t):
    return Matrix.Rotation(t, 4, 'Z')


def add_reference_person(pos, heading=0.0):
    """靜態站姿（無走路擺盪），複用 people-v1 的 pivot 慣例：頭/髮在 neck，手臂/手在 shoulder，腿/鞋在 hip。
    退件修（第二輪）：漏了單份零件（head/hair-short）自己的 pivot 平移，先前直接用 root 擺，
    等於把頭放到局部原點（貼近地面），人看起來「沒有頭、腳邊多一顆深色球」。torso-shirt 的
    pivot 剛好是 [0,0,0]，所以之前沒露餡；補上 Txyz(*pivot) 對所有零件一視同仁。"""
    root = Txyz(*pos) @ Rz(heading)
    for name in ['head', 'hair-short', 'torso-shirt']:
        q = PPL_PARTS[name]
        mw = root @ Txyz(*q['pivot'])
        add_part(PPL_F, q, mw, PPL_TINT[name], f'ref{uid()}_{name}')
    for name in ['arm', 'hand', 'leg', 'shoe']:
        q = PPL_PARTS[name]
        piv = q['pivot']
        for second in (False, True):
            piv2 = (piv[0], -piv[1] if second else piv[1], piv[2])
            mw = root @ Txyz(*piv2)
            add_part(PPL_F, q, mw, PPL_TINT[name], f'ref{uid()}_{name}{"_2" if second else ""}')


def add_cloud(name, pos, scale):
    q = FX_PARTS[name]
    mw = Txyz(*pos) @ Matrix.Diagonal((scale, scale, scale, 1))
    return add_part(FX_F, q, mw, MAT_CLOUD, f'{name}_{uid()}')


def frame_camera(loc, target, ortho_scale, res, name):
    camdata = bpy.data.cameras.new('cam_' + name)
    camera = bpy.data.objects.new('camobj_' + name, camdata)
    bpy.context.collection.objects.link(camera)
    SCENE.camera = camera
    camdata.type = 'ORTHO'
    camera.location = Vector(loc)
    camera.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    camdata.ortho_scale = ortho_scale
    SCENE.render.resolution_x, SCENE.render.resolution_y = res
    SCENE.render.resolution_percentage = 100
    return camera


# ============================================================
# (1) 總覽：4 種雲團一字排開，各自旁邊站一位參考乘客，斜角俯視。
# ============================================================
CLOUDS = ['cloud-a', 'cloud-b', 'cloud-c', 'cloud-d']
COL = 14.0  # 第二輪修：雲叢局部半徑放大後（含頂部 puff 外擴）實測跨度可達約 3 個模型單位，
# ×CLOUD_PREVIEW_SCALE(4) 後直徑近 12；COL 要夠大才不會讓相鄰雲叢在總覽圖裡黏在一起。
CLOUD_Z = CLOUD_PREVIEW_SCALE * .40  # 主體球中心 z≈.4×半徑、半徑最大到 baseline*1.15≈.6，抬到明顯高於地面
for i, name in enumerate(CLOUDS):
    cx = (i - 1.5) * COL
    add_cloud(name, (cx, 0.0, CLOUD_Z), CLOUD_PREVIEW_SCALE)
    add_reference_person((cx + COL * .40, 0.0, 0.0), heading=math.pi / 2)

HORIZ_SPAN, PX = COL * 4 + 6, 55
img_w = round(HORIZ_SPAN * PX)
img_h = round(img_w * 900 / 1600)
frame_camera((0, -46, 11.0), (0, 0, 3.6), HORIZ_SPAN, (img_w, img_h), 'overview')
SCENE.render.filepath = str(OUT_DIR / 'fx-sheet-overview.png')
bpy.ops.render.render(write_still=True)
print('GD_FX_SHEET_OVERVIEW_OK', str(OUT_DIR / 'fx-sheet-overview.png'), img_w, img_h)

# ============================================================
# (2) 中距特寫：另開乾淨場景，只留一顆雲（cloud-a）＋一位參考乘客站在正旁邊，鏡頭拉近到
#     人可以看清楚的距離，直接讀出「雲比人大幾倍」的比例感（第一輪總覽圖人縮成一個色塊看不清楚）。
# ============================================================
for obj in list(bpy.data.objects):
    if obj.type in ('MESH', 'CAMERA'):
        bpy.data.objects.remove(obj, do_unlink=True)
add_cloud('cloud-a', (0, 0, CLOUD_Z), CLOUD_PREVIEW_SCALE)
add_reference_person((CLOUD_PREVIEW_SCALE * 1.05, 0, 0), heading=math.pi / 2)
mid_w, mid_h = 1400, 1100
frame_camera((0, -22, 6.0), (0, 0, CLOUD_Z * .7), 11.0, (mid_w, mid_h), 'medium')
SCENE.render.filepath = str(OUT_DIR / 'fx-sheet-medium.png')
bpy.ops.render.render(write_still=True)
print('GD_FX_SHEET_MEDIUM_OK', str(OUT_DIR / 'fx-sheet-medium.png'))

# ============================================================
# (3) 低角度特寫：只留一顆雲（cloud-b，較集中渾圓的代表）＋一位參考乘客，相機貼地、水平看過去，
#     專看雲底剪影是否夠平、人是否完整入鏡（第一輪人被裁到畫面邊緣只剩一截）。
# ============================================================
for obj in list(bpy.data.objects):
    if obj.type in ('MESH', 'CAMERA'):
        bpy.data.objects.remove(obj, do_unlink=True)
add_cloud('cloud-b', (0, 0, CLOUD_Z), CLOUD_PREVIEW_SCALE)
add_reference_person((CLOUD_PREVIEW_SCALE * 1.5, 0, 0), heading=math.pi / 2)
low_w, low_h = 1500, 900
frame_camera((2, -16, 0.55), (2, 0, CLOUD_Z * .55), 13.0, (low_w, low_h), 'low_angle')
SCENE.render.filepath = str(OUT_DIR / 'fx-sheet-low-angle.png')
bpy.ops.render.render(write_still=True)
print('GD_FX_SHEET_LOW_OK', str(OUT_DIR / 'fx-sheet-low-angle.png'))

# ============================================================
# (3) firefly 單獨放大一格（暗色背景，看形狀）。
# ============================================================
for obj in list(bpy.data.objects):
    if obj.type in ('MESH', 'CAMERA'):
        bpy.data.objects.remove(obj, do_unlink=True)
add_part(FX_F, FX_PARTS['firefly'], Matrix.Identity(4), MAT_FIREFLY, 'firefly_solo')
SCENE.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.05, .06, .10, 1)
frame_camera((0, -4, 0), (0, 0, 0), 1.6, (700, 700), 'firefly')
SCENE.render.filepath = str(OUT_DIR / 'fx-sheet-firefly.png')
bpy.ops.render.render(write_still=True)
print('GD_FX_SHEET_FIREFLY_OK', str(OUT_DIR / 'fx-sheet-firefly.png'))

bpy.ops.wm.save_as_mainfile(filepath=str(W / 'output/alishan-fx/build/fx-sheet.blend'))
