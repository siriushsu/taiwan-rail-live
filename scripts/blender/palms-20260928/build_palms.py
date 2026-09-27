#!/usr/bin/env python3
"""建 palms：南迴海岸景（車庫）用的檳榔／椰子零件庫（garage-parts-v1）。6 個零件：
betel-trunk／betel-crownshaft／betel-fronds（檳榔）、coco-trunk／coco-fronds／coco-fruit（椰子）。
取代 rail-3d/garage-scenes/south-coast.js 原本用程式拼出的「細方柱＋薄葉」棕櫚（使用者：「那個樹看起來
像是個笑話」）——細長方柱葉片從側面看只剩一條線、樹幹比山還高。這次改用 Blender 建模、有真實體積。

沿用 scripts/blender/people-20260924/build_people.py 的自製匯出模式（calc_loop_triangles +
corner_normals，非索引匯出、24 bytes/vertex＝pos.xyz+normal.xyz），以及 blender_parts.py 的
mesh() 原語（bevel=0、smooth=True 讓法向量平滑不必靠幾何細分）。

執行期慣例（供 rail-3d/garage-scenes/south-coast.js 的 InstancedMesh 使用，比照舊 trunkGeo/frondGeo）：
- trunk／crownshaft：unit 高度 z:0→1（底 z=0、頂 z=1），instance scale=[半徑,半徑,高度]。
- fronds：unit 長度 x:0→1（hub 在 x=0、葉尖在 x=1），instance scale 三軸相同＝len（均勻縮放，
  讓摺痕厚度隨葉長等比例縮放，不像舊 frondGeo 用 [len,len,1] 導致厚度不隨長度變化）。
  剖面是「風箏」四點（左尖 L、上摺痕 Top、右尖 R、下摺痕 Bot）——從任何角度看都有厚度，
  修正舊版「側面看葉子只剩一條線」的缺陷；3 環（base/mid/tip）內建一點弧度（先拱起、葉尖再垂/降），
  不需要外部再疊加彎曲。
- fruit：icosphere（subdivisions=0，20 面），跟乘客零件庫的丸子頭同一顆做法。

沒有頂點色／材質貼圖，顏色由 south-coast.js 的 InstancedMesh 材質決定（同一零件庫、不同 InstancedMesh
各自上色）。

用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/palms-20260928/build_palms.py
輸出：
  output/palms/build/palms.raw.bin + .meta.json + .blend（中繼，不進 repo）
  rail-3d/assets/garage-palms-v1/palms.json + palms.bin.gz（正式資產，直接一次寫出）
"""
import bpy, bmesh, sys, math, struct, json, hashlib, gzip
from pathlib import Path

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]  # repo 根目錄（scripts/blender/<本目錄>/<本檔>）
sys.path.insert(0, str(W / 'scripts/blender/emu3000-20260912'))
import blender_parts as p  # noqa: E402

BUILD_DIR = W / 'output/palms/build'
BUILD_DIR.mkdir(parents=True, exist_ok=True)
ASSET_DIR = W / 'rail-3d/assets/garage-palms-v1'
NOTES_PATH = W / 'output/palms/NOTES.md'
NOTES_PATH.parent.mkdir(parents=True, exist_ok=True)


def note(msg):
    line = f'- [build_palms] {msg}\n'
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


def icosphere(name, loc, radius, material, subdivisions=0):
    """低面數球體（椰子果用）。沿用 build_people.py 的做法：用物件本身身分當索引鍵，不依賴
    BMVert.index（create_icosphere 剛建立的頂點在 ensure_lookup_table 之後 .index 不保證已回填）。"""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius)
    bm.verts.ensure_lookup_table()
    index_of = {v: i for i, v in enumerate(bm.verts)}
    verts = [(loc[0] + v.co.x, loc[1] + v.co.y, loc[2] + v.co.z) for v in bm.verts]
    faces = [tuple(index_of[v] for v in f.verts) for f in bm.faces]
    bm.free()
    return p.mesh(name, verts, faces, material, 0, True)


def tapered_cyl(name, r0, r1, material, n=8):
    """幹／葉鞘共用：unit 高度 z:0→1（底 z=0 半徑 r0、頂 z=1 半徑 r1），兩端封蓋、n 邊側面，
    比照 blender_parts.py 的 cyl() 做法只是兩端半徑不同（做出漸縮的樹幹輪廓）。"""
    verts = []
    for z, r in [(0, r0), (1, r1)]:
        for i in range(n):
            a = 2 * math.pi * i / n
            verts.append((r * math.cos(a), r * math.sin(a), z))
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    return p.mesh(name, verts, faces, material, 0, True)


def frond_blade(name, rings, material):
    """棕櫚葉：unit 長度沿 +X（hub x=0 到葉尖 x=1），每環 4 點做「風箏」剖面（L 左尖／Top 上摺痕／
    R 右尖／Bot 下摺痕），从任何角度看都有厚度（不會像舊版扁平葉片側看變成一條線）。
    rings：[(t,halfWidth,arch,foldUp,foldDown), ...]，t 是沿長度的位置（0=hub，1=tip），
    arch 是該環在局部 z 的偏移（用來內建「先拱起、葉尖再垂」的弧度，不需要外部再疊加彎曲）。"""
    verts, ring_idx = [], []
    for t, w, arch, fu, fd in rings:
        ring_idx.append(len(verts))
        verts.append((t, -w, arch))       # L
        verts.append((t, 0, arch + fu))   # Top（摺痕，比左右尖高）
        verts.append((t, w, arch))        # R
        verts.append((t, 0, arch - fd))   # Bot（摺痕下緣，比左右尖低一點點＝有厚度）
    faces = [tuple(ring_idx[0] + k for k in range(4))]  # 基部封蓋（hub 端，多半被葉鞘/樹幹遮住）
    for i in range(len(rings) - 1):
        s0, s1 = ring_idx[i], ring_idx[i + 1]
        L0, T0, R0, B0 = s0, s0 + 1, s0 + 2, s0 + 3
        L1, T1, R1, B1 = s1, s1 + 1, s1 + 2, s1 + 3
        faces += [(L0, T0, T1, L1), (T0, R0, R1, T1), (R0, B0, B1, R1), (B0, L0, L1, B1)]
    last = ring_idx[-1]
    faces.append(tuple(last + k for k in range(4)))  # 葉尖封蓋
    return p.mesh(name, verts, faces, material, 0, True)


parts = {}

# ---- 檳榔（betel）----
# 幹：細直、頂端略收尖（r1/r0=.72），比椰子細很多；n=8 保持圓潤但便宜。
parts['betel-trunk'] = tapered_cyl('palms_betel_trunk', 1.0, .72, m_trunk, n=8)
# 葉鞘（crownshaft）：檳榔最好認的特徵——樹幹頂端一段光滑的綠色鞘，半徑略比幹頂粗、往上收一點。
parts['betel-crownshaft'] = tapered_cyl('palms_betel_crownshaft', 1.0, .82, m_crown, n=8)
# 葉：3 環（base/mid/tip），先拱起（mid 的 arch 為正）、葉尖再垂（tip 的 arch 略降）；
# 寬度從 .15 收到 .01 接近一個點，摺痕高度隨寬度等比例（約 .33× 寬度）。
BETEL_FROND_RINGS = [
    (0.0, .15, 0.0, .050, .026),
    (0.55, .10, .06, .033, .017),
    (1.0, .01, .03, .004, .002),
]
parts['betel-fronds'] = frond_blade('palms_betel_frond', BETEL_FROND_RINGS, m_frond_betel)

# ---- 椰子（coco）----
# 幹：底部較粗（r0=1.0）往上收尖（r1=.62）比檳榔更明顯，代表「略彎、根部較粗」的視覺量感
# （實際彎曲改在 south-coast.js 用既有的 per-instance lean 旋轉整棵樹，見 README「設計取捨」）。
parts['coco-trunk'] = tapered_cyl('palms_coco_trunk', 1.0, .62, m_trunk, n=8)
# 葉：更長更下垂——tip 的 arch 明顯往下（-.22），呈拱形下垂、葉尖低於樹冠底部（hub 在 arch=0）。
COCO_FROND_RINGS = [
    (0.0, .13, 0.0, .045, .022),
    (0.5, .095, -.02, .030, .015),
    (1.0, .01, -.22, .004, .0015),
]
parts['coco-fronds'] = frond_blade('palms_coco_frond', COCO_FROND_RINGS, m_frond_coco)
# 果：單位球（半徑 1，執行期用 instance scale 縮到實際大小），跟乘客零件庫的丸子頭同一顆做法。
parts['coco-fruit'] = icosphere('palms_coco_fruit', (0, 0, 0), 1.0, m_fruit, subdivisions=0)

NAMES = ['betel-trunk', 'betel-crownshaft', 'betel-fronds', 'coco-trunk', 'coco-fronds', 'coco-fruit']
for n in NAMES:
    if n not in parts:
        sys.exit(f'缺零件 {n}')
note('6 個零件建模完成。')

# ============================================================
# 自製匯出（沿用 build_people.py 的模式：calc_loop_triangles + corner_normals，world space；
# 這裡每個零件只有一個物件，物件沒有額外的 object-level 平移/旋轉，verts 直接寫在局部座標，
# world matrix＝identity，匯出值＝局部值）
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

# 三角形預算自檢：檳榔整棵（trunk+crownshaft+9 片葉）≤350、椰子整棵（trunk+13 片葉+8 顆果）≤600。
tri = lambda n: part_ranges[n]['count'] // 3
BETEL_FROND_COUNT, COCO_FROND_COUNT, COCO_FRUIT_COUNT = 9, 13, 8
betel_total = tri('betel-trunk') + tri('betel-crownshaft') + BETEL_FROND_COUNT * tri('betel-fronds')
coco_total = tri('coco-trunk') + COCO_FROND_COUNT * tri('coco-fronds') + COCO_FRUIT_COUNT * tri('coco-fruit')
note(f'三角形預算自檢：檳榔整棵={betel_total}（上限 350）、椰子整棵={coco_total}（上限 600）')
if betel_total > 350:
    sys.exit(f'檳榔整棵三角形數 {betel_total} 超過 350')
if coco_total > 600:
    sys.exit(f'椰子整棵三角形數 {coco_total} 超過 600')

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


# 全域無退化三角形自檢（面積 >1e-10），沿用 build_people.py 的 P5。
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

# 逐零件三角形朝外自檢（沿用 build_people.py 的 P6）：(a) 面法向量與三頂點法向量和同向；
# (b) 以零件重心算的有號體積 >0（確認每個零件都是封閉、朝外的實體外殼）。
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
(BUILD_DIR / 'palms.raw.bin').write_bytes(raw_bytes)
(BUILD_DIR / 'palms.meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(BUILD_DIR / 'palms.blend'))

# ---- 直接安裝為正式資產：沒有既有 palms.json 要合併，一次寫出 ----
ASSET_DIR.mkdir(parents=True, exist_ok=True)
asset = {
    'schema': 'garage-parts-v1', 'id': 'palms', 'kind': 'palms', 'units': 'model',
    'mesh': {'file': 'palms.bin.gz', 'sha256': sha256, 'encoding': 'float32-le', 'strideBytes': 24,
             'vertexCount': vertex_count, 'triangleCount': total_tris, 'compression': 'gzip'},
    'parts': part_list,
}
(ASSET_DIR / 'palms.bin.gz').write_bytes(gzip.compress(raw_bytes, compresslevel=9, mtime=0))
(ASSET_DIR / 'palms.json').write_text(json.dumps(asset, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

print('GD_PALMS_BUILD_OK', json.dumps({
    'vertexCount': vertex_count, 'triangleCount': total_tris, 'sha256': sha256,
    'betelTotalTris': betel_total, 'cocoTotalTris': coco_total,
    'parts': {n: part_ranges[n]['count'] // 3 for n in NAMES},
}, ensure_ascii=False))
