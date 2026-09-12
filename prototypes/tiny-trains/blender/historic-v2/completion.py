"""2026-09-12 外觀補件。每個新增部件必須另有 placements-source 位置依據。"""
def remove_parts(prefixes):
 for o in list(OB):
  if any(o['component_id'].startswith(p) for p in prefixes):
   OB.remove(o);bpy.data.objects.remove(o,do_unlink=True)

def platform_roof(name,w,d,h=3.4,z=.55):
 # 泰安照片可見兩排再利用鋼軌柱；保留中央通行空間。
 with component(name):
  pitched('低坡月台雨庇',0,0,w,d,z+h,.35,'dark')
  n=max(2,int(w/5))
  for i in range(n):
   x=-w/2+1+(w-2)*i/(n-1)
   for side in [-1,1]:
    y=side*d*.30
    rod('再利用鋼軌柱',(x,y,z),(x,y,z+h),.075,'sage')
    rod('棚架斜撐',(x,y,z+h-.65),(x,side*d*.47,z+h),.055,'sage')

def arcade_span(x,y,z,w,h):
 # 真的挖空拱廊：只建立拱頂到簷口間的牆，不能用黑窗貼在實心牆上。
 r=w/2;cz=z+h-r;v=[]
 for i in range(17):
  a=math.pi-math.pi*i/16;xx=x+r*math.cos(a);zz=cz+r*math.sin(a)
  v.extend([(xx,y,zz),(xx,y,z+h+.45)])
 mesh('開放拱廊拱券',v,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(16)],'cream')

def complete_exterior(s):
 global DETAIL
 id=s['id'];plan=json.loads((P/'placements-source.json').read_text())[id]
 if id in ['shanjia-old','guanshan-old']:
  walls=[o for o in OB if o['component_id']=='舊站房 / 立面']
  points=[o.matrix_world@v.co for o in walls for v in o.data.vertices]
  xlo,xhi=min(v.x for v in points),max(v.x for v in points)
  ylo,yhi=min(v.y for v in points),max(v.y for v in points)
  with component('舊站房 / 保存平台'):
   if id=='shanjia-old':
    box('舊站背側月台',0,yhi+1.5,.24,xhi-xlo+5,3,.48,'stone')
   else:
    box('站前低平台',0,ylo-1.8,.12,xhi-xlo+2,4,.24,'stone')
 if id=='chiayi-sawmill':
  remove_parts(['動力室','鋸屑室架空斜板','煙囪基座遺構'])
  with component('動力室 / 立面'):
   box('RC 牆身',0,0,4,15,22,8,'white');box('基礎',0,0,.2,15.3,22.3,.4,'stone')
   for sy in [-1,1]:
    st=len(OB)
    for x in [-5.5,-2.75,0,2.75,5.5]:
     for z in [2.2,6.1]:window(x,-11.05,z,1.25,2.3,'sage')
    for x in [-7.25,-4.1,-1.35,1.35,4.1,7.25]:box('立面壁柱',x,-11.18,4,.22,.3,8,'stone')
    if sy==-1:
     box('入口雙門',0,-11.24,1.45,2.1,.12,2.9,'brown');box('入口平頂雨庇',0,-11.7,3.1,3.5,1.5,.17,'sage')
    rotate_since(st,0,0,0 if sy==-1 else 180)
   for sx in [-1,1]:
    st=len(OB)
    for x in [-8.5,-5.7,-2.85,0,2.85,5.7,8.5]:
     for z in [2.2,6.1]:window(x,-7.55,z,1.25,2.3,'sage')
    rotate_since(st,0,0,90 if sx==1 else -90)
  with component('動力室 / 屋頂'):pitched('低坡鋼板屋頂',0,0,15.4,22.4,8,.9,'roof')
  with component('鋸屑室'):
   for x in [-5.5,0,5.5]:
    for y in [-4.5,4.5]:box('混凝土支柱',x,y,3,.45,.5,6,'stone')
   mesh('架空雙斜板',[(-6,-5,6),(6,-5,6),(-6,0,2.8),(6,0,2.8),(-6,5,6),(6,5,6)],[(0,1,3,2),(2,3,5,4)],'stone')
   for x in [-5.5,0,5.5]:rod('斜板下樑',(x,-4.5,5.8),(x,0,2.7),.15,'stone');rod('斜板下樑',(x,0,2.7),(x,4.5,5.8),.15,'stone')
  with component('煙囪遺構'):
   taper('斷裂紅磚基座',0,0,0,4,4,3.2,3.2,2.8,'red')
   box('煙道殘牆',0,2.8,.7,1.6,3.6,1.4,'red')
 if id=='taian-old':
  remove_parts(['舊站房','舊月台','高位舊月台雨庇','地下道入口','紀念碑'])
  wallunit('舊站房',0,0,24,10,3.8,'stone',roofkind='flat',windows=False)
  with component('舊站房 / 立面細節'):
   for y,angle in [(-5,0),(5,180)]:
    st=len(OB)
    for x in [-9,-5,5,9]:window(x,-5.1,2,1.7,2.2,'sage')
    box('站房入口',0,-5.2,1.4,2.2,.16,2.8,'dark');rotate_since(st,0,0,angle)
   for x in [-10,-6,-2,2,6,10]:rod('站房背側圓柱',(x,6.8,.1),(x,6.8,3.6),.17,'cream',12)
   box('背側平頂走廊',0,6.2,3.65,24.5,3.4,.25,'stone')
  with component('保存月台'):
   # 地形關閉時月台上移 4.5m；向下延伸的路基仍接地，開啟地形則埋入山坡。
   box('高位月台路基',0,0,-2.25,200,5.8,4.5,'stone')
   box('低矮月台緣',0,0,.26,200,6,.52,'stone')
   for side in [-1,1]:box('月台邊石',0,side*2.9,.57,200,.20,.10,'cream')
  platform_roof('月台雨庇',43,5.5)
  with component('地下道入口'):
   for x in [-1.45,1.45]:box('地下道側牆',x,0,1.25,.35,4,2.5,'stone')
   box('平頂入口',0,0,2.6,3.25,4,.2,'stone');box('地下道暗部',0,1.9,1.15,2.55,.12,2.3,'dark')
  with component('震災復興紀念碑'):
   box('碑座',0,0,.22,2.8,2.8,.44,'stone');box('石碑臺座',0,0,.85,1.7,1.7,.9,'stone')
   rod('砲彈形碑身',(0,0,1.3),(0,0,3.8),.42,'stone',16)
   rings=[(.42,3.8),(.39,4),(.28,4.3),(.06,4.55)];vs=[(r*math.cos(i*math.tau/16),r*math.sin(i*math.tau/16),z) for r,z in rings for i in range(16)]
   mesh('碑身圓頂',vs,[(j*16+i,j*16+(i+1)%16,(j+1)*16+(i+1)%16,(j+1)*16+i) for j in range(3) for i in range(16)]+[tuple(range(48,64))],'stone')
 if id=='longtian-warehouses':
  remove_parts(['地磅室'])
  with component('地磅室遺構'):
   box('遺址地坪',0,0,.08,2.5,2.2,.16,'stone')
   for x in [-1.17,1.17]:box('殘存側牆磚基',x,0,.14,.16,2.2,.20,'red')
   box('殘存背牆磚基',0,1.02,.16,2.5,.16,.24,'red');box('殘存隔間基礎',-.2,0,.12,.20,2,.24,'stone')
 if id=='qiaotou-sugar':
  remove_parts(['辦公廳舍','工場煙囪','入口門廊'])
  with component('社宅事務所'):
   box('架高基座',0,0,.55,27,14,1.1,'stone');box('室內牆身',0,1.7,3.2,26,9.5,4.2,'cream')
   pitched('後退低坡瓦頂',0,1.1,27,12,5.3,2,'dark',True)
   for i in range(9):
    x=-12+i*3
    if i<8:arcade_span(x+1.5,-6.4,1.1,2.55,3.8)
    box('拱廊方柱',x,-6.4,2.6,.45,.55,3,'cream')
    box('柱腳',x,-6.4,1.3,.7,.8,.4,'cream');box('柱頭',x,-6.4,3.9,.7,.8,.25,'cream')
   box('立面簷帶',0,-6.4,5.2,26.7,.7,.45,'cream');box('立面女兒牆',0,-6.4,5.9,26.7,.4,1,'cream')
   box('入口中央高女兒牆',0,-6.5,6.9,6.3,.5,1.5,'cream')
   for x in [-3.1,3.1]:box('中央複柱',x,-6.6,4.4,.7,.6,6.5,'cream')
   for x in [-10.5,-7.5,-4.5,4.5,7.5,10.5]:window(x,-3.2,2.8,1.5,2.5,'cream')
   for x in [-4.6,4.6]:steps(x,-8.1,2.5,3,1.1,6)
   DETAIL=True
   for x in range(-11,12,2):box('女兒牆小方孔',x,-6.62,5.9,.22,.03,.22,'dark')
   DETAIL=False
  with component('工場煙囪'):
   rod('地面煙囪基礎',(0,0,0),(0,0,2),2.5,'stone',20)
   rod('煙囪主筒',(0,0,2),(0,0,32),1.6,'smoke',20)
   rod('頂端環帶',(0,0,30),(0,0,31),2,'stone',20)
   DETAIL=True
   for z in range(3,31,3):line('煙囪鐵箍',[(1.63*math.cos(i*math.tau/24),1.63*math.sin(i*math.tau/24),z) for i in range(25)],.045,'metal')
   DETAIL=False
 # 用單獨位置資料生成已核對的附屬構件，未核對的通用站棚仍不會被匯出。
 for item in plan.get('additions',[]):
  name=item['name'];kind=item['kind'];w,d=item['sizeM']
  if kind=='platform':
   with component(name):
    box('保存月台面',0,0,.26,w,d,.52,'stone')
    for side in [-1,1]:box('月台邊石',0,side*(d/2-.1),.56,w,.20,.08,'cream')
  elif kind=='canopy':platform_roof(name,w,d)
  elif kind=='shed':wallunit(name,0,0,w,d,3,'brown',rise=1.7)
  elif kind=='library':
   wallunit(name,0,0,w,d,2.9,'brown',rise=1.0,windows=False)
   with component(name+' / 窗列'):
    for angle in [90,-90]:
     st=len(OB)
     for x in [-3.8,-1.9,0,1.9,3.8]:window(x,-w/2-.07,1.9,1.65,1.15,'dark')
     rotate_since(st,0,0,angle)
 s['completionReview']=plan.get('completionReview')
