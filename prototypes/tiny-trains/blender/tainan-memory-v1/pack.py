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
    wrap['doubleSided'] = True          # 第三輪：頁面對 wrap 全部材質用 THREE.DoubleSide（replay.js 讀這個旗標）；不重複三角形
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
                  '凸字形量體——一層前廳（含三圓拱門廊）往前凸出，前廳頂是平台（含女兒牆），二樓正面與兩側牆片退在後面；'
                  '門廊三圓拱與兩個圓窗、出挑雨庇（含階梯狀托架、彎弧渦形托架、白色藻井、前緣線腳）、門廊屋頂上的低山形壁與浮雕徽章牌、'
                  '二樓 7 扇圓拱長窗（2＋3＋2，含窗框窗櫺與拱框）、4 根壁柱（外側兩根半圓壁柱含尖飾）、簷下齒飾與菱形格紋、兩塊浮雕花帶牌、圓鐘、中央小山形壁、'
                  '前廳兩側外牆的行人入口大圓拱與長雨庇、橫翼與一層延伸皆為實體幾何；'
                  '飾面以顏色區分暖灰面磚與米黃／土黃洗石子，不貼圖。外罩（半透明布面、鷹架鋼管、骨架與接縫、前方 L 形施工圍籬）另存為獨立網格（wrap）；'
                  '布面頂有一圈水平收口接到二樓女兒牆頂外緣（不蓋屋面），山形壁與屋頂尖飾另有一個緊貼的小頂罩，布面雙面繪製。'
                  '樓高與局部比例為外觀估計，非測繪；不含 2015／2017 修復前的白漆、LED 電子鐘與屋頂「臺南車站」單字招牌。'),
        'snapshotDate': '2026-09-12',
        'estimatedHeightM': round(hi[2], 2),
        'sourcePhotosIncluded': False,
        'pendingChecks': [
            '高度依 2015 正立面照片比例換算（二樓面 14.53 px/m），非測繪：長窗拱頂 10.32 m、屋面 12.0 m、女兒牆頂 12.5 m；'
            '一樓平台 5.40 m（女兒牆頂 5.80 m）、門廊雨庇底 3.66 m、雨庇頂 4.06 m、門廊屋頂簷口頂 4.55 m 由照片 02、03 反投影推定；門廊兩個圓窗中心高 2.60 m（照片 01 量到 2.70 m，照片 02、03 的預測在 2.60–2.65 m 最小；圓窗半徑 0.5 m 未量）',
            '時鐘指針固定在 10:10 示意，非封存當刻時刻；圓鐘位置（中心高 10.87 m）依官方描述「中央長窗上方嵌圓鐘」推定——照片 01、02 中央都是 LED 電子鐘，沒有一張照片看得到圓鐘本體',
            '門廊前牆到二樓正面的距離 PP=9.0 m 是推定（common.PP，改一個數字即可）：照片 02 以七扇長窗定相機後，PP=9 時 13 個門廊／雨庇／側拱特徵最大誤差 7.7 px（f≈1200；f 1120–1280 皆 ≤20 px），'
            'PP=6 時不論 f 取多少最佳也有 48 px；需文資局平面圖或現場丈量確認。PP=9 時外罩正面離二樓正面 4.3 m（一般鷹架約 1–1.5 m）',
            'OSM 平面輪廓（航照描邊）的前廳兩側牆片前緣在 Y≈-10.7…-11.1（左）與斜邊至 (12.4, -10.0)（右），模型的兩側牆片與二樓正面同在 Y2（PP=9 時 -3.3）；'
            '照片 01、02 只看得出二樓正面退在門廊之後，一樓牆片前後位置未能由照片確認',
            '門廊中軸取二樓中軸 X=-0.3（左右對稱）：照片 01 的視差（門廊軸 334.5 px、二樓軸 350.2 px）解釋成兩軸重合，OSM 門廊輪廓中心在 -1.3。'
            '照片 02 上 XPC 與 PP 互相抵銷（XPC=-1.45 要配 PP≈10.1 才對得上，最大 22 px），單靠照片分不開',
            '門廊寬 16.4 m（5 開間×3.28 m）與 OSM 一致；主雨庇 X -6.65…6.0（長 12.65 m）、出挑 2.95 m 由照片 01–03 反投影（右端照片 02＋03 雙視角交會，左端照片 01 給 -6.7；照片 02 看到的「雨庇左端」其實是端面與牆的接縫）',
            '門廊屋頂上的山形壁站在簷口頂（底 4.55 m、緣 +0.85 m、脊 +1.22 m），依照片 01 山形壁底 4.6 m 與照片 02、03 門廊左右角 4.47–4.70 m 推定；門廊上層牆與簷口高度同為推定',
            '橫翼與一層延伸（後牆、端牆、窗位與高度）依 OSM 平面與照片 01、05 推估，未經實測；右翼（x 12.4–25.8）窗距 4.2 m 是推定，照片 01 右翼露出的窗距約 2.6–3.2 m，與模型不同，依派工指示未改',
            '兩側行人入口大圓拱（拱心 Y=-7.35、離門廊前牆 4.95 m，拱頂 3.2 m）與側雨庇（沿前廳側牆全長、挑出 3.1 m）的位置與尺寸依照片 02、03 反投影推定，未經實測，位置與 PP 連動',
            '外罩掛設範圍、高度、骨架間距與南側白色施工圍籬位置依 2026-01 照片 03、2025-05 照片 05 目測，非施工圖；南側（+X）圍籬只做地面層的 L 形（正面短段與側邊長段）',
            '外罩正面在門廊前牆外 4.7 m、離二樓兩端牆 1.1 m：照片 03 的外廓（頂邊兩條直線、左緣）與門廊特徵聯合擬合，在 4.4–5.0 m、0.6–1.1 m 之間都相容（外廓 rms 3.2–4.7 px），定不出更細；'
            '只用外廓時相機高度貼到擬合上界、門廊特徵誤差高達 31 px（欠定）',
            '外罩布面頂 12.6 m（貼齊女兒牆頂 12.5＋0.1）：照片 03 頂邊線在可能的外罩平面下反推 11.7–12.3 m（±0.5）；'
            '布面頂往內有水平收口（接到二樓女兒牆頂外緣，只蓋布面與建築之間的空隙，不蓋屋面），另有一個緊貼山形壁與屋頂尖飾（13.4–13.8 m）的小頂罩（X −6.37…5.77、Y −4.06…−2.80、頂 14.15 m，退在布面前壁後方）——'
            '收口與頂罩是為了讓頁面 40° 俯視時二樓正面、山形壁與尖飾不從布面頂上露出；照片 03 從地面（仰角約 20–30°）看被布面頂邊擋住，收口與頂罩的存在、形狀與高度都是推定，未驗證',
            '外罩布面下緣 5.95 m 由平台女兒牆頂 5.80 m 決定；照片 03 下緣反投影 5.1–5.5 m（聯合擬合 5.15–5.42、只用外廓 5.5–5.7），模型偏高 0.5–0.85 m（約 15–30 px）。'
            '要貼近照片就得把平台女兒牆縮小（PAR_S≈0.5，頂 5.64 m）並把下緣降到約 5.75 m，或把外罩正面移離平台',
            '外牆色階（暖灰面磚、米黃與土黃洗石子）依聯合報 2026-09-10 報導的記者敘述與 2026-01 照片目視校正，非色卡量測',
            '主棟右側牆與後牆的窗位由左側牆對稱推定，照片未涵蓋',
            '平面以軸向對齊的常數建模，橫翼端部與 OSM 輪廓（約 2° 歪斜）最大相差約 1.1 m；OSM 是航照描邊，屋簷視差可能讓輪廓偏 1 m 以上',
        ],
        'version': 3,
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
