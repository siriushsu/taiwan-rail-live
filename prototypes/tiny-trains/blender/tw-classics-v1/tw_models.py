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
