"""校正輸出契約：座標、LOD、雜湊與原生物件世界座標。不是現實外觀精度認證。"""
import bpy,json,hashlib,math,struct
from pathlib import Path
P=Path(__file__).resolve().parent;results=[]
for p in sorted((P/'models').iterdir()):
 if not p.is_dir():continue
 m=json.loads((p/'model.json').read_text());placement=json.loads((P/'placements'/(p.name+'.json')).read_text());assert m['anchor']==placement['anchor'];assert m['orientationMode']=='ENU-baked';assert m['railElevationM'] is None
 bpy.ops.wm.open_mainfile(filepath=str(p/(p.name+'.blend')))
 objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('asset_id')==p.name]
 assert len(objects)==m['nativeObjectCount'],p.name
 assert set(o['component_id'] for o in objects)==set(c['id'] for c in m['components'])
 for lod,s in m['lods'].items():
  raw=(p/s['file']).read_bytes();assert hashlib.sha256(raw).hexdigest()==s['sha256'];assert len(raw)==s['vertexCount']*24;assert s['triangleCount']==s['vertexCount']//3;assert sum(g['count'] for g in s['drawGroups'])==s['vertexCount']
  data=struct.iter_unpack('<6f',raw)
  for x,y,z,nx,ny,nz in data:
   assert all(math.isfinite(v) for v in (x,y,z,nx,ny,nz));assert abs(math.hypot(nx,ny,nz)-1)<.002
   assert all(m['bounds']['min'][j]-.1<=v<=m['bounds']['max'][j]+.1 for j,v in enumerate((x,y,z)))
 assert m['lods']['far']['triangleCount']<=m['lods']['near']['triangleCount']
 results.append({'id':p.name,'pass':True,'objects':len(objects),'parts':len(m['components']),'omitted':m['omittedUnlocatedComponents']})
(P/'verification').mkdir(exist_ok=True);(P/'verification/native-calibration.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print('CALIBRATION_AUDIT_OK',len(results))
