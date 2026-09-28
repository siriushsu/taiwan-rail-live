#!/usr/bin/env python3
"""建 alishan-trees：阿里山景（車庫）用的柳杉／紅檜／神木零件庫（garage-parts-v1）。取代
rail-3d/garage-scenes/alishan.js 原本用 ConeGeometry(1,1,7) 疊 CylinderGeometry 拼出的「聖誕樹」
森林（使用者已裁示「細節還是都需要用 blender 製作」；南迴棕櫚被退件「像笑話」的前車之鑑一樣適用
於這片森林——阿里山這一景的主角就是森林，比棕櫚更不能將就）。

7 個零件：
- sugi-trunk：柳杉樹幹，unit 高度 z:0→1（底 z=0 半徑 1、頂 z=1 半徑 .58），直挺不帶板根，
  只疊一層細緻的縱向樹皮溝紋（振幅遠小於紅檜，符合柳杉「樹皮縱向淺紋」而非「板根粗幹」的特徵）。
- sugi-crown-a／sugi-crown-b：柳杉樹冠——5（a）／4（b）層「倒傘」疊環（tapered_cyl 反過來：
  寬底窄頂），層與層之間刻意留出可見的段落（每層底比上一層頂寬一截），畫出「枝層下垂、一節一節」
  的剪影，不是單一平滑圓錐。頂端收一個小尖錐。
- hinoki-trunk：紅檜樹幹，unit 高度 z:0→1，底部（0～.22）疊 6 瓣板根凸稜（角度方向的餘弦浮凸，
  隨高度衰減到 0），全高再疊一層較粗的縱向溝紋（樹皮溝紋，振幅比柳杉大）。
- hinoki-crown-a／hinoki-crown-b：紅檜樹冠——各由多顆偏心橢球疊成一叢渾圓不規則團塊（做法沿用
  alishan-fx-20260928/build_alishan_fx.py 的 make_cloud() 技法：不壓扁、隨機偏移＋輕微 z 抖動），
  不是規則圓錐。
- giant-crown：神木專用的稀疏殘缺樹冠——用同一顆 make_lumpy() 技法但顆數更少、間距更大、偏向
  一側（暗示風災/雷擊斷梢），神木樹幹直接沿用 hinoki-trunk（同一個「板根＋溝紋」profile 放大＋
  加重板根參數，在場景端用更大的 instance scale／更強的 flare 常數建出來——但因為 flare 是烘進
  幾何的，這裡另外用更誇張的參數重建一份專屬神木的樹幹，見下方 GIANT_TRUNK。

依照 people-20260924/build_people.py、palms-20260928/build_palms.py 的匯出慣例：
calc_loop_triangles + corner_normals，non-indexed，24 bytes/vertex（pos.xyz+normal.xyz），
P5（無退化三角形）／P6（逐零件朝外且封閉，含正有號體積）自檢，沒有頂點色／材質貼圖。

樹形依據（各查證一個來源，見 output/alishan-trees/NOTES.md 的引用小節）：
- 柳杉（Cryptomeria japonica）：樹冠圓錐、樹形高聳優雅，樹幹通直，小枝常細長下垂，樹皮紅棕色
  帶縱向裂紋。來源：zh.wikipedia.org「日本柳杉」、taitung.forest.gov.tw 造林樹種介紹。
- 紅檜（Chamaecyparis formosensis）：常綠大喬木，樹皮灰紅至紅褐色、縱向淺溝裂、長片狀剝落；
  板根巨大；大枝近平展、樹冠圓錐形但因合併木現象常見不規則叢生外觀。來源：zh.wikipedia.org
  「紅檜」形態段、台灣景觀植物介紹（tlpg.hsiliu.org.tw）、農傳媒「阿里山神木變年輕」（44 株
  阿里山巨木皆為紅檜、樹皮暗灰色鱗狀開裂、大枝近平展或微向上展）。
- 阿里山神木／老紅檜：巨木常因抹香腐菌侵蝕形成中空、樹幹粗大，是本場景「全場最粗樹幹」與
  「樹冠殘缺」設計的依據。來源同上「阿里山神木變年輕」（農傳媒）。

用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/alishan-trees-20260928/build_alishan_trees.py
輸出：
  output/alishan-trees/build/alishan-trees.raw.bin + .meta.json + .blend（中繼，不進 repo）
  rail-3d/assets/garage-alishan-trees-v1/alishan-trees.json + .bin.gz（正式資產，一次寫出）
"""
import bpy, bmesh, sys, math, struct, json, hashlib, gzip, random
from pathlib import Path

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]  # repo 根目錄（scripts/blender/<本目錄>/<本檔>）
sys.path.insert(0, str(W / 'scripts/blender/emu3000-20260912'))
import blender_parts as p  # noqa: E402

BUILD_DIR = W / 'output/alishan-trees/build'
BUILD_DIR.mkdir(parents=True, exist_ok=True)
ASSET_DIR = W / 'rail-3d/assets/garage-alishan-trees-v1'
NOTES_PATH = W / 'output/alishan-trees/NOTES.md'
NOTES_PATH.parent.mkdir(parents=True, exist_ok=True)


def note(msg):
    line = f'- [build_alishan_trees] {msg}\n'
    with open(NOTES_PATH, 'a', encoding='utf-8') as f:
        f.write(line)
    print(line, end='')


p.reset({'id': 'alishan-trees', 'body': 'FFFFFF', 'accent': '888888'})
p.use('01')

m_sugi_trunk = p.mat('trees_sugi_trunk_preview', '6b5334', 0, .8)
m_hinoki_trunk = p.mat('trees_hinoki_trunk_preview', '7a5a3c', 0, .8)
m_sugi_a = p.mat('trees_sugi_crown_a_preview', '3f6b3a', 0, .7)
m_sugi_b = p.mat('trees_sugi_crown_b_preview', '4d7a42', 0, .7)
m_hinoki_a = p.mat('trees_hinoki_crown_a_preview', '355c42', 0, .7)
m_hinoki_b = p.mat('trees_hinoki_crown_b_preview', '2f5240', 0, .7)
m_giant = p.mat('trees_giant_crown_preview', '5c6b45', 0, .75)


# ============================================================
# 樹幹：帶角度浮凸（板根）＋細縱紋（樹皮溝紋）的分環擠出柱體。
# ============================================================
def lobed_trunk(name, rings, n, material):
    """rings: [(z, r, flareAmp, flareLobes, ridgeAmp, ridgeCount), ...]（底到頂）。
    半徑(角度,環) = r*(1+flareAmp*cos(flareLobes*角度)) + ridgeAmp*cos(ridgeCount*角度)。
    flareAmp 通常只在最底幾環非 0（板根，隨高度衰減到 0）；ridgeAmp 全高皆有、振幅小很多
    （樹皮縱向溝紋，柳杉振幅遠小於紅檜／神木）。頂底各封一個 n 邊形蓋（保持封閉流形）。"""
    verts = []
    ring_start = []
    for (z, r, flare_amp, flare_lobes, ridge_amp, ridge_count) in rings:
        ring_start.append(len(verts))
        for i in range(n):
            a = 2 * math.pi * i / n
            rr = r * (1 + flare_amp * math.cos(flare_lobes * a)) + ridge_amp * math.cos(ridge_count * a)
            verts.append((rr * math.cos(a), rr * math.sin(a), z))
    faces = [tuple(reversed(range(n)))]  # 底蓋
    for k in range(len(rings) - 1):
        s0, s1 = ring_start[k], ring_start[k + 1]
        for i in range(n):
            j = (i + 1) % n
            faces.append((s0 + i, s0 + j, s1 + j, s1 + i))
    top = ring_start[-1]
    faces.append(tuple(top + i for i in range(n)))  # 頂蓋
    return p.mesh(name, verts, faces, material, 0, True)


# ============================================================
# 柳杉樹冠：疊環「倒傘」——每層寬底窄頂（tapered_cyl 的做法），層與層之間留出可見段落，
# 讀成「一節一節下垂枝層」而非單一平滑圓錐。頂端收一個小尖錐。
# ============================================================
def tapered_ring(name, z0, z1, r_bottom, r_top, material, n=8):
    verts = []
    for z, r in [(z0, r_bottom), (z1, r_top)]:
        for i in range(n):
            a = 2 * math.pi * i / n
            verts.append((r * math.cos(a), r * math.sin(a), z))
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    return p.mesh(name, verts, faces, material, 0, True)


def sugi_crown(tag, tiers, material):
    """tiers: [(z0,z1,rBottom,rTop), ...]（底到頂，每個 tuple 一層倒傘）；最後再疊一根小尖錐。"""
    objs = []
    for i, (z0, z1, rb, rt) in enumerate(tiers):
        objs.append(tapered_ring(f'{tag}_tier{i}', z0, z1, rb, rt, material, n=8))
    zt = tiers[-1][1]
    rt = tiers[-1][3]
    objs.append(tapered_ring(f'{tag}_tip', zt, zt + rt * 1.6, rt, .015, material, n=8))
    return objs


# 5 層（品種 a，較高聳、層數多）：每層底部比上一層頂部寬，做出「段落感」。
SUGI_A_TIERS = [
    (0.00, 0.34, .40, .17),
    (0.28, 0.58, .33, .14),
    (0.52, 0.80, .27, .11),
    (0.74, 1.00, .21, .085),
    (0.94, 1.16, .15, .05),
]
# 4 層（品種 b，較矮胖、層數少一點，droop 幅度較大＝底比 a 更寬）。
SUGI_B_TIERS = [
    (0.00, 0.30, .46, .19),
    (0.24, 0.54, .37, .15),
    (0.48, 0.82, .29, .11),
    (0.74, 1.08, .19, .06),
]

parts = {}
parts['sugi-trunk'] = [lobed_trunk('sugi_trunk', [
    (0.00, 1.00, 0, 0, .012, 14),
    (0.30, 0.86, 0, 0, .011, 14),
    (0.65, 0.70, 0, 0, .009, 14),
    (1.00, 0.58, 0, 0, .007, 14),
], n=10, material=m_sugi_trunk)]
parts['sugi-crown-a'] = sugi_crown('sugi_crown_a', SUGI_A_TIERS, m_sugi_a)
parts['sugi-crown-b'] = sugi_crown('sugi_crown_b', SUGI_B_TIERS, m_sugi_b)


# ============================================================
# 紅檜樹幹：底部板根（角度浮凸，隨高度衰減）＋全高縱向溝紋（振幅比柳杉大）。
# ============================================================
def hinoki_trunk_rings(flare_peak, ridge_peak, lobes=6, ridge_count=18):
    return [
        (0.00, 1.00, flare_peak, lobes, ridge_peak, ridge_count),
        (0.08, 0.97, flare_peak * .85, lobes, ridge_peak, ridge_count),
        (0.16, 0.90, flare_peak * .55, lobes, ridge_peak * .9, ridge_count),
        (0.24, 0.84, flare_peak * .2, lobes, ridge_peak * .85, ridge_count),
        (0.34, 0.80, 0, lobes, ridge_peak * .8, ridge_count),
        (0.62, 0.66, 0, lobes, ridge_peak * .7, ridge_count),
        (1.00, 0.50, 0, lobes, ridge_peak * .6, ridge_count),
    ]


parts['hinoki-trunk'] = [lobed_trunk('hinoki_trunk', hinoki_trunk_rings(.34, .028), n=12, material=m_hinoki_trunk)]


# ============================================================
# 紅檜樹冠：不規則團塊——沿用 alishan-fx build_alishan_fx.py 的 make_cloud() 技法（多顆偏心橢球
# 疊成一叢），但不壓扁（rz/rx 接近 1，樹冠是渾圓不是扁雲），材質換成綠色。
# ============================================================
def icosphere(name, loc, radius, material, subdivisions=1, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius)
    bm.verts.ensure_lookup_table()
    index_of = {v: i for i, v in enumerate(bm.verts)}
    verts = [(loc[0] + v.co.x * scale[0], loc[1] + v.co.y * scale[1], loc[2] + v.co.z * scale[2]) for v in bm.verts]
    faces = [tuple(index_of[v] for v in f.verts) for f in bm.faces]
    bm.free()
    return p.mesh(name, verts, faces, material, 0, True)


def make_lumpy(tag, seed, n, material, spread=.62, base_r=.62, sparse=False, subdiv=2):
    """多顆偏心橢球疊成一叢渾圓不規則團塊，中心點在叢底（z=0，供樹幹頂端對接），叢頂延伸到
    正 z。sparse=True 時顆與顆間距拉大、只放一半左右數量，做出「殘缺不密實」的樹冠（神木用）。"""
    rng = random.Random(seed)
    objs = []
    ang0 = rng.uniform(0, math.tau)
    lean_x, lean_y = rng.uniform(-.18, .18), rng.uniform(-.18, .18)
    for i in range(n):
        if i == 0:
            lx, ly, lz = lean_x * .3, lean_y * .3, base_r * .55
        else:
            ang = ang0 + i / n * math.tau + rng.uniform(-.4, .4)
            dist = spread * rng.uniform(.45, 1.0 if not sparse else 1.3)
            lx = math.cos(ang) * dist + lean_x
            ly = math.sin(ang) * dist * rng.uniform(.7, 1.0) + lean_y
            lz = base_r * .55 + rng.uniform(-.12, .32) * base_r
        rx = base_r * rng.uniform(.62, .95)
        ry = rx * rng.uniform(.85, 1.05)
        rz = rx * rng.uniform(.78, 1.0)
        objs.append(icosphere(f'{tag}_l{i}', (lx, ly, lz), 1.0, material, subdivisions=subdiv, scale=(rx, ry, rz)))
    return objs


parts['hinoki-crown-a'] = make_lumpy('hinoki_crown_a', 20260928, 7, m_hinoki_a, spread=.58, base_r=.66)
parts['hinoki-crown-b'] = make_lumpy('hinoki_crown_b', 20260929, 6, m_hinoki_b, spread=.7, base_r=.6)
# 神木：稀疏、間距拉大、偏一側——暗示風災/雷擊斷梢的殘缺樹冠，顆數比一般紅檜少一半以上。
parts['giant-crown'] = make_lumpy('giant_crown', 20260930, 4, m_giant, spread=.9, base_r=.58, sparse=True, subdiv=2)

NAMES = ['sugi-trunk', 'sugi-crown-a', 'sugi-crown-b', 'hinoki-trunk', 'hinoki-crown-a', 'hinoki-crown-b', 'giant-crown']
for n in NAMES:
    if n not in parts:
        sys.exit(f'缺零件 {n}')
note('7 個零件物件建模完成：' + json.dumps({k: len(v) for k, v in parts.items()}, ensure_ascii=False))

# ============================================================
# 自製匯出（沿用 build_alishan_fx.py／build_people.py 的模式：calc_loop_triangles + corner_normals，
# world space；每個「零件」可能由多個 Blender 物件組成，匯出時依序串接進同一段 start/count 範圍）
# ============================================================
deps = bpy.context.evaluated_depsgraph_get()
raw = bytearray()
count = 0
part_ranges = {}
total_tris = 0

BUDGET = {
    'sugi-trunk': 260, 'sugi-crown-a': 620, 'sugi-crown-b': 520,
    'hinoki-trunk': 320, 'hinoki-crown-a': 1300, 'hinoki-crown-b': 1150, 'giant-crown': 900,
}

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
    tris = (count - start_vertex) // 3
    note(f'部件 {name!r}：start={start_vertex} count={count - start_vertex}（{tris} 個三角形，預算 {BUDGET[name]}）')
    if tris > BUDGET[name]:
        sys.exit(f'{name} 三角形數 {tris} 超過預算 {BUDGET[name]}')

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


# P5：全域無退化三角形（面積 >1e-10）。
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

# P6：逐零件三角形朝外自檢（面法向量與三頂點法向量和同向）＋以零件重心算有號體積 >0（封閉朝外）。
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
    'schema': 'garage-parts-v1', 'id': 'alishan-trees', 'kind': 'alishan-trees', 'units': 'model',
    'vertexCount': vertex_count, 'triangleCount': total_tris, 'sha256': sha256,
    'parts': part_list,
}
(BUILD_DIR / 'alishan-trees.raw.bin').write_bytes(raw_bytes)
(BUILD_DIR / 'alishan-trees.meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(BUILD_DIR / 'alishan-trees.blend'))

ASSET_DIR.mkdir(parents=True, exist_ok=True)
asset = {
    'schema': 'garage-parts-v1', 'id': 'alishan-trees', 'kind': 'alishan-trees', 'units': 'model',
    'mesh': {'file': 'alishan-trees.bin.gz', 'sha256': sha256, 'encoding': 'float32-le', 'strideBytes': 24,
             'vertexCount': vertex_count, 'triangleCount': total_tris, 'compression': 'gzip'},
    'parts': part_list,
}
(ASSET_DIR / 'alishan-trees.bin.gz').write_bytes(gzip.compress(raw_bytes, compresslevel=9, mtime=0))
(ASSET_DIR / 'alishan-trees.json').write_text(json.dumps(asset, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

print('GD_ALISHAN_TREES_BUILD_OK', json.dumps({
    'vertexCount': vertex_count, 'triangleCount': total_tris, 'sha256': sha256,
    'parts': {n: part_ranges[n]['count'] // 3 for n in NAMES},
}, ensure_ascii=False))
