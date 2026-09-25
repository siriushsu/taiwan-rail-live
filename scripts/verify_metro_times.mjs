#!/usr/bin/env node
// 捷運班表健全性 gate。**自動化管線的煞車**:watch_official.mjs 偵測到 TDX 班表變動後,
// 重抓→重建→跑這支,全綠才准自動 commit/部署;任一紅就停下來給人看。
//
// 為什麼需要:TDX 給過亂序、整段重複、時間亂碼的髒值(見 build_metro_times.mjs 的 depsOf/drop 清單)。
// 自動管線最怕的不是「抓不到」,是把髒資料靜靜地上線——它不會噴錯,只會讓某條線今天少一半班次。
//
// 兩類判準,刻意分開:
//   [結構] 物理不變式,與基準無關:時刻必須遞增、班距不能是 0 或荒謬值、days 必須指到存在的 set。
//   [相對] 與基準版本比幅度。**判準不寫死班數**(那是會漂移的量,見 judgment.md 心得 35),
//          寫的是「相對變動不得超過門檻」——門檻本身才是常數。
//
// 用法:
//   node scripts/verify_metro_times.mjs                    # 相對基準 = HEAD
//   node scripts/verify_metro_times.mjs --baseline <ref>   # 指定 git ref
//   node scripts/verify_metro_times.mjs --structure-only   # 只跑結構(新線首次建檔時用)
// 離開碼:0=全過 1=有紅燈
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['data/trtc_times.json', 'data/krtc_times.json', 'data/tymc_times.json',
  'data/ntdlrt_times.json', 'data/ntalrt_times.json', 'data/tmrt_times.json', 'data/sanying_times.json'];

// 幅度門檻。班表改點通常是個位數百分比;超過就是「改點」或「資料壞了」,兩者都該有人看一眼。
const MAX_COUNT_DRIFT = 0.15;      // 單一 set 班次數相對變動上限
const MAX_EDGE_DRIFT_SEC = 60 * 60; // 首/末班時刻位移上限
const MIN_HEADWAY_SEC = 60;         // 同方向相鄰發車最小間隔(小於此=重複班或亂碼)
const MAX_GAP_GROWTH_SEC = 30 * 60; // 幹線最大空檔相對基準的增幅上限(中間掉了一整段就會超)
// 單站服務斷層:要同時「絕對夠久」且「相對該線正常班距夠離譜」才算。兩個條件都要,是因為
// 深夜末班前後本來就會拉到 20 分以上(絕對值單獨用會假紅),而清晨小班距線的 3 倍可能才 15 分
// (相對值單獨用也會假紅)。
const MAX_STATION_HOLE_SEC = 45 * 60; // 單站同方向兩次停靠的最大容許間隔
const STATION_HOLE_FACTOR = 3;        // 且要大於該線該方向「正常班距」的這麼多倍

// [官方] 營運者公告的字面值,與建置吃的 TDX 不同源。上面的相對判準只跟上一版比,上一版本身錯了
// 就永遠綠——環狀線平日末班少 5 班(2026-09-18 查出)就是這樣過關的。
// 來源:新北捷運各站列車時刻表(114年8月1日生效),ntmetro.com.tw 各站頁的 PDF 與 .odt。
// 只收「沒有兩份官方來源互相打架」的值:Y07/Y20 平日與 Y07 假日的末段 PDF 與 .odt 一字不差;
// Y12 中和只有 PDF 可信(官網「中和站」的 .odt 內容是景平站)。兩份打架的(Y20 假日整天、
// Y07 平日 06 時四班、Y07 假日 19–21 時各一班)等使用者裁示,不進這張表。
// 值 = 該站該方向 from 以後每一個停靠的 HH:MM(跨午夜寫 24:xx,與產物秒數一致)。
const OFFICIAL = [
  { file: 'data/trtc_times.json', line: 'Y', set: '平日', station: 0, dir: 'asc', from: '23:00', src: 'Y07 大坪林 往新北產業園區',
    want: ['23:04', '23:12', '23:24', '23:36', '23:48', '24:00'] },
  { file: 'data/trtc_times.json', line: 'Y', set: '假日', station: 0, dir: 'asc', from: '23:00', src: 'Y07 大坪林 往新北產業園區',
    want: ['23:04', '23:12', '23:24', '23:36', '23:48', '24:00'] },
  { file: 'data/trtc_times.json', line: 'Y', set: '平日', station: 13, dir: 'desc', from: '23:00', src: 'Y20 新北產業園區 往大坪林',
    want: ['23:07', '23:15', '23:23', '23:31', '23:39', '23:48', '24:00'] },
  { file: 'data/trtc_times.json', line: 'Y', set: '平日', station: 5, dir: 'asc', from: '23:00', src: 'Y12 中和 往新北產業園區(PDF)',
    want: ['23:00', '23:10', '23:16', '23:24', '23:37', '23:48', '24:01', '24:12'] },
];

// 共用一段軌道的支線對與共線段站數(下面「疊車」判準的覆蓋率斷言):中和新蘆線兩支線共用
// 南勢角～大橋頭 12 站,淡海綠山線/藍海線共用紅樹林～濱海沙崙 9 站。站數也要釘:只釘「有找到」
// 的話,一站改名共線段就無聲地少比一站。
const TRUNK_PAIRS = {
  'data/trtc_times.json': { 'O_XINZHUANG×O_LUZHOU': 12 },
  'data/ntdlrt_times.json': { 'V×VB': 9 },
};

// [官方] 逐班追蹤:同一班車在沿線各站官方時刻表上的字面值,產物必須有一班車同時停這些站、
// 時刻逐一相符(可以還停別站)。上面的逐站判準只問「這站這方向有哪些時刻」,抓不到「時刻都在、
// 只是被接到別班車上」:機捷平日山鼻 07:37 區間車在林口斷掉時,長庚那幾個時刻一個不少,是被
// 三條鏈輪流拿錯(2026-09-18 查出;斷掉的那班直接整班刪掉也一樣全綠,當時突變實測過)。
// 來源:桃園捷運各站時刻表 https://www.tymetro.com.tw/tymetro-new/tw/_pages/travel-guide/timetable-A{站號}
// (2026-09-18 平日實查,往台北車站)。每個值都是該站時刻表上的字面值;怎麼知道是同一班:
//   ◆ 官方標記「尖峰跳站普通車(停靠A21、A18、A13、A12、A9→A1每站)」,各站的 ◆ 直接指明是同一班。
//   未標記的普通車/區間車在 A10→A2 站站停、彼此不超車(直達車各站另有標記),同站先後順序就是同一班。
// stops = [線檔站序 index, 站名, HH:MM];站名只用來確認 index 沒有漂掉。
const OFFICIAL_TRAINS = [
  { file: 'data/tymc_times.json', line: 'A', set: '平日', kind: '1',
    src: '機捷北上 ◆尖峰跳站普通車 環北 07:00',
    stops: [[20, '環北站', '07:00'], [17, '高鐵桃園站', '07:11'], [12, '機場第二航廈站', '07:25'], [11, '機場第一航廈站', '07:28'],
      [8, '林口站', '07:40'], [7, '長庚醫院站', '07:43'], [6, '體育大學站', '07:47'], [5, '泰山貴和站', '07:54'],
      [4, '泰山站', '07:57'], [3, '新莊副都心站', '07:59'], [2, '新北產業園區站', '08:02'], [1, '三重站', '08:06']] },
  { file: 'data/tymc_times.json', line: 'A', set: '平日', kind: '1',
    src: '機捷北上 山鼻 07:37 區間車',
    stops: [[9, '山鼻站', '07:37'], [8, '林口站', '07:45'], [7, '長庚醫院站', '07:48'], [6, '體育大學站', '07:52'], [5, '泰山貴和站', '07:58'],
      [4, '泰山站', '08:02'], [3, '新莊副都心站', '08:04'], [2, '新北產業園區站', '08:06'], [1, '三重站', '08:10']] },
  { file: 'data/tymc_times.json', line: 'A', set: '平日', kind: '1',
    src: '機捷北上 山鼻 07:28 普通車',
    stops: [[9, '山鼻站', '07:28'], [8, '林口站', '07:36'], [7, '長庚醫院站', '07:39'], [6, '體育大學站', '07:43'], [5, '泰山貴和站', '07:50'],
      [4, '泰山站', '07:53'], [3, '新莊副都心站', '07:55'], [2, '新北產業園區站', '07:58'], [1, '三重站', '08:02']] },
  // 南下末班普通車:各站時刻表(2026-09-18 平日、09-19 假日實查,兩天逐站相同)往老街溪方向「一般」
  // 標記的最後一筆。之後只有 △ 增開往機場班次(23:23、23:38,A1→A13),普通車之間不超車 ⇒ 各站最後一筆
  // 就是同一班。台北→三重跑 8 分(平常 6 分),曾被切成「台北→山鼻」與「三重→林口→領航」兩條錯的鏈。
  // 2026-09-22 官方改點:山鼻以南各站晚 1 分(山鼻 23:50→23:51 … 環北 24:27→24:28),官網各站時刻表
  // 09-22 實查山鼻 23:51、機場第一航廈 23:58,TDX 同日 SrcUpdateTime 平日假日同步;林口以北不變。
  ...['平日', '假日'].map(set => ({ file: 'data/tymc_times.json', line: 'A', set, kind: '1',
    src: '機捷南下 台北 23:08 末班普通車',
    stops: [[0, '台北車站', '23:08'], [1, '三重站', '23:16'], [2, '新北產業園區站', '23:20'], [3, '新莊副都心站', '23:22'],
      [4, '泰山站', '23:24'], [5, '泰山貴和站', '23:27'], [6, '體育大學站', '23:32'], [7, '長庚醫院站', '23:36'], [8, '林口站', '23:39'],
      [9, '山鼻站', '23:51'], [10, '坑口站', '23:54'], [11, '機場第一航廈站', '23:58'], [12, '機場第二航廈站', '24:00'], [13, '機場旅館站', '24:03'],
      [14, '大園站', '24:06'], [15, '橫山站', '24:09'], [16, '領航站', '24:12'], [17, '高鐵桃園站', '24:16'], [18, '桃園體育園區站', '24:19'],
      [19, '興南站', '24:24'], [20, '環北站', '24:28']] })),
  // 南下直達車 台北 22:30:各站時刻表(2026-09-18/09-21/09-22 平日、09-19 假日實查,四天逐站相同)標「加底線-
  // 直達車(停靠A1、A3、A8、A12、A13)」;22:30/22:45/23:00 三班機場第一航廈是 23:09/23:24/23:39,直達車之間
  // 不超車,同站先後即同一班。曾被切成「台北→長庚」與「機場第一→第二航廈」兩段(北上 22:40/22:55 同病,
  // 長庚那站整個不見),畫面上三班直達車開到長庚就消失。
  ...['平日', '假日'].map(set => ({ file: 'data/tymc_times.json', line: 'A', set, kind: '2',
    src: '機捷南下 台北 22:30 直達車',
    stops: [[0, '台北車站', '22:30'], [2, '新北產業園區站', '22:40'], [7, '長庚醫院站', '22:52'], [11, '機場第一航廈站', '23:09']] })),
  // 南下普通車 台北 18:08 與 ■ 台北 18:04:設計展(9/24–10/11)平日 16–20 時興南有一半的車到環北就收班
  // (圖例「加方形-2026台灣設計展期間,調整為開往A21班次(每站停靠)」台北 18:04/18:19/18:34,與「空心圓-
  // 增開區間服務班次(A12←→A21,每站停靠)」),環北「往中壢(老街溪站)」表上沒有它們。建置端曾把興南→環北
  // 量成 14 分(實跑 4 分),■ 車搶走 18:08 普通車在環北的 19:29、被接到老街溪,普通車反而跳過環北
  // (2026-09-25 查出,當日 647e318d 退回)。各站時刻表(2026-09-25 實查)09-29(二)、10-02(五)、10-13(二,
  // 展期後)三天 18:08 這班逐站相同;普通車(一般標記)彼此不超車,下一站第一班晚於本站發車的普通車即同一班。
  // ■ 三班之間也不超車,各站第一個 ■ 就是 18:04(10-02 週五同一班在 A13 以南改標空心圓,時刻相同)。
  // endsAt=終點站序:只比時刻抓不到「■ 被接到老街溪、普通車被截在環北」——截斷後補的環北到站剛好也是 19:29。
  // validThrough:■ 只存在於設計展班表,過了那天這條印「不適用」不算紅(TDX 撤班表的那天不該擋住巡檢)。
  { file: 'data/tymc_times.json', line: 'A', set: '平日', kind: '1', endsAt: 21,
    src: '機捷南下 台北 18:08 普通車(過環北開往老街溪)',
    stops: [[0, '台北車站', '18:08'], [1, '三重站', '18:14'], [2, '新北產業園區站', '18:18'], [3, '新莊副都心站', '18:20'],
      [4, '泰山站', '18:22'], [5, '泰山貴和站', '18:25'], [6, '體育大學站', '18:30'], [7, '長庚醫院站', '18:38'], [8, '林口站', '18:41'],
      [9, '山鼻站', '18:50'], [10, '坑口站', '18:53'], [11, '機場第一航廈站', '18:57'], [12, '機場第二航廈站', '19:00'], [13, '機場旅館站', '19:03'],
      [14, '大園站', '19:06'], [15, '橫山站', '19:09'], [16, '領航站', '19:12'], [17, '高鐵桃園站', '19:17'], [18, '桃園體育園區站', '19:20'],
      [19, '興南站', '19:25'], [20, '環北站', '19:29']] },
  { file: 'data/tymc_times.json', line: 'A', set: '平日', kind: '1', endsAt: 20, validThrough: '2026-10-11',
    src: '機捷南下 ■台北 18:04(設計展調整為開往環北)',
    stops: [[0, '台北車站', '18:04'], [1, '三重站', '18:10'], [2, '新北產業園區站', '18:14'], [3, '新莊副都心站', '18:16'],
      [4, '泰山站', '18:18'], [5, '泰山貴和站', '18:21'], [6, '體育大學站', '18:26'], [7, '長庚醫院站', '18:30'], [8, '林口站', '18:33'],
      [9, '山鼻站', '18:42'], [10, '坑口站', '18:45'], [11, '機場第一航廈站', '18:48'], [12, '機場第二航廈站', '18:51'], [13, '機場旅館站', '18:54'],
      [14, '大園站', '18:57'], [15, '橫山站', '19:00'], [16, '領航站', '19:03'], [17, '高鐵桃園站', '19:07'], [18, '桃園體育園區站', '19:10'],
      [19, '興南站', '19:15']] },
  // 北捷:臺北捷運在 data.taipei 發布的「站別時刻表_中和新蘆線平日」(EffectiveDate 2026-08-31,
  // resource c526a43a-fc82-4ba3-beda-0497a303fc4a),與建置吃的 TDX 不同源。只有逐站清單沒有車次,
  // 以 O-1(往迴龍)同方向先發先到逐站往下接。古亭→東門官方跑 5 分,落在窗外,這班曾整班不見。
  { file: 'data/trtc_times.json', line: 'O_XINZHUANG', set: '平日',
    src: '中和新蘆線 南勢角 11:15 往迴龍',
    stops: [[0, '南勢角', '11:15'], [1, '景安', '11:16'], [2, '永安市場', '11:18'], [3, '頂溪', '11:20'], [4, '古亭', '11:24'],
      [5, '東門', '11:29'], [6, '忠孝新生', '11:31'], [7, '松江南京', '11:33'], [8, '行天宮', '11:35'], [9, '中山國小', '11:37'],
      [10, '民權西路', '11:39'], [11, '大橋頭', '11:41'], [12, '台北橋', '11:43'], [13, '菜寮', '11:45'], [14, '三重', '11:47'],
      [15, '先嗇宮', '11:50'], [16, '頭前庄', '11:52'], [17, '新莊', '11:54'], [18, '輔大', '11:57'], [19, '丹鳳', '11:59']] },
  // 淡水信義線平日清晨往廣慈/奉天宮:data.taipei「站別時刻表_淡水信義線平日」(EffectiveDate 2026-08-31,
  // resource 968f7322-36ca-43c4-816c-9f8448a9b4fb)逐站字面值,圓山～雙連另由北捷看板帳本(D1 trtc_events)
  // 09-15～09-17 三個平日都有真車到站佐證。這班從唭哩岸 06:00 發車(北投機廠出車),同一分鐘石牌也有
  // 一班發車;76ad9ca7 的同分修法讓兩班在圓山 06:10/06:12 互搶,整段消失(c55f9462 先補回圓山～雙連片段,
  // 09-18 建置端改成同分時先到先配後,整班接出來,這裡改驗整班)。
  { file: 'data/trtc_times.json', line: 'R', set: '平日',
    src: '淡水信義線 唭哩岸 06:00(圓山 06:12)往廣慈/奉天宮',
    stops: [[19, '唭哩岸', '06:00'], [18, '石牌', '06:02'], [17, '明德', '06:04'], [16, '芝山', '06:05'], [15, '士林', '06:07'],
      [14, '劍潭', '06:09'], [13, '圓山', '06:12'], [12, '民權西路', '06:14'], [11, '雙連', '06:16'], [10, '中山', '06:17'],
      [9, '台北車站', '06:19'], [8, '台大醫院', '06:20'], [7, '中正紀念堂', '06:22'], [6, '東門', '06:25'], [5, '大安森林公園', '06:27'],
      [4, '大安', '06:29'], [3, '信義安和', '06:32'], [2, '台北101/世貿', '06:34'], [1, '象山', '06:36']] },
  // 淡水信義線平日末班往廣慈/奉天宮(淡水 00:00):同上 data.taipei 平日表逐站字面值,象山 01:01 已過凌晨一點。
  // 建置曾把 01:00 後的時刻一律當髒值:這班象山那筆被剪掉,紅樹林往淡水那筆記錄(01:01/01:05/01:17)
  // 更被判整筆損壞,整條線往淡水每班都跳過紅樹林;當時的出貨檔還停在 8/31 改點前,這班差 1～4 分。
  { file: 'data/trtc_times.json', line: 'R', set: '平日',
    src: '淡水信義線 淡水 24:00 末班往廣慈/奉天宮',
    stops: [[27, '淡水', '24:00'], [26, '紅樹林', '24:03'], [25, '竹圍', '24:06'], [24, '關渡', '24:09'], [23, '忠義', '24:11'],
      [22, '復興崗', '24:13'], [21, '北投', '24:17'], [20, '奇岩', '24:19'], [19, '唭哩岸', '24:21'], [18, '石牌', '24:24'],
      [17, '明德', '24:26'], [16, '芝山', '24:28'], [15, '士林', '24:30'], [14, '劍潭', '24:33'], [13, '圓山', '24:37'],
      [12, '民權西路', '24:40'], [11, '雙連', '24:41'], [10, '中山', '24:43'], [9, '台北車站', '24:45'], [8, '台大醫院', '24:46'],
      [7, '中正紀念堂', '24:48'], [6, '東門', '24:52'], [5, '大安森林公園', '24:54'], [4, '大安', '24:55'], [3, '信義安和', '24:57'],
      [2, '台北101/世貿', '24:59'], [1, '象山', '25:01']] },
  // ── 以下 2026-09-18「開窗改取時段附近的官方站間秒」那批(v0918j)。共同根因:官方時刻表的站間時間
  // 隨時段排,某些班的那一段比全日中位數長,掉出窗外被切開。每班都是整班逐站字面值。
  // 淡水信義線週六深夜往淡水:data.taipei「站別時刻表_淡水信義線週六」(EffectiveDate 2026-09-05,
  // resource 6fd19e60-2164-4b97-bd41-7059c4c943c8)direction 0 往淡水,廣慈起逐站 27 站。
  { file: 'data/trtc_times.json', line: 'R', set: '週六',
    src: '淡水信義線 廣慈/奉天宮 23:08 往淡水',
    stops: [[0, '廣慈/奉天宮', '23:08'], [1, '象山', '23:11'], [2, '台北101/世貿', '23:12'], [3, '信義安和', '23:14'], [4, '大安', '23:16'],
      [5, '大安森林公園', '23:18'], [6, '東門', '23:20'], [7, '中正紀念堂', '23:24'], [8, '台大醫院', '23:25'], [9, '台北車站', '23:28'],
      [10, '中山', '23:30'], [11, '雙連', '23:31'], [12, '民權西路', '23:33'], [13, '圓山', '23:35'], [14, '劍潭', '23:38'], [15, '士林', '23:40'],
      [16, '芝山', '23:42'], [17, '明德', '23:44'], [18, '石牌', '23:45'], [19, '唭哩岸', '23:49'], [20, '奇岩', '23:50'], [21, '北投', '23:52'],
      [22, '復興崗', '23:55'], [23, '忠義', '23:57'], [24, '關渡', '23:59'], [25, '竹圍', '24:03'], [26, '紅樹林', '24:06']] },
  // 中和新蘆線平日往蘆洲:同上 c526a43a…(平日,2026-08-31 生效)direction 0 往蘆洲。古亭→東門官方 5 分,
  // 全日中位數 3 分,這班曾只剩「東門→民權西路」6 站片段(南勢角～古亭那段落單後在大橋頭搶走真車的記錄)。
  { file: 'data/trtc_times.json', line: 'O_LUZHOU', set: '平日',
    src: '中和新蘆線 南勢角 22:26 往蘆洲',
    stops: [[0, '南勢角', '22:26'], [1, '景安', '22:27'], [2, '永安市場', '22:29'], [3, '頂溪', '22:32'], [4, '古亭', '22:35'],
      [5, '東門', '22:40'], [6, '忠孝新生', '22:42'], [7, '松江南京', '22:44'], [8, '行天宮', '22:46'], [9, '中山國小', '22:48'],
      [10, '民權西路', '22:50'], [11, '大橋頭', '22:51'], [12, '三重國小', '22:54'], [13, '三和國中', '22:56'], [14, '徐匯中學', '22:58'],
      [15, '三民高中', '23:00']] },
  // 機捷南下 △增開往機場(官方標記「A1→A13,目的地機場,每站停靠之普通車」):桃園捷運各站時刻表
  // (2026-09-18 平日、09-19 假日實查,兩天逐站相同)。全天只有 4 班(假日 2 班),樣本不足 5 個時舊建置
  // 改用線檔站間秒,但官方深夜台北→三重排 8 分(傍晚同型車 6 分),被切成「台北→山鼻」與「三重→林口」。
  // 2026-09-22 TDX 把 18:04 上架後平日變 5 班,整組中位數 6 分又把這兩班切開一次——建置改成站間秒只在
  // ±3 小時內取樣。同日官方改點:山鼻以南晚 1 分(山鼻 24:05→24:06,官網 09-22 實查山鼻 00:06/00:21、
  // 機場第一航廈 00:13/00:28)。終點 A13 機場第二航廈只有到站、官網沒有發車欄,不收。
  ...['平日', '假日'].flatMap(set => [
    { file: 'data/tymc_times.json', line: 'A', set, kind: '1', src: '機捷南下 △增開往機場 台北 23:23',
      stops: [[0, '台北車站', '23:23'], [1, '三重站', '23:31'], [2, '新北產業園區站', '23:35'], [3, '新莊副都心站', '23:37'], [4, '泰山站', '23:39'],
        [5, '泰山貴和站', '23:42'], [6, '體育大學站', '23:47'], [7, '長庚醫院站', '23:51'], [8, '林口站', '23:54'], [9, '山鼻站', '24:06'],
        [10, '坑口站', '24:09'], [11, '機場第一航廈站', '24:13']] },
    { file: 'data/tymc_times.json', line: 'A', set, kind: '1', src: '機捷南下 △增開往機場 台北 23:38',
      stops: [[0, '台北車站', '23:38'], [1, '三重站', '23:46'], [2, '新北產業園區站', '23:50'], [3, '新莊副都心站', '23:52'], [4, '泰山站', '23:54'],
        [5, '泰山貴和站', '23:57'], [6, '體育大學站', '24:02'], [7, '長庚醫院站', '24:06'], [8, '林口站', '24:09'], [9, '山鼻站', '24:21'],
        [10, '坑口站', '24:24'], [11, '機場第一航廈站', '24:28']] }]),
  // 高雄環狀輕軌假日順行:交通部 TDX KLRT StationTimeTable(營運者提供;與建置同源——這條驗的是「接對班」,
  // 不是值本身)。單線環狀、站站停、不超車 ⇒ 相鄰站依時刻先發先到就是同一班。凱旋中華→夢時代假日中午官方排
  // 4 分(平日同時段 2 分),曾在凱旋中華斷開、錯接到 21 分鐘後的駁二大義(假日 29 班都這樣)。
  // 起訖都是籬仔內 index 0,一班裡出現兩次,只收 1～37。
  { file: 'data/krtc_times.json', line: 'C', set: '假日',
    src: '高雄環狀輕軌 籬仔內 11:40 順行(凱旋中華 11:48→夢時代 11:52)',
    stops: [[1, '凱旋瑞田', '11:42'], [2, '前鎮之星', '11:46'], [3, '凱旋中華', '11:48'], [4, '夢時代', '11:52'], [5, '經貿園區', '11:54'],
      [6, '軟體園區', '11:56'], [7, '高雄展覽館', '11:59'], [8, '旅運中心', '12:01'], [9, '光榮碼頭', '12:03'], [10, '真愛碼頭', '12:05'],
      [11, '駁二大義', '12:09'], [12, '駁二蓬萊', '12:11'], [13, '哈瑪星', '12:15'], [14, '壽山公園站', '12:17'], [15, '文武聖殿站', '12:19'],
      [16, '鼓山區公所站', '12:22'], [17, '鼓山', '12:24'], [18, '馬卡道', '12:27'], [19, '臺鐵美術館', '12:29'], [20, '內惟藝術中心', '12:31'],
      [21, '美術館', '12:33'], [22, '聯合醫院', '12:35'], [23, '龍華國小', '12:39'], [24, '愛河之心', '12:43'], [25, '新上國小', '12:45'],
      [26, '大順民族', '12:48'], [27, '灣仔內(大順鼎山)', '12:49'], [28, '高雄高工', '12:52'], [29, '樹德家商', '12:55'], [30, '科工館', '12:58'],
      [31, '聖功醫院', '13:01'], [32, '凱旋公園站', '13:04'], [33, '衛生局站', '13:06'], [34, '五權國小站', '13:08'], [35, '凱旋武昌站', '13:10'],
      [36, '凱旋二聖站', '13:12'], [37, '輕軌機廠站', '13:14']] },
  // 環狀線平日尖峰往新北產業園區:交通部 TDX NTMC StationTimeTable(與建置同源)。這條考的是樣本配對:
  // 中和 Y12 記錄排除後景安→橋和是兩站(官方 5 分),尖峰班距 4～5 分,若樣本配「發車後第一個到站」
  // 會配到前一班(得 1 分),時段中位數被它主導,尖峰整批(07:26～08:23、16:54～18:39 共 24 班)消失。
  // Y12 中和是內插值(秒數不為 0),不收。
  { file: 'data/trtc_times.json', line: 'Y', set: '平日',
    src: '環狀線 大坪林 07:26 往新北產業園區(尖峰,景安→橋和跨過排除的中和)',
    stops: [[0, '大坪林', '07:26'], [1, '十四張', '07:28'], [2, '秀朗橋', '07:31'], [3, '景平', '07:32'], [4, '景安', '07:34'],
      [6, '橋和', '07:39'], [7, '中原', '07:41'], [8, '板新', '07:43'], [9, '板橋', '07:46'], [10, '新埔民生', '07:49'],
      [11, '頭前庄', '07:52'], [12, '幸福', '07:54']] },
];

// [官方] 起點必須是官方字面時刻:建置在「起點站整份缺記錄」時會往前回推一站始發(秒數不為 0)。
// 淡水信義線每一站都有官方記錄,回推出來的起點一定是假的:R-2 北投區間車曾每天 100 多班憑空從
// 復興崗開出(官方復興崗那些時刻一筆都沒有,2026-09-18 對 data.taipei 三種日型實查)。
const ORIGIN_LITERAL = { 'data/trtc_times.json': ['R'] };

const argv = process.argv.slice(2);
const flagVal = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const BASELINE = flagVal('--baseline') || 'HEAD';
const STRUCT_ONLY = argv.includes('--structure-only');

let fail = 0, checks = 0;
const ck = (ok, msg) => { checks++; console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) fail++; };
const hm = s => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}`;
// 臺北日期,只給 OFFICIAL_TRAINS 的 validThrough 用;VERIFY_TODAY=YYYY-MM-DD 覆寫(測過期那條路徑)
const TODAY = process.env.VERIFY_TODAY || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
const pct = x => (x * 100).toFixed(1) + '%';

// 一班 = [idx,sec, idx,sec, ...] 攤平,見 build_metro_times.mjs 檔頭
const secsOf = tr => { const o = []; for (let i = 1; i < tr.length; i += 2) o.push(tr[i]); return o; };
const idxsOf = tr => { const o = []; for (let i = 0; i < tr.length; i += 2) o.push(tr[i]); return o; };
const depOf = tr => tr[1];

// 行進方向:取「站序 index 逐步變化的正負號總和」,不比首末站。
// 環線(高雄輕軌 C、38 站)首末站同為 index 0,首末比對會把順逆兩個方向併成一組,
// 於是「同時 06:30 發車的順時針與逆時針兩班」被誤判成過近發車(2026-08-01 初版報 77 處)。
// 正負號總和對環線與非環線都對:繞一圈只有一個 wrap 步是反號,總和仍指向真方向。
const dirOf = tr => {
  const idx = idxsOf(tr);
  let s = 0;
  for (let i = 1; i < idx.length; i++) s += Math.sign(idx[i] - idx[i - 1]);
  return s >= 0 ? 'asc' : 'desc';
};

// 依「方向@起站」分組發車時刻。捷運首班車會同時從多個站發車、尖峰另有中途始發加班車
// (板南線亞東醫院那種),不分起站就是拿蘋果比橘子——2026-08-01 初版漏了這層,
// R/平日/desc 報 58 處過近發車,實測 58/58 都是不同起站、同時 06:00 發的首班車群。
function groupRuns(trains) {
  const g = new Map();
  for (const tr of trains) {
    const k = `${dirOf(tr)}@${tr[0]}`;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(depOf(tr));
  }
  return g;
}

// 幹線 = 每個方向班次最多的那個起站。中途始發只在尖峰跑,中間本來就有數小時的洞,
// 拿它問「最大間隔」一定假紅。
function trunkGaps(trains) {
  const g = groupRuns(trains), out = {};
  for (const dir of ['asc', 'desc']) {
    const cand = [...g].filter(([k]) => k.startsWith(dir + '@')).sort((a, b) => b[1].length - a[1].length)[0];
    if (!cand || cand[1].length < 3) continue;
    const deps = [...cand[1]].sort((a, b) => a - b);
    let biggest = 0;
    for (let i = 1; i < deps.length; i++) biggest = Math.max(biggest, deps[i] - deps[i - 1]);
    out[dir] = { start: cand[0], biggest };
  }
  return out;
}

function loadBaseline(rel) {
  try {
    return JSON.parse(execFileSync('git', ['show', `${BASELINE}:${rel}`], { cwd: ROOT, maxBuffer: 1 << 28, encoding: 'utf8' }));
  } catch { return null; }
}

for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) { ck(false, `${rel} 不存在`); continue; }
  const cur = JSON.parse(readFileSync(abs, 'utf8'));
  const lines = cur.lines || cur;
  const geoLines = JSON.parse(readFileSync(path.join(ROOT, rel.replace('_times', '')), 'utf8')).lines;
  const loopIds = new Set(geoLines.filter(l => l.loop).map(l => l.id));
  console.log(`\n[${rel}]`);

  for (const [lid, L] of Object.entries(lines)) {
    if (!L || !L.sets) { ck(false, `${lid} 沒有 sets`); continue; }
    const setNames = Object.keys(L.sets);
    ck(setNames.length > 0, `${lid} 有 ${setNames.length} 個營運日班表`);

    // ── 結構:days / holiday 必須指到真的存在的 set ──
    const days = L.days || [];
    ck(days.length === 7 && days.every(d => setNames.includes(d)),
      `${lid} days 七天皆指到存在的 set（${[...new Set(days)].join('/') || '缺'}）`);
    ck(!L.holiday || setNames.includes(L.holiday), `${lid} holiday「${L.holiday}」指到存在的 set`);

    for (const [tag, trains] of Object.entries(L.sets)) {
      ck(trains.length > 0, `${lid}/${tag} 有班次（${trains.length} 班）`);
      if (!trains.length) continue;

      // ── 結構:每班站數 ≥2、時刻嚴格遞增 ──
      let shortTrains = 0, nonMono = null;
      for (const tr of trains) {
        const s = secsOf(tr);
        if (s.length < 2) { shortTrains++; continue; }
        for (let i = 1; i < s.length; i++) {
          if (s[i] <= s[i - 1] && nonMono === null) nonMono = `發車 ${hm(s[0])} 第 ${i} 站 ${hm(s[i - 1])}→${hm(s[i])}`;
        }
      }
      ck(shortTrains === 0, `${lid}/${tag} 每班至少兩站（${shortTrains} 班不足）`);
      ck(nonMono === null, `${lid}/${tag} 逐站時刻嚴格遞增${nonMono ? `（首例：${nonMono}）` : ''}`);

      // ── 結構:非環線一班車不得中途掉頭(站序嚴格單調) ──
      // 2026-09-18 補。建置的碎片合併曾經不分方向,把落在鏈尾「後方」的碎片接成同一班
      // (機捷平日 …9@07:37 8@07:45 接 9@07:52 8@08:00…):時刻照樣遞增,上面每一條都綠。
      // 環線跨縫本來就是一次反向跳站,由建置端的跨縫防線管,這裡不問。
      if (!loopIds.has(lid)) {
        let uTurns = 0, uEx = null;
        for (const tr of trains) {
          const idx = idxsOf(tr), d = dirOf(tr) === 'asc' ? 1 : -1;
          const k = idx.findIndex((v, i) => i > 0 && Math.sign(v - idx[i - 1]) !== d);
          if (k < 0) continue;
          uTurns++;
          uEx ??= `發車 ${hm(tr[1])} 站序 ${idx[k - 1]}→${idx[k]}`;
        }
        ck(uTurns === 0, `${lid}/${tag} 無中途掉頭的班次（${uTurns} 班${uEx ? `，首例 ${uEx}` : ''}）`);
      }

      // ── 結構:發車間隔落在合理帶 ──
      // 方向用「首站 index vs 末站 index」判,不靠欄位:合成線與鏈匹配線的欄位不一致。
      // **必須按「起站」再分一層**:捷運首班車同時從多個站發車、尖峰另有中途始發加班車
      // (板南線亞東醫院那種),把不同起站的車放在一起比發車間隔是拿蘋果比橘子——
      // 2026-08-01 初版就是漏了這層,R/平日/desc 報 58 處「過近發車」,實測 58/58 都是
      // 不同起站、同時 06:00 發的首班車群,同起站分組後歸零。
      const groups = groupRuns(trains);
      let tooTight = 0, tightEx = null;
      for (const [k, deps] of groups) {
        if (deps.length < 3) continue;
        deps.sort((a, b) => a - b);
        for (let i = 1; i < deps.length; i++) {
          if (deps[i] - deps[i - 1] < MIN_HEADWAY_SEC) { tooTight++; tightEx ??= `${k} ${hm(deps[i - 1])}/${hm(deps[i])}`; }
        }
      }
      ck(tooTight === 0, `${lid}/${tag} 同起站同方向無過近發車（<${MIN_HEADWAY_SEC}s 的有 ${tooTight} 處${tightEx ? `，首例 ${tightEx}` : ''}）`);

      // ── 結構:相鄰數站的服務不得整段斷掉(缺記錄的指紋) ──
      // 2026-09-18 補。上面那些判準全部只看「一班車自己」合不合法,所以逐站時刻表某幾站
      // 整段缺記錄時,鏈匹配串出來的假折返車一班一班都合法,整份卻少掉半條線的服務——
      // 環狀線 Y 平日大坪林～景安 19:23–23:03 一筆記錄都沒有,314 班數字漂亮、結構全綠,
      // 前端非即時模式照畫,使用者看到的是「晚上每一班到中和就消失」。
      // 判準是站與站互相比,不寫死任何時刻:同一方向裡,任一站的服務空檔不得超過該線
      // 「當時還在跑」的中位空檔太多倍——某站在別站正常發車的時段整段沒有停靠,就是缺記錄。
      const stopsAt = new Map(); // `${dir}|${idx}` → 停靠時刻
      for (const tr of trains) {
        const dir = dirOf(tr);
        for (let i = 0; i < tr.length; i += 2) {
          const k = `${dir}|${tr[i]}`;
          if (!stopsAt.has(k)) stopsAt.set(k, []);
          stopsAt.get(k).push(tr[i + 1]);
        }
      }
      // 要相鄰兩站同時斷、時段還重疊才算:單站漏掉一次停靠(淡海假日淡金鄧公)車還是照跑,
      // 地圖上看不出來;整排站一起斷才是「那段線上沒有車」,也才是使用者會回報的故障。
      let holes = 0, holeEx = null;
      for (const dir of ['asc', 'desc']) {
        const idxs = [...stopsAt.keys()].filter(k => k.startsWith(dir + '|'))
          .map(k => Number(k.split('|')[1])).sort((a, b) => a - b);
        // 該方向各站空檔的中位數,取全線最大的那一站當「這條線正常的班距上限」
        const medianGap = i => {
          const v = [...(stopsAt.get(`${dir}|${i}`) || [])].sort((a, b) => a - b);
          if (v.length < 4) return 0;
          const gaps = []; for (let k = 1; k < v.length; k++) gaps.push(v[k] - v[k - 1]);
          gaps.sort((a, b) => a - b);
          return gaps[Math.floor(gaps.length / 2)];
        };
        const typical = Math.max(...idxs.map(medianGap), 0);
        if (!(typical > 0)) continue;
        const holesOf = i => {
          const v = [...(stopsAt.get(`${dir}|${i}`) || [])].sort((a, b) => a - b);
          if (v.length < 4) return [];              // 首班車碎片那種零星站,樣本不足不問
          const out = [];
          for (let k = 1; k < v.length; k++) {
            const gap = v[k] - v[k - 1];
            if (gap >= MAX_STATION_HOLE_SEC && gap >= typical * STATION_HOLE_FACTOR) out.push([v[k - 1], v[k]]);
          }
          return out;
        };
        const byIdx = new Map(idxs.map(i => [i, holesOf(i)]));
        for (const i of idxs) {
          for (const [a, b] of byIdx.get(i) || []) {
            const shared = [i - 1, i + 1].some(j => (byIdx.get(j) || [])
              .some(([c, d]) => Math.min(b, d) - Math.max(a, c) >= MAX_STATION_HOLE_SEC));
            if (!shared) continue;
            holes++;
            holeEx ??= `${dir} 站序 ${i} ${hm(a)}→${hm(b)}（${Math.round((b - a) / 60)} 分）`;
          }
        }
      }
      ck(holes === 0, `${lid}/${tag} 無整段服務斷層（${holes} 處${holeEx ? `，首例 ${holeEx}` : ''}）`);
    }
  }

  // ── 結構:共線段上兩條線的車不得同站同向同時通過(疊車) ──
  // 2026-09-18 補。淡海假日幹線的站別記錄在綠山線/藍海線兩組間互相歸錯,建置把歸錯的一兩筆
  // 補成 2~3 站的短班——它就是另一條支線那班真車的分身(濱海沙崙 V 08:39:00 對 VB 08:39:38)。
  // 上面每一條都只看單一條線,一班一班都合法,所以抓不到。
  // 共線段=兩線共有、且在兩條線裡都跟另一個共有站相鄰的站(轉乘站只共一站,不算)。
  // 通過時刻:停靠站用產物值,沒停的站按站距在前後停靠之間線性內插。
  const trunkPairs = new Map(); // `A×B` → 共線段站數
  const geoRun = geoLines.filter(l => lines[l.id] && lines[l.id].sets && !loopIds.has(l.id));
  for (let a = 0; a < geoRun.length; a++) for (let b = a + 1; b < geoRun.length; b++) {
    const A = geoRun[a], B = geoRun[b];
    const nA = A.stations.map(s => s.name), nB = B.stations.map(s => s.name);
    const toA = new Map(); // B 站序 → A 站序(只收共線段)
    nA.forEach((n, i) => {
      const j = nB.indexOf(n);
      if (j >= 0 && [nA[i - 1], nA[i + 1]].some(x => x !== undefined && nB.includes(x) && Math.abs(nB.indexOf(x) - j) === 1)) toA.set(j, i);
    });
    if (toA.size < 2) continue;
    const trunkA = new Set(toA.values());
    trunkPairs.set(`${A.id}×${B.id}`, toA.size);
    const [[j0, i0], [j1, i1]] = [...toA];
    const flip = Math.sign(i1 - i0) === Math.sign(j1 - j0) ? 1 : -1; // 兩線站序方向相同或相反
    const passes = (L, tr) => { // [站序, 通過秒, 站序方向]
      const out = [], dOf = i => L.stations[i].d ?? i;
      for (let k = 2; k < tr.length; k += 2) {
        const [ia, ta, ib, tb] = [tr[k - 2], tr[k - 1], tr[k], tr[k + 1]], st = Math.sign(ib - ia);
        if (k === 2) out.push([ia, ta, st]);
        for (let m = ia + st; m !== ib; m += st)
          out.push([m, ta + (tb - ta) * (dOf(m) - dOf(ia)) / ((dOf(ib) - dOf(ia)) || 1), st]);
        out.push([ib, tb, st]);
      }
      return out;
    };
    // 按「同一天兩條線各跑哪個 set」配對,不按 set 名稱:名稱一分岔(北捷 R 線就是週六/週日,
    // 別線是假日)按名稱配就無聲地一個都不比。星期、國定假日、特定日期各配一次,去重。
    const LA = lines[A.id], LB = lines[B.id];
    const dowOf = d => new Date(`${d}T00:00:00Z`).getUTCDay();
    const tagPairs = new Map();
    const addPair = (ta, tb) => { if (LA.sets[ta] && LB.sets[tb]) tagPairs.set(`${ta}\x00${tb}`, [ta, tb]); };
    for (let w = 0; w < 7; w++) addPair(LA.days?.[w], LB.days?.[w]);
    addPair(LA.holiday, LB.holiday);
    for (const d of new Set([...Object.keys(LA.dates || {}), ...Object.keys(LB.dates || {})]))
      addPair(LA.dates?.[d] ?? LA.days?.[dowOf(d)], LB.dates?.[d] ?? LB.days?.[dowOf(d)]);
    ck(tagPairs.size > 0, `${A.id}×${B.id} 至少有一天兩條線都有班表可比（配到 ${tagPairs.size} 組）`);
    for (const [tagA, tagB] of tagPairs.values()) {
      const tag = tagA === tagB ? tagA : `${tagA}/${tagB}`;
      const at = new Map();
      for (const tr of LA.sets[tagA]) for (const [m, t, st] of passes(A, tr)) {
        if (!trunkA.has(m)) continue;
        const k = `${m}|${st}`;
        if (!at.has(k)) at.set(k, []);
        at.get(k).push(t);
      }
      let hits = 0, hitEx = null;
      for (const tr of LB.sets[tagB]) for (const [m, t, st] of passes(B, tr)) {
        if (!toA.has(m)) continue;
        for (const u of at.get(`${toA.get(m)}|${st * flip}`) || []) {
          if (Math.abs(u - t) >= MIN_HEADWAY_SEC) continue;
          hits++;
          hitEx ??= `${A.stations[toA.get(m)].name} ${A.id} ${hm(u)} / ${B.id} ${hm(t)}（${B.id} 那班 ${hm(tr[1])} 自站序 ${tr[0]} 發）`;
        }
      }
      ck(hits === 0, `${A.id}×${B.id}/${tag} 共線段 ${toA.size} 站無疊車（同站同向相隔 <${MIN_HEADWAY_SEC}s 的有 ${hits} 處${hitEx ? `，首例 ${hitEx}` : ''}）`);
    }
  }
  // 覆蓋率:共線段是路網的結構事實,這裡列的每一對都必須被上面找到、站數也要對——
  // 站名一改就會無聲地一對都不比,或少比一站
  for (const [p, n] of Object.entries(TRUNK_PAIRS[rel] || {}))
    ck(trunkPairs.get(p) === n, `${p} 的共線段 ${n} 站都有被疊車檢查涵蓋（本檔找到：${[...trunkPairs].map(([k, v]) => `${k} ${v} 站`).join('、') || '無'}）`);

  // ── 官方:與營運者公告的字面值逐筆比對 ──
  for (const o of OFFICIAL.filter(o => o.file === rel)) {
    const trains = (lines[o.line] && lines[o.line].sets[o.set]) || [];
    const fromSec = Number(o.from.slice(0, 2)) * 3600 + Number(o.from.slice(3)) * 60;
    const got = [];
    for (const tr of trains) {
      if (dirOf(tr) !== o.dir) continue;
      for (let i = 0; i < tr.length; i += 2) if (tr[i] === o.station && tr[i + 1] >= fromSec) got.push(tr[i + 1]);
    }
    const g = got.sort((a, b) => a - b).map(hm);
    ck(g.join(' ') === o.want.join(' '),
      `${o.line}/${o.set} ${o.src} ${o.from} 後與官方時刻表一致（官方 ${o.want.join(' ')}${g.join(' ') === o.want.join(' ') ? '' : `；產物 ${g.join(' ') || '無'}`}）`);
  }
  for (const o of OFFICIAL_TRAINS.filter(o => o.file === rel)) {
    if (o.validThrough && TODAY > o.validThrough) {
      console.log(`  ⏭ ${o.line}/${o.set} ${o.src}：官方班表只到 ${o.validThrough}，今天 ${TODAY} 不適用`);
      continue;
    }
    const geo = geoLines.find(l => l.id === o.line);
    const badIdx = o.stops.filter(([i, name]) => !geo || !geo.stations[i] || geo.stations[i].name !== name);
    ck(!badIdx.length, `${o.line} ${o.src}：站序 index 對得上線檔站名${badIdx.length ? `（對不上 ${badIdx.map(([i, n]) => `${i}≠${n}`).join('、')}）` : ''}`);
    const trains = (lines[o.line] && lines[o.line].sets[o.set]) || [];
    const kinds = (lines[o.line] && lines[o.line].kinds && lines[o.line].kinds[o.set]) || '';
    const stopsOf = tr => { const m = new Map(); for (let i = 0; i < tr.length; i += 2) m.set(tr[i], hm(tr[i + 1])); return m; };
    const ti = trains.findIndex(tr => { const m = stopsOf(tr); return o.stops.every(([i, , t]) => m.get(i) === t); });
    // 找不到時印出「從第一站那個時刻出發的那班」實際長什麼樣,紅燈當下就看得出斷在哪、被接去哪
    const [i0, , t0] = o.stops[0];
    const near = trains.find(tr => stopsOf(tr).get(i0) === t0);
    const fmt = tr => idxsOf(tr).map((i, k) => `${i}@${hm(secsOf(tr)[k])}`).join(' ');
    const endIdx = ti >= 0 ? trains[ti][trains[ti].length - 2] : null;
    const endOk = ti < 0 || o.endsAt == null || endIdx === o.endsAt;
    ck(ti >= 0 && (!o.kind || kinds[ti] === o.kind) && endOk,
      `${o.line}/${o.set} ${o.src} 整班照官方時刻表逐站相符（官方 ${o.stops.map(([i, , t]) => `${i}@${t}`).join(' ')}` +
      (o.endsAt != null ? `，終點 ${o.endsAt}` : '') +
      (ti < 0 ? `；產物 ${near ? fmt(near) : '無此班'}` : kinds[ti] === o.kind || !o.kind ? '' : `；車種 ${kinds[ti] || '未標'}≠${o.kind}`) +
      (endOk ? '' : `；產物終點 ${endIdx}：${fmt(trains[ti])}`) + '）');
  }

  for (const lid of ORIGIN_LITERAL[rel] || []) {
    const bad = [];
    for (const [set, trains] of Object.entries((lines[lid] && lines[lid].sets) || {}))
      for (const tr of trains) if (tr[1] % 60) bad.push(`${set} ${tr[0]}@${hm(tr[1])}`);
    ck(!bad.length, `${lid} 每班起點都是官方字面時刻（不是回推）${bad.length ? `：${bad.length} 班回推，如 ${bad.slice(0, 3).join('、')}` : ''}`);
  }

  if (STRUCT_ONLY) continue;

  // ── 相對:與基準比幅度 ──
  const base = loadBaseline(rel);
  if (!base) { ck(false, `${rel} 取不到基準 ${BASELINE}（新檔就加 --structure-only）`); continue; }
  const bLines = base.lines || base;
  for (const lid of Object.keys(bLines)) {
    ck(lid in lines, `${lid} 仍存在（基準有這條線）`);
  }
  for (const [lid, L] of Object.entries(lines)) {
    const B = bLines[lid];
    if (!B || !B.sets) { console.log(`  · ${lid} 是基準沒有的新線，跳過相對比對`); continue; }
    for (const [tag, trains] of Object.entries(L.sets)) {
      const bt = B.sets[tag];
      if (!bt) { console.log(`  · ${lid}/${tag} 是新的營運日型別，跳過相對比對`); continue; }
      const drift = (trains.length - bt.length) / bt.length;
      ck(Math.abs(drift) <= MAX_COUNT_DRIFT,
        `${lid}/${tag} 班次數 ${bt.length}→${trains.length}（${drift >= 0 ? '+' : ''}${pct(drift)}，上限 ±${pct(MAX_COUNT_DRIFT)}）`);
      const edge = arr => { const d = arr.map(depOf); return [Math.min(...d), Math.max(...d)]; };
      const [cf, cl] = edge(trains), [bf, bl] = edge(bt);
      ck(Math.abs(cf - bf) <= MAX_EDGE_DRIFT_SEC, `${lid}/${tag} 首班 ${hm(bf)}→${hm(cf)}（位移 ≤ ${MAX_EDGE_DRIFT_SEC / 60} 分）`);
      ck(Math.abs(cl - bl) <= MAX_EDGE_DRIFT_SEC, `${lid}/${tag} 末班 ${hm(bl)}→${hm(cl)}（位移 ≤ ${MAX_EDGE_DRIFT_SEC / 60} 分）`);
      // 幹線最大空檔:刻意用「相對基準的增幅」而非絕對門檻。改點本來就會讓某個時段的洞
      // 變大變小,寫絕對值只會逼出一個遲早被下次改點推翻的魔術數字;要抓的是「新長出來的洞」。
      // 註(2026-09-18):這裡原本記著「環狀線 Y 平日上行 19:23–23:03 的 220 分大洞是這條線
      // 本來就有的」——那不是本來就有,是 TDX 逐站時刻表缺了大坪林～景安五站整段記錄,
      // 已由 metro_times_gapfill.mjs 補回,上面新增的「整段服務斷層」判準負責擋它再回來。
      const cg = trunkGaps(trains), bg = trunkGaps(bt);
      for (const dir of ['asc', 'desc']) {
        if (!cg[dir] || !bg[dir]) continue;
        const grew = cg[dir].biggest - bg[dir].biggest;
        ck(grew <= MAX_GAP_GROWTH_SEC,
          `${lid}/${tag}/${dir} 幹線最大空檔 ${Math.round(bg[dir].biggest / 60)}→${Math.round(cg[dir].biggest / 60)} 分（增幅 ≤ ${MAX_GAP_GROWTH_SEC / 60} 分）`);
      }
    }
  }
}

console.log(`\n${fail ? `✗ ${fail}/${checks} 項未過` : `✓ 全部通過（${checks} 項）`}`);
process.exit(fail ? 1 : 0);
