#!/usr/bin/env node
// Metro Core 前端退回防線的【行為】驗收（真 Chromium，餵造測 snapshot）。
//
// 為什麼另開一支：scripts/verify_metro_core_bridge.mjs 是純靜態契約（regex／VM 抽函式），
// 它證得了「這幾行程式碼在」，證不了「空快照會不會短路 legacy」「跟隨掉一批會不會被踢」。
// 這支專門補那一半，每一條都要能被突變測試打紅。
//
// 語料：scripts/fixtures/metro_core_snapshot.json 是 2026-08-21 21:26 從正式 KV 取下的
//      **真實** canonical snapshot（trtc 101 台／320 列、krtc 28 台／77 列），
//      跑的時候把所有 epoch 平移到「現在」。用真的比手捏的重要，因為 P2-9 的比例門檻
//      要對得上真實的身分覆蓋率（trtc 70.6%、krtc 7.8%）。
//
// 用法：node scripts/verify_metro_core_defense.mjs
//       PORT=<port> 指定埠（預設 5723；30+ worktree 並行時硬編埠幾乎一定撞到別人，
//       所以 G0 會逐 byte 核對 server 提供的 index.html 就是這棵樹的）
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5723);
const req = createRequire(fs.existsSync(path.join(ROOT, 'node_modules/playwright'))
  ? path.join(ROOT, 'package.json') : '/Users/xuxiang/Code/捷運小動畫/package.json');
const { chromium } = req('playwright');

const BASE_SNAPSHOT = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/metro_core_snapshot.json'), 'utf8'));
const REAL_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 突變體：把 P0-1 改回事故版（空陣列短路 legacy）。用來證明 (b) 那條判準真的有牙。
const MUTATED_HTML = REAL_HTML
  .replace('  if (!system) return null; // 🔴 P0-1', '  if (!system) return []; // MUTATION P0-1')
  .replace('  return out.length ? out : null;', '  return out; // MUTATION P0-1');
if (MUTATED_HTML === REAL_HTML) throw new Error('P0-1 突變沒有命中——先確認那兩行還在');

// 突變體 2：把 freqTrainsAt 改回 3dad2e5 的形狀（不往外傳 core／systemId）。
const MUTATED_HIT_HTML = REAL_HTML
  .replace(`    if (inside) hits.push({ ln: h.ln, k: h.k, tr: h.tr, core: !!h.core,
      systemId: h.systemId, vehicleId: h.vehicleId, officialNo: h.officialNo || '', dist: d });`,
    `    if (inside) hits.push({ ln: h.ln, k: h.k, tr: h.tr, vehicleId: h.vehicleId,
      officialNo: h.officialNo || '', dist: d }); // MUTATION freqTrainsAt`)
  .replace(`    return best ? [{ ln: best.ln, k: best.k, tr: best.tr, core: !!best.core,
      systemId: best.systemId, vehicleId: best.vehicleId, officialNo: best.officialNo || '', dist: bd }] : [];`,
    `    return best ? [{ ln: best.ln, k: best.k, tr: best.tr, dist: bd }] : []; // MUTATION freqTrainsAt`);
if (MUTATED_HIT_HTML === REAL_HTML) throw new Error('freqTrainsAt 突變沒有命中');

// 突變體 3：拿掉共站辨線那道「看板列的線必須等於車的線」檢查。
const MUTATED_XLINE_HTML = REAL_HTML
  .replace('  if (!train || String(train.lineId) !== String(board.lineId)) return null;',
    '  if (!train) return null; // MUTATION crossline');
if (MUTATED_XLINE_HTML === REAL_HTML) throw new Error('共站辨線突變沒有命中');

// 突變體 4：拿掉 P0-2 的收班豁免（回到「只看自己腰斬」）。(j) 的 J3 必須因此轉紅——
// 少了這一發，J3 有可能只是因為收班時段根本沒走到判定而全綠（假綠）。
const MUTATED_WINDDOWN_HTML = REAL_HTML
  .replace('    if (judgeable && !windingDown && cur < base * METRO_CORE_COUNT_DROP)',
    '    if (/* MUTATION winddown */ judgeable && cur < base * METRO_CORE_COUNT_DROP)');
if (MUTATED_WINDDOWN_HTML === REAL_HTML) throw new Error('收班豁免突變沒有命中');

// 突變體 5〜7：三發專打「徽章／吐司會不會對使用者說謊」。這三條判準（A7／D4＋J6／E3）
// 2026-08-28 起因為多語上線、瀏覽器語系是 en-US 而全部假紅了一週，語系釘死之後必須重新
// 證明它們還有牙——否則「釘死語系」與「把判準拿掉」在計分板上長得一模一樣。

// 5：健康態下徽章不再宣告「官方即時」（trains > 0 這條路整條走不到）。A7 必須轉紅。
const MUTATED_BADGE_LIVE_HTML = REAL_HTML
  .replace('    if (trains > 0) {', '    if (trains > 999) { // MUTATION badge-live');
if (MUTATED_BADGE_LIVE_HTML === REAL_HTML) throw new Error('徽章健康態突變沒有命中');

// 6：Core 一台都生不出來、備案卻有車時，徽章謊稱「官方即時」且不上 anom——正是 P0-5 要防的
//    事故形態。D4 與 J6 必須轉紅。
const MUTATED_BADGE_LIE_HTML = REAL_HTML
  .replace(`      el.classList.add('anom');
      el.classList.remove('est');
      el.textContent = t('即時資料異常');
      el.title = t('即時模型這一輪一台列車都沒有回報，已改用官方名冊或班表繼續顯示')`,
    `      el.classList.remove('anom'); // MUTATION badge-lie
      el.classList.remove('est');
      el.textContent = t('官方即時');
      el.title = t('即時模型這一輪一台列車都沒有回報，已改用官方名冊或班表繼續顯示')`);
if (MUTATED_BADGE_LIE_HTML === REAL_HTML) throw new Error('徽章說謊突變沒有命中');

// 7：跟隨退場吐司回到 994a9ce 之前的錯誤歸因（Core 車也講「官方名冊已更新」）。E3 必須轉紅。
const MUTATED_TOAST_HTML = REAL_HTML
  .replace(`      showToast(t(core ? '這台車已超過 30 秒不在即時模型中，已結束跟隨'
        : '官方名冊已更新，已結束這台車的跟隨'));`,
    `      showToast(t('官方名冊已更新，已結束這台車的跟隨')); // MUTATION toast`);
if (MUTATED_TOAST_HTML === REAL_HTML) throw new Error('退場文案突變沒有命中');

// 突變體 8：拿掉站列版本閘門的出口（metroCoreLineBlocked 不再看 stationMismatch）。
// 用來證明 (k) 那條判準真的是這道閘門擋下來的，不是別的閘門順手擋到。
const MUTATED_STATIONS_HTML = REAL_HTML
  .replace('  if (stations) return stations.reason;', '  if (false && stations) return stations.reason; // MUTATION stations');
if (MUTATED_STATIONS_HTML === REAL_HTML) throw new Error('站列版本閘門突變沒有命中');

// 突變體 9：拿掉「Core 單一方向缺列時，只補該方向班表」的出口。
const MUTATED_DIRECTION_FALLBACK_HTML = REAL_HTML
  .replace('      groups.push(...metroCoreLegacyGroupsForEntry(entry, officialDirections));',
    '      /* MUTATION missing-direction fallback */');
if (MUTATED_DIRECTION_FALLBACK_HTML === REAL_HTML) throw new Error('看板缺方向退路突變沒有命中');

// 🔴 Leaflet 刻意【不】攔截，走真 CDN：index.html 對它掛了 SRI integrity，
//    塞本機那份 leaflet.js 進去會因為雜湊不符被瀏覽器擋掉，`L` undefined ⇒ boot 拋錯 ⇒
//    這支腳本從寫出來的那一刻就不可能綠（2026-08-10 已經踩過一次同款）。
//    要塞就得先把 integrity 屬性拿掉，那又會讓「驗的是這棵樹的 index.html」這道 G0 失效。
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'application/javascript',
  '.mjs': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

let servedHtml = REAL_HTML;
function serve(port) {
  const server = http.createServer((request, response) => {
    const u = new URL(request.url, `http://127.0.0.1:${port}/`);
    if (u.pathname.startsWith('/api/')) { // 全部餵空：讓 legacy 走到班表路徑，結果才可重現
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ rows: [], trains: [], list: [], vehicles: [], src: null, boardPos: null })); return;
    }
    if (u.pathname === '/' || u.pathname === '/index.html') {
      response.writeHead(200, { 'content-type': MIME['.html'] }); response.end(servedHtml); return;
    }
    const file = path.resolve(ROOT, '.' + decodeURIComponent(u.pathname));
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404); response.end('not found'); return;
    }
    response.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(server)); });
}

// ── snapshot 造測工廠：把真語料平移到「現在」，再套變形 ─────────────────────
function shiftSnapshot(source, deltaSec) {
  const clone = JSON.parse(JSON.stringify(source));
  const shift = v => (v == null || !Number.isFinite(Number(v))) ? v : Number(v) + deltaSec;
  clone.generatedAt = shift(clone.generatedAt);
  clone.sourceAt = shift(clone.sourceAt);
  clone.validUntil = shift(clone.validUntil);
  for (const system of clone.systems) {
    for (const train of system.trains) {
      for (const point of train.trajectory) point.epoch = shift(point.epoch);
      if (train.nextCall) {
        train.nextCall.arrivalEpoch = shift(train.nextCall.arrivalEpoch);
        train.nextCall.departureEpoch = shift(train.nextCall.departureEpoch);
      }
      train.retireAt = shift(train.retireAt);
    }
    for (const board of system.boards) for (const row of board.rows) row.arrivalEpoch = shift(row.arrivalEpoch);
  }
  return clone;
}
// 🔴 頁面時鐘位移（2026-08-22）。原本整支腳本吃真實牆鐘，於是 B2（「既有路徑真的有車可畫」
//    這個正向對照）與 D4（徽章要顯示異常態）**只有在營運時段跑才會綠**——深夜跑就假紅，
//    而深夜正是需要驗「末班收車」的時候。改成把頁面的 Date 整個平移到指定的一天中時刻，
//    伺服端語料也用同一個位移產生，兩邊對得起來；時間照樣往前流（不是凍結），
//    輪詢與 30 秒寬限那些計時邏輯全都照常。
let CLOCK_SHIFT_SEC = 0;
const PEAK_SEC = 8 * 3600 + 30 * 60;   // 08:30：兩家都在營運，備案一定有車
const CLOSED_SEC = 2 * 3600 + 30 * 60; // 02:30：北捷末班早已收完，備案一定 0 台
const pageNowSec = () => Math.floor(Date.now() / 1000) + CLOCK_SHIFT_SEC;
// 把「現在」平移到今天的 secOfDay（台北時間）。回傳實際用到的位移。
function shiftClockToSecOfDay(secOfDay) {
  const now = new Date();
  const taipei = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const cur = taipei.getHours() * 3600 + taipei.getMinutes() * 60 + taipei.getSeconds();
  CLOCK_SHIFT_SEC = Math.round(secOfDay - cur);
  return CLOCK_SHIFT_SEC;
}
let serial = 0;
function buildSnapshot(variant) {
  const now = pageNowSec();
  const snapshot = shiftSnapshot(BASE_SNAPSHOT, now - Number(BASE_SNAPSHOT.generatedAt));
  snapshot.validUntil = now + 300;              // 語料只給 95 秒有效期，測試期間要撐得住
  snapshot.revision = `test-${now}-${serial++}`; // 每次不同，避免 ETag/304 讓 poll 提早返回
  if (variant === 'healthy') return snapshot;
  if (variant === 'emptyLine') { // 某一條線 0 台（車與看板都清掉），其他線照舊
    for (const system of snapshot.systems) {
      if (system.systemId !== 'trtc') continue;
      system.trains = system.trains.filter(t => String(t.lineId) !== 'BL');
      system.boards = system.boards.filter(b => String(b.lineId) !== 'BL');
    }
    return snapshot;
  }
  if (variant === 'unknownLine') { // 命名契約破了：BL 改叫 BLUE
    for (const system of snapshot.systems) {
      if (system.systemId !== 'trtc') continue;
      for (const t of system.trains) if (String(t.lineId) === 'BL') t.lineId = 'BLUE';
      for (const b of system.boards) if (String(b.lineId) === 'BLUE' || String(b.lineId) === 'BL') b.lineId = 'BLUE';
    }
    return snapshot;
  }
  if (variant === 'allEmpty') { // 「新鮮但很空」：schema 合格、0 台、0 列
    for (const system of snapshot.systems) { system.trains = []; system.boards = []; }
    return snapshot;
  }
  if (variant === 'halvedBL') { // BL 從 21 台掉到 3 台（腰斬），其餘不動
    for (const system of snapshot.systems) {
      if (system.systemId !== 'trtc') continue;
      const keep = system.trains.filter(t => String(t.lineId) === 'BL').slice(0, 3).map(t => String(t.vehicleId));
      system.trains = system.trains.filter(t => String(t.lineId) !== 'BL' || keep.includes(String(t.vehicleId)));
      const alive = new Set(system.trains.map(t => String(t.vehicleId)));
      for (const b of system.boards) for (const row of b.rows) if (row.vehicleId != null && !alive.has(String(row.vehicleId))) {
        row.vehicleId = null; row.match = 'unmatched'; // 車不在了，看板列也不能再指過去（否則 schema 驗證會整包退）
      }
    }
    return snapshot;
  }
  if (variant === 'crossLine') { // 共站辨線：板南線看板的某一列，指到文湖線的車
    const sys = snapshot.systems.find(s => s.systemId === 'trtc');
    const br = sys.trains.find(t => String(t.lineId) === 'BR');
    // 佈題的兩列都要落在「看板顯示窗」與「P2-9 統計窗」的交集內：太近會在跑測試的幾秒內
    // 變成已到站而消失，太遠(>2 小時)則兩邊都不收 ⇒ I3/I4 會變成量不到東西的空判準。
    const near = Number(snapshot.generatedAt) + 90, far = Number(snapshot.generatedAt) + 3000;
    for (const board of sys.boards) {
      if (String(board.lineId) !== 'BL') continue;
      const seen = new Map(); // 每個 (方向|終點) 取最早那一列——一定會被 byDest 的 slice(0,2) 留下
      for (const row of board.rows) {
        if (row.vehicleId == null || row.state === 'departed' ||
            Number(row.arrivalEpoch) < near || Number(row.arrivalEpoch) > far) continue;
        const key = `${row.direction}|${row.destinationStationIndex}`;
        if (!seen.has(key)) seen.set(key, row);
      }
      if (seen.size < 2) continue;
      const [bad, good] = [...seen.values()];
      crossLineCase = { stationIndex: Number(board.stationIndex), badRowId: String(bad.rowId),
        goodRowId: String(good.rowId), goodVehicleId: String(good.vehicleId), brVehicleId: String(br.vehicleId) };
      bad.vehicleId = crossLineCase.brVehicleId; bad.match = 'inferred';
      return snapshot;
    }
    throw new Error('語料裡找不到可用的 BL 看板（需要兩個不同方向／終點且未來到站的已配對列）');
  }
  if (variant === 'missingDirection') {
    const sys = snapshot.systems.find(s => s.systemId === 'trtc');
    for (const board of sys.boards) {
      const live = board.rows.filter(row => row.state !== 'departed' &&
        Number(row.arrivalEpoch) >= now - 30 && Number(row.arrivalEpoch) <= now + 7200);
      const directions = [...new Set(live.map(row => Number(row.direction)).filter(x => x === 1 || x === 2))];
      if (directions.length < 2) continue;
      missingDirectionCase = { lineId: String(board.lineId), stationIndex: Number(board.stationIndex),
        missingDirection: directions[0], keptDirection: directions[1] };
      board.rows = board.rows.filter(row => Number(row.direction) !== missingDirectionCase.missingDirection);
      return snapshot;
    }
    throw new Error('語料裡找不到同時有雙方向列的 Core 看板');
  }
  if (variant === 'stationsMatch' || variant === 'stationsShift') {
    // 站列版本閘門的語料：逐線帶上 {id, stationCount}。counts 是【從頁面自己讀回來的】
    // stations.length（不是照抄 data/trtc.json），否則判準會與被測物共用同一份推導假設。
    if (!pageLineCounts) throw new Error('先讓 (k) 從頁面讀到逐線站數');
    for (const system of snapshot.systems) {
      const sysId = String(system.systemId), prefix = sysId + ':';
      const entries = Object.entries(pageLineCounts).filter(([key]) => key.startsWith(prefix));
      if (!entries.length) continue;
      system.lines = entries.map(([key, n]) => ({ id: key.slice(prefix.length),
        stationCount: (variant === 'stationsShift' && key === 'trtc:R') ? n - 1 : n }))
        .sort((a, b) => a.id.localeCompare(b.id));
    }
    return snapshot;
  }
  if (variant === 'dropFollow') return snapshot; // 由呼叫端在 evaluate 內指定要拿掉哪一台
  throw new Error('unknown variant ' + variant);
}
let crossLineCase = null;
let missingDirectionCase = null;
let pageLineCounts = null; // (k) 從頁面讀回的逐線站數：`sysId:lineId` -> ln.stations.length

let currentVariant = 'healthy';
let dropVehicleId = null;
function snapshotBody() {
  const snapshot = buildSnapshot(currentVariant === 'dropFollow' ? 'healthy' : currentVariant);
  if (currentVariant === 'dropFollow' && dropVehicleId) {
    for (const system of snapshot.systems) {
      system.trains = system.trains.filter(t => String(t.vehicleId) !== String(dropVehicleId));
      for (const b of system.boards) for (const row of b.rows) if (String(row.vehicleId) === String(dropVehicleId)) {
        row.vehicleId = null; row.match = 'unmatched';
      }
    }
  }
  return JSON.stringify(snapshot);
}

// ── 判定收集 ───────────────────────────────────────────────────────────────
const results = [];
const check = (name, pass, detail) => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`); };

// 🔴 判準本體抽出來共用：正判準與它的突變對照必須是【同一個表達式】。分開手寫兩份的話，
//    改了一邊沒改另一邊，對照就不再證明「這條判準會因為這個缺陷轉紅」（心得 37 同族）。
//    這三條讀的都是使用者眼睛看得到的那行字——語系已在 newPage 釘死 zh-TW，A0 負責看門。
const badgeSaysLive = b => !!b && b.hidden === false && /官方即時/.test(b.text);
const badgeSaysAnom = b => !!b && b.anom === true && /異常/.test(b.text);
const toastNamesRealCause = list => list.some(t => /不在即時模型中，已結束跟隨/.test(t)) &&
  !list.some(t => t.includes('官方名冊已更新'));

// 🔴 語系必須釘死（2026-08-29）。39ad220 上多語之後，index.html 的 I18N_LANG 會依
//    navigator.languages 決定，而 Playwright 的 Chromium 預設是 en-US ⇒ 徽章變成
//    "Official live"、退場吐司變成英文，A7／D4／E3／J6 這四條「徽章不准謊稱即時資料正常」
//    的判準全部假紅（實測 41/50，與產品回歸長得一模一樣）。
//    兩道一起下：
//      * 網址 ?lang=zh-TW —— 這是 index.html 自己的最高優先語系開關（query > localStorage >
//        navigator），也是唯一能決定 I18N_LANG 的正牌入口；它在 top-level 就讀完，
//        boot 途中 clearFollow() 清掉 query string 也來不及影響它。
//      * context locale: 'zh-TW' —— 讓 navigator.language 與所有沒帶 locale 參數的
//        Intl／toLocaleString 也不隨跑測試的機器語系漂移。
//    這裡刻意【不】改成「驗結構旗標而不驗文案」：這四條守的就是「使用者眼睛看到的那行字
//    有沒有說謊」，改驗 dataset 會讓「分支對了但字錯了」整類缺陷穿過去。文案耦合的代價
//    由 A0 那道具名前置閘門承擔——語系釘不住時它會直接指名，不會讓四條判準各自亂紅。
const PAGE_LOCALE = 'zh-TW';
async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: PAGE_LOCALE });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  await page.addInitScript(shiftMs => {
    localStorage.setItem('trainmap-howto-seen', '1'); // 首訪教學卡會蓋住地圖與看板
    window.__toasts = [];
    if (shiftMs) { // 平移頁面時鐘（時間照常流動，只是原點被搬到指定時刻）
      const Real = Date;
      const Fake = function (...args) {
        if (!(this instanceof Fake)) return new Real(Real.now() + shiftMs).toString();
        return args.length === 0 ? new Real(Real.now() + shiftMs) : new Real(...args);
      };
      Fake.prototype = Real.prototype;
      Fake.now = () => Real.now() + shiftMs;
      Fake.parse = Real.parse; Fake.UTC = Real.UTC;
      window.Date = Fake;
    }
  }, CLOCK_SHIFT_SEC * 1000);
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith('/v1/metro/snapshot')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        headers: { 'cache-control': 'no-store' }, body: snapshotBody() });
    }
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html?metrocore=1&lang=${PAGE_LOCALE}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try {
    // 🔴 一定要等到【兩家】的 _times 都載完再建線：只等 s.data 的話 ln.times 會是 null，
    //    prepFreqTimes 直接 return ⇒ 那條線沒有 _tt ⇒ 看板永遠「此時段無停靠班次」，
    //    而那看起來會跟「同名站修法把它濾光了」一模一樣（假紅）。
    await page.waitForFunction(() => typeof state !== 'undefined' && state.systems &&
      state.systems.some(s => s.id === 'mrt' && s.data && s._times) &&
      state.systems.some(s => s.id === 'tmrt' && s.data && s._times), null, { timeout: 120000 });
  } catch (e) {
    // 逾時訊息本身零資訊：真因幾乎都是 boot 靜默拋錯，把 pageerror 印出來才看得到。
    console.error('waitReady 逾時；pageerror=' + JSON.stringify(errors.slice(0, 5)));
    throw e;
  }
  // 🔴 切群組一定要走頁面自己的 selectGroup()，不要手工塞 state.lines：
  //    boot 還在跑的時候會用還原的群組覆蓋掉手工設定，`state.lines` 於是變成別的群組——
  //    然後 updateCount() 裡那條「跟隨的線不在 state.lines 就 clearFreqFollow()」會無聲拆掉跟隨，
  //    看起來就像寬限失效（第一版就是這樣紅的，而且是間歇性的，最難查的那種）。
  await page.waitForTimeout(1500); // 讓 boot 自己的群組還原先跑完
  await page.evaluate(() => { const g = GROUPS.find(x => x.id === 'metro'); if (state.group !== 'metro') selectGroup(g, false); });
  await page.waitForFunction(() => (state.lines || []).some(l => metroCoreSystemIdForLine(l) === 'trtc'), null, { timeout: 60000 });
  await page.evaluate(() => {
    // metroCoreSnapshotLive 需要 trtcOfficialBoardRealNow()：時鐘必須真的在「現在」、1×、播放中。
    state.clockAtNow = true; state.playing = true; state.speedMult = 1; state._scrubTime = false;
    state.simSec = nowSecOfDay();
    state.metroCore.snapshot = null; state.metroCore.etag = null; state.metroCore.error = null;
    state.metroCore.blockedLines = {}; state.metroCore.blockedSystems = {};
    state.metroCore.stationMismatch = {};
    __railMetroCore.resetGates();
    const orig = window.showToast;
    window.showToast = function (msg) { window.__toasts.push(String(msg)); return orig.apply(this, arguments); };
  });
  return { page, errors };
}

const pollOnce = page => page.evaluate(async () => {
  state.simSec = nowSecOfDay(); // 每輪重新釘住時鐘：頁面自己的計時器會把 simSec 推著走
  return await __railMetroCore.poll();
});

const lineStats = page => page.evaluate(() => {
  const out = {};
  for (const ln of state.lines) {
    const sysId = metroCoreSystemIdForLine(ln);
    if (!sysId) continue;
    const core = metroCoreItemsForLine(ln);
    out[sysId + ':' + ln.id] = { core: core === null ? null : core.length, legacy: metroCoreLegacyCountForLine(ln) };
  }
  return { lines: out, lineIds: state.lines.map(l => l.id), status: __railMetroCore.status(), badge: (() => {
    const el = document.getElementById('metroBadge');
    return el ? { hidden: el.hidden, text: el.textContent, anom: el.classList.contains('anom') } : null;
  })() };
});

let healthyMatched = null; // (a) 量到的 trtc 已配對列數；(i) 的 I4 拿它當對照基準
async function main() {
  const diskMd5 = createHash('md5').update(fs.readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
  const server = await serve(PORT);
  const servedMd5 = createHash('md5').update(Buffer.from(
    await (await fetch(`http://127.0.0.1:${PORT}/index.html`)).arrayBuffer())).digest('hex');
  console.log(`G0 target=${ROOT}\n   disk=${diskMd5}\n   serve=${servedMd5}`);
  if (diskMd5 !== servedMd5) { console.error('G0 FAIL：server 提供的不是這棵樹的 index.html'); process.exit(1); }

  const browser = await chromium.launch({ headless: true });
  let allErrors = [];
  // 只讀徽章的輕量探針：徽章類的突變對照要跑的是【同一個情境、同一個述詞】，
  // 只有 index.html 那一行不同。回傳 lineStats 的 badge，與正判準讀的是同一個來源。
  const badgeUnder = async (html, variant) => {
    servedHtml = html; currentVariant = variant;
    const { page, errors } = await newPage(browser);
    await pollOnce(page);
    const s = await lineStats(page);
    await page.close();
    servedHtml = REAL_HTML; currentVariant = 'healthy';
    allErrors = allErrors.concat(errors.filter(e => !/MUTATION/.test(e)));
    return s.badge;
  };
  // 全部情境都跑在同一個「營運中」的時刻（08:30 台北），不吃跑測試當下的牆鐘：
  // 這支腳本裡有兩條判準（B2 的正向對照、D4 的異常徽章）依賴「這個時段真的有車」，
  // 深夜跑會假紅。(j) 會自己把時鐘搬到收班時段再搬回來。
  console.log(`G0' 頁面時鐘釘在 08:30（位移 ${shiftClockToSecOfDay(PEAK_SEC)} 秒）`);
  try {
    // ── (a) 健康快照 → core 路徑畫車 ────────────────────────────────────
    currentVariant = 'healthy';
    {
      const { page, errors } = await newPage(browser);
      // 具名前置閘門：下面 A7／D4／E3／J6 全部在讀「使用者看到的那行中文」，語系一漂
      // 那四條會同時假紅而且各自報不同的字（39ad220 當天就是這樣，看起來像產品回歸）。
      // 把前提抽出來單獨判一次：紅的時候一眼就知道是語系沒釘住，不是徽章壞了。
      const langState = await page.evaluate(() => ({ i18n: window.__i18n && window.__i18n.lang,
        doc: document.documentElement.lang, nav: navigator.language,
        sample: window.__i18n ? window.__i18n.t('官方即時') : null }));
      check('A0 語系釘死在 zh-TW（A7／D4／E3／J6 的文案判準前提）',
        langState.i18n === 'zh-TW' && langState.doc === 'zh-TW' && langState.sample === '官方即時',
        JSON.stringify(langState));
      const ok = await pollOnce(page);
      const s = await lineStats(page);
      const trtcLines = Object.entries(s.lines).filter(([k]) => k.startsWith('trtc:'));
      const coreLines = trtcLines.filter(([, v]) => v.core !== null);
      const coreTrains = coreLines.reduce((sum, [, v]) => sum + v.core, 0);
      check('A1 健康快照被接受', ok === true && !s.status.error, `poll=${ok} error=${s.status.error}`);
      check('A2 北捷九線全部由 Core 驅動', coreLines.length === 9 && trtcLines.length === 9,
        `core 驅動 ${coreLines.length}/${trtcLines.length} 條：${coreLines.map(([k, v]) => k.slice(5) + '=' + v.core).join(' ')}`);
      check('A3 Core 畫得出足夠台數（分母正向對照）', coreTrains >= 40, `${coreTrains} 台`);
      await page.evaluate(() => window.__map.setView([25.048, 121.545], 12, { animate: false })); // 把台北放進視窗，_freqHits 只收在畫面內的
      await page.waitForTimeout(1200);
      const hits = await page.evaluate(() => (state._freqHits || []).filter(h => h.core).length);
      check('A4 畫面命中清單裡真的有 Core 車（不是只在資料層）', hits > 0, `_freqHits core=${hits}`);
      const ratio = s.status.matchRatio || {};
      healthyMatched = ratio.trtc && ratio.trtc.matched;
      check('A5 P2-9 逐系統身分覆蓋率算得出來且分母>0',
        ratio.trtc && ratio.trtc.total > 0 && ratio.krtc && ratio.krtc.total > 0,
        `trtc ${ratio.trtc && ratio.trtc.matched}/${ratio.trtc && ratio.trtc.total}、krtc ${ratio.krtc && ratio.krtc.matched}/${ratio.krtc && ratio.krtc.total}`);
      check('A6 P2-9 覆蓋率過門檻的系統不擋、不過的擋下（真語料：trtc 70.6% 過、krtc 7.8% 不過）',
        !s.status.blockedSystems.trtc && !!s.status.blockedSystems.krtc &&
        Object.entries(s.lines).filter(([k]) => k.startsWith('krtc:')).every(([, v]) => v.core === null),
        `blockedSystems=${JSON.stringify(s.status.blockedSystems)}`);
      check('A7 徽章顯示「官方即時」且不隱藏（(d) 的反向對照）', badgeSaysLive(s.badge), JSON.stringify(s.badge));
      allErrors = allErrors.concat(errors);
      await page.close();
    }

    // ── (a') 突變對照：健康態徽章不再宣告「官方即時」，A7 必須轉紅 ────────────
    {
      const badge = await badgeUnder(MUTATED_BADGE_LIVE_HTML, 'healthy');
      check('A8 突變對照：健康態不再走「官方即時」那條路時，A7 必須轉紅',
        !badgeSaysLive(badge), `舊行為下 badge=${JSON.stringify(badge)}`);
    }

    // ── (b) 某線 0 台 → 該線退回 legacy；其他線不受影響 ──────────────────
    currentVariant = 'emptyLine';
    {
      const { page, errors } = await newPage(browser);
      await pollOnce(page);
      const s = await lineStats(page);
      const bl = s.lines['trtc:BL'], r = s.lines['trtc:R'];
      check('B1 0 台的那條線回 null（不得用空陣列短路 legacy）', bl && bl.core === null, JSON.stringify(bl));
      check('B2 那條線的既有路徑真的有車可畫（正向對照，否則 B1 是空話）', bl && bl.legacy > 0, `legacy=${bl && bl.legacy} 台`);
      check('B3 其他線仍由 Core 驅動（不是整包退掉）', r && r.core > 0, JSON.stringify(r));
      allErrors = allErrors.concat(errors);
      await page.close();
    }

    // ── (b') 突變對照：把 P0-1 改回舊行為，B1 必須轉紅 ───────────────────
    {
      servedHtml = MUTATED_HTML;
      const { page, errors } = await newPage(browser);
      await pollOnce(page);
      const s = await lineStats(page);
      const bl = s.lines['trtc:BL'];
      check('B4 突變對照：P0-1 改回舊行為後，B1 的判準必須轉紅', bl && bl.core === 0,
        `舊行為下 core=${bl && bl.core}（0＝空陣列短路，正是事故形態）`);
      allErrors = allErrors.concat(errors.filter(e => !/MUTATION/.test(e)));
      await page.close();
      servedHtml = REAL_HTML;
    }

    // ── (c) 未知 lineId → 警告＋整包退回 ────────────────────────────────
    currentVariant = 'unknownLine';
    {
      const { page, errors } = await newPage(browser);
      const ok = await pollOnce(page);
      const s = await lineStats(page);
      check('C1 契約外的 lineId 讓這包被退掉', ok === false && /lineId 契約外/.test(String(s.status.error)), `error=${s.status.error}`);
      check('C2 警告裡指名是哪一條', s.status.lineIdWarn && s.status.lineIdWarn.unknown.includes('trtc:BLUE'),
        JSON.stringify(s.status.lineIdWarn && s.status.lineIdWarn.unknown));
      check('C3 退包後所有線都回到既有路徑', Object.values(s.lines).every(v => v.core === null),
        `core 驅動線數=${Object.values(s.lines).filter(v => v.core !== null).length}`);
      check('C4 徽章沒有隱藏、也沒有謊稱「官方即時」',
        s.badge && s.badge.hidden === false && !/^官方即時$/.test(s.badge.text), JSON.stringify(s.badge));
      check('C5 開機自檢：手上的線 id 與契約表一致', s.status.lineIdSelfCheck && s.status.lineIdSelfCheck.ok,
        JSON.stringify(s.status.lineIdSelfCheck));
      allErrors = allErrors.concat(errors);
      await page.close();
    }

    // ── (d) 全空快照（新鮮但 0 台）→ 徽章異常態、絕不隱藏 ────────────────
    currentVariant = 'allEmpty';
    {
      const { page, errors } = await newPage(browser);
      const ok = await pollOnce(page);
      const s = await lineStats(page);
      check('D1 「新鮮但很空」的快照本身仍通過 schema（所以只有行為閘門擋得住它）', ok === true, `poll=${ok}`);
      check('D2 每一條線都退回既有路徑', Object.values(s.lines).every(v => v.core === null),
        `core 驅動線數=${Object.values(s.lines).filter(v => v.core !== null).length}`);
      check('D3 徽章不得隱藏', s.badge && s.badge.hidden === false, JSON.stringify(s.badge));
      check('D4 徽章顯示異常態而不是「官方即時」', badgeSaysAnom(s.badge), JSON.stringify(s.badge));
      allErrors = allErrors.concat(errors);
      await page.close();
    }

    // ── (d') 突變對照：徽章謊稱「官方即時」，D4 必須轉紅 ───────────────────
    {
      const badge = await badgeUnder(MUTATED_BADGE_LIE_HTML, 'allEmpty');
      check('D5 突變對照：Core 0 台卻謊稱「官方即時」時，D4 必須轉紅',
        !badgeSaysAnom(badge), `舊行為下 badge=${JSON.stringify(badge)}`);
    }

    // ── (e) 跟隨中的車缺席一批 → 30 秒寬限；超過才退場且文案正確（含突變對照）──────
    //    佈題整段抽成函式：E4 的突變對照必須跑【逐格相同】的流程，只差 index.html 那一行，
    //    否則對照證不了「E3 會因為文案回到錯誤歸因而轉紅」。
    const followDropRun = async () => {
      currentVariant = 'healthy';
      const { page, errors } = await newPage(browser);
      await pollOnce(page);
      const picked = await page.evaluate(() => {
        const ln = state.lines.find(l => metroCoreSystemIdForLine(l) === 'trtc' && String(l.id) === 'BL');
        const items = metroCoreItemsForLine(ln);
        if (!items || !items.length) return null;
        // 挑剩餘壽命最長的那台：retireAt 快到的車寬限期內本來就會自然退場，測不到寬限本身。
        const item = items.slice().sort((a, b) => Number(b.train.retireAt || 0) - Number(a.train.retireAt || 0))[0];
        window.__toasts.length = 0;
        applyFreqFollow({ ln, core: true, systemId: 'trtc', vehicleId: item.vehicleId });
        return state.freqFollow ? { vehicleId: item.vehicleId, following: true,
          liveSec: Math.round(Number(item.train.retireAt) - Date.now() / 1000) } : null;
      });
      dropVehicleId = picked && picked.vehicleId;
      currentVariant = 'dropFollow';
      await pollOnce(page);
      await page.waitForTimeout(500); // 讓頁面自己的每幀 updateFreqFollowCamera 跑過幾輪（真正的受測路徑）
      const graced = await page.evaluate(() => {
        updateFreqFollowCamera();
        return { following: !!state.freqFollow, grace: !!(state.freqFollow && state.freqFollow.lastRecord),
          toasts: window.__toasts.slice() }; // 刻意不清空：清空會把「更早的那一幀就拆掉了」這個真相蓋掉
      });
      const expired = await page.evaluate(() => {
        window.__toasts.length = 0;
        if (!state.freqFollow) return { following: false, toasts: ['(已提前被拆，E1 已記錄)'] };
        state.freqFollow.lastSeenAt = Date.now() / 1000 - 45; // 超過 30 秒寬限
        updateFreqFollowCamera();
        return { following: !!state.freqFollow, toasts: window.__toasts.slice() };
      });
      dropVehicleId = null; currentVariant = 'healthy';
      await page.close();
      return { picked, graced, expired, errors };
    };
    {
      const { picked, graced, expired, errors } = await followDropRun();
      check('E0 佈題：真的跟上了一台 Core 車', !!picked && picked.liveSec > 60, JSON.stringify(picked));
      check('E1 缺席一批不拆跟隨（寬限內）', graced.following === true && graced.toasts.length === 0, JSON.stringify(graced));
      check('E2 超過寬限才退場', expired.following === false, JSON.stringify(expired));
      // 只綁真因（即時模型找不到這台車）＋排除舊的錯誤歸因，不綁確切措辭：
      // 994a9ce 已把「連續兩批」改成「超過 30 秒」（實際條件是 GRACE_SEC=30），
      // 綁措辭會讓每次改文案都假紅一次。
      check('E3 退場文案講的是真因（不是「官方名冊已更新」）',
        toastNamesRealCause(expired.toasts), JSON.stringify(expired.toasts));
      allErrors = allErrors.concat(errors);
    }
    {
      servedHtml = MUTATED_TOAST_HTML;
      const { expired, errors } = await followDropRun();
      servedHtml = REAL_HTML;
      check('E4 突變對照：退場文案回到「官方名冊已更新」的錯誤歸因後，E3 必須轉紅',
        !toastNamesRealCause(expired.toasts), `舊行為下 toasts=${JSON.stringify(expired.toasts)}`);
      allErrors = allErrors.concat(errors.filter(e => !/MUTATION/.test(e)));
    }

    // ── (f) 台北／台中「市政府」看板分家，且兩邊都有列 ──────────────────
    {
      const { page, errors } = await newPage(browser);
      await pollOnce(page);
      const TPE = { name: '市政府', lat: 25.041135, lon: 121.5679, sys: 'freq', metroSysId: 'mrt' };
      const TCH = { name: '市政府', lat: 24.16199, lon: 120.64903, sys: 'freq', metroSysId: 'tmrt' };
      const live = await page.evaluate(st => {
        openBoard(st);
        const el = document.getElementById('board');
        const out = { sysIds: Array.from(new Set(metroBoardLines(st, state.lines).map(freqSysIdOf))),
          core: el.dataset.metroCore === '1', rows: el.querySelectorAll('.row').length };
        closeBoard(); return out;
      }, TPE);
      check('F1 台北市政府只讀北捷（Core 生效中）', live.sysIds.length === 1 && live.sysIds[0] === 'mrt' && live.core,
        JSON.stringify(live));
      // 🔴 兩邊都要有列這條正向對照【不能】綁在跑測試的當下時刻上——深夜跑會因為收班而假紅
      //    （心得 34：紅有三種互斥原因，這一種是環境條件）。所以把時鐘釘在上午十點再量一次。
      const board = await page.evaluate(([tpe, tch]) => {
        state.clockAtNow = false; state.simSec = 10 * 3600; // 兩家都在營運時段內
        const read = st => {
          openBoard(st);
          const el = document.getElementById('board');
          return { sysIds: Array.from(new Set(metroBoardLines(st, state.lines).map(freqSysIdOf))),
            rows: el.querySelectorAll('.row').length, text: el.textContent.slice(0, 120) };
        };
        const a = read(tpe), b = read(tch);
        closeBoard();
        return { tpe: a, tch: b };
      }, [TPE, TCH]);
      check('F2 上午十點：台北市政府只讀北捷', board.tpe.sysIds.length === 1 && board.tpe.sysIds[0] === 'mrt', JSON.stringify(board.tpe.sysIds));
      check('F3 上午十點：台中市政府只讀中捷', board.tch.sysIds.length === 1 && board.tch.sysIds[0] === 'tmrt', JSON.stringify(board.tch.sysIds));
      check('F4 兩邊都有班次列（正向對照：不是因為其中一邊變空才不混）',
        board.tpe.rows > 0 && board.tch.rows > 0, `台北 ${board.tpe.rows} 列、台中 ${board.tch.rows} 列`);
      allErrors = allErrors.concat(errors);
      await page.close();
    }

    // ── (g) P0-2 相對基線腰斬 → 那條線退回 legacy（含防抖與復原對照）────
    {
      const { page, errors } = await newPage(browser);
      currentVariant = 'healthy';
      for (let i = 0; i < 6; i++) await pollOnce(page);           // 建基線（BL 21 台）
      const base = await lineStats(page);
      check('G1 佈題：基線建立、BL 由 Core 驅動', base.lines['trtc:BL'].core > 10, JSON.stringify(base.lines['trtc:BL']));
      currentVariant = 'halvedBL';
      await pollOnce(page);                                        // 第一輪腰斬
      const once = await lineStats(page);
      check('G2 防抖：只腰斬一輪還不退回', once.lines['trtc:BL'].core !== null && !once.status.blockedLines['trtc:BL'],
        `core=${once.lines['trtc:BL'].core} blocked=${JSON.stringify(once.status.blockedLines['trtc:BL'])}`);
      await pollOnce(page);                                        // 第二輪腰斬
      const twice = await lineStats(page);
      const bl2 = twice.lines['trtc:BL'], mark = twice.status.blockedLines['trtc:BL'];
      check('G3 連兩輪腰斬 ⇒ 這條線退回既有路徑並記錄原因',
        !!bl2 && bl2.core === null && !!mark && mark.reason === 'count',
        `BL=${JSON.stringify(bl2)} mark=${JSON.stringify(mark)} lineIds=${twice.lineIds.join(',')}`);
      check('G4 只擋那一條線，其他線照常（不得整包退）',
        !!twice.lines['trtc:R'] && twice.lines['trtc:R'].core > 0 && Object.keys(twice.status.blockedLines).length === 1,
        `blocked=${Object.keys(twice.status.blockedLines).join(',')} R=${JSON.stringify(twice.lines['trtc:R'])}`);
      check('G5 基線沒有被壞掉的那一輪拉下來（防自我漂移）', !!mark && mark.base >= 10,
        `base=${mark && mark.base} cur=${mark && mark.cur}`);
      currentVariant = 'healthy';
      await pollOnce(page); await pollOnce(page);                   // 復原對照
      const back = await lineStats(page);
      check('G6 復原對照：連兩輪正常就放行（閘門不會永久卡住）',
        !!back.lines['trtc:BL'] && back.lines['trtc:BL'].core > 10 && !back.status.blockedLines['trtc:BL'],
        JSON.stringify(back.lines['trtc:BL']));
      allErrors = allErrors.concat(errors);
      await page.close();
    }

    // ── (h) 地圖點車：命中結果要保留 Core 身分，跟隨才建得起來（含突變對照）──
    //    3dad2e5 的 freqTrainsAt 只回 {ln,k,tr,vehicleId}，而 applyFreqFollow 讀 target.core
    //    決定查 Core 還是 legacy 名冊 ⇒ Core 的 vehicleId 被拿去查舊名冊，必然查無此車，
    //    地圖上點任何一台 Core 車都只會吐「這列車已離開官方即時名冊」。
    currentVariant = 'healthy';
    const clickFollow = async () => {
      const { page, errors } = await newPage(browser);
      await pollOnce(page);
      await page.evaluate(() => window.__map.setView([25.048, 121.545], 12, { animate: false }));
      await page.waitForTimeout(1200);
      const out = await page.evaluate(() => {
        const hit = (state._freqHits || []).find(h => h.core && h.vehicleId != null);
        if (!hit) return { picked: null };
        const got = freqTrainsAt({ x: hit.x, y: hit.y })[0] || null;
        window.__toasts.length = 0;
        clearFreqFollow();
        setFreqFollow(got);
        const f = state.freqFollow;
        return { picked: { vehicleId: String(hit.vehicleId), systemId: String(hit.systemId) },
          hit: got && { core: !!got.core, systemId: got.systemId || null, vehicleId: got.vehicleId || null },
          follow: f && { core: !!f.core, systemId: f.systemId || null, vehicleId: f.vehicleId || null },
          toasts: window.__toasts.slice() };
      });
      await page.close();
      return { out, errors };
    };
    {
      const { out, errors } = await clickFollow();
      check('H1 佈題：地圖上點得到一台 Core 車，命中結果帶回 core／systemId／vehicleId',
        !!out.hit && out.hit.core === true && out.hit.systemId === out.picked.systemId &&
        out.hit.vehicleId === out.picked.vehicleId, JSON.stringify(out.hit));
      check('H2 端到端：點下去真的跟起來，且走的是 Core 身分（不是 legacy 名冊）',
        !!out.follow && out.follow.core === true && out.follow.vehicleId === out.picked.vehicleId &&
        !out.toasts.some(t => /名冊/.test(t)), JSON.stringify({ follow: out.follow, toasts: out.toasts }));
      allErrors = allErrors.concat(errors);
    }
    {
      servedHtml = MUTATED_HIT_HTML;
      const { out, errors } = await clickFollow();
      check('H3 突變對照：freqTrainsAt 不傳 core／systemId 時，H2 必須轉紅',
        !out.follow || out.follow.core !== true,
        `舊行為下 follow=${JSON.stringify(out.follow)} toasts=${JSON.stringify(out.toasts)}`);
      allErrors = allErrors.concat(errors.filter(e => !/MUTATION/.test(e)));
      servedHtml = REAL_HTML;
    }

    // ── (i) 共站辨線：看板列指到別條線的車 ⇒ 只留時刻、不連結（含正向對照與突變）──
    currentVariant = 'crossLine';
    const crossLineProbe = async () => {
      if (!crossLineCase) buildSnapshot('crossLine'); // 佈題參數由工廠算出，先確保它已產生
      const { page, errors } = await newPage(browser);
      await pollOnce(page);
      const out = await page.evaluate(kase => {
        const ln = state.lines.find(l => String(l.id) === 'BL');
        const st = ln && ln.stations[kase.stationIndex];
        const view = st && metroCoreBoardView(st, state.lines, false);
        const rows = view ? view.groups.filter(g => g.kind === 'core' && String(g.ln.id) === 'BL')
          .flatMap(g => g.rows) : [];
        const pick = id => {
          const rec = rows.find(r => r.row && String(r.row.rowId) === id);
          return rec ? { vehicleId: rec.vehicleId, match: rec.match } : null;
        };
        return { stationName: st && st.name, rowCount: rows.length,
          bad: pick(kase.badRowId), good: pick(kase.goodRowId),
          matched: (__railMetroCore.status().matchRatio.trtc || {}).matched };
      }, crossLineCase);
      await page.close();
      return { out, errors };
    };
    {
      const { out, errors } = await crossLineProbe();
      check('I1 佈題：那張看板真的讀得到、被動手腳與沒動的兩列都在畫面上',
        out.rowCount > 0 && !!out.bad && !!out.good, JSON.stringify({ st: out.stationName, rows: out.rowCount }));
      check('I2 正向對照：同一張看板沒動過的列仍連得到車（否則 I3 只是「整張板都不連」）',
        !!out.good && out.good.vehicleId === crossLineCase.goodVehicleId, JSON.stringify(out.good));
      check('I3 指到別條線的車 ⇒ 那一列失去身分、標記 unmatched（時刻仍在，不亂標）',
        !!out.bad && out.bad.vehicleId === null && out.bad.match === 'unmatched', JSON.stringify(out.bad));
      check('I4 誤配的列被算進 P2-9 分子外（覆蓋率不得把它當已配對）',
        out.matched === healthyMatched - 1, `crossLine matched=${out.matched}、healthy matched=${healthyMatched}`);
      allErrors = allErrors.concat(errors);
    }
    {
      servedHtml = MUTATED_XLINE_HTML;
      const { out, errors } = await crossLineProbe();
      check('I5 突變對照：拿掉辨線檢查後，I3 必須轉紅',
        !!out.bad && out.bad.vehicleId === crossLineCase.brVehicleId,
        `舊行為下 bad=${JSON.stringify(out.bad)}`);
      // 同一發突變也要證明 I4 有牙：誤配的列一旦解得出身分，P2-9 就會把它算進分子，
      // matched 回到健康態的值 ⇒ I4 的「必須少一列」轉紅。
      check('I6 突變對照：辨線檢查沒了以後誤配列被算成已配對，I4 必須轉紅',
        out.matched === healthyMatched,
        `舊行為下 matched=${out.matched}、healthy=${healthyMatched}（正常應為 ${healthyMatched - 1}）`);
      allErrors = allErrors.concat(errors.filter(e => !/MUTATION/.test(e)));
      servedHtml = REAL_HTML;
    }
    currentVariant = 'healthy';

    // ── (i-2) 單站單方向缺列：有資料的方向維持 Core，只替缺的方向補班表 ──────
    currentVariant = 'missingDirection';
    const missingDirectionProbe = async () => {
      if (!missingDirectionCase) buildSnapshot('missingDirection');
      const { page, errors } = await newPage(browser);
      await pollOnce(page);
      const out = await page.evaluate(kase => {
        const ln = state.lines.find(l => String(l.id) === String(kase.lineId));
        const st = ln && ln.stations[kase.stationIndex];
        const view = st && metroCoreBoardView(st, state.lines, false);
        const groups = view ? view.groups.filter(group => String(group.ln.id) === String(kase.lineId)) : [];
        return { stationName: st && st.name,
          coreDirections: [...new Set(groups.filter(group => group.kind === 'core')
            .flatMap(group => group.rows.map(row => Number(row.direction))))],
          legacyDirections: [...new Set(groups.filter(group => group.kind === 'legacy')
            .flatMap(group => group.rows.map(row => Number(row.direction))))],
          legacyRows: groups.filter(group => group.kind === 'legacy').flatMap(group => group.rows).length };
      }, missingDirectionCase);
      await page.close();
      return { out, errors };
    };
    {
      const { out, errors } = await missingDirectionProbe();
      check('I7 Core 少一個方向時，仍有資料的方向維持官方即時列',
        out.coreDirections.includes(missingDirectionCase.keptDirection), JSON.stringify(out));
      check('I8 Core 少一個方向時，只替缺的方向補班表列',
        out.legacyRows > 0 && out.legacyDirections.includes(missingDirectionCase.missingDirection) &&
        !out.legacyDirections.includes(missingDirectionCase.keptDirection), JSON.stringify(out));
      allErrors = allErrors.concat(errors);
    }
    {
      servedHtml = MUTATED_DIRECTION_FALLBACK_HTML;
      const { out, errors } = await missingDirectionProbe();
      check('I9 突變對照：拿掉缺方向退路後，I8 的缺方向必須真的消失',
        !out.legacyDirections.includes(missingDirectionCase.missingDirection), JSON.stringify(out));
      allErrors = allErrors.concat(errors.filter(e => !/MUTATION/.test(e)));
      servedHtml = REAL_HTML;
    }
    currentVariant = 'healthy';

    // ── (j) 深夜正常末班收車：Core 與 legacy 同時歸零 ⇒ P0-2 不得判成少車 ────
    //    兩組情境除了「頁面時鐘」以外每一個輸入都逐格相同（同一份語料、同樣 6 輪建基線、
    //    同樣切 allEmpty 再跑兩輪）——唯一的變因就是備案在那個時刻有沒有車。
    //    少了反向對照，「乾脆別擋了」也會全綠（心得 39(b)）。
    {
      const run = async label => {
        const { page, errors } = await newPage(browser);
        currentVariant = 'healthy';
        for (let i = 0; i < 6; i++) await pollOnce(page);   // 建基線
        const base = await lineStats(page);
        currentVariant = 'allEmpty';
        await pollOnce(page); await pollOnce(page);          // 連兩輪 0 台（防抖門檻）
        const after = await lineStats(page);
        allErrors = allErrors.concat(errors);
        await page.close();
        return { label, base, after };
      };

      shiftClockToSecOfDay(CLOSED_SEC);
      const night = await run('收班');
      shiftClockToSecOfDay(PEAK_SEC);
      const peak = await run('營運中');

      const nightLegacy = Object.values(night.base.lines).reduce((s, v) => s + v.legacy, 0);
      const peakLegacy = Object.values(peak.base.lines).reduce((s, v) => s + v.legacy, 0);
      check('J1 佈題成立：收班時段備案 0 台、營運時段備案有車（否則 J2/J3 是空判準）',
        nightLegacy === 0 && peakLegacy > 0, `收班 legacy=${nightLegacy}、營運中 legacy=${peakLegacy}`);
      check('J2 佈題成立：兩組的基線都建起來了（Core 兩邊都有車可掉）',
        Object.values(night.base.lines).some(v => v.core > 4) && Object.values(peak.base.lines).some(v => v.core > 4),
        `收班 BL=${JSON.stringify(night.base.lines['trtc:BL'])}、營運中 BL=${JSON.stringify(peak.base.lines['trtc:BL'])}`);
      check('J3 收班：Core 歸零但備案也歸零 ⇒ 一條線都不判退回（不是每天深夜整批假警報）',
        Object.keys(night.after.status.blockedLines).length === 0,
        `blocked=${JSON.stringify(night.after.status.blockedLines)}`);
      check('J4 收班：徽章講的是「收班」不是「即時資料異常」',
        !!night.after.badge && !/異常/.test(night.after.badge.text),
        JSON.stringify(night.after.badge));
      check('J5 控制組：同一套輸入換成營運時段（備案有車）⇒ 照舊判退回，豁免沒有把牙拔掉',
        Object.keys(peak.after.status.blockedLines).length > 0 &&
        Object.values(peak.after.status.blockedLines).every(v => v && v.reason === 'count'),
        `blocked=${Object.keys(peak.after.status.blockedLines).join(',')}`);
      check('J6 控制組：營運時段 Core 0 台時徽章明講異常（P0-5 沒被豁免蓋掉）',
        badgeSaysAnom(peak.after.badge), JSON.stringify(peak.after.badge));

      shiftClockToSecOfDay(CLOSED_SEC);
      servedHtml = MUTATED_WINDDOWN_HTML;
      const mutated = await run('收班（突變：拿掉豁免）');
      servedHtml = REAL_HTML;
      shiftClockToSecOfDay(PEAK_SEC);
      check('J7 突變對照：拿掉收班豁免後，J3 必須轉紅（證明 J3 不是「反正那時段不判定」）',
        Object.keys(mutated.after.status.blockedLines).length > 0,
        `舊行為下 blocked=${Object.keys(mutated.after.status.blockedLines).join(',') || '(空)'}`);

      // J6 自己的突變對照：走完整條 (j) 管線（建基線 → 連兩輪 0 台），只把徽章那段改成說謊。
      servedHtml = MUTATED_BADGE_LIE_HTML;
      const lied = await run('營運中（突變：徽章說謊）');
      servedHtml = REAL_HTML;
      check('J8 突變對照：營運時段 Core 0 台卻謊稱「官方即時」時，J6 必須轉紅',
        !badgeSaysAnom(lied.after.badge), `舊行為下 badge=${JSON.stringify(lied.after.badge)}`);
      currentVariant = 'healthy';
    }

    // ── (k) 站列版本閘門：Core 的站數與自己這份不同 ⇒ 只擋那一條線 ──────────
    //    2026-08-29 信義東延段實測的事故形態：R 線加一站，Core 還握著舊的 27 站快取，
    //    於是整條線索引位移一格（往象山變成往廣慈/奉天宮、往北投變成往奇岩）。車數、
    //    身分、比例全部正常 ⇒ 前面三道閘門一個都照不到，只有站數對得出來。
    currentVariant = 'healthy';
    {
      const { page, errors } = await newPage(browser);
      pageLineCounts = await page.evaluate(() => {
        const out = {};
        for (const ln of state.lines) {
          const sysId = metroCoreSystemIdForLine(ln);
          if (sysId && Array.isArray(ln.stations) && ln.stations.length) out[sysId + ':' + ln.id] = ln.stations.length;
        }
        return out;
      });
      check('K0 從頁面讀得到逐線站數（判準來源與被測物不同源的前提）',
        pageLineCounts && Object.keys(pageLineCounts).length >= 9 && pageLineCounts['trtc:R'] > 20,
        `${Object.keys(pageLineCounts || {}).length} 條，trtc:R=${pageLineCounts && pageLineCounts['trtc:R']}`);
      await page.close();
      allErrors = allErrors.concat(errors);
    }
    // (k-1) 站數一致 ⇒ 什麼都不該擋（正向對照：沒有它，K2 用「乾脆全擋」也會綠）
    currentVariant = 'stationsMatch';
    {
      const { page, errors } = await newPage(browser);
      const ok = await pollOnce(page);
      const s = await lineStats(page);
      const trtc = Object.entries(s.lines).filter(([k]) => k.startsWith('trtc:'));
      check('K1 站數一致時九線照舊由 Core 驅動、零 stationMismatch',
        ok === true && trtc.length === 9 && trtc.every(([, v]) => v.core !== null) &&
        Object.keys(s.status.stationMismatch || {}).length === 0,
        `core 驅動 ${trtc.filter(([, v]) => v.core !== null).length}/9、mismatch=${JSON.stringify(s.status.stationMismatch)}`);
      allErrors = allErrors.concat(errors);
      await page.close();
    }
    // (k-2) R 線站數少一站 ⇒ 只有 R 退回官方倒數，其他八線不受影響
    currentVariant = 'stationsShift';
    {
      const { page, errors } = await newPage(browser);
      const ok = await pollOnce(page);
      const s = await lineStats(page);
      const r = s.lines['trtc:R'];
      const others = Object.entries(s.lines).filter(([k]) => k.startsWith('trtc:') && k !== 'trtc:R');
      const mismatch = (s.status.stationMismatch || {})['trtc:R'];
      check('K2 站數對不上的那條線退回既有路徑', ok === true && r && r.core === null, `poll=${ok} trtc:R=${JSON.stringify(r)}`);
      check('K3 那條線的既有路徑真的有車可畫（正向對照）', r && r.legacy > 0, `legacy=${r && r.legacy} 台`);
      check('K4 其他八線不受影響（只擋一條，不是整包退掉）',
        others.length === 8 && others.every(([, v]) => v.core !== null),
        `core 驅動 ${others.filter(([, v]) => v.core !== null).length}/${others.length}`);
      check('K5 診斷指名是哪一條、雙方各是幾站',
        mismatch && mismatch.core === pageLineCounts['trtc:R'] - 1 && mismatch.local === pageLineCounts['trtc:R'],
        JSON.stringify(s.status.stationMismatch));
      allErrors = allErrors.concat(errors);
      await page.close();
    }
    // (k-3) 突變對照：拿掉閘門出口，K2 必須轉紅
    {
      servedHtml = MUTATED_STATIONS_HTML;
      const { page, errors } = await newPage(browser);
      await pollOnce(page);
      const s = await lineStats(page);
      const r = s.lines['trtc:R'];
      check('K6 突變對照：拿掉站列版本閘門後，K2 的判準必須轉紅',
        r && r.core !== null && r.core > 0, `舊行為下 core=${r && r.core}（有車＝索引位移照畫，正是事故形態）`);
      allErrors = allErrors.concat(errors.filter(e => !/MUTATION/.test(e)));
      await page.close();
      servedHtml = REAL_HTML;
      currentVariant = 'healthy';
    }

    check('Z1 全程零未捕捉 pageerror', allErrors.length === 0, allErrors.slice(0, 3).join(' | ') || '0');
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.filter(r => !r.pass);
  console.log(`\n總計 ${results.length - failed.length}/${results.length} 通過`);
  if (failed.length) { console.error('失敗項：' + failed.map(r => r.name).join('、')); process.exit(1); }
}

main().catch(error => { console.error(error); process.exit(1); });
