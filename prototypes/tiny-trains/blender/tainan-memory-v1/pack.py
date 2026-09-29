"""把幾何打包成歷史重播頁的網格檔：Float32 交錯 stride 6（位置 3＋法線 3）、每種材質一個 drawGroup；
near／far／wrap 三個 LOD 各寫成 .mesh.bin.gz（gzip -9、不含時間戳），model.json 記錄未壓縮 .bin 的 SHA-256 與 drawGroups。
station 資料夾內不留未壓縮 .bin（封存驗證會比對檔案清單）。"""
import gzip
import hashlib
import json
import sys
from array import array
from pathlib import Path

from materials import MATS, NEAR_ORDER, WRAP_ORDER, srgb_to_linear

HERE = Path(__file__).resolve().parent
STATION_DIR = HERE.parent.parent.parent.parent / 'memories' / 'tainan-2026-09-12' / 'station'


def _collect(G, lods, order):
    by = {}
    for (mat, lod), buf in G.buf.items():
        if lod in lods:
            by.setdefault(mat, []).extend(buf)
    unknown = set(by) - set(order)
    assert not unknown, f'材質不在順序表：{unknown}'
    data = array('f')
    groups = []
    for mat in order:
        buf = by.get(mat)
        if not buf:
            continue
        start = len(data) // 6
        data.extend(buf)
        groups.append((mat, start, len(buf) // 6))
    return data, groups


def _bounds(data):
    xs, ys, zs = data[0::6], data[1::6], data[2::6]
    return [min(xs), min(ys), min(zs)], [max(xs), max(ys), max(zs)]


def _lod(G, lods, order, name, out_dir, wrap=False):
    data, groups = _collect(G, lods, order)
    if sys.byteorder != 'little':
        data.byteswap()
    raw = data.tobytes()
    gz = gzip.compress(raw, compresslevel=9, mtime=0)
    (out_dir / f'{name}.mesh.bin.gz').write_bytes(gz)
    old = out_dir / f'{name}.mesh.bin'
    if old.exists():
        old.unlink()
    if sys.byteorder != 'little':
        data.byteswap()
    draw = []
    for mat, start, count in groups:
        h, rough, metal, opacity, label = MATS[mat]
        g = {'component': '舊站房', 'name': mat, 'label': label, 'start': start, 'count': count,
             'color': srgb_to_linear(h), 'metalness': metal, 'roughness': rough}
        if wrap:
            g['opacity'] = opacity
        draw.append(g)
    lo, hi = _bounds(data)
    return {
        'file': f'{name}.mesh.bin',
        'sha256': hashlib.sha256(raw).hexdigest(),
        'strideBytes': 24,
        'vertexCount': len(data) // 6,
        'triangleCount': len(data) // 18,
        'byteLength': len(raw),
        'gzipBytes': len(gz),
        'bounds': {'min': lo, 'max': hi},
        'drawGroups': draw,
    }


def pack(G, W, station, out_dir=None):
    out_dir = Path(out_dir) if out_dir else STATION_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    base = {}
    mj = out_dir / 'model.json'
    if mj.exists():
        base = json.loads(mj.read_text(encoding='utf-8'))
    near = _lod(G, ('both', 'near'), NEAR_ORDER, 'near', out_dir)
    far = _lod(G, ('both', 'far'), NEAR_ORDER, 'far', out_dir)
    wrap = _lod(W, ('both', 'near', 'far'), WRAP_ORDER, 'wrap', out_dir, wrap=True)
    wrap['role'] = 'construction-wrap'
    wrap['defaultVisible'] = True
    wrap['doubleSided'] = False
    lo, hi = near['bounds']['min'], near['bounds']['max']
    comps = {}
    for (name, lod), n in G.tris.items():
        if lod in ('both', 'near'):
            comps[name] = comps.get(name, 0) + n
    base.update({
        'id': 'tainan-old',
        'name': '臺南舊站房',
        'kind': 'tainan-old',
        'anchor': base.get('anchor', [120.21250864666669, 22.99717456]),
        'rotationDeg': base.get('rotationDeg', -102),
        'osmId': 6477070,
        'osmType': 'relation',
        'priority': 1,
        'scope': ('1936 年舊站房外觀，2026-09-12 當天施工外罩可切換。依 OSM 平面輪廓、官方建築說明（文資局、臺鐵）與 2015–2026 公開照片的比例製作：'
                  '門廊三圓拱與雨庇（含階梯狀托架、白色藻井）、雨庇上方低山形壁與浮雕徽章牌、二樓 7 扇圓拱長窗（2＋3＋2，含窗框窗櫺與拱框）、'
                  '4 根壁柱（外側兩根半圓壁柱含尖飾）、簷下齒飾與菱形格紋、兩塊浮雕花帶牌、圓鐘、中央小山形壁、兩側行人入口與側雨庇、橫翼與一層延伸皆為實體幾何；'
                  '飾面以顏色區分暖灰面磚與米黃／土黃洗石子，不貼圖。外罩另存為獨立網格（wrap）。'
                  '樓高與局部比例為外觀估計，非測繪；不含 2015／2017 修復前的白漆、LED 電子鐘與屋頂「臺南車站」單字招牌。'),
        'snapshotDate': '2026-09-12',
        'estimatedHeightM': round(hi[2], 2),
        'sourcePhotosIncluded': False,
        'pendingChecks': [
            '高度依 2015 正立面照片比例換算，非測繪',
            '時鐘指針固定在 10:10 示意，非封存當刻時刻',
            '橫翼與一層延伸（後牆、端牆、窗位與高度）依 OSM 平面與照片 01、05 推估，未經實測',
            '兩側行人入口拱與側雨庇的位置與挑出量依照片 01–03 推定，未經實測',
            '外罩掛設範圍、高度、骨架間距與南側白色施工圍籬位置依 2026-01 照片 03、2025-05 照片 05 目測，非施工圖',
            '外牆色階（暖灰面磚、米黃與土黃洗石子）依鐵道局 2026-09-10 經聯合報轉述與 2026-01 照片目視校正，非色卡量測',
            '主棟右側牆與後牆的窗位由左側牆對稱推定，照片未涵蓋',
            '平面以軸向對齊的常數建模，橫翼端部與 OSM 輪廓（約 2° 歪斜）最大相差約 1.1 m；門廊雨庇寬度依照片為 18 m，OSM 輪廓為 16.4 m',
        ],
        'version': 2,
        'application': 'tainan-memory-v1/build.py（純 Python 幾何；Blender 5.2.1 LTS 僅供對照算圖）',
        'axes': {'up': '+Z', 'right': '+X', 'front': '-Y', 'units': 'meters', 'groundAnchor': [0, 0, 0]},
        'orientationMode': 'local-facade',
        'bounds': {'min': lo, 'max': hi},
        'sizeM': [round(hi[i] - lo[i], 3) for i in range(3)],
        'wrapBounds': wrap['bounds'],
        'lods': {'near': near, 'far': far, 'wrap': wrap},
        'operatorLogoIncluded': False,
        'modelUse': 'map-exterior',
        'components': [{'id': k, 'triangles': v} for k, v in sorted(comps.items(), key=lambda kv: -kv[1])],
    })
    for k in ('gltfAxes', 'nativeObjectCount'):
        base.pop(k, None)          # 舊版指向 GLB 與 Blender 物件數，本版不產生
    mj.write_text(json.dumps(base, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('PACK', json.dumps({k: {'tris': base['lods'][k]['triangleCount'], 'raw': base['lods'][k]['byteLength'], 'gz': base['lods'][k]['gzipBytes']} for k in base['lods']}), flush=True)
    return base
