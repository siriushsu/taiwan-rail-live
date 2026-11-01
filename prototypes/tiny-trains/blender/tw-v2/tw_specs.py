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
# 區間車 EMU500 家族：20 m 車在車庫是 L 8.5；每側三組雙開門，平頭中央貫通門；駕駛車沒有受電弓。
# EMU600 跟 EMU500 外觀同款（照片上只差門框顏色，判斷是髒污，不分）；海風號、山嵐號是 EMU500 改造，整車上色、下緣漸層成白色。
e500=dict(L=8.5,W=2.8,H=3.4,doors=3,doorLeaves=2,rearDoor=1.20,frontDoor=1.25,cabWin=.55,winH=.80,winZ=2.37,doorWinH=.76,doorWinZ=2.36,doorTop=2.95,
 body='BAC4C7',accent='2A5CB4',acUnits=[(-2.0,1.5),(1.4,1.5)],acMat='e5roof')
add('emu500','railcar',**e500,label='EMU500')
add('emu600','railcar',**e500,label='EMU600')
add('haifeng','railcar',**{**e500,'body':'9ED8CC','accent':'9ED8CC'})
add('shanlan','railcar',**{**e500,'body':'CFE36A','accent':'CFE36A'})
# 區間車 EMU800 家族：L 9.0；車鼻長、面罩傾斜；每側三組雙開門。增備反色版（emu800r）面罩黃、框藍。
e800=dict(L=9.0,W=2.8,H=3.45,doors=3,doorLeaves=2,rearDoor=1.20,frontDoor=1.10,cabWin=.40,winH=.78,winZ=2.45,doorWinH=.74,doorWinZ=2.42,doorTop=2.95,
 body='BFC6CA',accent='2B4FB0',acUnits=[(-2.3,1.6),(1.0,1.6)],acMat='e8roof')
add('emu800','railcar',**e800,label='EMU800')
add('emu800r','railcar',**e800,inverse=True,label='EMU800')
# EMU900（現代 Rotem）：L 9.0；駕駛室後面是一扇長圓窗與乘務員門，再往後才是三組雙開門（門窗配置照現代工廠側面照）。
add('emu900','railcar',L=9.0,W=2.8,H=3.45,doors=3,doorLeaves=2,rearDoor=1.35,frontDoor=1.45,cabWin=.30,winH=.74,winZ=2.50,doorWinH=.80,doorWinZ=2.42,doorTop=2.98,
 body='C3C9CC',accent='8DC63F',acUnits=[(-2.2,1.7),(1.0,1.7)],acMat='e9roof',label='EMU900')
# EMU700（日本車輛／台灣車輛）：L 9.0；平直車頭、下巴往前凸；駕駛室後面有乘務員門；每側三組雙開門。
add('emu700','railcar',L=9.0,W=2.8,H=3.45,doors=3,doorLeaves=2,rearDoor=1.20,frontDoor=1.25,crewDoor=True,winH=.66,winZ=2.52,doorWinH=.70,doorWinZ=2.45,doorTop=2.95,
 body='C2C8CB',accent='1F4FA8',acUnits=[(-2.2,1.7),(.9,1.7)],acMat='e7roof',label='EMU700')
# TEMU1000 太魯閣（日立）：L 9.8（fleet-v1 同尺寸）；鈍圓長車鼻；每側兩扇單開塞拉門（車尾一扇、駕駛室後隔一扇窗一扇），深灰連續窗帶。
add('temu1000','express',L=9.8,W=2.85,H=3.4,doors=2,doorLeaves=1,doorW=.62,rearDoor=.80,frontDoor=1.70,cabWin=.60,winH=.40,winZ=2.25,doorWinH=.60,doorWinZ=2.32,doorTop=2.85,
 body='EEF0EC',accent='EF7D22',acUnits=[(-2.4,1.8),(.6,1.8)],acMat='t1roof',label='TEMU1000')
# TEMU2000 普悠瑪（日本車輛）：L 9.4（fleet-v1 同尺寸）；楔形車鼻；每側兩扇單開塞拉門（車尾一扇、駕駛室後一扇），獨立車窗。
add('temu2000','express',L=9.4,W=2.85,H=3.4,doors=2,doorLeaves=1,doorW=.62,rearDoor=.80,frontDoor=.55,cabWin=.30,winH=.56,winZ=2.29,doorWinH=.60,doorWinZ=2.32,doorTop=2.85,
 body='F0F1EF',accent='D42A35',acUnits=[(-2.2,1.8),(.8,1.8)],acMat='t2roof',label='TEMU2000')
# 台灣高鐵 700T（川崎）：L 8.8（fleet-v1 同尺寸）；鴨嘴長車鼻（壓到約六成），駕駛車每側兩扇單開門（車尾、駕駛室後）；平頂、駕駛車沒有受電弓。
add('700t','express',L=8.8,W=2.85,H=3.25,doors=2,doorLeaves=1,doorW=.58,body='E7E8E2',accent='E97F2C',label='700T')
# E1000 推拉式自強號電力機車：L 9.0（fleet-v1 同尺寸）；只有前端駕駛室、後端接客車；車頭往後倒（壓到約六成）；單臂受電弓一具在車頂後段。
add('e1000','electric',L=9.0,W=2.85,H=3.5,pantos=1,axles=2,radiusTop=.55,radiusBottom=.15,body='CDD3D5',accent='EE6A2C',label='E1000')
# 推拉式自強號 40PPD2500 客貨車：L 9.0；兩端各一扇單開塞拉門，窗只在一半（兩大兩小）、另一半是行李間；色帶與 E1000 同高。
add('ppcoach','coach',L=9.0,W=2.8,H=3.4,doors=2,doorLeaves=1,doorW=.62,body='C9CECC',accent='ED822A',label='40PPD2500')
