"""TEMU2000 普悠瑪（日本車輛，傾斜式）：TED 駕駛車、TEMA/TEMB 中間車、TEP（單臂集電弓＋育嬰室大窗）。

已查證：日車官網車体寸法 TED 21,745、其餘 20,000、寬 2,900、高 3,632／3,565；pitch 22,095／20,700；全高 4,050；
TEP 降弓高度兩說 4,300／4,170（取 4,170：車頂高 3,565＋集電弓折疊約 0.6 m 的合理值，另一說記於 catalog）；
單臂集電弓（工進精工所）直接裝在 TEP 車頂；小窗；上下台門緊鄰客室、盥洗室在車端；圓弧形空調機；
白底、窗下寬紅帶＋兩條細線；駕駛端面紅色基調。
推斷／照片估計：窗距（每座位排一窗）、門與窗精確位置、冷氣機數量與位置、車頭細部；車側「TRA」草書字樣略。
"""
from common import *

WHITE = C('#f0f0ee')
LOW = C('#c9cccd')
RED = C('#cf2a2e')
DOOR = C('#e6e7e6')
ZLO, ZHI = 1.72, 2.48
WW, WP = 0.52, 0.98


def spec():
    return dict(
        id='temu2000', W=2.90, body=20.0, pitch=20.7, zb=0.95,
        profile=lambda lod: Profile(hw=1.45, zb=0.95, z_sh=3.12, z_c=3.565, inset=0.20, cham=0.10, z_belt=1.6,
                                    K=7 if lod == 0 else 3, pieces=2 if lod == 0 else 1, expo=2.3),
        band=Band([(0.0, 1.02, LOW), (1.14, 1.22, RED), (1.27, 1.60, RED)], WHITE, g=0.35),
        roof_col=C('#d6d8d8'),
        kinds=lambda lod: {**win_kinds(ZLO, ZHI),
                           'door': [(1.10, 3.00, DOOR, 0.3)], 'dgap': [(1.08, 3.02, GAP, 0.2)],
                           'dwin': [(1.75, 2.75, GLASS, 0.9)], 'swin': [(2.05, 2.50, C('#8b979f'), 0.6)],
                           'big': [(1.62, 2.72, GLASS, 0.9)], 'cabwin': [(1.9, 2.75, GLASS, 0.9)],
                           'winband': [(ZLO - 0.035, ZHI + 0.035, GLASS, 0.8)]},
        bellows=dict(w=2.0, z0=1.10, z1=3.15),
        bogie_x=7.0, wb=2.5,
    )


def door1(x0, w=1.0, lod=0):
    """單扇塞拉式滑門（含門窗）。x0=左緣。"""
    el = [(x0, x0 + 0.035, 'dgap'), (x0 + w - 0.035, x0 + w, 'dgap')]
    if lod == 0:
        el.append((x0 + 0.22, x0 + 0.22 + 0.36, ('dwin', 'door')))
    el.append((x0, x0 + w, 'door'))
    return el


def mid_elems(lod, tep=False, Lb=20.0):
    hx = Lb / 2
    el = door1(-hx + 2.7, lod=lod) + door1(hx - 3.7, lod=lod)
    if lod == 0:
        n = 12 if tep else 13
        x_first = -hx + 4.2 if not tep else -hx + 4.2
        for i in range(n):
            x0 = x_first + i * WP
            if x0 + WW > hx - 3.9:
                break
            el += [(x0 - 0.035, x0, 'win_f'), (x0, x0 + WW, 'win_g'), (x0 + WW, x0 + WW + 0.035, 'win_f')]
        if tep:
            el += [(-hx + 0.45, -hx + 1.95, 'big')]      # 育嬰室大窗（-x 端）
        else:
            el += [(-hx + 0.75, -hx + 1.25, 'swin')]     # 廁所霧面小窗
        el += [(hx - 1.25, hx - 0.75, 'swin')]
    else:
        el += [(-hx + 4.1, hx - 3.9, 'winband')]
    return el


def roof_fn(tep):
    def fn(m, sp, lod):
        zc = 3.565
        col, top = C('#cfd2d3'), C('#dadddd')
        hh = 0.485
        if not tep:
            for xc in (-4.6, 4.6):
                roof_unit(m, xc, 0, zc - 0.05, 3.6, 1.70, hh + 0.05, col, top=top, bevel=0.42, vent=False)
        else:
            roof_unit(m, 5.6, 0, zc - 0.05, 3.4, 1.70, hh + 0.05, col, top=top, bevel=0.42, vent=False)
            m.tag = 'roof'
            hbox(m, 1.6, 0, zc - 0.05, 2.4, 1.2, 0.32, 0.2, 0.15, C('#bfc3c4'), 0.3)
            pantograph(m, -5.5, zc, lod=lod, hfold=0.615, facing=-1)
    return fn


BELLY = [(-3.4, 1.7, 0.46, 0.95, 1.10), (-1.0, 1.4, 0.50, 0.95, 1.05), (1.3, 2.0, 0.48, 0.95, 1.12), (3.6, 1.4, 0.50, 0.95, 1.05)]


def build_mid_car(lod, tep=False):
    sp = spec()
    return build_mid(sp, lod, mid_elems(lod, tep), roof_fn=roof_fn(tep), belly_items=BELLY), sp


def nose_curves():
    hw = [(0, 1.45), (0.4, 1.44), (0.7, 1.38), (0.9, 1.28), (1.0, 1.15)]
    top = [(0, 3.565), (0.4, 3.55), (0.75, 3.40), (0.93, 3.22), (1.0, 3.10)]
    bot = [(0, 0.95), (0.6, 0.90), (0.9, 0.62), (1.0, 0.42)]
    nexp = [(0, 2.6), (0.6, 3.6), (1, 4.5)]
    mw = [(0, 0.0), (0.3, 0.3), (1, 0.8)]
    return hw, top, bot, nexp, mw


DARKH = C('#1c2226')
LAMPL = C('#e9e6d6')


def decals(m, nose, x_tip, lod):
    h = 0.10 if lod == 0 else 0.35
    lm = 0.22 if lod == 0 else 0.7
    red = [(-1.10, 2.98), (1.10, 2.98), (1.14, 2.55), (0.72, 1.95), (0.34, 1.25), (0.34, 0.60), (-0.34, 0.60), (-0.34, 1.25), (-0.72, 1.95), (-1.14, 2.55)]
    nose.decal_front(m, red, RED, 0.6, 0.022, h=h, lmax=lm)
    nose.decal_front(m, rrect(0, 2.50, 2.06, 0.46, 0.09, 3), C('#2b363f'), 0.95, 0.036, h=h, lmax=lm)
    if lod == 0:
        for s_ in (-1, 1):
            nose.decal_front(m, ellipse(s_ * 0.70, 1.62, 0.25, 0.11, 14), DARKH, 0.8, 0.036, h=0.05)
            nose.decal_front(m, ellipse(s_ * 0.70, 1.62, 0.085, 0.085, 10), LAMPL, 0.9, 0.048, h=0.04)
            nose.decal_front(m, ellipse(s_ * 0.84, 2.93, 0.13, 0.10, 12), DARKH, 0.8, 0.036, h=0.05)
            nose.decal_front(m, ellipse(s_ * 0.84, 2.93, 0.07, 0.055, 10), C('#f0d98a'), 0.9, 0.048, h=0.04)
        nose.decal_front(m, [(-0.012, 0.52), (0.012, 0.52), (0.012, 1.25), (-0.012, 1.25)], DARKH, 0.3, 0.030, h=0.2, lmax=0.4)
    nose.decal_front(m, rrect(0, 3.02, 0.56, 0.16, 0.03, 2), DARKH, 0.9, 0.036, h=h, lmax=lm)


def build_ed(lod):
    sp = spec()
    pitch, Ln = 22.095, 2.3
    x_tip = pitch / 2
    x_rear = -pitch / 2 + HALF_GAP
    xn0 = x_tip - Ln
    el = door1(xn0 - 3.7, lod=lod) + door1(x_rear + 2.7, lod=lod)
    el += [(xn0 - 0.95, xn0 - 0.30, ('cabwin', 'door')), (xn0 - 0.98, xn0 - 0.945, 'dgap'), (xn0 - 0.30, xn0 - 0.265, 'dgap')]
    if lod == 0:
        x_first = xn0 - 4.1 - 8 * WP - WW
        for i in range(9):
            x0 = x_first + i * WP
            el += [(x0 - 0.035, x0, 'win_f'), (x0, x0 + WW, 'win_g'), (x0 + WW, x0 + WW + 0.035, 'win_f')]
        el += [(x_rear + 0.75, x_rear + 1.25, 'swin')]
    else:
        el += [(xn0 - 4.1 - 8 * WP - WW, xn0 - 4.1, 'winband')]

    def rf(m, s, lod_):
        zc = 3.565
        for xc in (-5.0, 1.2):
            roof_unit(m, xc, 0, zc - 0.05, 3.6, 1.70, 0.535, C('#cfd2d3'), top=C('#dadddd'), bevel=0.42, vent=False)

    bogies = [-7.0 + 0.175, 6.8]
    m = build_cab(sp, lod, pitch, Ln, nose_curves(), el, decal_fn=decals, roof_fn=rf,
                  belly_items=[(-6.0, 1.4, 0.46, 0.95, 1.05), (-2.2, 2.0, 0.48, 0.95, 1.10), (1.6, 1.6, 0.50, 0.95, 1.05)],
                  bogie_xs=bogies, wb=sp['wb'], u_switch=0.45, body_col=WHITE, n_st=14, belly_span=(-5.4, 4.6))
    return m, sp


BUILDERS = {
    'temu2000': build_ed,
    'temu2000-mid': lambda lod: build_mid_car(lod, tep=False),
    'temu2000-tep': lambda lod: build_mid_car(lod, tep=True),
}
