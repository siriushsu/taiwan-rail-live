#!/usr/bin/env python3
"""建 people：月台乘客零件庫（garage-parts-v1）。16 個零件（頭、三種髮型、四種上身、手臂／手／腿／鞋
各兩份、四種配件），供 Task 8 的 InstancedMesh 在月台上組出不同外型、走位、上下車的乘客。

延續車模的 Q 版圓潤風格：頭稍大、不做五官、無文字商標，不像任何真實人物；每個零件以自己的轉軸為
原點匯出（頭／髮型／帽子在 neck；手臂／手／手提包在 shoulder；腿／鞋在 hip；上身／後背包／行李箱在
[0,0,0]）；成對零件（arm／hand／leg／shoe）只建一份、對自己的 xz 平面左右對稱，第二份由場景端把轉軸
的 y 取負、不鏡像幾何。

沿用 build_pantograph.py 的自製匯出模式（calc_loop_triangles + corner_normals），以及 blender_parts.py
的 box／cyl／rod／mesh 原語（bevel 一律 0：finish() 的倒角是固定 3 段 BEVEL modifier，小零件疊起來
很快超支，示意等級不需要導角；smooth=True 讓圓柱／球體靠平滑法向量顯得圓潤，不必靠幾何細分）。

用法：FLEET_RENDER=0 /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/people-20260924/build_people.py
輸出：
  output/people/build/people.raw.bin + .meta.json + .blend（中繼，不進 repo）
  rail-3d/assets/garage-people-v1/people.json + people.bin.gz（正式資產；沒有既有資料要合併，
  本腳本直接一次寫出，不像 emu3000 系列需要 install_assets.py 的「從 BASE 還原外觀」步驟）
"""
import bpy, bmesh, sys, math, struct, json, hashlib, gzip
from pathlib import Path
from mathutils import Vector

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]  # repo 根目錄（scripts/blender/<本目錄>/<本檔>）
sys.path.insert(0, str(W / 'scripts/blender/emu3000-20260912'))
import blender_parts as p  # noqa: E402

BUILD_DIR = W / 'output/people/build'
BUILD_DIR.mkdir(parents=True, exist_ok=True)
ASSET_DIR = W / 'rail-3d/assets/garage-people-v1'
NOTES_PATH = W / 'output/people/NOTES.md'


def note(msg):
    line = f'- [build_people] {msg}\n'
    with open(NOTES_PATH, 'a', encoding='utf-8') as f:
        f.write(line)
    print(line, end='')


# rig：Interfaces 逐值字面（P1／P2 判準直接比對這幾個數字，不能只是「差不多」）
RIG = {'height': 1.7, 'hip': [0, .1, .86], 'shoulder': [0, .2, 1.36], 'neck': [0, 0, 1.42]}

p.reset({'id': 'people', 'body': 'FFFFFF', 'accent': '888888'})
p.use('01')

# 中性預覽材質（Task 8 執行期改用 setColorAt 依 look 上色；這裡只是方便自己在 .blend 裡看清楚零件）
m_skin = p.mat('people_skin_preview', 'E9C8A8', 0, .5)
m_hair = p.mat('people_hair_preview', '4A3426', 0, .5)
m_top = p.mat('people_top_preview', '6F8FA8', 0, .5)
m_bottom = p.mat('people_bottom_preview', '3D4450', 0, .5)
m_accent = p.mat('people_accent_preview', 'C9463D', 0, .5)
SHOE_COLOR_HEX = '2E2A28'
m_shoe = p.mat('people_shoe_fixed', SHOE_COLOR_HEX, 0, .5)


def icosphere(name, loc, radius, material, subdivisions=1, scale=(1, 1, 1)):
    """低面數球體（圓潤頭／髮型／手／配件用）。用物件本身身分當索引鍵，不依賴 BMVert.index
    （create_icosphere 剛建立的頂點在 ensure_lookup_table 之後 .index 不保證已回填）。
    scale≠(1,1,1) 時做非等比縮放（球→橢球，鞋頭用）。"""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius)
    bm.verts.ensure_lookup_table()
    index_of = {v: i for i, v in enumerate(bm.verts)}
    verts = [(loc[0] + v.co.x * scale[0], loc[1] + v.co.y * scale[1], loc[2] + v.co.z * scale[2]) for v in bm.verts]
    faces = [tuple(index_of[v] for v in f.verts) for f in bm.faces]
    bm.free()
    return p.mesh(name, verts, faces, material, 0, True)


def rod_round(name, a, b, r, material, n=8, cap=None):
    """退件修（缺陷 3）：兩端收成圓錐尖點取代平蓋（原 rod() 兩端是平蓋 n 邊形），
    配合 smooth=True 讓 arm／leg 兩端看起來圓潤而非平切。極點就落在 a／b 本身（不像第一版
    往外伸出去超過 a／b——那一版讓 leg 的極點戳出 shoe 底部以外、hair 罩變高，兩者一起把
    P2 的組裝身高頂到 1.765 超過上限 1.75）；改成滿半徑的環從 a／b 往中段內縮 cap，
    整體包絡跟原本的平蓋 rod() 完全一樣，只有內部幾何從平面變尖錐。"""
    va, vb = Vector(a), Vector(b)
    axis = (vb - va).normalized()
    length = (vb - va).length
    u = axis.cross(Vector((0, 0, 1)))
    if u.length < .01:
        u = axis.cross(Vector((0, 1, 0)))
    u.normalize()
    v = axis.cross(u)
    cap = min(r, length * .3) if cap is None else min(cap, length * .3)
    ring = lambda c: [tuple(c + r * (math.cos(2 * math.pi * i / n) * u + math.sin(2 * math.pi * i / n) * v)) for i in range(n)]
    verts = [tuple(va)] + ring(va + axis * cap) + ring(vb - axis * cap) + [tuple(vb)]
    pa, ra, rb, pb = 0, 1, 1 + n, 1 + 2 * n
    faces = [(pa, ra + i, ra + (i + 1) % n) for i in range(n)]
    faces += [(ra + i, ra + (i + 1) % n, rb + (i + 1) % n, rb + i) for i in range(n)]
    faces += [(rb + i, rb + (i + 1) % n, pb) for i in range(n)]
    return p.mesh(name, verts, faces, material, 0, True)


def domed_cyl(name, cx, cy, z0, body_h, dome_h, r, material, n=8, rings=3, bottom_cap=True):
    """退件修（缺陷 3）：直筒＋四分之一圓輪廓收縮到極點的圓頂（膠囊肩線），取代 cyl() 的平頂圓柱
    ——原本的平頂 n 邊形是 torsoUpFlat 過高（.66～.78）的直接原因。z0 起算：body_h 是直筒段，
    再疊 dome_h 的圓頂（半徑隨 rings 段四分之一圓輪廓收到 0＝極點）。底部保留平蓋（朝下，
    不計入 upFlat，且維持零件是封閉網格＝P6 新增的「網格封閉」判準）。"""
    verts = []
    rings_r = [r, r]
    rings_z = [z0, z0 + body_h]
    for k in range(1, rings + 1):
        ang = (k / rings) * (math.pi / 2)
        rings_r.append(r * math.cos(ang))
        rings_z.append(z0 + body_h + dome_h * math.sin(ang))
    ring_idx = []
    for rr, zz in zip(rings_r[:-1], rings_z[:-1]):
        ring_idx.append(len(verts))
        for i in range(n):
            a = 2 * math.pi * i / n
            verts.append((cx + rr * math.cos(a), cy + rr * math.sin(a), zz))
    pole_idx = len(verts)
    verts.append((cx, cy, rings_z[-1]))
    faces = []
    if bottom_cap:
        faces.append(tuple(reversed(range(ring_idx[0], ring_idx[0] + n))))
    for b in range(len(ring_idx) - 1):
        s0, s1 = ring_idx[b], ring_idx[b + 1]
        for i in range(n):
            i2 = (i + 1) % n
            faces.append((s0 + i, s0 + i2, s1 + i2, s1 + i))
    s_last = ring_idx[-1]
    for i in range(n):
        i2 = (i + 1) % n
        faces.append((s_last + i, s_last + i2, pole_idx))
    return p.mesh(name, verts, faces, material, 0, True)


def uv_sphere(name, loc, r, material, n=10, rings=2):
    """退件修第三輪（缺陷：頭部只有 8 段、正面輪廓是六角形）：icosphere 的 subdivisions 只能整數跳級
    （20→80 三角形），沒辦法直接指定「水平分段數」；改成可控制經線數 n（水平分段）與緯線環數 rings
    （不含極點與赤道，每個半球）的完整 UV 球，n=10 確保正面輪廓至少 10 邊。三角形數＝10n（2 個極點扇形
    2n ＋ (2rings)個緯線環帶中的 (2rings-1) 個環帶 ×2n... 實際以匯出後的 count 為準，不手算）。"""
    cx, cy, cz = loc
    lat_steps = 2 * rings + 2
    phase = math.pi / n  # 相位偏移半格：n 為偶數時讓其中兩個頂點精確落在 ±Y 軸上（角度 90°/270°），
    # 不偏移的話 90° 落在兩個頂點中間，赤道環量到的最大 |y| 會比 r 小（n=10 時少約 5%），
    # P8「頭寬 ≥.9×肩寬」是拿 head 外框的 |y| 算，偏移後量到的頭寬才是真正的 2r。
    verts, ring_idx = [], []
    for k in range(1, lat_steps):
        lat = -math.pi / 2 + (k / lat_steps) * math.pi
        rr, zz = r * math.cos(lat), cz + r * math.sin(lat)
        ring_idx.append(len(verts))
        for i in range(n):
            a = phase + 2 * math.pi * i / n
            verts.append((cx + rr * math.cos(a), cy + rr * math.sin(a), zz))
    south, north = len(verts), len(verts) + 1
    verts.append((cx, cy, cz - r))
    verts.append((cx, cy, cz + r))
    faces = []
    s0 = ring_idx[0]
    for i in range(n):
        faces.append((south, s0 + (i + 1) % n, s0 + i))
    for b in range(len(ring_idx) - 1):
        r0, r1 = ring_idx[b], ring_idx[b + 1]
        for i in range(n):
            i2 = (i + 1) % n
            faces.append((r0 + i, r0 + i2, r1 + i2, r1 + i))
    sN = ring_idx[-1]
    for i in range(n):
        faces.append((north, sN + i, sN + (i + 1) % n))
    return p.mesh(name, verts, faces, material, 0, True)


def rod_hemi_top(name, a, b, r, material, n=8, cap_rings=1):
    """退件修第三輪（缺陷：手臂頂端凸出肩線像尖角）：rod_round() 兩端都是直錐（環直接連到極點），
    改成「底端（接手掌，a）維持直錐（便宜、反正被手蓋住看不到）、頂端（接肩，b）用 cap_rings 段中間環
    走四分之一圓輪廓收攏」——頂端極點仍然精確落在 b 本身（不像真正的半球會凸出 b 之外 r），只是輪廓從
    直線角錐換成弧形，配合 smooth=True 讓頂端讀成半球而不是尖角，同時 P2 組裝身高與手臂頂高度都不受影響
    （极点位置沒變，只有中段幾何從平面變弧面）。"""
    va, vb = Vector(a), Vector(b)
    axis = (vb - va).normalized()
    length = (vb - va).length
    u = axis.cross(Vector((0, 0, 1)))
    if u.length < .01:
        u = axis.cross(Vector((0, 1, 0)))
    u.normalize()
    v = axis.cross(u)
    cap = min(r, length * .3)
    ring = lambda c, rad: [tuple(c + rad * (math.cos(2 * math.pi * i / n) * u + math.sin(2 * math.pi * i / n) * v)) for i in range(n)]
    verts = [tuple(va)] + ring(va + axis * cap, r) + ring(vb - axis * cap, r)
    top_rings = []
    for s in range(1, cap_rings + 1):
        ang = (s / (cap_rings + 1)) * (math.pi / 2)
        c = (vb - axis * cap) + axis * cap * math.sin(ang)
        top_rings.append(ring(c, r * math.cos(ang)))
    for tr in top_rings:
        verts += tr
    verts.append(tuple(vb))
    pa, ra, rb = 0, 1, 1 + n
    faces = [(pa, ra + i, ra + (i + 1) % n) for i in range(n)]
    faces += [(ra + i, ra + (i + 1) % n, rb + (i + 1) % n, rb + i) for i in range(n)]
    prev = rb
    for tr_start in range(rb + n, rb + n + n * cap_rings, n):
        faces += [(prev + i, prev + (i + 1) % n, tr_start + (i + 1) % n, tr_start + i) for i in range(n)]
        prev = tr_start
    pole_b = 1 + 2 * n + n * cap_rings
    faces += [(prev + i, prev + (i + 1) % n, pole_b) for i in range(n)]
    return p.mesh(name, verts, faces, material, 0, True)


def sphere_cap(name, center, R, theta_cut, material, n=10, rings=3, tilt=0.0):
    """主對話第三輪收件修（缺陷：頭頂從髮帽穿出來，像禿頂戴髮帶；帽子正面看是紅方塊）：球心 center、
    半徑 R 的球冠。極點從 +Z 往 −X 傾 tilt 弧度（髮帽往後傾：前額髮際線高、後腦蓋到後頸），
    θ 從極點量到 theta_cut（可超過 90°），每環 theta_cut/rings；底部用切面上的 n 邊形封口（封閉網格，P6）。
    經向相位偏移半格，同 uv_sphere：n 為偶數時有兩個頂點落在 ±Y 軸上。"""
    cx, cy, cz = center
    cb, sb = math.cos(-tilt), math.sin(-tilt)
    rot = lambda x, y, z: (cx + x * cb + z * sb, cy + y, cz - x * sb + z * cb)
    phase = math.pi / n
    verts = [rot(0, 0, R)]
    for k in range(1, rings + 1):
        th = theta_cut * k / rings
        for i in range(n):
            a = phase + 2 * math.pi * i / n
            verts.append(rot(R * math.sin(th) * math.cos(a), R * math.sin(th) * math.sin(a), R * math.cos(th)))
    faces = [(0, 1 + i, 1 + (i + 1) % n) for i in range(n)]
    for k in range(rings - 1):
        up, lo = 1 + k * n, 1 + (k + 1) * n
        faces += [(lo + i, lo + (i + 1) % n, up + (i + 1) % n, up + i) for i in range(n)]
    last = 1 + (rings - 1) * n
    faces.append(tuple(reversed(range(last, last + n))))
    return p.mesh(name, verts, faces, material, 0, True)


# ============================================================
# 16 個零件（座標：每個零件以自己的轉軸為局部原點；面向 +X、左手 +Y、腳底 z=0）
# ============================================================
parts = {}

# ---- head／hair（轉軸＝neck＝[0,0,1.42]）----
HEAD_CZ = .115  # 主對話第三輪收件修：.13→.115，讓包住整顆頭頂的髮帽（頂在 HEAD_CZ+HAIR_R）不把 P2 身高頂過 1.75
HEAD_R = .175  # 退件修第三輪：P8「頭寬≥.9×最寬肩寬」用新肩寬（BODY_R=.17）量，.16 量出來只有
# .801（頭寬本身的量法有 uv_sphere 分段誤差，見 uv_sphere 的 phase 修正），加大到 .175 才過。
# 退件修第三輪（缺陷：頭部 8 段六角形輪廓）：icosphere→uv_sphere，n=10 保證正面輪廓至少 10 邊。
parts['head'] = [uv_sphere('people_head', (0, 0, HEAD_CZ), HEAD_R, m_skin, n=10, rings=2)]

# 主對話第三輪收件修（缺陷：頭頂從髮帽穿出來，正面看像禿頂戴一圈髮帶）：上一版的髮帽是 domed_cyl，
# 穹頂只有 2 圈、極點（.29）低於頭頂（.305），頭頂直接穿出去。改成跟頭同心、半徑大 .025 的球冠
# （sphere_cap），往後傾 HAIR_TILT：前額髮際線在 HAIRLINE_Z，兩側降到耳朵高度（約 .07），後腦蓋到後頸
# （約 −.01），不必再另外補後腦球。HAIR_R−HEAD_R＝.025 是為了讓頭的頂點不穿出髮帽的面：3 圈 10 段時
# 髮帽面離球心最近 .2×cos18°×cos17.3°≈.1815，大於頭半徑 .175。
# HAIRLINE_Z 落在 P7 臉部帶上緣（頭底＋頭高 55%＝.1325）與頭頂上 1/3 下緣（.173）之間；
# 傾斜後髮際線在臉部帶兩角（y ±.105）約 .142，仍在臉部帶之上。
HAIRLINE_Z = .155
HAIR_R = HEAD_R + .025
HAIR_TILT = math.radians(25)
HAIR_THETA = HAIR_TILT + math.acos((HAIRLINE_Z - HEAD_CZ) / HAIR_R)  # 前額（方位 0）那一點的邊緣剛好在 HAIRLINE_Z


def main_cap(tag):
    return sphere_cap(f'people_hair_{tag}_cap', (0, 0, HEAD_CZ), HAIR_R, HAIR_THETA, m_hair, n=10, rings=3, tilt=HAIR_TILT)


parts['hair-short'] = [main_cap('short')]
# long：後腦與兩側垂到肩後（局部 z −.27 起，人座標 1.15，比肩轉軸 1.36 低很多）的一片，
# x 範圍 −.24～−.12，頂端伸進髮帽後緣；遠在頭前緣之後，正面測不到，不擋臉。
parts['hair-long'] = [
    main_cap('long'),
    p.box('people_hair_long_sheet', (-.18, 0, -.09), (.12, .22, .36), m_hair, bevel=0),
]
# bun：頭頂偏後一顆髻，一半露在髮帽外（離頭心 .164＋半徑 .075）。
parts['hair-bun'] = [
    main_cap('bun'),
    icosphere('people_hair_bun_ball', (-.10, 0, .245), .075, m_hair, subdivisions=0),
]

# ---- torso（轉軸＝[0,0,0]，局部座標＝世界座標）----
# 退件修第三輪（缺陷：頭浮在上身上方 9 公分、肩線掉到 1.20 讓手臂頂凸出 16 公分）：round 2 為了
# 壓 torsoUpFlat≤.25 把圓頂壓得很矮（DOME_H=.13 但 Z_DOME0 只到 1.17），中心頂只到 1.30～1.44、
# 肩線（手臂內緣處）掉到 1.20。這輪 torsoUpFlat 門檻已拿掉，改把圓頂基圈（Z_DOME0）直接頂到肩轉軸
# 附近（1.32），讓「肩線」（手臂內緣 yIn=shoulder.y−arm半徑≈.155，落在圓頂基圈半徑 BODY_R=.17
# 之內）落在圓頂內側、量到的高度貼著 Z_DOME0～中心頂之間，同時中心頂（圓頂極點）拉到 1.40（頭底
# 1.39 之上，頭不再懸空）。BODY_R 從 .16 加大到 .17，同時等於 yIn，手臂上段（z 1.20～1.30）落在
# 直筒段、半寬剛好貼到手臂內緣，跟手臂之間沒有縫。
BODY_R = .17
Z_DOME0 = 1.32  # 直筒頂＝圓頂底，落在 P8 的手臂內緣測試點附近
DOME_H = .08  # 中心頂＝1.32+.08=1.40，頭底 1.39 之上一點點，頭「坐」在上身上不懸空
parts['torso-shirt'] = [domed_cyl('people_torso_shirt', 0, 0, .78, Z_DOME0 - .78, DOME_H, BODY_R, m_top, n=8, rings=3)]
parts['torso-jacket'] = [
    domed_cyl('people_torso_jacket_body', 0, 0, .78, Z_DOME0 - .78, DOME_H, BODY_R, m_top, n=8, rings=3),
    p.box('people_torso_jacket_lapel_l', (.13, .07, 1.28), (.08, .03, .16), m_top, bevel=0),
    p.box('people_torso_jacket_lapel_r', (.13, -.07, 1.28), (.08, .03, .16), m_top, bevel=0),
]
parts['torso-hoodie'] = [
    domed_cyl('people_torso_hoodie_body', 0, 0, .78, Z_DOME0 - .78, DOME_H, BODY_R, m_top, n=8, rings=3),
    # 兜帽中心跟著圓頂基圈往上移（原本貼合舊 Z_DOME0=1.17，這輪基圈在 1.32，兜帽也上移，
    # 半徑不變，x 仍收在身體本身背面之前，避免比直筒段更往後凸出）。
    icosphere('people_torso_hoodie_hood', (-.02, 0, 1.42), .11, m_top, subdivisions=0),
]
# dress：裙擺較寬（BODY_R+.01，退件修第三輪從 +.02 收窄，避免把 maxSW 撐太寬讓頭寬/肩寬比不過 .9）、
# 下擺到 .55（比其他上身低，覆蓋大腿上段），肩線圓頂與其他上身一致（z0、body_h 各自算到同一個
# Z_DOME0，圓頂本身完全共用）。
parts['torso-dress'] = [domed_cyl('people_torso_dress', 0, 0, .55, Z_DOME0 - .55, DOME_H, BODY_R + .01, m_top, n=8, rings=3)]

# ---- 手臂／手（轉軸＝shoulder＝[0,.2,1.36]，局部原點＝肩，垂直下垂、無側偏，滿足左右對稱）----
# 退件修第三輪（缺陷：手臂頂端凸出肩線像尖角）：round 2 的 rod_round() 兩端都是直錐（環直接收到
# 極點），smooth=True 只能讓明暗過渡柔和、遮不住輪廓仍是一條直線的事實，放大看就是尖角。改用
# rod_hemi_top()：底端（接手掌，看不太到）維持便宜的直錐，頂端（接肩，P8 會測）用一段中間環走
# 弧線收攏，讀起來是半球而不是尖角；極點仍精確落在肩轉軸（局部 (0,0,0)）本身，不外凸，配合下面
# 重新調過的上身肩線（Z_DOME0=1.32），手臂頂（人座標 1.36）落在肩線 ±.02～.04 的容許範圍內。
# 半徑 .04→.045，落在退件修要求的 .04～.05 內。
parts['arm'] = [rod_hemi_top('people_arm', (0, 0, -.46), (0, 0, 0), .045, m_top, n=8, cap_rings=1)]
parts['hand'] = [icosphere('people_hand', (0, 0, -.49), .055, m_skin, subdivisions=0)]

# ---- 腿／鞋（轉軸＝hip＝[0,.1,.86]，局部原點＝髖，垂直下垂、無側偏）----
parts['leg'] = [rod_round('people_leg', (0, 0, 0), (0, 0, -.80), .075, m_bottom, n=8)]
# 退件修（缺陷 3，鞋頭平面著色的方塊）：box()→非等比縮放的 icosphere（橢球），鞋頭圓潤；
# bbox 與原本的方塊大致相同（中心、半寬接近），P2／P3 不受影響。
parts['shoe'] = [icosphere('people_shoe', (.08, 0, -.80), 1, m_shoe, subdivisions=1, scale=(.13, .075, .065))]

# ---- 配件 ----
# acc-backpack（轉軸＝[0,0,0]）：背在背上（-X 側）。這輪 BODY_R 從 .16 加大到 .17（身體背面
# 往後移 1 公分），背包位置同步往後退 1 公分，維持跟上身背面原本的相對距離。
parts['acc-backpack'] = [
    p.box('people_acc_backpack_body', (-.22, 0, 1.05), (.10, .24, .30), m_accent, bevel=0),
    p.box('people_acc_backpack_flap', (-.18, 0, .95), (.06, .18, .12), m_accent, bevel=0),
]
# acc-suitcase（轉軸＝[0,0,0]）：原點＝著地輪子（拉桿那側底邊中點，局部 (0,0,0)）；箱身往 -x 延伸。
# 退件修（缺陷 2，拉桿頂碰不到手）：這是使用者原本給的 brief 數字錯了（不是本零件庫的錯），
# 照使用者這次重新推導的目標局部座標 (.03,0,.94)（對應 Task 8 T(-.35,-shoulder.y,0)·Ry(.35) 之後
# 落在右手中心 (0,-.2,.87) 附近）直接把拉桿頂改到那裡；起點留在箱體頂附近、沿背面斜向伸上去
# （單根拉桿，箱子本體尺寸不變）。
parts['acc-suitcase'] = [
    p.box('people_acc_suitcase_body', (-.21, 0, .27), (.42, .26, .54), m_accent, bevel=0),
    p.rod('people_acc_suitcase_handle', (-.06, 0, .52), (.03, 0, .94), .025, m_accent, n=6),
]
# acc-handbag（轉軸＝shoulder，+Y 側）：跟左手臂一起擺；提把在手附近（局部 z≈-.49），包身在手下方稍外側。
parts['acc-handbag'] = [
    p.box('people_acc_handbag_body', (0, .13, -.58), (.10, .14, .16), m_accent, bevel=0),
    p.rod('people_acc_handbag_handle', (0, .09, -.49), (0, .16, -.53), .015, m_accent, n=6),
]
# acc-hat（轉軸＝neck）：棒球帽，帽簷只朝 +X（前），讓看的人分得出人面向哪一邊。
# 主對話第三輪收件修（缺陷：帽冠是 .28 高的直筒，正面看是紅方塊）：帽冠改成跟頭同心的低圓頂
# （球冠，半徑 HAIR_R＋.02，下緣在前額 .14）；3 圈 10 段時帽冠面離球心最近 .22×cos18°×cos14°≈.203，
# 大於髮帽頂點的 .20，髮帽不會穿出帽子。帽簷是插進帽冠前緣的一片薄板。
HAT_R = HAIR_R + .02
HAT_Z0 = .14
parts['acc-hat'] = [
    sphere_cap('people_acc_hat_crown', (0, 0, HEAD_CZ), HAT_R, math.acos((HAT_Z0 - HEAD_CZ) / HAT_R), m_accent, n=10, rings=3),
    p.box('people_acc_hat_brim', (.27, 0, .145), (.16, .20, .016), m_accent, bevel=0),
]

NAMES = ['head', 'hair-short', 'hair-long', 'hair-bun', 'torso-shirt', 'torso-jacket', 'torso-hoodie', 'torso-dress',
         'arm', 'hand', 'leg', 'shoe', 'acc-backpack', 'acc-suitcase', 'acc-handbag', 'acc-hat']
# 退件修（缺陷 4）：arm 的 tint 從 skin 改 top＝全員長袖（穿夾克／帽 T 卻露出手臂不合理，
# 一個零件只能有一種 tint，見 README「設計取捨」）。hand 維持 skin（手掌仍露出）。
TINT = {'head': 'skin', 'hair-short': 'hair', 'hair-long': 'hair', 'hair-bun': 'hair',
        'torso-shirt': 'top', 'torso-jacket': 'top', 'torso-hoodie': 'top', 'torso-dress': 'top',
        'arm': 'top', 'hand': 'skin', 'leg': 'bottom', 'shoe': 'fixed',
        'acc-backpack': 'accent', 'acc-suitcase': 'accent', 'acc-handbag': 'accent', 'acc-hat': 'accent'}
PAIRED = {'arm', 'hand', 'leg', 'shoe'}
PIVOT = {
    'head': RIG['neck'], 'hair-short': RIG['neck'], 'hair-long': RIG['neck'], 'hair-bun': RIG['neck'], 'acc-hat': RIG['neck'],
    'arm': RIG['shoulder'], 'hand': RIG['shoulder'], 'acc-handbag': RIG['shoulder'],
    'leg': RIG['hip'], 'shoe': RIG['hip'],
    'torso-shirt': [0, 0, 0], 'torso-jacket': [0, 0, 0], 'torso-hoodie': [0, 0, 0], 'torso-dress': [0, 0, 0],
    'acc-backpack': [0, 0, 0], 'acc-suitcase': [0, 0, 0],
}

for n in NAMES:
    if n not in parts:
        sys.exit(f'缺零件 {n}')
note('16 個零件物件建模完成：' + json.dumps({k: len(v) for k, v in parts.items()}, ensure_ascii=False))

# ============================================================
# 自製匯出（沿用 build_pantograph.py 的模式：calc_loop_triangles + corner_normals，world space；
# 物件本身沒有額外的 object-level 平移/旋轉，verts 在建模時就直接寫在各零件自己的局部座標，
# 所以 world matrix＝identity，匯出值＝局部值，不需要另外減轉軸）
# ============================================================
deps = bpy.context.evaluated_depsgraph_get()
raw = bytearray()
count = 0
part_ranges = {}
total_tris = 0

for name in NAMES:
    start_vertex = count
    for obj in parts[name]:
        ev = obj.evaluated_get(deps)
        d_mesh = ev.to_mesh()
        d_mesh.calc_loop_triangles()
        wm = obj.matrix_world
        nm_mat = wm.to_3x3().inverted_safe().transposed()
        for tri in d_mesh.loop_triangles:
            for li in tri.loops:
                pos = wm @ d_mesh.vertices[d_mesh.loops[li].vertex_index].co
                normal = (nm_mat @ d_mesh.corner_normals[li].vector).normalized()
                if not all(math.isfinite(v) for v in (*pos, *normal)):
                    raise ValueError('非有限網格 ' + obj.name)
                raw.extend(struct.pack('<6f', *pos, *normal))
                count += 1
            total_tris += 1
        ev.to_mesh_clear()
    part_ranges[name] = {'start': start_vertex, 'count': count - start_vertex}
    note(f'部件 {name!r}：start={start_vertex} count={count - start_vertex}（{(count - start_vertex)//3} 個三角形）')

# P4 自檢：head + 最大髮型 + 最大上身 + 2×(arm+hand+leg+shoe) + 最大配件 ≤600
tri = lambda n: part_ranges[n]['count'] // 3
worst = (tri('head') + max(tri(n) for n in NAMES if n.startswith('hair-'))
         + max(tri(n) for n in NAMES if n.startswith('torso-'))
         + 2 * sum(tri(n) for n in PAIRED)
         + max(tri(n) for n in NAMES if n.startswith('acc-')))
note(f'P4 worst-case 三角形數自檢：{worst}（上限 600）')
if worst > 600:
    sys.exit(f'最壞組合三角形數 {worst} 超過 600')

raw_bytes = bytes(raw)
sha256 = hashlib.sha256(raw_bytes).hexdigest()
vertex_count = count

f = struct.unpack(f'<{len(raw_bytes)//4}f', raw_bytes)


def sub3(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def cross3(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def dot3(a, b):
    return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]


def pos_of(v):
    return (f[v*6], f[v*6+1], f[v*6+2])


def nrm_of(v):
    return (f[v*6+3], f[v*6+4], f[v*6+5])


# P5 自檢：全域無退化三角形（面積 >1e-10）
degen = 0
first_bad = []
for v in range(0, vertex_count, 3):
    A, B, C = pos_of(v), pos_of(v+1), pos_of(v+2)
    area = math.hypot(*cross3(sub3(B, A), sub3(C, A))) / 2
    if not (area > 1e-10):
        degen += 1
        if len(first_bad) < 5:
            first_bad.append(v)
note(f'P5 退化三角形自檢：{degen}（應為 0）')
if degen:
    sys.exit(f'{degen} 個退化三角形：{first_bad}')

# P6 自檢：逐零件三角形朝外——(a) 面法向量（依繞向）與三頂點法向量和同向；(b) 以零件重心算的有號體積 >0。
# 和主對話新加的 P6 判準完全同一套算法（見 verify_garage_stop_assets.mjs），這裡先自己驗一次，
# 紅了才不會等主對話收件才發現。
bad_parts = {}
for name in NAMES:
    rng = part_ranges[name]
    s, c = rng['start'], rng['count']
    cen = [0.0, 0.0, 0.0]
    for v in range(s, s + c):
        for k in range(3):
            cen[k] += f[v*6+k] / c
    bad6 = 0
    vol = 0.0
    for v in range(s, s + c, 3):
        A, B, C = pos_of(v), pos_of(v+1), pos_of(v+2)
        fn = cross3(sub3(B, A), sub3(C, A))
        vn = tuple(nrm_of(v)[k] + nrm_of(v+1)[k] + nrm_of(v+2)[k] for k in range(3))
        if not (dot3(fn, vn) > 0):
            bad6 += 1
        vol += dot3(sub3(A, cen), cross3(sub3(B, cen), sub3(C, cen))) / 6
    if bad6 or not (vol > 0):
        bad_parts[name] = {'反向三角形': bad6, '有號體積': f'{vol:.3e}'}
note('P6 朝外自檢：' + (json.dumps(bad_parts, ensure_ascii=False) if bad_parts else '全部通過'))
if bad_parts:
    sys.exit(f'P6 朝外自檢失敗：{bad_parts}')

SHOE_LINEAR = [round(p.linear(int(SHOE_COLOR_HEX[i:i+2], 16) / 255), 4) for i in (0, 2, 4)]
part_list = []
for n in NAMES:
    entry = {'name': n, 'start': part_ranges[n]['start'], 'count': part_ranges[n]['count'],
             'tint': TINT[n], 'pivot': PIVOT[n], 'perPerson': 2 if n in PAIRED else 1}
    if TINT[n] == 'fixed':
        entry['color'] = SHOE_LINEAR
    part_list.append(entry)

meta = {
    'schema': 'garage-parts-v1', 'id': 'people', 'kind': 'people', 'units': 'model',
    'vertexCount': vertex_count, 'triangleCount': total_tris, 'sha256': sha256,
    'rig': RIG, 'parts': part_list,
}
(BUILD_DIR / 'people.raw.bin').write_bytes(raw_bytes)
(BUILD_DIR / 'people.meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(BUILD_DIR / 'people.blend'))

# ---- 直接安裝為正式資產：沒有既有 people.json 要合併，一次寫出（不需要 emu3000 那套從 BASE 還原外觀的步驟）----
ASSET_DIR.mkdir(parents=True, exist_ok=True)
asset = {
    'schema': 'garage-parts-v1', 'id': 'people', 'kind': 'people', 'units': 'model',
    'mesh': {'file': 'people.bin.gz', 'sha256': sha256, 'encoding': 'float32-le', 'strideBytes': 24,
             'vertexCount': vertex_count, 'triangleCount': total_tris, 'compression': 'gzip'},
    'rig': RIG, 'parts': part_list,
}
(ASSET_DIR / 'people.bin.gz').write_bytes(gzip.compress(raw_bytes, compresslevel=9, mtime=0))
(ASSET_DIR / 'people.json').write_text(json.dumps(asset, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

print('GD_PEOPLE_BUILD_OK', json.dumps({
    'vertexCount': vertex_count, 'triangleCount': total_tris, 'sha256': sha256, 'worst': worst,
    'parts': {n: part_ranges[n]['count'] // 3 for n in NAMES},
}, ensure_ascii=False))
