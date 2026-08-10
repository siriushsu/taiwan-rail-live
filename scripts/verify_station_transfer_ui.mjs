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

        // ── 落點 A：車站看板的站況區（回答「這站是什麼」）──
        // 站物件一律取 app 自己的索引（helpNearestStation），不自組。轉乘查找的真正過濾器是
        // criteria.maxDistanceM 的座標閘門，餵一顆只有站名沒有座標的假物件，會結構性地永遠查無而假紅。
        const board = await page.evaluate(() => {
          map.setView([25.0478, 121.5170], 15); // 台北車站
          const st = helpNearestStation();
          if (!st) return { found: false, why: 'helpNearestStation 在台北車站視野回空' };
          openBoard(st);
          const meta = document.querySelector('#board .stnMeta');
          const xfer = meta && meta.querySelector('.xfer');
          if (!xfer) return { found: false, station: st.name, meta: meta ? meta.textContent.slice(0, 80) : '(無 stnMeta)' };
          xfer.scrollIntoView({ block: 'center' });
          const xb = xfer.getBoundingClientRect(), mb = meta.getBoundingClientRect();
          const bd = document.getElementById('board');
          const hit = document.elementFromPoint(xb.x + xb.width / 2, xb.y + xb.height / 2);
          return {
            found: true, station: st.name, text: xfer.textContent,
            visible: xb.width > 0 && xb.height > 0 && getComputedStyle(xfer).display !== 'none' && getComputedStyle(xfer).visibility !== 'hidden',
            insideMeta: xb.left >= mb.left - 1 && xb.right <= mb.right + 1,
            hittable: !!hit && (hit === xfer || xfer.contains(hit)),
            docOverflow: document.documentElement.scrollWidth - innerWidth,
            boardOverflow: bd.scrollWidth - bd.clientWidth,
          };
        });
        ok(`${engineName} ${width} A 看板站況區有轉乘列`, board.found && /^可轉乘.+/.test(board.text || ''), JSON.stringify(board));
        // 內容判準來自 data/station_transfers.json 的實際共站群（台北 TRA:1000 → 高鐵＋板南線＋淡水信義線＋機捷），
        // 不是「有東西就算過」；同系統的線由看板自己的班次清單回答，所以台鐵線不該出現在這一列。
        ok(`${engineName} ${width} A 列的是別的系統（含高鐵與北捷、不含自己那條台鐵線）`,
          /高鐵/.test(board.text || '') && /(板南線|淡水信義線)/.test(board.text || '') && !/西部幹線/.test(board.text || ''), JSON.stringify(board));
        ok(`${engineName} ${width} A 可見、在站況區內、座標可命中`, board.visible && board.insideMeta && board.hittable, JSON.stringify(board));
        ok(`${engineName} ${width} A 無水平溢出`, board.docOverflow <= 1 && board.boardOverflow <= 1, JSON.stringify(board));

        // ── 落點 B：跟隨卡的「下一站」（回答「要不要在這站下車換車」）──
        // 要讓下一站正好是台北，得把時鐘撥到抵達台北前。直接寫 state.simSec 必須同時 clockAtNow=false，
        // 否則會亂蓋完乘章（專案鐵則）。
        // 兩張卡都要量。v0810b 只量了台鐵那張（`.fp-next` 本來就有 flex-wrap 所以永遠不溢出），
        // 捷運那張 `.fc-next` 沒有 wrap、卡片又是固定 220px，整條標凸出卡片外——使用者截圖抓到的，
        // 149/149 全綠卻一格都沒照到。溢出一律對「卡片的內距盒」量，不是對面板 rect（那不會被撐大）。
        const nextTag = await page.evaluate(() => {
          closeBoard();
          const padBox = card => {
            const r = card.getBoundingClientRect(), cs = getComputedStyle(card);
            const bl = parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
            const br = parseFloat(cs.borderRightWidth) + parseFloat(cs.paddingRight);
            return { left: r.left + bl, right: r.right - br, top: r.top, bottom: r.bottom };
          };
          const apart = (a, b) => a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1;
          const measure = (tagId, cardId, siblings) => {
            const el = document.getElementById(tagId), card = document.getElementById(cardId);
            if (!el || !card || el.hidden) return { measured: false, hidden: el && el.hidden };
            const xb = el.getBoundingClientRect(), pb = padBox(card);
            const hit = document.elementFromPoint(xb.x + xb.width / 2, xb.y + xb.height / 2);
            return {
              measured: true, text: el.textContent,
              visible: xb.width > 0 && xb.height > 0,
              insideCard: xb.left >= pb.left - 1 && xb.right <= pb.right + 1 && xb.top >= pb.top - 1 && xb.bottom <= pb.bottom + 1,
              cardOverflow: card.scrollWidth - card.clientWidth,
              apartFromSiblings: siblings.every(id => {
                const s = document.getElementById(id);
                return !s || s.getBoundingClientRect().width === 0 || apart(xb, s.getBoundingClientRect());
              }),
              hittable: !!hit && (hit === el || el.contains(hit)),
            };
          };
          const out = { measuredTags: [] };
          // 台鐵跟隨卡：撥時鐘到抵達台北前（直接寫 simSec 必配 clockAtNow=false，否則亂蓋完乘章）
          const tr = state.followTrain;
          if (tr) {
            const i = tr.stops.findIndex(s => s.stop !== false && (s.name === '臺北' || s.name === '台北'));
            if (i > 0) {
              state.simSec = tr.stops[i].arrSec - 120;
              state.clockAtNow = false;
              updateFollowPanel(tr);
              out.fpNext = document.getElementById('fpNext').textContent;
              out.fp = measure('fpXfer', 'followPanel', ['fpNext', 'fpEta']);
              if (out.fp.measured) out.measuredTags.push('fpXfer');
            } else out.fpNext = '(台北不是中途站)';
          }
          // 捷運跟隨卡：真的起跟一條北捷線，再用最長的那個站名（台北車站，四條轉乘）逼出最壞版面。
          // 下一站是誰由模擬時鐘決定，沒有辦法從外面指定，所以這裡直接餵 updateFreqCard——
          // 它就是產生使用者那張截圖的同一條 render 路徑。
          // 捷運跟隨卡。要切到 mrt 系統（state.mode 從 sched 變 freq）才有 state.lines。
          // 下一站是誰由模擬時鐘決定、從外面控不了，而要驗的是最壞版面（台北車站＝四條轉乘），
          // 所以直接設 freqFollow＋開卡再餵 updateFreqCard——它就是產生使用者那張溢出截圖的同一條 render 路徑。
          // 用 applyFreqFollow 不行：k=0 的幽靈車當下不存在，updateFreqFollowCamera 會把卡收掉。
          loadSystem(state.systems.find(s => s.id === 'mrt'));
          const ln = (state.lines || []).find(l => l.id === 'BL');
          if (ln) {
            state.freqFollow = { ln, k: 0 };
            document.getElementById('freqCard').hidden = false;
            updateFreqCard({ nextName: '台北車站', nextSec: 63060, loop: false, termName: '南港展覽館' });
            out.line = ln.name;
            out.fcNext = document.getElementById('fcNext').textContent;
            out.fc = measure('fcXfer', 'freqCard', ['fcNext']);
            if (out.fc.measured) out.measuredTags.push('fcXfer');
          } else out.line = '(北捷板南線不在 state.lines)';
          out.docOverflow = document.documentElement.scrollWidth - innerWidth;
          return out;
        });
        // 具名覆蓋率斷言：兩顆標都要真的被量到。少一顆就是分母縮水，不准只印在 detail。
        ok(`${engineName} ${width} B 兩張卡的標都量到了（fpXfer＋fcXfer）`,
          nextTag.measuredTags.length === 2 && nextTag.measuredTags.includes('fpXfer') && nextTag.measuredTags.includes('fcXfer'),
          `實際量到:${nextTag.measuredTags.join('、') || '(空)'} | ${JSON.stringify(nextTag).slice(0, 400)}`);
        ok(`${engineName} ${width} B 台鐵卡：下一站台北時標出現且列完整清單`,
          /台北|臺北/.test(nextTag.fpNext || '') && nextTag.fp && nextTag.fp.visible
          && /^轉 /.test(nextTag.fp.text || '') && (nextTag.fp.text.match(/、/g) || []).length === 3, JSON.stringify(nextTag.fp));
        ok(`${engineName} ${width} B 台鐵卡：不壓到站名與到站時刻、不撐破卡片`,
          nextTag.fp && nextTag.fp.insideCard && nextTag.fp.apartFromSiblings && nextTag.fp.cardOverflow <= 1, JSON.stringify(nextTag.fp));
        ok(`${engineName} ${width} B 台鐵卡：座標可實際命中`, !!(nextTag.fp && nextTag.fp.hittable), JSON.stringify(nextTag.fp));
        ok(`${engineName} ${width} B 捷運卡：標出現且列完整清單`,
          nextTag.fc && nextTag.fc.visible && /^轉 /.test(nextTag.fc.text || '') && (nextTag.fc.text.match(/、/g) || []).length >= 1, JSON.stringify(nextTag));
        ok(`${engineName} ${width} B 捷運卡：不壓到站名、不撐破 220px 卡片`,
          nextTag.fc && nextTag.fc.insideCard && nextTag.fc.apartFromSiblings && nextTag.fc.cardOverflow <= 1, JSON.stringify(nextTag.fc));
        ok(`${engineName} ${width} B 捷運卡：座標可實際命中`, !!(nextTag.fc && nextTag.fc.hittable), JSON.stringify(nextTag.fc));
        ok(`${engineName} ${width} B 兩張卡都不造成頁面橫向溢出`, nextTag.docOverflow <= 1, JSON.stringify({ docOverflow: nextTag.docOverflow }));

        // 舊落點（資訊卡逐站停靠表）必須真的清乾淨——留著就是使用者抱怨的那份噪音。
        // 上一段切去了 mrt 系統，這裡要切回台鐵並重新跟上，才點得開列車 sheet。
        await page.evaluate(() => {
          loadSystem(state.systems.find(s => s.id === 'tra_sched'));
          const tr = state.trains.find(t => t.sys === 'tra_sched' && t.stops.some(s => s.name === '臺北' || s.name === '台北'));
          if (tr) setFollow(tr, false, true);
        });
        await page.waitForFunction(() => !document.getElementById('followPanel').hidden);
        await page.tap('#fpDest');
        await page.waitForFunction(() => document.body.classList.contains('train-open') && !document.getElementById('tcStops').hidden);
        const legacy = await page.evaluate(() => ({
          rows: document.querySelectorAll('#tcStops .tc-st[data-i]').length,
          leftovers: document.querySelectorAll('#tcStops .tc-xfer, #tcStops .tc-xfer-wide, #tcStops .tc-xfer-short').length,
          stopsOverflow: document.getElementById('tcStops').scrollWidth - document.getElementById('tcStops').clientWidth,
        }));
        ok(`${engineName} ${width} 舊落點已移除（停靠表 ${legacy.rows} 列、殘留 ${legacy.leftovers} 個）`,
          legacy.rows > 0 && legacy.leftovers === 0, JSON.stringify(legacy));
        ok(`${engineName} ${width} 停靠表無水平溢出`, legacy.stopsOverflow <= 1, JSON.stringify(legacy));

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

      // 桌面一輪。上面四個寬度全部 ≤900px，統統落在手機媒體查詢裡——桌面的看板是側欄、
      // 跟隨卡的位置與可用寬度都不同，兩個落點都得在真桌面再量一次，靜態 gate 驗不到這些。
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
        const wide = await page.evaluate(() => {
          const out = {};
          // 落點 A
          map.setView([25.0478, 121.5170], 15);
          const st = helpNearestStation();
          out.station = st && st.name;
          if (st) openBoard(st);
          const meta = document.querySelector('#board .stnMeta');
          const xfer = meta && meta.querySelector('.xfer');
          if (xfer) {
            const xb = xfer.getBoundingClientRect(), mb = meta.getBoundingClientRect();
            const hit = document.elementFromPoint(xb.x + xb.width / 2, xb.y + xb.height / 2);
            out.boardText = xfer.textContent;
            out.boardVisible = xb.width > 0 && xb.height > 0 && getComputedStyle(xfer).display !== 'none';
            out.boardInside = xb.left >= mb.left - 1 && xb.right <= mb.right + 1;
            out.boardHittable = !!hit && (hit === xfer || xfer.contains(hit));
            // 桌面看板不該讓這一列自己捲出去(側欄寬度固定,長清單要換行不是溢出)
            out.boardOverflow = document.getElementById('board').scrollWidth - document.getElementById('board').clientWidth;
          }
          // 落點 B——兩張卡都要量，溢出對「卡片內距盒」量（面板 rect 不會被撐大，量它等於沒量）
          closeBoard();
          const padBox = card => {
            const r = card.getBoundingClientRect(), cs = getComputedStyle(card);
            return {
              left: r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft),
              right: r.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight),
              top: r.top, bottom: r.bottom,
            };
          };
          const measure = (tagId, cardId) => {
            const el = document.getElementById(tagId), card = document.getElementById(cardId);
            if (!el || !card || el.hidden) return { measured: false };
            const xb = el.getBoundingClientRect(), pb = padBox(card);
            const hit = document.elementFromPoint(xb.x + xb.width / 2, xb.y + xb.height / 2);
            return {
              measured: true, text: el.textContent, visible: xb.width > 0 && xb.height > 0,
              insideCard: xb.left >= pb.left - 1 && xb.right <= pb.right + 1 && xb.top >= pb.top - 1 && xb.bottom <= pb.bottom + 1,
              cardOverflow: card.scrollWidth - card.clientWidth,
              hittable: !!hit && (hit === el || el.contains(hit)),
            };
          };
          out.measuredTags = [];
          const tr = state.followTrain;
          if (tr) {
            const i = tr.stops.findIndex(s => s.stop !== false && (s.name === '臺北' || s.name === '台北'));
            if (i > 0) {
              state.simSec = tr.stops[i].arrSec - 120;
              state.clockAtNow = false; // 直接寫 simSec 必配這行,否則亂蓋完乘章
              updateFollowPanel(tr);
              out.next = document.getElementById('fpNext').textContent;
              out.fp = measure('fpXfer', 'followPanel');
              if (out.fp.measured) out.measuredTags.push('fpXfer');
            } else out.next = '(台北不是中途站)';
          }
          loadSystem(state.systems.find(s => s.id === 'mrt'));
          const ln = (state.lines || []).find(l => l.id === 'BL');
          if (ln) {
            state.freqFollow = { ln, k: 0 };
            document.getElementById('freqCard').hidden = false;
            updateFreqCard({ nextName: '台北車站', nextSec: 63060, loop: false, termName: '南港展覽館' });
            out.fcText = document.getElementById('fcNext').textContent;
            out.fc = measure('fcXfer', 'freqCard');
            if (out.fc.measured) out.measuredTags.push('fcXfer');
          }
          out.docOverflow = document.documentElement.scrollWidth - innerWidth;
          return out;
        });
        ok(`${engineName} 1280 A 看板轉乘列內容正確`,
          /^可轉乘.+/.test(wide.boardText || '') && /高鐵/.test(wide.boardText || '') && !/西部幹線/.test(wide.boardText || ''), JSON.stringify(wide));
        ok(`${engineName} 1280 A 可見、在站況區內、可命中、不撐破側欄`,
          wide.boardVisible && wide.boardInside && wide.boardHittable && wide.boardOverflow <= 1, JSON.stringify(wide));
        ok(`${engineName} 1280 B 兩張卡的標都量到了（fpXfer＋fcXfer）`,
          (wide.measuredTags || []).length === 2, `實際量到:${(wide.measuredTags || []).join('、') || '(空)'}`);
        ok(`${engineName} 1280 B 台鐵卡：下一站台北時標出現且列完整清單`,
          /台北|臺北/.test(wide.next || '') && wide.fp && wide.fp.visible
          && /^轉 /.test(wide.fp.text || '') && (wide.fp.text.match(/、/g) || []).length === 3, JSON.stringify(wide.fp));
        ok(`${engineName} 1280 B 台鐵卡：在卡片內、可命中、不撐破`,
          wide.fp && wide.fp.insideCard && wide.fp.hittable && wide.fp.cardOverflow <= 1, JSON.stringify(wide.fp));
        ok(`${engineName} 1280 B 捷運卡：在 220px 卡片內、可命中、不撐破`,
          wide.fc && wide.fc.visible && wide.fc.insideCard && wide.fc.hittable && wide.fc.cardOverflow <= 1, JSON.stringify(wide.fc));
        ok(`${engineName} 1280 無水平溢出`, wide.docOverflow <= 1, JSON.stringify(wide));
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
