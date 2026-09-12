"""2026-09-08 藍皮外觀校正。照片比對紀錄見 BLUE-REVISION.md。
保留 Q 版短車長；窗數與設備數為展示簡化，並非逐車工程複製。
"""
import math
import blender_parts as p
from blender_parts import *

def prism(name,a,b,section,material,bevel=.02):
 n=len(section)
 return mesh(name,[(x,y,z) for x in [a,b] for y,z in section],
  [tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],material,bevel)

def stripe_front(name,x,points,width):
 # V 字以尖端漸縮的面片連續建成，不用粗圓管冒充油漆。
 verts=[]
 for i,(y,z) in enumerate(points):
  a=points[max(0,i-1)];b=points[min(len(points)-1,i+1)]
  d=math.dist(a,b);w=width*(.08+.92*min(1,abs(y)/.35))/2
  ny=-(b[1]-a[1])/d*w;nz=(b[0]-a[0])/d*w
  verts.extend([(x,y+ny,z+nz),(x,y-ny,z-nz)])
 mesh(name,verts,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(len(points)-1)],'accent')

def r135_lamp(name,x,y,z,r,red=False):
 use('03')
 cyl(name+' 外凸深色燈筒',(x+.024,y,z),r*1.33,.093,'frame','X',40)
 cyl(name+' 金屬燈圈',(x+.080,y,z),r*1.22,.033,'lampmetal','X',40)
 cyl(name+' 內部反射碗',(x+.100,y,z),r*1.06,.017,'reflector','X',40)
 # 凸透鏡保留曲面及細肋，避免頭燈只是兩個平面白圓。
 v=[(x+.139,y,z)];rings=5;n=40
 for j in range(1,rings+1):
  rr=r*j/rings
  for k in range(n):
   a=2*math.pi*k/n;v.append((x+.113+.026*math.sqrt(max(0,1-(rr/r)**2)),y+rr*math.cos(a),z+rr*math.sin(a)))
 faces=[(0,1+k,1+(k+1)%n) for k in range(n)]
 faces += [(1+(j-1)*n+k,1+j*n+k,1+j*n+(k+1)%n,1+(j-1)*n+(k+1)%n) for j in range(1,rings) for k in range(n)]
 mesh(name+' 凸面透鏡',v,faces,'redlens' if red else 'headlens',smooth=True)
 for yy in [-.45,0,.45]:
  dz=r*math.sqrt(1-yy*yy)*.80
  rod(name+' 透鏡直紋',(x+.140,y+yy*r,z-dz),(x+.140,y+yy*r,z+dz),.003,'red' if red else 'reflector',n=6)
 for a in [0,math.pi]:
  cyl(name+' 燈圈固定螺絲',(x+.101,y+math.cos(a)*r*1.18,z+math.sin(a)*r*1.18),.012,.014,'metal','X',10)

def r135_hazard(end,W):
 # 實車端梁左右斜紋在中央形成 V，不是同方向的平行斑馬紋。
 use('03');x=end+.015;z0=.27;z1=1.015;half=W*.46
 box('黃黑端梁底板',(x,0,(z0+z1)/2),(.075,half*2,z1-z0),'chassis',.018)
 for side in [-1,1]:
  for k in range(-3,5):
   # z = .72*y + b 的黃帶，先裁在單側端梁範圍。
   b=k*.48
   poly=[(0,b),(half,.72*half+b),(half,.72*half+b+.235),(0,b+.235)]
   for boundary,sign in [(z0,1),(z1,-1)]:
    clipped=[]
    for a,c in zip(poly,poly[1:]+poly[:1]):
     ai=(a[1]-boundary)*sign>=0;ci=(c[1]-boundary)*sign>=0
     if ai:clipped.append(a)
     if ai!=ci:
      t=(boundary-a[1])/(c[1]-a[1]);clipped.append((a[0]+t*(c[0]-a[0]),boundary))
    poly=clipped
    if not poly:break
   if len(poly)>2:mesh('左右鏡像黃黑 V 警戒紋',[(x+.04,side*y,z) for y,z in poly],[tuple(range(len(poly)))],'yellow')

def locomotive(s):
 L,W,H=s['L'],s['W'],s['H'];end=L/2;cabL=1.66;cabx=end-.28-s['shortNose']-cabL/2;deck=1.02;hw=W*.38;cw=W*.45
 p.M['body']=mat('藍皮深海軍藍',s['body'],.06,.55,.12)
 p.M['roof']=mat('藍皮機車深色屋頂','202A3C',.12,.60)
 p.M['chassis']=mat('藍皮機車深灰底盤','292E32',.35,.65)
 p.M['lampmetal']=mat('燈圈暗銀','6E797B',.72,.33)
 p.M['reflector']=mat('燈碗銀面','BCC5C2',.72,.21)
 p.M['headlens']=mat('頭燈暖白玻璃','D3D4BF',.24,.17,.48)
 p.M['redlens']=mat('深紅標誌燈玻璃','701E21',.16,.22,.42)
 p.M['plate']=mat('R135 車牌底色','383F47',.08,.52)
 p.M['yellow']=mat('R135 端梁警戒黃','F3C327',.03,.55)
 p.M['horn']=mat('喇叭內口近黑','090C12',0,.85)
 identity=p.M['identity'];identity.diffuse_color=(*[linear(v/255) for v in (240,239,227)],1)
 identity.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=identity.diffuse_color
 use('01')
 box('厚走道甲板',(0,0,deck),(L,W,.20),'chassis',.035)
 # 實車短鼻比舊模板寬，駕駛室上肩斜削，車顶不是四角方盒。
 cab=prism('R100 斜肩駕駛室',cabx-cabL/2,cabx+cabL/2,
  [(-cw,deck),(cw,deck),(cw,H-.52),(cw-.37,H-.08),(-cw+.37,H-.08),(-cw,H-.52)],'body',.055)
 cab['primary_body']=True
 prism('折肩深色駕駛室屋頂',cabx-cabL/2-.07,cabx+cabL/2+.08,
  [(-cw-.045,H-.50),(-cw+.32,H+.025),(cw-.32,H+.025),(cw+.045,H-.50),(cw-.03,H-.50),(cw-.36,H-.065),(-cw+.36,H-.065),(-cw+.03,H-.50)],'roof',.018)
 for a,b,top in [(-end+.19,cabx-cabL/2,3.00),(cabx+cabL/2,end-.28,2.18)]:
  hood=prism('長引擎罩' if top>2.5 else '校正短車鼻',a,b,[(-hw,deck),(hw,deck),(hw,top-.075),(hw-.08,top),(-hw+.08,top),(-hw,top-.075)],'body',.047)
  hood['nose_length']=b-a if top<2.5 else 0
  for side in [-1,1]:
   y=side*(hw+.018)
   box('引擎罩白腰線',((a+b)/2,y,1.89),(b-a,.014,.18),'accent',.002)
   if top>2.5:
    count=7
    for j in range(count):
     x=a+(j+.5)*(b-a)/count
     panel('獨立引擎檢修板',(x,y,2.17),(b-a)/count-.035,1.48,'body',r=.014)
     # 分片檢修門上的腰線隨側板向外，避免被側板蓋掉。
     box('檢修板上的白腰線',(x,y+side*.012,1.89),((b-a)/count-.025,.014,.18),'accent',.002)
     rod('引擎門把',(x-.12,y+side*.023,1.41),(x-.12,y+side*.023,1.60),.012,'metal')
     grille('深色散熱百葉',x,y+side*.01,2.63,(b-a)/count-.09,.43,True,8)
    for x in [a+.48,a+1.20]:
     use('05');cyl('頂部散熱風扇',(x,0,top+.035),.28,.06,'chassis',n=28)
     for off in [-.14,0,.14]:rod('風扇保護網',(x-.23,off,top+.075),(x+.23,off,top+.075),.009,'metal')
 use('02');front=cabx+cabL/2+.023
 for side in [-1,1]:
  y=side*.53
  panel('駕駛室前窗膠框',(front,y,2.66),.84,.66,'frame','front',r=.10)
  panel('駕駛室前窗玻璃',(front+.018,y,2.66),.73,.55,'glass','front',r=.078)
  wiper(lambda yy,zz:front,y,2.41,.42)
  use('02')
  panel('駕駛側窗膠框',(cabx,side*(cw+.012),2.64),1.08,.68,'frame',r=.09)
  panel('駕駛側窗玻璃',(cabx,side*(cw+.026),2.64),.97,.57,'glass',r=.065)
  box('側窗滑框',(cabx,side*(cw+.043),2.64),(.028,.018,.57),'metal',.005)
  box('駕駛室白腰線',(cabx,side*(cw+.018),1.89),(cabL,.014,.18),'accent',.002)
  # 接齊不同寬度的駕駛室與引擎罩，側白線不在台階處中斷。
  for xx in [cabx-cabL/2-.008,cabx+cabL/2+.008]:
   panel('駕駛室腰線轉角',(xx,side*(cw+hw)/2,1.89),cw-hw+.025,.18,'accent','front',r=.002,depth=.012)
  panel('駕駛外側小前窗框',(front+.007,side*1.09,2.62),.24,.63,'frame','front',r=.055)
  panel('駕駛外側小前窗',(front+.025,side*1.09,2.62),.17,.55,'glass','front',r=.042)
  # 車號依這張 R135 參考照片製作，文字獨立可換；不是即時派車。
  use('06');yy=side*.55
  panel('R135 字牌外框',(front+.025,yy,3.185),.73,.315,'lampmetal','front',r=.070,depth=.040)
  panel('R135 字牌膠邊',(front+.052,yy,3.185),.69,.277,'frame','front',r=.058)
  panel('R135 字牌底板',(front+.066,yy,3.185),.64,.237,'plate','front',r=.049)
  text_label('R135',(front+.085,yy,3.185),.222)
  for dy in [-.326,.326]:
   cyl('字牌固定螺絲',(front+.078,yy+dy,3.185),.011,.012,'metal','X',10)
  text_label('R135',(cabx,side*(cw+.034),1.40),.21,axis='side',side=side)
 use('03')
 panel('直列雙燈共同燈座',(front+.028,0,3.205),.295,.548,'frame','front',r=.13,depth=.064)
 for z in [3.335,3.075]:r135_lamp('上額直列雙頭燈',front+.059,0,z,.101)
 panel('前窗中央黃色警示牌',(front+.025,0,2.67),.104,.23,'yellow','front',r=.003)
 # 排風／鳴笛喇叭在照片上額外側可辨識為黑色喇叭口。
 cyl('上額黑色喇叭筒',(front-.08,-.98,3.38),.084,.28,'chassis','X',28)
 cyl('上額喇叭口',(front+.074,-.98,3.38),.124,.055,'frame','X',32)
 cyl('喇叭內口暗面',(front+.103,-.98,3.38),.102,.009,'horn','X',32)
 nose=end-.28+.018
 for side in [-1,1]:
  # R135 官方照片的飛翼從外側白腰線向鼻尖下方收束。
  pts=[]
  for j in range(25):
   t=j/24;y=side*hw*(1-t);z=1.89-.82*(t**3.1)
   pts.append((y,z))
  stripe_front('鼻端向下收尖白飛翼',nose+.024,pts,.20)
  # 白漆延伸到鼻端轉角，沿車側接成連續腰線。
  use('01');box('鼻端白腰線轉角',(nose-.004,side*(hw-.046),1.89),(.035,.13,.18),'accent',.002)
  r135_lamp('短鼻上角紅色標誌燈',nose+.018,side*(hw-.18),1.94,.074,True)
  use('03');yy=side*W*.465
  for a,b in [(-end+.05,cabx-cabL/2-.08),(cabx+cabL/2+.08,end-.045)]:
   line('深藍走道安全扶手',[(a,yy,1.10),(a,yy,1.94),(b,yy,1.94),(b,yy,1.10)],.019,'body')
   for j in range(1,max(2,round((b-a)/.90))):
    x=a+(b-a)*j/max(2,round((b-a)/.90));rod('深藍扶手立柱',(x,yy,1.10),(x,yy,1.94),.018,'body')
  for e in [-1,1]:
   for z in [.36,.59,.81]:box('車端登車踏階',(e*(end-.10),side*W*.37,z),(.40,.37,.045),'chassis',.007)
 for e in [-1,1]:
  st=len(p.MODEL);r135_hazard(end,W)
  if e==-1:
   for o in p.MODEL[st:]:o.matrix_world=Matrix.Rotation(math.pi,4,'Z')@o.matrix_world
  use('03');prism('下緣導流排障板',e*(end+.01)-.07,e*(end+.01)+.07,[(-W*.46,.36),(W*.46,.36),(W*.36,.16),(-W*.36,.16)],'chassis')
  coupler(e*(end+.07),W,e,z=.49)
 bogies(L,W,axles=3,r=.40,centers=[-2.58,2.58])
 use('05');cyl('短煙囪',(cabx-cabL/2-.34,0,3.13),.13,.30,'chassis',n=24)

def coach(s):
 L,W,H=s['L'],s['W'],s['H'];end=L/2;spring=H-.48
 p.M['roof']=mat('藍皮客車銀灰圓頂','A7B2BB',.24,.60)
 p.M['chassis']=mat('老客車暗色底盤','303539',.26,.72)
 p.M['windowlight']=mat('窗框淺灰金屬','C0C8C6',.48,.45)
 p.M['interior']=mat('開窗暗部與軍綠座椅意象','263F39',.05,.75)
 use('01')
 body=box('全藍客車側牆',(0,0,(.88+spring)/2),(L,W,spring-.88),'body',.06);body['primary_body']=True
 section=[(-W/2,spring),(W/2,spring)]
 section += [(W/2*math.cos(math.pi*j/48),spring+.48*math.sin(math.pi*j/48)) for j in range(49)]
 roof=prism('獨立銀灰拱形車頂',-end-.025,end+.025,section,'roof',.008)
 roof.data.materials.append(p.M['body'])
 for poly in roof.data.polygons:
  if poly.index<2:poly.material_index=1
  elif poly.index>3:poly.use_smooth=True
 for side in [-1,1]:
  y=side*(W/2+.015)
  box('車頂藍色滴水簷',(0,y,spring),(L+.03,.045,.055),'body',.008)
  box('窗下細白腰線',(0,y,1.71),(L-.05,.024,.14),'accent',.002)
  # 以九扇壓縮客窗呈現節奏，另保留衛生間霧面小窗；不宣稱精確番台窗數。
  for j in range(s['windows']):
   x=-3.03+j*.67
   use('02');panel('可開窗金屬外框',(x,y+side*.009,2.21),.57,.87,'windowlight',r=.046)
   panel('窗框內深色開口',(x,y+side*.023,2.21),.50,.79,'frame',r=.026)
   panel('上半固定窗',(x,y+side*.032,2.45),.47,.28,'glass',r=.017)
   panel('下半開窗暗部',(x,y+side*.034,2.06),.47,.43,'interior',r=.015)
   box('上下推拉窗中橫框',(x,y+side*.05,2.28),(.51,.035,.045),'windowlight',.004)
  box('開窗下窗台',(x,y+side*.05,1.80),(.56,.043,.033),'windowlight',.004)
  panel('車端霧面小窗框',(3.30,y+side*.016,2.20),.52,.64,'windowlight',r=.045)
  panel('車端霧面小窗',(3.30,y+side*.033,2.20),.46,.57,'white',r=.026)
  for e in [-1,1]:
   x=e*(end-.39)
   panel('凹入單扇手動側門框',(x,y,1.91),.69,1.93,'frame',r=.012)
   door=panel('手動單扇側門',(x,y+side*.012,1.94),.60,1.82,'body',r=.012);door['side_door']=True;door['side']=side
   panel('側門窄長玻璃框',(x,y+side*.028,2.31),.40,.95,'windowlight',r=.06)
   panel('側門窄長玻璃',(x,y+side*.041,2.31),.34,.88,'glass',r=.045)
   box('車門白腰線',(x,y+side*.029,1.71),(.61,.025,.14),'accent',.002)
   rod('門邊扶手',(x-e*.26,y+side*.057,1.27),(x-e*.26,y+side*.057,1.84),.014,'metal')
   use('04')
   for k in range(3):box('外露客車登車踏階',(x,side*(W/2+.035),.36+k*.20),(.66,.34,.042),'chassis',.009)
  use('06');panel('空白可換行先牌',(.15,y+side*.023,1.54),.56,.14,'white',r=.008)
 for e in [-1,1]:
  use('07');x=e*(end+.035)
  panel('藍色客車端牆',(x,0,1.88),W-.04,2.0,'body','front',r=.035)
  panel('客車端門框',(x+e*.03,0,1.95),.82,1.73,'frame','front',r=.06)
  panel('客車端門扇',(x+e*.049,0,1.95),.67,1.59,'body','front',r=.038)
  panel('客車端門玻璃',(x+e*.065,0,2.30),.47,.68,'glass','front',r=.045)
  # 風擋是中空外框；保留中央端門，不再用黑板封住整張端面。
  for k in range(4):
   xx=x+e*(.08+k*.038)
   for side in [-1,1]:box('貫通風擋側折片',(xx,side*.52,1.91),(.045,.075,1.91),'rubber',.018)
   box('貫通風擋頂折片',(xx,0,2.865),(.045,1.10,.075),'rubber',.018)
  for side in [-1,1]:
   use('03');cyl('客車尾燈座',(x+e*.056,side*.94,1.21),.095,.045,'frame','X',24)
   cyl('客車尾燈紅透鏡',(x+e*.082,side*.94,1.21),.070,.017,'red','X',24)
  coupler(e*(end+.10),W,e,z=.56)
 bogies(L,W,r=.39)
 use('05')
 for x in [-3.25,-2.18,-1.09,0,1.09,2.18,3.25]:
  box('舊式通風器黑色喉口',(x,0,H+.058),(.37,.29,.115),'chassis',.026)
  box('舊式通風器灰色懸帽',(x,0,H+.139),(.48,.51,.075),'roof',.035)
