"""台灣車隊精修共用件。zoned_shell、front_patch、front_glass、half_width、ramp、lamp_color 照世界車 world-v1 的 world_models.py
（分支 claude/world-fleet-garage 07328d3e…ec2c3188，2026-10-28 定稿的精細度）原樣搬過來；emu_body 是它 commuter 的台灣版：
受電弓、冷氣、乘務員門、第三軌集電靴改成看規格，台鐵電聯車的駕駛車多半沒有受電弓。"""
import math,bpy,bmesh
import blender_parts as p
from blender_parts import *
from build_models import interp,front_panel,front_poly,front_ribbon,sidewindow

def color(key,h,metal=.10,rough=.38,coat=.18):
 p.M[key]=mat(key,h,metal,rough,coat);return key

def zoned_shell(s,profile,bow,zones,front_zones,name='分色主車殼',nose_zones=None,surface_neck=False):
 """圓角車殼；同一張網格依高度分塗裝（車身、車頂邊帶、車頂），車頭面另有自己的分區。
 zones／front_zones：[(z 上限, 材質), ...]，由下往上；z 列會插在每個分界上，色界不切過面。
 nose_zones：駕駛室肩部（neck 到車頭面那一段側面）另用的分區。
 s['bowPow']：車頭平面曲線的次方，預設 4（平頭圓角）；越小越接近 V 字尖頭。
 surface_neck：neck 從實際車頭面（含 bow）最後退的點算，避免車頭頂角退到 neck 之後折出破面。"""
 L,W,H=s['L'],s['W'],s['H'];z0=s.get('bottom',.83);rb=s.get('radiusBottom',.12);rt=s.get('radiusTop',.40);end=L/2;pw=s.get('bowPow',4)
 def f(y,z):return interp(profile,z)-bow*(abs(y)/(W/2))**pw
 def half(z):
  if z<z0+rb:d=z0+rb-z;return W/2-rb+math.sqrt(max(0,rb*rb-d*d))
  if z>H-rt:d=z-(H-rt);return W/2-rt+math.sqrt(max(0,rt*rt-d*d))
  return W/2
 base=[z0+(H-z0)*i/40 for i in range(41)]
 cuts=[z for z,_ in zones+front_zones+(nose_zones or []) if z0<z<H]
 zs=sorted(set(round(z,4) for z in base+cuts))
 top=[(half(H)*(1-2*j/16),H) for j in range(1,16)];bottom=[(half(z0)*(-1+2*j/16),z0) for j in range(1,16)]
 ring=[(half(z),z) for z in zs]+top+[(-half(z),z) for z in reversed(zs)]+bottom
 n=len(ring);verts=[];neck=min(x for z,x in profile)-.06
 if surface_neck:neck=min(neck,min(f(y,z) for y,z in ring)-.06)
 for x in [-L/2,-L/2+.10,neck,None]:
  for y,z in ring:verts.append((f(y,z) if x is None else x,y,z))
 faces=[tuple(reversed(range(n)))]+[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(3) for i in range(n)]
 side_faces=len(faces);start=len(verts);cols=16
 for z in zs:
  for j in range(cols+1):
   y=half(z)*(2*j/cols-1);verts.append((f(y,z),y,z))
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
 nose0=1+2*n
 for i,poly in enumerate(d.polygons):
  zc=sum(d.vertices[v].co.z for v in poly.vertices)/len(poly.vertices)
  table=front_zones if i>=side_faces else nose_zones if nose_zones and i>=nose0 else zones
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
 """漸層色帶：stops=[(t, 'RRGGBB'), ...]，切成 n 段、每段一個材質，回傳材質名清單（照片上的漸層用分段近似）。"""
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

def lamp_pair(f,y,z,inner,red_outer=True,r=.050,gap=.13,housing='frame',hw=.36,hh=.17):
 """台灣車頭常見的燈座：黑色圓角燈座裡一白一紅（頭燈靠內或靠外看 inner）。y 是燈座中心。"""
 front_panel('頭尾燈燈座',f,y,z,hw,hh,housing,.07,.035)
 side=1 if y>0 else -1;yi=y-side*gap/2 if inner else y+side*gap/2;yo=y+side*gap/2 if inner else y-side*gap/2
 lamp('頭燈',f,yi,z,r);lamp('尾燈',f,yo,z,r*.92,red=red_outer)

def emu_body(s,profile,bow,zones,front_zones,nose_zones=None,leaf='body',gaps=None,bands=(),leafbands=(),deco=None,crew=None):
 """台灣電聯車／捷運車殼與車側（world-v1 commuter 的台灣版）。
 bands／leafbands：[(中心 z, 高, 材質), ...] 車身與門扇上的水平色帶；deco(x, y, side, dw) 讓各款在每組門旁加自己的塗裝。
 規格鍵：doors、doorW、rearDoor、frontDoor、winH、winZ（窗中心，預設 H-1.10）、doorTop（門頂，預設 H-.62）、
 crewDoor（駕駛室側門，捷運預設沒有）、acUnits [(x, 長), ...]、pantos（這節有沒有受電弓）、pantoX、shoes（第三軌集電靴）。"""
 L,W,H=s['L'],s['W'],s['H'];n=s['doors'];dw=s.get('doorW',.80)
 f,neck=zoned_shell(s,profile,bow,zones,front_zones,nose_zones=nose_zones,surface_neck=True)
 a=-L/2+s.get('rearDoor',1.35);b=neck-s.get('frontDoor',1.29)
 doors=[a+(b-a)*i/(n-1) for i in range(n)] if n>1 else [(a+b)/2]
 zc=s.get('winZ',H-1.10);wh=s.get('winH',.90);top=s.get('doorTop',H-.62);dz=s.get('doorWinZ',zc-.02);dh=s.get('doorWinH',.86)
 for z,h,m in bands:
  y=half_width(s,z)+.012
  for side in [-1,1]:box('側面色帶',(( -L/2+.06+neck+.04)/2,side*y,z),(neck+.04+L/2-.06,.020,h),m,.004)
 crew_on=s.get('crewDoor',False);front_end=neck-(.66 if crew_on else s.get('cabWin',.30))
 for side in [-1,1]:
  y=side*(W/2+.018)
  spans=list(zip([-L/2+.38]+[d+dw/2+.12 for d in doors],[d-dw/2-.12 for d in doors]+[front_end]))
  for k,(u,v) in enumerate(spans):
   if v-u<.22:continue
   m=gaps[k] if gaps else (2 if v-u>.7 else 1);gap=.06
   for i in range(m):
    w=(v-u-gap*(m-1))/m;sidewindow(u+w/2+i*(w+gap),y,zc,w-.04,wh,r=s.get('winR',.06))
  for i,x in enumerate(doors):
   use('02');basez=.92;h=top-basez;cz=basez+h/2
   panel('側門門框',(x,y,cz),dw+.05,h+.03,'frame',r=.03)
   for lf in range(2):
    dx=(lf-.5)*dw/2;lw=dw/2-.022
    door=panel('獨立門扇',(x+dx,y+side*.023,cz),lw,h,leaf,r=.025,depth=.024)
    door['side_door']=True;door['door_group']=i+1;door['side']=side;door['leaf']=lf
    panel('門窗嵌框',(x+dx,y+side*.043,dz),lw*.62+.04,dh+.06,'frame',r=.04)
    panel('門窗玻璃',(x+dx,y+side*.057,dz),lw*.62,dh,'glass',r=.035,depth=.012)
    for z,hh,mm in leafbands:box('門扇色帶',(x+dx,y+side*.050,z),(lw,.011,hh),mm,.002)
   box('車門踏板',(x,y+side*.01,.90),(dw+.08,.11,.042),'metal',.008)
   if deco:deco(x,y,side,dw)
  if crew_on:
   use('02');cx=neck-.36
   panel('乘務員門框',(cx,y,1.86),.46,1.90,'frame',r=.03)
   c=panel('乘務員門扇',(cx,y+side*.022,1.86),.40,1.84,crew or leaf,r=.025,depth=.022);c['side_door']=True;c['crew_door']=True
   panel('乘務員門窗',(cx,y+side*.045,zc-.05),.24,.80,'glass',r=.03,depth=.012)
   rod('乘務員扶手',(cx-.25,y+side*.06,1.30),(cx-.25,y+side*.06,2.40),.016,'metal')
 use('05')
 for ax,al in s.get('acUnits',[(s.get('acX',.55),s.get('acL',2.2))]):
  box('冷氣機罩',(ax,0,H+.10),(al,W*.60,.20),s.get('acMat','roof'),.08)
  for k in range(8):box('冷氣罩頂部格柵',(ax-al*.38+k*al*.108,0,H+.205),(.035,W*.44,.01),'chassis',.002)
  for side in [-1,1]:grille('冷氣側格柵',ax,side*W*.30,H+.09,al*.7,.11,True,5)
 if s.get('pantos',0):pantograph(s.get('pantoX',-L*.28),H)
 box('車頂天線底座',(neck-.9,0,H+.03),(.20,.16,.05),'chassis',.012)
 rod('列車無線天線',(neck-.9,0,H+.05),(neck-.9,0,H+.22),.010,'chassis')
 bogies(L,W,r=.36)
 if s.get('shoes'):
  use('04')
  for c in [-L*.31,L*.31]:
   for side in [-1,1]:box('第三軌集電靴',(c,side*(W*.42),.42),(.42,.10,.06),'metal',.01)
 coupler(f(0,.83)+.16,W)
 coupler(-L/2-.03,W,-1,gangway=True)
 return f,neck,doors
