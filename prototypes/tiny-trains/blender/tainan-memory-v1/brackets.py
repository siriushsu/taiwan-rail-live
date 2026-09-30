"""雨庇托架：彎弧下緣、牆端捲成渦形、三層階梯線腳（照片 04：洗石子托架，寬窄多層，下緣為凹弧，牆端收成渦形，托架之間是白色分格藻井）。

托架垂直於牆、由牆面出挑到雨庇前緣；剖面 (out, z) 沿牆擠出，所以每支托架＝三塊寬窄不同、下緣一階比一階深的擠出體。
形狀依據照片 04 目測，各段尺寸是外觀估計（非測繪），已列入 pendingChecks。
"""
from common import *


def corbel_profile(L, zs, h_wall, h_lip, n=6, p=2.4, toe=0.11):
    """出挑 L、頂面貼在 zs（雨庇底）的托架剖面：
    前端深 h_lip，下緣沿凹弧（指數 p）向牆面加深到 h_wall，牆端用 1/4 圓（半徑 toe）收成渦形；頂面嵌進雨庇 2 cm。"""
    pts = [(0.0, zs + 0.02), (L, zs + 0.02), (L, zs - h_lip)]
    for i in range(1, n + 1):
        o = L - (L - toe) * i / n
        t = o / L
        pts.append((o, zs - (h_lip + (h_wall - h_lip) * (1 - t) ** p)))
    h_toe = zs - pts[-1][1]
    cx, cz = toe, zs - h_toe + toe
    for a in (-112.5, -135.0, -157.5, -180.0):
        pts.append((cx + toe * math.cos(math.radians(a)), cz + toe * math.sin(math.radians(a))))
    return pts


def corbel(G, W, xc, L, zs, h_wall=0.58, h_lip=0.16, w=0.46, mat='ochre'):
    """沿牆 W 在世界座標 xc 掛一支托架（W 的 out 方向為出挑方向）：三層——寬的在外、窄的下緣更深，前端一階比一階內縮。"""
    for k, (wd, drop) in enumerate(((w, 0.0), (w * 0.66, 0.07), (w * 0.34, 0.14))):
        molding(G, W, xc - wd / 2, xc + wd / 2, corbel_profile(L - 0.05 * k, zs, h_wall + drop, h_lip + drop * 0.6), mat)


def lip_profile(proj, z0, zt):
    """雨庇前緣的階梯線腳剖面 (out, z)，z0 為雨庇底、zt 為雨庇頂。階梯部分的高度按雨庇厚度縮放（原型厚 0.5 m），
    收尾兩點固定在頂下 0.07 m、頂——雨庇厚度縮到 0.4 m 之後，未縮放的階梯（頂到 z0+0.36）會蓋過收尾點而讓剖面自相交，
    擠出的側面出現朝內的細長面（第二輪 R4 從背面像素找到）。"""
    k = (zt - z0) / 0.5
    return [(proj, z0 + 0.04 * k), (proj + 0.06, z0 + 0.04 * k), (proj + 0.10, z0 + 0.08 * k), (proj + 0.10, z0 + 0.18 * k), (proj + 0.06, z0 + 0.22 * k),
            (proj + 0.06, z0 + 0.32 * k), (proj + 0.10, z0 + 0.36 * k), (proj + 0.10, zt - 0.07), (proj + 0.04, zt), (proj, zt)]


def lip_band(z0, zt):
    """線腳凹面（proj+0.06 那一段直立面）的 z 範圍，供壓條對位。"""
    k = (zt - z0) / 0.5
    return z0 + 0.23 * k, z0 + 0.31 * k


def soffit_panels(G, W, xs, proj, z0, margin=0.26):
    """白色藻井：相鄰兩支托架之間各一塊凹進的分格板（外框一層、內框再一層）。xs 為托架位置（世界座標）。"""
    f = W.f
    for a, b in zip(xs, xs[1:]):
        ua, ub = W.span(a, b)
        u0, u1 = ua + 0.34, ub - 0.34
        if u1 - u0 < 0.3:
            continue
        d0, d1 = margin, proj - margin
        box_f(G, f, u0, u1, z0 - 0.05, z0, d0, d1, 'white', 'V')
        box_f(G, f, u0 + 0.16, u1 - 0.16, z0 - 0.09, z0 - 0.05, d0 + 0.16, d1 - 0.16, 'white', 'V')
