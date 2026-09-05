// 「隨機跟隨」×「附近車站」互斥驗收。
//
// 正常驗收：
//   node scripts/verify_map_action_mutex.mjs
// 突變對照（兩者都應回傳非 0）：
//   MUT=mutex node scripts/verify_map_action_mutex.mjs
//   MUT=hotzone node scripts/verify_map_action_mutex.mjs
//
// 腳本自己用 listen(0) 開靜態 server，並以 md5 確認瀏覽器拿到的正是當下工作樹。
// 所有按鈕操作都透過觸控座標，不直呼 onclick/click handler。
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEngineMatrix } from './lib/engine_matrix.mjs';

const require = createRequire(import.meta.url);
const { chromium, webkit } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = path.join(ROOT, 'index.html');
const SOURCE = readFileSync(INDEX_PATH, 'utf8');
// globalThis.__RAIL_VERIFY_MUT 是受限執行器無 process.env 時的等價注入點；一般 CLI 仍用 MUT=...。
const MUT = (typeof process !== 'undefined' && process.env && process.env.MUT) || globalThis.__RAIL_VERIFY_MUT || '';
const MUTATIONS = {
  mutex: [
    {
      from: `  if (state.autoTour) setAutoTour(false);\n  if (state.followTrain || state.followId || state.freqFollow) clearFollow();\n`,
      to: '',
    },
    {
      from: `  if (on) closeNearbyStations();\n`,
      to: '',
    },
  ],
  hotzone: [
    {
      from: `position: relative; left: auto; right: auto; top: auto; bottom: auto; transform: none;`,
      to: `position: static; left: auto; right: auto; top: auto; bottom: auto; transform: none;`,
    },
  ],
};
if (MUT && !MUTATIONS[MUT]) throw new Error(`未知突變 MUT=${MUT}`);

let servedIndex = SOURCE;
for (const change of (MUTATIONS[MUT] || [])) {
  const count = servedIndex.split(change.from).length - 1;
  if (count !== 1) throw new Error(`MUT=${MUT} 來源片段命中 ${count} 次，拒絕打空包彈`);
  servedIndex = servedIndex.replace(change.from, change.to);
}
let navigationIndex = servedIndex;

const md5 = data => createHash('md5').update(data).digest('hex');
const diskMd5 = md5(SOURCE);
const expectedWireMd5 = md5(servedIndex);
const build = (SOURCE.match(/const BUILD = '([^']+)'/) || [])[1] || '?';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};
// M4-B(2026-09-05)：index.html 不再載 Leaflet，地圖引擎 maplibre-gl 本來就在 vendor/ 裡由
// localAsset 直接供應 ⇒ 原本「從 app/node_modules 找 leaflet dist，找不到就 throw」整段移除。

function localAsset(requestUrl) {
  try {
    const url = new URL(requestUrl, 'http://local.test');
    if (url.pathname.startsWith('/api/')) {
      // 404 才會讓前端走既有 fallback；200 {} 會把 boot 困在半途。
      return { status: 404, contentType: 'application/json; charset=utf-8', body: '{"error":"local verification: api unavailable"}' };
    }
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
    const resolved = path.resolve(filePath);
    if (!(resolved === ROOT || resolved.startsWith(ROOT + path.sep)) || !existsSync(resolved)) {
      return { status: 404, contentType: 'text/plain; charset=utf-8', body: 'not found' };
    }
    return {
      status: 200,
      contentType: MIME[path.extname(resolved)] || 'application/octet-stream',
      body: resolved === INDEX_PATH ? navigationIndex : readFileSync(resolved),
    };
  } catch (error) {
    return { status: 500, contentType: 'text/plain; charset=utf-8', body: String(error) };
  }
}

const server = createServer((req, res) => {
  const asset = localAsset(req.url);
  res.statusCode = asset.status;
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-type', asset.contentType);
  res.end(asset.body);
});

let listenError = null;
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
} catch (error) {
  listenError = error;
  if (!['EPERM', 'EACCES'].includes(error && error.code)) throw error;
}
// 受限 sandbox 可能禁止本機 listen；此時以唯一 host + Playwright route 原樣 fulfill 同一個 localAsset。
// 一般 CLI 環境仍必定走 listen(0)。兩路都會從真實 navigation response 再做一次 md5 gate。
// M4-B：受限環境原本要把 index.html 的 leaflet-cdn 區塊換成本機同版資產;那個區塊已不存在,
// 而 maplibre-gl 本來就走 vendor/ 的本機檔 ⇒ 受測 HTML 現在兩條路都原封不動(md5 gate 也更嚴)。
const ROUTE_FALLBACK = !server.listening;
const expectedNavigationMd5 = md5(navigationIndex);
const BASE = ROUTE_FALLBACK
  ? `http://railisland-verify-${expectedWireMd5.slice(0, 12)}.test/`
  : `http://127.0.0.1:${server.address().port}/`;

const preflight = [];
let matrixCheck = null;
function check(name, pass, detail = '') {
  if (matrixCheck) return matrixCheck(pass, name, detail);
  preflight.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

if (ROUTE_FALLBACK) {
  check('[G0] listen(0) 被執行環境禁止，改用隔離的 Playwright route origin',
    !!listenError, `code=${listenError && listenError.code} ROOT=${ROOT} BUILD=${build} disk=${diskMd5} BASE=${BASE} MUT=${MUT || 'none'}`);
  check('[G0] 受限環境供應的 HTML 與磁碟那份逐 byte 相同(M4-B 起不再改寫任何 CDN 錨點)',
    expectedNavigationMd5 === expectedWireMd5,
    `source=${expectedWireMd5} navigation=${expectedNavigationMd5}`);
} else {
  const wire = Buffer.from(await (await fetch(BASE)).arrayBuffer());
  const wireMd5 = md5(wire);
  check('[G0] 動態埠 server 內容與預期受測內容逐 byte 相同', wireMd5 === expectedNavigationMd5,
    `ROOT=${ROOT} BUILD=${build} disk=${diskMd5} wire=${wireMd5} BASE=${BASE} MUT=${MUT || 'none'}`);
  if (!MUT) check('[G0] 正常模式 server md5 與磁碟 index.html 相同', wireMd5 === diskMd5);
}
if (MUT) check(`[G0] 突變 ${MUT} 確實改變受測位元`, expectedWireMd5 !== diskMd5,
  `disk=${diskMd5} mutant=${expectedWireMd5}`);

const HEIGHTS = { 360: 780, 375: 812, 414: 896, 768: 1024 };
const WIDTHS = MUT ? [375] : [360, 375, 414, 768];
// ENGINE=chromium 僅供某個引擎本身無法啟動時留下其他引擎的完整綠燈證據；預設仍強制雙引擎。
const ENGINE_FILTER = (typeof process !== 'undefined' && process.env && process.env.ENGINE) || globalThis.__RAIL_VERIFY_ENGINE || '';
const ALL_ENGINES = MUT ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]];
const ENGINES = ENGINE_FILTER ? ALL_ENGINES.filter(([name]) => name === ENGINE_FILTER) : ALL_ENGINES;
if (!ENGINES.length) throw new Error(`未知引擎 ENGINE=${ENGINE_FILTER}`);
const GEOMOCK = '?geomock=25.0478,121.5170&geodelay=0&geoacc=20';

function modeSnapshotExpression() {
  const nearCard = document.getElementById('nearCard');
  const followPanel = document.getElementById('followPanel');
  const freqCard = document.getElementById('freqCard');
  const nearOpen = !!state.meLoc && !!nearCard && !nearCard.hidden;
  const following = !!(state.followTrain || state.followId || state.freqFollow);
  return {
    autoTour: !!state.autoTour,
    following,
    followTrain: state.followTrain ? String(state.followTrain.train || '?') : null,
    followId: state.followId == null ? null : String(state.followId),
    freqFollow: !!state.freqFollow,
    followStatus: state.followStatus == null ? null : String(state.followStatus),
    nearOpen,
    meLoc: state.meLoc ? { lat: state.meLoc.lat, lon: state.meLoc.lon } : null,
    nearHidden: !nearCard || nearCard.hidden,
    followPanelHidden: !followPanel || followPanel.hidden,
    freqCardHidden: !freqCard || freqCard.hidden,
    randActive: document.getElementById('randBtn').classList.contains('active'),
    randLabel: document.getElementById('randLbl').textContent.trim(),
  };
}

async function snapshot(page) {
  return page.evaluate(modeSnapshotExpression);
}

async function resetModes(page) {
  await page.evaluate(() => {
    if (state.autoTour) setAutoTour(false);
    if (state.followTrain || state.followId || state.freqFollow) clearFollow();
    closeNearbyStations();
  });
}

async function tapCenter(page, selector) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} 沒有可點的 bounding box`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

function actionOf(s) {
  const rand = s.autoTour || s.following;
  if (rand && s.nearOpen) return 'both';
  if (rand) return 'rand';
  if (s.nearOpen) return 'near';
  return 'none';
}

async function auditHotzones(page, tag) {
  const geometry = await page.evaluate(() => {
    const compact = el => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    return {
      actions: compact(document.getElementById('mapActions')),
      rand: compact(document.getElementById('randBtn')),
      near: compact(document.getElementById('nearBtn')),
    };
  });
  check(`${tag} [熱區] 前置：兩鈕與 .map-actions 都有實體尺寸`,
    geometry.actions.width > 0 && geometry.rand.width > 0 && geometry.near.width > 0,
    JSON.stringify(geometry));

  // 顯式中心點操作：每顆按鈕都用觸控座標點一次，並看狀態而不是只看命中 DOM。
  await resetModes(page);
  await tapCenter(page, '#randBtn');
  const randCenter = await snapshot(page);
  check(`${tag} [熱區] #randBtn 中心真 tap 只觸發隨機跟隨`, actionOf(randCenter) === 'rand', JSON.stringify(randCenter));

  await resetModes(page);
  await tapCenter(page, '#nearBtn');
  const nearCenter = await snapshot(page);
  check(`${tag} [熱區] #nearBtn 中心真 tap 只觸發附近車站`, actionOf(nearCenter) === 'near', JSON.stringify(nearCenter));

  // 縱掃整條 action column 的每個 CSS pixel row。兩顆鈕現場是上下排列，舊 gate 橫掃兩鈕
  // 交集不存在的 y，會把空隙誤報成產品紅；這裡改量真實排列軸，仍以真 touch 狀態分類。
  const x = (Math.max(geometry.rand.left, geometry.near.left) + Math.min(geometry.rand.right, geometry.near.right)) / 2;
  const start = Math.ceil(geometry.actions.top);
  const end = Math.floor(geometry.actions.bottom);
  const counts = { rand: 0, near: 0, none: 0, both: 0 };
  const hits = [];
  for (let y = start; y < end; y++) {
    await resetModes(page);
    await page.touchscreen.tap(x, y + 0.5);
    const actual = actionOf(await snapshot(page));
    counts[actual]++;
    hits.push({ y: y + 0.5, actual });
  }
  await resetModes(page);
  // 真實 touch engine 會對按鈕邊界與 gap 做 touch adjustment，不能拿 rect 邊界當成逐 pixel 的唯一真值。
  // 獨立性的可觀察判準是：兩種動作都有非空且各自連續的命中帶，左 rand 帶完全結束後才能進右 near 帶，
  // 不得有 both，也不得在進 near 後又回頭觸發 rand。position:static 前科會讓 near 蓋滿整列，rand 帶變成 0。
  const randHits = hits.filter(hit => hit.actual === 'rand').map(hit => hit.y);
  const nearHits = hits.filter(hit => hit.actual === 'near').map(hit => hit.y);
  const randSpan = randHits.length ? [Math.min(...randHits), Math.max(...randHits)] : null;
  const nearSpan = nearHits.length ? [Math.min(...nearHits), Math.max(...nearHits)] : null;
  const activeOrder = hits.filter(hit => hit.actual === 'rand' || hit.actual === 'near').map(hit => hit.actual);
  const orderOk = activeOrder.every((action, index) => action === 'rand' || !activeOrder.slice(index + 1).includes('rand'));
  const separated = !!randSpan && !!nearSpan && randSpan[1] < nearSpan[0];
  check(`${tag} [熱區] 縱掃 .map-actions 每個 pixel，兩鈕可點區各自獨立`,
    counts.both === 0 && separated && orderOk,
    `range=${start}..${end - 1} x=${x.toFixed(1)} counts=${JSON.stringify(counts)} randSpan=${JSON.stringify(randSpan)} nearSpan=${JSON.stringify(nearSpan)} orderOk=${orderOk}`);
}

async function verifyMutex(page, tag) {
  await resetModes(page);
  const initial = await snapshot(page);
  check(`${tag} [基線] 起始時兩模式都關閉`, actionOf(initial) === 'none', JSON.stringify(initial));

  // 不可誤傷 A：兩者都關閉時，附近車站仍可單獨開啟。
  await tapCenter(page, '#nearBtn');
  await page.waitForFunction(() => !!state.meLoc && !document.getElementById('nearCard').hidden, null, { timeout: 5000 });
  const nearOnly = await snapshot(page);
  check(`${tag} [不誤傷] 單獨點附近車站仍正常開啟`,
    actionOf(nearOnly) === 'near' && nearOnly.followPanelHidden && nearOnly.freqCardHidden,
    JSON.stringify(nearOnly));

  // 不可誤傷 B：兩者都關閉時，隨機跟隨仍會真正挑到並跟一班車。
  await resetModes(page);
  await tapCenter(page, '#randBtn');
  await page.waitForFunction(() => state.autoTour && !!(state.followTrain || state.freqFollow), null, { timeout: 5000 });
  const randOnly = await snapshot(page);
  check(`${tag} [不誤傷] 單獨點隨機跟隨仍會開啟並出現跟隨卡`,
    actionOf(randOnly) === 'rand' && randOnly.nearHidden && !randOnly.meLoc && (!randOnly.followPanelHidden || !randOnly.freqCardHidden),
    JSON.stringify(randOnly));

  // 正向：跟隨中點附近車站，狀態與 UI 都必須收乾淨。
  await tapCenter(page, '#nearBtn');
  await page.waitForFunction(() => !!state.meLoc && !document.getElementById('nearCard').hidden, null, { timeout: 5000 });
  const forward = await snapshot(page);
  const forwardStateClean = !forward.autoTour && !forward.following && forward.followTrain === null
    && forward.followId === null && !forward.freqFollow && forward.followStatus === null;
  const forwardUiClean = forward.followPanelHidden && forward.freqCardHidden && !forward.randActive && forward.randLabel === '隨機跟隨';
  check(`${tag} [互斥正向] 跟隨中點附近車站：跟隨 state 全清、小卡消失、附近卡開啟`,
    forwardStateClean && forwardUiClean && forward.nearOpen,
    JSON.stringify(forward));

  // 反向：附近卡開著時點隨機跟隨，附近 state/UI 收掉且跟隨開始。
  await tapCenter(page, '#randBtn');
  await page.waitForFunction(() => state.autoTour && !!(state.followTrain || state.freqFollow), null, { timeout: 5000 });
  const reverse = await snapshot(page);
  check(`${tag} [互斥反向] 附近車站開著時點隨機跟隨：附近 state/UI 收掉、跟隨開始`,
    actionOf(reverse) === 'rand' && reverse.meLoc === null && reverse.nearHidden
      && (!reverse.followPanelHidden || !reverse.freqCardHidden),
    JSON.stringify(reverse));

  await resetModes(page);
}

async function launchForVerification(engineName, engine) {
  try {
    return { browser: await engine.launch(), mode: 'default' };
  } catch (firstError) {
    // 受限 macOS runner 可能禁止 Chromium 子行程的 Mach rendezvous；單行程仍是真 Chromium
    // 引擎與真實 touch input，只是運作拓樸不同。一般環境不會走到這條。
    if (engineName === 'chromium') {
      try {
        return { browser: await engine.launch({ args: ['--single-process', '--no-zygote'] }), mode: 'single-process fallback' };
      } catch (secondError) {
        throw new Error(`default: ${firstError}\nsingle-process: ${secondError}`);
      }
    }
    throw firstError;
  }
}

const matrix = await runEngineMatrix(async ({ engineUrl, check: engineCheck }) => {
  matrixCheck = engineCheck;
  for (const item of preflight) check(item.name, item.pass, item.detail);
  const browsers = [];
  try {
  for (const [engineName, engine] of ENGINES) {
    let browser, launchMode;
    try {
      ({ browser, mode: launchMode } = await launchForVerification(engineName, engine));
      check(`[G0] ${engineName} 引擎已啟動`, true, launchMode);
    } catch (error) {
      check(`[G0] ${engineName} 引擎已啟動`, false, String(error));
      continue;
    }
    browsers.push(browser);
    for (let widthIndex = 0; widthIndex < WIDTHS.length; widthIndex++) {
      const width = WIDTHS[widthIndex];
      // Chromium 單行程模式關 context 會連 browser 一起收掉；每寬度重開一個，避免第二組變成假失敗。
      if (widthIndex > 0 && launchMode === 'single-process fallback') {
        ({ browser, mode: launchMode } = await launchForVerification(engineName, engine));
        browsers.push(browser);
      }
      const tag = `${engineName}/${width}`;
      const context = await browser.newContext({
        viewport: { width, height: HEIGHTS[width] },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 1,
        locale: 'zh-TW',
      });
      await context.addInitScript(() => {
        try {
          localStorage.setItem('trainmap-howto-seen', '1');
          localStorage.setItem('trainmap-appearance', 'light');
        } catch (error) {}
      });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(String(error)));
      try {
        if (ROUTE_FALLBACK) {
          await page.route(BASE + '**', async route => {
            const asset = localAsset(route.request().url());
            await route.fulfill({
              status: asset.status,
              contentType: asset.contentType,
              headers: { 'cache-control': 'no-store' },
              body: asset.body,
            });
          });
        }
        const navigation = await page.goto(engineUrl(BASE + GEOMOCK), { waitUntil: 'domcontentloaded', timeout: 30000 });
        const navigationMd5 = navigation ? md5(Buffer.from(await navigation.body())) : null;
        check(`${tag} [G0] navigation response md5 與預期受測 index.html 相同`,
          navigationMd5 === expectedNavigationMd5,
          `expected=${expectedNavigationMd5} actual=${navigationMd5} source=${ROUTE_FALLBACK ? 'route' : 'listen(0)'}`);
        await page.waitForFunction(() => {
          try {
            return typeof state !== 'undefined' && state.ready === true
              && !!document.getElementById('randBtn') && !document.getElementById('randBtn').hidden
              && !!document.getElementById('nearBtn') && !document.getElementById('nearBtn').hidden
              && typeof loadGeoCache === 'function' && !!loadGeoCache();
          } catch (error) { return false; }
        }, null, { timeout: 45000 });
        await page.evaluate(() => {
          setSimSec(12 * 3600);
          state.clockAtNow = false;
        });
        const running = await page.evaluate(() => state.trains.filter(t => trainPos(t, state.simSec)).length);
        check(`${tag} [前置] 正午有可供隨機跟隨的行駛中列車`, running > 0, `running=${running}`);
        await auditHotzones(page, tag);
        await verifyMutex(page, tag);
        check(`${tag} [前置] 零 pageerror`, pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '));
      } catch (error) {
        check(`${tag} [執行] 完整跑完`, false, `${error && error.stack || error}; pageerrors=${pageErrors.join(' | ')}`);
      } finally {
        await context.close();
      }
    }
  }
  } finally {
    for (const browser of browsers) await browser.close().catch(() => {});
  }
});
if (server.listening) await new Promise(resolve => server.close(resolve));

console.log(`\n──────── ${matrix.assertions.length - matrix.failures.length}/${matrix.assertions.length} PASS ────────`);
if (matrix.failures.length) {
  console.log(`變紅項：${matrix.failures.map(result => result.label).join(' ； ')}`);
  if (typeof process !== 'undefined') process.exitCode = 1;
  else throw new Error(`驗收失敗 ${matrix.failures.length} 項`);
} else console.log('全部 PASS');
