// 拍影片素材：用真實原型的畫面（4 倍解析度），輸出到 film/assets/（不進版控）。
// 影片裡所有介面畫面都來自這裡：整頁截圖放進手機框，放大特寫則是從同一張截圖裁切（座標見 film.html 的 LENS）。
// 用法：node prototypes/ride-guide/film/capture_assets.mjs（需 playwright 或 PLAYWRIGHT_MODULE）
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, 'assets');
await mkdir(out, { recursive: true });
let pw;
try { pw = await import('playwright'); } catch { pw = await import(process.env.PLAYWRIGHT_MODULE); }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = normalize(decodeURIComponent(u.pathname)).replace(/^\/+/, '');
  if (!p || p.endsWith('/')) p += 'index.html';
  const f = join(root, p);
  if (!f.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }).end(await readFile(f)); }
  catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const SHOTS = [
  ['entry', { screen: 'entry' }],
  ['journey', { line: 'pingxi', train: '4816', via: 'car' }],
  ['along', { line: 'pingxi', train: '4816', view: 'along', scroll: 'content' }],
  ['shifen-top', { line: 'pingxi', train: '4816', dest: 'shifen', scroll: 'content' }],
  ['shifen-hl', { line: 'pingxi', train: '4816', dest: 'shifen', scroll: 'sec-highlights' }],
  ['shifen-routes', { line: 'pingxi', train: '4816', dest: 'shifen', scroll: 'sec-routes' }],
  ['shifen-shops', { line: 'pingxi', train: '4816', dest: 'shifen', scroll: 'sec-shops' }],
  ['shifen-story', { line: 'pingxi', train: '4816', dest: 'shifen', scroll: 'sec-stories', sheet: { kind: 'station-story', id: 'shifen:film' } }],
  ['shifen-next', { line: 'pingxi', train: '4816', dest: 'shifen', scroll: 'sec-next' }],
  ['pingxi-zh', { line: 'pingxi', train: '4816', dest: 'pingxi', scroll: 'content' }],
  ['pingxi-en', { line: 'pingxi', train: '4816', dest: 'pingxi', lang: 'en', scroll: 'content' }],
  ['map', { line: 'pingxi', train: '4816', dest: 'pingxi', overlay: 'map' }],
  ['guangfu-top', { line: 'huadong', train: '4528', dest: 'guangfu', scroll: 'content' }],
  ['guangfu-alert', { line: 'huadong', train: '4528', dest: 'guangfu', scroll: 'sec-alert' }],
  ['guangfu-hl', { line: 'huadong', train: '4528', dest: 'guangfu', scroll: 'sec-highlights' }],
  ['tongxiao-top', { line: 'haixian', train: '2527', dest: 'tongxiao', scroll: 'content' }],
  ['tongxiao-hl', { line: 'haixian', train: '2527', dest: 'tongxiao', scroll: 'sec-highlights' }],
  ['tongxiao-next', { line: 'haixian', train: '2527', dest: 'tongxiao', scroll: 'sec-next' }],
];

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 4, reducedMotion: 'reduce', hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await page.goto(base + 'index.html?tour=1');
await page.waitForFunction(() => !!window.RideGuide);
for (const [name, scene] of SHOTS) {
  await page.evaluate((sc) => window.RideGuide.applyScene(sc), scene);
  await page.waitForTimeout(scene.sheet ? 1100 : 500);
  await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => null)))));
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log('拍好', name);
}

// 中英切換鍵：單獨用 8 倍解析度拍，放大成主角也清楚
const ctx8 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 8, reducedMotion: 'reduce', hasTouch: true, isMobile: true });
const p8 = await ctx8.newPage();
await p8.goto(base + 'index.html?tour=1');
await p8.waitForFunction(() => !!window.RideGuide);
for (const lang of ['zh', 'en']) {
  await p8.evaluate((l) => window.RideGuide.applyScene({ line: 'pingxi', train: '4816', dest: 'pingxi', lang: l, scroll: 'content' }), lang);
  await p8.waitForTimeout(500);
  await p8.locator('.lang').screenshot({ path: join(out, `lang-${lang}.png`) });
  console.log('拍好', `lang-${lang}`);
}

// 底部目的站列：用寬畫面拍，一次看到這班車接下來會停的每一站（未選／選了十分兩種狀態）
const ctxw = await browser.newContext({ viewport: { width: 1400, height: 700 }, deviceScaleFactor: 3, reducedMotion: 'reduce' });
const pw2 = await ctxw.newPage();
await pw2.goto(base + 'index.html?tour=1');
await pw2.waitForFunction(() => !!window.RideGuide);
const dock = {};
for (const [name, dest] of [['dock-none', null], ['dock-shifen', 'shifen']]) {
  await pw2.evaluate((d) => window.RideGuide.applyScene({ line: 'pingxi', train: '4816', dest: d, scroll: 'top' }), dest);
  await pw2.waitForTimeout(500);
  // 寬畫面下站名列仍是可橫捲的容器；拍照時讓它完整攤開，元件本身不變
  await pw2.addStyleTag({ content: '#dock .wrap{max-width:none!important}#dock .chips{overflow:visible!important;max-width:none!important;mask-image:none!important;-webkit-mask-image:none!important}' });
  await pw2.waitForTimeout(100);
  const box = await pw2.evaluate(() => {
    const els = [document.querySelector('#dock .dock-label'), ...document.querySelectorAll('#dock .chip')];
    const rs = els.map((e) => e.getBoundingClientRect());
    const x0 = Math.min(...rs.map((r) => r.left)) - 14, x1 = Math.max(...rs.map((r) => r.right)) + 14;
    const d = document.querySelector('#dock').getBoundingClientRect();
    const sf = document.querySelector('#dock [data-id="shifen"]').getBoundingClientRect();
    const rel = (r) => [r.left - x0, r.top - d.top, r.width, r.height].map((v) => Math.round(v * 10) / 10);
    return { clip: { x: x0, y: d.top, width: x1 - x0, height: d.height }, shifen: [sf.left - x0 + sf.width / 2, sf.top - d.top + sf.height / 2],
      label: rel(rs[0]), chips: rs.slice(1).map(rel) };
  });
  await pw2.screenshot({ path: join(out, `${name}.png`), clip: box.clip });
  dock[name] = box;
  console.log('拍好', name);
}
await writeFile(join(out, 'dock.js'), `window.FILM_DOCK = ${JSON.stringify(dock)};\n`);

await browser.close();
server.close();
