// /api/weekend 的形狀檢查。刻意不起 wrangler dev:
//   (1) .wrangler 的本機快取跨重啟存活,突變測試會假綠
//   (2) 這支端點沒有 D1、沒有上游、沒有 KV,邏輯全在 weekend_core.mjs,起 runtime 買不到東西
// 所以這裡驗兩件 runtime 之外的事:worker.js 的接線在不在(含「有沒有被拿掉/對調/註解掉」)、
// 回傳物件的形狀對不對。
//
// 🔴 修復輪 1(2026-09-04):原本【F】【E】【S】三段各自把「組 body」那段邏輯抄了一次,
// 測試驗的是【測試自己組的那份】,不是 handler 組的那份——這正是這支端點自己要防的錯
// (見 weekend_core.mjs 的 weekendBody 註解:「不各自重算,兩份實作會慢慢長歪」)。現在
// 三段一律呼叫 weekendBody(today, span, eventsDoc, holidayNames)(worker.js 的 weekendBoard
// 也呼叫同一支),組裝邏輯只剩一份——但這句話本身在修復輪 1 當下有點過度宣稱,見下方
// 修復輪 2 的更正:「呼叫同一支函式」保證的是不會兩份實作各自長歪,不保證樣本資料真的
// 餵過每一條內部分支,分支有沒有被走到要看樣本,不能只看「呼叫的是同一支函式」。
//
// 🔴 修復輪 1 同時修正 W1-W4:原本的正則沒有錨定行首,一個 `// ` 前綴的註解(文字仍在檔案裡)
// 照樣會命中,等於「路由被停用了但判準還是綠的」。全部改成 `^...$` + `m` flag,要求整行文字
// 完全吻合,前面不能多出任何字元(含註解符號)。
//
// 🔴 修復輪 2(2026-09-04,複審發現,三條 Important):
//   (1) 上一段「【F】【E】【S】三段都會直接觀察到」宣稱過頭了——splitEvents 的
//       `startsIn || endsIn` 誤植成 `endsIn` 時,原本 9 筆樣本裡沒有任何一筆靠 startsIn
//       單獨入選,F 段照樣全綠。修法是補樣本(見下面 SAMPLE_EVENTS 的 s10 與真值表註解),
//       不是改程式碼——splitEvents 本身沒有錯,錯在測試沒餵到那個分支。
//   (2) W3 只用 .test() 判「存在」,判不出「唯一」;比照 W4 改成計數恰為 1。
//   (3) 新增 W6:【F】【E】【S】是直接呼叫 weekendBody、繞過 weekendBoard() 本體,
//       W5 也只驗到 body 有沒有被算出來,沒有任何判準看得到 body 有沒有真的被送進
//       HTTP 回應——手誤把 return 那行的 body 換成 {} 全部判準都不會紅。
//
// 【W】只驗 worker.js 的接線字面(import / 函式存在且只有一份 / 路由分派恰一份 / handler
// 呼叫 weekendBody 的方式 / body 有沒有真的被送進回應),不驗內部邏輯——邏輯的正確性交給
// 下面三段,因為它們現在跟 handler 呼叫同一支純函式,不是各自重算。
//
// 🔴 修復輪 3(2026-09-04,協調者驗收修復輪 2 時自己撞出來,非複審提出):原本 W5/W6 是在
// 【整份 worker.js】上找字面,沒有指名是在量哪一個函式——`jsonResCached(edge, cacheKey,
// body, 200,` 這串字同時出現在 delayHistory(:2663)與 weekendBoard(:4112),兩邊都用
// 「body」這個菜市場變數名。W6(舊編號)分辨得出來純屬巧合:delayHistory 那行接在同一行
// 尾巴、weekendBoard 那行剛好斷行,正則的行尾 `$` 才對不上前者——協調者用受控實驗證明,只要
// 把 delayHistory 那行【純格式】改成斷行寫法,即使 weekendBoard 自己的 body 被改成 {},
// W6 依然全綠。這是判準盲點形態 0(沒有證明「我在量的是誰」)。
// 修法:把 weekendBoard 的函式本體用大括號深度計數精確切出來(見下面 extractFunctionBody),
// W5/W6(舊編號,現改稱 W6/W7)只在這一段字串裡比對——其他函式的同款字面從此連候選資格
// 都沒有。切不出來(函式被改名/改形狀)不可以靜靜放行,新增的 W5 就是這道自保。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { twDayStr, nextHolidaySpan, weekendBody } from './weekend_core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const bad = [];
function chk(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; bad.push(name); console.log(`  ❌ ${name}${extra ? '　' + extra : ''}`); }
}

// 從整份原始碼裡精確切出某個函式的本體(用大括號深度計數,不是「找第一個貌似結尾的行」——
// 後者在函式內有 try/catch、巢狀物件字面量時,很容易切到內部某個 `}` 就提前收尾,而且切錯了
// 不會有任何跡象,比「直接在整份檔案裸比對」的原始盲點還難察覺)。
// 🔴 自保比照 scripts/check_daytype_sync.mjs 的既有寫法:找不到簽章、或抽出來的本體短得
// 不合理,一律丟例外,不可以靜靜跳過——跳過等於呼叫端的判準從此恆真,跟原本要修的盲點同類。
// sigRegex 依慣例要以函式本體開頭的 ` {` 結尾(如 `/^async function foo\(\) \{$/m`),
// 這樣 m[0] 的最後一個字元就是那個 `{`,可以直接從它的下一個字元開始算深度。
function extractFunctionBody(source, sigRegex, label) {
  const m = sigRegex.exec(source);
  if (!m) {
    throw new Error(`找不到函式簽章 ${sigRegex} —— ${label} 被改名或改了簽章形狀,`
      + `以它為範圍的判準已經失去作用,請先確認函式還在,再更新這裡的抽取方式`);
  }
  let depth = 1, i = m.index + m[0].length;
  const start = i;
  for (; i < source.length && depth > 0; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
  }
  if (depth !== 0) throw new Error(`${label}:大括號配對到檔案結尾都沒有閉合,抽取失敗`);
  const body = source.slice(start, i - 1);
  if (body.trim().length < 30) {
    throw new Error(`${label}:抽出的函式本體只有 ${body.trim().length} 字元,短得不合理,`
      + `抽取用的邊界很可能切錯了`);
  }
  return body;
}

console.log('\n【W】worker.js 接線(字面比對,全部錨定行首/行尾,不怕「註解掉但文字還在」)');
const w = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
chk('W1 有一行真的在生效的 import,且含 weekendBody',
  /^import \{[^}]*\bweekendBody\b[^}]*\} from '\.\/scripts\/weekend_core\.mjs';$/m.test(w));
chk('W2 有一行真的在生效的 async function weekendBoard(request, env) {',
  /^async function weekendBoard\(request, env\) \{$/m.test(w));
// 🔴 修復輪 2:W3 原本用 .test() 只判「存在」,不判「唯一」——這個 repo 有「合併之後
// 兩代防線都留下來」的復發紀錄,if-else-if 鏈裡若留下兩份 /api/weekend 分派,只有【先出現
// 的那份】會真的執行,若先出現的是壞的(指到舊函式、回舊形狀),.test() 照樣是綠的,因為它
// 只回答「檔案裡有沒有這串文字」,答不出「只有一份還是被合併成兩份」。改成比照 W4 計數。
chk('W3 路由分派恰有一份(不是「存在」而是「唯一」;若合併後留下兩份,只有先出現的那份會真的執行)',
  (w.match(/^\s*else if \(url\.pathname === '\/api\/weekend'\) res = await weekendBoard\(request, env\);$/gm) || []).length === 1,
  `實得 ${(w.match(/^\s*else if \(url\.pathname === '\/api\/weekend'\) res = await weekendBoard\(request, env\);$/gm) || []).length} 份`);
chk('W4 只接一次(沒有合併時留下兩份或殘留一份被註解掉的舊碼)',
  (w.match(/^async function weekendBoard\(/gm) || []).length === 1,
  `實得 ${(w.match(/^async function weekendBoard\(/gm) || []).length} 份`);
// 先把 weekendBoard 的函式本體切出來,下面 W6/W7 只在這一段裡比對(見上面 extractFunctionBody
// 的說明與修復輪 3 的動機)。切不到就讓這裡先紅,W6/W7 對空字串比對也會自然一起紅——
// 不是「跳過」,是「看得到的紅」,不會讓後面的判準靜靜變成恆真。
let weekendBoardBody = '';
let extractErr = null;
try {
  weekendBoardBody = extractFunctionBody(w, /^async function weekendBoard\(request, env\) \{$/m, 'weekendBoard');
} catch (e) { extractErr = e.message; }
chk('W5 抓得到 weekendBoard 的函式本體(抓不到,下面 W6/W7 兩條會失去作用,必須在這裡先紅)',
  !extractErr, extractErr || '');

// W6 只驗「handler 有沒有呼叫共用的 weekendBody,而且參數順序對不對」這條接線——
// 邏輯本身(拿掉 dedupeEvents、兩層對調、days 打成陣列…)全部發生在 weekendBody 內部,
// 屬於 weekend_core.mjs 的事,W 段管不到也不該管,下面【F】【E】【S】三段才是真正驗這些的地方。
// 比對範圍是 weekendBoardBody,不是整份 w——雖然「weekendBody」這個匯入符號目前在全檔案
// 唯一沒有真的撞名,但既然本體已經切出來了,同一個範圍一起用,不要一半量整份檔案、一半量
// 本體,徒增「這條到底在量誰」的認知負擔。
chk('W6 weekendBoard 內確實呼叫 weekendBody(today, span, eventsDoc, names)',
  /^\s*const body = weekendBody\(today, span, eventsDoc, names\);$/m.test(weekendBoardBody));
// 🔴 修復輪 2 新增、修復輪 3 訂正比對範圍(原編號 W5→W6、W6→W7,見檔頭修復輪 3 說明):
// 這條只驗到「body 有沒有被算出來」,沒有驗到「算出來的 body 有沒有真的被送進 HTTP 回應」——
// 把 return 那行的 body 手誤寫成 {} 或別的變數,原本除了這一條之外全部不會紅,因為
// 【F】【E】【S】三段是直接呼叫 weekendBody、完全繞過 weekendBoard() 這個 handler 本體的,
// body 算對了與 body 真的被回傳出去是斷開的兩件事。
// 這裡只能做到字面比對:worker.js 帶滿 Cloudflare 專屬全域(caches.default 等),node 直接
// import 會整支炸掉;任務書也已裁定不起 wrangler dev(.wrangler 本機快取跨重啟存活,突變
// 測試會假綠)。字串比對的代價是只要那行文字沒變就測不出「邏輯上是否真的送對」,但至少接得住
// 「回應引數被改成別的變數/字面值」這種最粗暴的手誤——這是已知取捨,不是懶得驗到底。
// 比對範圍限定在 weekendBoardBody:就算 worker.js 裡其他函式(例如 delayHistory)有一模一樣的
// `jsonResCached(edge, cacheKey, body, 200,` 字面、甚至被重排成同樣的斷行寫法,也不會被算進來
// 滿足這一條——這正是修復輪 3 要補的洞。
chk('W7 handler 真的把 weekendBody 算出來的 body 送進 HTTP 回應(不是手誤寫成 {} 或別的變數)',
  /^\s*return await jsonResCached\(edge, cacheKey, body, 200,$/m.test(weekendBoardBody));

console.log('\n【F】固定樣本回傳形狀(內容已知,不受空窗週影響;呼叫與 handler 相同的 weekendBody)');
// 用自己的小日曆表鎖出一個跟「今天」無關、確定是 3 天連假的區間:10-09(五,表定放假)
// 往後併入自然週末 10-10(六)、10-11(日)——算法與 weekend_core 自己的 D2/D3 測試相同,
// 只是換一組不查真表的輸入,不受日曆表逐年更新影響。
const SAMPLE_DAYTYPE = { '2026-10-09': 1 };
const SAMPLE_SPAN = nextHolidaySpan('2026-10-08', SAMPLE_DAYTYPE);
// 🔴 修復輪 2(2026-09-04):原本這裡宣稱的涵蓋範圍比實際多——splitEvents 的判準是
// `startsIn || endsIn`,兩個運算元各自成立的樣本都要有一筆,原本 9 筆漏了其中一種。
// 用 (startsIn, endsIn) 真值表逐筆對照,10 筆樣本現在四種「會入選」的路都至少走過一次:
//   (真,真) s1/s2/s3(單日事件,兩個旗標恆同值,不特別區分)
//   (假,真) s7 僅靠 endsIn 入選(對照 verify_weekend_core.mjs 的 j1;把 endsIn 那側拿掉,
//           s7 會從限定層漏到長期層——這條原本就測得到)
//   (真,假) s10 僅靠 startsIn 入選(對照 verify_weekend_core.mjs 的 h1;把 startsIn 那側拿掉,
//           s10 會從限定層漏到長期層——這是修復輪 2 補上的那一半,原本 9 筆完全零覆蓋,
//           `startsIn || endsIn` 誤植成 `endsIn` 時 F3/F4 仍然全綠)
//   (假,假) 但與區間相交 → 長期層 s4 獨立一則、s5+s6 會併成一則
// 另外 s1+s2 示範限定層兩筆會併成一場,s8/s9 示範跟區間完全不相交而必須被整筆濾掉。
const SAMPLE_EVENTS = [
  { id: 's1', title: '花燈市集', url: 'https://sample.invalid/1', start: '2026-10-09', end: '2026-10-09',
    anchor: { kind: 'station', sys: 'mrt', name: '測試站A' } },
  { id: 's2', title: '花燈市集', url: 'https://sample.invalid/1', start: '2026-10-10', end: '2026-10-10',
    anchor: { kind: 'station', sys: 'mrt', name: '測試站A' } },
  { id: 's3', title: '河岸音樂會', url: 'https://sample.invalid/2', start: '2026-10-11', end: '2026-10-11',
    anchor: { kind: 'station', sys: 'mrt', name: '測試站B' } },
  { id: 's4', title: '常態展覽', url: 'https://sample.invalid/3', start: '2026-09-01', end: '2026-12-31',
    anchor: { kind: 'station', sys: 'mrt', name: '測試站D' } },
  { id: 's5', title: '兩站巡迴展', url: 'https://sample.invalid/4', start: '2026-09-15', end: '2026-11-30',
    anchor: { kind: 'station', sys: 'mrt', name: '測試站E' } },
  { id: 's6', title: '兩站巡迴展', url: 'https://sample.invalid/4', start: '2026-09-15', end: '2026-11-30',
    anchor: { kind: 'station', sys: 'mrt', name: '測試站F' } },
  { id: 's7', title: '跨橋展覽尾聲', url: 'https://sample.invalid/5', start: '2026-10-01', end: '2026-10-09',
    anchor: { kind: 'station', sys: 'mrt', name: '測試站C' } },
  { id: 's8', title: '已結束的活動', url: 'https://sample.invalid/6', start: '2026-08-01', end: '2026-08-31',
    anchor: { kind: 'station', sys: 'mrt', name: '測試站G' } },
  { id: 's9', title: '太晚開始', url: 'https://sample.invalid/7', start: '2026-11-01', end: '2026-11-02',
    anchor: { kind: 'station', sys: 'mrt', name: '測試站H' } },
  { id: 's10', title: '跨月燈會', url: 'https://sample.invalid/8', start: '2026-10-11', end: '2026-10-20',
    anchor: { kind: 'station', sys: 'mrt', name: '測試站I' } },
];
// 跟 worker.js 的 weekendBoard 呼叫同一支函式,不是自己重組——這是修復輪 1 的重點。
const sampleBody = weekendBody('2026-10-08', SAMPLE_SPAN, { events: SAMPLE_EVENTS, updated: 'sample' }, {});

chk('F1 樣本區間確實是 10/09–10/11 三天(鎖住下面斷言的前提)',
  SAMPLE_SPAN.from === '2026-10-09' && SAMPLE_SPAN.to === '2026-10-11' && SAMPLE_SPAN.days.length === 3);
// F2 專門考「days: span.days.length 被誤寫成 days: span.days」這類 bug:字串比對抓不到
// (worker.js 呼叫端的文字完全沒變),但抽出共用函式後,只要 weekendBody 內部寫錯,
// 這裡量到的就會是陣列而不是數字——用 typeof 明確判型別,不依賴「陣列跟數字比較會怎麼轉型」
// 這種容易被誤會成巧合的行為。
chk('F2 span.days 是數字且等於 3(不是天數陣列)',
  typeof sampleBody.span.days === 'number' && sampleBody.span.days === 3,
  `實得 ${JSON.stringify(sampleBody.span.days)}(${typeof sampleBody.span.days})`);
// 🔴 4 場(不是修復輪 1 的 3 場):新增的 s10(僅靠 startsIn 入選)也在限定層裡,數法見上面
// SAMPLE_EVENTS 的真值表註解。這一條連同 F4 是 startsIn/endsIn 兩側各拿掉一側時都會紅的
// 主要判準——s7 撐 endsIn 那側、s10 撐 startsIn 那側,任一側被誤刪都會讓這裡的計數對不上。
chk('F3 限定層恰 4 場(去重後:花燈市集併 2 筆、跨橋展覽尾聲、河岸音樂會、跨月燈會)',
  sampleBody.events.length === 4, `實得 ${sampleBody.events.length}`);
chk('F4 長期層恰 2 則(去重後:兩站巡迴展併 2 筆、常態展覽)',
  sampleBody.alsoOpen.length === 2, `實得 ${sampleBody.alsoOpen.length}`);
chk('F5 每則都有 title 與至少一天',
  sampleBody.events.every(e => e.title && Array.isArray(e.days) && e.days.length >= 1));
chk('F6 每則的日子都落在區間內',
  // 🔴 加 Array.isArray 防線:少了它,「拿掉 dedupeEvents」這種讓 e.days 變成 undefined 的
  // 突變會讓這行拋 TypeError 炸掉整支腳本(F7 以後全部沒機會跑),而不是乾淨地讓這條變紅
  // ——F3/F5 已經先抓到那發突變,但腳本本身不該因為一條判準寫錯就讓後面的判準集體失蹤。
  sampleBody.events.every(e => Array.isArray(e.days) && e.days.every(d => d >= sampleBody.span.from && d <= sampleBody.span.to)));
chk('F7 url 全是 http(s) 或空', [...sampleBody.events, ...sampleBody.alsoOpen]
  .every(e => !e.url || /^https?:\/\//i.test(e.url)));
// F8/F9 是「層歸屬」判準:weekendBody 內部把 onlyThis/alsoOpen 對調時,F3/F4 的筆數會先
// 變紅(3↔2 剛好不同才看得出來),這兩條再從「哪個標題出現在哪一層」直接確認,兩個角度互補。
chk('F8 花燈市集歸在限定層、不在長期層',
  sampleBody.events.some(e => e.title === '花燈市集') && !sampleBody.alsoOpen.some(e => e.title === '花燈市集'));
chk('F9 常態展覽歸在長期層、不在限定層',
  sampleBody.alsoOpen.some(e => e.title === '常態展覽') && !sampleBody.events.some(e => e.title === '常態展覽'));

// 真實三份資產只讀一次,【E】【S】兩段共用同一個 span/today/names,一律呼叫 weekendBody。
const dayTypes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tw_daytype.json'), 'utf8'));
const eventsDoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/events.json'), 'utf8'));
const names = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/holiday_names.json'), 'utf8'));
const today = twDayStr(Date.now());
const span = nextHolidaySpan(today, dayTypes);

console.log('\n【E】空事件陣列時真實 span 的形狀仍完整(模擬空窗週的 events.json)');
{
  const emptySpan = span || { from: today, to: today, days: [today] };
  const emptyBody = weekendBody(today, emptySpan, { events: [] }, names);
  chk('E1 span 仍非 null(日曆表還沒用完)', !!span);
  chk('E2 空陣列時 span 三個欄位仍齊全,days 是數字',
    !!(emptyBody.span.from && emptyBody.span.to) && typeof emptyBody.span.days === 'number' && emptyBody.span.days >= 1);
  chk('E3 空陣列時 count 正確為 0 且 events/alsoOpen 是空陣列而非 undefined',
    emptyBody.count === 0 && Array.isArray(emptyBody.events) && emptyBody.events.length === 0
    && Array.isArray(emptyBody.alsoOpen) && emptyBody.alsoOpen.length === 0);
  chk('E4 空陣列時仍可序列化',
    (() => { try { JSON.parse(JSON.stringify(emptyBody)); return true; } catch (e) { return false; } })());
}

console.log('\n【S】真實資料回傳形狀(讀真實三份資產;只留空資料下也成立的斷言;呼叫同一支 weekendBody)');
// 🔴 這裡原本還有 S5/S6/S7/S9 四條 `.every()`/`.some()`/計數比較判準,已搬去上面的【F】段
// ——它們在 body.events=[] 時恆真(空窗週=多數週末的常態),留在這裡是無聲空過。
// 「兩層不重疊」保留在這裡:只要任一層有內容,判準就是在比對真實資料,不是純結構性恆真;
// 就算哪天兩層剛好都空,也不會給出錯的答案,只是零資訊(跟【E】段互補,不衝突)。
const body = weekendBody(today, span, eventsDoc, names);

chk('S1 span 三個欄位齊全,days 是數字', !!(body.span.from && body.span.to) && typeof body.span.days === 'number' && body.span.days >= 1);
chk('S2 span.from 不早於今天', body.span.from >= body.today);
chk('S3 label 是非空字串', typeof body.span.label === 'string' && body.span.label.length > 0);
chk('S4 count 等於 events 長度', body.count === body.events.length);
chk('S5 兩層不重疊',
  !body.events.some(a => body.alsoOpen.some(b => a.title === b.title && a.url === b.url)));
chk('S6 序列化得出來(沒有循環參照、沒有 undefined 破壞 JSON)',
  (() => { try { JSON.parse(JSON.stringify(body)); return true; } catch (e) { return false; } })());

console.log(`\n實際內容(今天 ${today})：`);
console.log(`  ${body.span.label} ${body.span.from}–${body.span.to}（${body.span.days} 天）· ${body.count} 場 · 另有 ${body.alsoOpen.length} 則長期檔`);
// 這段是診斷用列印,不是判準——但一樣不該在資料形狀壞掉時直接拋例外,否則連
// 上面「幾過幾失敗」那行都印不出來(突變測試時親眼撞見過:S4 等判準已經正確變紅,
// 卻因為這裡沒防護而讓整支腳本以未捕捉例外收場,乍看像是腳本本身壞了)。
for (const e of body.events) {
  console.log(`    · ${e.title}（${Array.isArray(e.days) ? e.days.join('、') : '(days 格式異常:' + JSON.stringify(e.days) + ')'}）`);
}

console.log(`\n${fail ? '❌' : '✅'} weekend-api：${pass} 過 / ${fail} 失敗`);
if (fail) { console.error('失敗項目：\n  - ' + bad.join('\n  - ')); process.exit(1); }
