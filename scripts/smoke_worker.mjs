#!/usr/bin/env node
// 真 workerd 冒煙測試：自行啟動/輪詢/驗證/關閉 wrangler dev。
//
// 一般驗收：node scripts/smoke_worker.mjs
// 突變驗收：node scripts/smoke_worker.mjs --mutate
//   --mutate 會建立一份同目錄層級的暫時 Worker，故意讓 /api/thsr-freeseat 回空 cars；
//   判準應以 exit 1 變紅。原始 worker.js 從頭到尾不會被修改，暫存檔也會在 finally 移除。
//
// 正式設定的 assets.directory:"." 保持不變。本腳本只對 `wrangler dev` 傳 --assets，
// 把 assets watcher 縮到不會變動的小目錄；--persist-to 與 logs 放在其外側。
//
// 為什麼要這樣做 —— 本機單變因實測（2026-08-10，只抽掉 --assets 一個變因，其餘參數相同）：
//   套 --assets <小目錄>   → 就緒 1.06s，之後 60 秒 reload 0 次
//   不套（用 assets.directory:"."）→ 就緒 28.55s，reload 1 次
// 啟動慢約 27 倍，所以本機驗收一律要縮小 watcher 範圍。
//
// MAX_RELOADS_AFTER_READY = 0 這條斷言的牙已驗過：就緒後故意改動被監看的 assets 檔，
// 計數確實 0 → 1，所以真有重載時抓得到，不是裝飾品。
//
// ⚠️ 未重現、只是推斷：Wrangler 4.111.0 的 assets watcher 不套 .assetsignore
// （wrangler-dist/cli.js:181576 直接 watch(assetsDir) 沒帶 ignore），據此推測它會監到
// 自己寫入的 .wrangler SQLite 檔而自我重載成風暴。證據是 2026-08-09 的一份 wrangler log
// （同一段執行內 49 次 reload）＋原始碼閱讀；但 08-10 在本樹**沒有重現**風暴
// （不套修法時 60 秒只有 1 次 reload、28.55s 仍會起來）。當成「待證假設」看待，別當結論引用。
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'wrangler.jsonc');
const WORKER_PATH = path.join(ROOT, 'worker.js');
const WRANGLER_PATH = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const MUTATE = process.argv.includes('--mutate');

const STARTUP_LIMIT_MS = 60_000;
const STABILITY_WINDOW_MS = 120_000;
const HEARTBEAT_INTERVAL_MS = 2_000;
const MAX_RELOADS_AFTER_READY = 0;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const READY_PATH = '/api/metro-live?sys=__worker_smoke_ready__';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + `-${process.pid}`;
const runDir = path.join(ROOT, 'tmp', 'worker-smoke', runId);
const summaryPath = path.join(runDir, 'summary.log');
mkdirSync(runDir, { recursive: true });

let failures = 0;
const summary = [];
const activeSessions = new Set();
const activeFixtureServers = new Set();
let mutantPath = null;

function line(message = '') {
  console.log(message);
  summary.push(message);
}

function check(ok, message, detail = '') {
  if (!ok) failures++;
  line(`  ${ok ? 'PASS' : 'FAIL'}  ${message}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

function redact(text) {
  return String(text)
    .replace(/("MF-Proxy-Shared-Secret"\s*:\s*")[^"]+("?)/gi, '$1[REDACTED]$2')
    .replace(/(authorization\s*[:=]\s*Bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/((?:TDX_CLIENT_SECRET|TDX_CLIENT_ID)\s*[:=]\s*)[^\s,}]+/gi, '$1[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]{10,})?\b/g, '[REDACTED_JWT]');
}

function countOccurrences(text, needle) {
  let count = 0;
  let at = 0;
  while ((at = text.indexOf(needle, at)) !== -1) {
    count++;
    at += needle.length;
  }
  return count;
}

function taipeiToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function processExited(proc) {
  return proc.exitCode !== null || proc.signalCode !== null;
}

function httpsGet(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      rejectUnauthorized: false,
      headers: { 'cache-control': 'no-cache', accept: 'application/json' },
    }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          req.destroy(new Error(`回應超過 ${MAX_RESPONSE_BYTES} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({
        status: res.statusCode || 0,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
      res.on('aborted', () => reject(new Error('HTTP 回應中途被中止')));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`HTTP timeout ${timeoutMs}ms`)));
    req.on('error', reject);
    req.end();
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function prepareEntrypoint() {
  if (!MUTATE) return WORKER_PATH;
  const source = readFileSync(WORKER_PATH, 'utf8');
  const needle = "else if (url.pathname === '/api/thsr-freeseat') res = await thsrFreeSeat(request, env);";
  const replacement = "else if (url.pathname === '/api/thsr-freeseat') res = jsonRes({ at: new Date().toISOString(), date: twToday(), cars: {} }, 200, 'no-store');";
  const mutated = source.replace(needle, replacement);
  check(mutated !== source, '突變確實套用到 /api/thsr-freeseat route');
  if (mutated === source) throw new Error('找不到預期 route，拒絕執行無效突變測試');
  mutantPath = path.join(ROOT, `.worker-smoke-mutant-${process.pid}.mjs`);
  writeFileSync(mutantPath, mutated);
  return mutantPath;
}

async function waitForExit(proc, timeoutMs) {
  if (processExited(proc)) return true;
  let timer;
  const timedOut = new Promise(resolve => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const exited = once(proc, 'exit').then(() => true);
  const result = await Promise.race([exited, timedOut]);
  clearTimeout(timer);
  return result;
}

async function stopWrangler(session) {
  if (!session) return;
  activeSessions.delete(session);
  if (!processExited(session.proc)) session.proc.kill('SIGTERM');
  if (!await waitForExit(session.proc, 5_000) && !processExited(session.proc)) {
    session.proc.kill('SIGKILL');
    await waitForExit(session.proc, 2_000);
  }
  writeFileSync(session.logPath, redact(session.logText));
}

async function startWrangler(label, entrypoint, extraVars = []) {
  const scenarioDir = path.join(runDir, label);
  const assetsDir = path.join(scenarioDir, 'assets');
  const persistDir = path.join(scenarioDir, 'persist');
  const wranglerLogDir = path.join(scenarioDir, 'wrangler-logs');
  mkdirSync(assetsDir, { recursive: true });
  mkdirSync(persistDir, { recursive: true });
  mkdirSync(wranglerLogDir, { recursive: true });
  writeFileSync(path.join(assetsDir, 'smoke-ready.txt'), 'static assets watcher sentinel\n');

  const port = await freePort();
  const inspectorPort = await freePort();
  const args = [
    WRANGLER_PATH,
    'dev',
    entrypoint,
    '--config', CONFIG_PATH,
    '--local',
    '--local-protocol', 'https',
    '--ip', '127.0.0.1',
    '--port', String(port),
    '--inspector-ip', '127.0.0.1',
    '--inspector-port', String(inspectorPort),
    '--assets', assetsDir,
    '--persist-to', persistDir,
    '--show-interactive-dev-session=false',
    '--log-level', 'log',
  ];
  for (const value of extraVars) args.push('--var', value);

  const proc = spawn(process.execPath, args, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CI: '1',
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      WRANGLER_LOG: 'log',
      WRANGLER_LOG_PATH: wranglerLogDir,
      WRANGLER_LOG_SANITIZE: 'true',
      WRANGLER_SEND_METRICS: 'false',
    },
  });
  const session = {
    label,
    proc,
    base: `https://127.0.0.1:${port}`,
    logPath: path.join(scenarioDir, 'server.log'),
    logText: '',
    readyLogOffset: 0,
  };
  activeSessions.add(session);
  const collect = chunk => { session.logText += chunk.toString('utf8'); };
  proc.stdout.on('data', collect);
  proc.stderr.on('data', collect);

  const startedAt = Date.now();
  const deadline = startedAt + STARTUP_LIMIT_MS;
  let readyResponse = null;
  let lastError = null;
  while (Date.now() < deadline && !processExited(proc)) {
    try {
      const response = await httpsGet(session.base + READY_PATH, 2_000);
      const json = JSON.parse(response.body);
      if (response.status === 400 && json && typeof json.error === 'string') {
        readyResponse = response;
        break;
      }
      lastError = new Error(`就緒探針回 ${response.status}: ${response.body.slice(0, 160)}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  const startupMs = Date.now() - startedAt;
  session.readyLogOffset = session.logText.length;
  const ready = !!readyResponse;
  check(
    ready && startupMs <= STARTUP_LIMIT_MS,
    `[${label}] wrangler dev 在 60 秒內真的回應 Worker HTTP`,
    ready
      ? `${(startupMs / 1000).toFixed(2)}s，${session.base}`
      : `${(startupMs / 1000).toFixed(2)}s，exit=${proc.exitCode ?? proc.signalCode ?? 'running'}，${redact(lastError?.message || '無回應')}`,
  );
  if (!ready) {
    await stopWrangler(session);
    line(`  LOG   ${path.relative(ROOT, session.logPath)}`);
    return null;
  }
  return session;
}

async function verifyLiveEndpoint(session) {
  line('\n[Live] GET /api/thsr-freeseat（真 workerd → 真 TDX）');
  let response;
  try {
    response = await httpsGet(session.base + '/api/thsr-freeseat');
  } catch (error) {
    check(false, '端點可完成 HTTP 回應，沒有連線錯誤/逾時', redact(error.message));
    return;
  }
  check(response.status === 200, 'HTTP status = 200', `status=${response.status} body=${redact(response.body.slice(0, 180))}`);
  let body = null;
  try { body = JSON.parse(response.body); }
  catch (error) { check(false, '回應可解析為 JSON', error.message); }
  if (!body) return;

  const keys = Object.keys(body).sort();
  const exactShape = JSON.stringify(keys) === JSON.stringify(['at', 'cars', 'date']);
  check(exactShape, '頂層形狀恰為 {at,date,cars}', `keys=${keys.join(',')}`);
  check(typeof body.at === 'string' && Number.isFinite(Date.parse(body.at)), 'at 是有效時間字串', String(body.at));
  const expectedDate = taipeiToday();
  check(body.date === expectedDate, 'date 等於台北時區今天', `got=${body.date} expected=${expectedDate}`);

  const carsIsObject = body.cars !== null && typeof body.cars === 'object' && !Array.isArray(body.cars);
  check(carsIsObject, 'cars 是 {車次號:[車廂編號…]} 物件');
  const entries = carsIsObject ? Object.entries(body.cars) : [];
  check(entries.length > 100, 'cars 筆數 > 100', `count=${entries.length}`);
  const bad = entries.filter(([trainNo, cars]) =>
    !/^\d+$/.test(trainNo) ||
    !Array.isArray(cars) ||
    cars.length === 0 ||
    cars.some(car => !Number.isInteger(car) || car <= 0));
  check(bad.length === 0, '每筆皆為數字車次號 → 非空正整數車廂陣列', bad.length ? `bad=${bad.slice(0, 5).map(([k]) => k).join(',')}` : `checked=${entries.length}`);
}

async function verifyStability(session) {
  line(`\n[Stability] 就緒後連續觀察 ${(STABILITY_WINDOW_MS / 1000).toFixed(0)} 秒`);
  const startedAt = Date.now();
  const deadline = startedAt + STABILITY_WINDOW_MS;
  let heartbeatFailures = 0;
  let heartbeats = 0;
  while (Date.now() < deadline) {
    if (processExited(session.proc)) {
      heartbeatFailures++;
      break;
    }
    try {
      const response = await httpsGet(session.base + READY_PATH, 2_000);
      if (response.status !== 400) heartbeatFailures++;
    } catch (error) {
      heartbeatFailures++;
    }
    heartbeats++;
    const remaining = deadline - Date.now();
    if (remaining > 0) await sleep(Math.min(HEARTBEAT_INTERVAL_MS, remaining));
  }
  const elapsedMs = Date.now() - startedAt;
  const afterReadyLog = session.logText.slice(session.readyLogOffset);
  const reloads = countOccurrences(afterReadyLog, 'Reloading local server');
  check(elapsedMs >= STABILITY_WINDOW_MS, '穩定性觀察窗完整滿 120 秒', `${(elapsedMs / 1000).toFixed(2)}s`);
  check(heartbeatFailures === 0, '觀察窗內 HTTP heartbeat 全數有回應', `${heartbeats - heartbeatFailures}/${heartbeats}`);
  check(
    reloads <= MAX_RELOADS_AFTER_READY,
    `觀察窗內 Reloading local server 次數 <= ${MAX_RELOADS_AFTER_READY}`,
    `count=${reloads}`,
  );
}

function listenFixture(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

function closeFixture(server) {
  return new Promise(resolve => server.close(() => resolve()));
}

async function verifyErrorPath(entrypoint) {
  line('\n[Error] 真 workerd → 本機 fixture 上游 503');
  const fixture = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://worker-smoke.invalid');
    response.setHeader('content-type', 'application/json; charset=utf-8');
    if (url.pathname === '/auth/token') {
      response.statusCode = 200;
      response.end(JSON.stringify({ access_token: 'x', expires_in: 300 }));
      return;
    }
    if (url.pathname.startsWith('/Rail/THSR/DailyFreeSeatingCar/TrainDate/')) {
      response.statusCode = 503;
      response.end(JSON.stringify({ error: 'fixture upstream unavailable' }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'fixture route not found' }));
  });
  activeFixtureServers.add(fixture);
  const fixturePort = await listenFixture(fixture);
  let session = null;
  try {
    session = await startWrangler('upstream-503', entrypoint, [
      'TDX_CLIENT_ID:x',
      'TDX_CLIENT_SECRET:x',
      `TDX_AUTH_URL_OVERRIDE:http://127.0.0.1:${fixturePort}/auth/token`,
      `THSR_FREESEAT_BASE_URL_OVERRIDE:http://127.0.0.1:${fixturePort}/Rail/THSR/DailyFreeSeatingCar/TrainDate`,
    ]);
    if (!session) return;
    let response;
    try {
      response = await httpsGet(session.base + '/api/thsr-freeseat');
    } catch (error) {
      check(false, '上游 503 時端點仍完成 HTTP 回應（例外不逸出）', redact(error.message));
      return;
    }
    check(response.status === 502, '上游非 200 時回明確 502，不是裸 500', `status=${response.status}`);
    const contentType = String(response.headers['content-type'] || '');
    check(contentType.includes('application/json'), '錯誤回應 Content-Type 是 JSON', contentType);
    let body = null;
    try { body = JSON.parse(response.body); }
    catch (error) { check(false, '錯誤 body 可解析為 JSON', error.message); }
    check(body && typeof body.error === 'string' && body.error.length > 0, '錯誤 body 是結構化 {error}', redact(response.body.slice(0, 180)));
  } finally {
    await stopWrangler(session);
    if (session) line(`  LOG   ${path.relative(ROOT, session.logPath)}`);
    activeFixtureServers.delete(fixture);
    await closeFixture(fixture);
  }
}

async function main() {
  line(`[G0] ROOT=${ROOT}`);
  line(`[G0] mode=${MUTATE ? 'MUTATION（預期 exit 1）' : 'CONTROL（預期 exit 0）'}`);
  line(`[G0] startup<=${STARTUP_LIMIT_MS / 1000}s stability=${STABILITY_WINDOW_MS / 1000}s maxReloads=${MAX_RELOADS_AFTER_READY}`);
  check(existsSync(CONFIG_PATH), '找到 wrangler.jsonc');
  check(existsSync(WORKER_PATH), '找到 worker.js');
  check(existsSync(WRANGLER_PATH), '找到本機安裝的 Wrangler CLI', WRANGLER_PATH);
  if (!existsSync(CONFIG_PATH) || !existsSync(WORKER_PATH) || !existsSync(WRANGLER_PATH)) return;

  const entrypoint = prepareEntrypoint();
  let liveSession = null;
  try {
    liveSession = await startWrangler('live', entrypoint);
    if (liveSession) {
      await verifyLiveEndpoint(liveSession);
      await verifyStability(liveSession);
    }
  } finally {
    await stopWrangler(liveSession);
    if (liveSession) line(`  LOG   ${path.relative(ROOT, liveSession.logPath)}`);
  }

  await verifyErrorPath(entrypoint);
}

async function emergencyCleanup() {
  for (const session of [...activeSessions]) await stopWrangler(session);
  for (const fixture of [...activeFixtureServers]) {
    activeFixtureServers.delete(fixture);
    await closeFixture(fixture);
  }
  if (mutantPath) rmSync(mutantPath, { force: true });
}

try {
  await main();
} catch (error) {
  failures++;
  line(`  FAIL  未捕捉的測試錯誤 — ${redact(error && (error.stack || error.message) || error)}`);
} finally {
  await emergencyCleanup();
  line(`\n──────── ${failures ? `${failures} 條 FAIL` : '全部 PASS'} ────────`);
  line(`[ARTIFACT] ${path.relative(ROOT, runDir)}`);
  writeFileSync(summaryPath, summary.join('\n') + '\n');
}

process.exitCode = failures ? 1 : 0;
