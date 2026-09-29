"""門廊：三圓拱＋兩側圓窗、內後牆與門、雨庇（含階梯狀托架與白色藻井）、雨庇上方的低山形壁與浮雕徽章牌。"""
from common import *
from relief import relief_panel

ARCH_X = [XPC + k * BAY for k in (-1, 0, 1)]
RW_X = [XPC + s * 2 * BAY for s in (-1, 1)]
BAND = 0.30                       # 拱框（洗石子）寬
Y_FRONT_CAN = YP - CAN_OUT        # 雨庇前緣


def round_window(G, W, uc, vc, r, depth=0.30, ring_out=0.20):
    """圓窗配件：洞口由 hole_circle 交給 wall_f。"""
    f = W.f
    with G.detail('both'):
        disc_f(G, f, uc, vc, r - 0.06, -depth + 0.05, 'glass', n=20)
    with G.detail('near'):
        ring_f(G, f, uc, vc, r - 0.06, r, -depth, -depth + 0.10, 'frame', n=20, skip='n')
        ring_f(G, f, uc, vc, r, r + ring_out, 0, 0.10, 'ochre', n=24, skip='n')
        ring_f(G, f, uc, vc, r + ring_out, r + ring_out + 0.05, 0, 0.14, 'cream', n=24, skip='n')
        box_f(G, f, uc - (r - 0.06), uc + (r - 0.06), vc - 0.022, vc + 0.022, -depth + 0.03, -depth + 0.085, 'frame', 'n')
        box_f(G, f, uc - 0.022, uc + 0.022, vc - (r - 0.06), vc + (r - 0.06), -depth + 0.03, -depth + 0.09, 'frame', 'n')
        ring_f(G, f, uc, vc, 0.27, 0.31, -depth + 0.03, -depth + 0.08, 'frame', n=16, skip='n')


def arch_dressing(G, f, uc, r, vs, vb=0.0):
    """門廊拱的拱框（土黃洗石子）、拱心石、拱腳線腳。"""
    with G.detail('near'):
        band_f(G, f, arch_outline(uc, vb, r + BAND, vs, 14), arch_outline(uc, vb, r, vs, 14), 0, 0.09, 'ochre', skip='n')
        # 拱框外緣的細線腳
        band_f(G, f, arch_outline(uc, vb, r + BAND + 0.07, vs, 14), arch_outline(uc, vb, r + BAND, vs, 14), 0, 0.13, 'cream', skip='n')
        box_f(G, f, uc - 0.24, uc + 0.24, vs + r - 0.02, vs + r + BAND + 0.12, 0, 0.16, 'cream', 'n')
        for s in (-1, 1):
            box_f(G, f, uc + s * (r + BAND * 0.5) - 0.24, uc + s * (r + BAND * 0.5) + 0.24, vs - 0.09, vs + 0.09, 0, 0.14, 'cream', 'n')


def bracket_profiles():
    """雨庇下的階梯狀托架剖面 (out, z)：靠牆端高、向前端逐階收短（照片 04：洗石子三階托架，寬窄兩層）。"""
    z = Z_PORCH
    t = z + 0.02                                    # 托架頂面嵌進雨庇實體 2 cm：不與雨庇底面、頂部橫帶的頂面共面
    outer = [(0.0, t), (1.15, t), (1.15, z - 0.14), (0.85, z - 0.14), (0.85, z - 0.29), (0.55, z - 0.29), (0.55, z - 0.44), (0.0, z - 0.44)]
    inner = [(-0.04, t + 0.01), (1.28, t + 0.01), (1.28, z - 0.22), (0.98, z - 0.22), (0.98, z - 0.37), (0.68, z - 0.37), (0.68, z - 0.52), (0.36, z - 0.52), (0.36, z - 0.60), (-0.04, z - 0.60)]
    return outer, inner


def porch(G):
    Wp = Wall('front', YP)
    Wb = Wall('front', YF)
    depth = YF - YP
    with G.part('三拱門廊'):
        holes = [arch_hole(Wp, x, 0.0, ARCH_W, ARCH_SPRING, depth) for x in ARCH_X]
        holes += [hole_circle(Wp.u(x), RW_Z, RW_R, 0.30) for x in RW_X]
        wall_f(G, Wp.f, XP0, XP1, 0, Z_PORCH, holes, 'tile')
        for x in RW_X:
            round_window(G, Wp, Wp.u(x), RW_Z, RW_R)
        for x in ARCH_X:
            arch_dressing(G, Wp.f, Wp.u(x), ARCH_W / 2, ARCH_SPRING)
        # 勒腳（拱洞處中斷）與拱腳橫帶
        edges = [XP0] + sum(([x - ARCH_W / 2 - BAND - 0.07, x + ARCH_W / 2 + BAND + 0.07] for x in ARCH_X), []) + [XP1]
        for i, (a, b) in enumerate(zip(edges[0::2], edges[1::2])):
            mold(G, Wp, a, b, plinth_profile(), 'ochre', 'plinth', ends=(i == 0, i == 3))
        with G.detail('near'):
            segs = [XP0 - 0.05] + sum(([x - ARCH_W / 2 - BAND, x + ARCH_W / 2 + BAND] for x in ARCH_X), []) + [XP1 + 0.05]
            for a, b in zip(segs[0::2], segs[1::2]):
                if b - a > 0.05:
                    wbox(G, Wp, a, b, ARCH_SPRING - 0.13, ARCH_SPRING + 0.07, 0, 0.12, 'cream')
            # 頂部橫帶（雨庇下）
            molding(G, Wp, XP0 - 0.06, XP1 + 0.06, [(-0.02, 4.38), (0.10, 4.38), (0.10, 4.52), (0.18, 4.58), (0.18, Z_PORCH), (-0.02, Z_PORCH)], 'cream')
        # 兩側短牆（各一扇圓窗）
        for kind, x in (('left', XP0), ('right', XP1)):
            S = Wall(kind, x)
            a, b = S.span(YP, YF)
            yc = S.u((YP + YF) / 2)
            wall_f(G, S.f, a, b, 0, Z_PORCH, [hole_circle(yc, RW_Z, RW_R, 0.30)], 'tile')
            round_window(G, S, yc, RW_Z, RW_R)
            mold(G, S, YP, YF, plinth_profile(), 'ochre', 'plinth', ends=(False, True))
            with G.detail('near'):
                molding(G, S, YP - 0.06, YF, [(-0.02, 4.38), (0.10, 4.38), (0.10, 4.52), (0.18, 4.58), (0.18, Z_PORCH), (-0.02, Z_PORCH)], 'cream')
        # 內後牆與三扇入口門（拱門形）
        wall_f(G, Wb.f, XP0, XP1, 0, Z_PORCH, [], 'tile')
        for x in ARCH_X:
            u = Wb.u(x)
            poly = hole_arch(u, 2.2, 0.0, 2.35, 0.0, 12)['poly']
            with G.detail('both'):
                fill_poly_f(G, Wb.f, poly, 0.02, 'dark')
            with G.detail('near'):
                band_f(G, Wb.f, arch_outline(u, 0.0, 1.22, 2.35, 12), arch_outline(u, 0.0, 1.1, 2.35, 12), 0.0, 0.07, 'cream', skip='n')
                box_f(G, Wb.f, u - 0.025, u + 0.025, 0.05, 3.45, 0.02, 0.07, 'frame', 'n')
                box_f(G, Wb.f, u - 1.1, u + 1.1, 2.35 - 0.025, 2.35 + 0.025, 0.02, 0.065, 'frame', 'n')
                box_f(G, Wb.f, u - 1.1, u + 1.1, 1.1, 1.15, 0.02, 0.065, 'frame', 'n')

    with G.part('雨庇與托架'):
        # 門廊屋頂＋雨庇：一體擠出（土黃洗石子），底面另以白色藻井收
        poly = [(XP0 - 0.10, YF), (XP0 - 0.10, YP - 0.10), (CAN_X0, YP - 0.10), (CAN_X0, Y_FRONT_CAN), (CAN_X1, Y_FRONT_CAN), (CAN_X1, YP - 0.10), (XP1 + 0.10, YP - 0.10), (XP1 + 0.10, YF)]
        extrude_f(G, world(), poly, Z_PORCH, Z_CANOPY_TOP, 'ochre', skip='n')
        # 雨庇前緣階梯線腳
        with G.detail('near'):
            molding(G, Wp, CAN_X0, CAN_X1, [(CAN_OUT, 4.80), (CAN_OUT + 0.06, 4.80), (CAN_OUT + 0.10, 4.84), (CAN_OUT + 0.10, 4.98), (CAN_OUT + 0.06, 5.02), (CAN_OUT + 0.06, 5.20), (CAN_OUT + 0.10, 5.24), (CAN_OUT + 0.10, 5.36), (CAN_OUT + 0.04, 5.45), (CAN_OUT, 5.45)], 'ochre')
            molding(G, Wp, CAN_X0, CAN_X1, [(CAN_OUT + 0.10, 5.02), (CAN_OUT + 0.14, 5.02), (CAN_OUT + 0.14, 5.20), (CAN_OUT + 0.10, 5.20)], 'cream')
        # 白色藻井底面
        with G.detail('both'):
            fill_poly_f(G, world(Z_PORCH), [(CAN_X0, Y_FRONT_CAN), (CAN_X1, Y_FRONT_CAN), (CAN_X1, YP), (CAN_X0, YP)], 0.0, 'white', facing=-1)
        with G.detail('near'):
            n = 10
            xs = [CAN_X0 + 0.30 + (CAN_X1 - CAN_X0 - 0.60) * i / (n - 1) for i in range(n)]
            outer, inner = bracket_profiles()
            for x in xs:
                molding(G, Wp, x - 0.23, x + 0.23, outer, 'ochre')
                molding(G, Wp, x - 0.15, x + 0.15, inner, 'ochre')
            for a, b in zip(xs, xs[1:]):
                x0, x1 = a + 0.34, b - 0.34
                y0, y1 = Y_FRONT_CAN + 0.28, YP - 0.22
                box(G, x0, x1, y0, y1, Z_PORCH - 0.05, Z_PORCH, 'white', 'N')
                box(G, x0 + 0.16, x1 - 0.16, y0 + 0.16, y1 - 0.16, Z_PORCH - 0.09, Z_PORCH - 0.05, 'white', 'N')

    with G.part('山形壁與浮雕'):
        # 雨庇上方的低山形壁（照片 01：寬約 12.7 m、邊高約 0.95 m、脊高約 1.65 m）
        yf = Y_FRONT_CAN + 0.20
        Wg = Wall('front', yf)
        xc, half = XPC, 6.35
        x0, x1 = xc - half, xc + half
        z0 = Z_CANOPY_TOP - 0.02
        ze, zr = Z_CANOPY_TOP + 0.95, Z_CANOPY_TOP + 1.65
        extrude_f(G, Wg.f, [(x0, z0), (x1, z0), (x1, ze), (xc, zr), (x0, ze)], -0.45, 0.0, 'tile', skip='n')
        T = [(x0 - 0.12, ze - 0.04), (xc, zr + 0.01), (x1 + 0.12, ze - 0.04)]
        A = [(u, v + 0.20) for u, v in T]
        band_f(G, Wg.f, A, T, -0.45, 0.14, 'cream', skip='n')
        with G.detail('near'):
            wbox(G, Wg, x0 - 0.12, x1 + 0.12, z0 - 0.01, z0 + 0.16, -0.45, 0.13, 'cream', skip='v')
            wbox(G, Wg, x0 - 0.05, x0 + 0.20, z0 + 0.16, ze, -0.45, 0.08, 'cream')
            wbox(G, Wg, x1 - 0.20, x1 + 0.05, z0 + 0.16, ze, -0.45, 0.08, 'cream')
        relief_panel(G, Wg.f, xc, z0 + 0.16 + 0.62, 4.2, 1.2, big=True)
