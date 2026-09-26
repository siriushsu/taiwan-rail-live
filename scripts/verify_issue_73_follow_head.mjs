// GitHub issue #73：iPhone 點列車後，左下跟車卡的車次與時速沒有對在同一條基線。
//
// 這支不直接呼叫 setFollow() 製造卡片：它在真觸控 context 裡找一張可點的車牌，透過
// page.tap() 點地圖，再等實際跟車狀態成立。WebKit 是原問題的引擎；Chromium 是零回歸對照。
// MUTATE=1 會把車次改回 align-self:center，供突變驗證（WebKit 應紅，正常驗收勿帶）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const MUTATE = process.env.MUTATE === '1';
const ONLY = process.env.ONLY || '';
const QUICK = process.env.QUICK === '1';
const WIDTHS = process.env.TEST_WIDTH ? [Number(process.env.TEST_WIDTH)] : QUICK ? [390] : [360, 375, 390, 414, 768];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
};

for (const [fragment, label] of [
  ['.follow-panel .fp-head > b { align-self: baseline; }', '車次加入 flex baseline 群組'],
  ['white-space: nowrap; align-self: baseline;', '時速維持 flex baseline 群組'],
  ['<b id="fpTrain"></b>', '車次欄位'],
  ['<span class="spd" id="fpSpd"></span>', '時速欄位'],
]) {
  if (!INDEX.includes(fragment)) throw new Error(`G0 找不到「${label}」：${fragment}`);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"error":"offline test"}');
    return;
  }
  let target = path.join(ROOT, decodeURIComponent(url.pathname));
  if (url.pathname.endsWith('/')) target = path.join(target, 'index.html');
  if (!path.resolve(target).startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    response.writeHead(404); response.end('Not found'); return;
  }
  response.writeHead(200, { 'content-type': MIME[path.extname(target)] || 'application/octet-stream' });
  fs.createReadStream(target).pipe(response);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}/`;

let assertions = 0;
const failures = [];
const rows = [];
const check = (name, pass, detail = '') => {
  assertions++;
  if (!pass) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

async function runCase(engineName, engine, width) {
  const height = width >= 700 ? 1024 : 844;
  const context = await engine.launch(engineName === 'chromium'
    ? { channel: 'chromium', headless: true }
    : { headless: true });
  const pageContext = await context.newContext({
    viewport: { width, height }, locale: 'zh-TW', isMobile: true, hasTouch: true,
    deviceScaleFactor: 2,
  });
  await pageContext.addInitScript(() => {
    localStorage.setItem('trainmap-howto-seen', '1');
    localStorage.setItem('trainmap-appearance', 'light');
    localStorage.setItem('trainmap-ui-scale', '1');
    localStorage.setItem('trainmap-fprail-min', '0');
    localStorage.setItem('ri-trains-enabled', '0');
  });
  const page = await pageContext.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(`console: ${message.text()}`);
  });
  const tag = `${engineName}/${width}px`;

  try {
    // issue #73 回報值：全台同框、21:49、z14、24.0893/120.5468。
    await page.goto(`${BASE}?g=all&at=24.0893,120.5468&z=14&t=21:49&lang=zh-TW`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      try { return state.ready === true && state.trains?.length > 0 && state._trainHits?.length > 0; } catch (error) { return false; }
    }, null, { timeout: 120000 });
    await page.waitForTimeout(700);

    // 360px 時回報座標只露出 2253 次牌框不到 1px（中心已在 x<0），真手指沒有可點面積。
    // 先證明同一個回報 URL 已正常開機，再把鏡頭移到同一班行進車上；其餘四寬保留原視角直接點。
    if (width === 360) {
      const centered = await page.evaluate(() => {
        const tr = state.trains.find(item => item.sys === 'tra_sched' && String(item.train) === '2253');
        const p = tr && trainPos(tr, state.simSec);
        if (!p) return false;
        state.playing = false; state._autoPan = true;
        M.setView([p.lat, p.lon], 14, { animate: false });
        state._autoPan = false; reproject(); draw();
        return true;
      });
      check(`${tag} A0 窄螢幕把回報現場的 2253 次移進可點範圍`, centered);
      await page.waitForTimeout(500);
    }

    // 凍結畫面後，找「單一車牌、離站夠遠、沒有被任何控件蓋住」的一班行駛中列車。
    const selection = await page.evaluate(() => {
      state.playing = false;
      const map = M.getContainer(), mr = map.getBoundingClientRect();
      const stationPts = (state.schedStations || []).map(st => mapDetailPoint([st.lat, st.lon]));
      const candidates = [], samples = [], rejected = { edge: 0, multi: 0, station: 0, covered: 0, slow: 0 };
      for (const hit of (state._trainHits || [])) {
        if (!hit.tr) {
          rejected.edge++;
          if (samples.length < 6) samples.push({ train: hit.tr?.train, x: hit.x, y: hit.y, reason: 'edge' });
          continue;
        }
        // 回報視角的 2253 次牌中心在 x=4.3，牌身仍有一半畫在畫面內。把觸控點夾到 12px，
        // 再由 trainsAt 證明那個「看得見的牌邊」確實仍屬同一班車；不能把整台車當成離屏。
        const tapX = Math.max(12, Math.min(mr.width - 12, hit.x));
        const tapY = Math.max(12, Math.min(mr.height - 12, hit.y));
        const picked = trainsAt({ x: tapX, y: tapY });
        if (picked.length !== 1 || picked[0].tr !== hit.tr) { rejected.multi++; continue; }
        const stationDistance = stationPts.reduce((best, point) => Math.min(best, Math.hypot(point.x - tapX, point.y - tapY)), Infinity);
        if (stationDistance <= stationHitRadius() + 10) { rejected.station++; continue; }
        const under = document.elementFromPoint(mr.left + tapX, mr.top + tapY);
        if (!under || !(under === map || map.contains(under))) {
          rejected.covered++;
          if (samples.length < 6) samples.push({ train: hit.tr.train, x: hit.x, y: hit.y,
            under: under ? `${under.tagName}#${under.id}.${under.className}` : null });
          continue;
        }
        const a = trainPos(hit.tr, state.simSec), b = trainPos(hit.tr, state.simSec + 20);
        const kmh = a && b ? Math.min(haversineKm(a, b) / 20 * 3600, speedCapOf(hit.tr)) : 0;
        if (kmh < 20) { rejected.slow++; continue; }
        candidates.push({ train: String(hit.tr.train), sys: hit.tr.sys, x: tapX, y: tapY,
          kmh, stationDistance, centerDistance: Math.hypot(tapX - mr.width / 2, tapY - mr.height / 2) });
      }
      candidates.sort((a, b) => a.centerDistance - b.centerDistance || b.stationDistance - a.stationDistance);
      return { target: candidates[0] || null, debug: { mapId: map.id, hits: state._trainHits?.length || 0,
        map: { width: mr.width, height: mr.height }, rejected, samples } };
    });
    const target = selection.target;
    check(`${tag} A1 找得到不與車站／控件重疊的行駛中列車`, !!target, JSON.stringify(selection.debug));
    if (!target) return;

    // 真觸控點 canvas 車牌；若命中測試、座標或事件路徑壞掉，下面的 followTrain 不會成立。
    await page.tap('#map', { position: { x: target.x, y: target.y }, timeout: 15000 });
    await page.waitForFunction(({ train, sys }) => state.followTrain
      && String(state.followTrain.train) === train && state.followTrain.sys === sys,
    { train: target.train, sys: target.sys }, { timeout: 10000 });
    await page.waitForFunction(() => {
      const panel = document.getElementById('followPanel');
      return panel && !panel.hidden && /km\/h/.test(document.getElementById('fpSpd')?.textContent || '');
    });
    await page.waitForTimeout(850);
    check(`${tag} A2 page.tap 車牌後跟到同一班車`, true, `${target.sys} ${target.train}／${target.kmh.toFixed(1)} km/h`);

    if (MUTATE) await page.addStyleTag({ content: '.follow-panel .fp-head > b { align-self:center !important; }' });

    const scenarioRows = [];
    const scenarios = [
      { name: 'fullscreen', font: 'std' },
      { name: 'alert', font: 'large' },
      { name: 'sheet', font: 'xlarge' },
    ];
    for (const scenario of scenarios) {
      await page.evaluate(({ name, font }) => {
        state.playing = false;
        const ride = document.getElementById('ridePanel');
        if (ride && !ride.hidden) closeRidePanel();
        document.body.classList.add('fs'); // 手機殼本來就不可退出全畫面，明寫成驗收前提。
        state._setFontFollowSys(false);
        state._setFontScale(font);
        if (name === 'alert') {
          state.alert = { at: Date.now(), list: [{ title: '驗收用營運公告', start: '2026-09-26 21:49' }] };
          renderAlertBanner(); // 手機的正式形態是頂列 ⚠ chip，不是桌面橫幅。
        }
        if (name === 'sheet') openRidePanel();
        M.resize(); reproject();
      }, scenario);
      await page.waitForTimeout(700); // 等跟車卡／sheet 的位移與 opacity transition 穩定。

      const metrics = await page.evaluate(({ name, font }) => {
        const visible = element => {
          if (!element || element.hidden) return false;
          let opacity = 1;
          for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            opacity *= Number.parseFloat(style.opacity) || 0;
          }
          const box = element.getBoundingClientRect();
          return opacity >= 0.05 && box.width > 1 && box.height > 1;
        };
        const baseline = element => {
          const marker = document.createElement('i');
          marker.style.cssText = 'display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline';
          element.appendChild(marker);
          const y = marker.getBoundingClientRect().top;
          marker.remove();
          return y;
        };
        const panel = document.getElementById('followPanel');
        const train = document.getElementById('fpTrain');
        const speed = document.querySelector('#fpSpd > b');
        const close = document.getElementById('fpClose');
        const pr = panel.getBoundingClientRect(), cr = close.getBoundingClientRect();
        const closeHit = document.elementFromPoint(cr.left + cr.width / 2, cr.top + cr.height / 2);
        const others = ['#topbar', '#clock', '#randBtn', '#nearBtn', '#fsFab', '#alertBanner',
          '#alertDetail', '#alertChip', '#dwellPlate', '.tabbar', '.controls', '#ridePanel',
          '#searchPanel', '#explorePanel', '#favPanel', '#nearCard', '#xingCard', '#followLockBtn']
          .flatMap(selector => [...document.querySelectorAll(selector)]).filter(visible);
        const collisions = [];
        for (const other of others) {
          if (panel.contains(other) || other.contains(panel)) continue;
          const r = other.getBoundingClientRect();
          const ox = Math.min(pr.right, r.right) - Math.max(pr.left, r.left);
          const oy = Math.min(pr.bottom, r.bottom) - Math.max(pr.top, r.top);
          if (ox > 2 && oy > 2) collisions.push(`${other.id || other.className}:${Math.round(ox)}x${Math.round(oy)}`);
        }
        const oldSpeed = speed.textContent;
        const baselineDeltas = ['0', oldSpeed || '52', '135'].map(value => {
          speed.textContent = value;
          return Math.abs(baseline(train) - baseline(speed));
        });
        speed.textContent = oldSpeed;
        return {
          which: name, font, train: train.textContent.trim(), speed: document.getElementById('fpSpd').textContent.trim(),
          baselineDeltas, delta: Math.max(...baselineDeltas),
          alignSelf: getComputedStyle(train).alignSelf,
          panelVisible: visible(panel), panelInViewport: pr.left >= -1 && pr.right <= innerWidth + 1 && pr.top >= -1 && pr.bottom <= innerHeight + 1,
          closeReachable: close === closeHit || close.contains(closeHit), collisions,
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          panelOverflow: panel.scrollWidth - panel.clientWidth,
          dataFs: document.documentElement.getAttribute('data-fs'),
          fs: document.body.classList.contains('fs'), sheetOpen: document.body.classList.contains('sheet-open'),
          alertVisible: visible(document.getElementById('alertChip')) || visible(document.getElementById('alertBanner')),
        };
      }, scenario);
      scenarioRows.push(metrics);
      const pfx = `${tag} ${scenario.name}/${scenario.font}`;
      check(`${pfx} B1 車次與時速基線差不超過 0.25px`, metrics.delta <= 0.25,
        `0/實速/135kmh=${metrics.baselineDeltas.map(value => value.toFixed(6)).join('/')} align-self=${metrics.alignSelf}`);
      check(`${pfx} B2 跟車卡完整在 viewport`, metrics.panelVisible && metrics.panelInViewport, JSON.stringify(metrics));
      check(`${pfx} B3 關閉鈕 elementFromPoint 真正可達`, metrics.closeReachable);
      check(`${pfx} B4 跟車卡不與既有浮層相交`, metrics.collisions.length === 0, metrics.collisions.join('、'));
      check(`${pfx} B5 頁面與跟車卡無水平溢出`, metrics.pageOverflow <= 1 && metrics.panelOverflow <= 1,
        `page=${metrics.pageOverflow}px panel=${metrics.panelOverflow}px`);
      check(`${pfx} B6 狀態矩陣與字級真的成立`, metrics.fs
        && (scenario.name !== 'alert' || metrics.alertVisible)
        && (scenario.name !== 'sheet' || metrics.sheetOpen)
        && metrics.dataFs === (scenario.font === 'std' ? null : scenario.font), JSON.stringify(metrics));
    }

    // 控件不是「幾何看起來能點」就算：最後真 tap ×，必須收成膠囊且跟車不中斷。
    await page.evaluate(() => { if (!document.getElementById('ridePanel').hidden) closeRidePanel(); });
    await page.waitForTimeout(150);
    await page.tap('#fpClose');
    const closeResult = await page.evaluate(({ train, sys }) => ({
      compact: document.getElementById('followPanel').classList.contains('fp-min'),
      same: !!state.followTrain && String(state.followTrain.train) === train && state.followTrain.sys === sys,
      ...(() => {
        const marker = element => {
          const node = document.createElement('i');
          node.style.cssText = 'display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline';
          element.appendChild(node); const y = node.getBoundingClientRect().top; node.remove(); return y;
        };
        const panel = document.getElementById('followPanel'), end = document.getElementById('fpEnd');
        const er = end.getBoundingClientRect(), hit = document.elementFromPoint(er.left + er.width / 2, er.top + er.height / 2);
        return {
          baselineDelta: Math.abs(marker(document.getElementById('fpTrain')) - marker(document.querySelector('#fpSpd > b'))),
          overflow: panel.scrollWidth - panel.clientWidth,
          endReachable: end === hit || end.contains(hit),
        };
      })(),
    }), { train: target.train, sys: target.sys });
    check(`${tag} C1 真 tap 關閉鈕會收卡但不取消跟車`, closeResult.compact && closeResult.same, JSON.stringify(closeResult));
    check(`${tag} C2 膠囊態基線／溢出／結束鈕仍正常`, closeResult.baselineDelta <= 0.25
      && closeResult.overflow <= 1 && closeResult.endReachable, JSON.stringify(closeResult));
    check(`${tag} C3 零 pageerror／console.error`, errors.length === 0, errors.slice(0, 4).join(' | '));
    rows.push({ engine: engineName, width, train: `${target.sys}/${target.train}`,
      kmh: +target.kmh.toFixed(1), deltas: scenarioRows.map(row => +row.delta.toFixed(6)), errors: errors.length });
  } catch (error) {
    failures.push(`${tag} 測試流程中斷 — ${error.stack || error}`);
  } finally {
    await pageContext.close();
    await context.close();
  }
}

try {
  for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
    if (ONLY && ONLY !== engineName) continue;
    for (const width of WIDTHS) await runCase(engineName, engine, width);
  }
} finally {
  await new Promise(resolve => server.close(resolve));
}

for (const row of rows) console.log(`CASE ${row.engine}/${row.width}px ${row.train} ${row.kmh}km/h 基線差=${row.deltas.join('/')}px errors=${row.errors}`);
if (failures.length) {
  console.error(`Issue #73 跟車卡驗收失敗：${failures.length} 項／${assertions} 個斷言${MUTATE ? '（突變模式）' : ''}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
const ranEngines = [...new Set(rows.map(row => row.engine))].join(' + ');
console.log(`Issue #73 跟車卡驗收通過：${assertions}/${assertions}；${ranEngines}；${WIDTHS.join('/')}px；真觸控點車＋全畫面／公告／sheet 三態`);
