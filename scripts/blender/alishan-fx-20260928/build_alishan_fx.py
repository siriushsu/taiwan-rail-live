#!/usr/bin/env python3
"""建 alishan-fx：阿里山景的雲海與螢火蟲零件庫（garage-parts-v1）。5 個零件——4 種雲團
（cloud-a/b/c/d，各自數顆低面數橢球疊成、底部扁平頂部圓潤）、1 種螢火蟲光點（firefly，極小圓球）
——供 rail-3d/garage-scenes/alishan.js 的 InstancedMesh 在山谷擺出雲海、林間擺出螢火蟲。

延續 people-20260924/build_people.py 的自製匯出模式（calc_loop_triangles + corner_normals，
non-indexed、24 bytes/vertex）與其本地 icosphere() 橢球輔助（沿用 bmesh.ops.create_icosphere，
scale 做非等比縮放）。雲團零件不做關節、不需要 pivot／rig——場景端直接把整個零件當一顆雲或
一顆螢火蟲用 Object3D 擺位置/縮放，不做姿勢合成，比 people/pantograph 簡單很多。

用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/alishan-fx-20260928/build_alishan_fx.py
輸出：
  output/alishan-fx/build/alishan-fx.raw.bin + .meta.json + .blend（中繼，不進 repo）
  rail-3d/assets/garage-alishan-fx-v1/alishan-fx.json + alishan-fx.bin.gz（正式資產；一次寫出，
  沒有既有資料要合併）
"""
import bpy, bmesh, sys, math, struct, json, hashlib, gzip, random
from pathlib import Path
from mathutils import Vector

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]  # repo 根目錄（scripts/blender/<本目錄>/<本檔>）
sys.path.insert(0, str(W / 'scripts/blender/emu3000-20260912'))
import blender_parts as p  # noqa: E402

BUILD_DIR = W / 'output/alishan-fx/build'
BUILD_DIR.mkdir(parents=True, exist_ok=True)
ASSET_DIR = W / 'rail-3d/assets/garage-alishan-fx-v1'
NOTES_PATH = W / 'output/alishan-fx/NOTES.md'
NOTES_PATH.parent.mkdir(parents=True, exist_ok=True)


def note(msg):
    line = f'- [build_alishan_fx] {msg}\n'
    with open(NOTES_PATH, 'a', encoding='utf-8') as f:
        f.write(line)
    print(line, end='')


p.reset({'id': 'alishan-fx', 'body': 'FFFFFF', 'accent': '888888'})
p.use('01')

# 中性預覽材質（實際場景端用自己的材質：雲＝MeshStandardMaterial 白色半透明、
# 螢火蟲＝MeshBasicMaterial 加色發光；這裡只是方便在 .blend 與審查圖裡看清楚形狀）。
m_cloud = p.mat('alishan_fx_cloud_preview', 'F2EFE4', 0, .85)
m_firefly = p.mat('alishan_fx_firefly_preview', 'D9E86B', 0, .3)


def icosphere(name, loc, radius, material, subdivisions=1, scale=(1, 1, 1)):
    """低面數橢球（沿用 people-20260924/build_people.py 的同名輔助）：用物件本身身分當索引鍵，
    不依賴 BMVert.index。scale≠(1,1,1) 時做非等比縮放（球→橢球，雲團扁平／螢火蟲維持正球）。"""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius)
    bm.verts.ensure_lookup_table()
    index_of = {v: i for i, v in enumerate(bm.verts)}
    verts = [(loc[0] + v.co.x * scale[0], loc[1] + v.co.y * scale[1], loc[2] + v.co.z * scale[2]) for v in bm.verts]
    faces = [tuple(index_of[v] for v in f.verts) for f in bm.faces]
    bm.free()
    return p.mesh(name, verts, faces, material, 0, True)


# ============================================================
# 雲團（第三輪重做——協調端退件：場景實際截圖裡雲團堆成一團不透明白色棉花球，不是「雲海」。
# 前兩輪的「主體橢球（壓扁 .75～.95）＋上方 puff」設計，即使壓扁，單叢的高仍跟寬同量級
# （puff 疊在主體上緣，整叢的高／寬比遠超過雲海該有的扁平比例），適合畫「一朵朵蓬鬆積雲」，
# 不適合畫「大片扁平、彼此連成一片的雲海層」。改法：拿掉 body/puff 的階層設計，全部零件統一用
# 同一種「薄餅狀」lobe——每顆都極度壓扁（rz≈rx 的 .14～.20），繞著一個中心點放射狀散開＋輕微
# z 抖動（讓頂面有自然起伏，不是死板同一平面），彼此重疊、不留縫隙。整叢的高／寬比因此結構上
# 遠低於場景端 verify 腳本要求的 ≤0.4 門檻（下方 P7 自檢直接量測，不是憑口算），場景端再疊上
# 大範圍重疊擺放＋半透明材質，才會讀成連續一片而不是一顆顆球。
# ============================================================
def make_cloud(tag, seed, n_a, subdiv_a, n_b, subdiv_b, material):
    rng = random.Random(seed)
    objs = []
    baseline = rng.uniform(.55, .70)  # 水平基準半徑，決定整叢的基準尺度
    flat = rng.uniform(.14, .20)      # rz/rx 比例——每顆 lobe 本身就遠低於 .4 門檻，疊起來的整叢更低
    n_total = n_a + n_b
    ang0 = rng.uniform(0, math.tau)
    lobes = []
    for i in range(n_total):
        if i == 0:
            lx, ly = 0.0, 0.0  # 第一顆置中，撐住整叢的視覺重心
        else:
            ang = ang0 + i / n_total * math.tau + rng.uniform(-.35, .35)
            dist = baseline * rng.uniform(.35, .85)
            lx, ly = math.cos(ang) * dist, math.sin(ang) * dist * rng.uniform(.55, .8)
        lobes.append((lx, ly, i < n_a))
    for i, (lx, ly, is_a) in enumerate(lobes):
        rx = baseline * rng.uniform(.8, 1.05) * (1.0 if is_a else rng.uniform(.6, .8))
        ry = rx * rng.uniform(.82, 1.0)
        rz = rx * flat * rng.uniform(.85, 1.15)
        cz = rng.uniform(-.3, .3) * rz  # 輕微起伏，不做同一平面的死板貼齊
        objs.append(icosphere(f'{tag}_l{i}', (lx, ly, cz), 1.0, material,
                               subdivisions=(subdiv_a if is_a else subdiv_b), scale=(rx, ry, rz)))
    return objs


# 第四輪退回（協調端這次針對雲團「輪廓」退件：黃昏近景zoom進去前景雲團看得到多邊形輪廓線，
# 像疊起來的塑膠片）。第三輪把每叢雲拆成「主體 lobe」與「次要 lobe」兩組、各給不同細分程度
# 省三角形預算，但兩組裡總有一組用 subdivisions=1（20 面的正二十面體本體，完全沒有再細分），
# 這組的輪廓在近景特寫裡非常明顯是多邊形。四叢雲團扁平比例/材質半透明度都沒問題（那是第三輪
# 已經解掉的「棉花球結成一團」問題），問題單純是網格解析度——把每叢雲裡原本 subdivisions=1
# 的那一組全部拉到 subdivisions=2（20→80 面，四倍細分），輪廓明顯圓滑很多；已經是
# subdivisions=2 的那一組不動（80 面已經夠圓，第三輪沒被抱怨過）。三角形預算跟著單顆 lobe
# 分辨率提高小幅上調（cloud-c 最大 4*80+2*80=480，其餘更低），仍遠低於任何效能疑慮的量級。
parts = {
    'cloud-a': make_cloud('cloud_a', 20260928, 3, 2, 1, 2, m_cloud),  # 大叢、主體圓潤：3*80+1*80=320
    'cloud-b': make_cloud('cloud_b', 20260929, 2, 2, 2, 2, m_cloud),  # 較集中渾圓：2*80+2*80=320
    'cloud-c': make_cloud('cloud_c', 20260930, 4, 2, 2, 2, m_cloud),  # 較寬：4*80+2*80=480
    'cloud-d': make_cloud('cloud_d', 20260931, 2, 2, 2, 2, m_cloud),  # 較小叢：2*80+2*80=320
    'firefly': [icosphere('firefly_core', (0, 0, 0), 1.0, m_firefly, subdivisions=0)],  # 20（場景端第四輪起不再引用這個零件的幾何，保留零件本身不影響任何人）
}
NAMES = ['cloud-a', 'cloud-b', 'cloud-c', 'cloud-d', 'firefly']
KIND = {'cloud-a': 'cloud', 'cloud-b': 'cloud', 'cloud-c': 'cloud', 'cloud-d': 'cloud', 'firefly': 'firefly'}
BUDGET = {'cloud-a': 550, 'cloud-b': 550, 'cloud-c': 550, 'cloud-d': 550, 'firefly': 40}
note('5 個零件物件建模完成：' + json.dumps({k: len(v) for k, v in parts.items()}, ensure_ascii=False))

# ============================================================
# 自製匯出（沿用 build_pantograph.py／build_people.py 的模式：calc_loop_triangles + corner_normals，
# world space；物件本身沒有額外的 object-level 平移/旋轉，verts 在建模時就直接寫在各零件自己的
# 局部座標，所以 world matrix＝identity，匯出值＝局部值）
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
# 跟 build_people.py 同一套算法（也是 verify_garage_stop_assets.mjs 的判準來源）。雲團由多顆互相重疊
# 的橢球疊加而成，但每顆本身仍是獨立封閉流形，逐三角形／逐零件的檢查不受重疊影響。
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

# P7 自檢（協調端退件新增）：雲團零件的高／寬比 ≤0.4——場景端 verify_garage_alishan_fx.mjs 的
# 「阿里山-雲海覆蓋」判準會再核對一次執行期實際載入的 geometry.boundingBox，這裡先在建模階段量
# 局部包圍盒把關，兩層防線（建模期＋執行期）都量同一件事、來源不同（這裡量原始頂點，場景端量
# Three.js 重建幾何的 boundingBox），避免只有單一層防線。firefly 不是雲、不受此比例限制。
RATIO_MAX = 0.4
bad_ratio = {}
for name in NAMES:
    if KIND[name] != 'cloud':
        continue
    rng = part_ranges[name]
    s, c = rng['start'], rng['count']
    xs, ys, zs = [], [], []
    for v in range(s, s + c):
        x, y, z = pos_of(v)
        xs.append(x); ys.append(y); zs.append(z)
    width = max(max(xs) - min(xs), max(ys) - min(ys))
    height = max(zs) - min(zs)
    ratio = height / width if width > 1e-9 else float('inf')
    if not (ratio <= RATIO_MAX):
        bad_ratio[name] = {'height': round(height, 4), 'width': round(width, 4), 'ratio': round(ratio, 4)}
note('P7 高/寬比自檢（門檻 ' + str(RATIO_MAX) + '）：' + (json.dumps(bad_ratio, ensure_ascii=False) if bad_ratio else '全部通過'))
if bad_ratio:
    sys.exit(f'P7 高/寬比自檢失敗：{bad_ratio}')

part_list = [{'name': n, 'start': part_ranges[n]['start'], 'count': part_ranges[n]['count'], 'kind': KIND[n]}
             for n in NAMES]

meta = {
    'schema': 'garage-parts-v1', 'id': 'alishan-fx', 'kind': 'alishan-fx', 'units': 'model',
    'vertexCount': vertex_count, 'triangleCount': total_tris, 'sha256': sha256,
    'rig': {}, 'parts': part_list,
}
(BUILD_DIR / 'alishan-fx.raw.bin').write_bytes(raw_bytes)
(BUILD_DIR / 'alishan-fx.meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(BUILD_DIR / 'alishan-fx.blend'))

# ---- 直接安裝為正式資產：沒有既有 alishan-fx.json 要合併，一次寫出 ----
ASSET_DIR.mkdir(parents=True, exist_ok=True)
asset = {
    'schema': 'garage-parts-v1', 'id': 'alishan-fx', 'kind': 'alishan-fx', 'units': 'model',
    'mesh': {'file': 'alishan-fx.bin.gz', 'sha256': sha256, 'encoding': 'float32-le', 'strideBytes': 24,
             'vertexCount': vertex_count, 'triangleCount': total_tris, 'compression': 'gzip'},
    'rig': {}, 'parts': part_list,
}
(ASSET_DIR / 'alishan-fx.bin.gz').write_bytes(gzip.compress(raw_bytes, compresslevel=9, mtime=0))
(ASSET_DIR / 'alishan-fx.json').write_text(json.dumps(asset, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

print('GD_ALISHAN_FX_BUILD_OK', json.dumps({
    'vertexCount': vertex_count, 'triangleCount': total_tris, 'sha256': sha256,
    'parts': {n: part_ranges[n]['count'] // 3 for n in NAMES},
}, ensure_ascii=False))
