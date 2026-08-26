#!/usr/bin/env node
// 網站版 OpenFreeMap 失效時的處置驗收。
//
// 背景兩階段:
//  (1) L2 的 ofmWatch 原本對網站整條 `if (!APP_CFG.tiles) return;`——網站唯一的 raster 退路是
//      CARTO,而 08-18 正是為了離開 CARTO 才換 OFM。但「退不了」被寫成了「不偵測」,於是 OFM
//      半死時網站是**零訊號**:空白底圖上飄著列車,連 console 都乾淨。fdf04b0 先補上偵測與提示。
//  (2) 2026-08-26 使用者裁示:**OFM 失效時網站可以退回 CARTO**。於是網站與 App 走同一條路
//      (偵測到就換層、無聲繼續看地圖),而原本那則提示的場景縮小成「連退路都掛了」。
//
// 🔴 這支的重點在**負向對照**:一個「出事就換供應商」的機制,最貴的假綠是它其實每次都換
//    ——那等於把所有人靜默送去 CARTO,正好回到我們要離開的地方。所以判準不是「有沒有 raster 層」
//    而是**實際打出去的 CARTO 圖磚請求數**:A 情境必須 >0、B 情境(OFM 正常)必須恰為 0、
//    E 情境(App 殼)也必須恰為 0(App 包內禁止出現 CARTO,verify-release.mjs:406 有硬檢查)。
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
  ['function ofmWatch', 'L2 監看還在'],
  ['const fail = why => { stop(); ofmFallToRaster(why); };', 'App/網站走同一條退場路'],
  ["ofmRasterFallback[k] = () => L.tileLayer(t.url, opt);", '退路 thunk 還在'],
  ['function ofmNoticeWeb', '連退路都掛了的提示函式'],
  ["on('tileerror'", '退場後有盯著 raster 自己'],
]) if (!src.includes(frag)) { console.error(`❌ [G0] 這份 index.html 沒有「${why}」(${frag})——驗錯目標或改動沒落地`); process.exit(1); }
// 反向兩條:舊的「網站整條 return」與「只有 App 備退路」都必須真的不見了。
// 註解裡會提到這兩件事,所以剝掉行註解再比對(否則會被自己的說明文字騙過)。
const code = src.split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
if (/function ofmWatch\(layer\) \{\s*\n\s*if \(!APP_CFG\.tiles\) return;/.test(code)) {
  console.error('❌ [G0] ofmWatch 仍對網站早退——改動沒生效'); process.exit(1);
}
if (/if \(APP_CFG\.tiles\) \{ if \(!ofmRasterFallback\)/.test(code)) {
  console.error('❌ [G0] 退路仍只有 App 備得起來——網站退不了'); process.exit(1);
}
console.log('[G0] 機制都在這份檔裡,且兩條舊路都已移除');

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

// ofm:   'block' 全擋 | 'tilesonly' 只擋圖磚(TileJSON/字型/sprite 放行) | 'live' 真網路
// sat:   true=/api/basemap-token 給假 token(衛星鈕留著) | false=404(鈕被 remove)
// carto: 'ok'=回假 PNG 並計數 | 'dead'=一律失敗(模擬「兩家同時掛」)
//   🔴 一律攔:CARTO 正是這批在談授權的那個服務,驗收不對它打任何一發真請求。
async function run(engine, { ofm, sat = true, mobile = false, appShell = false, carto = 'ok', waitMs = 14000 }) {
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
  let stadiaHits = 0;
  await ctx.route('**://tiles.stadiamaps.com/**', r => { stadiaHits++; r.fulfill({ status: 200, contentType: 'image/png', body: PNG }); });
  // 網站的 raster 退路指向 CARTO。**這個計數器就是主判準**:它 >0 才叫「真的退到 CARTO 了」,
  // 它 ===0 才叫「沒有把人靜默送去 CARTO」。只看 baseLayers.light._url 是實作的下游,
  // 圖層物件建好但一張圖磚都沒送出去也照樣「像是」退成功了。
  let cartoHits = 0;
  await ctx.route('**://*.basemaps.cartocdn.com/**', r => {
    cartoHits++;
    return carto === 'dead' ? r.abort('failed') : r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });
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
    layerUrl: (() => { const l = baseLayers && baseLayers.light; return (l && typeof l._url === 'string') ? l._url : ''; })(),
  }));
  await ctx.close();
  return { ...got, errs, cartoHits, stadiaHits, notice: got.toasts.some(t => /街道底圖載入異常/.test(t)) };
}

// 預設兩引擎都跑;突變測試/快速迭代時用 WEBNOTICE_ENGINES=chromium 只跑一個
const ENGINES = [['chromium', chromium], ['webkit', webkit]]
  .filter(([n]) => !process.env.WEBNOTICE_ENGINES || process.env.WEBNOTICE_ENGINES.split(',').includes(n));
for (const [name, engine] of ENGINES) {
  console.log(`\n──────── ${name} ────────`);

  const a = await run(engine, { ofm: 'block' });
  ok(`A/${name} OFM 全擋 ⇒ 真的退到 CARTO(有打出圖磚請求)`, a.cartoHits > 0 && a.layerKind === 'raster',
    `cartoHits=${a.cartoHits} layer=${a.layerKind} url=${a.layerUrl.slice(0, 46)}`);
  ok(`A/${name} 退到的是 CARTO 不是別家`, /basemaps\.cartocdn\.com/.test(a.layerUrl), a.layerUrl.slice(0, 60) || '(空)');
  // 退成功就無聲繼續看地圖:CARTO 的視覺與 OFM 樣式幾乎一樣,跳提示只是製造焦慮。
  ok(`A/${name} 退成功不跳提示`, !a.notice, `toasts=${JSON.stringify(a.toasts).slice(0, 90)}`);
  ok(`A/${name} boot 沒拋錯`, a.errs.length === 0, a.errs.join(' | ') || '0');

  // 🔴🔴 這是全檔最重要的一條。它紅了代表所有人都被靜默送去 CARTO——正是 08-18 要離開的地方,
  //     而且畫面看起來完全正常,沒有任何症狀會讓人發現。A 的 cartoHits>0 是它的正向對照。
  const b = await run(engine, { ofm: 'live' });
  ok(`B/${name} OFM 正常 ⇒ 一發 CARTO 請求都不可以有`, b.cartoHits === 0 && b.layerKind === 'ofm',
    `cartoHits=${b.cartoHits} layer=${b.layerKind}`);
  ok(`B/${name} OFM 正常 ⇒ 不跳提示`, !b.notice, `toasts=${b.toasts.length}`);

  // 衛星鈕的有無不該影響退場(它們是兩條獨立的路:Esri token 與街道底圖)
  const d = await run(engine, { ofm: 'block', sat: false });
  ok(`D/${name} 沒有衛星鈕也照樣退得成`, d.cartoHits > 0 && !d.satBtn, `cartoHits=${d.cartoHits} satBtn=${d.satBtn}`);

  const m = await run(engine, { ofm: 'block', mobile: true });
  ok(`M/${name} 手機 375 也退得成`, m.cartoHits > 0, `cartoHits=${m.cartoHits} layer=${m.layerKind}`);

  // 🔴 E:App 分支的回歸對照。App 必須退到自己的 Stadia,**且一發 CARTO 都不可以打**——
  //    App 包內禁止出現 CARTO 網址(app/scripts/verify-release.mjs:406 硬檢查),
  //    這批把「只有 App 備退路」的守衛拿掉了,要證明拿掉的是守衛不是隔離。
  const e = await run(engine, { ofm: 'block', appShell: true });
  ok(`E/${name} App 分支仍退到自己的 Stadia`, e.stadiaHits > 0 && e.layerKind === 'raster', `stadiaHits=${e.stadiaHits} layer=${e.layerKind}`);
  ok(`E/${name} App 分支一發 CARTO 都沒打`, e.cartoHits === 0, `cartoHits=${e.cartoHits} url=${e.layerUrl.slice(0, 46)}`);
  ok(`E/${name} App 分支不跳網站的提示`, !e.notice, `toasts=${JSON.stringify(e.toasts).slice(0, 90)}`);

  // 🔴 N:兩家同時掛。退到 CARTO 之後那一層自己也是死的 ⇒ 使用者又回到「空白底圖飄著列車」,
  //    這時必須把話講出來。這條就是 fdf04b0 那則提示現在唯一的適用場景。
  const n = await run(engine, { ofm: 'block', carto: 'dead' });
  ok(`N/${name} OFM 與 CARTO 同時掛 ⇒ 使用者看得到提示`, n.notice,
    `cartoHits=${n.cartoHits} toasts=${JSON.stringify(n.toasts).slice(0, 90)}`);

  // C:偵測邊界的量測。TileJSON/字型/sprite 放行、只擋圖磚——MapLibre 的 load 可能照樣觸發,
  // 那樣就偵測不到。這條**只記錄不判分**:它是機制既有的邊界(App 也一樣),不是這批的回歸。
  const c = await run(engine, { ofm: 'tilesonly' });
  note(`C/${name} 只擋圖磚(TileJSON 放行)`, `退場了=${c.cartoHits > 0}　←　這是 L2 判準的邊界,App 端同此`);
}

await new Promise(r => server.close(r));
const fail = R.filter(r => !r.pass).length;
console.log(`\n總計 ${R.length - fail}/${R.length} 通過`);
process.exit(fail ? 1 : 0);
