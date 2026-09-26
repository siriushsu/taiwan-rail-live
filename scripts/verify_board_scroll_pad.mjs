#!/usr/bin/env node
// .board 家族面板的 sticky 固定段讓位守門(2026-09-25,v0925n)。
//
// 瀏覽器自己把內容捲進來時(Tab／Shift+Tab 聚焦、scrollIntoView)不認 sticky 標題。index.html 的
// syncBoardScrollPad 量整疊固定段(h3;橫式合併卡另有站名牌與分頁列)的底緣寫進 --board-scroll-pad,
// CSS 拿它給內容當 scroll-margin-top;WebKit 聚焦文字欄位不看 scroll-margin,由 boardRevealField 補捲。
// 只有真瀏覽器量得到,兩個引擎各跑一輪:
//   W 鍵盤往回走(Shift+Tab;WebKit 要 Option+Shift+Tab 才走得到按鈕):焦點中心落在固定段上的拍數＝0。
//     360 直式標準／特大字級(特大另走直式合併卡:分頁列在直式是一般內容,要讓位)、844×390 橫式合併卡;
//     走過的內容拍數要夠多,否則是沒走到的假綠。直式合併卡另外直接把分頁鈕捲成半露再往回走進去(tabsPeek):
//     整份往回走碰不碰得到半露看當天資料,碰不到時拿掉讓位也不會紅(2026-09-26 多一列活動就假綠、擋下 ship-web)。
//   J 面板捲到下面時把焦點放進標題裡的 ×(＝選單關掉時 opener.focus()、從面板外 Tab 進來):捲動量 ≤ 8px。
//     容器 scroll-padding-top 那種寫法會跳 128–130px(v0925k 的護照就是那樣上線的)。
//   F 文字欄位(軌道面板 #rdSearch)被蓋住時聚焦:下一拍之後不再被蓋,半秒後也沒被捲回去。
//   P 讓位值＝捲到中段時實際卡住的固定段底緣(差 ≤ 1px):站名牌出現／消失之後(syncBoardHeadVar 尾端那一刀)、
//     護照重繪換掉 h3 再換字級之後(MutationObserver 重掛)。換字級走設定面板的真入口 state._setFontScale。
//   N 正向對照,要紅才算數:拿掉讓位 ⇒ W 紅;分頁列的排除規則移出側欄 media 段 ⇒ 直式合併卡半露那格紅;
//     改回容器 scroll-padding ⇒ J 紅(兩個引擎都做——WebKit 的聚焦捲動是非同步的,要證明等得夠久);
//     拿掉 boardRevealField ⇒ F 紅(只做 WebKit:Chromium 聚焦文字欄位本來就看 scroll-margin);
//     拿掉那一刀／拿掉重掛 ⇒ P 紅(只做 Chromium)。
//   三張清單面板(今日台鐵動態、公車站牌、行程分享;v0926e 起列可聚焦,假資料由本機伺服器的 /api 供應):
//     W 每一列都可聚焦、往回走過每一列而且零拍被蓋(360 標準／特大、844×390 三種版面都走);
//     E 從標題的 × 用鍵盤走進第一列,Enter 做的事跟點一下一樣(今日動態展開逐站、焦點留在那一列,再按一次收合;
//     行程分享拿那一站分享)。空白鍵照全站慣例只做播放／暫停(v0926h,使用者裁示「空白鍵的功能還是改回一致比較好」):
//     在列上按,列不動、播放只切一次、焦點留在那一列;按住連發也只切一次;按鈕(×)上按不會把它按下去、焦點不掉回頁面;
//     資料狀態徽章與捷運膠囊卡 Enter 才開、空白鍵只切播放(原本兩件事一起做);
//     C 滑鼠點公車列再按鍵,焦點不留在列上、不亮框(點列跟改版前一樣;在 1280 桌面量,Chromium 手機模擬點一下不給焦點、量不到);
//     R 公車站牌重抓後焦點留在同一列,焦點列被捲出畫面時也不把清單捲回去。
//     N:拿掉兩張的鍵盤接線 ⇒ E 紅;重畫後不放回焦點 ⇒ E、R 紅;放回焦點不帶 preventScroll ⇒ R 紅;列也接空白鍵(v0926e 的寫法)⇒
//     空白鍵那格紅;連發也切播放 ⇒ 按住那格紅;空白鍵把按鈕 blur 掉(v0718i 的寫法)⇒ 按鈕那格紅;徽章、膠囊也接空白鍵 ⇒ 各自那格紅;
//     拿掉公車列的點擊放焦點 ⇒ C 紅;列拿掉 tabindex ⇒ W 紅;拿掉讓位 ⇒ 今日動態 W 紅。兩個引擎都做。
//   V 焦點框看得到(v0926h):往前走(Tab)每一拍的焦點框四邊都沒被捲動容器或卡片裁掉、有框、框色對底下那一層 ≥ 3:1。
//     360 臺北看板(標題 44×44 的 ×／☆ 貼齊面板右上角、公車轉乘主鈕、「全部班次」鈕)、今日動態(列貼齊面板底緣)、字級面板
//     (.seg 分段鈕)、暗色主題臺北看板;1280 臺北看板與今日動態、暗色主題臺北看板(標題鈕 44×44 貼齊右緣、方向鈕在橫向捲動盒裡)。
//     每格都要走過點名的元素。N:每條修法各突變一次——標題鈕框改回往外畫／改回紅色、主鈕改回往外畫／紅色、「全部班次」改回
//     var(--focus)、底部讓位預設改回 0、分段鈕改回往外畫、選中分段鈕改回紅色、暗色標題鈕改回往外畫、暗色方向鈕捲動盒拿掉左右留邊,
//     各自那格都要紅,而且要紅在被點名的那顆、那一種(badHas)。
// 2026-09-26 補量的格子(各自一段,在上面三段之後):
//   B 往前走(Tab;WebKit 要 Option+Tab):直式合併卡「這班車」sheet 小段,焦點中心不落在釘在卡緣(sticky bottom:0)的
//     「詳細・往上拉看完整資料」提示列(.uni-more)上;標準與特大字級。修前兩個引擎 1–2 拍整顆停在它底下。
//     配套:它自己釘著時聚焦它內容不跳(J);底部讓位＝它實際佔掉的下緣(P,小段→中段→小段、換字級之後)。
//   平交道卡家族(.xing-card:平交道、落釘、台糖、附近車站)的卡頭 .xc-head、列車 sheet 的 .tc-head、車庫頂列 .g-top:
//     J 捲在下面時聚焦標題的鈕內容不跳(360 直式與 844×390 橫式,捲得動的才量);W 附近車站卡在 App(?demo=bounty
//     開出「蓋章」鈕)往回走不被卡頭蓋;車庫 W 看焦點「上緣」(車卡比讓位高,中心判準對它恆綠),P 讓位＝頂列實高＋15
//     (模擬瀏海把頂列撐高之後也要跟上)。S 平交道卡、台糖卡標題以外沒有可聚焦元素＝W 零資訊的前提,出現了就要改成真的量
//     (落釘卡、附近車站卡的列 v0926j 起可聚焦,已改成真的走,見下一段)。
//   N 每格都有對照:拿掉底部讓位 ⇒ B 紅;提示列自己也給 scroll-margin-bottom ⇒ 它的 J 紅;讓位寫死成標準字級的值 ⇒
//     特大字級 P 紅(只做 Chromium);容器 scroll-padding-top(車庫修前就是這樣,跳 201–390px)⇒ 各卡 J 紅;
//     拿掉卡內讓位 ⇒ 附近車站／車庫 W 紅;車庫讓位寫死成修前的 84px ⇒ 頂列變高後 P 紅;列可聚焦 ⇒ S 紅。
// 鍵盤焦點四件(2026-09-26,v0926i;修前四件的焦點都掉回頁首 body),在最後一段(360 直式與 1280 桌面各開一次、模擬暫停):
//   R 看板重畫:焦點停在臺北看板每一顆可聚焦元素上主動呼叫 renderBoard(),亮、暗兩色(暗色多了沒有 id／class／data 的方向鈕與
//     下一班大字卡);360 另走直式合併卡「這一站」「這班車」兩頁,renderBoard()／mountUniCard() 都叫。焦點要回到同一顆(或換掉之後
//     等價的那一顆)、亮框、捲動不動,而且每格要走過點名的區(標題列、方向鈕、分頁列、搬進來的跟車卡);分頁鈕用鍵盤 Enter 真按,
//     焦點留在新的那顆分頁鈕上。
//   O 關面板:12 張面板從真入口用鍵盤打開(入口不是鍵盤走得到的——公車站牌列、誤點履歷連結、合併卡——直接叫開函式),焦點放到 ×
//     按 Enter 關,焦點回到開它的鈕、亮框;開它的鈕看不到時回到面板固定的入口(手機的軌道與路線、字級回「觀看設定」鈕,看板、
//     公車站牌回「查詢」分頁,誤點履歷回跟車卡第一顆鈕)。另外直接造三個狀態:開它的鈕不是固定入口(焦點在護照鈕上叫開我的最愛)、
//     合併卡「這班車」裡按行程分享(看板收起、跟車卡搬回原位時焦點留在那顆鈕上)、焦點在文字欄位時關(不送,觸控點進文字欄位也亮框)。
//     行程分享列 Enter 分享後面板收起、焦點回到「行程分享」鈕(第 3 件)。C 1280 滑鼠點 × 關:不送(只接鍵盤焦點)。
//   捷運膠囊(第 4 件)在 360 標準字級段的 E 格:Enter 展開焦點落在卡的 ×、× 按 Enter 收起落在膠囊,兩下都亮框。
//   N 逐層突變,各自那格要紅:renderBoard／mountUniCard 不放回、無鍵的鈕不用父層 class 當鍵(紅在方向鈕、標題列不紅)、關面板不放回
//     (我的最愛、行程分享列)、固定入口清空(軌道與路線)、開面板不記開它的鈕(從護照鈕開的那格)、搬出面板的那顆不算(合併卡行程分享)、
//     文字欄位也送、滑鼠點的也送(只做 Chromium:WebKit 點按鈕不給焦點)、膠囊切換不放回(膠囊兩格)。
// v0926j 平交道卡、落釘卡、附近車站卡(xp* 那幾支):修前兩張卡每一模擬秒整張 innerHTML 重寫(附近車站卡在 App 定位更新時也是),
//   鍵盤停在卡頭 ✕／存 上每次重畫都被踢回 body(兩個引擎、360／844×390／1280 全部);滑鼠按下後、放開前碰上重畫,按下的節點
//   被換掉,兩個引擎都不送 click;落釘卡的班次列、附近車站卡的站只接滑鼠。修法:卡頭沒變就不換、清單換完把鍵盤焦點放回
//   同一顆(不捲動);落釘卡按住時先不重畫;定時重畫改成滿 1 真實秒一次(修前 60× 每真實秒 40–48 次)。
//   K 鍵盤停在卡頭的鈕／清單的列上(真的按 Tab 走過去,亮框),重畫兩次:每一幀焦點都在同一顆、最後還亮框、捲動沒動
//     (844×390 平交道卡 ✕、落釘卡 存／✕／第 3 班;360 附近車站卡第 3 站;1280 落釘卡在「已存」按 Enter 取消收藏、卡頭整張換之後)。
//   R 焦點列被捲出卡片可見範圍再重畫:捲動不動、焦點還在(844×390 落釘卡、360 附近車站卡)。
//   W 往回走過每一列不被卡頭蓋、E 第 2 列 Enter＝點一下(跟那班車／開那站看板)、空白鍵只切一次播放(844×390 落釘卡、360 附近車站卡)。
//     (當時 844×390 落釘卡可見內容只剩 17.5px、一列 27px,Chromium 會把列停在卡頭下 9–10px——卡太矮,不是讓位錯;
//     v0926l 卡改坐側欄、放得下全部列,這幾格改在 SHORT_CARD 壓成捲得動的卡上量,見 v0926l 那段。)
//   C 1280 滑鼠:平交道卡 ✕ 按住到碰上一次重畫再放開,卡照樣關;落釘卡第 1 班按住 1.3 秒再放開,照樣跟車、按住期間沒重畫。
//   Q 1280 60× 放 3 秒:平交道卡、落釘卡各重畫 2–4 次。
//   V 360 落釘卡、附近車站卡往前走:列的框不被卡片切、有框、列的框對比 ≥ 3。卡頭 ✕／存 在亮色只有 1.9:1(修前就有,另案),
//     這格不看卡頭的對比。844×390 落釘卡修前的列框一定被切(可見內容比一列矮),v0926l 起不再比一列矮(V 只在 360 量)。
//   N 對照:重畫後不放回焦點 ⇒ 列的 K、取消收藏那格紅;放回焦點不帶 preventScroll ⇒ R 紅;卡頭有兩道(沒變就不換、換了也放回),
//     兩道一起拿掉 ⇒ 卡頭 ✕ 的 K 紅;卡頭每次整張換(照樣放回焦點)⇒ C 平交道 ✕ 紅;按住照樣重畫 ⇒ C 落釘卡紅;
//     節拍改回模擬秒差 ⇒ Q 紅(只做 Chromium);拿掉 Enter 接線 ⇒ E 紅;拿掉卡內讓位 ⇒ W 紅;
//     拿掉附近車站卡列的底部讓位 ⇒ 站名框的下緣被切(V 紅);落釘卡的列框改回往外畫 ⇒ 左右被切(V 紅)。
//     落釘卡的列刻意不給底部讓位:844×390 可見內容比一列矮,多留 6px 會讓 Chromium 往回走把列壓進卡頭 16px(W 紅,2026-09-26 實測)。
//     (v0926l 起那張卡放得下全部列,這個理由不在了;列框往內畫,不留也不會被切,V 360 那格盯著。)
// v0926l 矮橫式(高 ≤ 500)的平交道卡、落釘卡、台糖卡改坐側欄槽位(使用者裁示方案 A)。修前照直式的 top 191／max-height 100%−313:
//   844×390 卡高 73、卡頭吃掉 42–56,落釘卡一列都看不到;667×375 三張全是零列。
//   L 剛打開時卡頭以下放得下第一列(台糖卡是說明文字第一行;列高、行高當場量,不寫死):844×390、667×375 標準與特大字級。
//     另外:右側 59px 瀏海時卡的右緣不進安全區(844×390);內容撐到最高的台糖卡不蓋版權列、速度膠囊與特大字級提示卡讓開側欄
//     (667×375 特大);直式 360 照舊(上緣在頂列之下)。
//   N 把修法那幾條從樣式表拿掉再量(不是另寫一份修前的值去蓋)⇒ L 紅(844×390 只有落釘卡紅——修前平交道卡還露一列、
//     台糖卡一行;667×375 三張都紅)、瀏海那格紅;只拿掉 --rail-occupy 那條 ⇒ 速度膠囊壓到卡;下緣改用 sheet 家族那條 ⇒
//     蓋到版權列;槽位的上錨漏進直式 ⇒ 直式那格紅。
//   修好之後三張卡在橫式不捲了:844×390 的 J／K／R／W 考的是捲得動的卡裡的讓位與重畫放回焦點(JS 行為),改用 SHORT_CARD
//   (測試專用樣式,max-height 100px)把卡壓回捲得動再量;前提由各格自己把關(可捲 ≥ 40、第 1 班真的捲出可見範圍、走過每一列)。
// 量法本身的坑:看板每 20 秒、平交道卡與落釘卡每一模擬秒整張重寫,修前焦點會被洗回 body(看板 v0926i、兩張卡 v0926j 起會放回焦點)。
// W 走到一半掉焦點的那輪重走、J 聚焦前才抓鈕並事後確認焦點還在(見 JUMP 上面的註解),兩道都保留當保險。
// 慣例照 verify_transfer_collapse.mjs:自帶 node:http 靜態伺服器(埠號由系統挑)、語系與時鐘釘死、關首訪教學卡、
// 掛 pageerror、T0 身分自檢。瀏覽器一律無視窗。約 9–11 分鐘(2026-09-26 補直式合併卡與兩個突變後實測 126s;
// 同日補三張清單面板後 158s,機器負載約 32;再補按住空白鍵、桌面點擊、重抓的格子與突變後 175s,負載約 18;
// 再補合併卡底部提示列、平交道卡家族、車庫各格後 322s,264 條,負載約 13–22;v0926h 補空白鍵 E 各格與焦點框 V 各格後
// 339s,320 條,負載約 8–12,同時另有一支量測在跑;v0926i 鍵盤焦點四件、v0926j 平交道卡與落釘卡各格併在一起後 512s,
// 511 條,負載約 2–5;v0926l 矮橫式三張卡的 L／N 各格後 674s,563 條,負載約 14–30,同時另有兩支 verify_landscape 全套在跑)。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
// 三張清單面板(今日台鐵動態、公車站牌、行程分享)的假資料:/api 一律回 {} 的話今日動態與公車站牌都是空的,量不到列。
// 筆數刻意比手機 sheet 放得下的多,往回走才會捲、才考得到標題會不會蓋住列。
const API_FIX = {
  '/api/today-board': () => ({ trains: Array.from({ length: 30 }, (_, i) => ({ no: String(101 + i * 11), delay: i % 7, delayMax: (i % 7) + (i % 3),
    sta: '1000', status: i % 3, at: `2026-09-26T09:${String(10 + i).padStart(2, '0')}:00+08:00` })) }),
  '/api/station-events': () => ({ events: Array.from({ length: 6 }, (_, i) => ({ at: `2026-09-26T08:${String(10 + i * 5).padStart(2, '0')}:00+08:00`,
    sta: '1000', status: 1, delay: i, delayMax: i + 1 })) }),
  '/api/bus-stop-live': () => ({ stop: { position: { lat: 25.0478, lon: 121.517 } }, source: { attribution: 'TDX', snapshotAt: new Date().toISOString() },
    routes: Array.from({ length: 16 }, (_, i) => ({ routeId: 'R' + i, routeName: String(200 + i * 7), direction: i % 2,
      arrivals: [{ live: { state: 'countdown', etaSec: 60 * (i + 1) } }, { live: { state: 'countdown', etaSec: 60 * (i + 12) } }] })) }),
};
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    if (API_FIX[url.pathname]) return res.end(JSON.stringify(API_FIX[url.pathname]()));
    return res.end('{}');
  }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(Number(process.env.PORT || 0), '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// ── T0 目標自檢:先證明「我在驗誰」 ──────────────────────────────────────────
const idxSrc = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const md5 = createHash('md5').update(idxSrc).digest('hex').slice(0, 12);
const localBuild = (idxSrc.match(/const BUILD = '([^']*)'/) || [])[1] || '?';
console.log(`\n目標: ${path.join(ROOT, 'index.html')}\n      md5=${md5}  BUILD=${localBuild}\n`);

// 頁內工具:固定段、可聚焦元素、焦點是否被蓋、讓位值與實際卡住的底緣
const HELPERS = `window.__bsp = (() => {
  const heads = p => [...p.children].filter(n => n.matches('h3, .dwell-plate, .uni-tabs') && getComputedStyle(n).position === 'sticky' && n.getBoundingClientRect().height > 0);
  const desc = e => e ? e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/)[0] : '') : null;
  const tabbables = p => [...p.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex], [contenteditable="true"]')]
    .filter(e => !e.disabled && e.tabIndex >= 0 && !e.closest('[hidden], [inert]') && getComputedStyle(e).visibility !== 'hidden' && e.getClientRects().length > 0);
  const measure = id => {
    const p = document.getElementById(id), a = document.activeElement;
    if (!p || p.hidden || !a || a === p || !p.contains(a)) return { left: true, lost: !a || a === document.body };
    const hs = heads(p), inHead = hs.some(h => h.contains(a));
    const r = a.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const covered = !inHead && hs.some(h => hit && h.contains(hit));
    return { inHead, covered, el: desc(a), over: hs.length ? +(Math.max(...hs.map(h => h.getBoundingClientRect().bottom)) - r.top).toFixed(1) : 0 };
  };
  const padOf = p => parseFloat(p.style.getPropertyValue('--board-scroll-pad')) || 0;
  // 捲到中段量實際卡住的固定段底緣(＋最下面那段的下邊界),量完捲回原位
  const stuck = id => {
    const bd = document.getElementById(id);
    const st0 = bd.scrollTop, max = bd.scrollHeight - bd.clientHeight;
    bd.scrollTop = Math.floor(max / 2);
    const hs = heads(bd), base = bd.getBoundingClientRect().top + bd.clientTop;
    let bottom = 0;
    for (const h of hs) bottom = Math.max(bottom, h.getBoundingClientRect().bottom - base + (parseFloat(getComputedStyle(h).marginBottom) || 0));
    bd.scrollTop = st0;
    return { pad: padOf(bd), stuck: +bottom.toFixed(1), max, n: hs.length };
  };
  return { heads, desc, tabbables, measure, padOf, stuck };
})();`;

// V:焦點框看不看得到(2026-09-26,v0926h)。沿框的厚度在四邊中線上各取 16 點:落在捲動容器／卡片的可見區外(overflow 裁切,
// 一路往上找到 body)、或被不含它的 sticky 固定段蓋住就算看不到,一邊看不到超過 0.5px 算被切。
// 對比:框色對框底下那一層的底色——往內畫(offset < 0)看元素自己、往外畫看父層,取第一個不透明度 ≥ .5 的底色;< 3 算太淡
// (藏青標題上的全域紅框量到約 1.9)。只算焦點框亮起(:focus-visible)的拍。
const RING_INIT = () => {
  const rgba = s => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
  const lum = c => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  window.__bspRing = id => {
    const p = document.getElementById(id), a = document.activeElement;
    if (!p || p.hidden || !a || a === p || !p.contains(a)) return { left: true, lost: !a || a === document.body };
    let fv = false; try { fv = a.matches(':focus-visible'); } catch (e) {}
    const cs = getComputedStyle(a);
    const w = cs.outlineStyle === 'none' ? 0 : (parseFloat(cs.outlineWidth) || 0), off = parseFloat(cs.outlineOffset) || 0;
    const hs = __bsp.heads(p), hi = hs.findIndex(h => h.contains(a)), cover = (hi < 0 ? hs : hs.slice(hi + 1)).map(h => h.getBoundingClientRect());
    const res = { el: __bsp.desc(a), fv, w, off, cut: [], contrast: null };
    if (!w) return res;
    const r = a.getBoundingClientRect(), c = { l: 0, t: 0, r: innerWidth, b: innerHeight };
    for (let n = a.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n), cx = s.overflowX !== 'visible', cy = s.overflowY !== 'visible';
      if (!cx && !cy) continue;
      const nr = n.getBoundingClientRect(), L = nr.left + n.clientLeft, T = nr.top + n.clientTop;
      if (cx) { c.l = Math.max(c.l, L); c.r = Math.min(c.r, L + n.clientWidth); }
      if (cy) { c.t = Math.max(c.t, T); c.b = Math.min(c.b, T + n.clientHeight); }
    }
    const e = off + w, mx = (r.left + r.right) / 2, my = (r.top + r.bottom) / 2, N = 16;
    const band = (axis, a0, a1, at) => {
      let seen = 0;
      for (let i = 0; i < N; i++) {
        const v = a0 + (a1 - a0) * (i + 0.5) / N, x = axis === 'y' ? at : v, y = axis === 'y' ? v : at;
        if (x < c.l || x > c.r || y < c.t || y > c.b) continue;
        if (cover.some(h => x >= h.left && x <= h.right && y >= h.top && y <= h.bottom)) continue;
        seen++;
      }
      return w * seen / N;
    };
    const vis = { t: band('y', r.top - e, r.top - off, mx), b: band('y', r.bottom + off, r.bottom + e, mx),
      l: band('x', r.left - e, r.left - off, my), r: band('x', r.right + off, r.right + e, my) };
    res.cut = Object.keys(vis).filter(k => w - vis[k] > 0.5);
    let bg = null;
    for (let n = off < 0 ? a : a.parentElement; n; n = n.parentElement) { const b = rgba(getComputedStyle(n).backgroundColor); if (b && b.a >= 0.5) { bg = b; break; } }
    const oc = rgba(cs.outlineColor);
    if (bg && oc) res.contrast = +ratio(oc, bg).toFixed(2);
    return res;
  };
};

const OPEN = {
  favPanel: `(() => {
    const stns = [['臺北', 25.0478, 121.517], ['板橋', 25.0143, 121.4637], ['桃園', 24.9892, 121.3136], ['新竹', 24.8016, 120.9716], ['臺中', 24.1372, 120.6869],
      ['彰化', 24.0817, 120.5386], ['嘉義', 23.4791, 120.4411], ['臺南', 22.9971, 120.2126], ['高雄', 22.6394, 120.3025], ['花蓮', 23.9929, 121.6011]];
    userDataSaveCollection('stations', stns.map(([name, lat, lon]) => ({ name, lat, lon, sys: 'tra_sched', label: '台鐵' })));
    saveFavs(state.trains.filter(t => t.sys === 'tra_sched').slice(0, 10).map(t => ({ train: String(t.train), sys: 'tra_sched' })));
    savePins(Array.from({ length: 6 }, (_, i) => ({ lat: 25.0 + i * 0.01, lon: 121.5 + i * 0.01, label: '地點' + (i + 1) })));
    openFavPanel();
  })()`,
  board: `openBoard({ name: '臺北', sys: 'tra_sched', lat: 25.0478, lon: 121.517 })`,
  trackPanel: `openTrackPanel()`,
  searchPanel: `openSearchPanel({ user: true })`,
  ridePanel: `openRidePanel()`,
  // 跟車中打開車站看板＝合併卡(橫式時 h3 下還有 sticky 的站名牌與分頁列)
  // 挑已發車、沒在停站、下一站至少 3 分鐘後才到的車:收牌那一格才不會被停靠牌(跟車迴圈自己亮的)混進來
  uni: `(async () => {
    const cands = state.trains.filter(t => t.sys === 'tra_sched' && t.stops && t.stops.length > 20);
    const tr = cands.find(t => {
      const tt = effTLive(t), info = nextStopInfo(t, tt);
      return tt >= t.stops[0].depSec && !dwellInfoOf(t, tt) && info && info.min >= 3;
    }) || cands[0];
    followTrainNo(String(tr.train), { sys: 'tra_sched' });
    await new Promise(r => setTimeout(r, 400));
    openBoard({ name: '臺北', sys: 'tra_sched', lat: 25.0478, lon: 121.517 });
    await new Promise(r => setTimeout(r, 300));
  })()`,
};
const ELEM = { favPanel: 'favPanel', board: 'board', trackPanel: 'trackPanel', searchPanel: 'searchPanel', ridePanel: 'ridePanel', uni: 'board' };
const CLOSE_ALL = `(() => {
  for (const f of ['closeBoard', 'closeFavPanel', 'closeRidePanel', 'closeExplorePanel', 'closeTrackPanel', 'closeTodayPanel', 'closeDelayHist', 'closeFontPanel', 'closeTripSharePanel', 'closeBusStopPanel', 'closeSearchPanel'])
    try { if (typeof window[f] === 'function') window[f](); } catch (e) {}
  try { if (state.followTrain || state.freqFollow) clearFollow(); } catch (e) {}
  try { document.activeElement && document.activeElement.blur(); } catch (e) {}
})()`;
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));

// ── 三張清單面板的列(2026-09-26,v0926e):列是 div,掛 tabindex＋role 之後鍵盤才走得到 ──────────────────
// 修前三張的 W 量到 0 是因為根本沒有可聚焦的列(兩個引擎、360–1280 都只走得到 × 與地圖連結),不是能用。
// 行程分享直接開面板:入口在跟車卡上、要通行證(或 ?tripshare=1),那道閘門不歸這支管。
Object.assign(OPEN, {
  todayPanel: `openTodayPanel()`,
  busStopPanel: `openBusStopPanel({ name: '臺北車站', city: 'Taipei', cityLabel: '臺北市', stationUid: 'TPE0001', position: { lat: 25.0478, lon: 121.517 } })`,
  tripPanel: `(async () => {
    const cands = state.trains.filter(t => t.sys === 'tra_sched' && t.stops && t.stops.length > 20);
    const tr = cands.find(t => effT(t) >= t.stops[0].depSec && tripRemainingStops(t).length >= 12) || cands[0];
    followTrainNo(String(tr.train), { sys: 'tra_sched' });
    await new Promise(r => setTimeout(r, 400));
    openTripSharePanel();
  })()`,
});
Object.assign(ELEM, { todayPanel: 'todayPanel', busStopPanel: 'busStopPanel', tripPanel: 'tripPanel' });
OPEN.fontPanel = `openFontPanel()`; ELEM.fontPanel = 'fontPanel';
const LIST_ROWS = { todayPanel: '.td-row[data-no]', busStopPanel: '.bus-eta-row', tripPanel: '.row[data-dest]' };
const LIST_MIN = { todayPanel: 30, busStopPanel: 16, tripPanel: 12 };      // 假資料的筆數;行程分享看那班車還剩幾站
const HOPS = { todayPanel: 1, busStopPanel: 2, tripPanel: 1 };            // 從標題的 × 往前幾步到第一列(公車站牌中間隔著地圖連結)
const rowCount = ([id, sel]) => { const rs = [...document.getElementById(id).querySelectorAll(sel)]; return { rows: rs.length, focusable: rs.filter(e => e.tabIndex >= 0).length }; };
const ROW_STATE = ([id, sel]) => {
  const p = document.getElementById(id), a = document.activeElement;
  return { open: !!(p && !p.hidden), onRow: !!(p && a && p.contains(a) && a.matches(sel)), key: (a && (a.dataset.no || a.dataset.dest || a.dataset.route)) || null,
    exp: a ? a.getAttribute('aria-expanded') : null, todayOpen: state._todayOpen, playing: state.playing, shared: window.__bspShared ? window.__bspShared.slice() : null };
};
// 跟使用者一樣用鍵盤走進去:焦點先放在標題的 ×,再按 Tab(WebKit 要 Option+Tab)走 hops 步,然後按 key
async function rowPress(page, eng, id, key, hops = HOPS[id]) {
  const sel = LIST_ROWS[id];
  const first = await page.evaluate(([id, sel, i]) => { const r = document.getElementById(id).querySelectorAll(sel)[i]; return r ? (r.dataset.no || r.dataset.dest || r.dataset.route) : null; }, [id, sel, hops - HOPS[id]]);
  await page.evaluate(id => document.querySelector(`#${id} > h3 .close`).focus(), id);
  for (let i = 0; i < hops; i++) await page.keyboard.press(eng === 'webkit' ? 'Alt+Tab' : 'Tab');
  await settle(page);
  const at = await page.evaluate(ROW_STATE, [id, sel]);
  if (key) { await page.keyboard.press(key); await settle(page); await page.waitForTimeout(150); }
  const after = await page.evaluate(ROW_STATE, [id, sel]);
  return { first, at, after };
}
const fmtTd = r => `走到 ${r.at.onRow ? r.at.key : '(不在列上)'}／第一列 ${r.first}；按下後 展開=${r.after.todayOpen} aria-expanded=${r.after.exp} 焦點=${r.after.onRow ? r.after.key : '離開了列'}`;
const tdOk = r => r.at.onRow && r.at.key === r.first && r.after.todayOpen === r.first && r.after.exp === 'true' && r.after.onRow && r.after.key === r.first;
const fmtTp = r => `走到 ${r.at.onRow ? r.at.key : '(不在列上)'}；按下後 面板${r.after.open ? '還開著' : '關了'}、分享了 ${JSON.stringify(r.after.shared)}`;
const tpOk = r => r.at.onRow && !r.after.open && !!r.after.shared && r.after.shared.length === 1 && r.after.shared[0] === r.first;
const STUB_SHARE = () => { window.__bspShared = []; if (!window.__bspShareTrip) window.__bspShareTrip = shareTrip; window.shareTrip = (tr, d) => { window.__bspShared.push(d); }; };
// 公車站牌每 30 秒重畫一次:鍵盤停在第 3 列時重抓,畫完焦點要還在同一列(路線＋方向)、捲動不動。
// away:重抓前先把清單捲到焦點列跑出畫面(使用者拿滾輪／手指捲過)——焦點列還在畫面裡時,放回焦點本來就不會捲,
// 「捲動不動」要在這個情況下才考得到放回時有沒有 preventScroll。WebKit 的聚焦捲動是非同步的,重抓完多等一下才讀。
async function busRefresh(page, away) {
  const b = await page.evaluate(away => {
    const p = document.getElementById('busStopPanel'), a = document.activeElement;
    if (away && a && p.contains(a)) p.scrollTop += a.getBoundingClientRect().bottom - p.getBoundingClientRect().top + 40;
    return { k0: (a && p.contains(a) && a.dataset.route) || null, st0: p.scrollTop };
  }, away);
  await settle(page);
  await page.evaluate(() => refreshBusStopPanel());
  await settle(page); await page.waitForTimeout(200);
  const a = await page.evaluate(() => { const p = document.getElementById('busStopPanel'), a = document.activeElement; return { k1: (a && p.contains(a) && a.dataset.route) || null, st1: p.scrollTop }; });
  return { ...b, ...a };
}
const busOk = r => !!r.k0 && r.k1 === r.k0 && Math.abs(r.st1 - r.st0) <= 1;
const fmtBus = r => `${r.k0}→${r.k1} 捲動 ${Math.round(r.st0)}→${Math.round(r.st1)}`;
// 全站快捷鍵的空白鍵叫的是全域的 togglePlay:換成計數器,數它被叫了幾次(只看最後的播放狀態,偶數次連發會切回原狀、看不出來)
const COUNT_PLAY = () => { window.__bspPlay = 0; if (!window.__bspPlayOrig) { window.__bspPlayOrig = togglePlay; window.togglePlay = function () { window.__bspPlay++; return window.__bspPlayOrig.apply(this, arguments); }; } };
const UNCOUNT_PLAY = () => { if (window.__bspPlayOrig) { window.togglePlay = window.__bspPlayOrig; window.__bspPlayOrig = null; } };
// 數 fn 期間全站播放被切了幾次;切了奇數次就切回來,後面的格子照原本的播放狀態跑
async function spacePress(page, fn) {
  await page.evaluate(COUNT_PLAY);
  const r = await fn();
  const plays = await page.evaluate(() => { const n = window.__bspPlay; if (n % 2) window.__bspPlayOrig(); return n; });
  await page.evaluate(UNCOUNT_PLAY);
  return { ...r, plays };
}
const spaceRowOk = r => r.at.onRow && r.after.onRow && r.after.key === r.first && r.plays === 1;
// 行程分享:鍵盤走到第一列後按住空白鍵(按下＋連發 4 下＋放開)。播放只切一次(連發不算)、不分享、焦點留在那一列
async function tripHoldSpace(page, eng) {
  await page.evaluate(STUB_SHARE);
  const r = await rowPress(page, eng, 'tripPanel', null);
  await page.evaluate(COUNT_PLAY);
  await page.keyboard.down(' ');
  for (let i = 0; i < 4; i++) { await page.waitForTimeout(40); await page.keyboard.down(' '); }
  await page.keyboard.up(' ');
  await settle(page); await page.waitForTimeout(150);
  const h = await page.evaluate(() => {
    const p = document.getElementById('tripPanel'), a = document.activeElement, n = window.__bspPlay;
    if (n % 2) window.__bspPlayOrig();
    return { plays: n, shared: window.__bspShared.slice(), open: !p.hidden, onRowAfter: !!(a && p.contains(a) && a.matches('.row[data-dest]')) };
  });
  await page.evaluate(UNCOUNT_PLAY);
  return { first: r.first, onRow: r.at.onRow, ...h };
}
const holdOk = h => h.onRow && h.onRowAfter && h.open && h.shared.length === 0 && h.plays === 1;
const fmtHold = h => `走到 ${h.onRow ? h.first : '(不在列上)'}；放開後 面板${h.open ? '還開著' : '關了'}、分享了 ${JSON.stringify(h.shared)}、播放被切 ${h.plays} 次、焦點${h.onRowAfter ? '還在列上' : '離開了列'}`;
// 聚焦 sel 再按 key:焦點還在不在它身上、今日動態面板、資料卡、捷運膠囊的狀態
async function keyOn(page, sel, key) {
  await page.evaluate(sel => document.querySelector(sel).focus(), sel);
  await settle(page);
  await page.keyboard.press(key); await settle(page); await page.waitForTimeout(150);
  return page.evaluate(sel => {
    const a = document.activeElement, t = document.querySelector(sel);
    let fv = false; try { fv = !!a && a.matches(':focus-visible'); } catch (e) {}
    return { stay: !!t && a === t, active: __bsp.desc(a), fv, todayPanel: !document.getElementById('todayPanel').hidden,
      statPop: !document.getElementById('statPop').hidden, fcMin: document.getElementById('freqCard').classList.contains('fc-min'),
      inCard: !!a && document.getElementById('freqCard').contains(a) };
  }, sel);
}
const fmtKey = k => `焦點${k.stay ? '留在原處' : '跑到 ' + k.active}、今日動態${k.todayPanel ? '開著' : '關了'}、資料卡${k.statPop ? '開著' : '關著'}、膠囊${k.fcMin ? '收著' : '展開'}、播放被切 ${k.plays} 次`;
const btnSpaceOk = k => k.stay && k.todayPanel && k.plays === 1;
// 捷運跟隨卡縮成的膠囊:切到捷運群組,拿地圖上畫出來的車一班一班試著跟(北捷要官方即時身分,本機沒有即時 API),收成膠囊
const FC_SETUP = async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  if (state.mode !== 'freq') selectGroup(GROUPS.find(g => g.id === 'metro'));
  for (let i = 0; i < 60 && !((state._freqHits || []).some(h => h.ln)); i++) await sleep(100);
  let used = null;
  for (const h of (state._freqHits || []).filter(h => h.ln)) {
    setFreqFollow(h); await sleep(200);
    if (!document.getElementById('freqCard').hidden) { used = h.ln.id || h.ln.name; break; }
  }
  if (!used) return { ok: false, why: '跟不起任何一班捷運' };
  await sleep(300);
  setFreqCardCompact(true, false); await sleep(100);
  const c = document.getElementById('freqCard');
  return { ok: !c.hidden && c.classList.contains('fc-min') && c.tabIndex >= 0, line: used };
};
const FC_COMPACT = () => { setFreqCardCompact(true, false); };
// ── 鍵盤焦點四件(2026-09-26,v0926i)的工具 ─────────────────────────────────────────────────────
// R:焦點停在看板每一顆可聚焦元素上,主動呼叫重畫(renderBoard／mountUniCard),焦點要回到同一顆(或換掉之後等價的那一顆)、
// 還亮框、捲動不動。等價＝標籤＋id＋class＋data-*(拿掉每秒會變的 data-night-at 與開關態 on)＋字面前 24 字。
// zone 是它在看板的哪一區:每格點名要走過哪幾區,沒走到就是沒量到的假綠。只點名不看當天資料的區(標題列、暗色的方向鈕與
// 下一班大字卡、整合卡的分頁列與跟車卡);活動列(ev-rows)、公車轉乘(btu-board-slot)看當天資料,走到就量、不點名。
const KF_HELP = `window.__kf = (() => {
  const sig = e => !e || e === document.body ? 'body' : e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
    (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/).filter(c => c !== 'on').join('.') : '') +
    [...e.attributes].filter(a => a.name.startsWith('data-') && a.name !== 'data-night-at').map(a => '[' + a.name + '=' + a.value + ']').join('') +
    ' "' + (e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 24) + '"';
  const zone = e => { const z = e.closest('.uni-tabs, .uni-slot, .ev-rows, .btu-board-slot, .night-directions, .night-next, .board-all-toggle, h3'); return z ? (z.tagName === 'H3' ? 'h3' : z.className.split(' ')[0]) : 'other'; };
  const fv = e => { try { return !!e && e !== document.body && e.matches(':focus-visible'); } catch (x) { return false; } };
  const shown = e => !!(e && e.getClientRects().length && !e.closest('[hidden]') && getComputedStyle(e).visibility !== 'hidden');
  const focusNth = i => {
    const b = document.getElementById('board'), tb = __bsp.tabbables(b);
    if (i >= tb.length) return null;
    const e = tb[i]; e.focus({ preventScroll: true }); window.__kfNode = e;
    return { sig: sig(e), zone: zone(e), fv: fv(e), top: b.scrollTop };
  };
  // 重畫＋等兩拍＋量,一次來回
  const callAfter = async call => {
    window[call]();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30))));
    const b = document.getElementById('board'), a = document.activeElement;
    return { sig: sig(a), same: a === window.__kfNode, inBoard: b.contains(a), fv: fv(a), top: b.scrollTop };
  };
  return { sig, zone, fv, shown, focusNth, callAfter };
})();`;
async function holdEach(page, call, max = 60) {
  const r = { kept: 0, total: 0, zones: [], fails: [], noFv: 0 };
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Shift');   // 讓瀏覽器認定接下來的聚焦是鍵盤操作(焦點框亮起)
    const b = await page.evaluate(i => __kf.focusNth(i), i);
    if (!b) break;
    if (!b.fv) r.noFv++;
    if (!r.zones.includes(b.zone)) r.zones.push(b.zone);
    const a = await page.evaluate(call => __kf.callAfter(call), call);
    r.total++;
    if (a.inBoard && (a.same || a.sig === b.sig) && a.fv && Math.abs(a.top - b.top) <= 1) r.kept++;
    else r.fails.push(`${b.zone} ${b.sig} → ${a.sig}${a.fv ? '' : '(沒亮框)'}${Math.abs(a.top - b.top) > 1 ? ` 捲動 ${Math.round(b.top)}→${Math.round(a.top)}` : ''}`);
  }
  return r;
}
const kfOk = (r, need) => r.total >= need.length && r.kept === r.total && r.noFv === 0 && need.every(z => r.zones.includes(z));
const kfRedAt = (r, zone) => r.fails.some(f => f.startsWith(zone + ' '));
const fmtKf = r => `放回 ${r.kept}/${r.total}(走過 ${r.zones.join('、')})${r.noFv ? `、聚焦時沒亮框 ${r.noFv}` : ''}${r.fails.length ? '；' + r.fails.slice(0, 3).join('、') : ''}`;
// 整合卡的分頁鈕用鍵盤 Enter 真按(它的 onclick 走 syncUniCard → mountUniCard,分頁列拆掉重建):
// 焦點要落在新的那一顆同一個分頁、已選、亮框
async function uniTabEnter(page, tab) {
  await page.keyboard.press('Shift');
  const found = await page.evaluate(tab => { const e = document.querySelector(`#board .uni-tabs [data-t="${tab}"]`); if (!__kf.shown(e)) return false; e.focus({ preventScroll: true }); return true; }, tab);
  if (!found) return { found };
  await page.keyboard.press('Enter'); await settle(page);
  return page.evaluate(tab => { const a = document.activeElement; return { found: true, on: !!a && a.matches(`#board .uni-tabs [data-t="${tab}"]`), sel: !!a && a.getAttribute('aria-selected') === 'true', fv: __kf.fv(a), active: __kf.sig(a) }; }, tab);
}
const tabOk = k => k.found && k.on && k.sel && k.fv;
const fmtTab = k => !k.found ? '找不到分頁鈕' : `焦點在 ${k.active}${k.sel ? '(已選)' : ''}${k.fv ? '' : '(沒亮框)'}`;
// 突變:把 index.html 裡某支頂層函式的原始碼照抄、只換掉一段,重新定義成全域的同名函式(頁內其他地方用名字呼叫它,
// 會叫到突變版);回傳那一段在不在(不在＝突變目標已經改名或改寫,那格要紅)。量完 unmutFn 放回原本那支。
async function mutFn(page, name, from, to) {
  return page.evaluate(([name, from, to]) => {
    const src = window[name].toString();
    if (!src.includes(from)) return false;
    window['__kfOrig_' + name] = window[name];
    window[name] = (0, eval)('(' + src.replace(from, to) + ')');
    return true;
  }, [name, from, to]);
}
const unmutFn = (page, name) => page.evaluate(name => { window[name] = window['__kfOrig_' + name]; }, name);
const KF_HOLD = 'const refocus = boardHoldFocus(el);';
const KF_KEYLESS = "(pc ? '.' + CSS.escape(pc) + ' > ' + a.tagName.toLowerCase() : null)";
const KF_BACK = 'if (to && to !== document.activeElement) to.focus({ preventScroll: true });';
const KF_MOVED = '[a, panelOpener[id]]';
const KF_TEXT = "a.matches('input, textarea, select')";
const KF_FV = "try { if (!a.matches(':focus-visible')) return () => {}; } catch (e) { return () => {}; }";
// O:關面板焦點回到入口。從真入口用鍵盤打開(聚焦＋Enter、打字);入口不是鍵盤走得到的(公車站牌列、誤點履歷連結)
// 直接叫開函式。焦點放到 × 按 Enter,焦點要落在 expect 裡第一顆看得到的(開它的鈕;它看不到時是面板固定的入口)、亮框。
const KF_STOP = `{ name: '臺北車站', city: 'Taipei', cityLabel: '臺北市', stationUid: 'TPE0001', position: { lat: 25.0478, lon: 121.517 } }`;
const KF_FOLLOW = `(async () => {
  const cands = state.trains.filter(t => t.sys === 'tra_sched' && t.stops && t.stops.length > 20);
  const tr = cands.find(t => effT(t) >= t.stops[0].depSec && tripRemainingStops(t).length >= 12) || cands[0];
  followTrainNo(String(tr.train), { sys: 'tra_sched' });
  await new Promise(r => setTimeout(r, 400));
})()`;
const KF_PLUS = `state.plus = { active: true }`;   // 行程分享要通行證;那道閘門不歸這支管
// 誤點履歷的入口要跟的台鐵車次有 d≥5 的統計才出現:直接造出統計
const KF_STATS = `(() => { const tr = state.followTrain; state.delayStats = { ...(state.delayStats || {}), [String(tr.train)]: { a: 2, p: 80, d: 10, m: 9 } }; renderDelayRow(); })()`;
const KF_RESET = () => {
  document.body.classList.remove('tools-open');
  try { window.railViewControls.close(); } catch (e) {}
  const i = document.getElementById('trainSearch'); if (i) i.value = '';
  try { closeSearchDrop(); } catch (e) {}
  if (window.__bspShareTrip) window.shareTrip = window.__bspShareTrip;
};
const KF_UNI = `openBoard({ name: '臺北', sys: 'tra_sched', lat: 25.0478, lon: 121.517 })`;
const KF_SEARCH = [['focus', '#tabSearch'], ['key', 'Enter'], ['wait', 300], ['focus', '#trainSearch'], ['type', '臺北'], ['key', 'Enter'], ['wait', 300]];
const O_360 = {
  favPanel: { name: '我的最愛', steps: [['focus', '#tabFav'], ['key', 'Enter']], close: '#favClose', expect: '#tabFav' },
  ridePanel: { name: '旅程護照', steps: [['focus', '#tabRide'], ['key', 'Enter']], close: '#rideClose', expect: '#tabRide' },
  explorePanel: { name: '今日亮點', steps: [['focus', '#tabExplore'], ['key', 'Enter']], close: '#exploreClose', expect: '#tabExplore' },
  searchPanel: { name: '查詢', steps: [['focus', '#tabSearch'], ['key', 'Enter']], close: '#searchPanelClose', expect: '#tabSearch' },
  // 軌道與路線、字級兩列被搬進「觀看設定」(rail-3d/integration/view-controls.js);按下去觀看設定跟著收起,那一列看不到
  trackPanel: { name: '軌道與路線', steps: [['focus', '#viewSettingsBtn'], ['key', 'Enter'], ['wait', 200], ['focus', '.view-tab[data-view="labels"]'], ['key', 'Enter'], ['wait', 200], ['focus', '[data-act="track"]'], ['key', 'Enter']], close: '#trackClose', expect: '#viewSettingsBtn' },
  fontPanel: { name: '字級', steps: [['focus', '#viewSettingsBtn'], ['key', 'Enter'], ['wait', 200], ['focus', '.view-tab[data-view="display"]'], ['key', 'Enter'], ['wait', 200], ['focus', '[data-act="fontscale"]'], ['key', 'Enter']], close: '#fontClose', expect: '#viewSettingsBtn' },
  todayPanel: { name: '今日動態', steps: [['focus', '#tabSearch'], ['key', 'Enter'], ['wait', 300], ['focus', '.ql-row[data-act="today"]'], ['key', 'Enter']], close: '#todayClose', expect: '#tabSearch' },
  board: { name: '車站看板', steps: KF_SEARCH, close: '#boardClose', expect: '#tabSearch' },
  // 合併卡的入口(跟車中點地圖上的站、我的最愛的站列)都不是鍵盤走得到的,直接叫開函式;打開當下要真的長出分頁列
  // (跟車中從查詢開站會先停止跟車,組不出合併卡)
  uni: { name: '直式合併卡', panel: 'board', pre: [KF_FOLLOW], steps: [['js', KF_UNI]], must: '#board .uni-tabs', close: '#boardClose', expect: '#tabSearch' },
  busStopPanel: { name: '公車站牌', steps: [['focus', '#tabSearch'], ['key', 'Enter'], ['wait', 300], ['js', `openBusStopPanel(${KF_STOP})`]], close: '#busStopClose', expect: '#tabSearch' },
  delayHistPanel: { name: '誤點履歷', pre: [KF_FOLLOW, KF_STATS], steps: [['js', 'openDelayHist(state.followTrain)']], close: '#delayHistClose', expect: '#followPanel button' },
  tripPanel: { name: '行程分享', pre: [KF_PLUS, KF_FOLLOW], steps: [['focus', '#fpTripShare'], ['key', 'Enter']], close: '#tripPanelClose', expect: '#fpTripShare' },
  // 第 3 件:行程分享列按 Enter 分享,面板收起,焦點回到「行程分享」鈕
  tripRow: { name: '行程分享列 Enter 分享', how: '列上按 Enter 分享、面板收起', panel: 'tripPanel', pre: [KF_PLUS, KF_FOLLOW, STUB_SHARE], steps: [['focus', '#fpTripShare'], ['key', 'Enter']], close: '#tripPanel .row[data-dest]', expect: '#fpTripShare' },
  // 開它的鈕不是面板固定的入口(直接造出來:焦點停在護照鈕上叫開我的最愛)⇒ 回到開它的那顆,不是固定入口
  favFromRide: { name: '我的最愛(從護照鈕開)', how: '焦點停在護照鈕上叫開、× 按 Enter 關', panel: 'favPanel', steps: [['focus', '#tabRide'], ['js', 'openFavPanel()']], close: '#favClose', expect: '#tabRide' },
  // 合併卡「這班車」裡按「行程分享」:開行程分享會先關看板、跟車卡搬回原位,焦點要留在那顆鈕上(不被看板的關閉拉去入口)
  uniTrip: { name: '合併卡裡的行程分享', how: '「這班車」裡按 Enter 打開,焦點留在那顆鈕上(看板收起不把它拉走);× 按 Enter 關', panel: 'tripPanel', pre: [KF_PLUS, KF_FOLLOW], steps: [['js', KF_UNI], ['focus', '#board .uni-tabs [data-t="train"]'], ['key', 'Enter'], ['wait', 200], ['focus', '#fpTripShare'], ['key', 'Enter']],
    atOpen: '#fpTripShare', close: '#tripPanelClose', expect: '#fpTripShare' },
};
const O_1280 = {
  favPanel: { name: '我的最愛', steps: [['focus', '#favBtn'], ['key', 'Enter']], close: '#favClose', expect: '#favBtn' },
  ridePanel: { name: '旅程護照', steps: [['focus', '#rideBtn'], ['key', 'Enter']], close: '#rideClose', expect: '#rideBtn' },
  explorePanel: { name: '今日亮點', steps: [['focus', '#exploreBtn'], ['key', 'Enter']], close: '#exploreClose', expect: '#exploreBtn' },
  todayPanel: { name: '今日動態', steps: [['focus', '#todayBtn'], ['key', 'Enter']], close: '#todayClose', expect: '#todayBtn' },
  // 桌機的 #trackBtn 在工具列是 display:none,真入口是右側觀看設定直欄的「標示／畫面」
  trackPanel: { name: '軌道與路線', steps: [['focus', '.view-rail [aria-controls="view-labels"]'], ['key', 'Enter'], ['wait', 200], ['focus', '[data-act="track"]'], ['key', 'Enter']], close: '#trackClose', expect: '.view-rail [aria-controls="view-labels"]' },
  fontPanel: { name: '字級', steps: [['focus', '.view-rail [aria-controls="view-display"]'], ['key', 'Enter'], ['wait', 200], ['focus', '[data-act="fontscale"]'], ['key', 'Enter']], close: '#fontClose', expect: '.view-rail [aria-controls="view-display"]' },
  board: { name: '車站看板', steps: [['focus', '#trainSearch'], ['type', '臺北'], ['key', 'Enter'], ['wait', 300]], close: '#boardClose', expect: '#trainSearch' },
  busStopPanel: { name: '公車站牌', steps: [['focus', '#trainSearch'], ['js', `openBusStopPanel(${KF_STOP})`]], close: '#busStopClose', expect: '#trainSearch' },
};
async function closeBack(page, key, flow) {
  await page.evaluate(CLOSE_ALL); await page.evaluate(KF_RESET);
  for (const js of flow.pre || []) await page.evaluate(js);
  await settle(page);
  for (const [op, arg] of flow.steps) {
    if (op === 'focus') {
      await page.keyboard.press('Shift');
      const found = await page.evaluate(sel => { const e = [...document.querySelectorAll(sel)].find(__kf.shown); if (e) e.focus(); return !!e; }, arg);
      if (!found) return { none: arg };
    } else if (op === 'key') await page.keyboard.press(arg);
    else if (op === 'type') {   // 先清空(跟車中查詢框會帶著車次),再一個字一個字打
      await page.evaluate(() => { const e = document.activeElement; if (e && 'value' in e) e.value = ''; });
      await page.keyboard.type(arg, { delay: 20 }); await page.waitForTimeout(400);
    } else if (op === 'js') await page.evaluate(arg);
    else if (op === 'wait') await page.waitForTimeout(arg);
    await settle(page);
  }
  await page.waitForTimeout(150);
  const id = flow.panel || key;
  const at = await page.evaluate(([id, sel, must]) => { const p = document.getElementById(id), a = document.activeElement;
    return { opened: !!(p && !p.hidden), atOpen: __bsp.desc(a), atOpenOk: !sel || (!!a && a.matches(sel) && __kf.fv(a)), mustOk: !must || !!document.querySelector(must) }; },
    [id, flow.atOpen || null, flow.must || null]);
  if (!at.opened) return { opened: false, mustOk: at.mustOk };
  await page.keyboard.press('Shift');
  const c = await page.evaluate(sel => { const e = [...document.querySelectorAll(sel)].find(__kf.shown); if (e) e.focus(); return !!e; }, flow.close);
  if (!c) return { opened: true, none: flow.close };
  await page.keyboard.press('Enter'); await settle(page); await page.waitForTimeout(150);
  const r = await page.evaluate(([id, want]) => {
    const p = document.getElementById(id), a = document.activeElement, w = [...document.querySelectorAll(want)].find(__kf.shown);
    return { opened: true, closed: !p || p.hidden, on: !!w && a === w, fv: __kf.fv(a), active: __bsp.desc(a), want: w ? __bsp.desc(w) : '(看不到)',
      shared: window.__bspShared ? window.__bspShared.slice() : null };
  }, [id, flow.expect]);
  return { ...r, atOpen: at.atOpen, atOpenOk: at.atOpenOk, mustOk: at.mustOk };
}
const backOk = r => r.opened && r.mustOk && r.closed && r.on && r.fv && r.atOpenOk;
const fmtBack = r => r.none ? `找不到看得到的 ${r.none}` : !r.opened ? '沒打開' :
  `${r.mustOk ? '' : '打開的不是要量的那種(例如合併卡沒長出分頁列)、'}${r.atOpenOk ? '' : `打開時焦點在 ${r.atOpen}、`}關${r.closed ? '了' : '不掉'}、焦點在 ${r.active}${r.fv ? '' : '(沒亮框)'}(該在 ${r.want})`;
// V 走一趟:從第一個(fwd)或最後一個(back)可聚焦元素開始按 Tab／Shift+Tab 走到焦點離開面板,最多 max 拍。
// 焦點被重繪洗回 body 的那輪重走(同 walk),最多三輪。WebKit 的聚焦捲動是非同步的,每拍多等 60ms 再量。
async function ringWalk(page, eng, id, dir = 'fwd', max = 60) {
  const key = eng === 'webkit' ? (dir === 'fwd' ? 'Alt+Tab' : 'Alt+Shift+Tab') : (dir === 'fwd' ? 'Tab' : 'Shift+Tab');
  let r;
  for (let round = 0; round < 3; round++) {
    const n = await page.evaluate(([id, dir]) => {
      const p = document.getElementById(id); p.scrollTop = dir === 'fwd' ? 0 : p.scrollHeight;
      const tb = __bsp.tabbables(p); if (tb.length) (dir === 'fwd' ? tb[0] : tb[tb.length - 1]).focus(); return tb.length;
    }, [id, dir]);
    const st = { n, fv: 0, clipped: 0, noRing: 0, low: 0, minC: null, seen: [], seenC: {}, bad: [], lost: false };
    for (let i = 0; i < max; i++) {
      await settle(page);
      if (eng === 'webkit') await page.waitForTimeout(60);
      const m = await page.evaluate(id => __bspRing(id), id);
      if (m.left) { st.lost = !!m.lost; break; }
      if (m.fv) {
        st.fv++; if (!st.seen.includes(m.el)) st.seen.push(m.el);
        const why = [];
        if (!m.w) { st.noRing++; why.push('沒有框'); }
        if (m.cut.length) { st.clipped++; why.push('切掉' + m.cut.join('')); }
        if (m.contrast !== null) { st.minC = st.minC === null ? m.contrast : Math.min(st.minC, m.contrast); st.seenC[m.el] = Math.min(st.seenC[m.el] ?? Infinity, m.contrast); }
        if (m.contrast !== null && m.contrast < 3) { st.low++; why.push('對比 ' + m.contrast); }
        if (why.length && st.bad.length < 4) st.bad.push(`${m.el} ${why.join(' ')}`);
      }
      await page.keyboard.press(key);
    }
    r = st;
    if (!st.lost || st.clipped || st.noRing || st.low) break;
  }
  return r;
}
const vOk = (v, need) => v.fv >= need && v.clipped === 0 && v.noRing === 0 && v.low === 0;
// 突變要指名紅在哪一顆、哪一種(bad 只留前 4 筆,走訪順序裡被點名的都在前面)
const badHas = (v, el, why) => v.bad.some(b => b.startsWith(el + ' ') && b.includes(why));
const fmtSeen = v => v.seen.map(k => k + (k in v.seenC ? `(${v.seenC[k]})` : '')).join('、');
const fmtV = v => `亮框 ${v.fv} 拍(可聚焦 ${v.n}):被切 ${v.clipped}、沒有框 ${v.noRing}、對比不足 ${v.low}(最低 ${v.minC ?? '—'})${v.bad.length ? '；' + v.bad.join('、') : ''}`;
// 公車列點了沒有動作:滑鼠點一列、再按一個沒有快捷鍵的字母,焦點不能留在列上、面板裡不能有亮框(跟改版前一樣回到頁面)
async function busClickKey(page) {
  const pt = await page.evaluate(() => { const r = document.querySelectorAll('#busStopPanel .bus-eta-row')[1]; const b = r.getBoundingClientRect(); return { x: b.left + 30, y: b.top + b.height / 2 }; });
  await page.mouse.click(pt.x, pt.y); await settle(page);
  await page.keyboard.press('a'); await settle(page);
  return page.evaluate(() => {
    const p = document.getElementById('busStopPanel'), a = document.activeElement;
    let ring = 0; for (const e of p.querySelectorAll('*')) { try { if (e.matches(':focus-visible')) ring++; } catch (err) {} }
    return { onRow: !!(a && p.contains(a) && a.matches('.bus-eta-row')), ring, active: a ? a.tagName.toLowerCase() + (a.className ? '.' + String(a.className).split(' ')[0] : '') : null };
  });
}
const clickOk = c => !c.onRow && c.ring === 0;
const fmtClick = c => `點完按鍵後焦點在 ${c.active}${c.onRow ? '(公車列)' : ''}、面板裡亮框 ${c.ring} 個`;
// W(三張清單):先數列,每一列都要可聚焦;往回走要走過每一列,而且沒有一拍被標題蓋住。walk 定義在下面(函式宣告會提升)
async function listWalk(page, eng, P, key, tag) {
  const opened = await open(page, key);
  const c = opened ? await page.evaluate(rowCount, [key, LIST_ROWS[key]]) : { rows: 0, focusable: 0 };
  ok(P(`W ${tag} ${key} 打得開、列數夠、每一列都可聚焦`), opened && c.rows >= LIST_MIN[key] && c.focusable === c.rows,
    `列 ${c.rows}(至少 ${LIST_MIN[key]})、可聚焦 ${c.focusable}`);
  if (!opened) return;
  const w = await walk(page, eng, key);
  ok(P(`W ${tag} ${key} 鍵盤往回走過每一列,焦點不被固定段蓋住`), w.covered === 0 && w.content >= c.rows,
    `被蓋 ${w.covered}/${w.content} 拍(列 ${c.rows}、可聚焦 ${w.n})${w.bad.length ? '；' + w.bad.join('、') : ''}`);
}

async function boot(browser, { width, height, tier = 'std', query = '' }) {
  const mobile = width < 1000;
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  await ctx.addInitScript(t => {
    try {
      localStorage.setItem('trainmap-howto-seen', '1');
      localStorage.setItem('trainmap-language', 'zh-TW');
      localStorage.removeItem('trainmap-sheet-size');
      if (t !== 'std') localStorage.setItem('trainmap-fontscale', t);
    } catch (e) {}
  }, tier);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await page.goto(`${BASE}?lang=zh-TW&t=09:41${query}`, { waitUntil: 'domcontentloaded' });
  // 等開機收尾:finishLoad 會 closeRidePanel(),太早開護照會量到被關掉的空面板
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.mode === 'sched' && state.ready === true && (state.trains || []).length > 0; } catch (e) { return false; } }, null, { timeout: 90000 });
  await page.evaluate(HELPERS);
  await page.evaluate(RING_INIT);
  return { ctx, page, errors };
}
async function open(page, key) {
  await page.evaluate(CLOSE_ALL);
  await page.evaluate(OPEN[key]);
  await settle(page); await page.waitForTimeout(250);
  return page.evaluate(id => { const p = document.getElementById(id); return !!(p && !p.hidden); }, ELEM[key]);
}
// W:從最後一個可聚焦元素一路往回走到焦點離開面板。看板每 20 秒重繪一次,innerHTML 換掉正在聚焦的節點 ⇒ 焦點掉回
// body(不是走完;2026-09-26 實測合併卡那格偶爾只走 2 拍就停,對照因此假綠),那一輪不算、重走,最多三輪
async function walk(page, eng, id) {
  let r;
  for (let round = 0; round < 3; round++) {
    const n = await page.evaluate(id => { const p = document.getElementById(id); const tb = __bsp.tabbables(p); if (tb.length) tb[tb.length - 1].focus(); return tb.length; }, id);
    let steps = 0, content = 0, covered = 0, lost = false; const bad = [];
    for (let i = 0; i < 80; i++) {
      await settle(page);
      const m = await page.evaluate(id => __bsp.measure(id), id);
      if (m.left) { lost = !!m.lost; break; }
      steps++;
      if (!m.inHead) content++;
      if (m.covered) { covered++; if (bad.length < 3) bad.push(`${m.el} 壓 ${m.over}px`); }
      await page.keyboard.press(eng === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
    }
    r = { n, steps, content, covered, bad, lost };
    if (!lost || covered) break;
  }
  return r;
}
// J:捲到 80% 再把焦點放進標題(或固定段裡)的某個鈕;WebKit 的聚焦捲動是非同步的,等 450ms 再量
// 聚焦前才抓鈕、聚焦後確認焦點還在它身上:平交道卡、落釘卡每一模擬秒整張 innerHTML 重寫(renderCrossingCard／
// renderPinCard),看板每 20 秒重繪。聚焦到被換掉的舊鈕＝什麼都沒發生,捲動當然不動 ⇒ J 假綠、對照假不紅
// (2026-09-26 落釘卡實測兩個引擎都這樣,還因此誤判成「卡太矮量不出來」)。沒留住就等下一次重繪之後重量,
// 四次都沒留住 ⇒ jump 記 NaN,J 與對照都判不過。v0926j 起這兩張的卡頭沒變就不換,這道重試留著當保險
const JUMP = async ([id, sel]) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const p = document.getElementById(id);
  const pick = () => { const b = [...p.querySelectorAll(sel)].filter(e => !e.disabled && e.getClientRects().length); return b[b.length - 1]; };
  const rerender = () => new Promise(res => { const mo = new MutationObserver(() => { mo.disconnect(); res(); }); mo.observe(p, { childList: true }); setTimeout(() => { mo.disconnect(); res(); }, 1500); });
  if (!pick()) return { none: true };
  let r;
  for (let i = 0; i < 4; i++) {
    if (i) await rerender();
    if (document.activeElement) document.activeElement.blur();
    const max = p.scrollHeight - p.clientHeight;
    p.scrollTop = Math.floor(max * 0.8);
    await sleep(150);
    const btn = pick();
    if (!btn) return { none: true };
    const before = p.scrollTop;
    btn.focus();
    await sleep(450);
    const after = p.scrollTop, held = btn.isConnected && document.activeElement === btn;
    btn.blur();
    r = { btn: __bsp.desc(btn) + (held ? '' : '(焦點留不住)'), max, before, after, jump: held ? before - after : NaN };
    if (held) break;
  }
  return r;
};
const H3_BTN = ':scope > h3 button, :scope > h3 a[href]';
// F:#rdSearch 在 #rdSystem 正上方;把 #rdSystem 捲到剛好貼著固定段,#rdSearch 就整顆壓在標題下,再聚焦它
const FIELD = async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const bd = document.getElementById('trackPanel'), el = document.getElementById('rdSearch'), nxt = document.getElementById('rdSystem');
  if (!bd || bd.hidden || !el || !nxt || !el.getClientRects().length) return { none: true };
  const hs = __bsp.heads(bd), stackBottom = () => Math.max(...hs.map(h => h.getBoundingClientRect().bottom));
  bd.scrollTop = 0; await sleep(50);
  bd.scrollTop = Math.max(0, nxt.getBoundingClientRect().top - stackBottom() - 2 + bd.scrollTop);
  await sleep(150);
  const over = () => +(stackBottom() - el.getBoundingClientRect().top).toFixed(1);
  const over0 = over();
  el.focus();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  await sleep(50);
  const over1 = over();
  await sleep(500);
  const over2 = over();
  el.blur();
  return { over0, over1, over2 };
};
// 站名牌出現／消失:照 index.html flashRandomNextPlate 的契約(設 _randomNextPlate、清 _plateStop、立刻 updateFollowPanel),
// 只是期限拉長、自己指定報哪一站;不等跟車迴圈下一輪刷新(那一輪多久來一次不歸這支管)。
const PLATE = async on => {
  const tr = state.followTrain;
  state._randomNextPlate = on ? { tr, until: performance.now() + 600000, stop: tr.stops[Math.min(2, tr.stops.length - 1)] } : null;
  state._plateStop = null;
  updateFollowPanel(tr);
  for (let i = 0; i < 4; i++) await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => setTimeout(r, 250));
  const dp = document.getElementById('dwellPlate');
  return { ...__bsp.stuck('board'), plate: (dp.classList.contains('dp-docked') ? '併入' : '未併') + (dp.classList.contains('show') ? '亮' : '暗') };
};
// 換字級走設定面板用的那個入口(setFontScale 在閉包裡,只經 state._setFontScale 露出來);
// 入口不見了就回報,不自己改 data-fs 冒充——那樣量不到真路徑多做的事(寫 localStorage、重量地圖與面板)。
const FONT = async tier => {
  if (typeof state === 'undefined' || typeof state._setFontScale !== 'function') return { noEntry: true };
  state._setFontScale(tier);
  for (let i = 0; i < 4; i++) await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => setTimeout(r, 150));
  return __bsp.stuck('ridePanel');
};
const padFits = s => !s.noEntry && Math.abs(s.pad - s.stuck) <= 1;
const fmtS = s => s.noEntry ? '換字級入口 state._setFontScale 不見了' : `pad ${s.pad} 實際 ${s.stuck}(${s.n} 段, 可捲 ${s.max}${s.plate ? ', 牌' + s.plate : ''})`;
// 分頁列的排除規則原本只在側欄 media 段裡;原樣複製一份到 media 外＝「有人把它移出側欄段」。找不到那條就回 null
const TABS_RULE_OUT = () => {
  const find = rules => {
    for (const r of rules) {
      if (r.selectorText && r.selectorText.includes('.board > .uni-tabs') && r.style.scrollMarginTop === '0px') return r;
      if (r.cssRules && !r.selectorText) { const hit = find(r.cssRules); if (hit) return hit; }
    }
    return null;
  };
  for (const sh of document.styleSheets) {
    let rules; try { rules = sh.cssRules; } catch (e) { continue; }
    for (const r of rules) {
      if (!(r instanceof CSSMediaRule)) continue;
      const hit = find(r.cssRules);
      if (!hit) continue;
      const el = document.createElement('style'); el.id = '__bspTabsOut'; el.textContent = hit.cssText;
      document.head.appendChild(el);
      return hit.selectorText;
    }
  }
  return null;
};
// 分頁鈕「半露」時往回走進它。兩個引擎的聚焦捲動都是:半露＝捲到剛好露出(對齊最近的邊,吃 scroll-margin),整顆在捲動區
// 外＝置中——置中那種一定被夾到最上面、分頁鈕恆在標題下方,拿掉讓位也不會被蓋,零資訊。往回走整份清單時走到分頁鈕是
// 半露還是整顆在外,看當天資料:2026-09-26 臺北看板多了一列活動(10/03 起臺鐵×KATO),就從半露變成整顆在外,突變對照兩個
// 引擎都假綠(被蓋 0/6)、擋下 ship-web。這裡直接把最後一顆分頁鈕捲成上半截在捲動區外,從它後面那顆往回走一步,不看資料。
// 看板每 20 秒整張重畫,走完焦點不在分頁鈕上就重來,最多三次
async function tabsPeek(page, eng) {
  let r = { none: true };
  for (let i = 0; i < 3; i++) {
    const prep = await page.evaluate(() => {
      const bd = document.getElementById('board'), tb = __bsp.tabbables(bd);
      const tabs = tb.filter(e => e.closest('#board > .uni-tabs'));
      if (!tabs.length) return { none: true };
      const last = tabs[tabs.length - 1], next = tb[tb.indexOf(last) + 1];
      if (!next) return { none: true };
      const inner = () => bd.getBoundingClientRect().top + bd.clientTop, rr = last.getBoundingClientRect();
      bd.scrollTop += rr.top - inner() + rr.height / 2;
      next.focus({ preventScroll: true });
      return { next: __bsp.desc(next), peek: +(inner() - last.getBoundingClientRect().top).toFixed(1), h: Math.round(rr.height) };
    });
    if (prep.none) return prep;
    await settle(page);
    await page.keyboard.press(eng === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
    await settle(page);
    if (eng === 'webkit') await page.waitForTimeout(120);
    const m = await page.evaluate(() => { const a = document.activeElement; return { onTab: !!(a && a.closest && a.closest('#board > .uni-tabs')), ...__bsp.measure('board') }; });
    r = { ...prep, ...m };
    if (m.onTab) break;
  }
  return r;
}
const peekOk = k => !k.none && k.onTab && !k.covered;
const fmtPeek = k => k.none ? '找不到分頁鈕或它後面的元素'
  : `分頁鈕(高 ${k.h}px)上緣露在捲動區外 ${k.peek}px,從 ${k.next} 往回走 ⇒ 焦點${k.onTab ? '在分頁鈕' : '不在分頁鈕(' + (k.el || '離開面板') + ')'}、${k.covered ? `被標題壓 ${k.over}px` : `上緣離標題 ${-k.over}px`}`;

// ════ 2026-09-26 補量的格子用的工具(上面那份只認 .board 的 h3／站名牌／分頁列,這份吃任意容器＋固定段) ════
const HELPERS2 = `window.__bsp2 = (() => {
  const heads = (p, cls) => [...p.children].filter(n => n.matches(cls) && getComputedStyle(n).position === 'sticky' && n.getBoundingClientRect().height > 0);
  const footOf = p => { const f = p.querySelector(':scope > .uni-slot .uni-more'); return f && getComputedStyle(f).position === 'sticky' && f.getBoundingClientRect().height > 0 ? f : null; };
  // edge:上緣壓在標題下超過 1px 就算(車庫的格子是高卡片,中心點永遠落在頂列下面,中心判準拿掉讓位也量到 0)
  const measure = ([root, cls, withFoot, edge]) => {
    const p = document.querySelector(root), a = document.activeElement;
    if (!p || p.hidden || !a || a === p || !p.contains(a)) return { left: true, lost: !a || a === document.body };
    const hs = heads(p, cls), f = withFoot ? footOf(p) : null;
    const inFoot = !!(f && f.contains(a)), inFix = inFoot || hs.some(h => h.contains(a));
    const r = a.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const over = hs.length ? +(Math.max(...hs.map(h => h.getBoundingClientRect().bottom)) - r.top).toFixed(1) : 0;
    return { inFix, inFoot, el: __bsp.desc(a), over,
      top: !inFix && (edge ? over > 1 : hs.some(h => hit && h.contains(hit))), bot: !inFix && !!(f && hit && f.contains(hit)) };
  };
  // 標題以外的可聚焦元素:一個都沒有,往回走就是零資訊(S)
  const content = ([root, cls]) => {
    const p = document.querySelector(root);
    return __bsp.tabbables(p).filter(e => { const h = e.closest(cls); return !(h && p.contains(h)); }).map(__bsp.desc);
  };
  // 合併卡底部提示列:讓位值 vs 釘在卡緣時實際佔掉的下緣(捲動區下緣 − 它的上緣 ＋ 它的上邊界)。量當下的捲動位置
  const foot = () => {
    const bd = document.getElementById('board'), f = bd.querySelector(':scope > .uni-slot .uni-more');
    const pad = parseFloat(bd.style.getPropertyValue('--board-scroll-pad-bottom')) || 0;
    if (!f || !f.getClientRects().length) return { pad, shown: false };
    const portBottom = bd.getBoundingClientRect().top + bd.clientTop + bd.clientHeight, r = f.getBoundingClientRect();
    const pinned = getComputedStyle(f).position === 'sticky' && Math.abs(portBottom - (parseFloat(getComputedStyle(bd).paddingBottom) || 0) - r.bottom) < 2;
    return { pad, shown: true, pinned, stuck: +(portBottom - r.top + (parseFloat(getComputedStyle(f).marginTop) || 0)).toFixed(1) };
  };
  return { measure, content, foot };
})();`;
const CARDS2 = {
  uni: { root: '#board', cls: 'h3, .dwell-plate, .uni-tabs', foot: true },
  tc: { root: '#trainCard', cls: '.tc-head' },
  xing: { root: '#xingCard', cls: '.xc-head' },
  pin: { root: '#pinCard', cls: '.xc-head' },
  sugar: { root: '#sugarCard', cls: '.xc-head' },
  near: { root: '#nearCard', cls: '.xc-head' },
  garage: { root: '#trainGarage', cls: '.g-top', edge: true },
};
const OPEN2 = {
  // 合併卡預設開在「這一站」;提示列在「這班車」那一頁,照使用者的路徑點分頁鈕切過去
  uni: `(async () => { await ${OPEN.uni}; document.querySelector('#board > .uni-tabs button[data-t=train]')?.click(); await new Promise(r => setTimeout(r, 300)); })()`,
  // 列車 sheet 小段只露標題＋遙測,內容到中段才有。setSheetSize 會寫全站段高偏好,量完要還給小段
  tc: `(async () => {
    const cands = state.trains.filter(t => t.sys === 'tra_sched' && t.stops && t.stops.length > 20);
    const tr = cands.find(t => { const tt = effTLive(t), info = nextStopInfo(t, tt); return tt >= t.stops[0].depSec && !dwellInfoOf(t, tt) && info && info.min >= 3; }) || cands[0];
    followTrainNo(String(tr.train), { sys: 'tra_sched' });
    await new Promise(r => setTimeout(r, 400));
    openTrainSheet(); await new Promise(r => setTimeout(r, 300));
    setSheetSize(document.getElementById('trainCard'), 'medium'); await new Promise(r => setTimeout(r, 300));
  })()`,
  // 平交道資料是開機後才非同步抓(ensureCrossings),開卡前等它到
  xing: `(async () => {
    for (let i = 0; i < 100 && !state.crossings; i++) { ensureCrossings(); await new Promise(r => setTimeout(r, 100)); }
    const cs = state.crossings.filter(c => !c.noSched);
    openCrossingCard(cs.find(c => { try { return crossingPasses(c).length >= 5; } catch (e) { return false; } }) || cs[0]);
  })()`,
  pin: `openPinAt(25.0143, 121.4637)`,
  sugar: `openSugarCard(SUGAR_PARKS[0])`,
  near: `openNearbyStations(25.0478, 121.517, 20)`,
  garage: `(async () => {
    openTrainGarage();
    for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 100)); const g = document.getElementById('trainGarage'); if (g && g.open && g.querySelectorAll('button').length > 8) break; }
    await new Promise(r => setTimeout(r, 300));
  })()`,
};
const CLOSE_ALL2 = `(() => {
  try { if (window.TrainGarage && TrainGarage.isOpen) TrainGarage.close(); } catch (e) {}
  for (const f of ['closeTrainSheet', 'closeCrossingCard', 'closePinCard', 'closeSugarCard', 'closeNearbyStations']) try { window[f](); } catch (e) {}
})()`;
async function open2(page, key) {
  await page.evaluate(CLOSE_ALL2); await page.evaluate(CLOSE_ALL); await settle(page);
  await page.evaluate(OPEN2[key]);
  await settle(page); await page.waitForTimeout(250);
  return page.evaluate(sel => { const p = document.querySelector(sel); return !!(p && !p.hidden && p.getClientRects().length); }, CARDS2[key].root);
}
// 往前(dir 1:Tab;WebKit 要 Option+Tab)或往回(-1)走到焦點離開容器。焦點掉回 body＝跟車卡重繪換掉了正在聚焦的
// 節點(不是走完;09-26 探針在 Chromium 實測過一輪只走 2/12 拍),那一輪不算、重走,最多三輪
async function walk2(page, eng, key, dir, cap = 60) {
  const c = CARDS2[key], press = dir > 0 ? (eng === 'webkit' ? 'Alt+Tab' : 'Tab') : (eng === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
  let w;
  for (let round = 0; round < 3; round++) {
    const n = await page.evaluate(([root, dir]) => { const tb = __bsp.tabbables(document.querySelector(root)); if (tb.length) (dir > 0 ? tb[0] : tb[tb.length - 1]).focus(); return tb.length; }, [c.root, dir]);
    w = { n, steps: 0, content: 0, covered: 0, foot: false, lost: false, bad: [] };
    for (let i = 0; i < cap; i++) {
      await settle(page);
      const m = await page.evaluate(a => __bsp2.measure(a), [c.root, c.cls, !!c.foot, !!c.edge]);
      if (m.left) { w.lost = m.lost; break; }
      w.steps++;
      if (m.inFoot) w.foot = true;
      if (!m.inFix) w.content++;
      if (m.top || m.bot) { w.covered++; if (w.bad.length < 3) w.bad.push(`${m.el} 停在${m.top ? `標題下(壓 ${m.over}px)` : '底部提示列下'}`); }
      await page.keyboard.press(press);
    }
    if (!w.lost || w.covered || (c.foot && w.foot)) break;
  }
  return w;
}
const fmtW = w => `被蓋 ${w.covered}/${w.content} 拍(可聚焦 ${w.n}${w.lost ? '、焦點掉回 body 三輪' : ''})${w.bad.length ? '；' + w.bad.join('、') : ''}`;
// 提示列釘在卡緣時聚焦它本身(往前 Tab 走到它):內容不該動
const JFOOT = async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const bd = document.getElementById('board'), f = bd.querySelector(':scope > .uni-slot .uni-more');
  if (!f || !f.getClientRects().length) return { none: true };
  if (document.activeElement) document.activeElement.blur();
  bd.scrollTop = Math.min(40, bd.scrollHeight - bd.clientHeight); await sleep(150);
  const pinned = __bsp2.foot().pinned, before = bd.scrollTop;
  f.focus(); await sleep(450);
  const after = bd.scrollTop; f.blur();
  return { pinned, before, after };
};
// P:捲回頂端(提示列的自然版位在下緣之外 ⇒ 釘在卡緣)再量
const FOOT0 = async () => {
  const bd = document.getElementById('board'); bd.scrollTop = 0;
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return __bsp2.foot();
};
const footFits = s => s.shown && s.pinned && Math.abs(s.pad - s.stuck) <= 1;
const fmtF = s => !s.shown ? `提示列不在(讓位 ${s.pad})` : `讓位 ${s.pad} 實際 ${s.stuck}${s.pinned ? '' : '(沒釘在卡緣)'}`;
// 換段高走抓把／標題列用的同一個入口 setSheetSize
const SIZE = async size => {
  setSheetSize(document.getElementById('board'), size);
  for (let i = 0; i < 3; i++) await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => setTimeout(r, 250));
};
const FONT2 = async tier => {
  if (typeof state === 'undefined' || typeof state._setFontScale !== 'function') return false;
  state._setFontScale(tier);
  for (let i = 0; i < 4; i++) await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => setTimeout(r, 200));
  return true;
};
// 車庫:內容的讓位(第一個頂列以外可聚焦元素的 scroll-margin-top)vs 頂列實高
const GARAGE_PAD = async () => {
  for (let i = 0; i < 3; i++) await new Promise(r => requestAnimationFrame(r));
  const g = document.getElementById('trainGarage'), top = g.querySelector(':scope > .g-top');
  const el = __bsp.tabbables(g).find(e => !top.contains(e));
  return { head: +top.getBoundingClientRect().height.toFixed(1), margin: el ? parseFloat(getComputedStyle(el).scrollMarginTop) || 0 : -1 };
};
const gFits = g => g.margin >= 0 && Math.abs(g.margin - (g.head + 15)) <= 1;
// 突變用的覆寫樣式(!important 蓋過 index.html／train-garage.css 那幾條)
const MUT = {
  noFootPad: '.board > :not(h3), .board > :not(h3) * { scroll-margin-bottom: 0 !important; }',
  footSelfPad: 'body.fs .board.sheet-small .uni-slot .uni-more { scroll-margin-bottom: var(--board-scroll-pad-bottom, 0px) !important; }',
  noCardPad: '.xing-card > :not(.xc-head), .xing-card > :not(.xc-head) * { scroll-margin-top: 0 !important; }',
  noGaragePad: '#trainGarage > :not(.g-top), #trainGarage > :not(.g-top) * { scroll-margin-top: 0 !important; }',
  garage84: '#trainGarage > :not(.g-top), #trainGarage > :not(.g-top) * { scroll-margin-top: 84px !important; }',
  // 修前的寫法:容器 scroll-padding-top 84px、內容不讓位
  garageOld: '#trainGarage { scroll-padding-top: 84px !important; } #trainGarage > :not(.g-top), #trainGarage > :not(.g-top) * { scroll-margin-top: 0 !important; }',
};
const withMut = async (page, css, fn) => {
  await page.evaluate(css => { const el = document.createElement('style'); el.id = '__bspMut'; el.textContent = css; document.head.appendChild(el); }, css);
  try { return await fn(); } finally { await page.evaluate(() => document.getElementById('__bspMut')?.remove()); }
};
// S＋對照:把第一個看得見的內容列設成可聚焦 ⇒ S 要紅
const S_MUT = ([root, cls, on]) => {
  const p = document.querySelector(root), n = [...p.children].find(e => !e.matches(cls) && e.getClientRects().length);
  if (!n) return null;
  if (on) n.setAttribute('tabindex', '0'); else n.removeAttribute('tabindex');
  return __bsp.desc(n);
};
async function cardS(page, P, tag, key) {
  const c = CARDS2[key];
  const s = await page.evaluate(a => __bsp2.content(a), [c.root, c.cls]);
  ok(P(`S ${tag} ${key} 標題以外沒有可聚焦元素(W 零資訊的前提;有了就要改成真的走)`), s.length === 0, s.slice(0, 3).join('、'));
  const tgt = await page.evaluate(S_MUT, [c.root, c.cls, true]);
  const sm = await page.evaluate(a => __bsp2.content(a), [c.root, c.cls]);
  await page.evaluate(S_MUT, [c.root, c.cls, false]);
  ok(P(`N 突變:${tag} ${key} 內容列可聚焦 ⇒ S 量得到紅`), !!tgt && sm.length > 0, `${tgt || '找不到內容列'} → ${sm.length} 個`);
}
// J＋對照:容器 scroll-padding-top＝標題實高(v0925k 護照、修前車庫的寫法)⇒ 要紅。捲不太動的卡(可捲 < 40)量不出來,算不過
async function cardJ(page, P, tag, key, sel) {
  const c = CARDS2[key], id = c.root.slice(1);
  const j = await page.evaluate(JUMP, [id, sel]);
  ok(P(`J ${tag} ${key} 捲在下面時聚焦標題的鈕,內容不跳`), !j.none && j.max >= 40 && Math.abs(j.jump) <= 8,
    j.none ? '標題裡找不到鈕' : `${j.btn} 捲動 ${j.before}→${j.after}(可捲 ${j.max})`);
  await page.evaluate(([root, cls]) => { const p = document.querySelector(root); p.style.scrollPaddingTop = [...p.children].find(n => n.matches(cls)).getBoundingClientRect().height + 'px'; }, [c.root, c.cls]);
  const jn = await page.evaluate(JUMP, [id, sel]);
  await page.evaluate(root => { document.querySelector(root).style.scrollPaddingTop = ''; }, c.root);
  ok(P(`N 對照:${tag} ${key} 容器 scroll-padding-top ⇒ 聚焦標題的鈕內容會跳(J 量得到紅)`), !jn.none && Math.abs(jn.jump) > 8,
    jn.none ? '標題裡找不到鈕' : `${jn.btn} 捲動 ${jn.before}→${jn.after}`);
}

// ════ v0926j 平交道卡、落釘卡、附近車站卡:重畫不洗掉鍵盤焦點、不吞滑鼠點擊(格子說明見檔頭) ════
const XP_ROW = { pin: '.xc-row[data-no]', near: '.nx-top[data-st]' };
const XP_TRIG = { xing: 'renderCrossingCard()', pin: 'renderPinCard()', near: 'renderNearbyStations()' };
// 焦點的身分:卡頭的鈕看 id,落釘卡的列看車次｜系統,附近車站卡看 系統｜站名(重畫後是新節點,只能比身分)
const XP_INIT = `window.__xpk = a => a ? (a.id ? '#' + a.id : a.dataset && a.dataset.no ? a.dataset.no + '|' + (a.dataset.sys || '') : (a.dataset && a.dataset.st) || null) : null;`;
// 用鍵盤把焦點送到目標(程式聚焦不亮框,要真的按鍵;WebKit 要 Option):先程式聚焦 from,再照 keys 按(F=Tab、B=Shift+Tab)。
// 布置時先停住模擬(免得走到一半剛好重畫),xpHold 開始量時放回原本的播放狀態
async function xpFocus(page, eng, key, plans) {
  const F = eng === 'webkit' ? 'Alt+Tab' : 'Tab', B = eng === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab', root = CARDS2[key].root;
  await page.evaluate(XP_INIT);
  await page.evaluate(() => { if (window.__xpPlay0 === undefined) window.__xpPlay0 = state.playing; state.playing = false; });
  let at;
  for (const [from, ...keys] of plans) {
    await page.evaluate(([root, from]) => document.querySelector(root + ' ' + from).focus(), [root, from]);
    for (const k of keys) { await page.keyboard.press(k === 'F' ? F : B); await settle(page); }
    at = await page.evaluate(root => {
      const p = document.querySelector(root), a = document.activeElement; let fv = false; try { fv = a.matches(':focus-visible'); } catch (e) {}
      return { k: a && p.contains(a) ? __xpk(a) : null, fv, st: p.scrollTop, max: p.scrollHeight - p.clientHeight };
    }, root);
    if (at.k && at.fv) break;
  }
  return at;
}
const XP_PLANS = {
  '#xcClose': [['#xcClose', 'F', 'B'], ['#xcClose', 'B', 'F']],   // 平交道卡只有 ✕ 一顆:出去再回來
  '#pinSave': [['#pinClose', 'B']], '#pinClose': [['#pinSave', 'F']],
  row: (key, k) => [[key === 'pin' ? '#pinClose' : '#nearClose', ...Array(k).fill('F')]],   // 從卡頭最後一顆往前走 k 步＝第 k 列
};
// 焦點列捲出卡片可見範圍(使用者拿滾輪／手指捲過):列在上半就捲到底,否則捲回頂
const XP_AWAY = root => {
  const p = document.querySelector(root), a = document.activeElement, max = p.scrollHeight - p.clientHeight;
  const top0 = a.getBoundingClientRect().top - p.getBoundingClientRect().top + p.scrollTop;
  p.scrollTop = top0 < max / 2 ? max : 0;
  const r = a.getBoundingClientRect(), pr = p.getBoundingClientRect(), vt = pr.top + p.clientTop;
  return { max, st: p.scrollTop, out: r.bottom <= vt + 1 || r.top >= vt + p.clientHeight - 1 };
};
// 重畫 n 次(直接叫定時重畫叫的那支;模擬照原本狀態在跑,定時的也照常來)。期間每一幀記焦點有沒有離開那一顆、捲動有沒有動。
// WebKit 的聚焦捲動是非同步的,重畫完多等一下才讀
async function xpHold(page, key, n = 2) {
  const root = CARDS2[key].root;
  await page.evaluate(root => {
    const p = document.querySelector(root), k0 = __xpk(document.activeElement);
    window.__xh = { k0, st0: p.scrollTop, muts: 0, lost: null, moved: 0, done: false };
    window.__xhMO = new MutationObserver(recs => { if (recs.some(r => r.addedNodes.length)) __xh.muts++; });
    __xhMO.observe(p, { childList: true });
    const loop = () => {
      if (__xh.done) return;
      const a = document.activeElement;
      if (!__xh.lost && __xpk(a) !== k0) __xh.lost = __bsp.desc(a) || '(無)';
      if (Math.abs(p.scrollTop - __xh.st0) > 1) __xh.moved++;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    state.playing = window.__xpPlay0; window.__xpPlay0 = undefined;
  }, root);
  for (let i = 0; i < n; i++) { await page.evaluate(XP_TRIG[key]); await settle(page); }
  await page.waitForTimeout(150);
  return page.evaluate(root => {
    const p = document.querySelector(root), a = document.activeElement; let fv = false; try { fv = a.matches(':focus-visible'); } catch (e) {}
    __xh.done = true; __xhMO.disconnect();
    return { k0: __xh.k0, st0: __xh.st0, muts: __xh.muts, lost: __xh.lost, moved: __xh.moved, k: __xpk(a), fv, st: p.scrollTop };
  }, root);
}
const xhOk = h => h.muts >= 2 && !h.lost && !!h.k0 && h.k === h.k0 && h.fv && Math.abs(h.st - h.st0) <= 1 && h.moved === 0;
const fmtH = h => `重畫 ${h.muts} 次;焦點${h.lost ? `離開過(到 ${h.lost})` : '一幀都沒離開'}、最後在 ${h.k}(原本 ${h.k0}${h.fv ? '' : ',沒亮框'});` +
  `捲動 ${Math.round(h.st0)}→${Math.round(h.st)}${h.moved ? `(中途動過 ${h.moved} 幀)` : ''}`;
// K:鍵盤停在 target(卡頭的鈕,或 {row:k} 第 k 列)上,重畫兩次
async function xpK(page, eng, key, target, away = false) {
  const plans = typeof target === 'string' ? XP_PLANS[target] : XP_PLANS.row(key, target.row);
  const at = await xpFocus(page, eng, key, plans);
  if (!at.k || !at.fv) { await page.evaluate(() => { state.playing = window.__xpPlay0; window.__xpPlay0 = undefined; }); return { setup: false, at }; }
  const mv = away ? await page.evaluate(XP_AWAY, CARDS2[key].root) : null;
  return { setup: true, at, mv, h: await xpHold(page, key) };
}
const xkOk = r => r.setup && xhOk(r.h) && (!r.mv || r.mv.out);
const fmtK = r => !r.setup ? `鍵盤送不到目標(停在 ${r.at.k}${r.at.fv ? '' : ',沒亮框'})` : (r.mv ? `焦點列捲出可見範圍=${r.mv.out}(可捲 ${r.mv.max});` : '') + fmtH(r.h);
// E:鍵盤走到第 2 列按 key。落釘卡:跟那班車;附近車站卡:開那一站的看板。播放被切幾次用 COUNT_PLAY 數
async function xpE(page, eng, key, keyName) {
  const at = await xpFocus(page, eng, key, XP_PLANS.row(key, 2));
  await page.evaluate(() => { state.playing = window.__xpPlay0; window.__xpPlay0 = undefined; });
  if (!at.k || !at.fv) return { setup: false, at };
  await page.evaluate(COUNT_PLAY);
  await page.keyboard.press(keyName); await settle(page); await page.waitForTimeout(150);
  const r = await page.evaluate(([root, k0]) => {
    const p = document.querySelector(root), a = document.activeElement, n = window.__bspPlay;
    if (n % 2) window.__bspPlayOrig();
    return { plays: n, fol: state.followTrain ? String(state.followTrain.train) + '|' + (state.followTrain.sys || '') : null,
      board: state.boardStation ? state.boardStation.name : null, stay: !!(p && a && p.contains(a) && __xpk(a) === k0) };
  }, [CARDS2[key].root, at.k]);
  await page.evaluate(UNCOUNT_PLAY);
  const name = key === 'near' ? at.k.split('|').slice(1).join('|') : null;
  return { setup: true, k: at.k, ...r, hit: key === 'pin' ? r.fol === at.k : r.board === name };
}
const fmtE = e => !e.setup ? `鍵盤走不到第 2 列(停在 ${e.at.k})` : `第 2 列 ${e.k} → 跟車 ${e.fol}、看板 ${e.board}、播放被切 ${e.plays} 次、焦點${e.stay ? '還在那一列' : '離開了那一列'}`;
// C:滑鼠按在 sel 上。until='repaint' ⇒ 按住到卡片真的重畫過一次(最多 2.5 秒)才放開;數字 ⇒ 按住那麼多毫秒
async function xpPress(page, key, sel, until) {
  const root = CARDS2[key].root;
  const t = await page.evaluate(([root, sel]) => { const b = document.querySelector(root + ' ' + sel); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, no: b.dataset.no || null }; }, [root, sel]);
  if (!t) return { none: true };
  await page.evaluate(root => { window.__xc = { reps: 0 }; window.__xcMO = new MutationObserver(recs => { if (recs.some(r => r.addedNodes.length)) __xc.reps++; }); __xcMO.observe(document.querySelector(root), { childList: true }); setSpeed(1); state.playing = true; }, root);
  await page.mouse.move(t.x, t.y); await page.mouse.down();
  await page.evaluate(() => { __xc.reps = 0; });   // 只數按住期間
  if (until === 'repaint') await page.waitForFunction(() => __xc.reps >= 1, null, { timeout: 2500 }).catch(() => {});
  else await page.waitForTimeout(until);
  const during = await page.evaluate(() => __xc.reps);
  await page.mouse.up(); await settle(page); await page.waitForTimeout(100);
  return page.evaluate(([root, no, during]) => {
    __xcMO.disconnect(); const p = document.querySelector(root);
    return { during, closed: !p || p.hidden, followed: !!no && !!state.followTrain && String(state.followTrain.train) === no, no };
  }, [root, t.no, during]);
}
// Q:倍速 speed 放 3 秒,數卡片整段重畫幾次
const XP_RATE = async ([root, speed]) => {
  const p = document.querySelector(root); let n = 0;
  const mo = new MutationObserver(recs => { if (recs.some(r => r.addedNodes.length)) n++; }); mo.observe(p, { childList: true });
  setSpeed(speed); state.playing = true;
  await new Promise(r => setTimeout(r, 3000));
  mo.disconnect(); setSpeed(1);
  return n;
};
// 對照用的替身(index.html 的這幾支都是全域函式宣告,換掉 window 上的名字,呼叫端就會叫到替身)
const XP_MUT = {
  noRefocus: () => { window.__xpRF = boardRefocus; window.boardRefocus = () => {}; },
  scrollRefocus: () => { window.__xpRF = boardRefocus; window.boardRefocus = (el, sel) => { const n = sel && el.querySelector(sel); if (n && n !== document.activeElement) n.focus(); }; },
  undoRefocus: () => { window.boardRefocus = window.__xpRF; },
  // 卡頭也每次整張換(照樣放回焦點)／整張換又不放回(修前的寫法)
  wholeHead: () => { window.__xpXP = xcPaint; window.xcPaint = (el, head, rest) => { const fk = boardFocusSel(el); el.innerHTML = head + rest; el._xcHead = head; boardRefocus(el, fk); }; },
  wholeNoRefocus: () => { window.__xpXP = xcPaint; window.xcPaint = (el, head, rest) => { el.innerHTML = head + rest; el._xcHead = head; }; },
  undoPaint: () => { window.xcPaint = window.__xpXP; },
  noHold: () => { window.__xpHeld = pinCardHeld; window.pinCardHeld = () => false; },
  undoHold: () => { window.pinCardHeld = window.__xpHeld; },
  // 修前的節拍:模擬時間差 ≥ 1 秒就重畫(高倍速一幀就跳過 1 秒)
  simTick: () => { window.__xpDue = xcRepaintDue; window.xcRepaintDue = at => Math.abs(state.simSec - (at || 0)) >= 1; },
  undoTick: () => { window.xcRepaintDue = window.__xpDue; },
};
// 附近車站卡、落釘卡的 W、E 與對照(列可聚焦之後 S 的前提不成立,改成真的走)
async function xpRowsWE(page, eng, P, tag, key) {
  const nRows = await page.evaluate(([root, sel]) => document.querySelectorAll(root + ' ' + sel).length, [CARDS2[key].root, XP_ROW[key]]);
  const w = await walk2(page, eng, key, -1);
  ok(P(`W ${tag} ${key} 鍵盤往回走過每一列,焦點不被卡頭蓋`), nRows >= 4 && w.covered === 0 && w.content >= nRows, `列 ${nRows};${fmtW(w)}`);
  const wm = await withMut(page, MUT.noCardPad, async () => { await open2(page, key); return walk2(page, eng, key, -1); });
  ok(P(`N 突變:拿掉卡內讓位 ⇒ ${tag} ${key} 往回走停在卡頭下(W 量得到紅)`), wm.covered > 0, fmtW(wm));
  await open2(page, key);
  const e = await xpE(page, eng, key, 'Enter');
  ok(P(`E ${tag} ${key} 第 2 列按 Enter＝點一下(${key === 'pin' ? '跟那班車' : '開那一站的看板'}),播放不動`), e.setup && e.hit && e.plays === 0, fmtE(e));
  await open2(page, key);
  const sp = await xpE(page, eng, key, ' ');
  ok(P(`E ${tag} ${key} 第 2 列按空白鍵只切一次播放,列不動、焦點留在那一列`), sp.setup && !sp.fol && !sp.board && sp.plays === 1 && sp.stay, fmtE(sp));
  await open2(page, key);
  // 卡片元素常駐、接線只掛一次(重畫不會重掛):拿掉之後要自己放回去
  await page.evaluate(root => { const p = document.querySelector(root); window.__xpKD = p.onkeydown; p.onkeydown = null; }, CARDS2[key].root);
  const en = await xpE(page, eng, key, 'Enter');
  await page.evaluate(root => { document.querySelector(root).onkeydown = window.__xpKD; }, CARDS2[key].root);
  ok(P(`N 突變:拿掉 ${tag} ${key} 的 Enter 接線 ⇒ Enter 沒反應(E 量得到紅)`), en.setup && !en.hit, fmtE(en));
}
// 360 直式:附近車站卡(sheet,8 站捲得動;網頁版不定時重畫,App 定位更新時才重畫 ⇒ 這裡直接叫 renderNearbyStations)
async function xpNear360(page, eng, P) {
  const cell = async (label, target, away, mut) => {
    await open2(page, 'near');
    if (mut) await page.evaluate(XP_MUT[mut]);
    try { return await xpK(page, eng, 'near', target, away); } finally { if (mut) await page.evaluate(XP_MUT.undoRefocus); }
  };
  const k = await cell('K', { row: 3 }, false);
  ok(P('K 360 附近車站卡:鍵盤停在第 3 站,重畫兩次後焦點還在同一站、捲動沒動'), xkOk(k), fmtK(k));
  const r = await cell('R', { row: 1 }, true);
  ok(P('R 360 附近車站卡:第 1 站被捲出可見範圍後重畫,捲動不動、焦點還在那一站'), xkOk(r), fmtK(r));
  const kn = await cell('K', { row: 3 }, false, 'noRefocus');
  ok(P('N 突變:重畫後不放回焦點 ⇒ 附近車站卡焦點掉(K 量得到紅)'), kn.setup && !xkOk(kn) && !!kn.h.lost, fmtK(kn));
  const rn = await cell('R', { row: 1 }, true, 'scrollRefocus');
  ok(P('N 突變:放回焦點不帶 preventScroll ⇒ 附近車站卡被捲回焦點那一站(R 量得到紅)'), rn.setup && rn.mv && rn.mv.out && Math.abs(rn.h.st - rn.h.st0) > 1, fmtK(rn));
  await open2(page, 'near');
  await xpRowsWE(page, eng, P, '360', 'near');
}
// 844×390 橫式:平交道卡、落釘卡由 SHORT_CARD 壓成捲得動的卡(v0926l 起真的版面放得下全部列、不捲了)。卡頭的鈕 K、落釘卡的列 K／R／W／E
async function xp844(page, eng, P) {
  const cell = async (key, target, away, mut) => {
    await open2(page, key);
    if (mut) await page.evaluate(XP_MUT[mut]);
    try { return await xpK(page, eng, key, target, away); }
    finally { if (mut === 'wholeNoRefocus') await page.evaluate(XP_MUT.undoPaint); else if (mut) await page.evaluate(XP_MUT.undoRefocus); }
  };
  for (const [key, btn] of [['xing', '#xcClose'], ['pin', '#pinSave'], ['pin', '#pinClose']]) {
    const k = await cell(key, btn, false);
    ok(P(`K 844×390 ${key} 鍵盤停在卡頭的 ${btn},重畫兩次後焦點還在它身上、捲動沒動`), xkOk(k), fmtK(k));
  }
  const k = await cell('pin', { row: 3 }, false);
  ok(P('K 844×390 落釘卡:鍵盤停在第 3 班,重畫兩次後焦點還在同一班、捲動沒動'), xkOk(k), fmtK(k));
  const r = await cell('pin', { row: 1 }, true);
  ok(P('R 844×390 落釘卡:第 1 班被捲出可見範圍後重畫,捲動不動、焦點還在那一班'), xkOk(r), fmtK(r));
  const kn = await cell('pin', { row: 3 }, false, 'noRefocus');
  ok(P('N 突變:重畫後不放回焦點 ⇒ 落釘卡列上的焦點掉(K 量得到紅)'), kn.setup && !xkOk(kn) && !!kn.h.lost, fmtK(kn));
  const rn = await cell('pin', { row: 1 }, true, 'scrollRefocus');
  ok(P('N 突變:放回焦點不帶 preventScroll ⇒ 落釘卡被捲回焦點那一班(R 量得到紅)'), rn.setup && rn.mv && rn.mv.out && Math.abs(rn.h.st - rn.h.st0) > 1, fmtK(rn));
  // 卡頭的鈕有兩道:卡頭沒變就不換、換了也放回焦點。只拿掉一道它還是綠的(另一道擋著),兩道都拿掉才考得到這格有牙
  const hn = await cell('xing', '#xcClose', false, 'wholeNoRefocus');
  ok(P('N 突變:卡頭每次整張換、又不放回焦點(修前的寫法)⇒ 平交道卡 ✕ 上的焦點掉(K 量得到紅)'), hn.setup && !xkOk(hn) && !!hn.h.lost, fmtK(hn));
  await open2(page, 'pin');
  await xpRowsWE(page, eng, P, '844×390', 'pin');
}
// 1280 桌面:滑鼠按住跨過重畫(C)、高倍速重畫次數(Q)、已存→存(卡頭真的換了,只剩放回焦點那一道)
async function xp1280(page, eng, P) {
  await page.evaluate(XP_INIT);
  const press = async (key, sel, until, mut, undo) => {
    await open2(page, key);
    const play0 = await page.evaluate(() => state.playing);
    if (mut) await page.evaluate(XP_MUT[mut]);
    try { return await xpPress(page, key, sel, until); } finally { if (undo) await page.evaluate(XP_MUT[undo]); await page.evaluate(p => { state.playing = p; }, play0); }
  };
  const cx = await press('xing', '#xcClose', 'repaint');
  ok(P('C 1280 平交道卡:滑鼠按住 ✕ 到碰上一次重畫再放開,卡照樣關'), cx.during >= 1 && cx.closed, `按住期間重畫 ${cx.during} 次、卡${cx.closed ? '關了' : '還開著'}`);
  const cxn = await press('xing', '#xcClose', 'repaint', 'wholeHead', 'undoPaint');
  ok(P('N 突變:卡頭每次整張換(照樣放回焦點)⇒ 按住 ✕ 碰上重畫,放開後卡沒關(C 量得到紅)'), cxn.during >= 1 && !cxn.closed, `按住期間重畫 ${cxn.during} 次、卡${cxn.closed ? '關了' : '還開著'}`);
  const cp = await press('pin', '.xc-row[data-no]', 1300);
  ok(P('C 1280 落釘卡:滑鼠按住第 1 班 1.3 秒再放開,照樣跟那班車(按住時不重畫)'), cp.followed && cp.during === 0, `按住期間重畫 ${cp.during} 次、跟車 ${cp.followed}(${cp.no})`);
  const cpn = await press('pin', '.xc-row[data-no]', 1300, 'noHold', 'undoHold');
  ok(P('N 突變:按住照樣重畫 ⇒ 放開後沒跟車(C 量得到紅)'), cpn.during >= 1 && !cpn.followed, `按住期間重畫 ${cpn.during} 次、跟車 ${cpn.followed}(${cpn.no})`);
  for (const key of ['xing', 'pin']) {
    await open2(page, key);
    const n = await page.evaluate(XP_RATE, [CARDS2[key].root, 60]);
    ok(P(`Q 1280 ${key} 60× 每真實秒重畫一次上下(3 秒 2–4 次;修前 40–48 次／秒)`), n >= 2 && n <= 4, `3 秒 ${n} 次`);
  }
  if (eng === 'chromium') {   // 節拍跟引擎無關,只做一個
    await open2(page, 'pin'); await page.evaluate(XP_MUT.simTick);
    const nn = await page.evaluate(XP_RATE, [CARDS2.pin.root, 60]);
    await page.evaluate(XP_MUT.undoTick);
    ok(P('N 突變:節拍改回「模擬時間差 ≥ 1 秒」⇒ 60× 幾乎每幀重畫(Q 量得到紅)'), nn > 12, `3 秒 ${nn} 次`);
  }
  // 已存的地點:鍵盤停在「已存」按 Enter ＝ 取消收藏,卡頭換成「存」(整張換),焦點要留在那顆鈕上
  const unsave = async mut => {
    await page.evaluate(() => savePins([{ lat: 25.0143, lon: 121.4637, label: '測試地點' }]));
    await open2(page, 'pin');
    if (mut) await page.evaluate(XP_MUT[mut]);
    try {
      const at = await xpFocus(page, eng, 'pin', XP_PLANS['#pinSave']);
      await page.evaluate(() => { state.playing = window.__xpPlay0; window.__xpPlay0 = undefined; });
      const before = await page.evaluate(() => document.getElementById('pinSave').textContent);
      await page.keyboard.press('Enter'); await settle(page); await page.waitForTimeout(150);
      return page.evaluate(([at, before]) => {
        const a = document.activeElement; let fv = false; try { fv = a.matches(':focus-visible'); } catch (e) {}
        return { at: at.k, before, after: (document.getElementById('pinSave') || {}).textContent, k: __xpk(a), fv, saved: pinSavedIdx(25.0143, 121.4637) >= 0 };
      }, [at, before]);
    } finally { if (mut) await page.evaluate(XP_MUT.undoRefocus); }
  };
  const fmtU = u => `${u.at} 「${u.before}」→「${u.after}」、地點${u.saved ? '還存著' : '已移除'};焦點在 ${u.k}${u.fv ? '' : '(沒亮框)'}`;
  const u = await unsave(null);
  ok(P('K 1280 落釘卡:鍵盤在「已存」按 Enter 取消收藏,卡頭換成「存」,焦點留在那顆鈕上'), u.at === '#pinSave' && !u.saved && u.before !== u.after && u.k === '#pinSave' && u.fv, fmtU(u));
  const un = await unsave('noRefocus');
  ok(P('N 突變:重畫後不放回焦點 ⇒ 取消收藏後焦點掉(K 量得到紅)'), un.at === '#pinSave' && !un.saved && un.k !== '#pinSave', fmtU(un));
}
// V(v0926j):落釘卡的班次、附近車站卡的站名是新的焦點停點,框要看得到——往前走到卡底不被切、有框、列的框對底下 ≥ 3:1。
// 卡頭 ✕／存 在亮色主題只有 1.9:1(紅框疊藏青,修前就有,另案)⇒ 只看列的對比,不套 vOk 的整體對比。
// 突變兩條各自那格要紅:拿掉附近車站卡列的底部讓位 ⇒ 站名往前走到卡底框的下緣被切;落釘卡的列框改回往外畫 ⇒ 左右被卡片切掉。
async function xpRing360(page, eng, P) {
  const walkV = async (key, id) => { await open2(page, key); return ringWalk(page, eng, id, 'fwd'); };
  for (const [key, id, el] of [['pin', 'pinCard', 'div.xc-row'], ['near', 'nearCard', 'div.nx-top']]) {
    const v = await walkV(key, id);
    ok(P(`V 360 ${key} 往前走:列的框不被卡片切、有框、對比 ≥ 3(卡頭鈕的對比另案)`),
      v.fv >= 6 && v.clipped === 0 && v.noRing === 0 && v.seen.includes(el) && (v.seenC[el] ?? 0) >= 3, `${fmtV(v)}；走過 ${fmtSeen(v)}`);
  }
  const vb = await withMut(page, '.xing-card .nx-row * { scroll-margin-bottom: 0 !important; }', () => walkV('near', 'nearCard'));
  ok(P('N 突變:拿掉附近車站卡列的底部讓位 ⇒ 站名往前走到卡底,框的下緣被切(V 量得到紅)'), badHas(vb, 'div.nx-top', '切掉b'), fmtV(vb));
  const vo = await withMut(page, '.xing-card .xc-row[data-no]:focus-visible { outline-offset: 2px !important; }', () => walkV('pin', 'pinCard'));
  ok(P('N 突變:落釘卡的列框改回往外畫 ⇒ 左右被卡片切掉(V 量得到紅)'), badHas(vo, 'div.xc-row', '切掉'), fmtV(vo));
}

// ════ v0926l 矮橫式的平交道卡、落釘卡、台糖卡改坐側欄槽位(L;格子說明見檔頭) ════
const LC_KEYS = ['xing', 'pin', 'sugar'];
// 剛打開(捲在頂端)時卡頭以下的可視高,與第一個內容單位:平交道卡、落釘卡是第一列,台糖卡沒有列、是說明文字的第一行。
// 列高、行高都當場量,不寫死
const LC_MEASURE = root => {
  const p = document.querySelector(root);
  if (!p || p.hidden || !p.getClientRects().length) return { shown: false };
  const f = n => +n.toFixed(1), pr = p.getBoundingClientRect(), portTop = pr.top + p.clientTop, portBot = portTop + p.clientHeight;
  const head = p.querySelector(':scope > .xc-head'), headBot = Math.max(portTop, head ? head.getBoundingClientRect().bottom : portTop);
  const row = p.querySelector('.xc-row'), body = p.querySelector('.sg-body');
  let u = null;
  if (row) { const r = row.getBoundingClientRect(); u = { kind: '列', top: r.top, h: r.height }; }
  else if (body) {
    const cs = getComputedStyle(body), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
    u = { kind: '行字', top: body.getBoundingClientRect().top + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0), h: lh };
  }
  const tb = document.getElementById('topbar'), at = [...document.querySelectorAll('.maplibregl-ctrl-attrib')].find(e => e.getClientRects().length);
  return { shown: true, none: !u, kind: u && u.kind, unit: u ? f(u.h) : 0, st: p.scrollTop, client: p.clientHeight, sh: p.scrollHeight, head: f(headBot - portTop),
    vis: f(portBot - headBot), firstIn: !!u && u.top >= headBot - 0.5 && u.top + u.h <= portBot + 0.5,
    top: f(pr.top), right: f(pr.right), bottom: f(pr.bottom), vw: innerWidth,
    tbBot: tb ? f(tb.getBoundingClientRect().bottom) : null, attTop: at ? f(at.getBoundingClientRect().top) : null };
};
const lcOk = m => m.shown && !m.none && m.st === 0 && m.vis >= m.unit && m.firstIn;
const fmtLc = m => !m.shown ? '沒開出來' : m.none ? '找不到列或說明文字' :
  `卡高 ${m.client}、卡頭 ${m.head}、內容可視 ${m.vis}、第一${m.kind} ${m.unit}${m.firstIn ? '' : '(沒整個露出來)'}${m.st ? `、捲在 ${m.st}` : ''}`;
async function lcCells(page) {
  const out = {};
  for (const key of LC_KEYS) out[key] = (await open2(page, key)) ? await page.evaluate(LC_MEASURE, CARDS2[key].root) : { shown: false };
  return out;
}
// N:把修法從樣式表拿掉(拿掉的就是 index.html 裡那幾條,不是另外寫一份修前的值去蓋)、量完原位放回。
// need='' 拿掉兩條(槽位＋--rail-occupy);need=':has(' 只拿掉 --rail-occupy 那條。找不到回 0,對照那格照樣算紅(改了選擇器就要跟著改這裡)
const LC_DROP = ([on, need]) => {
  if (!on) { for (const d of (window.__lcDrop || []).reverse()) d.parent.insertRule(d.css, d.i); window.__lcDrop = []; return 0; }
  window.__lcDrop = [];
  const walk = parent => {
    for (let i = parent.cssRules.length - 1; i >= 0; i--) {
      const r = parent.cssRules[i], s = r instanceof CSSStyleRule ? r.selectorText : '';
      if (s.includes('#xingCard') && s.includes('#sugarCard') && s.includes(need)) { __lcDrop.push({ parent, i, css: r.cssText }); parent.deleteRule(i); }
      else if (r.cssRules) walk(r);
    }
  };
  for (const ss of document.styleSheets) { try { walk(ss); } catch (e) {} }
  return __lcDrop.length;
};
async function lcDropped(page, fn, need = '') {
  const n = await page.evaluate(LC_DROP, [true, need]);
  try { return { n, r: await fn() }; } finally { await page.evaluate(LC_DROP, [false, need]); }
}
// L:剛打開時卡頭以下放得下第一個內容單位。N:拿掉修法 ⇒ mustRed 點名的卡要紅
// (844×390 修前平交道卡還露得出一列、台糖卡一行,只有落釘卡紅;667×375 三張都紅)
async function lcLand(page, P, tag, mustRed) {
  const m = await lcCells(page);
  for (const key of LC_KEYS) ok(P(`L ${tag} ${key} 卡頭以下放得下第一${m[key].kind || '列'}`), lcOk(m[key]), fmtLc(m[key]));
  const d = await lcDropped(page, () => lcCells(page));
  const red = LC_KEYS.filter(k => !lcOk(d.r[k]));
  ok(P(`N 突變:拿掉側欄槽位 ⇒ ${tag} ${mustRed.join('、')} 的 L 紅`), d.n > 0 && mustRed.every(k => red.includes(k)),
    d.n ? `拿掉 ${d.n} 條;` + LC_KEYS.map(k => `${k} ${fmtLc(d.r[k])}`).join('；') : '樣式表裡找不到那幾條規則');
}
// 瀏海在右邊(App 殼寫 --safe-area-inset-right;59px 是 iPhone 橫放的量級):卡的右緣不進安全區
async function lcSafeArea(page, P, tag) {
  const SA = 59, inSafe = m => m.shown && m.right <= m.vw - SA + 0.5;
  const set = v => page.evaluate(v => { const s = document.documentElement.style; if (v) s.setProperty('--safe-area-inset-right', v + 'px'); else s.removeProperty('--safe-area-inset-right'); }, v);
  await set(SA);
  try {
    const m = await lcCells(page);
    ok(P(`L ${tag} 右側有 ${SA}px 瀏海時,三張卡的右緣不進安全區`), LC_KEYS.every(k => inSafe(m[k])), LC_KEYS.map(k => `${k} 右緣 ${m[k].right}/${m[k].vw - SA}`).join('、'));
    const d = await lcDropped(page, () => lcCells(page));
    ok(P(`N 突變:拿掉側欄槽位 ⇒ ${tag} 瀏海時卡的右緣進安全區(量得到紅)`), d.n > 0 && LC_KEYS.every(k => !inSafe(d.r[k])),
      LC_KEYS.map(k => `${k} 右緣 ${d.r[k].right}`).join('、'));
  } finally { await set(0); }
}
// 版權列(地圖授權)不能被蓋:挑內容撐到最高的台糖卡量下緣。N:下緣改用 sheet 家族的 tabbar-clear+8(不讓版權列那一行)⇒ 紅
async function lcAttrib(page, P, tag) {
  const clear = m => m.shown && m.attTop != null && m.bottom <= m.attTop + 0.5;
  const one = () => open2(page, 'sugar').then(() => page.evaluate(LC_MEASURE, CARDS2.sugar.root));
  const m = await one();
  ok(P(`L ${tag} 台糖卡撐到最高也不蓋版權列`), clear(m) && m.sh > m.client,
    `下緣 ${m.bottom}／版權列上緣 ${m.attTop ?? '找不到'};內容 ${m.sh}、卡 ${m.client}(內容要比卡高,卡撐到最高才算數)`);
  const mm = await withMut(page, 'body.fs :is(#xingCard, #pinCard, #sugarCard) { --xc-bot: calc(var(--tabbar-clear) + 8px) !important; }', one);
  ok(P(`N 突變:卡的下緣改用 sheet 家族那條 ⇒ ${tag} 台糖卡蓋到版權列(量得到紅)`), mm.shown && mm.attTop != null && !clear(mm), `下緣 ${mm.bottom}／版權列上緣 ${mm.attTop}`);
}
// 卡坐進側欄 ⇒ 速度膠囊、特大字級提示卡照契約8 讓開。量卡與它們的相交面積(提示卡沒出現就不看)。N:只拿掉 --rail-occupy 那條 ⇒ 紅
const LC_CLEAR = root => {
  const c = document.querySelector(root).getBoundingClientRect();
  const hit = sel => {
    const e = document.querySelector(sel);
    if (!e || e.hidden || !e.getClientRects().length || getComputedStyle(e).visibility === 'hidden' || +getComputedStyle(e).opacity === 0) return null;
    const r = e.getBoundingClientRect(), w = Math.min(c.right, r.right) - Math.max(c.left, r.left), h = Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top);
    return w > 0.5 && h > 0.5 ? `${Math.round(w)}×${Math.round(h)}` : '';
  };
  return { controls: hit('.controls'), hint: hit('#landFsHint') };
};
const clearOk = c => c.controls === '' && !c.hint;
const fmtClear = c => `速度膠囊 ${c.controls === null ? '不在' : c.controls || '不相交'}、提示卡 ${c.hint === null ? '不在' : c.hint || '不相交'}`;
async function lcYield(page, P, tag) {
  const all = async () => { const o = {}; for (const k of LC_KEYS) o[k] = (await open2(page, k)) ? await page.evaluate(LC_CLEAR, CARDS2[k].root) : { controls: null, hint: null }; return o; };
  const c = await all();
  ok(P(`L ${tag} 卡開著時速度膠囊、特大字級提示卡讓開側欄,不跟卡相交(兩者都要在場)`), LC_KEYS.every(k => clearOk(c[k]) && c[k].hint !== null),
    LC_KEYS.map(k => `${k} ${fmtClear(c[k])}`).join('；'));
  const d = await lcDropped(page, all, ':has(');
  ok(P(`N 突變:拿掉 --rail-occupy 那條 ⇒ ${tag} 速度膠囊、提示卡壓到卡(量得到紅)`), d.n > 0 && LC_KEYS.every(k => !!d.r[k].controls && !!d.r[k].hint),
    d.n ? LC_KEYS.map(k => `${k} ${fmtClear(d.r[k])}`).join('；') : '樣式表裡找不到那條規則');
}
// 直式照舊(側欄槽位只給矮橫式):三張卡的上緣在頂列之下、放得下第一列。N:槽位的上錨漏進直式 ⇒ 紅
async function lcPortrait(page, P) {
  const below = m => m.shown && m.tbBot != null && m.top >= m.tbBot;
  const m = await lcCells(page);
  for (const key of LC_KEYS) ok(P(`L 360 ${key} 直式照舊:上緣在頂列之下、放得下第一${m[key].kind || '列'}`), lcOk(m[key]) && below(m[key]),
    `${fmtLc(m[key])}、上緣 ${m[key].top}／頂列底 ${m[key].tbBot}`);
  const lk = await withMut(page, 'body.fs :is(#xingCard, #pinCard, #sugarCard) { top: calc(8px + var(--sa-t)) !important; }', () => lcCells(page));
  ok(P('N 突變:側欄槽位的上錨漏進直式 ⇒ 360 三張卡的 L 紅'), LC_KEYS.every(k => lk[k].shown && !below(lk[k])), LC_KEYS.map(k => `${k} 上緣 ${lk[k].top}`).join('、'));
}
// 修好之後三張卡在橫式放得下全部列、不捲了;下面 844×390 的 J／K／R／W 考的是「捲得動的卡」裡的讓位與重畫放回焦點(JS 行為)。
// 用測試專用樣式把卡壓回捲得動的高度(卡頭＋兩列上下);前提由各格自己把關(J 要可捲 ≥ 40、R 要第 1 班真的捲出可見範圍、W 要走過每一列)
const SHORT_CARD = ':is(#xingCard, #pinCard, #sugarCard) { max-height: 100px !important; }';
const setShort = (page, on) => page.evaluate(([css, on]) => {
  document.getElementById('__bspShort')?.remove();
  if (on) { const el = document.createElement('style'); el.id = '__bspShort'; el.textContent = css; document.head.appendChild(el); }
}, [SHORT_CARD, on]);

let t0Done = false;
for (const [eng, bt] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await bt.launch({ headless: true });
  const P = s => `${eng} ${s}`;

  // ── 360×780 直式標準字級 ─────────────────────────────────────────────────
  {
    const { ctx, page, errors } = await boot(browser, { width: 360, height: 780 });
    if (!t0Done) {
      t0Done = true;
      const served = await page.evaluate(() => typeof BUILD !== 'undefined' ? BUILD : '?');
      ok('T0 服務端 BUILD 與本機檔案一致', served === localBuild, `served=${served} local=${localBuild}`);
    }
    // W:走過的內容拍數下限(當下量到的可聚焦數推導,不寫死):長面板至少走完一半,短面板至少 2 拍
    for (const key of ['favPanel', 'board', 'trackPanel', 'searchPanel', 'ridePanel']) {
      const opened = await open(page, key);
      if (!opened) { ok(P(`W 360 ${key} 打得開`), false); continue; }
      const w = await walk(page, eng, ELEM[key]);
      const need = Math.max(2, Math.min(20, Math.floor(w.n / 2)));
      ok(P(`W 360 ${key} 鍵盤往回走,焦點不被固定段蓋住`), w.covered === 0 && w.content >= need,
        `被蓋 ${w.covered}/${w.content} 拍(可聚焦 ${w.n}、至少要走 ${need})${w.bad.length ? '；' + w.bad.join('、') : ''}`);
    }
    // J
    for (const key of ['favPanel', 'board', 'trackPanel', 'ridePanel']) {
      await open(page, key);
      const j = await page.evaluate(JUMP, [ELEM[key], H3_BTN]);
      ok(P(`J 360 ${key} 捲在下面時聚焦標題的鈕,內容不跳`), !j.none && j.max >= 150 && Math.abs(j.jump) <= 8,
        j.none ? '標題裡找不到鈕' : `${j.btn} 捲動 ${j.before}→${j.after}(可捲 ${j.max})`);
    }
    // F
    await open(page, 'trackPanel');
    const f = await page.evaluate(FIELD);
    ok(P('F 360 被蓋住的文字欄位 #rdSearch 聚焦後讓出來、半秒後也沒被捲回去'), !f.none && f.over0 > 20 && f.over1 <= 0.5 && f.over2 <= 0.5,
      f.none ? '#rdSearch 不在畫面上' : `聚焦前壓 ${f.over0}px → 下一拍 ${f.over1} → 半秒後 ${f.over2}(≤0 才算讓出)`);
    if (eng === 'webkit') {
      // N:拿掉聚焦補捲 ⇒ WebKit 只剩 scroll-margin,文字欄位聚焦後仍壓在標題下(F 要量得到紅);量完掛回去
      await open(page, 'trackPanel');
      await page.evaluate(() => { for (const b of document.querySelectorAll('.board')) b.removeEventListener('focusin', boardRevealField); });
      const fm = await page.evaluate(FIELD);
      await page.evaluate(() => { for (const b of document.querySelectorAll('.board')) b.addEventListener('focusin', boardRevealField); });
      ok(P('N 突變:拿掉 boardRevealField ⇒ #rdSearch 聚焦後仍壓在標題下(F 量得到紅)'), !fm.none && fm.over0 > 20 && (fm.over1 > 0.5 || fm.over2 > 0.5),
        fm.none ? '#rdSearch 不在畫面上' : `聚焦前壓 ${fm.over0}px → 下一拍 ${fm.over1} → 半秒後 ${fm.over2}`);
    }
    // W:三張清單面板
    for (const key of ['todayPanel', 'busStopPanel', 'tripPanel']) await listWalk(page, eng, P, key, '360');
    // E:列可以用鍵盤觸發,做的事跟點一下一樣——今日動態展開逐站歷程、行程分享拿那一站分享(shareTrip 換成記錄器,不叫出真的分享)。
    // 空白鍵同樣觸發,而且不能順便切到全站快捷鍵的播放／暫停。公車站牌的列點了本來就沒有動作,只驗重畫後焦點留在原列(R)。
    await open(page, 'todayPanel');
    const te = await rowPress(page, eng, 'todayPanel', 'Enter');
    ok(P('E 360 今日動態:鍵盤走到第一列按 Enter,展開逐站歷程、焦點留在那一列'), tdOk(te), fmtTd(te));
    await page.keyboard.press('Enter'); await settle(page); await page.waitForTimeout(150);
    const tc = await page.evaluate(ROW_STATE, ['todayPanel', LIST_ROWS.todayPanel]);
    ok(P('E 360 今日動態:再按一次 Enter 收合,焦點還在那一列'), tdOk(te) && tc.todayOpen === null && tc.exp === 'false' && tc.onRow && tc.key === te.first,
      `收合後 展開=${tc.todayOpen} aria-expanded=${tc.exp} 焦點=${tc.onRow ? tc.key : '離開了列'}`);
    // 空白鍵照全站慣例只做播放／暫停(v0926h):在列上按,列不動、播放切一次、焦點留在那一列
    await open(page, 'todayPanel');
    const ts = await spacePress(page, () => rowPress(page, eng, 'todayPanel', ' '));
    ok(P('E 360 今日動態:空白鍵只切一次播放／暫停,列不展開、焦點留在那一列'), spaceRowOk(ts) && ts.after.todayOpen === null,
      `${fmtTd(ts)} 播放被切 ${ts.plays} 次`);
    await open(page, 'tripPanel'); await page.evaluate(STUB_SHARE);
    const tr = await rowPress(page, eng, 'tripPanel', 'Enter');
    ok(P('E 360 行程分享:鍵盤走到第一列按 Enter,拿那一站分享、面板收起、不動播放／暫停'),
      tpOk(tr) && tr.after.playing === tr.at.playing, `${fmtTp(tr)} 播放 ${tr.at.playing}→${tr.after.playing}`);
    await open(page, 'tripPanel'); await page.evaluate(STUB_SHARE);
    const tsp = await spacePress(page, () => rowPress(page, eng, 'tripPanel', ' '));
    ok(P('E 360 行程分享:空白鍵只切一次播放／暫停,不分享、面板開著、焦點留在那一列'),
      spaceRowOk(tsp) && tsp.after.open && tsp.after.shared.length === 0, `${fmtTp(tsp)} 播放被切 ${tsp.plays} 次`);
    await open(page, 'tripPanel');
    const th = await tripHoldSpace(page, eng);
    ok(P('E 360 行程分享:按住空白鍵(連發 4 下)播放只切一次、不分享、焦點留在那一列'), holdOk(th), fmtHold(th));
    // 按鈕上按空白鍵:今日動態的 × 被按下去的話面板會關;焦點要留在 ×(v0718i 起原本把按鈕 blur 掉,焦點掉回頁面)
    await open(page, 'todayPanel');
    const bs = await spacePress(page, () => keyOn(page, '#todayPanel > h3 .close', ' '));
    ok(P('E 360 按鈕上按空白鍵:只切一次播放／暫停,× 沒被按下去(面板開著)、焦點留在 ×'), btnSpaceOk(bs), fmtKey(bs));
    // 資料狀態徽章(role=button):Enter 開資料卡、不動播放;空白鍵只切播放、不開卡
    await page.evaluate(CLOSE_ALL);
    const badge = await page.evaluate(() => { const b = document.getElementById('statBadge'); return !!(b && b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden'); });
    ok(P('E 360 資料狀態徽章看得到(量得到的前提)'), badge);
    if (badge) {
      const be = await spacePress(page, () => keyOn(page, '#statBadge', 'Enter'));
      await page.evaluate(() => statPopSet(false));
      ok(P('E 360 資料狀態徽章:Enter 打開資料卡、播放不動'), be.statPop && be.plays === 0, fmtKey(be));
      const bsp = await spacePress(page, () => keyOn(page, '#statBadge', ' '));
      await page.evaluate(() => statPopSet(false));
      ok(P('E 360 資料狀態徽章:空白鍵只切一次播放／暫停,不開資料卡、焦點留在徽章'), !bsp.statPop && bsp.plays === 1 && bsp.stay, fmtKey(bsp));
      // N:徽章也接空白鍵(原本的寫法:開卡又沒擋冒泡)⇒ 空白鍵那格要紅
      await page.evaluate(() => { window.__bspBadgeKD = e => { if (e.key === ' ') { e.preventDefault(); statPopSet(document.getElementById('statPop').hidden); } }; document.getElementById('statBadge').addEventListener('keydown', window.__bspBadgeKD); });
      const nbsp = await spacePress(page, () => keyOn(page, '#statBadge', ' '));
      await page.evaluate(() => { document.getElementById('statBadge').removeEventListener('keydown', window.__bspBadgeKD); statPopSet(false); });
      ok(P('N 突變:徽章也接空白鍵 ⇒ 按一下同時開資料卡又切播放(E 徽章那格量得到紅)'), !(!nbsp.statPop && nbsp.plays === 1 && nbsp.stay), fmtKey(nbsp));
    }
    // R:公車站牌重抓後焦點留在同一列;焦點列被捲出畫面時重抓,清單也不能被捲回去
    await open(page, 'busStopPanel');
    await rowPress(page, eng, 'busStopPanel', null, HOPS.busStopPanel + 2);
    const br = await busRefresh(page, false);
    ok(P('R 360 公車站牌:鍵盤停在第 3 列時重抓,焦點留在同一列、捲動不動'), busOk(br), fmtBus(br));
    const bra = await busRefresh(page, true);
    ok(P('R 360 公車站牌:焦點列被捲出畫面後重抓,焦點留在那一列、清單不被捲回去'), busOk(bra), fmtBus(bra));
    // V:焦點框看得到。每格都要走過點名的元素,否則是沒量到的假綠
    await open(page, 'board');
    const vb = await ringWalk(page, eng, 'board');
    const vbNeed = ['button#boardClose.close', 'button.btu-primary', 'button.board-all-toggle'];
    ok(P('V 360 臺北看板往前走:焦點框不被切、每一拍都有框、對比 ≥ 3'), vOk(vb, 3) && vbNeed.every(k => vb.seen.includes(k)),
      `${fmtV(vb)}；走過 ${fmtSeen(vb)}`);
    await open(page, 'todayPanel');
    const vt = await ringWalk(page, eng, 'todayPanel', 'fwd', 34);
    ok(P('V 360 今日動態往前走:列貼齊面板底緣時框不被切'), vOk(vt, 25), fmtV(vt));
    await open(page, 'fontPanel');
    const vf = await ringWalk(page, eng, 'fontPanel');
    ok(P('V 360 字級面板:分段鈕的框不被切、選中那顆(藏青底)框的對比 ≥ 3'), vOk(vf, 4) && vf.seen.includes('button.on'), `${fmtV(vf)}；走過 ${fmtSeen(vf)}`);
    // N(V):每一條修法各突變一次,指名考哪一條
    for (const [label, css, key, pick] of [
      ['手機標題鈕的框改回往外畫 ⇒ × 上、右兩邊被切', '.board :is(.close, .board-star, .board-notify):focus-visible { outline-offset: 2px !important; }', 'board', v => badHas(v, 'button#boardClose.close', '切掉')],
      ['標題鈕的框改回全域紅色 ⇒ 疊在藏青標題上對比不足', '.board h3 :focus-visible { outline-color: var(--red) !important; }', 'board', v => badHas(v, 'button#boardClose.close', '對比')],
      ['公車轉乘主鈕的框改回往外畫 ⇒ 被卡片左右切掉', '.btu-primary:focus-visible { outline-offset: 2px !important; }', 'board', v => badHas(v, 'button.btu-primary', '切掉')],
      ['公車轉乘主鈕的框改回紅色 ⇒ 藏青底上對比不足', '.btu-primary:focus-visible { outline-color: var(--red) !important; }', 'board', v => badHas(v, 'button.btu-primary', '對比')],
      ['「全部班次」鈕改回 var(--focus) ⇒ 聚焦時沒有框', '.board .board-all-toggle:focus-visible { outline: 3px solid var(--focus) !important; }', 'board', v => badHas(v, 'button.board-all-toggle', '沒有框')],
      ['底部讓位的預設值改回 0 ⇒ 往前走時列貼齊底緣、框的下緣被切', MUT.noFootPad, 'todayPanel', v => badHas(v, 'div.row', '切掉b')],
      ['分段鈕的框改回往外畫 ⇒ 被 .seg 切掉', '.seg button:focus-visible { outline-offset: 2px !important; }', 'fontPanel', v => badHas(v, 'button', '切掉')],
      ['選中的分段鈕框改回紅色 ⇒ 藏青底上對比不足', '.seg button.on:focus-visible { outline-color: var(--red) !important; }', 'fontPanel', v => badHas(v, 'button.on', '對比')],
    ]) {
      const vm = await withMut(page, css, async () => { await open(page, key); return ringWalk(page, eng, key, 'fwd', key === 'todayPanel' ? 34 : 60); });
      ok(P(`N 突變:${label}(V 量得到紅)`), pick(vm), fmtV(vm));
    }
    // V 360 暗色主題:標題鈕 44×44 貼齊右緣;方向鈕在橫向捲動盒(overflow-x:auto)裡,頭尾兩顆貼齊盒緣
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await open(page, 'board');
    const vdk = await ringWalk(page, eng, 'board');
    const ndir = await page.evaluate(() => document.querySelectorAll('#board .night-directions button').length);
    ok(P('V 360 暗色主題臺北看板往前走:標題鈕、方向鈕的框不被切、對比 ≥ 3'),
      ndir >= 2 && vOk(vdk, 7) && vdk.seen.includes('button#boardClose.close') && vdk.seen.includes('button'),
      `方向鈕 ${ndir} 顆；${fmtV(vdk)}；走過 ${fmtSeen(vdk)}`);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    // N:每個突變都要紅——拿掉今日動態列的鍵盤接線 ⇒ Enter 不展開;拿掉行程分享列的 ⇒ Enter 不分享;
    //   重畫後不放回焦點(boardRefocus 換成空的) ⇒ 今日動態 Enter 後焦點離開列、公車站牌重抓後焦點不見;
    //   放回焦點不帶 preventScroll ⇒ 焦點列捲出畫面後重抓,清單被捲回去;空白鍵改回按下就觸發 ⇒ 按住時播放被連發一直切;
    //   拿掉公車列的點擊放焦點 ⇒ 點一列再按鍵亮框;列拿掉 tabindex ⇒ 往回走一列都走不到
    await open(page, 'todayPanel');
    await page.evaluate(() => { const p = document.getElementById('todayPanel'); p.onkeydown = p.onkeyup = null; });
    const nte = await rowPress(page, eng, 'todayPanel', 'Enter');
    ok(P('N 突變:拿掉今日動態列的鍵盤接線 ⇒ Enter 不展開(E 量得到紅)'), !tdOk(nte), fmtTd(nte));
    await open(page, 'tripPanel'); await page.evaluate(STUB_SHARE);
    await page.evaluate(() => { const p = document.getElementById('tripPanel'); window.__bspTripKD = p.onkeydown; window.__bspTripKU = p.onkeyup; p.onkeydown = p.onkeyup = null; });
    const ntp = await rowPress(page, eng, 'tripPanel', 'Enter');
    await page.evaluate(() => { const p = document.getElementById('tripPanel'); p.onkeydown = window.__bspTripKD; p.onkeyup = window.__bspTripKU; });
    ok(P('N 突變:拿掉行程分享列的鍵盤接線 ⇒ Enter 不分享(E 量得到紅)'), !tpOk(ntp), fmtTp(ntp));
    await page.evaluate(() => { window.__bspRefocus = boardRefocus; window.boardRefocus = () => {}; });
    await open(page, 'todayPanel');
    const ntf = await rowPress(page, eng, 'todayPanel', 'Enter');
    await open(page, 'busStopPanel');
    await rowPress(page, eng, 'busStopPanel', null, HOPS.busStopPanel + 2);
    const nbr = await busRefresh(page, false);
    await page.evaluate(() => { window.boardRefocus = window.__bspRefocus; });
    ok(P('N 突變:重畫後不放回焦點 ⇒ 今日動態 Enter 後焦點離開列、公車站牌重抓後焦點不見(E、R 量得到紅)'),
      !tdOk(ntf) && !!nbr.k0 && nbr.k1 !== nbr.k0, `${fmtTd(ntf)}；公車 ${nbr.k0}→${nbr.k1}`);
    await page.evaluate(() => { window.__bspRefocus = boardRefocus; window.boardRefocus = (el, sel) => { const n = sel && el.querySelector(sel); if (n && n !== document.activeElement) n.focus(); }; });
    await open(page, 'busStopPanel');
    await rowPress(page, eng, 'busStopPanel', null, HOPS.busStopPanel + 2);
    const nba = await busRefresh(page, true);
    await page.evaluate(() => { window.boardRefocus = window.__bspRefocus; });
    ok(P('N 突變:放回焦點不帶 preventScroll ⇒ 焦點列捲出畫面後重抓,清單被捲回去(R 量得到紅)'),
      !!nba.k0 && nba.k1 === nba.k0 && Math.abs(nba.st1 - nba.st0) > 1, fmtBus(nba));
    // 列也接空白鍵(v0926e 的寫法:空白鍵等同點一下、擋掉冒泡)⇒ 空白鍵拿那一站分享、播放沒切
    await open(page, 'tripPanel'); await page.evaluate(STUB_SHARE);
    await page.evaluate(() => { const p = document.getElementById('tripPanel'); window.__bspTripKD = p.onkeydown;
      p.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.row[data-dest]')) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) e.target.click(); } }; });
    const nts = await spacePress(page, () => rowPress(page, eng, 'tripPanel', ' '));
    await page.evaluate(() => { document.getElementById('tripPanel').onkeydown = window.__bspTripKD; });
    ok(P('N 突變:列也接空白鍵 ⇒ 空白鍵拿那一站分享、播放沒切(E 行程分享空白鍵那格量得到紅)'),
      !(spaceRowOk(nts) && nts.after.open && nts.after.shared.length === 0), `${fmtTp(nts)} 播放被切 ${nts.plays} 次`);
    // 連發也切播放(拿掉全站快捷鍵的 e.repeat 那道;在捕獲階段替每一下連發補叫一次 togglePlay)⇒ 按住時播放被連切
    await page.evaluate(() => { window.__bspRep = e => { if (e.code === 'Space' && e.repeat) togglePlay(); }; window.addEventListener('keydown', window.__bspRep, true); });
    await open(page, 'tripPanel');
    const nth = await tripHoldSpace(page, eng);
    await page.evaluate(() => window.removeEventListener('keydown', window.__bspRep, true));
    ok(P('N 突變:連發也切播放 ⇒ 按住時播放被連切(E 按住那格量得到紅)'), !holdOk(nth) && nth.plays > 1, fmtHold(nth));
    // 空白鍵先把聚焦中的按鈕 blur 掉(v0718i 的寫法)⇒ 焦點掉回頁面
    await page.evaluate(() => { window.__bspBlur = e => { const a = document.activeElement; if (e.code === 'Space' && a && a.tagName === 'BUTTON') a.blur(); }; window.addEventListener('keydown', window.__bspBlur, true); });
    await open(page, 'todayPanel');
    const nbs = await spacePress(page, () => keyOn(page, '#todayPanel > h3 .close', ' '));
    await page.evaluate(() => window.removeEventListener('keydown', window.__bspBlur, true));
    ok(P('N 突變:空白鍵把聚焦中的按鈕 blur 掉 ⇒ 焦點掉回頁面(E 按鈕那格量得到紅)'), !btnSpaceOk(nbs) && !nbs.stay, fmtKey(nbs));
    await open(page, 'todayPanel');
    await page.evaluate(() => { for (const r of document.querySelectorAll('#todayPanel .td-row')) r.removeAttribute('tabindex'); });
    const ntw = await walk(page, eng, 'todayPanel');
    ok(P('N 突變:列拿掉 tabindex ⇒ 今日動態往回走一列都走不到(W 量得到紅)'), ntw.content < LIST_MIN.todayPanel, `走過內容 ${ntw.content} 拍(可聚焦 ${ntw.n})`);
    await page.evaluate(() => { if (window.__bspShareTrip) window.shareTrip = window.__bspShareTrip; });
    await page.evaluate(CLOSE_ALL);
    // P:護照重繪換掉 h3(新節點)之後換字級,讓位要跟著長高
    await open(page, 'ridePanel');
    const rideStuck = async mutate => {
      await page.evaluate(() => renderRidePanel());
      if (mutate) await page.evaluate(() => boardPadRO.unobserve(document.querySelector('#ridePanel > h3')));
      await settle(page);
      const std = await page.evaluate(FONT, 'std');
      const xl = await page.evaluate(FONT, 'xlarge');
      await page.evaluate(FONT, 'std');
      return { std, xl };
    };
    const rs = await rideStuck(false);
    ok(P('P 360 護照重繪後換特大字級,讓位＝實際固定段底緣'), padFits(rs.std) && padFits(rs.xl) && rs.xl.stuck > rs.std.stuck + 3,
      `標準 ${fmtS(rs.std)}；特大 ${fmtS(rs.xl)}`);
    if (eng === 'chromium') {
      const rm = await rideStuck(true);
      ok(P('N 突變:重繪後新 h3 沒被觀察 ⇒ 特大字級的讓位停在舊值(P 量得到紅)'), !rm.xl.noEntry && !padFits(rm.xl), `特大 ${fmtS(rm.xl)}`);
    }
    // N:改回容器 scroll-padding-top(v0925k 的寫法) ⇒ J 必須紅
    await open(page, 'board');
    await page.evaluate(() => {
      window.syncBoardScrollPad = function () {};
      for (const b of document.querySelectorAll('.board')) { b.style.scrollPaddingTop = b.style.getPropertyValue('--board-scroll-pad'); b.style.removeProperty('--board-scroll-pad'); }
    });
    const jn = await page.evaluate(JUMP, ['board', H3_BTN]);
    ok(P('N 對照:容器 scroll-padding-top ⇒ 聚焦標題的鈕內容會跳(J 量得到紅)'), !jn.none && Math.abs(jn.jump) > 20,
      jn.none ? '標題裡找不到鈕' : `${jn.btn} 捲動 ${jn.before}→${jn.after}`);
    // N:讓位整個拿掉 ⇒ W 必須紅
    await page.evaluate(() => { for (const b of document.querySelectorAll('.board')) { b.style.scrollPaddingTop = ''; b.style.removeProperty('--board-scroll-pad'); } });
    await open(page, 'favPanel');
    const wn = await walk(page, eng, 'favPanel');
    ok(P('N 對照:拿掉讓位 ⇒ 我的最愛鍵盤往回走會被蓋(W 量得到紅)'), wn.covered > 0, `被蓋 ${wn.covered}/${wn.content} 拍`);
    await open(page, 'todayPanel');
    const wnt = await walk(page, eng, 'todayPanel');
    ok(P('N 對照:拿掉讓位 ⇒ 今日動態鍵盤往回走,列會被蓋(三張清單的 W 量得到紅)'), wnt.covered > 0, `被蓋 ${wnt.covered}/${wnt.content} 拍`);
    // 捷運跟隨卡縮成的膠囊(tabindex):Enter 展開、不動播放;空白鍵只切播放、不展開(原本兩件事一起做)。要切到捷運群組,放最後
    await page.evaluate(CLOSE_ALL);
    const fc = await page.evaluate(FC_SETUP);
    ok(P('E 360 捷運跟隨卡縮成膠囊、聚焦得到(量得到的前提)'), fc.ok, JSON.stringify(fc));
    if (fc.ok) {
      const fs = await spacePress(page, () => keyOn(page, '#freqCard', ' '));
      ok(P('E 360 捷運膠囊:空白鍵只切一次播放／暫停,不展開、焦點留在膠囊'), fs.fcMin && fs.plays === 1 && fs.stay, fmtKey(fs));
      const fe = await spacePress(page, () => keyOn(page, '#freqCard', 'Enter'));
      ok(P('E 360 捷運膠囊:Enter 展開、播放不動、焦點留在卡裡(亮框)'), !fe.fcMin && fe.plays === 0 && fe.inCard && fe.fv, `${fmtKey(fe)}、焦點在 ${fe.active}`);
      // 展開後的 × 按 Enter 收回膠囊:焦點落在膠囊本身(× 收起來就藏了,修前焦點掉回頁首)
      const fz = await keyOn(page, '#fcClose', 'Enter');
      ok(P('E 360 捷運卡:× 按 Enter 收成膠囊、焦點落在膠囊(亮框)'), fz.fcMin && fz.active === 'div#freqCard.freq-card' && fz.fv, `膠囊${fz.fcMin ? '收著' : '展開'}、焦點在 ${fz.active}`);
      // N:setFreqCardCompact 拿掉最後那行放回焦點(原始碼照抄、只刪那一行) ⇒ 展開、收合兩格都紅
      const fsrc = await page.evaluate(() => setFreqCardCompact.toString());
      const FLINE = "if (kbd) (on ? card : document.getElementById('fcClose')).focus({ preventScroll: true });";
      ok(P('N 突變目標那一行還在 setFreqCardCompact 裡'), fsrc.includes(FLINE));
      if (fsrc.includes(FLINE)) {
        await page.evaluate(([s, line]) => { window.__origSFCC = setFreqCardCompact; window.setFreqCardCompact = (0, eval)('(' + s.replace(line, '') + ')'); }, [fsrc, FLINE]);
        await page.evaluate(FC_COMPACT);
        const nfe = await keyOn(page, '#freqCard', 'Enter');
        const nfz = await keyOn(page, '#fcClose', 'Enter');
        await page.evaluate(() => { window.setFreqCardCompact = window.__origSFCC; });
        ok(P('N 突變:膠囊切換後不放回焦點 ⇒ 展開後焦點離開卡、收合後焦點不在膠囊(E 兩格量得到紅)'),
          !nfe.fcMin && !nfe.inCard && nfz.fcMin && nfz.active !== 'div#freqCard.freq-card', `展開後焦點在 ${nfe.active}；收合後焦點在 ${nfz.active}`);
      }
      // N:膠囊也接空白鍵(原本的寫法)⇒ 空白鍵那格要紅
      await page.evaluate(FC_COMPACT);
      await page.evaluate(() => { const c = document.getElementById('freqCard'); window.__bspFcKD = c.onkeydown;
        c.onkeydown = e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setFreqCardCompact(false); } }; });
      const nfs = await spacePress(page, () => keyOn(page, '#freqCard', ' '));
      await page.evaluate(() => { document.getElementById('freqCard').onkeydown = window.__bspFcKD; });
      ok(P('N 突變:膠囊也接空白鍵 ⇒ 按一下同時展開又切播放(E 膠囊那格量得到紅)'), !(nfs.fcMin && nfs.plays === 1 && nfs.stay), fmtKey(nfs));
    }
    ok(P('360 標準字級全程零 pageerror'), errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── 360×780 直式特大字級 ─────────────────────────────────────────────────
  {
    const { ctx, page, errors } = await boot(browser, { width: 360, height: 780, tier: 'xlarge' });
    for (const key of ['favPanel', 'ridePanel']) {
      const opened = await open(page, key);
      if (!opened) { ok(P(`W 360 特大 ${key} 打得開`), false); continue; }
      const w = await walk(page, eng, ELEM[key]);
      const need = Math.max(2, Math.min(20, Math.floor(w.n / 2)));
      ok(P(`W 360 特大 ${key} 鍵盤往回走,焦點不被固定段蓋住`), w.covered === 0 && w.content >= need,
        `被蓋 ${w.covered}/${w.content} 拍(可聚焦 ${w.n}、至少要走 ${need})${w.bad.length ? '；' + w.bad.join('、') : ''}`);
    }
    // 三張清單面板:特大字級的標題與列都變高
    for (const key of ['todayPanel', 'busStopPanel', 'tripPanel']) await listWalk(page, eng, P, key, '360 特大');
    // 直式合併卡:分頁列不 sticky(只在側欄 media 段釘住),是一般內容,Shift+Tab 走到分頁鈕時要讓出標題
    const portUni = async () => (await open(page, 'uni'))
      && page.evaluate(() => { const t = document.querySelector('#board > .uni-tabs'); return t ? getComputedStyle(t).position : null; });
    const tabsPos = await portUni();
    ok(P('360 特大 直式合併卡打得開、分頁列不是 sticky'), !!tabsPos && tabsPos !== 'sticky', `分頁列 position=${tabsPos}`);
    if (tabsPos && tabsPos !== 'sticky') {
      const w = await walk(page, eng, 'board');
      const need = Math.max(2, Math.min(20, Math.floor(w.n / 2)));
      ok(P('W 360 特大 直式合併卡鍵盤往回走,焦點不被固定段蓋住'), w.covered === 0 && w.content >= need,
        `被蓋 ${w.covered}/${w.content} 拍(可聚焦 ${w.n}、至少要走 ${need})${w.bad.length ? '；' + w.bad.join('、') : ''}`);
      // 整份往回走碰不碰得到「分頁鈕半露」看當天資料(見 tabsPeek),這一格直接造出半露再走進去
      await portUni();
      const pk = await tabsPeek(page, eng);
      ok(P('W 360 特大 直式合併卡:分頁鈕半露在捲動區上緣時往回走進它,不被標題蓋住'), peekOk(pk), fmtPeek(pk));
      // N:把分頁列的排除規則移出側欄段 ⇒ 直式分頁鈕不再讓位,停在標題底下
      const moved = await page.evaluate(TABS_RULE_OUT);
      ok(P('N 突變目標:側欄 media 段裡找得到分頁列的排除規則'), !!moved, moved || '找不到');
      if (moved) {
        await portUni();
        const wm = await walk(page, eng, 'board');
        await portUni();
        const pkm = await tabsPeek(page, eng);
        await page.evaluate(() => document.getElementById('__bspTabsOut').remove());
        ok(P('N 突變:分頁列的排除規則移出側欄段 ⇒ 分頁鈕半露時往回走進它會被標題蓋住(W 半露那格量得到紅)'), !pkm.none && pkm.onTab && pkm.covered,
          `${fmtPeek(pkm)}；整份往回走被蓋 ${wm.covered}/${wm.content} 拍(看當天資料,只列參考)`);
      }
    }
    ok(P('360 特大字級全程零 pageerror'), errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── 844×390 橫式合併卡(h3＋站名牌＋分頁列三段固定段) ──────────────────────
  {
    const { ctx, page, errors } = await boot(browser, { width: 844, height: 390 });
    const opened = await open(page, 'uni');
    const isUni = opened && await page.evaluate(() => { const t = document.querySelector('#board > .uni-tabs'); return !!(t && getComputedStyle(t).position === 'sticky'); });
    ok(P('844×390 合併卡打得開、分頁列是 sticky'), isUni);
    if (isUni) {
      const w = await walk(page, eng, 'board');
      ok(P('W 844×390 合併卡鍵盤往回走,焦點不被固定段蓋住'), w.covered === 0 && w.content >= 2,
        `被蓋 ${w.covered}/${w.content} 拍(可聚焦 ${w.n})${w.bad.length ? '；' + w.bad.join('、') : ''}`);
      await page.evaluate(CLOSE_ALL); await page.evaluate(OPEN.uni); await settle(page); await page.waitForTimeout(250);
      for (const [label, sel] of [['標題的鈕', H3_BTN], ['分頁鈕', ':scope > .uni-tabs button']]) {
        const j = await page.evaluate(JUMP, ['board', sel]);
        ok(P(`J 844×390 合併卡捲在下面時聚焦${label},內容不跳`), !j.none && j.max >= 150 && Math.abs(j.jump) <= 8,
          j.none ? `找不到${label}` : `${j.btn} 捲動 ${j.before}→${j.after}(可捲 ${j.max})`);
      }
      const off = await page.evaluate(PLATE, false), on = await page.evaluate(PLATE, true), off2 = await page.evaluate(PLATE, false);
      ok(P('P 844×390 站名牌出現／消失,讓位＝實際固定段底緣'), padFits(off) && padFits(on) && padFits(off2) && on.n === off.n + 1 && on.stuck > off.stuck + 10,
        `無牌 ${fmtS(off)}；有牌 ${fmtS(on)}；再收 ${fmtS(off2)}`);
      if (eng === 'chromium') {
        const src = await page.evaluate(() => syncBoardHeadVar.toString());
        const LINE = 'if (on) syncBoardScrollPad(bd);';
        ok(P('N 突變目標那一行還在 syncBoardHeadVar 裡'), src.includes(LINE));
        if (src.includes(LINE)) {
          await page.evaluate(([s, line]) => { window.__origSBHV = syncBoardHeadVar; window.syncBoardHeadVar = (0, eval)('(' + s.replace(line, '') + ')'); }, [src, LINE]);
          await page.evaluate(PLATE, false);
          const mOn = await page.evaluate(PLATE, true);
          ok(P('N 突變:拿掉 syncBoardHeadVar 尾端那一刀 ⇒ 站名牌出現時讓位停在舊值(P 量得到紅)'), !padFits(mOn), `有牌 ${fmtS(mOn)}`);
          await page.evaluate(() => { window.syncBoardHeadVar = window.__origSBHV; });
        }
      }
    }
    // 三張清單面板:橫式畫面矮,標題佔的比例最大
    for (const key of ['todayPanel', 'busStopPanel', 'tripPanel']) await listWalk(page, eng, P, key, '844×390');
    ok(P('844×390 全程零 pageerror'), errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── 1280×800 桌面:滑鼠點公車列 ─────────────────────────────────────────────
  // C 放在桌面量:Chromium 的手機模擬點一下不會把焦點交給 tabindex 列,在 360 量不到東西、突變也紅不了
  {
    const { ctx, page, errors } = await boot(browser, { width: 1280, height: 800 });
    await open(page, 'busStopPanel');
    const bc = await busClickKey(page);
    ok(P('C 1280 公車站牌:滑鼠點一列再按鍵,焦點不留在列上、不亮框(點列跟改版前一樣)'), clickOk(bc), fmtClick(bc));
    await open(page, 'busStopPanel');
    await page.evaluate(() => document.getElementById('busStopPanel').removeEventListener('focusin', busRowDropPointerFocus));
    const nbc = await busClickKey(page);
    await page.evaluate(() => document.getElementById('busStopPanel').addEventListener('focusin', busRowDropPointerFocus));
    ok(P('N 突變:拿掉公車列的點擊放焦點 ⇒ 點一列再按鍵,焦點留在列上而且亮框(C 量得到紅)'), nbc.onRow && nbc.ring > 0, fmtClick(nbc));
    // V 1280:桌面標題鈕 22×22 不貼邊、框照舊往外畫(字色);暗色主題的鈕是 44×44 貼齊右緣,框往內畫
    await open(page, 'board');
    const vd = await ringWalk(page, eng, 'board');
    ok(P('V 1280 臺北看板往前走:焦點框不被切、每一拍都有框、對比 ≥ 3'), vOk(vd, 3) && vd.seen.includes('button#boardClose.close'),
      `${fmtV(vd)}；走過 ${fmtSeen(vd)}`);
    await open(page, 'todayPanel');
    const vdt = await ringWalk(page, eng, 'todayPanel', 'fwd', 34);
    ok(P('V 1280 今日動態往前走:列貼齊面板底緣時框不被切'), vOk(vdt, 25), fmtV(vdt));
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await open(page, 'board');
    const vk = await ringWalk(page, eng, 'board');
    const ndk = await page.evaluate(() => document.querySelectorAll('#board .night-directions button').length);
    ok(P('V 1280 暗色主題臺北看板往前走:標題鈕(44×44 貼齊右緣)、方向鈕(橫向捲動盒)框不被切、對比 ≥ 3'),
      ndk >= 2 && vOk(vk, 7) && vk.seen.includes('button#boardClose.close') && vk.seen.includes('button'),
      `方向鈕 ${ndk} 顆；${fmtV(vk)}；走過 ${fmtSeen(vk)}`);
    const vkm = await withMut(page, 'html[data-theme=dark] .board :is(.close, .board-star, .board-notify):focus-visible { outline-offset: 2px !important; }',
      async () => { await open(page, 'board'); return ringWalk(page, eng, 'board'); });
    ok(P('N 突變:暗色標題鈕的框改回往外畫 ⇒ × 右邊被切(V 量得到紅)'), badHas(vkm, 'button#boardClose.close', '切掉'), fmtV(vkm));
    const vnm = await withMut(page, 'html[data-theme=dark] .night-directions { margin: 0 !important; padding: 4px 0 12px !important; }',
      async () => { await open(page, 'board'); return ringWalk(page, eng, 'board'); });
    ok(P('N 突變:暗色方向鈕的捲動盒拿掉左右留邊 ⇒ 頭尾兩顆的框被切(V 量得到紅)'), badHas(vnm, 'button', '切掉'), fmtV(vnm));
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await xp1280(page, eng, P);   // v0926j 平交道卡、落釘卡:滑鼠按住跨過重畫、高倍速重畫次數、取消收藏後的焦點
    ok(P('1280 全程零 pageerror'), errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── 2026-09-26 360×780 直式:合併卡底部提示列(標準→特大字級)、列車 sheet、平交道卡家族、車庫 ─────────
  {
    const { ctx, page, errors } = await boot(browser, { width: 360, height: 780 });
    await page.evaluate(HELPERS2);
    const openUni = async () => (await open2(page, 'uni'))
      && page.evaluate(() => { const bd = document.getElementById('board'); return bd.classList.contains('uni-train') && bd.classList.contains('sheet-small'); });
    // B:從第一個可聚焦元素往前走,走到提示列本身才算走完它上面的內容
    const B = async tier => {
      const w = await walk2(page, eng, 'uni', 1);
      ok(P(`B 360 ${tier} 直式合併卡小段往前走,焦點不停在底部提示列下`), w.covered === 0 && w.foot && w.content >= 3,
        fmtW(w) + (w.foot ? '' : '；沒走到提示列'));
      const wm = await withMut(page, MUT.noFootPad, async () => { await openUni(); return walk2(page, eng, 'uni', 1); });
      ok(P(`N 突變:拿掉底部讓位 ⇒ ${tier}往前走會停在提示列下(B 量得到紅)`), wm.covered > 0, fmtW(wm));
    };
    const isUni = await openUni();
    ok(P('360 直式合併卡打得開、在「這班車」頁的小段'), isUni);
    if (isUni) {
      await B('標準');
      await openUni();
      const jf = await page.evaluate(JFOOT);
      ok(P('J 360 提示列釘在卡緣時聚焦它本身,內容不跳'), !jf.none && jf.pinned && Math.abs(jf.after - jf.before) <= 8,
        jf.none ? '提示列不在' : `捲動 ${jf.before}→${jf.after}${jf.pinned ? '' : '(沒釘在卡緣)'}`);
      const jm = await withMut(page, MUT.footSelfPad, () => page.evaluate(JFOOT));
      ok(P('N 突變:提示列自己也吃底部讓位 ⇒ 聚焦它內容會跳(J 量得到紅)'), !jm.none && Math.abs(jm.after - jm.before) > 8,
        jm.none ? '提示列不在' : `捲動 ${jm.before}→${jm.after}`);
      // P:小段 → 中段(提示列收掉,讓位歸零)→ 回小段 → 特大字級
      const s0 = await page.evaluate(FOOT0);
      await page.evaluate(SIZE, 'medium'); const sm = await page.evaluate(FOOT0);
      await page.evaluate(SIZE, 'small'); const s1 = await page.evaluate(FOOT0);
      const fontOk = await page.evaluate(FONT2, 'xlarge'); const s2 = await page.evaluate(FOOT0);
      ok(P('P 360 底部讓位＝提示列釘住時實際佔掉的下緣(小段→中段→回小段→特大字級)'),
        footFits(s0) && !sm.shown && sm.pad === 0 && footFits(s1) && fontOk && footFits(s2) && s2.stuck > s0.stuck + 5,
        `小段 ${fmtF(s0)}；中段 ${fmtF(sm)}；回小段 ${fmtF(s1)}；特大 ${fontOk ? fmtF(s2) : '換字級入口 state._setFontScale 不見了'}`);
      await openUni();
      await B('特大');
      if (eng === 'chromium') {
        // N:讓位寫死成標準字級的值(不量) ⇒ 換到特大字級後讓位停在舊值
        await page.evaluate(FONT2, 'std'); await openUni();
        const std = (await page.evaluate(FOOT0)).pad;
        await page.evaluate(v => {
          window.__origSBSP = syncBoardScrollPad;
          window.syncBoardScrollPad = bd => { __origSBSP(bd); if (bd.style.getPropertyValue('--board-scroll-pad-bottom')) bd.style.setProperty('--board-scroll-pad-bottom', v + 'px'); };
        }, std);
        await page.evaluate(FONT2, 'xlarge'); const sx = await page.evaluate(FOOT0);
        await page.evaluate(() => { window.syncBoardScrollPad = window.__origSBSP; });
        ok(P('N 突變:底部讓位寫死成標準字級的值 ⇒ 特大字級對不上(P 量得到紅)'), sx.shown && !footFits(sx), `寫死 ${std}；特大 ${fmtF(sx)}`);
      }
      await page.evaluate(FONT2, 'std');
    }
    // 列車 sheet(中段):標題以外沒有可聚焦元素＋J
    const isTc = await open2(page, 'tc');
    ok(P('360 列車 sheet 打得開'), isTc);
    if (isTc) {
      await cardS(page, P, '360', 'tc');
      await cardJ(page, P, '360', 'tc', ':scope > .tc-head button');
      await page.evaluate(() => setSheetSize(document.getElementById('trainCard'), 'small')); // 段高偏好還給小段
    }
    // 平交道卡家族(網頁版):平交道卡、台糖卡標題以外沒有可聚焦元素(S);落釘卡、附近車站卡的列 v0926j 起可聚焦,
    // S 的前提不成立,改成真的走(附近車站卡在這裡、落釘卡在 844×390 那段)。直式只有附近車站卡捲得動,其餘三張的 J 在 844×390 量
    for (const key of ['xing', 'pin', 'sugar', 'near']) {
      const opened = await open2(page, key);
      ok(P(`360 ${key} 卡打得開`), opened);
      if (!opened) continue;
      if (key === 'xing' || key === 'sugar') await cardS(page, P, '360', key);
      if (key === 'near') await cardJ(page, P, '360', key, ':scope > .xc-head button');
    }
    await lcPortrait(page, P);   // v0926l 側欄槽位只給矮橫式,直式照舊
    await xpNear360(page, eng, P);
    await xpRing360(page, eng, P);
    // 車庫:W(往回走 40 拍夠了,全部 80 幾拍)、J(修前跳 390px)、P(讓位跟著頂列實高走)
    const isG = await open2(page, 'garage');
    ok(P('360 車庫打得開'), isG);
    if (isG) {
      const w = await walk2(page, eng, 'garage', -1, 40);
      ok(P('W 360 車庫鍵盤往回走,焦點上緣不壓在頂列下'), w.covered === 0 && w.content >= 20, fmtW(w));
      const wm = await withMut(page, MUT.noGaragePad, () => walk2(page, eng, 'garage', -1, 40));
      ok(P('N 突變:拿掉車庫內容的讓位 ⇒ 往回走焦點上緣壓在頂列下(W 量得到紅)'), wm.covered > 0, fmtW(wm));
      const j = await page.evaluate(JUMP, ['trainGarage', ':scope > .g-top button']);
      ok(P('J 360 車庫捲在下面時聚焦頂列的鈕,內容不跳'), !j.none && j.max >= 150 && Math.abs(j.jump) <= 8,
        j.none ? '頂列裡找不到鈕' : `${j.btn} 捲動 ${j.before}→${j.after}(可捲 ${j.max})`);
      const jn = await withMut(page, MUT.garageOld, () => page.evaluate(JUMP, ['trainGarage', ':scope > .g-top button']));
      ok(P('N 突變:改回修前的容器 scroll-padding-top 84px ⇒ 聚焦頂列的鈕內容會跳(J 量得到紅)'), !jn.none && Math.abs(jn.jump) > 8,
        jn.none ? '頂列裡找不到鈕' : `${jn.btn} 捲動 ${jn.before}→${jn.after}`);
      // 頂列變高:照 .g-top 的 padding-top:max(12px, env(safe-area-inset-top)),模擬 59px 的瀏海安全區
      const g0 = await page.evaluate(GARAGE_PAD);
      await page.evaluate(() => { document.querySelector('#trainGarage > .g-top').style.paddingTop = '59px'; });
      const g1 = await page.evaluate(GARAGE_PAD);
      ok(P('P 360 車庫讓位＝頂列實高＋15(頂列變高之後也是)'), gFits(g0) && gFits(g1) && g1.head > g0.head + 30,
        `頂列 ${g0.head} 讓位 ${g0.margin}；變高 ${g1.head} 讓位 ${g1.margin}`);
      const gm = await withMut(page, MUT.garage84, () => page.evaluate(GARAGE_PAD));
      ok(P('N 突變:車庫讓位寫死成修前的 84px ⇒ 頂列變高後對不上(P 量得到紅)'), !gFits(gm), `頂列 ${gm.head} 讓位 ${gm.margin}`);
      await page.evaluate(() => { document.querySelector('#trainGarage > .g-top').style.paddingTop = ''; });
    }
    ok(P('360 補量段全程零 pageerror'), errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── 2026-09-26 844×390 橫式:平交道卡家族、列車 sheet、車庫 ──────────────
  // 平交道卡、落釘卡、台糖卡 v0926l 起坐側欄槽位、放得下全部列:先量 L(真的版面),再用 SHORT_CARD 壓回捲得動的卡量 J／K／R／W
  {
    const { ctx, page, errors } = await boot(browser, { width: 844, height: 390 });
    await page.evaluate(HELPERS2);
    await lcLand(page, P, '844×390', ['pin']);
    await lcSafeArea(page, P, '844×390');
    await setShort(page, true);
    for (const key of ['xing', 'pin', 'sugar', 'near']) {
      const opened = await open2(page, key);
      ok(P(`844×390 ${key} 卡打得開`), opened);
      if (opened) await cardJ(page, P, '844×390', key, ':scope > .xc-head button');
    }
    await xp844(page, eng, P);   // v0926j 卡頭的鈕與落釘卡的列:重畫後焦點還在、捲動沒動;落釘卡 W／E
    await setShort(page, false);
    const isTc = await open2(page, 'tc');
    ok(P('844×390 列車 sheet 打得開'), isTc);
    if (isTc) await cardJ(page, P, '844×390', 'tc', ':scope > .tc-head button');
    const isG = await open2(page, 'garage');
    ok(P('844×390 車庫打得開'), isG);
    if (isG) {
      const w = await walk2(page, eng, 'garage', -1, 40);
      ok(P('W 844×390 車庫鍵盤往回走,焦點上緣不壓在頂列下'), w.covered === 0 && w.content >= 20, fmtW(w));
      const wm = await withMut(page, MUT.noGaragePad, () => walk2(page, eng, 'garage', -1, 40));
      ok(P('N 突變:拿掉車庫內容的讓位 ⇒ 844×390 往回走焦點上緣壓在頂列下(W 量得到紅)'), wm.covered > 0, fmtW(wm));
      const j = await page.evaluate(JUMP, ['trainGarage', ':scope > .g-top button']);
      ok(P('J 844×390 車庫捲在下面時聚焦頂列的鈕,內容不跳'), !j.none && j.max >= 150 && Math.abs(j.jump) <= 8,
        j.none ? '頂列裡找不到鈕' : `${j.btn} 捲動 ${j.before}→${j.after}(可捲 ${j.max})`);
      const jn = await withMut(page, MUT.garageOld, () => page.evaluate(JUMP, ['trainGarage', ':scope > .g-top button']));
      ok(P('N 突變:改回修前的容器 scroll-padding-top 84px ⇒ 844×390 聚焦頂列的鈕內容會跳(J 量得到紅)'), !jn.none && Math.abs(jn.jump) > 8,
        jn.none ? '頂列裡找不到鈕' : `${jn.btn} 捲動 ${jn.before}→${jn.after}`);
    }
    ok(P('844×390 補量段全程零 pageerror'), errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── v0926l 667×375 橫式(修前三張卡全是零列):L＋對照;特大字級再量 L、版權列、速度膠囊與提示卡讓位 ─────────────
  // 特大那輪開機就是特大(存好的字級偏好):「橫式×特大」提示卡只在開機與橫直切換時判斷要不要出現,開機後才換字級它不會出來
  for (const tier of ['std', 'xlarge']) {
    const { ctx, page, errors } = await boot(browser, { width: 667, height: 375, tier });
    const T = tier === 'std' ? '667×375' : '667×375 特大';
    await page.evaluate(HELPERS2);
    const fs = await page.evaluate(() => document.documentElement.getAttribute('data-fs') || 'std');
    ok(P(`${T} 字級開機生效`), fs === tier, `data-fs=${fs}`);
    await lcLand(page, P, T, LC_KEYS);
    if (tier === 'xlarge') { await lcAttrib(page, P, T); await lcYield(page, P, T); }
    ok(P(`${T} 全程零 pageerror`), errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── 2026-09-26 360×780 App(?demo=bounty):附近車站卡每列有「蓋章」鈕,往回走不被卡頭蓋 ─────────────
  {
    const { ctx, page, errors } = await boot(browser, { width: 360, height: 780, query: '&demo=bounty' });
    await page.evaluate(HELPERS2);
    const nearW = async tier => {
      const opened = await open2(page, 'near');
      const n = opened ? await page.evaluate(() => document.querySelectorAll('#nearCard .nx-ck').length) : 0;
      ok(P(`App 360 ${tier} 附近車站卡打得開、有「蓋章」鈕`), n > 0, `${n} 顆`);
      if (!n) return;
      const w = await walk2(page, eng, 'near', -1);
      const need = Math.max(2, Math.min(20, Math.floor(w.n / 2)));
      ok(P(`W App 360 ${tier} 附近車站卡鍵盤往回走,焦點不被卡頭蓋住`), w.covered === 0 && w.content >= need, fmtW(w) + `(至少要走 ${need})`);
      const wm = await withMut(page, MUT.noCardPad, async () => { await open2(page, 'near'); return walk2(page, eng, 'near', -1); });
      ok(P(`N 突變:拿掉卡內讓位 ⇒ ${tier}往回走會停在卡頭下(W 量得到紅)`), wm.covered > 0, fmtW(wm));
    };
    await nearW('標準');
    if (await open2(page, 'near')) await cardJ(page, P, 'App 360', 'near', ':scope > .xc-head button');
    const fontOk = await page.evaluate(FONT2, 'xlarge');
    ok(P('App 360 換特大字級走得到真入口 state._setFontScale'), fontOk);
    if (fontOk) await nearW('特大');
    ok(P('App 360 全程零 pageerror'), errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ── 2026-09-26 鍵盤焦點四件(v0926i):看板重畫、關面板不把鍵盤焦點丟回頁首(見檔頭 R／O／C 那段) ───────────
  for (const [w, h] of [[360, 780], [1280, 800]]) {
    const { ctx, page, errors } = await boot(browser, { width: w, height: h });
    const V = String(w), mobile = w < 1000;
    await page.waitForFunction(() => !!document.getElementById('viewDock'), null, { timeout: 30000 }).catch(() => {});
    await page.evaluate(KF_HELP);
    await page.evaluate(() => { if (state.playing) togglePlay(); });   // 暫停:只量主動呼叫的那一次重畫,每 20 模擬秒的自動重畫不混進來
    for (const theme of ['light', 'dark']) {
      const TH = theme === 'dark' ? '暗色' : '亮色', night = theme === 'dark' ? ['night-directions', 'night-next'] : [];
      await page.evaluate(th => state._setAppearance(th), theme);   // 設定面板「外觀」的真入口
      if (!(await open(page, 'board'))) { ok(P(`R ${V} ${TH}臺北看板打得開`), false); continue; }
      const rb = await holdEach(page, 'renderBoard');
      ok(P(`R ${V} ${TH}臺北看板:焦點停在每一顆可聚焦元素上重畫(renderBoard),焦點回到同一顆、亮框、捲動不動`), kfOk(rb, ['h3', ...night]), fmtKf(rb));
      if (theme === 'light') {
        const m = await mutFn(page, 'renderBoard', KF_HOLD, 'const refocus = () => {};');
        ok(P(`N ${V} 突變目標那一行還在 renderBoard 裡`), m);
        if (m) {
          const rm = await holdEach(page, 'renderBoard'); await unmutFn(page, 'renderBoard');
          ok(P(`N ${V} 突變:renderBoard 重畫後不放回焦點 ⇒ 每一顆都掉(R 量得到紅)`), rm.total > 0 && rm.kept === 0, fmtKf(rm));
        }
      } else {
        const m = await mutFn(page, 'boardHoldFocus', KF_KEYLESS, 'null');
        ok(P(`N ${V} 突變目標那一段還在 boardHoldFocus 裡(沒有 id／class／data 的鈕用父層 class 當鍵)`), m);
        if (m) {
          const rm = await holdEach(page, 'renderBoard'); await unmutFn(page, 'boardHoldFocus');
          ok(P(`N ${V} 突變:沒有 id／class／data 的鈕不用父層 class 當鍵 ⇒ 暗色方向鈕那區紅、標題列不紅(R 量得到紅、紅在點名的那區)`),
            kfRedAt(rm, 'night-directions') && !kfRedAt(rm, 'h3'), fmtKf(rm));
        }
      }
      if (!mobile) continue;
      // 直式合併卡:跟車中開看板,標題下有分頁列;「這班車」那一頁是搬進來的跟車卡
      if (!(await open(page, 'uni'))) { ok(P(`R ${V} ${TH}直式合併卡打得開`), false); continue; }
      const t0 = await uniTabEnter(page, 'station');
      ok(P(`R ${V} ${TH}合併卡:「這一站」分頁鈕按 Enter,焦點留在新的那顆分頁鈕上(已選、亮框)`), tabOk(t0), fmtTab(t0));
      for (const call of ['renderBoard', 'mountUniCard']) {
        const r = await holdEach(page, call);
        ok(P(`R ${V} ${TH}合併卡「這一站」:焦點停在每一顆上 ${call}(),焦點回到同一顆、亮框、捲動不動`), kfOk(r, ['h3', 'uni-tabs', ...night]), fmtKf(r));
      }
      if (theme === 'dark') continue;
      const m = await mutFn(page, 'mountUniCard', KF_HOLD, 'const refocus = () => {};');
      ok(P(`N ${V} 突變目標那一行還在 mountUniCard 裡`), m);
      if (m) {
        const rm = await holdEach(page, 'mountUniCard');
        const tm = await uniTabEnter(page, 'train');
        await unmutFn(page, 'mountUniCard');
        ok(P(`N ${V} 突變:mountUniCard 重建分頁列後不放回焦點 ⇒ 分頁鈕那區紅、分頁按 Enter 焦點掉(R 量得到紅)`), kfRedAt(rm, 'uni-tabs') && !tabOk(tm), `${fmtKf(rm)}；分頁 Enter:${fmtTab(tm)}`);
      }
      const t1 = await uniTabEnter(page, 'train');
      ok(P(`R ${V} ${TH}合併卡:「這班車」分頁鈕按 Enter,焦點留在新的那顆分頁鈕上(已選、亮框)`), tabOk(t1), fmtTab(t1));
      for (const call of ['renderBoard', 'mountUniCard']) {
        const r = await holdEach(page, call, 40);
        ok(P(`R ${V} ${TH}合併卡「這班車」:焦點停在每一顆上 ${call}(),焦點回到同一顆(跟車卡搬出去再搬回來)、亮框、捲動不動`), kfOk(r, ['uni-tabs', 'uni-slot']), fmtKf(r));
      }
      const t2 = await uniTabEnter(page, 'station');
      ok(P(`R ${V} ${TH}合併卡:切回「這一站」,焦點留在分頁鈕上(已選、亮框)`), tabOk(t2), fmtTab(t2));
    }
    await page.evaluate(() => state._setAppearance('light'));
    const flows = mobile ? O_360 : O_1280;
    for (const [key, flow] of Object.entries(flows)) {
      const r = await closeBack(page, key, flow);
      const shared = key !== 'tripRow' || (!!r.shared && r.shared.length === 1);
      const how = flow.how || (flow.steps.some(([op]) => op === 'js') ? '入口不是鍵盤走得到的、叫開函式打開,× 按 Enter 關' : '鍵盤打開、× 按 Enter 關');
      ok(P(`O ${V} ${flow.name}:${how},焦點回到 ${flow.expect}(亮框)`), backOk(r) && shared, fmtBack(r) + (key === 'tripRow' ? `、分享了 ${JSON.stringify(r.shared)}` : ''));
    }
    // 焦點在文字欄位時關(觸控點進文字欄位也會亮框,WebKit 點 × 焦點又留在欄位上):不送,免得入口在觸控裝置上亮框
    const TXT = async () => {
      await page.evaluate(CLOSE_ALL); await page.evaluate(KF_RESET);
      return page.evaluate(async () => {
        openTrackPanel(); await new Promise(r => setTimeout(r, 150));
        const i = document.getElementById('rdSearch'); i.focus();
        const fv = __kf.fv(i);
        closeTrackPanel(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30))));
        const a = document.activeElement;
        return { fv, active: __bsp.desc(a), moved: !!a && a !== document.body && !a.closest('#trackPanel') };
      });
    };
    const tx = await TXT();
    ok(P(`O ${V} 軌道與路線:焦點在搜尋框(文字欄位)時關掉,焦點不被送去入口`), tx.fv && !tx.moved, `搜尋框${tx.fv ? '' : '沒'}亮框、關掉後焦點在 ${tx.active}`);
    if (mobile) {
      let m = await mutFn(page, 'panelFocusBack', KF_BACK, '');
      ok(P(`N ${V} 突變目標那一行還在 panelFocusBack 裡(關完放回焦點)`), m);
      if (m) {
        const a = await closeBack(page, 'favPanel', O_360.favPanel), b = await closeBack(page, 'tripRow', O_360.tripRow);
        await unmutFn(page, 'panelFocusBack');
        ok(P(`N ${V} 突變:關面板不放回焦點 ⇒ 我的最愛、行程分享列關掉後焦點不在入口(O 量得到紅)`), a.closed && !a.on && b.closed && !b.on, `我的最愛:${fmtBack(a)}；行程分享列:${fmtBack(b)}`);
      }
      const had = await page.evaluate(() => { window.__kfEntry = PANEL_ENTRY.trackPanel; PANEL_ENTRY.trackPanel = []; return (window.__kfEntry || []).length; });
      const te = await closeBack(page, 'trackPanel', O_360.trackPanel);
      await page.evaluate(() => { PANEL_ENTRY.trackPanel = window.__kfEntry; });
      ok(P(`N ${V} 突變:軌道與路線的固定入口清空 ⇒ 開它的那一列跟著觀看設定收起、看不到,關掉後焦點沒地方回(O 量得到紅)`), had > 0 && te.closed && !te.on, fmtBack(te));
      const hadNote = await page.evaluate(() => { window.__kfNote = notePanelOpener; window.notePanelOpener = () => {}; delete panelOpener.favPanel; return typeof window.__kfNote === 'function'; });
      const fr = await closeBack(page, 'favFromRide', O_360.favFromRide);
      await page.evaluate(() => { window.notePanelOpener = window.__kfNote; });
      ok(P(`N ${V} 突變:開面板不記開它的鈕 ⇒ 從護照鈕開的我的最愛關掉後回到固定入口、不是護照鈕(O 量得到紅)`), hadNote && fr.closed && !fr.on, fmtBack(fr));
      m = await mutFn(page, 'panelFocusBack', KF_MOVED, '[panelOpener[id]]');
      ok(P(`N ${V} 突變目標那一段還在 panelFocusBack 裡(搬出面板的那顆留著)`), m);
      if (m) {
        const u = await closeBack(page, 'uniTrip', O_360.uniTrip);
        await unmutFn(page, 'panelFocusBack');
        ok(P(`N ${V} 突變:搬出面板的那顆不算 ⇒ 合併卡裡按行程分享,看板收起時焦點被拉去看板的入口(O 量得到紅)`), u.opened && !u.atOpenOk, `打開時焦點在 ${u.atOpen}`);
      }
      m = await mutFn(page, 'panelFocusBack', KF_TEXT, 'false');
      ok(P(`N ${V} 突變目標那一段還在 panelFocusBack 裡(文字欄位不送)`), m);
      if (m) {
        const tm = await TXT(); await unmutFn(page, 'panelFocusBack');
        ok(P(`N ${V} 突變:文字欄位也送 ⇒ 焦點在搜尋框時關掉,焦點被送去入口(文字欄位那格量得到紅)`), tm.fv && tm.moved, `關掉後焦點在 ${tm.active}`);
      }
    } else {
      // C 滑鼠點 × 關:不送(只接鍵盤焦點)。用開函式打開(焦點不在入口上),WebKit 點按鈕不給它焦點,兩個引擎的起點才一樣
      const CLICK = async () => {
        await page.evaluate(CLOSE_ALL); await page.evaluate(KF_RESET);
        await page.evaluate(() => openFavPanel()); await settle(page);
        await page.click('#favClose'); await settle(page);
        return page.evaluate(() => { const a = document.activeElement; return { active: __bsp.desc(a), entry: !!a && a.matches('#favBtn, #tabFav') }; });
      };
      const c = await CLICK();
      ok(P(`C ${V} 滑鼠點 × 關我的最愛:焦點不被送去入口(只接鍵盤焦點)`), !c.entry, `焦點在 ${c.active}`);
      if (eng === 'chromium') {
        const m = await mutFn(page, 'panelFocusBack', KF_FV, '');
        ok(P(`N ${V} 突變目標那一行還在 panelFocusBack 裡(只接鍵盤焦點)`), m);
        if (m) {
          const cm = await CLICK(); await unmutFn(page, 'panelFocusBack');
          ok(P(`N ${V} 突變:滑鼠點 × 也放回焦點 ⇒ 焦點被送去入口(C 量得到紅;只做 Chromium:WebKit 點按鈕不給焦點,碰不到這條規則)`), cm.entry, `焦點在 ${cm.active}`);
        }
      }
    }
    // WebKit 360 連續重畫看板會丟「ResizeObserver loop completed with undelivered notifications」:修前 origin/main 同樣出現,不是這批造成、不算
    const errs = errors.filter(e => !/ResizeObserver loop/.test(e));
    ok(P(`${V} 鍵盤焦點段全程零 pageerror`), errs.length === 0, errs.slice(0, 2).join(' | ') + (errors.length > errs.length ? `(另有 ${errors.length - errs.length} 則 ResizeObserver loop 通知,不算)` : ''));
    await ctx.close();
  }
  await browser.close();
}
server.close();

const failed = results.filter(r => !r.pass);
console.log(`\n${failed.length ? `未過 ${failed.length} 條` : '全部通過'}(共 ${results.length} 條)`);
process.exitCode = failed.length ? 1 : 0;
