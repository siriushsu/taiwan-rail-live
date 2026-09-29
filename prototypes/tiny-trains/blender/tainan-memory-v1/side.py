"""兩側行人入口：主棟左右側牆靠前處各一個圓拱入口（照片 02、03），上方有向外挑出的側雨庇（照片 01 中左右兩端外挑的窄雨庇）。
側雨庇的挑出量與長度依照片估計（照片 01：左側雨庇端點超出主棟左緣約 3.3 m），屬外觀估計。"""
from common import *
from porch import arch_dressing, BAND

Z_LO, Z_HI = 4.35, 4.85          # 側雨庇底與頂
SIDE_ARCH_Y = YF + 2.6           # 側入口拱中心（距正面 2.6 m）
SIDE_PROJ = 3.0                  # 側雨庇挑出


def side_arch_hole(S):
    return arch_hole(S, SIDE_ARCH_Y, 0.0, ARCH_W, ARCH_SPRING, 0.80)


def side_arch(G, S):
    """側入口的拱框、拱心石與深色門扇（洞口由 side_arch_hole 交給 wall_f）。"""
    f = S.f
    u = S.u(SIDE_ARCH_Y)
    arch_dressing(G, f, u, ARCH_W / 2, ARCH_SPRING)
    poly = hole_arch(u, 2.2, 0.0, 2.35, 0.0, 12)['poly']
    with G.detail('both'):
        fill_poly_f(G, f, poly, -0.77, 'dark')
    with G.detail('near'):
        band_f(G, f, arch_outline(u, 0.0, 1.22, 2.35, 12), arch_outline(u, 0.0, 1.1, 2.35, 12), -0.80, -0.73, 'cream', skip='n')
        box_f(G, f, u - 0.025, u + 0.025, 0.05, 3.45, -0.77, -0.72, 'frame', 'n')
        box_f(G, f, u - 1.1, u + 1.1, 2.35 - 0.025, 2.35 + 0.025, -0.77, -0.725, 'frame', 'n')


def side_canopy(G, kind, x, y0, y1, proj=SIDE_PROJ):
    """從側牆 x 往外挑出 proj 的雨庇，沿 y 由 y0 到 y1。"""
    S = Wall(kind, x)
    sgn = 1 if kind == 'right' else -1
    with G.part('雨庇與托架'):
        wbox(G, S, y0, y1, Z_LO, Z_HI, 0.0, proj, 'ochre', skip='nv')
        with G.detail('both'):
            xa, xb = (x, x + proj) if sgn > 0 else (x - proj, x)
            fill_poly_f(G, world(Z_LO), [(xa, y0), (xb, y0), (xb, y1), (xa, y1)], 0.0, 'white', facing=-1)
        with G.detail('near'):
            p = proj
            molding(G, S, y0, y1, [(p, Z_LO + 0.05), (p + 0.06, Z_LO + 0.05), (p + 0.10, Z_LO + 0.09), (p + 0.10, Z_LO + 0.24), (p + 0.06, Z_LO + 0.28),
                                   (p + 0.06, Z_LO + 0.40), (p + 0.10, Z_LO + 0.44), (p + 0.10, Z_HI - 0.05), (p + 0.04, Z_HI), (p, Z_HI)], 'ochre')
            prof = [(0.0, Z_LO + 0.02), (1.05, Z_LO + 0.02), (1.05, Z_LO - 0.14), (0.78, Z_LO - 0.14), (0.78, Z_LO - 0.28), (0.5, Z_LO - 0.28), (0.5, Z_LO - 0.42), (0.0, Z_LO - 0.42)]
            n = max(2, int((y1 - y0) // 1.9) + 1)
            for i in range(n):
                yy = y0 + 0.5 + (y1 - y0 - 1.0) * i / (n - 1)
                molding(G, S, yy - 0.2, yy + 0.2, prof, 'ochre')
            # 白色藻井的內縮嵌板
            for i in range(n - 1):
                ya = y0 + 0.5 + (y1 - y0 - 1.0) * i / (n - 1) + 0.32
                yb = y0 + 0.5 + (y1 - y0 - 1.0) * (i + 1) / (n - 1) - 0.32
                x0, x1 = (x + 0.30, x + proj - 0.30) if sgn > 0 else (x - proj + 0.30, x - 0.30)
                box(G, x0, x1, ya, yb, Z_LO - 0.05, Z_LO, 'white', 'N')
