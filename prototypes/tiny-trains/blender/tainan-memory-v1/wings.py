"""橫翼與一層延伸：二層橫翼（左右露出於主棟兩側）、一層延伸（左側，含入口雨庇）、後側與端牆的窗、屋面與簷口。
平面依 OSM 輪廓，立面高度與窗位由照片 01（左右翼露出的部分）與照片 05 估計，皆屬外觀估計，非測繪。"""
from common import *

W2_ARCH_W = 1.1                     # 翼樓二層圓拱窗寬（照片 01：約主棟長窗的 0.75 倍）
W2_SPRING = Z_SILL + 2.02           # 翼樓圓拱窗起拱高
Z_W_ROOF = WH - 0.42                # 翼樓屋面（簷口下緣）
Z_G_ROOF = GH - 0.36                # 一層延伸屋面


def face(G, kind, plane, a, b, z0, z1, arches=(), rects=(), doors=()):
    """一面帶窗的牆；arches：(中心 w, 寬, 下緣, 起拱)；rects：(中心 w, 下緣, 上緣, 寬)；doors：(中心 w, 寬, 高)。"""
    W = Wall(kind, plane)
    holes = [arch_hole(W, c, sill, w, vs, 0.28) for c, w, sill, vs in arches]
    holes += [rect_hole(W, c, v0, v1, w, 0.25) for c, v0, v1, w in rects]
    holes += [rect_hole(W, c, 0.0, h, w, 0.30) for c, w, h in doors]
    u0, u1 = W.span(a, b)
    wall_f(G, W.f, u0, u1, z0, z1, holes, 'tile')
    for c, w, sill, vs in arches:
        arch_window(G, W, c, sill, w, vs, 0.28)
    for c, v0, v1, w in rects:
        rect_window(G, W, c, v0, v1, w)
    for c, w, h in doors:
        door(G, W, c, w, h)
    return W


def trim(G, W, a, b, z_cornice, s, cornice=(True, True), course=(True, True), plinth=(True, True)):
    """簷口、簷下帶、腰線與勒腳；三個 ends 參數（True 外擴／False 內縮／None 齊平／整組 None 不做）見 common.mold。"""
    if cornice is not None:
        mold(G, W, a, b, cornice_profile(z_cornice, s), 'cream', 'cornice', s, cornice)
        wbox(G, W, a, b, z_cornice - 0.40 * s, z_cornice, 0, 0.08, 'cream', skip='nV')
    if course is not None:
        mold(G, W, a, b, course_profile(), 'cream', 'course', ends=course)
    if plinth is not None:
        mold(G, W, a, b, plinth_profile(), 'ochre', 'plinth', ends=plinth)


def wings(G):
    ys = distribute(YB, WY1, 4.2, 1.5)                       # 端牆與後牆的窗位（沿 y／x 等距）
    with G.part('側翼與後翼'):
        # ---- 二層橫翼：正面（左右各露出一段）
        left_c = (WX0 + XL) / 2
        Wf = face(G, 'front', YB, WX0, XL, 0, WH,
                  arches=[(left_c, W2_ARCH_W, Z_SILL, W2_SPRING)], doors=[(left_c, 1.6, 2.7)])
        trim(G, Wf, WX0, XL, Z_W_ROOF, 0.8, plinth=None)
        # 勒腳在門洞處中斷，與一層延伸的勒腳對接
        mold(G, Wf, WX0, left_c - 0.8 - 0.14, plinth_profile(), 'ochre', 'plinth', ends=(None, None))
        mold(G, Wf, left_c + 0.8 + 0.14, XL, plinth_profile(), 'ochre', 'plinth', ends=(None, True))
        # 左翼入口雨庇（照片 01：左翼一樓入口上方有窄雨庇，約 z 4.4 m）
        wbox(G, Wf, WX0 - 0.15, XL, 4.02, 4.44, 0.0, 1.5, 'ochre', skip='n')
        with G.detail('near'):
            wbox(G, Wf, WX0 - 0.15, XL, 3.96, 4.02, 0.0, 1.56, 'cream', skip='n')
            for x in (WX0 + 0.35, XL - 0.35):
                molding(G, Wf, x - 0.14, x + 0.14, [(0, 4.04), (1.0, 4.04), (1.0, 3.94), (0.65, 3.94), (0.65, 3.80), (0.30, 3.80), (0.30, 3.66), (0, 3.66)], 'ochre')
        xs = distribute(XR, WX1, 4.2, 1.6)
        Wf2 = face(G, 'front', YB, XR, WX1, 0, WH,
                   arches=[(x, W2_ARCH_W, Z_SILL, W2_SPRING) for x in xs],
                   rects=[(x, 1.2, 3.4, 1.4) for x in xs])
        trim(G, Wf2, XR, WX1, Z_W_ROOF, 0.8)

        # ---- 二層橫翼：右端牆（朝 +X，南側）與左端牆上段（一層延伸以上）
        Wr = face(G, 'right', WX1, YB, WY1, 0, WH,
                  arches=[(y, W2_ARCH_W, Z_SILL, W2_SPRING) for y in ys],
                  rects=[(y, 1.2, 3.4, 1.4) for y in ys])
        trim(G, Wr, YB, WY1, Z_W_ROOF, 0.8, cornice=(False, False), course=(False, False), plinth=(False, False))
        Wl = face(G, 'left', WX0, YB, WY1, GH - 0.1, WH,
                  arches=[(y, W2_ARCH_W, Z_SILL, W2_SPRING) for y in ys])
        trim(G, Wl, YB, WY1, Z_W_ROOF, 0.8, cornice=(False, False), course=(False, False), plinth=None)

        # ---- 二層橫翼：後牆（月台側）與一層延伸的後牆
        xb = distribute(WX0, WX1, 4.2, 1.5)
        Wk = face(G, 'back', WY1, WX0, WX1, 0, WH,
                  arches=[(x, W2_ARCH_W, Z_SILL, W2_SPRING) for x in xb],
                  rects=[(x, 1.2, 3.4, 1.4) for x in xb])
        trim(G, Wk, WX0, WX1, Z_W_ROOF, 0.8, plinth=(None, True))
        xg = distribute(GX0, WX0, 3.6, 1.0)
        Wg = face(G, 'back', WY1, GX0, WX0, 0, GH, rects=[(x, 1.0, 3.0, 1.3) for x in xg])
        trim(G, Wg, GX0, WX0, Z_G_ROOF, 0.7, cornice=(True, None), course=None, plinth=(True, None))

        # ---- 一層延伸：正面與左端牆
        Wgf = face(G, 'front', YB, GX0, WX0, 0, GH, rects=[(x, 1.0, 3.0, 1.3) for x in xg])
        trim(G, Wgf, GX0, WX0, Z_G_ROOF, 0.7, cornice=(True, None), course=None, plinth=(True, None))
        Wgl = face(G, 'left', GX0, YB, WY1, 0, GH, rects=[(y, 1.0, 3.0, 1.3) for y in distribute(YB, WY1, 3.6, 1.0)])
        trim(G, Wgl, YB, WY1, Z_G_ROOF, 0.7, cornice=(False, False), course=None, plinth=(False, False))

        # ---- 屋面（遠近景）
        box(G, WX0, WX1, YB, WY1, Z_W_ROOF - 0.06, Z_W_ROOF, 'roof', 'nUuVv')
        box(G, GX0, WX0, YB, WY1, Z_G_ROOF - 0.06, Z_G_ROOF, 'roof', 'nUuVv')
