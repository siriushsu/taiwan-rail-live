"""台灣經典退役車：DR3000、CT250、復興號、EMU300、騰雲號。
規格用 tw_specs.add 登記、建模函式登記進 tw_models.BUILDERS（build_tw.py 匯入本檔）；車殼與車頭零件沿用 tw_models 同家族的函式。
參考照片只在本機比對，檔名、作者、授權記在 catalog-source.json；不放營運商標，車號用可移除的示意字牌。"""
import math
from mathutils import Matrix
from tw_specs import add
from tw_models import *

# DR3000（日立製作所，1990）：20.3 m 車在車庫是 L 8.3，跟 DR3100 同斷面。駕駛動力車只有車尾一扇上下車門，駕駛室後面是一扇緊急逃生門；
# 中間的 DR3070 電源拖車兩端各一扇門：地圖 LOD 的中間車是駕駛車後半鏡射，剛好兩端各一扇，車身中央是窗間柱。
add('dr3000','railcar',L=8.3,W=2.8,H=3.4,doors=2,doorLeaves=1,doorW=.62,rearDoor=.62,frontDoor=.50,radiusTop=.30,
 winH=.84,winZ=2.37,doorWinH=.78,doorWinZ=2.36,doorTop=2.90,body='BCC2C3',accent='F27E4E',acUnits=[],power='diesel',label='DR3000')

def dr3000(s):
 """DR3000 柴聯自強（日立製作所，1990–2023）。參考：Commons「DR3000型柴聯自強號.jpg」（臺灣鐵路管理局，Attribution，2023 正面斜側）、
 「Mitsubishi Delica and TRA DR3000 20110707.jpg」「TRA DR3024 at Platform 3B, Changhua Station 20210419.jpg」（Cheng-en Cheng，CC BY-SA 2.0，正面與車側）、
 「TRA DR3000 auto doors closed at Taipei Station 20110701.jpg」（Solomon203，CC BY-SA 3.0，車端門與車側色帶）、「TRA DR3070 interior 20130616.jpg」（Kazehayashi，CC BY-SA 3.0，大小窗交錯）。
 跟 DR3100 同一套警戒塗裝，差在：雙頭燈在車頂中央的黑色燈座（不在窗框上緣），燈座後面車頂是引擎冷卻器罩；前窗小，窗上緣到上緣橘色之間留一段黃色；
 貫通門外框是灰色凸框；車側大小窗交錯。外觀是 2009 年改裝後的樣子（手動摺疊門換成滑塞式電動門，用到 2023 年退役）：尾燈上移、標識燈掛架移到尾燈內側、車側 LED 終點顯示器在車身中段上方。
 高度依 2023 正面照量（橫向 213 px/m；直向以車底 .83、車頂 3.40 兩點對齊；照片略斜，左右兩側取平均）：
 前窗 1.90–2.83（|y| .46–1.175）、上緣橘色 3.065 以上、高壓警示牌 3.06–3.25（中心 |y| .815）、頭燈座 3.17–3.50（寬 .61，燈心 3.345、|y| .14）、
 貫通門框 .95–3.03（寬 .94）、門 1.40–2.91、門窗 1.93–2.79、窗下橘帶 1.65–1.83、斜紋外緣每往下 1 m 往中央移 .50、寬 .23，黃色斜帶寬 .18、
 尾燈 1.42（|y| 1.00、黃圈半徑 .13）、標識燈掛架 |y| .76、1.48、下緣橘帶 .83–.97。"""
 L,W,H=s['L'],s['W'],s['H'];dw=s['doorW'];dmu_colours()
 profile=[(.83,L/2-.04),(1.00,L/2),(H-.35,L/2-.01),(H-.12,L/2-.08),(H,L/2-.20)]
 s['bowPow']=6;bands=[(1.76,.20,'dorange'),(2.905,.07,'dyellow')]
 fz=[(.97,'dorange'),(3.065,'dyellow'),(H+1,'dorange')];nz=[(.97,'dorange'),(1.66,'dyellow'),(1.86,'dorange'),(3.065,'dyellow'),(H+1,'dorange')]
 f,neck,doors=emu_body(s,profile,.08,[(H-.16,'dstain'),(H+1,'droof')],fz,nz,leaf='dstain',gaps=[0,0,0],bands=bands,leafbands=bands)
 # 兩門之間「小、大、小、大」各一組，車身中央留窗間柱：中間車鏡射後半時中央不會切到半扇窗。
 small,gap=.40,.06
 for u,v in [(doors[0]+dw/2+.12,-gap/2),(gap/2,doors[1]-dw/2-.12)]:
  big=(v-u-3*gap-2*small)/2;x=u
  for w in [small,big,small,big]:
   for side in [-1,1]:sidewindow(x+w/2,side*(W/2+.018),s['winZ'],w-.04,s['winH'],r=.06)
   x+=w+gap
 for side in [-1,1]:panel('車側 LED 終點顯示器',(0,side*(W/2+.022),3.075),.50,.12,'frame',r=.02)
 side_ribs(s,[1.00,1.19,1.40,1.59,3.03,3.11],-L/2+.08,neck-.04,'dstain')
 dmu_face(s,f,dict(win=(.46,1.175,1.90,2.83),glass=2.77,gang=(.94,.95,3.03,'droof'),door=(.62,1.40,2.91),dwin=(.42,1.93,2.79),
  tail=(1.00,1.42,.13),hook=(.76,1.48),stripes=[(1.086,.23),(.678,.30)],slope=.50,sz=(.97,1.83),band=(1.65,1.83,.95),hv=(.815,3.06,3.25,.12),plateZ=2.67))
 use('03');z0,z1=3.17,3.50;xb=f(0,z0)+.06
 box('車頂頭燈座',(xb-.20,0,(z0+z1)/2),(.40,.61,z1-z0),'frame',.05)
 for y in [-.14,.14]:lamp('車頂頭燈',lambda yy,zz:xb-.085,y,3.345,.075)
 roof_hood('引擎冷卻器罩',s,neck-2.2,neck-.12,W*.62,.30,.30,'droof')
 for k in range(9):box('冷卻器頂部格柵',(neck-1.80+k*.17,0,H+.305),(.035,W*.40,.01),'chassis',.002)
 roof_hood('斜端冷氣機罩',s,-3.6,-1.3,W*.66,.30,.40,'droof')
 for k in range(8):box('冷氣罩頂部格柵',(-3.05+k*(2.3-1.1)/7,0,H+.305),(.035,W*.42,.01),'chassis',.002)
 use('05');cyl('排氣管',(-.60,.62,H+.22),.07,.42,'chassis');cyl('排氣管口',(-.60,.62,H+.44),.085,.04,'frame')
 return f

# CT250（日本 C55 形；三菱重工、川崎車輛，1935、1938 年引進九輛）：2'C1' 過熱式客運蒸機，動輪 1,750 mm、先輪與從輪 860 mm，機車長 20.35 m、高 3.945 m。
# 車庫是 Q 版：動輪半徑 .80、動輪軸距壓到 1.66（實車 1.90），煤水車壓得比機車多；跟 fleet-v1 的 CT273 同一個車庫尺度。
add('ct250','steam',L=12.0,W=2.8,H=3.95,drivers=3,driverRadius=.80,leading=2,trailing=1,tank=False,body='22272A',accent='B03733',power='steam',label='CT250')

def ct_plate(name,pts,y0,y1,material):
 """側面輪廓 pts=[(x, z), ...] 沿 Y 從 y0 擠到 y1 的板（導煙板、步道板、輪心補強）。"""
 n=len(pts);v=[(x,y0,z) for x,z in pts]+[(x,y1,z) for x,z in pts]
 return mesh(name,v,[tuple(range(n)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],material)

def ct_strip(name,pts,y0,y1,h,material):
 """沿側面曲線 pts=[(x, 上緣 z), ...] 往下 h 的條帶，沿 Y 從 y0 擠到 y1（步道板、步道白線）。"""
 return ct_plate(name,pts+[(x,z-h) for x,z in reversed(pts)],y0,y1,material)

def ct_bar(name,a,b,h,t,y,material):
 """側面看是長條的連桿：a、b 是 (x, z)，斷面高 h、厚 t，貼在 y 這個平面。"""
 (xa,za),(xb,zb)=a,b;l=math.hypot(xb-xa,zb-za);nx,nz=-(zb-za)/l*h/2,(xb-xa)/l*h/2
 v=[(px+sx*nx,y+sy*t/2,pz+sx*nz) for px,pz in (a,b) for sy in (-1,1) for sx in (-1,1)]
 return mesh(name,v,[(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)],material)

def ct_wheel(x,y,r,spokes,web=False,white=True,counter=None):
 """輻條輪：輪箍、輪緣、輻條、輪轂各自獨立；white 是輪箍外緣白線，counter=(角度, 張角) 畫動輪配重塊。y 帶正負號（輪子外側朝 y 的方向）。"""
 use('04');s=1 if y>0 else -1;n=40 if r>.6 else 32;hub=r*.22
 o=torus_y('輻條輪輪箍',(x,y,r),r-.05,.05,'ctblack',n=n,m=8);o['wheel_center']=True;o['radius']=r
 torus_y('輪緣',(x,y-s*.055,r),r*.95,.02,'ctblack',n=n,m=4)
 if white:torus_y('輪箍白線',(x,y+s*.05,r),r-.04,.014,'white',n=n,m=4)
 cyl('輪轂',(x,y,r),hub,.15,'ctblack','Y',20,0)
 for k in range(spokes):
  a=2*math.pi*(k+.5)/spokes
  rod('輻條',(x+hub*.9*math.cos(a),y,r+hub*.9*math.sin(a)),(x+(r-.08)*math.cos(a),y,r+(r-.08)*math.sin(a)),.026 if r>.6 else .020,'ctblack',6)
 if web:
  # 水かき：C55 動輪輻條根部之間的補強板（C57 起改成箱型輪心），畫成輻條處外凸的星形薄板。
  pts=[(x+r*(.47 if k%2 else .37)*math.cos(math.pi*k/spokes),r+r*(.47 if k%2 else .37)*math.sin(math.pi*k/spokes)) for k in range(2*spokes)]
  ct_plate('動輪輻條根部補強',pts,y-.03,y+.03,'ctblack')
 if counter:
  a0,da=counter
  pts=[(x+(r-.07)*math.cos(a0+da*(i/8-.5)),r+(r-.07)*math.sin(a0+da*(i/8-.5))) for i in range(9)]
  pts+=[(x+r*.50*math.cos(a0+da*.8*(.5-i/8)),r+r*.50*math.sin(a0+da*.8*(.5-i/8))) for i in range(9)]
  ct_plate('動輪配重',pts,y-.04,y+.04,'ctblack')
 cyl('輪軸端蓋',(x,y+s*.085,r),hub*.62,.04,'metal','Y',16,0)
 return o

def ct_disc(x,y,r):
 """煤水車的整片鋼輪（沒有白線）。"""
 use('04');s=1 if y>0 else -1
 o=cyl('煤水車鋼輪',(x,y,r),r,.14,'ctblack','Y',32,0);o['wheel_center']=True;o['radius']=r
 torus_y('輪緣',(x,y-s*.06,r),r*.95,.02,'ctblack',n=32,m=4);cyl('輪軸端蓋',(x,y+s*.08,r),r*.26,.04,'metal','Y',16,0)

def ct250(s):
 """CT250（C55 形）客運蒸機。參考：Commons「臺鐵CT251 前面.jpg」「臺鐵CT251 後面.jpg」（Pbdragonwang，CC BY-SA 4.0，2020 年照 1982 年樣子修復後）、
 「打狗鐵道故事館CT259.jpg」（Ahph，CC BY-SA 3.0，斜前方）、「Detail of TRA CT259 2013-10-17.jpg」（MiNe，CC BY 2.0，動輪與連桿）、
 「Rear Right View of TRA CT259 in Takao Railway Museum 20151129.jpg」（玄史生，CC0，側面全長）、「TRA CT259 at the Takao Railway Museum 2020-03-06.jpg」（Industrial Wales，CC BY-SA 2.0，煤水車後端）；
 規格照維基百科「台鐵CT250型蒸汽機車」「国鉄C55形蒸気機関車」。
 C55 跟 CT273（C57）外觀差在：動輪是輻條輪、根部有「水かき」補強（C57 是箱型輪心）；汽包與砂箱在同一個長圓罩裡；
 兩側大型導煙板的下緣跟著步道往下彎到前端甲板，甲板上橫放給水溫水器；煙箱上方前燈、煙箱門上緣紅色車號牌。
 塗裝照保存車：黑色車身、步道外緣與輪箍白線、主連桿與連結桿紅色；空氣壓縮機照 CT251（C551–C554）高出步道。"""
 W=s['W'];R=.80;yw=1.02;bz,br=2.48,.84;dxs=[2.55,.89,-.77]
 color('ctblack','1C2022',.30,.42,.10);color('ctcoal','141516',.05,.88,0)
 # 步道板：從駕駛室前牆到導煙板中段是 1.92，往前以平滑 S 形降到前端甲板 1.36。
 zrb=lambda x:1.92 if x<=4.35 else 1.36 if x>=4.80 else 1.92-.56*(lambda t:t*t*(3-2*t))((x-4.35)/.45)
 rb=[(x,zrb(x)) for x in [-.95,4.35]+[4.35+.45*i/10 for i in range(1,11)]+[5.45]]
 use('01')
 for side in [-1,1]:
  ct_strip('兩側步道板',rb,side*.78,side*1.42,.06,'body');ct_strip('步道外緣白線',rb,side*1.42,side*1.432,.07,'white')
 box('前端甲板',(5.125,0,1.33),(.65,1.56,.06),'body',0);box('汽缸鞍座',(4.20,0,1.32),(.66,1.40,.60),'body',0)
 # 鍋爐、煙箱、煙箱門。
 cyl('圓筒鍋爐',(1.425,0,bz),br,4.95,'body','X',64,0);cyl('前煙箱',(4.30,0,bz),br+.035,.80,'body','X',64,0)
 for x in [-.55,.25,2.45,3.25]:cyl('鍋爐箍帶',(x,0,bz),br+.012,.035,'ctblack','X',64,0)
 cyl('煙箱門',(4.73,0,bz),.80,.06,'body','X',64,.02)
 for i in range(16):
  a=2*math.pi*i/16;cyl('煙箱前緣鉚釘',(4.705,.83*math.cos(a),bz+.83*math.sin(a)),.016,.02,'ctblack','X',8,0)
 cyl('煙箱門輪心',(4.78,0,bz),.06,.04,'metal','X',16,0)
 rod('煙箱門把手',(4.80,-.14,bz),(4.80,.14,bz),.014,'metal');rod('煙箱門把手',(4.80,0,bz-.14),(4.80,0,bz+.14),.014,'metal')
 for dz in [-.30,.30]:box('煙箱門鉸鏈',(4.772,.46,bz+dz),(.02,.66,.06),'ctblack',0)
 panel('煙箱門編號紅牌',(4.775,0,bz+.50),.78,.22,'red','front',r=.02);text_label(s['label'],(4.79,0,bz+.50),.16)
 # 汽包與砂箱同一個長圓罩：前端是砂箱、斜面較緩，後端是汽包、圓弧較陡；底部埋進鍋爐。
 block('汽包砂箱一體罩',[(.72,.10,2.95,3.36,.05),(.80,.24,2.95,3.52,.20),(.95,.31,2.95,3.64,.29),(1.20,.33,2.95,3.67,.31),
  (1.75,.33,2.95,3.68,.31),(2.00,.30,2.95,3.63,.28),(2.12,.20,2.95,3.47,.18),(2.17,.08,2.95,3.33,.06)],'body',0)
 use('05');rod('汽笛',(.52,-.30,3.28),(.52,-.30,3.56),.035,'metal');cyl('汽笛口',(.52,-.30,3.58),.05,.05,'metal','Z',12,0)
 for y in [-.15,.15]:cyl('安全閥',(-.70,y,3.36),.06,.16,'metal','Z',12,0)
 cyl('煙囪基座',(4.05,0,3.33),.31,.14,'body','Z',32,0);cyl('煙囪',(4.05,0,3.655),.24,.53,'body','Z',32,0);cyl('煙囪上緣',(4.05,0,3.915),.275,.07,'ctblack','Z',32,.01)
 use('03');box('前燈座',(4.50,0,3.39),(.30,.24,.10),'ctblack',0);cyl('前燈燈殼',(4.50,0,3.58),.17,.32,'body','X',28,.008)
 box('前燈遮簷',(4.62,0,3.765),(.16,.34,.03),'body',0);lamp('煙箱上方前燈',lambda y,z:4.585,0,3.58,.13)
 # 鍋爐兩側扶手、右側（-Y）空氣管與空氣壓縮機、左側逆轉桿、步道下的主空氣筒。
 use('05')
 for side in [-1,1]:
  line('鍋爐側扶手',[(-.90,side*.94,2.80),(4.60,side*.94,2.80)],.016,'metal')
  for x in [-.60,.60,2.40,3.50,4.40]:rod('扶手支架',(x,side*.80,2.80),(x,side*.94,2.80),.011,'metal')
  cyl('主空氣筒',(-.10,side*1.12,1.735),.12,1.35,'ctblack','X',20,0)
  rod('導煙板支撐',(4.25,side*1.36,3.05),(4.25,side*.70,3.05),.022,'ctblack')
 for z in [2.05,2.13]:rod('空氣管',(-.95,-.90,z),(3.45,-.90,z),.024,'ctblack')
 cyl('空氣壓縮機',(-.40,-1.12,2.26),.15,.62,'ctblack','Z',20,0);cyl('空氣壓縮機頂蓋',(-.40,-1.12,2.60),.17,.06,'ctblack','Z',20,0)
 rod('逆轉桿',(-.95,1.20,2.06),(3.25,1.20,2.06),.02,'ctblack')
 # 導煙板：下緣跟著步道彎到前端甲板，前緣上角大圓角。
 use('03');top=3.42;dp=[(3.50+(4.82-3.50)*i/12,zrb(3.50+(4.82-3.50)*i/12)) for i in range(13)]
 dp+=[(4.58+.24*math.cos(math.pi/2*i/6),top-.24+.24*math.sin(math.pi/2*i/6)) for i in range(7)]
 dp+=[(3.56-.06*math.sin(math.pi/2*i/4),top-.06+.06*math.cos(math.pi/2*i/4)) for i in range(5)]
 for side in [-1,1]:ct_plate('導煙板',dp,side*1.36,side*1.40,'body')
 # 前端：給水溫水器橫放在甲板上、緩衝梁、排障器、扶手柱、車鉤。
 use('01');cyl('給水溫水器',(5.02,0,1.58),.21,1.70,'body','Y',28,.01)
 for side in [-1,1]:
  cyl('溫水器端蓋',(5.02,side*.87,1.58),.20,.04,'ctblack','Y',28,0)
  rod('前端扶手柱',(5.30,side*1.25,1.36),(5.30,side*1.25,2.40),.022,'white')
  box('前端踏階',(5.50,side*1.20,.62),(.22,.26,.04),'ctblack',0)
 box('緩衝梁',(5.52,0,1.06),(.16,2.66,.58),'body',0)
 use('04')
 for i in range(9):rod('排障器直柵',(5.74,-1.0+i*.25,.20),(5.58,-1.0+i*.25,.78),.025,'ctblack',6)
 rod('排障器下橫樑',(5.74,-1.05,.20),(5.74,1.05,.20),.03,'ctblack',8)
 # 台枠、汽缸、十字頭與滑板、灰箱。
 for side in [-1,1]:
  box('主台枠',(1.55,side*.66,1.05),(7.60,.10,.62),'ctblack',0)
  cyl('外置汽缸',(4.20,side*1.12,1.00),.29,.68,'body','X',32,.008)
  for x in [3.845,4.555]:cyl('汽缸端蓋',(x,side*1.12,1.00),.26,.03,'ctblack','X',32,0)
  cyl('汽室',(4.15,side*1.12,1.32),.13,.54,'body','X',24,0)
  box('導框支架',(3.38,side*1.02,1.30),(.08,.50,.50),'ctblack',0)
  for z in [1.115,.885]:ct_bar('滑板',(3.40,z),(3.86,z),.04,.08,side*1.14,'metal')
  box('十字頭',(3.62,side*1.14,1.00),(.26,.14,.20),'metal',0);rod('活塞桿',(3.70,side*1.13,1.00),(3.86,side*1.13,1.00),.035,'metal')
  cyl('十字頭銷',(3.62,side*1.23,1.00),.05,.10,'metal','Y',12,0)
 box('灰箱',(-1.45,0,1.26),(1.00,1.30,.56),'ctblack',0)
 # 動輪：三軸、第二軸是主動輪；左右曲柄差 90 度，配重塊在曲柄對面、主動輪較大。連結桿、主連桿紅色，閥動裝置鋼色。
 for x in dxs:cyl('動輪軸',(x,0,R),.10,2*yw-.10,'ctblack','Y',16,0)
 for side,th in [(-1,math.radians(-40)),(1,math.radians(50))]:
  px,pz=.38*math.cos(th),.38*math.sin(th)
  for i,x in enumerate(dxs):
   ct_wheel(x,side*yw,R,16,web=True,counter=(th+math.pi,math.radians(100 if i==1 else 75)))
   cyl('動輪曲柄銷',(x+px,side*(yw+.13),R+pz),.065,.12,'metal','Y',16,0)
  ct_bar('連結桿',(dxs[2]+px,R+pz),(dxs[0]+px,R+pz),.11,.05,side*(yw+.16),'red')
  ct_bar('主連桿',(3.62,1.00),(dxs[1]+px,R+pz),.12,.05,side*(yw+.24),'red')
  ct_bar('偏心桿',(dxs[1]+px+.05,R+pz+.12),(3.22,1.20),.06,.04,side*(yw+.32),'metal')
  ct_bar('擴張連桿',(3.22,1.18),(3.28,1.52),.07,.05,side*(yw+.28),'metal')
  ct_bar('半徑桿',(3.25,1.40),(3.64,1.36),.06,.04,side*(yw+.28),'metal')
  ct_bar('結合桿',(3.66,1.38),(3.62,.90),.06,.04,side*(yw+.25),'metal')
  rod('閥桿',(3.64,side*1.20,1.33),(3.88,side*1.12,1.32),.02,'metal')
 # 先台車兩軸、從台車一軸（860 mm 輻條輪、白線）。
 for x in [4.12,4.95,-1.95]:
  cyl('先從輪軸',(x,0,.38),.07,1.80,'ctblack','Y',12,0)
  for side in [-1,1]:ct_wheel(x,side*.96,.38,10)
 box('先台車架',(4.53,0,.50),(1.20,1.45,.14),'ctblack',0);box('從台車架',(-1.95,0,.58),(.80,1.50,.14),'ctblack',0)
 # 駕駛室：圓拱頂、兩側各兩扇窗、前牆兩扇小窗；後方開口接煤水車。
 use('01')
 for side in [-1,1]:
  ct_plate('駕駛室側板',[(-2.42,1.50),(-.95,1.50),(-.95,3.52),(-2.42,3.52)],side*1.33,side*1.36,'body')
  for x,w in [(-1.24,.40),(-1.86,.58)]:sidewindow(x,side*1.355,2.98,w,.60,r=.06)
  use('01');panel('駕駛室側車牌',(-1.62,side*1.37,2.30),.86,.24,'red',r=.02);text_label(s['label'],(-1.62,side*1.385,2.30),.15,'side',side)
  use('02');panel('駕駛室前窗框',(-.875,side*.98,3.12),.36,.42,'frame','front',r=.08);panel('駕駛室前窗玻璃',(-.866,side*.98,3.12),.30,.36,'glass','front',r=.06,depth=.012)
  use('05');rod('駕駛室扶手',(-2.47,side*1.41,1.55),(-2.47,side*1.41,3.25),.02,'metal')
  for z in [.90,1.25]:box('司機踏階',(-2.58,side*1.28,z),(.36,.28,.04),'ctblack',0)
  rod('踏階吊架',(-2.58,side*1.40,.88),(-2.58,side*1.40,1.50),.018,'ctblack')
 use('01');box('駕駛室前牆',(-.915,0,2.51),(.07,2.66,2.02),'body',0);box('駕駛室地板',(-1.82,0,1.88),(1.74,2.64,.06),'ctblack',0)
 box('駕駛室內部',(-1.80,0,2.62),(1.60,2.50,1.40),'frame',0)
 block('駕駛室圓拱頂',[(-2.98,1.42,3.50,3.92,1.42),(-.80,1.42,3.50,3.92,1.42)],'body',.01);box('駕駛室頂通風器',(-1.85,0,3.93),(.50,.36,.06),'body',0)
 # 煤水車（12 噸煤、17 m³ 水）：直側板、上緣圓角；前段煤堆、後段注水口；兩組兩軸轉向架；後端梯子、前燈、紅色標識燈與車號牌。
 x0,x1=-6.20,-2.92
 tz=3.40;use('07');block('煤水車車身',[(x0,1.36,1.02,tz,.12),(x1,1.36,1.02,tz,.12)],'body',.01)
 # 前段煤櫃：兩側與前端各一道擋煤板，中間煤堆上撒一層不規則煤塊。
 for side in [-1,1]:box('擋煤板',(-3.85,side*1.31,tz+.08),(1.86,.06,.16),'body',0)
 box('前端擋煤板',(x1+.03,0,tz+.08),(.06,2.56,.16),'body',0)
 # 煤堆是起伏的格網、平面著色（光線下看得出一塊一塊），外圈壓到車頂以下，底部封口。
 gx,gy,xa,xb,ya=14,10,-4.72,-3.00,1.22;ix=lambda i,j:i*(gy+1)+j
 hz=lambda i,j:tz+.02+.22*math.sin(math.pi*i/gx)*math.sin(math.pi*j/gy)**.6+.05*((i*7+j*13)%5/4-.5) if 0<i<gx and 0<j<gy else tz-.02
 ring=[ix(i,0) for i in range(gx+1)]+[ix(gx,j) for j in range(1,gy+1)]+[ix(i,gy) for i in range(gx-1,-1,-1)]+[ix(0,j) for j in range(gy-1,0,-1)]
 mesh('煤堆',[(xa+(xb-xa)*i/gx,-ya+2*ya*j/gy,hz(i,j)) for i in range(gx+1) for j in range(gy+1)],
  [(ix(i,j),ix(i+1,j),ix(i+1,j+1),ix(i,j+1)) for i in range(gx) for j in range(gy)]+[tuple(ring)],'ctcoal')
 rnd=[(.37*k%1,.61*k%1,.83*k%1) for k in range(1,41)]
 for a,b,c in rnd:
  x=-4.60+1.55*a;y=(b*2-1)*.95;h=tz+.02+.20*math.sin(math.pi*(x+4.72)/1.72)*(1-.45*abs(y));r=.07+.06*c
  mesh('煤塊',[(x+r,y,h),(x-r*.8,y+r*.3,h),(x,y+r*.9,h+r*.2),(x+r*.2,y-r,h),(x-r*.1,y,h+r*.8),(x+r*.1,y+r*.1,h-r*.5)],[(0,2,4),(2,1,4),(1,3,4),(3,0,4),(0,5,2),(2,5,1),(1,5,3),(3,5,0)],'ctcoal')
 for side in [-1,1]:rod('煤水車前端扶手',(x1+.07,side*1.39,1.20),(x1+.07,side*1.39,3.20),.018,'metal')
 use('07')
 use('07');cyl('水櫃注水口',(-5.45,0,tz+.04),.28,.08,'ctblack','Z',24,0);box('注水口把手',(-5.45,0,tz+.10),(.30,.05,.04),'metal',0)
 box('煤水車底架',((x0+x1)/2,0,.95),(x1-x0,2.62,.14),'ctblack',0);box('煤水車後端梁',(x0-.02,0,.90),(.12,2.60,.30),'ctblack',0)
 for yy in [-1.08,-.82]:rod('後端梯',(x0-.04,yy,1.10),(x0-.04,yy,tz-.08),.018,'metal')
 for z in [1.35,1.65,1.95,2.25,2.55,2.85,3.10]:rod('後端梯橫檔',(x0-.04,-1.08,z),(x0-.04,-.82,z),.014,'metal')
 use('03');box('後端前燈座',(x0+.14,.80,tz+.06),(.20,.20,.08),'ctblack',0);cyl('後端前燈燈殼',(x0+.14,.80,tz+.18),.14,.28,'body','X',20,0)
 cyl('後端前燈鍍鉻圈',(x0-.015,.80,tz+.18),.135,.03,'metal','X',24,0);cyl('後端前燈透鏡',(x0-.035,.80,tz+.18),.11,.015,'lamp','X',24,0)
 cyl('標識燈座',(x0+.01,1.05,1.40),.08,.06,'ctblack','X',16,0);cyl('後端標識燈',(x0-.03,1.05,1.40),.06,.04,'taillamp','X',16,0)
 use('01');panel('煤水車後端車牌',(x0-.01,0,2.55),.80,.24,'red','front',r=.02)
 o=text_label(s['label'],(x0-.025,0,2.55),.16);o.rotation_euler=Matrix(((0,0,-1),(-1,0,0),(0,1,0))).to_euler()
 for c in [-5.42,-3.72]:
  for x in [c-.46,c+.46]:
   cyl('煤水車輪軸',(x,0,.38),.07,1.80,'ctblack','Y',12,0)
   for side in [-1,1]:ct_disc(x,side*.96,.38);box('軸箱',(x,side*1.18,.40),(.22,.08,.22),'ctblack',0)
  use('04');box('轉向架枕樑',(c,0,.80),(.36,2.30,.14),'ctblack',0)
  for side in [-1,1]:box('煤水車轉向架側樑',(c,side*1.13,.58),(1.50,.08,.26),'ctblack',0);box('疊板彈簧',(c,side*1.19,.74),(.86,.07,.09),'ctblack',0)
 rod('機車與煤水車連結桿',(x1,0,.95),(-2.72,0,.95),.05,'ctblack')
 coupler(5.66,W,1,z=.92);coupler(x0-.12,W,-1,z=.70)

# 復興號（唐榮鐵工廠，1980）：20000 型「落地冷氣式單端門」座車，一端是車門、另一端是冷氣機室，車頂沒有冷氣機；1985 年起漆天藍與白色，用到 2022 年退役。
# 車體設計同莒光號，車庫一樣是 L 9.0，沿用 tw_models.fpk_coach。
add('fuxing','coach',L=9.0,W=2.8,H=3.4,doors=1,doorLeaves=1,doorW=.62,radiusTop=.42,body='1E6EC4',accent='EDF0EE',label='復興號')

def fuxing(s):
 """復興號座車（40SP20000 系）。參考：Commons「TRA 40SP20073T at Chiayi Station 20191011.jpg」（Kazehayashi，CC BY-SA 4.0，側面、兩端、窗的順序）、
 「40SPK21008T, Fu-Hsing Semi Express.jpg」（Kazehayashi，CC BY-SA 4.0，冷氣機室百葉）、「潮州車站2B月台 復興號 20130801.jpg」（Foxy Who，CC BY-SA 3.0，色界與窗的高度）、
 「CK124 with Fu-Hsing Semi Express.jpg」（Kazehayashi，CC BY-SA 4.0，端牆顏色）、「35SPK21202.jpg」（Kazehayashi，CC BY-SA 4.0，1985 年型對照，這版做 20000 型）。
 下半天藍、窗帶以上白色，天藍在窗下緣下方一點收邊；兩端整段天藍（白色帶在兩端前結束、上角圓角）；+X 端一扇兩片窗的車門，-X 端冷氣機室車側兩片直條百葉；
 車頂淺灰、沒有冷氣機；一扇小窗、六扇等距大窗（斜側照片用透視還原：大窗寬約窗距八成，小窗緊接冷氣機室）。
 窗高同莒光號 1.79–2.49；天藍上緣 1.72（潮州近照量窗下緣到色界約 .07 m）。"""
 L,W,H=s['L'],s['W'],s['H']
 color('fxblue','1E6EC4',.06,.34,.26);color('fxwhite','EDF0EE',.06,.34,.26);color('fxroof','B4B9BB',.40,.40,.08)
 zones=[(1.72,'fxblue'),(2.96,'fxwhite'),(H+1,'fxroof')]
 win=[(-2.67,.40)]+[(-1.90+.943*k,.75) for k in range(6)]
 fpk_coach(s,zones,[(x,w,'frame') for x,w in win],(1.79,2.49),'fxblue',[],'fxblue','fxblue',vest=('fxblue',1.72,2.96,.30),
  doors=(1,),door_win=[(-.13,.14,2.27,.88),(.13,.14,2.27,.88)],roof_ac=False)
 xd=L/2-.62
 for side in [-1,1]:
  y=side*(W/2+.018);use('02');box('車門中縫',(xd,y+side*.037,1.70),(.012,.008,2.14),'frame',0)
  for x in [-L/2+.40,-L/2+.84]:
   bar_grille('冷氣機室百葉',x,side*(W/2+.012),1.85,.36,1.60,6,frame='frame',bar='fxblue')
   box('百葉中橫條',(x,side*(W/2+.028),1.85),(.34,.014,.03),'fxblue',0)

BUILDERS.update({'dr3000':dr3000,'ct250':ct250,'fuxing':fuxing})
