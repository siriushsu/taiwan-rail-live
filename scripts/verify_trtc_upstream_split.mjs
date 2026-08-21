// 驗「把帶帳密抓上游與跑模型拆開」這一刀沒有改到行為，也沒有讓上游用量翻倍。
//
// 為什麼需要這支：私有化的第一步是把 trtcLive 裡「抓上游」與「跑模型」分開，好讓後半整批
// 搬進私有 Metro Core。這種純搬移最危險的失敗是**看起來一樣但其實不一樣**——
// 少傳一個參數、memo 節奏偏移、或多開一個端點就讓官方端的請求量翻倍（北捷會員 API 有配額）。
//
// 判準刻意都架在**真 workerd 觀測得到的外部事實**上，不重寫一份模型當期望值（心得 29：
// 判準不得與實作同源）：
//   1. 上游用假 server 頂替並**逐支計數**——這是外部觀測，worker 改什麼都騙不了它。
//   2. 新舊兩版對**同一份確定性假資料**跑出來的 /api/trtc-live 逐 byte 比對。
//   3. 突變對照：把 trtcRaw 改成自己直接打上游（繞過共用 memo），計數必須從 3 變 6。
//      沒有這一步就不知道第 1 條判準有沒有牙（心得 35）。
//
// 用法：
//   node scripts/verify_trtc_upstream_split.mjs                （含突變對照）
//   node scripts/verify_trtc_upstream_split.mjs --no-mutation
//
// 本機環境既知條件（照 wrangler-local-verification-traps 記憶檔）：
//   · 一律 `arch -arm64 node ./node_modules/wrangler/…`（npx 會被 Rosetta 拉成 x64）
//   · 必須 `--local-protocol https`，否則 worker.js 開頭的 http→https 301 會讓 /api/* 無限重導
//   · server 一律從乾淨 worktree 起（工作樹會重載風暴）
//   · 不把 node_modules symlink 進去（assets.directory 是 "."，監看器會走進數萬個目錄）
//   · 每次起 server 前刪 .wrangler（邊緣快取跨重啟存活 ⇒ 假綠）
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const md5 = b => createHash('md5').update(b).digest('hex');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';   // wrangler dev 的 https 用自簽憑證

let pass = 0, fail = 0;
const check = (ok, title, detail = '') => {
  (ok ? pass++ : fail++);
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${title}${detail ? `  — ${detail}` : ''}`);
};

// ── 確定性假上游 ───────────────────────────────────────────────────────────
// 時刻全部寫死：新舊兩版對同一份輸入必須算出逐 byte 相同的 trains/board，
// 有任何一個值取自 Date.now() 就會漏餡。
const NOW_STR = '2026-08-21 09:00:00';
const FAKE = {
  CarWeight: [
    { TrainNumber: '101', StationID: 'BL12', CID: '1', utime: NOW_STR,
      Cart1L: 1, Cart2L: 2, Cart3L: 2, Cart4L: 3, Cart5L: 1, Cart6L: 1 },
    { TrainNumber: '102', StationID: 'BL08', CID: '2', utime: NOW_STR,
      Cart1L: 2, Cart2L: 2, Cart3L: 1, Cart4L: 1, Cart5L: 2, Cart6L: 2 },
    // 同車次兩筆、舊的在後：dedupeLatest 必須只留 utime 最新的那筆
    { TrainNumber: '101', StationID: 'BL11', CID: '1', utime: '2026-08-21 08:59:00',
      Cart1L: 4, Cart2L: 4, Cart3L: 4, Cart4L: 4, Cart5L: 4, Cart6L: 4 },
    // 擁擠度值域外：carsOf 必須整讀拒收並計進 carsRejected
    { TrainNumber: '103', StationID: 'R10', CID: '1', utime: NOW_STR,
      Cart1L: 9, Cart2L: 2, Cart3L: 2, Cart4L: 2, Cart5L: 2, Cart6L: 2 },
  ],
  CarWeightBR: [
    { TrainNumber: '201', StationID: 'BR11', CID: '1', UpdateTime: NOW_STR,
      Car1: 1, Car2: 1, Car3: 2, Car4: 2 },
    { TrainNumber: '202', StationID: 'BR05', CID: '2', UpdateTime: NOW_STR,
      Car1: 3, Car2: 3, Car3: 2, Car4: 2 },
  ],
  TrackInfo: [
    { TrainNumber: '101', StationName: '台北車站', DestinationName: '南港展覽館',
      CountDown: '02:30', NowDateTime: NOW_STR },
    { TrainNumber: '101', StationName: '善導寺站', DestinationName: '南港展覽館',
      CountDown: '04:10', NowDateTime: NOW_STR },
    { TrainNumber: '102', StationName: '西門站', DestinationName: '頂埔',
      CountDown: '列車進站', NowDateTime: NOW_STR },
    // 非時間值：必須 fail-closed 丟列並計進 dropped，不可猜
    { TrainNumber: '103', StationName: '中山站', DestinationName: '淡水',
      CountDown: '營運時間已過', NowDateTime: NOW_STR },
    // 無車次：path 迴圈要濾掉並計進 pathNoTrainNo，board 迴圈不濾
    { TrainNumber: '', StationName: '忠孝復興站', DestinationName: '動物園',
      CountDown: '01:00', NowDateTime: NOW_STR },
    // 解不出上游時刻：兩個迴圈都要丟並各自計數
    { TrainNumber: '104', StationName: '大安站', DestinationName: '象山',
      CountDown: '03:00', NowDateTime: '壞掉的時刻' },
  ],
};

function startFakeUpstream() {
  const hits = { CarWeight: 0, CarWeightBR: 0, TrackInfo: 0 };
  let down = false;                                    // true = 三支官方端點全掛
  const srv = http.createServer((req, res) => {
    const m = /\/metroapi\/(\w+)\.asmx/.exec(req.url || '');
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      if (!m || !(m[1] in FAKE)) { res.writeHead(404).end(); return; }
      hits[m[1]]++;
      if (down) { res.writeHead(503).end('upstream down'); return; }
      const json = JSON.stringify(FAKE[m[1]]);
      // CarWeightBR 走 <...Result> 包裹那條路徑，其餘走「JSON 在前、SOAP 在後」，
      // 兩條 trtcParse 分支都要被真的走過一次。
      const payload = m[1] === 'CarWeightBR'
        ? `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><getCarWeightBRInfoResponse><getCarWeightBRInfoResult>${json.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}</getCarWeightBRInfoResult></getCarWeightBRInfoResponse></soap:Body></soap:Envelope>`
        : `${json}<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body/></soap:Envelope>`;
      res.writeHead(200, { 'content-type': 'text/xml; charset=utf-8' }).end(payload);
    });
  });
  return new Promise(resolve => {
    srv.listen(0, '127.0.0.1', () => resolve({
      base: `http://127.0.0.1:${srv.address().port}`,
      hits,
      total: () => hits.CarWeight + hits.CarWeightBR + hits.TrackInfo,
      reset: () => { hits.CarWeight = 0; hits.CarWeightBR = 0; hits.TrackInfo = 0; },
      setDown: value => { down = value; },
      close: () => new Promise(r => srv.close(r)),
    }));
  });
}

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

// 起一台乾淨 worktree 的 wrangler dev。ref 決定樹的內容；workerSource 若給就覆蓋 worker.js
// （突變測試用）。回傳 { base, stop }。
async function startServer(label, ref, upstreamBase, workerSource = null, extraVars = []) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'trtc-split-'));
  const tree = path.join(dir, 'vtree');
  execFileSync('git', ['-C', ROOT, 'worktree', 'add', '--detach', tree, ref], { stdio: 'ignore' });
  for (const f of ['.dev.vars', '.env']) {
    if (existsSync(path.join(ROOT, f)) && !existsSync(path.join(tree, f))) {
      symlinkSync(path.join(ROOT, f), path.join(tree, f));
    }
  }
  if (workerSource != null) writeFileSync(path.join(tree, 'worker.js'), workerSource);
  // 🔴 驗收腳本第一道 gate 是「我到底在驗什麼」（心得 32：連兩輪驗到釘死的舊 worktree 而全綠）。
  const landed = md5(readFileSync(path.join(tree, 'worker.js')));
  console.log(`  [${label}] ref=${ref} worker.js md5=${landed}`);
  rmSync(path.join(tree, '.wrangler'), { recursive: true, force: true });

  const port = await freePort();
  const inspectorPort = await freePort();
  const proc = spawn('arch', ['-arm64', 'node', path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'),
    'dev', '--local-protocol', 'https', '--port', String(port), '--inspector-port', String(inspectorPort),
    '--var', `TRTC_API_BASE:${upstreamBase}`, '--var', 'TRTC_API_USER:fake', '--var', 'TRTC_API_PASS:fake',
    ...extraVars.flatMap(v => ['--var', v])],
  { cwd: tree, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } });
  let log = '';
  proc.stdout.on('data', d => { log += d; });
  proc.stderr.on('data', d => { log += d; });

  const base = `https://127.0.0.1:${port}`;
  const stop = () => {
    try { proc.kill('SIGTERM'); } catch (e) { /* 已經死了 */ }
    try { execFileSync('git', ['-C', ROOT, 'worktree', 'remove', '--force', tree], { stdio: 'ignore' }); } catch (e) { /* 留著無妨 */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 同上 */ }
  };
  // 就緒檢查真打一發 HTTP：只看埠開了會誤判（wrangler 立刻 bind 但還沒能服務）。
  // 🔴 探測路徑刻意選一個**不存在的 /api/ 子路徑**：打得到 404 就證明 worker 起來且在路由，
  //    而且完全不碰北捷。第一版用 /api/trtc-raw 探測，結果 memo 與邊緣快取在計數開始前
  //    就被暖起來，判準 3 量到 0 次——那是判準自己造成的紅，不是產品回歸。
  //    （cacheKey 是用 pathname 建的，帶 ?bust= 也破不掉這個快取。）
  const deadline = Date.now() + 240e3;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const r = await fetch(`${base}/api/__probe_not_a_real_endpoint`, { signal: AbortSignal.timeout(8000) });
      if (r.status < 500) { await r.text(); return { base, stop, log: () => log, md5: landed }; }
    } catch (e) { /* 還沒起來 */ }
  }
  stop();
  throw new Error(`[${label}] wrangler dev 240 秒內沒起來\n${log.slice(-2000)}`);
}

const getJson = async (base, p, headers = undefined) => {
  const r = await fetch(`${base}${p}?bust=${Date.now()}${Math.random()}`,
    { headers, signal: AbortSignal.timeout(20000) });
  return { status: r.status, cc: r.headers.get('cache-control') || '', body: await r.json() };
};

// ── 主流程 ────────────────────────────────────────────────────────────────
const runMutation = !process.argv.includes('--no-mutation');
const up = await startFakeUpstream();
console.log(`假上游：${up.base}`);
const servers = [];
try {
  console.log('\n── 起兩台真 workerd（舊版=origin/main，新版=工作樹當下） ──');
  const workingSource = readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
  const oldSrv = await startServer('舊版', 'origin/main', up.base);
  servers.push(oldSrv);
  const newSrv = await startServer('新版', 'HEAD', up.base, workingSource);
  servers.push(newSrv);
  check(oldSrv.md5 !== newSrv.md5, '兩台跑的 worker.js 確實不同（否則整支比對零資訊）',
    `舊=${oldSrv.md5.slice(0, 8)} 新=${newSrv.md5.slice(0, 8)}`);

  console.log('\n── 判準 1：/api/trtc-live 的可推導輸出逐 byte 不變 ──');
  const oldLive = await getJson(oldSrv.base, '/api/trtc-live');
  const newLive = await getJson(newSrv.base, '/api/trtc-live');
  check(oldLive.status === 200 && newLive.status === 200, '兩版 /api/trtc-live 都回 200',
    `舊=${oldLive.status} 新=${newLive.status}`);
  // 只比「由上游輸入唯一決定」的三段。boardPos／ledger 走的是本批一字未動的程式碼，
  // 但它們吃 D1 與牆上時鐘（officialRequestStartedAt），本機兩棵樹的 D1 各自為空，
  // 拿來比等於在比環境不是比程式（心得 34：紅的三種原因要先分辨）。
  const core = b => JSON.stringify({ trains: b.trains, board: b.board, cd: b.cd });
  check(core(oldLive.body) === core(newLive.body), 'trains／board／cd 三段逐 byte 相同',
    `${core(newLive.body).length} bytes`);
  check(Array.isArray(newLive.body.trains) && newLive.body.trains.length > 0,
    '新版真的算出車（避免「兩邊都是空的」這種零資訊的相同）',
    `${newLive.body.trains.length} 台`);
  check(Array.isArray(newLive.body.board) && newLive.body.board.length > 0,
    '新版真的算出看板列', `${newLive.body.board.length} 列`);
  // 正向對照：假資料裡刻意埋的三種壞列必須真的被丟掉並計數，證明管線走完整條而不是短路。
  const cd = newLive.body.cd || {};
  check(cd.dropped >= 1 && cd.pathDropped >= 1, '非時間倒數值 fail-closed 被丟且有計數',
    `dropped=${cd.dropped} pathDropped=${cd.pathDropped}`);
  check(cd.pathNoTrainNo >= 1, '無車次列在 path 迴圈被濾掉且有計數', `pathNoTrainNo=${cd.pathNoTrainNo}`);
  check(cd.dateDropped >= 1 && cd.pathDateDropped >= 1, '解不出上游時刻的列兩個迴圈都丟且各自計數',
    `dateDropped=${cd.dateDropped} pathDateDropped=${cd.pathDateDropped}`);
  check(cd.carsRejected >= 1, '擁擠度值域外整讀拒收且有計數', `carsRejected=${cd.carsRejected}`);
  check(newLive.body.boardPos != null && 'ledger' in newLive.body,
    '新版仍帶 boardPos 與 ledger 欄位（沒有在搬移中掉欄位）');

  console.log('\n── 判準 2：/api/trtc-raw 只給原始列，不含任何模型輸出 ──');
  const raw = await getJson(newSrv.base, '/api/trtc-raw');
  check(raw.status === 200, '/api/trtc-raw 回 200', `status=${raw.status}`);
  check(Array.isArray(raw.body.hw) && Array.isArray(raw.body.br) && Array.isArray(raw.body.tk),
    '回傳三支上游的原始陣列');
  check(JSON.stringify(raw.body.tk) === JSON.stringify(FAKE.TrackInfo),
    'tk 逐 byte 等於上游原始列（沒有被加工過）');
  const modelKeys = ['boardPos', 'ledger', 'trains', 'board', 'cd', 'vehicles'];
  const leaked = modelKeys.filter(k => k in raw.body);
  check(leaked.length === 0, '不含任何模型輸出欄位',
    leaked.length ? `外洩：${leaked.join(', ')}` : `已檢查 ${modelKeys.join('／')}`);
  // 🔴 帶金鑰閘門的端點絕不可以回 public：`caches.default` 與任何中介快取的鍵都只有網址，
  // 存進去的授權回應會被餵給沒帶金鑰的人，閘門形同虛設。
  check(/no-store/.test(raw.cc) && !/public/.test(raw.cc),
    'cache-control 是 no-store 且不含 public（授權過的回應不可進任何共用快取）', `實際：${raw.cc}`);
  const live = await getJson(newSrv.base, '/api/trtc-live');
  check(/public/.test(live.cc),
    '正向對照：不帶閘門的 /api/trtc-live 仍是 public（上一條不是恆真）', `實際：${live.cc}`);

  console.log('\n── 判準 3：多這一支端點不會讓官方端的請求量翻倍 ──');
  // 重開一台，確保 memo 是冷的；同一台上先後打兩支端點，數上游被打幾次。
  const cntSrv = await startServer('計數', 'HEAD', up.base, workingSource);
  servers.push(cntSrv);
  up.reset();
  await getJson(cntSrv.base, '/api/trtc-live');
  await getJson(cntSrv.base, '/api/trtc-raw');
  const shared = up.total();
  check(shared === 3, '兩支端點合計只打上游 3 次（三支官方端點各一次）',
    `實測 ${shared} 次：CarWeight=${up.hits.CarWeight} BR=${up.hits.CarWeightBR} TrackInfo=${up.hits.TrackInfo}`);

  console.log('\n── 判準 4：三支上游全掛時，/api/trtc-raw 回 200 空殼而不是 500 ──');
  // 🔴 這條路徑沒有別的判準蓋到,而它正是 `return await` 在保護的東西:少了 await,
  // jsonResCached 內 edge.put 丟出的例外會逃出 try,症狀從「回空殼」變成 unhandled rejection。
  // 私有 Metro Core 靠 src:null／tkOk:false 分辨「上游沒資料」與「代理掛了」,回 500 會讓
  // 影子那輪只看得到一個 fetch 失敗,分不出是哪一種。
  const downSrv = await startServer('斷線', 'HEAD', up.base, workingSource);
  servers.push(downSrv);
  up.setDown(true);
  const down = await getJson(downSrv.base, '/api/trtc-raw');
  check(down.status === 200, '上游全掛時仍回 200（不是 500）', `status=${down.status}`);
  check(down.body && down.body.src === null && down.body.tkOk === false,
    '空殼標明 src:null 與 tkOk:false，讀者分得出「上游沒資料」與「代理掛了」',
    JSON.stringify({ src: down.body && down.body.src, tkOk: down.body && down.body.tkOk }));
  check(Array.isArray(down.body.tk) && down.body.tk.length === 0 &&
    Array.isArray(down.body.hw) && Array.isArray(down.body.br), '三個陣列都在且是空的');
  // 正向對照：同一台 server 換回正常上游後要真的回得出資料，證明上面的 200 不是因為
  // 這台從頭到尾就壞掉（心得：`=== 0` 一律要配正向對照）。
  up.setDown(false);
  // 不必等快取到期：這支不進共用快取，而失敗那輪也不會寫進 trtcUpMem，所以下一發直接重抓。
  await new Promise(r => setTimeout(r, 500));
  const back = await getJson(downSrv.base, '/api/trtc-raw');
  check(back.body && back.body.src === 'trtc' && back.body.tk.length > 0,
    '正向對照：上游恢復後同一台真的回得出資料',
    `src=${back.body && back.body.src} tk=${back.body && back.body.tk && back.body.tk.length}`);

  console.log('\n── 判準 5：正式站設了 METRO_CORE_KEY 之後，閘門真的關得起來 ──');
  // 🔴 前面四條判準都跑在**沒設金鑰**的環境（閘門開著），證不出閘門本身有沒有作用。
  // 正式站設了 secret 才是真實形態，這條就是補那一格：沒帶／帶錯一律 404，帶對才 200。
  const GATE = 'gate-secret-for-verify';
  const gateSrv = await startServer('閘門', 'HEAD', up.base, workingSource, [`METRO_CORE_KEY:${GATE}`]);
  servers.push(gateSrv);
  const noKey = await getJson(gateSrv.base, '/api/trtc-raw');
  check(noKey.status === 404 && noKey.body && noKey.body.error === 'not_found',
    '不帶金鑰 → 404 not_found（且不透露端點存在）',
    `status=${noKey.status} body=${JSON.stringify(noKey.body)}`);
  const badKey = await getJson(gateSrv.base, '/api/trtc-raw', { 'x-metro-core-key': 'wrong' });
  check(badKey.status === 404, '帶錯金鑰 → 404', `status=${badKey.status}`);
  const okKey = await getJson(gateSrv.base, '/api/trtc-raw', { 'x-metro-core-key': GATE });
  check(okKey.status === 200 && okKey.body && okKey.body.src === 'trtc' && okKey.body.tk.length > 0,
    '正向對照：帶對金鑰真的拿得到資料（上面兩個 404 不是因為端點壞了）',
    `status=${okKey.status} tk=${okKey.body && okKey.body.tk && okKey.body.tk.length}`);
  const liveWithGate = await getJson(gateSrv.base, '/api/trtc-live');
  check(liveWithGate.status === 200 && Array.isArray(liveWithGate.body.board),
    '正向對照：設了金鑰不會誤傷其他端點', `status=${liveWithGate.status}`);

  if (runMutation) {
    console.log('\n── 突變對照：把閘門拿掉，判準 5 必須轉紅 ──');
    const GATE_NEEDLE = `  if (env && env.METRO_CORE_KEY &&`;
    check(workingSource.includes(GATE_NEEDLE), '找得到閘門那一行（找不到就是這條突變在空轉）');
    const noGate = workingSource.replace(GATE_NEEDLE, `  if (false &&`);
    check(noGate !== workingSource, '閘門突變真的套用了');
    const noGateSrv = await startServer('無閘門', 'HEAD', up.base, noGate, [`METRO_CORE_KEY:${GATE}`]);
    servers.push(noGateSrv);
    const leaked = await getJson(noGateSrv.base, '/api/trtc-raw');
    check(leaked.status === 200, '拿掉閘門後不帶金鑰就拿得到 ⇒ 判準 5 有牙，不是恆真',
      `status=${leaked.status}`);
  }

  if (runMutation) {
    console.log('\n── 突變對照：把 trtcRaw 改成自己直接打上游，判準 3 必須轉紅 ──');
    const NEEDLE = '    const up = await trtcUpstream(env);';
    const mutated = workingSource.replace(NEEDLE,
      '    const up = await (async () => { const [hw, br, tk] = await Promise.all([\n'
      + '      trtcCall(trtcApiUrl(env, \'CarWeight\'), \'getCarWeightByInfoEx\', env).catch(() => []),\n'
      + '      trtcCall(trtcApiUrl(env, \'CarWeightBR\'), \'getCarWeightBRInfo\', env).catch(() => []),\n'
      + '      trtcCall(trtcApiUrl(env, \'TrackInfo\'), \'getTrackInfo\', env).catch(() => []),\n'
      + '    ]); return { at: Date.now(), startedAt: Date.now(), tkOk: true, hw, br, tk }; })();');
    check(mutated !== workingSource, '突變真的套用了（沒套用就是零資訊的假綠）');
    const mutSrv = await startServer('突變', 'HEAD', up.base, mutated);
    servers.push(mutSrv);
    up.reset();
    await getJson(mutSrv.base, '/api/trtc-live');
    await getJson(mutSrv.base, '/api/trtc-raw');
    const doubled = up.total();
    check(doubled === 6, '突變後上游被打 6 次 ⇒ 判準 3 有牙，不是恆真',
      `實測 ${doubled} 次`);
  }
} finally {
  for (const s of servers) s.stop();
  await up.close();
}

console.log(`\n總計 PASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
