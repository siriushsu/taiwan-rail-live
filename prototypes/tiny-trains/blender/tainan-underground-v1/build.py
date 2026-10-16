#!/usr/bin/env python3
"""臺南鐵路地下化第一階段的地下結構模型與列車高程剖面。

輸入：params.json（所有尺寸與標籤的唯一來源）、input/alignment.json（股道座標，由 extract_alignment.py 取出）、
      memories/tainan-2026-09-12/snapshot.json（9/12 快照的道路線，定位林森地下道與站體兩端用）。
輸出（--out 資料夾，必填；不在本資料夾留建置輸出）：
  near.mesh.bin.gz   Float32 交錯 stride 6（位置 3＋法線 3）、每種材質一個 drawGroup、gzip -9 mtime=0
  model.json         網格說明、drawGroups、params 原樣、cutouts、footprints
  profile.json       參考線、控制點、每段坡度與「任一點怎麼算 z」的說明
座標與 replay.js 的 world() 相同：x=(lon−120.21295)·111320·cos(22.99681°)、y=(lat−22.99681)·111320，單位公尺、z 向上，地面 z=0。
純 Python 3＋numpy＋shapely，不用 Blender（Blender 只在 preview_blender.py 預覽時用）。

用法：python3 build.py --out DIR
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True      # 不在本資料夾留 __pycache__

import numpy as np

import ug_core as C
import ug_materials as MAT
import ug_mesh as Mh

NEAR_BUDGET = {'maxTriangles': 60000, 'maxGzipBytes': 350000, 'maxDrawGroups': 16}
SPEC_MIN_TRI_AREA = 1e-6


def r3(v):
    return round(float(v), 3)


def ring3(ring):
    return [[r3(x), r3(y)] for x, y in ring]


def ccw(ring):
    return list(ring) if Mh.geo.signed_area(list(ring)) > 0 else list(ring)[::-1]


# ---------------------------------------------------------------- 組裝
def assemble(w):
    """回傳 (Mesh, info)。info 收集外框、剖面線數量等。"""
    M = Mh.Mesh()
    info = {'sections': {}}
    cp = w.cp
    tun_s = Mh.build_tunnel(M, w, cp['south-portal']['d'], cp['station-south']['d'], part='tunnel')
    tun_n = Mh.build_tunnel(M, w, cp['station-north']['d'], cp['north-portal']['d'], part='tunnel')
    tr_s = Mh.build_trough(M, w, cp['south-cut-outer']['d'], cp['south-portal']['d'], 'hi')
    tr_n = Mh.build_trough(M, w, cp['north-portal']['d'], cp['north-cut-outer']['d'], 'lo')
    Mh.build_station(M, w, info)
    D = w.dims
    ho, hi_ = D.tun_outer / 2, D.tun_inner / 2
    ro, ri = D.ramp_outer / 2, D.ramp_inner / 2
    info['sections'] = {'tunnel-south': tun_s, 'tunnel-north': tun_n, 'trough-south': tr_s, 'trough-north': tr_n}
    info['footprints'] = [
        {'id': 'tunnel-south', 'kind': 'tunnel', 'ring': ring3(ccw(tun_s.ring(-ho, ho)))},
        {'id': 'tunnel-north', 'kind': 'tunnel', 'ring': ring3(ccw(tun_n.ring(-ho, ho)))},
        {'id': 'station', 'kind': 'station', 'ring': ring3(info['outline'][:-1])},
        {'id': 'trough-south', 'kind': 'trough', 'ring': ring3(ccw(tr_s.ring(-ro, ro)))},
        {'id': 'trough-north', 'kind': 'trough', 'ring': ring3(ccw(tr_n.ring(-ro, ro)))},
    ]
    for k, p in enumerate(info['platforms']):
        info['footprints'].append({'id': f'platform-{k + 1}', 'kind': 'platform', 'name': p['name'], 'ring': ring3(p['ring'])})
    info['cutouts'] = [
        {'id': 'trough-south-inner', 'ring': ring3(ccw(tr_s.ring(-ri, ri)))},
        {'id': 'trough-north-inner', 'ring': ring3(ccw(tr_n.ring(-ri, ri)))},
    ]
    return M, info


# ---------------------------------------------------------------- 打包
def pack_mesh(M):
    by = {}
    for (mat, lod), buf in M.G.buf.items():
        by.setdefault(mat, []).extend(buf)
    unknown = sorted(set(by) - set(MAT.ORDER))
    if unknown:
        raise ValueError(f'材質不在順序表：{unknown}')
    chunks, groups, start = [], [], 0
    for mat in MAT.ORDER:
        buf = by.get(mat)
        if not buf:
            continue
        chunks.append(np.asarray(buf, dtype='<f4').reshape(-1, 6))
        groups.append((mat, start, len(buf) // 6))
        start += len(buf) // 6
    data = np.concatenate(chunks)
    return data, groups


def self_check(data):
    a = data.astype(np.float64)
    pos, nrm = a[:, :3].reshape(-1, 3, 3), a[:, 3:].reshape(-1, 3, 3)
    if not np.isfinite(a).all():
        raise ValueError('網格有 NaN／Inf')
    ln = np.linalg.norm(nrm, axis=2)
    if np.abs(ln - 1).max() > 1e-3:
        raise ValueError('法線不是單位長')
    if np.abs(nrm - nrm[:, :1, :]).max() > 1e-6:
        raise ValueError('同一面三個頂點的法線不一致')
    cr = np.cross(pos[:, 1] - pos[:, 0], pos[:, 2] - pos[:, 0])
    area = np.linalg.norm(cr, axis=1) / 2
    if area.min() < SPEC_MIN_TRI_AREA:
        raise ValueError(f'有退化三角形 {area.min():g}')
    agree = (cr / (2 * area)[:, None] * nrm[:, 0]).sum(axis=1)
    if agree.min() < 0.999:
        raise ValueError(f'繞序與法線不一致 {agree.min():g}')
    return {'minTriangleAreaM2': float(area.min()), 'maxNormalLengthError': float(np.abs(ln - 1).max()),
            'minWindingNormalDot': float(agree.min())}


def near_lod(M):
    data, groups = pack_mesh(M)
    check = self_check(data)
    raw = data.tobytes()                           # '<f4'：小端
    gz = gzip.compress(raw, compresslevel=9, mtime=0)
    lo, hi = data[:, :3].min(axis=0), data[:, :3].max(axis=0)
    draw = []
    for mat, start, count in groups:
        hexc, rough, metal, opacity, dbl, label = MAT.MATS[mat]
        g = {'name': mat, 'label': label, 'start': start, 'count': count, 'color': MAT.srgb_to_linear(hexc),
             'roughness': rough, 'metalness': metal}
        if opacity < 1.0:
            g['opacity'] = opacity
        if dbl:
            g['doubleSided'] = True
        draw.append(g)
    near = {'file': 'near.mesh.bin', 'sha256': hashlib.sha256(raw).hexdigest(), 'strideBytes': 24,
            'vertexCount': int(len(data)), 'triangleCount': int(len(data) // 3), 'byteLength': len(raw), 'gzipBytes': len(gz),
            'bounds': {'min': [float(v) for v in lo], 'max': [float(v) for v in hi]}, 'drawGroups': draw}
    return near, gz, check


# ---------------------------------------------------------------- profile.json
HOW_TO_Z = ('任一點 (x, y) 的軌道面高程 z（公尺，地面＝0）：'
            '(1) 把 (x, y) 投影到 reference.points 折線上離它最近的點，取該點的累計長度 d（投影落在兩端之外就取 0 或 lengthM）；'
            '(2) 在 controlPoints（依 d 遞增）找出 d0 ≤ d ≤ d1 的相鄰兩點，z = z0 + (z1 − z0) × (d − d0) / (d1 − d0)，'
            '控制點之間線性、沒有豎曲線，兩端之外取端點的 z。四股、引道兩股與隧道內的兩條正線共用同一條參考線與同一個 z(d)。'
            '地面段（d 在 south-cut-outer 之前、north-cut-outer 之後）z＝0。')


def make_profile(w):
    P = w.P
    ref = w.ref
    cps = []
    for c in w.profile.cps:
        x, y = ref.point(c['d'])
        cps.append({'id': c['id'], 'd': r3(c['d']), 'z': c['z'], 'label': c['label'], 'basis': c['basis'],
                    'xy': [r3(x), r3(y)]})
    segs = [{'from': s['from'], 'to': s['to'], 'd0': r3(s['d0']), 'd1': r3(s['d1']), 'lengthM': r3(s['lengthM']),
             'dz': s['dz'], 'slopePermille': round(s['slopePermille'], 3)} for s in w.profile.segments()]
    D = w.dims
    return {
        'schema': 'tainan-underground-profile/1',
        'id': 'tainan-underground-profile',
        'about': '臺南鐵路地下化第一階段的列車高程剖面；控制點的 label 與 basis 照抄 params.json。',
        'units': 'meters',
        'origin': list(C.ORIGIN),
        'axes': {'plan': 'x=(lon−origin_lon)·111320·cos(origin_lat)、y=(lat−origin_lat)·111320（與 replay.js world() 相同）',
                 'z': '軌道面高程，地面＝0，向上為正'},
        'meaning': P['profile']['meaning'],
        'interpolation': P['profile']['interpolation'],
        'howToComputeZ': HOW_TO_Z,
        'reference': {
            'ways': w.ref_ids,
            'lengthM': r3(ref.length),
            'points': [[r3(p[0]), r3(p[1]), r3(d)] for p, d in zip(ref.pts, ref.cum)],
            'wayRanges': {k: [r3(v[0]), r3(v[1])] for k, v in w.ref_range.items()},
        },
        'controlPoints': cps,
        'segments': segs,
        'maxAbsSlopePermille': round(max(abs(s['slopePermille']) for s in w.profile.segments()), 3),
        'derived': {
            'station': {'centerD': r3(w.st_center), 'southD': r3(w.st_south), 'northD': r3(w.st_north), 'lengthM': D.st_len,
                        'loopEndsD': {k: [r3(v[0]), r3(v[1])] for k, v in w.loop_ends_d.items()}},
            'platform': {'centerD': r3(w.pf_center), 'd0': r3(w.pf_d0), 'd1': r3(w.pf_d1), 'lengthM': D.pf_len,
                         'spacingRunsD': {k: [r3(v[0]), r3(v[1])] for k, v in w.pf_runs.items()},
                         'overlapD': [r3(w.pf_overlap[0]), r3(w.pf_overlap[1])]},
            'roadCrossingsD': {k: sorted(r3(x['d']) for x in v) for k, v in w.road_cross.items()},
        },
    }


# ---------------------------------------------------------------- model.json
def make_model(w, M, info, near):
    P = w.P
    D = w.dims
    comps = {}
    for (name, _lod), n in M.G.tris.items():
        comps[name] = comps.get(name, 0) + n
    lo, hi = near['bounds']['min'], near['bounds']['max']
    near_json = dict(near)
    near_json['bounds'] = {'min': [round(math.floor(v * 1e4) / 1e4, 4) for v in lo], 'max': [round(math.ceil(v * 1e4) / 1e4, 4) for v in hi]}
    secs = {k: v.n for k, v in info['sections'].items()}
    return {
        'id': 'tainan-underground',
        'name': '臺南鐵路地下化結構',
        'kind': 'tainan-underground',
        'version': 1,
        'snapshotDate': '2026-10-17',
        'scope': ('臺南鐵路地下化第一階段（2026-10-17 通車）的地下結構示意：南北引道 U 槽與洞口上方的牆、南洞口到站體南端與站體北端到北洞口的雙線隧道殼與地板、'
                  '臺南站站體（外牆、頂板、地板、B1 樓板）與兩座島式月台。'
                  '殼（隧道、站體）半透明，只畫外側面；地板、月台、U 槽不透明；B1 樓板半透明。'
                  '尺寸大多沒有公開數字，全部集中在 params 欄位，每個數字標了查到、二手、OSM 或估計；這是依 OSM 股道與估計尺寸畫的示意，不是竣工測繪。'
                  '沒做的項目見 params.notModeled。'),
        'application': 'tainan-underground-v1/build.py（純 Python 3＋numpy＋shapely；預覽用 Blender 5.2.1 背景模式）',
        'axes': {'up': '+Z', 'units': 'meters',
                 'plan': 'x=(lon−origin_lon)·111320·cos(origin_lat)、y=(lat−origin_lat)·111320（與 replay.js world() 相同）',
                 'groundAnchor': [0, 0, 0]},
        'origin': list(C.ORIGIN),
        'placement': {'position': [0, 0, 0], 'rotationDeg': 0},
        'bounds': near_json['bounds'],
        'lods': {'near': near_json},
        'budget': dict(NEAR_BUDGET),
        'profile': {'file': 'profile.json', 'maxAbsSlopePermille': None},
        'params': P,
        'cutouts': info['cutouts'],
        'footprints': info['footprints'],
        'footprintsNote': '所有 ring 都是世界座標 xy（公尺）、逆時針、不重複首點。tunnel＝隧道外框（外寬）；station＝站體外框；trough＝U 槽外框；platform＝月台頂面。cutouts＝U 槽內側範圍（地面要挖開的部分）。',
        'components': [{'id': k, 'triangles': v} for k, v in sorted(comps.items(), key=lambda kv: -kv[1])],
        'stats': {'rungs': secs, 'skippedDegenerateTriangles': M.skipped,
                  'station': {'centerD': r3(w.st_center), 'southD': r3(w.st_south), 'northD': r3(w.st_north),
                              'z': {k: r3(v) for k, v in info['z'].items()}},
                  'platformCenterD': r3(w.pf_center)},
        'modelUse': 'underground-structure',
    }


# ---------------------------------------------------------------- 主程式
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', required=True, help='輸出資料夾（必填）')
    args = ap.parse_args(argv)
    P = C.load_json(C.HERE / 'params.json')
    A = C.load_json(C.HERE / 'input' / 'alignment.json')
    S = C.load_json(C.SNAPSHOT)
    if A['source']['commit'] != P['alignment']['source']['commit']:
        raise ValueError('input/alignment.json 的 commit 與 params.json 不同：請重跑 extract_alignment.py')
    w = C.build_world(P, A, S)
    M, info = assemble(w)
    near, gz, chk = near_lod(M)
    profile = make_profile(w)
    model = make_model(w, M, info, near)
    model['profile']['maxAbsSlopePermille'] = profile['maxAbsSlopePermille']
    model['selfCheck'] = chk
    model['paramsSha256'] = hashlib.sha256((C.HERE / 'params.json').read_bytes()).hexdigest()
    model['alignmentSource'] = A['source']
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    stale = out / 'near.mesh.bin'
    if stale.exists():
        stale.unlink()
    (out / 'near.mesh.bin.gz').write_bytes(gz)
    (out / 'model.json').write_text(json.dumps(model, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    (out / 'profile.json').write_text(json.dumps(profile, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('BUILD', json.dumps({'triangles': near['triangleCount'], 'rawBytes': near['byteLength'], 'gzipBytes': near['gzipBytes'],
                               'drawGroups': len(near['drawGroups']), 'sha256': near['sha256'][:16],
                               'components': model['components'], 'maxSlopePermille': profile['maxAbsSlopePermille']}, ensure_ascii=False), flush=True)
    print('WROTE', out, flush=True)


if __name__ == '__main__':
    main()
