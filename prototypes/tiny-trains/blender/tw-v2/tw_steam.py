"""蒸汽機車三款：CK124（日本 C12 形水櫃車）、CT273（C57 形）、DT668（D51 形）。
舊車模（fleet-v1 的 steam()）三款共用一個車身，這裡照 Commons 照片重做：高度照實車比例略縮，長度沿用 CT250 的 Q 版壓縮；
CT273、DT668 共用煤水車與閥動裝置，鍋爐上的東西各做各的；CK124 是水櫃車，另寫一支。
參考照片只在本機比對，檔名、作者、授權記在 catalog-source.json 的 photos；不放營運商標。車號牌是可移除的示意字牌。"""
import math
from mathutils import Matrix
from mathutils.geometry import tessellate_polygon
import blender_parts as p
from tw_specs import add
from tw_models import *
from tw_classic import ct_plate,ct_strip,ct_bar,ct_wheel,ty_lathe,ty_xplate

add('ck124','steam',L=7.7,W=2.8,H=3.75,drivers=3,driverRadius=.60,leading=1,trailing=1,tank=True,body='101314',accent='E4B73A',power='steam',label='CK 124')
add('ct273','steam',L=12.0,W=2.8,H=3.95,drivers=3,driverRadius=.80,leading=2,trailing=1,tank=False,body='101314',accent='C8262A',power='steam',label='CT273')
add('dt668','steam',L=12.0,W=2.8,H=3.95,drivers=4,driverRadius=.66,leading=1,trailing=1,tank=False,body='101314',accent='C8262A',power='steam',label='DT668')

def st_colours():
 """亮黑車身、霧黑底盤、花紋鋼板、紅連桿、車牌紅與金；stlens 是不發光的後端燈鏡片（lamp 只放車頭端，裁示 55）。"""
 for k in ['stblack','ctblack']:color(k,'101314',.28,.38,.30)
 color('stsoot','1A1D1F',.25,.60,.05);color('stcheck','2E3336',.40,.55,.05);color('stcoal','131415',.05,.88,0)
 color('stvoid','060708',0,.90,0);color('strod','C8262A',.10,.35,.25);color('stplate','C22A26',.10,.35,.25)
 color('stgold','D2AC48',.60,.35,.20);color('stline','E4B73A',.05,.40,.10);color('stband','7E5236',.45,.40,.15);color('stlens','E9E3C8',.10,.30,.30)
 m=p.M['identity'];rgb=[p.linear(int('E8C76A'[i:i+2],16)/255) for i in (0,2,4)]
 m.diffuse_color=(*rgb,1);m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(*rgb,1)

def st_pipe(name,pts,r,material,n=6):
 for a,b in zip(pts,pts[1:]):rod(name,a,b,r,material,n)

def st_loft(name,rings,material,rb=.16,bevel=.01,nb=4,nt=6):
 """沿 X 放樣：rings=[(x, 半寬, 底, 頂, 上圓角), ...]，下兩角圓角 rb（煤水車水櫃的圓下緣）。"""
 secs=[(x,loaf(2*hw,zb,zt,rb,rt,nb,nt)) for x,hw,zb,zt,rt in rings];n=len(secs[0][1]);k=len(secs)
 v=[(x,y,z) for x,sec in secs for y,z in sec]
 f=[tuple(range(n)),tuple(range((k-1)*n,k*n))]+[(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for i in range(k-1) for j in range(n)]
 return mesh(name,v,f,material,bevel,True)

def st_ring_y(name,x,y,z,r0,r1,t,material,n=40):
 """Y 向圓環板（輪箍白線）：中心 (x, y, z)、內外半徑、厚 t。"""
 v=[]
 for d in [-t/2,t/2]:
  for r in [r0,r1]:v+=[(x+r*math.cos(2*math.pi*i/n),y+d,z+r*math.sin(2*math.pi*i/n)) for i in range(n)]
 f=[]
 for a,b in [(0,1),(1,3),(3,2),(2,0)]:f+=[(a*n+i,a*n+(i+1)%n,b*n+(i+1)%n,b*n+i) for i in range(n)]
 return mesh(name,v,f,material)

def st_ring_x(name,x,y,z,r0,r1,t,material,n=40):
 """X 向圓環板（煙箱門框、窗框）。"""
 v=[]
 for d in [-t/2,t/2]:
  for r in [r0,r1]:v+=[(x+d,y+r*math.cos(2*math.pi*i/n),z+r*math.sin(2*math.pi*i/n)) for i in range(n)]
 f=[]
 for a,b in [(0,1),(1,3),(3,2),(2,0)]:f+=[(a*n+i,a*n+(i+1)%n,b*n+(i+1)%n,b*n+i) for i in range(n)]
 return mesh(name,v,f,material)

def st_holed_disc(name,x,y,z,r,t,holes,material,n=40):
 """Y 向實心圓盤開真的孔（箱形輪心）：holes=[[(x, z), ...], ...]；tessellate_polygon 會把內圈當孔。"""
 loops=[[(x+r*math.cos(2*math.pi*i/n),z+r*math.sin(2*math.pi*i/n)) for i in range(n)]]+holes
 flat=[q for l in loops for q in l];m=len(flat);tris=tessellate_polygon([[(a,b,0) for a,b in l] for l in loops])
 v=[(a,y-t/2,b) for a,b in flat]+[(a,y+t/2,b) for a,b in flat]
 f=[tuple(q) for q in tris]+[tuple(i+m for i in q) for q in tris];o=0
 for l in loops:
  k=len(l);f+=[(o+i,o+(i+1)%k,o+(i+1)%k+m,o+i+m) for i in range(k)];o+=k
 return mesh(name,v,f,material)

def st_noise(i,j):
 v=math.sin(i*12.9898+j*78.233)*43758.5453
 return v-math.floor(v)

def st_coal(xa,xb,ya,zr,hgt,gx,gy,chunks):
 """煤堆：格網高度用雜湊亂數，上面撒不規則煤塊；zr 是外緣高度。"""
 ix=lambda i,j:i*(gy+1)+j
 hz=lambda i,j:zr+.03+hgt*math.sin(math.pi*i/gx)**.7*math.sin(math.pi*j/gy)**.6+.11*(st_noise(i,j)-.5) if 0<i<gx and 0<j<gy else zr-.02
 ring=[ix(i,0) for i in range(gx+1)]+[ix(gx,j) for j in range(1,gy+1)]+[ix(i,gy) for i in range(gx-1,-1,-1)]+[ix(0,j) for j in range(gy-1,0,-1)]
 mesh('煤堆',[(xa+(xb-xa)*(i+.5*(st_noise(j,i)-.5)*(0<i<gx))/gx,-ya+2*ya*(j+.5*(st_noise(i+7,j)-.5)*(0<j<gy))/gy,hz(i,j)) for i in range(gx+1) for j in range(gy+1)],
  [(ix(i,j),ix(i+1,j),ix(i+1,j+1),ix(i,j+1)) for i in range(gx) for j in range(gy)]+[tuple(ring)],'stcoal')
 for k in range(chunks):
  a,b,c=st_noise(k,1),st_noise(k,2),st_noise(k,3);x=xa+.10+(xb-xa-.20)*a;y=(2*b-1)*(ya-.14);r=.07+.08*c
  h=zr+.03+hgt*math.sin(math.pi*(x-xa)/(xb-xa))**.7*math.cos(math.pi*y/(2*ya))**.6
  mesh('煤塊',[(x+r,y,h),(x-r*.8,y+r*.3,h),(x,y+r*.9,h+r*.2),(x+r*.2,y-r,h),(x-r*.1,y,h+r*.8),(x+r*.1,y+r*.1,h-r*.5)],[(0,2,4),(2,1,4),(1,3,4),(3,0,4),(0,5,2),(2,5,1),(1,5,3),(3,5,0)],'stcoal')

def st_tire(x,y,R):
 """輪箍：外圈鋼面黑、外側一圈寬白線（照片上輪箍外緣整圈白）。"""
 use('04');s=1 if y>0 else -1
 o=st_ring_y('輪箍',x,y,R,R-.11,R,.14,'stblack',48);o['wheel_center']=True;o['radius']=R
 torus_y('輪緣',(x,y-s*.06,R),R*.95,.02,'stblack',n=40,m=4)
 st_ring_y('輪箍白線',x,y+s*.073,R,R-.105,R-.012,.008,'white',48)
 return o

def st_box_wheel(x,y,R,th,heavy=False,n=7):
 """箱形輪心動輪（C57、D51）：輪心一圈大孔、曲柄對面的配重塊填滿一段；th 是曲柄角度。"""
 st_tire(x,y,R);s=1 if y>0 else -1;c=th+math.pi;da=math.radians(135 if heavy else 95);rc=R*.56;a0=c+da/2;step=(2*math.pi-da)/n;holes=[]
 for k in range(n):
  a=a0+step*(k+.5);hx,hz=x+rc*math.cos(a),R+rc*math.sin(a);ra,rt=R*.21,rc*step*.36
  holes.append([(hx+ra*math.cos(b)*math.cos(a)-rt*math.sin(b)*math.sin(a),hz+ra*math.cos(b)*math.sin(a)+rt*math.sin(b)*math.cos(a)) for b in [2*math.pi*i/12 for i in range(12)]])
 st_holed_disc('箱形輪心',x,y,R,R-.09,.11,holes,'stblack')
 pts=[(x+(R-.10)*math.cos(c+da*(i/8-.5)),R+(R-.10)*math.sin(c+da*(i/8-.5))) for i in range(9)]
 pts+=[(x+R*.34*math.cos(c+da*.8*(.5-i/8)),R+R*.34*math.sin(c+da*.8*(.5-i/8))) for i in range(9)]
 ct_plate('動輪配重',pts,y+s*.05,y+s*.085,'stblack')
 cyl('輪轂',(x,y+s*.04,R),R*.24,.13,'stblack','Y',20,0);cyl('輪軸端蓋',(x,y+s*.11,R),R*.13,.03,'metal','Y',14,0)

def st_small_wheel(x,y,R):
 """先輪、從輪：整片輪心，輪箍白線。"""
 st_tire(x,y,R);s=1 if y>0 else -1
 cyl('輪心',(x,y,R),R-.09,.09,'stblack','Y',28,0);cyl('輪轂',(x,y+s*.04,R),R*.32,.12,'stblack','Y',20,0);cyl('輪軸端蓋',(x,y+s*.10,R),R*.15,.03,'metal','Y',14,0)

def st_plate_front(x,z,w,h,text,size):
 """煙箱門車號牌：紅底、金框、金字。"""
 use('03');panel('煙箱門車號牌框',(x,0,z),w,h,'stgold','front',r=.015,depth=.016);panel('煙箱門車號牌',(x+.010,0,z),w-.05,h-.05,'stplate','front',r=.010,depth=.012)
 text_label(text,(x+.022,0,z),size)

def st_plate_side(x,y,z,w,h,text,size):
 use('01');side=1 if y>0 else -1
 panel('駕駛室側車號牌框',(x,y,z),w,h,'stgold',r=.015,depth=.016);panel('駕駛室側車號牌',(x,y+side*.010,z),w-.05,h-.05,'stplate',r=.010,depth=.012)
 text_label(text,(x,y+side*.022,z),size,'side',side)

def st_lathe_x(name,x,z,prof,material,n=48):
 """繞 X 軸的旋轉面：prof=[(半徑, x 位移), ...]，半徑 0 是極點；外圈補一片底面封口。"""
 v,rings=[],[]
 for r,dx in prof:
  if r<1e-6:rings.append([len(v)]);v.append((x+dx,0,z))
  else:rings.append(list(range(len(v),len(v)+n)));v+=[(x+dx,r*math.cos(2*math.pi*i/n),z+r*math.sin(2*math.pi*i/n)) for i in range(n)]
 f=[tuple(rings[0])]
 for a,b in zip(rings,rings[1:]):
  if len(b)==1:f+=[(a[i],a[(i+1)%n],b[0]) for i in range(n)]
  else:f+=[(a[i],a[(i+1)%n],b[(i+1)%n],b[i]) for i in range(n)]
 return mesh(name,v,f,material,0,True)

def st_door(xs,bz,R,wheel=True):
 """煙箱門：外框、門扣一圈、右側（+Y）兩條鉸鏈、中央手輪與下方把手。xs 是門面 x，R 是煙箱半徑。"""
 use('03');st_ring_x('煙箱門框',xs-.02,0,bz,R-.10,R+.02,.08,'stblack',56)
 st_lathe_x('煙箱門',xs,bz,[(R-.085,-.04),(R-.10,.012),(R*.68,.042),(R*.34,.056),(0,.06)],'stblack',56)
 for i in range(10):
  a=2*math.pi*(i+.5)/10;box('煙箱門扣',(xs+.03,(R-.04)*math.cos(a),bz+(R-.04)*math.sin(a)),(.05,.09,.09),'stblack',0)
 for z in [bz+.30,bz-.34]:
  box('煙箱門鉸鏈',(xs+.056,R*.50,z),(.022,R*.88,.055),'stblack',0);cyl('鉸鏈軸',(xs+.03,R*.92,z),.030,.13,'stblack','Z',10,0)
 if wheel:
  st_ring_x('煙箱門手輪',xs+.105,0,bz,.09,.115,.02,'stblack',20)
  for k in range(4):rod('手輪輻',(xs+.105,0,bz),(xs+.105,.10*math.cos(math.pi*k/2),bz+.10*math.sin(math.pi*k/2)),.011,'stblack',6)
  cyl('手輪轂',(xs+.08,0,bz),.03,.07,'stblack','X',12,0)
  rod('煙箱門把手',(xs+.07,0,bz-.10),(xs+.07,0,bz-.34),.012,'stblack',6)
 rod('煙箱門把手',(xs+.05,-R*.62,bz+.02),(xs+.05,-R*.62,bz+.30),.011,'stblack',6)

def st_lamp(x,z,r=.115):
 """煙箱上方前燈：圓筒燈殼、頂上通風罩、底座。"""
 use('03');box('前燈座',(x-.06,0,z-r-.085),(.30,.26,.05),'stblack',0);box('前燈支架',(x-.10,0,z-r-.04),(.12,.12,.06),'stblack',0)
 cyl('前燈燈殼',(x-.08,0,z),r+.035,.26,'stblack','X',24,.006);box('前燈頂罩',(x-.14,0,z+r+.05),(.13,.13,.05),'stblack',0)
 lamp('煙箱上方前燈',lambda y,zz:x-.03,0,z,r)

def st_chimney(x,zb,r,zt,flare):
 """煙囪：喇叭狀基座、直筒、上緣；頂面內部是黑的。"""
 use('05');ty_lathe('煙囪',x,0,[(flare,zb),(flare*.80,zb+.07),(r+.05,zb+.16),(r,zb+.26),(r+.015,zt-.09),(r+.04,zt-.07),(r+.04,zt),(r-.03,zt),(r-.03,zt-.14),(0,zt-.14)],'stblack',36,(5,6,7,8))

def st_pilot(xb,W,zt):
 """排障器：直柵往下往前斜、兩道橫桿、兩側立柱與下緣框。"""
 use('04');zb=.14
 for i in range(9):
  y=-.88+i*.22;rod('排障器直柵',(xb+.26,y,zb),(xb+.10,y,zt),.032,'stblack',6)
 box('排障器上板',(xb+.10,0,zt),(.16,2.06,.04),'stblack',0)
 for z,dx in [(.34,.21),(.56,.15)]:rod('排障器橫桿',(xb+dx,-.98,z),(xb+dx,.98,z),.020,'stblack',6)
 rod('排障器下緣',(xb+.26,-1.02,zb),(xb+.26,1.02,zb),.036,'stblack',8)
 for s in [-1,1]:rod('排障器立柱',(xb+.26,s*1.02,zb),(xb+.08,s*1.02,zt),.040,'stblack',8)

def st_coupler(x,end,z):
 """自動車鉤：鋼色鉤頭，一邊鉤爪一邊鉤舌；不是電聯車那種密著車鉤。"""
 use('07');box('車鉤座',(x,0,z),(.30,.52,.26),'stsoot',.02);box('自動車鉤本體',(x+end*.20,0,z),(.24,.26,.24),'metal',.02)
 box('車鉤鉤爪',(x+end*.34,.11,z),(.14,.16,.22),'metal',.02);box('車鉤鉤舌',(x+end*.31,-.13,z),(.10,.10,.20),'metal',.02)

def st_hose(xb,z,side=1):
 """空氣軟管：黑管垂到排障器，端頭紅色。"""
 use('07');y=side*.40
 st_pipe('空氣軟管',[(xb+.10,y,z+.02),(xb+.17,y-side*.02,z-.14),(xb+.20,y-side*.10,z-.28),(xb+.22,y-side*.26,z-.36)],.026,'rubber')
 cyl('軟管接頭',(xb+.22,y-side*.30,z-.37),.040,.10,'strod','Y',10,0)

def st_cladding(x,y,zc,zt,r,w):
 """汽缸外罩：圓底的鐵皮罩，上緣接到步道；側面鉚釘與檢查蓋。"""
 use('04');side=1 if y>0 else -1
 pts=[(x+w/2,zt),(x+w/2,zc)]+[(x+(w/2)*math.cos(math.pi*i/10),zc-r*math.sin(math.pi*i/10)) for i in range(1,10)]+[(x-w/2,zc),(x-w/2,zt)]
 ct_plate('汽缸外罩',pts,y-side*.34,y+side*.04,'stblack')
 cyl('汽缸側檢查蓋',(x+.08,y+side*.05,zc+.08),.11,.03,'stsoot','Y',16,0);cyl('檢查蓋中心',(x+.08,y+side*.07,zc+.08),.04,.02,'metal','Y',10,0)

def st_motion(side,dxs,main,R,crank,xc,zc,xh,xl,rod_r=(.11,.12)):
 """Walschaerts 閥動裝置：xc 汽缸中心、zc 高度、xh 十字頭、xl 擴張連桿。連結桿與主連桿紅色、其他鋼色，曲柄角度左右差 90 度。"""
 th=math.radians(-40 if side<0 else 50);px,pz=crank*math.cos(th),crank*math.sin(th);yw=1.02;y=side*yw
 use('04')
 for x in dxs:cyl('動輪曲柄銷',(x+px,side*(yw+.14),R+pz),.060,.14,'metal','Y',14,0)
 ct_bar('連結桿',(dxs[-1]+px,R+pz),(dxs[0]+px,R+pz),rod_r[0],.05,side*(yw+.17),'strod')
 ct_bar('主連桿',(xh,zc),(dxs[main]+px,R+pz),rod_r[1],.05,side*(yw+.25),'strod')
 for z in [zc+.115,zc-.115]:ct_bar('滑板',(xh-.24,z),(xc-.34,z),.04,.08,side*(yw+.13),'metal')
 box('十字頭',(xh,side*(yw+.13),zc),(.26,.14,.20),'metal',0);rod('活塞桿',(xh+.08,side*(yw+.12),zc),(xc-.34,side*(yw+.11),zc),.035,'metal',8)
 cyl('十字頭銷',(xh,side*(yw+.22),zc),.05,.10,'metal','Y',12,0)
 ct_bar('偏心桿',(dxs[main]+px+.05,R+pz+.12),(xl,zc+.20),.06,.04,side*(yw+.33),'metal')
 ct_bar('擴張連桿',(xl,zc+.18),(xl+.06,zc+.52),.09,.05,side*(yw+.29),'stblack')
 ct_bar('半徑桿',(xl+.03,zc+.40),(xh+.02,zc+.36),.06,.04,side*(yw+.29),'metal')
 ct_bar('結合桿',(xh+.04,zc+.38),(xh,zc-.10),.06,.04,side*(yw+.26),'metal')
 rod('閥桿',(xh+.04,side*(yw+.16),zc+.33),(xc-.28,side*(yw+.10),zc+.32),.02,'metal',6)

def st_cab(s,xf,xr,xp,zb,ze,zw,crown,win,plate,hw=1.36):
 """C57、D51 的駕駛室：側板從前牆到門柱全高、門柱之後只到腰線；前窗一扇、圓拱頂往後出簷、後端開放接煤水車。"""
 x0,x1,z0,z1=win
 for side in [-1,1]:
  ct_plate('駕駛室側板',[(xr,zb),(xf,zb),(xf,ze),(xp,ze),(xp,zw),(xr,zw)],side*(hw-.03),side*hw,'stblack')
  sidewindow((x0+x1)/2,side*hw,(z0+z1)/2,x1-x0,z1-z0,r=.05)
  rod('窗中框',(x0+(x1-x0)*.56,side*(hw+.02),z0),(x0+(x1-x0)*.56,side*(hw+.02),z1),.012,'frame',6)
  st_plate_side(plate[0],side*(hw+.002),plate[1],.86,.27,s['label'],.15)
  use('01');box('駕駛室下緣白帶',((xf+xr)/2,side*(hw+.006),zb+.04),(xf-xr,.012,.09),'white',0)
  for k in range(5):box('側板通風格',(plate[0]+.54+k*.035,side*(hw+.006),plate[1]),(.018,.012,.16),'frame',0)
  use('05');rod('駕駛室扶手',(xp-.05,side*(hw+.05),zb+.05),(xp-.05,side*(hw+.05),ze-.14),.018,'metal',8)
  rod('駕駛室扶手',(xr-.06,side*(hw+.03),zb-.12),(xr-.06,side*(hw+.03),zw+.42),.018,'metal',8)
  for z in [zb-.75,zb-.42]:box('司機踏階',(xr-.10,side*(hw-.08),z),(.36,.28,.04),'stsoot',0)
  rod('踏階吊架',(xr-.10,side*(hw+.05),zb-.77),(xr-.10,side*(hw+.05),zb),.018,'stsoot',6)
 use('01');top=lambda y:ze+(crown-ze)*(1-(y/(hw+.09))**2)
 wall=[(-hw+.02,zb),(hw-.02,zb)]+[(hw-.02-2*(hw-.02)*i/12,top(hw-.02-2*(hw-.02)*i/12)-.03) for i in range(13)]
 ty_xplate('駕駛室前牆',wall,xf-.07,xf,'stblack');box('駕駛室地板',((xf+xr)/2,0,zb+.04),(xf-xr,2*hw-.04,.06),'stsoot',0)
 box('駕駛室內部',((xf+xr)/2-.05,0,(zb+ze)/2),(xf-xr-.20,2*hw-.18,ze-zb-.10),'frame',0)
 k=14;roof=[(-hw-.09+2*(hw+.09)*i/k,top(-hw-.09+2*(hw+.09)*i/k)) for i in range(k+1)]
 ty_xplate('駕駛室圓拱頂',roof+[(y,z-.05) for y,z in reversed(roof)],xr-.30,xf+.10,'stsoot',True,{0,k,k+1,2*k+1})
 use('05');box('駕駛室頂通風器',((xf+xr)/2-.10,0,crown+.01),(.62,.40,.06),'stsoot',.01);rod('屋簷雨槽',(xr-.30,hw+.085,ze-.015),(xf+.10,hw+.085,ze-.015),.014,'stblack',6);rod('屋簷雨槽',(xr-.30,-hw-.085,ze-.015),(xf+.10,-hw-.085,ze-.015),.014,'stblack',6)
 use('02')
 for side in [-1,1]:
  st_ring_x('前牆圓窗框',xf+.006,side*.98,ze-.20,.10,.135,.03,'stblack',20);cyl('前牆圓窗',(xf+.004,side*.98,ze-.20),.11,.012,'glass','X',20,0)

def st_tender(s,x0,x1,zb,tz,zf,xc,rim,grille):
 """煤水車：水櫃圓下緣、平側板、前端上緣往下彎到駕駛室高度；兩組兩軸轉向架是鑄鋼側架加疊板彈簧。
 zf／xc：前端低處的高度、開始往上彎的 x。rim：上緣白線（DT668）。grille：八角格柵（DT668）或小工具箱。"""
 hw=1.36;sm=lambda t:t*t*(3-2*t);top=lambda x:zf+(tz-zf)*sm(min(1,max(0,(xc-x)/.55)))
 xs=[x0,x0+.10,xc-.70,xc-.55,xc-.42,xc-.28,xc-.14,xc,x1] if xc<x1 else [x0,x0+.10,x1]
 use('07');st_loft('煤水車車身',[(x,hw,zb,top(x),.11) for x in xs],'stblack',.20)
 if rim:
  pts=[(x,top(x)) for x in [x1,xc,xc-.14,xc-.28,xc-.42,xc-.55,x0+.02]]
  for side in [-1,1]:ct_strip('煤水車上緣白線',pts,side*(hw+.002),side*(hw+.010),.07,'white')
 # 前段煤櫃：擋煤板、起伏格網的煤堆、不規則煤塊。
 xa,xb=x0+1.30,(xc-.58 if xc<x1 else x1-.20)
 for side in [-1,1]:box('擋煤板',((xa+xb)/2,side*(hw-.05),tz+.07),(xb-xa+.2,.06,.14),'stblack',0)
 st_coal(xa,xb,1.22,tz,.30,12,9,70)
 # 後段水櫃頂：注水口、工具箱。
 use('07');cyl('水櫃注水口',(x0+.72,0,tz+.04),.28,.08,'stblack','Z',24,0);box('注水口把手',(x0+.72,0,tz+.10),(.30,.05,.04),'metal',0)
 box('水櫃頂工具箱',(x0+.32,-.72,tz+.07),(.34,.70,.14),'stblack',.01)
 for side in [-1,1]:
  rod('煤水車前端扶手',(x1-.04,side*(hw+.03),zb+.20),(x1-.04,side*(hw+.03),zf-.05),.018,'metal',8)
  if grille=='octagon':
   xg,zg,a,b=x1-.52,2.22,.30,.42;oc=[(xg-a+.10,zg-b),(xg+a-.10,zg-b),(xg+a,zg-b+.10),(xg+a,zg+b-.10),(xg+a-.10,zg+b),(xg-a+.10,zg+b),(xg-a,zg+b-.10),(xg-a,zg-b+.10)]
   ct_plate('側面八角格柵框',oc,side*(hw-.01),side*(hw+.03),'stcheck')
   for k in range(7):box('格柵條',(xg-.21+k*.07,side*(hw+.034),zg),(.038,.010,2*b-.18),'stvoid',0)
 # 底架、後端梁、梯子、後方燈（不發光鏡片）、紅色標識燈與車號牌。
 box('煤水車底架',((x0+x1)/2,0,zb-.06),(x1-x0+.06,2*hw+.08,.16),'stblack',0);box('底架側緣',((x0+x1)/2,0,zb-.17),(x1-x0-.1,2*hw-.10,.08),'stsoot',0)
 for side in [-1,1]:box('底架白線',((x0+x1)/2,side*(hw+.045),zb-.06),(x1-x0+.05,.012,.11),'white',0)
 box('煤水車後端梁',(x0-.02,0,zb-.14),(.12,2*hw-.06,.30),'stsoot',0)
 for yy in [-1.08,-.82]:rod('後端梯',(x0-.04,yy,1.10),(x0-.04,yy,tz-.08),.018,'metal',6)
 for z in [1.35,1.65,1.95,2.25,2.55,2.85,3.10]:rod('後端梯橫檔',(x0-.04,-1.08,z),(x0-.04,-.82,z),.014,'metal',6)
 use('03');box('後端燈座',(x0+.14,.80,tz+.06),(.20,.20,.08),'stblack',0);cyl('後端燈燈殼',(x0+.14,.80,tz+.18),.14,.28,'stblack','X',20,0)
 cyl('後端燈鍍鉻圈',(x0-.015,.80,tz+.18),.135,.03,'metal','X',24,0);cyl('後端燈鏡片',(x0-.035,.80,tz+.18),.11,.015,'stlens','X',24,0)
 cyl('標識燈座',(x0+.01,1.05,1.40),.08,.06,'stblack','X',16,0);cyl('後端標識燈',(x0-.03,1.05,1.40),.06,.04,'taillamp','X',16,0)
 # 兩組兩軸轉向架：鑄鋼側架（中間下凹、兩端軸箱）、上面疊板彈簧。
 L=x1-x0
 for c in [x0+L*.235,x1-L*.235]:
  use('04')
  for x in [c-.46,c+.46]:
   cyl('煤水車輪軸',(x,0,.38),.07,1.80,'stsoot','Y',12,0)
   for side in [-1,1]:
    st_tire(x,side*.96,.38);cyl('輪心',(x,side*.96,.38),.30,.09,'stblack','Y',24,0);cyl('輪軸端蓋',(x,side*1.04,.38),.06,.03,'metal','Y',12,0)
    box('軸箱',(x,side*1.17,.40),(.24,.12,.30),'stsoot',0)
  box('轉向架枕樑',(c,0,.80),(.36,2.30,.14),'stsoot',0)
  for side in [-1,1]:
   ct_plate('鑄鋼側架',[(c-.74,.70),(c-.34,.72),(c-.20,.52),(c+.20,.52),(c+.34,.72),(c+.74,.70),(c+.74,.46),(c+.34,.46),(c+.16,.30),(c-.16,.30),(c-.34,.46),(c-.74,.46)],side*1.09,side*1.15,'stsoot')
   for x in [c-.46,c+.46]:ct_plate('疊板彈簧',[(x-.34,.84),(x-.14,.78),(x+.14,.78),(x+.34,.84),(x+.20,.70),(x-.20,.70)],side*1.11,side*1.21,'stsoot')
 rod('機車與煤水車連結桿',(x1,0,.95),(x1+.20,0,.95),.05,'stsoot',8)
 st_coupler(x0-.12,-1,.70)

def big_steam(s,c):
 """CT273 與 DT668 共用的部分。c 給各款的尺寸與鍋爐上部件的位置；回傳煙箱門面 x。"""
 W=s['W'];R=s['driverRadius'];yw=1.02;bz,br,dxs,main=c['bz'],c['br'],c['dxs'],c['main'];xs=c['xs'];rs=br+.035;st_colours()
 rb=c['rb'];zlv=rb[1][1];xd=c['xdiag'];zdk=1.34
 # 步道：黑板、外緣白線，往前斜坡與甲板鋪花紋鋼板。
 use('01')
 for side in [-1,1]:
  ct_strip('兩側步道板',rb,side*.78,side*1.40,.06,'stblack');ct_strip('步道外緣白線',rb,side*1.40,side*1.415,.095,'white')
  ct_strip('步道斜坡花紋鋼板',[(x,z+.004) for x,z in rb if x>=xd[0]-.01],side*.80,side*1.38,.02,'stcheck')
  for x,z in c.get('steps',[]):box('甲板斜坡踏階',(x,side*1.08,z),(.20,.26,.03),'stsoot',0)
 box('前端甲板',((xs+.75+xd[1])/2,0,zdk-.03),(xs+.80-xd[1]+.40,2.70,.06),'stcheck',0);box('汽缸鞍座',(xd[0]+.25,0,1.30),(.80,1.40,.60),'stblack',0)
 box('煙箱下前牆',(xs-.08,0,(zdk+bz-rs+.05)/2),(.16,1.60,bz-rs+.05-zdk),'stblack',0)
 # 鍋爐與煙箱。
 x0=-.95;xb=xs-.84;cyl('圓筒鍋爐',((x0+xb)/2,0,bz),br,xb-x0+.20,'stblack','X',56,0);cyl('前煙箱',(xs-.42,0,bz),rs,.84,'stblack','X',56,0)
 for x in c['bands']:cyl('鍋爐箍帶',(x,0,bz),br+.012,.04,c.get('bandMat','stsoot'),'X',56,0)
 st_door(xs,bz,rs);st_plate_front(xs+.06,bz+rs*.60,rs*.92,.28,s['label'],.19)
 # 鍋爐兩側扶手、配管、放熱管、汽缸進汽管。
 use('05')
 for side in [-1,1]:
  line('鍋爐側扶手',[(-.92,side*(br+.09),bz+.36),(xs-.26,side*(br+.09),bz+.36)],.016,'metal')
  for x in [-.60,.70,2.00,3.20]:rod('扶手支架',(x,side*(br-.02),bz+.36),(x,side*(br+.09),bz+.36),.011,'metal',6)
  st_pipe('鍋爐側長管',[(-.92,side*(br+.05),bz-.34),(xs-1.0,side*(br+.05),bz-.34)],.024,'stsoot')
  st_pipe('鍋爐側長管',[(-.92,side*(br+.02),bz-.46),(xs-1.0,side*(br+.02),bz-.46)],.020,'stsoot')
 # 導煙板：下緣跟著斜坡，上緣圓角或切角；前緣有白飾線（DT668）；上方拉桿撐到煙箱。
 use('03');dp=c['deflector']
 for side in [-1,1]:
  ct_plate('導煙板',dp,side*1.36,side*1.40,'stblack')
  for a,b in zip(c['dline'],c['dline'][1:]):ct_bar('導煙板前緣白線',a,b,.05,.008,side*1.404,'white')
  rod('導煙板拉桿',(xs-.55,side*1.36,max(q[1] for q in dp)-.12),(xs-.55,side*.55,bz+.60),.012,'stblack',6)
  rod('導煙板前扶手',(xs+.08,side*1.44,zdk+.05),(xs+.08,side*1.44,2.60),.018,'metal',8)
 # 前端：緩衝梁、排障器、扶手、車鉤。
 xf=xs+.82;use('01');box('緩衝梁',(xf,0,1.05),(.18,2.70,.58),'stblack',0)
 for side in [-1,1]:
  box('緩衝梁端板',(xf+.09,side*1.10,1.05),(.03,.30,.50),'stsoot',0);rod('前端扶手柱',(xf-.06,side*1.26,zdk),(xf-.06,side*1.26,1.82),.020,'metal',8)
  box('前端踏階',(xf-.10,side*1.26,.56),(.22,.26,.035),'stsoot',0);rod('踏階吊架',(xf-.10,side*1.26,.58),(xf-.10,side*1.26,.76),.016,'stsoot',6)
 st_pipe('前端扶手',[(xf-.06,-1.26,1.82),(xf-.06,-.40,1.82),(xf-.06,-.30,1.72),(xf-.06,.30,1.72),(xf-.06,.40,1.82),(xf-.06,1.26,1.82)],.018,'metal',8)
 st_pilot(xf+.02,W,.76);st_hose(xf+.09,.80)
 st_coupler(xf+.14,1,.94)
 # 台枠、汽缸與外罩、灰箱。
 xc=c['xc'];zc=c['zc']
 for side in [-1,1]:
  box('主台枠',((x0-.95+xf)/2,side*.66,1.05),(xf-x0+.95,.10,.62),'stsoot',0)
  cyl('外置汽缸',(xc,side*1.12,zc),.27,.64,'stblack','X',28,0)
  st_cladding(xc,side*1.34,zc+.04,zlv+.02,.36,.86)
  box('導框支架',(xc-.82,side*1.02,1.34),(.08,.50,.54),'stsoot',0)
 box('灰箱',(-1.45,0,1.26),(1.00,1.30,.56),'stsoot',0)
 # 動輪與閥動裝置。
 for x in dxs:cyl('動輪軸',(x,0,R),.10,2*yw-.10,'stsoot','Y',16,0)
 for side,th in [(-1,math.radians(-40)),(1,math.radians(50))]:
  for i,x in enumerate(dxs):st_box_wheel(x,side*yw,R,th,i==main)
  st_motion(side,dxs,main,R,c['crank'],xc,zc,c['xh'],c['xl'])
 # 先輪、從輪。
 for x in c['lead']+[c['trail']]:
  r=.38 if x>0 else .40;cyl('先從輪軸',(x,0,r),.07,1.80,'stsoot','Y',12,0)
  for side in [-1,1]:st_small_wheel(x,side*.96,r)
 box('先台車架',(sum(c['lead'])/len(c['lead']),0,.52),(max(1.0,c['lead'][0]-c['lead'][-1]+.5),1.45,.14),'stsoot',0);box('從台車架',(c['trail'],0,.60),(.80,1.50,.14),'stsoot',0)
 return xs

def ct273(s):
 """CT273（日本 C57 形）。參考照見 catalog-source.json photos。
 C57 的特徵：箱形輪心大動輪三軸；前端甲板橫放給水溫水器；汽包與砂箱同一個長圓罩、頂上手輪與人孔；上窄下寬的大導煙板；鍋爐右側放熱管。
 比例照 Commons「CT273.jpg」（Wert4859）側前方與「CT273 at TRA Changhua Roundhouse.jpg」（ChS&Rh）正面量：正面 244 px/m，煙箱門中心 2.48、車號牌中心比門心高 .5、寬 .70。"""
 W=s['W'];bz,br=2.48,.84;zl=1.92;xs=4.73
 c=dict(bz=bz,br=br,dxs=[2.55,.89,-.77],main=1,xs=xs,xc=4.22,zc=1.02,xh=3.58,xl=3.20,crank=.38,lead=[4.98,4.14],trail=-2.08,
  rb=[(-.95,zl),(3.92,zl),(4.82,1.36),(5.45,1.36)],xdiag=(3.92,4.82),bands=[-.55,.25,1.05,2.40,3.20],steps=[(4.50,1.70),(4.20,1.86)],
  deflector=[(3.42,zl),(3.92,zl),(4.82,1.40),(4.82,3.10)]+[(4.64+.18*math.cos(math.pi/2*i/6),3.10+.18*math.sin(math.pi/2*i/6)) for i in range(1,7)]+[(3.60-.18*math.sin(math.pi/2*i/6),3.10+.18*math.cos(math.pi/2*i/6)) for i in range(7)],dline=[])
 xs=big_steam(s,c)
 # 甲板上的給水溫水器：橫放長筒、兩道箍帶、兩端端蓋。
 use('01');cyl('給水溫水器',(5.04,0,1.62),.27,1.96,'stblack','Y',32,.01)
 for y in [-.39,.39]:cyl('溫水器箍帶',(5.04,y,1.62),.282,.07,'stsoot','Y',32,0)
 for side in [-1,1]:cyl('溫水器端蓋',(5.04,side*.99,1.62),.24,.04,'stblack','Y',32,0)
 # 煙囪、前燈。
 st_chimney(4.08,3.17,.25,3.95,.36);st_lamp(4.58,3.56,.115)
 # 汽包砂箱一體罩：圓肩、前段稍低，頂上人孔與手輪。
 use('05')
 block('汽包砂箱一體罩',[(.52,.16,3.00,3.46,.10),(.58,.34,3.00,3.74,.28),(.70,.44,3.00,3.88,.40),(.92,.47,3.00,3.93,.44),(1.30,.47,3.00,3.94,.44),(1.62,.47,3.00,3.90,.44),(1.86,.45,3.00,3.82,.42),(2.02,.36,3.00,3.68,.30),(2.10,.18,3.00,3.46,.12)],'stblack',0)
 box('罩頂接縫',(1.30,0,3.93),(.03,.60,.02),'stsoot',0);cyl('罩頂人孔',(.95,0,3.94),.15,.04,'stblack','Z',20,0)
 cyl('砂箱手輪座',(1.62,0,3.91),.05,.07,'stblack','Z',12,0);st_ring_y('砂箱手輪',1.62,0,3.99,.07,.09,.016,'stblack',16)
 # 鍋爐上：安全閥、汽笛、渦輪發電機。
 for y in [-.15,.15]:cyl('安全閥',(-.30,y,3.42),.075,.20,'stband','Z',14,0)
 cyl('汽笛座',(.15,-.26,3.34),.05,.10,'stblack','Z',12,0);rod('汽笛',(.15,-.26,3.36),(.15,-.26,3.64),.038,'stband',10);cyl('汽笛口',(.15,-.26,3.66),.052,.05,'stband','Z',12,0)
 cyl('渦輪發電機',(-.62,.42,3.34),.13,.34,'stblack','X',16,0);rod('發電機排氣管',(-.62,.42,3.42),(-.62,.42,3.72),.024,'stblack',6)
 # +Y 側放熱管（U 形來回）、空氣壓縮機、主空氣筒；砂管從砂箱下到步道。
 for k in range(4):
  z=bz+.20-k*.12;st_pipe('放熱管',[(.15,1.02,z),(1.65,1.02,z)],.022,'stsoot',6)
  if k<3:st_pipe('放熱管彎頭',[(1.65 if k%2==0 else .15,1.02,z),(1.72 if k%2==0 else .08,1.04,z-.06),(1.65 if k%2==0 else .15,1.02,z-.12)],.022,'stsoot',6)
 for side in [-1,1]:
  st_pipe('砂管',[(1.90,side*.46,3.10),(2.06,side*.74,2.70),(2.14,side*.90,2.20),(2.16,side*.98,zl)],.016,'stsoot',6)
  st_pipe('砂管',[(1.75,side*.46,3.10),(1.60,side*.78,2.70),(1.56,side*.94,2.20),(1.55,side*.98,zl)],.016,'stsoot',6)
  st_pipe('砂管下段',[(2.16,side*1.00,zl-.06),(2.14,side*1.06,1.20)],.014,'stsoot',6)
  cyl('主空氣筒',(.75,side*1.14,1.68),.15,1.35,'stblack','X',18,0)
  rod('蒸汽管',(xs-.70,side*.80,bz-.30),(xs-.45,side*1.22,1.86),.05,'stblack',8)
 cyl('空氣壓縮機上缸',(-.45,1.20,2.25),.16,.42,'stblack','Z',18,0);cyl('空氣壓縮機下缸',(-.45,1.20,1.78),.19,.46,'stblack','Z',18,0);cyl('空氣壓縮機頂蓋',(-.45,1.20,2.48),.11,.04,'stsoot','Z',14,0)
 cyl('給水泵',(-.45,-1.20,2.18),.15,.60,'stblack','Z',18,0);cyl('給水泵頂蓋',(-.45,-1.20,2.50),.10,.05,'stsoot','Z',14,0)
 # 駕駛室、煤水車。
 use('01');st_cab(s,-.95,-2.46,-1.92,1.60,3.56,2.62,3.92,(-1.74,-1.04,2.68,3.36),(-1.45,2.28))
 st_tender(s,-6.20,-2.92,1.02,3.40,3.40,-2.92,False,'box')

def dt668(s):
 """DT668（日本 D51 形）。參考照見 catalog-source.json photos。
 D51 跟 C57 差在：動輪四軸、直徑小（1,400 mm）；給水溫水器橫放在煙箱頂、煙囪在它後面（前燈在它前面）；步道在第四動輪上方有一段拱起；
 甲板是中央方箱加兩顆紅色標識燈；導煙板上緣兩端切角、前緣有白飾線；煤水車上緣白線、前端彎下來接駕駛室、側面八角格柵。
 比例照 Commons「DT668 at TRA Changhua Roundhouse.jpg」（ChS&Rh）正面量 288 px/m：煙箱門心 2.56、溫水器中心比門心高 .88、直徑 .40、寬 1.5；
 「DT668 in Xinying.jpg」「TRA DT668 at Shanhua Station.jpg」量拱起長度與步道高差。"""
 W=s['W'];bz,br=2.56,.87;zl=1.98;xs=4.73
 hump=[(-.95,zl+.04),(-.55,zl+.04),(-.20,zl+.40),(.42,zl+.40),(.72,zl),(3.92,zl),(4.82,1.36),(5.45,1.36)]
 c=dict(bz=bz,br=br,dxs=[3.02,1.62,.22,-1.18],main=2,xs=xs,xc=4.24,zc=1.04,xh=3.62,xl=2.42,crank=.34,lead=[4.66],trail=-2.30,
  rb=hump,xdiag=(3.92,4.82),bands=[-.45,.60,1.70,2.90],bandMat='stband',steps=[(4.52,1.70),(4.22,1.88)],
  deflector=[(3.35,zl),(3.92,zl),(4.82,1.40),(4.82,3.12),(4.56,3.42),(3.62,3.42),(3.35,3.15)],dline=[(4.82,1.42),(4.82,3.12),(4.56,3.42)])
 xs=big_steam(s,c)
 # 甲板：中央方箱與兩顆紅色標識燈（前面車頭端看是紅的，白天不亮）。
 use('01');box('甲板中央方箱',(5.00,0,1.62),(.50,1.44,.56),'stblack',.01)
 for y in [-.50,.50]:cyl('甲板標識燈',(5.26,y,1.66),.065,.03,'stplate','X',16,0);st_ring_x('標識燈框',5.255,y,1.66,.065,.085,.02,'metal',16)
 # 煙箱頂：前燈、橫放溫水器、煙囪在後面。
 cyl('給水溫水器',(4.28,0,3.48),.22,1.56,'stblack','Y',28,.01)
 for side in [-1,1]:cyl('溫水器端蓋',(4.28,side*.78,3.48),.19,.03,'stblack','Y',28,0)
 for y in [-.28,.28]:box('溫水器托架',(4.28,y,3.28),(.26,.08,.14),'stsoot',0)
 st_lamp(4.62,3.62,.105);st_chimney(3.74,3.34,.24,3.94,.34)
 # 長圓罩：比 C57 長，前後都圓。
 use('05')
 block('汽包砂箱一體罩',[(.62,.14,3.04,3.48,.08),(.72,.32,3.04,3.68,.26),(.90,.43,3.04,3.80,.38),(1.15,.47,3.04,3.86,.44),(1.60,.47,3.04,3.87,.44),(2.30,.47,3.04,3.84,.44),(2.60,.44,3.04,3.76,.40),(2.78,.30,3.04,3.60,.26),(2.88,.14,3.04,3.46,.10)],'stblack',0)
 cyl('罩頂人孔',(1.20,0,3.87),.15,.04,'stblack','Z',20,0);cyl('砂箱手輪座',(2.35,0,3.84),.05,.08,'stblack','Z',12,0);st_ring_y('砂箱手輪',2.35,0,3.93,.07,.09,.016,'stblack',16)
 for y in [-.15,.15]:cyl('安全閥',(-.15,y,3.50),.075,.20,'stband','Z',14,0)
 cyl('汽笛座',(.30,-.24,3.42),.05,.10,'stblack','Z',12,0);rod('汽笛',(.30,-.24,3.44),(.30,-.24,3.68),.036,'stband',10);cyl('汽笛口',(.30,-.24,3.70),.05,.05,'stband','Z',12,0)
 cyl('渦輪發電機',(-.62,.42,3.43),.13,.34,'stblack','X',16,0);rod('發電機排氣管',(-.62,.42,3.50),(-.62,.42,3.76),.024,'stblack',6)
 # 放熱管（+Y 鍋爐中段）、砂管、步道下三條長管與主空氣筒、拱起段下的空氣壓縮機、拱起段頂花紋鋼板。
 for k in range(4):
  z=bz+.22-k*.12;st_pipe('放熱管',[(2.15,1.05,z),(3.20,1.05,z)],.022,'stsoot',6)
  if k<3:st_pipe('放熱管彎頭',[(3.20 if k%2==0 else 2.15,1.05,z),(3.27 if k%2==0 else 2.08,1.07,z-.06),(3.20 if k%2==0 else 2.15,1.05,z-.12)],.022,'stsoot',6)
 for side in [-1,1]:
  ct_strip('拱起段花紋鋼板',[(x,z+.004) for x,z in hump[1:5]],side*.80,side*1.38,.02,'stcheck')
  st_pipe('砂管',[(2.45,side*.46,3.14),(2.60,side*.76,2.76),(2.66,side*.92,2.30),(2.68,side*.98,zl)],.016,'stsoot',6)
  st_pipe('砂管',[(1.05,side*.46,3.14),(.92,side*.76,2.76),(.88,side*.92,2.40),(.86,side*.98,zl)],.016,'stsoot',6)
  for z in [1.78,1.68,1.58]:st_pipe('步道下長管',[(.80,side*1.30,z),(3.60,side*1.30,z)],.026,'stsoot',6)
  cyl('主空氣筒',(1.90,side*1.13,1.70),.17,1.70,'stblack','X',18,0)
  rod('蒸汽管',(xs-.70,side*.84,bz-.30),(xs-.45,side*1.22,1.92),.05,'stblack',8)
 cyl('空氣壓縮機上缸',(.12,1.20,2.02),.16,.42,'stblack','Z',18,0);cyl('空氣壓縮機下缸',(.12,1.20,1.55),.19,.50,'stblack','Z',18,0);box('壓縮機支架',(.12,1.08,2.20),(.30,.24,.10),'stsoot',0)
 cyl('給水泵',(.12,-1.20,1.86),.15,.62,'stblack','Z',18,0);cyl('給水泵頂蓋',(.12,-1.20,2.20),.10,.05,'stsoot','Z',14,0)
 use('01');st_cab(s,-.95,-2.46,-1.92,1.60,3.58,2.62,3.94,(-1.74,-1.04,2.70,3.38),(-1.45,2.30))
 st_tender(s,-6.20,-2.92,1.02,3.42,2.62,-3.18,True,'octagon')

def ck124(s):
 """CK124（日本 C12 形水櫃車）。參考照見 catalog-source.json photos。
 1C1 水櫃車：輻條動輪三軸、先輪與從輪各一軸；鍋爐上兩顆圓頂（前砂箱、後汽包）、高直筒煙囪、煙箱頂前燈；兩側水櫃接到駕駛室；
 駕駛室大方窗黃框、前後牆拱形窗與圓窗銅框；煤櫃上窄下寬；黃飾線沿步道、斜坡、導煙板外緣、駕駛室與煤櫃下緣。
 比例照 Commons「20191208TRA CK124 at Coast line(cropped).jpg」（鐵路1）側面與「20110702三義站內的CK124後側.jpg」（Ckbubutp）量，高度照實車 3.9 m 縮到 3.75。"""
 W=s['W'];R=.60;yw=1.02;bz,br=2.42,.60;rs=.68;xs=3.35;zl=1.95;zdk=1.14;xf=3.72;dxs=[1.20,-.10,-1.40];main=1;st_colours()
 # 步道：前段從水櫃前端到斜坡；黃飾線沿外緣。
 use('01');rb=[(.30,zl),(2.86,zl),(3.60,zdk),(3.84,zdk)]
 for side in [-1,1]:
  ct_strip('兩側步道板',rb,side*.62,side*1.38,.06,'stblack');ct_strip('步道外緣黃線',rb,side*1.38,side*1.392,.07,'stline')
  ct_strip('步道斜坡花紋鋼板',[(x,z+.004) for x,z in rb[1:]],side*.64,side*1.36,.02,'stcheck')
 box('前端甲板',(3.50,0,zdk-.03),(.70,2.70,.06),'stcheck',0);box('甲板中央方箱',(3.52,0,1.34),(.28,.74,.36),'stblack',.01)
 box('煙箱下前牆',(xs-.06,0,(zdk+bz-rs+.05)/2),(.12,1.30,bz-rs+.05-zdk),'stblack',0);box('汽缸鞍座',(2.42,0,1.34),(.80,1.10,.66),'stblack',0)
 # 鍋爐、煙箱、門。
 x0=-1.62;xb=2.40;cyl('圓筒鍋爐',((x0+xb)/2,0,bz),br,xb-x0+.20,'stblack','X',48,0);cyl('前煙箱',(xs-.48,0,bz),rs,.96,'stblack','X',48,0)
 for x in [-.70,.25,1.25]:cyl('鍋爐箍帶',(x,0,bz),br+.012,.035,'stsoot','X',48,0)
 st_door(xs,bz,rs,False);st_plate_front(xs+.06,bz+.40,.84,.26,'CK 124',.17)
 # 煙箱門中央手輪與把手是銅色（照片上唯一的銅件）。
 st_ring_x('銅色手輪',xs+.10,0,bz-.06,.075,.10,.02,'stgold',18);rod('銅色把手',(xs+.09,0,bz-.16),(xs+.09,0,bz-.36),.014,'stgold',6);rod('銅色把手橫桿',(xs+.09,-.09,bz-.06),(xs+.09,.09,bz-.06),.012,'stgold',6);rod('銅色把手橫桿',(xs+.09,0,bz+.03),(xs+.09,0,bz-.15),.012,'stgold',6)
 st_chimney(2.85,bz+.52,.22,3.75,.30);st_lamp(3.20,3.30,.105)
 # 兩顆圓頂：基座外張、半球頂。
 use('05')
 for x,r in [(1.72,.33),(.68,.37)]:
  zt=3.58;zb=bz+.46
  ty_lathe('圓頂',x,0,[(r+.13,zb),(r+.06,zb+.08),(r,zb+.18),(r,zt-r*.75),(r*.86,zt-r*.38),(r*.5,zt-r*.09),(0,zt),(0,zb)],'stblack',32,(0,))
 cyl('圓頂手輪座',(1.72,0,3.59),.04,.05,'stblack','Z',10,0)
 cyl('安全閥座',(-.35,0,3.05),.14,.12,'stblack','Z',16,0)
 for y in [-.09,.09]:cyl('安全閥',(-.35,y,3.17),.05,.14,'stgold','Z',12,0)
 rod('汽笛',(.10,-.22,2.98),(.10,-.22,3.30),.032,'stgold',10);cyl('汽笛口',(.10,-.22,3.32),.045,.04,'stgold','Z',12,0)
 for side in [-1,1]:
  line('鍋爐側扶手',[(-.40,side*(br+.09),bz+.28),(xs-.30,side*(rs+.07),bz+.28)],.015,'metal')
  for x in [.15,1.25,2.20]:rod('扶手支架',(x,side*(br-.02),bz+.28),(x,side*(br+.09),bz+.28),.010,'metal',6)
  st_pipe('砂管',[(1.50,side*.34,2.98),(1.72,side*.56,2.72),(2.00,side*.70,2.30),(2.10,side*.84,zl)],.016,'stsoot',6)
  st_pipe('鍋爐側管',[(.05,side*(br+.03),bz-.20),(2.30,side*(br+.03),bz-.20)],.022,'stsoot',6)
  rod('蒸汽管',(xs-.72,side*.60,bz-.28),(2.50,side*1.10,zl+.02),.045,'stblack',8)
 # 導煙板：前緣下端往後收、上緣兩角圓角，黃飾線繞外緣；步道前扶手銅色。
 use('03');rt,rf=.16,.12;top=3.18
 dp=[(2.02,zl),(2.86,zl),(3.46,1.28),(3.62,top-rf)]+[(3.62-rf+rf*math.cos(math.pi/2*i/5),top-rf+rf*math.sin(math.pi/2*i/5)) for i in range(1,6)]+[(2.02+rt-rt*math.sin(math.pi/2*i/5),top-rt+rt*math.cos(math.pi/2*i/5)) for i in range(6)]
 for side in [-1,1]:
  ct_plate('導煙板',dp,side*1.36,side*1.40,'stblack')
  edge=dp[2:]+[dp[0]]
  for a,b in zip(edge,edge[1:]):ct_bar('導煙板黃飾線',a,b,.04,.008,side*1.404,'stline')
  rod('導煙板拉桿',(2.80,side*1.36,3.02),(2.80,side*.45,bz+.42),.012,'stblack',6)
  rod('前端銅色扶手柱',(3.68,side*1.26,zdk),(3.68,side*1.26,1.92),.022,'stgold',8)
 # 兩側水櫃：前上角切一小角，頂上注水口。
 use('01')
 for side in [-1,1]:
  ct_plate('水櫃',[(-1.62,1.52),(.30,1.52),(.30,2.54),(.24,2.60),(-1.62,2.60)],side*.66,side*1.36,'stblack')
  cyl('水櫃注水口',(-.45,side*1.02,2.62),.13,.04,'stblack','Z',18,0)
  box('水櫃下緣',(-.66,side*1.20,1.48),(1.96,.34,.08),'stsoot',0)
 # 駕駛室：側板、大窗黃框、車號牌、下緣黃線；門洞之後是煤櫃。
 xcf,xcr,xdr,xbk=-1.62,-2.80,-3.12,-3.80;zb,ze,crown=1.62,3.29,3.62;hw=1.36;zw0,zw1=2.40,3.06;wx0,wx1=-2.72,-1.72
 use('01')
 for side in [-1,1]:
  ct_plate('駕駛室側板',[(xcr,zb),(xcf,zb),(xcf,ze),(xcr,ze)],side*(hw-.03),side*hw,'stblack')
  use('02');panel('駕駛室大窗玻璃',((wx0+wx1)/2,side*(hw+.002),(zw0+zw1)/2),wx1-wx0-.03,zw1-zw0-.03,'glass',r=.02,depth=.012)
  for a,b in [((wx0,zw0),(wx1,zw0)),((wx1,zw0),(wx1,zw1)),((wx1,zw1),(wx0,zw1)),((wx0,zw1),(wx0,zw0))]:ct_bar('駕駛室窗黃框',a,b,.05,.012,side*(hw+.012),'stline')
  rod('窗中框',(wx0+.72,side*(hw+.012),zw0),(wx0+.72,side*(hw+.012),zw1),.016,'frame',6)
  st_plate_side(-2.22,side*(hw+.002),2.20,.70,.26,'CK 124',.14)
  use('01');box('駕駛室下緣黃線',((xcf+xcr)/2,side*(hw+.006),zb+.03),(xcf-xcr,.012,.06),'stline',0)
  for k in range(3):rod('駕駛室下護欄',(xcr+.04,side*(hw+.02),1.38+k*.08),(xcf-.04,side*(hw+.02),1.38+k*.08),.014,'stsoot',6)
  use('05');rod('駕駛室扶手',(xcr-.05,side*(hw+.04),zb-.10),(xcr-.05,side*(hw+.04),ze-.20),.018,'metal',8)
  rod('駕駛室扶手',(xdr+.05,side*(hw+.04),zb-.10),(xdr+.05,side*(hw+.04),2.40),.018,'metal',8)
  for z in [.72,1.04,1.34]:box('司機踏階',((xcr+xdr)/2,side*(hw-.08),z),(.26,.26,.035),'stsoot',0)
  rod('踏階吊架',(xcr-.04,side*(hw+.02),.70),(xcr-.04,side*(hw+.02),1.40),.016,'stsoot',6);rod('踏階吊架',(xdr+.04,side*(hw+.02),.70),(xdr+.04,side*(hw+.02),1.40),.016,'stsoot',6)
  use('01')
 top2=lambda y:ze+(crown-ze)*(1-(y/(hw+.07))**2)
 wall=[(-hw+.02,zb),(hw-.02,zb)]+[(hw-.02-2*(hw-.02)*i/12,top2(hw-.02-2*(hw-.02)*i/12)-.03) for i in range(13)]
 ty_xplate('駕駛室前牆',wall,xcf-.07,xcf,'stblack');ty_xplate('駕駛室後牆',wall,xdr-.08,xdr,'stblack')
 box('駕駛室地板',((xcf+xdr)/2,0,zb-.02),(xcf-xdr,2*hw-.04,.06),'stsoot',0);box('駕駛室內部',((xcf+xdr)/2-.02,0,(zb+ze)/2),(xcf-xdr-.20,2*hw-.18,ze-zb-.10),'frame',0)
 k=14;roof=[(-hw-.07+2*(hw+.07)*i/k,top2(-hw-.07+2*(hw+.07)*i/k)) for i in range(k+1)]
 ty_xplate('駕駛室圓拱頂',roof+[(y,z-.05) for y,z in reversed(roof)],xdr-.10,xcf+.10,'stsoot',True,{0,k,k+1,2*k+1})
 use('05');box('駕駛室頂通風器',(-2.40,0,crown+.01),(.70,.42,.06),'stsoot',.01)
 # 前牆、後牆：外側拱形窗銅框、上方圓窗銅框。
 use('02')
 def arched(x,d,y):
  pts=[(y-.17,2.46),(y+.17,2.46)]+[(y+.17*math.cos(math.pi*i/8),3.00+.17*math.sin(math.pi*i/8)) for i in range(9)]+[(y-.17,2.46)]
  ty_xplate('拱形窗玻璃',[(a,b) for a,b in pts[:-1]],x+d*.002,x+d*.010,'glass')
  for a,b in zip(pts,pts[1:]):
   n=math.hypot(b[0]-a[0],b[1]-a[1]);rod('拱形窗銅框',(x+d*.012,a[0],a[1]),(x+d*.012,b[0],b[1]),.018,'stgold',6)
 for side in [-1,1]:
  arched(xcf,1,side*1.10)
  st_ring_x('圓窗銅框',xcf+.012,side*.70,3.24,.10,.135,.03,'stgold',20);cyl('圓窗',(xcf+.006,side*.70,3.24),.105,.012,'glass','X',20,0)
  arched(xdr-.08,-1,side*1.10)
  st_ring_x('後牆圓窗銅框',xdr-.095,side*.52,3.28,.11,.15,.03,'stgold',20);cyl('後牆圓窗',(xdr-.09,side*.52,3.28),.12,.012,'glass','X',20,0)
 # 煤櫃：下段全寬、上段收窄；頂上煤；下緣黃線往下折；後端燈（不發光）、車號牌、梯子。
 use('01');zl1,zt1=2.57,3.05
 box('煤櫃下段',((xdr+xbk)/2-.02,0,(zb+zl1)/2),(xdr-xbk+.04,2*hw,zl1-zb),'stblack',.01);box('煤櫃上段',((xdr+xbk)/2-.02,0,(zl1+zt1)/2),(xdr-xbk+.04,1.84,zt1-zl1),'stblack',.01)
 box('煤櫃上緣',((xdr+xbk)/2-.02,0,zl1+.02),(xdr-xbk+.10,2*hw+.04,.04),'stsoot',0)
 st_coal(xbk+.06,xdr-.12,.86,zt1,.14,6,8,22)
 for side in [-1,1]:
  box('煤櫃下緣黃線',((xdr+xbk)/2-.02,side*(hw+.006),zb+.03),(xdr-xbk+.04,.012,.06),'stline',0)
  box('煤櫃下緣折線',(xbk+.03,side*(hw+.006),zb-.10),(.05,.012,.26),'stline',0)
 use('03');panel('煤櫃後端車牌',(xbk-.05,.18,2.36),.56,.24,'stplate','front',r=.012,depth=.012);text_label('CK 124',(xbk-.062,.18,2.36),.11).rotation_euler=Matrix(((0,0,-1),(-1,0,0),(0,1,0))).to_euler()
 st_pipe('後牆橫管',[(xbk-.055,.10,2.56),(xbk-.055,-.72,2.56),(xbk-.055,-.74,1.86)],.016,'stsoot',6);box('煤櫃後牆下段',(xbk+.08,0,1.40),(.20,2.50,.46),'stblack',0)
 box('後端燈座',(xbk-.05,.35,2.66),(.14,.26,.05),'stblack',0);cyl('後端燈燈殼',(xbk-.09,.35,2.80),.11,.20,'stblack','X',20,0);box('後端燈遮簷',(xbk-.15,.35,2.93),(.28,.28,.03),'stblack',0);cyl('後端燈鏡片',(xbk-.195,.35,2.80),.075,.012,'stlens','X',20,0)
 for yy in [.68,.88]:rod('後端梯',(xbk-.065,yy,1.20),(xbk-.065,yy,zt1+.04),.016,'stsoot',6)
 for z in [1.45,1.72,1.99,2.26,2.53,2.80]:rod('後端梯橫檔',(xbk-.065,.68,z),(xbk-.065,.88,z),.012,'stsoot',6)
 cyl('後端標識燈',(xbk-.02,.80,1.76),.055,.03,'taillamp','X',14,0)
 # 前後端梁、排障器、車鉤、軟管。
 use('01');box('緩衝梁',(xf,0,.93),(.18,2.70,.40),'stblack',0);box('後端緩衝梁',(-3.86,0,.98),(.14,2.70,.46),'stblack',0)
 for side in [-1,1]:box('前端踏階',(xf-.10,side*1.26,.50),(.22,.26,.035),'stsoot',0);rod('踏階吊架',(xf-.10,side*1.26,.52),(xf-.10,side*1.26,.74),.016,'stsoot',6)
 st_pipe('前端扶手',[(3.68,-1.26,1.56),(3.68,-.44,1.56),(3.68,-.34,1.46),(3.68,.34,1.46),(3.68,.44,1.56),(3.68,1.26,1.56)],.018,'metal',8)
 st_pilot(xf+.02,W,.72);st_hose(xf+.09,.78);st_coupler(xf+.14,1,.90)
 use('04')
 for i in range(8):rod('後端排障器',(-4.05,-.70+i*.20,.16),(-3.90,-.70+i*.20,.74),.030,'stblack',6)
 rod('後端排障器下緣',(-4.05,-.78,.16),(-4.05,.78,.16),.028,'stblack',8);st_hose(-3.99,.78,-1);st_coupler(-3.94,-1,.90)
 # 台枠、汽缸外罩、十字頭、灰箱、後方主空氣筒、鍋爐旁小件（空氣壓縮機、潤滑器）。
 for side in [-1,1]:
  box('主台枠',(-.05,side*.60,1.02),(7.60,.10,.56),'stsoot',0)
  cyl('外置汽缸',(2.42,side*1.10,1.04),.25,.60,'stblack','X',28,0);st_cladding(2.42,side*1.32,1.08,zl+.02,.32,.80)
  box('導框支架',(1.72,side*1.00,1.30),(.08,.46,.50),'stsoot',0)
  cyl('主空氣筒',(-3.00,side*1.14,1.42),.13,.90,'stblack','X',16,0)
 box('灰箱',(-1.90,0,1.14),(1.00,1.10,.50),'stsoot',0)
 cyl('空氣壓縮機',(.75,-1.10,2.24),.14,.56,'stblack','Z',16,0);cyl('潤滑器',(.75,-1.10,2.58),.09,.14,'stgold','Z',14,0);cyl('潤滑器',(.75,1.10,2.20),.11,.46,'stblack','Z',14,0)
 # 動輪：輻條輪、寬白線；先輪、從輪輻條較少。
 for x in dxs:cyl('動輪軸',(x,0,R),.09,2*yw-.10,'stsoot','Y',16,0)
 for side,th in [(-1,math.radians(-40)),(1,math.radians(50))]:
  for i,x in enumerate(dxs):
   ct_wheel(x,side*yw,R,14,white=False,counter=(th+math.pi,math.radians(95 if i==main else 70)));st_ring_y('輪箍白線',x,side*(yw+.058),R,R-.09,R-.012,.008,'white',48)
  st_motion(side,dxs,main,R,.30,2.42,1.04,1.86,1.62,(.09,.10))
 for x,r in [(3.05,.38),(-3.00,.42)]:
  cyl('先從輪軸',(x,0,r),.07,1.80,'stsoot','Y',12,0)
  for side in [-1,1]:ct_wheel(x,side*.96,r,10,white=False);st_ring_y('輪箍白線',x,side*(.96+.058),r,r-.08,r-.012,.008,'white',40)
 box('先台車架',(3.05,0,.52),(.90,1.40,.14),'stsoot',0);box('從台車架',(-3.00,0,.62),(.90,1.50,.14),'stsoot',0)

BUILDERS.update({'ck124':ck124,'ct273':ct273,'dt668':dt668})
