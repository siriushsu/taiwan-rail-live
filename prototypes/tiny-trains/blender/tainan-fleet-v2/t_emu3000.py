"""EMU3000 新自強號（日立）：ED 駕駛車、EM 中間車、EP 中間車（單臂集電弓）。

已查證（日立駕駛手冊／維基／臺灣鐵道維基館，詳見 catalog 的 notes）：車體寬 2,910；非駕駛車體長 19,600（pitch 20,300）；
駕駛車體長 21,000（pitch 21,350）；車頂高 3,490；地板高 1,180；單扇側滑門、每節每側 2 門在客室兩端；
單臂集電弓在第 3、7、10 車（PT-7183A），裝在轉向架上方；白色車身、黑色玻璃面罩、車廂連接處附近上緣彩色邊條。
含冷氣全高 3,750 採維基「ED車 3,750」（原始出處查不到，見 catalog 的 conflicts）。
推斷／照片估計：窗數與窗型（照片數：中間車約 13 扇窄窗、駕駛車約 9 扇）、門位置、窄縫窗、冷氣機數量位置、降弓高度。

車體斷面、門窗與車頭曲線是以 3.28 m 的車頂描出來的（窗、門、面罩的上下比例照照片），
組好之後地板以上整體等比拉高到手冊的車頂高 3.49 m（stretch_above_floor）；車頂設備在拉高後才照最終高度加上去。
"""
from array import array
import numpy as np
from common import *

FLOOR, ROOF, TOP = 1.18, 3.49, 3.75     # 地板高、車頂高（日立駕駛手冊）、含冷氣全高（維基 ED 車）
DRAWN_ROOF = 3.28                       # 斷面與車頭曲線描繪時用的車頂高
STRETCH = (ROOF - FLOOR) / (DRAWN_ROOF - FLOOR)
AC_BASE = ROOF - 0.06                   # 冷氣機座略沉入弧形車頂，兩側不留縫

BODY_W = C('#ebeeee')
E3_SKIRT = C('#b9bec2')
E3_DOOR = C('#dfe3e4')
E3_ACCENT = C('#c93a34')      # 代表色（實車有紅／綠／藍三種邊條），標為示意
ZLO, ZHI = 1.66, 2.52
WW, WP = 0.42, 0.905          # 窗寬、窗距


def spec():
    return dict(
        id='emu3000', W=2.91, body=19.6, pitch=20.3, zb=0.98,
        profile=lambda lod: Profile(hw=1.455, zb=0.98, z_sh=3.05, z_c=3.28, inset=0.09, cham=0.10, z_belt=1.5,
                                    K=6 if lod == 0 else 3, pieces=2 if lod == 0 else 1),
        band=Band([(0.0, 1.10, E3_SKIRT), (1.10, 9.0, BODY_W)], BODY_W),
        roof_col=C('#cfd4d6'),
        kinds=lambda lod: {**win_kinds(ZLO, ZHI),
                           'door': [(1.10, 2.97, E3_DOOR, 0.3)], 'dgap': [(1.08, 3.0, GAP, 0.2)],
                           'slit': [(1.55, 2.85, GLASS, 0.9)], 'vwin': [(1.85, 2.65, GLASS, 0.9)],
                           'sq': [(2.70, 3.00, GLASS, 0.9)], 'edge': [(2.86, 3.03, E3_ACCENT, 0.3)],
                           'winband': [(ZLO - 0.035, ZHI + 0.035, GLASS, 0.8)]},
        bellows=dict(w=2.0, z0=1.10, z1=3.05),
        bogie_x=6.9, wb=2.5,
    )


def end_elems(lod):
    """距車端 e 的元素：門（含窄縫窗）、端部小直窗、上緣彩色邊條。"""
    if lod == 0:
        return (door_elems(1.70, 1.30, slit=(0.10, 0.22)) + [(0.55, 0.78, 'vwin'), (0.0, 1.30, 'edge')])
    return [(1.70, 3.00, 'door'), (0.0, 1.30, 'edge')]


def mid_elems(lod, Lb=19.6):
    el = mirror(end_elems(lod), Lb)
    x_first = -Lb / 2 + 4.05
    if lod == 0:
        el += window_row(x_first, 13, WP, WW)
        # 每扇門旁上方的小方窗（照片上緊貼窗列首尾窗的上方）
        el += [(-Lb / 2 + 4.05, -Lb / 2 + 4.40, 'sq'), (Lb / 2 - 4.40, Lb / 2 - 4.05, 'sq')]
    else:
        el += [(-Lb / 2 + 4.0, Lb / 2 - 4.0, 'winband')]
    return el


def stretch_above_floor(m):
    """地板以上等比拉高：z' = FLOOR + (z - FLOOR)·STRETCH；法向乘反轉置矩陣後正規化。地板以下（轉向架、車下設備）不動。"""
    a = np.frombuffer(m.d, dtype=np.float32).reshape(-1, 10).copy()
    up = a[:, 2] > FLOOR
    a[up, 2] = FLOOR + (a[up, 2] - FLOOR) * STRETCH
    n = a[up, 3:6]
    n[:, 2] /= STRETCH
    a[up, 3:6] = n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    m.d = array('f', a.reshape(-1).tolist())


def roof_mid(ep):
    """車頂設備（拉高後才加，直接用最終高度）。EP 車的集電弓在 -X 端轉向架正上方（手冊 4.1.1：裝在連轉向架框的支撐架上）；
    哪一端朝 1 號車由編組表的 flip 決定。冷氣與高壓設備的縱向位置是推斷。"""
    def fn(m, sp, lod):
        acol, atop = C('#dde1e3'), C('#e6eaeb')
        if not ep:
            for xc in (-4.3, 4.3):
                roof_unit(m, xc, 0, AC_BASE, 3.7, 1.60, TOP - AC_BASE, acol, top=atop, vent=(lod == 0))
        else:
            roof_unit(m, -3.2, 0, AC_BASE, 3.2, 1.60, TOP - AC_BASE, acol, top=atop, vent=(lod == 0))
            roof_unit(m, 5.7, 0, AC_BASE, 3.2, 1.60, TOP - AC_BASE, acol, top=atop, vent=(lod == 0))
            m.tag = 'roof'
            hbox(m, 0.9, 0, ROOF - 0.04, 2.4, 1.10, 0.24, 0.14, 0.10, C('#c5cacc'), 0.3)
            pantograph(m, -sp['bogie_x'], ROOF, lod=lod, hfold=0.478, facing=-1)
    return fn


def add_roof(m, roof_fn, sp, lod):
    r = Mesh()
    roof_fn(r, sp, lod)
    m.merge(r)


BELLY_MID = [(-3.6, 1.7, 0.46, 0.98, 1.10), (-1.4, 1.3, 0.50, 0.98, 1.05), (1.0, 2.0, 0.48, 0.98, 1.12), (3.5, 1.4, 0.50, 0.98, 1.05)]


def build_mid_car(lod, ep=False):
    sp = spec()
    m = build_mid(sp, lod, mid_elems(lod, sp['body']), belly_items=BELLY_MID)
    stretch_above_floor(m)
    add_roof(m, roof_mid(ep), sp, lod)
    return m, sp


def nose_curves():
    hw = [(0, 1.455), (0.4, 1.45), (0.65, 1.43), (0.8, 1.36), (0.9, 1.22), (0.96, 1.05), (1.0, 0.90)]
    top = [(0, 3.28), (0.5, 3.27), (0.7, 3.18), (0.82, 3.02), (0.92, 2.82), (0.97, 2.68), (1.0, 2.58)]
    bot = [(0, 0.98), (0.6, 0.96), (0.8, 0.86), (0.92, 0.66), (1.0, 0.45)]
    nexp = [(0, 2.6), (0.6, 2.8), (1, 3.0)]
    mw = [(0, 0.0), (0.25, 0.25), (0.7, 0.7), (1, 0.88)]
    return hw, top, bot, nexp, mw


MASK = C('#12171c')
WSCR = C('#3f505c')
HL = C('#f2efe2')
TL = C('#b3392f')
CABG = C('#232c34')


def decals(m, nose, x_tip, lod):
    """黑色玻璃面罩（含側窗後掃）、擋風玻璃、大燈。"""
    h = 0.10 if lod == 0 else 0.35
    lm = 0.22 if lod == 0 else 0.7
    nose.decal_front(m, rrect(0, 2.12, 1.95, 1.45, 0.38, 5), MASK, 0.9, 0.020, h=h, lmax=lm)
    nose.decal_front(m, rrect(0, 2.36, 1.70, 0.86, 0.20, 4), WSCR, 0.95, 0.036, h=h, lmax=lm)
    if lod == 0:
        for s_ in (-1, 1):
            nose.decal_front(m, ellipse(s_ * 0.68, 1.62, 0.12, 0.08, 10), HL, 0.9, 0.040, h=0.05)
            nose.decal_front(m, ellipse(s_ * 0.42, 1.62, 0.05, 0.05, 8), TL, 0.7, 0.040, h=0.04)
    for sd in (-1, 1):
        nose.decal_side(m, [(x_tip + 0.05, 1.62), (x_tip + 0.05, 2.84), (x_tip - 2.30, 2.95), (x_tip - 1.75, 2.30), (x_tip - 1.05, 1.80)], sd, MASK, 0.9, 0.020, h=h, lmax=lm)
        nose.decal_side(m, [(x_tip - 2.05, 2.15), (x_tip - 2.05, 2.72), (x_tip - 1.20, 2.78), (x_tip - 1.20, 2.20)], sd, CABG, 0.95, 0.036, h=h, lmax=lm)


def build_ed(lod):
    sp = spec()
    pitch, Ln = 21.35, 3.6
    x_tip = pitch / 2
    x_rear = -pitch / 2 + HALF_GAP
    xn0 = x_tip - Ln
    el = [(x_rear + a, x_rear + b, k) for (a, b, k) in end_elems(lod)]
    xf = xn0 - 0.5  # 前門緊接車頭之後
    if lod == 0:
        el += door_elems(xf - 1.30, 1.30, slit=(0.10, 0.22)) + [(xf - 2.15, xf - 1.80, 'sq')]
        el += window_row(xf - 2.05 - 8 * WP - WW, 9, WP, WW)
    else:
        el += [(xf - 1.30, xf, 'door'), (xf - 2.05 - 8 * WP - WW, xf - 2.05, 'winband')]

    def roof_fn(m, s, lod_):
        for xc in (-4.6, 2.6):
            roof_unit(m, xc, 0, AC_BASE, 3.5, 1.60, TOP - AC_BASE, C('#dde1e3'), top=C('#e6eaeb'), vent=(lod_ == 0))

    bogies = [-6.9 + 0.175, 6.0]
    belly_items = [(-6.0, 1.4, 0.46, 0.98, 1.05), (-2.6, 2.0, 0.48, 0.98, 1.10), (0.0, 1.3, 0.50, 0.98, 1.05), (2.6, 1.6, 0.48, 0.98, 1.10)]
    m = build_cab(sp, lod, pitch, Ln, nose_curves(), el, decal_fn=decals, belly_items=belly_items, bogie_xs=bogies,
                  wb=sp['wb'], u_switch=0.5, body_col=BODY_W, roof_dark=MASK, roof_dark_u=0.93)
    stretch_above_floor(m)
    add_roof(m, roof_fn, sp, lod)
    return m, sp


BUILDERS = {
    'emu3000-mid': lambda lod: build_mid_car(lod, ep=False),
    'emu3000-ep': lambda lod: build_mid_car(lod, ep=True),
    'emu3000': build_ed,
}
