#!/usr/bin/env node
// 高鐵班表後端自動更新——V1-V6 一鍵驗收。跑法:node scripts/verify_thsr_schedule.mjs
//
// 分層(依「需不需要真的網路/wrangler」由輕到重):
//   V1/V2/V6  純函式直接 import worker.js 的 _thsr 導出,零 D1/網路/wrangler。
//   V3        pure-function 分支覆蓋 + scripts/d1_local.mjs 的真 SQLite D1 替身直接呼叫端點函式
//             (globalThis.caches 補 mock,沿用 verify_bounty_api.mjs 既有慣例),零 wrangler。
//   V4        真的 wrangler dev --test-scheduled(乾淨 detached worktree,避開重載風暴陷阱)+
//             本機 TDX fixture server(scripts/fixture_thsr_tdx.mjs),全程零真上游。只走兩天皆
//             成功的快樂路徑(驗布線),局部/全部失敗的保留語意由 V4b 補。
//   V4b       直接呼叫 ingestThsrSchedule(env)(d1_local 替身+行內 http server,不經 wrangler)——
//             驗工項明列的「一日失敗保留既有值、兩日全失敗不覆寫」分支,V4 沒走到這兩條。
//   V5        Playwright(chromium+webkit)+ 本機輕量 static+api server,測前端 API/退路雙路徑。
// 全綠 exit 0,任一 FAIL exit 1。
import { readFileSync, rmSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execSync, spawn, execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import worker, { _thsr } from '../worker.js';
import { openTestDb } from './d1_local.mjs';

const {
  thsrConvertDaily, thsrBuildStationMap, thsrSelectServedDay, thsrKeyToMs, thsrScheduleUrl,
  thsrSchedule, authUrl, ingestThsrSchedule, thsrSelfHeal,
} = _thsr;
// 抓取窗/保留上限是會調的旋鈕,判準一律從實作導出的常數推導(見情境 C 與 V7 的註解)。
const KEEP_WINDOW = _thsr.THSR_SCHED_FETCH_DAYS;
const KEEP_MAX = _thsr.THSR_SCHED_KEEP_DAYS;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// fixture＝TDX DailyTimetable/TrainDate 的原始回應。放 .cache/(gitignore＋assetsignore 皆已涵蓋,
// 不進版控也不會被 wrangler 當靜態資產上傳)。原本這裡釘死某個 session 的 scratchpad 絕對路徑,
// 那個目錄一消失整套驗收就跑不起來——改成 repo 內相對路徑,可用 THSR_FIXTURE_DIR 覆寫。
const FIXTURE_DIR = process.env.THSR_FIXTURE_DIR || path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '.cache/thsr_fixtures');

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const note = (name, detail) => console.log(`NOTE ${name} — ${detail}`);

console.log(`[G0] ROOT=${ROOT}`);

// ══════════════════════════ 共用工具 ══════════════════════════

// 獨立於 worker.js 的秒數轉換(判準不得與實作同源,見 assertion-blindspot-taxonomy)。
function hmsToSecIndep(t) {
  const p = String(t).split(':').map(Number);
  return p[0] * 3600 + p[1] * 60 + (p[2] || 0);
}
// 獨立重算「這班車轉換後應該長什麼樣」,直接讀原始 StopTimes,不呼叫 thsrConvertDaily 半步。
function expectedStopsFor(rec) {
  const seq = (rec.StopTimes || []).slice().sort((a, b) => a.StopSequence - b.StopSequence);
  const out = [];
  let prev = -1;
  for (const s of seq) {
    let arr = hmsToSecIndep(s.ArrivalTime || s.DepartureTime);
    let dep = hmsToSecIndep(s.DepartureTime || s.ArrivalTime);
    while (arr < prev) arr += 86400;
    while (dep < arr) dep += 86400;
    out.push({ name: s.StationName.Zh_tw, arr, dep });
    prev = dep;
  }
  return out;
}
// 台北「今天」YYYYMMDD——與 worker.js 的 twToday() 邏輯獨立重寫(同上理由),供 V3 seed 用。
function taipeiTodayKey() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return iso.replace(/-/g, '');
}
// 同上,但保留 YYYY-MM-DD 格式(ingestThsrSchedule 內部傳給 fetchThsrDaily 的 dateIso 就長這樣)+
// 獨立重寫的 addDays——與 worker.js 的 twToday()/addDays() 邏輯獨立(同上理由),供 V4b 用。
function taipeiTodayIso() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function addDaysIso(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const nd = new Date(Date.UTC(y, m - 1, d + delta));
  return `${nd.getUTCFullYear()}-${String(nd.getUTCMonth() + 1).padStart(2, '0')}-${String(nd.getUTCDate()).padStart(2, '0')}`;
}

const loadFixture = name => JSON.parse(readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
// 檔名不寫死日期:TDX 這支端點只給「今天起」的日期(過去日一律 400),所以每次重建 fixture 拿到的
// 日期都不同——掃目錄取最早三份即可(三份要是不同日,平日/週末班數本來就不一樣,V1 才有多樣性)。
const fixtureFiles = existsSync(FIXTURE_DIR)
  ? readdirSync(FIXTURE_DIR).filter(f => /^thsr_td_\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
  : [];
if (fixtureFiles.length < 3) {
  console.error(`[準備] FAIL — ${FIXTURE_DIR} 只有 ${fixtureFiles.length} 份 fixture,需要 3 份(不同日期)。`);
  console.error('  重建:取今天起的三個日期(含至少一個週末),各存一份 TDX 原始回應:');
  console.error('  https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/DailyTimetable/TrainDate/<YYYY-MM-DD>?$format=JSON');
  console.error(`  → ${FIXTURE_DIR}/thsr_td_<YYYY-MM-DD>.json`);
  process.exit(1);
}
const FIX = fixtureFiles.slice(0, 3).map(f => ({ label: f.slice(8, 18), daily: loadFixture(f) }));
const [FA, FB, FC] = FIX;
// V4/V5 的 TDX 替身對任何 :date 都回 FA,所以前端/端點看到的 doc.date 恆為 FA 的日鍵。
// 判準用它推導,不寫死某個日期字串(fixture 一重建日期就變,寫死＝下次必假紅)。
const FIX_KEY = FA.label.replace(/-/g, '');
const currentDenseDoc = JSON.parse(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json'), 'utf8'));
const stationMap = thsrBuildStationMap(currentDenseDoc);

console.log(`[準備] fixture ${FIX.map(f => `${f.label}=${f.daily.length} 班`).join(' / ')},` +
  `stationMap=${stationMap.size} 站,現行 dense 檔 trains=${currentDenseDoc.trains.length}`);

// ══════════════════════════ V1: 轉換正確性 ══════════════════════════
{
  for (const { label, daily } of FIX) {
    const dateIso = label;
    const { doc, meta } = thsrConvertDaily(daily, dateIso, stationMap);
    ok(`V1-${label} 車數＝上游有效班數(0 跳過)`, doc.trains.length === daily.length && meta.skipped.length === 0,
      `輸入${daily.length} 轉出${doc.trains.length} 跳過${JSON.stringify(meta.skipped)}`);
    let orderBad = 0, timeBad = 0, coordBad = 0;
    for (const t of doc.trains) {
      t.stops.forEach((s, i) => {
        if (s.order !== i + 1) orderBad++;
        if (s.arrSec > s.depSec) timeBad++;
        const want = stationMap.get(s.name);
        if (!want || want.lat !== s.lat || want.lon !== s.lon) coordBad++;
      });
    }
    ok(`V1-${label} 每班 stops 依 order 遞增`, orderBad === 0, `違反筆數=${orderBad}`);
    ok(`V1-${label} arrSec<=depSec`, timeBad === 0, `違反筆數=${timeBad}`);
    ok(`V1-${label} 站名座標與現行 dense 檔映射一致`, coordBad === 0, `違反筆數=${coordBad}`);

    // 抽 3 班(首/中/末)對上游原始 StopTimes 逐站核對秒值——核對邏輯完全獨立重算,不呼叫 thsrConvertDaily。
    const idxs = [...new Set([0, Math.floor(daily.length / 2), daily.length - 1])];
    let mismatch = 0;
    for (const idx of idxs) {
      const rec = daily[idx];
      const want = expectedStopsFor(rec);
      const got = doc.trains.find(t => t.train === rec.DailyTrainInfo.TrainNo);
      if (!got || got.stops.length !== want.length) { mismatch++; continue; }
      got.stops.forEach((s, i) => {
        if (s.name !== want[i].name || s.arrSec !== want[i].arr || s.depSec !== want[i].dep) mismatch++;
      });
    }
    ok(`V1-${label} 抽 ${idxs.length} 班逐站核對秒值(獨立重算)`, mismatch === 0, `不符筆數=${mismatch}, 車次=${idxs.map(i => daily[i].DailyTrainInfo.TrainNo).join(',')}`);
  }

  // 正向對照 A:整班站名映射外 → 該班跳過(不逐站過濾)
  {
    const corrupted = structuredClone(FA.daily);
    const victimNo = corrupted[3].DailyTrainInfo.TrainNo;
    corrupted[3].StopTimes[1].StationName.Zh_tw = '偽站不存在';
    const { doc, meta } = thsrConvertDaily(corrupted, FA.label, stationMap);
    const stillThere = doc.trains.some(t => t.train === victimNo);
    const skippedRight = meta.skipped.some(s => s.train === victimNo && s.reason === 'unknown_station' && s.stations.includes('偽站不存在'));
    ok('V1 正向對照(整班站名映射外→整班跳過,不逐站過濾)',
      doc.trains.length === FA.daily.length - 1 && !stillThere && skippedRight,
      `轉出${doc.trains.length}/預期${FA.daily.length - 1}, victim在場=${stillThere}, skipped=${JSON.stringify(meta.skipped)}`);
    const othersIntact = FA.daily.filter(r => r.DailyTrainInfo.TrainNo !== victimNo)
      .every(r => doc.trains.some(t => t.train === r.DailyTrainInfo.TrainNo));
    ok('V1 正向對照:其餘班次不受影響', othersIntact);
  }
  // 正向對照 B:停靠站 <2 → 跳過
  {
    const synth = [{ DailyTrainInfo: { TrainNo: 'X1' }, StopTimes: [{ StopSequence: 1, StationID: '1000', StationName: { Zh_tw: '台北' }, ArrivalTime: '08:00', DepartureTime: '08:00' }] }];
    const { doc, meta } = thsrConvertDaily(synth, FA.label, stationMap);
    ok('V1 正向對照(停靠站<2→跳過,reason=too_few_stops)',
      doc.trains.length === 0 && meta.skipped.length === 1 && meta.skipped[0].reason === 'too_few_stops', JSON.stringify(meta));
  }
}

// ══════════════════════════ V2: 結構等價 ══════════════════════════
{
  const { doc } = thsrConvertDaily(FA.daily, FA.label, stationMap);
  const topKeysWant = Object.keys(currentDenseDoc).sort();
  const topKeysGot = Object.keys(doc).sort();
  ok('V2 頂層鍵完全相同', JSON.stringify(topKeysWant) === JSON.stringify(topKeysGot), `want=${topKeysWant} got=${topKeysGot}`);
  const trainKeysWant = Object.keys(currentDenseDoc.trains[0]).sort();
  const trainKeysGot = Object.keys(doc.trains[0]).sort();
  ok('V2 trains 元素鍵完全相同', JSON.stringify(trainKeysWant) === JSON.stringify(trainKeysGot), `want=${trainKeysWant} got=${trainKeysGot}`);
  const stopKeysWant = Object.keys(currentDenseDoc.trains[0].stops[0]).sort();
  const stopKeysGot = Object.keys(doc.trains[0].stops[0]).sort();
  ok('V2 stops 元素鍵完全相同', JSON.stringify(stopKeysWant) === JSON.stringify(stopKeysGot), `want=${stopKeysWant} got=${stopKeysGot}`);
  // 型別逐鍵比對(頂層 + trains[0] + stops[0])
  let typeBad = [];
  for (const k of topKeysWant) if (typeof currentDenseDoc[k] !== typeof doc[k]) typeBad.push('top.' + k);
  for (const k of trainKeysWant) if (typeof currentDenseDoc.trains[0][k] !== typeof doc.trains[0][k]) typeBad.push('train.' + k);
  for (const k of stopKeysWant) if (typeof currentDenseDoc.trains[0].stops[0][k] !== typeof doc.trains[0].stops[0][k]) typeBad.push('stop.' + k);
  ok('V2 對應鍵型別相同', typeBad.length === 0, `不符鍵=${typeBad.join(',')}`);
  // 正向對照:刻意比對到不存在的鍵,證明比對邏輯真的會抓不一致
  const mutant = { ...doc, extraField: 1 };
  ok('V2 正向對照(多一個頂層鍵會被抓到)', JSON.stringify(Object.keys(mutant).sort()) !== JSON.stringify(topKeysWant));
}

// ══════════════════════════ V3: /api/thsr-schedule 選日邏輯 + D1 端到端 ══════════════════════════
{
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  const docA = { system: '高鐵時刻表', date: '20260807', trains: [] };
  const docB = { system: '高鐵時刻表', date: '20260808', trains: [] };

  // 純函式分支覆蓋
  {
    const hit = thsrSelectServedDay({ '20260807': docA, '20260808': docB }, '20260807');
    ok('V3 今天命中→原樣回傳,不加 served_date', hit.key === '20260807' && hit.doc === docA && !('served_date' in hit.doc));
  }
  {
    const fb = thsrSelectServedDay({ '20260805': docA, '20260810': docB }, '20260807');
    // 距今:0805→2天,0810→3天 → 應選 0805
    ok('V3 無今天→退最近日鍵(0805 比 0810 近)', fb.key === '20260805' && fb.doc.served_date === '20260805', JSON.stringify(fb));
  }
  {
    // 跨月邊界:今天 20260201,候選 20260131(1天)與 20260228(27天)。
    // 若誤用「數字相減」會得 |20260131-20260201|=70 vs |20260228-20260201|=27 → 錯選 0228。
    // thsrKeyToMs 走真實日期解析,應正確選出 0131。
    const cross = thsrSelectServedDay({ '20260131': docA, '20260228': docB }, '20260201');
    ok('V3 跨月邊界日曆距離正確(非數字相減)', cross.key === '20260131', JSON.stringify(cross));
  }
  ok('V3 空 days 回 null', thsrSelectServedDay({}, '20260807') === null);
  {
    // thsrKeyToMs 正向對照:同一天差 0
    ok('V3 正向對照(thsrKeyToMs 同日差 0ms)', thsrKeyToMs('20260807') - thsrKeyToMs('20260807') === 0);
    ok('V3 正向對照(thsrKeyToMs 跨月確實不同於數字差)', Math.abs(thsrKeyToMs('20260131') - thsrKeyToMs('20260201')) === 86400000);
  }

  // D1 端到端(scripts/d1_local.mjs 真 SQLite 替身,直接呼叫端點函式,零 wrangler)
  const req = (p) => new Request('https://railisland.tw' + p);
  const realTodayKey = taipeiTodayKey();

  // 404: blob 完全不存在
  {
    const { DELAY_DB } = openTestDb();
    const res = await thsrSchedule(req('/api/thsr-schedule'), { DELAY_DB });
    ok('V3 blob 不存在→404', res.status === 404, `status=${res.status}`);
  }
  // 200 today-hit: 種一筆以「真實台北今天」為鍵的 blob
  {
    const seedDoc = { system: '高鐵時刻表', date: realTodayKey, trains: [{ train: 'T-TODAY' }] };
    const blob = JSON.stringify({ fetchedAt: new Date().toISOString(), days: { [realTodayKey]: seedDoc } });
    const seedSql = `INSERT INTO kv_blobs (k,v,updated) VALUES ('thsr_sched', '${blob.replace(/'/g, "''")}', datetime('now'));`;
    const { DELAY_DB } = openTestDb(seedSql);
    const res = await thsrSchedule(req('/api/thsr-schedule'), { DELAY_DB });
    const body = await res.json();
    ok('V3 今天命中→200 且無 served_date', res.status === 200 && body.date === realTodayKey && !('served_date' in body),
      `status=${res.status} date=${body.date}`);
  }
  // 200 fallback: 只有一個遠離今天的日鍵 → 退最近日 + served_date
  {
    const farKey = '20260101';
    const seedDoc = { system: '高鐵時刻表', date: farKey, trains: [{ train: 'T-FAR' }] };
    const blob = JSON.stringify({ fetchedAt: new Date().toISOString(), days: { [farKey]: seedDoc } });
    const seedSql = `INSERT INTO kv_blobs (k,v,updated) VALUES ('thsr_sched', '${blob.replace(/'/g, "''")}', datetime('now'));`;
    const { DELAY_DB } = openTestDb(seedSql);
    const res = await thsrSchedule(req('/api/thsr-schedule'), { DELAY_DB });
    const body = await res.json();
    ok('V3 無今天→200 退最近日鍵並補 served_date', res.status === 200 && body.date === farKey && body.served_date === farKey,
      `status=${res.status} date=${body.date} served_date=${body.served_date}`);
    ok('V3 cache-control 含 s-maxage=300', /s-maxage=300/.test(res.headers.get('cache-control') || ''), res.headers.get('cache-control'));
  }
}

// ══════════════════════════ V6: 突變對照(證明 V1 逐站核對判準有牙) ══════════════════════════
{
  const { doc } = thsrConvertDaily(FA.daily, FA.label, stationMap);
  const idxs = [0, Math.floor(FA.daily.length / 2), FA.daily.length - 1];
  const checkAgainst = (candidateDoc) => {
    let mismatch = 0;
    for (const idx of idxs) {
      const rec = FA.daily[idx];
      const want = expectedStopsFor(rec);
      const got = candidateDoc.trains.find(t => t.train === rec.DailyTrainInfo.TrainNo);
      if (!got || got.stops.length !== want.length) { mismatch++; continue; }
      got.stops.forEach((s, i) => { if (s.depSec !== want[i].dep) mismatch++; });
    }
    return mismatch;
  };
  const cleanMismatch = checkAgainst(doc);
  ok('V6 未突變:判準對真實輸出全綠', cleanMismatch === 0, `mismatch=${cleanMismatch}`);
  const mutated = structuredClone(doc);
  for (const idx of idxs) {
    const rec = FA.daily[idx];
    const t = mutated.trains.find(x => x.train === rec.DailyTrainInfo.TrainNo);
    if (t) for (const s of t.stops) s.depSec += 60;   // 故意讓 depSec 全部 +60 秒
  }
  const mutatedMismatch = checkAgainst(mutated);
  ok('V6 突變 depSec+60 秒 → 判準必須轉紅(證明有牙)', mutatedMismatch > 0, `mismatch=${mutatedMismatch}`);
  ok('V6 還原後(未突變的 doc)依然全綠', checkAgainst(doc) === 0);
}

// ══════════════════════════ V4: cron 路徑端到端(真 wrangler dev --test-scheduled) ══════════════════════════
function waitFor(child, pattern, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`ready timeout: ${buf.slice(-2000)}`)), timeoutMs);
    const onData = chunk => { buf += String(chunk); if (pattern.test(buf)) { clearTimeout(timer); resolve(buf); } };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`exited ${code}: ${buf.slice(-2000)}`)); });
  });
}
// 就緒＝這台 server 對任何請求給得出一個 HTTP 回應,不看狀態碼(見 wrangler-local-verification-traps 心得9)。
async function waitForHttp(url, timeoutMs, child) {
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    const deadline = Date.now() + timeoutMs;
    let last = '(還沒送出任何請求)';
    while (Date.now() < deadline) {
      if (child && child.exitCode !== null) throw new Error(`server exited ${child.exitCode}`);
      try { const r = await fetch(url, { signal: AbortSignal.timeout(8000) }); await r.text(); return r.status; }
      catch (e) { last = String((e && e.message) || e); }
      await new Promise(res => setTimeout(res, 1000));
    }
    throw new Error(`ready timeout ${timeoutMs}ms：${url} 沒有任何回應(最後一次:${last})`);
  } finally {
    if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const curl = (url, args = []) => execFileSync('curl', ['-k', '-sS', ...args, url], { encoding: 'utf8' });

async function runV4() {
  const FIXTURE_PORT = Number(process.env.THSR_FIXTURE_PORT || 43991);
  const WORKER_PORT = Number(process.env.THSR_WORKER_PORT || 43993);
  const INSPECTOR_PORT = Number(process.env.THSR_INSPECTOR_PORT || 43994);
  const FIXTURE = `http://127.0.0.1:${FIXTURE_PORT}`;
  const BASE = `https://127.0.0.1:${WORKER_PORT}`;
  // 乾淨 detached worktree:wrangler dev 若從本工作樹啟動,assets.directory:"." 監看整棵樹(含未追蹤檔)
  // 會陷入重載風暴(見 wrangler-local-verification-traps 心得7),把處理中的請求殺掉。
  // 路徑放 repo 的 .cache/(gitignore＋assetsignore 皆已涵蓋);原本釘死某個 session 的 scratchpad,
  // 那個目錄早就不存在,每跑一次就在別處留一棵孤兒樹。
  const VTREE = path.join(ROOT, '.cache/thsr-v4-vtree');
  let fixtureProc, workerProc;
  try {
    rmSync(VTREE, { recursive: true, force: true });
    execSync(`git worktree add --detach "${VTREE}" HEAD`, { cwd: ROOT, stdio: 'pipe' });
    execSync(`ln -s "${path.join(ROOT, 'node_modules')}" "${path.join(VTREE, 'node_modules')}"`, { stdio: 'pipe' });
    rmSync(path.join(VTREE, '.wrangler'), { recursive: true, force: true });
    // 🔴 這棵樹是從 HEAD 建的 ⇒ V4 驗的是「已 commit 的版本」,不是工作樹。工作樹有未 commit 的
    // worker.js 改動時,V4 會安靜地驗舊程式碼並全綠(2026-08-17 實際踩到:改完抓取窗跑出 89/89,
    // 其中 V4 那組驗的其實是舊的兩天版)。先比對再往下跑,不符就當場 FAIL 並說清楚。
    const md5 = p => execFileSync('/sbin/md5', ['-q', p], { encoding: 'utf8' }).trim();
    const sameCode = md5(path.join(VTREE, 'worker.js')) === md5(path.join(ROOT, 'worker.js'));
    ok('V4 前置:驗的是當前工作樹的 worker.js(HEAD 與工作樹一致)', sameCode,
      sameCode ? '' : '工作樹有未 commit 的 worker.js 改動——V4 這組跑的是 HEAD 版本,先 commit 再跑');

    fixtureProc = spawn(process.execPath, [path.join(ROOT, 'scripts/fixture_thsr_tdx.mjs'), String(FIXTURE_PORT)],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    await waitFor(fixtureProc, /"ready":true/, 10000);

    workerProc = spawn('arch', ['-arm64', process.execPath, path.join(VTREE, 'node_modules/wrangler/bin/wrangler.js'),
      'dev', '--local-protocol', 'https', '--port', String(WORKER_PORT), '--inspector-port', String(INSPECTOR_PORT), '--test-scheduled',
      '--var', `TDX_AUTH_URL_OVERRIDE:${FIXTURE}/auth/token`,
      '--var', `THSR_SCHEDULE_BASE_URL_OVERRIDE:${FIXTURE}/Rail/THSR/DailyTimetable/TrainDate`],
      { cwd: VTREE, stdio: ['ignore', 'pipe', 'pipe'] });
    // /api/delay-stats 讀 kv_blobs——本機全新 D1 這張表通常還不存在,503 也算「有回應」,
    // 而且這一發順帶讓 miniflare 把 DELAY_DB 對應的本機 sqlite 檔生出來,供下面直接補 schema。
    await waitForHttp(`${BASE}/api/delay-stats`, 300000, workerProc);

    // 補 kv_blobs schema:本機 D1 沒有 migrations,worker.js 也不會自建這張表(不像 TRTC_LEDGER 有
    // on-boot schema)。刻意「只」建 kv_blobs、不建 tra_delay_daily/tra_station_events——讓同一輪
    // scheduled() 內、耦合在同一個 daily cron 分支的 ingestDelayHistory()(不相關的既有功能)在它
    // 第一句 SELECT tra_delay_daily 就丟「no such table」被自己的 try/catch 接住、不重試不 fallback、
    // 結構上到不了會打真上游的 getToken()/fetchDelayDay()——藉此在不改動該函式一行程式碼的前提下,
    // 保證觸發 daily cron 全程零真上游(見規則3)。pruneStationEvents 同理靠 tra_station_events 缺表擋掉。
    const d1Dir = path.join(VTREE, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
    let sqliteFiles = [];
    for (let i = 0; i < 20 && sqliteFiles.length === 0; i++) {
      sqliteFiles = existsSync(d1Dir) ? readdirSync(d1Dir).filter(f => f.endsWith('.sqlite')) : [];
      if (sqliteFiles.length === 0) await sleep(500);
    }
    ok('V4 本機 D1 sqlite 檔已生成', sqliteFiles.length > 0, `dir=${d1Dir} files=${JSON.stringify(sqliteFiles)}`);
    for (const f of sqliteFiles) {
      const db = new DatabaseSync(path.join(d1Dir, f));
      try { db.exec("CREATE TABLE IF NOT EXISTS kv_blobs (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated TEXT) WITHOUT ROWID;"); }
      finally { db.close(); }
    }

    // 觸發「每日」cron(非 * * * * *,落入 scheduled() 的 daily 分支)
    curl(`${BASE}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent('15 1 * * *')}`);
    await sleep(300);

    // 讀回 D1:找出真的寫進 thsr_sched 的那個檔(不假設哪個是 DELAY_DB——見上面補 schema 時的說明)
    let blobRow = null;
    for (const f of sqliteFiles) {
      const db = new DatabaseSync(path.join(d1Dir, f));
      try { const row = db.prepare("SELECT v FROM kv_blobs WHERE k='thsr_sched'").get(); if (row) blobRow = row; }
      catch (e) {}
      finally { db.close(); }
    }
    ok('V4 ingest 完成→D1 blob 落地(k=thsr_sched)', !!blobRow, blobRow ? `bytes=${blobRow.v.length}` : '找不到 thsr_sched 列');
    let blob = null;
    if (blobRow) { try { blob = JSON.parse(blobRow.v); } catch (e) {} }
    const dayKeys = blob ? Object.keys(blob.days || {}) : [];
    ok(`V4 blob.days 含 ${KEEP_WINDOW} 個日鍵(今天起的抓取窗)`, dayKeys.length === KEEP_WINDOW, `dayKeys=${JSON.stringify(dayKeys)}`);
    const anyDoc = blob && dayKeys.length ? blob.days[dayKeys[0]] : null;
    ok(`V4 轉出文件車數=fixture 車數(${FA.daily.length})`, anyDoc && anyDoc.trains.length === FA.daily.length, anyDoc ? `trains=${anyDoc.trains.length}` : 'anyDoc=null');

    // 端點吐得出來:直接打真的 /api/thsr-schedule(證明 fetch() 路由分派也接對了)
    const served = JSON.parse(curl(`${BASE}/api/thsr-schedule`));
    ok('V4 /api/thsr-schedule 吐得出剛寫入的今日文件', served && Array.isArray(served.trains) && served.trains.length === FA.daily.length,
      served ? `trains=${served.trains && served.trains.length}` : 'null');

    // 全程零真上游:fixture server 的 access log
    const state = JSON.parse(curl(`${FIXTURE}/__state`));
    const onlyLocal = state.calls.every(c => true); // fixture server 本身只可能被本機呼叫到(見下方 host 檢查)
    const scheduleCalls = state.calls.filter(c => c.path.startsWith('/Rail/THSR/DailyTimetable/TrainDate/'));
    const authCalls = state.calls.filter(c => c.path === '/auth/token');
    ok(`V4 全程零真上游(fixture server 收到 ${KEEP_WINDOW} 次班表請求+≥1 次 token 請求,皆為本機呼叫)`,
      scheduleCalls.length === KEEP_WINDOW && authCalls.length >= 1, `state=${JSON.stringify(state.calls)}`);

    // 冪等/續補檢查:未覆寫既有值——重跑一次應仍是 2 個日鍵(不是無限累積),且失敗重試安全
    curl(`${BASE}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent('15 1 * * *')}`);
    await sleep(300);
    let blob2 = null;
    for (const f of sqliteFiles) {
      const db = new DatabaseSync(path.join(d1Dir, f));
      try { const row = db.prepare("SELECT v FROM kv_blobs WHERE k='thsr_sched'").get(); if (row) blob2 = JSON.parse(row.v); }
      catch (e) {}
      finally { db.close(); }
    }
    ok(`V4 重跑 scheduled 仍保留 ${KEEP_WINDOW} 個日鍵(不無限累積)`, blob2 && Object.keys(blob2.days).length === KEEP_WINDOW, blob2 ? JSON.stringify(Object.keys(blob2.days)) : 'null');
  } finally {
    if (workerProc && !workerProc.killed) workerProc.kill('SIGTERM');
    if (fixtureProc && !fixtureProc.killed) fixtureProc.kill('SIGTERM');
    await sleep(500);
    try { execSync(`git worktree remove --force "${VTREE}"`, { cwd: ROOT, stdio: 'pipe' }); } catch (e) { console.warn('worktree remove 失敗(非致命):', e.message); }
  }
}

try {
  await runV4();
} catch (e) {
  ok('V4 執行區塊', false, `未捕捉例外:${(e && e.stack) || e}`);
}

// ══════════════════════════ V4b: ingestThsrSchedule 局部/全部失敗的保留語意 ══════════════════════════
// worker.js:3548-3557——單日失敗保留該日既有值(不拋例外、continue),兩日全失敗整體不覆寫既有 blob。
// V4 只驗了兩天皆成功的快樂路徑(wrangler cron 布線),這兩條分支沒被走到。直接呼叫函式本體
// (d1_local 真 SQLite 替身 + 行內 http server 頂替 TDX,不經 wrangler)比照 V3 的作法,快很多。
async function runIngestFailureSemantics() {
  let failDate = null; // null=全部成功;某個 dateIso 字串=只讓那天失敗;'BOTH'=兩天都失敗
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/auth/token') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ access_token: 'v4b-token', expires_in: 86400 }));
    }
    const m = url.pathname.match(/^\/Rail\/THSR\/DailyTimetable\/TrainDate\/(.+)$/);
    if (m) {
      const dateIso = decodeURIComponent(m[1]);
      if (failDate === 'BOTH' || failDate === dateIso) { res.statusCode = 500; return res.end('boom'); }
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(FA.daily));   // 固定回 08-07 fixture,道理同 fixture_thsr_tdx.mjs 的註解
    }
    res.statusCode = 404; res.end('{}');
  });
  const PORT = Number(process.env.THSR_V4B_PORT || 43996);
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${PORT}`;
  // ASSETS 替身形狀比照 verify_bounty_api.mjs 既有慣例:回同一份真實 dense 檔(thsrStationMap 只打這一支)。
  const ASSETS = { fetch: async () => new Response(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json'), 'utf8'), { status: 200 }) };
  const envBase = { ASSETS, TDX_AUTH_URL_OVERRIDE: `${BASE}/auth/token`, THSR_SCHEDULE_BASE_URL_OVERRIDE: `${BASE}/Rail/THSR/DailyTimetable/TrainDate` };

  const todayIso = taipeiTodayIso();
  const tomorrowIso = addDaysIso(todayIso, 1);
  const todayKey = todayIso.replace(/-/g, '');
  const tomorrowKey = tomorrowIso.replace(/-/g, '');

  try {
    // ── 情境 A:明天失敗、今天成功 → 今天更新、明天完整保留舊值、write=true ──
    {
      const oldTomorrowDoc = { system: '高鐵時刻表', date: tomorrowKey, trains: [{ train: 'OLD-KEEP' }], _marker: 'pre-existing' };
      const oldTodayDoc = { system: '高鐵時刻表', date: todayKey, trains: [{ train: 'OLD-TODAY' }] };
      const seedBlob = JSON.stringify({ fetchedAt: '2000-01-01T00:00:00Z', days: { [todayKey]: oldTodayDoc, [tomorrowKey]: oldTomorrowDoc }, _meta: {} });
      const seedSql = `INSERT INTO kv_blobs (k,v,updated) VALUES ('thsr_sched', '${seedBlob.replace(/'/g, "''")}', datetime('now'));`;
      const { DELAY_DB } = openTestDb(seedSql);
      failDate = tomorrowIso;
      const rt = await ingestThsrSchedule({ ...envBase, DELAY_DB });
      ok('V4b 情境A(明天失敗):results 標記正確(今天ok=true/明天ok=false)',
        !!(rt.results[todayIso] && rt.results[todayIso].ok === true && rt.results[tomorrowIso] && rt.results[tomorrowIso].ok === false),
        JSON.stringify(rt.results));
      ok('V4b 情境A:write=true(至少一天成功就寫)', rt.written === true, JSON.stringify(rt));
      const row = await DELAY_DB.prepare('SELECT v FROM kv_blobs WHERE k=?').bind('thsr_sched').first();
      const blob = JSON.parse(row.v);
      ok(`V4b 情境A:今天已更新為新值(${FA.daily.length} 班,非舊的 OLD-TODAY)`,
        !!(blob.days[todayKey] && blob.days[todayKey].trains.length === FA.daily.length && blob.days[todayKey].trains[0].train !== 'OLD-TODAY'),
        `today trains=${blob.days[todayKey] && blob.days[todayKey].trains.length}`);
      ok('V4b 情境A:明天完整保留舊值(逐位元組相同,未被覆寫也未被刪除)',
        JSON.stringify(blob.days[tomorrowKey]) === JSON.stringify(oldTomorrowDoc), JSON.stringify(blob.days[tomorrowKey]));
    }

    // ── 情境 B:兩天都失敗 → 完全不覆寫既有 blob(該列逐位元組不變) ──
    {
      const preBlob = JSON.stringify({ fetchedAt: '2000-01-01T00:00:00Z', days: { [todayKey]: { system: '高鐵時刻表', date: todayKey, trains: [{ train: 'UNTOUCHED' }] } }, _meta: {} });
      const seedSql = `INSERT INTO kv_blobs (k,v,updated) VALUES ('thsr_sched', '${preBlob.replace(/'/g, "''")}', datetime('now'));`;
      const { DELAY_DB } = openTestDb(seedSql);
      failDate = 'BOTH';
      const rt = await ingestThsrSchedule({ ...envBase, DELAY_DB });
      ok('V4b 情境B(兩天都失敗):results 皆 ok=false',
        !!(rt.results[todayIso] && rt.results[todayIso].ok === false && rt.results[tomorrowIso] && rt.results[tomorrowIso].ok === false),
        JSON.stringify(rt.results));
      ok('V4b 情境B:write=false(函式自報未寫)', rt.written === false, JSON.stringify(rt));
      const row = await DELAY_DB.prepare('SELECT v FROM kv_blobs WHERE k=?').bind('thsr_sched').first();
      ok('V4b 情境B:D1 該列逐位元組完全不變(未被 INSERT OR REPLACE 碰過)', row.v === preBlob, `pre=${preBlob.length}bytes got=${row.v.length}bytes`);
    }

    // ── 情境 C:修剪——(3 舊 + 抓取窗全數成功)超過 THSR_SCHED_KEEP_DAYS 時,應剪到剩最新那幾個 ──
    // 判準用 _thsr 導出的兩個常數推導,不寫死數字:窗天數/保留天數是會調的旋鈕(2026-08-17 從
    // 2/3 調成 7/8),寫死＝下次一調就假紅,而假紅會掩蓋真正的修剪缺陷。
    {
      // _meta 也要種好每個舊日鍵的條目(形狀比照真實 cron 寫入,見 worker.js:3546)——不種的話,
      // 修剪後「20200103 沒有 meta 條目」會是我測試種子不完整造成的假象,不是實作的真實不變量
      // (ingestThsrSchedule 只在「這輪真的抓到那天」時才寫 metas[dayKey],從不回填舊條目)。
      const oldKeys = ['20200101', '20200102', '20200103'];
      const oldDays = Object.fromEntries(oldKeys.map(k => [k, { system: '高鐵時刻表', date: k, trains: [{ train: 'OLD-' + k }] }]));
      const oldMetas = Object.fromEntries(oldKeys.map(k => [k, { total: 1, converted: 1, skipped: [] }]));
      const seedBlob = JSON.stringify({ fetchedAt: '2000-01-01T00:00:00Z', days: oldDays, _meta: oldMetas });
      const seedSql = `INSERT INTO kv_blobs (k,v,updated) VALUES ('thsr_sched', '${seedBlob.replace(/'/g, "''")}', datetime('now'));`;
      const { DELAY_DB } = openTestDb(seedSql);
      failDate = null;   // 抓取窗全數成功 → (3 舊 + 窗天數)個日鍵,超過保留上限
      const rt = await ingestThsrSchedule({ ...envBase, DELAY_DB });
      const row = await DELAY_DB.prepare('SELECT v FROM kv_blobs WHERE k=?').bind('thsr_sched').first();
      const blob = JSON.parse(row.v);
      const keys = Object.keys(blob.days).sort();
      // 期望＝把「3 個舊的 + 抓取窗那幾天」丟進同一個排序,取最後 KEEP 個(獨立重算,不看實作怎麼剪)
      const windowKeys = Array.from({ length: KEEP_WINDOW }, (_, i) => addDaysIso(taipeiTodayIso(), i).replace(/-/g, ''));
      const wantKeys = [...oldKeys, ...windowKeys].sort().slice(-KEEP_MAX);
      ok(`V4b 情境C:修剪到恰好 ${KEEP_MAX} 個日鍵(THSR_SCHED_KEEP_DAYS)`, keys.length === KEEP_MAX, JSON.stringify(keys));
      ok(`V4b 情境C:留下的是最新 ${KEEP_MAX} 個(較舊的被剪掉)`,
        JSON.stringify(keys) === JSON.stringify(wantKeys), `got=${JSON.stringify(keys)} want=${JSON.stringify(wantKeys)}`);
      ok('V4b 情境C:_meta 同步修剪(不殘留已刪日鍵的統計)', Object.keys(blob._meta || {}).sort().join(',') === keys.join(','), JSON.stringify(blob._meta));
    }

    // 正向對照:上面「逐位元組相同/不同」的比對邏輯本身有牙,不是恆真
    ok('V4b 正向對照(JSON.stringify 比對邏輯會抓到不同值)',
      JSON.stringify({ trains: [{ train: 'DIFFERENT' }] }) !== JSON.stringify({ trains: [{ train: 'OLD-KEEP' }] }));
  } finally {
    server.close();
  }
}
try {
  await runIngestFailureSemantics();
} catch (e) {
  ok('V4b 執行區塊', false, `未捕捉例外:${(e && e.stack) || e}`);
}

// ══════════ V7/V8: 抓取窗天數 + 自我檢查(2026-08-17 事故的兩道修法)══════════
// 事故形狀:每日 cron(一天只有一發)在 8/16 拋例外沒寫入,而抓取窗只有「今天＋明天」⇒ 緩衝一天,
// 8/17 整份退回 8/16 的週日班表(16 班平日車次消失、41 班週日車次變幽靈)。兩道修法各驗一組:
//   V7 抓取窗＝今天起 THSR_SCHED_FETCH_DAYS 天(判準看 server 實際收到哪些日期,不看回傳值自述)
//   V8 自我檢查:有今天→零上游呼叫;缺今天→補抓且今天真的補上;不到週期/太早→連 D1 都不碰
async function runWindowAndSelfHeal() {
  const hits = [];             // server 記帳:實際被要求了哪些日期(判準的獨立來源)
  let failAll = false;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/auth/token') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ access_token: 'v7-token', expires_in: 86400 }));
    }
    const m = url.pathname.match(/^\/Rail\/THSR\/DailyTimetable\/TrainDate\/(.+)$/);
    if (m) {
      const dateIso = decodeURIComponent(m[1]);
      hits.push(dateIso);
      if (failAll) { res.statusCode = 500; return res.end('boom'); }
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(FA.daily));
    }
    res.statusCode = 404; res.end('{}');
  });
  const PORT = Number(process.env.THSR_V7_PORT || 43997);
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${PORT}`;
  const ASSETS = { fetch: async () => new Response(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json'), 'utf8'), { status: 200 }) };
  const envBase = { ASSETS, TDX_AUTH_URL_OVERRIDE: `${BASE}/auth/token`, THSR_SCHEDULE_BASE_URL_OVERRIDE: `${BASE}/Rail/THSR/DailyTimetable/TrainDate` };

  const todayIso = taipeiTodayIso();
  const todayKey = todayIso.replace(/-/g, '');
  const windowIso = Array.from({ length: KEEP_WINDOW }, (_, i) => addDaysIso(todayIso, i));
  // 造「台北 h:m」對應的 scheduledTime(cron event 給的是 epoch ms)。閘門看的是這個值,
  // 不是真實時鐘——否則這幾條測試只有在某些時段跑才會過。
  const twNow = new Date(Date.now() + 8 * 3600 * 1000);
  const schedAt = (h, m) => Date.UTC(twNow.getUTCFullYear(), twNow.getUTCMonth(), twNow.getUTCDate(), h, m) - 8 * 3600 * 1000;
  // 只要一被碰就拋:用來證明「早退分支真的沒碰 D1」,而不是碰了但剛好沒事。
  const forbiddenDb = { prepare() { throw new Error('不該碰 D1'); } };

  try {
    // ── V7 契約條:這兩個數字本身就是修法的內容,刻意寫死 ──
    // 其他判準都從 _thsr 導出的常數推導(旋鈕一調不會假紅),代價是它們對「常數本身被改小」
    // 完全免疫——2026-08-17 的突變測試實證:把窗改回 2 天,V7a 照樣全綠。要有這一條才擋得住。
    // 7 天＝撐得過一次上游故障再加一個週末;KEEP≥FETCH＝抓回來的不會當場被修剪掉。
    ok('V7 契約:抓取窗 ≥7 天,且保留上限不小於窗',
      KEEP_WINDOW >= 7 && KEEP_MAX >= KEEP_WINDOW, `FETCH_DAYS=${KEEP_WINDOW} KEEP_DAYS=${KEEP_MAX}`);
    ok('V8 契約:自我檢查間隔 ≤15 分,且台北 06:00(高鐵首班)之前就會檢查',
      _thsr.THSR_HEAL_EVERY_MIN <= 15 && _thsr.THSR_HEAL_FROM_HOUR <= 6,
      `EVERY_MIN=${_thsr.THSR_HEAL_EVERY_MIN} FROM_HOUR=${_thsr.THSR_HEAL_FROM_HOUR}`);

    // ── V7a:一發抓的是今天起連續 KEEP_WINDOW 天 ──
    {
      hits.length = 0; failAll = false;
      const { DELAY_DB } = openTestDb();
      const rt = await ingestThsrSchedule({ ...envBase, DELAY_DB });
      ok(`V7a 上游實際被要求的日期＝今天起連續 ${KEEP_WINDOW} 天`,
        JSON.stringify(hits) === JSON.stringify(windowIso), `got=${JSON.stringify(hits)} want=${JSON.stringify(windowIso)}`);
      const row = await DELAY_DB.prepare('SELECT v FROM kv_blobs WHERE k=?').bind('thsr_sched').first();
      const keys = Object.keys(JSON.parse(row.v).days).sort();
      ok(`V7a 寫進 blob 的日鍵＝那 ${KEEP_WINDOW} 天`,
        JSON.stringify(keys) === JSON.stringify(windowIso.map(d => d.replace(/-/g, ''))), JSON.stringify(keys));
      ok('V7a 今天一定在裡面(事故當天缺的就是這一鍵)', keys.includes(todayKey) && rt.written === true, `written=${rt.written}`);
    }

    // ── V7b:blob 超過自我設限時,從最舊的日鍵開始丟,今天必須留下 ──
    // 沒有這道保護,班表一長到寫不進 D1(硬上限 2,000,000 bytes)就會 INSERT 整筆失敗 ⇒ 靜默停更,
    // 正是這次事故的形狀。
    // 🔴 種子只放【一個】超大舊日鍵,不是很多個小的:1 舊 + 7 天窗 = 8 = KEEP_DAYS,日鍵數修剪
    // 這條路徑碰不到它 ⇒ 剪掉它的只可能是大小保護。第一版寫成 5 個 300KB,結果 KEEP_DAYS 先把
    // 它們剪光、總量從來沒超過上限,判準卻仍全綠——突變測試(把上限放到 99MB)一驗就露餡。
    {
      hits.length = 0; failAll = false;
      const oldKey = '20200101';
      const seedBlob = JSON.stringify({
        fetchedAt: '2000-01-01T00:00:00Z',
        days: { [oldKey]: { system: '高鐵時刻表', date: oldKey, trains: [], pad: 'x'.repeat(1_200_000) } },
        _meta: {},
      });
      const { DELAY_DB } = openTestDb();
      await DELAY_DB.prepare('INSERT INTO kv_blobs (k,v,updated) VALUES (?,?,?)').bind('thsr_sched', seedBlob, '2000-01-01').run();
      await ingestThsrSchedule({ ...envBase, DELAY_DB });
      const row = await DELAY_DB.prepare('SELECT v FROM kv_blobs WHERE k=?').bind('thsr_sched').first();
      const keys = Object.keys(JSON.parse(row.v).days).sort();
      // 判準用 D1 的硬上限(外部事實,與實作的自我設限無關),不用 THSR_BLOB_MAX_BYTES ——
      // 拿實作自己的常數當判準,常數被改大時判準會跟著放寬,等於沒驗。
      ok('V7b 寫進去的量沒有超過 D1 單列硬上限(2,000,000 bytes)', row.v.length < 2_000_000, `bytes=${row.v.length}`);
      ok(`V7b 剪掉的是那個超大舊日鍵(剩 ${KEEP_WINDOW} 個 < KEEP_DAYS=${KEEP_MAX} ⇒ 確實是大小保護動的手,不是日鍵數修剪)`,
        !keys.includes(oldKey) && keys.length === KEEP_WINDOW && keys.length < KEEP_MAX, JSON.stringify(keys));
      ok('V7b 今天與整個抓取窗都留著', windowIso.every(d => keys.includes(d.replace(/-/g, ''))), JSON.stringify(keys));
      ok('V7b 正向對照(種子＋抓取窗確實超過上限,不然這組是空跑)',
        seedBlob.length + FA.daily.length * 1500 * KEEP_WINDOW > 2_000_000, `seed=${seedBlob.length} bytes`);
    }

    // ── V8a:blob 已有今天 → 不補抓、零上游呼叫 ──
    {
      hits.length = 0; failAll = false;
      const seed = JSON.stringify({ fetchedAt: '2000-01-01T00:00:00Z', days: { [todayKey]: { system: '高鐵時刻表', date: todayKey, trains: [{ train: 'ALREADY' }] } }, _meta: {} });
      const { DELAY_DB } = openTestDb();
      await DELAY_DB.prepare('INSERT INTO kv_blobs (k,v,updated) VALUES (?,?,?)').bind('thsr_sched', seed, '2000-01-01').run();
      const r = await thsrSelfHeal({ scheduledTime: schedAt(9, 5) }, { ...envBase, DELAY_DB });
      ok('V8a 有今天→回報 present,不補抓', r.present === true && !r.healed, JSON.stringify(r));
      ok('V8a 有今天→零上游呼叫', hits.length === 0, `hits=${JSON.stringify(hits)}`);
      const row = await DELAY_DB.prepare('SELECT v FROM kv_blobs WHERE k=?').bind('thsr_sched').first();
      ok('V8a 有今天→D1 那列逐位元組不變', row.v === seed, `${row.v.length} vs ${seed.length}`);
    }

    // ── V8b:blob 只有昨天(＝8/17 早上的實況)→ 補抓,今天真的補上 ──
    {
      hits.length = 0; failAll = false;
      const yKey = addDaysIso(todayIso, -1).replace(/-/g, '');
      const seed = JSON.stringify({ fetchedAt: '2000-01-01T00:00:00Z', days: { [yKey]: { system: '高鐵時刻表', date: yKey, trains: [{ train: 'YESTERDAY' }] } }, _meta: {} });
      const { DELAY_DB } = openTestDb();
      await DELAY_DB.prepare('INSERT INTO kv_blobs (k,v,updated) VALUES (?,?,?)').bind('thsr_sched', seed, '2000-01-01').run();
      const r = await thsrSelfHeal({ scheduledTime: schedAt(9, 5) }, { ...envBase, DELAY_DB });
      ok('V8b 缺今天→自報 healed', r.present === false && r.healed === true, JSON.stringify(r));
      ok('V8b 缺今天→確實去打了上游(對照 V8a 的零呼叫,證明該判準有牙)', hits.length === KEEP_WINDOW, `hits=${hits.length}`);
      const row = await DELAY_DB.prepare('SELECT v FROM kv_blobs WHERE k=?').bind('thsr_sched').first();
      const blob = JSON.parse(row.v);
      ok('V8b 今天的班表真的進去了(車數＝fixture)', !!blob.days[todayKey] && blob.days[todayKey].trains.length === FA.daily.length,
        `trains=${blob.days[todayKey] && blob.days[todayKey].trains.length}`);
      ok('V8b 昨天沒被刪(還在保留窗內)', !!blob.days[yKey], JSON.stringify(Object.keys(blob.days)));
    }

    // ── V8c:缺今天但上游全掛 → 不寫、不炸,下一輪再試(冪等) ──
    {
      hits.length = 0; failAll = true;
      const seed = JSON.stringify({ fetchedAt: '2000-01-01T00:00:00Z', days: { 20200101: { system: '高鐵時刻表', date: '20200101', trains: [] } }, _meta: {} });
      const { DELAY_DB } = openTestDb();
      await DELAY_DB.prepare('INSERT INTO kv_blobs (k,v,updated) VALUES (?,?,?)').bind('thsr_sched', seed, '2000-01-01').run();
      const r = await thsrSelfHeal({ scheduledTime: schedAt(9, 5) }, { ...envBase, DELAY_DB });
      ok('V8c 上游全掛→自報未補上,不拋例外', r.healed === false && r.written === false, JSON.stringify(r));
      const row = await DELAY_DB.prepare('SELECT v FROM kv_blobs WHERE k=?').bind('thsr_sched').first();
      ok('V8c 上游全掛→既有 blob 逐位元組不變', row.v === seed, `${row.v.length} vs ${seed.length}`);
      failAll = false;
    }

    // ── V8d:節奏與時段閘門——不到週期/太早,連 D1 都不碰(forbiddenDb 一被碰就拋) ──
    {
      hits.length = 0;
      const offCadence = await thsrSelfHeal({ scheduledTime: schedAt(9, 7) }, { ...envBase, DELAY_DB: forbiddenDb });
      ok(`V8d 分鐘不是 ${_thsr.THSR_HEAL_EVERY_MIN} 的倍數→早退且不碰 D1`, offCadence.skipped === 'cadence', JSON.stringify(offCadence));
      const offHours = await thsrSelfHeal({ scheduledTime: schedAt(_thsr.THSR_HEAL_FROM_HOUR - 1, 0) }, { ...envBase, DELAY_DB: forbiddenDb });
      ok(`V8d 台北 ${_thsr.THSR_HEAL_FROM_HOUR - 1} 點(早於 ${_thsr.THSR_HEAL_FROM_HOUR} 點)→早退且不碰 D1`, offHours.skipped === 'off-hours', JSON.stringify(offHours));
      ok('V8d 兩個早退分支都零上游呼叫', hits.length === 0, `hits=${JSON.stringify(hits)}`);
      // 正向對照:forbiddenDb 真的會拋(否則上面兩條「不碰 D1」是恆真的空話)
      let threw = false;
      try { await thsrSelfHeal({ scheduledTime: schedAt(9, 5) }, { ...envBase, DELAY_DB: forbiddenDb }); } catch (e) { threw = /不該碰 D1/.test(String(e && e.message)); }
      ok('V8d 正向對照(到週期時 forbiddenDb 確實會被碰到並拋錯)', threw);
    }
    // ── V9:布線——自我檢查真的掛在每分鐘 cron 分支上,而且在 handler return 前被 await ──
    // 這條是【靜態檢查】,誠實標明:要真跑那條分支就得執行 trtcLedgerScheduled(會打北捷上游)
    // 與兩條推播迴圈,不是驗收腳本該有的副作用。函式本身的行為由 V8 四組真跑覆蓋,這裡只補
    // 「它有沒有被接上去」——V8 全綠但忘了接線的話,線上依然一點自癒都不會發生。
    {
      const src = readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
      const from = src.indexOf("event.cron === '* * * * *'");
      const to = src.indexOf('return ledger;', from);
      const minuteBranch = from >= 0 && to > from ? src.slice(from, to) : '';
      ok('V9 布線:thsrSelfHeal 掛在每分鐘 cron 分支內', /thsrSelfHeal\(event, env\)/.test(minuteBranch), `branch=${minuteBranch.length} bytes`);
      ok('V9 布線:自帶 .catch(不會改變 scheduled 的成功/失敗契約)', /thsrSelfHeal\(event, env\)\.catch\(/.test(minuteBranch));
      ok('V9 布線:return 前有 await(帳本在營運窗外早退時 waitUntil 可能被截斷)', /await thsrHealTask;/.test(minuteBranch));
    }
  } finally {
    server.close();
  }
}
try {
  await runWindowAndSelfHeal();
} catch (e) {
  ok('V7/V8 執行區塊', false, `未捕捉例外:${(e && e.stack) || e}`);
}

// ══════════════════════════ V5: 前端 API/退路雙路徑(Playwright chromium+webkit) ══════════════════════════
async function runV5() {
  const { doc: apiDoc } = thsrConvertDaily(FA.daily, FA.label, stationMap);
  const PORT = Number(process.env.THSR_V5_PORT || 43995);
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/thsr-schedule') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(apiDoc));
    }
    if (url.pathname.startsWith('/api/')) { res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end('{}'); }
    let fp = path.join(ROOT, decodeURIComponent(url.pathname));
    if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
    if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
    res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
    res.end(readFileSync(fp));
  });
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${PORT}/`;

  const errorsFor = page => { const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); }); return errs; };
  const waitReady = page => page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 30000 });
  const readThsr = page => page.evaluate(() => {
    const s = (typeof state !== 'undefined' ? state.systems : []).find(x => x.id === 'thsr_sched');
    let note = '';
    if (s) { try { loadSystem(s); note = document.getElementById('note').textContent; } catch (e) { note = 'loadSystem 例外:' + e; } }
    return {
      found: !!s, date: s && s.data && s.data.date, trainCount: s && s.data && s.data.trains && s.data.trains.length,
      servedDate: s && s.data && s.data.served_date, note,
      hasHsrTrains: typeof state !== 'undefined' && typeof isHSR === 'function' && Array.isArray(state.trains) && state.trains.some(isHSR),
    };
  });

  for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch();
    try {
      // (a) API 正常
      {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
        const page = await ctx.newPage();
        const errs = errorsFor(page);
        await page.goto(BASE, { waitUntil: 'domcontentloaded' });
        await waitReady(page);
        const r = await readThsr(page);
        ok(`V5-${engineName}(a) API 正常→高鐵資料來源=fixture 日期(${FIX_KEY})`, r.found && r.date === FIX_KEY, JSON.stringify(r));
        ok(`V5-${engineName}(a) 高鐵車畫得出來(state.trains 含 thsr_sched)`, r.hasHsrTrains === true, JSON.stringify(r));
        ok(`V5-${engineName}(a) #note 顯示日期字串`, new RegExp(FIX_KEY).test(r.note), r.note);
        ok(`V5-${engineName}(a) 零 pageerror/console.error`, errs.length === 0, errs.slice(0, 3).join(' | '));
        await ctx.close();
      }
      // (b) API 500 → 退回打包靜態檔
      {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
        const page = await ctx.newPage();
        const errs = errorsFor(page);
        await page.route('**/api/thsr-schedule*', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
        await page.goto(BASE, { waitUntil: 'domcontentloaded' });
        await waitReady(page);
        const r = await readThsr(page);
        ok(`V5-${engineName}(b) API 500→退回靜態檔(日期=現行 dense 檔 ${currentDenseDoc.date})`,
          r.found && r.date === currentDenseDoc.date, JSON.stringify(r));
        ok(`V5-${engineName}(b) 靜態檔車數與現行檔一致(${currentDenseDoc.trains.length})`, r.trainCount === currentDenseDoc.trains.length, `got=${r.trainCount}`);
        ok(`V5-${engineName}(b) 高鐵車仍畫得出來(退路真的接上)`, r.hasHsrTrains === true, JSON.stringify(r));
        ok(`V5-${engineName}(b) 零 pageerror/console.error(除資源載入雜訊)`, errs.length === 0, errs.slice(0, 3).join(' | '));
        await ctx.close();
      }
    } finally { await browser.close(); }
  }
  server.close();
}
try {
  await runV5();
} catch (e) {
  ok('V5 執行區塊', false, `未捕捉例外:${(e && e.stack) || e}`);
}

// ══════════════════════════ 收尾 ══════════════════════════
const failed = results.filter(r => !r.pass);
console.log(`\n${'═'.repeat(48)}\n總計 ${results.length} 項,PASS ${results.length - failed.length},FAIL ${failed.length}`);
if (failed.length) { console.log('FAILED:', failed.map(f => f.name).join(' ; ')); process.exit(1); }
console.log('全部 PASS');
process.exit(0);
