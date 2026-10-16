"""預覽用的三張圖（Pillow，不用 Blender）：平面疊圖、縱剖面、橫剖面。由 preview.py 呼叫。

三張圖都由輸出檔（model.json、near.mesh.bin.gz、profile.json）與 9/12 快照畫出；橫剖面直接用網格切面的線段，
不是照 params 重畫，所以圖上看到的就是網格實際長的樣子。字型用系統的 CJK 字型。
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import LineString, Point, Polygon

import check as CK
import ug_out as U

FONT_PATHS = ['/System/Library/Fonts/STHeiti Light.ttc', '/System/Library/Fonts/Hiragino Sans GB.ttc',
              '/System/Library/Fonts/Supplemental/Arial Unicode.ttf']
SS = 2                      # 超取樣倍率（先畫 2 倍再縮小，邊緣才平滑）

COL = {
    'bg': (250, 250, 247), 'ink': (30, 34, 40), 'grid': (222, 224, 226), 'mute': (110, 116, 124),
    'west_outer': (36, 99, 190), 'west_main': (28, 150, 84), 'east_main': (226, 126, 24), 'east_outer': (140, 70, 180),
    'station': (24, 52, 110), 'tunnel': (30, 150, 160), 'trough': (150, 120, 70), 'platform_fill': (236, 214, 150),
    'platform_edge': (150, 112, 40), 'road_xd': (200, 40, 40), 'road_mz': (190, 40, 150), 'road_ls': (80, 120, 60),
    'old': (110, 110, 110), 'stop': (0, 0, 0), 'ground': (170, 130, 80), 'soil': (236, 224, 204),
}
ROAD_COL = {'小東路': COL['road_xd'], '民族路一段': COL['road_mz'], '林森地下道': COL['road_ls']}


def _font(size):
    for p in FONT_PATHS:
        if Path(p).exists():
            return ImageFont.truetype(p, int(size * SS))
    return ImageFont.load_default()


class Canvas:
    def __init__(self, w, h, bg=COL['bg']):
        self.w, self.h = w, h
        self.img = Image.new('RGBA', (w * SS, h * SS), (*bg, 255))
        self.d = ImageDraw.Draw(self.img)
        self._fonts = {}
        self._saved = None

    def font(self, size):
        if size not in self._fonts:
            self._fonts[size] = _font(size)
        return self._fonts[size]

    def begin_clip(self, x0, y0, x1, y1):
        """之後的繪圖只保留在 [x0,x1]×[y0,y1] 內（畫到暫時的透明層，end_clip 時裁切後疊回去）。"""
        assert self._saved is None, 'begin_clip 不能巢狀'
        self._saved = (self.img, (x0, y0, x1, y1))
        self.img = Image.new('RGBA', self._saved[0].size, (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.img)

    def end_clip(self):
        assert self._saved is not None, 'end_clip 前沒有 begin_clip'
        main, (x0, y0, x1, y1) = self._saved
        box = (int(x0 * SS), int(y0 * SS), int(x1 * SS), int(y1 * SS))
        main.alpha_composite(self.img.crop(box), dest=(box[0], box[1]))
        self.img, self._saved = main, None
        self.d = ImageDraw.Draw(self.img)

    def _p(self, pts):
        return [(x * SS, y * SS) for x, y in pts]

    def line(self, pts, color, width=1.0, dash=None):
        pts = [(float(x), float(y)) for x, y in pts]
        w = max(1, int(round(width * SS)))
        if dash is None:
            self.d.line(self._p(pts), fill=(*color, 255), width=w, joint='curve')
            return
        on, off = dash
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            L = math.hypot(x1 - x0, y1 - y0)
            if L < 1e-9:
                continue
            ux, uy = (x1 - x0) / L, (y1 - y0) / L
            s = 0.0
            while s < L:
                e = min(s + on, L)
                self.d.line(self._p([(x0 + ux * s, y0 + uy * s), (x0 + ux * e, y0 + uy * e)]), fill=(*color, 255), width=w)
                s += on + off

    def poly(self, pts, fill=None, outline=None, width=1.0, alpha=255):
        pts = [(float(x), float(y)) for x, y in pts]
        if fill is not None:
            ov = Image.new('RGBA', self.img.size, (0, 0, 0, 0))
            ImageDraw.Draw(ov).polygon(self._p(pts), fill=(*fill, alpha))
            self.img.alpha_composite(ov)
            self.d = ImageDraw.Draw(self.img)
        if outline is not None:
            self.line(pts + [pts[0]], outline, width)

    def circle(self, c, r, fill=None, outline=None, width=1.0):
        x, y = c
        self.d.ellipse([(x - r) * SS, (y - r) * SS, (x + r) * SS, (y + r) * SS],
                       fill=None if fill is None else (*fill, 255), outline=None if outline is None else (*outline, 255),
                       width=max(1, int(round(width * SS))))

    def text(self, xy, s, size=14, color=COL['ink'], anchor='la', halo=True, bg=None):
        f = self.font(size)
        x, y = xy[0] * SS, xy[1] * SS
        if bg is not None:
            x0, y0, x1, y1 = self.d.textbbox((x, y), s, font=f, anchor=anchor)
            pad = 3 * SS
            ov = Image.new('RGBA', self.img.size, (0, 0, 0, 0))
            ImageDraw.Draw(ov).rectangle([x0 - pad, y0 - pad, x1 + pad, y1 + pad], fill=(*bg, 232), outline=(*COL['grid'], 255))
            self.img.alpha_composite(ov)
            self.d = ImageDraw.Draw(self.img)
            halo = False
        if halo:
            for dx, dy in ((-2, 0), (2, 0), (0, -2), (0, 2), (-1, -1), (1, 1), (-1, 1), (1, -1)):
                self.d.text((x + dx, y + dy), s, font=f, fill=(*COL['bg'], 255), anchor=anchor)
        self.d.text((x, y), s, font=f, fill=(*color, 255), anchor=anchor)

    def rect(self, x0, y0, x1, y1, fill=None, outline=None, width=1.0, alpha=255):
        self.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], fill=fill, outline=outline, width=width, alpha=alpha)

    def save(self, path):
        assert self._saved is None, '存檔時還有未結束的 clip'
        self.img.resize((self.w, self.h), Image.LANCZOS).convert('RGB').save(path)


class Frame:
    """世界座標 → 圖面像素：原點 c 對到 (px, py)、u 軸（單位向量）朝右、v＝u 的左法線朝上、scale＝像素／公尺。"""

    def __init__(self, c, u, scale, px, py):
        self.c = np.asarray(c, dtype=float)
        self.u = np.asarray(u, dtype=float)
        self.v = np.array([-self.u[1], self.u[0]])
        self.s, self.px, self.py = scale, px, py

    def __call__(self, p):
        q = np.asarray(p, dtype=float) - self.c
        return (self.px + float(q @ self.u) * self.s, self.py - float(q @ self.v) * self.s)

    def pts(self, ps):
        return [self(p) for p in ps]

    def north_dir(self):
        a, b = float(np.array([0, 1.0]) @ self.u), float(np.array([0, 1.0]) @ self.v)
        return (a, -b)


def _roads(out, names):
    snap = U.load_json(U.SNAPSHOT)
    res = {n: [] for n in names}
    for f in snap['features']:
        nm = f['tags'].get('name')
        if nm in res:
            res[nm].append(np.array([out.proj(*c) for c in f['coordinates']]))
    return res


def _road_crossings(out, roads):
    """{道路名: [(d, (x, y))]}：道路線與參考線的交點。"""
    res = {}
    for name, lines in roads.items():
        ds = []
        for ln in lines:
            x = LineString(ln).intersection(out.ref_ls)
            for g in (x.geoms if hasattr(x, 'geoms') else [x]):
                if not g.is_empty:
                    ds.append((out.project_d((g.x, g.y)), (g.x, g.y)))
        res[name] = sorted(ds)
    return res


def _tracks(out):
    ways = U.alignment_ways(out)
    al = out.params['alignment']

    def chain(ids):
        return np.vstack([ways[i] if k == 0 else ways[i][1:] for k, i in enumerate(ids)])

    return {'西外側股道': ways[al['stationLoops']['west']], '西正線': chain(al['referenceChain']['ways']),
            '東正線': chain(al['eastChain']), '東外側股道': ways[al['stationLoops']['east']]}


TRACK_COL = {'西外側股道': COL['west_outer'], '西正線': COL['west_main'], '東正線': COL['east_main'], '東外側股道': COL['east_outer']}


def _scalebar(cv, x, y, scale, meters):
    L = meters * scale
    cv.line([(x, y), (x + L, y)], COL['ink'], 2)
    cv.line([(x, y - 4), (x, y + 4)], COL['ink'], 2)
    cv.line([(x + L, y - 4), (x + L, y + 4)], COL['ink'], 2)
    cv.text((x + L / 2, y - 6), f'{meters:g} m', 13, anchor='ms')


def _north_arrow(cv, fr, x, y):
    n = fr.north_dir()
    L = 26
    cv.line([(x, y), (x + n[0] * L, y + n[1] * L)], COL['ink'], 2.5)
    cv.circle((x + n[0] * L, y + n[1] * L), 3.5, fill=COL['ink'])
    cv.text((x + n[0] * (L + 12), y + n[1] * (L + 12)), '北', 15, anchor='mm')


# ---------------------------------------------------------------- 平面疊圖
def plan_figure(out, path):
    der = out.profile['derived']
    st, pf = der['station'], der['platform']
    fps = {f['id']: f for f in out.model['footprints']}
    tr = _tracks(out)
    roads = _roads(out, ('小東路', '民族路一段', '林森地下道'))
    cross = _road_crossings(out, roads)
    old = U.load_json(U.OLD_STATION)
    old_poly = np.array([out.proj(*c) for c in old['coordinates']])
    dc = st['centerD']
    W, H = 2400, 1700
    cv = Canvas(W, H)
    cv.text((40, 18), '臺南鐵路地下化　平面疊圖（沿參考線轉正，右＝行進方向，上＝左側）', 22)
    cv.text((40, 50), '站體外框、月台頂面、四股道、小東路與民族路一段（9/12 快照道路線）；舊站體外框與 9/12 主站網路的四個停車點只供對照，臺南的停車位置用月台中心（最長編組置中）', 14, COL['mute'])
    forms = U.formation_lengths()
    lg = forms[0]                               # 最長的編組
    gap_c = (pf['d1'] - pf['d0'] - lg['lengthM']) / 2

    def panel(fr, x0, y0, x1, y1, d_lo, d_hi, title, tick, detail=False):
        cv.rect(x0, y0, x1, y1, fill=(255, 255, 255), outline=COL['grid'], width=1)
        cv.begin_clip(x0, y0, x1, y1)
        for d in np.arange(math.ceil(d_lo / tick) * tick, d_hi + 1, tick):
            p, tt = out.ref_point(d), out.ref_tangent(d)
            n = np.array([-tt[1], tt[0]])
            a, b = fr(p - n * 90), fr(p + n * 90)
            cv.line([a, b], COL['grid'], 1)
            cv.text((a[0], y1 - 6), f'd={d:.0f}', 12, COL['mute'], anchor='ms', halo=False)
        for name, col in ROAD_COL.items():
            for ln in roads[name]:
                cv.line(fr.pts(ln), col, 9 if detail else 5)
        cv.poly(fr.pts(old_poly), fill=(200, 200, 200), outline=COL['old'], width=1.5, alpha=110)
        for f in out.model['footprints']:
            if f['kind'] == 'tunnel':
                cv.poly(fr.pts(f['ring']), fill=COL['tunnel'], outline=COL['tunnel'], width=1.2, alpha=50)
        cv.poly(fr.pts(fps['station']['ring']), fill=COL['station'], outline=COL['station'], width=2.2, alpha=40)
        for f in out.model['footprints']:
            if f['kind'] == 'platform':
                cv.poly(fr.pts(f['ring']), fill=COL['platform_fill'], outline=COL['platform_edge'], width=1.6, alpha=235)
        for name, pts in tr.items():
            cv.line(fr.pts(pts), TRACK_COL[name], 3.0 if detail else 2.2)
        return fr

    # ---- 上：站體全長
    fr1 = Frame(out.ref_point(dc), out.ref_tangent(dc), 2.28, W / 2, 330)
    panel(fr1, 20, 80, W - 20, 600, st['southD'] - 190, st['northD'] + 190, '', 100)
    cv.text((28, 86), '全站（沿參考線 d 軸）', 15, COL['mute'])
    for end, d in (('南端', st['southD']), ('北端', st['northD'])):
        p, tt = out.ref_point(d), out.ref_tangent(d)
        n = np.array([-tt[1], tt[0]])
        a, b = fr1(p - n * 45), fr1(p + n * 45)
        cv.line([a, b], COL['station'], 2.5, dash=(8, 5))
        cv.text((a[0], 118), f'站體{end}　d={d:.2f}', 14, COL['station'], anchor='ms')
    mz, xd = cross['民族路一段'][-1], cross['小東路'][0]
    ym = 560
    a, b = fr1(out.ref_point(mz[0])), fr1(out.ref_point(st['southD']))
    cv.line([(a[0], ym), (b[0], ym)], COL['road_mz'], 2)
    cv.text(((a[0] + b[0]) / 2, ym - 8), f'離民族路一段交點 {st["southD"] - mz[0]:.1f} m', 14, COL['road_mz'], anchor='ms')
    a, b = fr1(out.ref_point(st['northD'])), fr1(out.ref_point(xd[0]))
    cv.line([(a[0], ym), (b[0], ym)], COL['road_xd'], 2)
    cv.text((b[0] - 8, ym - 8), f'離小東路最近交點 {xd[0] - st["northD"]:.1f} m', 14, COL['road_xd'], anchor='rs')
    cv.text((fr1(out.ref_point(mz[0]))[0], 98), '民族路一段', 14, COL['road_mz'], anchor='ms')
    cv.text((fr1(out.ref_point(xd[0]))[0] + 34, 98), '小東路', 14, COL['road_xd'], anchor='ls')
    cv.text((fr1(old_poly.mean(axis=0))[0], fr1(old_poly.mean(axis=0))[1]), '9/12 舊站體外框', 13, COL['old'], anchor='mm')
    for f in out.model['footprints']:
        if f['kind'] == 'platform':
            c = np.array(f['ring']).mean(axis=0)
            q = fr1(c)
            cv.text((q[0], q[1]), f['name'], 13, COL['platform_edge'], anchor='mm')
    a, b = fr1(out.ref_point(pf['d0'])), fr1(out.ref_point(pf['d1']))
    cv.text(((a[0] + b[0]) / 2, 214), f'月台 d={pf["d0"]:.1f}～{pf["d1"]:.1f}（長 {pf["lengthM"]} m）', 14, COL['platform_edge'], anchor='ms')
    xa, xb = (fr1(out.ref_point(pf['centerD'] + k * lg['lengthM'] / 2))[0] for k in (-1, 1))
    cv.rect(xa, 238, xb, 258, fill=COL['station'], outline=COL['ink'], width=1, alpha=215)
    cv.text(((xa + xb) / 2, 248), f'最長編組 {lg["id"]}（{lg["lengthM"]:.1f} m）以月台中心為中心：兩端各剩 {gap_c:.1f} m', 13, (255, 255, 255), anchor='mm', halo=False)
    cv.end_clip()
    # 圖例
    lx, ly = 40, 640
    cv.text((lx, ly + 12), '圖例', 15, anchor='lm')
    x = lx + 50
    for name in ('西外側股道', '西正線', '東正線', '東外側股道'):
        cv.line([(x, ly + 12), (x + 36, ly + 12)], TRACK_COL[name], 3)
        cv.text((x + 44, ly + 12), name, 14, anchor='lm')
        x += 150
    for fill, edge, txt, w in ((COL['platform_fill'], COL['platform_edge'], '月台頂面', 130), ((214, 220, 236), COL['station'], '站體外框', 130),
                               ((214, 236, 238), COL['tunnel'], '隧道外框', 130)):
        cv.rect(x, ly + 4, x + 34, ly + 20, fill=fill, outline=edge, width=1.5)
        cv.text((x + 42, ly + 12), txt, 14, anchor='lm')
        x += w
    for col, txt, w in ((COL['road_xd'], '小東路', 100), (COL['road_mz'], '民族路一段', 130)):
        cv.line([(x, ly + 12), (x + 36, ly + 12)], col, 5)
        cv.text((x + 44, ly + 12), txt, 14, anchor='lm')
        x += w
    cv.rect(x, ly + 4, x + 34, ly + 20, fill=(200, 200, 200), outline=COL['old'], width=1.5)
    cv.text((x + 42, ly + 12), '舊站體外框', 14, anchor='lm')
    x += 130
    cv.circle((x + 8, ly + 12), 6, fill=COL['stop'])
    cv.text((x + 22, ly + 12), '停車點（9/12 主站網路，10/23 不沿用）', 14, anchor='lm')
    _scalebar(cv, W - 300, 70, fr1.s, 100)
    _north_arrow(cv, fr1, W - 60, 70)

    # ---- 下：月台南端放大，標四個停車點（編號圓點＋表格）
    dz = pf['d0'] + 70
    fr2 = Frame(out.ref_point(dz), out.ref_tangent(dz), 9.6, W / 2, 1180)
    panel(fr2, 20, 700, W - 20, 1660, dz - 120, dz + 120, '', 20, detail=True)
    cv.text((28, 706), '月台南端放大（沿參考線 d 軸）', 15, COL['mute'])
    t_pf = out.ref_tangent(pf['d0'])
    n_pf = np.array([-t_pf[1], t_pf[0]])
    cv.line([fr2(out.ref_point(pf['d0']) - n_pf * 25), fr2(out.ref_point(pf['d0']) + n_pf * 25)], COL['platform_edge'], 2.5, dash=(8, 5))
    cv.text((fr2(out.ref_point(pf['d0']))[0], 730), f'月台南端 d={pf["d0"]:.2f}', 15, COL['platform_edge'], anchor='ms')
    plat_polys = [Polygon(f['ring']) for f in out.model['footprints'] if f['kind'] == 'platform']
    cv.rect(40, 750, 1180, 750 + 34 * len(CK.STOP_POINTS) + 14, fill=(255, 255, 255), outline=COL['grid'], width=1, alpha=235)
    for i, (label, (x, y)) in enumerate(CK.STOP_POINTS):
        q = fr2((x, y))
        d = out.project_d((x, y))
        dist = min(pg.distance(Point(x, y)) for pg in plat_polys)
        cv.circle(q, 11, fill=COL['stop'])
        cv.text(q, str(i + 1), 14, (255, 255, 255), anchor='mm', halo=False)
        row = 774 + i * 34
        cv.circle((58, row), 11, fill=COL['stop'])
        cv.text((58, row), str(i + 1), 14, (255, 255, 255), anchor='mm', halo=False)
        over = max(0.0, pf['d0'] - (d - lg['lengthM'] / 2))
        cv.text((80, row), f'{label} ({x}, {y})　d={d:.1f}　離月台南端 {d - pf["d0"]:.1f} m　離最近月台邊 {dist:.2f} m　以它為中心停 {lg["id"]} 會凸出月台南端 {over:.1f} m', 14, anchor='lm')
    d_stop = out.project_d(CK.STOP_POINTS[0][1])
    for yy, dctr, col, txt in ((935, pf['centerD'], COL['station'], f'{lg["id"]} {lg["lengthM"]:.1f} m 以月台中心為中心：南端剩 {gap_c:.1f} m'),
                               (985, d_stop, (200, 40, 40), f'{lg["id"]} 以停車點 1 為中心：南端凸出月台南端 {max(0.0, pf["d0"] - (d_stop - lg["lengthM"] / 2)):.1f} m（重播頁不可沿用）')):
        xa, xb = (fr2(out.ref_point(dctr + k * lg['lengthM'] / 2))[0] for k in (-1, 1))
        cv.rect(xa, yy - 12, xb, yy + 12, fill=col, outline=COL['ink'], width=1, alpha=205)
        cv.text((max(xa, 30) + 12, yy), txt, 14, (255, 255, 255), anchor='lm', halo=False)
    cv.end_clip()
    _scalebar(cv, W - 300, 1640, fr2.s, 20)
    _north_arrow(cv, fr2, W - 60, 1640)
    cv.save(path)
    return path


# ---------------------------------------------------------------- 縱剖面
def profile_figure(out, path):
    prof = out.profile
    cps = sorted(prof['controlPoints'], key=lambda c: c['d'])
    der = prof['derived']
    st, pf = der['station'], der['platform']
    P = out.params
    val = lambda n: n['value'] if isinstance(n, dict) and 'value' in n else n
    tun = P['tunnel']
    top_t = val(tun['soffitAboveTrackM']) + val(tun['roofThicknessM'])
    base_t = val(tun['baseBottomBelowTrackM'])
    wall_top = val(P['ramps']['wallTopAboveGroundM'])
    base_st = val(P['station']['baseBottomBelowTrackM'])
    roof_st = val(P['station']['roofTopZ'])
    plat_top = val(P['station']['platform']['topAboveTrackM'])
    cp = {c['id']: c for c in cps}
    L = prof['reference']['lengthM']
    roads = _roads(out, ('小東路', '民族路一段', '林森地下道'))
    cross = _road_crossings(out, roads)
    W, H = 2800, 1620
    cv = Canvas(W, H)
    cv.text((40, 18), '臺南鐵路地下化　列車高程縱剖面（d＝沿參考線距離，z＝軌道面高程）', 22)
    z = out.z_of_d

    def panel(x0, y0, x1, y1, d_lo, d_hi, z_lo, z_hi, title, tick_d, tick_z=5):
        sx, sz = (x1 - x0) / (d_hi - d_lo), (y1 - y0) / (z_hi - z_lo)
        X = lambda d: x0 + (d - d_lo) * sx
        Y = lambda zz: y1 - (zz - z_lo) * sz
        cv.rect(x0, y0, x1, y1, fill=(255, 255, 255), outline=COL['grid'])
        cv.text((x0 + 8, y0 + 6), f'{title}　垂直放大約 ×{sz / sx:.0f}', 15, COL['mute'])
        for d in np.arange(math.ceil(d_lo / tick_d) * tick_d, d_hi + 1, tick_d):
            cv.line([(X(d), y0), (X(d), y1)], COL['grid'], 1)
            cv.text((X(d), y1 + 4), f'{d:.0f}', 13, COL['mute'], anchor='mt', halo=False)
        for zz in np.arange(math.ceil(z_lo / tick_z) * tick_z, z_hi + 0.1, tick_z):
            cv.line([(x0, Y(zz)), (x1, Y(zz))], COL['grid'], 1)
            cv.text((x0 - 6, Y(zz)), f'{zz:.0f}', 13, COL['mute'], anchor='rm', halo=False)
        cv.begin_clip(x0, y0, x1, y1)
        cv.rect(x0, Y(0), x1, y1, fill=COL['soil'], alpha=120)
        cv.line([(x0, Y(0)), (x1, Y(0))], COL['ground'], 2)

        def band(d0, d1, ztop, zbot, col, alpha):
            dd = np.linspace(max(d0, d_lo - 5), min(d1, d_hi + 5), 400)
            if len(dd) < 2:
                return
            top = [(X(d), Y(ztop(d))) for d in dd]
            bot = [(X(d), Y(zbot(d))) for d in dd][::-1]
            cv.poly(top + bot, fill=col, outline=col, width=1.2, alpha=alpha)

        band(cp['south-cut-outer']['d'], cp['south-portal']['d'], lambda d: wall_top, lambda d: z(d) - base_t, COL['trough'], 110)
        band(cp['north-portal']['d'], cp['north-cut-outer']['d'], lambda d: wall_top, lambda d: z(d) - base_t, COL['trough'], 110)
        band(cp['south-portal']['d'], st['southD'], lambda d: z(d) + top_t, lambda d: z(d) - base_t, COL['tunnel'], 110)
        band(st['northD'], cp['north-portal']['d'], lambda d: z(d) + top_t, lambda d: z(d) - base_t, COL['tunnel'], 110)
        z0 = z(st['southD'])
        band(st['southD'], st['northD'], lambda d: roof_st, lambda d: z0 - base_st, COL['station'], 90)
        band(pf['d0'], pf['d1'], lambda d: z0 + plat_top, lambda d: z0, COL['platform_fill'], 255)
        cv.line([(X(d), Y(z(d))) for d in np.linspace(max(0, d_lo), min(L, d_hi), 1500)], (20, 20, 20), 3)
        for c in cps:
            if d_lo <= c['d'] <= d_hi:
                cv.circle((X(c['d']), Y(c['z'])), 6, fill=(255, 255, 255), outline=(20, 20, 20), width=2.5)
        cv.end_clip()
        return X, Y

    # ---- 上：全線
    X, Y = panel(120, 130, W - 60, 760, 0, L, -24, 6, '全線', 500)
    for name, items in cross.items():
        ds = [d for d, _ in items]
        for d in ds:
            cv.line([(X(d), 132), (X(d), Y(0))], ROAD_COL[name], 1.5, dash=(6, 5))
        cv.text((X(sum(ds) / len(ds)), 118), f'{name}（d≈{sum(ds) / len(ds):.0f}）', 14, ROAD_COL[name], anchor='ms')
    # 控制點標籤：單行加底色框；兩端的四點抬到地面上方、拉引線；站體兩端左右分開
    lift = {'south-start': (-84, 'ls', 6), 'south-cut-outer': (-44, 'ls', 6),
            'north-cut-outer': (-44, 'rs', -6), 'north-end': (-84, 'rs', -6)}
    for c in cps:
        px, py = X(c['d']), Y(c['z'])
        txt = f'{c["id"]}　z={c["z"]:g}（{c["label"]}）'
        if c['id'] in lift:
            dy, anc, dx = lift[c['id']]
            cv.line([(px, py), (px, py + dy + 8)], COL['mute'], 1.2)
            cv.text((px + dx, py + dy), txt, 13, anchor=anc, bg=(255, 255, 255))
        elif c['id'] == 'station-south':
            cv.text((px - 16, py + 44), txt, 13, anchor='rs', bg=(255, 255, 255))
        elif c['id'] == 'station-north':
            cv.text((px + 16, py + 44), txt, 13, anchor='ls', bg=(255, 255, 255))
        else:
            cv.text((px, py + 34), txt, 13, anchor='ms', bg=(255, 255, 255))
    for a, b in zip(cps, cps[1:]):
        sl = 1000 * (b['z'] - a['z']) / (b['d'] - a['d'])
        if abs(sl) < 1e-9:
            continue
        cv.text(((X(a['d']) + X(b['d'])) / 2, (Y(a['z']) + Y(b['z'])) / 2 - 22), f'{sl:+.1f}‰', 15, (160, 30, 30), anchor='ms', bg=(255, 255, 255))
    cv.text((X((st['southD'] + st['northD']) / 2), Y(-24) - 8), f'站體 d={st["southD"]:.0f}～{st["northD"]:.0f}（長 {st["lengthM"]} m）', 14, COL['station'], anchor='ms')
    lx, ly = 130, 800
    for k, (col, txt) in enumerate(((COL['trough'], 'U 槽（牆頂＝地面＋2.2 m）'), (COL['tunnel'], '隧道殼'), (COL['station'], '站體殼'),
                                    (COL['platform_fill'], '月台'), ((20, 20, 20), '軌道面 z(d)（控制點＝圓圈，控制點間線性）'))):
        x = lx + k * 330
        cv.rect(x, ly, x + 28, ly + 14, fill=col, outline=col, alpha=200)
        cv.text((x + 36, ly + 7), txt, 14, anchor='lm')

    # ---- 下：站體附近放大
    d_lo, d_hi = st['southD'] - 260, st['northD'] + 260
    X2, Y2 = panel(120, 940, W - 60, 1500, d_lo, d_hi, -23, 4, '站體附近', 100)
    for name, items in cross.items():
        ds = [d for d, _ in items if d_lo <= d <= d_hi]
        for d in ds:
            cv.line([(X2(d), 942), (X2(d), Y2(0))], ROAD_COL[name], 1.5, dash=(6, 5))
        if ds:
            cv.text((X2(sum(ds) / len(ds)), 928), name, 14, ROAD_COL[name], anchor='ms')
    for lab, d, dx in (('站南端', st['southD'], 0), ('站北端', st['northD'], 0)):
        cv.line([(X2(d), Y2(-2)), (X2(d), Y2(-21))], COL['station'], 1.5, dash=(8, 5))
        cv.text((X2(d), Y2(-21) + 16), f'{lab} d={d:.1f}', 14, COL['station'], anchor='ms')
    z0 = z(st['southD'])
    cv.text((X2(pf['centerD']), Y2(-2) - 18), f'月台 d={pf["d0"]:.1f}～{pf["d1"]:.1f}（頂 z={z0 + plat_top:.2f}）', 14, COL['platform_edge'], anchor='ms')
    cv.text((X2(st['southD']) + 10, Y2(z0) + 20), f'軌道面 z={z0:g}', 13, anchor='ls')
    cv.text((X2(st['northD']) + 8, Y2(roof_st)), f'頂板頂 z={roof_st:g}', 13, anchor='lm')
    cv.text((X2(st['northD']) + 8, Y2(z0 - base_st)), f'底板底 z={z0 - base_st:g}', 13, anchor='lm')
    cv.save(path)
    return path


# ---------------------------------------------------------------- 橫剖面
def section_figure(out, path):
    der = out.profile['derived']
    P = out.params
    val = lambda n: n['value'] if isinstance(n, dict) and 'value' in n else n
    cps = out.cp
    panels = [('南隧道中段', (cps['south-portal']['d'] + cps['station-south']['d']) / 2, 17.0, 'tunnel'),
              ('站體（月台中心）', der['platform']['centerD'], 40.0, 'station'),
              ('南引道 U 槽中段', (cps['south-cut-outer']['d'] + cps['south-portal']['d']) / 2, 17.0, 'trough')]
    scale = 34.0
    zlo, zhi = -22.5, 4.0
    W = int(sum(w for _, _, w, _ in panels) * scale + 4 * 50)
    H = int((zhi - zlo) * scale + 190)
    cv = Canvas(W, H)
    cv.text((40, 16), '橫剖面（網格切面實量；垂直於參考線，向東為右；垂直與水平同比例）', 22)
    cv.text((40, 48), '殼只畫外側面，內牆面與頂板內面用虛線表示（由牆厚、頂板厚推算）；紅框＝車輛限界（軌道中心 ±1.6 m、軌道面 +4.5 m）', 14, COL['mute'])
    matcol = {'ug_shell': COL['station'], 'ug_floor': (60, 64, 70), 'ug_trough_floor': (110, 96, 80), 'ug_trough': (150, 120, 70),
              'ug_platform': COL['platform_edge'], 'ug_b1': (40, 150, 120)}
    ways = U.alignment_ways(out)
    al = P['alignment']

    def chain(ids):
        return np.vstack([ways[i] if k == 0 else ways[i][1:] for k, i in enumerate(ids)])

    track_lines = [LineString(chain(al['referenceChain']['ways'])), LineString(chain(al['eastChain'])),
                   LineString(ways[al['stationLoops']['west']]), LineString(ways[al['stationLoops']['east']])]
    x_left = 50
    for title, d, wid, kind in panels:
        segs, p0, t = CK.section_segments(out, d)
        zt = out.z_of_d(d)
        allx = [s for m in segs for s0, z0, s1, z1 in segs[m] for s in (s0, s1)]
        sc = (min(allx) + max(allx)) / 2
        x0, x1 = x_left, x_left + wid * scale
        cx = (x0 + x1) / 2
        X = lambda s: cx + (s - sc) * scale
        Y = lambda zz: 100 + (zhi - zz) * scale
        cv.rect(x0, 100, x1, Y(zlo), fill=(255, 255, 255), outline=COL['grid'])
        cv.text((x0 + 8, 106), f'{title}　d={d:.0f}　軌道面 z={zt:.2f}', 15, COL['mute'])
        cv.begin_clip(x0, 100, x1, Y(zlo))
        cv.rect(x0, Y(0), x1, Y(zlo), fill=COL['soil'], alpha=140)
        cv.line([(x0, Y(0)), (x1, Y(0))], COL['ground'], 2)
        for zz in range(-20, 5, 5):
            cv.line([(x0, Y(zz)), (x0 + 8, Y(zz))], COL['mute'], 1)
            cv.text((x0 + 12, Y(zz)), f'{zz}', 12, COL['mute'], anchor='lm', halo=False)
        tops = sorted((round(z0, 3), min(s0, s1), max(s0, s1)) for s0, z0, s1, z1 in segs.get('ug_platform', [])
                      if abs(z0 - z1) < 2e-3 and abs(s1 - s0) > 1e-6)
        merged = []                       # 頂面被切成兩個三角形時，把相接的線段併成一段
        for zz, a, b in tops:
            if merged and merged[-1][0] == zz and a - merged[-1][2] < 2e-3:
                merged[-1][2] = max(merged[-1][2], b)
            else:
                merged.append([zz, a, b])
        for zz, a, b in merged:
            cv.rect(X(a), Y(zz), X(b), Y(zt), fill=COL['platform_fill'], alpha=255)
            cv.text(((X(a) + X(b)) / 2, Y(zz) - 8), f'月台頂 z={zz:.2f}（寬 {b - a:.2f} m）', 13, COL['platform_edge'], anchor='ms')
        b1z = sorted({round(z0, 3) for s0, z0, s1, z1 in segs.get('ug_b1', []) if abs(z0 - z1) < 2e-3 and abs(s1 - s0) > 1e-6})
        if len(b1z) >= 2:
            cv.text((cx, Y(b1z[-1]) - 10), f'B1 樓板（上緣 z={b1z[-1]:.2f}、下緣 z={b1z[0]:.2f}）', 14, matcol['ug_b1'], anchor='ms')
        for m, lst in segs.items():
            for s0, z0, s1, z1 in lst:
                cv.line([(X(s0), Y(z0)), (X(s1), Y(z1))], matcol.get(m, (0, 0, 0)), 3.0 if m != 'ug_shell' else 2.4)
        wall_t = val(P['station']['wallThicknessM']) if kind == 'station' else val(P['tunnel']['wallThicknessM'])
        vs = CK.vertical_s(segs.get('ug_shell', []))
        if len(vs) >= 2:
            (sw, zb, ztp), (se, zb2, ztp2) = vs[0], vs[-1]
            cv.line([(X(sw + wall_t), Y(zb)), (X(sw + wall_t), Y(ztp))], matcol['ug_shell'], 1.5, dash=(6, 5))
            cv.line([(X(se - wall_t), Y(zb2)), (X(se - wall_t), Y(ztp2))], matcol['ug_shell'], 1.5, dash=(6, 5))
            if kind == 'tunnel':
                rt = val(P['tunnel']['roofThicknessM'])
                cv.line([(X(sw + wall_t), Y(ztp - rt)), (X(se - wall_t), Y(ztp2 - rt))], matcol['ug_shell'], 1.5, dash=(6, 5))
            cv.line([(X(sw), Y(zb) + 14), (X(se), Y(zb) + 14)], COL['ink'], 1.5)
            cv.text(((X(sw) + X(se)) / 2, Y(zb) + 18), f'外寬 {se - sw:.2f} m（牆底 z={zb:.2f}，頂 z={ztp:.2f}）', 14, anchor='mt')
        if kind == 'trough' and len(CK.vertical_s(segs.get('ug_trough', []))) == 4:
            v4 = CK.vertical_s(segs['ug_trough'])
            cv.line([(X(v4[1][0]), Y(zt) + 30), (X(v4[2][0]), Y(zt) + 30)], COL['ink'], 1.5)
            cv.text(((X(v4[1][0]) + X(v4[2][0])) / 2, Y(zt) + 34), f'內寬 {v4[2][0] - v4[1][0]:.2f} m', 14, anchor='mt')
        east = np.array([t[1], -t[0]])
        for ln in track_lines:
            x = LineString([p0 - east * 60, p0 + east * 60]).intersection(ln)
            if x.is_empty or x.geom_type != 'Point':
                continue
            s = float((np.array([x.x, x.y]) - p0) @ east)
            cv.rect(X(s - 1.6), Y(zt + 4.5), X(s + 1.6), Y(zt), outline=(220, 40, 40), width=1.6)
            cv.circle((X(s), Y(zt)), 3, fill=(20, 20, 20))
        cv.end_clip()
        x_left = x1 + 50
    cv.save(path)
    return path
