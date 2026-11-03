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

# EMU300（義大利 Socimi，1988–89）：三節一組（兩節駕駛馬達車夾一節受電弓拖車），20 m 車在車庫是 L 8.9（同 EMU100）。
# 駕駛馬達車只有車尾一組上下車門，駕駛室後面是一扇緊急安全門；地圖 LOD 的中間車是駕駛車後半鏡射，受電弓放不上去，跟 EMU100 一樣不放。
add('emu300','railcar',L=8.9,W=2.8,H=3.5,doors=2,doorLeaves=1,doorW=.62,rearDoor=.50,frontDoor=1.67,radiusTop=.42,winR=.08,
 winH=.70,winZ=2.24,doorWinH=.80,doorWinZ=2.30,doorTop=2.84,body='EEDFA0',accent='DD5A3C',acUnits=[(-1.26,1.18),(-.04,1.18)],acMat='e3roof',
 power='overhead-other-car',label='EMU300')

def emu300(s):
 """EMU300 自強號駕駛馬達車（義大利 Socimi，1988–89，用到 2021）。參考：Commons「TRA EMU300 50EMC301.jpg」「TRA EMU301 at Changhua Station 20130806.jpg」
 （Rsa，CC BY-SA 3.0，車側與斜側）、「TRA EMU300 approaching Xizhi Station 20191201.jpg」（Cheng-en Cheng，CC BY-SA 2.0，正面）、
 「TRA 50EMC307.jpg」（鐵路1，CC BY-SA 4.0，進氣口）、「LED monitor outside of TRA EMU300 with auto doors.jpg」（Solomon203，CC BY 3.0，車側 LED 顯示器）。
 外觀是 2008–2012 年換滑塞式車門之後（一路用到停駛，國家鐵道博物館保存的 EMC307 也是這樣）。
 車頭比 EMU100 斜、比較方正：琥珀黃底，上緣與下緣橘紅，中間一條橘紅斜帶往中央下斜；中央貫通門是黑色凸框裡一扇琥珀黃門扇；
 兩側前窗、上方深色路線窗、上緣兩角高壓警示牌；頂端中央橘紅凸座上雙頭燈；下緣兩側內白外紅燈；最下面琥珀黃排障板開直槽。駕駛室側面的色帶是水平的，到車頭才往中央下斜；車頂橘紅頂帽。
 車側乳黃上半、橘褐下半（分界在窗下 .16）；駕駛室後一塊米灰色塊（後緣是尖端朝後的「<」形，尖端在分色線高度）、一扇緊急安全門（照車身分色），
 再往後五扇大窗、一扇中窗、兩扇窄窗、車尾一組淺米色滑塞門；第二、三扇大窗下各一組動力車進氣口，車尾第一扇大窗上方 LED 顯示器。
 車頂兩端電阻器（駕駛室那端的較長）、中間偏後兩台冷氣。車身中央留窗間柱：中間車鏡射後半時不會併成一扇寬窗。
 高度依汐止站正面照（前窗 1.92–2.62 為基準，100 px/m）與 50EMC301 車側照（每一欄用該處車身上下緣換算）量：
 前窗 1.92–2.62、路線窗 2.81–2.97、高壓警示牌 3.04–3.23、上緣橘紅 3.05 以上、貫通門凸框 .82–3.17（寬 1.24）、門 .93–2.86、門窗 1.91–2.71、頂部頭燈 3.35、下緣燈 1.07；
 斜帶外側 1.57–1.70、下緣橘紅外側 1.36 以下，到貫通門凸框各低 .33、.33、.27；車側窗 1.89–2.59、分色線 1.71、米灰色塊 .90–2.84。"""
 L,W,H=s['L'],s['W'],s['H']
 color('e3cream','EEDFA0',.06,.36,.25);color('e3orange','D67E22',.05,.34,.28);color('e3beige','D4C5B0',.06,.36,.25);color('e3leaf','E8D8C4',.06,.36,.25)
 color('e3amber','F0B22A',.05,.34,.30);color('e3red','D9523A',.05,.34,.30);color('e3roof','A3A8AC',.40,.42,.08)
 profile=[(.83,L/2-.05),(1.00,L/2),(2.00,L/2-.10),(2.90,L/2-.19),(3.15,L/2-.26),(3.32,L/2-.35),(3.44,L/2-.45),(H,L/2-.55)]
 cab=[(1.36,'e3red'),(1.57,'e3amber'),(1.70,'e3red'),(3.05,'e3amber')]
 def deco(x,y,side,dw):
  if x<0:return
  top=s['doorTop'];w=dw-.022
  box('安全門上半乳黃',(x,y+side*.040,(1.71+top)/2),(w,.008,top-1.71),'e3cream',.002);box('安全門下半橘褐',(x,y+side*.040,(.92+1.71)/2),(w,.008,1.71-.92),'e3orange',.002)
 f,neck,doors=emu_body(s,profile,.06,[(1.71,'e3orange'),(3.06,'e3cream'),(H+1,'e3roof')],[(1.08,'e3red'),(3.05,'e3amber'),(H+1,'e3red')],
  cab+[(H+1,'e3red')],leaf='e3leaf',gaps=[0,0,0],deco=deco)
 # 米灰色塊後緣：分色線高度（1.71）最靠後，往上、往下都斜向前
 edge=lambda z:2.52+(.47*(z-1.71)/1.13 if z>1.71 else .39*(1.71-z)/.81)
 for side in [-1,1]:
  y=side*(W/2+.018)
  for x,w in [(-3.415,.22),(-3.095,.22),(-2.715,.34)]+[(-2.075+.83*k,.72) for k in range(5)]:sidewindow(x,y,2.24,w,.70,r=.08)
  panel('車側 LED 顯示器',(-2.18,side*(W/2+.022),2.76),.36,.10,'frame',r=.02)
  for x in [-1.245,-.415]:louver('動力車進氣口',x,side*(W/2+.012),1.47,.39,.32,6,frame='frame',slat='e3orange')
  side_paint('駕駛室後米灰色塊',s,f,side,[lambda x,z:x-edge(z)],2.52,3.30,.90,2.84,'e3beige')
  lo=.95
  for hi,m in cab:side_paint('駕駛室側面色帶',s,f,side,[],3.30,neck+.04,lo,hi,m);lo=hi
  sidewindow(3.64,y,2.18,.44,.78,r=.06);box('駕駛室側窗中柱',(3.64,y+side*.030,2.18),(.03,.012,.78),'frame',0)
  box('駕駛室側面小燈',(3.64,y+side*.004,2.80),(.09,.012,.05),'frame',.004)
  for x in [3.94,4.18]:box('乘務員門門縫',(x,y+side*.004,1.90),(.012,.008,1.80),'frame',0)
  sidewindow(4.06,y,2.36,.12,.72,r=.03)
 shell_wrap('駕駛室橘紅頂帽',s,f,upper_section(s,3.05),3.30,L/2,'e3red')
 # 車頭斜帶：外側接駕駛室側面的水平色帶，往中央下斜（車頭面本身 1.08 以下已是橘紅）
 t=lambda y:min(1,max(0,(W/2-abs(y))/(W/2-.62)));e=W/2-.004
 front_patch('車頭下緣橘紅',f,-e,e,1.04,lambda y:1.36-.27*t(y),'e3red',.028,cols=40,rows=3)
 front_patch('車頭橘紅斜帶',f,-e,e,lambda y:1.57-.33*t(y),lambda y:1.70-.33*t(y),'e3red',.028,cols=40,rows=2)
 # 貫通門：黑色底板上一扇琥珀黃門扇，外圍黑色凸框（左右與上緣三條，比門扇再凸出一點）
 front_panel('貫通門黑色底板',f,0,1.995,1.24,2.35,'frame',.03,.030)
 front_panel('貫通門門扇',f,0,1.895,.82,1.93,'e3amber',.03,.040)
 front_panel('貫通門窗框',f,0,2.31,.56,.86,'frame',.06,.046);front_panel('貫通門窗',f,0,2.31,.50,.80,'glass',.05,.050)
 for side in [-1,1]:front_panel('貫通門凸框',f,side*.515,1.995,.21,2.35,'frame',.02,.066)
 front_panel('貫通門凸框',f,0,3.015,1.24,.31,'frame',.02,.066)
 for side in [-1,1]:
  front_panel('前窗黑框',f,side*.93,2.27,.66,.76,'frame',.06,.030);front_panel('前窗玻璃',f,side*.93,2.27,.60,.70,'glass',.05,.040)
  front_panel('路線窗框',f,side*.90,2.89,.52,.22,'frame',.04,.030);front_panel('路線窗',f,side*.90,2.89,.46,.16,'glass',.03,.038)
  front_panel('高壓警示牌',f,side*.82,3.135,.12,.19,'yellow',.01,.032)
  for y in [side*.84,side*1.09]:front_panel('燈圈',f,y,1.07,.24,.24,'frame',.12,.030)
  lamp('頭燈',f,side*.84,1.07,.085);lamp('尾燈',f,side*1.09,1.07,.085,red=True)
 for y in [-.81,1.05]:wiper(f,y,1.98,.50)
 front_panel('車號牌',f,-.93,1.80,.40,.09,'white',.02,.040);face_label(s['label'],f,-.93,1.80,.054,.05)
 # 頂端中央雙頭燈：從斜上緣凸出的橘紅燈座
 xf=f(0,3.20);use('03');box('頂部頭燈座',(xf-.14,0,3.34),(.28,.58,.28),'e3red',.06)
 for y in [-.16,.16]:lamp('頂部頭燈',lambda yy,zz:xf-.075,y,3.35,.075)
 x=f(0,.83)+.04;use('03');box('琥珀黃排障板',(x,0,.42),(.05,1.50,.36),'e3amber',.02)
 for k in range(9):box('排障板直槽',(x+.027,-.60+k*.15,.42),(.006,.035,.24),'frame',.002)
 # 車頂兩端電阻器：駕駛室那端的較長、較高，把無線天線蓋住
 for x0,x1,h in [(-3.86,-2.72,.20),(1.90,3.25,.24)]:
  roof_hood('電阻器箱',s,x0,x1,1.30,h,.08,'e3roof')
  for k in range(10):box('電阻器箱散熱格柵',(x0+.14+k*(x1-x0-.28)/9,0,H+h+.005),(.03,1.06,.01),'chassis',.002)
 return f

# 騰雲號（德國 Hohenzollern，1887）：兩軸四輪（0-4-0T）水櫃式小型蒸機，沒有煤水車；全長 6,477 mm、寬 2,184 mm、高 3,461 mm、動輪 889 mm
# （Kurogane no Michi「Taiwan No.1 Teng-yun」規格表）。車庫是 Q 版：長度照 CK124 的壓縮比壓到 4.66、高 3.34。
# 寬照實車 2.20：車庫依主車的寬縮放整列（garage-model.js 的 1.25/size.y），後面掛的藍皮客車才會比它大；動輪中心面 ±.93，縮放後落在鋼軌上。
add('tengyun','steam',L=4.66,W=2.2,H=3.34,drivers=2,driverRadius=.40,leading=0,trailing=0,tank=True,body='1E2224',accent='C42420',power='steam',label='騰雲號')

def ty_sharp(o,test):
 """test(i, j) 成立的邊（頂點序號）標成稜線：匯出的角落法線在這裡分開，平滑面接平面不會糊成一片。"""
 d=o.data;a=d.attributes.get('sharp_edge') or d.attributes.new('sharp_edge','BOOLEAN','EDGE')
 for e in d.edges:
  if test(*e.vertices):a.data[e.index].value=True
 return o

def ty_lathe(name,x,y,prof,material,n=32,sharp=()):
 """繞 Z 軸旋轉的封閉側面輪廓 prof=[(半徑, z), ...]（首尾相接；半徑 0 是軸上的極點）；sharp 是要留稜線的輪廓點序號。"""
 v,rings=[],[]
 for r,z in prof:
  if r<1e-6:rings.append([len(v)]);v.append((x,y,z))
  else:rings.append(list(range(len(v),len(v)+n)));v+=[(x+r*math.cos(2*math.pi*i/n),y+r*math.sin(2*math.pi*i/n),z) for i in range(n)]
 f=[]
 for a,b in zip(rings,rings[1:]+rings[:1]):
  if len(a)==1 and len(b)==1:continue
  if len(a)==1:f+=[(a[0],b[(i+1)%n],b[i]) for i in range(n)]
  elif len(b)==1:f+=[(a[i],a[(i+1)%n],b[0]) for i in range(n)]
  else:f+=[(a[i],a[(i+1)%n],b[(i+1)%n],b[i]) for i in range(n)]
 ring={j:k for k,rr in enumerate(rings) for j in rr}
 return ty_sharp(mesh(name,v,f,material,0,True),lambda i,j:ring[i]==ring[j] and ring[i] in sharp)

def ty_xplate(name,pts,x0,x1,material,smooth=False,sharp=()):
 """正面輪廓 pts=[(y, z), ...] 沿 X 從 x0 擠到 x1 的板（駕駛室前後牆、弧頂）；smooth 時兩端面與 sharp 那幾個輪廓點的縱向邊留稜線。"""
 n=len(pts);v=[(x0,y,z) for y,z in pts]+[(x1,y,z) for y,z in pts]
 o=mesh(name,v,[tuple(range(n)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],material,0,smooth)
 return ty_sharp(o,lambda i,j:i//n==j//n or (i%n==j%n and i%n in sharp)) if smooth else o

def tengyun(s):
 """騰雲號（台灣第 1 號機車）。參考：Commons「1887 Hohenzollern 0-4-0 ‘No1’ “Teng-Yung” at the National Taiwan Museum in Taipei. 04-03-2026 (55236084362).jpg」
 （Alan Wilson，CC BY-SA 4.0，斜前方）、「TRA 1 circa late 1990s.jpg」（Dquai，CC BY-SA 4.0，正面）、「Teng-Yung locomotive in Taipei Railway Workshop 1999-01.jpg」
 （Winertai，CC BY-SA 3.0，整修時還沒上漆）、「The Steam Locomotive No.1 of Taiwan Railway plaque 20171207.jpg」（Gary Lee Todd，CC0，說明牌上 1920 年代的側面照）、
 「Replica Victor Type Steam Locomotive.JPG」（SSR2000，CC BY-SA 3.0，東勢仿製車的水櫃與駕駛室位置）；史實照維基百科「騰雲號」。
 外觀取鑽石形煙囪（直筒上端加收集火星的大漏斗，1906 年起一直是這樣）、保存車的黑色車身與紅色前後緩衝梁。比例照片量：
 煙囪從煙箱頂算約是煙箱門直徑的 1.3 倍，直筒加基座與漏斗加頂蓋約各半、漏斗上緣直徑約直筒的 2.8 倍；
 從步道算起，水櫃頂約在駕駛室頂高的四成、鍋爐頂約六成（1920 年代側面照），水櫃往前凸出駕駛室前牆；駕駛室側面後半是拱形出入口，前後牆各兩扇方窗；
 油燈式前燈在煙箱頂右側（-Y），步道前端兩角各一盞標識燈；彈簧秤式安全閥在煙囪後面的汽包上，駕駛室前方鍋爐上是扁圓砂箱；水櫃側面兩塊紅牌不放字。"""
 W=s['W'];R=.40;yw=.93;bz=1.70;xs=[.42,-.78];fp=1.04
 color('ctblack','1C2022',.30,.42,.10);color('tyred','C42420',.05,.40,.20)
 # 步道板與側緣、前後紅色緩衝梁（兩排鉚釘）、長緩衝器、鉤頭與鏈條。
 use('01');box('步道板',(0,0,fp-.05),(3.68,W,.10),'body',.01)
 for side in [-1,1]:box('步道側緣',(0,side*(W/2-.015),fp-.135),(3.68,.03,.07),'body',0)
 for end in [-1,1]:
  use('01');box('緩衝梁',(end*1.90,0,.78),(.12,W,.52),'tyred',.01)
  for z in [.62,.94]:
   for k in range(9):cyl('緩衝梁鉚釘',(end*1.963,-1.0+k*.25,z),.016,.014,'tyred','X',8,0)
  use('07')
  for side in [-1,1]:
   y=side*.72;box('緩衝器座板',(end*1.975,y,.80),(.03,.24,.24),'ctblack',.005)
   cyl('緩衝器套筒',(end*2.03,y,.80),.10,.08,'ctblack','X',20,.005);cyl('緩衝器桿',(end*2.18,y,.80),.065,.24,'ctblack','X',16,0)
   cyl('緩衝器頭',(end*2.315,y,.80),.15,.03,'ctblack','X',28,.008)
  box('鉤頭座',(end*1.985,0,.80),(.05,.22,.16),'ctblack',.005);rod('連結鉤',(end*1.99,0,.80),(end*2.18,0,.80),.03,'ctblack')
  rod('鉤尖',(end*2.18,0,.80),(end*2.20,0,.87),.025,'ctblack')
  for z in [.72,.645]:torus_y('連結鏈環',(end*2.15,0,z),.035,.009,'ctblack',n=12,m=4)
 # 前端扶手橫過緩衝梁上方、兩端沿梁面往下彎；步道前端兩角標識燈，後端兩角紅色尾燈。
 use('05');rod('前端扶手',(1.985,-1.04,1.30),(1.985,1.04,1.30),.015,'metal');rod('前端扶手中柱',(1.95,0,fp),(1.95,0,1.30),.013,'metal')
 for y in [-1.04,1.04]:rod('前端扶手',(1.985,y,1.30),(1.985,y,.92),.015,'metal')
 use('03')
 for side in [-1,1]:
  for x,d,lens in [(1.80,1,'lamp'),(-1.91,-1,'taillamp')]:
   box('前端標識燈' if d>0 else '後端尾燈',(x,side*.86,fp+.10),(.14 if d>0 else .10,.14,.20),'body',.01);cyl('燈頂蓋',(x,side*.86,fp+.215),.06,.02,'body','Z',16,0)
   xe=x+d*(.07 if d>0 else .05);cyl('燈鍍鉻圈',(xe+d*.002,side*.86,fp+.11),.058,.008,'metal','X',20,0);cyl('標識燈透鏡' if d>0 else '尾燈透鏡',(xe+d*.007,side*.86,fp+.11),.048,.008,lens,'X',20,0)
 # 煙箱、煙箱門（鉸鏈帶、紅色把手輪）、鍋爐與箍帶、鞍座。
 use('01');box('煙箱鞍座',(1.50,0,fp+.09),(.50,.80,.20),'body',0)
 cyl('前煙箱',(1.50,0,bz),.50,.60,'body','X',48,0);cyl('煙箱門',(1.825,0,bz),.44,.05,'body','X',48,.015)
 for i in range(16):
  a=2*math.pi*i/16;cyl('煙箱前緣鉚釘',(1.805,.475*math.cos(a),bz+.475*math.sin(a)),.014,.02,'ctblack','X',8,0)
 for dz in [-.17,.17]:box('煙箱門鉸鏈帶',(1.856,.14,bz+dz),(.014,.52,.05),'ctblack',0);cyl('煙箱門鉸鏈軸',(1.86,.40,bz+dz),.026,.10,'ctblack','Z',12,0)
 line('煙箱門把手輪',[(1.878,.085*math.cos(2*math.pi*i/12),bz+.085*math.sin(2*math.pi*i/12)) for i in range(13)],.012,'tyred')
 for k in range(4):rod('把手輪輻',(1.878,0,bz),(1.878,.085*math.cos(math.pi*k/2),bz+.085*math.sin(math.pi*k/2)),.009,'tyred')
 cyl('把手輪轂',(1.865,0,bz),.022,.04,'tyred','X',12,0)
 cyl('圓筒鍋爐',(.32,0,bz),.45,1.76,'body','X',48,0)
 for x in [-.25,.45]:cyl('鍋爐箍帶',(x,0,bz),.458,.035,'ctblack','X',48,0)
 # 煙囪：喇叭狀基座、直筒、鉚接環、往上張開的漏斗（收集火星）、上緣與頂蓋。
 xc=1.50
 ty_lathe('煙囪喇叭基座',xc,0,[(.26,2.10),(.25,2.15),(.215,2.22),(.18,2.29),(.155,2.36),(.145,2.42),(.10,2.42),(.10,2.10)],'body',32,(0,5,6,7))
 cyl('煙囪直筒',(xc,0,2.575),.145,.31,'body','Z',32,0);cyl('煙囪鉚接環',(xc,0,2.755),.165,.05,'ctblack','Z',32,0)
 ty_lathe('鑽石形煙囪漏斗',xc,0,[(.155,2.78),(.41,3.21),(.39,3.21),(.135,2.78)],'body',40,(0,1,2,3))
 cyl('漏斗上緣',(xc,0,3.23),.425,.04,'ctblack','Z',40,.008)
 for i in range(16):a=2*math.pi*i/16;box('漏斗上緣鉚釘',(xc+.428*math.cos(a),.428*math.sin(a),3.23),(.018,.018,.018),'ctblack',0)
 ty_lathe('漏斗頂蓋',xc,0,[(.40,3.25),(.36,3.28),(.27,3.315),(.14,3.335),(0,3.34),(0,3.25)],'ctblack',40,(0,))
 # 油燈式前燈：煙箱頂右側，方形燈箱、圓透鏡、頂上通風筒。
 use('03');yl=-.33
 box('前燈座',(1.66,yl,2.08),(.18,.16,.07),'ctblack',0);box('煙箱前燈燈箱',(1.66,yl,2.27),(.20,.22,.32),'body',.015)
 cyl('前燈鍍鉻圈',(1.766,yl,2.28),.10,.012,'metal','X',28,0);cyl('煙箱前燈透鏡',(1.772,yl,2.28),.085,.01,'lamp','X',28,0)
 cyl('燈箱通風筒',(1.66,yl,2.47),.04,.08,'body','Z',16,0);cyl('通風筒頂蓋',(1.66,yl,2.52),.065,.025,'body','Z',16,0)
 # 汽包上的彈簧秤式安全閥、駕駛室前方鍋爐上的扁圓砂箱、鍋爐側扶手、從汽包往下接汽缸的外置蒸汽管。
 use('05')
 ty_lathe('安全閥汽包',1.02,0,[(.17,2.09),(.17,2.23),(.15,2.27),(.10,2.295),(0,2.305),(0,2.09)],'body',28,(0,))
 cyl('安全閥柱',(1.02,0,2.40),.04,.22,'metal','Z',16,0);box('安全閥槓桿',(1.02,0,2.53),(.36,.045,.035),'metal',0)
 for z in [2.375,2.405,2.435,2.465]:cyl('安全閥彈簧圈',(1.02,0,z),.058,.014,'metal','Z',16,0)
 cyl('砂箱',(-.22,0,2.18),.21,.14,'body','Z',32,0);cyl('砂箱蓋',(-.22,0,2.265),.225,.03,'ctblack','Z',32,.006)
 for side in [-1,1]:
  line('鍋爐側扶手',[(-.50,side*.51,1.97),(1.20,side*.51,1.97)],.014,'metal')
  for x in [-.35,.35,1.00]:rod('扶手支架',(x,side*.36,1.97),(x,side*.51,1.97),.011,'metal')
  line('外置蒸汽管',[(1.10,side*.15,2.14),(1.13,side*.40,2.02),(1.17,side*.48,1.70),(1.24,side*.54,1.30),(1.30,side*.60,fp+.02),(1.38,side*.86,.80)],.032,'body')
 # 駕駛室前面兩側的水櫃與注水口、水櫃側面兩塊紅牌。
 use('01');xt0,xt1,zt=-1.12,.15,1.74
 for side in [-1,1]:
  box('兩側水櫃',((xt0+xt1)/2,side*.835,(fp+zt)/2),(xt1-xt0,.47,zt-fp),'body',.02);cyl('水櫃注水口',(xt1-.18,side*.84,zt+.015),.09,.03,'ctblack','Z',20,0)
  for z,h in [(1.52,.17),(1.33,.08)]:
   panel('水櫃側紅牌框',(-.94,side*1.077,z),.18,h+.03,'metal',r=.015,depth=.008);panel('水櫃側紅牌',(-.94,side*1.082,z),.15,h,'tyred',r=.012,depth=.008)
 # 駕駛室：側牆後半是拱形出入口，兩旁扶手；前後牆上緣跟著弧頂、各兩扇方窗；弧頂前後出簷；車頂前端中央汽笛。
 xcr,xcf,xd0,xd1,ze=-1.86,-.56,-1.68,-1.12,2.74
 arch=[(xd1,2.30)]+[((xd0+xd1)/2+.28*math.cos(math.pi*i/8),2.30+.28*math.sin(math.pi*i/8)) for i in range(1,8)]+[(xd0,2.30)]
 for side in [-1,1]:
  y0,y1=side*1.02,side*1.06
  ct_plate('駕駛室側牆',[(xd1,zt),(xcf,zt),(xcf,ze),(xd1,ze)],y0,y1,'body');ct_plate('駕駛室側牆後柱',[(xcr,fp),(xd0,fp),(xd0,ze),(xcr,ze)],y0,y1,'body')
  ct_plate('出入口拱楣',[(xd0,ze),(xd1,ze)]+arch,y0,y1,'body')
  use('05')
  for x in [xcr+.06,xd1+.06]:
   rod('駕駛室扶手',(x,side*1.085,1.22),(x,side*1.085,2.30),.016,'metal')
   for z in [1.22,2.30]:rod('扶手支架',(x,side*1.06,z),(x,side*1.085,z),.010,'metal')
  rod('駕駛室後端扶手',(xcr-.03,side*.98,1.25),(xcr-.03,side*.98,2.40),.015,'metal')
  for z in [1.30,2.35]:rod('扶手支架',(xcr,side*.98,z),(xcr-.03,side*.98,z),.010,'metal')
  use('01')
 roofz=lambda y:2.72+.12*(1-(y/1.10)**2)
 wall=[(-1.02,fp),(1.02,fp)]+[(1.02-2.04*i/12,roofz(1.02-2.04*i/12)) for i in range(13)]
 ty_xplate('駕駛室前牆',wall,xcf-.04,xcf,'body');ty_xplate('駕駛室後牆',wall,xcr,xcr+.04,'body')
 box('駕駛室內部',((xcr+xcf)/2,0,1.885),(xcf-xcr-.12,1.96,1.63),'frame',0)
 k=14;top=[(-1.10+2.20*i/k,2.76+.12*(1-(-1+2*i/k)**2)) for i in range(k+1)]
 ty_xplate('駕駛室弧頂',top+[(y,z-.04) for y,z in reversed(top)],xcr-.07,xcf+.07,'body',True,{0,k,k+1,2*k+1})
 use('02')
 for side in [-1,1]:
  for x,d in [(xcf,1),(xcr,-1)]:
   panel('駕駛室方窗框',(x+d*.006,side*.56,2.27),.46,.48,'frame','front',r=.04);panel('駕駛室方窗玻璃',(x+d*.012,side*.56,2.27),.40,.42,'glass','front',r=.03,depth=.012)
 use('05');cyl('汽笛',(xcf-.08,0,2.935),.028,.11,'metal','Z',12,0);cyl('汽笛口',(xcf-.08,0,3.00),.04,.02,'metal','Z',12,0)
 # 台枠、軸箱與疊板彈簧、灰箱、外置汽缸與汽室、滑板與十字頭。
 use('04')
 for side in [-1,1]:
  box('主台枠',(0,side*.50,.66),(3.70,.06,.60),'ctblack',0)
  for x in xs:box('軸箱',(x,side*.56,R),(.20,.10,.24),'ctblack',0);box('疊板彈簧',(x,side*.56,.86),(.62,.07,.07),'ctblack',0)
  y=side*yw;cyl('外置汽缸',(1.42,y,.50),.155,.48,'body','X',32,.008)
  for x in [1.175,1.665]:cyl('汽缸端蓋',(x,y,.50),.135,.025,'ctblack','X',32,0)
  box('汽室',(1.42,y,.71),(.40,.16,.14),'body',.01);rod('閥桿',(1.22,y,.71),(1.00,y,.71),.018,'metal');rod('活塞桿',(1.17,y,.50),(.95,y,.50),.03,'metal')
  for z in [.565,.435]:ct_bar('滑板',(1.16,z),(.84,z),.03,.05,y,'metal')
  box('十字頭',(.95,y,.50),(.14,.08,.12),'metal',0);cyl('十字頭銷',(.95,side*1.02,.50),.03,.10,'metal','Y',12,0)
 box('灰箱',(-.18,0,.62),(.70,.80,.40),'ctblack',0)
 # 動輪：兩軸十二輻、沒有白線；左右曲柄差 90 度，配重塊在曲柄對面。主連桿從十字頭接後軸，連結桿接兩軸。
 for x in xs:cyl('動輪軸',(x,0,R),.07,2*yw-.06,'ctblack','Y',16,0)
 for side,th in [(-1,math.radians(-40)),(1,math.radians(50))]:
  px,pz=.17*math.cos(th),.17*math.sin(th)
  for i,x in enumerate(xs):
   ct_wheel(x,side*yw,R,12,white=False,counter=(th+math.pi,math.radians(80)))
   cyl('動輪曲柄銷',(x+px,side*(yw+(.07 if i==0 else .10)),R+pz),.04,.08 if i==0 else .12,'metal','Y',12,0)
  ct_bar('連結桿',(xs[1]+px,R+pz),(xs[0]+px,R+pz),.07,.03,side*1.02,'metal')
  ct_bar('主連桿',(.95,.50),(xs[1]+px,R+pz),.08,.03,side*1.065,'metal')
 # 踏階：駕駛室出入口下兩階、前端兩角各一階。
 xm=(xd0+xd1)/2
 for side in [-1,1]:
  for z in [.66,.38]:box('司機踏階',(xm,side*1.00,z),(.34,.18,.035),'ctblack',0)
  for x in [xm-.16,xm+.16]:rod('踏階吊架',(x,side*1.08,.36),(x,side*1.08,fp-.12),.014,'ctblack')
  box('前端踏階',(1.82,side*1.00,.42),(.22,.18,.035),'ctblack',0);rod('前端踏階吊架',(1.82,side*1.08,.40),(1.82,side*1.08,.52),.014,'ctblack')

BUILDERS.update({'dr3000':dr3000,'ct250':ct250,'fuxing':fuxing,'emu300':emu300,'tengyun':tengyun})
