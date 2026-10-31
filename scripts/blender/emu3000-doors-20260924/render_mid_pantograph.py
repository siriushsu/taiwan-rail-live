"""算 emu3000-mid＋emu3000-pantograph 的交件圖。依 Task 5 要求（coordinator 補充 D）：
一律匯入「最終已併入的資產」rail-3d/assets/garage-blender-v1/*.bin.gz（不是任何 .blend），
這樣才看得出 install_assets.py 併入階段做的事（中間車鏡射接縫、集電弓 rig）。

輸出（output/emu3000-doors/renders/）：
  10-mid-pantograph-down.png   中間車側視，集電弓收折（兩節連桿 IK：下臂平躺 +x 到肘點、上臂折回 -x）
  11-mid-pantograph-up.png     中間車側視，集電弓拉起（IK 目標＝M7 同一套 H=1.95 世界公尺換算）
  12-consist-3car.png          頭＋中＋頭 三車組
  13-mid-roof-closeup.png      車頂近照：底座站在車頂／只有一個車頂單元／中央窗柱，三件事一次看到

用法：
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python \
    scripts/blender/emu3000-doors-20260924/render_mid_pantograph.py
"""
import bpy, sys, gzip, json, math, hashlib, time
from pathlib import Path
from mathutils import Vector

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]  # repo 根目錄（scripts/blender/<本目錄>/<本檔>）
ASSET_DIR = W / 'rail-3d/assets/garage-blender-v1'
OUT_ROOT = W / 'output/emu3000-doors'
RENDERS_DIR = OUT_ROOT / 'renders'
RENDERS_DIR.mkdir(parents=True, exist_ok=True)
NOTES_PATH = OUT_ROOT / 'NOTES.md'


def note(msg):
    with open(NOTES_PATH, 'a', encoding='utf-8') as f:
        f.write(f'- {time.strftime("%H:%M:%S")} [render_mid_pantograph] {msg}\n')
    print(msg)


def load_asset(stem):
    meta = json.loads((ASSET_DIR / f'{stem}.json').read_text(encoding='utf-8'))
    raw = gzip.decompress((ASSET_DIR / f'{stem}.bin.gz').read_bytes())
    if hashlib.sha256(raw).hexdigest() != meta['mesh']['sha256']:
        sys.exit(f'{stem}: 雜湊不符，資產可能損毀')
    return meta, raw


def mat_from_group(name, g):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*g['color'], 1)
    p.inputs['Metallic'].default_value = g['metalness']
    p.inputs['Roughness'].default_value = g['roughness']
    if 'Coat Weight' in p.inputs:
        p.inputs['Coat Weight'].default_value = g.get('clearcoat', 0)
    return m


def build_group_object(coll, name, raw, start_v, count_v, material, parent=None):
    """從 flat triangle-soup（start_v..start_v+count_v，每頂點 6 float：位置+法向量）建一個
    Blender mesh 物件，用 normals_split_custom_set_from_vertices 保留原本逐角法向量
    （沿用 blender_parts.export_model 已驗證可行的匯入寫法）。"""
    n = count_v
    positions = [tuple(raw[(start_v + i) * 6 + k] for k in range(3)) for i in range(n)]
    normals = [tuple(raw[(start_v + i) * 6 + 3 + k] for k in range(3)) for i in range(n)]
    faces = [(i, i + 1, i + 2) for i in range(0, n, 3)]
    d = bpy.data.meshes.new(name)
    d.from_pydata(positions, [], faces)
    d.materials.append(material)
    d.update()
    for poly in d.polygons:
        poly.use_smooth = True
    d.normals_split_custom_set_from_vertices(normals)
    obj = bpy.data.objects.new(name, d)
    coll.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def build_car(coll, stem, meta, raw, name_prefix, parent=None):
    """依 meta.mesh.drawGroups 逐組建物件，全部掛在同一個 parent Empty 下方便整車搬動。"""
    objs = []
    for g in meta['mesh']['drawGroups']:
        m = mat_from_group(f'{name_prefix}:{g["name"]}', g)
        objs.append(build_group_object(coll, f'{name_prefix}:{g["name"]}', raw, g['start'], g['count'], m, parent))
    return objs


def make_empty(coll, name, loc=(0, 0, 0), rot_z=0):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.3
    coll.objects.link(e)
    e.location = Vector(loc)
    e.rotation_euler = (0, 0, math.radians(rot_z))
    return e


# ============================================================
# 場景設置
# ============================================================
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
world = bpy.data.worlds.new('render world')
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
bg.inputs['Color'].default_value = (.16, .17, .19, 1)
bg.inputs['Strength'].default_value = .35
scene.render.engine = 'CYCLES'
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.view_settings.view_transform = 'AgX'
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
coll = bpy.data.collections.new('assets')
scene.collection.children.link(coll)

# 太陽燈（跟 render_common.py 同款角度/強度，維持跟其餘交件圖一致的觀感）
sun_data = bpy.data.lights.new('太陽燈', 'SUN')
sun_data.energy = 3.2
sun_data.angle = math.radians(4.0)
sun_obj = bpy.data.objects.new('太陽燈', sun_data)
coll.objects.link(sun_obj)
sun_obj.rotation_euler = (math.radians(58), 0, math.radians(-40))

floor_mesh = bpy.data.meshes.new('展示台')
floor_mesh.from_pydata([(-100, -100, -.05), (100, -100, -.05), (100, 100, -.05), (-100, 100, -.05)], [], [(0, 1, 2, 3)])
floor_mesh.update()
floor_mat = bpy.data.materials.new('展示台材質')
floor_mat.use_nodes = True
fp = floor_mat.node_tree.nodes['Principled BSDF']
fp.inputs['Base Color'].default_value = (.94, .92, .87, 1)
fp.inputs['Roughness'].default_value = .8
floor_mesh.materials.append(floor_mat)
floor_obj = bpy.data.objects.new('展示台', floor_mesh)
coll.objects.link(floor_obj)

camdata = bpy.data.cameras.new('相機')
camera = bpy.data.objects.new('相機', camdata)
coll.objects.link(camera)
scene.camera = camera
camdata.type = 'ORTHO'


def view(loc, target, scale, res=(1400, 900)):
    camera.location = Vector(loc)
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camdata.ortho_scale = scale
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100


def render(path):
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    note(f'算繪完成：{path.name}')


# ============================================================
# 載入資產
# ============================================================
mid_meta, mid_raw_bytes = load_asset('emu3000-mid')
mid_raw = __import__('array').array('f'); mid_raw.frombytes(mid_raw_bytes)
pan_meta, pan_raw_bytes = load_asset('emu3000-pantograph')
pan_raw = __import__('array').array('f'); pan_raw.frombytes(pan_raw_bytes)
head_meta, head_raw_bytes = load_asset('emu3000')
head_raw = __import__('array').array('f'); head_raw.frombytes(head_raw_bytes)
note(f'載入完成：mid tri={mid_meta["mesh"]["triangleCount"]} pantograph tri={pan_meta["mesh"]["triangleCount"]} head tri={head_meta["mesh"]["triangleCount"]}（全部來自已併入的 .bin.gz，非 .blend）')

mid_root = make_empty(coll, 'mid_root', (0, 0, 0))
build_car(coll, 'emu3000-mid', mid_meta, mid_raw, 'MID', mid_root)

# --- 集電弓 rig：base 固定在 mount；lower 以 mount 為樞紐繞 Y 轉 theta；upper 以 lower 末端為樞紐
#     繞 Y 轉 phi（因為兩臂局部座標都是「沿自己的 +x 伸出去」，世界方向＝繞 Y 軸旋轉該角度）；
#     head 直接掛在 upper 末端。肘朝 +x：兩個角度都讓臂朝 +x 方向抬起。
mount = pan_meta.get('mount') if 'mount' in pan_meta else mid_meta['pantograph']['mount']
rig = pan_meta['rig']
pan_base_empty = make_empty(coll, 'pan_base', mount)
pan_base_empty.parent = mid_root  # 補修 3（第二輪）：沒掛父節點，3-car consist 移動 mid_root 時集電弓留在原地
pan_lower_empty = make_empty(coll, 'pan_lower_joint', (0, 0, 0))
pan_lower_empty.parent = pan_base_empty
pan_upper_empty = make_empty(coll, 'pan_upper_joint', (rig['lower'], 0, 0))
pan_upper_empty.parent = pan_lower_empty


def set_pose(theta_deg, phi_deg):
    # 局部 +x 沿臂的方向；世界要抬高，繞 Y 軸轉「負角度」讓 +x 分量往 +z 抬（右手座標：Ry(-a) 把
    # +x 轉往 +z）。upper 的關節位置固定在 lower 局部座標 (rig.lower,0,0)（父子關係自動帶到世界）。
    pan_lower_empty.rotation_euler = (0, math.radians(-theta_deg), 0)
    pan_upper_empty.rotation_euler = (0, math.radians(-phi_deg) - math.radians(-theta_deg), 0)


for pname, rng in [(q['name'], q) for q in pan_meta['parts']]:
    parent = {'base': pan_base_empty, 'lower': pan_lower_empty, 'upper': pan_upper_empty, 'head': pan_upper_empty}[pname]
    m = mat_from_group(f'PAN:{pname}', {'color': rng['color'], 'metalness': rng['metalness'], 'roughness': rng['roughness']})
    build_group_object(coll, f'PAN:{pname}', pan_raw, rng['start'], rng['count'], m, parent)

note(f'集電弓 rig 建好：mount={mount} rig={rig}')

# --- 補修 5：兩節連桿 IK，跟 verify_garage_stop_assets.mjs 的 M7 同一套模型——水平偏移固定在
#     |lower-upper|、只有垂直 z 隨姿勢變（目標點＝mount + (lower-upper, 0, z)，這正是 M7 公式
#     dd=hypot(lower-upper,z) 背後隱含的幾何）。z=0 時 dd 恰好等於 |lower-upper|，是機構收到最折疊
#     （肘角 180°、上臂完全折回貼著下臂）的姿勢——降弓就用這個。升弓的 z 由 M7 同一條公式反推：
#     scale=1.25/頭車寬，z=H/scale-mount.z-headRise，H=1.95（世界公尺，方案 A）。
def solve_pantograph_ik(z, L1, L2):
    """回傳 (theta_shoulder_deg, theta_elbow_deg)，兩者都是局部 x-z 平面的『世界絕對角』
    （atan2(z,x) 慣例，跟 set_pose 的 theta/phi 定義一致，可以直接傳入不用轉號）。"""
    dx = L1 - L2
    dd = math.hypot(dx, z)
    dd = max(abs(L1 - L2) + 1e-9, min(dd, L1 + L2 - 1e-9))  # 數值安全邊界，避免浮點誤差落在可達範圍外
    cosb = max(-1.0, min(1.0, (L1 * L1 + dd * dd - L2 * L2) / (2 * L1 * dd)))
    beta = math.acos(cosb)
    alpha = math.atan2(z, dx)
    theta_s = alpha - beta  # 肘朝前（elbow-down）：下臂朝 +x 伸、上臂朝後折回頭部，符合單臂集電弓輪廓
    elbow = (L1 * math.cos(theta_s), L1 * math.sin(theta_s))
    theta_e = math.atan2(z - elbow[1], dx - elbow[0])
    return math.degrees(theta_s), math.degrees(theta_e)


def head_local_target(theta_deg, phi_deg):
    """驗算用：依 theta/phi 算出頭部關節實際落點（局部 x-z），核對跟 IK 目標一致。"""
    ex = rig['lower'] * math.cos(math.radians(theta_deg))
    ez = rig['lower'] * math.sin(math.radians(theta_deg))
    hx = ex + rig['upper'] * math.cos(math.radians(phi_deg))
    hz = ez + rig['upper'] * math.sin(math.radians(phi_deg))
    return hx, hz


head_car_width = head_meta['sizeM'][1]
pan_scale = 1.25 / head_car_width
headRise = rig['headRise']
Z_DOWN = 0.0
Z_UP = 1.95 / pan_scale - mount[2] - headRise
POSE_DOWN = solve_pantograph_ik(Z_DOWN, rig['lower'], rig['upper'])
POSE_UP = solve_pantograph_ik(Z_UP, rig['lower'], rig['upper'])
note(f'降弓 IK：z={Z_DOWN} → theta={POSE_DOWN[0]:.2f}° phi={POSE_DOWN[1]:.2f}°　頭部落點驗算={head_local_target(*POSE_DOWN)}（目標=({rig["lower"]-rig["upper"]:.4f},{Z_DOWN})）')
note(f'升弓 IK：H=1.95 scale={pan_scale:.5f} → z={Z_UP:.4f} → theta={POSE_UP[0]:.2f}° phi={POSE_UP[1]:.2f}°　頭部落點驗算={head_local_target(*POSE_UP)}（目標=({rig["lower"]-rig["upper"]:.4f},{Z_UP:.4f})）')

DOOR_CZ_MID = mid_meta['doors']['items'][0]['center'][2] + mid_meta['doors']['items'][0]['height'] * .4
size = mid_meta['sizeM']

# ============================================================
# 10 / 11：中間車側視（集電弓收折／拉起）
# ============================================================
set_pose(*POSE_DOWN)
bpy.context.view_layer.update()
side_target = Vector((0, 0, size[2] * .42))
side_eye = side_target + Vector((.6, -size[1] * 5.2, size[2] * .55))
view(side_eye, side_target, size[0] * 1.08, res=(1600, 700))
render(RENDERS_DIR / '10-mid-pantograph-down.png')

set_pose(*POSE_UP)
bpy.context.view_layer.update()
side_target_up = Vector((0, 0, size[2] * .6))
side_eye_up = side_target_up + Vector((.6, -size[1] * 6.4, size[2] * .30))
view(side_eye_up, side_target_up, size[0] * 1.20, res=(1600, 900))
render(RENDERS_DIR / '11-mid-pantograph-up.png')

# ============================================================
# 13：車頂近照（補修驗收用）。一個畫面要看到三件事：
#   (a) 集電弓底座站在車頂（mount.x≈-2.99 附近，底座局部 z 從 mount 往下貼到車頂）
#   (b) 車頂只剩一個 AC 機組單元（+X 端，x≈+1.3~+3.1；-X 端已刪除，改成平車頂）
#   (c) 中央窗（x=0）有窗柱，不是鏡射縫直接貼合
# 三者 x range 約 [-3.2, +3.2]，取一個從左後方斜上俯瞰的角度，target 落在 (a)(c) 中點，
# ortho_scale 放寬到能連 (b) 一起入鏡。集電弓維持降弓姿勢（停靠常態，底座本身跟姿勢無關）。
# ============================================================
set_pose(*POSE_DOWN)
bpy.context.view_layer.update()

# 沿用 10/11 側視鏡頭同一套慣例（eye 在 -Y 方向），確保左右對應跟其餘圖一致（-X 在畫面左、+X 在右）；
# 只是拉近、抬高視角看下車頂，target 取在底座與中央窗之間，ortho_scale 放寬到能同時看到底座、
# 中央窗、以及 +X 端那唯一一座車頂單元三者。
roof_target = Vector((-1.4, 0, 3.30))
roof_eye = roof_target + Vector((1.0, -7.6, 2.1))
view(roof_eye, roof_target, 7.8, res=(1920, 950))
render(RENDERS_DIR / '13-mid-roof-closeup.png')

# ============================================================
# 12：頭＋中＋頭 三車組（集電弓收折，較符合停靠常態）
# ============================================================
set_pose(*POSE_DOWN)
bpy.context.view_layer.update()
GAP = 0.08
head_len_half = 5.199  # 頭車 -X 端（貫通道端）到原點的距離；+X 端（鼻端）不對稱，只用貫通道端對接
mid_half = mid_meta['sizeM'][0] / 2  # 中間車左右對稱，兩端都是 5.199

mid_root.location = Vector((-(head_len_half + GAP + mid_half), 0, 0))
bpy.context.view_layer.update()

head_a_root = make_empty(coll, 'head_a_root', (0, 0, 0))
build_car(coll, 'emu3000', head_meta, head_raw, 'HEAD_A', head_a_root)

head_c_x = mid_root.location.x - mid_half - GAP - head_len_half
head_c_root = make_empty(coll, 'head_c_root', (head_c_x, 0, 0), rot_z=180)
build_car(coll, 'emu3000', head_meta, head_raw, 'HEAD_C', head_c_root)

note(f'三車組定位：head_a_root.x=0 mid_root.x={mid_root.location.x:.3f} head_c_root.x={head_c_x:.3f}（缺口 {GAP}m）')

# 用實際 bounds（含頭車不對稱的鼻端外伸）算真正的總長與取景範圍，不能只用車體 sizeM 概估——
# head_a 的鼻端伸到 world x=+4.873（bounds.max[0]，不是對稱的 +5.05），head_c 轉了 180°後鼻端
# 伸到更負的方向，兩端都要照實際 bounds 算才不會裁到車頭。
hb = head_meta['bounds']  # 頭車局部 bounds：min/max
head_a_world_max_x = 0 + hb['max'][0]
head_c_world_min_x = head_c_x - hb['max'][0]  # 180° 繞 Z：局部 +X 端變成世界 -X 方向
consist_min_x, consist_max_x = head_c_world_min_x, head_a_world_max_x
consist_len = consist_max_x - consist_min_x
consist_mid_x = (consist_min_x + consist_max_x) / 2
note(f'三車組真實範圍：x∈[{consist_min_x:.3f},{consist_max_x:.3f}] 總長={consist_len:.3f}m')

target_c = Vector((consist_mid_x, 0, size[2] * .42))
eye_c = target_c + Vector((4.0, -consist_len * 1.3, size[2] * 1.1))
view(eye_c, target_c, consist_len * 1.15, res=(2200, 800))  # ortho_scale 精確倍率不確定，先抓寬裕值再依算出圖調整
render(RENDERS_DIR / '12-consist-3car.png')

print('GD_RENDER_MID_PANTOGRAPH_OK', json.dumps({'renders': ['10-mid-pantograph-down.png', '11-mid-pantograph-up.png', '12-consist-3car.png', '13-mid-roof-closeup.png']}, ensure_ascii=False))
