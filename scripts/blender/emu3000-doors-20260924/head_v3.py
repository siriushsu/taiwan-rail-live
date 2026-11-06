"""EMU3000 頭車車殼與車側（2026-11-06）。
舊版是 fleet-v1 的方盒車頭加貼片，鼻端只有 .86 長。這支把車殼整個重建：
  - 車殼是一串斷面拉成的曲面（loft），後段斷面跟舊版相同（圓角 .23），XN 之後收成流線鼻端。
  - 塗裝不貼片：在同一張網格上沿著場函數切開再分材質（paint），邊緣是準確的曲線，也不會有疊面。
  - 法線用斷面網格差分算，切開後的新頂點內插，寫成 custom normal。
門扇、門窗、門把的物件名稱沿用 passenger_sides，build_doors.py 靠名稱認它們。

照片只用來比形狀（Commons：TRA ED3051 head at Chaozhou Station 20220329、Tainan Station (2026) - EMU3000 at the platform、
Taiwan Railways Administration EMU3000 near Yingge Station 20210819、TRA EMU3000 pantograph at Taichung Station 20220708），
不當貼圖、不進交付包。高度依 Yingge 正面照量，車身高 .83–3.40 對應照片車底到車頂；X 是 Q 版縮短的（車長 9.6 對實車 21.35），
地圖會把車沿 X 拉回公尺長度，所以鼻端長度照地圖比例定。
"""
import math

XN = 2.40    # 鼻端起點（斷面從這裡開始變）
XT = 4.85    # 鼻尖
R_BODY = .23
R_TOP_A, R_TOP_B = .34, .36   # 車頂肩部（橢圓），比舊版 .23 圓，正面輪廓才接近實車
DOOR_X = (-4.20, 1.30)     # 客室門；後端門位置跟舊版相同，中間車才能沿用月台停車位
CREW_X = 2.02              # 乘務員門（只有外觀，不開）
WIN_PITCH = .60
WIN_W = .47
WIN_H = .60
WIN_Z = 2.33
WIN_X = tuple(-3.30 + WIN_PITCH * i for i in range(7))   # x=0 落在窗柱正中，中間車鏡射才對稱
SIDE_Z = 3.00              # 車側目的地顯示器


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(t):
    t = max(0., min(1., t))
    return t * t * (3 - 2 * t)


def mono(points):
    """單調三次內插（Fritsch–Carlson）。"""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    n = len(xs)
    d = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(n - 1)]
    m = [d[0]] + [0 if d[i - 1] * d[i] <= 0 else (d[i - 1] + d[i]) / 2 for i in range(1, n - 1)] + [d[-1]]
    for i in range(n - 1):
        if d[i] == 0:
            m[i] = m[i + 1] = 0
            continue
        a, b = m[i] / d[i], m[i + 1] / d[i]
        s = a * a + b * b
        if s > 9:
            k = 3 / math.sqrt(s)
            m[i], m[i + 1] = k * a * d[i], k * b * d[i]

    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        lo, hi = 0, n - 1
        while hi - lo > 1:
            c = (lo + hi) // 2
            if xs[c] <= x:
                lo = c
            else:
                hi = c
        h = xs[hi] - xs[lo]
        t = (x - xs[lo]) / h
        return ((2 * t ** 3 - 3 * t * t + 1) * ys[lo] + (t ** 3 - 2 * t * t + t) * h * m[lo] +
                (-2 * t ** 3 + 3 * t * t) * ys[hi] + (t ** 3 - t * t) * h * m[hi])
    return f


class Nose:
    """斷面：底平段＋下圓角＋直側＋上圓角＋頂平段；鼻端的圓角一路放大到整個斷面變成圓頂。"""
    def __init__(s, W, H, z0=.83):
        s.W, s.H, s.z0, s.hw = W, H, z0, W / 2
        s.top = mono([(0, H), (.10, H), (.24, H - .05), (.36, H - .22), (.60, 2.47), (.72, 2.16), (.84, 1.93),
                      (.93, 1.72), (.98, 1.52), (1., 1.34)])
        s.bot = mono([(0, z0), (.30, z0), (.48, .74), (.66, .64), (.86, .62), (.95, .76), (.995, 1.10), (1., 1.34)])
        s.waist = mono([(0, 1.80), (.55, 1.72), (.85, 1.55), (1., 1.34)])

    def sec(s, x):
        t = max(0., min(1., (x - XN) / (XT - XN)))
        w = s.hw * max(0., 1 - t ** 3.0) ** (1 / 2.2)
        zt, zb, zw = s.top(t), s.bot(t), s.waist(t)
        k = smooth(t / .60)
        z2 = min(lerp(s.H - R_TOP_B, zw, k), zt - .001)
        z1 = max(lerp(s.z0 + R_BODY, zw, k), zb + .001)
        z1 = min(z1, z2)
        at = lerp(R_TOP_A, w, k)
        ab = lerp(R_BODY, w * .62, smooth(t / .80))
        ab = max(ab, w * smooth((t - .90) / .10))
        return w, zt, zb, z1, z2, min(at, w), min(ab, w)

    def inside(s, x, y, z):
        w, zt, zb, z1, z2, at, ab = s.sec(x)
        y = abs(y)
        if y > w or z > zt or z < zb:
            return False
        if z > z2:
            u = max(0., y - (w - at))
            return (u / max(at, 1e-6)) ** 2 + ((z - z2) / max(zt - z2, 1e-6)) ** 2 <= 1
        if z < z1:
            u = max(0., y - (w - ab))
            return (u / max(ab, 1e-6)) ** 2 + ((z1 - z) / max(z1 - zb, 1e-6)) ** 2 <= 1
        return True

    def f(s, y, z):
        """給正面座標，回傳曲面的 x（車頭面）。範圍外回傳 XN。"""
        a, b = XN - .5, XT
        if not s.inside(a, y, z):
            return a
        for _ in range(26):
            c = (a + b) / 2
            if s.inside(c, y, z):
                a = c
            else:
                b = c
        return a

    def half(s, x, z):
        """給側面座標，回傳曲面的 |y|（駕駛室側面）。"""
        w, zt, zb, z1, z2, at, ab = s.sec(x)
        if z > zt or z < zb:
            return None
        if z > z2:
            return w - at + at * math.sqrt(max(0, 1 - ((z - z2) / max(zt - z2, 1e-6)) ** 2))
        if z < z1:
            return w - ab + ab * math.sqrt(max(0, 1 - ((z1 - z) / max(z1 - zb, 1e-6)) ** 2))
        return w

    def ring(s, x):
        """半圈斷面點（從底部中線到頂部中線），各段點數固定，斷面之間才對得起來。"""
        w, zt, zb, z1, z2, at, ab = s.sec(x)
        pts = []
        for i in range(5):
            pts.append(((w - ab) * i / 5, zb))
        for i in range(10):
            a = -math.pi / 2 + (math.pi / 2) * i / 10
            pts.append((w - ab + ab * math.cos(a), z1 + (z1 - zb) * math.sin(a)))
        for i in range(10):
            pts.append((w, z1 + (z2 - z1) * i / 10))
        for i in range(12):
            a = (math.pi / 2) * i / 12
            pts.append((w - at + at * math.cos(a), z2 + (zt - z2) * math.sin(a)))
        for i in range(6):
            pts.append(((w - at) * (1 - i / 6), zt))
        pts.append((0., zt))
        return pts


def stations(L):
    xs = [-L / 2, -L / 2 + .10, -1.2, .4, 1.2]
    xs += [1.3 + .1 * i for i in range(11)]            # 1.3–2.3：黑面罩尾巴的切線
    n = 84
    xs += [XN + (XT - XN) * (1 - math.cos(math.pi / 2 * i / n)) ** .85 for i in range(n)]
    return xs


def build_grid(nose, L):
    xs = stations(L)
    rows = []
    for x in xs:
        half = nose.ring(x)
        full = [(y, z) for y, z in half] + [(-y, z) for y, z in reversed(half[1:-1])]
        rows.append([(x, y, z) for y, z in full])
    return rows


def grid_normals(rows):
    n = len(rows[0])
    out = []
    for i, r in enumerate(rows):
        a, b = rows[max(i - 1, 0)], rows[min(i + 1, len(rows) - 1)]
        line = []
        for j in range(n):
            u = [b[j][k] - a[j][k] for k in range(3)]
            # 鼻端圓角放大後，直側與頂平段的點會疊在同一點，要往外找到真的分開的鄰點
            s1 = 1
            while s1 < n // 2 and sum((r[(j + s1) % n][k] - r[j][k]) ** 2 for k in range(3)) < 1e-8:
                s1 += 1
            s2 = 1
            while s2 < n // 2 and sum((r[(j - s2) % n][k] - r[j][k]) ** 2 for k in range(3)) < 1e-8:
                s2 += 1
            p, q = r[(j + s1) % n], r[(j - s2) % n]
            v = [p[k] - q[k] for k in range(3)]
            c = (v[1] * u[2] - v[2] * u[1], v[2] * u[0] - v[0] * u[2], v[0] * u[1] - v[1] * u[0])
            l = math.sqrt(sum(e * e for e in c)) or 1.
            line.append([e / l for e in c])
        out.append(line)
    return out


# --- 2D 場函數（負值＝區域內）---
def sd_poly(pts):
    n = len(pts)

    def f(u, v):
        d = (u - pts[0][0]) ** 2 + (v - pts[0][1]) ** 2
        sign = 1
        j = n - 1
        for i in range(n):
            ax, ay = pts[i]
            bx, by = pts[j]
            ex, ey = bx - ax, by - ay
            wx, wy = u - ax, v - ay
            t = max(0., min(1., (wx * ex + wy * ey) / (ex * ex + ey * ey)))
            dx, dy = wx - ex * t, wy - ey * t
            d = min(d, dx * dx + dy * dy)
            c1, c2, c3 = v >= ay, v < by, ex * wy > ey * wx
            if (c1 and c2 and c3) or (not c1 and not c2 and not c3):
                sign = -sign
            j = i
        return sign * math.sqrt(d)
    return f


def sd_line(pts):
    def f(u, v):
        d = 1e9
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            ex, ey = bx - ax, by - ay
            wx, wy = u - ax, v - ay
            t = max(0., min(1., (wx * ex + wy * ey) / (ex * ex + ey * ey)))
            d = min(d, math.hypot(wx - ex * t, wy - ey * t))
        return d
    return f


def cut(verts, norms, tris, mats, phi, material, only=None, skip=None):
    """沿 phi=0 切開三角形，phi<0 的那側改成 material。only／skip 限定動哪些既有材質。切線上的新頂點用割線法貼到 0。"""
    vals = [phi(*v) for v in verts]
    cache = {}

    def mid(a, b):
        key = (a, b) if a < b else (b, a)
        i = cache.get(key)
        if i is not None:
            return i
        pa, pb, va, vb = verts[a], verts[b], vals[a], vals[b]
        lo, hi, t = 0., 1., va / (va - vb)
        for _ in range(5):
            q = [pa[k] + (pb[k] - pa[k]) * t for k in range(3)]
            v = phi(*q)
            if abs(v) < 1e-5:
                break
            if (v < 0) == (va < 0):
                lo = t
            else:
                hi = t
            t = (lo + hi) / 2
        q = tuple(pa[k] + (pb[k] - pa[k]) * t for k in range(3))
        na, nb = norms[a], norms[b]
        n = [na[k] + (nb[k] - na[k]) * t for k in range(3)]
        l = math.sqrt(sum(e * e for e in n)) or 1.
        verts.append(q)
        norms.append([e / l for e in n])
        vals.append(0.)
        cache[key] = len(verts) - 1
        return cache[key]

    out, om = [], []

    def put(tri, m, inside):
        out.append(tri)
        ok = material is not None and inside and (only is None or m in only) and (skip is None or m not in skip)
        om.append(material if ok else m)

    for tri, m in zip(tris, mats):
        s = [vals[i] < 0 for i in tri]
        if s[0] == s[1] == s[2]:
            put(tri, m, s[0])
            continue
        # 轉到「第一點是單獨那側」
        k = 0 if s[1] == s[2] else 1 if s[0] == s[2] else 2
        a, b, c = tri[k], tri[(k + 1) % 3], tri[(k + 2) % 3]
        ab, ac = mid(a, b), mid(a, c)
        put((a, ab, ac), m, s[k])
        put((ab, b, c), m, not s[k])
        put((ab, c, ac), m, not s[k])
    return out, om


def paint_fields(nose):
    """回傳 [(phi(x,y,z), 材質, only, skip)]，照順序切。"""
    H = nose.H
    # 黑面罩下緣：側視曲線，車頂往後掃到第一扇門上方收尖，往前沿著白色臉頰下到鼻端
    edge = mono([(1.52, H + .02), (1.70, 3.31), (2.05, 3.10), (2.40, 2.72), (2.80, 2.42), (3.20, 2.24), (3.60, 2.12),
                 (3.95, 2.03), (4.30, 1.98), (4.90, 1.95)])

    def mask(x, y, z):
        return edge(x) - z if x > 1.52 else 1.

    # 鼻端黑色上蓋：上緣接面罩，下緣是往下彎的弧
    cap_y = 1.09

    def cap_low(y):
        u = min(1., abs(y) / cap_y)
        return 1.47 + .50 * u ** 2.4

    def cap(x, y, z):
        if x < 3.6:
            return 1.
        return max(cap_low(y) - z, z - 2.02, abs(y) - cap_y)

    # 白色車鉤蓋的 U 形接縫（閉合成多邊形才有正負號，細線才切得出來）與中縫
    u_pts = [(1.11 * (1 - (i / 40) ** 2.8) ** (1 / 2.8), 1.95 - 1.31 * i / 40) for i in range(41)]
    u_sd = sd_poly(u_pts + [(-y, z) for y, z in reversed(u_pts[:-1])])

    def u_field(x, y, z):
        return u_sd(y, z) if x > 3.6 else 1.

    def c_field(x, y, z):
        return y

    # 前窗：上寬下窄的圓角梯形，下緣略帶弧
    glass = sd_poly([(.86, 2.42), (.98, 3.00), (-.98, 3.00), (-.86, 2.42)])

    def windscreen(x, y, z):
        return glass(y, z) - .06 if x > 2.6 else 1.

    frame = sd_poly([(.86, 2.42), (.98, 3.00), (-.98, 3.00), (-.86, 2.42)])

    def windscreen_rim(x, y, z):
        return frame(y, z) - .085 if x > 2.6 else 1.

    # 額頭燈箱
    box = sd_poly([(.32, 3.145), (.36, 3.29), (-.36, 3.29), (-.32, 3.145)])

    def lampbox(x, y, z):
        return box(y, z) - .025 if x > 2.6 else 1.

    # 窗下頭燈座：外高內低的斜四邊形
    lamp_house = sd_poly([(.50, 2.06), (1.17, 2.14), (1.21, 2.34), (.60, 2.28)])

    def lamp_rim(x, y, z):
        return lamp_house(abs(y), z) - .040 if x > 3.2 else 1.

    def lamp_in(x, y, z):
        return lamp_house(abs(y), z) - .025 if x > 3.2 else 1.

    # 駕駛室側窗：黑面罩裡一扇往後上揚的圓角斜四邊形
    cab = sd_poly([(2.50, 2.62), (2.84, 2.56), (3.00, 2.72), (2.66, 2.96)])

    def cabwin(x, y, z):
        return cab(x, z) - .045 if abs(y) > .7 else 1.

    def roof(x, y, z):
        return 3.285 - z

    def eave(x, y, z):
        return max(3.235 - z, z - 3.285, x - 1.60)

    def redbar(x, y, z):
        return max(3.085 - z, z - 3.205, x + 3.45)

    return [
        (roof, 'roof', None, None),
        (eave, 'accent', None, None),
        (redbar, 'emu3red', None, None),
        (mask, 'emu3mask', None, None),
        (cap, 'emu3cap', None, None),
        (('band', u_field, .008, lambda x, y, z: z < 1.92), 'emu3line', None, ('emu3mask', 'emu3cap')),
        (('band', c_field, .006, lambda x, y, z: x > 4. and z < 2.01), 'emu3line', None, ('emu3mask',)),
        (windscreen_rim, 'chassis', None, None),
        (windscreen, 'glass', None, None),
        (lampbox, 'emu3lampglass', None, None),
        (lamp_rim, 'emu3trim', None, None),
        (lamp_in, 'emu3lampglass', None, None),
        (cabwin, 'glass', None, None),
    ]


def build_shell(p, nose, L, name='圓肩主車殼'):
    import bpy
    rows = build_grid(nose, L)
    nrm = grid_normals(rows)
    n = len(rows[0])
    verts, norms = [], []
    for r, q in zip(rows, nrm):
        verts.extend(r)
        norms.extend(q)
    tris = []
    for i in range(len(rows) - 1):
        for j in range(n):
            a, b = i * n + j, i * n + (j + 1) % n
            c, d = (i + 1) * n + (j + 1) % n, (i + 1) * n + j
            tris += [(a, b, c), (a, c, d)]
    # 鼻尖收成一點，法線朝前
    tip = len(verts)
    verts.append((XT, 0., nose.top(1.)))
    norms.append([1., 0., 0.])
    i = len(rows) - 1
    for j in range(n):
        tris.append((i * n + j, i * n + (j + 1) % n, tip))
    # 把疊在同一點的頂點併起來，零面積三角形一起拿掉
    seen, remap, vv, nn = {}, [], [], []
    for v, q in zip(verts, norms):
        key = tuple(round(e, 5) for e in v)
        if key not in seen:
            seen[key] = len(vv)
            vv.append(v)
            nn.append(q)
        remap.append(seen[key])
    verts, norms = vv, nn
    tris = [t for t in ((remap[a], remap[b], remap[c]) for a, b, c in tris) if len(set(t)) == 3]
    ring0 = list(dict.fromkeys(remap[:n]))
    mats = ['body'] * len(tris)
    for phi, material, only, skip in paint_fields(nose):
        if isinstance(phi, tuple):
            # 細線：先沿線的兩側各切一刀，再把夾在中間的三角形上色
            field, w = phi[1], phi[2]
            keep = phi[3] if len(phi) > 3 else (lambda x, y, z: True)
            tris, mats = cut(verts, norms, tris, mats, lambda x, y, z: field(x, y, z) - w, None)
            tris, mats = cut(verts, norms, tris, mats, lambda x, y, z: field(x, y, z) + w, None)
            for i, t in enumerate(tris):
                c = [sum(verts[v][k] for v in t) / 3 for k in range(3)]
                if abs(field(*c)) < w and keep(*c) and (skip is None or mats[i] not in skip):
                    mats[i] = material
        else:
            tris, mats = cut(verts, norms, tris, mats, phi, material, only, skip)
    # 後端封板：同一圈頂點，法線朝後
    cap_face = list(reversed(ring0))
    d = bpy.data.meshes.new(name)
    d.from_pydata(verts, [], [list(t) for t in tris] + [cap_face])
    d.update()
    keys = []
    for m in mats + ['body']:
        if m not in keys:
            keys.append(m)
    keys.sort(key=lambda k: k != 'body')
    for k in keys:
        d.materials.append(p.M[k])
    for poly, m in zip(d.polygons, mats + ['body']):
        poly.material_index = keys.index(m)
        poly.use_smooth = True
    loop_n = []
    for poly in d.polygons:
        is_cap = poly.index == len(tris)
        for li in poly.loop_indices:
            loop_n.append((-1., 0., 0.) if is_cap else tuple(norms[d.loops[li].vertex_index]))
    d.normals_split_custom_set(loop_n)
    p.use('01')
    o = bpy.data.objects.new(name, d)
    p.ACTIVE.objects.link(o)
    p.MODEL.append(o)
    o['primary_body'] = True
    return o


def surface_point(nose, y, z, off):
    f = nose.f
    x = f(y, z)
    e = .01
    fy = (f(y + e, z) - f(y - e, z)) / (2 * e)
    fz = (f(y, z + e) - f(y, z - e)) / (2 * e)
    n = (1., -fy, -fz)
    l = math.sqrt(sum(c * c for c in n))
    return (x + n[0] / l * off, y + n[1] / l * off, z + n[2] / l * off)


def disc(p, nose, name, y, z, r, material, off, n=24):
    """貼著鼻端曲面的圓片。"""
    p.use('03')
    verts = [surface_point(nose, y, z, off)]
    for i in range(n):
        a = 2 * math.pi * i / n
        verts.append(surface_point(nose, y + r * math.cos(a), z + r * math.sin(a), off))
    faces = [(0, 1 + i, 1 + (i + 1) % n) for i in range(n)]
    return p.mesh(name, verts, faces, material, 0, True)


def front_details(p, nose):
    for y in (-.155, .155):
        disc(p, nose, 'EMU3000 額頭燈圈', y, 3.215, .082, 'metal', .010)
        disc(p, nose, 'EMU3000 額頭燈 透鏡', y, 3.215, .064, 'lamp', .016)
    for side in (-1, 1):
        disc(p, nose, 'EMU3000 窗下頭燈圈', side * .93, 2.235, .092, 'metal', .010)
        disc(p, nose, 'EMU3000 窗下頭燈 透鏡', side * .93, 2.235, .072, 'lamp', .016)
        disc(p, nose, 'EMU3000 窗下紅燈圈', side * .70, 2.18, .056, 'metal', .010)
        disc(p, nose, 'EMU3000 窗下紅標誌燈 透鏡', side * .70, 2.18, .040, 'red', .016)
    p.use('03')
    pt = lambda y, z: surface_point(nose, y, z, .030)
    p.line('EMU3000 雨刷臂', [pt(-.30, 2.45), pt(.10, 2.56), pt(.44, 2.66)], .012, 'chassis')
    p.line('EMU3000 雨刷膠條', [pt(.20, 2.50), pt(.46, 2.66), pt(.72, 2.90)], .016, 'frame')


def sides(p, b, s):
    L, W, H = s['L'], s['W'], s['H']
    width, leafcount = .65, 1
    for side in (-1, 1):
        y = side * (W / 2 + .004)
        for x in WIN_X:
            b.sidewindow(x, y, WIN_Z, WIN_W, WIN_H, r=.075)
        for x in DOOR_X:
            p.use('02')
            basez = .92
            dh = H - .28 - basez
            cz = basez + dh / 2
            p.panel('側門門框', (x, y, cz), width + .055, dh + .035, 'frame', r=.026)
            lw = width / leafcount - .025
            door = p.panel('獨立門扇', (x, y + side * .012, cz), lw, dh, 'body', r=.025, depth=.022)
            door['side_door'] = True
            door['door_group'] = 1 if x < 0 else 2
            door['side'] = side
            door['leaf'] = 0
            p.panel('門窗嵌框', (x, y + side * .024, 2.66), lw * .50 + .05, .70 + .05, 'frame', r=.10)
            p.panel('門窗玻璃', (x, y + side * .034, 2.66), lw * .50, .70, 'glass', r=.085, depth=.012)
            p.box('門把凹槽', (x + lw * .32, y + side * .029, 1.52), (.02, .009, .17), 'frame', .005)
            # 踏板外緣維持舊版車寬 1.5155：車庫依車寬縮放整列，月台高度與遊客比例都吃這個數字
            p.box('車門踏板', (x, y + side * .0315, .90), (width + .08, .11, .042), 'metal', .008)
        p.use('02')
        for x in (DOOR_X[0] + .90, DOOR_X[1] - 1.00):
            p.panel('車側目的地顯示器', (x, y + side * .012, SIDE_Z), .42, .13, 'frame', r=.018, depth=.012)
        # 乘務員門：只有門縫與窄窗
        cz = 2.02
        p.panel('乘務員門縫', (CREW_X, y, cz), .47, 2.14, 'emu3seam', r=.03, depth=.012)
        p.panel('乘務員門扇', (CREW_X, y + side * .008, cz), .44, 2.11, 'body', r=.025, depth=.012)
        p.panel('乘務員門窗框', (CREW_X, y + side * .016, 2.60), .22, .78, 'frame', r=.07, depth=.010)
        p.panel('乘務員門窗', (CREW_X, y + side * .022, 2.60), .17, .73, 'glass', r=.055, depth=.008)


def build(p, b, spec):
    L, W, H = spec['L'], spec['W'], spec['H']
    import bpy
    M = p.M
    for k in ('body', 'roof', 'accent'):   # 同名材質要先拿掉，不然 Blender 會改名成 body.001
        bpy.data.materials.remove(M[k])
    M['body'] = p.mat('body', 'F1F2EF', .10, .34, .22)
    M['roof'] = p.mat('roof', 'C4C9CB', .37, .42, .12)
    M['accent'] = p.mat('accent', '232B38', .10, .38, .18)
    M['emu3mask'] = p.mat('emu3mask', '25292E', .40, .34, .30)
    M['emu3cap'] = p.mat('emu3cap', '101215', .30, .26, .45)
    M['emu3trim'] = p.mat('emu3trim', 'AEB4B7', .75, .28, .20)
    M['emu3lampglass'] = p.mat('emu3lampglass', '2B3136', .30, .16, .60)
    M['emu3red'] = p.mat('emu3red', 'C8232C', .05, .34, .25)
    M['emu3seam'] = p.mat('emu3seam', '9DA3A6', .10, .40, .10)
    M['emu3line'] = p.mat('emu3line', '4A5055', .10, .40, .10)
    nose = Nose(W, H)
    build_shell(p, nose, L)
    sides(p, b, spec)
    front_details(p, nose)
    b.bogies(L, W, r=.39)
    for o in p.MODEL:
        if o.name == '車底主梁':
            # 主梁只到鼻端下方，不能穿出收窄的車鼻
            for v in o.data.vertices:
                v.co.x = (v.co.x + 4.272) / 8.544 * (3.78 + 4.272) - 4.272
    p.use('05')
    for x in (-L * .23, .95):
        z = H + .10
        length = 1.8
        p.box('斜肩空調設備罩', (x, 0, z), (length, W * .64, .22), 'roof', .11)
        for sgn in (-1, 1):
            p.grille('空調側格柵', x, sgn * W * .315, z, length * .8, .14, True, 6)
        for k in range(8):
            p.box('空調頂部細格柵', (x - length * .37 + k * length * .105, 0, z + .12), (.035, W * .48, .009), 'chassis', .002)
        for off in (-length * .41, length * .41):
            p.box('罩體邊框', (x + off, 0, z + .11), (.035, W * .60, .05), 'metal', .008)
    b.coupler(-L / 2 - .03, W, -1, gangway=True)
    return nose
