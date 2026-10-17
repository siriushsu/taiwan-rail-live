// 用 viewer.html（與重播頁同一支 shader）把整列編組算成圖：無視窗 Chrome（channel:'chrome', headless:true）。
// 車廂位置照 memories/tainan-2026-09-12/replay.js arrange()：每輛用 catalog 的 pitchM 首尾相接、以編組中心置中。
// 用法：node render_lineups.mjs [--out <輸出目錄>]    預設輸出到 <repo>/output/tainan-1016-fleet（已被 .gitignore）
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../../../..');
const OUT = process.argv.includes('--out') ? path.resolve(process.argv[process.argv.indexOf('--out') + 1]) : path.join(ROOT, 'output/tainan-1016-fleet');
fs.mkdirSync(OUT, {recursive: true});
const FLEETS = {
  '1016': {dir: '/memories/tainan-2026-10-16/fleet', catalog: JSON.parse(fs.readFileSync(path.join(ROOT, 'memories/tainan-2026-10-16/fleet/catalog.json'), 'utf8'))},
  '0912': {dir: '/memories/tainan-2026-09-12/fleet', catalog: JSON.parse(fs.readFileSync(path.join(ROOT, 'memories/tainan-2026-09-12/fleet/catalog.json'), 'utf8'))},
};
const MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.gz': 'application/octet-stream', '.bin': 'application/octet-stream'};

function serve() {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; }   // 瀏覽器自動要的圖示，不算頁面錯誤
    fs.readFile(p, (err, buf) => err ? res.writeHead(404).end() : res.writeHead(200, {'Content-Type': MIME[path.extname(p)] || 'application/octet-stream'}).end(buf));
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

// arrange()：回傳 [{mesh, flip, x, pitchM}]（x＝車體中心，+X 為前）
function arrange(fleetKey, formationId) {
  const {catalog} = FLEETS[fleetKey], rule = catalog.formations[formationId];
  const parts = rule.cars.map(c => ({mesh: c.mesh, flip: c.flip, pitchM: catalog.meshes[c.mesh].pitchM}));
  let front = parts.reduce((a, c) => a + c.pitchM, 0) / 2;
  for (const p of parts) { p.x = +(front - p.pitchM / 2).toFixed(4); front -= p.pitchM; }
  return parts;
}
const total = parts => parts.reduce((a, c) => a + c.pitchM, 0);

async function shot(browser, base, {fleetKey, formationId, lod = 'near', w, h, view = 'side', widthM, cx = 0, cz, label, file, extra = '', yaw, pitch}) {
  const parts = arrange(fleetKey, formationId), dir = FLEETS[fleetKey].dir;
  const files = parts.map(p => `${dir}/${p.mesh}.${lod}.bin.gz:${p.x}:${p.flip ? 1 : 0}`).join(',');
  const views = {
    side: {yaw: 270, pitch: 0, persp: 0, cz: cz ?? 2.0},
    top: {yaw: 270, pitch: 89, persp: 0, cz: cz ?? 0},
    q34: {yaw: 215, pitch: 20, persp: 1, cz: cz ?? 2.0},
  }[view];
  const span = view === 'q34' ? widthM : widthM * h / w;   // q34（透視）的 span 是目標處的可見高度；其餘是正交視窗高度
  const q = new URLSearchParams({files, yaw: yaw ?? views.yaw, pitch: pitch ?? views.pitch, span, cx, cz: views.cz, persp: views.persp, hud: label || '0', dpr: 1});
  const page = await browser.newPage({viewport: {width: w, height: h}, deviceScaleFactor: 1});
  const errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${base}/prototypes/tiny-trains/blender/tainan-fleet-v3/viewer.html?${q}${extra}`);
  await page.waitForFunction(() => window.viewerReady === true, null, {timeout: 60000});
  await page.waitForTimeout(300);
  const outPath = path.join(OUT, file);
  await page.screenshot({path: outPath});
  const stats = await page.evaluate(() => { const {scene} = window.viewer; let tris = 0, meshes = 0; scene.traverse(o => { if (o.isMesh && o.geometry?.attributes?.position && o.geometry.attributes.position.count > 100) { meshes++; tris += o.geometry.attributes.position.count / 3; } }); return {meshes, tris: Math.round(tris)}; });
  await page.close();
  if (errors.length) throw Error(file + ' 頁面錯誤：' + errors.join(' | '));
  console.log(file.padEnd(46), `cars=${parts.length}`.padEnd(8), `列長 ${total(parts).toFixed(2)} m`.padEnd(14), `meshes=${stats.meshes} tris=${stats.tris}`);
  return {file: outPath, parts, stats};
}

async function composite(browser, items, outFile, width) {
  const imgs = items.map(i => `<figure><figcaption>${i.caption}</figcaption><img src="data:image/png;base64,${fs.readFileSync(i.file).toString('base64')}"></figure>`).join('');
  const page = await browser.newPage({viewport: {width, height: 400}, deviceScaleFactor: 1});
  await page.setContent(`<style>body{margin:0;background:#fff;font:15px/1.4 -apple-system,'PingFang TC',sans-serif;color:#222}figure{margin:0 0 6px}figcaption{padding:4px 10px;background:#eef0e6;border-bottom:1px solid #ccd}img{display:block;width:${width}px}</style>${imgs}`);
  await page.waitForTimeout(300);
  await page.screenshot({path: path.join(OUT, outFile), fullPage: true});
  await page.close();
  console.log(outFile);
}

const server = await serve(), base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({channel: 'chrome', headless: true});
try {
  const W = 2400, H = 300, WIDTH_M = 200;   // 同一個比例尺（200 m 寬）算所有整列圖，長度可以直接比
  const runs = [
    {fleetKey: '0912', formationId: 'emu800', file: 'lineup-0912-emu800-3car.png', label: '9/12 EMU800 3 節示意'},
    {fleetKey: '1016', formationId: 'emu800', file: 'lineup-1016-emu800-8car.png', label: '10/16 EMU800 8 節（ED‑EMA‑EP‑EMB‑EMB‑EP‑EMA‑ED）'},
    {fleetKey: '0912', formationId: 'e200', file: 'lineup-0912-e200-3car.png', label: '9/12 莒光 3 節示意'},
    {fleetKey: '1016', formationId: 'e200', file: 'lineup-1016-e200-9car.png', label: '10/16 莒光 9 節（E200＋客車 8）'},
    {fleetKey: '1016', formationId: 'e500', file: 'lineup-1016-e500-7car.png', label: '10/16 環島之星 7 節（E500＋客車 6）'},
  ];
  const done = [];
  for (const r of runs) done.push({...r, ...(await shot(browser, base, {...r, w: W, h: H, widthM: WIDTH_M}))});
  await composite(browser, done.map(d => ({file: d.file, caption: `${d.label}　（同一比例尺，圖寬 ${WIDTH_M} m）`})), 'compare-lineups-1016-vs-0912.png', W);
  // 8 節 EMU800：側視近景（第 1–4 輛）、3/4 透視、俯視（看車頂設備），再加遠景 LOD 的整列
  const e800 = arrange('1016', 'emu800');
  const cxHalf = (e800[0].x + e800[3].x) / 2;   // 第 1–4 輛的中心
  await shot(browser, base, {fleetKey: '1016', formationId: 'emu800', file: 'closeup-1016-emu800-cars1to4-side.png', w: 2000, h: 520, widthM: 86, cx: cxHalf, label: '10/16 EMU800 側視（由右至左：第 1 輛 ED、第 2 輛 EMA、第 3 輛 EP、第 4 輛 EMB）'});
  await shot(browser, base, {fleetKey: '1016', formationId: 'emu800', file: 'closeup-1016-emu800-cars2to4-q34.png', w: 2000, h: 700, widthM: 24, cx: e800[2].x, view: 'q34', yaw: 243, pitch: 16, label: '10/16 EMU800 3/4 透視（由左至右：第 4 輛 EMB、第 3 輛 EP、第 2 輛 EMA、第 1 輛 ED）：第 3 輛的集電弓朝第 4 輛'});
  await shot(browser, base, {fleetKey: '1016', formationId: 'emu800', file: 'closeup-1016-emu800-cars5to7-q34.png', w: 2000, h: 700, widthM: 24, cx: e800[5].x, view: 'q34', yaw: 243, pitch: 16, label: '10/16 EMU800 3/4 透視（由左至右：第 7 輛 EMA、第 6 輛 EP、第 5 輛 EMB、第 4 輛 EMB）：第 6 輛轉 180°，集電弓朝第 5 輛'});
  await shot(browser, base, {fleetKey: '1016', formationId: 'emu800', file: 'topview-1016-emu800-cars3to6.png', w: 2400, h: 260, widthM: 90, view: 'top', cz: 0, label: '10/16 EMU800 俯視（由左至右：第 6、5、4、3 輛＝EP、EMB、EMB、EP）：兩具集電弓都朝向中間的 EMB'});
  await shot(browser, base, {fleetKey: '1016', formationId: 'emu800', file: 'topview-1016-emu800-8car.png', w: 2400, h: 220, widthM: 180, view: 'top', cz: 0, label: '10/16 EMU800 8 節俯視（車頂設備）'});
  await shot(browser, base, {fleetKey: '1016', formationId: 'emu800', lod: 'far', file: 'lineup-1016-emu800-8car-far.png', w: W, h: H, widthM: WIDTH_M, label: '10/16 EMU800 8 節（遠景 LOD）'});
  // 新舊中間車並排（同一份產生程式，只差集電弓）：EP 與 emu800-mid 同位置的側視／3/4 比較在整列圖裡看得到；這裡再單獨各算一輛，方便逐像素比對
  for (const mesh of ['emu800-ep', 'emu800-mid']) {
    for (const [view, tag, hh] of [['side', 'side', 360], ['q34', 'q34', 500]]) {
      const dir = FLEETS['1016'].dir;
      const q = new URLSearchParams({files: `${dir}/${mesh}.near.bin.gz:0:0`, yaw: view === 'side' ? 270 : 215, pitch: view === 'side' ? 0 : 20, span: view === 'side' ? 24 * hh / 1200 : 24, cx: 0, cz: 2.0, persp: view === 'side' ? 0 : 1, hud: mesh, dpr: 1});
      const page = await browser.newPage({viewport: {width: 1200, height: hh}, deviceScaleFactor: 1});
      await page.goto(`${base}/prototypes/tiny-trains/blender/tainan-fleet-v3/viewer.html?${q}`);
      await page.waitForFunction(() => window.viewerReady === true, null, {timeout: 60000});
      await page.waitForTimeout(300);
      await page.screenshot({path: path.join(OUT, `single-${mesh}-${tag}.png`)});
      await page.close();
      console.log(`single-${mesh}-${tag}.png`);
    }
  }
  await composite(browser, [
    {file: path.join(OUT, 'single-emu800-ep-side.png'), caption: 'emu800-ep（EP：集電弓＋電氣室罩＋廁所小窗）側視'},
    {file: path.join(OUT, 'single-emu800-mid-side.png'), caption: 'emu800-mid（EMA／EMB：兩具冷氣、無集電弓）側視'},
    {file: path.join(OUT, 'single-emu800-ep-q34.png'), caption: 'emu800-ep 3/4 透視'},
    {file: path.join(OUT, 'single-emu800-mid-q34.png'), caption: 'emu800-mid 3/4 透視'},
  ], 'compare-ep-vs-mid.png', 1200);
} finally {
  await browser.close();
  server.close();
}
