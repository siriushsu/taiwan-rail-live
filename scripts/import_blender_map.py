"""唯讀車庫資產（rail-3d/assets/garage-blender-v1），產生地圖 LOD／中間車／輕軌分節。

每個網格：近共面疊層拉開 → 算來源每個面看不看得到、朝向翻到看得到的一側 →
整個看不到的元件與深埋的面拿掉，貼在別的材質表面上的薄零件只留朝外那面，其餘（含貼花後面的背板）
一起 Blender Decimate（同一片表面上色彩交界的頂點不減，色帶邊緣不被拉成鋸齒）→
被減面誤差蓋住的貼片推回前面 → 依減面結果自己的可見性剔除看不到的面（大三角形用密格點再查一次），
預算回填到上限 → 減面後貼近的疊層再拉開（兩端推法抵消、仍不到 1 mm 的，小的那片整個平移）→
朝向照輸出自己哪一側看得到，每個角的法線從來源附近同材質、朝向相容的面內插。
最後在來源看得到的面上沿視線回看輸出，量透空、凹陷與顏色不符的比例。
法線不經 Blender 各版不同的 API，4.0.2 與 5.x 跑出同一份結果。

用法：Blender -b -t 1 --factory-startup --python scripts/import_blender_map.py -- --models e200 dr1000
      --all 重建 manifest 內全部車款；--out 另存到別的資料夾（試跑用）。
      -t 1 必加：Blender 減面在多執行緒下同一份輸入每次結果不同，單執行緒才重產得出同一份檔案。
"""
import bpy, json, math, sys, time, argparse
from pathlib import Path
import numpy as np
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).resolve().parent))
import train_mesh_common as common

if bpy.context.scene.render.threads != 1:
    raise SystemExit('請加 -t 1 單執行緒執行：Blender 減面在多執行緒下每次結果不同。')
OUT = common.ROOT/'rail-3d/assets/blender-map-v1'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--models', nargs='+', default=[])
parser.add_argument('--all', action='store_true')
parser.add_argument('--out', type=Path, default=OUT)
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
manifest = json.loads((OUT/'manifest.json').read_text())
BUDGET = json.loads((common.ROOT/'scripts/map_lod_budget.json').read_text())
previous = BUDGET['meshes']
requested = list(manifest['models']) if args.all else args.models
unknown = set(requested)-set(manifest['models'])
if not requested or unknown:
    raise ValueError('請給 --models 或 --all；找不到：'+','.join(sorted(unknown)))
args.out.mkdir(parents=True, exist_ok=True)
DIRS = common.directions()
CAP = BUDGET['cap']


def clip(V, N, M, lo, hi):
    """沿 x 裁到 [lo, hi]，跨界三角形切開，法線線性內插。"""
    out = []
    for tri, nrm, m in zip(V, N, M):
        if tri[:, 0].min() >= lo and tri[:, 0].max() <= hi:
            out.append((tri, nrm, m))
            continue
        poly = [np.concatenate([p, n]) for p, n in zip(tri, nrm)]
        for bound, above in ((lo, True), (hi, False)):
            kept = []
            for a, b in zip(poly, poly[1:]+poly[:1]):
                ina, inb = (a[0] >= bound, b[0] >= bound) if above else (a[0] <= bound, b[0] <= bound)
                if ina:
                    kept.append(a)
                if ina != inb:
                    kept.append(a+(b-a)*(bound-a[0])/(b[0]-a[0]))
            poly = kept
            if len(poly) < 3:
                break
        for i in range(1, len(poly)-1):
            q = np.array([poly[0], poly[i], poly[i+1]])
            out.append((q[:, :3], q[:, 3:], m))
    if not out:
        return np.zeros((0, 3, 3)), np.zeros((0, 3, 3)), np.zeros(0, np.int32)
    V, N, M = zip(*out)
    return np.array(V), np.array(N), np.array(M, np.int32)


def prepare(V, N, M):
    """拉開疊層、算可見性，朝向翻到主要看得到的一側；回傳要拿去減面的來源面。

    整個元件都看不到的（車體內的填料）與離看得到的面超過 10 cm 的面先拿掉；其餘看不到的面
    留著當背板一起減面，減面挪動前層邊界時後面還有原本那層，不會看穿。
    薄板的背面（1 cm 內最近的可見面跟它正對反向）不留：留著減面後會從正面穿出來。
    貼在別的材質表面上的薄零件只留朝外那面，減面時當一片有邊的貼片。
    """
    area, normal = common.faces(V)
    ok = area > 1e-12
    V, N, M = V[ok].copy(), N[ok].copy(), M[ok]
    area, normal = common.faces(V)
    F = common.weld(V)
    comp = common.components(F)
    moved, cancelled = common.separate_layers(V, area, normal, comp, M, .0018, .002, DIRS)
    area, normal = common.faces(V)
    seen, flip = common.visibility(V, area, normal, common.tree(V), DIRS)
    # 同一片板子不要一半正一半反：看不到的面跟著所屬元件多數看得到的面翻；
    # 看得到的面已有四分之三（面積）要翻時整片一起翻（貼花邊角的小三角形常差一點才過門檻）。
    lit = np.bincount(comp[seen], weights=area[seen], minlength=comp.max()+1)
    turned = np.bincount(comp[seen&flip], weights=area[seen&flip], minlength=comp.max()+1)
    flip = np.where(seen, flip | (turned[comp] >= .75*lit[comp]) & (turned[comp] > 0), turned[comp] > lit[comp]/2)
    V[flip] = V[flip][:, ::-1]
    N[flip] = N[flip][:, ::-1]
    normal[flip] *= -1
    # 角法線跟面朝向相反（反裝的貼花）：整組翻向外。
    wrong = np.einsum('tkc,tc->t', N, normal) < 0
    N[wrong] *= -1
    N /= np.maximum(np.linalg.norm(N, axis=2), 1e-30)[:, :, None]
    keep = seen.copy()
    index = np.where(seen)[0]
    shown = common.tree(V[index])
    for i in np.where(~seen & (lit[comp] > 0))[0]:
        near = [shown.find_nearest(Vector(p), .10) for p in (*V[i], V[i].mean(0))]
        near = [h for h in near if h[0] is not None]
        back = any(h[3] < .01 and normal[index[h[2]]]@normal[i] < -.9 for h in near)
        keep[i] = bool(near) and not back
    # 貼在別的材質表面 1 cm 內、露出不到 12 mm 的小元件（格柵條、飾條、雨刷…）只留看得到、朝外的面：
    # 實心條減面時正背面會併到條子中間，整條沉到後面的板子裡，或整條被減掉。
    bvh = common.tree(V)
    lo = np.full((comp.max()+1, 3), np.inf)
    hi = np.full((comp.max()+1, 3), -np.inf)
    np.minimum.at(lo, comp, V.min(1))
    np.maximum.at(hi, comp, V.max(1))
    mounted = np.zeros(len(V), bool)
    for i in np.where(seen & (np.linalg.norm(hi-lo, axis=1)[comp] < 2.))[0]:
        p, d, left = V[i].mean(0), -normal[i], .01
        while left > 0:
            hit = bvh.ray_cast(Vector(p+d*1e-5), Vector(d), left)
            if hit[0] is None:
                break
            if comp[hit[2]] != comp[i]:
                mounted[i] = M[hit[2]] != M[i]
                break
            left -= hit[3]+1e-5
            p = np.array(hit[0])
    on = np.bincount(comp[mounted], weights=area[mounted], minlength=comp.max()+1)
    up = np.zeros((comp.max()+1, 3))
    np.add.at(up, comp[mounted], normal[mounted]*area[mounted, None])
    up /= np.maximum(np.linalg.norm(up, axis=1), 1e-30)[:, None]
    height = np.einsum('tkc,tc->tk', V, up[comp])
    low = np.full(comp.max()+1, np.inf)
    top = np.full(comp.max()+1, -np.inf)
    np.minimum.at(low, comp[seen], height[seen].min(1))
    np.maximum.at(top, comp[seen], height[seen].max(1))
    decal = (lit > 0) & (on >= .6*lit) & (top-low <= .012)
    side = decal[comp] & (~seen | (np.einsum('tc,tc->t', normal, up[comp]) < .5))
    keep &= ~side
    stats = {'source': int(ok.sum()), 'visible': int(seen.sum()), 'backing': int((keep&~seen).sum()), 'flipped': int((flip&seen).sum()), 'layers': moved, 'layerVerticesSkipped': cancelled,
             'decals': int(decal.sum()), 'decalSidesDropped': int(side.sum())}
    return {'V': V[keep], 'N': N[keep], 'M': M[keep], 'normal': normal[keep], 'seen': seen[keep], 'area': area[keep], 'decal': decal[comp][keep], 'stats': stats}


def decimate(V, M, budget):
    key = np.round(V.reshape(-1, 3)*1e6).astype(np.int64)
    _, first, vid = np.unique(key, axis=0, return_index=True, return_inverse=True)
    F = vid.reshape(-1, 3)
    ok = (F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])
    mesh = bpy.data.meshes.new('lod')
    mesh.from_pydata(V.reshape(-1, 3)[first].tolist(), [], F[ok].tolist())
    mesh.polygons.foreach_set('material_index', M[ok].astype(np.int32))
    mesh.validate()
    obj = bpy.data.objects.new('lod', mesh)
    bpy.context.collection.objects.link(obj)
    mod = obj.modifiers.new('lod', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.use_collapse_triangulate = True
    # 同一片連續表面上的色彩交界（不同材質共用的頂點）不參與減面，色帶邊緣不會被拉成鋸齒。
    pairs = np.unique(np.stack([F[ok].ravel(), np.repeat(M[ok], 3)], 1), axis=0)
    paint = np.bincount(pairs[:, 0], minlength=len(first)) > 1
    if paint.any():
        if len(mesh.vertices) != len(first):
            raise ValueError('validate 改了頂點數，色彩交界頂點對不上')
        obj.vertex_groups.new(name='free').add(np.where(~paint)[0].tolist(), 1., 'REPLACE')
        mod.vertex_group = 'free'
    faces = len(mesh.polygons)
    ratio = min(1, budget/faces)
    for _ in range(6):
        mod.ratio = ratio
        ev = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        me = ev.to_mesh()
        me.calc_loop_triangles()
        count = len(me.loop_triangles)
        if count <= budget:
            break
        ev.to_mesh_clear()
        ratio *= budget/count*.995
    co = np.empty(len(me.vertices)*3)
    me.vertices.foreach_get('co', co)
    tri = np.empty(count*3, np.int32)
    me.loop_triangles.foreach_get('vertices', tri)
    mat = np.empty(count, np.int32)
    me.loop_triangles.foreach_get('material_index', mat)
    P = co.reshape(-1, 3)[tri.reshape(-1, 3)]
    ev.to_mesh_clear()
    bpy.data.objects.remove(obj)
    bpy.data.meshes.remove(mesh)
    return P, mat


def barycentric(p, t):
    v0, v1, v2 = t[1]-t[0], t[2]-t[0], p-t[0]
    d00, d01, d11, d20, d21 = v0@v0, v0@v1, v1@v1, v2@v0, v2@v1
    den = d00*d11-d01*d01
    if abs(den) < 1e-30:
        return np.array([1/3, 1/3, 1/3])
    b = (d11*d20-d01*d21)/den
    c = (d00*d21-d01*d20)/den
    w = np.clip([1-b-c, b, c], 0, 1)
    return w/w.sum()


# 取法線的六個點：靠近三個角各一，三條邊中段各一（第 3+k 點在角 k 與角 k+1 之間）。
SAMPLE = np.array([[.7, .15, .15], [.15, .7, .15], [.15, .15, .7], [.4, .4, .2], [.2, .4, .4], [.4, .2, .4]])
FIT = np.linalg.pinv(SAMPLE)


def transfer(P, PM, src, turn, hold):
    """輸出三角形的朝向與每個角的法線。

    朝向：整面格點上量兩側看得到多少（common.side_shares），一側不到另一側的一半時朝看得到的那側
    （turn 要翻、hold 不翻；地圖材質不依朝向翻法線，朝內的面會畫成一塊暗色）。減面後的大三角形常
    橫跨看不到的內層和露出來的窄邊（玻璃後面的框板），面內最近的來源面多半是內層，不能讓它決定。
    兩側差不到一倍或都幾乎看不到時，沿用減面結果，只有面內四點最近的同材質來源面一致反向才翻過來
    （車頂、側牆內層看不到的面朝內，常比外皮還貼近輸出，不能單靠它）。
    法線在三角形內六個點取：附近同材質、朝向相容的來源面裡，
    最近的一層（多 4 mm 內）挑面法線最接近輸出面的那片，用它在該點內插的法線，稜線兩側各拿
    自己那側；找不到就用面法線。每個三角形先自己估三個角：六點能用三個角的線性內插解釋時（面落在
    曲面上）用最小平方外推到角上，解釋不了時（圓角或稜線只碰到一兩點）每個角取靠近它的三點平均
    （頂點本身常落在圓角上，外推會把大三角形整面帶歪）。同位置、同材質、兩兩相差 25° 內的角歸成
    一群、共用一條法線，所有群再一起解最小平方，讓每個三角形六點的內插值貼近取到的來源法線。
    各三角形自己估的角在共用頂點各說各話，平均起來，大三角形橫跨的曲面（普悠瑪車鼻下緣的稜）
    會一塊一塊；一起解才是連續的漸層。
    """
    V, N, M, fs, seen = src['V'], src['N'], src['M'], src['normal'], src['seen']
    trees = {}
    for m in np.unique(M):
        for shown in (True, False):
            index = np.where((M == m) & (seen == shown))[0]
            if len(index):
                trees[m, shown] = (common.tree(V[index]), index)
    whole = (common.tree(V), np.arange(len(V)))

    def nearest(q, m, f):
        for key in ((m, True), (m, False), None):
            if key is not None and key not in trees:
                continue
            t, index = trees[key] if key else whole
            for r in (.02, .06):
                found = [(d, index[j]) for _, _, j, d in t.find_nearest_range(Vector(q), r) if fs[index[j]]@f > .3]
                if found:
                    near = min(d for d, _ in found)+.004
                    return max((fs[s]@f, s) for d, s in found if d <= near)[1]
        return None

    same = {}
    for m in np.unique(M):
        index = np.where(M == m)[0]
        same[m] = (common.tree(V[index]), index)
    P = P.copy()
    out = np.zeros_like(P)
    samples = np.zeros((len(P), len(SAMPLE), 3))
    _, fn = common.faces(P)
    for t in range(len(P)):
        votes = 0
        t_same, index = same.get(PM[t], whole)
        for b in common.BASE:
            hit = t_same.find_nearest(Vector(b@P[t]))
            if hit[0] is not None:
                d = fs[index[hit[2]]]@fn[t]
                votes += int(d > .5)-int(d < -.5)
        if turn[t] or votes <= -3 and not hold[t]:
            P[t] = P[t, ::-1]
            fn[t] *= -1
        picked = []
        for q in SAMPLE@P[t]:
            s = nearest(q, PM[t], fn[t])
            n = fn[t]
            if s is not None:
                n = barycentric(q, V[s])@N[s]
                n = n/max(np.linalg.norm(n), 1e-30)
                if n@fn[t] <= .3:
                    n = fn[t]
            picked.append(n)
        samples[t] = picked = np.array(picked)
        corner = np.array([picked[k]+picked[3+k]+picked[3+(k+2) % 3] for k in range(3)])
        fit = FIT@picked
        spread = picked-picked.mean(0)
        if np.linalg.norm(picked-SAMPLE@fit) < .2*np.linalg.norm(spread) and \
                np.linalg.norm(fit-picked.mean(0), axis=1).max() < 2*np.linalg.norm(spread, axis=1).max():
            unit = fit/np.maximum(np.linalg.norm(fit, axis=1), 1e-30)[:, None]
            if (unit@fn[t]).min() > .3:
                corner = fit
        out[t] = corner/np.maximum(np.linalg.norm(corner, axis=1), 1e-30)[:, None]
    # 分群要兩兩都在 25° 內，不會沿著漸變一路併到稜線另一側。
    key = np.concatenate([np.round(P.reshape(-1, 3)*1e6).astype(np.int64), np.repeat(PM, 3)[:, None]], 1)
    vid = np.unique(key, axis=0, return_inverse=True)[1].ravel()
    flat = out.reshape(-1, 3)
    group = np.empty(len(flat), np.int64)
    count = 0
    order = np.argsort(vid, kind='stable')
    for corners in np.split(order, np.flatnonzero(np.diff(vid[order]))+1):
        clusters = []
        for c in corners:
            for k, members in clusters:
                if (flat[members]@flat[c] > .9).all():
                    members.append(c)
                    group[c] = k
                    break
            else:
                clusters.append((count, [c]))
                group[c] = count
                count += 1
    start = np.zeros((count, 3))
    np.add.at(start, group, flat)
    start /= np.maximum(np.linalg.norm(start, axis=1), 1e-30)[:, None]
    # 依面積加權；另加一點拉回群內平均，取樣少的群（細長條、小三角形）不會亂跑。
    # 對角前置條件的共軛梯度法，幾十輪內收斂。
    corner = group.reshape(-1, 3)
    area, _ = common.faces(P)
    pull = .05*np.median(area)

    def normal_eq(x):
        y = np.einsum('sk,tsc->tkc', SAMPLE, np.einsum('sk,tkc->tsc', SAMPLE, x[corner])*area[:, None, None])
        o = pull*x
        np.add.at(o, corner.ravel(), y.reshape(-1, 3))
        return o
    b = pull*start
    np.add.at(b, corner.ravel(), np.einsum('sk,tsc->tkc', SAMPLE, samples*area[:, None, None]).reshape(-1, 3))
    diag = np.full(count, pull)
    np.add.at(diag, corner.ravel(), np.outer(area, (SAMPLE**2).sum(0)).ravel())
    x = start.copy()
    r = b-normal_eq(x)
    z = r/diag[:, None]
    p, rz = z.copy(), (r*z).sum()
    for _ in range(200):
        if (r*r).sum() < 1e-24*(b*b).sum():
            break
        q = normal_eq(p)
        a = rz/(p*q).sum()
        x += a*p
        r -= a*q
        z = r/diag[:, None]
        rz, last = (r*z).sum(), rz
        p = z+rz/last*p
    x /= np.maximum(np.linalg.norm(x, axis=1), 1e-30)[:, None]
    # 解出來跟所屬任一三角形相差太多的群退回群內平均。
    away = np.zeros(count, bool)
    np.logical_or.at(away, corner.ravel(), (np.einsum('tkc,tc->tk', x[corner], fn) <= .3).ravel())
    x[away] = start[away]
    return P, x[corner]


def export(id, P, Nout, PM, groups, source, translate=0.):
    rgb = []
    for g in groups:
        rgb.append([12.92*x if x <= .0031308 else 1.055*x**(1/2.4)-.055 for x in g['color']]+[1-g.get('roughness', .5)])
    rgb = np.array(rgb)
    xyz = P.reshape(-1, 3).copy()
    xyz[:, 0] -= translate
    xyz[:, 2] = np.maximum(0, xyz[:, 2])
    n = Nout.reshape(-1, 3)
    n = n/np.maximum(np.linalg.norm(n, axis=1), 1e-30)[:, None]
    data = np.concatenate([xyz, n, np.repeat(rgb[PM], 3, axis=0)], 1).astype('<f4')
    if not len(data):
        raise ValueError(id+' 空網格')
    blob = data.tobytes()
    (args.out/(id+'.bin')).write_bytes(blob)
    manifest['meshes'][id] = {'file': id+'.bin', 'sha256': common.sha(blob), 'byteLength': len(blob), 'vertexCount': len(data),
                              'min': data[:, :3].min(0).astype(float).tolist(), 'max': data[:, :3].max(0).astype(float).tolist(),
                              'source': source, 'appearance': 'blender-map-lod'}


def lift(P, PM, area, fn, src):
    """減面後被別的面蓋住的貼片，整片沿外向往外推到蓋住它的面前 2 mm；回傳（新的 P, 推了幾片）。

    貼片在來源常只凸出板面不到 1 mm，減面把整條併成一片時會往後沉，後面的板子併成大三角形也會歪，
    兩邊各差不到 1 mm 就被判看不到、整條剔掉。只在來源該點最外層就是貼片的位置量，
    來源本來就被別的零件蓋住的部分不推；12 mm 外才蓋住的不算減面誤差。
    """
    decal = src['decal']
    mats = np.unique(src['M'][decal])
    if not len(mats):
        return P, 0
    comp = common.components(common.weld(P))
    same = {}
    for m in mats:
        index = np.where(src['M'] == m)[0]
        same[m] = (common.tree(src['V'][index]), index)
    vote = np.zeros(comp.max()+1)
    for t in np.where(np.isin(PM, mats))[0]:
        t_same, index = same[PM[t]]
        hit = t_same.find_nearest(Vector(P[t].mean(0)))
        if hit[0] is not None:
            vote[comp[t]] += area[t] if decal[index[hit[2]]] else -area[t]
    up = np.zeros((comp.max()+1, 3))
    np.add.at(up, comp, fn*area[:, None])
    up /= np.maximum(np.linalg.norm(up, axis=1), 1e-30)[:, None]
    whole, out = common.tree(src['V']), common.tree(P)
    need = np.zeros(comp.max()+1)
    for t in np.where(vote[comp] > 0)[0]:
        for q in common.BASE@P[t]:
            hit = whole.ray_cast(Vector(q+fn[t]*.02), Vector(-fn[t]), .04)
            if hit[0] is None or not decal[hit[2]]:
                continue
            p, left = q, .012
            while left > 0:
                hit = out.ray_cast(Vector(p+fn[t]*1e-5), Vector(fn[t]), left)
                if hit[0] is None:
                    break
                left -= hit[3]+1e-5
                if comp[hit[2]] != comp[t]:
                    need[comp[t]] = max(need[comp[t]], (.012-left+.002)/max(up[comp[t]]@fn[t], .5))
                    break
                p = np.array(hit[0])
    return P+(up*need[:, None])[comp][:, None, :], int((need > 0).sum())


def settle_layers(P, PM, colour, src):
    """separate_layers 之後仍不到 1 mm 的不同色疊面（同向或背對背），重疊處看得到的：面積小的那個元件整個沿法線平移，間隙拉到 2 mm。

    大片表面減面後只剩一兩個大三角形，平面會微斜，貼在上面的小零件一端在前、一端在後（明日號側面的黑色窗帶
    跟橘色腰帶），separate_layers 兩端要求的推法相反、互相抵消。留哪片在外面看來源：從外側正對著打到來源的
    第一個面是哪片的顏色就留哪片；都不是（來源那裡是更外面的第三層）就維持現在的前後。
    重疊處從兩層外側往各方向都出不去的（夾在車體裡）不動。只處理不同元件的疊面；
    回傳（平移的元件數, 同元件內沒法平移的對數）。
    """
    shown = np.where(src['seen'])[0]
    near, whole = common.tree(src['V'][shown]), common.tree(src['V'])
    rays = [Vector(d) for d in DIRS]

    def open_at(bvh, p, n, gap):
        for side in (1., -1.):
            origin, dots = Vector(p+n*side*(gap+1e-4)), DIRS@n*side
            out = np.where(dots > .02)[0]
            if sum(dots[k] for k in out if bvh.ray_cast(origin, rays[k])[0] is None) >= .02*dots[out].sum():
                return True
        return False

    moved, stuck = 0, set()
    for _ in range(3):
        area, fn = common.faces(P)
        bvh = common.tree(P)
        seen, _ = common.visibility(P, area, fn, bvh, DIRS)
        comp = common.components(common.weld(P))
        found = {}
        for i in np.where(seen)[0]:
            for p in common.samples(P[i], area[i]):
                for _, _, j, dist in bvh.find_nearest_range(Vector(p), .001):
                    if j == i or not seen[j] or abs(fn[i]@fn[j]) < .9995 or np.abs(colour[i]-colour[j]).max() <= .02:
                        continue
                    if abs(dist-abs((p-P[j, 0])@fn[j])) > 1e-7 or not open_at(bvh, p, fn[i], dist):
                        continue
                    if comp[i] == comp[j]:
                        stuck.add((min(i, j), max(i, j)))
                    else:
                        found.setdefault((min(comp[i], comp[j]), max(comp[i], comp[j])), []).append((p, i, j))
        if not found:
            break
        size = np.bincount(comp, weights=area)
        for (a, b), hits in found.items():
            hit = near.find_nearest(Vector(hits[0][0]), .05)
            if hit[0] is None:
                continue
            # 沿疊面自己的法線推，朝外那側取來源最近看得到的面朝向
            out = fn[hits[0][1]]*(1 if fn[hits[0][1]]@src['normal'][shown[hit[2]]] >= 0 else -1)
            # 每個取樣點上 a 在 b 外面多少
            gaps = np.array([((p-P[j, 0])@fn[j]*np.sign(fn[j]@out))*(1 if comp[i] == a else -1) for p, i, j in hits])
            first = whole.ray_cast(Vector(hits[0][0]+out*.05), Vector(-out), .1)
            shown_m = src['M'][first[2]] if first[0] is not None else -1
            mat = {c: np.bincount(PM[comp == c]).argmax() for c in (a, b)}
            if shown_m == mat[a] != mat[b]:
                top = a
            elif shown_m == mat[b] != mat[a]:
                top = b
            else:
                top = a if gaps.mean() >= 0 else b
            need = .002-(gaps if top == a else -gaps).min()
            if need <= 0:
                continue
            small = a if size[a] <= size[b] else b
            P[comp == small] += out*(need if small == top else -need)
            moved += 1
    return moved, len(stuck)


def emit(id, src, budget, groups, source, translate=0.):
    """減面後依輸出自己的可見性剔除；可見面數不到預算就加大減面目標重來，最多五輪（超出預算時多給三輪往下收）。"""
    t0 = time.time()
    best, target = None, budget/max(src['stats']['visible']/max(len(src['V']), 1), .3)
    for attempt in range(8):
        if attempt >= 5 and best:
            break
        P, PM = decimate(src['V'], src['M'], int(min(target, len(src['V']))))
        area, fn = common.faces(P)
        ok = area > 1e-12
        P, PM, area, fn = P[ok], PM[ok], area[ok], fn[ok]
        P, lifted = lift(P, PM, area, fn, src)
        bvh = common.tree(P)
        seen, _ = common.visibility(P, area, fn, bvh, DIRS)
        big = np.where(~seen & (np.linalg.norm(P-P[:, [1, 2, 0]], axis=2).max(1) > .15))[0]
        seen[big] = common.exposed(P, fn, bvh, DIRS, big)
        count = int(seen.sum())
        if count <= budget and (best is None or count > best[0]):
            best = (count, P, PM, seen, lifted)
        if budget*.98 <= count <= budget or target >= len(src['V']) and count <= budget:
            break
        target = min(target*budget/max(count, 1)*(.995 if count > budget else 1.), len(src['V']))
    count, P, PM, seen, lifted = best
    P, PM = P[seen], PM[seen]
    # 減面把薄板邊緣的頂點併到板厚中間，拉開 2 mm 的疊層會再貼近（明日號側面飾帶剩 0.3 mm、格柵葉片貼回背板），輸出上再拉一次。
    area, fn = common.faces(P)
    layers = common.separate_layers(P, area, fn, common.components(common.weld(P)), PM, .0018, .002, DIRS)
    rgb = np.array([g['color'] for g in groups])
    settled = settle_layers(P, PM, np.where(rgb <= .0031308, 12.92*rgb, 1.055*np.power(rgb, 1/2.4)-.055)[PM], src)
    area, fn = common.faces(P)
    share = common.side_shares(P, fn, common.tree(P), DIRS)
    turn = (share[:, 1] > .002) & (share[:, 0] < .5*share[:, 1])
    hold = (share[:, 0] > .002) & (share[:, 1] < .5*share[:, 0])
    P, Nout = transfer(P, PM, src, turn, hold)
    export(id, P, Nout, PM, groups, source, translate)
    check = common.coverage(src['V'], src['normal'], src['seen'], src['area'], rgb[src['M']], P, rgb[PM], DIRS)
    print(id, '來源', src['stats'], '預算', budget, '輸出', len(P), '貼片外推', lifted, '輸出再拉開', layers, '疊面平移', settled, '覆蓋', {k: round(v, 5) for k, v in check.items()}, '%.1fs' % (time.time()-t0), flush=True)


for id in requested:
    t0 = time.time()
    meta, raw, V, N, M = common.load_garage(id)
    groups = meta['mesh']['drawGroups']
    identity = meta.get('identityMaterial') or meta.get('fleetNumberMaterial')
    keep = np.array([groups[m]['name'] != identity for m in M])
    V, N, M = V[keep], N[keep], M[keep]
    source = {'metadata': 'rail-3d/assets/garage-blender-v1/'+id+'.json', 'rawSha256': common.sha(raw), 'engineeringDimensionsM': meta.get('engineeringDimensionsM')}
    model = manifest['models'][id]
    cap = lambda mesh: min(CAP, previous[mesh])
    emit(id, prepare(V.copy(), N.copy(), M), cap(id), groups, source)
    if model['articulated']:
        centers = meta['specification']['articulationCenters']
        cuts = [V[:, :, 0].min()]+[(a['centerX']+a['length']/2+b['centerX']-b['length']/2)/2 for a, b in zip(centers, centers[1:])]+[V[:, :, 0].max()]
        sections = []
        for i in range(5):
            k = 4-i
            sections.append((id+'-section-'+str(i), prepare(*clip(V, N, M, cuts[k], cuts[k+1])), (cuts[k]+cuts[k+1])/2))
        # 分節總預算不超過原本五節加總；依各節可見的來源面數分配，車頭節細節多、自然分到較多。
        total = sum(previous[name] for name, _, _ in sections)
        weight = np.array([s['stats']['visible'] for _, s, _ in sections], float)
        budgets = np.floor(total*weight/weight.sum()).astype(int)
        for (name, src, center), budget in zip(sections, budgets):
            emit(name, src, int(min(CAP, budget)), groups, source, center)
    elif model['family'] in ['metro', 'railcar', 'express'] and id not in ['dr1000', 'dr2700']:
        # 中間車：來源後半車體鏡射組合，自己算可見面與預算，不從車頭車的 LOD 裁。
        rv, rn, rm = clip(V, N, M, -math.inf, 0.)
        mv = np.concatenate([rv, (rv*[-1, 1, 1])[:, ::-1]])
        mn = np.concatenate([rn, (rn*[-1, 1, 1])[:, ::-1]])
        emit(id+'-mid', prepare(mv, mn, np.concatenate([rm, rm])), cap(id+'-mid'), groups, source)
    model['source'] = source
    print('完成', id, '%.0fs' % (time.time()-t0), flush=True)
(args.out/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
print('manifest', len(manifest['models']), len(manifest['meshes']), flush=True)
