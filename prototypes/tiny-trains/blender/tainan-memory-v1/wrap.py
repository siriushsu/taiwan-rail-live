"""2026-09-12 當天的施工外罩：主棟與橫翼二樓以上包覆的半透明鷹架外罩（獨立網格 wrap.mesh.bin，頁面可切換）。

依據
- 聯合報 2026-06-02 圖說「台南車站主體上半部還是鐵皮圍籬包覆」；2026-06-02 至 09-12 未查到拆除報導。
- 外觀依 2026-01-18 照片 03（半透明淺灰布面、深色直向骨架、下緣鷹架鋼管、南側白色施工圍籬）與 2025-05 照片 05 目測；
  掛設範圍、高度、骨架間距、圍籬位置皆為外觀估計，不是施工圖，已列入 pendingChecks。
- 布面單面（法線朝外）：從外側看，遠側面因背面剔除不會疊出雜訊；材質不透明度由 model.json 的 wrap drawGroups 給出。
"""
from common import *

Z_WB = Z_CANOPY_TOP                       # 正面布面下緣：坐在門廊雨庇頂
Z_WT = 14.4                               # 主棟布面頂（高於屋頂尖飾約 0.6 m）
Z_WSIDE = 8.0                             # 兩側布面下緣（其下露出鷹架鋼管）
Z_WNOTCH = Z_CANOPY_TOP + 1.95            # 山形壁上方：正面布面在此處下緣抬高，讓山形壁露在布面前
Z_WWB = 5.0                               # 橫翼布面下緣
Z_WWT = WH + 0.9                          # 橫翼布面頂

MX0, MX1 = XL - 1.1, XR + 1.1             # 主棟外罩 x 範圍（離牆 1.1 m 鷹架寬）
MY0, MY1 = YF - 1.2, YB + 1.1
QX0, QX1 = WX0 - 1.0, WX1 + 1.0           # 橫翼外罩
QY0, QY1 = YB - 1.1, WY1 + 1.1
PX0, PX1 = XPC - 6.9, XPC + 6.9           # 正面下緣抬高的範圍（山形壁寬 12.7 m 外各留 0.5 m）
TUBE_R = 0.045
SIDE_PROJ_FENCE = 3.7                     # 南側圍籬離主棟右牆的距離（在側雨庇挑出 3.0 m 之外）


def fab(G, f, poly, mat='wrap_fabric'):
    fill_poly_f(G, f, poly, 0.0, mat, facing=1)


def rib(G, f, u, v0, v1, w=0.09):
    box_f(G, f, u - w / 2, u + w / 2, v0, v1, 0.0, 0.05, 'wrap_rib', 'n')


def seam(G, f, u0, u1, v, h=0.10):
    box_f(G, f, u0, u1, v - h / 2, v + h / 2, 0.0, 0.03, 'wrap_seam', 'n')


def tube(G, a, b, r=TUBE_R):
    rod(G, a, b, r, 'scaffold', n=6, caps=False)


def scaffold_side(G, x, y0, y1, z0, z1, pitch=2.1):
    """外罩下緣露出的鷹架：直立管、三道橫桿與斜撐，沿 y 由 y0 到 y1。"""
    n = max(2, int(round((y1 - y0) / pitch)))
    ys = [y0 + (y1 - y0) * i / n for i in range(n + 1)]
    zs = [z0 + 0.6, z0 + 0.6 + (z1 - z0 - 0.6) / 2, z1]
    for y in ys:
        tube(G, (x, y, z0), (x, y, z1 + 0.25))
    for z in zs:
        tube(G, (x, y0, z), (x, y1, z))
    for i in range(n):
        if i % 2 == 0:
            tube(G, (x, ys[i], zs[0]), (x, ys[i + 1], zs[-1]))
        else:
            tube(G, (x, ys[i + 1], zs[0]), (x, ys[i], zs[-1]))


def fence_run(G, p0, p1, h=2.4, panel=2.4):
    """白色施工圍籬（不透明，雙面）：由 p0 到 p1 的一段，每 panel 米一片，附立柱與頂緣。"""
    (x0, y0), (x1, y1) = p0, p1
    L = math.hypot(x1 - x0, y1 - y0)
    ux, uy = (x1 - x0) / L, (y1 - y0) / L
    nx, ny = uy, -ux
    n = max(1, int(round(L / panel)))
    for i in range(n):
        a = (x0 + ux * L * i / n, y0 + uy * L * i / n)
        b = (x0 + ux * L * (i + 1) / n, y0 + uy * L * (i + 1) / n)
        for sgn in (1, -1):
            off = 0.03 * sgn
            A = (a[0] + nx * off, a[1] + ny * off)
            B = (b[0] + nx * off, b[1] + ny * off)
            G.quad((A[0], A[1], 0.0), (B[0], B[1], 0.0), (B[0], B[1], h), (A[0], A[1], h), 'fence', (nx * sgn, ny * sgn, 0.0))
        # 立柱與頂緣
        rod(G, (a[0], a[1], 0.0), (a[0], a[1], h + 0.12), 0.05, 'scaffold', n=6)
    rod(G, (x1, y1, 0.0), (x1, y1, h + 0.12), 0.05, 'scaffold', n=6)
    rod(G, (x0, y0, h + 0.06), (x1, y1, h + 0.06), 0.035, 'scaffold', n=6, caps=False)
    rod(G, (x0, y0, 0.55), (x1, y1, 0.55), 0.03, 'scaffold', n=6, caps=False)


def build():
    G = Geo()
    with G.part('外罩'):
        # ---- 主棟正面：下緣在山形壁上方抬高
        F = front(MY0)
        fab(G, F, [(MX0, Z_WB), (PX0, Z_WB), (PX0, Z_WNOTCH), (PX1, Z_WNOTCH), (PX1, Z_WB), (MX1, Z_WB), (MX1, Z_WT), (MX0, Z_WT)])
        ribs_u = [MX0 + i * (MX1 - MX0) / 8 for i in range(9)]
        for u in ribs_u:
            rib(G, F, u, Z_WNOTCH if PX0 < u < PX1 else Z_WB, Z_WT)
        for z in (Z_WNOTCH, 8.4, 9.4, 10.4, 11.4, 12.4, 13.4):
            seam(G, F, MX0, MX1, z, 0.07)
        for z in (Z_WB + 0.08, 6.4):
            seam(G, F, MX0, PX0, z, 0.07)
            seam(G, F, PX1, MX1, z, 0.07)

        # ---- 主棟兩側：下緣 Z_WSIDE，其下為鷹架鋼管；與橫翼相接處外罩改由橫翼頂以上
        for kind, x, sgn in (('left', MX0, -1), ('right', MX1, 1)):
            S = {'left': left, 'right': right}[kind](x)
            u_of = (lambda y: -y) if kind == 'left' else (lambda y: y)
            ya = u_of(MY0)
            poly = [(u_of(MY0), Z_WSIDE), (u_of(QY0), Z_WSIDE), (u_of(QY0), Z_WWT), (u_of(MY1), Z_WWT), (u_of(MY1), Z_WT), (u_of(MY0), Z_WT)]
            fab(G, S, poly)
            for i in range(0, 5):
                y = MY0 + (QY0 - MY0) * i / 4
                rib(G, S, u_of(y), Z_WSIDE, Z_WT)
            for z in (9.0, 10.0, 11.0, 12.0, 13.0, 14.0):
                seam(G, S, min(u_of(MY0), u_of(QY0)), max(u_of(MY0), u_of(QY0)), z, 0.07)
            scaffold_side(G, x, MY0, QY0, Z_CANOPY_TOP - 0.6, Z_WSIDE)
        # ---- 主棟背面上段與頂
        Bk = back(MY1)
        fab(G, Bk, [(-MX1, Z_WWT), (-MX0, Z_WWT), (-MX0, Z_WT), (-MX1, Z_WT)])
        for i in range(9):
            rib(G, Bk, -(MX0 + i * (MX1 - MX0) / 8), Z_WWT, Z_WT)
        fab(G, world(Z_WT), [(MX0, MY0), (MX1, MY0), (MX1, MY1), (MX0, MY1)], 'wrap_top')

        # ---- 橫翼：正面兩段、兩端、背面與頂（離牆 1.0 m）
        Fw = front(QY0)
        for a, b in ((QX0, MX0), (MX1, QX1)):
            fab(G, Fw, [(a, Z_WWB), (b, Z_WWB), (b, Z_WWT), (a, Z_WWT)])
            for i in range(int((b - a) // 3.4) + 1):
                u = a + (b - a) * i / max(1, int((b - a) // 3.4))
                rib(G, Fw, u, Z_WWB, Z_WWT)
            seam(G, Fw, a, b, Z_WWT - 1.2)
        for kind, x, u_of in (('left', QX0, lambda y: -y), ('right', QX1, lambda y: y)):
            S = {'left': left, 'right': right}[kind](x)
            u0, u1 = sorted((u_of(QY0), u_of(QY1)))
            fab(G, S, [(u0, Z_WWB), (u1, Z_WWB), (u1, Z_WWT), (u0, Z_WWT)])
            n = int((QY1 - QY0) // 3.4)
            for i in range(n + 1):
                rib(G, S, u_of(QY0 + (QY1 - QY0) * i / n), Z_WWB, Z_WWT)
            seam(G, S, u0, u1, Z_WWT - 1.2)
        Bw = back(QY1)
        fab(G, Bw, [(-QX1, Z_WWB), (-QX0, Z_WWB), (-QX0, Z_WWT), (-QX1, Z_WWT)])
        n = int((QX1 - QX0) // 3.4)
        for i in range(n + 1):
            rib(G, Bw, -(QX0 + (QX1 - QX0) * i / n), Z_WWB, Z_WWT)
        seam(G, Bw, -QX1, -QX0, Z_WWT - 1.2)
        for (xa, xb, ya, yb) in ((QX0, MX0, QY0, QY1), (MX1, QX1, QY0, QY1), (MX0, MX1, MY1, QY1)):
            fab(G, world(Z_WWT), [(xa, ya), (xb, ya), (xb, yb), (xa, yb)], 'wrap_top')

        # ---- 正面下緣的鋼管（承托布面下緣）
        tube(G, (MX0, MY0, Z_WB), (MX1, MY0, Z_WB))
        for u in ribs_u:
            if not (PX0 < u < PX1):
                tube(G, (u, MY0, Z_WB - 0.6), (u, MY0, Z_WB + 0.3))
        # ---- 南側（+X）地面層白色施工圍籬：正面短段與側邊長段，L 形
        fx = XR + SIDE_PROJ_FENCE
        fence_run(G, (XP1 + 0.8, YF - 1.7), (fx, YF - 1.7))
        fence_run(G, (fx, YF - 1.7), (fx, YB + 9.0))
    return G

