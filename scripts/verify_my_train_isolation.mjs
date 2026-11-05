#!/usr/bin/env node
// 自製列車:隔離守門腳本。
//
// 目的:自製車(使用者自己排的班)絕不可洩漏到——網址、分享連結、Firestore、原生橋接、推播、
// WebMCP、完乘統計。這支腳本是那些邊界的守門人,並且從真的介面走一遍整個流程(車庫卡片→
// 排班表單→發車→編輯→刪除),不直接呼叫 MyTrainUI.save/ownTrainRebuild 繞過畫面。
//
// 精簡版,明確【不做】:
//   交會期望集合的搜尋、切頁籤那一段、findRoute/buildRunStats 計數替身、開機落在捷運頁籤那一步。
//   本檔因此只走台鐵(tra_sched),不驗交會事件,只驗發車/停靠/抵達與「沒有待避禮讓」。
//
// 面板/表單/車庫卡片 DOM 契約(實作見 my-train-ui.js、train-garage.js):
//   面板根節點:任一位置的 [data-mt-panel]。名字文字:[data-mt-name](textContent,data-i18n-skip)。
//   面板操作:[data-mt-action="halo"|"size"|"edit"|"delete"],結束跟車沿用既有 #fpEnd。
//   事件列狀態:state.ownTrainLog.items(本檔讀 state 不讀 DOM)。
//   排班表單:<dialog id="mtForm" data-mt-form>,欄位 [data-mt-f=...],建議列 [data-mt-sug=...]/
//   [data-mt-sug-key],停站 [data-mt-fpattern=...],山海線 [data-mt-fvia=...]。
//   車庫卡片:[data-mt-g="schedule"|"view"|"replan"|"status"|"note"|"hint"]。
//
// 【已知簡化,誠實記在這裡而不是假裝驗過】:
//   - Firestore 零寫入:只在網路層看有沒有打到 firestore.googleapis.com——本檔沒有登入帳號,
//     account/Firestore 子系統本來就不會啟動,這條在修復前後都可能是綠的,不是強訊號。
//   - [推播綁定](pushToken 回呼不綁定)與 [即時動態](laSync 本身不呼叫原生橋接)目前用同一份觀測證據
//     (RAIL_NATIVE_LIVEACTIVITY 零呼叫紀錄)——原生 stand-in 的 addListener 不會真的觸發回呼,
//     沒有模擬真正的 push token 到達去分別驗證兩個關卡,兩個標籤現在指向同一個訊號。
//   - 兩處仍直接呼叫 ownTrainFollow()(app 的函式,不是下面的測試 helper
//     followOwnTrain):「[換車] 真車直接換自製車」量測 laSync 是否放行時,_laKey 必須跟切換
//     發生在同一個 JS tick,中間任何一次動畫幀都可能讓 laSync 先把它收掉——改走 UI 點擊在
//     evaluate()/click() 兩次往返之間插進不受控的幀,會重新引入這個競態,所以維持直接呼叫。
//     手機「列車 sheet 開著時直接換自製車」那條同理:要考的是「換車當下 sheet 有沒有被收掉」,
//     經由 UI 點擊會先繞經車庫、車庫本身就會先把 sheet 收掉,反而測不到要測的轉場時機。
//     測「去看它」語意的地方已經改走真的點 [data-mt-g="view"],見 pressViewOnCard()。
//
// 慣例依 scripts/verify_transfer_follow_pin.mjs(硬性):自帶 node:http 靜態伺服器、不用全攔式
// route、語系鎖 zh-TW、pageerror 掛勾、T0 身分自檢、chromium+webkit 都跑。

import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// [名牌方向] 檢查借用的 PNG 解碼器(playwright-core 內建、不必另外裝依賴)。
const { PNG } = createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
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
// 埠號由系統挑、只綁 127.0.0.1（跟 main d7e08580 出貨閘門同一套）：寫死 5531 時撞過別的 session 手動跑的 server。
// 給 PORT 就用那個埠；被佔用時 listen 直接報錯停下，不會量到別人的 server。
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(process.env.PORT || 0), '127.0.0.1', resolve); });
const PORT = server.address().port;

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// ── 外部網路雜訊──────────────────────────────────────────────────
// 瀏覽器替「跨來源資源載入失敗」自己印的 console 錯誤:外部圖磚 CDN 一時失手、整頁重新整理時被取消的
// 圖磚 fetch、整台機器斷網。自製列車不打任何外部網址,這類訊息跟隔離無關,卻讓這支閘門(ship_web 2.27)
// 隨機變紅:斷網(openfreemap 與 metro-core)、WebKit 整頁時取消 openfreemap 圖磚,各紅過一次,
// 同一份程式重跑都是綠的。只收下面三種句型,而且網址必須不是本機;本機檔案載入失敗、頁面自己印的錯誤、
// 沒帶網址的失敗照樣算進 errors。收掉的逐筆留在 NET_NOISE,總計之後印出來。
const NET_NOISE = [];
function externalNetNoise(text, url) {
  const m = text.match(/^Fetch API cannot load (\S+) due to access control checks\.$/)               // WebKit
    || text.match(/^Access to fetch at '([^']+)' from origin '[^']*' has been blocked by CORS policy/); // Chromium
  const target = m ? m[1] : /^Failed to load resource: /.test(text) ? (url || '') : '';
  return /^https?:\/\//.test(target) && !target.startsWith(`http://127.0.0.1:${PORT}/`);
}
{ // 分類器對照:寫死的例子,不靠當下的網路狀況。
  const L = `http://127.0.0.1:${PORT}`;
  const cases = [
    ['Fetch API cannot load https://tiles.openfreemap.org/planet/20260913_164504_pt/12/3431/1753.pbf due to access control checks.', '', true],
    ['Failed to load resource: The Internet connection appears to be offline.', 'https://tiles.openfreemap.org/planet', true],
    [`Access to fetch at 'https://tiles.openfreemap.org/planet' from origin '${L}' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.`, '', true],
    ['Failed to load resource: the server responded with a status of 404 (Not Found)', `${L}/data/tra_schedule.json`, false],
    [`Fetch API cannot load ${L}/api/la/bind due to access control checks.`, '', false],
    ['Failed to load resource: net::ERR_FAILED', '', false],
    ['TypeError: undefined is not an object', `${L}/index.html`, false],
  ];
  const wrong = cases.filter(([t, u, want]) => externalNetNoise(t, u) !== want).map(([t]) => t.slice(0, 70));
  ok('[外部網路雜訊] 分類器對照:外部圖磚、斷網才算雜訊;本機檔案、頁面錯誤、沒帶網址的失敗照樣算紅', wrong.length === 0, wrong.join(' | '));
}

// ── T0 目標自檢 ──────────────────────────────────────────────────────────
const idxSrc = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const md5 = createHash('md5').update(idxSrc).digest('hex').slice(0, 12);
const localBuild = (idxSrc.match(/const BUILD = '([^']*)'/) || [])[1] || '?';
console.log(`\n目標: ${path.join(ROOT, 'index.html')}\n      md5=${md5}  BUILD=${localBuild}  ${idxSrc.split('\n').length} 行\n`);

// ── localStorage 白名單／永遠不准變(腳本啟動先印出來)───────────
const LS_WHITELIST = ['trainmap-my-train-v1', 'trainmap-fprail-min', 'trainmap-follow-heading-up', 'trainmap-map-pitch', 'trainmap-last-view'];
const LS_NEVER = ['trainmap-user-data-v1', 'trainmap-rides', 'trainmap-riding-v1', 'trainmap-checkins-v1', 'trainmap-bounty-v1',
  'trainmap-local-reminders-v1', 'trainmap-local-reminders-next-id-v1', 'trainmap-local-reminder-walk-v1',
  'trainmap-favs', 'trainmap-fav-stations', 'trainmap-pins', 'trainmap-last-board-v1'];
console.log('localStorage 白名單:', LS_WHITELIST.join(', '));
console.log('永遠不准變清單:', LS_NEVER.join(', '), '\n');

// ── 網路 payload 完整值掃描(不比子字串)───────────────────────────────────
function collectStrings(node, out) {
  if (node == null) return;
  if (typeof node === 'string') { out.push(node); return; }
  if (Array.isArray(node)) { for (const v of node) collectStrings(v, out); return; }
  if (typeof node === 'object') { for (const k of Object.keys(node)) collectStrings(node[k], out); }
}
function scanRequestsForIdentity(reqs, needles) {
  const hits = [];
  for (const r of reqs) {
    let u; try { u = new URL(r.url); } catch (e) { continue; }
    for (const [k, v] of u.searchParams.entries()) {
      if (needles.includes(v)) hits.push({ url: r.url, where: 'query:' + k, value: v });
    }
    if (r.postData) {
      let j = null; try { j = JSON.parse(r.postData); } catch (e) { j = null; }
      if (j != null) {
        const strs = []; collectStrings(j, strs);
        for (const s of strs) if (needles.includes(s)) hits.push({ url: r.url, where: 'json-body', value: s });
      }
    }
  }
  return hits;
}

// ── addInitScript:原生橋接替身、locale/首訪旗標(頁面載入前)──────────────
const INIT = () => {
  // 每次載入（含 reload）都使用持證測試資格，存檔讀回仍由產品流程負責。
  document.addEventListener('DOMContentLoaded', () => { plusState().active = true; if (state.ready) ownTrainRebuild(); }, { once: true });
  try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
  try { localStorage.setItem('trainmap-language', 'zh-TW'); } catch (e) {}
  try { localStorage.setItem('trainmap-powersave', '0'); } catch (e) {}
  try { localStorage.setItem('trainmap-fprail-min', '0'); } catch (e) {}
  window.__nativeCalls = [];
  const record = (bridge, member, args) => {
    let preview = '';
    try { preview = JSON.stringify(args).slice(0, 200); } catch (e) { preview = String(args).slice(0, 200); }
    window.__nativeCalls.push({ bridge, member, preview, t: Date.now() });
  };
  const makeProxy = (bridgeName) => new Proxy(function () {}, {
    get(target, prop) {
      if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;
      return (...args) => { record(bridgeName, String(prop), args); return Promise.resolve({ ok: true }); };
    },
    apply() { record(bridgeName, '(call)', []); return Promise.resolve({ ok: true }); },
  });
  const NATIVE_NAMES = ['RAIL_NATIVE_AUDIO', 'RAIL_NATIVE_LOCALNOTIFY', 'RAIL_NATIVE_GEOLOCATION', 'RAIL_NATIVE_PLACES',
    'RAIL_NATIVE_AUTH', 'RAIL_NATIVE_PLUS_ADAPTER', 'RAIL_NATIVE_LIVEACTIVITY', 'RAIL_NATIVE_APPUPDATE', 'RAIL_NATIVE_SHARE'];
  for (const n of NATIVE_NAMES) window[n] = makeProxy(n);
  const pluginTargets = {};
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    Plugins: new Proxy(pluginTargets, {
      get(t, prop) {
        if (typeof prop === 'symbol') return undefined;
        if (!(prop in t)) t[prop] = makeProxy('Capacitor.Plugins.' + String(prop));
        return t[prop];
      },
    }),
  };
  try {
    Object.defineProperty(navigator, 'share', {
      configurable: true, value: (...args) => { record('navigator.share', 'share', args); return Promise.resolve(); },
    });
  } catch (e) {}
};

// 預置完乘紀錄,讓車庫裡 emu800 入庫(train-garage.js 的 GOALS:rides 達 4 即可,emu800 不在
// legacy RULES 表裡,純看 progress.rides >= 4)。開機前寫進 trainmap-rides;只預置這一把鍵
// (loadRides() 讀的就是它),不碰 trainmap-user-data-v1。trainmap-rides 也在 LS_NEVER 清單裡,
// 但 snap0 是開機「之後」才拍的(見下方),所以「永遠不准變」量的是預置後的基準,不受影響。
const OWN_TRAIN_RIDES = [
  { train: '8001', date: '2026-01-01', sys: 'tra_sched', from: '臺北', to: '板橋', km: 10 },
  { train: '8002', date: '2026-01-02', sys: 'tra_sched', from: '臺北', to: '板橋', km: 10 },
  { train: '8003', date: '2026-01-03', sys: 'tra_sched', from: '臺北', to: '板橋', km: 10 },
  { train: '8004', date: '2026-01-04', sys: 'tra_sched', from: '臺北', to: '板橋', km: 10 },
];
const RIDES_INIT = (rides) => { try { localStorage.setItem('trainmap-rides', JSON.stringify(rides)); } catch (e) {} };

// ── 開機等就緒 ───────────────────────────────────────────────────────────
async function bootPage(ctx, qs, lang) {
  const page = await ctx.newPage();
  const errors = [];
  // 刪除自製車、取代確認都走原生 confirm()(跟本專案既有的刪除/排班流程一致)。Playwright 預設把
  // 對話框自動「取消」,於是刪除永遠不會發生、[分流] delete 那條會紅在錯的理由上。這裡預設**只**
  // 接受刪除那一句,其他任何對話框一律照預設取消——不是把整個 harness 對 confirm 放行。
  // page.__mtNextDialog 是一次性覆蓋(nextDialog() 設,用一次就清),讓「取代確認先 dismiss 一次、
  // 再 accept 一次」這種測試不必動全域規則。page.__mtDialogs 記下每個對話框的型別與訊息,
  // 供後面驗證「確實跳出過那個對話框」,不是巧合沒開表單。
  page.__mtDialogs = [];
  page.__mtNextDialog = null;
  page.on('dialog', d => {
    page.__mtDialogs.push({ type: d.type(), message: d.message() });
    if (page.__mtNextDialog) {
      const act = page.__mtNextDialog; page.__mtNextDialog = null;
      (act === 'accept' ? d.accept() : d.dismiss()).catch(() => {});
      return;
    }
    if (d.type() === 'confirm' && /確定要刪除/.test(d.message())) d.accept().catch(() => {});
    else d.dismiss().catch(() => {});
  });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  // 附上網址:「Failed to load resource」本身不帶網址,少了它分不出是本機檔案壞了還是外部圖磚/CDN 一時失手。
  // 外部網址的網路載入失敗收進 NET_NOISE(判準見 externalNetNoise),不算這個 context 的例外。
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const u = (m.location() || {}).url, line = 'CONSOLE-ERR: ' + m.text() + (u ? ' @ ' + u : '');
    (externalNetNoise(m.text(), u) ? NET_NOISE : errors).push(line);
  });
  await page.goto(`http://127.0.0.1:${PORT}/?lang=${lang || 'zh-TW'}&g=nat${qs || ''}`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => {
      try {
        return typeof state !== 'undefined' && state.ready && (state.trains || []).length > 0
          && typeof MyTrainPlan !== 'undefined' && typeof MyTrainUI !== 'undefined' && typeof isMyTrain === 'function';
      } catch (e) { return false; }
    }, null, { timeout: 40000 });
  } catch (e) {
    return { page, errors, ready: false };
  }
  await page.evaluate(() => { plusState().active = true; ownTrainRebuild(); });
  return { page, errors, ready: true };
}

// ── 真的走介面:車庫、表單────────────────────
// 真的點:捲進畫面 → 中心點 elementFromPoint 必須是它自己(或它的子孫)且不是 disabled →
// 真滑鼠按住 150ms,或真手指點一下(touch=true)。
async function press(page, sel, touch = false) {
  const loc = page.locator(sel).first();
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b || b.width < 1 || b.height < 1) throw new Error('press:元素沒有位置(看不見) ' + sel);
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  const hit = await loc.evaluate((el, pt) => {
    const h = document.elementFromPoint(pt[0], pt[1]);
    return { ok: !!h && (h === el || el.contains(h)), disabled: !!el.disabled, what: h ? h.outerHTML.slice(0, 90) : null };
  }, [x, y]);
  if (!hit.ok) throw new Error('press:中心點打到的不是它,而是 ' + hit.what + '(要點 ' + sel + ')');
  if (hit.disabled) throw new Error('press:它是 disabled(' + sel + ')');
  if (touch) await page.touchscreen.tap(x, y);
  else { await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(150); await page.mouse.up(); }
  return { x, y };
}
// 蓋掉下一個對話框的處理方式一次(用完即清);見 bootPage 的 page.__mtNextDialog。
function nextDialog(page, action) { page.__mtNextDialog = action; }
// 元素中心點的 elementFromPoint 是不是它自己(且沒被 disabled),不牽動任何點擊。
async function hitsSelf(page, sel) {
  const loc = page.locator(sel).first();
  if (!(await loc.count())) return false;
  return loc.evaluate(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!h && (h === el || el.contains(h)) && !el.disabled;
  });
}
// 車庫入口:手機是底部分頁列的「更多」(#tabMore),桌面是右側的「更多」(#toolsFab)——兩者
// 只有一個在畫面上看得到,實際量渲染狀態再決定點哪個,不憑視窗寬度猜。都打開同一個 #moreSheet。
async function openGarage(page, touch = false) {
  if (await page.evaluate(() => !!window.TrainGarage?.isOpen)) return;
  const useTabMore = await page.evaluate(() => {
    const el = document.getElementById('tabMore');
    return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  });
  await press(page, useTabMore ? '#tabMore' : '#toolsFab', touch);
  const row = page.locator('#moreSheet [data-act="garage"]');
  await row.waitFor({ state: 'visible', timeout: 5000 });
  await press(page, '#moreSheet [data-act="garage"]', touch);
  await page.waitForFunction(() => !!window.TrainGarage?.isOpen, null, { timeout: 8000 });
}
async function closeGarage(page, touch = false) {
  if (!(await page.evaluate(() => !!window.TrainGarage?.isOpen))) return;
  await press(page, '#trainGarage .g-close', touch);
  await page.waitForFunction(() => !window.TrainGarage?.isOpen, null, { timeout: 5000 });
}
// 先切「全部車款」再點那一格車;等 chooseModel 真的把 aria-pressed 設成 true 才算選到。
async function pickModel(page, modelId, touch = false) {
  await press(page, '#trainGarage [data-filter="all"]', touch);
  const car = page.locator(`#trainGarage .g-car[data-model="${modelId}"]`);
  await car.waitFor({ state: 'attached', timeout: 5000 });
  await press(page, `#trainGarage .g-car[data-model="${modelId}"]`, touch);
  await page.waitForFunction((id) => document.querySelector(`#trainGarage .g-car[data-model="${id}"]`)?.getAttribute('aria-pressed') === 'true',
    modelId, { timeout: 5000 });
}
// 目前選中那張卡片上看得到的東西(看不到的回 null)——讀 data-mt-g 那組契約。
async function readCard(page) {
  return page.evaluate(() => {
    const q = s => document.querySelector('#trainGarage ' + s);
    const vis = el => !!el && !el.closest('[hidden]') && el.getClientRects().length > 0;
    const box = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    const plan = q('[data-mt-g="schedule"]'), note = q('[data-mt-g="note"]'), mine = q('.mt-g-mine'),
      status = q('[data-mt-g="status"]'), view = q('.mt-g-view'), hint = q('[data-mt-g="hint"]');
    return {
      badge: q('.g-status')?.textContent || '',
      plan: vis(plan) ? { text: plan.textContent, disabled: plan.disabled, box: box(plan) } : null,
      note: vis(note) ? note.textContent : null,
      mine: vis(mine),
      status: vis(status) ? status.textContent : null,
      view: vis(view) ? { text: view.textContent, act: view.getAttribute('data-mt-g'), box: box(view) } : null,
      hint: vis(hint) ? { text: hint.textContent, warn: hint.classList.contains('mt-g-warn') } : null,
    };
  });
}
// 起訖搜尋框:打字 → 等建議列出現 → 點文字完全相符的那一列(記下點擊前中心點是否命中它自己)。
async function sugPick(page, which, name, touch = false) {
  await press(page, `[data-mt-f="${which}"]`, touch);
  await page.locator(`[data-mt-f="${which}"]`).fill(name);
  // hasText 是 substring（「臺北」也會抓到更長的站名），而手機限高表單裡建議列可能還在摺線下。
  // 先鎖 accessible name 完全相符的真 button，再捲入視野、以 elementFromPoint 證明中心命中；
  // touch context 必須走 page.tap，不能用裸座標 touchscreen.tap 把錯列／遮罩也當成功。
  const row = page.locator(`[data-mt-sug="${which}"]`).getByRole('button', { name, exact: true }).first();
  await row.waitFor({ state: 'visible', timeout: 5000 });
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  const hit = box ? await row.evaluate((el, pt) => {
    const h = document.elementFromPoint(pt[0], pt[1]);
    return !!h && (h === el || el.contains(h));
  }, [box.x + box.width / 2, box.y + box.height / 2]) : false;
  if (!hit) return { hit: false, selected: false, value: await page.locator(`[data-mt-f="${which}"]`).inputValue() };
  if (touch && box) {
    const probe = `mt-iso-sug-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await row.evaluate((el, value) => el.setAttribute('data-mt-isolation-sug', value), probe);
    await page.tap(`[data-mt-isolation-sug="${probe}"]`, { position: { x: box.width / 2, y: box.height / 2 } });
    await row.evaluate(el => el.removeAttribute('data-mt-isolation-sug')).catch(() => {});
  }
  else await row.click();
  const value = await page.locator(`[data-mt-f="${which}"]`).inputValue();
  const selected = value === name;
  // 呼叫端過去只看 hit；讓 hit 同時包含「真的選中」，避免 fill 留下的字假冒 click handler 成功。
  return { hit: hit && selected, selected, value };
}
async function waitDepartEnabled(page, timeout = 5000) {
  return page.waitForFunction(() => {
    const b = document.querySelector('[data-mt-f="depart"]');
    return !!b && !b.disabled;
  }, null, { timeout }).then(() => true).catch(() => false);
}
// 快轉(不直接呼叫 setSpeed(),對 #speed 滑桿設值並送出 input 事件)——range input 常常
// 不支援 Playwright 的 fill(),失敗就退回派發 input 事件,跟 probe.mjs 的 setSpeedUI 同做法。
async function setSpeedUI(page, v) {
  try { await page.locator('#speed').fill(String(v), { timeout: 2000 }); }
  catch (e) {
    await page.evaluate((val) => {
      const el = document.getElementById('speed');
      el.value = String(val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
  }
}
// 讓焦點落在發車鈕(直接 focus() 拿不到——關閉的表單本來就拿不到焦點——就改用 Tab
// 走一段有界距離找),按 Enter,回報有沒有真的落到它身上、以及儲存/state.myTrains[0].train
// 按前按後是否相同(不管有沒有真的 landed,都要證明「按了 Enter 之後沒東西變」)。
async function keyboardCannotSubmitClosedForm(page) {
  const direct = await page.evaluate(() => {
    const el = document.querySelector('[data-mt-f="depart"]');
    if (!el) return { tried: false, landed: false };
    el.focus();
    return { tried: true, landed: document.activeElement === el };
  });
  let landed = direct.landed;
  if (!landed) {
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    for (let i = 0; i < 40 && !landed; i++) {
      await page.keyboard.press('Tab');
      landed = await page.evaluate(() => {
        const el = document.querySelector('[data-mt-f="depart"]');
        return !!el && document.activeElement === el;
      });
    }
  }
  const before = await page.evaluate(() => ({ stored: MyTrainUI.load().train, rec: state.myTrains[0] ? state.myTrains[0].train : null }));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ stored: MyTrainUI.load().train, rec: state.myTrains[0] ? state.myTrains[0].train : null }));
  return { landed, unchanged: JSON.stringify(before) === JSON.stringify(after), before, after };
}
// 表單已經開著(任何 mode):填起訖(打字+點建議列)/時間/名字/停站方式/山海線,按發車,等真的發車。
// 每個欄位都是選填——不給就不動那個欄位,讓「編輯」測試只改單一欄位、其餘維持表單原本的預填值。
async function fillFormAndDepart(page, { from, to, depOffset, name, pattern, via, touch = false } = {}) {
  const fromHit = from ? (await sugPick(page, 'from', from, touch)).hit : null;
  const toHit = to ? (await sugPick(page, 'to', to, touch)).hit : null;
  if (depOffset != null) {
    const depSec = await page.evaluate((off) => Math.round(state.simSec + off + 86400) % 86400, depOffset);
    await page.locator('[data-mt-f="hh"]').fill(String(Math.floor(depSec / 3600)));
    await page.locator('[data-mt-f="mm"]').fill(String(Math.floor((depSec % 3600) / 60)));
  }
  if (via) await press(page, `[data-mt-fvia="${via}"]`, touch);
  if (pattern) await press(page, `[data-mt-fpattern="${pattern}"]`, touch);
  if (name != null) await page.locator('[data-mt-f="name"]').fill(name);
  const enabled = await waitDepartEnabled(page);
  if (!enabled) {
    const reason = await page.evaluate(() => document.querySelector('[data-mt-f="reason"]')?.textContent || '');
    return { ok: false, reason: 'depart-disabled: ' + reason, fromHit, toHit };
  }
  await press(page, '[data-mt-f="depart"]', touch);
  const departed = await page.waitForFunction(() => (state.myTrains || []).length > 0 && !window.TrainGarage?.isOpen, null, { timeout: 8000 })
    .then(() => true).catch(() => false);
  if (!departed) return { ok: false, reason: 'not-departed', fromHit, toHit };
  const rec = await page.evaluate(() => {
    const r = state.myTrains[0];
    return {
      id: r.train, label: r.label, stopNames: r.stops.map(s => s.name),
      stopCount: r.stops.filter(s => s.stop !== false).length,
      depSec: r.stops[0].depSec, arrSec: r.stops[r.stops.length - 1].arrSec,
      hasSongshan: r.stops.some(s => s.name === '松山'),
    };
  });
  return { ok: true, fromHit, toHit, ...rec };
}
// 建自製車:開車庫 → 選車款 → 按「自己排一班」→ 填表單 → 發車。
// 路線固定經過台北–松山;預設終點南港湊不到松山就退而求其次改七堵(沒指定終點,
// 只要求經過台北–松山且停靠站數 >=3);opts.to 給定時直接用那個終點,不做退路判斷(mobile 場景挑
// 經過竹南/彰化的路線用)。id 由介面自己產生(crypto.randomUUID()),回傳讀回來的真實值,呼叫端
// 不能指定——已經有一班時「自己排一班」會先跳取代確認,這裡預設直接 accept(dismiss 分支另外測,
// 見 Scenario C)。
async function makeOwnTrain(page, { name, depOffset, modelId = 'emu800', from = '臺北', to, pattern, via, touch = false }) {
  const dest = to || await page.evaluate(() => {
    const g = MyTrainPlan.buildGraph(systemData('tra_sched').lines, 'tra_sched');
    const r = MyTrainPlan.findRoute(g, MyTrainPlan.stationKey('tra_sched', '臺北'), MyTrainPlan.stationKey('tra_sched', '南港'), {});
    return r.ok && r.stops.some(s => s.name === '松山') ? '南港' : '七堵';
  });
  const already = await page.evaluate(() => !!(window.MyTrainUI && MyTrainUI.load().train));
  await openGarage(page, touch);
  await pickModel(page, modelId, touch);
  if (already) nextDialog(page, 'accept');
  await press(page, '[data-mt-g="schedule"]', touch);
  const opened = await page.waitForFunction(() => document.getElementById('mtForm')?.open === true, null, { timeout: 5000 })
    .then(() => true).catch(() => false);
  if (!opened) return { ok: false, reason: 'form-not-open' };
  return fillFormAndDepart(page, { from, to: dest, depOffset, name, pattern, via, touch });
}

// 低階跳過 UI 的跟車設定——只給「需要先跟上某班車才能測別的東西」的前置步驟用(例如
// deleteOwnTrain()/tryPanelButtons() 重新跟上以便繼續按鈕測試)。測試「去看它」
// 這個語意時改走真的點擊,見下面 pressViewOnCard()。
async function followOwnTrain(page) {
  return page.evaluate(() => {
    const rec = state.myTrains[0];
    if (!rec) return { ok: false };
    state.simSec = Math.round(Math.max(0, (rec.stops[0].depSec - 30 + 86400) % 86400));
    state.clockAtNow = false;
    state.playing = false;
    setFollow(rec, false, false, {});
    return { ok: true, url: location.pathname + location.search };
  });
}
// 「去看它」——真的點車庫卡片上的 [data-mt-g="view"],不用 followOwnTrain 代替。
async function pressViewOnCard(page, modelId = 'emu800', touch = false) {
  await openGarage(page, touch);
  await pickModel(page, modelId, touch);
  const card = await readCard(page);
  if (!card.view || card.view.act !== 'view') return { ok: false, reason: 'no-view-button', card };
  await press(page, '[data-mt-g="view"]', touch);
  // 點下去之後立刻凍結時鐘(實測發現的坑):production 端「去看它」
  // 撥鐘到發車前 20 秒是同步發生的,但前面若有 fastForwardToArrival 留下的 60x 播放沒關掉,
  // 車庫收合動畫的幾百毫秒真實時間會讓 simSec 在量測前繼續漂走,量到的就不是撥鐘後的值。
  await page.evaluate(() => { state.playing = false; });
  const closed = await page.waitForFunction(() => !window.TrainGarage?.isOpen, null, { timeout: 5000 })
    .then(() => true).catch(() => false);
  return { ok: closed, card };
}

async function fastForwardToArrival(page, timeoutMs) {
  await setSpeedUI(page, 60); // 走 #speed 滑桿,不直接呼叫 setSpeed()
  if (!(await page.evaluate(() => state.playing))) await page.evaluate(() => { state.playing = true; });
  const done = await page.waitForFunction(() => state.followStatus === 'done', null, { timeout: timeoutMs, polling: 200 })
    .then(() => true).catch(() => false);
  // 事件列每 0.5 秒(牆鐘)才掃一次,60 倍速下一拍約 30 模擬秒;「已抵達」是過了抵達 2 秒就成立,
  // 馬上讀會落在兩次掃描之間、抵達那條還沒記(實測:done 落在 rel 546 與 577 兩拍之間)。
  // 等事件列確實掃過抵達時刻再讀——等完成訊號,不等固定秒數。事件列不存在時逾時略過,由後面的斷言報紅。
  if (done) {
    await page.waitForFunction(() => {
      const log = state.ownTrainLog, rec = state.myTrains && state.myTrains[0];
      if (!log || !rec || log.lastSimSec == null) return false;
      const s = rec.stops, dep0 = s[0].depSec, dur = s[s.length - 1].arrSec - dep0;
      const rel = ((log.lastSimSec - dep0) % 86400 + 86400) % 86400;
      return rel >= dur && rel < dur + 3 * 3600;
    }, null, { timeout: 5000, polling: 100 }).catch(() => {});
  }
  return done;
}

// 刪除:一律走面板的刪除鈕,接受既有的「確定要刪除」confirm(bootPage 的對話框處理)。
// 面板沒開(不在跟這班車)時先跟上再刪;沒有車可刪就直接回傳,不做任何事。
async function deleteOwnTrain(page, touch = false) {
  if (!(await page.evaluate(() => (state.myTrains || []).length > 0))) return { myTrainsLen: 0 };
  if (!(await page.evaluate(() => !!(state.followTrain && isMyTrain(state.followTrain))))) {
    await followOwnTrain(page);
    await page.waitForTimeout(300);
  }
  const info = await page.evaluate(() => {
    const el = document.querySelector('[data-mt-action="delete"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  });
  if (!info || !(info.w > 0 && info.h > 0)) {
    // 面板不該打不到刪除鈕;defensive fallback 避免整支腳本卡死,同時如實記錄不是走 UI 刪的。
    return page.evaluate(() => {
      const cur = MyTrainUI.load();
      MyTrainUI.save({ v: 1, appearance: cur.appearance, train: null });
      ownTrainRebuild(); clearFollow();
      return { myTrainsLen: state.myTrains.length, uiFallback: true };
    });
  }
  if (touch) await page.touchscreen.tap(info.x, info.y); else await page.mouse.click(info.x, info.y);
  await page.waitForTimeout(300);
  return { myTrainsLen: await page.evaluate(() => state.myTrains.length) };
}

async function lsSnapshot(page) {
  return page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out[k] = localStorage.getItem(k); }
    return out;
  });
}

// ── 面板按鈕契約(找不到元素時一律回報 element-missing)────────
async function tryPanelButtons(page, touch, skipDelete = false) {
  const actions = [
    { act: 'halo', sel: '[data-mt-action="halo"]' },
    { act: 'size', sel: '[data-mt-action="size"]' },
    // 這裡刻意不測 edit:點下去會開排班表單(<dialog>),不關掉的話會蓋住接下來 unfollow/delete
    // 的座標,兩顆都會被判「座標命中的不是按鈕本身」——那是表單擋住的假象,不是那兩顆本身壞了。
    // 編輯改由 Scenario C(只改名字保留事件列 / 改停站方式清空事件列)與手機(真觸控點編輯→
    // 取消,見 F手機區塊)分別獨立情境驗,見該處。
    // unfollow 必須排在 delete 前面:刪掉之後面板就收起來了,再點取消跟車只會量到 element-missing。
    { act: 'unfollow', sel: '#fpEnd' },
  ];
  // skipDelete(實測發現的坑):這裡預設用一次點擊+全域預設 accept 把車刪掉,Scenario A 桌面
  // 呼叫時另外有更完整的 dismiss→accept 刪除確認序列——兩邊搶同一班車的話,這裡先跑
  // 就會讓車在那個序列開始前已經不在了,量到「車已經不在」的假象。手機沒有那個序列,
  // 仍用這裡簡單驗一次(預設 skipDelete=false)。
  if (!skipDelete) actions.push({ act: 'delete', sel: '[data-mt-action="delete"]' });
  const out = {};
  for (const { act, sel } of actions) {
    const info = await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      return { found: true, x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
    }, sel);
    if (!info.found || !(info.w > 0 && info.h > 0)) { out[act] = { ok: false, reason: 'element-missing' }; continue; }
    const before = await page.evaluate(() => ({
      haloOn: state.ownTrainAppearance && state.ownTrainAppearance.haloOn,
      haloSize: state.ownTrainAppearance && state.ownTrainAppearance.haloSize,
      myTrainsLen: (state.myTrains || []).length,
      following: !!(state.followTrain && isMyTrain(state.followTrain)),
    }));
    const hit = await page.evaluate(({ x, y, selector }) => {
      const el = document.elementFromPoint(x, y);
      const target = document.querySelector(selector);
      return !!(el && target && (el === target || target.contains(el)));
    }, { x: info.x, y: info.y, selector: sel });
    if (touch) await page.touchscreen.tap(info.x, info.y); else await page.mouse.click(info.x, info.y);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({
      haloOn: state.ownTrainAppearance && state.ownTrainAppearance.haloOn,
      haloSize: state.ownTrainAppearance && state.ownTrainAppearance.haloSize,
      myTrainsLen: (state.myTrains || []).length,
      following: !!(state.followTrain && isMyTrain(state.followTrain)),
    }));
    out[act] = { ok: true, hit, before, after };
    // 取消跟車之後重新跟上,讓後面的 delete 還點得到面板。
    if (act === 'unfollow') { await followOwnTrain(page); await page.waitForTimeout(300); }
  }
  return out;
}
// 點一個元素的中心(手機走真觸控)。回報座標上最上層的是不是它本身——被別的東西蓋住就不算點到。
async function tapCenter(page, sel, touch) {
  const info = await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return { found: true, x, y, w: r.width, h: r.height, hit: !!(top && (top === el || el.contains(top))) };
  }, sel);
  if (!info.found || !(info.w > 0 && info.h > 0)) return { ok: false, reason: 'element-missing', sel };
  if (touch) await page.touchscreen.tap(info.x, info.y); else await page.mouse.click(info.x, info.y);
  await page.waitForTimeout(300);
  return { ok: true, hit: info.hit, sel };
}
function judgePanelButton(act, r) {
  if (!r || r.ok === false) return { pass: false, detail: r ? r.reason : 'no-result' };
  if (!r.hit) return { pass: false, detail: '座標命中的不是按鈕本身:' + JSON.stringify(r) };
  if (act === 'halo') return { pass: r.before.haloOn !== r.after.haloOn, detail: JSON.stringify(r) };
  if (act === 'size') return { pass: r.before.haloSize !== r.after.haloSize, detail: JSON.stringify(r) };
  if (act === 'delete') return { pass: r.before.myTrainsLen === 1 && r.after.myTrainsLen === 0, detail: JSON.stringify(r) };
  if (act === 'unfollow') return { pass: r.before.following === true && r.after.following === false, detail: JSON.stringify(r) };
  return { pass: false, detail: 'unknown-action' };
}

// 手機表單控件逐一驗(手機 375×812):開車庫→選車款→排班表單,
// 逐一真觸控:起訖搜尋框(打字+點建議列)、三種停站方式、山海線切換(用台北→高雄逼出切換)、
// 發車鈕——每一顆都量「點了之後狀態真的變了」,並且 elementFromPoint 命中它自己(比照 tapCenter/
// judgePanelButton 的驗法)。最後真的發車,兼作這個 context 後續面板測試要用的那班車。
async function mobileFormWalkthrough(page, P) {
  await openGarage(page, true);
  await pickModel(page, 'emu800', true);
  await press(page, '[data-mt-g="schedule"]', true);
  const opened = await page.waitForFunction(() => document.getElementById('mtForm')?.open === true, null, { timeout: 5000 })
    .then(() => true).catch(() => false);
  ok(P('F手機表單 排班表單真觸控點得開'), opened, String(opened));
  if (!opened) return { ok: false, reason: 'form-not-open' };

  const fromPick = await sugPick(page, 'from', '臺北', true);
  const fromVal = await page.evaluate(() => document.querySelector('[data-mt-f="from"]').value);
  ok(P('F手機表單 起站搜尋框:打字後點建議列(真觸控命中列本身),輸入框帶入選到的站名'),
    fromPick.hit && fromVal === '臺北', JSON.stringify({ fromPick, fromVal }));

  const toPick = await sugPick(page, 'to', '高雄', true);
  const afterTo = await page.evaluate(() => ({
    toVal: document.querySelector('[data-mt-f="to"]').value,
    route: document.querySelector('[data-mt-f="route"]')?.textContent || '',
    viaVisible: !document.querySelector('.mt-f-via')?.hidden,
  }));
  ok(P('F手機表單 訖站搜尋框:打字後點建議列(真觸控命中列本身),輸入框帶入選到的站名、算出路線摘要'),
    toPick.hit && afterTo.toVal === '高雄' && afterTo.route.length > 0, JSON.stringify({ toPick, afterTo }));
  ok(P('F手機表單 台北→高雄經過竹南/彰化那段分岔,山海線切換確實冒出來'), afterTo.viaVisible, JSON.stringify(afterTo));

  // 三種停站方式各點一次,驗 aria-pressed 正確互斥切換、且真觸控命中按鈕本身——最後停在 'all'。
  for (const pat of ['major', 'express', 'all']) {
    const sel = `[data-mt-fpattern="${pat}"]`;
    const before = await hitsSelf(page, sel);
    await press(page, sel, true);
    const pressed = await page.evaluate((s) => {
      const el = document.querySelector(s);
      const siblingsOk = [...document.querySelectorAll('[data-mt-fpattern]')].every(b => b === el ? b.getAttribute('aria-pressed') === 'true' : b.getAttribute('aria-pressed') === 'false');
      return siblingsOk;
    }, sel);
    ok(P(`F手機表單 停站方式「${pat}」真觸控點到本體,aria-pressed 正確互斥切換`), before && pressed, JSON.stringify({ pat, before, pressed }));
  }

  // 山海線:預設「山線」,點「海線」→ aria-pressed 互斥翻轉、真觸控命中本體。
  const viaBefore = await page.evaluate(() => ({
    mountain: document.querySelector('[data-mt-fvia="mountain"]')?.getAttribute('aria-pressed'),
    coast: document.querySelector('[data-mt-fvia="coast"]')?.getAttribute('aria-pressed'),
  }));
  const coastHit = await hitsSelf(page, '[data-mt-fvia="coast"]');
  await press(page, '[data-mt-fvia="coast"]', true);
  const viaAfter = await page.evaluate(() => ({
    mountain: document.querySelector('[data-mt-fvia="mountain"]')?.getAttribute('aria-pressed'),
    coast: document.querySelector('[data-mt-fvia="coast"]')?.getAttribute('aria-pressed'),
  }));
  ok(P('F手機表單 山海線切換:點「海線」真觸控命中本體,aria-pressed 從山線翻到海線'),
    coastHit && viaBefore.mountain === 'true' && viaBefore.coast === 'false' && viaAfter.mountain === 'false' && viaAfter.coast === 'true',
    JSON.stringify({ coastHit, viaBefore, viaAfter }));

  const depSec = await page.evaluate((off) => Math.round(state.simSec + off + 86400) % 86400, 60);
  await page.locator('[data-mt-f="hh"]').fill(String(Math.floor(depSec / 3600)));
  await page.locator('[data-mt-f="mm"]').fill(String(Math.floor((depSec % 3600) / 60)));
  await page.locator('[data-mt-f="name"]').fill('手機測試');

  const departEnabled = await waitDepartEnabled(page);
  const departHit = departEnabled ? await hitsSelf(page, '[data-mt-f="depart"]') : false;
  const beforeDepart = await page.evaluate(() => ({ myTrainsLen: (state.myTrains || []).length, garageOpen: !!window.TrainGarage?.isOpen }));
  if (departEnabled) await press(page, '[data-mt-f="depart"]', true);
  const departed = departEnabled ? await page.waitForFunction(() => (state.myTrains || []).length > 0 && !window.TrainGarage?.isOpen, null, { timeout: 8000 })
    .then(() => true).catch(() => false) : false;
  const rec = departed ? await page.evaluate(() => {
    const r = state.myTrains[0];
    return {
      id: r.train, label: r.label, stopNames: r.stops.map(s => s.name),
      via: r._ownVia, pattern: r._ownPattern,
      hasKaohsiung: r.stops.some(s => s.name === '高雄'),
    };
  }) : null;
  ok(P('F手機表單 發車鈕:真觸控命中本體,按下之後車庫收起、自製車真的建立(終點含高雄、走海線)'),
    departEnabled && departHit && departed && rec && rec.hasKaohsiung && rec.via === 'coast',
    JSON.stringify({ departEnabled, departHit, beforeDepart, departed, rec }));

  return departed ? { ok: true, ...rec } : { ok: false, reason: 'not-departed' };
}

// ══════════════════════ [名牌方向] 3D 名牌有沒有上下顛倒 ══════════════
// 實際踩過:train-halo.js 的 tagUv 的 v 寫反,名牌整個上下顛倒,而「畫面上有沒有洋紅像素」
// 那種在場判準(舊版的檢查)照樣全綠,對方向完全失明。獨立 3D context(scene=3d 開機),準備步驟
// 走真 UI(車庫→表單→發車→面板按鈕關光環),量測邏輯如下:
// 實際值=GPU 這一幀真的用的四角 NDC(從 onBeforeRender 讀 geometry 屬性)換算成螢幕矩形、從截圖
// 裁下來的真實像素;期望值=production 自己的 nameplateSprite() 貼圖(面積平均縮到同尺寸再比)。
// 反向對照內建在同一組量測裡:翻過來那組同時是對照組,名牌真的顛倒時它會贏、這條才會紅。
// WebKit headless 若量不到(渲染器起不來、量測 API 缺),印一行具名 SKIP,不當沉默通過。
async function runNameplateOrientation(browser, engineName, P) {
  let ctx3d;
  try {
    ctx3d = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
    await ctx3d.addInitScript(INIT);
    await ctx3d.addInitScript(RIDES_INIT, OWN_TRAIN_RIDES);
    const { page, errors, ready } = await bootPage(ctx3d, '&scene=3d&sun=off&trainSize=readable');
    if (!ready) throw new Error('3D 開機逾時: ' + (errors.slice(0, 3).join(' | ') || 'timeout'));
    await page.evaluate(() => { state.simSec = 8 * 3600; state.clockAtNow = false; state.playing = false; });

    // 冷啟動實測要跑 12-15 秒(要等 blender-buildings.js/station-models.js 等大檔),拉高到 45s。
    await page.waitForFunction(() => !!(window.railIslandIntegration && window.railIslandIntegration.renderer), null, { timeout: 45000 });

    const mk = await makeOwnTrain(page, { name: '名牌方向', depOffset: -1800 });
    ok(P('[名牌方向] 前置:自製車建立成功(真 UI:車庫→表單→發車)'), mk.ok, JSON.stringify(mk));
    if (!mk.ok) throw new Error('makeOwnTrain 失敗: ' + JSON.stringify(mk));

    // 撥到跑程中點、凍結時鐘,低階撥鐘只為了
    // 取得穩定不動的畫面供像素比對,不是本檢查要驗的行為本身(比照本檔 followOwnTrain 的低階慣例)。
    await page.evaluate(() => {
      const rec = state.myTrains[0];
      const t0 = rec.stops[0].depSec, t1 = rec.stops[rec.stops.length - 1].arrSec;
      state.simSec = Math.floor((t0 + t1) / 2);
      state.clockAtNow = false; state.playing = false;
    });

    const vinfo = await page.evaluate(() => {
      const f = railIslandIntegration.capture();
      const v = f.vehicles.find(x => x.ownTrain);
      return v ? { id: v.id, lon: v.longitude, lat: v.latitude } : null;
    });
    ok(P('[名牌方向] capture() 找得到自製車(ownTrain:true)'), !!vinfo, JSON.stringify(vinfo));
    if (!vinfo) throw new Error('capture() 找不到自製車');

    await page.evaluate(v => {
      M.raw.setCenterClampedToGround && M.raw.setCenterClampedToGround(false);
      M.raw.jumpTo({ center: [v.lon, v.lat], zoom: 18, pitch: 55 });
    }, vinfo);

    async function refresh() {
      // 切外觀可能觸發 renderer 整個銷毀重建(epoch 機制),重建期間 renderer 會有一段時間是 null。
      await page.waitForFunction(() => !!(window.railIslandIntegration && window.railIslandIntegration.renderer), null, { timeout: 20000 });
      await page.evaluate(() => { railIslandIntegration.renderer.update(railIslandIntegration.capture()); });
      await page.waitForFunction(id => {
        window.M?.raw?.triggerRepaint && M.raw.triggerRepaint();
        return railIslandIntegration.renderer?.stats.poseSamples.some(s => s.id === id);
      }, vinfo.id, { timeout: 15000 }).catch(() => {});
      await page.evaluate(() => new Promise(res => { M.raw.triggerRepaint(); requestAnimationFrame(() => requestAnimationFrame(res)); }));
      await page.waitForTimeout(150);
    }
    await refresh();

    // 光環關掉才會改畫名牌——真的點面板上的 [data-mt-action="halo"],不直接改 state。
    await press(page, '[data-mt-action="halo"]');
    const haloOff = await page.evaluate(() => state.ownTrainAppearance.haloOn === false);
    ok(P('[名牌方向] 前置:面板按鈕把光環關掉(真 UI 點擊,state.ownTrainAppearance.haloOn===false)'), haloOff, `haloOff=${haloOff}`);
    if (!haloOff) throw new Error('光環按鈕沒有把 haloOn 關掉');
    await refresh();

    const plate = await page.evaluate(async () => {
      const THREE = await import('./rail-3d/vendor/three.module.js');
      let pos = null;
      const prior = THREE.Mesh.prototype.onBeforeRender;
      THREE.Mesh.prototype.onBeforeRender = function (...a) {
        if (this.name === 'own-train-nameplate' && this.visible) pos = Array.from(this.geometry.attributes.position.array);
        return prior.apply(this, a);
      };
      M.raw.triggerRepaint();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      THREE.Mesh.prototype.onBeforeRender = prior;
      if (!pos) return null;
      const xs = [], ys = [];
      for (let i = 0; i < 18; i += 3) { xs.push(pos[i]); ys.push(pos[i + 1]); }
      const rect = M.raw.getCanvas().getBoundingClientRect();
      const toX = n => rect.left + (n + 1) / 2 * rect.width, toY = n => rect.top + (1 - n) / 2 * rect.height;
      const rec = state.myTrains[0];
      const src = trainHaloStyle.nameplateSprite(rec.label, rec.color, rec.sys === 'thsr_sched');
      return { x0: toX(Math.min(...xs)), x1: toX(Math.max(...xs)), y0: toY(Math.max(...ys)), y1: toY(Math.min(...ys)),
        cssW: window.innerWidth, srcPng: src.toDataURL().split(',')[1] };
    });
    if (!plate) throw new Error('own-train-nameplate mesh 沒有 visible(白箱讀不到頂點)');

    const shotBuf = await page.screenshot();
    const scr = PNG.sync.read(shotBuf), src = PNG.sync.read(Buffer.from(plate.srcPng, 'base64'));
    const k = scr.width / plate.cssW;
    const X0 = Math.round(plate.x0 * k), Y0 = Math.round(plate.y0 * k);
    const W = Math.max(1, Math.round((plate.x1 - plate.x0) * k)), H = Math.max(1, Math.round((plate.y1 - plate.y0) * k));
    // 貼圖 256x80 在螢幕上只佔約 96x30,GPU 線性取樣近 3 倍縮小——先用面積平均把貼圖縮到跟螢幕同尺寸再比,
    // 否則銳利像素去對模糊螢幕點,兩種方向差距都很大、判準沒有解析度。
    const resample = (flipV) => {
      const out = new Float64Array(W * H * 4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const sx0 = Math.floor(x / W * src.width), sx1 = Math.max(sx0 + 1, Math.ceil((x + 1) / W * src.width));
        const ry0 = Math.floor(y / H * src.height), ry1 = Math.max(ry0 + 1, Math.ceil((y + 1) / H * src.height));
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let sy = ry0; sy < ry1 && sy < src.height; sy++) for (let sxx = sx0; sxx < sx1 && sxx < src.width; sxx++) {
          const yy = flipV ? src.height - 1 - sy : sy, si = (yy * src.width + sxx) * 4;
          r += src.data[si]; g += src.data[si + 1]; b += src.data[si + 2]; a += src.data[si + 3]; n++;
        }
        const o = (y * W + x) * 4;
        out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
      }
      return out;
    };
    // 取樣點只留「正著跟翻過來真的長得不一樣」的那些(字身),藥丸內部整片同色對兩個假設一樣相符。
    const up = resample(false), down = resample(true);
    const mask = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (up[o + 3] < 250 || down[o + 3] < 250) continue;
      if (Math.abs(up[o] - down[o]) + Math.abs(up[o + 1] - down[o + 1]) + Math.abs(up[o + 2] - down[o + 2]) < 30) continue;
      mask.push([x, y, o]);
    }
    const cmp = (ref) => {
      let sum = 0, n = 0;
      for (const [x, y, o] of mask) {
        const px = X0 + x, py = Y0 + y;
        if (px < 0 || py < 0 || px >= scr.width || py >= scr.height) continue;
        const di = (py * scr.width + px) * 4;
        sum += Math.abs(scr.data[di] - ref[o]) + Math.abs(scr.data[di + 1] - ref[o + 1]) + Math.abs(scr.data[di + 2] - ref[o + 2]);
        n += 3;
      }
      return n ? +(sum / n).toFixed(2) : -1;
    };
    const orient = { rect: [X0, Y0, W, H], samples: mask.length, asIs: cmp(up), flipped: cmp(down) };
    if (!(orient.samples > 200)) throw new Error('取樣點不足,量不出方向: ' + JSON.stringify(orient));

    // 反向對照就內建在同一組量測裡:名牌真的上下顛倒時 flipped 會贏過 asIs,這條必紅。
    ok(P('[名牌方向] 3D 名牌沒有上下顛倒(跟面積平均縮到同尺寸的 nameplateSprite 貼圖比,正著要明顯贏翻過來比)'),
      orient.asIs >= 0 && orient.asIs < 40 && orient.asIs < orient.flipped * 0.5, JSON.stringify(orient));

    await press(page, '[data-mt-action="halo"]'); // 復原(對稱收尾)
    ok(P('[名牌方向] 3D context 頁面零例外'), errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    const msg = String((e && e.stack) || e).slice(0, 300);
    if (engineName === 'webkit') ok(P('[名牌方向] SKIP webkit(headless 量不到,見 detail)'), true, msg);
    else ok(P('[名牌方向] 執行'), false, msg);
  } finally {
    if (ctx3d) await ctx3d.close();
  }
}

// ══════════════════════ [面板快取] updatePanel 不再每幀重新 JSON.parse ══════════════
// my-train-ui.js updatePanel()(約 227 行起)每幀被 updateFollowCamera()→updateFollowPanel()
// 呼叫,原本每次都對 STORAGE_KEY 那把 key 重新 JSON.parse。修法(my-train-ui.js
// loadAppearanceForPanel)以 localStorage 原始字串當快取鍵。獨立 context、真 UI 建自製車,
// depOffset 給負值讓車一建立就已經在路上(trainPos 有值)——只有「在路上」updateFollowCamera()
// 才會走到 updateFollowPanel(),尚未發車那段反而測不到每幀熱路徑:實測踩過,插在
// Scenario A 剛發車那一刻(尚未發車)量到的其實是 ownTrainScan 那條 0.5 秒節拍的冷路徑,
// 拿舊碼(每幀都 storeLoad())重跑同一個位置,hits 只從 0 變 1,mutation 測不出訊號。
async function runPanelCacheCheck(browser, engineName, P) {
  let ctxC;
  try {
    ctxC = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
    await ctxC.addInitScript(INIT);
    await ctxC.addInitScript(RIDES_INIT, OWN_TRAIN_RIDES);
    const { page, errors, ready } = await bootPage(ctxC, '');
    if (!ready) throw new Error('開機逾時: ' + (errors.slice(0, 3).join(' | ') || 'timeout'));
    await page.evaluate(() => { state.simSec = 8 * 3600; state.clockAtNow = false; state.playing = false; });

    const mk = await makeOwnTrain(page, { name: '面板快取', depOffset: -60 });
    ok(P('[面板快取] 前置:自製車建立成功且已在路上(depOffset=-60,真 UI:車庫→表單→發車)'), mk.ok, JSON.stringify(mk));
    if (!mk.ok) throw new Error('makeOwnTrain 失敗: ' + JSON.stringify(mk));

    const onRoute = await page.evaluate(() => {
      const fp = document.getElementById('followPanel');
      return {
        following: !!(state.followTrain && isMyTrain(state.followTrain)),
        panelShown: !!document.querySelector('[data-mt-panel]') && fp && !fp.hidden,
        hasPos: !!trainPos(state.myTrains[0], state.simSec),
        followStatus: state.followStatus,
      };
    });
    ok(P('[面板快取] 前置:車在路上、跟著、面板看得到(每幀熱路徑的前提)'),
      onRoute.following && onRoute.panelShown && onRoute.hasPos, JSON.stringify(onRoute));
    if (!(onRoute.following && onRoute.panelShown && onRoute.hasPos)) throw new Error('前提不成立: ' + JSON.stringify(onRoute));

    // 量法:monkey-patch JSON.parse,只數參數等於這把 key 目前原始字串的呼叫,跑滿 60 個真
    // rAF 幀(armTick 用 requestAnimationFrame,不是固定秒數)——這段期間沒有人寫這把 key、
    // 車也凍結不動(state.playing=false,只是「在路上」不代表在跑),次數應該 <=1。
    const cacheTest = await page.evaluate(async () => {
      const key = MyTrainUI.STORAGE_KEY;
      const raw = localStorage.getItem(key);
      let hits = 0;
      const origParse = JSON.parse;
      JSON.parse = function (s, ...rest) { if (s === raw) hits++; return origParse.call(JSON, s, ...rest); };
      await new Promise(resolve => {
        let n = 0;
        (function step() { n++; if (n >= 60) resolve(); else requestAnimationFrame(step); })();
      });
      JSON.parse = origParse;
      return { hits, raw };
    });
    ok(P('[面板快取] 跟著在路上的自製車時,連續 60 個真 rAF 幀,JSON.parse(該筆 localStorage 原始字串)呼叫數 <=1(不是每幀都重新解析)'),
      cacheTest.hits <= 1, JSON.stringify(cacheTest));

    // 切換後下一幀就要反映(不能因為快取而看起來像卡住畫面):真的點
    // [data-mt-action="halo"],面板上的文字要立刻換掉——halo 鈕點擊同步呼叫
    // ownTrainSetAppearance→ownTrainPanelUpdate,不必等下一次 0.5 秒排程。點兩下(開→關→開)
    // 驗證文字確實有跟著變、又確實變回原值,不是巧合沒變。
    const haloLabel0 = await page.evaluate(() => document.querySelector('[data-mt-action="halo"]')?.textContent || '');
    await press(page, '[data-mt-action="halo"]');
    const haloLabel1 = await page.evaluate(() => document.querySelector('[data-mt-action="halo"]')?.textContent || '');
    await press(page, '[data-mt-action="halo"]');
    const haloLabel2 = await page.evaluate(() => document.querySelector('[data-mt-action="halo"]')?.textContent || '');
    ok(P('[面板快取] 光環鈕點擊後,面板文字立刻換掉、再點一次立刻換回來(快取沒有讓畫面卡住舊值)'),
      !!haloLabel0 && haloLabel1 !== haloLabel0 && haloLabel2 === haloLabel0,
      JSON.stringify({ haloLabel0, haloLabel1, haloLabel2 }));

    ok(P('[面板快取] context 頁面零例外'), errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    const msg = String((e && e.stack) || e).slice(0, 300);
    ok(P('[面板快取] 執行'), false, msg);
  } finally {
    if (ctxC) await ctxC.close();
  }
}

// [fpRide] 隔離:?demo=bounty／App 才有的「我上車了」GPS 完乘按鈕(#fpRide/#fpRideBox),
// 平常靠 updateRideBtn 對 isMyTrain 車隱藏/零尺寸擋住(index.html:22430),但 openRideBox()
// 本身原本沒有結構性防線——探針證實直接呼叫可以繞過隱藏把 box 打開(任務(c)發現的缺口)。
// 修法:openRideBox() 加 isMyTrain(tr) 短路(跟 updateRideBtn 同一套判斷)。這裡驗兩件事:
// 對照組(真車)#fpRide 本來就看得到、按得下去;自製車不只看不到,結構上也進不去那條路。
async function runFpRideCheck(browser, engineName, P) {
  let ctxR;
  try {
    ctxR = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
    await ctxR.addInitScript(INIT);
    await ctxR.addInitScript(RIDES_INIT, OWN_TRAIN_RIDES);
    const { page, errors, ready } = await bootPage(ctxR, '');
    if (!ready) throw new Error('開機逾時: ' + (errors.slice(0, 3).join(' | ') || 'timeout'));
    await page.evaluate(() => { state.simSec = 8 * 3600; state.clockAtNow = false; state.playing = false; });

    // ── 正向對照:真車跟車,#fpRide 本來就看得到、按下去真的會開 box(證明量測本身有牙齒)──
    // ridingBoardIdx() 比對的是真實牆鐘時刻(見下面自製車那段的說明),隨便抓 state.trains
    // 第一班 tra_sched 車可能真實時刻上已經「過站」、選下車站清單是空的,openRideBox() 會被它
    // 自己的「沒有下一站」早退擋下——跟 isMyTrain 無關,只是挑到不巧的車。挑一班「還有站可選」的。
    const ctrl = await page.evaluate(() => {
      const cands = state.trains.filter(t => t.sys === 'tra_sched');
      for (const tr of cands) {
        const i0 = ridingBoardIdx(tr), optsLen = Math.max(0, tr.stops.length - 1 - i0);
        if (optsLen > 0) { followTrainNo(String(tr.train), { sys: 'tra_sched' }); return { ok: true, no: String(tr.train), optsLen }; }
      }
      return { ok: false, reason: 'no-candidate-with-stops-left', scanned: cands.length };
    });
    ok(P('[fpRide] 前置:對照組挑到一班真車、路上還有站可選(排除巧合卡在最後一站的干擾)'),
      ctrl.ok, JSON.stringify(ctrl));
    if (!ctrl.ok) throw new Error('對照組挑車失敗: ' + JSON.stringify(ctrl));
    const btnState = await page.evaluate(() => {
      const btn = document.getElementById('fpRide');
      const r = btn ? btn.getBoundingClientRect() : null;
      return { btnHidden: btn ? btn.hidden : null, btnVisible: !!r && r.width > 1 && r.height > 1 };
    });
    ok(P('[fpRide] 正向對照:跟著真的台鐵車時 #fpRide 看得到(不是量測環境本身失明)'),
      btnState.btnHidden === false && btnState.btnVisible, JSON.stringify(btnState));
    const ctrlOpen = await page.evaluate(() => {
      const box = document.getElementById('fpRideBox');
      openRideBox(state.followTrain);
      const opened = box.dataset.open === '1';
      box.dataset.open = ''; // 收回去,不留副作用給後面的自製車測試
      return { opened };
    });
    ok(P('[fpRide] 正向對照:真車呼叫 openRideBox() 真的會把選下車站的 box 打開'),
      ctrlOpen.opened, JSON.stringify(ctrlOpen));
    await page.evaluate(() => clearFollow());

    // ── 自製車:真 UI 發車(車庫→表單→發車),depOffset 對齊「真實牆鐘時刻」──
    // ridingNowSched()/ridingBoardIdx 比對的是 nowSecOfDay(activeTz())(真實現在時刻),
    // 不是 state.simSec(任務(c)探針踩過的坑:兩者對不上時車會被判定成「早就到站」,
    // 選下車站清單永遠是空的,測不到「box 打開了沒」)。這裡算出讓表定發車時刻落在
    // 真實現在前 5 分鐘所需的 depOffset,確保自製車是真的「路上還有站」。
    const depOffset = await page.evaluate(() => {
      const real = nowSecOfDay(activeTz());
      return Math.round(real - state.simSec - 300 + 86400) % 86400;
    });
    const mk = await makeOwnTrain(page, { name: 'fp隔離', depOffset });
    ok(P('[fpRide] 前置:自製車建立成功且真的在路上(還有站可選,不是巧合卡在最後一站)'),
      mk.ok, JSON.stringify(mk));
    if (!mk.ok) throw new Error('makeOwnTrain 失敗: ' + JSON.stringify(mk));
    await page.evaluate(() => { const rec = state.myTrains[0]; setFollow(rec, false, false, {}); });
    await page.waitForTimeout(300);

    const dom = await page.evaluate(() => {
      const btn = document.getElementById('fpRide');
      const r = btn ? btn.getBoundingClientRect() : null;
      return { own: !!(state.followTrain && isMyTrain(state.followTrain)),
        btnHidden: btn ? btn.hidden : null, btnZeroSize: !r || r.width < 1 || r.height < 1 };
    });
    ok(P('[fpRide] 自製車:#fpRide 隱藏且零尺寸(視覺層防線仍然在)'),
      dom.own && dom.btnHidden === true && dom.btnZeroSize, JSON.stringify(dom));

    // ── 結構性防線:繞過隱藏,直接呼叫 openRideBox()/fpRideEl.onclick 本身會不會擋 ──
    const choke = await page.evaluate(() => {
      const tr = state.followTrain;
      const i0 = ridingBoardIdx(tr), optsLen = Math.max(0, tr.stops.length - 1 - i0);
      const box = document.getElementById('fpRideBox');
      const before = { open: box.dataset.open, riding: localStorage.getItem('trainmap-riding-v1'), checkins: localStorage.getItem('trainmap-checkins-v1') };
      let threw = null;
      try { openRideBox(tr); } catch (e) { threw = String(e); }
      const afterDirect = { open: box.dataset.open };
      box.dataset.open = ''; // 保險收回,不管上一步結果如何
      document.getElementById('fpRide').click(); // 再繞一條路:直接觸發 onclick,不靠可見性
      const afterClick = { open: box.dataset.open, riding: localStorage.getItem('trainmap-riding-v1'), checkins: localStorage.getItem('trainmap-checkins-v1') };
      return { i0, optsLen, before, afterDirect, afterClick, threw };
    });
    ok(P('[fpRide] 前置:自製車路上還有站可選(optsLen>0,不是巧合落在最後一站,見任務(c)探針記錄)'),
      choke.optsLen > 0, JSON.stringify({ i0: choke.i0, optsLen: choke.optsLen }));
    ok(P('[fpRide] 繞過隱藏直接呼叫 openRideBox()/click() 兩條路都進不去(box 沒被打開)'),
      choke.afterDirect.open !== '1' && choke.afterClick.open !== '1', JSON.stringify(choke));
    ok(P('[fpRide] 繞過隱藏之後,trainmap-riding-v1/trainmap-checkins-v1 這兩把「永遠不准變」的鍵原封不動'),
      choke.afterClick.riding === choke.before.riding && choke.afterClick.checkins === choke.before.checkins,
      JSON.stringify({ before: choke.before, afterClick: choke.afterClick }));

    ok(P('[fpRide] context 頁面零例外'), errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    const msg = String((e && e.stack) || e).slice(0, 300);
    ok(P('[fpRide] 執行'), false, msg);
  } finally {
    if (ctxR) await ctxR.close();
  }
}

// [面板譯名] 跟車面板的車型名稱(rec.typeName,my-train-plan.js 建車時存的原始繁中字串,例如
// 「EMU800 微笑號」)曾經在 updatePanel() 直接塞給 mtSetText,沒有像同一個函式裡 pattern/halo/
// size/nextEta 那幾列一樣包 host.t()——中文使用者看不出差異,但 EN/JA 畫面會漏出一句沒翻譯的
// 繁體中文。修法:my-train-ui.js:247 改成 host.t(rec.typeName)。
// 判準刻意不是「沒有 CJK」(那種判準對 JA 是啞的,JA 譯文本來就是漢字,只是簡繁字元不同,見
// content-translations.js:2503 的「微笑号」vs 繁中原字串「微笑號」),而是直接比對字典裡的確切
// 譯文,EN/JA 各驗一次,兩個語言都要對得上、缺一不可。
// from/to 站名用各語言畫面實際渲染得出建議列的字串(JA 用簡體「台北」不是繁體
// 「臺北」,兩者在字典裡是不同 key;英文用「Taipei」/「Songshan」)——直接沿用 makeOwnTrain
// 內建的「臺北」找不到 EN/JA 畫面渲染出來的建議列。
async function runPanelI18nCheck(browser, engineName, P) {
  const EXPECT = { en: 'EMU800 “Smile”', ja: 'EMU800 微笑号' };
  const FROM = { en: 'Taipei', ja: '台北' };
  const TO = { en: 'Songshan', ja: '松山' };
  const SOURCE = 'EMU800 微笑號';
  for (const lang of ['en', 'ja']) {
    let ctxI;
    try {
      ctxI = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US' });
      await ctxI.addInitScript(INIT);
      await ctxI.addInitScript(RIDES_INIT, OWN_TRAIN_RIDES);
      const { page, errors, ready } = await bootPage(ctxI, '', lang);
      if (!ready) throw new Error('開機逾時: ' + (errors.slice(0, 3).join(' | ') || 'timeout'));
      await page.evaluate(() => { state.simSec = 8 * 3600; state.clockAtNow = false; state.playing = false; });

      const mk = await makeOwnTrain(page, {
        name: lang === 'ja' ? 'JA5' : 'EN5', depOffset: -60,
        modelId: 'emu800', from: FROM[lang], to: TO[lang],
      });
      ok(P(`[面板譯名] (${lang}) 前置:自製車建立成功且已在路上(語言別站名 ${FROM[lang]}→${TO[lang]},depOffset=-60)`),
        mk.ok, JSON.stringify(mk));
      if (!mk.ok) throw new Error('makeOwnTrain 失敗: ' + JSON.stringify(mk));

      const modelText = await page.evaluate(() => document.querySelector('[data-mt-model]')?.textContent ?? null);
      ok(P(`[面板譯名] (${lang}) 面板車型名稱等於字典裡的確切譯文,不是原始繁中字串(修法:my-train-ui.js host.t(rec.typeName))`),
        modelText === EXPECT[lang], JSON.stringify({ modelText, expect: EXPECT[lang] }));
      ok(P(`[面板譯名] (${lang}) 面板車型名稱不含未譯的繁中原字串「${SOURCE}」`),
        typeof modelText === 'string' && !modelText.includes(SOURCE), JSON.stringify({ modelText }));
      // 順行／逆行：路線列尾端標方向（臺北→松山 走最短那邊＝逆行），用字典裡的確切譯文。
      const DIR_TEXT = { en: 'Clockwise', ja: '逆行（時計回り）' };
      const routeText = await page.evaluate(() => document.querySelector('[data-mt-route]')?.textContent ?? null);
      ok(P(`[面板譯名] (${lang}) 路線列標出方向，是字典裡的確切譯文（臺北→松山＝逆行）`),
        typeof routeText === 'string' && routeText.endsWith(' · ' + DIR_TEXT[lang]), JSON.stringify({ routeText, expect: DIR_TEXT[lang] }));
      // 時／分上面要有「每天發車時間」標籤。
      const LBL_TEXT = { en: 'Departs daily at', ja: '毎日の発車時刻' };
      const lbl = await page.evaluate(() => {
        MyTrainUI.openForm(ownTrainHost(), { modelId: 'emu800', preset: null, mode: 'schedule' });
        const text = document.querySelector('#mtForm [data-mt-lbl="deptime"]')?.textContent ?? null;
        MyTrainUI.closeForm();
        return text;
      });
      ok(P(`[面板譯名] (${lang}) 表單「每天發車時間」標籤是字典裡的確切譯文`), lbl === LBL_TEXT[lang], JSON.stringify({ lbl, expect: LBL_TEXT[lang] }));

      ok(P(`[面板譯名] (${lang}) context 頁面零例外`), errors.length === 0, errors.slice(0, 3).join(' | '));
    } catch (e) {
      const msg = String((e && e.stack) || e).slice(0, 300);
      ok(P(`[面板譯名] (${lang}) 執行`), false, msg);
    } finally {
      if (ctxI) await ctxI.close();
    }
  }
}

// ══════════════════════ [順逆行] 環島順行／逆行、每天發車時間標籤 ══════════════════
// 要有順行或逆行的選項、標籤文字要寫清楚。走真實的車庫 UI 點擊＋發車流程:
// 驗「真的這樣按」會不會換到另一邊、存檔讀回、面板有沒有標方向;換訖站要回到新那組站的最短那邊。
// 里程只比大小(另一邊比預設長 100 公里以上),不寫死公里數——實際數值由 verify_my_train_plan.mjs 對腳本自己的圖驗。
async function runDirCheck(browser, engineName, P) {
  let ctxD;
  try {
    ctxD = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
    await ctxD.addInitScript(INIT);
    await ctxD.addInitScript(RIDES_INIT, OWN_TRAIN_RIDES);
    const { page, errors, ready } = await bootPage(ctxD, '');
    if (!ready) throw new Error('開機逾時: ' + (errors.slice(0, 3).join(' | ') || 'timeout'));
    await page.evaluate(() => { state.simSec = 8 * 3600; state.clockAtNow = false; state.playing = false; });
    const readForm = () => page.evaluate(() => {
      const vis = e => !!(e && !e.hidden && e.getClientRects().length);
      const box = document.querySelector('#mtForm .mt-f-dir'), via = document.querySelector('#mtForm .mt-f-via');
      const lbl = document.querySelector('#mtForm [data-mt-lbl="deptime"]');
      const route = document.querySelector('#mtForm [data-mt-f="route"]')?.textContent || '';
      const m = route.match(/([\d.]+) 公里/);
      return { dirVisible: vis(box), viaVisible: vis(via), route, km: m ? Number(m[1]) : null,
        pressed: box ? [...box.querySelectorAll('[data-mt-fdir]')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.v) : [],
        labels: box ? [...box.querySelectorAll('[data-mt-fdir]')].map(b => b.textContent) : [],
        deptime: lbl ? lbl.textContent : null, deptimeVisible: vis(lbl) };
    });

    await openGarage(page);
    await pickModel(page, 'emu800');
    await press(page, '[data-mt-g="schedule"]');
    const opened = await page.waitForFunction(() => document.getElementById('mtForm')?.open === true, null, { timeout: 5000 })
      .then(() => true).catch(() => false);
    if (!opened) throw new Error('排班表單沒開起來(emu800)');
    const f0 = await readForm();
    ok(P('[順逆行] 時／分上面有「每天發車時間」標籤'), f0.deptimeVisible && f0.deptime === '每天發車時間', JSON.stringify(f0));
    ok(P('[順逆行] 還沒選起訖站時不顯示順行／逆行'), !f0.dirVisible, JSON.stringify(f0));
    await sugPick(page, 'from', '臺北');
    await sugPick(page, 'to', '臺東');
    const f1 = await readForm();
    ok(P('[順逆行] 臺北→臺東:顯示「順行」「逆行」兩顆鈕,預設選逆行(最短那邊)'),
      f1.dirVisible && JSON.stringify(f1.labels) === '["順行","逆行"]' && JSON.stringify(f1.pressed) === '["ni"]' && f1.km > 0, JSON.stringify(f1));
    await press(page, '[data-mt-fdir="shun"]');
    const f2 = await readForm();
    ok(P('[順逆行] 點順行:只有順行亮、路線改繞另一邊(長 100 公里以上)、山線／海線鈕跟著出現'),
      JSON.stringify(f2.pressed) === '["shun"]' && f2.km > f1.km + 100 && f2.viaVisible, JSON.stringify({ f1: f1.km, f2 }));
    await press(page, '[data-mt-fdir="ni"]');
    const f3 = await readForm();
    ok(P('[順逆行] 對照:點回逆行,里程回到原本、山線／海線鈕收起'), JSON.stringify(f3.pressed) === '["ni"]' && f3.km === f1.km && !f3.viaVisible,
      JSON.stringify({ f1: f1.km, f3 }));
    await press(page, '[data-mt-fdir="shun"]');
    const dep = await fillFormAndDepart(page, { depOffset: -60, name: '順行測' });
    ok(P('[順逆行] 選順行發車成功,停站經過高雄、枋寮,沒經過花蓮'),
      dep.ok && dep.stopNames.includes('高雄') && dep.stopNames.includes('枋寮') && !dep.stopNames.includes('花蓮'), JSON.stringify({ ok: dep.ok, reason: dep.reason }));
    const after = await page.evaluate(() => ({ dir: state.myTrains[0]?._ownDir, saved: MyTrainUI.load().train?.dir,
      route: document.querySelector('[data-mt-route]')?.textContent ?? null }));
    ok(P('[順逆行] 發車後 record._ownDir 與存檔 dir 都是 shun'), after.dir === 'shun' && after.saved === 'shun', JSON.stringify(after));
    ok(P('[順逆行] 面板路線列標出「順行」與「山線」'), typeof after.route === 'string' && after.route.includes(' · 順行') && after.route.endsWith(' · 山線'),
      JSON.stringify(after));
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && Array.isArray(state.myTrains) && state.myTrains.length > 0, null, { timeout: 10000 });
    const reloaded = await page.evaluate(() => ({ dir: state.myTrains[0]?._ownDir, gao: state.myTrains[0]?.stops.some(s => s.name === '高雄') }));
    ok(P('[順逆行] 重新整頁後仍是順行(存檔正確讀回)'), reloaded.dir === 'shun' && reloaded.gao, JSON.stringify(reloaded));

    // 換訖站:方向回到新那組站的最短那邊,不沿用上一組選的順行。
    await page.evaluate(() => MyTrainUI.openForm(ownTrainHost(), { modelId: 'emu800', preset: null, mode: 'schedule' }));
    await sugPick(page, 'from', '臺北');
    await sugPick(page, 'to', '臺東');
    await press(page, '[data-mt-fdir="shun"]');
    const g1 = await readForm();
    await sugPick(page, 'to', '花蓮');
    const g2 = await readForm();
    ok(P('[順逆行] 選了順行再把訖站換成花蓮:回到花蓮的最短那邊(逆行),里程比剛才的順行短'),
      JSON.stringify(g1.pressed) === '["shun"]' && JSON.stringify(g2.pressed) === '["ni"]' && g2.km < g1.km, JSON.stringify({ g1, g2 }));
    await page.evaluate(() => MyTrainUI.closeForm());

    ok(P('[順逆行] 這個 context 全程零例外'), errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok(P('[順逆行] 執行'), false, String((e && e.stack) || e).slice(0, 300));
  } finally {
    if (ctxD) await ctxD.close();
  }
}

// ══════════════════════ [車牌顏色] 表單色鈕、顏色存讀、名字計數 ══════════════════
// 顏色只能選自己系統的色盤(不能用螢光色);高鐵只有一色不給選,整排藏掉;名字上限 5 字。
// 三系統的色鈕檢查直接呼叫 MyTrainUI.openForm(ownTrainHost(), {modelId,...})——跟 index.html「排班」
// 鈕的正式呼叫路徑完全一樣,只是不必真的先在車庫解鎖林鐵/高鐵車款(OWN_TRAIN_RIDES 只預置了台鐵
// 搭乘紀錄,見檔案開頭註解)。持久化與名字計數兩段仍走真實的車庫 UI 點擊+發車流程,因為那兩段
// 要驗的正是「使用者真的這樣按會不會生效」。
async function runColorPlateCheck(browser, engineName, P) {
  let ctxC;
  try {
    ctxC = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
    await ctxC.addInitScript(INIT);
    await ctxC.addInitScript(RIDES_INIT, OWN_TRAIN_RIDES);
    const { page, errors, ready } = await bootPage(ctxC, '');
    if (!ready) throw new Error('開機逾時: ' + (errors.slice(0, 3).join(' | ') || 'timeout'));
    await page.evaluate(() => { state.simSec = 8 * 3600; state.clockAtNow = false; state.playing = false; });

    // 讀色鈕列目前的樣子(hidden 的格位排除):{wrapHidden, buttons:[{v,name,pressed}]}。
    const readColorRow = () => page.evaluate(() => {
      const wrap = document.querySelector('[data-mt-f="colorswrap"]');
      const btns = [...document.querySelectorAll('[data-mt-color]')].filter(b => !b.hidden).map(b => ({
        v: b.dataset.v, name: b.querySelector('span')?.textContent || '', pressed: b.getAttribute('aria-pressed') === 'true',
      }));
      return { wrapHidden: !!(wrap && wrap.hidden), buttons: btns };
    });
    const openFormFor = (modelId) => page.evaluate((id) => {
      MyTrainUI.openForm(ownTrainHost(), { modelId: id, preset: null, mode: 'schedule' });
    }, modelId);

    await openFormFor('emu800');
    const tra = await readColorRow();
    ok(P('[車牌顏色] 台鐵表單顯示 5 個色鈕,名稱與色碼跟色盤一致(含順序)'),
      !tra.wrapHidden && JSON.stringify(tra.buttons.map(b => [b.name, b.v])) === JSON.stringify([
        ['自強', '#C0392B'], ['莒光/復興', '#E8792B'], ['區間車', '#2E6FB0'], ['區間快', '#16A085'], ['其他', '#8E44AD']]),
      JSON.stringify(tra));
    ok(P('[車牌顏色] EMU800 這種普通車預設選中「區間車」'),
      tra.buttons.find(b => b.name === '區間車')?.pressed === true, JSON.stringify(tra));
    // 色鈕列必須是表單內容的第一列（緊接車款之後）。
    const firstRow = await page.evaluate(() => document.querySelector('#mtForm .mt-f-body')?.firstElementChild?.dataset?.mtF || null);
    ok(P('[車牌顏色] 色鈕列是表單內容的第一列(緊接車款之後)'), firstRow === 'colorswrap', String(firstRow));
    await page.evaluate(() => MyTrainUI.closeForm());

    await openFormFor('dl25');
    const afr = await readColorRow();
    ok(P('[車牌顏色] 林鐵表單顯示 4 個色鈕(不多不少)'), !afr.wrapHidden && afr.buttons.length === 4, JSON.stringify(afr));
    await page.evaluate(() => MyTrainUI.closeForm());

    await openFormFor('700t');
    const hsr = await readColorRow();
    ok(P('[車牌顏色] 高鐵表單整排色鈕藏掉(只有一色、不給選)'), hsr.wrapHidden, JSON.stringify(hsr));
    await page.evaluate(() => MyTrainUI.closeForm());

    // 選一個非預設色(台鐵「其他」#8E44AD),真的走車庫 UI 排一班,重新整頁,顏色仍是選過的那個。
    await openGarage(page);
    await pickModel(page, 'emu800');
    await press(page, '[data-mt-g="schedule"]');
    const opened = await page.waitForFunction(() => document.getElementById('mtForm')?.open === true, null, { timeout: 5000 })
      .then(() => true).catch(() => false);
    if (!opened) throw new Error('排班表單沒開起來(emu800)');
    await page.click('[data-mt-color][data-v="#8E44AD"]');
    const picked = await fillFormAndDepart(page, { from: '臺北', to: '松山', depOffset: -60, name: '色測' });
    ok(P('[車牌顏色] 選非預設色後排班成功'), picked.ok, JSON.stringify(picked));
    const colorAfterDepart = await page.evaluate(() => state.myTrains[0]?.color);
    ok(P('[車牌顏色] 排班後 record.color 是選中的那個(不是這台車的預設色)'), colorAfterDepart === '#8E44AD', String(colorAfterDepart));
    // 桌機跟隨列（renderFollowBar）：自製車要顯示使用者取的名字，不能印出內部識別碼 my:<uuid>；名字不進自動翻譯。
    const fbar = await page.evaluate(() => {
      const fb = document.getElementById('followBar'), b = fb && fb.querySelector('b');
      return { following: state.followTrain === state.myTrains[0], hidden: !!(fb && fb.hidden), text: b ? b.textContent : null,
        skip: !!(b && b.hasAttribute('data-i18n-skip')) };
    });
    ok(P('[車牌顏色] 桌機跟隨列顯示名字「色測」,不是 my: 識別碼,且名字不進自動翻譯'),
      fbar.following && !fbar.hidden && fbar.text === '色測' && fbar.skip, JSON.stringify(fbar));
    await page.reload();
    // window.state 對 lexical let/const 宣告的 state 恆是 undefined(整份檔案其他地方都用
    // typeof state!=='undefined' 這個安全寫法,如 verify_train_halo.mjs),原本這裡會一路等到逾時。
    await page.waitForFunction(() => typeof state !== 'undefined' && Array.isArray(state.myTrains) && state.myTrains.length > 0, null, { timeout: 10000 });
    const colorAfterReload = await page.evaluate(() => state.myTrains[0]?.color);
    ok(P('[車牌顏色] 重新整頁後顏色仍是選中的那個(存檔正確讀回,不是退回預設)'), colorAfterReload === '#8E44AD', String(colorAfterReload));

    // 名字計數:剛好 5 字可排班,6 字顯示 6/5 且排班鈕停用。
    await deleteOwnTrain(page);
    await openGarage(page);
    await pickModel(page, 'emu800');
    await press(page, '[data-mt-g="schedule"]');
    const opened2 = await page.waitForFunction(() => document.getElementById('mtForm')?.open === true, null, { timeout: 5000 })
      .then(() => true).catch(() => false);
    if (!opened2) throw new Error('排班表單沒開起來(名字計數前置)');
    await sugPick(page, 'from', '臺北');
    await sugPick(page, 'to', '松山');
    await page.locator('[data-mt-f="name"]').fill('一二三四五');
    let cnt = await page.evaluate(() => document.querySelector('[data-mt-f="namecount"]')?.textContent);
    let disabled5 = await page.evaluate(() => document.querySelector('[data-mt-f="depart"]')?.disabled);
    ok(P('[車牌顏色] 名字剛好 5 字:計數顯示 5/5,排班鈕沒被停用'), cnt === '5/5' && disabled5 === false, JSON.stringify({ cnt, disabled5 }));
    await page.locator('[data-mt-f="name"]').fill('一二三四五六');
    cnt = await page.evaluate(() => document.querySelector('[data-mt-f="namecount"]')?.textContent);
    let disabled6 = await page.evaluate(() => document.querySelector('[data-mt-f="depart"]')?.disabled);
    ok(P('[車牌顏色] 名字 6 字:計數顯示 6/5,排班鈕停用'), cnt === '6/5' && disabled6 === true, JSON.stringify({ cnt, disabled6 }));
    await page.evaluate(() => MyTrainUI.closeForm());

    ok(P('[車牌顏色] 這個 context 全程零例外'), errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok(P('[車牌顏色] 執行'), false, String((e && e.stack) || e).slice(0, 300));
  } finally {
    if (ctxC) await ctxC.close();
  }
}

async function runEngine(engineName, engine) {
  const P = s => `${engineName} ${s}`;
  let browser;
  try { browser = await engine.launch(engineName === 'chromium' ? { channel: 'chrome', headless: true } : { headless: true }); }
  catch (e) { ok(P('F0 瀏覽器起得來'), false, String(e && e.message).slice(0, 200)); return; }

  // ══════════════════════ 桌面 context:主流程 ══════════════════════════
  const requestLog = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
  await ctx.addInitScript(INIT);
  await ctx.addInitScript(RIDES_INIT, OWN_TRAIN_RIDES);
  ctx.on('request', req => requestLog.push({ url: req.url(), method: req.method(), postData: req.postData() }));
  const { page, errors, ready } = await bootPage(ctx, '');
  if (!ready) {
    ok(P('T0 開機就緒'), false, errors.slice(0, 3).join(' | ') || 'timeout');
    await ctx.close(); await browser.close(); return;
  }
  const servedBuild = await page.evaluate(() => typeof BUILD !== 'undefined' ? BUILD : '?');
  ok(P('T0 服務端 BUILD 與本機檔案一致'), servedBuild === localBuild, `served=${servedBuild} local=${localBuild}`);

  // 時鐘釘死:固定在一個台鐵班表範圍內的平日早上(08:00),不動 Date.now()——自製車路線計算
  // 不吃真實日期,只吃 state.simSec;正向對照改用「當下真的有在跑的真車」為前提,詳見下方。
  await page.evaluate(() => { state.simSec = 8 * 3600; state.clockAtNow = false; state.playing = false; });

  // 監聽器自檢:包住 updateFollowPanel／laSync,計數呼叫次數,供 [正向] 使用。
  await page.evaluate(() => {
    window.__lpCalls = 0; window.__lsCalls = 0;
    const _u = updateFollowPanel; updateFollowPanel = function (...a) { window.__lpCalls++; return _u.apply(this, a); };
    const _l = laSync; laSync = function (...a) { window.__lsCalls++; return _l.apply(this, a); };
  });

  // 原生 stand-in 自檢(證明「零呼叫」的量測本身不是瞎的):主動呼叫一次,確認記錄得到。
  // 後面所有「零呼叫」都是反向判準(=== 0),沒有正向對照就是恆真。錄音器有三條各自獨立的
  // 路徑(Capacitor.Plugins 的 Proxy、window.RAIL_NATIVE_* 的 Proxy、navigator.share 的
  // defineProperty),**三條都要各自證明錄得到**——只驗其中一條,另外兩條壞掉時零呼叫照樣全綠。
  const probeLen0 = await page.evaluate(() => window.__nativeCalls.length);
  const probe = await page.evaluate(() => {
    const seen = [];
    window.Capacitor.Plugins.__ISOLATION_SELFTEST__.ping('x');
    seen.push(window.__nativeCalls.at(-1)?.bridge);
    window.RAIL_NATIVE_LIVEACTIVITY.__selftest('x');
    seen.push(window.__nativeCalls.at(-1)?.bridge);
    try { navigator.share({ title: 'x' }); } catch (e) {}
    seen.push(window.__nativeCalls.at(-1)?.bridge);
    return { total: window.__nativeCalls.length, seen };
  });
  const probeLen1 = probe.total;
  ok(P('[正向] 原生替身錄音自檢:三條路徑(Plugins／RAIL_NATIVE_*／navigator.share)各自都錄得到'),
    probeLen1 === probeLen0 + 3
    && probe.seen[0] === 'Capacitor.Plugins.__ISOLATION_SELFTEST__'
    && probe.seen[1] === 'RAIL_NATIVE_LIVEACTIVITY'
    && probe.seen[2] === 'navigator.share',
    `before=${probeLen0} after=${probeLen1} seen=${JSON.stringify(probe.seen)}`);
  const nativeBaseIdx = probeLen1; // 之後的「零呼叫」一律從這個索引往後算,排除自檢那三發

  // 先把首次造訪的一次性提示旗標蓋掉再取基準,否則它會在量測窗內從無到有,混進「自製車動了
  // 不該動的鍵」的紅名單裡——它其實是點開鐵道面板就會寫的 UI 旗標,跟自製車無關
  // (index.html 的 state._railTipsOnce:讀到就 return、沒讀到就寫 '1')。等同一個回訪使用者。
  await page.evaluate(() => { try { localStorage.setItem('trainmap-railtip1', '1'); } catch (e) {} });
  const snap0 = await lsSnapshot(page);

  // ── 找一班此刻(釘住的 08:00)地圖上有的台鐵真車,名字故意撞號 ─────────
  const collision = await page.evaluate(() => {
    const tr = state.trains.find(t => t.sys === 'tra_sched');
    return tr ? String(tr.train) : null;
  });
  ok(P('前置:找得到一班可撞號的真車車次'), !!collision, String(collision));

  // ── [正向] G0:車庫卡片——預置的完乘紀錄讓 emu800 入庫,「自己排一班」出現且按得下去。
  // 這條先於任何自製車存在時測,證明「有得排」這件事本身測得到,不是後面所有卡片斷言的恆真空跑。
  await openGarage(page);
  await pickModel(page, 'emu800');
  const cardPre = await readCard(page);
  const schedHit = await hitsSelf(page, '[data-mt-g="schedule"]');
  ok(P('[正向] G0 預置的完乘紀錄讓 emu800 入庫,卡片上「自己排一班」出現且按得下去'),
    cardPre.badge === '已入庫' && !!cardPre.plan && cardPre.plan.disabled === false && schedHit,
    JSON.stringify({ cardPre, schedHit }));
  await closeGarage(page);

  // ══════════════════════ Scenario A:撞號名字,走完整流程 ══════════════
  const nameA = collision || '520';
  const mkA = await makeOwnTrain(page, { name: nameA, depOffset: 60 });
  ok(P('前置:自製車(撞號名)建立成功,路線含台北與松山、停靠 >=3 站'),
    mkA.ok && mkA.hasSongshan && mkA.stopCount >= 3, JSON.stringify(mkA));

  if (mkA.ok) {
    const ridesBefore = await page.evaluate(() => { try { return localStorage.getItem('trainmap-rides'); } catch (e) { return null; } });
    const reqIdxBeforeFollow = requestLog.length;

    // 發車之後不要再用 followOwnTrain 把狀態覆蓋掉——ownTrainDepart 內部已經呼叫過
    // ownTrainFollow(),這裡只讀現況,不重新跟一次(重跟會用 -30 秒的假撥鐘蓋掉真正的
    // -20 秒撥鐘,反而測不出真正的發車行為)。
    const f1 = await page.evaluate(() => ({
      ok: !!state.followTrain && isMyTrain(state.followTrain) && state.followTrain === state.myTrains[0],
      url: location.pathname + location.search,
    }));
    ok(P('[網址] 發車後自動跟上自製車(不必另外呼叫跟車函式),網址沒有 train='), f1.ok && !/[?&]train=/.test(f1.url), JSON.stringify(f1));

    // 強制驗證 laSync 本身(不是只驗到環境閘門):liveActivityAllowed() 還吃 plusIsActive(),
    // 測試環境沒有登入不會是 true,不補這一步「零呼叫」在有沒有 isMyTrain 擋點時都會是零、是空斷言。
    // 短暫切回 1x/clockAtNow 直接呼叫一次 laSync,讓它有機會真的觸及原生橋接再切回 60x 快轉。
    await page.evaluate(() => {
      state.plus = { active: true };
      const prevClockAtNow = state.clockAtNow, prevSpeed = state.speedMult, prevPlaying = state.playing;
      state.clockAtNow = true; state.speedMult = 1; state.playing = true;
      try { laSync(state.myTrains[0], true); } catch (e) {}
      state.clockAtNow = prevClockAtNow; state.speedMult = prevSpeed; state.playing = prevPlaying;
    });

    const arrivedA = await fastForwardToArrival(page, 60000);
    ok(P('前置:自製車(撞號名)以 60x 倍速快轉抵達終點'), arrivedA, `arrived=${arrivedA}`);

    const midUrl = await page.evaluate(() => location.pathname + location.search);

    ok(P('[網址] 跟自製車全程(發車到抵達)網址從沒出現過 train='), !/[?&]train=/.test(midUrl), midUrl);

    const flux = await page.evaluate(() => ({
      trainsHasMine: state.trains.some(isMyTrain),
      ridesAfter: (() => { try { return localStorage.getItem('trainmap-rides'); } catch (e) { return null; } })(),
    }));
    ok(P('[分流] state.trains 從未含自製車(state.trains.some(isMyTrain) 恆 false)'), flux.trainsHasMine === false, JSON.stringify(flux));
    ok(P('[不寫入] 完乘紀錄沒有被觸發(trainmap-rides 跟出發前一致,recordRide 沒被呼叫)'),
      flux.ridesAfter === ridesBefore, `before=${ridesBefore} after=${flux.ridesAfter}`);

    // Firestore:只在網路層看有沒有打到 firestore——見檔頭「已知簡化」說明。
    const fsHits = requestLog.slice(reqIdxBeforeFollow).filter(r => /firestore\.googleapis\.com/.test(r.url));
    ok(P('[不寫入] Firestore 零寫入(觀測範圍:firestore.googleapis.com 網路請求,見檔頭已知簡化)'), fsHits.length === 0, `hits=${fsHits.length}`);

    // WebMCP
    const mcp = await page.evaluate(() => webMcpCurrentView());
    const followingLeaksTrainNo = mcp.following && Object.prototype.hasOwnProperty.call(mcp.following, 'train_number');
    const followingHasCustomName = mcp.following && mcp.following.customName === nameA;
    ok(P('[WebMCP] 跟隨中回報沒有 train_number 欄位,名字只在 customName'),
      mcp.following && !followingLeaksTrainNo && followingHasCustomName, JSON.stringify(mcp.following));

    // 通阻公告:monkeypatch alertAffectedLineIds,逼出「這條線有公告」的情境,驗自製車不受影響。
    const alertTest = await page.evaluate(() => {
      const rec = state.myTrains[0];
      const seg = rec.stops.find(s => s.segLn);
      if (!seg) return { ok: false, reason: 'no-segLn' };
      const orig = window.alertAffectedLineIds;
      window.alertAffectedLineIds = () => new Set([seg.segLn.id]);
      updateFollowAlert();
      const el = document.getElementById('fpAlert');
      const res = { ok: true, hidden: el ? el.hidden : null, text: el ? el.textContent : null };
      window.alertAffectedLineIds = orig;
      updateFollowAlert();
      return res;
    });
    ok(P('[通阻公告] 命中自製車行經線段時,自製車仍不顯示停駛提示'),
      alertTest.ok && alertTest.hidden === true, JSON.stringify(alertTest));

    // 分享/行程連結
    const shareTest = await page.evaluate(({ id, name }) => {
      const url = buildShareUrl();
      const rec = state.myTrains[0];
      const destName = rec.stops[rec.stops.length - 1].name;
      const trip = buildTripUrl(rec, destName);
      // 網址可能把識別碼/名字 encodeURIComponent 過(冒號會變成 %3A),兩種寫法都要比對,
      // 否則編碼過的洩漏會被子字串比對漏掉(這裡踩過一次:buildShareUrl 原文洩漏但比對用未編碼字串沒抓到)。
      const encId = encodeURIComponent(id), encName = encodeURIComponent(name);
      const leaks = (s, needle, enc) => s != null && (s.includes(needle) || s.includes(enc));
      return { url, trip,
        leaksIdInUrl: leaks(url, id, encId), leaksNameInUrl: leaks(url, name, encName),
        leaksIdInTrip: leaks(trip, id, encId), leaksNameInTrip: leaks(trip, name, encName) };
    }, { id: mkA.id, name: nameA });
    ok(P('[分享連結] buildShareUrl 對自製車不含識別碼(退回地點+時間)'), !shareTest.leaksIdInUrl, JSON.stringify(shareTest));
    ok(P('[分享連結] buildTripUrl 對自製車不生成含識別碼的行程連結'), !shareTest.leaksIdInTrip, JSON.stringify(shareTest));

    // 提醒:#fpNotify 應該藏起來;就算被點了也不該打原生通知橋接。
    const notify1 = await page.evaluate(() => {
      const el = document.getElementById('fpNotify');
      return el ? { exists: true, hidden: getComputedStyle(el).display === 'none', x: el.getBoundingClientRect() } : { exists: false };
    });
    ok(P('[到站提醒] 跟著自製車時 #fpNotify(到站提醒)藏起來'), notify1.exists && notify1.hidden, JSON.stringify(notify1));
    if (notify1.exists && !notify1.hidden && notify1.x.width > 0) {
      await page.mouse.click(notify1.x.x + notify1.x.width / 2, notify1.x.y + notify1.x.height / 2);
      await page.waitForTimeout(300);
    }
    const nativeAfterNotify = await page.evaluate((from) => window.__nativeCalls.slice(from), nativeBaseIdx);
    const laCalls = nativeAfterNotify.filter(c => c.bridge === 'RAIL_NATIVE_LIVEACTIVITY');
    const notifyCalls = nativeAfterNotify.filter(c => c.bridge === 'RAIL_NATIVE_LOCALNOTIFY');
    ok(P('[到站提醒] 跟著/點了自製車的提醒鈕,RAIL_NATIVE_LOCALNOTIFY 零呼叫(openLocalReminderSheet 沒被放行)'),
      notifyCalls.length === 0, `calls=${JSON.stringify(notifyCalls)}`);
    ok(P('[即時動態] 自製車跟隨全程 RAIL_NATIVE_LIVEACTIVITY 零呼叫(laSync 函式本身該擋下)'),
      laCalls.length === 0, `calls=${JSON.stringify(laCalls)}`);
    ok(P('[推播綁定] 自製車跟隨全程沒有把停站表送去 /api/la/bind(pushToken 回呼不綁定,同一份原生零呼叫證據)'),
      laCalls.length === 0, `calls=${JSON.stringify(laCalls)}`);

    // 事件列(state.ownTrainLog,沒有這個欄位時一律清楚 FAIL)
    const ev1 = await page.evaluate(() => {
      const log = state.ownTrainLog;
      if (!log || !Array.isArray(log.items)) return { exists: false };
      return { exists: true, items: log.items };
    });
    if (!ev1.exists) {
      ok(P('[事件] state.ownTrainLog.items 存在'), false, 'state.ownTrainLog 不存在');
      ok(P('[事件] 跑完一趟:發車/每個停靠站/抵達各一條,沒有待避禮讓'), false, 'state.ownTrainLog 不存在');
    } else {
      const texts = ev1.items.map(x => JSON.stringify(x));
      const hasDepart = texts.some(t => t.includes('發車')); // 發車
      const hasArrive = texts.some(t => t.includes('抵達')); // 抵達
      const stopMentions = mkA.stopNames.filter(n => n !== '台北' && n !== mkA.stopNames[mkA.stopNames.length - 1])
        .filter(n => texts.some(t => t.includes(n))).length;
      const hasBlock = texts.some(t => t.includes('待避禮讓')); // 待避禮讓
      ok(P('[事件] 跑完一趟:起站有發車、每個中間停靠站都有停靠、訖站有抵達'),
        hasDepart && hasArrive && stopMentions >= (mkA.stopCount - 2), `items=${ev1.items.length} stopMentions=${stopMentions}/${mkA.stopCount - 2}`);
      ok(P('[事件] 從沒出現「待避禮讓」字樣'), !hasBlock, `items=${ev1.items.length}`);
      // 抵達之後面板上的事件列也要跟上:抵達後 updateFollowCamera 在呼叫 updateFollowPanel 之前就早退,
      // 面板若只靠那條路更新,最後那條「抵達」只記在 state 裡、畫面上看不到。
      const evDom = await page.evaluate(() => {
        const fp = document.getElementById('followPanel');
        const rows = [...fp.querySelectorAll('[data-mt-events] .mt-ev')];
        return { rows: rows.length, items: state.ownTrainLog.items.length, fpShown: !fp.hidden,
          arriveRow: rows.some(r => r.textContent.includes('抵達')), status: state.followStatus };
      });
      ok(P('[事件] 抵達後面板上的事件列跟記下的一樣多條,看得到「抵達」那條'),
        evDom.fpShown && evDom.items > 0 && evDom.rows === evDom.items && evDom.arriveRow, JSON.stringify(evDom));
    }

    // 名字跳脫(跳到 Scenario B 之前,先做「去看它」重看,驗事件列不重複)。
    // 真的點車庫卡片的 [data-mt-g="view"],不用 followOwnTrain 代替;順便驗「去看它」
    // 的四個不變量——isMyTrain、跟到的物件就是 state.myTrains[0]、面板看得到、時鐘撥到發車前
    // 20 秒附近(這班車此刻不在路上——已經跑完一趟)。
    await page.evaluate(() => clearFollow());
    const view1 = await pressViewOnCard(page);
    await page.waitForTimeout(300);
    const viewInfo = await page.evaluate(() => {
      const r = state.myTrains[0];
      return {
        isMine: !!state.followTrain && isMyTrain(state.followTrain), sameObj: state.followTrain === r,
        panelShown: !!document.querySelector('#followPanel [data-mt-panel]') && !document.getElementById('followPanel').hidden,
        simSec: state.simSec, dep: r.stops[0].depSec,
      };
    });
    const simMinusDep = (((viewInfo.simSec - viewInfo.dep) % 86400) + 86400) % 86400;
    const simMinusDepSigned = simMinusDep > 43200 ? simMinusDep - 86400 : simMinusDep;
    ok(P('「去看它」真的點卡片按鈕:isMyTrain、跟到的物件就是 state.myTrains[0]、面板看得到、時鐘撥到發車前 20 秒附近(±10 秒)'),
      view1.ok && viewInfo.isMine && viewInfo.sameObj && viewInfo.panelShown && Math.abs(simMinusDepSigned + 20) <= 10,
      JSON.stringify({ view1: { ok: view1.ok, card: view1.card }, viewInfo, simMinusDepSigned }));
    const f2 = { ok: view1.ok };
    const arrivedA2 = f2.ok ? await fastForwardToArrival(page, 60000) : false;
    const ev2 = await page.evaluate(() => {
      const log = state.ownTrainLog;
      return log && Array.isArray(log.items) ? log.items.map(x => ({ kind: x.kind, key: x.key, rel: x.rel })) : null;
    });
    if (!ev1.exists) {
      ok(P('[事件]「去看它」重看之後,事件列沒有任何一條重複'), false, 'state.ownTrainLog 不存在');
    } else {
      // 事件列的去重(直接照規則寫,不讀實作):發車/停靠/抵達同一站一趟一次;
      // 交會/從旁通過同一班真車前後 900 秒內一次。重看同一趟也不清空(發車日一樣＝重看),
      // 所以停靠類的條數要跟第一次一樣——少了代表被清掉、多了代表重複。
      const STOPK = new Set(['depart', 'stop', 'arrive']);
      const list = ev2 || [];
      const dups = [];
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.key !== b.key || STOPK.has(a.kind) !== STOPK.has(b.kind)) continue;
        if (STOPK.has(a.kind) || Math.abs(a.rel - b.rel) < 900) dups.push([a, b]);
      }
      const nStop1 = ev1.items.filter(x => STOPK.has(x.kind)).length, nStop2 = list.filter(x => STOPK.has(x.kind)).length;
      ok(P('[事件]「去看它」重看之後,事件列沒有任何一條重複,停靠類條數跟第一次一樣(沒被清空)'),
        arrivedA2 && list.length > 0 && dups.length === 0 && nStop2 === nStop1,
        `arrived=${arrivedA2} first=${ev1.items.length}(停靠類 ${nStop1}) afterReplay=${list.length}(停靠類 ${nStop2}) dups=${JSON.stringify(dups.slice(0, 3))}`);
    }

    // 面板按鈕(桌面):放在重看之後——這一輪會真的按下「刪除」,排在前面的話重看時車已經不在了。
    // 這裡只是確保還在跟車(前面的「去看它」流程結束時應該已經是跟著的),不是要重新測
    // 「去看它」——已經在跟就不做事,不在跟才用真的點擊補回來,不用 followOwnTrain 的假撥鐘蓋掉現況。
    if (!(await page.evaluate(() => !!(state.followTrain && isMyTrain(state.followTrain))))) await pressViewOnCard(page);
    await page.waitForTimeout(300);
    // skipDelete=true(實測發現的坑):下面緊接著有更完整的 dismiss→accept 刪除確認序列,
    // 這裡的 delete 交給那段驗,不在這裡先用預設 accept 把車刪掉——跟排除 edit 是同一個理由。
    const btnsDesktop = await tryPanelButtons(page, false, true);
    for (const act of ['halo', 'size', 'unfollow']) {
      const j = judgePanelButton(act, btnsDesktop[act]);
      ok(P(`[分流] 桌面面板按鈕「${act}」真的點下去、狀態真的變了`), j.pass, j.detail);
    }

    // 網路 payload 完整值掃描(不比子字串):掃 Scenario A 全程(建立到現在)的所有請求。
    const reqSliceA = requestLog.slice(reqIdxBeforeFollow);
    const leakHits = scanRequestsForIdentity(reqSliceA, [mkA.id, nameA]);
    ok(P('[網址] 跟自製車全程,所有網路請求的每個查詢參數值/JSON 字串值都不等於識別碼或名字(比完整值)'),
      leakHits.length === 0, `hits=${JSON.stringify(leakHits.slice(0, 5))}`);

    // ── 刪除確認:先 dismiss(車還在,對話框訊息含車名),再 accept(車被刪、跟車結束) ──
    const dlgIdxDel = page.__mtDialogs.length;
    nextDialog(page, 'dismiss');
    const delDismiss = await deleteOwnTrain(page);
    const dismissDlg = page.__mtDialogs.slice(dlgIdxDel).find(d => d.type === 'confirm');
    ok(P('刪除確認 dismiss:對話框訊息含車名,車還在,確實走介面(非 uiFallback)'),
      !!dismissDlg && dismissDlg.message.includes(nameA) && delDismiss.myTrainsLen === 1 && delDismiss.uiFallback !== true,
      JSON.stringify({ dismissDlg, delDismiss }));
    nextDialog(page, 'accept');
    const delAccept = await deleteOwnTrain(page);
    const stillFollowingAfterDelete = await page.evaluate(() => !!(state.followTrain && isMyTrain(state.followTrain)));
    ok(P('刪除確認 accept:車被刪、跟車結束、確實走介面(非 uiFallback)'),
      delAccept.myTrainsLen === 0 && !stillFollowingAfterDelete && delAccept.uiFallback !== true,
      JSON.stringify({ delAccept, stillFollowingAfterDelete }));
  }

  // ══════════════════════ Scenario B:名字含 <q>,只驗跳脫(名字上限 5 字,
  // 開合標籤配對最短要 7 字素放不下,改單一未閉合標籤;<q> 面板自己從沒用過,零碰撞) ══════
  const nameB = '<q>ab';
  const mkB = await makeOwnTrain(page, { name: nameB, depOffset: 60 });
  ok(P('前置:自製車(<q> 名字)建立成功'), mkB.ok, JSON.stringify(mkB));
  if (mkB.ok) {
    ok(P('前置:名字含 <q> 通過 validateName 且原樣保留(不是自己被 escape 前就被擋掉)'), mkB.label === nameB, mkB.label);
    // 發車後 ownTrainDepart 內部已經自動跟上,不用 followOwnTrain 的假撥鐘再蓋一次;
    // 只在萬一沒跟上時才用真的點擊補回來。
    if (!(await page.evaluate(() => !!(state.followTrain && isMyTrain(state.followTrain))))) await pressViewOnCard(page);
    await page.waitForTimeout(500);
    const escTest = await page.evaluate((name) => {
      const panel = document.querySelector('[data-mt-panel]');
      if (!panel) return { panelExists: false };
      const hasLiteralText = panel.textContent.includes(name);
      // 未閉合標籤沒有「內文」概念,直接看有沒有真的生出 <q> 元素(安全路徑用 textContent 塞
      // 名字,瀏覽器不會把它解析成元素;不安全路徑用 innerHTML 才會生出真的 <q>)。
      const hasInjectedElement = !!panel.querySelector('q');
      return { panelExists: true, hasLiteralText, hasInjectedElement };
    }, nameB);
    if (!escTest.panelExists) {
      ok(P('[跳脫] 名字含 <q> 在自製車面板上照字面顯示(textContent),沒有被解析成 <q> 元素'),
        false, '[data-mt-panel] 不存在');
    } else {
      ok(P('[跳脫] 名字含 <q> 在自製車面板上照字面顯示(textContent),沒有被解析成 <q> 元素'),
        escTest.hasLiteralText && !escTest.hasInjectedElement, JSON.stringify(escTest));
    }
    const delB = await deleteOwnTrain(page);
    ok(P('刪除 Scenario B 的車確實走介面(不是退回 API 的 uiFallback)'), delB.uiFallback !== true, JSON.stringify(delB));
  }

  // ══════════════════════ Scenario C:取代確認、編輯══════════
  const mkC1 = await makeOwnTrain(page, { name: '替代測試1', depOffset: 90 });
  ok(P('前置:Scenario C 第一班(替代測試1)建立成功'), mkC1.ok, JSON.stringify(mkC1));
  if (mkC1.ok) {
    // 取代確認・dismiss:全域對話框處理預設會 dismiss 非「確定要刪除」的 confirm,不必特別蓋;
    // 用 page.__mtDialogs 確認 confirm() 真的跳出過且訊息含原名字,不是巧合什麼都沒發生。
    await openGarage(page);
    await pickModel(page, 'emu800');
    const dlgIdxBefore = page.__mtDialogs.length;
    await press(page, '[data-mt-g="schedule"]');
    await page.waitForTimeout(400);
    const sawDismissDialog = page.__mtDialogs.slice(dlgIdxBefore).some(d => d.type === 'confirm' && d.message.includes('替代測試1'));
    const afterDismiss = await page.evaluate(() => ({
      formOpen: document.getElementById('mtForm')?.open === true,
      name: MyTrainUI.load().train.name,
    }));
    ok(P('[取代確認] dismiss:confirm() 真的跳出且訊息含原名字,表單沒開、原本那班沒變'),
      sawDismissDialog && !afterDismiss.formOpen && afterDismiss.name === '替代測試1', JSON.stringify({ sawDismissDialog, afterDismiss }));

    // 取代確認・accept:蓋一次性 accept,表單應該打開,發車後真的取代成功。
    nextDialog(page, 'accept');
    await press(page, '[data-mt-g="schedule"]');
    const formOpened = await page.waitForFunction(() => document.getElementById('mtForm')?.open === true, null, { timeout: 5000 })
      .then(() => true).catch(() => false);
    ok(P('[取代確認] accept:表單打開'), formOpened, String(formOpened));
    let mkC2 = { ok: false };
    if (formOpened) {
      mkC2 = await fillFormAndDepart(page, { from: '臺北', to: '七堵', depOffset: 90, name: '替代測試2' });
      ok(P('[取代確認] accept 之後真的取代成功(名字換成新排的那班,識別碼跟舊的不同)'),
        mkC2.ok && mkC2.label === '替代測試2' && mkC2.id !== mkC1.id, JSON.stringify({ mkC2, oldId: mkC1.id }));
    }

    if (mkC2.ok) {
      // 快轉抵達(不只等一條事件):供下面「只改名字→保留」「改停站方式→清空」兩條正反對照用,
      // 也讓「只改名字」那次編輯確實發生在車不在路上的時刻。
      const arrivedC = await fastForwardToArrival(page, 60000);
      await page.evaluate(() => { state.playing = false; });
      ok(P('前置:Scenario C 快轉抵達,供編輯保留/清空對照、且確保「只改名字」edit 在車不在路上時做'), arrivedC, String(arrivedC));
      const itemsBefore = await page.evaluate(() => state.ownTrainLog.items.map(x => ({ kind: x.kind, key: x.key, rel: x.rel })));
      const simBeforeRename = await page.evaluate(() => state.simSec);

      // [編輯] 只改名字:面板的編輯鈕開表單,只填名字,發車 → 面板/儲存的名字都變,事件列逐條比對原樣保留。
      await press(page, '[data-mt-action="edit"]');
      const editOpened = await page.waitForFunction(() => document.getElementById('mtForm')?.open === true, null, { timeout: 5000 })
        .then(() => true).catch(() => false);
      let renameOk = { ok: false };
      if (editOpened) renameOk = await fillFormAndDepart(page, { name: 'C2改名' });
      await page.waitForTimeout(300);
      const afterRename = await page.evaluate(() => ({
        panelName: document.querySelector('[data-mt-name]')?.textContent || '',
        storedName: MyTrainUI.load().train.name,
        items: state.ownTrainLog.items.map(x => ({ kind: x.kind, key: x.key, rel: x.rel })),
        simSec: state.simSec,
        sameObj: state.followTrain === state.myTrains[0],
      }));
      ok(P('[編輯] 只改名字:表單開得起來、面板與儲存的名字都變了'),
        editOpened && renameOk.ok && afterRename.panelName === 'C2改名' && afterRename.storedName === 'C2改名',
        JSON.stringify(afterRename));
      ok(P('[編輯] 只改名字:事件列原樣保留(逐條比對,不是兩邊剛好都空的巧合)'),
        itemsBefore.length > 0 && JSON.stringify(afterRename.items) === JSON.stringify(itemsBefore),
        `before=${JSON.stringify(itemsBefore)} after=${JSON.stringify(afterRename.items)}`);
      ok(P('只改名字:state.simSec 沒有跳動(容差 ≤2 秒),跟的物件仍是 state.myTrains[0]'),
        Math.abs(afterRename.simSec - simBeforeRename) <= 2 && afterRename.sameObj,
        `before=${simBeforeRename} after=${afterRename.simSec} diff=${afterRename.simSec - simBeforeRename} sameObj=${afterRename.sameObj}`);

      // [編輯] 正向對照,跟上面相反:改停站方式(all→express)→ 事件列被清空。
      await press(page, '[data-mt-action="edit"]');
      const editOpened2 = await page.waitForFunction(() => document.getElementById('mtForm')?.open === true, null, { timeout: 5000 })
        .then(() => true).catch(() => false);
      let patternOk = { ok: false };
      if (editOpened2) patternOk = await fillFormAndDepart(page, { pattern: 'express' });
      await page.waitForTimeout(300);
      const afterPatternEdit = await page.evaluate(() => ({
        items: (state.ownTrainLog?.items || []).length, pattern: MyTrainUI.load().train.pattern,
        sameObj: state.followTrain === state.myTrains[0],
      }));
      ok(P('[編輯] 改停站方式(正向對照,跟上面「只改名字」相反):事件列被清空'),
        editOpened2 && patternOk.ok && afterPatternEdit.pattern === 'express' && afterPatternEdit.items === 0, JSON.stringify(afterPatternEdit));
      ok(P('改停站方式:跟到的是新物件(state.followTrain === state.myTrains[0])'),
        afterPatternEdit.sameObj, JSON.stringify(afterPatternEdit));

      // ── 表單取消與關閉:取代確認→改內容→取消(按鈕、Esc 各一次),原本那班不能被換掉 ──
      const beforeCancelSnap = await page.evaluate(() => ({ stored: MyTrainUI.load().train, rec: state.myTrains[0] ? state.myTrains[0].train : null }));
      await openGarage(page);
      await pickModel(page, 'emu800');
      nextDialog(page, 'accept');
      await press(page, '[data-mt-g="schedule"]');
      await page.waitForFunction(() => document.getElementById('mtForm')?.open === true, null, { timeout: 5000 });
      await sugPick(page, 'from', '臺北');
      await sugPick(page, 'to', '七堵');
      await page.locator('[data-mt-f="name"]').fill('P0不該存');
      await press(page, '.mt-f-foot [data-mt-f="cancel"]');
      await page.waitForTimeout(300);
      const afterBtnCancel = await page.evaluate(() => ({
        stored: MyTrainUI.load().train, rec: state.myTrains[0] ? state.myTrains[0].train : null,
        formOpen: document.getElementById('mtForm').open,
      }));
      ok(P('取代確認接受後改內容、按「取消」鈕:表單關閉、原本那班的儲存與 state.myTrains[0].train 都沒變'),
        !afterBtnCancel.formOpen && JSON.stringify(afterBtnCancel.stored) === JSON.stringify(beforeCancelSnap.stored)
          && JSON.stringify(afterBtnCancel.rec) === JSON.stringify(beforeCancelSnap.rec),
        JSON.stringify({ before: beforeCancelSnap, after: afterBtnCancel }));
      await closeGarage(page);

      await openGarage(page);
      await pickModel(page, 'emu800');
      nextDialog(page, 'accept');
      await press(page, '[data-mt-g="schedule"]');
      await page.waitForFunction(() => document.getElementById('mtForm')?.open === true, null, { timeout: 5000 });
      await sugPick(page, 'from', '臺北');
      await sugPick(page, 'to', '七堵');
      await page.locator('[data-mt-f="name"]').fill('P0Esc');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      const afterEsc = await page.evaluate(() => ({
        stored: MyTrainUI.load().train, rec: state.myTrains[0] ? state.myTrains[0].train : null,
        formOpen: document.getElementById('mtForm').open,
      }));
      ok(P('取代確認接受後改內容、按 Esc:表單關閉、原本那班的儲存與 state.myTrains[0].train 都沒變'),
        !afterEsc.formOpen && JSON.stringify(afterEsc.stored) === JSON.stringify(beforeCancelSnap.stored)
          && JSON.stringify(afterEsc.rec) === JSON.stringify(beforeCancelSnap.rec),
        JSON.stringify({ before: beforeCancelSnap, after: afterEsc }));
      await closeGarage(page);

      // (a) CSS 層:關閉後 computed display:none,對發車鈕 focus() 也拿不到焦點。
      const cssClosed = await page.evaluate(() => {
        const f = document.getElementById('mtForm'), btn = f.querySelector('[data-mt-f="depart"]');
        btn.focus();
        return { display: getComputedStyle(f).display, focusLanded: document.activeElement === btn, open: f.open };
      });
      ok(P('關閉後 #mtForm 的 computed display 是 none,對發車鈕 focus() 拿不到焦點'),
        cssClosed.display === 'none' && !cssClosed.focusLanded && !cssClosed.open, JSON.stringify(cssClosed));

      // (b) formSubmit 的 open 檢查:關閉狀態下程式化 .click() 發車鈕,儲存不變。
      const beforeClick = await page.evaluate(() => ({ stored: MyTrainUI.load().train, rec: state.myTrains[0] ? state.myTrains[0].train : null }));
      await page.evaluate(() => document.querySelector('[data-mt-f="depart"]').click());
      await page.waitForTimeout(300);
      const afterClick = await page.evaluate(() => ({ stored: MyTrainUI.load().train, rec: state.myTrains[0] ? state.myTrains[0].train : null }));
      ok(P('關閉狀態下對發車鈕程式化 .click(),儲存與 state.myTrains[0].train 都沒變'),
        JSON.stringify(beforeClick) === JSON.stringify(afterClick), JSON.stringify({ beforeClick, afterClick }));

      // (c) 鍵盤路徑:焦點落在發車鈕(直接 focus 或 Tab 走)之後按 Enter,儲存不變。
      const kb = await keyboardCannotSubmitClosedForm(page);
      ok(P('鍵盤路徑(focus 或 Tab 走到發車鈕之後按 Enter),儲存與 state.myTrains[0].train 都沒變'),
        kb.unchanged, JSON.stringify(kb));
    }
    const delC = await deleteOwnTrain(page);
    ok(P('刪除 Scenario C 的車確實走介面(不是退回 API 的 uiFallback)'), delC.uiFallback !== true, JSON.stringify(delC));
  }

  // localStorage 白名單/永遠不准變(掃 Scenario A+B+C 整段,不含正向對照——正向對照跟真車,
  // 允許真車既有的介面狀態鍵變動,不在本功能的隔離範圍內)。
  const snapFinal = await lsSnapshot(page);
  const changedKeys = new Set([...Object.keys(snap0), ...Object.keys(snapFinal)].filter(k => snap0[k] !== snapFinal[k]));
  const unexpected = [...changedKeys].filter(k => !LS_WHITELIST.includes(k));
  ok(P('[分流] localStorage 白名單以外沒有鍵變動'), unexpected.length === 0, `changed=${[...changedKeys].join(',')} unexpected=${unexpected.join(',')}`);
  const neverChanged = LS_NEVER.filter(k => snap0[k] !== snapFinal[k]);
  ok(P('[不寫入]「永遠不准變」12 鍵原封不動'), neverChanged.length === 0, `違反=${neverChanged.join(',')}`);

  // ══════════════════════ [正向] 對照:跟一小段台鐵真車 30 秒 ══════════════
  const posControl = await page.evaluate(({ avoidA, avoidB }) => {
    const tr = state.trains.find(t => t.sys === 'tra_sched' && String(t.train) !== avoidA && String(t.train) !== avoidB);
    if (!tr) return { ok: false };
    state.playing = true;
    followTrainNo(String(tr.train), { sys: 'tra_sched' });
    return { ok: true, no: String(tr.train) };
  }, { avoidA: nameA, avoidB: nameB });
  ok(P('[正向] 前置:找得到一班不撞名的真車來跟'), posControl.ok, JSON.stringify(posControl));
  if (posControl.ok) {
    const before = await page.evaluate(() => ({ lp: window.__lpCalls, ls: window.__lsCalls }));
    await page.waitForTimeout(30000); // 跟真車一樣等 30 秒
    const after = await page.evaluate(() => ({ lp: window.__lpCalls, ls: window.__lsCalls, url: location.pathname + location.search }));
    ok(P('[正向] 跟真車 30 秒後,網址出現過 train='), /[?&]train=/.test(after.url), after.url);
    ok(P('[正向] 跟真車 30 秒後,updateFollowPanel 確實被呼叫過'), after.lp > before.lp, `before=${before.lp} after=${after.lp}`);
    ok(P('[正向] 跟真車 30 秒後,laSync 確實被呼叫過'), after.ls > before.ls, `before=${before.ls} after=${after.ls}`);

    // ── 真車直接換自製車(同一頁、不經 clearFollow)────────────────────────
    // 換車前先證明那些東西【確實開著、確實會動】:介紹卡是開的、對真車按☆會改收藏;
    // 誤點履歷那條不真的打開(會打本機沒有的 API、污染零例外),改驗「除了是不是自製車以外,放行條件都成立」。
    // 沒有這組對照,換車後的「沒變」全是恆真。
    const swPre = await page.evaluate(() => {
      const sig = () => (localStorage.getItem('trainmap-favs') || '') + '|' + (localStorage.getItem('trainmap-user-data-v1') || '');
      const tr = state.followTrain, tc = document.getElementById('trainCard');
      const s0 = sig(); document.getElementById('tcStar').click(); const s1 = sig(); document.getElementById('tcStar').click();
      return { real: !!tr && !isMyTrain(tr), cardShown: !!tc && !tc.hidden, favMoves: s1 !== s0 };
    });
    ok(P('[換車] 前置對照:跟著真車時介紹卡開著、按☆確實會改收藏'), swPre.real && swPre.cardShown && swPre.favMoves, JSON.stringify(swPre));
    const nameS = '換車測試';
    const mkS = await makeOwnTrain(page, { name: nameS, depOffset: 60 });
    ok(P('[換車] 前置:自製車建立成功'), mkS.ok, JSON.stringify(mkS));
    if (mkS.ok) {
      const nIdx = await page.evaluate(() => window.__nativeCalls.length);
      const rIdx = requestLog.length;
      const swPost = await page.evaluate(() => {
        const sig = () => (localStorage.getItem('trainmap-favs') || '') + '|' + (localStorage.getItem('trainmap-user-data-v1') || '');
        // 測試頁上 liveActivityAllowed() 為否,真車的即時動態不會真的開卡;這裡在換車的同一拍把旗標設起來,
        // 模擬「鎖定畫面上正掛著真車那張」(不能提早設:中間任何一幀 laSync 都可能先把它收掉)。
        _laKey = 'verify-la';
        ownTrainFollow();
        const tr = state.followTrain, tc = document.getElementById('trainCard'), fp = document.getElementById('followPanel');
        const s0 = sig(); document.getElementById('tcStar').click(); toggleFav(tr); const s1 = sig();
        openDelayHist(tr);
        return { own: !!tr && isMyTrain(tr), cardHidden: !tc || tc.hidden, fpOwn: fp.classList.contains('fp-own') && !fp.hidden,
          favSame: s1 === s0, dhOpened: !document.getElementById('delayHistPanel').hidden,
          dhWouldPass: PLUS_ENABLED && tr.sys === 'tra_sched', laKey: _laKey };
      });
      await page.waitForTimeout(1500);
      const laCallsS = (await page.evaluate(i => window.__nativeCalls.slice(i), nIdx)).filter(c => c.bridge === 'RAIL_NATIVE_LIVEACTIVITY');
      const leakS = scanRequestsForIdentity(requestLog.slice(rIdx), [mkS.id, nameS]);
      ok(P('[換車] 真車直接換自製車:介紹卡收掉、面板換成自製車的'), swPost.own && swPost.cardHidden && swPost.fpOwn, JSON.stringify(swPost));
      ok(P('[換車] 換過去之後按☆(介紹卡的鈕與 toggleFav 本身)不會把自製車寫進收藏'), swPost.favSame, JSON.stringify(swPost));
      ok(P('[換車] 換過去之後誤點履歷打不開(放行條件除了自製車以外都成立),識別碼沒有送出'),
        swPost.dhWouldPass && !swPost.dhOpened && leakS.length === 0, `dhWouldPass=${swPost.dhWouldPass} dhOpened=${swPost.dhOpened} leak=${JSON.stringify(leakS)}`);
      ok(P('[換車] 真車的即時動態跟著收掉(呼叫 end、旗標清空),之後原生沒有其他呼叫'),
        swPost.laKey === '' && laCallsS.some(c => c.member === 'end') && laCallsS.every(c => c.member === 'end'),
        `laKey=${JSON.stringify(swPost.laKey)} calls=${JSON.stringify(laCallsS)}`);
      const delS = await deleteOwnTrain(page);
      ok(P('刪除「換車」情境的車確實走介面(不是退回 API 的 uiFallback)'), delS.uiFallback !== true, JSON.stringify(delS));
    }
    await page.evaluate(() => clearFollow());
  }

  ok(P('F桌面 頁面零例外'), errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();

  // ══════════════════════ 獨立 3D context:[名牌方向] ══════════════════════
  await runNameplateOrientation(browser, engineName, P);

  // ══════════════════════ 獨立 context:[面板快取] ══════════════════════════
  await runPanelCacheCheck(browser, engineName, P);

  // ══════════════════════ 獨立 context:[fpRide] ══════════════════════════
  await runFpRideCheck(browser, engineName, P);

  // ══════════════════════ 獨立 context:[面板譯名] EN/JA ═══════════════════
  await runPanelI18nCheck(browser, engineName, P);

  // ══════════════════════ 獨立 context:[車牌顏色] ══════════════
  await runColorPlateCheck(browser, engineName, P);

  // ══════════════════════ 獨立 context:[順逆行] ══════════════
  await runDirCheck(browser, engineName, P);

  // ══════════════════════ 手機 375×812 真觸控 ══════════════════════════
  const ctx2 = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'zh-TW', hasTouch: true });
  await ctx2.addInitScript(INIT);
  await ctx2.addInitScript(RIDES_INIT, OWN_TRAIN_RIDES);
  const { page: page2, errors: errors2, ready: ready2 } = await bootPage(ctx2, '');
  if (!ready2) {
    ok(P('F手機 boot 就緒'), false, errors2.slice(0, 3).join(' | ') || 'timeout');
    await ctx2.close(); await browser.close(); return;
  }
  await page2.evaluate(() => { state.simSec = 8 * 3600; state.clockAtNow = false; state.playing = false; });
  const mkM = await mobileFormWalkthrough(page2, P);
  ok(P('F手機 前置:自製車建立成功(經上面逐一控件驗證那個表單流程建立)'), mkM.ok, JSON.stringify(mkM));
  if (mkM.ok) {
    // 手機:列車 sheet 開著時直接換自製車,以及點自製車面板的空白處。
    // 對照:跟真車時點面板非按鈕處【確實】會滑上列車 sheet——沒有這條,後面的「沒有 train-open」是恆真。
    const realM = await page2.evaluate(() => {
      const tr = state.trains.find(t => t.sys === 'tra_sched' && !isMyTrain(t));
      if (!tr) return { ok: false };
      state.playing = true;
      followTrainNo(String(tr.train), { sys: 'tra_sched' });
      return { ok: !!state.followTrain && !isMyTrain(state.followTrain), no: String(tr.train) };
    });
    await page2.waitForTimeout(800);
    const tapReal = realM.ok ? await tapCenter(page2, '#fpTrain', true) : { ok: false, reason: 'no-real-train' };
    const sheetReal = await page2.evaluate(() => document.body.classList.contains('train-open'));
    ok(P('F手機 對照:跟真車時點面板(車次)確實會滑上列車 sheet'), tapReal.ok && tapReal.hit && sheetReal, JSON.stringify({ realM, tapReal, sheetReal }));
    const swM = await page2.evaluate(() => {
      ownTrainFollow();
      const fp = document.getElementById('followPanel'), r = fp.getBoundingClientRect();
      return { own: isMyTrain(state.followTrain), trainOpen: document.body.classList.contains('train-open'),
        fpShown: !fp.hidden && getComputedStyle(fp).display !== 'none' && r.height > 0, fpOwn: fp.classList.contains('fp-own') };
    });
    ok(P('F手機 列車 sheet 開著時直接換自製車:sheet 收掉、自製車面板看得到'), sheetReal && swM.own && !swM.trainOpen && swM.fpShown && swM.fpOwn, JSON.stringify(swM));
    await page2.waitForTimeout(500);
    const tapOwn = await tapCenter(page2, '#followPanel [data-mt-name]', true);
    const afterOwnTap = await page2.evaluate(() => {
      const fp = document.getElementById('followPanel'), r = fp.getBoundingClientRect();
      return { trainOpen: document.body.classList.contains('train-open'), fpShown: !fp.hidden && getComputedStyle(fp).display !== 'none' && r.height > 0,
        own: !!state.followTrain && isMyTrain(state.followTrain) };
    });
    ok(P('F手機 點自製車面板空白處(車名)不會滑上真車的列車 sheet,面板還在'),
      sheetReal && tapOwn.ok && tapOwn.hit && !afterOwnTap.trainOpen && afterOwnTap.fpShown && afterOwnTap.own, JSON.stringify({ tapOwn, afterOwnTap }));

    // 已經在跟就不動,不用 followOwnTrain 的假撥鐘再蓋一次。
    if (!(await page2.evaluate(() => !!(state.followTrain && isMyTrain(state.followTrain))))) await pressViewOnCard(page2, 'emu800', true);
    await page2.waitForTimeout(500);
    const shell = await page2.evaluate(() => ({ fs: document.body.classList.contains('fs'), mobile: matchMedia(MOBILE_MQ).matches }));
    ok(P('F手機 手機殼成立(body.fs + MOBILE_MQ)'), shell.fs && shell.mobile, JSON.stringify(shell));

    // ── 已知缺口補回:手機面板「編輯」鈕(真觸控) ──────────────────────
    const editNameBefore = await page2.evaluate(() => document.querySelector('[data-mt-name]')?.textContent || '');
    const editTap = await tapCenter(page2, '[data-mt-action="edit"]', true);
    const editFormOpen = await page2.waitForFunction(() => document.getElementById('mtForm')?.open === true, null, { timeout: 5000 })
      .then(() => true).catch(() => false);
    const editPrefill = editFormOpen ? await page2.evaluate(() => document.querySelector('[data-mt-f="name"]').value) : null;
    ok(P('F手機 面板「編輯」鈕:真觸控命中本體,表單真的打開,名字欄預填值等於目前的名字'),
      editTap.ok && editTap.hit && editFormOpen && editPrefill === editNameBefore,
      JSON.stringify({ editTap, editFormOpen, editPrefill, editNameBefore }));
    if (editFormOpen) {
      const beforeEditCancel = await page2.evaluate(() => ({ stored: MyTrainUI.load().train, rec: state.myTrains[0] ? state.myTrains[0].train : null }));
      const cancelTap = await tapCenter(page2, '.mt-f-foot [data-mt-f="cancel"]', true);
      await page2.waitForTimeout(300);
      const afterEditCancel = await page2.evaluate(() => ({
        formOpen: document.getElementById('mtForm').open,
        stored: MyTrainUI.load().train, rec: state.myTrains[0] ? state.myTrains[0].train : null,
      }));
      ok(P('F手機 編輯表單裡真觸控點「取消」:命中本體,表單關閉,儲存不變'),
        cancelTap.ok && cancelTap.hit && !afterEditCancel.formOpen
          && JSON.stringify(afterEditCancel.stored) === JSON.stringify(beforeEditCancel.stored)
          && JSON.stringify(afterEditCancel.rec) === JSON.stringify(beforeEditCancel.rec),
        JSON.stringify({ cancelTap, beforeEditCancel, afterEditCancel }));
    } else {
      ok(P('F手機 編輯表單裡真觸控點「取消」:命中本體,表單關閉,儲存不變'), false, '編輯表單沒打開,跳過');
    }

    const btnsMobile = await tryPanelButtons(page2, true);
    for (const act of ['halo', 'size', 'delete', 'unfollow']) {
      const j = judgePanelButton(act, btnsMobile[act]);
      ok(P(`[分流] 手機真觸控點自製車面板按鈕「${act}」,確實點到本體且狀態真的變了`), j.pass, j.detail);
    }
    const delM = await deleteOwnTrain(page2);
    ok(P('手機刪除確實走介面(不是退回 API 的 uiFallback)'), delM.uiFallback !== true, JSON.stringify(delM));
  }
  ok(P('F手機 頁面零例外'), errors2.length === 0, errors2.slice(0, 3).join(' | '));
  await ctx2.close();

  await browser.close();
}

const want = (process.env.ENGINES || 'chromium,webkit').split(',').map(s => s.trim()).filter(Boolean);
const ENGINES = { chromium, webkit };
for (const name of want) {
  if (!ENGINES[name]) { ok(`${name} 引擎名稱有效`, false, '只認 chromium / webkit'); continue; }
  console.log(`\n──────── ${name} ────────`);
  await runEngine(name, ENGINES[name]);
}

server.close();
const bad = results.filter(r => !r.pass);
console.log(`\n總計 ${results.length} 項,PASS ${results.length - bad.length} / FAIL ${bad.length}`);
if (bad.length) { console.log('未過:'); bad.forEach(r => console.log('  - ' + r.name + (r.detail ? '  — ' + r.detail : ''))); }
if (NET_NOISE.length) { console.log(`\n外部網路雜訊 ${NET_NOISE.length} 筆(沒算進各 context 的零例外,判準見 externalNetNoise):`); NET_NOISE.slice(0, 8).forEach(s => console.log('  - ' + s.slice(0, 220))); }

try {
  mkdirSync(path.join(ROOT, 'output'), { recursive: true });
  const lines = [];
  lines.push('# 隔離守門腳本 — 進度紀錄(自動產生,不進版控)');
  lines.push('');
  lines.push(`跑於 ${new Date().toISOString()},共 ${results.length} 項,PASS ${results.length - bad.length} / FAIL ${bad.length}。`);
  lines.push('');
  lines.push('## FAIL 清單');
  for (const r of bad) lines.push(`- ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
  lines.push('');
  lines.push('## PASS 清單');
  for (const r of results.filter(r => r.pass)) lines.push(`- ${r.name}`);
  writeFileSync(path.join(ROOT, 'output/task4-progress.md'), lines.join('\n') + '\n');
  console.log('\n進度已寫入 output/task4-progress.md');
} catch (e) { console.error('寫進度檔失敗:', e); }

process.exit(bad.length ? 1 : 0);
