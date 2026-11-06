#!/usr/bin/env python3
"""把 build_doors.py 的輸出（raw.bin + meta.json）併入正式資產
rail-3d/assets/garage-blender-v1/emu3000.{json,bin.gz}。

只做欄位合併，不重新產生幾何：
  - mesh.sha256 / mesh.vertexCount / mesh.triangleCount  ← 全部換成新算出的值
  - mesh.drawGroups                                      ← 以 build 輸出為準，材質名過 night_lamp_name
  - 新增頂層 doors 欄位（原資產沒有這個鍵）
  - bounds、sizeM、頭燈位置、specification 跟著新車殼更新，其餘欄位原封不動搬過去
不觸碰 emu3000.webp，不呼叫 import_garage_blender.py（它會重跑全部 62 款）。

用法（頭車）：
  python3 scripts/blender/emu3000-doors-20260924/install_assets.py [build目錄=output/emu3000-doors/build]

用法（中間車／集電弓零件庫，Task 5，新增）：
  python3 scripts/blender/emu3000-doors-20260924/install_assets.py mid [build目錄=output/emu3000-doors/build-mid]
  python3 scripts/blender/emu3000-doors-20260924/install_assets.py pantograph [build目錄=output/emu3000-doors/build-pantograph]

用法（已裝好的 emu3000、emu3000-mid 改成車隊精修的燈材質名，可重跑）：
  python3 scripts/blender/emu3000-doors-20260924/install_assets.py normalize
"""
import sys, gzip, hashlib, json, array
from pathlib import Path

W = Path(__file__).resolve().parents[3]  # repo 根目錄（scripts/blender/<本目錄>/<本檔>）
_MODE = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] in ('mid', 'pantograph', 'normalize') else None
_PATH_ARG = sys.argv[2] if _MODE and len(sys.argv) > 2 else (sys.argv[1] if not _MODE and len(sys.argv) > 1 else None)
_DEFAULT_BUILD = {'mid': 'build-mid', 'pantograph': 'build-pantograph'}.get(_MODE, 'build')
BUILD_DIR = Path(_PATH_ARG) if _PATH_ARG else (W / 'output/emu3000-doors' / _DEFAULT_BUILD)
ASSET_DIR = W / 'rail-3d/assets/garage-blender-v1'
ASSET_JSON = ASSET_DIR / 'emu3000.json'
ASSET_BIN_GZ = ASSET_DIR / 'emu3000.bin.gz'
END_WALL_X = -4.8  # 頭車後端端牆的平面，車長一半



def night_lamp_name(name):
    """build_doors.py 把發光材質叫 railLight:<位置>:<材質>；正式資產改用車隊精修與夜燈的材質名
    （三個平台的車燈只認 lamp、taillamp、glass）：尾燈位置（tail*）一律 taillamp，其餘取最後一段。
    發光位置仍留在 drawGroups[].lightingRole（garage-doors.js 用 window 找窗燈）。"""
    if not name.startswith('railLight:'):
        return name
    _, role, material = name.split(':', 2)
    return 'taillamp' if role.startswith('tail') else material


def normalize_doors(doors):
    for item in doors['items']:
        for r in item['ranges']:
            r['group'] = night_lamp_name(r['group'])
    return doors


def flat_end_wall(raw):
    """端牆是平的，但布林切門後法向量會跟車殼一起抹平，整面出現放射狀明暗，車側靠端牆那一條也會有斑。
    端牆整面改回朝後；車側碰到端牆的角改用該三角形自己的朝向。"""
    a = array.array('f')
    a.frombytes(raw)
    count = 0
    for v in range(0, len(a) // 6, 3):
        ks = [(v + i) * 6 for i in range(3)]
        on = [k for k in ks if abs(a[k] - END_WALL_X) < 1e-4]
        if len(on) == 3:
            for k in ks:
                a[k + 3:k + 6] = array.array('f', (-1., 0., 0.))
            count += 1
        elif on:
            p0, p1, p2 = ([a[k + i] for i in range(3)] for k in ks)
            e1 = [p1[i] - p0[i] for i in range(3)]
            e2 = [p2[i] - p0[i] for i in range(3)]
            n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
            l = sum(c * c for c in n) ** .5
            if l > 1e-9 and abs(n[0]) / l < .3:
                for k in on:
                    a[k + 3:k + 6] = array.array('f', [c / l for c in n])
    if not count:
        sys.exit('找不到端牆三角形')
    return a.tobytes()


def install_head_car():
    """頭車：把 build 輸出併進正式資產。"""
    raw_path = BUILD_DIR / 'emu3000-doors.raw.bin'
    meta_path = BUILD_DIR / 'emu3000-doors.meta.json'
    if not raw_path.exists() or not meta_path.exists():
        sys.exit(f'找不到 build 輸出：{raw_path} 或 {meta_path}（先跑 build_doors.py）')

    raw = raw_path.read_bytes()
    meta = json.loads(meta_path.read_text(encoding='utf-8'))

    # 完整性檢查：raw.bin 的 sha256 要跟 meta.json 宣告的一致，避免併入損毀/過期的中繼檔
    raw_sha = hashlib.sha256(raw).hexdigest()
    if raw_sha != meta['sha256']:
        sys.exit(f'raw.bin sha256 與 meta.json 不符：raw={raw_sha} meta={meta["sha256"]}（build 輸出可能過期，重跑 build_doors.py）')

    if not ASSET_JSON.exists():
        sys.exit(f'找不到既有資產：{ASSET_JSON}')
    asset = json.loads(ASSET_JSON.read_text(encoding='utf-8'))
    raw = flat_end_wall(raw)
    raw_sha = hashlib.sha256(raw).hexdigest()

    # 2026-11-06 起車殼整個重建，材質與群組以 build 輸出為準
    merged_groups = [{**g, 'name': night_lamp_name(g['name'])} for g in meta['drawGroups']]

    asset['mesh'] = dict(asset['mesh'])  # 淺拷貝，避免動到讀進來的物件被後面覆寫搞混
    asset['mesh']['sha256'] = raw_sha
    asset['mesh']['vertexCount'] = meta['vertexCount']
    asset['mesh']['triangleCount'] = meta['triangleCount']
    asset['mesh']['drawGroups'] = merged_groups
    asset['bounds'] = meta['bounds']
    asset['sizeM'] = meta['sizeM']
    asset['lighting']['headlights']['headFront'] = meta['headFront']
    asset['specification']['revision'] = '2026-11-06-face-r1'
    asset['specification']['body'] = 'F1F2EF'
    asset['specification']['accent'] = '232B38'
    asset['specification']['windows'] = 7
    asset['reference'] = {**asset['reference'], 'scope': 'nose, mask, side windows and doors checked against Commons photos; Q proportions; photos not redistributed'}

    asset['doors'] = normalize_doors(json.loads(json.dumps(meta['doors'])))

    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    ASSET_BIN_GZ.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
    ASSET_JSON.write_text(json.dumps(asset, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

    print('GD_DOORS_INSTALL_OK', json.dumps({
        'json': str(ASSET_JSON), 'binGz': str(ASSET_BIN_GZ),
        'sha256': raw_sha, 'vertexCount': meta['vertexCount'], 'triangleCount': meta['triangleCount'],
        'doorIds': [d['id'] for d in meta['doors']['items']],
    }, ensure_ascii=False))


def install_mid():
    """中間車（Task 5）：build_mid.py 已經算好完整幾何＋doors＋pantograph mount，這裡只是組出
    完整的 emu3000-mid.json 頂層 schema（沿用頭車的欄位形狀）並寫檔，不做任何幾何運算。"""
    raw_path = BUILD_DIR / 'emu3000-mid.raw.bin'
    meta_path = BUILD_DIR / 'emu3000-mid.meta.json'
    if not raw_path.exists() or not meta_path.exists():
        sys.exit(f'找不到 build 輸出：{raw_path} 或 {meta_path}（先跑 build_mid.py）')
    raw = raw_path.read_bytes()
    meta = json.loads(meta_path.read_text(encoding='utf-8'))
    raw_sha = hashlib.sha256(raw).hexdigest()
    if raw_sha != meta['sha256']:
        sys.exit(f'raw.bin sha256 與 meta.json 不符：raw={raw_sha} meta={meta["sha256"]}（重跑 build_mid.py）')

    head = json.loads(ASSET_JSON.read_text(encoding='utf-8'))  # 頭車，只讀不寫，借頂層欄位形狀與素材慣例

    out_json = ASSET_DIR / 'emu3000-mid.json'
    out_bin_gz = ASSET_DIR / 'emu3000-mid.bin.gz'
    asset = {
        'modelId': 'emu3000-mid', 'name': 'EMU3000 新自強（中間車）', 'version': 1,
        'application': head['application'], 'family': head['family'],
        'axes': head['axes'], 'gltfAxes': head['gltfAxes'], 'style': head['style'],
        'sourcePhotosIncluded': False, 'operatorLogoIncluded': False, 'numberIsLiveIdentity': False,
        'identityMaterial': None, 'engineeringDimensionsM': None,
        'bounds': meta['bounds'], 'sizeM': meta['sizeM'],
        'mesh': {
            'file': 'emu3000-mid.bin.gz', 'sha256': raw_sha, 'encoding': 'float32-le', 'strideBytes': 24,
            'vertexCount': meta['vertexCount'], 'triangleCount': meta['triangleCount'],
            'drawGroups': [{**g, 'name': night_lamp_name(g['name'])} for g in meta['drawGroups']], 'compression': 'gzip',
        },
        'nativeObjectCount': None,
        'features': {
            'sideDoorGroups': 2, 'doorLeavesPerGroup': 1, 'pantographsOnThisAsset': 1,
            'axlesPerBogie': head['features']['axlesPerBogie'], 'articulatedSections': 1, 'steamDriversPerSide': 0,
        },
        'specification': {
            'id': 'emu3000-mid', 'family': head['specification']['family'],
            'L': meta['sizeM'][0], 'W': head['specification']['W'], 'H': meta['sizeM'][2],
            'body': head['specification']['body'], 'accent': head['specification']['accent'],
            'roof': head['specification']['roof'], 'doorLeaves': 1, 'windows': None,
            'power': 'overhead', 'revision': '2026-09-25-mid-r1',
        },
        'reference': head['reference'],
        'formation': {'default': 'single-vehicle', 'illustrative': True, 'liveAssignment': False, 'shortFormation': None},
        'lighting': None,
        'doors': normalize_doors(meta['doors']),
        'pantograph': meta['pantograph'],
    }
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    out_bin_gz.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
    out_json.write_text(json.dumps(asset, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print('GD_MID_INSTALL_OK', json.dumps({
        'json': str(out_json), 'binGz': str(out_bin_gz), 'sha256': raw_sha,
        'vertexCount': meta['vertexCount'], 'triangleCount': meta['triangleCount'],
        'doorIds': [d['id'] for d in meta['doors']['items']], 'pantograph': meta['pantograph'],
    }, ensure_ascii=False))


def install_pantograph():
    """集電弓零件庫（Task 5）：build_pantograph.py 已經算好 4 個部件的幾何與 rig，這裡只是照
    garage-parts-v1 的欄位形狀組出 emu3000-pantograph.json 並寫檔。"""
    raw_path = BUILD_DIR / 'emu3000-pantograph.raw.bin'
    meta_path = BUILD_DIR / 'emu3000-pantograph.meta.json'
    if not raw_path.exists() or not meta_path.exists():
        sys.exit(f'找不到 build 輸出：{raw_path} 或 {meta_path}（先跑 build_pantograph.py）')
    raw = raw_path.read_bytes()
    meta = json.loads(meta_path.read_text(encoding='utf-8'))
    raw_sha = hashlib.sha256(raw).hexdigest()
    if raw_sha != meta['sha256']:
        sys.exit(f'raw.bin sha256 與 meta.json 不符：raw={raw_sha} meta={meta["sha256"]}（重跑 build_pantograph.py）')

    out_json = ASSET_DIR / 'emu3000-pantograph.json'
    out_bin_gz = ASSET_DIR / 'emu3000-pantograph.bin.gz'
    asset = {
        'schema': 'garage-parts-v1', 'id': 'emu3000-pantograph', 'units': 'model',
        'mesh': {
            'file': 'emu3000-pantograph.bin.gz', 'sha256': raw_sha, 'encoding': 'float32-le', 'strideBytes': 24,
            'vertexCount': meta['vertexCount'], 'triangleCount': meta['triangleCount'], 'compression': 'gzip',
        },
        'rig': meta['rig'],
        'parts': meta['parts'],
    }
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    out_bin_gz.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
    out_json.write_text(json.dumps(asset, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print('GD_PANTOGRAPH_INSTALL_OK', json.dumps({
        'json': str(out_json), 'binGz': str(out_bin_gz), 'sha256': raw_sha,
        'vertexCount': meta['vertexCount'], 'triangleCount': meta['triangleCount'],
        'parts': [p['name'] for p in meta['parts']],
    }, ensure_ascii=False))


def normalize_installed():
    """已裝好的頭車與中間車就地改燈材質名（drawGroups 與門扇 ranges 的 group），網格不動；已經改過的不變。"""
    for name in ('emu3000.json', 'emu3000-mid.json'):
        path = ASSET_DIR / name
        asset = json.loads(path.read_text(encoding='utf-8'))
        asset['mesh']['drawGroups'] = [{**g, 'name': night_lamp_name(g['name'])} for g in asset['mesh']['drawGroups']]
        if 'doors' in asset:
            normalize_doors(asset['doors'])
        path.write_text(json.dumps(asset, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
        print('GD_NORMALIZE_OK', name, [g['name'] for g in asset['mesh']['drawGroups']])


if _MODE is None:
    install_head_car()
elif _MODE == 'mid':
    install_mid()
elif _MODE == 'pantograph':
    install_pantograph()
elif _MODE == 'normalize':
    normalize_installed()
