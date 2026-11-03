"""台灣經典退役車：DR3000、CT250、復興號、EMU300、騰雲號。
規格用 tw_specs.add 登記、建模函式登記進 tw_models.BUILDERS（build_tw.py 匯入本檔）；車殼與車頭零件沿用 tw_models 同家族的函式。
參考照片只在本機比對，檔名、作者、授權記在 catalog-source.json；不放營運商標，車號用可移除的示意字牌。"""
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

BUILDERS.update({'dr3000':dr3000})
