#!/usr/bin/env python3
"""建 garage-scooter-v1（garage-parts-v1）：光華街涵洞景的機車（125cc 速克達）與安全帽，全部在 Blender 建好。

使用者原話（2026-09-30 08:16）：「附近有一個大家都在拍照的地下道 我希望做成一個3D車庫的景」；
選項回覆：機車＝「Blender 新做機車＋零件庫騎士」。以下的尺寸與姿勢都是主對話判讀或一般規格估計，不是使用者原話。

規格錨點（官方頁面，2026-09-30 讀取）：SYM JET SL 125 頁面（https://tw.sym-global.com/jetsl125）「性能規格」逐字：
  長寬高「1815x680x1115」、軸距「1290 mm」、前輪胎「110/70-12」、後輪胎「120/70-12」。頁面沒有座高，座高 .78 m 是一般規格估計。
  輪徑由胎規算（12 吋輪圈 304.8 mm＋2×扁平比 .70×胎寬）：後 .4728、前 .4588 m（主對話判讀＝一般公式）。

座標：跟 garage-people-v1 同一個「人的座標系」（面向 +X、左手 +Y、z＝0 是地面，單位公尺）；原點在兩軸中點正下方的地面。
零件與 tint：
  scooter-body（tint body：車殼漆色，執行期上色）scooter-seat／-mat／-metal／-plastic／-grip／-plate／-mirror／-signal（fixed）
  scooter-lamp-f／-lamp-r（fixed；執行期自成一個網格，夜間自發光）
  wheel-tire／wheel-disc／wheel-rim（fixed；轉軸＝輪心；一份幾何，執行期擺兩個實例＝一次 draw call）
  helmet（tint helmet；轉軸＝人的頸軸 [0,0,1.42]，跟 garage-people-v1 的 head 同一個轉軸，幾何相對轉軸）
騎士（人零件庫的頭、身、手、腿）不在這個資產裡，坐姿由 rail-3d/garage-scooter.js 依 rig.rider 算矩陣。

用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/scooter-20260930/build_scooter.py
輸出：rail-3d/assets/garage-scooter-v1/scooter.json + scooter.bin.gz；output/scooter/build/*（中繼，不進 repo）。
"""
import bpy, bmesh, sys, math, struct, json, hashlib, gzip
from pathlib import Path
from mathutils import Vector

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(W / 'scripts/blender/emu3000-20260912'))
import blender_parts as p  # noqa: E402

BUILD_DIR = W / 'output/scooter/build'
BUILD_DIR.mkdir(parents=True, exist_ok=True)
ASSET_DIR = W / 'rail-3d/assets/garage-scooter-v1'
ASSET_DIR.mkdir(parents=True, exist_ok=True)

p.reset({'id': 'scooter', 'body': 'FFFFFF', 'accent': '888888'})
p.use('01')

# ---- 顏色（fixed 的存進 JSON；body／helmet 只是預覽色）----
C = {'seat': '25272A', 'mat': '1A1C1E', 'metal': 'A2A9AF', 'plastic': '2A2D31', 'grip': '141618', 'plate': 'E9E6DA',
     'mirror': '9FB4C0', 'signal': 'E08A1E', 'lamp-f': 'FFF1CC', 'lamp-r': 'C92A24',
     'tire': '1B1D1F', 'disc': '30353A', 'rim': '9AA3AA'}
m = {k: p.mat('sc_' + k, v, .55 if k in ('metal', 'rim') else 0, .35 if k in ('metal', 'rim', 'mirror') else .6) for k, v in C.items()}
m['body'] = p.mat('sc_body_preview', 'C9463D', 0, .35)
m['helmet'] = p.mat('sc_helmet_preview', 'E7E3D8', 0, .3)

# ---- 版面常數（公尺）----
RA_X, FA_X = -.645, .645                 # 後、前軸（軸距 1.29＝官方 1290 mm）
R_R = 1.524e-1 + .7 * .12                # 後輪外徑半徑：12 吋輪圈半徑 .1524＋胎高 .084＝.2364（120/70-12）
R_F = 1.524e-1 + .7 * .11                # 前輪 .2294（110/70-12）
SEAT_TOP, FLOOR_TOP, COWL_TOP = .782, .34, 1.135
GRIP = (.24, .278, 1.03)                 # 左握把中心（右邊 y 取負）
RIDER = {'hip': [-.26, 0, .90], 'lean': .30, 'headPitch': -.22, 'thigh': .42, 'splay': .10, 'shinBack': .12, 'footY': .14}

parts = {n: [] for n in ['scooter-body', 'scooter-fender', 'scooter-seat', 'scooter-mat', 'scooter-metal', 'scooter-plastic', 'scooter-grip',
                         'scooter-plate', 'scooter-mirror', 'scooter-signal', 'scooter-lamp-f', 'scooter-lamp-r',
                         'wheel-tire', 'wheel-disc', 'wheel-rim', 'helmet']}


def spow(v, e):
    return math.copysign(abs(v) ** e, v)


def ring_yz(x, hw, zb, zt, n=12, e=3.0):
    """y–z 平面的超橢圓環（沿 x 擠出的車殼、座墊用）。"""
    zc, hh = (zb + zt) / 2, (zt - zb) / 2
    return [(x, hw * spow(math.cos(2 * math.pi * i / n), 2 / e), zc + hh * spow(math.sin(2 * math.pi * i / n), 2 / e)) for i in range(n)]


def ring_xy(z, cx, dx, hy, n=12, e=2.6):
    """x–y 平面的超橢圓環（前擋板沿 z 擠出用）。"""
    return [(cx + dx * spow(math.cos(2 * math.pi * i / n), 2 / e), hy * spow(math.sin(2 * math.pi * i / n), 2 / e), z) for i in range(n)]


def loft(name, rings, material, smooth=True, part=None):
    n = len(rings[0])
    verts = [v for r in rings for v in r]
    faces = [(i * n + j, i * n + (j + 1) % n, (i + 1) * n + (j + 1) % n, (i + 1) * n + j) for i in range(len(rings) - 1) for j in range(n)]
    # 兩端蓋用扇形（中心點＋環），不用 n 邊形：超橢圓環的頂邊有共線點，n 邊形會切出零面積三角形
    for ring, first in ((rings[0], 0), (rings[-1], (len(rings) - 1) * n)):
        c = Vector((0, 0, 0))
        for v in ring:
            c += Vector(v)
        verts.append(tuple(c / n))
        ci = len(verts) - 1
        faces += [(ci, first + j, first + (j + 1) % n) for j in range(n)]
    o = p.mesh(name, verts, faces, material, 0, smooth)
    if part:
        parts[part].append(o)
    return o


def add(part, o):
    parts[part].append(o)
    return o


def box(part, name, c, d, material):
    return add(part, p.box(name, c, d, material, bevel=0))


def rod(part, name, a, b, r, material, n=8):
    return add(part, p.rod(name, a, b, r, material, n))


def cyl(part, name, c, r, depth, material, axis='Y', n=10):
    return add(part, p.cyl(name, c, r, depth, material, axis, n, 0))


# ================= 車殼（漆色）=================
# 後車身：座墊下面的車廂，輪拱在後輪上方（底面 .50 比胎頂 .4716 高），輪前面往下收到 .27
REAR = [(-.915, .110, .505, .662), (-.885, .135, .495, .672), (-.780, .160, .500, .668), (-.640, .174, .500, .664),
        (-.520, .180, .498, .662), (-.440, .182, .400, .660), (-.360, .186, .300, .658), (-.220, .190, .272, .656),
        (-.060, .196, .268, .652)]
loft('rear_body', [ring_yz(*r) for r in REAR], m['body'], part='scooter-body')
# 踏板底盤（漆色）：座墊前緣 x＝-.06 到前擋板；上面 .318，踏墊再疊 .022 ＝ .34
box('scooter-body', 'floor_pan', (.15, 0, .279), (.42, .47, .078), m['body'])
# 前車身（前擋板＋前臉＋龍頭罩）：沿 z 擠出的橢圓環。後面（貼騎士膝蓋那一面）不動；前面往前加厚：
# 下段的前緣貼著前胎後上緣（離胎 3～6 mm，胎是固定的 110/70-12，胎後緣 x＝.446@z.35、.554@z.44、頂 z＝.459，所以 z<.46 的深度被前胎限住），
# z≥.46 起前緣伸到 x≈.60 蓋住前叉（前叉在 y＝±.105、x≈.55，藏在前臉裡），深度 .28～.31；
# 上段前面隨轉向管後傾，到頭燈處保持一小段近垂直的頭燈面板（x≈.44）。每列＝(z, 前緣 xf, 後緣 xb, 半寬 hy)。
BODY_F = [(.300, .412, .314, .222), (.350, .435, .317, .212), (.400, .477, .320, .205), (.440, .540, .318, .200), (.460, .600, .316, .199),
          (.500, .602, .314, .198), (.600, .606, .300, .194), (.700, .586, .287, .190), (.800, .548, .262, .188), (.900, .498, .238, .192),
          (.945, .452, .2125, .197), (1.000, .446, .187, .203), (1.070, .440, .176, .205), (1.115, .412, .196, .190), (COWL_TOP, .372, .224, .150)]
loft('front_body', [ring_xy(z, (xf + xb) / 2, (xf - xb) / 2, hy, n=16, e=2.3) for z, xf, xb, hy in BODY_F], m['body'], part='scooter-body')
# 前擋泥板（獨立零件，方便量）：繞前輪心的拱（實心弧形板，內半徑比胎大 .012），後段埋進前車身下緣＝接在前車身下方
FC = (FA_X, 0, R_F)
ri, ro = R_F + .012, R_F + .036
sec = [(-.10, ri), (-.10, ri + .012), (-.055, ro), (.055, ro), (.10, ri + .012), (.10, ri)]
frings = []
for k in range(12):
    th = -1.10 + (1.22 + 1.10) * k / 11
    frings.append([(FC[0] + r * math.sin(th), y, FC[2] + r * math.cos(th)) for y, r in sec])
loft('front_fender', frings, m['body'], smooth=False, part='scooter-fender')

# ================= 座墊（黑）=================
SEAT = [(-.820, .095, .640, .745), (-.775, .135, .640, .763), (-.700, .160, .640, .776), (-.580, .172, .640, SEAT_TOP),
        (-.380, .174, .640, SEAT_TOP), (-.250, .160, .640, .775), (-.150, .135, .640, .768), (-.075, .105, .640, .762), (-.060, .095, .640, .760)]
loft('seat', [ring_yz(*r) for r in SEAT], m['seat'], part='scooter-seat')
# 踏墊（黑橡膠）：整片平面，頂面 .34
box('scooter-mat', 'floor_mat', (.14, 0, FLOOR_TOP - .011), (.38, .40, .022), m['mat'])

# ================= 龍頭：手把、握把、煞車把手、照後鏡、頭燈、儀表 =================
rod('scooter-metal', 'handlebar', (GRIP[0], -.33, GRIP[2]), (GRIP[0], .33, GRIP[2]), .011, m['metal'])
for s in (1, -1):
    cyl('scooter-grip', f'grip_{s}', (GRIP[0], s * GRIP[1], GRIP[2]), .0175, .104, m['grip'], 'Y', 10)
    rod('scooter-grip', f'lever_{s}', (GRIP[0] + .015, s * .245, GRIP[2] + .015), (GRIP[0] + .095, s * .238, GRIP[2] + .008), .006, m['grip'], 6)
    rod('scooter-metal', f'mirror_stalk_{s}', (.28, s * .20, 1.06), (.31, s * .32, 1.09), .008, m['metal'], 6)
    mh = [ring_yz(.306 + dx, .040 - dy, 1.095 - .028 + dy, 1.095 + .028 - dy, n=10, e=2.4) for dx, dy in ((0, 0), (.022, .006))]
    mv = [[(x, s * (.325 + y), z) for x, y, z in ring] for ring in mh]
    add('scooter-mirror', loft(f'mirror_{s}', mv, m['mirror'], smooth=True))
    box('scooter-signal', f'sig_f_{s}', (.400, s * .188, .955), (.030, .030, .030), m['signal'])
    box('scooter-signal', f'sig_r_{s}', (-.903, s * .128, .600), (.022, .032, .032), m['signal'])
box('scooter-plastic', 'meter', (.192, 0, 1.075), (.022, .12, .045), m['plastic'])
box('scooter-plastic', 'lamp_f_bezel', (.440, 0, 1.0), (.014, .180, .096), m['plastic'])
lf = [ring_yz(x, hw, 1.0 - hh, 1.0 + hh, n=10, e=3.0) for x, hw, hh in ((.442, .074, .036), (.458, .068, .032))]
add('scooter-lamp-f', loft('lamp_f', lf, m['lamp-f'], smooth=False))
# 前叉（兩支，貼在前罩板兩側）
for s in (1, -1):
    rod('scooter-metal', f'fork_{s}', (FA_X, s * .105, R_F), (.455, s * .105, .78), .017, m['metal'], 8)

# ================= 車尾：尾燈、車牌、後扶手 =================
box('scooter-plastic', 'lamp_r_bezel', (-.914, 0, .600), (.014, .190, .062), m['plastic'])
box('scooter-lamp-r', 'lamp_r', (-.924, 0, .600), (.020, .172, .046), m['lamp-r'])
box('scooter-plastic', 'plate_bracket', (-.900, 0, .520), (.030, .060, .050), m['plastic'])
box('scooter-plate', 'plate', (-.925, 0, .455), (.006, .200, .135), m['plate'])
for s in (1, -1):
    rod('scooter-plastic', f'rail_a_{s}', (-.745, s * .125, .700), (-.895, s * .105, .722), .012, m['plastic'], 6)
rod('scooter-plastic', 'rail_b', (-.895, -.105, .722), (-.895, .105, .722), .012, m['plastic'], 6)

# ================= 傳動、避震、排氣管、腳踏 =================
box('scooter-plastic', 'cvt_arm', (-.475, .140, .245), (.36, .050, .100), m['plastic'])
cyl('scooter-plastic', 'cvt_case', (-.330, .150, .265), .108, .070, m['plastic'], 'Y', 12)
rod('scooter-metal', 'muffler', (-.640, -.205, .355), (-.150, -.205, .355), .046, m['metal'], 10)
for s in (1, -1):
    rod('scooter-metal', f'shock_{s}', (RA_X, s * .135, R_R), (-.49, s * .172, .500), .012, m['metal'], 6)
    box('scooter-plastic', f'peg_{s}', (-.300, s * .198, .318), (.070, .030, .018), m['plastic'])

# ================= 輪子（轉軸＝輪心，軸沿 y；一份幾何，執行期擺兩個實例）=================
N = 20
TRC, TAY, TAR = R_R - .042, .059, .042          # 胎剖面：中心半徑、半寬（y）、半高（徑向）
tsec = [(TAY * spow(math.cos(2 * math.pi * k / 8), 2 / 2.6), TRC + TAR * spow(math.sin(2 * math.pi * k / 8), 2 / 2.6)) for k in range(8)]
trings = []
for i in range(N):                                # i＝0 在正下方（有一個頂點貼地）
    a = 2 * math.pi * i / N
    trings.append([(r * math.sin(a), y, -r * math.cos(a)) for y, r in tsec])
nv2 = 8
tv = [v for r in trings for v in r]
tf = [(i * nv2 + j, i * nv2 + (j + 1) % nv2, ((i + 1) % N) * nv2 + (j + 1) % nv2, ((i + 1) % N) * nv2 + j) for i in range(N) for j in range(nv2)]
add('wheel-tire', p.mesh('tire', tv, tf, m['tire'], 0, True))
add('wheel-disc', p.cyl('disc', (0, 0, 0), .150, .070, m['disc'], 'Y', 20, 0))
for k in range(5):
    a = 2 * math.pi * k / 5 + math.pi / 10
    ca, sa = math.cos(a), math.sin(a)
    r0, r1, hw_, hy_ = .030, .146, .017, .038
    pts = []
    for sx in (-1, 1):
        for sy in (-hy_, hy_):
            for r in (r0, r1):
                pts.append((r * ca + sx * hw_ * -sa, sy, r * sa + sx * hw_ * ca))
    # 8 個頂點：(sx,sy,r) 排序 = sx*4+sy_idx*2+r_idx
    add('wheel-rim', p.mesh(f'spoke{k}', pts, [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)], m['rim'], 0, False))
cyl('wheel-rim', 'hub', (0, 0, 0), .048, .096, m['rim'], 'Y', 10)

# ================= 安全帽（3/4 半罩；座標＝相對頸軸，頭是半徑 .175、中心 (0,0,.115) 的球）=================
HC, A_OUT, A_IN = (-.006, 0., .115), (.214, .206, .206), (.190, .186, .186)
NI, NJ = 18, 6
zrim = lambda phi: .004 + .126 * max(0., math.cos(phi)) ** 1.5      # 帽緣高：前面在眉上 .13，兩側與後面壓到耳朵以下 .004
th_rim = lambda A, z: math.acos(max(-1., min(1., (z - HC[2]) / A[2])))
def hp(A, phi, th):
    return (HC[0] + A[0] * math.sin(th) * math.cos(phi), HC[1] + A[1] * math.sin(th) * math.sin(phi), HC[2] + A[2] * math.cos(th))
hv, hf = [], []
for A in (A_OUT, A_IN):
    base = len(hv)
    hv.append(hp(A, 0, 0))
    for j in range(1, NJ + 1):
        for i in range(NI):
            phi = 2 * math.pi * i / NI
            hv.append(hp(A, phi, th_rim(A, zrim(phi)) * j / NJ))
    idx = lambda j, i: base + 1 + (j - 1) * NI + i % NI
    hf += [(base, idx(1, i), idx(1, i + 1)) for i in range(NI)]
    hf += [(idx(j, i), idx(j, i + 1), idx(j + 1, i + 1), idx(j + 1, i)) for j in range(1, NJ) for i in range(NI)]
o_last = lambda i: 1 + (NJ - 1) * NI + i % NI
i_last = lambda i: len(hv) // 2 + 1 + (NJ - 1) * NI + i % NI
hf += [(o_last(i), o_last(i + 1), i_last(i + 1), i_last(i)) for i in range(NI)]
add('helmet', p.mesh('helmet', hv, hf, m['helmet'], 0, True))

# ================= 匯出 =================
NAMES = list(parts)
TINT = {n: 'fixed' for n in NAMES}
TINT['scooter-body'], TINT['scooter-fender'], TINT['helmet'] = 'body', 'body', 'helmet'
FIXED = {'scooter-' + k: v for k, v in C.items() if k not in ('tire', 'disc', 'rim')}
FIXED.update({'wheel-tire': C['tire'], 'wheel-disc': C['disc'], 'wheel-rim': C['rim']})
PIVOT = {n: [0, 0, 0] for n in NAMES}
PIVOT['helmet'] = [0, 0, 1.42]

deps = bpy.context.evaluated_depsgraph_get()
raw = bytearray()
count = 0
ranges = {}
tris = 0
for name in NAMES:
    start = count
    pv = Vector((0, 0, 0))   # 網格本來就畫在「相對轉軸」的座標裡（安全帽是頭本地座標），不再減轉軸
    for obj in parts[name]:
        ev = obj.evaluated_get(deps)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        wm = obj.matrix_world
        nm = wm.to_3x3().inverted_safe().transposed()
        for tri in me.loop_triangles:
            for li in tri.loops:
                pos = wm @ me.vertices[me.loops[li].vertex_index].co - pv
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

sub = lambda a, b: (a[0] - b[0], a[1] - b[1], a[2] - b[2])
cross = lambda a, b: (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
dot = lambda a, b: a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
P = lambda v: (f[v * 6], f[v * 6 + 1], f[v * 6 + 2])
degen_by = {}
for name in NAMES:
    s0, c0 = ranges[name]
    k = sum(1 for v in range(s0, s0 + c0, 3) if not (math.hypot(*cross(sub(P(v + 1), P(v)), sub(P(v + 2), P(v)))) / 2 > 1e-10))
    if k:
        degen_by[name] = k
degen = sum(degen_by.values())
print('退化三角形', degen, degen_by)
bad = {}
for name in NAMES:
    s, c = ranges[name]
    cen = [sum(f[v * 6 + k] for v in range(s, s + c)) / c for k in range(3)]
    vol = sum(dot(sub(P(v), cen), cross(sub(P(v + 1), cen), sub(P(v + 2), cen))) / 6 for v in range(s, s + c, 3))
    if not vol > 0:
        bad[name] = vol
print('朝外自檢（每個零件有號體積 > 0）', bad or '通過')
if degen or bad:
    sys.exit('自檢失敗')
scooter_tris = sum(ranges[n][1] // 3 for n in NAMES if n != 'helmet')
wheel_tris = sum(ranges[n][1] // 3 for n in NAMES if n.startswith('wheel-'))
print('機車（含輪子一份）三角形', scooter_tris, '；渲染時輪子兩個實例＝', scooter_tris + wheel_tris, '；安全帽', ranges['helmet'][1] // 3)

part_list = []
for n in NAMES:
    e = {'name': n, 'start': ranges[n][0], 'count': ranges[n][1], 'tint': TINT[n], 'pivot': PIVOT[n], 'perPerson': 1}
    if TINT[n] == 'fixed':
        e['color'] = [round(p.linear(int(FIXED[n][i:i + 2], 16) / 255), 4) for i in (0, 2, 4)]
    part_list.append(e)
rig = {'units': 'm', 'axes': 'x forward, y left, z up, origin on ground midway between axles',
       'wheels': {'rear': [RA_X, 0, R_R], 'front': [FA_X, 0, R_F], 'rearRadius': R_R, 'frontRadius': R_F},
       'seatTop': SEAT_TOP, 'floorTop': FLOOR_TOP, 'cowlTop': COWL_TOP, 'grip': list(GRIP),
       'fork': {'axle': [FA_X, .105, R_F], 'top': [.455, .105, .78]}, 'lampFront': [.458, 0, 1.0], 'lampRear': [-.934, 0, .600], 'rider': RIDER, 'neckPivot': [0, 0, 1.42],
       'spec': {'source': 'https://tw.sym-global.com/jetsl125', 'lwh_mm': '1815x680x1115', 'wheelbase_mm': 1290, 'tires': ['110/70-12', '120/70-12']}}
meta = {'schema': 'garage-parts-v1', 'id': 'scooter', 'kind': 'scooter', 'units': 'model',
        'mesh': {'file': 'scooter.bin.gz', 'sha256': sha, 'encoding': 'float32-le', 'strideBytes': 24,
                 'vertexCount': count, 'triangleCount': tris, 'compression': 'gzip'},
        'rig': rig, 'parts': part_list}
(BUILD_DIR / 'scooter.raw.bin').write_bytes(raw_bytes)
bpy.ops.wm.save_as_mainfile(filepath=str(BUILD_DIR / 'scooter.blend'))
(ASSET_DIR / 'scooter.bin.gz').write_bytes(gzip.compress(raw_bytes, compresslevel=9, mtime=0))
(ASSET_DIR / 'scooter.json').write_text(json.dumps(meta, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
print('GD_SCOOTER_BUILD_OK', json.dumps({'vertexCount': count, 'triangleCount': tris, 'sha256': sha}))
