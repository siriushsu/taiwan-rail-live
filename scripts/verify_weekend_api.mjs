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
// 也呼叫同一支),組裝邏輯只剩一份,「拿掉 dedupeEvents」「兩層對調」「days 打成陣列」這類
// 只存在於 weekendBody 內部的突變,現在【F】【E】【S】三段都會直接觀察到。
//
// 🔴 修復輪 1 同時修正 W1-W4:原本的正則沒有錨定行首,一個 `// ` 前綴的註解(文字仍在檔案裡)
// 照樣會命中,等於「路由被停用了但判準還是綠的」。全部改成 `^...$` + `m` flag,要求整行文字
// 完全吻合,前面不能多出任何字元(含註解符號)。
//
// 【W】只驗 worker.js 的接線字面(import / 函式存在且只有一份 / 路由分派 / handler 呼叫
// weekendBody 的方式),不驗邏輯——邏輯的正確性交給下面三段,因為它們現在跟 handler
// 呼叫同一支純函式,不是各自重算。
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

console.log('\n【W】worker.js 接線(字面比對,全部錨定行首/行尾,不怕「註解掉但文字還在」)');
const w = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
chk('W1 有一行真的在生效的 import,且含 weekendBody',
  /^import \{[^}]*\bweekendBody\b[^}]*\} from '\.\/scripts\/weekend_core\.mjs';$/m.test(w));
chk('W2 有一行真的在生效的 async function weekendBoard(request, env) {',
  /^async function weekendBoard\(request, env\) \{$/m.test(w));
chk('W3 有一行真的在生效的路由分派 /api/weekend',
  /^\s*else if \(url\.pathname === '\/api\/weekend'\) res = await weekendBoard\(request, env\);$/m.test(w));
chk('W4 只接一次(沒有合併時留下兩份或殘留一份被註解掉的舊碼)',
  (w.match(/^async function weekendBoard\(/gm) || []).length === 1,
  `實得 ${(w.match(/^async function weekendBoard\(/gm) || []).length} 份`);
// W5 只驗「handler 有沒有呼叫共用的 weekendBody,而且參數順序對不對」這條接線——
// 邏輯本身(拿掉 dedupeEvents、兩層對調、days 打成陣列…)全部發生在 weekendBody 內部,
// 屬於 weekend_core.mjs 的事,W 段管不到也不該管,下面【F】【E】【S】三段才是真正驗這些的地方。
chk('W5 weekendBoard 內確實呼叫 weekendBody(today, span, eventsDoc, names)',
  /^\s*const body = weekendBody\(today, span, eventsDoc, names\);$/m.test(w));

console.log('\n【F】固定樣本回傳形狀(內容已知,不受空窗週影響;呼叫與 handler 相同的 weekendBody)');
// 用自己的小日曆表鎖出一個跟「今天」無關、確定是 3 天連假的區間:10-09(五,表定放假)
// 往後併入自然週末 10-10(六)、10-11(日)——算法與 weekend_core 自己的 D2/D3 測試相同,
// 只是換一組不查真表的輸入,不受日曆表逐年更新影響。
const SAMPLE_DAYTYPE = { '2026-10-09': 1 };
const SAMPLE_SPAN = nextHolidaySpan('2026-10-08', SAMPLE_DAYTYPE);
// 9 筆手寫樣本,涵蓋:限定層兩筆會併成一場(s1+s2)、限定層僅靠 endsIn 入選的一筆(s7,
// 對照 verify_weekend_core.mjs 的 j1)、限定層獨立一筆(s3)、長期層兩筆會併成一則(s5+s6)、
// 長期層獨立一則(s4)、以及跟區間完全不相交而必須被濾掉的兩筆(s8 已結束、s9 太晚開始)。
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
chk('F3 限定層恰 3 場(去重後:花燈市集併 2 筆、跨橋展覽尾聲、河岸音樂會)',
  sampleBody.events.length === 3, `實得 ${sampleBody.events.length}`);
chk('F4 長期層恰 2 則(去重後:兩站巡迴展併 2 筆、常態展覽)',
  sampleBody.alsoOpen.length === 2, `實得 ${sampleBody.alsoOpen.length}`);
chk('F5 每則都有 title 與至少一天',
  sampleBody.events.every(e => e.title && Array.isArray(e.days) && e.days.length >= 1));
chk('F6 每則的日子都落在區間內',
  sampleBody.events.every(e => e.days.every(d => d >= sampleBody.span.from && d <= sampleBody.span.to)));
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
for (const e of body.events) console.log(`    · ${e.title}（${e.days.join('、')}）`);

console.log(`\n${fail ? '❌' : '✅'} weekend-api：${pass} 過 / ${fail} 失敗`);
if (fail) { console.error('失敗項目：\n  - ' + bad.join('\n  - ')); process.exit(1); }
