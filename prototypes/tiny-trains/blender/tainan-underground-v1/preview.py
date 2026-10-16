#!/usr/bin/env python3
"""預覽圖：對 build.py 的輸出算 Blender 背景算圖（preview_blender.py）與兩張平面／剖面圖（Pillow）。

用法：python3 preview.py OUT_DIR RENDER_DIR [--only 名稱,名稱…] [--no-blender]
  OUT_DIR     build.py --out 的資料夾（model.json、near.mesh.bin.gz、profile.json）
  RENDER_DIR  圖與中間檔（views.json、.npy）的輸出資料夾；放在建置暫存區，不放進本資料夾
Blender 只在背景模式（-b）執行；字型用系統的 CJK 字型，找不到就退回預設字型（中文會變方塊）。
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

import argparse
import json
import math
import subprocess
from pathlib import Path

import numpy as np
from shapely.geometry import Point, Polygon

import ug_out as U

BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'
HERE = U.HERE

# 預覽用的顏色（線性 RGB）；結構的顏色照 model.json 的 drawGroups
EXTRA = {
    'rail': dict(color=[0.012, 0.012, 0.014], roughness=0.5, opacity=1.0),
    'ground': dict(color=[0.20, 0.23, 0.18], roughness=1.0, opacity=0.22),
    'envelope': dict(color=[0.80, 0.08, 0.04], roughness=0.8, opacity=0.40),
}
RAIL_WIDTH_M = 0.45
RAIL_LIFT_M = 0.10
ENVELOPE_HALF_W_M = 1.6      # 與 check.py 的車輛限界相同
ENVELOPE_H_M = 4.5
ZS_OVERVIEW = 14.0           # 全線圖的 z 放大倍率


# ---------------------------------------------------------------- 三角形湯的小工具
def quad_tris(a, b, c, d):
    return [a, b, c, a, c, d]


def ribbon(pts_xyz, width, lift):
    """沿折線的扁帶（水平，寬 width），回傳頂點列表。"""
    p = np.asarray(pts_xyz, dtype=float)
    out = []
    for i in range(len(p) - 1):
        t = p[i + 1, :2] - p[i, :2]
        L = math.hypot(*t)
        if L < 1e-9:
            continue
        n = np.array([-t[1], t[0]]) / L * (width / 2)
        a0, a1 = p[i, :2] - n, p[i, :2] + n
        b0, b1 = p[i + 1, :2] - n, p[i + 1, :2] + n
        za, zb = p[i, 2] + lift, p[i + 1, 2] + lift
        out += quad_tris((*a0, za), (*a1, za), (*b1, zb), (*b0, zb))
    return out


def box_tris(c, tdir, half_w, half_l, z0, z1):
    """以 c 為中心、沿 tdir 方向的長方體（z0..z1），回傳頂點列表。"""
    t = np.asarray(tdir, dtype=float)
    n = np.array([-t[1], t[0]])
    cx, cy = c
    corners = [(cx - t[0] * half_l - n[0] * half_w, cy - t[1] * half_l - n[1] * half_w),
               (cx + t[0] * half_l - n[0] * half_w, cy + t[1] * half_l - n[1] * half_w),
               (cx + t[0] * half_l + n[0] * half_w, cy + t[1] * half_l + n[1] * half_w),
               (cx - t[0] * half_l + n[0] * half_w, cy - t[1] * half_l + n[1] * half_w)]
    out = []
    lo = [(x, y, z0) for x, y in corners]
    hi = [(x, y, z1) for x, y in corners]
    out += quad_tris(*hi)
    for i in range(4):
        j = (i + 1) % 4
        out += quad_tris(lo[i], lo[j], hi[j], hi[i])
    return out


def clip_tris(verts, p0, n):
    """把三角形湯（頂點列表）用平面裁切，保留 (P−p0)·n ≤ 0 的一側；回傳新的頂點列表。"""
    v = np.asarray(verts, dtype=float).reshape(-1, 3, 3)
    out = []
    for tri in v:
        dist = (tri - p0) @ n
        inside = dist <= 0
        if inside.all():
            out.extend(tri.tolist())
            continue
        if not inside.any():
            continue
        poly = []
        for i in range(3):
            a, b = tri[i], tri[(i + 1) % 3]
            da, db = dist[i], dist[(i + 1) % 3]
            if da <= 0:
                poly.append(a)
            if (da <= 0) != (db <= 0):
                poly.append(a + (b - a) * (da / (da - db)))
        for k in range(1, len(poly) - 1):
            out.extend([poly[0].tolist(), poly[k].tolist(), poly[k + 1].tolist()])
    return out


def ground_quad(x0, x1, y0, y1, z=0.0):
    return quad_tris((x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z))


# ---------------------------------------------------------------- 組一張圖要的資料
class Scene:
    def __init__(self, out, workdir):
        self.out = out
        self.dir = Path(workdir)
        self.quick = False
        self.ways = U.alignment_ways(out)
        self.params = out.params
        al = self.params['alignment']
        self.main_chain = [self.ways[i] for i in al['referenceChain']['ways']]
        self.east_chain = [self.ways[i] for i in al['eastChain']]
        self.loops = [self.ways[al['stationLoops']['west']], self.ways[al['stationLoops']['east']]]

    def track_xyz(self, pts, step=2.0):
        """股道折線補點（每 step 公尺），z 由 profile.json 查。"""
        samples = U.sample_polyline(pts, step)
        return [(x, y, self.out.z_of_xy((x, y))) for x, y, _ in samples]

    def tracks(self, d0, d1):
        """d0..d1（參考線上）範圍內的股道扁帶：兩條主線（整條鏈）＋兩條外側股道。"""
        verts = []
        for chain in (self.main_chain, self.east_chain):
            pts = np.vstack([c if i == 0 else c[1:] for i, c in enumerate(chain)])
            xyz = [p for p in self.track_xyz(pts) if d0 <= self.out.project_d(p[:2]) <= d1]
            verts += ribbon(xyz, RAIL_WIDTH_M, RAIL_LIFT_M)
        for lp in self.loops:
            xyz = [p for p in self.track_xyz(lp) if d0 <= self.out.project_d(p[:2]) <= d1]
            verts += ribbon(xyz, RAIL_WIDTH_M, RAIL_LIFT_M)
        return verts

    def compose(self, name, extras, clip=None, zscale=1.0, skip=()):
        """結構（可選：平面裁切）＋額外的群，寫成 .npy，回傳 (路徑, groups)。extras＝[(群名, 材質鍵, 頂點列表)]。"""
        out = self.out
        parts, groups, start = [], [], 0
        for g in out.groups:
            if g['name'] in skip:
                continue
            verts = out.tris[g['start'] // 3:(g['start'] + g['count']) // 3].reshape(-1, 3)
            if clip is not None:
                verts = np.array(clip_tris(verts, clip[0], clip[1])).reshape(-1, 3)
            if len(verts) == 0:
                continue
            parts.append(verts)
            groups.append({'name': g['name'], 'color': g['color'], 'roughness': g['roughness'],
                           'opacity': g.get('opacity', 1.0), 'start': start, 'count': len(verts)})
            start += len(verts)
        for gname, key, verts in extras:
            if clip is not None and key != 'ground':
                verts = clip_tris(verts, clip[0], clip[1])
            verts = np.asarray(verts, dtype=float).reshape(-1, 3)
            if len(verts) == 0:
                continue
            parts.append(verts)
            e = EXTRA[key]
            groups.append({'name': gname, 'color': e['color'], 'roughness': e['roughness'], 'opacity': e['opacity'],
                           'start': start, 'count': len(verts)})
            start += len(verts)
        allv = np.vstack(parts)
        allv = allv * np.array([1.0, 1.0, zscale])
        arr = np.zeros((len(allv), 6), dtype=np.float32)
        arr[:, :3] = allv
        path = self.dir / f'{name}.npy'
        np.save(path, arr)
        return str(path), groups


def heading_deg(t):
    """方向向量的羅盤方位角（北＝0、東＝90）。"""
    return math.degrees(math.atan2(t[0], t[1])) % 360


def envelope_boxes(scene, d_cut, half_l=0.15):
    """剖面圖用：切面位置附近每股道一個薄薄的車輛限界方塊。"""
    out = scene.out
    verts = []
    p0 = out.ref_point(d_cut)
    tracks = [np.vstack([c if i == 0 else c[1:] for i, c in enumerate(scene.main_chain)]),
              np.vstack([c if i == 0 else c[1:] for i, c in enumerate(scene.east_chain)])] + list(scene.loops)
    t = out.ref_tangent(d_cut)
    for pts in tracks:
        ls = U.LineString(pts)
        # 切面（過 p0、垂直於 t）與股道折線的交點
        q = U.LineString([p0 - np.array([-t[1], t[0]]) * 60, p0 + np.array([-t[1], t[0]]) * 60]).intersection(ls)
        if q.is_empty or q.geom_type != 'Point':
            continue
        z = out.z_of_xy((q.x, q.y))
        verts += box_tris((q.x, q.y), t, ENVELOPE_HALF_W_M, half_l, z, z + ENVELOPE_H_M)
    return verts


# ---------------------------------------------------------------- 視角
def build_views(scene, only):
    out = scene.out
    prof = out.profile
    st = prof['derived']['station']
    pf = prof['derived']['platform']
    cps = out.cp
    views = []

    def add(name, size, camera, extras, clip=None, zscale=1.0, samples=40, sun=(-0.4, -0.5, 0.8), skip=(), strength=1.0):
        if only and name not in only:
            return
        if scene.quick:
            samples, size = min(samples, 12), [size[0] // 2, size[1] // 2]
        mesh, groups = scene.compose(name, extras, clip=clip, zscale=zscale, skip=skip)
        views.append({'name': name, 'out': str(scene.dir / f'{name}.png'), 'size': size, 'samples': samples,
                      'mesh': mesh, 'groups': groups, 'camera': camera, 'sun': list(sun), 'strength': strength})

    # 01 全線斜視：從東側看、z 放大 ZS_OVERVIEW 倍（隧道只有 14 m 寬，不放大就看不出深度），地面半透明
    d_lo, d_hi = cps['south-cut-outer']['d'], cps['north-cut-outer']['d']
    mid = out.ref_point((d_lo + d_hi) / 2)
    chord = out.ref_xy[-1] - out.ref_xy[0]
    zs = ZS_OVERVIEW
    gx0, gx1 = min(out.ref_xy[:, 0]) - 300, max(out.ref_xy[:, 0]) + 300
    gy0, gy1 = out.ref_xy[:, 1].min() + 100, out.ref_xy[:, 1].max() - 100
    add('01-line-overview', [2400, 900],
        dict(target=[mid[0], mid[1], -9 * zs], azimuth=heading_deg(chord) + 90, elevation=26, distance=9000, ortho=7900),
        [('rail', 'rail', scene.tracks(d_lo - 50, d_hi + 50)), ('ground', 'ground', ground_quad(gx0, gx1, gy0, gy1))],
        zscale=zs, samples=32)

    # 02a 站體全長（較陡的俯視，隔著半透明殼看平面形狀與月台位置）
    sc_ = out.ref_point(st['centerD'])
    hs = heading_deg(out.ref_tangent(st['centerD']))
    add('02a-station-overview', [2400, 700],
        dict(target=[sc_[0], sc_[1], -10], azimuth=hs + 90, elevation=62, distance=1500, ortho=780),
        [('rail', 'rail', scene.tracks(st['southD'] - 60, st['northD'] + 60))], samples=32)

    # 02 月台南端近景（從東側橫看：殼、B1 樓板、月台、地板由上到下的層次）
    pc = out.ref_point(pf['centerD'])
    pe = out.ref_point(pf['d0'] + 40)
    add('02-station-closeup', [1800, 1000],
        dict(target=[pe[0], pe[1], -14], azimuth=heading_deg(out.ref_tangent(pf['d0'] + 40)) + 80, elevation=32, distance=75, lens=30),
        [('rail', 'rail', scene.tracks(pf['d0'] - 80, pf['d0'] + 160))], samples=48)

    # 02c 同一站體拿掉殼與 B1，只看地板、月台、股道（驗殼與地板有沒有互相穿插）
    add('02c-station-parts', [1800, 1000],
        dict(target=[pc[0], pc[1], -16], azimuth=hs + 60, elevation=38, distance=120, lens=30),
        [('rail', 'rail', scene.tracks(pf['centerD'] - 100, pf['centerD'] + 100))], skip=('ug_b1', 'ug_shell'), samples=48)

    # 02d／02e 站體兩端：隧道接進端牆的洞口（開孔、牆、地板的交界）
    for key, d, flip in (('02d-station-south-end', st['southD'] + 10, 180 - 35), ('02e-station-north-end', st['northD'] - 10, 35)):
        p = out.ref_point(d)
        h = heading_deg(out.ref_tangent(d))
        add(key, [1800, 1000],
            dict(target=[p[0], p[1], -14], azimuth=h + flip, elevation=32, distance=140, lens=30),
            [('rail', 'rail', scene.tracks(d - 100, d + 100))], samples=48)

    # 03 站體剖面：在月台中心用垂直於參考線的平面切開，留南半邊，從北偏東斜向俯視切口與內部
    pcut = out.ref_point(pf['centerD'])
    tcut = out.ref_tangent(pf['centerD'])
    tgt = pcut - tcut * 10
    add('03-station-section', [1800, 1000],
        dict(target=[tgt[0], tgt[1], -11], azimuth=heading_deg(tcut) + 14, elevation=14, distance=80, lens=55),
        [('rail', 'rail', scene.tracks(pf['centerD'] - 130, pf['centerD'] + 130)),
         ('envelope', 'envelope', envelope_boxes(scene, pf['centerD']))],
        clip=(np.array([pcut[0], pcut[1], 0.0]), np.array([tcut[0], tcut[1], 0.0])), samples=64)

    # 04 北洞口（U 槽向北開口，從北方斜看）
    pn = out.ref_point(cps['north-portal']['d'])
    hn = heading_deg(out.ref_tangent(cps['north-portal']['d']))
    add('04-north-portal', [1800, 1000],
        dict(target=[pn[0], pn[1], -3], azimuth=hn + 28, elevation=28, distance=105, lens=36),
        [('rail', 'rail', scene.tracks(cps['north-portal']['d'] - 80, cps['north-cut-outer']['d'] + 20)),
         ('ground', 'ground', ground_quad(pn[0] - 220, pn[0] + 220, pn[1] - 220, pn[1] + 220))], samples=48)

    # 05 南洞口（U 槽向南開口，從南方斜看）
    ps = out.ref_point(cps['south-portal']['d'])
    hso = heading_deg(out.ref_tangent(cps['south-portal']['d']))
    add('05-south-portal', [1800, 1000],
        dict(target=[ps[0], ps[1], -3], azimuth=hso + 180 - 28, elevation=28, distance=125, lens=36),
        [('rail', 'rail', scene.tracks(cps['south-cut-outer']['d'] - 20, cps['south-portal']['d'] + 80)),
         ('ground', 'ground', ground_quad(ps[0] - 260, ps[0] + 260, ps[1] - 260, ps[1] + 260))], samples=48)
    return views


def run_blender(views, workdir):
    vj = Path(workdir) / 'views.json'
    vj.write_text(json.dumps(views, ensure_ascii=False), encoding='utf-8')
    cmd = [BLENDER, '-b', '--factory-startup', '--python', str(HERE / 'preview_blender.py'), '--', str(vj)]
    log = Path(workdir) / 'blender.log'
    with open(log, 'w', encoding='utf-8') as f:
        r = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT)
    print('blender exit', r.returncode, 'log', log, flush=True)
    return r.returncode


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('renders')
    ap.add_argument('--only', default='')
    ap.add_argument('--no-blender', action='store_true')
    ap.add_argument('--quick', action='store_true', help='取樣數與解析度減半以下（調視角用）')
    ap.add_argument('--figs', default='plan,profile,section', help='要畫的 Pillow 圖（逗號分隔；空字串＝不畫）')
    a = ap.parse_args()
    Path(a.renders).mkdir(parents=True, exist_ok=True)
    out = U.Out(a.out)
    scene = Scene(out, a.renders)
    scene.quick = a.quick
    only = [s for s in a.only.split(',') if s]
    views = build_views(scene, only)
    import preview_figs as PF
    figs = [f for f in a.figs.split(',') if f]
    for name, fn, fname in (('plan', PF.plan_figure, '06-plan-overlay.png'), ('profile', PF.profile_figure, '07-profile.png'),
                            ('section', PF.section_figure, '08-section.png')):
        if name in figs:
            print('FIG', fn(out, str(Path(a.renders) / fname)), flush=True)
    if not a.no_blender and views:
        rc = run_blender(views, a.renders)
        if rc:
            sys.exit(rc)


if __name__ == '__main__':
    main()
