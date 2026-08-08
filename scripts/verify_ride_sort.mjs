// 旅程護照「完乘記錄」排序驗證(issue#8)——Playwright 真引擎 + 本機靜態伺服器。
// 背景:renderPassport() 原本用 rides.slice().reverse() 假裝「最新在前」(資料層其實照
//   sys|train|date 字串排序,不是完乘先後)。v0718 加 sortRides(arr, mode) 純顯示層排序
//   (date/train/km/kind 四模式),不碰 userData 資料層與同步路徑。
// 驗法:期望序全部由本腳本獨立手算(見 EXPECT_* 常數),只有 kind 模式的「組間順序」交給瀏覽器
//   自己的 localeCompare('zh-Hant') 當場算(這是唯一依賴引擎 ICU 的原語,不能用手猜——心得10教訓:
//   小模型/手算對 locale collation 沒有把握就該查證,不能腦補),組內順序仍是手算。
//   全程讀 DOM 實際渲染的 .ph-list 順序,不呼叫頁面內部的 sortRides 回傳值(避免驗到「自己抄自己」)。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5193;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  // 高鐵班表自 2026-08-07(9f05f2f)改以 apiUrl('api/thsr-schedule') 為主來源、靜態檔降級為 fallbackUrl。
  // 空物件是 200 ⇒ fetchJSONAt 視同成功 ⇒ fallback 永不啟動 ⇒ applySchedSystems 迭代 undefined 的
  // sys.data.trains 拋錯 ⇒ boot 停在 state.ready=true 之前 ⇒ waitReady 逾時。這裡吐打包的那份(同 schema)。
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/thsr-schedule') return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
    return res.end('{}');
  }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, r));

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const allErrors = [];

// ── fixture:9 筆完乘記錄,涵蓋四模式的關鍵情境 ──
// R1/R2 同日不同 dep(晚班 dep 較大);R3/R4 車次 99 vs 100(數字排序非字串)且 km 同值 375 不同日;
// R5 thsr_sched 系統混入;R6 kind='山海號'(特別列車,山海/平原命名與一般車種混合);
// R9 train 非數字('加開1')驗 NaN 防禦分支。
const RIDES = [
  { train: '1200',  sys: 'tra_sched',  kind: '區間車',   from: '台北', to: '基隆', km: 25,  date: '2026-07-10', dep: 21600, stops: 8 },
  { train: '1201',  sys: 'tra_sched',  kind: '區間車',   from: '基隆', to: '台北', km: 30,  date: '2026-07-10', dep: 72000, stops: 8 },
  { train: '99',    sys: 'tra_sched',  kind: '自強號',   from: '台北', to: '高雄', km: 375, date: '2026-07-05', dep: 25200, stops: 12 },
  { train: '100',   sys: 'tra_sched',  kind: '莒光號',   from: '高雄', to: '台北', km: 375, date: '2026-07-12', dep: 30000, stops: 16 },
  { train: '605',   sys: 'thsr_sched', kind: '自強號',   from: '南港', to: '左營', km: 345, date: '2026-07-14', dep: 28800, stops: 8 },
  { train: '8888',  sys: 'tra_sched',  kind: '山海號',   from: '臺北', to: '枋寮', km: 600, date: '2026-07-16', dep: 0,     stops: 20 },
  { train: '400',   sys: 'tra_sched',  kind: '普悠瑪號', from: '台北', to: '花蓮', km: 180, date: '2026-07-08', dep: 18000, stops: 6 },
  { train: '2100',  sys: 'tra_sched',  kind: '區間快',   from: '新竹', to: '台中', km: 90,  date: '2026-07-17', dep: 50000, stops: 10 },
  { train: '加開1', sys: 'tra_sched',  kind: '區間車',   from: '高雄', to: '台南', km: 45,  date: '2026-07-11', dep: 40000, stops: 5 },
];

// 手算期望序(train 欄位序列),date/train/km 三模式完全不依賴引擎特性。
const EXPECT_DATE  = ['2100', '8888', '605', '100', '加開1', '1201', '1200', '400', '99'];
const EXPECT_TRAIN = ['99', '100', '400', '605', '1200', '1201', '2100', '8888', '加開1'];
const EXPECT_KM    = ['8888', '100', '99', '605', '400', '2100', '加開1', '1201', '1200'];
// kind 模式:組內順序手算,組間順序(哪個 kind 排前面)由瀏覽器 localeCompare('zh-Hant') 當場決定。
const KIND_GROUPS = {
  '區間車':   ['加開1', '1201', '1200'], // date desc(07-11 > 07-10);07-10 同日 dep desc(1201:72000>1200:21600)
  '自強號':   ['605', '99'],             // date desc:07-14 > 07-05
  '莒光號':   ['100'],
  '山海號':   ['8888'],
  '普悠瑪號': ['400'],
  '區間快':   ['2100'],
};

function buildEnvelope(rides) {
  const at = Date.now();
  const items = rides.map(r => ({ id: (r.sys || 'tra_sched') + '|' + r.train + '|' + r.date, value: r, updatedAt: at }));
  return {
    version: 1, deviceId: 'verify-ride-sort', revision: 1, updatedAt: at,
    collections: {
      pins: { items: [], tombstones: [] },
      favs: { items: [], tombstones: [] },
      rides: { items, tombstones: [] },
      stations: { items: [], tombstones: [] },
    },
  };
}
const ENVELOPE = buildEnvelope(RIDES);

async function bootPage(browser, { width = 1280, height = 800, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript((envelope) => {
    localStorage.setItem('trainmap-howto-seen', '1');
    localStorage.setItem('trainmap-appearance', 'light');
    localStorage.setItem('trainmap-passport-open', '1'); // 展開護照卡片,排序控制才在畫面上可互動
    localStorage.setItem('trainmap-user-data-v1', JSON.stringify(envelope));
  }, ENVELOPE);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { errors.push(String(e)); allErrors.push(String(e)); });
  page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); allErrors.push(m.text()); } });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready; } catch (e) { return false; } }, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}

const rideRowTrains = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll('#passport .ph-list .ph-row b')).map(b => b.textContent));

const rect = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const vis = r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05;
  return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom, vis };
}, sel);
const boxOverlap = (a, b) => a && b && a.vis !== false && b.vis !== false &&
  a.x < b.x + b.w - 2 && b.x < a.x + a.w - 2 && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2;

// ══════════════ A. 桌面(chromium 1280×800):四模式排序正確性 ══════════════
{
  const browser = await chromium.launch();
  console.log('\n═══ A. chromium 1280 — 四模式排序正確性 ═══');
  const { ctx, page } = await bootPage(browser, { width: 1280, height: 800 });

  // A0 預設模式=date、按鈕狀態正確、預設順序即為 EXPECT_DATE(不用點擊)
  const btn0 = await page.evaluate(() => document.getElementById('phSortSeg')?.querySelector('button.on')?.dataset.v || null);
  ok('A0 預設排序模式=date', btn0 === 'date', `實際=${btn0}`);
  const rows0 = await rideRowTrains(page);
  ok('A0 預設(未點擊)渲染順序即符合 date 模式期望', JSON.stringify(rows0) === JSON.stringify(EXPECT_DATE), JSON.stringify(rows0));

  // A1 date 模式(顯式點擊,驗證重點回同一結果+按鈕高亮)
  await page.click('#phSortSeg button[data-v="date"]');
  await page.waitForTimeout(80);
  const rowsDate = await rideRowTrains(page);
  const onDate = await page.evaluate(() => document.querySelector('#phSortSeg button[data-v="date"]').classList.contains('on'));
  ok('A1 date 模式順序正確', JSON.stringify(rowsDate) === JSON.stringify(EXPECT_DATE), JSON.stringify(rowsDate));
  ok('A1 date 按鈕高亮(.on)', onDate === true);

  // A2 train 模式
  await page.click('#phSortSeg button[data-v="train"]');
  await page.waitForTimeout(80);
  const rowsTrain = await rideRowTrains(page);
  const onTrain = await page.evaluate(() => document.querySelector('#phSortSeg button[data-v="train"]').classList.contains('on'));
  ok('A2 train 模式順序正確(數字排序,非字串;NaN 車次殿後)', JSON.stringify(rowsTrain) === JSON.stringify(EXPECT_TRAIN), JSON.stringify(rowsTrain));
  ok('A2 train 按鈕高亮(.on)', onTrain === true);

  // A3 km 模式
  await page.click('#phSortSeg button[data-v="km"]');
  await page.waitForTimeout(80);
  const rowsKm = await rideRowTrains(page);
  const onKm = await page.evaluate(() => document.querySelector('#phSortSeg button[data-v="km"]').classList.contains('on'));
  ok('A3 km 模式順序正確(長→短,同距 date desc)', JSON.stringify(rowsKm) === JSON.stringify(EXPECT_KM), JSON.stringify(rowsKm));
  ok('A3 km 按鈕高亮(.on)', onKm === true);

  // A4 kind 模式:組間順序問瀏覽器 localeCompare('zh-Hant'),組內順序手算(KIND_GROUPS)後拼接
  await page.click('#phSortSeg button[data-v="kind"]');
  await page.waitForTimeout(80);
  const rowsKind = await rideRowTrains(page);
  const onKind = await page.evaluate(() => document.querySelector('#phSortSeg button[data-v="kind"]').classList.contains('on'));
  const kindOrder = await page.evaluate((kinds) => kinds.slice().sort((a, b) => a.localeCompare(b, 'zh-Hant')), Object.keys(KIND_GROUPS));
  const expectKind = kindOrder.flatMap(k => KIND_GROUPS[k]);
  ok('A4 kind 模式順序正確(zh-Hant 分組+組內 date desc)', JSON.stringify(rowsKind) === JSON.stringify(expectKind),
    `瀏覽器分組序=${JSON.stringify(kindOrder)} 實際=${JSON.stringify(rowsKind)} 期望=${JSON.stringify(expectKind)}`);
  ok('A4 kind 按鈕高亮(.on)', onKind === true);

  await ctx.close();
  await browser.close();
}

// ══════════════ B. 持久化:切非預設模式(km)→ reload → 選擇記住且順序仍對 ══════════════
{
  const browser = await chromium.launch();
  console.log('\n═══ B. chromium 1280 — localStorage 持久化 ═══');
  const { ctx, page } = await bootPage(browser, { width: 1280, height: 800 });

  await page.click('#phSortSeg button[data-v="km"]');
  await page.waitForTimeout(80);
  const savedKey = await page.evaluate(() => localStorage.getItem('trainmap-ride-sort'));
  ok('B1 點擊後 localStorage 寫入 trainmap-ride-sort=km', savedKey === 'km', `實際=${savedKey}`);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready; } catch (e) { return false; } }, null, { timeout: 30000 });
  await page.waitForTimeout(400);

  const onAfterReload = await page.evaluate(() => document.querySelector('#phSortSeg button[data-v="km"]')?.classList.contains('on'));
  ok('B2 reload 後 km 按鈕仍高亮(選擇被記住)', onAfterReload === true);
  const rowsAfterReload = await rideRowTrains(page);
  ok('B3 reload 後渲染順序仍是 km 模式序', JSON.stringify(rowsAfterReload) === JSON.stringify(EXPECT_KM), JSON.stringify(rowsAfterReload));

  await ctx.close();
  await browser.close();
}

// ══════════════ C. 窄視窗掃描:901/1024/1280 × chromium+webkit,不溢出+觸控 tap ══════════════
// 本段原本掃 360/375/414/768,但那四個寬度全都 ≤900 ⇒ body 掛上 fs 手機殼,而 fs 把桌面護照整個關掉
// (index.html:1365 `body.fs .passport { display: none }`),排序控制就住在 #passport 裡面。
// 更根本的是:手機護照走的是另一條渲染路徑 #ridePanel,它自 2026-07-21(25b646c 手機改版 Batch B)起
// 就刻意不出排序鈕(index.html:10820「手機不做排序鈕,固定日期最新在前」)。所以原本那四個寬度量到的
// 一律是 0×0——「存在且可見」結構上不可能綠,而「未超出/不相交」這類否定式斷言反而因為兩個框都是
// 0×0 而全部假綠(這正是它們沒能早點抓到問題的原因)。
// 改法:(1) 掃描移到控制真的存在的區間,最窄取剛脫離手機殼的 901,那才是它會被擠爆的臨界寬度;
//       (2) 手機那側改驗「依設計就不該有排序鈕」,並附正向對照免得零又是假綠(見 D 段)。
const WIDTHS = [901, 1024, 1280];
for (const [engName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch();
  console.log(`\n═══ C. ${engName} 窄視窗掃描(901/1024/1280) ═══`);
  for (const width of WIDTHS) {
    const { ctx, page } = await bootPage(browser, { width, height: 800, touch: true });

    const segR = await rect(page, '#phSortSeg');
    const passR = await rect(page, '.passport');
    const geo = await page.evaluate(() => ({
      vw: window.innerWidth,
      scrollW: document.documentElement.scrollWidth,
    }));
    // 下面每一條否定式斷言都要先掛「量得到而且可見」這個前提:0×0 的框永遠不超出、也永遠不與人相交,
    // 少了這個前提,面板整個沒開的情況會以全綠收場(2026-08-08 就是這樣讓 C 段紅不起來)。
    const segVis = !!(segR && segR.vis);
    ok(`${engName} C-${width} 排序控制存在且可見`, segVis, JSON.stringify(segR));
    ok(`${engName} C-${width} 排序控制右緣未超出視窗`, segVis && segR.right <= geo.vw + 1, `vis=${segVis} right=${segR && segR.right} vw=${geo.vw}`);
    ok(`${engName} C-${width} 排序控制右緣未超出護照卡片`, segVis && !!passR && passR.vis && segR.right <= passR.right + 1, `vis=${segVis} segRight=${segR && segR.right} cardRight=${passR && passR.right}`);
    ok(`${engName} C-${width} 頁面無橫向捲動`, geo.scrollW - geo.vw <= 1, `scrollW=${geo.scrollW} vw=${geo.vw}`);

    // 與相鄰控件(上:成就徽章區塊、下:完乘記錄列表)不相交
    const neigh = await page.evaluate(() => {
      const sec = document.querySelector('.ph-sec-rides');
      const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, vis: b.width > 0 && b.height > 0 }; };
      return { prev: r(sec && sec.previousElementSibling), next: r(sec && sec.nextElementSibling) };
    });
    ok(`${engName} C-${width} 排序控制與上方成就徽章不相交`, segVis && !!neigh.prev && neigh.prev.vis && !boxOverlap(segR, neigh.prev), JSON.stringify({ seg: segR, prev: neigh.prev }));
    ok(`${engName} C-${width} 排序控制與下方完乘列表不相交`, segVis && !!neigh.next && neigh.next.vis && !boxOverlap(segR, neigh.next), JSON.stringify({ seg: segR, next: neigh.next }));

    // 觸控 tap 切到 kind 模式,驗證生效(狀態+DOM 順序)
    await page.locator('#phSortSeg button[data-v="kind"]').tap();
    await page.waitForTimeout(80);
    const tapOn = await page.evaluate(() => document.querySelector('#phSortSeg button[data-v="kind"]')?.classList.contains('on'));
    const tapRows = await rideRowTrains(page);
    const kindOrder = await page.evaluate((kinds) => kinds.slice().sort((a, b) => a.localeCompare(b, 'zh-Hant')), Object.keys(KIND_GROUPS));
    const expectKind = kindOrder.flatMap(k => KIND_GROUPS[k]);
    ok(`${engName} C-${width} 觸控 tap 切換生效(按鈕高亮)`, tapOn === true);
    ok(`${engName} C-${width} 觸控 tap 後順序正確(kind 模式)`, JSON.stringify(tapRows) === JSON.stringify(expectKind), JSON.stringify(tapRows));

    await ctx.close();
  }
  await browser.close();
}

// ══════════════ D. 手機側:依設計就沒有排序鈕(360/375/414/768 × chromium+webkit) ══════════════
// 這是 C 段搬家後留下的另一半:≤900 走 fs 手機殼,護照改由 #ridePanel 渲染,固定「日期最新在前」、
// 刻意不出排序鈕(index.html:10820)。把它寫成正式判準,以後有人把排序鈕加進手機版、或反過來把
// 桌面那顆誤刪,都會在這裡轉紅,而不是像先前那樣以 0×0 全綠收場。
// D2/D3 是 D1 那個「零」的正向對照:sheet 真的開了、完乘列表真的有列——否則「找不到排序鈕」
// 只是因為面板根本沒開(同一支收集器要能同時證明「該有的有」與「不該有的沒有」)。
for (const [engName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch();
  console.log(`\n═══ D. ${engName} 手機側:護照 sheet 無排序鈕(360/375/414/768) ═══`);
  for (const width of [360, 375, 414, 768]) {
    const { ctx, page } = await bootPage(browser, { width, height: 800, touch: true });
    // 走使用者真正的入口:底部分頁「護照」(內部轉呼叫 rideBtn.click() → openRidePanel(),
    // 同 verify_founding_seal 的寫法);localStorage 的 trainmap-passport-open 只管桌面卡片展開,開不了 sheet。
    await page.tap('#tabRide');
    await page.waitForTimeout(350);
    const m = await page.evaluate(() => {
      const rp = document.getElementById('ridePanel');
      const vis = el => { if (!el || el.hidden) return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
      return {
        fsShell: document.body.classList.contains('fs'),
        panelOpen: vis(rp),
        rows: rp ? rp.querySelectorAll('.ph-row').length : -1,
        sortInSheet: rp ? rp.querySelectorAll('.ph-sort, [data-v]').length : -1,
        desktopPassportShown: vis(document.getElementById('passport')),
      };
    });
    ok(`${engName} D-${width} 手機殼生效(body.fs)且桌面 #passport 不顯示`, m.fsShell === true && m.desktopPassportShown === false, JSON.stringify(m));
    ok(`${engName} D-${width} 正向對照:點護照分頁後 sheet 真的開了`, m.panelOpen === true, `panelOpen=${m.panelOpen}`);
    ok(`${engName} D-${width} 正向對照:sheet 內完乘列表有列(${RIDES.length} 筆)`, m.rows === RIDES.length, `rows=${m.rows}`);
    ok(`${engName} D-${width} 手機護照 sheet 依設計無排序鈕`, m.sortInSheet === 0, `sortInSheet=${m.sortInSheet}`);
    await ctx.close();
  }
  await browser.close();
}

server.close();
ok('全程零 JS 例外(pageerror/console.error)', allErrors.length === 0, allErrors.slice(0, 5).join(' | '));

const fail = results.filter(r => !r.pass);
console.log(`\n──────── ${results.length - fail.length}/${results.length} PASS ────────`);
if (fail.length) { console.log('FAIL:', fail.map(f => f.name).join(' ; ')); process.exit(1); }
console.log('全部 PASS');
process.exit(0);
