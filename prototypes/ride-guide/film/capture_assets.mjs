// 拍影片素材：用真實原型的畫面（3 倍解析度），輸出到 film/assets/（不進版控）。
// 用法：node prototypes/ride-guide/film/capture_assets.mjs（需 playwright 或 PLAYWRIGHT_MODULE）
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, reducedMotion: 'reduce', hasTouch: true, isMobile: true });
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
await browser.close();
server.close();
