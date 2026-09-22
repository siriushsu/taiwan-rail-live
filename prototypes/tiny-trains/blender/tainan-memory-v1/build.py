"""臺南舊站：OSM 國定古蹟輪廓＋文資局／臺鐵所述立面；高度為建模估值。"""
from pathlib import Path
HERE=Path(__file__).resolve().parent
SHARED=HERE.parent/'historic-v2'
__file__=str(SHARED/'export_core.py')
exec(compile((SHARED/'export_core.py').read_text(),str(SHARED/'export_core.py'),'exec'))
P=HERE
foot=json.loads((HERE/'station-footprint.json').read_text())
spec={'id':'tainan-old','name':'臺南舊站房','kind':'tainan-old','anchor':foot['anchor'],'rotationDeg':foot['rotationDeg'],'osmId':6477070,'osmType':'relation','priority':1,'components':[{'id':name} for name in ['舊站主體','七扇長拱窗','三拱門廊','鐘面與女兒牆','後側候車翼樓']],'sources':[{'label':'文化部文化資產局／台南火車站','url':'https://view.boch.gov.tw/NationalHistorical/itemspage.aspx?id=27'},{'label':'臺鐵／臺南驛建築特色','url':'https://www.railway.gov.tw/tra-tip-web/tip/tip005/tip511/detail/0999020200197'},{'label':'OpenStreetMap／臺南火車站輪廓','url':'https://www.openstreetmap.org/relation/6477070'}],'scope':'1936 年舊站房外觀；依 OSM 平面輪廓及官方建築說明製作。樓高、局部比例與色彩為外觀估計，非測繪模型；不含完整臨時施工設施。','snapshotDate':'2026-09-12','estimatedHeightM':13.8,'sourcePhotosIncluded':False}
COLORS.update(stone='B5AEA0',cream='D8CFB6',white='E7DFCA',roof='B0B4AA',glass='4C6264')
reset(spec)
with component('舊站主體'):
 polyextrude('國定古蹟外框基座',foot['local'][:-1],0,.35,'stone')
 # 凸字形前廳與後側橫翼；平面外框依來源，垂直層次依公開外觀作估計。
 polygon=foot['local'][:-1];clipped=[]
 for a,b in zip(polygon,polygon[1:]+polygon[:1]):
  if a[1]>=-9.65:clipped.append(a)
  if (a[1]>=-9.65)!=(b[1]>=-9.65):
   f=(-9.65-a[1])/(b[1]-a[1]);clipped.append((a[0]+(b[0]-a[0])*f,-9.65))
 polyextrude('低層外框／門廊保持開放',clipped,.35,4.25,'cream')
 box('挑高售票大廳',-.6,-2.2,6.65,25.0,15.0,12.6,'stone')
 box('正面腰線',-.6,-9.84,5.0,25.4,.28,.3,'cream')
 box('簷口線腳',-.6,-2.2,12.8,25.7,15.7,.55,'cream')
 box('平頂屋面',-.6,-2.2,13.1,25.4,15.4,.2,'roof')
with component('七扇長拱窗'):
 for i in range(7):
  x=-10.5+i*3.3;window(x,-9.79,8.6,1.82,4.15,'cream',True)
  box('窗下洗石子窗臺',x,-10.02,6.48,2.18,.34,.2,'white')
 for x in [-5.65,-2.35,.95,4.25]:
  box('中央三窗壁柱',x,-9.99,8.8,.40,.35,5.9,'cream')
  box('壁柱柱頭',x,-10.1,11.8,.7,.5,.26,'white')
with component('三拱門廊'):
 # 開放的門廊不放實心牆；拱洞後的主廳門窗用陰影表現。
 box('門廊雨庇',-1.3,-11.3,4.85,17.5,4.1,.45,'cream')
 for x in [-9.3,-4.0,1.3,6.6]:box('門廊方柱',x,-12.75,2.25,.64,.7,4.5,'cream')
 for x in [-6.65,-1.35,3.95]:
  r=2.33;z=2.0
  for i in range(24):
   a=i*math.pi/24;b=(i+1)*math.pi/24
   poly=[(x+rr*math.cos(t),z+rr*math.sin(t)) for rr,t in [(r,a),(r,b),(r+.38,b),(r+.38,a)]]
   verts=[(xx,yy,zz) for yy in [-13.12,-12.48] for xx,zz in poly]
   mesh('門廊圓拱石框',verts,[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],'cream')
  window(x,-9.80,2.15,2.8,3.5,'cream',False)
with component('鐘面與女兒牆'):
 box('正面女兒牆',-.6,-9.72,13.25,25.7,.5,.5,'cream')
 mesh('中央小山形壁',[(-3.7,-10.0,13.3),(2.5,-10.0,13.3),(-.6,-10.0,13.95)],[(0,1,2)],'cream')
 rod('圓鐘外框',(-.6,-10.15,12.03),(-.6,-10.27,12.03),.74,'cream',48)
 rod('淺色鐘面',(-.6,-10.28,12.03),(-.6,-10.3,12.03),.60,'white',48)
 for i in range(12):
  a=i*math.pi/6;rod('鐘面刻度',(-.6+math.sin(a)*.47,-10.33,12.03+math.cos(a)*.47),(-.6+math.sin(a)*.54,-10.33,12.03+math.cos(a)*.54),.018,'dark',4)
 rod('固定示意時針',(-.6,-10.35,12.03),(-.90,-10.35,12.20),.03,'dark',6)
 rod('固定示意分針',(-.6,-10.35,12.03),(-.6,-10.35,12.47),.022,'dark',6)
with component('後側候車翼樓'):
 # 橫翼頂層退在主廳後方，保留凸字形輪廓。
 box('後側二樓橫翼',0,15.05,6.8,49.7,18.0,4.4,'stone')
 box('橫翼簷口',0,15.05,9.05,50.2,18.5,.4,'cream')
 box('橫翼屋面',0,15.05,9.28,49.9,18.2,.12,'roof')
 for x in [-22,-18.5,-15,14.5,18,21.5]:
  for z in [2.5,6.8]:window(x,5.98,z,1.5,2.5,'cream',False)
 for x in range(-22,24,4):
  st=len(OB)
  for z in [2.5,6.8]:window(-x,-24.15,z,1.5,2.5,'cream',False)
  rotate_since(st,0,0,180)
spec['pendingChecks']=['樓高與立面尺寸目前為外觀估值','時鐘指針固定示意，非封存當刻時刻','施工圍籬與臨時設施未完整重建']
export(spec)
