"""車系建模；每款保留部件，沒有載入舊 atlas 或舊低面數網格。"""
import math
import blender_parts as p
from blender_parts import *

def interp(points,z):
 if z<=points[0][0]:return points[0][1]
 for (a,x),(b,y) in zip(points,points[1:]):
  if z<=b:return x+(y-x)*(z-a)/(b-a)
 return points[-1][1]

def shell(s,front=None,name='圓肩主車殼',rear=None):
 L,W,H=s['L'],s['W'],s['H'];z0=s.get('bottom',.83);r=s.get('radius',.23);front=front or s.get('front','flat');end=L/2
 if front=='shinkansen':return shinkansen_shell(s)
 profiles={
  'taroko':[(z0,end-.20),(1.12,end),(1.75,end-.10),(2.60,end-.57),(H,end-1.10)],
  'puyuma':[(z0,end-.12),(1.1,end),(1.6,end-.18),(2.8,end-1.0),(H,end-1.32)],
  'hitachi':[(z0,end-.12),(1.2,end),(1.8,end-.13),(2.70,end-.48),(H,end-.86)],
  'shinkansen':[(z0,end-.12),(1.02,end),(1.40,end-.38),(2.0,end-1.9),(2.7,end-3.05),(H,end-3.65)],
  'smile':[(z0,end-.05),(1.3,end),(1.8,end-.15),(2.8,end-.54),(H,end-.72)],
  'green-smile':[(z0,end-.10),(1.3,end),(2.0,end-.15),(2.8,end-.42),(H,end-.73)],
  'alfred':[(z0,end-.58),(1.3,end-.52),(1.58,end),(2.00,end),(2.20,end-.28),(H,end-.40)],
  'push-pull':[(z0,end-.28),(1.05,end),(1.5,end-.1),(2.8,end-.60),(H,end-.98)],
  'ring':[(z0,end-.14),(1.3,end),(2.6,end-.22),(H,end-.53)],
  'sanying':[(z0,end-.05),(1.3,end),(2.6,end-.20),(H,end-.49)],
  'taichung':[(z0,end-.22),(1.2,end),(2.5,end-.13),(H,end-.53)],
  'airport':[(z0,end),(1.5,end-.02),(2.7,end-.28),(H,end-.42)],
  'danhaiform':[(z0,end-.15),(.85,end),(1.4,end-.1),(2.8,end-.67),(H,end-.85)],
  'urbos':[(z0,end-.20),(.90,end),(1.65,end-.06),(2.7,end-.55),(H,end-.80)],
  'citadis':[(z0,end-.16),(.90,end),(2.6,end-.09),(H,end-.50)],
  'toshiba':[(z0,end),(1.5,end),(2.2,end),(H,end-.50)],
  'stadler-diesel':[(z0,end-.05),(1.4,end),(2.2,end),(2.9,end-.37),(H,end-.62)],
 }
 profile=profiles.get(front,[(z0,end),(H,end-(.17 if front not in ['flat','ge'] else .08))])
 bow=.08 if front in profiles else .018
 def f(y,z):return interp(profile,z)-bow*(abs(y)/(W/2))**4
 def half(z):
  delta=max(0,z0+r-z,z-(H-r));return W/2-r+math.sqrt(max(0,r*r-delta*delta)) if delta else W/2
 def taper(z):return .46+.54*min(1,max(0,(z-z0)/(H-z0))) if front=='shinkansen' else 1
 rows=32;zs=[z0+(H-z0)*i/rows for i in range(rows+1)]
 ring=[(half(z),z) for z in zs]+[(half(H)*(1-2*j/16),H) for j in range(1,16)]+[(-half(z),z) for z in reversed(zs)]+[(half(z0)*(-1+2*j/16),z0) for j in range(1,16)]
 n=len(ring);verts=[];back=-L/2 if rear is None else rear
 neck=min(x for z,x in profile)-.06
 for t in [0,.04,.85,1]:
  for y,z in ring:
   if t==0:x=-f(y,z) if s.get('doubleCab') else back;yy=y
   elif t==.04:x=back+(.29 if s.get('doubleCab') else .10);yy=y
   elif t==.85:x=neck;yy=y
   else:yy=y*taper(z);x=f(yy,z)
   # C301 上肩略向內傾，窗門座標在下面同樣映射。
   verts.append((x,yy,z))
 faces=[tuple(reversed(range(n)))]+[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(3) for i in range(n)]
 base=len(verts);cols=16
 for z in zs:
  for j in range(cols+1):
   y=half(z)*taper(z)*(2*j/cols-1)
   verts.append((f(y,z),y,z))
 faces += [(base+i*(cols+1)+j,base+i*(cols+1)+j+1,base+(i+1)*(cols+1)+j+1,base+(i+1)*(cols+1)+j) for i in range(rows) for j in range(cols)]
 use('01');o=mesh(name,verts,faces,'body',0,True);o['primary_body']=True
 return f,neck

def front_panel(name,f,y,z,w,h,material,r=.06,offset=.024):
 use('03');return panel(name,(0,y,z),w,h,material,'front',r=r,depth=.014,surface=lambda yy,zz:f(yy,zz)+offset)
def front_poly(name,f,points,material):
 use('03');verts=[(f(y,z)+.035,y,z) for y,z in points];return mesh(name,verts,[tuple(range(len(verts)))],material)
def front_ribbon(name,f,points,width,material):
 # 密化曲面色帶；使用連續頂點和接角法線，避免短矩形相疊變成鋸齒。
 use('03');dense=[]
 for a,b in zip(points,points[1:]):
  n=max(5,math.ceil(math.dist(a,b)/.045))
  dense += [(a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n) for i in range(n)]
 dense.append(points[-1]);verts=[]
 for i,(y,z) in enumerate(dense):
  a=dense[max(0,i-1)];b=dense[min(len(dense)-1,i+1)];d=math.dist(a,b)
  ny=-(b[1]-a[1])/d*width/2;nz=(b[0]-a[0])/d*width/2
  for sign in [-1,1]:
   yy=y+sign*ny;zz=z+sign*nz;verts.append((f(yy,zz)+.082,yy,zz))
 return mesh(name,verts,[(2*i,2*i+1,2*i+3,2*i+2) for i in range(len(dense)-1)],material,0,True)

def side_band(s,z,h,material,x0=None,x1=None):
 use('01');L,W=s['L'],s['W'];x0=-L/2+.08 if x0 is None else x0;x1=L/2-.60 if x1 is None else x1
 for side in [-1,1]:box('連續腰線',( (x0+x1)/2,side*(W/2+.013),z),(x1-x0,.022,h),material,.005)
def sidewindow(x,y,z,w,h=1.13,r=.075,split=False):
 use('02');side=1 if y>0 else -1
 panel('固定窗橡膠框',(x,y,z),w+.06,h+.06,'frame',r=r)
 panel('獨立深色玻璃',(x,y+side*.015,z),w,h,'glass',r=max(.025,r-.018),depth=.013)
 if split:box('可開窗中橫框',(x,y+side*.028,z+.04),(w,.018,.032),'metal',.007)
 # 每扇玻璃保留獨立材質，沒有把反射相片烘進表面。

def passenger_sides(s,neck):
 L,W,H=s['L'],s['W'],s['H'];doors=s.get('doors',2);leafcount=s.get('doorLeaves',2);narrow=s.get('doorWindowNarrow',False)
 coach=s['family'] in ['coach','forestcoach'];wood=s.get('wood',False);front=s.get('front')
 zc=H-.95;wh=1.14 if not s.get('largeWindows') else 1.48
 x0=-L/2+.40;x1=min(neck-.24,L/2-.74)
 if coach:x1=L/2-.45
 width=.90 if doors>=3 else .65 if leafcount==1 else 1.12
 if coach or s.get('windows'):positions=[x0+.20,x1-.20]
 else:positions=[x0+(i+.5)*(x1-x0)/doors for i in range(doors)]
 for side in [-1,1]:
  y=side*(W/2+.018)
  # 車身單片背殼仍保留；外側的車窗、門扇皆為獨立可編修部件。
  if s.get('windows'):
   left=positions[0]+width/2+.1;right=positions[-1]-width/2-.1;n=s['windows']
   if s.get('baggage'):left=(left+right)/2-.3
   for j in range(n):
    w=(right-left)/n*.78;sidewindow(left+(j+.5)*(right-left)/n,y,zc,w,wh,split=s.get('splitWindows',False))
  else:
   intervals=[];a=x0
   for x in positions:intervals.append((a,x-width/2-.12));a=x+width/2+.12
   intervals.append((a,x1))
   for a,b in intervals:
    if b-a<.16:continue
    n=2 if s['family']=='railcar' and b-a>1.12 else 1
    for i in range(n):sidewindow(a+(i+.5)*(b-a)/n,y,zc,(b-a)/n-.06,wh)
  for i,x in enumerate(positions):
   use('02');basez=.92;dh=H-.28-basez;cz=basez+dh/2
   panel('側門門框',(x,y,cz),width+.055,dh+.035,'frame',r=.026)
   for leaf in range(leafcount):
    dx=(leaf-(leafcount-1)/2)*width/leafcount;lw=width/leafcount-.025
    door=panel('獨立門扇',(x+dx,y+side*.023,cz),lw,dh,'body' if wood or front=='tourism' else 'roof',r=.025,depth=.024)
    door['side_door']=True;door['door_group']=i+1;door['side']=side;door['leaf']=leaf
    gw=lw*(.4 if narrow else .73)
    panel('門窗嵌框',(x+dx,y+side*.043,zc),gw+.045,wh+.055,'frame',r=.05)
    panel('門窗玻璃',(x+dx,y+side*.057,zc),gw,wh,'glass',r=.04,depth=.012)
    box('門把凹槽',(x+dx+lw*.32,y+side*.068,1.52),(.02,.009,.17),'frame',.005)
    # 腰線在門扇上連續，但不上木造車門。
    if not wood and front not in ['tourism','shinkansen','hitachi','puyuma','taroko']:
     box('門扇下部腰線',(x+dx,y+side*.041,1.23),(lw,.011,.09 if s['family']=='railcar' else .115),'accent',.002)
   box('車門踏板',(x,y+side*.01,.90),(width+.08,.11,.042),'metal',.008)
  if not coach and x1< L/2-1.0:
   # 駕駛側窗位於車鼻肩部之前，避免浮在收窄鼻尖外。
   sidewindow(neck+.22,y,H-.90,.34,.80,r=.045) if neck-x1>.48 else None
  if s.get('corrugation'):
   # 門洞左右分段的車側波紋，不穿過門扇。
   edges=[x0]+[v for x in positions for v in [x-width/2-.05,x+width/2+.05]]+[x1]
   for a,b in zip(edges[::2],edges[1::2]):
    if b>a:
     for z in [1.01,1.10,1.38,1.48]:box('不鏽鋼側牆壓筋',((a+b)/2,y-side*.005,z),(b-a,.016,.015),'metal',.004)
  if wood:
   # 窄板檜木與福森寬枚板各有自己的板寬，為實體倒角板而非木紋照片。
   step=.37 if s['id']=='fushen' else .13
   for j in range(math.ceil((x1-x0)/step)):
    x=x0+(j+.5)*step
    if all(abs(x-d)>width/2+.03 for d in positions):
     box('檜木枚板',(x,y+side*.004,1.26),(step-.012,.031,.62),'wood' if j%4==0 else 'body',.007)


def passenger(s):
 L,W,H=s['L'],s['W'],s['H'];front=s['front'];f,neck=shell(s)
 # 側面底色與實車色帶。車頭另按自己的曲面包覆。
 if front in ['c301','c321','c341','c371','c381','val','airport','kaohsiung']:
  side_band(s,1.23,.20,'accent',x1=neck)
 elif front in ['gangway','dr2700']:
  if front=='gangway':
   side_band(s,1.22,.18,'blue',x1=neck);side_band(s,1.51,.05,'blue',x1=neck)
 elif front=='british':side_band(s,2.20,1.10,'accent',x1=neck);side_band(s,1.26,.16,'accent',x1=neck)
 elif front=='zebra':
  for z in [1.06,1.29,1.52]:side_band(s,z,.14,'accent',x1=neck)
 elif front=='yellowgangway':side_band(s,1.52,.15,'orange',x1=neck)
 elif front=='shinkansen':pass # 色帶已由同一鼻尖截面包覆
 elif front=='puyuma':
  for z,h in [(1.06,.10),(1.28,.06),(2.89,.06)]:side_band(s,z,h,'accent',x1=neck)
 elif front in ['ring','sanying','taichung','green-smile','hitachi']:
  side_band(s,H-.91,1.20,'frame',x1=neck);side_band(s,1.30,.13,'accent',x1=neck)
 elif front=='taroko':side_band(s,1.24,.11,'accent',x1=neck)
 elif front in ['smile','alfred']:
  side_band(s,1.35,.11,'blue',x1=neck);side_band(s,1.22,.10,'yellow',x1=neck)
 passenger_sides(s,neck)
 head_start=len(p.MODEL)
 if front in ['gangway','tourism','dr2700','yellowgangway','british']:
  if front=='gangway':front_panel('藍色車頭',f,0,2.08,W-.10,2.48,'blue',.20)
  if front in ['yellowgangway','british']:
   front_panel('黄色警戒面',f,0,2.08,W-.13,2.38,'yellow',.18)
   for side in [-1,1]:front_ribbon('橘紅警戒斜線',f,[(side*1.26,1.70),(side*.66,1.10)],.18,'orange')
  front_panel('貫通門橡膠框',f,0,1.99,.81,2.08,'frame',.055,.055)
  front_panel('貫通門扇',f,0,1.99,.67,1.98,'body' if front not in ['yellowgangway','british'] else 'yellow',.025,.073)
  front_panel('貫通門窗',f,0,2.42,.43,.84,'glass',.045,.10)
  for side in [-1,1]:
   front_panel('駕駛前窗嵌框',f,side*.91,2.43,.62,.96,'frame',.10,.04)
   front_panel('駕駛前窗玻璃',f,side*.91,2.43,.55,.88,'glass',.08,.06);wiper(f,side*.94,2.00,.68)
   for dy,red in [(-.115,False),(.115,True)]:lamp('雙圓式腰燈',f,side*.95+dy,1.45,.076,red)
   if front=='gangway':
    for z in [1.60,1.74]:front_ribbon('白色迴折腰紋',f,[(side*.47,z+.12),(side*.68,z+.12),(side*.68,z),(side*1.33,z)],.056,'white')
  front_panel('上方頭燈座',f,0,H-.10,.52,.23,'chassis',.07,.02)
  for y in [-.13,.13]:lamp('頂部頭燈',f,y,H-.10,.078)
  if front in ['gangway','yellowgangway']:hazard(L/2+.08,W,.61,.43)
  for side in [-1,1]:line('貫通門扶手',[(f(side*.46,1.4)+.13,side*.46,1.4),(f(side*.46,2.75)+.13,side*.46,2.75)],.018,'metal')
 elif front in ['c301','c321','c341','c371','c381']:
  front_panel('北捷深灰面罩',f,0,2.21,W-.08,2.13,'dark' if front in ['c301','c371'] else 'frame',.16)
  if front=='c381':
   front_panel('C381 銀色弧肩下巴',f,0,1.14,2.64,.54,'body',.11,.048)
  front_panel('藍色前裙腰線',f,0,1.24,W-.12,.25,'blue',.03,.06)
  front_panel('中央逃生門邊縫',f,0,2.11,.91,2.03,'chassis',.02,.059)
  front_panel('中央逃生門面',f,0,2.11,.85,1.97,'dark',.025,.077)
  if front in ['c371','c381']:front_panel('逃生門上窗',f,0,2.49,.62,.94,'glass',.025,.09)
  for side in [-1,1]:
   z=2.48 if front!='c381' else 2.40
   front_panel('駕駛前窗黑框',f,side*.88,z,.66,1.18,'frame',.05,.055)
   front_panel('駕駛前窗',f,side*.88,z,.60,1.10,'glass',.035,.078);wiper(f,side*.91,1.97,.75)
   front_panel('橢圓燈具底座',f,side*.97,1.25,.46,.22,'chassis',.08,.077)
   lamp('行車燈',f,side*.86,1.25,.075);lamp('尾燈',f,side*1.09,1.25,.060,True)
   lamp('上方識別燈',f,side*1.18,3.10,.035,True)
  front_panel('目的地顯示器底板',f,0,3.11,.63,.16,'frame',.018,.068)
  if front=='c381':
   # 保留前裙兩條弧狀線；不放營運商標。
   for side in [-1,1]:front_ribbon('C381 藍色下緣弧線',f,[(side*.25,1.05),(side*.58,1.19),(side*1.19,1.13)],.035,'blue')
  for z in [.95,1.00]:front_panel('防爬橫條',f,0,z,W-.22,.025,'metal',.006,.06)
 elif front=='val':
  front_panel('VAL 大圓角前窗黑框',f,0,2.19,2.16,1.28,'frame',.18)
  front_panel('VAL 深色大前窗',f,0,2.19,2.06,1.18,'glass',.15,.05)
  front_panel('藍色下裙',f,0,1.18,2.32,.30,'accent',.025)
  for side in [-1,1]:
   lamp('VAL 下排頭燈',f,side*.82,1.26,.077);lamp('VAL 尾燈',f,side*1.02,1.26,.055,True)
  wiper(f,0,1.67,.87)
 elif front=='airport':
  front_panel('機捷彩色面罩',f,0,2.33,2.65,2.19,'accent',.36)
  front_panel('灰色車頭下半',f,0,1.29,2.65,.82,'body',.17,.055)
  front_panel('中央逃生門外框',f,0,2.13,.71,1.93,'chassis',.09,.07)
  front_panel('中央逃生門塗装',f,0,2.13,.66,1.86,'accent',.07,.088)
  front_panel('逃生門小窗',f,0,2.55,.38,.70,'glass',.07,.11)
  for side in [-1,1]:
   front_panel('機捷直立大前窗',f,side*.90,2.57,.69,1.43,'frame',.15,.06)
   front_panel('機捷駕駛玻璃',f,side*.90,2.57,.61,1.34,'glass',.12,.082);wiper(f,side*.94,1.89,.91)
   front_panel('傾斜燈罩底板',f,side*.89,1.66,.54,.33,'frame',.13,.076)
   lamp('機捷照明',f,side*.80,1.64,.09);lamp('機捷紅尾燈',f,side*1.01,1.66,.058,True)
  front_panel('機捷目的地面板',f,0,3.21,.64,.22,'frame',.03,.09)
 elif front in ['smile','green-smile','alfred','zebra','taroko','puyuma','hitachi','shinkansen','ring','sanying','taichung','kaohsiung']:
  if front in ['smile','green-smile']:
   base='yellow' if s.get('inverse') else 'blue' if front=='smile' else 'frame'
   front_panel('上窄下圓車頭面罩',f,0,2.32,2.48,2.04,base,.42)
   front_panel('寬幅駕駛玻璃外框',f,0,2.57,2.10,.91,'frame',.13,.057)
   front_panel('寬幅駕駛玻璃',f,0,2.57,1.98,.79,'glass',.10,.080)
   if front=='smile':
    for y in [-.96,-.61,.61,.96]:lamp('微笑號四圓燈',f,y,1.86,.096)
    points=[(-1.22,1.96),(-1.08,1.58),(-.70,1.42),(0,1.36),(.70,1.42),(1.08,1.58),(1.22,1.96)]
    front_ribbon('黃色微笑弧線',f,points,.15,'blue' if s.get('inverse') else 'yellow')
    for y in [-.77,.77]:lamp('上方頭燈',f,y,3.13,.079)
   else:
    front_ribbon('EMU900 白色微笑灯帶',f,[(-.90,1.45),(-.67,1.35),(0,1.32),(.67,1.35),(.90,1.45)],.063,'lamp')
    for side in [-1,1]:front_ribbon('嫩綠側頰',f,[(side*1.29,1.98),(side*1.15,1.60)],.20,'accent');lamp('額頭燈',f,side*.77,3.11,.068)
   front_panel('中央目的地框',f,0,3.10,.56,.18,'frame',.06,.06)
  elif front=='alfred':
   front_panel('EMU700 藍色面罩',f,0,2.15,2.63,2.54,'blue',.19)
   front_panel('突出橘色下巴',f,0,1.64,2.50,.65,'orange',.18,.06)
   front_panel('銀灰斜前額',f,0,2.70,2.45,1.26,'body',.06,.038)
   front_panel('阿福全幅駕駛窗',f,0,2.47,2.30,.90,'frame',.045,.065)
   front_panel('阿福駕駛玻璃',f,0,2.47,2.19,.80,'glass',.025,.089)
   for side in [-1,1]:lamp('阿福頭燈',f,side*.60,1.88,.085);lamp('阿福尾燈',f,side*.96,1.88,.068,True)
   front_panel('上額頭燈座',f,0,3.15,.52,.21,'frame',.04,.056)
   for y in [-.13,.13]:lamp('額頭雙燈',f,y,3.15,.068)
  elif front=='zebra':
   front_panel('紅斑馬橘紅底',f,0,1.46,2.61,1.17,'accent',.13)
   for z in [1.07,1.28,1.49,1.70]:front_panel('紅斑馬白色橫線',f,0,z,2.59,.075,'white',.01,.06)
   front_panel('三分割前窗外框',f,0,2.44,2.42,1.12,'frame',.15)
   front_panel('紅斑馬前窗',f,0,2.44,2.31,1.00,'glass',.13,.06)
   for y in [-.45,.45]:front_panel('前窗立柱',f,y,2.44,.035,1.00,'metal',.005,.09)
   for y in [-.91,-.64,.64,.91]:lamp('紅斑馬下燈',f,y,1.58,.081)
   for y in [-.09,.09]:lamp('頂部雙燈',f,y,3.16,.07)
  elif front in ['taroko','puyuma','hitachi','shinkansen']:
   if front=='puyuma':front_panel('普悠瑪紅色車鼻',f,0,2.04,2.50,2.48,'accent',.38)
   if front=='hitachi':front_panel('EMU3000 連續黑面罩',f,0,2.50,2.50,1.73,'frame',.39)
   if front=='shinkansen':
    front_panel('700T 前窗與燈組一體黑面罩',f,0,2.55,1.98,1.24,'frame',.28)
    front_panel('700T 弧形駕駛前窗',f,0,2.77,1.76,.67,'glass',.20,.055)
   else:
    front_panel('流線前窗密封框',f,0,2.59,2.12,.99,'frame',.16)
    front_panel('流線前窗玻璃',f,0,2.59,2.00,.81,'glass',.13,.061)
   if front=='taroko':
    front_ribbon('太魯閣橘腰線',f,[(-1.30,1.29),(-.83,1.18),(0,1.15),(.83,1.18),(1.30,1.29)],.09,'accent')
    for side in [-1,1]:front_panel('太魯閣灰色腰燈座',f,side*.90,1.93,.48,.31,'chassis',.10);lamp('太魯閣腰燈',f,side*.90,1.93,.067)
    front_panel('額頭雙燈座',f,0,3.12,.43,.24,'frame',.05,.04)
    for y in [-.105,.105]:lamp('太魯閣額燈',f,y,3.12,.068)
   elif front=='puyuma':
    for side in [-1,1]:
     front_panel('普悠瑪黑色腰燈座',f,side*.86,1.93,.50,.29,'frame',.11,.05)
     for dy in [-.105,.105]:lamp('普悠瑪雙燈',f,side*.86+dy,1.93,.068)
    for y in [-.75,.75]:front_panel('普悠瑪額燈',f,y,3.15,.27,.11,'lamp',.035,.055)
   elif front=='hitachi':
    front_panel('EMU3000 額頭雙燈座',f,0,3.16,.60,.18,'frame',.06,.055)
    for y in [-.15,.15]:front_panel('EMU3000 頭燈',f,y,3.16,.18,.09,'lamp',.03,.081)
    front_panel('EMU3000 車鉤蓋線',f,0,1.10,1.32,.32,'metal',.12,.024)
    front_panel('EMU3000 車鉤蓋',f,0,1.10,1.27,.29,'body',.10,.046)
   else:
    for side in [-1,1]:
     front_panel('700T 雙燈透明燈罩',f,side*.49,2.11,.51,.19,'glass',.055,.059)
     for dy in [-.115,.115]:front_panel('700T 前窗下頭燈',f,side*.49+dy,2.11,.16,.095,'lamp',.025,.076)
    # 柔和的鼻端檢修蓋只留細縫，不做突起的三角板。
    front_ribbon('700T 鼻端檢修蓋細縫',f,[(-.34,1.34),(-.37,1.59),(-.26,1.72),(0,1.76),(.26,1.72),(.37,1.59),(.34,1.34)],.006,'metal')
  else:
   face='accent' if front in ['ring','kaohsiung'] else 'frame'
   front_panel('環抱式外圈',f,0,2.16,2.57,2.36,face,.43)
   front_panel('圓弧前窗黑框',f,0,2.46,2.22,1.61,'frame',.36,.05)
   front_panel('駕駛室大玻璃',f,0,2.52,2.05,1.29,'glass',.28,.077)
   if front=='sanying':front_panel('三鶯藍色前圍',f,0,1.40,2.51,.47,'accent',.08,.056)
   if front=='kaohsiung':front_panel('高捷中央逃生門',f,0,2.06,.61,1.95,'accent',.025,.087);front_panel('逃生門前窗',f,0,2.51,.55,.95,'glass',.025,.10)
   for side in [-1,1]:
    z=1.38 if front!='taichung' else 1.51
    lamp('都市列車照明',f,side*.91,z,.078);lamp('都市列車尾燈',f,side*1.11,z+.03,.047,True)
   front_panel('都市列車顯示器',f,0,3.07,.74,.18,'frame',.04,.076)
  if front!='shinkansen':
   for side in [-1,1]:wiper(f,side*.63,2.12,.60)
  else:wiper(f,-.17,2.46,.40)
 # 後端為可接客室的端牆；單節柴油車兩端可駕駛，另標示簡化尾端。
 if s.get('doubleCab'):copy_rotated(list(p.MODEL[head_start:]))
 bogies(L,W,r=.35 if front=='shinkansen' else .39,rubber=s.get('rubber',False),centers=[-2.68,.35] if front=='shinkansen' else None);roof_units(L,W,H,s['roof'])
 if front=='shinkansen':
  # 車底主梁只在客室和轉向架下方，不能以矩形穿出鴨嘴車鼻。
  for o in p.MODEL:
   if o.name=='車底主梁':
    for v in o.data.vertices:v.co.x=v.co.x*.68-1.10
 if front not in ['taroko','puyuma','hitachi','shinkansen','alfred']:coupler(L/2+.04,W)
 coupler(-L/2-.03,W,-1,gangway=not s.get('rubber',False) and not s.get('doubleCab',False))
 if front!='shinkansen':
  use('05');box('車頂天線底座',(min(neck,L/2-.8),0,H+.045),(.21,.17,.06),'chassis',.013)
  rod('列車通訊天線',(min(neck,L/2-.8),0,H+.075),(min(neck,L/2-.8),0,H+.25),.010,'chassis')
 if s.get('tumblehome'):
  for o in p.MODEL:
   if o.type=='MESH':
    for v in o.data.vertices:
     v.co.y*=1-s['tumblehome']*max(0,(v.co.z-1.6)/(H-1.6))
 return f

def copy_rotated(objects,angle=math.pi,offset=(0,0,0),prefix='反向端 '):
 R=Matrix.Rotation(angle,4,'Z');T=Matrix.Translation(Vector(offset))
 for o in objects:
  c=o.copy();c.data=o.data.copy();c.name=prefix+o.name
  o.users_collection[0].objects.link(c);p.MODEL.append(c);c.matrix_world=T@R@o.matrix_world

def electric(s):
 L,W,H=s['L'],s['W'],s['H'];front=s['front'];f,neck=shell(s);start=len(p.MODEL)
 if front=='ge' and not s.get('tourism'):
  body=p.MODEL[0];body.data.materials.append(p.M['accent'])
  for poly in body.data.polygons:
   if sum(body.data.vertices[i].co.z for i in poly.vertices)/len(poly.vertices)>H-.16:poly.material_index=1
 if front=='ge':
  front_panel('奶油色駕駛上半部',f,0,2.98,W-.08,.84,'accent' if not s.get('tourism') else 'body',.17)
  for side in [-1,1]:
   front_panel('雙駕駛窗銀色嵌框',f,side*.72,2.98,1.10,.60,'metal',.12,.06)
   front_panel('雙駕駛窗玻璃',f,side*.72,2.98,1.00,.50,'glass',.09,.087);wiper(f,side*.77,2.78,.41)
  if not s.get('tourism'):
   front_ribbon('橘白 V 字識別帶',f,[(-1.36,2.48),(-.85,2.25),(0,1.64),(.85,2.25),(1.36,2.48)],.14,'accent')
  else:
   front_panel('鳴日垂直橘色中線',f,0,2.14,.37,2.39,'accent',.012,.054)
   cyl('鳴日圓形車頭牌・無商標',(f(.92,2.03)+.09,.92,2.03),.23,.025,'gold','X',48)
   for r in [.16,.19,.22]:
    pts=[(f(.92+r*math.cos(a),2.03+r*math.sin(a))+.11,.92+r*math.cos(a),2.03+r*math.sin(a)) for a in [i*math.pi/24 for i in range(49)]];line('圓牌同心刻線',pts,.003,'metal')
  front_panel('GE 雙燈基座',f,0,H+.025,.51,.25,'chassis',.055,.035)
  for y in [-.12,.12]:lamp('GE 額頭燈',f,y,H+.025,.085)
  for y in [-1.14,1.14]:lamp('識別尾燈',f,y,3.32,.039,True)
  for y in [-.89,.89]:
   line('端面登車扶手',[(f(y,1.1)+.07,y,1.1),(f(y,1.36)+.07,y,1.36)],.016,'metal')
  if not s.get('tourism'):hazard(L/2+.08,W,.62,.57)
 elif front=='toshiba':
  front_panel('東芝黑色斜前額',f,0,2.79,2.69,1.37,'frame',.21)
  front_panel('E500 全幅駕駛窗',f,0,2.80,2.37,.84,'glass',.15,.056)
  for y in [-.79,-.50,.50,.79]:lamp('E500 四圓前燈',f,y,1.90,.091)
  for y in [-.13,.13]:lamp('E500 頂部雙燈',f,y,3.37,.068)
  for y in [-.69,.69]:wiper(f,y,2.45,.50)
 elif front=='push-pull':
  front_panel('E1000 橘色鼻帶',f,0,1.45,2.62,.54,'accent',.19)
  for side in [-1,1]:
   front_panel('E1000 駕駛窗嵌框',f,side*.65,2.82,1.06,.61,'chassis',.12)
   front_panel('E1000 駕駛玻璃',f,side*.65,2.82,.96,.51,'glass',.09,.054);wiper(f,side*.66,2.61,.37)
   for dy in [-.10,.10]:lamp('E1000 鼻燈',f,side*.89+dy,1.46,.070)
  front_panel('E1000 額頭標示窗',f,0,3.23,.32,.11,'chassis',.045)
 else:
  front_panel('R200 深色前額',f,0,2.86,2.56,1.06,'frame',.12)
  front_panel('R200 大斜前窗',f,0,2.81,2.33,.63,'glass',.08,.059)
  front_panel('R200 上通風窗',f,0,3.44,1.62,.19,'chassis',.03,.07)
  for side in [-1,1]:
   front_panel('R200 方形燈罩',f,side*.97,1.96,.49,.24,'frame',.045)
   for dy in [-.105,.105]:front_panel('R200 方燈',f,side*.97+dy,1.96,.12,.13,'lamp',.025,.062)
   wiper(f,side*.70,2.55,.45)
  front_panel('R200 深色下巴',f,0,1.02,2.67,.35,'accent',.025)
 # 雙端機車第二駕駛面採同一套部件旋轉；E1000 後端是與客車相接的端牆。
 if front not in ['push-pull','stadler-diesel']:copy_rotated(list(p.MODEL[start:]))
 use('01')
 if front=='ge':
  side_band(s,3.06,.70,'accent' if not s.get('tourism') else 'body',x1=L/2-.75)
  if s.get('tourism'):side_band(s,1.46,.59,'accent',x0=-L/2+.4,x1=L/2-.4)
 elif front=='push-pull':side_band(s,2.23,1.17,'accent',x1=neck)
 elif front=='stadler-diesel':side_band(s,2.40,1.84,'accent',x0=-L/2+.15,x1=1.72)
 for side in [-1,1]:
  y=side*(W/2+.025)
  cabxs=[L/2-1.12] if front in ['push-pull','stadler-diesel'] else [L/2-1.12,-L/2+1.12]
  for x in cabxs:
   sidewindow(x,y,2.87,.74,.69)
   use('02');panel('駕駛室側門邊框',(x-.11,y-side*.008,1.91),.79,2.22,'chassis',r=.035)
   panel('駕駛室側門下片',(x-.11,y+side*.009,1.60),.70,1.35,'body',r=.025)
   # 重疊門框上方的窗再放到外側，窗框不消失。
   sidewindow(x,y+side*.04,2.87,.66,.61)
   for z in [.39,.60,.80]:box('駕駛室登車踏階',(x-.13,side*(W/2-.01),z),(.53,.15,.042),'metal',.008)
  count=s.get('sideVentPanels',6)
  left=-L/2+(.60 if front in ['push-pull','stadler-diesel'] else 1.88);right=L/2-1.88
  for i in range(count):
   x=left+(i+.5)*(right-left)/count;w=(right-left)/count*.83
   grille('車側散熱百葉',x,y,2.67 if front=='ge' else 2.33,w,.62 if front=='ge' else 1.20,True,10,front=='push-pull')
   if front=='ge':box('下部機械室檢修板',(x,y-side*.009,1.75),(w,.018,.85),'body',.022)
 bogies(L,W,axles=s['axles'],r=.42);coupler(L/2+.04,W,z=.70);coupler(-L/2-.04,W,-1,z=.70)
 use('05')
 if s['pantos']:
  for x in ([-L*.28,L*.28] if s['pantos']==2 else [-L*.23]):pantograph(x,H,diamond=front=='ge')
  box('高壓屋頂設備罩',(0,0,H+.12),(L*.29,W*.64,.24),'roof',.085)
  for k in range(9):box('屋頂冷卻風柵',(-L*.12+k*L*.03,0,H+.249),(.04,W*.46,.012),'chassis',.002)
  line('屋頂高壓母線',[(-L*.28,-.82,H+.09),(L*.28,-.82,H+.09)],.018,'metal')
 else:
  for x in [-2.90,-1.64,-.38]:
   cyl('柴油散熱風扇護圈',(x,0,H+.075),.46,.11,'chassis',n=40)
   for k in range(6):
    a=k*math.pi/3;rod('風扇保護柵',(x-.42*math.cos(a),-.42*math.sin(a),H+.14),(x+.42*math.cos(a),.42*math.sin(a),H+.14),.012,'metal')
  box('柴油排氣罩',(1.06,0,H+.14),(.59,.75,.29),'chassis',.055)
 return f

def hood(s):
 if s['id']=='blue':
  from build_breezy_blue import locomotive
  return locomotive(s)
 L,W,H=s['L'],s['W'],s['H'];center=s.get('centerCab',False);high=s.get('highNose',False)
 cabx=0 if center else -L*.22 if high else L*.21;cabL=1.57;deck=.97;hoodW=W*.54
 use('01');box('厚重走道甲板',(0,0,deck),(L,W,.18),'chassis',.05)
 cabz=(deck+H-.10)/2;box('獨立駕駛室',(cabx,0,cabz),(cabL,W*.85,H-.10-deck),'body',.11)
 box('駕駛室外伸圓頂',(cabx,0,H),(cabL+.14,W*.93,.22),'chassis' if s['id']=='blue' else 'body',.10)
 frontH=H-.42 if high else 2.07;rearH=H-.42
 if center:frontH=rearH=2.26
 for a,b,h in [(cabx+cabL/2,L/2-.20,frontH),(-L/2+.20,cabx-cabL/2,rearH)]:
  if b<=a:continue
  box('引擎蓋獨立機殼',((a+b)/2,0,(deck+h)/2),(b-a,hoodW,h-deck),'body',.045)
  for side in [-1,1]:
   yy=side*(hoodW/2+.016);box('引擎蓋白色水平帶',((a+b)/2,yy,1.81),(b-a,.018,.13),'accent',.003)
   n=max(2,round((b-a)/.66))
   for i in range(n):
    xx=a+(i+.5)*(b-a)/n
    panel('引擎室检修門',(xx,yy,2.33 if h>2.5 else 1.47),(b-a)/n-.045,.86 if h>2.5 else .35,'body',r=.014)
    rod('引擎門把',(xx-.12,yy+side*.016,2.18 if h>2.5 else 1.53),(xx-.12,yy+side*.016,2.38 if h>2.5 else 1.69),.013,'metal')
   grille('引擎散熱格柵',(a+b)/2,yy,h-.39,min(1.44,b-a-.15),.48,True,12,True)
  if h>2.4:
   for i in range(s.get('radiators',2)):
    xx=a+.36+i*min(.72,(b-a-.65)/max(1,s.get('radiators',2)-1));cyl('引擎頂風扇環',(xx,0,h+.027),.23,.07,'chassis',n=32)
    for k in [-.12,0,.12]:rod('散熱風扇護條',(xx-.19,k,h+.072),(xx+.19,k,h+.072),.01,'metal')
 frontx=L/2-.20;f=lambda y,z:frontx
 use('03')
 if high:
  for z in [H-.52,H-.82]:lamp('高鼻端雙燈',f,0,z,.092)
 else:
  front_ribbon('柴電白色飛翼紋',f,[(-hoodW/2+.01,1.86),(-.43,1.79),(0,1.47),(.43,1.79),(hoodW/2-.01,1.86)],.072,'accent')
  # 兩盞頭燈位於駕駛室上額，保留低短鼻輪廓。
  for z in [H-.28,H-.55]:lamp('駕駛上額雙燈',lambda y,z:cabx+cabL/2+.014,0,z,.087)
 for side in [-1,1]:
  sidewindow(cabx,side*(W*.425+.016),H-.73,1.12,.67)
  f2=lambda y,z:cabx+cabL/2+.014
  front_panel('柴電駕駛前窗框',f2,side*.66,H-.73,.73,.66,'frame',.06)
  front_panel('柴電駕駛前玻璃',f2,side*.66,H-.73,.65,.58,'glass',.045,.051)
  for y in [side*.66]:wiper(f2,y,H-1.00,.40)
  use('02');panel('駕駛側門下片',(cabx,side*(W*.426),1.73),.64,1.00,'body',r=.03)
  # 側走道扶手有明確立柱和橫桿，不是整塊白牆。
  use('03');yy=side*W*.46
  for a,b in [(-L/2+.08,cabx-cabL/2-.06),(cabx+cabL/2+.06,L/2-.08)]:
   if b-a<.15:continue
   line('走道安全扶手',[(a,yy,1.89),(b,yy,1.89)],.018,'accent')
   n=max(2,round((b-a)/.65))
   for j in range(n+1):xx=a+(b-a)*j/n;rod('扶手立柱',(xx,yy,1.03),(xx,yy,1.88),.020,'accent')
  for end in [-1,1]:
   for z in [.37,.57,.77]:box('端部踏階',(end*(L/2-.13),side*(W*.37),z),(.39,.34,.042),'metal',.008)
 for end in [-1,1]:
  if end==1:hazard(L/2+.006,W,.80,.54)
  else:
   st=len(p.MODEL);hazard(L/2+.006,W,.80,.54);tmp=p.MODEL[st:]
   for o in tmp:o.matrix_world=Matrix.Rotation(math.pi,4,'Z')@o.matrix_world
  coupler(end*(L/2+.07),W,end,z=.59)
 bogies(L,W,axles=s['axles'],r=.40)
 use('05');cyl('排氣管',(cabx-cabL/2-.35 if not high else cabx+cabL/2+.35,0,H-.17),.14,.43,'chassis',n=24)
 # 車型牌獨立材質，可完全移除；不是捏造的車籍號。
 text_label(s['id'].upper(),(frontx+.07,0,frontH-.22),.17)

def forest_loco(s):
 L,W,H=s['L'],s['W'],s['H'];kind=s['front'];deck=.70;cabx=-L*.31;cabL=1.42;hoodEnd=L/2-.16;hoodStart=cabx+cabL/2;hoodTop=H-.48
 use('01');box('林鐵窄軌甲板',(0,0,deck),(L,W,.15),'chassis',.03)
 box('林鐵引擎罩',((hoodStart+hoodEnd)/2,0,(deck+hoodTop)/2),(hoodEnd-hoodStart,W*.79,hoodTop-deck),'body',.052)
 box('林鐵後置駕駛室',(cabx,0,(deck+H-.13)/2),(cabL,W*.95,H-.13-deck),'body',.095)
 box('林鐵駕駛頂蓋',(cabx,0,H-.015),(cabL+.17,W+.05,.16),'body',.08)
 f=lambda y,z:hoodEnd;fw=W*.79
 front_panel('林鐵車頭格柵背板',f,0,(deck+hoodTop)/2,fw-.10,hoodTop-deck-.07,'chassis',.024)
 for i in range(15):front_panel('林鐵端面水平百葉',f,0,deck+.10+i*(hoodTop-deck-.20)/14,fw-.12,.054,'body',.009,.047)
 if kind!='mitsubishi':front_ribbon('林鐵白色 V 字',f,[(-fw/2+.04,hoodTop-.57),(0,deck+.29),(fw/2-.04,hoodTop-.57)],.12,'accent')
 else:front_panel('三菱白色水平帶',f,0,hoodTop-.21,fw-.08,.115,'accent',.01,.06)
 if kind=='prototype':
  # DL38 小燈與較平的短鼻；非 DL39 的外凸大燈筒。
  for side in [-1,1]:lamp('DL38 小型頭燈',f,side*fw*.39,hoodTop-.15,.078)
  lamp('DL38 駕駛室頂燈',lambda y,z:cabx+cabL/2+.015,0,H-.15,.075)
 elif kind=='mitsubishi':
  for side in [-1,1]:lamp('三菱小型下燈',f,side*fw*.35,deck+.38,.068)
 else:
  for side in [-1,1]:
   cyl('外凸圓筒燈具',(hoodEnd+.09,side*fw*.43,hoodTop-.13),.17,.18,'accent','X',32)
   lamp('林鐵大圓燈',lambda y,z:hoodEnd+.17,side*fw*.43,hoodTop-.13,.13)
   for z,red in [(deck+.64,False),(deck+.35,True)]:lamp('林鐵直列小燈',f,side*fw*.43,z,.065,red)
 for side in [-1,1]:
  yy=side*W*.397
  for j in range(5):
   x=hoodStart+.25+j*(hoodEnd-hoodStart-.55)/4
   use('01');panel('引擎罩分片檢修門',(x,yy,(deck+hoodTop)/2),.50,hoodTop-deck-.1,'body',r=.025)
   grille('林鐵車側通風柵',x,yy+side*.012,hoodTop-.33,.41,.36,True,6)
   rod('小型檢修門把',(x-.14,yy+side*.033,1.23),(x-.14,yy+side*.033,1.43),.011,'metal')
  box('林鐵車側白腰線',((hoodStart+hoodEnd)/2,yy+side*.021,hoodTop-.57),(hoodEnd-hoodStart,.019,.12),'accent',.003)
  sidewindow(cabx,side*(W*.478),H-.61,1.10,.69)
  front_panel('駕駛室前窗',lambda y,z:cabx+cabL/2+.015,side*.48,H-.61,.72,.66,'glass',.04)
  line('引擎罩上緣扶手',[(hoodStart+.12,yy,hoodTop+.08),(hoodEnd-.08,yy,hoodTop+.08)],.018,'chassis')
  for z in [.25,.43,.59]:box('林鐵駕駛室踏階',(cabx,side*W*.45,z),(.58,.25,.035),'metal',.009)
 for end in [-1,1]:coupler(end*(L/2+.04),W,end,z=.44)
 bogies(L,W,axles=2,r=.30,centers=[-L*.28,L*.28])
 use('05');cyl('林鐵排氣口',(hoodStart+.40,0,hoodTop+.16),.10,.31,'chassis',n=24)
 text_label(s['id'].upper(),(hoodEnd+.085,0,hoodTop-.10),.15)

def coach(s):
 if s['id']=='bluecoach':
  from build_breezy_blue import coach as breezy_coach
  return breezy_coach(s)
 L,W,H=s['L'],s['W'],s['H'];id=s['id'];f,neck=shell(s,'flat');use('01')
 if s.get('wood'):
  body=p.MODEL[0];body.data.materials.append(p.M['roof'])
  for poly in body.data.polygons:
   if sum(body.data.vertices[i].co.z for i in poly.vertices)/len(poly.vertices)>H-.15:poly.material_index=1
 if id in ['juguang','bluecoach','mingricoach']:
  side_band(s,1.31,.90,'accent',x0=-L/2+.04,x1=L/2-.04)
  if id=='mingricoach':
   side_band(s,1.80,.036,'gold',x0=-L/2+.05,x1=L/2-.05);side_band(s,1.84,.018,'gold',x0=-L/2+.05,x1=L/2-.05)
 elif id=='ppcoach':
  side_band(s,2.27,.95,'accent',x0=-L/2+.04,x1=L/2-.04);side_band(s,1.28,.06,'red',x0=-L/2+.04,x1=L/2-.04)
 elif id=='alicoach':side_band(s,H-.90,1.12,'accent',x0=-L/2+.04,x1=L/2-.04)
 elif id=='xuyue':side_band(s,1.04,.38,'accent',x0=-L/2+.04,x1=L/2-.04);side_band(s,1.33,.035,'gold',x0=-L/2+.04,x1=L/2-.04)
 elif id=='fushen':side_band(s,1.44,.072,'accent',x0=-L/2+.04,x1=L/2-.04)
 passenger_sides(s,neck)
 for end in [-1,1]:
  e=lambda y,z:end*(L/2+.025)
  if id in ['fushen','xuyue'] and end==1:
   front_panel('觀景端面大窗框',e,0,2.20,W-.33,1.13,'frame',.075)
   front_panel('觀景端面玻璃',e,0,2.20,W-.42,1.04,'glass',.055,.05)
   for side in [-1,1]:lamp('觀景端燈',e,side*.75,1.25,.063)
   lamp('觀景端上方小燈',e,0,H-.12,.05)
   coupler(end*(L/2+.05),W,end,z=.54)
  else:
   use('07');panel('客車端牆貫通門',(end*(L/2+.018),0,2.0),.72,1.70,'chassis','front',r=.065)
   panel('端門玻璃',(end*(L/2+.042),0,2.46),.45,.65,'glass','front',r=.04)
   coupler(end*(L/2+.025),W,end,z=.58,gangway=not s.get('vestibule',False))
   if s.get('vestibule'):
    box('檜木客車端平台',(end*(L/2+.12),0,.83),(.46,W*.80,.10),'chassis',.02)
    for side in [-1,1]:line('端平台直立扶手',[(end*(L/2+.25),side*.70,.86),(end*(L/2+.25),side*.70,2.03)],.023,'chassis')
  if id in ['juguang','bluecoach','mingricoach']:
   panel('客車端牆腰色',(end*(L/2+.003),0,1.29),W-.1,.86,'accent','front',r=.01)
 bogies(L,W,r=.33 if s['family']=='forestcoach' else .39);roof_units(L,W,H,s['roof'])
 if s.get('wood'):
  # 淺木／深木材質用實體板色輕微交錯，不封裝木紋照片。
  use('01');box('木造屋簷線',(0,-W/2-.015,H-.07),(L+.06,.07,.09),'accent',.03);box('木造屋簷線',(0,W/2+.015,H-.07),(L+.06,.07,.09),'accent',.03)
  if id=='fushen':
   for side in [-1,1]:box('福森紅色窗台',(0,side*(W/2+.045),1.48),(L-.65,.09,.07),'accent',.014)


def steam(s):
 L,W,H=s['L'],s['W'],s['H'];tank=s['tank'];r=s['driverRadius'];drivers=s['drivers'];id=s['id']
 use('04')
 front=2.64 if tank else 4.78;cabx=-2.35 if tank else -1.77;cabL=1.65;boilerBack=cabx+.45;boilerFront=front-.10;boilerZ=2.05 if tank else 2.40;boilerR=.69 if tank else .86
 frameRear=-3.13 if tank else -2.58;frameFront=3.16 if tank else 5.52
 box('蒸機底盤主樑',((frameRear+frameFront)/2,0,1.0),(frameFront-frameRear,W*.60,.28),'body',.035)
 driveCenter=0 if tank else 1.05;spacing=1.11 if tank else 1.30 if drivers==4 else 1.59
 driveXs=[driveCenter+(i-(drivers-1)/2)*spacing for i in range(drivers)]
 for x in driveXs:
  cyl('蒸機動輪軸',(x,0,r),.09,W*.72,'chassis','Y',20)
  for side in [-1,1]:
   wheel(x,side*W*.39,r,spoked=True)
   cyl('動輪偏心曲柄',(x+.15,side*(W*.39+.17),r-.09),.066,.10,'metal','Y',20)
 for side in [-1,1]:
  yy=side*(W*.39+.23)
  line('獨立主連動桿',[(x+.15,yy,r-.09) for x in driveXs],.043,'metal')
  line('汽缸活塞桿',[(driveXs[-1]-.04,yy,r-.05),(front-.09,yy,r+.08)],.035,'metal')
  cyl('外置汽缸',(front-.12,side*W*.35,1.02),.25,.68,'body','X',32)
  cyl('汽缸端蓋',(front+.24,side*W*.35,1.02),.235,.035,'metal','X',32)
  for z in [1.05,1.22]:line('配氣機構拉桿',[(driveXs[0],side*(W*.39+.12),z),(front-.10,side*(W*.39+.12),z+.08)],.020,'metal')
 leadingxs=[front+.10] if s['leading']==1 else [front-.10,front+.71]
 trailingx=cabx-.35
 for x in leadingxs+[trailingx]:
  for side in [-1,1]:wheel(x,side*W*.32,.27 if tank else .32,spoked=True)
 use('01');cyl('圓筒鍋爐',((boilerBack+boilerFront)/2,0,boilerZ),boilerR,boilerFront-boilerBack,'body','X',64,.012)
 for i in range(6):
  x=boilerBack+(i+.4)*(boilerFront-boilerBack)/6
  # 鍋爐箍環獨立薄圓環。
  cyl('鍋爐箍環',(x,0,boilerZ),boilerR+.015,.038,'chassis','X',64,.004)
 cyl('前煙箱',(boilerFront-.24,0,boilerZ),boilerR+.02,.58,'body','X',64)
 cyl('煙箱前圓蓋',(boilerFront+.065,0,boilerZ),boilerR*.93,.12,'chassis','X',64,.02)
 cyl('煙箱門中央凹盤',(boilerFront+.132,0,boilerZ),boilerR*.78,.021,'body','X',64)
 for i in range(16):
  a=2*math.pi*i/16;y=boilerR*.88*math.cos(a);z=boilerZ+boilerR*.88*math.sin(a)
  cyl('煙箱蓋鉚釘',(boilerFront+.141,y,z),.018,.026,'metal','X',10,.003)
 f=lambda y,z:boilerFront+.15
 for a in [0,math.pi/2,math.pi,3*math.pi/2]:rod('煙箱門手輪輻條',(boilerFront+.24,0,boilerZ),(boilerFront+.24,.11*math.cos(a),boilerZ+.11*math.sin(a)),.012,'metal')
 cyl('煙箱門輪心',(boilerFront+.24,0,boilerZ),.034,.035,'metal','X',16)
 use('05');chimx=boilerFront-.33
 cyl('煙囪基座',(chimx,0,boilerZ+boilerR-.025),.23,.19,'body',n=40)
 cyl('煙囪',(chimx,0,boilerZ+boilerR+.30),.17,.52,'body',n=40)
 cyl('煙囪上緣',(chimx,0,boilerZ+boilerR+.55),.21,.08,'chassis',n=40)
 for x in [boilerBack+.64,boilerBack+1.58]:
  cyl('蒸汽圓頂基座',(x,0,boilerZ+boilerR-.02),.27,.14,'body',n=36)
  cyl('蒸汽圓頂',(x,0,boilerZ+boilerR+.15),.22,.31,'body',n=36,bevel=.10)
 rod('黃銅汽笛',(boilerBack+.44,-.35,boilerZ+boilerR+.08),(boilerBack+.44,-.35,boilerZ+boilerR+.42),.044,'gold')
 for side in [-1,1]:
  yy=side*(boilerR+.08)
  line('鍋爐側扶手',[(boilerBack+.12,yy,boilerZ+.25),(boilerFront+.02,yy,boilerZ+.25)],.019,'metal')
  for i in range(5):
   x=boilerBack+.25+i*(boilerFront-boilerBack-.45)/4;rod('扶手支架',(x,side*boilerR,boilerZ+.23),(x,yy,boilerZ+.25),.012,'metal')
  line('蒸汽輸送管',[(boilerBack+.28,side*.42,boilerZ+.68),(boilerBack+.65,side*.64,boilerZ+.50),(boilerFront-.55,side*.82,1.42)],.032,'chassis')
  box('兩側踏板',((boilerBack+boilerFront)/2,side*W*.38,1.44),(boilerFront-boilerBack,W*.19,.075),'body',.012)
 use('01');box('駕駛室後牆',(cabx-cabL/2,0,2.19),(.11,W*.93,2.2),'body',.045)
 box('駕駛室前牆',(cabx+cabL/2,0,2.19),(.10,W*.91,2.2),'body',.055)
 box('駕駛室拱頂',(cabx,0,3.36 if tank else 3.68),(cabL+.22,W+.12,.20),'body',.11)
 for side in [-1,1]:
  box('駕駛室側下牆',(cabx,side*W*.445,1.71),(cabL,.10,1.17),'body',.04)
  sidewindow(cabx+.16,side*W*.475,2.72 if tank else 2.96,.80,.67,r=.16)
  panel('駕駛室側車牌',(cabx,side*(W*.46+.028),1.73),.69,.25,'red',r=.023)
  text_label(id.upper(),(cabx,side*(W*.46+.047),1.73),.15,'side',side)
  for z in [.42,.67,.91]:box('蒸機司機踏階',(cabx-.40,side*W*.42,z),(.54,.36,.05),'chassis',.014)
 if tank:
  for side in [-1,1]:box('水櫃式蒸機側水箱',(-.85,side*.82,1.90),(2.91,.66,.89),'body',.06)
  box('後部煤槽',(cabx-.84,0,1.93),(.46,1.92,1.22),'body',.04)
 else:
  # 煤水車屬本款模型，但其輪軸和車體獨立，可拆出隨路徑定位。
  tx=-4.40;tl=2.65
  use('07');box('煤水車底架',(tx,0,.91),(tl,W*.91,.21),'chassis',.04)
  box('煤水車本體',(tx,0,2.12),(tl,W*.89,2.18),'body',.08)
  box('煤水車上方凹槽',(tx+.18,0,3.22),(tl-.43,W*.73,.07),'frame',.055)
  for i in range(28):
   x=tx-.88+(i%7)*.28;y=-.70+(i//7)*.44;box('煤堆塊',(x,y,3.27+.05*math.sin(i*3)),(.30,.37,.16),'chassis',.055)
  for x in [tx-.98,tx-.43,tx+.43,tx+.98]:
   for side in [-1,1]:wheel(x,side*W*.34,.265,spoked=False)
  for side in [-1,1]:
   box('煤水車轉向架側樑',(tx,side*W*.34,.63),(2.32,.14,.19),'chassis',.025)
   for x in [tx-1.0,tx+1.0]:line('煤水車外側扶手',[(x,side*W*.48,1.0),(x,side*W*.48,2.92)],.021,'metal')
  rod('煤水車連結桿',(tx+tl/2,0,.66),(cabx-cabL/2,0,.66),.055,'chassis')
 use('03')
 # CK124 復駛樣式也具有兩片導煙板；較大型機車的板面明顯更大。
 for side in [-1,1]:
  xx=boilerFront-.43;yy=side*W*.47
  panel('導煙板',(xx,yy,2.62 if tank else 2.80),1.03 if tank else 1.50,1.45 if tank else 1.94,'body',r=.13,depth=.05)
  line('導煙板上緣',[ (xx-.43,yy+side*.03,3.25 if tank else 3.71),(xx+.43,yy+side*.03,3.25 if tank else 3.71)],.009,'gold')
 panel('蒸汽機車編號紅牌',(boilerFront+.233,0,boilerZ+.43),.92,.28,'red','front',r=.025)
 text_label(id.upper(),(boilerFront+.251,0,boilerZ+.43),.19)
 lamp('蒸機上方單燈',lambda y,z:boilerFront+.12,0,boilerZ+boilerR+.24,.13)
 box('蒸機前端梁',(frameFront,0,.86),(.15,W*.90,.24),'body',.025)
 for side in [-1,1]:line('蒸機前端扶手',[(frameFront+.04,side*.98,.94),(frameFront+.04,side*.98,1.53),(frameFront+.04,side*.45,1.53)],.024,'metal')
 for i in range(9):rod('前方排障器直柵',(frameFront+.14,-.9+i*.225,.28),(frameFront+.02,-.9+i*.225,.71),.024,'chassis')
 rod('排障器下橫樑',(frameFront+.14,-1.00,.28),(frameFront+.14,1.00,.28),.035,'chassis')
 coupler(frameFront+.11,W,z=.70);coupler((-L/2 if not tank else cabx-.94),W,-1,z=.60)


def tram(s):
 W,H=s['W'],s['H'];kind=s['front'];lengths=[3.56,2.14,3.10,2.14,3.56];gap=.20;total=sum(lengths)+4*gap;cursor=-total/2
 sectionObjects=[]
 for i,l in enumerate(lengths):
  cx=cursor+l/2;cursor+=l+gap;st=len(p.MODEL)
  ss={**s,'L':l,'bottom':.37,'radius':.28,'front':kind if i in [0,4] else 'flat'}
  f,neck=shell(ss,ss['front'],name=f'第 {i+1} 節獨立車體')
  # 車側玻璃及車門按低地板編組配置；浮動模組與轉向架模組分開。
  for side in [-1,1]:
   yy=side*(W/2+.02);use('01')
   band_left=-l/2+.16;band_right=neck-.04 if i in [0,4] else l/2-.26
   box('輕軌連續黑窗帶',((band_left+band_right)/2,yy,1.98),(band_right-band_left,.02,1.85),'frame',.09)
   if i in [1,3]:
    # 兩組懸浮短車身各一組雙扇寬門。
    use('02')
    for leaf,xx in enumerate([-.42,.42]):
     o=panel('低地板雙扇門',(xx,yy+side*.022,1.69),.81,2.48,'frame',r=.07);o['side_door']=True;o['side']=side;o['door_group']=i;o['leaf']=leaf
     panel('落地門窗',(xx,yy+side*.04,1.85),.71,2.08,'glass',r=.05)
     box('門沿警示細線',(xx+(-.35 if leaf==0 else .35),yy+side*.055,1.72),(.012,.01,2.34),'gold',.002)
    box('低地板門檻',(0,yy,.47),(1.72,.10,.04),'metal',.01)
   elif i in [0,4]:
    # 駕駛模組也有乘客門；不能只在兩個懸浮模組開門。
    use('02');doorx=-l/2+.72
    for leaf,dx in enumerate([-.22,.22]):
     o=panel('駕駛模組雙扇側門',(doorx+dx,yy+side*.024,1.69),.42,2.43,'frame',r=.045);o['side_door']=True;o['side']=side;o['door_group']=i;o['leaf']=leaf
     panel('駕駛模組落地門窗',(doorx+dx,yy+side*.042,1.84),.34,2.08,'glass',r=.035)
    sidewindow(doorx+.87,yy+side*.025,2.04,.66,1.65,.07)
    sidewindow(neck-.30,yy+side*.025,2.18,.40,1.20,.065)
    box('駕駛模組門檻',(doorx,yy,.48),(.94,.09,.04),'metal',.009)
   else:
    for j in range(3):
     ww=(l-.62)/3;xx=-l/2+.31+(j+.5)*ww
     sidewindow(xx,yy+side*.022,2.0,ww-.07,1.76,.08)
   use('01');skirts=[box('輕軌側裙',(0,side*(W/2-.008),.60),(l-.13,.055,.43),'body',.04)]
   if s['id'] in ['caf','citadis']:skirts.append(box('輕軌側裙綠線',(0,side*(W/2+.026),.45),(l-.10,.015,.16),'accent',.014))
   if i in [0,4]:
    for o in skirts:
     for v in o.data.vertices:v.co.x=min(v.co.x,f(v.co.y,v.co.z)-.018)
  if i==4 or i==0:
   front_panel('輕軌車頭包覆',f,0,1.78,W-.09,2.68,'body',.46)
   if kind=='urbos':front_panel('CAF 深綠環圈',f,0,1.91,W-.18,2.38,'accent',.55,.047)
   elif kind=='citadis':front_panel('Citadis 細綠外框',f,0,1.96,W-.17,2.61,'accent',.46,.047)
   front_panel('輕軌全高前窗框',f,0,2.09,W-.36,2.27 if kind!='danhaiform' else 2.12,'frame',.35,.068)
   front_panel('輕軌前窗玻璃',f,0,2.21,W-.48,1.80,'glass',.29,.091)
   if kind=='danhaiform':front_panel('行武者圓弧下巴',f,0,.77,W-.24,.57,'body',.22,.045)
   for side in [-1,1]:
    if kind=='citadis':front_panel('Citadis 折角腰燈',f,side*.88,1.11,.30,.31,'lamp',.10,.105)
    elif kind=='urbos':
     front_panel('CAF 白色燈具區',f,0,1.24,W-.22,.52,'body',.10,.11) if side==-1 else None
     for yy in [side*.78,side*1.02]:
      lamp('CAF 上方圓燈',lambda y,z:f(y,z)+.12,yy,1.35,.053)
      lamp('CAF 下方識別燈',lambda y,z:f(y,z)+.12,yy,1.15,.046,abs(yy)<.9)
     lamp('CAF 下裙小燈',lambda y,z:f(y,z)+.07,side*.80,.73,.029)
    else:lamp('輕軌圓形頭燈',lambda y,z:f(y,z)+.085,side*.82,1.18,.075)
   front_panel('輕軌目的地顯示器',f,0,2.88,1.05,.23,'frame',.035,.104)
   wiper(lambda y,z:f(y,z)+.06,0,1.27,1.06)
  roofx=(-l/2+.15+neck-.18)/2 if i in [0,4] else 0
  rooflen=neck+l/2-.33 if i in [0,4] else l*.72
  use('05');box('輕軌頂部機電罩',(roofx,0,H+.15),(rooflen,W*.66,.30),'roof',.095)
  for side in [-1,1]:grille('輕軌頂罩格柵',roofx,side*W*.33,H+.16,rooflen*.85,.21,True,6)
  if i in [0,2,4]:
   use('04')
   for xx in [-.48,.48]:
    for side in [-1,1]:wheel(xx,side*W*.32,.285)
   box('輕軌轉向架',(0,0,.51),(1.48,W*.66,.25),'chassis',.05)
  objs=list(p.MODEL[st:])
  # 第 1 節朝 -X、第 5 節朝 +X；其餘車體保持自己的中心原點。
  T=Matrix.Translation(Vector((cx,0,0)));R=Matrix.Rotation(math.pi if i==0 else 0,4,'Z')
  for o in objs:o.matrix_world=T@R@o.matrix_world;o['section_index']=i
  sectionObjects.append({'index':i,'centerX':cx,'length':l,'orientation':-1 if i==0 else 1})
  if i<4:
   use('07');jointx=cx+l/2+gap/2
   for j in range(6):panel('輕軌可分離風琴折片',(jointx-gap/2+(j+.5)*gap/6,0,1.72),W-.08,2.60,'rubber','front',r=.25,depth=.015)
 if s['power']=='overhead':pantograph(0,H)
 elif s['id']=='caf':
  st=len(p.MODEL);pantograph(-2.65,H)
  for o in p.MODEL[st:]:
   for v in o.data.vertices:v.co.z=H+.035+(v.co.z-H)*.22
 s['articulationCenters']=sectionObjects;s['L']=total;s['pantos']=1 if s['power']=='overhead' or s['id']=='caf' else 0;s['doors']=4

# 700T 第二輪：圓潤鴨嘴鼻、較短的 Q 版比例與正確後移的前轉向架。
def shinkansen_shell(s):
 L,W,H=s['L'],s['W'],s['H'];tip=L/2-.12;neck=.55
 # x、寬、底、頂、截面圆角。鼻尖各個方向都收圓，不再以高度折線擠出楔形。
 control=[(-L/2,W,.83,H,.24),(-L/2+.14,W,.83,H,.24),(neck,W,.83,H,.26),
  (1.30,2.80,.82,3.13,.37),(2.05,2.61,.79,2.76,.47),(2.67,2.30,.79,2.28,.51),
  (3.21,2.02,.84,1.89,.44),(3.67,1.51,.95,1.55,.25),(4.02,1.06,1.035,1.385,.17),(tip-.04,.50,1.10,1.29,.09),(tip,.014,1.187,1.201,.006)]
 # 形狀保持的三次 Hermite 插值：截面間斜率連續，避免各段 smoothstep
 # 在控制點歸零所形成的波浪、玻璃摺痕與色帶鋸齒。
 slopes=[]
 for k in range(1,5):
  h=[b[0]-a[0] for a,b in zip(control,control[1:])]
  d=[(b[k]-a[k])/v for a,b,v in zip(control,control[1:],h)]
  m=[d[0]]
  for i in range(1,len(control)-1):
   if d[i-1]*d[i]<=0:m.append(0)
   else:
    w1=2*h[i]+h[i-1];w2=h[i]+2*h[i-1]
    m.append((w1+w2)/(w1/d[i-1]+w2/d[i]))
  m.append(d[-1]);slopes.append(m)
 def shape(x):
  for i,(a,b) in enumerate(zip(control,control[1:])):
   if x<=b[0]:
    h=b[0]-a[0];t=max(0,(x-a[0])/h)
    return [(2*t**3-3*t*t+1)*a[k]+(t**3-2*t*t+t)*h*slopes[k-1][i]+(-2*t**3+3*t*t)*b[k]+(t**3-t*t)*h*slopes[k-1][i+1] for k in range(1,5)]
  return list(control[-1][1:])
 def half_width(x,z):
  w,z0,z1,r=shape(x);r=min(r,w/2,(z1-z0)/2);delta=max(0,z0+r-z,z-(z1-r))
  if z<z0 or z>z1:return -1
  return w/2-r+math.sqrt(max(0,r*r-delta*delta)) if delta else w/2
 def surface(y,z):
  a=neck;b=tip
  for i in range(32):
   mid=(a+b)/2
   if abs(y)<=half_width(mid,z):a=mid
   else:b=mid
  return a
 samples=[]
 for a,b in zip(control,control[1:]):
  n=2 if b[0]<=neck else max(12,math.ceil((b[0]-a[0])/.03))
  samples.extend(a[0]+(b[0]-a[0])*i/n for i in range(n))
 samples.append(tip);verts=[];ring_count=0
 for x in samples:
  w,z0,z1,r=shape(x);pts=rounded(w,z1-z0,min(r,(z1-z0)/2,w/2),8);ring_count=len(pts)
  verts.extend((x,y,(z0+z1)/2+z) for y,z in pts)
 n=ring_count;faces=[tuple(reversed(range(n))),tuple(range((len(samples)-1)*n,len(samples)*n))]
 faces +=[(k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j) for k in range(len(samples)-1) for j in range(n)]
 use('01');body=mesh('700T 鼻殼施工曲面',verts,faces,'body',0,True)
 # 將同一張封閉車殼沿塗裝邊界切面，三色共用幾何和插值法線。
 # 不再以懸浮面片疊在鼻尖，避免正面出現白縫、黑縫與補片陰影。
 body.data.calc_loop_triangles()
 groups={key:([],[],[]) for key in ['body','accent','chassis']}
 def top_color(pos):
  t=max(0,min(1,(pos.x-neck)/1.1));t=t*t*(3-2*t)
  return 1.36*(1-t)+(1.27+.50*(abs(pos.y)/(W/2))**1.8)*t
 def clip(poly,fn,positive=True):
  result=[]
  for a,b in zip(poly,poly[1:]+poly[:1]):
   va=fn(a[0]);vb=fn(b[0]);ina=(va>=0) if positive else (va<=0);inb=(vb>=0) if positive else (vb<=0)
   if ina:result.append(a)
   if ina!=inb:
    t=va/(va-vb);result.append((a[0].lerp(b[0],t),a[1].lerp(b[1],t).normalized()))
  return result
 for tri in body.data.loop_triangles:
  poly=[(body.data.vertices[i].co.copy(),body.data.vertices[i].normal.copy()) for i in tri.vertices]
  low=lambda v:v.z-.94
  top=lambda v:v.z-top_color(v)
  pieces={'body':clip(poly,top),'accent':clip(clip(poly,top,False),low),'chassis':clip(poly,low,False)}
  for key,part in pieces.items():
   if len(part)<3:continue
   vv,ff,nn=groups[key];base=len(vv);vv.extend(tuple(a) for a,b in part);nn.extend(tuple(b.normalized()) for a,b in part)
   ff.extend((base,base+i,base+i+1) for i in range(1,len(part)-1))
 p.MODEL.remove(body);bpy.data.objects.remove(body,do_unlink=True)
 for key,(vv,ff,nn) in groups.items():
  name={'body':'700T 圓潤鴨嘴鼻與圓肩車殼','accent':'700T U 形連續橘色鼻圍','chassis':'700T 曲面下巴與底裙'}[key]
  d=bpy.data.meshes.new(name);d.from_pydata(vv,[],ff);d.update()
  o=bpy.data.objects.new(name,d);p.ACTIVE.objects.link(o);p.MODEL.append(o);finish(o,key,0,True)
  d.normals_split_custom_set_from_vertices(nn)
  if key=='body':o['primary_body']=True
 for side in [-1,1]:box('700T 橘帶上黑色細線',((-L/2+neck)/2,side*(W/2+.014),1.39),(neck+L/2-.04,.013,.045),'frame',.004)
 return surface,neck
