"""把 13 種車廂網格（近景＋遠景）輸出成重播頁用的 fleet/*.bin.gz 與 catalog.json。

用法：python3 export_fleet.py [--dest <fleet 目錄>]
  預設目的地為 <repo>/memories/tainan-2026-09-12/fleet。
  只寫入該目錄：<id>.near.bin.gz、<id>.far.bin.gz（gzip -9 -n）與 catalog.json；
  目錄內不在新清單的 .bin／.bin.gz（舊版網格）會刪除，避免封存清單多出未使用的檔案。
之後仍需由主流程執行 scripts/seal_tainan_memory.mjs 重新封存 integrity.json。
"""
import sys, os, json, subprocess, hashlib, tempfile, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit, cars

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '../../../..'))
DEST = os.path.join(REPO, 'memories/tainan-2026-09-12/fleet')
if '--dest' in sys.argv:
    DEST = os.path.abspath(sys.argv[sys.argv.index('--dest') + 1])
TMP = tempfile.mkdtemp(prefix='tainan-fleet-')   # 原始（未壓縮）.bin 只放系統暫存，跑完即刪，不留在 repo

S = {
    'hitachi': ('日立 EMU3000 設計頁（塗裝：白＋黑玻璃面罩、5 種點綴色）', 'https://www.hitachi.co.jp/rd/research/design/product/taiwan_tra/index.html'),
    'wiki3000': ('維基百科 台鐵EMU3000型電聯車（全長／全高、集電弓在第 3、7、10 節）', 'https://zh.wikipedia.org/wiki/台鐵EMU3000型電聯車'),
    'twrail3000': ('臺灣鐵道維基館 EMU3000（邊條紅／綠／藍分配、取消半開窗）', 'https://taiwanrailwiki.miraheze.org/wiki/附件:臺鐵EMU3000型電聯車'),
    'n800': ('日本車輛製造 EMU800（車体寸法 ED 21,250／其餘 19,600、寬 2,890）', 'https://www.n-sharyo.co.jp/business/tetsudo/pages/ztaiw_temu800.htm'),
    'tc800': ('Train Collection EMU800（連結器面間距 21,600／20,300、全高 3,990、EP 降弓 4,234、塗裝）', 'https://emu300ct.web.fc2.com/index/traemu/EMU800.htm'),
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
    'emu3000': dict(name='EMU3000 新自強・駕駛車（ED）', role='driving', pitchM=21.35, bodyM=21.0, widthM=2.91, heightM=3.49, floorM=1.18,
                    sources=src('wiki3000', 'hitachi', 'twrail3000'),
                    adopted=['車體 21,000／連結器間距 21,350（body 為日立駕駛手冊，pitch 為維基）', '寬 2,910、車頂高 3,490、地板高 1,180'],
                    conflicts=['維基全高「ED車 3,750」：推斷是 EP（集電弓降弓）的高度，採 3,490 作為 ED 車頂高'],
                    inferred=['窗數與窗型、門位置、窄縫窗形狀、冷氣機數量位置、車頭黑面罩形狀（依側面與 3/4 照片估）'],
                    livery='白色車身、黑色玻璃面罩；側面上緣紅色邊條為代表色（實車 01～16 組紅、17～35 組綠、36～50 組藍），標為示意。'),
    'emu3000-mid': dict(name='EMU3000 新自強・中間車（EM）', role='mid', pitchM=20.3, bodyM=19.6, widthM=2.91, heightM=3.49, floorM=1.18,
                        sources=src('wiki3000', 'hitachi'), adopted=['車體 19,600／連結器間距 20,300、寬 2,910、車頂高 3,490'],
                        conflicts=[], inferred=['每側 13 扇窄窗（依照片數）、每節每側 2 門在客室兩端、車頂冷氣 2 具'],
                        livery='同 ED。'),
    'emu3000-ep': dict(name='EMU3000 新自強・中間車（EP，單臂集電弓）', role='mid', pitchM=20.3, bodyM=19.6, widthM=2.91, heightM=3.75, floorM=1.18,
                       sources=src('wiki3000', 'twrail3000'), adopted=['單臂集電弓（PT-7183A）位於第 3、7、10 節；降弓全高 3,750（維基標為 ED 車，推斷實為 EP）'],
                       conflicts=['3,750 的歸屬（ED 或 EP）來源未明，此處推斷屬 EP'], inferred=['集電弓在車上的縱向位置、車頂高壓設備位置'], livery='同 ED。'),
    'emu800': dict(name='EMU800 區間車・駕駛車（ED，微笑號塗裝）', role='driving', pitchM=21.6, bodyM=21.25, widthM=2.89, heightM=3.99,
                   sources=src('n800', 'tc800'), adopted=['車體 21,250／間距 21,600、寬 2,890、全高 3,990（含冷氣）'],
                   conflicts=['日文維基註記 21,250 含連結器：與日車官網「車体寸法」不一致，採日車官網'],
                   inferred=['每側 3 門的位置、大窗數（依照片）、冷氣機數量位置、車頭燈具位置'],
                   livery='第一批「微笑號」：藍底面板＋黃色微笑弧、側面窗上黃帶、窗下黃藍帶。增購編組（小小兵）配色顛倒，不在本頁。'),
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
def _emu3000():
    seq = [('emu3000', 0)] + [('emu3000-mid', 0)] * 10 + [('emu3000', 1)]
    for idx in (2, 6, 9):                       # 第 3、7、10 節：單臂集電弓
        seq[idx] = ('emu3000-ep', 0)
    return seq


def _temu2000():
    seq = [('temu2000', 0)] + [('temu2000-mid', 0)] * 6 + [('temu2000', 1)]
    seq[2] = ('temu2000-tep', 0)                # 第 3 節 TEP
    seq[5] = ('temu2000-tep', 1)                # 第 6 節 TEP（後半 4 節單元轉向）
    return seq


FORMATIONS = {
    'emu3000': dict(name='EMU3000 新自強（12 節）', cars=_emu3000(), notes=['集電弓在第 3、7、10 節（EP 車）；第 7、10 節的朝向查不到，全部同向']),
    'temu2000': dict(name='TEMU2000 普悠瑪（8 節）', cars=_temu2000(), notes=['TED‑TEMA‑TEP‑TEMB‑TEMB‑TEP‑TEMA‑TED；集電弓在第 3、6 節（第 6 節為背向單元，網格轉 180°）']),
    'emu800': dict(name='EMU800 區間車（3 節示意）', cars=[('emu800', 0), ('emu800-ep', 0), ('emu800', 1)], notes=['實車 ED+EMa+EP+EMb（4 節）×2；3 節示意取 ED＋EP＋ED，中間車畫成有集電弓的 EP']),
    'e1000': dict(name='PP 推拉式自強號（14 節；機車以 E500 呈現）',
                  cars=[('e500', 0), ('ppcoach-end', 0)] + [('ppcoach', 0)] * 10 + [('ppcoach-end', 1), ('e500', 1)],
                  notes=['班表資料標為 E1000；2026-07-01 起定期運用機車已改 E500（聯合報、自由時報 2026-06-27），本頁以 E500 呈現，E1000 網格不出貨',
                         '尾端機車為同一網格轉 180°；機車端客車不畫貫通道風擋']),
    'e200': dict(name='莒光號（3 節示意；機車 E200）', cars=[('e200', 0), ('juguang', 0), ('juguang', 0)], notes=['莒光號 9/12 機車可能是 E200 系或 E500；班表無法區分，取 E200']),
}

LOD = dict(nearBelowSpan=220, farAboveSpan=260,
           note='相機視野跨度（公尺）低於 nearBelowSpan 用近景網格、高於 farAboveSpan 用遠景網格（中間保持現狀，避免抖動）')

NEAR_MAX, FAR_MAX = 16000, 2000


def gz_write(raw_path, dest_path):
    with open(dest_path, 'wb') as f:
        subprocess.run(['gzip', '-9', '-n', '-c', raw_path], stdout=f, check=True)
    return os.path.getsize(dest_path)


def main():
    os.makedirs(DEST, exist_ok=True)
    os.makedirs(TMP, exist_ok=True)
    meshes, keep = {}, {'catalog.json'}
    tot = boot = 0
    for cid, meta in META.items():
        ent = dict(meta)
        for lod, kind in ((0, 'near'), (1, 'far')):
            m, sp = cars.BUILDERS[cid](lod)
            raw = os.path.join(TMP, f'{cid}.{kind}.bin')
            info = kit.export(m, raw)
            gz_name = f'{cid}.{kind}.bin.gz'
            gz_size = gz_write(raw, os.path.join(DEST, gz_name))
            keep.add(gz_name)
            cap = NEAR_MAX if lod == 0 else FAR_MAX
            assert info['triangles'] <= cap, f'{cid} {kind} 三角形 {info["triangles"]} 超過 {cap}'
            ent[kind] = dict(file=f'{cid}.{kind}.bin', sha256=info['sha256'], byteLength=info['byteLength'], vertexCount=info['vertexCount'],
                             triangles=info['triangles'], gzBytes=gz_size, min=info['min'], max=info['max'])
            tot += gz_size
            if lod == 1:
                boot += gz_size
        ent['extentM'] = round(ent['near']['max'][0] - ent['near']['min'][0], 3)
        meshes[cid] = ent
    for cid, f in FORMATIONS.items():
        for mesh, flip in f['cars']:
            assert mesh in meshes, (cid, mesh)
    catalog = dict(
        schema=2,
        note='座標：+X 車頭、+Y 左、z=0 為鋼軌面、x=0 為該車連結器間距（pitch）中心；1 單位＝1 公尺，網頁不再縮放車體。',
        lod=LOD, meshes=meshes,
        formations={k: dict(name=v['name'], cars=[dict(mesh=m, flip=bool(fl)) for m, fl in v['cars']], notes=v['notes']) for k, v in FORMATIONS.items()},
        totals=dict(gzBytesAll=tot, gzBytesFar=boot, gzBytesNear=tot - boot))
    with open(os.path.join(DEST, 'catalog.json'), 'w', encoding='utf-8') as f:
        json.dump(catalog, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    removed = []
    for name in sorted(os.listdir(DEST)):
        if name not in keep and (name.endswith('.bin.gz') or name.endswith('.bin')):
            os.remove(os.path.join(DEST, name))
            removed.append(name)
    print(f'寫入 {len(keep) - 1} 個網格檔＋catalog.json → {DEST}')
    print('刪除舊檔：', ', '.join(removed) or '（無）')
    print(f'gz 合計 {tot} B（遠景 {boot} B、近景 {tot - boot} B）')
    shutil.rmtree(TMP, ignore_errors=True)
    for cid, e in meshes.items():
        print(f"{cid:14s} near {e['near']['triangles']:5d} tris {e['near']['gzBytes']:7d} B | far {e['far']['triangles']:5d} tris {e['far']['gzBytes']:6d} B | extent {e['extentM']:.2f} m  pitch {e['pitchM']}")


if __name__ == '__main__':
    main()
