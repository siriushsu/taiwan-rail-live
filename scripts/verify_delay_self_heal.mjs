#!/usr/bin/env node
// 台鐵誤點統計自我檢查(delaySelfHeal)一鍵驗收。跑法:node scripts/verify_delay_self_heal.mjs
//
// 背景:每日誤點 ingest(ingestDelayHistory)一天只有一發(15 1 * * *＝台北 09:15),第二發
// (15 4 * * *)是 owner 刻意停用的。2026-09-08~09-12 連五天,那一發在第一個 TDX 呼叫(取 token)
// 就吃 HTTP 429、整發拋例外;缺日自癒一發只補最舊 3 天,積欠超過 3 天時單靠每日那一發永遠追不上
// (09-13 補完 09-06~09-08 就停,統計窗仍落後好幾天)。delaySelfHeal 掛在每分鐘 cron,問 blob
// 迄日有沒有追上昨天,沒追上就當場補抓,讓積欠當天就能靠多發接力補完,不必空等到隔天。
//
// 🔴 為什麼是「一天固定 5 個時刻」:ingestDelayHistory 每發只挑缺日裡「最舊的 3 天」補,TDX
// 對某天持續回空或持續出錯時,那 3 天永遠補不進去、昨天就永遠輪不到——這種「餓死」情境下,
// 若改成每隔 N 分鐘就檢查一次,一天的補抓次數就沒有上限(檢查越勤,越常重打注定失敗的同 3 天)。
// 改成 DELAY_HEAL_SLOTS 固定清單之後,一天的自癒檢查固定 5 次,結構上限封頂。
//
// 🔴 成本上限(結構推導,不是估計;細節見 worker.js DELAY_HEAL_SLOTS 上方註解):一天最多 6 發
// 會真的呼叫 ingestDelayHistory——5 個自癒時刻 + 每日 cron 那 1 發(15 1 * * *,不受這個閘門
// 控管,無條件執行)。每發最多補 MAX_DATES_PER_RUN=3 天,每天最多 1 次 429 重試(fetchDelayDay)
// ⇒ 每發最多 3×2=6 次歷史 API 請求。合計最壞 6 發×6 次＝**36 次歷史 API 請求/天**(全部遇到
// 429 重試);不計 429 重試則是 6×3=**18 次/天**。TDX 公開規則:歷史服務 10 次呼叫＝1 點、
// 用量到 105% 會硬斷線(全部即時資料一起停擺)。H8 驗的是自癒那 5 發的結構(不含每日 cron 的
// 份額);H9 驗逾時保護與全系統上限的算式;H12 驗 429 重試不會被放大成無限重打。
//
// 分層:H1/H3/H6/H8/H9/H10/H11/H12/H4/H5 直接呼叫 _ingest.delaySelfHeal(純函式呼叫+
// scripts/d1_local.mjs 的真 SQLite D1 替身+攔截 globalThis.fetch,零 wrangler、零真上游);
// H7 是靜態原始碼檢查(布線有沒有接對,同 verify_thsr_schedule.mjs 的 V9)。
//
// 🔴 陷阱一(種子必須填滿掃描窗):ingestDelayHistory 掃的是「到昨天為止 35 天」(SCAN_WINDOW_DAYS,
// 這裡鏡射同一個數字,不匯出——worker.js 若改了這個私有常數,本支要跟著調整,見回報的風險說明),
// 從最舊開始補、一發最多 3 天(MAX_DATES_PER_RUN)。種子資料只放「刻意缺的那幾天」,其餘 35 天
// 視窗內的日期一律填滿,否則它會先去補更早的空日,案例就測到錯的東西。
//
// 🔴 陷阱二(時鐘對齊):ingestDelayHistory 用 Date.now() 算「昨天」,delaySelfHeal 的時刻閘門
// 看 event.scheduledTime——兩者必須對齊到同一個台北日,所以這裡整支把 Date.now 換成可控的
// NOW,每次要模擬某個台北時刻就同時挪動 NOW 與傳入的 scheduledTime,結束時還原(H11 刻意讓
// 兩者分岔,單獨驗閘門讀的是哪一個)。
//
// 🔴 陷阱三(token 模組層快取):getToken 的 tok/tokExp 是模組層變數,第一次成功後 24 小時內
// 不會再打 token 端點。H6(token 429)必須是全檔第一個真的觸發 getToken 的案例,否則後面案例
// 早就把 token 快取填好,H6 的 429 替身永遠不會被打到。H1/H11 全程用 forbiddenDb(不論放不
// 放行都碰不到真上游)、H8(a)/H10 全程不落後或零缺日(零 TDX 呼叫)、H3 不落後,這些都不會
// 呼叫 getToken,所以只要讓 H6 排在 H4/H5/H8(b)/H9/H12 之前執行即可(執行順序,不是印出來的
// 編號順序)。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openTestDb } from './d1_local.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const md5 = f => createHash('md5').update(readFileSync(path.join(ROOT, f))).digest('hex');
// 形態 0:先證明「我在量的是誰」,免得驗到別棵樹(memory: verify-target-wrong-tree)。
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] worker.js md5=${md5('worker.js')}`);

let failures = 0;
const ok = (name, pass, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!pass) failures++;
};

// ══════════════════════════ 共用工具(獨立於 worker.js,判準不得與實作同源) ══════════════════════════
// 全走 UTC 計算,語意獨立重寫(不 import worker.js 的 addDays——同 verify_thsr_schedule.mjs 的慣例)。
function addDaysIso(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const nd = new Date(Date.UTC(y, m - 1, d + delta));
  return `${nd.getUTCFullYear()}-${String(nd.getUTCMonth() + 1).padStart(2, '0')}-${String(nd.getUTCDate()).padStart(2, '0')}`;
}
// 台北 dateIso 當天 h:m 對應的 epoch ms(UTC 時刻減 8 小時)。
function mkNow(dateIso, h, m) {
  const [y, mo, d] = dateIso.split('-').map(Number);
  return Date.UTC(y, mo - 1, d, h, m) - 8 * 3600 * 1000;
}

// ── 時鐘替身(陷阱二):Date.now 全程可控,結束時還原 ──────────────────────────
const TODAY = '2026-09-20';           // 任選的模擬「今天」,與真實時鐘無關(不會踩到月底/跨月)
const YESTERDAY = addDaysIso(TODAY, -1);
let NOW = mkNow(TODAY, 9, 30);
const realDateNow = Date.now;
Date.now = () => NOW;
const setNow = (dateIso, h, m) => { NOW = mkNow(dateIso, h, m); };

// ── setTimeout 替身:只截「逾時計時器」那一種延遲,其餘 sleep 用的延遲照真的等 ─────
// H9b 要驗「body 讀取期間 abort 真的會讓這發 reject」,但 HIST_FETCH_TIMEOUT_MS(120000)
// 真的等 2 分鐘不切實際。這裡只攔截「delay 恰好等於 HIST_FETCH_TIMEOUT_MS」這一種
// setTimeout 呼叫,改成真的等一小段時間(20ms)就觸發;其餘 delay(429 重試用的 5000、
// 日間隔用的 2000)完全不受影響,繼續真的等——不影響 H6/H8b/H12 原本就依賴「真的等」的
// 計時語意。histTimeoutRealDelayMs 在動態 import 之後才會被賦值成 HIST_FETCH_TIMEOUT_MS
// 的實際值,賦值前維持 null=不生效。
const realSetTimeout = globalThis.setTimeout;
let histTimeoutRealDelayMs = null;
const HANG_TIMER_MS = 20;
globalThis.setTimeout = (fn, delay, ...args) => {
  if (histTimeoutRealDelayMs !== null && delay === histTimeoutRealDelayMs) return realSetTimeout(fn, HANG_TIMER_MS, ...args);
  return realSetTimeout(fn, delay, ...args);
};

// ── TDX 替身(攔 globalThis.fetch,鐵則 3:零真上游)────────────────────────────
const AUTH_URL_TEST = 'http://local-test.invalid/auth/token';
let authStatus = 200;
let authHits = 0;
const historyHits = [];               // 實際被要求歷史 API 的日期(判準的獨立來源,同 thsr 的 hits[])
const historySignals = [];            // 每次歷史 fetch 呼叫時的 init.signal(H9 驗證都是真的 AbortSignal)
const emptyDays = new Set();          // 對這些日期回空 JSONL,模擬「上游還沒發布」
const alwaysHistory429 = new Set();   // 對這些日期永遠回 429(初次+重試都是),模擬 429 重試耗盡(H12)
let hangDay = null;                   // 非 null 時,對這一天回一個 body 永不自然結束、但會聽 signal 的假回應(H9b)
function jsonlFor(dayIso) {
  return JSON.stringify({ TrainNo: '1001', StationID: '1080', DelayTime: 3, SrcUpdateTime: `${dayIso}T10:00:00+08:00` }) + '\n';
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input && input.url != null ? input.url : input);
  if (url === AUTH_URL_TEST) {
    authHits++;
    if (authStatus !== 200) return new Response('rate limited', { status: authStatus });
    return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 86400 }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  const m = url.match(/Historical\/Rail\/TRA\/LiveTrainDelay\?Dates=(\d{4}-\d{2}-\d{2})/);
  if (m) {
    const day = m[1];
    historyHits.push(day);
    historySignals.push(init && init.signal);
    if (alwaysHistory429.has(day)) return new Response('too many requests', { status: 429 });
    if (day === hangDay) {
      // body 讀取永遠不會自然 resolve,只靠呼叫端的 signal 觸發 abort 來讓它 reject——
      // 用來驗證逾時不是只掛在等回應標頭那一段,body 下載中也要能被中止(H9b)。
      const sig = init && init.signal;
      return {
        status: 200, ok: true,
        text: () => new Promise((resolve, reject) => {
          if (!sig) return; // 沒有 signal 就真的永遠掛住,測試本身會被外層逾時抓到(視為缺陷)
          if (sig.aborted) return reject(new DOMException('The operation was aborted.', 'AbortError'));
          sig.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true });
        }),
      };
    }
    return new Response(emptyDays.has(day) ? '' : jsonlFor(day), { status: 200 });
  }
  throw new Error('未預期的上游請求(驗收禁止打真上游):' + url);
};

// ── 一被 prepare 就拋:證明早退分支真的沒碰 D1,而不是碰了但剛好沒事 ──────────────
const forbiddenDb = { prepare() { throw new Error('不該碰 D1'); } };

// stub 先架好才動態 import worker.js(同 verify_trtc_call_budget.mjs 慣例)。
const { _ingest } = await import('../worker.js');
const { delaySelfHeal, DELAY_HEAL_SLOTS, HIST_FETCH_TIMEOUT_MS, buildBlob } = _ingest;
histTimeoutRealDelayMs = HIST_FETCH_TIMEOUT_MS;   // 現在才知道實際值,啟用 setTimeout 替身的攔截

const DELAY_BLOB_KEY = 'tra_delay_stats_30d';   // 鏡射 worker.js 的私有常數(delayStats 端點本身也是這樣內嵌字串,同一種慣例)
const SCAN_WINDOW_DAYS = 35;                    // 鏡射 worker.js 的私有 SCAN_WINDOW_DAYS(陷阱一;若上游調整需同步)
const MAX_DATES_PER_RUN = 3;                    // 鏡射 worker.js 的私有 MAX_DATES_PER_RUN(規格明講不得更動這顆常數)

console.log(`[準備] TODAY=${TODAY} YESTERDAY=${YESTERDAY} DELAY_HEAL_SLOTS=${JSON.stringify(DELAY_HEAL_SLOTS)} HIST_FETCH_TIMEOUT_MS=${HIST_FETCH_TIMEOUT_MS}`);

// H3 專用:包一層計數 prepare() 呼叫次數的殼,不擋 bind/all/first/run——用來分辨「只做了
// readEnd 那句 SELECT」與「誤跑了 ingestDelayHistory 的額外讀取」(即使那次誤跑本身零 TDX
// 呼叫、零 D1 寫入,讀取次數還是會露餡)。
function countingDb(realDb) {
  // 只數 prepare() 呼叫次數;batch() 原樣轉呼叫真正的 db,不然「M2:不落後時也跑 ingest」
  // 這種突變一旦讓 ingestDelayHistory 真的寫入,會在 writeDayRows 的 db.batch(...) 撞
  // TypeError 把整支腳本炸掉,而不是讓 H3 乾淨地紅一條(同 H1/H2 的 forbiddenDb 教訓)。
  const wrapper = {
    count: 0,
    prepare(sql) { wrapper.count++; return realDb.prepare(sql); },
    batch(stmts) { return realDb.batch(stmts); },
  };
  return wrapper;
}

// 填滿 [yesterdayIso-34, yesterdayIso] 這 35 天,missingDays 指定的日期刻意不寫——陷阱一的解法。
async function seedDb(yesterdayIso, missingDays) {
  const { DELAY_DB } = openTestDb();
  const missing = new Set(missingDays);
  const rows = [];
  for (let i = SCAN_WINDOW_DAYS - 1; i >= 0; i--) {
    const day = addDaysIso(yesterdayIso, -i);
    if (missing.has(day)) continue;
    const row = { service_date: day, train_no: '0000', final_delay: 0, max_delay: 0, events: 1, last_station: '0900', last_seen: `${day}T23:30:00+08:00` };
    rows.push(row);
    await DELAY_DB.prepare(
      'INSERT INTO tra_delay_daily (service_date, train_no, final_delay, max_delay, events, last_station, last_seen) VALUES (?,?,?,?,?,?,?)'
    ).bind(row.service_date, row.train_no, row.final_delay, row.max_delay, row.events, row.last_station, row.last_seen).run();
  }
  if (rows.length) {
    const blob = buildBlob(rows, '2000-01-01T00:00:00Z');
    if (blob) await DELAY_DB.prepare("INSERT OR REPLACE INTO kv_blobs(k,v,updated) VALUES(?,?,datetime('now'))").bind(DELAY_BLOB_KEY, blob.json).run();
  }
  return DELAY_DB;
}
const mkEnv = DELAY_DB => ({ DELAY_DB, TDX_AUTH_URL_OVERRIDE: AUTH_URL_TEST, TDX_CLIENT_ID: 'test-id', TDX_CLIENT_SECRET: 'test-secret' });
async function snapshotAll(DELAY_DB) {
  const daily = (await DELAY_DB.prepare('SELECT * FROM tra_delay_daily ORDER BY service_date, train_no').all()).results;
  const blob = await DELAY_DB.prepare('SELECT v FROM kv_blobs WHERE k=?').bind(DELAY_BLOB_KEY).first();
  return JSON.stringify({ daily, blobV: blob && blob.v });
}

try {
  // ── H1:固定時刻清單閘門——只有 DELAY_HEAL_SLOTS 裡的分鐘才放行,其餘一律早退不碰 D1 ──
  console.log('\n── H1: 固定時刻清單閘門(6 個代表時刻,正反都要) ──');
  {
    // 🔴 用 try/catch 包住,不能假設它一定乾淨 return:閘門若被拿掉或改壞(例如清單判斷式
    // 整個失效、或清單本身被清空),forbiddenDb 會被碰到並拋錯,若不接住這裡會拋出未捕捉
    // 例外、整支腳本當場中止,後面
    // 案例全部驗不到——那樣「H1 必須紅」變成「整支腳本崩潰」,訊號比 FAIL 更粗但掩蓋了
    // 其餘案例的結果,不利於一次看清楚突變影響範圍。
    // 用 forbiddenDb 同時做兩件事:skip 案例證明「沒碰到 D1」(沒拋錯),allow 案例證明
    // 「真的碰到 D1」(拋錯)——後者是正向對照,沒有它「skip 案例沒拋錯」可能只是巧合。
    const cases = [
      ['09:36', 9, 36, false],
      ['09:37', 9, 37, true],
      ['09:38', 9, 38, false],
      ['19:37', 19, 37, true],
      ['23:45', 23, 45, false],
      ['00:37', 0, 37, false],
    ];
    historyHits.length = 0;
    const authHitsBefore = authHits;
    for (const [label, h, m, allowed] of cases) {
      setNow(TODAY, h, m);
      let r = null, threw = null;
      try { r = await delaySelfHeal({ scheduledTime: NOW }, { DELAY_DB: forbiddenDb }); }
      catch (e) { threw = e; }
      if (allowed) {
        ok(`H1 台北 ${label}(在清單內)→ 正向對照:確實碰到 D1(forbiddenDb 拋錯)`,
          !!threw && /不該碰 D1/.test(String(threw.message)), threw ? String(threw.message) : JSON.stringify(r));
      } else {
        ok(`H1 台北 ${label}(不在清單)→ skipped:'not-slot',不碰 D1`,
          !threw && !!r && r.skipped === 'not-slot', threw ? `拋錯:${threw.message}` : JSON.stringify(r));
      }
    }
    ok('H1 全程零上游呼叫(forbiddenDb 讓放行案例也在碰到 fetch 之前就先拋錯)',
      historyHits.length === 0 && authHits === authHitsBefore, `history=${historyHits.length} auth自${authHitsBefore}起=${authHits - authHitsBefore}`);
  }

  // ── H3:不落後——真的分辨得出有沒有誤跑 ingest,不是只驗零副作用 ────────────────
  console.log('\n── H3: 不落後 ──');
  {
    // 種子刻意留一個「舊」缺日(yesterday-20,不是昨天)——如果不落後的早退被繞過而誤跑
    // ingestDelayHistory,這天會被當缺日抓,歷史 API 一定會被打到;不像「35 天全填滿」那樣
    // 讓誤跑 ingest 變成零 TDX、零寫入的空轉,「零上游呼叫」與「兩張表不變」都測不出回歸。
    const oldMissing = addDaysIso(YESTERDAY, -20);
    const DELAY_DB_RAW = await seedDb(YESTERDAY, [oldMissing]);
    const DELAY_DB = countingDb(DELAY_DB_RAW);
    const before = await snapshotAll(DELAY_DB_RAW);
    setNow(TODAY, 9, 37);
    historyHits.length = 0;
    const authHitsBefore = authHits;
    const r = await delaySelfHeal({ scheduledTime: NOW }, mkEnv(DELAY_DB));
    ok('H3 behind:false 且 end=昨天', r.behind === false && r.end === YESTERDAY, JSON.stringify(r));
    ok('H3 零上游呼叫(若誤跑 ingest,舊缺日 yesterday-20 一定會被抓,這裡會現形)',
      historyHits.length === 0 && authHits === authHitsBefore, `history=${historyHits.length} auth自${authHitsBefore}起=${authHits - authHitsBefore}`);
    ok('H3 D1 恰好只被 prepare 1 句(只有 readEnd 那句,沒有多跑 ingestDelayHistory 的讀取)',
      DELAY_DB.count === 1, `prepare 次數=${DELAY_DB.count}`);
    const after = await snapshotAll(DELAY_DB_RAW);
    ok('H3 兩張表逐列不變(零寫入)', before === after, `before=${before.length}bytes after=${after.length}bytes`);
  }

  // ── H6:token 429 → reject、D1 不變;token 恢復 200 → 同一時刻再跑一次會自己好 ──
  // 🔴 陷阱三:這是全檔第一個會真的呼叫 getToken 的案例(H1 全程 forbiddenDb 不碰 D1,
  // H3 不落後),必須排在 H4/H5/H8b/H9/H12 之前執行,否則 tok/tokExp 模組層快取早就填好,
  // 429 替身永遠打不到。
  console.log('\n── H6: token 429(陷阱三——必須排在 H4/H5/H8b/H9/H12 之前執行) ──');
  {
    const DELAY_DB = await seedDb(YESTERDAY, [YESTERDAY]);   // 只缺昨天
    const before = await snapshotAll(DELAY_DB);
    setNow(TODAY, 9, 37);
    historyHits.length = 0;
    authStatus = 429;
    let threw = false, msg = '';
    try { await delaySelfHeal({ scheduledTime: NOW }, mkEnv(DELAY_DB)); }
    catch (e) { threw = true; msg = String((e && e.message) || e); }
    ok('H6a token 429 → delaySelfHeal reject', threw && /tdx auth 429/.test(msg), msg);
    const afterFail = await snapshotAll(DELAY_DB);
    ok('H6a 429 失敗後兩張表逐列不變', before === afterFail);
    ok('H6a 429 失敗時零歷史 API 呼叫(還沒拿到 token 就先炸)', historyHits.length === 0, `history=${JSON.stringify(historyHits)}`);

    authStatus = 200;   // 下一發:token 端點恢復
    const r = await delaySelfHeal({ scheduledTime: NOW }, mkEnv(DELAY_DB));   // 同一個時刻再跑一次
    ok('H6b token 恢復後 → 補上、healed:true(證明下一發會自己好)',
      r.behind === true && r.healed === true && r.after === YESTERDAY, JSON.stringify(r));
    ok('H6b 歷史 API 只被要求了昨天這一天', JSON.stringify(historyHits) === JSON.stringify([YESTERDAY]), JSON.stringify(historyHits));
  }

  // ── H8:自癒本身的成本上限——(a) 一天 1440 分鐘只有 5 分鐘放行;(b) 餓死情境單發 ≤3 次歷史 API ──
  // 這裡驗的是「自癒那 5 發」的份額(5×3=15 次);含每日 cron 那 1 發的系統總上限見 H9。
  console.log('\n── H8: 自癒本身的成本上限(5 個時刻 × 單發最多 3 次 = 15 次) ──');
  {
    // (a) 用「不落後」的種子,讓放行的分鐘只做一句 D1 讀取就 return——省時間,不必真的補抓。
    console.log('  ── H8a: 整天 1440 分鐘逐分掃描,放行分鐘數必須恰為 5 ──');
    {
      const DELAY_DB_RAW = await seedDb(YESTERDAY, []);   // 不落後的種子(同 H3)
      const DELAY_DB = countingDb(DELAY_DB_RAW);
      historyHits.length = 0;
      let allowedCount = 0;
      const allowedMinutes = [];
      for (let minuteOfDay = 0; minuteOfDay < 1440; minuteOfDay++) {
        setNow(TODAY, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
        const r = await delaySelfHeal({ scheduledTime: NOW }, mkEnv(DELAY_DB));
        if (!r.skipped) { allowedCount++; allowedMinutes.push(minuteOfDay); }
      }
      // 期望值 5 是寫死的字面值,不准從 DELAY_HEAL_SLOTS.length 取——避免判準與實作同源(零資訊)。
      ok('H8a 整天 1440 分鐘裡,放行(沒回 skipped)的分鐘數恰為 5(寫死,非取自實作)', allowedCount === 5, `allowedCount=${allowedCount} minutes=${JSON.stringify(allowedMinutes)}`);
      // 次要佐證:也要等於 DELAY_HEAL_SLOTS.length——兩個獨立表達式一致,才說明寫死的 5 不是巧合
      // (這條是同源判準,只對「數量」有牙,對「哪幾個時刻」零資訊,見下一條)。
      ok('H8a 放行分鐘數同時等於 DELAY_HEAL_SLOTS.length(佐證,不取代上一條)', allowedCount === DELAY_HEAL_SLOTS.length, `slots.length=${DELAY_HEAL_SLOTS.length}`);
      // 放行分鐘逐一比對「寫死的字面清單」(09:37/10:37/12:37/15:37/19:37 換算成分鐘數),
      // 不取自 DELAY_HEAL_SLOTS——上一條同源判準對「哪幾個時刻」零資訊(例如把清單中段或
      // 後段的某個時刻換成另一個不影響長度的時刻,同源版本測不出來),這條才真的釘住位置。
      const EXPECTED_ALLOWED_MINUTES = [577, 637, 757, 937, 1177];   // 09:37 10:37 12:37 15:37 19:37
      ok('H8a 放行的分鐘清單逐一對上寫死的字面清單(不取自 DELAY_HEAL_SLOTS)',
        JSON.stringify(allowedMinutes) === JSON.stringify(EXPECTED_ALLOWED_MINUTES), JSON.stringify(allowedMinutes));
      // 每個放行時刻都要晚於 09:15(555,寫死)那發每日 cron——避免有時刻被移到當天資料
      // 還沒發布、每日 cron 可能還在跑的時段。
      ok('H8a 每個放行時刻都 > 555(09:15,寫死)', allowedMinutes.every(m => m > 555), JSON.stringify(allowedMinutes));
      ok('H8a 全程零上游呼叫(不落後的種子,連放行分鐘都只讀 D1 就 return)', historyHits.length === 0, `history=${historyHits.length}`);
      // 整天 D1 prepare 次數恰為 5(每個放行分鐘一句 readEnd,skip 的分鐘完全不碰 D1)——取代
      // 舊的「零 token 呼叫」斷言:H6 已經把 token 快取填滿 24 小時,H8a 全程落在同一個台北日,
      // 快取恆有效,原本比對 authHits 的那一半恆真、對任何回歸都是零資訊。
      ok('H8a 整天 D1 prepare 次數恰為 5(回歸多打或漏打 D1 都會被抓到)', DELAY_DB.count === 5, `prepare 次數=${DELAY_DB.count}`);
    }

    // (b) 餓死情境:35 天窗內最舊 3 個缺日永遠回空、昨天也缺——單發歷史 API 呼叫必須 ≤3、
    // D1 不寫任何列、blob 迄日不變。自癒本身的上限就是(a)的 5 發 ×(b)的 3 次 = 15 次;
    // 加計每日 cron 自己的份額,系統總上限見 H9 的算式。
    console.log('  ── H8b: 餓死情境(最舊 3 缺日永遠回空)單發 ≤3 次歷史 API、D1 不變 ──');
    {
      const oldest3 = [addDaysIso(YESTERDAY, -33), addDaysIso(YESTERDAY, -32), addDaysIso(YESTERDAY, -31)];
      const starveMissing = [...oldest3, YESTERDAY];
      const DELAY_DB = await seedDb(YESTERDAY, starveMissing);
      for (const d of oldest3) emptyDays.add(d);
      const readEndSql = "SELECT json_extract(v, '$._meta.date_range[1]') AS end FROM kv_blobs WHERE k = ?";
      const before = await snapshotAll(DELAY_DB);
      const endBefore = await DELAY_DB.prepare(readEndSql).bind(DELAY_BLOB_KEY).first();

      setNow(TODAY, 9, 37);   // 清單內的放行時刻
      historyHits.length = 0;
      const r = await delaySelfHeal({ scheduledTime: NOW }, mkEnv(DELAY_DB));
      ok('H8b 這一發確實嘗試補抓(behind:true——證明不是誤判成不落後才通過下面的檢查)', r.behind === true, JSON.stringify(r));
      ok('H8b 單發歷史 API 呼叫次數 ≤3(MAX_DATES_PER_RUN 封頂,沒有因為餓死而多打)', historyHits.length <= MAX_DATES_PER_RUN, `hits=${JSON.stringify(historyHits)}`);
      const after = await snapshotAll(DELAY_DB);
      ok('H8b D1 不寫任何一列(兩張表逐位元組不變)', before === after, `before=${before.length}bytes after=${after.length}bytes`);
      const endAfter = await DELAY_DB.prepare(readEndSql).bind(DELAY_BLOB_KEY).first();
      ok('H8b blob 迄日不變', (endBefore && endBefore.end) === (endAfter && endAfter.end), `before=${endBefore && endBefore.end} after=${endAfter && endAfter.end}`);
      for (const d of oldest3) emptyDays.delete(d);
    }
  }

  // ── H9:逾時保護——每次歷史 fetch 都要有真的 AbortSignal;系統總上限的算式要成立 ──────
  console.log('\n── H9: 逾時保護(真的 AbortSignal;系統總上限 < 15 分鐘牆鐘) ──');
  {
    const DELAY_DB = await seedDb(YESTERDAY, [YESTERDAY]);   // 只缺昨天(同 H5/H6 的最小情境)
    setNow(TODAY, 9, 37);
    historyHits.length = 0;
    historySignals.length = 0;
    const r = await delaySelfHeal({ scheduledTime: NOW }, mkEnv(DELAY_DB));
    ok('H9a 這一發確實打了歷史 API(不然下面驗不到 signal)', historyHits.length >= 1 && r.behind === true, `history=${JSON.stringify(historyHits)}`);
    ok('H9a 每一次歷史 fetch 的 init.signal 都是真的 AbortSignal(逾時能真的中止那個請求,不是純 Promise.race 那種放著背景孤兒請求跑)',
      historySignals.length > 0 && historySignals.every(s => s instanceof AbortSignal),
      `signals=${JSON.stringify(historySignals.map(s => s && s.constructor && s.constructor.name))}`);
    // 6 次請求(3 天 × 每天最多 1 次 429 重試)全部逾時的最壞情形,加上既有的 sleep 預算
    // (日間隔 2 秒×2 + 429 重試 5 秒×3 ＝19000ms),仍必須小於 Cloudflare cron 15 分鐘牆鐘——
    // 15 分鐘這裡寫死,不從任何常數推導,避免跟錯誤的假設同源。
    ok('H9b 最壞情形上限:6×HIST_FETCH_TIMEOUT_MS+19000 < 15×60×1000(15 分鐘寫死)',
      6 * HIST_FETCH_TIMEOUT_MS + 19000 < 15 * 60 * 1000, `6×${HIST_FETCH_TIMEOUT_MS}+19000=${6 * HIST_FETCH_TIMEOUT_MS + 19000}`);

    // H9c:逾時不是只掛在等回應標頭那一段——body 下載中被 abort 也要讓這次嘗試 reject。
    // 用 hangDay 讓替身回一個 body 永不自然結束、但會聽 signal 的假回應;setTimeout 替身
    // 把 HIST_FETCH_TIMEOUT_MS 那顆計時器縮短成真的 20ms 觸發,不必真的等 120 秒。
    // 🔴 用真的 3 秒 meta-timeout(realSetTimeout,不經過替身攔截)包住這次呼叫:如果逾時
    // 保護本身被拿掉(例如 fetch 沒帶 signal),假回應的 body 會真的永遠不 resolve,少了這層
    // 保護,整支驗收腳本會被這一個案例吊死,而不是乾淨地紅一條——寧可紅得明確,不要卡死。
    const DELAY_DB2 = await seedDb(YESTERDAY, [YESTERDAY]);
    hangDay = YESTERDAY;
    historyHits.length = 0;
    let threwHang = false, msgHang = '';
    try {
      await Promise.race([
        delaySelfHeal({ scheduledTime: NOW }, mkEnv(DELAY_DB2)),
        new Promise((_, reject) => realSetTimeout(() => reject(new Error('H9c 測試本身逾時(3 秒)——delaySelfHeal 沒有在預期時間內 reject,逾時保護可能被拿掉了')), 3000)),
      ]);
    } catch (e) { threwHang = true; msgHang = String((e && e.message) || e); }
    hangDay = null;
    ok('H9c body 讀取期間被 abort 時,delaySelfHeal 這一發 reject(逾時保護涵蓋到讀完 body 為止)',
      threwHang && /tdx historical timeout/.test(msgHang), msgHang);
  }

  // ── H10:blob 不存在——不能被當成「已追上」,補抓完之後要被重建出正確迄日 ────────────
  console.log('\n── H10: blob 不存在(不能被誤判成已追上) ──');
  {
    const DELAY_DB = await seedDb(YESTERDAY, []);   // D1 完整:35 天全滿,含昨天
    await DELAY_DB.prepare('DELETE FROM kv_blobs WHERE k = ?').bind(DELAY_BLOB_KEY).run();
    const check = await DELAY_DB.prepare('SELECT COUNT(*) AS n FROM kv_blobs WHERE k = ?').bind(DELAY_BLOB_KEY).first();
    ok('H10 種子確實建成:kv_blobs 完全沒有這一列', check.n === 0, `n=${check.n}`);
    setNow(TODAY, 9, 37);
    historyHits.length = 0;
    const r = await delaySelfHeal({ scheduledTime: NOW }, mkEnv(DELAY_DB));
    ok('H10 blob 不存在時 behind:true(不能被誤判成已追上)', r.behind === true, JSON.stringify(r));
    ok('H10 補抓之後迄日＝昨天(D1 本來就完整,written 應為空,單純是 blob 被重建)',
      r.after === YESTERDAY && JSON.stringify(r.written) === '[]', JSON.stringify(r));
    const endRow = await DELAY_DB.prepare("SELECT json_extract(v, '$._meta.date_range[1]') AS end FROM kv_blobs WHERE k = ?").bind(DELAY_BLOB_KEY).first();
    ok('H10 D1 裡的 blob 確實被重建、迄日正確', !!endRow && endRow.end === YESTERDAY, JSON.stringify(endRow));
  }

  // ── H11:時鐘分離——閘門必須看 event.scheduledTime,不是 Date.now() ─────────────────
  console.log('\n── H11: 時鐘分離(scheduledTime 與 Date.now 刻意不同值) ──');
  {
    const t37 = mkNow(TODAY, 9, 37);   // 清單內
    const t39 = mkNow(TODAY, 9, 39);   // 不在清單內

    NOW = t39;   // Date.now()→09:39(不在清單);scheduledTime→09:37(在清單內)
    let r1 = null, threw1 = null;
    try { r1 = await delaySelfHeal({ scheduledTime: t37 }, { DELAY_DB: forbiddenDb }); }
    catch (e) { threw1 = e; }
    ok('H11a scheduledTime=09:37(在清單)、Date.now=09:39(不在清單)→ 放行(碰到 D1 拋錯,證明讀的是 scheduledTime)',
      !!threw1 && /不該碰 D1/.test(String(threw1.message)), threw1 ? String(threw1.message) : JSON.stringify(r1));

    NOW = t37;   // Date.now()→09:37(在清單);scheduledTime→09:39(不在清單)
    let r2 = null, threw2 = null;
    try { r2 = await delaySelfHeal({ scheduledTime: t39 }, { DELAY_DB: forbiddenDb }); }
    catch (e) { threw2 = e; }
    ok('H11b scheduledTime=09:39(不在清單)、Date.now=09:37(在清單)→ 跳過不碰 D1(證明讀的是 scheduledTime)',
      !threw2 && !!r2 && r2.skipped === 'not-slot', threw2 ? `拋錯:${threw2.message}` : JSON.stringify(r2));
  }

  // ── H12:歷史 API 429 重試耗盡——1 次重試就是上限,不能被放大成無限重打 ─────────────
  console.log('\n── H12: 歷史 API 429 重試耗盡 ──');
  {
    const missing = [addDaysIso(YESTERDAY, -2), addDaysIso(YESTERDAY, -1), YESTERDAY];   // 3 個缺日
    const DELAY_DB = await seedDb(YESTERDAY, missing);
    const before = await snapshotAll(DELAY_DB);
    alwaysHistory429.add(missing[0]);   // 最舊那天永遠 429(初次+重試都 429)
    setNow(TODAY, 9, 37);
    historyHits.length = 0;
    let threw = false, msg = '';
    try { await delaySelfHeal({ scheduledTime: NOW }, mkEnv(DELAY_DB)); }
    catch (e) { threw = true; msg = String((e && e.message) || e); }
    ok('H12 429 重試耗盡後 delaySelfHeal reject', threw && /tdx historical 429/.test(msg), msg);
    ok('H12 歷史請求恰為 2 次,而且都是同一天(初次+1 次重試,沒有放大成更多次或改抓別天)',
      JSON.stringify(historyHits) === JSON.stringify([missing[0], missing[0]]), JSON.stringify(historyHits));
    ok('H12 沒有去抓第二個缺日(missing[1])', !historyHits.includes(missing[1]), `hits=${JSON.stringify(historyHits)}`);
    const after = await snapshotAll(DELAY_DB);
    ok('H12 D1 不變(兩張表逐位元組不變)', before === after, `before=${before.length}bytes after=${after.length}bytes`);
    alwaysHistory429.delete(missing[0]);
  }

  // ── H4:重現 09-13 事故形狀——積欠 4 天,分兩發接力補完,第三發不再落後 ──────────
  console.log('\n── H4: 積欠 4 天,兩發接力補完 ──');
  {
    const missing = [addDaysIso(YESTERDAY, -3), addDaysIso(YESTERDAY, -2), addDaysIso(YESTERDAY, -1), YESTERDAY];
    ok(`H4 契約:缺 4 天 > MAX_DATES_PER_RUN(${MAX_DATES_PER_RUN})——這個大小關係才會逼出「分兩發」`,
      missing.length > MAX_DATES_PER_RUN, `missing=${missing.length}`);
    const DELAY_DB = await seedDb(YESTERDAY, missing);

    setNow(TODAY, 9, 37);
    historyHits.length = 0;
    const r1 = await delaySelfHeal({ scheduledTime: NOW }, mkEnv(DELAY_DB));
    const want1 = missing.slice(0, MAX_DATES_PER_RUN);
    ok('H4-1 09:37 補最舊 3 天', r1.behind === true && JSON.stringify(r1.written) === JSON.stringify(want1), JSON.stringify(r1));
    ok('H4-1 healed:false(還缺最後一天)', r1.healed === false, JSON.stringify(r1));
    ok('H4-1 上游被要求的日期＝最舊 3 天(獨立來源核對)', JSON.stringify(historyHits) === JSON.stringify(want1), JSON.stringify(historyHits));

    setNow(TODAY, 10, 37);
    historyHits.length = 0;
    const r2 = await delaySelfHeal({ scheduledTime: NOW }, mkEnv(DELAY_DB));
    ok('H4-2 10:37 補最後 1 天且 healed:true', r2.behind === true && JSON.stringify(r2.written) === JSON.stringify([YESTERDAY]) && r2.healed === true, JSON.stringify(r2));
    ok('H4-2 blob 迄日追上昨天', r2.after === YESTERDAY, `after=${r2.after}`);
    ok('H4-2 上游被要求的日期＝最後 1 天', JSON.stringify(historyHits) === JSON.stringify([YESTERDAY]), JSON.stringify(historyHits));

    setNow(TODAY, 12, 37);
    historyHits.length = 0;
    const r3 = await delaySelfHeal({ scheduledTime: NOW }, mkEnv(DELAY_DB));
    ok('H4-3 12:37 behind:false(追上了)', r3.behind === false && r3.end === YESTERDAY, JSON.stringify(r3));
    ok('H4-3 hits 不再增加', historyHits.length === 0, `hits=${JSON.stringify(historyHits)}`);
  }

  // ── H5:上游還沒發布——只缺昨天,替身回空 JSONL → 不拋、healed:false、沒多寫一天 ──
  console.log('\n── H5: 上游還沒發布(空 JSONL) ──');
  {
    const DELAY_DB = await seedDb(YESTERDAY, [YESTERDAY]);
    emptyDays.add(YESTERDAY);
    setNow(TODAY, 9, 37);
    historyHits.length = 0;
    let threw = false;
    let r = null;
    try { r = await delaySelfHeal({ scheduledTime: NOW }, mkEnv(DELAY_DB)); }
    catch (e) { threw = true; }
    ok('H5 不拋例外', !threw);
    ok('H5 healed:false(上游仍是空的)', !!r && r.healed === false && JSON.stringify(r.written) === '[]', JSON.stringify(r));
    const row = await DELAY_DB.prepare('SELECT COUNT(*) AS n FROM tra_delay_daily WHERE service_date = ?').bind(YESTERDAY).first();
    ok('H5 tra_delay_daily 沒多出昨天那一天', row.n === 0, `n=${row.n}`);
    emptyDays.delete(YESTERDAY);
  }

  // ── H7:布線(靜態檢查)——delaySelfHeal 真的掛在每分鐘 cron 分支,且 return 前被 await ──
  console.log('\n── H7: 布線(靜態檢查) ──');
  {
    const src = readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
    const from = src.indexOf("event.cron === '* * * * *'");
    const to = src.indexOf('return ledger;', from);
    const minuteBranch = from >= 0 && to > from ? src.slice(from, to) : '';
    // 只在「未被 // 注解掉」的行裡找——單純子字串比對抓不到「整段被註解掉」這種寫法
    // (例如把布線那幾行整段加上 // 之後,子字串其實還在檔案裡,純粹的 .test(minuteBranch)
    // 會被騙過去,必須先濾掉注解行)。
    const activeBranch = minuteBranch.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    ok('H7 布線:delaySelfHeal 掛在每分鐘 cron 分支內(未被注解掉)', /delaySelfHeal\(event, env\)/.test(activeBranch), `branch=${minuteBranch.length} bytes`);
    ok('H7 布線:自帶 .catch(不會改變 scheduled 的成功/失敗契約)', /delaySelfHeal\(event, env\)\.catch\(/.test(activeBranch));

    // 「有 .catch(」只證明接住了,接住之後如果處理函式把例外原樣 throw 回去,await delayHealTask
    // 一樣會拋出——單看上面那條子字串比對抓不到這種改法,必須把處理函式的內文抽出來檢查。
    const catchStart = activeBranch.indexOf('delaySelfHeal(event, env).catch(');
    const catchEnd = catchStart >= 0 ? activeBranch.indexOf('});', catchStart) : -1;
    const catchBody = catchStart >= 0 && catchEnd > catchStart ? activeBranch.slice(catchStart, catchEnd) : '';
    ok('H7 布線:.catch 的處理函式內沒有 throw(不會把例外重新丟出去)',
      catchStart >= 0 && catchEnd > catchStart && !/\bthrow\b/.test(catchBody), `catchBody=${JSON.stringify(catchBody)}`);

    ok('H7 布線:有 ctx.waitUntil(delayHealTask)(tick 提早結束時這個 task 才不會被砍斷)',
      /ctx\.waitUntil\(delayHealTask\)/.test(activeBranch));
    ok('H7 布線:return 前有 await(waitUntil 可能被截斷,同 thsrHealTask 的理由)', /await delayHealTask;/.test(activeBranch));
    const iThsr = activeBranch.indexOf('await thsrHealTask;');
    const iDelay = activeBranch.indexOf('await delayHealTask;');
    ok('H7 布線:await 順序在 await thsrHealTask; 之後(規格明講的順序)', iThsr >= 0 && iDelay > iThsr, `iThsr=${iThsr} iDelay=${iDelay}`);

    const wcfg = readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8');
    const m = wcfg.match(/"crons"\s*:\s*(\[[^\]]*\])/);
    let cronsOk = false, cronsArr = null;
    try { cronsArr = m && JSON.parse(m[1]); cronsOk = Array.isArray(cronsArr) && JSON.stringify(cronsArr) === JSON.stringify(['* * * * *', '15 1 * * *']); } catch {}
    ok('H7 wrangler.jsonc 的 crons 陣列逐字恰為 ["* * * * *","15 1 * * *"](owner 停用的第二發沒被加回來)',
      cronsOk, m ? m[1] : 'crons 找不到');
  }
} finally {
  Date.now = realDateNow;
  globalThis.fetch = realFetch;
}

console.log(failures ? `\n❌ ${failures} 項失敗` : '\n✅ 全部通過');
process.exit(failures ? 1 : 0);
