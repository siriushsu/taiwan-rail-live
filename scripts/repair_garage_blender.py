"""修車庫網格的疊面：同位置、同繞序的重複三角形只留一份，別的零件從內凹切法的四邊形中間穿出來的換對角線，
近共面的兩片把貼在上面那片推開到 1 mm，重寫 .bin.gz 與 json。

只動幾何位置與三角形清單；材質與繪製順序不變，法線只在換了對角線的兩片重排。沒有要修的車款檔案原封不動。
改前的原始雜湊與修了什麼記在 json 的 meshRepair。

用法：Blender -b --factory-startup --python scripts/repair_garage_blender.py -- --models temu2000 emu1200
      --all 全部車款。在 import_garage_blender.py 之後、import_blender_map.py 之前跑。
"""
import sys, json, gzip, argparse
from pathlib import Path
import numpy as np
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).resolve().parent))
import train_mesh_common as common

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--models', nargs='+', default=[])
parser.add_argument('--all', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
requested = sorted(p.stem for p in common.GARAGE.glob('*.json')) if args.all else args.models
if not requested:
    raise ValueError('請給 --models 或 --all')
DIRS = common.directions()


def flip_diagonals(V, N, M, comp):
    """同材質兩個三角形拼成、接近平面（折角不到 15°）的四邊形，兩條對角線切出來的面一內一外。切在內凹那條，後面
    別的元件會從兩片中間穿出來（文湖線車頭下裙一側：白色車身從藍色裙板穿出將近 1 cm，另一側切法相反就蓋住了）。
    折得更多的是刻意的造型（EMU700 車頭側角的藍色塊折 21–26°，白色車身從缺口露出來是塗裝），不換。
    跟 separate_layers 一樣以繪製順序在後的材質為上層：四邊形畫在穿過它的每個元件之後才換，免得反過來蓋掉上層
    零件（普悠瑪車頭的窗框疊在飾帶上，飾帶那幾片不能換）。從外側沿法線看得到的穿出點，換另一條對角線後減到
    一半以下才換；頂點位置不動，各頂點沿用原本的法線，兩片原本各自平面著色的改用新面的法線。回傳換了幾組。
    """
    F = common.weld(V)
    area, normal = common.faces(V)
    E = np.sort(np.stack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]], 1), 2)
    key = (E[:, :, 0].astype(np.int64)*(F.max()+1)+E[:, :, 1]).reshape(-1)
    order = np.argsort(key, kind='stable')
    cut = np.r_[0, np.where(np.diff(key[order]))[0]+1, len(key)]
    bvh, used, flipped = common.tree(V), set(), 0
    for lo, hi in zip(cut[:-1], cut[1:]):
        if hi-lo != 2:
            continue
        (i, ki), (j, kj) = divmod(int(order[lo]), 3), divmod(int(order[lo+1]), 3)
        if M[i] != M[j] or i in used or j in used or min(area[i], area[j]) < 1e-8:
            continue
        if F[j, kj] != F[i, (ki+1) % 3] or F[j, (kj+1) % 3] != F[i, ki]:
            continue
        pa, pb, pc, pd = V[i, ki], V[i, (ki+1) % 3], V[i, (ki+2) % 3], V[j, (kj+2) % 3]
        # 第四個點在第一片外側＝共用邊是凹的；換成 c–d 那條對角線，整片落在外側
        if (pd-pa)@normal[i] < .001 or normal[i]@normal[j] < np.cos(np.radians(15)):
            continue
        new = np.array([[pa, pd, pc], [pd, pb, pc]])
        _, nn = common.faces(new)
        if min((nn@normal[i]).min(), (nn@normal[j]).min()) < .2:
            continue
        crossing = lambda tris: {k for k, _ in bvh.overlap(common.tree(tris)) if comp[k] != comp[i] and M[k] != M[i]}
        hits = crossing(V[[i, j]])
        if not hits:
            continue
        hits |= crossing(new)
        if M[i] < max(M[k] for k in hits):
            continue
        rays = [(Vector(p+normal[t]*.05), Vector(-normal[t])) for t in (i, j) for p in common.samples(V[t], area[t], .01)]
        shown = lambda b: sum(1 for o, d in rays if (h := b.ray_cast(o, d, .06))[0] is not None and h[2] in hits)
        before = shown(bvh)
        if before < 5:
            continue
        W = V.copy()
        W[i], W[j] = new
        trial = common.tree(W)
        if 2*shown(trial) > before:
            continue
        if all(np.abs(N[t]-normal[t]).max() < 1e-3 for t in (i, j)):
            N[i], N[j] = nn[0], nn[1]
        else:
            na, nb, nc, nd = N[i, ki], N[i, (ki+1) % 3], N[i, (ki+2) % 3], N[j, (kj+2) % 3]
            N[i], N[j] = [na, nd, nc], [nd, nb, nc]
        V[i], V[j] = new
        bvh = trial
        used |= {i, j}
        flipped += 1
    return flipped


for id in requested:
    meta, raw, V, N, M = common.load_garage(id)
    groups = meta['mesh']['drawGroups']
    keep = common.dedupe(V)
    V, N, M = V[keep], N[keep], M[keep]
    comp = common.components(common.weld(V))
    flipped = flip_diagonals(V, N, M, comp)
    area, normal = common.faces(V)
    moved, cancelled = common.separate_layers(V, area, normal, comp, M, .0006, .001, DIRS)
    removed = int((~keep).sum())
    if not removed and not moved and not flipped:
        print(id, '不用修', flush=True)
        continue
    counts = np.bincount(M, minlength=len(groups))
    if (counts == 0).any() or (np.diff(M) < 0).any():
        raise ValueError(id+' 材質分組不連續或被清空')
    data = np.concatenate([V, N], axis=2).astype('<f4')
    blob = data.tobytes()
    start = 0
    for g, n in zip(groups, counts):
        g['start'], g['count'] = start, int(n)*3
        start += int(n)*3
    xyz = data[:, :, :3].reshape(-1, 3)
    lo, hi = xyz.min(0).astype(float), xyz.max(0).astype(float)
    meta['bounds'] = {'min': lo.tolist(), 'max': hi.tolist()}
    meta['sizeM'] = (hi-lo).tolist()
    repair = meta.get('meshRepair') or {'sourceSha256': meta['mesh']['sha256']}
    repair.update(tool='scripts/repair_garage_blender.py', duplicateTrianglesRemoved=removed, diagonalsFlipped=flipped, layersSeparated=moved, layerVerticesSkipped=cancelled)
    meta['mesh'].update(sha256=common.sha(blob), vertexCount=len(data)*3, triangleCount=len(data))
    meta['meshRepair'] = repair
    (common.GARAGE/meta['mesh']['file']).write_bytes(gzip.compress(blob, compresslevel=9, mtime=0))
    (common.GARAGE/(id+'.json')).write_text(json.dumps(meta, ensure_ascii=False, separators=(',', ':'))+'\n')
    print(id, '重複', removed, '換對角線', flipped, '拉開', moved, '沒推頂點', cancelled, '三角形', len(data), flush=True)
