// 導覽改版(2026-11-03)的使用者路徑驗收:規格在 native repo docs/m9/lanes/guide-route-handoff.md 的 G1–G6。
// 引擎 chromium(channel:'chrome' 無視窗)＋webkit(無視窗),尺寸 390×844(手機殼、觸控)與 1280×800(桌面、滑鼠)。
// 每一條都走使用者會點的東西(真的點、量鏡頭、量版面),不直接呼叫實作函式。
//
// 用法:node scripts/verify_guide_route.mjs
//   GR_REF=<commit>  把「跟那顆 commit 不同的前端檔」換成那顆 commit 的版本再跑,用來證明這些判準在改版前會紅
//                    (基準 7d22991a:GR_REF=7d22991a node scripts/verify_guide_route.mjs,預期多數紅)。
//   SHOT_DIR=<dir>   chromium 390×844 那一輪順手存截圖,另外補暗色的查詢首頁與路線詳情。
//   ENGINES=chromium、SIZES=390 只給除錯窄化用,正式驗收不要傳(傳了會印警告)。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = process.env.GR_REF || '';
const SHOT_DIR = process.env.SHOT_DIR || '';
if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });

// GR_REF:只換掉跟那顆 commit 不同的已追蹤檔(index.html、rail-3d、i18n…),3D 資產這類沒進 git 的照用工作樹。
const override = new Map(); // 相對路徑 → Buffer;null＝那顆 commit 沒有這個檔
if (REF) {
  const list = execFileSync('git', ['-C', root, '-c', 'core.quotepath=off', 'diff', '--name-status', '--no-renames', REF, '--', '.'], { encoding: 'utf8' });
  for (const line of list.split('\n').filter(Boolean)) {
    const [st, f] = line.split('\t');
    override.set(f, st === 'A' ? null : execFileSync('git', ['-C', root, 'show', `${REF}:${f}`], { maxBuffer: 1 << 28 }));
  }
  console.log(`⚠ GR_REF=${REF}:換掉 ${override.size} 個檔(${[...override.keys()].filter(f => !f.startsWith('scripts/')).join(', ')})`);
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.geojson': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname.startsWith('/api/')) {
    if (u.pathname === '/api/thsr-schedule') { res.setHeader('content-type', 'application/json'); return fs.createReadStream(path.join(root, 'data/thsr_schedule_dense.json')).pipe(res); }
    return res.writeHead(503, { 'content-type': 'application/json' }).end('{}');
  }
  let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  const type = mime[path.extname(rel)] || 'application/octet-stream';
  if (override.has(rel)) {
    const buf = override.get(rel);
    if (!buf) return res.writeHead(404).end();
    res.setHeader('content-type', type); return res.end(buf);
  }
  const p = path.resolve(root, rel);
  if (!p.startsWith(root + path.sep) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return res.writeHead(404).end();
  res.setHeader('content-type', type); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const results = [];
function ok(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`);
}
// 每一條各自接例外:改版前的頁面少了某個元素時只紅那一條,不把後面整批帶走。
async function step(name, fn) {
  try { const r = await fn(); ok(name, r.pass, r.detail); return r; }
  catch (e) { ok(name, false, String(e && e.message || e).split('\n')[0].slice(0, 300)); return null; }
}

// 使用者會點的那一下:先捲進視野、確認落點真的打在它身上(沒被別的東西蓋住),手機殼用 tap、桌面用滑鼠。
// 桌面不用 tap:觸控會讓 Chromium 的 any-pointer 翻成 coarse,整頁換成手機殼。
async function press(page, sel, mobile) {
  const l = page.locator(sel).first();
  await l.scrollIntoViewIfNeeded({ timeout: 5000 });
  const hit = await l.evaluate(e => { const r = e.getBoundingClientRect(), h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { ok: !!h && (h === e || e.contains(h)), at: h ? (h.id || h.className || h.tagName) : null }; });
  if (!hit.ok) throw new Error(`點不到 ${sel}(被 ${hit.at} 蓋住)`);
  if (mobile) await l.tap({ timeout: 5000 }); else await l.click({ timeout: 5000 });
}
// 鏡頭停下來(連續約半秒沒在動)才量
async function settle(page) {
  await page.waitForTimeout(150);
  await page.waitForFunction(() => {
    const r = M.raw, moving = r.isMoving() || (r.isEasing && r.isEasing());
    window.__grStill = moving ? 0 : (window.__grStill || 0) + 1;
    return window.__grStill > 5;
  }, null, { timeout: 20000, polling: 100 });
}
const visible = (page, sel) => page.evaluate(sel => { const e = document.querySelector(sel); if (!e || e.closest('[hidden]')) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }, sel);
const shot = async (page, name) => { if (page.__shots) await page.screenshot({ path: path.join(SHOT_DIR, name) }); };

async function boot(browser, { mobile, scheme = 'light' }) {
  const ctx = await browser.newContext(mobile
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-TW', colorScheme: scheme }
    : { viewport: { width: 1280, height: 800 }, locale: 'zh-TW', colorScheme: scheme });
  await ctx.addInitScript(scheme => {
    localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('iabHintDismiss', '1');
    localStorage.setItem('trainmap-language', 'zh-TW'); localStorage.setItem('trainmap-appearance', scheme);
    // 先存一個比 46% 矮的拖拉高度(30%),「選線抬到 46%」才量得出有沒有抬、而且量得出有沒有偷寫回偏好
    localStorage.setItem('trainmap-sheet-h-v1', '0.3');
  }, scheme);
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(8000);
  await page.goto(base + '?lang=zh-TW', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.ready && state.systems.length > 5
    && window.railIslandIntegration?.guide?.catalog?.length && window.railViewControls && window.RailDiscovery, null, { timeout: 90000 });
  await page.evaluate(() => {
    selectGroup(GROUPS.find(g => g.id === 'all')); setSimSec(8 * 3600); state.playing = false; syncTimeUI();
    if (!matchMedia(MOBILE_MQ).matches && document.body.classList.contains('fs')) state._setFs(false);
  });
  await page.waitForTimeout(800);
  return { ctx, page, errors };
}

// 查詢入口:手機殼開查詢面板(瀏覽態),桌面點頂端搜尋框並清空(空白下拉=桌面的查詢首頁)
async function openQuery(page, mobile) {
  if (mobile) {
    if (await page.evaluate(() => document.getElementById('searchPanel').hidden)) await press(page, '#tabSearch', true);
    await page.waitForTimeout(400);
  } else {
    await press(page, '#trainSearch', false);
    await page.locator('#trainSearch').fill('');
    await page.waitForTimeout(250);
  }
}
async function typeQuery(page, mobile, q) {
  await openQuery(page, mobile);
  await page.locator('#trainSearch').fill(q);
  await page.waitForFunction(() => !document.getElementById('searchDrop').hidden, null, { timeout: 5000 });
  await page.waitForTimeout(250);
}
async function dropGroups(page) {
  return page.evaluate(() => ({
    secs: [...document.querySelectorAll('#searchDrop .sd-sec')].map(e => e.textContent.trim()),
    places: [...document.querySelectorAll('#searchDrop .place-row .nm')].map(e => e.textContent.trim()),
    cities: [...document.querySelectorAll('#searchDrop .city-row .nm')].map(e => e.textContent.trim()),
    routes: [...document.querySelectorAll('#searchDrop .route-row .nm')].map(e => e.textContent.trim()),
  }));
}
// 鏡頭中心離地點中心多遠(公尺);地點中心取 3D 導覽目錄(跟 chip 用的同一份)
const placeDist = (page, key) => page.evaluate(key => {
  const p = railIslandIntegration.guide.catalog.find(p => p.key === key), c = M.getCenter();
  const dy = (c.lat - p.center[1]) * 111320, dx = (c.lng - p.center[0]) * 111320 * Math.cos(c.lat * Math.PI / 180);
  return { m: Math.round(Math.hypot(dx, dy)), zoom: +M.raw.getZoom().toFixed(2), status: railIslandIntegration.guide.current?.status, key: railIslandIntegration.guide.current?.key };
}, key);
// 等到「導覽完成、鏡頭到了 1.5 km 內、而且停了」才量;只看導覽狀態不夠——上一趟同一個地點留下的 ready 會讓它立刻成立。
// 逾時不拋例外,讓後面的量測照實報出停在哪裡。
const waitGuide = (page, key) => page.waitForFunction(key => {
  const g = railIslandIntegration.guide.current, p = railIslandIntegration.guide.catalog.find(p => p.key === key), c = M.getCenter();
  const m = Math.hypot((c.lat - p.center[1]) * 111320, (c.lng - p.center[0]) * 111320 * Math.cos(c.lat * Math.PI / 180));
  return g?.key === key && g.status === 'ready' && m < 1500 && !M.raw.isMoving();
}, key, { timeout: 45000, polling: 200 }).catch(() => {});
const waitCity = (page, id) => page.waitForFunction(id => {
  const [la1, lo1, la2, lo2] = CITY_BBOX[id], c = M.getCenter();
  return !M.raw.isMoving() && c.lat >= Math.min(la1, la2) && c.lat <= Math.max(la1, la2) && c.lng >= Math.min(lo1, lo2) && c.lng <= Math.max(lo1, lo2);
}, id, { timeout: 15000, polling: 200 }).catch(() => {});
const cityIn = (page, id) => page.evaluate(id => {
  const b = CITY_BBOX[id], c = M.getCenter();
  const [la1, lo1, la2, lo2] = b;
  return { inside: c.lat >= Math.min(la1, la2) && c.lat <= Math.max(la1, la2) && c.lng >= Math.min(lo1, lo2) && c.lng <= Math.max(lo1, lo2), center: [+c.lat.toFixed(4), +c.lng.toFixed(4)] };
}, id);
// 一組點投影到螢幕後是否全在「露出的地圖」裡:地圖容器內、不在作用中面板底下
const framed = (page, pts, panelSel) => page.evaluate(([pts, panelSel]) => {
  const cr = M.getContainer().getBoundingClientRect(), panel = panelSel && document.querySelector(panelSel);
  const pr = panel && !panel.hidden ? panel.getBoundingClientRect() : null;
  const out = [];
  for (const [lat, lon] of pts) {
    const p = M.raw.project([lon, lat]), x = cr.left + p.x, y = cr.top + p.y;
    const inView = x >= -2 && x <= innerWidth + 2 && y >= -2 && y <= innerHeight + 2 && x >= cr.left - 2 && x <= cr.right + 2 && y >= cr.top - 2 && y <= cr.bottom + 2;
    const under = pr && x > pr.left + 2 && x < pr.right - 2 && y > pr.top + 2 && y < pr.bottom - 2;
    if (!inView || under) out.push([Math.round(x), Math.round(y)]);
  }
  return { n: pts.length, off: out.slice(0, 5), offN: out.length, panelTop: pr ? Math.round(pr.top) : null };
}, [pts, panelSel]);
const routeHlState = page => page.evaluate(() => {
  // feats=畫面上真的畫出來的亮線圖徵數(queryRenderedFeatures),不是資料源裡有幾筆
  const r = M.raw, layer = r.getLayer('route-hl-line');
  const feats = layer ? r.queryRenderedFeatures({ layers: ['route-hl-line'] }).length : 0;
  return { layer: !!layer, glow: !!r.getLayer('route-hl-glow'), vis: layer ? r.getLayoutProperty('route-hl-line', 'visibility') || 'visible' : null,
    route: typeof routeHl !== 'undefined' && routeHl.route ? routeHl.route.id : null, feats };
});

async function run(browser, engine, mobile) {
  const tag = `${engine} ${mobile ? '390' : '1280'}`;
  const { ctx, page, errors } = await boot(browser, { mobile });
  page.__shots = !!(SHOT_DIR && engine === 'chromium' && mobile);

  // ── G1 觀看沒有「導覽」分頁 ──
  await step(`${tag} G1 觀看分類只剩 視角／地圖／列車／標示／畫面(沒有導覽)`, async () => {
    await page.evaluate(() => window.railViewControls.open('angle'));
    const v = await page.evaluate(() => ({
      nav: [...document.querySelectorAll('#viewSettingsPanel .view-tabs .view-tab')].map(b => b.dataset.view).join(),
      rail: [...document.querySelectorAll('.view-rail .view-tab')].map(b => b.dataset.view).join(),
      labels: [...document.querySelectorAll('#viewSettingsPanel .view-tabs .view-tab')].map(b => b.textContent.trim()).join('/'),
      placesPage: !!document.getElementById('view-places') }));
    await page.evaluate(() => document.querySelector('#viewSettingsPanel .view-close').click());
    const want = 'angle,map,train,labels,display';
    return { pass: v.nav === want && v.rail === want && !v.placesPage && !/導覽/.test(v.labels), detail: v };
  });

  // ── G6 觀看 → 標示「軌道與路線」原地展開、淡化生效 ──
  await step(`${tag} G6 標示「軌道與路線」原地展開(› 換 ⌄、不開面板、軌道顯示與路線開關看得到)`, async () => {
    await page.evaluate(() => window.railViewControls.open('labels'));
    await page.waitForTimeout(300);
    await press(page, '.ms-row[data-act=track]', mobile);
    await page.waitForTimeout(300);
    const s = await page.evaluate(() => {
      const row = document.querySelector('.ms-row[data-act=track]'), box = document.getElementById('msTracks');
      const seg = document.getElementById('trackSeg').getBoundingClientRect(), chip = document.querySelector('#lineToggles .chip');
      return { inView: !!box && !box.hidden && !!box.closest('#view-labels'), aria: row.getAttribute('aria-expanded'), chev: row.querySelector('.chev')?.textContent,
        segH: Math.round(seg.height), chipH: chip ? Math.round(chip.getBoundingClientRect().height) : 0,
        boxAfterRow: !!box && row.nextElementSibling === box, panelOpen: !document.getElementById('trackPanel').hidden };
    });
    await shot(page, '07-view-labels-tracks.png');
    return { pass: s.inView && s.aria === 'true' && s.chev === '⌄' && s.segH > 0 && s.chipH > 0 && s.boxAfterRow && !s.panelOpen, detail: s };
  });
  await step(`${tag} G6 點「淡化」⇒ 軌道顯示切成淡化(狀態、偏好、地圖上的軌道顏色都變)`, async () => {
    const before = await page.evaluate(() => JSON.stringify(M.raw.getPaintProperty('track-line-' + glTracks.ranks[0], 'line-color')));
    await press(page, '#trackSeg [data-v=faint]', mobile);
    await page.waitForTimeout(600);
    const s = await page.evaluate(() => ({ style: state.trackStyle, pref: localStorage.getItem('trainmap-track'),
      on: document.querySelector('#trackSeg button.on')?.dataset.v, paint: JSON.stringify(M.raw.getPaintProperty('track-line-' + glTracks.ranks[0], 'line-color')) }));
    const changed = s.paint !== before;
    await press(page, '#trackSeg [data-v=auto]', mobile);
    await page.waitForTimeout(200);
    await press(page, '.ms-row[data-act=track]', mobile); // 再點收起
    const collapsed = await page.evaluate(() => document.getElementById('msTracks').hidden && document.querySelector('.ms-row[data-act=track]').getAttribute('aria-expanded') === 'false');
    await page.evaluate(() => document.querySelector('#viewSettingsPanel .view-close').click());
    return { pass: s.style === 'faint' && s.pref === 'faint' && s.on === 'faint' && changed && collapsed, detail: { ...s, paint: undefined, paintChanged: changed, collapsed } };
  });

  // ── G5 觀看 → 視角 的精選取景 ──
  await step(`${tag} G5 視角頁最後是精選取景(照「點數 > 1」那幾個,每個一列標題＋說明)`, async () => {
    await page.evaluate(() => window.railViewControls.open('angle'));
    await page.waitForTimeout(300);
    const s = await page.evaluate(() => {
      const R = window.RailDiscovery, routes = R.catalog(state.systems, buildStnIndex());
      const want = R.scenes.filter(sc => R.scenePoints(sc, routes).length > 1).map(sc => sc.id).join();
      const box = document.getElementById('viewScenes'), pg = document.getElementById('view-angle');
      const rows = box ? [...box.querySelectorAll('[data-scene]')] : [];
      return { want, got: rows.map(r => r.dataset.scene).join(), last: !!box && pg.lastElementChild === box,
        copy: rows.every(r => r.querySelector('b')?.textContent.trim() && r.querySelector('small')?.textContent.trim()) };
    });
    await page.locator('#viewScenes [data-scene]').last().scrollIntoViewIfNeeded().catch(() => {});
    await shot(page, '06-view-angle-scenes.png');
    return { pass: !!s.want && s.got === s.want && s.last && s.copy, detail: s };
  });
  await step(`${tag} G5 點「淡海輕軌」⇒ 收起觀看、鏡頭框住整條線`, async () => {
    await press(page, '#viewScenes [data-scene=danhai]', mobile);
    await settle(page);
    const pts = await page.evaluate(() => { const R = window.RailDiscovery; return R.scenePoints(R.scenes.find(s => s.id === 'danhai'), R.catalog(state.systems, buildStnIndex())); });
    const f = await framed(page, pts, null);
    const closed = await page.evaluate(() => document.getElementById('viewSettingsPanel').hidden);
    return { pass: closed && f.n > 1 && f.offN === 0, detail: { closed, ...f } };
  });

  // ── G2 查詢首頁「去哪裡」 ──
  await step(`${tag} G2 去哪裡兩條單行 chip:地點(目錄全部、車站在前)＋縣市 17 個`, async () => {
    await openQuery(page, mobile);
    const host = mobile ? '#queryWhere' : '#searchDrop .wh-drop';
    const s = await page.evaluate(host => {
      const el = document.querySelector(host); if (!el) return { missing: host };
      const rows = [...el.querySelectorAll('.wh-row')];
      const cat = railIslandIntegration.guide.catalog.map(p => p.key).join();
      const oneLine = rows.every(r => { const tops = new Set([...r.children].map(c => Math.round(c.getBoundingClientRect().top))); return tops.size === 1; });
      const r0 = el.getBoundingClientRect();
      return { rows: rows.length, places: [...el.querySelectorAll('[data-place]')].map(b => b.dataset.place).join() === cat,
        cities: el.querySelectorAll('[data-city]').length, oneLine, scrolls: rows.every(r => r.scrollWidth > r.clientWidth),
        title: el.querySelector('.wh-sec')?.textContent.trim(), h: Math.round(r0.height), visible: r0.height > 0 };
    }, host);
    if (mobile) {
      const order = await page.evaluate(() => { const p = document.getElementById('searchPanel'), kids = [...p.querySelectorAll('#queryWhere, #queryLinks')]; return kids.map(k => k.id).join(); });
      s.order = order;
      s.routesLink = await page.evaluate(() => document.querySelector('#queryLinks [data-act=routes]')?.textContent.trim());
      await shot(page, '01-query-home.png');
    }
    return { pass: s.visible && s.rows === 2 && s.places && s.cities === 17 && s.oneLine && s.scrolls && s.title === '去哪裡' && (!mobile || (s.routesLink || '').startsWith('路線') && !/導覽|取景/.test(s.routesLink)), detail: s };
  });
  await step(`${tag} G2 點地點 chip「台北101」⇒ 收起查詢、飛到 101 附近`, async () => {
    const sel = (mobile ? '#queryWhere' : '#searchDrop .wh-drop') + ' [data-place=taipei101]';
    await press(page, sel, mobile);
    await waitGuide(page, 'taipei101');
    await settle(page);
    const d = await placeDist(page, 'taipei101');
    const closed = await page.evaluate(m => m ? document.getElementById('searchPanel').hidden : document.getElementById('searchDrop').hidden, mobile);
    return { pass: closed && d.m < 1500 && d.zoom >= 14, detail: { closed, ...d } };
  });
  await step(`${tag} G2 點縣市 chip「花蓮」⇒ 收起查詢、鏡頭落在花蓮縣範圍`, async () => {
    await openQuery(page, mobile);
    await press(page, (mobile ? '#queryWhere' : '#searchDrop .wh-drop') + ' [data-city=hualien]', mobile);
    await waitCity(page, 'hualien');
    await settle(page);
    const c = await cityIn(page, 'hualien');
    const closed = await page.evaluate(m => m ? document.getElementById('searchPanel').hidden : document.getElementById('searchDrop').hidden, mobile);
    return { pass: closed && c.inside, detail: { closed, ...c } };
  });

  // ── G2 搜尋框找得到地點／縣市／路線 ──
  if (page.__shots) {
    await typeQuery(page, mobile, '台北').catch(() => {});
    await shot(page, '02-search-taipei.png');
  }
  await step(`${tag} G2 搜「101」⇒ 地點組有「台北101」,點了飛過去`, async () => {
    await typeQuery(page, mobile, '101');
    const g = await dropGroups(page);
    const row = await page.evaluate(() => [...document.querySelectorAll('#searchDrop .place-row')].findIndex(r => /台北\s*101/.test(r.textContent)));
    if (row < 0) return { pass: false, detail: g };
    await press(page, `#searchDrop .place-row[data-pi="${row}"]`, mobile);
    await waitGuide(page, 'taipei101');
    await settle(page);
    const d = await placeDist(page, 'taipei101');
    return { pass: g.secs.includes('地點') && g.places.length <= 3 && d.m < 1500, detail: { ...g, ...d } };
  });
  await step(`${tag} G2 搜「花蓮」⇒ 既有車站組在前、縣市組有「花蓮」,點了飛到花蓮縣`, async () => {
    await typeQuery(page, mobile, '花蓮');
    const g = await dropGroups(page);
    const ci = await page.evaluate(() => [...document.querySelectorAll('#searchDrop .city-row')].findIndex(r => r.querySelector('.nm').textContent.trim() === '花蓮'));
    if (ci < 0) return { pass: false, detail: g };
    // 既有的車站結果排在新分組之前(沒有車次時車站組不印標題,所以比的是列的先後)
    const order = await page.evaluate(() => { const rows = [...document.querySelectorAll('#searchDrop .row')]; const st = rows.findIndex(r => r.classList.contains('stn-row')), wh = rows.findIndex(r => /place-row|city-row|route-row/.test(r.className)); return { st, wh }; });
    await press(page, `#searchDrop .city-row[data-ci="${ci}"]`, mobile);
    await waitCity(page, 'hualien');
    await settle(page);
    const c = await cityIn(page, 'hualien');
    return { pass: g.secs.includes('縣市') && order.st >= 0 && order.st < order.wh && g.cities.length <= 3 && g.routes.every(n => !/臺東線|北迴線/.test(n)) && c.inside, detail: { ...g, order, ...c } };
  });
  await step(`${tag} G2 搜「文湖」⇒ 路線組只有文湖線(不列經過的別條線),點了開「路線」面板進那條線、亮線`, async () => {
    await typeQuery(page, mobile, '文湖');
    const g = await dropGroups(page);
    const ri = await page.evaluate(() => [...document.querySelectorAll('#searchDrop .route-row')].findIndex(r => /文湖/.test(r.textContent)));
    if (ri < 0) return { pass: false, detail: g };
    await press(page, `#searchDrop .route-row[data-ri="${ri}"]`, mobile);
    await settle(page);
    const s = await page.evaluate(() => ({ panel: !document.getElementById('trackPanel').hidden, h4: document.querySelector('#rdDetail h4')?.textContent.trim(),
      detail: !document.getElementById('rdDetail').hidden }));
    const hl = await routeHlState(page);
    return { pass: g.secs.includes('路線') && g.routes.length >= 1 && g.routes.every(n => /文湖/.test(n)) && s.panel && s.detail && /文湖/.test(s.h4 || '') && hl.layer && hl.feats > 0,
      detail: { ...g, ...s, hl } };
  });
  await page.evaluate(() => { const c = document.getElementById('trackClose'); if (c && !document.getElementById('trackPanel').hidden) c.click(); });
  await page.waitForTimeout(300);

  // ── G4 「路線」面板 ──
  let routeId = null, routeName = null, dirText = null;
  await step(`${tag} G4 從入口開「路線」面板:標題「路線」、沒有分頁、從所有路線開始`, async () => {
    if (mobile) { await openQuery(page, true); await press(page, '#queryLinks [data-act=routes]', true); }
    else { await openQuery(page, false); await press(page, '#searchDrop [data-discovery=routes]', false); }
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => ({ open: !document.getElementById('trackPanel').hidden,
      title: document.querySelector('#trackPanel > h3')?.firstChild?.textContent.trim(),
      tabs: document.querySelectorAll('#trackPanel [data-rdtab], #rdTabs').length,
      list: !document.getElementById('rdList')?.closest('[hidden]') && document.querySelectorAll('#rdList .rd-route').length }));
    return { pass: s.open && s.title === '路線' && s.tabs === 0 && s.list > 5, detail: s };
  });
  await step(`${tag} G4 點「板南線」⇒ 進詳情、地圖框住整條線、亮線在、${mobile ? 'sheet 抬到 ≥46% 且不寫偏好' : '面板留著'}`, async () => {
    const row = page.locator('#rdList .rd-route', { hasText: '板南線' }).first();
    routeId = await row.getAttribute('data-route', { timeout: 5000 });
    await press(page, `#rdList .rd-route[data-route="${routeId}"]`, mobile);
    await settle(page);
    const s = await page.evaluate(id => {
      const R = window.RailDiscovery, r = R.catalog(state.systems, buildStnIndex()).find(x => x.id === id);
      const p = document.getElementById('trackPanel'), h = p.getBoundingClientRect().height;
      return { pts: r.stations.map(s => [s.lat, s.lon]), h4: document.querySelector('#rdDetail h4')?.textContent.trim(),
        dir: document.querySelector('#rdDetail .rd-direction span')?.textContent.trim(),
        frac: +(h / innerHeight).toFixed(3), pref: localStorage.getItem('trainmap-sheet-h-v1'), color: r.color };
    }, routeId);
    routeName = s.h4; dirText = s.dir;
    const f = await framed(page, s.pts, '#trackPanel');
    const hl = await routeHlState(page);
    await shot(page, '03-route-detail.png');
    const sheetOk = !mobile || (s.frac >= 0.455 && s.pref === '0.3');
    return { pass: /板南/.test(s.h4 || '') && f.offN === 0 && f.n > 5 && hl.layer && hl.glow && hl.vis !== 'none' && hl.route === routeId && hl.feats > 0 && sheetOk,
      detail: { h4: s.h4, frac: s.frac, pref: s.pref, framed: f, hl } };
  });
  await step(`${tag} G4 從站序點站開看板 ⇒ 卡頭最前面有「‹ 板南線」`, async () => {
    await press(page, '#rdDetail .rd-stations button[data-stop="4"]', mobile);
    await page.waitForFunction(() => !document.getElementById('board').hidden, null, { timeout: 8000 });
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => { const b = document.getElementById('boardRouteBack'), h3 = document.querySelector('#board > h3');
      return { back: b ? b.textContent.trim() : null, chevron: b ? getComputedStyle(b, '::before').content : null, first: !!b && h3.firstElementChild === b, hlKept: typeof routeHl !== 'undefined' && !!routeHl.route }; });
    await shot(page, '04-board-route-back.png');
    return { pass: !!s.back && !!routeName && routeName.includes(s.back) && /‹/.test(s.chevron || '') && s.first && s.hlKept && await visible(page, '#boardRouteBack'), detail: s };
  });
  await step(`${tag} G4 點「‹ 線名」⇒ 回到同一條線、同一個方向,重新框線、亮線`, async () => {
    await press(page, '#boardRouteBack', mobile);
    await settle(page);
    const s = await page.evaluate(() => ({ panel: !document.getElementById('trackPanel').hidden, board: !document.getElementById('board').hidden,
      h4: document.querySelector('#rdDetail h4')?.textContent.trim(), dir: document.querySelector('#rdDetail .rd-direction span')?.textContent.trim() }));
    const pts = await page.evaluate(id => window.RailDiscovery.catalog(state.systems, buildStnIndex()).find(x => x.id === id).stations.map(s => [s.lat, s.lon]), routeId);
    const f = await framed(page, pts, '#trackPanel');
    const hl = await routeHlState(page);
    return { pass: s.panel && !s.board && s.h4 === routeName && s.dir === dirText && f.offN === 0 && hl.route === routeId && hl.vis !== 'none', detail: { ...s, framed: f, hl } };
  });
  await step(`${tag} G4 關掉面板 ⇒ 亮線拿掉;別的路徑開看板不出現「‹ 線名」`, async () => {
    await press(page, '#trackClose', mobile);
    await page.waitForTimeout(300);
    const hl = await routeHlState(page);
    await typeQuery(page, mobile, '台北');
    await press(page, '#searchDrop .row.stn-row', mobile);
    await page.waitForFunction(() => !document.getElementById('board').hidden, null, { timeout: 8000 });
    await page.waitForTimeout(300);
    const back = await page.evaluate(() => !!document.getElementById('boardRouteBack'));
    await page.evaluate(() => closeBoard());
    return { pass: !hl.route && (!hl.layer || hl.feats === 0 || hl.vis === 'none') && !back, detail: { hl, back } };
  });

  // ── G3 最愛「＋ 新增地點」 ──
  const openFav = async () => {
    if (mobile) await press(page, '#tabFav', true); else await press(page, '#favBtn', false);
    await page.waitForTimeout(400);
  };
  // 提示條量「看得到的字」:同一條提示裡兩種模式的字都在 DOM,靠 class 切顯示
  const hint = () => page.evaluate(() => { const h = document.getElementById('pinHint'), r = h.getBoundingClientRect();
    const seen = els => [...els].filter(e => e.getClientRects().length && e.getBoundingClientRect().height > 0).map(e => e.textContent.trim()).join('|');
    return { shown: !h.hidden && r.height > 0, once: h.classList.contains('pin-once'), text: seen(h.querySelectorAll('.pn-txt > *')),
      exit: seen(document.getElementById('pinHintExit')?.children || []) || document.getElementById('pinHintExit')?.textContent.trim(), drop: !!state.dropMode }; });
  await step(`${tag} G3 最愛頁「＋ 新增地點」⇒ 收起最愛、頂端提示「點地圖選位置」＋「取消」`, async () => {
    await openFav();
    await press(page, '#favAddPinBtn', mobile);
    await page.waitForTimeout(400);
    const h = await hint();
    const favClosed = await page.evaluate(() => document.getElementById('favPanel').hidden);
    await shot(page, '05-add-place-hint.png');
    return { pass: favClosed && h.shown && h.once && h.text === '點地圖選位置' && h.exit === '取消' && h.drop, detail: { favClosed, ...h } };
  });
  await step(`${tag} G3 點「取消」⇒ 離開模式、提示消失`, async () => {
    await press(page, '#pinHintExit', mobile);
    await page.waitForTimeout(300);
    const h = await hint();
    return { pass: !h.shown && !h.drop, detail: h };
  });
  await step(`${tag} G3 再按一次新增、點地圖、存好 ⇒ 多一個地點、自動離開模式、提示消失`, async () => {
    await openFav();
    await press(page, '#favAddPinBtn', mobile);
    await page.waitForTimeout(400);
    const n0 = await page.evaluate(() => loadPins().length);
    // 找一個真的打在地圖畫布上的點(不是浮在上面的卡或按鈕)
    const pt = await page.evaluate(() => {
      const c = M.getContainer().getBoundingClientRect(), canvas = M.raw.getCanvas();
      for (const fy of [.3, .38, .22, .45]) for (const fx of [.5, .35, .65]) {
        const x = Math.round(c.left + c.width * fx), y = Math.round(c.top + c.height * fy), h = document.elementFromPoint(x, y);
        if (h === canvas) return { x, y };
      }
      return null;
    });
    if (!pt) return { pass: false, detail: '找不到露出的地圖' };
    if (mobile) await page.touchscreen.tap(pt.x, pt.y); else await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(500);
    await press(page, '#pinSave', mobile);
    await page.waitForTimeout(300);
    await page.locator('#pinNameInput').fill('驗收地點');
    await press(page, '#pinNameSave', mobile);
    await page.waitForTimeout(400);
    const h = await hint(), n1 = await page.evaluate(() => loadPins().length);
    return { pass: n1 === n0 + 1 && !h.shown && !h.drop, detail: { n0, n1, ...h } };
  });

  await step(`${tag} 全程零前端例外`, async () => ({ pass: errors.length === 0, detail: errors.slice(0, 3) }));
  await ctx.close();
}

// 暗色:只補截圖(查詢首頁、路線詳情),判準已在亮色那輪
async function darkShots(browser) {
  const { ctx, page } = await boot(browser, { mobile: true, scheme: 'dark' });
  page.__shots = true;
  await openQuery(page, true);
  await shot(page, '08-dark-query-home.png');
  await press(page, '#queryLinks [data-act=routes]', true);
  await page.waitForTimeout(400);
  const row = page.locator('#rdList .rd-route', { hasText: '板南線' }).first();
  await press(page, `#rdList .rd-route[data-route="${await row.getAttribute('data-route')}"]`, true);
  await settle(page);
  await shot(page, '09-dark-route-detail.png');
  await ctx.close();
}

const engines = (process.env.ENGINES || 'chromium,webkit').split(',').map(s => s.trim()).filter(Boolean);
const sizes = (process.env.SIZES || '390,1280').split(',').map(s => s.trim()).filter(Boolean);
if (process.env.ENGINES || process.env.SIZES) console.log('⚠ ENGINES／SIZES 窄化:這不是完整驗收');
try {
  for (const engine of engines) {
    const browser = engine === 'chromium' ? await chromium.launch({ channel: 'chrome', headless: true }) : await webkit.launch({ headless: true });
    try {
      for (const size of sizes) {
        try { await run(browser, engine, size === '390'); }
        catch (e) { ok(`${engine} ${size} 開機`, false, String(e.message || e).split('\n')[0]); }
      }
      if (SHOT_DIR && engine === 'chromium') await darkShots(browser).catch(e => console.log('暗色截圖失敗', String(e.message || e).split('\n')[0]));
    } finally { await browser.close(); }
  }
} finally { server.close(); }
const pass = results.filter(r => r.pass).length;
console.log(`\n=== ${pass}/${results.length} 通過${REF ? `(GR_REF=${REF})` : ''} ===`);
const bad = results.filter(r => !r.pass);
if (bad.length) console.log(bad.map(r => '  FAIL ' + r.name).join('\n'));
process.exit(bad.length ? 1 : 0);
