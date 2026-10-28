"""台灣缺車與經典老車逐款建模。沿用台灣車隊（fleet-v1）的零件庫與 Q 版比例，車殼與車頭每款各自做。
zoned_shell、half_width、front_patch、front_glass、ramp、lamp_color 照抄世界車精修 world-v1（分支 claude/world-fleet-garage，
銀座線定稿時的版本），兩邊各自維護；改這裡不影響世界車。"""
import math,bpy,bmesh
from mathutils import Vector
import blender_parts as p
from blender_parts import *
from build_models import interp,front_panel,front_poly,front_ribbon,sidewindow,copy_rotated

def color(key,h,metal=.10,rough=.38,coat=.18):
 p.M[key]=mat(key,h,metal,rough,coat);return key

def zoned_shell(s,profile,bow,zones,front_zones,name='分色主車殼',nose_zones=None,surface_neck=False,double=False):
 """圓角車殼；同一張網格依高度分塗裝（車身、車頂邊帶、車頂），車頭面另有自己的分區。
 zones／front_zones：[(z 上限, 材質), ...]，由下往上；z 列會插在每個分界上，色界不切過面。
 nose_zones：駕駛室肩部（neck 到車頭面那一段側面）另用的分區。
 s['bowPow']：車頭平面曲線的次方，預設 4（平頭圓角）；越小越接近 V 字尖頭。
 surface_neck：neck 從實際車頭面（含 bow）最後退的點算，避免車頭頂角退到 neck 之後折出破面。
 double：兩端都是車頭（單節柴油客車、雙端電車），車尾用同一條曲面鏡射。"""
 L,W,H=s['L'],s['W'],s['H'];z0=s.get('bottom',.83);rb=s.get('radiusBottom',.12);rt=s.get('radiusTop',.40);pw=s.get('bowPow',4)
 def f(y,z):return interp(profile,z)-bow*(abs(y)/(W/2))**pw
 def half(z):
  if z<z0+rb:d=z0+rb-z;return W/2-rb+math.sqrt(max(0,rb*rb-d*d))
  if z>H-rt:d=z-(H-rt);return W/2-rt+math.sqrt(max(0,rt*rt-d*d))
  return W/2
 base=[z0+(H-z0)*i/40 for i in range(41)]
 cuts=[z for z,_ in zones+front_zones if z0<z<H]
 zs=sorted(set(round(z,4) for z in base+cuts))
 top=[(half(H)*(1-2*j/16),H) for j in range(1,16)];bottom=[(half(z0)*(-1+2*j/16),z0) for j in range(1,16)]
 ring=[(half(z),z) for z in zs]+top+[(-half(z),z) for z in reversed(zs)]+bottom
 n=len(ring);verts=[];neck=min(x for z,x in profile)-.06
 if surface_neck:neck=min(neck,min(f(y,z) for y,z in ring)-.06)
 cols=16
 if double:
  # 車尾是車頭的鏡射：-neck 到 neck 是車身，兩端各接一片車頭曲面。
  for x in [-1,-neck,neck,None]:
   for y,z in ring:verts.append((-f(y,z) if x==-1 else f(y,z) if x is None else x,y,z))
  faces=[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(3) for i in range(n)]
  nose_rings=[0,2*n]
 else:
  for x in [-L/2,-L/2+.10,neck,None]:
   for y,z in ring:verts.append((f(y,z) if x is None else x,y,z))
  faces=[tuple(reversed(range(n)))]+[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(3) for i in range(n)]
 side_faces=len(faces)
 for sign in ([1,-1] if double else [1]):
  start=len(verts)
  for z in zs:
   for j in range(cols+1):
    y=half(z)*(2*j/cols-1);verts.append((sign*f(y,z),y,z))
  faces+=[(start+i*(cols+1)+j,start+i*(cols+1)+j+1,start+(i+1)*(cols+1)+j+1,start+(i+1)*(cols+1)+j) for i in range(len(zs)-1) for j in range(cols)]
 d=bpy.data.meshes.new(name);d.from_pydata(verts,[],faces);d.update()
 bm=bmesh.new();bm.from_mesh(d);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(d);bm.free()
 keys=[]
 for _,m in zones+front_zones+(nose_zones or []):
  if m not in keys:keys.append(m)
 for k in keys:d.materials.append(p.M[k])
 def pick(table,z):
  for lim,m in table:
   if z<=lim:return m
  return table[-1][1]
 nose_lo,nose_hi=(1+2*n,side_faces) if not double else (None,None)
 for i,poly in enumerate(d.polygons):
  zc=sum(d.vertices[v].co.z for v in poly.vertices)/len(poly.vertices)
  xc=sum(d.vertices[v].co.x for v in poly.vertices)/len(poly.vertices)
  if i>=side_faces:table=front_zones
  elif nose_zones and ((not double and i>=nose_lo) or (double and abs(xc)>neck+.001)):table=nose_zones
  else:table=zones
  poly.material_index=keys.index(pick(table,zc))
  poly.use_smooth=True
 use('01');o=bpy.data.objects.new(name,d);p.ACTIVE.objects.link(o);p.MODEL.append(o);o['primary_body']=True
 return f,neck

def half_width(s,z):
 """跟 zoned_shell 同一條斷面：給高度，回車殼半寬。側面色帶要貼著它放。"""
 W,H=s['W'],s['H'];z0=s.get('bottom',.83);rb=s.get('radiusBottom',.12);rt=s.get('radiusTop',.40)
 if z<z0+rb:d=z0+rb-z;return W/2-rb+math.sqrt(max(0,rb*rb-d*d))
 if z>H-rt:d=z-(H-rt);return W/2-rt+math.sqrt(max(0,rt*rt-d*d))
 return W/2

def front_patch(name,f,y0,y1,zlo,zhi,material,offset=.03,cols=24,rows=8):
 """貼著車頭曲面的任意形狀色塊：y 從 y0 到 y1，上下緣可以是常數或 y 的函式（V 字窗、笑臉、漸層條都用它）。"""
 use('03');lo=zlo if callable(zlo) else (lambda y:zlo);hi=zhi if callable(zhi) else (lambda y:zhi);verts=[]
 for i in range(rows+1):
  for j in range(cols+1):
   y=y0+(y1-y0)*j/cols;a,b=lo(y),hi(y);z=a+(b-a)*i/rows;verts.append((f(y,z)+offset,y,z))
 faces=[(i*(cols+1)+j,i*(cols+1)+j+1,(i+1)*(cols+1)+j+1,(i+1)*(cols+1)+j) for i in range(rows) for j in range(cols)]
 return mesh(name,verts,faces,material,0,True)

def front_glass(f,panes,z0,z1,offset=.05,r=.05):
 """車頭玻璃：panes 是 [(y 左緣, y 右緣, 名稱), ...]，同一高度範圍。"""
 for a,b,name in panes:front_panel(name,f,(a+b)/2,(z0+z1)/2,b-a,z1-z0,'glass',r,offset)

def ramp(prefix,stops,n):
 """漸層色帶：stops=[(t, 'RRGGBB'), ...]，切成 n 段、每段一個材質，回傳材質名清單。"""
 keys=[]
 for i in range(n):
  t=(i+.5)/n
  for (a,ca),(b,cb) in zip(stops,stops[1:]):
   if t<=b:break
  u=(t-a)/(b-a) if b>a else 0
  keys.append(color(f'{prefix}{i}',''.join('%02X'%round(int(ca[k:k+2],16)*(1-u)+int(cb[k:k+2],16)*u) for k in (0,2,4)),.05,.34,.28))
 return keys

def lamp_color(name,f,y,z,r,material):
 lamp(name,f,y,z,r);p.MODEL[-1].data.materials[0]=p.M[material]

# ── 台鐵電聯車／柴聯車共用骨架 ──────────────────────────────────────────────
# 車殼、側窗門、色帶、車頂設備、集電弓、轉向架與車鉤共用；車頭、門窗配置、塗裝每款各自給。

def roof_ac(s,xs,length=1.8,mat='roof',low=False):
 """車頂分散式冷氣：xs 是每座中心 x。"""
 use('05');W,H=s['W'],s['H'];h=.20 if low else .28
 for x in xs:
  box('車頂冷氣罩',(x,0,H+h/2-.03),(length,W*.62,h),mat,.09)
  for k in range(8):box('冷氣罩頂部格柵',(x-length*.37+k*length*.105,0,H+h-.02),(.035,W*.46,.01),'chassis',.002)
  for side in [-1,1]:grille('冷氣側格柵',x,side*W*.31,H+h/2-.04,length*.72,h*.5,True,5)

def railcar(s,profile,bow,zones,front_zones,nose_zones=None,leaf='body',bands=(),leafbands=(),deco=None,gaps=None,crew=None,double=False,panto=None,roof=None):
 """建車殼與車側，回傳 (f, neck, doors)。
 s['doorXs']：每組側門中心 x（不給就在 rearDoor 到 frontDoor 之間平均排 s['doors'] 組）；s['doorLeaves'] 1 或 2。
 gaps：每段窗間的窗數（不給依寬度自動）；bands／leafbands：[(中心 z, 高, 材質)]；deco(x,y,side,dw) 每組門旁加塗裝。
 panto：'diamond'／'single'／None；roof(s,neck) 自訂車頂，不給就兩座分散式冷氣。"""
 L,W,H=s['L'],s['W'],s['H'];n=s.get('doors',2);dw=s.get('doorW',.80 if s.get('doorLeaves',2)==2 else .52);leaves=s.get('doorLeaves',2)
 f,neck=zoned_shell(s,profile,bow,zones,front_zones,nose_zones=nose_zones,surface_neck=True,double=double)
 rear=-neck if double else -L/2
 if s.get('doorXs'):doors=list(s['doorXs'])
 else:
  a=rear+s.get('rearDoor',1.35);b=neck-s.get('frontDoor',1.29)
  doors=[a+(b-a)*i/(n-1) for i in range(n)] if n>1 else [(a+b)/2]
 zc=s.get('winZ',H-1.10);wh=s.get('winH',.90);top=s.get('doorTop',H-.62);dz=s.get('doorWinZ',zc-.02);dh=s.get('doorWinH',.86)
 x_lo=rear+(.30 if double else .38);x_hi=neck-s.get('cabGap',.66)
 for z,h,m in bands:
  y=half_width(s,z)+.012
  for side in [-1,1]:box('側面色帶',((rear+.06+neck+.04)/2,side*y,z),(neck+.04-rear-.06,.020,h),m,.004)
 for side in [-1,1]:
  y=side*(W/2+.018)
  spans=list(zip([x_lo]+[d+dw/2+.12 for d in doors],[d-dw/2-.12 for d in doors]+[x_hi]))
  for k,(u,v) in enumerate(spans):
   if v-u<.22:continue
   m=gaps[k] if gaps else max(1,round((v-u)/s.get('winPitch',.80)));gap=s.get('winGap',.08)
   if m==0:continue
   for i in range(m):
    w=(v-u-gap*(m-1))/m;sidewindow(u+w/2+i*(w+gap),y,zc,w-.04,wh,r=s.get('winR',.06),split=s.get('splitWindows',False))
  for i,x in enumerate(doors):
   use('02');basez=.92;h=top-basez;cz=basez+h/2
   panel('側門門框',(x,y,cz),dw+.05,h+.03,'frame',r=.03)
   for lf in range(leaves):
    dx=(lf-(leaves-1)/2)*dw/leaves;lw=dw/leaves-.022
    door=panel('獨立門扇',(x+dx,y+side*.023,cz),lw,h,leaf,r=.025,depth=.024)
    door['side_door']=True;door['door_group']=i+1;door['side']=side;door['leaf']=lf
    gw=lw*(.62 if leaves==2 else .58)
    panel('門窗嵌框',(x+dx,y+side*.043,dz),gw+.04,dh+.06,'frame',r=.04)
    panel('門窗玻璃',(x+dx,y+side*.057,dz),gw,dh,'glass',r=.035,depth=.012)
    for z,hh,mm in leafbands:box('門扇色帶',(x+dx,y+side*.050,z),(lw,.011,hh),mm,.002)
   box('車門踏板',(x,y+side*.01,.90),(dw+.08,.11,.042),'metal',.008)
   if deco:deco(x,y,side,dw)
  if crew is not False and s.get('crewDoor',True):
   for c in ([neck-.36,-(neck-.36)] if double else [neck-.36]):
    use('02')
    panel('乘務員門框',(c,y,1.86),.46,1.90,'frame',r=.03)
    cd=panel('乘務員門扇',(c,y+side*.022,1.86),.40,1.84,crew or leaf,r=.025,depth=.022);cd['side_door']=True;cd['crew_door']=True
    panel('乘務員門窗',(c,y+side*.045,zc-.05),.24,.80,'glass',r=.03,depth=.012)
    rod('乘務員扶手',(c-.25*(1 if c>0 else -1),y+side*.06,1.30),(c-.25*(1 if c>0 else -1),y+side*.06,2.40),.016,'metal')
 if roof:roof(s,neck)
 else:roof_ac(s,[-L*.22,L*.17])
 if panto:pantograph(s.get('pantoX',-L*.30),H,diamond=panto=='diamond');s['pantos']=1
 use('05');ax=neck-.9 if not double else 0
 box('車頂天線底座',(ax,0,H+.03),(.20,.16,.05),'chassis',.012)
 rod('列車無線天線',(ax,0,H+.05),(ax,0,H+.22),.010,'chassis')
 bogies(L,W,r=s.get('wheelR',.38),centers=s.get('bogieXs'))
 coupler(f(0,.83)+.16,W)
 if double:coupler(-f(0,.83)-.16,W,-1)
 else:coupler(-L/2-.03,W,-1,gangway=True)
 return f,neck,doors

BUILDERS={}

# ── 蒸汽機車 ────────────────────────────────────────────────────────────────

def arch_truck(cx,W,r,spacing=.95,name='菱形架轉向架'):
 """老式菱形架（arch bar）兩軸轉向架：側架是上下兩條鋼條加斜撐，輪子不鏤空。"""
 use('04');xs=[cx-spacing/2,cx+spacing/2]
 for x in xs:
  cyl('輪軸',(x,0,r),.07,W*.80,'chassis','Y',16)
  for y in [-W*.36,W*.36]:wheel(x,y,r)
 for s in [-1,1]:
  y=s*(W*.36+.15)
  line(name+' 上弦',[(xs[0]-.30,y,r+.05),(xs[0]+.12,y,r+.28),(xs[1]-.12,y,r+.28),(xs[1]+.30,y,r+.05)],.028,'chassis')
  line(name+' 下弦',[(xs[0]-.30,y,r+.02),(xs[1]+.30,y,r+.02)],.026,'chassis')
  for x in xs:box('軸箱',(x,y,r),(.20,.13,.20),'chassis',.02)
  rod(name+' 柱',(cx,y,r+.02),(cx,y,r+.28),.03,'chassis')
 box('轉向架承梁',(cx,0,r+.30),(.30,W*.84,.14),'chassis',.02)
 return xs

def cone(name,center,r0,r1,z0,z1,material,n=36,cap=True):
 """直立截錐：底半徑 r0 在 z0、頂半徑 r1 在 z1。"""
 v=[]
 for z,r in [(z0,r0),(z1,r1)]:
  for i in range(n):a=2*math.pi*i/n;v.append((center[0]+r*math.cos(a),center[1]+r*math.sin(a),z))
 faces=[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]+([tuple(reversed(range(n))),tuple(range(n,2*n))] if cap else [])
 return mesh(name,v,faces,material,0,True)

def number_disc(x,y,z,label,r=.17,axis='front'):
 """煙箱門上的紅底白圈車號圓牌。"""
 use('06');cyl('車號圓牌白圈',(x,y,z),r,.02,'white','X',40,.003);cyl('車號圓牌紅底',(x+.012,y,z),r*.86,.02,'red','X',40,.003)
 text_label(label,(x+.026,y,z),r*.85)

def shay(s):
 """直立汽缸齒輪式蒸汽機車（Lima Shay，阿里山 28 噸級 SL-31）。參考：Commons 阿里山車庫斜前側、正面、部件標註側面照，
 Lima 型錄 Class B 側面圖。鍋爐偏左（+Y），右側（-Y）三支直立汽缸推動縱向曲軸，經萬向接頭與伸縮方軸帶動每個車軸外側的斜齒輪；
 喇叭形大煙囪、汽包室與砂箱兩座高圓頂、煙囪後方預熱器；右側前段一支大總風缸、銅箍空壓機；高側頂駕駛室，後方水櫃。全車黑色。"""
 L,W,H=s['L'],s['W'],s['H'];r=s.get('wheelR',.30);deck=.86;body='shayblack'
 color('shayblack','23282A',.32,.42,.12);color('copper','B0663A',.70,.30,.05)
 frontT,rearT=L*.25,-L*.30;fxs=arch_truck(frontT,W,r);rxs=arch_truck(rearT,W,r)
 use('01');box('主車架',(0,0,deck),(L-.20,W*.74,.20),'chassis',.03)
 for end in [-1,1]:
  box('鉚釘端梁',(end*(L/2-.12),0,deck-.04),(.16,W*.94,.34),body,.02)
  for i in range(7):
   for z in [deck-.14,deck+.06]:cyl('端梁鉚釘',(end*(L/2-.03),-W*.40+i*W*.133,z),.022,.02,'chassis','X',8,0)
 by=s.get('boilerOffset',.16);br=s.get('boilerR',.56);bz=deck+.10+br;cabF=s.get('cabFront',-.55);bf=L/2-.42
 cyl('偏置圓筒鍋爐',((cabF+bf)/2,by,bz),br,bf-cabF,body,'X',56,.01)
 for i in range(4):
  x=cabF+(i+.6)*(bf-cabF)/4.6;cyl('鍋爐箍環',(x,by,bz),br+.014,.035,'chassis','X',56,.004)
 cyl('煙箱',(bf-.28,by,bz),br+.03,.56,body,'X',56)
 cyl('煙箱門',(bf+.03,by,bz),br*.90,.08,body,'X',56,.02)
 for i in range(16):
  a=2*math.pi*i/16;cyl('煙箱門鉚釘',(bf+.075,by+br*.82*math.cos(a),bz+br*.82*math.sin(a)),.016,.02,'metal','X',8,0)
 for k in [-1,1]:rod('煙箱門鉸鏈',(bf+.09,by-br*.70,bz+k*.22),(bf+.09,by-br*.30,bz+k*.22),.018,'chassis')
 number_disc(bf+.09,by,bz-.02,s.get('label','31'))
 # 頂部：喇叭形煙囪、預熱器、砂箱與汽包室高圓頂、汽笛。
 use('05');cx=bf-.30
 cyl('煙囪基座',(cx,by,bz+br-.02),.20,.16,body,n=36)
 cone('喇叭形煙囪',(cx,by),.14,.27,bz+br+.04,bz+br+.86,body,cap=False)
 cyl('煙囪口緣',(cx,by,bz+br+.87),.29,.05,body,n=36)
 cyl('煙囪內膛',(cx,by,bz+br+.86),.23,.02,'chassis',n=36)
 cyl('預熱器',(bf-.78,by,bz+br+.12),.17,.34,body,'Y',32)
 for side in [-1,1]:
  cyl('預熱器法蘭',(bf-.78,by+side*.18,bz+br+.12),.19,.03,body,'Y',32)
  for i in range(10):a=2*math.pi*i/10;cyl('法蘭螺栓',(bf-.78+.15*math.cos(a),by+side*.20,bz+br+.12+.15*math.sin(a)),.016,.02,'metal','Y',8,0)
 for x,name in [(cabF+.62,'汽包室'),(cabF+1.42,'砂箱')]:
  cyl(name+'基座',(x,by,bz+br-.03),.24,.12,body,n=36)
  cyl(name+'高圓頂',(x,by,bz+br+.30),.21,.62,body,n=36,bevel=.13)
 rod('黃銅汽笛',(cabF+.28,by-.20,bz+br),(cabF+.28,by-.20,bz+br+.36),.034,'gold')
 cyl('汽笛口',(cabF+.28,by-.20,bz+br+.38),.05,.06,'gold',n=16)
 rod('汽笛拉桿',(cabF+.30,by-.20,bz+br+.30),(bf-.60,by-.20,bz+br+.06),.010,'metal')
 use('03');lamp('煙箱頂頭燈',lambda y,z:bf+.02,by,bz+br+.10,.075)
 cyl('頭燈燈殼',(bf-.03,by,bz+br+.10),.11,.14,body,'X',24)
 # 右側（-Y）引擎：三支直立汽缸與閥箱、曲軸箱拱架、縱向曲軸、萬向接頭與伸縮方軸、車軸外側斜齒輪。
 use('04');ey=-(W*.36+.30);cyls=[cabF+.25,cabF+.70,cabF+1.15]
 for x in cyls:
  cyl('直立汽缸',(x,ey+.05,bz+.22),.15,.62,body,n=28)
  cyl('汽缸蓋',(x,ey+.05,bz+.55),.165,.05,'metal',n=28)
  box('汽缸閥箱',(x,ey-.13,bz+.30),(.24,.10,.40),body,.02)
  for z in [bz+.10,bz+.30,bz+.50]:line('銅油管',[(x-.08,ey-.19,z),(x-.08,ey-.19,z-.30)],.008,'copper')
  rod('活塞桿',(x,ey+.05,bz-.10),(x,ey+.05,deck+.05),.028,'metal')
  rod('連桿',(x,ey+.05,deck+.05),(x+.06,ey,deck-.18),.035,'metal')
 box('汽缸座架',((cyls[0]+cyls[-1])/2,ey+.20,bz+.22),(cyls[-1]-cyls[0]+.40,.10,.82),body,.02)
 crank=deck-.18
 for x in cyls:
  box('曲軸箱拱架',(x,ey+.02,crank+.02),(.30,.16,.44),body,.03)
  box('拱架開口',(x,ey-.07,crank-.04),(.16,.02,.24),'chassis',.02)
 rod('縱向曲軸',(cyls[0]-.30,ey,crank),(cyls[-1]+.30,ey,crank),.045,'metal')
 def shaft(a,b,square=False):
  if square:
   d=Vector(b)-Vector(a);box('伸縮方型軸',tuple((Vector(a)+Vector(b))/2),(abs(d.x)-.10 if abs(d.x)>.2 else .10,.09,.09),'metal',.01)
  else:rod('傳動軸',a,b,.035,'metal')
  for q in [a,b]:cyl('萬向接頭',q,.065,.10,'metal','X',16)
 gy=-(W*.36+.17)
 for xs,end in [(fxs,cyls[-1]+.30),(rxs,cyls[0]-.30)]:
  near=min(xs,key=lambda x:abs(x-end));far=max(xs,key=lambda x:abs(x-end))
  rod('傳動軸下斜段',(end,ey,crank),(end+(near-end)*.35,ey,(crank+r)/2),.035,'metal')
  shaft((end+(near-end)*.35,ey,(crank+r)/2),(near,ey,r),square=True)
  shaft((near,ey,r),(far,ey,r))
 for x in fxs+rxs:
  cyl('外側斜齒輪',(x,gy-.02,r),r*.82,.07,'chassis','Y',36)
  for k in range(20):
   a=2*math.pi*k/20;box('斜齒輪齒',(x+r*.80*math.cos(a),gy-.06,r+r*.80*math.sin(a)),(.045,.04,.045),'metal',0)
  cyl('小齒輪',(x,ey,r),.10,.10,'metal','X',16)
 # 右側前段大總風缸與銅箍空壓機。
 ay=-(W*.36+.08);cyl('總風缸',(bf-.80,ay,bz-.12),.22,1.30,body,'X',36,.03)
 for x in [bf-1.35,bf-.25]:cyl('總風缸固定箍',(x,ay,bz-.12),.235,.04,'chassis','X',36)
 cyl('空壓機',(cyls[-1]+.48,ay-.04,bz-.30),.10,.52,'chassis',n=24)
 for z in [bz-.48,bz-.30,bz-.12]:cyl('空壓機銅箍',(cyls[-1]+.48,ay-.04,z),.112,.04,'copper',n=24)
 line('蒸汽主管',[(cabF+.62,by-.12,bz+br+.12),(cabF+.70,ey+.12,bz+.70),(cyls[0],ey+.05,bz+.56)],.040,body)
 # 駕駛室：高側頂（monitor roof），側面上半兩格四分窗，下半車號牌。
 use('01');cabR=cabF-s.get('cabL',1.30);cz=(deck+H-.30)/2;cw=W*.98
 box('駕駛室前牆',(cabF,0,cz),(.08,cw,H-.30-deck),body,.03)
 box('駕駛室後牆',(cabR+.04,0,cz),(.08,cw,H-.30-deck),body,.03)
 for side in [-1,1]:
  yy=side*cw/2
  box('駕駛室側牆下半',((cabF+cabR)/2,yy,deck+.62),(cabF-cabR,.07,1.04),body,.03)
  box('駕駛室側牆窗台',((cabF+cabR)/2,yy,deck+1.16),(cabF-cabR+.04,.10,.06),body,.01)
  box('駕駛室上楣',((cabF+cabR)/2,yy,H-.40),(cabF-cabR,.07,.18),body,.02)
  for x in [cabF-.30,cabF-.92]:
   panel('側窗木框',(x,yy+side*.01,deck+1.62),.56,.80,body,r=.02,depth=.03)
   for dx in [-.13,.13]:
    for dz in [-.19,.19]:panel('四分窗玻璃',(x+dx,yy+side*.03,deck+1.62+dz),.22,.32,'glass',r=.015,depth=.012)
  for x in [cabF-.02,cabR+.06,(cabF+cabR)/2]:box('側窗立柱',(x,yy,deck+1.62),(.06,.08,.90),body,.01)
  panel('駕駛室車號牌',((cabF+cabR)/2,yy+side*.035,deck+.70),.36,.26,'red',r=.02)
  text_label(s.get('label','31'),((cabF+cabR)/2,yy+side*.05,deck+.70),.18,'side',side)
  rod('登車扶手',(cabR+.14,yy+side*.06,deck+.10),(cabR+.14,yy+side*.06,deck+1.30),.016,'metal')
  for z in [.40,.62]:box('登車踏階',(cabR+.30,side*W*.42,z),(.38,.24,.035),'metal',.008)
 box('駕駛室屋頂',((cabF+cabR)/2,0,H-.26),(cabF-cabR+.36,W+.20,.08),body,.03)
 box('高側頂',((cabF+cabR)/2,0,H-.10),(cabF-cabR-.10,W*.56,.24),body,.03)
 for side in [-1,1]:
  for k in range(3):box('高側頂小窗',((cabF+cabR)/2-.40+k*.40,side*(W*.28+.005),H-.10),(.24,.02,.10),'glass',.01)
 box('高側頂蓋',((cabF+cabR)/2,0,H+.03),(cabF-cabR+.06,W*.66,.05),body,.02)
 for side in [-1,1]:panel('駕駛室前窗',(cabF+.05,side*.62,deck+1.70),.36,.46,'glass','front',r=.06)
 # 後方水櫃與煤槽（約到駕駛室窗台高）。
 tF=cabR-.04;tR=-L/2+.18
 box('後部水櫃',((tF+tR)/2,0,deck+.78),(tF-tR,W*.92,1.36),body,.05)
 box('水櫃頂煤槽',(tF-.38,0,deck+1.56),(.66,W*.80,.28),body,.03)
 for i in range(10):box('煤堆塊',(tF-.60+(i%5)*.11,-.40+(i//5)*.80,deck+1.72+.03*math.sin(i*2)),(.16,.40,.10),'chassis',.03)
 cyl('注水口',((tF+tR)/2-.40,0,deck+1.48),.15,.08,body,n=20)
 for side in [-1,1]:line('水櫃扶手',[(tR+.10,side*(W*.46+.04),deck+.30),(tR+.10,side*(W*.46+.04),deck+1.30)],.016,'metal')
 for side in [-1,1]:
  box('走道踏板',((cabF+bf)/2,side*W*.40,deck+.14),(bf-cabF,W*.18,.05),body,.01)
  line('鍋爐扶手',[(cabF+.10,by+side*(br+.08),bz+.22),(bf-.10,by+side*(br+.08),bz+.22)],.016,'metal')
 use('03')
 for i in range(7):rod('排障直柵',(L/2+.10,-.62+i*.207,.22),(L/2-.04,-.62+i*.207,deck-.24),.022,body)
 for end in [-1,1]:
  coupler(end*(L/2+.04),W,end,z=.62)
  for side in [-1,1]:line('安全鏈',[(end*(L/2+.02),side*.30,deck-.12),(end*(L/2+.10),side*.24,deck-.34),(end*(L/2+.14),side*.12,deck-.30)],.014,'metal')
 s['drivers']=0;s['axles']=2;s['geared']=True

# ── 新幹線型流線車殼（N700ST）────────────────────────────────────────────────
# 做法沿用 fleet-v1 700T 的 shinkansen_shell：沿 x 放截面控制點（寬、底、頂、圓角），保形三次插值後放樣；
# 塗裝不用浮貼面片，而是把同一張封閉殼沿色界切開，各色共用幾何與法線。這裡把控制點與色界改成參數。

def loft_shell(s,control,regions,base,names):
 """control：[(x, 寬, 底 z, 頂 z, 截面圓角)]；regions：[(材質, fn)]，依序把 fn(v)<=0 的部分切給該材質，剩下的是 base。
 回傳 (shape, half, top, surface)：shape(x) 截面參數、half(x,z) 半寬、top(x,y) 頂面高度、surface(y,z) 車頭面 x（給 front_panel）。"""
 L,W,H=s['L'],s['W'],s['H'];tip=control[-1][0];neck=s['neck']
 slopes=[]
 for k in range(1,5):
  h=[b[0]-a[0] for a,b in zip(control,control[1:])]
  d=[(b[k]-a[k])/v for a,b,v in zip(control,control[1:],h)]
  m=[d[0]]
  for i in range(1,len(control)-1):
   if d[i-1]*d[i]<=0:m.append(0)
   else:
    w1=2*h[i]+h[i-1];w2=h[i]+2*h[i-1];m.append((w1+w2)/(w1/d[i-1]+w2/d[i]))
  m.append(d[-1]);slopes.append(m)
 def shape(x):
  for i,(a,b) in enumerate(zip(control,control[1:])):
   if x<=b[0]:
    h=b[0]-a[0];t=max(0,(x-a[0])/h)
    return [(2*t**3-3*t*t+1)*a[k]+(t**3-2*t*t+t)*h*slopes[k-1][i]+(-2*t**3+3*t*t)*b[k]+(t**3-t*t)*h*slopes[k-1][i+1] for k in range(1,5)]
  return list(control[-1][1:])
 def half(x,z):
  w,z0,z1,r=shape(x);r=min(r,w/2,(z1-z0)/2)
  if z<z0 or z>z1:return -1
  delta=max(0,z0+r-z,z-(z1-r))
  return w/2-r+math.sqrt(max(0,r*r-delta*delta)) if delta else w/2
 def top(x,y):
  w,z0,z1,r=shape(x);r=min(r,w/2,(z1-z0)/2);e=abs(y)-(w/2-r)
  return z1 if e<=0 else z1-r+math.sqrt(max(0,r*r-e*e))
 def surface(y,z):
  a=neck;b=tip
  for i in range(32):
   mid=(a+b)/2
   if abs(y)<=half(mid,z):a=mid
   else:b=mid
  return a
 samples=[]
 for a,b in zip(control,control[1:]):
  n=2 if b[0]<=neck else max(12,math.ceil((b[0]-a[0])/.03))
  samples.extend(a[0]+(b[0]-a[0])*i/n for i in range(n))
 samples.append(tip);verts=[];ring=0
 for x in samples:
  w,z0,z1,r=shape(x);pts=rounded(w,z1-z0,min(r,(z1-z0)/2,w/2),8);ring=len(pts)
  verts.extend((x,y,(z0+z1)/2+z) for y,z in pts)
 n=ring;faces=[tuple(reversed(range(n))),tuple(range((len(samples)-1)*n,len(samples)*n))]
 faces+=[(k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j) for k in range(len(samples)-1) for j in range(n)]
 use('01');body=mesh('流線車殼施工曲面',verts,faces,base,0,True);body.data.calc_loop_triangles()
 keys=[base]+[k for k,_ in regions];groups={k:([],[],[]) for k in keys}
 def clip(poly,fn,positive=True):
  out=[]
  for a,b in zip(poly,poly[1:]+poly[:1]):
   va=fn(a[0]);vb=fn(b[0]);ina=(va>=0) if positive else (va<=0);inb=(vb>=0) if positive else (vb<=0)
   if ina:out.append(a)
   if ina!=inb:t=va/(va-vb);out.append((a[0].lerp(b[0],t),a[1].lerp(b[1],t).normalized()))
  return out
 for tri in body.data.loop_triangles:
  poly=[(body.data.vertices[i].co.copy(),body.data.vertices[i].normal.copy()) for i in tri.vertices];pieces={}
  for key,fn in regions:
   pieces[key]=clip(poly,fn,False);poly=clip(poly,fn,True)
   if len(poly)<3:break
  pieces[base]=poly
  for key,part in pieces.items():
   if len(part)<3:continue
   vv,ff,nn=groups[key];b0=len(vv);vv.extend(tuple(a) for a,_ in part);nn.extend(tuple(b.normalized()) for _,b in part)
   ff.extend((b0,b0+i,b0+i+1) for i in range(1,len(part)-1))
 p.MODEL.remove(body);bpy.data.objects.remove(body,do_unlink=True)
 for key,(vv,ff,nn) in groups.items():
  if not ff:continue
  d=bpy.data.meshes.new(names[key]);d.from_pydata(vv,[],ff);d.update()
  o=bpy.data.objects.new(names[key],d);p.ACTIVE.objects.link(o);p.MODEL.append(o);finish(o,key,0,True)
  d.normals_split_custom_set_from_vertices(nn)
  if key==base:o['primary_body']=True
 return shape,half,top,surface

def side_patch(name,half,x0,x1,zlo,zhi,material,side,offset=.012,cols=40,rows=6):
 """貼著流線車殼側面的色塊：x 從 x0 到 x1，上下緣是 x 的函式；y 由 half(x,z) 算，向外推 offset。"""
 use('01');verts=[]
 for i in range(rows+1):
  for j in range(cols+1):
   x=x0+(x1-x0)*j/cols;a,b=zlo(x),zhi(x);z=a+(b-a)*i/rows;verts.append((x,side*(max(0,half(x,z))+offset),z))
 faces=[(i*(cols+1)+j,i*(cols+1)+j+1,(i+1)*(cols+1)+j+1,(i+1)*(cols+1)+j) for i in range(rows) for j in range(cols)]
 return mesh(name,verts,faces,material,0,True)

def top_patch(name,top,x0,x1,yhalf,material,offset=.02,cols=12,rows=28):
 """貼著車頂曲面的色塊（駕駛窗）：x 從 x0 到 x1，每個 x 的半寬 yhalf(x)。"""
 use('03');verts=[]
 for i in range(rows+1):
  x=x0+(x1-x0)*i/rows;hw=yhalf(x)
  for j in range(cols+1):
   y=hw*(2*j/cols-1);verts.append((x,y,top(x,y)+offset))
 faces=[(i*(cols+1)+j,i*(cols+1)+j+1,(i+1)*(cols+1)+j+1,(i+1)*(cols+1)+j) for i in range(rows) for j in range(cols)]
 return mesh(name,verts,faces,material,0,True)

def n700st(s):
 """台灣高鐵 N700ST（N700S 台灣版，日本車輛／日立）。參考：Commons「臺灣高鐵N700ST型電聯車於高雄港 20260815.jpg」
 與吊卸照（高雄市政府，GWOIA）、「N700S 722-8102 Front-side.jpg」（MaedaAkihiko，CC BY-SA 4.0，母型車頭）；尺寸 zh.wikipedia。
 白色車身、淺灰下緣；車側窗下一條橘線接深灰細條，到車頭後段橘色擴成楔形斜切向前收尖；長鴨嘴鼻、駕駛窗退在鼻頂後段，
 頭燈是鼻側細縫。先頭車只有駕駛室後方一組客用門加乘務員門。"""
 L,W,H=s['L'],s['W'],s['H'];s['neck']=neck=.10;tip=L/2-.10
 color('thsrwhite','F2F2EE',.06,.30,.40);color('thsrgrey','80868A',.30,.38,.20);color('thsrorange','F06A1C',.05,.34,.32);color('thsrdark','2E3236',.25,.40,.15)
 color('thsrglass','1B2430',.30,.15,.45)
 control=[(-L/2,W,.74,H,.26),(-L/2+.14,W,.74,H,.26),(neck,W,.74,H,.26),(1.00,2.84,.74,3.18,.32),(1.85,2.78,.75,2.98,.40),
  (2.65,2.64,.78,2.66,.44),(3.35,2.40,.84,2.30,.42),(3.90,2.06,.93,2.00,.36),(4.30,1.58,1.05,1.78,.28),(4.58,.92,1.20,1.60,.16),(tip,.02,1.42,1.44,.006)]
 def low(v):
  t=max(0,min(1,(v.x-2.0)/(tip-2.0)));t=t*t*(3-2*t);return v.z-(1.06*(1-t)+1.43*t)
 shape,half,top,surface=loft_shell(s,control,[('thsrgrey',low)],'thsrwhite',{'thsrwhite':'N700ST 白色長鼻與車殼','thsrgrey':'N700ST 淺灰下緣與鼻端下巴'})
 # 車側塗裝：後段窗下橘線＋深灰細條；車頭後段橘色楔形，上緣在窗下，前緣斜切收尖到鼻側。
 zb=1.93;xs=-1.30;xt=2.95
 def wedge_hi(x):
  t=max(0,min(1,(x-1.55)/(xt-1.55)));return zb-(zb-1.06)*(t**1.35)
 def wedge_lo(x):
  t=max(0,min(1,(x-xs)/(.55-xs)));t=t*t*(3-2*t);return (zb-.10)*(1-t)+1.06*t
 for side in [-1,1]:
  side_patch('窗下橘線',half,-L/2+.06,xs+.02,lambda x:zb-.06,lambda x:zb,'thsrorange',side,cols=8,rows=1)
  side_patch('窗下深灰細條',half,-L/2+.06,xs+.02,lambda x:zb-.15,lambda x:zb-.07,'thsrdark',side,cols=8,rows=1)
  side_patch('車頭後段橘色楔形',half,xs,xt,wedge_lo,wedge_hi,'thsrorange',side,cols=60,rows=8)
  side_patch('楔形下深灰斜條',half,xs+.25,.95,lambda x:max(1.00,wedge_lo(x)-.13),lambda x:max(1.03,wedge_lo(x)-.03),'thsrdark',side,cols=24,rows=2,offset=.010)
 # 窗與門：小方窗一列，駕駛室後方一組客用塞拉門＋乘務員門；後端是通廊端。
 use('02');zc=2.42;doorx=-.62;crewx=-.06
 for side in [-1,1]:
  y=side*(W/2+.018)
  n=8;a=-L/2+.45;b=doorx-.52
  for i in range(n):sidewindow(a+(i+.5)*(b-a)/n,y,zc,.26,.44,r=.08)
  use('02');panel('客用門門縫',(doorx,y,1.92),.62,1.86,'thsrdark',r=.05,depth=.012)
  dd=panel('客用塞拉門',(doorx,y+side*.010,1.92),.58,1.82,'thsrwhite',r=.05,depth=.016);dd['side_door']=True;dd['door_group']=1;dd['side']=side
  panel('客用門窗',(doorx,y+side*.022,2.30),.20,.46,'glass',r=.06,depth=.010)
  panel('乘務員門門縫',(crewx,y,1.98),.40,1.70,'thsrdark',r=.04,depth=.012)
  cd=panel('乘務員門',(crewx,y+side*.010,1.98),.36,1.66,'thsrwhite',r=.04,depth=.016);cd['side_door']=True;cd['crew_door']=True
  panel('乘務員門窗',(crewx,y+side*.022,2.42),.16,.34,'glass',r=.05,depth=.010)
  rod('乘務員扶手',(crewx+.24,y+side*.03,1.50),(crewx+.24,y+side*.03,2.30),.013,'metal')
 # 駕駛窗：鼻頂後段的淚滴形深色玻璃，後寬前窄；窗框一圈深灰。
 def hw(x):
  t=(x-.55)/(2.75-.55);return max(.06,(.92-.50*t)*math.sqrt(max(0,1-max(0,(t-.80)/.20)**2)))
 top_patch('駕駛窗外框',top,.50,2.82,lambda x:hw(x)+.06,'thsrdark',.012)
 top_patch('駕駛窗玻璃',top,.56,2.74,hw,'thsrglass',.024)
 # 鼻側細縫頭燈：沿鼻側上緣的細長燈罩。
 for side in [-1,1]:
  side_patch('鼻側頭燈燈罩',half,3.50,4.05,lambda x:shape(x)[2]-.30,lambda x:shape(x)[2]-.20,'thsrdark',side,offset=.010,cols=10,rows=1)
  side_patch('鼻側頭燈',half,3.55,4.00,lambda x:shape(x)[2]-.275,lambda x:shape(x)[2]-.225,'lamp',side,offset=.018,cols=10,rows=1)
 front_panel('鼻端尾燈',lambda y,z:surface(y,z),0,1.36,.26,.05,'red',.02,.012)
 text_label(s.get('label','N700ST'),(-1.95,-(W/2+.03),2.95),.10,'side',-1)
 # 轉向架：後轉向架在客室下，前轉向架在鼻根；車底主梁不穿出鼻殼。
 bogies(L,W,r=.35,centers=[-3.05,1.35])
 for o in p.MODEL:
  if o.name=='車底主梁':
   for v in o.data.vertices:v.co.x=min(v.co.x,1.9)
 coupler(-L/2-.03,W,-1,gangway=True)
 use('05');box('車頂天線底座',(-2.0,0,H+.025),(.20,.16,.05),'chassis',.012);rod('列車無線天線',(-2.0,0,H+.05),(-2.0,0,H+.20),.010,'chassis')
 box('車頂高壓設備蓋',(-3.4,0,H+.02),(.90,.70,.06),'thsrgrey',.025)
 s['pantos']=0;s['doors']=1;s['doorLeaves']=1

BUILDERS['n700st']=n700st

# ── 捷運新車 ──────────────────────────────────────────────────────────────

def side_ribbon(name,s,pts,width,material,side,offset=.014):
 """車側平面上的曲線色帶：pts=[(x,z)]，貼著 half_width 的斷面。"""
 use('01');dense=[]
 for a,b in zip(pts,pts[1:]):
  n=max(3,math.ceil(math.dist(a,b)/.05));dense+=[(a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n) for i in range(n)]
 dense.append(pts[-1]);verts=[]
 for i,(x,z) in enumerate(dense):
  a=dense[max(0,i-1)];b=dense[min(len(dense)-1,i+1)];d=math.dist(a,b) or 1
  nx=-(b[1]-a[1])/d*width/2;nz=(b[0]-a[0])/d*width/2
  for sg in [-1,1]:
   zz=z+sg*nz;verts.append((x+sg*nx,side*(half_width(s,zz)+offset),zz))
 return mesh(name,verts,[(2*i,2*i+1,2*i+3,2*i+2) for i in range(len(dense)-1)],material,0,True)

def third_rail_shoes(L,W,centers=None):
 use('04')
 for c in centers or [-L*.31,L*.31]:
  for side in [-1,1]:box('第三軌集電靴',(c,side*(W*.42),.42),(.42,.10,.06),'metal',.01)

def flat_roof_ribs(s,x0,x1,n=9,mat='metal'):
 """不鏽鋼車頂縱向壓筋。"""
 use('05');W,H=s['W'],s['H'];hw=W/2-s.get('radiusTop',.40)
 for k in range(n):box('車頂縱向壓筋',((x0+x1)/2,-hw+2*hw*k/(n-1),H+.006),(x1-x0,.035,.014),mat,.004)

def c381a(s):
 """台北捷運 CR381A（Hyundai Rotem，2026 交車、北投機廠測試中）。參考：Commons Sinsyuan 攝北投機廠正面與斜前側（CC BY-SA 4.0）、
 北捷官方外觀照（GWOIA）。素銀不鏽鋼車身；近垂直的方正車頭：上段黑色整面窗區含中央貫通門與左右大窗，上緣三段燈條（兩側琥珀、中央紅），
 下段銀色、兩角斜切 V 形燈座內四顆 LED，綠藍弧帶從車側繞到燈座下，黑色防爬橫帶與銀色前裙。每側 4 組雙開門，第三軌供電。"""
 L,W,H=s['L'],s['W'],s['H']
 color('rsilver','C6CBCE',.50,.30,.15);color('rgreen','8CC63F',.05,.35,.28);color('rblue','2B7CC9',.05,.35,.28);color('ramber','E7A52C',.10,.22,.40)
 profile=[(.83,L/2-.06),(1.00,L/2),(1.62,L/2),(H-.32,L/2-.08),(H-.10,L/2-.20),(H,L/2-.34)]
 def roof(s,neck):
  flat_roof_ribs(s,-L/2+.25,neck-.30,11)
  use('05')
  for x in [-L*.24,L*.18]:
   box('低矮冷氣罩',(x,0,H+.06),(1.70,W*.56,.13),'rsilver',.05)
   for k in range(6):box('冷氣罩格柵',(x-.60+k*.24,0,H+.13),(.06,W*.40,.01),'chassis',.002)
 f,neck,doors=railcar(s,profile,.06,[(H-.08,'rsilver'),(H+1,'roof')],[(H+1,'rsilver')],leaf='rsilver',crew=False,roof=roof)
 for side in [-1,1]:sidewindow(neck-.30,side*(W/2+.018),H-1.10,.30,.80,r=.05)
 # 側面車頭端的綠藍短弧帶。
 for side in [-1,1]:
  side_ribbon('車側綠色弧帶',s,[(neck-1.25,1.62),(neck-.50,1.66),(neck,1.78)],.05,'rgreen',side)
  side_ribbon('車側藍色弧帶',s,[(neck-1.45,1.48),(neck-.60,1.52),(neck,1.64)],.10,'rblue',side)
 # 車頭：黑色整面窗區（上緣微帶帽簷），中央貫通門，左右大窗。
 fz0,fz1=1.64,H-.10;front_panel('車頭黑色窗區',f,0,(fz0+fz1)/2,W-.16,fz1-fz0,'frame',.10,.03)
 dw=.80;front_panel('貫通門下半銀色門板',f,0,1.30,dw-.04,.66,'rsilver',.02,.04)
 front_panel('貫通門縫',f,0,(1.00+H-.30)/2,dw+.03,H-.30-1.00,'chassis',.02,.034)
 front_panel('貫通門上半黑面',f,0,(1.64+H-.30)/2,dw-.04,H-.30-1.64,'frame',.02,.045)
 front_panel('貫通門窗',f,0,2.55,.34,.62,'glass',.03,.06)
 for side in [-1,1]:
  front_glass(f,[(side*.50 if side>0 else -(W/2-.16),W/2-.16 if side>0 else -.50,'側前大窗')],1.86,H-.36)
  wiper(f,side*(W/2-.52),1.92,.66)
  # 兩角 V 形燈座與四顆 LED。
  yc=side*(W/2-.42)
  front_patch('V 形燈座',f,yc-.30,yc+.30,lambda y,yc=yc:1.44+.10*abs(y-yc)/.30,lambda y,yc=yc:1.62-.06*abs(y-yc)/.30,'frame',.040,cols=12,rows=3)
  for k in range(4):lamp('LED 頭燈',f,yc+side*(-.15+k*.075),1.54-.012*k,.026)
  front_ribbon('車頭綠色弧帶',f,[(side*(W/2-.04),1.66),(side*(W/2-.30),1.56),(side*.52,1.42)],.035,'rgreen')
  front_ribbon('車頭藍色弧帶',f,[(side*(W/2-.04),1.52),(side*(W/2-.30),1.40),(side*.48,1.33)],.08,'rblue')
 for y,m in [(-.62,'ramber'),(0,'red'),(.62,'ramber')]:front_panel('上緣燈條',f,y,H-.20,.46 if y else .36,.05,m,.02,.05)
 front_panel('黑色防爬橫帶',f,0,1.10,W-.12,.11,'frame',.02,.05)
 front_panel('銀色前裙',f,0,.92,W-.30,.22,'rsilver',.04,.06)
 front_panel('車鉤凹槽',f,0,.92,.70,.24,'chassis',.03,.08)
 for side in [-1,1]:
  for k in range(4):front_panel('前裙通風細縫',f,side*(W/2-.36),.88+k*.035,.16,.012,'chassis',.004,.075)
 text_label(s.get('label','CR381A'),(f(0,1.30)+.065,0,1.30),.10)
 third_rail_shoes(L,W)
 s['pantos']=0

def wanda(s):
 """台北捷運萬大線 Alstom Metropolis（2024 起交車、2026 主線測試中，全自動無人駕駛）。參考：Commons 金城機廠揭幕照（GWOIA）、
 「金城機廠停放的萬大樹林線電聯車」（臺北市政府捷運工程局，GWOIA）。白銀車身、草綠車頂包住車頭上緣，帽簷上一條黑色車號帶；
 斜傾的削鉛筆式車頭，黑色不對稱大擋風（列車右側窗較小、下方是雨刷座與兩顆圓燈，左側窗較大往下延伸）；深灰下裙兩側百葉格柵。
 車側窗下青綠長波浪細線、每側 3 組雙開門；沒有乘務員門。"""
 L,W,H=s['L'],s['W'],s['H']
 color('wdwhite','E6EAEA',.20,.30,.25);color('wdgreen','9CC83C',.05,.34,.30);color('wdgrey','5A5F63',.30,.40,.10)
 waves=ramp('wdwave',[(0,'14A595'),(1,'2C7FD0')],4)
 profile=[(.83,L/2-.20),(1.05,L/2-.02),(1.45,L/2),(2.00,L/2-.08),(2.80,L/2-.36),(H-.18,L/2-.62),(H,L/2-.86)]
 def roof(s,neck):
  use('05')
  for x in [-L*.20,L*.10]:
   box('低矮冷氣罩',(x,0,H+.07),(1.50,W*.58,.15),'roof',.06)
   for k in range(6):box('冷氣罩格柵',(x-.55+k*.22,0,H+.15),(.05,W*.42,.01),'chassis',.002)
 f,neck,doors=railcar(s,profile,.18,[(1.04,'wdgrey'),(H-.62,'wdwhite'),(H+1,'wdgreen')],[(1.12,'wdgrey'),(H-.36,'wdwhite'),(H+1,'wdgreen')],
  nose_zones=[(1.04,'wdgrey'),(H-.80,'wdwhite'),(H+1,'wdgreen')],leaf='wdwhite',crew=False,roof=roof)
 for side in [-1,1]:
  sidewindow(neck-.34,side*(W/2+.018),H-1.10,.30,.80,r=.05)
  for k,m in enumerate(waves):
   pts=[(x,1.66+k*.06+.05*math.sin(x*.9+k*.5)*(1-k*.18)) for x in [(-L/2+.10)+(neck-.05+L/2-.10)*i/40 for i in range(41)]]
   side_ribbon('窗下青綠長波浪',s,pts,.034,m,side)
 # 車頭：帽簷黑色車號帶、不對稱大擋風、雨刷座、圓燈、深灰下裙與百葉。
 front_panel('帽簷黑色車號帶',f,.05,H-.24,1.10,.16,'frame',.05,.03)
 text_label(s.get('label','LG'),(f(.05,H-.24)+.07,.05,H-.24),.11)
 front_panel('擋風黑框',f,0,(1.62+H-.34)/2,W-.30,H-.34-1.62,'frame',.16,.025)
 front_glass(f,[(-(W/2-.20),-.10,'列車右側擋風')],2.12,H-.40,offset=.045,r=.10)
 front_glass(f,[(-.02,W/2-.20,'列車左側大擋風')],1.70,H-.40,offset=.045,r=.10)
 front_panel('雨刷座',f,-.42,1.95,.46,.18,'chassis',.05,.05);wiper(f,-.40,2.05,.80)
 for y in [-.80,-.48]:lamp('圓形頭燈',f,y,1.50,.065)
 lamp('角落小燈',f,W/2-.20,1.52,.045)
 for side in [-1,1]:
  front_panel('下裙百葉格柵底',f,side*(W/2-.42),.98,.46,.24,'frame',.03,.05)
  for k in range(5):front_panel('下裙百葉',f,side*(W/2-.42),.90+k*.042,.42,.018,'wdgrey',.004,.07)
 front_panel('下裙中央開口',f,0,.96,.80,.22,'chassis',.04,.03)
 third_rail_shoes(L,W)
 s['pantos']=0

BUILDERS.update(c381a=c381a,wanda=wanda)
BUILDERS['shay31']=shay

def handwheel(x,y,z,r,material,axis='X'):
 """煙箱門手輪：輪圈＋十字輻條。"""
 torus_y('手輪輪圈',(0,0,0),r,r*.16,material,n=28,m=6);o=p.MODEL[-1]
 o.rotation_euler=(0,0,math.pi/2) if axis=='X' else (0,0,0);o.location=(x,y,z)
 for a in [0,math.pi/2]:rod('手輪輻條',(x,y-r*math.cos(a),z-r*math.sin(a)),(x,y+r*math.cos(a),z+r*math.sin(a)),r*.13,material)
 cyl('手輪輪轂',(x,y,z),r*.28,r*.4,material,'X',16)

def side_buffers(x,end,W,z,material='red'):
 """老式側緩衝器：兩顆圓盤緩衝器。"""
 use('07')
 for side in [-1,1]:
  cyl('緩衝器筒',(x+end*.10,side*W*.33,z),.07,.20,material,'X',20)
  cyl('緩衝器圓盤',(x+end*.22,side*W*.33,z),.15,.05,material,'X',32,.01)

def tengyun(s):
 """騰雲號（台灣總督府鐵道 1 形，德國 Hohenzollern 1887 年製，0-4-0 水櫃機）。參考：Commons 東勢複製版斜前側（SSR2000，CC BY-SA 3.0）、
 CC0 側面模型照（丘崈）、二二八公園實車煙箱門（lienyuan lee，CC BY 3.0）、1999 整修正面（Dquai，CC BY-SA 4.0）；尺寸 ja.wikipedia。
 照保存實車的黑色車身、紅色緩衝樑：鑽石形火星擋大煙囪、煙箱門紅色手輪與兩條門閂、低平汽室蓋、駕駛室前黃銅安全閥，
 鍋爐兩側短水櫃，方形駕駛室側面大開口，前後紅色鉚釘緩衝樑與兩顆圓緩衝器。"""
 L,W,H=s['L'],s['W'],s['H'];body='tyblack'
 color('tyblack','1D2122',.30,.42,.15);color('tyred','C8321E',.10,.38,.25)
 deck=1.08;r=.50;axles=[.72,-.78]
 use('04')
 for x in axles:
  cyl('動輪軸',(x,0,r),.08,W*.70,'chassis','Y',20)
  for side in [-1,1]:
   wheel(x,side*W*.36,r,spoked=True)
   cyl('曲柄銷',(x+.16,side*(W*.36+.16),r-.10),.05,.10,'metal','Y',16)
 for side in [-1,1]:
  yy=side*(W*.36+.22)
  rod('連結桿',(axles[0]+.16,yy,r-.10),(axles[1]+.16,yy,r-.10),.038,'metal')
  cyl('外置汽缸',(1.55,side*(W/2-.10),.86),.21,.72,body,'X',32)
  cyl('汽缸前蓋',(1.93,side*(W/2-.10),.86),.19,.04,'metal','X',32)
  rod('活塞桿',(1.20,side*(W/2-.10),.86),(axles[0]+.16,yy,r-.10),.035,'metal')
  line('Allan 閥動連桿',[(axles[0]-.20,side*(W*.36+.30),.78),(.30,side*(W*.36+.30),1.02),(1.20,side*(W/2-.08),1.02)],.022,'metal')
  rod('偏心桿',(axles[0],side*(W*.36+.27),r),(axles[0]-.20,side*(W*.36+.30),.78),.020,'metal')
  box('外側車架',(0,side*W*.30,.86),(4.10,.10,.36),body,.02)
  for x in axles:box('軸箱',(x,side*W*.30,r),(.24,.14,.24),body,.02)
 use('01');box('走行板',(0,0,deck),(L-.10,W*.94,.08),body,.02)
 for side in [-1,1]:box('走行板紅色側緣',(0,side*(W*.47+.005),deck-.005),(L-.10,.012,.07),'tyred',.003)
 # 鍋爐與煙箱、鑽石形煙囪。
 cabF=-.62;bf=1.95;br=.52;bz=deck+.10+br
 cyl('圓筒鍋爐',((cabF+bf-.40)/2,0,bz),br,bf-.40-cabF,body,'X',56,.01)
 for x in [cabF+.45,.40,1.10]:cyl('鍋爐箍環',(x,0,bz),br+.012,.035,'chassis','X',56,.004)
 cyl('煙箱',(bf-.25,0,bz+.02),br+.08,.56,body,'X',56)
 for i in range(14):
  a=2*math.pi*i/14;cyl('煙箱鉚釘',(bf-.48,(br+.08)*math.cos(a),bz+.02+(br+.08)*math.sin(a)),.018,.03,'chassis','X',8,0)
 cyl('煙箱門外圈',(bf+.04,0,bz+.02),br*.98,.05,body,'X',56,.01)
 cyl('煙箱門',(bf+.08,0,bz+.02),br*.86,.06,body,'X',56,.02)
 for dz in [.24,-.24]:box('煙箱門門閂',(bf+.12,.10,bz+.02+dz),(.03,.62,.05),body,.01)
 handwheel(bf+.14,0,bz+.02,.12,'tyred')
 use('05');cx=bf-.28;stz=bz+br+.04
 cyl('煙囪筒身',(cx,0,stz+.30),.12,.62,body,n=32)
 cyl('煙囪箍',(cx,0,stz+.58),.14,.05,'chassis',n=32)
 cone('鑽石形火星擋下錐',(cx,0),.13,.44,stz+.62,stz+1.05,body,cap=False)
 cyl('火星擋口緣',(cx,0,stz+1.07),.46,.05,body,n=40)
 cone('火星擋頂蓋',(cx,0),.40,.08,stz+1.09,stz+1.20,body)
 cyl('頂蓋小鈕',(cx,0,stz+1.22),.05,.04,body,n=16)
 cyl('汽室蓋基座',(.45,0,bz+br-.02),.24,.10,body,n=36)
 cyl('低平汽室蓋',(.45,0,bz+br+.07),.20,.12,body,n=36,bevel=.05)
 for i in range(10):a=2*math.pi*i/10;cyl('汽室蓋螺栓',(.45+.22*math.cos(a),.22*math.sin(a),bz+br+.04),.016,.02,'metal',n=8,bevel=0)
 sv=bf-.72
 cyl('安全閥座',(sv,0,bz+br+.02),.15,.14,body,n=32,bevel=.03)
 cyl('安全閥座頸',(sv,0,bz+br+.13),.09,.10,body,n=24)
 for dy in [-.06,.06]:
  rod('黃銅安全閥',(sv,dy,bz+br+.16),(sv,dy,bz+br+.42),.035,'gold')
  cyl('安全閥頂',(sv,dy,bz+br+.44),.05,.04,'gold',n=16)
 rod('安全閥槓桿',(sv-.18,0,bz+br+.40),(sv+.10,0,bz+br+.40),.014,'gold')
 rod('汽笛',(cabF+.12,-.28,bz+br-.04),(cabF+.12,-.28,bz+br+.22),.025,'gold')
 use('03');cyl('黃銅頭燈燈殼',(bf-.06,0,bz+br+.16),.12,.20,'gold','X',24);lamp('黃銅頭燈',lambda y,z:bf-.06,0,bz+br+.16,.07)
 box('頭燈座',(bf-.10,0,bz+br+.04),(.18,.16,.08),body,.01)
 # 注水器彎管：從煙箱兩側彎到走行板。
 for side in [-1,1]:
  line('注水器彎管',[(cabF+.30,side*(br+.06),bz+.12),(bf-.70,side*(br+.10),bz-.02),(bf-.40,side*(br+.14),deck+.30),(bf-.32,side*(br+.14),deck+.04)],.035,body)
  line('鍋爐扶手',[(cabF+.10,side*(br+.10),bz+.26),(bf-.55,side*(br+.10),bz+.26)],.014,'metal')
 # 鍋爐兩側短水櫃，緊貼駕駛室前方。
 tl=.92
 for side in [-1,1]:
  box('側水櫃',(cabF+tl/2,side*(W/2-.26),deck+.50),(tl,.50,.92),body,.04)
  panel('水櫃紅色細框',(cabF+tl/2,side*(W/2-.005),deck+.50),tl-.14,.76,'tyred',r=.04,depth=.006)
  panel('水櫃內面',(cabF+tl/2,side*(W/2+.001),deck+.50),tl-.20,.70,body,r=.03,depth=.008)
  cyl('水櫃注水口',(cabF+tl-.18,side*(W/2-.26),deck+.98),.08,.05,body,n=16)
 # 駕駛室：前牆兩側小方窗，側面前半實牆、後半大開口，略拱的屋頂外伸。
 cabR=-2.02;ch=H-.30;cw=W*.98
 box('駕駛室前牆',(cabF-.04,0,(deck+ch)/2),(.08,cw,ch-deck),body,.02)
 for side in [-1,1]:
  panel('前牆小方窗',(cabF+.005,side*.62,ch-.48),.36,.36,'glass','front',r=.03)
  panel('前窗白框',(cabF,side*.62,ch-.48),.44,.44,'tyred','front',r=.03,depth=.01)
  yy=side*cw/2
  box('駕駛室側牆前半',(cabF-.30,yy,(deck+ch)/2),(.56,.07,ch-deck),body,.02)
  box('駕駛室側牆下半',(cabF-.95,yy,deck+.45),(.80,.07,.90),body,.02)
  box('駕駛室側牆後柱',(cabR+.06,yy,(deck+ch)/2),(.12,.07,ch-deck),body,.02)
  box('駕駛室側牆上楣',((cabF+cabR)/2,yy,ch-.14),(cabF-cabR,.07,.26),body,.02)
  panel('側牆小窗',(cabF-.30,yy+side*.01,ch-.62),.30,.36,'glass',r=.04)
  panel('名牌紅底',(cabF-.30,yy+side*.04,deck+.62),.42,.24,'tyred',r=.02)
  panel('名牌金框',(cabF-.30,yy+side*.035,deck+.62),.48,.30,'gold',r=.02,depth=.01)
  rod('登車扶手',(cabF-.62,yy+side*.06,deck+.10),(cabF-.62,yy+side*.06,ch-.40),.016,'metal')
  for z in [.55,.78]:box('登車踏階',(cabF-.95,side*W*.46,z),(.34,.22,.035),'metal',.006)
  for dx in [-.15,.15]:box('踏階吊架',(cabF-.95+dx,side*W*.46,.80),(.03,.03,.54),'metal',0)
 use('05');roofv=[];n=10
 for i in range(n+1):
  t=i/n;y=(t-.5)*(W+.18);z=ch+.10*math.cos((t-.5)*math.pi)
  roofv+=[(cabF+.12,y,z),(cabR-.12,y,z)]
 faces=[(2*i,2*i+1,2*i+3,2*i+2) for i in range(n)]
 mesh('略拱駕駛室屋頂',roofv,faces,body,0,True);m=p.MODEL[-1].modifiers.new('屋頂厚度','SOLIDIFY');m.thickness=.06
 box('後牆下半',(cabR+.04,0,deck+.40),(.08,cw,.80),body,.02)
 box('駕駛室後煤櫃',(cabR+.30,0,deck+.32),(.46,cw*.70,.62),body,.03)
 # 前後紅色鉚釘緩衝樑、圓緩衝器、中央車鉤座與鏈、扶手橫桿。
 for end in [-1,1]:
  x=end*(L/2-.08)
  use('07');box('紅色鉚釘緩衝樑',(x,0,.92),(.14,W*1.02,.42),'tyred',.02)
  for i in range(9):
   for z in [.80,1.04]:cyl('緩衝樑鉚釘',(x+end*.075,-W*.46+i*W*.115,z),.022,.02,'tyred','X',8,0)
  side_buffers(x,end,W,.92,'tyred')
  box('中央車鉤座',(x+end*.14,0,.88),(.16,.30,.24),'chassis',.02)
  line('連結鏈',[(x+end*.20,0,.96),(x+end*.26,0,.80),(x+end*.24,0,.68)],.016,'metal')
  rod('緩衝樑上扶手',(x+end*.10,-W*.44,1.22),(x+end*.10,W*.44,1.22),.014,'metal')
 use('03')
 for end in [-1,1]:
  # 照東勢複製版正面：扁鋼條從緩衝樑兩端往下彎，中段往前凸。用掃掠的扁矩形斷面做成一整條。
  n=24;path=[]
  for i in range(n+1):
   t_=i/n;y=(t_-.5)*W*.80;k=abs(2*t_-1)
   z=.26+.48*max(0,(k-.78)/.22)**1.6;x=end*(L/2-.10+.18*(1-k**4))
   path.append((x,y,z))
  v=[];fc=[]
  for x,y,z in path:v+=[(x-.02,y,z-.05),(x+.02,y,z-.05),(x+.02,y,z+.05),(x-.02,y,z+.05)]
  for i in range(n):
   a=4*i;b=a+4
   fc+=[(a+j,a+(j+1)%4,b+(j+1)%4,b+j) for j in range(4)]
  fc+=[(3,2,1,0),(4*n,4*n+1,4*n+2,4*n+3)]
  mesh('彎形排障桿',v,fc,'tyred',0,True)
 s['drivers']=2;s['axles']=2;s['tank']=True

BUILDERS['tengyun']=tengyun

# ── 台鐵經典電聯車／柴聯車 ──────────────────────────────────────────────────

def underfloor(xs,W,mat='chassis',w=1.0):
 """車底機器箱：xs 是每箱中心 x。"""
 use('04')
 for x in xs:
  box('車底機器箱',(x,0,.64),(w,W*.70,.34),mat,.03)
  for k in range(4):box('機器箱散熱鰭片',(x-w*.36+k*w*.24,W*.351,.64),(.05,.012,.24),'metal',.004)
  for k in range(4):box('機器箱散熱鰭片',(x-w*.36+k*w*.24,-W*.351,.64),(.05,.012,.24),'metal',.004)

def lamp_pair(f,y_outer,y_inner,z,r=.065,housing='chassis'):
 """車頭下緣一組燈：外側紅色尾燈、內側白色頭燈，共用一個圓角黑色燈座。"""
 front_panel('燈組黑色燈座',f,(y_outer+y_inner)/2,z,abs(y_outer-y_inner)+2*r+.08,2*r+.08,housing,r+.04,.03)
 lamp('尾燈',f,y_outer,z,r,red=True);lamp('頭燈',f,y_inner,z,r)

def hose_cocks(x,W,z=.80,mat='orange',n=3):
 """端梁下緣的軟管旋塞（自強號車頭兩側各一排橘色小筒）。"""
 use('07')
 for side in [-1,1]:
  for k in range(n):
   y=side*(W/2-.20-k*.13);cyl('軟管旋塞',(x,y,z),.035,.12,mat,n=12,bevel=0)
   line('制動軟管',[(x,y,z-.06),(x+.04,y,z-.24),(x,y*.92,z-.36)],.016,'rubber')

def side_poly(name,s,x0,x1,zlo,zhi,material,side,offset=.012,cols=10,rows=3):
 """平直車側上的色塊：x 從 x0 到 x1，上下緣可以是常數或 x 的函式；貼著 half_width 的斷面。"""
 use('01');lo=zlo if callable(zlo) else (lambda x:zlo);hi=zhi if callable(zhi) else (lambda x:zhi);verts=[]
 for i in range(rows+1):
  for j in range(cols+1):
   x=x0+(x1-x0)*j/cols;a,b=lo(x),hi(x);z=a+(b-a)*i/rows;verts.append((x,side*(half_width(s,z)+offset),z))
 faces=[(i*(cols+1)+j,i*(cols+1)+j+1,(i+1)*(cols+1)+j+1,(i+1)*(cols+1)+j) for i in range(rows) for j in range(cols)]
 return mesh(name,verts,faces,material,0,True)

def tze_livery(s,f,neck,y,o,dy,band,bw=.16,lowz=1.30,winz=(1.99,2.65),wy=.90,ww=.58,lampz=1.10,cabwin=True):
 """自強號黃橘車頭（EMU200／EMU300 共用）。橘色 V 字斜帶從貫通門往外升高、繞過車角延伸到駕駛室側面，
 斜帶下方一條黃色細帶，再下面整塊橘色；粗黑框圓頂貫通門（偏 dy）、兩側擋風與上方行先窗、下緣紅白燈組。
 band=(門邊, 車角, 側面尾端) 斜帶中心高度；y／o 是黃、橘材質。駕駛室側面（neck 到車頭）由 nose_zones 塗黃橘。"""
 L,W,H=s['L'],s['W'],s['H'];zi,zo,zr=band;gap=.10
 c=lambda yy:zi+(zo-zi)*(abs(yy)-.62)/(W/2-.62)
 for side in [-1,1]:
  a,b=(.62,W/2-.03) if side>0 else (-(W/2-.03),-.62)
  front_patch('下緣橘色',f,a,b,lowz-.04,lambda yy:c(yy)-bw/2-gap,o,.026,cols=16,rows=3)
  front_patch('V 字橘色斜帶',f,a,b,lambda yy:c(yy)-bw/2,lambda yy:c(yy)+bw/2,o,.026,cols=16,rows=2)
  # 繞到駕駛室側面：斜帶繼續往後升高。
  x1=f(side*W/2,zo)-.03;x0=neck+.03;cs=lambda x:zo+(zr-zo)*(x1-x)/(x1-x0)
  side_poly('側面下緣橘色',s,x0,x1,lowz-.04,lambda x:cs(x)-bw/2-gap,o,side,cols=8)
  side_poly('側面橘色斜帶',s,x0,x1,lambda x:cs(x)-bw/2,lambda x:cs(x)+bw/2,o,side,cols=8,rows=2)
  if cabwin:sidewindow((x0+x1)/2-.02,side*(W/2+.018),(winz[0]+winz[1])/2,min(.30,x1-x0-.16),winz[1]-winz[0]-.06,r=.05)
 front_panel('貫通門黑色粗框',f,dy,(1.00+H-.30)/2,1.18,H-.30-1.00,'frame',.22,.03)
 front_panel('貫通門扇',f,dy,(1.04+H-.62)/2,.76,H-.62-1.04,y,.03,.045)
 front_panel('貫通門窗',f,dy,(winz[0]+winz[1])/2+.06,.46,winz[1]-winz[0]+.12,'glass',.06,.06)
 front_panel('貫通門把手',f,dy+.28,winz[0]-.08,.08,.12,'chassis',.02,.06)
 for side in [-1,1]:
  inner=dy+side*.62;outer=side*(W/2-.14);yc=(inner+outer)/2;w=min(ww,abs(outer-inner)-.08)
  front_panel('擋風黑框',f,yc,(winz[0]+winz[1])/2,w+.10,winz[1]-winz[0]+.08,'frame',.10,.03)
  front_glass(f,[(yc-w/2,yc+w/2,'方形擋風')],winz[0],winz[1],offset=.045,r=.08)
  wiper(f,yc+w*.22*side,winz[0]+.01,.52)
  lamp_pair(f,side*(W/2-.36),side*(W/2-.62),lampz,.060)

def tze_pilot(s,f,y,o,hazard_skirt=False):
 """自強號車頭下方：黃色排障板（或黃黑警戒斜紋）與橘色軟管旋塞。"""
 W=s['W'];x0=f(0,.83)
 if hazard_skirt:hazard(x0+.02,W,.60,.36)
 else:
  use('07');box('黃色排障板',(x0+.02,0,.58),(.10,W*.66,.30),y,.03)
  for k in range(9):cyl('排障板黑點',(x0+.075,-W*.28+k*W*.07,.50),.022,.01,'frame','X',12,0)
 hose_cocks(x0+.04,W,.80,o)

def emu300(s):
 """台鐵 EMU300 型電聯車（義大利 Socimi 1988–89 製，2021 退役，EMC307 保存）。參考：Commons 新竹站車頭斜前（PD）、
 桃園站側面（CC BY-SA 3.0）、EMC307 側板近拍。自強號黃橘塗裝：前傾車頭，橘色圓頂蓋上兩顆頭燈，黃色車頭面，
 粗黑框包住的黃色貫通門（略偏列車左側），兩側方擋風與上方行先窗，橘色 V 字斜帶繞到駕駛室側面，下緣橘色配紅白燈組；
 車側上半米黃、窗下芥末褐，駕駛室後方一扇單開門，耐候鋼車身。這裡做駕駛馬達車 EMC，車頂沒有集電弓（集電弓在中間的 EP 車）。"""
 L,W,H=s['L'],s['W'],s['H']
 # 照片目測色在 AgX 下會變淡，這裡比目測再深一階。
 color('e3yellow','EFA20C',.05,.36,.30);color('e3orange','D8381A',.05,.36,.30);color('e3cream','D9C27A',.05,.40,.22);color('e3tan','B0742A',.08,.40,.20)
 color('e3roof','A9AEAF',.30,.45,.10)
 profile=[(.83,L/2-.04),(1.00,L/2),(1.70,L/2),(2.90,L/2-.16),(H-.30,L/2-.24),(H-.10,L/2-.38),(H,L/2-.52)]
 def roof(s,neck):
  roof_ac(s,[-L*.24,L*.10],1.9,'e3roof')
  use('05');box('車頂電阻器箱',(neck-.55,0,H+.10),(.70,W*.50,.18),'e3roof',.04)
  for k in range(6):box('電阻器箱格柵',(neck-.80+k*.10,0,H+.19),(.04,W*.42,.01),'chassis',.002)
 s.update(rearDoor=.50,frontDoor=.50,cabGap=.30,winZ=2.39,winH=.76,winPitch=.78,doorTop=H-.58,doorWinZ=2.36,doorWinH=.70)
 f,neck,doors=railcar(s,profile,.05,[(1.96,'e3tan'),(H-.10,'e3cream'),(H+1,'e3roof')],[(1.30,'e3orange'),(H-.46,'e3yellow'),(H+1,'e3orange')],
  nose_zones=[(1.30,'e3orange'),(H-.10,'e3yellow'),(H+1,'e3orange')],leaf='e3cream',crew=False,roof=roof)
 dy=.08;tze_livery(s,f,neck,'e3yellow','e3orange',dy,(1.60,1.90,2.04))
 for side in [-1,1]:
  for x in [doors[-1]-1.05,doors[-1]-1.55]:grille('下半百葉進氣口',x,side*(W/2+.012),1.42,.38,.30,True,9,True)
 for side in [-1,1]:
  yc=side*.90+dy*.3
  front_panel('行先窗',f,yc,2.95,.50,.15,'frame',.05,.03)
  front_panel('行先窗內光',f,yc,2.95,.40,.08,'cream' if side<0 else 'lamp',.03,.04)
  front_panel('高壓警告小牌',f,side*1.05,3.18,.10,.12,'yellow',.01,.035)
 # 頂蓋頭燈：兩顆圓燈與上方紅色標識燈。
 front_panel('頂部頭燈座',f,0,H-.22,.56,.24,'e3orange',.10,.03)
 for yy in [-.15,.15]:lamp('頂部頭燈',f,yy,H-.22,.075)
 use('03');box('頂部紅色標識燈',(f(0,H-.04)+.02,0,H+.01),(.10,.12,.08),'red',.02)
 text_label(s.get('label','EMU300'),(f(-.90,2.95)+.06,-.90,2.95),.07)
 tze_pilot(s,f,'e3yellow','e3orange')
 underfloor([-1.30,-.05,1.20],W)
 s['pantos']=0

def emu200(s):
 """台鐵 EMU200 型電聯車原始塗裝（南非 UCW 1986 製，2002–04 全數改造成 EMU1200，原貌只剩舊照片）。參考：Commons 1989 板橋站 EMU206、
 1997 Lexcie 攝車頭與側面（CC BY-SA 3.0）、二水站車頭斜前。跟 EMU300 同一套自強號黃橘車頭，但車頭面幾乎垂直、頂蓋較圓，
 頂蓋中央一顆橢圓頭燈、旁邊小行先燈，斜帶比較平；車側上半淺米灰、窗下淺石褐；駕駛室後方先是乘務員門、再一扇單開客用門，
 下方黃黑警戒斜紋排障板。做駕駛馬達車，集電弓在中間的 EP 車。"""
 L,W,H=s['L'],s['W'],s['H']
 color('e2yellow','EFA80E',.05,.36,.30);color('e2orange','D8401C',.05,.36,.30);color('e2cream','D3CBAE',.05,.40,.22);color('e2stone','A27A4A',.08,.40,.20)
 color('e2roof','A3A8A8',.30,.45,.10)
 profile=[(.83,L/2-.04),(1.00,L/2),(2.85,L/2-.03),(H-.36,L/2-.10),(H-.14,L/2-.26),(H,L/2-.46)]
 def roof(s,neck):
  roof_ac(s,[-L*.25,L*.08],1.8,'e2roof')
  use('05');box('車頂電阻器箱',(neck-.60,0,H+.10),(.80,W*.50,.18),'e2roof',.04)
  for k in range(7):box('電阻器箱格柵',(neck-.90+k*.10,0,H+.19),(.04,W*.42,.01),'chassis',.002)
 s.update(rearDoor=.50,frontDoor=1.05,cabGap=1.40,winZ=2.32,winH=.70,winPitch=.84,winR=.08,doorTop=H-.62,doorWinZ=2.30,doorWinH=.64)
 f,neck,doors=railcar(s,profile,.04,[(1.92,'e2stone'),(H-.10,'e2cream'),(H+1,'e2roof')],[(1.30,'e2orange'),(H-.52,'e2yellow'),(H+1,'e2orange')],
  nose_zones=[(1.30,'e2orange'),(H-.10,'e2yellow'),(H+1,'e2orange')],leaf='e2cream',crew='e2cream',roof=roof)
 dy=-.10;tze_livery(s,f,neck,'e2yellow','e2orange',dy,(1.64,1.73,1.80),winz=(1.94,2.62))
 for side in [-1,1]:grille('下半百葉進氣口',doors[-1]-1.30,side*(W/2+.012),1.42,.42,.30,True,9,True)
 # 頂蓋：中央橢圓頭燈（黑色燈座）、一側小行先燈、高壓警告小牌。
 front_panel('橢圓頭燈座',f,dy,H-.30,.40,.22,'frame',.11,.03)
 front_panel('橢圓頭燈',f,dy,H-.30,.30,.13,'lamp',.065,.05)
 front_panel('行先燈',f,.86,H-.56,.30,.10,'lamp',.03,.04)
 front_panel('行先燈框',f,.86,H-.56,.38,.16,'frame',.04,.03)
 front_panel('行先牌',f,-.86,H-.56,.36,.12,'white',.02,.04)
 front_panel('高壓警告小牌',f,.40,H-.36,.10,.12,'yellow',.01,.035)
 use('03');box('頂部標識燈',(f(-.40,H-.10)+.02,-.40,H-.02),(.10,.10,.07),'red',.02)
 text_label(s.get('label','EMU206'),(f(-.86,H-.56)+.06,-.86,H-.56),.07)
 tze_pilot(s,f,'e2yellow','e2orange',hazard_skirt=True)
 underfloor([-1.35,-.10,1.15],W)
 s['pantos']=0

BUILDERS.update(emu300=emu300,emu200=emu200)

def corrugation(s,spans,zs,mat='metal'):
 """不鏽鋼車側波紋：spans=[(x0,x1)] 是不含門的分段，zs 是每條壓筋的高度。"""
 use('01');W=s['W']
 for side in [-1,1]:
  for a,b in spans:
   if b-a<.10:continue
   for z in zs:box('不鏽鋼側牆壓筋',((a+b)/2,side*(half_width(s,z)+.008),z),(b-a,.014,.022),mat,.004)

def dr2800(s):
 """台鐵 DR2800 型柴聯自強號（日本東急車輛 1982–84 製，2023 退役、2024 報廢）。參考：Commons 2023 台中站車頭（鐵路1，CC BY-SA 4.0）、
 成功站車側近拍、台鐵官方整列照（GWOIA）。不鏽鋼波紋車身，窗下橘色寬帶、窗上橘色細線；垂直平頭，橘色頂蓋上方突出的長方頭燈箱（兩顆圓燈），
 黃色車頭面兩扇大窗，中央凸框貫通門，窗下橘色「人」字斜帶：橫帶接兩道往貫通門下緣收的斜區；黃橘塗裝繞到駕駛室側面。
 每側只在車尾端有一扇折疊客用門，駕駛室後方是緊急逃生門；車頂深灰散熱與設備罩，柴油動力沒有集電弓。"""
 L,W,H=s['L'],s['W'],s['H']
 color('drsteel','AEB2B0',.62,.30,.10);color('dryellow','EFA50E',.05,.36,.30);color('drorange','CC4614',.05,.36,.30);color('drdark','3B4044',.30,.48,.08)
 profile=[(.83,L/2-.02),(1.00,L/2),(3.00,L/2-.02),(H-.20,L/2-.10),(H-.06,L/2-.22),(H,L/2-.34)]
 def roof(s,neck):
  use('05')
  for x0,x1 in [(-L/2+.30,-L*.18),(-L*.15,L*.16),(L*.19,neck-.05)]:
   box('車頂深灰設備罩',((x0+x1)/2,0,H+.07),(x1-x0,W*.74,.20),'drdark',.09)
   for k in range(int((x1-x0)/.22)):box('設備罩散熱格柵',(x0+.15+k*.22,0,H+.17),(.06,W*.54,.012),'chassis',.003)
  for side in [-1,1]:box('排氣口',(-L*.02,side*W*.20,H+.20),(.18,.12,.08),'chassis',.02)
 s.update(doorXs=[-L/2+.50],winZ=2.42,winH=.82,winPitch=.90,winR=.07,doorTop=H-.56,doorWinZ=2.40,doorWinH=.70,cabGap=.72)
 f,neck,doors=railcar(s,profile,.03,[(H+1,'drsteel')],[(.95,'drorange'),(H-.35,'dryellow'),(H+1,'drorange')],
  nose_zones=[(.95,'drorange'),(H-.35,'dryellow'),(H+1,'drorange')],leaf='drsteel',crew='drsteel',
  bands=[(1.90,.14,'drorange'),(2.95,.04,'drorange')],roof=roof)
 dw=s.get('doorW',.52)
 corrugation(s,[(-L/2+.12,doors[0]-dw/2-.06),(doors[0]+dw/2+.06,neck-.64),(neck-.08,neck-.01)],[1.00+k*.072 for k in range(11)]+[3.02,3.09,3.16,3.23])
 for side in [-1,1]:
  side_poly('車端黃色細帶',s,-L/2+.03,-L/2+.10,.90,H-.12,'dryellow',side,.014,2,2)
  x1=f(side*W/2,1.7)-.03;x0=neck+.03
  side_poly('側面橘色橫帶',s,x0,x1,1.61,1.86,'drorange',side,cols=4,rows=1)
  sidewindow((x0+x1)/2,side*(W/2+.018),2.50,min(.26,x1-x0-.14),.70,r=.05)
 # 車頭「人」字：橘色橫帶接兩道往貫通門下緣收的斜區。
 diag=lambda y:.92+(1.61-.92)*min(1,max(0,(abs(y)-.50)/(.86-.50)))
 for side in [-1,1]:
  a,b=(.46,W/2-.03) if side>0 else (-(W/2-.03),-.46)
  front_patch('人字橘色橫帶',f,a,b,1.61,1.86,'drorange',.026,cols=12,rows=1)
  a,b=(.46,.88) if side>0 else (-.88,-.46)
  front_patch('人字橘色斜區',f,a,b,diag,1.615,'drorange',.026,cols=14,rows=4)
  yc=side*.86
  front_panel('擋風黑框',f,yc,2.51,.84,1.14,'frame',.10,.03)
  front_glass(f,[(yc-.37,yc+.37,'大擋風')],1.98,3.04,offset=.045,r=.08)
  wiper(f,yc+side*.22,2.00,.60)
  lamp_pair(f,side*(W/2-.30),side*(W/2-.52),1.45,.060)
  front_panel('黃色警告小牌',f,side*.66,H-.18,.10,.12,'yellow',.01,.035)
 # 貫通門：黃色凸框（深色外緣）、門窗、下半深色踏板凹槽、橫向鏈條。
 front_panel('貫通門深色外緣',f,0,(.95+H-.30)/2,.92,H-.30-.95,'frame',.06,.03)
 front_panel('貫通門黃色凸框',f,0,(.97+H-.32)/2,.86,H-.32-.97,'dryellow',.05,.05)
 front_panel('貫通門扇',f,0,(1.00+H-.40)/2,.66,H-.40-1.00,'dryellow',.03,.07)
 front_panel('貫通門窗',f,0,2.52,.44,.92,'glass',.05,.085)
 front_panel('貫通踏板凹槽',f,0,1.27,.56,.44,'chassis',.04,.085)
 line('貫通門鏈條',[(f(-.30,1.92)+.10,-.30,1.92),(f(0,1.84)+.10,0,1.84),(f(.30,1.92)+.10,.30,1.92)],.010,'metal')
 # 頂部突出的長方頭燈箱，兩顆圓燈。
 use('03');xh=f(0,H-.06)
 box('頂部頭燈箱',(xh-.06,0,H-.02),(.30,.62,.30),'drorange',.05)
 for yy in [-.13,.13]:lamp('頂部頭燈',lambda y,z:xh+.02,yy,H-.02,.075)
 text_label(s.get('label','DR2823'),(f(-.86,2.92)+.07,-.86,2.92),.07)
 tze_pilot(s,f,'dryellow','chassis')
 underfloor([-1.40,-.20,1.10],W)
 use('04');box('柴油引擎',(.45,0,.66),(1.30,W*.60,.40),'drdark',.05)
 for k in range(6):box('引擎散熱鰭',(.45-.5+k*.2,0,.88),(.05,W*.50,.04),'chassis',.004)
 s['pantos']=0

BUILDERS['dr2800']=dr2800

def emu400(s):
 """台鐵 EMU400 型電聯車（南非 UCW 1990 製，2015 退出定期營運，EMC410 保存）。參考：Commons 竹南站 EMU410 車頭斜前（PD）、
 2010 桃園 Lexcie 攝側面、2008 松山站整列。藍色車頭面，偏列車右側的凸框貫通門（門扇中段白色橫板與深色圓徽），
 左側窄窗、右側大擋風，頂部中央橢圓頭燈、左上車號白牌、右上行先牌；窗下白色橫帶，右側一道白線從下方彎起往側面掃；
 下緣圓形燈組、黃黑警戒排障板。車側銀灰，藍色車頂邊帶與窗下藍色粗細兩條線，駕駛室側面整段藍色；每側兩組雙開門靠車廂中段。"""
 L,W,H=s['L'],s['W'],s['H']
 color('e4blue','2146BE',.08,.34,.30);color('e4silver','AEB4BA',.50,.32,.12);color('e4white','EEF0EA',.05,.36,.25);color('e4roof','B3B8BB',.30,.45,.10)
 profile=[(.83,L/2-.03),(1.00,L/2),(2.90,L/2-.03),(H-.40,L/2-.10),(H-.16,L/2-.24),(H,L/2-.44)]
 def roof(s,neck):roof_ac(s,[-L*.22,L*.14],1.7,'e4roof',low=True)
 s.update(doorXs=[-L*.21,L*.13],doorW=.74,winZ=2.30,winH=.78,winPitch=.74,winR=.07,doorTop=H-.62,doorWinZ=2.30,doorWinH=.72,cabGap=.80)
 f,neck,doors=railcar(s,profile,.05,[(H-.24,'e4silver'),(H-.06,'e4blue'),(H+1,'e4roof')],[(H+1,'e4blue')],
  nose_zones=[(H+1,'e4blue')],leaf='e4silver',crew='e4blue',leafbands=[(1.76,.10,'e4blue'),(1.55,.04,'e4blue')],roof=roof)
 for side in [-1,1]:
  side_poly('車側藍色粗線',s,-L/2+.06,neck-.72,1.71,1.81,'e4blue',side,.014,6,1)
  side_poly('車側藍色細線',s,-L/2+.06,neck-.72,1.53,1.57,'e4blue',side,.014,6,1)
  # 駕駛室側面整段藍色，白帶與白線接著車側的藍線。
  x1=f(side*W/2,1.7)-.03
  side_poly('駕駛室側面藍色',s,neck-.72,neck+.02,.86,H-.06,'e4blue',side,.012,4,8)
  side_poly('駕駛室側面白帶',s,neck-.72,x1,1.67,1.82,'e4white',side,.018,6,1)
  side_poly('駕駛室側面白線',s,neck-.72,x1,1.52,1.60,'e4white',side,.018,6,1)
  for k in range(3):side_poly('車角白色短線',s,x1-.24,x1-.04,1.08+k*.08,1.12+k*.08,'e4white',side,.018,2,1)
  sidewindow(neck+.20,side*(W/2+.018),2.30,.30,.84,r=.05)
 # 車頭：凸框貫通門偏列車右側（-Y）。
 dy=-.33
 front_panel('貫通門凸框外緣',f,dy,1.91,1.23,2.50,'frame',.12,.045)
 front_panel('貫通門凸框',f,dy,1.91,1.19,2.46,'e4blue',.10,.07)
 front_panel('貫通門洞',f,dy-.01,1.82,.90,2.10,'frame',.04,.085)
 front_panel('貫通門扇',f,-.17,1.82,.56,2.06,'e4blue',.03,.095)
 front_panel('門扇白色橫板',f,-.17,1.57,.56,.48,'e4white',.02,.10)
 front_panel('門扇深色圓徽',f,-.17,1.52,.20,.13,'frame',.06,.106)
 front_panel('貫通門窗',f,-.17,2.28,.44,.86,'glass',.05,.104)
 front_panel('右側大擋風框',f,.85,2.28,.82,.94,'frame',.08,.03)
 front_glass(f,[(.49,1.21,'右側大擋風')],1.85,2.71,offset=.045,r=.07)
 wiper(f,.90,1.88,.56)
 front_panel('左側窄窗框',f,-1.13,2.28,.36,.94,'frame',.06,.03)
 front_glass(f,[(-1.27,-.99,'左側窄窗')],1.85,2.71,offset=.045,r=.05)
 # 窗下白色橫帶；右側白線從下方彎起再水平接到車角，左側白線水平。
 front_patch('窗下白色橫帶',f,.29,W/2-.03,1.67,1.82,'e4white',.026,cols=10,rows=1)
 front_patch('窗下白色橫帶',f,-(W/2-.03),-.95,1.67,1.82,'e4white',.026,cols=4,rows=1)
 front_ribbon('右側白色彎線',f,[(.30,1.38),(.50,1.42),(.70,1.53),(.92,1.56),(W/2-.03,1.56)],.075,'e4white')
 front_ribbon('左側白色橫線',f,[(-(W/2-.03),1.56),(-.96,1.56)],.075,'e4white')
 for yo,yi in [(.95,.64),(-1.20,-.99)]:
  for yy,red in [(yo,True),(yi,False)]:
   front_panel('圓形燈座',f,yy,1.22,.21,.21,'e4blue',.105,.035);lamp('圓燈',f,yy,1.22,.062,red=red)
 front_panel('頂部頭燈座',f,-.13,H-.19,.44,.24,'frame',.12,.03);front_panel('頂部橢圓頭燈',f,-.13,H-.19,.34,.16,'lamp',.08,.045)
 front_panel('車號白牌',f,-1.05,3.0,.34,.13,'e4white',.03,.035)
 text_label(s.get('label','EM410'),(f(-1.05,3.0)+.06,-1.05,3.0),.065)
 front_panel('行先牌',f,.84,3.04,.30,.12,'e4white',.06,.035)
 for yy,zz in [(-.62,3.20),(.58,3.18)]:front_panel('黃色警告小牌',f,yy,zz,.09,.11,'yellow',.01,.035)
 x0=f(0,.83);hazard(x0+.02,W,.58,.46)
 hose_cocks(x0+.04,W,.80,'e4blue')
 underfloor([-1.30,-.05,1.20],W)
 s['pantos']=0

BUILDERS['emu400']=emu400

# ── 台鐵經典客車 ────────────────────────────────────────────────────────────

def coach_end(x,end,W,mat='chassis'):
 """客車端牆：貫通門、端門窗、風琴折棚、兩顆紅色尾燈。"""
 use('07')
 panel('客車端牆貫通門',(x+end*.012,0,1.98),.74,1.72,mat,'front',r=.06)
 panel('端門玻璃',(x+end*.030,0,2.46),.42,.62,'glass','front',r=.04)
 for i in range(5):panel('風琴接合折線',(x+end*(.05+i*.045),0,2.00),1.04,1.89,'rubber','front',r=.13,depth=.022)
 for side in [-1,1]:
  cyl('客車尾燈',(x+end*.03,side*(W/2-.30),1.20),.055,.04,'red','X',20,.005)
  rod('端牆扶手',(x+end*.03,side*.62,1.05),(x+end*.03,side*.62,2.40),.014,'metal')

def fuhsing(s):
 """台鐵 20000 系復興號客車（40SP20000，1980–81 製，2022 退出定期營運）。參考：Commons 嘉義站 40SP20073T 側面（CC BY-SA 4.0）、
 40SPK21008T（附車長室型）、2016 後硐站整列（PD）。高拱灰色車頂；窗帶淺藍、窗下亮藍，兩端車門區整段亮藍，跟淺藍窗帶以斜線分界；
 六扇大窗配綠色窗簾，兩端各一組窄雙折門（門上兩個長圓小窗），端牆貫通門與風琴折棚；TR-50 轉向架。"""
 L,W,H=s['L'],s['W'],s['H']
 color('fsblue','2772CC',.06,.36,.28);color('fspale','A9BED4',.06,.38,.24);color('fsroof','8C9195',.25,.50,.08);color('fscurtain','3E8E6A',.02,.60,.05)
 profile=[(.83,L/2-.02),(1.00,L/2),(H-.30,L/2),(H,L/2-.10)]
 def roof(s,neck):
  use('05')
  for x in [-L*.36,L*.36]:
   box('低矮冷氣罩',(x,0,H+.07),(1.10,W*.50,.14),'fsroof',.05)
   for k in range(5):box('冷氣罩格柵',(x-.40+k*.20,0,H+.14),(.05,W*.36,.01),'chassis',.002)
  for x in [-L*.20,-L*.07,L*.07,L*.20]:
   cyl('圓形通風口',(x,0,H+.04),.17,.08,'fsroof',n=28,bevel=.03)
   cyl('通風口頂蓋',(x,0,H+.10),.20,.04,'fsroof',n=28,bevel=.015)
 s.update(doorXs=[-(L/2-.42),L/2-.42],doorW=.62,doorTop=H-.68,doorWinZ=2.28,doorWinH=.46,bottom=.86)
 f,neck,doors=railcar(s,profile,.0,[(1.96,'fsblue'),(H-.42,'fspale'),(H+1,'fsroof')],[(H-.42,'fsblue'),(H+1,'fsroof')],
  leaf='fsblue',crew=False,double=True,gaps=[0,0,0],roof=roof)
 for side in [-1,1]:
  y=side*(W/2+.018)
  # 兩端車門區整段亮藍，跟淺藍窗帶斜線分界（下緣離車端遠、上緣近）。
  for end in [-1,1]:
   xb=lambda z,end=end:end*(L/2-1.05+.25*(z-1.96)/(H-.42-1.96))
   a,b=(lambda z:xb(z),lambda z:end*(L/2-.03)) if end>0 else (lambda z:end*(L/2-.03),lambda z:xb(z))
   use('01');verts=[];cols,rows=4,8
   for i in range(rows+1):
    z=1.955+(H-.415-1.955)*i/rows
    for j in range(cols+1):x=a(z)+(b(z)-a(z))*j/cols;verts.append((x,side*(half_width(s,z)+.010),z))
   mesh('車端亮藍斜區',verts,[(i*(cols+1)+j,i*(cols+1)+j+1,(i+1)*(cols+1)+j+1,(i+1)*(cols+1)+j) for i in range(rows) for j in range(cols)],'fsblue',0,True)
  x0,x1,n,gap=-L/2+1.28,L/2-1.30,6,.22;w=(x1-x0-gap*(n-1))/n
  for i in range(n):
   xc=x0+w/2+i*(w+gap);sidewindow(xc,y,2.31,w-.04,.60,r=.07)
   for dx in [-1,1]:panel('綠色窗簾',(xc+dx*(w/2-.11),y+side*.030,2.31),.13,.56,'fscurtain',r=.02,depth=.006)
  panel('行先小牌',(L*.28,y+side*.004,1.62),.40,.11,'frame',r=.02,depth=.008)
  panel('車廂號碼白牌',(L/2-.88,y+side*.004,2.72),.09,.10,'white',r=.01,depth=.008)
  text_label(s.get('label','40SP20073'),(-L*.17,y+side*.012,1.50),.07,'side',side)
 for end in [-1,1]:coach_end(end*(L/2+.005),end,W,'fsblue')
 underfloor([-1.50,-.30,1.00],W)
 use('04');box('車底水箱',(1.60,0,.70),(.80,W*.50,.30),'chassis',.08)
 s['pantos']=0

BUILDERS['fuhsing']=fuhsing

def rivet_row(name,x0,x1,y,z,n,material,axis='Y',r=.018):
 """一排鉚釘：沿 x 從 x0 到 x1 共 n 顆，鉚釘頭朝 axis 方向。"""
 for i in range(n):cyl(name,(x0+(x1-x0)*i/max(1,n-1),y,z),r,.02,material,axis,8,0)

def sugar346(s):
 """台糖 346 號蒸汽機車（比利時 AFB 1948 製 0-6-0 水櫃機，762 mm 糖鐵，溪湖糖廠動態保存）。參考：Commons Industrial Wales 2020 斜前側
 （CC BY-SA 2.0）、2023 溪湖側面、溪湖觀光列車。消光黑車身，長而平的鉚釘側水櫃（側面紅底 346 號牌），鍋爐上兩座高圓筒圓頂，
 直筒煙囪頂上網罩火星擋，煙箱頂帶遮光罩的大頭燈、煙箱門紅底 346 牌與一圈螺栓；大紅鉚釘前緩衝樑配中央緩衝車鉤，
 紅色內側車架、三對小動輪與 Walschaerts 閥動，後方駕駛室側面開口與紅色扶手、圓角側窗，後面低矮煤櫃。"""
 L,W,H=s['L'],s['W'],s['H'];body='tsblack'
 color('tsblack','26292B',.30,.45,.12);color('tsred','B8281A',.10,.40,.22);color('tsmesh','17191A',.40,.55,.05)
 r=.38;axles=[1.00,.18,-.64];deck=.98
 use('04')
 for x in axles:
  cyl('動輪軸',(x,0,r),.07,W*.66,'chassis','Y',20)
  for side in [-1,1]:
   wheel(x,side*W*.33,r,spoked=True)
   cyl('曲柄銷',(x-.14,side*(W*.33+.15),r+.08),.045,.10,'metal','Y',16)
 for side in [-1,1]:
  yy=side*(W*.33+.21)
  rod('連結桿',(axles[0]-.14,yy,r+.08),(axles[2]-.14,yy,r+.08),.034,'metal')
  rod('主連桿',(1.55,yy+side*.03,.66),(axles[1]-.14,yy+side*.03,r+.08),.036,'metal')
  cyl('外置汽缸',(1.78,side*(W/2-.12),.66),.20,.56,body,'X',32)
  box('汽缸閥箱',(1.78,side*(W/2-.12),.92),(.50,.22,.22),body,.03)
  for dx in [-.28,.28]:cyl('汽缸蓋',(1.78+dx,side*(W/2-.12),.66),.18,.03,'metal','X',32)
  rod('十字頭滑桿',(1.48,yy+side*.03,.72),(.70,yy+side*.03,.72),.02,'metal')
  line('Walschaerts 閥動',[(axles[1],yy+side*.07,r+.02),(.45,yy+side*.07,.86),(1.40,side*(W/2-.10),.92)],.020,'metal')
  rod('閥動半徑桿',(.45,yy+side*.07,.86),(.45,yy+side*.07,1.10),.018,'metal')
  box('紅色內側車架',(.15,side*W*.22,.70),(3.20,.07,.42),'tsred',.02)
  box('水櫃前方紅色托架',(1.38,side*(W/2-.12),.86),(.14,.10,.36),'tsred',.02)
  for x in axles:box('軸箱',(x,side*W*.22,r),(.20,.12,.22),'tsred',.02)
 use('01');box('走行板',(-.05,0,deck),(L-.40,W*.96,.07),body,.02)
 # 鍋爐、煙箱、煙箱門。
 cabF=-.82;sb=1.50;bf=2.06;br=.46;bz=deck+.06+br
 cyl('圓筒鍋爐',((cabF+sb)/2,0,bz),br,sb-cabF,body,'X',56,.01)
 cyl('煙箱',((sb+bf)/2,0,bz),br+.06,bf-sb,body,'X',56,.01)
 cyl('煙箱前環',(bf+.01,0,bz),br+.07,.05,body,'X',56,.01)
 cyl('煙箱門',(bf+.05,0,bz),br-.02,.07,body,'X',56,.03)
 for i in range(16):
  a=2*math.pi*i/16;cyl('煙箱門螺栓',(bf+.04,(br+.03)*math.cos(a),bz+(br+.03)*math.sin(a)),.016,.03,'metal','X',8,0)
 box('煙箱門把手',(bf+.10,0,bz-.04),(.04,.30,.04),'metal',.01)
 for dz in [.24,-.24]:box('煙箱門鉸鏈',(bf+.07,-.32,bz+dz),(.05,.24,.06),body,.01)
 panel('煙箱門號牌金框',(bf+.09,0,bz+.24),.36,.18,'gold','front',r=.02,depth=.01)
 panel('煙箱門號牌',(bf+.10,0,bz+.24),.32,.14,'tsred','front',r=.015,depth=.01)
 text_label(s.get('label','346'),(bf+.11,0,bz+.24),.10)
 box('煙箱下座',((sb+bf)/2,0,deck+.20),(bf-sb,W*.40,.40),body,.02)
 # 直筒煙囪與網罩火星擋。
 use('05');cx=(sb+bf)/2+.02;tz=bz+br+.06
 cyl('煙囪座',(cx,0,tz),.20,.10,body,n=32)
 cyl('直筒煙囪',(cx,0,tz+.40),.14,.74,body,n=32)
 cyl('網罩箍',(cx,0,tz+.78),.20,.04,body,n=32)
 cyl('網罩火星擋',(cx,0,tz+.98),.19,.38,'tsmesh',n=32)
 for i in range(12):a=2*math.pi*i/12;rod('網罩骨',(cx+.195*math.cos(a),.195*math.sin(a),tz+.80),(cx+.195*math.cos(a),.195*math.sin(a),tz+1.16),.008,body)
 cyl('網罩頂環',(cx,0,tz+1.18),.20,.03,body,n=32)
 # 煙箱頂大頭燈與遮光罩。
 hx=bf-.02;hz=bz+br+.16
 box('頭燈座',(hx-.08,0,bz+br+.02),(.20,.18,.10),body,.02)
 cyl('大頭燈燈殼',(hx,0,hz),.15,.24,body,'X',28)
 lamp('大頭燈',lambda y,z:hx+.04,0,hz,.11)
 use('03');verts=[]
 for i in range(13):
  a=math.pi*i/12;verts+=[(hx+.08,.18*math.cos(a),hz+.18*math.sin(a)),(hx+.30,.20*math.cos(a),hz+.20*math.sin(a))]
 mesh('頭燈遮光罩',verts,[(2*i,2*i+1,2*i+3,2*i+2) for i in range(12)],body,0,True);m=p.MODEL[-1].modifiers.new('遮光罩厚度','SOLIDIFY');m.thickness=.02
 # 兩座高圓筒圓頂與安全閥、汽笛。
 use('05')
 for x,name in [(.92,'汽室圓頂'),(.10,'砂箱圓頂')]:
  cyl(name+'基座',(x,0,bz+br-.04),.24,.14,body,n=36,bevel=.03)
  cyl(name,(x,0,bz+br+.24),.20,.50,body,n=36,bevel=.07)
 cyl('安全閥座',(cabF+.24,0,bz+br+.02),.12,.10,body,n=24)
 for dy in [-.05,.05]:rod('安全閥',(cabF+.24,dy,bz+br+.06),(cabF+.24,dy,bz+br+.26),.03,'metal')
 rod('黃銅汽笛',(cabF+.14,.14,bz+br),(cabF+.14,.14,bz+br+.34),.025,'gold')
 cyl('汽笛頂',(cabF+.14,.14,bz+br+.36),.04,.05,'gold',n=12)
 for side in [-1,1]:
  line('蒸汽管',[(cabF+.10,side*.22,bz+br-.04),(.50,side*(br+.02),bz+.30),(1.40,side*(br+.06),bz+.10)],.022,body)
  line('鍋爐扶手',[(cabF+.10,side*(br+.10),bz+.32),(1.40,side*(br+.10),bz+.32)],.012,'metal')
 # 長而平的側水櫃：鉚釘邊、紅底號牌。
 tx0,tx1=cabF+.02,1.36;tz0,tz1=deck+.04,bz+.30
 for side in [-1,1]:
  yt=side*(W/2-.28)
  box('側水櫃',((tx0+tx1)/2,yt,(tz0+tz1)/2),(tx1-tx0,.54,tz1-tz0),body,.04)
  for z in [tz0+.06,tz1-.06]:rivet_row('水櫃鉚釘',tx0+.05,tx1-.05,side*(W/2-.005),z,16,body)
  for x in [tx0+.05,tx1-.05]:
   for k in range(5):cyl('水櫃鉚釘',(x,side*(W/2-.005),tz0+.16+k*(tz1-tz0-.32)/4),.018,.02,body,'Y',8,0)
  panel('水櫃號牌',(.25,side*(W/2+.006),(tz0+tz1)/2+.08),.24,.16,'tsred',r=.015,depth=.01)
  text_label(s.get('label','346'),(.25,side*(W/2+.014),(tz0+tz1)/2+.08),.09,'side',side)
  panel('水櫃標示小牌',(.75,side*(W/2+.006),tz0+.14),.24,.08,'white',r=.01,depth=.008)
  cyl('水櫃注水口',(tx1-.20,yt,tz1+.03),.08,.06,body,n=16)
 # 駕駛室：前側圓角窗、側面開口與紅色扶手、拱頂外伸、後方低煤櫃。
 cabR=-2.12;ch=H-.18;cw=W*.96
 box('駕駛室前牆',(cabF-.04,0,(deck+ch)/2),(.08,cw,ch-deck),body,.02)
 for side in [-1,1]:
  panel('前牆小方窗',(cabF+.005,side*.70,ch-.50),.30,.34,'glass','front',r=.05)
  yy=side*cw/2
  box('駕駛室側牆前段',(cabF-.30,yy,(deck+ch)/2),(.56,.06,ch-deck),body,.02)
  panel('側牆圓角窗框',(cabF-.30,yy+side*.040,ch-.58),.42,.42,'frame',r=.09,depth=.02)
  panel('側牆圓角窗',(cabF-.30,yy+side*.052,ch-.58),.34,.34,'glass',r=.08,depth=.01)
  # 照片：側面後半是落地開口，紅色細框沿開口三邊。
  ox0,ox1,oz=cabR+.20,cabF-.58,ch-.20
  for x in [ox0+.02,ox1-.02]:box('開口紅色細框',(x,yy+side*.036,(deck+oz)/2),(.04,.012,oz-deck),'tsred',.004)
  box('開口紅色細框',((ox0+ox1)/2,yy+side*.036,oz-.02),(ox1-ox0,.012,.04),'tsred',.004)
  box('駕駛室側牆後柱',(cabR+.10,yy,(deck+ch)/2),(.20,.06,ch-deck),body,.02)
  box('駕駛室側牆上楣',((cabF+cabR)/2,yy,ch-.10),(cabF-cabR,.06,.20),body,.02)
  for x in [ox1+.06,ox0-.06]:rod('紅色扶手',(x,yy+side*.06,deck+.15),(x,yy+side*.06,ch-.40),.018,'tsred')
  panel('廠徽紅牌',(cabR+.10,yy+side*.035,deck+.75),.16,.16,'tsred',r=.08,depth=.01)
  for z in [.62,.82]:box('登車踏階',(cabF-.95,side*W*.47,z),(.30,.18,.03),'metal',.006)
  for dx in [-.13,.13]:box('踏階吊架',(cabF-.95+dx,side*W*.47,.82),(.03,.03,.44),'metal',0)
 use('05');roofv=[];n=10
 for i in range(n+1):
  tt=i/n;y=(tt-.5)*(W+.12);z=ch+.12*math.cos((tt-.5)*math.pi)
  roofv+=[(cabF+.10,y,z),(cabR-.10,y,z)]
 mesh('拱頂駕駛室屋頂',roofv,[(2*i,2*i+1,2*i+3,2*i+2) for i in range(n)],body,0,True);m=p.MODEL[-1].modifiers.new('屋頂厚度','SOLIDIFY');m.thickness=.05
 box('屋頂通風窗',((cabF+cabR)/2,0,ch+.16),(.50,.36,.08),body,.02)
 box('駕駛室後牆',(cabR-.03,0,(deck+ch)/2+.30),(.06,cw,ch-deck-.60),body,.02)
 for side in [-1,1]:panel('後牆小窗',(cabR-.065,side*.55,ch-.45),.26,.26,'glass','front',r=.04)
 box('後方煤櫃',(cabR-.30,0,deck+.38),(.50,cw*.90,.76),body,.03)
 # 前後大紅鉚釘緩衝樑、中央緩衝車鉤。
 for end in [-1,1]:
  x=end*(L/2-.12)
  use('07');box('紅色鉚釘緩衝樑',(x,0,.80),(.16,W*1.0,.46),'tsred',.02)
  box('緩衝樑下緣',(x,0,.55),(.16,W*.90,.06),'tsred',.01)
  for z in [.64,.96]:
   for i in range(10):cyl('緩衝樑鉚釘',(x+end*.085,-W*.44+i*W*.88/9,z),.018,.02,'tsred','X',8,0)
  box('中央緩衝座',(x+end*.12,0,.78),(.12,.40,.20),'chassis',.02)
  box('緩衝車鉤頭',(x+end*.22,0,.78),(.10,.26,.16),'metal',.03)
  rod('車鉤銷',(x+end*.24,0,.70),(x+end*.24,0,.90),.016,'metal')
  rod('緩衝樑扶手',(x+end*.10,-W*.42,1.10),(x+end*.10,W*.42,1.10),.014,'metal')
 s['drivers']=3;s['axles']=3;s['tank']=True

BUILDERS['sugar346']=sugar346

# ── 台鐵經典機車 ────────────────────────────────────────────────────────────

def e100(s):
 """台鐵 E100 型電力機車（英國 GEC 設計、1976 製，2007 退役，E101 指定保存）。參考：Commons 2007 彰化機務分段 E101 正面、
 彰化站 E100 群側面（CC BY-SA 2.0）、國家鐵道博物館 E101 斜前。照 2007 年 E101 正面：奶油色上半、橘色下半，奶油色寬 V 帶從車角彎到中央下緣；
 外伸屋簷、中央長方頭燈箱兩側各一支氣笛，兩扇圓角擋風，下緣紅色尾燈與橘色扶手、黃黑警戒緩衝樑與黑色排障器。
 兩端駕駛室同形：側面一扇橢圓窗車門與一扇側窗，中段機器室四組直條百葉；車頂兩具集電弓，Bo-Bo 轉向架。"""
 L,W,H=s['L'],s['W'],s['H']
 color('e1cream','DCC488',.05,.40,.22);color('e1orange','D8400E',.05,.36,.30);color('e1roof','8E9497',.30,.45,.10)
 profile=[(1.15,L/2-.02),(1.30,L/2),(H-.10,L/2),(H,L/2-.08)]
 bz=2.24
 f,neck=zoned_shell(s,profile,.04,[(bz,'e1orange'),(H-.08,'e1cream'),(H+1,'e1roof')],[(bz,'e1orange'),(H+1,'e1cream')],double=True)
 start=len(p.MODEL)
 # ── 一端車頭（+X），做完旋轉複製到另一端 ──
 use('03');box('外伸屋簷',(L/2-.02,0,H-.03),(.30,W*.98,.07),'e1cream',.035)
 for side in [-1,1]:
  front_panel('擋風黑框',f,side*.74,2.645,.94,.73,'frame',.11,.03)
  front_glass(f,[(side*.74-.43,side*.74+.43,'圓角擋風')],2.32,2.97,offset=.045,r=.10)
  wiper(f,side*(.74+.30),2.34,.56)
  # 氣笛：屋簷下、頭燈箱兩側的小喇叭。
  y=side*.52;x=f(y,3.30)+.08
  cyl('氣笛座',(x-.05,y,3.30),.04,.10,'e1cream','X',16);cyl('氣笛喇叭',(x+.06,y,3.30),.085,.12,'e1cream','X',24);cyl('氣笛口',(x+.125,y,3.30),.07,.01,'frame','X',24,0)
  yl=side*1.20;front_panel('尾燈座',f,yl,1.34,.24,.24,'e1orange',.12,.035);lamp('紅色尾燈',f,yl,1.34,.07,red=True)
  for yy,zz,w in [(side*.70,2.17,.70),(side*1.05,1.72,.28)]:front_ribbon('橘色扶手',f,[(yy-w/2,zz),(yy+w/2,zz)],.026,'e1orange')
 front_panel('頭燈箱',f,0,3.26,.56,.36,'e1cream',.04,.06)
 front_panel('頭燈橢圓框',f,0,3.26,.46,.24,'frame',.12,.075);front_panel('頭燈',f,0,3.26,.38,.18,'lamp',.09,.085)
 front_panel('窗間把手',f,0,2.88,.36,.04,'e1cream',.02,.04)
 pts=[(yy,1.22+.86*(abs(yy)/(W/2))**1.35) for yy in [-(W/2-.02)+i*(W-.04)/24 for i in range(25)]]
 front_ribbon('奶油色 V 帶',f,pts,.15,'e1cream')
 text_label(s.get('label','E101'),(f(0,2.08)+.06,0,2.08),.12)
 for yy,zz in [(-.45,1.95),(.0,1.86),(.42,2.06)]:front_panel('跳線插座',f,yy,zz,.16,.20,'e1orange',.03,.06)
 # 跳線軟管從插座垂成 U 字再接回中央插座。
 line('跳線軟管',[(f(yy,zz)+.10,yy,zz) for yy,zz in [(.42,1.94),(.38,1.46),(.24,1.28),(.10,1.40),(0,1.76)]],.022,'rubber')
 hazard(L/2+.02,W,.86,.56)
 use('07');box('黑色排障器',(L/2+.05,0,.43),(.14,W*.72,.30),'frame',.05)
 coupler(L/2+.10,W,1,z=.78)
 for side in [-1,1]:box('端梁踏階',(L/2+.06,side*(W/2-.20),.62),(.20,.26,.03),'metal',.005)
 # 駕駛室側面：側窗、橢圓窗車門、扶手與踏階。
 for side in [-1,1]:
  y=side*(W/2+.018)
  sidewindow(L/2-.55,y,2.64,.44,.52,r=.10)
  xd=L/2-1.12;dt=H-.38
  use('02');panel('車門門縫',(xd,y-side*.006,(1.22+dt)/2),.54,dt-1.22,'frame',r=.04,depth=.012)
  panel('車門上半',(xd,y+side*.004,(bz+dt)/2),.48,dt-bz,'e1cream',r=.03,depth=.016)
  panel('車門下半',(xd,y+side*.004,(1.26+bz)/2),.48,bz-1.26,'e1orange',r=.03,depth=.016)
  panel('車門橢圓窗框',(xd,y+side*.016,2.66),.28,.48,'frame',r=.14,depth=.01)
  panel('車門橢圓窗',(xd,y+side*.022,2.66),.22,.42,'glass',r=.11,depth=.01)
  for dx in [-.34,.34]:rod('車門扶手',(xd+dx,y+side*.05,1.30),(xd+dx,y+side*.05,2.40),.016,'metal')
  for z in [.70,.95]:box('車門踏階',(xd,side*(W/2-.06),z),(.44,.16,.03),'metal',.005)
  for dx in [-.20,.20]:box('踏階吊架',(xd+dx,side*(W/2-.06),.96),(.03,.03,.52),'metal',0)
 copy_rotated(list(p.MODEL[start:]))
 # ── 中段：機器室百葉、車架、車頂、轉向架 ──
 for side in [-1,1]:
  for x in [-1.62,-.54,.54,1.62]:grille('機器室直條百葉',x,side*(W/2+.012),2.70,.82,.64,True,12,True)
  for x in [-1.08,1.08]:panel('機器室小窗',(x,side*(W/2+.018),2.70),.26,.30,'glass',r=.05,depth=.012)
  box('車架側樑',(0,side*(W/2-.10),1.06),(L-.20,.10,.18),'chassis',.02)
 use('05')
 for x in [-1.55,1.55]:pantograph(x,H)
 box('主斷路器箱',(0,0,H+.10),(.80,.70,.20),'e1roof',.04)
 for x in [-.95,.95]:
  for y in [-.30,.30]:cyl('車頂瓷瓶',(x,y,H+.10),.06,.20,'cream',n=16)
 rod('車頂高壓母線',(-1.55,0,H+.36),(1.55,0,H+.36),.018,'metal')
 box('車頂步道',(0,W*.30,H+.02),(L-1.2,.30,.03),'chassis',.004)
 bogies(L,W,axles=2,r=.44,centers=[-L*.29,L*.29])
 use('04');box('主變壓器',(0,0,.78),(1.60,W*.62,.44),'chassis',.05)
 for k in range(6):box('變壓器散熱鰭',(-.65+k*.26,W*.31,.78),(.06,.02,.34),'metal',.004)
 s['pantos']=2;s['axles']=2

BUILDERS['e100']=e100

def knuckle_coupler(x,end,z,mat='metal'):
 """自動（關節式）車鉤：鉤身、鉤頭與往側面彎的關節。"""
 use('07')
 box('自動車鉤鉤身',(x+end*.14,0,z),(.28,.16,.14),'chassis',.02)
 box('自動車鉤鉤頭',(x+end*.32,.02,z),(.14,.28,.26),mat,.03)
 cyl('自動車鉤關節',(x+end*.40,-.12,z),.07,.24,mat,'Z',16)
 rod('車鉤解放桿',(x+end*.06,-.10,z+.20),(x+end*.06,-.55,z+.30),.014,'metal')

def ck101(s):
 """台鐵 CK101（CK100 型，日本汽車製造 1917 年製 2-6-2 水櫃機，1998 年復駛）。參考：Commons Kazehayashi 1998 年後集集線運轉照
 （CC BY-SA 4.0）、Chi-Hung Lin 2014 彰化扇形車庫正面（CC BY 2.0）、Cheng-en Cheng 2007 斜側與 2010 轉車台側面（CC BY-SA 2.0）；尺寸 zh.wikipedia 資訊框（長 11,405、寬 2,616、高 3,658）。
 照復駛運轉時的樣子：消光黑車身，煙箱門一圈門扣、中央手輪、紅底金框 CK101 號牌，煙囪前方煙箱頂大頭燈、直筒煙囪；
 緊跟在煙囪後的大汽室圓頂與第二座圓頂；水櫃從第二座圓頂起到駕駛室前（側面紅色號牌），左側（+Y）水櫃前方走行板上立著空氣壓縮機；
 走行板在第一動輪前往下彎成較低的前甲板（邊緣黃線），前甲板上黃銅注油器、扶手與信號燈柱；駕駛室金框圓窗與拱窗；
 前端黃黑斜紋緩衝樑、自動車鉤、紅色煞車軟管與紅色直柵排障器；三對 125 cm 輻條動輪（白色輪緣線、紅色連結桿）、前後各一軸小輪、Walschaerts 閥動。"""
 L,W,H=s['L'],s['W'],s['H'];body='ckblack'
 color('ckblack','1E2022',.30,.46,.12);color('ckred','B8281A',.10,.40,.22)
 r=.56;axles=[.95,-.23,-1.41];deck=1.46;fdeck=1.24;xd=1.60;lead,trail=2.62,-2.50
 use('04')
 for x in axles:
  cyl('動輪軸',(x,0,r),.08,W*.70,'chassis','Y',20)
  for side in [-1,1]:
   wheel(x,side*W*.36,r,spoked=True)
   torus_y('白色輪緣線',(x,side*(W*.36+.048),r),r-.05,.014,'white',n=40,m=6)
   cyl('曲柄銷',(x-.16,side*(W*.36+.15),r+.10),.05,.10,'metal','Y',16)
   box('煞車蹄',(x+r+.05,side*W*.36,r-.05),(.08,.10,.36),'chassis',.02)
 for x in [lead,trail]:
  cyl('導輪從輪軸',(x,0,.34),.06,W*.62,'chassis','Y',16)
  for side in [-1,1]:
   wheel(x,side*W*.31,.34,spoked=True);torus_y('白色輪緣線',(x,side*(W*.31+.048),.34),.29,.012,'white',n=32,m=6)
 for side in [-1,1]:
  yy=side*(W*.36+.21)
  rod('紅色連結桿',(axles[0]-.16,yy,r+.10),(axles[2]-.16,yy,r+.10),.038,'ckred')
  rod('主連桿',(1.62,yy+side*.04,.94),(axles[1]-.16,yy+side*.04,r+.10),.040,'metal')
  rod('十字頭滑桿',(1.62,yy+side*.04,1.04),(.72,yy+side*.04,1.04),.022,'metal')
  cyl('外置汽缸',(2.02,side*(W/2-.15),.92),.23,.72,body,'X',32)
  box('汽缸閥箱',(2.02,side*(W/2-.17),1.12),(.64,.26,.18),body,.03)
  for dx in [-.37,.37]:cyl('汽缸蓋',(2.02+dx,side*(W/2-.15),.92),.21,.03,'metal','X',32)
  line('Walschaerts 閥動',[(axles[1],yy+side*.09,r+.02),(.40,yy+side*.09,1.10),(1.66,side*(W/2-.12),1.12)],.022,'metal')
  rod('閥動半徑桿',(.40,yy+side*.09,1.10),(.40,yy+side*.09,1.30),.020,'metal')
  rod('逆轉桿',(.40,side*(W/2-.05),1.30),(-1.55,side*(W/2-.05),1.62),.018,'metal')
  box('內側車架',(0,side*W*.24,.86),(5.40,.08,.46),body,.02)
  for x in axles:box('軸箱',(x,side*W*.24,r),(.24,.14,.24),body,.02)
  for x in axles:
   # 動輪擋泥罩：走行板下的半圓鐵皮。
   verts=[];n=12
   for i in range(n+1):
    a=math.pi*i/n;verts+=[(x+(r+.06)*math.cos(a),side*(W*.36-.07),r+(r+.06)*math.sin(a)),(x+(r+.06)*math.cos(a),side*(W*.36+.07),r+(r+.06)*math.sin(a))]
   mesh('動輪擋泥罩',verts,[(2*i,2*i+1,2*i+3,2*i+2) for i in range(n)],body,0,True);m=p.MODEL[-1].modifiers.new('擋泥罩厚度','SOLIDIFY');m.thickness=.02
 # 照片：走行板在第一動輪前往下彎成較低的前甲板，邊緣一條黃線跟著彎。
 use('01');x0=-L/2+.15;box('走行板',((x0+xd)/2,0,deck),(xd-x0,W*.98,.07),body,.02)
 box('前甲板',((xd+.30+L/2-.04)/2,0,fdeck),(L/2-.04-xd-.30,W*.98,.07),body,.02)
 prof=[(xd+.30*k/8,deck+(fdeck-deck)*(1-math.cos(math.pi*k/8))/2) for k in range(9)];v=[]
 for x_,z_ in prof:v+=[(x_,-W*.49,z_),(x_,W*.49,z_)]
 mesh('走行板下彎段',v,[(2*i,2*i+1,2*i+3,2*i+2) for i in range(8)],body,0,True);m=p.MODEL[-1].modifiers.new('下彎段厚度','SOLIDIFY');m.thickness=.07
 for side in [-1,1]:
  box('走行板黃線',((x0+xd)/2,side*(W*.49+.004),deck),(xd-x0-.04,.010,.035),'yellow',.002)
  box('前甲板黃線',((xd+.30+L/2-.04)/2,side*(W*.49+.004),fdeck),(L/2-.08-xd-.30,.010,.035),'yellow',.002)
  line('下彎段黃線',[(x_,side*(W*.49+.004),z_-.02) for x_,z_ in prof],.012,'yellow')
 # 鍋爐、煙箱、煙箱門。
 cabF=-1.55;sb=2.30;bf=3.02;br=.60;bz=2.18
 cyl('圓筒鍋爐',((cabF+sb)/2,0,bz),br,sb-cabF,body,'X',64,.01)
 for x in [cabF+.50,-.10,.90,1.85]:cyl('鍋爐箍環',(x,0,bz),br+.012,.035,'chassis','X',64,.004)
 cyl('煙箱',((sb+bf)/2,0,bz),br+.06,bf-sb,body,'X',64,.01)
 for i in range(18):
  a=2*math.pi*i/18;cyl('煙箱鉚釘',(sb+.06,(br+.06)*math.cos(a),bz+(br+.06)*math.sin(a)),.018,.03,'chassis','X',8,0)
 cyl('煙箱前環',(bf+.02,0,bz),br+.07,.05,body,'X',64,.01)
 cyl('煙箱門',(bf+.06,0,bz),br-.02,.08,body,'X',64,.03)
 for i in range(12):
  # 照片：煙箱門外圈一圈門扣。
  a=2*math.pi*(i+.5)/12;yy=(br+.02)*math.cos(a);zz=bz+(br+.02)*math.sin(a)
  box('煙箱門扣',(bf+.07,yy,zz),(.05,.07,.07),body,.01)
 handwheel(bf+.14,0,bz-.04,.11,'ckred')
 box('煙箱門把手',(bf+.12,.20,bz-.18),(.04,.30,.04),'metal',.01)
 panel('煙箱門號牌金框',(bf+.11,0,bz+.30),.58,.22,'gold','front',r=.02,depth=.01)
 panel('煙箱門號牌',(bf+.12,0,bz+.30),.54,.18,'ckred','front',r=.015,depth=.01)
 text_label(s.get('label','CK101'),(bf+.13,0,bz+.30),.12)
 box('煙箱下座',((sb+bf)/2,0,(fdeck+bz-br+.10)/2),(bf-sb,W*.38,bz-br+.10-fdeck),body,.02)
 # 直筒煙囪與煙箱頂大頭燈。
 use('05');cx=2.58;tz=bz+br+.04
 cyl('煙囪座',(cx,0,tz+.02),.24,.12,body,n=36,bevel=.03)
 cyl('直筒煙囪',(cx,0,tz+.40),.17,.72,body,n=36)
 cyl('煙囪口緣',(cx,0,tz+.78),.21,.08,body,n=36,bevel=.02)
 hx=bf-.08;hz=bz+br+.24
 box('頭燈座',(hx-.04,0,bz+br+.04),(.24,.24,.12),body,.02)
 box('頭燈燈殼',(hx,0,hz),(.30,.34,.30),body,.05)
 lamp('大頭燈',lambda y,z:hx+.08,0,hz,.12)
 box('頭燈頂蓋',(hx-.02,0,hz+.17),(.32,.30,.04),body,.01)
 # 兩座圓頂、安全閥、汽笛。
 # 照片：大汽室圓頂緊跟在煙囪後，第二座圓頂在水櫃前端上方。
 for x,name,rr,hh in [(1.98,'汽室圓頂',.29,.44),(.80,'砂箱圓頂',.25,.34)]:
  cyl(name+'基座',(x,0,bz+br-.04),rr+.05,.14,body,n=40,bevel=.03)
  cyl(name,(x,0,bz+br+hh/2),rr,hh,body,n=40,bevel=.11)
 cyl('安全閥座',(cabF+.32,0,bz+br+.02),.13,.10,body,n=24)
 for dy in [-.06,.06]:rod('安全閥',(cabF+.32,dy,bz+br+.06),(cabF+.32,dy,bz+br+.30),.032,'metal')
 rod('黃銅汽笛',(cabF+.14,-.20,bz+br-.02),(cabF+.14,-.20,bz+br+.36),.026,'gold')
 cyl('汽笛頂',(cabF+.14,-.20,bz+br+.38),.045,.05,'gold',n=12)
 for side in [-1,1]:
  line('砂管',[(.80,side*.22,bz+br),(.80,side*(br+.08),bz+.10),(axles[0]+.62,side*W*.36,deck-.05),(axles[0]+.62,side*W*.36,r-.10)],.020,body)
  line('鍋爐扶手',[(cabF+.10,side*(br+.10),bz+.30),(sb+.10,side*(br+.10),bz+.30)],.014,'metal')
  line('注水器彎管',[(cabF+.10,side*(br+.06),bz+.04),(-.40,side*(br+.10),bz-.18),(.20,side*(W/2-.62),deck+.10)],.032,body)
 # 煙箱後到駕駛室前的兩側長水櫃：鉚釘邊、前角黃色小牌、頂部注水口。
 tx0,tx1=cabF+.02,1.20;tz0,tz1=deck+.04,2.58
 for side in [-1,1]:
  yt=side*(W/2-.29)
  box('側水櫃',((tx0+tx1)/2,yt,(tz0+tz1)/2),(tx1-tx0,.56,tz1-tz0),body,.04)
  for z in [tz0+.06,tz1-.06]:rivet_row('水櫃鉚釘',tx0+.06,tx1-.06,side*(W/2-.005),z,22,body)
  for x in [tx0+.06,tx1-.06]:
   for k in range(6):cyl('水櫃鉚釘',(x,side*(W/2-.005),tz0+.16+k*(tz1-tz0-.32)/5),.018,.02,body,'Y',8,0)
  panel('水櫃前角黃牌',(tx1+.006,side*(W/2-.10),tz1-.20),.12,.14,'yellow','front',r=.01,depth=.008)
  panel('水櫃號牌金框',(-.70,side*(W/2+.006),tz1-.34),.62,.24,'gold',r=.02,depth=.01)
  panel('水櫃號牌',(-.70,side*(W/2+.016),tz1-.34),.56,.18,'ckred',r=.015,depth=.01)
  text_label(s.get('label','CK101'),(-.70,side*(W/2+.026),tz1-.34),.12,'side',side)
  cyl('水櫃注水口',(tx1-.30,yt,tz1+.04),.10,.08,body,n=20)
  box('水櫃頂蓋',(tx1-.30,yt,tz1+.09),(.24,.24,.03),body,.01)
 # 左側（+Y）走行板上的空氣壓縮機與黃銅注油器（兩張照片都在同一側）。
 use('05');px,py=1.40,W/2-.22
 cyl('空氣壓縮機汽缸',(px,py,deck+.72),.15,.40,body,n=28,bevel=.02)
 cyl('空氣壓縮機風缸',(px,py,deck+.30),.17,.40,body,n=28,bevel=.02)
 for z in [deck+.10,deck+.51,deck+.93]:cyl('壓縮機法蘭',(px,py,z),.19,.04,body,n=28)
 line('壓縮機管路',[(px,py-.12,deck+.85),(px-.30,py-.20,deck+.95),(tx1+.02,py-.30,bz+.20)],.022,body)
 box('黃銅注油器',(bf-.06,W/2-.24,fdeck+.24),(.20,.16,.30),'gold',.03)
 rod('注油器油管',(bf-.06,W/2-.24,fdeck+.06),(2.02,W/2-.15,1.10),.012,'gold')
 # 前方走行板：橫向扶手與兩支信號燈柱。
 rod('前方橫向扶手',(bf+.20,-W*.36,fdeck+.48),(bf+.20,W*.36,fdeck+.48),.016,'metal')
 for y in [-W*.36,W*.36]:rod('扶手立柱',(bf+.20,y,fdeck+.04),(bf+.20,y,fdeck+.48),.016,'metal')
 for y in [-W*.43,W*.43]:rod('信號燈柱',(L/2-.30,y,fdeck+.04),(L/2-.30,y,fdeck+.86),.020,'metal')
 # 駕駛室：側面前方圓角窗、後段入口開口、拱頂外伸；後方煤櫃。
 cabR=-2.78;ch=H-.22;cw=W*.98
 box('駕駛室前牆',(cabF-.04,0,(tz1+ch)/2),(.08,cw,ch-tz1),body,.02)
 for side in [-1,1]:
  panel('前牆圓窗',(cabF+.005,side*.52,ch-.40),.32,.32,'glass','front',r=.15)
  panel('前牆圓窗金框',(cabF,side*.52,ch-.40),.40,.40,'gold','front',r=.19,depth=.01)
  yy=side*cw/2
  box('駕駛室側牆前段',(cabF-.30,yy,(deck+ch)/2),(.56,.06,ch-deck),body,.02)
  # 照片：駕駛室側面是金框拱頂窗。
  panel('側牆拱窗金框',(cabF-.30,yy+side*.040,ch-.56),.44,.52,'gold',r=.20,depth=.02)
  panel('側牆拱窗',(cabF-.30,yy+side*.052,ch-.56),.36,.44,'glass',r=.17,depth=.01)
  box('駕駛室側牆下段',(cabF-.84,yy,deck+.42),(.52,.06,.84),body,.02)
  box('駕駛室側牆後段',(cabR+.22,yy,(deck+ch)/2),(.44,.06,ch-deck),body,.02)
  panel('側牆後窗金框',(cabR+.22,yy+side*.040,ch-.56),.34,.46,'gold',r=.15,depth=.01)
  panel('側牆後窗',(cabR+.22,yy+side*.050,ch-.56),.28,.40,'glass',r=.13,depth=.01)
  box('駕駛室側牆上楣',((cabF+cabR)/2,yy,ch-.10),(cabF-cabR,.06,.20),body,.02)
  for x in [cabF-.60,cabR+.48]:rod('登車扶手',(x,yy+side*.06,deck+.10),(x,yy+side*.06,ch-.40),.018,'metal')
  for z in [.62,.92]:box('登車踏階',(cabF-.84,side*W*.47,z),(.34,.20,.035),'metal',.006)
  for dx in [-.15,.15]:box('踏階吊架',(cabF-.84+dx,side*W*.47,.94),(.03,.03,.40),'metal',0)
 use('05');roofv=[];n=10
 for i in range(n+1):
  tt=i/n;y=(tt-.5)*(W+.14);z=ch+.12*math.cos((tt-.5)*math.pi)
  roofv+=[(cabF+.14,y,z),(cabR-.12,y,z)]
 mesh('拱頂駕駛室屋頂',roofv,[(2*i,2*i+1,2*i+3,2*i+2) for i in range(n)],body,0,True);m=p.MODEL[-1].modifiers.new('屋頂厚度','SOLIDIFY');m.thickness=.05
 box('屋頂通風窗',((cabF+cabR)/2,0,ch+.16),(.54,.40,.08),body,.02)
 box('駕駛室後牆',(cabR-.03,0,(deck+ch)/2+.40),(.06,cw,ch-deck-.80),body,.02)
 for side in [-1,1]:panel('後牆小窗',(cabR-.065,side*.55,ch-.42),.28,.28,'glass','front',r=.04)
 bx0,bx1=cabR-.02,-L/2+.16
 box('後方煤櫃',((bx0+bx1)/2,0,deck+.62),(bx0-bx1,cw*.94,1.24),body,.03)
 for i in range(14):
  box('煤堆塊',(bx1+.10+(i%4)*.11,-.62+(i//4)*.40,deck+1.26+.04*math.sin(i*2.3)),(.16,.30,.10),'chassis',.04)
 for side in [-1,1]:rivet_row('煤櫃鉚釘',bx1+.06,bx0-.06,side*(cw*.47+.005),deck+1.18,6,body)
 panel('煤櫃後號牌',(bx1-.005,0,deck+.70),.58,.22,'ckred','front',r=.015)
 # 前端：黃黑斜紋緩衝樑、自動車鉤、紅色煞車軟管、紅色直柵排障器；後端黑色緩衝樑。
 for end in [-1,1]:
  x=end*(L/2-.12)
  use('07');box('緩衝樑',(x,0,1.02),(.16,W*1.0,.46),body,.02)
  knuckle_coupler(x+end*.08,end,.98,'chassis')
  rod('緩衝樑扶手',(x+end*.10,-W*.42,1.30),(x+end*.10,W*.42,1.30),.014,'metal')
  # 照片：只有一條煞車軟管，從車鉤右下垂到排障器，旋塞漆紅。
  line('煞車軟管',[(x+end*.12,.28,.84),(x+end*.20,.26,.60),(x+end*.16,.10,.42)],.026,'rubber')
  cyl('軟管旋塞',(x+end*.12,.28,.86),.035,.10,'ckred','Z',12)
 x=L/2-.12;hazard(x+.08,W,1.02,.42)
 use('03');px0,pz0,px1,pz1=x+.04,.78,x+.14,.18
 for z_,x_ in [(pz0,px0),(pz1,px1)]:box('排障器橫框',(x_,0,z_),(.06,W*.78,.06),'ckred',.01)
 for k in range(13):
  y=-W*.37+k*W*.74/12;rod('排障器直柵',(px0,y,pz0),(px1,y,pz1),.022,'ckred')
 for y in [-W*.39,W*.39]:rod('排障器側框',(px0,y,pz0+.02),(px1,y,pz1),.030,'ckred')
 s['drivers']=3;s['axles']=5;s['tank']=True

BUILDERS['ck101']=ck101

def guanguang(s):
 """台鐵觀光號餐車 35DC32751（32750 系，日本車輛 1960 年製；觀光號 1961–1978 營運，唯一保存的觀光號車廂，國家鐵道博物館修復）。
 參考：Commons 鐵路1 臺北機廠側面（CC BY-SA 4.0）、1978-04-25 臺灣新生報停駛日兩張（GWOIA）。白底紅啞鈴：車門端整段紅色，
 上下各以圓角收成窗下一條紅腰帶，貫穿到另一端的窄紅端；高拱銀灰車頂、車端圓肩；只有一端一組紅色雙折門（門扇各一個長圓窗），
 餐車側窗大小不一（車門端幾扇大窗、另一半四扇較小的窗）；車底水箱與發電機箱。"""
 L,W,H=s['L'],s['W'],s['H']
 color('ggwhite','ECE6D6',.04,.36,.28);color('ggred','A8121C',.06,.36,.28);color('ggroof','9A9EA2',.25,.50,.08)
 profile=[(.83,L/2-.02),(1.00,L/2),(H-.48,L/2),(H-.20,L/2-.10),(H,L/2-.24)]
 top=H-.40;wb=1.96;bt=.14
 def roof(s,neck):
  use('05')
  for side in [-1,1]:box('雨水槽',(0,side*(half_width(s,top)+.01),top+.02),(L-.60,.03,.03),'ggroof',.006)
  for x in [-L*.30,-L*.10,L*.10,L*.30]:
   cyl('圓形通風口',(x,0,H+.03),.14,.07,'ggroof',n=28,bevel=.03)
   cyl('通風口頂蓋',(x,0,H+.08),.17,.03,'ggroof',n=28,bevel=.012)
 s.update(doorXs=[L/2-.62],doorW=.62,doorTop=H-.66,doorWinZ=2.32,doorWinH=.62,winR=.10,bottom=.86)
 f,neck,doors=railcar(s,profile,.0,[(top,'ggwhite'),(H+1,'ggroof')],[(top,'ggwhite'),(H+1,'ggroof')],
  leaf='ggred',crew=False,double=True,gaps=[0,0],roof=roof)
 xr,R=L/2-1.12,.42
 for side in [-1,1]:
  y=side*(W/2+.018)
  # 紅啞鈴：車門端整段紅、窄紅端、窗下腰帶，三塊之間用四分之一圓角接起來。
  side_poly('車門端紅色區',s,xr,L/2-.05,.93,top-.005,'ggred',side,offset=.010,cols=6,rows=18)
  side_poly('另一端窄紅端',s,-L/2+.05,-L/2+.26,.93,top-.005,'ggred',side,offset=.010,cols=2,rows=18)
  side_poly('窗下紅腰帶',s,-L/2+.26,xr,wb-bt,wb,'ggred',side,offset=.010,cols=24,rows=1)
  for x0,x1,r in [(xr-R,xr,R),(-L/2+.26+.22,-L/2+.26,.22)]:
   c=x0;up=lambda x,c=c,r=r:wb+r-math.sqrt(max(0,r*r-(x-c)**2));dn=lambda x,c=c,r=r:wb-bt-r+math.sqrt(max(0,r*r-(x-c)**2))
   a,b=min(x0,x1),max(x0,x1)
   side_poly('紅啞鈴上圓角',s,a,b,wb-.002,up,'ggred',side,offset=.010,cols=12,rows=2)
   side_poly('紅啞鈴下圓角',s,a,b,dn,wb-bt+.002,'ggred',side,offset=.010,cols=12,rows=2)
  for xc,w,h in [(2.75,.62,.72),(1.98,.52,.66),(1.05,.98,.66),(-.02,.80,.66),(-.92,.62,.66),(-1.66,.50,.62),(-2.30,.50,.62),(-2.94,.50,.62),(-3.58,.50,.62)]:
   sidewindow(xc,y,wb+.06+h/2,w,h,r=.08)
  panel('車廂型式標示',(2.18,y+side*.004,1.66),.30,.20,'ggwhite',r=.01,depth=.006)
  for k in range(4):box('型式標示字列',(2.18,y+side*.010,1.73-k*.045),(.26,.004,.018),'frame',.001)
  text_label(s.get('label','35DC32751'),(-L*.33,y+side*.012,1.52),.06,'side',side)
  cyl('路徽圓牌',(-L*.33,y+side*.006,1.70),.07,.008,'frame','Y',24,0)
 for end in [-1,1]:coach_end(end*(L/2+.005),end,W,'ggwhite')
 underfloor([-1.80,-.50],W)
 use('04');box('車底水箱',(.90,0,.70),(1.10,W*.52,.36),'chassis',.10)
 box('發電機箱',(2.20,0,.66),(.70,W*.60,.34),'chassis',.03)
 s['pantos']=0

BUILDERS['guanguang']=guanguang

# ── 台糖現役柴油機車 ────────────────────────────────────────────────────────

def sugarhitachi(s):
 """台糖日立牌內燃機車（日立製作所 1967–69 年製，762 mm，溪湖糖廠 827／837 號仍牽引觀光列車）。參考：Commons Wengch 溪湖糖廠
 現役車正面（CC BY-SA 4.0）、Heino Vogel 837 號側面（CC BY-SA 3.0 de）、801／831 號靜態保存；尺寸 zh.wikipedia（5,540／2,200／3,000）。
 照 2023-04 溪湖現役車的暗紅塗裝（同年 7 月的 827、837 是橄欖綠配橘紅，兩種並存；這張照片看不到車號，所以車號牌留白）：一端高駕駛室、另一端較矮的長引擎罩；引擎罩正面整片橫百葉配白色大 V 字、上緣一條白帶與紅橘頂，
 罩頂前緣圓頭燈與白色扶手、駕駛室前的紅橘排氣管與喇叭；駕駛室上半紅橘、下半暗紅，前後各兩扇窗、側面一門一窗；
 兩端黃黑斜紋大緩衝樑與箱形車鉤，深外側車架蓋住半個車輪，車底黃色燃油箱與紅色煞車吊架。"""
 L,W,H=s['L'],s['W'],s['H']
 color('hdmaroon','560C09',.06,.40,.22);color('hdorange','9E200C',.06,.38,.24);color('hdslat','440A07',.06,.45,.15);color('hdred','C8241C',.06,.38,.24)
 deck=.92;r=.32
 use('04')
 for x in [-1.00,1.00]:
  cyl('輪軸',(x,0,r),.06,W*.50,'chassis','Y',16)
  for side in [-1,1]:wheel(x,side*.40,r,spoked=False)
 for side in [-1,1]:
  box('外側車架',(0,side*W*.40,.66),(L-.50,.10,.56),'chassis',.02)
  for x in [-1.00,1.00]:
   box('軸箱',(x,side*(W*.40+.07),r+.04),(.26,.08,.24),'chassis',.02)
   box('紅色煞車吊架',(x+.42,side*(W*.40+.07),r-.02),(.12,.06,.30),'hdred',.02)
  box('紅色煞車吊架',(0,side*(W*.40+.07),r-.02),(.12,.06,.30),'hdred',.02)
 cyl('黃色燃油箱',(-.20,0,.56),.22,1.10,'yellow','X',28,.03)
 box('車架頂板',(0,0,deck-.04),(L-.30,W*.98,.08),'chassis',.02)
 # 長引擎罩：下段暗紅、上段紅橘，中間一條白帶；正面整片橫百葉與白色大 V 字。
 use('01');hx0,hx1,hw,ht=-.62,2.22,.86,2.10;band=ht-.24
 box('引擎罩下段',((hx0+hx1)/2,0,(deck+band)/2),(hx1-hx0,2*hw,band-deck),'hdmaroon',.04)
 box('引擎罩上段',((hx0+hx1)/2,0,(band+ht)/2),(hx1-hx0,2*hw,ht-band),'hdorange',.06)
 box('引擎罩白帶',((hx0+hx1)/2+.006,0,band-.02),(hx1-hx0+.012,2*hw+.012,.08),'white',.01)
 use('03');gz0,gz1=deck+.12,band-.10
 panel('正面百葉底槽',(hx1+.004,0,(gz0+gz1)/2),1.46,gz1-gz0,'frame','front',r=.02)
 for i in range(11):
  z=gz0+.04+i*(gz1-gz0-.08)/10;box('正面橫百葉',(hx1+.03,0,z),(.03,1.42,.055),'hdslat',.008)
 zt,zb,vw=gz1-.02,gz0+.10,.17
 for sgn in [-1,1]:
  vt=[(hx1+.055,sgn*.70,zt),(hx1+.055,sgn*(.70-vw),zt),(hx1+.055,0,zb+vw*1.6),(hx1+.055,0,zb)]
  mesh('白色大V字',vt,[(0,1,2,3) if sgn>0 else (3,2,1,0)],'white')
 for side in [-1,1]:
  for x in [.10,.82,1.54]:
   panel('側面百葉門',(x,side*(hw+.004),deck+.50),.58,.66,'hdmaroon',r=.02,depth=.012)
   for k in range(7):box('側面百葉',(x,side*(hw+.016),deck+.26+k*.08),(.50,.010,.03),'hdslat',.003)
   box('百葉門把手',(x+.24,side*(hw+.02),deck+.50),(.03,.02,.12),'metal',.005)
  rod('罩頂白色扶手',(hx0+.10,side*(hw-.06),ht+.14),(hx1-.08,side*(hw-.06),ht+.14),.016,'white')
  for x in [hx0+.20,(hx0+hx1)/2,hx1-.10]:rod('扶手立柱',(x,side*(hw-.06),ht),(x,side*(hw-.06),ht+.14),.014,'white')
  rod('正面角扶手',(hx1+.06,side*(hw-.04),deck+.30),(hx1+.06,side*(hw-.04),band-.05),.018,'white')
 rod('罩頂前緣扶手',(hx1-.08,-(hw-.06),ht+.14),(hx1-.08,hw-.06,ht+.14),.016,'white')
 # 罩頂前緣圓頭燈、駕駛室前紅橘排氣管與喇叭。
 use('05');box('頭燈座',(hx1-.22,0,ht+.05),(.20,.20,.10),'hdorange',.02)
 cyl('頭燈燈殼',(hx1-.18,0,ht+.20),.10,.20,'metal','X',24)
 lamp('圓頭燈',lambda y,z:hx1-.16,0,ht+.20,.075)
 ex=hx0+.32
 cyl('排氣管',(ex,0,ht+.34),.15,.68,'hdorange',n=28)
 cyl('排氣管頂環',(ex,0,ht+.70),.18,.06,'hdorange',n=28,bevel=.015)
 cyl('排氣管座',(ex,0,ht+.03),.20,.06,'hdorange',n=28)
 # 照片：喇叭在排氣管左上方（車的右側）。
 cyl('喇叭',(hx0+.18,-.30,ht+.76),.04,.22,'hdorange','X',16)
 cone('喇叭口',(0,0),.05,.11,0,.10,'hdorange',cap=False);o=p.MODEL[-1];o.rotation_euler=(0,math.pi/2,0);o.location=(hx0+.29,-.30,ht+.76)
 # 駕駛室：下半暗紅、上半紅橘，前後各兩扇窗，側面一門一窗，略拱的屋頂外伸。
 use('01');cx0,cx1,cw,wz,ch=-L/2+.18,hx0,W*.96,2.14,H-.12
 box('駕駛室下半',((cx0+cx1)/2,0,(deck+wz)/2),(cx1-cx0,cw,wz-deck),'hdmaroon',.04)
 box('駕駛室上半',((cx0+cx1)/2,0,(wz+ch)/2),(cx1-cx0,cw,ch-wz),'hdorange',.04)
 for end,x in [(1,cx1),(-1,cx0)]:
  for y in [-.52,.52]:
   panel('駕駛室端窗框',(x+end*.004,y,2.48),.66,.54,'frame','front',r=.05)
   panel('駕駛室端窗',(x+end*.016,y,2.48),.58,.46,'glass','front',r=.04,depth=.01)
  rod('雨刷',(x+end*.03,.30,2.26),(x+end*.03,.42,2.60),.010,'chassis')
 for side in [-1,1]:
  yy=side*cw/2
  panel('側門門框',(-1.62,yy+side*.004,(deck+.10+ch-.16)/2),.62,ch-deck-.22,'frame',r=.03)
  panel('側門',(-1.62,yy+side*.014,(deck+.10+ch-.16)/2),.56,ch-deck-.28,'hdmaroon',r=.03)
  box('側門上半紅橘',(-1.62,yy+side*.026,(wz+ch-.19)/2),(.56,.010,ch-.19-wz),'hdorange',.003)
  panel('側門窗',(-1.62,yy+side*.032,2.46),.36,.48,'glass',r=.04,depth=.01)
  panel('側窗框',(-.98,yy+side*.004,2.46),.50,.56,'frame',r=.04)
  panel('側窗',(-.98,yy+side*.016,2.46),.42,.48,'glass',r=.035,depth=.01)
  for x in [-1.98,-1.26]:rod('登車扶手',(x,yy+side*.05,deck+.10),(x,yy+side*.05,2.30),.016,'white')
  for z in [.38,.62]:box('登車踏階',(-1.62,side*W*.47,z),(.40,.16,.035),'metal',.006)
  panel('車號牌',(-.98,yy+side*.008,1.62),.30,.18,'white',r=.015,depth=.008)
  if s.get('label'):text_label(s['label'],(-.98,yy+side*.016,1.62),.10,'side',side)
 use('05');roofv=[];n=10
 for i in range(n+1):
  tt=i/n;y=(tt-.5)*(cw+.16);z=ch+.08*math.cos((tt-.5)*math.pi)
  roofv+=[(cx1+.08,y,z),(cx0-.08,y,z)]
 mesh('駕駛室屋頂',roofv,[(2*i,2*i+1,2*i+3,2*i+2) for i in range(n)],'hdorange',0,True);m=p.MODEL[-1].modifiers.new('屋頂厚度','SOLIDIFY');m.thickness=.05
 cyl('屋頂紅色警示燈',(cx0+.30,-.55,ch+.12),.06,.12,'red',n=16)
 # 兩端黃黑斜紋大緩衝樑、箱形車鉤、紅色標識燈；做一端再旋轉複製。
 start=len(p.MODEL);x=L/2-.10
 use('07');box('緩衝樑',(x,0,.62),(.18,W*1.0,.62),'chassis',.02)
 hazard(x+.09,W,.62,.58)
 box('箱形車鉤',(x+.22,0,.58),(.24,.46,.26),'chassis',.03)
 rod('車鉤銷',(x+.30,0,.48),(x+.30,0,.80),.020,'metal')
 for y in [-.36,.36]:box('車鉤側座',(x+.16,y,.58),(.12,.12,.30),'chassis',.02)
 rod('標識燈柱',(x+.12,-W*.43,.92),(x+.12,-W*.43,1.10),.014,'metal')
 cyl('紅色標識燈',(x+.12,-W*.43,1.14),.06,.08,'red','X',16)
 copy_rotated(list(p.MODEL[start:]))
 s['drivers']=0;s['axles']=2

BUILDERS['sugarhitachi']=sugarhitachi

def sugarcar(s):
 """台糖溪湖糖廠五分車觀光敞車（甘蔗車底盤改造，762 mm，日立牌柴油機車或 346 號蒸機牽引）。參考：Commons 鐵路1 A-06、A-12 正側面與 A-15 斜視、
 Tbatb 整列遠景、Wengch 溪湖糖廠現役列車（CC BY-SA 4.0）；尺寸查不到，照 A-06 照片以護欄高約 1 m 為尺估（約 4.5／1.9／2.85 m）。
 一節一個大開間：每側四根米白方柱（兩端各兩根、中間沒有柱），柱間下半是可換的彩印廣告腰板，腰板上兩道淺藍鋼管橫桿；
 兩端柱距之間與端面是淺藍直條欄門，端部綠色鋼踏階；車內兩側紅色長椅面向中間、墨綠地板；深褐黑車架側板印白色車號，
 兩軸小車輪、兩端箱形車鉤；白灰弧形鐵皮頂棚四面出簷。"""
 L,W,H=s['L'],s['W'],s['H']
 color('ocpost','E2DFCB',.04,.40,.20);color('ocroof','C9CCCE',.30,.40,.10);color('ocrail','3A92D0',.30,.35,.20)
 color('ocpaper','EAE4D4',.02,.45,.10);color('ocfloor','2F5A55',.02,.60,.05);color('ocframe','3B302B',.10,.55,.08)
 color('ocbench','A82820',.04,.45,.15);color('ocstep','3E7444',.20,.50,.10)
 for k,h in enumerate(['B8432E','5E7F4A','C9A04A','3F6E9A']):color(f'ocposter{k}',h,.02,.45,.10)
 fz=.80;post=.10;pz=1.66;rz=2.40;xe=L/2-.14;xg=xe-.56
 use('04')
 for x in [-1.25,1.25]:
  cyl('輪軸',(x,0,.22),.05,W*.48,'chassis','Y',16)
  for side in [-1,1]:
   wheel(x,side*.40,.22)
   box('軸箱',(x,side*(W*.40+.06),.26),(.22,.10,.18),'ocframe',.02)
   box('板彈簧',(x,side*(W*.40+.06),.40),(.56,.08,.06),'chassis',.01)
 for side in [-1,1]:
  box('深褐黑車架側板',(0,side*W*.44,.62),(L-.26,.06,.30),'ocframe',.02)
  text_label(s.get('label','A-06'),(1.20,side*(W*.44+.035),.62),.10,'side',side)
  for k in range(2):box('座位標示白字',(-.60,side*(W*.44+.032),.66-k*.08),(1.10,.004,.035),'white',.001)
 for end in [-1,1]:
  box('底架端樑',(end*(L/2-.16),0,.62),(.14,W*.90,.26),'ocframe',.02)
  box('箱形車鉤',(end*(L/2+.02),0,.60),(.22,.32,.18),'chassis',.03)
  rod('車鉤銷',(end*(L/2+.08),0,.50),(end*(L/2+.08),0,.74),.016,'metal')
  box('綠色鋼踏階',(end*(L/2-.04),end*W*.28,.44),(.30,.46,.035),'ocstep',.006)
 use('01');box('墨綠地板',(0,0,fz-.03),(L-.20,W*.94,.06),'ocfloor',.01)
 # 側面：中段廣告腰板（米白外框）；兩端柱距之間淺藍直條欄門；腰板上兩道淺藍橫桿；四根米白方柱。
 for side in [-1,1]:
  y=side*W*.46
  box('腰板米白外框',(0,y,(fz+pz)/2),(2*xg,.05,pz-fz),'ocpost',.01)
  panel('彩印廣告腰板',(0,y+side*.030,(fz+pz)/2),2*xg-.14,pz-fz-.12,'ocpaper',r=.02,depth=.008)
  for k,(dx,dz,w,h) in enumerate([(-.95,.05,.80,.52),(-.12,-.06,.70,.40),(.62,.08,.60,.48),(1.10,-.08,.30,.34)]):
   panel('廣告圖塊',(dx,y+side*.038,(fz+pz)/2+dz),w,h,f'ocposter{k}',r=.02,depth=.006)
  for sx in [-1,1]:
   xa,xb=sx*xg,sx*xe
   for k in range(5):xx=xa+(xb-xa)*(k+.5)/5;rod('淺藍直條欄門',(xx,y,fz+.06),(xx,y,pz+.04),.016,'ocrail')
   rod('欄門下橫桿',(xa,y,fz+.08),(xb,y,fz+.08),.020,'ocrail')
  for z in [pz+.04,pz+.30]:rod('淺藍鋼管橫桿',(-xe,y,z),(xe,y,z),.025,'ocrail')
  for x in [-xe,-xg,xg,xe]:box('米白方柱',(x,y,(fz+rz)/2),(post,post,rz-fz),'ocpost',.012)
  box('車頂縱樑',(0,y,rz),(2*xe+post,.08,.07),'ocpost',.01)
  # 車內兩側紅色長椅面向中間。
  box('紅色長椅座面',(0,side*W*.30,1.14),(2*xg,.40,.07),'ocbench',.02)
  box('紅色椅背',(0,side*W*.40,1.46),(2*xg,.05,.40),'ocbench',.02)
  for x in [-1.10,0,1.10]:box('長椅腳',(x,side*W*.30,(fz+1.10)/2),(.06,.30,1.10-fz),'chassis',.01)
 # 端面：淺藍直條欄門（約半身高）。
 for end in [-1,1]:
  x=end*xe
  for k in range(9):yy=-W*.40+k*W*.10;rod('端面淺藍直條欄門',(x,yy,fz+.06),(x,yy,pz+.04),.016,'ocrail')
  for z in [fz+.08,pz+.04]:rod('端面欄門橫桿',(x,-W*.46,z),(x,W*.46,z),.022,'ocrail')
  box('車頂橫樑',(x,0,rz),(.08,W*.92+post,.07),'ocpost',.01)
 # 白灰弧形鐵皮頂棚，四面出簷。
 use('05');roofv=[];n=12;rx=xe+.26
 for i in range(n+1):
  t_=i/n;y=(t_-.5)*(W+.30);z=rz+.06+.20*math.cos((t_-.5)*math.pi)
  roofv+=[(rx,y,z),(-rx,y,z)]
 mesh('弧頂鐵皮',roofv,[(2*i,2*i+1,2*i+3,2*i+2) for i in range(n)],'ocroof',0,True);m=p.MODEL[-1].modifiers.new('鐵皮厚度','SOLIDIFY');m.thickness=.03
 for i in range(1,n):
  t_=i/n;y=(t_-.5)*(W+.30);z=rz+.06+.20*math.cos((t_-.5)*math.pi)+.02
  rod('浪板稜線',(-rx+.02,y,z),(rx-.02,y,z),.008,'ocroof')
 for k in range(5):
  x=-xe+k*xe/2;box('頂棚下吊樑',(x,0,rz+.05),(.05,W*.90,.05),'ocpost',.006)
 s['pantos']=0

BUILDERS['sugarcar']=sugarcar

# ── 台鐵箱形柴電機車（S300、R0）────────────────────────────────────────────

def sstep(t):
 t=max(0.,min(1.,t));return t*t*(3-2*t)

def loco_truck(cx,W,n,r,pitch,mat='chassis'):
 """機車轉向架：n 軸、側構架、軸箱與螺旋彈簧、軸間制動缸。回傳各軸 x。"""
 use('04');xs=[cx+(i-(n-1)/2)*pitch for i in range(n)];yw=W*.33;yf=yw+.20
 for x in xs:
  cyl('輪軸',(x,0,r),.09,2*yw,'chassis','Y',16)
  for y in [-yw,yw]:wheel(x,y,r)
 span=max(xs)-min(xs)+2*r+.10
 for side in [-1,1]:
  y=side*yf
  box('轉向架側構架',(cx,y,r+.12),(span,.10,.30),mat,.03)
  box('側構架下弦',(cx,y,r-.14),(max(.30,span-2*r),.08,.10),mat,.02)
  for x in xs:
   box('軸箱',(x,y+side*.07,r),(.26,.10,.28),mat,.03)
   for dx in [-.17,.17]:cyl('軸箱螺旋彈簧',(x+dx,y+side*.07,r+.25),.055,.20,'metal',n=12)
  for a,b in zip(xs,xs[1:]):cyl('制動缸',((a+b)/2,y+side*.10,r+.02),.09,.14,mat,'Y',16)
 box('轉向架枕樑',(cx,0,r+.26),(.46,2*yf,.20),mat,.03)
 return xs

def flat_band(name,x0,x1,zc,bw,y,material,n=40):
 """直立平面（y 固定）上的色帶：中心高 zc(x)、寬 bw 沿法線量；引擎罩側面的 S 形腰帶用它。"""
 use('01');pts=[(x0+(x1-x0)*i/n,zc(x0+(x1-x0)*i/n)) for i in range(n+1)];verts=[]
 for i,(x,z) in enumerate(pts):
  a=pts[max(0,i-1)];b=pts[min(n,i+1)];tx,tz=b[0]-a[0],b[1]-a[1];l=math.hypot(tx,tz)
  nx,nz=-tz/l*bw/2,tx/l*bw/2;verts+=[(x-nx,y,z-nz),(x+nx,y,z+nz)]
 return mesh(name,verts,[(2*i,2*i+2,2*i+3,2*i+1) for i in range(n)],material,0,True)

def seagull(name,x,hw,zc,ztip,bw,material,pw=3.2,n=28):
 """平端面上的海鷗倒 V：兩翼在 ±hw、高 zc 水平接側面腰帶，往中央越彎越陡，在 ztip 收成尖角。"""
 use('03')
 for sgn in [-1,1]:
  pts=[(sgn*hw*(1-i/n),ztip+(zc-ztip)*(1-(i/n)**pw)) for i in range(n+1)];verts=[]
  for i,(y,z) in enumerate(pts):
   a=pts[max(0,i-1)];b=pts[min(n,i+1)];ty,tz=b[0]-a[0],b[1]-a[1];l=math.hypot(ty,tz)
   ny,nz=-tz/l*bw/2,ty/l*bw/2;verts+=[(x,y-ny,z-nz),(x,y+ny,z+nz)]
  mesh(name,verts,[(2*i,2*i+2,2*i+3,2*i+1) for i in range(n)],material,0,True)

def arch_roof(name,x0,x1,w,z,rise,material,n=12,thick=.06):
 """駕駛室略拱的屋頂：x0 到 x1、寬 w、簷高 z、拱高 rise。"""
 use('05');v=[]
 for i in range(n+1):
  t_=i/n;y=(t_-.5)*w;zz=z+rise*math.cos((t_-.5)*math.pi);v+=[(x1,y,zz),(x0,y,zz)]
 mesh(name,v,[(2*i,2*i+1,2*i+3,2*i+2) for i in range(n)],material,0,True);m=p.MODEL[-1].modifiers.new('屋頂厚度','SOLIDIFY');m.thickness=thick

def loco_end(s,x,plow,hazard_h=.62,z=.96):
 """台鐵柴電機車端部（+X 端）：黃黑斜紋端梁、灰色排雪板、自動車鉤、紅色尾燈與制動軟管。另一端用 copy_rotated。"""
 W=s['W'];use('07');box('端梁',(x-.08,0,z),(.16,W*.98,hazard_h+.04),'chassis',.02)
 hazard(x,W,z,hazard_h)
 box('排雪板',(x+.04,0,.42),(.12,W*.74,.30),plow,.03)
 knuckle_coupler(x+.02,1,.92)
 for side in [-1,1]:
  cyl('端梁紅色尾燈',(x+.07,side*(W/2-.20),z+hazard_h/2-.10),.05,.04,'red','X',16)
  line('制動軟管',[(x+.04,side*.34,.84),(x+.14,side*.36,.64),(x+.08,side*.30,.50)],.022,'rubber')
  cyl('軟管旋塞',(x+.04,side*.34,.86),.03,.10,'metal',n=12,bevel=0)

def s300(s):
 """台鐵 S300 型柴電機車（美國 GM-EMD GA8，1966 年 21 輛，B0-B0 調車／支線機車；全型除籍，S318 仍在彰化扇形車庫調車）。
 參考：Commons SSR2000 苗栗 S305 全長側面、ChS&Rh 2023 彰化 S318 駕駛端、Hayato Chiou S302 駕駛端正面、Lokseng01 S302 轉向架；
 尺寸 zh.wikipedia（11,230／2,667／3,600）。照橘色版：駕駛室在一端，後面接較窄較矮的長引擎罩；駕駛端三扇方窗、上緣中央方殼雙頭燈，
 白色腰帶在端面彎成海鷗倒 V（兩翼上方各一塊黑底車號牌）；腰帶過了駕駛室沿引擎罩 S 形降低、到罩尾再升起；罩側掀蓋上半百葉，
 罩尾一排鋼格柵門；黃黑斜紋端梁、灰色排雪板、自動車鉤，B0-B0 轉向架之間是燃油箱。"""
 L,W,H=s['L'],s['W'],s['H']
 color('s3orange','C4461A',.06,.36,.28);color('s3roof','7E848A',.30,.45,.10)
 deck=1.18;r=.40;cx1=L/2-.10;cx0=cx1-1.55;cw=W*.98;ch=H-.12
 hx0=-L/2+.14;hw=W*.43;ht=H-.22;zb=2.26;zl=1.66;zr=2.62;bw=.13
 use('04');box('車架',(0,0,deck-.15),(L-.12,W*.98,.30),'chassis',.03)
 for cx in [-1.95,1.95]:loco_truck(cx,W,2,r,1.10)
 box('燃油箱',(0,0,.76),(1.60,W*.70,.52),'chassis',.08)
 for side in [-1,1]:cyl('空氣筒',(0,side*W*.41,.86),.12,1.40,'chassis','X',20)
 # 長引擎罩：罩側五片掀蓋（前四片上半百葉），罩尾一排鋼格柵門；白腰帶離開駕駛室 S 形降低，到罩尾再升起。
 use('01');box('長引擎罩',((hx0+cx0)/2,0,(deck+ht)/2),(cx0-hx0,2*hw,ht-deck),'s3orange',.05)
 box('罩頂灰色蓋板',((hx0+cx0)/2,0,ht+.025),(cx0-hx0-.06,2*hw-.06,.05),'s3roof',.02)
 zc=lambda x:zl+(zb-zl)*sstep((x-(cx0-.95))/.95)+(zr-zl)*sstep(((hx0+.60)-x)/.60)
 for side in [-1,1]:
  y=side*(hw+.006)
  for k,x in enumerate([1.10,.45,-.20,-.85,-1.50]):
   panel('罩側掀蓋',(x,y+side*.004,(deck+ht)/2+.04),.58,ht-deck-.30,'s3orange',r=.02,depth=.010)
   if k<4:grille('罩側百葉',x,y+side*.010,ht-.40,.46,.34,True,6)
   box('掀蓋把手',(x+.24,y+side*.016,deck+.62),(.03,.02,.12),'metal',.005)
  grille('罩尾鋼格柵門',hx0+.95,y+side*.010,2.26,.56,.70,True,9,True)
  flat_band('白色腰帶',hx0+.01,cx0,zc,bw,side*(hw+.024),'white',60)
  rod('罩尾白色扶手',(hx0+.10,side*(hw+.14),deck+.06),(hx0+.10,side*(hw+.14),deck+1.05),.016,'white')
  for z in [.55,.85]:box('罩尾踏階',(hx0+.30,side*(W/2-.04),z),(.40,.16,.035),'metal',.006)
 use('05');box('濾清器凸起',(cx0-.42,0,ht+.17),(.56,hw*1.5,.30),'s3orange',.04)
 for side in [-1,1]:grille('濾清器百葉',cx0-.42,side*hw*.75,ht+.17,.42,.18,True,4)
 cyl('排氣短管',(-.55,0,ht+.15),.10,.24,'chassis',n=20)
 cyl('冷卻風扇罩',(-2.30,0,ht+.08),.42,.10,'s3roof',n=36,bevel=.02)
 for k in range(6):box('風扇格柵',(-2.30-.30+k*.12,0,ht+.135),(.03,.76,.01),'chassis',.002)
 # 罩尾端面：整片橫百葉、白帶、上緣兩顆頭燈。
 use('03');panel('罩尾百葉底槽',(hx0-.004,0,(deck+ht)/2-.05),1.20,ht-deck-.60,'frame','front',r=.02)
 for k in range(9):box('罩尾橫百葉',(hx0-.022,0,deck+.30+k*(ht-deck-.70)/8),(.03,1.14,.05),'s3orange',.006)
 box('罩尾白帶',(hx0-.008,0,zr),(.02,2*hw+.012,bw),'white',.003)
 box('罩尾燈殼',(hx0-.06,0,ht-.14),(.12,.46,.22),'s3orange',.03)
 for y in [-.11,.11]:
  cyl('罩尾頭燈鍍鉻圈',(hx0-.13,y,ht-.14),.085,.04,'metal','X',28);cyl('罩尾頭燈透鏡',(hx0-.155,y,ht-.14),.065,.02,'lamp','X',28,.003)
 # 駕駛室：灰色略拱屋頂；前面三扇方窗、方殼雙頭燈、海鷗倒 V 與兩塊黑底車號牌。
 use('01');box('駕駛室',((cx0+cx1)/2,0,(deck+ch)/2),(cx1-cx0,cw,ch-deck),'s3orange',.05)
 arch_roof('駕駛室灰色屋頂',cx0-.04,cx1+.06,cw+.10,ch,.10,'s3roof')
 use('03');xf=cx1+.025
 for y,w in [(-.70,.50),(0,.66),(.70,.50)]:
  panel('前窗黑框',(xf,y,2.80),w+.08,.66,'frame','front',r=.06)
  panel('前窗',(xf+.012,y,2.80),w,.58,'glass','front',r=.05,depth=.01)
 for y in [-.18,.52]:line('雨刷',[(xf+.03,y,2.54),(xf+.03,y-.14,2.92)],.012,'chassis')
 box('雙頭燈方殼',(cx1+.08,0,3.28),(.16,.46,.22),'s3orange',.03)
 for y in [-.11,.11]:lamp('雙頭燈',lambda yy,zz:cx1+.08,y,3.28,.075)
 for side in [-1,1]:cyl('上緣小標示燈',(cx1+.05,side*(cw/2-.14),3.30),.045,.05,'lamp','X',16)
 seagull('白色海鷗倒 V',cx1+.014,cw/2,zb,1.52,bw,'white')
 for y in [-.78,.78]:
  panel('黑底車號牌',(xf+.004,y,2.40),.40,.13,'frame','front',r=.02,depth=.012)
  text_label(s.get('label','S302'),(xf+.016,y,2.40),.08)
 for side in [-1,1]:
  rod('車頭角白色扶手',(cx1+.06,side*(cw/2+.02),deck+.10),(cx1+.06,side*(cw/2+.02),2.40),.016,'white')
  y=side*(cw/2+.006);xd=cx1-.78
  sidewindow(cx1-.26,y,2.80,.28,.50,r=.05)
  sidewindow(cx0+.28,y,2.80,.30,.50,r=.05)
  use('02');panel('側門門縫',(xd,y,(deck+ch)/2-.05),.58,ch-deck-.30,'frame',r=.03,depth=.010)
  panel('側門',(xd,y+side*.008,(deck+ch)/2-.05),.52,ch-deck-.36,'s3orange',r=.03,depth=.012)
  panel('側門方窗',(xd,y+side*.018,2.80),.36,.46,'glass',r=.04,depth=.008)
  flat_band('白色腰帶',cx0,cx1,lambda x:zb,bw,side*(cw/2+.024),'white',4)
  for dx in [-.34,.34]:rod('車門白色扶手',(xd+dx,y+side*.05,deck-.05),(xd+dx,y+side*.05,2.50),.016,'white')
  for z in [.55,.85]:box('登車踏階',(xd,side*(W/2-.04),z),(.46,.16,.035),'metal',.006)
  for dx in [-.22,.22]:box('踏階吊架',(xd+dx,side*(W/2-.04),.86),(.03,.03,.66),'metal',0)
 start=len(p.MODEL);loco_end(s,L/2-.06,'s3roof');copy_rotated(list(p.MODEL[start:]))
 s['pantos']=0;s['axles']=2

BUILDERS['s300']=s300

def r0(s):
 """台鐵 R0 型柴電機車（日立製作所 1960 年交付 12 輛，Co-Co；1999 年全數報廢，唯一保存車 R6 為 1970 年代改造型，在苗栗火車頭園區）。
 參考：Commons Dquai 1999 R6 橘色全長側面、Hayato Chiou 2010 R6 短端、Smiley.toerist 2014 R6 斜前、D1114456 2025 R6 正面、
 Solomon203 剖面模型；尺寸 zh.wikipedia（15,370／2,875／3,836，改造後）。照 R6 現在的海軍藍：短引擎罩在前、駕駛室、長引擎罩；
 短端面方殼雙頭燈（上方小帽沿）、上緣紅色標示燈、白色海鷗倒 V 延伸成全車白腰帶，到長罩尾段往下彎收到端梁；
 罩側整排直條百葉，駕駛室側面一門兩窗與白色扶手爬梯，長罩頂後段大圓冷卻風扇；Co-Co 轉向架之間是燃油箱與電瓶箱。"""
 L,W,H=s['L'],s['W'],s['H']
 color('r0navy','172C70',.06,.36,.28);color('r0roof','7E848A',.30,.45,.10)
 deck=1.22;r=.40;hw=W*.41;sx1=L/2-.10;sx0=sx1-1.05;cx0=sx0-1.60;cw=W*.98;ch=H-.12;st=H-.62;ht=H-.22;hx0=-L/2+.12;zb=2.40;bw=.12
 use('04');box('車架',(0,0,deck-.15),(L-.12,W*.98,.30),'chassis',.03)
 for cx in [-2.70,2.70]:loco_truck(cx,W,3,r,.86)
 box('燃油箱',(0,0,.76),(2.20,W*.72,.52),'chassis',.08)
 for side in [-1,1]:
  cyl('空氣筒',(.10,side*W*.41,.86),.12,1.80,'chassis','X',20)
  box('電瓶箱',(-.95,side*W*.36,.80),(.50,.22,.36),'chassis',.03)
 use('01')
 box('短引擎罩',((sx0+sx1)/2,0,(deck+st)/2),(sx1-sx0,2*hw,st-deck),'r0navy',.05)
 box('短罩灰色頂蓋',((sx0+sx1)/2+.02,0,st+.03),(sx1-sx0+.04,2*hw+.02,.06),'r0roof',.02)
 box('長引擎罩',((hx0+cx0)/2,0,(deck+ht)/2),(cx0-hx0,2*hw,ht-deck),'r0navy',.05)
 box('長罩灰色頂蓋',((hx0+cx0)/2,0,ht+.025),(cx0-hx0-.06,2*hw-.06,.05),'r0roof',.02)
 box('駕駛室',((cx0+sx0)/2,0,(deck+ch)/2),(sx0-cx0,cw,ch-deck),'r0navy',.05)
 arch_roof('駕駛室灰色屋頂',cx0-.04,sx0+.06,cw+.10,ch,.10,'r0roof')
 zc=lambda x:zb-(zb-(deck+.18))*sstep(((hx0+1.0)-x)/1.0)
 for side in [-1,1]:
  y=side*(hw+.006)
  for x in [.85,0,-.85,-1.70,-2.55,-3.40]:
   panel('罩側掀蓋',(x,y+side*.004,(deck+ht)/2+.04),.74,ht-deck-.24,'r0navy',r=.02,depth=.010)
   grille('罩側直條百葉',x,y+side*.010,ht-.48,.60,.62,True,11,True)
   box('掀蓋把手',(x+.30,y+side*.016,deck+.60),(.03,.02,.12),'metal',.005)
  grille('短罩直條百葉',(sx0+sx1)/2,y+side*.010,st-.42,.66,.50,True,11,True)
  flat_band('白色腰帶',hx0+.01,cx0,zc,bw,side*(hw+.024),'white',60)
  flat_band('白色腰帶',sx0,sx1,lambda x:zb,bw,side*(hw+.024),'white',4)
  # 駕駛室側面：靠短罩一扇帶窗側門，後面兩扇窗；白色扶手與多級爬梯。
  y=side*(cw/2+.006);xd=sx0-.34
  use('02');panel('側門門縫',(xd,y,(deck+ch)/2-.05),.56,ch-deck-.30,'frame',r=.03,depth=.010)
  panel('側門',(xd,y+side*.008,(deck+ch)/2-.05),.50,ch-deck-.36,'r0navy',r=.03,depth=.012)
  panel('側門窗',(xd,y+side*.018,2.90),.32,.50,'glass',r=.04,depth=.008)
  sidewindow(sx0-.86,y,2.90,.36,.50,r=.05);sidewindow(cx0+.30,y,2.90,.30,.50,r=.05)
  flat_band('白色腰帶',cx0,sx0,lambda x:zb,bw,side*(cw/2+.024),'white',4)
  for dx in [-.33,.33]:rod('車門白色扶手',(xd+dx,y+side*.05,deck-.25),(xd+dx,y+side*.05,2.60),.016,'white')
  for z in [.40,.68,.96]:box('爬梯踏階',(xd,side*(W/2-.04),z),(.44,.16,.035),'metal',.006)
  for dx in [-.21,.21]:box('爬梯吊架',(xd+dx,side*(W/2-.04),.70),(.03,.03,.64),'metal',0)
  rod('長罩尾白色扶手',(hx0+.10,side*(hw+.14),deck+.06),(hx0+.10,side*(hw+.14),deck+1.10),.016,'white')
  for z in [.55,.85]:box('長罩尾踏階',(hx0+.30,side*(W/2-.04),z),(.40,.16,.035),'metal',.006)
 use('05');cyl('排氣管',(-.80,0,ht+.12),.12,.22,'chassis',n=20)
 cyl('大圓冷卻風扇罩',(hx0+.85,0,ht+.07),.56,.08,'r0roof',n=40,bevel=.02)
 for k in range(9):box('風扇格柵',(hx0+.85-.42+k*.105,0,ht+.115),(.03,1.0,.01),'chassis',.002)
 for x in [-1.70,-.30]:box('罩頂分段蓋板',(x,0,ht+.06),(.90,2*hw-.30,.04),'r0roof',.01)
 # 短端面：方殼雙頭燈與小帽沿、上緣紅色標示燈、海鷗倒 V、車號、端梁上方兩顆小燈。
 use('03');box('雙頭燈方殼',(sx1+.05,0,st-.20),(.10,.52,.26),'r0navy',.03)
 box('頭燈帽沿',(sx1+.08,0,st-.04),(.16,.62,.04),'r0roof',.01)
 for y in [-.12,.12]:lamp('雙頭燈',lambda yy,zz:sx1+.04,y,st-.20,.08)
 for side in [-1,1]:
  cyl('紅色標示燈',(sx1+.04,side*(hw-.12),st-.14),.045,.05,'red','X',16)
  lamp('端面小燈',lambda yy,zz:sx1-.04,side*(hw-.20),1.50,.05)
 seagull('白色海鷗倒 V',sx1+.012,hw,zb,1.56,bw,'white')
 text_label(s.get('label','R6'),(sx1+.016,0,st-.52),.12)
 box('長罩尾端白帶',(hx0-.008,0,deck+.18),(.02,2*hw,bw),'white',.003)
 start=len(p.MODEL);loco_end(s,L/2-.06,'chassis');copy_rotated(list(p.MODEL[start:]))
 s['pantos']=0;s['axles']=3

BUILDERS['r0']=r0

# ── 阿里山林鐵柴油客車 ──────────────────────────────────────────────────────

def zhongxing(s):
 """阿里山林業鐵路中興號柴油客車 DPC（日本車輛 1962 年製，762 mm，1963–1990 對號特快；DPC7、DPC8 保存在嘉義北門）。
 參考：Commons Hsin-Jen Hsu 2015 DPC8 側面、Ojiukh415 車頭斜前、Chi-Hung Lin DPC7 車頭、1962 出廠黑白照；
 尺寸 zh.wikipedia（10,700／2,080／3,120）。照 DPC8 鮮紅塗裝：圓角方箱車頭、車頂前緣帽沿正中一盞大頭燈、帽沿兩側紅色標示燈；
 三扇前窗，下半整幅兩塊百葉散熱格柵（上緣左右小頭燈、中央中興號圓牌）；一條白腰帶繞全車；
 單側一扇手拉門（左側靠駕駛端、右側靠後端），九扇銀框方窗；紅色圓拱頂上中央銀色長方水箱與小通風罩；後端貫通門與爬梯；兩個二軸轉向架。"""
 L,W,H=s['L'],s['W'],s['H']
 color('zxred','C0140F',.06,.36,.28);color('zxroof','A8ACB0',.25,.45,.10);color('zxdisc','5FA8D4',.04,.40,.20)
 profile=[(.80,L/2-.02),(1.00,L/2),(H-.40,L/2),(H-.24,L/2-.04),(H-.10,L/2-.16),(H,L/2-.34)]
 f,neck=zoned_shell(s,profile,.06,[(H+1,'zxred')],[(H+1,'zxred')])
 bz=1.96
 # 白腰帶繞側面與車頭。
 use('01')
 for side in [-1,1]:box('白色腰帶',((-L/2+.04+neck)/2,side*(half_width(s,bz)+.012),bz),(neck-(-L/2+.04),.020,.07),'white',.004)
 front_patch('車頭白色腰帶',f,-(W/2-.04),W/2-.04,bz-.035,bz+.035,'white',.028,cols=24,rows=1)
 for side in [-1,1]:side_poly('車頭肩部白色腰帶',s,neck-.01,f(side*(W/2-.04),bz),bz-.035,bz+.035,'white',side,cols=6,rows=1)
 # 車頭：三扇前窗、帽沿與大頭燈、兩塊百葉格柵、中興號圓牌、格柵上緣小頭燈。
 front_panel('前窗黑框',f,0,2.34,W-.16,.66,'frame',.06,.026)
 front_glass(f,[(.34,.92,'左前窗'),(-.28,.28,'中前窗'),(-.92,-.34,'右前窗')],2.06,2.62,offset=.045,r=.05)
 wiper(f,.70,2.08,.48);wiper(f,.08,2.08,.48)
 use('03');zv=H-.32;n=16;vv=[]
 for i in range(n+1):
  y=(W/2-.06)*(2*i/n-1);x=f(y,zv);vv+=[(x-.02,y,zv),(x+.13,y,zv),(x+.13,y,zv+.05),(x-.02,y,zv+.07)]
 faces=[(4*i+k,4*i+(k+1)%4,4*(i+1)+(k+1)%4,4*(i+1)+k) for i in range(n) for k in range(4)]+[(0,1,2,3),(4*n+3,4*n+2,4*n+1,4*n)]
 mesh('車頂帽沿',vv,faces,'zxred',0,True)
 for side in [-1,1]:cyl('帽沿紅色標示燈',(f(side*.82,zv)+.09,side*.82,zv+.10),.04,.06,'red','X',16)
 hx=f(0,H-.12)-.06;cyl('大頭燈燈殼',(hx,0,H+.04),.13,.26,'zxred','X',28);cyl('燈殼座',(hx-.06,0,H-.02),.10,.08,'zxred',n=20)
 lamp('帽沿大頭燈',lambda y,z:hx+.06,0,H+.04,.09)
 for yc in [-.47,.47]:
  front_panel('格柵黑底',f,yc,1.46,.84,.80,'frame',.03,.026)
  for k in range(11):front_panel('格柵橫百葉',f,yc,1.09+k*.072,.80,.032,'zxred',.01,.036)
 front_panel('格柵中央分隔',f,0,1.46,.10,.82,'zxred',.02,.03)
 x=f(0,1.48)+.05;cyl('中興號圓牌',(x,0,1.48),.20,.03,'zxdisc','X',36,.005)
 panel('圓牌台灣地圖',(x+.02,.01,1.49),.10,.22,'white','front',r=.05,depth=.008)
 for side in [-1,1]:lamp('格柵上緣小頭燈',f,side*.84,1.78,.05)
 # 側面：駕駛端窗、九扇銀框方窗、單側一扇手拉門（左側靠前、右側靠後）、右側前段散熱格柵。
 for side in [-1,1]:
  y=side*(W/2+.018);wz=2.33;wh=.58
  door=1.82 if side>0 else -2.74;xs=[1.42-(i+.5)*(4.34/9) for i in range(9)] if side>0 else [2.02-(i+.5)*(4.34/9) for i in range(9)]
  for x in xs+[2.44]:
   w=.40 if x!=2.44 else .38
   panel('銀色窗框',(x,y,wz),w+.06,wh+.06,'metal',r=.06)
   panel('側窗玻璃',(x,y+side*.015,wz),w,wh,'glass',r=.045,depth=.013)
   box('窗中橫框',(x,y+side*.026,wz+.06),(w,.016,.03),'metal',.006)
  use('02');panel('手拉門門縫',(door,y,1.74),.52,1.74,'frame',r=.03,depth=.010)
  panel('手拉門',(door,y+side*.008,1.74),.46,1.68,'zxred',r=.03,depth=.012)
  panel('門窗',(door,y+side*.018,2.33),.24,.62,'glass',r=.04,depth=.008)
  box('門上白色腰帶',(door,y+side*.016,bz),(.46,.010,.07),'white',.002)
  for dx in [-.30,.30]:rod('門邊扶手',(door+dx,y+side*.05,1.10),(door+dx,y+side*.05,2.10),.014,'metal')
  box('登車踏階',(door,side*(W/2-.02),.62),(.40,.16,.03),'metal',.005)
  text_label(s.get('label','DPC8'),(-.20 if side>0 else .60,y+side*.012,1.50),.08,'side',side)
  for x in [-L/2+.30,neck-.10]:box('雨水槽',(x,side*(half_width(s,H-.36)+.01),H-.36),(.04,.03,.03),'zxroof',.004)
  box('雨水槽',(0,side*(half_width(s,H-.36)+.01),H-.36),(L-.40,.03,.03),'zxroof',.006)
 grille('右側散熱格柵',2.40,-(W/2+.014),1.36,.52,.52,True,8)
 # 車頂：中央長方水箱、八個小通風罩。
 use('05');box('車頂長方水箱',(-.40,0,H+.06),(2.20,.46,.14),'zxroof',.04)
 for x in [-2.30,-1.00,.30,1.60]:
  for side in [-1,1]:box('小通風罩',(x,side*.46,H+.04),(.24,.18,.10),'zxroof',.03)
 # 後端貫通門與爬梯、尾燈；前後車鉤與軟管。
 xr=-L/2-.005;use('07')
 panel('後端貫通門',(xr-.012,0,1.84),.62,1.70,'zxred','front',r=.05)
 panel('貫通門窗',(xr-.026,0,2.30),.38,.50,'glass','front',r=.04)
 box('後端白色腰帶',(xr-.006,0,bz),(.012,W-.08,.07),'white',.002)
 for k in range(8):rod('爬梯踏棍',(xr-.07,.58,1.00+k*.22),(xr-.07,.82,1.00+k*.22),.012,'metal')
 for y in [.58,.82]:rod('爬梯側桿',(xr-.07,y,.95),(xr-.07,y,2.70),.014,'metal')
 for side in [-1,1]:cyl('後端尾燈',(xr-.03,side*(W/2-.18),1.15),.05,.04,'red','X',16)
 for end,x in [(1,f(0,.90)),(-1,-L/2)]:
  box('端梁',(x-end*.04,0,.70),(.12,W*.86,.22),'chassis',.02)
  knuckle_coupler(x,end,.66)
  for side in [-1,1]:line('制動軟管',[(x+end*.04,side*.30,.74),(x+end*.12,side*.32,.56),(x+end*.06,side*.26,.44)],.020,'rubber')
 # 兩個二軸轉向架；車底引擎箱與燃油箱。
 for cx in [-(L/2-1.15),L/2-1.15]:loco_truck(cx,W,2,.30,.62)
 underfloor([-.10],W,'chassis',1.50)
 use('04');cyl('燃油箱',(1.10,0,.62),.20,.80,'chassis','X',24)
 s['pantos']=0;s['axles']=2

BUILDERS['zhongxing']=zhongxing

# ── 舊台東線 762 mm 車輛與台糖柴油客車 ───────────────────────────────────────

def framed_window(x,y,z,w,h,frame,split=False,r=.04):
 """有色窗框的側窗（白框、青綠框、銀框）；split 加一道中橫框成上下兩段。"""
 use('02');side=1 if y>0 else -1
 panel('有色窗框',(x,y,z),w+.06,h+.06,frame,r=r+.01)
 panel('側窗玻璃',(x,y+side*.015,z),w,h,'glass',r=r,depth=.013)
 if split:box('窗中橫框',(x,y+side*.026,z+.04),(w,.016,.03),frame,.006)

def ldk58(s):
 """台鐵 LDK58 蒸汽機車（LDK50 型，日本車輛 1923 年製 0-8-0T 水櫃機，762 mm 舊台東線；1982 年報廢，台北車站東側展示）。
 參考：Commons SSR2000 2012 右側斜前、Solomon203 2024 車頭正面、洪達雄 1981 花蓮站運用照；尺寸 zh.wikipedia LDK50 型（7,608／2,286／3,100）。
 照展示版黑紅黃銅：黑車身、高直筒煙囪（頂端略放大）、煙囪前紅圈大頭燈、圓煙箱門中央紅色手輪；鍋爐上大、大、小三座圓頂；
 側水櫃占車身大半，中央紅邊黃銅車號牌；方正駕駛室配拱頂與紅框側窗，後面開口；四對小動輪配拋光輪輞與連桿，
 前端外置汽缸配紅色汽缸蓋方塊；前後紅色緩衝梁、中央緩衝車鉤與紅色緩衝器圓蓋，前方紅色排障鐵。"""
 L,W,H=s['L'],s['W'],s['H'];body='lkblack'
 color('lkblack','1B1B1D',.30,.45,.12);color('lkred','B8141A',.10,.40,.22);color('lkbrass','B8862A',.85,.30,.05)
 r=.30;axles=[1.02,.40,-.22,-.84];deck=.86
 use('04')
 for x in axles:
  cyl('動輪軸',(x,0,r),.06,W*.62,'chassis','Y',20)
  for side in [-1,1]:
   wheel(x,side*W*.31,r,spoked=True)
   torus_y('拋光輪輞',(x,side*(W*.31+.115),r),r-.045,.014,'white',n=40,m=6)
   cyl('曲柄銷',(x-.10,side*(W*.31+.15),r+.06),.04,.10,'metal','Y',16)
 for side in [-1,1]:
  yy=side*(W*.31+.21)
  rod('拋光連結桿',(axles[0]-.10,yy,r+.06),(axles[3]-.10,yy,r+.06),.030,'white')
  rod('主連桿',(1.62,yy+side*.03,.58),(axles[1]-.10,yy+side*.03,r+.06),.032,'metal')
  cyl('外置汽缸',(1.82,side*(W/2-.15),.58),.17,.48,body,'X',32)
  box('汽缸閥箱',(1.82,side*(W/2-.15),.80),(.44,.20,.18),body,.03)
  box('紅色汽缸蓋方塊',(2.09,side*(W/2-.15),.66),(.07,.30,.40),'lkred',.02)
  rod('十字頭滑桿',(1.56,yy+side*.03,.64),(.84,yy+side*.03,.64),.018,'metal')
  line('Walschaerts 閥動',[(axles[1],yy+side*.07,r),(.55,yy+side*.07,.76),(1.48,side*(W/2-.12),.84)],.018,'metal')
  rod('閥動半徑桿',(.55,yy+side*.07,.76),(.55,yy+side*.07,.98),.016,'metal')
  box('內側車架',(.10,side*W*.20,.58),(3.60,.07,.40),body,.02)
  for x in axles:box('軸箱',(x,side*W*.20,r),(.18,.11,.20),body,.02)
  box('紅色排障鐵',(2.56,side*W*.31,.32),(.05,.10,.44),'lkred',.01)
 use('01');box('走行板',(0,0,deck),(L-.40,W*.94,.06),body,.02)
 # 鍋爐、煙箱、煙箱門與中央紅色手輪。
 cabF=-.62;sb=1.32;bf=1.98;br=.40;bz=deck+.06+br
 cyl('圓筒鍋爐',((cabF+sb)/2,0,bz),br,sb-cabF,body,'X',56,.01)
 cyl('煙箱',((sb+bf)/2,0,bz),br+.05,bf-sb,body,'X',56,.01)
 cyl('煙箱前環',(bf+.01,0,bz),br+.06,.05,body,'X',56,.01)
 cyl('煙箱門',(bf+.05,0,bz),br-.03,.07,body,'X',56,.03)
 for i in range(14):
  a=2*math.pi*i/14;cyl('煙箱門螺栓',(bf+.04,(br+.02)*math.cos(a),bz+(br+.02)*math.sin(a)),.015,.03,'metal','X',8,0)
 hw=[(bf+.11,.11*math.cos(2*math.pi*i/16),bz+.11*math.sin(2*math.pi*i/16)) for i in range(17)]
 line('紅色手輪',hw,.013,'lkred')
 for a in [0,math.pi/2]:rod('手輪輻',(bf+.11,-.11*math.cos(a),bz-.11*math.sin(a)),(bf+.11,.11*math.cos(a),bz+.11*math.sin(a)),.010,'lkred')
 cyl('手輪軸',(bf+.10,0,bz),.03,.06,'lkred','X',12)
 box('煙箱下座',((sb+bf)/2,0,deck+.18),(bf-sb,W*.40,.36),body,.02)
 # 高直筒煙囪、煙囪前紅圈大頭燈。
 use('05');cx=(sb+bf)/2+.02;tz=bz+br+.04;top=H-.02
 cyl('煙囪座',(cx,0,tz),.19,.10,body,n=32)
 cyl('高直筒煙囪',(cx,0,(tz+top-.10)/2),.13,top-.10-tz,body,n=32)
 cone('煙囪頂放大',(cx,0),.13,.17,top-.12,top,body,n=32,cap=False)
 cyl('煙囪頂環',(cx,0,top),.17,.03,body,n=32)
 hx=bf-.04;hz=bz+br+.17
 box('頭燈座',(hx-.06,0,bz+br+.02),(.18,.16,.10),body,.02)
 cyl('頭燈燈殼',(hx,0,hz),.13,.22,body,'X',28)
 cyl('頭燈紅圈',(hx+.11,0,hz),.15,.03,'lkred','X',28,.005)
 lamp('大頭燈',lambda y,z:hx+.03,0,hz,.09)
 # 鍋爐頂大、大、小三座圓頂，黃銅安全閥與汽笛。
 for x,rr,hh,name in [(1.00,.17,.40,'砂箱圓頂'),(.38,.18,.44,'汽室圓頂'),(-.24,.13,.26,'小圓頂')]:
  cyl(name+'基座',(x,0,bz+br-.04),rr+.05,.14,body,n=36,bevel=.03)
  cyl(name,(x,0,bz+br+hh/2),rr,hh,body,n=36,bevel=.06)
 for dy in [-.04,.04]:rod('黃銅安全閥',(-.24,dy,bz+br+.24),(-.24,dy,bz+br+.40),.024,'lkbrass')
 rod('黃銅汽笛',(cabF+.12,.16,bz+br-.02),(cabF+.12,.16,bz+br+.30),.022,'lkbrass')
 cyl('汽笛頂',(cabF+.12,.16,bz+br+.32),.035,.05,'lkbrass',n=12)
 for side in [-1,1]:line('鍋爐扶手',[(cabF+.10,side*(br+.10),bz+.30),(1.40,side*(br+.10),bz+.30)],.012,'metal')
 # 側水櫃：鉚釘邊、中央紅邊黃銅車號牌。
 tx0,tx1=cabF+.02,1.26;tz0,tz1=deck+.04,bz+.26
 for side in [-1,1]:
  yt=side*(W/2-.26)
  box('側水櫃',((tx0+tx1)/2,yt,(tz0+tz1)/2),(tx1-tx0,.52,tz1-tz0),body,.06)
  for z in [tz0+.06,tz1-.06]:rivet_row('水櫃鉚釘',tx0+.06,tx1-.06,side*(W/2-.005),z,15,body)
  zc=(tz0+tz1)/2+.04
  panel('車號牌紅邊',(.32,side*(W/2+.006),zc),.52,.20,'lkred',r=.02,depth=.01)
  panel('黃銅車號牌',(.32,side*(W/2+.012),zc),.47,.15,'lkbrass',r=.015,depth=.01)
  text_label(s.get('label','LDK58'),(.32,side*(W/2+.020),zc),.08,'side',side)
  cyl('水櫃注水口',(tx1-.20,yt,tz1+.03),.08,.06,body,n=16)
 # 駕駛室：前牆、側面紅框三窗（前窄、中寬、後窄），後面開口；拱頂外伸；後方低煤櫃與登車踏階。
 cabR=-2.06;ch=H-.16;cw=W*.96;wz0,wz1=1.95,2.65
 box('駕駛室前牆',(cabF-.04,0,(deck+ch)/2),(.08,cw,ch-deck),body,.02)
 for side in [-1,1]:
  yy=side*cw/2
  box('駕駛室側牆下半',((cabF+cabR)/2,yy,(deck+wz0)/2),(cabF-cabR,.06,wz0-deck),body,.02)
  box('駕駛室側牆上楣',((cabF+cabR)/2,yy,(wz1+ch)/2),(cabF-cabR,.06,ch-wz1),body,.02)
  wins=[(cabF-.22,.30),(cabF-.72,.52),(cabR+.20,.24)]
  edges=[cabF]+[e for x,w in wins for e in (x+w/2,x-w/2)]+[cabR]
  for a,b in zip(edges[0::2],edges[1::2]):box('窗間柱',((a+b)/2,yy,(wz0+wz1)/2),(abs(a-b),.06,wz1-wz0),body,.01)
  for x,w in wins:
   panel('紅色窗框',(x,yy+side*.034,(wz0+wz1)/2),w+.04,wz1-wz0+.04,'lkred',r=.02,depth=.012)
   panel('駕駛室側窗',(x,yy+side*.040,(wz0+wz1)/2),w-.06,wz1-wz0-.06,'glass',r=.02,depth=.008)
  for z in [.42,.66]:box('登車踏階',(cabR+.22,side*W*.47,z),(.30,.18,.03),'metal',.006)
  for dx in [-.13,.13]:box('踏階吊架',(cabR+.22+dx,side*W*.47,.66),(.03,.03,.48),'metal',0)
  rod('駕駛室後柱扶手',(cabR+.04,yy+side*.05,deck+.20),(cabR+.04,yy+side*.05,wz1),.016,'lkbrass')
 arch_roof('拱頂駕駛室屋頂',cabR-.18,cabF+.10,W+.10,ch,.12,body,thick=.05)
 box('後方低煤櫃',(cabR-.26,0,deck+.30),(.40,cw*.86,.60),body,.03)
 # 前後紅色緩衝梁、中央緩衝車鉤、紅色緩衝器圓蓋。
 for end in [-1,1]:
  x=end*(L/2-.12)
  use('07');box('紅色緩衝梁',(x,0,.74),(.16,W*.98,.40),'lkred',.02)
  box('中央緩衝座',(x+end*.12,0,.74),(.12,.36,.18),'chassis',.02)
  box('緩衝車鉤頭',(x+end*.21,0,.74),(.08,.24,.14),'metal',.03)
  rod('車鉤銷',(x+end*.23,0,.66),(x+end*.23,0,.84),.014,'metal')
  for y in [-.70,.70]:cyl('紅色緩衝器圓蓋',(x+end*.10,y,.74),.09,.06,'lkred','X',20)
  rod('緩衝梁扶手',(x+end*.10,-W*.40,1.04),(x+end*.10,W*.40,1.04),.013,'metal')
 s['drivers']=4;s['axles']=4;s['tank']=True

BUILDERS['ldk58']=ldk58

def ldr2200(s):
 """台鐵 LDR2200 型柴油客車（1957 年台北機廠造車體、花蓮組裝，762 mm 舊台東線「黃皮仔車」；1982 年報廢，LDR2201 在台北車站東側展示）。
 參考：Commons Solomon203 2012 LDR2201 側面、2022 駕駛端斜前、鐵路1 2018 夜景前視；尺寸 zh.wikipedia（14,100／2,450／3,090）。
 黃色下半、米白上半與淺灰白圓拱頂；側面每邊十六格兩段式白框窗（兩端各一格、兩扇單開門、中間十二格），
 駕駛端平直兩窗（左小右寬），左上角車頂前緣方殼雙頭燈；另一端中央貫通門與兩扇端窗；車頂中線六個方形通風罩；兩個二軸轉向架。"""
 from mathutils import Matrix
 L,W,H=s['L'],s['W'],s['H']
 color('ldyellow','B88E00',.02,.46,.08);color('ldcream','E4E0D2',.04,.40,.24);color('ldroof','C8CACA',.20,.45,.10)
 bz=1.76;rz=H-.30
 profile=[(.80,L/2-.02),(1.00,L/2),(H-.40,L/2),(H-.18,L/2-.06),(H,L/2-.22)]
 zones=[(bz,'ldyellow'),(rz,'ldcream'),(H+1,'ldroof')]
 f,neck=zoned_shell(s,profile,.05,zones,zones,double=True)
 for side in [-1,1]:
  y=side*(W/2+.018)
  for x in [-3.18,3.18]+[-2.30+(i+.5)*(4.6/12) for i in range(12)]:framed_window(x,y,2.20,.36 if abs(x)>3 else .30,.58,'white',True)
  for x in [-2.68,2.68]:
   use('02');panel('車門門縫',(x,y,1.68),.50,1.62,'frame',r=.03,depth=.010)
   panel('單開車門',(x,y+side*.008,1.68),.44,1.56,'ldyellow',r=.03,depth=.012)
   box('門上半米白',(x,y+side*.016,(bz+2.44)/2),(.44,.010,2.44-bz),'ldcream',.003)
   panel('門窗',(x,y+side*.022,2.18),.26,.50,'glass',r=.03,depth=.008)
   rod('直立把手',(x+.17,y+side*.05,1.30),(x+.17,y+side*.05,1.90),.012,'metal')
   box('登車踏階',(x,side*(W/2-.02),.62),(.40,.16,.03),'metal',.005)
  text_label(s.get('label','LDR2201'),(0,y+side*.012,1.02),.07,'side',side)
  box('雨水槽',(0,side*(half_width(s,H-.36)+.01),H-.36),(L-.60,.03,.03),'ldroof',.006)
 # 駕駛端（+X）：兩扇白框窗（左小右寬）、左上角方殼雙頭燈、下緣尾燈、車底柵格板。
 for a,b in [(-.87,-.37),(-.01,.77)]:front_panel('白色窗框',f,(a+b)/2,2.25,b-a+.08,.62,'white',.05,.03)
 front_glass(f,[(-.87,-.37,'左前窗'),(-.01,.77,'右前窗')],1.98,2.52,offset=.045,r=.04)
 wiper(f,.50,2.00,.44)
 use('03');hx=f(-.62,H-.12)
 box('雙頭燈方殼',(hx+.02,-.62,H-.04),(.18,.40,.18),'ldcream',.03)
 for y in [-.72,-.52]:lamp('雙頭燈',lambda yy,zz:hx+.02,y,H-.04,.055)
 for side in [-1,1]:lamp('尾燈',f,side*.88,1.10,.05,red=True)
 grille('車底柵格板',f(0,.85)-.30,0,.60,1.00,.30,False,6)
 # 另一端：中央貫通門、兩扇端窗、尾燈；做在 +X 再轉到 -X。
 start=len(p.MODEL)
 front_panel('貫通門門縫',f,0,1.66,.66,1.66,'frame',.03,.026)
 front_panel('貫通門下半',f,0,(.86+bz)/2,.60,bz-.86,'ldyellow',.02,.034)
 front_panel('貫通門上半',f,0,(bz+2.46)/2,.60,2.46-bz,'ldcream',.02,.034)
 front_glass(f,[(-.17,.17,'貫通門窗'),(-.95,-.50,'端窗'),(.50,.95,'端窗')],1.98,2.46,offset=.045,r=.04)
 for side in [-1,1]:lamp('尾燈',f,side*.88,1.10,.05,red=True)
 R=Matrix.Rotation(math.pi,4,'Z')
 for o in p.MODEL[start:]:o.matrix_world=R@o.matrix_world
 for end in [-1,1]:knuckle_coupler(end*f(0,.85),end,.66)
 use('05')
 for x in [-2.75,-1.65,-.55,.55,1.65,2.75]:box('方形通風罩',(x,0,H+.05),(.30,.30,.12),'ldroof',.03)
 for cx in [-(L/2-1.45),L/2-1.45]:loco_truck(cx,W,2,.30,.58)
 underfloor([-.40,.80],W,'chassis',1.0)
 use('04');cyl('燃油箱',(-1.30,0,.64),.18,.70,'chassis','X',24)
 s['pantos']=0;s['axles']=2

BUILDERS['ldr2200']=ldr2200

def shengli(s):
 """台糖汽油客車「勝利號」538（日立製作所 1949 年製，762 mm 糖鐵，1954 年改柴油；2023 年整修後在新營糖廠假日行駛）。
 參考：Commons Wengch 2023-06 新營站兩端斜前（CC BY-SA 4.0）、SSR2000 成功號 562 側面對照；尺寸 zh.wikipedia 台糖汽油車（10,744／2,200／3,270）。
 寶藍車身、窗下白腰帶、窗上白色上帶、黑色圓拱頂；端面白腰帶下方一塊白色淺 V 收到緩衝梁，端面三扇青綠框窗（窄窗、中窗、帶雨刷的擋風），
 車頂前緣托架上一盞圓頭燈、兩角橘色標示燈；側面青綠窗框、中段一扇青綠拉門，兩端側門配白色直立扶手；緩衝梁一側紅色圓牌；兩個二軸轉向架。"""
 L,W,H=s['L'],s['W'],s['H']
 color('slblue','1A34A0',.06,.36,.28);color('slroof','1E2026',.10,.50,.10);color('slteal','218C84',.05,.40,.22);color('slorange','E0622A',.05,.40,.22)
 bz=1.80;uz=H-.36
 zones=[(bz-.06,'slblue'),(bz+.06,'white'),(uz-.26,'slblue'),(uz,'white'),(H+1,'slroof')]
 profile=[(.80,L/2-.04),(1.00,L/2),(H-.50,L/2-.02),(H-.24,L/2-.12),(H,L/2-.36)]
 f,neck=zoned_shell(s,profile,.12,zones,zones,double=True)
 # 一端車頭（+X），做完旋轉複製到另一端。
 start=len(p.MODEL);hw=W/2-.12
 front_patch('端面白色淺 V',f,-hw,hw,lambda y:1.00+(bz-.06-1.00)*(abs(y)/hw)**1.2,bz-.05,'white',.028,cols=24,rows=6)
 for y,w,name in [(-.68,.30,'窄端窗'),(-.12,.42,'中端窗'),(.48,.62,'擋風玻璃')]:
  front_panel('青綠窗框',f,y,2.24,w+.10,.66,'slteal',.06 if w<.6 else .11,.03)
  front_glass(f,[(y-w/2,y+w/2,name)],1.96,2.52,offset=.045,r=.04 if w<.6 else .09)
 wiper(f,.40,1.98,.45)
 front_ribbon('白色直立扶手',f,[(-.40,1.30),(-.40,2.40)],.026,'white')
 use('03');hx=f(0,H-.06)+.02
 rod('頭燈托架',(hx-.12,0,H-.02),(hx+.04,0,H+.10),.022,'slroof')
 cyl('頭燈燈殼',(hx+.06,0,H+.14),.10,.16,'slroof','X',24)
 lamp('圓頭燈',lambda y,z:hx+.06,0,H+.14,.075)
 for side in [-1,1]:cyl('橘色標示燈',(f(side*.82,H-.30)+.05,side*.82,H-.24),.045,.06,'slorange','X',16)
 x=f(0,.85)
 use('07');box('緩衝梁',(x-.02,0,.70),(.14,W*.90,.24),'chassis',.02)
 cyl('紅色圓牌',(x+.06,.70,.98),.13,.02,'red','X',28,.004)
 box('箱形車鉤',(x+.14,0,.66),(.22,.30,.18),'chassis',.03)
 rod('車鉤銷',(x+.20,0,.56),(x+.20,0,.80),.016,'metal')
 for side in [-1,1]:box('端部踏階',(x-.30,side*(W/2-.02),.56),(.36,.16,.03),'metal',.005)
 copy_rotated(list(p.MODEL[start:]))
 # 側面：兩端側門（白色直立扶手）、中段一扇青綠拉門、青綠框窗；兩側點對稱。
 seq=[('w',.50)]+[('n',.32)]*5+[('d',.50),('n',.32),('w',.50)];gap=.10;x=-2.15
 slots=[]
 for k,w in seq:slots.append((k,x+w/2,w));x+=w+gap
 for side in [-1,1]:
  y=side*(W/2+.018)
  for k,xc,w in slots:
   xc=xc*side
   if k=='d':
    use('02');panel('拉門青綠框',(xc,y,1.70),w+.06,1.66,'slteal',r=.03,depth=.010)
    panel('青綠拉門',(xc,y+side*.008,1.70),w,1.60,'slteal',r=.03,depth=.012)
    panel('拉門窗',(xc,y+side*.020,2.20),w*.56,.58,'glass',r=.03,depth=.008)
    box('拉門踏階',(xc,side*(W/2-.02),.60),(.40,.16,.03),'metal',.005)
   else:framed_window(xc,y,2.23,w,.58,'slteal')
  for xe in [-2.45,2.45]:
   use('02');panel('側門門縫',(xe,y,1.70),.44,1.66,'frame',r=.03,depth=.010)
   panel('側門',(xe,y+side*.008,1.70),.38,1.60,'slblue',r=.03,depth=.012)
   box('側門白腰帶',(xe,y+side*.016,bz),(.38,.010,.12),'white',.002)
   box('側門白上帶',(xe,y+side*.016,uz-.13),(.38,.010,.26),'white',.002)
   framed_window(xe,y+side*.022,2.23,.24,.50,'slteal')
   for dx in [-.25,.25]:rod('白色直立扶手',(xe+dx,y+side*.05,1.00),(xe+dx,y+side*.05,2.40),.014,'white')
   box('側門踏階',(xe,side*(W/2-.02),.56),(.36,.16,.03),'metal',.005)
  text_label(s.get('label','538'),(-.60*side,y+side*.012,1.48),.07,'side',side)
  box('雨水槽',(0,side*(half_width(s,uz)+.012),uz),(L-.70,.03,.03),'slroof',.006)
 use('05')
 for x in [-2.0,-1.0,0,1.0,2.0]:box('黑色方形通風罩',(x,0,H+.05),(.26,.26,.10),'slroof',.03)
 for cx in [-(L/2-1.25),L/2-1.25]:loco_truck(cx,W,2,.28,.60)
 underfloor([.10],W,'chassis',1.20)
 use('04');cyl('排氣消音器',(-1.10,W*.22,.62),.10,.70,'chassis','X',20);cyl('燃油箱',(-1.10,-W*.20,.64),.15,.60,'chassis','X',20)
 s['pantos']=0;s['axles']=2

BUILDERS['shengli']=shengli
