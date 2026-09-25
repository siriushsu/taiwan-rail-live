#!/usr/bin/env python3
"""把 build_doors.py 的輸出（raw.bin + meta.json）併入正式資產
rail-3d/assets/garage-blender-v1/emu3000.{json,bin.gz}。

只做欄位合併，不重新產生幾何：
  - mesh.sha256 / mesh.vertexCount / mesh.triangleCount  ← 全部換成新算出的值
  - mesh.drawGroups[i].start / .count                    ← 換成新值；name／color／metalness／
    roughness／clearcoat／lightingRole 維持既有資產原樣（逐一比對 name 確保順序未變）
  - 新增頂層 doors 欄位（原資產沒有這個鍵）
  - 其餘所有既有欄位（bounds、sizeM、specification、reference、formation…）原封不動搬過去
不觸碰 emu3000.webp，不呼叫 import_garage_blender.py（它會重跑全部 62 款）。
另外把門口以外的外觀改回 BASE 資產的樣子：範圍沒變只是切法不同的平面整塊換回 BASE 的三角形
（restore_base_triangulation），其餘逐角把法向量改回 BASE 的值（restore_base_normals，不動位置）。

用法（頭車，Task 4，行為與輸出逐 byte 不變）：
  python3 scripts/blender/emu3000-doors-20260924/install_assets.py [build目錄=output/emu3000-doors/build]

用法（中間車／集電弓零件庫，Task 5，新增）：
  python3 scripts/blender/emu3000-doors-20260924/install_assets.py mid [build目錄=output/emu3000-doors/build-mid]
  python3 scripts/blender/emu3000-doors-20260924/install_assets.py pantograph [build目錄=output/emu3000-doors/build-pantograph]
"""
import sys, gzip, hashlib, json, array, math, subprocess
from pathlib import Path

W = Path(__file__).resolve().parents[3]  # repo 根目錄（scripts/blender/<本目錄>/<本檔>）
_MODE = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] in ('mid', 'pantograph') else None
_PATH_ARG = sys.argv[2] if _MODE and len(sys.argv) > 2 else (sys.argv[1] if not _MODE and len(sys.argv) > 1 else None)
_DEFAULT_BUILD = {'mid': 'build-mid', 'pantograph': 'build-pantograph'}.get(_MODE, 'build')
BUILD_DIR = Path(_PATH_ARG) if _PATH_ARG else (W / 'output/emu3000-doors' / _DEFAULT_BUILD)
ASSET_DIR = W / 'rail-3d/assets/garage-blender-v1'
ASSET_JSON = ASSET_DIR / 'emu3000.json'
ASSET_BIN_GZ = ASSET_DIR / 'emu3000.bin.gz'

BASE_REF = '65682ab6b492f8ede13b890f3689de468ed69bb2'  # 改動前的 commit；與 scripts/verify_garage_stop_assets.mjs 的 BASE 相同
BASE_ASSET = 'rail-3d/assets/garage-blender-v1/emu3000'


def sub(p, q): return (p[0] - q[0], p[1] - q[1], p[2] - q[2])
def dot(p, q): return p[0] * q[0] + p[1] * q[1] + p[2] * q[2]
def cross(p, q): return (p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0])
def pos(a, v): return (a[v * 6], a[v * 6 + 1], a[v * 6 + 2])


def load_base():
    """BASE 資產（改動前）的 (json, float32 陣列)。"""
    def git_show(rel):
        return subprocess.run(['git', '-C', str(W), 'show', f'{BASE_REF}:{rel}'], capture_output=True, check=True).stdout
    b = array.array('f'); b.frombytes(gzip.decompress(git_show(BASE_ASSET + '.bin.gz')))
    return json.loads(git_show(BASE_ASSET + '.json')), b


def moving_tris(doors):
    """隨門移動的三角形（以第一個頂點的索引表示）；兩個還原步驟都不碰。"""
    return {v for d in doors['items'] for r in d['ranges'] for v in range(r['start'], r['start'] + r['count'], 3)}


def restore_base_triangulation(raw, groups, doors, base):
    """範圍完全沒變、卻被切成不同三角形的平面，整塊換回 BASE 的三角形；回傳 (新 raw, 統計)。
    「範圍沒變」＝同群組、同平面，頂點集合、總面積、三角形數都跟 BASE 相同。換回時位置與法向量照抄，
    放進原本那些三角形的位置，數量不變，所以 drawGroups 與門扇 ranges 都不用動。
    為什麼：車端端牆（x=-4.8，94 個三角形）的角落法向量跟圓角一起平滑，往外傾 45–50°，
    整面牆的明暗完全由三角形怎麼切決定。EXACT 布林之後，這片牆只剩 21 個三角形跟 BASE 相同；
    角落的法向量一個都沒變，明暗卻整片不同（D12 在門 1 端量到），逐角抄法向量救不了。"""
    bmeta, b = base
    n = array.array('f'); n.frombytes(raw)

    def planes(a, gs, skip):
        out = {}
        for g in gs:
            for v in range(g['start'], g['start'] + g['count'], 3):
                if v in skip: continue
                p = (pos(a, v), pos(a, v + 1), pos(a, v + 2))
                c = cross(sub(p[1], p[0]), sub(p[2], p[0])); l = math.hypot(*c)
                if l < 1e-12: continue
                fn = (c[0] / l, c[1] / l, c[2] / l)
                key = (g['name'], tuple(round(x, 3) + 0. for x in fn), round(dot(fn, p[0]), 4) + 0.)  # +0. 把 -0.0 併成 0.0
                out.setdefault(key, []).append((v, p, l / 2))
        return out

    r5 = lambda q: tuple(round(x, 5) for x in q)
    verts = lambda ts: {r5(q) for _, p, _ in ts for q in p}
    tris = lambda ts: {frozenset(r5(q) for q in p) for _, p, _ in ts}
    stats = {'planes': 0, 'triangles': 0}
    base_planes = planes(b, bmeta['mesh']['drawGroups'], set())
    for key, nt in planes(n, groups, moving_tris(doors)).items():
        bt = base_planes.get(key)
        if not bt or len(nt) < 2 or len(nt) != len(bt) or verts(nt) != verts(bt) or tris(nt) == tris(bt): continue
        area = sum(t[2] for t in bt)
        if abs(sum(t[2] for t in nt) - area) > 1e-6 * area: continue
        for (nv, _, _), (bv, _, _) in zip(nt, bt):
            n[nv * 6:(nv + 3) * 6] = b[bv * 6:(bv + 3) * 6]
        stats['planes'] += 1; stats['triangles'] += len(nt)
    return n.tobytes(), stats


def restore_base_normals(raw, groups, doors, base):
    """門口以外的法向量改回 BASE 資產匯出時的值；回傳 (新 raw, 統計)。位置一個都不動。
    為什麼：EXACT 布林把只有 921 面的車殼整片重新三角化，Blender 重算的平滑法向量跟 BASE 不同
    （車頭側面與鼻部的折線被抹平，D12 在門 2 端量到）。
    做法是直接拿 BASE 資產的最終值當真值：新三角形的每個角，找 BASE 裡同群組、同平面、同朝向、
    包含這個角的三角形，用它三個角的法向量按重心座標內插。朝向要一致，車頭折線兩側才不會互相覆蓋；
    角落點先往自己三角形的重心挪一點再找，落在兩個 BASE 三角形的共用邊上時才會選到同一側的那個。
    找不到共面的（曲面上被重新三角化的），退一步找 1 mm 內、朝向差 <18° 的 BASE 三角形上的最近點。
    門扇 ranges（整組隨門移動的原幾何）與門內新零件找不到對應，維持 Blender 的值。
    （門 1 端車端端牆的差異是切法不同、角落法向量本來就一樣，由 restore_base_triangulation 處理；
    Blender 裡試過的八種抄法向量做法在門 1 端一律零反應，原因就在這裡。）"""
    bmeta, b = base
    n = array.array('f'); n.frombytes(raw)

    def names(gs, count):
        out = [None] * (count // 3)
        for g in gs:
            for v in range(g['start'], g['start'] + g['count'], 3):
                out[v // 3] = g['name']
        return out

    def bary(p, a, bb, c):
        v0, v1, v2 = sub(bb, a), sub(c, a), sub(p, a)
        d00, d01, d11, d20, d21 = dot(v0, v0), dot(v0, v1), dot(v1, v1), dot(v2, v0), dot(v2, v1)
        den = d00 * d11 - d01 * d01
        v = (d11 * d20 - d01 * d21) / den
        w = (d00 * d21 - d01 * d20) / den
        return (1 - v - w, v, w)

    def closest(p, a, bb, c):
        # Ericson, Real-Time Collision Detection 5.1.5：三角形上離 p 最近的點，回傳 (距離, 重心座標)
        ab, ac, ap = sub(bb, a), sub(c, a), sub(p, a)
        d1, d2 = dot(ab, ap), dot(ac, ap)
        if d1 <= 0 and d2 <= 0: w = (1, 0, 0)
        else:
            bp = sub(p, bb); d3, d4 = dot(ab, bp), dot(ac, bp)
            if d3 >= 0 and d4 <= d3: w = (0, 1, 0)
            else:
                vc = d1 * d4 - d3 * d2
                if vc <= 0 and d1 >= 0 and d3 <= 0: t = d1 / (d1 - d3); w = (1 - t, t, 0)
                else:
                    cp = sub(p, c); d5, d6 = dot(ab, cp), dot(ac, cp)
                    if d6 >= 0 and d5 <= d6: w = (0, 0, 1)
                    else:
                        vb = d5 * d2 - d1 * d6
                        if vb <= 0 and d2 >= 0 and d6 <= 0: t = d2 / (d2 - d6); w = (1 - t, 0, t)
                        else:
                            va = d3 * d6 - d5 * d4
                            if va <= 0 and d4 - d3 >= 0 and d5 - d6 >= 0: t = (d4 - d3) / ((d4 - d3) + (d5 - d6)); w = (0, 1 - t, t)
                            else:
                                den = 1 / (va + vb + vc); v_, w_ = vb * den, vc * den; w = (1 - v_ - w_, v_, w_)
        q = tuple(w[0] * a[k] + w[1] * bb[k] + w[2] * c[k] for k in range(3))
        return math.dist(p, q), w

    CELL = .05
    cell = lambda x: math.floor(x / CELL)
    bname = names(bmeta['mesh']['drawGroups'], len(b) // 6)
    btri, grid = {}, {}
    for v in range(0, len(b) // 6, 3):
        p = (pos(b, v), pos(b, v + 1), pos(b, v + 2))
        c = cross(sub(p[1], p[0]), sub(p[2], p[0])); l = math.hypot(*c)
        if l < 1e-12: continue
        fn = (c[0] / l, c[1] / l, c[2] / l)
        btri[v] = (p, fn, dot(fn, p[0]), bname[v // 3])
        lo = [cell(min(q[k] for q in p)) for k in range(3)]; hi = [cell(max(q[k] for q in p)) for k in range(3)]
        for i in range(lo[0], hi[0] + 1):
            for j in range(lo[1], hi[1] + 1):
                for k in range(lo[2], hi[2] + 1):
                    grid.setdefault((i, j, k), []).append(v)

    moving = moving_tris(doors)
    nname = names(groups, len(n) // 6)
    stats = {'coplanar': 0, 'nearest': 0, 'unmatched': 0, 'changedOver1deg': 0}
    for v in range(0, len(n) // 6, 3):
        if v in moving: continue
        p = (pos(n, v), pos(n, v + 1), pos(n, v + 2))
        c = cross(sub(p[1], p[0]), sub(p[2], p[0])); l = math.hypot(*c)
        if l < 1e-12: continue
        fn = (c[0] / l, c[1] / l, c[2] / l)
        g = nname[v // 3]
        lo = [cell(min(q[k] for q in p) - 1e-3) for k in range(3)]; hi = [cell(max(q[k] for q in p) + 1e-3) for k in range(3)]
        cands = {t for i in range(lo[0], hi[0] + 1) for j in range(lo[1], hi[1] + 1) for k in range(lo[2], hi[2] + 1) for t in grid.get((i, j, k), ()) if btri[t][3] == g}
        cen = tuple(sum(q[k] for q in p) / 3 for k in range(3))
        for k in range(3):
            pk = p[k]
            qk = tuple(pk[i] + 1e-4 * (cen[i] - pk[i]) for i in range(3))
            hit = None
            for t in cands:
                bp, bfn, bd, _ = btri[t]
                if dot(fn, bfn) < .9999 or abs(dot(bfn, pk) - bd) > 2e-5: continue
                if min(bary(qk, *bp)) >= -1e-6:
                    hit = (t, bary(pk, *bp)); break
            if hit: stats['coplanar'] += 1
            else:
                best = None
                for t in cands:
                    bp, bfn, _, _ = btri[t]
                    if dot(fn, bfn) < .95: continue
                    dist, w = closest(pk, *bp)
                    if dist <= 1e-3 and (best is None or dist < best[0]): best = (dist, t, w)
                if best: hit = best[1:]; stats['nearest'] += 1
                else: stats['unmatched'] += 1; continue
            t, w = hit
            m = [sum(w[i] * b[(t + i) * 6 + 3 + a] for i in range(3)) for a in range(3)]
            ml = math.hypot(*m)
            if ml < 1e-9: continue
            m = [x / ml for x in m]
            o = (v + k) * 6 + 3
            if dot(m, (n[o], n[o + 1], n[o + 2])) < math.cos(math.radians(1)): stats['changedOver1deg'] += 1
            n[o], n[o + 1], n[o + 2] = m
    return n.tobytes(), stats


def install_head_car():
    """頭車（Task 4）：原本的合併流程，逐行原封不動搬進函式——行為與輸出保持逐 byte 不變。"""
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

    orig_groups = asset['mesh']['drawGroups']
    new_groups = meta['drawGroups']
    if len(orig_groups) != len(new_groups):
        sys.exit(f'drawGroups 數量不符：既有 {len(orig_groups)} vs 新算 {len(new_groups)}')
    merged_groups = []
    for i, (og, ng) in enumerate(zip(orig_groups, new_groups)):
        if og['name'] != ng['name']:
            sys.exit(f'drawGroups[{i}] 名稱不符：既有 {og["name"]!r} vs 新算 {ng["name"]!r}（順序可能跑掉）')
        merged = dict(og)  # 保留既有的 color/metalness/roughness/clearcoat/lightingRole 原樣
        merged['start'] = ng['start']
        merged['count'] = ng['count']
        merged_groups.append(merged)

    base = load_base()
    raw, triangulation_stats = restore_base_triangulation(raw, new_groups, meta['doors'], base)
    raw, normal_stats = restore_base_normals(raw, new_groups, meta['doors'], base)
    raw_sha = hashlib.sha256(raw).hexdigest()  # 內容改過了，雜湊跟著換（meta.json 的是 build 原始輸出的）

    asset['mesh'] = dict(asset['mesh'])  # 淺拷貝，避免動到讀進來的物件被後面覆寫搞混
    asset['mesh']['sha256'] = raw_sha
    asset['mesh']['vertexCount'] = meta['vertexCount']
    asset['mesh']['triangleCount'] = meta['triangleCount']
    asset['mesh']['drawGroups'] = merged_groups
    # file/encoding/strideBytes/compression 格式不變，原樣保留（不覆寫）

    asset['doors'] = meta['doors']
    # bounds/sizeM 等其餘既有欄位完全不動（沿用讀進來的 asset dict 原值）

    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    ASSET_BIN_GZ.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
    ASSET_JSON.write_text(json.dumps(asset, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

    print('GD_DOORS_INSTALL_OK', json.dumps({
        'json': str(ASSET_JSON), 'binGz': str(ASSET_BIN_GZ),
        'sha256': raw_sha, 'vertexCount': meta['vertexCount'], 'triangleCount': meta['triangleCount'],
        'doorIds': [d['id'] for d in meta['doors']['items']],
        'triangulationFromBase': triangulation_stats,
        'normalsFromBase': normal_stats,
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
            'drawGroups': meta['drawGroups'], 'compression': 'gzip',
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
        'doors': meta['doors'],
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


if _MODE is None:
    install_head_car()
elif _MODE == 'mid':
    install_mid()
elif _MODE == 'pantograph':
    install_pantograph()
