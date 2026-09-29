"""淺浮雕花帶牌（立面兩側的圓形花環牌、門廊山形壁上的徽章牌共用）。"""
from common import *


def relief_panel(G, f, uc, vc, w, h, big=False, mat='cream'):
    """牆面座標 (u,v) 的淺浮雕：邊框、中央橢圓章、左右起伏花帶與花苞。浮出量約 0.07 m。皆屬近景細節。"""
    with G.detail('near'):
        b = 0.07
        box_f(G, f, uc - w / 2, uc + w / 2, vc + h / 2 - b, vc + h / 2, 0, 0.06, mat, 'n')
        box_f(G, f, uc - w / 2, uc + w / 2, vc - h / 2, vc - h / 2 + b, 0, 0.06, mat, 'n')
        box_f(G, f, uc - w / 2, uc - w / 2 + b, vc - h / 2 + b, vc + h / 2 - b, 0, 0.06, mat, 'n')
        box_f(G, f, uc + w / 2 - b, uc + w / 2, vc - h / 2 + b, vc + h / 2 - b, 0, 0.06, mat, 'n')
        rx, ry = (0.60, 0.44) if big else (0.42, 0.30)
        band_f(G, f, ellipse_pts(uc, vc, rx, ry, 20), ellipse_pts(uc, vc, rx * 0.72, ry * 0.72, 20), 0, 0.08, mat, closed=True, skip='n')
        fill_poly_f(G, f, ellipse_pts(uc, vc, rx * 0.72, ry * 0.72, 20), 0.03, 'ochre')
        amp = h * 0.20
        for s in (-1, 1):
            u0, u1 = uc + s * (rx + 0.10), uc + s * (w / 2 - 0.22)
            pts = wave_pts(u0, u1, vc, amp, 1.5 if big else 1.25, 18, taper=0.25)
            band_f(G, f, offset_line(pts, 0.045), offset_line(pts, -0.045), 0, 0.07, mat, skip='n')
            for i in (3, 9, 15):
                ring_f(G, f, pts[i][0], pts[i][1] + (0.10 if pts[i][1] >= vc else -0.10), 0.03, 0.085, 0, 0.078, mat, n=10, skip='n')
        if big:
            ring_f(G, f, uc, vc + ry + 0.10, 0.06, 0.15, 0, 0.08, mat, n=12, skip='n')
