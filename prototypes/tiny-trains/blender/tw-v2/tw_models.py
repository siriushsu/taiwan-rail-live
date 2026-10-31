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

BUILDERS={'c301':c301,'c321':c321,'c341':c341,'c371':c371,'c381':c381}
