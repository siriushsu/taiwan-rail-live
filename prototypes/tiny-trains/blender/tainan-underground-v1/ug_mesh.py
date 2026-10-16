"""臺南地下化的幾何：隧道、引道 U 槽、站體、B1 樓板、月台。純 Python＋numpy＋shapely，不用 Blender。

三角形累積器直接用 v1 的 Geo（tainan-memory-v1/geo.py，依路徑載入，不複製不修改）；
每個三角形的法線都由頂點算出（朝向由「期望朝外的方向」決定，繞序自動修正），三個頂點同一條法線（平面著色）。

做法重點
- 隧道與引道沿「剖面線（rung）」生成：剖面線垂直於參考線，位置取參考線折點、東側正線折點的投影、控制點、兩端；
  相鄰兩條剖面線之間兩側都是直線，所以每個四邊形都貼著 OSM 折線偏移出來的實際形狀，也不會有一條長直線跨過坡度轉折點。
- 每個頂點的 z 都由同一個剖面函數（Profile.z）依 d 算出；站體是水平的，高程就是兩個站端控制點的共同值。
- 站體外框：四股各自外擴（牆內緣距離＋牆厚）後取聯集，做形態學 closing 補平股道之間的空隙，再和隧道外框聯集，
  最後用垂直於參考線的兩個切面切平；切面上的端牆在隧道接進來的地方開洞，洞口就是隧道外框的剖面。
"""
from __future__ import annotations

import importlib.util
import math

import numpy as np
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

import ug_core as C

_spec = importlib.util.spec_from_file_location('v1_geo', C.HERE.parent / 'tainan-memory-v1' / 'geo.py')
geo = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(geo)

# 容差與取樣步長（不是尺寸）
MIN_TRI_AREA = 1e-6          # 規格上的最小三角形面積（m²）；產生時低於它的直接丟掉並計數
ARC_SEGS = 16                # shapely 圓弧每 1/4 圓的段數；R=6 m 時弦高誤差 0.007 m（建議 ≤ 0.05 m）
CLOSING_RADIUS_M = 6.0       # 站體外框的 closing 半徑：填平寬度 < 12 m 的股道間空隙
END_EXT_M = 5.0              # 站體外框先多算到端面外 5 m 再切，避免兩條共線邊在聯集時產生細縫
STRIP_HALF_M = 120.0         # 切面條帶的半寬（遠大於站體寬度）
SNAP_M = 1e-4                # 端面頂點吸附到隧道洞口角點的容差


def R(v):
    return ('r', float(v))      # 相對該剖面線軌道面高程


def Z(v):
    return ('a', float(v))      # 絕對高程


class Mesh:
    def __init__(self):
        self.G = geo.Geo()
        self.skipped = 0

    def tri(self, a, b, c, mat, hint):
        g = geo.cross(geo.sub(b, a), geo.sub(c, a))
        L = geo.length(g)
        if L < 2 * MIN_TRI_AREA:
            self.skipped += 1
            return
        if geo.dot(g, hint) < 0:
            b, c = c, b
            g = (-g[0], -g[1], -g[2])
        n = (g[0] / L, g[1] / L, g[2] / L)
        self.G.tri(a, b, c, mat, n, n, n)

    def quad(self, a, b, c, d, mat, hint):
        self.tri(a, b, c, mat, hint)
        self.tri(a, c, d, mat, hint)

    def flat(self, ring, z, mat, up=True, area_tol=1e-6):
        """水平多邊形（外環逆時針的 xy 列表）；z 可以是常數。回傳三角形數。"""
        pts = [(float(x), float(y)) for x, y in ring]
        tris = geo.ear_clip(pts)
        area = abs(geo.signed_area(pts))
        got = sum(abs(geo.signed_area([pts[i], pts[j], pts[k]])) for i, j, k in tris)
        if abs(got - area) > area_tol * max(area, 1.0):
            raise ValueError(f'多邊形三角化面積不符：{got} vs {area}')
        hint = (0.0, 0.0, 1.0 if up else -1.0)
        for i, j, k in tris:
            self.tri((*pts[i], z), (*pts[j], z), (*pts[k], z), mat, hint)
        return len(tris)


# ---------------------------------------------------------------- 沿參考線的剖面條帶
class Section:
    """d∈[d0,d1] 的一串剖面線；橫向位置相對兩條正線的中線（s=0 是中線，向東為正）。"""

    def __init__(self, w, d0, d1, extra=()):
        self.w = w
        self.ds = C.rung_ds(w, d0, d1, extra)
        self.n = len(self.ds)
        self.z = [w.profile.z(d) for d in self.ds]
        self.sm = [w.ref.lateral(w.east, d) / 2 for d in self.ds]
        self.e = [w.ref.east(d)[0] for d in self.ds]

    def index(self, d):
        k = int(np.argmin(np.abs(np.array(self.ds) - d)))
        if abs(self.ds[k] - d) > 1e-6:
            raise ValueError(f'沒有 d={d} 的剖面線')
        return k

    def xy(self, k, s):
        p = self.w.ref.at(self.ds[k], self.sm[k] + s)
        return float(p[0]), float(p[1])

    def xyz(self, k, s, zz):
        x, y = self.xy(k, s)
        z = self.z[k] + zz[1] if zz[0] == 'r' else zz[1]
        return (x, y, float(z))

    def hint(self, name, k0, k1=None):
        k1 = k0 if k1 is None else k1
        e = (self.e[k0] + self.e[k1]) / 2
        t = np.array([-e[1], e[0]])
        return {'up': (0.0, 0.0, 1.0), 'down': (0.0, 0.0, -1.0),
                'east': (float(e[0]), float(e[1]), 0.0), 'west': (float(-e[0]), float(-e[1]), 0.0),
                'fwd': (float(t[0]), float(t[1]), 0.0), 'back': (float(-t[0]), float(-t[1]), 0.0)}[name]

    def ribbon(self, M, mat, l1, l2, hint, k0=0, k1=None):
        """兩條沿 d 的線 l1=(s, 高程)、l2 之間的帶狀面，k0..k1 之間每對相鄰剖面線一個四邊形。"""
        k1 = self.n - 1 if k1 is None else k1
        for k in range(k0, k1):
            M.quad(self.xyz(k, *l1), self.xyz(k, *l2), self.xyz(k + 1, *l2), self.xyz(k + 1, *l1), mat, self.hint(hint, k, k + 1))

    def cap(self, M, mat, k, s1, s2, z1, z2, facing):
        """k 號剖面線上的矩形面（橫向 s1..s2、高程 z1..z2），facing='fwd'|'back'。"""
        M.quad(self.xyz(k, s1, z1), self.xyz(k, s2, z1), self.xyz(k, s2, z2), self.xyz(k, s1, z2), mat, self.hint(facing, k))

    def ring(self, s_lo, s_hi, k0=0, k1=None):
        """平面外環（逆時針）：西緣由南到北，再東緣由北到南。"""
        k1 = self.n - 1 if k1 is None else k1
        west = [self.xy(k, s_lo) for k in range(k0, k1 + 1)]
        east = [self.xy(k, s_hi) for k in range(k0, k1 + 1)]
        return west + east[::-1]


# ---------------------------------------------------------------- 隧道
def build_tunnel(M, w, d0, d1, part='tunnel'):
    D = w.dims
    sec = Section(w, d0, d1)
    half, hin = D.tun_outer / 2, D.tun_inner / 2
    with M.G.part(part):
        sec.ribbon(M, 'ug_shell', (-half, R(D.tun_top)), (half, R(D.tun_top)), 'up')                  # 頂板上面
        sec.ribbon(M, 'ug_shell', (-half, R(-D.base_below)), (-half, R(D.tun_top)), 'west')           # 西牆外面
        sec.ribbon(M, 'ug_shell', (half, R(-D.base_below)), (half, R(D.tun_top)), 'east')             # 東牆外面
        sec.ribbon(M, 'ug_floor', (-hin, R(0)), (hin, R(0)), 'up')                                   # 地板（內淨寬、軌道面高程）
    return sec


# ---------------------------------------------------------------- 引道 U 槽
def build_trough(M, w, d_lo, d_hi, portal, part='trough'):
    """d_lo..d_hi 的 U 槽；portal='hi' 表示洞口在 d_hi 端（南引道），'lo' 在 d_lo 端（北引道）。"""
    D = w.dims
    half, hin = D.ramp_outer / 2, D.ramp_inner / 2
    d_p = d_hi if portal == 'hi' else d_lo
    d_f = d_p - D.ramp_wall if portal == 'hi' else d_p + D.ramp_wall          # 洞口牆的另一面（開挖側）
    sec = Section(w, d_lo, d_hi, extra=[d_f])
    kp, kf = sec.index(d_p), sec.index(d_f)
    top = Z(D.ramp_top)
    with M.G.part(part):
        sec.ribbon(M, 'ug_trough_floor', (-hin, R(0)), (hin, R(0)), 'up')
        for sgn, outer_dir, inner_dir in ((-1, 'west', 'east'), (1, 'east', 'west')):
            so, si = sgn * half, sgn * hin
            sec.ribbon(M, 'ug_trough', (so, top), (si, top), 'up')                         # 牆頂
            sec.ribbon(M, 'ug_trough', (so, R(-D.base_below)), (so, top), outer_dir)        # 外面
            sec.ribbon(M, 'ug_trough', (si, R(0)), (si, top), inner_dir)                    # 內面（地板以上）
            for k, facing in ((0, 'back'), (sec.n - 1, 'fwd')):                            # 兩端
                sec.cap(M, 'ug_trough', k, min(so, si), max(so, si), R(-D.base_below), top, facing)
        # 洞口上方的牆：夾在兩側牆內面之間，從頂板底（軌道面＋淨高）到牆頂；開挖側一面、隧道側一面、頂、底
        k0, k1 = (kf, kp) if portal == 'hi' else (kp, kf)
        sec.ribbon(M, 'ug_trough', (-hin, R(D.soffit)), (hin, R(D.soffit)), 'down', k0, k1)
        sec.ribbon(M, 'ug_trough', (-hin, top), (hin, top), 'up', k0, k1)
        face_cut, face_tun = ('back', 'fwd') if portal == 'hi' else ('fwd', 'back')
        sec.cap(M, 'ug_trough', kf, -hin, hin, R(D.soffit), top, face_cut)
        sec.cap(M, 'ug_trough', kp, -hin, hin, R(D.soffit), top, face_tun)
    return sec


# ---------------------------------------------------------------- 站體
def strip_polygon(w, d0, d1, half=STRIP_HALF_M):
    """d0..d1 之間、參考線兩側各 half 的條帶；兩端是垂直於參考線的切面。"""
    ds = [d0] + [float(d) for d in w.ref.cum if d0 + C.VERTEX_EPS < d < d1 - C.VERTEX_EPS] + [d1]
    west = [tuple(w.ref.at(d, -half)) for d in ds]
    east = [tuple(w.ref.at(d, half)) for d in ds]
    return orient(Polygon(west + east[::-1]), 1.0)


def _largest(g):
    if isinstance(g, Polygon):
        return g
    polys = [p for p in getattr(g, 'geoms', []) if isinstance(p, Polygon)]
    if not polys:
        raise ValueError('沒有多邊形')
    return max(polys, key=lambda p: p.area)


def station_tracks(w):
    """站內四股：兩條外側股道＋兩條正線（隧道 way）。"""
    return [w.loop['west'].ls, w.tun['west'].ls, w.tun['east'].ls, w.loop['east'].ls]


def station_outline(w, d0, d1):
    """d0..d1 的站體外框（逆時針、無洞）。"""
    D = w.dims
    strip = strip_polygon(w, d0, d1)
    ext = max(0.0, d0 - END_EXT_M), min(w.ref.length, d1 + END_EXT_M)
    strip_ext = strip_polygon(w, ext[0], ext[1])
    r = D.st_inset + D.st_wall
    bufs = []
    for ln in station_tracks(w):
        part = ln.intersection(strip_ext)
        if part.is_empty:
            continue
        bufs.append(part.buffer(r, quad_segs=ARC_SEGS, cap_style='flat', join_style='mitre', mitre_limit=5.0))
    u = unary_union(bufs)
    closed = u.buffer(CLOSING_RADIUS_M, quad_segs=ARC_SEGS).buffer(-CLOSING_RADIUS_M, quad_segs=ARC_SEGS)
    sec = Section(w, ext[0], ext[1], extra=[d0, d1])
    tun = Polygon(sec.ring(-D.tun_outer / 2, D.tun_outer / 2))
    fp = unary_union([closed, tun]).intersection(strip)
    fp = orient(_largest(fp).buffer(0), 1.0).simplify(0.001)
    if not isinstance(fp, Polygon) or fp.interiors:
        raise ValueError('站體外框不是單一無洞多邊形')
    return orient(fp, 1.0)


def _end_edges(w, ring, d_s, d_n):
    """外環中落在兩個切面上的邊：回傳 {'south': i, 'north': i}（邊 i 是 ring[i]→ring[i+1]）。"""
    out = {}
    for name, d in (('south', d_s), ('north', d_n)):
        base = w.ref.point(d)
        e, _ = w.ref.east(d)
        t = np.array([-e[1], e[0]])
        hits = []
        for i in range(len(ring) - 1):
            a, b = np.array(ring[i]), np.array(ring[i + 1])
            if abs((a - base) @ t) < 1e-4 and abs((b - base) @ t) < 1e-4 and np.hypot(*(b - a)) > 1.0:
                hits.append(i)
        if len(hits) != 1:
            raise ValueError(f'{name} 端面應恰有一條邊，找到 {len(hits)}')
        out[name] = hits[0]
    return out


def _snap(ring, i, j, pa, pb):
    """把外環中 i、j 兩個頂點吸附到洞口角點 pa、pb（相差不超過 SNAP_M）。"""
    for idx, p in ((i, pa), (j, pb)):
        if math.hypot(ring[idx][0] - p[0], ring[idx][1] - p[1]) > SNAP_M:
            return False
        ring[idx] = (float(p[0]), float(p[1]))
    return True


def build_station(M, w, info):
    """站體殼、地板、B1、月台。info 收集外框與數值供 model.json / profile 使用。"""
    D = w.dims
    d_s, d_n = w.st_south, w.st_north
    z_s, z_n = w.profile.z(d_s), w.profile.z(d_n)
    if abs(z_s - z_n) > 1e-9:
        raise ValueError('站體兩端高程不同，站體水平的假設不成立')
    z0 = z_s
    z_base = z0 - D.st_base_below
    z_hb = z0 - D.base_below                      # 洞口下緣＝隧道底
    z_ht = z0 + D.tun_top                         # 洞口上緣＝隧道頂板頂
    z_roof = D.st_roof_top_z
    if not (z_base < z_hb < z_ht < z_roof):
        raise ValueError(f'站體高程次序錯誤：{z_base}, {z_hb}, {z_ht}, {z_roof}')
    z_b1_top = z0 + D.st_b1_top
    z_b1_bot = z_b1_top - D.st_b1_t

    fp = station_outline(w, d_s, d_n)
    ring = [tuple(p) for p in fp.exterior.coords][:-1]
    ring.append(ring[0])
    ends = _end_edges(w, ring, d_s, d_n)
    # 洞口＝隧道外框在端面的剖面
    half = D.tun_outer / 2
    holes = {}
    for name, d in (('south', d_s), ('north', d_n)):
        sm = w.ref.lateral(w.east, d) / 2
        pw, pe = w.ref.at(d, sm - half), w.ref.at(d, sm + half)
        holes[name] = (pw, pe, sm)
    # 端面的兩個頂點吸附到洞口角點（端面和隧道一樣寬時）；順序依邊的走向
    for name in ('south', 'north'):
        i = ends[name]
        a, b = np.array(ring[i]), np.array(ring[i + 1])
        pw, pe, _ = holes[name]
        # 逆時針外環上，南端面由西往東走、北端面由東往西走
        first, second = (pw, pe) if name == 'south' else (pe, pw)
        ok = _snap(ring, i, (i + 1) % (len(ring) - 1), first, second)
        ring[-1] = ring[0]
        if not ok:
            raise ValueError(f'站體{name}端面比隧道洞口寬，開洞後兩側的牆片尚未實作')
    info['outline'] = ring
    levels = [z_base, z_hb, z_ht, z_roof]

    with M.G.part('station'):
        # 外牆外面（分三個高度帶，端面開洞）
        for i in range(len(ring) - 1):
            a, b = ring[i], ring[i + 1]
            dx, dy = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dy)
            if L < 1e-9:
                continue
            hint = (dy / L, -dx / L, 0.0)
            is_end = i in ends.values()
            for band, (za, zb) in enumerate(zip(levels, levels[1:])):
                if is_end and band == 1:
                    continue                       # 洞口所在的高度帶：端面整條都是洞口
                M.quad((a[0], a[1], za), (b[0], b[1], za), (b[0], b[1], zb), (a[0], a[1], zb), 'ug_shell', hint)
        # 頂板上面
        M.flat(ring[:-1], z_roof, 'ug_shell', up=True)
        # 內部（牆內緣）：先把外框延長到端面外一個牆厚，內縮牆厚後再切回端面，所以端面上不留牆厚
        ext = (d_s - D.st_wall, d_n + D.st_wall)
        fp_ext = station_outline(w, ext[0], ext[1])
        inner = fp_ext.buffer(-D.st_wall, quad_segs=ARC_SEGS, join_style='mitre', mitre_limit=5.0)
        inner = _largest(inner.intersection(strip_polygon(w, d_s, d_n)))
        inner = orient(inner.simplify(0.001), 1.0)
        iring = [tuple(p) for p in inner.exterior.coords][:-1]
        info['inner'] = iring
        M.flat(iring, z0, 'ug_floor', up=True)
        M.flat(iring, z_b1_top, 'ug_b1', up=True)
        M.flat(iring, z_b1_bot, 'ug_b1', up=False)
    info['z'] = {'floor': z0, 'base': z_base, 'b1Top': z_b1_top, 'b1Bottom': z_b1_bot, 'roofTop': z_roof,
                 'holeBottom': z_hb, 'holeTop': z_ht}
    build_platforms(M, w, z0, info)
    return fp


# ---------------------------------------------------------------- 月台
def build_platforms(M, w, z0, info):
    D = w.dims
    al = w.P['station']['islands']['value']
    d0, d1 = w.pf_d0, w.pf_d1
    plats = []
    with M.G.part('platform'):
        for isl in al:
            a_id, b_id = isl['between']
            A, B = C.Poly(w.ways[a_id]), C.Poly(w.ways[b_id])
            # 兩股之間的區域：沿剖面線取兩條股道的橫向位置，頂點含兩條股道在窗內的所有折點
            ds = [d0] + sorted({float(d) for d in list(map(w.ref.project, A.pts)) + list(map(w.ref.project, B.pts)) if d0 + 1e-6 < d < d1 - 1e-6}) + [d1]
            left = [tuple(w.ref.at(d, w.ref.lateral(A, d))) for d in ds]
            right = [tuple(w.ref.at(d, w.ref.lateral(B, d))) for d in ds]
            region = Polygon(left + right[::-1])
            if not region.is_valid:
                raise ValueError(f'月台區域無效：{isl["name"]}')
            region = orient(region, 1.0)
            for ln in (A.ls, B.ls):
                region = region.difference(ln.buffer(D.pf_edge, quad_segs=ARC_SEGS))
            poly = orient(_largest(region).simplify(0.001), 1.0)
            ring = [tuple(p) for p in poly.exterior.coords]
            top = z0 + D.pf_top
            M.flat(ring[:-1], top, 'ug_platform', up=True)
            for i in range(len(ring) - 1):
                a, b = ring[i], ring[i + 1]
                dx, dy = b[0] - a[0], b[1] - a[1]
                L = math.hypot(dx, dy)
                if L < 1e-9:
                    continue
                M.quad((a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], top), (a[0], a[1], top), 'ug_platform', (dy / L, -dx / L, 0.0))
            plats.append({'name': isl['name'], 'between': isl['between'], 'ring': ring[:-1], 'top': top})
    info['platforms'] = plats
