#!/usr/bin/env node
// 自製列車走查守門人。
//
// 這支和 verify_my_train_isolation.mjs 分工：隔離守門人覆蓋完整產品邊界，這裡集中驗收
// 使用者實際會碰的四件事，以及 exact-24h、四寬真觸控、跨午夜與藍皮雙向。
// 所有 UI 操作都在 isMobile:true + hasTouch:true context 內用 page.tap()，瀏覽器一律 headless。

import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.geojson': 'application/json',
};
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://rail-island.local');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/thsr-schedule') return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
    return res.end('{}');
  }
  let file = path.resolve(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (path.relative(ROOT, file).startsWith('..')) { res.statusCode = 404; return res.end('nf'); }
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!existsSync(file)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(Number(process.env.PORT || 0), '127.0.0.1', resolve);
});
const BASE = `http://127.0.0.1:${server.address().port}/`;

// 班表每週更新，停站秒數由磁碟原始樣本獨立重算，不能沿用舊資料窗的 750 秒。
const dwellRows = JSON.parse(readFileSync(path.join(ROOT, 'data/tra_schedule_dense.json'), 'utf8')).trains
  .filter(tr => !tr.loop && !tr.est)
  .flatMap(tr => tr.stops.slice(1, -1).filter(st => st.stop !== false && st.depSec >= st.arrSec)
    .map(st => ({ sec: st.depSec - st.arrSec, local: /普通|普快/.test(tr.carName || '') })));
const rawMedian = rows => { const values = rows.map(r => r.sec).sort((a, b) => a - b); if (!values.length) throw new Error('停站樣本為空'); const m = Math.floor(values.length / 2); return Math.round(values.length % 2 ? values[m] : (values[m - 1] + values[m]) / 2); };
const BLUE_DWELL = { on: rawMedian(dwellRows.filter(r => r.local)), off: rawMedian(dwellRows) };
if (BLUE_DWELL.on === BLUE_DWELL.off) throw new Error('普快與全系統停站中位數必須不同，才能驗出線內外分流');

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// 四趟同時解鎖 emu800（趟數 4）與藍皮（累積 1,200 公里）。這是測試前置資料，走跟產品相同的
// legacy rides 讀取／遷移路徑；自製車流程本身不得覆寫這把 key。
const RIDES = [
  { train: 'W001', date: '2026-01-01', sys: 'tra_sched', from: '臺北', to: '臺東', km: 310 },
  { train: 'W002', date: '2026-01-02', sys: 'tra_sched', from: '臺北', to: '臺東', km: 310 },
  { train: 'W003', date: '2026-01-03', sys: 'tra_sched', from: '臺北', to: '臺東', km: 310 },
  { train: 'W004', date: '2026-01-04', sys: 'tra_sched', from: '臺北', to: '臺東', km: 310 },
];
const INIT = rides => {
  // 每次載入（含 reload）都使用持證測試資格，存檔讀回仍由產品流程負責。
  document.addEventListener('DOMContentLoaded', () => { plusState().active = true; if (state.ready) ownTrainRebuild(); }, { once: true });
  localStorage.setItem('trainmap-howto-seen', '1');
  localStorage.setItem('trainmap-language', 'zh-TW');
  localStorage.setItem('trainmap-powersave', '0');
  localStorage.setItem('trainmap-rides', JSON.stringify(rides));
};

async function contextFor(browser, width) {
  const context = await browser.newContext({
    viewport: { width, height: 900 }, locale: 'zh-TW', isMobile: true, hasTouch: true,
  });
  await context.addInitScript(INIT, RIDES);
  return context;
}

async function boot(context, query = '?g=nat') {
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(BASE + query, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    try {
      return state.ready && state.trains.length > 0 && window.MyTrainPlan && window.MyTrainUI
        && window.TrainGarage && window.RailGarageCatalog;
    } catch { return false; }
  }, null, { timeout: 60000 });
  await page.evaluate(() => { state.simSec = 8 * 3600; state.clockAtNow = false; state.playing = false; });
  await page.evaluate(() => { plusState().active = true; ownTrainRebuild(); });
  return { page, pageErrors };
}

async function tapLocator(page, locator, label) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box || box.width < 1 || box.height < 1) throw new Error(`${label}: 元素沒有可點位置`);
  const hit = await locator.evaluate((el, point) => {
    const at = document.elementFromPoint(point.x, point.y);
    return { ok: !!at && (at === el || el.contains(at)), disabled: !!el.disabled,
      at: at ? (at.id ? `#${at.id}` : at.tagName.toLowerCase() + '.' + [...at.classList].join('.')) : 'null' };
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  if (!hit.ok || hit.disabled) throw new Error(`${label}: elementFromPoint=${hit.at}, disabled=${hit.disabled}`);
  const probe = `mt-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await locator.evaluate((el, value) => el.setAttribute('data-mt-probe-tap', value), probe);
  await page.tap(`[data-mt-probe-tap="${probe}"]`, { position: { x: box.width / 2, y: box.height / 2 } });
  await locator.evaluate(el => el.removeAttribute('data-mt-probe-tap')).catch(() => {});
  return { ...hit, width: box.width, height: box.height };
}

async function tap(page, selector, label = selector) {
  return tapLocator(page, page.locator(selector).first(), label);
}

async function openGarage(page) {
  if (await page.evaluate(() => !!TrainGarage.isOpen)) return;
  const entry = await page.evaluate(() => {
    const tab = document.getElementById('tabMore');
    return tab && tab.getClientRects().length && getComputedStyle(tab).visibility !== 'hidden' ? '#tabMore' : '#toolsFab';
  });
  await tap(page, entry, '更多入口');
  await page.locator('#moreSheet [data-act="garage"]').waitFor({ state: 'visible', timeout: 5000 });
  await tap(page, '#moreSheet [data-act="garage"]', '車庫入口');
  await page.waitForFunction(() => !!TrainGarage.isOpen, null, { timeout: 10000 });
}

async function pickModel(page, modelId) {
  await tap(page, '#trainGarage [data-filter="all"]', '全部車款');
  const car = page.locator(`#trainGarage .g-car[data-model="${modelId}"]`);
  await car.waitFor({ state: 'attached', timeout: 5000 });
  await tapLocator(page, car, `車款 ${modelId}`);
  await page.waitForFunction(id => document.querySelector(`#trainGarage .g-car[data-model="${id}"]`)?.getAttribute('aria-pressed') === 'true',
    modelId, { timeout: 5000 });
}

// 排好車留在機務段;這支接著驗跟車,接到車庫「去看它」同一條路。機務段本身的流程在 verify_my_train_depot.mjs。
async function leaveDepot(page) {
  await page.waitForFunction(() => !document.getElementById('mtForm')?.open, null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => {
    if (document.getElementById('mtForm')?.open || !window.MyTrainDepot?.isOpen) return;
    MyTrainDepot.close();
    ownTrainFollow({ id: MyTrainUI.load().trains.at(-1).id });
  });
}

async function openFormFromGarage(page, modelId) {
  await openGarage(page);
  await pickModel(page, modelId);
  const status = await page.evaluate(() => {
    const button = document.querySelector('#trainGarage [data-mt-g="schedule"]');
    return { visible: !!button && !button.closest('[hidden]') && button.getClientRects().length > 0,
      disabled: !!button?.disabled, text: button?.textContent || '' };
  });
  if (!status.visible || status.disabled) throw new Error(`${modelId} 沒有可用排班鈕: ${JSON.stringify(status)}`);
  await tap(page, '#trainGarage [data-mt-g="schedule"]', `${modelId} 自己排一班`);
  await page.waitForFunction(() => document.getElementById('mtForm')?.open, null, { timeout: 5000 });
}

async function pickStation(page, which, name) {
  const input = page.locator(`[data-mt-f="${which}"]`);
  await tapLocator(page, input, `${which} 輸入框`);
  await input.fill(name);
  const rows = page.locator(`[data-mt-sug="${which}"] [data-mt-sug-key]`);
  await rows.first().waitFor({ state: 'visible', timeout: 5000 });
  const exact = rows.filter({ hasText: new RegExp(`^${name}$`) }).first();
  const suggestion = await tapLocator(page, exact, `${which} 建議 ${name}`);
  const value = await input.inputValue();
  if (value !== name) throw new Error(`${which} 選站後是 ${value}，不是 ${name}`);
  const inputBox = await input.boundingBox();
  return { suggestion, input: inputBox ? { width: inputBox.width, height: inputBox.height } : null };
}

async function visibleControlHits(page) {
  const selectors = [
    '[data-mt-lbl="deptime"]', '[data-mt-fdir]', '[data-mt-fpattern]', '[data-mt-f="hh"]',
    '[data-mt-f="mm"]', '[data-mt-f="name"]', '.mt-f-foot [data-mt-f="cancel"]', '[data-mt-f="depart"]',
  ];
  const bad = [], badTouch = [], seen = [];
  for (const selector of selectors) {
    const list = page.locator(`#mtForm ${selector}`);
    for (let i = 0; i < await list.count(); i++) {
      const loc = list.nth(i);
      if (!(await loc.isVisible())) continue;
      await loc.scrollIntoViewIfNeeded();
      const r = await loc.evaluate(el => {
        const b = el.getBoundingClientRect(), at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return { ok: !!at && (at === el || el.contains(at)), w: b.width, h: b.height,
          at: at ? (at.id || at.getAttribute('data-mt-f') || at.getAttribute('data-v') || at.tagName) : 'null' };
      });
      const key = `${selector}[${i}]`;
      seen.push({ key, ...r });
      if (!r.ok || r.w < 1 || r.h < 1) bad.push({ key, ...r });
      if (await loc.evaluate(el => el.matches('button,input,select,textarea')) && (r.w < 43.5 || r.h < 43.5)) badTouch.push({ key, ...r });
    }
  }
  return { seen, bad, badTouch };
}

// 全站狀態矩陣：不是只看這次新增的鈕。把當下所有可互動元素納入同一份 rect 掃描，
// 驗中心命中、完整留在 viewport、兩兩不相交與頁面零水平捲動。祖孫控制（例如 role=button
// 容器裡的真 button）不互相比，因為那是同一個互動目標的 DOM 包裝，不是兩顆控件撞在一起。
async function controlAudit(page, scope = 'body') {
  return page.evaluate(scope => {
    const root = document.querySelector(scope);
    if (!root) return { missing: scope, count: 0, badHit: [], out: [], overlaps: [], smallCustom: [], overflow: 0, fs: false };
    const selector = 'button:not([disabled]),a[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[role="button"]:not([aria-disabled="true"]),[tabindex="0"],[contenteditable="true"]';
    const describe = el => el.id ? `#${el.id}`
      : el.getAttribute('data-mt-action') ? `[data-mt-action="${el.getAttribute('data-mt-action')}"]`
      : el.getAttribute('data-act') ? `[data-act="${el.getAttribute('data-act')}"]`
      : el.matches('a[href]') ? `a[href="${el.getAttribute('href')}"]:${el.textContent.trim().slice(0, 18)}`
      : `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`;
    // raw DOMRect 可能伸進 scrollport 的裁切區（MapLibre attribution、護照章牆都是實例）。
    // pairwise／viewport 要比使用者實際看得到、點得到的 effective rect；捲動容器內逐顆可達性
    // 另由 scrollableControlsReachable 驗，不能把被正當裁掉的 raw 尾端算成全站互疊。
    const clippedRect = (source, el) => {
      const out = { left: source.left, top: source.top, right: source.right, bottom: source.bottom };
      for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
        const s = getComputedStyle(n), nr = n.getBoundingClientRect();
        const clipLeft = nr.left + n.clientLeft, clipTop = nr.top + n.clientTop;
        const clipRight = clipLeft + n.clientWidth, clipBottom = clipTop + n.clientHeight;
        if (/^(auto|scroll|hidden|clip)$/.test(s.overflowX)) {
          out.left = Math.max(out.left, clipLeft); out.right = Math.min(out.right, clipRight);
        }
        if (/^(auto|scroll|hidden|clip)$/.test(s.overflowY)) {
          out.top = Math.max(out.top, clipTop); out.bottom = Math.min(out.bottom, clipBottom);
        }
      }
      out.width = Math.max(0, out.right - out.left); out.height = Math.max(0, out.bottom - out.top);
      return out;
    };
    const shown = el => {
      if (el.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
      const r = el.getBoundingClientRect();
      if (el.tagName === 'CANVAS') return false; // 地圖畫布是互動底面，不是控件；它本來就鋪在所有 HUD 下方。
      if (r.width < 3 || r.height < 3 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) <= .05) return false;
        if (n !== el && n !== document.body && n !== document.documentElement) {
          const nr = n.getBoundingClientRect();
          if (/^(auto|scroll|hidden|clip)$/.test(s.overflowX) && (cx < nr.left || cx > nr.right)) return false;
          if (/^(auto|scroll|hidden|clip)$/.test(s.overflowY) && (cy < nr.top || cy > nr.bottom)) return false;
        }
      }
      return getComputedStyle(el).pointerEvents !== 'none';
    };
    const elements = [...new Set(root.querySelectorAll(selector))].filter(shown);
    const items = elements.map(el => {
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const at = x >= 0 && x < innerWidth && y >= 0 && y < innerHeight ? document.elementFromPoint(x, y) : null;
      const pseudo = el.id === 'fpClose' && el.closest('#followPanel.fp-own') ? getComputedStyle(el, '::after') : null;
      const pseudoWidth = pseudo ? parseFloat(pseudo.width) : r.width;
      const pseudoHeight = pseudo ? parseFloat(pseudo.height) : r.height;
      const rawPairR = pseudo ? (() => {
        const right = r.right - parseFloat(pseudo.right), top = r.top + parseFloat(pseudo.top);
        return { left: right - pseudoWidth, top, right, bottom: top + pseudoHeight };
      })() : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      const visibleR = clippedRect(r, el), pairR = clippedRect(rawPairR, el);
      const touchWidth = pairR.width, touchHeight = pairR.height;
      return { el, name: describe(el), r: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
        visibleR, pairR,
        hit: !!at && (at === el || el.contains(at)), at: at ? describe(at) : 'null',
        inViewport: visibleR.width >= 1 && visibleR.height >= 1 && visibleR.left >= -1 && visibleR.right <= innerWidth + 1
          && visibleR.top >= -1 && visibleR.bottom <= innerHeight + 1,
        touchWidth, touchHeight,
        custom: (!!el.closest('[data-mt-panel]') && el.matches('button,a,input,select,textarea'))
          || (!!el.closest('#followPanel.fp-own') && (el.id === 'fpClose' || el.id === 'fpEnd')) };
    });
    const overlaps = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.pairR.right, b.pairR.right) - Math.max(a.pairR.left, b.pairR.left);
      const h = Math.min(a.pairR.bottom, b.pairR.bottom) - Math.max(a.pairR.top, b.pairR.top);
      if (w > .5 && h > .5) overlaps.push(`${a.name}×${b.name}:${w.toFixed(1)}×${h.toFixed(1)}`);
    }
    return {
      count: items.length,
      badHit: items.filter(x => !x.hit).map(x => `${x.name}→${x.at}`),
      out: items.filter(x => !x.inViewport).map(x => `${x.name}:raw=${x.r.left.toFixed(1)},${x.r.top.toFixed(1)},${x.r.right.toFixed(1)},${x.r.bottom.toFixed(1)};effective=${x.visibleR.left.toFixed(1)},${x.visibleR.top.toFixed(1)},${x.visibleR.right.toFixed(1)},${x.visibleR.bottom.toFixed(1)}`),
      overlaps,
      smallCustom: items.filter(x => x.custom && (x.touchWidth < 43.5 || x.touchHeight < 43.5))
        .map(x => `${x.name}:${x.touchWidth.toFixed(1)}×${x.touchHeight.toFixed(1)}`),
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
      fs: document.body.classList.contains('fs'),
      missing: null,
    };
  }, scope);
}

// 「更多」是有 scrim 的 modal layer：前景控件要自己命中；scrim 後方仍有 layout rect 的
// 背景控件則恰好相反，中心不得穿透回自己，而且必須確實由 scrim／前景 sheet 擋住。
// 這和把背景元素從 audit 靜默排除不同：如果 scrim z-index 壞掉，leaks 會立刻轉紅。
async function scrimOcclusionAudit(page, foregroundScope, scrimScope) {
  return page.evaluate(({ foregroundScope, scrimScope }) => {
    const foreground = document.querySelector(foregroundScope), scrim = document.querySelector(scrimScope);
    if (!foreground || !scrim) return { missing: true, count: 0, leaks: [], wrongLayer: [] };
    const selector = 'button:not([disabled]),a[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[role="button"]:not([aria-disabled="true"]),[tabindex="0"],[contenteditable="true"]';
    const describe = el => el.id ? `#${el.id}`
      : el.getAttribute('data-mt-action') ? `[data-mt-action="${el.getAttribute('data-mt-action')}"]`
      : el.getAttribute('data-act') ? `[data-act="${el.getAttribute('data-act')}"]`
      : `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`;
    const visibleByLayout = el => {
      if (el.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 3 || r.height < 3) return false;
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) return false;
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) <= .05) return false;
      }
      return true;
    };
    const items = [...document.querySelectorAll(selector)]
      .filter(el => !foreground.contains(el) && el !== scrim && !scrim.contains(el) && visibleByLayout(el))
      .map(el => {
        const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        const at = document.elementFromPoint(x, y);
        return { name: describe(el), self: !!at && (at === el || el.contains(at)),
          covered: !!at && (at === scrim || scrim.contains(at) || at === foreground || foreground.contains(at)),
          at: at ? describe(at) : 'null' };
      });
    return { missing: false, count: items.length,
      leaks: items.filter(x => x.self).map(x => `${x.name}→${x.at}`),
      wrongLayer: items.filter(x => !x.covered).map(x => `${x.name}→${x.at}`) };
  }, { foregroundScope, scrimScope });
}

async function scrollableControlsReachable(page, scope) {
  const root = page.locator(scope);
  if (!await root.count()) return { missing: true, count: 0, bad: [] };
  const controls = root.locator('button:not([disabled]),a[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[role="button"]:not([aria-disabled="true"]),[tabindex="0"]');
  const bad = [];
  let count = 0;
  for (let i = 0; i < await controls.count(); i++) {
    const control = controls.nth(i);
    // WebKit 會把 closed <details> 深處的巢狀 summary 回報為 visible；只有該 closed
    // details 自己的直屬 summary 才真的可見、可捲入。逐層檢查，避免把外層收合內容當紅燈。
    const hiddenByClosedDetails = await control.evaluate(el => {
      for (let details = el.parentElement?.closest('details:not([open])'); details;
        details = details.parentElement?.closest('details:not([open])')) {
        if (details.querySelector(':scope > summary') !== el) return true;
      }
      return false;
    });
    if (hiddenByClosedDetails) continue;
    if (!await control.isVisible()) continue;
    count++;
    await control.scrollIntoViewIfNeeded();
    const hit = await control.evaluate(el => {
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const at = x >= 0 && x < innerWidth && y >= 0 && y < innerHeight ? document.elementFromPoint(x, y) : null;
      return { ok: r.width >= 3 && r.height >= 3 && !!at && (at === el || el.contains(at)),
        name: el.id || el.textContent.trim().slice(0, 24), at: at ? (at.id || at.tagName) : 'null' };
    });
    if (!hit.ok) bad.push(`${hit.name}→${hit.at}`);
  }
  return { missing: false, count, bad };
}

function auditPass(audit, { customTargets = true, allowOut = false } = {}) {
  return !audit.missing && audit.count > 0 && audit.badHit.length === 0 && (allowOut || audit.out.length === 0) && audit.overlaps.length === 0
    && audit.overflow <= 1 && (!customTargets || audit.smallCustom.length === 0);
}

async function forceUiDuration(page, duration) {
  return page.evaluate(seconds => {
    if (!window.__mtTimetableOrig) {
      window.__mtTimetableOrig = MyTrainPlan.buildTimetable;
      MyTrainPlan.buildTimetable = (...args) => {
        const timetable = window.__mtTimetableOrig(...args);
        return { ...timetable, totalSec: window.__mtForcedDuration };
      };
    }
    window.__mtForcedDuration = seconds;
    const input = document.querySelector('[data-mt-f="name"]');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const depart = document.querySelector('[data-mt-f="depart"]');
    return { seconds, disabled: depart.disabled,
      reason: document.querySelector('[data-mt-f="reason"]')?.textContent || '',
      preview: document.querySelector('[data-mt-f="preview"]')?.textContent || '' };
  }, duration);
}

async function restoreUiDuration(page) {
  return page.evaluate(() => {
    if (window.__mtTimetableOrig) MyTrainPlan.buildTimetable = window.__mtTimetableOrig;
    delete window.__mtTimetableOrig;
    delete window.__mtForcedDuration;
    const input = document.querySelector('[data-mt-f="name"]');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return !document.querySelector('[data-mt-f="depart"]')?.disabled;
  });
}

async function followStateMatrix(page, engineName, width) {
  await tap(page, '[data-mt-f="depart"]', '發車');
  await leaveDepot(page);
  await page.waitForFunction(() => state.myTrains.length === 1 && state.followTrain && isMyTrain(state.followTrain)
    && !document.getElementById('mtForm').open, null, { timeout: 10000 });

  const panel = await page.evaluate(() => {
    const fp = document.getElementById('followPanel'), close = document.getElementById('fpClose');
    const pseudo = getComputedStyle(close, '::after');
    const r = close.getBoundingClientRect(), width = parseFloat(pseudo.width), height = parseFloat(pseudo.height);
    const right = r.right - parseFloat(pseudo.right), top = r.top + parseFloat(pseudo.top), left = right - width;
    const misses = [];
    for (const fx of [.15, .5, .85]) for (const fy of [.15, .5, .85]) {
      const at = document.elementFromPoint(left + width * fx, top + height * fy);
      if (!(at === close || close.contains(at))) misses.push(`${fx}/${fy}:${at ? (at.id || at.tagName) : 'null'}`);
    }
    const stops = document.querySelector('[data-mt-stops]'), events = document.querySelector('[data-mt-events]');
    return { own: fp.classList.contains('fp-own'), named: fp.classList.contains('fp-named'), fs: document.body.classList.contains('fs'),
      closeTarget: [width, height], closeMisses: misses,
      end: (() => { const q = document.getElementById('fpEnd').getBoundingClientRect(); return [q.width, q.height]; })(),
      actions: [...document.querySelectorAll('[data-mt-panel] button')].map(el => {
        const q = el.getBoundingClientRect(); return [el.dataset.mtAction, q.width, q.height];
      }),
      stops: [stops.tabIndex, stops.getAttribute('role'), stops.getAttribute('aria-label')],
      events: [events.tabIndex, events.getAttribute('role'), events.getAttribute('aria-label')],
    };
  });
  check(`${engineName} ${width}px 自製面板 a11y／44px 熱區／具名 class 清乾淨`, panel.own && !panel.named && panel.fs
    && panel.closeTarget[0] >= 43.5 && panel.closeTarget[1] >= 43.5 && panel.closeMisses.length === 0
    && panel.end[0] >= 43.5 && panel.end[1] >= 43.5
    && panel.actions.length >= 4 && panel.actions.every(x => x[1] >= 43.5 && x[2] >= 43.5)
    && panel.stops[0] === 0 && panel.stops[1] === 'region' && panel.stops[2] === '逐站時刻'
    && panel.events[0] === 0 && panel.events[1] === 'region' && panel.events[2] === '事件紀錄', JSON.stringify(panel));

  // Chromium 真正用 Tab 走到「編輯」。macOS WebKit 預設「只以 Tab 聚焦文字欄位」會略過
  // native button，屬瀏覽器/OS policy；該引擎改釘 DOM tab order，再直接聚焦編輯。兩者都要
  // 觸發兩次每拍更新，證明 expanded 同態更新不會把焦點搶回 ×。
  let keyboardProof;
  if (engineName === 'webkit') {
    const order = await page.evaluate(() => [...document.querySelectorAll('#followPanel button,#followPanel a[href],#followPanel input,#followPanel select,#followPanel textarea,#followPanel [tabindex]')]
      .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length > 0)
      .map(el => ({ id: el.id || '', action: el.getAttribute('data-mt-action') || '', tabIndex: el.tabIndex })));
    const closeIndex = order.findIndex(x => x.id === 'fpClose');
    const editIndex = order.findIndex(x => x.action === 'edit');
    await page.locator('[data-mt-action="edit"]').focus();
    keyboardProof = { mode: 'dom-order+direct-focus', order, reachable: closeIndex >= 0 && editIndex > closeIndex
      && order[editIndex].tabIndex === 0 };
  } else {
    await page.locator('#fpClose').focus();
    const tabPath = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const active = await page.evaluate(() => ({ id: document.activeElement?.id || '',
        action: document.activeElement?.getAttribute('data-mt-action') || '',
        text: document.activeElement?.textContent?.trim().slice(0, 24) || '' }));
      tabPath.push(active);
      if (active.action === 'edit') break;
    }
    keyboardProof = { mode: 'real-tab', tabPath, reachable: tabPath.some(x => x.action === 'edit') };
  }
  await page.evaluate(() => { ownTrainPanelUpdate(state.followTrain); ownTrainPanelUpdate(state.followTrain); });
  await page.waitForTimeout(80);
  const focusStable = await page.evaluate(() => document.activeElement?.getAttribute('data-mt-action') === 'edit');
  check(`${engineName} ${width}px 鍵盤順序可到編輯且同態 panel update 不搶焦點`, keyboardProof.reachable && focusStable,
    JSON.stringify({ keyboardProof, focusStable }));

  // 用鍵盤啟動共用 ×，收合後焦點要在膠囊；膠囊 Enter 展開並把焦點交回 ×。
  await page.locator('#fpClose').focus();
  await page.keyboard.press('Enter');
  const compact = await page.evaluate(() => {
    const fp = document.getElementById('followPanel'), r = fp.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { min: fp.classList.contains('fp-min'), tabIndex: fp.tabIndex, label: fp.getAttribute('aria-label'),
      focus: document.activeElement === fp, hit: at === fp || fp.contains(at) };
  });
  await page.keyboard.press('Enter');
  const expanded = await page.evaluate(() => {
    const fp = document.getElementById('followPanel');
    return { min: fp.classList.contains('fp-min'), marked: fp.hasAttribute('data-mt-compact-a11y'),
      tabIndex: fp.getAttribute('tabindex'), focusClose: document.activeElement === document.getElementById('fpClose') };
  });
  check(`${engineName} ${width}px 鍵盤收合膠囊可命中、Enter 可展開與交回焦點`, compact.min && compact.tabIndex === 0
    && compact.label === '展開' && compact.focus && compact.hit && !expanded.min && !expanded.marked
    && expanded.tabIndex === null && expanded.focusClose, JSON.stringify({ compact, expanded }));

  const baseline = await controlAudit(page);
  check(`${engineName} ${width}px body.fs 預設態：全站互動控件命中／兩兩不相交／零 overflow`, baseline.fs && auditPass(baseline), JSON.stringify(baseline));

  // 手機的營運公告以頂列 chip + detail 呈現；塞入一筆產品格式 fixture，再真 tap 展開。
  await page.evaluate(() => {
    state.alert = { ...(state.alert || {}), list: [{ sys: 'tra_sched', sysLabel: '台鐵', title: '走查公告', desc: '走查公告內容' }] };
    renderAlertBanner();
  });
  await page.locator('#alertChip').waitFor({ state: 'visible', timeout: 5000 });
  await tap(page, '#alertChip', '營運公告');
  await page.waitForFunction(() => !document.getElementById('alertDetail').hidden, null, { timeout: 5000 });
  const banner = await controlAudit(page);
  check(`${engineName} ${width}px 公告顯示態：全站互動控件命中／兩兩不相交／零 overflow`, auditPass(banner), JSON.stringify(banner));
  await tap(page, '#alertChip', '收合營運公告');

  await tap(page, '#tabMore', '更多抽屜');
  await page.waitForFunction(() => document.body.classList.contains('tools-open'), null, { timeout: 5000 });
  const drawer = await controlAudit(page, '#moreSheet'), drawerReach = await scrollableControlsReachable(page, '#moreSheet');
  const drawerOcclusion = await scrimOcclusionAudit(page, '#moreSheet', '#moreScrim');
  check(`${engineName} ${width}px 抽屜展開態：前景控件兩兩不相交、全部可捲入命中`, auditPass(drawer, { customTargets: false, allowOut: true })
    && drawerReach.count >= 20 && drawerReach.bad.length === 0 && drawerOcclusion.count >= 5
    && drawerOcclusion.leaks.length === 0 && drawerOcclusion.wrongLayer.length === 0,
  JSON.stringify({ drawer, drawerReach, drawerOcclusion }));
  await tap(page, '#moreClose', '關閉更多抽屜');

  await tap(page, '#tabRide', '護照 sheet');
  await page.waitForFunction(() => !document.getElementById('ridePanel').hidden && document.body.classList.contains('sheet-open'), null, { timeout: 5000 });
  // ridePanel 沒有 scrim，不是 modal；必須從 body 掃全站，才會抓到 sheet 與 tabbar／followPanel／HUD 的邊界互疊。
  const duringSheetOwn = await page.evaluate(() => {
    const fp = document.getElementById('followPanel');
    return { id: state.followTrain?.train, own: !!(state.followTrain && isMyTrain(state.followTrain)),
      min: fp.classList.contains('fp-min'), inStage: fp.parentElement?.classList.contains('stage'),
      display: getComputedStyle(fp).display };
  });
  const sheet = await controlAudit(page), sheetReach = await scrollableControlsReachable(page, '#ridePanel');
  check(`${engineName} ${width}px sheet 開啟態：全站控件命中／兩兩不相交／零 overflow`, auditPass(sheet, { customTargets: false })
    && sheetReach.count > 0 && sheetReach.bad.length === 0 && duringSheetOwn.display === 'none'
    && duringSheetOwn.inStage && duringSheetOwn.own && !duringSheetOwn.min,
  JSON.stringify({ duringSheetOwn, sheet, sheetReach }));
  await page.evaluate(() => closeRidePanel());
  await page.waitForFunction(() => !document.body.classList.contains('sheet-open'));
  const afterSheetOwn = await page.evaluate(() => {
    const fp = document.getElementById('followPanel'), r = fp.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { id: state.followTrain?.train, own: !!(state.followTrain && isMyTrain(state.followTrain)),
      min: fp.classList.contains('fp-min'), display: getComputedStyle(fp).display,
      hit: at === fp || fp.contains(at), width: r.width, height: r.height };
  });
  const afterSheetAudit = await controlAudit(page);
  check(`${engineName} ${width}px 關 sheet 後同一自製跟隨卡恢復，收合狀態與全站命中不被改寫`,
    afterSheetOwn.id === duringSheetOwn.id && afterSheetOwn.own && afterSheetOwn.min === duringSheetOwn.min
      && afterSheetOwn.display !== 'none' && afterSheetOwn.hit && afterSheetOwn.width > 0 && afterSheetOwn.height > 0
      && auditPass(afterSheetAudit), JSON.stringify({ duringSheetOwn, afterSheetOwn, afterSheetAudit }));

  // 看板統合卡會把同一顆 #followPanel 從 .stage 搬到 .board .uni-slot；精準 selector 不可連這顆也藏掉。
  await page.evaluate(() => {
    const rec = state.followTrain, stop = rec?.stops?.[0];
    openBoard({ ...stop, sys: stop?.sys || rec?.sys });
  });
  const trainTab = page.locator('#board .uni-tabs button[data-t="train"]');
  await trainTab.waitFor({ state: 'visible', timeout: 5000 });
  await tapLocator(page, trainTab, 'board 這班車');
  await page.waitForFunction(() => document.getElementById('followPanel')?.closest('#board .uni-slot'));
  await page.locator('#board #fpEnd').scrollIntoViewIfNeeded();
  const boardOwn = await page.evaluate(() => {
    const fp = document.getElementById('followPanel'), end = document.getElementById('fpEnd'), r = end.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { inSlot: !!fp.closest('#board .uni-slot'), own: fp.classList.contains('fp-own'),
      display: getComputedStyle(fp).display, endHit: at === end || end.contains(at), id: state.followTrain?.train };
  });
  check(`${engineName} ${width}px board 統合槽內的自製卡不被 sheet 讓位規則誤藏`, boardOwn.inSlot && boardOwn.own
    && boardOwn.display !== 'none' && boardOwn.endHit && boardOwn.id === duringSheetOwn.id, JSON.stringify(boardOwn));
  await page.evaluate(() => closeBoard());
  await page.waitForFunction(() => !document.body.classList.contains('sheet-open')
    && document.getElementById('followPanel')?.parentElement?.classList.contains('stage'));

  if (width === 768) {
    await page.setViewportSize({ width: 768, height: 390 });
    await tap(page, '#tabRide', '橫式護照 sheet');
    await page.waitForFunction(() => document.body.classList.contains('sheet-open'));
    const landscape = await page.evaluate(() => {
      const fp = document.getElementById('followPanel');
      return { landscape: innerWidth > innerHeight, mobile: document.body.classList.contains('mobile-shell'),
        hidden: getComputedStyle(fp).display === 'none', id: state.followTrain?.train };
    });
    await page.evaluate(() => closeRidePanel());
    await page.waitForFunction(() => !document.body.classList.contains('sheet-open'));
    const landscapeRestored = await page.evaluate(() => getComputedStyle(document.getElementById('followPanel')).display !== 'none');
    check(`${engineName} 768×390 橫式 sheet 仍讓位，關閉後同一自製卡恢復`, landscape.landscape && landscape.mobile
      && landscape.hidden && landscape.id === duringSheetOwn.id && landscapeRestored, JSON.stringify({ landscape, landscapeRestored }));
    await page.setViewportSize({ width, height: 900 });
  }
}

async function runA11yAndFailureCases(page, engineName) {
  const namedTransition = await page.evaluate(() => {
    // 停靠中的真車會觸發既有 dwell-show 契約：sheet 開啟時小卡應淡出讓站名牌。這裡要驗的是
    // 「只藏自製長卡」沒有誤傷真車，因此 fixture 挑具名車後把時鐘撥到它的跑段中點，避免 08:00
    // 恰好所有具名車都停靠、兩個正確契約互撞。effTLive 會扣 liveDelaySec，故探針時刻要補回來。
    const originalTime = { simSec: state.simSec, clockAtNow: state.clockAtNow };
    let named = null, probeTime = null;
    for (const candidate of state.trains.filter(tr => !isMyTrain(tr) && trainDisplayNo(tr) !== String(tr.train))) {
      for (let i = 0; i < candidate.stops.length - 1; i++) {
        const start = candidate.stops[i].depSec, end = candidate.stops[i + 1].arrSec;
        if (!(end > start + 20)) continue;
        const midpoint = (start + end) / 2 + liveDelaySec(candidate);
        state.simSec = ((midpoint % 86400) + 86400) % 86400;
        state.clockAtNow = false;
        if (trainSeg(candidate, effTLive(candidate))?.dwell === false) {
          named = candidate; probeTime = state.simSec; break;
        }
      }
      if (named) break;
    }
    if (!named) {
      state.simSec = originalTime.simSec; state.clockAtNow = originalTime.clockAtNow;
      return { found: false };
    }
    setFollow(named, false, true, { keepNow: true });
    const hadNamed = document.getElementById('followPanel').classList.contains('fp-named');
    const label = trainDisplayNo(named);
    openRidePanel();
    const truePanel = document.getElementById('followPanel'), trueRect = truePanel.getBoundingClientRect();
    const trueAt = document.elementFromPoint(trueRect.left + trueRect.width / 2, trueRect.top + trueRect.height / 2);
    const atRect = trueAt?.getBoundingClientRect();
    const trueStyle = getComputedStyle(truePanel);
    const trueSheet = { open: document.body.classList.contains('sheet-open'), own: truePanel.classList.contains('fp-own'),
      display: trueStyle.display, opacity: trueStyle.opacity, pointerEvents: trueStyle.pointerEvents,
      dwellShow: document.body.classList.contains('dwell-show'), hit: trueAt === truePanel || truePanel.contains(trueAt),
      train: String(named.train), rect: { left: trueRect.left, top: trueRect.top, right: trueRect.right, bottom: trueRect.bottom },
      moving: trainSeg(named, effTLive(named))?.dwell === false, probeTime,
      at: trueAt ? (trueAt.id || `${trueAt.tagName}.${[...trueAt.classList].join('.')}`) : 'null',
      atRect: atRect ? { left: atRect.left, top: atRect.top, right: atRect.right, bottom: atRect.bottom } : null,
      rideRect: (() => { const r = document.getElementById('ridePanel').getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })() };
    closeRidePanel();
    state.simSec = originalTime.simSec; state.clockAtNow = originalTime.clockAtNow;
    ownTrainFollow({ noJump: true, keepNow: true });
    const fp = document.getElementById('followPanel');
    return { found: true, label, hadNamed, trueSheet, custom: isMyTrain(state.followTrain), stillNamed: fp.classList.contains('fp-named') };
  });
  check(`${engineName} 具名前綴真車切回自製車會清 .fp-named`, namedTransition.found && namedTransition.hadNamed
    && namedTransition.trueSheet.open && !namedTransition.trueSheet.own && namedTransition.trueSheet.display !== 'none'
    && namedTransition.trueSheet.opacity !== '0' && namedTransition.trueSheet.pointerEvents !== 'none'
    && namedTransition.trueSheet.moving && !namedTransition.trueSheet.dwellShow && namedTransition.trueSheet.hit
    && namedTransition.custom && !namedTransition.stillNamed, JSON.stringify(namedTransition));

  const saveBefore = await page.evaluate(() => ({ storage: localStorage.getItem(MyTrainUI.STORAGE_KEY),
    appearance: JSON.stringify(state.ownTrainAppearance), id: state.myTrains[0]?.train, count: state.myTrains.length }));
  await page.evaluate(() => {
    window.__mtRealSetItem = Storage.prototype.setItem;
    window.__mtFailedWrites = 0;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key === MyTrainUI.STORAGE_KEY) {
        window.__mtFailedWrites++;
        throw new DOMException('走查：quota full', 'QuotaExceededError');
      }
      return window.__mtRealSetItem.call(this, key, value);
    };
  });
  let dialogSeen = false;
  let saveAfterHalo;
  let saveAfter;
  try {
    await tap(page, '[data-mt-action="halo"]', 'save failure halo');
    saveAfterHalo = await page.evaluate(() => ({ storage: localStorage.getItem(MyTrainUI.STORAGE_KEY),
      appearance: JSON.stringify(state.ownTrainAppearance), id: state.myTrains[0]?.train, count: state.myTrains.length,
      toast: document.getElementById('toasts')?.textContent || '', failedWrites: window.__mtFailedWrites || 0 }));
    page.once('dialog', async dialog => { dialogSeen = true; await dialog.accept(); });
    await tap(page, '[data-mt-action="delete"]', 'save failure delete');
    saveAfter = await page.evaluate(() => ({ storage: localStorage.getItem(MyTrainUI.STORAGE_KEY),
      appearance: JSON.stringify(state.ownTrainAppearance), id: state.myTrains[0]?.train, count: state.myTrains.length,
      toast: document.getElementById('toasts')?.textContent || '', following: !!(state.followTrain && isMyTrain(state.followTrain)),
      failedWrites: window.__mtFailedWrites || 0 }));
  } finally {
    await page.evaluate(() => {
      if (window.__mtRealSetItem) Storage.prototype.setItem = window.__mtRealSetItem;
      delete window.__mtRealSetItem;
      delete window.__mtFailedWrites;
    });
  }
  check(`${engineName} 真 Storage throw：halo page.tap 確實寫 1 次並回滾外觀／提示`, saveAfterHalo.failedWrites === 1
    && JSON.stringify({ storage: saveAfterHalo.storage, appearance: saveAfterHalo.appearance, id: saveAfterHalo.id, count: saveAfterHalo.count }) === JSON.stringify(saveBefore)
    && saveAfterHalo.toast.includes('存檔失敗'), JSON.stringify({ saveBefore, saveAfterHalo }));
  check(`${engineName} 真 Storage throw：delete page.tap 另寫 1 次、dialog 真確認，列車／跟隨／storage 不分裂`, dialogSeen
    && saveAfter.failedWrites === 2
    && JSON.stringify({ storage: saveAfter.storage, appearance: saveAfter.appearance, id: saveAfter.id, count: saveAfter.count }) === JSON.stringify(saveBefore)
    && saveAfter.following && saveAfter.toast.includes('存檔失敗'), JSON.stringify({ saveBefore, saveAfterHalo, saveAfter, dialogSeen }));

  await page.evaluate(() => setLanguage('en'));
  await page.waitForFunction(() => document.documentElement.lang === 'en' && document.querySelector('[data-mt-stops]')?.getAttribute('aria-label') === 'Stop-by-stop schedule');
  await tap(page, '[data-mt-action="edit"]', 'Edit custom train');
  await page.waitForFunction(() => document.getElementById('mtForm')?.open, null, { timeout: 5000 });
  const englishPrefill = await page.evaluate(() => {
    const rec = state.myTrains[0], form = document.getElementById('mtForm');
    return { from: form.querySelector('[data-mt-f="from"]').value, to: form.querySelector('[data-mt-f="to"]').value,
      expectedFrom: stationName(rec.stops[0].name, rec.sys), expectedTo: stationName(rec.stops.at(-1).name, rec.sys),
      close: form.querySelector('[data-mt-close]').getAttribute('aria-label'),
      stops: document.querySelector('[data-mt-stops]').getAttribute('aria-label'),
      events: document.querySelector('[data-mt-events]').getAttribute('aria-label') };
  });
  const from = page.locator('[data-mt-f="from"]');
  await from.fill('taipei');
  const enSuggestions = page.locator('[data-mt-sug="from"] [data-mt-sug-key]');
  await enSuggestions.first().waitFor({ state: 'visible', timeout: 5000 });
  const suggestionTexts = await enSuggestions.allTextContents();
  const taipeiRow = enSuggestions.filter({ hasText: /Taipei/i }).first();
  await tapLocator(page, taipeiRow, 'lowercase taipei suggestion');
  const picked = await from.inputValue();
  check(`${engineName} 英文 edit 預填走 stationName、lowercase taipei 找得到 Taipei`, englishPrefill.from === englishPrefill.expectedFrom
    && englishPrefill.to === englishPrefill.expectedTo && /Taipei/i.test(englishPrefill.from)
    && suggestionTexts.some(x => /Taipei/i.test(x)) && /Taipei/i.test(picked)
    && englishPrefill.close === 'Close' && englishPrefill.stops === 'Stop-by-stop schedule'
    && englishPrefill.events === 'Event log', JSON.stringify({ englishPrefill, suggestionTexts, picked }));
  await tap(page, '[data-mt-close]', 'Close edit form');
  await page.evaluate(() => setLanguage('zh-TW'));
}

async function runWidth(browser, engineName, width) {
  const context = await contextFor(browser, width);
  try {
    const { page, pageErrors } = await boot(context);
    await openFormFromGarage(page, 'emu800');
    const formA11y = await page.evaluate(() => {
      const form = document.getElementById('mtForm'), title = document.getElementById('mtFormTitle');
      const reason = form.querySelector('[data-mt-f="reason"]'), close = form.querySelector('[data-mt-close]');
      const small = [...form.querySelectorAll('button:not([hidden]),input:not([type="hidden"]):not([hidden])')]
        .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
        .map(el => { const r = el.getBoundingClientRect(); return { name: el.dataset.mtF || el.dataset.mtColor || el.textContent.trim(), w: r.width, h: r.height }; })
        .filter(x => x.w < 43.5 || x.h < 43.5);
      return { labelledby: form.getAttribute('aria-labelledby'), title: title?.textContent || '', close: close?.getAttribute('aria-label'),
        reason: [reason?.getAttribute('role'), reason?.getAttribute('aria-live'), reason?.getAttribute('aria-atomic')], small };
    });
    check(`${engineName} ${width}px 表單有本地化 accessible name／close／live reason，所有觸控控件至少 44px`,
      formA11y.labelledby === 'mtFormTitle' && formA11y.title === '自己排一班' && formA11y.close === '關閉'
        && JSON.stringify(formA11y.reason) === '["status","polite","true"]' && formA11y.small.length === 0, JSON.stringify(formA11y));
    const fromPick = await pickStation(page, 'from', '臺北');
    const toPick = await pickStation(page, 'to', '臺東');
    await page.locator('[data-mt-f="name"]').fill('四寬測');

    const initial = await page.evaluate(() => {
      const dir = document.querySelector('.mt-f-dir'), label = document.querySelector('[data-mt-lbl="deptime"]');
      const route = document.querySelector('[data-mt-f="route"]')?.textContent || '';
      const match = route.match(/([\d.]+) 公里/);
      const b = label.getBoundingClientRect(), at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { label: label.textContent, labelHit: at === label || label.contains(at),
        dirVisible: !dir.hidden && dir.getClientRects().length > 0,
        labels: [...dir.querySelectorAll('[data-mt-fdir]')].map(x => x.textContent),
        pressed: [...dir.querySelectorAll('[aria-pressed="true"]')].map(x => x.dataset.v),
        km: match ? Number(match[1]) : null };
    });
    check(`${engineName} ${width}px 每天發車標籤與順逆行選項可見／中心可命中`,
      initial.label === '每天發車時間' && initial.labelHit && initial.dirVisible
        && JSON.stringify(initial.labels) === '["順行","逆行"]' && JSON.stringify(initial.pressed) === '["ni"]',
      JSON.stringify(initial));

    await tap(page, '[data-mt-fdir="shun"]', '順行');
    const shun = await page.evaluate(() => {
      const text = document.querySelector('[data-mt-f="route"]')?.textContent || '';
      return { pressed: [...document.querySelectorAll('[data-mt-fdir][aria-pressed="true"]')].map(x => x.dataset.v),
        km: Number((text.match(/([\d.]+) 公里/) || [])[1]) };
    });
    const viaVisible = await page.locator('[data-mt-fvia="coast"]').isVisible();
    let coast = null, mountain = null;
    if (viaVisible) {
      await tap(page, '[data-mt-fvia="coast"]', '海線');
      coast = await page.evaluate(() => ({
        pressed: [...document.querySelectorAll('[data-mt-fvia][aria-pressed="true"]')].map(x => x.dataset.v),
        km: Number(((document.querySelector('[data-mt-f="route"]')?.textContent || '').match(/([\d.]+) 公里/) || [])[1]),
      }));
      await tap(page, '[data-mt-fvia="mountain"]', '山線');
      mountain = await page.evaluate(() => ({
        pressed: [...document.querySelectorAll('[data-mt-fvia][aria-pressed="true"]')].map(x => x.dataset.v),
        km: Number(((document.querySelector('[data-mt-f="route"]')?.textContent || '').match(/([\d.]+) 公里/) || [])[1]),
      }));
    }
    const dynamicTargets = await page.evaluate(() => [...document.querySelectorAll('[data-mt-fdir],[data-mt-fvia],[data-mt-fpattern]')]
      .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
      .map(el => { const r = el.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { key: el.dataset.mtFdir || el.dataset.mtFvia || el.dataset.mtFpattern, width: r.width, height: r.height,
          hit: at === el || el.contains(at) }; }));
    await tap(page, '[data-mt-fdir="ni"]', '逆行');
    const ni = await page.evaluate(() => ({
      pressed: [...document.querySelectorAll('[data-mt-fdir][aria-pressed="true"]')].map(x => x.dataset.v),
      km: Number(((document.querySelector('[data-mt-f="route"]')?.textContent || '').match(/([\d.]+) 公里/) || [])[1]),
    }));
    check(`${engineName} ${width}px page.tap 真點順行／逆行且路線互換`,
      shun.pressed[0] === 'shun' && ni.pressed[0] === 'ni' && shun.km > ni.km + 100 && ni.km === initial.km,
      JSON.stringify({ initialKm: initial.km, shun, ni }));
    check(`${engineName} ${width}px 動態建議／順逆行／山海線／停站方式皆為 44px 可命中觸控目標`,
      fromPick.suggestion.width >= 43.5 && fromPick.suggestion.height >= 43.5 && toPick.suggestion.width >= 43.5
        && toPick.suggestion.height >= 43.5 && fromPick.input?.height >= 43.5 && toPick.input?.height >= 43.5
        && viaVisible && coast?.pressed[0] === 'coast' && mountain?.pressed[0] === 'mountain' && coast.km !== mountain.km
        && dynamicTargets.length >= 7 && dynamicTargets.every(x => x.width >= 43.5 && x.height >= 43.5 && x.hit),
      JSON.stringify({ fromPick, toPick, coast, mountain, dynamicTargets }));

    const controls = await visibleControlHits(page);
    const overflow = await page.evaluate(() => ({
      page: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
      form: document.getElementById('mtForm').scrollWidth - document.getElementById('mtForm').clientWidth,
      body: document.querySelector('#mtForm .mt-f-body').scrollWidth - document.querySelector('#mtForm .mt-f-body').clientWidth,
    }));
    check(`${engineName} ${width}px 表單可見控件 elementFromPoint 全命中、零水平 overflow`,
      controls.seen.length >= 11 && controls.bad.length === 0 && controls.badTouch.length === 0
        && overflow.page <= 1 && overflow.form <= 1 && overflow.body <= 1,
      `controls=${controls.seen.length} bad=${JSON.stringify(controls.bad)} touch=${JSON.stringify(controls.badTouch)} overflow=${JSON.stringify(overflow)}`);

    const storageBefore = await page.evaluate(() => localStorage.getItem(MyTrainUI.STORAGE_KEY));
    const b86399 = await forceUiDuration(page, 86399);
    const b86400 = await forceUiDuration(page, 86400);
    const b86401 = await forceUiDuration(page, 86401);
    const recovered = await forceUiDuration(page, 86399);
    const storageAfter = await page.evaluate(() => localStorage.getItem(MyTrainUI.STORAGE_KEY));
    check(`${engineName} ${width}px UI exact 24h：86399/86400 可發、86401 擋、切回恢復且未覆寫存檔`,
      !b86399.disabled && !b86400.disabled && b86401.disabled && /超過 24 小時/.test(b86401.reason)
        && !recovered.disabled && storageAfter === storageBefore,
      JSON.stringify({ b86399, b86400, b86401, recovered, storageUnchanged: storageAfter === storageBefore }));

    const restored = await restoreUiDuration(page);
    check(`${engineName} ${width}px 邊界替身移除後仍走正式排班且可發車`, restored);
    await followStateMatrix(page, engineName, width);
    if (width === 375) await runA11yAndFailureCases(page, engineName);

    check(`${engineName} ${width}px 走查零 pageerror`, pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } catch (error) {
    check(`${engineName} ${width}px 走查執行`, false, String(error.stack || error).slice(0, 500));
  } finally {
    await context.close();
  }
}

async function submitOpenForm(page, { from, to, name, hh = 8, mm = 0 }) {
  await pickStation(page, 'from', from);
  await pickStation(page, 'to', to);
  await page.locator('[data-mt-f="hh"]').fill(String(hh));
  await page.locator('[data-mt-f="mm"]').fill(String(mm));
  await page.locator('[data-mt-f="name"]').fill(name);
  await page.waitForFunction(() => !document.querySelector('[data-mt-f="depart"]')?.disabled, null, { timeout: 10000 });
  await tap(page, '[data-mt-f="depart"]', '發車');
  await leaveDepot(page);
  await page.waitForFunction(() => state.myTrains.length === 1 && !document.getElementById('mtForm').open, null, { timeout: 10000 });
}

async function blueSnapshot(page) {
  return page.evaluate(() => {
    const rec = state.myTrains[0], saved = MyTrainUI.load().trains[0];
    const dwell = name => { const s = rec?.stops.find(x => x.name === name); return s ? s.depSec - s.arrSec : null; };
    return { from: rec?.stops[0]?.name, to: rec?.stops.at(-1)?.name, id: rec?.train,
      savedFrom: saved?.from, savedTo: saved?.to,
      dwell: { '崁頂': dwell('崁頂'), '東海': dwell('東海'), '枋寮': dwell('枋寮'), '金崙': dwell('金崙') } };
  });
}

function blueOk(s, from, to) {
  return s.from === from && s.to === to && s.dwell['崁頂'] === BLUE_DWELL.off && s.dwell['東海'] === BLUE_DWELL.off
    && s.dwell['枋寮'] === BLUE_DWELL.on && s.dwell['金崙'] === BLUE_DWELL.on;
}

async function runBlue(browser, engineName) {
  const context = await contextFor(browser, 375);
  try {
    const { page, pageErrors } = await boot(context);
    await openFormFromGarage(page, 'blue');
    await submitOpenForm(page, { from: '潮州', to: '太麻里', name: '藍皮測' });
    const forward = await blueSnapshot(page);
    check(`${engineName} 藍皮南迴順向：線外全系統中位數、枋寮／線內普快中位數`, blueOk(forward, '潮州', '太麻里'), JSON.stringify(forward));

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => state.ready && state.myTrains.length === 1, null, { timeout: 60000 });
    await page.evaluate(() => { state.playing = false; });
    const forwardReload = await blueSnapshot(page);
    check(`${engineName} 藍皮順向重新載入仍保留中位數規則`, blueOk(forwardReload, '潮州', '太麻里') && forwardReload.id === forward.id,
      JSON.stringify(forwardReload));

    await openGarage(page);
    await pickModel(page, 'blue');
    await tap(page, '#trainGarage [data-mt-g="view"]', '藍皮去看它');
    await page.waitForFunction(() => state.followTrain && isMyTrain(state.followTrain), null, { timeout: 10000 });
    await tap(page, '[data-mt-action="edit"]', '編輯自製藍皮');
    await page.waitForFunction(() => document.getElementById('mtForm')?.open, null, { timeout: 5000 });
    await submitOpenForm(page, { from: '太麻里', to: '潮州', name: '藍皮測' });
    const reverse = await blueSnapshot(page);
    check(`${engineName} 藍皮反向經 UI 編輯：線外全系統中位數、枋寮／線內普快中位數`,
      blueOk(reverse, '太麻里', '潮州') && reverse.id === forward.id, JSON.stringify(reverse));

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => state.ready && state.myTrains.length === 1, null, { timeout: 60000 });
    const reverseReload = await blueSnapshot(page);
    check(`${engineName} 藍皮反向重新載入仍保留中位數規則`,
      blueOk(reverseReload, '太麻里', '潮州') && reverseReload.id === forward.id, JSON.stringify(reverseReload));
    check(`${engineName} 藍皮雙向編輯／重載零 pageerror`, pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } catch (error) {
    check(`${engineName} 藍皮雙向編輯／重載執行`, false, String(error.stack || error).slice(0, 500));
  } finally {
    await context.close();
  }
}

async function runMidnightAndShare(browser, engineName) {
  const context = await contextFor(browser, 375);
  try {
    // scene=2d/formation/ground 讓新 shareParams 契約也參與自製車分享隔離，不只測舊的地點參數。
    const { page, pageErrors } = await boot(context, '?g=nat&scene=2d&formation=three&ground=terrain');
    await openFormFromGarage(page, 'emu800');
    await submitOpenForm(page, { from: '臺北', to: '花蓮', name: '夜車', hh: 23, mm: 50 });
    const scan = await page.evaluate(() => {
      const rec = state.myTrains[0], dep = rec.stops[0].depSec;
      state.playing = false; state.speedMult = 60;
      const run = reset => {
        if (reset) ownTrainLogReset(rec.train);
        else {
          // 保留既有 items，只把掃描錨點移回發車前；第二輪才真的會走到 addEvent 的去重分支。
          state.ownTrainLogs.get(state.myTrains[0]?.train).lastSimSec = null;
          state.ownTrainLogs.get(state.myTrains[0]?.train).lastWallMs = null;
          state.ownTrainLogs.get(state.myTrains[0]?.train).lastSpd = null;
        }
        state.simSec = (dep - 10 + 86400) % 86400;
        ownTrainScan();
        for (let rel = 230; rel <= 1910; rel += 240) {
          state.ownTrainLogs.get(state.myTrains[0]?.train).lastWallMs = performance.now() - 5000;
          state.ownTrainLogs.get(state.myTrains[0]?.train).lastSpd = 60;
          state.simSec = (dep + rel) % 86400;
          ownTrainScan();
        }
      };
      run(true);
      const first = state.ownTrainLogs.get(state.myTrains[0]?.train).items.map(x => ({ kind: x.kind, key: x.key, rel: x.rel, simT: x.simT }));
      run(false); // 同一段完整重掃但不清 items；addEvent 必須把所有停靠事件去重。
      const second = state.ownTrainLogs.get(state.myTrains[0]?.train).items.map(x => ({ kind: x.kind, key: x.key, rel: x.rel, simT: x.simT }));
      const keys = second.map(x => `${x.kind}|${x.key}`);
      return { dep, first, second, stable: JSON.stringify(first) === JSON.stringify(second),
        duplicates: keys.filter((x, i) => keys.indexOf(x) !== i),
        nextDay: second.filter(x => x.rel >= 600 && x.simT < dep) };
    });
    check(`${engineName} 23:50 跨午夜產生次日事件，完整重掃不重複`,
      scan.dep === 85800 && scan.first.some(x => x.kind === 'depart' && x.rel === 0)
        && scan.nextDay.length > 0 && scan.stable && scan.duplicates.length === 0,
      JSON.stringify({ dep: scan.dep, count: scan.second.length, nextDay: scan.nextDay, stable: scan.stable, duplicates: scan.duplicates }));

    const zhEvents = await page.evaluate(() => {
      ownTrainPanelUpdate(state.followTrain);
      const rows = [...document.querySelectorAll('[data-mt-events] .mt-ev')];
      window.__mtFirstEventNode = rows[0] || null;
      return rows.map(row => row.textContent.trim());
    });
    await page.evaluate(() => setLanguage('en'));
    await page.waitForFunction(() => [...document.querySelectorAll('[data-mt-events] .mt-ev-x')]
      .some(el => /Departed|Stopped|Arrived|Met|passed/.test(el.textContent)));
    const enEvents = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('[data-mt-events] .mt-ev')].map(row => row.textContent.trim()),
      sameNode: document.querySelector('[data-mt-events] .mt-ev') === window.__mtFirstEventNode,
      label: document.querySelector('[data-mt-events]').getAttribute('aria-label'),
    }));
    check(`${engineName} 語言切換會就地重譯既有事件列（不是等下一事件）`, zhEvents.length > 0
      && zhEvents.some(x => /發車|停靠|抵達|交會|通過/.test(x)) && enEvents.rows.length === zhEvents.length
      && enEvents.rows.some(x => /Departed|Stopped|Arrived|Met|passed/.test(x)) && enEvents.sameNode
      && enEvents.label === 'Event log', JSON.stringify({ zh: zhEvents.slice(0, 3), en: enEvents.rows.slice(0, 3), sameNode: enEvents.sameNode }));
    await page.evaluate(() => setLanguage('zh-TW'));

    const share = await page.evaluate(() => {
      const rec = state.myTrains[0], name = rec.label, id = rec.train;
      const url = buildShareUrl(), trip = buildTripUrl(rec, rec.stops.at(-1).name);
      const leaks = (value, needle) => value != null && (value.includes(needle) || value.includes(encodeURIComponent(needle)));
      const parsed = new URL(url);
      return { url, trip, id, name, leaksId: leaks(url, id), leaksName: leaks(url, name),
        tripLeaksId: leaks(trip, id), scene: parsed.searchParams.get('scene'),
        formation: parsed.searchParams.get('formation'), ground: parsed.searchParams.get('ground') };
    });
    check(`${engineName} 合併後 share3d 設定保留，自製車 id／名稱不進分享與行程 URL`,
      !share.leaksId && !share.leaksName && !share.tripLeaksId && share.trip === null
        && share.scene === '2d' && share.formation === 'three' && share.ground === 'terrain', JSON.stringify(share));
    check(`${engineName} 跨午夜／share isolation 零 pageerror`, pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } catch (error) {
    check(`${engineName} 跨午夜／share isolation 執行`, false, String(error.stack || error).slice(0, 500));
  } finally {
    await context.close();
  }
}

const engines = { chromium, webkit };
const engineFilter = String(process.env.MYTRAIN_ENGINE || '').trim();
const widths = String(process.env.MYTRAIN_WIDTHS || '360,375,414,768').split(',').map(Number)
  .filter(width => Number.isInteger(width) && width > 0);
for (const [engineName, engine] of Object.entries(engines)) {
  if (engineFilter && engineName !== engineFilter) continue;
  const browser = await engine.launch(engineName === 'chromium'
    ? { channel: 'chromium', headless: true }
    : { headless: true });
  try {
    for (const width of widths) await runWidth(browser, engineName, width);
    await runBlue(browser, engineName);
    await runMidnightAndShare(browser, engineName);
  } finally {
    await browser.close();
  }
}

server.close();
const failed = results.filter(x => !x.pass);
console.log(`\n總計 ${results.length} 項，PASS ${results.length - failed.length}／FAIL ${failed.length}`);
if (failed.length) {
  console.log('未過：');
  for (const item of failed) console.log(`- ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
}
process.exitCode = failed.length ? 1 : 0;
