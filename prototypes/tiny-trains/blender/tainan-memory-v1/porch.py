"""門廊：三圓拱＋兩側圓窗（5 開間 16.4 m）、兩側短牆（前廳外牆的前 2 m）的圓窗、內後牆的三扇入口門、雨庇（彎弧托架＋白色分格藻井）、
雨庇上方的低山形壁與浮雕徽章牌。內後牆（y=YF）與前廳兩側外牆（YF→Y2）由 block.py 做。"""
from common import *
from relief import relief_panel
from brackets import corbel, lip_profile, lip_band, soffit_panels

ARCH_X = [XPC + k * BAY for k in (-1, 0, 1)]
RW_X = [XPC + s * 2 * BAY for s in (-1, 1)]
BAND = 0.26                       # 拱框（洗石子）寬
Y_FRONT_CAN = YP - CAN_OUT        # 雨庇前緣
DOOR_W = 1.9                      # 門廊內後牆入口門寬（拱形）
GABLE_HALF = 5.1                  # 門廊屋頂上的低山形壁半寬（照片 01：x 240–430 px，門廊比例尺 18.7 px/m ⇒ 10.2 m）
PC_S = 0.75                       # 門廊女兒牆簷口的縮放（高 0.52×0.75＝0.39 m）
TOP_BAND = [(-0.02, Z_PORCH - 0.37), (0.10, Z_PORCH - 0.37), (0.10, Z_PORCH - 0.23), (0.18, Z_PORCH - 0.17), (0.18, Z_PORCH), (-0.02, Z_PORCH)]


def round_window(G, W, uc, vc, r, depth=0.30, ring_out=0.16):
    """圓窗配件：洞口由 hole_circle 交給 wall_f。"""
    f = W.f
    with G.detail('both'):
        disc_f(G, f, uc, vc, r, -depth + 0.05, 'glass', n=20)      # 與 hole_circle 同一個圓（n=20）：玻璃填滿洞口，不留環形縫
    with G.detail('near'):
        ring_f(G, f, uc, vc, r - 0.06, r, -depth, -depth + 0.10, 'frame', n=20, skip='n')
        ring_f(G, f, uc, vc, r, r + ring_out, 0, 0.10, 'ochre', n=24, skip='n')
        ring_f(G, f, uc, vc, r + ring_out, r + ring_out + 0.05, 0, 0.14, 'cream', n=24, skip='n')
        box_f(G, f, uc - (r - 0.06), uc + (r - 0.06), vc - 0.022, vc + 0.022, -depth + 0.03, -depth + 0.085, 'frame', 'n')
        box_f(G, f, uc - 0.022, uc + 0.022, vc - (r - 0.06), vc + (r - 0.06), -depth + 0.03, -depth + 0.09, 'frame', 'n')
        ring_f(G, f, uc, vc, r * 0.40, r * 0.40 + 0.04, -depth + 0.03, -depth + 0.08, 'frame', n=16, skip='n')


def arch_dressing(G, f, uc, r, vs, vb=0.0):
    """圓拱的拱框（土黃洗石子）、拱心石、拱腳線腳。"""
    with G.detail('near'):
        band_f(G, f, arch_outline(uc, vb, r + BAND, vs, 14), arch_outline(uc, vb, r, vs, 14), 0, 0.09, 'ochre', skip='n')
        # 拱框外緣的細線腳
        band_f(G, f, arch_outline(uc, vb, r + BAND + 0.06, vs, 14), arch_outline(uc, vb, r + BAND, vs, 14), 0, 0.13, 'cream', skip='n')
        box_f(G, f, uc - 0.22, uc + 0.22, vs + r - 0.02, vs + r + BAND + 0.11, 0, 0.16, 'cream', 'n')
        for s in (-1, 1):
            box_f(G, f, uc + s * (r + BAND * 0.5) - 0.22, uc + s * (r + BAND * 0.5) + 0.22, vs - 0.09, vs + 0.09, 0, 0.14, 'cream', 'n')


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
        ext = ARCH_W / 2 + BAND + 0.06
        edges = [XP0] + sum(([x - ext, x + ext] for x in ARCH_X), []) + [XP1]
        for i, (a, b) in enumerate(zip(edges[0::2], edges[1::2])):
            mold(G, Wp, a, b, plinth_profile(), 'ochre', 'plinth', ends=(i == 0, i == 3))
        with G.detail('near'):
            segs = [XP0 - 0.05] + sum(([x - ARCH_W / 2 - BAND, x + ARCH_W / 2 + BAND] for x in ARCH_X), []) + [XP1 + 0.05]
            for a, b in zip(segs[0::2], segs[1::2]):
                if b - a > 0.05:
                    wbox(G, Wp, a, b, ARCH_SPRING - 0.13, ARCH_SPRING + 0.07, 0, 0.12, 'cream')
            # 頂部橫帶（雨庇下）
            molding(G, Wp, XP0 - 0.06, XP1 + 0.06, TOP_BAND, 'cream')
        # 兩側短牆（各一扇圓窗）
        for kind, x in (('left', XP0), ('right', XP1)):
            S = Wall(kind, x)
            a, b = S.span(YP, YF)
            yc = S.u((YP + YF) / 2)
            wall_f(G, S.f, a, b, 0, Z_PORCH, [hole_circle(yc, RW_Z, RW_R, 0.30)], 'tile')
            round_window(G, S, yc, RW_Z, RW_R)
            mold(G, S, YP, YF, plinth_profile(), 'ochre', 'plinth', ends=(False, None))       # 後端與前廳外牆的勒腳（block.py）齊平對接
            with G.detail('near'):
                molding(G, S, YP - 0.06, YF, TOP_BAND, 'cream')
        # 門廊上段（第二輪：雨庇板以上牆面續砌到簷口；照片 02 左角頂 4.47–4.56、照片 03 右角頂 4.57–4.70 反投影到牆面平面）
        z_up = Z_PROOF - 0.52 * PC_S                                   # 簷口下緣（＝門廊屋面）
        wall_f(G, Wp.f, XP0, XP1, Z_CANOPY_TOP - 0.02, z_up + 0.02, [], 'tile')
        mold(G, Wp, XP0, XP1, cornice_profile(z_up, PC_S), 'cream', 'cornice', PC_S)
        for kind, x in (('left', XP0), ('right', XP1)):
            S = Wall(kind, x)
            a, b = S.span(YP, YF)
            wall_f(G, S.f, a, b, Z_CANOPY_TOP - 0.02, z_up + 0.02, [], 'tile')
            mold(G, S, YP, YF, cornice_profile(z_up, PC_S), 'cream', 'cornice', PC_S, ends=(False, None))
        box(G, XP0, XP1, YP, YF, z_up - 0.08, z_up, 'roof', 'nUuVv')       # 門廊屋面（只留頂面；四周被簷口與牆遮住）
        # 內後牆的三扇入口門（拱門形；牆本身在 block.py）
        dsp = ARCH_SPRING - 0.20
        for x in ARCH_X:
            u = Wb.u(x)
            poly = hole_arch(u, DOOR_W, 0.0, dsp, 0.0, 12)['poly']
            with G.detail('both'):
                fill_poly_f(G, Wb.f, poly, 0.02, 'dark')
            with G.detail('near'):
                band_f(G, Wb.f, arch_outline(u, 0.0, DOOR_W / 2 + 0.12, dsp, 12), arch_outline(u, 0.0, DOOR_W / 2 + 0.01, dsp, 12), 0.0, 0.07, 'cream', skip='n')
                top = dsp + DOOR_W / 2
                box_f(G, Wb.f, u - 0.025, u + 0.025, 0.05, top - 0.10, 0.02, 0.07, 'frame', 'n')
                box_f(G, Wb.f, u - DOOR_W / 2, u + DOOR_W / 2, dsp - 0.025, dsp + 0.025, 0.02, 0.065, 'frame', 'n')
                box_f(G, Wb.f, u - DOOR_W / 2, u + DOOR_W / 2, 1.1, 1.15, 0.02, 0.065, 'frame', 'n')

    with G.part('雨庇與托架'):
        # 門廊屋頂＋雨庇：一體擠出（土黃洗石子）；底面另以白色藻井收（含門廊內天花，不留洞）
        poly = [(XP0 - 0.10, YF), (XP0 - 0.10, YP - 0.10), (CAN_X0, YP - 0.10), (CAN_X0, Y_FRONT_CAN), (CAN_X1, Y_FRONT_CAN), (CAN_X1, YP - 0.10), (XP1 + 0.10, YP - 0.10), (XP1 + 0.10, YF)]
        extrude_f(G, world(), poly, Z_PORCH, Z_CANOPY_TOP, 'ochre', skip='n')
        with G.detail('both'):
            fill_poly_f(G, world(Z_PORCH), poly, 0.0, 'white', facing=-1)
        with G.detail('near'):
            # 雨庇前緣階梯線腳（含一條米黃壓條）
            molding(G, Wp, CAN_X0, CAN_X1, lip_profile(CAN_OUT, Z_PORCH, Z_CANOPY_TOP), 'ochre')
            zb0, zb1 = lip_band(Z_PORCH, Z_CANOPY_TOP)
            molding(G, Wp, CAN_X0, CAN_X1, [(CAN_OUT + 0.06, zb0), (CAN_OUT + 0.14, zb0), (CAN_OUT + 0.14, zb1), (CAN_OUT + 0.06, zb1)], 'cream')
            # 彎弧托架：每半開間一支（照片 04：托架與拱腳、壁柱對位），三層階梯線腳、牆端渦形
            xs = [x for x in (XPC + k * BAY / 2 for k in range(-4, 5)) if CAN_X0 + 0.25 <= x <= CAN_X1 - 0.25]       # 只掛在雨庇範圍內（雨庇兩端各留 0.25 m）
            for x in xs:
                corbel(G, Wp, x, CAN_OUT - 0.08, Z_PORCH, h_wall=0.58, h_lip=0.16, w=0.46)
            soffit_panels(G, Wp, xs, CAN_OUT, Z_PORCH)

    with G.part('山形壁與浮雕'):
        # 門廊屋頂上的低山形壁：前面＝門廊前牆面（照片 02 徽章反投影 Y=-12.2、z=4.98；照片 01：山形壁寬 10.2 m、邊高 0.9 m、脊高 1.2 m、
        # 底 z≈4.6），站在簷口頂（Z_PROOF）上。第二輪第一版誤放在雨庇前緣（前面 3 m），照片 02 對位差 24 px。
        Wg = Wall('front', YP)
        xc, half = XPC, GABLE_HALF
        x0, x1 = xc - half, xc + half
        z0 = Z_PROOF
        ze, zr = z0 + 0.85, z0 + 1.22
        TH = 0.28                                                        # 厚度＝簷口頂面的深度（0.30），不懸空
        extrude_f(G, Wg.f, [(x0, z0), (x1, z0), (x1, ze), (xc, zr), (x0, ze)], -TH, 0.0, 'tile')        # 含背面（第一版 skip='n' 從後方看會透空）
        T = [(x0 - 0.12, ze - 0.04), (xc, zr + 0.01), (x1 + 0.12, ze - 0.04)]
        A = [(u, v + 0.20) for u, v in T]
        band_f(G, Wg.f, A, T, -TH + 0.01, 0.14, 'cream')                                                  # 後蓋在山形壁背面前 1 cm
        with G.detail('near'):
            wbox(G, Wg, x0 - 0.12, x1 + 0.12, z0 - 0.01, z0 + 0.16, -TH - 0.01, 0.13, 'cream', skip='v')    # 背面比山形壁背面再深 1 cm：不共面
            wbox(G, Wg, x0 - 0.05, x0 + 0.20, z0 + 0.16, ze, -TH - 0.01, 0.08, 'cream')
            wbox(G, Wg, x1 - 0.20, x1 + 0.05, z0 + 0.16, ze, -TH - 0.01, 0.08, 'cream')
        relief_panel(G, Wg.f, xc, z0 + 0.45, 3.3, 0.90, big=False)
