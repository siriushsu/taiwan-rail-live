// 擁擠度逐車 join ＋ 斷線歸因的驗收（index.html）——Playwright chromium。
//
// 這支守三件 2026-08-29 使用者回報的事：
//   1. 忠孝復興往南港展覽館的文湖線列，長出板南線的擁擠度
//      （舊 join 的鍵只有終點 ⇒ 同終點的每一列拿到同一台車的值）
//   2. 擁擠度忽有忽無（只長在官方板上，Core 板一格都沒有 ⇒ 板路徑一翻就消失）
//   3. 常常跳出「北捷訊號中斷」但其實是我們自己沒去收
//      （站台看板的判準沒有 Core 分支，橫幅早就有了）
//
// fixture 是 2026-08-29 從正式站抓下來的真實一輪，裡面確定含有污染案例（見第 0 項前提閘門）。
// 用固定 fixture 不打真 API：判準才可重跑、才不會因為當下剛好沒有污染案例而變成零資訊。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 5191);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json' };

const FEED = JSON.parse(readFileSync(path.join(ROOT, 'scripts/fixtures/trtc_live_crowd.json'), 'utf8'));
const STATION = '忠孝復興';

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/trtc-live') {
    // 時間戳要跟著現在走，否則整份 fixture 一開始就超齡，看板會直接退回班表板。
    const shift = Math.round(Date.now() / 1000) - Math.max(...FEED.board.map(r => Number(r.at)));
    const feed = structuredClone(FEED);
    feed.board = feed.board.map(r => ({ ...r, at: Number(r.at) + shift, eta: Number(r.eta) + shift,
      ...(r.eta2 == null ? {} : { eta2: Number(r.eta2) + shift }) }));
    feed.trains = feed.trains.map(t => ({ ...t, at: Number(t.at) + shift }));
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify(feed));
  }
  if (url.pathname.startsWith('/api/')) { res.statusCode = 404; return res.end('no api in verify'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(resolve => server.listen(PORT, resolve));

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

// ── 第 0 項：前提閘門 ────────────────────────────────────────────────────────
// fixture 裡必須真的存在「舊 join 會顯示錯的」案例，否則後面全部是零資訊的假綠。
const carsByNo = new Map();
for (const train of FEED.trains) {
  const no = String(train.no || '').trim();
  if (no && Array.isArray(train.cars) && train.cars.length) carsByNo.set(no, train.cars);
}
const carsByDest = {};
for (const train of FEED.trains) {
  const dest = String(train.dest || '');
  if (!dest || carsByDest[dest] || !Array.isArray(train.cars) || !train.cars.length) continue;
  carsByDest[dest] = train.cars;
}
const stationRows = FEED.board.filter(r => String(r.name || '').replace(/臺/g, '台').startsWith(STATION));
const contaminated = stationRows.filter(r => {
  const per = carsByNo.get(String(r.no || '').trim()) || null;
  const dest = carsByDest[r.dest] || null;
  return (!per && dest) || (per && dest && JSON.stringify(per) !== JSON.stringify(dest));
});
ok('前提：fixture 含舊 join 會顯示錯的案例', contaminated.length > 0,
  `${STATION} ${stationRows.length} 列中有 ${contaminated.length} 列會被污染`);

const browser = await chromium.launch();
// 🔴 語系釘死：文案判準隨機器語系會假紅，而 !notice 型的反向判準會恆真空過。
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
await ctx.addInitScript(() => {
  localStorage.setItem('trainmap-howto-seen', '1');
  localStorage.setItem('trainmap-appearance', 'light');
  localStorage.setItem('trainmap-language', 'zh-TW');
});
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));   // waitFor 逾時本身零資訊，先掛這個

await page.goto(`http://localhost:${PORT}/?lang=zh-TW`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready; } catch { return false; } },
  null, { timeout: 30000 }).catch(() => {});
if (pageErrors.length) console.log('  boot pageerror:', pageErrors[0].slice(0, 200));

await page.evaluate(() => selectGroup(GROUPS.find(group => group.id === 'metro')));
await page.waitForFunction(name => (state.lines || []).some(line =>
  (line.stations || []).some(s => (s.name || '').replace(/臺/g, '台') === name)),
STATION, { timeout: 30000 });
// 看板要走官方板就得有官方資料；等 pollTrtcLive 真的把 fixture 收進去。
await page.waitForFunction(() => state.trtcOfficialBoard && state.trtcOfficialBoard.rows
  && state.trtcOfficialBoard.rows.length > 0, null, { timeout: 30000 });

const openStation = async () => page.evaluate(name => {
  for (const line of state.lines || []) {
    const found = (line.stations || []).find(s => (s.name || '').replace(/臺/g, '台') === name);
    if (found) { openBoard(found); return true; }
  }
  return false;
}, STATION);

// ── 第 1／2 項：逐車 join ────────────────────────────────────────────────────
await openStation();
await page.waitForSelector('#board .row', { timeout: 15000 });
// 🔴 線名有兩種擺法:列上的 .dest，或組標題 .grp>b(緊湊排法把它移上去，metroBoardRowLabel
//    在有組標題時回空字串)。判準只認列上那一種的話，換排法就會變成「找不到該列」——
//    那是判準過期，不是行為錯，而且長得跟真回歸一模一樣。兩種都收，跨排法成立。
const rendered = await page.evaluate(() => {
  const board = document.getElementById('board');
  const rows = [];
  let head = '';
  for (const el of board.querySelectorAll('.grp, .row')) {
    if (el.classList.contains('grp')) { head = (el.querySelector('b') || {}).textContent || ''; continue; }
    rows.push({
      dest: (el.querySelector('b') || {}).textContent || '',
      line: ((el.querySelector('.dest') || {}).textContent || '') + ' ' + head,
      bars: el.querySelectorAll('.crowd i').length
    });
  }
  return {
    path: board.dataset.metroCore ? 'core' : board.dataset.trtcOfficial ? 'official' : 'sched',
    rows,
  };
});
ok('看板走官方板（前提）', rendered.path === 'official', `實際走 ${rendered.path}`);

const brRow = rendered.rows.find(r => r.dest.includes('南港展覽館') && r.line.includes('文湖'));
ok('文湖線往南港展覽館不再掛別線的擁擠度', !!brRow && brRow.bars === 0,
  brRow ? `文湖線列 ${brRow.bars} 格（4 節車廂的線不該長出 6 格板南線的值）` : '找不到該列');

// 每一列要嘛是自己車號的格數，要嘛留白——不准有「借來的」。
// 🔴 對位一律用 (eta, at) 這組唯一鍵，不准再用 dest ——拿 dest 當鍵正是這支要修的 bug，
// 判準自己踩同一個坑就會得到互相矛盾的結果。
const perRow = await page.evaluate(() => [...document.querySelectorAll('#board .row[data-trtc-eta]')]
  .map(row => ({ eta: Number(row.dataset.trtcEta), at: Number(row.dataset.trtcAt),
    bars: row.querySelectorAll('.crowd i').length })));
// 🔴 (eta, at) 只在「同一站之內」才唯一——跨站會撞號（第一版就對位到別站的車 433）。
// 對位範圍限縮到本站，並加一道鍵不重複的前提閘門，免得靜默對錯。
const feedByKey = new Map();
for (const row of stationRows) feedByKey.set(`${row.eta}|${row.at}`, row);
ok('前提：本站內 (eta, at) 是唯一鍵', feedByKey.size === stationRows.length,
  `${stationRows.length} 列 → ${feedByKey.size} 個鍵`);
// 伺服器把 fixture 的時間戳整體平移到「現在」，平移量由兩邊的最大 at 反推即可。
const shift = perRow.length
  ? Math.max(...perRow.map(r => r.at)) - Math.max(...FEED.board.map(r => Number(r.at))) : 0;
const mismatched = [];
for (const row of perRow) {
  const source = feedByKey.get(`${row.eta - shift}|${row.at - shift}`);
  if (!source) continue;
  const per = carsByNo.get(String(source.no || '').trim());
  const expect = per ? per.length : 0;
  if (row.bars !== expect) mismatched.push({ no: source.no || '無', got: row.bars, expect });
}
ok('每一列的擁擠度都來自它自己的車號（無車號就留白）',
  perRow.length > 0 && mismatched.length === 0,
  `對位 ${perRow.length} 列` + (mismatched.length
    ? `，${mismatched.length} 列不符：` + JSON.stringify(mismatched.slice(0, 3)) : ''));

// ── 第 3 項：Core 板也要有擁擠度 ─────────────────────────────────────────────
// 只驗渲染層：塞一份最小 Core 視圖，確認 renderMetroCoreFreqBoard 會把擁擠度畫出來。
// 08-29 之前這個函式裡一個 crowd 字都沒有，於是板路徑一翻擁擠度就整片消失。
const coreCrowd = await page.evaluate(() => {
  const board = document.getElementById('board');
  const known = Object.keys(state.trtcOfficialBoard.crowdByNo || {});
  if (!known.length) return { skipped: '沒有可用車號' };
  const label = known[0];
  const line = (state.lines || []).find(l => l.stations && l.stations.length) || null;
  if (!line) return { skipped: '沒有線' };
  const original = window.metroCoreSystem;
  window.metroCoreSystem = () => ({ trains: [{ vehicleId: 'v1', publicLabel: label }] });
  try {
    renderMetroCoreFreqBoard(board, line.stations[0], state.lines, false, {
      linked: true, stationLines: [{ ln: line }],
      groups: [{ ln: line, li: 0, rows: [{ kind: 'core', vehicleId: 'v1', systemId: 'trtc',
        destName: line.stations[line.stations.length - 1].name,
        arrivalEpoch: Math.round(Date.now() / 1000) + 120 }] }]
    });
    return { label, bars: board.querySelectorAll('.crowd i').length,
      expect: (state.trtcOfficialBoard.crowdByNo[label] || []).length };
  } finally { window.metroCoreSystem = original; }
});
ok('Core 板會畫擁擠度（不再只有官方板有）',
  !coreCrowd.skipped && coreCrowd.bars > 0 && coreCrowd.bars === coreCrowd.expect,
  coreCrowd.skipped || `車號 ${coreCrowd.label}：畫出 ${coreCrowd.bars} 格 / 應為 ${coreCrowd.expect} 格`);

// ── 第 3b 項：Core snapshot 缺這個系統時，整張站看板不得變空 ────────────────────
// 🔴 P0-1（看板側）。地圖路徑早就有這道門（metroCoreItemsForLine 的 `if (!system) return null`
// 與 `return out.length ? out : null`），看板路徑兩道都沒有：metroCoreSystem 回 null 時
// `board && board.rows || []` 靜默吃成空陣列、迴圈尾的 continue 又跳過 _tt，最後函式仍回
// `{ groups: [] }`——那是 truthy 物件，renderFreqBoard 的 `if (core) { …; return; }` 因此
// 吃掉官方板與班表兩條退路，畫面顯示「此時段無停靠班次」。
// 正式站實測：Core /v1/metro/snapshot 取樣 104 次全部 200，其中 10 次只有 trtc、1 次只有 krtc
// ⇒ 這個狀態真的會發生，不是理論上的。
// 這一對【除了 snapshot.systems 裡有沒有 trtc 以外，每一格輸入完全相同】。
// mode: 'rows'（系統在、有可排的列）／'norows'（系統在、一列都排不出來）／'nosystem'（系統不在）
const coreSystemProbe = async mode => page.evaluate(m => {
  const now = Date.now() / 1000;
  const station = (state.lines || []).flatMap(line => line.stations || [])
    .find(s => (s.name || '').replace(/臺/g, '台') === '忠孝復興');
  const ln = (state.lines || []).find(line => (line.stations || []).includes(station));
  const si = ln ? ln.stations.indexOf(station) : -1;
  const trtcSystem = { systemId: metroCoreSystemIdForLine(ln) || 'trtc', trains: [],
    boards: [{ lineId: ln.id, stationIndex: si, rows: [{ state: 'approaching', direction: 1,
      destinationStationIndex: ln.stations.length - 1, arrivalEpoch: Math.round(now) + 120,
      match: 'unmatched' }] }] };
  state.metroCore = { polling: false, error: null, failedSince: null,
    snapshot: { schema: METRO_CORE_SCHEMA, generatedAt: now - 5, validUntil: now + 120,
      // 唯一的變因就是這一行。
      systems: m === 'nosystem' ? [{ systemId: 'krtc', trains: [], boards: [] }]
        : m === 'norows' ? [{ ...trtcSystem, boards: [{ lineId: ln.id, stationIndex: si, rows: [] }] }]
        : [trtcSystem] } };
  const view = metroCoreBoardView(station, state.lines, false);
  openBoard(station);
  const board = document.getElementById('board');
  return { viewNull: view === null, groups: view ? view.groups.length : -1,
    path: board.dataset.metroCore ? 'core' : board.dataset.trtcOfficial ? 'official' : 'sched',
    rows: board.querySelectorAll('.row').length,
    empty: /此時段無停靠班次/.test(board.textContent || '') };
}, mode);

const withSys = await coreSystemProbe('rows');
ok('前提：snapshot 有這個系統時，看板確實走 CORE 板且排得出列（否則下面那條是零資訊）',
  withSys.path === 'core' && withSys.groups > 0 && withSys.rows > 0,
  `path=${withSys.path} groups=${withSys.groups} rows=${withSys.rows}`);

const noSys = await coreSystemProbe('nosystem');
ok('Core snapshot 缺這個系統時，metroCoreBoardView 回 null（把決定權交還既有路徑）',
  noSys.viewNull === true, `viewNull=${noSys.viewNull} groups=${noSys.groups}`);
ok('Core snapshot 缺這個系統時，站看板不得變空，要退回官方板／班表',
  noSys.empty === false && noSys.rows > 0 && noSys.path !== 'core',
  `path=${noSys.path} rows=${noSys.rows} 顯示無停靠班次=${noSys.empty}`);

// 第二道門單獨必要的情境：系統【在】、但這一站一列都排不出來（深夜收班、或列全被濾掉）。
// 只有「空 groups 回 null」擋得住這一格——第一道門在這裡完全不會開火（系統存在）。
const noRows = await coreSystemProbe('norows');
ok('系統在但一列都排不出來時，也要退回既有路徑（不得宣稱「此時段無停靠班次」）',
  noRows.viewNull === true && noRows.empty === false && noRows.rows > 0,
  `viewNull=${noRows.viewNull} path=${noRows.path} rows=${noRows.rows} 顯示無停靠班次=${noRows.empty}`);

// 讓後面的判準拿到乾淨狀態（上面塞的合成 snapshot 不可留給下一節）。
await page.evaluate(() => { state.metroCore = null; });

// ── 第 4／5 項：Core 在線時不得誤報斷線 ──────────────────────────────────────
// 判準的反向對照成對出現：其餘輸入逐格相同，只差 Core 這一顆的死活。
// 🔴 staleNote 只長在班表備援板（renderFreqBoard）——Core 板與官方板的 renderer 裡
// 一個字都沒有。所以探針必須先把官方資料清掉逼看板退到那條路徑，否則兩邊都不顯示，
// 測試會以「假綠」的形式通過（第一版就是這樣，靠對照組才抓出來）。
const outageProbe = async coreOutage => page.evaluate(outage => {
  const now = Date.now() / 1000;
  state.trtcOfficialBoard = null;   // 逼退到班表備援板，staleNote 才可能被渲染
  // legacy 名冊刻意做成「看似超齡」——這正是分頁進背景／進隧道回來的第一瞬間。
  state.trtcOfficialRoster = { feedMode: 'official', vehicles: [{ line: 'BR', observedEpoch: now - 900 }] };
  state.trtcOfficialRosterHold = { reason: 'fetch-error', epoch: now };
  state.metroCore = {
    polling: false, error: outage ? new Error('x') : null,
    failedSince: outage ? Date.now() - 120000 : null,
    snapshot: { systems: [{ systemId: 'trtc' }],
      generatedAt: outage ? now - 900 : now - 5,
      validUntil: outage ? now - 600 : now + 120 }
  };
  const station = (state.lines || []).flatMap(l => l.stations || [])
    .find(s => (s.name || '').replace(/臺/g, '台') === '忠孝復興');
  openBoard(station);
  const board = document.getElementById('board');
  const note = board.querySelector('.sub.stale');
  return { path: board.dataset.metroCore ? 'core' : board.dataset.trtcOfficial ? 'official' : 'sched',
    shown: !!note, text: note ? note.textContent.trim().slice(0, 110) : '' };
}, coreOutage);

const live = await outageProbe(false);
ok('前提：探針真的走到班表備援板（否則兩項對照都是零資訊）', live.path === 'sched', `實際走 ${live.path}`);
ok('Core 在線時，站台看板不得掛出斷線提示', live.shown === false,
  live.shown ? `仍然掛出：${live.text}` : 'legacy 名冊看似超齡 15 分鐘也不誤報');

const down = await outageProbe(true);
ok('對照組：Core 真的斷了才掛提示', down.shown === true,
  down.shown ? down.text : '❌ 判準沒有牙——兩邊都不顯示等於直接關掉這個功能');
ok('自家／網路造成時，文案不點名營運單位',
  down.shown && !down.text.includes('臺北捷運即時訊號中斷'), down.text);

// ── 第 6／7 項：橫幅的歸因 ───────────────────────────────────────────────────
// 這是實際最常走到的路徑：Core 的快照裡整個沒有 trtc 時（正式站 2026-08-29 就是這樣，
// /health 回 `canonical 缺少 trtc`），metroCoreTrtcFeedState() 回 null ⇒ Core 那道閘門
// 被繞過 ⇒ 落到未設防的舊判準 ⇒ 掛出「臺北捷運即時訊號中斷」。我們自己的服務發不出來，
// 帳卻算到營運單位頭上。兩組輸入除了「歸因」這一個變因之外逐格相同。
const bannerProbe = async holdReason => page.evaluate(reason => {
  const now = Date.now() / 1000;
  state.metroCore = { polling: false, error: null, failedSince: null,
    snapshot: { systems: [{ systemId: 'krtc' }], generatedAt: now, validUntil: now + 120 } };
  state.trtcOfficialRoster = { feedMode: reason === 'feed-outage' ? 'outage' : 'official',
    vehicles: [{ line: 'BR', observedEpoch: now - 900 }] };
  state.trtcOfficialRosterHold = { reason, epoch: now };
  const entries = trtcOutageEntries();
  return { n: entries.length, title: entries.length ? entries[0].title : '',
    desc: entries.length ? entries[0].desc.slice(0, 80) : '' };
}, holdReason);

const selfCaused = await bannerProbe('fetch-error');
ok('前提：這個情境真的會掛出橫幅', selfCaused.n === 1, `entries=${selfCaused.n}`);
ok('我們自己沒收到時，橫幅不點名臺北捷運',
  selfCaused.n === 1 && !selfCaused.title.includes('臺北捷運'), selfCaused.title);

const upstream = await bannerProbe('feed-outage');
ok('對照組：上游自報斷訊時，仍然照實點名臺北捷運',
  upstream.n === 1 && upstream.title.includes('臺北捷運'),
  upstream.n === 1 ? upstream.title : '❌ 沒有掛出橫幅——那就不是「不點名」而是整個關掉了');

await browser.close();
server.close();

const failed = results.filter(r => !r.pass);
console.log(`\n總計 ${results.length} 項，通過 ${results.length - failed.length}，失敗 ${failed.length}`);
if (pageErrors.length) console.log(`頁面錯誤 ${pageErrors.length} 則：${pageErrors[0].slice(0, 200)}`);
process.exit(failed.length ? 1 : 0);
