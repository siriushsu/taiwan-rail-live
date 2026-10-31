"""EMU3000 首輪：依日立正面原照校正前窗、面罩、燈組及車鉤蓋。
Blender -b --factory-startup --python refine.py -- /absolute/output/directory
配套三份 Python 為既有工坊快照，只輸出 emu3000，保留原始模型。
"""
import sys, json, math
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import blender_parts as p
import build_models as b
from model_specs import S
import bpy

out=Path(sys.argv[sys.argv.index('--')+1])
s=dict(S['emu3000']);s['revision']='2026-09-12-front-r1'
ref=next(x for x in json.loads((HERE/'catalog-source.json').read_text()) if x['id']=='emu3000')
p.reset(s)
b.passenger(s)

# 只替換已由正面原照確認的部件，其他車系不受影響。
prefixes=('EMU3000 連續黑面罩','流線前窗','EMU3000 額頭','EMU3000 頭燈',
          'EMU3000 車鉤蓋','獨立雨刷臂','雨刷膠條')
for o in list(p.MODEL):
 if o.name.startswith(prefixes):
  p.MODEL.remove(o);bpy.data.objects.remove(o,do_unlink=True)

L,W,H=s['L'],s['W'],s['H']
profile=[(.83,L/2-.12),(1.2,L/2),(1.8,L/2-.13),(2.70,L/2-.48),(H,L/2-.86)]
def f(y,z):return b.interp(profile,z)-.08*(abs(y)/(W/2))**4

def patch(name,profile,material,offset):
 """閉合、密化的曲面薄殼；每列寬度由實車輪廓控制，避免跨平面與共面。"""
 p.use('03');rows=28;cols=20;verts=[]
 for d in [-.006,.006]:
  for i in range(rows+1):
   z=profile[0][0]+(profile[-1][0]-profile[0][0])*i/rows
   half=b.interp(profile,z)
   for j in range(cols+1):
    y=half*(2*j/cols-1);verts.append((f(y,z)+offset+d,y,z))
 n=(rows+1)*(cols+1);faces=[]
 for i in range(rows):
  for j in range(cols):
   a=i*(cols+1)+j;c=a+cols+1
   faces.extend([(a,a+1,c+1,c),(n+a,n+c,n+c+1,n+a+1)])
 edge=list(range(cols+1))+[i*(cols+1)+cols for i in range(1,rows+1)]+list(range(rows*(cols+1)+cols-1,rows*(cols+1)-1,-1))+[i*(cols+1) for i in range(rows-1,0,-1)]
 faces.extend((a,n+a,n+c,c) for a,c in zip(edge,edge[1:]+edge[:1]))
 return p.mesh(name,verts,faces,material,0,True)

patch('EMU3000 向下收尖曲面黑面罩',[(1.53,.12),(1.56,.37),(1.64,.66),(1.82,.88),(2.12,1.03),(2.65,1.25),(3.08,1.31),(3.23,1.21),(3.31,.93),(3.34,.30)],'frame',.032)
patch('EMU3000 上寬下窄前窗膠邊',[(2.12,.60),(2.17,.70),(2.88,1.04),(2.94,1.02)],'chassis',.054)
patch('EMU3000 梯形駕駛前窗',[(2.18,.59),(2.22,.65),(2.85,.96),(2.88,.94)],'glass',.077)

# 日立照片的額頭雙圓燈，和左右腰燈（上白、下紅），分開做燈座及透鏡。
b.front_panel('EMU3000 額頭燈座',f,0,3.12,.63,.29,'chassis',.04,.064)
for y in [-.16,.16]:p.lamp('EMU3000 額頭圓燈',f,y,3.12,.074)
for side in [-1,1]:
 b.front_panel('EMU3000 腰燈膠框',f,side*.79,1.98,.34,.43,'chassis',.08,.060)
 b.front_panel('EMU3000 腰燈暗色罩',f,side*.79,1.98,.29,.38,'glass',.065,.085)
 p.lamp('EMU3000 腰部白燈',lambda y,z:f(y,z)+.025,side*.79,2.065,.065)
 p.lamp('EMU3000 腰部紅標誌燈',lambda y,z:f(y,z)+.025,side*.79,1.905,.044,True)

# 實車是大型 U 形鼻端蓋，取代原本細小的橫向矩形。
b.front_ribbon('EMU3000 U形車鉤蓋縫',f,[(-.84,1.79),(-.84,1.48),(-.81,1.12),(-.68,.94),(-.40,.89),(0,.88),(.40,.89),(.68,.94),(.81,1.12),(.84,1.48),(.84,1.79)],.008,'metal')
# 單組中央樞軸雨刷向一側停放，保留雙連桿輪廓。
def pt(y,z):return (f(y,z)+.13,y,z)
p.use('03')
for dy in [-.026,.026]:p.line('EMU3000 中央雨刷連桿',[pt(dy,2.16),pt(.57+dy,2.32),pt(.70+dy,2.64)],.010,'chassis')
p.line('EMU3000 單組雨刷膠條',[pt(.62,2.27),pt(.80,2.77)],.017,'frame')

meta=p.export_model(s,out/'models/emu3000',ref)
meta['reference']['frontPhoto']='https://www.hitachi.com/rd/research/design/product/taiwan_tra/image/img_03.jpg'
meta['reference']['scope']='front-only; ED3012 photo; Q proportions; side windows and roof not newly certified'
(out/'models/emu3000/emu3000.model.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
