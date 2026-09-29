"""2026-09-12 當天的施工外罩：主棟與橫翼二樓以上包覆的半透明鷹架外罩（獨立網格 wrap.mesh.bin，頁面可切換）。

依據
- 聯合報 2026-06-02 圖說「台南車站主體上半部還是鐵皮圍籬包覆」；2026-06-02 至 09-12 未查到拆除報導。
- 外觀依 2026-01-18 照片 03 與 2025-05 照片 05 目測：乳白半透明布面、布面下緣在正面與側面同一條水平線、
  轉角是圓弧、深色直向骨架約每 5–7 m 一根、橫向與直向分格接縫、下緣以下露出鷹架、南側白色施工圍籬。
  掛設範圍、離牆距離、高度、骨架間距、圍籬位置皆為外觀估計，不是施工圖，已列入 pendingChecks。
- 第二輪（2026-09-29）修正驗收員指出的問題：布面下緣統一（第一版正面 5.45／側面 8.0，轉角錯開 2.55 m）、
  鷹架每根立管都落在地面或屋面上（第一版半截懸空）、布面不透明度 0.64→0.82（照片幾乎看不到後面的建築）、
  拿掉沒有照片依據的頂蓋、接縫改不透明細線（第一版半透明接縫排在布面前面畫，會把後面的布面擋掉）、
  圍籬拿掉埋在橫翼裡的後 9 m 並補頂蓋。
- 布面單面（法線朝外）：從外側看，遠側面因背面剔除不會疊出雜訊；不透明度由 model.json 的 wrap drawGroups 給出。

下緣高度：前廳平台的女兒牆頂是 5.80 m，布面正面平面（y=YP+WRAP_D）橫跨平台左右女兒牆的位置，
所以布面下緣與底桿必須高於 5.80——取 5.95 m（底桿中心 5.90，離女兒牆頂 5.9 cm）。
凸字形之後（第二輪修訂）：外罩正面站在前廳平台上、離二樓正面 PP−WRAP_D 公尺；兩側牆片前面沒有屋頂，
鷹架立管直接落地（布面下緣同樣是 Z_WB）。
"""
import math
from common import *
from side import SIDE_PROJ
from wings import Z_G_ROOF

Z_WB = 5.95                               # 布面下緣（正面、側面、橫翼一律同一條水平線）
Z_WT = 12.6                               # 主棟布面頂（貼齊女兒牆頂 12.5＋0.1；照片 03 頂邊線在假設外罩平面下反推 11.7–12.3±0.5，見 pendingChecks）
Z_WWT = WH + 0.9                          # 橫翼布面頂
Z_LED = Z_WB - 0.05                       # 底桿（承托布面下緣的縱向鋼管）中心高
Z_STD_TOP = Z_WB + 0.25                   # 立管頂
RC = 1.5                                  # 平面轉角圓弧半徑
NARC = 6                                  # 每個 90° 圓弧的分段數
WRAP_D = 4.7                              # 外罩正面離門廊前牆的距離（照片 03 外廓＋門廊特徵聯合擬合，試過 4.4／4.7／5.0 m，離牆 1.1 m、頂 12.3–12.6 時外廓 rms 都是 3.2–4.7 px，定不出更細；PP=9 時離二樓正面 4.3 m）
WRAP_SX = 1.1                             # 外罩離二樓兩端牆的距離（照片 03 聯合擬合 0.6–1.1 m 都相容，外廓 rms 隨離牆變寬略降；取一般鷹架離牆寬度 1.1 m）
MX0, MX1 = XL - WRAP_SX, XR + WRAP_SX     # 主棟外罩 x
MY0, MY1 = YP + WRAP_D, YB + 1.1          # 主棟外罩 y：正面站在前廳平台上（離二樓正面 PP−WRAP_D）
QX0, QX1 = WX0 - 1.0, WX1 + 1.0           # 橫翼外罩
QY0, QY1 = YB - 1.1, WY1 + 1.1
TUBE_R = 0.045
TUBE_IN = 0.07                            # 鋼管中心退到布面內側的距離（管外緣離布面 2.5 mm）
FENCE_X = XR + 2.4                        # 南側圍籬離主棟右牆的距離
FENCE_H = 2.4

STANDARDS = []                            # 立管清單 (x, y, z_bottom, z_top, 落腳面名稱)，供獨立稽核比對
LOG = []

# 鷹架可以站的面：(x0, x1, y0, y1, z, 名稱)。範圍已縮進女兒牆與線腳之內。
SUPPORTS = [
    (XP0 + 0.30, XP1 - 0.30, YF + 0.30, Y2, Z_TER, '前廳平台'),
    (XP1, XP1 + SIDE_PROJ + 0.04, YF, Y2, Z_CANOPY_TOP, '右側雨庇頂'),
    (XP0 - SIDE_PROJ - 0.04, XP0, YF, Y2, Z_CANOPY_TOP, '左側雨庇頂'),
    (WX0 - 0.15, XL, YB - 1.5, YB, 4.44, '左翼入口雨庇頂'),
    (GX0 + 0.30, WX0, YB + 0.30, WY1 - 0.30, Z_G_ROOF, '一層延伸屋面'),
]
# 不能穿過的量體（含線腳外緣）：(x0, x1, y0, y1, z0, z1)。z1 等於落腳面高度者，立管從其頂面上方起算。
BLOCKS = [
    (XP0 - 0.16, XP1 + 0.16, YF - 0.16, Y2, 0.0, Z_TER),                       # 前廳（含平台）
    (XL - 0.16, XR + 0.16, Y2 - 0.16, YB, 0.0, Z_TER),                         # 主棟一樓（含兩側牆片）
    (XP0 - 0.38, XP1 + 0.38, YF - 0.38, YF + 0.30, Z_TER - 0.02, 5.80),        # 平台前女兒牆
    (XP1 - 0.30, XP1 + 0.38, YF - 0.38, Y2, Z_TER - 0.02, 5.80),               # 平台右女兒牆
    (XP0 - 0.38, XP0 + 0.30, YF - 0.38, Y2, Z_TER - 0.02, 5.80),               # 平台左女兒牆
    (XL - 0.46, XR + 0.46, Y2 - 0.46, YB, Z_TER, 12.6),                        # 主棟二樓（含簷口出挑）
    (XP1, XP1 + SIDE_PROJ + 0.12, YF, Y2, 3.68, Z_CANOPY_TOP),                 # 右側雨庇
    (XP0 - SIDE_PROJ - 0.12, XP0, YF, Y2, 3.68, Z_CANOPY_TOP),                 # 左側雨庇
    (XP0 - 0.30, XP1 + 0.30, YP - CAN_OUT - 0.30, YF, 0.0, 7.0),               # 門廊（含雨庇與山形壁）
    (WX0 - 0.20, XL, YB - 1.60, YB, 3.60, 4.44),                               # 左翼入口雨庇
    (WX0 - 0.40, WX1 + 0.40, YB - 0.40, WY1 + 0.40, 0.0, WH),                  # 二層橫翼
    (GX0 - 0.40, WX0, YB, WY1, 0.0, 4.04),                                     # 一層延伸（屋面以下）
    (GX0 - 0.40, WX0, YB - 0.40, YB + 0.30, 0.0, 4.42),                        # 一層延伸前簷口帶
    (GX0 - 0.40, WX0, WY1 - 0.30, WY1 + 0.40, 0.0, 4.42),                      # 一層延伸後簷口帶
    (GX0 - 0.40, GX0 + 0.30, YB - 0.40, WY1 + 0.40, 0.0, 4.42),                # 一層延伸左端簷口帶
]


# ---------------------------------------------------------------- 平面路徑
class Path:
    """平面折線：頂點 (x, y, nx, ny)，法線朝外。runs 記每一段的種類（flat／arc）、頂點索引範圍與是否為「下段」（布面從 Z_WB 起）。"""

    def __init__(self):
        self.v = []
        self.runs = []

    def _add(self, x, y, nx, ny):
        if self.v and abs(self.v[-1][0] - x) < 1e-9 and abs(self.v[-1][1] - y) < 1e-9:
            return
        self.v.append((x, y, nx, ny))

    def flat(self, x0, y0, x1, y1, nx, ny, low=True):
        self._add(x0, y0, nx, ny)
        i0 = len(self.v) - 1
        self._add(x1, y1, nx, ny)
        self.runs.append(('flat', i0, len(self.v) - 1, low))

    def arc(self, cx, cy, r, a0, a1, low=True, n=NARC):
        i0 = None
        for i in range(n + 1):
            t = math.radians(a0 + (a1 - a0) * i / n)
            c, s = math.cos(t), math.sin(t)
            self._add(cx + r * c, cy + r * s, c, s)
            if i == 0:
                i0 = len(self.v) - 1
        self.runs.append(('arc', i0, len(self.v) - 1, low))

    def seg_low(self):
        out = [True] * (len(self.v) - 1)
        for kind, i0, i1, low in self.runs:
            for i in range(i0, i1):
                out[i] = low
        return out


def main_path():
    """主棟外罩（逆時針）：正面、右前圓角、右側、右後圓角、背面、左後圓角、左側、左前圓角。
    右／左側在翼樓外罩相接處（y=QY0）以南為「下段」（布面從 Z_WB 起、下面有鷹架），以北只有翼樓頂以上（Z_WWT 起）。"""
    P = Path()
    P.flat(MX0 + RC, MY0, MX1 - RC, MY0, 0, -1)
    P.arc(MX1 - RC, MY0 + RC, RC, -90, 0)
    P.flat(MX1, MY0 + RC, MX1, QY0, 1, 0)
    P.flat(MX1, QY0, MX1, MY1 - RC, 1, 0, low=False)
    P.arc(MX1 - RC, MY1 - RC, RC, 0, 90, low=False)
    P.flat(MX1 - RC, MY1, MX0 + RC, MY1, 0, 1, low=False)
    P.arc(MX0 + RC, MY1 - RC, RC, 90, 180, low=False)
    P.flat(MX0, MY1 - RC, MX0, QY0, -1, 0, low=False)
    ys = [QY0, 2.15, MY0 + RC]                                      # 左翼入口雨庇（y≥2.55）前後分段
    for a, b in zip(ys, ys[1:]):
        P.flat(MX0, a, MX0, b, -1, 0)
    P.arc(MX0 + RC, MY0 + RC, RC, 180, 270)
    return P


def wing_path():
    """橫翼外罩（順時針，開放）：由左翼正面與主棟左側相接處出發，繞左端、背面、右端，回到右翼正面與主棟右側相接處。"""
    P = Path()
    P.flat(MX0, QY0, QX0 + RC, QY0, 0, -1)
    P.arc(QX0 + RC, QY0 + RC, RC, 270, 180)
    P.flat(QX0, QY0 + RC, QX0, QY1 - RC, -1, 0)
    P.arc(QX0 + RC, QY1 - RC, RC, 180, 90)
    P.flat(QX0 + RC, QY1, QX1 - RC, QY1, 0, 1)
    P.arc(QX1 - RC, QY1 - RC, RC, 90, 0)
    P.flat(QX1, QY1 - RC, QX1, QY0 + RC, 1, 0)
    P.arc(QX1 - RC, QY0 + RC, RC, 0, -90)
    P.flat(QX1 - RC, QY0, MX1, QY0, 0, -1)
    return P


# ---------------------------------------------------------------- 布面、接縫、骨架
def sheet(G, P, z0, z1, mat, off=0.0, pick=None):
    """沿路徑 P 由 z0 擠到 z1 的單面帶（法線朝外、頂點法線平滑）；off 為沿法線外推量。"""
    v = P.v
    for i in range(len(v) - 1):
        if pick and not pick(i):
            continue
        a, b = v[i], v[i + 1]
        pa, pb = (a[0] + a[2] * off, a[1] + a[3] * off), (b[0] + b[2] * off, b[1] + b[3] * off)
        na, nb = (a[2], a[3], 0.0), (b[2], b[3], 0.0)
        G.quad((pa[0], pa[1], z0), (pb[0], pb[1], z0), (pb[0], pb[1], z1), (pa[0], pa[1], z1), mat, None, na, nb, nb, na)


def frame_at(x, y, nx, ny):
    return Frame((x, y, 0.0), (-ny, nx, 0.0), (0.0, 0.0, 1.0), (nx, ny, 0.0))


def rib(G, x, y, nx, ny, z0, z1, w=0.09, off=0.03):
    """深色直向骨架：貼在布面外 3 cm 的單面窄帶（不做厚度——第一版的實心條從頂端開口看得到遠側骨架像一根根細線豎在屋頂上）。"""
    f = frame_at(x, y, nx, ny)
    G.quad(f.p(-w / 2, z0, off), f.p(w / 2, z0, off), f.p(w / 2, z1, off), f.p(-w / 2, z1, off), 'wrap_rib', f.n(0, 0, 1))


def vjoint(G, x, y, nx, ny, z0, z1, w=0.035, off=0.012):
    f = frame_at(x, y, nx, ny)
    G.quad(f.p(-w / 2, z0, off), f.p(w / 2, z0, off), f.p(w / 2, z1, off), f.p(-w / 2, z1, off), 'wrap_seam', f.n(0, 0, 1))


def run_points(P, kind, i0, i1, pitch):
    """一個 flat 段等分成 ≤pitch 的幾份，回傳等分點 (x, y, nx, ny)。"""
    a, b = P.v[i0], P.v[i1]
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    n = max(1, math.ceil(L / pitch - 1e-9))
    return [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, a[2], a[3]) for k in range(n + 1)], L


def sections(P):
    """把相接、同法線、同上下段的 flat 段併成一節（骨架與直向接縫按整節等分，不被鷹架的分段切碎）。"""
    out = []
    for kind, i0, i1, low in P.runs:
        if kind == 'flat' and out and out[-1][0] == 'flat' and out[-1][2] == i0 and out[-1][3] == low and P.v[out[-1][1]][2:] == P.v[i0][2:]:
            out[-1] = ('flat', out[-1][1], i1, low)
        else:
            out.append((kind, i0, i1, low))
    return out


def dressing(G, P, tag, ribs):
    """布面上的細節：骨架（約每 6 m 一根）、直向接縫（約 3 m 一條）、橫向接縫。tag 'main' 或 'wing'；ribs 是已放骨架的位置（兩個路徑共用，相接處不疊放）。"""
    low = P.seg_low()
    for kind, i0, i1, is_low in sections(P):
        if kind != 'flat':
            continue
        z0 = Z_WB if is_low else Z_WWT
        z1 = Z_WT if tag == 'main' else Z_WWT
        pts, L = run_points(P, kind, i0, i1, 7.0)
        if L < 3.0:
            continue
        for (x, y, nx, ny) in pts:
            if all(math.hypot(x - px, y - py) > 0.4 for px, py in ribs):
                rib(G, x, y, nx, ny, z0, z1)
                ribs.append((x, y))
        pts, _ = run_points(P, kind, i0, i1, 3.0)
        for (x, y, nx, ny) in pts[1:-1]:
            if all(math.hypot(x - px, y - py) > 0.4 for px, py in ribs):
                vjoint(G, x, y, nx, ny, z0 + 0.06, z1 - 0.06)
    # 橫向接縫（不透明細線，離布面 1.5 cm）：下緣、面板分格、上緣
    h = 0.08
    off = 0.015
    if tag == 'main':
        sheet(G, P, Z_WB, Z_WB + h, 'wrap_seam', off, lambda i: low[i])
        for z in (7.37, 8.78, Z_WWT):
            sheet(G, P, z - h / 2, z + h / 2, 'wrap_seam', off, lambda i: low[i])
        sheet(G, P, Z_WWT, Z_WWT + h, 'wrap_seam', off, lambda i: not low[i])
        for k in (1, 2):
            z = Z_WWT + (Z_WT - Z_WWT) * k / 3
            sheet(G, P, z - h / 2, z + h / 2, 'wrap_seam', off)
        sheet(G, P, Z_WT - h, Z_WT, 'wrap_seam', off)
    else:
        sheet(G, P, Z_WB, Z_WB + h, 'wrap_seam', off)
        for z in (7.37, 8.78):
            sheet(G, P, z - h / 2, z + h / 2, 'wrap_seam', off)
        sheet(G, P, Z_WWT - h, Z_WWT, 'wrap_seam', off)


# ---------------------------------------------------------------- 鷹架
def _inside(x, y, z, b, inflate):
    x0, x1, y0, y1, z0, z1 = b
    return x0 - inflate <= x <= x1 + inflate and y0 - inflate <= y <= y1 + inflate and z0 <= z <= z1


def hit(x, y, z):
    return any(_inside(x, y, z, b, TUBE_R + 0.03) for b in BLOCKS)


def support(x, y, m=0.05):
    """(x, y) 處立管的落腳面：回傳 (z, 名稱)；點落在量體邊緣的模糊地帶（±0.15 m）就回 None。"""
    for x0, x1, y0, y1, z, name in SUPPORTS:
        if x0 + m <= x <= x1 - m and y0 + m <= y <= y1 - m:
            return z, name
    for x0, x1, y0, y1, z0, z1 in BLOCKS:
        if x0 - 0.15 <= x <= x1 + 0.15 and y0 - 0.15 <= y <= y1 + 0.15:
            return None
    return 0.0, '地面'


def column_clear(x, y, z0, z1):
    z = z0 + 0.02
    while z < z1:
        if hit(x, y, z):
            return False
        z += 0.2
    return not hit(x, y, z1)


def rod_clear(a, b):
    L = math.dist(a, b)
    n = max(2, int(L / 0.2))
    return not any(hit(*(a[i] + (b[i] - a[i]) * k / n for i in range(3))) for k in range(n + 1))


def tube(G, a, b):
    if rod_clear(a, b):
        rod(G, a, b, TUBE_R, 'scaffold', n=6, caps=False)
        return True
    LOG.append(('rod-skipped', tuple(round(t, 2) for t in a), tuple(round(t, 2) for t in b)))
    return False


def standard(G, x, y, placed, along=None):
    """一根立管：由落腳面站到 Z_STD_TOP。離既有立管 0.15 m 以內就沿用它（回傳它的落腳高度）；
    落腳面模糊、或立管會穿過量體時，沿路徑方向（along）在 0.8 m 內就近挪到站得穩的位置；都挪不到才不放
    （回傳 None，並把原位置記進 LOG）。"""
    cand = [(x, y)]
    if along:
        cand += [(x + sg * d * along[0], y + sg * d * along[1]) for d in (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8) for sg in (1, -1)]
    why = None
    for cx, cy in cand:
        for px, py, pz in placed:
            if math.hypot(cx - px, cy - py) < 0.15:
                return pz
        s = support(cx, cy)
        if s is None:
            why = why or ('std-ambiguous', round(x, 2), round(y, 2))
            continue
        z, name = s
        if not column_clear(cx, cy, z, Z_STD_TOP):
            why = why or ('std-blocked', round(x, 2), round(y, 2), name)
            continue
        rod(G, (cx, cy, z), (cx, cy, Z_STD_TOP), TUBE_R, 'scaffold', n=6, caps=False)
        disc_f(G, world(), cx, cy, TUBE_R, Z_STD_TOP, 'scaffold', n=6, facing=1)
        STANDARDS.append((cx, cy, z, Z_STD_TOP, name))
        placed.append((cx, cy, z))
        return z
    LOG.append(why)
    return None


def levels(s):
    """縱向橫桿高度：頂桿在布面下緣下 5 cm；其下每 ≈1.9 m 一道，最低一道離落腳面 0.3 m。"""
    h = Z_LED - (s + 0.30)
    if h < 0.9:
        return [Z_LED]
    n = max(1, round(h / 1.9))
    return [s + 0.30 + h * k / n for k in range(n + 1)]


def scaffold(G, P):
    """沿路徑的「下段」放鷹架：直段每 ≤2.1 m 一根立管、圓角取兩端切點與中點；頂桿貫穿整段，
    下方橫桿與交叉斜撐只在落腳面一致的直段上做。"""
    placed = [(sx, sy, sz) for sx, sy, sz, _, _ in STANDARDS]
    for kind, i0, i1, low in P.runs:
        if not low:
            continue
        pts = [(x - nx * TUBE_IN, y - ny * TUBE_IN) for (x, y, nx, ny) in P.v[i0:i1 + 1]]
        if kind == 'flat':
            (xa, ya), (xb, yb) = pts[0], pts[-1]
            n = max(1, math.ceil(math.hypot(xb - xa, yb - ya) / 2.1 - 1e-9))
            stn = [(xa + (xb - xa) * k / n, ya + (yb - ya) * k / n) for k in range(n + 1)]
            chain = [stn[0], stn[-1]]
        else:
            stn = [pts[0], pts[len(pts) // 2], pts[-1]]
            chain = pts
        if kind == 'flat':
            L = math.hypot(stn[-1][0] - stn[0][0], stn[-1][1] - stn[0][1])
            al = ((stn[-1][0] - stn[0][0]) / L, (stn[-1][1] - stn[0][1]) / L)
        else:
            al = None
        zs = [standard(G, x, y, placed, al if 0 < k < len(stn) - 1 else None) for k, (x, y) in enumerate(stn)]
        for (xa, ya), (xb, yb) in zip(chain, chain[1:]):
            tube(G, (xa, ya, Z_LED), (xb, yb, Z_LED))
        ok = [z for z in zs if z is not None]
        if kind == 'flat' and len(ok) == len(zs) and len(set(ok)) == 1:
            lv = levels(ok[0])
            for z in lv[:-1]:
                tube(G, (stn[0][0], stn[0][1], z), (stn[-1][0], stn[-1][1], z))
            if len(lv) >= 2:
                for k in range(len(stn) - 1):
                    a, b = stn[k], stn[k + 1]
                    if k % 2:
                        a, b = b, a
                    tube(G, (a[0], a[1], lv[0]), (b[0], b[1], lv[-1]))


# ---------------------------------------------------------------- 白色施工圍籬
def fence_run(G, p0, p1, panel=2.4, h=FENCE_H, first_post=True):
    """由 p0 到 p1 的一段：每片是封閉的薄盒（厚 6 cm、含頂蓋，不會從上方透空），片與片之間一根立柱，頂上一支壓條。"""
    (x0, y0), (x1, y1) = p0, p1
    L = math.hypot(x1 - x0, y1 - y0)
    ux, uy = (x1 - x0) / L, (y1 - y0) / L
    f = Frame((x0, y0, 0.0), (ux, uy, 0.0), (0.0, 0.0, 1.0), (uy, -ux, 0.0))
    n = max(1, round(L / panel))
    for i in range(n):
        a, b = L * i / n, L * (i + 1) / n
        box_f(G, f, a + 0.05, b - 0.05, 0.0, h, -0.03, 0.03, 'fence', 'v')
    for i in range(0 if first_post else 1, n + 1):
        u = L * i / n
        x, y = x0 + ux * u, y0 + uy * u
        rod(G, (x, y, 0.0), (x, y, h + 0.12), 0.05, 'scaffold', n=6, caps=False)
        disc_f(G, world(), x, y, 0.05, h + 0.12, 'scaffold', n=6, facing=1)
    rod(G, (x0, y0, h + 0.03), (x1, y1, h + 0.03), 0.03, 'scaffold', n=6, caps=True)


def build():
    STANDARDS.clear()
    LOG.clear()
    G = Geo()
    with G.part('外罩'):
        M, Wp = main_path(), wing_path()
        # ---- 布面：主棟下段（Z_WB 到 Z_WWT）＋整圈上段（Z_WWT 到 Z_WT）；橫翼（Z_WB 到 Z_WWT）
        low = M.seg_low()
        sheet(G, M, Z_WB, Z_WWT, 'wrap_fabric', 0.0, lambda i: low[i])
        sheet(G, M, Z_WWT, Z_WT, 'wrap_fabric')
        sheet(G, Wp, Z_WB, Z_WWT, 'wrap_fabric')
        ribs = []
        dressing(G, M, 'main', ribs)
        dressing(G, Wp, 'wing', ribs)
        # ---- 鷹架（布面下緣以下與落腳面之間）
        scaffold(G, M)
        scaffold(G, Wp)
        # ---- 南側（+X）地面層白色施工圍籬（照片 03：沿 x 向的白色浪板，在右側入口拱之右）：正面短段與側邊長段，L 形；止於翼樓外罩前 0.6 m
        yf = MY0 - 1.5
        fence_run(G, (XP1 + SIDE_PROJ + 0.2, yf), (FENCE_X, yf))
        fence_run(G, (FENCE_X, yf), (FENCE_X, QY0 - 0.6), first_post=False)
    return G
