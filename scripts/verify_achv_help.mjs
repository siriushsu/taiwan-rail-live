// 成就/收集章說明卡驗收 —— Playwright 真引擎(chromium 桌面 + webkit 手機觸控)。
//
// 這支要抓的失效模式(每一條都對應一個真的踩過或結構上會踩的坑):
//  1) 卡片被裁切/被封頂:#ridePanel 是 overflow-y:auto 的捲動盒、.board 住在 .stage(手機 fixed+z1000)。
//     computed style 完全照不到這兩種死法(心得 24),所以一律量「卡片 rect 是否整個在視窗內」
//     ＋「裁圖不是單一底色」的像素證據。#helpPop 是 pointer-events:none,故**不能**用
//     elementFromPoint 命中它——那會穿透到底下的元素,永遠測不到卡片。
//  2) 內容錯配(卡片開了,但顯示的是別枚章):逐一掃全部 21 枚比對標題,不抽樣。
//  3) 進度算錯:期望值**由本腳本從 fixture 獨立手算**,不呼叫頁面的 ACH_PROG(心得 29:
//     判準與實作同源會集體失明);namedAll/stockAll/branchAll 的分母直接讀 JSON 資料檔。
//  4) 回歸:收集章的點擊本來就是「跳去跟那班車」(followDexStamp),說明卡不准搶走它。
//  5) 原生 title 殘留:留著會與自製卡片同時冒出來,兩層 tooltip。
//  6) 觸控:點按開卡、再點同一枚收起、點別處收起——真的用 tap,不用 hover 冒充。
//  7) 語系漂移:A6/A7/B3 比的是畫面上的中文字,Playwright chromium 預設 en-US 會讓整頁變英文而假紅
//     (08-28 多語上線後一直紅)。網址 ?lang 與 context locale 兩道都釘,A0/B0 具名閘門先確認真的是中文。
//  8) 鍵盤與讀螢幕軟體:說明卡此前只接滑鼠與點按,Tab 到章上什麼都沒有;收集章連焦點都拿不到。
//     一律真按 Tab/Enter/Esc,讀螢幕軟體那半用 chromium 無障礙樹實際算出的描述,不看屬性在不在。
//     觸控點按也會聚焦,聚焦就開卡會跟「再點一次收起」互相抵銷——B3/B6 同時守這條。焦點離開只收鍵盤開的卡,
//     點按開的卡歸「點別處收起」管(否則 focusout 先收,B7/B8 量不到 click 那條);錨點被重繪換掉要收(B9)。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 網址 ?lang 是 index.html 自己的最高優先語系開關(query > localStorage > navigator);
// context locale 管 navigator.language 與沒帶 locale 的 Intl——兩道缺一,閘門就要紅。
const PAGE_LOCALE = 'zh-TW';
const PAGE_QS = `?lang=${PAGE_LOCALE}`;

// ── 第一道 gate:先證明驗的是這棵樹(心得 32:驗收腳本吃錯目標會兩輪全綠) ──
const INDEX = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
console.log('驗證目標:', path.join(ROOT, 'index.html'));
console.log('  BUILD:', (INDEX.match(/const BUILD = '([^']*)'/) || [])[1]);
console.log('  行數:', INDEX.split('\n').length);
if (!INDEX.includes('const ACH_PROG')) { console.log('FATAL: 這棵樹沒有 ACH_PROG,驗錯目標'); process.exit(1); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
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
// 埠號讓系統挑:這支在 ship-web 鏈上(2.24),固定埠會撞到別的 session 手動跑的同一支(同 2.23 的理由)。
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

// ══ fixture:4 筆完乘,每一枚成就的期望值都刻意落在「非 0 且未達標」的中間帶 ══
// 站名刻意全異且不含臺/台歧義以外的重複:台北/基隆/高雄/花蓮 = 4 座。
const RIDES = [
  { train: '1200', sys: 'tra_sched', kind: '區間車',   from: '台北', to: '基隆', km: 25,  date: '2026-08-10', dep: 21600, stops: 8 },
  { train: '1201', sys: 'tra_sched', kind: '區間車',   from: '基隆', to: '台北', km: 30,  date: '2026-08-10', dep: 72000, stops: 8 },
  { train: '99',   sys: 'tra_sched', kind: '自強號',   from: '台北', to: '高雄', km: 375, date: '2026-08-11', dep: 25200, stops: 16 },
  { train: '400',  sys: 'tra_sched', kind: '普悠瑪號', from: '高雄', to: '花蓮', km: 180, date: '2026-08-12', dep: 30000, stops: 6, stockId: 'puyuma' },
];
// ── 期望值:本腳本自己算,一律不碰頁面內部函式 ──
const SPECIAL = JSON.parse(readFileSync(path.join(ROOT, 'data/tra_special_trains.json'), 'utf8'));
const N_NAMED = SPECIAL.namedTrains.filter(x => x.trainNos && x.trainNos.length).length;
const N_STOCK = SPECIAL.rollingStock.length;
const N_BRANCH = SPECIAL.branchLines.length;
// 收集章名稱同樣讀 JSON——頁面的 data-tipname 正是卡片標題的來源,拿它當期望值等於自己比自己。
const STAMP_NAME = {};
for (const [cat, list] of [['named', SPECIAL.namedTrains], ['stock', SPECIAL.rollingStock], ['branch', SPECIAL.branchLines]])
  for (const x of list) STAMP_NAME[cat + '|' + x.id] = x.name;
const TOT_KM = RIDES.reduce((a, r) => a + r.km, 0);            // 610
const MAX_KM = Math.max(...RIDES.map(r => r.km));              // 375
const MAX_STOPS = Math.max(...RIDES.map(r => r.stops));        // 16
const MAX_DAY = Math.max(...Object.values(RIDES.reduce((m, r) => (m[r.date] = (m[r.date] || 0) + 1, m), {}))); // 2
const N_STN = new Set(RIDES.flatMap(r => [r.from, r.to])).size; // 4
const MIN_DEP = Math.min(...RIDES.map(r => r.dep));             // 21600 = 06:00
const MAX_DEP = Math.max(...RIDES.map(r => r.dep));             // 72000 = 20:00
const hm = s => String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor(s % 3600 / 60)).padStart(2, '0');
const num = n => Number(n).toLocaleString('en-US');

// id → { name, got, expect }。expect 是卡片上「進度那一行」該出現的字串;null=已達成(不畫進度)。
const EXPECT = {
  first:      { name: '初乘紀念',       got: true },
  rider5:     { name: '月台常客',       got: false, prog: `${RIDES.length} / 5 趟` },
  rider15:    { name: '鐵道魂',         got: false, prog: `${RIDES.length} / 15 趟` },
  km100:      { name: '百里行者',       got: true },
  km500:      { name: '半島縱走',       got: true },
  km1000:     { name: '千里鐵道',       got: false, prog: `${num(TOT_KM)} / ${num(1000)} km` },
  km5000:     { name: '五千公里俱樂部', got: false, prog: `${num(TOT_KM)} / ${num(5000)} km` },
  long300:    { name: '一氣呵成',       got: true },
  stops50:    { name: '站站是風景',     got: false, prog: `${MAX_STOPS} / 50 站（最多的一趟）` },
  early:      { name: '早鳥',           got: false, note: `你目前最早跟過 ${hm(MIN_DEP)} 發車的車。` },
  night:      { name: '夜行者',         got: false, note: `你目前最晚跟過 ${hm(MAX_DEP)} 發車的車。` },
  loop:       { name: '山海平原',       got: false, note: '還沒跟滿過半圈——中途中斷會從頭算。' },
  day3:       { name: '一日三乘',       got: false, prog: `${MAX_DAY} / 3 趟（同一天最多）` },
  tilting:    { name: '傾斜雙雄',       got: false, prog: `1 / 2 枚` },
  namedAll:   { name: '明星集郵冊',     got: false, prog: `0 / ${N_NAMED} 枚` },
  stockAll:   { name: '車種全圖鑑',     got: false, prog: `1 / ${N_STOCK} 種` },
  branchAll:  { name: '支線制霸',       got: false, prog: `0 / ${N_BRANCH} 條` },
  stn25:      { name: '車站巡禮',       got: false, prog: `${N_STN} / 25 座` },
  stn100:     { name: '百站達成',       got: false, prog: `${N_STN} / 100 座` },
  commute100: { name: '通勤的證明',     got: false, prog: `0 / 100 次（最常搭的一段）` },
  commute500: { name: '老通勤族',       got: false, prog: `0 / 500 次（最常搭的一段）` },
};

function buildEnvelope(rides) {
  const at = Date.now();
  return {
    version: 1, deviceId: 'verify-achv-help', revision: 1, updatedAt: at,
    collections: {
      pins: { items: [], tombstones: [] },
      favs: { items: [], tombstones: [] },
      rides: { items: rides.map(r => ({ id: (r.sys || 'tra_sched') + '|' + r.train + '|' + r.date, value: r, updatedAt: at })), tombstones: [] },
      stations: { items: [], tombstones: [] },
    },
  };
}
const ENVELOPE = buildEnvelope(RIDES);
const allErrors = [];

async function bootPage(browser, { width = 1280, height = 900, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1, locale: PAGE_LOCALE });
  await ctx.addInitScript((envelope) => {
    localStorage.setItem('trainmap-howto-seen', '1');       // 首訪教學卡會蓋住地圖內元件
    localStorage.setItem('trainmap-appearance', 'light');
    localStorage.setItem('trainmap-passport-open', '1');
    localStorage.setItem('trainmap-user-data-v1', JSON.stringify(envelope));
    // 閘門要驗進場網址帶了 ?lang,但開機途中 clearFollow() 會 replaceState 抹掉整條 query,
    // 事後讀 location.search 恆為空。init script 跑在頁面任何 script 之前,這裡存到的才是進場網址。
    window.__bootSearch = location.search;
  }, ENVELOPE);
  const page = await ctx.newPage();
  page.on('pageerror', e => allErrors.push('pageerror: ' + e));  // waitReady 逾時多半是 boot 靜默拋錯
  page.on('console', m => { if (m.type() === 'error') allErrors.push('console: ' + m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/${PAGE_QS}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready; } catch (e) { return false; } }, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  return { ctx, page };
}

// 具名前置閘門:這一頁真的是中文。語系一漂,A6/A7/B3 會各報各的英文字串,看不出共同上游。
// 期望值是這裡手打的中文字面,不從頁面反推。兩個樣本各是 A6 標題與 A7 狀態讀的那條翻譯,
// 在 en 之下都會變值(實測「First journey」「Not yet」)。nav 守第二道釘子:只有 context locale
// 漂掉時,其餘幾項全靠網址 ?lang 撐著照樣會綠。
async function langGate(page, tag) {
  const g = await page.evaluate(() => ({
    lang: window.__i18n ? window.__i18n.lang : null,
    doc: document.documentElement.lang,
    nav: navigator.language,
    qs: window.__bootSearch,
    name: window.__i18n ? window.__i18n.t('初乘紀念') : null,
    st: window.__i18n ? window.__i18n.t('未達成') : null,
  }));
  ok(`${tag}0 語系釘死在 zh-TW(文案判準的前提)`,
    g.lang === PAGE_LOCALE && g.doc === PAGE_LOCALE && g.nav === PAGE_LOCALE &&
    new URLSearchParams(g.qs || '').get('lang') === PAGE_LOCALE && g.name === '初乘紀念' && g.st === '未達成',
    JSON.stringify(g));
}

// 卡片的可見性證據:①rect 整個在視窗內 ②裁圖不是單一底色(≥12 種相異色)
// pointer-events:none ⇒ 不能用 elementFromPoint 命中卡片本身,那會穿透。
async function popEvidence(page) {
  const r = await page.evaluate(() => {
    const p = document.getElementById('helpPop');
    if (!p || p.hidden) return null;
    const b = p.getBoundingClientRect(), cs = getComputedStyle(p);
    return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom,
      disp: cs.display, vis: cs.visibility, op: +cs.opacity, z: cs.zIndex, pos: cs.position,
      title: (p.querySelector('.hp-t span') || {}).textContent || '',
      cond: (p.querySelector('.hp-cond') || {}).textContent || '',
      num: (p.querySelector('.hp-num') || {}).textContent || '',
      note: (p.querySelector('.hp-note') || {}).textContent || '',
      how: (p.querySelector('.hp-how') || {}).textContent || '',
      hasBar: !!p.querySelector('.hp-bar i'),
      barW: p.querySelector('.hp-bar i') ? p.querySelector('.hp-bar i').style.width : '',
    };
  });
  if (!r) return null;
  const vp = page.viewportSize();
  r.inView = r.x >= 0 && r.y >= 0 && r.right <= vp.width + 0.5 && r.bottom <= vp.height + 0.5;
  if (r.w > 2 && r.h > 2 && r.inView) {
    const buf = await page.screenshot({ clip: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.w), height: Math.round(r.h) } });
    // 用瀏覽器自己解 PNG 數相異色(不加 pngjs 依賴)。單一底色 ⇒ 卡片是空的或被整片蓋住。
    r.colors = await page.evaluate(async (u) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = u; });
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data, s = new Set();
      for (let i = 0; i < d.length; i += 4) s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return s.size;
    }, 'data:image/png;base64,' + buf.toString('base64'));
  } else r.colors = 0;
  return r;
}

// ═══════════ A. 桌面 chromium:hover 開卡、21 枚逐一比對內容與進度 ═══════════
{
  const browser = await chromium.launch();
  const { ctx, page } = await bootPage(browser);
  console.log('\n═══ A. chromium 1280×900 — 桌面 hover ═══');
  await langGate(page, 'A');

  const seals = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#passport .seal[data-ach]')).map(e => e.dataset.ach));
  ok('A1 護照長出 21 枚成就章(帶 data-ach)', seals.length === 21, `實測 ${seals.length} 枚`);
  ok('A2 data-ach 的 id 集合與期望完全相同', JSON.stringify(seals.slice().sort()) === JSON.stringify(Object.keys(EXPECT).sort()),
    seals.length === 21 ? '' : `多/少: ${seals.filter(s => !EXPECT[s]).join(',')}`);

  // 原生 title 必須清乾淨,否則自製卡片與瀏覽器 tooltip 會同時出現
  const leftoverTitle = await page.evaluate(() =>
    document.querySelectorAll('#passport .seal[data-ach][title], #passport .seal[data-tip][title]').length);
  ok('A3 成就章/收集章不再殘留原生 title', leftoverTitle === 0, `殘留 ${leftoverTitle} 個`);

  // 未 hover 時卡片必須是關的(正向對照:避免「永遠開著」也能通過後面每一條)
  const before = await popEvidence(page);
  ok('A4 未 hover 時說明卡是關的', before === null, before ? '卡片竟然已開' : '');

  let contentBad = [], progBad = [], visBad = [], checked = 0;
  for (const id of seals) {
    const e = EXPECT[id];
    await page.hover(`#passport .seal[data-ach="${id}"]`);
    await page.waitForTimeout(60);
    const p = await popEvidence(page);
    // 卡片沒開就無從比對內容 ⇒ 那一枚會被跳過。這正是「分母無聲縮水」的入口:
    // 第一版跑出來 first 沒開,A6/A7 卻照樣全綠。checked 就是把分母釘死的具名斷言。
    if (!p) { visBad.push(`${id}:卡片沒開`); continue; }
    checked++;
    if (!p.inView) visBad.push(`${id}:超出視窗 rect=${p.x.toFixed(0)},${p.y.toFixed(0)},${p.w.toFixed(0)}x${p.h.toFixed(0)}`);
    if (p.colors < 12) visBad.push(`${id}:裁圖只有 ${p.colors} 色(疑似空白/被遮)`);
    if (p.pos !== 'fixed') visBad.push(`${id}:position=${p.pos}(必須 fixed 才逃得出捲動盒)`);
    if (p.title !== e.name) contentBad.push(`${id}:標題「${p.title}」≠「${e.name}」`);
    if (!p.how) contentBad.push(`${id}:攻略欄是空的`);
    if (e.got) {
      if (!/已達成/.test(await page.evaluate(() => (document.querySelector('#helpPop .hp-st') || {}).textContent || '')))
        progBad.push(`${id}:應為已達成`);
      if (p.hasBar) progBad.push(`${id}:已達成卻仍畫進度條`);
    } else {
      const st = await page.evaluate(() => (document.querySelector('#helpPop .hp-st') || {}).textContent || '');
      if (!/未達成/.test(st)) progBad.push(`${id}:應為未達成,實得「${st}」`);
      if (e.prog && p.num.trim() !== e.prog) progBad.push(`${id}:進度「${p.num.trim()}」≠「${e.prog}」`);
      if (e.note && p.note.trim() !== e.note) progBad.push(`${id}:現況「${p.note.trim()}」≠「${e.note}」`);
    }
  }
  ok(`A5 21 枚卡片都真的開起來且完整可見`, visBad.length === 0, visBad.slice(0, 4).join(' / '));
  ok(`A5b 內容比對的分母真的是 21(沒有被跳過的)`, checked === 21, `實際比對 ${checked}/21 枚`);
  ok(`A6 21 枚卡片標題與該枚章一致(逐枚,不抽樣)`, contentBad.length === 0, contentBad.slice(0, 4).join(' / '));
  ok(`A7 21 枚的達成狀態與進度數字全部正確`, progBad.length === 0, progBad.slice(0, 4).join(' / '));

  // 移開就要收起來
  await page.mouse.move(5, 5);
  await page.waitForTimeout(80);
  ok('A8 滑鼠移開後說明卡收起', (await popEvidence(page)) === null);

  // 收集章:hover 出故事卡
  const stampIds = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#passport .seal[data-tip]')).slice(0, 3).map(e => e.dataset.id));
  let stampBad = [];
  for (const sid of stampIds) {
    await page.hover(`#passport .seal[data-tip][data-id="${sid}"]`);
    await page.waitForTimeout(60);
    const p = await popEvidence(page);
    if (!p || !p.how || !p.title) stampBad.push(sid);
  }
  ok('A9 收集章 hover 也出說明卡', stampIds.length > 0 && stampBad.length === 0, `壞掉: ${stampBad.join(',')}`);

  // 回歸:收集章的點擊仍然是「去跟那班車」,不能被說明卡搶走
  const followed = await page.evaluate(async () => {
    const el = document.querySelector('#passport .seal[data-tip]');
    if (!el) return 'no-seal';
    window.__followCalled = null;
    const orig = window.followDexStamp;
    if (typeof orig !== 'function') return 'no-fn';
    window.followDexStamp = (cat, id) => { window.__followCalled = cat + '|' + id; };
    el.click();
    window.followDexStamp = orig;
    return window.__followCalled || 'not-called';
  });
  ok('A10 收集章點擊仍觸發 followDexStamp(說明卡沒搶走既有行為)',
    followed !== 'not-called' && followed !== 'no-seal' && followed !== 'no-fn', `實得: ${followed}`);

  // ══ 鍵盤與讀螢幕軟體(失效模式 8):起點用程式聚焦,之後一律真按鍵——Tab 才保證焦點框亮起 ══
  await page.mouse.move(5, 5);
  const kbd = () => page.evaluate(() => {
    const a = document.activeElement, p = document.getElementById('helpPop'), d = (a && a.dataset) || {};
    return { ach: d.ach || null, key: d.cat ? d.cat + '|' + d.id : null,
      desc: a && a.getAttribute ? a.getAttribute('aria-describedby') : null,
      open: !p.hidden, title: (p.querySelector('.hp-t span') || {}).textContent || '', popRole: p.getAttribute('role') };
  });
  // 讀螢幕軟體拿到的是瀏覽器算好的無障礙樹(角色/名稱/描述),不是屬性本身——直接問 chromium 算出了什麼
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Accessibility.enable');
  const axOf = async (sel) => {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
    if (!nodeId) return { role: null, name: '', desc: '' };
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    const n = nodes[0] || {};
    return { role: n.role ? n.role.value : null, name: n.name ? n.name.value : '', desc: n.description ? n.description.value : '' };
  };

  await page.focus(`#passport .seal[data-ach="${seals[0]}"]`);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(60);
  const k1 = await kbd();
  ok('A11 Tab 移到下一枚成就章就開出那一枚的說明卡', k1.ach === seals[1] && k1.open && k1.title === (EXPECT[seals[1]] || {}).name,
    JSON.stringify(k1));
  const p11 = await popEvidence(page);
  const ax1 = await axOf(`#passport .seal[data-ach="${seals[1]}"]`);
  ok('A12 讀螢幕軟體聚焦時唸得到說明卡(無障礙樹的描述含卡上的條件與攻略)',
    k1.desc === 'helpPop' && k1.popRole === 'tooltip' && !!p11 && !!p11.cond && !!p11.how.trim() &&
    ax1.desc.includes(p11.cond) && ax1.desc.includes(p11.how.trim()),
    `describedby=${k1.desc} role=${k1.popRole} 描述「${ax1.desc.slice(0, 60)}」`);

  const stampKeys = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#passport .seal[data-tip]')).map(e => e.dataset.cat + '|' + e.dataset.id));
  const stampSel = k => { const [c, i] = String(k).split('|'); return `#passport .seal[data-cat="${c}"][data-id="${i}"]`; };
  await page.focus(stampSel(stampKeys[0]));
  await page.keyboard.press('Tab');
  await page.waitForTimeout(60);
  const k2 = await kbd();
  const ax2 = await axOf(stampSel(stampKeys[1]));
  const want2 = STAMP_NAME[stampKeys[1]];
  // 讀螢幕名稱要恰好是「名稱：章下那行字」(aria-label):只比開頭抓不到 aria-label 被拿掉——那時名稱改由內容
  // 算出(sealName 拆行的名稱＋章下字),開頭一樣是名稱。語系釘在 zh-TW ⇒ 冒號是全形(i18nLabel)。
  const foot2 = await page.evaluate(s => (document.querySelector(s + ' small') || {}).textContent || '', stampSel(stampKeys[1]));
  ok('A13 收集章 Tab 到得了、開出自己的說明卡,而且是按鈕',
    stampKeys.length > 2 && !!want2 && k2.key === stampKeys[1] && k2.open && k2.title === want2 &&
    ax2.role === 'button' && !!foot2 && ax2.name === want2 + '：' + foot2,
    `${JSON.stringify(k2)} 期望標題「${want2}」 role=${ax2.role} 名稱「${ax2.name}」 期望名稱「${want2}：${foot2}」`);

  await page.evaluate(() => {
    window.__followCalled = null; window.__followOrig = window.followDexStamp;
    window.followDexStamp = (cat, id) => { window.__followCalled = cat + '|' + id; };
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(60);
  const entered = await page.evaluate(() => { const r = window.__followCalled; window.followDexStamp = window.__followOrig; return r; });
  ok('A14 收集章按 Enter 等同點擊(去跟那班車)', entered === stampKeys[1], `實得: ${entered}`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
  const k3 = await kbd();
  ok('A15 Esc 收起說明卡、焦點留在原地、aria-describedby 一併拿掉',
    k2.open && !k3.open && k3.key === stampKeys[1] && k3.desc === null, JSON.stringify(k3));

  await page.keyboard.press('Tab');
  await page.waitForTimeout(60);
  const k4 = await kbd();
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForTimeout(60);
  const k5 = await kbd();
  const leftDesc = await page.evaluate(() => document.querySelectorAll('[aria-describedby="helpPop"]').length);
  ok('A16 焦點離開就收卡,不留指向空卡的 aria-describedby', k4.key === stampKeys[2] && k4.open && !k5.open && leftDesc === 0,
    `Tab 後 ${JSON.stringify(k4)} / blur 後 open=${k5.open} 殘留 describedby ${leftDesc} 個`);

  // A17:卡片開著時換到別枚錨點(黏住的卡上再 hover 別枚、followDexStamp 在開著的卡上換錨點),舊的那枚要拿掉
  // aria-describedby(showHelpPop 開頭那行)。A16 走的是「先 focusout 收卡再開」,碰不到這條,所以直接呼叫。
  const sw = await page.evaluate(([a, b]) => {
    const ea = document.querySelector(a), eb = document.querySelector(b);
    showHelpPop(ea, helpPopHtmlFor(ea)); showHelpPop(eb, helpPopHtmlFor(eb));
    const r = { a: ea.getAttribute('aria-describedby'), b: eb.getAttribute('aria-describedby') };
    hideHelpPop(); return r;
  }, [`#passport .seal[data-ach="${seals[0]}"]`, `#passport .seal[data-ach="${seals[1]}"]`]);
  ok('A17 換錨點時舊錨點的 aria-describedby 跟著拿掉(只剩新錨點指向卡片)', sw.a === null && sw.b === 'helpPop', JSON.stringify(sw));

  await ctx.close(); await browser.close();
}

// ═══════════ B. 手機 webkit 觸控:點按開卡 / 再點收起 / 點別處收起 ═══════════
{
  const browser = await webkit.launch();
  const { ctx, page } = await bootPage(browser, { width: 390, height: 844, touch: true });
  console.log('\n═══ B. webkit 390×844 觸控 — 手機點按 ═══');
  await langGate(page, 'B');

  await page.evaluate(() => { if (typeof openRidePanel === 'function') openRidePanel(); });
  await page.waitForTimeout(400);
  const chips = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#ridePanel .achv-chip[data-ach]')).map(e => e.dataset.ach));
  ok('B1 手機護照 sheet 長出 21 枚成就 chip', chips.length === 21, `實測 ${chips.length} 枚`);

  // A3 的 sheet 版:sheet 是另一份 markup(buildAchv 'chip'＋帶日期的 buildStamps),A3 只量得到桌面 #passport。
  // 桌面也開得出這張 sheet,留著 title 一樣兩層提示。收集章數要 >0,否則「0 殘留」是空過(chip 數由 B1 把關)。
  const sheetTitle = await page.evaluate(() => ({
    left: document.querySelectorAll('#ridePanel [data-ach][title], #ridePanel [data-tip][title]').length,
    ach: document.querySelectorAll('#ridePanel [data-ach]').length,
    tip: document.querySelectorAll('#ridePanel [data-tip]').length,
  }));
  ok('B1b 手機護照 sheet 的成就 chip/收集章也不殘留原生 title', sheetTitle.tip > 0 && sheetTitle.left === 0,
    `殘留 ${sheetTitle.left} 個(成就 ${sheetTitle.ach}、收集章 ${sheetTitle.tip})`);

  const target = 'rider5';
  const sel = `#ridePanel .achv-chip[data-ach="${target}"]`;
  await page.locator(sel).scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);

  ok('B2 點按前說明卡是關的', (await popEvidence(page)) === null);

  await page.tap(sel);
  await page.waitForTimeout(120);
  const p1 = await popEvidence(page);
  const d3 = await page.evaluate(s => document.querySelector(s).getAttribute('aria-describedby'), sel);
  ok('B3 點按 chip 開出說明卡', !!p1 && p1.title === EXPECT[target].name, p1 ? `標題「${p1.title}」` : '沒開');
  ok('B4 手機卡片完整在視窗內、非空白', !!p1 && p1.inView && p1.colors >= 12,
    p1 ? `inView=${p1.inView} 色數=${p1.colors} rect=${p1.x.toFixed(0)},${p1.y.toFixed(0)} ${p1.w.toFixed(0)}x${p1.h.toFixed(0)}` : '');
  ok('B5 手機卡片進度數字正確', !!p1 && p1.num.trim() === EXPECT[target].prog,
    p1 ? `「${p1.num.trim()}」期望「${EXPECT[target].prog}」` : '');

  await page.tap(sel);
  await page.waitForTimeout(120);
  ok('B6 再點同一枚收起', (await popEvidence(page)) === null);
  const d6 = await page.evaluate(s => document.querySelector(s).getAttribute('aria-describedby'), sel);
  ok('B6b 開卡時 chip 以 aria-describedby 指向卡片、收起就拿掉', d3 === 'helpPop' && d6 === null, `開=${d3} 收=${d6}`);

  // 外接鍵盤(iPad 那種):WebKit 的焦點框判定是另一套實作,A11 只量了 chromium。
  // 上面兩下點按也讓 chip 拿到了焦點——那時焦點框不亮、不准開卡,B3/B6 已經守住;這裡驗亮的時候要開。
  await page.evaluate(s => document.querySelector(s).focus(), `#ridePanel .achv-chip[data-ach="${chips[0]}"]`);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(80);
  const kb = await page.evaluate(() => ({ ach: document.activeElement.dataset.ach || null,
    open: !document.getElementById('helpPop').hidden,
    title: (document.querySelector('#helpPop .hp-t span') || {}).textContent || '' }));
  ok('B6c 外接鍵盤 Tab 到下一枚 chip 就開出那一枚的說明卡', kb.ach === chips[1] && kb.open && kb.title === (EXPECT[chips[1]] || {}).name,
    JSON.stringify(kb));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);

  // B7/B8:點別處要收。刻意分兩個落點——面板「內」的空白與面板「外」的地圖。
  // 面板內那一下曾經整個失效(#ridePanel 的 click 冒泡不到 document,被中途 stopPropagation),
  // 只驗面板外會漏掉它,所以兩個都要驗。
  await page.tap(sel);
  await page.waitForTimeout(120);
  const opened1 = !!(await popEvidence(page));
  await page.tap('#ridePanel h3', { position: { x: 5, y: 5 } });
  await page.waitForTimeout(180);
  ok('B7 點面板內空白處收起', opened1 && (await popEvidence(page)) === null, opened1 ? '' : '前一步沒開起來');

  await page.locator(sel).scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  await page.tap(sel);
  await page.waitForTimeout(120);
  const opened2 = !!(await popEvidence(page));
  await page.touchscreen.tap(195, 120);   // 面板外的地圖區
  await page.waitForTimeout(180);
  ok('B8 點面板外(地圖)收起', opened2 && (await popEvidence(page)) === null, opened2 ? '' : '前一步沒開起來');

  // B9:外接鍵盤 Tab 到收集章按 Enter 去跟車 ⇒ 面板收起、錨點被清掉,說明卡要跟著收。WebKit 移除聚焦中的節點
  // 不送 focusout(chromium 會),09-25 實測卡片孤零零留在地圖上。有沒有車可跟看當下時刻 ⇒「有車」與「跟車」
  // 都換成替身,不讓這條在沒車的時段變成沒樣本。
  if (await page.evaluate(() => document.getElementById('ridePanel').hidden)) await page.tap('#tabRide');
  await page.waitForFunction(() => !document.getElementById('ridePanel').hidden && document.querySelectorAll('#ridePanel .seal[data-cat]').length > 1);
  const b9keys = await page.evaluate(() => {
    window.__dexOrig = window.dexCandidates; window.__followOrig = window.followDexStamp; window.__followed = null;
    window.dexCandidates = () => [{ train: '0', sys: 'tra' }];
    window.followDexStamp = (cat, id) => { window.__followed = cat + '|' + id; };
    return Array.from(document.querySelectorAll('#ridePanel .seal[data-cat]')).slice(0, 2).map(e => e.dataset.cat + '|' + e.dataset.id);
  });
  const b9sel = k => { const [c, i] = k.split('|'); return `#ridePanel .seal[data-cat="${c}"][data-id="${i}"]`; };
  await page.evaluate(s => document.querySelector(s).focus(), b9sel(b9keys[0]));
  await page.keyboard.press('Tab');
  await page.waitForTimeout(80);
  const b9open = await page.evaluate(() => !document.getElementById('helpPop').hidden && !!state._helpPopFor);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const b9 = await page.evaluate(() => {
    const r = { panelHidden: document.getElementById('ridePanel').hidden, popOpen: !document.getElementById('helpPop').hidden, followed: window.__followed };
    window.dexCandidates = window.__dexOrig; window.followDexStamp = window.__followOrig; return r;
  });
  ok('B9 外接鍵盤在收集章按 Enter 去跟車:面板收起後說明卡跟著收(WebKit 移除聚焦節點不送 focusout)',
    b9open && b9.followed === b9keys[1] && b9.panelHidden && !b9.popOpen, JSON.stringify({ open: b9open, ...b9, want: b9keys[1] }));

  await ctx.close(); await browser.close();
}

await new Promise(r => server.close(r));
const fail = results.filter(r => !r.pass);
console.log(`\n總計 ${results.length} 項 · 通過 ${results.length - fail.length} · 失敗 ${fail.length}`);
if (allErrors.length) console.log('頁面錯誤:', allErrors.slice(0, 5).join(' | '));
if (fail.length) { console.log('失敗項:', fail.map(f => f.name).join(', ')); process.exit(1); }
