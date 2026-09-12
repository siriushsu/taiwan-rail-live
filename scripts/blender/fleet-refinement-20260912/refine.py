"""首發四款：實拍支持的外觀修正，以及分離夜間發光材質。
使用方式：Blender -b --python refine.py -- <來源 fleet-v1> <輸出目錄>
原檔唯讀，產生六個可編修 .blend 與供車庫／地圖共同使用的 Raw。
"""
import sys,json,math,runpy,hashlib,shutil
from pathlib import Path
from mathutils import Matrix,Vector
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'emu3000-20260912'))
import bpy
import blender_parts as p
import build_models as b
from model_specs import S
source,out=map(Path,sys.argv[sys.argv.index('--')+1:])
catalog=json.loads((source/'catalog.json').read_text())
ids=['emu3000','dr1000','dl38','alicoach','blue','bluecoach']
refs={x['id']:x for x in json.loads((source/'catalog-source.json').read_text())}
old_export=p.export_model

def export(s,dest,reference):
 # 依原生部件區分燈片、客窗、駕駛玻璃。車殼／反光燈圈不發光。
 mats={};roles={};points={};bpy.context.view_layer.update()
 for o in p.MODEL:
  if not getattr(o.data,'materials',None):continue
  name=o.name
  coords=[o.matrix_world@Vector(v) for v in o.bound_box]
  center=sum(coords,Vector())/len(coords)
  role=None
  if '透鏡' in name and '直紋' not in name:
   original=o.data.materials[0].name
   color='tail' if '紅' in name or original in ['red','深紅標誌燈玻璃'] else 'head'
   role=color+('Front' if center.x>0 else 'Rear')
  elif s['family'] in ['express','railcar','coach','forestcoach']:
   if name.startswith(('獨立深色玻璃','門窗玻璃','側門窄長玻璃','上半固定窗','下半開窗暗部','車端霧面小窗')) and '框' not in name:role='window'
  if not role:continue
  for i,orig in enumerate(list(o.data.materials)):
   key=(orig.name,role)
   if key not in mats:
    mat=orig.copy();mat.name='railLight:'+role+':'+orig.name
    # 地圖 LOD 以色票還原材質，微小色差使角色不會與非發光玻璃合併。
    node=mat.node_tree.nodes['Principled BSDF'];c=list(node.inputs['Base Color'].default_value)
    c[0]=min(.999,c[0]+.001*(1+['window','headFront','headRear','tailFront','tailRear'].index(role)))
    node.inputs['Base Color'].default_value=c;mat.diffuse_color=c
    mats[key]=mat;roles[mat.name]=role
   o.data.materials[i]=mats[key]
  if role.startswith('head'):points.setdefault(role,[]).append(list(center))
 m=old_export(s,dest,reference)
 for g in m['mesh']['drawGroups']:
  if g['name'] in roles:g['lightingRole']=roles[g['name']]
 m['lighting']={'schema':1,'headlights':points,'windows':'passenger-only','noPhotoTextures':True}
 m['version']=2;m['specification']['revision']='2026-09-12-fleet-r1'
 (dest/(s['id']+'.model.json')).write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
 return m
p.export_model=export

def remove(prefixes):
 for o in list(p.MODEL):
  if o.name.removeprefix('反向端 ').startswith(tuple(prefixes)):
   p.MODEL.remove(o);bpy.data.objects.remove(o,do_unlink=True)

def mirrored_since(start):
 for o in p.MODEL[start:]:o.matrix_world=Matrix.Rotation(math.pi,4,'Z')@o.matrix_world

def dr(s):
 b.passenger(s);H=s['H'];L=s['L'];W=s['W']
 remove(['雙圓式腰燈','上方頭燈座','頂部頭燈','斜肩空調設備罩','空調側格柵','空調頂部細格柵','罩體邊框'])
 # DRC1021 實拍：左右前窗上方各一圓頭燈，腰部是紅色標誌燈。
 for end in [1,-1]:
  start=len(p.MODEL);f=lambda y,z:L/2-.018*(abs(y)/(W/2))**4
  for side in [-1,1]:
   b.front_panel('DR1000 額燈黑底',f,side*.91,3.03,.68,.37,'frame',.10,.035)
   p.lamp('DR1000 前窗上方圓燈',f,side*.91,3.03,.096)
   p.lamp('DR1000 腰部紅標誌燈',f,side*1.03,1.40,.087,True)
  if end<0:mirrored_since(start)
 # 2014/06/09 彰化車頂實拍：端部冷氣、中央冷卻風扇與外露管路。
 p.use('05')
 for x in [-L*.32,L*.32]:
  p.box('DR1000 端部空調罩',(x,0,H+.12),(1.22,W*.67,.28),'roof',.10)
  for y in [-.32,.32]:p.cyl('DR1000 空調頂部風口',(x,y,H+.27),.15,.018,'chassis',n=20)
 for x in [-.95,-.58,-.21,.16]:
  p.cyl('DR1000 引擎散熱風扇護罩',(x,0,H+.19),.23,.19,'roof',n=24)
  p.cyl('DR1000 散熱風扇暗部',(x,0,H+.29),.195,.012,'chassis',n=24)
  for y in [-.11,0,.11]:p.rod('DR1000 風扇護網',(x-.16,y,H+.31),(x+.16,y,H+.31),.008,'metal')
 for y in [-.43,.43]:
  p.cyl('DR1000 車頂圓筒設備',(.91,y,H+.16),.15,.62,'roof','X',20)
  p.line('DR1000 外露冷卻管路',[(.40,y,H+.08),(.48,y,H+.34),(1.27,y,H+.34),(1.38,y,H+.08)],.043,'chassis')

def dl(s):
 b.forest_loco(s);L,W,H=s['L'],s['W'],s['H'];top=H-.48;end=L/2-.16
 remove(['DL38 小型頭燈','DL38 駕駛室頂燈'])
 # 2013/02/28 實拍：小型圓燈由支架架在長罩頂上，非後代的大燈筒。
 p.use('03')
 for y in [-W*.31,W*.31]:
  p.rod('DL38 長端頭燈立架',(end-.04,y,top),(end-.04,y,top+.22),.025,'metal')
  p.lamp('DL38 長端支架圓頭燈',lambda y,z:end-.10,y,top+.25,.090)
 # 短端為無散熱孔的平滑鼻罩；補原模缺少的後窗、白飛翼與兩盞燈。
 p.use('01');p.box('DL38 無散熱孔短端罩',(-L/2+.32,0,1.46),(.55,W*.80,1.51),'body',.045)
 start=len(p.MODEL);f=lambda y,z:L/2-.04
 for side in [-1,1]:
  b.front_panel('DL38 短端駕駛前窗框',lambda y,z:L*.31+.72,side*.46,H-.51,.78,.67,'frame',.08,.025)
  b.front_panel('DL38 短端駕駛前窗玻璃',lambda y,z:L*.31+.72,side*.46,H-.51,.68,.56,'glass',.055,.046)
  b.front_ribbon('DL38 短端白色飛翼',f,[(side*.86,1.53),(side*.53,1.44),(side*.25,1.22),(0,.91)],.16,'accent')
  p.lamp('DL38 短端圓頭燈',f,side*.71,1.99,.085)
 p.lamp('DL38 短端紅標誌燈',f,.86,1.52,.073,True)
 mirrored_since(start)
 # 短端橫向安全扶手，照片不具百葉，因此不鏡射長端格柵。
 p.use('03');p.line('DL38 短端安全扶手',[(-3.16,-.83,2.22),(-3.16,-.83,2.35),(-3.16,.83,2.35),(-3.16,.83,2.22)],.019,'metal')

def blue(s):
 import build_breezy_blue as bb
 bb.locomotive(s);L,W=s['L'],s['W'];end=L/2
 p.use('03')
 # R135 太麻里官方原照中可辨識的前端煞車管與排障板，不增繪徽章。
 for side in [-1,1]:
  p.line('R135 前端煞車軟管',[(end+.09,side*.63,.97),(end+.20,side*.51,.68),(end+.20,side*.30,.54)],.035,'chassis')
  p.cyl('R135 管路接頭',(end+.20,side*.30,.55),.048,.10,'metal','Z',16)
  p.rod('R135 前端橫向扶桿',(end+.045,side*.99,1.02),(end+.045,side*.43,.88),.023,'body')
 p.use('04');p.cyl('R135 車底圓筒油箱',(-.10,0,.69),.27,2.0,'chassis','X',24)

for id in ids:
 if id=='emu3000':
  saved=sys.argv;sys.argv=[str(HERE.parent/'emu3000-20260912/refine.py'),'--',str(out)]
  runpy.run_path(sys.argv[0],run_name='__main__');sys.argv=saved
  continue
 s=dict(S[id]);p.reset(s)
 if id=='dr1000':dr(s)
 elif id=='dl38':dl(s)
 elif id=='blue':blue(s)
 else:
  b.coach(s)
  if id=='bluecoach':
   # 原 builder 的窗台在迴圈外，只建立最後一扇；補齊其餘八扇。
   p.use('02')
   for side in [-1,1]:
    for j in range(s['windows']-1):p.box('藍皮開窗下窗台補齊',(-3.03+j*.67,side*(s['W']/2+.065),1.80),(.56,.043,.033),'windowlight',.004)
 export(s,out/'models'/id,refs[id])

items=[]
for item in catalog:
 if item['id'] not in ids:continue
 item=dict(item);id=item['id'];item['metadata']=f'models/{id}/{id}.model.json';item['thumbnail']=f'models/{id}/thumbnail.webp'
 original=source/next(x['thumbnail'] for x in catalog if x['id']==id)
 shutil.copy2(original,out/item['thumbnail']);items.append(item)
(out/'catalog.json').write_text(json.dumps(items,ensure_ascii=False,indent=2)+'\n')
(out/'release.json').write_text(json.dumps({'revision':'2026-09-12-fleet-r1','models':{i:json.loads((out/f'models/{i}/{i}.model.json').read_text())['mesh']['sha256'] for i in ids}},indent=2)+'\n')
