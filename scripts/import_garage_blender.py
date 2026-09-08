#!/usr/bin/env python3
"""唯讀匯入 Blender 精修交付；無損壓縮網格，保留材質及來源。"""
import argparse, gzip, hashlib, json, shutil
from pathlib import Path
root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, default=root/'prototypes/tiny-trains/blender/fleet-v1')
parser.add_argument('--models', nargs='+', help='只更新指定車型，保留其他已出貨資產')
args = parser.parse_args()
source = args.source.resolve()
# 沿用既有 62 款車庫的系統分組；新模型需明確指定歸屬。
groups = {
    "台北捷運": [
        "c301",
        "c321",
        "c341",
        "c371",
        "c381",
        "wenhu",
        "val256"
    ],
    "桃園捷運": [
        "airportlocal",
        "airportexpress"
    ],
    "新北捷運": [
        "y100",
        "sanying",
        "danhai",
        "ankeng"
    ],
    "台中捷運": [
        "taichung"
    ],
    "高雄捷運": [
        "kaohsiung"
    ],
    "台鐵": [
        "haifeng",
        "shanlan",
        "emu500",
        "emu600",
        "dr2700",
        "dr1000",
        "dr3100",
        "emu100",
        "emu1200",
        "emu700",
        "emu800",
        "emu800r",
        "emu900",
        "temu1000",
        "temu2000",
        "emu3000",
        "e200",
        "e300",
        "e400",
        "mingri",
        "e500",
        "e1000",
        "r200",
        "r20",
        "r100",
        "r150",
        "r180",
        "blue",
        "dhl100",
        "juguang",
        "ppcoach",
        "bluecoach",
        "mingricoach",
        "ck124",
        "dt668",
        "ct273"
    ],
    "台灣高鐵": [
        "700t"
    ],
    "阿里山林鐵": [
        "dl25",
        "dl38",
        "dl39",
        "dl45",
        "alicoach",
        "hinoki",
        "fushen",
        "xuyue"
    ],
    "高雄輕軌": [
        "caf",
        "citadis"
    ]
}
systems = {id: system for system, ids in groups.items() for id in ids}
items = json.loads((source/'catalog.json').read_text())
out = root/'rail-3d/assets/garage-blender-v1'
out.mkdir(parents=True, exist_ok=True)
catalog = {}
if args.models:
    catalog_text = (root/'train-garage-catalog.js').read_text()
    catalog = json.loads(catalog_text.split('window.RailGarageCatalog = ', 1)[1].strip().removesuffix(';'))
    unknown = set(args.models)-{item['id'] for item in items}
    if unknown:
        raise ValueError('找不到來源車型：'+','.join(sorted(unknown)))
    items = [item for item in items if item['id'] in args.models]
for item in items:
    id = item['id']
    if id not in systems:
        raise ValueError('請先設定新模型的系統分組：'+id)
    meta_path = source/item['metadata']
    meta = json.loads(meta_path.read_text())
    raw = (meta_path.parent/meta['mesh']['file']).read_bytes()
    if hashlib.sha256(raw).hexdigest() != meta['mesh']['sha256']:
        raise ValueError('來源雜湊不符：'+id)
    (out/(id+'.bin.gz')).write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
    meta['mesh'].update(file=id+'.bin.gz', compression='gzip')
    (out/(id+'.json')).write_text(json.dumps(meta, ensure_ascii=False, separators=(',',':'))+'\n')
    shutil.copy2(source/item['thumbnail'],out/(id+'.webp'))
    sources = item['sources']
    if id == 'wenhu':
        refs = json.loads((source.parent/'wenhu-apm256-v1/references.json').read_text())
        sources = [{'label':x['title'],'url':x['page']} for x in refs]
    if not sources or any(not x['url'].startswith(('https://','http://')) for x in sources):
        raise ValueError('需提供可公開連結的逐款來源：'+id)
    catalog[id] = {'name':item['name'],'system':systems[id],'family':item['family'],
                   'sources':sources,'thumbnail':'./rail-3d/assets/garage-blender-v1/'+id+'.webp'}
(root/'train-garage-catalog.js').write_text('// Blender 精修收藏模型索引；網格僅在點選時載入。\nwindow.RailGarageCatalog = '+json.dumps(catalog,ensure_ascii=False,separators=(',',':'))+';\n')
print('本次匯入',len(items),'款；索引共',len(catalog),'款。請執行 npm run check-garage-assets 與 npm run check-garage。')
