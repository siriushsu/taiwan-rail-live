"""台灣缺車與經典老車逐款外觀規格。Q 版比例，比照台灣車隊 fleet-v1：長度壓縮、斷面接近實車；不代表工程尺寸或即時派車。"""
S={}
def add(id,family,**kw):S[id]={'id':id,'family':family,**kw}
add('shay31','steam',L=7.2,W=2.15,H=3.30,body='24292A',accent='B5A36E',power='steam',label='31')
add('n700st','express',L=9.6,W=2.85,H=3.25,body='F2F2EE',accent='F06A1C',power='overhead-other-car',label='N700ST')
# 北捷大運量新車：比照 C381（L 9.4、W 2.9），斷面依實車 3,180 mm 寬。
add('c381a','metro',L=9.4,W=2.9,H=3.35,doors=4,doorLeaves=2,rearDoor=1.10,frontDoor=1.05,cabGap=.60,body='C6CBCE',accent='2B7CC9',power='third-rail',label='CR381A')
# 萬大線 17.5 m、寬 2.8 m 中運量車：比照銀座線 16 m→7.6 取 8.0；寬依 C381 的壓縮比。
add('wanda','metro',L=8.0,W=2.68,H=3.35,doors=3,doorLeaves=2,rearDoor=1.10,frontDoor=1.25,cabGap=.62,body='E6EAEA',accent='B4D564',power='third-rail',label='LG')
# 騰雲號：實車 6,477／2,184／3,461 mm，0-4-0 水櫃機；比照 CK124（L 7.2）同比例縮。
add('tengyun','steam',L=5.0,W=2.30,H=3.30,body='1D2122',accent='C8321E',power='steam',drivers=2,label='')
