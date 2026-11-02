"""車模網格共用工具（Blender 內建 Python：numpy＋mathutils）。

只處理三角形湯，不呼叫各版 Blender 不同的法線 API，4.0 與 5.x 跑出同一份結果。
"""
import gzip, hashlib, json
from pathlib import Path
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
GARAGE = ROOT/'rail-3d/assets/garage-blender-v1'
sha = lambda b: hashlib.sha256(b).hexdigest()


def load_garage(id):
    """回傳 meta、原始位元組、頂點 (n,3,3)、角法線 (n,3,3)、材質序；三角形維持出貨的繪製順序。"""
    meta = json.loads((GARAGE/(id+'.json')).read_text())
    raw = gzip.decompress((GARAGE/meta['mesh']['file']).read_bytes())
    if sha(raw) != meta['mesh']['sha256']:
        raise ValueError(id+' 車庫網格雜湊不符')
    data = np.frombuffer(raw, dtype='<f4').reshape(-1, 3, 6).astype(np.float64)
    mat = np.empty(len(data), np.int32)
    for gi, g in enumerate(meta['mesh']['drawGroups']):
        mat[g['start']//3:(g['start']+g['count'])//3] = gi
    return meta, raw, data[:, :, :3].copy(), data[:, :, 3:].copy(), mat


def faces(V):
    cross = np.cross(V[:, 1]-V[:, 0], V[:, 2]-V[:, 0])
    length = np.linalg.norm(cross, axis=1)
    return length/2, cross/np.maximum(length, 1e-30)[:, None]


def weld(V, digits=5):
    key = np.round(V.reshape(-1, 3)*10**digits).astype(np.int64)
    _, vid = np.unique(key, axis=0, return_inverse=True)
    return vid.reshape(-1, 3)


def components(F):
    """以共用頂點連通的元件編號（逐三角形）。"""
    label = np.arange(F.max()+1)
    while True:
        low = label[F].min(axis=1)
        new = label.copy()
        for k in range(3):
            np.minimum.at(new, F[:, k], low)
        new = new[new]
        if np.array_equal(new, label):
            return label[F[:, 0]]
        label = new


def tree(V):
    flat = V.reshape(-1, 3)
    return BVHTree.FromPolygons([Vector(p) for p in flat], [(3*i, 3*i+1, 3*i+2) for i in range(len(V))], epsilon=0.0)


def directions(n=128, zmin=-.08):
    """均勻分布的視線方向：只取水平線附近以上，列車在地面或高架上，鏡頭不會從車底仰望。"""
    i = np.arange(n)+.5
    z = zmin+(1-zmin)*i/n
    r = np.sqrt(1-z*z)
    a = i*np.pi*(3-5**.5)
    return np.stack([r*np.cos(a), r*np.sin(a), z], 1)


BASE = np.array([[1/3, 1/3, 1/3], [.7, .15, .15], [.15, .7, .15], [.15, .15, .7]])


def samples(tri, area, step=.03):
    """重心與三個內點；大面再加內縮的重心格點，避免只露出一角的大三角形被誤判為看不到。"""
    points = list(BASE@tri)
    k = min(5, int(np.ceil(np.sqrt(2*area)/step)))
    if k >= 2:
        for a in range(k+1):
            for b in range(k+1-a):
                w = np.array([a, b, k-a-b])/k*.9+.1/3
                points.append(w@tri)
    return points


def visibility(V, area, normal, bvh, dirs, eps=1e-5, seed=7, floor=.02):
    """逐三角形回傳（看得到, 該翻面）。

    「看得到」以餘弦加權的可逃逸比例計：只能從細縫斜看到的面（例如貼板背後）比例極低，
    低於 floor 視同看不到。先在重心用一組固定方向估，兩側都不到 floor 再逐點、用全部方向
    細查（只露出一角的大三角形靠這步留住）。正面在重心看不到的面，再用 side_shares 在整面格點上
    比正反兩面，正面不到背面的 15% 才翻（反裝的貼花）；兩面都看得到的單層板保留來源朝向。
    玻璃後面的框板只從玻璃兩側露出窄條，內縮的取樣點全落在玻璃後面，曾因此被翻成朝車內。
    """
    coarse = dirs[::3]
    coarse_v = [Vector(d) for d in coarse]
    rng = np.random.default_rng(seed)
    variants = []
    for k in range(8):
        a = k*2.399963
        c, s = np.cos(a), np.sin(a)
        d = dirs@np.array([[c, s, 0], [-s, c, 0], [0, 0, 1]])
        variants.append((d, [Vector(x) for x in d]))

    def share(origin, d, vectors, n, order, stop):
        dots = d@n
        tested = [j for j in order if dots[j] > .02]
        total = sum(dots[j] for j in tested)
        need, got = floor*total, 0.
        for j in tested:
            if bvh.ray_cast(origin, vectors[j])[0] is None:
                got += dots[j]
                if stop and got >= need:
                    break
        return got/total if total else 0.

    def detailed(i, side, best):
        for k, p in enumerate(samples(V[i], area[i])):
            d, vectors = variants[(i+k) % 8]
            best = max(best, share(Vector(p+normal[i]*side*eps), d, vectors, normal[i]*side, rng.permutation(len(d)), True))
            if best >= floor:
                break
        return best

    seen = np.zeros(len(V), bool)
    check = []
    for i in range(len(V)):
        if area[i] < 1e-12:
            continue
        centre = V[i].mean(0)
        best = [share(Vector(centre+normal[i]*side*eps), coarse, coarse_v, normal[i]*side, range(len(coarse)), False) for side in (1., -1.)]
        if max(best) < floor:
            best = [detailed(i, side, b) for side, b in zip((1., -1.), best)]
        seen[i] = max(best) >= floor
        if seen[i] and best[0] < floor:
            check.append(i)
    # 正面在重心（或逐點）看不到：整面格點上兩側各比一次，背面明顯占優才翻。
    flip = np.zeros(len(V), bool)
    if check:
        both = side_shares(V[check], normal[check], bvh, dirs, eps=eps)
        flip[check] = both[:, 0] < .15*both[:, 1]
    return seen, flip


def exposed(V, normal, bvh, dirs, index, step=.03, cap=40, floor=.02, eps=1e-5):
    """visibility 判看不到的大三角形再查一次：沿最長邊每 step 一格取點（最多 cap 分割），任一點、任一側的
    可逃逸比例到 floor 就算看得到。減面後的大三角形常只從窗間細縫露出一點，visibility 最多 5 分割的格點
    會全落在窗後（阿里山客車的紅窗帶曾整片被當成看不到刪掉，露出底下的米色）。回傳 index 對應的布林陣列。
    """
    coarse = dirs[::3]
    vectors = [Vector(d) for d in coarse]
    out = np.zeros(len(index), bool)
    for n, i in enumerate(index):
        k = max(2, min(cap, int(np.ceil(np.linalg.norm(V[i]-V[i][[1, 2, 0]], axis=1).max()/step))))
        grid = np.array([(a, b, k-a-b) for a in range(k+1) for b in range(k+1-a)])/k*.98+.02/3
        for side in (1., -1.):
            dots = coarse@normal[i]*side
            order = [j for j in np.argsort(-dots) if dots[j] > .02]
            need = floor*dots[order].sum()
            for p in grid[:, :1]*V[i, 0]+grid[:, 1:2]*V[i, 1]+grid[:, 2:]*V[i, 2]:
                origin, got = Vector(p+normal[i]*side*eps), 0.
                for j in order:
                    if bvh.ray_cast(origin, vectors[j])[0] is None:
                        got += dots[j]
                        if got >= need:
                            break
                if got >= need:
                    out[n] = True
                    break
            if out[n]:
                break
    return out


def side_shares(V, normal, bvh, dirs, step=.03, cap=12, eps=1e-5):
    """逐三角形在整面的格點（含貼邊的點）上量正、反兩面看得到多少，回傳 (n, 2)。

    值是每個格點、每個方向（餘弦加權）能不能離開車體的平均，除以全部方向數，等於從各方向看過去
    這一面平均露出的投影面積比例。不除以該側可用的方向數：方向集中在上半球，朝下的面只剩地平線下
    一窄條方向，照比例算會跟朝上、整片露在外面的面一樣大。
    大三角形常只有一條邊露出來（玻璃後面的框板只從玻璃兩側露出窄條），只看重心或內縮的幾個點
    會量不到露出的那條；兩面要用同一組點比，才分得出哪一面才是看得到的那面。
    """
    coarse = dirs[::3]
    vectors = [Vector(d) for d in coarse]
    out = np.zeros((len(V), 2))
    for i in range(len(V)):
        k = max(2, min(cap, int(np.ceil(np.linalg.norm(V[i]-V[i][[1, 2, 0]], axis=1).max()/step))))
        grid = np.array([(a, b, k-a-b) for a in range(k+1) for b in range(k+1-a)])/k*.98+.02/3
        for s, side in enumerate((1., -1.)):
            dots = coarse@normal[i]*side
            use = [j for j in range(len(coarse)) if dots[j] > .02]
            got = 0.
            for p in grid@V[i]:
                origin = Vector(p+normal[i]*side*eps)
                got += sum(dots[j] for j in use if bvh.ray_cast(origin, vectors[j])[0] is None)
            out[i, s] = got/len(coarse)/len(grid)
    return out


def outward_side(bvh, p, normal, gap, dirs):
    """近共面的一對面：從兩層外側各丟視線，能離開車體的那側是外側；兩側都被擋回傳 0。"""
    for side in (1., -1.):
        origin = Vector(p+normal*side*(gap+1e-5))
        for d in dirs:
            if d@normal*side > .05 and bvh.ray_cast(origin, Vector(d))[0] is None:
                return side
    return 0.


def separate_layers(V, area, normal, comp, M, detect, target, dirs):
    """同向近共面、不同元件也不同材質的兩片（間隙 < detect）：繪製順序在後的那片留在上面，間隙拉到 target。

    完全共面時 three.js（LessEqual）是後畫的材質贏，車庫現在大部分像素看到的就是它，只是沿三角形邊界閃爍；
    照這個順序拉開＝保留現在的樣子、去掉閃爍。按重疊面積比例猜誰貼在誰上面試過：每面只取 4 點太粗，
    同一款車左右兩側會判反（格柵背板被車門蓋掉一半、飾帶一側在上一側在下）。
    在上面的那片取樣點幾乎全都已在對方後面時（看到的是深度、不是繪製順序）反過來推，維持現在看到的樣子。
    推有取樣點落在對方上的那片：在上面的那片有就推它，沒有就反向推下面那片。頂點逐個沿所屬重疊面的平均外向
    法線推（曲面長條也適用），只推該元件自己的頂點：同位置的對方頂點不動，同元件相連的側面跟著拉長，不會裂開，
    實心件也不會整顆膨脹。同一頂點被好幾對要求時取最大的位移。只做一輪。
    回傳（被推動的元件數, 推的方向互相抵消而沒推的頂點數）。
    """
    bvh = tree(V)
    coarse = dirs[::8]
    rec = {}
    for i in range(len(V)):
        if area[i] < 1e-10:
            continue
        for b in BASE:
            p = b@V[i]
            matched = set()
            for _, _, j, d in bvh.find_nearest_range(Vector(p), detect):
                if j == i or comp[j] == comp[i] or M[j] == M[i] or normal[i]@normal[j] < .999 or comp[j] in matched:
                    continue
                if abs(d-abs((p-V[j, 0])@normal[j])) > 1e-7:
                    continue
                side = outward_side(bvh, p, normal[i], d, coarse)
                if not side:
                    continue
                matched.add(comp[j])
                r = rec.setdefault((comp[i], comp[j]), {'tris': {}, 'gaps': []})
                r['tris'][i] = side
                r['gaps'].append((p-V[j, 0])@normal[j]*side)
    order = {c: np.bincount(M[comp == c]).argmax() for c in {c for key in rec for c in key}}
    moves, moved = {}, set()
    for a, b in {tuple(sorted(key)) for key in rec}:
        top, bottom = (a, b) if order[a] > order[b] else (b, a)
        key, sign = ((top, bottom), 1.) if (top, bottom) in rec else ((bottom, top), -1.)
        g = np.array(rec[key]['gaps'])*sign  # 在上面那片相對下面那片的間隙
        if (g < -5e-5).mean() >= .9:
            need, way = target+g.max(), -1.
        else:
            need, way = target-g.min(), 1.
        if need <= 1e-6:
            continue
        moved.add(key[0])
        for i, side in rec[key]['tris'].items():
            for k in range(3):
                m = moves.setdefault((*np.round(V[i, k]*1e5).astype(np.int64), key[0]), [np.zeros(3), []])
                m[0] += normal[i]*side
                m[1].append(sign*way*need)
    corner = {}
    for i in range(len(V)):
        for k in range(3):
            corner.setdefault((*np.round(V[i, k]*1e5).astype(np.int64), comp[i]), []).append((i, k))
    cancelled = 0
    for key, (out, shift) in moves.items():
        shift = np.array(shift)
        if np.linalg.norm(out) < .5*len(shift) or (shift > 0).any() and (shift < 0).any():
            cancelled += 1
            continue
        step = out/np.linalg.norm(out)*shift[np.abs(shift).argmax()]
        for i, k in corner.get(key, ()):
            V[i, k] += step
    return len(moved), cancelled


def dedupe(V, digits=6):
    """同位置、同繞序的重複三角形只留繪製順序最後一份（現在畫面看到的那份）。"""
    key = np.round(V*10**digits).astype(np.int64)
    first = np.argmin(key[:, :, 0]*1_000_003+key[:, :, 1]*1_009+key[:, :, 2], axis=1)
    rolled = key[np.arange(len(key))[:, None], (first[:, None]+np.arange(3)) % 3].reshape(len(key), 9)
    _, last = np.unique(rolled[::-1], axis=0, return_index=True)
    keep = np.zeros(len(V), bool)
    keep[len(V)-1-last] = True
    return keep


def coverage(V, normal, seen, area, color, P, pcolor, dirs, n=24000, seed=3, near=.01, far=.15, detail=None):
    """視線覆蓋檢查：在來源看得到的面上依面積取點，沿該點看得到的方向回看輸出網格。

    透空＝輸出在該點後方 far 內都沒有面（看穿到車體另一側）；凹陷＝後方 near～far 之間才有面
    （例如減面露出背板）；顏色不符＝該點 near 內有面但顏色跟來源不同。回傳各項占取樣的比例。
    """
    rng = np.random.default_rng(seed)
    index = np.where(seen & (area > 1e-10))[0]
    if not len(index):
        return {'samples': 0}
    pick = rng.choice(index, n, p=area[index]/area[index].sum())
    w = rng.random((n, 2))
    w = np.where(w.sum(1, keepdims=True) > 1, 1-w, w)
    bary = np.stack([1-w.sum(1), w[:, 0], w[:, 1]], 1)
    src, out = tree(V), tree(P)
    L = 3.
    counts = {'samples': 0, 'seeThrough': 0, 'recessed': 0, 'colour': 0, 'occluded': 0}
    for t, b in zip(pick, bary):
        p = b@V[t]
        d = dirs[rng.permutation(len(dirs))]
        d = d[d@normal[t] > .1]
        if not len(d):
            continue
        d = d[0]
        if src.ray_cast(Vector(p+normal[t]*1e-4), Vector(d))[0] is not None:
            continue
        counts['samples'] += 1
        hit = out.ray_cast(Vector(p+d*L), Vector(-d), L+far)
        if hit[0] is None:
            counts['seeThrough'] += 1
            if detail is not None:
                detail.append((t, p, d))
            continue
        s = hit[3]-L
        if s > near:
            counts['recessed'] += 1
        elif s < -near:
            counts['occluded'] += 1
        elif np.abs(pcolor[hit[2]]-color[t]).max() > .02:
            counts['colour'] += 1
    k = max(counts['samples'], 1)
    return {'samples': counts['samples'], **{key: counts[key]/k for key in ('seeThrough', 'recessed', 'colour', 'occluded')}}
