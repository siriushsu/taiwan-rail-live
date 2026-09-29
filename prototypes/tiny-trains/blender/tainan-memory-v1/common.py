"""臺南舊站房共用尺寸與小工具（各部位模組共用）。座標與 station-footprint.json 同框：X 右、Y 向後（月台側）、Z 向上；正面朝 -Y。

尺寸依據
- 平面：OSM relation 6477070 輪廓（station-footprint.json 的 local）。
- 立面比例：2015-12-28 正立面照片（refs/01，近似正投影）。以主棟寬 25.4 m（OSM）換算約 14.6 px/m；
  七扇長窗中心距 50 px ≈ 3.44 m；各層高度由像素換算，另有透視誤差，高度屬估計（非測繪），已列入 pendingChecks。
- 官方構成（文資局、臺鐵）：凸字形、左右對稱、二層、平頂；門廊 3 圓拱＋雨庇；二樓正面 7 扇圓拱長窗
  （2＋3＋2，中間 3 扇由 4 根壁柱框住），中央長窗上方嵌圓鐘；屋簷浮雕；平頂正面上方有小山形壁。
- 飾面：修復後暖灰色面磚、米黃與土黃色洗石子（鐵道局 2026-09-10 經聯合報轉述），以不同顏色的 drawGroup 區分，不貼圖。
- 2015／2017 照片中的白漆、LED 電子鐘、屋頂「臺南車站」單字招牌都是修復前狀態，不重建。
"""
import math
from geo import *

# ------------------------------------------------------------------ 尺寸（米）
XC, PITCH = -0.3, 3.44                    # 二樓立面中軸與長窗中心距（照片 01：窗距 50 px ≈ 3.44 m）
XL, XR = -13.0, 12.4                      # 主棟左右外緣（OSM：-12.6…-13.7 / 12.35…12.46）
YF = -10.33                               # 主棟正面外皮（OSM 前緣兩端平均）
YB = 4.05                                 # 主棟後緣＝後側橫翼正面（OSM：4.6／3.2 的平均）
XP0, XP1 = -12.3, 9.4                     # 門廊前牆左右端（照片 01：門廊牆 px 178–495）
XPC = (XP0 + XP1) / 2                     # 門廊中心（比二樓中軸偏左約 1.2 m，與 OSM 門廊偏左一致）
YP = -12.3                                # 門廊前牆外皮
BAY = 4.1                                 # 門廊開口中心距（圓窗、拱、拱、拱、圓窗）
ARCH_W, ARCH_SPRING = 3.0, 2.4            # 門廊圓拱寬與起拱高（拱頂 3.9 m）
RW_R, RW_Z = 0.68, 3.2                    # 門廊圓窗半徑與中心高
CAN_X0, CAN_X1 = -11.0, 7.0               # 雨庇左右端（照片 01：px 195–464）
CAN_OUT = 1.4                             # 雨庇出挑（估）

Z_PLINTH = 1.15                           # 勒腳頂
Z_PORCH = 4.75                            # 門廊牆頂／雨庇底
Z_CANOPY_TOP = 5.45                       # 門廊屋頂面（雨庇頂）
Z_SC0, Z_SC1 = 5.36, 5.68                 # 二樓腰線
Z_SILL = 5.72                             # 二樓長窗下緣
WIN_W = 1.35                              # 長窗淨寬
Z_CROWN = 9.72                            # 長窗拱頂
Z_ROOF, Z_CAP = 12.0, 12.5                # 屋面與女兒牆頂
PIER = 1.5 * PITCH                        # 外側壁柱距中軸
INNER = 0.5 * PITCH                       # 內側壁柱距中軸

WX = [XC + (i - 3) * PITCH for i in range(7)]      # 七扇長窗中心

# 後側橫翼與一層延伸（OSM 輪廓；二層範圍依照片 01 左右露出的長度估計）
WX0, WX1 = -16.1, 25.8                    # 二層橫翼 x 範圍
GX0 = -25.1                               # 一層延伸左端
WY1 = 25.05                               # 橫翼後緣
WH = 9.3                                  # 橫翼二層女兒牆頂（估：照片 01 左翼頂約 9.4 m）
GH = 4.4                                  # 一層延伸高（估：照片 01 左側低矮量體約 4.2 m）


class Wall:
    """一面牆：kind 為朝向（front/back/right/left），plane 為牆外皮位置；沿牆座標 w＝世界 x（front/back）或 y（left/right）。"""

    def __init__(self, kind, plane):
        self.kind = kind
        self.f = {'front': front, 'back': back, 'right': right, 'left': left}[kind](plane)
        self.s = 1 if kind in ('front', 'right') else -1

    def u(self, w): return self.s * w

    def span(self, a, b): return (min(self.s * a, self.s * b), max(self.s * a, self.s * b))


def molding(G, W, a, b, poly, mat, skip=''):
    """沿牆面擠出的線腳；poly 為 (外凸量 out, 高度 z) 多邊形，沿牆由 a 到 b（世界座標）。"""
    f = W.f
    u0, u1 = W.span(a, b)
    extrude_f(G, Frame(f.O, f.N, f.V, f.U), poly, u0, u1, mat, skip=skip)


def wbox(G, W, a, b, v0, v1, d0, d1, mat, skip=''):
    u0, u1 = W.span(a, b)
    box_f(G, W.f, u0, u1, v0, v1, d0, d1, mat, skip)


def seg_poly(a, b, wd):
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dy)
    nx, ny = -dy / L * wd / 2, dx / L * wd / 2
    return [(a[0] + nx, a[1] + ny), (b[0] + nx, b[1] + ny), (b[0] - nx, b[1] - ny), (a[0] - nx, a[1] - ny)]


# ------------------------------------------------------------------ 窗
def arch_hole(W, wc, vb, w, vs, depth, n=12):
    return hole_arch(W.u(wc), w, vb, vs, depth, n)


def rect_hole(W, wc, v0, v1, w, depth=0.25):
    return hole_rect(W.u(wc), w, v0, v1, depth)


def arch_window(G, W, wc, vb, w, vs, depth=0.30, n=12, surround=True):
    """圓拱長窗的配件：玻璃（遠近景）、窗框與窗櫺、拱框與拱心石（近景）。洞口由 arch_hole 交給 wall_f。"""
    f = W.f
    u, r = W.u(wc), w / 2
    poly = arch_outline(u, vb, r - 0.06, vs, n)
    with G.detail('both'):
        fill_poly_f(G, f, poly, -depth + 0.05, 'glass')
    with G.detail('near'):
        d0, d1 = -depth, -depth + 0.10
        band_f(G, f, arch_outline(u, vb, r, vs, n), arch_outline(u, vb, r - 0.07, vs, n), d0, d1, 'frame', skip='n')
        box_f(G, f, u - r + 0.07, u + r - 0.07, vb, vb + 0.07, d0, d1, 'frame', 'n')       # 窗台夾在兩側拱腳之間，不與拱框重疊
        # 窗櫺各件的前緣錯開 4–6 mm（前→後：中心輪轂、直櫺與放射櫺、弧櫺、橫櫺），交叉處不共面，Cycles 不出黑點、WebGL 不 z-fight
        bar, dd0, dd1 = 0.045, -depth + 0.03, -depth + 0.09
        ri = r - 0.07
        for k in (-1, 1):
            box_f(G, f, u + k * w / 6 - bar / 2, u + k * w / 6 + bar / 2, vb + 0.07, vs, dd0, dd1, 'frame', 'n')
        for k in range(0, 4):
            vv = vs - 0.02 - k * (vs - vb - 0.07) / 3.0
            box_f(G, f, u - ri, u + ri, vv - bar / 2, vv + bar / 2, dd0, dd1 - 0.006, 'frame', 'n')
        for a in (30, 60, 90, 120, 150):
            t = math.radians(a)
            extrude_f(G, f, seg_poly((u + 0.08 * math.cos(t), vs + 0.08 * math.sin(t)), (u + ri * math.cos(t), vs + ri * math.sin(t)), bar), dd0, dd1, 'frame', skip='n')
        disc_f(G, f, u, vs, 0.10, dd1 + 0.004, 'frame', n=12)
        arc_o, arc_i = arc_pts(u, vs, ri * 0.56 + 0.022, 0, math.pi, 10), arc_pts(u, vs, ri * 0.56 - 0.022, 0, math.pi, 10)
        band_f(G, f, arc_o, arc_i, dd0, dd1 - 0.004, 'frame', skip='n')
        if surround:
            band_f(G, f, arch_outline(u, vb, r + 0.22, vs, n + 2), arch_outline(u, vb, r, vs, n + 2), 0, 0.07, 'cream', skip='n')
            box_f(G, f, u - 0.17, u + 0.17, vs + r + 0.03, vs + r + 0.26, 0, 0.13, 'cream', 'n')


def rect_window(G, W, wc, v0, v1, w, depth=0.25, surround=True):
    f = W.f
    u = W.u(wc)
    x0, x1 = u - w / 2, u + w / 2
    with G.detail('both'):
        fill_poly_f(G, f, [(x0 + 0.06, v0 + 0.06), (x1 - 0.06, v0 + 0.06), (x1 - 0.06, v1 - 0.06), (x0 + 0.06, v1 - 0.06)], -depth + 0.05, 'glass')
    with G.detail('near'):
        d0, d1 = -depth, -depth + 0.10
        # 外框：左右直材通高、上下橫材夾在中間；各件互不重疊（不共面）
        box_f(G, f, x0, x0 + 0.06, v0, v1, d0, d1, 'frame', 'n')
        box_f(G, f, x1 - 0.06, x1, v0, v1, d0, d1, 'frame', 'n')
        box_f(G, f, x0 + 0.06, x1 - 0.06, v0, v0 + 0.06, d0, d1, 'frame', 'n')
        box_f(G, f, x0 + 0.06, x1 - 0.06, v1 - 0.06, v1, d0, d1, 'frame', 'n')
        box_f(G, f, u - 0.02, u + 0.02, v0 + 0.06, v1 - 0.06, d0 + 0.03, d1 - 0.01, 'frame', 'n')
        for k in (1, 2):                                        # 橫櫺前緣退 5 mm，與直櫺交叉處不共面
            vv = v0 + (v1 - v0) * k / 3
            box_f(G, f, x0 + 0.06, x1 - 0.06, vv - 0.02, vv + 0.02, d0 + 0.03, d1 - 0.015, 'frame', 'n')
        if surround:
            b = 0.13
            box_f(G, f, x0 - b, x0, v0, v1, 0, 0.06, 'cream', 'n')
            box_f(G, f, x1, x1 + b, v0, v1, 0, 0.06, 'cream', 'n')
            box_f(G, f, x0 - b, x1 + b, v1, v1 + b, 0, 0.06, 'cream', 'n')
            box_f(G, f, x0 - b - 0.03, x1 + b + 0.03, v0 - 0.10, v0, 0, 0.18, 'cream', 'n')   # 窗台出挑 0.18，比勒腳（0.14）多出 4 cm，不與勒腳共面


def distribute(a, b, pitch, margin=1.0):
    """在 [a,b] 內等距排窗，回傳中心座標（兩端至少留 margin）。"""
    n = max(1, int((b - a - 2 * margin) // pitch) + 1)
    span = (n - 1) * pitch
    c = (a + b) / 2
    return [c - span / 2 + k * pitch for k in range(n)]


# ------------------------------------------------------------------ 線腳剖面 (out, z)
def cornice_profile(z0=Z_ROOF - 0.02, s=1.0, back=0.30):
    """簷口：階梯狀出挑的檐板，z0 為下緣，s 為縮放（翼樓較小）；back 是往牆內的厚度（女兒牆內側面，供屋頂上方視角看見）。"""
    P = [(-back, 0.00), (0.00, 0.00), (0.16, 0.00), (0.16, 0.08), (0.36, 0.08), (0.36, 0.18), (0.46, 0.22), (0.46, 0.38), (0.34, 0.42), (0.34, 0.52), (-back, 0.52)]
    return [(o * s if o > 0 else o, z0 + z * s) for o, z in P]


def plinth_profile(h=Z_PLINTH):
    return [(-0.02, 0.0), (0.14, 0.0), (0.14, h - 0.10), (0.05, h), (-0.02, h)]


def course_profile(z0=Z_SC0, z1=Z_SC1):
    return [(-0.02, z0), (0.14, z0), (0.14, z0 + 0.14), (0.10, z0 + 0.20), (0.10, z1), (-0.02, z1)]


def mold(G, W, a, b, profile, mat, kind='plinth', s=1.0, ends=(True, True)):
    """沿牆 a→b（世界座標）的線腳，並處理轉角：ends 的每一端為 True 時外擴（包住轉角）、False 時內縮（與鄰牆已外擴的線腳端面對接）、None 時齊平（同一面牆上兩段線腳對接）。
    這樣兩道線腳在凸角只有一塊實體，不會有重疊的共面同向面（Cycles 會在重疊處出黑斑，網頁上也徒增 z-fighting 風險）。
    kind：plinth／course 出挑 0.14、內嵌 0.02；cornice 出挑 0.46·s、內嵌 0.30。"""
    out, back = (0.46 * s, 0.30) if kind == 'cornice' else (0.14, 0.02)
    lo, hi = (a, b) if a < b else (b, a)
    if ends[0] is not None:
        lo = lo - out if ends[0] else lo + back
    if ends[1] is not None:
        hi = hi + out if ends[1] else hi - back
    if hi - lo > 1e-6:
        molding(G, W, lo, hi, profile, mat)


def ellipse_pts(cu, cv, ru, rv, n, a0=0.0):
    return [(cu + ru * math.cos(a0 + 2 * math.pi * i / n), cv + rv * math.sin(a0 + 2 * math.pi * i / n)) for i in range(n)]


def wave_pts(u0, u1, v0, amp, cycles, n, taper=0.0):
    """沿 u 方向的正弦帶中心線（花帶）。"""
    pts = []
    for i in range(n + 1):
        t = i / n
        pts.append((u0 + (u1 - u0) * t, v0 + amp * (1 - taper * t) * math.sin(2 * math.pi * cycles * t)))
    return pts


def offset_line(pts, dv):
    """把折線沿 v 平移 dv（帶狀物的上下緣）。"""
    return [(u, v + dv) for u, v in pts]


def door(G, W, wc, w, h, depth=0.30, frame_mat='cream'):
    """門洞的配件（洞口由 rect_hole(W, wc, 0, h, w, depth) 交給 wall_f）：深色門扇與門套。"""
    f = W.f
    u = W.u(wc)
    x0, x1 = u - w / 2, u + w / 2
    with G.detail('both'):
        fill_poly_f(G, f, [(x0, 0.0), (x1, 0.0), (x1, h), (x0, h)], -depth + 0.03, 'dark')
    with G.detail('near'):
        b = 0.14
        box_f(G, f, x0 - b, x0, 0.0, h, 0, 0.07, frame_mat, 'n')
        box_f(G, f, x1, x1 + b, 0.0, h, 0, 0.07, frame_mat, 'n')
        box_f(G, f, x0 - b, x1 + b, h, h + b, 0, 0.07, frame_mat, 'n')
        for k in range(1, 3):
            xx = x0 + (x1 - x0) * k / 3
            box_f(G, f, xx - 0.025, xx + 0.025, 0.05, h - 0.05, -depth + 0.03, -depth + 0.09, 'frame', 'n')
        box_f(G, f, x0 + 0.05, x1 - 0.05, h * 0.62 - 0.025, h * 0.62 + 0.025, -depth + 0.03, -depth + 0.085, 'frame', 'n')
