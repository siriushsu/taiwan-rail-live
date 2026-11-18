// 把全台地景工作區（外接碟 T7，本機 git）的網頁圖層程式複製進 landscape-web/，給網站的「地景地圖」用。
//   node scripts/sync_landscape_web.mjs <工作區路徑> <rev>
// 來源一律讀工作區 git 的某一個提交，不讀工作樹：別條線還沒提交的改動不會被帶進來，也記得住是哪一版。
// rev 必填，用地景主線換版通知寫的「網站 engine 可以同步到哪一顆」：engine 比 R2 上的圖磚新會讀到還沒上傳的檔。
// 做三件事：
//   1. 只帶網頁圖層要的檔（main.js、兩支 worker、外觀、shared／integration、three.js、TM2 投影），車窗視角與原型的列車不帶。
//   2. main.js 套幾處嵌進網站要的改動（PATCHES，每一處都必須剛好對到一次，對不到就整支失敗，不會默默跳過）。
//   3. 去掉註解（esbuild 重印，不壓縮）：landscape-web/ 會跟著網站出貨並進公開快照，原始碼的註解留在工作區。
// 對工作區只讀：不寫檔、不改 git 狀態。
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'landscape-web', 'engine');
const [W, REV] = process.argv.slice(2);
if (!W || !REV) { console.error('用法：node scripts/sync_landscape_web.mjs <工作區路徑> <rev>（rev 照地景主線換版通知）'); process.exit(2); }
const git = (...a) => execFileSync('git', ['-C', W, ...a], { maxBuffer: 1 << 28 });
const sha = git('rev-parse', REV).toString().trim();
const ls = dir => git('ls-tree', '--name-only', sha, dir + '/').toString().split('\n').filter(Boolean);
const show = p => git('show', `${sha}:${p}`);

const WEB = 'landscape/web';
const FILES = [
  ...['main.js', 'tile.worker.js', 'buildings.worker.js', 'tw-facade.js', 'kit-building-appearance.js', 'kit-city-atlas.js'].map(f => [`${WEB}/${f}`, f]),
  ...ls(`${WEB}/shared`).filter(p => p.endsWith('.mjs')).map(p => [p, p.slice(WEB.length + 1)]),
  ...ls(`${WEB}/integration`).filter(p => p.endsWith('.js')).map(p => [p, p.slice(WEB.length + 1)]),
  [`${WEB}/vendor/three.module.js`, 'vendor/three.module.js'],
  [`${WEB}/vendor/three-LICENSE.txt`, 'vendor/three-LICENSE.txt'],
  ['landscape/proj/tm2.mjs', 'proj/tm2.mjs'],
];

// main.js 嵌進網站的改動。H＝landscape-web/host.js 掛在 globalThis 的那一份（網址參數、DOM、畫布大小、鏡頭、每格由網站驅動）。
const PATCHES = [
  ['params = new URLSearchParams(location.search);', 'params = H.params;'],
  ['const coarse = matchMedia', 'const H = globalThis.__LANDSCAPE_HOST__, coarse = matchMedia'],
  ["const $ = id => document.getElementById(id), status = t => { $('status').textContent = t; };", "const $ = id => H.el(id), status = t => { $('status').textContent = t; H.status(t); };"],
  ["import { createRideUg } from './ride/ride-ug.js';", "import { createRideUg } from '../host-stubs.js';"],
  ["import { createTrainsLayer } from './trains/trains-layer.js';", "import { createTrainsLayer } from '../host-stubs.js';"],
  ["new Worker('./tile.worker.js', { type: 'module' })", "new Worker(new URL('./tile.worker.js', import.meta.url), { type: 'module' })"],
  ['camera.far = fsF ? Math.max(120000, fsReach() * 1.3) : 120000; camera.updateProjectionMatrix();', 'camera.far = fsF ? Math.max(120000, fsReach() * 1.3) : 120000; camera.updateProjectionMatrix(); H.camera(camera, origin);'],
  ["addEventListener('resize', () => {", 'H.onResize(() => {'],
  ['  requestAnimationFrame(frame);\n}\nrequestAnimationFrame(frame);',
    '}\nH.ready({ frame, view, applyView, schedule, setTime, groundAt, origin, camera, renderer, scene, pending, tiles, fars, index, TILE_M, hsCasters, hsKey, get pixelRatio() { return pixelRatio; } });'],
];
// 全檔取代：視窗大小改成畫布大小（原型的畫布佔滿視窗；嵌進網站後是地圖容器的大小）
const REPLACE_ALL = [[/\binnerWidth\b/g, 'H.w()', 6], [/\binnerHeight\b/g, 'H.h()', 7]];

function patchMain(src) {
  for (const [a, b] of PATCHES) {
    const n = src.split(a).length - 1;
    if (n !== 1) throw Error(`main.js 改動對不到（${n} 處，應為 1）：${a.slice(0, 80)}`);
    src = src.replace(a, () => b);
  }
  for (const [re, b, want] of REPLACE_ALL) {
    const n = (src.match(re) || []).length;
    if (n !== want) throw Error(`main.js 的 ${re} 有 ${n} 處，應為 ${want}（原型改了，先看一下新的用法）`);
    src = src.replace(re, b);
  }
  return src;
}

// 網站道路使用 road-ribbons.mjs。上游修改道路時先比對兩邊，避免同步時覆寫新的畫法。
function patchRoads(src) {
  const from = src.indexOf('function roadRibbons('), to = src.indexOf('const buffers =', from);
  if (from < 0 || to < from || createHash('sha256').update(src.slice(from, to)).digest('hex') !==
      '679cec8389591fe6ae92f2b476202dae70de35c4006342df49e6f14921a09ec3') {
    throw Error('上游道路網格已變動，請比對網站的 road-ribbons.mjs');
  }
  const withoutRibbons = src.slice(0, from) + src.slice(to);
  const replacements = [
    ["import { edgeRuns, edgeKeep, keepSpans } from './shared/deck-lines.mjs';", "import { roadRibbons } from '../road-ribbons.mjs';"],
    ['deck, pier, side)), flat:', 'deck, pier, side, 0, roads.roads)), flat:'],
    ['0, 0, rdMode))', '0, 0, rdMode, roads.roads))'],
  ];
  return replacements.reduce((text, [old, replacement]) => {
    if (text.split(old).length !== 2) throw Error('tile.worker.js 道路入口對不到：' + old);
    return text.replace(old, replacement);
  }, withoutRibbons);
}

// 地標輪廓修正（landmark-fix.mjs）：tileData 讀完建物先改型別，buildOne 遇到這些型別交給網站畫
function hook(src, file, pairs) {
  return pairs.reduce((text, [old, replacement]) => {
    if (text.split(old).length !== 2) throw Error(`${file} 地標入口對不到：${old}`);
    return text.replace(old, () => replacement);
  }, src);
}
const patchLandmarksTile = src => hook(src, 'tile.worker.js', [
  ["import { roadRibbons } from '../road-ribbons.mjs';", "import { roadRibbons } from '../road-ribbons.mjs';\nimport { fixLandmarks } from '../landmark-fix.mjs';"],
  ['await aeroDropBuildings(url, bj', 'fixLandmarks(bj); await aeroDropBuildings(url, bj'],
]);
const patchLandmarksBuildings = src => hook(src, 'buildings.worker.js', [
  ["import { cvsCode } from './shared/cvs-look.mjs';", "import { cvsCode } from './shared/cvs-look.mjs';\nimport { LANDMARK_TYPES, buildLandmark } from '../landmark-fix.mjs';"],
  ['function buildOne(b) {', 'function buildOne(b) {\n    if (LANDMARK_TYPES.has(b.type)) return buildLandmark(b, { quad, tri, box, vert, rgb, shade, THREE, Z4, WHITE, P_DECK, P_TILE, P_PLAIN });'],
]);

const patched = new Map([
  ['main.js', patchMain(show(WEB + '/main.js').toString('utf8'))],
  ['tile.worker.js', patchLandmarksTile(patchRoads(show(WEB + '/tile.worker.js').toString('utf8')))],
  ['buildings.worker.js', patchLandmarksBuildings(show(WEB + '/buildings.worker.js').toString('utf8'))],
]);
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
let bytesIn = 0, bytesOut = 0;
for (const [from, to] of FILES) {
  let buf = show(from); bytesIn += buf.length;
  const dest = path.join(OUT, to); mkdirSync(path.dirname(dest), { recursive: true });
  if (/\.(m?js)$/.test(to) && !to.startsWith('vendor/')) {
    const src = patched.get(to) ?? buf.toString('utf8');
    const r = await transform(src, { loader: 'js', format: undefined, target: 'esnext', legalComments: 'none', charset: 'utf8' });
    buf = Buffer.from(r.code, 'utf8');
  }
  writeFileSync(dest, buf); bytesOut += buf.length;
}
const stamp = { source: 'landscape/web（全台地景工作區）', commit: sha, files: FILES.length, syncedAt: new Date().toISOString() };
writeFileSync(path.join(OUT, 'SOURCE.json'), JSON.stringify(stamp, null, 2) + '\n');
console.log(`landscape-web/engine：${FILES.length} 個檔，來源 ${sha.slice(0, 7)}，${(bytesIn / 1024).toFixed(0)} KB → ${(bytesOut / 1024).toFixed(0)} KB`);
