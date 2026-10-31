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
