"""臺南舊站幾何累積器：純 Python（不依賴 bpy），座標單位為米，+Z 向上，站房正面朝 -Y。

設計重點
- 每個三角形都帶明確的頂點法線；tri() 會依法線自動修正繞序，所以各種基本體只要給對「朝外」的法線就不會翻面。
- Frame（O,U,V,N）把「牆面座標」（u 沿牆、v 向上、d 沿外法線）對應到世界座標，四面牆與門廊側牆共用同一套函式。
- wall_f 以「共用頂點的條帶」切開牆面與洞口，洞口邊緣與相鄰牆片頂點一致（不留 T 字接縫）。
- 每個三角形帶 LOD 標籤：'both'（近、遠景都畫）、'near'（只近景）、'far'（只遠景的簡化替身）。
"""
import math
from contextlib import contextmanager

EPS = 1e-9


def add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def mul(a, k): return (a[0] * k, a[1] * k, a[2] * k)
def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def length(a): return math.sqrt(dot(a, a))


def unit(a):
    l = length(a)
    return (a[0] / l, a[1] / l, a[2] / l) if l > EPS else (0.0, 0.0, 1.0)


class Frame:
    """牆面座標：p(u,v,d) = O + U*u + V*v + N*d；N 為朝外法線，d>0 往外、d<0 往牆內。"""

    def __init__(self, O, U, V, N):
        self.O, self.U, self.V, self.N = O, U, V, N

    def p(self, u, v, d=0.0):
        O, U, V, N = self.O, self.U, self.V, self.N
        return (O[0] + U[0] * u + V[0] * v + N[0] * d, O[1] + U[1] * u + V[1] * v + N[1] * d, O[2] + U[2] * u + V[2] * v + N[2] * d)

    def n(self, nu, nv, nd):
        U, V, N = self.U, self.V, self.N
        return unit((U[0] * nu + V[0] * nv + N[0] * nd, U[1] * nu + V[1] * nv + N[1] * nd, U[2] * nu + V[2] * nv + N[2] * nd))


_Z = (0.0, 0.0, 1.0)
def front(y=0.0): return Frame((0.0, y, 0.0), (1.0, 0.0, 0.0), _Z, (0.0, -1.0, 0.0))    # 朝 -Y，u = +X
def back(y=0.0): return Frame((0.0, y, 0.0), (-1.0, 0.0, 0.0), _Z, (0.0, 1.0, 0.0))     # 朝 +Y，u = -X
def right(x=0.0): return Frame((x, 0.0, 0.0), (0.0, 1.0, 0.0), _Z, (1.0, 0.0, 0.0))     # 朝 +X，u = +Y
def left(x=0.0): return Frame((x, 0.0, 0.0), (0.0, -1.0, 0.0), _Z, (-1.0, 0.0, 0.0))    # 朝 -X，u = -Y
def world(z=0.0): return Frame((0.0, 0.0, z), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), _Z)      # u=X, v=Y, d=Z（朝上）


def ear_clip(poly):
    """簡單多邊形（任意轉向）→ 三角形索引 (i,j,k)（逆時針），共線點容忍。"""
    n = len(poly)
    if n < 3:
        return []
    area = 0.5 * sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))
    idx = list(range(n)) if area > 0 else list(range(n - 1, -1, -1))

    def c2(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    def inside(p, a, b, c): return c2(a, b, p) >= -1e-12 and c2(b, c, p) >= -1e-12 and c2(c, a, p) >= -1e-12

    tris = []
    guard = 0
    while len(idx) > 3 and guard < 20000:
        guard += 1
        m = len(idx)
        for k in range(m):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % m]
            a, b, c = poly[i0], poly[i1], poly[i2]
            if c2(a, b, c) <= 1e-12:
                continue
            if any(inside(poly[j], a, b, c) for j in idx if j not in (i0, i1, i2)):
                continue
            tris.append((i0, i1, i2))
            idx.pop(k)
            break
        else:
            k = min(range(m), key=lambda k: abs(c2(poly[idx[k - 1]], poly[idx[k]], poly[idx[(k + 1) % m]])))
            idx.pop(k)
    if len(idx) == 3:
        tris.append(tuple(idx))
    return tris


def signed_area(poly):
    n = len(poly)
    return 0.5 * sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))


class Geo:
    def __init__(self):
        self.buf = {}      # (mat, lod) -> 展平的 [x,y,z,nx,ny,nz]*3 per tri
        self.lod = 'both'
        self.comp = '-'
        self.tris = {}     # (comp, lod) -> 三角形數

    @contextmanager
    def detail(self, lod='near'):
        old = self.lod
        self.lod = lod
        try:
            yield
        finally:
            self.lod = old

    @contextmanager
    def part(self, name):
        old = self.comp
        self.comp = name
        try:
            yield
        finally:
            self.comp = old

    def tri(self, p0, p1, p2, mat, n0=None, n1=None, n2=None):
        g = cross(sub(p1, p0), sub(p2, p0))
        L = length(g)
        if L < 1e-10:
            return
        if n0 is None:
            n0 = n1 = n2 = mul(g, 1.0 / L)
        elif dot(g, add(add(n0, n1), n2)) < 0:
            p1, p2 = p2, p1
            n1, n2 = n2, n1
        self.buf.setdefault((mat, self.lod), []).extend((*p0, *n0, *p1, *n1, *p2, *n2))
        k = (self.comp, self.lod)
        self.tris[k] = self.tris.get(k, 0) + 1

    def quad(self, a, b, c, d, mat, n=None, na=None, nb=None, nc=None, nd=None):
        if n is not None:
            na = nb = nc = nd = n
        self.tri(a, b, c, mat, na, nb, nc)
        self.tri(a, c, d, mat, na, nc, nd)

    def count(self, lods):
        return sum(len(v) // 18 for (m, l), v in self.buf.items() if l in lods)


# ---------------------------------------------------------------- 基本體
def box_f(G, f, u0, u1, v0, v1, d0, d1, mat, skip=''):
    """牆面座標中的盒子（d1 為外側面）。skip：N 略外面、n 略內面、U/u 略 u1/u0 側、V/v 略上/下面。"""
    p = f.p
    if 'N' not in skip: G.quad(p(u0, v0, d1), p(u1, v0, d1), p(u1, v1, d1), p(u0, v1, d1), mat, f.n(0, 0, 1))
    if 'n' not in skip: G.quad(p(u0, v0, d0), p(u0, v1, d0), p(u1, v1, d0), p(u1, v0, d0), mat, f.n(0, 0, -1))
    if 'U' not in skip: G.quad(p(u1, v0, d0), p(u1, v1, d0), p(u1, v1, d1), p(u1, v0, d1), mat, f.n(1, 0, 0))
    if 'u' not in skip: G.quad(p(u0, v0, d0), p(u0, v0, d1), p(u0, v1, d1), p(u0, v1, d0), mat, f.n(-1, 0, 0))
    if 'V' not in skip: G.quad(p(u0, v1, d0), p(u0, v1, d1), p(u1, v1, d1), p(u1, v1, d0), mat, f.n(0, 1, 0))
    if 'v' not in skip: G.quad(p(u0, v0, d0), p(u1, v0, d0), p(u1, v0, d1), p(u0, v0, d1), mat, f.n(0, -1, 0))


def box(G, x0, x1, y0, y1, z0, z1, mat, skip=''):
    """世界座標盒子；skip 沿用 box_f 的 u/v/d 記號（u=X, v=Y, d=Z）：v=略底面、V=略頂面 需改用 d：'n'=底、'N'=頂。"""
    box_f(G, world(), x0, x1, y0, y1, z0, z1, mat, skip)


def extrude_f(G, f, poly, d0, d1, mat, smooth=(), skip=''):
    """把 (u,v) 多邊形沿 N 由 d0 擠到 d1。smooth：要平滑側面法線的頂點索引。skip：N 略外蓋、n 略內蓋。"""
    n = len(poly)
    P = [tuple(q) for q in poly]
    S = [i in smooth for i in range(n)]
    if signed_area(P) < 0:
        P.reverse()
        S.reverse()
    tris = ear_clip(P)
    nN, nn = f.n(0, 0, 1), f.n(0, 0, -1)
    for i, j, k in tris:
        if 'N' not in skip: G.tri(f.p(*P[i], d1), f.p(*P[j], d1), f.p(*P[k], d1), mat, nN, nN, nN)
        if 'n' not in skip: G.tri(f.p(*P[i], d0), f.p(*P[j], d0), f.p(*P[k], d0), mat, nn, nn, nn)
    en = []
    for i in range(n):
        a, b = P[i], P[(i + 1) % n]
        du, dv = b[0] - a[0], b[1] - a[1]
        L = math.hypot(du, dv)
        en.append(f.n(dv / L, -du / L, 0) if L > EPS else f.n(0, 0, 0))
    vn = [unit(add(en[i - 1], en[i])) if S[i] else None for i in range(n)]
    for i in range(n):
        j = (i + 1) % n
        a, b = P[i], P[j]
        if math.hypot(b[0] - a[0], b[1] - a[1]) < EPS:
            continue
        na = vn[i] if S[i] else en[i]
        nb = vn[j] if S[j] else en[i]
        G.quad(f.p(*a, d0), f.p(*b, d0), f.p(*b, d1), f.p(*a, d1), mat, None, na, nb, nb, na)


def band_f(G, f, A, B, d0, d1, mat, closed=False, smooth=True, skip=''):
    """兩條對應折線 A（外）、B（內）之間的帶狀體，沿 N 擠出（拱框、圓環、S 形花帶）。"""
    n = len(A)
    segs = n if closed else n - 1
    nN, nn = f.n(0, 0, 1), f.n(0, 0, -1)
    for i in range(segs):
        j = (i + 1) % n
        if 'N' not in skip: G.quad(f.p(*A[i], d1), f.p(*A[j], d1), f.p(*B[j], d1), f.p(*B[i], d1), mat, nN)
        if 'n' not in skip: G.quad(f.p(*A[i], d0), f.p(*B[i], d0), f.p(*B[j], d0), f.p(*A[j], d0), mat, nn)

    def side_normals(X, Y):
        # X 側面的法線：垂直於邊，指向遠離 Y 的一側。
        en = []
        for i in range(segs):
            j = (i + 1) % n
            t = (X[j][0] - X[i][0], X[j][1] - X[i][1])
            L = math.hypot(*t)
            if L < EPS:
                en.append(f.n(0, 0, 0))
                continue
            cand = (t[1] / L, -t[0] / L)
            mid = ((X[i][0] + X[j][0]) / 2 - (Y[i][0] + Y[j][0]) / 2, (X[i][1] + X[j][1]) / 2 - (Y[i][1] + Y[j][1]) / 2)
            if cand[0] * mid[0] + cand[1] * mid[1] < 0:
                cand = (-cand[0], -cand[1])
            en.append(f.n(cand[0], cand[1], 0))
        vn = []
        for i in range(n):
            if not smooth:
                vn.append(None)
            elif closed:
                vn.append(unit(add(en[i - 1], en[i])))
            elif 0 < i < n - 1:
                vn.append(unit(add(en[i - 1], en[i])))
            else:
                vn.append(en[0] if i == 0 else en[-1])
        return en, vn

    for X, Y in ((A, B), (B, A)):
        en, vn = side_normals(X, Y)
        for i in range(segs):
            j = (i + 1) % n
            na = vn[i] if vn[i] else en[i]
            nb = vn[j] if vn[j] else en[i]
            G.quad(f.p(*X[i], d0), f.p(*X[j], d0), f.p(*X[j], d1), f.p(*X[i], d1), mat, None, na, nb, nb, na)
    if not closed:
        for idx, sgn in ((0, -1), (n - 1, 1)):
            k = idx if idx == 0 else idx - 1
            t = (A[k + 1][0] - A[k][0], A[k + 1][1] - A[k][1])
            L = math.hypot(*t)
            nrm = f.n(sgn * t[0] / L, sgn * t[1] / L, 0)
            G.quad(f.p(*A[idx], d0), f.p(*B[idx], d0), f.p(*B[idx], d1), f.p(*A[idx], d1), mat, nrm)


def circle_pts(cu, cv, r, n, a0=0.0):
    return [(cu + r * math.cos(a0 + 2 * math.pi * i / n), cv + r * math.sin(a0 + 2 * math.pi * i / n)) for i in range(n)]


def arc_pts(cu, cv, r, a0, a1, n):
    return [(cu + r * math.cos(a0 + (a1 - a0) * i / n), cv + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def disc_f(G, f, cu, cv, r, d, mat, n=24, facing=1):
    """圓盤（單面，facing=+1 朝 N，-1 朝 -N）。"""
    pts = circle_pts(cu, cv, r, n)
    nrm = f.n(0, 0, facing)
    c = f.p(cu, cv, d)
    for i in range(n):
        G.tri(c, f.p(*pts[i], d), f.p(*pts[(i + 1) % n], d), mat, nrm, nrm, nrm)


def ring_f(G, f, cu, cv, r_in, r_out, d0, d1, mat, n=24, skip=''):
    band_f(G, f, circle_pts(cu, cv, r_out, n), circle_pts(cu, cv, r_in, n), d0, d1, mat, closed=True, skip=skip)


def revolve_f(G, f, cu, cv, profile, mat, n=16, smooth=None, a0=0.0, a1=2 * math.pi):
    """繞著通過 (cu,cv)、沿 N 的軸旋轉 profile[(r,h)]（h 沿 N）。profile 由外側自下而上走。
    smooth：要平滑的 profile 頂點索引（預設全平滑）。"""
    m = len(profile)
    sm = set(range(m)) if smooth is None else set(smooth)
    en = []
    for i in range(m - 1):
        dr, dh = profile[i + 1][0] - profile[i][0], profile[i + 1][1] - profile[i][1]
        L = math.hypot(dr, dh)
        en.append((dh / L, -dr / L) if L > EPS else (0.0, 0.0))
    def pn(i, k):  # 頂點 i 在 profile 邊 k 一側的法線 (r,h)
        if i in sm and 0 < i < m - 1:
            a, b = en[i - 1], en[i]
            l = math.hypot(a[0] + b[0], a[1] + b[1])
            return ((a[0] + b[0]) / l, (a[1] + b[1]) / l) if l > EPS else b
        return en[k]
    segs = max(1, int(round(n * (a1 - a0) / (2 * math.pi))))
    for s in range(segs):
        t0, t1 = a0 + (a1 - a0) * s / segs, a0 + (a1 - a0) * (s + 1) / segs
        c0, s0, c1, s1 = math.cos(t0), math.sin(t0), math.cos(t1), math.sin(t1)
        for i in range(m - 1):
            (r0, h0), (r1, h1) = profile[i], profile[i + 1]
            if r0 < EPS and r1 < EPS:
                continue
            na, nb = pn(i, i), pn(i + 1, i)
            def P(r, h, c, s): return f.p(cu + r * c, cv + r * s, h)
            def Nn(nv, c, s): return f.n(nv[0] * c, nv[0] * s, nv[1])
            G.quad(P(r0, h0, c0, s0), P(r0, h0, c1, s1), P(r1, h1, c1, s1), P(r1, h1, c0, s0), mat, None,
                   Nn(na, c0, s0), Nn(na, c1, s1), Nn(nb, c1, s1), Nn(nb, c0, s0))


def rod(G, a, b, r, mat, n=6, caps=True):
    axis = sub(b, a)
    if length(axis) < 1e-6:
        return
    w = unit(axis)
    ref = (0.0, 0.0, 1.0) if abs(w[2]) < 0.9 else (1.0, 0.0, 0.0)
    u = unit(cross(w, ref))
    v = cross(w, u)
    f = Frame(a, u, v, w)
    L = length(axis)
    revolve_f(G, f, 0.0, 0.0, [(r, 0.0), (r, L)], mat, n, smooth=[0, 1])
    if caps:
        disc_f(G, f, 0.0, 0.0, r, 0.0, mat, n, -1)
        disc_f(G, f, 0.0, 0.0, r, L, mat, n, 1)


# ---------------------------------------------------------------- 洞口與牆面
def span_at(poly, u):
    vs = []
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        if abs(a[0] - b[0]) < EPS:
            if abs(a[0] - u) < 1e-7:
                vs += [a[1], b[1]]
            continue
        if min(a[0], b[0]) - 1e-7 <= u <= max(a[0], b[0]) + 1e-7:
            t = (u - a[0]) / (b[0] - a[0])
            vs.append(a[1] + t * (b[1] - a[1]))
    return min(vs), max(vs)


def hole_rect(uc, w, v0, v1, depth=0.3):
    return {'poly': [(uc - w / 2, v0), (uc + w / 2, v0), (uc + w / 2, v1), (uc - w / 2, v1)], 'smooth': set(), 'depth': depth}


def hole_arch(uc, w, v0, vs, depth=0.3, n=12):
    """下緣 v0、拱起點 vs（半圓半徑 w/2）的圓拱洞口。"""
    r = w / 2
    poly = [(uc - r, v0), (uc + r, v0)] + [(uc + r * math.cos(math.pi * i / n), vs + r * math.sin(math.pi * i / n)) for i in range(n + 1)]
    return {'poly': poly, 'smooth': set(range(2, 2 + n + 1)), 'depth': depth}


def hole_circle(uc, vc, r, depth=0.25, n=20):
    return {'poly': circle_pts(uc, vc, r, n), 'smooth': set(range(n)), 'depth': depth}


def arch_outline(uc, vb, r, vs, n):
    """由左腳底沿左柱、半圓、右柱回到右腳底的開放折線（供拱框 band 用）。"""
    return [(uc - r, vb)] + [(uc + r * math.cos(math.pi - math.pi * i / n), vs + r * math.sin(math.pi - math.pi * i / n)) for i in range(n + 1)] + [(uc + r, vb)]


def _zip(G, f, ua, L, ub, R, mat, nN):
    i = j = 0
    m, k = len(L) - 1, len(R) - 1
    while i < m or j < k:
        if j >= k or (i < m and L[i + 1] <= R[j + 1] + 1e-12):
            G.tri(f.p(ua, L[i]), f.p(ub, R[j]), f.p(ua, L[i + 1]), mat, nN, nN, nN)
            i += 1
        else:
            G.tri(f.p(ua, L[i]), f.p(ub, R[j]), f.p(ub, R[j + 1]), mat, nN, nN, nN)
            j += 1


def wall_f(G, f, u0, u1, v0, v1, holes, mat, reveal_mat=None):
    """有洞口的牆面（只出朝外的面與洞口內壁）。holes：hole_* 傳回的 dict。"""
    reveal_mat = reveal_mat or mat
    info = []
    for h in holes:
        P = [tuple(q) for q in h['poly']]
        S = [i in h['smooth'] for i in range(len(P))]
        if signed_area(P) < 0:
            P.reverse()
            S.reverse()
        us = [q[0] for q in P]
        info.append((min(us), max(us), P, S, h['depth']))
    bps = sorted({round(u0, 7), round(u1, 7)} | {round(q[0], 7) for (_, _, P, _, _) in info for q in P if u0 - 1e-9 <= q[0] <= u1 + 1e-9})
    nN = f.n(0, 0, 1)

    def V_at(u):
        vs = {round(v0, 7), round(v1, 7)}
        for a, b, P, _, _ in info:
            if a - 1e-7 <= u <= b + 1e-7:
                lo, hi = span_at(P, u)
                vs.add(round(lo, 7))
                vs.add(round(hi, 7))
        return sorted(vs)

    for ua, ub in zip(bps, bps[1:]):
        if ub - ua < 1e-7:
            continue
        ivs = []
        for a, b, P, _, _ in info:
            if a <= ua + 1e-7 and b >= ub - 1e-7:
                la, ha = span_at(P, ua)
                lb, hb = span_at(P, ub)
                ivs.append((la, ha, lb, hb))
        ivs.sort(key=lambda t: t[0] + t[2])
        La, Lb = V_at(ua), V_at(ub)
        ca, cb = v0, v0
        for la, ha, lb, hb in ivs + [(v1, v1, v1, v1)]:
            left = [v for v in La if ca - 1e-7 <= v <= la + 1e-7]
            rightv = [v for v in Lb if cb - 1e-7 <= v <= lb + 1e-7]
            if (len(left) > 1 or len(rightv) > 1) and (la - ca > 1e-7 or lb - cb > 1e-7):
                _zip(G, f, ua, left, ub, rightv, mat, nN)
            ca, cb = ha, hb
    for a, b, P, S, depth in info:
        n = len(P)
        en = []
        for i in range(n):
            p, q = P[i], P[(i + 1) % n]
            du, dv = q[0] - p[0], q[1] - p[1]
            L = math.hypot(du, dv)
            en.append(f.n(-dv / L, du / L, 0) if L > EPS else f.n(0, 0, 0))   # 洞口內壁法線朝洞內
        vn = [unit(add(en[i - 1], en[i])) if S[i] else None for i in range(n)]
        for i in range(n):
            j = (i + 1) % n
            p, q = P[i], P[j]
            if math.hypot(q[0] - p[0], q[1] - p[1]) < EPS:
                continue
            na = vn[i] if S[i] else en[i]
            nb = vn[j] if S[j] else en[i]
            G.quad(f.p(*p, 0), f.p(*q, 0), f.p(*q, -depth), f.p(*p, -depth), reveal_mat, None, na, nb, nb, na)


def fill_poly_f(G, f, poly, d, mat, facing=1):
    """把 (u,v) 多邊形填成單面（玻璃、門扇陰影）。"""
    P = [tuple(q) for q in poly]
    nrm = f.n(0, 0, facing)
    for i, j, k in ear_clip(P):
        G.tri(f.p(*P[i], d), f.p(*P[j], d), f.p(*P[k], d), mat, nrm, nrm, nrm)


def volume(G, mat_lod_keys=None):
    """散度定理估算有向體積（封閉體應為正值）。除錯用。"""
    tot = 0.0
    for key, v in G.buf.items():
        if mat_lod_keys and key not in mat_lod_keys:
            continue
        for i in range(0, len(v), 18):
            p0, p1, p2 = tuple(v[i:i + 3]), tuple(v[i + 6:i + 9]), tuple(v[i + 12:i + 15])
            tot += dot(p0, cross(p1, p2)) / 6.0
    return tot
