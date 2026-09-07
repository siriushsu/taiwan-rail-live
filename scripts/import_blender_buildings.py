"""匯入使用者的固定 Blender 交付；位置與方向另存，不改原始模型。"""
import json,math,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[1]
out=root/'rail-3d/assets/blender-buildings-v1'
new={e['id']:e for e in json.loads((out/'georeference-source.json').read_text())['elements']}
ids={'taipei-dome':442195153,'nanshan-plaza':383731054,'national-theater':1052759776,'national-concert-hall':1052759775,'hsinchu-tra':293504390}
def fit(ring,W,D):
 origin=ring[0];sx=111320*math.cos(math.radians(origin[1]));points=[((x-origin[0])*sx,(y-origin[1])*111320) for x,y in ring[:-1]]
 best=None
 for i in range(360):
  a=math.radians(i/2);c,s=math.cos(a),math.sin(a);u=[x*c+y*s for x,y in points];v=[-x*s+y*c for x,y in points];w=max(u)-min(u);d=max(v)-min(v)
  # 外輪廓最小包圍矩形；長短轴對應模型，不把任一矩形邊稱為已核實正面。
  cost=w*d*(1+.03*abs(math.log((w/d)/(W/D))))
  if best is None or cost<best[0]:best=(cost,a,(min(u)+max(u))/2,(min(v)+max(v))/2,w,d)
 _,a,u,v,w,d=best;c,s=math.cos(a),math.sin(a);return [origin[0]+(u*c-v*s)/sx,origin[1]+(u*s+v*c)/111320],math.degrees(a),[w,d]
placements={}
for item in json.loads((out/'catalog.json').read_text()):
 mid=item['id'];meta=json.loads((out/mid/'model.json').read_text());p=root/'rail-3d/assets/stations'/mid/'footprint.geojson'
 if mid in ids:
  e=new[ids[mid]];ring=[[p['lon'],p['lat']]for p in e['geometry']];anchor,rotation,extent=fit(ring,*meta['sizeM'][:2]);footprint={'type':'FeatureCollection','features':[{'type':'Feature','properties':{'component':'main','osmWay':e['id']},'geometry':{'type':'Polygon','coordinates':[ring]}}]};sources=[{'url':'https://www.openstreetmap.org/way/'+str(e['id']),'use':'建築輪廓、幾何軸向；正面朝向仍未核實','license':'ODbL-1.0'}]
 else:
  footprint=json.loads(p.read_text());anchor=meta['anchor'];rotation=0;extent=None;sources=[s for s in meta['sources']if 'openstreetmap' in s['url']]
  if meta['orientationMode']=='local-facade':
   ring=footprint['features'][0]['geometry']['coordinates'][0] if footprint['type']=='FeatureCollection' else footprint['geometry']['coordinates'][0]
   _,rotation,extent=fit(ring,*meta['sizeM'][:2])
 placements[mid]={'anchor':anchor,'rotationDeg':rotation,'orientationBasis':'ENU-baked' if meta['orientationMode']=='ENU-baked' else 'OSM-footprint-axis-fit','facadeBearingDeg':None,'footprintExtentM':extent,'footprint':footprint,'sources':sources,'railElevationM':None}
(out/'placement.json').write_text(json.dumps({'version':1,'at':'2026-09-07','entries':placements},ensure_ascii=False,separators=(',',':'))+'\n')
print('完成',len(placements),'款定位；正面方向與工程高程未冒充已核實資料')
