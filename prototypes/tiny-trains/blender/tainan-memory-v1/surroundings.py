#!/usr/bin/env python3
"""臺南舊站周邊建物網格（2026-09-12 歷史重播頁的背景）。

為什麼有這支：重播頁原本把周邊每一棟 OSM 建物擠成同一色的灰米色方塊，使用者 2026-09-30 08:16 退件
（「看起來太陽春了 除了車站 附近的建築物應該也要同樣建模 不需要太精細 但是不要是灰色方塊」）。
這裡把每棟建物改成低細節、看得出是台灣市區房子的模型：分色外牆、每層一條窗帶、朝街一樓的騎樓／店面帶與招牌、
平屋頂女兒牆與水塔／鐵皮加蓋、斜屋頂。只用顏色、不貼圖。外觀依 OSM 建物類型與 id 決定，不用亂數，每次打開都一樣。

輸入：memories/tainan-2026-09-12/snapshot.json 的 features 內有 tags.building 者，加上封存輪廓漏掉的香格里拉飯店塔身（同資料夾 tower-parts-source.json，
      OSM building:part；讀取集中在 read_snapshot()，之後要換資料來源只改它）。
輸出（python3 surroundings.py --pack）：
  memories/tainan-2026-09-12/surroundings/near.mesh.bin.gz   Float32 交錯 stride 6（位置 3＋法線 3）、每種材質一個 drawGroup、gzip -9 mtime=0
  memories/tainan-2026-09-12/surroundings/model.json         drawGroups、每棟建物的樓層與高度來源、示意項目清單
座標與 replay.js 的 world() 相同：x=(lon−origin_lon)·111320·cos(origin_lat)、y=(lat−origin_lat)·111320，單位公尺、z 向上；
網格放在 (0,0,0)、不旋轉，牆腳 z=0.03。純 Python 3（需 numpy、shapely），不用 Blender。

用法：
  python3 surroundings.py            試跑：只印統計與自檢，不寫檔
  python3 surroundings.py --pack     寫出上面兩個檔
  python3 surroundings.py --pack --out DIR   改寫到別的資料夾（驗證決定性、突變測試用）
"""
import argparse
import gzip
import hashlib
import json
import math
import re
import sys
from array import array
from pathlib import Path

import numpy as np
from shapely.geometry import LineString, Point, Polygon
from shapely.strtree import STRtree

HERE = Path(__file__).resolve().parent
MEMORY_DIR = HERE.parent.parent.parent.parent / 'memories' / 'tainan-2026-09-12'
SNAPSHOT = MEMORY_DIR / 'snapshot.json'
STATION_MODEL = MEMORY_DIR / 'station' / 'model.json'
TOWER_PARTS = HERE / 'tower-parts-source.json'
OUT_DIR = MEMORY_DIR / 'surroundings'

# ---------------------------------------------------------------- 常數（尺寸單位：公尺）
GROUND_Z = 0.03                 # 牆腳
FIRST_FLOOR_H = 3.6             # 一樓層高
UPPER_FLOOR_H = 3.2             # 二樓以上層高
HEIGHT_TAG_MAX_M = 200.0        # 超過這個值的 height 標記視為輸入錯誤（見 estimates；閘門有同一條常數）。香格里拉飯店塔頂標 152 m，是真的高樓
WINDOW_SILL = 0.9               # 窗帶下緣：樓板往上
WINDOW_H = 1.3
WINDOW_END_INSET = 0.3          # 窗帶兩端各內縮
WINDOW_MIN_SEG = 2.0            # 牆段短於這個就不放窗帶
FACE_OFFSET = 0.03              # 窗帶、店面帶往牆外偏，避免與牆共面
SHOP_TOP = 3.2                  # 朝街一樓深色帶的上緣
STREET_RAY_M = 15.0             # 朝街：牆段中點沿外法線 15 m 內有 highway 線
SIGN_Z0, SIGN_Z1 = 4.0, 5.2     # 招牌的離地範圍
SIGN_MIN_SEG = 4.0
SIGN_WIDTH_FRAC = 0.6
SIGN_THICK = 0.15
SIGN_TOP_CLEAR = 0.4            # 招牌上緣要比牆頂低至少這麼多，否則（一層樓的矮房）不放
PARAPET_H = 0.9                 # 女兒牆
PARAPET_T = 0.2
SMALL_AREA = 20.0               # 小建物：只畫牆和屋頂
BAND_H = 0.3                    # 紅磚外牆的白飾帶
SHED_LEN, SHED_WID = 4.0, 3.0   # 鐵皮加蓋的平面（脊線沿長邊）
SHED_WALL, SHED_RIDGE = 2.4, 0.6
SHED_INSET = 1.0
SHED_MIN_AREA = 16.0
SHED_FRACTION = 0.40
TANK_SIZE = 1.2
TANK_GAP = 0.4                  # 水塔與鐵皮屋、水塔與水塔的最小間距
ROOF_PITCH_DEG = 22.0           # 斜屋頂坡度（示意）
ROOF_RISE_CAP = 3.5
COLLINEAR_TOL = 0.01            # 輪廓上偏離弦不到 1 cm 的點視為共線、拿掉
MIN_TRI_AREA = 1e-5             # 產生時就丟掉的退化三角形門檻（規格上限 1e-6，留一個量級給 float32 量化）
SPEC_MIN_TRI_AREA = 1e-6
NEAR_BUDGET = {'maxTriangles': 60000, 'maxGzipBytes': 350000, 'maxDrawGroups': 16}

# 預設樓層（沒有 height、building:levels 標記時依類型估）。warehouse、grandstand 直接給樓高。
DEFAULT_FLOORS = {'yes': 3, 'residential': 4, 'house': 4, 'apartments': 4, 'dormitory': 5, 'retail': 3, 'commercial': 3,
                  'office': 6, 'government': 4, 'university': 4, 'school': 4, 'transportation': 2}
DEFAULT_OTHER_FLOORS = 3
FIXED_DEFAULT = {'warehouse': (1, 6.0), 'grandstand': (1, 8.0)}

RESIDENTIAL = ('residential', 'house', 'apartments')
SHOP_TYPES = RESIDENTIAL + ('retail', 'commercial', 'yes')     # 朝街一樓畫騎樓／店面帶
ROOF_ITEM_TYPES = RESIDENTIAL + ('yes',)                       # 屋頂水塔／鐵皮加蓋
CIVIC_TYPES = ('government', 'university', 'school', 'dormitory')
UTILITY_TYPES = ('transportation', 'train_station', 'warehouse', 'grandstand')

# ---------------------------------------------------------------- 材質（drawGroups 的順序＝這裡的順序，空的自動略過）
# (key, sRGB hex, roughness, metalness, 說明)
MATS = [
    ('wall_cream', 'E9DFC3', 0.92, 0.0, '米白外牆（含白色飾帶、白招牌）'),
    ('wall_gray', 'B9BCB8', 0.92, 0.0, '淺灰磁磚外牆（含交通、倉庫、看台；也當部分屋面）'),
    ('wall_pink', 'E0B4A8', 0.92, 0.0, '淡粉外牆'),
    ('wall_tan', 'C3A07A', 0.92, 0.0, '淺褐外牆'),
    ('wall_sage', 'A7BDA3', 0.92, 0.0, '淡綠灰外牆（也當部分綠色防水漆屋面）'),
    ('wall_office', '8EA5B8', 0.90, 0.0, '灰藍外牆（辦公）'),
    ('wall_yellow', 'E6CA82', 0.92, 0.0, '米黃外牆（公家、學校、宿舍）'),
    ('wall_brick', 'A24E38', 0.95, 0.0, '紅磚外牆（公家、學校、宿舍；也當斜屋頂瓦色）'),
    ('glass', '3F6172', 0.30, 0.1, '窗帶（深色玻璃）'),
    ('shopfront', '3A3634', 0.85, 0.0, '朝街一樓騎樓／店面帶（深色）'),
    ('roof', 'C9CCCA', 0.95, 0.0, '平屋頂與女兒牆（淺水泥色）'),
    ('roof_alt', 'D9D3C2', 0.95, 0.0, '平屋頂與女兒牆（偏暖的淺水泥色）'),
    ('tank', '8B9297', 0.45, 0.1, '水塔與灰色鐵皮加蓋'),
    ('blue_metal', '4C89C2', 0.70, 0.1, '藍色鐵皮（招牌與屋頂加蓋）'),
    ('sign_red', 'C8382D', 0.80, 0.0, '紅色招牌'),
    ('sign_yellow', 'E6B52B', 0.80, 0.0, '黃色招牌'),
]
MAT_INFO = {m[0]: m for m in MATS}
RES_WALLS = ['wall_cream', 'wall_gray', 'wall_pink', 'wall_tan', 'wall_sage']
CIVIC_WALLS = ['wall_yellow', 'wall_brick']
SIGN_COLORS = ['sign_red', 'sign_yellow', 'blue_metal', 'wall_cream']   # 紅、黃、藍、白（白＝米白牆色群組，省一個 drawGroup）
SHED_COLORS = ['blue_metal', 'tank']                                     # 淺藍或灰
ROOF_GROUPS = ['roof', 'roof', 'roof', 'roof', 'roof_alt', 'roof_alt', 'roof_alt', 'wall_gray', 'wall_gray', 'wall_sage']   # 平屋面：三種水泥色加綠色防水漆，依 id 雜湊選（借用牆色群組，不多開 drawGroup）
TILE_ROOF = 'wall_brick'                                                # 斜屋頂：紅瓦色


def srgb_to_linear(h):
    """與 materials.py 的 srgb_to_linear 相同。"""
    out = []
    for i in (0, 2, 4):
        v = int(h[i:i + 2], 16) / 255.0
        out.append(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4)
    return out


# ---------------------------------------------------------------- 決定性「亂數」：sha256(id 與用途)，不依賴 Python 版本
def h64(*parts):
    return int.from_bytes(hashlib.sha256(':'.join(str(p) for p in parts).encode('utf-8')).digest()[:8], 'big')


def unit(*parts):
    return (h64(*parts) >> 11) / float(1 << 53)


def pick(seq, *parts):
    return seq[h64(*parts) % len(seq)]


# ---------------------------------------------------------------- 輸入（之後改接別的資料來源只改這一區）
_NUM = re.compile(r'^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?')


def js_parse_float(value):
    """與 JavaScript parseFloat 相同：取開頭的數字，沒有就 NaN。閘門用 parseFloat，兩邊語意要一致。"""
    m = _NUM.match(str(value))
    return float(m.group(0)) if m else float('nan')


def read_snapshot(snapshot_path=SNAPSHOT, station_model_path=STATION_MODEL, parts_path=TOWER_PARTS):
    """讀封存輪廓：回傳 dict(origin, station_id, features, snapshot_sha256, parts, parts_sha256)。features 每筆有 id、tags、coordinates（經緯度環）。
    parts：封存輪廓漏掉的香格里拉飯店塔身與屋頂機房（OSM building:part，沒有 building 標記）。這裡以 building='part' 代入，
    讓它走一般外牆、不畫店面、招牌與屋頂水塔；其餘 OSM 標記照原樣。"""
    raw = Path(snapshot_path).read_bytes()
    data = json.loads(raw.decode('utf-8'))
    station_id = json.loads(Path(station_model_path).read_text(encoding='utf-8'))['osmId']
    praw = Path(parts_path).read_bytes()
    parts = [{'id': e['id'], 'tags': {**e['tags'], 'building': 'part'}, 'coordinates': e['coordinates']}
             for e in json.loads(praw.decode('utf-8'))['elements']]
    return {'origin': data['origin'], 'station_id': station_id, 'features': data['features'],
            'snapshot_sha256': hashlib.sha256(raw).hexdigest(), 'date': data.get('date'),
            'parts': parts, 'parts_sha256': hashlib.sha256(praw).hexdigest()}


def classify(feature, station_id):
    """與 replay.js features 迴圈同一套順序：highway、railway=platform、roof、bridge 由它們自己的分支處理；
    舊站房本體與施工中另外處理。回傳 (是否進周邊網格, 排除原因或 None)。"""
    t = feature['tags']
    if 'building' not in t:
        return False, None
    if t.get('highway') or t.get('railway') == 'platform':
        return False, 'other-branch'
    if t['building'] == 'roof':
        return False, 'roof'
    if t['building'] == 'bridge':
        return False, 'bridge'
    if feature['id'] == station_id:
        return False, 'station'
    if t.get('construction') or t['building'] == 'construction':
        return False, 'construction'
    return True, None


def select(features, station_id):
    included, excluded = [], []
    for f in sorted(features, key=lambda f: f['id']):
        ok, why = classify(f, station_id)
        if ok:
            included.append(f)
        elif why:
            excluded.append({'id': f['id'], 'type': f['tags']['building'], 'reason': why})
    return included, excluded


def resolve_height(tags):
    """(樓層數, 牆頂離地 m, 來源, 牆腳離地 m)。牆頂＝height 標記；否則 牆腳＋3.6+(層數−1)×3.2；都沒有就依類型估層數。
    有 min_height 的部件（塔身、塔頂）牆腳從該高度起算，其餘從地面；樓層數只算牆腳到牆頂這一段。"""
    base = js_parse_float(tags.get('min_height', ''))
    base = base if math.isfinite(base) and base > 0 else 0.0
    if 'height' in tags:
        h = js_parse_float(tags['height'])
        if math.isfinite(h) and base < h <= HEIGHT_TAG_MAX_M:
            return max(1, int(math.floor((h - base - FIRST_FLOOR_H) / UPPER_FLOOR_H + 0.5)) + 1), h, 'height', base
    if 'building:levels' in tags:
        lv = js_parse_float(tags['building:levels'])
        if math.isfinite(lv) and lv > 0:
            return max(1, int(math.floor(lv + 0.5))), base + FIRST_FLOOR_H + (lv - 1) * UPPER_FLOOR_H, 'levels', base
    kind = tags['building']
    if kind in FIXED_DEFAULT:
        floors, h = FIXED_DEFAULT[kind]
        return floors, base + h, 'default', base
    floors = DEFAULT_FLOORS.get(kind, DEFAULT_OTHER_FLOORS)
    return floors, base + FIRST_FLOOR_H + (floors - 1) * UPPER_FLOOR_H, 'default', base


# ---------------------------------------------------------------- 平面幾何
def dist(p, q):
    return math.hypot(q[0] - p[0], q[1] - p[1])


def cross(o, a, b):
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def signed_area(ring):
    return sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring))) / 2.0


def clean_ring(pts, tol=COLLINEAR_TOL):
    """去掉結尾重複點、連續重複點、偏離弦不到 tol 的共線點，並統一成逆時針。回傳 tuple 串列（不含結尾重複點）。"""
    pts = [(float(p[0]), float(p[1])) for p in pts]
    if len(pts) > 1 and dist(pts[0], pts[-1]) < 1e-6:
        pts = pts[:-1]
    while len(pts) >= 3:
        n = len(pts)
        for i in range(n):
            p, q, r = pts[i - 1], pts[i], pts[(i + 1) % n]
            chord = dist(p, r)
            d = abs(cross(p, q, r)) / chord if chord > 1e-3 else 0.0     # 前後兩點重合＝折返的零面積尖刺
            if dist(p, q) < 1e-3 or dist(q, r) < 1e-3 or d < tol:
                pts.pop(i)
                break
        else:
            break
    if len(pts) >= 3 and signed_area(pts) < 0:
        pts.reverse()
    return pts


def _in_tri(p, a, b, c, eps=1e-9):
    return cross(a, b, p) >= -eps and cross(b, c, p) >= -eps and cross(c, a, p) >= -eps


def triangulate(pts):
    """ear clipping。pts 為逆時針、無重複點的環；回傳逆時針三角形索引。凹多邊形正確處理；不產生零面積三角形。"""
    n = len(pts)
    if n < 3:
        return []
    idx = list(range(n))
    out = []
    while len(idx) > 3:
        m = len(idx)
        clipped = False
        for k in range(m):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % m]
            a, b, c = pts[i0], pts[i1], pts[i2]
            if cross(a, b, c) <= 1e-9:
                continue
            if any(_in_tri(pts[j], a, b, c) for j in idx if j not in (i0, i1, i2)
                   and pts[j] != a and pts[j] != b and pts[j] != c):
                continue
            out.append((i0, i1, i2))
            idx.pop(k)
            clipped = True
            break
        if not clipped:                     # 數值退化（共線殘留）：丟掉最平的頂點，不產生三角形
            k = min(range(m), key=lambda k: abs(cross(pts[idx[k - 1]], pts[idx[k]], pts[idx[(k + 1) % m]])))
            idx.pop(k)
    if len(idx) == 3 and cross(pts[idx[0]], pts[idx[1]], pts[idx[2]]) > 1e-9:
        out.append(tuple(idx))
    return out


def polygon_pieces(geom):
    """shapely 結果拆成 Polygon 清單。"""
    if geom.is_empty:
        return []
    if geom.geom_type == 'Polygon':
        return [geom]
    return [g for g in getattr(geom, 'geoms', []) if g.geom_type == 'Polygon' and not g.is_empty]


# ---------------------------------------------------------------- 網格累積器
class Mesh:
    def __init__(self):
        self.buf = {m[0]: [] for m in MATS}
        self.skipped = 0            # 面積太小被丟掉的三角形數（應為 0 或極少）
        self.flipped = 0            # 依預期法線翻過繞序的三角形數（除錯用）

    def tri(self, mat, p, q, r, expect=None):
        ux, uy, uz = q[0] - p[0], q[1] - p[1], q[2] - p[2]
        vx, vy, vz = r[0] - p[0], r[1] - p[1], r[2] - p[2]
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        ln = math.sqrt(nx * nx + ny * ny + nz * nz)
        if ln < 2 * MIN_TRI_AREA:
            self.skipped += 1
            return
        nx, ny, nz = nx / ln, ny / ln, nz / ln
        if expect is not None and nx * expect[0] + ny * expect[1] + nz * expect[2] < 0:
            q, r = r, q
            nx, ny, nz = -nx, -ny, -nz
            self.flipped += 1
        self.buf[mat].extend((p[0], p[1], p[2], nx, ny, nz, q[0], q[1], q[2], nx, ny, nz, r[0], r[1], r[2], nx, ny, nz))

    def quad(self, mat, p0, p1, p2, p3, expect=None):
        self.tri(mat, p0, p1, p2, expect)
        self.tri(mat, p0, p2, p3, expect)

    def count(self, mat=None):
        return sum(len(b) for b in self.buf.values()) // 18 if mat is None else len(self.buf[mat]) // 18


def _lift(p, z):
    return (p[0], p[1], z)


# ---------------------------------------------------------------- 一棟建物
class Wall:
    """輪廓的一段牆（逆時針外環，外法線＝方向右轉 90°）。"""
    __slots__ = ('a', 'b', 'L', 'd', 'n', 'mid', 'street')

    def __init__(self, a, b):
        self.a, self.b = a, b
        self.L = dist(a, b)
        self.d = ((b[0] - a[0]) / self.L, (b[1] - a[1]) / self.L)
        self.n = (self.d[1], -self.d[0])
        self.mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        self.street = False

    def at(self, s, off=0.0):
        return (self.a[0] + self.d[0] * s + self.n[0] * off, self.a[1] + self.d[1] * s + self.n[1] * off)


def floor_bases(floors):
    return [0.0 if k == 0 else FIRST_FLOOR_H + (k - 1) * UPPER_FLOOR_H for k in range(floors)]


def mbr_frame(poly):
    """最小外接矩形：中心 c、長軸單位向量 u、短軸 v，半長 a（長軸）、半寬 b（短軸），a≥b。"""
    corners = list(poly.minimum_rotated_rectangle.exterior.coords)[:4]
    e0 = (corners[1][0] - corners[0][0], corners[1][1] - corners[0][1])
    e1 = (corners[2][0] - corners[1][0], corners[2][1] - corners[1][1])
    l0, l1 = math.hypot(*e0), math.hypot(*e1)
    if l0 >= l1:
        u, a, b = (e0[0] / l0, e0[1] / l0), l0 / 2, l1 / 2
    else:
        u, a, b = (e1[0] / l1, e1[1] / l1), l1 / 2, l0 / 2
    c = (sum(p[0] for p in corners) / 4, sum(p[1] for p in corners) / 4)
    return c, u, (-u[1], u[0]), a, b


class Slope:
    """斜屋頂：屋脊沿最小外接矩形長軸。gabled＝山形、hipped＝四坡。高度函數 g(s,t) 分段線性。"""

    def __init__(self, kind, poly):
        self.kind = kind
        self.c, self.u, self.v, self.a, self.b = mbr_frame(poly)
        rise = min(self.b * math.tan(math.radians(ROOF_PITCH_DEG)), ROOF_RISE_CAP)
        self.k = rise / self.b if self.b > 1e-9 else 0.0
        self.rise = rise

    def local(self, p):
        dx, dy = p[0] - self.c[0], p[1] - self.c[1]
        return dx * self.u[0] + dy * self.u[1], dx * self.v[0] + dy * self.v[1]

    def world(self, s, t):
        return (self.c[0] + s * self.u[0] + t * self.v[0], self.c[1] + s * self.u[1] + t * self.v[1])

    def g(self, s, t):
        if self.kind == 'gabled':
            return self.k * (self.b - abs(t))
        return self.k * min(self.b - abs(t), self.a - abs(s))

    def height_at(self, p):
        return self.g(*self.local(p))

    def regions(self):
        """屋面分區（世界座標多邊形）：每區內 g 是平面。多邊形涵蓋整個最小外接矩形。"""
        a, b, w = self.a, self.b, self.world
        if self.kind == 'gabled':
            return [[w(-a, 0), w(a, 0), w(a, b), w(-a, b)], [w(-a, -b), w(a, -b), w(a, 0), w(-a, 0)]]
        r = a - b
        return [[w(-a, b), w(a, b), w(r, 0), w(-r, 0)],
                [w(-a, -b), w(-r, 0), w(r, 0), w(a, -b)],
                [w(a, -b), w(r, 0), w(a, b)],
                [w(-a, b), w(-r, 0), w(-a, -b)]]

    def breakpoints(self, a, b):
        """牆段 a→b 上高度函數的折點（參數 0~1，含端點）。"""
        s0, t0 = self.local(a)
        s1, t1 = self.local(b)
        ds, dt = s1 - s0, t1 - t0
        lam = {0.0, 1.0}

        def add(num, den):
            if abs(den) > 1e-12:
                x = num / den
                if 1e-9 < x < 1 - 1e-9:
                    lam.add(x)
        add(-t0, dt)
        if self.kind == 'hipped':
            add(-s0, ds)
            for ss in (1, -1):
                for tt in (1, -1):
                    add(self.a - self.b - (ss * s0 - tt * t0), ss * ds - tt * dt)
        return sorted(lam)


def street_facing(walls, tree, geoms):
    for w in walls:
        ray = LineString([w.mid, (w.mid[0] + w.n[0] * STREET_RAY_M, w.mid[1] + w.n[1] * STREET_RAY_M)])
        w.street = any(ray.intersects(geoms[i]) for i in tree.query(ray))


def sign_eligible(tags):
    return tags['building'] in ('retail', 'commercial') or 'shop' in tags or 'amenity' in tags


WALL_GROUPS = ('wall_cream', 'wall_gray', 'wall_pink', 'wall_tan', 'wall_sage', 'wall_office', 'wall_yellow', 'wall_brick')


def wall_group(tags, bid):
    hexc = tags.get('building:colour', '')
    if re.fullmatch(r'#[0-9a-fA-F]{6}', hexc):
        # OSM 有標外牆色（目前只有香格里拉飯店塔樓的幾個部件）：取最接近的現有牆色組，不多開 drawGroup
        rgb = [int(hexc[i:i + 2], 16) for i in (1, 3, 5)]
        return min(WALL_GROUPS, key=lambda k: sum((int(MAT_INFO[k][1][2 * i:2 * i + 2], 16) - rgb[i]) ** 2 for i in range(3)))
    kind = tags['building']
    if kind == 'office':
        return 'wall_office'
    if kind in CIVIC_TYPES:
        return pick(CIVIC_WALLS, 'civic', bid)
    if kind in UTILITY_TYPES:
        return 'wall_gray'
    return pick(RES_WALLS, 'wall', bid)


def build_building(mesh, feat, ring, floors, H, source, tree, geoms, stats, items, min_h=0.0, capped=False):
    """ring：逆時針外環（公尺，無重複點）。H：牆頂離地高；min_h：牆腳離地高（塔身、塔頂等部件）。
    capped：頂上整個疊著另一個部件（牆腳＝這棟牆頂、輪廓蓋住這棟），不砌女兒牆、不放屋頂附屬物。回傳 None。"""
    bid, tags = feat['id'], feat['tags']
    kind = tags['building']
    poly = Polygon(ring)
    area = poly.area
    small = area < SMALL_AREA
    walls = [Wall(ring[i], ring[(i + 1) % len(ring)]) for i in range(len(ring))]
    walls = [w for w in walls if w.L > 1e-3]
    street_facing(walls, tree, geoms)
    wcol = wall_group(tags, bid)
    rcol = pick(ROOF_GROUPS, 'roof', bid)
    slope = Slope(tags['roof:shape'], poly) if tags.get('roof:shape') in ('gabled', 'hipped') else None
    flat = slope is None
    parapet = flat and not small and not capped     # 被蓋住的女兒牆會跟上面那棟的外牆疊在同一個面上閃爍
    z0 = GROUND_Z + min_h              # 牆腳：一般建物在地面，部件從 min_height 起算
    top = GROUND_Z + H                 # 屋面（牆頂）標高
    ground = min_h == 0.0              # 騎樓／店面帶與招牌只給從地面蓋起的建物
    band_top = top + (PARAPET_H if parapet else 0.0)
    detail = not small
    if slope:
        stats['sloped'] += 1
    stats['buildings'] += 1

    # 外牆（平屋頂連女兒牆外側一起往上；斜屋頂的牆頂跟著屋面）
    for w in walls:
        nrm = (w.n[0], w.n[1], 0.0)
        if slope:
            lams = slope.breakpoints(w.a, w.b)
            pts = [(w.at(l * w.L), slope.height_at(w.at(l * w.L))) for l in lams]
            for (p, g), (q, h) in zip(pts, pts[1:]):
                mesh.quad(wcol, _lift(p, z0), _lift(q, z0), _lift(q, top + h), _lift(p, top + g), nrm)
        else:
            mesh.quad(wcol, _lift(w.a, z0), _lift(w.b, z0), _lift(w.b, band_top), _lift(w.a, band_top), nrm)

    if detail:
        # 樓板線從地面算起（部件與底下的建物共用同一套樓層，貼在一起的牆面窗帶才對得齊）；地面建物＝floor_bases(floors)
        bases = [b for b in floor_bases(floors + int(math.ceil(min_h / UPPER_FLOOR_H)) + 1) if b >= min_h - 1e-9][:floors]
        shop_ok = kind in SHOP_TYPES and ground
        inset = WINDOW_END_INSET
        for wi, w in enumerate(walls):
            nrm = (w.n[0], w.n[1], 0.0)
            usable = w.L >= WINDOW_MIN_SEG
            s0, s1 = inset, w.L - inset
            shop_wall = shop_ok and w.street and usable
            if shop_wall:
                mesh.quad('shopfront', _lift(w.at(s0, FACE_OFFSET), z0), _lift(w.at(s1, FACE_OFFSET), z0),
                          _lift(w.at(s1, FACE_OFFSET), z0 + SHOP_TOP), _lift(w.at(s0, FACE_OFFSET), z0 + SHOP_TOP), nrm)
                stats['shopfronts'] += 1
            if usable:
                for k, base in enumerate(bases):
                    if k == 0 and shop_wall:
                        continue
                    zb = GROUND_Z + base + WINDOW_SILL
                    zt = zb + WINDOW_H
                    if zt > top - 0.05:
                        break
                    mesh.quad('glass', _lift(w.at(s0, FACE_OFFSET), zb), _lift(w.at(s1, FACE_OFFSET), zb),
                              _lift(w.at(s1, FACE_OFFSET), zt), _lift(w.at(s0, FACE_OFFSET), zt), nrm)
                    stats['windows'] += 1
            # 紅磚外牆加白飾帶：每層樓板線一條，外加牆頂下緣一條
            if wcol == 'wall_brick' and w.L >= 0.5:
                lines = [GROUND_Z + b for b in bases[1:]] + [top - BAND_H / 2 - 0.1]
                for zc in lines:
                    if zc + BAND_H / 2 > top:
                        continue
                    mesh.quad('wall_cream', _lift(w.at(0, FACE_OFFSET), zc - BAND_H / 2), _lift(w.at(w.L, FACE_OFFSET), zc - BAND_H / 2),
                              _lift(w.at(w.L, FACE_OFFSET), zc + BAND_H / 2), _lift(w.at(0, FACE_OFFSET), zc + BAND_H / 2), nrm)
            # 招牌
            if ground and w.street and w.L >= SIGN_MIN_SEG and sign_eligible(tags) and H >= SIGN_Z1 + SIGN_TOP_CLEAR:
                sw = w.L * SIGN_WIDTH_FRAC
                a0, a1 = (w.L - sw) / 2, (w.L + sw) / 2
                col = pick(SIGN_COLORS, 'sign', bid, wi)
                zs0, zs1 = z0 + SIGN_Z0, z0 + SIGN_Z1
                front = SIGN_THICK
                pa0, pa1 = w.at(a0, front), w.at(a1, front)
                mesh.quad(col, _lift(pa0, zs0), _lift(pa1, zs0), _lift(pa1, zs1), _lift(pa0, zs1), nrm)                     # 正面
                mesh.quad(col, _lift(pa0, zs1), _lift(pa1, zs1), _lift(w.at(a1), zs1), _lift(w.at(a0), zs1), (0, 0, 1))     # 上面
                mesh.quad(col, _lift(pa0, zs0), _lift(w.at(a0), zs0), _lift(w.at(a1), zs0), _lift(pa1, zs0), (0, 0, -1))    # 下面
                mesh.quad(col, _lift(w.at(a0), zs0), _lift(pa0, zs0), _lift(pa0, zs1), _lift(w.at(a0), zs1), (-w.d[0], -w.d[1], 0))   # 左端
                mesh.quad(col, _lift(pa1, zs0), _lift(w.at(a1), zs0), _lift(w.at(a1), zs1), _lift(pa1, zs1), (w.d[0], w.d[1], 0))     # 右端
                stats['signs'] += 1

    # 屋頂
    if flat:
        pieces = triangulate(ring)
        for i, j, k in pieces:
            mesh.tri(rcol, _lift(ring[i], top), _lift(ring[j], top), _lift(ring[k], top), (0, 0, 1))
        if parapet:
            for w in walls:
                # 頂面（外牆線往內 0.2 m）與內側面（朝屋頂、從屋面到頂）
                pin_a, pin_b = w.at(0, -PARAPET_T), w.at(w.L, -PARAPET_T)
                mesh.quad(rcol, _lift(w.a, band_top), _lift(w.b, band_top), _lift(pin_b, band_top), _lift(pin_a, band_top), (0, 0, 1))
                mesh.quad(rcol, _lift(pin_a, top), _lift(pin_b, top), _lift(pin_b, band_top), _lift(pin_a, band_top), (-w.n[0], -w.n[1], 0))
            place_roof_items(mesh, feat, poly, floors, top, stats, items)
    else:
        for region in slope.regions():
            for piece in polygon_pieces(poly.intersection(Polygon(region))):
                rp = clean_ring(list(piece.exterior.coords))
                if len(rp) < 3:
                    continue
                for i, j, k in triangulate(rp):
                    mesh.tri(TILE_ROOF, *[(rp[m][0], rp[m][1], top + slope.height_at(rp[m])) for m in (i, j, k)], expect=(0, 0, 1))


# ---------------------------------------------------------------- 屋頂附屬物（水塔、鐵皮加蓋）
def _rect(c, e1, e2, l1, l2):
    return [(c[0] + e1[0] * sx * l1 / 2 + e2[0] * sy * l2 / 2, c[1] + e1[1] * sx * l1 / 2 + e2[1] * sy * l2 / 2)
            for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]


def _grid(inset, frame, step=0.5):
    """在最小外接矩形座標系裡以 step 為間距掃 inset 的外框，逐點回傳世界座標（決定性順序）。"""
    c, u, v, _a, _b = frame
    minx, miny, maxx, maxy = inset.bounds
    loc = [((x - c[0]) * u[0] + (y - c[1]) * u[1], (x - c[0]) * v[0] + (y - c[1]) * v[1])
           for x, y in ((minx, miny), (maxx, miny), (maxx, maxy), (minx, maxy))]
    s_lo, s_hi = min(p[0] for p in loc), max(p[0] for p in loc)
    t_lo, t_hi = min(p[1] for p in loc), max(p[1] for p in loc)
    for i in range(int(math.floor((s_hi - s_lo) / step)) + 2):
        for j in range(int(math.floor((t_hi - t_lo) / step)) + 2):
            s, t = s_lo + i * step, t_lo + j * step
            yield (c[0] + s * u[0] + t * v[0], c[1] + s * u[1] + t * v[1])


def place_roof_items(mesh, feat, poly, floors, top, stats, items):
    bid, tags = feat['id'], feat['tags']
    if tags['building'] not in ROOF_ITEM_TYPES or floors < 2:
        return
    inset = poly.buffer(-SHED_INSET, join_style='mitre', mitre_limit=2.0)
    if inset.is_empty or inset.area < 2.0:
        return
    frame = mbr_frame(poly)
    _c, u, v, _a, _b = frame
    keepout = []

    def free(shape, margin):
        return inset.contains(shape) and all(not shape.intersects(k.buffer(margin)) for k in keepout)

    # 鐵皮加蓋：約 40% 的屋頂（id 雜湊決定）；整座落在屋頂內縮 1 m 的範圍內，放不下或內縮後面積 < 16 m² 就不放
    if unit('shed', bid) < SHED_FRACTION and inset.area >= SHED_MIN_AREA:
        for (e1, e2) in ((u, v), (v, u)):
            cands = []
            for p in _grid(inset, frame):
                if not inset.contains(Point(p)):
                    continue
                shape = Polygon(_rect(p, e1, e2, SHED_LEN, SHED_WID))
                if inset.contains(shape):
                    cands.append((p, shape))
            if cands:
                p, shape = cands[h64('shed-pos', bid) % len(cands)]
                col = pick(SHED_COLORS, 'shed-color', bid)
                emit_shed(mesh, col, p, e1, e2, top)
                keepout.append(shape)
                items.append({'building': bid, 'kind': 'shed', 'material': col, 'center': [round(p[0], 3), round(p[1], 3)],
                              'footprint': [[round(x, 3), round(y, 3)] for x, y in _rect(p, e1, e2, SHED_LEN, SHED_WID)],
                              'wallM': SHED_WALL, 'ridgeM': SHED_RIDGE, 'baseZ': round(top, 3)})
                stats['sheds'] += 1
                break
    # 水塔 1～2 個：1.2 m 的方塊或八角柱
    for n in range(1 + h64('tanks', bid) % 2):
        cands = []
        for p in _grid(inset, frame):
            shape = Polygon(_rect(p, u, v, TANK_SIZE, TANK_SIZE))
            if free(shape, TANK_GAP):
                cands.append((p, shape))
        if not cands:
            break
        p, shape = cands[h64('tank-pos', bid, n) % len(cands)]
        octagon = h64('tank-shape', bid, n) % 2 == 1
        emit_tank(mesh, p, u, v, top, octagon)
        keepout.append(shape)
        items.append({'building': bid, 'kind': 'tank', 'shape': 'octagon' if octagon else 'box', 'material': 'tank',
                      'center': [round(p[0], 3), round(p[1], 3)], 'sizeM': TANK_SIZE, 'baseZ': round(top, 3)})
        stats['tanks'] += 1


def emit_tank(mesh, c, u, v, z, octagon):
    h = TANK_SIZE
    if not octagon:
        r = _rect(c, u, v, TANK_SIZE, TANK_SIZE)          # 逆時針四角
        for i in range(4):
            a, b = r[i], r[(i + 1) % 4]
            d = (b[0] - a[0], b[1] - a[1])
            n = (d[1], -d[0], 0.0)
            mesh.quad('tank', _lift(a, z), _lift(b, z), _lift(b, z + h), _lift(a, z + h), n)
        mesh.quad('tank', _lift(r[0], z + h), _lift(r[1], z + h), _lift(r[2], z + h), _lift(r[3], z + h), (0, 0, 1))
        return
    R = (TANK_SIZE / 2) / math.cos(math.pi / 8)           # 對邊距 1.2 m 的八角柱
    ring = [(c[0] + R * (math.cos(math.pi / 8 + i * math.pi / 4) * u[0] + math.sin(math.pi / 8 + i * math.pi / 4) * v[0]),
             c[1] + R * (math.cos(math.pi / 8 + i * math.pi / 4) * u[1] + math.sin(math.pi / 8 + i * math.pi / 4) * v[1])) for i in range(8)]
    for i in range(8):
        a, b = ring[i], ring[(i + 1) % 8]
        d = (b[0] - a[0], b[1] - a[1])
        mesh.quad('tank', _lift(a, z), _lift(b, z), _lift(b, z + h), _lift(a, z + h), (d[1], -d[0], 0.0))
    for i in range(1, 7):
        mesh.tri('tank', _lift(ring[0], z + h), _lift(ring[i], z + h), _lift(ring[i + 1], z + h), (0, 0, 1))


def emit_shed(mesh, mat, c, e1, e2, z):
    """山形小屋：長 SHED_LEN（沿 e1）× 寬 SHED_WID（沿 e2），牆 2.4 m、屋脊再高 0.6 m，脊線沿 e1。不畫底面。"""
    if e1[0] * e2[1] - e1[1] * e2[0] < 0:
        e2 = (-e2[0], -e2[1])
    hl, hw = SHED_LEN / 2, SHED_WID / 2

    def P(a, b):
        return (c[0] + e1[0] * a * hl + e2[0] * b * hw, c[1] + e1[1] * a * hl + e2[1] * b * hw)
    A, B, C, D = P(-1, -1), P(1, -1), P(1, 1), P(-1, 1)          # 逆時針
    R0, R1 = P(-1, 0), P(1, 0)                                   # 脊線兩端
    zw, zr = z + SHED_WALL, z + SHED_WALL + SHED_RIDGE
    for a, b in ((A, B), (B, C), (C, D), (D, A)):
        mesh.quad(mat, _lift(a, z), _lift(b, z), _lift(b, zw), _lift(a, zw), (b[1] - a[1], a[0] - b[0], 0.0))
    mesh.quad(mat, _lift(A, zw), _lift(B, zw), _lift(R1, zr), _lift(R0, zr), (-e2[0], -e2[1], 1.0))      # 朝 −e2 的斜面
    mesh.quad(mat, _lift(C, zw), _lift(D, zw), _lift(R0, zr), _lift(R1, zr), (e2[0], e2[1], 1.0))        # 朝 +e2 的斜面
    mesh.tri(mat, _lift(A, zw), _lift(D, zw), _lift(R0, zr), (-e1[0], -e1[1], 0.0))                      # 山牆
    mesh.tri(mat, _lift(B, zw), _lift(C, zw), _lift(R1, zr), (e1[0], e1[1], 0.0))


# ---------------------------------------------------------------- 全部建物
def build(source, verbose=False):
    origin = source['origin']
    sx = 111320 * math.cos(origin[1] * math.pi / 180)

    def world(p):
        return ((p[0] - origin[0]) * sx, (p[1] - origin[1]) * 111320)

    included, excluded = select(source['features'], source['station_id'])
    included += source['parts']
    hw = [LineString([world(p) for p in f['coordinates']]) for f in source['features']
          if f['tags'].get('highway') and len(f['coordinates']) >= 2]
    tree = STRtree(hw)
    mesh = Mesh()
    stats = {k: 0 for k in ('buildings', 'sloped', 'shopfronts', 'windows', 'signs', 'sheds', 'tanks', 'repaired')}
    items = []
    records = []
    footprints = []
    notes = {'heightIgnored': [], 'heightOverLevels': [], 'nested': [], 'capped': []}
    shapes = []
    for f in included:
        ring = clean_ring([world(p) for p in f['coordinates']])
        poly = Polygon(ring)
        if len(ring) < 3 or not poly.is_valid or poly.area < 1.0:
            raise SystemExit('輪廓不合法（id %s）：請先處理輸入' % f['id'])
        shapes.append((f, ring, poly) + tuple(resolve_height(f['tags'])))
    # 頂上整個被另一個部件蓋住的建物：那個部件的牆腳＝這棟牆頂（差 5 cm 內），輪廓（外擴 5 cm）包住這棟
    capped = {}
    for f, ring, poly, floors, H, src, min_h in shapes:
        for g, _ring, gpoly, _floors, _H, _src, g_min in shapes:
            if g is not f and g_min > 0 and abs(g_min - H) <= 0.05 and gpoly.buffer(0.05).contains(poly):
                capped.setdefault(f['id'], g['id'])
    for f, ring, poly, floors, H, src, min_h in shapes:
        tags = f['tags']
        if 'height' in tags and src != 'height':
            notes['heightIgnored'].append({'id': f['id'], 'height': tags['height'], 'min_height': tags.get('min_height'),
                                           'areaM2': round(poly.area, 1)})
        if src == 'height' and 'building:levels' in tags and min_h == 0:     # 部件的層數是整棟樓的層數（塔身 38 層到 140 m），不算矛盾
            notes['heightOverLevels'].append({'id': f['id'], 'name': tags.get('name'), 'height': tags['height'], 'levels': tags['building:levels']})
        build_building(mesh, f, ring, floors, H, src, tree, hw, stats, items, min_h, capped=f['id'] in capped)
        if f['id'] in capped:
            notes['capped'].append({'id': f['id'], 'by': capped[f['id']]})
        rec = {'id': f['id'], 'type': tags['building'], 'floors': floors, 'heightM': round(H, 3), 'heightSource': src}
        if min_h > 0:
            rec['minHeightM'] = round(min_h, 3)
        records.append(rec)
        footprints.append(ring)
    # 整個落在另一棟建物量體內（輪廓包住、牆腳不比它高、牆頂不比它低）的建物：畫得出來但被遮住，只揭露、不排除
    polys = [Polygon(r) for r in footprints]
    for i, pi in enumerate(polys):
        for j, pj in enumerate(polys):
            if (i != j and records[j]['heightM'] >= records[i]['heightM'] and records[j].get('minHeightM', 0) <= records[i].get('minHeightM', 0)
                    and pj.buffer(0.05).contains(pi)):
                notes['nested'].append({'id': records[i]['id'], 'inside': records[j]['id']})
    return {'mesh': mesh, 'records': records, 'excluded': excluded, 'stats': stats, 'items': items, 'footprints': footprints,
            'origin': origin, 'notes': notes}


# ---------------------------------------------------------------- 打包
def collect(mesh):
    data = array('f')
    groups = []
    for m in MATS:
        buf = mesh.buf[m[0]]
        if not buf:
            continue
        start = len(data) // 6
        data.extend(buf)
        groups.append((m[0], start, len(buf) // 6))
    return data, groups


def self_check(data, groups):
    """打包前自檢（Node 閘門會用另一套實作再驗一次）：無 NaN、法線單位長、三角形不退化、繞序與法線一致、群組首尾相接。"""
    a = np.frombuffer(data, dtype='<f4').reshape(-1, 6).astype(np.float64) if sys.byteorder == 'little' else np.array(data, dtype=np.float64).reshape(-1, 6)
    assert np.isfinite(a).all(), '有 NaN／Inf'
    pos, nrm = a[:, :3].reshape(-1, 3, 3), a[:, 3:].reshape(-1, 3, 3)
    ln = np.linalg.norm(nrm, axis=2)
    assert np.abs(ln - 1).max() < 1e-3, '法線不是單位長'
    assert np.abs(nrm - nrm[:, :1, :]).max() < 1e-6, '同一面三個頂點的法線不一致'
    cr = np.cross(pos[:, 1] - pos[:, 0], pos[:, 2] - pos[:, 0])
    area = np.linalg.norm(cr, axis=1) / 2
    assert area.min() >= SPEC_MIN_TRI_AREA, '有退化三角形 %g' % area.min()
    dot = (cr / (2 * area)[:, None] * nrm[:, 0]).sum(axis=1)
    assert dot.min() > 0.999, '繞序與法線不一致 %g' % dot.min()
    end = 0
    for name, start, count in groups:
        assert start == end, '群組不相接'
        end = start + count
    assert end == len(a), '群組沒涵蓋全部頂點'
    return {'minTriangleAreaM2': float(area.min()), 'maxNormalError': float(np.abs(ln - 1).max())}


def pack(result, out_dir, source, write=True):
    mesh = result['mesh']
    data, groups = collect(mesh)
    check = self_check(data, groups)
    if sys.byteorder != 'little':
        data.byteswap()
    raw = data.tobytes()
    gz = gzip.compress(raw, compresslevel=9, mtime=0)
    verts = len(data) // 6
    tris = verts // 3
    xs, ys, zs = data[0::6], data[1::6], data[2::6]
    bounds = {'min': [min(xs), min(ys), min(zs)], 'max': [max(xs), max(ys), max(zs)]}
    draw = []
    for name, start, count in groups:
        _k, hexcolor, rough, metal, label = MAT_INFO[name]
        draw.append({'name': name, 'label': label, 'start': start, 'count': count,
                     'color': srgb_to_linear(hexcolor), 'roughness': rough, 'metalness': metal})
    near = {'file': 'near.mesh.bin', 'sha256': hashlib.sha256(raw).hexdigest(), 'strideBytes': 24, 'vertexCount': verts,
            'triangleCount': tris, 'byteLength': len(raw), 'gzipBytes': len(gz), 'bounds': bounds, 'drawGroups': draw}
    stats = result['stats']
    types = {}
    for r in result['records']:
        types[r['type']] = types.get(r['type'], 0) + 1
    by_src = {s: sum(1 for r in result['records'] if r['heightSource'] == s) for s in ('height', 'levels', 'default')}
    n_parts = sum(1 for r in result['records'] if r['type'] == 'part')
    model = {
        'id': 'tainan-surroundings',
        'name': '臺南舊站周邊建物',
        'kind': 'tainan-surroundings',
        'version': 1,
        'snapshotDate': '2026-09-12',
        'scope': ('重播頁周邊的 OSM 封存建物輪廓（%d 棟，不含舊站房本體、施工中、雨棚、跨站橋），加上封存輪廓漏掉的香格里拉飯店塔身（%d 筆 OSM 部件），改成低細節模型：'
                  '依類型分色的外牆、每層一條深色窗帶、朝街一樓的騎樓／店面帶與招牌、平屋頂的女兒牆與水塔／鐵皮加蓋、斜屋頂。'
                  '只用顏色、不貼圖；外觀依 OSM 建物類型與 id 決定，每次打開都一樣。'
                  '這是「像台灣市區房子」的示意，不是現場測繪：外牆色、窗、騎樓、招牌、水塔與鐵皮加蓋都不是逐棟調查的結果。') % (len(result['records']) - n_parts, n_parts),
        'application': 'tainan-memory-v1/surroundings.py（純 Python 3＋numpy＋shapely，不用 Blender）',
        'axes': {'up': '+Z', 'units': 'meters', 'plan': 'x=(lon−origin_lon)·111320·cos(origin_lat)、y=(lat−origin_lat)·111320（與 replay.js world() 相同）',
                 'groundAnchor': [0, 0, 0]},
        'origin': result['origin'],
        'placement': {'position': [0, 0, 0], 'rotationDeg': 0, 'wallBaseZ': GROUND_Z},
        'bounds': bounds,
        'lods': {'near': near},
        'budget': dict(NEAR_BUDGET),
        'heightRule': {'formula': '3.6 + (層數 − 1) × 3.2', 'heightTagMaxM': HEIGHT_TAG_MAX_M,
                       'minHeight': '有 min_height 的部件（塔身、塔頂）牆腳從該高度起算，樓層數只算牆腳到牆頂這一段',
                       'defaultFloors': {**DEFAULT_FLOORS, 'other': DEFAULT_OTHER_FLOORS, 'warehouse': '1 層、6 m', 'grandstand': '1 層、8 m'}},
        'buildings': result['records'],
        'excluded': result['excluded'],
        'roofItems': result['items'],
        'stats': {**stats, 'byType': dict(sorted(types.items())), 'byHeightSource': by_src,
                  'skippedDegenerateTriangles': mesh.skipped},
        'selfCheck': check,
        'sources': [{'label': 'OpenStreetMap 封存輪廓（2026-09-12 快照，memories/tainan-2026-09-12/snapshot.json 的 features）',
                     'url': 'https://www.openstreetmap.org/', 'file': 'snapshot.json', 'sha256': source['snapshot_sha256']},
                    {'label': 'OpenStreetMap 部件：香格里拉台南遠東國際大飯店塔身與屋頂機房（封存輪廓範圍外，2026-09-30 逐筆補抓；形狀在 2026-09-12 封存前就沒再改過）',
                     'url': 'https://www.openstreetmap.org/way/255990928',
                     'file': 'prototypes/tiny-trains/blender/tainan-memory-v1/tower-parts-source.json', 'sha256': source['parts_sha256']}],
        'estimates': estimates(result, by_src),
        'modelUse': 'map-surroundings',
    }
    if write:
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / 'near.mesh.bin.gz').write_bytes(gz)
        stale = out_dir / 'near.mesh.bin'
        if stale.exists():
            stale.unlink()
        (out_dir / 'model.json').write_text(json.dumps(model, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return model


def estimates(result, by_src):
    """逐條列出哪些是示意（寫進 model.json，「關於這一天」的說明照這份寫）。"""
    st, notes = result['stats'], result['notes']
    out = [
        '沒標樓層或高度的建物，樓高依 OSM 建物類型估計（yes 3 層、住宅／公寓 4 層、宿舍 5 層、零售／商業 3 層、辦公 6 層、公家／學校 4 層、交通 2 層、倉庫 6 m、看台 8 m、其他 3 層），'
        '共 %d 棟；有 building:levels 的 %d 棟用該層數、有 height 標記的 %d 棟用該高度。樓高公式「3.6 m ＋ 每多一層 3.2 m」是示意，不是測繪。' % (
            by_src['default'], by_src['levels'], by_src['height']),
    ]
    for n in notes['heightOverLevels']:
        out.append('OSM 標記自相矛盾：%s（id %s）同時標了 %s 層與 height=%s，這裡依規則取 height（%s m）。' % (
            n.get('name') or '未命名建物', n['id'], n['levels'], n['height'], n['height']))
    for n in notes['heightIgnored']:
        out.append('OSM 標記明顯有誤：id %s（%s m²）標 height=%s%s，超過 %d m 的 height 一律不採用，改依類型估樓高。' % (
            n['id'], n['areaM2'], n['height'], '、min_height=' + str(n['min_height']) if n.get('min_height') else '', HEIGHT_TAG_MAX_M))
    parts = [r for r in result['records'] if r['type'] == 'part']
    if parts:
        out.append('香格里拉台南遠東國際大飯店：封存輪廓只有百貨裙樓（id 255990927，height=24）與塔頂（id 499082686，140～152 m），塔身（id 255990928，24～140 m）'
                   '等 %d 筆 OSM 部件的節點在封存範圍以東而沒收進來，這裡依同一份 OSM 資料補上（每筆的形狀在封存前就沒再改過）。塔頂的單斜屋頂畫成平頂；'
                   '塔樓外牆色依 OSM 標的顏色取最接近的色組。' % len(parts))
    if notes['capped']:
        out.append('頂上整個疊著另一個部件的 %d 棟不砌女兒牆（%s）：女兒牆會跟上面那棟的外牆疊在同一個面上、畫面閃爍。' % (
            len(notes['capped']), '；'.join('id %s 上面是 id %s' % (n['id'], n['by']) for n in notes['capped'])))
    if notes['nested']:
        out.append('有 %d 棟的輪廓整個落在另一棟建物的輪廓之內（%s），被外面那棟擋住、畫面上看不到；仍照規則畫進網格。' % (
            len(notes['nested']), '；'.join('id %s 在 id %s 之內' % (n['id'], n['inside']) for n in notes['nested'])))
    out += [
        '外牆顏色依建物類型分色組、組內用 id 雜湊選色（住宅與一般：米白、淺灰、淡粉、淺褐、淡綠灰；辦公：灰藍；公家／學校／宿舍：米黃或紅磚加白飾帶；交通／倉庫／看台：淺灰），是示意，不是現場色卡；'
        'OSM 有標外牆色的（只有塔樓部件）取最接近的色組。',
        '窗是每層樓一條深色窗帶（不是逐扇窗，也不是真實窗位，共 %d 條）；朝街一樓的深色騎樓／店面帶（%d 面）與招牌（%d 塊，沒有文字、店名或真實顏色）'
        '只依「牆段中點沿外法線 %d m 內有 OSM 道路」判定。' % (st['windows'], st['shopfronts'], st['signs'], STREET_RAY_M),
        '平屋頂的女兒牆（高 %.1f m、厚 %.1f m）、水塔（%d 個，%.1f m 的方塊或八角柱）與鐵皮屋頂加蓋（%d 座，%.1f m 牆加 %.1f m 屋脊）只是「台灣屋頂常見物」的示意，位置與有無都不是現場調查；'
        '水塔與鐵皮屋只放在住宅類與一般建物（樓層 ≥ 2）的平屋頂上，鐵皮屋整座落在屋頂內縮 %d m 的範圍內。' % (
            PARAPET_H, PARAPET_T, st['tanks'], TANK_SIZE, st['sheds'], SHED_WALL, SHED_RIDGE, SHED_INSET),
        '斜屋頂（%d 棟，OSM 標 roof:shape 為 gabled 或 hipped）：屋脊沿最小外接矩形長軸，坡度 %g°（屋脊最高 %.1f m）與紅瓦色都是示意。' % (
            st['sloped'], ROOF_PITCH_DEG, ROOF_RISE_CAP),
        '輪廓是封存的 OSM 描邊（航照描邊可能有 1 m 以上的視差偏差），不含 OSM 沒有的建物、地下層、騎樓實際深度與 layer 高低關係；當天施工中的建物、雨棚與跨站橋不在這份網格內。',
    ]
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pack', action='store_true', help='寫出 near.mesh.bin.gz 與 model.json')
    ap.add_argument('--out', default=str(OUT_DIR), help='輸出資料夾（預設 memories/…/surroundings）')
    args = ap.parse_args()
    source = read_snapshot()
    result = build(source)
    model = pack(result, args.out, source, write=args.pack)
    near = model['lods']['near']
    print('SURROUNDINGS', json.dumps({'buildings': len(model['buildings']), 'triangles': near['triangleCount'], 'rawBytes': near['byteLength'],
                                     'gzipBytes': near['gzipBytes'], 'drawGroups': len(near['drawGroups']), 'sha256': near['sha256'],
                                     'stats': model['stats'], 'selfCheck': model['selfCheck']}, ensure_ascii=False), flush=True)
    if args.pack:
        print('WROTE', args.out, flush=True)


if __name__ == '__main__':
    main()
