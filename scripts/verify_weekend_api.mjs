// /api/weekend 的形狀檢查。刻意不起 wrangler dev:
//   (1) .wrangler 的本機快取跨重啟存活,突變測試會假綠
//   (2) 這支端點沒有 D1、沒有上游、沒有 KV,邏輯全在 weekend_core.mjs,起 runtime 買不到東西
// 所以這裡驗兩件 runtime 之外的事:worker.js 的接線在不在(含「有沒有被拿掉/對調」)、
// 回傳物件的形狀對不對。
//
// 🔴 Section S(真實資料)原本有 S5/S6/S7/S9 四條 `.every()`/`.some()`/計數比較判準,
// 跑在【當下】的 data/events.json 上——今天有活動所以會過,但空窗週(多數週末的常態)
// 是 body.events=[] 時這幾條恆真,判準會無聲空過。拆成三段:
//   【F】固定樣本段:內嵌一組已知內容的 events,原本那四條搬來這裡跑,並加具名筆數斷言
//       (恰 N/M 場),分母不會無聲縮水。
//   【E】空陣列段:拿真實 span 配上手造的空 events,直接證明【S】留下的斷言在空資料下
//       撐得住,而不是只用嘴巴論證。
//   【S】真實資料段:只留在空資料下仍然成立的斷言(span 形狀/count===events.length/
//       兩層不重疊/可序列化)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { twDayStr, nextHolidaySpan, splitEvents, dedupeEvents, spanLabel } from './weekend_core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const bad = [];
function chk(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; bad.push(name); console.log(`  ❌ ${name}${extra ? '　' + extra : ''}`); }
}

console.log('\n【W】worker.js 接線');
const w = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
chk('W1 有 import weekend_core', /from '\.\/scripts\/weekend_core\.mjs'/.test(w));
chk('W2 有 weekendBoard 函式', /async function weekendBoard\(/.test(w));
chk('W3 路由分派有一行 /api/weekend',
  /else if \(url\.pathname === '\/api\/weekend'\) res = await weekendBoard\(request, env\);/.test(w));
chk('W4 只接一次(沒有合併時留下兩份)',
  (w.match(/async function weekendBoard\(/g) || []).length === 1,
  `實得 ${(w.match(/async function weekendBoard\(/g) || []).length} 份`);
// W5/W6 刻意扣著「欄位: dedupeEvents(哪個變數, span)」的字面文字,不是只查函式存不存在。
// 「拿掉 dedupeEvents 呼叫」與「限定層/長期層對調」這兩種突變只改函式【內部】、
// 不改函式簽章與路由,W1-W4 對這兩種突變完全瞎——沒有這兩條,Step 6 後兩發突變測試
// 找不到任何會變紅的判準(【F】段是拿 weekend_core.mjs 重跑一次自己的樣本,不讀 worker.js,
// 對 worker.js 內部寫錯同樣是瞎的)。
chk('W5 events 欄位呼叫 dedupeEvents(onlyThis, span)(未被拿掉或跟長期層對調)',
  /events:\s*dedupeEvents\(onlyThis,\s*span\)/.test(w));
chk('W6 alsoOpen 欄位呼叫 dedupeEvents(alsoOpen, span)(未被拿掉或跟限定層對調)',
  /alsoOpen:\s*dedupeEvents\(alsoOpen,\s*span\)/.test(w));

console.log('\n【F】固定樣本回傳形狀(內容已知,不受空窗週影響)');
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
// 與 weekendBoard 完全相同的管線:nextHolidaySpan → splitEvents → dedupeEvents → 組 body。
const { onlyThis: sOnly, alsoOpen: sAlso } = splitEvents(SAMPLE_EVENTS, SAMPLE_SPAN);
const sampleBody = {
  today: '2026-10-08',
  span: { from: SAMPLE_SPAN.from, to: SAMPLE_SPAN.to, days: SAMPLE_SPAN.days.length, label: spanLabel(SAMPLE_SPAN, {}) },
  events: dedupeEvents(sOnly, SAMPLE_SPAN),
  alsoOpen: dedupeEvents(sAlso, SAMPLE_SPAN),
  updated: 'sample',
};
sampleBody.count = sampleBody.events.length;

chk('F1 樣本區間確實是 10/09–10/11 三天(鎖住下面斷言的前提)',
  SAMPLE_SPAN.from === '2026-10-09' && SAMPLE_SPAN.to === '2026-10-11' && SAMPLE_SPAN.days.length === 3);
chk('F2 限定層恰 3 場(去重後:花燈市集併 2 筆、跨橋展覽尾聲、河岸音樂會)',
  sampleBody.events.length === 3, `實得 ${sampleBody.events.length}`);
chk('F3 長期層恰 2 則(去重後:兩站巡迴展併 2 筆、常態展覽)',
  sampleBody.alsoOpen.length === 2, `實得 ${sampleBody.alsoOpen.length}`);
chk('F4 每則都有 title 與至少一天',
  sampleBody.events.every(e => e.title && Array.isArray(e.days) && e.days.length >= 1));
chk('F5 每則的日子都落在區間內',
  sampleBody.events.every(e => e.days.every(d => d >= sampleBody.span.from && d <= sampleBody.span.to)));
chk('F6 去重真的有作用(原始 4 筆嚴格併成 3 場)',
  sOnly.length === 4 && sOnly.length > sampleBody.events.length,
  `原始 ${sOnly.length} vs 去重後 ${sampleBody.events.length}`);
chk('F7 url 全是 http(s) 或空', [...sampleBody.events, ...sampleBody.alsoOpen]
  .every(e => !e.url || /^https?:\/\//i.test(e.url)));
// F8/F9 是「層歸屬」判準,考的是 weekend_core.mjs 的 splitEvents 有沒有把兩層分對——
// 若把 worker.js 的 onlyThis/alsoOpen 對調,真正抓到那發突變的是上面的 W6(檢查 worker.js
// 的字面接線);這兩條額外守住「就算接線字面沒錯,樣本本身分層分對了嗎」這一半。
chk('F8 花燈市集歸在限定層、不在長期層',
  sampleBody.events.some(e => e.title === '花燈市集') && !sampleBody.alsoOpen.some(e => e.title === '花燈市集'));
chk('F9 常態展覽歸在長期層、不在限定層',
  sampleBody.alsoOpen.some(e => e.title === '常態展覽') && !sampleBody.events.some(e => e.title === '常態展覽'));

// 真實三份資產只讀一次,【E】【S】兩段共用同一個 span/today/names。
const dayTypes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tw_daytype.json'), 'utf8'));
const eventsDoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/events.json'), 'utf8'));
const names = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/holiday_names.json'), 'utf8'));
const today = twDayStr(Date.now());
const span = nextHolidaySpan(today, dayTypes);

console.log('\n【E】空事件陣列時真實 span 的形狀仍完整(模擬空窗週的 events.json)');
{
  const emptySpan = span || { from: today, to: today, days: [today] };
  const emptyBody = {
    today,
    span: { from: emptySpan.from, to: emptySpan.to, days: emptySpan.days.length, label: spanLabel(emptySpan, names) },
    events: dedupeEvents([], emptySpan),
    alsoOpen: dedupeEvents([], emptySpan),
    updated: null,
  };
  emptyBody.count = emptyBody.events.length;
  chk('E1 span 仍非 null(日曆表還沒用完)', !!span);
  chk('E2 空陣列時 span 三個欄位仍齊全', !!(emptyBody.span.from && emptyBody.span.to && emptyBody.span.days >= 1));
  chk('E3 空陣列時 count 正確為 0 且 events/alsoOpen 是空陣列而非 undefined',
    emptyBody.count === 0 && Array.isArray(emptyBody.events) && emptyBody.events.length === 0
    && Array.isArray(emptyBody.alsoOpen) && emptyBody.alsoOpen.length === 0);
  chk('E4 空陣列時仍可序列化',
    (() => { try { JSON.parse(JSON.stringify(emptyBody)); return true; } catch (e) { return false; } })());
}

console.log('\n【S】真實資料回傳形狀(讀真實三份資產;只留空資料下也成立的斷言)');
// 🔴 原本這裡還有 S5/S6/S7/S9 四條 `.every()`/`.some()`/計數比較判準,全部搬去上面的
// 【F】段——它們在 body.events=[] 時恆真(空窗週=多數週末的常態),留在這裡是無聲空過。
// 「兩層不重疊」保留在這裡:只要任一層有內容,判準就是在比對真實資料,不是純結構性恆真;
// 就算哪天兩層剛好都空,也不會給出錯的答案,只是零資訊(跟【E】段互補,不衝突)。
const { onlyThis, alsoOpen } = splitEvents(eventsDoc.events, span);
const body = {
  today,
  span: { from: span.from, to: span.to, days: span.days.length, label: spanLabel(span, names) },
  events: dedupeEvents(onlyThis, span),
  alsoOpen: dedupeEvents(alsoOpen, span),
  updated: eventsDoc.updated || null,
};
body.count = body.events.length;

chk('S1 span 三個欄位齊全', !!(body.span.from && body.span.to && body.span.days >= 1));
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
