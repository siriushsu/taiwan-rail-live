"""車體共用零件：半斷面輪廓、側牆分格（窗／門／色帶）、車頂、折棚、車端、轉向架、車下設備、集電弓。

側牆不用「整圈放樣＋格子上色」（每個窗緣都會把整圈斷面切一刀，三角形太多），而是把牆面拆成
垂直分條（x 方向），每條只在自己需要的高度切開；同色相鄰區間合併成一個四邊形。
窗、門線一律「共面切割」而非貼花，避免重播頁（正交相機、far=50000、24 位元深度約 3 mm）的 z-fighting。
"""
import math, bisect
import numpy as np
from kit import (C, mixc, shade, Mesh, box, hbox, cyl, rod, prism_xz, prism_yz, fan, loft, unit, cross, sub, dot, length, mul, add)

GLASS = C('#18232c')
DARK = C('#2b2f33')
UNDER = C('#2f3336')
EQUIP = C('#50565b')
WHEEL = C('#3a3e42')
FRAME = C('#42474c')
BELLOWS = C('#33373b')


# ---------------------------------------------------------------- 半斷面輪廓
class Profile:
    """左半斷面（y>=0）由車底邊往上到車頂中線的分段直線；P[k]=(y,z)，S[k]=第 k 段 (P[k]→P[k+1]) 的種類。
    種類：'cham'（車底倒角）、'wall'（側牆）、'roof'（車頂弧）。"""

    def __init__(self, hw, zb, z_sh, z_c, inset=0.10, cham=0.10, z_belt=None, K=6, expo=2.5, pieces=2):
        self.hw, self.zb, self.z_sh, self.z_c = hw, zb, z_sh, z_c
        z_belt = z_belt if z_belt is not None else zb + 0.9
        P = [(hw - cham, zb), (hw, zb + cham), (hw, z_belt)]
        S = ['cham', 'wall']
        for k in range(1, pieces + 1):
            t = k / pieces
            P.append((hw - inset * t * t, z_belt + (z_sh - z_belt) * t))
            S.append('wall')
        ysh = hw - inset
        for k in range(1, K + 1):
            th = math.pi / 2 * k / K
            c, s = math.cos(th), math.sin(th)
            P.append((ysh * math.copysign(abs(c) ** (2 / expo), c), z_sh + (z_c - z_sh) * s ** (2 / expo)))
            S.append('roof')
        self.P, self.S = P, S
        self.z_belt = z_belt
        self.n_wall_end = 2 + pieces  # 最後一個牆節點索引（肩線）
        segn = []
        for k in range(len(P) - 1):
            dy, dz = P[k + 1][0] - P[k][0], P[k + 1][1] - P[k][1]
            l = math.hypot(dy, dz)
            segn.append((dz / l, -dy / l))
        self.segn = segn
        cs = math.cos(math.radians(32))
        self.nn = []  # nn[k] = (給前一段用的法線, 給後一段用的法線)
        for k in range(len(P)):
            a = segn[k - 1] if k > 0 else segn[0]
            b = segn[k] if k < len(segn) else segn[-1]
            if a[0] * b[0] + a[1] * b[1] >= cs:
                v = (a[0] + b[0], a[1] + b[1]); l = math.hypot(*v); v = (v[0] / l, v[1] / l)
                self.nn.append((v, v))
            else:
                self.nn.append((a, b))
        self.nn[-1] = ((0.0, 1.0), (0.0, 1.0))

    def ring(self, subdiv=1):
        """全圈節點 (N,2) 與各段 (kind, side, z0, z1)。從左下角上行、過頂、右側下行、以車底板封閉。"""
        left, segs = [], []
        for k in range(len(self.P) - 1):
            (ya, za), (yb, zb) = self.P[k], self.P[k + 1]
            for i in range(subdiv):
                t0, t1 = i / subdiv, (i + 1) / subdiv
                left.append((ya + (yb - ya) * t0, za + (zb - za) * t0))
                segs.append((self.S[k], 'L', za + (zb - za) * t0, za + (zb - za) * t1))
        left.append(self.P[-1])
        ring = list(left)
        kinds = list(segs)
        for k in range(len(left) - 2, -1, -1):
            ring.append((-left[k][0], left[k][1]))
        for (kind, side, z0, z1) in reversed(segs):
            kinds.append((kind, 'R' if kind != 'roof' else 'roof', z0, z1))
        kinds.append(('floor', 'F', self.zb, self.zb))
        return np.array(ring, float), kinds

    def roof_nodes(self):
        """左肩 → 頂 → 右肩 的車頂節點 (y,z)。"""
        left = self.P[self.n_wall_end:]
        return left + [(-y, z) for (y, z) in reversed(left[:-1])]


# ---------------------------------------------------------------- 側牆分格
class Band:
    """牆面塗裝色：bands=[(z0,z1,color[,gloss])]，範圍外用 default。"""

    def __init__(self, bands, default, g=0.25):
        self.bands = [(b[0], b[1], b[2], b[3] if len(b) > 3 else g) for b in bands]
        self.default, self.g = default, g
        self.edges = sorted({b[0] for b in self.bands} | {b[1] for b in self.bands})

    def at(self, z):
        for z0, z1, c, g in self.bands:
            if z0 <= z < z1:
                return c, g
        return self.default, self.g


class Layout:
    """kinds[name]=[(zlo,zhi,col,g),...]：該 kind 的分條中，這些高度區間改用指定色，其餘沿用 band。
    segs['L'|'R']=[(x0,x1,kindname),...]（互不重疊），未涵蓋處視為 'wall'。"""

    def __init__(self, band, kinds, segs_L, segs_R=None):
        self.band, self.kinds = band, kinds
        self.segs = {'L': sorted(segs_L), 'R': sorted(segs_R if segs_R is not None else segs_L)}
        self._st = {s: [a[0] for a in v] for s, v in self.segs.items()}

    def kind_at(self, side, x):
        v, st = self.segs[side], self._st[side]
        i = bisect.bisect_right(st, x) - 1
        if i >= 0 and v[i][0] <= x < v[i][1]:
            return v[i][2]
        return 'wall'

    def xs(self, side):
        out = set()
        for a, b, _ in self.segs[side]:
            out.add(round(a, 4)); out.add(round(b, 4))
        return out

    def _list(self, kind):
        if isinstance(kind, tuple):
            out = []
            for k in kind:
                out += self.kinds.get(k, [])
            return out
        return self.kinds.get(kind, [])

    def zsplits(self, kind):
        out = set(self.band.edges)
        for z0, z1, _, _ in self._list(kind):
            out.add(z0); out.add(z1)
        return out

    def color(self, kind, zm):
        for z0, z1, c, g in self._list(kind):
            if z0 <= zm < z1:
                return c, g
        return self.band.at(zm)


def resolve(elems):
    """elems=[(x0,x1,kind),...] 可互相重疊：同一區段被多個 kind 覆蓋時合成 tuple（先列者優先）。"""
    xs = sorted({round(e[0], 4) for e in elems} | {round(e[1], 4) for e in elems})
    out = []
    for a, b in zip(xs[:-1], xs[1:]):
        mid = (a + b) / 2
        ks = []
        for (x0, x1, k) in elems:
            if x0 <= mid < x1:
                ks += list(k) if isinstance(k, tuple) else [k]
        ks = tuple(dict.fromkeys(ks))
        if not ks:
            continue
        k = ks if len(ks) > 1 else ks[0]
        if out and out[-1][1] == a and out[-1][2] == k:
            out[-1] = (out[-1][0], b, k)
        else:
            out.append((a, b, k))
    return out


def wall_panels(m, prof, side, x0, x1, layout):
    """在 [x0,x1] 內建一側側牆（分條＋高度切割）。side='L'（+y）或 'R'（-y）。"""
    m.tag = 'wall'
    sg = 1.0 if side == 'L' else -1.0
    xs = sorted({round(x0, 4), round(x1, 4)} | {x for x in layout.xs(side) if x0 < x < x1})
    for xa, xb in zip(xs[:-1], xs[1:]):
        if xb - xa < 1e-6:
            continue
        kind = layout.kind_at(side, (xa + xb) / 2)
        splits = layout.zsplits(kind)
        for k in range(len(prof.P) - 1):
            if prof.S[k] == 'roof':
                continue
            (ya, za), (yb, zb) = prof.P[k], prof.P[k + 1]
            zs = sorted({za, zb} | {z for z in splits if za < z < zb})
            n0, n1 = prof.nn[k][1], prof.nn[k + 1][0]
            for z0, z1 in zip(zs[:-1], zs[1:]):
                if z1 - z0 < 1e-6:
                    continue
                col, g = layout.color(kind, (z0 + z1) / 2)
                t0, t1 = (z0 - za) / (zb - za), (z1 - za) / (zb - za)
                y0, y1 = ya + (yb - ya) * t0, ya + (yb - ya) * t1
                na = (n0[0] + (n1[0] - n0[0]) * t0, n0[1] + (n1[1] - n0[1]) * t0)
                nb = (n0[0] + (n1[0] - n0[0]) * t1, n0[1] + (n1[1] - n0[1]) * t1)
                pa, pb, pc, pd = (xa, sg * y0, z0), (xb, sg * y0, z0), (xb, sg * y1, z1), (xa, sg * y1, z1)
                la, lb = (0.0, sg * na[0], na[1]), (0.0, sg * nb[0], nb[1])
                m.quad(pa, pb, pc, pd, la, la, lb, lb, col, g)


def roof_loft(m, prof, x0, x1, col, g=0.3, xs=None):
    """車頂：左肩→頂→右肩的開放放樣。"""
    m.tag = 'roof'
    nodes = prof.roof_nodes()
    stations = sorted({x0, x1} | set(xs or []))
    P = [[(x, y, z) for (y, z) in nodes] for x in stations]
    loft(m, P, lambda i, j: (col, g), closed=False, smooth=60)


def floor_plate(m, prof, x0, x1, col):
    m.tag = 'wall'
    zb = prof.zb
    y = prof.P[0][0]
    n = (0, 0, -1)
    m.quad((x0, -y, zb), (x1, -y, zb), (x1, y, zb), (x0, y, zb), n, n, n, n, col, 0.1)


def end_cap(m, ring, x, sign, col, g=0.2):
    m.tag = 'wall'
    pts = [(x, float(y), float(z)) for y, z in ring]
    fan(m, pts, (float(sign), 0.0, 0.0), col, g)


# ---------------------------------------------------------------- 折棚
def bellows(m, x_end, sign, half=0.35, w=2.0, z0=1.05, z1=3.10, col=BELLOWS, pleats=2, lod=0, expo=5.0):
    """半個貫通道折棚：自車端 x_end 朝 sign 方向伸出 half 公尺（兩車對接時兩半連成完整折棚）。"""
    m.tag = 'bellows'
    cz, a, b = (z0 + z1) / 2, w / 2, (z1 - z0) / 2
    n = 16 if lod == 0 else 8
    steps = pleats * 2 if lod == 0 else 1
    P = []
    for s in range(steps + 1):
        t = s / steps
        x = x_end + sign * half * t
        k = (1.0 - 0.045 * (s % 2)) if lod == 0 else 1.0
        ring = []
        for j in range(n):
            th = 2 * math.pi * j / n
            c, sn = math.cos(th), math.sin(th)
            ring.append((x, a * k * math.copysign(abs(c) ** (2 / expo), c), cz + b * k * math.copysign(abs(sn) ** (2 / expo), sn)))
        P.append(ring)
    loft(m, P, lambda i, j: (col, 0.1), smooth=70)
    if lod == 0:  # 車端連接框
        fr = shade(col, 1.3)
        ring0 = P[0]
        P2 = [[(x_end, y * 1.06, cz + (z - cz) * 1.06) for (_, y, z) in ring0], [(x_end + sign * 0.05, y * 1.06, cz + (z - cz) * 1.06) for (_, y, z) in ring0]]
        loft(m, P2, lambda i, j: (fr, 0.2), smooth=70)


# ---------------------------------------------------------------- 轉向架與車下
def bogie(m, x, r=0.43, wb=2.5, y_wheel=0.56, lod=0, motor=True, axles=2):
    """轉向架：輪組（含車軸）、側樑、橫樑、空氣彈簧、馬達與齒輪箱。x=轉向架中心，wb=軸距（相鄰車軸間距）。
    lod>=1 只留簡化的框與輪。"""
    m.tag = 'bogie'
    xs = [x + (i - (axles - 1) / 2) * wb for i in range(axles)]
    span = (axles - 1) * wb
    if lod >= 1:
        box(m, (x, 0, r + 0.30), (span + 0.5, 1.75, 0.26), FRAME)
        for xx in xs:
            for s in (-1, 1):
                box(m, (xx, s * y_wheel, r), (r * 1.9, 0.13, r * 1.9), WHEEL)
        return
    seg = 14
    for xx in xs:
        for s in (-1, 1):
            cyl(m, (xx, s * y_wheel, r), 'y', r, 0.13, WHEEL, seg=seg, g=0.3)
            cyl(m, (xx, s * (y_wheel + 0.075), r), 'y', r * 0.32, 0.05, FRAME, seg=8, g=0.5)
        cyl(m, (xx, 0, r), 'y', 0.06, 2 * y_wheel - 0.1, FRAME, seg=6, g=0.3, caps=False)
        for s in (-1, 1):
            box(m, (xx, s * (y_wheel + 0.20), r + 0.03), (0.24, 0.13, 0.22), FRAME)       # 軸箱
            cyl(m, (xx, s * 0.86, r + 0.34), 'z', 0.085, 0.24, EQUIP, seg=8, g=0.2)       # 軸箭彈簧
    for s in (-1, 1):
        box(m, (x, s * 0.86, r + 0.22), (span + 0.30, 0.13, 0.18), FRAME)                 # 側樑
        cyl(m, (x, s * 0.72, r + 0.62), 'z', 0.30, 0.16, EQUIP, seg=12, g=0.2)            # 空氣彈簧
    box(m, (x, 0, r + 0.28), (0.40, 1.60, 0.22), FRAME)                                     # 橫樑
    box(m, (x, 0, r + 0.60), (0.60, 0.50, 0.12), FRAME)                                     # 搖枕
    if motor:
        for xx in xs:
            box(m, (xx - 0.14, 0, r + 0.06), (0.44, 0.78, 0.36), EQUIP)
            cyl(m, (xx - 0.14, 0, r + 0.06), 'y', 0.13, 0.92, FRAME, seg=8, g=0.3, caps=True)


def belly(m, x0, x1, zb, W, lod=0, items=None, skirt_w=None, zlow=0.52):
    """車下：中央底盒（裙板）與兩側下緣細條、車下設備盒（items=[(xc,len,zlow,zhigh,halfw)]）。"""
    m.tag = 'belly'
    L = x1 - x0
    sw = skirt_w if skirt_w is not None else W - 0.30
    box(m, ((x0 + x1) / 2, 0, (zb + zlow + 0.06) / 2), (L, sw, zb - zlow - 0.06 + 0.02), UNDER)
    if lod >= 1:
        return
    for xc, ln, zl, zh, hw in (items or []):
        box(m, (xc, 0, (zl + zh) / 2), (ln, hw * 2, zh - zl), EQUIP)
    for s in (-1, 1):
        box(m, ((x0 + x1) / 2, s * (sw / 2 - 0.02), zlow + 0.07), (L * 0.98, 0.05, 0.12), FRAME)


# ---------------------------------------------------------------- 車頂設備
def roof_unit(m, cx, cy, zbase, L, Wd, H, col, top=None, bevel=0.18, g=0.3, vent=True):
    """車頂冷氣機／設備罩：上緣斜切的長盒；vent=True 時頂面加兩道散熱格（深色細盒）。"""
    m.tag = 'roof'
    hbox(m, cx, cy, zbase, L, Wd, H, bevel, bevel * 0.8, col, g, top_col=top)
    if vent:
        for dx in (-L * 0.22, L * 0.22):
            box(m, (cx + dx, cy, zbase + H - 0.005), (L * 0.28, Wd * 0.62, 0.02), shade(col, 0.62))


def pantograph(m, x, z_roof, lod=0, hfold=0.47, width=1.85, col=DARK, ins=C('#b58a52'), facing=1, base_w=1.30):
    """降弓（折疊）的單臂受電弓：底板、四顆礙子、下臂、上臂（折回）、集電滑板。
    hfold＝折疊後最高點距車頂的高度（各車型由實車全高反推）；facing=+1 弓頭（滑板）朝 +X。"""
    m.tag = 'panto'
    f = facing
    k = hfold / 0.47  # 垂直方向的比例（以 EMU3000 的 0.47 m 為基準）
    zr = lambda d: z_roof + d * k
    box(m, (x, 0, zr(0.025)), (1.7, base_w, 0.05 * k), col)
    if lod >= 1:
        box(m, (x, 0, zr(0.30)), (0.9, 1.6, 0.30 * k), col)
        return
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(m, (x + sx * 0.55, sy * 0.50, zr(0.13)), 'z', 0.06, 0.16 * k, ins, seg=8, g=0.35)
    box(m, (x, 0, zr(0.21)), (1.30, base_w - 0.05, 0.05 * k), col)
    a, b, c = (x - f * 0.60, 0.0, zr(0.27)), (x + f * 0.50, 0.0, zr(0.33)), (x - f * 0.40, 0.0, zr(0.41))
    for dy in (-0.10, 0.10):
        rod(m, (a[0], dy, a[2]), (b[0], dy, b[2]), 0.030, col, seg=5)
        rod(m, (b[0], dy, b[2]), (c[0], dy, c[2]), 0.028, col, seg=5)
    cyl(m, (b[0], 0, b[2]), 'y', 0.055, 0.26, col, seg=6)
    box(m, (c[0], 0, c[2] + 0.03 * k), (0.12, width, 0.045 * k), C('#6b7176'))
    for sy in (-1, 1):
        box(m, (c[0], sy * (width / 2 - 0.02), c[2] - 0.02 * k), (0.05, 0.04, 0.12 * k), col)
