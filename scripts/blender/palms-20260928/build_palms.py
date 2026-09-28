#!/usr/bin/env python3
"""建 palms（garage-parts-v1）第三版：南迴海岸景的椰子 3 款＋檳榔 2 款，整棵樹在 Blender 建好。

為什麼重做（使用者原話，09-28）：「那個樹看起來像是個笑話 這什麼東西？」「細節還是都需要用blender製作」
「只有藍皮的樹 感覺還是不太對」「棕梠樹的比例跟樣貌太奇怪 其他的樹不用動」。
主對話讀截圖歸納的四點：椰子葉從頂端直接往下垂（像濕拖把）、椰子葉是藍綠色、檳榔只有一小撮刺刺的
星形葉（像牙籤）、棕櫚比旁邊的闊葉樹矮小一大截。第二版的做法是「每片葉子一個 instance、下垂角度由
程式算」，審查圖看到的跟場景裡不是同一個東西；這一版把整棵樹（樹幹、環紋、樹冠、葉鞘、椰子果、
枯葉）的形狀全部在這裡建好，執行期（rail-3d/garage-scenes/south-coast.js）只做擺放：位置、yaw、
等比縮放、每棵樹的色調深淺（instanceColor）。

## 零件命名與顏色
一款樹＝同一個前綴的幾個零件，例如 coco-straight/trunk、coco-straight/rings、coco-straight/fronds …。
格式 garage-parts-v1 只有位置＋法向量、沒有頂點色，所以「顏色不同的部分」分成不同零件存；
south-coast.js 載入後把同一款樹的零件接成一份幾何、每個零件上一個頂點色，一款樹＝一個 InstancedMesh
（一次 draw call）。子零件：
  trunk 樹幹淺色段（含上下封口）　rings 環紋（葉痕，深色細帶）　knob 椰子樹冠基部（葉柄基部那團）
  shaft 檳榔葉鞘（亮綠光滑段）　fronds 成熟葉　young 新葉（較淺、較直立）　dry 乾掉下垂的褐葉
  fruit 椰子果
樹的局部座標：原點＝樹幹底部中心（貼地點），+Z 朝上，椰子的傾斜／彎曲一律朝局部 +X
（south-coast.js 用 yaw 把 +X 轉向海側）。單位＝場景單位（UNITS_PER_METER=0.4435，站姿乘客 0.754＝1.7 m）。

## 葉片造型（每片葉子都一樣的做法）
葉軸（rachis）是一條在「該葉方位角的鉛直面」內的曲線：先以 base 角往上揚、到 t1 附近拱到最高、
外側（t>t1）才轉下垂到 tip 角。小葉用「一段葉軸一片三角形」：底邊是葉軸的一小段，尖端往外、往前、
往下（Λ 形斷面：兩側小葉從葉軸往下垂），相鄰小葉之間留 V 形缺口＝鋸齒狀的羽狀葉輪廓。
正側看有下垂小葉的高度、正上看有左右寬度、順著葉軸看是 Λ，四個方向都不會變成一條線。
小葉是單面三角形，south-coast.js 的材質用 DoubleSide（竹葉在十分景也是同一個做法）。

## 輸出（直接覆寫正式資產，保留闊葉樹零件逐 byte 不動）
  rail-3d/assets/garage-palms-v1/palms.json + palms.bin.gz
  output/palms/build/palms.raw.bin + .meta.json + .blend + shape-report.json（中繼，不進 repo）
闊葉樹 4 個零件（broadleaf-a/b-trunk/canopy）由 scripts/blender/coast-20260928/build_coast_flora.py 建；
這支腳本不重建它們，從現有正式資產把那 4 段原始 bytes 原封不動搬進新檔（寫檔後再比對一次 sha256）。

用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \
  --python scripts/blender/palms-20260928/build_palms.py
"""
import bpy, sys, math, struct, json, hashlib, gzip
from pathlib import Path

sys.dont_write_bytecode = True
W = Path(__file__).resolve().parents[3]
ASSET_DIR = W / 'rail-3d/assets/garage-palms-v1'
BUILD_DIR = W / 'output/palms/build'
BUILD_DIR.mkdir(parents=True, exist_ok=True)
NOTES_PATH = W / 'output/palms/NOTES.md'
KEEP = ['broadleaf-a-trunk', 'broadleaf-a-canopy', 'broadleaf-b-trunk', 'broadleaf-b-canopy']


def note(msg):
    with open(NOTES_PATH, 'a', encoding='utf-8') as f:
        f.write(f'- [build_palms v3] {msg}\n')
    print(f'[build_palms v3] {msg}')


rad = math.radians


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def mul(a, k):
    return (a[0] * k, a[1] * k, a[2] * k)


# ------------------------------------------------------------------ 幾何產生器（純 Python，最後建成 Blender 物件）

class Part:
    """一個子零件：頂點＋面（多邊形索引）＋是否平滑。closed＝跟同款樹的其他 closed 零件合起來是封閉殼。"""

    def __init__(self, smooth, closed):
        self.v, self.f, self.smooth, self.closed = [], [], smooth, closed

    def poly(self, pts):
        base = len(self.v)
        self.v.extend(pts)
        self.f.append(tuple(range(base, base + len(pts))))

    def tri(self, a, b, c):
        self.poly([a, b, c])


def tube(parts, key_of, center, radius, ts, n, cap_bottom=True, cap_top=True):
    """沿平面曲線 center(t)->(x,z)（y=0）掃出 n 邊管，ts 是切段位置；每段自己一組頂點（段與段之間位置
    相同、拓撲不相連——形成低多邊形的分段感），key_of(ta,tb) 決定該段屬於哪個子零件（樹幹或環紋）。"""
    def frame(t):
        e = 1e-3
        a, b = center(max(0.0, t - e)), center(min(1.0, t + e))
        tx, tz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(tx, tz)
        tx, tz = tx / L, tz / L
        return (tz, 0.0, -tx)  # 鉛直面內、垂直於切線的法向（t 沿 +Z 時＝+X）

    def ring(t):
        cx, cz = center(t)
        N = frame(t)
        r = radius(t)
        return [(cx + r * (math.cos(a) * N[0]), r * math.sin(a), cz + r * (math.cos(a) * N[2]))
                for a in (2 * math.pi * k / n for k in range(n))]
    for ta, tb in zip(ts[:-1], ts[1:]):
        part = parts[key_of(ta, tb)]
        r0, r1 = ring(ta), ring(tb)
        base = len(part.v)
        part.v.extend(r0 + r1)
        for k in range(n):
            part.f.append((base + k, base + (k + 1) % n, base + n + (k + 1) % n, base + n + k))
    if cap_bottom:
        parts['trunk'].poly(list(reversed(ring(ts[0]))))
    if cap_top:
        parts['trunk'].poly(ring(ts[-1]))


def frustum(part, c, r0, r1, h, n, bottom_cap=True):
    """鉛直的漸縮圓柱（樹冠基部、葉鞘段用），c＝底面中心。"""
    b = [(c[0] + r0 * math.cos(2 * math.pi * k / n), c[1] + r0 * math.sin(2 * math.pi * k / n), c[2]) for k in range(n)]
    t = [(c[0] + r1 * math.cos(2 * math.pi * k / n), c[1] + r1 * math.sin(2 * math.pi * k / n), c[2] + h) for k in range(n)]
    base = len(part.v)
    part.v.extend(b + t)
    for k in range(n):
        part.f.append((base + k, base + (k + 1) % n, base + n + (k + 1) % n, base + n + k))
    if bottom_cap:
        part.f.append(tuple(reversed(range(base, base + n))))
    part.f.append(tuple(range(base + n, base + 2 * n)))


def lathe(part, c, profile, n):
    """鉛直旋轉體（檳榔葉鞘）：profile＝[(z, r), ...] 由下往上，兩端封口。"""
    rings = []
    for z, r in profile:
        rings.append([(c[0] + r * math.cos(2 * math.pi * k / n), c[1] + r * math.sin(2 * math.pi * k / n), c[2] + z) for k in range(n)])
    base = len(part.v)
    for rg in rings:
        part.v.extend(rg)
    for j in range(len(rings) - 1):
        s0, s1 = base + j * n, base + (j + 1) * n
        for k in range(n):
            part.f.append((s0 + k, s0 + (k + 1) % n, s1 + (k + 1) % n, s1 + k))
    part.f.append(tuple(reversed(range(base, base + n))))
    part.f.append(tuple(range(base + (len(rings) - 1) * n, base + len(rings) * n)))


def ico(part, c, r, squash_z=1.0):
    """20 面的低多邊形球（椰子果）。"""
    g = (1 + 5 ** .5) / 2
    raw = [(-1, g, 0), (1, g, 0), (-1, -g, 0), (1, -g, 0), (0, -1, g), (0, 1, g), (0, -1, -g), (0, 1, -g),
           (g, 0, -1), (g, 0, 1), (-g, 0, -1), (-g, 0, 1)]
    faces = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6),
             (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10),
             (8, 6, 7), (9, 8, 1)]
    k = r / math.sqrt(1 + g * g)
    base = len(part.v)
    part.v.extend([(c[0] + x * k, c[1] + y * k, c[2] + z * k * squash_z) for x, y, z in raw])
    part.f.extend([(base + a, base + b, base + cc) for a, b, cc in faces])


def rachis(L, n, angle_at):
    """葉軸：angle_at(t) 回傳 t 處切線仰角（度，正＝往上）；回傳 n+1 個點的 (水平距離, z) 與每點切線角。"""
    pts, angs, x, z = [(0.0, 0.0)], [angle_at(0.0)], 0.0, 0.0
    for i in range(n):
        th = rad(angle_at((i + .5) / n))
        x += L / n * math.cos(th)
        z += L / n * math.sin(th)
        pts.append((x, z))
        angs.append(angle_at((i + 1) / n))
    return pts, angs


def arch(th0, thtip, t1, p1=1.5, p2=1.3):
    """先揚後垂：t≤t1 從 th0 平順降到 0（拱頂在 t1），外側 t>t1 才轉下垂到 -thtip。"""
    def f(t):
        if t <= t1:
            return th0 * (1 - (t / t1) ** p1)
        return -thtip * ((t - t1) / (1 - t1)) ** p2
    return f


def frond(part, A, az, L, n, angle_at, wmax, drape0, drape1, t_leaf=.1, w_floor=.02, fwd=.42, taper=.55):
    """一片羽狀葉（見檔頭「葉片造型」）。回傳 dict（葉軸世界點、方位角）給形狀自檢用。"""
    pts, angs = rachis(L, n, angle_at)
    h = (math.cos(az), math.sin(az), 0.0)
    s = (-math.sin(az), math.cos(az), 0.0)
    P = [(A[0] + h[0] * x, A[1] + h[1] * x, A[2] + z) for x, z in pts]
    for i in range(n):
        tm = (i + 1) / n
        if tm <= t_leaf:
            w = w_floor
        else:
            w = max(w_floor, wmax * math.sin(math.pi * min(1.0, (tm - t_leaf) / (1 - t_leaf + .08))) ** taper)
        dr = rad(drape0 + (drape1 - drape0) * tm)
        a = rad(angs[i + 1])
        fv = (h[0] * math.cos(a), h[1] * math.cos(a), math.sin(a))
        for sg in (-1, 1):
            E = add(add(add(P[i + 1], mul(fv, w * fwd)), mul(s, sg * w * math.cos(dr))), (0.0, 0.0, -w * math.sin(dr)))
            if sg < 0:
                part.tri(P[i], P[i + 1], E)
            else:
                part.tri(P[i + 1], P[i], E)
    return {'P': P, 'az': az, 'A': A}


# ------------------------------------------------------------------ 樹種

def new_parts(names_closed):
    return {k: Part(smooth=sm, closed=cl) for k, (sm, cl) in names_closed.items()}


COCO_SUBPARTS = {'trunk': (True, True), 'rings': (True, True), 'knob': (False, True), 'fronds': (False, False),
                 'young': (False, False), 'dry': (False, False), 'fruit': (False, True)}
BETEL_SUBPARTS = {'trunk': (True, True), 'rings': (True, True), 'shaft': (True, True), 'fronds': (False, False),
                  'young': (False, False)}


def bent_center(height, lean_base, lean_top, bow=0.0):
    """樹幹中心線：與鉛直的夾角由 lean_base（底）線性變到 lean_top（頂），單位度；bow 另加一點 S 形。
    椰子實際長法是基部斜、往上長回鉛直（向光性），所以 lean_base>lean_top。"""
    N = 64
    pts = [(0.0, 0.0)]
    x = z = 0.0
    for i in range(N):
        t = (i + .5) / N
        ang = rad(lean_base + (lean_top - lean_base) * t + bow * math.sin(math.pi * t * 2))
        x += height / N * math.sin(ang)
        z += height / N * math.cos(ang)
        pts.append((x, z))

    def c(t):
        u = max(0.0, min(1.0, t)) * N
        i = min(N - 1, int(u))
        f = u - i
        return (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f)
    return c


def ring_ts(n_rings, t_start, t_end, band, extra):
    """環紋切段：n_rings 條深色細帶平均分布在 [t_start,t_end]，band＝帶寬（t 單位）；extra＝另外要切的 t
    （彎幹需要多切幾段才看得出弧度）。回傳排序後的 ts 與「哪些區間是環紋」。"""
    bands = []
    for k in range(n_rings):
        c = t_start + (t_end - t_start) * (k + .5) / n_rings
        bands.append((c - band / 2, c + band / 2))
    ts = sorted(set([0.0, 1.0] + [round(b, 6) for bb in bands for b in bb] + [round(e, 6) for e in extra]))
    return ts, bands


def in_band(bands):
    return lambda ta, tb: 'rings' if any(b0 - 1e-9 <= (ta + tb) / 2 <= b1 + 1e-9 for b0, b1 in bands) else 'trunk'


def build_coco(cfg):
    parts = new_parts(COCO_SUBPARTS)
    H = cfg['trunk_h']
    center = bent_center(H, cfg['lean_base'], cfg['lean_top'], cfg.get('bow', 0.0))
    r_base, r_mid, r_top = cfg['r_base'], cfg['r_mid'], cfg['r_top']

    def radius(t):
        r = r_mid + (r_top - r_mid) * t
        if t < .1:  # 根部較粗：底部 10% 往外擴
            r += (r_base - r_mid) * (1 - t / .1) ** 2
        return r
    ts, bands = ring_ts(cfg['rings'], .12, .96, .016, [.03, .06])
    tube(parts, in_band(bands), center, radius, ts, cfg['sides'])
    top = center(1.0)
    # 樹冠基部（葉柄基部那一團，往上張開），鉛直；底面半徑略小於幹頂，藏住幹頂封口。
    kb = (top[0], 0.0, top[1] - .02)
    frustum(parts['knob'], kb, r_top * .95, r_top * 1.75, cfg['knob_h'], 6)
    hub = (top[0], 0.0, top[1] - .02 + cfg['knob_h'])
    L = cfg['L']
    fronds_meta = []
    # 葉片方位：總數 cfg['n'] 片平均分在 360°，每片加一點決定性的偏移（不是亂數：用黃金角的小數部分），
    # 再依序分給上中下三層，讓每一層都繞一整圈、不會某一側全是同一層。
    n = cfg['n']
    tiers = cfg['tiers']  # [(名稱, 子零件, base 角, tip 角, t1, 長度倍率, 掛點高差, 寬度倍率), ...]
    order = cfg['tier_order']
    for j in range(n):
        az = rad(cfg['az0'] + 360.0 * j / n + 5.0 * math.sin(j * 2.399963))
        name, sub, th0, thtip, t1, lf, dh, wf = tiers[order[j % len(order)]]
        A = (hub[0] + .06 * math.cos(az), .06 * math.sin(az), hub[2] + dh)
        fm = frond(parts[sub], A, az, L * lf, cfg['seg'], arch(th0, thtip, t1), cfg['wmax'] * L * lf * wf,
                   cfg['drape'][0], cfg['drape'][1])
        fm.update(tier=name, th0=th0)
        fronds_meta.append(fm)
    # 中央未展開的新葉（spear）：細長、幾乎直立。
    spear = frond(parts['young'], (hub[0], 0.0, hub[2] + .03), rad(cfg['az0'] + 11), L * .42, 4,
                  arch(82, 10, .8), .035, 20, 30, t_leaf=0.0, w_floor=.02, fwd=.2)
    # 乾掉下垂的褐葉：從樹冠基部往下掛，貼著樹幹側邊。
    dry_meta = []
    for k, (daz, dl) in enumerate(cfg['dry']):
        az = rad(daz)
        A = (hub[0] + .05 * math.cos(az), .05 * math.sin(az), hub[2] - .06)
        dm = frond(parts['dry'], A, az, L * dl, 8, lambda t: -38 - 44 * t, .16 * L * dl, 38, 62, t_leaf=.08)
        dry_meta.append(dm)
    # 椰子果：兩串掛在樹冠基部正下方（葉柄之間），略長的橢圓。
    fruit_centers = []
    for bunch_az, cnt in cfg['fruit']:
        for q in range(cnt):
            a = rad(bunch_az + (q - (cnt - 1) / 2) * 34)
            rr = r_top * 1.25 + .035
            zz = hub[2] - .10 - .05 * (q % 2)
            c = (hub[0] + rr * math.cos(a), rr * math.sin(a), zz)
            ico(parts['fruit'], c, cfg['fruit_r'], 1.18)
            fruit_centers.append(c)
    return parts, {'hub': hub, 'fronds': fronds_meta, 'spear': spear, 'dry': dry_meta, 'fruit': fruit_centers,
                   'trunk_top': top}


def build_betel(cfg):
    parts = new_parts(BETEL_SUBPARTS)
    H = cfg['trunk_h']
    center = bent_center(H, cfg['lean'], cfg['lean'])
    r0, r1 = cfg['r_base'], cfg['r_top']
    # 帶寬 .018（約 9 cm）：第 2 輪場景截圖裡 .03 的粗帶讀起來像斑馬紋／白樺，改細讓它讀成「環紋」。
    ts, bands = ring_ts(cfg['rings'], .05, .97, .018, [])
    tube(parts, in_band(bands), center, lambda t: r0 + (r1 - r0) * t, ts, cfg['sides'])
    top = center(1.0)
    # 葉鞘（crownshaft）：幹頂一段光滑亮綠、略鼓的圓柱，是檳榔最好認的特徵。
    sh = cfg['shaft_h']
    c = (top[0], 0.0, top[1] - .01)
    lathe(parts['shaft'], c, [(0, r1 * 1.08), (sh * .35, r1 * 1.42), (sh * .8, r1 * 1.3), (sh, r1 * 1.02)], cfg['sides'])
    hub = (top[0], 0.0, top[1] - .01 + sh)
    L = cfg['L']
    fronds_meta = []
    n = cfg['n']
    for j in range(n):
        az = rad(cfg['az0'] + 360.0 * j / n + 9.0 * math.sin(j * 2.399963))
        th0, thtip, t1, lf = cfg['fronds'][j % len(cfg['fronds'])]
        A = (hub[0] + .03 * math.cos(az), .03 * math.sin(az), hub[2] - .02)
        fm = frond(parts['fronds'], A, az, L * lf, cfg['seg'], arch(th0, thtip, t1), cfg['wmax'] * L * lf,
                   cfg['drape'][0], cfg['drape'][1], t_leaf=.12, fwd=.35)
        fm.update(th0=th0)
        fronds_meta.append(fm)
    spear = frond(parts['young'], (hub[0], 0.0, hub[2]), rad(cfg['az0']), L * .45, 3, arch(84, 6, .85), .03, 15, 25,
                  t_leaf=0.0, w_floor=.018, fwd=.2)
    return parts, {'hub': hub, 'fronds': fronds_meta, 'spear': spear, 'trunk_top': top}


# 三款椰子：直幹（輕微傾斜）、彎幹 A（香蕉形）、彎幹 B（基部斜得更多、頂端長回鉛直）。
# 樹冠：一圈 13～15 片成熟葉分三層（上層 38～40°、中層 28～32°、下層 18～22°，都是「先往上揚」），
# 外側 35～40% 才轉下垂；另有中央新葉、一兩片乾褐葉、兩串椰子果。
# 乾葉長度倍率 .52～.6（第 2 輪由 .7～.82 縮短）：整個樹冠側面輪廓（含乾葉）的寬÷高原本 1.56～1.61，
# 貼著派工訂的 1.6～2.2 下緣；乾葉少垂一點讓它落在範圍中段，綠色樹冠本身不動。
COCO_TIERS = {
    'upper': ('upper', 'young', 46, 58, .64, .84, .10, .9),
    'mid': ('mid', 'fronds', 32, 96, .62, 1.0, .05, 1.0),
    'low': ('low', 'fronds', 20, 104, .60, 1.0, .0, 1.0),
}
COCO_BASE = dict(L=1.28, seg=12, wmax=.2, drape=(28, 64), sides=7, r_base=.19, r_mid=.105, r_top=.085, knob_h=.13)
COCO_MODELS = {
    'coco-straight': dict(COCO_BASE, trunk_h=2.3, lean_base=6, lean_top=3, rings=9, n=14, az0=8,
                          tiers=[COCO_TIERS['upper'], COCO_TIERS['mid'], COCO_TIERS['low']], tier_order=[1, 2, 0, 2, 1, 2, 1],
                          dry=[(200, .6)], fruit=[(150, 3), (330, 2)], fruit_r=.068),
    'coco-curved-a': dict(COCO_BASE, trunk_h=2.42, lean_base=24, lean_top=6, rings=9, n=15, az0=-12,
                          tiers=[COCO_TIERS['upper'], COCO_TIERS['mid'], COCO_TIERS['low']], tier_order=[1, 2, 0, 1, 2],
                          dry=[(170, .6), (235, .52)], fruit=[(120, 2), (300, 2)], fruit_r=.066),
    'coco-curved-b': dict(COCO_BASE, trunk_h=2.5, lean_base=34, lean_top=0, bow=-3, rings=10, n=13, az0=20,
                          tiers=[COCO_TIERS['upper'], COCO_TIERS['mid'], COCO_TIERS['low']], tier_order=[2, 1, 0, 1, 2, 1],
                          dry=[(190, .6)], fruit=[(80, 3), (260, 3)], fruit_r=.066),
}
# 兩款檳榔：細直灰白幹＋明顯環節＋亮綠葉鞘＋8～9 片較挺、向上散開的羽狀葉。
# 葉片起始仰角 60～78°、外側只垂 34～58°（第 2 輪由 50～70°／40～72° 調陡）：場景截圖裡檳榔樹冠跟椰子一樣
# 是扁的「傘」，側面樹冠垂直厚度只有直徑的 .24；調陡後是向上散開的羽毛撢形，跟椰子的噴泉形分得開。
BETEL_BASE = dict(seg=10, wmax=.2, drape=(30, 60), sides=6, r_base=.062, r_top=.05)
BETEL_MODELS = {
    'betel-a': dict(BETEL_BASE, trunk_h=2.25, lean=0, rings=8, shaft_h=.44, L=1.15, n=8, az0=15,
                    fronds=[(78, 34, .74, .88), (66, 50, .7, 1.0), (72, 42, .72, .94), (60, 58, .68, 1.0)]),
    'betel-b': dict(BETEL_BASE, trunk_h=2.4, lean=2.5, rings=8, shaft_h=.4, L=1.1, n=9, az0=-25,
                    fronds=[(74, 38, .72, .93), (60, 56, .68, 1.0), (68, 48, .7, .97)]),
}

models = {}
shape_meta = {}
for name, cfg in COCO_MODELS.items():
    models[name], shape_meta[name] = build_coco(cfg)
for name, cfg in BETEL_MODELS.items():
    models[name], shape_meta[name] = build_betel(cfg)

# ------------------------------------------------------------------ 建成 Blender 物件（.blend 供檢視；匯出用局部座標）

bpy.ops.wm.read_factory_settings(use_empty=True)
col = bpy.data.collections.new('palms-v3')
bpy.context.scene.collection.children.link(col)
PREVIEW = {'trunk': 'b5ab98', 'rings': '6b604f', 'knob': '7d6d4a', 'fronds': '6f8f3c', 'young': '86a24a', 'dry': '9a7b4f',
           'fruit': '8f6a34', 'shaft': '93bf5a'}
mats = {}
for k, hx in PREVIEW.items():
    m = bpy.data.materials.new('palms_' + k)
    m.use_nodes = True
    rgb = [int(hx[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    rgb = [c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in rgb]
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
    m.diffuse_color = (*rgb, 1)
    mats[k] = m

objects = {}
for mi, (mname, parts) in enumerate(models.items()):
    for sub, part in parts.items():
        if not part.f:
            continue
        pname = f'{mname}/{sub}'
        me = bpy.data.meshes.new(pname)
        me.from_pydata(part.v, [], part.f)
        me.update()
        for poly in me.polygons:
            poly.use_smooth = part.smooth
        me.materials.append(mats[sub])
        o = bpy.data.objects.new(pname, me)
        o.location = (mi * 3.2, 0, 0)  # 只為了在 .blend 裡並排好看；匯出讀局部座標，不受影響
        col.objects.link(o)
        objects[pname] = (o, part.closed)

# ------------------------------------------------------------------ 匯出（calc_loop_triangles + corner_normals，局部座標）

raw = bytearray()
count = 0
ranges = {}
for pname, (o, closed) in objects.items():
    me = o.data
    me.calc_loop_triangles()
    start = count
    for tri in me.loop_triangles:
        for li in tri.loops:
            co = me.vertices[me.loops[li].vertex_index].co
            nm = me.corner_normals[li].vector
            if not all(math.isfinite(v) for v in (*co, *nm)):
                raise ValueError('非有限網格 ' + pname)
            raw.extend(struct.pack('<6f', co.x, co.y, co.z, nm.x, nm.y, nm.z))
            count += 1
    ranges[pname] = (start, count - start)

NEW_NAMES = list(objects.keys())
F = struct.unpack(f'<{len(raw) // 4}f', bytes(raw))


def P(v):
    return (F[v * 6], F[v * 6 + 1], F[v * 6 + 2])


def Nn(v):
    return (F[v * 6 + 3], F[v * 6 + 4], F[v * 6 + 5])


def sub3(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def cross3(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def dot3(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


fails = []
# P5：無退化三角形。
degen = sum(1 for v in range(0, count, 3) if not (math.hypot(*cross3(sub3(P(v + 1), P(v)), sub3(P(v + 2), P(v)))) / 2 > 1e-10))
if degen:
    fails.append(f'{degen} 個退化三角形')
# P6：(a) 每個三角形的面法向量與三個頂點法向量同向（平滑面用 corner normal、平面用面法向量，兩種都要成立）；
# (b) 封閉零件（樹幹＋環紋＋基部＋果＋葉鞘）以每款樹為單位的有號體積 >0（段與段之間位置相同、拓撲不連，
# 有號體積照樣是封閉殼的體積）。小葉是單面三角形（DoubleSide 材質），只驗 (a)。
bad_a = {}
for pname, (s, c) in ranges.items():
    bad = 0
    for v in range(s, s + c, 3):
        fn = cross3(sub3(P(v + 1), P(v)), sub3(P(v + 2), P(v)))
        vn = tuple(Nn(v)[k] + Nn(v + 1)[k] + Nn(v + 2)[k] for k in range(3))
        if not (dot3(fn, vn) > 0):
            bad += 1
    if bad:
        bad_a[pname] = bad
if bad_a:
    fails.append(f'P6a 法向量反向：{bad_a}')
vol = {}
for mname in models:
    tot = 0.0
    for pname, (o, closed) in objects.items():
        if not pname.startswith(mname + '/') or not closed:
            continue
        s, c = ranges[pname]
        for v in range(s, s + c, 3):
            tot += dot3(P(v), cross3(P(v + 1), P(v + 2))) / 6
    vol[mname] = tot
    if not tot > 0:
        fails.append(f'P6b {mname} 封閉零件有號體積 {tot:.3e} 不為正')

# ------------------------------------------------------------------ 三角形預算＋形狀自檢（量的是實際匯出的頂點）

report = {}
for mname in models:
    tris = sum(ranges[p][1] // 3 for p in NEW_NAMES if p.startswith(mname + '/'))
    budget = 900 if mname.startswith('coco') else 450
    allv = [P(v) for p in NEW_NAMES if p.startswith(mname + '/') for v in range(ranges[p][0], ranges[p][0] + ranges[p][1])]
    green = [P(v) for p in NEW_NAMES if p.startswith(mname + '/') and p.split('/')[1] in ('fronds', 'young')
             for v in range(ranges[p][0], ranges[p][0] + ranges[p][1])]
    crown_all = green + [P(v) for p in NEW_NAMES if p == mname + '/dry' for v in range(ranges[p][0], ranges[p][0] + ranges[p][1])]
    meta = shape_meta[mname]
    hub = meta['hub']
    top_z = max(v[2] for v in allv)
    gx = [v[0] for v in green]
    gy = [v[1] for v in green]
    gz = [v[2] for v in green]
    width = max(max(gx) - min(gx), max(gy) - min(gy))
    crown_h = max(gz) - min(gz)
    width_all = max(max(v[0] for v in crown_all) - min(v[0] for v in crown_all), max(v[1] for v in crown_all) - min(v[1] for v in crown_all))
    crown_h_all = max(v[2] for v in crown_all) - min(v[2] for v in crown_all)
    per = []
    for fm in meta['fronds']:
        zs = [p[2] for p in fm['P']]
        per.append({'th0': fm['th0'], 'rise': max(zs) - fm['A'][2], 'tipBelowTop': max(zs) - zs[-1], 'tipMinusHub': zs[-1] - hub[2],
                    'az': math.degrees(fm['az']) % 360})
    azs = sorted(p['az'] for p in per)
    gaps = [(azs[(i + 1) % len(azs)] - azs[i]) % 360 for i in range(len(azs))]
    r = {'tris': tris, 'budget': budget, 'height': round(top_z, 4), 'crownWidth': round(width, 4),
         'crownHeight': round(crown_h, 4), 'crownW/H': round(width / crown_h, 3),
         'crownW/H(含乾葉)': round(width_all / crown_h_all, 3), 'crownWidth/height': round(width / top_z, 3),
         'hubZ': round(hub[2], 4), 'frondCount': len(per), 'maxAzGap': round(max(gaps), 2),
         'allRise': all(p['rise'] > 0 for p in per), 'minRise': round(min(p['rise'] for p in per), 4),
         'tipBelowTopMin': round(min(p['tipBelowTop'] for p in per), 4),
         'tipMinusHubRange': [round(min(p['tipMinusHub'] for p in per), 4), round(max(p['tipMinusHub'] for p in per), 4)],
         'th0Range': [min(p['th0'] for p in per), max(p['th0'] for p in per)]}
    if mname.startswith('coco'):
        fr = meta['fruit']
        r['fruit'] = len(fr)
        r['fruitBelowHub'] = all(c[2] < hub[2] for c in fr)
        r['fruitMaxHoriz'] = round(max(math.hypot(c[0] - hub[0], c[1] - hub[1]) for c in fr), 4)
    else:
        shaft = [P(v) for v in range(ranges[mname + '/shaft'][0], sum(ranges[mname + '/shaft']))]
        r['shaftLen'] = round(max(v[2] for v in shaft) - min(v[2] for v in shaft), 4)
    report[mname] = r
    if tris > budget:
        fails.append(f'{mname} 三角形 {tris} 超過 {budget}')
    if mname.startswith('coco') and r['maxAzGap'] > 40:  # 40° 是椰子的判準（檳榔 7～10 片，平均空隙本來就 36～51°）
        fails.append(f'{mname} 相鄰葉片方位空隙 {r["maxAzGap"]}° > 40°')
    if not r['allRise']:
        fails.append(f'{mname} 有葉片沒有先往上揚')

for k, v in report.items():
    note(f'{k}: {json.dumps(v, ensure_ascii=False)}')
(BUILD_DIR / 'shape-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
if fails:
    for f_ in fails:
        note('自檢失敗：' + f_)
    sys.exit('自檢失敗：' + '；'.join(fails))
note('自檢全過：P5 無退化、P6a 法向量同向、P6b 封閉體積為正 ' + json.dumps({k: round(v, 5) for k, v in vol.items()}))

# ------------------------------------------------------------------ 合併安裝：新棕櫚零件＋既有闊葉樹零件（原始 bytes 不動）

old_meta = json.loads((ASSET_DIR / 'palms.json').read_text(encoding='utf-8'))
old_raw = gzip.decompress((ASSET_DIR / 'palms.bin.gz').read_bytes())
old_parts = {q['name']: q for q in old_meta['parts']}
missing = [k for k in KEEP if k not in old_parts]
if missing:
    sys.exit(f'現有正式資產缺闊葉樹零件 {missing}：先跑 scripts/blender/coast-20260928/build_coast_flora.py')
keep_sha = {}
out = bytearray(raw)
part_list = [{'name': n, 'start': ranges[n][0], 'count': ranges[n][1], 'pivot': [0, 0, 0]} for n in NEW_NAMES]
for k in KEEP:
    q = old_parts[k]
    chunk = old_raw[q['start'] * 24:(q['start'] + q['count']) * 24]
    keep_sha[k] = hashlib.sha256(chunk).hexdigest()
    part_list.append({'name': k, 'start': len(out) // 24, 'count': q['count'], 'pivot': q.get('pivot', [0, 0, 0])})
    out.extend(chunk)
out_bytes = bytes(out)
vertex_count = len(out_bytes) // 24
sha256 = hashlib.sha256(out_bytes).hexdigest()
asset = {
    'schema': 'garage-parts-v1', 'id': 'palms', 'kind': 'palms', 'units': 'model',
    'mesh': {'file': 'palms.bin.gz', 'sha256': sha256, 'encoding': 'float32-le', 'strideBytes': 24,
             'vertexCount': vertex_count, 'triangleCount': vertex_count // 3, 'compression': 'gzip'},
    'parts': part_list,
}
(BUILD_DIR / 'palms.raw.bin').write_bytes(out_bytes)
(BUILD_DIR / 'palms.meta.json').write_text(json.dumps(asset, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(BUILD_DIR / 'palms.blend'))
(ASSET_DIR / 'palms.bin.gz').write_bytes(gzip.compress(out_bytes, compresslevel=9, mtime=0))
(ASSET_DIR / 'palms.json').write_text(json.dumps(asset, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
# 寫完讀回來再比一次闊葉樹那 4 段（確認搬運前後逐 byte 相同）。
chk_raw = gzip.decompress((ASSET_DIR / 'palms.bin.gz').read_bytes())
chk_parts = {q['name']: q for q in json.loads((ASSET_DIR / 'palms.json').read_text(encoding='utf-8'))['parts']}
for k in KEEP:
    q = chk_parts[k]
    if hashlib.sha256(chk_raw[q['start'] * 24:(q['start'] + q['count']) * 24]).hexdigest() != keep_sha[k]:
        sys.exit(f'闊葉樹零件 {k} 搬運後 bytes 不同')
note('闊葉樹 4 段搬運前後 sha256 相同：' + json.dumps({k: v[:16] for k, v in keep_sha.items()}))
print('GD_PALMS_V3_BUILD_OK', json.dumps({'vertexCount': vertex_count, 'sha256': sha256, 'report': report}, ensure_ascii=False))
