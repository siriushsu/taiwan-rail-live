#!/usr/bin/env python3
"""建 garage-palms-v1 裡的 2 款闊葉樹冠團塊（broadleaf-a / broadleaf-b，各含 trunk+canopy 兩個零件），
南迴海岸景植被（車庫精修第 2 項）。

背景（獨立評審 2026-09-28，polish-critique.md「01 藍皮」第 1 項）：山坡撒滿同一款「直挺挺、等粗」
的檳榔/椰子，剪影像「插滿牙籤的綠色軟糖」；棕櫚一路種到稜線，遠看是一排細針戳出山頭。使用者
「細節還是都需要用blender製作」。撒點邏輯在 rail-3d/garage-scenes/south-coast.js。

## 09-28 第三版起的分工（重要：這支腳本不再整包覆寫 palms.json）
棕櫚（椰子 3 款含兩款彎幹、檳榔 2 款）整棵改由 scripts/blender/palms-20260928/build_palms.py 建，
舊版的 6 個棕櫚零件（betel-trunk／crownshaft／fronds、coco-trunk／fronds／fruit）與 2 個彎幹椰子幹
（coco-curved-a/b-trunk）都已從正式資產移除，這支腳本也不再建它們。
這支腳本只建闊葉樹 4 個零件，寫回時用「合併」：讀現有 palms.json／palms.bin.gz，只換掉這 4 段、
其餘零件（build_palms.py 的整棵棕櫚）逐 byte 保留、順序不變。以前是整包覆寫，重跑會把新版棕櫚
蓋回舊版（兩支腳本互相覆蓋）。build_palms.py 反過來也只搬運這 4 段、不重建。
建模是決定性的：闊葉樹參數沒改時，重跑的輸出跟現有資產逐 byte 相同（腳本會印出比對結果）。

## 闊葉樹冠團塊：多顆 icosphere 疊成一個零件
每款闊葉樹＝1 個主樹冠（半徑較大、subdivisions=1，比舊版「三顆 icosphere 疊出樹冠」用的
subdivisions=0 更圓，配合 smooth=True 從近處看不會是「多面體綠寶石」）＋2~3 個小樹冠疊在
主樹冠周邊，撐出不規則的叢狀剪影（不是完美球體）。疊球之間允許互相貫穿——每顆 icosphere
自己是封閉朝外的殼，貫穿不影響「逐零件朝外自檢」（見下方 P6，體積是逐三角形對零件重心的
帶號和，殼與殼重疊時只是疊加，不會讓某個殼的法向量反向）。trunk 是短胖的漸縮圓柱（跟高幹
棕櫚的細長樹幹明顯不同、避免看起來像棕櫚換頭）。

用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/coast-20260928/build_coast_flora.py
輸出（沒有 CLI 參數）：
  rail-3d/assets/garage-palms-v1/palms.json + palms.bin.gz（合併寫回，只換闊葉樹 4 段）
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
m_bl_trunk = p.mat('coastflora_broadleaf_trunk_preview', '6b5d4a', 0, .75)
m_bl_canopy_a = p.mat('coastflora_broadleaf_a_canopy_preview', '4a7048', 0, .68)
m_bl_canopy_b = p.mat('coastflora_broadleaf_b_canopy_preview', '5c8a4f', 0, .68)


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
    """幹：漸縮圓柱，絕對高度 height（執行期一律用均勻 instance scale，不靠非均勻縮放做高度變化）。"""
    verts = []
    for z, r in [(0, r0), (height, r1)]:
        for i in range(n):
            a = 2 * math.pi * i / n
            verts.append((r * math.cos(a), r * math.sin(a), z))
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    return p.mesh(name, verts, faces, material, 0, True)


parts = {}

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

NAMES = ['broadleaf-a-trunk', 'broadleaf-a-canopy', 'broadleaf-b-trunk', 'broadleaf-b-canopy']
note('闊葉樹 4 個零件建模完成。')

# ============================================================
# 自製匯出（calc_loop_triangles + corner_normals）
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
broadleaf_a_total = tri('broadleaf-a-trunk') + tri('broadleaf-a-canopy')
broadleaf_b_total = tri('broadleaf-b-trunk') + tri('broadleaf-b-canopy')
note(f'三角形預算自檢：闊葉樹 A={broadleaf_a_total}、B={broadleaf_b_total}（上限各 500）')
if broadleaf_a_total > 500 or broadleaf_b_total > 500:
    sys.exit(f'闊葉樹三角形數超過 500：A={broadleaf_a_total} B={broadleaf_b_total}')

raw_bytes = bytes(raw)
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

meta = {
    'schema': 'garage-parts-v1', 'id': 'palms-broadleaf', 'kind': 'palms', 'units': 'model',
    'vertexCount': vertex_count, 'triangleCount': total_tris, 'sha256': hashlib.sha256(raw_bytes).hexdigest(),
    'parts': [{'name': n, 'start': part_ranges[n]['start'], 'count': part_ranges[n]['count'], 'pivot': [0, 0, 0]} for n in NAMES],
}
(BUILD_DIR / 'coast_flora.raw.bin').write_bytes(raw_bytes)
(BUILD_DIR / 'coast_flora.meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(BUILD_DIR / 'coast_flora.blend'))

# ============================================================
# 合併寫回正式資產：只換闊葉樹 4 段，其餘零件逐 byte 保留、順序不變（見檔頭「分工」）
# ============================================================
old_meta = json.loads((ASSET_DIR / 'palms.json').read_text(encoding='utf-8'))
old_raw = gzip.decompress((ASSET_DIR / 'palms.bin.gz').read_bytes())
if hashlib.sha256(old_raw).hexdigest() != old_meta['mesh']['sha256']:
    sys.exit('現有 palms.bin.gz 的 sha256 跟 palms.json 對不上，不合併')
old_names = [q['name'] for q in old_meta['parts']]
out = bytearray()
part_list = []
same = {}
for q in old_meta['parts']:
    old_chunk = old_raw[q['start'] * 24:(q['start'] + q['count']) * 24]
    if q['name'] in part_ranges:
        r = part_ranges[q['name']]
        chunk = raw_bytes[r['start'] * 24:(r['start'] + r['count']) * 24]
        same[q['name']] = chunk == old_chunk
    else:
        chunk = old_chunk
    part_list.append({'name': q['name'], 'start': len(out) // 24, 'count': len(chunk) // 24, 'pivot': q.get('pivot', [0, 0, 0])})
    out.extend(chunk)
for n in NAMES:  # 現有資產沒有的闊葉樹零件接在最後（正常情況不會發生）。
    if n not in old_names:
        r = part_ranges[n]
        chunk = raw_bytes[r['start'] * 24:(r['start'] + r['count']) * 24]
        part_list.append({'name': n, 'start': len(out) // 24, 'count': r['count'], 'pivot': [0, 0, 0]})
        out.extend(chunk)
        same[n] = False
out_bytes = bytes(out)
sha256 = hashlib.sha256(out_bytes).hexdigest()
asset = {
    'schema': 'garage-parts-v1', 'id': 'palms', 'kind': 'palms', 'units': 'model',
    'mesh': {'file': 'palms.bin.gz', 'sha256': sha256, 'encoding': 'float32-le', 'strideBytes': 24,
             'vertexCount': len(out_bytes) // 24, 'triangleCount': len(out_bytes) // 72, 'compression': 'gzip'},
    'parts': part_list,
}
(ASSET_DIR / 'palms.bin.gz').write_bytes(gzip.compress(out_bytes, compresslevel=9, mtime=0))
(ASSET_DIR / 'palms.json').write_text(json.dumps(asset, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
note('合併寫回：闊葉樹 4 段跟寫回前逐 byte 相同＝' + json.dumps(same, ensure_ascii=False) + f'；整檔 sha256 {"不變" if sha256 == old_meta["mesh"]["sha256"] else "改變"}')

print('GD_COAST_FLORA_BUILD_OK', json.dumps({
    'broadleafVertexCount': vertex_count, 'broadleafTriangleCount': total_tris, 'assetSha256': sha256,
    'assetUnchanged': sha256 == old_meta['mesh']['sha256'], 'broadleafSameAsBefore': same,
    'broadleafATris': broadleaf_a_total, 'broadleafBTris': broadleaf_b_total,
    'parts': {n: part_ranges[n]['count'] // 3 for n in NAMES},
}, ensure_ascii=False))
