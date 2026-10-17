"""E500（東芝，雙端駕駛室 Co-Co 電力機車，橘色）與 E200（GE 系，雙端駕駛室 Co-Co，上乳白下朱橘）。

已查證（Toshiba Review Vol.79 No.5 表 1、《建築師雜誌》、Train Collection，詳見 catalog notes）：
  E500 車體長 20,770、寬 2,910（維基 infobox 另記 2,759，見 catalog）、降弓全高 4,280、雙端駕駛室、Co-Co、亮橘色。
  E200 車體長 17,049、寬 2,972、降弓全高 4,100、雙端駕駛室、Co-Co、上部乳白／下部朱橘＋白線、端面 V 字形色帶、
  排障器黃黑相間、駕駛端面前方有雙前燈罩。
推斷／照片估計：E500 車頂百葉窗數量與位置、集電弓數量與位置（照片只見一具靠駕駛端；型式取單臂）、駕駛室側門窗精確位置、
  車頭燈具與連結器細部、車下設備；E200 車頂設備與集電弓位置、車側嵌板縫位置、車頭燈具細部。
兩款都是「兩端同一個車頭」：本檔輸出的是單輛機車（中心＝連結器間距中心＋0.175 m；車頭尖端在 +pitch/2，
連結端車身末端在 -pitch/2+0.35），推拉式編組尾端的那輛由 replay.js 以同一個網格旋轉 180°。
"""
from common import *
from parts import roof_unit

# ------------------------------------------------------------------ 共用：雙駕駛室機車
def build_dcab(sp, lod, pitch, Ln, curves, elems_L, elems_R=None, decal_fn=None, roof_fn=None, belly_items=None,
               bogie_xs=None, wb=2.0, axles=3, r_wheel=0.5, u_switch=0.5, body_col=None, col_fn=None, n_st=14,
               subdiv=2, nose_power=1.6, belly_span=None, pilot_fn=None, cap_bands=None):
    x_tip = pitch / 2
    x_rear = -pitch / 2 + HALF_GAP
    xf0, xr0 = x_tip - Ln, x_rear + Ln
    m = Mesh()
    prof = sp['profile'](lod)
    band = sp['band']
    layout = Layout(band, sp['kinds'](lod), resolve(elems_L), resolve(elems_R) if elems_R is not None else None)
    wall_panels(m, prof, 'L', xr0, xf0, layout)
    wall_panels(m, prof, 'R', xr0, xf0, layout)
    roof_loft(m, prof, xr0, xf0, sp['roof_col'])
    floor_plate(m, prof, xr0, xf0, UNDER)
    for x0, sg, xt in ((xf0, +1, x_tip), (xr0, -1, x_rear)):
        nose, nk = make_nose(prof, x0, Ln, sg, curves, subdiv=subdiv if lod == 0 else 1)
        nose_loft(m, nose, nk, band, sp['roof_col'], body_col or band.at(2.0)[0], u_switch=u_switch,
                  n_st=n_st if lod == 0 else max(6, n_st // 2), power=nose_power, col_fn=col_fn, cap_bands=cap_bands)
        m.tag = 'decal'
        if decal_fn:
            decal_fn(m, nose, xt, lod)
        if pilot_fn:
            pilot_fn(m, xt, sg, lod)
    if roof_fn:
        roof_fn(m, sp, lod)
    for x in (bogie_xs or []):
        bogie(m, x, r=r_wheel, wb=wb, lod=lod, axles=axles)
    bsp = belly_span or (xr0 + 1.0, xf0 - 1.0)
    belly(m, bsp[0], bsp[1], sp['zb'], sp['W'], lod=lod, items=belly_items or [], zlow=0.62)
    return m


def poly_v(pts, t):
    """折線 pts=[(y,z),..] 加上垂直厚度 t 成為一條帶狀多邊形（用於 V 形色帶）。"""
    top = [(y, z + t / 2) for y, z in pts]
    bot = [(y, z - t / 2) for y, z in reversed(pts)]
    return top + bot


def dist_elems(pairs, x_ref, sign):
    """把「自車頭起點 x_ref 往車身內部量的距離區間 (a,b,kind)」轉成絕對 x 元素（sign=+1 前端、-1 後端）。"""
    out = []
    for a, b, k in pairs:
        p, q = x_ref - sign * a, x_ref - sign * b
        out.append((min(p, q), max(p, q), k))
    return out


# ================================================================== E500
E5_ORANGE = C('#ee6a25')
E5_BLACK = C('#22252a')
E5_ROOF = C('#3a3d41')
E5_SKIRT = C('#c85a1e')
E5_LAMP = C('#f2efe4')
E5_RED = C('#c5352b')
E5_WIND = C('#3a4a55')
E5_PLATE = C('#4b5055')
E5_ZS, E5_ZC = 3.30, 3.92


def e500_spec():
    return dict(
        id='e500', W=2.91, body=20.77, pitch=21.12, zb=0.95,
        profile=lambda lod: Profile(hw=1.455, zb=0.95, z_sh=E5_ZS, z_c=E5_ZC, inset=0.12, cham=0.10, z_belt=1.6,
                                    K=6 if lod == 0 else 3, pieces=1, expo=3.0),
        band=Band([(0.0, 1.04, E5_SKIRT)], E5_ORANGE, g=0.4),
        roof_col=E5_ROOF,
        kinds=lambda lod: {**win_kinds(2.58, 3.26, f=0.045, frame=E5_BLACK), 'dgap': [(1.04, E5_ZS, C('#8a3a16'), 0.2)],
                           'seam': [(1.08, E5_ZS, C('#b9531b'), 0.2)]},
        bellows=dict(w=2.0, z0=1.1, z1=3.1),
    )


def e500_side(Ln, x_tip, sign, lod):
    """駕駛室側門窗（距車頭起點的距離）：門窗、窄窗、門縫、嵌板縫。"""
    xs = x_tip - sign * Ln
    p = [(0.10, 0.14, 'dgap'), (1.38, 1.42, 'dgap')]
    if lod == 0:
        p += [(0.32, 0.32 + 0.045, 'win_f'), (0.365, 1.05, 'win_g'), (1.05, 1.05 + 0.045, 'win_f'),
              (1.55, 1.55 + 0.045, 'win_f'), (1.595, 1.80, 'win_g'), (1.80, 1.845, 'win_f')]
        p += [(5.0, 5.03, 'seam'), (7.2, 7.23, 'seam')]
    else:
        p += [(0.32, 1.10, 'win_g')]
    return dist_elems(p, xs, sign)


def e500_curves():
    hw = [(0, 1.455), (0.45, 1.44), (0.8, 1.36), (1.0, 1.28)]
    top = [(0, E5_ZC), (0.6, E5_ZC), (1.0, E5_ZC - 0.02)]
    bot = [(0, 0.95), (0.5, 0.90), (1.0, 0.66)]
    nexp = [(0, 3.0), (0.5, 3.6), (1, 5.0)]
    mw = [(0, 0.0), (0.3, 0.45), (1, 0.92)]

    def setback(u, z):
        t = np.clip((z - 2.45) / (E5_ZC - 2.45), 0, 1)
        return 0.90 * np.power(np.clip(u, 0, 1), 1.15) * np.power(t, 1.05)
    return hw, top, bot, nexp, mw, setback


def e500_col(kind, u, xc, yc, zc):
    if kind == 'roof':
        return E5_BLACK if u > 0.02 else E5_ROOF, 0.5
    if kind == 'floor':
        return UNDER, 0.1
    zb = 3.28 - 0.78 * float(np.clip((u - 0.10) / 0.85, 0, 1) ** 1.2)
    if zc > zb:
        return E5_BLACK, 0.5
    if zc < 1.04:
        return E5_SKIRT, 0.4
    return E5_ORANGE, 0.4


def e500_decals(m, nose, x_tip, lod):
    h = 0.10 if lod == 0 else 0.35
    lm = 0.22 if lod == 0 else 0.7
    nose.decal_front(m, rrect(0, 3.17, 1.86, 0.86, 0.24, 4), E5_WIND, 0.95, 0.030, h=h, lmax=lm)
    nose.decal_front(m, rrect(0, 1.14, 1.90, 0.92, 0.08, 2), C('#24282c'), 0.3, 0.030, h=h, lmax=lm)
    if lod == 0:
        nose.decal_front(m, rrect(0, 3.82, 0.90, 0.20, 0.05, 2), C('#c8cbcd'), 0.6, 0.030, h=0.06)
        for s_ in (-1, 1):
            nose.decal_front(m, ellipse(s_ * 0.20, 3.82, 0.075, 0.075, 10), E5_LAMP, 0.9, 0.048, h=0.04)
        nose.decal_front(m, ellipse(-1.02, 2.12, 0.16, 0.105, 12), C('#1a1d20'), 0.7, 0.030, h=0.05)
        nose.decal_front(m, ellipse(-1.02, 2.12, 0.075, 0.075, 10), E5_LAMP, 0.9, 0.046, h=0.04)
        nose.decal_front(m, ellipse(0.72, 2.12, 0.34, 0.105, 14), C('#1a1d20'), 0.7, 0.030, h=0.05)
        nose.decal_front(m, ellipse(0.58, 2.12, 0.075, 0.075, 10), E5_RED, 0.8, 0.046, h=0.04)
        nose.decal_front(m, ellipse(0.88, 2.12, 0.075, 0.075, 10), E5_LAMP, 0.9, 0.046, h=0.04)
        nose.decal_front(m, [(-0.72, 2.03), (-0.42, 2.03), (-0.36, 2.25), (-0.66, 2.25)], C('#f4f1ea'), 0.5, 0.030, h=0.05)   # R 標誌（示意）
        nose.decal_front(m, [(-0.012, 0.70), (0.012, 0.70), (0.012, 1.60), (-0.012, 1.60)], C('#111417'), 0.3, 0.046, h=0.2, lmax=0.4)


def e500_pilot(m, x_tip, sign, lod):
    m.tag = 'decal'
    box(m, (x_tip - sign * 0.12, 0, 0.30), (0.62, 2.04, 0.24), E5_PLATE, g=0.4)
    if lod == 0:
        box(m, (x_tip + sign * 0.02, 0, 1.02), (0.46, 0.40, 0.32), EQUIP)          # 連結器頭


def e500_roof(m, sp, lod):
    dark, dark2 = C('#33363a'), C('#3e4247')
    zc = E5_ZC
    for k in range(7):
        xc = -6.8 + 1.5 * k
        roof_unit(m, xc, 0, zc - 0.05, 1.32, 2.05, 0.20 + 0.05, dark, top=dark2, bevel=0.10, g=0.35, vent=False)
    for xc in (-8.0, 7.9):
        roof_unit(m, xc, 0, zc - 0.05, 1.5, 2.05, 0.20 + 0.05, dark, top=dark2, bevel=0.10, g=0.35, vent=False)
    if lod == 0:
        for k in range(4):
            cyl(m, (6.7 + 0.30 * k, 0, zc + 0.02 + 0.10), 'z', 0.07, 0.24, C('#7b4a36'), seg=8, g=0.4)     # 礙子
    pantograph(m, 5.2, zc + 0.02, lod=lod, hfold=0.35, width=1.95, facing=-1, base_w=1.5)


E5_BELLY = [(-7.2, 2.6, 0.52, 0.98, 1.10), (-2.6, 1.9, 0.52, 0.98, 1.05), (0.2, 2.6, 0.52, 0.98, 1.10), (3.0, 1.8, 0.52, 0.98, 1.05), (6.6, 2.4, 0.52, 0.98, 1.10)]


def build_e500(lod):
    sp = e500_spec()
    Ln = 1.9
    x_tip, x_rear = 21.12 / 2, -21.12 / 2 + HALF_GAP
    el = e500_side(Ln, x_tip, +1, lod) + e500_side(Ln, x_rear, -1, lod)
    m = build_dcab(sp, lod, 21.12, Ln, e500_curves(), el, decal_fn=e500_decals, roof_fn=e500_roof, belly_items=E5_BELLY,
                   bogie_xs=[0.175 - 5.6, 0.175 + 5.6], wb=1.95, axles=3, r_wheel=0.52, col_fn=e500_col, n_st=14, pilot_fn=e500_pilot,
                   belly_span=(-3.3, 3.6), cap_bands=[(None, 2.5, E5_ORANGE, 0.4), (2.5, None, E5_BLACK, 0.5)])
    return m, sp


# ================================================================== E200
E2_ORANGE = C('#e5632b')
E2_CREAM = C('#ece2c8')
E2_WHITE = C('#f2eee2')
E2_ROOF = C('#c8c4b6')
E2_SKIRT = C('#3a3d40')
E2_YELLOW = C('#e8b81c')
E2_BLK = C('#1e2124')
E2_ZS, E2_ZC = 3.36, 3.74


def e200_spec():
    return dict(
        id='e200', W=2.972, body=17.049, pitch=17.40, zb=0.95,
        profile=lambda lod: Profile(hw=1.486, zb=0.95, z_sh=E2_ZS, z_c=E2_ZC, inset=0.06, cham=0.10, z_belt=1.6,
                                    K=6 if lod == 0 else 3, pieces=1, expo=2.6),
        band=Band([(0.0, 1.05, E2_SKIRT), (1.05, 2.28, E2_ORANGE), (2.28, 2.36, E2_WHITE), (2.36, 2.50, E2_ORANGE)], E2_CREAM, g=0.4),
        roof_col=E2_ROOF,
        kinds=lambda lod: {**win_kinds(2.62, 3.42, f=0.045, frame=C('#7c3a18')), 'dgap': [(1.05, E2_ZS, C('#8f4520'), 0.2)],
                           'seam': [(1.10, E2_ZS, C('#9a9482'), 0.2)],
                           'door': [(1.05, E2_ZS, E2_ORANGE, 0.4)]},
        bellows=dict(w=2.0, z0=1.1, z1=3.1),
    )


def e200_side(Ln, x_tip, sign, lod):
    xs = x_tip - sign * Ln
    p = [(0.16, 0.20, 'dgap'), (1.34, 1.38, 'dgap')]
    if lod == 0:
        p += [(0.36, 0.36 + 0.045, 'win_f'), (0.405, 1.10, 'win_g'), (1.10, 1.10 + 0.045, 'win_f'),
              (4.5, 4.53, 'seam'), (8.0 - 0.0, 8.03, 'seam')]
    else:
        p += [(0.36, 1.15, 'win_g')]
    return dist_elems(p, xs, sign)


def e200_curves():
    hw = [(0, 1.486), (0.5, 1.47), (1.0, 1.40)]
    top = [(0, E2_ZC), (1.0, E2_ZC - 0.04)]
    bot = [(0, 0.95), (0.5, 0.90), (1.0, 0.66)]
    nexp = [(0, 2.8), (0.5, 3.4), (1, 4.6)]
    mw = [(0, 0.0), (0.3, 0.35), (1, 0.85)]

    def setback(u, z):
        t = np.clip((z - 2.55) / (E2_ZC - 2.55), 0, 1)
        return 0.30 * np.power(np.clip(u, 0, 1), 1.1) * t
    return hw, top, bot, nexp, mw, setback


def e200_col(kind, u, xc, yc, zc):
    if kind == 'roof':
        return E2_ROOF, 0.3
    if kind == 'floor':
        return UNDER, 0.1
    return None                                     # 牆面沿用側牆色帶（上乳白、下朱橘、白線繞過車頭側面）


def e200_decals(m, nose, x_tip, lod):
    h = 0.10 if lod == 0 else 0.35
    lm = 0.22 if lod == 0 else 0.7
    wind = C('#3b4a55')
    for s_ in (-1, 1):
        nose.decal_front(m, rrect(s_ * 0.66, 3.10, 0.90, 0.66, 0.16, 4), wind, 0.95, 0.030, h=h, lmax=lm)
    nose.decal_front(m, poly_v([(-1.28, 2.14), (0.0, 1.36), (1.28, 2.14)], 0.24), E2_CREAM, 0.5, 0.026, h=h, lmax=lm)
    nose.decal_front(m, rrect(0, 1.14, 1.80, 0.56, 0.05, 2), C('#26292c'), 0.3, 0.030, h=h, lmax=lm)
    for s_ in (-1, 1):
        nose.decal_front(m, rrect(s_ * 0.60, 2.66, 0.52, 0.20, 0.03, 2), E2_BLK, 0.7, 0.030, h=0.06)
    # 前燈罩：車頂前緣的小盒（雙圓燈）
    m.tag = 'decal'
    xs = nose.x_at(1.0)
    hbox(m, xs - nose.sign * 0.30, 0.22, 3.50, 0.34, 0.66, 0.26, 0.05, 0.04, C('#b7b9b8'), 0.4)
    if lod == 0:
        for s_ in (-1, 1):
            cyl(m, (xs - nose.sign * (0.30 - 0.17 - 0.005), 0.22 + s_ * 0.16, 3.63), 'x', 0.075, 0.03, E5_LAMP, seg=10, g=0.9)


def e200_pilot(m, x_tip, sign, lod):
    m.tag = 'decal'
    for k in range(4):                                           # 黃黑相間排障器（示意）
        col = E2_YELLOW if k % 2 == 0 else E2_BLK
        box(m, (x_tip - sign * 0.16, -0.75 + 0.5 * k, 0.70), (0.30, 0.50, 0.70), col, g=0.4)
    box(m, (x_tip - sign * 0.06, 0, 0.30), (0.56, 2.10, 0.22), C('#2c3034'), g=0.4)
    if lod == 0:
        box(m, (x_tip + sign * 0.03, 0, 1.06), (0.44, 0.38, 0.30), EQUIP)


def e200_roof(m, sp, lod):
    dark, dark2 = C('#7c7a70'), C('#8b897e')
    zc = E2_ZC
    for xc in (-2.4, 0.3):
        roof_unit(m, xc, 0, zc - 0.05, 2.3, 1.9, 0.20, dark, top=dark2, bevel=0.10, g=0.35, vent=(lod == 0))
    hbox(m, 7.05, 0.0, zc - 0.05, 1.3, 1.1, 0.18, 0.10, 0.08, C('#a09d90'), 0.3)
    hbox(m, -7.05, 0.0, zc - 0.05, 1.3, 1.1, 0.18, 0.10, 0.08, C('#a09d90'), 0.3)
    pantograph(m, 3.4, zc + 0.02, lod=lod, hfold=0.34, width=1.7, facing=-1, base_w=1.4)


E2_BELLY = [(-4.6, 2.2, 0.52, 0.98, 1.10), (-1.0, 2.0, 0.52, 0.98, 1.05), (2.4, 2.2, 0.52, 0.98, 1.10), (5.2, 1.6, 0.52, 0.98, 1.0)]


def build_e200(lod):
    sp = e200_spec()
    Ln = 1.5
    x_tip, x_rear = 17.40 / 2, -17.40 / 2 + HALF_GAP
    el = e200_side(Ln, x_tip, +1, lod) + e200_side(Ln, x_rear, -1, lod)
    m = build_dcab(sp, lod, 17.40, Ln, e200_curves(), el, decal_fn=e200_decals, roof_fn=e200_roof, belly_items=E2_BELLY,
                   bogie_xs=[0.175 - 4.6, 0.175 + 4.6], wb=1.7, axles=3, r_wheel=0.5, col_fn=e200_col, n_st=12, pilot_fn=e200_pilot,
                   belly_span=(-2.9, 3.2), cap_bands=[(None, 2.50, E2_ORANGE, 0.4), (2.50, None, E2_CREAM, 0.4)])
    return m, sp


BUILDERS = {
    'e500': build_e500,
    'e200': build_e200,
}
