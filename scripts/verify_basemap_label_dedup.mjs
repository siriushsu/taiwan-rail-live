// 底圖標籤跟站名去重的驗收（index.html 的 glPlaceDedupSync）：地名（place 圖層）與機場（aerodrome_label 圖層）。
// 用法：node scripts/verify_basemap_label_dedup.mjs
//   預設自己起純靜態伺服器服務這棵樹（PORT=0 由系統挑空埠，/api/* 一律 503）；BASE_URL=... 改打別處（例如預覽網址）。
//   瀏覽器一律無視窗：Chrome channel:'chrome'＋headless:true（使用者 2026-09-23 裁示，有視窗會搶焦點）。
// 判準都是「真的畫出來的東西」：底圖用 queryRenderedFeatures，站名用 labelBoxes（tryLabel 這一幀真的畫了的站名）。
// 每個「底圖標籤不畫」都配一個同地點、拉遠到站名還沒畫的「照樣畫」，以及「圖磚裡確實有這筆」的前提，
// 空結果不會被當成通過。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.bin': 'application/octet-stream', '.gz': 'application/gzip', '.webp': 'image/webp', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.geojson': 'application/geo+json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.tsv': 'text/tab-separated-values' };
let base = process.env.BASE_URL, server = null;
if (!base) {
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) { res.statusCode = 503; res.setHeader('content-type', 'application/json'); return res.end('{}'); }
    let fp = path.join(ROOT, decodeURIComponent(url.pathname));
    if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
    if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
    res.end(readFileSync(fp));
  });
  await new Promise(r => server.listen(+(process.env.PORT || 0), '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
}

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : ' ' + JSON.stringify(detail))); };
const TAG = '__rail_place_dedup__'; // index.html 的 PLACE_DEDUP_TAG
const TSA = '臺北松山機場', KHH = '高雄國際機場', TPE = '臺灣桃園國際機場';
const flat = (center, zoom) => ({ center, zoom, pitch: 0, bearing: 0 });
const USER_CAM = { center: [121.525, 25.035], zoom: 12.4, pitch: 55, bearing: -10 }; // 2026-09-29 回報的鏡頭（v0929d、地景、全畫面）

async function boot(p, kind) {
  await p.goto(base + '?map=' + kind + '&lang=zh-TW');
  await p.waitForFunction(k => typeof M !== 'undefined' && M && M.getStyleKind && M.getStyleKind() === k && M.isStyleReady() && typeof state !== 'undefined' && state.ready, kind, { timeout: 90000 });
  await p.evaluate(() => { state.playing = false; });
}
async function settle(p) {
  await p.waitForFunction(() => M.raw.loaded() && M.raw.areTilesLoaded() && !M.raw.isMoving(), null, { timeout: 60000 });
  await p.waitForTimeout(1200); // 讓 draw() 跑幾幀、符號重新擺放
  await p.waitForFunction(() => M.raw.loaded() && M.raw.areTilesLoaded(), null, { timeout: 60000 });
}
// 看一個鏡頭：sourceLayer 那一類圖層實際畫出哪些名字、圖磚裡有沒有 label 這筆、站名排程要畫（decoLabels）與真的畫了（labelBoxes）
async function look(p, cam, sourceLayer, label, station) {
  await p.evaluate(c => M.raw.jumpTo(c), cam);
  await settle(p);
  return p.evaluate(([sourceLayer, label, station, TAG]) => {
    const nm = f => f.properties['name:nonlatin'] || f.properties['name:zh'] || f.properties.name;
    const layers = M.raw.getStyle().layers.filter(l => l.type === 'symbol' && l['source-layer'] === sourceLayer).map(l => l.id);
    return {
      zoom: +M.raw.getZoom().toFixed(2), layers: layers.length,
      rendered: layers.length ? M.raw.queryRenderedFeatures({ layers }).map(nm).includes(label) : false,
      inTiles: M.raw.querySourceFeatures('openmaptiles', { sourceLayer }).some(f => nm(f) === label),
      scheduled: state.mode !== 'sched' ? null : decoLabels.some(d => d.name === station) || (state.schedStations || []).some(s => s.name === station && M.getZoom() >= TIER_STYLE[s.tier == null ? 4 : s.tier].lz),
      drawn: labelBoxes.some(b => b.name === station),
      tags: layers.map(id => JSON.stringify(M.raw.getFilter(id)).split(TAG).length - 1),
    };
  }, [sourceLayer, label, station, TAG]);
}
// 「不畫」：圖磚有這筆、站名此刻有畫（或至少排程要畫），圖層卻沒畫出來
function hidden(name, r, needDrawn = true) {
  check(name, r.layers > 0 && r.inTiles && (needDrawn ? r.drawn : r.scheduled) && !r.rendered, r);
}
// 「照樣畫」：站名還沒到畫的縮放，底圖標籤要看得到
function shown(name, r) {
  check(name, r.layers > 0 && r.inTiles && !r.scheduled && !r.drawn && r.rendered, r);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 945 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-appearance', 'light'); } catch (e) {} });
  const p = await ctx.newPage();
  const errors = [], warns = [];
  p.on('pageerror', e => errors.push(e.message));
  // 只收機場比對的 slice 遇到非字串時會發的那種；「Expected value to be of type number, but found null」是底圖樣式本身
  // 既有的（拿掉 glPlaceDedupSync 呼叫照樣出現，09-29 A/B 實測），不歸這裡管
  p.on('console', m => { if (m.type() === 'warning' && /array or string/i.test(m.text())) warns.push(m.text().slice(0, 200)); });
  await p.route('**/api/**', r => r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await boot(p, 'landscape');
  console.log('受測：' + base + (server ? '（' + ROOT + '）' : '') + ' BUILD=' + await p.evaluate(() => BUILD));
  await p.click('#fsFab');
  check('全畫面', await p.evaluate(() => document.body.classList.contains('fs')));

  // ── 地名（place）回歸對照：竹北站旁的「竹北市」（9/25 原案）。竹北 tier 3，app z12（MapLibre 11）起畫站名
  const zb = await p.evaluate(() => { const s = state.schedStations.find(s => s.name === '竹北'); return [s.lon, s.lat]; });
  hidden('P1 地景 竹北站名畫出時不畫「竹北市」(z11.5)', await look(p, flat(zb, 11.5), 'place', '竹北市', '竹北'));
  shown('P2 地景 拉遠到站名未畫時「竹北市」照樣畫(z10.5)', await look(p, flat(zb, 10.5), 'place', '竹北市', '竹北'));

  // ── 機場（aerodrome_label）：文湖線松山機場站 vs 底圖「臺北松山機場」（名稱多了城市前綴）
  // 回報的鏡頭（pitch 55）：站名在這一級排程要畫，但會不會真的畫取決於站名互相讓位與視窗大小，所以只要求排程
  hidden('A1 地景 回報鏡頭：「臺北松山機場」不畫', await look(p, USER_CAM, 'aerodrome_label', TSA, '松山機場'), false);
  shown('A2 地景 回報鏡頭拉遠到 z11.5：站名未畫，「臺北松山機場」照樣畫', await look(p, { ...USER_CAM, zoom: 11.5 }, 'aerodrome_label', TSA, '松山機場'));
  const tsa = [121.5539, 25.0675];
  hidden('A3 地景 松山機場站名真的畫出時不畫「臺北松山機場」(z12.4)', await look(p, flat(tsa, 12.4), 'aerodrome_label', TSA, '松山機場'));
  shown('A4 地景 同點 z11.5：站名未畫，「臺北松山機場」照樣畫', await look(p, flat(tsa, 11.5), 'aerodrome_label', TSA, '松山機場'));
  // 高捷紅線高雄國際機場站：與底圖同名
  const khh = [120.3485, 22.5753];
  hidden('K1 地景 高雄國際機場站名畫出時不畫底圖「高雄國際機場」(z12.4)', await look(p, flat(khh, 12.4), 'aerodrome_label', KHH, '高雄國際機場'));
  shown('K2 地景 同點 z11.5：站名未畫，底圖「高雄國際機場」照樣畫', await look(p, flat(khh, 11.5), 'aerodrome_label', KHH, '高雄國際機場'));
  // 反向對照：名稱不同的不去重——機捷「機場第二航廈站」旁的「臺灣桃園國際機場」照畫（避免規則變成「機場一律不畫」）
  const tpe = await look(p, flat([121.2328, 25.0789], 12.4), 'aerodrome_label', TPE, '機場第二航廈站');
  check('N1 地景 不同名的「臺灣桃園國際機場」不受影響(z12.4，旁邊機捷站名有畫)', tpe.inTiles && tpe.drawn && tpe.rendered, tpe);

  // ── 與 rail-3d station-layer 共存：它拿自己記下的原始 filter 重組，會把我們那條洗掉或包進它的 all
  await p.evaluate(c => M.raw.jumpTo(c), flat(tsa, 12.4)); await settle(p);
  const original = await p.evaluate(() => JSON.parse(JSON.stringify(M.raw.getStyle().layers.find(l => l.id === 'airport').filter)));
  await p.evaluate(() => M.raw.setFilter('airport', ['all', ['has', 'iata']], { validate: false })); // 模擬 station-layer 蓋回原始值
  await p.waitForFunction(TAG => JSON.stringify(M.raw.getFilter('airport')).split(TAG).length - 1 === 1, TAG, { timeout: 10000 }).catch(() => {});
  const c1 = await look(p, flat(tsa, 12.4), 'aerodrome_label', TSA, '松山機場');
  check('C1 機場圖層 filter 被蓋回原始值後下一幀補回、恰一條', c1.tags.every(n => n === 1) && c1.drawn && !c1.rendered, { ...c1, original });
  const box = [[[120.0, 22.0], [120.01, 22.0], [120.01, 22.01], [120.0, 22.01], [120.0, 22.0]]]; // 遠在台灣西南海上的小方塊：不影響松山
  await p.evaluate(box => M.raw.setFilter('airport', ['all', M.raw.getFilter('airport'), ['!', ['within', { type: 'Polygon', coordinates: box }]]], { validate: false }), box);
  await p.waitForFunction(TAG => { const f = JSON.stringify(M.raw.getFilter('airport')); return f.split(TAG).length - 1 === 1 && f.includes('"within"'); }, TAG, { timeout: 10000 }).catch(() => {});
  const c2 = await look(p, flat(tsa, 12.4), 'aerodrome_label', TSA, '松山機場');
  const c2f = await p.evaluate(() => JSON.stringify(M.raw.getFilter('airport')));
  check('C2 機場圖層 filter 被包進別人的 all 後剝掉舊的那條、恰一條、別人的條件保留', c2.tags.every(n => n === 1) && c2f.includes('"within"') && c2.drawn && !c2.rendered, c2);
  // 有 iata、沒有名字的機場（OFM 全台目前沒有，用探針）：機場那條用 slice 比對名字結尾，遇到 null 會拋錯，
  // 整條 filter 退回 false、連圖示都不畫。探針套機場圖層此刻的 filter，放在松山機場站旁
  const probe = await p.evaluate(async () => {
    const raw = M.raw, at = [121.5539, 25.0675];
    raw.addSource('dedup-probe', { type: 'geojson', data: { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { iata: 'ZZZ' }, geometry: { type: 'Point', coordinates: [at[0] + 0.004, at[1]] } },
      { type: 'Feature', properties: { iata: 'ZZY', name: '臺北松山機場' }, geometry: { type: 'Point', coordinates: [at[0] - 0.004, at[1]] } },
    ] } });
    raw.addLayer({ id: 'dedup-probe', type: 'symbol', source: 'dedup-probe', filter: raw.getFilter('airport'), layout: { 'icon-image': 'airport_11', 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
    let got = [];
    for (let i = 0; i < 60 && !got.length; i++) { await new Promise(r => setTimeout(r, 150)); got = raw.queryRenderedFeatures({ layers: ['dedup-probe'] }).map(f => f.properties.iata); }
    await new Promise(r => setTimeout(r, 600)); got = raw.queryRenderedFeatures({ layers: ['dedup-probe'] }).map(f => f.properties.iata);
    raw.removeLayer('dedup-probe'); raw.removeSource('dedup-probe');
    return [...new Set(got)].sort();
  });
  check('U1 沒有名字的機場照樣畫、同名的照樣藏（探針）', JSON.stringify(probe) === '["ZZZ"]', probe);

  // ── 淺色街圖（positron）也有同一個 airport 圖層
  await p.evaluate(() => chooseBasemap('light'));
  await p.waitForFunction(() => M.getStyleKind() === 'light' && M.isStyleReady(), null, { timeout: 60000 });
  hidden('L1 淺色 松山機場站名畫出時不畫「臺北松山機場」(z12.4)', await look(p, flat(tsa, 12.4), 'aerodrome_label', TSA, '松山機場'));
  shown('L2 淺色 z11.5：站名未畫，「臺北松山機場」照樣畫', await look(p, flat(tsa, 11.5), 'aerodrome_label', TSA, '松山機場'));
  hidden('L3 淺色 竹北站名畫出時不畫「竹北市」(z11.5)', await look(p, flat(zb, 11.5), 'place', '竹北市', '竹北'));
  check('桌面 無頁面錯誤、無 filter 運算式警告', !errors.length && !warns.length, { errors, warns });
  await ctx.close();

  // ── 手機（觸控、窄螢幕；手機殼一律全畫面）
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei', isMobile: true, hasTouch: true });
  await mctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-appearance', 'light'); } catch (e) {} });
  const m = await mctx.newPage();
  const merr = []; m.on('pageerror', e => merr.push(e.message));
  await m.route('**/api/**', r => r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await boot(m, 'landscape');
  hidden('M1 手機 390 地景 松山機場站名畫出時不畫「臺北松山機場」(z12.4)', await look(m, flat(tsa, 12.4), 'aerodrome_label', TSA, '松山機場'));
  shown('M2 手機 390 地景 z11.5：站名未畫，「臺北松山機場」照樣畫', await look(m, flat(tsa, 11.5), 'aerodrome_label', TSA, '松山機場'));
  check('手機 無頁面錯誤', !merr.length, merr);
  await mctx.close();
} catch (e) {
  check('流程', false, String(e.stack || e));
} finally {
  await browser.close();
  if (server) server.close();
}
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通過` + (failed.length ? '；未過：' + failed.map(r => r.name).join('、') : ''));
process.exit(failed.length ? 1 : 0);
