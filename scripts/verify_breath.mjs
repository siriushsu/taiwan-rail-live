// 都會呼吸幕(放空定場)重做驗證 — Playwright 真引擎 + 本機靜態伺服器。
// 背景:v0717x 舊制逐幀分數 zoom(map.setView animate:false)。zoomAnimation:false(v0714a 殘影鐵則)下分數 zoom 圖磚
//   物理上載不進來 → 呼吸幕整片素色「什麼都沒有」(使用者兩度回報,街道/衛星底圖都不出現)。
// 新制(v0718i):地圖固定整數 z13(圖磚正常載入),放大縮小改由 CSS transform scale 對 #map+#overlay 兩個 .stage 平級兄弟
//   同幀施加(.stage overflow:hidden 天然裁切)→ 真實底圖(街道或衛星,跟 basemap 設定走)全程在場、圖磚零重載。
// 本腳本測項全部改為新制語意:圖磚在場/零重載、CSS scale 逐幀平滑且兩層同步、還原乾淨、不越界、錨點回歸、衛星、手機觸控。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5191;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) { res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, r));

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const r3 = x => Math.round(x * 1000) / 1000;
// 一維序列的二階差(平滑度):|a[i]-2a[i-1]+a[i-2]|
const sd = a => { const v = []; for (let i = 2; i < a.length; i++) v.push(Math.abs(a[i] - 2 * a[i - 1] + a[i - 2])); return v; };
const mx = a => a.length ? Math.max(...a) : 0;

// 進入呼吸幕:navigate ?breath=1 → 設 ambient/hotspot → pickBreathScene → 比照換幕邏輯 setView(anchor, z13) 一次 → 等旗標穩定。
// 新制:hotCruise 的 breath 分支不再 setView,故此處自行做進場 setView(換幕邏輯本來就會做)。bt 設在正弦最陡點(π/2)方便量動畫。
async function bootBreath(browser, { width = 1280, height = 800, touch = false, basemap = 'map', forceCity = null, bt = 37.5 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(() => { localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-appearance', 'light'); localStorage.setItem('trainmap-ambient-style', 'hotspot'); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${PORT}/?breath=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready && map && state.mode === 'sched'; } catch (e) { return false; } }, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.evaluate(({ forceCity, bt, basemap }) => {
    state.ambientStyle = 'hotspot'; state.ambient = true; state.playing = true;
    state.followTrain = null; state.freqFollow = null; state._theater = false; state._transition = false; state._hotYield = 0;
    if (basemap === 'sat') { state.basemap = 'sat'; setBasemap(); }
    const sc = pickBreathScene();
    if (forceCity && typeof CITY_BBOX !== 'undefined' && CITY_BBOX[forceCity]) {
      const a = breathAnchorFor(forceCity); if (a) { sc.lat = a.lat; sc.lon = a.lon; sc.anchor = { lat: a.lat, lon: a.lon }; }
    }
    // 進場:比照 hotspotTick 換幕(設旗標→scale 歸 1→setView 一次到 z13 錨點),之後 app 的 tick 迴圈由 hotCruise 逐幀縮放
    state._hotScene = sc; state._hotFresh = false; state._hotNext = performance.now() + 9e8;
    state._hotCam = true; breathStage(); breathScale(1); map.setView([sc.lat, sc.lon], sc.z, { animate: false }); state._hotCam = false;
    sc.bt = bt;
  }, { forceCity, bt, basemap });
  // 等進場穩定:_breathStage、固定整數 z13、CSS scale 已被 hotCruise 施加(computed transform 非 none)
  await page.waitForFunction(() => {
    try {
      if (!(state._breathStage && map.getZoom() === 13)) return false;
      const t = getComputedStyle(document.getElementById('map')).transform;
      return t && t !== 'none';
    } catch (e) { return false; }
  }, null, { timeout: 15000 });
  await page.waitForTimeout(150);
  return { ctx, page, errors };
}

// 逐幀取樣:#map / #overlay 的 computed transform scale + map.getZoom() + 圖磚事件計數。
async function sampleScales(page, N = 90) {
  return page.evaluate((N) => new Promise(resolve => {
    const mEl = document.getElementById('map'), oEl = document.getElementById('overlay');
    const parse = s => { if (!s || s === 'none') return 1; const m = s.match(/matrix\(([^,]+),/); return m ? parseFloat(m[1]) : 1; };
    let moveEnds = 0, zoomEnds = 0;
    const onMove = () => moveEnds++, onZoom = () => zoomEnds++;
    map.on('moveend', onMove); map.on('zoomend', onZoom);
    const out = []; let n = 0;
    (function tick() {
      const ms = getComputedStyle(mEl).transform, os = getComputedStyle(oEl).transform;
      out.push({ t: performance.now(), ms, os, m: parse(ms), o: parse(os), z: map.getZoom() });
      if (++n >= N) { map.off('moveend', onMove); map.off('zoomend', onZoom); return resolve({ frames: out, moveEnds, zoomEnds }); }
      requestAnimationFrame(tick);
    })();
  }), N);
}

function analyzeScales(res) {
  const f = res.frames;
  const mismatch = f.filter(r => r.ms !== r.os).length;      // 兩層 computed transform 字串每幀是否完全相等(跨層同步,確定性判準)
  const mScale = f.map(r => r.m);
  const scaleRange = mx(mScale) - Math.min(...mScale);        // 動畫是否真的在動(scale 有變化)
  const smoothMax = mx(sd(mScale));                           // scale 序列二階差(平滑度)
  const zAll13 = f.every(r => r.z === 13);                    // z 恆定 13
  const dts = []; for (let i = 1; i < f.length; i++) dts.push(f[i].t - f[i - 1].t);
  const p95 = [...dts].sort((a, b) => a - b)[Math.floor(dts.length * 0.95)] || 0;
  return { mismatch, scaleRange, smoothMax, zAll13, p95, moveEnds: res.moveEnds, zoomEnds: res.zoomEnds, frames: f.length };
}

async function tileState(page) {
  return page.evaluate(() => {
    const tiles = [...document.querySelectorAll('#map .leaflet-tile')];
    const srcs = tiles.map(t => t.src).filter(Boolean).sort();
    const want = state.mapDark ? 'dark' : (state.basemap === 'sat' ? 'sat' : 'light');
    return { count: tiles.length, srcs, satMounted: !!(baseLayers.sat && map.hasLayer(baseLayers.sat)), wantMounted: !!(baseLayers[want] && map.hasLayer(baseLayers[want])), z: map.getZoom() };
  });
}

// ══════════════ Chromium 桌面全項 ══════════════
{
  const browser = await chromium.launch();
  console.log('\n═══ chromium 1280×800 ═══');
  const { page, errors } = await bootBreath(browser, { width: 1280, height: 800, forceCity: 'taipei', bt: 37.5 });

  // ── T1 圖磚在場(新制核心):呼吸中真實圖磚在場、動畫 4s 中零重載、z 恆 13、moveend/zoomend 零觸發 ──
  const t0 = await tileState(page);
  ok('chromium T1a 呼吸中真實圖磚在場(.leaflet-tile>0)', t0.count > 0, `tiles=${t0.count}, z=${t0.z}, 掛層=${t0.wantMounted}`);
  const anim = analyzeScales(await sampleScales(page, 240)); // ~4s
  const t1 = await tileState(page);
  const srcSame = t0.srcs.length > 0 && JSON.stringify(t0.srcs) === JSON.stringify(t1.srcs);
  ok('chromium T1b 動畫 4s 圖磚 src 集合不變(零重載)', srcSame, `t0=${t0.srcs.length} 張, t1=${t1.srcs.length} 張, 相同=${srcSame}`);
  ok('chromium T1c 動畫中 map.getZoom() 恆定 13', anim.zAll13, `frames=${anim.frames}, z恆13=${anim.zAll13}`);
  ok('chromium T1d 動畫中 moveend/zoomend 零觸發', anim.moveEnds === 0 && anim.zoomEnds === 0, `moveend=${anim.moveEnds} zoomend=${anim.zoomEnds}`);

  // ── T2 縮放平滑 + 跨層同步:兩元素每幀 scale 字串完全相等 + scale 二階差≤0.01 + 確實在動 ──
  ok('chromium T2a 兩元素每幀 CSS transform 完全相等(跨層同步,確定性)', anim.mismatch === 0, `不相等幀=${anim.mismatch}/${anim.frames}`);
  ok('chromium T2b scale 逐幀平滑 二階差≤0.01', anim.smoothMax <= 0.01, `max 2nd-diff=${r3(anim.smoothMax)}`);
  ok('chromium T2c 呼吸確實在縮放(scale 有變化)', anim.scaleRange > 0.004, `scale 變化幅度=${r3(anim.scaleRange)}`);
  ok('chromium T2d rAF 幀時 p95≤25ms', anim.p95 <= 25, `p95=${r3(anim.p95)}ms`);

  // ── T3 還原:drag 讓位 → 兩元素 transform 歸空、_breathStage=false、圖磚仍在;離開放空 → 同樣乾淨 ──
  {
    const b = await bootBreath(browser, { width: 1280, height: 800, forceCity: 'taipei', bt: 37.5 });
    const before = await b.page.evaluate(() => ({ bs: state._breathStage, mt: getComputedStyle(document.getElementById('map')).transform }));
    await b.page.mouse.move(640, 400); await b.page.mouse.down();
    for (let i = 1; i <= 6; i++) { await b.page.mouse.move(640 - i * 14, 400 - i * 7); await b.page.waitForTimeout(16); }
    await b.page.mouse.up();
    await b.page.waitForTimeout(500);
    const after = await b.page.evaluate(() => {
      const mt = getComputedStyle(document.getElementById('map')).transform, ot = getComputedStyle(document.getElementById('overlay')).transform;
      return { bs: state._breathStage, mtNone: mt === 'none' || mt === '', otNone: ot === 'none' || ot === '', tiles: document.querySelectorAll('#map .leaflet-tile').length };
    });
    ok('chromium T3a drag→呼吸退場(_breathStage=false)', before.bs === true && after.bs === false, `before=${before.bs} after=${after.bs}`);
    ok('chromium T3b drag→兩元素 CSS scale 歸空', after.mtNone && after.otNone, `#map空=${after.mtNone} #overlay空=${after.otNone}`);
    ok('chromium T3c drag→圖磚仍在場', after.tiles > 0, `tiles=${after.tiles}`);
    await b.page.evaluate(() => setAmbient(false));
    await b.page.waitForTimeout(400);
    const off = await b.page.evaluate(() => {
      const mt = getComputedStyle(document.getElementById('map')).transform, z = map.getZoom();
      return { bs: state._breathStage, mtNone: mt === 'none' || mt === '', zInt: z === Math.round(z), tiles: document.querySelectorAll('#map .leaflet-tile').length };
    });
    ok('chromium T3d 離開放空→transform 歸空、z 整數、圖磚在場、_breathStage=false', off.bs === false && off.mtNone && off.zInt && off.tiles > 0, JSON.stringify(off));
    await b.page.context().close();
  }

  // ── T4 不越界:?live=1 永不進呼吸;enterTheater 時呼吸讓位(transform 已清、_theater=true) ──
  {
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    await c2.addInitScript(() => { localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-ambient-style', 'hotspot'); });
    const lp = await c2.newPage();
    await lp.goto(`http://localhost:${PORT}/?live=1&breath=1`, { waitUntil: 'domcontentloaded' });
    await lp.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready && map; } catch (e) { return false; } }, null, { timeout: 30000 });
    const liveRes = await lp.evaluate(() => new Promise(resolve => {
      state.ambient = true; state.ambientStyle = 'hotspot'; state.playing = true; state.followTrain = null; state.freqFollow = null;
      state._hotFresh = true; state._hotScene = null; state._hotNext = 0;
      let bad = false, ticks = 0;
      const iv = setInterval(() => {
        if (state._breathStage || (state._hotScene && state._hotScene.breath)) bad = true;
        if (++ticks >= 30) { clearInterval(iv); resolve({ live: state.liveMode, bad }); }
      }, 100);
    }));
    ok('chromium T4a ?live=1 永不進呼吸幕', liveRes.live === true && liveRes.bad === false, JSON.stringify(liveRes));
    await c2.close();
  }
  {
    const b = await bootBreath(browser, { width: 1280, height: 800, forceCity: 'taipei', bt: 37.5 });
    const th = await b.page.evaluate(() => {
      enterTheater();
      const mt = getComputedStyle(document.getElementById('map')).transform;
      return { bs: state._breathStage, th: state._theater, mtNone: mt === 'none' || mt === '' };
    });
    ok('chromium T4b 進劇場→呼吸讓位(_breathStage=false、_theater=true、transform 清空)', th.bs === false && th.th === true && th.mtNone, JSON.stringify(th));
    await b.page.context().close();
  }

  // ── T5 錨點回歸(v0718h 核心,保留):錨點=軌道質心鄰域最密車站、站點<8 取消 ──
  {
    const b = await bootBreath(browser, { width: 1280, height: 800, forceCity: 'taipei', bt: 37.5 });
    const t5 = await b.page.evaluate(() => {
      const out = { cities: {} };
      for (const id of ['taipei', 'taichung', 'kaohsiung']) {
        const a = breathAnchorFor(id);
        const bb = CITY_BBOX[id];
        const c = L.latLngBounds([[bb[0], bb[1]], [bb[2], bb[3]]]).getCenter();
        let near = 0;
        const scan = s => { if (a && s && Math.abs(s.lat - a.lat) < 0.008 && Math.abs(s.lon - a.lon) < 0.008) near++; };
        (state.schedStations || []).forEach(scan);
        (state.lines || []).forEach(ln => (ln.stations || []).forEach(scan));
        (state.decoLines || []).forEach(ln => (ln.stations || []).forEach(scan));
        const kmOff = a ? Math.round(L.latLng(a.lat, a.lon).distanceTo(c) / 100) / 10 : null;
        out.cities[id] = { ok: !!a, near, kmOff };
      }
      // 站點<8(單一小系統)→ 組不出內容 → pickBreathScene 取消(null)
      const ss = state.schedStations, li = state.lines, dl = state.decoLines;
      state.schedStations = []; state.lines = []; state.decoLines = null;
      out.noRail = pickBreathScene();
      state.schedStations = ss; state.lines = li; state.decoLines = dl;
      return out;
    });
    const cs = t5.cities;
    ok('chromium T5a 三城錨點皆可得且正對車站(z15 視窗有內容,near≥1)',
      ['taipei', 'taichung', 'kaohsiung'].every(id => cs[id].ok && cs[id].near >= 1),
      Object.entries(cs).map(([k, v]) => `${k}:near=${v.near},偏離bbox中心${v.kmOff}km`).join(' '));
    ok('chromium T5b 台中/高雄錨點已離開山區 bbox 中心(位移>5km)',
      cs.taichung.kmOff > 5 && cs.kaohsiung.kmOff > 5, `台中${cs.taichung.kmOff}km 高雄${cs.kaohsiung.kmOff}km`);
    ok('chromium T5c 軌道資料不足(站點<8)→呼吸取消(null,落回一般巡航)', t5.noRail === null, String(t5.noRail));
    await b.page.context().close();
  }

  // ── T6 衛星模式:setBasemap('sat') 後進呼吸,圖磚在場且掛的是衛星圖層 ──
  {
    const b = await bootBreath(browser, { width: 1280, height: 800, forceCity: 'taipei', basemap: 'sat', bt: 37.5 });
    const st = await tileState(b.page);
    const satSrc = st.srcs.some(s => /arcgisonline|World_Imagery/i.test(s));
    ok('chromium T6a 衛星模式呼吸中圖磚在場', st.count > 0, `tiles=${st.count}, z=${st.z}`);
    ok('chromium T6b 掛的是衛星圖層(baseLayers.sat 現掛層 + tile src 為 Esri 影像)', st.satMounted && satSrc, `satMounted=${st.satMounted} 影像src=${satSrc}`);
    // 衛星模式縮放同樣兩層同步
    const anim2 = analyzeScales(await sampleScales(b.page, 90));
    ok('chromium T6c 衛星模式兩層 scale 同步且平滑', anim2.mismatch === 0 && anim2.smoothMax <= 0.01 && anim2.zAll13, `不相等幀=${anim2.mismatch} 2nd-diff=${r3(anim2.smoothMax)}`);
    await b.page.context().close();
  }

  ok('chromium 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.context().close();
  await browser.close();
}

// ══════════════ WebKit 手機 390×844 ══════════════
try {
  const browser = await webkit.launch();
  console.log('\n═══ webkit 390×844(手機) ═══');
  const { page, errors } = await bootBreath(browser, { width: 390, height: 844, touch: true, forceCity: 'taipei', bt: 37.5 });
  const t0 = await tileState(page);
  ok('webkit M1 手機呼吸中真實圖磚在場、z 恆 13', t0.count > 0 && t0.z === 13, `tiles=${t0.count} z=${t0.z}`);
  const anim = analyzeScales(await sampleScales(page, 120));
  ok('webkit M2 手機兩層 scale 同步、平滑、確實在動', anim.mismatch === 0 && anim.smoothMax <= 0.01 && anim.scaleRange > 0.003, `不相等幀=${anim.mismatch} 2nd-diff=${r3(anim.smoothMax)} 幅度=${r3(anim.scaleRange)}`);
  // 觸控第一擊(tap):transform 歸位、無例外
  const beforeTap = await page.evaluate(() => { const t = getComputedStyle(document.getElementById('map')).transform; return t && t !== 'none'; });
  await page.touchscreen.tap(195, 300);
  await page.waitForTimeout(250);
  const afterTap = await page.evaluate(() => {
    const mt = getComputedStyle(document.getElementById('map')).transform, ot = getComputedStyle(document.getElementById('overlay')).transform;
    return { mtNone: mt === 'none' || mt === '', otNone: ot === 'none' || ot === '' };
  });
  ok('webkit M3 觸控第一擊(tap)後 transform 歸位', beforeTap === true && afterTap.mtNone && afterTap.otNone, `tap前有scale=${beforeTap} tap後#map空=${afterTap.mtNone} #overlay空=${afterTap.otNone}`);
  ok('webkit 無 JS 例外', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.context().close();
  await browser.close();
} catch (e) { ok('webkit 全項', false, 'webkit 啟動失敗:' + String(e).slice(0, 160)); }

server.close();
const fail = results.filter(r => !r.pass);
console.log(`\n──────── ${results.length - fail.length}/${results.length} PASS ────────`);
if (fail.length) { console.log('FAIL:', fail.map(f => f.name).join(' ; ')); process.exit(1); }
process.exit(0);
