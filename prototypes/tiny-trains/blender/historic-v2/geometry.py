# 各建物的外觀草模。尺度是明列的建模估值，不能當成測繪座標。
from contextlib import contextmanager
COLORS['sage']='78968A'
@contextmanager
def component(name):
 global PART
 old=PART;PART=name
 yield
 PART=old

def rotate_since(start,x,y,angle):
 m=Matrix.Translation(Vector((x,y,0)))@Matrix.Rotation(math.radians(angle),4,'Z')
 for o in OB[start:]:o.matrix_world=m@o.matrix_world

def pitched(name,x,y,w,d,z,rise,material='dark',hip=False):
 global DETAIL
 # 屋脊沿建物長軸，避免狹長廠房與十字樓被做成橫跨短邊的巨大斜坡。
 if d>w:
  st=len(OB);pitched(name,0,0,d,w,z,rise,material,hip);rotate_since(st,x,y,90);return
 # 直線日式／工業屋頂；非中式曲面屋簷。
 ridge=max(0,w/2-d*.45) if hip else w/2
 v=[(x-w/2,y-d/2,z),(x+w/2,y-d/2,z),(x+w/2,y+d/2,z),(x-w/2,y+d/2,z),(x-ridge,y,z+rise),(x+ridge,y,z+rise)]
 mesh(name,v,[(0,1,5,4),(1,2,5),(2,3,4,5),(3,0,4)],material)
 for a,b in [(0,1),(1,2),(2,3),(3,0),(4,5)]:rod('屋頂簷緣',v[a],v[b],.09,material)
 DETAIL=True
 for i in range(1,max(2,int(w/.65))):
  xx=x-w/2+w*i/max(2,int(w/.65));r=rise if not hip else rise*min(1,(w/2-abs(xx-x))/max(.01,w/2-ridge))
  for sy in [-1,1]:line('屋面肋條',[(xx,y,z+r+.035),(xx,y+sy*d/2,z+.035)],.028,'roof' if material=='metal' else material)
 DETAIL=False

def window(x,y,z,w=1.2,h=1.8,frame='cream',arched=False):
 global DETAIL
 if arched:arch(x,y,z-h/2,w,h,'glass')
 else:box('窗框',x,y,z,w+.18,.13,h+.18,frame);box('窗洞陰影',x,y-.075,z,w,.04,h,'dark');box('窗玻璃',x,y-.103,z,w-.08,.025,h-.08,'glass')
 DETAIL=True
 box('窗中梃',x,y-.14,z,.065,.05,h,frame);box('窗橫梃',x,y-.15,z,w,.05,.065,frame)
 DETAIL=False

def wallunit(name,x,y,w,d,h,wall='brown',z=0,roofkind='hip',rise=2.2,windows=True):
 global DETAIL
 with component(name+' / 立面'):
  box('基座',x,y,z+.23,w+.3,d+.3,.46,'stone');box('外牆',x,y,z+h/2,w,d,h,wall)
  if windows:
   for sy in [-1,1]:
    start=len(OB)
    for k in range(max(1,int(w/3.3))):
     xx=-w/2+(k+.5)*w/max(1,int(w/3.3));window(xx,-d/2-.04,z+min(h*.53,2.5),min(1.6,w*.2),min(2,h*.45),'cream' if wall!='brown' else 'stone')
    rotate_since(start,x,y,0 if sy==-1 else 180)
  DETAIL=True
  if wall in ['brown','sage']:
   for k in range(1,int(h/.25)):
    zz=z+k*.25
    for sy in [-1,1]:box('雨淋板搭接',x,y+sy*(d/2+.014),zz,w,.028,.026,'dark')
  DETAIL=False
 with component(name+' / 屋頂'):
  if roofkind=='flat':box('平屋頂',x,y,z+h+.15,w+.5,d+.5,.3,'stone')
  else:pitched('斜屋頂',x,y,w+1.5,d+1.5,z+h,rise,'dark' if wall in ['brown','cream','stone','sage'] else 'tile',roofkind=='hip')

def canopy(name,x,y,w,d,h=3.3,z=0):
 with component(name):
  pitched('月台雨庇',x,y,w,d,z+h,.45,'dark')
  for i in range(max(2,int(w/5))):
   xx=x-w/2+.7+(w-1.4)*i/(max(2,int(w/5))-1)
   rod('棚柱',(xx,y,z),(xx,y,z+h),.10,'brown')
   rod('棚架斜撐',(xx,y,z+h-.8),(xx,y-1,z+h),.07,'brown');rod('棚架斜撐',(xx,y,z+h-.8),(xx,y+1,z+h),.07,'brown')

def platform(x,y,w,d,z=.55):
 with component('舊月台'):
  box('月台基座',x,y,z/2,w,d,z,'stone');box('月台邊石',x,y-d/2,z+.04,w,.22,.08,'cream')

def porch(x,y,w=4,d=2.6,z=0,h=3.1,gable=True):
 with component('入口門廊'):
  box('入口門',x,y+d*.25,z+1.35,w*.5,.14,2.7,'dark')
  for sx in [-1,1]:rod('門廊柱',(x+sx*(w/2-.2),y-d/2+.2,z),(x+sx*(w/2-.2),y-d/2+.2,z+h),.12,'brown')
  start=len(OB)
  mesh('入口正向雙坡頂',[(-w/2-.25,-d/2-.5,z+h),(w/2+.25,-d/2-.5,z+h),(-w/2-.25,d/2+.5,z+h),(w/2+.25,d/2+.5,z+h),(0,-d/2-.5,z+h+.9),(0,d/2+.5,z+h+.9)],[(0,2,5,4),(4,5,3,1)],'dark');rotate_since(start,x,y,0)
  steps(x,y-d/2-.6,w,1.4,.45,3)

def oldstation(s):
 id=s['id'];params={
 'shanjia-old':(24,10,4.1,'stone','hip',2.7,0),
 'jingtong-coal':(22,9,3.7,'brown','hip',2.4,0),
 'qidu-old':(24,10,3.8,'brown','hip',2.3,-3),
 'hexing-old':(14,7,3.5,'cream','hip',2,0),
 'shengxing':(24,9,3.7,'brown','gable',2.4,3),
 'beimen-old':(28,10,4.1,'sage','hip',2.5,-4),
 'zhutian-old':(26,11,4,'brown','hip',2.8,1.5),
 'guanshan-old':(27,11,4.2,'cream','hip',3.1,0),
 'takao-old':(40,13,4.4,'cream','hip',2.7,-8)}
 w,d,h,m,r,rise,px=params[id]
 if s.get('footprintReference'):
  ref=s['footprintReference'];w=max(5,ref['longSideM']-1.5);d=max(4,ref['shortSideM']-1.5);px=max(-w*.25,min(w*.25,px))
 wallunit('舊站房',0,0,w,d,h,m,roofkind=r,rise=rise);porch(px,-d/2-1.4,5 if id in ['guanshan-old','shanjia-old'] else 4,3,h=3.2)
 platform(0,d/2+2,w+7,3);canopy('舊站棚',0,d/2+2,w+4,3.6,h=3.3,z=.55)
 if id in ['qidu-old','guanshan-old','shengxing']:
  with component('入口山牆'):
   start=len(OB);pitched('正面入母屋山牆',0,0,d*.7,6,h+.6,1.8,'dark');rotate_since(start,px,-d*.1,90)
 if id=='guanshan-old':
  with component('入口折坡山牆'):
   verts=[(-3.5,-5.6,4.2),(3.5,-5.6,4.2),(2.7,-5.6,6.4),(1.4,-5.6,7.5),(-1.4,-5.6,7.5),(-2.7,-5.6,6.4)]
   mesh('農家式折坡山牆',verts,[(0,1,2,3,4,5)],'cream')
   line('折坡破風板',verts[1:]+verts[:1],.12,'dark');window(0,-5.7,5.9,2.5,1.1)
  # 農家式外牆上下分色。
  with component('木作腰壁'):box('深色腰壁',0,-d/2-.02,.65,w,.08,1.3,'brown')
 if id=='shengxing':
  with component('虎牙式山牆'):
   for sx in [-1,1]:
    for sy in [-1,1]:rod('山牆交叉破風',(sx*(w/2+.45),sy*2,h+rise-1),(sx*(w/2+.45),-sy*.45,h+rise+.35),.11,'cream')
 if id=='zhutian-old':wallunit('附屬小屋',-23,1,9,7,3.1,'brown',rise=1.7)
 if id=='hexing-old':
  with component('舊設施示意 / 待定位'):box('舊站小型貨台',18,5,.5,11,4,1,'stone')
 if id=='jingtong-coal':
  # 下層為架空混凝土柱列，保留空隙
  with component('選洗煤場架空樓板'):box('二樓樓板',3,33,7,24,12,.55,'stone')
  wallunit('選洗煤場高層',3,33,24,12,4.2,'red',z=7,roofkind='gable',rise=1.6)
  wallunit('煤場後側高層',12,43,12,9,4,'stone',z=11,roofkind='gable',rise=1.2)
  with component('煤場外露支架'):
   for xx in [-8,0,8,16]:rod('高架柱',(xx,26,0),(xx,26,9),.35,'stone')
   for yy in [28,38]:
    for xx in [-5,4,13]:rod('斜撐',(xx,yy,6),(xx+6,yy,13),.18,'metal')
 if id=='takao-old':
  wallunit('北號誌樓',40,12,9,6,7,'cream',rise=1.5)
  with component('號誌樓高窗'):
   for x in [37,39,41,43]:window(x,8.94,5.4,1.5,1.65)
  with component('號誌樓外梯'):
   for i in range(15):box('外梯踏步',46,7+i*.35,.2+i*.27,1.5,.4,.2,'stone')

def civicwing(name,x,y,w,d,h,red=False,floors=2,rotation=0):
 global DETAIL
 start=len(OB);wall='red' if red else 'cream'
 with component(name+' / 立面'):
  box('牆身',0,0,h/2,w,d,h,wall);box('石砌牆腳',0,0,.7,w+.25,d+.25,1.4,'stone')
  for k in range(floors+1):box('水平簷帶',0,0,1+k*(h-1)/floors,w+.4,d+.4,.32,'white')
  for side in [-1,1]:
   st=len(OB)
   for floor in range(floors):
    for i in range(max(2,int(w/4.2))):
     xx=-w/2+(i+.5)*w/max(2,int(w/4.2));window(xx,-d/2-.08,1.1+(floor+.5)*(h-1.4)/floors,1.9,(h-1.5)/floors*.65,arched=True)
   rotate_since(st,0,0,0 if side==-1 else 180)
  DETAIL=True
  for sx in [-1,1]:
   for k in range(int(h/.85)):box('角隅白石帶',sx*(w/2-.5),0,.5+k*.85,1.05,d+.25,.35,'white')
  DETAIL=False
 with component(name+' / 屋頂'):pitched('四坡瓦頂',0,0,w+1,d+1,h,3.2,'dark',True)
 rotate_since(start,x,y,rotation)

def octagon(name,x,y,r,z,h,wall='red',roofrise=3):
 with component(name):
  poly=[(x+r*math.cos(math.pi/8+i*math.pi/4),y+r*math.sin(math.pi/8+i*math.pi/4)) for i in range(8)];polyextrude('八角牆身',poly,z,h,wall)
  for i in range(8):
   a=(i+.5)*math.pi/4+math.pi/8;start=len(OB)
   if name=='八角樓':
    for level in [2.7,7.5]:
     for xx in [-2.7,0,2.7]:window(xx,-r*.926,z+level,1.8,3.3,arched=True)
   else:window(0,-r*.926,z+h*.55,min(2,r*.5),h*.55)
   rotate_since(start,x,y,math.degrees(a)+90)
 with component(name+' / 八角屋頂'):
  ring=[(x+(r+.8)*math.cos(math.pi/8+i*math.pi/4),y+(r+.8)*math.sin(math.pi/8+i*math.pi/4),z+h) for i in range(8)];mesh('八角斜頂',ring+[(x,y,z+h+roofrise)],[(i,(i+1)%8,8) for i in range(8)],'dark')

def president(s):
 # 日字形雙中庭，四周翼樓相接、中央翼分隔兩個空庭。
 for name,x,y,w,d,rot in [('正面翼樓',0,-42,124,17,0),('後翼樓',0,42,124,17,0),('左翼樓',-54,0,68,17,90),('右翼樓',54,0,68,17,90),('中央連接翼',0,0,68,15,90)]:civicwing(name,x,y,w,d,22,True,4,rot)
 for x in [-54,54]:
  for y in [-42,42]:octagon('角隅塔',x,y,10,0,26,'red',3)
 with component('中央高塔'):
  box('高塔主體',0,-42,24,15,16,48,'red')
  for z in range(3,49,5):box('高塔白色橫帶',0,-42,z,15.5,16.5,.55,'white')
  for x in [-6,6]:box('高塔角柱',x,-50.15,25,1.25,.5,48,'white')
  for z in [29,35,41,46]:window(0,-50.3,z,3.5,3.5,arched=True)
  polyextrude('塔頂八角體',[(5.5*math.cos(i*math.pi/4+math.pi/8),-42+5.5*math.sin(i*math.pi/4+math.pi/8)) for i in range(8)],48,7,'cream')
  taper('塔冠',0,-42,55,11,11,4,4,3.7,'dark');rod('塔頂旗桿',(0,-42,58.7),(0,-42,60),.10,'metal')
 with component('入口平頂車寄'):
  for x in [-6,-3,3,6]:rod('入口複柱',(x,-55,0),(x,-55,6.7),.35,'cream',10)
  box('現況平頂',0,-54,6.9,15,9,.7,'cream')
 for x in [-24,24]:
  with component('現況平頂衛塔'):
   box('衛塔',x,-42,24,10,13,7,'red');box('衛塔平冠',x,-42,27.7,11,14,.5,'cream')

def railway(s):
 civicwing('東側翼',23,0,48,13,10,True,2)
 civicwing('西側翼',-16,22,44,13,10,True,2,90)
 st=len(OB);civicwing('轉角門廳',0,0,20,15,12,True,2);rotate_since(st,-10,-2,-35)
 for xx,yy in [(-19,-2),(-4,-10)]:
  civicwing('入口塔',xx,yy,5,6,14,True,3)
 with component('半木構與老虎窗'):
  for x in range(4,46,7):
   box('二樓粉刷面',x,-6.58,8.9,5,.08,2,'cream')
   for dx in [-2,0,2]:box('木立柱',x+dx,-6.67,8.9,.14,.10,2.1,'brown')
   rod('斜木構',(x-2,-6.72,8),(x+2,-6.72,9.8),.09,'brown')
   wallunit('屋頂老虎窗',x,-3.7,2.2,2,1.5,'cream',z=11.3,roofkind='gable',rise=.8,windows=False)
 octagon('獨立八角樓',7,31,6,0,4,'cream',3)

def redhouse(s):
 octagon('八角樓',0,-20,13,0,10.5,'red',4.5)
 wallunit('十字樓長翼',0,18,18,58,6,'red',roofkind='gable',rise=3,windows=False)
 wallunit('十字樓橫翼',0,18,52,16,6,'red',roofkind='gable',rise=3,windows=False)
 with component('十字樓拱窗'):
  for x in [-22,-17,-12,12,17,22]:window(x,9.9,3,2.5,3.8,arched=True)

def prefecture(s):
 if s['id']=='hsinchu-prefecture':
  civicwing('州廳正面',0,0,68,15,10,False,2)
  for x in [-29,29]:civicwing('後伸翼樓',x,16,22,10,9,False,2,90)
  with component('雙柱入口門廊'):
   for x in [-5,-4,4,5]:rod('門廊雙柱',(x,-10,0),(x,-10,9),.30,'cream',10)
   box('門廊檐口',0,-10,9.2,13,6,.65,'cream');taper('入口山牆',0,-10,9.5,13,6,1,6,2,'cream')
  for x in [-8,8]:octagon('入口雙小塔',x,-1,2.8,10,3,'cream',2.5)
 else:
  civicwing('州廳東翼',28,0,55,14,11,False,2)
  civicwing('州廳北翼',0,28,55,14,11,False,2,90)
  st=len(OB);civicwing('轉角門廳',0,0,17,17,14,False,2);rotate_since(st,0,0,-45)
  with component('轉角入口門廊'):
   st=len(OB)
   for x in [-5,-3,3,5]:rod('入口立柱',(x,-11,0),(x,-11,8),.33,'cream',10)
   box('門廊頂',0,-10,8.4,13,6,.7,'cream');rotate_since(st,0,0,-45)
  with component('折坡塔頂'):taper('陡坡塔頂',0,0,14,15,15,10,10,5,'dark');taper('塔冠緩坡',0,0,19,10,10,5,5,1.8,'dark')

def roundhouse(s):
 global DETAIL
 # 開放的庫門及放射線，中央沒有實心盒子堵住轉盤。
 n=12;a0=math.radians(15);da=math.radians(150)/n;ri=24;ro=49
 for i in range(n):
  a=a0+i*da;b=a+da;mid=(a+b)/2
  with component('扇形庫房 %02d'%(i+1)):
   outer=[(ro*math.cos(t),ro*math.sin(t)) for t in [a,b]]
   for r in [ri,ro]:
    for t in [a,b]:rod('混凝土庫柱',(r*math.cos(t),r*math.sin(t),0),(r*math.cos(t),r*math.sin(t),7),.3,'stone')
   rod('庫口橫梁',(ri*math.cos(a),ri*math.sin(a),6.8),(ri*math.cos(b),ri*math.sin(b),6.8),.3,'stone')
   mesh('後牆',[(x,y,z) for z in [0,7] for x,y in outer],[(0,1,3,2)],'stone')
   pts=[(ri*math.cos(a),ri*math.sin(a),7),(ro*math.cos(a),ro*math.sin(a),7),(ro*math.cos(b),ro*math.sin(b),7),(ri*math.cos(b),ri*math.sin(b),7),((ri+ro)/2*math.cos(a),(ri+ro)/2*math.sin(a),9),((ri+ro)/2*math.cos(b),(ri+ro)/2*math.sin(b),9)]
   mesh('扇形分段屋頂',pts,[(0,3,5,4),(4,5,2,1)],'dark')
   st=len(OB);window(0,-.05,5,3,2);rotate_since(st,ro*math.cos(mid),ro*math.sin(mid),math.degrees(mid)+90)
  with component('庫房高窗與排煙口'):
   st=len(OB);box('庫門上方高窗',0,0,6.25,ri*da*.85,.16,1.05,'glass');rotate_since(st,ri*math.cos(mid),ri*math.sin(mid),math.degrees(mid)+90)
   rod('排煙管',(34*math.cos(mid),34*math.sin(mid),8),(34*math.cos(mid),34*math.sin(mid),10),.42,'stone',8)
   box('排煙管帽',34*math.cos(mid),34*math.sin(mid),10.15,1.1,1.1,.25,'stone')
  with component('放射庫線'):
   for side in [-1,1]:
    off=.5335*side;rod('鐵軌',(12*math.cos(mid)-off*math.sin(mid),12*math.sin(mid)+off*math.cos(mid),.12),(48*math.cos(mid)-off*math.sin(mid),48*math.sin(mid)+off*math.cos(mid),.12),.06,'metal')
   DETAIL=True
   for r in range(13,49,1):rod('枕木',(r*math.cos(mid)-1*math.sin(mid),r*math.sin(mid)+1*math.cos(mid),.04),(r*math.cos(mid)+1*math.sin(mid),r*math.sin(mid)-1*math.cos(mid),.04),.09,'brown',4)
   DETAIL=False
 with component('中央轉盤'):
  polyextrude('轉盤坑',[(12*math.cos(i*math.tau/64),12*math.sin(i*math.tau/64)) for i in range(64)],-.15,.15,'dark')
  line('轉盤環軌',[(11.6*math.cos(i*math.tau/64),11.6*math.sin(i*math.tau/64),.08) for i in range(65)],.07,'metal')
  box('轉盤橋',0,0,.23,23,2.7,.46,'stone')
  for y in [-.5335,.5335]:rod('橋上軌',(-11.5,y,.5),(11.5,y,.5),.06,'metal')

def industrial(s):
 id=s['id']
 configs={
 'taoyuan-warehouse':[('舊倉庫',0,0,52,18,6,'red')],
 'checheng-wood':[('木業展示館',0,0,45,24,6,'brown')],
 'dounan-warehouses':[(f'倉庫 {i+1}',i*26-65,0,23,18,5.4,'red') for i in range(6)],
 'chiayi-sawmill':[('第二代製材工場',0,0,58,26,6.5,'brown'),('動力室',38,7,15,18,8,'stone')],
 'longtian-warehouses':[('南倉',0,-25,54,14,5.8,'red'),('北倉',0,25,54,14,5.8,'red')]+[(f'鹽倉 {i+1}',-34+i*17,1,15,22,5,'red') for i in range(5)]+[('地磅室',40,-18,6,5,2.8,'cream')],
 'qiaotou-sugar':[('製糖工場',0,0,56,24,13,'stone'),('工場側廠',-18,22,30,18,8,'red'),('倉庫',30,21,28,15,7,'red'),('辦公廳舍',-22,-31,27,11,5,'cream')],
 'erjie-granary':[('高穀倉',0,0,23,15,10,'stone'),('碾米工場',21,0,16,18,6,'stone')],
 'luodong-forest':[('檢車庫',0,0,35,18,5.4,'brown'),('竹林站',30,-23,20,9,3.7,'brown')],
 'hualien-railway':[('出張所正翼',0,0,36,11,4.2,'cream'),('出張所側翼',-13,12,30,10,4.2,'cream'),('武道館',29,17,20,16,6,'brown')]
 }
 for name,x,y,w,d,h,m in configs[id]:
  if name=='竹林站' and s.get('footprintReference'):
   ref=s['footprintReference'];w=ref['longSideM']-1.5;d=ref['shortSideM']-1.5
  wallunit(name,x,y,w,d,h,m,roofkind='hip' if id=='hualien-railway' or name in ['辦公廳舍','竹林站'] else 'gable',rise=3 if h>=6 else 2,windows=id not in ['dounan-warehouses','longtian-warehouses'])
  if id in ['taoyuan-warehouse','dounan-warehouses','longtian-warehouses','luodong-forest']:
   with component(name+' / 貨門與月台'):
    for dx in [-w*.25,w*.25]:box('大貨門',x+dx,y-d/2-.06,2.1,3,.12,4.2,'dark')
    box('貨物月台',x,y-d/2-1,.35,w+1,2,.7,'stone')
  if id in ['chiayi-sawmill','checheng-wood','qiaotou-sugar'] and name in ['第二代製材工場','木業展示館','製糖工場']:
   wallunit('抬高採光屋頂',x,y,w*.86,d*.33,2.1,'cream',z=h+1.3,roofkind='gable',rise=1.5)
   with component('氣窗連續高窗'):
    for k in range(int(w/3)):
     window(x-w*.4+k*2.6,y-d*.165-.05,h+2.3,1.8,1.3)
 if id=='hualien-railway':
  wallunit('出張所角塔',0,0,4.5,4.5,9,'brown',roofkind='hip',rise=2)
 if id=='chiayi-sawmill':
  with component('製材工場外牆木扶壁'):
   for x in range(-24,25,6):
    for side in [1]:rod('木扶壁斜撐',(x,side*15,0),(x,side*13,5.5),.18,'brown',4)
  with component('鋸屑室架空斜板'):
   for x in [31,43]:
    for y in [-21,-11]:rod('鋸屑室支柱',(x,y,0),(x,y,6),.28,'stone',6)
   mesh('向中間傾斜的雙斜板',[(31,-21,6),(43,-21,6),(31,-16,3),(43,-16,3),(31,-11,6),(43,-11,6)],[(0,1,3,2),(2,3,5,4)],'stone')
   rod('斜向輸送道',(37,-16,3),(38,0,7),.5,'dark',4)
  with component('南側大面積窗列'):
   for x in range(-24,25,4):window(x,-13.1,3.5,2.8,3.8,'brown')
  with component('煙囪基座遺構'):taper('殘存基座',49,20,0,5,5,3.8,3.8,2,'red')
 if id=='qiaotou-sugar':
  with component('工場煙囪'):
   for x in [27,33]:rod('煙囪',(x,5,12),(x,5,35),1.05,'smoke',12)
  porch(-22,-38,9,4,h=4,gable=False)
 if id=='erjie-granary':
  with component('穀倉外牆扶壁'):
   for x in [-10,-5,0,5,10]:box('穀倉扶壁',x,-7.7,5,.6,.7,10,'stone')
 if id=='luodong-forest':porch(30,-29,4,2.5)
 if id=='hualien-railway':
  porch(3,-7,5,3);porch(29,7,5,3,h=4)
  with component('園區水塔'):
   for x in [48,52]:
    for y in [0,4]:rod('水塔支柱',(x,y,0),(x,y,9),.22,'stone')
   rod('水箱',(50,2,8),(50,2,11),3,'stone',16)

def taian(s):
 wallunit('舊站房',0,-9,24,10,3.8,'cream',roofkind='flat')
 # 月台在站房後方高處，地下道入口保持中空。
 platform(0,8,60,5,z=4.5);canopy('高位舊月台雨庇',0,8,48,5,h=3.5,z=4.5)
 with component('地下道入口'):
  for x in [-2,2]:box('地下道兩側',x,-2,1.5,.6,5,3,'stone')
  box('地下道入口頂',0,-2,3.1,4.6,5,.4,'stone');box('入口暗部',0,.4,1.4,3.4,.1,2.8,'dark')
 with component('紀念碑'):box('紀念碑基座',18,-11,.4,2,2,.8,'stone');box('紀念碑',18,-11,1.8,.7,.7,2,'stone')

BUILDERS={id:oldstation for id in ['shanjia-old','jingtong-coal','qidu-old','hexing-old','shengxing','beimen-old','zhutian-old','guanshan-old','takao-old']}
BUILDERS.update({id:industrial for id in ['taoyuan-warehouse','checheng-wood','dounan-warehouses','chiayi-sawmill','longtian-warehouses','qiaotou-sugar','erjie-granary','luodong-forest','hualien-railway']})
BUILDERS.update({'presidential-office':president,'railway-department':railway,'red-house':redhouse,'hsinchu-prefecture':prefecture,'taichung-prefecture':prefecture,'changhua-roundhouse':roundhouse,'taian-old':taian})

# 拱窗一次建立整圈框，避免每個窗戶十多支圓管拖慢建模與匯出。
def arch(x,y,z,w,h,m='dark'):
 r=w/2;cz=z+h-r
 outline=[(x-r,z),(x+r,z)]+[(x+r*math.cos(i*math.pi/12),cz+r*math.sin(i*math.pi/12)) for i in range(13)]
 mesh('拱形窗洞',[(xx,y,zz) for xx,zz in outline],[tuple(range(len(outline)))],m)
 inner=[(x-r,z),(x-r,cz)]+[(x+r*math.cos(math.pi-i*math.pi/12),cz+r*math.sin(math.pi-i*math.pi/12)) for i in range(13)]+[(x+r,z)]
 verts=[]
 for xx,zz in inner:
  dx=xx-x;dz=max(0,zz-cz);length=max(.01,math.hypot(dx,dz));verts.extend([(xx,y-.025,zz),(xx+.13*dx/length,y-.025,zz+.13*dz/length)])
 mesh('拱窗連續石框',verts,[(2*i,2*i+1,2*i+3,2*i+2) for i in range(len(inner)-1)],'cream')

def presidentwing(name,x,y,w,d,h,rotation=0):
 global DETAIL
 start=len(OB)
 with component(name+' / 立面'):
  box('紅磚立面',0,0,h/2,w,d,h,'red');box('底層石砌臺基',0,0,1,w+.25,d+.25,2,'stone')
  for zz in [2,7,12,17,20.7,22]:box('白色簷帶',0,0,zz,w+.35,d+.35,.28,'cream')
  for side in [-1,1]:
   st=len(OB)
   n=max(2,int(w/4.6))
   for i in range(n):
    xx=-w/2+(i+.5)*w/n
    for zz,hh,arc in [(4.4,3.1,False),(9.5,3.5,False),(14.5,3.6,True),(18.8,2.8,True),(21.3,.85,False)]:window(xx,-d/2-.08,zz,2.2 if arc else 1.8,hh,arched=arc)
    DETAIL=True
    for dx in [-1.5,1.5]:box('立面複柱',xx+dx,-d/2-.23,12,.20,.3,17,'cream')
    DETAIL=False
   rotate_since(st,0,0,0 if side==-1 else 180)
 with component(name+' / 屋頂'):pitched('低坡屋頂',0,0,w+.5,d+.5,22,1.7,'dark',True)
 rotate_since(start,x,y,rotation)

_old_president=president
def president(s):
 global DETAIL
 for name,x,y,w,d,rot in [('正面翼樓',0,-42,124,17,0),('後翼樓',0,42,124,17,0),('左翼樓',-54,0,68,17,90),('右翼樓',54,0,68,17,90),('中央連接翼',0,0,68,15,90)]:presidentwing(name,x,y,w,d,22,rot)
 for x in [-54,54]:
  for y in [-42,42]:
   with component('角隅平頂塔'):
    box('角塔牆體',x,y,13,13,18,26,'red')
    for z in [1,2,7,12,17,21,23.5,26]:box('角塔白帶',x,y,z,13.4,18.4,.36,'cream')
    for z in [4.3,9.5,14.5,19]:window(x,y-9.1,z,3,3.3,arched=z>12)
    box('平頂塔冠',x,y,26.3,14,19,.6,'cream')
    for dx in [-5.6,5.6]:
     for z in range(2,25):box('轉角隅石',x+dx,y-9.15,z,1.1,.3,.33,'cream')
    mesh('正面三角山牆',[(x-5,y-9.4,21),(x+5,y-9.4,21),(x,y-9.4,24)],[(0,1,2)],'cream')
 with component('中央高塔'):
  box('中央高塔紅磚',0,-42,24,11,14,48,'red')
  for x in [-4.8,4.8]:box('塔身角柱',x,-49.1,35,1,.3,26,'cream')
  for z in [28,34,40,45]:window(0,-49.16,z,1.6,3)
  for z in [22,24,47,49,51,53]:box('塔冠白帶',0,-42,z,12,15,.4,'cream')
  polyextrude('塔頂八角體',[(6*math.cos(i*math.pi/4+math.pi/8),-42+6*math.sin(i*math.pi/4+math.pi/8)) for i in range(8)],47,9,'red')
  for i in range(8):
   a=i*math.pi/4;st=len(OB);window(0,-5.6,51.4,2.2,6,arched=True);rotate_since(st,0,-42,math.degrees(a))
  with component('中央塔冠屋頂'):
   taper('塔頂銅皮',0,-42,56,12,12,3,3,2.8,'dark');rod('塔頂旗桿',(0,-42,58.8),(0,-42,60),.08,'metal')
 with component('入口平頂車寄'):
  for x in [-5.5,-4,4,5.5]:rod('門廊複柱',(x,-54.5,0),(x,-54.5,6.5),.30,'cream',8)
  box('車寄平頂',0,-53,6.8,14,8,.6,'cream');arch(0,-50.65,0,5,6,'dark')
  steps(0,-58,14,4,.8,5)
 for x in [-14,14]:
  with component('現況平頂衛塔'):
   box('衛塔',x,-43,14,7,17,28,'red')
   for z in [2,7,12,17,22,24,26,28]:box('衛塔橫帶',x,-43,z,7.4,17.4,.35,'cream')
   for z in [4,9,14,19,25]:window(x,-51.6,z,2.6,3,arched=z>20)
   box('平頂衛塔冠',x,-43,28.3,8,18,.5,'cream')
BUILDERS['presidential-office']=president
