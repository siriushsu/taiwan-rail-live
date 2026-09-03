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
let hwShouldFail = false, tkShouldFail = false, brShouldFail = false;
const resetCounts = () => { counts.tk = 0; counts.hw = 0; counts.br = 0; };
// 失敗退路的上限＝節流窗的兩倍。這裡刻意也用推導的寫法，與 worker.js 同一個來源，
// 免得改了節流窗之後這支腳本還在量舊數字（judgment 第七節第 3 條）。
const THROTTLE_MS = 60e3, TWO_WINDOWS_MS = THROTTLE_MS * 2 + 1e3;

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

globalThis.fetch = async (input, init) => {
  const url = String(input && input.url ? input.url : input);
  const body = String((init && init.body) || '');
  if (/getTrackInfo/.test(body)) {
    counts.tk++;
    if (tkShouldFail) return new Response('upstream boom', { status: 503 });
    return SOAP(tkRows());
  }
  if (/getCarWeightBRInfo/.test(body)) {
    counts.br++;
    if (brShouldFail) return new Response('upstream boom', { status: 503 });
    return SOAP(brRows());
  }
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
const { trtcHwStale, trtcHwFallbackUsable, trtcLive } = _trtc;
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

// 失敗退路的門檻（2026-09-03）：上限是節流窗的兩倍，過了就寧可留白不給過期擁擠度。
ok('trtcHwFallbackUsable：沒有記憶體時不可用', trtcHwFallbackUsable(null, 1e6) === false);
ok('trtcHwFallbackUsable：120,000ms 仍可用', trtcHwFallbackUsable({ rows: [], at: 0 }, 120000) === true);
ok('trtcHwFallbackUsable：120,001ms 已不可用', trtcHwFallbackUsable({ rows: [], at: 0 }, 120001) === false,
  '過了兩倍節流窗就不准再頂上');
ok('trtcHwFallbackUsable：兩側判定相反（不是恆真也不是恆假）',
  trtcHwFallbackUsable({ rows: [], at: 0 }, 120000) !== trtcHwFallbackUsable({ rows: [], at: 0 }, 120001));

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
const failBody = await call();       // 這輪打了但失敗
const afterFail = counts.hw;
advance(16e3);
hwShouldFail = false;
await call();                        // 下一輪必須重試，而不是等滿 60 秒
ok('CarWeight 失敗後下一輪立刻重試（沒有把失敗寫進記憶體）', counts.hw === afterFail + 1,
  `失敗輪後 hw=${afterFail}，再一輪後 hw=${counts.hw}`);

// ── 第 3.5 節：CarWeight 失敗那一輪，擁擠度不得整批消失（2026-09-03，使用者回報）─────
// 舊行為：打了但失敗 ⇒ hwRaw=[] ⇒ 那一輪每一台車都沒有 cars。手上明明有一份 ≤60 秒的
// 記憶體副本沒用。這一條就是在守「失敗的代價是資料晚一點，不是資料不見」。
ok('CarWeight 失敗那一輪仍有擁擠度（退回記憶體那份，不是整批空白）',
  /\[1,1,2,2,1,1\]/.test(carsOfRound(failBody)),
  `失敗輪 cars=${carsOfRound(failBody)}`);

// 🔴 反向對照：退路有上限，不是無限拿舊資料頂。讓記憶體超過兩倍節流窗再失敗一次，
//    這時必須留白——沒有這一條，上面那條就分不出「退路有效」與「退路根本沒有上限」。
advance(TWO_WINDOWS_MS);             // 距上次成功取得 > 120 秒
resetCounts();
hwShouldFail = true;
const staleBody = await call();
hwShouldFail = false;
ok('退路有上限：記憶體超過兩倍節流窗就留白（不給過期擁擠度）',
  !/\[1,1,2,2,1,1\]/.test(carsOfRound(staleBody)),
  `過期輪 cars=${carsOfRound(staleBody)}`);

// 🔴 退路不得把「三支全滅」偽裝成還有官方資料（worker.js :882 明文禁止：TrackInfo 失敗
//    不能被 CarWeight 的位置列蓋過去）。三支同時掛時必須走降級路徑，而不是因為記憶體裡
//    有一份舊 CarWeight 就照常發佈。判準看 boardPos.feedMode——降級時它是 held/outage。
advance(16e3);
hwShouldFail = false;
await call();                        // 先讓 CarWeight 記憶體重新變新鮮
const healthyFeedMode = (await call()).boardPos?.feedMode ?? null;
advance(16e3);
hwShouldFail = true; tkShouldFail = true; brShouldFail = true;
const allDownBody = await call();
hwShouldFail = false; tkShouldFail = false; brShouldFail = false;
ok('三支全滅時仍走降級路徑（記憶體裡的舊 CarWeight 不得偽裝成官方還在）',
  (allDownBody.boardPos?.feedMode ?? null) !== healthyFeedMode,
  `健康輪 feedMode=${healthyFeedMode}／全滅輪 feedMode=${allDownBody.boardPos?.feedMode ?? null}`);

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

Date.now = realNow;
console.log(failures ? `\n❌ ${failures} 條未通過` : '\n✅ 全部通過');
process.exit(failures ? 1 : 0);
