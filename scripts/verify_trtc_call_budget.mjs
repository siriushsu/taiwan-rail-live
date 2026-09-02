#!/usr/bin/env node
// 北捷上游呼叫量的守門人（2026-09-02，北捷來函「8 月各支 API 逾 60 萬次」之後補的）。
//
// 這支要驗的**不是**回應長得對不對，而是【上游到底被打了幾次】——手法與
// verify_basemap_session_limit.mjs 同源：換掉 globalThis.fetch 自己數。理由一樣：
// 「回應看起來正常」對「我們有沒有省下那一發請求」完全失明，而省下的那一發才是本批的全部價值。
//
// 兩條被驗的性質：
//   1. 營運時段閘門：窗外（01:20–05:40）三支上游一律 0 次，且回應仍是可用的空看板
//      （src 仍為 'trtc'、board/trains 為空）——不得退化成 outage，否則前端中斷徽章整夜亮。
//   2. CarWeight 60 秒節流：TrackInfo／CarWeightBR 每輪照打，CarWeight 每 60 秒才打一次；
//      且 CarWeight 失敗不得寫進記憶體（一次抖動不可以讓擁擠度靜音 60 秒）。
//
// 🔴 判準刻意寫「關係」不寫絕對數字（judgment 第七節第 3 條）：hw 的次數是從 tk 的次數與
//    時間軸推導出來的（每 60 秒一次），不是手打常數；改輪詢節奏時這支不會假紅。
//
// 跑法：node scripts/verify_trtc_call_budget.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const md5 = f => createHash('md5').update(readFileSync(path.join(ROOT, f))).digest('hex');
// 形態 0：先證明「我在量的是誰」——路徑與被驗檔的指紋，免得驗到別棵樹（memory: verify-target-wrong-tree）。
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] worker.js md5=${md5('worker.js')}`);

let failures = 0;
const ok = (name, pass, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!pass) failures++;
};

// ── 替身：caches / fetch / Date.now ──────────────────────────────────────────
// edge 一律 miss：本支要量的是「進到編排層之後還會不會打上游」，不是邊緣快取命中率。
// 邊緣命中會把整段邏輯短路掉，那樣量到的 0 次是假的（judgment 第八節：陰性結果先問環境有沒有能力觀察到）。
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

const SOAP = rows => new Response(
  `${JSON.stringify(rows)}<?xml version="1.0" encoding="utf-8"?><soap:Envelope></soap:Envelope>`,
  { status: 200, headers: { 'content-type': 'text/xml; charset=utf-8' } });

const counts = { tk: 0, hw: 0, br: 0 };
let hwShouldFail = false;
const resetCounts = () => { counts.tk = 0; counts.hw = 0; counts.br = 0; };

// 上游三支的最小可用列。欄位取自 memory/trtc-member-api.md 記錄的真實形狀。
const nowStr = () => new Date(NOW).toISOString().slice(0, 19).replace('T', ' ');
const tkRows = () => [
  { TrainNumber: '201', StationName: '西門站', DestinationName: '南港展覽館站', CountDown: '01:33', NowDateTime: nowStr() },
  { TrainNumber: '201', StationName: '台北車站', DestinationName: '南港展覽館站', CountDown: '03:10', NowDateTime: nowStr() },
];
const hwRows = () => [{ TrainNumber: '201', CN1: '211/212', CID: '1', StationID: 'BL16', utime: nowStr(),
  Cart1L: '1', Cart2L: '1', Cart3L: '2', Cart4L: '2', Cart5L: '1', Cart6L: '1' }];
const brRows = () => [{ TrainNumber: '119,180', CID: '1', DU: '下行', StationID: 'BR08',
  StationName: '科技大樓', Car1: '1', Car2: '1', Car3: '1', Car4: '1', UpdateTime: nowStr() }];

let traceColo = 'NRT';        // DO 自報的 colo,第 6 節之後會改成 'HKG' 驗禁區
let upstreamDelayMs = 0;      // >0 時上游變慢,用來驗 single-flight
globalThis.fetch = async (input, init) => {
  const url = String(input && input.url ? input.url : input);
  const body = String((init && init.body) || '');
  // Durable Object 讀自己落在哪個 colo。這一發不算北捷上游,不進 counts。
  if (url.includes('cdn-cgi/trace')) return new Response(`fl=1f1\ncolo=${traceColo}\n`, { status: 200 });
  if (upstreamDelayMs) await new Promise(r => setTimeout(r, upstreamDelayMs));
  if (/getTrackInfo/.test(body)) { counts.tk++; return SOAP(tkRows()); }
  if (/getCarWeightBRInfo/.test(body)) { counts.br++; return SOAP(brRows()); }
  if (/getCarWeightByInfoEx/.test(body)) {
    counts.hw++;
    if (hwShouldFail) return new Response('upstream boom', { status: 503 });
    return SOAP(hwRows());
  }
  throw new Error(`未預期的上游請求：${url}`);
};

// 時鐘替身：trtcMemoStale（15 秒）與 trtcHwStale（60 秒）都讀 Date.now()，
// 不能真的等——真的等會讓這支跑 100 秒以上，而且時間一長就會漂進別的營運時段。
let NOW = Date.UTC(2026, 8, 2, 4, 0, 0); // 2026-09-02 12:00 台北 = 營運窗內
const realNow = Date.now;
Date.now = () => NOW;
const advance = ms => { NOW += ms; };

const { _trtc } = await import('../worker.js');
const { trtcHwStale, trtcLive, TrtcPoller, TRTC_POLLER_HINT, TRTC_POLLER_DENY_COLO, trtcForgetMemoForTest } = _trtc;
const { trtcOperatingState } = await import('./trtc_board_ledger.mjs');

// env 替身：ASSETS 直接讀磁碟；刻意不給 TRTC_LEDGER（D1），
// 帳本／持久名冊那幾條會走各自的 catch，與本支要量的上游次數正交。
const env = {
  TRTC_API_BASE: 'https://api.metro.taipei', TRTC_API_USER: 'fixture-user', TRTC_API_PASS: 'fixture-pass',
  ASSETS: { fetch: async (req) => {
    const rel = new URL(req.url).pathname.replace(/^\//, '');
    try { return new Response(readFileSync(path.join(ROOT, rel), 'utf8'), { status: 200 }); }
    catch { return new Response('missing', { status: 404 }); }
  } },
};
const call = async (overrides = {}) => {
  const res = await trtcLive(new Request('https://railisland.tw/api/trtc-live'), { ...env, ...overrides });
  return res.json();
};

// ── 第 1 節：門檻的邊界（純函式，不碰網路）─────────────────────────────────
ok('trtcHwStale：沒有記憶體時視為過期', trtcHwStale(null, 1e6) === true);
ok('trtcHwStale：59,999ms 未過期', trtcHwStale({ at: 0 }, 59999) === false);
ok('trtcHwStale：60,001ms 已過期', trtcHwStale({ at: 0 }, 60001) === true);
// 反向對照（judgment 第七節第 5 條）：門檻若被改成恆真/恆假，上面兩條必有一條會紅。
ok('trtcHwStale：兩側判定相反（門檻不是恆真也不是恆假）',
  trtcHwStale({ at: 0 }, 59999) !== trtcHwStale({ at: 0 }, 60001));

const tpe = (h, m) => Date.UTC(2026, 8, 2, h - 8, m, 0) / 1000; // 台北時 → epoch 秒
ok('營運窗：01:19 仍在窗內', trtcOperatingState(tpe(1, 19)).open === true);
ok('營運窗：01:21 已在窗外', trtcOperatingState(tpe(1, 21)).open === false);
ok('營運窗：05:39 仍在窗外', trtcOperatingState(tpe(5, 39)).open === false);
ok('營運窗：05:41 已在窗內', trtcOperatingState(tpe(5, 41)).open === true);

// ── 第 2 節：營運窗內——CarWeight 每 60 秒一次，另外兩支每輪都打 ─────────────
resetCounts();
const ROUNDS = 5, STEP_MS = 16e3;  // 16 秒 > 15 秒記憶體門檻 ⇒ 每一發都真的走一輪
const bodies = [];
for (let i = 0; i < ROUNDS; i++) { bodies.push(await call()); advance(STEP_MS); }
// 🔴 節流的整個賭注：「少打上游」不可以連帶「畫面少東西」。第 2 輪必定是節流命中的那一輪
// （t=16s，距上次取得 16 秒 < 60），它的擁擠度必須與第 1 輪一模一樣——少了這條，
// 上面那些次數斷言就算全綠，也可能是把擁擠度整個弄丟換來的。
const carsOfRound = b => JSON.stringify(((b && b.trains) || []).map(t => [t.no, t.cars || null]));
// 期望值從時間軸推導，不手打：60 秒節流在 0s 打一次，之後每滿 60 秒再一次。
const spanMs = STEP_MS * (ROUNDS - 1);
const expectedHw = 1 + Math.floor(spanMs / 60e3);
ok('營運窗內：TrackInfo 每輪都打', counts.tk === ROUNDS, `tk=${counts.tk}／輪數=${ROUNDS}`);
ok('營運窗內：CarWeightBR 每輪都打（車號配對需要新鮮列，刻意不節流）',
  counts.br === ROUNDS, `br=${counts.br}／輪數=${ROUNDS}`);
ok('營運窗內：CarWeight 依 60 秒節流', counts.hw === expectedHw,
  `hw=${counts.hw}／期望=${expectedHw}（跨距 ${spanMs / 1000}s）`);
ok('營運窗內：CarWeight 確實比另外兩支少（節流有作用）', counts.hw < counts.tk,
  `hw=${counts.hw} < tk=${counts.tk}`);
ok('節流命中的那一輪，擁擠度仍在且與上一輪相同（省的是請求，不是資料）',
  carsOfRound(bodies[1]) === carsOfRound(bodies[0]) && /\[1,1,2,2,1,1\]/.test(carsOfRound(bodies[1])),
  `輪1=${carsOfRound(bodies[0])}／輪2=${carsOfRound(bodies[1])}`);

// ── 第 3 節：CarWeight 失敗不得毒化記憶體 ───────────────────────────────────
// 失敗那輪若把 [] 寫進 trtcHwMem，擁擠度會靜音整整 60 秒；正確行為是下一輪就重試。
advance(60e3);                       // 讓節流到期
resetCounts();
hwShouldFail = true;
await call();                        // 這輪打了但失敗
const afterFail = counts.hw;
advance(16e3);
hwShouldFail = false;
await call();                        // 下一輪必須重試，而不是等滿 60 秒
ok('CarWeight 失敗後下一輪立刻重試（沒有把失敗寫進記憶體）', counts.hw === afterFail + 1,
  `失敗輪後 hw=${afterFail}，再一輪後 hw=${counts.hw}`);

// ── 第 4 節：營運窗外——三支都是 0，而且回應仍是可用的空看板 ─────────────────
// 🔴 先讓 60 秒節流到期再進窗外，否則「CarWeight 0 次」會是被【節流】擋住而不是被【閘門】擋住
//    ——那條斷言就會因為錯的理由而通過（M1 突變實測到的盲點：拿掉閘門它依然綠）。
advance(61e3);
resetCounts();
const closedEnv = { TRTC_NOW_EPOCH: String(tpe(3, 0)) };   // 03:00 台北，窗外
let closedBody = null;
for (let i = 0; i < 3; i++) { advance(16e3); closedBody = await call(closedEnv); }
ok('營運窗外：TrackInfo 0 次', counts.tk === 0, `tk=${counts.tk}`);
ok('營運窗外：CarWeight 0 次', counts.hw === 0, `hw=${counts.hw}`);
ok('營運窗外：CarWeightBR 0 次', counts.br === 0, `br=${counts.br}`);
ok('營運窗外：回應仍是 src=trtc 的空看板（不是 outage，前端中斷徽章不會整夜亮）',
  closedBody && closedBody.src === 'trtc' && Array.isArray(closedBody.board) && closedBody.board.length === 0 &&
  Array.isArray(closedBody.trains) && closedBody.trains.length === 0,
  `src=${closedBody && closedBody.src}／board=${closedBody && (closedBody.board || []).length}／trains=${closedBody && (closedBody.trains || []).length}`);

// ── 第 5 節：正向對照——窗內同樣的呼叫必須真的打得出去 ───────────────────────
// 沒有這一條，第 4 節的三個「=0」就是恆真判準（judgment 第七節第 5 條）：
// 只要 fetch 替身壞掉、或 trtcLive 整支拋例外，0 次一樣成立。
resetCounts();
advance(16e3);
const openBody = await call();
ok('正向對照：窗內同一條路徑真的會打上游（第 4 節的 0 不是恆真）',
  counts.tk > 0 && counts.br > 0, `tk=${counts.tk}／br=${counts.br}`);
ok('正向對照：窗內回得出非空看板', openBody && (openBody.board || []).length > 0,
  `board=${openBody && (openBody.board || []).length}`);


// ── 第 6 節：集中輪詢 —— 多個 colo 在同一個 15 秒窗內只換來一輪上游 ──────────────
// 這是整批的全部價值：省下的是「第 2..N 個 colo 本來會各打的那幾發」。回應長得對完全
// 證明不了這件事，所以這裡直接數 fetch。
const hints = [];
function makePollerBinding(env) {
  const insts = new Map();
  return {
    idFromName: name => ({ name }),
    get(id, opts) {
      hints.push(opts && opts.locationHint);
      let inst = insts.get(id.name);
      if (!inst) insts.set(id.name, inst = new TrtcPoller({}, env));
      return { fetch: () => inst.fetch(new Request('https://trtc-poller/raw')) };
    },
  };
}
const pollerEnv = { ...env };
pollerEnv.TRTC_POLLER = makePollerBinding(pollerEnv);
const callVia = async (extra = {}) => {
  const res = await trtcLive(new Request('https://railisland.tw/api/trtc-live'), { ...pollerEnv, ...extra });
  return res.json();
};

advance(61e3);                       // 讓 CarWeight 節流到期,起點乾淨
trtcForgetMemoForTest();
resetCounts();
const COLOS = 12;
let lastBody = null;
for (let i = 0; i < COLOS; i++) {
  trtcForgetMemoForTest();           // 模擬「換一個 colo」：新的 isolate、空的記憶體
  lastBody = await callVia();        // 時鐘不動 ⇒ 全部落在同一個 15 秒窗內
}
ok('集中輪詢：12 個 colo 在同一個 15 秒窗內只打一輪 TrackInfo',
  counts.tk === 1, `tk=${counts.tk}／colo 數=${COLOS}（未集中時會是 ${COLOS}）`);
ok('集中輪詢：CarWeightBR 同樣只打一輪', counts.br === 1, `br=${counts.br}`);
ok('集中輪詢：CarWeight 同樣只打一輪', counts.hw === 1, `hw=${counts.hw}`);
ok('集中輪詢：每個 colo 都拿到同一份非空看板（省呼叫沒有省掉資料）',
  lastBody && (lastBody.board || []).length > 0, `board=${lastBody && (lastBody.board || []).length}`);
// 🔴 期望值【寫死字面值】,不可寫成 `=== TRTC_POLLER_HINT`——那是從被驗的實作 import 進來的,
//    實作改成 'apac' 時判準會跟著改,比對永遠成立(judgment 第七節第 1 條:同源相等＝零資訊。
//    這一條原本就是這樣寫的,M3 突變當場存活才抓到)。'apac-ne' 是 2026-09-02 實測出來的
//    外部事實:各 8 顆新 DO,apac-ne 落 NRT/KIX/ICN 香港 0;apac 香港 3/8;apac-se 香港 7/8;
//    無提示 香港 4/8。它是「不會落在香港」的唯一已知選項,不是一個可以順手改的實作細節。
ok("集中輪詢：locationHint 一律是 apac-ne（apac／apac-se／無提示實測都會落香港）",
  hints.length > 0 && hints.every(h => h === 'apac-ne'), `取到的提示=${[...new Set(hints)]}`);
ok('集中輪詢：程式碼裡的常數就是 apac-ne（外部實測值，不是可自由更動的實作細節）',
  TRTC_POLLER_HINT === 'apac-ne', `TRTC_POLLER_HINT=${TRTC_POLLER_HINT}`);
ok('集中輪詢：回傳把「這輪誰打的上游」露出來（cd.poller）',
  lastBody && lastBody.cd && lastBody.cd.poller === 'NRT', `cd.poller=${lastBody && lastBody.cd && lastBody.cd.poller}`);

// 反向對照（judgment 第七節第 5 條）：上面那組「只打 1 次」若因為根本沒打而成立就毫無意義。
// 窗一過就必須真的再打一輪。
advance(16e3);
resetCounts();
trtcForgetMemoForTest();
await callVia();
ok('反向對照：15 秒窗過了就真的再打一輪（前面的 1 不是 0 偽裝的）',
  counts.tk === 1 && counts.br === 1, `tk=${counts.tk}／br=${counts.br}`);

// ── 第 7 節：single-flight —— 同時湧入不得放大成 N 發 ───────────────────────────
// 沒有這道，41 個 colo 同時過期會變成 41 發上游請求，比不集中還糟。
advance(16e3);
resetCounts();
upstreamDelayMs = 30;                // 讓上游慢到足以讓後續請求擠在同一個 inflight 裡
await Promise.all(Array.from({ length: 25 }, () => { trtcForgetMemoForTest(); return callVia(); }));
upstreamDelayMs = 0;
ok('single-flight：25 個 colo 同時撞上過期，上游仍只被打一輪',
  counts.tk === 1, `tk=${counts.tk}／併發數=25`);

// ── 第 8 節：落點在禁區 —— 一發上游都不准打 ────────────────────────────────────
// 🔴 順序很重要：擋在【發射之前】。若寫成「DO 先打完、邊緣事後判定違規再退回直打」，
//    結果是又真的從禁區打了上游、又多打一輪，是最糟的組合。
advance(16e3);
traceColo = 'HKG';
resetCounts();
trtcForgetMemoForTest();
const deniedEnv = { ...env };
deniedEnv.TRTC_POLLER = makePollerBinding(deniedEnv);   // 全新的 DO，這顆會落在 HKG
const deniedBody = await (async () => {
  const res = await trtcLive(new Request('https://railisland.tw/api/trtc-live'), deniedEnv);
  return res.json();
})();
ok('落點禁區：DO 在禁區時一發上游都沒打（退回直打的那一輪除外）',
  counts.tk === 1, `tk=${counts.tk}（若 DO 也打了會是 2）`);
ok('落點禁區：退回直打，且回傳把原因說出來',
  deniedBody && deniedBody.cd && deniedBody.cd.poller === 'denied:HKG',
  `cd.poller=${deniedBody && deniedBody.cd && deniedBody.cd.poller}`);
ok('落點禁區：仍然給得出正常看板（fail-open，不是整站空手）',
  deniedBody && (deniedBody.board || []).length > 0, `board=${(deniedBody.board || []).length}`);
ok('禁區清單確實含香港（實測 apac 3/8、無提示 4/8 會落在這裡）',
  TRTC_POLLER_DENY_COLO.has('HKG'));
traceColo = 'NRT';

// ── 第 8.5 節：輪詢者 Worker 沒設 TRTC secret —— 一發都不准打 ──────────────────
// 輪詢者是獨立 Worker、secret 與主站各存一份，漏設是真實可能。漏設時若照打，送出去的是
// 字面上的 "undefined" 帳密——在北捷正因呼叫量來函的時候丟一串認證失敗，是最糟的失敗方式。
advance(16e3);
resetCounts();
trtcForgetMemoForTest();
const noCredEnv = { ...env, TRTC_API_USER: '', TRTC_API_PASS: '' };
noCredEnv.TRTC_POLLER = makePollerBinding(noCredEnv);
const noCredBody = await (async () => {
  const res = await trtcLive(new Request('https://railisland.tw/api/trtc-live'), noCredEnv);
  return res.json();
})();
ok('無帳密：輪詢者一發上游都沒打（退回直打的那一輪除外）',
  counts.tk === 1, `tk=${counts.tk}（若輪詢者也拿 undefined 去打會是 2）`);
ok('無帳密：退回直打，站台照常有資料', (noCredBody.board || []).length > 0
  && noCredBody.cd.poller === 'denied:no-credentials',
  `board=${(noCredBody.board || []).length}／cd.poller=${noCredBody.cd && noCredBody.cd.poller}`);

// ── 第 9 節：DO 掛掉要 fail-open ───────────────────────────────────────────────
advance(16e3);
resetCounts();
trtcForgetMemoForTest();
const brokenEnv = { ...env, TRTC_POLLER: {
  idFromName: () => ({}),
  get: () => ({ fetch: async () => { throw new Error('DO 不可用'); } }),
} };
const brokenBody = await (async () => {
  const res = await trtcLive(new Request('https://railisland.tw/api/trtc-live'), brokenEnv);
  return res.json();
})();
ok('DO 掛掉：退回本 colo 直打，站台照常有資料',
  brokenBody && (brokenBody.board || []).length > 0 && counts.tk === 1,
  `board=${(brokenBody.board || []).length}／tk=${counts.tk}`);
ok('DO 掛掉：cd.poller 標成 direct（量會回到各 colo 各打，必須看得見）',
  brokenBody && brokenBody.cd && brokenBody.cd.poller === 'direct',
  `cd.poller=${brokenBody && brokenBody.cd && brokenBody.cd.poller}`);

// ── 第 10 節：CarWeight 的 60 秒節流在 DO 內仍然成立（而且現在是全球一份計時器）────
advance(61e3);
resetCounts();
const thrEnv = { ...env };
thrEnv.TRTC_POLLER = makePollerBinding(thrEnv);
const R = 5, STEP = 16e3;
for (let i = 0; i < R; i++) {
  trtcForgetMemoForTest();
  await trtcLive(new Request('https://railisland.tw/api/trtc-live'), thrEnv);
  advance(STEP);
}
const expHw = 1 + Math.floor((STEP * (R - 1)) / 60e3);
ok('集中輪詢下：TrackInfo 每輪都打', counts.tk === R, `tk=${counts.tk}／輪數=${R}`);
ok('集中輪詢下：CarWeight 仍依 60 秒節流', counts.hw === expHw, `hw=${counts.hw}／期望=${expHw}`);
ok('集中輪詢下：節流有作用（CarWeight 確實比 TrackInfo 少）', counts.hw < counts.tk,
  `hw=${counts.hw} < tk=${counts.tk}`);

Date.now = realNow;
console.log(failures ? `\n❌ ${failures} 條未通過` : '\n✅ 全部通過');
process.exit(failures ? 1 : 0);
