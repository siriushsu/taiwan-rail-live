"""主棟（第二輪修訂：凸字形）：前廳（一層量體，含門廊）往前凸出，前廳兩側外牆各一個行人入口大圓拱與長雨庇；
二樓正面與兩側牆片同在 y=Y2、一路落地（牆片各一扇門）；前廳頂是平台（一層屋頂）與女兒牆；二樓七扇圓拱長窗、兩側外牆、屋簷與屋面。

量體：門廊前牆 y=YP、前廳前牆（門廊背牆）y=YF、二樓正面與牆片 y=Y2=YP+PP（PP 見 common.py）。
前廳 x∈[XP0,XP1]、y∈[YF,Y2]，頂平台 z=5.40，平台周圍是一層簷口線腳兼女兒牆（頂 5.80）；二樓牆與腰線坐在平台面上（中央）或一路落地（兩側牆片）。"""
from common import *
from side import entrance_hole, entrance, side_arch_hole, side_arch, side_canopy, SIDE_ARCH_Y

FLANK_DOOR_W, FLANK_DOOR_H = 2.2, 3.0          # 兩側牆片的門（照片 01 右側牆片：寬約 2.3 m 的玻璃門）
FLANK_DOOR_C = XR - 1.55                       # 右牆片門中心（照片 01：門 x 497–530 px ⇒ x 9.7–12.0 m，取 10.85）
WIN_YS = [(Y2 + YB) / 2 + 2.5 * (k - 1) for k in range(3)]     # 兩側外牆（Y2→YB）一、二樓各三扇窗
Z_FLANK = Z_TER - 0.02                          # 牆片頂＝二樓正面下緣（兩片牆對接，不重疊）


def main_block(G):
    W = Wall('front', Y2)            # 二樓正面與牆片
    W1 = Wall('front', YF)           # 前廳前牆（門廊背牆）
    with G.part('舊站主體'):
        # ---- 二樓正面（含七扇圓拱長窗），底邊落在平台面（中央）與牆片頂（兩側）
        holes = [arch_hole(W, x, Z_SILL, WIN_W, Z_CROWN - WIN_W / 2, 0.30) for x in WX]
        wall_f(G, W.f, XL, XR, Z_FLANK, Z_CAP, holes, 'tile')
        mold(G, W, XL, XR, course_profile(), 'cream', 'course')
        # ---- 兩側牆片（一樓）：與二樓正面同一面牆，落地；各一扇門（左右對稱於二樓中軸）
        for (a, b), c, ends in (((XL, XP0), 2 * XC - FLANK_DOOR_C, (True, False)), ((XP1, XR), FLANK_DOOR_C, (False, True))):
            wall_f(G, W.f, a, b, 0.0, Z_FLANK, [rect_hole(W, c, 0.0, FLANK_DOOR_H, FLANK_DOOR_W, 0.30)], 'tile')
            door(G, W, c, FLANK_DOOR_W, FLANK_DOOR_H)
            e = FLANK_DOOR_W / 2 + 0.14 + 0.02                                   # 門套外緣
            if ends[0]:
                mold(G, W, a, c - e, plinth_profile(), 'ochre', 'plinth', ends=(True, None))
                mold(G, W, c + e, b, plinth_profile(), 'ochre', 'plinth', ends=(None, False))
            else:
                mold(G, W, a, c - e, plinth_profile(), 'ochre', 'plinth', ends=(False, None))
                mold(G, W, c + e, b, plinth_profile(), 'ochre', 'plinth', ends=(None, True))
        # ---- 前廳前牆（門廊背牆）：整片到平台面；門廊三扇入口門在 porch.py
        wall_f(G, W1.f, XP0, XP1, 0.0, Z_TER, [], 'tile')
        # ---- 前廳兩側外牆：一個行人入口大圓拱（正中）；上方沿整段外牆挑出長雨庇
        for kind, x in (('left', XP0), ('right', XP1)):
            S = Wall(kind, x)
            a, b = S.span(YF, Y2)
            wall_f(G, S.f, a, b, 0.0, Z_TER, [side_arch_hole(S)], 'tile')
            side_arch(G, S)
            ea, eb = SIDE_ARCH_Y - ARCH_W / 2 - 0.26 - 0.06, SIDE_ARCH_Y + ARCH_W / 2 + 0.26 + 0.06
            mold(G, S, YF, ea, plinth_profile(), 'ochre', 'plinth', ends=(True, None))      # 前端（YF）外擴 0.14 m 蓋進門廊側牆的勒腳裡：端面不再與前廳前牆（tile）共面
            mold(G, S, eb, Y2, plinth_profile(), 'ochre', 'plinth', ends=(None, False))
            side_canopy(G, kind, x, YF, Y2)
            mold(G, S, YF, Y2, cornice_profile(Z_TER - 0.02, PAR_S), 'cream', 'cornice', PAR_S, ends=(False, None))
            wbox(G, S, YF, Y2, Z_TER - 0.34, Z_TER - 0.02, 0, 0.08, 'cream', skip='nV')
        # ---- 平台（前廳屋頂）與前緣女兒牆
        box(G, XP0, XP1, YF, Y2, Z_TER - 0.08, Z_TER, 'roof', 'nUuVv')
        mold(G, W1, XP0, XP1, cornice_profile(Z_TER - 0.02, PAR_S), 'cream', 'cornice', PAR_S)
        wbox(G, W1, XP0, XP1, Z_TER - 0.34, Z_TER - 0.02, 0, 0.08, 'cream', skip='nV')
        # ---- 屋簷與女兒牆（二樓正面）
        mold(G, W, XL, XR, cornice_profile(), 'cream', 'cornice')
        wbox(G, W, XL, XR, Z_ROOF - 0.58, Z_ROOF - 0.02, 0, 0.10, 'cream', skip='nV')
        # ---- 兩側外牆（x=XL／XR，Y2→YB）：一樓三扇方窗、二樓三扇圓拱長窗
        for kind, x in (('right', XR), ('left', XL)):
            S = Wall(kind, x)
            a, b = S.span(Y2, YB)
            holes = [rect_hole(S, y, 1.4, 3.7, 1.5, 0.25) for y in WIN_YS]
            wall_f(G, S.f, a, b, 0.0, Z_FLANK, holes, 'tile')
            for y in WIN_YS:
                rect_window(G, S, y, 1.4, 3.7, 1.5)
            holes = [arch_hole(S, y, Z_SILL, WIN_W, Z_CROWN - WIN_W / 2, 0.30) for y in WIN_YS]
            wall_f(G, S.f, a, b, Z_FLANK, Z_CAP, holes, 'tile')
            for y in WIN_YS:
                arch_window(G, S, y, Z_SILL, WIN_W, Z_CROWN - WIN_W / 2, 0.30)
            mold(G, S, Y2, YB, course_profile(), 'cream', 'course', ends=(False, True))
            mold(G, S, Y2, YB, plinth_profile(), 'ochre', 'plinth', ends=(False, True))
            mold(G, S, Y2, YB, cornice_profile(), 'cream', 'cornice', ends=(False, False))
            wbox(G, S, Y2, YB, Z_ROOF - 0.58, Z_ROOF - 0.02, 0, 0.10, 'cream', skip='nV')
        # ---- 後牆上段（橫翼屋面以上外露）與後側屋簷
        B = Wall('back', YB)
        a, b = B.span(XL, XR)
        wall_f(G, B.f, a, b, WH - 0.5, Z_CAP, [], 'tile')
        mold(G, B, XL, XR, cornice_profile(), 'cream', 'cornice')
        wbox(G, B, XL, XR, Z_ROOF - 0.58, Z_ROOF - 0.02, 0, 0.10, 'cream', skip='nV')
        # ---- 屋面（遠近景）：二樓屋頂
        box(G, XL, XR, Y2, YB, Z_ROOF - 0.08, Z_ROOF - 0.02, 'roof', 'nUuVv')     # 只留頂面（四周被牆遮住，留著會與牆面共面）
        # ---- 前後角落的窄壁柱（外緣線腳，近景）
        with G.detail('near'):
            for x0, x1 in ((XL, XL + 0.42), (XR - 0.42, XR)):
                wbox(G, W, x0, x1, Z_SC1, Z_ROOF - 0.58, 0, 0.09, 'cream', 'n')
    with G.part('二樓長拱窗'):
        for i, x in enumerate(WX):
            arch_window(G, W, x, Z_SILL, WIN_W, Z_CROWN - WIN_W / 2, 0.30, keystone=(i != 3))
