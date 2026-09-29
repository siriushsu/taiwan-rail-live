"""台南重播列車網格產生器：幾何工具箱（純 Python＋numpy，不依賴 Blender）。

輸出格式與重播頁的 vendor/mesh.js 一致：非索引三角形，每頂點 10 個 float32 小端
[x,y,z, nx,ny,nz, r,g,b(sRGB), gloss]。座標：+X 車頭、+Y 左側、+Z 向上，單位公尺，z=0 為鋼軌面。
"""
import math, hashlib
from array import array
import numpy as np

# ---------------------------------------------------------------- 顏色與向量
def C(h):
    h = h.lstrip('#')
    return (int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255)

def mixc(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))

def shade(c, f):
    return tuple(min(1.0, max(0.0, x * f)) for x in c)

def sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def mul(a, s): return (a[0] * s, a[1] * s, a[2] * s)
def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def length(a): return math.sqrt(dot(a, a))

def unit(a, fallback=(0.0, 0.0, 1.0)):
    l = length(a)
    return (a[0] / l, a[1] / l, a[2] / l) if l > 1e-12 else fallback


# ---------------------------------------------------------------- 網格累積器
class Mesh:
    """非索引三角形累積器。tag 用來統計各部位的三角形數（預算控管）。"""

    def __init__(self):
        self.d = array('f')
        self.tag = 'misc'
        self.counts = {}

    def vtx(self, p, n, c, g):
        self.d.extend((p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], g))

    def tri(self, p0, p1, p2, n0, n1, n2, c, g=0.2):
        self.vtx(p0, n0, c, g); self.vtx(p1, n1, c, g); self.vtx(p2, n2, c, g)
        self.counts[self.tag] = self.counts.get(self.tag, 0) + 1

    def tri_flat(self, p0, p1, p2, c, g=0.2, outward=None):
        n = unit(cross(sub(p1, p0), sub(p2, p0)))
        if outward is not None and dot(n, outward) < 0:
            n = mul(n, -1)
        self.tri(p0, p1, p2, n, n, n, c, g)

    def quad(self, a, b, c_, d, na, nb, nc, nd, col, g=0.2):
        self.tri(a, b, c_, na, nb, nc, col, g)
        self.tri(a, c_, d, na, nc, nd, col, g)

    def quad_flat(self, a, b, c_, d, col, g=0.2, outward=None):
        n = unit(cross(sub(c_, a), sub(d, b)))
        if outward is not None and dot(n, outward) < 0:
            n = mul(n, -1)
        self.quad(a, b, c_, d, n, n, n, n, col, g)

    @property
    def ntri(self):
        return len(self.d) // 30

    def merge(self, other, dx=0.0, dy=0.0, dz=0.0):
        a = np.frombuffer(other.d, dtype=np.float32).reshape(-1, 10).copy()
        a[:, 0] += dx; a[:, 1] += dy; a[:, 2] += dz
        self.d.extend(a.reshape(-1).tolist())
        for k, v in other.counts.items():
            self.counts[k] = self.counts.get(k, 0) + v


# ---------------------------------------------------------------- 基本形體
def box(m, c, size, col, g=0.2):
    """軸向對齊方盒。c=中心，size=(sx,sy,sz)。"""
    x, y, z = c
    a, b, h = size[0] / 2, size[1] / 2, size[2] / 2
    v = {(i, j, k): (x + i * a, y + j * b, z + k * h) for i in (-1, 1) for j in (-1, 1) for k in (-1, 1)}
    faces = [((1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1), (1, 0, 0)),
             ((-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1), (-1, 0, 0)),
             ((-1, 1, -1), (-1, 1, 1), (1, 1, 1), (1, 1, -1), (0, 1, 0)),
             ((-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1), (0, -1, 0)),
             ((-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1), (0, 0, 1)),
             ((-1, -1, -1), (-1, 1, -1), (1, 1, -1), (1, -1, -1), (0, 0, -1))]
    for p0, p1, p2, p3, n in faces:
        m.quad(v[p0], v[p1], v[p2], v[p3], n, n, n, n, col, g)


def _poly_area(poly):
    return 0.5 * sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))


def prism_xz(m, poly, y0, y1, col, g=0.2, caps=True, side_col=None):
    """把 (x,z) 側視多邊形沿 Y 從 y0 擠到 y1。多邊形須為凸或近凸。"""
    poly = list(poly)
    if _poly_area(poly) < 0:
        poly.reverse()
    cx = sum(p[0] for p in poly) / len(poly); cz = sum(p[1] for p in poly) / len(poly)
    n = len(poly)
    if caps:
        for y, ny in ((y1, 1.0), (y0, -1.0)):
            for i in range(n):
                a = poly[i]; b = poly[(i + 1) % n]
                m.tri((cx, y, cz), (a[0], y, a[1]), (b[0], y, b[1]), (0, ny, 0), (0, ny, 0), (0, ny, 0), col, g)
    sc = side_col or col
    for i in range(n):
        a = poly[i]; b = poly[(i + 1) % n]
        dx, dz = b[0] - a[0], b[1] - a[1]
        nn = unit((dz, 0.0, -dx))
        m.quad((a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1]), nn, nn, nn, nn, sc, g)


def prism_yz(m, poly, x0, x1, col, g=0.2, caps=True):
    """把 (y,z) 斷面多邊形沿 X 從 x0 擠到 x1。"""
    poly = list(poly)
    if _poly_area(poly) < 0:
        poly.reverse()
    cy = sum(p[0] for p in poly) / len(poly); cz = sum(p[1] for p in poly) / len(poly)
    n = len(poly)
    if caps:
        for x, nx in ((x1, 1.0), (x0, -1.0)):
            for i in range(n):
                a = poly[i]; b = poly[(i + 1) % n]
                m.tri((x, cy, cz), (x, a[0], a[1]), (x, b[0], b[1]), (nx, 0, 0), (nx, 0, 0), (nx, 0, 0), col, g)
    for i in range(n):
        a = poly[i]; b = poly[(i + 1) % n]
        dy, dz = b[0] - a[0], b[1] - a[1]
        nn = unit((0.0, dz, -dy))
        m.quad((x0, a[0], a[1]), (x0, b[0], b[1]), (x1, b[0], b[1]), (x1, a[0], a[1]), nn, nn, nn, nn, col, g)


def hbox(m, cx, cy, z0, L, W, H, bx, by, col, g=0.2, top_col=None):
    """車頂設備罩：底面 L×W、高 H，上緣做斜切（端面內縮 bx、側面內縮 by），共 9 個面。"""
    ch = min(H * 0.6, max(bx, by, 0.02))
    z1, zt = z0 + H - ch, z0 + H
    x1, x2, y1, y2 = cx - L / 2, cx + L / 2, cy - W / 2, cy + W / 2
    tc = top_col or col
    for s in (-1, 1):
        xe = cx + s * L / 2
        m.quad((xe, y1, z0), (xe, y2, z0), (xe, y2, z1), (xe, y1, z1), (s, 0, 0), (s, 0, 0), (s, 0, 0), (s, 0, 0), col, g)
        n = unit((s * ch, 0.0, bx))
        m.quad((xe, y1, z1), (xe, y2, z1), (xe - s * bx, y2 - by, zt), (xe - s * bx, y1 + by, zt), n, n, n, n, col, g)
        ye = cy + s * W / 2
        m.quad((x1, ye, z0), (x2, ye, z0), (x2, ye, z1), (x1, ye, z1), (0, s, 0), (0, s, 0), (0, s, 0), (0, s, 0), col, g)
        n = unit((0.0, s * ch, by))
        m.quad((x1, ye, z1), (x2, ye, z1), (x2 - bx, ye - s * by, zt), (x1 + bx, ye - s * by, zt), n, n, n, n, col, g)
    m.quad((x1 + bx, y1 + by, zt), (x2 - bx, y1 + by, zt), (x2 - bx, y2 - by, zt), (x1 + bx, y2 - by, zt), (0, 0, 1), (0, 0, 1), (0, 0, 1), (0, 0, 1), tc, g)


def cyl(m, c, axis, r, L, col, seg=12, g=0.2, caps=True, r2=None):
    """圓柱（可為圓錐台）。axis='x'|'y'|'z'，c=中心，L=沿軸長度。"""
    r2 = r if r2 is None else r2
    ax = {'x': (1, 0, 0), 'y': (0, 1, 0), 'z': (0, 0, 1)}[axis]
    u = {'x': (0, 1, 0), 'y': (0, 0, 1), 'z': (1, 0, 0)}[axis]
    v = cross(ax, u)
    h = L / 2
    ring = []
    for i in range(seg + 1):
        a = 2 * math.pi * i / seg
        ring.append((math.cos(a), math.sin(a)))
    for i in range(seg):
        (c0, s0), (c1, s1) = ring[i], ring[i + 1]
        n0 = add(mul(u, c0), mul(v, s0)); n1 = add(mul(u, c1), mul(v, s1))
        p = lambda cc, ss, rr, sgn: add(add(c, mul(ax, sgn * h)), add(mul(u, cc * rr), mul(v, ss * rr)))
        m.quad(p(c0, s0, r, -1), p(c1, s1, r, -1), p(c1, s1, r2, 1), p(c0, s0, r2, 1), n0, n1, n1, n0, col, g)
        if caps:
            m.tri(add(c, mul(ax, h)), p(c0, s0, r2, 1), p(c1, s1, r2, 1), ax, ax, ax, col, g)
            m.tri(add(c, mul(ax, -h)), p(c1, s1, r, -1), p(c0, s0, r, -1), mul(ax, -1), mul(ax, -1), mul(ax, -1), col, g)


def rod(m, a, b, r, col, seg=6, g=0.25):
    """任意方向細桿（受電弓臂、連桿）。"""
    d = sub(b, a)
    L = length(d)
    if L < 1e-6:
        return
    ax = mul(d, 1 / L)
    u = unit(cross(ax, (0, 0, 1)), fallback=cross(ax, (0, 1, 0)))
    v = cross(ax, u)
    for i in range(seg):
        a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
        n0 = add(mul(u, math.cos(a0)), mul(v, math.sin(a0))); n1 = add(mul(u, math.cos(a1)), mul(v, math.sin(a1)))
        m.quad(add(a, mul(n0, r)), add(a, mul(n1, r)), add(b, mul(n1, r)), add(b, mul(n0, r)), n0, n1, n1, n0, col, g)


def slab(m, a, b, width_dir, w, t, col, g=0.25):
    """沿 a→b 的扁條（寬 w 沿 width_dir、厚 t 沿第三軸），用於受電弓框。"""
    d = unit(sub(b, a))
    wd = unit(width_dir)
    nd = unit(cross(d, wd))
    hw, ht = w / 2, t / 2
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    def P(base, i, j):
        return add(base, add(mul(wd, i * hw), mul(nd, j * ht)))
    for k in range(4):
        (i0, j0), (i1, j1) = corners[k], corners[(k + 1) % 4]
        n = unit(add(mul(wd, (i0 + i1) / 2), mul(nd, (j0 + j1) / 2)))
        m.quad(P(a, i0, j0), P(a, i1, j1), P(b, i1, j1), P(b, i0, j0), n, n, n, n, col, g)
    for base, s in ((a, -1), (b, 1)):
        nn = mul(d, s)
        m.quad(P(base, -1, -1), P(base, 1, -1), P(base, 1, 1), P(base, -1, 1), nn, nn, nn, nn, col, g)


def fan(m, pts, n, col, g=0.2, center=None):
    """凸多邊形扇形填面（封蓋）。pts 為 3D 頂點序列。"""
    c = center or tuple(sum(p[i] for p in pts) / len(pts) for i in range(3))
    for i in range(len(pts)):
        m.tri(c, pts[i], pts[(i + 1) % len(pts)], n, n, n, col, g)


# ---------------------------------------------------------------- 放樣（格子上色）
def loft(m, P, colfn, closed=True, smooth=38.0):
    """P[i][j]=(x,y,z)：第 i 站、第 j 個斷面節點。colfn(i,j)->(顏色,gloss)|None，代表 i→i+1 站、j→j+1 節點那一格。
    頂點法線以面積加權平均相鄰格面法線（夾角小於 smooth 度才平滑，其餘保持銳利邊）。"""
    S = len(P); N = len(P[0]); nj = N if closed else N - 1
    fn = {}; area = {}
    sign_votes = 0
    for i in range(S - 1):
        ci = tuple(sum(P[i][k][d] for k in range(N)) / N for d in range(3))
        cj = tuple(sum(P[i + 1][k][d] for k in range(N)) / N for d in range(3))
        cen = ((ci[0] + cj[0]) / 2, (ci[1] + cj[1]) / 2, (ci[2] + cj[2]) / 2)
        for j in range(nj):
            a, b, c_, d = P[i][j], P[i][(j + 1) % N], P[i + 1][(j + 1) % N], P[i + 1][j]
            n = cross(sub(c_, a), sub(d, b))
            ar = length(n) / 2
            if ar < 1e-10:
                fn[(i, j)] = None; area[(i, j)] = 0.0
                continue
            n = mul(n, 1 / (2 * ar))
            mid = tuple((a[k] + b[k] + c_[k] + d[k]) / 4 for k in range(3))
            out = (0.0, mid[1] - cen[1], mid[2] - cen[2])
            sign_votes += 1 if dot(n, out) > 0 else -1
            fn[(i, j)] = n; area[(i, j)] = ar
    flip = -1.0 if sign_votes < 0 else 1.0
    for key in list(fn):
        if fn[key] is not None:
            fn[key] = mul(fn[key], flip)
    # 退化格借用同一站相鄰格的法線（已翻正）
    for (i, j) in list(fn):
        if fn[(i, j)] is None:
            for dj in (1, -1, 2, -2):
                o = fn.get((i, (j + dj) % nj))
                if o is not None:
                    fn[(i, j)] = o
                    break
            else:
                fn[(i, j)] = (flip, 0.0, 0.0)
    cs = math.cos(math.radians(smooth))

    def vnorm(i, j, ci, cj):
        base = fn[(ci, cj)]
        acc = [0.0, 0.0, 0.0]
        for di in (-1, 0):
            for dj in (-1, 0):
                ii, jj = i + di, j + dj
                if closed:
                    jj %= N
                elif jj < 0 or jj >= nj:
                    continue
                if ii < 0 or ii >= S - 1:
                    continue
                nn = fn.get((ii, jj))
                if nn is None:
                    continue
                if dot(nn, base) >= cs:
                    w = max(area.get((ii, jj), 0.0), 1e-9)
                    acc[0] += nn[0] * w; acc[1] += nn[1] * w; acc[2] += nn[2] * w
        return unit(tuple(acc), fallback=base)

    for i in range(S - 1):
        for j in range(nj):
            cg = colfn(i, j)
            if cg is None:
                continue
            col, g = cg
            j2 = (j + 1) % N
            a, b, c_, d = P[i][j], P[i][j2], P[i + 1][j2], P[i + 1][j]
            na, nb, nc, nd = vnorm(i, j, i, j), vnorm(i, j2, i, j), vnorm(i + 1, j2, i, j), vnorm(i + 1, j, i, j)
            if length(sub(a, c_)) + length(sub(b, d)) < 1e-9:
                continue
            # 沿較短對角線切，避免細長三角形
            if length(sub(a, c_)) <= length(sub(b, d)):
                m.tri(a, b, c_, na, nb, nc, col, g); m.tri(a, c_, d, na, nc, nd, col, g)
            else:
                m.tri(a, b, d, na, nb, nd, col, g); m.tri(b, c_, d, nb, nc, nd, col, g)


# ---------------------------------------------------------------- 單調三次曲線（車頭輪廓）
class Curve:
    """PCHIP 單調三次 Hermite，numpy 向量化。pts=[(u,v),...]，u 遞增。"""

    def __init__(self, pts):
        self.u = np.array([p[0] for p in pts], float)
        self.v = np.array([p[1] for p in pts], float)
        h = np.diff(self.u); d = np.diff(self.v) / h
        n = len(self.u)
        mk = np.zeros(n)
        for k in range(1, n - 1):
            if d[k - 1] * d[k] > 0:
                w1 = 2 * h[k] + h[k - 1]; w2 = h[k] + 2 * h[k - 1]
                mk[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k])
        mk[0] = d[0]; mk[-1] = d[-1]
        self.m = mk; self.h = h

    def __call__(self, x):
        x = np.clip(np.asarray(x, float), self.u[0], self.u[-1])
        i = np.clip(np.searchsorted(self.u, x, side='right') - 1, 0, len(self.u) - 2)
        t = (x - self.u[i]) / self.h[i]
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * self.v[i] + (t3 - 2 * t2 + t) * self.h[i] * self.m[i]
                + (-2 * t3 + 3 * t2) * self.v[i + 1] + (t3 - t2) * self.h[i] * self.m[i + 1])


# ---------------------------------------------------------------- 車頭：超橢圓形態放樣＋貼花
class Nose:
    """車頭。base 為車身斷面節點 (N,2)=(y,z)。車頭由 x0 沿 sign 方向延伸 L 到車頭尖端。
    top/bot/hw/nexp/mw 都是 u∈[0,1] 的 Curve：頂高、底高、半寬、超橢圓指數、與超橢圓的混合權重。"""

    def __init__(self, base, x0, L, sign, top, bot, hw, nexp, mw, setback=None):
        self.base = np.array(base, float)
        self.x0, self.L, self.sign = x0, L, sign
        self.top, self.bot, self.hw, self.nexp, self.mw = top, bot, hw, nexp, mw
        self.setback = setback   # 可選 (u, z)->後縮量（公尺，向車尾方向；用來做前傾擋風玻璃／後傾臉面）
        self.w0 = np.abs(self.base[:, 0]).max()
        zt, zb = self.base[:, 1].max(), self.base[:, 1].min()
        self.zc0, self.hz0 = (zt + zb) / 2, (zt - zb) / 2
        self.qy = self.base[:, 0] / self.w0
        self.qz = (self.base[:, 1] - self.zc0) / self.hz0

    def x_at(self, u):
        return self.x0 + self.sign * np.asarray(u) * self.L

    def x_pos(self, u, z):
        """含後縮（setback）的表面 x：u 站、高度 z。"""
        z = np.asarray(z, float)
        x = self.x_at(u) + np.zeros_like(z)
        if self.setback is not None:
            x = x - self.sign * self.setback(np.asarray(u, float), z)
        return x

    def rings(self, us):
        """回傳 Y,Z：(K,N)。"""
        us = np.atleast_1d(np.asarray(us, float))[:, None]
        n = self.nexp(us)
        qy, qz = self.qy[None, :], self.qz[None, :]
        r = (np.abs(qy) ** n + np.abs(qz) ** n) ** (1 / n)
        w = self.mw(us)
        ay = qy + (qy / r - qy) * w
        az = qz + (qz / r - qz) * w
        top, bot = self.top(us), self.bot(us)
        zc, hz = (top + bot) / 2, (top - bot) / 2
        return ay * self.hw(us), zc + az * hz

    def inside(self, u, ys, zs):
        Y, Z = self.rings(u)
        y2, z2 = np.roll(Y, -1, axis=1), np.roll(Z, -1, axis=1)
        zq = zs[:, None]
        cond = (Z > zq) != (z2 > zq)
        xi = Y + (zq - Z) * (y2 - Y) / (z2 - Z + 1e-30)
        return ((cond & (ys[:, None] < xi)).sum(axis=1) % 2) == 1

    def front_u(self, ys, zs, iters=26):
        ys = np.asarray(ys, float); zs = np.asarray(zs, float)
        lo = np.zeros(len(ys)); hi = np.ones(len(ys))
        ok0 = self.inside(lo, ys, zs)
        for _ in range(iters):
            mid = (lo + hi) / 2
            ins = self.inside(mid, ys, zs)
            lo = np.where(ins, mid, lo); hi = np.where(ins, hi, mid)
        u = np.where(self.inside(np.ones(len(ys)), ys, zs), 1.0, lo)
        return np.where(ok0, u, np.nan)

    def front_points(self, ys, zs, off=0.0):
        """前視 (y,z)→車頭表面點與外向法線（沿表面外推 off 公尺）。"""
        ys = np.asarray(ys, float); zs = np.asarray(zs, float)
        e = 0.03
        stack_y = np.concatenate([ys, ys + e, ys - e, ys, ys])
        stack_z = np.concatenate([zs, zs, zs, zs + e, zs - e])
        u = self.front_u(stack_y, stack_z)
        x = self.x_pos(u, stack_z)
        K = len(ys)
        x0, xyp, xym, xzp, xzm = x[:K], x[K:2 * K], x[2 * K:3 * K], x[3 * K:4 * K], x[4 * K:]
        xy = np.nan_to_num((xyp - xym) / (2 * e)); xz = np.nan_to_num((xzp - xzm) / (2 * e))
        nrm = np.stack([np.full(K, float(self.sign)), -xy * self.sign, -xz * self.sign], axis=1)
        nrm /= np.linalg.norm(nrm, axis=1)[:, None]
        pts = np.stack([x0, ys, zs], axis=1) + nrm * off
        return pts, nrm

    def side_points(self, xs, zs, side, off=0.0):
        """側視 (x,z)→車頭側面表面點（side=+1 左、-1 右）。"""
        xs = np.asarray(xs, float); zs = np.asarray(zs, float)
        e = 0.03

        def solve(xq, zq):
            u = np.clip((xq - self.x0) * self.sign / self.L, 0, 1)
            if self.setback is not None:
                for _ in range(4):
                    u = np.clip(((xq - self.x0) * self.sign + self.setback(u, zq)) / self.L, 0, 1)
            Y, Z = self.rings(u)
            y2, z2 = np.roll(Y, -1, axis=1), np.roll(Z, -1, axis=1)
            zz = zq[:, None]
            cond = ((Z - zz) * (z2 - zz) <= 0) & (Z != z2)
            t = (zz - Z) / (z2 - Z + 1e-30)
            yi = Y + t * (y2 - Y)
            yi = np.where(cond, yi * side, -1e9)
            return yi.max(axis=1) * side

        y0 = solve(xs, zs)
        yxp, yxm, yzp, yzm = solve(xs + e, zs), solve(xs - e, zs), solve(xs, zs + e), solve(xs, zs - e)
        gx = (yxp - yxm) / (2 * e); gz = (yzp - yzm) / (2 * e)
        nrm = np.stack([-gx * side, np.full(len(xs), float(side)), -gz * side], axis=1)
        nrm /= np.linalg.norm(nrm, axis=1)[:, None]
        pts = np.stack([xs, y0, zs], axis=1) + nrm * off
        return pts, nrm

    # ---- 放樣本體
    def loft_body(self, m, colfn, n_st=18, power=1.6):
        us = 1 - (1 - np.linspace(0, 1, n_st)) ** power
        Y, Z = self.rings(us)
        X = self.x_pos(us[:, None], Z)
        P = [[(float(X[i, j]), float(Y[i, j]), float(Z[i, j])) for j in range(Y.shape[1])] for i in range(len(us))]
        loft(m, P, colfn)
        return P

    def cap(self, m, col, g=0.2, bands=None):
        """車頭尖端封蓋。bands=[(z0,z1,col,g),...]：依高度切成幾片各自上色（前面上下分色用）。"""
        Y, Z = self.rings(np.array([1.0]))
        X = self.x_pos(1.0, Z[0])
        pts = [(float(X[j]), float(Y[0, j]), float(Z[0, j])) for j in range(Y.shape[1])]
        n = (float(self.sign), 0.0, 0.0)
        if not bands:
            fan(m, pts, n, col, g)
            return
        for z0, z1, c_, g_ in bands:
            poly = _clip_z(pts, z0, z1, self)
            if len(poly) >= 3:
                fan(m, poly, n, c_, g_)

    # ---- 貼花：把 2D 多邊形以 Delaunay 細分後投影到車頭表面，3D 邊長超標處自動加點
    def decal(self, m, poly, col, g=0.3, mode='front', side=1, off=0.02, h=0.12, lmax=0.22, iters=4, flip=False):
        pts2, tri = tess_polygon(poly, h)
        Pg = _shp_polygon(poly)
        for _ in range(iters):
            P3, N3 = self._project(pts2, mode, side, off)
            ok = np.isfinite(P3).all(axis=1) & (np.abs(P3) < 1e3).all(axis=1)
            good = ok[tri].all(axis=1)
            tri_g = tri[good]
            if len(tri_g) == 0:
                break
            e = np.stack([np.linalg.norm(P3[tri_g[:, a]] - P3[tri_g[:, b]], axis=1) for a, b in ((0, 1), (1, 2), (2, 0))], axis=1).max(axis=1)
            bad = e > lmax
            if not bad.any():
                break
            cen = pts2[tri_g[bad]].mean(axis=1)
            cen = cen[np.array([Pg.contains(_shp_point(c)) for c in cen])] if len(cen) else cen
            if len(cen) == 0:
                break
            pts2 = np.vstack([pts2, cen])
            tri = _delaunay_keep(pts2, Pg)
        P3, N3 = self._project(pts2, mode, side, off)
        ok = np.isfinite(P3).all(axis=1) & (np.abs(P3) < 1e3).all(axis=1)
        for t in tri[ok[tri].all(axis=1)]:
            a, b, c_ = t
            m.tri(tuple(P3[a]), tuple(P3[b]), tuple(P3[c_]), tuple(N3[a]), tuple(N3[b]), tuple(N3[c_]), col, g)

    def _project(self, pts2, mode, side, off):
        if mode == 'front':
            return self.front_points(pts2[:, 0], pts2[:, 1], off)
        return self.side_points(pts2[:, 0], pts2[:, 1], side, off)

    def decal_front(self, m, poly_yz, col, g=0.3, off=0.02, h=0.12, lmax=0.22):
        self.decal(m, poly_yz, col, g, 'front', 0, off, h, lmax)

    def decal_side(self, m, poly_xz, side, col, g=0.3, off=0.02, h=0.12, lmax=0.22):
        self.decal(m, poly_xz, col, g, 'side', side, off, h, lmax)


def _clip_z(pts, z0, z1, nose):
    """以 z0<=z<=z1 裁剪凸多邊形（Sutherland-Hodgman）；切線上的新點 x 取 nose.x_pos。"""
    def clip(poly, keep, zc):
        out = []
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            ina, inb = keep(a[2]), keep(b[2])
            if ina:
                out.append(a)
            if ina != inb:
                t = (zc - a[2]) / (b[2] - a[2])
                y = a[1] + (b[1] - a[1]) * t
                out.append((float(nose.x_pos(1.0, zc)), y, zc))
        return out
    poly = list(pts)
    if z0 is not None:
        poly = clip(poly, lambda z: z >= z0, z0)
    if z1 is not None and poly:
        poly = clip(poly, lambda z: z <= z1, z1)
    return poly


def _shp_polygon(poly):
    from shapely.geometry import Polygon
    p = Polygon(np.asarray(poly, float))
    return p if p.is_valid else p.buffer(0)


def _shp_point(c):
    from shapely.geometry import Point
    return Point(float(c[0]), float(c[1]))


def _delaunay_keep(pts2, Pg):
    from scipy.spatial import Delaunay
    from shapely import contains_xy
    tri = Delaunay(pts2).simplices
    cen = pts2[tri].mean(axis=1)
    return tri[contains_xy(Pg.buffer(1e-9), cen[:, 0], cen[:, 1])]


def tess_polygon(poly, h):
    """多邊形（2D）→ 邊界加密＋內部格點的 Delaunay 三角化。回傳 (points, triangles)。"""
    from shapely import contains_xy
    poly = np.asarray(poly, float)
    Pg = _shp_polygon(poly)
    b = _resample(poly, h * 0.8)
    minx, miny, maxx, maxy = Pg.bounds
    pts = [b]
    inner = Pg.buffer(-h * 0.45)
    if not inner.is_empty:
        gx, gy = np.arange(minx + h / 2, maxx, h), np.arange(miny + h / 2, maxy, h)
        XX, YY = np.meshgrid(gx, gy)
        msk = contains_xy(inner, XX.ravel(), YY.ravel())
        pts.append(np.stack([XX.ravel()[msk], YY.ravel()[msk]], axis=1))
    pts = np.vstack(pts)
    return pts, _delaunay_keep(pts, Pg)


def _resample(poly, step):
    out = []
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        k = max(1, int(math.ceil(np.linalg.norm(b - a) / step)))
        for s in range(k):
            out.append(a + (b - a) * (s / k))
    return np.array(out)


def rrect(cy, cz, w, h, r, seg=4):
    """圓角矩形（前視 y,z），逆時針。"""
    r = min(r, w / 2, h / 2)
    pts = []
    for ox, oz, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(seg + 1):
            a = math.radians(a0 + 90 * k / seg)
            pts.append((cy + ox + r * math.cos(a), cz + oz + r * math.sin(a)))
    return pts


def ellipse(cy, cz, a, b, seg=14):
    return [(cy + a * math.cos(2 * math.pi * k / seg), cz + b * math.sin(2 * math.pi * k / seg)) for k in range(seg)]


# ---------------------------------------------------------------- 輸出
def quantize(arr):
    """位置保留約 1 mm、法線約 0.2%、顏色 8 bit：只為了讓 gzip 更有效率，仍是合法 float32。"""
    a = np.frombuffer(arr, dtype=np.float32).reshape(-1, 10).copy()
    u = a.view(np.uint32)
    u[:, 0:3] &= np.uint32(0xFFFFFC00)
    u[:, 3:6] &= np.uint32(0xFFFFC000)
    a[:, 6:9] = np.round(a[:, 6:9] * 255) / 255
    a[:, 9] = np.round(a[:, 9] * 100) / 100
    return a


def export(m, path):
    a = quantize(m.d)
    raw = a.astype('<f4').tobytes()
    with open(path, 'wb') as f:
        f.write(raw)
    pos = a[:, 0:3]
    return {
        'file': path.split('/')[-1], 'sha256': hashlib.sha256(raw).hexdigest(), 'byteLength': len(raw),
        'vertexCount': int(a.shape[0]), 'triangles': int(a.shape[0] // 3),
        'min': [round(float(v), 4) for v in pos.min(axis=0)], 'max': [round(float(v), 4) for v in pos.max(axis=0)],
    }
