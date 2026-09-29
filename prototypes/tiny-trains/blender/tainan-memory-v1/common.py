"""臺南舊站房共用尺寸與小工具（各部位模組共用）。座標與 station-footprint.json 同框：X 右、Y 向後（月台側）、Z 向上；正面朝 -Y。

尺寸依據
- 平面：OSM relation 6477070 輪廓（station-footprint.json 的 local）。
- 立面比例：2015-12-28 正立面照片（refs/01，近似正投影）。以主棟寬 25.4 m（OSM）換算約 14.6 px/m；
  七扇長窗中心距 50 px ≈ 3.44 m；各層高度由像素換算，另有透視誤差，高度屬估計（非測繪），已列入 pendingChecks。
- 官方構成（文資局、臺鐵）：凸字形、左右對稱、二層、平頂；門廊 3 圓拱＋雨庇；二樓正面 7 扇圓拱長窗
  （2＋3＋2，中間 3 扇由 4 根壁柱框住），中央長窗上方嵌圓鐘；屋簷浮雕；平頂正面上方有小山形壁。
- 飾面：修復後暖灰色面磚、米黃與土黃色洗石子（聯合報 2026-09-10 新站揭牌報導的記者敘述，udn 9747352；不是修復工程或鐵道局公布的數據），以不同顏色的 drawGroup 區分，不貼圖。
- 2015／2017 照片中的白漆、LED 電子鐘、屋頂「臺南車站」單字招牌都是修復前狀態，不重建。
"""
import math
from geo import *

# ------------------------------------------------------------------ 尺寸（米）
# 量體（第二輪修訂，2026-09-29）：凸字形——一層前廳（含門廊）往前凸出，二樓正面與兩側牆片退在後面；
# 前廳頂是平台（一層屋頂，5.40 m，周圍女兒牆頂 5.80 m），前廳兩側外牆各有一個行人入口大圓拱與長雨庇。
# 依據（都是把照片上量到的像素反投影回模型座標；驗收程式 acc.py／acc3.py 與疊圖 overlay02／03／01_front.png 在派工暫存區 $SP/a2，未進版控）：
# - 照片 02（左前斜角）：先只用二樓 7 扇長窗定相機（f 900–2600 窗殘差都 ≤0.7 px，所以焦距 f 由窗看不出來），
#   再預測門廊／雨庇／側拱 13 個特徵：PP=9 m 時 f 落在 1120–1280 全部特徵 ≤20 px（f=1200 最大 7.7 px）；
#   PP=6 m 不論 f 取多少最佳也有 48 px（f=1600，13 個特徵 28–48 px）。
#   PP 與門廊中軸 XPC 在這張照片上互相抵銷：XPC 往左 1.15 m（-1.45）要靠 PP 加到約 10.1 m 才補回（最大 22 px，出在雨庇端點）。
#   照片 01 的視差（門廊軸 334.5 px、二樓軸 350.2 px，相機偏右約 3.5 m）剛好解釋成兩軸重合（XPC 與 XC 差 ≤0.4 m），所以取 XPC＝XC。
# - 照片 01（正立面）：門廊 3 拱心距 61.5 px 對 3.28 m ＝ 18.7 px/m，二樓長窗中心距 50.1 px 對 3.44 m ＝ 14.55 px/m，兩者比 1.285
#   ⇒ 門廊比二樓近 0.285 倍相機距離；PP=9 m 時相機距二樓約 40.6 m（f≈590 px，約 26 mm 等效焦距，移軸鏡頭常見）。
#   疊圖：7 扇窗、3 個拱心、2 個圓窗的中心 x 誤差 ≤2.3 px（圓窗中心高度 RW_Z：照片 01 量到約 2.70 m、照片 02／03 的圓窗預測在 2.60–2.65 最小；原 2.45 m 三張照片都偏低約 0.2 m，改 2.60 m 後照片 01 差 ≤2.1 px、照片 02 前面兩個圓窗 2.7／5.8 px、照片 03 兩個圓窗 3.4／1.7 px）。
# - 照片 03（右前）：雨庇下的側入口大圓拱與長雨庇落在前廳右側外牆（x=XP1）上；外罩外廓只能定出外罩前面平面在門廊前牆外約 4.4–4.7 m（見 wrap.py）。
# PP=6 m（第二輪派工前的假設）與照片 02 的證據不合；這是推定，不是測繪（已列入 pendingChecks）；若之後找到文資局平面圖，只需改 PP 一個數字。
PP = 9.0                                  # 門廊前牆外皮到二樓正面外皮的距離
XC, PITCH = -0.3, 3.44                    # 二樓立面中軸與長窗中心距（照片 01：窗距 50 px ≈ 3.44 m；二樓平面的比例尺）
XL, XR = -13.0, 12.4                      # 主棟左右外緣（OSM：-12.6…-13.7 / 12.35…12.46）
YP = -12.3                                # 門廊前牆外皮（OSM 門廊前緣 -12.56／-12.75）
YF = YP + 1.97                            # 前廳前牆外皮（＝門廊背牆，門廊深 1.97 m）
Y2 = YP + PP                              # 二樓正面外皮（兩側牆片與二樓正面同一面牆）
YB = 4.05                                 # 主棟後緣＝後側橫翼正面（OSM：4.6／3.2 的平均）
BAY = 3.28                                # 門廊開口中心距（圓窗、拱、拱、拱、圓窗）：5 開間＝16.4 m＝OSM 門廊寬
XPC = XC                                  # 門廊中軸＝二樓中軸（左右對稱；OSM 門廊偏左 1.2 m 屬航照描邊誤差，見上）
XP0, XP1 = XPC - 2.5 * BAY, XPC + 2.5 * BAY   # 門廊前牆與前廳兩側外牆的位置（-8.5／7.9）
ARCH_W, ARCH_SPRING = 2.5, 1.95           # 圓拱寬與起拱高（拱頂 3.2 m；照片 01 門廊放大倍率約 1.33 換算後）
RW_R, RW_Z = 0.50, 2.60                   # 門廊圓窗半徑與中心高（外徑含環 1.32 m）；2.60：照片 01 量到 2.70、照片 02／03 的圓窗預測在 2.60–2.65 最小（原 2.45 三張照片都偏低 0.2 m）；環頂 3.26 m 要低於門廊頂帶下緣 3.29 m，否則環的正面與頂帶正面共面
CAN_X0, CAN_X1 = -6.65, 6.0              # 主雨庇左右端（右端：照片 02＋03 雙視角交會 X=6.0、照片 01 5.9；左端：照片 01 -6.7，照片 02 的「雨庇左端」其實是端面接牆處）
CAN_OUT = 2.95                            # 主雨庇出挑（右前角照片 02＋03 雙視角交會 Y=-15.3，射線間隙 0.13 m；照片 03 右端面長 3.2 m）

Z_PLINTH = 1.15                           # 勒腳頂
Z_PORCH = 3.66                            # 門廊牆頂／雨庇底（與兩側雨庇同高；照片 02 單看 3.72–3.75，02＋03 聯合 3.5，取中間）
Z_CANOPY_TOP = 4.06                       # 門廊屋頂面（雨庇頂；照片 02 單看 4.1–4.15，02＋03 聯合 3.9；厚 0.40 m）
Z_PROOF = 4.55                            # 門廊屋頂簷口頂（門廊四角的女兒牆頂；照片 02 左角反投影 4.47–4.56、照片 03 右角 4.57–4.70、照片 01 山形壁底 4.6）
Z_TER = 5.40                              # 一樓屋頂平台面（二樓正面前方；外罩下緣與鷹架都坐在這一面）
Z_SC0, Z_SC1 = 5.36, 5.68                 # 二樓腰線
Z_SILL = 5.72                             # 二樓長窗下緣
WIN_W = 1.35                              # 長窗淨寬
Z_CROWN = 10.32                           # 長窗拱頂（照片 01 疊圖比第一版 9.72 高約 0.6 m）
Z_ROOF, Z_CAP = 12.0, 12.5                # 屋面與女兒牆頂
PAR_S = 0.8                               # 平台女兒牆（一樓簷口）的線腳縮放：頂＝Z_TER-0.02+0.52*0.8＝5.80
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


def arch_window(G, W, wc, vb, w, vs, depth=0.30, n=12, surround=True, keystone=True):
    """圓拱長窗的配件：玻璃（遠近景）、窗框與窗櫺、拱框與拱心石（近景）。洞口由 arch_hole 交給 wall_f。"""
    f = W.f
    u, r = W.u(wc), w / 2
    poly = arch_outline(u, vb, r, vs, n)                 # 玻璃填滿整個洞口（與洞口同一條多邊形）：遠景沒有窗框，玻璃與洞內壁之間不留縫，斜看才不會從縫隙看到背景
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
            if keystone:
                box_f(G, f, u - 0.17, u + 0.17, vs + r + 0.03, vs + r + 0.26, 0, 0.13, 'cream', 'n')


def rect_window(G, W, wc, v0, v1, w, depth=0.25, surround=True):
    f = W.f
    u = W.u(wc)
    x0, x1 = u - w / 2, u + w / 2
    with G.detail('both'):
        fill_poly_f(G, f, [(x0, v0), (x1, v0), (x1, v1), (x0, v1)], -depth + 0.05, 'glass')      # 玻璃填滿整個洞口，見 arch_window
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
