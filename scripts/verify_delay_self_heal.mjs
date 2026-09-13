#!/usr/bin/env node
// 台鐵誤點統計自我檢查(delaySelfHeal)一鍵驗收。跑法:node scripts/verify_delay_self_heal.mjs
//
// 背景:每日誤點 ingest(ingestDelayHistory)一天只有一發(15 1 * * *＝台北 09:15),第二發
// (15 4 * * *)是 owner 刻意停用的。2026-09-08~09-12 連五天,那一發在第一個 TDX 呼叫(取 token)
// 就吃 HTTP 429、整發拋例外;缺日自癒一發只補最舊 3 天,積欠超過 3 天時單靠每日那一發永遠追不上
// (09-13 補完 09-06~09-08 就停,統計窗仍落後好幾天)。delaySelfHeal 掛在每分鐘 cron,形狀同
// thsrSelfHeal:每 15 分鐘問一次 blob 迄日有沒有追上昨天,沒追上就當場補抓,讓積欠當天就能靠
// 多發接力補完,不必空等到隔天。這支驗收同時是那個修法的突變測試地基(見 worker.js 的
// git 歷史與 scripts/verify_delay_window_sentinel.mjs——那支只驗「有沒有發現落後」的巡檢哨兵,
// 這支驗「落後了會不會自己好」的修法本身)。
//
// 分層:H1/H2/H3/H6/H4/H5 直接呼叫 _ingest.delaySelfHeal(純函式呼叫+scripts/d1_local.mjs 的
// 真 SQLite D1 替身+攔截 globalThis.fetch,零 wrangler、零真上游);H7 是靜態原始碼檢查
// (布線有沒有接對,同 verify_thsr_schedule.mjs 的 V9)。
//
// 🔴 陷阱一(種子必須填滿掃描窗):ingestDelayHistory 掃的是「到昨天為止 35 天」(SCAN_WINDOW_DAYS,
// 這裡鏡射同一個數字,不匯出——worker.js 若改了這個私有常數,本支要跟著調整,見回報的風險說明),
// 從最舊開始補、一發最多 3 天(MAX_DATES_PER_RUN)。種子資料只放「刻意缺的那幾天」,其餘 35 天
// 視窗內的日期一律填滿,否則它會先去補更早的空日,案例就測到錯的東西。
//
// 🔴 陷阱二(時鐘對齊):ingestDelayHistory 用 Date.now() 算「昨天」,delaySelfHeal 的節奏/時段
// 閘門看 event.scheduledTime——兩者必須對齊到同一個台北日,所以這裡整支把 Date.now 換成可控的
// NOW,每次要模擬某個台北時刻就同時挪動 NOW 與傳入的 scheduledTime,結束時還原。
//
// 🔴 陷阱三(token 模組層快取):getToken 的 tok/tokExp 是模組層變數,第一次成功後 24 小時內
// 不會再打 token 端點。H6(token 429)必須是全檔第一個真的觸發 getToken 的案例,否則後面案例
// 早就把 token 快取填好,H6 的 429 替身永遠不會被打到。H1/H2 全程不碰 D1、H3 不落後,兩者都
// 不會呼叫 getToken,所以只要讓 H6 排在 H4/H5 之前執行即可(執行順序,不是印出來的編號順序)。
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
  return `${nd.getUTCFullYear()}-${String(nd.getUTCMonth() + 1).padStart(2, '0')}-${String(nd.getUTCDate() + 0).padStart(2, '0')}`;
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

// ── TDX 替身(攔 globalThis.fetch,鐵則 3:零真上游)────────────────────────────
const AUTH_URL_TEST = 'http://local-test.invalid/auth/token';
let authStatus = 200;
let authHits = 0;
const historyHits = [];               // 實際被要求歷史 API 的日期(判準的獨立來源,同 thsr 的 hits[])
const emptyDays = new Set();          // 對這些日期回空 JSONL,模擬「上游還沒發布」
function jsonlFor(dayIso) {
  return JSON.stringify({ TrainNo: '1001', StationID: '1080', DelayTime: 3, SrcUpdateTime: `${dayIso}T10:00:00+08:00` }) + '\n';
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
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
    return new Response(emptyDays.has(day) ? '' : jsonlFor(day), { status: 200 });
  }
  throw new Error('未預期的上游請求(驗收禁止打真上游):' + url);
};

// ── 一被 prepare 就拋:證明早退分支真的沒碰 D1,而不是碰了但剛好沒事 ──────────────
const forbiddenDb = { prepare() { throw new Error('不該碰 D1'); } };

// stub 先架好才動態 import worker.js(同 verify_trtc_call_budget.mjs 慣例)。
const { _ingest } = await import('../worker.js');
const { delaySelfHeal, DELAY_HEAL_EVERY_MIN, DELAY_HEAL_FROM_MIN_OF_DAY, buildBlob } = _ingest;

const DELAY_BLOB_KEY = 'tra_delay_stats_30d';   // 鏡射 worker.js 的私有常數(delayStats 端點本身也是這樣內嵌字串,同一種慣例)
const SCAN_WINDOW_DAYS = 35;                    // 鏡射 worker.js 的私有 SCAN_WINDOW_DAYS(陷阱一;若上游調整需同步)
const MAX_DATES_PER_RUN = 3;                    // 鏡射 worker.js 的私有 MAX_DATES_PER_RUN(規格明講不得更動這顆常數)

console.log(`[準備] TODAY=${TODAY} YESTERDAY=${YESTERDAY} EVERY_MIN=${DELAY_HEAL_EVERY_MIN} FROM_MIN_OF_DAY=${DELAY_HEAL_FROM_MIN_OF_DAY}`);

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
  // ── H1:節奏閘門——分鐘不是 15 的倍數,早退且不碰 D1 ──────────────────────────
  console.log('\n── H1: 節奏閘門 ──');
  {
    setNow(TODAY, 10, 7);
    historyHits.length = 0;
    const r = await delaySelfHeal({ scheduledTime: NOW }, { DELAY_DB: forbiddenDb });
    ok(`H1 台北 10:07(分鐘非 ${DELAY_HEAL_EVERY_MIN} 的倍數)→ skipped:'cadence'`, r.skipped === 'cadence', JSON.stringify(r));
    ok('H1 forbiddenDb 全程沒被碰(沒拋錯就是沒碰)', true);
    ok('H1 零上游呼叫', historyHits.length === 0 && authHits === 0, `history=${historyHits.length} auth=${authHits}`);
  }

  // ── H2:時段閘門——早於 09:30 早退不碰 D1;正向對照 09:30 forbiddenDb 必須拋錯 ──
  console.log('\n── H2: 時段閘門(含正向對照) ──');
  {
    setNow(TODAY, 9, 15);
    const r = await delaySelfHeal({ scheduledTime: NOW }, { DELAY_DB: forbiddenDb });
    ok('H2a 台北 09:15(早於 09:30)→ skipped:\'off-hours\'', r.skipped === 'off-hours', JSON.stringify(r));

    setNow(TODAY, 9, 30);
    let threw = false, msg = '';
    try { await delaySelfHeal({ scheduledTime: NOW }, { DELAY_DB: forbiddenDb }); }
    catch (e) { threw = true; msg = String((e && e.message) || e); }
    ok('H2b 正向對照:台北 09:30(到期)forbiddenDb 確實會被碰到並拋錯', threw && /不該碰 D1/.test(msg), msg);
  }

  // ── H3:不落後——迄日已是昨天,零上游呼叫、兩張表逐列不變 ─────────────────────
  console.log('\n── H3: 不落後 ──');
  {
    const DELAY_DB = await seedDb(YESTERDAY, []);   // 35 天全填滿,含昨天
    const before = await snapshotAll(DELAY_DB);
    setNow(TODAY, 9, 30);
    historyHits.length = 0;
    const authHitsBefore = authHits;
    const r = await delaySelfHeal({ scheduledTime: NOW }, mkEnv(DELAY_DB));
    ok('H3 behind:false 且 end=昨天', r.behind === false && r.end === YESTERDAY, JSON.stringify(r));
    ok('H3 零上游呼叫', historyHits.length === 0 && authHits === authHitsBefore, `history=${historyHits.length} auth自${authHitsBefore}起=${authHits - authHitsBefore}`);
    const after = await snapshotAll(DELAY_DB);
    ok('H3 兩張表逐列不變(零寫入)', before === after, `before=${before.length}bytes after=${after.length}bytes`);
  }

  // ── H6:token 429 → reject、D1 不變;token 恢復 200 → 同一時刻再跑一次會自己好 ──
  // 🔴 陷阱三:這是全檔第一個會真的呼叫 getToken 的案例(H1/H2 不碰 D1,H3 不落後),
  // 必須排在 H4/H5 之前執行,否則 tok/tokExp 模組層快取早就填好,429 替身永遠打不到。
  console.log('\n── H6: token 429(陷阱三——必須排在 H4/H5 之前執行) ──');
  {
    const DELAY_DB = await seedDb(YESTERDAY, [YESTERDAY]);   // 只缺昨天
    const before = await snapshotAll(DELAY_DB);
    setNow(TODAY, 9, 30);
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

  // ── H4:重現 09-13 事故形狀——積欠 4 天,分兩發接力補完,第三發不再落後 ──────────
  console.log('\n── H4: 積欠 4 天,兩發接力補完 ──');
  {
    const missing = [addDaysIso(YESTERDAY, -3), addDaysIso(YESTERDAY, -2), addDaysIso(YESTERDAY, -1), YESTERDAY];
    ok(`H4 契約:缺 4 天 > MAX_DATES_PER_RUN(${MAX_DATES_PER_RUN})——這個大小關係才會逼出「分兩發」`,
      missing.length > MAX_DATES_PER_RUN, `missing=${missing.length}`);
    const DELAY_DB = await seedDb(YESTERDAY, missing);

    setNow(TODAY, 9, 30);
    historyHits.length = 0;
    const r1 = await delaySelfHeal({ scheduledTime: NOW }, mkEnv(DELAY_DB));
    const want1 = missing.slice(0, MAX_DATES_PER_RUN);
    ok('H4-1 09:30 補最舊 3 天', r1.behind === true && JSON.stringify(r1.written) === JSON.stringify(want1), JSON.stringify(r1));
    ok('H4-1 healed:false(還缺最後一天)', r1.healed === false, JSON.stringify(r1));
    ok('H4-1 上游被要求的日期＝最舊 3 天(獨立來源核對)', JSON.stringify(historyHits) === JSON.stringify(want1), JSON.stringify(historyHits));

    setNow(TODAY, 9, 45);
    historyHits.length = 0;
    const r2 = await delaySelfHeal({ scheduledTime: NOW }, mkEnv(DELAY_DB));
    ok('H4-2 09:45 補最後 1 天且 healed:true', r2.behind === true && JSON.stringify(r2.written) === JSON.stringify([YESTERDAY]) && r2.healed === true, JSON.stringify(r2));
    ok('H4-2 blob 迄日追上昨天', r2.after === YESTERDAY, `after=${r2.after}`);
    ok('H4-2 上游被要求的日期＝最後 1 天', JSON.stringify(historyHits) === JSON.stringify([YESTERDAY]), JSON.stringify(historyHits));

    setNow(TODAY, 10, 0);
    historyHits.length = 0;
    const r3 = await delaySelfHeal({ scheduledTime: NOW }, mkEnv(DELAY_DB));
    ok('H4-3 10:00 behind:false(追上了)', r3.behind === false && r3.end === YESTERDAY, JSON.stringify(r3));
    ok('H4-3 hits 不再增加', historyHits.length === 0, `hits=${JSON.stringify(historyHits)}`);
  }

  // ── H5:上游還沒發布——只缺昨天,替身回空 JSONL → 不拋、healed:false、沒多寫一天 ──
  console.log('\n── H5: 上游還沒發布(空 JSONL) ──');
  {
    const DELAY_DB = await seedDb(YESTERDAY, [YESTERDAY]);
    emptyDays.add(YESTERDAY);
    setNow(TODAY, 9, 30);
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
    ok('H7 布線:delaySelfHeal 掛在每分鐘 cron 分支內', /delaySelfHeal\(event, env\)/.test(minuteBranch), `branch=${minuteBranch.length} bytes`);
    ok('H7 布線:自帶 .catch(不會改變 scheduled 的成功/失敗契約)', /delaySelfHeal\(event, env\)\.catch\(/.test(minuteBranch));
    ok('H7 布線:return 前有 await(waitUntil 可能被截斷,同 thsrHealTask 的理由)', /await delayHealTask;/.test(minuteBranch));
    const iThsr = minuteBranch.indexOf('await thsrHealTask;');
    const iDelay = minuteBranch.indexOf('await delayHealTask;');
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
