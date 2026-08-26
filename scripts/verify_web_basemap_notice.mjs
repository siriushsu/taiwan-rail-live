#!/usr/bin/env node
// 網站版 OpenFreeMap 失效時的使用者訊號驗收。
//
// 背景:L2 的 ofmWatch 原本對網站整條 `if (!APP_CFG.tiles) return;`——因為網站唯一的 raster
// 退路是 CARTO,而那正是這批要離開的東西。但「退不了」被寫成了「不偵測」,於是 OFM 半死時
// 網站是**零訊號**:空白底圖上飄著列車,使用者分不清是自己的網路、我們掛了、還是功能壞了,
// 連 console 都乾淨。這批把偵測補回來,退不了就改成講出來並指向現成還能用的那條路(衛星)。
//
// 🔴 這支的重點在**負向對照**:一個「出事就跳提示」的機制,最容易的假綠是它其實每次都跳
//    (那就不是訊號是雜訊)。所以 B 情境(OFM 正常)必須乾乾淨淨沒有提示。
// 🔴 C 情境刻意分開:只擋圖磚、放行 TileJSON。MapLibre 的 `load` 事件語意決定了偵測的邊界,
//    那是**量出來**的不是推出來的——判準寫成「量到什麼就斷言什麼」,並把邊界印在輸出裡。
//
// 用法:node scripts/verify_web_basemap_notice.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium, webkit } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

// ── G0 自檢:先證明我在量的是誰(判準盲點形態 0)──────────────────────────
const src = await readFile(join(ROOT, 'index.html'), 'utf8');
console.log(`[G0] 目標 ${join(ROOT, 'index.html')}  ${src.length} bytes`);
for (const [frag, why] of [
  ['function ofmNoticeWeb', '網站端的提示函式'],
  ['ofmNoticeWeb(why)', 'fail() 有接到網站分支'],
  ['function ofmWatch', 'L2 監看還在'],
]) if (!src.includes(frag)) { console.error(`❌ [G0] 這份 index.html 沒有「${why}」(${frag})——驗錯目標或改動沒落地`); process.exit(1); }
// 反向:舊的「網站整條 return」必須真的不見了。註解裡會提到這件事,所以剝掉行註解再比對。
const code = src.split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
if (/function ofmWatch\(layer\) \{\s*\n\s*if \(!APP_CFG\.tiles\) return;/.test(code)) {
  console.error('❌ [G0] ofmWatch 仍對網站早退——改動沒生效'); process.exit(1);
}
console.log('[G0] 機制都在這份檔裡,且舊的早退已移除');

const PORT = Number(process.env.WEBNOTICE_PORT || 43977);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(ROOT, p === '/' ? 'index.html' : p);
    if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
    const body = await readFile(file);
    res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch { res.statusCode = 404; res.end('nf'); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const R = [];
const ok = (id, pass, detail) => { R.push({ id, pass }); console.log(`${pass ? '✅' : '❌'} ${id} — ${detail}`); };
const note = (id, detail) => console.log(`ℹ️  ${id} — ${detail}`);

// ofm: 'block' 全擋 | 'tilesonly' 只擋圖磚(TileJSON/字型/sprite 放行) | 'live' 真網路
// sat: true=/api/basemap-token 給假 token(衛星鈕留著) | false=404(鈕被 remove)
async function run(engine, { ofm, sat = true, mobile = false, appShell = false, waitMs = 14000 }) {
  const ctx = await engine.launch().then(b => b.newContext(
    mobile ? { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true } : {}));
  const errs = [];
  if (ofm === 'block') await ctx.route('**://tiles.openfreemap.org/**', r => r.abort('failed'));
  else if (ofm === 'tilesonly') await ctx.route('**://tiles.openfreemap.org/**', r =>
    /\/(planet|fonts|sprites)/.test(r.request().url()) ? r.continue() : r.abort('failed'));
  // /api/* 一律攔:不打真的端點。basemap-token 依情境決定給不給。
  // 🔴 其餘端點回 404 而不是 200 `{}`:前端的資料源是「apiUrl 優先、fallbackUrl(data/*.json) 退路」
  //    兩層,回一個**成功但空**的 200 會讓它以為拿到了 ⇒ `sys.data.trains` undefined ⇒ boot 拋錯。
  //    回 404 才會走進磁碟上那份真資料(本機 server 供得起),既不打真端點也不製造假故障。
  await ctx.route('**/api/**', r => {
    const u = r.request().url();
    if (u.includes('basemap-token')) return sat
      ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"esri":"TESTTOKEN"}' })
      : r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_configured"}' });
    return r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"stubbed"}' });
  });
  // 衛星圖磚也不准打真的(Esri 計費)
  await ctx.route('**://ibasemaps-api.arcgis.com/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  // App 分支的 raster 退路指向 Stadia(計費)——一律回假 PNG,驗收不打真端點。
  await ctx.route('**://tiles.stadiamaps.com/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  // App 分支:同一份 index.html,靠注入 window.RAIL_APP_CONFIG 走 APP_CFG.tiles 那條路
  // (正式時由 prepare-web.mjs 注入)。這是為了證明本批改動沒有把 App 的 L2 自動退場改壞——
  // 「讀起來一樣」不算證據(心得 23:自己驗自己的『零變化』會系統性失明)。
  if (appShell) await page.addInitScript(() => {
    window.RAIL_APP_CONFIG = { streetSrc: 'ofm', tiles: {
      light: { url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png', maxZoom: 20, attribution: 'test' },
      dark: { url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', maxZoom: 20, attribution: 'test' },
    } };
  });
  // 🔴 全程錄下每一則 toast,不靠取樣時點。首版在載入後固定等 14 秒才讀畫面,而 toast
  //    只活 5 秒(showToast 內 setTimeout 5000 → remove)——機制明明跑了(console.warn 有出來、
  //    ofmNoticeShown=true),讀到的卻是空陣列,10/12 全紅。判準不可以綁在「剛好那一刻畫面上有什麼」。
  await page.addInitScript(() => {
    window.__seenToasts = [];
    const grab = n => {
      if (!n || n.nodeType !== 1) return;
      if (n.classList && n.classList.contains('toast')) window.__seenToasts.push((n.textContent || '').trim());
      if (n.querySelectorAll) for (const c of n.querySelectorAll('.toast')) window.__seenToasts.push((c.textContent || '').trim());
    };
    // addInitScript 跑在 document_start,那一刻 document.documentElement 可能還是 null
    // (兩個引擎都會拋 "parameter 1 is not of type 'Node'")——輪詢到它出現再掛。
    const mo = new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) grab(n); });
    const arm = () => document.documentElement
      ? mo.observe(document.documentElement, { childList: true, subtree: true })
      : setTimeout(arm, 0);
    arm();
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof baseLayers !== 'undefined' && baseLayers && baseLayers.light,
    null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(waitMs);   // OFM_HEALTH_MS = 8000,留足餘裕
  const got = await page.evaluate(() => ({
    // 量使用者**看得到過**的東西:曾經進到 DOM 的每一則 toast。不是量 ofmNoticeShown 這種
    // 內部旗標——那是實作的下游,會跟著實作一起錯(判準盲點:斷言落在受測物下游)。
    toasts: window.__seenToasts || [],
    satBtn: !!document.getElementById('satBtn'),
    layerKind: (() => { const l = baseLayers && baseLayers.light; return !l ? 'none' : (typeof l._url === 'string' ? 'raster' : 'ofm'); })(),
  }));
  await ctx.close();
  return { ...got, errs, notice: got.toasts.some(t => /街道底圖載入異常/.test(t)) };
}

// 預設兩引擎都跑;突變測試/快速迭代時用 WEBNOTICE_ENGINES=chromium 只跑一個
const ENGINES = [['chromium', chromium], ['webkit', webkit]]
  .filter(([n]) => !process.env.WEBNOTICE_ENGINES || process.env.WEBNOTICE_ENGINES.split(',').includes(n));
for (const [name, engine] of ENGINES) {
  console.log(`\n──────── ${name} ────────`);

  const a = await run(engine, { ofm: 'block' });
  ok(`A/${name} OFM 全擋 ⇒ 使用者看得到提示`, a.notice, `toast=${JSON.stringify(a.toasts).slice(0, 120)}`);
  ok(`A/${name} 有衛星鈕時訊息指向衛星`, a.satBtn && a.toasts.some(t => /街道底圖載入異常/.test(t) && /衛星/.test(t)),
    `satBtn=${a.satBtn}`);
  ok(`A/${name} boot 沒拋錯`, a.errs.length === 0, a.errs.join(' | ') || '0');

  // 🔴 負向對照:這條紅了代表提示變成每次都跳的雜訊,比沒有提示更糟。
  const b = await run(engine, { ofm: 'live' });
  ok(`B/${name} OFM 正常 ⇒ 不可出現提示`, !b.notice, `layer=${b.layerKind} toasts=${b.toasts.length}`);

  // 沒有衛星鈕(Esri token 404)時訊息要改口,不可叫使用者去點一顆不存在的鈕
  const d = await run(engine, { ofm: 'block', sat: false });
  ok(`D/${name} 無衛星鈕時不提衛星`, d.notice && !d.satBtn && !d.toasts.some(t => /衛星/.test(t)),
    `notice=${d.notice} satBtn=${d.satBtn} toast=${JSON.stringify(d.toasts).slice(0, 100)}`);

  // 手機:提示是既有的 toast 元件,但它在手機有 placeMobileNotice 的避讓邏輯,要真的看得到
  const m = await run(engine, { ofm: 'block', mobile: true });
  ok(`M/${name} 手機 375 也看得到提示`, m.notice, `toasts=${JSON.stringify(m.toasts).slice(0, 100)}`);

  // 🔴 E:App 分支的回歸對照。本批把 ofmWatch 的 App 早退拿掉、改走共用的 fail(),
  //    App 那半必須**照舊自動退到 raster、而且不可以跳網站那則提示**(App 有退路,不需要叫使用者做事)。
  const e = await run(engine, { ofm: 'block', appShell: true });
  ok(`E/${name} App 分支仍自動退到 raster`, e.layerKind === 'raster', `layer=${e.layerKind}`);
  ok(`E/${name} App 分支不跳網站的提示`, !e.notice, `toasts=${JSON.stringify(e.toasts).slice(0, 100)}`);

  // C:偵測邊界的量測。TileJSON/字型/sprite 放行、只擋圖磚——MapLibre 的 load 可能照樣觸發,
  // 那樣就偵測不到。這條**只記錄不判分**:它是機制既有的邊界(App 也一樣),不是這批的回歸。
  const c = await run(engine, { ofm: 'tilesonly' });
  note(`C/${name} 只擋圖磚(TileJSON 放行)`, `偵測到=${c.notice}　←　這是 L2 判準的邊界,App 端同此`);
}

await new Promise(r => server.close(r));
const fail = R.filter(r => !r.pass).length;
console.log(`\n總計 ${R.length - fail}/${R.length} 通過`);
process.exit(fail ? 1 : 0);
