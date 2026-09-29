"""臺南舊站房（2026-09-12 歷史重播頁）Blender 程序化建模入口。

用法（背景模式）：
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python build.py -- [選項]
選項：
  --pack            打包近景／遠景／外罩網格並寫進 memories/tainan-2026-09-12/station/（gzip -9 -n）
  --views a,b       算圖並輸出 PNG（front／oblique／wrap／page；wrap 會把外罩一併算入）
  --out DIR         算圖輸出資料夾（預設：本目錄旁的 _render）
  --samples N       Cycles 取樣數（預設 48）
產物與格式沿用歷史重播頁既有約定：Float32 交錯 stride 6（位置 3＋法線 3）、model.json 的 lods.near／far／wrap。
打包後請跑 `python3 audit_overlap.py --lod near|far|wrap`（純 Python，需 numpy／shapely）：不同材質的共面重疊必須為 0，
否則網頁會 z-fighting、Cycles 會出黑斑。
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


import geo
import station
import wrap as wrapmod
import pack

G = station.build()
W = wrapmod.build()
print('TRIS', {'near': G.count(('both', 'near')), 'far': G.count(('both', 'far')), 'wrap': W.count(('both', 'near', 'far'))}, flush=True)
print('BY_PART', sorted(((k, v) for k, v in G.tris.items()), key=lambda kv: -kv[1])[:24], flush=True)

if '--pack' in argv:
    pack.pack(G, W, station, out_dir=opt('--station-dir'))

views = [v for v in (opt('--views') or '').split(',') if v]
if views:
    import bpy
    import render
    out = Path(opt('--out') or (HERE / '_render'))
    out.mkdir(parents=True, exist_ok=True)
    samples = int(opt('--samples', 48))
    for v in views:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        render.add_geo(G, ('both', 'near'), 'station')
        if v == 'wrap':
            render.add_geo(W, ('both', 'near'), 'wrap')
        path = str(out / f'{v}.png')
        render.render_view(v, path, samples)
        print('RENDER_OK', path, flush=True)
