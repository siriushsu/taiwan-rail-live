#!/usr/bin/env node
// 網站版 OpenFreeMap 失效時的處置驗收(npm run check-basemap)。
//
// 設計史三段,判準跟著換,舊判準不要再回來:
//  (1) fdf04b0:L2 的 ofmWatch 原本對網站整條 `if (!APP_CFG.tiles) return;`,OFM 半死時網站是零訊號
//      (空白底圖上飄著列車,連 console 都乾淨)⇒ 先補偵測與提示。
//  (2) 2026-08-26 裁示:網站可退回 CARTO raster ⇒ 這支當時的主判準是「真的打出 CARTO 圖磚請求」。
//  (3) 2026-08-31(a00237e):CARTO 對無金鑰請求回 **200＋壓著「API KEY REQUIRED」浮水印的圖磚**,退過去是
//      一張蓋章的地圖,而且 tileerror 一次都不會發 ⇒ 網站的 raster 退路整條拔除。**現行設計**(本檔驗的):
//        網站(無 APP_CFG.tiles):OFM 失效 ⇒ 只跳「街道底圖載入異常」提示;不掛任何 raster 層;
//                                零 CARTO、零 Stadia 圖磚請求。
//        App 殼(prepare-web.mjs 注入 window.RAIL_APP_CONFIG.tiles):OFM 失效 ⇒ 退回自家 Stadia raster,
//                                不跳網站那則提示。
//      2026-09-03(994e5d34)fail 裡再加一發 ofmFailBeacon 埋點——那是 verify_ofm_fallback_beacon.mjs 的事,
//      這裡只把它 stub 掉並印出發數,不判分。
//
// 🔴 判準的重心在**負向對照**:「出事就處置」的機制,最貴的假綠是它其實每次都處置——
//    網站那半＝每個訪客都看到一則嚇人的提示;App 那半＝所有人被靜默送去 Stadia(計費)而畫面完全正常。
//    所以 OFM 正常時要同時證明 (a) 提示 0 則、退路 0 發,與 (b) MapLibre 樣式真的載完了
//    (不是根本沒起來就算零)。OFM 正常用本機 stub(TileJSON＋204 空圖磚＋空 sprite＋1px 陰影圖磚)模擬,
//    不依賴真網路;OFM 失效用 abort 模擬。CARTO／Stadia／Esri 一律攔下回假 PNG,驗收不打任何一發真請求。
// 🔴 每一條判準都有一發突變指名考它(最後一段)。突變跑在記憶體裡的字串副本上,磁碟上的 index.html 不動;
//    跑完再用原檔跑一次控制組。
// 🔴 語系釘死 zh-TW(context locale ＋ ?lang=),否則提示會渲染成英文,下面所有讀文案的判準會一起失效
//    而且方向不一致(正判準假紅、`!notice` 型反判準恆真空過)。G1 單獨看門。
// 🔴 全程用 MutationObserver 錄下每一則 toast(toast 只活 5 秒),判準不綁在「剛好那一刻畫面上有什麼」。
//
// 用法:node scripts/verify_web_basemap_notice.mjs      WEBNOTICE_ENGINES=chromium 只跑一個引擎
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
// 下面四個片段同時是 G0 的釘子與突變的落點:index.html 這幾行一改,這裡先紅(驗錯目標或改動沒落地),
// 不會靜默量到別的東西。
const FAIL_LINE = '  const fail = why => { stop(); ofmFailBeacon(why); if (APP_CFG.tiles) ofmFallToRaster(why); else ofmNoticeWeb(why); };';
const ARM_APP_ONLY = '      if (APP_CFG.tiles) {\n        if (!ofmRasterFallback) ofmRasterFallback = {};\n        ofmRasterFallback[k] = () => L.tileLayer(t.url, opt);';
const SETTLE_ON_LOAD = "    if (gl.isStyleLoaded && gl.isStyleLoaded()) stop(); else gl.once('load', stop);";
const NOTICE_HEAD = 'function ofmNoticeWeb(why) {\n  if (ofmNoticeShown) return;';
for (const [frag, why] of [
  ['function ofmWatch(layer) {', 'L2 監看還在'],
  [FAIL_LINE, 'fail:先埋點,App 退 raster／網站只提示'],
  [ARM_APP_ONLY, 'raster 退路 thunk 只有 App 會備'],
  [SETTLE_ON_LOAD, '樣式載完就收手(偵測器的「正常」出口)'],
  [NOTICE_HEAD, '網站提示函式(一個 session 只講一次)'],
]) if (!src.includes(frag)) { console.error(`❌ [G0] 這份 index.html 沒有「${why}」(${frag.trim().slice(0, 70)})——驗錯目標或改動沒落地`); process.exit(1); }
console.log('[G0] 現行設計的四個關節都在這份檔裡');

// ── 突變(記憶體字串副本;每一發指名考哪一條判準)──────────────────────────
const mutate = (name, pairs) => pairs.reduce((out, [from, to]) => {
  const next = out.replace(from, to);
  if (next === out) { console.error(`❌ 突變 ${name} 沒有命中:${from.trim().slice(0, 60)}`); process.exit(1); }
  return next;
}, src);
// P:08-26 的舊設計復活——網站也備 CARTO thunk、fail 時也退 raster(提示照跳,所以只有「零 raster」那條該紅)
const MUT_WEB_RASTER = mutate('P web-raster-fallback', [
  [ARM_APP_ONLY, ARM_APP_ONLY.replace('if (APP_CFG.tiles) {', 'if (true) { // MUTATION web-raster-fallback')],
  [FAIL_LINE, FAIL_LINE.replace('if (APP_CFG.tiles) ofmFallToRaster(why); else ofmNoticeWeb(why);',
    'ofmFallToRaster(why); if (!APP_CFG.tiles) ofmNoticeWeb(why); /* MUTATION web-raster-fallback */')],
]);
// Q:提示整個不發
const MUT_NO_NOTICE = mutate('Q no-notice', [[NOTICE_HEAD, 'function ofmNoticeWeb(why) {\n  if (true) return; // MUTATION no-notice\n  if (ofmNoticeShown) return;']]);
// S:偵測器壞掉——樣式載完也不收手,8 秒一到一律 fail('slow')。這就是「每次都處置」那個最貴假綠的具體形狀。
const MUT_NEVER_SETTLE = mutate('S never-settle', [[SETTLE_ON_LOAD, '    /* MUTATION never-settle */']]);
// T:App 不退 raster
const MUT_APP_NO_FALLBACK = mutate('T app-no-fallback', [[FAIL_LINE, FAIL_LINE.replace(
  'if (APP_CFG.tiles) ofmFallToRaster(why); else ofmNoticeWeb(why);', 'if (!APP_CFG.tiles) ofmNoticeWeb(why); /* MUTATION app-no-fallback */')]]);

// ── 本機 server ──────────────────────────────────────────────────────────────
const PAGE_LOCALE = 'zh-TW';
const PORT = Number(process.env.WEBNOTICE_PORT || 43977);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const TILEJSON = JSON.stringify({ tilejson: '2.2.0', tiles: ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 });
let servedHtml = null; // null＝供磁碟上那份(G0 已證明是這棵樹的);突變時換成改過的字串
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

// ── 一個情境 ─────────────────────────────────────────────────────────────────
// ofm: 'block'=全擋(OFM 掛掉) | 'stub'=本機假 OFM(TileJSON＋204 空圖磚＋空 sprite,讓 MapLibre 的 load 真的發)
// sat: true=/api/basemap-token 給假 token(衛星鈕留著) | false=404(鈕被 remove ⇒ 提示改說重新整理)
async function run(browser, { ofm, appShell = false, sat = true, mobile = false, waitMs = 12000 }) {
  const ctx = await browser.newContext({ locale: PAGE_LOCALE,
    ...(mobile ? { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true } : {}) });
  const errs = [], hits = { ofm: 0, ofmTileJson: 0, carto: 0, stadia: 0, beacon: 0 };
  await ctx.route('**://tiles.openfreemap.org/**', r => {
    hits.ofm++;
    if (ofm === 'block') return r.abort('failed');
    const u = r.request().url();
    if (/\/planet\/?(\?|$)/.test(u)) { hits.ofmTileJson++; return r.fulfill({ status: 200, contentType: 'application/json', body: TILEJSON }); }
    if (/\.pbf(\?|$)/.test(u)) return r.fulfill({ status: 204, body: '' }); // 向量圖磚與字形:空
    if (/\/sprites\/.*\.json(\?|$)/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (/\.png(\?|$)/.test(u)) return r.fulfill({ status: 200, contentType: 'image/png', body: PNG }); // sprite 圖與 natural_earth 陰影圖磚
    return r.fulfill({ status: 404, body: 'nf' });
  });
  // 🔴 CARTO／Stadia／Esri 一律攔:CARTO 沒有授權、Stadia 與 Esri 計費,驗收不對它們打任何一發真請求。
  //    前兩個計數器就是主判準——「圖層物件是不是 raster」只是實作的下游:圖層建好但一張都沒送出去
  //    也照樣像是退成功了;反過來,網站「零 raster」要看的也是零請求。
  await ctx.route('**://*.basemaps.cartocdn.com/**', r => { hits.carto++; r.fulfill({ status: 200, contentType: 'image/png', body: PNG }); });
  await ctx.route('**://tiles.stadiamaps.com/**', r => { hits.stadia++; r.fulfill({ status: 200, contentType: 'image/png', body: PNG }); });
  await ctx.route('**://ibasemaps-api.arcgis.com/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  // /api/* 一律攔。🔴 其餘端點回 404 而不是 200 {}:前端資料源是「apiUrl 優先、data/*.json 退路」,
  //    回一個成功但空的 200 會讓它以為拿到了 ⇒ boot 拋錯;404 才會走磁碟上那份真資料。
  await ctx.route('**/api/**', r => {
    const u = r.request().url();
    if (u.includes('basemap-fallback')) { hits.beacon++; return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
    if (u.includes('basemap-token')) return sat
      ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"esri":"TESTTOKEN"}' })
      : r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_configured"}' });
    return r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"stubbed"}' });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  // App 分支:同一份 index.html,靠注入 window.RAIL_APP_CONFIG 走 APP_CFG.tiles 那條路(正式由 prepare-web.mjs 注入)
  if (appShell) await page.addInitScript(() => {
    window.RAIL_APP_CONFIG = { streetSrc: 'ofm', tiles: {
      light: { url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png', maxZoom: 20, attribution: 'test' },
      dark: { url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', maxZoom: 20, attribution: 'test' },
    } };
  });
  // 全程錄下每一則 toast。addInitScript 跑在 document_start,那一刻 documentElement 可能還是 null
  // (兩個引擎都會拋 "parameter 1 is not of type 'Node'"),輪詢到它出現再掛。
  await page.addInitScript(() => {
    window.__seenToasts = [];
    const grab = n => {
      if (!n || n.nodeType !== 1) return;
      if (n.classList && n.classList.contains('toast')) window.__seenToasts.push((n.textContent || '').trim());
      if (n.querySelectorAll) for (const c of n.querySelectorAll('.toast')) window.__seenToasts.push((c.textContent || '').trim());
    };
    const mo = new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) grab(n); });
    const arm = () => document.documentElement
      ? mo.observe(document.documentElement, { childList: true, subtree: true })
      : setTimeout(arm, 0);
    arm();
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html?lang=${PAGE_LOCALE}`, { waitUntil: 'domcontentloaded' });
  const booted = await page.waitForFunction(() => typeof baseLayers !== 'undefined' && baseLayers && baseLayers.light, null, { timeout: 30000 })
    .then(() => true).catch(() => false);
  await page.waitForTimeout(waitMs); // OFM_HEALTH_MS = 8000 自圖層上場起算,留足餘裕
  const got = await page.evaluate(() => {
    const bl = (typeof baseLayers !== 'undefined' && baseLayers) ? baseLayers : {};
    const l = bl.light, onMap = [bl.light, bl.dark].find(x => x && x._glMap), gl = onMap && onMap._glMap;
    const tileLayersOnMap = (typeof window.__map !== 'undefined' && window.__map && window.__map._layers)
      ? Object.values(window.__map._layers).filter(x => x instanceof L.TileLayer && typeof x._url === 'string').map(x => x._url) : [];
    return {
      // 量使用者**看得到過**的東西:曾經進到 DOM 的每一則 toast。不是量 ofmNoticeShown 這種內部旗標——
      // 那是實作的下游,會跟著實作一起錯。
      toasts: window.__seenToasts || [],
      lang: (window.__i18n && window.__i18n.lang) || null,
      langSample: window.__i18n ? window.__i18n.t('街道底圖載入異常，列車與路線不受影響。可切換到「衛星」底圖。') : null,
      satBtn: !!document.getElementById('satBtn'),
      layerKind: !l ? 'none' : (typeof l._url === 'string' ? 'raster' : 'ofm'),
      layerUrl: (l && typeof l._url === 'string') ? l._url : '',
      streetRasterOnMap: tileLayersOnMap.filter(u => /cartocdn|stadiamaps/.test(u)),
      glLoaded: !!(gl && gl.isStyleLoaded && gl.isStyleLoaded()),
      armed: typeof ofmRasterFallback !== 'undefined' && ofmRasterFallback !== null,
    };
  }).catch(e => ({ evalError: String(e).slice(0, 120), toasts: [], lang: null, langSample: null, satBtn: false,
    layerKind: 'evalfail', layerUrl: '', streetRasterOnMap: [], glLoaded: false, armed: false }));
  await ctx.close();
  return { ...got, booted, errs, hits };
}

// ── 判準:寫成函式,正向情境與突變對照用同一把尺——突變「必須轉紅」就是同一個函式回 false ──
const NOTICE_RE = /街道底圖載入異常/;
const noticeTexts = r => r.toasts.filter(t => NOTICE_RE.test(t));
const crit = {
  notice: r => noticeTexts(r).length > 0,                                                       // 網站:要把話講出來
  webNoRaster: r => r.layerKind === 'ofm' && r.streetRasterOnMap.length === 0 && r.hits.carto === 0 && r.hits.stadia === 0, // 網站:不掛 raster、零請求
  appStadia: r => r.layerKind === 'raster' && /stadiamaps/.test(r.layerUrl) && r.hits.stadia > 0,   // App:退到自家 Stadia
  appIdle: r => r.hits.stadia === 0 && r.layerKind === 'ofm' && r.armed && noticeTexts(r).length === 0, // App:OFM 正常就不動
  ofmLive: r => r.glLoaded && r.hits.ofmTileJson > 0,                                            // 負向對照的牙:樣式真的載完
};
const R = [];
const ok = (id, pass, detail) => { R.push({ id, pass }); console.log(`${pass ? '✅' : '❌'} ${id} — ${detail}`); };
const note = (id, detail) => console.log(`ℹ️  ${id} — ${detail}`);
const detail = r => `layer=${r.layerKind}${r.layerUrl ? '(' + r.layerUrl.replace(/^https:\/\//, '').slice(0, 34) + ')' : ''}`
  + ` carto=${r.hits.carto} stadia=${r.hits.stadia} ofm=${r.hits.ofm}(tilejson ${r.hits.ofmTileJson}) beacon=${r.hits.beacon}`
  + ` gl=${r.glLoaded} armed=${r.armed} satBtn=${r.satBtn} boot=${r.booted} toasts=${JSON.stringify(r.toasts).slice(0, 80)}`
  + `${r.errs.length ? ' pageerror=' + r.errs[0] : ''}${r.evalError ? ' eval=' + r.evalError : ''}`;

// 預設兩引擎都跑;突變測試/快速迭代時用 WEBNOTICE_ENGINES=chromium 只跑一個
const ENGINES = [['chromium', chromium], ['webkit', webkit]]
  .filter(([n]) => !process.env.WEBNOTICE_ENGINES || process.env.WEBNOTICE_ENGINES.split(',').includes(n));
for (const [name, engine] of ENGINES) {
  console.log(`\n──────── ${name} ────────`);
  const browser = await engine.launch();
  try {
    const w = await run(browser, { ofm: 'block' });
    // 🔴 具名前置閘門:下面所有讀 notice 的判準都在比中文字串,語系一漂它們會一起失效,而且方向不一致
    //    (W1 假紅、N1／A3 空過),從計分板上看不出共同上游。把前提單獨判一次,紅的時候一眼就知道是語系沒釘住。
    ok(`G1/${name} 語系釘死在 zh-TW(下面所有讀文案判準的前提)`,
      w.lang === 'zh-TW' && w.langSample === '街道底圖載入異常，列車與路線不受影響。可切換到「衛星」底圖。',
      `lang=${w.lang} sample=${String(w.langSample).slice(0, 24)}…`);
    ok(`W1/${name} 網站 OFM 全擋 ⇒ 提示要出現,且有衛星鈕時指去衛星`,
      crit.notice(w) && w.satBtn && noticeTexts(w).some(t => /可切換到「衛星」底圖/.test(t)), detail(w));
    ok(`W2/${name} 網站 OFM 全擋 ⇒ 不掛 raster、零 CARTO、零 Stadia`, crit.webNoRaster(w), detail(w));
    ok(`W3/${name} boot 沒拋錯`, w.errs.length === 0, w.errs.join(' | ') || '0');
    note(`W/${name} 埋點`, `basemap-fallback 發數=${w.hits.beacon}(判分在 verify_ofm_fallback_beacon.mjs)`);

    // 🔴🔴 負向對照:全檔最重要的兩條。N1 紅＝每個訪客都看到嚇人的提示;N2 紅＝網站有東西在偷偷退路。
    const n = await run(browser, { ofm: 'stub' });
    ok(`N1/${name} OFM 正常 ⇒ 不跳提示`, !crit.notice(n), detail(n));
    ok(`N2/${name} OFM 正常 ⇒ 零 CARTO、零 Stadia、仍在 OFM`, crit.webNoRaster(n), detail(n));
    ok(`N3/${name} 負向對照有牙:MapLibre 樣式真的載完(不是根本沒起來就算零)`, crit.ofmLive(n), detail(n));

    // 衛星鈕的有無不該影響「講不講」,但要影響「講什麼」:Esri token 要不到時 #satBtn 被 remove,
    // 提示就不能叫使用者去點一顆不存在的鈕。
    // 文案取決於提示發出那一刻 #satBtn 在不在:OFM_HEALTH_MS(8 秒)遠大於 token 往返所以穩定;把那個常數調小,
    // D1 會以「文案不對」的形狀先紅(fresh-context 驗收把它壓到 1ms 時實測如此)。
    const d = await run(browser, { ofm: 'block', sat: false });
    ok(`D1/${name} 沒有衛星鈕 ⇒ 提示改說「重新整理即可重試」,不提衛星`,
      !d.satBtn && crit.notice(d) && noticeTexts(d).every(t => /重新整理即可重試/.test(t) && !/衛星/.test(t)), detail(d));
    ok(`D2/${name} 沒有衛星鈕也照樣不掛 raster`, crit.webNoRaster(d), detail(d));

    const m = await run(browser, { ofm: 'block', mobile: true });
    ok(`M1/${name} 手機 375 ⇒ 同樣只提示不退`, crit.notice(m) && crit.webNoRaster(m), detail(m));

    // 🔴 App 分支的回歸對照:同一份 index.html,注入 APP_CFG.tiles。App 必須退到自己的 Stadia、一發 CARTO 都不打
    //    (App 包內禁止出現 CARTO 網址,app/scripts/verify-release.mjs 有硬檢查)、也不跳網站那則提示。
    const a = await run(browser, { ofm: 'block', appShell: true });
    ok(`A1/${name} App 殼 OFM 全擋 ⇒ 退到自家 Stadia(有打出圖磚請求)`, crit.appStadia(a), detail(a));
    ok(`A2/${name} App 殼 ⇒ 一發 CARTO 都沒打`, a.hits.carto === 0, detail(a));
    ok(`A3/${name} App 殼 ⇒ 不跳網站的提示`, !crit.notice(a), detail(a));

    const h = await run(browser, { ofm: 'stub', appShell: true });
    ok(`H1/${name} App 殼 OFM 正常 ⇒ 零 Stadia、仍在 OFM、退路待命、不跳提示`, crit.appIdle(h), detail(h));
    ok(`H2/${name} 負向對照有牙:MapLibre 樣式真的載完`, crit.ofmLive(h), detail(h));
  } finally { await browser.close(); }
}

// ── 突變對照:每一發指名考一條判準,那條必須轉紅 ──────────────────────────────
// 🔴 只跑一個引擎(下面印出是哪個):受測的是「判準會不會因為這個缺陷轉紅」,與瀏覽器引擎無關;
//    上面的功能判準才需要雙引擎。這是刻意的取捨,不是抽樣遺漏。
if (ENGINES.length) {
  const [mName, mEngine] = ENGINES[0];
  console.log(`\n──────── 突變對照(只跑 ${mName};改的是記憶體副本,磁碟上的 index.html 不動)────────`);
  const browser = await mEngine.launch();
  try {
    servedHtml = MUT_WEB_RASTER;
    const p = await run(browser, { ofm: 'block' });
    ok(`P/${mName} 突變:08-26 舊設計復活(網站也退 CARTO)⇒ W2「不掛 raster、零 CARTO」必須轉紅`, !crit.webNoRaster(p), detail(p));
    note(`P/${mName}`, `提示仍照跳(notice=${crit.notice(p)}),所以這發只考 W2、不考 W1`);

    servedHtml = MUT_NO_NOTICE;
    const q = await run(browser, { ofm: 'block' });
    ok(`Q/${mName} 突變:提示整個不發 ⇒ W1「提示要出現」必須轉紅`, !crit.notice(q), detail(q));

    servedHtml = MUT_NEVER_SETTLE;
    const s1 = await run(browser, { ofm: 'stub' });
    ok(`S1/${mName} 突變:偵測器永不收手(樣式載完也當失敗)⇒ N1「OFM 正常不跳提示」必須轉紅`, crit.notice(s1) && crit.ofmLive(s1), detail(s1));
    const s2 = await run(browser, { ofm: 'stub', appShell: true });
    ok(`S2/${mName} 同一發突變 ⇒ H1「OFM 正常 App 不動」必須轉紅(所有人被靜默送去 Stadia)`, !crit.appIdle(s2) && s2.hits.stadia > 0, detail(s2));

    servedHtml = MUT_APP_NO_FALLBACK;
    const t = await run(browser, { ofm: 'block', appShell: true });
    ok(`T/${mName} 突變:App 不退 raster ⇒ A1「退到 Stadia」必須轉紅`, !crit.appStadia(t), detail(t));

    // 控制組:還原成磁碟上那份再跑一次,證明上面的紅是突變造成的、不是 harness 在中途壞掉。
    // 🔴 R 讀的是磁碟版:它紅＝磁碟上的 index.html 本身就過不了 W1／W2(產品回歸),不是 harness 壞掉——先看 W1／W2 是不是也紅。
    servedHtml = null;
    const c = await run(browser, { ofm: 'block' });
    ok(`R/${mName} 控制組:還原後 W1／W2 回綠`, crit.notice(c) && crit.webNoRaster(c), detail(c));
  } finally { await browser.close(); }
}

await new Promise(r => server.close(r));
const fail = R.filter(r => !r.pass).length;
console.log(`\n總計 ${R.length - fail}/${R.length} 通過`);
process.exit(fail ? 1 : 0);
