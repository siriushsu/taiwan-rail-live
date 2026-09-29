"""可追溯的平面校正：已知建物輪廓才做尺度擬合；地點座標不冒充測量輪廓。"""
import math,json
from pathlib import Path
P=Path(__file__).resolve().parent

def rings(e):
 if e.get('geometry'):return [[[p['lon'],p['lat']] for p in e['geometry']]]
 return [[[p['lon'],p['lat']] for p in m['geometry']] for m in e.get('members',[]) if m.get('role')=='outer' and m.get('geometry')]

def fit(coords,ratio=2):
 x0,y0=coords[0];sx=111320*math.cos(math.radians(y0));pts=[((x-x0)*sx,(y-y0)*111320) for x,y in coords]
 best=None
 for i in range(720):
  a=math.radians(i/4);c,s=math.cos(a),math.sin(a);u=[x*c+y*s for x,y in pts];v=[-x*s+y*c for x,y in pts];w=max(u)-min(u);d=max(v)-min(v)
  if min(w,d)<.1:continue
  cost=w*d*(1+.01*abs(math.log(w/d/ratio)))
  if best is None or cost<best[0]:best=(cost,a,(min(u)+max(u))/2,(min(v)+max(v))/2,w,d)
 _,a,u,v,w,d=best;c,s=math.cos(a),math.sin(a)
 return {'anchor':[x0+(u*c-v*s)/sx,y0+(u*s+v*c)/111320],'rotationDeg':math.degrees(a),'extentM':[w,d]}

def apply_calibration(s):
 global OB
 plan=json.loads((P/'placements-source.json').read_text())[s['id']];anchor=plan['anchor'];sx=111320*math.cos(math.radians(anchor[1]));assigned=set();parts=[];features=[];notes=[]
 for item in plan['parts']:
  selected=[o for o in OB if any(o['component_id'].startswith(p) for p in item['prefixes']) and o not in assigned]
  if not selected:raise ValueError((s['id'],item['name'],'未匹配元件'))
  reference=[o for o in selected if any(o['component_id'].startswith(p) for p in item.get('fitPrefixes',item['prefixes'])) and not any(o['component_id'].startswith(p) for p in item.get('fitExcludePrefixes',[]))]
  pts=[o.matrix_world@v.co for o in reference for v in o.data.vertices];lo=[min(v[j] for v in pts) for j in range(2)];hi=[max(v[j] for v in pts) for j in range(2)];center=[(lo[j]+hi[j])/2 for j in range(2)];dims=[hi[j]-lo[j] for j in range(2)]
  if 'footprints' in item:
   rs=[r for e in item['footprints'] for r in rings(e)];f=fit([p for r in rs for p in r],dims[0]/dims[1]);target=f['anchor'];angle=f['rotationDeg']+item.get('flipDeg',0);scale=[f['extentM'][j]/dims[j] for j in range(2)]
   for e in item['footprints']:
    for r in rings(e):features.append({'type':'Feature','properties':{'component':item['name'],'osmType':e['type'],'osmId':e['id']},'geometry':{'type':'Polygon','coordinates':[r]}})
   status='footprint-axis-calibrated'
  else:
   target=item['anchor'];angle=item['rotationDeg'];scale=[item.get('extentM',dims)[j]/dims[j] for j in range(2)];status='site-anchor-estimated-outline'
   w,d=item.get('extentM',dims);aa=math.radians(angle);cc,ss=math.cos(aa),math.sin(aa);ts=111320*math.cos(math.radians(target[1]));rr=[[target[0]+(x*cc-y*ss)/ts,target[1]+(x*ss+y*cc)/111320] for x,y in [(-w/2,-d/2),(w/2,-d/2),(w/2,d/2),(-w/2,d/2),(-w/2,-d/2)]]
   features.append({'type':'Feature','properties':{'component':item['name'],'outlineEstimated':True},'geometry':{'type':'Polygon','coordinates':[rr]}})
  a=math.radians(angle);mat=Matrix.Translation(Vector(((target[0]-anchor[0])*sx,(target[1]-anchor[1])*111320,0)))@Matrix.Rotation(a,4,'Z')@Matrix.Diagonal(Vector((*scale,1,1)))@Matrix.Translation(Vector((-center[0],-center[1],0)))
  for o in selected:o.matrix_world=mat@o.matrix_world;o['original_component_id']=o['component_id'];o['component_id']=item['name'];assigned.add(o)
  parts.append({'id':item['name'],'name':item['name'],'placementStatus':status,'anchor':target,'rotationDeg':angle,'scaleXY':scale,'basis':item['basis'],'facadeBearingDeg':item.get('facadeBearingDeg'),**({'terrainAnchor':item['terrainAnchor']} if 'terrainAnchor' in item else {}),**({'flatGroundOffsetM':item['flatGroundOffsetM']} if 'flatGroundOffsetM' in item else {})})
 for o in list(OB):
  if o not in assigned:notes.append(o['component_id']);OB.remove(o);bpy.data.objects.remove(o,do_unlink=True)
 s.update(anchor=anchor,components=parts,orientationMode='ENU-baked',placementStatus='calibrated-plan' if all(p['placementStatus']=='footprint-axis-calibrated' for p in parts) else 'mixed-plan-and-site-anchor',geometryStatus='plan-calibrated-exterior-estimated',absoluteGroundAltitudeM=None,railElevationM=None,omittedUnlocatedComponents=sorted(set(notes)),scope='按來源輪廓校正平面位置與尺度；高度、立面細節及正面方向仍為外觀估計',pendingChecks=['高度測量與完整多面立面校正','正面方向複核']+(['未定位附屬構件：'+ '、'.join(sorted(set(notes)))] if notes else []))
 SC['axes']='X east / Y north / Z up; meters; WGS84 anchor in model.json'
 s['mapEligible']=plan.get('mapEligible',False)
 if not s['mapEligible']:s['scope']='僅供定位研究的草模；尚未確認逐棟位置及輪廓，不納入地圖';s['placementStatus']='pending-georeference';s['geometryStatus']='draft-estimated'
 s['sources']+=plan['sources'];s['calibration']={'version':2,'basis':'各部件獨立平面擬合；非工程測繪','parts':parts,'verticalDatum':'terrain-relative','sourceFile':'placements-source.json'}
 if plan.get('completionReview'):
  s['scope']='依來源校正平面與補齊可確認附屬構件；尺寸與高度屬地圖外觀估計，非工程測繪'
  s['completionReview']=plan['completionReview']
 (P/'placements').mkdir(exist_ok=True)
 (P/'placements'/(s['id']+'.json')).write_text(json.dumps({'anchor':anchor,'rotationDeg':0,'orientationBasis':'ENU-baked','facadeBearingDeg':None,'railElevationM':None,'footprint':{'type':'FeatureCollection','features':features},'sources':plan['sources']},ensure_ascii=False,indent=2))
 return parts
