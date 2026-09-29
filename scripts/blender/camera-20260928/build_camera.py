#!/usr/bin/env python3
"""建 garage-camera-v1（garage-parts-v1）：多良景「攝影者」的相機與雙手舉相機的手臂，全部在 Blender 建好。

為什麼：使用者 09-28「細節還是都需要用 Blender 製作」。原本多良遊客是程序化方塊人，相機是手上一塊
深色方塊；這一版遊客換成 garage-people-v1 的 Blender 人，攝影者手上的相機（機身、頂蓋、鏡頭、玻璃）
與「雙手舉到臉前」的兩條彎臂、兩隻手都是這個資產；執行期（rail-3d/garage-scenes/duoliang.js）只做擺放、
轉動與上色。

座標：跟 garage-people-v1 同一個「人的座標系」（面向 +X、左手 +Y、腳底 z=0，單位＝公尺、人高 1.7）。
所有零件的轉軸都是 [0,0,0]，也就是這些零件本來就寫在人的座標系裡；攝影者的上半身（頭、髮、上衣、
這兩條臂、手、相機）繞人的中軸（腰）一起轉，相機因此永遠對著頭朝的方向。
相機：中心 CAM_C，鏡頭軸 +X，機身寬（Y）0.15、高 0.085、深 0.062，鏡頭筒前伸約 0.09。

零件（tint）：
  camera-body（fixed 深炭灰）camera-top（fixed 銀）camera-lens（fixed 近黑）camera-glass（fixed 深藍紫）
  grip-sleeve-l／-r（top 上衣色）grip-hand-l／-r（skin 膚色）
左右臂各自一份幾何（彎臂不是左右對稱的鏡像，不能用「第二份 pivot y 取負」的做法）。
臂：肩（人座標 [0,±.2,1.36]）→ 上臂 .23 往下往外 → 手肘 → 前臂 .23 往前往內上 → 手腕 → 手握在相機兩端。

用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/camera-20260928/build_camera.py
輸出：rail-3d/assets/garage-camera-v1/camera.json + camera.bin.gz；output/camera/build/*（中繼，不進 repo）。
"""
import bpy, bmesh, sys, math, struct, json, hashlib, gzip
from pathlib import Path
from mathutils import Vector

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(W / 'scripts/blender/emu3000-20260912'))
import blender_parts as p  # noqa: E402

BUILD_DIR = W / 'output/camera/build'
BUILD_DIR.mkdir(parents=True, exist_ok=True)
ASSET_DIR = W / 'rail-3d/assets/garage-camera-v1'
ASSET_DIR.mkdir(parents=True, exist_ok=True)

p.reset({'id': 'camera', 'body': 'FFFFFF', 'accent': '888888'})
p.use('01')

CHARCOAL, SILVER, LENS_BLACK, GLASS = '2A2C30', 'B9BEC2', '15171A', '1B2340'
m_body = p.mat('cam_body', CHARCOAL, 0, .5)
m_top = p.mat('cam_top', SILVER, .6, .35)
m_lens = p.mat('cam_lens', LENS_BLACK, 0, .45)
m_glass = p.mat('cam_glass', GLASS, .2, .12)
m_sleeve = p.mat('cam_sleeve_preview', '6F8FA8', 0, .5)
m_skin = p.mat('cam_skin_preview', 'E9C8A8', 0, .5)

CAM_C = Vector((.32, 0, 1.50))
SHOULDER_Y, SHOULDER_Z = .2, 1.36
UPPER, FORE = .23, .23


def icosphere(name, loc, radius, material, subdivisions=1, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius)
    bm.verts.ensure_lookup_table()
    index_of = {v: i for i, v in enumerate(bm.verts)}
    verts = [(loc[0] + v.co.x * scale[0], loc[1] + v.co.y * scale[1], loc[2] + v.co.z * scale[2]) for v in bm.verts]
    faces = [tuple(index_of[v] for v in f.verts) for f in bm.faces]
    bm.free()
    return p.mesh(name, verts, faces, material, 0, True)


def rod_round(name, a, b, r, material, n=8):
    """兩端收成圓錐尖點（同 build_people.py 的 rod_round）；極點就落在 a／b 本身。"""
    va, vb = Vector(a), Vector(b)
    axis = (vb - va).normalized()
    length = (vb - va).length
    u = axis.cross(Vector((0, 0, 1)))
    if u.length < .01:
        u = axis.cross(Vector((0, 1, 0)))
    u.normalize()
    v = axis.cross(u)
    cap = min(r, length * .3)
    ring = lambda c: [tuple(c + r * (math.cos(2 * math.pi * i / n) * u + math.sin(2 * math.pi * i / n) * v)) for i in range(n)]
    verts = [tuple(va)] + ring(va + axis * cap) + ring(vb - axis * cap) + [tuple(vb)]
    pa, ra, rb, pb = 0, 1, 1 + n, 1 + 2 * n
    faces = [(pa, ra + i, ra + (i + 1) % n) for i in range(n)]
    faces += [(ra + i, ra + (i + 1) % n, rb + (i + 1) % n, rb + i) for i in range(n)]
    faces += [(rb + i, rb + (i + 1) % n, pb) for i in range(n)]
    return p.mesh(name, verts, faces, material, 0, True)


def at(dx, dy, dz):
    return (CAM_C.x + dx, CAM_C.y + dy, CAM_C.z + dz)


parts = {n: [] for n in ['camera-body', 'camera-top', 'camera-lens', 'camera-glass',
                         'grip-sleeve-l', 'grip-sleeve-r', 'grip-hand-l', 'grip-hand-r']}

# ---- 機身（含右側握把、兩側背帶環）----
parts['camera-body'] += [
    p.box('cam_body', at(0, 0, 0), (.062, .150, .085), m_body, bevel=.006),
    p.box('cam_grip', at(.014, -.056, -.004), (.058, .038, .080), m_body, bevel=.008),  # 右側握把，往前凸
    p.box('cam_lug_l', at(-.004, .078, .020), (.014, .010, .016), m_body, bevel=0),
    p.box('cam_lug_r', at(-.004, -.078, .020), (.014, .010, .016), m_body, bevel=0),
    p.box('cam_back_screen', at(-.0335, 0, -.004), (.004, .085, .058), m_lens, bevel=0),  # 後面的螢幕黑框
    p.box('cam_mount_ring', at(.031, 0, 0), (.006, .078, .078), m_lens, bevel=0),  # 鏡頭接環
]
# ---- 頂蓋（銀）：頂板、觀景窗凸起、熱靴、轉盤、快門鈕 ----
top_z = .0425
parts['camera-top'] += [
    p.box('cam_topplate', at(0, 0, top_z + .008), (.062, .150, .016), m_top, bevel=.005),
    p.box('cam_evf', at(-.014, 0, top_z + .026), (.030, .040, .024), m_top, bevel=.006),  # 觀景窗凸起
    p.box('cam_hotshoe', at(-.014, 0, top_z + .043), (.024, .022, .006), m_lens, bevel=0),
    p.cyl('cam_dial_l', at(.006, .048, top_z + .021), .0165, .010, m_top, axis='Z', n=12, bevel=0),
    p.cyl('cam_dial_r', at(.006, -.032, top_z + .019), .012, .006, m_body, axis='Z', n=10, bevel=0),
    p.cyl('cam_shutter', at(.014, -.060, top_z + .022), .0085, .012, m_lens, axis='Z', n=8, bevel=0),
]
# ---- 鏡頭筒：接環→筒身→對焦環→前環→（玻璃）----
lens_x0 = CAM_C.x + .034
parts['camera-lens'] += [
    p.cyl('cam_barrel', (lens_x0 + .026, CAM_C.y, CAM_C.z), .034, .052, m_lens, axis='X', n=16, bevel=0),
    p.cyl('cam_focus_ring', (lens_x0 + .066, CAM_C.y, CAM_C.z), .0375, .028, m_lens, axis='X', n=16, bevel=0),
    p.cyl('cam_front_ring', (lens_x0 + .088, CAM_C.y, CAM_C.z), .033, .016, m_top, axis='X', n=16, bevel=0),
]
parts['camera-top'].append(parts['camera-lens'].pop())  # 前環是銀色，歸頂蓋色
parts['camera-glass'] += [
    p.cyl('cam_glass_disc', (lens_x0 + .0965, CAM_C.y, CAM_C.z), .0255, .004, m_glass, axis='X', n=16, bevel=0),
]

# ---- 兩條彎臂與兩隻手 ----
for sgn, tag in ((1, 'l'), (-1, 'r')):
    S = Vector((0, sgn * SHOULDER_Y, SHOULDER_Z))
    Hc = Vector((CAM_C.x - .012, sgn * .092, CAM_C.z - .014))       # 手掌中心
    Wr = Hc + Vector((-.058, sgn * .030, -.040))                        # 手腕
    sw = Wr - S
    mid = S + sw * .5
    u = sw.normalized()
    v0 = Vector((-.25, sgn * .5, -.85))
    n = (v0 - u * v0.dot(u)).normalized()
    h = math.sqrt(UPPER ** 2 - (sw.length / 2) ** 2)
    E = mid + n * h
    parts[f'grip-sleeve-{tag}'] += [
        icosphere(f'cam_shoulder_{tag}', tuple(S), .046, m_sleeve, subdivisions=1),
        rod_round(f'cam_upper_{tag}', tuple(S), tuple(E), .045, m_sleeve, n=8),
        icosphere(f'cam_elbow_{tag}', tuple(E), .047, m_sleeve, subdivisions=1),
        rod_round(f'cam_fore_{tag}', tuple(E), tuple(Wr), .040, m_sleeve, n=8),
    ]
    # 手：手掌橢球托在相機端，三根手指繞到前側（沿 X 往前），拇指壓在頂面邊緣
    parts[f'grip-hand-{tag}'] += [
        icosphere(f'cam_palm_{tag}', tuple(Hc), 1, m_skin, subdivisions=1, scale=(.036, .033, .040)),
        icosphere(f'cam_wrist_{tag}', tuple(Wr), .030, m_skin, subdivisions=0),
    ]
    for k, dz in enumerate((-.024, -.004, .016)):
        a = Vector((Hc.x + .016, sgn * .078, Hc.z + dz))
        b = Vector((Hc.x + .050, sgn * (.060 - k * .002), Hc.z + dz))
        parts[f'grip-hand-{tag}'].append(rod_round(f'cam_finger_{tag}{k}', tuple(a), tuple(b), .0105, m_skin, n=6))
    a = Vector((Hc.x + .004, sgn * .088, Hc.z + .036))
    b = Vector((Hc.x + .030, sgn * .066, Hc.z + .045))
    parts[f'grip-hand-{tag}'].append(rod_round(f'cam_thumb_{tag}', tuple(a), tuple(b), .0125, m_skin, n=6))
    print('elbow', tag, tuple(round(x, 3) for x in E), 'hand', tuple(round(x, 3) for x in Hc), '|SW|', round(sw.length, 3))

NAMES = list(parts)
TINT = {'camera-body': 'fixed', 'camera-top': 'fixed', 'camera-lens': 'fixed', 'camera-glass': 'fixed',
        'grip-sleeve-l': 'top', 'grip-sleeve-r': 'top', 'grip-hand-l': 'skin', 'grip-hand-r': 'skin'}
FIXED = {'camera-body': CHARCOAL, 'camera-top': SILVER, 'camera-lens': LENS_BLACK, 'camera-glass': GLASS}

deps = bpy.context.evaluated_depsgraph_get()
raw = bytearray()
count = 0
ranges = {}
tris = 0
for name in NAMES:
    start = count
    for obj in parts[name]:
        ev = obj.evaluated_get(deps)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        wm = obj.matrix_world
        nm = wm.to_3x3().inverted_safe().transposed()
        for tri in me.loop_triangles:
            for li in tri.loops:
                pos = wm @ me.vertices[me.loops[li].vertex_index].co
                nrm = (nm @ me.corner_normals[li].vector).normalized()
                if not all(math.isfinite(x) for x in (*pos, *nrm)):
                    raise ValueError('非有限網格 ' + obj.name)
                raw.extend(struct.pack('<6f', *pos, *nrm))
                count += 1
            tris += 1
        ev.to_mesh_clear()
    ranges[name] = (start, count - start)
    print(f'{name}: {(count - start) // 3} tris')
raw_bytes = bytes(raw)
f = struct.unpack(f'<{len(raw_bytes) // 4}f', raw_bytes)
sha = hashlib.sha256(raw_bytes).hexdigest()

# 自檢：無退化三角形；每個零件的有號體積 > 0（朝外）
sub = lambda a, b: (a[0] - b[0], a[1] - b[1], a[2] - b[2])
cross = lambda a, b: (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
dot = lambda a, b: a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
P = lambda v: (f[v * 6], f[v * 6 + 1], f[v * 6 + 2])
degen = sum(1 for v in range(0, count, 3) if not (math.hypot(*cross(sub(P(v + 1), P(v)), sub(P(v + 2), P(v)))) / 2 > 1e-10))
print('退化三角形', degen)
bad = {}
for name in NAMES:
    s, c = ranges[name]
    cen = [sum(f[v * 6 + k] for v in range(s, s + c)) / c for k in range(3)]
    vol = sum(dot(sub(P(v), cen), cross(sub(P(v + 1), cen), sub(P(v + 2), cen))) / 6 for v in range(s, s + c, 3))
    if not vol > 0:
        bad[name] = vol
print('朝外自檢', bad or '通過')
if degen or bad:
    sys.exit('自檢失敗')

part_list = []
for n in NAMES:
    e = {'name': n, 'start': ranges[n][0], 'count': ranges[n][1], 'tint': TINT[n], 'pivot': [0, 0, 0], 'perPerson': 1}
    if TINT[n] == 'fixed':
        e['color'] = [round(p.linear(int(FIXED[n][i:i + 2], 16) / 255), 4) for i in (0, 2, 4)]
    part_list.append(e)
meta = {'schema': 'garage-parts-v1', 'id': 'camera', 'kind': 'camera', 'units': 'model',
        'mesh': {'file': 'camera.bin.gz', 'sha256': sha, 'encoding': 'float32-le', 'strideBytes': 24,
                 'vertexCount': count, 'triangleCount': tris, 'compression': 'gzip'},
        'rig': {'cameraCenter': list(CAM_C), 'lensAxis': [1, 0, 0]}, 'parts': part_list}
(BUILD_DIR / 'camera.raw.bin').write_bytes(raw_bytes)
bpy.ops.wm.save_as_mainfile(filepath=str(BUILD_DIR / 'camera.blend'))
(ASSET_DIR / 'camera.bin.gz').write_bytes(gzip.compress(raw_bytes, compresslevel=9, mtime=0))
(ASSET_DIR / 'camera.json').write_text(json.dumps(meta, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
print('GD_CAMERA_BUILD_OK', json.dumps({'vertexCount': count, 'triangleCount': tris, 'sha256': sha}))
