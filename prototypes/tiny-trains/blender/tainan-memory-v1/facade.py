"""二樓正面的立面元素：4 根壁柱（外側兩根半圓壁柱含柱腳、柱頭與屋頂尖飾，內側兩根平壁柱）、中央女兒牆加高與小山形壁、
簷下帶狀浮雕（中央齒飾、兩側菱形格紋）、兩塊浮雕花帶牌、圓鐘。"""
from common import *
from relief import relief_panel

Z_FR0, Z_FR1 = Z_ROOF - 0.58, Z_ROOF - 0.02      # 簷下帶狀飾帶
Z_PLAQUE = 10.98                                 # 長窗拱頂升到 10.32 後，花帶牌上移並縮小（3.4×0.95→2.9×0.85），不與拱框、拱心石重疊


def sphere_profile(R, zc, n=6):
    """由下極點到上極點的半圓輪廓 (r, h)。"""
    return [(R * math.cos(-math.pi / 2 + math.pi * i / n), zc + R * math.sin(-math.pi / 2 + math.pi * i / n)) for i in range(n + 1)]


def pilasters(G):
    W = Wall('front', Y2)
    f = W.f
    with G.part('壁柱與線腳'):
        # 內側兩根平壁柱（框住中央長窗）
        for s in (-1, 1):
            u = W.u(XC + s * INNER)
            box_f(G, f, u - 0.27, u + 0.27, Z_SC1, Z_FR1 - 0.12, 0, 0.14, 'cream', 'n')
            with G.detail('near'):
                box_f(G, f, u - 0.36, u + 0.36, Z_SC1, Z_SC1 + 0.40, 0, 0.21, 'cream', 'n')
                box_f(G, f, u - 0.33, u + 0.33, Z_SC1 + 0.40, Z_SC1 + 0.50, 0, 0.18, 'cream', 'n')
                box_f(G, f, u - 0.33, u + 0.33, Z_FR1 - 0.62, Z_FR1 - 0.50, 0, 0.18, 'cream', 'n')
                box_f(G, f, u - 0.36, u + 0.36, Z_FR1 - 0.50, Z_FR1 - 0.12, 0, 0.21, 'cream', 'n')
                box_f(G, f, u - 0.40, u + 0.40, Z_FR1 - 0.12, Z_FR1, 0, 0.25, 'ochre', 'n')
        # 外側兩根半圓壁柱：柱腳、柱身、柱頭，並穿過屋簷升成屋頂尖飾
        for s in (-1, 1):
            xp = XC + s * PIER
            u = W.u(xp)
            box_f(G, f, u - 0.58, u + 0.58, Z_SC1, Z_SC1 + 0.50, 0, 0.36, 'cream', 'n')
            with G.detail('near'):
                box_f(G, f, u - 0.53, u + 0.53, Z_SC1 + 0.50, Z_SC1 + 0.62, 0, 0.32, 'ochre', 'n')
            # 柱身半殼頂端補一片半圓蓋（半徑 0.47）：柱頭方塊只深 0.40，前 7 cm 從上方看得進中空的柱身（驗收員 R4：背面像素）
            prof = [(0.47, 6.30), (0.47, 6.42), (0.42, 6.55), (0.42, 11.15), (0.47, 11.28), (0.47, 11.40), (0.0, 11.40)]
            revolve_f(G, world(), xp, Y2, prof, 'cream', n=16, smooth=[1, 2, 3, 4], a0=math.pi, a1=2 * math.pi)
            box_f(G, f, u - 0.55, u + 0.55, 11.40, 11.66, 0, 0.40, 'cream', 'n')
            with G.detail('near'):
                box_f(G, f, u - 0.66, u + 0.66, 11.66, 11.90, 0, 0.44, 'ochre', 'n')
                box_f(G, f, u - 0.58, u + 0.58, 11.90, 11.98, 0, 0.30, 'cream', 'n')
            # 屋頂尖飾：方座＋線腳＋圓球
            box_f(G, f, u - 0.45, u + 0.45, Z_CAP - 0.02, 13.05, -0.30, 0.40, 'cream')      # 補背面（第一版 skip='n' 從後方看會透空）
            box_f(G, f, u - 0.56, u + 0.56, 13.05, 13.20, -0.35, 0.46, 'ochre')
            with G.detail('near'):
                revolve_f(G, world(), xp, Y2 - 0.05, sphere_profile(0.30, 13.50, 6), 'cream', n=12)


def pavilion(G):
    """中央三開間：女兒牆加高成低山形壁；簷下帶齒飾；兩側各段為菱形格紋。"""
    W = Wall('front', Y2)
    f = W.f
    with G.part('山形壁與浮雕'):
        xa, xb = XC - PIER + 0.45, XC + PIER - 0.45
        u0, u1 = W.u(xa), W.u(xb)
        um = W.u(XC)
        extrude_f(G, f, [(u0, Z_CAP - 0.02), (u1, Z_CAP - 0.02), (u1, Z_CAP + 0.36), (um, Z_CAP + 0.92), (u0, Z_CAP + 0.36)], -0.30, 0.10, 'cream')   # 補背面
        T = [(u0 - 0.05, Z_CAP + 0.34), (um, Z_CAP + 0.92), (u1 + 0.05, Z_CAP + 0.34)]
        band_f(G, f, [(u, v + 0.14) for u, v in T], T, -0.29, 0.20, 'ochre')        # 後蓋在山形壁背面（-0.30）前 1 cm：不共面、也不留洞
        with G.detail('near'):
            wbox(G, W, xa, xb, Z_CAP - 0.02, Z_CAP + 0.12, 0.10, 0.17, 'ochre', 'n')
            # 山形壁中央的小圓形浮雕
            ring_f(G, f, um, Z_CAP + 0.36, 0.12, 0.22, 0.10, 0.16, 'ochre', n=16, skip='n')
            # 中央齒飾
            skip_x = [XC + s * d for s in (-1, 1) for d in (INNER, PIER)]
            x = XC - PIER + 0.62
            while x < XC + PIER - 0.60:
                if all(abs(x - sx) > 0.78 for sx in skip_x):
                    box_f(G, f, W.u(x) - 0.085, W.u(x) + 0.085, Z_FR0 + 0.20, Z_FR0 + 0.42, 0.10, 0.19, 'cream', 'n')
                x += 0.34
            # 兩側菱形格紋
            for a, b in ((XL + 0.65, XC - PIER - 0.75), (XC + PIER + 0.75, XR - 0.65)):
                n = int((b - a) // 0.52)
                for i in range(n + 1):
                    cx = a + (b - a) * i / n
                    c = W.u(cx)
                    cz = (Z_FR0 + Z_FR1) / 2
                    extrude_f(G, f, [(c - 0.22, cz), (c, cz + 0.22), (c + 0.22, cz), (c, cz - 0.22)], 0.10, 0.17, 'cream', skip='n')
            # 簷下帶上下兩條細線腳
            wbox(G, W, XL, XR, Z_FR0 - 0.05, Z_FR0 + 0.03, 0.10, 0.15, 'cream', 'n')


def plaques(G):
    W = Wall('front', Y2)
    with G.part('山形壁與浮雕'):
        for s in (-1, 1):
            relief_panel(G, W.f, W.u(XC + s * 2.5 * PITCH), Z_PLAQUE, 2.9, 0.85)


def clock(G):
    """圓鐘：長窗拱頂升到 10.32 m 後，鐘縮成第一版的 0.77 倍（面板半徑 0.36、土黃鐘框到 0.46、米黃外圈到 0.51），
    中心 z 10.87：下緣 10.36 在拱頂（10.32）之上、上緣 11.38 在簷下帶（11.42）之下。中央長窗不做拱心石，讓出位置。"""
    W = Wall('front', Y2)
    f = W.f
    sc = 0.766
    u, vc, R = W.u(XC), 10.87, 0.47 * sc
    k = R / 0.51
    with G.part('圓鐘'):
        with G.detail('both'):
            disc_f(G, f, u, vc, R, 0.05, 'white', n=32)
            ring_f(G, f, u, vc, R - 0.02, 0.60 * sc, 0, 0.14, 'ochre', n=32, skip='n')
        with G.detail('near'):
            ring_f(G, f, u, vc, 0.60 * sc, 0.66 * sc, 0, 0.10, 'cream', n=32, skip='n')
            for i in range(12):
                t = math.radians(30 * i)
                r0, r1 = ((0.36, 0.47) if i % 3 == 0 else (0.41, 0.47))
                r0, r1 = r0 * k, r1 * k
                extrude_f(G, f, seg_poly((u + r0 * math.cos(t), vc + r0 * math.sin(t)), (u + r1 * math.cos(t), vc + r1 * math.sin(t)), (0.045 if i % 3 == 0 else 0.028) * sc), 0.05, 0.075, 'dark', skip='n')
            # 指針固定在 10:10（示意，非封存當刻）
            th = math.radians(90 - (10 + 10 / 60) * 30)
            tm = math.radians(90 - 10 * 6)
            extrude_f(G, f, seg_poly((u, vc), (u + 0.24 * sc * math.cos(th), vc + 0.24 * sc * math.sin(th)), 0.055 * sc), 0.075, 0.095, 'dark', skip='n')
            extrude_f(G, f, seg_poly((u, vc), (u + 0.36 * sc * math.cos(tm), vc + 0.36 * sc * math.sin(tm)), 0.035 * sc), 0.095, 0.115, 'dark', skip='n')
            disc_f(G, f, u, vc, 0.045 * sc, 0.118, 'dark', n=10)


def facade(G):
    pilasters(G)
    pavilion(G)
    plaques(G)
    clock(G)
