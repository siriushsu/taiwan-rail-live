"""主棟：二樓正面（含七扇圓拱長窗）、門廊兩側外露牆片、兩側牆、屋簷與屋面、主棟後牆上段。"""
from common import *
from side import side_arch_hole, side_arch, side_canopy, SIDE_ARCH_Y, Z_LO, Z_HI


def main_block(G):
    W = Wall('front', YF)
    with G.part('舊站主體'):
        # 二樓正面（含七扇圓拱長窗）
        holes = [arch_hole(W, x, Z_SILL, WIN_W, Z_CROWN - WIN_W / 2, 0.30) for x in WX]
        wall_f(G, W.f, XL, XR, Z_SC0 - 0.02, Z_CAP, holes, 'tile')
        # 一樓：門廊兩側外露的牆片（右側有窗與小雨庇）
        wall_f(G, W.f, XL, XP0, 0, Z_SC0, [], 'tile')
        wall_f(G, W.f, XP1, XR, 0, Z_SC0, [rect_hole(W, 10.9, 1.0, 3.4, 1.4, 0.25)], 'tile')
        rect_window(G, W, 10.9, 1.0, 3.4, 1.4)
        mold(G, W, XL, XR, course_profile(), 'cream', 'course')
        mold(G, W, XL, XP0, plinth_profile(), 'ochre', 'plinth', ends=(True, False))
        mold(G, W, XP1, XR, plinth_profile(), 'ochre', 'plinth', ends=(False, True))
        # 右側入口上方小雨庇（與側雨庇同高，轉角與右側雨庇相接）
        wbox(G, W, XP1, XR + 0.5, Z_LO, Z_HI, 0.0, 1.3, 'ochre', skip='n')
        with G.detail('near'):
            wbox(G, W, XP1, XR + 0.5, Z_HI, Z_HI + 0.06, 0.0, 1.36, 'cream', skip='nv')
            for x in (XP1 + 0.4, XR - 0.2):
                molding(G, W, x - 0.14, x + 0.14, [(0, Z_LO + 0.02), (0.9, Z_LO + 0.02), (0.9, Z_LO - 0.08), (0.55, Z_LO - 0.08), (0.55, Z_LO - 0.22), (0.25, Z_LO - 0.22), (0.25, Z_LO - 0.36), (0, Z_LO - 0.36)], 'ochre')
        # 屋簷與女兒牆（正面）
        mold(G, W, XL, XR, cornice_profile(), 'cream', 'cornice')
        wbox(G, W, XL, XR, Z_ROOF - 0.58, Z_ROOF - 0.02, 0, 0.10, 'cream', skip='nV')
        # 兩側牆：二樓四扇圓拱長窗；一樓靠前一個圓拱側入口，其餘三扇方窗
        for kind, x in (('right', XR), ('left', XL)):
            S = Wall(kind, x)
            ys = [YF + 2.09 + 3.4 * k for k in range(4)]
            holes = [arch_hole(S, y, Z_SILL, WIN_W, Z_CROWN - WIN_W / 2, 0.30) for y in ys]
            holes += [rect_hole(S, y, 1.4, 3.7, 1.5, 0.25) for y in ys[1:]] + [side_arch_hole(S)]
            a, b = S.span(YF, YB)
            wall_f(G, S.f, a, b, 0, Z_CAP, holes, 'tile')
            for y in ys:
                arch_window(G, S, y, Z_SILL, WIN_W, Z_CROWN - WIN_W / 2, 0.30)
            for y in ys[1:]:
                rect_window(G, S, y, 1.4, 3.7, 1.5)
            side_arch(G, S)
            mold(G, S, YF, YB, course_profile(), 'cream', 'course', ends=(False, True))
            ea, eb = SIDE_ARCH_Y - ARCH_W / 2 - 0.30 - 0.07, SIDE_ARCH_Y + ARCH_W / 2 + 0.30 + 0.07
            mold(G, S, YF, ea, plinth_profile(), 'ochre', 'plinth', ends=(False, None))
            mold(G, S, eb, YB, plinth_profile(), 'ochre', 'plinth', ends=(None, True))
            mold(G, S, YF, YB, cornice_profile(), 'cream', 'cornice', ends=(False, False))
            wbox(G, S, YF, YB, Z_ROOF - 0.58, Z_ROOF - 0.02, 0, 0.10, 'cream', skip='nV')
            side_canopy(G, kind, x, YF, YF + 9.5)
        # 後牆上段（橫翼屋面以上外露）與後側屋簷
        B = Wall('back', YB)
        a, b = B.span(XL, XR)
        wall_f(G, B.f, a, b, WH - 0.5, Z_CAP, [], 'tile')
        mold(G, B, XL, XR, cornice_profile(), 'cream', 'cornice')
        wbox(G, B, XL, XR, Z_ROOF - 0.58, Z_ROOF - 0.02, 0, 0.10, 'cream', skip='nV')
        # 屋面（遠近景）
        box(G, XL, XR, YF, YB, Z_ROOF - 0.08, Z_ROOF - 0.02, 'roof', 'nUuVv')     # 只留頂面（四周被牆遮住，留著會與牆面共面）
        # 前後角落的窄壁柱（外緣線腳，近景）
        with G.detail('near'):
            for x0, x1 in ((XL, XL + 0.42), (XR - 0.42, XR)):
                wbox(G, W, x0, x1, Z_SC1, Z_ROOF - 0.58, 0, 0.09, 'cream', 'n')
    with G.part('二樓長拱窗'):
        for x in WX:
            arch_window(G, W, x, Z_SILL, WIN_W, Z_CROWN - WIN_W / 2, 0.30)
