#!/usr/bin/env python3
"""站房與站體設施（車庫精修第 3 項，重做版）：牆／屋頂／窗框／窗玻璃／門與雨庇／長椅（座板條＋
靠背＋椅腳）／路燈（柱＋燈臂＋燈頭＋燈罩玻璃）／垃圾桶（取代站牌），全部用 Blender 建模匯出成
garage-parts-v1 零件庫，取代 09-28 第一版直接在 south-coast.js 用 box()/cylinder 疊出來的做法。

背景：獨立評審 09-28 退回第一版（「細節還是都需要用 blender 製作」），原話列出的缺陷（簷口沒厚度、
窗沒框、看不到門、站名牌空白、燈頭是方塊）逐一在這支腳本裡用真正的零件解決——尤其是窗框／門框
這次是真正挖空的框（4 根樑拼成、中間留洞），玻璃/門片嵌進洞裡，不再需要 JS 端「小的那層更貼近
鏡頭」的深度順序戲法（那個戲法在第一版釀成一次真實遮擋 bug：窗框曾經整片擋住玻璃）。

站牌改成垃圾桶：使用者原話給了兩個選項之一「不然就拿掉站牌，換成別的 Blender 站體設施」——
空白站名牌本來就是原評審點名的缺陷之一，若沒有站名/圖標內容，做得再精緻的牌子多半還是會看起來
「空空的」；垃圾桶不需要任何文字/圖案就能讀出「這是站體設施」，模型也單純（錐台身體＋一圈頂
沿），改用這個選項而不是在 Blender 裡刻一個火車剪影圖標，省下的預算留給站房本體的品質。

沿用 palms-20260928/build_palms.py、coast-20260928/build_coast_flora.py 的做法（同一份
blender_parts.py 原語、同一套自製匯出/自檢區塊），複製一份而非 import：這個 pipeline 裡每支
build_*.py 都是自包含腳本，互不 import，方便單獨重跑與追溯。

零件的本地座標系一律「原點＝該零件自己會用到的錨點」：
  - 落地的獨立結構（牆／屋頂／椅腳／燈柱／垃圾桶身）：原點＝底部中心（z=0＝貼地面），
    這樣 JS 端 instance 的 pos.z 直接就是「這個東西該貼的地面/平台高度」，不用另外加半高補償。
  - 掛在牆上的次要構件（窗框／窗玻璃／門／雨庇）：原點＝該構件自己的中心，JS 端 pos 直接是
    構件中心的世界座標。
  - 一盞路燈拆成 4 個零件（柱/臂/頭/玻璃），彼此原點統一用「柱的底部（貼地點）」這個共同基準，
    這樣同一盞燈的 4 個零件用同一個 pos（貼地點）就會自動疊對，不必逐零件各自算偏移。

用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/coast-20260928/build_coast_station.py
輸出（新 kind，不覆寫既有 garage-palms-v1/garage-lanterns-v1）：
  rail-3d/assets/garage-coast-v1/station.json + station.bin.gz
  output/coast-station/build/*（中繼，不進 repo）
"""
import bpy, bmesh, sys, math, struct, json, hashlib, gzip
from pathlib import Path

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(W / 'scripts/blender/emu3000-20260912'))
import blender_parts as p  # noqa: E402

BUILD_DIR = W / 'output/coast-station/build'
BUILD_DIR.mkdir(parents=True, exist_ok=True)
ASSET_DIR = W / 'rail-3d/assets/garage-coast-v1'
NOTES_PATH = W / 'output/coast-station/NOTES.md'
NOTES_PATH.parent.mkdir(parents=True, exist_ok=True)


def note(msg):
    line = f'- [build_coast_station] {msg}\n'
    with open(NOTES_PATH, 'a', encoding='utf-8') as f:
        f.write(line)
    print(line, end='')


p.reset({'id': 'station', 'body': 'E9DFC3', 'accent': '2B2620'})
p.use('01')

m_wall = p.mat('station_wall_preview', 'E9DFC3', 0, .8)
m_roof = p.mat('station_roof_preview', '557F7B', 0, .55)
m_wood = p.mat('station_wood_preview', '5B4C3A', 0, .75)
m_glass = p.mat('station_glass_preview', '718E8A', .2, .2)
m_dark = p.mat('station_dark_preview', '2B2620', 0, .6)
m_metal = p.mat('station_metal_preview', '8A9291', .65, .35)
m_lamp = p.mat('station_lamp_preview', 'F6D797', 0, .3)

PART_OBJS = {}


def add_part(name, obj_or_list):
    lst = obj_or_list if isinstance(obj_or_list, list) else [obj_or_list]
    PART_OBJS.setdefault(name, []).extend(o for o in lst if o is not None)


# ============================================================
# 通用建模輔助（本檔專用，跟 blender_parts.py 的 box/cyl/rod/mesh 互補）
# ============================================================

def frustum(name, base, r0, r1, h, material, n=8, bevel=.006):
    """從 base（底面中心）往 +Z 升高 h 的錐台，底半徑 r0、頂半徑 r1——跟 blender_parts.cyl() 同一種
    「兩環擠出」做法，差別是兩環半徑可以不同（做出真正的錐度，縮放不會破壞它，跟第 2 項彎幹棕櫚/
    帽蓋同一個「錐度只能用絕對尺寸做」的理由）。"""
    x0, y0, z0 = base
    verts = []
    for z, r in [(0, r0), (h, r1)]:
        for i in range(n):
            a = 2 * math.pi * i / n
            verts.append((x0 + r * math.cos(a), y0 + r * math.sin(a), z0 + z))
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    return p.mesh(name, verts, faces, material, bevel, True)


def icosphere_at(name, center, radius, material):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=radius)
    bm.verts.ensure_lookup_table()
    idx = {v: i for i, v in enumerate(bm.verts)}
    verts = [(center[0] + v.co.x, center[1] + v.co.y, center[2] + v.co.z) for v in bm.verts]
    faces = [tuple(idx[v] for v in f.verts) for f in bm.faces]
    bm.free()
    return p.mesh(name, verts, faces, material, 0, True)


def gable_roof(name, L, W, H, thick, ridge_w, ridge_h, material):
    """厚屋頂＋屋脊：局部原點 z=0＝簷口下緣（安裝時對齊牆頂）。用「外環（真正的屋頂表面，坡度
    apex→兩側簷口）＋內環（外環整體垂直下移 thick，做出天花板側）」兩層六邊形斷面沿 X 擠出，
    六個側面裡有兩個是簷口本身的「小立面」（RIGHT/LEFT RIM）——那正是評審原話「屋簷沒有厚度」
    要補的那塊，從側面/仰角看得到一條實心邊，不是薄殼的刀口。屋脊另外疊一根方樑（ridge cap），
    跟主體一起算進同一個零件（見呼叫端把兩個物件都塞進同一個 PART_OBJS 名字）。"""
    hx, hw = L / 2, W / 2
    xs = [-hx, hx]
    idx = {}
    verts = []
    for x in xs:
        for label, pt in [('oA', (x, 0, H)), ('oL', (x, -hw, 0)), ('oR', (x, hw, 0)),
                           ('iA', (x, 0, H - thick)), ('iL', (x, -hw, -thick)), ('iR', (x, hw, -thick))]:
            idx[(x, label)] = len(verts)
            verts.append(pt)
    x0, x1 = xs

    def q(*keys):
        return tuple(idx[k] for k in keys)

    faces = [
        q((x0, 'oA'), (x0, 'oL'), (x1, 'oL'), (x1, 'oA')),  # 外・左坡
        q((x0, 'oA'), (x1, 'oA'), (x1, 'oR'), (x0, 'oR')),  # 外・右坡
        q((x0, 'iA'), (x1, 'iA'), (x1, 'iL'), (x0, 'iL')),  # 內・左坡（天花板側）
        q((x0, 'iA'), (x0, 'iR'), (x1, 'iR'), (x1, 'iA')),  # 內・右坡
        q((x0, 'oL'), (x0, 'iL'), (x1, 'iL'), (x1, 'oL')),  # 左簷口立面（厚度在這裡讀出來）
        q((x0, 'oR'), (x1, 'oR'), (x1, 'iR'), (x0, 'iR')),  # 右簷口立面
        q((x0, 'oA'), (x0, 'oR'), (x0, 'iR'), (x0, 'iA')),  # 端牆・右半
        q((x0, 'oA'), (x0, 'iA'), (x0, 'iL'), (x0, 'oL')),  # 端牆・左半
        q((x1, 'oA'), (x1, 'iA'), (x1, 'iR'), (x1, 'oR')),  # 另一端・右半
        q((x1, 'oA'), (x1, 'oL'), (x1, 'iL'), (x1, 'iA')),  # 另一端・左半
    ]
    slab = p.mesh(name + '_slab', verts, faces, material, 0, True)
    ridge = p.box(name + '_ridge', (0, 0, H + ridge_h / 2), (L + .08, ridge_w, ridge_h), material, bevel=.02)
    return [slab, ridge]


def framed_hole(prefix, outer_w, outer_h, bar, depth, material):
    """挖洞窗框/門框：4 根樑拼成一個矩形框、中間留真正的洞（不是實心方塊）——玻璃/門片可以直接嵌
    在洞裡，不必再靠「哪一層比較貼近鏡頭」的深度戲法。回傳 4 個 bpy 物件（同一個零件的 4 個構件）。
    局部原點＝框的中心；洞的淨開口＝(outer_w-2*bar) x (outer_h-2*bar)。"""
    hw, hh, hb = outer_w / 2, outer_h / 2, bar / 2
    top = p.box(prefix + '_top', (0, 0, hh - hb), (outer_w, depth, bar), material, bevel=min(.012, bar / 3))
    bot = p.box(prefix + '_bot', (0, 0, -(hh - hb)), (outer_w, depth, bar), material, bevel=min(.012, bar / 3))
    left = p.box(prefix + '_left', (-(hw - hb), 0, 0), (bar, depth, outer_h - 2 * bar), material, bevel=min(.012, bar / 3))
    right = p.box(prefix + '_right', (hw - hb, 0, 0), (bar, depth, outer_h - 2 * bar), material, bevel=min(.012, bar / 3))
    return [top, bot, left, right]


NOTES_PATH.write_text('', encoding='utf-8')

# ============================================================
# 1. 牆（落地，原點＝底部中心）
# ============================================================
WALL_W, WALL_D, WALL_H = 4.6, 2.3, 1.8
add_part('wall', p.box('station-wall', (0, 0, WALL_H / 2), (WALL_W, WALL_D, WALL_H), m_wall, bevel=.03))

# ============================================================
# 2. 屋頂（安裝時 z=0 對齊牆頂；簷口比牆各邊多出 .35~.4 的懸挑）
# ============================================================
ROOF_L, ROOF_W, ROOF_H, ROOF_THICK = WALL_W + .7, WALL_D + .8, .9, .14
add_part('roof', gable_roof('station-roof', ROOF_L, ROOF_W, ROOF_H, ROOF_THICK, .26, .16, m_roof))

# ============================================================
# 3. 窗框／窗玻璃（原點＝窗中心；洞口淨開口約 .77x.68）
# ============================================================
WIN_W, WIN_H, WIN_BAR, WIN_DEPTH = .95, .86, .09, .07
add_part('window-frame', framed_hole('station-window-frame', WIN_W, WIN_H, WIN_BAR, WIN_DEPTH, m_wood))
glass_w, glass_h = WIN_W - 2 * WIN_BAR - .02, WIN_H - 2 * WIN_BAR - .02
add_part('window-glass', p.box('station-window-glass', (0, 0, 0), (glass_w, .025, glass_h), m_glass, bevel=0))

# ============================================================
# 4. 門與雨庇：門框（真正挖洞）＋凹進的門片＋門把，雨庇＋兩根托架
# ============================================================
DOOR_W, DOOR_H, DOOR_BAR, DOOR_DEPTH = .50, 1.04, .07, .09
add_part('door', framed_hole('station-door-frame', DOOR_W, DOOR_H, DOOR_BAR, DOOR_DEPTH, m_wood))
panel_w, panel_h = DOOR_W - 2 * DOOR_BAR - .02, DOOR_H - 2 * DOOR_BAR - .02
add_part('door', p.box('station-door-panel', (0, 0, 0), (panel_w, .035, panel_h), m_dark, bevel=.01))
add_part('door', p.box('station-door-handle', (panel_w * .32, .045, 0), (.035, .05, .16), m_metal, bevel=.012))

CANOPY_W, CANOPY_PROJ, CANOPY_T = .62, .40, .06
canopy_slab = p.box('station-canopy-slab', (0, -CANOPY_PROJ / 2 + .01, 0), (CANOPY_W, CANOPY_PROJ, CANOPY_T), m_wood, bevel=.015)
bracket_a = p.rod('station-canopy-bracket-a', (-.20, .02, -.10), (-.20, -CANOPY_PROJ + .04, .02), .018, m_wood)
bracket_b = p.rod('station-canopy-bracket-b', (.20, .02, -.10), (.20, -CANOPY_PROJ + .04, .02), .018, m_wood)
add_part('canopy', [canopy_slab, bracket_a, bracket_b])

# ============================================================
# 5. 長椅：座板條 x3、靠背、椅腳（落地，原點＝底部中心）
# ============================================================
SEAT_W, SLAT_T, SLAT_GAP = 1.25, .045, .12
slat_objs = []
for k, dy in enumerate([-SLAT_GAP, 0, SLAT_GAP]):
    slat_objs.append(p.box(f'station-bench-seat-slat{k}', (0, dy, SLAT_T / 2), (SEAT_W, .09, SLAT_T), m_wood, bevel=.012))
add_part('bench-seat', slat_objs)

BACK_W, BACK_H = 1.25, .30
back_obj = p.panel('station-bench-back', (0, 0, BACK_H / 2), BACK_W, BACK_H, m_wood, plane='side', r=.035, depth=.03)
add_part('bench-back', back_obj)

LEG_H = .35
add_part('bench-leg', p.box('station-bench-leg', (0, 0, LEG_H / 2), (.09, .24, LEG_H), m_wood, bevel=.015))

# ============================================================
# 6. 路燈：柱／臂／頭／玻璃，四個零件共用「柱底＝貼地點」這個原點
# ============================================================
POLE_H, POLE_R = 2.8, .075
add_part('lamp-pole', p.cyl('station-lamp-pole', (0, 0, POLE_H / 2), POLE_R, POLE_H, m_wood, axis='Z', n=10))

ARM_OUT, ARM_Z = .55, POLE_H - .05
add_part('lamp-arm', p.rod('station-lamp-arm', (0, 0, ARM_Z), (ARM_OUT, 0, ARM_Z), .045, m_wood))

HEAD_R, HEAD_BOTTOM_Z, BODY_H = .16, ARM_Z - .17, .30
collar_bottom = frustum('station-lamp-head-collar-bottom', (ARM_OUT, 0, HEAD_BOTTOM_Z - .03), HEAD_R + .015, HEAD_R + .015, .03, m_metal, n=8, bevel=.004)
collar_top = frustum('station-lamp-head-collar-top', (ARM_OUT, 0, HEAD_BOTTOM_Z + BODY_H), HEAD_R + .015, HEAD_R + .015, .03, m_metal, n=8, bevel=.004)
cap = frustum('station-lamp-head-cap', (ARM_OUT, 0, HEAD_BOTTOM_Z + BODY_H + .03), HEAD_R + .03, .05, .18, m_wood, n=8, bevel=.006)
finial = icosphere_at('station-lamp-head-finial', (ARM_OUT, 0, HEAD_BOTTOM_Z + BODY_H + .03 + .18 + .035), .038, m_metal)
add_part('lamp-head', [collar_bottom, collar_top, cap, finial])

add_part('lamp-glass', frustum('station-lamp-glass', (ARM_OUT, 0, HEAD_BOTTOM_Z), HEAD_R, HEAD_R, BODY_H, m_glass, n=8, bevel=0))

# ============================================================
# 7. 垃圾桶（取代站牌，見檔頭理由；落地，原點＝底部中心）
# ============================================================
BIN_H, BIN_R0, BIN_R1 = .74, .30, .225
add_part('bin-body', frustum('station-bin-body', (0, 0, 0), BIN_R0, BIN_R1, BIN_H, m_dark, n=12, bevel=.006))
add_part('bin-rim', p.cyl('station-bin-rim', (0, 0, BIN_H + .025), BIN_R1 + .03, .05, m_metal, axis='Z', n=12))

NAMES = ['wall', 'roof', 'window-frame', 'window-glass', 'door', 'canopy',
         'bench-seat', 'bench-back', 'bench-leg',
         'lamp-pole', 'lamp-arm', 'lamp-head', 'lamp-glass',
         'bin-body', 'bin-rim']
for n in NAMES:
    if n not in PART_OBJS or not PART_OBJS[n]:
        sys.exit(f'缺零件 {n}')
note(f'{len(NAMES)} 個零件建模完成：' + ', '.join(f'{n}x{len(PART_OBJS[n])}' for n in NAMES))

# ============================================================
# 自製匯出（逐字沿用 build_coast_flora.py 的做法：calc_loop_triangles + corner_normals；
# 差別是每個零件可能對應多個 bpy 物件——同一個零件名字底下所有物件的三角形依序接在同一段
# 連續 byte range 裡，Three.js 端讀出來就是「一個零件＝一個 BufferGeometry」，跟零件在 Blender
# 裡是幾個物件拼出來的無關）。
# ============================================================
deps = bpy.context.evaluated_depsgraph_get()
raw = bytearray()
count = 0
part_ranges = {}
total_tris = 0

for name in NAMES:
    start_vertex = count
    for obj in PART_OBJS[name]:
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
    note(f'部件 {name!r}：start={start_vertex} count={count - start_vertex}（{(count - start_vertex)//3} 個三角形，{len(PART_OBJS[name])} 個物件合併）')

raw_bytes = bytes(raw)
sha256 = hashlib.sha256(raw_bytes).hexdigest()
vertex_count = count
f = struct.unpack(f'<{len(raw_bytes)//4}f', raw_bytes)

note(f'三角形總數={total_tris}（上限 9000：建築/家具類靜態幾何，整站只實例化個位數次，不像植被要'
     '逐棵種滿整片山坡；bevel+weighted-normal modifier 在小方塊上會把三角形數放大好幾倍，屬預期）')
if total_tris > 9000:
    sys.exit(f'三角形總數 {total_tris} 超過 9000')


def sub3(a, b):
    return (a[0]-b[0], a[1]-b[1], a[2]-b[2])


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
    'schema': 'garage-parts-v1', 'id': 'station', 'kind': 'station', 'units': 'model',
    'vertexCount': vertex_count, 'triangleCount': total_tris, 'sha256': sha256,
    'parts': part_list,
}
(BUILD_DIR / 'station.raw.bin').write_bytes(raw_bytes)
(BUILD_DIR / 'station.meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(BUILD_DIR / 'station.blend'))

ASSET_DIR.mkdir(parents=True, exist_ok=True)
asset = {
    'schema': 'garage-parts-v1', 'id': 'station', 'kind': 'station', 'units': 'model',
    'mesh': {'file': 'station.bin.gz', 'sha256': sha256, 'encoding': 'float32-le', 'strideBytes': 24,
             'vertexCount': vertex_count, 'triangleCount': total_tris, 'compression': 'gzip'},
    'parts': part_list,
}
(ASSET_DIR / 'station.bin.gz').write_bytes(gzip.compress(raw_bytes, compresslevel=9, mtime=0))
(ASSET_DIR / 'station.json').write_text(json.dumps(asset, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

print('GD_COAST_STATION_BUILD_OK', json.dumps({
    'vertexCount': vertex_count, 'triangleCount': total_tris, 'sha256': sha256,
    'parts': {n: part_ranges[n]['count'] // 3 for n in NAMES},
}, ensure_ascii=False))
