import json,hashlib
from pathlib import Path
P=Path(__file__).resolve().parent
specs=json.loads((P/'catalog-source.json').read_text());catalog=[];assets=[]
for s in sorted(specs,key=lambda v:v['priority']):
 p=P/'models'/s['id'];m=json.loads((p/'model.json').read_text())
 catalog.append({'id':m['id'],'name':m['name'],'category':m['category'],'metadata':f'models/{m["id"]}/model.json','thumbnail':f'models/{m["id"]}/hero.png'})
 files={f.name:{'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in p.iterdir() if f.is_file() and f.suffix not in ('.blend1','.blend2')}
 assets.append({'id':m['id'],'name':m['name'],'nearTriangles':m['lods']['near']['triangleCount'],'farTriangles':m['lods']['far']['triangleCount'],'files':files})
(P/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
(P/'release.json').write_text(json.dumps({'version':2,'status':'plan-calibration-review','count':len(assets),'mapEligible':sum(json.loads((P/'models'/a['id']/'model.json').read_text()).get('mapEligible',False) for a in assets),'pendingGeoreference':sum(not json.loads((P/'models'/a['id']/'model.json').read_text()).get('mapEligible',False) for a in assets),'date':'2026-09-12','assets':assets,'implementationSHA256':{name:hashlib.sha256((P/name).read_bytes()).hexdigest() for name in ['build_calibrated.py','export_core.py','geometry.py','calibration.py','completion.py','placements-source.json','catalog-source.json','viewer.html','viewer.mjs','serve.mjs']},'verificationSHA256':{f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in (P/'verification').glob('*.json')}},ensure_ascii=False,indent=2)+'\n')
print({'models':len(assets),'near':sum(a['nearTriangles'] for a in assets),'far':sum(a['farTriangles'] for a in assets)})
