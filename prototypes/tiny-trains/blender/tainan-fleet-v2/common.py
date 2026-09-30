"""各車款共用的組裝函式：無駕駛室車體、有駕駛室（車頭）的車體、窗列與元素鏡射。

座標：+X 車頭、+Y 左側、z=0 鋼軌面、x=0 為該車連結器間距（pitch）的中心。
車體（body）與 pitch 的差別：中間車兩端各留 0.35 m 的半縫（兩車相鄰共 0.7 m，放折棚）；
駕駛車只在連結端留 0.35 m 半縫，車頭端沒有縫，所以車體相對 pitch 中心偏移 +0.175 m。
"""
import math
import numpy as np
from kit import (C, mixc, shade, Mesh, box, hbox, cyl, rod, fan, loft, Curve, Nose, rrect, ellipse)
import parts as P
from parts import (Profile, Band, Layout, resolve, wall_panels, roof_loft, floor_plate, end_cap, bellows, bogie, belly,
                   roof_unit, pantograph, GLASS, DARK, UNDER, EQUIP, WHEEL, FRAME, BELLOWS)

GAP = C('#5b6166')
HALF_GAP = 0.35


def win_kinds(zlo, zhi, f=0.035, glass=GLASS, frame=FRAME, g=0.9, prefix='win'):
    return {
        prefix + '_g': [(zlo - f, zlo, frame, 0.3), (zlo, zhi, glass, g), (zhi, zhi + f, frame, 0.3)],
        prefix + '_f': [(zlo - f, zhi + f, frame, 0.3)],
    }


def window_row(x_first, n, pitch, width, f=0.035, prefix='win'):
    """一排窗：每窗 = 左框條＋玻璃＋右框條（x 為絕對位置）。"""
    el = []
    for i in range(n):
        xa = x_first + i * pitch
        el += [(xa - f, xa, prefix + '_f'), (xa, xa + width, prefix + '_g'), (xa + width, xa + width + f, prefix + '_f')]
    return el


def mirror(elems, Lb):
    """elems 的 x 為「距該側車端的距離」→ 產生兩端（左端 x=-Lb/2+e，右端 x=+Lb/2-e）。"""
    out = []
    for (a, b, k) in elems:
        out.append((-Lb / 2 + a, -Lb / 2 + b, k))
        out.append((Lb / 2 - b, Lb / 2 - a, k))
    return out


def door_elems(x0, w, edge=0.035, slit=None, kind_door='door', kind_gap='dgap', kind_slit='slit'):
    """一扇門：兩側門縫線＋門板＋（可選）門窗細縫。x0=門左緣，w=門寬。slit=(距左緣, 寬)。"""
    el = [(x0, x0 + edge, kind_gap), (x0 + w - edge, x0 + w, kind_gap)]
    if slit:
        el.append((x0 + slit[0], x0 + slit[0] + slit[1], (kind_slit, kind_door)))
    el.append((x0, x0 + w, kind_door))
    return el


# ================================================================ 中間車（無駕駛室）
def build_mid(spec, lod, elems_L, elems_R=None, roof_fn=None, belly_items=None, bogie_x=None, wb=2.5,
              lo_bellows=True, hi_bellows=True, lo_cap_col=None, hi_cap_col=None, motor=True):
    Lb = spec['body']
    hx = Lb / 2
    m = Mesh()
    prof = spec['profile'](lod)
    layout = Layout(spec['band'], spec['kinds'](lod), resolve(elems_L), resolve(elems_R) if elems_R is not None else None)
    wall_panels(m, prof, 'L', -hx, hx, layout)
    wall_panels(m, prof, 'R', -hx, hx, layout)
    roof_loft(m, prof, -hx, hx, spec['roof_col'])
    floor_plate(m, prof, -hx, hx, UNDER)
    ring, _ = prof.ring()
    cap = spec.get('end_col', C('#c9cdd0'))
    end_cap(m, ring, -hx, -1, lo_cap_col or cap)
    end_cap(m, ring, hx, +1, hi_cap_col or cap)
    if lo_bellows:
        bellows(m, -hx, -1, half=HALF_GAP, lod=lod, **spec['bellows'])
    if hi_bellows:
        bellows(m, hx, +1, half=HALF_GAP, lod=lod, **spec['bellows'])
    if roof_fn:
        roof_fn(m, spec, lod)
    bx = bogie_x if bogie_x is not None else spec['bogie_x']
    for s in (-1, 1):
        bogie(m, s * bx, wb=wb, lod=lod, motor=motor)
    bs = spec.get('belly_half', 5.3)
    belly(m, -bs, bs, spec['zb'], spec['W'], lod=lod, items=belly_items or [])
    return m


# ================================================================ 駕駛車（有車頭）
def make_nose(prof, x0, L, sign, curves, subdiv=2):
    hw, top, bot, nexp, mw = curves[:5]
    setback = curves[5] if len(curves) > 5 else None      # 可選：callable (u,z)->後縮量
    ring, kinds = prof.ring(subdiv)
    n = Nose(ring, x0, L, sign, Curve(top), Curve(bot), Curve(hw), Curve(nexp), Curve(mw), setback=setback)
    return n, kinds


def nose_loft(m, nose, kinds, band, roof_col, body_col, u_switch=0.5, n_st=18, power=1.6, under=UNDER, roof_dark=None, roof_dark_u=0.85, dark_col=None, col_fn=None, cap_bands=None):
    """車頭本體放樣。u<u_switch 的牆面沿用側牆色帶，之後改為車身色；車頂 u>roof_dark_u 可換深色。
    col_fn(kind, u, xc, yc, zc)->(色,光澤)|None：若給，優先於上述規則（以格中心座標分色）。"""
    m.tag = 'nose'
    us = 1 - (1 - np.linspace(0, 1, n_st)) ** power
    holder = {}

    def colfn(i, j):
        kind, side, z0, z1 = kinds[j]
        u = (us[i] + us[i + 1]) / 2
        if col_fn is not None:
            Pn_ = holder['P']
            j2 = (j + 1) % len(Pn_[0])
            q = [Pn_[i][j], Pn_[i][j2], Pn_[i + 1][j2], Pn_[i + 1][j]]
            r = col_fn(kind, u, sum(p[0] for p in q) / 4, sum(p[1] for p in q) / 4, sum(p[2] for p in q) / 4)
            if r is not None:
                return r
        if kind == 'roof':
            if roof_dark is not None and u >= roof_dark_u:
                return roof_dark, 0.5
            return roof_col, 0.3
        if kind == 'floor':
            return under, 0.1
        if u >= u_switch:
            return body_col, 0.3
        return band.at((z0 + z1) / 2)

    Y, Z = nose.rings(us)
    X = nose.x_pos(us[:, None], Z)
    Pn = [[(float(X[i, j]), float(Y[i, j]), float(Z[i, j])) for j in range(Y.shape[1])] for i in range(len(us))]
    holder['P'] = Pn
    loft(m, Pn, colfn)
    nose.cap(m, body_col, bands=cap_bands)
    return Pn


def build_cab(spec, lod, pitch, Ln, curves, elems_L, elems_R=None, decal_fn=None, roof_fn=None, belly_items=None,
              bogie_xs=None, wb=2.5, u_switch=0.5, roof_dark=None, roof_dark_u=0.85, body_col=None, n_st=18, subdiv=2, nose_power=1.6,
              coupler_bellows=True, belly_span=None):
    """駕駛車：車頭朝 +X。車體自 x_rear 到車頭尖端 x_tip（=pitch/2）。"""
    x_tip = pitch / 2
    x_rear = -pitch / 2 + HALF_GAP
    xn0 = x_tip - Ln
    m = Mesh()
    prof = spec['profile'](lod)
    band = spec['band']
    layout = Layout(band, spec['kinds'](lod), resolve(elems_L), resolve(elems_R) if elems_R is not None else None)
    wall_panels(m, prof, 'L', x_rear, xn0, layout)
    wall_panels(m, prof, 'R', x_rear, xn0, layout)
    roof_loft(m, prof, x_rear, xn0, spec['roof_col'])
    floor_plate(m, prof, x_rear, xn0, UNDER)
    ring, _ = prof.ring()
    end_cap(m, ring, x_rear, -1, spec.get('end_col', C('#c9cdd0')))
    if coupler_bellows:
        bellows(m, x_rear, -1, half=HALF_GAP, lod=lod, **spec['bellows'])
    nose, nk = make_nose(prof, xn0, Ln, +1, curves, subdiv=subdiv if lod == 0 else 1)
    nose_loft(m, nose, nk, band, spec['roof_col'], body_col or spec['band'].at(2.0)[0], u_switch=u_switch, n_st=n_st if lod == 0 else max(6, n_st // 2),
              power=nose_power, roof_dark=roof_dark, roof_dark_u=roof_dark_u)
    if decal_fn:
        m.tag = 'decal'
        decal_fn(m, nose, x_tip, lod)
    if roof_fn:
        roof_fn(m, spec, lod)
    for x in (bogie_xs or []):
        bogie(m, x, wb=wb, lod=lod)
    bsp = belly_span or (x_rear + 3.6, xn0 - 1.0)
    belly(m, bsp[0], bsp[1], spec['zb'], spec['W'], lod=lod, items=belly_items or [])
    return m
