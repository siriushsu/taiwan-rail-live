"""台灣車隊精修逐款規格。Q 版比例沿用 fleet-v1（長度壓縮、斷面接近實車），車庫大小與地圖 LOD 的位置才接得上；
不代表工程尺寸或即時派車。"""
S={}
def add(id,family,**kw):S[id]={'id':id,'family':family,**kw}
# 北捷高運量：23.5 m 車在車庫是 L 9.4；每側四組雙開門，第三軌供電，駕駛室沒有側門；車頂是壓紋平頂、冷氣不外露（tw_models.metro_roof）。
metro=dict(L=9.4,W=2.9,H=3.35,doors=4,doorLeaves=2,power='third-rail',shoes=True,rearDoor=1.30,frontDoor=1.15,cabWin=.12,
 winH=.94,winZ=2.24,doorWinH=.92,body='C3C7CB',accent='2479C9',acUnits=[])
add('c301','metro',**metro,label='C301')
add('c321','metro',**metro,label='C321')
add('c341','metro',**metro,label='C341')
add('c371','metro',**metro,label='C371')
add('c381','metro',**{**metro,'body':'D2D9D8','frontDoor':1.30},label='C381')
