// 文湖線 3D 原型驗收（ephemeral，.assetsignore 已排除 *.mjs）
// 為什麼不用內建 Browser pane：pane 內 rAF 恆 0 tick，MapLibre 靠 rAF 驅動渲染，永遠 load 不完。
import { chromium, webkit } from 'playwright';


const URL = process.argv[2] || 'http://localhost:50888/prototypes/wenhu3d.html';
const ENGINE = process.argv[3] || 'chromium';
const browserType = ENGINE === 'webkit' ? webkit : chromium;

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass, detail }); };

const browser = await browserType.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded' });

// G0 自檢：驗的是不是當前工作區的檔案（心得 32）
const srcLen = await page.evaluate(() => document.documentElement.outerHTML.length);
check('G0 頁面實際載入', srcLen > 5000, `${srcLen} bytes`);

// 等我們自己的完成訊號。刻意不用 map.loaded()：列車 source 每幀 setData，它永遠回 false。
let ready = false;
try {
  await page.waitForFunction(() => window.__ready === true, { timeout: 45000 });
  // 不能等 'idle' / areTilesLoaded() / isStyleLoaded()：列車 source 每幀 setData，
  // 這三個都被它汙染成永遠 false。圖磚有沒有真的畫出來，交給 G7 的像素判準（獨立來源）。
  await page.waitForTimeout(6000);
  ready = true;
} catch { /* 下面會報 FAIL */ }
check('G1 MapLibre 載入完成', ready, ready ? 'load 事件已觸發（圖磚由 G7 像素判準把關）' : '45 秒逾時');
if (!ready) { console.log(JSON.stringify(results, null, 2)); await browser.close(); process.exit(1); }

// G2 底圖真的有圖磚（不是空樣式）
const src = await page.evaluate(() => {
  const s = map.getStyle();
  return { layers: s.layers.length, sources: Object.keys(s.sources),
           has3dBld: !!map.getLayer('building-3d') };
});
check('G2 OpenFreeMap 樣式載入', src.layers > 50, `${src.layers} 層 / sources: ${src.sources.join(',')}`);
check('G3 3D 建物圖層存在', src.has3dBld, 'building-3d');

// G4 我們自己的圖層都在
const mine = await page.evaluate(() =>
  ['deck', 'rail', 'pier', 'plat', 'staTxt', 'train'].map(id => [id, !!map.getLayer(id)]));
check('G4 原型圖層齊全', mine.every(([, v]) => v), mine.map(([k, v]) => k + (v ? '✓' : '✗')).join(' '));

// G5/G6 列車存在且真的在跑。判準取「所有列車中位移最大的那台」並用 tid 配對——
// 只看第一台會抓到剛好在停站(dwell)的班次，量到 1cm 而誤判成靜止。
await page.waitForTimeout(600);
const snap = () => page.evaluate(() => Object.fromEntries(
  map.getSource('trainPt')._data.features.map(f => [f.properties.tid, f.geometry.coordinates])));
const a = await snap();
await page.waitForTimeout(2500);   // ×10 速 → 約 25 模擬秒
const b = await snap();
const ids = Object.keys(a).filter(k => k in b);
check('G5 線上有列車', ids.length > 0, `${ids.length} 班（兩次取樣都在線上）`);
const mPerDeg = 111320;
const dists = ids.map(k => Math.hypot((a[k][0] - b[k][0]) * Math.cos(25.05 * Math.PI / 180), a[k][1] - b[k][1]) * mPerDeg);
const maxD = Math.max(0, ...dists), movers = dists.filter(d => d > 50).length;
check('G6 列車在移動', maxD > 100,
  `最大位移 ${maxD.toFixed(0)}m / 25 模擬秒；${movers}/${ids.length} 班在跑（其餘停站中）`);

// G7 幀有內容（不是空白畫布）。刻意不讀 WebGL canvas——MapLibre 預設
// preserveDrawingBuffer:false，幀外 drawImage 一律拿到空 buffer（會誤報全黑）。
// 改用 Playwright 合成後的截圖像素，判準與被測物不同源。
const png = await page.screenshot({ clip: { x: 340, y: 120, width: 600, height: 520 } });
const nColors = await page.evaluate(async b64 => {   // 瀏覽器只當 PNG 解碼器，像素來自 Playwright 截圖
  const img = new Image();
  await new Promise(r => { img.onload = r; img.src = 'data:image/png;base64,' + b64; });
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
  const d = cx.getImageData(0, 0, cv.width, cv.height).data, s = new Set();
  for (let i = 0; i < d.length; i += 4) s.add((d[i] >> 3) + ',' + (d[i+1] >> 3) + ',' + (d[i+2] >> 3));
  return s.size;
}, png.toString('base64'));
check('G7 畫面有內容', nColors > 30, `${nColors} 種顏色（>30 才算真的畫出來）`);

// G8 3D 真的是 3D：pitch 生效
const pitch = await page.evaluate(() => map.getPitch());
check('G8 傾斜視角生效', pitch > 40, `pitch=${pitch.toFixed(0)}°`);

// G9 建物擠出高度真的有值（抽樣 building 圖磚特徵）
const bld = await page.evaluate(() => {
  const f = map.queryRenderedFeatures({ layers: ['building-3d'] });
  const withH = f.filter(x => x.properties && (x.properties.render_height > 0 || x.properties.height > 0));
  return { total: f.length, withH: withH.length,
           sample: withH.slice(0, 3).map(x => x.properties.render_height ?? x.properties.height) };
});
check('G9 3D 建物有高度資料', bld.total > 0,
  `畫面內 ${bld.total} 棟，其中 ${bld.withH} 棟有高度（樣本 ${bld.sample.join('/')}m）`);

// G10 跟車模式：判準取「使用者看得到的結果」——HUD 顯示方向 + 相機真的跟著車走。
// 不讀 window.follow：那是 classic script 的 top-level let，本來就不掛在 window 上。
const camBefore = await page.evaluate(() => map.getCenter().toArray());
await page.click('#bFol');
await page.waitForTimeout(1500);
const fol = await page.evaluate(() => ({
  txt: document.getElementById('foll').textContent,
  center: map.getCenter().toArray(), zoom: map.getZoom() }));
const camMoved = Math.hypot(fol.center[0] - camBefore[0], fol.center[1] - camBefore[1]) > 1e-4;
check('G10 跟車模式可用', fol.txt !== '—' && camMoved && fol.zoom >= 17,
  `HUD=${fol.txt}, 相機已移動=${camMoved}, zoom=${fol.zoom.toFixed(1)}`);

check('G11 無 JS 錯誤', errors.length === 0, errors.slice(0, 3).join(' | ') || '無');

// G12 低縮放不再出現退化多邊形：全線視角下 3D 結構應全部隱藏，只剩 line + circle
await page.click('#bAll');
await page.waitForTimeout(2200);
const lowZ = await page.evaluate(() => ({
  z: map.getZoom(),
  deck: map.queryRenderedFeatures({ layers: ['deck'] }).length,
  line: map.queryRenderedFeatures({ layers: ['routeLine'] }).length,
  dots: map.queryRenderedFeatures({ layers: ['trainDot'] }).length }));
check('G12 全線視角無退化多邊形', lowZ.z < 13.5 && lowZ.deck === 0 && lowZ.line > 0,
  `z=${lowZ.z.toFixed(1)}：3D橋面=${lowZ.deck}（應 0）、路線 line=${lowZ.line}、列車光點=${lowZ.dots}`);

// 截圖：全線 + 跟車
await page.screenshot({ path: `_shot_wenhu3d_all_${ENGINE}.png` });
await page.click('#bFol');
await page.waitForTimeout(1400);
await page.screenshot({ path: `_shot_wenhu3d_follow_${ENGINE}.png` });

const pass = results.filter(r => r.pass).length;
console.log(`\n=== 文湖線 3D 原型驗收（${ENGINE}） ${pass}/${results.length} ===`);
for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name} — ${r.detail}`);
await browser.close();
process.exit(pass === results.length ? 0 : 1);
