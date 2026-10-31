#!/usr/bin/env python3
"""建完模型之後跑：hero.png 縮成 360×240 WebP 縮圖（cwebp q85 m6，跟 fleet-v1 同尺寸與品質），
再依 catalog-source.json 產 catalog.json（fleet-v1 同格式，給 scripts/import_garage_blender.py --source 讀）。
python3 finalize_tw.py c301 ...；不給 ID 就處理 models/ 底下已建好的全部。"""
import json,subprocess,sys
from pathlib import Path
OUT=Path(__file__).resolve().parent
src={m['id']:m for m in json.loads((OUT/'catalog-source.json').read_text())}
ids=sys.argv[1:] or [d.name for d in sorted((OUT/'models').iterdir()) if (d/f'{d.name}.model.json').exists()]
path=OUT/'catalog.json'
catalog={m['id']:m for m in json.loads(path.read_text())} if path.exists() else {}
for id in ids:
 m=src[id];d=OUT/'models'/id;meta=json.loads((d/f'{id}.model.json').read_text())
 subprocess.run(['cwebp','-quiet','-q','85','-m','6','-resize','360','240',str(d/'renders/hero.png'),'-o',str(d/'renders/thumb.webp')],check=True)
 catalog[id]={'id':id,'name':m['name'],'family':meta['family'],'detail':m['detail'],'features':m['features'],
  'metadata':f'models/{id}/{id}.model.json','blend':f'models/{id}/{id}.blend','glb':f'models/{id}/{id}.glb','hero':f'models/{id}/renders/hero.png',
  'sources':m['sources'],'note':'參考照片僅供外觀比對，未封裝成貼圖。所有模型為 Q 版估製；車底與局部設備仍有簡化。','thumbnail':f'models/{id}/renders/thumb.webp'}
path.write_text(json.dumps(list(catalog.values()),ensure_ascii=False,indent=1)+'\n')
print('catalog.json',len(catalog),'款；本次',len(ids),'款')
