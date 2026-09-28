#!/usr/bin/env python3
"""擴充 garage-palms-v1（南迴海岸景植被，車庫精修第 2 項）：加入
(a) 2 款彎幹椰子樹幹（coco-curved-a / coco-curved-b，弧度烘進幾何本身，取代舊版「整棵傾斜」的
    近似做法）與 (b) 2 款闊葉樹冠團塊（broadleaf-a / broadleaf-b，各含 trunk+canopy 兩個零件）。

背景（獨立評審 2026-09-28，polish-critique.md「01 藍皮」第 1 項）：山坡撒滿同一款「直挺挺、等粗」
的檳榔/椰子，剪影像「插滿牙籤的綠色軟糖」；棕櫚一路種到稜線，遠看是一排細針戳出山頭。使用者裁示
「細節還是都需要用 blender 製作」。這支腳本只加零件庫，撒點邏輯改在 rail-3d/garage-scenes/south-coast.js。

沿用 palms-20260928/build_palms.py 的做法（同一份 blender_parts.py 原語、同一套自製匯出/自檢區塊），
複製一份而非 import：這個 pipeline 裡每支 build_*.py 都是自包含腳本（build_people.py／build_lanterns.py／
build_palms.py 皆如此），互不 import，方便單獨重跑與追溯。

## 彎幹椰子：幾何慣例（不同於其餘 unit-scale 零件）
既有 6 個零件（trunk/crownshaft/fronds/fruit）都是 unit 尺寸、執行期用非均勻 instance scale
（半徑用 xy、高度用 z）縮放——這對「彎曲」不適用：烘進幾何的彎曲位移量若用局部 X 座標表示，
會被 xy 縮放（半徑）拉伸/壓縮，而不是跟著高度縮放，各棵樹的彎曲角度會因此不一致而失真
（這正是舊版 README「設計取捨」段落解釋過、當初刻意不烘曲度進幾何的原因）。
這兩個新零件改用「絕對尺寸＋執行期均勻縮放」（跟 fronds/fruit 的 uniform scale 慣例一致）：
在 REF_HEIGHT=2.2（跟 render_palms_sheet.py 的椰子中等尺寸 u=.5 同一個參考高度）這個絕對尺寸
下建模＋烘彎曲，執行期只用 instance.scale=[s,s,s]（三軸同一個值）去做整棵大小變化，彎曲角度
（相對於整棵高度的比例）因此不受縮放影響。south-coast.js 用跟直幹椰子完全相同的
cocoSize(s).trunkH 當「目標最終高度」反推 s=目標高度/REF_HEIGHT，兩種椰子因此落在同一個
既有驗證高度範圍內，只有樹幹形狀不同。

葉冠（fronds）與果實（fruit）直接沿用既有 coco-fronds／coco-fruit 幾何（south-coast.js 端各自
再建一組獨立 InstancedMesh，只是共用同一份 geometry），這支腳本不重建它們，只重建彎幹的
trunk。

## 闊葉樹冠團塊：多顆 icosphere 疊成一個零件
每款闊葉樹＝1 個主樹冠（半徑較大、subdivisions=1，比舊版「三顆 icosphere 疊出樹冠」用的
subdivisions=0 更圓，配合 smooth=True 從近處看不會是「多面體綠寶石」）＋2~3 個小樹冠疊在
主樹冠周邊，撐出不規則的叢狀剪影（不是完美球體）。疊球之間允許互相貫穿——每顆 icosphere
自己是封閉朝外的殼，貫穿不影響「逐零件朝外自檢」（見下方 P6，體積是逐三角形對零件重心的
帶號和，殼與殼重疊時只是疊加，不會讓某個殼的法向量反向）。trunk 是短胖的漸縮圓柱（跟高幹
棕櫚的細長樹幹明顯不同、避免看起來像棕櫚換頭）。

用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/coast-20260928/build_coast_flora.py
輸出（直接覆寫既有正式資產，不是另開新 kind；沒有 CLI 參數）：
  rail-3d/assets/garage-palms-v1/palms.json + palms.bin.gz（10 個既有＋新零件＝12 個零件）
  output/coast-flora/build/*（中繼，不進 repo）
"""
import bpy, bmesh, sys, math, struct, json, hashlib, gzip
from pathlib import Path

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(W / 'scripts/blender/emu3000-20260912'))
import blender_parts as p  # noqa: E402

BUILD_DIR = W / 'output/coast-flora/build'
BUILD_DIR.mkdir(parents=True, exist_ok=True)
ASSET_DIR = W / 'rail-3d/assets/garage-palms-v1'
NOTES_PATH = W / 'output/coast-flora/NOTES.md'
NOTES_PATH.parent.mkdir(parents=True, exist_ok=True)


def note(msg):
    line = f'- [build_coast_flora] {msg}\n'
    with open(NOTES_PATH, 'a', encoding='utf-8') as f:
        f.write(line)
    print(line, end='')


p.reset({'id': 'palms', 'body': 'FFFFFF', 'accent': '888888'})
p.use('01')
m_trunk = p.mat('palms_trunk_preview', '71664e', 0, .7)
m_crown = p.mat('palms_crownshaft_preview', '4f7a4a', 0, .55)
m_frond_betel = p.mat('palms_betel_frond_preview', '5a7a3f', 0, .6)
m_frond_coco = p.mat('palms_coco_frond_preview', '3f6a5a', 0, .6)
m_fruit = p.mat('palms_fruit_preview', '5b4530', 0, .6)
m_bl_trunk = p.mat('coastflora_broadleaf_trunk_preview', '6b5d4a', 0, .75)
m_bl_canopy_a = p.mat('coastflora_broadleaf_a_canopy_preview', '4a7048', 0, .68)
m_bl_canopy_b = p.mat('coastflora_broadleaf_b_canopy_preview', '5c8a4f', 0, .68)


def icosphere(name, loc, radius, material, subdivisions=0):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius)
    bm.verts.ensure_lookup_table()
    index_of = {v: i for i, v in enumerate(bm.verts)}
    verts = [(loc[0] + v.co.x, loc[1] + v.co.y, loc[2] + v.co.z) for v in bm.verts]
    faces = [tuple(index_of[v] for v in f.verts) for f in bm.faces]
    bm.free()
    return p.mesh(name, verts, faces, material, 0, True)


def multi_icosphere(name, lobes, material):
    """lobes: [(loc(x,y,z), radius, subdivisions, squash(sx,sy,sz)), ...]，squash 用來把球壓成
    扁圓頂／橢圓（不改變 subdivisions 所以三角形數可預期）。多顆疊進同一個 bmesh 匯出成一個零件
    ——各顆彼此仍是獨立封閉的殼，貫穿只是視覺疊加，不影響朝外/體積自檢（見檔頭說明）。"""
    bm = bmesh.new()
    for loc, radius, subdiv, squash in lobes:
        sub = bmesh.new()
        bmesh.ops.create_icosphere(sub, subdivisions=subdiv, radius=radius)
        sub.verts.ensure_lookup_table()
        for v in sub.verts:
            v.co.x = v.co.x * squash[0] + loc[0]
            v.co.y = v.co.y * squash[1] + loc[1]
            v.co.z = v.co.z * squash[2] + loc[2]
        bmesh.ops.recalc_face_normals(sub, faces=sub.faces)
        mesh_tmp = bpy.data.meshes.new('tmp_lobe')
        sub.to_mesh(mesh_tmp)
        sub.free()
        bm.from_mesh(mesh_tmp)
        bpy.data.meshes.remove(mesh_tmp)
    bm.verts.ensure_lookup_table()
    index_of = {v: i for i, v in enumerate(bm.verts)}
    verts = [(v.co.x, v.co.y, v.co.z) for v in bm.verts]
    faces = [tuple(index_of[v] for v in f.verts) for f in bm.faces]
    bm.free()
    return p.mesh(name, verts, faces, material, 0, True)


def tapered_cyl(name, r0, r1, material, n=8, height=1.0):
    """幹：跟 palms-20260928/build_palms.py 的 tapered_cyl 相同做法，多一個 height 參數
    （既有棕櫚幹是 unit 高度 z:0→1，這裡的闊葉樹幹改用絕對高度，跟同檔彎幹椰子一致，
    執行期一律用均勻 instance scale，不靠非均勻縮放做高度變化）。"""
    verts = []
    for z, r in [(0, r0), (height, r1)]:
        for i in range(n):
            a = 2 * math.pi * i / n
            verts.append((r * math.cos(a), r * math.sin(a), z))
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    return p.mesh(name, verts, faces, material, 0, True)


def bent_cyl(name, height, r0, r1, bend_fn, material, n=8, rings=6):
    """彎幹漸縮圓柱：height 絕對高度（不是 unit），bend_fn(t)->(dx,dy) 是第 t∈[0,1] 環的中心
    局部位移（絕對單位，不是半徑的倍率），rings 環數（多環才看得出弧度、但不用太多——smooth=True
    的法向量插值已經幫忙把折面藏起來）。回傳 (mesh物件, 頂環中心位移)，頂環位移供呼叫端算
    fronds 的 hub 世界座標用。"""
    verts, ring_idx = [], []
    for ri in range(rings):
        t = ri / (rings - 1)
        z = t * height
        r = r0 + (r1 - r0) * t
        cx, cy = bend_fn(t)
        ring_idx.append(len(verts))
        for i in range(n):
            a = 2 * math.pi * i / n
            verts.append((cx + r * math.cos(a), cy + r * math.sin(a), z))
    faces = [tuple(reversed([ring_idx[0] + i for i in range(n)])),
             tuple(ring_idx[-1] + i for i in range(n))]
    for k in range(rings - 1):
        s0, s1 = ring_idx[k], ring_idx[k + 1]
        faces += [(s0 + i, s0 + (i + 1) % n, s1 + (i + 1) % n, s1 + i) for i in range(n)]
    return p.mesh(name, verts, faces, material, 0, True), bend_fn(1.0)


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


parts = {}

# ---- 彎幹椰子（絕對尺寸，REF_HEIGHT=2.2、r0=.125／r1=.0775＝*.62，跟 render_palms_sheet.py
# 椰子中等尺寸 u=.5 同一個參考尺寸；south-coast.js 用 targetHeight/REF_HEIGHT 反推 uniform scale，
# 讓彎幹椰子落在跟直幹椰子相同的既有驗證高度範圍） ----
REF_HEIGHT = 2.2
REF_R0, REF_R1 = .125, .0775

BEND_A = .42  # 變體 A：單調彎曲（越往上彎越多，像順風長年吹出的斜幹）。


def bend_a(t):
    return (BEND_A * (t ** 1.6), 0.0)


BEND_B = .58  # 變體 B：先彎出去、頂端再往回收一點（S 形，比 A 更戲劇化，兩者剪影明顯不同）。


def bend_b(t):
    primary = smoothstep(0, .7, t) * BEND_B
    correction = -smoothstep(.55, 1.0, t) * BEND_B * .35
    return (primary + correction, 0.0)


parts['coco-curved-a-trunk'], top_a = bent_cyl('palms_coco_curved_a_trunk', REF_HEIGHT, REF_R0, REF_R1, bend_a, m_trunk)
parts['coco-curved-b-trunk'], top_b = bent_cyl('palms_coco_curved_b_trunk', REF_HEIGHT, REF_R0, REF_R1, bend_b, m_trunk)
note(f'彎幹椰子 A：頂環局部位移={top_a}（BEND_A={BEND_A}）；B：頂環局部位移={top_b}（BEND_B={BEND_B}，S 形）。'
     f'REF_HEIGHT={REF_HEIGHT} REF_R0={REF_R0} REF_R1={REF_R1}——south-coast.js 的 CURVED_TOP_A/CURVED_TOP_B/CURVED_REF_HEIGHT 必須跟這三個數字一致。')

# ---- 闊葉樹冠團塊（絕對尺寸；2 款：A 較圓高、B 較寬扁，剪影明顯不同） ----
BL_TRUNK_H = .62
parts['broadleaf-a-trunk'] = tapered_cyl('coastflora_broadleaf_a_trunk', .13, .10, m_bl_trunk, n=8, height=BL_TRUNK_H)
parts['broadleaf-a-canopy'] = multi_icosphere('coastflora_broadleaf_a_canopy', [
    ((0, 0, BL_TRUNK_H + 1.05), 1.05, 1, (1.15, 1.15, .82)),
    ((.62, .18, BL_TRUNK_H + .68), .58, 0, (1, 1, .82)),
    ((-.5, .46, BL_TRUNK_H + .72), .52, 0, (1, 1, .82)),
    ((-.1, -.62, BL_TRUNK_H + .6), .5, 0, (1, 1, .8)),
], m_bl_canopy_a)

parts['broadleaf-b-trunk'] = tapered_cyl('coastflora_broadleaf_b_trunk', .15, .11, m_bl_trunk, n=8, height=BL_TRUNK_H * .82)
parts['broadleaf-b-canopy'] = multi_icosphere('coastflora_broadleaf_b_canopy', [
    ((0, 0, BL_TRUNK_H * .82 + .78), 1.28, 1, (1.35, 1.35, .58)),
    ((.92, .3, BL_TRUNK_H * .82 + .5), .66, 0, (1, 1, .7)),
    ((-.85, .35, BL_TRUNK_H * .82 + .56), .62, 0, (1, 1, .7)),
    ((.1, -.95, BL_TRUNK_H * .82 + .46), .6, 0, (1, 1, .68)),
    ((-.2, .95, BL_TRUNK_H * .82 + .42), .52, 0, (1, 1, .66)),
], m_bl_canopy_b)

blA_h = BL_TRUNK_H + 1.05 + 1.05 * .82  # 主樹冠頂 z（近似：中心 z + 壓扁後半徑），only for NOTES 記錄。
blB_h = BL_TRUNK_H * .82 + .78 + 1.28 * .58
note(f'闊葉樹 A 概估整棵高≈{blA_h:.3f}、B≈{blB_h:.3f}（實際驗收用逐頂點世界座標量測，這裡只是建模時的粗估）。')

NAMES = ['betel-trunk', 'betel-crownshaft', 'betel-fronds', 'coco-trunk', 'coco-fronds', 'coco-fruit',
         'coco-curved-a-trunk', 'coco-curved-b-trunk',
         'broadleaf-a-trunk', 'broadleaf-a-canopy', 'broadleaf-b-trunk', 'broadleaf-b-canopy']

# ---- 既有 6 個零件：逐字複製 palms-20260928/build_palms.py 的建模參數，維持跟已驗證過的
# 直幹棕櫚完全相同的外觀（這支腳本整包覆寫 palms.json，不能讓既有 6 個零件跑掉）。----


def frond_blade(name, rings, material):
    verts, ring_idx = [], []
    for t, w, arch, fu, fd in rings:
        ring_idx.append(len(verts))
        verts.append((t, -w, arch))
        verts.append((t, 0, arch + fu))
        verts.append((t, w, arch))
        verts.append((t, 0, arch - fd))
    faces = [tuple(ring_idx[0] + k for k in range(4))]
    for i in range(len(rings) - 1):
        s0, s1 = ring_idx[i], ring_idx[i + 1]
        L0, T0, R0, B0 = s0, s0 + 1, s0 + 2, s0 + 3
        L1, T1, R1, B1 = s1, s1 + 1, s1 + 2, s1 + 3
        faces += [(L0, T0, T1, L1), (T0, R0, R1, T1), (R0, B0, B1, R1), (B0, L0, L1, B1)]
    last = ring_idx[-1]
    faces.append(tuple(last + k for k in range(4)))
    return p.mesh(name, verts, faces, material, 0, True)


parts['betel-trunk'] = tapered_cyl('palms_betel_trunk', 1.0, .72, m_trunk, n=8, height=1.0)
parts['betel-crownshaft'] = tapered_cyl('palms_betel_crownshaft', 1.0, .82, m_crown, n=8, height=1.0)
BETEL_FROND_RINGS = [
    (0.0, .15, 0.0, .050, .026),
    (0.55, .10, .06, .033, .017),
    (1.0, .01, .03, .004, .002),
]
parts['betel-fronds'] = frond_blade('palms_betel_frond', BETEL_FROND_RINGS, m_frond_betel)
parts['coco-trunk'] = tapered_cyl('palms_coco_trunk', 1.0, .62, m_trunk, n=8, height=1.0)
COCO_FROND_RINGS = [
    (0.0, .13, 0.0, .045, .022),
    (0.5, .095, -.02, .030, .015),
    (1.0, .01, -.22, .004, .0015),
]
parts['coco-fronds'] = frond_blade('palms_coco_frond', COCO_FROND_RINGS, m_frond_coco)
parts['coco-fruit'] = icosphere('palms_coco_fruit', (0, 0, 0), 1.0, m_fruit, subdivisions=0)

for n in NAMES:
    if n not in parts:
        sys.exit(f'缺零件 {n}')
note('12 個零件建模完成（既有 6 個逐字複製＋新 6 個：2 彎幹椰子幹＋2 闊葉樹×trunk/canopy）。')

# ============================================================
# 自製匯出（逐字沿用 build_palms.py 的做法：calc_loop_triangles + corner_normals）
# ============================================================
deps = bpy.context.evaluated_depsgraph_get()
raw = bytearray()
count = 0
part_ranges = {}
total_tris = 0

for name in NAMES:
    obj = parts[name]
    start_vertex = count
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

tri = lambda n: part_ranges[n]['count'] // 3
BETEL_FROND_COUNT, COCO_FROND_COUNT, COCO_FRUIT_COUNT = 9, 13, 8
betel_total = tri('betel-trunk') + tri('betel-crownshaft') + BETEL_FROND_COUNT * tri('betel-fronds')
coco_total = tri('coco-trunk') + COCO_FROND_COUNT * tri('coco-fronds') + COCO_FRUIT_COUNT * tri('coco-fruit')
coco_curved_total = tri('coco-curved-a-trunk') + COCO_FROND_COUNT * tri('coco-fronds')
broadleaf_a_total = tri('broadleaf-a-trunk') + tri('broadleaf-a-canopy')
broadleaf_b_total = tri('broadleaf-b-trunk') + tri('broadleaf-b-canopy')
note(f'三角形預算自檢：檳榔整棵={betel_total}（上限 350）、椰子整棵={coco_total}（上限 600）、'
     f'彎幹椰子整棵={coco_curved_total}（上限 700，彎幹環數比直幹多）、'
     f'闊葉樹 A={broadleaf_a_total}、B={broadleaf_b_total}（上限各 500）')
if betel_total > 350:
    sys.exit(f'檳榔整棵三角形數 {betel_total} 超過 350')
if coco_total > 600:
    sys.exit(f'椰子整棵三角形數 {coco_total} 超過 600')
if coco_curved_total > 700:
    sys.exit(f'彎幹椰子整棵三角形數 {coco_curved_total} 超過 700')
if broadleaf_a_total > 500 or broadleaf_b_total > 500:
    sys.exit(f'闊葉樹三角形數超過 500：A={broadleaf_a_total} B={broadleaf_b_total}')

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


degen = 0
first_bad = []
for v in range(0, vertex_count, 3):
    A, B, C = pos_of(v), pos_of(v+1), pos_of(v+2)
    area = math.hypot(*cross3(sub3(B, A), sub3(C, A))) / 2
    if not (area > 1e-10):
        degen += 1
        if len(first_bad) < 5:
            first_bad.append(v)
note(f'退化三角形自檢：{degen}（應為 0）')
if degen:
    sys.exit(f'{degen} 個退化三角形：{first_bad}')

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
note('朝外自檢：' + (json.dumps(bad_parts, ensure_ascii=False) if bad_parts else '全部通過'))
if bad_parts:
    sys.exit(f'朝外自檢失敗：{bad_parts}')

part_list = [{'name': n, 'start': part_ranges[n]['start'], 'count': part_ranges[n]['count'], 'pivot': [0, 0, 0]} for n in NAMES]

meta = {
    'schema': 'garage-parts-v1', 'id': 'palms', 'kind': 'palms', 'units': 'model',
    'vertexCount': vertex_count, 'triangleCount': total_tris, 'sha256': sha256,
    'parts': part_list,
}
(BUILD_DIR / 'coast_flora.raw.bin').write_bytes(raw_bytes)
(BUILD_DIR / 'coast_flora.meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(BUILD_DIR / 'coast_flora.blend'))

ASSET_DIR.mkdir(parents=True, exist_ok=True)
asset = {
    'schema': 'garage-parts-v1', 'id': 'palms', 'kind': 'palms', 'units': 'model',
    'mesh': {'file': 'palms.bin.gz', 'sha256': sha256, 'encoding': 'float32-le', 'strideBytes': 24,
             'vertexCount': vertex_count, 'triangleCount': total_tris, 'compression': 'gzip'},
    'parts': part_list,
}
(ASSET_DIR / 'palms.bin.gz').write_bytes(gzip.compress(raw_bytes, compresslevel=9, mtime=0))
(ASSET_DIR / 'palms.json').write_text(json.dumps(asset, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

print('GD_COAST_FLORA_BUILD_OK', json.dumps({
    'vertexCount': vertex_count, 'triangleCount': total_tris, 'sha256': sha256,
    'betelTotalTris': betel_total, 'cocoTotalTris': coco_total, 'cocoCurvedTotalTris': coco_curved_total,
    'broadleafATris': broadleaf_a_total, 'broadleafBTris': broadleaf_b_total,
    'topA': list(top_a), 'topB': list(top_b),
    'parts': {n: part_ranges[n]['count'] // 3 for n in NAMES},
}, ensure_ascii=False))
