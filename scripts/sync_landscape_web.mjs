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
  // worker 從自己的網址讀 tw2 開關（shared/tw2.mjs）。網站開機會把網址參數抹掉，所以改帶網站交給 engine 的 H.params（?ls.tw2=… → tw2）裡 tw2 與 x2* 那幾個；路徑改成相對 engine/
  ["new Worker('./tile.worker.js' + location.search, { type: 'module' })", "new Worker(new URL('./tile.worker.js?' + new URLSearchParams([...params].filter(([k]) => k === 'tw2' || k.startsWith('x2'))), import.meta.url), { type: 'module' })"],
  ['camera.far = fsF ? Math.max(120000, fsReach() * 1.3) : 120000; camera.updateProjectionMatrix();', 'camera.far = fsF ? Math.max(120000, fsReach() * 1.3) : 120000; camera.updateProjectionMatrix(); H.camera(camera, origin);'],
  ["addEventListener('resize', () => {", 'H.onResize(() => {'],
  ['  requestAnimationFrame(frame);\n}\nrequestAnimationFrame(frame);',
    '}\nshareMist([treeMat, simpleMat, roadMat, roadFlatMat, facadeMat, facadeFarMat, stationSolid, stationGlass, wallMat]);\nH.ready({ weatherBudget: weatherBudget(LIMIT), get night() { return night; }, frame, view, applyView, schedule, setTime, groundAt, origin, camera, renderer, scene, pending, tiles, fars, index, TILE_M, hsCasters, hsKey, get pixelRatio() { return pixelRatio; } });'],
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
// 雜湊鎖的是 T7 4d2b666 的 roadRibbons（到 streetObjects 之前）；這一版的標線、T 型墩、護欄兩段、跨水的橋（rbrg）已經搬進 road-ribbons.mjs。
function patchRoads(src) {
  const from = src.indexOf('function roadRibbons('), to = src.indexOf('async function streetObjects(', from);
  if (from < 0 || to < from || createHash('sha256').update(src.slice(from, to)).digest('hex') !==
      '128083dd4b2849b0c2678e7c6796b455bbcf2d8cc63507896cd5dcf72d17d0df') {
    throw Error('上游道路網格已變動，請比對網站的 road-ribbons.mjs');
  }
  const withoutRibbons = src.slice(0, from) + src.slice(to);
  const replacements = [
    ["import { edgeRuns, edgeKeep, keepSpans } from './shared/deck-lines.mjs';", "import { roadRibbons } from '../road-ribbons.mjs';"],
    ['deck, pier, side)), flat:', 'deck, pier, side, 0, roads.roads)), flat:'],
    // 人行道要看附近有沒有房子：bNearOf 留在 worker，連同建物一起傳進網站的道路網格
    ['0, 0, rdMode, TW2.walk ? t.buildings : null))', '0, 0, rdMode, roads.roads, TW2.walk ? t.buildings : null, bNearOf))'],
  ];
  return replacements.reduce((text, [old, replacement]) => {
    if (text.split(old).length !== 2) throw Error('tile.worker.js 道路入口對不到：' + old);
    return text.replace(old, replacement);
  }, withoutRibbons);
}

// 近景場地與校舍外觀在網站的 places.mjs，之後重新同步 engine 仍走同一條路。
function patchPlaces(src, pairs) {
  for (const [a, b] of pairs) {
    if (src.split(a).length !== 2) throw Error('地景場館入口對不到：' + a);
    src = src.replace(a, () => b);
  }
  return src;
}
const placesMain = [
  ['const stationLit = new Map()', 'const modelLights = createModelLights();\nconst stationLit = new Map()'],
  ['if (NC.win &&', 'modelLights.setTime(h, twDate(), stationLitOn.v);\n  if (NC.win &&'],
  ['function stationGroup(buf, lod) {', 'function stationGroup(buf, lod, site, parts) { const siteId=site.id;'],
  ['for (const part of lod.drawGroups) {', 'for (const raw of parts) { const part = siteId === "taipei101-landmark-v1" && isWeekly(raw) ? {...raw, nightWeeklyHours:[12,23]} : raw;'],
  ['() => stationGroup(buf, lod)', '() => modelLights.group(s, lod, parts => stationGroup(buf, lod, s, parts), stationSolid, stationGlass)'],
  ['() => stationGroup(sb, st.near)', '() => modelLights.group(st, st.near, parts => stationGroup(sb, st.near, st, parts), stationSolid, stationGlass)'],
  ['g.userData.bytes = pos.byteLength', 'let detailBytes = 0; if (siteId === "presidential-office") { const geometry=presidentialFacade(THREE,site.at[0]%TILE_M,site.at[1]%TILE_M,lod.origin[2],lod.file.endsWith(".near.bin")); addMesh(g,geometry,stationSolid).name="presidential-facade"; detailBytes=geomBytes(geometry); } g.userData.bytes = detailBytes + pos.byteLength'],
  ['mats.has(o.material)', 'mats.has(modelLights.original(o.material))'],
  // 手機的跟車鏡頭會一直移動。即使每格都超時，也要持續上傳，並先顯示列車所在的地形。
  ['function drainStage() {', 'let lastUploadStep = -Infinity;\nfunction drainStage() {'],
  ['LIMIT.late > 0 && lastDt > 20)', 'LIMIT.late > 0 && lastDt > 20 && performance.now() - lastUploadStep < 50)'],
  ['let kb = 0; while (stageQ.length)', 'lastUploadStep = performance.now(); let kb = 0; while (stageQ.length)'],
  ['hold(t.group); const alive', 'hold(t.group); if (rectDist(view.e, view.n, e0, n0, TILE_M) === 0) t.terrain[1].layers.set(0); const alive'],
  ['const skyDayFS =', 'shadeRainSky(skyMat);\nconst skyDayFS ='],
  ['aeroGroundPatch(sh);', 'aeroGroundPatch(sh); shadeRainGround(sh);'],
  ['};\nconst RHL = createRailHl', '  shadeRainRail(sh);\n};\nconst RHL = createRailHl'],
  ["tm('render', drawFrame);", "tm('render', () => H.drawWeather(drawFrame));"],
  ["loader.load(src, t => {","loader.load(src, async t => { await patchNightTexture(t,u,b);"],
  ['new DataView(treeBuf), n = Math.floor(treeBuf.byteLength / 10 * LIMIT.trees)', 'withTunnelTrees(treeBuf, r.trees, LIMIT.trees), n = T.byteLength / 10'],
  // 路燈不立在隧道裡：T7 f222a01 起路燈在 worker 的 base 工作算（placesWorker 那邊同一套），這兩條是 lampw=0 照舊在主執行緒算的那條路
  ["const rd = base.lamp ? null : await lampRoads;", "const [rd, tunnels] = base.lamp ? [null, null] : await Promise.all([lampRoads, tunnelDetail(url)]);"],
  ["tileLamps(rd.roads, railP(rails), local, lampOpt)", "tileLamps(surfaceRoads(rd.roads, tunnels), railP(rails), local, lampOpt)"],
  ['if (r.roads.n && P28.rd)', "for (const hall of r.heritage||[]) { const mesh=addMesh(g,geom(hall),fieldMaterial,{cast:true});modelLights.bind(mesh,modelHours(hall.id));mesh.name='heritage-'+hall.id;bytes+=geomBytes(mesh.geometry); }\n  if (r.temples?.n) { const m = addMesh(g,geom(r.temples),fieldMaterial,{cast:true}); modelLights.bind(m, []); m.name='temple-halls';bytes+=geomBytes(m.geometry); }\n  if (r.fields?.n) { const m = addMesh(g, geom(r.fields), fieldMaterial, { cast: false }); m.name = 'campus-sports'; bytes += geomBytes(m.geometry); }\n  if (r.roads.n && P28.rd)"],
  ['const roadMat =', 'const fieldMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .97, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });\nconst roadMat ='],
];
const placesWorker = [
  ["import { roadRibbons }", "import { placeDetail, tunnelDetail, applyPlaceBuildings, fieldMesh, templeMesh, reviewedTempleMeshes } from '../places.mjs';\nimport { surfaceRoads } from '../tunnel-roads.mjs';\nimport { roadRibbons }"],
  // worker 算路燈（base 工作）：跟主執行緒原本一樣扣掉隧道段
  ["const lampRoads = lamp ? jget(url + 'roads.json', vf?.j).then(r => r.ok ? r.json() : null).catch(() => null) : null;", "const lampRoads = lamp ? jget(url + 'roads.json', vf?.j).then(r => r.ok ? r.json() : null).catch(() => null) : null, lampTunnels = lamp ? tunnelDetail(url) : null;"],
  ["if (rd?.roads) lamps = T('lamps', () => tileLamps(rd.roads, lamp.tracks", "const tunnels = await lampTunnels; if (rd?.roads) lamps = T('lamps', () => tileLamps(surfaceRoads(rd.roads, tunnels), lamp.tracks"],
  ['[tb, bj, sf] =', '[tb, bj, sf, detail] ='],
  ['t.roads = roads.context;', 'roads.roads = surfaceRoads(roads.roads,t.detail?.tunnels); t.roads = roads.context;'],
  ['t = { terrain: new Uint8Array(tb)', 't = { detail, terrain: new Uint8Array(tb)'],
  ['fixLandmarks(bj); await aeroDropBuildings', 'applyPlaceBuildings(bj, detail); fixLandmarks(bj); await aeroDropBuildings'],
  ["const built = T('build'", "const fields = fieldMesh(t.detail, groundAt), temples=templeMesh(t.detail,groundAt),heritage=reviewedTempleMeshes(t.detail,groundAt); const built = T('build'"],
];
// near 的兩種路面模式都要帶回運動場。
// T7 f222a01 起平面路那個出口前面多了 street（tw2 道路線第二包），兩個出口各對一次。
const NEAR_OUT = ['return { buildings: built, roads:', 'return { ...(street ? { street } : {}), buildings: built, roads:'];
const placeJob = src => {
  if (NEAR_OUT.some(o => src.split(o).length !== 2)) throw Error('近景建物出口變更');
  const shop = src.includes('shopfrontsOf(url, vf)])') ? 'shopfrontsOf(url, vf)' : 'shopfrontsOf(url)';
  src = patchPlaces(src, [[shop+'])',shop+', placeDetail(url)])']]);
  return patchPlaces(patchPlaces(src, placesWorker), NEAR_OUT.map(o => [o, o.replace('buildings: built, roads:', 'buildings: built, fields, temples, heritage, trees:t.detail?.tunnels?.trees, roads:')]));
};
const placesFacades = [
  ['color = rgb(isMetal ? (b.style.roofMetal','color = rgb(b.sceneRoof || (isMetal ? (b.style.roofMetal'],
  ["pick(b.style.roofTile || ROOF_TILE, hash(b.key, 'roof'))), part =", "pick(b.style.roofTile || ROOF_TILE, hash(b.key, 'roof')))), part ="],
  ["if (b.type === 'school') return", "if (b.mark === 'mall') return { color: b.color, win: 11, win2: 10, finish: 0, frame: '#78898a', cage: null, bands: true, ac: false, parapet: 0, deck: b.sceneRoof || '#b4b6b0' };\n    if (b.type === 'school') return"],
  ['markName: src.markName, rings:', 'markName: src.markName, sceneRoof: src.sceneRoof, rings:'],
  [': H(0).deck);', ': b.sceneRoof || H(0).deck);'],
];

function patchLand(src) {
  const start = src.indexOf('  if (c > ${LC.cemetery}'), end = src.indexOf(' }',src.indexOf('    return ',start));
  if (start<0 || end<start || !src.slice(start,end).includes('float tomb =')) throw Error('墓地地表著色器已變更');
  return src.slice(0,start) + '  if (c > ${LC.cemetery} - .5 && c < ${LC.cemetery} + .5) return land;' + src.slice(end+2);
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

// tw2 開關：主執行緒讀網站交給 engine 的參數（H.params，網址 ?ls.tw2=…），worker 沒有 host、照讀自己的網址（上面 Worker 那條帶過去）
// 物件裡的註解 esbuild 會留著，而 engine/ 會進公開快照：「// 第 N 輪（…）」括號裡上游記的採用紀錄整段拿掉
const dropRoundNotes = src => {
  const re = /(\/\/ 第 \d+ 輪)（[^）\n]*）/g, n = src.match(re)?.length ?? 0;
  if (n < 1) throw Error('shared/tw2.mjs 對不到「// 第 N 輪（…）」註解，上游改寫法了要重看');
  return src.replace(re, '$1');
};
const patchTw2 = src => dropRoundNotes(hook(src, 'shared/tw2.mjs', [
  ["export const TW2 = parseTw2(globalThis.location?.search || '');", "export const TW2 = parseTw2(globalThis.__LANDSCAPE_HOST__ ? '?' + globalThis.__LANDSCAPE_HOST__.params : globalThis.location?.search || '');"],
]));
const patched = new Map([
  ['shared/fx3.mjs',patchLand(show(WEB+'/shared/fx3.mjs').toString('utf8'))],
  ['shared/tw2.mjs', patchTw2(show(WEB + '/shared/tw2.mjs').toString('utf8'))],
  ['buildings.worker.js', patchLandmarksBuildings(patchPlaces(show(WEB + '/buildings.worker.js').toString('utf8'), placesFacades))],
  ['main.js', "import { presidentialFacade } from '../presidential-facade.mjs';\nimport { createModelLights } from '../model-lights.mjs';\nimport { modelHours } from '../../rail-3d/environment/model-hours.js';\nimport { shadeRainGround, shadeRainRail, shadeRainSky, shareMist, weatherBudget } from '../follow-rain.mjs';\nimport { patchNightTexture } from '../night-tunnels.mjs';\nimport { tunnelDetail } from '../places.mjs';\nimport { surfaceRoads, withTunnelTrees } from '../tunnel-roads.mjs';\n" + patchPlaces(patchMain(show(WEB + '/main.js').toString('utf8')), placesMain)],
  ['tile.worker.js', placeJob(patchLandmarksTile(patchRoads(show(WEB + '/tile.worker.js').toString('utf8'))))],
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
