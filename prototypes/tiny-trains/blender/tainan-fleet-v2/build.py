"""建置腳本：node 端 viewer 與 catalog 用的 .bin 輸出＋統計。
用法：python3 build.py [id ...]   （不帶參數＝全部）；--far／--near 只建一級；輸出到 out/<id>.<near|far>.bin
"""
import sys, os, gzip, json, importlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit, parts, common, cars

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
os.makedirs(OUT, exist_ok=True)


def build_one(cid, lod):
    m, spec = cars.BUILDERS[cid](lod)
    path = os.path.join(OUT, f"{cid}.{'near' if lod == 0 else 'far'}.bin")
    info = kit.export(m, path)
    gz = len(gzip.compress(open(path, 'rb').read(), 9, mtime=0))
    info['gz'] = gz
    info['tags'] = dict(sorted(m.counts.items(), key=lambda kv: -kv[1]))
    return info


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    lods = [0, 1]
    if '--far' in sys.argv: lods = [1]
    if '--near' in sys.argv: lods = [0]
    ids = args or list(cars.BUILDERS)
    tot = 0
    for cid in ids:
        for lod in lods:
            i = build_one(cid, lod)
            tot += i['gz']
            print(f"{cid:14s} {'near' if lod == 0 else 'far ':4s} tris={i['triangles']:6d} gz={i['gz']:8d} bbox x[{i['min'][0]:.2f},{i['max'][0]:.2f}] y[{i['min'][1]:.2f},{i['max'][1]:.2f}] z[{i['min'][2]:.2f},{i['max'][2]:.2f}]  {i['tags']}")
    print('gz total', tot)
