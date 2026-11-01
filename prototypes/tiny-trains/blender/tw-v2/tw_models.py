"""台灣車隊逐款建模。車殼與車側骨架在 refine_parts；車頭、塗裝、窗門配置每款各自給。
參考照片只在本機比對，檔名、作者、授權記在 catalog-source.json；不放營運商標，車號用可移除的示意字牌。"""
import math
import blender_parts as p
from blender_parts import *
from build_models import front_panel,front_ribbon
from refine_parts import *

# ── 北捷高運量（C301／C321／C341／C371／C381）────────────────────────────────
# 共同：不鏽鋼車身、每側四組雙開門、門間雙窗、窗下藍帶連門扇一路到底、壓紋平頂（冷氣不外露）、第三軌集電靴。
# 前四款是同一種「黑色窗區＋中央逃生門＋窗下不鏽鋼＋藍帶燈座」的端面，差在車頭傾角與黑色窗區有沒有不鏽鋼外框；C381 是銀色圓鼓車頭。

def metro_colours():
 color('stain','C3C7CB',.55,.30,.15);color('troof','B2B7BA',.45,.42,.08);color('tblue','2479C9',.05,.34,.30)
 color('amber','D88F1F',.10,.22,.40);color('led','E8642A',.10,.25,.30)

# 高度依北投機廠正面照（Lokseng01）量：黑色窗區下緣 1.73、藍帶 1.20–1.50、防爬器 .87–1.07；藍帶在車角繞到車側、同一高度。
MASK0,BAND0,BAND1=1.73,1.20,1.50

def metro_body(s,profile,bow,front_zones,nose_zones,bands):
 H=s['H']
 f,neck,doors=emu_body(s,profile,bow,[(H-.12,'stain'),(H+1,'troof')],front_zones,nose_zones,leaf='stain',gaps=[1,2,2,2,1],bands=bands,leafbands=bands)
 metro_roof(s,neck)
 return f,neck,doors

def metro_roof(s,neck):
 """車頂是縱向壓紋的平頂，冷氣不外露，只在車頂邊緣有小型百葉通風口（北投機廠 C301、C371 俯拍照都是這樣）。"""
 L,W,H=s['L'],s['W'],s['H'];use('05');x0,x1=-L/2+.25,neck-.35
 for k in range(11):box('車頂縱向壓紋',((x0+x1)/2,-1.0+k*.2,H+.008),(x1-x0,.035,.016),'troof',.004)
 for x in [-L/2+1.3,neck-1.7]:
  for side in [-1,1]:
   box('車頂邊緣通風口',(x,side*(W/2-.42),H+.035),(.56,.20,.07),'troof',.015)
   for j in range(4):box('通風口百葉',(x-.18+j*.12,side*(W/2-.42),H+.072),(.05,.16,.008),'chassis',.002)

def metro_black_face(s,f,face_top,panel_w=None,face_r=.12,dest='led'):
 """黑色窗區端面的共同零件：左窗（目的地顯示器、車號）、中央逃生門、司機窗、兩角琥珀標識燈、藍帶上的頭尾燈座。
 panel_w 給了就另貼一片黑色面板（C301、C371 四周留不鏽鋼邊）；沒給代表黑色已畫在車殼分區上（C321／C341 黑面到頂）。"""
 W,H=s['W'],s['H'];y_out=W/2-.22;dy=.33
 if panel_w:front_panel('車頭黑色窗區',f,0,(MASK0+face_top)/2,panel_w,face_top-MASK0,'frame',face_r,.028)
 g0,g1=MASK0+.15,face_top-.18
 front_glass(f,[(-y_out,-dy-.07,'左側前窗'),(dy+.07,y_out,'司機前窗')],g0,g1,.050,.05)
 front_panel('逃生門門板',f,0,(MASK0+.02+face_top-.06)/2,2*dy,face_top-.06-MASK0-.02,'dark',.03,.036)
 front_panel('逃生門窗',f,0,(g0+.10+g1-.04)/2,2*dy-.20,g1-.04-g0-.10,'glass',.04,.052)
 for y in [-dy-.012,dy+.012]:front_patch('逃生門下半門縫',f,y-.010,y+.010,1.07,MASK0,'frame',.034,cols=1,rows=8)
 front_patch('逃生門下緣門縫',f,-dy,dy,1.07,1.09,'frame',.034,cols=8,rows=1)
 front_panel('目的地顯示器',f,-(W/2-.58),g1-.10,.50,.11,'dark',.02,.062);front_panel('目的地字幕',f,-(W/2-.58),g1-.10,.40,.05,dest,.01,.068)
 front_panel('車號顯示器',f,-(W/2-.46),g0+.12,.26,.09,'dark',.02,.062)
 text_label(s['label'],(f(-(W/2-.46),g0+.12)+.075,-(W/2-.46),g0+.12),.07)
 front_panel('車頭監視攝影機',f,0,face_top-.03,.12,.06,'dark',.02,.058)
 for side in [-1,1]:
  lamp_color('上部琥珀標識燈',f,side*(W/2-.32),face_top-.08,.034,'amber')
  lamp_pair(f,side*(W/2-.38),(BAND0+BAND1)/2,True,r=.055,gap=.15,hw=.42,hh=.20)
 for y in [-(W/2-.55),W/2-.55]:wiper(f,y,g0+.06,.60)
 front_panel('前端防爬器',f,0,.97,W-.44,.20,'chassis',.04,.10)

def black_face_zones(s,black_top=None):
 H=s['H'];fz=[(BAND0,'stain'),(BAND1,'tblue')]
 fz+=[(MASK0,'stain'),(black_top,'frame'),(H+1,'stain')] if black_top else [(H+1,'stain')]
 return fz,[(BAND0,'stain'),(BAND1,'tblue'),(H-.12,'stain'),(H+1,'troof')]

def c301(s):
 """C301（川崎／Union Rail Car）。參考：Commons「Kawasaki-URC C301 EMU.jpg」（Samson Ng，CC BY-SA 4.0）、
 「C301 & C381 at Beitou Station 20150721.jpg」（James970028，CC BY-SA 3.0）、「A Taipei Metro C301 train at Beitou Depot 01.jpg」（Lokseng01，CC BY-SA 4.0）。
 垂直平頭、四周留一圈不鏽鋼框的黑色窗區；左窗上緣紅色 LED 目的地、下緣車號；窗下一段不鏽鋼再接粗藍帶，燈座在藍帶兩端。"""
 L,W,H=s['L'],s['W'],s['H'];metro_colours()
 profile=[(.83,L/2-.08),(1.00,L/2),(2.90,L/2-.02),(H-.20,L/2-.07),(H,L/2-.28)]
 fz,nz=black_face_zones(s)
 f,neck,doors=metro_body(s,profile,.06,fz,nz,[((BAND0+BAND1)/2,BAND1-BAND0,'tblue')])
 metro_black_face(s,f,H-.12,panel_w=W-.30,face_r=.10)
 return f

def c321_like(s):
 """C321／C341 共用：西門子（SGP）製，車頭微微後傾，黑色窗區一路到車頂邊、兩側幾乎沒有不鏽鋼框。"""
 L,W,H=s['L'],s['W'],s['H'];metro_colours()
 profile=[(.83,L/2-.10),(1.00,L/2),(1.80,L/2-.02),(2.80,L/2-.12),(H-.20,L/2-.21),(H,L/2-.46)]
 fz,nz=black_face_zones(s,H-.06)
 f,neck,doors=metro_body(s,profile,.10,fz,nz,[((BAND0+BAND1)/2,BAND1-BAND0,'tblue')])
 metro_black_face(s,f,H-.08)
 return f

def c321(s):
 """C321（西門子 SGP）。參考：Commons「C321 Bannan BL02 20260108.jpg」「C321 at Zhongxiao Xinsheng 20250906.jpg」（Sinsyuan，CC BY-SA 4.0）、
 「C321 modern version at Ximen Station 20250718 T1445.jpg」（Daniel.yin2，CC BY-SA 4.0）。外觀跟 C341 幾乎相同，靠車號辨認。"""
 return c321_like(s)

def c341(s):
 """C341（西門子 SGP，銘板 2003）。參考：Commons「C341 1201 at Ximen Station 20060531.jpg」（蒼空 翔，CC BY-SA 3.0）、
 「Siemens SGP Verkehrstechnik 2003 plate on Taipei MRT train 341.jpg」（Solomon203，CC BY-SA 3.0）。外觀跟 C321 同一家族。"""
 return c321_like(s)

def c371(s):
 """C371（川崎／台灣車輛）。參考：Commons「Kawasaki-TRSC C371 EMU.jpg」（Samson Ng，CC BY-SA 4.0）、
 「3-car C371 at Qizhang station 20250912.jpg」（Sinsyuan，CC BY-SA 4.0）。車頭上緣圓弧後收，黑色窗區兩側留窄不鏽鋼柱、頂端圓角大。"""
 L,W,H=s['L'],s['W'],s['H'];metro_colours()
 profile=[(.83,L/2-.08),(1.00,L/2),(2.20,L/2-.02),(2.90,L/2-.10),(H-.18,L/2-.24),(H,L/2-.52)]
 fz,nz=black_face_zones(s)
 f,neck,doors=metro_body(s,profile,.08,fz,nz,[((BAND0+BAND1)/2,BAND1-BAND0,'tblue')])
 metro_black_face(s,f,H-.10,panel_w=W-.22,face_r=.32)
 return f

def c381(s):
 """C381（川崎／台灣車輛）。參考：Commons「Taipei-MRT C381 20130908.jpg」（Rsa，CC BY-SA 3.0）、「C301 & C381 at Beitou Station 20150721.jpg」（James970028，CC BY-SA 3.0）、
 「Kawasaki-TRSC C381 EMU.jpg」（Samson Ng，CC BY-SA 4.0）。銀色圓鼓車頭，上緣一圈黑帶；三片前窗各自有黑框、中間隔銀色窗柱，中央是逃生門（略偏左）。
 粗藍帶從兩側燈座內緣斜下到中央成 V 字，下方一條細藍線；兩角各一個燈座（內白外紅）；黑帶上兩角琥珀燈、中央紅色標識燈；深灰防爬器。
 高度依正面照（Rsa）量：黑帶 H-.31 以上、窗 1.97–2.97、側面粗藍帶 1.58–1.76、細線 1.47–1.51、防爬器 1.19–1.31。"""
 L,W,H=s['L'],s['W'],s['H'];metro_colours()
 color('c381silver','D4D9DB',.42,.30,.25)
 profile=[(.83,L/2-.30),(1.00,L/2-.12),(1.35,L/2),(2.10,L/2-.02),(2.80,L/2-.15),(H-.20,L/2-.34),(H,L/2-.62)]
 s['bowPow']=2.4;top=H-.31
 f,neck,doors=metro_body(s,profile,.30,[(top,'c381silver'),(H+1,'frame')],
  [(1.47,'c381silver'),(1.51,'tblue'),(1.58,'c381silver'),(1.76,'tblue'),(H-.12,'c381silver'),(H+1,'troof')],[(1.67,.18,'tblue'),(1.49,.04,'tblue')])
 hw=W/2-.20;lo=lambda y:1.97+.05*(abs(y)/hw)**2
 for a,b,name in [(-1.16,-.62,'左側前窗'),(-.45,.29,'逃生門窗'),(.45,1.10,'司機前窗')]:
  front_patch(name+'黑框',f,a-.05,b+.05,lambda y:lo(y)-.05,top+.02,'frame',.030,cols=12,rows=4)
  front_patch(name,f,a,b,lo,H-.38,'glass',.046,cols=12,rows=4)
 for y in [-.53,.37]:front_patch('逃生門下半門縫',f,y-.010,y+.010,1.31,lo(y)-.05,'frame',.036,cols=1,rows=8)
 front_panel('目的地顯示器',f,-.89,H-.50,.44,.10,'dark',.02,.060);front_panel('目的地字幕',f,-.89,H-.50,.34,.05,'led',.01,.066)
 text_label(s['label'],(f(-.89,2.15)+.075,-.89,2.15),.07)
 yk=.62;e=W/2-.03
 t=lambda y:min(1,abs(y)/yk)
 front_patch('車頭藍色 V 帶',f,-e,e,lambda y:1.42+.16*t(y),lambda y:1.57+.19*t(y),'tblue',.034,cols=48,rows=3)
 front_patch('車頭細藍線',f,-e,e,1.47,1.51,'tblue',.033,cols=24,rows=1)
 for side in [-1,1]:
  lamp_pair(f,side*.88,1.62,True,r=.056,gap=.24,hw=.52,hh=.22)
  lamp_color('上部琥珀標識燈',f,side*.80,H-.29,.032,'amber')
 lamp_color('上部中央紅色標識燈',f,-.08,H-.24,.034,'red')
 for y in [-.89,.78]:wiper(f,y,2.05,.60)
 front_panel('深灰防爬器',f,0,1.25,W-.30,.12,'chassis',.04,.10)
 return f

# ── 台鐵區間車 ──────────────────────────────────────────────────────────────

def face_zmax(s,y,m=.03):
 """車頭面在橫向 y 處最高到哪（車頂圓角讓兩側變矮），貼片上緣用它才不會飄出車殼。"""
 W,H=s['W'],s['H'];rt=s.get('radiusTop',.40);a=abs(y)+m;c=W/2-rt
 return H-m if a<=c else H-rt+math.sqrt(max(0,rt*rt-(a-c)**2))-m

def emu500_like(s,tour=False):
 """EMU500／EMU600 與海風號、山嵐號共用車體：平頭、中央貫通門、兩側前窗、車頂前緣中央雙頭燈座、雨刷從窗頂往下掛。
 參考：Commons「TRA EM510 20130313.jpg」「TRA EMU609 20160714.jpg」「TRA EMU583 SHANLAN Changhua Station 20260719.jpg」、
 官方示意圖「海風號及山嵐號列車外觀設計示意圖.png」（作者與授權見 catalog-source.json）。
 EMU500／EMU600：藍色車頭、貫通門外凸一圈門框、門窗下一塊白牌（不放標誌）；窗下兩條白細線，內端在內側頭燈上方往下彎；
 兩角是藏青圓燈座的紅燈（外）與鍍鉻圈白燈（內），下緣黃黑警戒斜紋；不鏽鋼車身下半部橫向壓紋、窗下兩道藍線。
 海風號／山嵐號（tour）：門框拆掉、貫通門平貼車身，門窗跟兩側前窗同高；整車上色、下緣漸層到白，燈在白色燈座裡，黑色下裙。"""
 L,W,H=s['L'],s['W'],s['H']
 color('e5stain','BAC4C7',.50,.32,.12);color('e5blue','2A5CB4',.08,.34,.30);color('e5frame','76695A',.35,.40,.10);color('e5navy','1F2C55',.10,.40,.20)
 profile=[(.83,L/2-.04),(1.00,L/2),(H-.30,L/2-.02),(H,L/2-.22)]
 if not tour:
  color('e5roof','6E5A4C',.30,.50,.05);body=leaf='e5stain';front='e5blue'
  zones=[(H-.12,body),(H+1,'e5roof')];fz=[(H+1,front)];nz=[(H-.12,front),(H+1,'e5roof')]
  bands=leafbands=[(1.86,.06,'e5blue'),(1.725,.03,'e5blue')]
 else:
  color('e5roof','C4C7C7',.30,.45,.06);front=leaf=color('e5tour',s['body'],.06,.36,.28)
  grad=ramp('e5g',[(0,'F4F4F0'),(1,s['body'])],6);cuts=[.95+.65*(i+1)/6 for i in range(6)];zg=list(zip(cuts,grad))
  zones=zg+[(H-.12,front),(H+1,'e5roof')];fz=zg+[(H+1,front)];nz=zones;bands=[]
  leafbands=[((a+b)/2,b-a,g) for a,b,g in zip([.92]+cuts[:-1],cuts,grad)]
 f,neck,doors=emu_body(s,profile,.06,zones,fz,nz,leaf=leaf,gaps=[1,2,2,1],bands=bands,leafbands=leafbands)
 if not tour:
  use('01')
  for k in range(11):
   for side in [-1,1]:box('下半部橫向壓紋',((-L/2+.10+neck-.10)/2,side*(W/2+.006),1.04+k*.06),(neck-.20+L/2-.10,.010,.020),'e5stain',.003)
 wz0,wz1=(1.96,2.78) if not tour else (1.94,2.84);wz=(wz0+wz1)/2
 if not tour:
  front_panel('貫通門門框',f,0,(1.00+H-.12)/2,1.10,H-.12-1.00,'e5frame',.04,.030)
  front_panel('貫通門門扇',f,0,(1.05+H-.30)/2,.78,H-.30-1.05,front,.03,.044)
  front_panel('貫通門窗',f,0,2.33,.40,.75,'glass',.06,.056)
  front_panel('貫通門白牌',f,0,1.67,.56,.34,'white',.03,.052)
 else:
  for y in (-.33,.33):front_patch('貫通門門縫',f,y-.006,y+.006,1.02,wz1+.10,'frame',.034,cols=1,rows=8)
  front_patch('貫通門門縫',f,-.33,.33,wz1+.094,wz1+.106,'frame',.034,cols=8,rows=1)
  front_panel('貫通門窗窗框',f,0,wz,.56,wz1-wz0+.06,'frame',.08,.036);front_panel('貫通門窗',f,0,wz,.50,wz1-wz0,'glass',.07,.048)
 for a,b,name in [(-1.26,-.62,'左前窗'),(.62,1.26,'司機前窗')]:
  front_panel(name+'窗框',f,(a+b)/2,wz,b-a+.06,wz1-wz0+.06,'frame',.08,.036)
  front_panel(name,f,(a+b)/2,wz,b-a,wz1-wz0,'glass',.07,.048)
 for side in [-1,1]:
  wiper(f,side*.98,wz1-.05,-.50)
  if not tour:
   for zc,h,yv in [(1.86,.06,.70),(1.725,.03,.80)]:
    y0,y1=sorted([side*(W/2-.01),side*yv]);front_patch('窗下白細線',f,y0,y1,zc-h/2,zc+h/2,'white',.034,cols=12,rows=1)
    y0,y1=sorted([side*yv,side*(yv+h)]);front_patch('白細線下彎',f,y0,y1,1.54,zc+h/2,'white',.034,cols=1,rows=4)
   front_panel('尾燈燈座',f,side*1.00,1.44,.24,.24,'e5navy',.12,.030)
   lamp('尾燈',f,side*1.00,1.44,.070,red=True);lamp('頭燈',f,side*.72,1.44,.058)
  else:lamp_pair(f,side*.88,1.46,True,True,.060,.24,'white',.46,.22)
 front_panel('目的地顯示器',f,.92,H-.22,.30,.12,'white',.03,.050);front_panel('目的地字幕',f,.92,H-.22,.20,.04,'dark',.01,.056)
 if s.get('label'):
  front_panel('車號牌',f,-.94,wz1-.10,.42,.10,'white',.02,.056)
  text_label(s['label'],(f(-.94,wz1-.10)+.070,-.94,wz1-.10),.060)
 # 車頂前緣中央的雙頭燈座：盒子坐在車頂上，兩顆圓燈朝前
 use('03');xf=L/2-.22;box('車頂頭燈座',(xf-.14,0,H+.07),(.30,.70,.24),'frame' if not tour else 'e5roof',.04)
 for y in [-.16,.16]:lamp('車頂頭燈',lambda yy,zz:xf-.07,y,H+.07,.080)
 if tour:box('黑色下裙',(L/2-.02,0,.74),(.10,W*.90,.30),'frame',.02)
 else:hazard(L/2+.03,W,.82,.34)
 return f

def emu500(s):return emu500_like(s)
def emu600(s):return emu500_like(s)
def haifeng(s):return emu500_like(s,True)
def shanlan(s):return emu500_like(s,True)

def emu800_like(s,inverse=False):
 """EMU800（日本車輛／台灣車輛）。參考：Commons「TRA-EMU800-2013-08-27-0003(車頭1).JPG」「TRA EMU882 in Douliu Station 2017-07-17.jpg」（作者與授權見 catalog-source.json）。
 長車鼻：銀色下巴往前凸、面罩往後傾；面罩（藍，反色版黃）被一圈黃（反色版藍）框住，框在下緣彎成微笑弧線、兩側沿車頭邊緣上到車頂；
 面罩上緣三顆頭燈（中間橫長）、大片前窗、窗下四顆圓燈（內白外紅）；下巴兩個通風格柵、中縫是車鉤蓋。車側窗下黃、藍兩條線。"""
 L,W,H=s['L'],s['W'],s['H']
 color('e8silver','BFC6CA',.50,.30,.15);color('e8blue','2A46B0',.06,.32,.32);color('e8yellow','F7C600',.04,.30,.30);color('e8roof','A9AFB2',.40,.42,.08)
 mask,trim=('e8yellow','e8blue') if inverse else ('e8blue','e8yellow')
 profile=[(.83,L/2-.30),(.95,L/2-.10),(1.15,L/2),(1.45,L/2-.03),(1.70,L/2-.14),(2.10,L/2-.40),(2.80,L/2-.78),(3.20,L/2-.98),(H,L/2-1.10)]
 s['bowPow']=2.2
 bands=[(1.95,.06,'e8yellow'),(1.89,.06,'e8blue')]
 nz=[(1.86,'e8silver'),(1.92,'e8blue'),(1.98,'e8yellow'),(H-.12,'e8silver'),(H+1,'e8roof')]
 f,neck,doors=emu_body(s,profile,.45,[(H-.12,'e8silver'),(H+1,'e8roof')],[(H+1,'e8silver')],nz,leaf='e8silver',gaps=[1,2,2,1],bands=bands,leafbands=bands)
 m=W/2-.28;slo=lambda y:1.48+.45*(abs(y)/m)**2.4;shi=lambda y:slo(y)+.30;zt=lambda y:face_zmax(s,y,.04)
 front_patch('車頭面罩',f,-m,m,lambda y:shi(y)-.01,zt,mask,.030,cols=40,rows=12)
 front_patch('微笑色帶',f,-(m+.22),m+.22,slo,shi,trim,.033,cols=48,rows=4)
 for side in [-1,1]:
  a,b=sorted([side*(m-.01),side*(m+.22)])
  front_patch('車頭側緣色帶',f,a,b,lambda y:slo(y)+.05,zt,trim,.033,cols=4,rows=14)
 gw=1.05;top=lambda y:3.04-.05*(abs(y)/gw)**4
 front_patch('前窗黑框',f,-gw-.05,gw+.05,2.35,lambda y:top(y)+.05,'frame',.038,cols=24,rows=6)
 front_patch('前窗玻璃',f,-gw,gw,2.40,top,'glass',.046,cols=24,rows=6)
 front_panel('目的地顯示器',f,.40,2.93,.70,.07,'dark',.01,.054)
 front_panel('車號牌',f,-.72,2.93,.40,.09,'frame',.02,.052);text_label(s['label'],(f(-.72,2.93)+.072,-.72,2.93),.06)
 for y,w in [(-.76,.30),(0,.40),(.76,.30)]:
  front_panel('上方頭燈框',f,y,H-.22,w,.18,'frame',.08,.034);front_panel('上方頭燈',f,y,H-.22,w-.08,.11,'lamp',.05,.046)
 for side in [-1,1]:
  lamp('尾燈',f,side*.72,2.11,.098,red=True);lamp('頭燈',f,side*.36,2.11,.098)
  wiper(f,side*.45,2.46,.50)
  front_panel('下巴通風格柵',f,side*.55,1.12,.30,.13,'frame',.03,.030)
  for k in range(4):front_panel('格柵條',f,side*.55,1.07+k*.03,.26,.010,'chassis',.003,.036)
 front_patch('下巴中縫',f,-.006,.006,.90,1.40,'frame',.032,cols=1,rows=6)
 return f

def emu800(s):return emu800_like(s)
def emu800r(s):return emu800_like(s,True)

def rounded_top(top,m,r):
 """圓角上緣：|y| 在 m-r 以內是 top，外側照半徑 r 的圓弧往下收（面罩、前窗、開口的上角用）。"""
 return lambda y:top if abs(y)<=m-r else top-r+math.sqrt(max(0,r*r-(abs(y)-(m-r))**2))

def side_patch(name,s,f,side,x0,lo,hi,material,offset=.023,cols=14,rows=4):
 """貼在駕駛室側面（|y|=W/2 的平面）的色塊：從 x0 往前一路到車頭曲面邊緣；上下緣可以是常數或 x 的函式。"""
 use('01');W=s['W'];lo_=lo if callable(lo) else (lambda x:lo);hi_=hi if callable(hi) else (lambda x:hi);verts=[]
 xe=lambda z:f(W/2,z)-.004;xn=xe((lo_(x0)+hi_(x0))/2)
 for i in range(rows+1):
  for j in range(cols+1):
   u=j/cols;xx=x0+(xn-x0)*u;z=lo_(xx)+(hi_(xx)-lo_(xx))*i/rows;verts.append((x0+(xe(z)-x0)*u,side*(W/2+offset),z))
 faces=[(i*(cols+1)+j,i*(cols+1)+j+1,(i+1)*(cols+1)+j+1,(i+1)*(cols+1)+j) for i in range(rows) for j in range(cols)]
 return mesh(name,verts,faces,material,0,True)

def face_label(value,f,y,z,offset,size=.06,tilt=False):
 """車頭弧面上的字牌：字面順著該處的水平切線轉，兩端才不會陷進後面的牌子或玻璃；tilt 再順著垂直斜度往後倒（前窗往後倒的車頭用）。"""
 o=text_label(value,(f(y,z)+offset,y,z),size);k=(f(y+.01,z)-f(y-.01,z))/.02
 t=Matrix.Rotation(math.atan((f(y,z+.01)-f(y,z-.01))/.02),3,'Y') if tilt else Matrix.Identity(3)
 o.rotation_euler=(Matrix.Rotation(-math.atan(k),3,'Z')@t@o.rotation_euler.to_matrix()).to_euler();return o

def emu900(s):
 """EMU900（現代 Rotem）。參考：Commons「TRA EMU900 running a local train service on the Western Line.jpg」（jason199567，CC BY-SA 4.0，正面）、
 「EMU900 Yingge Station 20260108.jpg」「EMU900 Yingge Station 20260108 (2).jpg」（Sinsyuan，CC BY-SA 4.0，斜側）、「臺鐵EMU900型電聯車於現代工廠.jpg」（側面）。
 車頭上半是一整片黑色面罩，前窗融在黑裡：頂端中央綠字目的地、上方兩角各一顆圓頭燈、左上車號牌；窗下黑面罩兩側斜放煙燻燈座（各兩顆圓燈），
 下緣一條白色 LED 燈帶；燈座外側是嫩綠側頰，繞過車角接成車側窗下的綠帶，綠帶在駕駛室側面往前上揚；面罩以下銀色，中央開口露出車鉤。
 駕駛室後面是長圓窗與乘務員門（門兩側扶手、門頂雨水槽）。高度依正面照量：面罩 1.52–3.38、前窗下緣 2.36、燈帶 1.60–1.71、側頰在車角 1.60–1.90。"""
 L,W,H=s['L'],s['W'],s['H']
 color('e9silver','C3C9CC',.50,.30,.15);color('e9roof','B4BBBE',.40,.42,.08);color('e9black','14181B',.20,.22,.45)
 color('e9smoke','3A434A',.25,.18,.50);color('e9green','8DC63F',.05,.34,.30);color('e9led','5BE38F',.05,.30,.20)
 profile=[(.83,L/2-.10),(1.00,L/2),(1.50,L/2-.01),(2.30,L/2-.08),(2.90,L/2-.24),(3.20,L/2-.36),(H-.10,L/2-.46),(H,L/2-.62)]
 s['bowPow']=2.4;band=[(1.64,.32,'e9green')]
 f,neck,doors=emu_body(s,profile,.32,[(H-.12,'e9silver'),(H+1,'e9roof')],[(H+1,'e9silver')],[(H-.12,'e9silver'),(H+1,'e9roof')],
  leaf='e9silver',gaps=[1,2,2,0],bands=band,leafbands=band)
 # 駕駛室側面：綠帶往前上揚接到車角；長圓窗、乘務員門、門頂雨水槽
 x0=neck-.35;xc=f(W/2,1.8)
 for side in [-1,1]:
  side_patch('駕駛室側面綠帶',s,f,side,x0,1.48,lambda x:1.80+.12*min(1,max(0,(x-x0)/(xc-x0)))**2,'e9green')
  y=side*(W/2+.018);cx=neck-.62;use('02')
  sidewindow(neck-.25,y,2.45,.20,.70,r=.10)
  panel('乘務員門框',(cx,y,1.90),.46,1.94,'frame',r=.03)
  c=panel('乘務員門扇',(cx,y+side*.022,1.90),.40,1.88,'e9silver',r=.025,depth=.022);c['side_door']=True;c['crew_door']=True
  panel('乘務員門窗',(cx,y+side*.045,2.38),.18,.92,'glass',r=.06,depth=.012)
  for dx in [-.28,.28]:rod('乘務員扶手',(cx+dx,y+side*.06,1.35),(cx+dx,y+side*.06,2.45),.016,'metal')
  for x,w in [(cx,.52)]+[(d,s.get('doorW',.80)+.14) for d in doors]:box('門頂雨水槽',(x,side*(W/2+.03),s['doorTop']+.07 if x!=cx else 2.92),(w,.03,.03),'e9silver',.01)
 # 黑色面罩（前窗融在裡面）與前窗玻璃
 m=1.08;front_patch('黑色面罩',f,-m,m,lambda y:1.52+.10*(abs(y)/m)**4,rounded_top(H-.07,m,.40),'e9black',.030,cols=40,rows=16)
 front_patch('前窗玻璃',f,-1.00,1.00,2.36,rounded_top(H-.10,1.00,.36),'glass',.040,cols=32,rows=8)
 front_panel('目的地顯示器',f,0,3.17,.92,.24,'dark',.03,.046);front_panel('目的地字幕',f,0,3.17,.70,.07,'e9led',.01,.052)
 front_panel('車號牌',f,-.70,2.95,.42,.10,'dark',.02,.050);face_label(s['label'],f,-.70,2.95,.066)
 for side in [-1,1]:
  front_panel('上方頭燈燈座',f,side*.67,3.19,.24,.24,'e9smoke',.12,.044);lamp('上方頭燈',f,side*.67,3.19,.075)
  a,b=sorted([side*.62,side*1.10]);front_patch('煙燻燈座',f,a,b,lambda y:1.66+(abs(y)-.62)*.50,lambda y:1.96+(abs(y)-.62)*.36,'e9smoke',.036,cols=10,rows=6)
  lamp('頭燈',f,side*.95,1.98,.070);lamp('頭燈',f,side*.76,1.83,.070)
  a,b=sorted([side*1.08,side*(W/2-.004)]);t=lambda y:(abs(y)-1.08)/(W/2-1.084)
  front_patch('嫩綠側頰',f,a,b,lambda y:1.74-.14*t(y),lambda y:2.12-.22*t(y)**.8,'e9green',.033,cols=10,rows=6)
 for a,b in [((-.10,2.40),(-.86,2.47)),((.76,2.40),(0,2.47))]:
  use('03');line('雨刷',[(f(*a)+.055,*a),(f(*b)+.055,*b)],.013,'frame')
 front_patch('白色 LED 燈帶',f,-.58,.58,lambda y:1.60+max(0,abs(y)-.50)*.9,1.71,'lamp',.040,cols=24,rows=2)
 front_patch('中央車鉤開口',f,-.66,.66,.84,rounded_top(1.46,.66,.16),'frame',.028,cols=20,rows=6)
 return f

def emu700(s):
 """EMU700（日本車輛／台灣車輛）。參考：Commons「TRA EMU700 running a local train service on the Western Line approaching Wudu Station.jpg」（jason199567，CC BY-SA 4.0，正面）、
 「EMU700 at Daqing Station 20240204.jpg」「20230505 TRA EMU700 at Zhunan Station 01.jpg」（鐵路1，CC BY-SA 4.0）。
 平直的白色車頭，左右緣一條橘色外框、車角與駕駛室側面藍色；大片圓角前窗加黑框，頂端中央藥丸形雙頭燈座、右上紅字目的地顯示；
 窗下四顆鍍鉻圈圓燈（外紅內白）；下巴往前凸、橘色月牙形，下方藍色裙部，右下一個小通風格柵。車側不鏽鋼，車頂邊一條藍帶、窗下粗藍帶加一條細橘線。
 高度依正面照量：前窗黑框 2.20–3.00、窗下燈 2.00、橘色下巴上緣 1.97、月牙下緣中央 1.50／兩側 1.81。"""
 L,W,H=s['L'],s['W'],s['H']
 color('e7stain','C2C8CB',.50,.30,.15);color('e7roof','A9B0B3',.40,.42,.08);color('e7white','E3E6E4',.08,.34,.25)
 color('e7blue','1F4FA8',.08,.34,.30);color('e7orange','F39A2A',.05,.32,.30);color('e7led','E8452E',.10,.25,.30)
 profile=[(.83,L/2-.22),(1.10,L/2-.12),(1.40,L/2-.03),(1.62,L/2),(1.86,L/2),(1.95,L/2-.12),(2.00,L/2-.13),(3.00,L/2-.18),(H-.16,L/2-.24),(H,L/2-.44)]
 s['bowPow']=3;bands=[(1.93,.30,'e7blue'),(1.68,.07,'e7orange')]
 f,neck,doors=emu_body(s,profile,.20,[(3.20,'e7stain'),(3.34,'e7blue'),(H+1,'e7roof')],[(1.50,'e7blue'),(1.97,'e7orange'),(H+1,'e7white')],
  [(H-.12,'e7blue'),(H+1,'e7roof')],leaf='e7stain',gaps=[1,2,2,1],bands=bands,leafbands=bands)
 # 橘色下巴是月牙形：兩側下緣比中央高，外側補回藍色
 for side in [-1,1]:
  a,b=sorted([side*.20,side*(W/2-.004)]);front_patch('下巴月牙外側藍色',f,a,b,1.49,lambda y:max(1.495,1.50+.31*(abs(y)/(W/2))**2),'e7blue',.030,cols=16,rows=3)
  top=lambda y:min(3.25,face_zmax(s,y,.06))
  a,b=sorted([side*1.22,side*1.31]);front_patch('車頭橘色外框',f,a,b,2.00,top,'e7orange',.030,cols=2,rows=14)
  a,b=sorted([side*1.31,side*(W/2-.004)]);front_patch('車角藍色',f,a,b,2.00,lambda y:face_zmax(s,y,.03),'e7blue',.030,cols=3,rows=14)
 front_panel('前窗黑框',f,0,2.60,2.42,.80,'frame',.13,.030);front_panel('前窗玻璃',f,0,2.60,2.32,.70,'glass',.10,.040)
 face_label(s['label'],f,-.85,2.86,.058)
 front_panel('頂部頭燈座',f,0,3.16,.62,.22,'frame',.11,.034)
 for y in [-.15,.15]:lamp('頂部頭燈',f,y,3.16,.070)
 front_panel('目的地顯示器',f,.76,3.11,.54,.20,'frame',.03,.034);front_panel('目的地字幕',f,.76,3.11,.40,.06,'e7led',.01,.042)
 for side in [-1,1]:lamp('尾燈',f,side*.88,2.00,.085,red=True);lamp('頭燈',f,side*.60,2.00,.085)
 for a,b in [((-.30,2.24),(-.95,2.40)),((.58,2.24),(-.07,2.40))]:
  use('03');line('雨刷',[(f(*a)+.055,*a),(f(*b)+.055,*b)],.013,'frame')
 front_panel('下方通風格柵',f,.84,1.16,.30,.11,'frame',.02,.030)
 for k in range(3):front_panel('格柵條',f,.84,1.13+k*.03,.26,.010,'chassis',.003,.036)
 return f

def pinch(lo,hi,y0,y1,r):
 """把 front_patch 的上下緣在 y0、y1 兩端收成半徑 r 的圓角（燈座、眼睛這種圓角梯形用）。"""
 def d(y):e=min(y-y0,y1-y);return 0 if e>=r else r-math.sqrt(max(0,r*r-(r-e)**2))
 return (lambda y:lo(y)+d(y)),(lambda y:hi(y)-d(y))

def temu1000(s):
 """TEMU1000 太魯閣（日立）。參考：Commons「2019-07-19 TEMU1000 on the Western Line (Northern Section).jpg」（魏 子棋，Public domain，正面）、
 「A TRA Taroko Express at Xizhi Station.jpg」「TRA TEMU1000 "Taroko" Express at Changhua Station 2007-01-20.jpg」（Cheng-en Cheng，CC BY-SA 2.0，斜側與車側）、
 「北迴線 (35177226555).jpg」（billy1125，CC BY 2.0，駕駛車側面）。
 鈍圓的長車鼻、前窗往後倒；前窗連同上方一整片黑色遮陽面，頂端中央凸出雙頭燈座、左上目的地顯示；窗下兩個煙燻「眼睛」燈座往中央下斜；
 橘帶從車側窗帶下緣沿駕駛室往下掃，到車頭變成往下彎的笑臉弧；下巴是一大片 U 形車鉤蓋（中間分縫）。車側白色、深灰連續窗帶、每側兩扇單開塞拉門。
 高度依正面照量：前窗下緣 2.37、眼睛 2.08–2.39、頭燈座 3.07–3.33、黑色遮陽面頂端 3.34；車側窗帶與橘帶照彰化站側面照的比例。"""
 L,W,H=s['L'],s['W'],s['H']
 color('t1white','EEF0EC',.08,.32,.25);color('t1roof','C9CDCB',.40,.42,.08);color('t1grey','4A5054',.20,.25,.40)
 color('t1orange','EF7D22',.05,.32,.30);color('t1black','15191C',.20,.22,.45);color('t1smoke','343B41',.25,.18,.50)
 profile=[(.83,L/2-.34),(1.00,L/2-.10),(1.30,L/2-.01),(1.55,L/2),(1.90,L/2-.05),(2.20,L/2-.14),(2.50,L/2-.30),(2.80,L/2-.52),(3.05,L/2-.76),(3.25,L/2-.98),(H,L/2-1.20)]
 s['bowPow']=2.0;stripe=(1.825,.25,'t1orange')
 f,neck,doors=emu_body(s,profile,.80,[(H-.12,'t1white'),(H+1,'t1roof')],[(H+1,'t1white')],[(H-.12,'t1white'),(H+1,'t1roof')],
  leaf='t1white',gaps=[0,6,1],bands=[stripe],leafbands=[stripe])
 # 深灰窗帶只到最前面那扇客室窗，後面留白（實車貼列車名）；駕駛室側窗另做
 x1=neck-s['cabWin']+.06;y=half_width(s,2.25)+.012
 for side in [-1,1]:
  box('深灰窗帶',((-L/2+.06+x1)/2,side*y,2.25),(x1+L/2-.06,.020,.60),'t1grey',.004)
  sidewindow(neck+.08,side*(W/2+.018),2.66,.34,.42,r=.10)
  x0=neck+.02;xc=f(W/2,1.65);t=lambda x:min(1,max(0,(x-x0)/(xc-x0)))**1.3
  side_patch('駕駛室側面橘帶',s,f,side,x0,lambda x:1.70-.08*t(x),lambda x:1.95-.20*t(x),'t1orange')
 # 黑色遮陽面（前窗在裡面）、前窗玻璃、目的地顯示
 m=1.36;front_patch('黑色遮陽面',f,-m,m,lambda y:2.37+.10*max(0,(abs(y)-1.24)/.12)**2,lambda y:3.34-.30*(abs(y)/m)**3,'t1black',.030,cols=40,rows=14)
 front_patch('前窗玻璃',f,-1.24,1.24,lambda y:2.44+.08*max(0,(abs(y)-1.12)/.12)**2,lambda y:3.06-.16*(abs(y)/1.24)**3,'glass',.038,cols=32,rows=8)
 front_panel('目的地顯示器',f,-.79,3.00,.60,.10,'dark',.02,.046);face_label(s['label'],f,-.79,3.00,.062,.055,tilt=True)
 # 頂端雙頭燈座：凸出往後倒的前窗，前面是垂直面
 xf=f(0,3.08)+.06;box('頂部頭燈座',(xf-.22,0,3.205),(.44,.60,.27),'dark',.07)
 for y in [-.13,.13]:lamp('頂部頭燈',lambda yy,zz:xf-.075,y,3.205,.070)
 for a,b in [((-.61,2.50),(-1.17,2.76)),((.51,2.50),(1.14,2.69))]:
  use('03');line('雨刷',[(f(*a)+.055,*a),(f(*b)+.055,*b)],.013,'frame')
 # 煙燻「眼睛」燈座：外高內低的圓角梯形，各兩顆圓燈
 for side in [-1,1]:
  t=lambda y:(abs(y)-.52)/.58;lo,hi=pinch(lambda y:2.085+.145*t(y),lambda y:2.31+.065*t(y),.52,1.10,.06)
  a,b=sorted([side*.52,side*1.10]);front_patch('煙燻眼睛燈座',f,a,b,lambda y:lo(abs(y)),lambda y:hi(abs(y)),'t1smoke',.036,cols=14,rows=6)
  lamp('頭燈',f,side*.96,2.27,.055);lamp('頭燈',f,side*.70,2.22,.055)
 # 橘色笑臉弧與 U 形車鉤蓋分模線（中間分縫）
 front_patch('橘色笑臉弧',f,-W/2+.004,W/2-.004,lambda y:1.36+.26*(abs(y)/(W/2))**2,lambda y:1.49+.26*(abs(y)/(W/2))**2,'t1orange',.033,cols=40,rows=3)
 u=[(-1.0,1.88),(-.5,1.915),(0,1.925),(.5,1.915),(1.0,1.88),(1.0,1.45),(.96,1.25),(.85,1.08),(.62,.99),(.30,.96),(0,.955),(-.30,.96),(-.62,.99),(-.85,1.08),(-.96,1.25),(-1.0,1.45),(-1.0,1.88)]
 g=lambda y,z:f(y,z)-.046
 front_ribbon('U 形車鉤蓋分模線',g,u,.018,'frame');front_ribbon('車鉤蓋中縫',g,[(0,.955),(0,1.45)],.014,'frame')
 return f

def temu2000(s):
 """TEMU2000 普悠瑪（日本車輛）。參考：Commons「A Southbound TRA Puyuma express approaching North Hsinchu Station 02.jpg」（Tbatb，CC BY-SA 4.0，正面）、
 「2015-08-19 TEMU2000 on the Western Line (Northern Section).jpg」（魏子棋，Public domain，斜前方）、
 「A Southbound TRA Puyuma Express on Western Line south of Hsinchu Station 02.jpg」（Tbatb，CC BY-SA 4.0，車側）。
 楔形車鼻：下巴中央往前凸、前窗往後倒；紅色車頭從車頂一路收窄到下巴，車角與下巴兩側是白色臉頰。頂端左右各一個圓頭燈座、中間橘字目的地顯示；
 黑框前窗下緣中間往下彎，左上角貼車號；窗下兩個外高內低的眼睛燈座（外側白頭燈、內側紅尾燈）；下巴的 U 形黑色分模線框住往下收窄的紅色部分，中間分縫。
 車側白色、獨立車窗，窗下一粗一細兩條紅帶（中間隔一條白線），紅帶到駕駛室後那扇門為止。
 高度依正面照量：頭燈座 3.13–3.32、前窗 2.57（中央下緣）–3.05、眼睛 2.07–2.42、U 形框 0.97–2.03；車側紅帶照新竹站南側側面照的比例。"""
 L,W,H=s['L'],s['W'],s['H']
 color('t2white','F0F1EF',.08,.32,.25);color('t2roof','C9CDCB',.40,.42,.08);color('t2red','D42A35',.05,.32,.30)
 color('t2black','15191C',.20,.22,.45);color('t2smoke','2A3036',.25,.18,.50);color('t2amber','F5A23C',.10,.25,.30)
 profile=[(.83,L/2-.30),(1.00,L/2-.12),(1.25,L/2-.03),(1.50,L/2),(1.80,L/2-.03),(2.05,L/2-.10),(2.40,L/2-.22),(2.60,L/2-.32),(2.80,L/2-.46),(3.05,L/2-.64),(3.25,L/2-.78),(H,L/2-.90)]
 s['bowPow']=1.8;red=[(1.31,.30,'t2red'),(1.005,.09,'t2red')]
 f,neck,doors=emu_body(s,profile,.60,[(H-.12,'t2white'),(H+1,'t2roof')],[(H+1,'t2white')],[(H-.12,'t2white'),(H+1,'t2roof')],
  leaf='t2white',gaps=[0,0,0],leafbands=red)
 # 車側：獨立車窗（窗間白柱比窗窄一點）；紅帶到駕駛室後那扇門的前緣為止；駕駛室側窗
 dw=s['doorW'];u=doors[0]+dw/2+.12;v=doors[1]-dw/2-.12;p=(v-u)/7;x2=doors[1]+dw/2
 for side in [-1,1]:
  for i in range(7):sidewindow(u+p*(i+.5),side*(W/2+.018),s['winZ'],p*.60,s['winH'],r=.07)
  for z,h,m in red:box('側面紅帶',((-L/2+.06+x2)/2,side*(half_width(s,z)+.012),z),(x2+L/2-.06,.020,h),m,.004)
  sidewindow(neck+.10,side*(W/2+.018),2.62,.30,.42,r=.08)
 # 紅色車頭：從車頂往下收窄，車角留白；下巴的紅色在 U 形框裡往下收窄，兩側白色臉頰
 top=lambda y:face_zmax(s,y,.03)
 front_patch('紅色車頭',f,-1.40,1.40,lambda y:min(top(y)-.02,2.03+max(0,(abs(y)-1.10)/.30)**1.1),top,'t2red',.028,cols=48,rows=18)
 front_patch('紅色下巴',f,-1.0,1.0,lambda y:.99+max(0,abs(y)-.62)/.38*1.04,2.03,'t2red',.028,cols=30,rows=10)
 # 黑框前窗（下緣中間往下彎）、左上車號
 lo,hi=pinch(lambda y:2.57+.19*(y/1.33)**2,lambda y:3.05,-1.33,1.33,.10)
 front_patch('黑色前窗框',f,-1.33,1.33,lo,hi,'t2black',.034,cols=40,rows=8)
 lo,hi=pinch(lambda y:2.62+.19*(y/1.33)**2,lambda y:3.00,-1.27,1.27,.08)
 front_patch('前窗玻璃',f,-1.27,1.27,lo,hi,'glass',.040,cols=36,rows=8)
 face_label(s['label'],f,-.85,2.94,.050,.050,tilt=True)
 for a,b in [((-1.05,2.79),(-.20,2.66)),((0,2.66),(.85,2.75))]:
  use('03');line('雨刷',[(f(*a)+.055,*a),(f(*b)+.055,*b)],.013,'frame')
 # 頂端左右兩個圓頭燈座、中間目的地顯示
 for side in [-1,1]:
  a,b=sorted([side*.57,side*1.03]);lo,hi=pinch(lambda y:3.13,lambda y:3.32,.57,1.03,.095)
  front_patch('頂部頭燈座',f,a,b,lambda y:lo(abs(y)),lambda y:hi(abs(y)),'t2black',.036,cols=14,rows=5)
  lamp('頂部頭燈',f,side*.80,3.225,.070)
 front_panel('目的地顯示器',f,0,3.225,.60,.16,'t2black',.03,.040);front_panel('目的地字幕',f,0,3.225,.42,.05,'t2amber',.01,.048)
 # 眼睛燈座：外高內低，外側白頭燈、內側紅尾燈
 for side in [-1,1]:
  t=lambda y:(abs(y)-.28)/.76;lo,hi=pinch(lambda y:2.07+.06*t(y),lambda y:2.32+.10*t(y),.28,1.04,.09)
  a,b=sorted([side*.28,side*1.04]);front_patch('眼睛燈座',f,a,b,lambda y:lo(abs(y)),lambda y:hi(abs(y)),'t2smoke',.036,cols=16,rows=6)
  lamp('頭燈',f,side*.82,2.25,.060);lamp('尾燈',f,side*.50,2.20,.042,red=True)
 # 下巴 U 形分模線與中縫
 u=[(-1.0,2.03),(0,2.04),(1.0,2.03),(1.12,1.96),(1.15,1.80),(1.15,1.45),(1.11,1.20),(1.0,1.06),(.80,.99),(.40,.97),(0,.965),
  (-.40,.97),(-.80,.99),(-1.0,1.06),(-1.11,1.20),(-1.15,1.45),(-1.15,1.80),(-1.12,1.96),(-1.0,2.03)]
 g=lambda y,z:f(y,z)-.046
 front_ribbon('U 形下巴分模線',g,u,.020,'t2black');front_ribbon('下巴中縫',g,[(0,.965),(0,2.04)],.014,'t2black')
 return f

BUILDERS={'c301':c301,'c321':c321,'c341':c341,'c371':c371,'c381':c381,'emu500':emu500,'emu600':emu600,'haifeng':haifeng,'shanlan':shanlan,'emu800':emu800,'emu800r':emu800r,
 'emu900':emu900,'emu700':emu700,'temu1000':temu1000,'temu2000':temu2000}
