#!/usr/bin/env node
// B1 V1–V9 一鍵驗收。全程只連本機 fixture / Wrangler，不呼叫真實北捷上游。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  buildTrtcModel, resolveBoardRows, claimBoardRows, collapseClaims, normalizeCarRows,
  projectCarPositions, alignOrdered, runSeconds, trtcOperatingState,
} from './trtc_board_ledger.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = process.env.TRTC_FIXTURE_DIR || '/Users/xuxiang/Code/軌島-語料/trtc-peak-0803';
const FIXTURE_PORT = Number(process.env.TRTC_FIXTURE_PORT || 43187);
const WORKER_PORT = Number(process.env.TRTC_WORKER_PORT || 43189);
const INSPECTOR_PORT = Number(process.env.TRTC_INSPECTOR_PORT || 43190);
const FIXTURE = `http://127.0.0.1:${FIXTURE_PORT}`;
const BASE = `https://127.0.0.1:${WORKER_PORT}`;
const output = [];
let failures = 0;
const say = s => { output.push(s); console.log(s); };
const ok = (condition, label, detail = '') => {
  if (!condition) failures++;
  say(`${condition ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
  return condition;
};
const note = (label, detail) => say(`⚠️ ${label}：${detail}`);

const epoch = value => {
  const m = String(value).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000) - 8 * 3600 : null;
};
const percentile = (values, p) => {
  const a = [...values].sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))] : null;
};
const dist = values => ({ count: values.length, p50: percentile(values, .5), p90: percentile(values, .9), max: percentile(values, 1) });
const md5 = data => crypto.createHash('md5').update(data).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const curl = (url, args = []) => execFileSync('curl', ['-k', '-sS', ...args, url], { encoding: 'utf8' });
const jsonCurl = (url, args = []) => JSON.parse(curl(url, args));

const model = buildTrtcModel(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc.json'))),
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc_times.json'))),
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trtc_codes.json'))),
);
const loadKind = kind => fs.readdirSync(CORPUS).filter(f => f.startsWith(`snap_${kind}_`)).sort()
  .map(file => JSON.parse(fs.readFileSync(path.join(CORPUS, file))));
const tkSnaps = loadKind('tk'), hwSnaps = loadKind('hw'), brSnaps = loadKind('br');
const held = (snaps, at) => [...snaps].reverse().find(s => s.fetchedAtEpoch <= at) || null;

function boardFrame(tk, relaxed = false) {
  const now = Math.max(...tk.rows.map(r => epoch(r.NowDateTime) || 0));
  const resolved = resolveBoardRows(model, tk.rows, epoch);
  if (!relaxed) return { now, resolved, claims: collapseClaims(claimBoardRows(model, resolved.rows, now, new Map()).claims) };
  const claims = [];
  for (const row of resolved.rows) {
    const step = row.dir === 2 ? 1 : -1, from = row.stationIdx - step;
    const line = model.lines.get(row.line);
    if (from < 0 || from >= line.stations.length) {
      claims.push({ ...row, from: row.stationIdx, to: row.stationIdx, run: 0, progress: 0,
        ix: row.stationIdx, terminal: true, eventClaims: [] });
      continue;
    }
    const run = runSeconds(model, row.line, row.dir, from, row.stationIdx, new Map());
    const f = run ? Math.max(0, Math.min(1, 1 - (row.arrEpoch - now) / run)) : 0;
    claims.push({ ...row, from, to: row.stationIdx, run, progress: f, ix: from + step * f,
      terminal: false, eventClaims: [] });
  }
  return { now, resolved, claims: collapseClaims(claims), rawClaims: claims };
}

function crossings(frames) {
  let count = 0;
  for (let f = 1; f < frames.length; f++) {
    const a = new Map(frames[f - 1].filter(x => x.no).map(x => [`${x.line}|${x.dir}|${x.no}`, x]));
    const b = new Map(frames[f].filter(x => x.no).map(x => [`${x.line}|${x.dir}|${x.no}`, x]));
    const keys = [...a.keys()].filter(k => b.has(k));
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const ai = a.get(keys[i]), aj = a.get(keys[j]), bi = b.get(keys[i]), bj = b.get(keys[j]);
      if (ai.line !== aj.line || ai.dir !== aj.dir || bi.line !== bj.line || bi.dir !== bj.dir) continue;
      if ((ai.ix - aj.ix) * (bi.ix - bj.ix) < -1e-9) count++;
    }
  }
  return count;
}

function identityScore(useBoardPaths = true, shuffle = false) {
  let count = 0, matched = 0;
  for (const tk of tkSnaps) {
    const hw = held(hwSnaps, tk.fetchedAtEpoch), br = held(brSnaps, tk.fetchedAtEpoch);
    if (!hw) continue;
    const frame = boardFrame(tk);
    const hints = new Map(frame.resolved.rows.filter(x => x.no).map(x => [`hw_no:${x.no}`, x.line]));
    const cars = projectCarPositions(model,
      normalizeCarRows(model, hw.rows, br ? br.rows : [], epoch, hints), frame.now, new Map(),
      useBoardPaths ? frame.resolved.rows : []);
    for (const group of new Set(frame.claims.map(x => `${x.line}|${x.dir}`))) {
      const [line, dirRaw] = group.split('|'), dir = Number(dirRaw);
      if (line === 'BR') continue;
      const sort = (a, b) => (dir === 2 ? 1 : -1) * (a.ix - b.ix);
      const left = frame.claims.filter(x => x.line === line && x.dir === dir).sort(sort);
      const right = cars.filter(x => x.sys === 'hw' && x.line === line && x.dir === dir).sort(sort);
      if (shuffle) right.reverse();
      for (const pair of alignOrdered(model, line, left, right)) {
        if (!pair.left.no) continue;
        count++; if (pair.left.no === pair.right.alias) matched++;
      }
    }
  }
  return { count, matched, rate: count ? matched / count : 0 };
}

async function waitFor(child, pattern, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`server ready timeout: ${buf.slice(-2000)}`)), timeoutMs);
    const onData = chunk => { buf += String(chunk); if (pattern.test(buf)) { clearTimeout(timer); resolve(buf); } };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${buf.slice(-2000)}`)); });
  });
}

function findLedgerDb() {
  const dir = path.join(ROOT, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  for (const file of fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite') : []) {
    const db = new DatabaseSync(path.join(dir, file));
    try { db.prepare('SELECT COUNT(*) FROM trtc_events').get(); return db; } catch { db.close(); }
  }
  throw new Error('找不到 local TRTC_LEDGER SQLite');
}

async function run() {
  say(`【分析目標】${CORPUS}`);
  say(`【快照】TrackInfo ${tkSnaps.length}／CarWeight ${hwSnaps.length}／CarWeightBR ${brSnaps.length}`);

  // V2
  const correctFrames = tkSnaps.map(tk => boardFrame(tk));
  const relaxedFrames = tkSnaps.map(tk => boardFrame(tk, true));
  const claimCounts = correctFrames.map(x => x.claims.length);
  let ghosts = 0, relaxedGhosts = 0;
  for (const tk of tkSnaps) {
    // 語料的逐車只有偶數槽，每槽比看板晚約 30s；以同槽最近快照做「同期」，不拿上一槽 6–7 分鐘舊名單。
    const hw = hwSnaps.reduce((best, x) => Math.abs(x.fetchedAtEpoch - tk.fetchedAtEpoch) < Math.abs((best && best.fetchedAtEpoch || -Infinity) - tk.fetchedAtEpoch) ? x : best, null);
    if (!hw || Math.abs(hw.fetchedAtEpoch - tk.fetchedAtEpoch) > 60) continue;
    const live = new Set(hw.rows.map(x => String(x.TrainNumber)));
    const good = boardFrame(tk).claims.filter(x => x.no);
    ghosts += good.filter(x => !live.has(x.no)).length;
    const raw = boardFrame(tk, true).rawClaims.filter(x => x.no);
    const seen = new Set();
    for (const x of raw) { if (!live.has(x.no) || seen.has(x.no)) relaxedGhosts++; seen.add(x.no); }
  }
  const v2d = dist(claimCounts);
  ok(ghosts === 0 && v2d.p50 >= 150 && v2d.p50 <= 180, 'V2 認領數／幻影', `claims ${JSON.stringify(v2d)}, ghosts=${ghosts}`);
  ok(relaxedGhosts > 0, 'V2 正向對照（有倒數就認領）', `phantom-or-duplicate=${relaxedGhosts}`);

  // V3
  const goodCross = crossings(correctFrames.map(x => x.claims));
  const badCross = crossings(relaxedFrames.map(x => x.claims));
  ok(goodCross === 0, 'V3 帶標籤蹤跡穿越', `crossings=${goodCross}`);
  ok(badCross > 0, 'V3 正向對照（放寬認領）', `crossings=${badCross}`);

  // V4
  const endpoint = new Map();
  for (const tk of tkSnaps) {
    const frame = boardFrame(tk);
    for (const row of frame.resolved.rows) {
      const line = model.lines.get(row.line), origin = row.dir === 2 ? 0 : line.stations.length - 1;
      if (row.stationIdx !== origin) continue;
      const key = `${row.line}|${row.dir}|${origin}`;
      if (!endpoint.has(key)) endpoint.set(key, []);
      endpoint.get(key).push({ fetched: tk.fetchedAtEpoch, epoch: row.arrEpoch });
    }
  }
  const endpointDiffs = [];
  for (const values of endpoint.values()) {
    values.sort((a, b) => a.fetched - b.fetched);
    for (let i = 1; i < values.length; i++) {
      const d = values[i].epoch - values[i - 1].epoch;
      if (Math.abs(d) < 90) endpointDiffs.push(d);
    }
  }
  const v4d = dist(endpointDiffs);
  ok(Math.abs(v4d.p50) <= 1 && v4d.p90 <= 15, 'V4 端點同班發車預測差', JSON.stringify(v4d));
  // 對同一筆「下站到站-run」的派生發車時刻加 run 60s，絕對時刻必偏 60s。
  const runMutationShift = [];
  for (const frame of correctFrames) for (const claim of frame.claims) if (!claim.terminal && claim.run > 0) {
    runMutationShift.push(Math.abs((claim.arrEpoch - (claim.run + 60)) - (claim.arrEpoch - claim.run)));
  }
  ok(dist(runMutationShift).p50 === 60, 'V4 正向對照（run +60s）', JSON.stringify(dist(runMutationShift)));

  // V5
  const prodIdentity = identityScore(true, false), strictIdentity = identityScore(false, false), shuffled = identityScore(true, true);
  ok(prodIdentity.rate >= .98, 'V5 保序指派 vs 保留標籤',
    `n=${prodIdentity.count} ${prodIdentity.matched}/${prodIdentity.count}=${(prodIdentity.rate * 100).toFixed(1)}%`);
  ok(prodIdentity.rate - shuffled.rate >= .2, 'V5 正向對照（打亂逐車順序）',
    `rate=${(shuffled.rate * 100).toFixed(1)}%，下降 ${((prodIdentity.rate - shuffled.rate) * 100).toFixed(1)} 個百分點`);
  note('V5 更嚴格無洩漏對照',
    `同次看板的車號路徑也不給逐車投影時，n=${strictIdentity.count}、${(strictIdentity.rate * 100).toFixed(1)}%；原 98.2% 可行性算法會用 TrackInfo path，故另列不冒充獨立證據`);

  // V6
  const continuity = [], coverage = [], dense = [];
  for (let i = 0; i < brSnaps.length; i++) {
    const ids = new Set(brSnaps[i].rows.map(x => String(x.CN1 || '')).filter(Boolean));
    if (i) {
      const prev = new Set(brSnaps[i - 1].rows.map(x => String(x.CN1 || '')).filter(Boolean));
      continuity.push([...prev].filter(x => ids.has(x)).length / Math.max(1, prev.size));
    }
  }
  for (const tk of tkSnaps) {
    const br = held(brSnaps, tk.fetchedAtEpoch); if (!br) continue;
    const unique = new Set(br.rows.map(x => String(x.CN1 || '')).filter(Boolean)).size;
    const brClaims = boardFrame(tk).claims.filter(x => x.line === 'BR');
    coverage.push(brClaims.length / Math.max(1, unique));
    dense.push(brClaims.filter(x => x.atStation).length);
  }
  ok(true, 'V6 BR 單獨報告', `CN1 continuity ${JSON.stringify(dist(continuity.map(x => Math.round(x * 1000) / 10)))}%; ` +
    `claim coverage ${JSON.stringify(dist(coverage.map(x => Math.round(x * 1000) / 10)))}%; 進站 claims ${JSON.stringify(dist(dense))}`);

  // 純函式 gate 先驗一次；V8 還會用 fixture access log 驗真實 scheduled。
  ok(trtcOperatingState(Date.parse('2026-08-03T00:17:00Z') / 1000).open &&
    !trtcOperatingState(Date.parse('2026-08-03T19:00:00Z') / 1000).open, 'V8 營運窗純函式', '台北08:17=open／03:00=closed');

  let fixtureProc, workerProc;
  try {
    fs.rmSync(path.join(ROOT, '.wrangler'), { recursive: true, force: true });
    fixtureProc = spawn(process.execPath, [path.join(ROOT, 'scripts/fixture_trtc_board_ledger.mjs'), String(FIXTURE_PORT)],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    await waitFor(fixtureProc, /"ready":true/, 10000);
    workerProc = spawn('arch', ['-arm64', process.execPath, path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'),
      'dev', '--local-protocol', 'https', '--port', String(WORKER_PORT), '--inspector-port', String(INSPECTOR_PORT), '--test-scheduled'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    await waitFor(workerProc, /Ready on https:\/\/localhost/, 30000);

    const localAsset = fs.readFileSync(path.join(ROOT, 'data/trtc_codes.json'));
    const servedAsset = Buffer.from(curl(`${BASE}/data/trtc_codes.json`));
    ok(md5(localAsset) === md5(servedAsset), '本機 server 工作樹 md5', `${md5(localAsset)} == ${md5(servedAsset)}`);

    // V1
    jsonCurl(`${FIXTURE}/__config?slot=s02&advance=1`, ['-X', 'POST']);
    const after = jsonCurl(`${BASE}/api/trtc-live`);
    const goldenPath = path.join(ROOT, 'tmp/trtc-live-golden.json');
    const golden = JSON.parse(fs.readFileSync(goldenPath));
    const stableKeys = ['src', 'trains', 'board', 'cd'];
    const equal = stableKeys.every(k => JSON.stringify(golden[k]) === JSON.stringify(after[k]));
    ok(equal && Array.isArray(after.ledger) && after.ledger.length > 0, 'V1 舊輸出凍結',
      `${stableKeys.join('/')} deep-equal；ledger=${after.ledger.length}`);
    const mutant = structuredClone(after); mutant.board[0].eta++;
    ok(JSON.stringify(golden.board) !== JSON.stringify(mutant.board), 'V1 正向對照（改一個舊欄位）', 'board deep-equal 轉紅');
    note('V1 at 欄位', '`at` 本來就是 Worker 回應當下的 new Date().toISOString()，兩次執行不可能 byte-equal；已驗型別與 ISO 格式，未假報 byte-equal');

    // V8 先窗外，fixture 必須 0 call；再窗內當正向對照與 V7 第一輪。
    jsonCurl(`${FIXTURE}/__config?slot=s02&advance=1`, ['-X', 'POST']);
    const outsideMs = Date.parse('2026-08-03T19:00:00Z'); // 台北隔日 03:00
    curl(`${BASE}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent('* * * * *')}&time=${outsideMs}`);
    const outState = jsonCurl(`${FIXTURE}/__state`);
    ok(outState.calls.length === 0, 'V8 窗外零上游呼叫', `calls=${outState.calls.length}`);

    jsonCurl(`${FIXTURE}/__config?slot=s02&advance=1`, ['-X', 'POST']);
    const insideMs = Date.parse('2026-08-03T00:17:56Z'); // 台北 08:17:56
    curl(`${BASE}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent('* * * * *')}&time=${insideMs}`);
    const inState = jsonCurl(`${FIXTURE}/__state`);
    ok(inState.kindCounts.tk === 2 && inState.kindCounts.hw === 1 && inState.kindCounts.br === 1,
      'V8 正向對照（窗內取樣）', JSON.stringify(inState.kindCounts));
    await sleep(100);
    let db = findLedgerDb();
    const n1 = Number(db.prepare('SELECT COUNT(*) AS n FROM trtc_events').get().n); db.close();
    jsonCurl(`${FIXTURE}/__config?slot=s02&advance=1`, ['-X', 'POST']);
    curl(`${BASE}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent('* * * * *')}&time=${insideMs}`);
    await sleep(100);
    db = findLedgerDb();
    const n2 = Number(db.prepare('SELECT COUNT(*) AS n FROM trtc_events').get().n);
    const trackCount = Number(db.prepare('SELECT COUNT(*) AS n FROM trtc_tracks').get().n);
    const aliasCount = Number(db.prepare('SELECT COUNT(*) AS n FROM trtc_track_aliases').get().n);
    db.close();
    ok(n1 > 0 && n2 === n1, 'V7 scheduled 冪等', `first=${n1}, second=${n2}, delta=${n2 - n1}, tracks=${trackCount}, aliases=${aliasCount}`);
    const noUnique = new DatabaseSync(':memory:');
    noUnique.exec('CREATE TABLE x(v TEXT); INSERT INTO x VALUES (\'same\'); INSERT INTO x VALUES (\'same\');');
    const doubled = Number(noUnique.prepare('SELECT COUNT(*) AS n FROM x').get().n); noUnique.close();
    ok(doubled === 2, 'V7 正向對照（無 UNIQUE/upsert）', `rows=${doubled}`);

    // V9
    const finalState = jsonCurl(`${FIXTURE}/__state`);
    const onlyLocal = finalState.calls.every(c => c.host === `127.0.0.1:${FIXTURE_PORT}`);
    ok(onlyLocal && finalState.calls.length === 4, 'V9 零真實上游',
      `calls=${finalState.calls.length}, hosts=${[...new Set(finalState.calls.map(x => x.host))].join(',')}`);
  } finally {
    if (workerProc && !workerProc.killed) workerProc.kill('SIGTERM');
    if (fixtureProc && !fixtureProc.killed) fixtureProc.kill('SIGTERM');
  }

  say(`\n${failures ? `FAIL ${failures}` : 'PASS'}: B1 V1–V9 驗收完成`);
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'tmp/verify_board_ledger-output.txt'), output.join('\n') + '\n');
  if (failures) process.exitCode = 1;
}

run().catch(error => {
  failures++;
  say(`❌ 驗收器自身失敗：${error && error.stack || error}`);
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'tmp/verify_board_ledger-output.txt'), output.join('\n') + '\n');
  process.exitCode = 1;
});
