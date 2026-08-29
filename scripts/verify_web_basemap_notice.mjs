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

const PAGE_LOCALE = 'zh-TW';
const PORT = Number(process.env.WEBNOTICE_PORT || 43977);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
// 突變對照用：把 index.html 換掉再跑同一個情境。兩發都打「提示會不會說謊」——
// 2026-08-29 才發現多語上線後 `notice` 在英文語系下【恆為 false】，於是 A／B／E 那三條
// `!notice` 全部空過（綠得毫無意義），只有 N 那條正判準紅出來。語系釘死之後必須證明
// 這兩個方向都真的有牙，否則「釘死語系」與「判準本來就沒作用」在計分板上長得一樣。
//
// P：退成功時也硬跳提示 ⇒ A 的「退成功不跳提示」必須轉紅。
const MUT_NOTICE_ON_FALLBACK = src.replace(
  '  const fail = why => { stop(); ofmFallToRaster(why); };',
  '  const fail = why => { stop(); ofmFallToRaster(why); ofmNoticeWeb(why); }; // MUTATION notice-on-fallback');
if (MUT_NOTICE_ON_FALLBACK === src) { console.error('❌ 突變 P 沒有命中'); process.exit(1); }
// Q：提示整個不發 ⇒ N 的「兩家同時掛要講出來」必須轉紅。
const MUT_NO_NOTICE = src.replace(
  'function ofmNoticeWeb(why) {\n  if (ofmNoticeShown) return;',
  'function ofmNoticeWeb(why) {\n  if (true) return; // MUTATION no-notice\n  if (ofmNoticeShown) return;');
if (MUT_NO_NOTICE === src) { console.error('❌ 突變 Q 沒有命中'); process.exit(1); }

let servedHtml = null; // null＝供磁碟上那份（G0 已證明它是這棵樹的）
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(ROOT, p === '/' ? 'index.html' : p);
    if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
    if (servedHtml != null && (p === '/' || p === '/index.html')) {
      res.setHeader('content-type', MIME['.html']); return res.end(servedHtml);
    }
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
  // 🔴 語系釘死（2026-08-29）。index.html 的 I18N_LANG 依 `query > localStorage > navigator`
  //    決定，而 Playwright 預設 navigator.language=en-US ⇒ 提示會渲染成
  //    "The street map failed to load…"，而下面整組判準都靠 /街道底圖載入異常/ 認它。
  //    後果不只是 N 假紅：A／B／E 那三條 `!notice` 會【恆真】而空過一週。
  //    兩道一起下：context locale（navigator／Intl／toLocaleString 不隨機器漂）＋
  //    網址 ?lang=zh-TW（index.html 自己的最高優先開關，top-level 就讀完）。G1 負責看門。
  const ctx = await engine.launch().then(b => b.newContext({ locale: PAGE_LOCALE,
    ...(mobile ? { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true } : {}) }));
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
  await page.goto(`http://127.0.0.1:${PORT}/index.html?lang=${PAGE_LOCALE}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof baseLayers !== 'undefined' && baseLayers && baseLayers.light,
    null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(waitMs);   // OFM_HEALTH_MS = 8000,留足餘裕
  const got = await page.evaluate(() => ({
    // 量使用者**看得到過**的東西:曾經進到 DOM 的每一則 toast。不是量 ofmNoticeShown 這種
    // 內部旗標——那是實作的下游,會跟著實作一起錯(判準盲點:斷言落在受測物下游)。
    toasts: window.__seenToasts || [],
    // G1 用：證明下面每一條讀文案的判準是在【中文】頁面上量的
    lang: (window.__i18n && window.__i18n.lang) || null,
    langSample: window.__i18n ? window.__i18n.t('街道底圖載入異常，列車與路線不受影響。可切換到「衛星」底圖。') : null,
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
  // 🔴 具名前置閘門：下面所有讀 `notice` 的判準都在比中文字串，語系一漂它們會【一起】
  //    失效——而且失效的方向不一致（N 假紅、A／B／E 空過），從計分板上看不出共同上游。
  //    把前提單獨判一次，紅的時候一眼就知道是語系沒釘住。
  ok(`G1/${name} 語系釘死在 zh-TW（下面 notice 判準的前提）`,
    a.lang === 'zh-TW' && a.langSample === '街道底圖載入異常，列車與路線不受影響。可切換到「衛星」底圖。',
    `lang=${a.lang} sample=${String(a.langSample).slice(0, 24)}…`);
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

// ── 突變對照：證明 `notice` 這一族兩個方向都真的有牙 ────────────────────────
// 🔴 只跑一個引擎（下面會印出是哪個）：受測的是「判準會不會因為這個缺陷轉紅」，
//    而那與瀏覽器引擎無關；上面的功能判準才需要雙引擎。這是刻意的取捨，不是抽樣遺漏。
if (ENGINES.length) {
  const [mName, mEngine] = ENGINES[0];
  console.log(`\n──────── 突變對照（只跑 ${mName}）────────`);

  servedHtml = MUT_NOTICE_ON_FALLBACK;
  const p = await run(mEngine, { ofm: 'block' });          // 與 A 情境逐格相同
  ok(`P/${mName} 突變對照：退成功時也跳提示 ⇒ A 的「退成功不跳提示」必須轉紅`, p.notice,
    `舊行為下 notice=${p.notice} toasts=${JSON.stringify(p.toasts).slice(0, 90)}`);

  servedHtml = MUT_NO_NOTICE;
  const q = await run(mEngine, { ofm: 'block', carto: 'dead' }); // 與 N 情境逐格相同
  ok(`Q/${mName} 突變對照：提示整個不發 ⇒ N 的「兩家同時掛要講出來」必須轉紅`, !q.notice,
    `舊行為下 notice=${q.notice} toasts=${JSON.stringify(q.toasts).slice(0, 90)}`);

  servedHtml = null;
}

await new Promise(r => server.close(r));
const fail = R.filter(r => !r.pass).length;
console.log(`\n總計 ${R.length - fail}/${R.length} 通過`);
process.exit(fail ? 1 : 0);
