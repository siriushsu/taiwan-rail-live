#!/usr/bin/env node
// 轉乘提示前端驗收：動態埠、自有 index hash/BUILD 斷言、Chromium＋WebKit、
// 360/375/414/768 四寬度與真 touch tap。完整輸出可用 TRANSFER_UI_REPORT 指定。

import { createServer } from 'node:http';
import { createHash, randomInt } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = readFileSync(path.join(ROOT, 'index.html'));
const INDEX_MD5 = createHash('md5').update(INDEX).digest('hex');
const BUILD = /const BUILD = '([^']+)'/.exec(INDEX.toString('utf8'))?.[1];
if (!BUILD) throw new Error('index.html 找不到 BUILD');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
};
const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/axzhWQAAAABJRU5ErkJggg==', 'base64');

function localAsset(urlPath) {
  const url = new URL(urlPath, 'http://local');
  if (url.pathname.startsWith('/api/')) {
    // 高鐵動態端點要 404 才會走 repo 內 fallback；其他選用 API 回空 object，避免碰外部服務。
    return { status: url.pathname === '/api/thsr-schedule' ? 404 : 200, contentType: 'application/json', body: Buffer.from('{}') };
  }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname); }
  catch { return { status: 404, contentType: 'text/plain', body: Buffer.from('not found') }; }
  const file = path.resolve(ROOT, '.' + pathname);
  const rel = path.relative(ROOT, file);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !existsSync(file) || !statSync(file).isFile()) {
    return { status: 404, contentType: 'text/plain', body: Buffer.from('not found') };
  }
  const type = MIME[path.extname(file)];
  if (!type) return { status: 404, contentType: 'text/plain', body: Buffer.from('not found') };
  return {
    status: 200,
    contentType: type,
    body: readFileSync(file),
    headers: pathname === '/index.html' ? { 'x-railisland-index-md5': INDEX_MD5 } : {},
  };
}

let server = createServer((req, res) => {
  const asset = localAsset(req.url || '/');
  res.statusCode = asset.status;
  res.setHeader('content-type', asset.contentType);
  for (const [name, value] of Object.entries(asset.headers || {})) res.setHeader(name, value);
  res.end(asset.body);
});
let routeOnly = false;
let dynamicPort;
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('無法取得動態埠');
  dynamicPort = address.port;
} catch (e) {
  if (!e || e.code !== 'EPERM') throw e;
  routeOnly = true;
  dynamicPort = randomInt(20000, 60000);
  server = null;
}
const BASE = `http://127.0.0.1:${dynamicPort}`;

const reportPath = process.env.TRANSFER_UI_REPORT ? path.resolve(ROOT, process.env.TRANSFER_UI_REPORT) : null;
if (reportPath && path.relative(ROOT, reportPath).startsWith('..')) throw new Error('報告路徑不可離開 repo');
const lines = [];
const checks = [];
const log = text => { lines.push(text); console.log(text); };
const ok = (name, pass, detail = '') => {
  checks.push({ name, pass, detail });
  log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

try {
  if (routeOnly) log(`MODE route-only-fallback sandbox_listen=EPERM origin=${BASE}`);
  else {
    const served = Buffer.from(await (await fetch(`${BASE}/index.html`)).arrayBuffer());
    const servedMd5 = createHash('md5').update(served).digest('hex');
    ok('動態埠連到本 worktree 的 index.html', servedMd5 === INDEX_MD5, `port=${dynamicPort} md5=${servedMd5} expected=${INDEX_MD5}`);
  }

  const heights = { 360: 800, 375: 812, 414: 896, 768: 1024 };
  for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch();
    log(`ENGINE ${engineName}`);
    try {
      for (const width of [360, 375, 414, 768]) {
        const ctx = await browser.newContext({ viewport: { width, height: heights[width] }, isMobile: true, hasTouch: true });
        await ctx.addInitScript(() => {
          localStorage.setItem('trainmap-howto-seen', '1');
          localStorage.setItem('trainmap-appearance', 'light');
        });
        await ctx.route('**/*', async route => {
          const requestUrl = new URL(route.request().url());
          if (requestUrl.origin === BASE) {
            if (!routeOnly) { await route.continue(); return; }
            const asset = localAsset(requestUrl.pathname + requestUrl.search);
            await route.fulfill({ status: asset.status, contentType: asset.contentType, headers: asset.headers, body: asset.body });
            return;
          }
          if (route.request().resourceType() === 'image') {
            await route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng });
          } else if (requestUrl.hostname === 'cdnjs.cloudflare.com') {
            // Leaflet 本體與 CSS 由 index.html 從這個 CDN 載入。全攔式 route 把它一起回成 204 空 body 的話，
            // `L` 是 undefined、boot 當場拋錯，state.ready 永遠不會 true ⇒ 這支腳本結構上不可能綠。
            // repo 內其餘驗收腳本的慣例是只攔特定 /api/*、外部資源走真網路，這裡跟齊。圖磚仍被上面那條擋成透明 PNG。
            await route.continue();
          } else await route.fulfill({ status: 204, body: '' });
        });
        const page = await ctx.newPage();
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(String(error)));
        const nav = await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
        const servedMd5 = nav && (await nav.allHeaders())['x-railisland-index-md5'];
        ok(`${engineName} ${width} index MD5 身分`, servedMd5 === INDEX_MD5, `mode=${routeOnly ? 'route-only' : 'server'} md5=${servedMd5}`);
        // 逾時的成因幾乎都是 boot 靜默拋錯（缺外部資源、stub 回錯狀態碼），光看 timeout 訊息會往錯的方向查，
        // 所以把當下的 pageerror 一併吐出來——一行就能分辨「功能壞了」與「harness 環境沒配好」。
        try {
          await page.waitForFunction(() => typeof state !== 'undefined' && state.ready && state.stationTransfers, null, { timeout: 45000 });
        } catch (e) {
          const seen = await page.evaluate(() => (typeof state === 'undefined'
            ? 'state 未定義' : `ready=${!!state.ready} stationTransfers=${state.stationTransfers ? 'OBJ' : String(state.stationTransfers)}`)).catch(() => '無法求值');
          throw new Error(`${engineName} ${width} boot 未就緒（${seen}）— pageerror: ${pageErrors.slice(0, 3).join(' | ') || '(無)'}`);
        }
        const loadedBuild = await page.evaluate(() => BUILD);
        ok(`${engineName} ${width} BUILD 身分`, loadedBuild === BUILD, `page=${loadedBuild} expected=${BUILD}`);

        const picked = await page.evaluate(() => {
          const sys = state.systems.find(system => system.id === 'tra_sched');
          loadSystem(sys);
          const tr = state.trains.find(train => train.stops.some(stop => stop.name === '臺北' || stop.name === '台北'));
          if (!tr) return null;
          setFollow(tr, false, true);
          if (!document.body.classList.contains('fs') && state._setFs) state._setFs(true);
          return { train: tr.train, sys: tr.sys, station: tr.stops.find(stop => stop.name === '臺北' || stop.name === '台北').name };
        });
        ok(`${engineName} ${width} 具名台鐵案例可跟隨`, !!(picked && picked.sys === 'tra_sched'), JSON.stringify(picked));

        // 真的用 touch tap 點跟隨卡，走手機使用者展開列車 sheet 的入口。
        await page.tap('#fpDest');
        await page.waitForFunction(() => document.body.classList.contains('train-open') && !document.getElementById('tcStops').hidden);
        const transfer = await page.evaluate(() => {
          const rows = [...document.querySelectorAll('#tcStops .tc-st[data-i]')];
          const row = rows.find(item => {
            const stop = state.followTrain && state.followTrain.stops[+item.dataset.i];
            return stop && (stop.name === '臺北' || stop.name === '台北');
          });
          if (!row) return { found: false };
          row.scrollIntoView({ block: 'center' });
          const badge = row.querySelector('.tc-xfer');
          if (!badge) return { found: false, row: row.textContent };
          const n = row.querySelector('.n'), times = [...row.querySelectorAll(':scope > span:not(.n)')];
          const rb = row.getBoundingClientRect(), nb = n.getBoundingClientRect(), bb = badge.getBoundingClientRect();
          const firstTime = times[0] && times[0].getBoundingClientRect();
          const hit = document.elementFromPoint(bb.x + bb.width / 2, bb.y + bb.height / 2);
          return {
            found: true, title: badge.title, short: badge.querySelector('.tc-xfer-short')?.textContent,
            badgeVisible: bb.width > 0 && bb.height > 0,
            badgeInsideRow: bb.left >= rb.left - 1 && bb.right <= rb.right + 1 && bb.top >= rb.top - 1 && bb.bottom <= rb.bottom + 1,
            nameBeforeTime: !firstTime || nb.right <= firstTime.left + 1,
            hittable: !!hit && (hit === badge || badge.contains(hit)),
            docOverflow: document.documentElement.scrollWidth - innerWidth,
            cardOverflow: document.getElementById('trainCard').scrollWidth - document.getElementById('trainCard').clientWidth,
            stopsOverflow: document.getElementById('tcStops').scrollWidth - document.getElementById('tcStops').clientWidth,
          };
        });
        ok(`${engineName} ${width} 轉乘標記＋完整 tooltip`, transfer.found && /^可轉 .+/.test(transfer.title || '') && /^轉 \d+$/.test(transfer.short || ''), JSON.stringify(transfer));
        ok(`${engineName} ${width} 標記不壓到站名列／到開時刻`, transfer.badgeVisible && transfer.badgeInsideRow && transfer.nameBeforeTime, JSON.stringify(transfer));
        ok(`${engineName} ${width} 標記座標可實際命中`, transfer.hittable, JSON.stringify(transfer));
        ok(`${engineName} ${width} 無水平溢出`, transfer.docOverflow <= 1 && transfer.cardOverflow <= 1 && transfer.stopsOverflow <= 1, JSON.stringify(transfer));

        const controlScan = await page.evaluate(() => {
          const all = [...document.querySelectorAll('button,a,input,select,textarea,[role="button"],.tc-st[data-i]')];
          const items = [];
          for (const [index, el] of all.entries()) {
            const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
            if (r.width <= 0 || r.height <= 0 || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
            const x = r.x + r.width / 2, y = r.y + r.height / 2;
            if (x < 0 || x > innerWidth || y < 0 || y > innerHeight) continue;
            const hit = document.elementFromPoint(x, y);
            if (!hit || !(hit === el || el.contains(hit))) continue;
            items.push({ index, el, name: el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${el.className || ''}`, r });
          }
          const overlaps = [];
          for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
            const a = items[i], b = items[j];
            if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
            const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
            const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
            if (w > 2 && h > 2) overlaps.push(`${a.name}×${b.name}`);
          }
          return { accessibleControls: items.length, overlaps: overlaps.slice(0, 12) };
        });
        ok(`${engineName} ${width} 可及互動控件兩兩無遮疊`, controlScan.overlaps.length === 0, JSON.stringify(controlScan));

        // 告警 chip 顯示與抽屜展開兩個既有狀態；確認新標記沒有讓 viewport 溢出。
        await page.evaluate(() => { const chip = document.getElementById('alertChip'); chip.hidden = false; chip.querySelector('#alertChipN').textContent = '1'; });
        const alertOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        ok(`${engineName} ${width} fs＋列車 sheet＋告警狀態無橫溢出`, alertOverflow <= 1, `overflow=${alertOverflow}`);
        await page.tap('#tabMore');
        const drawer = await page.evaluate(() => ({ open: document.body.classList.contains('tools-open'), overflow: document.documentElement.scrollWidth - innerWidth }));
        ok(`${engineName} ${width} 抽屜觸控展開無橫溢出`, drawer.open && drawer.overflow <= 1, JSON.stringify(drawer));
        ok(`${engineName} ${width} 無 pageerror`, pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
        await ctx.close();
      }

      // 桌面完整標記。上面四個寬度全部 ≤900px，統統落在手機媒體查詢裡，
      // `.tc-xfer-wide` 一次都沒被渲染過——而它才是主要顯示形態（手機那顆「轉 N」是收合版）。
      // 靜態 gate 只驗得到「兩條 CSS 規則都在」，驗不到「桌面實際畫出完整路線名」，所以這裡補一輪真桌面。
      {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        await ctx.addInitScript(() => {
          localStorage.setItem('trainmap-howto-seen', '1');
          localStorage.setItem('trainmap-appearance', 'light');
        });
        await ctx.route('**/*', async route => {
          const requestUrl = new URL(route.request().url());
          if (requestUrl.origin === BASE) { await route.continue(); return; }
          if (route.request().resourceType() === 'image') await route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng });
          else if (requestUrl.hostname === 'cdnjs.cloudflare.com') await route.continue();
          else await route.fulfill({ status: 204, body: '' });
        });
        const page = await ctx.newPage();
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(String(error)));
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
        try {
          await page.waitForFunction(() => typeof state !== 'undefined' && state.ready && state.stationTransfers, null, { timeout: 45000 });
        } catch {
          throw new Error(`${engineName} 1280 boot 未就緒 — pageerror: ${pageErrors.slice(0, 3).join(' | ') || '(無)'}`);
        }
        await page.evaluate(() => {
          loadSystem(state.systems.find(system => system.id === 'tra_sched'));
          const tr = state.trains.find(train => train.sys === 'tra_sched'
            && train.stops.some(stop => stop.name === '臺北' || stop.name === '台北')
            && train.stops.some(stop => stop.name === '板橋'));
          followTrainNo(tr.train, { sys: tr.sys });
        });
        // 桌面的列車卡本來就展開，`train-open` 是手機 sheet 專用的類名；停靠表另外由 #tcTT 收合，
        // 所以這裡走桌面使用者真正的入口——點展開鈕，不是點手機那顆目的地。
        await page.click('#tcTT');
        await page.waitForFunction(() => !document.getElementById('tcStops').hidden);
        const wide = await page.evaluate(() => {
          const rows = [...document.querySelectorAll('#tcStops .tc-st[data-i]')];
          const row = rows.find(item => {
            const stop = state.followTrain && state.followTrain.stops[+item.dataset.i];
            return stop && (stop.name === '臺北' || stop.name === '台北');
          });
          if (!row) return { found: false };
          row.scrollIntoView({ block: 'center' });
          const badge = row.querySelector('.tc-xfer');
          if (!badge) return { found: false, row: row.textContent };
          const w = badge.querySelector('.tc-xfer-wide'), s = badge.querySelector('.tc-xfer-short');
          const wr = w.getBoundingClientRect(), sr = s.getBoundingClientRect();
          const rb = row.getBoundingClientRect(), bb = badge.getBoundingClientRect();
          const times = [...row.querySelectorAll(':scope > span:not(.n)')];
          const firstTime = times[0] && times[0].getBoundingClientRect();
          return {
            found: true, wideText: w.textContent, wideShown: getComputedStyle(w).display !== 'none' && wr.width > 0 && wr.height > 0,
            shortHidden: getComputedStyle(s).display === 'none' && sr.width === 0,
            badgeInsideRow: bb.left >= rb.left - 1 && bb.right <= rb.right + 1 && bb.top >= rb.top - 1 && bb.bottom <= rb.bottom + 1,
            nameBeforeTime: !firstTime || bb.right <= firstTime.left + 1,
            docOverflow: document.documentElement.scrollWidth - innerWidth,
            stopsOverflow: document.getElementById('tcStops').scrollWidth - document.getElementById('tcStops').clientWidth,
          };
        });
        ok(`${engineName} 1280 桌面顯示完整路線名（非收合版）`, wide.found && wide.wideShown && wide.shortHidden && /^可轉 .+、.+/.test(wide.wideText || ''), JSON.stringify(wide));
        ok(`${engineName} 1280 完整標記不壓到到開時刻／不撐破版面`, wide.found && wide.badgeInsideRow && wide.nameBeforeTime && wide.docOverflow <= 1 && wide.stopsOverflow <= 1, JSON.stringify(wide));
        ok(`${engineName} 1280 無 pageerror`, pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
        await ctx.close();
      }
    } finally { await browser.close(); }
  }
} catch (e) {
  const raw = [String(e && e.message || e), ...((e && e.log) || [])].join('\n');
  const fatal = raw.split('\n').find(line => /FATAL:|Permission denied/.test(line));
  const message = String(e && e.message || e).split('\n').slice(0, 3).join(' | ') + (fatal ? ` | ${fatal.trim()}` : '');
  ok('Chromium／WebKit 手機矩陣可啟動', false, message);
  log(`BROWSER_BLOCKED ${message}`);
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
}

const failures = checks.filter(check => !check.pass);
log(`RESULT checks=${checks.length} failures=${failures.length} status=${failures.length ? 'RED' : 'GREEN'}`);
if (reportPath) writeFileSync(reportPath, lines.join('\n') + '\n');
process.exit(failures.length ? 1 : 0);
