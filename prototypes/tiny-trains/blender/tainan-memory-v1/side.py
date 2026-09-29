"""圓拱入口與雨庇（第二輪修訂：凸字形）：
- 前廳（一層量體）兩側外牆（x=XP0／XP1，由門廊背牆 YF 一路到二樓正面 Y2）中段各一個行人入口大圓拱（照片 02 左、照片 03 右），
  拱上方沿整段外牆挑出一條長雨庇（與門廊雨庇同高）；照片 01 中兩側牆片前面看到的「窄雨庇」就是這條長雨庇的前端。
雨庇的挑出量與長度、拱的位置依照片估計，屬外觀估計。"""
from common import *
from porch import arch_dressing
from brackets import corbel, lip_profile, soffit_panels

Z_LO, Z_HI = Z_PORCH, Z_CANOPY_TOP   # 側雨庇底與頂（與門廊雨庇同高）
SIDE_ARCH_Y = min(YP + 4.95, Y2 - ARCH_W / 2 - 0.9)   # 側入口拱中心：離門廊前牆 4.95 m（照片 02 量到 Y=-7.0、照片 03 量到 -7.7）；PP 較小時靠牆端留 0.9 m
SIDE_PROJ = 3.1                      # 側雨庇挑出（照片 02：左雨庇近端面兩端反投影得 3.11 m；照片 01 約 2.6–2.8 m）
ARCH_TOP = ARCH_SPRING + ARCH_W / 2  # 拱頂高（3.2 m）


def entrance_hole(W, c, w=ARCH_W, depth=0.80):
    """圓拱入口的洞口（拱頂統一在 ARCH_TOP）。"""
    return arch_hole(W, c, 0.0, w, ARCH_TOP - w / 2, depth)


def entrance(G, W, c, w=ARCH_W, depth=0.80):
    """圓拱入口的拱框、拱心石與深色門扇（洞口由 entrance_hole 交給 wall_f）。"""
    f = W.f
    u = W.u(c)
    arch_dressing(G, f, u, w / 2, ARCH_TOP - w / 2)
    dw = w - 0.30
    dsp = ARCH_TOP - 0.30 - dw / 2
    with G.detail('both'):
        fill_poly_f(G, f, hole_arch(u, w, 0.0, ARCH_TOP - w / 2, 0.0, 12)['poly'], -depth + 0.03, 'dark')      # 深色門扇填滿整個洞口（原本比洞口小 15 cm 一圈，斜看會從縫隙透到背景）
    with G.detail('near'):
        band_f(G, f, arch_outline(u, 0.0, dw / 2 + 0.12, dsp, 12), arch_outline(u, 0.0, dw / 2, dsp, 12), -depth, -depth + 0.07, 'cream', skip='n')
        box_f(G, f, u - 0.025, u + 0.025, 0.05, dsp + dw / 2, -depth + 0.03, -depth + 0.08, 'frame', 'n')
        box_f(G, f, u - dw / 2, u + dw / 2, dsp - 0.025, dsp + 0.025, -depth + 0.03, -depth + 0.075, 'frame', 'n')


def side_arch_hole(S):
    return entrance_hole(S, SIDE_ARCH_Y)


def side_arch(G, S):
    entrance(G, S, SIDE_ARCH_Y)


def canopy(G, W, a, b, proj, pitch=1.9, avoid=None):
    """從牆 W 往外挑出 proj 的雨庇，沿牆由 a 到 b（世界座標，a<b）：實心板、白色藻井底面、前緣階梯線腳、彎弧托架與分格藻井板。
    avoid＝(y0, y1)：這段範圍內不掛托架（牆上的拱框與拱心石在那裡，托架下垂 0.5 m 會與它們互相穿插）。"""
    f = W.f
    u0, u1 = W.span(a, b)
    with G.part('雨庇與托架'):
        box_f(G, f, u0, u1, Z_LO, Z_HI, 0.0, proj, 'ochre', 'nv')
        with G.detail('both'):
            p = f.p
            G.quad(p(u0, Z_LO, 0.0), p(u0, Z_LO, proj), p(u1, Z_LO, proj), p(u1, Z_LO, 0.0), 'white', (0.0, 0.0, -1.0))
        with G.detail('near'):
            molding(G, W, a, b, lip_profile(proj, Z_LO, Z_HI), 'ochre')
            n = max(2, int((b - a) // pitch) + 1)
            xs = [a + 0.5 + (b - a - 1.0) * i / (n - 1) for i in range(n)]
            if avoid:
                xs = [x for x in xs if not (avoid[0] < x < avoid[1])]
            for x in xs:
                corbel(G, W, x, proj - 0.10, Z_LO, h_wall=0.50, h_lip=0.14, w=0.40)
            soffit_panels(G, W, xs, proj, Z_LO)


def side_canopy(G, kind, x, y0, y1, proj=SIDE_PROJ):
    zone = ARCH_W / 2 + 0.26 + 0.06 + 0.30      # 拱框外緣再留 0.3 m
    canopy(G, Wall(kind, x), y0, y1, proj, avoid=(SIDE_ARCH_Y - zone, SIDE_ARCH_Y + zone))
