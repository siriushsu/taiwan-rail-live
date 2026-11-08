"""圖鑑補齊的車款：車庫原本沒有、《台灣鐵道車輛完全圖鑑》有收的車。
規格用 tw_specs.add 登記、建模函式登記進 tw_models.BUILDERS（build_tw.py 匯入本檔）；車殼與車頭零件沿用 tw_models、tw_classic 同家族的函式。
參考照片只在本機比對，檔名、作者、授權記在 catalog-source.json；不放營運商標，車號用可移除的示意字牌。"""
import math
from tw_specs import add
from tw_models import *

# EMU200（南非 UC&W 車體、英國 GEC 電機，1987）：原廠塗裝的駕駛馬達車。車身側面跟 EMU1200 同一個車體（EMU1200 是 2002–03 年用它改造的），
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

# DR2800（東急車輛，1982／84）：三節一組（兩節駕駛動力車夾一節電源拖車），20.3 m 車在車庫是 L 8.3，跟 DR3100 同斷面。
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

# E100（英國 GEC 設計、南非 UC&W 組裝，1976–77）：Bo-Bo 雙頭電力機車，全長 15.1 m，比 E200 系（17 m、L 8.6）短，車庫是 L 7.9。
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

# S200（GM-EMD GL8，1960–61）：A1A-A1A 柴電機車，全長 12.2 m，車庫是 L 7.0。駕駛室在一端（+X，三片前窗），另一端是長機房端面。
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

BUILDERS.update({'emu200':emu200,'dr2800':dr2800,'e100':e100,'s200':s200,'shay31':shay31,'tsc346':tsc346,'wufen':wufen})
