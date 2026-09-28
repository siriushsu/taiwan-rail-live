#!/usr/bin/env python3
"""建十分老街景（車庫）用的植栽零件庫（garage-shifen-v1）：闊葉樹（2 款：round 圓冠像榕樹／樟樹，
layered 層疊冠像樟樹分層樹型）＋ 竹叢（1 款culm+1款葉，可疊出任意密度的竹叢）。取代
rail-3d/garage-scenes/shifen.js 原本借用 props.js 的程式二十面體闊葉樹（IcosahedronGeometry(1,0)
直接當樹冠——評審：「樹和灌木是多面體『綠寶石』，一放大就很醒目」）。

沿用 scripts/blender/palms-20260928/build_palms.py 的自製匯出模式（calc_loop_triangles +
corner_normals，非索引匯出、24 bytes/vertex＝pos.xyz+normal.xyz）與 P5／P6 自檢（無退化三角形、
逐零件朝外且封閉），以及 blender_parts.py 的 mesh() 原語（bevel=0、smooth=True）。

4 個零件（不分樹種，樹種由執行期組裝參數決定——canopy-lobe 用不同的 instance 縮放比例
（round：xyz 接近等比；layered：z 縮得更扁、多層堆疊）就能從同一顆零件長出兩種樹型，
不必為每個樹種各刻一顆零件，維持 draw call 精簡）：
- tree-trunk：unit 高度 z:0→1（底 z=0 半徑 1、頂 z=1 半徑 .62 的漸縮圓柱），instance
  scale=[半徑,半徑,高度]，跟 palms 的 tapered_cyl 同一個執行期慣例。
- canopy-lobe：不規則樹冠塊——subdivisions=1 的 icosphere（半徑 1）逐頂點抖動 ±18% 半徑、
  整體壓扁 18%（z*=.82），破壞正球／正二十面體的規則輪廓；一棵樹用 4～5 顆疊起來，
  複合輪廓本身也比單顆更不規則。instance scale=[x半徑,y半徑,z半徑]（三軸各自控制，
  round 樹種三軸相近、layered 樹種 z 明顯壓扁）。
- bamboo-culm：unit 高度 z:0→1，六邊形斷面，沿高度方向有 3 個週期性的窄凸節（模擬竹節環），
  頂略收（r1/r0=.82）。instance scale=[半徑,半徑,高度]。
- bamboo-leaf：unit 長度 x:0→1（hub x=0、葉尖 x=1），跟 palms 的 frond_blade 同一個「風箏」
  剖面（左尖/上摺痕/右尖/下摺痕，有厚度），只是更細更長更垂（竹葉披針形、末端下垂明顯）。
  instance scale 三軸相同＝len。

沒有頂點色／材質貼圖，顏色由 rail-3d/garage-scenes/shifen.js 的 InstancedMesh 材質決定
（instanceColor 逐實例上色，樹冠三種綠、竹葉兩種綠，不必為顏色變化多開 draw call）。

用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/shifen-20260928/build_shifen_veg.py
輸出：
  output/shifen-veg/build/shifen-veg.raw.bin + .meta.json + .blend（中繼，不進 repo）
  rail-3d/assets/garage-shifen-v1/shifen-veg.json + shifen-veg.bin.gz（正式資產，直接一次寫出）
"""
import bpy, bmesh, sys, math, random, struct, json, hashlib, gzip
from pathlib import Path

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]  # repo 根目錄（scripts/blender/<本目錄>/<本檔>）
sys.path.insert(0, str(W / 'scripts/blender/emu3000-20260912'))
import blender_parts as p  # noqa: E402

BUILD_DIR = W / 'output/shifen-veg/build'
BUILD_DIR.mkdir(parents=True, exist_ok=True)
ASSET_DIR = W / 'rail-3d/assets/garage-shifen-v1'
NOTES_PATH = W / 'output/shifen-veg/NOTES.md'
NOTES_PATH.parent.mkdir(parents=True, exist_ok=True)


def note(msg):
    line = f'- [build_shifen_veg] {msg}\n'
    with open(NOTES_PATH, 'a', encoding='utf-8') as f:
        f.write(line)
    print(line, end='')


random.seed(20260928)

p.reset({'id': 'shifen-veg', 'body': 'FFFFFF', 'accent': '888888'})
p.use('01')
m_trunk = p.mat('shifen_trunk_preview', '6b5a3e', 0, .75)
m_canopy = p.mat('shifen_canopy_preview', '5a7a4a', 0, .6)
m_culm = p.mat('shifen_culm_preview', '8a9c4e', 0, .55)
m_leaf = p.mat('shifen_leaf_preview', '5f8a4a', 0, .6)


def tapered_cyl(name, r0, r1, material, n=7):
    """幹：unit 高度 z:0→1（底 z=0 半徑 r0、頂 z=1 半徑 r1），兩端封蓋，n 邊側面。
    跟 palms 的 tapered_cyl 同一個做法（n=7 取奇數，側面接縫不會左右完全對稱）。"""
    verts = []
    for z, r in [(0, r0), (1, r1)]:
        for i in range(n):
            a = 2 * math.pi * i / n
            verts.append((r * math.cos(a), r * math.sin(a), z))
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    return p.mesh(name, verts, faces, material, 0, True)


def canopy_lobe(name, material, jitter=.18, flatten=.82, subdivisions=2):
    """不規則樹冠塊：icosphere 逐頂點抖動半徑＋整體壓扁，破壞正多面體的規則輪廓
    （評審原話：程式舊版是「多面體『綠寶石』」——IcosahedronGeometry(1,0) 完全沒抖動、
    12 個頂點的稜角在近景清晰可見）。種子固定（模組層級 random.seed），形狀可重現。
    subdivisions 預設 2：實測 bmesh.ops.create_icosphere 的 subdivisions=0／1 都只給
    base 20 面／12 頂點（跟舊版同一種「正二十面體」精細度，稜角依舊明顯）,subdivisions=2
    才真的細分到 80 面／42 頂點——這是本零件比舊版更圓潤、不再是「綠寶石」的關鍵，
    不是只靠逐頂點抖動就夠。"""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=1.0)
    bm.verts.ensure_lookup_table()
    for v in bm.verts:
        j = 1.0 + (random.random() - .5) * 2 * jitter
        v.co = v.co * j
    for v in bm.verts:
        v.co.z *= flatten
    index_of = {v: i for i, v in enumerate(bm.verts)}
    verts = [(v.co.x, v.co.y, v.co.z) for v in bm.verts]
    faces = [tuple(index_of[v] for v in f.verts) for f in bm.faces]
    bm.free()
    return p.mesh(name, verts, faces, material, 0, True)


def bamboo_culm(name, material, n=6, rings=7, r0=1.0, r1=.82, node_amp=.14, node_freq=3):
    """竹稈：unit 高度 z:0→1，六邊形斷面，node_freq 個週期性窄凸節（cos 的 12 次方讓凸起窄而尖，
    不是整體都變粗），頂略收。跟 tapered_cyl 同一個側面/端蓋接法，只是半徑多疊一個節函數。"""
    verts = []
    for k in range(rings):
        t = k / (rings - 1)
        base_r = r0 + (r1 - r0) * t
        bump = max(0.0, math.cos(t * math.pi * 2 * node_freq)) ** 12
        rr = base_r * (1.0 + node_amp * bump)
        for i in range(n):
            a = 2 * math.pi * i / n
            verts.append((rr * math.cos(a), rr * math.sin(a), t))
    faces = [tuple(reversed(range(n)))]
    for k in range(rings - 1):
        s0, s1 = k * n, (k + 1) * n
        faces += [(s0 + i, s0 + (i + 1) % n, s1 + (i + 1) % n, s1 + i) for i in range(n)]
    faces.append(tuple((rings - 1) * n + i for i in range(n)))
    return p.mesh(name, verts, faces, material, 0, True)


def frond_blade(name, rings, material):
    """跟 palms 的 frond_blade 完全同一個「風箏」剖面做法（見該檔說明）：每環 4 點
    L(左尖)/Top(上摺痕)/R(右尖)/Bot(下摺痕)，任何角度看都有厚度。"""
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


parts = {}
parts['tree-trunk'] = tapered_cyl('shifen_tree_trunk', 1.0, .62, m_trunk, n=7)
parts['canopy-lobe'] = canopy_lobe('shifen_canopy_lobe', m_canopy)
parts['bamboo-culm'] = bamboo_culm('shifen_bamboo_culm', m_culm)
# 竹葉：披針形、末端明顯下垂（tip 的 arch 為負且幅度大於棕櫚葉），比棕櫚葉細很多（寬度數值更小）。
BAMBOO_LEAF_RINGS = [
    (0.0, .045, 0.0, .009, .007),
    (0.5, .026, .015, .0055, .004),
    (1.0, .002, -.075, .0012, .0009),
]
parts['bamboo-leaf'] = frond_blade('shifen_bamboo_leaf', BAMBOO_LEAF_RINGS, m_leaf)

NAMES = ['tree-trunk', 'canopy-lobe', 'bamboo-culm', 'bamboo-leaf']
for n in NAMES:
    if n not in parts:
        sys.exit(f'缺零件 {n}')
note('4 個零件建模完成。')

# ============================================================
# 自製匯出（沿用 build_palms.py 的模式：calc_loop_triangles + corner_normals，world space；
# 每個零件只有一個物件、沒有額外的 object-level 平移/旋轉，world matrix＝identity）
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

# 三角形預算自檢（數字對齊 rail-3d/garage-scenes/shifen.js 實際組裝參數，改動那邊的
# 密度常數要回頭核對這裡的上限，兩處對不上時以這裡為準重算）：
# 闊葉樹整棵＝trunk + 5 片 canopy-lobe（round 樹種取上限 5 片）≤ 500。
# 竹叢一叢＝12 根 culm ×（culm + 8 片葉，兩層各 4 片扇開）≤ 3200。
tri = lambda n: part_ranges[n]['count'] // 3
TREE_LOBES_MAX, BAMBOO_CULMS, BAMBOO_LEAVES_PER_CULM = 5, 12, 8
tree_total = tri('tree-trunk') + TREE_LOBES_MAX * tri('canopy-lobe')
bamboo_clump_total = BAMBOO_CULMS * (tri('bamboo-culm') + BAMBOO_LEAVES_PER_CULM * tri('bamboo-leaf'))
note(f'三角形預算自檢：闊葉樹整棵(5冠)={tree_total}（上限 500）、竹叢一叢(12稈)={bamboo_clump_total}（上限 3200）')
if tree_total > 500:
    sys.exit(f'闊葉樹整棵三角形數 {tree_total} 超過 500')
if bamboo_clump_total > 3200:
    sys.exit(f'竹叢一叢三角形數 {bamboo_clump_total} 超過 3200')

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


# 全域無退化三角形自檢（面積 >1e-10），沿用 build_people.py／build_palms.py 的 P5。
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

# 逐零件三角形朝外自檢（沿用 build_people.py／build_palms.py 的 P6）。
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
    'schema': 'garage-parts-v1', 'id': 'shifen-veg', 'kind': 'shifen-veg', 'units': 'model',
    'vertexCount': vertex_count, 'triangleCount': total_tris, 'sha256': sha256,
    'parts': part_list,
}
(BUILD_DIR / 'shifen-veg.raw.bin').write_bytes(raw_bytes)
(BUILD_DIR / 'shifen-veg.meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(BUILD_DIR / 'shifen-veg.blend'))

# ---- 直接安裝為正式資產：沒有既有 shifen-veg.json 要合併，一次寫出 ----
ASSET_DIR.mkdir(parents=True, exist_ok=True)
asset = {
    'schema': 'garage-parts-v1', 'id': 'shifen-veg', 'kind': 'shifen-veg', 'units': 'model',
    'mesh': {'file': 'shifen-veg.bin.gz', 'sha256': sha256, 'encoding': 'float32-le', 'strideBytes': 24,
             'vertexCount': vertex_count, 'triangleCount': total_tris, 'compression': 'gzip'},
    'parts': part_list,
}
(ASSET_DIR / 'shifen-veg.bin.gz').write_bytes(gzip.compress(raw_bytes, compresslevel=9, mtime=0))
(ASSET_DIR / 'shifen-veg.json').write_text(json.dumps(asset, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

print('GD_SHIFEN_VEG_BUILD_OK', json.dumps({
    'vertexCount': vertex_count, 'triangleCount': total_tris, 'sha256': sha256,
    'treeTotalTris5Lobes': tree_total, 'bambooClumpTotal14': bamboo_clump_total,
    'parts': {n: part_ranges[n]['count'] // 3 for n in NAMES},
}, ensure_ascii=False))
