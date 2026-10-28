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
# EMU300：實車 20,000／2,880／3,880 mm；比照 fleet-v1 的 EMU100（L 8.9、W 2.8、H 3.5）。
add('emu300','railcar',L=8.9,W=2.8,H=3.5,doors=2,doorLeaves=1,body='E5D79B',accent='E4502B',power='overhead-other-car',label='EMU300')
# EMU200：實車 20,000／2,880／3,932 mm，同 EMU300 比例。
add('emu200','railcar',L=8.9,W=2.8,H=3.5,doors=2,doorLeaves=1,body='D3CBAE',accent='D8401C',power='overhead-other-car',label='EMU206')
# DR2800：實車 20,274／2,885／3,975 mm（含車頂設備罩），同 EMU300 比例；車身高照 fleet-v1 柴聯車 3.4 再加一點。
add('dr2800','railcar',L=8.9,W=2.8,H=3.45,doors=1,doorLeaves=1,body='AEB2B0',accent='D9531C',power='diesel',label='DR2823')
# EMU400：實車 20,000／2,880／3,932 mm，同 EMU300 比例。
add('emu400','railcar',L=8.9,W=2.8,H=3.5,doors=2,doorLeaves=2,body='AEB4BA',accent='2146BE',power='overhead-other-car',label='EM410')
# 復興號 20000 系：實車 20,000／2,900／3,800 mm；比照 fleet-v1 莒光號客車（L 9.0、W 2.8、H 3.4），拱頂高一點。
add('fuhsing','coach',L=9.0,W=2.85,H=3.45,radiusTop=.80,doors=2,doorLeaves=2,body='2772CC',accent='A9BED4',power='unpowered',label='40SP20073')
# 台糖 346：762 mm 軌距 0-6-0 水櫃機（12.5 t），尺寸查不到；比騰雲號長一節動輪，寬照窄軌縮。
add('sugar346','steam',L=5.6,W=2.20,H=3.25,body='26292B',accent='B8281A',power='steam',drivers=3,label='346')
# E100：實車 15,120／2,995／4,003 mm；比照 fleet-v1 E200（17.4 m→8.6）縮成 7.6，車身底在 1.15。
add('e100','electric',L=7.6,W=2.85,H=3.50,bottom=1.15,radiusBottom=.06,radiusTop=.30,body='DCC488',accent='E0501A',power='overhead',label='E101')
# CK101：實車 11,405／2,616／3,658 mm（同頁文字另寫車高 3,596），2-6-2 水櫃機；比照 fleet-v1 CK124（L 7.2）同比例縮。
add('ck101','steam',L=7.0,W=2.62,H=3.66,body='1E2022',accent='B8281A',power='steam',drivers=3,label='CK101')
# 觀光號 35DC32751：實車 20,000／2,900／3,800 mm，比照復興號客車（L 9.0、W 2.85、H 3.45）。
add('guanguang','coach',L=9.0,W=2.85,H=3.45,radiusTop=.80,doors=1,doorLeaves=2,body='ECE6D6',accent='C21A22',power='unpowered',label='35DC32751')
# 台糖日立牌：762 mm，實車 5,540／2,200／3,000 mm；本身很短，長度只略縮。
add('sugarhitachi','diesel',L=5.0,W=2.20,H=3.00,body='6E1410',accent='B02A12',power='diesel',label='')
# 溪湖觀光敞車：甘蔗車改造，尺寸查不到；照 A-06 照片以護欄高約 1 m 為尺估（約 4.5／1.9／2.85 m），一節一個開間。
add('sugarcar','coach',L=4.4,W=2.0,H=2.70,body='E2DFCB',accent='3A92D0',power='unpowered',label='A-06')
# S300：實車 11,230／2,667／3,600 mm（EMD GA8，B0-B0）；比照台糖日立牌與 CK101 的壓縮比，長度取 6.6。
add('s300','diesel',L=6.6,W=2.62,H=3.55,body='C4461A',accent='F1F1EC',power='diesel',label='S302')
# R0（R6 改造型）：實車 15,370／2,875／3,836 mm，Co-Co；長度比照 E100（15.1 m→7.6）略長。
add('r0','diesel',L=8.4,W=2.80,H=3.72,body='172C70',accent='F1F1EC',power='diesel',label='R6')
# 換色版：S305 2023 年修復的藍色（駕駛室屋頂也是藍色）、R6 1999 年以前的台鐵柴電機車橘色；外形同上。
add('s300blue','diesel',L=6.6,W=2.62,H=3.55,body='102A6E',accent='F1F1EC',roof='102A6E',plow='3C4044',power='diesel',label='S305')
add('r0orange','diesel',L=8.4,W=2.80,H=3.72,body='C4461A',accent='F1F1EC',power='diesel',label='R6')
# 中興號 DPC：實車 10,700／2,080／3,120 mm，762 mm 軌距；長度跟 S300 同壓縮比。
add('zhongxing','railcar',L=6.4,W=2.10,H=3.10,bottom=.80,radiusBottom=.10,radiusTop=.42,doors=1,doorLeaves=1,body='C0140F',accent='F2F2EE',power='diesel',label='DPC8')
# LDK58：實車 7,608／2,286／3,100 mm（LDK50 型整型號數字），0-8-0T；比照台糖 346（L 5.6）略長。
add('ldk58','steam',L=5.8,W=2.28,H=3.10,body='1B1B1D',accent='B8141A',power='steam',drivers=4,label='LDK58')
# LDR2200：實車 14,100／2,450／3,090 mm，762 mm 軌距；長度比照觀光號（20 m→9.0）的壓縮比再略長。
add('ldr2200','railcar',L=7.6,W=2.42,H=3.05,bottom=.80,radiusBottom=.10,radiusTop=.42,doors=2,doorLeaves=1,body='B88E00',accent='E4E0D2',power='diesel',label='LDR2201')
# 勝利號 538：實車 10,744／2,200／3,270 mm，762 mm 軌距；長度跟中興號同壓縮比。
add('shengli','railcar',L=6.4,W=2.20,H=3.20,bottom=.80,radiusBottom=.10,radiusTop=.40,doors=3,doorLeaves=1,body='1A34A0',accent='F4F4F0',power='diesel',label='538')
