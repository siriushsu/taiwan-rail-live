"""輸出 10/16 版重播頁用的 fleet/：14 種車廂網格（近景＋遠景）的 *.bin.gz 與 catalog.json。

與 v2 的差別（v2 輸出 9/12 版；9/12 目錄已封存，這裡不寫它）：
  1. 預設目的地是 memories/tainan-2026-10-16/fleet；落在 memories/tainan-2026-09-12 底下的目的地一律中止。
  2. 9/12 既有的 13 種網格（26 個 .bin.gz）不重新匯出：從 --carry-from（預設 9/12 的 fleet，唯讀）逐 byte 複製，
     catalog 裡它們的條目也原樣沿用；只有 NEW_MESHES 由本目錄的產生器建出。
  3. 新增 emu800-mid（EMU800 沒有集電弓的中間車 EMA／EMB）；編組 emu800 改 8 節、e200 改 9 節
     （rail-3d/integration/formations.js formationFor(v,'actual') 的推估編組）。其餘編組照舊。

用法：
  python3 -I export_fleet.py [--dest <fleet 目錄>] [--carry-from <9/12 的 fleet 目錄>]
  python3 -I export_fleet.py --regen-all --dest <暫存目錄>
      全部 14 種都重新產生，只用來驗證產生器仍重現 9/12 的位元組；不可指向正式目錄。
只寫入目的地：<id>.near.bin.gz、<id>.far.bin.gz（gzip -9 -n）與 catalog.json；目的地若有清單以外的檔案就中止，不刪除。
之後仍需由主流程執行 scripts/seal_tainan_memory.mjs 重新封存 integrity.json。
"""
import sys, os, json, subprocess, hashlib, tempfile, shutil, gzip, copy, site
# python3 -I 會忽略使用者 site-packages，而 numpy／scipy／shapely 裝在那裡；只明確加入這一個固定目錄。
_user_site = site.getusersitepackages()
if os.path.isdir(_user_site) and _user_site not in sys.path:
    sys.path.append(_user_site)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit, cars

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '../../../..'))
ARCHIVE = os.path.join(REPO, 'memories/tainan-2026-09-12')
PROD_FLEET = os.path.join(REPO, 'memories/tainan-2026-10-16/fleet')


def _arg(name, default):
    return os.path.abspath(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default


DEST = _arg('--dest', PROD_FLEET)
CARRY = _arg('--carry-from', os.path.join(ARCHIVE, 'fleet'))
REGEN_ALL = '--regen-all' in sys.argv
NEW_MESHES = ['emu800-mid']   # v3 新增；其餘 13 種沿用 9/12 的位元組


def _inside(path, root):
    path, root = os.path.realpath(path), os.path.realpath(root)
    return path == root or path.startswith(root + os.sep)


if _inside(DEST, ARCHIVE):
    sys.exit('中止：目的地在已封存的 9/12 目錄底下：' + DEST)
if REGEN_ALL and _inside(DEST, PROD_FLEET):
    sys.exit('中止：--regen-all 只能輸出到暫存目錄，不可寫進 10/16 正式 fleet（9/12 既有網格要逐 byte 複製，不重新匯出）')
TMP = tempfile.mkdtemp(prefix='tainan-fleet-')   # 原始（未壓縮）.bin 只放暫存目錄（TMPDIR），跑完即刪，不留在 repo

S = {
    'manual3000': ('日立 EMU3000 運轉手冊（臺鐵高雄機務段指導股公開；車頂高 3,490、地板高 1,180、集電弓裝在轉向架上方）', 'https://sites.google.com/view/087889880/車輛科技/emu電聯車/emu-3000'),
    'hitachi': ('日立 EMU3000 設計頁（塗裝：白＋黑玻璃面罩、5 種點綴色）', 'https://www.hitachi.co.jp/rd/research/design/product/taiwan_tra/index.html'),
    'wiki3000': ('維基百科 台鐵EMU3000型電聯車（全長／全高、集電弓在第 3、7、10 節）', 'https://zh.wikipedia.org/wiki/台鐵EMU3000型電聯車'),
    'twrail3000': ('臺灣鐵道維基館 EMU3000（邊條紅／綠／藍分配、取消半開窗）', 'https://taiwanrailwiki.miraheze.org/wiki/附件:臺鐵EMU3000型電聯車'),
    'n800': ('日本車輛製造 EMU800（車体寸法 ED 21,250／其餘 19,600、寬 2,890）', 'https://www.n-sharyo.co.jp/business/tetsudo/pages/ztaiw_temu800.htm'),
    'tc800': ('Train Collection EMU800（連結器面間距 21,600／20,300、全高 3,990、EP 降弓 4,234、塗裝）', 'https://emu300ct.web.fc2.com/index/traemu/EMU800.htm'),
    'wiki800': ('維基百科 台鐵EMU800型電聯車（8 輛編組 ED‑EMA‑EP‑EMB‑EMB‑EP‑EMA‑ED；EMA／EMB 同為馬達車、座位 56；EP 的集電弓、電氣室與廁所靠 EMB 端；EMB 末端多一組尾部標示燈）', 'https://zh.wikipedia.org/wiki/台鐵EMU800型電聯車'),
    'n2000': ('日本車輛製造 TEMU2000（車体寸法 TED 21,745／其餘 20,000、寬 2,900）', 'https://www.n-sharyo.co.jp/business/tetsudo/pages/ztaiw_temu2000.htm'),
    'tc2000': ('Train Collection TEMU2000（連結器面間距 22,095／20,700、全高 4,050、TEP 4,300、小窗、圓弧空調）', 'https://emu300ct.web.fc2.com/index/traemu/TEMU2000.htm'),
    'toshiba': ('東芝 Review Vol.79 No.5 表 1（車體長 E500 20,770／E200 17,049、雙端駕駛室、Co-Co）', 'https://www.global.toshiba/content/dam/toshiba/jp/technology/corporate/review/2024/05/f02.pdf'),
    'twarch': ('《建築師雜誌》臺鐵列車家族：E500（長 20,770、寬 2,910.4、高 4,280）', 'https://www.twarchitect.org.tw/works/%E8%87%BA%E9%90%B5%E5%88%97%E8%BB%8A%E5%AE%B6%E6%97%8F%E2%88%A3%E6%A9%9F%E8%BB%8A/'),
    'motc': ('臺鐵新聞稿（交通部轉載）：E500 可牽引 PP 與莒光號、亮橘色', 'https://www.motc.gov.tw/ch/app/data/view?module=news&id=14&serno=9b1d359b-aee7-427e-99f6-370b64734442'),
    'udn': ('聯合報 2026-06-27：38 列 PP 自強號機車頭由 E1000 改為 E500', 'https://udn.com/news/story/7266/9591994'),
    'ltn': ('自由時報 2026-06-27：以 E500 取代 PP 的 E1000', 'https://news.ltn.com.tw/news/life/breakingnews/5485744'),
    'ltn24': ('自由時報 2024-10-13：2 輛 E500＋12 輛客車編組', 'https://news.ltn.com.tw/news/life/breakingnews/4828989'),
    'tcpp': ('Train Collection PP 客車（PPT1000：長 20,300、寬 2,885、高 4,043、5 大窗＋兩端半開窗）', 'https://emu300ct.web.fc2.com/index/trapc/push-pull_cars/PP-1000s.htm'),
    'tcck': ('Train Collection 莒光客車 FPK10400（長 20,000、寬 2,885、高 3,800、車頂空調位置）', 'https://emu300ct.web.fc2.com/index/trapc/chu-kuang_cars/CK-10400s.htm'),
    'tce200': ('Train Collection E200（長 17,049、寬 2,972、高 4,100、Co-Co、雙端駕駛室、塗裝）', 'https://web.archive.org/web/2022/http://emu300ct.web.fc2.com/index/tralms/E200.htm'),
}


def src(*keys):
    return [{'label': S[k][0], 'url': S[k][1]} for k in keys]


# 每個網格的來源、採用尺寸與「推斷／查不到」清單（給 catalog 與網頁說明用）
META = {
    'emu3000': dict(name='EMU3000 新自強・駕駛車（ED）', role='driving', pitchM=21.35, bodyM=21.0, widthM=2.91, heightM=3.75, roofM=3.49, floorM=1.18,
                    sources=src('manual3000', 'wiki3000', 'hitachi', 'twrail3000'),
                    adopted=['車體 21,000／連結器間距 21,350（body 為日立駕駛手冊，pitch 為維基）', '寬 2,910、車頂高 3,490、地板高 1,180（日立駕駛手冊）',
                             '含冷氣全高 3,750（維基 ED 車）'],
                    conflicts=['維基 infobox 寫「全高 ED車 3,750／EM車 3,490」，原始出處查不到。3,490 與手冊的「車頂高」相同，照片上每節車頂的冷氣都凸出車頂，'
                               '所以這裡把 3,490 當車頂、3,750 當含冷氣的全高，每節車同高；ED 是否真的比 EM 高沒有查證'],
                    inferred=['窗數與窗型、門位置、窄縫窗形狀、冷氣機數量位置、車頭黑面罩形狀（依側面與 3/4 照片估）'],
                    livery='白色車身、黑色玻璃面罩；側面上緣紅色邊條為代表色（實車 01～16 組紅、17～35 組綠、36～50 組藍），標為示意。'),
    'emu3000-mid': dict(name='EMU3000 新自強・中間車（EM）', role='mid', pitchM=20.3, bodyM=19.6, widthM=2.91, heightM=3.75, roofM=3.49, floorM=1.18,
                        sources=src('manual3000', 'wiki3000', 'hitachi'), adopted=['車體 19,600／連結器間距 20,300、寬 2,910、車頂高 3,490、含冷氣全高 3,750'],
                        conflicts=['全高：同 emu3000（ED）的說明'], inferred=['每側 13 扇窄窗（依照片數）、每節每側 2 門在客室兩端、車頂冷氣 2 具'],
                        livery='同 ED。'),
    'emu3000-ep': dict(name='EMU3000 新自強・中間車（EP，單臂集電弓）', role='mid', pitchM=20.3, bodyM=19.6, widthM=2.91, heightM=3.97, roofM=3.49, floorM=1.18,
                       sources=src('manual3000', 'wiki3000', 'twrail3000'),
                       adopted=['單臂集電弓（PT-7183A）位於第 3、7、10 節，裝在轉向架上方（日立駕駛手冊 4.1.1）',
                                '第 3、7 節的集電弓在靠 1 號車那端、第 10 節在靠 12 號車那端（維基編組表）'],
                       conflicts=['全高：同 emu3000（ED）的說明'],
                       inferred=['降弓高度（查不到，取折疊約 0.48 m，全高約 3.97）、冷氣與車頂高壓設備的縱向位置'], livery='同 ED。'),
    'emu800': dict(name='EMU800 區間車・駕駛車（ED，微笑號塗裝）', role='driving', pitchM=21.6, bodyM=21.25, widthM=2.89, heightM=3.99,
                   sources=src('n800', 'tc800'), adopted=['車體 21,250／間距 21,600、寬 2,890、全高 3,990（含冷氣）'],
                   conflicts=['日文維基註記 21,250 含連結器：與日車官網「車体寸法」不一致，採日車官網'],
                   inferred=['每側 3 門的位置、大窗數（依照片）、冷氣機數量位置、車頭燈具位置'],
                   livery='第一批「微笑號」：藍底面板＋黃色微笑弧、側面窗上黃帶、窗下黃藍帶。增購編組（小小兵）配色顛倒，不在本頁。'),
    'emu800-mid': dict(name='EMU800 區間車・中間車（EMA／EMB，無集電弓）', role='mid', pitchM=20.3, bodyM=19.6, widthM=2.89, heightM=3.99,
                       sources=src('n800', 'tc800', 'wiki800'),
                       adopted=['車體 19,600／間距 20,300、寬 2,890、全高 3,990（含冷氣）；沒有集電弓，降弓全高 4,234 只有 EP（日車官網、Train Collection）',
                                '一列 8 輛的編組是 ED‑EMA‑EP‑EMB‑EMB‑EP‑EMA‑ED：EMA 在第 2、7 輛、EMB 在第 4、5 輛，兩種中間車共用這一個網格（維基編組表；兩者座位同為 56、全高同為 3,990）',
                                'EMA／EMB 沒有廁所（維基只寫 ED 與 EP 設廁所），所以 EP 那扇靠 EMB 端的廁所霧面小窗在這裡換成一般窗；車體、窗列、車門、塗裝其餘與 EP 同一份產生程式'],
                       conflicts=['全高：維基 infobox 的高度欄記為 3,958 毫米，維基本文與 Train Collection 為 3,990；採 3,990，與 ED、EP 同一基準',
                                  'EMB 末端比 EMA 多一組尾部標示燈（維基），是小燈具，兩者共用網格不建模'],
                       inferred=['每側 3 門、六扇大窗（兩端各一扇較窄）的精確位置（沿用 v2 產生器對 EMA 的註記，依照片估）',
                                 '車頂冷氣 2 具的大小與位置、車下設備（依照片估）；EP 才有的高壓電氣室罩在這裡沒有'],
                       livery='同 ED。'),
    'emu800-ep': dict(name='EMU800 區間車・中間車（EP，集電弓＋廁所）', role='mid', pitchM=20.3, bodyM=19.6, widthM=2.89, heightM=4.234,
                      sources=src('n800', 'tc800'), adopted=['車體 19,600／間距 20,300；EP 降弓全高 4,234；集電弓靠 EMb 端（Brecknell Willis 單臂）'],
                      conflicts=['降弓高 4,227（維基 infobox）與 4,234（維基本文、Train Collection）：採 4,234'],
                      inferred=['集電弓縱向位置（靠廁所小窗一端）、單臂外形'], livery='同 ED。'),
    'temu2000': dict(name='TEMU2000 普悠瑪・駕駛車（TED）', role='driving', pitchM=22.095, bodyM=21.745, widthM=2.9, heightM=4.05,
                     sources=src('n2000', 'tc2000'), adopted=['車體 21,745／間距 22,095、寬 2,900、全高 4,050（含圓弧冷氣）'],
                     conflicts=[], inferred=['小窗數量（依照片）、車頭燈具位置、車頭紅色 V 形面板形狀；車側「TRA」草書字樣略'],
                     livery='白底、窗下寬紅帶＋兩條細紅線，車頭紅色基調。'),
    'temu2000-mid': dict(name='TEMU2000 普悠瑪・中間車（TEMA／TEMB）', role='mid', pitchM=20.7, bodyM=20.0, widthM=2.9, heightM=4.05,
                         sources=src('n2000', 'tc2000'), adopted=['車體 20,000／間距 20,700、寬 2,900、全高 4,050'],
                         conflicts=[], inferred=['每側 13 扇小窗、單扇塞拉門位置'], livery='同 TED。'),
    'temu2000-tep': dict(name='TEMU2000 普悠瑪・中間車（TEP，單臂集電弓＋育嬰室）', role='mid', pitchM=20.7, bodyM=20.0, widthM=2.9, heightM=4.17,
                         sources=src('n2000', 'tc2000'), adopted=['降弓全高 4,170（維基）；單臂集電弓（工進精工所）直接裝在車頂；一端育嬰室大窗'],
                         conflicts=['降弓全高 4,300（Train Collection）與 4,170（維基）並列，採 4,170（車頂高 3,565＋約 0.6 m 折疊高度較合理）'],
                         inferred=['集電弓縱向位置'], livery='同 TED。'),
    'e500': dict(name='E500 電力機車（東芝，雙端駕駛室）', role='loco', pitchM=21.12, bodyM=20.77, widthM=2.91, heightM=4.28,
                 sources=src('toshiba', 'twarch', 'motc', 'udn', 'ltn', 'ltn24'),
                 adopted=['車體 20,770、寬 2,910、降弓全高 4,280、雙端駕駛室、Co-Co 轉向架', '亮橘色（臺鐵新聞稿）'],
                 conflicts=['車寬：《建築師雜誌》2,910.4 與維基 infobox 2,759 並列，採 2,910'],
                 inferred=['車頂百葉窗數量位置、集電弓數量（只畫 1 具，靠駕駛端）與單臂外形、駕駛室側門窗位置、車頭燈具與連結器細部、R 標誌只畫示意'],
                 livery='橘色車身、黑色駕駛室上罩與車頂、深灰車頂百葉；配色細節官方文字查不到，依照片（TRA E506）。'),
    'e200': dict(name='E200 電力機車（GE 系，雙端駕駛室）', role='loco', pitchM=17.4, bodyM=17.049, widthM=2.972, heightM=4.1,
                 sources=src('tce200', 'toshiba'),
                 adopted=['車體 17,049、寬 2,972、降弓全高 4,100、Co-Co、雙端駕駛室', '現役塗裝：上乳白、下朱橘、白線；端面 V 形；排障器黃黑相間'],
                 conflicts=[], inferred=['集電弓數量（只畫 1 具）、車頂設備、嵌板縫位置、前燈罩位置（依照片 TRA E223）'],
                 livery='上部乳白、下部朱橘＋白線、端面 V 字形色帶。'),
    'ppcoach': dict(name='PP 推拉式自強號客車（PPT）', role='mid', pitchM=20.3, bodyM=19.6, widthM=2.885, heightM=4.043,
                    sources=src('tcpp'), adopted=['連結器間距 20,300、寬 2,885、高 4,043（PPT1000）', '5 大窗＋前後各 1 半開窗、上下台門在前後兩端、車頂兩端各 1 具冷氣'],
                    conflicts=['PPT2000 高 4,040 與 PPT1000 4,043 差 3 mm，忽略'],
                    inferred=['body≈pitch−700、門窗精確位置、半開窗尺寸、車下設備'],
                    livery='銀色不銹鋼、窗附近橘色帶、窗下與車體下緣紅色細線。新舊橘色深淺不一，取單一橘。'),
    'ppcoach-end': dict(name='PP 客車（機車端，無貫通道風擋）', role='mid', pitchM=20.3, bodyM=19.6, widthM=2.885, heightM=4.043,
                        sources=src('tcpp'), adopted=['靠機車端面拆除風擋：+X 端不畫折棚（其餘同 ppcoach）'],
                        conflicts=[], inferred=[], livery='同 ppcoach。'),
    'juguang': dict(name='莒光號客車（FPK10400 系）', role='mid', pitchM=20.0, bodyM=19.3, widthM=2.9, heightM=3.8,
                    sources=src('tcck'), adopted=['長 20,000（當 pitch）、寬 2,900（10400／10500／10600 取中）、高 3,800', '每側 2 門、5 大窗＋兩端半開窗、車頂冷氣在客室前後兩端'],
                    conflicts=['寬度三型不同（2,885／2,980／2,900）取 2,900；最大差 80 mm'],
                    inferred=['body≈pitch−700、門窗精確位置'],
                    livery='白線以上米黃、以下橘色（照 Commons 照片 TRA_FPK10425_at_Xinzuoying_Station_20130802、TRA_E223_Changhua_20190412；查證筆記 5.4 的維基描述「橘色車身＋1 條白線」與兩張有日期的照片不符，不採用）。'),
}

# 五種編組（snapshot.json 的 formation.id）→ 逐輛網格；flip=1 表示繞 z 軸轉 180°。
# 集電弓車的網格把集電弓放在 -X 端：flip=0 時在「往後」那端（靠編組尾），flip=1 時在「往前」那端（靠 1 號車）。
def _emu3000():
    seq = [('emu3000', 0)] + [('emu3000-mid', 0)] * 10 + [('emu3000', 1)]
    seq[2] = ('emu3000-ep', 1)                  # 第 3 節：集電弓靠 1 號車端
    seq[6] = ('emu3000-ep', 1)                  # 第 7 節：靠 1 號車端
    seq[9] = ('emu3000-ep', 0)                  # 第 10 節：靠 12 號車端
    return seq


def _temu2000():
    seq = [('temu2000', 0)] + [('temu2000-mid', 0)] * 6 + [('temu2000', 1)]
    seq[2] = ('temu2000-tep', 1)                # 第 3 節 TEP：集電弓靠 1 號車端
    seq[5] = ('temu2000-tep', 0)                # 第 6 節 TEP：集電弓靠 8 號車端
    return seq


def _emu800():
    seq = [('emu800', 0)] + [('emu800-mid', 0)] * 6 + [('emu800', 1)]
    seq[2] = ('emu800-ep', 0)                   # 第 3 輛 EP：集電弓在 -X 端，往後靠第 4 輛（EMB）
    seq[5] = ('emu800-ep', 1)                   # 第 6 輛 EP：轉 180°，集電弓往前靠第 5 輛（EMB）
    return seq


FORMATIONS = {
    'emu3000': dict(name='EMU3000 新自強（12 節）', cars=_emu3000(), listedFor='南下',
                    notes=['車序從 1 號車排起；1 號車在屏東／高雄端（維基編組表「（逆行）屏東、高雄」），南下時 1 號車領頭，北上由網頁把車序反過來',
                           '集電弓在第 3、7、10 節（EP 車）：第 3、7 節靠 1 號車端、第 10 節靠 12 號車端（維基編組表）']),
    'temu2000': dict(name='TEMU2000 普悠瑪（8 節）', cars=_temu2000(),
                     notes=['TED‑TEMA‑TEP‑TEMB‑TEMB‑TEP‑TEMA‑TED；集電弓在第 3 節靠 1 號車端、第 6 節靠 8 號車端（維基編組表），前後對稱，不分方向']),
    'emu800': dict(name='EMU800 區間車（8 節・推估編組）', cars=_emu800(),
                   notes=['實車 EMU800 一列 8 輛：ED‑EMA‑EP‑EMB‑EMB‑EP‑EMA‑ED（維基百科 台鐵EMU800型電聯車：一列由兩個 4 輛動力單元組成；EP 的集電弓、電氣室與廁所靠 EMB 端）',
                          '第 3 輛 EP 的集電弓靠第 4 輛（EMB）、第 6 輛 EP 轉 180° 靠第 5 輛（EMB）；EMA 與 EMB 外觀相同，共用 emu800-mid，只有 EP 有集電弓',
                          '推估編組：班表分不出當班是 EMU500／700／800／900 哪一型、掛幾輛。臺鐵 113 年度附屬單位決算書的車輛說明提到 EMU800 型以 8 輛編組、EMU900 型以 10 輛編組，也提到部分區間車原為 4 輛；這裡取 8 輛，當班實際編組未確認',
                          'ED 連結器間距 21.6 m、其餘 20.3 m，畫面一列合計 165.0 m；snapshot 的 formation 長度 160 m 是占用計算用的代表值，畫面以 catalog 的 pitchM 為準']),
    'e1000': dict(name='PP 推拉式自強號（14 節；機車以 E500 呈現）',
                  cars=[('e500', 0), ('ppcoach-end', 0)] + [('ppcoach', 0)] * 10 + [('ppcoach-end', 1), ('e500', 1)],
                  notes=['班表資料標為 E1000；2026-07-01 起定期運用機車已改 E500（聯合報、自由時報 2026-06-27），本頁以 E500 呈現，E1000 網格不出貨',
                         '尾端機車為同一網格轉 180°；機車端客車不畫貫通道風擋']),
    'e200': dict(name='莒光號（9 節・推估編組；機車 E200）', cars=[('e200', 0)] + [('juguang', 0)] * 8,
                 notes=['推估編組：機車 E200 一輛＋莒光客車 8 輛。維基百科 莒光號列車記載 2004 年 5 月 21 日改點後，莒光號常態編組由 9 輛減為 8 輛，原文沒說明是否含機車，本站取客車 8 輛；當班實際編組未確認',
                        '莒光號機車可能是 E200 系或 E500；班表無法區分，取 E200；機車一律排在行進方向最前，客車不分前後']),
    # 環島之星（1、2 次）：主站 specialOf 命中 namedTrains 'star' 後 formationFor 回 id 'e500'，機車 1＋客車 6 共 7 節。
    # 客車用的網格是 rail-3d/assets/blender-map-v1/manifest.json models.e500.parts 第 2 節以後（juguang），9/12 fleet 已有。
    'e500': dict(name='環島之星（7 節・推估編組；機車 E500）', cars=[('e500', 0)] + [('juguang', 0)] * 6,
                 notes=['推估編組：機車 1 輛＋客車 6 輛；當班掛車數未提供（rail-3d/integration/formations.js 的 star 條目）',
                        '依據：交通部運輸研究所《日本鐵路觀光推動經驗與策略》（民國 107 年）記載環島之星每列次為 4 節商務車廂、1 節客廳車、1 節餐車，也提到可另加掛 3 至 4 節車廂、附掛 3 節莒光號自由行車廂；那是研究報告不是當班資料，實際編組未確認',
                        '客車外觀沿用主站 3D 對 e500 模板用的莒光客車網格（juguang，示意）；現行實車為三麗鷗萌旅號彩繪，本頁未建模',
                        '機車（與 9/12 PP 自強號同一個 E500 網格）一律排在行進方向最前，客車不分前後']),
}

LOD = dict(nearBelowSpan=220, farAboveSpan=260,
           note='相機視野跨度（公尺）低於 nearBelowSpan 用近景網格、高於 farAboveSpan 用遠景網格（中間保持現狀，避免抖動）')

NEAR_MAX, FAR_MAX = 16000, 2000
CATALOG_NOTE = '座標：+X 車頭、+Y 左、z=0 為鋼軌面、x=0 為該車連結器間距（pitch）中心；1 單位＝1 公尺，網頁不再縮放車體。'
CHANGED_FORMATIONS = {'emu800', 'e200', 'e500'}   # 10/16 版有變動或新增的編組；其餘須與 9/12 逐字相同


def _formation_entry(v):
    return dict(name=v['name'], cars=[dict(mesh=m, flip=bool(fl)) for m, fl in v['cars']],
                **({'listedFor': v['listedFor']} if 'listedFor' in v else {}), notes=v['notes'])


def gz_write(raw_path, dest_path):
    with open(dest_path, 'wb') as f:
        subprocess.run(['gzip', '-9', '-n', '-c', raw_path], stdout=f, check=True)
    return os.path.getsize(dest_path)


def _sha_gunzipped(path):
    with gzip.open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def main():
    os.makedirs(DEST, exist_ok=True)
    os.makedirs(TMP, exist_ok=True)
    carry = None
    if not REGEN_ALL:
        with open(os.path.join(CARRY, 'catalog.json'), encoding='utf-8') as f:
            carry = json.load(f)
        assert carry['schema'] == 2 and carry['lod'] == LOD and carry['note'] == CATALOG_NOTE, '9/12 catalog 的 schema／lod／note 與這裡不一致'
        assert set(META) - set(NEW_MESHES) == set(carry['meshes']), '網格清單與 9/12 不一致'
        assert not set(NEW_MESHES) & set(carry['meshes']), 'NEW_MESHES 與 9/12 既有網格重名'
        # 沒改的編組必須與 9/12 逐字相同（有變動的是 emu800、e200，新增的是 e500）
        for k, v in carry['formations'].items():
            if k not in CHANGED_FORMATIONS:
                assert _formation_entry(FORMATIONS[k]) == v, f'編組 {k} 與 9/12 不同'
    meshes, expected = {}, {'catalog.json'}
    built, copied = [], []
    for cid, meta in META.items():
        expected.update({f'{cid}.near.bin.gz', f'{cid}.far.bin.gz'})
        if not REGEN_ALL and cid not in NEW_MESHES:
            # 9/12 既有網格：逐 byte 複製 .bin.gz，catalog 條目原樣沿用，不經過產生器
            ent = copy.deepcopy(carry['meshes'][cid])
            for kind in ('near', 'far'):
                name = f'{cid}.{kind}.bin.gz'
                if os.path.realpath(CARRY) != os.path.realpath(DEST):
                    shutil.copyfile(os.path.join(CARRY, name), os.path.join(DEST, name))
                assert _sha_gunzipped(os.path.join(DEST, name)) == ent[kind]['sha256'], f'{name} 解壓後雜湊與 catalog 不符'
                assert os.path.getsize(os.path.join(DEST, name)) == ent[kind]['gzBytes'], f'{name} 大小與 catalog 不符'
            meshes[cid] = ent
            copied.append(cid)
            continue
        ent = dict(meta)
        for lod, kind in ((0, 'near'), (1, 'far')):
            m, sp = cars.BUILDERS[cid](lod)
            raw = os.path.join(TMP, f'{cid}.{kind}.bin')
            info = kit.export(m, raw)
            gz_size = gz_write(raw, os.path.join(DEST, f'{cid}.{kind}.bin.gz'))
            cap = NEAR_MAX if lod == 0 else FAR_MAX
            assert info['triangles'] <= cap, f'{cid} {kind} 三角形 {info["triangles"]} 超過 {cap}'
            ent[kind] = dict(file=f'{cid}.{kind}.bin', sha256=info['sha256'], byteLength=info['byteLength'], vertexCount=info['vertexCount'],
                             triangles=info['triangles'], gzBytes=gz_size, min=info['min'], max=info['max'])
        ent['extentM'] = round(ent['near']['max'][0] - ent['near']['min'][0], 3)
        meshes[cid] = ent
        built.append(cid)
    for cid, f in FORMATIONS.items():
        for mesh, flip in f['cars']:
            assert mesh in meshes, (cid, mesh)
    tot = sum(e[k]['gzBytes'] for e in meshes.values() for k in ('near', 'far'))
    boot = sum(e['far']['gzBytes'] for e in meshes.values())
    catalog = dict(schema=2, note=CATALOG_NOTE, lod=LOD, meshes=meshes,
                   formations={k: _formation_entry(v) for k, v in FORMATIONS.items()},
                   totals=dict(gzBytesAll=tot, gzBytesFar=boot, gzBytesNear=tot - boot))
    with open(os.path.join(DEST, 'catalog.json'), 'w', encoding='utf-8') as f:
        json.dump(catalog, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    # 目的地只能有清單內的檔案；多出來的不刪，直接中止讓人看
    stray = sorted(set(os.listdir(DEST)) - expected)
    missing = sorted(expected - set(os.listdir(DEST)))
    assert not stray, f'目的地有清單以外的檔案：{stray}'
    assert not missing, f'目的地缺少檔案：{missing}'
    on_disk = sum(os.path.getsize(os.path.join(DEST, n)) for n in expected if n.endswith('.bin.gz'))
    assert on_disk == tot, f'totals.gzBytesAll {tot} 與磁碟上的 .bin.gz 合計 {on_disk} 不符'
    shutil.rmtree(TMP, ignore_errors=True)
    print(f'寫入 {len(expected) - 1} 個網格檔＋catalog.json → {DEST}')
    print('產生器建出：', ', '.join(built) or '（無）', '｜逐 byte 沿用 9/12：', f'{len(copied)} 種（{len(copied) * 2} 檔）')
    print(f'gz 合計 {tot} B（遠景 {boot} B、近景 {tot - boot} B）')
    for cid, e in meshes.items():
        print(f"{cid:14s} near {e['near']['triangles']:5d} tris {e['near']['gzBytes']:7d} B | far {e['far']['triangles']:5d} tris {e['far']['gzBytes']:6d} B | extent {e['extentM']:.2f} m  pitch {e['pitchM']}")


if __name__ == '__main__':
    main()
