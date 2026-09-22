// 「附近車站」卡收得掉 驗收。
//
// 為什麼有這支:2026-09-18 使用者回報「按定位跳出附近的車站，然後關不掉，只能選車站才能關掉」。
// 實測到的根因是出口不對等——點地圖空白處,車站看板收得掉(tapBlank 的既有行為),附近車站卡不收;
// 下滑到最小段就停住不再有反應;標題列那顆 ✕ 只有 20×18px。三個出口都不通,使用者剩下的唯一出路
// 就是點清單裡的一站(開了看板,而看板點地圖就收得掉)⇒ 看起來就是「只有選車站才關得掉」。
//
// 正常驗收：
//   node scripts/verify_near_dismiss.mjs
// 突變對照（三者都應回傳非 0）：
//   MUT=blank node scripts/verify_near_dismiss.mjs   # 還原「點地圖空白處不收附近卡」
//   MUT=swipe node scripts/verify_near_dismiss.mjs   # 還原「下滑到最小段就停住」
//   MUT=hit   node scripts/verify_near_dismiss.mjs   # 還原 ✕ 的 20×18px 觸控目標
//
// 腳本自己用 listen(0) 開靜態 server，並以 md5 確認瀏覽器拿到的正是當下工作樹。
// 所有操作都走真觸控座標，不直呼 closeNearbyStations() 之類的實作函式——這支閘門要驗的正是
// 「手指做得到嗎」,呼叫函式只會證明函式存在(它本來就存在,bug 也照樣在)。
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
const MUT = (typeof process !== 'undefined' && process.env && process.env.MUT) || globalThis.__RAIL_VERIFY_MUT || '';
const MUTATIONS = {
  blank: [
    {
      from: `    const nc = document.getElementById('nearCard');\n    if (nc && !nc.hidden) closeNearbyStations();\n`,
      to: '',
    },
  ],
  swipe: [
    {
      from: `  if (direction < 0 && i === 0 && el.id === 'nearCard') { closeNearbyStations(); return; }\n`,
      to: '',
    },
  ],
  hit: [
    {
      from: `    .xing-card .xc-close::after { content: ""; position: absolute; left: 50%; top: 50%; width: 44px; height: 30px; transform: translate(-50%, -50%); }`,
      to: `    .xing-card .xc-close::after { content: none; }`,
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
const navigationIndex = servedIndex;

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

function localAsset(requestUrl) {
  try {
    const url = new URL(requestUrl, 'http://local.test');
    if (url.pathname.startsWith('/api/')) {
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
} else {
  const wire = Buffer.from(await (await fetch(BASE)).arrayBuffer());
  const wireMd5 = md5(wire);
  check('[G0] 動態埠 server 內容與預期受測內容逐 byte 相同', wireMd5 === expectedNavigationMd5,
    `ROOT=${ROOT} BUILD=${build} disk=${diskMd5} wire=${wireMd5} BASE=${BASE} MUT=${MUT || 'none'}`);
  if (!MUT) check('[G0] 正常模式 server md5 與磁碟 index.html 相同', wireMd5 === diskMd5);
}
if (MUT) check(`[G0] 突變 ${MUT} 確實改變受測位元`, expectedWireMd5 !== diskMd5,
  `disk=${diskMd5} mutant=${expectedWireMd5}`);

// 寬度取 CONTRIBUTING 指定的手機三檔(768 是平板/桌面,那裡附近車站卡不是底部 sheet、沒有段高,
// 由 verify_map_action_mutex 的版面斷言負責)。
const HEIGHTS = { 360: 780, 375: 812, 414: 896 };
const WIDTHS = MUT ? [375] : [360, 375, 414];
const ENGINE_FILTER = (typeof process !== 'undefined' && process.env && process.env.ENGINE) || globalThis.__RAIL_VERIFY_ENGINE || '';
const ALL_ENGINES = MUT ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]];
const ENGINES = ENGINE_FILTER ? ALL_ENGINES.filter(([name]) => name === ENGINE_FILTER) : ALL_ENGINES;
if (!ENGINES.length) throw new Error(`未知引擎 ENGINE=${ENGINE_FILTER}`);
// 台北車站:附近 5km 內站很多,清單一定列得出來;定位精度 20m 讓藍點與蓋章判定都成立。
const GEOMOCK = '?geomock=25.0478,121.5170&geodelay=0&geoacc=20';

const nearOpen = page => page.evaluate(() => {
  const el = document.getElementById('nearCard');
  return !!el && !el.hidden && !!state.meLoc;
});
const boardOpen = page => page.evaluate(() => {
  const el = document.getElementById('board');
  return !!el && !el.hidden;
});

// 開卡一律走地圖上那顆「附近車站」鈕的真觸控,不呼叫 showNearby()。
async function openNear(page) {
  const box = await page.locator('#nearBtn').boundingBox();
  if (!box) throw new Error('#nearBtn 沒有可點的 bounding box');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => !!state.meLoc && !document.getElementById('nearCard').hidden, null, { timeout: 8000 });
}

// 標題列抓把的上/下滑:用 pointer 事件序列(initSheetHandle 綁的就是 pointerdown/move/up),
// 每次都在手勢開始前重新量一次卡片位置——段高一變卡片上緣就跟著動,沿用舊座標會滑到卡外的地圖上。
async function sheetSwipe(page, dy) {
  await page.waitForTimeout(500); // 等段高轉場收斂再量,否則量到的是動畫中途的位置
  const from = await page.evaluate(() => {
    const el = document.getElementById('nearCard');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 14), small: el.classList.contains('sheet-small') };
  });
  const common = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };
  await page.dispatchEvent('#nearCard', 'pointerdown', { ...common, clientX: from.x, clientY: from.y });
  await page.dispatchEvent('#nearCard', 'pointermove', { ...common, clientX: from.x, clientY: from.y + dy });
  await page.dispatchEvent('#nearCard', 'pointerup', { ...common, clientX: from.x, clientY: from.y + dy });
  await page.waitForTimeout(350);
  const after = await page.evaluate(() => {
    const el = document.getElementById('nearCard');
    if (el.hidden || !state.meLoc) return 'closed';
    return el.classList.contains('sheet-small') ? 'small' : 'medium';
  });
  return { before: from.small ? 'small' : 'medium', after };
}

// 卡片以外、地圖上真正的空白處:取卡片上緣與工具列之間那一帶的左側。
async function blankMapPoint(page) {
  return page.evaluate(() => {
    const card = document.getElementById('nearCard').getBoundingClientRect();
    const actions = document.getElementById('mapActions').getBoundingClientRect();
    const top = Math.max(actions.bottom + 20, innerHeight * 0.45);
    return { x: 24, y: Math.round(Math.min(top, card.top - 24)) };
  });
}

async function verifyDismiss(page, tag) {
  // [前置] 卡開得起來
  await openNear(page);
  check(`${tag} [前置] 按地圖上的「附近車站」鈕開得出清單卡`, await nearOpen(page));

  // [出口A] 點地圖空白處 ⇒ 收起(與車站看板同一條規則)
  const blank = await blankMapPoint(page);
  await page.touchscreen.tap(blank.x, blank.y);
  await page.waitForTimeout(400);
  check(`${tag} [出口A] 卡開著時點地圖空白處就收起來`, !(await nearOpen(page)),
    `tap=${JSON.stringify(blank)}`);

  // [對照] 同一個空白點,車站看板本來就收得掉——證明上面那條不是靠別的機制僥倖過關
  await page.evaluate(() => {
    const st = state.schedStations.find(s => s.name === '臺北' || s.name === '台北') || state.schedStations[0];
    openBoard(st);
  });
  await page.waitForTimeout(300);
  const boardWasOpen = await boardOpen(page);
  await page.touchscreen.tap(blank.x, blank.y);
  await page.waitForTimeout(400);
  check(`${tag} [對照] 同一個空白點對車站看板同樣有效(收口一致)`,
    boardWasOpen && !(await boardOpen(page)));

  // [出口B] 標題列下滑 ⇒ 收起(在最小段仍然要收,不是縮到最小就停住)
  // 只做下滑手勢、不夾雜輕點:輕點會循環段高,卡片高度一變,下一個座標就可能落到卡外的地圖上,
  // 那時收起來的其實是[出口A],等於白驗(第一版就踩到這個坑,MUT=swipe 照樣全綠)。
  await openNear(page);
  const swipeLog = [];
  const up = await sheetSwipe(page, -70); swipeLog.push({ dir: 'up', ...up });
  const down1 = await sheetSwipe(page, 70); swipeLog.push({ dir: 'down', ...down1 });
  const down2 = await sheetSwipe(page, 70); swipeLog.push({ dir: 'down', ...down2 });
  // 手勢真的有被標題列收到的證據:上滑放大、下滑縮小都看得到段高變化。少了這一條,
  // 「滑完就關了」也可能是別的機制(例如[出口A])順手關掉的,那就等於沒驗到下滑本身。
  check(`${tag} [出口B] 標題列收得到上/下滑手勢(小段↑中段、中段↓小段)`,
    up.after === 'medium' && down1.after === 'small', JSON.stringify(swipeLog));
  check(`${tag} [出口B] 已經在最小段再下滑一次就收起來`, down2.after === 'closed', JSON.stringify(swipeLog));

  // [出口C] ✕ 的觸控目標:離字形中心 18px 的地方要打得到那顆鈕,而且真的收得掉
  await openNear(page);
  const hit = await page.evaluate(() => {
    const btn = document.getElementById('nearClose');
    const r = btn.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const probe = { x: Math.round(cx - 18), y: Math.round(cy) };
    const el = document.elementFromPoint(probe.x, probe.y);
    return { glyph: { w: Math.round(r.width), h: Math.round(r.height) }, probe, hitsClose: el === btn || (el && el.closest && el.closest('#nearClose') === btn) };
  });
  check(`${tag} [出口C] ✕ 的可觸控範圍往外擴到至少 44px 寬(字形本身仍是小圖示)`,
    hit.hitsClose, JSON.stringify(hit));
  await page.touchscreen.tap(hit.probe.x, hit.probe.y);
  await page.waitForTimeout(400);
  check(`${tag} [出口C] 點在 ✕ 字形旁邊(擴大後的命中區)也真的把卡收掉`, !(await nearOpen(page)));

  // [不誤傷] 點清單裡的一站仍然開得了車站看板(原本唯一的出路不能被改壞)
  await openNear(page);
  const row = await page.locator('#nearCard .nx-row').first().boundingBox();
  if (row) {
    await page.touchscreen.tap(row.x + 40, row.y + row.height / 2);
    await page.waitForTimeout(500);
  }
  check(`${tag} [不誤傷] 點清單裡的一站照樣開車站看板`, !!row && await boardOpen(page));
  await page.evaluate(() => { closeBoard(); closeNearbyStations(); });
}

async function launchForVerification(engineName, engine) {
  try {
    return { browser: await engine.launch(), mode: 'default' };
  } catch (firstError) {
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
            localStorage.setItem('trainmap-query-open', '0'); // 查詢 sheet 不要自己開起來搶 soloPanel
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
                && !!document.getElementById('nearBtn') && !document.getElementById('nearBtn').hidden;
            } catch (error) { return false; }
          }, null, { timeout: 45000 });
          // 開機自動開的查詢 sheet 與教學卡都先讓開:這支閘門要驗的是附近車站卡自己的出口。
          await page.evaluate(() => {
            const hw = document.getElementById('howtoWrap'); if (hw) hw.remove();
            const sp = document.getElementById('searchPanel'); if (sp && !sp.hidden) closeSearchPanel({ user: true });
            setSimSec(12 * 3600); state.clockAtNow = false;
          });
          await verifyDismiss(page, tag);
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
