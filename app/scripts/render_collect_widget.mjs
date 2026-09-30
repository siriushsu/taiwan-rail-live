#!/usr/bin/env node
// 把「車站收集」小工具的四種家族（小、中、鎖屏矩形、鎖屏圓形）算繪成 PNG，並用一組閘門判定紅綠——
// 不必進模擬器、不必上手機。（2026-09-29 23:04 使用者裁示拿掉大卡，harness 的 large 案例與拼圖同步拿掉。）
//
// 做法（與 render_widget_kit.mjs 同型）：CollectionCard.swift 是純 SwiftUI 的版面檔（只依賴
// RailWidgetKit／RailNativeL10n），整檔逐字交給 swiftc 編成 macOS 執行檔，用 ImageRenderer 出 PNG。
// 不抽宣告：抽取有「抽到舊版」的風險；整檔納入的話，檔案哪天開始依賴別的檔，編譯當場失敗。
// Widget／Provider／EntryView（要 AppIntents、Color(uiColor:)）不在這個檔裡，由
// verify_widget_typecheck.mjs 以 iOS 目標整批型別檢查補上；它們只能靠 u 閘門靜態掃描。
//
// 🔴 期望值全部在這支腳本（node）從 payload 獨立重算，Swift 端只回報「量到什麼」：
//    Swift 端自己算的數字拿去對自己等於零資訊（判準與實作同源）。
//
// 閘門：
//   a1 文字框不與地圖框相交（PreferenceKey 回報的是每個 Text 自己的框，不是外層容器）
//   a2 文字【字形】不與地圖相交：地圖藏起來只佔位再算圖一次，地圖框內任何墨跡都是文字侵入
//   b1 Canvas 真的畫了幾個點（探針每畫一個記一筆）＝ payload 依範圍濾出的點數（其他系統灰／未收集／跟完／實心各自）
//   b2 每個應畫的點，畫面上那個座標的圓盤內有墨跡（位置對得上；空心圈的圓心是底色，所以量圓盤不量圓心）；b3 地圖寬高比＝payload.aspect
//   c  各數字（百分比含「<1%」「99%」邊界、座數、各系統 v／n、最近蓋章）與 payload 一致；圖例文字；c2 進度條填滿比例；
//      另含「內建示意資料 CollectionWidgetPreview.json ＝ 本腳本的樣本」
//   d  關鍵數字沒有被縮放或截成「…」（實際寬 ≥ 不受限的理想寬）
//   e  文字不超出內容框（16pt 內距；鎖屏 0）；h 文字與文字不互疊
//   hd 【標題列省略順序】契約畫法約定 8（小卡、中卡）：「範圍名＋車站收集」理想寬放得下（量測用隱形標題列 header#ideal ≤ 可用寬）⟺ 兩個都在；
//      放不下只剩契約指定的那個（全台＝車站收集、單一系統＝系統名），靠左、全台留下的用標題字級；放得下不准縮，放不下縮不低於 75%（行高）再截斷；
//      真實簡稱只走得到「兩個都放」與「只放系統名」，縮字與截斷靠合成名稱 fixture（name8…name24）走到，覆蓋率有具名斷言
//   v  【單一系統視窗】規格第二輪第 3 點：探針記下的每個圓心，與 node 依規格公式（外框＋pad、正方形視窗、
//      等比填滿地圖框）從 payload 獨立算出的座標一致（容差 ≤1.5pt；全台範圍同樣照整島框公式驗）；
//      單一系統（≥2 座站）的點陣外框至少撐開地圖框短邊的 50%；地圖框位置大小與同條件的全台卡一樣（版面不跳）
//   r  【空心圈】規格第二輪第 4 點，用合成三態 payload 量像素：s=2 圓心＝線色；s=1 圓心接近底色、圈上接近線色；
//      s=0 圓心＝未收集灰；淺色、深色、著色各驗一次。取代舊的 g（淡色 vs 實心；淡色已被空心圈取代）
//   s  【蓋章鈕】小卡、中卡（鎖屏不放）× 淺色、深色、著色 × 繁中、英文、日文（--lang 各跑一次）：鈕有字（＝目錄裡「蓋章」該語言的值）、
//      在內容框內、看得見（膠囊底與卡底有差、字形與膠囊底有對比，量出貨 PNG）、不與任何文字／進度條／地圖相交；沒有檔案的提示卡不放鈕。
//      靜態掃描：小卡 Button(intent: CollectCheckinIntent())、中卡 Link(CollectionStamp.checkinURL＝railisland://checkin)、
//      intent 有 openAppWhenRun、待辦保鮮 ≤120 秒且 take 先清再判斷、plugin 收 host checkin 並帶 view:"checkin"、待辦轉成 waitOpen。
//      動態：把 CollectCheckinIntent.swift 連同 MetroWaitPending 的替身編成執行檔，量待辦「寫一次讀一次、119 秒有效、121 秒過期、過期也清、時間往回撥視為過期」。
//   u  【點小工具開旅程護照】靜態掃 Swift 原始碼：四種家族共用的最外層掛且只掛一次
//      widgetURL(railisland://passport)；supportedFamilies 沒有 systemLarge；RailMetroWaitPlugin 收 host passport
//      並帶 view:"passport"（小工具 target 編不進 harness，動態量不到，靜態掃是唯一守門人）
//   o1–o5  【台灣輪廓】每案例多算一張「只關掉輪廓」的圖（collectOutlineHidden），與出貨那張逐像素比。
//      取樣點一律手寫經緯度、用契約的投影框（docs/collect-widget-contract.md：lon 120.15–122.0、lat 22.2–25.27）自己投影，
//      期望色是設計值（填色淺 0.945／深 0.125、卡底淺 0.98／深 0.09、未收集灰淺 0.88／深 0.24），不從 Swift 讀：
//      o1 全台（無點的 bare 樣本）：內陸的陸地取樣點＝填色、離岸的海上取樣點＝卡底、恆春半島南端（lon 120.8／lat 22.0，
//         在點陣框底之下約 6%）＝填色（沒被裁到點陣框）
//      o2 輪廓不侵入：與「關掉輪廓」那張比，文字框、進度條框、蓋章鈕框內一個像素都不能差；並配正向對照——
//         輪廓確實有畫（全張至少 50 個像素不同），不然「沒有侵入」是空話；輪廓層要 allowsHitTesting(false)
//      o3 對比：未收集灰點放在陸地填色上的 WCAG 對比 ≥ 放在卡底上的 0.9 倍（淺色、深色各一組，量合成三態樣本的出貨圖）
//      o4 單一系統是細線不是填色：視窗中心附近的陸地內部取樣點＝卡底，且輪廓落墨面積 ≤ 地圖框的 15%（填色會有三成以上）
//      o5 著色模式：輪廓有畫（離卡底 ≥ 0.06），但比已收集的點淡（≤ 該點離卡底距離的一半）；輪廓層不加 widgetAccentable
//   t  【蓋章鈕可點範圍】harness 回報的 stamp.hit（Button／Link 的 label 框）：包住鈕、不出卡片、不與任何文字／進度條／地圖的框相交；
//      尺寸達標（小卡 ≥ 44 寬，高 ≥ 44（430pt 機型）／≥ 40（393pt 機型）；中卡 ≥ 44 寬——中卡縱向被百分比與第一列系統列擋死，只驗包住鈕）；
//      鈕本身的外觀尺寸與改點擊範圍前相同（繁中；小 40×22／36×19、中 38×16／34×15）；Button／Link 的 label 就是這顆鈕（靜態掃描）
//
// 用法：node app/scripts/render_collect_widget.mjs [輸出目錄] [--quick] [--src <小工具原始碼目錄>]
//       node app/scripts/render_collect_widget.mjs --mutation-test [輸出目錄] [--only M18,M19]   （不帶 --only＝全部突變，前後各一次控制組）
//       node app/scripts/render_collect_widget.mjs --emit-preview <路徑>   重寫 CollectionWidgetPreview.json（＝本腳本的樣本）
//       node app/scripts/render_collect_widget.mjs [輸出目錄] --quick --emit-help-previews <目標目錄>   說明中心預覽圖重生：閘門全綠才寫，
//         把 assets/widgets/ios/ 的 collect-small／collect-medium／collect-rect.webp 從「這一輪剛算繪的出貨 PNG」重生
//         （不手動裁切；小卡 480×480、中卡 720×337、鎖屏矩形 480×216，尺寸沿用原檔，webp 品質從高往低找第一個 ≤28 KB 的；
//         守門人 scripts/verify_widget_previews.mjs 每檔上限 30 KB）。目標目錄通常是 <repo>/assets/widgets/ios
//       node app/scripts/render_collect_widget.mjs [輸出目錄] --lang en｜ja   英日文版面壓力測試：系統簡稱與文案換成該語言
//         （RailNativeL10n 在複本裡改讀 RailNativeL10n.json），c 閘門（繁中字串比對）不適用，其餘照跑；PNG 要人眼看
// 輸出：<目錄>/shots/*.png、contact-*.png、results.json、gates.json

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const realSrc = join(repo, 'app/ios/App/RailBoardWidget');
const appSrc = join(repo, 'app/ios/App/App');

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !['--src', '--lang', '--emit-preview', '--only', '--emit-help-previews'].includes(argv[i - 1]));
const LANG = opt('--lang'); // en｜ja：英日文版面壓力測試（見下方 langStress）
const outRoot = resolve(positional[0] ?? join(repo, 'tmp/collect-widget/ios-shots'));

// ── 尺寸：430pt 機型是設計基準，393pt 是 RailScale 下限那一側 ─────────────────────────
const SIZES = {
  430: { small: [170, 170], medium: [364, 170], rect: [160, 72], circ: [76, 76] },
  393: { small: [158, 158], medium: [338, 158], rect: [160, 72], circ: [76, 76] },
};
const INSET = 16;
const SCALE = 3;
const BG = { light: 0.98, dark: 0.09 };
/** 未收集灰（CollectionPalette.off）——r 閘門用；契約值，不是從 Swift 讀的。 */
const OFF_GRAY = { light: 0.88, dark: 0.24 };
/**
 * 台灣輪廓的陸地填色（全台範圍）——09-30 比較圖量過對比後定案的設計值，契約值，不是從 Swift 讀的。
 * 著色模式（mono）改用 primary 加低透明度：harness 跑在 macOS，`Color.primary` 是 alpha 0.85 的黑／白（同 lineColor 的說明），
 * 填色 opacity 0.05 → 有效 alpha 0.0425 疊在卡底上。
 */
const OUTLINE_FILL = { light: 0.945, dark: 0.125 };
const monoOutlineFill = scheme => { const a = 0.85 * 0.05; return scheme === 'dark' ? a + (1 - a) * BG.dark : (1 - a) * BG.light; };

// ── 輪廓閘門（o 系列）的取樣點：手寫經緯度，用契約的投影框自己投影，不讀 Swift、不讀輪廓資料 ──────────
/** 契約的投影框：docs/collect-widget-contract.md 的 box＝[lon0, lat0, lon1, lat1]（固定值；網頁端 COLLECT_BOX 同值）。 */
const BOX = [120.15, 22.2, 122.0, 25.27];
/** 經緯度 → 整島框座標（0..1000，x 由西到東、y 由北到南；框外照算，不夾）。 */
const lonLatToXY = (lon, lat) => [((lon - BOX[0]) / (BOX[2] - BOX[0])) * 1000, ((BOX[3] - lat) / (BOX[3] - BOX[1])) * 1000];
/**
 * 陸地取樣點：都在內陸，離海岸 ≥14 km；海上取樣點：都離岸 ≥14 km 且在點陣框內。
 * （2026-09-30 寫的時候拿原始資料 data/taiwan_land.json 逐點驗過陸／海與離岸距離；在最小的地圖上，14 km 仍有 ≥4 px，
 * 不會落在抗鋸齒的邊上。閘門本身不讀那份資料，期望值就是這張手寫表。）
 */
const OUTLINE_LAND = [['玉山', 120.957, 23.47], ['埔里', 120.967, 23.964], ['台中', 120.679, 24.138], ['潮州', 120.54, 22.55],
  ['池上', 121.22, 23.12], ['宜蘭', 121.6, 24.75], ['嘉義', 120.45, 23.48], ['竹東', 121.09, 24.73]];
const OUTLINE_SEA = [['台灣海峽中', 120.2, 24.2], ['太平洋', 121.95, 23.6], ['東南外海', 121.3, 22.23], ['北部外海', 121.2, 25.25], ['台灣海峽北', 120.25, 24.9]];
/**
 * 恆春半島南端：投影後 y≈1060–1065，在點陣框底（1000）之下約 6%——輪廓畫布要往下多開才畫得到，
 * 裁到點陣框就會被切平（離海岸 5、7 km，最小的地圖上 ≥4 px）。
 */
const OUTLINE_PENINSULA = [['恆春半島（lon 120.8／lat 22.0）', 120.8, 22.0], ['恆春半島北一點', 120.78, 22.02]];
/** 輪廓一定畫得出來的單一系統（視窗內看得到海岸線）；視窗中心都在陸地內部（離海岸 47／16／7 km，視窗放大後仍 ≥20pt）。 */
const OUTLINE_SCOPED = ['tra', 'trtc', 'krtc'];
/** 蓋章鈕改可點範圍前量到的外觀（pt，繁中）：[寬, 高, 左, 上]。尺寸與位置都不准變（2026-09-30 改前的出貨版量的）。 */
const CHIP_BEFORE = { 'small-430': [40, 22, 16, 132], 'small-393': [36, 19, 16, 123], 'medium-430': [38, 16, 310, 33], 'medium-393': [34, 15, 288, 32] };
/** 可點範圍的下限（pt）：寬 ≥44（HIG）；小卡高 430pt 機型 ≥44、393pt 機型 ≥40（下面到卡底、上面到文字框已是上限）；
 *  中卡縱向被百分比文字框與第一列系統列擋死，只要求不小於鈕本身。 */
const HIT_MIN = { 'small-430': [44, 44], 'small-393': [44, 40], 'medium-430': [44, 16], 'medium-393': [44, 15] };
/**
 * 合成的較高中卡（只給最近蓋章的「放得下幾筆就畫幾筆」用，不是真機尺寸）：兩種真機尺寸的高度都只放得下 2 筆（第 3 筆要的空間不夠），
 * 「寫死 2 筆」與「放得下才畫」在它們上面長得一模一樣；加高到放得下 3、4 筆（180／195pt，量到的），兩種實作才分得出來。寬度同 430 機型（縮放比例與鈕的位置相同），
 * 所以鈕的外觀與可點範圍下限沿用 430 機型的值。
 */
const TALL_HEIGHTS = [180, 195];
for (const h of TALL_HEIGHTS) {
  SIZES[`tall${h}`] = { medium: [SIZES[430].medium[0], h] };
  HIT_MIN[`medium-tall${h}`] = HIT_MIN['medium-430'];
  CHIP_BEFORE[`medium-tall${h}`] = CHIP_BEFORE['medium-430'];
}
const DOT_RADIUS_RATIO = 0.0075, DOT_RADIUS_FLOOR = 1.0, SOLID_SCALE = 1.3, RING_RATIO = 0.45;

// ── payload 樣本 ───────────────────────────────────────────────────────────────────────
// 樣本＝已進版控的 CollectionWidgetPreview.json（網頁 collectionWidgetPayload() 產生的示範 payload，recent 是下面
// RECENT_BY_SYS 合成的每系統最近蓋章；withRecent 對它是冪等的，c 閘門因此抓得到「合成表與預覽檔漂移」）。
// 空狀態＝同一份歸零：與網頁在沒有任何蓋章時送出的 payload 扣掉 at 逐欄相等（2026-09-30 對過）。
// Android 的案例產生器（app/scripts/android-collect-widget/gen_cases.py）讀同一份，兩個平台的示範資料不會分岔。
const samplePath = join(repo, 'app/ios/App/RailBoardWidget/CollectionWidgetPreview.json');
const sample = JSON.parse(readFileSync(samplePath, 'utf8'));
const emptyPayload = JSON.parse(JSON.stringify(sample));
emptyPayload.n = 0;
for (const sy of emptyPayload.sys) sy.v = 0;
for (const pt of emptyPayload.pts) pt[3] = 0;

/**
 * 每個系統各 4 筆以內的最近蓋章（規格第二輪第 2 點：payload 改成每系統各取最近 4 筆，
 * 合併後整體依 d 新到舊）。站名、線名都是示意資料。
 */
const RECENT_BY_SYS = {
  tra: [['菁桐', '平溪線', '2026-09-27'], ['十分', '平溪線', '2026-09-27'], ['池上', '臺東線', '2026-09-21'], ['瑞芳', '宜蘭線', '2026-09-12']],
  thsr: [['左營', '高鐵', '2026-09-20'], ['臺中', '高鐵', '2026-08-30']],
  trtc: [['淡水', '淡水信義線', '2026-09-25'], ['象山', '淡水信義線', '2026-09-25'], ['南港展覽館', '板南線', '2026-09-19'], ['動物園', '文湖線', '2026-09-08']],
  tymc: [['機場第一航廈', '機場捷運', '2026-09-14'], ['桃園', '機場捷運', '2026-09-14']],
  tmrt: [['高鐵臺中站', '綠線', '2026-09-16'], ['文心崇德', '綠線', '2026-09-16']],
  krtc: [['美麗島', '橘線', '2026-09-22'], ['西子灣', '橘線', '2026-09-22'], ['巨蛋', '紅線', '2026-09-20'], ['小港', '紅線', '2026-09-18']],
  ntdlrt: [['漁人碼頭', '藍海線', '2026-09-11']],
  sanying: [['鶯歌', '三鶯線', '2026-09-05']],
  afr: [['阿里山', '阿里山林鐵', '2026-09-10']],
};
/** --lang en 時把示意站名換成較長的英文（壓力測試用）；ja 保留原字。 */
const EN_NAMES = {
  菁桐: 'Jingtong', 十分: 'Shifen', 池上: 'Chishang', 瑞芳: 'Ruifang', 平溪線: 'Pingxi Line', 臺東線: 'Taitung Line', 宜蘭線: 'Yilan Line',
  左營: 'Zuoying', 臺中: 'Taichung', 高鐵: 'THSR', 淡水: 'Tamsui', 象山: 'Xiangshan', 南港展覽館: 'Taipei Nangang Exhibition Center',
  動物園: 'Taipei Zoo', 淡水信義線: 'Tamsui-Xinyi Line', 板南線: 'Bannan Line', 文湖線: 'Wenhu Line', 機場第一航廈: 'Taoyuan Airport Terminal 1',
  桃園: 'Taoyuan', 機場捷運: 'Taoyuan Airport MRT', 高鐵臺中站: 'HSR Taichung', 文心崇德: 'Wenxin Chongde', 綠線: 'Green Line',
  美麗島: 'Formosa Boulevard', 西子灣: 'Sizihwan', 巨蛋: 'Kaohsiung Arena', 小港: 'Siaogang', 橘線: 'Orange Line', 紅線: 'Red Line',
  漁人碼頭: "Fisherman's Wharf", 藍海線: 'Blue Ocean Line', 鶯歌: 'Yingge', 三鶯線: 'Sanying Line', 阿里山: 'Alishan', 阿里山林鐵: 'Alishan Forest Railway',
};
/** 依 payload 的 sys.v 產生 recent：有收集的系統才有；整體依 d 新到舊，同日依系統順序（fixture 沒有 n 可比）。 */
function withRecent(p) {
  const items = [];
  p.sys.forEach((sy, i) => {
    if (sy.v > 0) for (const [name, line, d] of RECENT_BY_SYS[sy.k] ?? []) items.push({ name, line, k: sy.k, d, i });
  });
  items.sort((a, b) => b.d.localeCompare(a.d) || a.i - b.i);
  p.recent = items.map(({ i, ...rest }) => rest);
  return p;
}
withRecent(sample);
withRecent(emptyPayload);
/** 沒被 --lang 改寫過的樣本：c 閘門拿它比對 CollectionWidgetPreview.json（en／ja 也要比）。 */
const samplePristine = JSON.parse(JSON.stringify(sample));

/**
 * --lang en｜ja：把 payload 的系統簡稱換成網頁端 COLLECT_SYS 在該語言實際送出的 label（index.html），
 * 最近蓋章的站名換成較長的英文。用途：量英日文字串在各版面會不會被縮、被截、互疊。
 * 所有閘門照跑，含 c：c 的字串期望值改取目錄翻譯（見 tr），缺 key 或佔位符對不上就紅。
 */
const LANG_LABELS = {
  en: ['TRA', 'THSR', 'Taipei', 'Airport', 'Taichung', 'Kaohsiung', 'Danhai', 'Ankeng', 'Sanying', 'Alishan'],
  ja: ['台鉄', '高鉄', '台北', '空港', '台中', '高雄', '淡海', '安坑', '三鶯', '阿里山'],
};
const langStress = p => {
  p.sys.forEach((sy, i) => { sy.label = LANG_LABELS[LANG][i]; });
  if (LANG === 'en') for (const r of p.recent) { r.name = EN_NAMES[r.name] ?? r.name; r.line = EN_NAMES[r.line] ?? r.line; }
  return p;
};
if (LANG) {
  if (!LANG_LABELS[LANG]) throw new Error(`--lang 只收 ${Object.keys(LANG_LABELS).join('、')}`);
  langStress(sample);
  langStress(emptyPayload);
}

const clone = o => JSON.parse(JSON.stringify(o));
/** 全收滿：n＝total、每系統 v＝n、每個點 s=2（測 100% 的寬度與滿條）。 */
function fullPayload() {
  const p = clone(sample);
  p.n = p.total;
  for (const s of p.sys) s.v = s.n;
  for (const pt of p.pts) pt[3] = 2;
  return withRecent(p);
}
/** 只收 1 站：全台 1/538 與台鐵 1/241 都四捨五入成 0 → 「<1%」，進度條要靠 3% 下限才看得見。 */
function onePayload() {
  const p = clone(emptyPayload);
  p.n = 1;
  p.sys[0].v = 1;
  p.pts.find(pt => pt[4] === 0)[3] = 2;
  return withRecent(p);
}
/** 只差 1 站收滿：全台 537/538＝99.81%、台鐵 240/241＝99.59%，都四捨五入成 100 → 顯示「99%」。 */
function almostPayload() {
  const p = clone(sample);
  p.n = p.total - 1;
  for (const s of p.sys) s.v = s.n;
  p.sys[0].v -= 1;
  for (const pt of p.pts) pt[3] = 2;
  p.pts.find(pt => pt[4] === 0)[3] = 0;
  return withRecent(p);
}
/** 林鐵只剩 1 座站（且已收集）：單一系統視窗的下限路徑（w＝h＝0 → pad 10、邊長 40），外框門檻對它豁免。 */
function soloPayload() {
  const p = clone(sample);
  const first = p.pts.findIndex(pt => pt[4] === 9);
  p.pts = p.pts.filter((pt, i) => pt[4] !== 9 || i === first);
  p.pts[p.pts.findIndex(pt => pt[4] === 9)][3] = 2;
  p.sys[9].v = 1; p.sys[9].n = 1;
  p.n += 1; p.total -= 20;
  return withRecent(p);
}
/**
 * 合成的「三態」payload：十個系統各一列，每列 s=0／1／2 各一點，列距與欄距都遠大於點徑，
 * 每個點都孤立——拿來量「空心 vs 實心 vs 未收集」的像素，不受相鄰點疊色干擾。
 */
const STATE_COLORS = ['#5D6D7E', '#FFDB00', '#F48B9F', '#79BCE8', '#8CC8A0', '#6A8EAE', '#E85D0D', '#0070BD', '#C0392B', '#8246AF'];
function statesPayload() {
  // 取自真實線色，特意含最難分辨的淡色（黃、粉、淺藍、淺綠）與灰藍（台鐵幹線 #5D6D7E）。
  const p = clone(sample);
  p.pts = [];
  STATE_COLORS.forEach((c, row) => [0, 1, 2].forEach((s, col) => p.pts.push([200 + col * 300, 50 + row * 100, c, s, row])));
  p.sys.forEach(s => { s.v = 2; s.n = 3; });
  p.n = 20; p.total = 30;
  return p;
}
/** 一個點都沒有（pts＝[]）：地圖上只剩台灣輪廓，o1 拿它量「陸地＝填色、海＝卡底」不被任何點干擾。 */
function barePayload() {
  const p = clone(emptyPayload);
  p.pts = [];
  return p;
}
/**
 * 容錯閘門（契約「畫法約定」10）：dirty＝夾了壞元素的 payload（App 讀到的），DIRTY_CLEAN＝拿掉壞元素的乾淨版（期望值的來源）。
 * 壞元素：recent 的 name 為 null（最新一筆、歸台鐵）、d 是數字 → 略過；pts 的 x 為 null、不是陣列、只有 3 個元素、
 * s＝3（放在離台鐵外框很遠的東北角：誤算進視窗外框，視窗就會位移，v 閘門抓得到）→ 略過；
 * color 為 null（s＝2、在台鐵範圍內）→ 用品牌色照畫、算一點（乾淨版給它一個合法色碼，位置與狀態相同）。
 */
function dirtyPair() {
  const dirty = clone(sample), clean = clone(sample);
  const anchor = sample.pts.find(pt => pt[4] === 0);
  const colorless = [anchor[0] + 2, anchor[1] + 2, null, 2, 0];
  dirty.recent = [{ name: null, line: '平溪線', k: 'tra', d: '2026-09-28' }, { name: '壞站', line: '平溪線', k: 'tra', d: 20260928 }, ...dirty.recent];
  dirty.pts = [[null, 300, '#5D6D7E', 1, 0], 'oops', ...dirty.pts, [100, 100, '#5D6D7E'], [995, 5, '#5D6D7E', 3, 0], colorless];
  clean.pts = [...clean.pts, [colorless[0], colorless[1], '#5D6D7E', 2, 0]];
  return { dirty, clean };
}
const DIRTY = dirtyPair();
/** 結構壞了＝整包作廢（走「打開軌島一次」）：缺 sys；sys 有一筆的 v 為 null（pts 的 sysIdx 指向它，不能略過）。 */
function brokenPayload() { const p = clone(sample); delete p.sys; return p; }
function brokenSysPayload() { const p = clone(sample); p.sys[1].v = null; return p; }
/** 轉乘站（契約 recent[].ks）：紅樹林屬北捷與淡海、日期最新；兩個單一系統範圍都要看得到它，全台版面不畫最近蓋章。 */
function transferPayload() {
  const p = clone(sample);
  p.recent.unshift({ name: '紅樹林', line: '淡水信義線', k: 'trtc', ks: ['trtc', 'ntdlrt'], d: '2026-09-29' });
  return p;
}
/**
 * 標題列名稱長度掃描（契約畫法約定 8）：台鐵的系統簡稱換成 N 個全形字的合成名稱。真實簡稱（繁中兩字、英文 TRA…Kaohsiung、日文兩三字）
 * 只會落在「兩個名稱都放得下」與「只放得下系統名」兩個區間，縮字與截斷的路徑沒有任何真實案例走到；合成名稱補上它們。
 * 全形字一字一個字級寬，所以各長度落在哪個區間由字級與欄寬決定、與語言無關（所有語言用同一串，語言只影響「車站收集」那半邊）。
 * 長度是照 430pt 機型量到的（剛好放進去要縮到的比例 need ＝ 可用寬 ÷ 理想寬；小卡可用 138pt、標題 13pt，中卡可用約 192pt、標題 14pt）：
 *   小卡：8 字 need 1.34（放得下）、12 字 0.89（縮字放得進去）、15／19／22／24 字 0.71／0.56／0.49／0.45（縮到下限 75% 仍放不下，截斷）；
 *   中卡：8 字 1.73、12 字 1.15（放得下）、15 字 0.92（縮字放得進去）、19／22／24 字 0.73／0.63／0.58（截斷）。
 * 判準不讀這些數字，落在哪個區間由量到的理想寬推；hd 閘門另有覆蓋率斷言，字級或版面改了讓任何一個區間沒有案例走到就紅，提醒重新量。
 */
const NAME_LENGTHS = [8, 12, 15, 19, 22, 24];
const NAME_CHARS = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地';
function nameFixture(n) {
  const p = clone(sample);
  p.sys[0].label = NAME_CHARS.slice(0, n);
  return p;
}
const FIXTURES = {
  sample, empty: emptyPayload, none: null, full: fullPayload(), one: onePayload(), almost: almostPayload(),
  solo: soloPayload(), states: statesPayload(), bare: barePayload(),
  dirty: DIRTY.dirty, broken: brokenPayload(), brokenSys: brokenSysPayload(), transfer: transferPayload(),
  ...Object.fromEntries(NAME_LENGTHS.map(n => [`name${n}`, nameFixture(n)])),
};
/** 這些 fixture 送進 App 的樣子與期望值的來源不同（期望值取乾淨版）。 */
const EXPECT_FROM = { dirty: DIRTY.clean };
/** 讀不到有效資料的狀態：只該有「打開軌島一次」提示。 */
const UNAVAILABLE = new Set(['none', 'broken', 'brokenSys']);

// ── 期望值：從 payload 獨立重算（不讀任何 Swift 端的數字）──────────────────────────────
/** 百分比數字部分（規格第二輪第 5 點）：四捨五入；有收集卻成 0 → '<1'；沒收滿卻成 100 → '99'。 */
function pctNumber(v, total) {
  const p = v > 0 && total > 0 ? Math.min(100, Math.round((v * 100) / total)) : 0;
  if (v > 0 && p === 0) return '<1';
  if (v < total && p >= 100) return '99';
  return String(p);
}
/** 單一系統視窗（規格第二輪第 3 點）：外框＋pad、正方形、以外框中心為中心。 */
function windowOf(pts) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  const pad = Math.max(0.12 * Math.max(w, h), 10);
  const S = Math.max(w + 2 * pad, h + 2 * pad, 40);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return { x0: cx - S / 2, y0: cy - S / 2, S };
}
const inWindow = (vp, p) => p[0] >= vp.x0 && p[0] <= vp.x0 + vp.S && p[1] >= vp.y0 && p[1] <= vp.y0 + vp.S;

function expected(fix, scope) {
  const idx = scope ? fix.sys.findIndex(s => s.k === scope) : -1;
  const scoped = idx >= 0;
  const v = scoped ? fix.sys[idx].v : fix.n;
  const total = scoped ? fix.sys[idx].n : fix.total;
  const own = fix.pts.filter(p => (scoped ? p[4] === idx : true));
  const vp = scoped && own.length ? windowOf(own) : null;
  const others = scoped ? fix.pts.filter(p => p[4] !== idx && (!vp || inWindow(vp, p))) : [];
  const recent = (scoped ? fix.recent.filter(r => r.k === scope || (Array.isArray(r.ks) && r.ks.includes(scope))) : fix.recent).slice(0, 4);
  const top = fix.sys.map((s, i) => ({ ...s, i })).filter(s => s.v > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i).slice(0, 5);
  const pctNum = pctNumber(v, total);
  return {
    scoped, v, total, pctNum, pctText: `${pctNum}%`, remain: Math.max(0, total - v),
    dots: own, vp, others, recent, top,
    untouched: fix.sys.filter(s => s.v === 0).length,
    title: scoped ? fix.sys[idx].label : tr('全台'),
    aspect: fix.aspect,
  };
}
const fillFrac = (v, n) => (n > 0 && v > 0 ? Math.min(1, Math.max(v / n, 0.03)) : 0);
const shortDate = d => { const m = d.split('-'); return m.length === 3 ? `${Number(m[1])}/${Number(m[2])}` : d; };
const nums = s => (s ?? '').match(/\d+/g)?.map(Number) ?? [];

/** 契約的座標公式：正規化 (u, v)（0..1 為地圖框內）→ 地圖框內座標（pt）。留出已收集點半徑當內距，框外照算不夾。 */
function mapPoint(map, u, v) {
  const inset = Math.max(DOT_RADIUS_FLOOR, map.h * DOT_RADIUS_RATIO) * SOLID_SCALE;
  return [inset + u * (map.w - 2 * inset), inset + v * (map.h - 2 * inset)];
}
/** 點在地圖框內（Canvas 座標，pt）的期望圓心。公式是契約的一部分：留出已收集點半徑當內距；全台 u＝x/1000，單一系統 u＝(x−x0)/S。 */
function expectedCenters(ex, map) {
  const r = Math.max(DOT_RADIUS_FLOOR, map.h * DOT_RADIUS_RATIO);
  const at = d => {
    const u = ex.vp ? (d[0] - ex.vp.x0) / ex.vp.S : d[0] / 1000;
    const v = ex.vp ? (d[1] - ex.vp.y0) / ex.vp.S : d[1] / 1000;
    return mapPoint(map, u, v);
  };
  const out = { other: ex.others.map(at), off: [], follow: [], solid: [] };
  for (const d of ex.dots) out[['off', 'follow', 'solid'][d[3]]].push(at(d));
  return { ...out, r, R: r * SOLID_SCALE };
}

// ── 出圖矩陣 ─────────────────────────────────────────────────────────────────────────
function buildCases(quick) {
  const cases = [];
  const add = (fam, scope, state, scheme, mono, width) => {
    const [w, h] = SIZES[width][fam];
    const tag = `${fam}${scope ? '-' + scope : ''}-${state}-${scheme}${mono ? '-tinted' : ''}-${width}`;
    cases.push({ name: tag, fam, scope, state, scheme, mono, width, w, h });
  };
  if (quick) {
    for (const st of ['sample', 'empty', 'none']) add('small', null, st, 'light', false, 430);
    for (const sc of ['tra', 'krtc']) for (const scheme of ['light', 'dark']) add('small', sc, 'sample', scheme, false, 430);
    add('medium', null, 'sample', 'light', false, 430);
    add('medium', null, 'sample', 'dark', false, 430);
    add('medium', null, 'sample', 'light', false, 393);
    for (const sc of ['tra', 'krtc']) add('medium', sc, 'sample', 'light', false, 430);
    for (const h of TALL_HEIGHTS) add('medium', 'tra', 'sample', 'light', false, `tall${h}`); // 最近蓋章放得下 3、4 筆
    add('rect', null, 'sample', 'dark', true, 430);
    add('circ', null, 'sample', 'dark', true, 430);
    // 百分比兩個邊界（<1%、99%）：小／中／鎖屏矩形／鎖屏圓形，全台與單一系統
    for (const st of ['one', 'almost']) {
      add('small', null, st, 'light', false, 430);
      add('small', 'tra', st, 'light', false, 430);
      add('medium', null, st, 'light', false, 430);
      add('rect', null, st, 'light', true, 430);
      add('circ', null, st, 'light', true, 430);
    }
    for (const [scheme, mono] of [['light', false], ['dark', false], ['light', true], ['dark', true]]) add('small', null, 'states', scheme, mono, 430);
    // 容錯（P3-7）：夾壞元素的 payload 照乾淨版畫；結構壞的整包作廢
    for (const [fam, scope] of [['small', null], ['small', 'tra'], ['medium', null], ['medium', 'tra']]) add(fam, scope, 'dirty', 'light', false, 430);
    for (const st of ['broken', 'brokenSys']) for (const fam of ['small', 'medium']) add(fam, null, st, 'light', false, 430);
    // 轉乘站（P3-12）：淡海、北捷範圍的中卡看得到紅樹林；全台中卡不畫最近蓋章
    for (const sc of ['ntdlrt', 'trtc', null]) add('medium', sc, 'transfer', 'light', false, 430);
    // 台灣輪廓（o1）：一個點都沒有的全台卡，小／中 × 淺／深
    for (const fam of ['small', 'medium']) for (const scheme of ['light', 'dark']) add(fam, null, 'bare', scheme, false, 430);
    // 標題列（P3-3）：真實簡稱最長的系統——英文 Kaohsiung（高捷，上面已有）、日文阿里山（林鐵，只有 solo 狀態有收集）；繁中十個都是兩字
    for (const fam of ['small', 'medium']) add(fam, 'afr', 'solo', 'light', false, 430);
    // 標題列（P3-3）：系統簡稱由短到長，走到「放得下兩個／只放系統名／縮字／截斷」各條路徑
    for (const n of NAME_LENGTHS) for (const fam of ['small', 'medium']) add(fam, 'tra', `name${n}`, 'light', false, 430);
    return cases;
  }
  const famList = [['small', null], ['small', 'tra'], ['medium', null], ['medium', 'tra'], ['rect', null], ['circ', null]];
  const isLock = fam => fam === 'rect' || fam === 'circ';
  for (const width of [430, 393]) {
    for (const [fam, scope] of famList) {
      for (const state of ['sample', 'empty', 'none']) {
        for (const scheme of ['light', 'dark']) add(fam, scope, state, scheme, isLock(fam), width);
      }
    }
    // 其他單一系統：北捷（緊湊、寬高比接近方）、高捷（單線且有最近蓋章）淺深色；
    // 安坑（一站都沒收）、三鶯（只收 1 站、最近蓋章 1 筆）淺色
    for (const fam of ['small', 'medium']) {
      for (const sc of ['trtc', 'krtc']) for (const scheme of ['light', 'dark']) add(fam, sc, 'sample', scheme, false, width);
      for (const sc of ['ntalrt', 'sanying']) add(fam, sc, 'sample', 'light', false, width);
      add(fam, 'afr', 'solo', 'light', false, width); // 只有 1 座站的系統（視窗下限路徑）
    }
    // 邊界：全收滿（100%）、只收 1 站（<1%）、只差 1 站（99%）
    for (const [fam, scope] of famList) {
      for (const state of ['full', 'one', 'almost']) add(fam, scope, state, 'light', isLock(fam), width);
    }
    // 台灣輪廓（o1）：一個點都沒有的全台卡
    for (const fam of ['small', 'medium']) for (const scheme of ['light', 'dark']) add(fam, null, 'bare', scheme, false, width);
    // 容錯（P3-7）：夾壞元素的 payload（全部家族）、結構壞的整包作廢（小、中）
    for (const [fam, scope] of famList) add(fam, scope, 'dirty', 'light', isLock(fam), width);
    for (const st of ['broken', 'brokenSys']) for (const fam of ['small', 'medium']) add(fam, null, st, 'light', false, width);
    for (const sc of ['ntdlrt', 'trtc', null]) add('medium', sc, 'transfer', 'light', false, width);
    // 標題列（P3-3）：系統簡稱由短到長
    for (const n of NAME_LENGTHS) for (const fam of ['small', 'medium']) add(fam, 'tra', `name${n}`, 'light', false, width);
  }
  for (const h of TALL_HEIGHTS) add('medium', 'tra', 'sample', 'light', false, `tall${h}`); // 合成的較高中卡（見 TALL_HEIGHTS）
  // 著色（tinted／accented）：桌面兩種尺寸的淺色與深色，全台與單一系統
  for (const fam of ['small', 'medium']) {
    for (const scheme of ['light', 'dark']) { add(fam, null, 'sample', scheme, true, 430); add(fam, 'tra', 'sample', scheme, true, 430); }
  }
  // 合成三態（像素判準用）：淺色、深色、著色淺色、著色深色
  for (const [scheme, mono] of [['light', false], ['dark', false], ['light', true], ['dark', true]]) add('small', null, 'states', scheme, mono, 430);
  return cases;
}

// ── Swift 算繪 harness ──────────────────────────────────────────────────────────────────
const harnessSwift = `
import AppKit
import Foundation
import SwiftUI
import WidgetKit

struct CaseSpec: Decodable {
    let name: String
    let fam: String
    let w: Double
    let h: Double
    let scheme: String
    let mono: Bool
    let dir: String
    let scope: String?
}

final class FrameBox { var frames: [CollectionFrameReport] = [] }

func makeView(_ fam: String, _ content: CollectionContent) -> AnyView {
    switch fam {
    // 蓋章鈕在 harness 只畫外觀（{ $0 }）：小卡的 Button(intent:)、中卡的 Link 都在 CollectionWidget.swift
    // （AppIntents 編不進來、ImageRenderer 畫不出 Link），由 s 閘門靜態掃。
    case "small": return AnyView(SmallCollectionView(content: content) { $0 })
    case "medium": return AnyView(MediumCollectionView(content: content) { $0 })
    case "rect": return AnyView(RectangularCollectionView(content: content))
    case "circ": return AnyView(CircularCollectionView(content: content))
    default: fatalError("unknown family \\(fam)")
    }
}

func pts(_ a: [CGPoint]) -> [[Double]] { a.map { [Double($0.x), Double($0.y)] } }

@MainActor
func pngData<V: View>(_ view: V, w: CGFloat, h: CGFloat, scheme: ColorScheme, mono: Bool) -> Data {
    let renderer = ImageRenderer(
        content: view
            .frame(width: w, height: h)
            .background(Color(white: scheme == .dark ? ${BG.dark} : ${BG.light}))
            .environment(\\.colorScheme, scheme)
            .environment(\\.railMonochrome, mono)
    )
    renderer.scale = ${SCALE}
    guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:])
    else {
        FileHandle.standardError.write(Data("算繪失敗\\n".utf8)); exit(1)
    }
    return png
}

@main
struct Harness {
    @MainActor
    static func main() {
        let args = CommandLine.arguments
        let specs = try! JSONDecoder().decode([CaseSpec].self, from: Data(contentsOf: URL(fileURLWithPath: args[1])))
        let out = args[2]
        var results: [[String: Any]] = []
        for c in specs {
            let snap = CollectionStore.load(rootURL: URL(fileURLWithPath: c.dir))
            let content = CollectionContent.make(snap, scope: c.scope)
            let scheme: ColorScheme = c.scheme == "dark" ? .dark : .light
            let w = CGFloat(c.w), h = CGFloat(c.h)

            // A：出貨路徑（三個驗收環境值全是預設）——這張才是「使用者看到的」。
            let shipped = pngData(makeView(c.fam, content), w: w, h: h, scheme: scheme, mono: c.mono)
            try! shipped.write(to: URL(fileURLWithPath: out + "/" + c.name + ".png"))

            // B：量測——每個文字／進度條回報自己的範圍，Canvas 每畫一個點記下圓心。
            let box = FrameBox()
            let probe = CollectionDrawProbe()
            _ = pngData(makeView(c.fam, content)
                            .environment(\\.collectMeasure, true)
                            .environment(\\.collectProbe, probe)
                            .onPreferenceChange(CollectionFramesKey.self) { box.frames = $0 },
                        w: w, h: h, scheme: scheme, mono: c.mono)

            // C：地圖藏起來只佔位——算出來的墨跡就只剩文字（與其他非地圖元素）。
            let hiddenPng = pngData(makeView(c.fam, content).environment(\\.collectMapHidden, true),
                                    w: w, h: h, scheme: scheme, mono: c.mono)
            try! hiddenPng.write(to: URL(fileURLWithPath: out + "/" + c.name + ".hidden.png"))

            // D：只關掉台灣輪廓、點照畫——與 A 逐像素比，就知道輪廓實際落墨在哪；量點的位置也用這張。
            let noOutline = pngData(makeView(c.fam, content).environment(\\.collectOutlineHidden, true),
                                    w: w, h: h, scheme: scheme, mono: c.mono)
            try! noOutline.write(to: URL(fileURLWithPath: out + "/" + c.name + ".nooutline.png"))

            results.append([
                "name": c.name,
                "probe": ["other": pts(probe.other), "off": pts(probe.off),
                          "follow": pts(probe.follow), "solid": pts(probe.solid)],
                "frames": box.frames.map { f -> [String: Any] in
                    ["id": f.id, "text": f.text.map { $0 as Any } ?? NSNull(), "key": f.key,
                     "x": f.x, "y": f.y, "w": f.w, "h": f.h]
                },
            ])
        }
        let data = try! JSONSerialization.data(withJSONObject: results, options: [.prettyPrinted])
        try! data.write(to: URL(fileURLWithPath: out + "/results.json"))
        print("算繪 \\(specs.count) 個案例")
    }
}
`;

function runHarness({ src, out, quick, l10nJson = L10N_JSON }) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'shots'), { recursive: true });
  mkdirSync(join(out, 'fix'), { recursive: true });
  const cases = buildCases(quick);
  // 每個 fixture 一個目錄，裡面放 collection.json；none＝空目錄（走真實的「沒檔案」路徑）。
  for (const [name, payload] of Object.entries(FIXTURES)) {
    const dir = join(out, 'fix', name);
    mkdirSync(dir, { recursive: true });
    if (payload) writeFileSync(join(dir, 'collection.json'), JSON.stringify(payload));
  }
  const specs = cases.map(c => ({ ...c, dir: join(out, 'fix', c.state) }));
  writeFileSync(join(out, 'cases.json'), JSON.stringify(specs));
  const harnessPath = join(out, 'harness.swift');
  writeFileSync(harnessPath, harnessSwift);
  const bin = join(out, 'harness');
  execFileSync('swiftc', ['-O', '-parse-as-library', harnessPath,
    join(src, 'CollectionCard.swift'), join(src, 'CollectionOutlineData.swift'),
    join(src, 'RailWidgetKit.swift'), join(src, 'RailNativeL10n.swift'),
    '-o', bin], { stdio: 'inherit' });
  execFileSync(bin, [join(out, 'cases.json'), join(out, 'shots')], {
    stdio: 'inherit',
    env: LANG ? { ...process.env, RAIL_L10N_LANG: LANG, RAIL_L10N_JSON: l10nJson } : process.env,
  });
  const results = JSON.parse(readFileSync(join(out, 'shots/results.json'), 'utf8'));
  return { cases: specs, results };
}

// ── 像素工具 ─────────────────────────────────────────────────────────────────────────
async function loadPixels(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
}
const px = (img, x, y) => {
  const i = (Math.min(img.h - 1, Math.max(0, y)) * img.w + Math.min(img.w - 1, Math.max(0, x))) * img.ch;
  return [img.data[i] / 255, img.data[i + 1] / 255, img.data[i + 2] / 255];
};
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
/** 圓盤（半徑 rad px）內有沒有任何像素離底色 ≥ 0.1（有墨跡）。cx、cy 是浮點 px 座標。 */
function inkWithin(img, cx, cy, rad, bg) {
  for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y += 1) {
    for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x += 1) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= rad * rad && dist(px(img, x, y), bg) >= 0.1) return true;
    }
  }
  return false;
}
/**
 * 期望線色（r 閘門）：淺色＝原色；深色＝各通道 ×1.25 夾到 1（CollectionPalette.color 的契約）；
 * 著色＝primary（淺黑深白）。harness 跑在 macOS，`Color.primary` 是 labelColor＝alpha 0.85 的黑／白，
 * 疊在底色上：淺色 0.85×0＋0.15×0.98＝0.147、深色 0.85×1＋0.15×0.09＝0.864（iOS 上是不透明黑／白，
 * 那邊的著色由系統統一上色，不歸這道閘門管）。
 */
function lineColor(hex, scheme, mono) {
  if (mono) { const v = scheme === 'dark' ? 0.85 + 0.15 * BG.dark : 0.15 * BG.light; return [v, v, v]; }
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(c => Math.min(1, (c / 255) * (scheme === 'dark' ? 1.25 : 1)));
}
/** 兩組圓心（pt）做最近鄰配對，回最大距離；筆數不同回 Infinity。 */
function matchMaxDist(got, want) {
  if (got.length !== want.length) return Infinity;
  const used = new Array(got.length).fill(false);
  let worst = 0;
  for (const w of want) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < got.length; i += 1) {
      if (used[i]) continue;
      const d = Math.hypot(got[i][0] - w[0], got[i][1] - w[1]);
      if (d < bd) { bd = d; best = i; }
    }
    used[best] = true;
    worst = Math.max(worst, bd);
  }
  return worst;
}

/** 兩張同尺寸圖在像素矩形 [x0,x1)×[y0,y1)（px）內「不同」的像素數：三通道差的總和 > 6/255 才算不同（濾掉量化雜訊）。 */
function diffCount(a, b, x0, y0, x1, y1) {
  if (a.w !== b.w || a.h !== b.h) throw new Error('diffCount：兩張圖尺寸不同');
  let count = 0;
  for (let y = Math.max(0, y0); y < Math.min(a.h, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(a.w, x1); x += 1) {
      const i = (y * a.w + x) * a.ch;
      if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 6) count += 1;
    }
  }
  return count;
}
/** WCAG 相對亮度與對比（灰階 sRGB 值 0..1）。 */
const lumOf = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const contrastOf = (a, b) => { const [hi, lo] = [lumOf(a), lumOf(b)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
const grayOf = p => (p[0] + p[1] + p[2]) / 3;
/** 卡片座標（pt）處的像素。 */
const cardPx = (img, [x, y]) => px(img, Math.round(x * SCALE), Math.round(y * SCALE));
/** 經緯度 → 卡片座標（pt）：契約的投影框＋契約的地圖框座標公式（全台範圍）；地圖框外照算。 */
function lonLatToCard(map, lon, lat) {
  const [X, Y] = lonLatToXY(lon, lat);
  const [x, y] = mapPoint(map, X / 1000, Y / 1000);
  return [map.x + x, map.y + y];
}
/** 取樣點離所有已畫出的點的圓心都 ≥ 已收集點半徑＋gap（pt）才算乾淨：點會蓋在輪廓上面，取樣點不能落在點上。 */
function isClear(exp, map, [x, y], gap) {
  return [...exp.other, ...exp.off, ...exp.follow, ...exp.solid].every(([cx, cy]) => Math.hypot(map.x + cx - x, map.y + cy - y) >= exp.R + gap);
}
/** 從 target 往外一圈一圈（1pt 一格，最多 8 格）找第一個乾淨的取樣點；找不到回 null。 */
function clearNear(exp, map, target, gap) {
  for (let r = 0; r <= 8; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const p = [target[0] + dx, target[1] + dy];
      if (isClear(exp, map, p, gap)) return p;
    }
  }
  return null;
}

// ── 靜態掃描（u 閘門）──────────────────────────────────────────────────────────────
// 去掉 Swift 的行註解與區塊註解（不處理字串裡的雙斜線——這幾支檔的字串沒有）。
const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/[^\n"]*$/gm, '');
/** 從 open（含 '{'）位置起配對大括號，回結束位置。 */
function matchBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}
/** src 目錄有就用（突變測試的複本、--src），沒有就退回 repo 內的真檔。 */
function srcFile(src, name) {
  const inSrc = join(src, name);
  if (existsSync(inSrc)) return readFileSync(inSrc, 'utf8');
  for (const dir of [realSrc, appSrc]) if (existsSync(join(dir, name))) return readFileSync(join(dir, name), 'utf8');
  throw new Error(`找不到 ${name}`);
}
function staticGate(src, check) {
  const widget = stripComments(srcFile(src, 'CollectionWidget.swift'));
  const card = stripComments(srcFile(src, 'CollectionCard.swift'));
  const plugin = stripComments(srcFile(src, 'RailMetroWaitPlugin.swift'));
  const URL_CALL = '.widgetURL(URL(string: "railisland://passport"))';
  const calls = widget.split('.widgetURL(').length - 1;
  check('u', 'CollectionWidget.swift', calls === 1 && widget.includes(URL_CALL),
    `CollectionWidget.swift 的 .widgetURL( 出現 ${calls} 次（要恰好 1 次，且是 ${URL_CALL}）`);
  // 掛在 EntryView 的最外層：在 body 裡、且位於家族 switch 的大括號【之外】（掛在某個 case 裡只會有那一種尺寸點得開）
  const body = widget.indexOf('struct CollectionEntryView');
  const sw = widget.indexOf('switch family {', body);
  const swEnd = sw >= 0 ? matchBrace(widget, sw + 'switch family '.length) : -1;
  const at = widget.indexOf('.widgetURL(');
  check('u', 'CollectionWidget.swift', body >= 0 && sw >= 0 && swEnd > sw && at > swEnd && at < widget.indexOf('struct CollectionWidget:'),
    `.widgetURL 的位置不在 CollectionEntryView 的家族 switch 之外（位置 ${at}，switch ${sw}–${swEnd}）——鎖屏或某個尺寸點了不會開護照`);
  const fam = widget.match(/\.supportedFamilies\(\[([^\]]*)\]\)/)?.[1] ?? '';
  const list = fam.split(',').map(s => s.trim()).filter(Boolean);
  check('u', 'CollectionWidget.swift', JSON.stringify(list) === JSON.stringify(['.systemSmall', '.systemMedium', '.accessoryRectangular', '.accessoryCircular']),
    `supportedFamilies＝${JSON.stringify(list)}，應只有 小、中、鎖屏矩形、鎖屏圓形（使用者不要大卡）`);
  check('u', 'CollectionCard.swift', !/systemLarge|LargeCollectionView/.test(widget + card), 'Collection*.swift 裡還有 systemLarge／LargeCollectionView');
  // plugin：handleOpen 接受 host passport，forwardOpen 對 passport 帶 view:"passport"
  const guardLine = plugin.match(/guard url\.scheme == "railisland",[\s\S]*?else \{ return false \}/)?.[0] ?? '';
  check('u', 'RailMetroWaitPlugin.swift', /url\.host == "passport"/.test(guardLine), 'handleOpen 沒有接受 host passport');
  check('u', 'RailMetroWaitPlugin.swift', /comps\.host == "passport"\s*\{\s*data\["view"\]\s*=\s*"passport"\s*\}/.test(plugin),
    'forwardOpen 沒有對 passport 帶 view:"passport"');

  // s（靜態部分）：鈕的接線。小卡 Button(intent:)、中卡 Link 都在 CollectionWidget.swift（harness 編不進 AppIntents、畫不出 Link）
  const intent = stripComments(srcFile(src, 'CollectCheckinIntent.swift'));
  const count = (t, needle) => t.split(needle).length - 1;
  const smallAt = widget.indexOf('SmallCollectionView(content: entry.content)'), medAt = widget.indexOf('MediumCollectionView(content: entry.content)');
  const btnAt = widget.indexOf('Button(intent: CollectCheckinIntent())'), linkAt = widget.indexOf('Link(destination: CollectionStamp.checkinURL)');
  check('s', 'CollectionWidget.swift', count(widget, 'Button(intent:') === 1 && btnAt > smallAt && smallAt >= 0 && (medAt < 0 || btnAt < medAt || smallAt > medAt),
    '小卡的蓋章鈕不是恰好一個 Button(intent: CollectCheckinIntent())，或不在 SmallCollectionView 的包裝裡（小卡要用互動按鈕）');
  check('s', 'CollectionWidget.swift', count(widget, 'Link(') === 1 && linkAt > medAt && medAt >= 0,
    '中卡的蓋章鈕不是恰好一個 Link(destination: CollectionStamp.checkinURL)，或不在 MediumCollectionView 的包裝裡');
  check('s', 'CollectionCard.swift', /static let checkinURL = URL\(string: "railisland:\/\/checkin"\)!/.test(card),
    'CollectionStamp.checkinURL 不是 railisland://checkin（中卡的蓋章鈕會開錯地方）');
  check('s', 'CollectCheckinIntent.swift', /struct CollectCheckinIntent: AppIntent/.test(intent) && /static let openAppWhenRun = true/.test(intent),
    'CollectCheckinIntent 不是 AppIntent 或沒有 openAppWhenRun＝true（按了不會把 App 帶到前景）');
  const maxAge = Number(intent.match(/maxAgeSec: Double = (\d+)/)?.[1] ?? NaN);
  check('s', 'CollectCheckinIntent.swift', maxAge > 0 && maxAge <= 120, `蓋章待辦的保鮮期是 ${maxAge} 秒（要 ≤120）`);
  const takeBody = intent.slice(intent.indexOf('static func take('));
  check('s', 'CollectCheckinIntent.swift', takeBody.indexOf('removeObject(forKey: key)') > 0 && takeBody.indexOf('removeObject(forKey: key)') < takeBody.indexOf('let age'),
    'take() 沒有先清待辦再判斷年紀（要讀一次就清，過期的也要清）');
  check('s', 'RailMetroWaitPlugin.swift', /url\.host == "checkin"/.test(guardLine), 'handleOpen 沒有接受 host checkin');
  check('s', 'RailMetroWaitPlugin.swift', /comps\.host == "checkin"\s*\{\s*data\["view"\]\s*=\s*"checkin"\s*\}/.test(plugin), 'forwardOpen 沒有對 checkin 帶 view:"checkin"');
  const flush = plugin.slice(plugin.indexOf('static func flushPendingOpen'), plugin.indexOf('private func forwardOpen'));
  check('s', 'RailMetroWaitPlugin.swift', /CollectCheckinPending\.take\(\)/.test(flush) && /"view": "checkin"/.test(flush) && /CollectCheckinPending\.didWrite/.test(plugin),
    'flushPendingOpen 沒有把蓋章待辦轉成 waitOpen { view: "checkin" }，或沒有註冊 didWrite 通知');

  // t（靜態部分）：可點範圍要真的掛在 Button／Link 的 label 上。harness 量的是鈕自己回報的 stamp.hit 框，
  // 系統實際的點擊範圍卻是 Button／Link 的 label 框——label 若不是鈕本身（例如另包一層），兩者就脫鉤，動態量到的是假的。
  check('t', 'CollectionWidget.swift', /Button\(intent: CollectCheckinIntent\(\)\) \{ chip \}/.test(widget) && /Link\(destination: CollectionStamp\.checkinURL\) \{ chip \}/.test(widget),
    'Button／Link 的 label 不是鈕本身（{ chip }）——可點範圍不是鈕帶的那一圈，harness 量到的框與實際點擊範圍脫鉤');
  const chipAt = card.indexOf('struct CollectionStampChip: View');
  const chipBody = chipAt >= 0 ? card.slice(chipAt, matchBrace(card, card.indexOf('{', chipAt)) + 1) : '';
  check('t', 'CollectionCard.swift', /\.padding\(hit\)\s*\.contentShape\(Rectangle\(\)\)/.test(chipBody),
    'CollectionStampChip 沒有依序套 .padding(hit) 與 .contentShape(Rectangle())——外擴的內距不算進可點範圍');
  const comp = count(card, 'stamp(chip).padding(chip.hitCompensation)');
  check('t', 'CollectionCard.swift', comp === 2, `小卡與中卡各要套一次 .padding(chip.hitCompensation)（負內距抵銷，鈕的版面位置不變），實際 ${comp} 次`);

  // o2／o5（靜態部分）：輪廓層只是墊圖——不吃點擊；不加 widgetAccentable（著色模式下它不該被染成強調色）
  const outAt = card.indexOf('struct CollectionOutlineLayer: View');
  const outBody = outAt >= 0 ? card.slice(outAt, matchBrace(card, card.indexOf('{', outAt)) + 1) : '';
  check('o2', 'CollectionCard.swift', outBody.length > 0 && /\.allowsHitTesting\(false\)/.test(outBody),
    'CollectionOutlineLayer 沒有 .allowsHitTesting(false)——輪廓（全台的畫布比地圖框大一圈）會吃掉蓋章鈕與整張卡的點擊');
  const useAt = card.indexOf('CollectionOutlineLayer(viewport:');
  const useTail = useAt >= 0 ? card.slice(useAt, card.indexOf('Canvas {', useAt)) : '';
  check('o5', 'CollectionCard.swift', outBody.length > 0 && useAt >= 0 && !/widgetAccentable/.test(outBody) && !/widgetAccentable/.test(useTail),
    'CollectionOutlineLayer（或它在 CollectionMapView 的使用處）帶了 widgetAccentable——著色模式下輪廓會被染成強調色，不再是淡淡的墊圖');
}

/** s（動態部分）：待辦的行為——寫一次只能讀一次、119 秒內有效、121 秒過期、過期的也要清掉。只靠靜態掃描量不到。 */
function pendingGate(src, out, check) {
  const dir = join(out, 'pending-test');
  mkdirSync(dir, { recursive: true });
  const swift = join(dir, 'main.swift');
  // suite 名字帶 pid：每次 run 專屬，兩個算圖腳本並行也不會互踩彼此的待辦（以前共用同一個名字，並行會假紅）。
  const suite = `i2.collect.checkin.test.${process.pid}`;
  writeFileSync(swift, `import Foundation
// 只替身這個檔唯一的外部依賴：App Group 的 suite（真的那個要 entitlement）。
enum MetroWaitPending { static var suite: UserDefaults? = UserDefaults(suiteName: "${suite}") }
@main struct T {
    static func main() {
        MetroWaitPending.suite?.removePersistentDomain(forName: "${suite}")
        let t0 = Date(timeIntervalSince1970: 1_000_000)
        var r: [String: Bool] = [:]
        r["never"] = CollectCheckinPending.take(now: t0)
        CollectCheckinPending.write(now: t0); r["fresh"] = CollectCheckinPending.take(now: t0.addingTimeInterval(119))
        r["again"] = CollectCheckinPending.take(now: t0.addingTimeInterval(119))
        CollectCheckinPending.write(now: t0); r["expired"] = CollectCheckinPending.take(now: t0.addingTimeInterval(121))
        r["afterExpired"] = CollectCheckinPending.take(now: t0.addingTimeInterval(1))
        CollectCheckinPending.write(now: t0); r["clockBack"] = CollectCheckinPending.take(now: t0.addingTimeInterval(-5))
        MetroWaitPending.suite?.removePersistentDomain(forName: "${suite}")
        print(String(data: try! JSONSerialization.data(withJSONObject: r), encoding: .utf8)!)
    }
}
`);
  const bin = join(dir, 'pending');
  execFileSync('swiftc', ['-parse-as-library', swift, join(existsSync(join(src, 'CollectCheckinIntent.swift')) ? src : appSrc, 'CollectCheckinIntent.swift'), '-o', bin], { stdio: 'inherit' });
  const r = JSON.parse(execFileSync(bin, { encoding: 'utf8' }));
  rmSync(join(homedir(), 'Library/Preferences', `${suite}.plist`), { force: true });
  const want = { never: false, fresh: true, again: false, expired: false, afterExpired: false, clockBack: false };
  for (const [k, v] of Object.entries(want)) check('s', 'pending.' + k, r[k] === v, `蓋章待辦 ${k}：實際 ${r[k]}，期望 ${v}`);
}

// ── 閘門 ────────────────────────────────────────────────────────────────────────────
const GATES = ['a1', 'a2', 'b1', 'b2', 'b3', 'c', 'c2', 'd', 'e', 'h', 'hd', 'v', 'r', 'u', 's', 'o1', 'o2', 'o3', 'o4', 'o5', 't'];
/** 蓋章鈕上的字：繁中是 key 本身；en／ja 取生成的目錄 JSON（與 --lang 壓力測試餵給 RailNativeL10n 的同一份）。 */
const L10N_JSON = join(repo, 'app/android/app/src/main/assets/RailNativeL10n.json');
/** 該語言的目錄表（key＝繁中原文）；繁中沒有表（key 就是字串）。突變測試會換成改壞的表。 */
let L10N_TABLE = LANG ? JSON.parse(readFileSync(L10N_JSON, 'utf8')).languages[LANG] ?? {} : null;
const L10N_KEYS_USED = new Set();
const placeholders = s => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]))].sort();
/**
 * c 閘門的字串期望值：繁中＝key 本身；en／ja＝目錄譯文，再代入佔位符。
 * 目錄缺 key 不退回繁中（Swift 端會默默退回，期望值不可以跟著退）——回傳一個不可能相等的標記，並由 judge 另記一條紅。
 */
function tr(key, vars = {}) {
  L10N_KEYS_USED.add(key);
  let text = key;
  if (LANG) {
    const t = L10N_TABLE[key];
    if (typeof t !== 'string') return `⟪目錄缺「${key}」⟫`;
    text = t;
  }
  for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value));
  return text;
}
const STAMP_LABEL = tr('蓋章');
const APP_NAME = tr('車站收集');

/**
 * hd：標題列的省略順序（契約畫法約定 8，小卡與中卡）。期望全部從量到的框與 payload 推，不讀實作常數，也不因語言開特例：
 *  (1) 「兩個名稱放得下」＝ header#ideal（Swift 量測用的隱形標題列：兩個名稱並排的理想寬，版面與第一個候選是同一個函式，
 *      不論最後畫了哪個都回報）≤ 可用寬。可用寬：小卡＝卡寬 − 2 × 內距（取自 spec）；中卡＝百分比右緣 − 標題列左緣（量到的框）。
 *      放得下 ⟺ 兩個都在；放不下只剩一個，且剩下的是契約指定的那個：全台＝「車站收集」、單一系統＝系統名。
 *      中卡全台的標題本來就只有「車站收集」，不必判取捨。邊界（差不到 0.4pt，版面寬度量化在 1/3pt）兩種都收，不下斷言。
 *  (2) 只剩一個：靠左、不出可用寬；理想寬放得下就不准縮；放不下才縮，縮字不低於 75% 再截斷——縮了多少用行高量
 *      （Text 縮字時行高跟著縮，且是整數 pt，所以下限留 0.6pt 容差）。全台留下的「車站收集」要是標題字級：
 *      理想行高與範圍名（header.scope#ideal）的一樣。
 *  (3) 兩個都在：範圍名靠左，兩者之間至少隔著版面自己要的最小間距（header#ideal 減兩個零件的理想寬）。
 * 回傳這個案例走到哪個區間（覆蓋率斷言用）；量不到或邊界回傳 null。
 */
function headerGate({ spec, frames, byId, ex, check, fail }) {
  const n = spec.name, small = spec.fam === 'small';
  const one = id => frames.find(f => f.id === id);
  const f1 = v => v.toFixed(1), TOL = 0.4;
  const both = one('header#ideal');
  if (!both) { fail('hd', n, '缺 header#ideal（量測用的標題列理想寬）'); return null; }
  const titles = byId('title'), subs = byId('subtitle'), pctF = byId('pct')[0];
  const rowLeft = both.x;
  if (!small && !pctF) { fail('hd', n, '中卡缺 pct 框，量不到標題列的可用寬'); return null; }
  const rowW = small ? spec.w - 2 * INSET : pctF.x + pctF.w - rowLeft;
  if (small) check('hd', n, Math.abs(rowLeft - INSET) <= 0.6, `標題列左緣 ${f1(rowLeft)} ≠ 內距 ${INSET}`);
  const scopeP = one(small ? 'header.scope#ideal' : 'header.title#ideal'), otherP = one(small ? 'header.app#ideal' : 'header.pct#ideal');
  if (!scopeP || !otherP) { fail('hd', n, '缺標題列零件的理想寬（header.*#ideal）'); return null; }
  const gapMin = both.w - scopeP.w - otherP.w; // 版面自己要的最小間距（小卡＝名稱之間；中卡＝標題與百分比之間）
  check('hd', n, gapMin > 0, `兩個零件之間沒有最小間距（header#ideal ${f1(both.w)} − ${f1(scopeP.w)} − ${f1(otherP.w)} = ${f1(gapMin)}）`);
  const scopeName = ex.title;
  const fitsClear = both.w <= rowW - TOL, wideClear = both.w > rowW + TOL;
  const why = `兩個名稱並排要 ${f1(both.w)}pt，可用 ${f1(rowW)}pt`;

  // 只剩一個名稱時的檢查。avail＝這個名稱可用的寬；回傳區間。
  const soleChecks = (surv, survId, wantText, avail, partW = null) => {
    const ideal = one(`${survId}#ideal`);
    if (!ideal) { fail('hd', n, `缺 ${survId}#ideal（不受限時的理想寬）`); return null; }
    // 量測用 overlay 與真正畫出來的是同一段字、同一個字級：兩邊各自量到的理想寬要一樣（overlay 做歪了這裡會紅）
    if (partW !== null) check('hd', n, Math.abs(ideal.w - partW) <= 0.6, `${survId} 自己回報的理想寬 ${f1(ideal.w)} ≠ 量測用標題列裡同一段字的理想寬 ${f1(partW)}`);
    check('hd', n, surv.text === wantText, `${survId} 文字「${surv.text}」≠ 期望「${wantText}」（${why}）`);
    check('hd', n, Math.abs(surv.x - rowLeft) <= 0.6, `只剩的名稱 ${survId} 沒有靠左：x ${f1(surv.x)}，標題列左緣 ${f1(rowLeft)}`);
    check('hd', n, surv.x + surv.w <= rowLeft + avail + 0.6, `${survId} 超出可用寬：右緣 ${f1(surv.x + surv.w)} > ${f1(rowLeft + avail)}`);
    if (ideal.w <= avail - TOL) {
      check('hd', n, Math.abs(surv.w - ideal.w) <= 0.6 && Math.abs(surv.h - ideal.h) <= 0.6,
        `${survId} 理想寬 ${f1(ideal.w)} 放得進可用 ${f1(avail)}，卻被縮了：實際 ${f1(surv.w)}×${f1(surv.h)}，理想 ${f1(ideal.w)}×${f1(ideal.h)}`);
      return 'fits';
    }
    if (ideal.w <= avail + TOL) return null;
    const need = avail / ideal.w; // 剛好放進去要縮到的比例
    // 縮字的下限：要縮到 75% 以下才放得進去的（need < 0.75），實作該停在 75% 截斷，這時行高恰是 75% 那一檔；
    // 下限若是 70%，行高會少一檔（中卡 14pt：13 → 12）。行高是整數 pt，容差 0.5。
    check('hd', n, surv.h >= 0.75 * ideal.h - 0.5,
      `${survId} 縮過頭：行高 ${f1(surv.h)}pt 是理想 ${f1(ideal.h)}pt 的 ${(100 * surv.h / ideal.h).toFixed(0)}%，低於 75%（放進去要縮到 ${(100 * need).toFixed(0)}%）`);
    if (need >= 0.75 && need <= 0.92) {
      check('hd', n, surv.h <= ideal.h - 0.4, `${survId} 該先縮字卻沒縮：放進去要縮到 ${(100 * need).toFixed(0)}%，行高仍是理想的 ${f1(ideal.h)}pt`);
    }
    return need >= 0.75 ? 'shrunk' : 'cut';
  };

  if (small) {
    const t = titles[0], s = subs[0];
    if (fitsClear) {
      check('hd', n, titles.length === 1 && subs.length === 1, `放得下卻不是兩個都在（${why}）：title ${titles.length} 個、subtitle ${subs.length} 個`);
      if (t && s) {
        check('hd', n, t.text === scopeName && s.text === APP_NAME, `兩個名稱的文字「${t.text}」「${s.text}」≠ 期望「${scopeName}」「${APP_NAME}」`);
        check('hd', n, Math.abs(t.x - rowLeft) <= 0.6, `範圍名沒有靠左：x ${f1(t.x)}，標題列左緣 ${f1(rowLeft)}`);
        check('hd', n, Math.abs(t.w - scopeP.w) <= 0.6 && Math.abs(s.w - otherP.w) <= 0.6,
          `兩個名稱的實際寬 ${f1(t.w)}／${f1(s.w)} ≠ 量測用標題列裡的理想寬 ${f1(scopeP.w)}／${f1(otherP.w)}（放得下就不縮；量測用 overlay 也要與真正畫的一致）`);
        check('hd', n, s.x - (t.x + t.w) >= gapMin - 0.6, `兩個名稱間距 ${f1(s.x - (t.x + t.w))}pt 小於版面自己要的最小間距 ${f1(gapMin)}pt`);
        check('hd', n, Math.abs(s.x + s.w - (rowLeft + rowW)) <= 0.6, `「車站收集」沒有靠右：右緣 ${f1(s.x + s.w)}，可用右緣 ${f1(rowLeft + rowW)}`);
      }
      return 'both';
    }
    if (wideClear) {
      const survId = ex.scoped ? 'title' : 'subtitle', otherId = ex.scoped ? 'subtitle' : 'title';
      check('hd', n, byId(survId).length === 1 && byId(otherId).length === 0,
        `放不下（${why}）時該只剩${ex.scoped ? '系統名（title）' : '「車站收集」（subtitle）'}：title ${titles.length} 個、subtitle ${subs.length} 個`);
      const surv = byId(survId)[0];
      if (!surv) return null;
      const regime = soleChecks(surv, survId, ex.scoped ? scopeName : APP_NAME, rowW, ex.scoped ? scopeP.w : null);
      if (!ex.scoped) {
        const ideal = one('subtitle#ideal');
        if (ideal) check('hd', n, Math.abs(ideal.h - scopeP.h) <= 0.7,
          `全台只剩的「車站收集」不是標題字級：理想行高 ${f1(ideal.h)}pt，範圍名的標題字級行高 ${f1(scopeP.h)}pt`);
      }
      return regime;
    }
    // 邊界：只要求剩下的是契約指定的那個
    if (titles.length + subs.length === 1) check('hd', n, byId(ex.scoped ? 'title' : 'subtitle').length === 1, `邊界（${why}）只剩一個名稱，卻不是契約指定的那個`);
    return null;
  }

  // 中卡：標題只有一個 title（整段或只剩一個名稱），沒有 subtitle
  check('hd', n, titles.length === 1 && subs.length === 0, `中卡標題列該恰有一個 title：title ${titles.length} 個、subtitle ${subs.length} 個`);
  const t = titles[0];
  if (!t) return null;
  const avail = rowW - pctF.w - gapMin; // 標題可用寬：扣掉百分比與版面要的最小間距
  if (!ex.scoped) return soleChecks(t, 'title', APP_NAME, avail);
  if (fitsClear) {
    const ideal = one('title#ideal');
    check('hd', n, t.text.startsWith(scopeName) && t.text.endsWith(APP_NAME) && t.text.length > scopeName.length + APP_NAME.length,
      `放得下（${why}）卻不是整段標題：「${t.text}」（期望「${scopeName}…${APP_NAME}」）`);
    check('hd', n, Math.abs(t.x - rowLeft) <= 0.6, `標題沒有靠左：x ${f1(t.x)}，標題列左緣 ${f1(rowLeft)}`);
    if (ideal) check('hd', n, Math.abs(t.w - ideal.w) <= 0.6 && Math.abs(t.h - ideal.h) <= 0.6, `整段標題被縮了：實際 ${f1(t.w)}×${f1(t.h)}，理想 ${f1(ideal.w)}×${f1(ideal.h)}`);
    check('hd', n, Math.abs(t.w - scopeP.w) <= 0.6, `整段標題的實際寬 ${f1(t.w)} ≠ 量測用標題列裡的理想寬 ${f1(scopeP.w)}`);
    check('hd', n, pctF.x - (t.x + t.w) >= gapMin - 0.6, `標題與百分比間距 ${f1(pctF.x - (t.x + t.w))}pt 小於版面自己要的最小間距 ${f1(gapMin)}pt`);
    return 'both';
  }
  if (wideClear) return soleChecks(t, 'title', scopeName, avail);
  check('hd', n, t.text === scopeName || (t.text.startsWith(scopeName) && t.text.endsWith(APP_NAME)), `邊界（${why}）標題「${t.text}」既不是整段也不是只剩系統名`);
  return null;
}

async function judge({ specs, results, out, src }) {
  const fails = [];
  const counts = Object.fromEntries(GATES.map(g => [g, { pass: 0, fail: 0 }]));
  const fail = (gate, name, detail) => { counts[gate].fail += 1; fails.push({ gate, name, detail }); };
  const ok = gate => { counts[gate].pass += 1; };
  const check = (gate, name, cond, detail) => (cond ? ok(gate) : fail(gate, name, detail));
  const headerSeen = []; // hd 閘門每個案例走到的區間（覆蓋率斷言用）

  for (const spec of specs) {
    const res = results.find(r => r.name === spec.name);
    const fix = UNAVAILABLE.has(spec.state) ? null : (EXPECT_FROM[spec.state] ?? FIXTURES[spec.state]);
    const frames = res.frames;
    const texts = frames.filter(f => !f.id.endsWith('#ideal') && f.text !== null);
    const byId = id => texts.filter(f => f.id === id);
    const map = frames.find(f => f.id === 'map');
    const lock = spec.fam === 'rect' || spec.fam === 'circ';
    const inset = lock ? 0 : INSET;
    const ex = fix ? expected(fix, spec.scope) : null;
    const n = spec.name;

    // ── e：文字不超出內容框 ──
    for (const t of texts) {
      const inside = t.x >= inset - 0.6 && t.y >= inset - 0.6
        && t.x + t.w <= spec.w - inset + 0.6 && t.y + t.h <= spec.h - inset + 0.6;
      check('e', n, inside, `${t.id}「${t.text}」超出內容框：x ${t.x.toFixed(1)}–${(t.x + t.w).toFixed(1)}、y ${t.y.toFixed(1)}–${(t.y + t.h).toFixed(1)}（卡 ${spec.w}×${spec.h}，內距 ${inset}）`);
    }

    // ── h：文字與文字不互疊（溢出的關鍵數字會壓到隔壁那一列）──
    for (let i = 0; i < texts.length; i += 1) for (let j = i + 1; j < texts.length; j += 1) {
      const a = texts[i], b = texts[j];
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      check('h', n, !(ix > 0.5 && iy > 0.5), `${a.id}「${a.text}」與 ${b.id}「${b.text}」互疊 ${ix.toFixed(1)}×${iy.toFixed(1)}pt`);
    }

    // ── d：關鍵數字沒有被縮放或截成「…」 ──
    for (const t of texts.filter(f => f.key)) {
      const ideal = frames.find(f => f.id === t.id + '#ideal');
      if (!ideal) continue;
      check('d', n, t.w >= ideal.w - 0.5, `${t.id}「${t.text}」實際寬 ${t.w.toFixed(1)} < 理想寬 ${ideal.w.toFixed(1)}（被縮或被截）`);
    }

    // ── hd：標題列的省略順序（契約畫法約定 8）──
    if ((spec.fam === 'small' || spec.fam === 'medium') && !UNAVAILABLE.has(spec.state)) {
      const regime = headerGate({ spec, frames, byId, ex, check, fail });
      if (regime) headerSeen.push({ fam: spec.fam, scoped: ex.scoped, regime, name: n });
    }

    // ── s：蓋章鈕（小卡、中卡；鎖屏兩款不放）：有字、在框內、看得見、不壓到任何文字／進度條／地圖 ──
    if (spec.fam === 'small' || spec.fam === 'medium') {
      const chip = frames.find(f => f.id === 'stamp.chip'), label = byId('stamp')[0];
      if (UNAVAILABLE.has(spec.state)) check('s', n, !chip && !label, '沒有 collection.json 的提示卡不該有蓋章鈕');
      else if (!chip || !label) fail('s', n, `缺蓋章鈕（stamp.chip＝${!!chip}、stamp＝${!!label}）`);
      else {
        check('s', n, label.text === STAMP_LABEL, `鈕上的字「${label.text}」≠ 期望「${STAMP_LABEL}」`);
        check('s', n, chip.x >= inset - 0.6 && chip.y >= inset - 0.6 && chip.x + chip.w <= spec.w - inset + 0.6 && chip.y + chip.h <= spec.h - inset + 0.6,
          `蓋章鈕超出內容框：x ${chip.x.toFixed(1)}–${(chip.x + chip.w).toFixed(1)}、y ${chip.y.toFixed(1)}–${(chip.y + chip.h).toFixed(1)}`);
        for (const o of frames.filter(f => !f.id.endsWith('#ideal') && !f.id.endsWith('.fill') && !['stamp', 'stamp.chip', 'stamp.hit'].includes(f.id))) {
          const ix = Math.min(chip.x + chip.w, o.x + o.w) - Math.max(chip.x, o.x), iy = Math.min(chip.y + chip.h, o.y + o.h) - Math.max(chip.y, o.y);
          check('s', n, !(ix > 0.05 && iy > 0.05), `蓋章鈕與 ${o.id}${o.text ? `「${o.text}」` : ''} 相交 ${ix.toFixed(1)}×${iy.toFixed(1)}pt`);
        }
        // 看得見：膠囊底色與卡底有差，字形與膠囊底色有對比（量實際出貨的 PNG）
        const img = await loadPixels(join(out, 'shots', `${n}.png`)), bg = px(img, 1, 1);
        const fill = px(img, Math.round((chip.x + 4) * SCALE), Math.round((chip.y + chip.h / 2) * SCALE));
        check('s', n, dist(fill, bg) > 0.05, `蓋章鈕的膠囊底色與卡底幾乎相同（差 ${dist(fill, bg).toFixed(3)}）——鈕看不見`);
        let glyph = 0;
        for (let y = Math.floor(label.y * SCALE); y < Math.ceil((label.y + label.h) * SCALE); y += 1) for (let x = Math.floor(label.x * SCALE); x < Math.ceil((label.x + label.w) * SCALE); x += 1) if (dist(px(img, x, y), fill) > 0.5) glyph += 1;
        check('s', n, glyph >= 12, `蓋章鈕上的字形墨跡只有 ${glyph} 個像素（<12）——字看不見`);

        // t：可點範圍（stamp.hit＝Button／Link 的 label 框，含外擴的內距）
        const hit = frames.find(f => f.id === 'stamp.hit');
        if (!hit) fail('t', n, '缺 stamp.hit（可點範圍的框）');
        else {
          const key = `${spec.fam}-${spec.width}`, E = 0.05;
          const f1 = v => v.toFixed(1);
          check('t', n, hit.x <= chip.x + E && hit.y <= chip.y + E && hit.x + hit.w >= chip.x + chip.w - E && hit.y + hit.h >= chip.y + chip.h - E,
            `可點範圍 x ${f1(hit.x)}–${f1(hit.x + hit.w)}、y ${f1(hit.y)}–${f1(hit.y + hit.h)} 沒有包住鈕 x ${f1(chip.x)}–${f1(chip.x + chip.w)}、y ${f1(chip.y)}–${f1(chip.y + chip.h)}`);
          check('t', n, hit.x >= -E && hit.y >= -E && hit.x + hit.w <= spec.w + E && hit.y + hit.h <= spec.h + E,
            `可點範圍超出卡片：x ${f1(hit.x)}–${f1(hit.x + hit.w)}、y ${f1(hit.y)}–${f1(hit.y + hit.h)}（卡 ${spec.w}×${spec.h}）`);
          const [minW, minH] = HIT_MIN[key];
          check('t', n, hit.w >= minW - E && hit.h >= minH - E, `可點範圍只有 ${f1(hit.w)}×${f1(hit.h)}pt，小於下限 ${minW}×${minH}pt`);
          for (const o of frames.filter(f => !f.id.includes('#') && !f.id.endsWith('.fill') && !['stamp', 'stamp.chip', 'stamp.hit'].includes(f.id))) {
            const ix = Math.min(hit.x + hit.w, o.x + o.w) - Math.max(hit.x, o.x), iy = Math.min(hit.y + hit.h, o.y + o.h) - Math.max(hit.y, o.y);
            check('t', n, !(ix > E && iy > E), `可點範圍與 ${o.id}${o.text ? `「${o.text}」` : ''} 相交 ${f1(ix)}×${f1(iy)}pt（點擊範圍蓋到文字／進度條／地圖）`);
          }
          if (!LANG) { // 外觀尺寸與位置與改點擊範圍前相同（英日文的字寬不同，不比）
            const [cw, ch, cx, cy] = CHIP_BEFORE[key];
            check('t', n, Math.abs(chip.w - cw) <= 0.6 && Math.abs(chip.h - ch) <= 0.6 && Math.abs(chip.x - cx) <= 0.6 && Math.abs(chip.y - cy) <= 0.6,
              `蓋章鈕 ${f1(chip.w)}×${f1(chip.h)} 位在 (${f1(chip.x)}, ${f1(chip.y)})，與改可點範圍前的 ${cw}×${ch} 位在 (${cx}, ${cy}) 不同（外觀或位置動了）`);
          }
        }
      }
    }

    // ── 「沒有檔案」：只該有提示文字，沒有地圖、沒有數字 ──
    if (UNAVAILABLE.has(spec.state)) {
      // 圓形鎖屏只有一個「—」符號（圓環裡放不下句子），其餘家族要有那句提示。
      const lockCirc = spec.fam === 'circ';
      check('c', n, (lockCirc || byId('unavailable').length === 1) && !map && byId('pct').length === 0,
        `沒有 collection.json 時應只有提示文字：unavailable=${byId('unavailable').length}、map=${!!map}、pct=${byId('pct').length}`);
      if (!lockCirc) check('c', n, byId('unavailable')[0]?.text === tr('打開軌島一次，就會出現你的車站收集'), '提示文案不對');
      continue;
    }

    // ── 有檔案的卡：地圖類閘門 ──
    if (map) {
      // a1：文字框與地圖框
      for (const t of texts) {
        const ix = Math.min(t.x + t.w, map.x + map.w) - Math.max(t.x, map.x);
        const iy = Math.min(t.y + t.h, map.y + map.h) - Math.max(t.y, map.y);
        check('a1', n, !(ix > 0.05 && iy > 0.05), `${t.id}「${t.text}」的框與地圖框相交 ${ix.toFixed(1)}×${iy.toFixed(1)}pt`);
      }
      // a2：地圖藏起來後，地圖框內不該有任何墨跡（那就是文字字形侵入）
      const hidden = await loadPixels(join(out, 'shots', `${n}.hidden.png`));
      const bg = px(hidden, 1, 1);
      const x0 = Math.ceil((map.x + 0.5) * SCALE), x1 = Math.floor((map.x + map.w - 0.5) * SCALE);
      const y0 = Math.ceil((map.y + 0.5) * SCALE), y1 = Math.floor((map.y + map.h - 0.5) * SCALE);
      let ink = 0;
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) if (dist(px(hidden, x, y), bg) > 0.07) ink += 1;
      check('a2', n, ink === 0, `地圖框內有 ${ink} 個文字墨跡像素（字形壓到地圖）`);

      // b3：寬高比
      check('b3', n, Math.abs(map.w / map.h - fix.aspect) / fix.aspect < 0.01,
        `地圖框 ${map.w.toFixed(1)}×${map.h.toFixed(1)}（比 ${(map.w / map.h).toFixed(4)}）≠ payload.aspect ${fix.aspect}`);
      // 地圖框在內容框內
      check('e', n, map.x >= inset - 0.6 && map.y >= inset - 0.6 && map.x + map.w <= spec.w - inset + 0.6 && map.y + map.h <= spec.h - inset + 0.6,
        `地圖框超出內容框：${JSON.stringify(map)}`);

      // b1：畫了幾個點（其他系統灰／未收集／跟完／實心分開數）
      const exp = expectedCenters(ex, map);
      const got = res.probe;
      const kinds = ['other', 'off', 'follow', 'solid'];
      check('b1', n, kinds.every(k => got[k].length === exp[k].length),
        `畫出的點數 其他系統灰/未收集/跟完/實心 = ${kinds.map(k => got[k].length).join('/')}，payload 應為 ${kinds.map(k => exp[k].length).join('/')}`);

      // b2：每個點的座標圓盤內有墨跡（含視窗內的其他系統灰點）。
      // 量「關掉輪廓」那張：台灣輪廓的填色（離卡底 0.105）與海岸線本身就是墨跡，留著的話，
      // 位在陸地上的點就算沒畫出來，圓盤內也照樣「有墨跡」，這道閘門會失明。點與輪廓的疊放（點沒被輪廓蓋住）由 r 與 o3 量出貨那張。
      const shipped = await loadPixels(join(out, 'shots', `${n}.png`));
      const bare = await loadPixels(join(out, 'shots', `${n}.nooutline.png`));
      const sbg = px(bare, 1, 1);
      let missing = 0, total = 0;
      for (const k of kinds) for (const [lx, ly] of exp[k]) {
        total += 1;
        if (!inkWithin(bare, (map.x + lx) * SCALE, (map.y + ly) * SCALE, exp.R * SCALE + 0.5, sbg)) missing += 1;
      }
      check('b2', n, missing === 0, `${missing}/${total} 個點的座標上是底色（位置對不上或沒畫）`);

      // v：圓心位置（全台整島框、單一系統視窗，同一套公式）、單一系統的外框、地圖框不因範圍而跳
      const worst = {};
      for (const k of kinds) worst[k] = matchMaxDist(got[k], exp[k]);
      check('v', n, kinds.every(k => worst[k] <= 1.5),
        `圓心與公式座標不符（容差 1.5pt）：${kinds.map(k => `${k} 最大差 ${Number.isFinite(worst[k]) ? worst[k].toFixed(1) + 'pt' : '筆數不同'}`).join('、')}${ex.vp ? `；視窗 x0=${ex.vp.x0.toFixed(1)} y0=${ex.vp.y0.toFixed(1)} S=${ex.vp.S.toFixed(1)}` : '（全台整島框）'}`);
      if (ex.scoped && ex.dots.length > 1) {
        const c = [...got.off, ...got.follow, ...got.solid];
        const xs = c.map(p => p[0]), ys = c.map(p => p[1]);
        const ext = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        const short = Math.min(map.w, map.h);
        check('v', n, ext >= 0.5 * short,
          `單一系統的點陣外框只撐開地圖框短邊的 ${(100 * ext / short).toFixed(0)}%（<50%；${ex.dots.length} 座站，像是仍用整島框）`);
      }
      if (ex.scoped) {
        const baseSpec = specs.find(s => !s.scope && s.fam === spec.fam && s.state === spec.state && s.scheme === spec.scheme && s.mono === spec.mono && s.width === spec.width);
        const baseMap = baseSpec && results.find(r => r.name === baseSpec.name)?.frames.find(f => f.id === 'map');
        if (baseMap) {
          check('v', n, ['x', 'y', 'w', 'h'].every(k => Math.abs(baseMap[k] - map[k]) <= 0.5),
            `單一系統的地圖框 ${JSON.stringify(map)} 與全台的 ${JSON.stringify(baseMap)} 不同（版面會跳）`);
        }
      }

      // r：合成三態的像素（空心圈）
      if (spec.state === 'states') {
        const bad = [];
        const r = exp.r, R = exp.R, ringMid = R - (R * RING_RATIO) / 2;
        const bgc = [BG[spec.scheme], BG[spec.scheme], BG[spec.scheme]];
        const fillV = spec.mono ? monoOutlineFill(spec.scheme) : OUTLINE_FILL[spec.scheme];
        const fillC = [fillV, fillV, fillV];
        const off = [OFF_GRAY[spec.scheme], OFF_GRAY[spec.scheme], OFF_GRAY[spec.scheme]];
        const cell = (x, y) => px(shipped, Math.floor(x), Math.floor(y));
        for (let row = 0; row < 10; row += 1) {
          const line = lineColor(STATE_COLORS[row], spec.scheme, spec.mono);
          const gap = dist(line, bgc);
          if (gap < 0.5) bad.push(`第${row}列 線色離底色只有 ${gap.toFixed(2)}，fixture 分不出來`);
          const at = s => {
            const d = [200 + s * 300, 50 + row * 100];
            const inset2 = r * SOLID_SCALE;
            return [(map.x + inset2 + (d[0] / 1000) * (map.w - 2 * inset2)) * SCALE, (map.y + inset2 + (d[1] / 1000) * (map.h - 2 * inset2)) * SCALE];
          };
          const [c0, c1, c2] = [0, 1, 2].map(at);
          const p0 = cell(...c0), p1 = cell(...c1), p2 = cell(...c2);
          if (!(dist(p2, line) <= 0.12)) bad.push(`第${row}列 實心圓心 ${p2.map(v => v.toFixed(2))} 離線色 ${line.map(v => v.toFixed(2))} 太遠`);
          // 空心圈的圓心是透明的，透出來的是圓心底下的東西：海上＝卡底，陸地上＝台灣輪廓的填色，海岸邊＝兩者的混色。
          // 所以期望值是「卡底與輪廓填色之間」（±0.03）；被填成線色或未收集灰就落在這個區間外。
          const lo = Math.min(bgc[0], fillC[0]) - 0.03, hi = Math.max(bgc[0], fillC[0]) + 0.03;
          if (!p1.every(c => c >= lo && c <= hi)) bad.push(`第${row}列 空心圈圓心 ${p1.map(v => v.toFixed(2))} 不是底色或輪廓填色（圈中間被填了）`);
          if (!(dist(p0, off) <= 0.08)) bad.push(`第${row}列 未收集點圓心 ${p0.map(v => v.toFixed(2))} 不是未收集灰`);
          if (!(dist(p1, p2) >= 0.5 * gap)) bad.push(`第${row}列 空心圓心與實心圓心只差 ${dist(p1, p2).toFixed(2)}，分不出空心與實心`);
          // 圈上：圈寬中線半徑上、八個方向各取一點，都要比「一半」更接近線色
          const ringPx = ringMid * SCALE;
          const weak = [];
          for (let a = 0; a < 8; a += 1) {
            const q = cell(c1[0] + ringPx * Math.cos((a * Math.PI) / 4), c1[1] + ringPx * Math.sin((a * Math.PI) / 4));
            if (!(dist(q, line) <= 0.5 * gap)) weak.push(a * 45);
          }
          if (weak.length) bad.push(`第${row}列 圈上 ${weak.join('、')}° 的像素不接近線色（圈不見或太細）`);
        }
        check('r', n, bad.length === 0, bad.slice(0, 4).join('；'));
      }

      // ── o：台灣輪廓。期望色是設計值，取樣點是手寫經緯度自己投影；與「關掉輪廓」那張（bare）逐像素比 ──
      const bgv = BG[spec.scheme], fillv = spec.mono ? monoOutlineFill(spec.scheme) : OUTLINE_FILL[spec.scheme];
      const g3 = v => [v, v, v];
      const f3 = v => v.toFixed(3);

      // o2：輪廓不侵入文字框、進度條框、蓋章鈕框；並配正向對照——輪廓確實有畫，不然「沒有侵入」是空話
      for (const f of frames.filter(f => !f.id.includes('#') && f.id !== 'map' && f.id !== 'stamp.hit'
        && (f.text !== null || f.id === 'stamp.chip' || f.id.endsWith('.track') || f.id.endsWith('.fill')))) {
        const cnt = diffCount(shipped, bare, Math.floor(f.x * SCALE), Math.floor(f.y * SCALE), Math.ceil((f.x + f.w) * SCALE), Math.ceil((f.y + f.h) * SCALE));
        check('o2', n, cnt === 0, `輪廓侵入 ${f.id}${f.text ? `「${f.text}」` : ''}：框內有 ${cnt} 個像素與「關掉輪廓」那張不同`);
      }
      if (!ex.scoped || OUTLINE_SCOPED.includes(spec.scope)) {
        const drawn = diffCount(shipped, bare, 0, 0, shipped.w, shipped.h);
        check('o2', n, drawn >= 50, `輪廓沒畫出來：出貨圖與「關掉輪廓」那張只有 ${drawn} 個像素不同（<50）；沒有輪廓的話「沒有侵入」是空話`);
      }

      // o1：全台、沒有任何點——陸地取樣點＝填色、海上＝卡底、恆春半島南端（框底之下）＝填色
      if (spec.state === 'bare' && !spec.mono) {
        const probes = [
          ...OUTLINE_LAND.map(([name, lon, lat]) => [`${name}（內陸）`, lon, lat, fillv, '輪廓填色']),
          ...OUTLINE_SEA.map(([name, lon, lat]) => [`${name}（海上）`, lon, lat, bgv, '卡底']),
          ...OUTLINE_PENINSULA.map(([name, lon, lat]) => [name, lon, lat, fillv, '輪廓填色（在點陣框底之下，被裁掉了？）']),
        ];
        for (const [name, lon, lat, want, what] of probes) {
          const p = cardPx(shipped, lonLatToCard(map, lon, lat));
          check('o1', n, dist(p, g3(want)) <= 0.03, `${name}：像素 ${p.map(f3)} 應是${what} ${f3(want)}`);
        }
      }

      // o3：未收集灰點放在陸地填色上的對比 ≥ 放在卡底上的 0.9 倍（合成三態樣本，淺色、深色）
      // o5：著色模式——輪廓有畫、但比已收集的點淡
      if (spec.state === 'states') {
        const land = OUTLINE_LAND.map(([, lon, lat]) => lonLatToCard(map, lon, lat)).find(pt => isClear(exp, map, pt, 2.5));
        const dotAt = list => (list.length ? cardPx(shipped, [map.x + list[0][0], map.y + list[0][1]]) : null);
        if (!land) fail(spec.mono ? 'o5' : 'o3', n, '合成三態樣本裡找不到離所有點夠遠的陸地取樣點（樣本或取樣表壞了）');
        else if (!spec.mono) {
          const D = grayOf(dotAt(exp.off)), F = grayOf(cardPx(shipped, land)), B = grayOf(px(shipped, 1, 1));
          check('o3', n, Math.abs(F - fillv) <= 0.02 && Math.abs(B - bgv) <= 0.02 && Math.abs(D - OFF_GRAY[spec.scheme]) <= 0.02,
            `取樣像素不是預期的顏色：填色 ${f3(F)}（應 ${f3(fillv)}）、卡底 ${f3(B)}（應 ${f3(bgv)}）、灰點 ${f3(D)}（應 ${f3(OFF_GRAY[spec.scheme])}）`);
          const onFill = contrastOf(D, F), onBg = contrastOf(D, B);
          check('o3', n, onFill >= 0.9 * onBg, `灰點對填色的對比 ${f3(onFill)} 只有灰點對卡底 ${f3(onBg)} 的 ${f3(onFill / onBg)} 倍（<0.9）——輪廓把未收集的點蓋淡了`);
        } else {
          const F = grayOf(cardPx(shipped, land)), S = grayOf(dotAt(exp.solid));
          const drawn = dist(g3(F), g3(bgv)), inkD = dist(g3(S), g3(bgv));
          check('o5', n, drawn >= 0.06, `著色模式的輪廓看不見：填色像素 ${f3(F)} 離卡底 ${f3(bgv)} 只有 ${f3(drawn)}（<0.06）`);
          check('o5', n, drawn <= 0.5 * inkD, `著色模式的輪廓（離卡底 ${f3(drawn)}）不比已收集的點（離卡底 ${f3(inkD)}）淡`);
        }
      }

      // o4：單一系統是細線不是填色——視窗中心（陸地內部）＝卡底，落墨面積 ≤ 地圖框的 15%
      if (ex.scoped && OUTLINE_SCOPED.includes(spec.scope)) {
        const [mx, my] = mapPoint(map, 0.5, 0.5);
        const probe = clearNear(exp, map, [map.x + mx, map.y + my], 2.5);
        if (!probe) fail('o4', n, '地圖框中心附近找不到離所有點夠遠的取樣點');
        else {
          const p = cardPx(shipped, probe);
          check('o4', n, dist(p, g3(bgv)) <= 0.03, `單一系統視窗中心（陸地內部）的像素 ${p.map(f3)} 不是卡底 ${f3(bgv)}——輪廓被填色了，單一系統要畫細線`);
        }
        const area = Math.round(map.w * SCALE) * Math.round(map.h * SCALE);
        const ink = diffCount(shipped, bare, Math.floor(map.x * SCALE), Math.floor(map.y * SCALE), Math.ceil((map.x + map.w) * SCALE), Math.ceil((map.y + map.h) * SCALE));
        check('o4', n, ink <= 0.15 * area, `單一系統的輪廓落墨佔地圖框 ${(100 * ink / area).toFixed(1)}%（>15%）——細線不會這麼多，像是填色`);
      }
    }

    // ── c：數字與 payload 一致 ──
    const numsOf = id => byId(id).map(t => nums(t.text));
    const expectNums = (id, want, label = id) => {
      const got = numsOf(id);
      check('c', n, got.length >= 1 && got.every(g => JSON.stringify(g) === JSON.stringify(want)),
        `${label} 數字 ${JSON.stringify(got)} ≠ 期望 ${JSON.stringify(want)}`);
    };
    const expectText = (id, want) => {
      const t = byId(id)[0];
      check('c', n, t && t.text === want, `${id} 文字「${t?.text}」≠ 期望「${want}」`);
    };
    const expectAbsent = id => check('c', n, byId(id).length === 0, `${id} 不該出現`);
    const isEmpty = ex.v === 0;

    if (spec.fam === 'circ') {
      expectText('pct', ex.pctText);
    } else if (isEmpty) {
      // 邀請文案（全灰地圖已由 b1 保證：off＝全部、follow／solid＝0）
      check('c', n, byId('empty.title').length === 1 && byId('empty.title')[0].text === tr('還沒有收集的車站'), '空狀態少了邀請標題');
      if (spec.fam === 'small') expectAbsent('pct');
      else expectText('pct', '0%');
      if (spec.fam === 'medium') expectNums('countOf', [0, ex.total]);
      if (spec.fam === 'medium') { expectAbsent('legend.solid'); expectAbsent('legend.follow'); } // 空狀態沒有實心也沒有空心，不放圖例
    } else if (spec.fam === 'small') {
      expectText('pct', ex.pctText); expectNums('pct', nums(ex.pctText));
      expectNums('count', [ex.v]); expectText('count', tr('已收集 {n} 座', { n: ex.v }));
      expectNums('remain', [ex.remain]); expectText('remain', tr('還有 {n} 座', { n: ex.remain }));
    } else if (spec.fam === 'medium') {
      expectText('pct', ex.pctText); expectNums('pct', nums(ex.pctText));
      expectNums('countOf', [ex.v, ex.total]); expectText('countOf', tr('已收集 {v}／{n} 座', { v: ex.v, n: ex.total }));
      // 圖例：兩段都在（規格第二輪第 4 點：「實心＝搭過／到訪」「空心＝跟完」）
      expectText('legend.solid', tr('實心＝搭過／到訪'));
      expectText('legend.follow', tr('空心＝跟完'));
      if (!ex.scoped) {
        const ids = texts.filter(f => /^sys\.[a-z]+\.count$/.test(f.id)).map(f => f.id.split('.')[1]);
        check('c', n, JSON.stringify(ids) === JSON.stringify(ex.top.map(s => s.k)),
          `中卡系統列 ${JSON.stringify(ids)} ≠ 依總站數排序的前 5 個有收集的系統 ${JSON.stringify(ex.top.map(s => s.k))}`);
        for (const s of ex.top) {
          expectNums(`sys.${s.k}.count`, [s.v, s.n]);
          expectText(`sys.${s.k}.count`, `${s.v}/${s.n}`);
          expectText(`sys.${s.k}.label`, s.label);
        }
        if (ex.untouched > 0) { expectNums('untouched', [ex.untouched]); expectText('untouched', tr('還有 {n} 個系統還沒去過', { n: ex.untouched })); }
        else expectAbsent('untouched');
        check('c', n, !texts.some(f => f.id.startsWith('recent.')), '全台中卡不該畫最近蓋章（契約畫法約定 9）');
      } else {
        expectNums('remain', [ex.remain]);
        // 單一系統的最近蓋章（契約畫法約定 9）：放得下幾筆就畫幾筆，上限 4，畫篩出來的前 N 筆。判準只用量到的框與 payload，
        // 不含任何「畫 2 筆」之類的常數——放得下幾筆是各尺寸自己的事：
        //  (a) 畫出的筆數 N ≤ min(4, 可用筆數)；(b) 畫出的就是 ex.recent 的前 N 筆，日期／站名／線名逐列相符、順序對；
        //  (c) 最大性：還有沒畫的可用筆數時，最後一筆（一筆都沒畫就看「還有 N 座」）下緣到圖例上緣的空隙 < 再多一列要的高度，
        //      否則就是「放得下卻沒畫」。「再多一列要的高度」從量到的框推：兩列以上＝相鄰兩列的框差；只畫 1 筆＝那一列自己的高度加它與上一行的間距；
        //      一筆都沒畫＝取「還有 N 座」那一行的高度當下限（任何一列都不會比它矮）。
        const drawn = [];
        while (byId(`recent.${drawn.length}.date`).length > 0) drawn.push(drawn.length);
        const N = drawn.length, avail = Math.min(4, ex.recent.length);
        check('c', n, N <= avail, `最近蓋章畫了 ${N} 筆，多於 min(4, 可用 ${ex.recent.length} 筆) = ${avail}`);
        ex.recent.slice(0, N).forEach((r, i) => {
          expectText(`recent.${i}.date`, shortDate(r.d));
          expectText(`recent.${i}.name`, r.name);
          expectText(`recent.${i}.line`, r.line);
        });
        if (N < avail) {
          const rowBox = i => {
            const fs = ['date', 'name', 'line'].map(p => byId(`recent.${i}.${p}`)[0]).filter(Boolean);
            return { top: Math.min(...fs.map(f => f.y)), bottom: Math.max(...fs.map(f => f.y + f.h)) };
          };
          const remainBox = byId('remain')[0], legendTop = Math.min(...['legend.solid', 'legend.follow'].flatMap(id => byId(id)).map(f => f.y));
          if (!remainBox || !Number.isFinite(legendTop)) fail('c', n, '量不到「還有 N 座」或圖例的框，無法判斷最近蓋章畫滿了沒有');
          else {
            const lastBottom = N > 0 ? rowBox(N - 1).bottom : remainBox.y + remainBox.h;
            const pitch = N >= 2 ? rowBox(N - 1).top - rowBox(N - 2).top
              : N === 1 ? rowBox(0).bottom - rowBox(0).top + (rowBox(0).top - (remainBox.y + remainBox.h))
                : remainBox.h;
            const free = legendTop - lastBottom;
            check('c', n, free < pitch, `最近蓋章只畫 ${N} 筆（可畫 ${avail} 筆），最後一筆下緣到圖例上緣還空 ${free.toFixed(1)}pt ≥ 再多一列要的 ${pitch.toFixed(1)}pt——放得下卻沒畫`);
          }
        }
      }
    } else if (spec.fam === 'rect') {
      expectText('pct', ex.pctText);
      expectNums('countOf', [ex.v, ex.total]);
      expectText('countOf', tr('已收集 {v}／{n} 座', { v: ex.v, n: ex.total }));
    }
    check('c', n, !texts.some(t => /已踩|今年新增|淡色/.test(t.text)), '出現了不准出現的文案（已踩／今年新增／淡色）');
    if (spec.fam !== 'medium') { expectAbsent('legend.solid'); expectAbsent('legend.follow'); check('c', n, !texts.some(f => f.id.startsWith('recent.')), '小卡與鎖屏不畫最近蓋章（契約畫法約定 9）'); }

    // ── c2：填滿比例 ──
    const fills = [];
    if (spec.fam === 'medium' && !isEmpty) {
      if (!ex.scoped) for (const s of ex.top) fills.push([`sys.${s.k}`, fillFrac(s.v, s.n), 'w']);
      else fills.push(['scopebar', fillFrac(ex.v, ex.total), 'w']);
    }
    if (spec.fam === 'rect' && !isEmpty) fills.push(['bar', fillFrac(ex.v, ex.total), 'w']);
    for (const [id, frac, axis] of fills) {
      const tr = frames.find(f => f.id === `${id}.track`), fl = frames.find(f => f.id === `${id}.fill`);
      if (!tr || !fl) { fail('c2', n, `${id} 沒有回報軌道／填滿框`); continue; }
      const got = fl[axis] / tr[axis];
      check('c2', n, Math.abs(got - frac) < 0.004, `${id} 填滿 ${got.toFixed(3)} ≠ 期望 ${frac.toFixed(3)}（v/n，有收集至少 3%）`);
    }
  }

  // hd 的覆蓋率：每個尺寸的單一系統都要各走過「兩個都放」「只放系統名（沒縮）」「縮字放得進去」「縮到下限 75% 仍放不下而截斷」四條路徑
  // （縮字下限 75% 與舊的 70% 只有截斷那條分得出來：截斷時字就停在下限那一檔）；只把 N/M 印在 detail 不算 gate，分母會無聲縮水。
  for (const fam of ['small', 'medium']) {
    for (const regime of ['both', 'fits', 'shrunk', 'cut']) {
      const hit = headerSeen.filter(h => h.fam === fam && h.scoped && h.regime === regime);
      check('hd', `coverage ${fam}`, hit.length >= 1, `${fam} 的單一系統標題列沒有任何案例走到「${regime}」——合成名稱的長度（NAME_LENGTHS）或字級／版面變了，重新量再調`);
    }
  }

  // insets 與發車看板同值
  const boardSrc = readFileSync(join(src, 'RailBoardWidget.swift'), 'utf8');
  const board = boardSrc.match(/enum RailBoardInsets\s*\{\s*static let content: CGFloat = (\d+)/)?.[1];
  const mine = readFileSync(join(src, 'CollectionCard.swift'), 'utf8').match(/static let inset: CGFloat = (\d+)/)?.[1];
  check('e', 'insets', board !== undefined && board === mine, `CollectionMetrics.inset=${mine} 與 RailBoardInsets.content=${board} 不同值`);
  if (String(INSET) !== mine) fail('e', 'insets', `腳本的內距 ${INSET} 與原始碼 ${mine} 不同`);

  // 內建示意資料（小工具圖庫預覽與 placeholder 用）＝本腳本的樣本：兩邊不一致，圖庫看到的就不是驗過的那份
  {
    const previewPath = join(realSrc, 'CollectionWidgetPreview.json');
    const preview = existsSync(previewPath) ? JSON.parse(readFileSync(previewPath, 'utf8')) : null;
    check('c', 'CollectionWidgetPreview.json', preview && JSON.stringify(preview) === JSON.stringify(samplePristine),
      'CollectionWidgetPreview.json 與本腳本的樣本（它自己＋RECENT_BY_SYS 合成的每系統最近蓋章）不同——RECENT_BY_SYS 改過就用 --emit-preview 重寫');
    if (preview) {
      const withRecents = preview.sys.filter(s => s.v > 0).every(s => preview.recent.some(r => r.k === s.k));
      check('c', 'CollectionWidgetPreview.json', withRecents, '內建示意資料：有收集的系統沒有最近蓋章（單一系統中卡會畫不出來）');
    }
  }

  // 轉乘站 fixture 的紅樹林在 payload 內恰一筆（閘門看得到它是因為 ks，不是因為它出現了兩次）
  check('c', 'transfer', FIXTURES.transfer.recent.filter(r => r.name === '紅樹林').length === 1, 'transfer fixture 的紅樹林不是恰好一筆');
  // 目錄本身：c 閘門用到的每個 key，en／ja 都要有譯文，且佔位符集合與繁中 key 相同（譯者掉了 {n} 才抓得到）。
  if (LANG) {
    for (const key of [...L10N_KEYS_USED].sort()) {
      const t = L10N_TABLE[key];
      const has = typeof t === 'string' && t !== '';
      check('c', `目錄「${key}」`, has && JSON.stringify(placeholders(t)) === JSON.stringify(placeholders(key)),
        has ? `${LANG} 譯文「${t}」的佔位符 ${JSON.stringify(placeholders(t))} ≠ 繁中 key 的 ${JSON.stringify(placeholders(key))}`
          : `${LANG} 目錄沒有這個 key（Swift 端會默默退回繁中）`);
    }
  }

  staticGate(src, check);
  pendingGate(src, out, check);
  return { fails, counts };
}

// ── 拼圖 ─────────────────────────────────────────────────────────────────────────────
/** rows：每列一串 shots 檔名（不含 .png）。每張圓角裁切，背景依 scheme；輸出到 out/<file>。 */
async function contactSheet(out, file, rows, scheme) {
  const laid = [];
  for (const row of rows) {
    const tiles = [];
    for (const name of row) {
      const path = join(out, 'shots', `${name}.png`);
      const meta = await sharp(path).metadata();
      const radius = /^circ/.test(name) ? meta.width / 2 : (/^rect/.test(name) ? 14 : 22) * SCALE;
      const mask = Buffer.from(`<svg width="${meta.width}" height="${meta.height}"><rect width="${meta.width}" height="${meta.height}" rx="${radius}" ry="${radius}"/></svg>`);
      tiles.push({ buf: await sharp(path).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer(), w: meta.width, h: meta.height });
    }
    laid.push(tiles);
  }
  const pad = 24 * SCALE;
  const width = pad + Math.max(...laid.map(r => r.reduce((s, t) => s + t.w + pad, 0)));
  const height = pad + laid.reduce((s, r) => s + Math.max(...r.map(t => t.h)) + pad, 0);
  const layers = [];
  let y = pad;
  for (const tiles of laid) {
    let x = pad;
    for (const t of tiles) { layers.push({ input: t.buf, left: x, top: y }); x += t.w + pad; }
    y += Math.max(...tiles.map(t => t.h)) + pad;
  }
  const bg = scheme === 'dark' ? { r: 24, g: 26, b: 32 } : { r: 224, g: 229, b: 238 };
  const path = join(out, file);
  await sharp({ create: { width, height, channels: 3, background: bg } }).composite(layers).png().toFile(path);
  return path;
}
async function contactSheets(out) {
  const s = (fam, scope, state, scheme, mono = false, width = 430) => `${fam}${scope ? '-' + scope : ''}-${state}-${scheme}${mono ? '-tinted' : ''}-${width}`;
  const pair = (scope, state, scheme, mono = false, width = 430) => [s('small', scope, state, scheme, mono, width), s('medium', scope, state, scheme, mono, width)];
  const made = [];
  made.push(await contactSheet(out, 'contact-light.png', [pair(null, 'sample', 'light'), pair(null, 'empty', 'light'), pair(null, 'sample', 'light', false, 393)], 'light'));
  made.push(await contactSheet(out, 'contact-dark.png', [pair(null, 'sample', 'dark'), pair(null, 'empty', 'dark'), pair(null, 'sample', 'dark', false, 393)], 'dark'));
  made.push(await contactSheet(out, 'contact-scoped.png',
    [pair('tra', 'sample', 'light'), pair('trtc', 'sample', 'light'), pair('krtc', 'sample', 'light'), pair('ntalrt', 'sample', 'light'), pair('sanying', 'sample', 'light'), pair('afr', 'solo', 'light')], 'light'));
  made.push(await contactSheet(out, 'contact-scoped-dark.png', [pair('tra', 'sample', 'dark'), pair('trtc', 'sample', 'dark'), pair('krtc', 'sample', 'dark'), pair('krtc', 'sample', 'dark', false, 393)], 'dark'));
  made.push(await contactSheet(out, 'contact-lock.png', [
    [s('rect', null, 'sample', 'dark', true), s('circ', null, 'sample', 'dark', true)],
    [s('rect', null, 'sample', 'light', true), s('circ', null, 'sample', 'light', true)],
    [s('rect', null, 'one', 'light', true), s('circ', null, 'one', 'light', true)],
    [s('rect', null, 'almost', 'light', true), s('circ', null, 'almost', 'light', true)],
    [s('rect', null, 'full', 'light', true), s('circ', null, 'full', 'light', true)],
    [s('rect', null, 'empty', 'light', true), s('circ', null, 'none', 'light', true)],
  ], 'dark'));
  made.push(await contactSheet(out, 'contact-tinted.png',
    [pair(null, 'sample', 'light', true), pair(null, 'sample', 'dark', true), pair('tra', 'sample', 'light', true), pair('tra', 'sample', 'dark', true)], 'light'));
  made.push(await contactSheet(out, 'contact-edge.png',
    [pair(null, 'one', 'light'), pair('tra', 'one', 'light'), pair(null, 'almost', 'light'), pair('tra', 'almost', 'light'), pair(null, 'full', 'light')], 'light'));
  made.push(await contactSheet(out, 'contact-states.png', [
    [s('small', null, 'states', 'light'), s('small', null, 'states', 'dark'), s('small', null, 'states', 'light', true), s('small', null, 'states', 'dark', true)],
  ], 'light'));
  return made;
}

// ── 突變測試：改「複本」，不改真檔 ───────────────────────────────────────────────────
const MUTATIONS = [
  {
    id: 'M1 地圖加寬壓到字',
    file: 'CollectionCard.swift',
    find: `        let mapW = (mapH * f.aspect).rounded()
        let colW`,
    replace: `        let mapW = (mapH * f.aspect * 2.2).rounded()
        let colW`,
    expect: ['a1', 'a2'],
  },
  {
    id: 'M2 跟完畫成實心（空心圈退回實心圓）',
    file: 'CollectionCard.swift',
    find: `                            ctx.stroke(Path(ellipseIn: CGRect(x: c.x - mid, y: c.y - mid, width: 2 * mid, height: 2 * mid)),
                                       with: .color(paint), lineWidth: ring)`,
    replace: `                            ctx.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)),
                                     with: .color(paint))`,
    expect: ['r'],
  },
  {
    id: 'M3 文字欄變窄、關鍵數字被縮',
    file: 'CollectionCard.swift',
    find: 'let textW = (size.width * 0.58).rounded()',
    replace: 'let textW = (size.width * 0.30).rounded()',
    expect: ['d'],
  },
  {
    id: 'M4 單一系統誤把其他系統的點也當成自己的',
    file: 'CollectionCard.swift',
    find: 'let own = snap.pts.filter { $0.sys == index }.map(dot)',
    replace: 'let own = snap.pts.filter { $0.sys >= 0 }.map(dot)',
    expect: ['b1'],
  },
  {
    id: 'M5 百分比改成無條件捨去',
    file: 'CollectionCard.swift',
    find: 'return min(100, (v * 200 + total) / (2 * total))',
    replace: 'return min(100, v * 100 / total)',
    expect: ['c'],
  },
  {
    id: 'M6 地圖點座標多位移一格',
    file: 'CollectionCard.swift',
    find: 'return CGPoint(x: inset + u * (size.width - 2 * inset),',
    replace: 'return CGPoint(x: inset + 6 + u * (size.width - 2 * inset),',
    expect: ['b2', 'v'],
  },
  {
    id: 'M7 進度條填滿比例只畫一半',
    file: 'CollectionCard.swift',
    find: 'return min(1, max(Double(v) / Double(n), 0.03))',
    replace: 'return min(1, max(Double(v) / Double(n) * 0.5, 0.03))',
    expect: ['c2'],
  },
  {
    id: 'M8 系統列高度壓扁、文字互疊',
    file: 'CollectionCard.swift',
    find: `        }
        .frame(height: k.pt(13))
    }
}`,
    replace: `        }
        .frame(height: k.pt(6))
    }
}`,
    expect: ['h'],
  },
  {
    id: 'M9 中卡文字欄整欄右移、超出內容框',
    file: 'CollectionCard.swift',
    find: `            column(f, k)
                .frame(width: colW, alignment: .topLeading)`,
    replace: `            column(f, k)
                .frame(width: colW, alignment: .topLeading)
                .offset(x: 14)`,
    expect: ['e'],
  },
  {
    id: 'M10 單一系統仍用整島框（沒有放大視窗）',
    file: 'CollectionCard.swift',
    find: 'let viewport = CollectionViewport.fitting(own)',
    replace: 'let viewport: CollectionViewport? = nil',
    expect: ['v'],
  },
  {
    id: 'M11 「<1%」退回四捨五入成 0%',
    file: 'CollectionCard.swift',
    find: '        if v > 0 && p == 0 { return "<1" }\n',
    replace: '',
    expect: ['c'],
  },
  {
    id: 'M12 「99%」退回四捨五入成 100%',
    file: 'CollectionCard.swift',
    find: '        if v < total && p >= 100 { return "99" }\n',
    replace: '',
    expect: ['c'],
  },
  {
    id: 'M13 widgetURL 拿掉（點小工具不開護照）',
    file: 'CollectionWidget.swift',
    find: '        .widgetURL(URL(string: "railisland://passport"))\n',
    replace: '',
    expect: ['u'],
  },
  {
    id: 'M14 視窗外的其他系統點也畫出來',
    file: 'CollectionCard.swift',
    find: '.map(dot).filter { viewport?.contains($0) ?? true }',
    replace: '.map(dot).filter { _ in true }',
    expect: ['v'],
  },
  {
    id: 'M15 視窗邊距漏加（pad 歸零）',
    file: 'CollectionCard.swift',
    find: 'let pad = max(0.12 * max(w, h), 10)',
    replace: 'let pad = 0.0',
    expect: ['v'],
  },
  {
    id: 'M16 handleOpen 不收 host passport',
    file: 'RailMetroWaitPlugin.swift',
    find: `
                || url.host == "passport"`,
    replace: '',
    expect: ['u'],
  },
  {
    id: 'M17 空心圈圈寬太細（圈上幾乎沒有線色）',
    file: 'CollectionCard.swift',
    find: 'static let hollowRingRatio: CGFloat = 0.45',
    replace: 'static let hollowRingRatio: CGFloat = 0.06',
    expect: ['r'],
  },
  {
    id: 'M18 蓋章鈕疊到數字上（小卡把鈕與數字疊在同一格）',
    file: 'CollectionCard.swift',
    find: `        VStack(alignment: .leading, spacing: k.pt(6)) {
            numbers(f, k)`,
    replace: `        ZStack(alignment: .topLeading) {
            numbers(f, k)`,
    expect: ['s'],
  },
  {
    id: 'M19 蓋章鈕拿掉（小卡不畫鈕）',
    file: 'CollectionCard.swift',
    find: '            stamp(CollectionStampChip(k: k))\n',
    replace: '',
    expect: ['s'],
  },
  {
    id: 'M20 蓋章連結改成 passport（中卡的鈕開到護照）',
    file: 'CollectionCard.swift',
    find: 'URL(string: "railisland://checkin")!',
    replace: 'URL(string: "railisland://passport")!',
    expect: ['s'],
  },
  {
    id: 'M21 小卡的 Button(intent:) 拿掉（鈕只剩外觀，點了開護照）',
    file: 'CollectionWidget.swift',
    find: 'Button(intent: CollectCheckinIntent()) { chip }.buttonStyle(.plain)',
    replace: 'chip',
    expect: ['s'],
  },
  {
    id: 'M22 待辦讀了不清（蓋章可以被重複觸發）',
    file: 'CollectCheckinIntent.swift',
    find: '        suite.removeObject(forKey: key)\n',
    replace: '',
    expect: ['s'],
  },
  // ── 台灣輪廓（o1–o5）與蓋章鈕可點範圍（t）。每個新閘門至少一個突變；o1 兩個（輪廓沒畫、南端被裁）、t 四個。──
  {
    id: 'M23 輪廓層拿掉（卡片背景沒有台灣）',
    file: 'CollectionCard.swift',
    find: '            CollectionOutlineLayer(viewport: viewport, hidden: hidden)\n',
    replace: '',
    expect: ['o1', 'o2', 'o3', 'o5'],
  },
  // M24 的第一版是把 overflowRatio 改成 0（畫布縮回地圖框）——第一次跑 o1 全綠：ImageRenderer 不會把 Canvas 裁在自己的邊界，
  // 畫布縮回去在 harness 看不出差別（真機的 Canvas 裁不裁沒驗過，overflowRatio 只是防禦）。所以改成明確加 clip：
  // 這才是「輪廓被裁到點陣框、南端被切平」這個缺陷本身，o1 的恆春半島取樣點要抓得到它。
  {
    id: 'M24 輪廓裁到點陣框（恆春半島南端被切平）',
    file: 'CollectionCard.swift',
    find: '            CollectionOutlineLayer(viewport: viewport, hidden: hidden)\n',
    replace: '            CollectionOutlineLayer(viewport: viewport, hidden: hidden)\n                .clipped()\n',
    expect: ['o1'],
  },
  {
    id: 'M25 單一系統也畫成填色（不是細線）',
    file: 'CollectionCard.swift',
    find: `                    if viewport == nil {
                        ctx.fill(path,`,
    replace: `                    if true {
                        ctx.fill(path,`,
    expect: ['o4'],
  },
  {
    id: 'M26 可點範圍縮回鈕本身（小卡、中卡兩個呼叫端都不外擴）',
    edits: [
      {
        file: 'CollectionCard.swift',
        find: 'let chip = CollectionStampChip(k: k, hit: EdgeInsets(top: gap, leading: 4, bottom: CollectionMetrics.inset, trailing: 4))',
        replace: 'let chip = CollectionStampChip(k: k)',
      },
      {
        file: 'CollectionCard.swift',
        find: 'let chip = CollectionStampChip(k: k, compact: true, hit: EdgeInsets(top: 0, leading: 10, bottom: 1, trailing: 10))',
        replace: 'let chip = CollectionStampChip(k: k, compact: true)',
      },
    ],
    expect: ['t'],
  },
  {
    id: 'M27 輪廓整張左移 60pt（侵入文字）',
    file: 'CollectionCard.swift',
    find: '                    ctx.translateBy(x: margin, y: margin)',
    replace: '                    ctx.translateBy(x: margin - 60, y: margin)',
    expect: ['o2'],
  },
  {
    id: 'M28 輪廓填色太深（未收集灰點放上去對比掉到九成以下）',
    file: 'CollectionCard.swift',
    find: 'return scheme == .dark ? Color(white: 0.125) : Color(white: 0.945)',
    replace: 'return scheme == .dark ? Color(white: 0.20) : Color(white: 0.90)',
    expect: ['o3'],
  },
  {
    id: 'M29 著色模式的輪廓跟已收集的點一樣重',
    file: 'CollectionCard.swift',
    find: 'if mono { return Color.primary.opacity(0.05) }',
    replace: 'if mono { return Color.primary.opacity(0.9) }',
    expect: ['o5'],
  },
  {
    id: 'M30 輪廓層加 widgetAccentable（著色模式被染成強調色）',
    file: 'CollectionCard.swift',
    find: '            CollectionOutlineLayer(viewport: viewport, hidden: hidden)\n',
    replace: '            CollectionOutlineLayer(viewport: viewport, hidden: hidden)\n                .widgetAccentable()\n',
    expect: ['o5'],
  },
  {
    id: 'M31 輪廓層拿掉 allowsHitTesting(false)（會吃點擊）',
    file: 'CollectionCard.swift',
    find: '        .allowsHitTesting(false)\n',
    replace: '',
    expect: ['o2'],
  },
  {
    id: 'M32 小卡可點範圍往上多擴 14pt（蓋到「還有 N 座」）',
    file: 'CollectionCard.swift',
    find: 'hit: EdgeInsets(top: gap, leading: 4, bottom: CollectionMetrics.inset, trailing: 4)',
    replace: 'hit: EdgeInsets(top: gap + 14, leading: 4, bottom: CollectionMetrics.inset, trailing: 4)',
    expect: ['t'],
  },
  {
    id: 'M33 小卡沒抵銷外擴的內距（鈕被推離原位）',
    file: 'CollectionCard.swift',
    find: `            numbers(f, k)
            stamp(chip).padding(chip.hitCompensation)`,
    replace: `            numbers(f, k)
            stamp(chip)`,
    expect: ['t'],
  },
  {
    id: 'M34 蓋章鈕本身被放大（外觀尺寸變了）',
    file: 'CollectionCard.swift',
    find: '.padding(.horizontal, k.pt(compact ? 8 : 9))',
    replace: '.padding(.horizontal, k.pt(compact ? 8 : 14))',
    expect: ['t'],
  },
  {
    id: 'M35 Button 的 label 不是鈕本身（外面另包一層）',
    file: 'CollectionWidget.swift',
    find: 'Button(intent: CollectCheckinIntent()) { chip }.buttonStyle(.plain)',
    replace: 'Button(intent: CollectCheckinIntent()) { chip.padding(2) }.buttonStyle(.plain)',
    expect: ['t'],
  },
  {
    id: 'M36 文案 key 換錯（「已收集 N 座」改用「還有 {n} 座」的 key）',
    file: 'CollectionCard.swift',
    find: 'RailNativeL10n.text("已收集 {n} 座", ["n": "\\(f.collected)"])',
    replace: 'RailNativeL10n.text("還有 {n} 座", ["n": "\\(f.collected)"])',
    expect: ['c'],
  },
  {
    id: 'M39 容錯拿掉：Lossy 改回會 throw（一個壞元素整包作廢）',
    file: 'CollectionCard.swift',
    find: 'init(from decoder: Decoder) { value = try? T(from: decoder) }',
    replace: 'init(from decoder: Decoder) throws { value = try T(from: decoder) }',
    expect: ['c'],
  },
  {
    id: 'M40 color 為 null 的點被略過（應該用品牌色照畫）',
    file: 'CollectionCard.swift',
    find: 'if case .string(let text) = items[2] { color = text } else { color = "" }',
    replace: 'guard case .string(let text) = items[2] else { throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "color")) }; color = text',
    expect: ['b1'],
  },
  {
    id: 'M41 s 不驗 0／1／2（s＝3 的壞點留下來，撐大視窗外框）',
    file: 'CollectionCard.swift',
    find: 'case .number(let ps) = items[3], ps == 0 || ps == 1 || ps == 2',
    replace: 'case .number(let ps) = items[3]',
    expect: ['v'],
  },
  {
    id: 'M42 recent 的 name 為 null 沒有略過那一筆（變成空站名）',
    file: 'CollectionCard.swift',
    find: 'name = try c.decode(String.self, forKey: .name)',
    replace: 'name = (try? c.decode(String.self, forKey: .name)) ?? ""',
    expect: ['c'],
  },
  {
    id: 'M43 單一系統的最近蓋章只看 k（轉乘站在另一個系統看不到）',
    file: 'CollectionCard.swift',
    find: '$0.k == sys.k || ($0.ks?.contains(sys.k) ?? false)',
    replace: '$0.k == sys.k',
    expect: ['c'],
  },
  {
    id: 'M44 單一系統的最近蓋章只看 ks（沒有 ks 的站全消失）',
    file: 'CollectionCard.swift',
    find: '$0.k == sys.k || ($0.ks?.contains(sys.k) ?? false)',
    replace: '($0.ks?.contains(sys.k) ?? false)',
    expect: ['c'],
  },
  {
    id: 'M45 最近蓋章的上限改成 1 筆（放得下也只畫 1 筆）',
    file: 'CollectionCard.swift',
    find: `                columnBody(f, k, recentRows: 4)
                columnBody(f, k, recentRows: 3)
                columnBody(f, k, recentRows: 2)
                columnBody(f, k, recentRows: 1)
`,
    replace: `                columnBody(f, k, recentRows: 1)
`,
    expect: ['c'],
  },
  {
    id: 'M46 最近蓋章改回寫死 2 筆（不看放不放得下）',
    file: 'CollectionCard.swift',
    find: `            ViewThatFits(in: .vertical) {
                columnBody(f, k, recentRows: 4)
                columnBody(f, k, recentRows: 3)
                columnBody(f, k, recentRows: 2)
                columnBody(f, k, recentRows: 1)
                columnBody(f, k, recentRows: 0)
            }
`,
    replace: `            columnBody(f, k, recentRows: 2)
`,
    expect: ['c'],
  },
  // ── 標題列（契約畫法約定 8）的突變：考 hd 閘門的每一層。langs＝這條突變考的路徑只在這些語言出現（全台小卡兩個名稱放不下只有英文），其他語言不跑。
  {
    id: 'M47 小卡省略順序對調（全台留「全台」、單一系統留「車站收集」）——考「剩下的是契約指定的那個」',
    file: 'CollectionCard.swift',
    find: '            (f.isAll ? soleApp : scope).frame(maxWidth: .infinity, alignment: .leading)',
    replace: '            (f.isAll ? scope : soleApp).frame(maxWidth: .infinity, alignment: .leading)',
    expect: ['hd'],
  },
  {
    id: 'M48 小卡退讓改回舊行為（全台也留「全台」，單一系統照舊）——考全台那一半',
    file: 'CollectionCard.swift',
    find: '            (f.isAll ? soleApp : scope).frame(maxWidth: .infinity, alignment: .leading)',
    replace: '            scope.frame(maxWidth: .infinity, alignment: .leading)',
    expect: ['hd'],
    langs: ['en'],
  },
  {
    id: 'M49 中卡省略順序對調（單一系統放不下時留「車站收集」、不留系統名）',
    file: 'CollectionCard.swift',
    find: '                    Self.headRow(k, title: scopeTitle, pct: pct)',
    replace: `                    Self.headRow(k, title: CollectionText(
                        id: "title", text: RailNativeL10n.text("車站收集"),
                        content: Text(RailNativeL10n.text("車站收集")).font(font), minScale: 0.75, reportIdeal: true), pct: pct)`,
    expect: ['hd'],
  },
  {
    id: 'M50 中卡標題縮字下限改回 0.7——考「縮字不低於 75%」',
    edits: [
      {
        file: 'CollectionCard.swift',
        find: '            id: "title", text: whole, content: Text(whole).font(font), minScale: 0.75, reportIdeal: true)',
        replace: '            id: "title", text: whole, content: Text(whole).font(font), minScale: 0.7, reportIdeal: true)',
      },
      {
        file: 'CollectionCard.swift',
        find: '            id: "title", text: f.title, content: Text(f.title).font(font), minScale: 0.75, reportIdeal: true)',
        replace: '            id: "title", text: f.title, content: Text(f.title).font(font), minScale: 0.7, reportIdeal: true)',
      },
    ],
    expect: ['hd'],
  },
  {
    id: 'M51 小卡標題縮字下限改回 0.7（範圍名與只剩的「車站收集」）',
    edits: [
      {
        file: 'CollectionCard.swift',
        find: '            id: "title", text: f.title, content: Text(f.title).font(scopeFont), minScale: 0.75, reportIdeal: true)',
        replace: '            id: "title", text: f.title, content: Text(f.title).font(scopeFont), minScale: 0.7, reportIdeal: true)',
      },
      {
        file: 'CollectionCard.swift',
        find: '            id: "subtitle", text: name, content: Text(name).font(scopeFont), minScale: 0.75, reportIdeal: true)',
        replace: '            id: "subtitle", text: name, content: Text(name).font(scopeFont), minScale: 0.7, reportIdeal: true)',
      },
    ],
    expect: ['hd'],
  },
  {
    id: 'M52 小卡兩個名稱之間不留最小間距——考「放得下」要算上最小間距',
    file: 'CollectionCard.swift',
    find: `        HStack(spacing: k.pt(4)) {
            a.fixedSize()
            Spacer(minLength: 2)
            b.fixedSize()`,
    replace: `        HStack(spacing: 0) {
            a.fixedSize()
            Spacer(minLength: 0)
            b.fixedSize()`,
    expect: ['hd'],
  },
  {
    id: 'M53 中卡標題與百分比之間不留最小間距',
    file: 'CollectionCard.swift',
    find: `        HStack(alignment: .firstTextBaseline, spacing: k.pt(6)) {
            title
            Spacer(minLength: 0)
            pct`,
    replace: `        HStack(alignment: .firstTextBaseline, spacing: 0) {
            title
            Spacer(minLength: 0)
            pct`,
    expect: ['hd'],
  },
  {
    id: 'M54 小卡永遠兩個都放（不看放不放得下）——考「放不下只剩一個」',
    file: 'CollectionCard.swift',
    find: `        return ViewThatFits(in: .horizontal) {
            Self.bothNames(k, scope, app)
            (f.isAll ? soleApp : scope).frame(maxWidth: .infinity, alignment: .leading)
        }`,
    replace: `        return Group {
            Self.bothNames(k, scope, app)
        }`,
    expect: ['hd'],
  },
  {
    id: 'M55 小卡永遠只留一個（放得下也不放兩個）——考「放得下 ⟺ 兩個都在」',
    file: 'CollectionCard.swift',
    find: `        return ViewThatFits(in: .horizontal) {
            Self.bothNames(k, scope, app)
            (f.isAll ? soleApp : scope).frame(maxWidth: .infinity, alignment: .leading)
        }`,
    replace: `        return Group {
            (f.isAll ? soleApp : scope).frame(maxWidth: .infinity, alignment: .leading)
        }`,
    expect: ['hd'],
  },
  {
    id: 'M56 中卡永遠整段標題（不看放不放得下）',
    file: 'CollectionCard.swift',
    find: `                ViewThatFits(in: .horizontal) {
                    Self.headRow(k, title: wholeTitle.fixedSize(), pct: pct)
                    Self.headRow(k, title: scopeTitle, pct: pct)
                }`,
    replace: `                Self.headRow(k, title: wholeTitle.fixedSize(), pct: pct)`,
    expect: ['hd'],
  },
  {
    id: 'M57 全台留下的「車站收集」用副標字級（不是標題字級）——考「標題字級」',
    file: 'CollectionCard.swift',
    find: '            id: "subtitle", text: name, content: Text(name).font(scopeFont), minScale: 0.75, reportIdeal: true)',
    replace: '            id: "subtitle", text: name, content: Text(name).font(appFont), minScale: 0.75, reportIdeal: true)',
    expect: ['hd'],
    langs: ['en'],
  },
  {
    id: 'M58 只剩的名稱靠右（不是靠左）',
    file: 'CollectionCard.swift',
    find: '            (f.isAll ? soleApp : scope).frame(maxWidth: .infinity, alignment: .leading)',
    replace: '            (f.isAll ? soleApp : scope).frame(maxWidth: .infinity, alignment: .trailing)',
    expect: ['hd'],
  },
  {
    id: 'M59 量測用的標題列 overlay 與真正畫的脫鉤（範圍名字級不同）——考「放得下」的門檻要綁在真實版面上',
    file: 'CollectionCard.swift',
    find: '                    Text(f.title).font(scopeFont).background(CollectionReporter(id: "header.scope#ideal")),',
    replace: '                    Text(f.title).font(appFont).background(CollectionReporter(id: "header.scope#ideal")),',
    expect: ['hd'],
  },
  // 以下兩個改的是目錄（--lang en｜ja 才有）：gate 的 tr() 與 Swift 的 shim 讀同一份壞目錄，考的是 c 閘門對「目錄本身」的防線。
  {
    id: 'M37 目錄少了一個 key（Swift 端會默默退回繁中）',
    catalog: t => { delete t['還有 {n} 座']; return t; },
    expect: ['c'],
  },
  {
    id: 'M38 譯文掉了佔位符（「{n} to go」變成固定字）',
    catalog: t => { t['還有 {n} 座'] = t['還有 {n} 座'].replace(/\{n\}/g, '多'); return t; },
    expect: ['c'],
  },
];

/**
 * --lang：複本裡的 RailNativeL10n 改讀生成的目錄 JSON（裸 swiftc 沒有 lproj 可查）；真檔不動。
 * 錨點必須在 RailNativeL10n.swift 恰好出現 1 次。stageSource 在 LANG 時自動套，所以突變測試也能跑 en／ja。
 */
function applyL10nShim(dest) {
  const f = join(dest, 'RailNativeL10n.swift');
  const text = readFileSync(f, 'utf8');
  const anchor = 'var result = bundle.localizedString(forKey: key, value: key, table: nil)';
  if (text.split(anchor).length !== 2) throw new Error('RailNativeL10n.text 的錨點不是恰好 1 次');
  writeFileSync(f, text.replace(anchor, `var result = Self.shimTable[key] ?? key`).replace('static func text(', `static let shimTable: [String: String] = {
      let env = ProcessInfo.processInfo.environment
      guard let path = env["RAIL_L10N_JSON"], let lang = env["RAIL_L10N_LANG"],
            let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
            let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let table = (root["languages"] as? [String: Any])?[lang] as? [String: String] else { return [:] }
      return table
  }()

  static func text(`));
}

function stageSource(dest, mutation) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const f of ['CollectionCard.swift', 'CollectionOutlineData.swift', 'CollectionWidget.swift', 'RailWidgetKit.swift', 'RailNativeL10n.swift', 'RailBoardWidget.swift']) {
    cpSync(join(realSrc, f), join(dest, f));
  }
  for (const f of ['RailMetroWaitPlugin.swift', 'CollectCheckinIntent.swift']) cpSync(join(appSrc, f), join(dest, f));
  if (LANG) applyL10nShim(dest);
  if (mutation) {
    // 單處突變寫 file／find／replace；要同時改好幾處才成立的突變（例如「可點範圍縮到鈕本身」得動兩個呼叫端）寫 edits 陣列。
    for (const e of mutation.edits ?? [mutation]) {
      const path = join(dest, e.file);
      const text = readFileSync(path, 'utf8');
      const hits = text.split(e.find).length - 1;
      if (hits !== 1) throw new Error(`突變「${mutation.id}」的錨點在原始碼裡出現 ${hits} 次（要恰好 1 次）：${e.find}`);
      writeFileSync(path, text.replace(e.find, () => e.replace));
    }
  }
}

/**
 * 說明中心（index.html 的 widgets[].img）三張預覽圖的來源：本腳本出貨路徑的 PNG，淺色小卡、淺色中卡、深色著色鎖屏矩形
 * （都是 430pt 機型、內建示意資料）。尺寸沿用原檔——說明頁的版面不因此動。
 */
const HELP_PREVIEWS = [
  { file: 'collect-small.webp', shot: 'small-sample-light-430', w: 480, h: 480 },
  { file: 'collect-medium.webp', shot: 'medium-sample-light-430', w: 720, h: 337 },
  { file: 'collect-rect.webp', shot: 'rect-sample-dark-tinted-430', w: 480, h: 216 },
];
const HELP_PREVIEW_MAX_BYTES = 28 * 1024; // 守門人上限 30 KB／檔，留 2 KB 餘裕

/** 從 shotsDir 的出貨 PNG 重生三張 webp 到 destDir；回傳每張的 { file, bytes, quality }。 */
async function emitHelpPreviews(shotsDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  const made = [];
  for (const p of HELP_PREVIEWS) {
    let picked = null;
    for (const quality of [92, 88, 84, 80, 76, 72, 68, 64]) {
      const buf = await sharp(join(shotsDir, `${p.shot}.png`)).resize(p.w, p.h, { fit: 'fill' })
        .webp({ quality, effort: 6, smartSubsample: true }).toBuffer();
      if (buf.length <= HELP_PREVIEW_MAX_BYTES) { picked = { buf, quality }; break; }
    }
    if (!picked) throw new Error(`${p.file}：品質降到 64 仍 >${HELP_PREVIEW_MAX_BYTES} 位元組`);
    writeFileSync(join(destDir, p.file), picked.buf);
    made.push({ file: p.file, bytes: picked.buf.length, quality: picked.quality, from: p.shot });
  }
  return made;
}

function summarize(counts) {
  return GATES.map(g => `${g} ${counts[g].pass}/${counts[g].pass + counts[g].fail}`).join('  ');
}

async function main() {
  if (flag('--emit-preview')) {
    // 把本腳本的樣本（CollectionWidgetPreview.json＋RECENT_BY_SYS 合成的每系統最近蓋章）寫回 CollectionWidgetPreview.json，
    // 讓「小工具圖庫預覽看到的資料」與「閘門驗過的資料」是同一份；judge 的 c 閘門會比對兩者。
    if (LANG) throw new Error('--emit-preview 不能和 --lang 併用');
    writeFileSync(resolve(opt('--emit-preview')), JSON.stringify(sample));
    console.log(`已寫出 ${resolve(opt('--emit-preview'))}`);
    return;
  }
  mkdirSync(outRoot, { recursive: true });
  if (flag('--mutation-test')) {
    const report = [];
    const control = async label => {
      const dest = join(outRoot, 'mut-src-control');
      stageSource(dest, null);
      const run = runHarness({ src: dest, out: join(outRoot, `mut-${label}`), quick: true });
      const { fails, counts } = await judge({ ...run, specs: run.cases, out: join(outRoot, `mut-${label}`), src: dest });
      report.push({ id: `控制組（${label}）`, red: fails.length ? [...new Set(fails.map(f => f.gate))] : [], ok: fails.length === 0, summary: summarize(counts), sample: fails.slice(0, 3) });
      return fails.length === 0;
    };
    let allOk = await control('before');
    const only = opt('--only')?.split(',');
    for (const m of MUTATIONS.filter(x => (!only || only.includes(x.id.split(' ')[0])) && (!x.catalog || LANG) && (!x.langs || x.langs.includes(LANG ?? 'zh')))) {
      const dest = join(outRoot, 'mut-src');
      stageSource(dest, m.catalog ? null : m);
      const out = join(outRoot, `mut-${m.id.split(' ')[0]}`);
      const savedTable = L10N_TABLE;
      let l10nJson = L10N_JSON;
      if (m.catalog) { // 目錄突變：gate 與 Swift 端讀同一份改壞的表
        L10N_TABLE = m.catalog(structuredClone(savedTable));
        l10nJson = join(outRoot, `${m.id.split(' ')[0]}-l10n.json`);
        writeFileSync(l10nJson, JSON.stringify({ languages: { [LANG]: L10N_TABLE } }));
      }
      const run = runHarness({ src: dest, out, quick: true, l10nJson });
      const { fails, counts } = await judge({ ...run, specs: run.cases, out, src: dest });
      L10N_TABLE = savedTable;
      const red = [...new Set(fails.map(f => f.gate))];
      const detected = m.expect.every(g => red.includes(g));
      allOk = allOk && detected;
      report.push({ id: m.id, expect: m.expect, red, ok: detected, summary: summarize(counts), sample: fails.filter(f => m.expect.includes(f.gate)).slice(0, 2) });
    }
    allOk = (await control('after')) && allOk;
    for (const r of report) {
      console.log(`${r.ok ? '✓' : '✗'} ${r.id}${r.expect ? `（要紅 ${r.expect.join('、')}）` : '（要全綠）'} → 紅的閘門：${r.red.length ? r.red.join('、') : '無'}`);
      console.log(`    ${r.summary}`);
      for (const s of r.sample ?? []) console.log(`    · [${s.gate}] ${s.name}：${s.detail}`);
    }
    writeFileSync(join(outRoot, 'mutation-report.json'), JSON.stringify(report, null, 2));
    console.log(allOk ? '\n突變測試通過：每個突變都被指名的閘門抓到，控制組（前後）全綠。' : '\n突變測試失敗。');
    process.exit(allOk ? 0 : 1);
  }

  let src = resolve(opt('--src') ?? realSrc);
  if (LANG) {
    // 英日文：複本裡的 RailNativeL10n 改讀生成的目錄 JSON（裸 swiftc 沒有 lproj 可查）；真檔不動。shim 由 stageSource 套。
    const dest = `${outRoot}-src`; // 不放進 outRoot：runHarness 開頭會清空它
    stageSource(dest, null);
    src = dest;
  }
  for (const f of ['CollectionCard.swift', 'CollectionOutlineData.swift', 'RailWidgetKit.swift', 'RailNativeL10n.swift', 'RailBoardWidget.swift']) {
    if (!existsSync(join(src, f))) throw new Error(`找不到 ${join(src, f)}`);
  }
  const run = runHarness({ src, out: outRoot, quick: flag('--quick') });
  const judged = await judge({ ...run, specs: run.cases, out: outRoot, src });
  const counts = judged.counts;
  const fails = judged.fails;
  writeFileSync(join(outRoot, 'gates.json'), JSON.stringify({ counts, fails, lang: LANG ?? 'zh-TW' }, null, 2));
  if (!flag('--quick')) {
    console.log('拼圖：', (await contactSheets(outRoot)).join('\n      '));
  }
  console.log(`\n${run.cases.length} 個案例　${summarize(counts)}`);
  if (fails.length) {
    const shown = new Map();
    for (const f of fails) { const k = f.gate; shown.set(k, (shown.get(k) ?? 0) + 1); }
    console.error(`\n閘門紅 ${fails.length} 條（${[...shown].map(([g, c]) => `${g}×${c}`).join('、')}）：`);
    for (const f of fails.slice(0, 40)) console.error(` ✗ [${f.gate}] ${f.name}：${f.detail}`);
    process.exit(1);
  }
  console.log('閘門全綠。');
  if (opt('--emit-help-previews')) {
    if (LANG) throw new Error('--emit-help-previews 不能和 --lang 併用（說明中心預覽圖是繁中版）');
    for (const m of await emitHelpPreviews(join(outRoot, 'shots'), resolve(opt('--emit-help-previews')))) {
      console.log(`已重生 ${m.file}：${(m.bytes / 1024).toFixed(1)} KB（webp 品質 ${m.quality}，來源 ${m.from}.png）`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
