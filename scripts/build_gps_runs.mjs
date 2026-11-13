#!/usr/bin/env node
/**
 * 台鐵 GPS 站間曲線建置（校正懸賞的乘客錄程 → data/tra_gps_runs.json）
 *
 * 為什麼要這支：前端在兩個真停靠站之間，沒有官方通過站觀測的跑段（多半是區間車相鄰兩站）
 * 只能用梯形加減速推位置。TDX 的逐站觀測只到「每站幾點過站」、而且以整分鐘回報，站與站中間
 * 怎麼起步、在哪減速沒有實測。校正懸賞的錄程每秒一點，正好補這一塊。
 *
 * 做法：
 *   1. 唯讀抓正式 D1 的錄程（台鐵、判定合格、「資料可用」標記 = 1，也就是車次對得上時刻表＋官方誤點）。
 *   2. 用班表認出這班車的真停靠站，在 GPS 裡找「停住的點群」對到停靠站，相鄰兩個停靠站之間就是一段行駛。
 *      中途斷訊、中途停車（號誌）、歷時或距離跟表定差太多的不收。
 *   3. 每段行駛換成「段內時間比例 → 距離比例」，同一個站→站（有方向）＋同一種車（index.html resolvePerf
 *      給的性能參數，切進沙箱呼叫同一個函式）取中位數，寫成千分比折點。
 *   4. 前端 assignRunProfiles 對沒有官方折點的跑段改用這些折點，走同一條 buildObsProfile（限速閘門照樣守），
 *      建不出來照舊退梯形。離線預算（build_run_profiles.mjs）讀同一份檔，所以 App 下載的
 *      tra_run_profiles.json 也帶著這些曲線。
 *
 * 隱私：輸出只有站名、車種性能參數、段數與中位數曲線。乘客 id、乘車日、時刻都不進輸出檔；
 * 本機快取（.cache/，已 gitignore、也不會部署）裡的乘客 id 先雜湊過。
 * 每條曲線至少要有 GATE.minRuns 段、來自至少 GATE.minRiders 位不同乘客，單一乘客的錄程不會單獨成為一條曲線。
 *
 * 用法：node scripts/build_gps_runs.mjs            （抓正式 D1，要 wrangler 已登入）
 *       node scripts/build_gps_runs.mjs --cached   （用上次抓下來的本機快取，不連網）
 * 每次都會印留一段交叉驗證：用其他段的中位數曲線推某一段的中途位置，跟梯形比誤差（同一組 index.html 函式）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSandbox } from './build_run_profiles.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'gps_runs');
const CACHE_FILE = join(CACHE, 'rows.json');
const OUT = join(ROOT, 'data/tra_gps_runs.json');

// 段內時間比例的取樣點（千分比）：5%、10%…95%。端點（0、1000）由前端自己補。
const GRID = Array.from({ length: 19 }, (_, i) => (i + 1) * 50);
// 寫進檔案的折點：GRID 的子集（10%、30%、50%、70%、90%）。每段行駛的取樣與留一段驗證仍用 GRID 的 19 點。
// 為什麼只留 5 點：每個折點都會展開進每班車的離線預算剖面（tra_run_profiles.json）。11/13 重算到 95 條曲線時，
// 19 點全留會讓那個檔長到 3.44 MB，超過已安裝 App 的下載上限（見 build_run_profiles.mjs 的 MAX_BYTES）；
// 5 點是 1.65 MB，留一段驗證的中位誤差 104 → 107 m、p90 544 → 558 m，幾乎沒差。
const KNOTS = [100, 300, 500, 700, 900];
const KI = KNOTS.map(g => GRID.indexOf(g));
const GATE = {
  stopV: 0.6,        // 公尺/秒以下算停住
  stopMinSec: 10,    // 停住要連續這麼久才算一次停車
  stopGapSec: 10,    // 停車點群內相鄰兩點最多隔幾秒
  stationM: 400,     // 停車點群離停靠站多遠以內才算停在那一站（月台長＋GPS 誤差）
  maxGapSec: 15,     // 行駛中相鄰兩點最多隔幾秒；斷訊的段不收（中間形狀不知道）
  midStopSec: 30,    // 行駛中停住超過這麼久（號誌停車）整段不收：那不是這個站間的常態
  tLo: 0.6, tHi: 2.0,          // 實際歷時 ÷ 表定歷時的合理範圍
  lTolRel: 0.15, lTolM: 300,   // 實際距離跟兩站里程差的容許差（取兩者較大）
  minL: 500,         // 太短的站間不收（月台長就吃掉大半）
  minRuns: 4,        // 一條曲線至少幾段
  minRiders: 2,      // 至少幾位不同乘客
};

const norm = s => String(s || '').replace(/台/g, '臺').trim();
const median = a => { const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const pct = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
const hashId = s => createHash('sha256').update(String(s)).digest('hex').slice(0, 12);

// ── 1. 抓資料（唯讀）──────────────────────────────────────────────
function d1(sql) {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error('只准 SELECT');
  const out = execFileSync('arch', ['-arm64', process.execPath, join(ROOT, 'node_modules/wrangler/bin/wrangler.js'),
    'd1', 'execute', 'DELAY_DB', '--remote', '--json', '--command', sql],
  { cwd: ROOT, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  return JSON.parse(out.slice(out.indexOf('['))) [0].results;
}
function fetchRows() {
  const rows = [];
  let last = '';
  for (;;) {
    const r = d1("SELECT id, actor, trip_date, train_no, ln_id, payload FROM bounty_samples" +
      " WHERE sys='tra_sched' AND verdict='ok' AND usable=1 AND id > '" + last.replace(/'/g, "''") + "' ORDER BY id LIMIT 400");
    for (const x of r) rows.push({ rider: hashId(x.actor), day: x.trip_date, train: String(x.train_no), ln: x.ln_id, payload: x.payload });
    process.stderr.write(`\r抓到 ${rows.length} 列`);
    if (r.length < 400) break;
    last = r[r.length - 1].id;
  }
  process.stderr.write('\n');
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(rows));
  return rows;
}

// ── 2. 一趟錄程 → 站到站的行駛 ────────────────────────────────────
function extractRuns(trip, tr, mileOf) {
  const out = [];
  const pts = [];
  for (const r of trip) {
    let p; try { p = JSON.parse(r.payload); } catch { continue; }
    if (!Array.isArray(p)) continue;
    for (const x of p) if (Number.isFinite(x.t) && Number.isFinite(x.d)) pts.push({ t: x.t, d: x.d, v: Number.isFinite(x.v) ? x.v : null, ln: r.ln });
  }
  pts.sort((a, b) => a.t - b.t);
  const P = pts.filter((x, i) => i === 0 || x.t !== pts[i - 1].t);
  if (P.length < 30) return out;
  const stops = tr.stops.map((s, i) => ({ s, i })).filter(x => x.s.stop !== false);
  const stopIdx = new Map(stops.map((x, k) => [norm(x.s.name), k]));
  // 停車點群 → 對到停靠站
  const clusters = [];
  for (let i = 0; i < P.length;) {
    if (!(P[i].v != null && P[i].v < GATE.stopV)) { i++; continue; }
    let j = i;
    while (j + 1 < P.length && P[j + 1].v != null && P[j + 1].v < GATE.stopV && P[j + 1].t - P[j].t <= GATE.stopGapSec && P[j + 1].ln === P[i].ln) j++;
    if (P[j].t - P[i].t >= GATE.stopMinSec) {
      const dMed = median(P.slice(i, j + 1).map(x => x.d)), ln = P[i].ln, M = mileOf(ln);
      let best = null;
      if (M) for (const x of stops) {
        const m = M.get(norm(x.s.name));
        if (m != null && Math.abs(m - dMed) <= GATE.stationM && (!best || Math.abs(m - dMed) < best.off)) best = { name: norm(x.s.name), off: Math.abs(m - dMed) };
      }
      if (best) {
        const prev = clusters[clusters.length - 1];
        if (prev && prev.name === best.name && prev.ln === ln) { prev.j = j; prev.tDep = P[j].t; }   // 同一站被速度抖動切成兩群 → 併回一次停車
        else clusters.push({ name: best.name, ln, i, j, tArr: P[i].t, tDep: P[j].t, d: dMed });
      }
    }
    i = j + 1;
  }
  for (let c = 0; c + 1 < clusters.length; c++) {
    const A = clusters[c], B = clusters[c + 1];
    const ka = stopIdx.get(A.name), kb = stopIdx.get(B.name);
    if (ka == null || kb !== ka + 1 || A.ln !== B.ln) continue;   // 只收班表上相鄰的兩個停靠站
    const sA = stops[ka].s, sB = stops[kb].s;
    const schedT = sB.arrSec - sA.depSec, T = B.tArr - A.tDep;
    if (!(schedT > 0) || T < GATE.tLo * schedT || T > GATE.tHi * schedT) continue;
    const seg = P.slice(A.j, B.i + 1);
    if (seg.some(x => x.ln !== A.ln)) continue;
    let maxGap = 0;
    for (let k = 1; k < seg.length; k++) maxGap = Math.max(maxGap, seg[k].t - seg[k - 1].t);
    if (maxGap > GATE.maxGapSec) continue;
    const M = mileOf(A.ln), Ls = Math.abs(M.get(B.name) - M.get(A.name)), L = Math.abs(B.d - A.d);
    if (L < GATE.minL || Math.abs(L - Ls) > Math.max(GATE.lTolRel * Ls, GATE.lTolM)) continue;
    // 中途號誌停車
    let mid = false;
    for (let k = 1; k < seg.length - 1 && !mid;) {
      if (!(seg[k].v != null && seg[k].v < GATE.stopV)) { k++; continue; }
      let m = k;
      while (m + 1 < seg.length - 1 && seg[m + 1].v != null && seg[m + 1].v < GATE.stopV) m++;
      if (seg[m].t - seg[k].t >= GATE.midStopSec) mid = true;
      k = m + 1;
    }
    if (mid) continue;
    const sgn = B.d > A.d ? 1 : -1;
    const ft = seg.map(x => (x.t - A.tDep) / T), fd = seg.map(x => Math.min(1, Math.max(0, sgn * (x.d - A.d) / L)));
    const f = [];
    let cur = 0;
    for (const g of GRID) {
      const gg = g / 1000;
      let v = fd[fd.length - 1];
      for (let k = 1; k < ft.length; k++) if (ft[k] >= gg) { const w = (gg - ft[k - 1]) / ((ft[k] - ft[k - 1]) || 1); v = fd[k - 1] + w * (fd[k] - fd[k - 1]); break; }
      cur = Math.max(cur, v);                // GPS 抖動造成的倒退一律拉平（列車不會倒著開）
      f.push(cur);
    }
    out.push({ a: A.name, b: B.name, T, L, f });
  }
  return out;
}

// ── 3. 主流程 ─────────────────────────────────────────────────────
function main() {
  const rows = process.argv.includes('--cached') && existsSync(CACHE_FILE)
    ? JSON.parse(readFileSync(CACHE_FILE, 'utf8')) : fetchRows();
  const units = JSON.parse(readFileSync(join(ROOT, 'data/bounty_units.json'), 'utf8'));
  const mileCache = new Map();
  const mileOf = ln => {
    if (mileCache.has(ln)) return mileCache.get(ln);
    const L = units.lines['tra_sched|' + ln];
    const m = L ? new Map(L.stations.map(s => [norm(s.name), s.d * 1000])) : null;
    mileCache.set(ln, m);
    return m;
  };
  const sched = JSON.parse(readFileSync(join(ROOT, 'data/tra_schedule_dense.json'), 'utf8'));
  const trainOf = new Map();
  for (const tr of sched.trains) if (!trainOf.has(String(tr.train))) trainOf.set(String(tr.train), { ...tr, sys: 'tra_sched' });
  const ctx = makeSandbox(join(ROOT, 'index.html'));

  const trips = new Map();
  for (const r of rows) {
    const k = `${r.rider}|${r.day}|${r.train}`;
    (trips.get(k) || trips.set(k, []).get(k)).push(r);
  }
  const groups = new Map();
  let nRuns = 0, noTrain = 0;
  const days = new Set();
  for (const [k, trip] of trips) {
    const [rider, day, train] = k.split('|');
    const tr = trainOf.get(train);
    if (!tr) { noTrain++; continue; }
    const perf = ctx.resolvePerf(tr);
    for (const run of extractRuns(trip, tr, mileOf)) {
      const key = ctx.gpsRunKey(run.a, run.b, perf);
      (groups.get(key) || groups.set(key, { perf, runs: [] }).get(key)).runs.push({ ...run, rider });
      nRuns++; days.add(day);
    }
  }

  // 中位數曲線＋門檻
  const medCurve = runs => KI.map(i => median(runs.map(r => r.f[i])));
  const toPermil = f => {
    const out = [];
    for (let i = 0; i < f.length; i++) {
      let v = Math.round(f[i] * 1000);
      v = Math.max(v, (out[i - 1] ?? 0) + 1);              // 嚴格遞增（buildObsProfile 要求距離比前一個大）
      v = Math.min(v, 999 - (f.length - 1 - i));           // 留空間給後面的點，也不貼死終點
      out.push(v);
    }
    return out;
  };
  const kept = {};
  let keptRuns = 0;
  for (const [key, g] of [...groups].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const riders = new Set(g.runs.map(r => r.rider));
    if (g.runs.length < GATE.minRuns || riders.size < GATE.minRiders) continue;
    kept[key] = { n: g.runs.length, f: toPermil(medCurve(g.runs)) };
    keptRuns += g.runs.length;
  }

  // 留一段交叉驗證：用 index.html 的 buildObsProfile／buildProfile 本身算，已知真實出發與到站時刻，比中途位置誤差（公尺）
  const err = { gps: [], trap: [] };
  let fallback = 0, tested = 0;
  for (const [key, g] of groups) {
    if (!kept[key] || g.runs.length < GATE.minRuns + 1) continue;
    const p = g.perf;
    g.runs.forEach((r, i) => {
      const others = g.runs.filter((_, j) => j !== i);
      if (new Set(others.map(x => x.rider)).size < GATE.minRiders) return;
      const fm = toPermil(medCurve(others));
      const pts = KNOTS.map((gr, k) => ({ t: gr / 1000 * r.T, d: fm[k] / 1000 * r.L }));
      const trap = ctx.buildProfile(r.L / 1000, r.T, p.a, p.b, p.v, p.coast);
      let gps = ctx.buildObsProfile(r.L / 1000, r.T, pts, p.v);
      if (!gps) { fallback++; gps = trap; }
      tested++;
      GRID.forEach((gr, k) => {
        const t = gr / 1000 * r.T, truth = r.f[k] * r.L;
        const at = rp => (rp ? ctx.profTimeToProg(rp, t) : gr / 1000) * r.L;
        err.gps.push(Math.abs(at(gps) - truth));
        err.trap.push(Math.abs(at(trap) - truth));
      });
    });
  }

  const sortedDays = [...days].sort();
  const body = '{\n'
    + ` "source_notes": ${JSON.stringify('台鐵站間行駛曲線：由校正懸賞的乘客錄程（判定合格、車次對得上時刻表與官方誤點的資料）'
      + '以 scripts/build_gps_runs.mjs 煉成。鍵＝起站|到站|加速/減速/極速（index.html gpsRunKey）；'
      + 'f＝段內時間比例 grid（千分比）時的距離比例（千分比），同一鍵多段行駛的中位數。'
      + `每條至少 ${GATE.minRuns} 段、${GATE.minRiders} 位不同乘客；不含乘客身分、乘車日與時刻。`
      + '前端只在該跑段沒有官方通過站觀測時採用，走 buildObsProfile（限速閘門照樣守），建不出來退梯形。')},\n`
    + ` "built_from": ${JSON.stringify({ days: sortedDays.length ? [sortedDays[0], sortedDays[sortedDays.length - 1]] : [], runs: keptRuns })},\n`
    + ` "grid": ${JSON.stringify(KNOTS)},\n`
    + ' "runs": {\n'
    + Object.entries(kept).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')
    + '\n }\n}\n';
  writeFileSync(OUT, body);

  console.log(`錄程 ${rows.length} 列、${trips.size} 趟（班表找不到車次 ${noTrain} 趟）｜抓到站到站行駛 ${nRuns} 段、${groups.size} 個站→站＋車種`);
  console.log(`收錄 ${Object.keys(kept).length} 條曲線（${keptRuns} 段；門檻 ≥${GATE.minRuns} 段、≥${GATE.minRiders} 位乘客）｜乘車日 ${sortedDays[0] || '—'}～${sortedDays[sortedDays.length - 1] || '—'}`);
  if (tested) {
    console.log(`留一段交叉驗證（${tested} 段，已知真實出發與到站時刻，中途位置誤差公尺）：`
      + `梯形 中位 ${pct(err.trap, 0.5).toFixed(0)}／p90 ${pct(err.trap, 0.9).toFixed(0)}｜`
      + `GPS 曲線 中位 ${pct(err.gps, 0.5).toFixed(0)}／p90 ${pct(err.gps, 0.9).toFixed(0)}`
      + (fallback ? `｜buildObsProfile 建不出來退梯形 ${fallback} 段` : ''));
  }
  console.log(`已寫入 ${OUT}`);
}

main();
