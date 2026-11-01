"""台灣車隊逐款建模。車殼與車側骨架在 refine_parts；車頭、塗裝、窗門配置每款各自給。
參考照片只在本機比對，檔名、作者、授權記在 catalog-source.json；不放營運商標，車號用可移除的示意字牌。"""
import math
import blender_parts as p
from blender_parts import *
from build_models import front_panel,front_ribbon,copy_rotated
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

def side_prism(name,pts,side,y,material,depth=.010):
 """車側平面上的凸多邊形色塊（pts 是 (x, z)），做成薄片實體，法線不會翻。"""
 use('01');n=len(pts);v=[(x,side*(y-depth),z) for x,z in pts]+[(x,side*y,z) for x,z in pts]
 return mesh(name,v,[tuple(range(n)),tuple(range(n,2*n))]+[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)],material)

def clip_poly(poly,g,lerp):
 """多邊形裁成 g(點) ≥ 0 的部分，邊上線性內插（lerp(a, b, t) 給內插點）。"""
 out=[]
 for a,b in zip(poly,poly[1:]+poly[:1]):
  ga,gb=g(a),g(b)
  if ga>=0:out.append(a)
  if (ga>=0)!=(gb>=0):out.append(lerp(a,b,ga/(ga-gb)))
 return out

# ── 台灣高鐵 700T ──────────────────────────────────────────────────────────────

def hermite(control):
 """形狀保持的三次 Hermite 插值（fleet-v1 shinkansen_shell 同一套，參數個數不限）：control=[(x, 參數…), ...] → shape(x)。"""
 h=[b[0]-a[0] for a,b in zip(control,control[1:])];slopes=[]
 for k in range(1,len(control[0])):
  d=[(b[k]-a[k])/v for a,b,v in zip(control,control[1:],h)];m=[d[0]]
  for i in range(1,len(control)-1):
   if d[i-1]*d[i]<=0:m.append(0)
   else:w1=2*h[i]+h[i-1];w2=h[i]+2*h[i-1];m.append((w1+w2)/(w1/d[i-1]+w2/d[i]))
  m.append(d[-1]);slopes.append(m)
 def shape(x):
  for i,(a,b) in enumerate(zip(control,control[1:])):
   if x<=b[0]:
    t=min(1,max(0,(x-a[0])/h[i]))
    return [(2*t**3-3*t*t+1)*a[k]+(t**3-2*t*t+t)*h[i]*slopes[k-1][i]+(-2*t**3+3*t*t)*b[k]+(t**3-t*t)*h[i]*slopes[k-1][i+1] for k in range(1,len(a))]
  return list(control[-1][1:])
 return shape

def loaf_dims(w,zb,zt,rb,rt):
 hw=max(w/2,1e-4);h=max(zt-zb,1e-4);rb=min(rb,hw*.95,h*.45);return hw,rb,min(rt,hw),max(1e-4,min(rt,h-rb))

def loaf(w,zb,zt,rb,rt,nb=4,nt=8):
 """平底小圓角、上緣大圓角的車殼斷面，由底部中央繞一圈；斷面矮的時候上圓角壓成橢圓。"""
 hw,rb,ay,az=loaf_dims(w,zb,zt,rb,rt)
 half=[(0,zb),((hw-rb)/2,zb)]+[(hw-rb+rb*math.cos(a),zb+rb+rb*math.sin(a)) for a in [math.pi*(i/nb-1)/2 for i in range(nb+1)]]
 half+=[(hw,zb+rb+(zt-az-zb-rb)*t) for t in (1/3,2/3)]+[(hw-ay+ay*math.cos(a),zt-az+az*math.sin(a)) for a in [math.pi*i/nt/2 for i in range(nt+1)]]
 half+=[((hw-ay)/2,zt),(0,zt)]
 return half+[(-y,z) for y,z in reversed(half[1:-1])]

def t700(s):
 """700T（川崎重工）。參考：Commons「THSR 700T frontnose 20130807.jpg」（Rsa，CC BY-SA 3.0，駕駛車正側面）、「THSR 700T 126-12 20130807.jpg」「THSR 700T 126-11 20130807.jpg」（Rsa，CC BY-SA 3.0，色帶結構與中間車高度）、
 「Shinkansen 700T.jpg」（Graham2000，Public domain，正面）、「THSR 700T Front view.jpg」（Alec @ Taiwan，CC BY 2.0，斜前方）、「THSR 700T trains at Yanchao Workshop 20080404.jpg」（Chopstick，CC BY-SA 3.0，斜上方）。
 鴨嘴長車鼻：鼻尖在下、一路往後抬高到車頂；車鼻上方是黑色駕駛窗罩（從車殼切出來，包住車鼻兩肩、側面看得到一長條，後端幾乎直切、往前收到鼻上），
 白頭燈與紅尾燈在窗罩前端裡面；鼻蓋前段有一圈分模線。
 塗裝：橘帶上緣 1.92 全車一樣；駕駛室段橘色一路到深灰裙邊（1.22），在車鼻變成往下包的 U 形；客室段只剩窄橘帶 1.65–1.92，上面壓一條黑線（前端削尖、在駕駛室門後收掉），
 下面白色；駕駛室門後有一塊黑色楔形（前緣從裙邊彎上來、後緣斜切）。小圓角獨立窗 2.10–2.52；每側兩扇單開門（車尾、駕駛室後），門上緣 2.80：車殼肩部從 2.70 往內收，平板門再高會從肩部凸出來。
 高度照正側面照量（車頂 3.25、裙邊 0.83 定比例），車鼻長度壓到約六成。地圖的中間車是鏡射 x<0 半車做的，所以只屬於車頭的東西全放 x>0。"""
 L,W,H=s['L'],s['W'],s['H'];tip=L/2-.12
 color('t7white','E9EAE4',.08,.30,.30);color('t7orange','EB7A26',.05,.30,.32);color('t7black','16191C',.20,.22,.45)
 color('t7skirt','4B5155',.30,.36,.15);color('t7canopy','1A2128',.12,.42,0);color('t7seam','9AA0A0',.20,.40,.10)
 # (x, 寬, 底, 頂, 下圓角, 上圓角)：車頂與鼻底照正側面照的輪廓，寬度照斜上方照片估
 shape=hermite([(-L/2,W,.83,H,.16,.55),(0,W,.83,H,.16,.55),(.80,W,.83,3.235,.16,.55),(1.25,2.82,.83,3.214,.17,.56),(1.70,2.77,.84,3.154,.18,.57),
  (2.15,2.69,.851,3.078,.19,.58),(2.47,2.58,.875,2.988,.20,.59),(2.83,2.40,.90,2.732,.21,.60),(3.06,2.25,.911,2.582,.22,.60),(3.28,2.08,.935,2.431,.23,.58),
  (3.51,1.86,.956,2.266,.24,.55),(3.73,1.62,.98,2.070,.25,.50),(3.87,1.44,1.005,1.935,.26,.46),(3.96,1.30,1.032,1.844,.26,.42),(4.05,1.14,1.092,1.754,.25,.38),
  (4.14,.94,1.13,1.64,.23,.32),(4.18,.84,1.152,1.58,.21,.29),(4.23,.64,1.197,1.50,.17,.23),(4.26,.42,1.235,1.44,.11,.14),(tip,.02,1.325,1.341,.008,.008)])
 xs=sorted(set(round(x,4) for x in [-L/2,-L/2+.14]+[-4.0+.25*i for i in range(17)]+[.26,.40]+[.55+.06*i for i in range(25)]+[2.05+.03*i for i in range(66)]+[4.04+.01*i for i in range(24)]+[tip]))
 verts=[]
 for x in xs:ring=loaf(*shape(x));verts+=[(x,y,z) for y,z in ring]
 n=len(ring);k=len(xs)
 faces=[tuple(reversed(range(n))),tuple(range((k-1)*n,k*n))]+[(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for i in range(k-1) for j in range(n)]
 use('01');body=mesh('700T 施工車殼',verts,faces,'t7white',0,True)
 # 同一張車殼照塗裝邊界切成四色（fleet-v1 的做法）：裙邊、客室段下半白、橘色（駕駛室段到裙邊、客室段窄帶）、橘帶上緣以上白；
 # 白色裡車鼻上方高過窗罩下緣 CAN（正側面照量）的那塊是黑色窗罩：包住車鼻兩肩、側面看得到一長條，後端幾乎直切、往前收到鼻上
 TOP=[(3.06,1.92),(3.507,1.86),(3.733,1.83),(3.959,1.74),(4.094,1.65),(4.184,1.56),(4.23,1.48),(tip,1.40)]
 CAN=[(2.47,2.75),(2.52,2.74),(2.70,2.62),(2.91,2.51),(3.13,2.40),(3.345,2.29),(3.56,2.20),(3.717,2.13)]
 sk=lambda x:1.22+.05*min(1,max(0,(x-4.0)/.28))**2;top=lambda x:interp(TOP,x);canz=lambda x:interp(CAN,x)
 crear=lambda y:2.47+.08*(1-math.sqrt(max(0,1-min(1,abs(y)/1.17)**2)))
 lo=lambda x:1.65 if x<=.26 else 1.65-(1.65-sk(x))*min(1,(x-.26)/.14)
 lerp=lambda a,b,t:(a[0].lerp(b[0],t),a[1].lerp(b[1],t));groups={}
 def put(key,poly):
  if len(poly)<3:return
  vv,ff,nn=groups.setdefault(key,([],[],[]));base=len(vv);vv.extend(tuple(a) for a,_ in poly);nn.extend(tuple(m.normalized()) for _,m in poly)
  ff.extend((base,base+i,base+i+1) for i in range(1,len(poly)-1))
 d=body.data;d.calc_loop_triangles()
 for tri in d.loop_triangles:
  poly=[(d.vertices[i].co.copy(),d.vertices[i].normal.copy()) for i in tri.vertices]
  put('t7skirt',clip_poly(poly,lambda v:sk(v[0].x)-v[0].z,lerp));rest=clip_poly(poly,lambda v:v[0].z-sk(v[0].x),lerp)
  put('t7white',clip_poly(rest,lambda v:lo(v[0].x)-v[0].z,lerp));rest=clip_poly(rest,lambda v:v[0].z-lo(v[0].x),lerp)
  put('t7orange',clip_poly(rest,lambda v:top(v[0].x)-v[0].z,lerp));rest=clip_poly(rest,lambda v:v[0].z-top(v[0].x),lerp)
  put('t7white',clip_poly(rest,lambda v:canz(v[0].x)-v[0].z,lerp));rest=clip_poly(rest,lambda v:v[0].z-canz(v[0].x),lerp)
  put('t7white',clip_poly(rest,lambda v:crear(v[0].y)-v[0].x,lerp));put('t7canopy',clip_poly(rest,lambda v:v[0].x-crear(v[0].y),lerp))
 p.MODEL.remove(body);bpy.data.objects.remove(body,do_unlink=True)
 for key,name in [('t7white','700T 白色車殼'),('t7orange','700T 橘色車鼻與橘帶'),('t7skirt','700T 深灰裙邊'),('t7canopy','黑色水滴形駕駛窗罩')]:
  vv,ff,nn=groups[key];m=bpy.data.meshes.new(name);m.from_pydata(vv,[],ff);m.update()
  o=bpy.data.objects.new(name,m);p.ACTIVE.objects.link(o);p.MODEL.append(o);finish(o,key,0,True);m.normals_split_custom_set_from_vertices(nn)
  if key=='t7white':o['primary_body']=True
 # 客室段黑線（前端削尖、在駕駛室門後收掉）與門後黑色楔形：都在 x>0 結束，中間車鏡射時兩端一致
 for side in [-1,1]:
  side_prism('橘帶上黑線',[(-L/2+.05,1.92),(.42,1.92),(.02,2.04),(-L/2+.05,2.04)],side,W/2+.012,'t7black')
  side_prism('門後黑色楔形',[(0,1.65)]+[(.40+.08*math.sqrt(t),1.22+.43*t) for t in [i/8 for i in range(8,-1,-1)]]+[(.26,1.22)],side,W/2+.012,'t7black')
 # 窗與門：x<0 的窗距一致（中間車鏡射後 x=0 兩側的窗距不變），駕駛室門前不放窗
 dw=s['doorW']
 for side in [-1,1]:
  y=side*(W/2+.018)
  for x in [-.30-.60*i for i in range(6)]+[.30]:sidewindow(x,y,2.31,.36,.42,r=.09)
  for i,(x,bands) in enumerate([(-L/2+.45,[(1.785,.27,'t7orange'),(1.98,.12,'t7black')]),(.84,[(1.685,.47,'t7orange')])]):
   use('02');cz=(1.45+2.80)/2;h=2.80-1.45
   panel('側門門框',(x,y,cz),dw+.05,h+.03,'frame',r=.03)
   door=panel('獨立門扇',(x,y+side*.023,cz),dw-.022,h,'t7white',r=.025,depth=.024)
   door['side_door']=True;door['door_group']=i+1;door['side']=side;door['leaf']=0
   for z,hh,m in bands:box('門扇色帶',(x,y+side*.041,z),(dw-.022,.011,hh),m,.002)
   panel('門窗嵌框',(x,y+side*.052,2.35),.30,.48,'frame',r=.05)
   panel('門窗玻璃',(x,y+side*.066,2.35),.26,.42,'glass',r=.045,depth=.012)
 text_label(s['label'],(-1.8,W/2+.025,1.43),.07,axis='side',side=1)
 # 頭燈（白、內）與尾燈（紅、外）在窗罩前端裡面，貼著車殼上表面
 def top_z(x,y):
  w,zb,zt,rb,rt=shape(x);hw,rb,ay,az=loaf_dims(w,zb,zt,rb,rt);e=abs(y)-(hw-ay)
  return zt if e<=0 else zt-az+az*math.sqrt(max(0,1-min(1,e/ay)**2))
 def top_disc(name,xc,yc,rx,ry,material,off):
  pts=[(xc,yc)]+[(xc+rx*math.cos(2*math.pi*k/20),yc+ry*math.sin(2*math.pi*k/20)) for k in range(20)]
  return mesh(name,[(x,y,top_z(x,y)+off) for x,y in pts],[(0,1+k,1+(k+1)%20) for k in range(20)],material,0,True)
 use('03')
 for side in [-1,1]:top_disc('頭燈',3.50,side*.22,.05,.09,'lamp',.006);top_disc('尾燈',3.50,side*.38,.04,.06,'red',.006)
 # 鼻蓋分模線：x=4.0 那一圈斷面，橘色下緣以上
 pts=loaf(*shape(4.0),8,12);seam=[]
 for i,(y,z) in enumerate(pts):
  if z<sk(4.0)+.03:continue
  (y0,z0),(y1,z1)=pts[i-1],pts[(i+1)%len(pts)];l=math.hypot(y1-y0,z1-z0) or 1;seam.append((4.0,y+(z1-z0)/l*.008,z-(y1-y0)/l*.008))
 use('03');line('車鼻蓋分模線',seam,.008,'t7seam')
 # 轉向架照側面照的位置；車底主梁與設備箱改短，不從收窄的車鼻底穿出來、也不撞到前轉向架
 bogies(L,W,r=.35,centers=[-2.9,1.5])
 for o in [o for o in p.MODEL if o.name.split('.')[0] in ('車底主梁','車下獨立設備箱','設備箱通風格柵')]:p.MODEL.remove(o);bpy.data.objects.remove(o,do_unlink=True)
 use('04');box('車底主梁',(-.55,0,.86),(6.9,W*.72,.30),'chassis',.04)
 for x in [-1.2,-.1]:
  box('車下獨立設備箱',(x,0,.62),(.90,W*.6,.48),'roof',.04)
  for sd in [-1,1]:
   for k in range(4):box('設備箱通風格柵',(x-.3+k*.2,sd*(W*.30+.006),.62),(.06,.015,.30),'chassis',.004)
 coupler(-L/2-.03,W,-1,gangway=True)
 return surface_fn(shape,tip)

def surface_fn(shape,tip):
 """車鼻表面：給 (y, z) 回鼻尖方向最前面的 x（二分搜尋斷面，跟 fleet-v1 shinkansen_shell 的 surface 同一個做法）。"""
 def inside(x,y,z):
  w,zb,zt,rb,rt=shape(x);hw,rb,ay,az=loaf_dims(w,zb,zt,rb,rt)
  if z<zb or z>zt:return False
  if z<zb+rb:d=zb+rb-z;return abs(y)<=hw-rb+math.sqrt(max(0,rb*rb-d*d))
  if z>zt-az:d=(z-(zt-az))/az;return abs(y)<=hw-ay+ay*math.sqrt(max(0,1-d*d))
  return abs(y)<=hw
 def surface(y,z):
  a,b=.55,tip
  for i in range(32):
   m=(a+b)/2
   if inside(m,y,z):a=m
   else:b=m
  return a
 return surface

# ── 台鐵推拉式自強號（E1000 機車、40PPD2500 客貨車）─────────────────────────────
# 車側色帶 E1000 與客車同高：橘帶 1.70–2.61、帶下白細線 1.675–1.70 與紅線 1.615–1.675、車身下緣紅線 1.08–1.13（照彰化站正側面照量）。

PP_BANDS=[(1.08,'e1silver'),(1.13,'e1red'),(1.615,'e1silver'),(1.675,'e1red'),(1.70,'e1white'),(2.61,'e1orange')]

def pp_colours():
 color('e1silver','CDD3D5',.45,.32,.15);color('e1orange','EE6A2C',.05,.32,.30);color('e1red','C8202E',.05,.32,.30)
 color('e1white','F2F3F0',.08,.32,.25);color('e1black','15191C',.20,.22,.45);color('e1grey','5C6469',.35,.38,.12);color('e1roof','AEB5B8',.40,.40,.08)

def side_paint(name,s,f,side,gs,x0,x1,z0,z1,material,offset=.008,step=.04):
 """駕駛室側面（|y|=W/2 的平面）上用不等式圍出的色塊：gs=[g(x, z), ...] 全部 ≥0 的地方上色，車頭曲面前緣自動裁掉。
 先切成細格三角形再逐條裁切，斜掃的色帶邊緣才是直的。"""
 W=s['W'];gs=list(gs)+[lambda x,z:f(W/2,z)-.004-x];nx=max(1,math.ceil((x1-x0)/step));nz=max(1,math.ceil((z1-z0)/step))
 P=lambda i,j:(x0+(x1-x0)*i/nx,z0+(z1-z0)*j/nz);lerp=lambda a,b,t:(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t)
 verts=[];faces=[];index={}
 def vid(q):
  key=(round(q[0],5),round(q[1],5))
  if key not in index:index[key]=len(verts);verts.append((q[0],side*(W/2+offset),q[1]))
  return index[key]
 for i in range(nx):
  for j in range(nz):
   for tri in ([P(i,j),P(i+1,j),P(i+1,j+1)],[P(i,j),P(i+1,j+1),P(i,j+1)]):
    poly=tri
    for g in gs:
     poly=clip_poly(poly,lambda q:g(*q),lerp)
     if len(poly)<3:break
    if len(poly)<3:continue
    ids=[vid(q) for q in poly]
    for k in range(1,len(ids)-1):
     if len({ids[0],ids[k],ids[k+1]})==3:faces.append((ids[0],ids[k],ids[k+1]) if side<0 else (ids[0],ids[k+1],ids[k]))
 use('01');d=bpy.data.meshes.new(name);d.from_pydata(verts,[],faces);d.update()
 o=bpy.data.objects.new(name,d);p.ACTIVE.objects.link(o);p.MODEL.append(o);return finish(o,material)

def e1000(s):
 """E1000 推拉式自強號電力機車。參考：Commons「TRA E1000 Push-pull Express train on the Western Line.jpg」（jason199567，CC BY-SA 4.0，正面）、
 「TRA Push-pull Tze-chiang express trains at TRA Changhua Station.jpg」（WC-QHS，CC BY-SA 4.0，駕駛室正側面）、「A TRA Push-pull Tze-chiang Express at Hsinchu Station 02.jpg」（Lokseng01，CC BY-SA 4.0，斜前方全車）、
 「Push-Pull Tze-Chiang Limited Express Trainset.jpg」（Samson Ng . D201@EAL，CC BY-SA 4.0，機車與客車色帶對齊）、「Close-up of a TRA Push-pull Tze-chiang express at Taichung Station.jpg」（WC-QHS，CC BY-SA 4.0，後端牆）。
 銀色車身、往後倒的長車頭（不是電聯車的車殼，所以不走 emu_body）。正面上半銀色、兩扇黑框大前窗，頂端中央膠囊形雙頭燈座；窗下一道往上拱的折線，
 下巴整片橘色，左右兩個黑色燈座各兩顆圓燈、中間兩組小通風口；下巴下緣一白一紅兩條 V 字線，再下面是銀色裙板與黃黑警戒條。
 車側橘帶 1.70–2.61（駕駛室側窗、側門都在帶內），帶下白細線與紅線、車身下緣另一條紅線；駕駛室前方橘帶上緣往前下掃，帶下的紅白線也往下掃到下緣紅線，
 三條線在車頭併成下巴的 V 字。車頂後段是設備罩與單臂受電弓；後端是接客車的端牆（上橘下銀）。
 高度照彰化站正側面照量（車頂 3.50、車身下緣 0.83 定比例），車頭長度壓到約六成；正面的橫向位置照正面照。"""
 L,W,H=s['L'],s['W'],s['H'];pp_colours()
 profile=[(.83,L/2-.005),(.90,L/2),(1.14,L/2-.04),(1.35,L/2-.11),(1.61,L/2-.24),(1.89,L/2-.36),(2.39,L/2-.61),(2.81,L/2-.86),(3.12,L/2-1.06),(3.34,L/2-1.26),(3.46,L/2-1.55),(H,L/2-1.86)]
 s['bowPow']=2.0;bands=PP_BANDS+[(H+1,'e1silver')]
 f,neck=zoned_shell(s,profile,.38,bands,[(H+1,'e1silver')],nose_zones=bands,surface_neck=True)
 # 駕駛室前方：橘帶上緣 t(x) 沿側窗前緣往前下掃；帶下的白線、紅線 b(x) 往下掃到車身下緣紅線，之後三條線一起到車角接上正面的 V 字
 T=[(3.26,2.61),(3.49,2.07),(3.80,1.70),(3.88,1.62),(4.20,1.30),(4.60,.90)];B=[(3.47,1.70),(3.76,1.165)]
 t=lambda x:interp(T,x);b=lambda x:interp(B,x);x0=3.20
 for side in [-1,1]:
  for name,gs,m in [('駕駛室前方銀色',[lambda x,z:2.62-z,lambda x,z:z-t(x)],'e1silver'),('駕駛室前方銀色',[lambda x,z:b(x)-.085-z,lambda x,z:z-1.13],'e1silver'),
   ('橘帶往前下掃',[lambda x,z:z-b(x),lambda x,z:min(t(x),2.61)-z],'e1orange'),('白細線往前下掃',[lambda x,z:z-b(x)+.025,lambda x,z:b(x)-z],'e1white'),
   ('紅線往前下掃',[lambda x,z:z-b(x)+.085,lambda x,z:b(x)-.025-z],'e1red'),('下緣紅線',[lambda x,z:z-1.08,lambda x,z:1.13-z,lambda x,z:3.76-x],'e1red')]:
   side_paint(name,s,f,side,gs,x0,4.6,1.0,2.62,m)
 # 駕駛室側窗（前緣斜、跟橘帶下掃平行）、側門、扶手、踏階
 for side in [-1,1]:
  side_prism('駕駛室側窗窗框',[(2.91,1.97),(3.50,1.97),(3.18,2.78),(2.91,2.78)],side,W/2+.022,'e1black')
  side_prism('駕駛室側窗玻璃',[(2.945,2.005),(3.455,2.005),(3.155,2.745),(2.945,2.745)],side,W/2+.032,'glass')
  box('側窗橫框',(3.12,side*(W/2+.034),2.39),(.355,.012,.03),'e1black',.004)
  for x in [3.07,3.20]:box('側窗直框',(x,side*(W/2+.034),2.20),(.025,.012,.385),'e1black',.004)
  use('02');x=2.655;cz=(1.225+2.856)/2;h=2.856-1.225;yy=side*(W/2+.018)
  panel('駕駛室側門門框',(x,yy,cz),.35,h+.03,'frame',r=.03)
  c=panel('駕駛室側門',(x,yy+side*.020,cz),.29,h,'e1silver',r=.025,depth=.020);c['side_door']=True;c['crew_door']=True
  for z,hh,m in [(2.155,.91,'e1orange'),(1.6875,.025,'e1white'),(1.645,.06,'e1red')]:box('門扇色帶',(x,yy+side*.032,z),(.29,.011,hh),m,.002)
  panel('駕駛室門窗嵌框',(x,yy+side*.040,2.47),.24,.68,'frame',r=.04)
  panel('駕駛室門窗玻璃',(x,yy+side*.052,2.47),.20,.64,'glass',r=.035,depth=.012)
  for xr in [2.45,2.86]:rod('登車扶手',(xr,yy+side*.05,1.25),(xr,yy+side*.05,2.45),.016,'metal')
  for z in [.39,.60,.80]:box('駕駛室登車踏階',(x,side*(W/2-.01),z),(.30,.15,.042),'metal',.008)
  grille('車側百葉窗',1.85,side*(W/2+.02),2.615,.36,.57,True,9)
  grille('車側百葉窗',-3.45,side*(W/2+.02),2.60,.26,.50,True,8)
 # 正面：下巴橘色、白細線、紅線（V 字：車角接車側往下掃的三條線、中央最低）
 V=lambda y:1.165-.16*(1-abs(y)/(W/2));m=W/2-.004
 front_patch('橘色下巴',f,-m,m,V,lambda y:1.54+.08*(abs(y)/(W/2))**1.5,'e1orange',.010,cols=48,rows=10)
 front_patch('下巴白細線',f,-m,m,lambda y:V(y)-.025,V,'e1white',.010,cols=48,rows=1)
 front_patch('下巴紅線',f,-m,m,lambda y:V(y)-.085,lambda y:V(y)-.025,'e1red',.010,cols=48,rows=2)
 g=lambda y,z:f(y,z)-.05
 front_ribbon('下巴上緣折線',g,[(-1.38,1.60),(-1.0,1.70),(-.5,1.775),(0,1.80),(.5,1.775),(1.0,1.70),(1.38,1.60)],.016,'e1grey')
 for sd in [-1,1]:
  a,b2=sorted([sd*.44,sd*.96]);lo,hi=pinch(lambda y:1.22,lambda y:1.50,.44,.96,.11)
  front_patch('下巴燈座',f,a,b2,lambda y:lo(abs(y)),lambda y:hi(abs(y)),'e1black',.016,cols=14,rows=6)
  lamp('頭燈',f,sd*.58,1.36,.068);lamp('尾燈',f,sd*.80,1.36,.062,red=True)
  for dy in [.13,.185,.24]:front_panel('中央通風口',f,sd*dy,1.365,.028,.10,'e1black',.012,.016)
  # 兩扇黑框大前窗、窗上雨刷
  a,b2=sorted([sd*.035,sd*1.08]);lo,hi=pinch(lambda y:2.22,lambda y:2.78,.035,1.08,.10)
  front_patch('前窗黑框',f,a,b2,lambda y:lo(abs(y)),lambda y:hi(abs(y)),'e1black',.030,cols=24,rows=8)
  a,b2=sorted([sd*.075,sd*1.04]);lo,hi=pinch(lambda y:2.26,lambda y:2.74,.075,1.04,.075)
  front_patch('前窗玻璃',f,a,b2,lambda y:lo(abs(y)),lambda y:hi(abs(y)),'glass',.036,cols=24,rows=8)
 for a,b2 in [((-.58,2.92),(-.13,2.66)),((.60,2.92),(.19,2.66))]:
  use('03');line('雨刷',[(f(*a)+.045,*a),(f(*b2)+.045,*b2)],.013,'e1black')
 face_label(s['label'],f,-.72,2.66,.046,.045,tilt=True)
 lo,hi=pinch(lambda y:2.91,lambda y:3.08,-.20,.20,.085)
 front_patch('頂部頭燈座',f,-.20,.20,lo,hi,'e1black',.020,cols=16,rows=6)
 for y in [-.09,.09]:lamp('頂部頭燈',lambda yy,zz:f(yy,zz)-.05,y,2.995,.052)
 # 車身下緣以下的前端裙板（隨車鼻平面曲線、往下微收）與黃黑警戒條、車鉤
 sk=lambda y,z:f(y,.83)-.03-.10*(.83-z)/.33;ys=W/2-.14
 front_patch('前端裙板',sk,-ys,ys,.50,.83,'e1silver',0,cols=32,rows=4)
 front_patch('警戒條底色',sk,-ys+.01,ys-.01,.50,.64,'yellow',.006,cols=32,rows=2)
 for k in range(-6,6):
  y0=k*.22
  if y0<-ys+.01 or y0+.21>ys-.01:continue
  front_poly('警戒黑斜紋',lambda y,z:sk(y,z)-.025,[(y0,.64),(y0+.11,.64),(y0+.21,.50),(y0+.10,.50)],'e1black')
 for sd in [-1,1]:xs_=sk(sd*ys,.66);box('前端側裙',((3.75+xs_)/2,sd*(ys+.015),.665),(xs_-3.75,.03,.33),'e1silver',.01)
 coupler(f(0,.83)-.08,W,1,z=.76)
 # 車頂：駕駛室後到車尾的設備罩、冷卻風柵、單臂受電弓與高壓母線、無線天線
 use('05');box('車頂設備罩',(-1.05,0,H-.02),(6.5,2.26,.26),'e1grey',.07)
 for k in range(10):box('屋頂冷卻風柵',(1.05+k*.10,0,H+.115),(.035,1.5,.012),'e1black',.002)
 pantograph(-2.6,H+.11);line('屋頂高壓母線',[(-2.2,-.70,H+.13),(1.0,-.70,H+.13)],.018,'metal')
 box('車頂天線底座',(1.9,.55,H+.12),(.20,.16,.05),'chassis',.012);rod('列車無線天線',(1.9,.55,H+.14),(1.9,.55,H+.32),.010,'chassis')
 # 後端牆：上半橘（車殼後端）、下半銀與兩條紅線，貫通道接客車
 use('07');box('後端牆下半銀色',(-L/2-.006,0,1.27),(.012,W-.30,.86),'e1silver',.004)
 for z,hh in [(1.645,.06),(1.105,.05)]:box('後端牆紅線',(-L/2-.014,0,z),(.008,W-.30,hh),'e1red',.002)
 coupler(-L/2-.03,W,-1,z=.70,gangway=True)
 bogies(L,W,r=.42)
 return f

def end_wall(name,s,x,material,depth=.008):
 """跟車殼同一條斷面的端牆薄片（zoned_shell 後端只有單一色，客車兩端要一樣）。"""
 H=s['H'];z0=s.get('bottom',.83);zs=[z0+(H-z0)*i/40 for i in range(41)];sg=1 if x>0 else -1
 ring=[(half_width(s,z),z) for z in zs]+[(-half_width(s,z),z) for z in reversed(zs)];n=len(ring)
 v=[(x,y,z) for y,z in ring]+[(x+sg*depth,y,z) for y,z in ring]
 use('07');return mesh(name,v,[tuple(range(n)),tuple(range(n,2*n))]+[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)],material)

def ppcoach(s):
 """推拉式自強號 40PPD2500 客貨車（一半客室、一半行李間）。參考：Commons「TRA PPD2525 20021229.jpg」（Encino，Public domain，車體配置：門在一端、窗在另一半）、
 「Push-Pull Tze-Chiang Limited Express Trainset.jpg」（Samson Ng . D201@EAL，CC BY-SA 4.0，客車色帶跟 E1000 對齊）；Blair Yu 的 40PPD2527 原始攝影文章只在本機看配置，不轉載。
 不鏽鋼車身；色帶跟 E1000 同高（PP_BANDS）；兩端各一扇有窗的單開塞拉門；窗只在一半（兩大兩小），另一半是行李間、只有橘帶；
 橘帶上緣兩個小百葉；壓紋車頂，行李間那端車頂一大台冷氣。"""
 L,W,H=s['L'],s['W'],s['H'];pp_colours()
 bands=PP_BANDS+[(H-.10,'e1silver'),(H+1,'e1roof')]
 zoned_shell(s,[(.83,L/2),(H,L/2)],0,bands,[(H-.10,'e1silver'),(H+1,'e1roof')])
 dw=s['doorW'];lw=dw-.022
 for side in [-1,1]:
  y=side*(W/2+.018)
  for x,w in [(.50,.78),(1.45,.78),(2.25,.40),(2.85,.40)]:sidewindow(x,y,2.09,w,.48,r=.07)
  for i,x in enumerate([-L/2+.60,L/2-.60]):
   use('02');cz=(.92+2.85)/2;h=2.85-.92
   panel('側門門框',(x,y,cz),dw+.05,h+.03,'frame',r=.03)
   door=panel('獨立門扇',(x,y+side*.023,cz),lw,h,'e1silver',r=.025,depth=.024)
   door['side_door']=True;door['door_group']=i+1;door['side']=side;door['leaf']=0
   for z,hh,m in [(2.155,.91,'e1orange'),(1.6875,.025,'e1white'),(1.645,.06,'e1red'),(1.105,.05,'e1red')]:box('門扇色帶',(x,y+side*.041,z),(lw,.011,hh),m,.002)
   panel('門窗嵌框',(x,y+side*.052,2.305),.32,.90,'frame',r=.05)
   panel('門窗玻璃',(x,y+side*.066,2.305),.28,.85,'glass',r=.045,depth=.012)
   box('車門踏板',(x,y+side*.01,.90),(dw+.08,.11,.042),'metal',.008)
  for x in [-1.2,-.5]:grille('橘帶上緣小百葉',x,side*(W/2+.02),2.615,.20,.19,True,5)
 text_label(s['label'],(-2.6,W/2+.03,1.36),.08,axis='side',side=1)
 use('05');x0,x1=-2.25,L/2-.25
 for k in range(9):box('車頂縱向壓紋',((x0+x1)/2,-.8+k*.2,H+.006),(x1-x0,.035,.014),'e1roof',.004)
 box('冷氣機罩',(-3.25,0,H+.10),(1.9,W*.66,.26),'e1roof',.08)
 for k in range(9):box('冷氣罩頂部格柵',(-4.05+k*.20,0,H+.235),(.035,W*.46,.01),'chassis',.002)
 for side in [-1,1]:grille('冷氣側格柵',-3.25,side*W*.33,H+.09,1.3,.12,True,5)
 for end in [-1,1]:
  end_wall('客車端牆',s,end*(L/2+.002),'e1silver')
  panel('客車端牆貫通門',(end*(L/2+.018),0,2.0),.72,1.70,'chassis','front',r=.065)
  panel('端門玻璃',(end*(L/2+.042),0,2.46),.45,.65,'glass','front',r=.04)
  coupler(end*(L/2+.025),W,end,z=.58,gangway=True)
 bogies(L,W,r=.39)

# ── 台鐵柴油客車（DR3100、DR1000、DR2700）與早期自強號電聯車（EMU100、EMU1200）───────────────────────────
# DR3100 與 DR1000 是同一套黃色警戒塗裝：黃色車頭、橘色上緣（兩塊黃色高壓警示牌）、兩側黑框前窗（頭燈在窗框上緣裡）、中央貫通門、
# 窗下橘帶接往中央下斜的橘色斜紋，斜紋內側隔一道黃色斜帶、再往內到貫通門框是橘色；下緣橘帶、黃圈紅尾燈。
# 兩款照片分得出的差別在貫通門：DR3100 是黃色凸框圍著窄門，DR1000 是黑色橡膠框圍著寬門；其餘位置各自照正面照量。
# DR1000、DR2700 是雙頭單車：車殼兩端都是車頭（zoned_shell double），車頭零件做一端再轉 180° 複製到另一端。

def dmu_colours():
 color('dstain','BCC2C3',.55,.30,.15);color('droof','5E6266',.40,.45,.08);color('dyellow','F8C000',.05,.34,.30)
 color('dorange','EE5A22',.05,.34,.30);color('dkick','A88A2A',.20,.40,.10)

def side_ribs(s,zs,x0,x1,material,h=.022):
 """車側縱向壓紋（波紋不鏽鋼）：每個高度一條細長方塊，貼著車殼斷面（車頂圓角處跟著往內收）。"""
 use('01')
 for z in zs:
  y=half_width(s,z)+.005
  for side in [-1,1]:box('車側縱向壓紋',((x0+x1)/2,side*y,z),(x1-x0,.010,h),material,.003)

def roof_hood(name,s,x0,x1,w,h,slope,material):
 """車頂設備罩：兩端斜面的梯形罩（冷氣、中央高起段）。"""
 use('05');H=s['H'];t=w/2-.06
 v=[(x0,-w/2,H-.03),(x1,-w/2,H-.03),(x1,w/2,H-.03),(x0,w/2,H-.03),(x0+slope,-t,H+h),(x1-slope,-t,H+h),(x1-slope,t,H+h),(x0+slope,t,H+h)]
 return mesh(name,v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],material,.015)

def slant(f,side,top,width,slope,z0,z1,u0,material,name='橘色警戒斜紋'):
 """車頭往中央下斜的色帶：外緣在 z1 時位於 |y|=top、橫向寬 width，每往下 1 m 往中央移 slope；|y|<u0 被貫通門框蓋住，不畫。"""
 lo=lambda y:max(z0,z1-(top-abs(y))/slope);hi=lambda y:min(z1,z1-(top-width-abs(y))/slope)
 a,b=sorted([side*max(u0,top-width-slope*(z1-z0)),side*top]);return front_patch(name,f,a,b,lo,hi,material,.032,cols=24,rows=4)

def dmu_face(s,f,k):
 """DR3100／DR1000 的車頭。k 是各款照片量到的位置：win=(|y| 內緣, 外緣, 下緣, 上緣)、glass 玻璃上緣、lampZ 頭燈高、
 gang=(外框寬, 外框高下緣, 上緣, 外框材質)、door=(寬, 下緣, 上緣)、dwin=(寬, 下緣, 上緣)、tail=(|y|, z, 黃圈半徑)、stripes=[(外緣 |y|, 寬), ...]、slope、sz=(z0, z1)、
 band=(窗下橘帶下緣, 上緣, |y| 內緣)、hv=(高壓警示牌中心 |y|, 下緣, 上緣, 寬)。"""
 W,H=s['W'],s['H'];a,b,z0,z1=k['win'];yc=(a+b)/2;w=b-a;g=k['gang'][0]/2
 for side in [-1,1]:
  front_panel('前窗黑框',f,side*yc,(z0+z1)/2,w,z1-z0,'frame',.09,.030)
  front_panel('前窗玻璃',f,side*yc,(z0+.06+k['glass'])/2,w-.08,k['glass']-z0-.06,'glass',.07,.042)
  lamp('窗框上緣頭燈',f,side*yc,k['lampZ'],.080);wiper(f,side*(yc+.10),z0+.10,.55)
  for top,width in k['stripes']:slant(f,side,top,width,k['slope'],*k['sz'],g-.02,'dorange')
  ty,tz,tr=k['tail']
  front_panel('尾燈黃色燈圈',f,side*ty,tz,2*tr,2*tr,'dyellow',tr,.036);lamp('尾燈',f,side*ty,tz,.065,red=True)
  box('尾燈遮簷',(f(side*ty,tz+tr+.03)+.07,side*ty,tz+tr+.03),(.14,2*tr-.04,.024),'dyellow',.006)
  box('標識燈掛架',(f(side*ty,1.61)+.05,side*ty,1.61),(.08,.07,.11),'dyellow',.012)
  line('貫通門扶手',[(f(side*(g+.07),1.25)+.10,side*(g+.07),1.25),(f(side*(g+.07),2.60)+.10,side*(g+.07),2.60)],.016,'metal')
 if k.get('band'):
  lo,hi,u=k['band']
  for side in [-1,1]:a2,b2=sorted([side*u,side*(W/2-.004)]);front_patch('窗下橘帶',f,a2,b2,lo,hi,'dorange',.032,cols=12,rows=2)
 if k.get('hv'):
  hy,h0,h1,hw=k['hv']
  for side in [-1,1]:a2,b2=sorted([side*(hy-hw/2),side*(hy+hw/2)]);front_patch('高壓警示牌',f,a2,b2,h0,h1,'dyellow',.030,cols=2,rows=4)
 gw,g0,g1,gm=k['gang']
 if gm=='frame':front_panel('貫通門橡膠框',f,0,(g0+g1)/2,gw,g1-g0,'frame',.10,.036)
 else:front_panel('貫通門外框邊縫',f,0,(g0+g1)/2,gw+.04,g1-g0+.04,'frame',.07,.030);front_panel('貫通門黃色凸框',f,0,(g0+g1)/2,gw,g1-g0,gm,.06,.036)
 dw,d0,d1=k['door'];front_panel('貫通門門縫',f,0,(d0+d1)/2,dw+.04,d1-d0+.04,'frame',.035,.044);front_panel('貫通門門扇',f,0,(d0+d1)/2,dw,d1-d0,'dyellow',.025,.050)
 ww,w0,w1=k['dwin'];front_panel('貫通門窗框',f,0,(w0+w1)/2,ww+.06,w1-w0+.06,'frame',.06,.054);front_panel('貫通門窗',f,0,(w0+w1)/2,ww,w1-w0,'glass',.05,.058)
 front_panel('貫通門下踏板',f,0,(g0+d0)/2,dw-.06,d0-g0-.02,'dkick',.02,.056)
 front_panel('車號牌',f,-yc,k['plateZ'],.40,.11,'white',.02,.058);face_label(s['label'],f,-yc,k['plateZ'],.072,.055)
 hazard(f(0,.83)+.07,W,.61,.43)

def dr3100(s):
 """DR3100 柴聯自強（日本車輛）。參考：Commons「柴聯自強 DR3100, 汐止車站 (20250216).jpg」（Takeshi Aida，CC BY-SA 2.0，正面）、
 「Two TRA DR3100 on the Western Line.jpg」（jason199567，CC BY-SA 4.0，正面近照）、「DR3100 Series DMU.jpg」（Samson Ng . D201@EAL，CC BY-SA 4.0，斜側）。
 窗下橘帶接往中央下斜的橘色斜紋，斜紋內側隔一道黃色斜帶、再往內到門框是橘色；貫通門外框是黃色凸框。車側不鏽鋼：窗上黃細線、窗下橘帶，帶下四條、窗上兩條縱向壓紋；
 駕駛室側面黃色（橘帶與上緣橘色繞過來）；車頂兩台斜端冷氣罩、一支排氣管。
 高度依汐止站正面照量：前窗 1.86–3.19、頭燈 2.96、貫通門框 .97–3.07、門 1.23–2.93、尾燈 1.27、窗下橘帶 1.65–1.81、斜紋 .97–1.81、下緣橘帶 .83–.97、
 高壓警示牌 3.13–3.33（中心 |y| .37）。斜紋外緣每往下 1 m 往中央移 .585、寬 .23，黃色斜帶寬 .13。"""
 L,W,H=s['L'],s['W'],s['H'];dmu_colours()
 profile=[(.83,L/2-.04),(1.00,L/2),(H-.35,L/2-.01),(H-.12,L/2-.08),(H,L/2-.20)]
 s['bowPow']=6;bands=[(1.76,.20,'dorange'),(2.905,.07,'dyellow')]
 fz=[(.97,'dorange'),(3.15,'dyellow'),(H+1,'dorange')];nz=[(.97,'dorange'),(1.66,'dyellow'),(1.86,'dorange'),(3.15,'dyellow'),(H+1,'dorange')]
 f,neck,doors=emu_body(s,profile,.08,[(H-.16,'dstain'),(H+1,'droof')],fz,nz,leaf='dstain',gaps=[0,6,1],bands=bands,leafbands=bands)
 side_ribs(s,[1.00,1.19,1.40,1.59,3.03,3.11],-L/2+.08,neck-.04,'dstain')
 dmu_face(s,f,dict(win=(.45,1.22,1.86,3.19),glass=2.86,lampZ=2.99,gang=(.88,.97,3.07,'dyellow'),door=(.62,1.23,2.93),dwin=(.38,1.87,2.78),
  tail=(1.0,1.27,.13),stripes=[(1.072,.23),(.712,.26)],slope=.585,sz=(.97,1.81),band=(1.65,1.81,1.0),hv=(.37,3.13,3.33,.10),plateZ=2.75))
 for x0,x1 in [(1.0,3.3),(-3.6,-1.3)]:
  roof_hood('斜端冷氣機罩',s,x0,x1,W*.66,.30,.40,'droof')
  for k in range(8):box('冷氣罩頂部格柵',(x0+.55+k*(x1-x0-1.1)/7,0,H+.305),(.035,W*.42,.01),'chassis',.002)
 use('05');cyl('排氣管',(.55,.62,H+.22),.07,.42,'chassis');cyl('排氣管口',(.55,.62,H+.44),.085,.04,'frame')
 return f

def dr1000(s):
 """DR1000 支線小車（日本車輛，雙頭單車）。參考：Commons「2019-07-19 DR1000 on the Western Line (Northern Section).jpg」（魏 子棋，Public domain，正面）、
 「A TRA DR1000 train approaching Hsinchu Station.jpg」（Tbatb，CC BY-SA 4.0，斜側）、「TRA DR1000.jpg」（jason199567，CC BY-SA 2.0）。
 跟 DR3100 同一套警戒塗裝（窗下橘帶、往中央下斜的橘色斜紋、內側黃色斜帶、門框邊橘色），差在貫通門外框是黑色橡膠框、門比較寬；
 頭燈在左右前窗窗框上緣（不在車頂中央）。車側門窗前後對稱；車頂兩端冷氣、中央四個散熱風扇與兩條管線。
 高度依 2019 正面照量（橫向 257 px/m、直向 254 px/m）：上緣橘色 3.18 以上、高壓警示牌 3.24–3.38（中心 |y| .42）、前窗 1.88–3.16、頭燈 2.97、
 窗下橘帶 1.75–1.88、斜紋 .99–1.88（外緣每往下 1 m 往中央移 .56、寬 .245）、黃色斜帶寬 .145、下緣橘帶 .83–.99、橡膠框 .95–3.12、門 1.16–3.04（寬 .84）、
 尾燈中心 |y| 1.10、高 1.30（黃圈半徑 .155）。"""
 L,W,H=s['L'],s['W'],s['H'];dmu_colours()
 profile=[(.83,L/2-.04),(1.00,L/2),(H-.35,L/2-.01),(H-.12,L/2-.08),(H,L/2-.20)]
 s['bowPow']=6;bands=[(1.815,.13,'dorange'),(2.905,.07,'dyellow')]
 fz=[(.99,'dorange'),(3.18,'dyellow'),(H+1,'dorange')];nz=[(.99,'dorange'),(1.75,'dyellow'),(1.88,'dorange'),(3.18,'dyellow'),(H+1,'dorange')]
 f,neck,doors=emu_body(s,profile,.08,[(H-.16,'dstain'),(H+1,'droof')],fz,nz,leaf='dstain',gaps=[2,4,2],bands=bands,leafbands=bands,double=True)
 side_ribs(s,[1.00,1.19,1.40,1.59,3.03,3.11],-neck+.04,neck-.04,'dstain')
 head=len(p.MODEL)
 dmu_face(s,f,dict(win=(.47,1.25,1.88,3.16),glass=2.84,lampZ=2.98,gang=(.98,.95,3.12,'frame'),door=(.84,1.16,3.04),dwin=(.40,1.92,2.85),
  tail=(1.10,1.30,.155),stripes=[(1.162,.245),(.772,.60)],slope=.56,sz=(.99,1.88),band=(1.75,1.88,1.0),hv=(.42,3.24,3.38,.12),plateZ=2.70))
 mirror_cab(list(p.MODEL[head:]))
 for sg in [-1,1]:
  x0,x1=sorted([sg*(neck-1.55),sg*(neck-.30)])
  roof_hood('冷氣機罩',s,x0,x1,W*.66,.28,.35,'droof')
  for k in range(6):box('冷氣罩頂部格柵',(x0+.45+k*(x1-x0-.9)/5,0,H+.285),(.035,W*.40,.01),'chassis',.002)
 use('05')
 for x in [-1.35,-.45,.45,1.35]:
  box('散熱風扇座',(x,0,H+.04),(.66,.92,.12),'droof',.03);cyl('散熱風扇護網',(x,0,H+.105),.27,.02,'chassis')
  for d in [-.12,0,.12]:box('護網橫條',(x,d,H+.118),(.50,.022,.012),'droof',.002)
 for y in [-.62,.62]:line('車頂管線',[(-1.85,y,H+.05),(1.85,y,H+.05)],.025,'metal')
 return f

def dr2700(s):
 """DR2700 白鐵仔（東急車輛，Budd 式不鏽鋼波紋車體，雙頭單車）。參考：Commons「A TRA DR2700 charter train 2015-11-28.jpg」（魏 子棋，Public domain，正面）、
 「TRA DR2706 Yuli 20130906.jpg」「TRA DR2723 Taitung 20130906.jpg」（Rsa，CC BY-SA 3.0，斜側）、「Close-up of a TRA DR2700 train.jpg」（Cheng-en Cheng，CC BY-SA 2.0，波紋近照）。
 整車不鏽鋼、深褐色車頂（中央一段高起）；車頭上緣圓角大，頂端中央凸出雙頭燈座（高過車頂邊）；兩側圓角大前窗、中央貫通門（外框一圈古銅色邊、門上有窗）；
 窗下兩側各七條橫向波紋；下緣兩角鍍鉻圈小尾燈、上方掛架；深灰下裙、沒有警戒斜紋。車側窗下十三條、窗上四條縱向波紋，窗有上下分格的橫框。
 高度依 2015 正面照量：頭燈座 3.25–3.55、前窗 1.96–2.83、貫通門框 1.01–3.03、門窗 1.98–2.80、車頭波紋 1.48–1.85、尾燈 1.22。"""
 L,W,H=s['L'],s['W'],s['H']
 color('d27stain','C0C6C9',.55,.30,.15);color('d27flute','A9B0B3',.55,.32,.12);color('d27roof','5A463C',.30,.55,.05)
 color('d27bronze','7A5E44',.30,.40,.10);color('d27skirt','4A4F52',.35,.40,.10);color('d27yellow','E9B92E',.05,.34,.30)
 profile=[(.83,L/2-.03),(1.00,L/2),(H-.40,L/2-.01),(H-.18,L/2-.08),(H,L/2-.24)]
 s['bowPow']=6;zones=[(H-.20,'d27stain'),(H+1,'d27roof')]
 f,neck,doors=emu_body(s,profile,.12,zones,[(H+1,'d27stain')],zones,leaf='d27stain',gaps=[1,10,1],double=True)
 side_ribs(s,[.98+.075*k for k in range(13)],-neck+.04,neck-.04,'d27flute',.026)
 side_ribs(s,[2.93+.06*k for k in range(4)],-neck+.04,neck-.04,'d27flute',.022)
 head=len(p.MODEL);xf=L/2-.10
 use('03');box('車頂頭燈座',(xf-.14,0,3.40),(.30,.58,.30),'d27stain',.06)
 for y in [-.14,.14]:lamp('車頂頭燈',lambda yy,zz:xf-.07,y,3.40,.085)
 for side in [-1,1]:
  front_panel('黃色小牌',f,side*.70,3.12,.11,.21,'d27yellow',.01,.032)
  front_panel('前窗橡膠框',f,side*.84,2.395,.80,.93,'frame',.14,.030);front_panel('前窗玻璃',f,side*.84,2.395,.74,.87,'glass',.12,.042)
  wiper(f,side*.84,2.02,.50)
  a,b=sorted([side*.48,side*1.25])
  for k in range(7):front_patch('車頭橫向波紋',f,a,b,1.48+k*.055,1.502+k*.055,'d27flute',.026,cols=12,rows=1)
  front_panel('尾燈鍍鉻圈',f,side*1.08,1.22,.24,.24,'metal',.12,.030);lamp('尾燈',f,side*1.08,1.22,.060,red=True)
  box('標識燈掛架',(f(side*1.08,1.49)+.04,side*1.08,1.49),(.06,.10,.08),'d27stain',.01)
 front_panel('貫通門古銅色邊',f,0,2.02,.96,2.06,'d27bronze',.13,.030);front_panel('貫通門外框',f,0,2.02,.92,2.02,'d27stain',.12,.036)
 front_panel('貫通門門縫',f,0,2.02,.72,1.96,'frame',.09,.041);front_panel('貫通門門扇',f,0,2.02,.68,1.92,'d27stain',.08,.046)
 front_panel('貫通門窗框',f,0,2.39,.56,.88,'frame',.11,.052);front_panel('貫通門窗',f,0,2.39,.50,.82,'glass',.10,.058)
 front_panel('車號牌',f,-.84,2.68,.40,.10,'white',.02,.056);face_label(s['label'],f,-.84,2.68,.070,.055)
 box('深灰下裙',(f(0,.83)+.03,0,.62),(.06,W*.84,.38),'d27skirt',.02)
 mirror_cab(list(p.MODEL[head:]))
 roof_hood('車頂中央高起段',s,-2.5,2.5,W*.56,.20,.40,'d27roof')
 use('05')
 for x in [-3.1,3.1]:
  for y in [-.45,.45]:box('車頂通風器',(x,y,H+.05),(.40,.30,.12),'d27roof',.03)
 cyl('排氣管',(.9,-.62,H+.20),.065,.40,'chassis')
 return f

def emu100(s):
 """EMU100 英國婆（英國 GEC 等廠，1978）。參考：Commons「EMU100 at the Huatan Station 20231112.jpg」（Rsa，CC BY-SA 3.0，正面）、
 「2019-02-28 a TRA EMU100 at Dali Station.jpg」（魏 子棋，Public domain，正面）、「TRA EMU100 55EM101.jpg」「TRA EMU100 50EP101.jpg」（Rsa，CC BY-SA 3.0，車側）。
 做的是警戒色車頭（2023 年起另一端復原的原始米棕色車頭不混用）。平直車頭、上緣圓角很大，頂端中央雙頭燈座；橘紅車頭上，中央貫通門外圍一圈琥珀黃框（上緣圓角、一路到底），
 兩側小窗所在那一段琥珀黃，窗下一條橘紅、一條琥珀黃往中央微微下斜；上緣兩角高壓警示小牌；下緣兩角橘紅凸圈尾燈；最下面黃色排障板開直槽。
 車側米金色上半、赭金色下半（分界在窗下）；駕駛室後是窄窗、百葉通風窗、窄窗，再接客室門、六扇大窗、車尾門。
 高度依花壇站正面照量：頭燈座 3.21–3.43、貫通門框上緣 3.07、窗 2.07–2.64、琥珀黃窗帶 1.92–2.78、斜帶 1.57–1.75（外側；到門框低 .12）、尾燈 1.34。"""
 L,W,H=s['L'],s['W'],s['H']
 color('e10red','F0603A',.05,.34,.30);color('e10amber','F6A531',.05,.34,.30);color('e10cream','E6D48E',.06,.36,.25)
 color('e10ochre','C4842A',.06,.36,.25);color('e10roof','9C9A94',.40,.45,.08)
 profile=[(.83,L/2-.03),(1.00,L/2),(H-.55,L/2-.01),(H-.25,L/2-.10),(H-.08,L/2-.22),(H,L/2-.32)]
 zones=[(2.0,'e10ochre'),(H-.14,'e10cream'),(H+1,'e10roof')]
 nz=[(1.57,'e10red'),(1.75,'e10amber'),(1.92,'e10red'),(2.78,'e10amber'),(H-.10,'e10red'),(H+1,'e10roof')]
 f,neck,doors=emu_body(s,profile,.05,zones,[(H+1,'e10red')],nz,leaf='e10cream',gaps=[0,6,0],leafbands=[(1.46,1.08,'e10ochre')])
 for side in [-1,1]:
  y=side*(W/2+.018);sidewindow(neck+.10,y,2.36,.15,.57,r=.05);sidewindow(neck-.62,y,2.57,.15,.86,r=.05)
  grille('駕駛室後百葉通風窗',neck-.25,side*(W/2+.02),2.05,.34,1.30,True,14)
 # 琥珀黃窗帶與斜帶：外側高、到貫通門框低 .12
 t=lambda y:min(1,max(0,(W/2-abs(y))/.80));e=W/2-.004
 front_patch('琥珀黃窗帶',f,-e,e,lambda y:1.92-.12*t(y),2.78,'e10amber',.028,cols=40,rows=6)
 front_patch('琥珀黃斜帶',f,-e,e,lambda y:1.57-.12*t(y),lambda y:1.75-.12*t(y),'e10amber',.028,cols=40,rows=2)
 front_panel('貫通門框陰影',f,0,1.91,1.28,2.38,'frame',.25,.032);front_panel('貫通門琥珀黃框',f,0,1.905,1.22,2.33,'e10amber',.22,.038)
 front_panel('貫通門門縫',f,0,1.88,.86,1.84,'frame',.035,.044);front_panel('貫通門門扇',f,0,1.88,.82,1.80,'e10amber',.03,.050)
 front_panel('貫通門窗框',f,0,2.355,.52,.63,'frame',.09,.054);front_panel('貫通門窗',f,0,2.355,.46,.57,'glass',.08,.058)
 for side in [-1,1]:
  front_panel('前窗橡膠框',f,side*.91,2.36,.51,.63,'frame',.09,.034);front_panel('前窗玻璃',f,side*.91,2.36,.45,.57,'glass',.08,.042)
  front_panel('高壓警示牌',f,side*.94,2.94,.13,.20,'e10amber',.01,.032)
  front_panel('尾燈凸圈陰影',f,side*1.0,1.34,.42,.42,'frame',.21,.030);front_panel('尾燈凸圈',f,side*1.0,1.34,.39,.39,'e10red',.195,.038)
  lamp('尾燈',f,side*1.0,1.34,.075,red=True)
 wiper(f,.96,2.10,.48)
 front_panel('車號牌',f,-.91,2.55,.36,.09,'white',.02,.050);face_label(s['label'],f,-.91,2.55,.064,.05)
 # 頂端雙頭燈座（凸出車頭上緣的弧面）
 xf=L/2-.12;use('03');box('頂部頭燈座',(xf-.13,0,3.32),(.26,.44,.22),'frame',.05)
 for y in [-.11,.11]:lamp('頂部頭燈',lambda yy,zz:xf-.07,y,3.32,.075)
 # 黃色排障板（直槽）
 x=f(0,.83)+.04;use('03');box('黃色排障板',(x,0,.42),(.05,1.50,.36),'e10amber',.02)
 for k in range(9):box('排障板直槽',(x+.027,-.60+k*.15,.42),(.006,.035,.24),'frame',.002)
 use('05')
 for x in [-3.2,-1.6,0,1.6]:box('舊式低頂通風器',(x,0,H+.06),(.42,.54,.12),'e10roof',.04)
 return f

def chevron_skirt(x,W,z,height,pitch=.34,material='yellow'):
 """黃黑 V 字排障板：左右兩半的黑色斜紋往中央下斜，在中線接成 V。"""
 use('03');hw=W*.42;box('排障板警戒底色',(x,0,z),(.055,2*hw,height),material,.015);d=height*.9
 lerp=lambda a,b,t:(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t)
 for side in [-1,1]:
  for i in range(-1,8):
   u0=i*pitch;poly=[(u0,z+height/2),(u0+pitch/2,z+height/2),(u0+pitch/2-d,z-height/2),(u0-d,z-height/2)]
   poly=clip_poly(clip_poly(poly,lambda q:q[0],lerp),lambda q:hw-q[0],lerp)
   if len(poly)<3:continue
   if side<0:poly=poly[::-1]
   mesh('黑色 V 字警戒紋',[(x+.035,side*u,zz) for u,zz in poly],[tuple(range(len(poly)))],'frame')

def emu1200(s):
 """EMU1200 紅斑馬（EMU200 改造）。參考：Commons「2015-08-09 EMU1200 on the Western Line (Northern Section).jpg」（魏 子棋，Public domain，正面）、
 「EMU1200 Series EMU.jpg」（Samson Ng . D201@EAL，CC BY-SA 4.0，斜側）、「Close-up of a TRA EMU1200 train at Taichung Station 01.jpg」（Cheng-en Cheng，CC BY-SA 2.0）。
 白色圓角車頭（上緣與兩角都是曲面），頂端中央膠囊形頭燈、上方兩個小標識窗；一整片黑框大前窗、中間一根窗柱；窗下五條橘帶（中間隔白細線，最下一條最粗）；
 橘帶是車殼本身的分色，在車角繞到駕駛室側面，到乘務員門後被一道往後上揚的橘色斜帶收掉；兩側黑色燈座（外側藍圈尾燈、內側白頭燈）；黃黑 V 字排障板。
 車側白色、紅色下裙、車頂邊一條橘線；駕駛室後一組受電弓。
 高度依 2015 正面照量：頭燈 3.16–3.40、標識窗 2.96–3.13、前窗 1.95–2.77、橘帶 1.65–1.74／1.49–1.58／1.35–1.44／1.21–1.30／.83–1.135、燈座 1.27–1.63。"""
 L,W,H=s['L'],s['W'],s['H']
 color('e12white','EEEEEA',.08,.32,.25);color('e12orange','EE6A3C',.05,.34,.30);color('e12red','B8323F',.05,.34,.30)
 color('e12roof','AEB0B3',.40,.42,.08);color('e12blue','2F5FB8',.10,.30,.30)
 S5=[(1.135,'e12orange'),(1.21,'e12white'),(1.295,'e12orange'),(1.354,'e12white'),(1.44,'e12orange'),(1.492,'e12white'),(1.578,'e12orange'),(1.648,'e12white'),(1.737,'e12orange')]
 profile=[(.83,L/2-.07),(1.00,L/2-.02),(1.25,L/2),(2.00,L/2),(2.85,L/2-.03),(3.10,L/2-.09),(3.30,L/2-.19),(H,L/2-.38)]
 s['bowPow']=3.5;roof=[(3.30,'e12white'),(3.38,'e12orange'),(H+1,'e12roof')]
 f,neck,doors=emu_body(s,profile,.20,[(1.29,'e12red')]+roof,S5+[(H+1,'e12white')],S5+roof,leaf='e12white',gaps=[0,6,0],leafbands=[(1.105,.37,'e12red')],crew='e12white')
 # 駕駛室側面：五條橘帶接續車頭，到斜帶前緣 xl(z) 為止；斜帶往後上揚（側面在車頂圓角以下才是平面，所以斜帶畫到 3.05）
 xl=lambda z:3.22-.239*(z-.83);cx=neck-.36
 for side in [-1,1]:
  lo=.83
  for hi,m in S5:
   side_paint('駕駛室側面橫帶',s,f,side,[lambda x,z,a=lo:z-a,lambda x,z,b=hi:b-z,lambda x,z:x-xl(z)],xl(1.74)-.05,L/2,lo,hi,m)
   if hi>.94:box('乘務員門橫帶',(cx,side*(W/2+.053),(max(lo,.94)+hi)/2),(.40,.004,hi-max(lo,.94)),m,.001)
   lo=hi
  side_paint('駕駛室後橘色斜帶',s,f,side,[lambda x,z:xl(z)-x,lambda x,z:x-xl(z)+.22],xl(3.05)-.25,xl(.83)+.01,.83,3.05,'e12orange')
 # 頂端膠囊頭燈、兩個小標識窗
 lo,hi=pinch(lambda y:3.15,lambda y:3.41,-.24,.24,.13);front_patch('頂部頭燈框',f,-.24,.24,lo,hi,'frame',.030,cols=16,rows=6)
 lo,hi=pinch(lambda y:3.18,lambda y:3.38,-.20,.20,.10);front_patch('頂部膠囊頭燈',f,-.20,.20,lo,hi,'lamp',.036,cols=16,rows=6)
 for y,w in [(-.91,.48),(.96,.29)]:front_panel('標識窗框',f,y,3.045,w+.05,.22,'frame',.08,.030);front_panel('標識窗',f,y,3.045,w,.17,'glass',.07,.038)
 # 黑框大前窗、中間窗柱、雨刷從窗頂往下掛
 front_panel('前窗黑框',f,0,2.36,2.60,.86,'frame',.14,.030);front_panel('前窗玻璃',f,0,2.36,2.48,.74,'glass',.10,.040)
 front_panel('前窗中柱',f,.08,2.36,.05,.74,'frame',.01,.048)
 for y in [-.50,.66]:wiper(f,y,2.70,-.50)
 front_panel('車號牌',f,-.70,1.845,.42,.09,'frame',.02,.034);face_label(s['label'],f,-.70,1.845,.048,.05)
 for side in [-1,1]:
  front_panel('燈座',f,side*.91,1.45,.66,.36,'frame',.12,.034)
  front_panel('尾燈藍圈',f,side*1.07,1.45,.27,.27,'e12blue',.135,.040);lamp('尾燈',f,side*1.07,1.45,.075,red=True)
  lamp('頭燈',f,side*.74,1.43,.090)
 chevron_skirt(f(0,.83)+.05,W,.55,.46)
 return f

# ── 機場捷運（1000 型普通車／2000 型直達車）──────────────────────────────────

# 主色、窗上色帶靠駕駛室那段的過渡色、窗上色帶本色（照片取色）：普通車藍＋淡粉紫，直達車紫＋淡紫。
AP_COLOURS={'airportlocal':('1F78DC','82B8EF','F0D3EA'),'airportexpress':('A85AD0','C9A3E8','E6C9F6')}

def airport_like(s):
 """機捷普通車（1000 型）、直達車（2000 型）：川崎／台灣車輛同一個車體，只換主色。參考：Commons「Kawasaki-TRSC 1000 Series EMU.jpg」
 「Kawasaki-TRSC 2000 Series EMU.jpg」（Samson Ng，CC BY-SA 4.0，斜側）、「Taoyuan MRT train approaching Dayuan February 2026 1.jpg」（4300streetcar，CC BY 4.0，正面）。
 不鏽鋼車身、每側三組雙開門；窗上一條淡色帶（靠駕駛室那段從主色漸層過來）、窗下一條主色腰帶，到車角往下斜成車頭下方的斜線。
 車頭上半是主色面罩：兩片大前窗夾中央逃生門（上半主色、有小窗，下半不鏽鋼），頂端綠字目的地；面罩下緣在車角往上收，
 窗下兩側斜放黑色燈座（外側紅圈尾燈、內側頭燈）；下方灰色防爬器。
 高度依大園站正面照量（車底 .83、車頂 3.50 線性換算）：面罩下緣中央 1.92、車角 2.21；前窗 1.95–3.22；逃生門 1.25–3.00、門窗 2.14–2.78；
 燈座 1.47–1.90；車側腰帶 1.64–1.92、窗上色帶 3.03–3.21（Samson Ng 側面照）。"""
 L,W,H=s['L'],s['W'],s['H'];main,fade,pale=AP_COLOURS[s['id']]
 color('apsilver','BCC3C8',.50,.30,.15);color('aproof','A9B0B4',.40,.42,.08);color('apmain',main,.05,.34,.30)
 color('appale',pale,.05,.34,.25);color('apgrey','8E979C',.40,.36,.12);color('apled','62E07A',.05,.30,.20)
 profile=[(.83,L/2-.10),(1.05,L/2),(1.30,L/2),(2.00,L/2-.03),(2.80,L/2-.09),(H-.22,L/2-.18),(H,L/2-.42)]
 s['bowPow']=3;bands=[(1.78,.28,'apmain'),(3.12,.18,'appale')]
 f,neck,doors=emu_body(s,profile,.14,[(H-.12,'apsilver'),(H+1,'aproof')],[(1.92,'apsilver'),(H+1,'apmain')],
  [(1.64,'apsilver'),(1.92,'apmain'),(3.03,'apsilver'),(3.21,'appale'),(H-.12,'apsilver'),(H+1,'aproof')],leaf='apsilver',gaps=[1,2,2,1],bands=bands,leafbands=bands[:1])
 # 窗上色帶靠駕駛室那段：分四段從本色漸層到過渡色
 x0=neck-1.6;n=4;seg=ramp('apfade',[(0,pale),(1,fade)],n)
 for side in [-1,1]:
  for i,m in enumerate(seg):box('窗上色帶漸層段',(x0+(i+.5)*(neck-x0)/n,side*(W/2+.012),3.12),((neck-x0)/n+.002,.024,.18),m,.003)
 e=W/2-.004;top=lambda y:face_zmax(s,y,.02)
 for side in [-1,1]:
  # 面罩下緣在車角往上收，露出不鏽鋼
  a,b=sorted([side*1.12,side*e]);t=lambda y:(abs(y)-1.12)/(e-1.12)
  front_patch('面罩下緣車角不鏽鋼',f,a,b,1.91,lambda y:1.92+.29*t(y)**1.4,'apsilver',.026,cols=10,rows=4)
  # 前窗外上角斜切
  cut=lambda y,k:k-.9*max(0,abs(y)-1.0)
  a,b=sorted([side*.52,side*1.24]);front_patch('前窗黑框',f,a,b,1.93,lambda y:cut(y,3.25),'frame',.030,cols=16,rows=8)
  a,b=sorted([side*.56,side*1.20]);front_patch('前窗',f,a,b,1.97,lambda y:cut(y,3.21),'glass',.040,cols=16,rows=8)
  wiper(f,side*.86,2.02,.70)
  # 斜放的黑色燈座：內低外高
  a,b=sorted([side*.66,side*1.30]);t=lambda y:(abs(y)-.66)/.64
  lo,hi=pinch(lambda y:1.47+.27*t(y),lambda y:1.73+.17*t(y),a,b,.06)
  front_patch('黑色燈座',f,a,b,lo,hi,'frame',.034,cols=12,rows=5)
  lamp('頭燈',f,side*.86,1.67,.080);lamp('尾燈',f,side*1.08,1.76,.066,red=True)
  a,b=sorted([side*.62,side*e]);t2=lambda y:(abs(y)-.62)/(e-.62)
  front_patch('腰帶車頭斜線',f,a,b,lambda y:1.21+.40*t2(y),lambda y:1.30+.40*t2(y),'apmain',.032,cols=16,rows=2)
 for y in [-.47,.47]:front_patch('逃生門門縫',f,y-.01,y+.01,1.25,3.00,'frame',.032,cols=1,rows=12)
 for z in [1.25,3.00]:front_patch('逃生門門縫',f,-.47,.47,z-.01,z+.01,'frame',.032,cols=12,rows=1)
 front_panel('逃生門窗框',f,0,2.46,.46,.70,'frame',.11,.034);front_panel('逃生門窗',f,0,2.46,.38,.62,'glass',.09,.042)
 front_panel('目的地顯示器',f,0,3.16,.66,.22,'dark',.03,.040);front_panel('目的地字幕',f,0,3.16,.50,.06,'apled',.01,.046)
 front_panel('防爬器',f,0,1.16,2.10,.15,'apgrey',.03,.10)
 for k in range(3):front_panel('防爬器橫紋',f,0,1.11+k*.05,2.00,.012,'chassis',.003,.112)
 front_patch('車頭下方開口',f,-1.0,1.0,.84,1.08,'frame',.020,cols=16,rows=2)
 return f

def airportlocal(s):return airport_like(s)
def airportexpress(s):return airport_like(s)

# ── 環狀線、三鶯線（日立無人駕駛車）────────────────────────────────────────

def hitachi_body(s,zones,front_zones,leaf,leafbands):
 """環狀線與三鶯線共用的車殼：圓鼓車頭、上緣大幅後倒；每側三組雙開門、大面積側窗。車頭塗裝兩款完全不同，各自另貼。"""
 L,W,H=s['L'],s['W'],s['H']
 profile=[(.83,L/2-.14),(1.00,L/2-.03),(1.30,L/2),(1.80,L/2-.04),(2.40,L/2-.14),(2.90,L/2-.32),(H-.10,L/2-.54),(H,L/2-.72)]
 s['bowPow']=2.6
 return emu_body(s,profile,.30,zones,front_zones,zones,leaf=leaf,gaps=[1,2,2,1],leafbands=leafbands)

def y100(s):
 """環狀線（日立）。參考：Commons「C610 at Shisizhang 20260107 (3).jpg」（Sinsyuan，CC BY-SA 4.0，正面）、
 「TRTC Circular Line EMU train by ntpcdorts.jpg」（Department of Rapid Transit Systems, New Taipei City Government，Public domain，斜側）、「環狀線列車車體.jpg」（Ryan lin91，CC BY-SA 4.0）。
 做的是通車時的白色原塗裝（2026 年有整車黃色的廣告車，不做）。白色圓鼓車頭，一圈黃色 U 形環框住黑色大窗區，環的兩臂往上接到車頂、
 再順著車頂邊變成車側的黃色細線；黑色一路到車頂成為頂帽；窗區兩下角各一個花生形燈座；下方一道折線、兩個百葉格柵與中央檢修蓋。
 車側白色，窗帶整條黑色、窗下黃色腰帶（門扇上也有）。高度依正面照量（車底 .83、車頂 3.35）：U 形環下緣 1.51、黑色窗區下緣 1.61、
 前窗 1.95–2.90、燈座 1.46–1.80、折線 1.31、格柵 .93–1.26；車側黑色窗帶 1.64–3.11、黃色腰帶 1.40–1.64（斜側照換算）。"""
 L,W,H=s['L'],s['W'],s['H']
 color('cwhite','EEEDE8',.08,.34,.25);color('cyellow','F2C014',.05,.32,.30);color('cblack','202529',.15,.46,.12)
 color('croof','D5D8D8',.30,.40,.10);color('cgrey','8C9296',.30,.38,.10)
 zones=[(1.40,'cwhite'),(1.64,'cyellow'),(3.11,'cblack'),(3.19,'cyellow'),(H+1,'croof')]
 f,neck,doors=hitachi_body(s,zones,[(H+1,'cwhite')],'cwhite',[(1.52,.24,'cyellow')])
 top=lambda y:face_zmax(s,y,.02)
 m=1.08;lo,_=pinch(lambda y:1.51,top,-m,m,.26)
 front_patch('黃色 U 形環',f,-m,m,lo,top,'cyellow',.026,cols=48,rows=20)
 m=.89;lo,_=pinch(lambda y:1.61,top,-m,m,.22)
 front_patch('黑色窗區與頂帽',f,-m,m,lo,top,'cblack',.032,cols=40,rows=20)
 lo,hi=pinch(lambda y:1.95,lambda y:2.90,-.84,.84,.10)
 front_patch('大片前窗',f,-.84,.84,lo,hi,'glass',.042,cols=32,rows=10)
 # 雨刷平放在窗下黑色區，支點在右下
 use('03');line('雨刷',[(f(.46,1.72)+.055,.46,1.72),(f(-.60,1.93)+.055,-.60,1.93)],.014,'frame')
 for side in [-1,1]:
  for y,z,r in [(1.03,1.65,.15),(.81,1.58,.115)]:front_panel('花生形燈座黑框',f,side*y,z,2*r,2*r,'frame',r,.032)
  for y,z,r in [(1.03,1.65,.125),(.81,1.58,.092)]:front_panel('花生形燈座',f,side*y,z,2*r,2*r,'cwhite',r,.038)
  lamp('頭燈',f,side*1.03,1.65,.068);lamp_color('標識燈',f,side*.81,1.58,.048,'lamp')
  front_panel('百葉格柵底槽',f,side*.86,1.095,.40,.33,'frame',.03,.030)
  for k in range(6):front_panel('格柵百葉',f,side*.86,.97+k*.05,.36,.020,'cwhite',.005,.036)
 front_patch('保險桿折線',f,-(W/2-.004),W/2-.004,1.30,1.32,'cgrey',.028,cols=32,rows=1)
 front_panel('檢修蓋框',f,0,1.10,.31,.31,'cgrey',.03,.028);front_panel('檢修蓋',f,0,1.10,.27,.27,'cwhite',.025,.033)
 return f

def sanying(s):
 """三鶯線（日立，跟環狀線同一個車體）。參考：Commons「Sanying Line EMU @LB01 20260630.jpg」「Sanying Line EMU @LB04 20260702.jpg」（Sinsyuan，CC BY-SA 4.0，正面）、
 「New Taipei Metro Sanying Line EMU 20230830.jpg」（新北市政府，Attribution，斜側）。塗裝跟環狀線完全不同（fleet-v1 的白銀車側不對）：
 淺藍車身，深灰頭盔包住大前窗並延伸成頂帽；窗下一條往兩端上翹的銀色燈眉，兩端各一簇紅白 LED；燈眉下深色凹槽、深灰下裙（兩個百葉格柵、中央檢修蓋）。
 高度依正面照量（車底 .83、車頂 3.35）：前窗 1.90–2.92、燈眉中央 1.66–1.87／兩端 1.78–1.98、凹槽下緣 1.41、下裙 1.33 以下。"""
 L,W,H=s['L'],s['W'],s['H']
 color('sblue','2E9CCB',.08,.32,.28);color('sgun','3A3F44',.25,.44,.12);color('sgrey','45494B',.25,.40,.12);color('ssilver','C9C7BF',.55,.28,.25)
 color('sdark','24292D',.20,.30,.30);color('sroof','B7BDC0',.40,.42,.08);color('sled','6FD3FF',.05,.30,.20)
 zones=[(1.06,'sgrey'),(H-.10,'sblue'),(H+1,'sroof')]
 f,neck,doors=hitachi_body(s,zones,[(1.33,'sgrey'),(H+1,'sblue')],'sblue',())
 top=lambda y:face_zmax(s,y,.02);e=W/2-.004
 bar_lo=lambda y:1.655+.125*(abs(y)/1.28)**2;bar_hi=lambda y:1.865+.115*(abs(y)/1.28)**2
 front_patch('深灰頭盔',f,-1.16,1.16,bar_hi,top,'sgun',.026,cols=40,rows=18)
 for side in [-1,1]:
  a,b=sorted([side*1.16,side*e]);front_patch('頭盔頂部到車角',f,a,b,2.95,top,'sgun',.026,cols=6,rows=4)
 lo,hi=pinch(lambda y:1.90,lambda y:2.92,-.90,.90,.12)
 front_patch('大片前窗',f,-.90,.90,lo,hi,'glass',.040,cols=32,rows=10)
 front_panel('目的地顯示器',f,0,2.82,.76,.11,'dark',.02,.046);front_panel('目的地字幕',f,0,2.82,.60,.05,'sled',.01,.052)
 lo,hi=pinch(bar_lo,bar_hi,-1.30,1.30,.05)
 front_patch('銀色燈眉',f,-1.30,1.30,lo,hi,'ssilver',.034,cols=48,rows=3)
 lo,_=pinch(lambda y:1.41,bar_lo,-1.0,1.0,.10)
 front_patch('燈眉下深色凹槽',f,-1.0,1.0,lo,bar_lo,'sdark',.030,cols=32,rows=4)
 for side in [-1,1]:
  # 燈眉兩端的 LED：上排白、下排紅
  for y,dz,m in [(1.22,.06,'lamp'),(1.14,.05,'lamp'),(1.06,.04,'lamp'),(1.18,-.02,'red'),(1.10,-.03,'red')]:
   lamp_color('LED 頭尾燈',f,side*y,bar_lo(y)+.10+dz,.026,m)
  front_panel('百葉格柵底槽',f,side*.98,1.095,.40,.33,'frame',.03,.030)
  for k in range(6):front_panel('格柵百葉',f,side*.98,.97+k*.05,.36,.020,'sgun',.005,.036)
 front_panel('檢修蓋',f,0,1.06,.30,.28,'sgun',.03,.030)
 return f

# ── 台中捷運綠線、高雄捷運、文湖線 VAL256 ─────────────────────────────────────

def taichung(s):
 """台中捷運綠線（川崎）。參考：Commons「Taichung Metro Green Line EMU at Beitun Main Station 2021-03-25.jpg」（Cheng-en Cheng，CC BY-SA 2.0，正面）、
 「Train approaching Songzhu Station on Taichung Metro Green Line 01.jpg」（Lokseng01，CC BY-SA 4.0）、「2021-03-25 MRT train approaching Songzhu Station.jpg」（Cheng-en Cheng，CC BY-SA 2.0，斜側）。
 白色圓鼓車頭，中央一面上寬下窄的黑色盾形（前窗在裡面、到車頂成為頂帽），兩側白色弧面、最外緣深藍；兩下角斜放黑色燈艙（上頭燈、下尾燈）；
 下方深灰弧形保險桿與兩個通風口，車底兩角白色排障角。車側上半深藍（窗帶）、下半銀色，車底一條嫩綠帶、車頂邊一條嫩綠線、窗中間一條黃綠細線；
 駕駛室側面白色，後緣一道往前上斜的嫩綠＋深藍斜帶。高度依北屯總站正面照量（車底 .83、車頂 3.40）：盾形下緣 1.45、在 1.74 寬 ±.76、到頂寬 ±1.10；
 前窗 2.04–2.97；燈艙 1.22–1.72；保險桿上緣中央 1.17、兩側 1.00。"""
 L,W,H=s['L'],s['W'],s['H']
 color('tcwhite','EEF0EE',.08,.34,.25);color('tcblack','15191D',.20,.22,.45);color('tcnavy','1B2A4A',.10,.32,.30)
 color('tclime','8DC63F',.05,.34,.30);color('tcsilver','C5CACC',.50,.30,.15);color('tcroof','B3B9BC',.40,.42,.08)
 color('tcdark','3A3F43',.30,.38,.12);color('tcline','D7D531',.05,.32,.30)
 profile=[(.83,L/2-.20),(1.00,L/2-.05),(1.20,L/2),(1.70,L/2-.02),(2.30,L/2-.12),(2.90,L/2-.30),(H-.10,L/2-.48),(H,L/2-.64)]
 s['bowPow']=2.6;dt=s['doorTop'];line=[(2.62,.035,'tcline')]
 zones=[(1.10,'tclime'),(2.05,'tcsilver'),(H-.16,'tcnavy'),(H-.08,'tclime'),(H+1,'tcroof')]
 f,neck,doors=emu_body(s,profile,.26,zones,[(.99,'tcdark'),(H+1,'tcwhite')],[(H+1,'tcwhite')],leaf='tcsilver',gaps=[0,1,1,1,1,0],
  bands=line,leafbands=[(1.01,.18,'tclime'),((2.05+dt)/2,dt-2.05,'tcnavy')]+line)
 # 駕駛室側面白色，後緣往前上斜，接嫩綠、深藍兩道斜帶；車頂圓角那段用 shell_wrap 接上去
 xb=lambda z:neck-1.10+.50*(z-.83)/(H-.83);zt=H-s['radiusTop']
 for side in [-1,1]:
  side_paint('駕駛室側面白色',s,f,side,[lambda x,z:x-xb(z)],neck-1.2,L/2,.84,zt,'tcwhite',offset=.026)
  side_paint('駕駛室斜帶嫩綠',s,f,side,[lambda x,z:x-(xb(z)-.20),lambda x,z:xb(z)-x],neck-1.4,neck,.84,zt,'tclime',offset=.026)
  side_paint('駕駛室斜帶深藍',s,f,side,[lambda x,z:x-(xb(z)-.30),lambda x,z:(xb(z)-.20)-x],neck-1.5,neck,.84,zt,'tcnavy',offset=.026)
  shell_wrap('駕駛室側面白色（車頂圓角）',s,f,upper_section(s,zt,H-.16,side),xb,L/2,'tcwhite',.012)
 e=W/2-.004;top=lambda y:face_zmax(s,y,.02)
 def u_lo(y):
  a=abs(y);return 1.445+.30*(max(0,a-.40)/.36)**1.6 if a<=.76 else 1.745+4.44*(a-.76)
 front_patch('黑色盾形',f,-1.10,1.10,u_lo,top,'tcblack',.026,cols=48,rows=20)
 front_patch('前窗',f,-.87,.87,lambda y:2.04+6.6*max(0,abs(y)-.76),rounded_top(2.97,.87,.10),'glass',.036,cols=36,rows=10)
 for side in [-1,1]:
  a,b=sorted([side*1.30,side*e]);front_patch('車角深藍',f,a,b,1.00,top,'tcnavy',.024,cols=4,rows=16)
  front_panel('黑色燈艙',f,side*1.15,1.47,.42,.52,'tcblack',.10,.032)
  lamp('頭燈',f,side*1.20,1.60,.075);lamp('尾燈',f,side*1.13,1.36,.070,red=True)
  front_panel('保險桿通風口',f,side*.72,1.02,.30,.09,'frame',.02,.034)
  box('白色排障角',(f(side*1.15,.83)-.12,side*1.15,.70),(.30,.52,.26),'tcwhite',.06)
 front_patch('深灰保險桿',f,-e,e,.84,lambda y:1.17-.17*(abs(y)/1.42)**2,'tcdark',.028,cols=40,rows=4)
 return f

def kaohsiung(s):
 """高雄捷運（西門子）。參考：Commons「KMRT Gangshan Station 2024.06.30.jpg」（總統府，CC BY 2.0，正面）、「Siemens Modular Metro EMU.jpg」（Samson Ng，CC BY-SA 4.0，斜側）、
 「Color of the Siemens Modular Metro (Kaohsiung MRT) 20241111.jpg」（阿道，CC BY-SA 4.0，車側）。
 平直車頭：上緣青綠頂帽（延伸到駕駛室車頂）、中央頂燈；黑色面罩夾兩扇前窗與中央逃生門（門頂一塊青綠飾板）；面罩下緣是往兩側上揚的笑臉弧，
 弧下一條白線、再下是青綠帶（兩組燈座：外紅內白），最下銀色。車側不鏽鋼、窗下一條青綠寬帶，車頂兩端冷氣箱。
 高度依岡山站正面照量（車底 .83、車頂 3.40）：頂帽下緣中央 2.93、兩側 2.82；前窗 1.84–2.90；笑臉弧中央 1.44、車角 1.74；青綠帶下緣 1.18；燈 1.31。"""
 L,W,H=s['L'],s['W'],s['H']
 color('kssilver','BFC5C7',.50,.30,.15);color('ksteal','10B5AC',.05,.32,.30);color('ksblack','161B20',.20,.22,.45);color('kswhite','F2F3F0',.08,.32,.25)
 color('ksroof','AEB4B7',.40,.42,.08);color('ksdoor','2A3036',.25,.20,.45);color('ksled','F28A2A',.10,.25,.30)
 profile=[(.83,L/2-.06),(1.00,L/2),(2.40,L/2-.02),(3.00,L/2-.10),(H-.12,L/2-.22),(H,L/2-.42)]
 s['bowPow']=4;band=[(1.50,.40,'ksteal')]
 f,neck,doors=emu_body(s,profile,.08,[(H-.12,'kssilver'),(H+1,'ksroof')],[(1.18,'kssilver'),(H+1,'ksblack')],
  [(1.30,'kssilver'),(1.70,'ksteal'),(2.86,'kssilver'),(H+1,'ksteal')],leaf='kssilver',gaps=[0,2,2,2,1],bands=band,leafbands=band)
 shell_wrap('駕駛室青綠頂帽',s,f,upper_section(s,2.86),neck-1.1,L/2,'ksteal')
 e=W/2-.004;top=lambda y:face_zmax(s,y,.02)
 sm=lambda y:1.44+.30*(abs(y)/1.45)**2;cap=lambda y:2.93-.11*(abs(y)/1.45)**2
 front_patch('笑臉弧白線',f,-e,e,lambda y:sm(y)-.09,sm,'kswhite',.028,cols=48,rows=2)
 front_patch('青綠笑臉帶',f,-e,e,1.18,lambda y:sm(y)-.09,'ksteal',.028,cols=48,rows=4)
 for side in [-1,1]:
  a,b=sorted([side*.52,side*e]);front_patch('青綠頂帽',f,a,b,cap,top,'ksteal',.026,cols=16,rows=6)
  a,b=sorted([side*.56,side*1.30]);lo,hi=pinch(lambda y:1.84,lambda y:cap(y)-.03,a,b,.06)
  front_patch('前窗',f,a,b,lo,hi,'glass',.036,cols=16,rows=8)
  front_panel('燈座',f,side*.95,1.31,.54,.25,'ksblack',.10,.034)
  lamp('頭燈',f,side*.83,1.31,.080);lamp('尾燈',f,side*1.07,1.31,.075,red=True)
 front_patch('門上青綠頂帽',f,-.52,.52,3.23,top,'ksteal',.026,cols=12,rows=3)
 front_patch('門頂青綠飾板',f,-.44,.44,2.99,3.17,'ksteal',.030,cols=12,rows=2)
 front_patch('逃生門深色上半',f,-.46,.46,lambda y:sm(y)+.01,2.95,'ksdoor',.030,cols=16,rows=8)
 for y in [-.50,.50]:front_patch('逃生門門縫',f,y-.01,y+.01,1.06,3.22,'frame',.034,cols=1,rows=14)
 for z in [1.06,3.22]:front_patch('逃生門門縫',f,-.50,.50,z-.01,z+.01,'frame',.034,cols=12,rows=1)
 front_panel('目的地顯示器',f,-.91,2.66,.60,.26,'dark',.02,.044);front_panel('目的地字幕',f,-.91,2.66,.48,.09,'ksled',.01,.050)
 lamp('頂部頭燈',f,0,3.29,.055)
 for y in [-.70,.72]:wiper(f,y,1.95,.80)
 front_panel('防爬器',f,0,.90,W-.40,.10,'chassis',.03,.06)
 return f

def val256(s):
 """文湖線 VAL256（馬特拉）。參考：Commons「Matra VAL256, Taipei Metro 20210509.jpg」（Subscriptshoe9，CC BY-SA 4.0）、「Matra-GEC Alsthom VAL256 APM.jpg」（Samson Ng，CC BY-SA 4.0）、
 「Engineering drawings of the VAL 256.jpg」（作者不詳，Attribution，正面與側面工程圖）。白色平頭，一整片圓角大前窗（無人駕駛），窗下一塊白色飾板；
 下方深藍帶、兩側各一大一小圓燈，最下黑色裙板。車側上半白、窗下淺灰藍帶夾深藍細線、下緣深藍。
 走行：每節兩根膠輪單軸，軸的前後兩側各一個水平導向輪，貼在導軌高度（工程圖正面）。
 高度依工程圖正面換算（車底 .83、車頂 3.05）：前窗 1.89–2.87、飾板 1.50–1.85、燈 1.30、裙板 1.06 以下。"""
 L,W,H=s['L'],s['W'],s['H']
 color('vwhite','EEF0EE',.08,.34,.25);color('vblue','2C4C8C',.08,.34,.30);color('vlight','C3CAD3',.30,.34,.15)
 color('vblack','1A1E22',.20,.30,.30);color('vroof','C9CDCE',.35,.40,.10)
 profile=[(.83,L/2-.04),(1.00,L/2),(1.80,L/2-.01),(2.80,L/2-.06),(H-.10,L/2-.16),(H,L/2-.34)]
 s['bowPow']=4
 zones=[(1.05,'vblue'),(1.58,'vlight'),(1.66,'vblue'),(H-.10,'vwhite'),(H+1,'vroof')]
 f,neck,doors=emu_body(s,profile,.06,zones,[(1.06,'vblack'),(1.50,'vblue'),(H+1,'vwhite')],
  [(1.06,'vblack'),(1.50,'vblue'),(H-.10,'vwhite'),(H+1,'vroof')],leaf='vwhite',gaps=[1,2,1],leafbands=[(.985,.13,'vblue'),(1.315,.53,'vlight'),(1.62,.08,'vblue')])
 front_panel('前窗黑框',f,0,2.38,2.20,1.06,'vblack',.15,.030);front_panel('大片前窗',f,0,2.38,2.12,.98,'glass',.13,.040)
 front_panel('窗下飾板框',f,0,1.675,2.16,.33,'vlight',.06,.028);front_panel('窗下飾板',f,0,1.675,2.10,.27,'vwhite',.05,.033)
 for side in [-1,1]:lamp('頭燈',f,side*.98,1.30,.095);lamp('尾燈',f,side*.74,1.30,.070,red=True)
 for y in [-.62,.62]:wiper(f,y,1.95,.60)
 # 水平導向輪：每根軸前後兩側各一個，輪面朝外貼導軌
 use('04')
 for c in s['bogieX']:
  box('導向框架',(c,0,.40),(1.05,W*.84,.08),'chassis',.02)
  for side in [-1,1]:
   for dx in [-.42,.42]:
    cyl('水平導向輪',(c+dx,side*(W/2-.03),.30),.12,.09,'rubber','Z',20)
    cyl('導向輪輪轂',(c+dx,side*(W/2-.03),.30),.05,.11,'metal','Z',12)
    box('導向輪臂',(c+dx,side*(W/2-.20),.36),(.10,.30,.06),'chassis',.01)
 return f

# ── 台鐵 GE 電力機車（E200／E300／E400、鳴日號 E405）與 E500、R200 ──────────────────────────
# E200、E300、E400 照片上是同一個車體（E333 與 E202 並排正面、E236／E311／E415 側面）：車窗、色帶、受電弓都一樣，只差車號，三款共用 ge_loco。
# 高度依 E236 正側面照與 E333 正面照量（車頂 3.45、車身下緣 .83 定比例）：車側橘色到 2.28、奶油色帶 2.28–2.44、橘細線 2.44–2.50、上半奶油色；
# 奶油色帶在車角繞到正面變成 V 字，中央降到 1.33–1.56。車側是平滑的大板，沒有百葉（fleet-v1 的百葉不對）。鳴日號是 E405 換塗裝，兩端塗裝不同。

GE_SIDE=[(2.28,'georange'),(2.44,'gecream'),(2.50,'georange')]
GE_V_LO=[(0,1.33),(.63,1.83),(1.21,2.14),(1.425,2.28)]
GE_V_HI=[(0,1.56),(.38,1.84),(.63,2.01),(1.21,2.29),(1.425,2.44)]

def ge_colours():
 color('georange','EC7838',.05,.34,.30);color('gecream','F2EEDC',.06,.34,.26);color('gerubber','1A1E21',.20,.30,.30);color('geroof','8E979B',.40,.42,.08)
 color('mblack','15181D',.12,.30,.40);color('morange','D2441A',.05,.32,.32);color('mgold','C9A54E',.70,.28,.20)

def mirror_cab(objs):
 """建在 +X 端的駕駛室複製一份到 −X 端。copy_rotated 讀 matrix_world，先更新場景，剛設好位置的字牌才不會被複製到原點。"""
 bpy.context.view_layer.update();copy_rotated(objs)

def to_rear(objs):
 """建在 +X 端的零件整組轉 180° 到 −X 端（兩端塗裝不同的雙頭車、單頭車後端牆用；copy_rotated 會留下原件）。"""
 bpy.context.view_layer.update();R=Matrix.Rotation(math.pi,4,'Z')
 for o in objs:o.matrix_world=R@o.matrix_world

def cab_door(x,side,y,w,z0,z1,win,frame):
 """駕駛室側門：只畫門縫（四條細線，車身塗裝照常透出來）、門上小窗、兩側登車扶手、門下兩階踏階。y 是車側半寬，win=(門窗下緣, 上緣)。"""
 use('02');yy=side*(y+.010)
 for xx in [x-w/2,x+w/2]:box('側門門縫',(xx,yy,(z0+z1)/2),(.014,.010,z1-z0),frame,.002)
 for zz in [z0,z1]:box('側門門縫',(x,yy,zz),(w,.010,.014),frame,.002)
 a,b=win;panel('門窗窗框',(x,side*(y+.008),(a+b)/2),w-.14,b-a+.05,frame,r=.04)
 panel('門窗玻璃',(x,side*(y+.018),(a+b)/2),w-.20,b-a,'glass',r=.03,depth=.012)
 for xr in [x-w/2-.07,x+w/2+.07]:rod('登車扶手',(xr,side*(y+.05),z0+.10),(xr,side*(y+.05),z0+1.40),.016,'metal')
 for z in [.38,.62]:box('登車踏階',(x,side*(y-.02),z),(w-.08,.16,.04),'metal',.008)

def ge_cab(s,f,lamp_box):
 """GE 機車一端的駕駛室，建在 +X 端（呼叫端再複製或轉到後端）：兩扇黑框圓角前窗、窗上垂下的雨刷（每扇兩支）、窗下扶手、兩塊黑底車號牌、
 車頂前緣凸出的頭燈箱（兩顆頭燈、上面兩支氣笛）、上角暗紅標識燈；駕駛室側面前方兩片拉窗、後面側門（門上小窗），門下踏階。
 位置照 E333 正面照（橫向 437 px/m）：前窗 |y| .09–1.20、2.66–3.12；車號牌中心 |y| .65、2.16–2.37；頭燈箱寬 .46、頭燈 |y| .11；標識燈 |y| .70、3.24。
 側面順序照 E236 斜側照：車角後面先是兩片拉窗，再來是側門與爬梯。"""
 W,H=s['W'],s['H']
 for sd in [-1,1]:
  a,b=sorted([sd*.09,sd*1.20]);lo,hi=pinch(lambda y:2.66,lambda y:3.12,.09,1.20,.09)
  front_patch('前窗黑框',f,a,b,lambda y:lo(abs(y)),lambda y:hi(abs(y)),'gerubber',.030,cols=24,rows=8)
  a,b=sorted([sd*.13,sd*1.16]);lo,hi=pinch(lambda y:2.70,lambda y:3.08,.13,1.16,.065)
  front_patch('前窗玻璃',f,a,b,lambda y:lo(abs(y)),lambda y:hi(abs(y)),'glass',.036,cols=24,rows=8)
  use('03')
  for y in [.40,.86]:
   a=(sd*y,3.05);b=(sd*(y-.07),2.78);line('雨刷',[(f(*a)+.045,*a),(f(*b)+.045,*b)],.012,'gerubber')
  line('窗下扶手',[(f(sd*.30,2.56)+.07,sd*.30,2.56),(f(sd*.85,2.56)+.07,sd*.85,2.56)],.015,'metal')
  front_panel('車號牌',f,sd*.65,2.265,.41,.21,'gerubber',.025,.030);face_label(s['label'],f,sd*.65,2.265,.044,.10)
  lamp('標識燈',f,sd*.70,3.24,.040,red=True)
 xh=f(0,3.30);use('03');box('車頂頭燈箱',(xh-.12,0,3.42),(.30,.46,.36),lamp_box,.05)
 for y in [-.11,.11]:lamp('頂部頭燈',lambda yy,zz:xh-.04,y,3.38,.065)
 for y in [-.12,.12]:cyl('氣笛',(xh-.18,y,3.64),.040,.26,'metal','X',16)
 for side in [-1,1]:
  y=side*(W/2+.014);use('02')
  panel('駕駛室拉窗窗框',(3.50,y,2.80),.70,.46,'gerubber',r=.05)
  for x in [3.33,3.67]:panel('駕駛室拉窗玻璃',(x,y+side*.012,2.80),.30,.38,'glass',r=.035,depth=.012)
  cab_door(2.80,side,W/2,.50,1.00,3.00,(2.48,2.90),'gerubber')

def ge_pilot(s,f,material=None):
 """車身下緣以下的排障板（E200 系黃黑警戒斜紋；鳴日號兩端分別是黑色、橘色素板）與車鉤。"""
 W=s['W'];x=f(0,.83)+.02
 if material:use('03');box('排障板',(x+.03,0,.47),(.055,W*.92,.60),material,.015)
 else:hazard(x,W,.47,.60)
 coupler(f(0,.83)-.12,W,1,z=.62)

def ge_roof(s):
 """車頂：兩端各一組單臂受電弓（2013 年受電弓特寫、2024 年 E311 側面照都是單臂；fleet-v1 的菱形弓不對）、中央設備台與兩座電阻器、兩弓之間的高壓母線。"""
 L,W,H=s['L'],s['W'],s['H'];use('05')
 for x in [-2.45,2.45]:pantograph(x,H)
 box('車頂設備台',(0,0,H+.03),(3.0,1.40,.10),'geroof',.03)
 for x in [-.75,.75]:
  box('車頂電阻器',(x,0,H+.15),(1.0,1.0,.16),'chassis',.03)
  for k in range(6):box('電阻器頂部格柵',(x-.40+k*.16,0,H+.235),(.035,.90,.012),'geroof',.002)
 for x in [-1.9,-.3,.3,1.9]:cyl('母線瓷瓶',(x,.62,H+.10),.045,.20,'cream',n=12)
 line('屋頂高壓母線',[(-2.2,.62,H+.21),(2.2,.62,H+.21)],.018,'metal')

def ge_loco(s,livery='ge'):
 """GE 電力機車車體（雙頭）：車頭下半垂直、前窗往後倒約 25°、上緣大圓角接車頂；平面上是平頭小圓角。"""
 L,W,H=s['L'],s['W'],s['H'];ge_colours()
 profile=[(.83,L/2-.02),(.95,L/2),(2.50,L/2),(2.62,L/2-.04),(3.12,L/2-.27),(3.30,L/2-.40),(H,L/2-.64)]
 s['bowPow']=4
 if livery=='mingri':zones=fz=[(H+1,'mblack')]
 else:zones=GE_SIDE+[(H+1,'gecream')];fz=[(2.49,'georange'),(H+1,'gecream')]
 f,neck=zoned_shell(s,profile,.10,zones,fz,nose_zones=zones,double=True);m=W/2-.004
 if livery=='mingri':
  # A 端（+X）：全黑，中央一道寬 .73 的橘色直帶從車頂到下緣；右車號牌下方金色圓徽；黑色排障板
  front_patch('橘色直帶',f,-.365,.365,.84,H-.03,'morange',.010,cols=12,rows=30)
  ge_cab(s,f,'morange');front_panel('金色圓徽',f,.92,2.03,.34,.34,'mgold',.17,.034);ge_pilot(s,f,'mblack')
  # B 端：上半黑、下半橘，交界與下面那道黑色弧線都是中央低、兩角高（E405 正面照量）；車號牌之間偏左一枚金色大圓徽；橘色排障板。先建在 +X 再整組轉到 −X
  head=len(p.MODEL)
  zb=lambda y:1.92+.20*(abs(y)/1.425)**1.2;c=lambda y:1.65+.36*(abs(y)/1.425)**1.1;th=lambda y:.04-.015*abs(y)/1.425
  front_patch('橘色下半',f,-m,m,.84,zb,'morange',.010,cols=48,rows=10)
  front_patch('黑色弧線',f,-m,m,lambda y:c(y)-th(y),lambda y:c(y)+th(y),'mblack',.016,cols=48,rows=2)
  ge_cab(s,f,'mblack');front_panel('金色圓徽',f,-.26,2.21,.40,.40,'mgold',.20,.034);ge_pilot(s,f,'morange')
  to_rear(list(p.MODEL[head:]))
  # 車側：B 端駕駛室下半橘色，上緣往 A 端下降、在離 A 端約三分之一處以圓弧收掉；橘色裡一道黑色細線跟著上緣走（細帶 .10、黑線 .05，車角跟 B 端正面接上）
  def t(x):
   u=(x+L/2)/L
   if u<.12:return 2.12+.13*u/.12
   v=(u-.12)/.53;return .83+1.42*math.sqrt(1-v*v) if v<1 else .83
  rear=lambda x,z:x+f(W/2,z)-.004
  for side in [-1,1]:
   side_paint('車側橘色細帶',s,f,side,[rear,lambda x,z:t(x)-z,lambda x,z:z-t(x)+.10],-L/2,1.5,.95,2.30,'morange',step=.08)
   side_paint('車側橘色下半',s,f,side,[rear,lambda x,z:t(x)-.15-z],-L/2,1.5,.95,2.10,'morange',step=.08)
 else:
  head=len(p.MODEL)
  front_patch('V 字奶油色帶',f,-m,m,lambda y:interp(GE_V_LO,abs(y)),lambda y:interp(GE_V_HI,abs(y)),'gecream',.010,cols=48,rows=4)
  ge_cab(s,f,'gecream');ge_pilot(s,f)
  mirror_cab(list(p.MODEL[head:]))
 ge_roof(s)
 bogies(L,W,axles=3,r=.42)
 return f

def e200(s):
 """E200 電力機車（GE）。參考：Commons「TRA E236 at Hsinchu Station.jpg」（Lokseng01，CC BY-SA 4.0，斜側）、
 「TRA E236 and TPC Hsinchu Branch 20210328.jpg」（Solomon203，CC BY-SA 4.0，正側面，色帶高度）、「TRA E333 and E202 at Changhua Rolling Stock Branch.jpg」
 （ChS&Rh，CC BY-SA 4.0，正面）、「TRA E200 PANTOGRAPH.JPG」（CCY18999，CC BY-SA 3.0，單臂受電弓）。
 橘色車身、上半奶油色，奶油色帶在車角繞到正面變成 V 字；兩扇黑框圓角前窗，前窗往後倒；車頂前緣凸出頭燈箱；車側平滑沒有百葉；黃黑警戒排障板。"""
 return ge_loco(s)

def e300(s):
 """E300 電力機車（GE）。跟 E200 同一個車體（E333 與 E202 並排正面照、「TR E311 passing Platform 1, Baifu Station 20240705.jpg」（Solomon203，CC BY-SA 4.0）側面一樣），只差車號。"""
 return ge_loco(s)

def e400(s):
 """E400 電力機車（GE）。跟 E200 同一個車體（「TRA E415 at Hsinchu Station.jpg」（Tbatb，CC BY-SA 4.0）的車窗、色帶、受電弓一樣），只差車號。"""
 return ge_loco(s)

def mingri(s):
 """鳴日號經典車頭（E405，E400 換塗裝）。參考：Commons「TRA E405 Front.jpg」「TRA E405 Rear.jpg」（臺灣鐵路管理局，兩端正面）、
 「TRA E405 with Future passenger cars at Taitung Station 20210117.jpg」（Kazehayashi，CC BY-SA 4.0，A 端與車側）、
 「TRA E405 at Taitung Station 20210811.jpg」「TRA E405 at Platform 3B, Nangang Station 20210811.jpg」（Tzuhsun Hsu，CC BY-SA 2.0，B 端近照與車側）。
 兩端不同：A 端全黑、中央一道橘色直帶；B 端上黑下橘、中間一道往中央下彎的黑色弧線，弧線延伸到車側；車側橘色從 B 端往 A 端收窄、圓弧收尾。
 B 端交界高度照「Front」正面照量（橫向 185 px/m）：中央 1.92、|y| 1.09 處 2.07；黑色弧線中央 1.61–1.69、|y| 1.09 處 1.90–1.95。"""
 return ge_loco(s,'mingri')

def e500(s):
 """E500 電力機車（東芝，雙頭）。參考：Commons「TRA E501 Kita-Fuchū 20230820.jpg」「TRA E501 Kita-Fuchū side 20230820.jpg」（Rsa，CC BY-SA 3.0，斜前方與正側面）、
 「臺鐵E500型電力機車.jpg」（Mafalda4144，CC BY-SA 4.0，正面）。
 整車橘色、車側平滑沒有百葉（fleet-v1 的六片百葉不對）；車頭上半一整片深灰面罩包住大前窗，面罩往後包住駕駛室頂；面罩頂端中央兩顆頭燈；
 前窗下方左右黑色燈座各一白一紅兩顆圓燈；面罩下緣在兩角往上收成圓弧；下巴以下是深灰端梁、兩角橘色側裙。車頂淺灰，中央兩段高起的設備罩、
 每段五片格柵蓋，兩端各一組單臂受電弓。高度依正面照量（橫向 161 px/m）：橘色下巴 1.25–2.18、前窗 2.34–3.20（半寬 1.20）、燈座 1.52–1.85（|y| .62–1.24）。"""
 L,W,H=s['L'],s['W'],s['H']
 color('e5orange','F06A2E',.05,.32,.30);color('e5dark','2E3236',.25,.30,.30);color('e5roof','BCC2C6',.40,.40,.08);color('e5grille','7E868B',.45,.40,.08)
 profile=[(.83,L/2-.02),(.95,L/2),(2.18,L/2),(2.30,L/2-.03),(3.20,L/2-.36),(3.38,L/2-.47),(H,L/2-.66)]
 s['bowPow']=4;zones=[(3.18,'e5orange'),(H+1,'e5roof')]
 f,neck=zoned_shell(s,profile,.12,zones,[(1.25,'e5dark'),(2.18,'e5orange'),(H+1,'e5dark')],nose_zones=zones,double=True)
 head=len(p.MODEL);m=W/2-.004
 for sd in [-1,1]:
  a,b=sorted([sd*1.16,sd*m]);front_patch('面罩兩角橘色',f,a,b,2.17,lambda y:2.18+.34*((abs(y)-1.16)/(m-1.16))**2,'e5orange',.006,cols=8,rows=4)
  a,b=sorted([sd*1.27,sd*m]);front_patch('下巴兩角橘色',f,a,b,.84,1.26,'e5orange',.006,cols=4,rows=4)
  lamp_pair(f,sd*.93,1.685,False,True,r=.095,gap=.30,housing='e5dark',hw=.62,hh=.33)
 lo,hi=pinch(lambda y:2.34,lambda y:3.20,-1.20,1.20,.14)
 front_patch('前窗玻璃',f,-1.20,1.20,lo,hi,'glass',.030,cols=40,rows=10)
 use('03')
 for a,b in [((-1.0,2.40),(-.22,2.46)),((.02,2.40),(.80,2.46))]:line('雨刷',[(f(*a)+.040,*a),(f(*b)+.040,*b)],.012,'e5dark')
 for y in [-.13,.13]:lamp('頂部頭燈',f,y,3.37,.060)
 face_label(s['label'],f,-.80,3.07,.040,.075,tilt=True)
 x0=f(0,.83);use('03');box('深灰端梁',(x0-.02,0,.58),(.10,W*.84,.50),'e5dark',.02)
 for sd in [-1,1]:box('橘色側裙',(x0-.25,sd*(W/2-.07),.60),(.50,.10,.46),'e5orange',.02)
 coupler(x0-.12,W,1,z=.62)
 shell_wrap('駕駛室深灰頂帽',s,f,upper_section(s,3.18),2.80,L/2,'e5dark',.010)
 for side in [-1,1]:
  y=side*(W/2+.014);use('02')
  panel('駕駛室側窗窗框',(3.70,y,2.78),.46,.48,'e5dark',r=.05)
  panel('駕駛室側窗玻璃',(3.70,y+side*.012,2.78),.38,.40,'glass',r=.04,depth=.012)
  cab_door(3.05,side,W/2,.48,1.00,3.05,(2.45,2.90),'e5dark')
 mirror_cab(list(p.MODEL[head:]))
 use('05')
 for x0,x1 in [(-2.0,-.10),(.10,2.0)]:
  roof_hood('車頂設備罩',s,x0,x1,W*.62,.14,.10,'e5roof')
  for k in range(5):
   x=x0+.10+(k+.5)*(x1-x0-.20)/5;box('格柵蓋',(x,0,H+.15),(.32,1.20,.02),'e5grille',.004)
   for d in range(5):box('格柵條',(x-.13+d*.065,0,H+.165),(.02,1.12,.012),'e5roof',.002)
 for x in [-2.55,2.55]:pantograph(x,H)
 bogies(L,W,axles=3,r=.42)
 return f

def r200(s):
 """R200 柴電機車（Stadler，單頭）。參考：Commons「TRA R201 on its test run on the Yilan Line.jpg」（jason199567，CC BY-SA 4.0，斜前方）、
 「TRA R201 at TRA Changhua Roundhouse 20231112.jpg」（Rsa，CC BY-SA 3.0）、「臺鐵局R200新柴電機車見面會活動照片 03.jpg」（臺灣鐵路管理局，正側面）、
 「TRA R200 203.jpg」（Qhlsohandsome，CC BY-SA 4.0，正面）、「TRA R200 locomotive front side view April 2026.jpg」「Houtong station February 2026 1.jpg」（4300streetcar，CC BY 4.0，車頂）。
 白色車身；機房側面一大片深藍板（駕駛室後方留一段白），板上一組大百葉、後段一組小百葉；藍板下白細線、深藍細帶、白細線，最下黑色裙板；
 機房車頂深藍：中段高起的引擎罩與排氣消音器、後段兩座圓形散熱風扇；駕駛室頂白色。車頭：黑框環繞大前窗、窗上黑帶與頂部頭燈、窗下黑帶與扶手；
 白色下巴兩角黑色燈座（白燈＋紅燈）、中央黑色格柵、下面黑色端梁。高度照正側面照量（車頂 3.70、車身下緣 .80 定比例）：黑裙 .83–1.30、白線 1.30–1.40、
 藍帶 1.40–1.53、藍板 1.60–2.76、白帶 2.76–3.00；車頭照正面照（橫向 128 px/m）：前窗 2.52–3.36、窗下黑帶 2.09–2.48、燈座 1.38–1.75（|y| .90 起）。"""
 L,W,H=s['L'],s['W'],s['H']
 color('r2white','F2F3F1',.06,.32,.26);color('r2navy','173660',.10,.34,.30);color('r2black','121416',.20,.30,.30)
 color('r2grille','0E1E36',.20,.40,.10);color('r2slat','3A3F44',.30,.40,.10)
 # 後端白燈用不發光的鏡片：lamp 材質是車頭端的真值（verify_garage_facing、海岸行旅與 App 的車燈都看它），單頭車只放在駕駛室那端
 color('r2lens','EDE3C2',.10,.30,.30)
 profile=[(.83,L/2-.02),(.95,L/2),(2.09,L/2),(2.48,L/2-.05),(3.40,L/2-.44),(3.56,L/2-.58),(H,L/2-.80)]
 s['bowPow']=3;zones=[(1.30,'r2black'),(1.40,'r2white'),(1.53,'r2navy'),(3.00,'r2white'),(H+1,'r2navy')]
 nz=[(1.30,'r2black'),(1.40,'r2white'),(1.53,'r2navy'),(H+1,'r2white')]
 f,neck=zoned_shell(s,profile,.22,zones,[(2.09,'r2white'),(H+1,'r2black')],nose_zones=nz)
 # 車頭
 lo,hi=pinch(lambda y:2.52,lambda y:3.36,-1.40,1.40,.12)
 front_patch('環繞前窗',f,-1.40,1.40,lo,hi,'glass',.030,cols=40,rows=10)
 face_label(s['label'],f,-.85,3.22,.040,.075,tilt=True);lamp('頂部頭燈',f,0,3.55,.065)
 for sd in [-1,1]:
  use('03');line('窗下扶手',[(f(sd*.45,2.30)+.07,sd*.45,2.30),(f(sd*1.0,2.30)+.07,sd*1.0,2.30)],.016,'metal')
  a,b=sorted([sd*.90,sd*1.38]);lo,hi=pinch(lambda y:1.38,lambda y:1.75,.90,1.38,.05)
  front_patch('頭燈燈座',f,a,b,lambda y:lo(abs(y)),lambda y:hi(abs(y)),'r2black',.016,cols=10,rows=4)
  lamp('頭燈',f,sd*1.04,1.565,.075);lamp('尾燈',f,sd*1.25,1.565,.050,red=True);lamp('標識燈',f,sd*.57,1.38,.030)
 front_patch('下方黑色格柵',f,-.75,.75,.86,1.30,'r2black',.012,cols=12,rows=4)
 for k in range(4):front_patch('格柵橫條',f,-.70,.70,.92+k*.10,.95+k*.10,'r2slat',.018,cols=8,rows=1)
 x0=f(0,.83);use('03');box('黑色端梁',(x0-.03,0,.60),(.10,W*.88,.46),'r2black',.02);coupler(x0-.12,W,1,z=.62)
 # 駕駛室：白色車頂、側窗、側門；機房深藍側板（駕駛室後方留一段白）、百葉與檢修門
 shell_wrap('駕駛室白色車頂',s,f,upper_section(s,3.00),2.0,L/2,'r2white',.010);xn=L/2-.36*L
 for side in [-1,1]:
  y=side*(W/2+.014);use('02')
  panel('駕駛室側窗窗框',(3.26,y,2.74),.86,.70,'r2black',r=.06)
  panel('駕駛室側窗玻璃',(3.26,y+side*.012,2.74),.78,.62,'glass',r=.05,depth=.012)
  cab_door(2.50,side,W/2,.46,1.32,2.95,(2.40,2.85),'r2black')
  side_prism('機房深藍側板',[(-L/2,1.60),(xn,1.60),(xn,2.76),(-L/2,2.76)],side,W/2+.008,'r2navy')
  for xc,w,h,n in [(-.99,.62,.86,12),(-3.85,.36,.70,10)]:
   use('02');panel('機房百葉框',(xc,side*(W/2+.012),2.16),w,h,'r2grille',r=.02)
   for k in range(n):box('機房百葉',(xc,side*(W/2+.024),2.16-h*.44+h*.88*k/(n-1)),(w-.04,.014,.03),'r2navy',.003)
  for xx in [-3.10,-2.35]:box('檢修門門縫',(xx,side*(W/2+.012),2.18),(.014,.010,1.04),'r2grille',.002)
  for zz in [1.66,2.70]:box('檢修門門縫',(-2.725,side*(W/2+.012),zz),(.75,.010,.014),'r2grille',.002)
 # 後端牆（單頭車的後端）：兩角燈座、扶手、黑色端梁與車鉤；先建在 +X 平面再整組轉到 −X
 head=len(p.MODEL);g=lambda y,z:L/2
 for sd in [-1,1]:
  front_panel('後端燈座',g,sd*1.05,1.75,.46,.22,'r2black',.05,.010)
  lamp_color('後端頭燈',g,sd*.94,1.75,.060,'r2lens');lamp('後端尾燈',g,sd*1.16,1.75,.045,red=True)
  use('07');rod('後端扶手',(L/2+.06,sd*.75,1.40),(L/2+.06,sd*.75,2.40),.016,'metal')
 use('07');box('後端牆下緣黑色',(L/2+.006,0,1.065),(.012,W-.04,.47),'r2black',.004)
 box('後端黑色端梁',(L/2+.03,0,.60),(.10,W*.88,.46),'r2black',.02);coupler(L/2-.10,W,1,z=.62)
 to_rear(list(p.MODEL[head:]))
 # 車頂：機房中段高起的引擎罩與排氣消音器、後段兩座圓形散熱風扇
 use('05');roof_hood('車頂引擎罩',s,-1.13,1.97,W*.62,.22,.25,'r2navy')
 box('排氣消音器',(.55,0,H+.28),(.80,.56,.16),'r2black',.04);cyl('排氣管',(.85,0,H+.42),.07,.16,'r2black')
 for x in [-2.05,-3.25]:
  cyl('散熱風扇外圈',(x,0,H+.04),.46,.14,'r2navy');cyl('散熱風扇護網',(x,0,H+.115),.40,.02,'r2black')
  for d in [-.24,-.08,.08,.24]:box('護網橫條',(x,d,H+.127),(.70,.022,.012),'r2slat',.002)
 bogies(L,W,axles=3,r=.42)
 use('04');box('燃油箱',(0,0,.56),(3.2,W*.80,.48),'r2black',.08)
 return f

# ── 柴電機車：EMD 鼻端式（R20、R100、藍皮 R135、R150、R180）與 DHL100 調車機車 ──────────────────────────
# 車頭（+X）都是短鼻那端；lamp 材質只放這端（裁示 55），長機房那端的頭燈用不發光鏡片 hdlens。
# 高度照片換算：實車走道（車架上緣）放在 1.30，往上照實車比例縮到 fleet-v1 的車高；長度沿用 fleet-v1 的 L，短鼻與駕駛室少壓、長機房多壓。

def hood_colours(livery='orange'):
 color('hdbody','232E48' if livery=='blue' else 'EC7838',.06,.36,.26);color('hdwhite','F2EEDC',.06,.34,.26);color('hdblack','1A1E21',.20,.30,.30)
 color('hdframe','2A2E31',.30,.40,.12);color('hdgrey','9AA3A7',.40,.42,.08);color('hdlight','C9CED0',.30,.40,.10);color('hdslat','3A3F44',.30,.40,.10)
 color('hdrail','EEEDE6',.10,.35,.20);color('hdplow','9DA4A8' if livery=='blue' else '50565A',.45,.40,.08);color('hdhose','8E2B26',.05,.45,.10)
 color('hdlens','EDE3C2',.10,.30,.30)

def block(name,rings,material,bevel=.015):
 """沿 X 放樣的方塊（引擎蓋、短鼻、駕駛室）：rings=[(x, 半寬, 底, 頂, 上圓角), ...]，斷面平底、上兩角圓角，兩端封口。"""
 secs=[(x,loaf(2*hw,zb,zt,.002,rt)) for x,hw,zb,zt,rt in rings];n=len(secs[0][1]);k=len(secs)
 v=[(x,y,z) for x,sec in secs for y,z in sec]
 f=[tuple(range(n)),tuple(range((k-1)*n,k*n))]+[(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for i in range(k-1) for j in range(n)]
 use('01');return mesh(name,v,f,material,bevel,True)

def rounded_ends(x0,x1,zt,rf=0,rb=0,n=6):
 """方塊頂緣的側面輪廓 [(x, 頂), ...]：前端（x1）、後端（x0）的上緣各自往下圓，半徑 rf、rb。"""
 out=[(x0+rb-rb*math.sin(a),zt-rb+rb*math.cos(a)) for a in [math.pi/2*(1-i/n) for i in range(n)]] if rb else []
 out+=[(x0+rb,zt),(x1-rf,zt)]
 if rf:out+=[(x1-rf+rf*math.sin(a),zt-rf+rf*math.cos(a)) for a in [math.pi/2*i/n for i in range(1,n+1)]]
 return out

def plan_band(name,pts,z0,z1,material):
 """沿車身平面輪廓（[(x, y), ...]，y>0 那側由後往前）貼的水平色帶，左右各一條；每段沿自己的外法線浮出車身。"""
 use('01')
 for side in [-1,1]:
  for (xa,ya),(xb,yb) in zip(pts,pts[1:]):
   l=math.hypot(xb-xa,yb-ya);nx,ny=-(yb-ya)/l,(xb-xa)/l
   v=[(x+nx*d,side*(y+ny*d),z) for d in (.002,.010) for x,y in ((xa,ya),(xb,yb)) for z in (z0,z1)]
   mesh(name,v,[(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)],material)

def louver(name,x,y,z,w,h,n,frame='hdblack',slat='hdslat'):
 """車側百葉：深色底框裡 n 條水平百葉片；y 帶正負號（車側面的位置）。"""
 side=1 if y>0 else -1;use('02');panel(name+'框',(x,y+side*.004,z),w,h,frame,r=.02)
 for k in range(n):box(name,(x,y+side*.016,z-h*.40+h*.80*k/max(1,n-1)),(w-.05,.014,.022),slat,.003)

def bar_grille(name,x,y,z,w,h,n,frame='hdblack',bar='hdslat'):
 """車側直條格柵（散熱器、進氣口）：深色底框裡 n 支直條。"""
 side=1 if y>0 else -1;use('02');panel(name+'框',(x,y+side*.004,z),w,h,frame,r=.02)
 for k in range(n):box(name,(x-w*.42+w*.84*k/max(1,n-1),y+side*.016,z),(.022,.014,h-.06),bar,.003)

def wing(name,f,hw,z0,z1,tip):
 """短鼻正面的白色 V 字飛翼：兩角接車側腰帶（z0–z1），往中央下彎到 tip（V 尖下緣），中央寬度是腰帶的兩倍。"""
 t=z1-z0;lo=lambda y:tip+(z0-tip)*abs(y)/hw;hi=lambda y:tip+2*t+(z1-tip-2*t)*(abs(y)/hw)**1.2
 front_patch(name,f,-hw,hw,lo,hi,'hdwhite',.010,cols=48,rows=4)

def loco_bogies(L,W,axles,r):
 """轉向架；拿掉 `bogies` 順手放的電聯車車下設備箱（機車沒有，圓筒油箱、短油箱包不住會露出來），車底主梁保留。"""
 bogies(L,W,axles=axles,r=r)
 for o in [o for o in p.MODEL if o.name.split('.')[0] in ('車下獨立設備箱','設備箱通風格柵')]:p.MODEL.remove(o);bpy.data.objects.remove(o,do_unlink=True)

def end_gear(xe,W,beam=(.33,1.27)):
 """車端設備（建在 +X 端，呼叫端再複製到另一端）：黃黑 V 字警戒端梁、下方排障器、車鉤、制軔軟管、端梁兩側黑色解聯桿、兩角踏階。"""
 a,b=beam;chevron_skirt(xe-.02,W,(a+b)/2,b-a);use('03');box('排障器',(xe-.05,0,a-.07),(.10,W*.80,.16),'hdplow',.02)
 coupler(xe-.12,W,1,z=.72)
 for sd in [-1,1]:
  line('制軔軟管',[(xe+.03,sd*.32,.88),(xe+.11,sd*.36,.64),(xe+.07,sd*.42,.46)],.022,'hdhose')
  zl=b-.37;line('解聯桿',[(xe+.07,sd*1.13,zl-.20),(xe+.07,sd*1.10,zl),(xe+.07,sd*.40,zl+.04),(xe+.10,sd*.24,.86)],.018,'hdblack')
  rod('解聯桿座',(xe+.01,sd*1.10,zl),(xe+.07,sd*1.10,zl),.014,'hdblack')
  use('07');box('踏階側板',(xe-.20,sd*(W/2-.04),.80),(.24,.025,.64),'hdframe',.005)
  for z in [.54,.82,1.10]:box('端部踏階',(xe-.20,sd*(W/2-.20),z),(.24,.30,.035),'metal',.006)

def emd_loco(s,nose=1.0,nose_r=.28,cab=1.85,sill=.96,roof='hdbody',cabroof=None,drop=(.76,.86),fans=2,tank='long',
 groups=(),intake=False,ac=False,livery='orange',high=False):
 """EMD 鼻端式柴電機車（建法說明在各款 docstring）。high：R20 的高短鼻（短鼻跟長機房一樣高、比駕駛室窄，正面切角、牌與頭燈在正面上方）。
 groups：長機房側面百葉組 [(離駕駛室後緣的 x, 寬, 種類)]，'door' 腰帶上下各一片、'col' 窄直欄、'small' 只有腰帶上一片。"""
 L,W,H=s['L'],s['W'],s['H'];hood_colours(livery);xe=L/2;deck=1.30;lab=s['label']
 xn1=xe-.30;xn0=xn1-nose;xc1=xn0;xc0=xc1-cab;xh0=-xe+.30;rt=.24
 hhw,htop=(1.08,H-.19) if high else (1.22,H-.04)
 chw,cflat,cset=(1.30,1.30,0) if high else (1.30,.74,.30)
 nhw,ntop=(hhw,htop) if high else (.88,2.50)
 z0,z1=(1.98,2.14) if high else (2.00,2.17)
 # 車架、轉向架、車底
 use('01');box('車架側樑',(0,0,(sill+deck)/2),(L-.02,W-.04,deck-sill),'hdframe',.02)
 loco_bogies(L,W,3,.42);use('04')
 if tank=='long':box('燃油箱',(0,0,.63),(3.0,W*.78,.54),'hdframe',.06)
 elif tank=='drum':cyl('圓筒燃油箱',(0,0,.58),.29,2.6,'hdframe','X',32)
 elif tank=='short':box('圓角燃油箱',(0,0,.63),(2.7,W*.74,.58),'hdframe',.16)
 else:
  box('燃油箱',(-.75,0,.60),(1.0,W*.70,.52),'hdframe',.05);box('電池箱',(.55,0,.60),(1.0,W*.70,.52),'hdframe',.03)
  for k in range(4):box('電池箱蓋板縫',(.15+k*.27,0,.60),(.012,W*.71,.44),'hdblack',.002)
 for sd in [-1,1]:
  cyl('空氣筒',(0,sd*1.12,.80),.11,1.8 if tank!='r180' else 2.6,'hdframe','X',20)
 head=len(p.MODEL);end_gear(xe,W);mirror_cab(list(p.MODEL[head:]))
 # 車體：短鼻、駕駛室、長機房（R150、R180 機房頂灰色、R150 駕駛室頂淺灰）
 if high:
  block('高短鼻',[(xn0-.05,nhw,deck,ntop,rt),(xn1-.12,nhw,deck,ntop,rt),(xn1,nhw-.12,deck,ntop,rt)],'hdbody')
 else:
  block('短車鼻',[(x,nhw,deck,z,.14) for x,z in rounded_ends(xn0-.05,xn1,ntop,rf=nose_r)],'hdbody')
 ctop=htop if high else H
 block('駕駛室',[(xc0,chw,deck,ctop,.22),(xc1-cset,chw,deck,ctop,.22),(xc1,cflat,deck,ctop,.22)],'hdbody')
 if cabroof:
  if high:block('駕駛室灰色圓頂',[(x,chw+.012,ctop-.10,z,.45) for x,z in rounded_ends(xc0-.04,xc1+.04,ctop+.19,rf=.15,rb=.15)],cabroof)
  else:block('駕駛室淺灰車頂',[(xc0-.01,chw+.012,ctop-.23,ctop+.012,.232),(xc1-cset,chw+.012,ctop-.23,ctop+.012,.232),(xc1-.02,cflat+(chw-cflat)*.02/cset+.012,ctop-.23,ctop+.012,.232)],cabroof)
 block('長機房',[(xh0,hhw,deck,htop,rt),(xc0+.05,hhw,deck,htop,rt)],'hdbody')
 if roof!='hdbody':block('長機房灰色頂',[(xh0+.02,hhw+.010,htop-rt-.01,htop+.010,rt+.010),(xc0+.04,hhw+.010,htop-rt-.01,htop+.010,rt+.010)],roof)
 # 白色腰帶：駕駛室與短鼻沿平面輪廓；長機房側面在車尾附近斜斜降到走道上方，低帶延伸到車尾（照片上 R20 在 67–77%、其餘約 76–89%）
 if high:pts=[(xc0,hhw),(xc0,chw),(xc1,chw),(xc1,nhw),(xn1-.12,nhw),(xn1,nhw-.12)]
 else:pts=[(xc0,hhw),(xc0,chw),(xc1-cset,chw),(xc1-cset*(nhw-cflat)/(chw-cflat),nhw),(xn1,nhw)]
 plan_band('白色腰帶',pts,z0,z1,'hdwhite');xd0=xe-drop[0]*L;xd1=xe-drop[1]*L;zl=1.38;t=z1-z0
 for side in [-1,1]:
  for poly in [[(xd0,z0),(xc0+.01,z0),(xc0+.01,z1),(xd0,z1)],[(xd1,zl),(xd0,z0),(xd0,z1),(xd1,zl+t)],[(xh0-.005,zl),(xd1,zl),(xd1,zl+t),(xh0-.005,zl+t)]]:
   side_prism('白色腰帶',poly,side,hhw+.010,'hdwhite',.008)
 # 短鼻正面：白色 V 字飛翼、兩角紅色標識燈；高短鼻另有上方兩塊車號牌與直列雙頭燈
 fn=lambda y,z:xn1;wing('白色 V 字飛翼',fn,nhw-(.12 if high else .02),z0,z1,deck+(.18 if high else 0))
 if high:
  front_panel('頭燈燈座',fn,0,htop-.37,.22,.46,'hdblack',.08,.02)
  for z in [htop-.26,htop-.48]:lamp('頭燈',fn,0,z,.065)
  for sd in [-1,1]:
   front_panel('車號牌',fn,sd*.50,htop-.37,.42,.22,'hdblack',.04,.025);face_label(lab,fn,sd*.50,htop-.37,.044,.09)
   lamp('標識燈',fn,sd*.80,2.45,.055,red=True)
  cyl('短鼻頂氣笛',(xn1-.30,.30,htop+.07),.045,.28,'hdblack','X',16)
 else:
  for sd in [-1,1]:lamp('標識燈',fn,sd*.62,2.11,.075,red=True)
 # 駕駛室正面
 if high:
  for sd in [-1,1]:
   panel('駕駛室前角窗窗框',(xc1+.012,sd*(nhw+.12),2.62),.20,.58,'hdblack','front',r=.04);panel('駕駛室前角窗',(xc1+.026,sd*(nhw+.12),2.62),.14,.50,'glass','front',r=.03,depth=.012)
 else:
  fc=lambda y,z:xc1-cset*max(0,abs(y)-cflat)/(chw-cflat);zp=H-.21
  for sd in [-1,1]:
   front_panel('前窗窗框',fc,sd*.38,2.77,.66,.56,'hdblack',.07,.022);front_panel('前窗玻璃',fc,sd*.38,2.77,.58,.48,'glass',.06,.032)
   front_panel('角窗窗框',fc,sd*1.07,2.585,.32,.70,'hdblack',.05,.022);front_panel('角窗玻璃',fc,sd*1.07,2.585,.25,.62,'glass',.04,.032)
   front_panel('車號牌',fc,sd*.415,zp,.43,.24,'hdblack',.04,.025);face_label(lab,fc,sd*.415,zp,.044,.085)
   wiper(fc,sd*.38,2.52,.40)
  front_panel('頭燈燈座',fc,0,zp,.22,.46,'hdblack',.08,.02)
  for z in [zp-.11,zp+.11]:lamp('頭燈',fc,0,z,.065)
  use('05');cyl('氣笛',(xc1-.22,.62,ctop+.08),.045,.30,'hdblack','X',16)
 if ac:use('05');roof_hood('駕駛室冷氣',s,xc0+.30,xc1-cset-.10,1.30,.24,.10,'hdlight')
 # 駕駛室側窗（兩片拉窗）、駕駛室後角扶手
 wx=xc0+(cab-cset)/2+(.05 if high else 0)
 for side in [-1,1]:
  y=side*(chw+.012);use('02');panel('駕駛室側窗窗框',(wx,y,2.60),.95,.64,'hdblack',r=.05)
  for dx in [-.23,.23]:panel('駕駛室側窗玻璃',(wx+dx,y+side*.012,2.60),.42,.56,'glass',r=.04,depth=.012)
  use('07');rod('駕駛室後扶手',(xc0-.12,side*(hhw+.06),1.42),(xc0-.12,side*(hhw+.06),2.32),.016,'hdrail')
  for z in [1.46,2.28]:rod('扶手座',(xc0-.12,side*(hhw+.005),z),(xc0-.12,side*(hhw+.06),z),.012,'hdrail')
 # 長機房側面：百葉組、車尾上方散熱器格柵、檢修門門縫；R180 右側（−Y）靠駕駛室一大片進氣格柵
 spans=[]
 for dx,w,kind in groups:
  x=xc0+dx;spans.append((x-w/2,x+w/2))
  for side in [-1,1]:
   y=side*(hhw+.010)
   if kind in ('door','col'):louver('機房百葉',x,y,(z1+.08+htop-.42)/2,w,htop-.42-z1-.08,8 if kind=='door' else 7);louver('機房百葉',x,y,(1.42+z0-.08)/2,w,z0-.08-1.42,6)
   else:louver('機房小百葉',x,y,z1+.26,w,.30,4)
 if intake:spans.append((xc0-.68,xc0-.12));bar_grille('右側進氣格柵',xc0-.40,-(hhw+.010),(1.45+htop-.40)/2,.52,htop-.40-1.45,9)
 gx=xh0+.62;spans.append((gx-.34,gx+.34))
 for side in [-1,1]:bar_grille('散熱器格柵',gx,side*(hhw+.010),htop-.62,.64,.50,11)
 n=round((xc0-xh0)/.62)
 for i in range(1,n):
  x=xh0+(xc0-xh0)*i/n
  if any(a-.05<x<b+.05 for a,b in spans):continue
  for side in [-1,1]:box('檢修門門縫',(x,side*(hhw+.012),(deck+.10+htop-.30)/2),(.014,.010,htop-.30-deck-.10),'hdblack',.002)
 # 機房頂：排氣管、車尾散熱風扇
 use('05');ex=(xh0+xc0)/2+.60;box('排氣管座',(ex,0,htop+.03),(.50,.42,.10),'hdframe',.03);cyl('排氣管',(ex,0,htop+.12),.10,.14,'hdblack')
 for i in range(fans):
  x=xh0+.55+i*.72;cyl('散熱風扇外圈',(x,0,htop+.035),.30,.09,'hdframe',n=28);cyl('散熱風扇護網',(x,0,htop+.085),.26,.012,'hdblack',n=28)
  for d in [-.16,-.05,.05,.16]:box('護網橫條',(x,d,htop+.094),(.50,.018,.010),'hdslat',.002)
 # 長機房後端牆（先建在 +X 再整組轉到 −X）：直列雙頭燈（不發光鏡片）、兩塊車號牌、兩角紅色標識燈
 head=len(p.MODEL);g=lambda y,z:xe-.30
 front_panel('後端頭燈燈座',g,0,htop-.36,.22,.46,'hdblack',.08,.02)
 for z in [htop-.25,htop-.47]:lamp_color('後端頭燈',g,0,z,.060,'hdlens')
 for sd in [-1,1]:
  front_panel('後端車號牌',g,sd*.45,htop-.36,.40,.22,'hdblack',.04,.025);face_label(lab,g,sd*.45,htop-.36,.044,.085)
  lamp('後端標識燈',g,sd*(hhw-.22),2.30,.055,red=True)
 to_rear(list(p.MODEL[head:]))
 # 走道扶手：照片上沒有沿長機房的連續欄杆（fleet-v1 的錯），只有兩端平台角落的白色管扶手與駕駛室後角扶手；R20 連前平台欄杆也沒有，只有角落直扶手
 use('07');yo=W/2-.07
 for sd in [-1,1]:
  y=sd*yo
  if high:
   for x in [xe-.08,-xe+.08]:rod('角落直扶手',(x,y,1.30),(x,y,2.10),.018,'hdrail')
   rod('駕駛室前角扶手',(xc1+.10,sd*(chw-.02),1.40),(xc1+.10,sd*(chw-.02),2.30),.016,'hdrail')
   continue
  line('短鼻旁走道扶手',[(xe-.08,y,1.30),(xe-.08,y,2.12),(xc1+.12,y,2.12),(xc1+.12,y,1.30)],.020,'hdrail')
  line('短鼻旁走道扶手',[(xe-.08,y,1.72),(xc1+.12,y,1.72)],.016,'hdrail')
  line('前平台扶手',[(xe-.08,y,2.12),(xe-.08,sd*(nhw+.10),2.12),(xe-.08,sd*(nhw+.10),1.30)],.018,'hdrail')
  line('後平台扶手',[(-xe+.08,y,1.30),(-xe+.08,y,2.12),(xh0+.25,y,2.12),(xh0+.25,sd*(hhw+.03),2.12)],.020,'hdrail')
  line('後平台扶手',[(-xe+.08,y,2.12),(-xe+.08,sd*.95,2.12),(-xe+.08,sd*.95,1.30)],.018,'hdrail')

def r100(s):
 """R100 柴電機車（EMD G22U）。參考：Commons「TRA R124 side view at Taitung Station.jpg」（Jason199567，CC BY-SA 4.0，正側面）、
 「TRA R137 Locomotive.jpg」（小朱，CC BY-SA 4.0，正面）、「R100 Series Diesel Locomotive.jpg」（Samson Ng . D201@EAL，CC BY-SA 4.0，斜側）、「TRA R112.jpg」（ChS&Rh，CC BY-SA 4.0）。
 低短鼻（上緣大圓角）、駕駛室正面兩角斜切（斜面上一扇角窗）、長機房跟駕駛室頂同高；白色腰帶在短鼻正面變成到鼻底的 V 字，在車尾附近斜降到走道上方；
 沒有沿長機房的連續欄杆（fleet-v1 的錯），只有短鼻旁走道、兩端平台的白色管扶手；車架側樑厚、兩組轉向架之間是灰色圓筒燃油箱（R131 斜側照、R112 照片）。
 高度照正側面照（574 px/m）與正面照（225 px/m）量，實車走道 1.74 放在 1.30：短鼻頂 2.50、腰帶 2.00–2.17、中央前窗 2.52–3.02（|y| .085–.675）、角窗 2.25–2.92、
 車號牌 3.17–3.41（|y| .20–.63）、直列頭燈 3.18／3.40、標識燈 |y| .62；短鼻寬 .88、駕駛室半寬 1.30。"""
 emd_loco(s,tank='drum',groups=[(-.40,.55,'door'),(-1.05,.55,'door')])

def blue(s):
 """藍皮解憂號 R135（R100 改藍色塗裝）。參考：Commons「藍皮解憂號於太麻里車站.jpg」（臺灣鐵路管理局，R135 正面）、
 「TRA R101 leading a Breezy Blue Train at Taitung Station.jpg」（jason199567，CC BY-SA 4.0，斜前方）、「TRA R111 on display at the Taichung Station Railway Cultural Park 2024.png」（RwysTC，CC BY 4.0）。
 車體同 R100；深海軍藍車身與車頂、白色腰帶與 V 字飛翼、黃黑警戒端梁、銀灰色排障器。9 月 scene-03 補的前端制軔軟管、端梁上的斜桿（解聯桿）、
 車下圓筒油箱這版都有（照 R135 正面照與 R112、R131 照片自己做）。"""
 emd_loco(s,livery='blue',tank='drum',groups=[(-.40,.55,'door'),(-1.05,.55,'door')])

def r150(s):
 """R150 柴電機車（EMD G22CU）。參考：Commons「TRA R153.jpg」（ChS&Rh，CC BY-SA 4.0，斜前方）、「TRA R155 (front closeup).jpg」「TRA R156.jpg」（ChS&Rh）。
 外形跟 R100 同一系（低短鼻、斜角駕駛室），差在：車架側樑薄、三軸轉向架（Co-Co）、圓角短燃油箱；長機房靠駕駛室兩組各兩欄百葉，車尾直條散熱器格柵；
 長機房頂灰色、駕駛室頂淺灰；腰帶約在車長八成處斜降到走道上方。"""
 emd_loco(s,sill=1.12,roof='hdgrey',cabroof='hdlight',drop=(.78,.88),fans=3,tank='short',groups=[(-.32,.22,'col'),(-.58,.22,'col'),(-1.18,.22,'col'),(-1.44,.22,'col')])

def r180(s):
 """R180／R190 柴電機車（EMD G22CU-2）。參考：Commons「TRA R182.png」（ChS&Rh，CC BY 4.0，斜前方）、「R180 Series Diesel Locomotive.jpg」（Samson Ng . D201@EAL，CC BY-SA 4.0）。
 跟 R150 同一系，差在：短鼻比較方（上緣小圓角）、右側（行進方向右手邊）靠駕駛室一大片進氣格柵、車下長空氣筒與電池箱、駕駛室頂加裝冷氣；
 長機房頂灰色、駕駛室頂橘色；腰帶在車尾附近斜降。"""
 emd_loco(s,nose=1.05,nose_r=.10,sill=1.12,roof='hdgrey',drop=(.79,.89),fans=4,tank='r180',intake=True,ac=True,groups=[(-1.05,.55,'door')])

def r20(s):
 """R20 柴電機車（EMD G12）。參考：Commons「TRA R38 at Hsinchu Station 01.jpg」（Lokseng01，CC BY-SA 4.0，正側面）、「R20 Series Diesel Locomotive.jpg」（Samson Ng . D201@EAL，CC BY-SA 4.0，短鼻端）、
 「TRA R34 at Changhua Rolling Stock Branch.jpg」（ChS&Rh，長機房端）、「Close-up of TRA R71 before Changhua Roundhouse.jpg」（Lokseng01）。
 高短鼻：短鼻與長機房一樣高、比駕駛室窄，駕駛室頂灰色圓頂；車頭是短鼻那端（fleet-v1 把長機房放前面、駕駛室放後面是錯的）：正面切角，上方兩塊車號牌夾直列雙頭燈，白色 V 字飛翼；
 長度照正側面照（113.5 px/m）：短鼻 1.81、駕駛室 2.11、長機房 9.89（壓成 1.15／1.45／5.70）；腰帶在 67–77% 處從 2.20 降到 1.57（實車）；
 長機房靠駕駛室三組高百葉、一組小百葉、車尾上方散熱器格柵；沒有連續欄杆，只有角落與駕駛室的直扶手。"""
 emd_loco(s,nose=1.15,cab=1.45,sill=1.04,cabroof='hdgrey',drop=(.67,.77),tank='long',high=True,groups=[(-.30,.34,'door'),(-.74,.34,'door'),(-1.18,.34,'door'),(-1.75,.30,'small')])

def dhl100(s):
 """DHL100 調車機車（新潟鐵工／台灣車輛，液力傳動）。參考：Commons「TRA DHL102 at Qidu Marshalling Yard 20191102.jpg」（Solomon203，CC BY-SA 4.0，正側面）、
 「TRA DHL109 2023-07-19.jpg」（Industrial Wales，CC BY-SA 2.0，短機房端斜前方）、「TRA DHL108.jpg」（ChS&Rh）。
 駕駛室不在正中央（fleet-v1 的錯）：短機房、駕駛室、長機房約 14%、24%、62%（正側面照 211 px/m 量），駕駛室比兩邊機房高、淺灰色斜頂；
 機房窄、兩側走道；短機房正面上方黑色車號牌、白色 V 字飛翼；駕駛室正面兩扇前窗、中間直列雙頭燈；黃黑警戒端梁上一白一紅兩顆燈；
 兩端平台與駕駛室門口白色管扶手；長機房頂三個圓形散熱風扇、車尾兩片大散熱格柵。
 高度（實車走道 1.45 放在 1.30）：短機房頂 2.61、長機房頂 2.80、腰帶 2.18–2.34、駕駛室側窗 2.35–3.05、駕駛室屋簷 3.13。"""
 L,W,H=s['L'],s['W'],s['H'];hood_colours();xe=L/2;deck=1.30;lab=s['label']
 xn1=xe-.22;xn0=xn1-1.10;xc1=xn0;xc0=xc1-1.70;xr0=xc0-.40;xh0=-xe+.22;hw=.82;cw=1.28;st,lt=2.61,2.80;z0,z1=2.18,2.34
 use('01');box('車架側樑',(0,0,1.14),(L-.02,W-.04,.32),'hdframe',.02)
 loco_bogies(L,W,2,.40);use('04');box('燃油箱',(0,0,.63),(2.1,W*.72,.50),'hdframe',.06)
 head=len(p.MODEL);end_gear(xe,W,(.43,1.29));mirror_cab(list(p.MODEL[head:]))
 block('短機房',[(x,hw,deck,z,.16) for x,z in rounded_ends(xn0-.05,xn1,st,rf=.10)],'hdbody')
 block('長機房',[(x,hw,deck,z,.16) for x,z in rounded_ends(xh0,xr0+.05,lt,rb=.10)],'hdbody')
 block('駕駛室',[(xc0,cw,deck,3.13,.08),(xc1,cw,deck,3.13,.08)],'hdbody')
 block('駕駛室後段',[(xr0,1.0,deck,3.45,.12),(xc0+.02,1.0,deck,3.45,.12)],'hdbody')
 block('駕駛室淺灰斜頂',[(x,cw+.03,3.08,z,.20) for x,z in rounded_ends(xc0,xc1+.06,H,rf=.26,rb=.10)],'hdlight')
 plan_band('白色腰帶',[(xh0,hw),(xr0,hw),(xr0,1.0),(xc0,1.0),(xc0,cw),(xc1,cw),(xc1,hw),(xn1,hw)],z0,z1,'hdwhite')
 # 短機房正面（車頭）：上方黑色車號牌、白色 V 字飛翼
 fn=lambda y,z:xn1;wing('白色 V 字飛翼',fn,hw-.02,z0,z1,1.59);front_panel('車號牌',fn,0,2.42,.62,.15,'hdblack',.03,.025);face_label(lab,fn,0,2.42,.044,.085)
 # 駕駛室正面：兩扇前窗、中間直列雙頭燈；車頂兩支氣笛
 fc=lambda y,z:xc1
 for sd in [-1,1]:
  front_panel('前窗窗框',fc,sd*.42,2.88,.56,.40,'hdblack',.05,.022);front_panel('前窗玻璃',fc,sd*.42,2.88,.48,.32,'glass',.04,.032)
 front_panel('頭燈燈座',fc,0,2.90,.20,.40,'hdblack',.07,.02)
 for z in [2.80,3.00]:lamp('頭燈',fc,0,z,.055)
 use('05')
 for y in [-.18,.18]:cyl('氣笛',(xc1-.30,y,H+.06),.040,.26,'hdblack','X',16)
 # 端梁上的燈：車頭一白一紅（白燈 lamp），另一端白燈改不發光鏡片
 fb=lambda y,z:xe-.02
 for sd in [-1,1]:lamp('端梁頭燈',fb,sd*.58,1.08,.060);lamp('端梁尾燈',fb,sd*.95,1.08,.050,red=True)
 head=len(p.MODEL)
 g=lambda y,z:xe-.22;wing('白色 V 字飛翼',g,hw-.02,z0,z1,1.59);front_panel('車號牌',g,0,2.62,.62,.15,'hdblack',.03,.025);face_label(lab,g,0,2.62,.044,.085)
 for sd in [-1,1]:lamp_color('端梁頭燈',fb,sd*.58,1.08,.060,'hdlens');lamp('端梁尾燈',fb,sd*.95,1.08,.050,red=True)
 to_rear(list(p.MODEL[head:]))
 # 側面：駕駛室三片側窗、短機房前下方百葉、長機房車尾兩片大散熱格柵
 for side in [-1,1]:
  y=side*(cw+.012);use('02');panel('駕駛室側窗窗框',(xc0+.95,y,2.70),1.26,.72,'hdblack',r=.05)
  for dx in [-.40,0,.40]:panel('駕駛室側窗玻璃',(xc0+.95+dx,y+side*.012,2.70),.36,.64,'glass',r=.04,depth=.012)
  louver('短機房百葉',xn1-.28,side*(hw+.010),1.66,.24,.40,6)
  for x in [-2.20,-2.80]:bar_grille('長機房散熱格柵',x,side*(hw+.010),1.78,.50,.62,9)
  for x in [-.40,-1.20,-1.70,-3.25]:box('檢修門門縫',(x,side*(hw+.012),1.95),(.014,.010,1.15),'hdblack',.002)
 use('05');cyl('排氣管',(xr0-.30,0,lt+.12),.09,.24,'hdblack')
 for x in [-.85,-1.55,-2.25]:
  cyl('散熱風扇外圈',(x,0,lt+.03),.26,.08,'hdframe',n=28);cyl('散熱風扇護網',(x,0,lt+.075),.22,.012,'hdblack',n=28)
 # 扶手：兩端平台（前緣與側緣）、駕駛室門口
 use('07');yo=W/2-.06
 for sd in [-1,1]:
  y=sd*yo
  line('前平台扶手',[(xn0+.15,y,1.30),(xn0+.15,y,2.12),(xe-.07,y,2.12),(xe-.07,y,1.30)],.020,'hdrail')
  line('前平台扶手',[(xe-.07,y,2.12),(xe-.07,sd*(hw+.10),2.12),(xe-.07,sd*(hw+.10),1.30)],.018,'hdrail')
  line('後平台扶手',[(xh0+.70,y,1.30),(xh0+.70,y,2.12),(-xe+.07,y,2.12),(-xe+.07,y,1.30)],.020,'hdrail')
  line('後平台扶手',[(-xe+.07,y,2.12),(-xe+.07,sd*(hw+.10),2.12),(-xe+.07,sd*(hw+.10),1.30)],.018,'hdrail')
  for x in [xr0-.10,xr0-.55]:rod('駕駛室門口扶手',(x,y,1.30),(x,y,2.12),.018,'hdrail')
  line('駕駛室門口扶手',[(xr0-.10,y,2.12),(xr0-.55,y,2.12)],.018,'hdrail')

BUILDERS={'c301':c301,'c321':c321,'c341':c341,'c371':c371,'c381':c381,'emu500':emu500,'emu600':emu600,'haifeng':haifeng,'shanlan':shanlan,'emu800':emu800,'emu800r':emu800r,
 'emu900':emu900,'emu700':emu700,'temu1000':temu1000,'temu2000':temu2000,'700t':t700,'e1000':e1000,'ppcoach':ppcoach,
 'dr3100':dr3100,'dr1000':dr1000,'dr2700':dr2700,'emu100':emu100,'emu1200':emu1200,
 'airportlocal':airportlocal,'airportexpress':airportexpress,'y100':y100,'sanying':sanying,'taichung':taichung,'kaohsiung':kaohsiung,'val256':val256,
 'e200':e200,'e300':e300,'e400':e400,'mingri':mingri,'e500':e500,'r200':r200,
 'r100':r100,'blue':blue,'r150':r150,'r180':r180,'r20':r20,'dhl100':dhl100}
