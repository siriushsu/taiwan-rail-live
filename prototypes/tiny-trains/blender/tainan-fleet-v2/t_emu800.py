"""EMU800 區間車（日本車輛＋台灣車輛）：ED 駕駛車、EP 中間車（集電弓＋廁所）。第一批「微笑號」塗裝（藍面黃弧）。

已查證：日車官網車体寸法 ED 21,250、其餘 19,600、寬 2,890、高 3,700／3,650；pitch 21,600／20,300；
全高 3,990、EP 降弓 4,234；每側 3 門；EMa 六大窗；EP 集電弓（Brecknell Willis 單臂）與廁所小窗靠 EMb 端；
ED 車尾一端小窗（廁所）、另一端一大窗；車側色帶：窗上方黃帶、窗下方黃藍帶；駕駛端面藍底黃色弧形色帶。
本頁 3 節編組＝ED＋EP＋ED（中間車取 EP）。推斷／照片估計：門與窗的精確位置、門窗形狀、冷氣機數量與位置。
"""
from common import *

SILVER = C('#b4b8ba')
SILVER_LOW = C('#a0a5a8')
SILVER_ROOF = C('#a3a7aa')
CHIN = C('#c5c8ca')
BLUE = C('#2f50b4')
YELLOW = C('#f0c52a')
DOOR = C('#a9aeb1')
ZLO, ZHI = 1.60, 2.62


def spec():
    return dict(
        id='emu800', W=2.89, body=19.6, pitch=20.3, zb=0.95,
        profile=lambda lod: Profile(hw=1.445, zb=0.95, z_sh=3.30, z_c=3.65, inset=0.06, cham=0.10, z_belt=1.5,
                                    K=6 if lod == 0 else 3, pieces=2 if lod == 0 else 1),
        band=Band([(0.0, 1.28, SILVER_LOW), (1.28, 1.42, BLUE), (1.42, 1.55, YELLOW), (1.55, 2.78, SILVER),
                   (2.78, 2.92, YELLOW), (2.92, 9.0, SILVER)], SILVER, g=0.35),
        roof_col=SILVER_ROOF,
        kinds=lambda lod: {**win_kinds(ZLO, ZHI),
                           'door': [(1.05, 3.05, DOOR, 0.3)], 'dgap': [(1.03, 3.07, GAP, 0.2)],
                           'dwin': [(1.75, 2.72, GLASS, 0.9)], 'swin': [(2.05, 2.55, C('#8b979f'), 0.6)],
                           'cabwin': [(1.9, 2.75, GLASS, 0.9)],
                           'winband': [(ZLO - 0.035, ZHI + 0.035, GLASS, 0.8)]},
        bellows=dict(w=2.0, z0=1.10, z1=3.20),
        bogie_x=6.9, wb=2.5,
    )


def door2(xc, w=1.35, lod=0):
    """雙扇滑門：兩側門縫、中縫、兩片門板（各含一扇窄窗）。xc=門中心。"""
    x0 = xc - w / 2
    if lod >= 1:
        return [(x0, x0 + w, 'door')]
    el = [(x0, x0 + 0.035, 'dgap'), (xc - 0.0175, xc + 0.0175, 'dgap'), (x0 + w - 0.035, x0 + w, 'dgap')]
    if lod == 0:
        for lx in (x0 + 0.13, xc + 0.0175 + 0.13):
            el.append((lx, lx + 0.34, ('dwin', 'door')))
    el.append((x0, x0 + w, 'door'))
    return el


def mid_elems(lod, ep=False):
    """中間車（EMa／EP）側牆元素（絕對 x，車體 -9.8..9.8）。門在 -7、0、+7；每側六大窗（EP：-x 端窗換成廁所小窗）。"""
    el = []
    for xc in (-7.0, 0.0, 7.0):
        el += door2(xc, lod=lod)
    if lod == 0:
        wins = [(-9.4, 1.30), (-5.65, 1.8), (-3.25, 1.8), (1.45, 1.8), (3.85, 1.8), (8.1, 1.30)]
        for x0, w in wins:
            if ep and x0 == -9.4:
                el += [(-9.15, -8.65, 'swin')]   # 廁所霧面小窗（靠 EMb 端）
                continue
            el += [(x0 - 0.035, x0, 'win_f'), (x0, x0 + w, 'win_g'), (x0 + w, x0 + w + 0.035, 'win_f')]
    else:
        el += [(-9.4, -7.7, 'winband'), (-6.3, -0.7, 'winband'), (0.7, 6.3, 'winband'), (7.7, 9.4, 'winband')]
    return el


def roof_fn(ep):
    def fn(m, sp, lod):
        zc, hh = 3.65, 0.34
        col, top = C('#bfc3c6'), C('#c9cdd0')
        if not ep:
            for xc in (-4.6, 4.6):
                roof_unit(m, xc, 0, zc - 0.03, 4.4, 1.9, hh + 0.03, col, top=top, bevel=0.25, vent=(lod == 0))
        else:
            roof_unit(m, 5.4, 0, zc - 0.03, 4.4, 1.9, hh + 0.03, col, top=top, bevel=0.25, vent=(lod == 0))
            m.tag = 'roof'
            hbox(m, -1.6, 0, zc - 0.03, 3.2, 1.3, 0.30, 0.20, 0.14, C('#b6babd'), 0.3)          # 高壓／電氣室罩
            pantograph(m, -6.4, zc, lod=lod, hfold=0.5935, facing=-1)
    return fn


BELLY = [(-3.4, 1.7, 0.46, 0.95, 1.10), (-1.0, 1.4, 0.50, 0.95, 1.05), (1.3, 2.0, 0.48, 0.95, 1.12), (3.6, 1.4, 0.50, 0.95, 1.05)]


def build_mid_car(lod, ep=True):
    sp = spec()
    return build_mid(sp, lod, mid_elems(lod, ep), roof_fn=roof_fn(ep), belly_items=BELLY), sp


def nose_curves():
    hw = [(0, 1.445), (0.4, 1.44), (0.7, 1.40), (0.88, 1.32), (0.96, 1.22), (1.0, 1.10)]
    top = [(0, 3.65), (0.5, 3.63), (0.8, 3.55), (0.93, 3.47), (1.0, 3.38)]
    bot = [(0, 0.95), (0.5, 0.92), (0.85, 0.75), (1.0, 0.50)]
    nexp = [(0, 2.6), (0.6, 3.4), (1, 4.0)]
    mw = [(0, 0.0), (0.3, 0.3), (1, 0.8)]
    return hw, top, bot, nexp, mw


def smile_z(y, c=1.78, edge=2.40, half=1.08):
    return c + (edge - c) * (y / half) ** 2


def face_poly(half, ztop, r, zc_fn, n=24):
    """臉板：上緣圓角矩形、下緣為微笑弧。逆時針。"""
    pts = []
    ys = np.linspace(-half, half, n)
    for y in ys:                                   # 下緣（左→右）
        pts.append((float(y), float(zc_fn(y))))
    zr0 = zc_fn(half)
    for k in range(0, 7):                          # 右上角
        a = math.radians(0 + 90 * k / 6)
        pts.append((half - r + r * math.cos(a), ztop - r + r * math.sin(a)))
    for k in range(0, 7):                          # 左上角
        a = math.radians(90 + 90 * k / 6)
        pts.append((-half + r + r * math.cos(a), ztop - r + r * math.sin(a)))
    return pts


DARKG = C('#1d2328')
LAMP = C('#eeece0')
SIGN = C('#2a3238')


def decals(m, nose, x_tip, lod):
    h = 0.10 if lod == 0 else 0.35
    lm = 0.22 if lod == 0 else 0.7
    # 黃色底（露出的邊即黃弧）＋藍色臉板
    nose.decal_front(m, face_poly(1.17, 3.36, 0.34, lambda y: smile_z(y, 1.50, 2.36, 1.17)), YELLOW, 0.6, 0.020, h=h, lmax=lm)
    nose.decal_front(m, face_poly(1.08, 3.44, 0.30, lambda y: smile_z(y, 1.76, 2.40, 1.08)), BLUE, 0.6, 0.032, h=h, lmax=lm)
    # 擋風玻璃
    nose.decal_front(m, rrect(0, 2.66, 1.80, 0.62, 0.07, 3), C('#33434e'), 0.95, 0.044, h=h, lmax=lm)
    if lod == 0:
        nose.decal_front(m, [(-0.02, 2.36), (0.02, 2.36), (0.02, 2.96), (-0.02, 2.96)], DARKG, 0.5, 0.050, h=0.2, lmax=0.4)
    if lod == 0:
        for s_ in (-1, 1):
            nose.decal_front(m, ellipse(s_ * 0.86, 3.14, 0.17, 0.12, 12), LAMP, 0.9, 0.044, h=0.06)
            for yy in (0.32, 0.74):
                nose.decal_front(m, ellipse(s_ * yy, 2.02, 0.10, 0.10, 10), C('#cfd2d0'), 0.9, 0.044, h=0.05)
            for k in range(3):                       # 車頭下方通風格柵
                nose.decal_front(m, [(s_ * 0.60 - 0.13, 0.80 + k * 0.07), (s_ * 0.60 + 0.13, 0.80 + k * 0.07),
                                     (s_ * 0.60 + 0.13, 0.83 + k * 0.07), (s_ * 0.60 - 0.13, 0.83 + k * 0.07)], DARKG, 0.3, 0.030, h=0.09, lmax=0.3)
        nose.decal_front(m, [(-0.012, 0.62), (0.012, 0.62), (0.012, 1.46), (-0.012, 1.46)], DARKG, 0.3, 0.030, h=0.2, lmax=0.4)   # 連結器罩中縫
    nose.decal_front(m, rrect(0, 3.14, 0.62, 0.20, 0.03, 2), SIGN, 0.9, 0.044, h=h, lmax=lm)


def build_ed(lod):
    sp = spec()
    pitch, Ln = 21.6, 1.9
    x_tip = pitch / 2
    x_rear = -pitch / 2 + HALF_GAP
    xn0 = x_tip - Ln
    el = []
    for xc in (4.4, -1.6, -7.6):
        el += door2(xc, lod=lod)
    el += [(xn0 - 0.95, xn0 - 0.30, ('cabwin', 'door'))] + [(xn0 - 0.98, xn0 - 0.945, 'dgap'), (xn0 - 0.30, xn0 - 0.265, 'dgap')]
    if lod == 0:
        for x0, w in ((5.6, 1.8), (-0.45, 1.6), (1.65, 1.6), (-6.45, 1.6), (-4.35, 1.6)):
            el += [(x0 - 0.035, x0, 'win_f'), (x0, x0 + w, 'win_g'), (x0 + w, x0 + w + 0.035, 'win_f')]
        el += [(-9.55, -9.05, 'swin')]           # 車尾一端的廁所小窗
    else:
        el += [(5.6, 7.4, 'winband'), (-0.45, 3.25, 'winband'), (-6.45, -2.75, 'winband')]

    def rf(m, s, lod_):
        zc, hh = 3.65, 0.34
        for xc in (-5.3, 0.4):
            roof_unit(m, xc, 0, zc - 0.03, 4.4, 1.9, hh + 0.03, C('#bfc3c6'), top=C('#c9cdd0'), bevel=0.25, vent=(lod_ == 0))

    bogies = [-6.9 + 0.175, 6.2]
    m = build_cab(sp, lod, pitch, Ln, nose_curves(), el, decal_fn=decals, roof_fn=rf, belly_items=[(-6.0, 1.4, 0.46, 0.95, 1.05), (-2.2, 2.0, 0.48, 0.95, 1.10), (1.6, 1.6, 0.50, 0.95, 1.05)],
                  bogie_xs=bogies, wb=sp['wb'], u_switch=0.45, body_col=CHIN, n_st=14, belly_span=(-5.2, 4.2))
    return m, sp


BUILDERS = {
    'emu800': build_ed,
    'emu800-ep': lambda lod: build_mid_car(lod, ep=True),
}
