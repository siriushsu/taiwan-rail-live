"""讀 build.py 的輸出（model.json、near.mesh.bin.gz、profile.json）與股道座標的小工具，給 check.py 和 preview.py 共用。

這支刻意不 import ug_core / ug_mesh（build 端的程式）：check 要驗的是輸出檔，不是 build 的內部狀態。
座標公式與重播頁 replay.js 的 world() 相同，原點常數照 model.json 的 origin。
"""
from __future__ import annotations

import gzip
import json
import math
from pathlib import Path

import numpy as np
from shapely.geometry import LineString, Point

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
SNAPSHOT = REPO / 'memories' / 'tainan-2026-09-12' / 'snapshot.json'
OLD_STATION = HERE.parent / 'tainan-memory-v1' / 'station-footprint.json'
CATALOG = REPO / 'memories' / 'tainan-2026-09-12' / 'fleet' / 'catalog.json'     # 9/12 重播頁的車輛目錄（只讀）


def load_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


class Proj:
    def __init__(self, origin):
        self.lon0, self.lat0 = origin
        self.kx = 111320.0 * math.cos(math.radians(self.lat0))
        self.ky = 111320.0

    def __call__(self, lon, lat):
        return ((lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky)


class Out:
    """一個輸出資料夾的內容。mesh 是 float32 [N,6]（位置＋法線），tris 是 float64 [T,3,3]。"""

    def __init__(self, outdir):
        self.dir = Path(outdir)
        self.model = load_json(self.dir / 'model.json')
        self.profile = load_json(self.dir / 'profile.json')
        self.params = load_json(HERE / 'params.json')
        self.near = self.model['lods']['near']
        gz_path = self.dir / 'near.mesh.bin.gz'
        self.gz_bytes = gz_path.stat().st_size
        self.raw = gzip.decompress(gz_path.read_bytes())
        self.mesh = np.frombuffer(self.raw, dtype='<f4').reshape(-1, 6)
        self.proj = Proj(self.model['origin'])
        a = self.mesh.astype(np.float64)
        self.tris = a[:, :3].reshape(-1, 3, 3)
        self.nrm = a[:, 3:].reshape(-1, 3, 3)[:, 0, :]
        self.groups = self.near['drawGroups']
        self.mat = np.empty(len(self.tris), dtype=object)
        for g in self.groups:
            self.mat[g['start'] // 3:(g['start'] + g['count']) // 3] = g['name']
        pts = np.array(self.profile['reference']['points'], dtype=float)
        self.ref_xy, self.ref_d = pts[:, :2], pts[:, 2]
        self.ref_ls = LineString(self.ref_xy)
        cps = self.profile['controlPoints']
        self.cp = {c['id']: c for c in cps}
        self.cp_d = np.array([c['d'] for c in cps])
        self.cp_z = np.array([c['z'] for c in cps])

    # 參考線上的位置 -----------------------------------------------------
    def project_d(self, xy):
        """(x, y) 投影到 profile.json 參考線的累計長度。投影在兩端之外時 shapely 取端點。"""
        return float(self.ref_ls.project(Point(float(xy[0]), float(xy[1]))))

    def ref_point(self, d):
        d = float(min(max(d, 0.0), self.ref_d[-1]))
        i = int(np.searchsorted(self.ref_d, d, side='right')) - 1
        i = min(max(i, 0), len(self.ref_d) - 2)
        t = (d - self.ref_d[i]) / (self.ref_d[i + 1] - self.ref_d[i])
        return self.ref_xy[i] + t * (self.ref_xy[i + 1] - self.ref_xy[i])

    def ref_tangent(self, d):
        d = float(min(max(d, 0.0), self.ref_d[-1]))
        i = int(np.searchsorted(self.ref_d, d, side='right')) - 1
        i = min(max(i, 0), len(self.ref_d) - 2)
        v = self.ref_xy[i + 1] - self.ref_xy[i]
        return v / np.hypot(v[0], v[1])

    def z_of_d(self, d):
        """profile.json 控制點之間線性內插（兩端之外取端點）。"""
        return float(np.interp(d, self.cp_d, self.cp_z))

    def z_of_xy(self, xy):
        return self.z_of_d(self.project_d(xy))


def formation_lengths(catalog=None):
    """各編組的整列車長度（公尺）＝編組裡每節車的連結器間距 pitchM 加總。
    這是重播頁 replay.js arrange() 的排法：每節用該車型的 pitchM 首尾相接、以編組中心為基準置中（catalog.json 的 meshes[mesh].pitchM、
    formations[id].cars[].mesh）。車頭鼻端凸出 pitch 邊界的量不計（nose_overhang 欄位另外回報：(extentM − pitchM)/2，取編組兩端那兩節的較大者）。
    回傳 [{id, name, cars, lengthM, nose_overhang}]，由長到短。"""
    cat = catalog if catalog is not None else load_json(CATALOG)
    meshes = cat['meshes']
    rows = []
    for fid, f in cat['formations'].items():
        cars = f['cars']
        missing = sorted({c['mesh'] for c in cars} - set(meshes))
        if missing:
            raise ValueError(f'編組 {fid} 用到目錄裡沒有的車型：{missing}')
        ends = (meshes[cars[0]['mesh']], meshes[cars[-1]['mesh']])
        rows.append({'id': fid, 'name': f['name'], 'cars': len(cars), 'lengthM': float(sum(meshes[c['mesh']]['pitchM'] for c in cars)),
                     'nose_overhang': float(max((m['extentM'] - m['pitchM']) / 2 for m in ends))})
    return sorted(rows, key=lambda r: -r['lengthM'])


def alignment_ways(out):
    """input/alignment.json 的各 way：{id: Nx2 世界座標}。"""
    A = load_json(HERE / 'input' / 'alignment.json')
    return {w['id']: np.array([out.proj(*c) for c in w['coordinates']]) for w in A['ways']}


def sample_polyline(pts, step):
    """沿折線每 step 公尺取一點（含兩端；另外保留每個折點，讓取樣不會跨過折角）。回傳 [(x, y, s)]。"""
    pts = np.asarray(pts, dtype=float)
    seg = np.hypot(*np.diff(pts, axis=0).T)
    cum = np.concatenate(([0.0], np.cumsum(seg)))
    n = max(1, int(math.ceil(cum[-1] / step)))
    ss = sorted(set(list(np.linspace(0.0, cum[-1], n + 1)) + list(cum)))
    out = []
    for s in ss:
        i = min(int(np.searchsorted(cum, s, side='right')) - 1, len(seg) - 1)
        p = pts[i] + (pts[i + 1] - pts[i]) * ((s - cum[i]) / seg[i])
        out.append((float(p[0]), float(p[1]), float(s)))
    return out
