"""11/09 補進車庫的 12 款：EMU200、DR2800、E100、S200、Shay 31、台糖 346、五分車客車、S400、EMU400、35PC32701、35SA32820、0 系新幹線。
規格用 tw_specs.add 登記、建模函式登記進 tw_models.BUILDERS（build_tw.py 匯入本檔）；車殼與車頭零件沿用 tw_models、tw_classic 同家族的函式。
參考照片只在本機比對，檔名、作者、授權記在 catalog-source.json；不放營運商標，車號用可移除的示意字牌。"""
import math
from tw_specs import add
from tw_models import *

# EMU200（南非 UC&W 車體、英國 GEC 電機，1987）：原廠塗裝的駕駛馬達車。車身側面跟 EMU1200 同一個車體（EMU1200 是 2002–04 年用它改造的），
# 所以窗序、乘務員門、客室門照 emu1200；車頭是改造前的平頭黃色貫通門。受電弓在中間的 EP 車，駕駛車不放。
add('emu200','railcar',L=8.7,W=2.8,H=3.5,doors=2,doorLeaves=1,doorW=.62,rearDoor=.62,frontDoor=1.46,crewDoor=True,radiusTop=.45,winR=.08,
 winH=.80,winZ=2.36,doorWinH=.76,doorWinZ=2.36,doorTop=2.92,body='E8DDBE',accent='E8582E',acUnits=[(-2.1,1.5),(.5,1.5)],acMat='e2roof',
 power='overhead-other-car',label='EMU200')

def emu200(s):
 """EMU200 原廠塗裝（1987 年南非 UC&W 車體、英國 GEC 電機，自強號）。參考：Commons「Taiwan Railway Administration EMU 206 Banqiao 1989.jpg」
 （Thyristorchopper，CC BY-SA 3.0，斜側：車頭與 1989 年的米色＋棕色車身）、「TRA UCW EMU200 Mainline Running in 1997.jpg」（Lexcie，CC BY-SA 3.0，正面）、
 「EMU200 55EMC206.jpg」「EMU200 in Ershui.jpg」（Kazehayashi，CC BY-SA 4.0，車側與車頂）。
 平頭車頭、上緣大圓角：橘紅頂帽（中央橢圓雙頭燈、兩側黃色高壓警示小牌、左上路線牌、右上標識燈），帽下整片黃色；兩側圓角前窗，
 中央黑色貫通道外框裡一扇黃色貫通門（門上有窗）；窗下一條細橘紅帶、一條黃帶，往中央微微下斜，再往下整片橘紅，橘紅燈座裡外紅尾燈、內白頭燈；
 最下面深色排障板加黃黑斜紋。車頭的黃與橘紅繞到駕駛室側面，到乘務員門後收掉；客室段米色上半、棕色下半（分界在窗下）。
 高度依 1997 正面照（車寬 2.8 m 為 70 px/m）與 1989 斜側照的車頭放大量：頂帽 2.90 以上、頭燈 3.20、前窗 1.83–2.68（|y| .62–1.24）、
 貫通道外框 .90–2.86（寬 1.14）、門 .95–2.80（寬 .82）、門窗 1.92–2.62、細橘紅帶外側 1.64–1.76、黃帶 1.44–1.64、到中央各低 .15、燈 1.20。"""
 L,W,H=s['L'],s['W'],s['H']
 color('e2cream','E8DDBE',.06,.36,.25);color('e2tan','A07C52',.06,.38,.22);color('e2yel','EEC232',.05,.34,.30)
 color('e2or','E8582E',.05,.34,.30);color('e2roof','B4B2AA',.40,.42,.08);color('e2skirt','3A3C3E',.35,.45,.08)
 profile=[(.83,L/2-.04),(1.00,L/2),(H-.40,L/2-.01),(H-.16,L/2-.08),(H,L/2-.22)]
 s['bowPow']=6
 cab=[(1.44,'e2or'),(1.64,'e2yel'),(1.76,'e2or'),(H-.14,'e2yel')]
 f,neck,doors=emu_body(s,profile,.08,[(1.80,'e2tan'),(H-.14,'e2cream'),(H+1,'e2roof')],[(.99,'e2or'),(2.90,'e2yel'),(H+1,'e2or')],
  cab+[(H+1,'e2roof')],leaf='e2cream',gaps=[0,6,0],leafbands=[(1.36,.88,'e2tan')],crew='e2yel')
 # 駕駛室側面：車頭的黃與橘紅橫帶繞過來，到乘務員門後（xw）收掉；車頂圓角上一段黃色接到車頂
 xw=neck-.72;cx=neck-.36
 for side in [-1,1]:
  lo=.95
  for hi,m in cab:side_paint('駕駛室側面色帶',s,f,side,[],xw,neck+.04,lo,min(hi,3.05),m);lo=hi
  shell_wrap('駕駛室側面黃色上緣',s,f,upper_section(s,3.04,H-.14,side),xw,L/2,'e2yel')
  lo=.94
  for hi,m in cab[:3]:
   if m=='e2or':box('乘務員門橫帶',(cx,side*(W/2+.053),(lo+hi)/2),(.40,.004,hi-lo),m,.001)
   lo=hi
 # 車頭色帶：外側接駕駛室側面，從 |y| 1.0 到 .6 往中央下斜 .15（中央被貫通道外框蓋住）
 t=lambda y:min(1,max(0,(1.0-abs(y))/.40));e=W/2-.004
 front_patch('車頭下緣橘紅',f,-e,e,.97,lambda y:1.44-.15*t(y),'e2or',.028,cols=40,rows=3)
 front_patch('車頭細橘紅帶',f,-e,e,lambda y:1.64-.15*t(y),lambda y:1.76-.15*t(y),'e2or',.028,cols=40,rows=2)
 # 頂帽：中央橢圓雙頭燈、兩側黃色高壓警示小牌、左上路線牌、右上標識燈
 front_panel('頂部頭燈框',f,0,3.20,.46,.22,'frame',.11,.032)
 for y in [-.10,.10]:lamp('頂部頭燈',f,y,3.20,.070)
 for y in [-.62,.62]:front_panel('高壓警示牌',f,y,3.21,.10,.18,'e2yel',.01,.032)
 front_panel('路線牌框',f,-.86,3.04,.50,.19,'frame',.04,.030);front_panel('路線牌',f,-.86,3.04,.44,.13,'white',.03,.036)
 front_panel('標識燈框',f,.90,3.02,.20,.12,'frame',.05,.032);lamp('標識燈',f,.90,3.02,.040)
 # 兩側圓角前窗、雨刷
 for side in [-1,1]:
  front_panel('前窗橡膠框',f,side*.93,2.255,.68,.91,'frame',.10,.032);front_panel('前窗玻璃',f,side*.93,2.255,.62,.85,'glass',.08,.040)
  wiper(f,side*.93,1.92,.48)
 # 中央貫通道：黑色外框裡一扇黃門（門上有窗）
 front_panel('貫通道黑色外框',f,0,1.88,1.14,1.96,'frame',.06,.034)
 front_panel('貫通門門縫',f,0,1.875,.86,1.89,'chassis',.03,.040);front_panel('貫通門門扇',f,0,1.875,.82,1.85,'e2yel',.03,.046)
 front_panel('貫通門窗框',f,0,2.27,.52,.76,'frame',.06,.050);front_panel('貫通門窗',f,0,2.27,.46,.70,'glass',.05,.054)
 box('貫通門把手',(f(.30,1.70)+.06,.30,1.70),(.03,.03,.16),'metal',.006)
 # 橘紅燈座：外紅尾燈、內白頭燈，各有深色燈圈
 for side in [-1,1]:
  front_panel('燈座',f,side*.94,1.20,.60,.30,'e2or',.13,.036)
  for y in [side*.80,side*1.08]:front_panel('燈圈',f,y,1.20,.21,.21,'frame',.105,.042)
  lamp('頭燈',f,side*.80,1.20,.075);lamp('尾燈',f,side*1.08,1.20,.070,red=True)
  box('標識燈掛架',(f(side*1.0,1.80)+.05,side*1.0,1.80),(.07,.06,.10),'e2yel',.012)
 front_panel('車號牌',f,-.93,2.79,.40,.09,'white',.02,.036);face_label(s['label'],f,-.93,2.79,.054,.05)
 hazard(f(0,.83)+.07,W,.61,.43)
 return f

# DR2800（東急車輛，1982）：三節一組（兩節駕駛動力車夾一節電源拖車），車庫是 L 8.3，跟 DR3100 同斷面。
# 駕駛室側窗後面接客室門、六扇窗、車尾門；地圖 LOD 的中間車是駕駛車後半鏡射。
add('dr2800','railcar',L=8.3,W=2.8,H=3.4,doors=2,doorLeaves=1,doorW=.62,rearDoor=.62,frontDoor=1.30,cabWin=.95,radiusTop=.30,
 winH=.84,winZ=2.37,doorWinH=.78,doorWinZ=2.36,doorTop=2.90,body='BCC2C3',accent='EE5A22',acUnits=[],power='diesel',label='DR2800')

def dr2800(s):
 """DR2800 柴聯自強（東急車輛，Budd 授權的波紋不鏽鋼車體）。參考：Commons「TRA DR2827 at Taitung Station 20140225.jpg」（Komushi，CC BY-SA 4.0，正面）、
 「TRA DR2814 DMU Passing through Hualien Station 20150704.jpg」（玄史生，CC0，斜側）、「DR2800 Series DMU.jpg」（Samson Ng . D201@EAL，CC BY-SA 4.0，車頂）。
 跟 DR3100 同一套警戒塗裝的前身：黃色車頭、橘色頂帽、窗下橘帶接往中央下斜的橘色斜紋（比 DR3100 斜得緩），斜紋內側隔一道黃色斜帶、再往內到門框是橘色；
 頂帽中央凸出一個橘色雙頭燈座；貫通門外框是灰褐色金屬框，黃色門扇下半一塊深灰擋板；兩側黃圈尾燈。車側不鏽鋼波紋（窗下與窗上橫向壓紋）、窗下橘帶、窗上黃細線；
 駕駛室側面黃色（到側窗後收掉，窗下是不鏽鋼）；車頂中央一座黑色引擎冷卻器罩。
 高度依台東站正面照量（直向 480 px/m 的放大圖；橫向照車頭外緣到門框的比例換算，門框半寬 .5）：頂帽 2.95 以上、頭燈座 3.15–3.50、前窗 1.97–2.86（|y| .48–1.21）、
 貫通門框 .98–3.09（寬 1.0）、門 1.07–2.98（寬 .74）、門窗 1.99–2.85、窗下橘帶 1.66–1.86、斜紋 .97–1.86（外緣每往下 1 m 往中央移 .28、寬 .20）、
 黃色斜帶寬 .11、下緣橘帶 .83–.97、尾燈中心 |y| 1.05、高 1.42（黃圈半徑 .12）、高壓警示牌 2.97–3.18（中心 |y| .80）。"""
 L,W,H=s['L'],s['W'],s['H'];dmu_colours();color('d28gframe','6B655A',.40,.45,.08);color('d28hood','2E3033',.35,.50,.06)
 profile=[(.83,L/2-.04),(1.00,L/2),(H-.35,L/2-.01),(H-.12,L/2-.08),(H,L/2-.20)]
 s['bowPow']=6;bands=[(1.76,.20,'dorange'),(2.89,.06,'dyellow')]
 fz=[(.97,'dorange'),(2.95,'dyellow'),(H+1,'dorange')];nz=[(.97,'dorange'),(1.66,'dyellow'),(1.86,'dorange'),(3.15,'dyellow'),(H+1,'dorange')]
 f,neck,doors=emu_body(s,profile,.08,[(H-.16,'dstain'),(H+1,'droof')],fz,nz,leaf='dstain',gaps=[0,6,0],bands=bands,leafbands=bands)
 xw=neck-.95
 side_ribs(s,[1.00,1.07,1.14,1.21,1.28,1.35,1.42,1.49,1.56,1.63],-L/2+.08,neck-.04,'dstain')
 side_ribs(s,[2.97,3.04,3.11],-L/2+.08,xw,'dstain')
 # 駕駛室側面：窗下橘帶以上黃色（含車頂圓角），到側窗後收掉；側窗是左右拉窗
 for side in [-1,1]:
  side_paint('駕駛室側面黃色',s,f,side,[],xw,neck+.04,1.86,3.10,'dyellow')
  shell_wrap('駕駛室側面黃色上緣',s,f,upper_section(s,3.09,H-.16,side),xw,L/2,'dyellow')
  y=side*(W/2+.018);sidewindow(neck-.48,y,2.37,.58,.80,r=.06);box('駕駛室側窗中柱',(neck-.48,y+side*.030,2.37),(.03,.012,.80),'frame',0)
 dmu_face(s,f,dict(win=(.48,1.21,1.97,2.86),glass=2.80,gang=(1.0,.98,3.09,'d28gframe'),door=(.74,1.07,2.98),dwin=(.42,1.99,2.85),
  tail=(1.05,1.42,.12),hook=(.80,1.50),stripes=[(.995,.198),(.689,.60)],slope=.28,sz=(.97,1.86),band=(1.66,1.86,.99),hv=(.80,2.97,3.18,.10),plateZ=2.76))
 front_panel('貫通門下半擋板',f,0,1.29,.56,.40,'d28gframe',.03,.056)
 # 頂帽中央凸出的橘色雙頭燈座
 xf=f(0,3.30);use('03');box('頂部頭燈座',(xf-.10,0,3.32),(.30,.74,.34),'dorange',.06)
 for y in [-.16,.16]:lamp('頂部頭燈',lambda yy,zz:xf-.02,y,3.33,.10)
 # 車頂中央黑色引擎冷卻器罩（兩端斜面開格柵）、一支排氣管
 roof_hood('引擎冷卻器罩',s,-2.5,.9,W*.72,.34,.48,'d28hood')
 for x0 in [-2.5,.9-.48]:
  for k in range(5):box('冷卻器斜面格柵',(x0+.08+k*.08,0,H+.16),(.03,W*.56,.012),'chassis',.002)
 for k in range(9):box('冷卻器頂部格柵',(-1.85+k*.25,0,H+.315),(.04,W*.50,.01),'chassis',.002)
 use('05');cyl('排氣管',(-.30,.70,H+.20),.065,.40,'chassis')
 return f

# E100（英國 GEC 電機、南非 UC&W 組裝，1976 年起交車）：雙頭電力機車，全長 15.1 m（維基資訊框 15,120 mm），比 E200 系（17 m、L 8.6）短，車庫是 L 7.9。
add('e100','electric',L=7.9,W=2.85,H=3.45,pantos=2,axles=2,radiusTop=.42,radiusBottom=.12,power='overhead',body='F2EEE4',accent='E5532E',label='E100')

def e100(s):
 """E100 電力機車（台鐵第一款電力機車；保存的 E101 是橘白塗裝配 V 字白帶）。參考：Commons「E101 electric locomotive.jpg」（D1114456，CC BY-SA 4.0，斜正面）、
 「TRA E101 at Changhua Roundhouse 20080717.jpg」（黃 zero159，CC BY-SA 2.0）、「TRA E100 electric locomotives at Changhua Station.jpg」（Cheng-en Cheng，CC BY-SA 2.0，車側百葉）、
 「TRA GEC Electric Locomotive E102 Kaohsiung Terminal.jpg」（Lexcie，CC BY-SA 3.0）。
 平頭、下半垂直、前窗往後倒、上緣圓角；白色上半、橘紅下半，車側橘紅裡一道白細帶（跟白色上半隔一條橘紅細線），白細帶在車角繞到正面、往中央下彎成 V 字；
 兩扇大圓角前窗、窗間柱上一塊黃色警示牌，頂端中央雙頭燈箱；下緣兩角圓燈、中央三個紅色軟管接頭；黃黑 V 字排障板。
 車側兩端各一扇駕駛室側門與側窗，中段三組百葉；車頂兩組受電弓。高度依斜正面照量：前窗 2.32–3.12、白色上半 2.12 以上、車角白細帶 1.85–2.04、V 字尖端 .95–1.15、下緣燈 1.02。"""
 L,W,H=s['L'],s['W'],s['H']
 color('e1white','F2EEE4',.06,.34,.26);color('e1red','E5532E',.05,.34,.30);color('e1roof','9EA0A2',.40,.45,.08)
 color('e1rubber','1A1E21',.20,.30,.30);color('e1fit','C0281E',.05,.34,.30)
 profile=[(.83,L/2-.02),(.95,L/2),(2.20,L/2),(2.30,L/2-.04),(3.10,L/2-.22),(3.22,L/2-.27),(H,L/2-.42)]
 s['bowPow']=4
 zones=[(1.85,'e1red'),(2.04,'e1white'),(2.12,'e1red'),(H-.14,'e1white'),(H+1,'e1roof')]
 f,neck=zoned_shell(s,profile,.10,zones,[(2.12,'e1red'),(H+1,'e1white')],nose_zones=zones,double=True);m=W/2-.004
 head=len(p.MODEL)
 # 白細帶繞到正面成 V 字：車角 1.85–2.04，往中央下彎到 .95–1.15
 c=lambda y:1.05+.895*(abs(y)/m)**.9
 front_patch('V 字白帶',f,-m,m,lambda y:c(y)-.095,lambda y:c(y)+.095,'e1white',.012,cols=48,rows=3)
 for sd in [-1,1]:
  a,b=sorted([sd*.28,sd*1.22]);lo,hi=pinch(lambda y:2.32,lambda y:3.12,.28,1.22,.12)
  front_patch('前窗黑框',f,a,b,lambda y:lo(abs(y)),lambda y:hi(abs(y)),'e1rubber',.030,cols=24,rows=8)
  a,b=sorted([sd*.32,sd*1.18]);lo,hi=pinch(lambda y:2.36,lambda y:3.08,.32,1.18,.09)
  front_patch('前窗玻璃',f,a,b,lambda y:lo(abs(y)),lambda y:hi(abs(y)),'glass',.036,cols=24,rows=8)
  front_panel('下緣燈圈',f,sd*1.12,1.02,.20,.20,'e1rubber',.10,.024);lamp('下緣標識燈',f,sd*1.12,1.02,.060,red=True)
 front_panel('高壓警示牌',f,0,2.92,.11,.19,'yellow',.01,.040)
 front_panel('車號牌',f,0,2.50,.42,.09,'frame',.02,.024);face_label(s['label'],f,0,2.50,.040,.05)
 for y in [-.52,-.22,.26]:
  front_panel('軟管接頭',f,y,1.66,.11,.15,'e1fit',.02,.030)
  line('制軔軟管',[(f(y,1.60)+.06,y,1.60),(f(y,1.20)+.12,y*.8,1.20),(f(y,.90)+.10,y*.6,.86)],.022,'rubber')
 # 頂端中央雙頭燈箱
 xf=f(0,3.30);use('03');box('頂部頭燈箱',(xf-.10,0,3.30),(.32,.78,.26),'e1white',.05)
 for y in [-.17,.17]:lamp('頂部頭燈',lambda yy,zz:xf-.015,y,3.30,.085)
 # 黃黑 V 字排障板、車鉤
 chevron_skirt(f(0,.83)+.05,W,.53,.56);coupler(f(0,.83)-.12,W,1,z=.62)
 # 駕駛室側門與側窗
 for sd in [-1,1]:
  cab_door(L/2-.98,sd,W/2,.50,1.00,3.00,(2.36,2.92),'e1rubber')
  sidewindow(L/2-.48,sd*(W/2+.018),2.66,.26,.60,r=.07)
 mirror_cab(list(p.MODEL[head:]))
 # 車側中段三組百葉（每組兩片）
 for sd in [-1,1]:
  for xc in [-1.55,0,1.55]:
   for dx in [-.20,.20]:louver('車側百葉',xc+dx,sd*(W/2+.004),2.66,.34,.64,9,'e1rubber','e1roof')
 # 車頂：兩組受電弓、母線與瓷瓶
 use('05')
 for x in [-1.95,1.95]:pantograph(x,H)
 box('車頂設備台',(0,0,H+.03),(2.2,1.30,.10),'e1roof',.03)
 for x in [-1.3,-.45,.45,1.3]:cyl('母線瓷瓶',(x,.60,H+.10),.045,.20,'cream',n=12)
 line('屋頂高壓母線',[(-1.6,.60,H+.21),(1.6,.60,H+.21)],.018,'metal')
 loco_bogies(L,W,2,.42)
 use('04');box('車下主風缸與電瓶箱',(0,0,.55),(2.0,W*.66,.42),'chassis',.04)
 return f

# S200（GM-EMD GL8，1960–61）：柴電機車，全長 12.2 m（維基資訊框 12,160 mm），車庫是 L 7.0。駕駛室在一端（+X，三片前窗），另一端是長機房端面。
add('s200','hood',L=7.0,W=2.75,H=3.40,axles=3,power='diesel',body='EE6A26',accent='F2EEDC',label='S200')

def side_band(name,x0,x1,zc,t,y,material,n=48):
 """平的車側（|y|=y）上一條沿 X 走、中心高度 zc(x) 的色帶，寬 t；左右各一條。"""
 use('01')
 for side in [-1,1]:
  v=[(x0+(x1-x0)*i/n,side*y,zc(x0+(x1-x0)*i/n)+d*t/2) for i in range(n+1) for d in (-1,1)]
  f=[(2*i,2*i+2,2*i+3,2*i+1) if side>0 else (2*i,2*i+1,2*i+3,2*i+2) for i in range(n)]
  mesh(name,v,f,material,0,True)

def s200(s):
 """S200 柴電機車（GM-EMD GL8 出口型）。參考：Commons「Taiwan Railways Type S200 ‘S210’ - 55325377169.jpg」（Alan Wilson，CC BY-SA 2.0，長機房端與車側）、
 「TRA S201 at Kaohsiung Station 20080708.jpg」（Joe Lewis，CC BY-SA 2.0，正側面）、「TRA S210 20100416.jpg」（QF2200DA，CC BY-SA 3.0）、「2025年的S200型柴電機車.jpg」（Mrmarkertw，CC BY 4.0）。
 做的是電氣化後的橘色塗裝：橘色車身、灰色車頂、黑色車架；駕駛室在一端、很短，正面三片前窗、頂端中央雙頭燈，白帶在車角繞到正面成 V 字；
 長機房幾乎跟駕駛室一樣寬（兩側窄走道、白色管扶手），車頂中段高起，白帶沿機房腰部走、到機房後段往下彎成下緣一條；長機房端面頂端雙頭燈、兩角圓形標識燈；
 兩端黃黑斜紋端梁很大。高度照 S210 側面照（139 px/m）換算：車架 .95–1.35、駕駛室頂 3.12、機房頂 3.20、中段高起 3.34、白帶 2.18–2.30（後段降到 1.40–1.52）。"""
 L,W,H=s['L'],s['W'],s['H'];hood_colours();color('s2roof','9EA3A6',.40,.42,.08)
 xe=L/2;xc0=xe-1.25;cw=W/2-.04;hw=W/2-.20;lab=s['label']
 use('01');box('黑色車架',(0,0,1.15),(L-.02,W-.04,.40),'hdframe',.02)
 loco_bogies(L,W,3,.36);use('04');box('燃油箱',(-.1,0,.66),(1.7,W*.70,.52),'hdframe',.06)
 head=len(p.MODEL);end_gear(xe,W,(.36,1.10));mirror_cab(list(p.MODEL[head:]))
 # 駕駛室（+X 端）與長機房；灰色車頂
 block('駕駛室',[(x,cw,1.35,z,.22) for x,z in rounded_ends(xc0,xe-.02,3.12,rf=.10)],'hdbody')
 block('駕駛室灰色車頂',[(x,cw+.012,2.98,z,.24) for x,z in rounded_ends(xc0-.01,xe-.01,3.14,rf=.11)],'s2roof')
 block('長機房',[(x,hw,1.35,z,.16) for x,z in rounded_ends(-xe+.08,xc0+.02,3.20,rb=.12)],'hdbody')
 block('長機房灰色車頂',[(x,hw+.012,3.08,z,.18) for x,z in rounded_ends(-xe+.07,xc0+.02,3.22,rb=.13)],'s2roof')
 block('車頂中段高起',[(x,hw-.18,3.15,z,.12) for x,z in rounded_ends(-1.7,1.0,3.34,rf=.08,rb=.08)],'s2roof')
 # 白帶：駕駛室側面接機房腰部，機房後段往下彎到下緣，再直走到端面
 def zc(x):
  if x>-.6:return 2.24
  if x<-1.9:return 1.46
  u=(x+1.9)/1.3;return 1.46+.78*(3*u*u-2*u*u*u)
 side_band('白色腰帶',-xe+.10,xc0,zc,.12,hw+.004,'hdwhite',64);side_band('白色腰帶',xc0,xe-.03,lambda x:2.24,.12,cw+.004,'hdwhite',8)
 # 駕駛室正面：三片前窗、頂端雙頭燈、V 字白帶、車號
 fc=lambda y,z:xe-.02
 for y,w in [(-.80,.62),(0,.50),(.80,.62)]:
  front_panel('前窗窗框',fc,y,2.64,w+.06,.66,'hdblack',.05,.022);front_panel('前窗玻璃',fc,y,2.64,w,.60,'glass',.04,.032)
 front_panel('頭燈燈座',fc,0,3.04,.40,.15,'hdbody',.06,.02)
 for y in [-.10,.10]:lamp('頭燈',fc,y,3.04,.060)
 wing('白色 V 字飛翼',fc,cw-.02,2.18,2.30,1.52);face_label(lab,fc,0,2.03,.030,.085)
 for sd in [-1,1]:lamp('端面標識燈',fc,sd*1.05,1.62,.050,red=True)
 # 長機房端面（−X）：頂端雙頭燈座、兩角圓形標識燈、車號；先建在 +X 再轉到後端
 head=len(p.MODEL);fh=lambda y,z:xe-.08
 use('03');box('端面頭燈座',(xe-.14,0,2.98),(.24,.52,.22),'hdbody',.05)
 for y in [-.12,.12]:lamp('頭燈',lambda yy,zz:xe-.115,y,2.98,.060)
 for sd in [-1,1]:cyl('端面標識燈座',(xe-.04,sd*(hw-.18),3.02),.08,.10,'hdbody','X',20);lamp('端面標識燈',lambda yy,zz:xe-.085,sd*(hw-.18),3.02,.045,red=True)
 front_panel('端面白帶',fh,0,1.46,2*hw-.02,.12,'hdwhite',.01,.012);face_label(lab,fh,.55,2.75,.020,.085)
 to_rear(list(p.MODEL[head:]))
 # 側面：駕駛室兩片側窗、機房前段百葉、後段大散熱格柵、檢修門門縫
 for side in [-1,1]:
  use('02');y=side*(cw+.012)
  for x,w in [(xe-.30,.30),(xe-.78,.44)]:panel('駕駛室側窗窗框',(x,y,2.64),w+.06,.64,'hdblack',r=.05);panel('駕駛室側窗玻璃',(x,y+side*.012,2.64),w,.58,'glass',r=.04,depth=.012)
  for x in [xc0-.45,xc0-.80]:louver('機房百葉',x,side*(hw+.010),2.62,.26,.62,8)
  bar_grille('長機房散熱格柵',-xe+1.25,side*(hw+.010),2.40,.62,1.30,12)
  for x in [-.20,-1.00,.60]:box('檢修門門縫',(x,side*(hw+.012),2.25),(.014,.010,1.50),'hdblack',0)
 # 車頂：排氣管、氣笛
 use('05');cyl('排氣管',(-.30,0,3.40),.08,.18,'hdblack')
 for y in [-.15,.15]:cyl('氣笛',(xc0-.10,y,3.24),.040,.24,'hdblack','X',16)
 # 走道扶手（白色管扶手）
 use('07');yo=W/2-.06
 for sd in [-1,1]:
  y=sd*yo;line('走道扶手',[(xc0-.05,y,1.35),(xc0-.05,y,2.22),(-xe+.10,y,2.22),(-xe+.10,y,1.35)],.020,'hdrail')
  for x in [-.40,-1.30,-2.20]:rod('扶手立柱',(x,y,1.35),(x,y,2.22),.016,'hdrail')
 return fc

# ── 762 mm 軌距的蒸機與客車（寬 2.15 照林鐵）：阿里山林鐵 Shay 31 號、台糖 346 號與五分車觀光客車 ──────────────
from tw_classic import ct_plate,ct_bar,ct_wheel,ty_lathe,ty_xplate
from tw_steam import st_colours,st_door,st_plate_front,st_plate_side,st_lamp

def plate_white_text():
 """車號字改白色（Shay 31 的紅底圓牌與駕駛室側牌是白字；st_colours 預設金字）。"""
 m=p.M['identity'];rgb=[p.linear(int('EEEAE0'[i:i+2],16)/255) for i in (0,2,4)]
 m.diffuse_color=(*rgb,1);m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(*rgb,1)

def pocket_beam(end,W,fp,hose=True):
 """林鐵、糖鐵小型機車的鉚接大端梁：兩排鉚釘、中央口袋式連結器（開口、連結銷）、下方踏板；hose 時右前方紅考克加黑色軟管。"""
 xe=end*3.17;use('07');box('鉚接大端梁',(xe,0,.84),(.24,W,.56),'stblack',.01)
 for z in [.66,1.02]:
  for k in range(9):cyl('端梁鉚釘',(xe+end*.122,-.92+k*.23,z),.022,.02,'stblack','X',8,0)
 for sd in [-1,1]:
  for z in [.75,.93]:cyl('端梁鉚釘',(xe+end*.122,sd*.32,z),.022,.02,'stblack','X',8,0)
 box('端梁下踏板',(xe+end*.04,0,.53),(.34,W-.12,.04),'stblack',0)
 box('口袋式連結器',(xe+end*.19,0,.68),(.14,.40,.24),'stblack',.01);box('連結器開口',(xe+end*.262,0,.68),(.01,.22,.09),'stvoid',0)
 cyl('連結銷',(xe+end*.19,0,.86),.025,.12,'metal','Z',8,0)
 for k in range(4):torus_y('安全鏈',(xe+end*.14,end*-.30,.86-k*.055),.028,.008,'metal',n=10,m=4)
 if hose:
  box('制軔管紅考克',(xe+end*.14,end*.36,.95),(.06,.08,.10),'strod',0)
  line('制軔軟管',[(xe+end*.16,end*.36,.90),(xe+end*.24,end*.40,.72),(xe+end*.20,end*.44,.58)],.025,'rubber')

# Shay 31（美國 Lima 1910 年代製造；28 噸 B 型）：三支直立汽缸在右側（−Y）經曲軸、萬向接頭與傳動軸帶動兩台轉向架，每個右側車輪外面一圈傘齒輪；
# 鍋爐往左（+Y）偏，平衡右邊的引擎。車庫是 L 6.6、W 2.15、H 3.05（煙囪頂），跟林鐵柴油機車同一個尺度。
add('shay31','steam',L=6.6,W=2.15,H=3.05,drivers=0,driverRadius=.32,leading=0,trailing=0,tank=True,axles=2,body='101314',accent='C22A26',power='steam',label='31')

def shay31(s):
 """阿里山林鐵 Shay 31 號（動態保存）。參考：Commons「Components diagram of a 28-ton Class B Shay steam locomotive of the Alishan Forest Railway」（右側正側面＋零件名稱：
 總風缸、預熱器、砂箱、汽包室、汽笛、空壓機、曲軸、萬向接頭、伸縮方型軸、斜齒輪）、「AFR 31 Alishan 2023-07-18 01.jpg」（Industrial Wales，CC BY-SA 2.0，右側斜前方）、
 「AFR 31 working Alishan 04.jpg」（Industrial Wales，CC BY-SA 2.0，正面：鍋爐偏左、煙箱圓牌、端梁）、「AFR Shay 31 01.jpg」（Juen，CC BY 2.0）、「AFR Shay 31 02.jpg」（Sherry Kang，CC BY 2.0）。
 全黑；煙箱門中央紅底白圈「31」圓牌、煙箱頂黃色頭燈；上寬下窄的斜筒形煙囪、後面橫放的預熱器（圓筒兩端朝左右）、砂箱與汽包室兩個高圓頂；
 右側：總風缸橫躺在鍋爐旁從煙箱前緣到空壓機、黃銅空壓機在總風缸後端下面、三支直立汽缸在駕駛室前，連桿往下接到車軸高度的曲軸，
 曲軸兩端經萬向接頭與伸縮方型軸帶動前後轉向架，每個右側車輪外一圈斜齒輪；駕駛室側面四格大窗與紅色大車號牌；後面高水櫃；前後鉚接大端梁、口袋式連結器、紅色制軔考克。
 高度照零件圖量（軌面到駕駛室頂 3.05 線性換算）：步道 1.10、圓頂頂 2.85、煙囪頂 2.93、總風缸中心 1.50；駕駛室 2023 年照片是淡橄欖色、運轉中與零件圖是黑色，取黑色。"""
 W=s['W'];st_colours();plate_white_text();color('shbrass','C9A040',.80,.32,.15);color('shcopper','B5703E',.80,.35,.12)
 fp=1.10;R=.32;yo=.22;bz=1.76;ys=-.82;zc=.38
 trucks=[(1.95,[1.50,2.40]),(-2.15,[-2.60,-1.70])]
 # 主車架、步道（引擎那段右側讓出來）、前後鉚接大端梁
 use('01');box('主車架',(0,0,fp-.20),(6.10,1.30,.30),'stblack',.01)
 box('前段步道',(2.03,0,fp-.03),(2.05,W,.06),'stblack',.005);box('引擎段步道',(.28,.23,fp-.03),(1.46,W-.46,.06),'stblack',.005)
 for side in [-1,1]:box('步道側緣',(2.03,side*(W/2-.02),fp-.10),(2.05,.04,.12),'stblack',0)
 for end in [1,-1]:pocket_beam(end,W,fp)
 # 轉向架：+Y 側拱桿側架與軸箱；−Y 側每個車輪外一圈斜齒輪、小齒輪接在傳動軸上
 for c,xs in trucks:
  use('04');box('轉向架枕梁',(c,0,.66),(.30,1.50,.14),'stblack',.01)
  for x in xs:
   cyl('輪軸',(x,0,R),.05,1.20,'stblack','Y',12,0)
   for side in [-1,1]:
    o=cyl('齒輪轉向架車輪',(x,side*.60,R),R,.12,'stblack','Y',32,.006);o['wheel_center']=True;o['radius']=R
    torus_y('輪緣',(x,side*.53,R),R*.94,.02,'stblack',n=32,m=4)
   cyl('輪轂',(x,.67,R),.08,.04,'metal','Y',16,0);box('軸箱',(x,.76,R),(.18,.12,.22),'stblack',.01)
   cyl('斜齒輪',(x,-.695,R),.27,.05,'stblack','Y',40,.004)
   for k in range(24):
    a=2*math.pi*k/24;box('斜齒輪齒',(x+.235*math.cos(a),-.735,R+.235*math.sin(a)),(.04,.03,.04),'stblack',0)
   cyl('小齒輪',(x-.22,ys,R),.075,.10,'metal','X',16,.004)
   box('右側軸箱',(x,-.80,R+.36),(.22,.14,.18),'stblack',.01)
  a,b=xs[0],xs[1]
  for z0,z1 in [(R+.12,R+.30),(R-.12,R-.12)]:
   ct_bar('拱桿側架',(a-.14,z0),(c-.22,z1),.05,.05,.80,'stblack');ct_bar('拱桿側架',(c-.22,z1),(c+.22,z1),.05,.05,.80,'stblack');ct_bar('拱桿側架',(c+.22,z1),(b+.14,z0),.05,.05,.80,'stblack')
  box('右側架上桿',(c,-.80,.76),(b-a+.40,.05,.05),'stblack',0)
  rod('伸縮方型軸',(a-.36,ys,R),(b+.06,ys,R),.035,'metal')
 # 引擎：三支直立汽缸（曲柄差 120 度）、滑板與十字頭、長連桿往下接車軸高度的曲軸；曲軸箱、外側汽門箱；曲軸兩端萬向接頭
 ye=-.84;cxs=[-.28,.12,.52]
 ct_plate('引擎支架',[(-.45,.50),(.75,.50),(.75,2.06),(-.45,2.06)],-.62,-.67,'stblack')
 use('04');box('曲軸箱',(.12,ye,.66),(1.24,.18,.30),'stblack',.01)
 for x in cxs:box('曲軸軸承座',(x-.20,ye,.48),(.10,.20,.30),'stblack',.005)
 for i,x in enumerate(cxs):
  cyl('直立汽缸',(x,ye,1.78),.15,.46,'stblack','Z',24,.01)
  cyl('汽缸上蓋',(x,ye,2.03),.165,.04,'stblack','Z',24,.004);cyl('汽缸下蓋',(x,ye,1.535),.165,.03,'stblack','Z',24,0)
  rod('活塞桿',(x,ye,1.52),(x,ye,1.30),.025,'metal')
  for dx in [-.07,.07]:rod('滑板',(x+dx,ye,1.10),(x+dx,ye,1.46),.018,'metal')
  box('十字頭',(x,ye,1.28),(.16,.08,.08),'metal',0)
  th=2*math.pi*i/3;pz=.10*math.sin(th)
  cyl('曲柄盤',(x,ye-.05,zc),.13,.05,'stblack','X',20,0);rod('連桿',(x,ye-.06,1.28),(x+.03*math.cos(th),ye-.06,zc+pz),.035,'metal')
 for x in cxs:box('汽門箱',(x,-1.00,1.78),(.32,.10,.34),'stblack',.01)
 for x in cxs:line('汽缸銅管',[(x+.10,-1.05,1.70),(x+.12,-1.06,1.30),(x+.15,-1.02,.95)],.012,'shcopper')
 rod('曲軸',(-.62,ye,zc),(1.00,ye,zc),.045,'metal')
 for a,b in [((1.00,ye,zc),(1.14,ys,R)),((-.62,ye,zc),(-1.34,ys,R))]:
  rod('萬向接頭軸',a,b,.035,'metal');box('萬向接頭',a,(.10,.10,.10),'stblack',.01);box('萬向接頭',b,(.10,.10,.10),'stblack',.01)
 # 鍋爐組（先建在中線、最後整組往 +Y 偏 yo）：煙箱、煙箱門與紅底白圈車號圓牌、鍋爐與箍帶、斜筒形煙囪、預熱器、砂箱與汽包室、汽笛、黃色頭燈、扶手與拉桿
 head=len(p.MODEL)
 use('01');box('煙箱鞍座',(2.40,0,fp+.12),(.60,.70,.26),'stblack',0)
 cyl('煙箱',(2.39,0,bz),.53,.88,'stblack','X',48,0);st_door(2.83,bz,.53,wheel=False)
 use('03');cyl('車號圓牌白圈',(2.902,0,bz),.20,.02,'white','X',40,0);cyl('車號圓牌',(2.914,0,bz),.165,.02,'stplate','X',40,0)
 text_label('31',(2.928,0,bz),.17)
 use('01');cyl('圓筒鍋爐',(.745,0,bz),.50,2.41,'stblack','X',48,0)
 for x in [.10,.95,1.70]:cyl('鍋爐箍帶',(x,0,bz),.508,.03,'stblack','X',48,0)
 use('05');xc=2.34
 ty_lathe('斜筒形煙囪',xc,0,[(.27,bz+.44),(.20,bz+.54),(.19,bz+.64),(.235,2.86),(.27,2.88),(.27,2.93),(.21,2.93),(.21,bz+.44)],'stblack',32,(0,4,5,6,7))
 cyl('預熱器',(1.82,-.05,bz+.68),.20,.96,'stblack','Y',28,.01)
 for y in [-.53,.43]:
  cyl('預熱器端蓋',(1.82,y,bz+.68),.17,.05,'stblack','Y',28,.006);cyl('端蓋中心',(1.82,y+(-.04 if y<0 else .04),bz+.68),.08,.05,'stblack','Y',20,.006)
 box('預熱器座',(1.82,-.05,bz+.50),(.26,.44,.14),'stblack',0)
 for x,top,name in [(.55,2.84,'汽包室'),(1.20,2.86,'砂箱')]:
  ty_lathe(name,x,0,[(.25,bz+.42),(.25,top-.22),(.22,top-.12),(.15,top-.04),(0,top),(0,bz+.42)],'stblack',32,(0,))
 cyl('安全閥',(.55,.14,2.88),.035,.08,'shbrass','Z',12,0)
 cyl('汽笛',(.20,0,2.50),.04,.30,'shbrass','Z',12,0);cyl('汽笛座',(.20,0,2.30),.06,.10,'stblack','Z',12,0)
 st_lamp(2.86,bz+.71)
 line('拉桿',[(-.45,-.30,2.42),(1.05,-.30,2.42)],.014,'metal')
 for side in [-1,1]:
  line('鍋爐扶手',[(.10,side*.58,2.08),(2.30,side*.58,2.08)],.014,'metal')
  for x in [.40,1.10,1.90]:rod('扶手支架',(x,side*.46,2.08),(x,side*.58,2.08),.010,'metal')
 bpy.context.view_layer.update()
 for o in p.MODEL[head:]:o.location.y+=yo
 # 右側總風缸（端蓋、束帶）、黃銅空壓機（下段散熱管）、主蒸汽管與排汽管、銅管
 use('01');cyl('總風缸',(2.00,-.78,1.50),.26,1.66,'stblack','X',32,.01)
 for x in [1.17,2.83]:cyl('總風缸端蓋',(x,-.78,1.50),.23,.04,'stblack','X',28,.006)
 for x in [1.50,2.50]:cyl('總風缸束帶',(x,-.78,1.50),.27,.04,'stblack','X',32,0)
 use('05');cyl('空壓機',(.98,-.86,1.30),.11,.62,'shbrass','Z',20,.006);cyl('空壓機頂蓋',(.98,-.86,1.63),.12,.04,'stblack','Z',20,0)
 for z in [1.14,1.46]:cyl('空壓機銅箍',(.98,-.86,z),.118,.03,'shcopper','Z',20,0)
 for k in range(5):cyl('空壓機散熱管',(.98,-.86,.80+k*.05),.12,.018,'metal','Z',20,0)
 line('主蒸汽管',[(.55,-.03,2.40),(.40,-.30,2.30),(.14,-.62,2.18),(.12,-.84,2.07)],.035,'stblack')
 line('排汽管',[(.52,-.84,2.07),(.78,-.62,2.20),(1.20,-.42,2.18),(2.10,-.40,2.12),(2.20,-.30,2.02)],.05,'stblack')
 line('總風缸送氣管',[(1.17,-.78,1.40),(1.05,-.86,1.50),(.98,-.86,1.65)],.03,'stblack')
 for z in [1.80,1.86]:line('銅管',[(1.10,-.56,z),(2.70,-.56,z),(2.78,-.62,z-.20)],.014,'shcopper')
 # 駕駛室：側面四格大窗、紅色大車號牌；前牆兩扇窗在鍋爐兩邊、後牆兩扇窗；弧頂出簷、頂上通風窗；後面高水櫃、後端燈與梯子
 xcr,xcf,ze=-1.85,-.45,2.78;wz0,wz1=2.14,2.70
 use('01');box('駕駛室內部',((xcr+xcf)/2,0,(fp+ze)/2),(xcf-xcr-.08,1.98,ze-fp-.04),'stvoid',0)
 for side in [-1,1]:
  y0,y1=side*1.01,side*1.05
  ct_plate('駕駛室側牆下段',[(xcr,fp),(xcf,fp),(xcf,wz0),(xcr,wz0)],y0,y1,'stblack');ct_plate('駕駛室側牆上段',[(xcr,wz1),(xcf,wz1),(xcf,ze),(xcr,ze)],y0,y1,'stblack')
  for a,b in [(xcf-.14,xcf),(-1.20,-1.10),(xcr,xcr+.14)]:ct_plate('窗柱',[(a,wz0),(b,wz0),(b,wz1),(a,wz1)],y0,y1,'stblack')
  use('02')
  for a,b in [(-1.10,xcf-.14),(xcr+.14,-1.20)]:
   panel('側窗玻璃',((a+b)/2,side*1.03,(wz0+wz1)/2),b-a,wz1-wz0,'glass',r=.01,depth=.01)
   rod('窗櫺',((a+b)/2,side*1.042,wz0),((a+b)/2,side*1.042,wz1),.014,'stblack',6);rod('窗櫺',(a,side*1.042,2.44),(b,side*1.042,2.44),.014,'stblack',6)
  panel('駕駛室側車號牌',(-1.48,side*1.055,1.72),.30,.22,'stplate',r=.012,depth=.012);text_label('31',(-1.48,side*1.068,1.72),.15,'side',side)
  use('07')
  for z in [.62,.88]:box('駕駛室踏階',(-1.95,side*.98,z),(.26,.18,.03),'stblack',0)
  rod('踏階吊架',(-2.05,side*1.06,.60),(-2.05,side*1.06,fp-.05),.014,'stblack');rod('上車扶手',(xcr-.03,side*1.07,1.20),(xcr-.03,side*1.07,2.40),.015,'metal')
 roofz=lambda y:ze+.20*(1-(y/1.10)**2)
 wall=[(-1.05,fp),(1.05,fp)]+[(1.05-2.10*i/12,roofz(1.05-2.10*i/12)) for i in range(13)]
 ty_xplate('駕駛室前牆',wall,xcf-.04,xcf,'stblack');ty_xplate('駕駛室後牆',wall,xcr,xcr+.04,'stblack')
 k=14;top=[(-1.14+2.28*i/k,ze+.03+.20*(1-(-1+2*i/k)**2)) for i in range(k+1)]
 ty_xplate('駕駛室弧頂',top+[(y,z-.04) for y,z in reversed(top)],xcr-.10,xcf+.10,'stblack',True,{0,k,k+1,2*k+1})
 use('05');box('車頂通風窗',(-1.15,0,ze+.25),(.80,.60,.08),'stblack',.02)
 use('02')
 for sd in [-1,1]:
  panel('前牆窗框',(xcf+.004,sd*.76,2.48),.32,.40,'frame','front',r=.04);panel('前牆窗玻璃',(xcf+.01,sd*.76,2.48),.26,.34,'glass','front',r=.03,depth=.010)
  panel('後牆窗框',(xcr-.004,sd*.55,2.40),.40,.42,'frame','front',r=.04);panel('後牆窗玻璃',(xcr-.01,sd*.55,2.40),.34,.36,'glass','front',r=.03,depth=.010)
 use('01');box('後水櫃',(-2.47,0,(fp+2.55)/2),(1.14,2.02,2.55-fp),'stblack',.06)
 cyl('水櫃注水口',(-2.70,0,2.58),.13,.08,'stblack','Z',20,.004)
 use('03');box('後端燈殼',(-3.07,0,2.30),(.14,.26,.24),'stblack',.01);cyl('後端燈鏡片',(-3.145,0,2.30),.08,.02,'stlens','X',24,0)
 use('07')
 for y in [-.30,.30]:rod('後梯',(-3.06,y,1.15),(-3.06,y,2.20),.016,'metal')
 for z in [1.35,1.60,1.85,2.10]:rod('後梯橫檔',(-3.06,-.30,z),(-3.06,.30,z),.012,'metal')

# 346（比利時 AFB，1948 年）：側水櫃小型蒸機，三軸動輪，駕駛室後面有煤櫃；車庫是 L 5.6、高 2.95（煙囪火星網罩頂）。
add('tsc346','steam',L=5.6,W=2.15,H=2.95,drivers=3,driverRadius=.34,leading=0,trailing=0,tank=True,body='1C2022',accent='C42420',power='steam',label='346')

def tsc346(s):
 """台糖 346 號蒸汽機車（溪湖糖廠動態保存）。參考：Commons「Steam locomotive 346 of Taiwan Sugar Corporation 2020-03-29.jpg」（Industrial Wales，CC BY-SA 2.0，斜前方）、
 「Taisugar No. 346 steam locomotive 2023-07-18.jpg」（Industrial Wales，CC BY-SA 2.0，後端與駕駛室）、「Taisugar 346 Steam Locomotive at Xihu Sugar Factory 20100129.jpg」（Takara19，CC BY 3.0，正面）、
 「Xihu sugar train.JPG」（Greg Longman，CC BY-SA 3.0，拉客車）。
 黑色車身、紅色車架與前後緩衝梁（中央緩衝連結器）；煙箱門上紅底車號牌，煙囪頂上方形火星網罩，煙箱頂右側大圓頭燈加遮簷；鍋爐上兩個圓頂（汽包、砂箱）；
 兩側長水櫃從駕駛室前牆一路到煙箱後；駕駛室前段側面一扇圓角窗、中段開放出入口（紅色扶手）、後牆兩扇有護條的窗；後面矮一截的煤櫃；三軸黑色輻條動輪、外側汽缸。"""
 W=s['W'];st_colours();color('tyred','C42420',.05,.40,.20);color('tymesh','3A3F42',.40,.55,.05)
 fp=.98;bz=1.48;R=.34;xs=[.95,.20,-.55]
 # 步道、紅色主車架、前後紅色緩衝梁與中央緩衝連結器
 use('01');box('步道板',(0,0,fp-.04),(5.06,W-.05,.08),'stblack',.01)
 for side in [-1,1]:
  box('步道側緣',(0,side*(W/2-.045),fp-.12),(5.06,.04,.10),'stblack',0)
  ct_plate('紅色主車架',[(-2.40,.30),(2.40,.30),(2.40,fp-.08),(-2.40,fp-.08)],side*.40,side*.47,'tyred')
 for end in [-1,1]:
  use('01');box('紅色緩衝梁',(end*2.56,0,.54),(.14,W-.02,.80),'tyred',.01)
  for z in [.24,.60,.84]:
   for k in range(8):cyl('緩衝梁鉚釘',(end*2.635,-.84+k*.24,z),.016,.014,'tyred','X',8,0)
  use('07');box('中央緩衝器座',(end*2.67,0,.46),(.10,.42,.24),'stblack',.01);box('中央緩衝器頭',(end*2.76,0,.46),(.12,.30,.18),'stblack',.01)
  box('連結銷',(end*2.79,0,.57),(.05,.05,.12),'metal',0)
 # 三軸輻條動輪、外側汽缸、十字頭、主連桿與連結桿（左右曲柄差 90 度）
 for x in xs:
  for side in [-1,1]:ct_wheel(x,side*.70,R,10,white=False)
  use('04');cyl('輪軸',(x,0,R),.06,1.30,'stblack','Y',12,0)
 for side in [-1,1]:
  y=side*.88;th=math.radians(-40 if side<0 else 50);px,pz=.17*math.cos(th),.17*math.sin(th)
  use('04');cyl('汽缸',(1.86,y,.68),.18,.60,'stblack','X',24,.01);cyl('汽缸前蓋',(2.17,y,.68),.15,.03,'metal','X',24,0)
  box('汽門箱',(1.86,y,.95),(.50,.26,.24),'stblack',.01)
  for x in xs:cyl('曲柄銷',(x+px,side*.85,R+pz),.045,.10,'metal','Y',12,0)
  ct_bar('連結桿',(xs[0]+px,R+pz),(xs[-1]+px,R+pz),.075,.04,side*.90,'metal')
  box('十字頭',(1.40,side*.93,.68),(.18,.10,.16),'metal',0);rod('活塞桿',(1.48,side*.93,.68),(1.56,side*.90,.68),.03,'metal',8)
  for z in [.77,.59]:ct_bar('滑板',(1.30,z),(1.56,z),.035,.06,side*.93,'metal')
  ct_bar('主連桿',(1.40,.68),(xs[1]+px,R+pz),.085,.04,side*.97,'metal')
 # 煙箱、煙箱門與車號牌、鍋爐與箍帶
 use('01');box('煙箱鞍座',(1.95,0,fp+.12),(.62,.72,.26),'stblack',0)
 cyl('煙箱',(1.97,0,bz),.47,.70,'stblack','X',48,0);st_door(2.33,bz,.47,wheel=False)
 st_plate_front(2.395,bz+.22,.34,.14,'346',.085)
 use('01');cyl('圓筒鍋爐',(.84,0,bz),.43,1.62,'stblack','X',48,0)
 for x in [.30,1.10]:cyl('鍋爐箍帶',(x,0,bz),.438,.03,'stblack','X',48,0)
 # 煙囪＋方形火星網罩
 use('05');xc=2.02
 ty_lathe('煙囪',xc,0,[(.25,bz+.38),(.21,bz+.48),(.16,bz+.60),(.145,2.42),(.17,2.45),(.17,2.50),(.10,2.50),(.10,bz+.38)],'stblack',32,(0,4,5,6,7))
 box('火星網罩底框',(xc,0,2.52),(.40,.40,.05),'stblack',.005);box('火星網罩頂蓋',(xc,0,2.92),(.42,.42,.05),'stblack',.008)
 for dy in [-.18,.18]:
  for dx in [-.18,.18]:box('火星網罩角柱',(xc+dx,dy,2.72),(.035,.035,.38),'stblack',0)
 for sg in [-1,1]:
  box('火星網罩網面',(xc+sg*.175,0,2.72),(.012,.33,.35),'tymesh',0);box('火星網罩網面',(xc,sg*.175,2.72),(.33,.012,.35),'tymesh',0)
 # 煙箱頂右側大圓頭燈（遮簷）、鍋爐上兩個圓頂、安全閥、汽笛
 use('03');yl=-.30;zl=bz+.62
 box('頭燈座',(2.10,yl,zl-.16),(.18,.16,.10),'stblack',0);cyl('頭燈燈殼',(2.10,yl,zl),.15,.26,'stblack','X',28,.006)
 box('頭燈遮簷',(2.18,yl,zl+.17),(.20,.30,.025),'stblack',0);lamp('煙箱頭燈',lambda y,z:2.165,yl,zl,.115)
 use('05')
 for x,top,r,name in [(1.18,2.50,.25,'汽包'),(.45,2.35,.20,'砂箱')]:
  ty_lathe(name,x,0,[(r,bz+.36),(r,top-.12),(r*.86,top-.05),(r*.5,top-.006),(0,top),(0,bz+.36)],'stblack',32,(0,))
 cyl('安全閥',(.80,0,2.05),.035,.10,'metal','Z',12,0);cyl('汽笛',(.10,0,2.05),.035,.22,'metal','Z',12,0)
 # 兩側水櫃（前上角圓角）、側面車號牌
 xt0,xt1,zt=-.05,1.40,1.74
 tank=[(xt0,fp),(xt1,fp),(xt1,zt-.14)]+[(xt1-.14+.14*math.cos(math.pi/2*i/6),zt-.14+.14*math.sin(math.pi/2*i/6)) for i in range(1,7)]+[(xt0,zt)]
 for side in [-1,1]:
  use('01');ct_plate('側水櫃',tank,side*.54,side*1.02,'stblack');cyl('水櫃注水口',(xt1-.30,side*.80,zt+.015),.08,.03,'stblack','Z',20,0)
  st_plate_side(.18,side*1.022,1.42,.30,.14,'346',.07)
 # 駕駛室：前段圓角側窗、中段開放出入口（紅扶手）、後牆兩扇護條窗；弧頂前後出簷；裡面暗色
 xcr,xcf,xd0,xd1,ze=-1.45,-.05,-1.05,-.62,2.30
 use('01');box('駕駛室內部',((xcr+xcf)/2,0,(fp+ze)/2),(xcf-xcr-.08,1.96,ze-fp-.04),'stvoid',0)
 for side in [-1,1]:
  y0,y1=side*1.01,side*1.05
  ct_plate('駕駛室側牆前段',[(xd1,zt),(xcf,zt),(xcf,ze),(xd1,ze)],y0,y1,'stblack');ct_plate('駕駛室側牆後段',[(xcr,fp),(xd0,fp),(xd0,ze),(xcr,ze)],y0,y1,'stblack')
  ct_plate('出入口上楣',[(xd0,2.12),(xd1,2.12),(xd1,ze),(xd0,ze)],y0,y1,'stblack')
  use('02');panel('側窗窗框',(-.34,side*1.052,2.02),.36,.40,'frame',r=.08);panel('側窗玻璃',(-.34,side*1.058,2.02),.30,.34,'glass',r=.06,depth=.010)
  use('05')
  for x in [xd0+.05,xd1-.05]:rod('出入口紅扶手',(x,side*1.08,1.10),(x,side*1.08,2.05),.016,'tyred')
  use('07')
  for z in [.44,.72]:box('駕駛室踏階',((xd0+xd1)/2,side*.98,z),(.30,.18,.03),'stblack',0)
 roofz=lambda y:ze+.12*(1-(y/1.10)**2)
 wall=[(-1.05,fp),(1.05,fp)]+[(1.05-2.10*i/12,roofz(1.05-2.10*i/12)) for i in range(13)]
 ty_xplate('駕駛室前牆',wall,xcf-.04,xcf,'stblack');ty_xplate('駕駛室後牆',wall,xcr,xcr+.04,'stblack')
 k=14;top=[(-1.12+2.24*i/k,ze+.03+.12*(1-(-1+2*i/k)**2)) for i in range(k+1)]
 ty_xplate('駕駛室弧頂',top+[(y,z-.04) for y,z in reversed(top)],xcr-.10,xcf+.08,'stblack',True,{0,k,k+1,2*k+1})
 use('02')
 for sd in [-1,1]:
  panel('前牆圓角窗框',(xcf+.004,sd*.66,2.04),.40,.36,'frame','front',r=.10);panel('前牆圓角窗',(xcf+.01,sd*.66,2.04),.34,.30,'glass','front',r=.08,depth=.010)
  panel('後牆窗框',(xcr-.004,sd*.50,2.02),.40,.38,'frame','front',r=.08);panel('後牆窗',(xcr-.01,sd*.50,2.02),.34,.32,'glass','front',r=.06,depth=.010)
  for k2 in range(4):rod('後窗護條',(xcr-.03,sd*.50-.12+k2*.08,1.87),(xcr-.03,sd*.50-.12+k2*.08,2.17),.010,'stblack',6)
 # 煤櫃與後端紅色車號牌、後端燈
 use('01');box('煤櫃',(-1.96,0,(fp+1.74)/2),(.98,1.96,1.74-fp),'stblack',.02);box('煤堆',(-1.90,0,1.79),(.80,1.70,.10),'stcoal',.03)
 use('03');panel('後端車號牌',(-2.455,0,1.55),.34,.14,'tyred','front',r=.01,depth=.012)
 for sd in [-1,1]:cyl('後端燈鏡片',(-2.47,sd*.80,1.10),.06,.05,'stlens','X',20,0)

# 五分車觀光客車（溪湖糖廠，346 號拉的黑色密閉客車）：L 5.2、W 2.0、H 2.45（照片上車頂約跟 346 駕駛室頂齊），兩軸小轉向架。
add('wufen','forestcoach',L=5.2,W=2.0,H=2.45,axles=2,power='unpowered',body='1E2124',accent='F2EEDC',label='五分車')

def small_trucks(L,W,centers,r,gauge=.55,pitch=.80,frame='wfframe'):
 """糖鐵、林鐵小客車的兩軸轉向架：車輪、輪軸、側架與軸箱、枕梁。"""
 use('04')
 for c in centers:
  for x in [c-pitch/2,c+pitch/2]:
   cyl('輪軸',(x,0,r),.045,2*gauge,'stblack','Y',12,0)
   for side in [-1,1]:
    o=cyl('小車輪',(x,side*gauge,r),r,.10,'stblack','Y',28,.005);o['wheel_center']=True;o['radius']=r
    torus_y('輪緣',(x,side*(gauge-.06),r),r*.94,.018,'stblack',n=28,m=4)
    box('軸箱',(x,side*(gauge+.12),r),(.16,.10,.18),frame,.01)
  for side in [-1,1]:box('轉向架側架',(c,side*(gauge+.12),r+.06),(pitch+.30,.06,.10),frame,.01)
  box('轉向架枕梁',(c,0,r+.24),(.26,2*gauge+.30,.12),frame,.01)

def wufen(s):
 """五分車觀光客車（台糖溪湖糖廠，346 號牽引的黑色密閉客車）。參考：Commons「Xihu sugar train.JPG」（Greg Longman，CC BY-SA 3.0）、
 「A Tourist Train in Xihu Sugar Factory.jpg」（Tbatb，CC BY-SA 4.0，後段彩繪敞篷車不做）。
 黑色方正車身、淺弧車頂，每側一排七扇窗，窗下一條白細線；兩端各一扇端門與端窗、小平台扶手；兩軸小轉向架、中央緩衝連結器；端梁兩角紅色小尾燈（客車不放頭燈）。"""
 L,W,H=s['L'],s['W'],s['H'];st_colours()
 color('wfblack','181C22',.20,.45,.10);color('wfroof','24272B',.10,.60,.04);color('wfframe','15181A',.30,.45,.08)
 x1=L/2-.28;zb,ze=.70,2.15
 block('客車車身',[(-x1,W/2,zb,ze,.04),(x1,W/2,zb,ze,.04)],'wfblack')
 use('01');box('底架',(0,0,zb-.06),(2*x1+.10,W-.20,.14),'wfframe',.01)
 hw=W/2+.06;roofz=lambda y:ze+.26*(1-(y/hw)**2)
 k=16;top=[(-hw+2*hw*i/k,roofz(-hw+2*hw*i/k)) for i in range(k+1)]
 ty_xplate('淺弧車頂',[(y,z+.04) for y,z in top]+[(y,z) for y,z in reversed(top)],-x1-.10,x1+.10,'wfroof',True,{0,k,k+1,2*k+1})
 gable=[(-W/2,ze)]+[(-W/2+W*i/12,roofz(-W/2+W*i/12)) for i in range(13)]+[(W/2,ze)]
 for x in [-x1,x1-.02]:ty_xplate('端牆山牆',gable,x,x+.02,'wfblack')
 for side in [-1,1]:
  y=side*(W/2+.012)
  for j in range(7):sidewindow(-x1+.40+j*(2*x1-.80)/6,y,1.80,.46,.46,r=.05)
  use('01');box('窗下白細線',(0,side*(W/2+.006),1.50),(2*x1-.06,.010,.045),'white',0)
 head=len(p.MODEL);xe=x1+.004
 use('02');panel('端門門框',(xe,0,1.44),.56,1.38,'frame','front',r=.04);panel('端門',(xe+.006,0,1.44),.50,1.32,'wfblack','front',r=.03)
 panel('端門窗',(xe+.012,0,1.80),.34,.46,'glass','front',r=.04,depth=.010)
 for sd in [-1,1]:panel('端窗',(xe,sd*.64,1.80),.36,.42,'glass','front',r=.04,depth=.010)
 use('01');box('端平台',(x1+.15,0,zb-.02),(.30,W-.10,.06),'wfblack',.01)
 for sd in [-1,1]:
  line('平台扶手',[(x1,sd*(W/2-.08),zb),(x1+.26,sd*(W/2-.08),zb),(x1+.26,sd*(W/2-.08),1.55),(x1,sd*(W/2-.08),1.55)],.016,'metal')
  lamp('端梁尾燈',lambda yy,zz:x1+.18,sd*(W/2-.20),.62,.035,red=True)
 use('07');box('中央緩衝器',(L/2-.10,0,.55),(.20,.30,.18),'wfframe',.01);box('連結銷',(L/2-.06,0,.66),(.05,.05,.10),'metal',0)
 mirror_cab(list(p.MODEL[head:]))
 small_trucks(L,W,[-1.55,1.55],.26)

# ── 第二批：S400、EMU400、35PC32701 客廳車、35SA32820 總統花車、0 系新幹線 ──────────────────────────

# S400（GM-EMD GA18，1969）：柴電調車機車，全長 12.1 m（維基資訊框 12,080 mm），車庫是 L 7.0（同 S200）。外觀跟 S200、S300 相近：駕駛室在一端（+X）、三片前窗、沒有短機房；
# 做的是原廠藍色塗裝（保存的 S405 現在的樣子）。S300 外型相近，不另做。
add('s400','hood',L=7.0,W=2.85,H=3.45,axles=2,power='diesel',body='2743A3',accent='F2EEDC',label='S400')

def s400(s):
 """S400 柴電機車（GM-EMD GA18）。參考：Commons「TRA S405 at Miaoli Railway Museum 20160102.jpg」（ILOVES402，CC BY-SA 4.0，正面）、
 「TRA S405 at Miaoli Railway Museum 20100413.jpg」（Hayato Chiou，CC BY-SA 3.0，斜正面）、「TRA S405 at Miaoli Railway Museum 20130125 1.jpg」（billy1125，CC BY 2.0，車側）。
 藍色車身、黑色車架；駕駛室在一端、正面上緣兩角大切角，三片前窗（中間那片窄、略高），頂端中央雙頭燈；白帶在車角繞到正面成 V 字，
 V 字兩側各一塊外凸的黑底車號牌，外側圓形標識燈；長機房幾乎跟駕駛室一樣寬，白帶沿機房腰部走、到機房後段往下彎成下緣一條；
 機房後段一片黑色直條散熱格柵、前段百葉，車側白色管扶手，登車梯在車體中段；兩端黃黑斜紋大端梁。
 高度照 S405 車側照換算：車架 .95–1.35、駕駛室頂 3.30、機房頂 3.14、白帶 2.18–2.30（後段降到 1.42–1.54）、前窗 2.30–2.95、車號牌 2.03–2.21。"""
 L,W,H=s['L'],s['W'],s['H'];hood_colours();color('s4body','2743A3',.06,.36,.26);color('s4plate','15181B',.20,.30,.30)
 xe=L/2;xc0=xe-1.30;cw=W/2-.04;hw=W/2-.14;lab=s['label']
 use('01');box('黑色車架',(0,0,1.15),(L-.02,W-.04,.40),'hdframe',.02)
 loco_bogies(L,W,2,.40);use('04');box('燃油箱',(-.2,0,.66),(1.9,W*.70,.52),'hdframe',.06)
 head=len(p.MODEL);end_gear(xe,W,(.36,1.30));mirror_cab(list(p.MODEL[head:]))
 # 駕駛室（+X 端，上緣兩角大切角）與長機房，車頂同車身藍
 block('駕駛室',[(x,cw,1.35,z,.44) for x,z in rounded_ends(xc0,xe-.02,3.30,rf=.06)],'s4body')
 block('長機房',[(x,hw,1.35,z,.20) for x,z in rounded_ends(-xe+.08,xc0+.02,3.14,rb=.12)],'s4body')
 # 白帶：駕駛室側面接機房腰部，機房後段往下彎到下緣，再直走到端面
 def zc(x):
  if x>-.7:return 2.24
  if x<-1.6:return 1.48
  u=(x+1.6)/.9;return 1.48+.76*(3*u*u-2*u*u*u)
 side_band('白色腰帶',-xe+.10,xc0,zc,.12,hw+.004,'hdwhite',64);side_band('白色腰帶',xc0,xe-.03,lambda x:2.24,.12,cw+.004,'hdwhite',8)
 # 駕駛室正面：三片前窗、頂端雙頭燈、V 字白帶、兩塊外凸車號牌、外側標識燈
 fc=lambda y,z:xe-.02
 for y,w,z0,z1 in [(-.80,.60,2.30,2.94),(0,.38,2.40,2.94),(.80,.60,2.30,2.94)]:
  front_panel('前窗窗框',fc,y,(z0+z1)/2,w+.06,z1-z0+.06,'hdblack',.05,.022);front_panel('前窗玻璃',fc,y,(z0+z1)/2,w,z1-z0,'glass',.04,.032)
 use('03');box('頭燈燈座',(xe+.02,0,3.12),(.10,.42,.18),'s4body',.03)
 for y in [-.10,.10]:lamp('頭燈',lambda yy,zz:xe+.005,y,3.12,.058)
 wing('白色 V 字飛翼',fc,cw-.02,2.18,2.30,1.66)
 for sd in [-1,1]:
  use('03');box('外凸車號牌',(xe+.035,sd*.56,2.12),(.07,.46,.18),'s4plate',.02);face_label(lab,fc,sd*.56,2.12,.090,.075)
  cyl('標識燈座',(xe+.01,sd*1.07,2.12),.085,.06,'hdblack','X',24);lamp('標識燈',lambda yy,zz:xe-.03,sd*1.07,2.12,.050,red=True)
 # 長機房端面（−X）：頂端雙頭燈座、兩角圓形標識燈、左上角車號牌、低白帶；先建在 +X 再轉到後端
 head=len(p.MODEL);fh=lambda y,z:xe-.08
 use('03');box('端面頭燈座',(xe-.14,0,2.96),(.24,.52,.22),'s4body',.05)
 for y in [-.12,.12]:lamp('頭燈',lambda yy,zz:xe-.115,y,2.96,.060)
 for sd in [-1,1]:cyl('端面標識燈座',(xe-.04,sd*(hw-.20),2.96),.08,.10,'s4body','X',20);lamp('端面標識燈',lambda yy,zz:xe-.085,sd*(hw-.20),2.96,.045,red=True)
 front_panel('端面白帶',fh,0,1.48,2*hw-.02,.12,'hdwhite',.01,.012)
 use('03');box('端面車號牌',(xe-.05,.70,2.78),(.05,.40,.16),'s4plate',.02);face_label(lab,fh,.70,2.78,.050,.070)
 to_rear(list(p.MODEL[head:]))
 # 側面：駕駛室側窗、機房前段百葉、後段黑色直條散熱格柵、檢修門門縫、中段登車梯
 for side in [-1,1]:
  use('02');y=side*(cw+.012)
  for x,w in [(xe-.32,.30),(xe-.84,.46)]:panel('駕駛室側窗窗框',(x,y,2.62),w+.06,.64,'hdblack',r=.05);panel('駕駛室側窗玻璃',(x,y+side*.012,2.62),w,.58,'glass',r=.04,depth=.012)
  for x in [xc0-.45,xc0-.80,-.30,-.62]:louver('機房百葉',x,side*(hw+.010),2.64,.24,.56,8)
  bar_grille('長機房散熱格柵',-xe+1.15,side*(hw+.010),2.30,.50,1.36,10)
  for x in [.15,-1.05,1.20]:box('檢修門門縫',(x,side*(hw+.012),2.25),(.014,.010,1.50),'hdblack',0)
  use('07')
  for z in [.52,.80,1.08]:box('中段登車梯',(.45,side*(W/2-.10),z),(.40,.20,.035),'metal',.006)
  for dx in [-.22,.22]:box('登車梯側板',(.45+dx,side*(W/2-.10),.80),(.025,.20,.64),'hdframe',.004)
 # 車頂：喇叭、排氣管
 use('05');cyl('排氣管',(-.40,0,3.20),.08,.14,'hdblack')
 cyl('駕駛室頂喇叭',(xc0+.35,-.55,3.36),.05,.36,'hdblack','X',16);cyl('喇叭口',(xc0+.55,-.55,3.36),.09,.04,'hdblack','X',16)
 # 走道扶手（白色管扶手）
 use('07');yo=W/2-.06
 for sd in [-1,1]:
  y=sd*yo;line('走道扶手',[(xc0-.05,y,1.35),(xc0-.05,y,2.20),(-xe+.12,y,2.20),(-xe+.12,y,1.35)],.020,'hdrail')
  for x in [-.60,-1.60,-2.60]:rod('扶手立柱',(x,y,1.35),(x,y,2.20),.016,'hdrail')
 return fc

# EMU400（南非 UC&W 車體、英國 GEC 電機，1990）：四輛一組的通勤電聯車。照片上車頭跟 EMU200 相近（平頭圓角車頭、中央貫通門、黃黑排障板），
# 車側下緣往內斜切；每側兩組雙開門；做的是後期深藍色系塗裝（保存車是這款）。駕駛車沒有受電弓（在中間的 EP 車）。
add('emu400','railcar',L=8.7,W=2.8,H=3.5,doors=2,doorLeaves=2,doorW=.92,rearDoor=1.30,frontDoor=1.75,crewDoor=True,radiusTop=.45,radiusBottom=.30,winR=.07,
 winH=.62,winZ=2.42,doorWinH=.66,doorWinZ=2.40,doorTop=2.92,body='C2C8CC',accent='2340A0',acUnits=[(-2.4,1.4),(.2,1.4)],acMat='e4roof',power='overhead-other-car',label='EMU400')

def emu400(s):
 """EMU400 通勤電聯車（1990 年南非 UC&W 車體、英國 GEC 電機）。參考：Commons「TRA EMU410 at Zhunan Station 20160915.jpg」（Cassiopeia sweet，Public domain，斜側）、
 「TRA EMC412 in Dingpu Station 20070705.jpg」（SElefant，CC BY-SA 3.0，正面）、「EMU400 EP403 Side Profile Taoyuan DSC 0271.jpg」（Lexcie，CC BY-SA 3.0，車側色帶與門窗）。
 車頭跟 EMU200 同型：平頭、上緣大圓角，兩側前窗、中央貫通門；整個車頭深藍，貫通門下半一塊白板（中央黑色橢圓）；窗下三道白細線從車角往中央下斜，
 繞到駕駛室側面接到乘務員門；頂端中央方形頭燈、左上路線牌；下緣兩角各一對燈；黃黑排障板。車側淺灰，窗下一道粗藍帶、下方一道細藍線，窗上一道細藍線；
 每側兩組雙開門；車頂兩台冷氣。高度照 EMC412 正面照（車寬 2.8 m 定比例）量：前窗 1.95–2.72、貫通道外框 .90–2.86、門下半白板 1.40–1.92、白線 1.78／1.66／1.54（車角）、
 下緣燈 1.24；車側粗藍帶 1.98–2.10、細藍線 1.80–1.85、窗上藍線 2.85–2.97（車側照裡跟窗下粗藍帶差不多粗）。"""
 L,W,H=s['L'],s['W'],s['H']
 color('e4grey','C2C8CC',.30,.34,.18);color('e4blue','2340A0',.06,.32,.30);color('e4roof','A6ABAE',.40,.42,.08);color('e4white','F1F2EE',.08,.32,.26)
 profile=[(.83,L/2-.06),(1.00,L/2),(H-.40,L/2-.01),(H-.16,L/2-.08),(H,L/2-.22)]
 s['bowPow']=6
 side=[(1.80,'e4grey'),(1.85,'e4blue'),(1.98,'e4grey'),(2.10,'e4blue'),(2.85,'e4grey'),(2.97,'e4blue'),(H-.14,'e4grey'),(H+1,'e4roof')]
 f,neck,doors=emu_body(s,profile,.08,side,[(H+1,'e4blue')],[(H-.14,'e4blue'),(H+1,'e4roof')],leaf='e4grey',gaps=[0,3,0],
  leafbands=[(1.825,.05,'e4blue'),(2.04,.12,'e4blue')],crew='e4blue')
 # 駕駛室側面：深藍到乘務員門後（xw）收掉；三道白線從車頭繞過來，到乘務員門前收掉
 xw=neck-.72
 for sd in [-1,1]:
  side_paint('駕駛室側面深藍',s,f,sd,[],xw,neck+.04,.95,3.05,'e4blue')
  shell_wrap('駕駛室側面深藍上緣',s,f,upper_section(s,3.04,H-.14,sd),xw,L/2,'e4blue')
  for z in [1.78,1.66,1.54]:side_paint('駕駛室側面白線',s,f,sd,[],neck-.55,neck+.04,z-.025,z+.025,'e4white',offset=.014)
 # 車頭白線：外側接駕駛室側面，從 |y| 1.0 到 .62 往中央下斜 .22（中央被貫通道外框蓋住）
 t=lambda y:min(1,max(0,(1.0-abs(y))/.38));e=W/2-.004
 for z in [1.78,1.66,1.54]:
  for a,b in [(-e,-.58),(.58,e)]:front_patch('車頭白線',f,a,b,lambda y,z=z:z-.025-.22*t(y),lambda y,z=z:z+.025-.22*t(y),'e4white',.028,cols=24,rows=2)
 # 頂端方形頭燈、左上路線牌、右上標識燈
 front_panel('頂部頭燈框',f,0,3.22,.42,.20,'frame',.04,.032);front_panel('頂部頭燈',f,0,3.22,.34,.13,'lamp',.03,.040)
 front_panel('路線牌框',f,-.86,3.04,.50,.19,'frame',.04,.030);front_panel('路線牌',f,-.86,3.04,.44,.13,'white',.03,.036)
 front_panel('標識燈框',f,.90,3.02,.20,.12,'frame',.05,.032);lamp('標識燈',f,.90,3.02,.040)
 # 兩側前窗、雨刷
 for sd in [-1,1]:
  front_panel('前窗橡膠框',f,sd*.93,2.335,.68,.83,'frame',.10,.032);front_panel('前窗玻璃',f,sd*.93,2.335,.62,.77,'glass',.08,.040)
  wiper(f,sd*.93,1.98,.48)
 # 中央貫通道：黑色外框裡一扇深藍門（門上有窗、下半白板中央黑色橢圓）
 front_panel('貫通道黑色外框',f,0,1.88,1.14,1.96,'frame',.06,.034)
 front_panel('貫通門門縫',f,0,1.875,.86,1.89,'chassis',.03,.040);front_panel('貫通門門扇',f,0,1.875,.82,1.85,'e4blue',.03,.046)
 front_panel('貫通門窗框',f,0,2.33,.52,.70,'frame',.06,.050);front_panel('貫通門窗',f,0,2.33,.46,.64,'glass',.05,.054)
 front_panel('貫通門下半白板',f,0,1.66,.70,.52,'e4white',.02,.052);front_panel('白板中央橢圓',f,0,1.66,.26,.17,'frame',.085,.058)
 box('貫通門把手',(f(.30,1.30)+.06,.30,1.30),(.03,.03,.16),'metal',.006)
 # 下緣兩角各一對燈（外紅尾燈、內白頭燈）
 for sd in [-1,1]:
  front_panel('燈座',f,sd*.94,1.24,.58,.26,'frame',.12,.036)
  lamp('頭燈',f,sd*.80,1.24,.070);lamp('尾燈',f,sd*1.08,1.24,.065,red=True)
 front_panel('車號牌',f,.93,2.80,.40,.09,'white',.02,.036);face_label(s['label'],f,.93,2.80,.054,.05)
 hazard(f(0,.83)+.07,W,.61,.43)
 return f

# ── 莒光號塗裝的兩節特殊客車：35PC32701 客廳車、35SA32820 總統花車 ───────────────────────────────
# 都是舊型客車改造，拱頂車殼（arch_shell，同藍皮客車）、莒光號標準色（上米黃、下橘、白線，顏色同莒光號客車）。
# 編組裡由 E200 牽引、接在莒光號客車後面當尾車（rail-3d/garage-model.js 的 COACH_LEAD），特色那端（瞭望台、手折門）建在 +X，地圖編組翻轉朝外。

def jg_livery():
 ge_colours();color('jgwhite','F4F3EF',.06,.34,.26);color('jgroof','B4B9BB',.40,.40,.08)
 return [(1.566,'georange'),(1.671,'jgwhite'),(1.742,'georange')]

def jg_window(x,y,side,w,z0,z1):
 use('02');zc=(z0+z1)/2
 panel('客車窗框',(x,y,zc),w+.06,z1-z0+.06,'frame',r=.08)
 panel('獨立深色玻璃',(x,y+side*.015,zc),w,z1-z0,'glass',r=.06,depth=.013)

def jg_end(x,e,W,door=True):
 """舊型客車端牆（建在 e 那端）：貫通門、風擋折片、兩角紅色尾燈、車鉤。"""
 use('07')
 if door:
  panel('客車端門框',(x,0,1.95),.82,1.73,'frame','front',r=.06)
  panel('客車端門扇',(x+e*.016,0,1.95),.67,1.59,'georange','front',r=.038)
  panel('客車端門玻璃',(x+e*.030,0,2.30),.47,.68,'glass','front',r=.045)
  for k in range(4):
   xx=x+e*(.06+k*.038)
   for sd in [-1,1]:box('貫通風擋側折片',(xx,sd*.52,1.91),(.045,.075,1.91),'rubber',.018)
   box('貫通風擋頂折片',(xx,0,2.865),(.045,1.10,.075),'rubber',.018)
 use('03')
 for sd in [-1,1]:
  cyl('客車尾燈座',(x+e*.03,sd*.94,1.21),.095,.045,'frame','X',24)
  cyl('客車尾燈紅透鏡',(x+e*.056,sd*.94,1.21),.070,.017,'taillamp','X',24)

add('pc32701','coach',L=9.0,W=2.8,H=3.4,doors=1,doorLeaves=1,doorW=.60,gutter=3.0,body='EC7838',accent='F2EEDC',label='35PC32701')

def pc32701(s):
 """35PC32701 客廳車（1972 年唐榮鐵工廠由 35SP32712 改造）。參考：Commons「TRA Parlor Car at Balin Station 20160117.jpg」（billy1125，CC BY 2.0，瞭望台端）、
 「總統客廳車.jpg」（CC BY-SA 3.0，瞭望台近照，作者沒有機器可讀資料）。外觀照照片：拱頂、莒光號標準色；一端開放瞭望台（+X）：
 車殼到瞭望台前結束，車頂延伸過去蓋住平台，橘色端柱與拱形頂框，兩側與端面欄杆、平台上一扇玻璃拉門，端柱下方紅色尾燈；
 車側六扇寬窄不一的大窗（1993 年底換成莒光號的寬車窗），+Y 側另一端兩扇小窗、−Y 側另一端是橘色百葉格柵；另一端是一般端牆與貫通門。
 高度同莒光號客車：橘 .83–1.566、白線 1.566–1.671、橘細線 1.671–1.742、米黃到雨水槽 3.0；窗 1.79–2.49。"""
 L,W,H=s['L'],s['W'],s['H'];gut=s['gutter'];zones=jg_livery();lp=.62;xp=L/2-lp
 body=arch_shell({**s,'L':L-lp},gut,zones+[(gut,'gecream'),(H+1,'jgroof')],'gecream')
 for v in body.data.vertices:v.co.x-=lp/2
 roof=arch_shell({**s,'L':lp+.02,'bottom':2.86},gut,[(gut,'georange'),(H+1,'jgroof')],'georange',name='瞭望台車頂')
 for v in roof.data.vertices:v.co.x+=L/2-lp/2-.01
 roof['primary_body']=False
 # 瞭望台：地板、端柱、側面與端面欄杆、平台上的玻璃拉門與兩側小窗、端柱上的紅色尾燈（八堵 2016 照片的瞭望台沒有圓牌，不做）
 use('01');box('瞭望台地板',(xp+lp/2,0,.86),(lp,W-.04,.08),'chassis',.01)
 for sd in [-1,1]:
  box('瞭望台橘色端柱',(L/2-.05,sd*(W/2-.06),1.86),(.10,.12,2.04),'georange',.012)
  box('瞭望台內側橘柱',(xp+.04,sd*(W/2-.06),1.86),(.08,.12,2.04),'georange',.012)
 use('07');panel('瞭望台玻璃拉門框',(xp+.012,0,1.92),.80,1.84,'frame','front',r=.04);panel('瞭望台玻璃拉門',(xp+.022,0,1.95),.70,1.74,'glass','front',r=.03,depth=.010)
 for sd in [-1,1]:panel('平台內側小窗',(xp+.012,sd*.86,2.20),.38,.70,'glass','front',r=.03,depth=.010)
 for sd in [-1,1]:
  y=sd*(W/2-.07)
  line('側面欄杆扶手',[(xp+.08,y,1.86),(L/2-.10,y,1.86)],.022,'metal');line('側面欄杆下橫桿',[(xp+.08,y,.95),(L/2-.10,y,.95)],.014,'metal')
  for k in range(4):rod('側面欄杆直柱',(xp+.14+k*.11,y,.95),(xp+.14+k*.11,y,1.86),.010,'metal')
  line('端面欄杆扶手',[(L/2-.06,sd*(W/2-.12),1.86),(L/2-.06,sd*.40,1.86)],.022,'metal')
  for k in range(5):rod('端面欄杆直柱',(L/2-.06,sd*(W/2-.16-k*.16),.95),(L/2-.06,sd*(W/2-.16-k*.16),1.86),.010,'metal')
  use('03');cyl('客車尾燈座',(L/2+.01,sd*(W/2-.06),1.21),.085,.045,'frame','X',24);cyl('客車尾燈紅透鏡',(L/2+.035,sd*(W/2-.06),1.21),.062,.017,'taillamp','X',24)
 use('07');box('端面欄杆下橫桿',(L/2-.06,0,.95),(.03,W-.24,.03),'metal',.004)
 jg_end(-L/2-.010,-1,W)
 for e in [-1,1]:coupler(e*(L/2+.10),W,e,z=.56)
 # 車側窗：六扇大窗，+Y 另一端兩扇小窗，−Y 另一端橘色百葉格柵
 big=[(-2.62,.78),(-1.62,.82),(-.55,.82),(.52,.82),(1.56,.78),(2.52,.74)]
 for sd in [-1,1]:
  y=sd*(W/2+.012);use('01');box('雨水槽',(-lp/2,sd*(W/2+.02),gut-.01),(L-lp,.04,.05),'georange',.008)
  for x,w in big:jg_window(x,y,sd,w,1.79,2.49)
  if sd>0:
   for x in [-3.80,-3.42]:jg_window(x,y,sd,.24,1.98,2.40)
  else:
   use('02');panel('冷氣百葉格柵',(-3.62,y,2.20),.66,1.10,'georange',r=.02)
   for k in range(9):box('百葉格柵橫條',(-3.62,y+sd*.016,1.70+k*.12),(.58,.012,.03),'gerubber',.002)
 bogies(L,W,r=.39)
 use('05')
 for x in [-3.0,-1.0,1.0,3.0]:
  cyl('通風器喉口',(x,0,H+.04),.085,.10,'chassis',n=16)
  cyl('蕈狀通風器帽',(x,0,H+.11),.19,.07,'jgroof',n=24,bevel=.02)

add('sa32820','coach',L=9.0,W=2.8,H=3.4,doors=2,doorLeaves=1,doorW=.56,gutter=3.0,body='EC7838',accent='F2EEDC',label='35SA32820')

def sa32820(s):
 """35SA32820 總統花車（1967 年由觀光號客車改裝）。參考：Commons「TRA Railway Saloon Car 35SA32820 Kaohsiung Sta 20170222 1.JPG」
 「…2.JPG」（Cassiopeia sweet，Public domain，兩側正側面）、「TRA 35SA32820 20240916.jpg」（臺灣鐵路公司，端面）。
 外觀保留觀光號特徵：拱頂、莒光號標準色；一端（−X）是冷氣機與盥洗室：車側整段橘色，−Y 側一片橘色百葉格柵、+Y 側一扇盥洗室小方窗；
 另一端（+X）是手折門上下台門：整段橘色、門上兩扇窄長窗，門前一個終點指示器；冷氣端兩扇窗後一扇米黃色側門，再往後一排十一扇小窗。
 高度同莒光號客車；小窗 1.86–2.40。"""
 L,W,H=s['L'],s['W'],s['H'];gut=s['gutter'];zones=jg_livery()
 arch_shell(s,gut,zones+[(gut,'gecream'),(H+1,'jgroof')],'georange')
 xr=-L/2+.70;xf=L/2-.80;xd=L/2-.44;xs=-2.75
 for sd in [-1,1]:
  y=sd*(W/2+.012);use('01');box('雨水槽',(0,sd*(W/2+.02),gut-.01),(L+.03,.04,.05),'georange',.008)
  box('冷氣端橘色',((-L/2+xr)/2,sd*(W/2+.006),2.29),(xr+L/2,.012,1.42),'georange',0)
  box('手折門端橘色',((xf+L/2)/2,sd*(W/2+.006),2.29),(L/2-xf,.012,1.42),'georange',0)
  if sd<0:
   use('02');panel('冷氣百葉格柵',(-L/2+.36,y+sd*.004,2.10),.50,1.00,'georange',r=.02)
   for k in range(7):box('百葉格柵橫條',(-L/2+.36,y+sd*.016,1.70+k*.13),(.44,.012,.03),'gerubber',.002)
  else:jg_window(-L/2+.36,y,sd,.30,2.02,2.32)
  for x in [xr+.28,xr+.66]:jg_window(x,y,sd,.30,1.86,2.40)
  for k in range(11):jg_window(xs+.62+k*.48,y,sd,.40,1.94,2.34)  # 照片的小窗是橫長方形
  use('02');panel('終點指示器',(xf-.16,y,2.22),.20,.30,'frame',r=.02);panel('終點指示器字幕',(xf-.16,y+sd*.010,2.22),.15,.24,'white',r=.01,depth=.008)
  for i,(x,leaf,wins) in enumerate([(xs,'gecream',[(0,.22,2.20,.50)]),(xd,'georange',[(-.11,.13,2.22,.56),(.11,.13,2.22,.56)])]):
   use('02');panel('側門門框',(x,y,1.80),.60,2.00,'frame',r=.03)
   d=panel('獨立門扇',(x,y+sd*.020,1.80),.52,1.94,leaf,r=.025,depth=.022)
   d['side_door']=True;d['door_group']=i+1;d['side']=sd;d['leaf']=0
   for dx,ww,c,hh in wins:panel('門窗嵌框',(x+dx,y+sd*.040,c),ww+.05,hh+.06,'frame',r=.06);panel('門窗玻璃',(x+dx,y+sd*.052,c),ww,hh,'glass',r=.05,depth=.012)
   use('04')
   for z in [.46,.68]:box('外露登車踏階',(x,sd*(W/2-.04),z),(.56,.24,.04),'chassis',.008)
 jg_end(L/2+.010,1,W);jg_end(-L/2-.010,-1,W)
 for e in [-1,1]:coupler(e*(L/2+.10),W,e,z=.56)
 bogies(L,W,r=.39)
 use('05')
 box('冷氣機罩',(-L/2+.95,0,H+.06),(1.20,W*.60,.20),'jgroof',.08)
 for k in range(6):box('冷氣罩頂部格柵',(-L/2+.50+k*.18,0,H+.165),(.035,W*.44,.01),'chassis',0)
 for x in [-1.6,-.2,1.2,2.6]:
  cyl('通風器喉口',(x,0,H+.04),.085,.10,'chassis',n=16)
  cyl('蕈狀通風器帽',(x,0,H+.11),.19,.07,'jgroof',n=24,bevel=.02)

# 0 系新幹線 21-5035（日本國鐵的先頭車）：台灣高鐵施工時當限界測量車，現在在高鐵台南站旁的花魁車園區展示。
# 車庫照 700T 的尺度（L 8.8）；圓車鼻壓到約六成；地圖的中間車鏡射 x<0 半車做的，所以只屬於車頭的東西全放 x>0。
add('shinkansen0','express',L=8.8,W=2.9,H=3.35,doors=2,doorLeaves=1,doorW=.56,body='F0EEE6',accent='1E3B8C',label='21-5035')

def shinkansen0(s):
 """0 系新幹線先頭車（21-5035）。參考：Commons「Shinkansen Series 0 car 21-5035 THSR Tainan Station 20240413.jpg」（Rsa，CC BY-SA 3.0，斜側）、
 「2024-01-12 TSHR Structure Gauge Test Car in Tainan Oiran Train Scenic Park 01–04.jpg」（Tze Chiang Hao，CC BY 4.0，車側色帶、門窗、車號）。
 象牙白車身、深藍窗帶、窗帶下一道細藍線、深藍裙邊；圓車鼻：鼻尖圓形光罩（中間一道橫縫），鼻側一對橢圓頭燈，車鼻往上收到駕駛室前窗；
 窗帶往前延伸到駕駛室側面、前端收成圓頭；小方窗一排；每側兩扇單開門（車尾、駕駛室後）；車頂淺灰、冷氣與通風口。
 高度照斜側照量（車頂 3.35、裙邊 .83 定比例）：裙邊上緣 1.12、細藍線 1.80–1.86、窗帶 2.02–2.62、窗 2.14–2.50、鼻尖光罩中心 1.52、頭燈中心 1.98（斜側照裡頭燈在鼻尖光罩上後方、細藍線高度附近，橢圓、比光罩略小）。"""
 L,W,H=s['L'],s['W'],s['H'];tip=L/2-.08
 color('s0white','F0EEE6',.08,.30,.30);color('s0blue','1E3B8C',.06,.30,.32);color('s0roof','C8CCCC',.40,.40,.08)
 color('s0cover','F6F3E6',.05,.20,.40);color('s0seam','9AA0A0',.20,.40,.10)
 # (x, 寬, 底, 頂, 下圓角, 上圓角)：車鼻是圓頭子彈形，斷面越往前越圓
 shape=hermite([(-L/2,W,.83,H,.20,.70),(0,W,.83,H,.20,.70),(1.70,W,.83,H,.20,.70),(2.10,W,.83,3.33,.21,.72),(2.45,2.88,.84,3.24,.22,.76),
  (2.75,2.82,.85,3.06,.24,.80),(3.00,2.72,.87,2.86,.27,.84),(3.25,2.56,.90,2.62,.32,.86),(3.50,2.32,.93,2.38,.40,.86),(3.72,2.02,.97,2.16,.48,.80),
  (3.90,1.68,1.01,1.98,.52,.70),(4.05,1.30,1.07,1.84,.48,.56),(4.18,.90,1.14,1.72,.38,.40),(4.28,.52,1.22,1.62,.22,.22),(tip,.04,1.50,1.54,.015,.015)])
 xs=sorted(set(round(x,4) for x in [-L/2,-L/2+.14]+[-4.0+.25*i for i in range(17)]+[.26,.40]+[.55+.06*i for i in range(25)]+[2.05+.03*i for i in range(75)]+[4.28+.01*i for i in range(9)]+[tip]))
 verts=[]
 for x in xs:ring=loaf(*shape(x));verts+=[(x,y,z) for y,z in ring]
 n=len(ring);k=len(xs)
 faces=[tuple(reversed(range(n))),tuple(range((k-1)*n,k*n))]+[(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for i in range(k-1) for j in range(n)]
 use('01');body=mesh('0 系施工車殼',verts,faces,'s0white',0,True)
 # 照塗裝切色：裙邊（往鼻尖略升）、細藍線、窗帶（前端收成圓頭，在駕駛室側面結束）、車頂、駕駛室前窗
 sk=lambda x:1.12+.12*min(1,max(0,(x-3.0)/1.2))**2
 xb=2.40;roofz=lambda x:H-.06 if x<1.9 else 9
 lerp=lambda a,b,t:(a[0].lerp(b[0],t),a[1].lerp(b[1],t));groups={}
 def put(key,poly):
  if len(poly)<3:return
  vv,ff,nn=groups.setdefault(key,([],[],[]));base=len(vv);vv.extend(tuple(a) for a,_ in poly);nn.extend(tuple(m.normalized()) for _,m in poly)
  ff.extend((base,base+i,base+i+1) for i in range(1,len(poly)-1))
 d=body.data;d.calc_loop_triangles()
 for tri in d.loop_triangles:
  poly=[(d.vertices[i].co.copy(),d.vertices[i].normal.copy()) for i in tri.vertices]
  put('s0blue',clip_poly(poly,lambda v:sk(v[0].x)-v[0].z,lerp));rest=clip_poly(poly,lambda v:v[0].z-sk(v[0].x),lerp)
  put('s0roof',clip_poly(rest,lambda v:v[0].z-roofz(v[0].x),lerp));rest=clip_poly(rest,lambda v:roofz(v[0].x)-v[0].z,lerp)
  put('s0white',rest)
 p.MODEL.remove(body);bpy.data.objects.remove(body,do_unlink=True)
 for key,name in [('s0white','0 系象牙白車殼'),('s0blue','0 系深藍裙邊'),('s0roof','0 系淺灰車頂')]:
  vv,ff,nn=groups[key];m=bpy.data.meshes.new(name);m.from_pydata(vv,[],ff);m.update()
  o=bpy.data.objects.new(name,m);p.ACTIVE.objects.link(o);p.MODEL.append(o);finish(o,key,0,True);m.normals_split_custom_set_from_vertices(nn)
  if key=='s0white':o['primary_body']=True
 # 窗帶與細藍線：車側平面上的薄片，前端收成圓頭（在車鼻開始收窄之前結束）
 for sd in [-1,1]:
  pts=[(-L/2+.04,2.02),(xb-.30,2.02)]+[(xb-.30+.30*math.sin(math.pi*t/12),2.32-.30*math.cos(math.pi*t/12)) for t in range(1,12)]+[(xb-.30,2.62),(-L/2+.04,2.62)]
  side_prism('深藍窗帶',pts,sd,W/2+.012,'s0blue')
  side_prism('窗帶下細藍線',[(-L/2+.04,1.80),(xb-.10,1.80),(xb-.10,1.86),(-L/2+.04,1.86)],sd,W/2+.012,'s0blue')
 # 窗與門：x<0 的窗距一致（中間車鏡射後 x=0 兩側一致），駕駛室門前不放窗
 dw=s['doorW']
 for sd in [-1,1]:
  y=sd*(W/2+.022)
  for x in [-.30-.56*i for i in range(6)]+[.26,.82]:sidewindow(x,y,2.32,.34,.36,r=.07)
  for i,x in enumerate([-L/2+.42,1.42]):
   use('02');cz=(1.20+2.80)/2;h=2.80-1.20
   panel('側門門框',(x,y,cz),dw+.05,h+.03,'frame',r=.04)
   door=panel('獨立門扇',(x,y+sd*.023,cz),dw-.022,h,'s0white',r=.04,depth=.024)
   door['side_door']=True;door['door_group']=i+1;door['side']=sd;door['leaf']=0
   box('門扇窗帶',(x,y+sd*.041,2.32),(dw-.022,.011,.60),'s0blue',.002);box('門扇細藍線',(x,y+sd*.041,1.83),(dw-.022,.011,.06),'s0blue',.002)
   panel('門窗嵌框',(x,y+sd*.052,2.36),.24,.46,'frame',r=.06)
   panel('門窗玻璃',(x,y+sd*.066,2.36),.20,.40,'glass',r=.05,depth=.012)
  # 駕駛室側窗（乘務員門上方那扇小窗）
  sidewindow(2.05,y,2.80,.36,.22,r=.05)
 text_label(s['label'],(-1.8,W/2+.025,1.45),.07,axis='side',side=1)
 surf=surface_fn(shape,tip)
 # 駕駛室前窗：車鼻上段兩片，貼著車殼表面
 def top_z(x,y):
  w,zb,zt,rb,rt=shape(x);hw,rb,ay,az=loaf_dims(w,zb,zt,rb,rt);e=abs(y)-(hw-ay)
  return zt if e<=0 else zt-az+az*math.sqrt(max(0,1-min(1,e/ay)**2))
 def top_patch(name,x0,x1,y0,y1,material,off,nx=10,ny=8):
  vv=[(x0+(x1-x0)*i/nx,y0+(y1-y0)*j/ny) for i in range(nx+1) for j in range(ny+1)]
  ff=[(i*(ny+1)+j,(i+1)*(ny+1)+j,(i+1)*(ny+1)+j+1,i*(ny+1)+j+1) for i in range(nx) for j in range(ny)]
  return mesh(name,[(x,y,top_z(x,y)+off) for x,y in vv],ff,material,0,True)
 use('03')
 for sd in [-1,1]:
  a,b=sorted([sd*.08,sd*.98]);top_patch('駕駛室前窗黑框',2.58,3.02,a,b,'frame',.006)
  a,b=sorted([sd*.13,sd*.93]);top_patch('駕駛室前窗玻璃',2.62,2.98,a,b,'glass',.012)
 # 鼻尖圓形光罩（中間一道橫縫）、鼻側一對橢圓頭燈
 use('03');n_=28
 def nose_disc(name,yc,zc,ry,rz,material,off):
  pts=[(yc,zc)]+[(yc+ry*math.cos(2*math.pi*k/n_),zc+rz*math.sin(2*math.pi*k/n_)) for k in range(n_)]
  return mesh(name,[(surf(y,z)+off,y,z) for y,z in pts],[(0,1+k,1+(k+1)%n_) for k in range(n_)],material,0,True)
 nose_disc('鼻尖光罩',0,1.53,.26,.24,'s0cover',.010)
 line('光罩橫縫',[(surf(y,1.53)+.016,y,1.53) for y in [-.24+.04*i for i in range(13)]],.007,'s0seam')
 for sd in [-1,1]:
  # 頭燈在鼻側（正面看在鼻尖兩側偏上），貼著車鼻表面
  nose_disc('橢圓頭燈框',sd*.82,1.98,.22,.17,'frame',.008);nose_disc('橢圓頭燈',sd*.82,1.98,.17,.13,'lamp',.016)
 # 轉向架與車底；鼻底的深藍排障罩
 bogies(L,W,r=.36,centers=[-2.9,1.6])
 for o in [o for o in p.MODEL if o.name.split('.')[0] in ('車底主梁','車下獨立設備箱','設備箱通風格柵')]:p.MODEL.remove(o);bpy.data.objects.remove(o,do_unlink=True)
 use('04');box('車底主梁',(-.55,0,.86),(6.9,W*.72,.30),'chassis',.04)
 for x in [-1.2,-.1]:
  box('車下獨立設備箱',(x,0,.62),(.90,W*.6,.48),'roof',.04)
 coupler(-L/2-.03,W,-1,gangway=True)
 # 車頂：冷氣與通風口一排（x<0 等距）
 use('05')
 for x in [-3.6+.75*i for i in range(7)]:
  box('車頂通風口',(x,0,H-.01),(.46,W*.40,.08),'s0roof',.02)
  for k in range(4):box('通風口格柵',(x-.15+k*.10,0,H+.035),(.03,W*.34,.01),'chassis',0)
 return surf

BUILDERS.update({'emu200':emu200,'dr2800':dr2800,'e100':e100,'s200':s200,'shay31':shay31,'tsc346':tsc346,'wufen':wufen,
 's400':s400,'emu400':emu400,'pc32701':pc32701,'sa32820':sa32820,'shinkansen0':shinkansen0})
