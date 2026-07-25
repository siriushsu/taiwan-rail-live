// 開機自動定位 + 「附近車站」鈕 驗收
// 跑法：node verify_boot_geo.mjs [base]   預設 base=http://127.0.0.1:5178
//
// 為什麼用 Playwright 不用內建 Browser pane：開機落點走 map.flyTo（rAF 驅動），
// 內建 pane 的 requestAnimationFrame 是凍結的，在那裡量到的「沒飛過去」是環境假象不是 bug。
//
// 判準刻意取「與實作不同源」的證據：中心座標一律讀 Leaflet 自己的 map.getCenter()（真實渲染狀態），
// 距離用獨立寫的 haversine 算，不呼叫頁面內任何定位相關函式。
import { chromium, webkit } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:5178';
const TPE = { lat: 25.0478, lon: 121.5170 };   // 台北車站
const KHH = { lat: 22.6393, lon: 120.3021 };   // 高雄車站
const TKY = { lat: 35.6812, lon: 139.7671 };   // 東京車站（境外，應被守門擋下）
const GEO_KEY = 'trainmap-last-geo';
const LAST_VIEW_KEY = 'trainmap-last-view';

const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p, msg }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };

function km(a, b) {
  const r = Math.PI / 180, R0 = 6371;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R0 * Math.asin(Math.sqrt(s));
}

async function newPage(browser, { seedGeo = null, seedLastView = null, width = 390, height = 844 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  await ctx.addInitScript(([k, v, lk, lv]) => {
    try {
      localStorage.clear();
      if (v) localStorage.setItem(k, v);
      if (lv) localStorage.setItem(lk, lv);
    } catch (e) {}
  }, [GEO_KEY, seedGeo && JSON.stringify(seedGeo), LAST_VIEW_KEY, seedLastView && JSON.stringify(seedLastView)]);
  const page = await ctx.newPage();
  return { ctx, page };
}

const center = page => page.evaluate(() => {
  const m = window.__map; if (!m) return null;
  const c = m.getCenter();
  return { lat: c.lat, lon: c.lng, z: m.getZoom(), ready: !!(window.__state && window.__state.ready) };
});

const waitReady = page => page.waitForFunction(() => window.__state && window.__state.ready, null, { timeout: 30000 });

// 量「使用者從開啟到看見自己位置」要多久：從 goto 起算，輪詢到中心落在目標 1.5km 內
async function timeToLand(page, url, target, budgetMs = 20000) {
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'commit' });
  while (Date.now() - t0 < budgetMs) {
    const c = await center(page).catch(() => null);
    if (c && km(c, target) < 1.5) return Date.now() - t0;
    await page.waitForTimeout(60);
  }
  return null;
}

async function run(engine, name) {
  console.log(`\n──────── ${name} ────────`);
  const browser = await engine.launch();

  // 1) 首開無快取、定位 2.5 秒才回來：先落全台同框不空等，定位到了再飛到台北
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(`${BASE}/?geomock=${TPE.lat},${TPE.lon}&geodelay=2500`, { waitUntil: 'commit' });
    await waitReady(page);
    const early = await center(page);
    ok('首開/定位未到時不空等（先給全台同框，不是空白）', early && km(early, TPE) > 20,
       early ? `此刻離台北 ${km(early, TPE).toFixed(0)}km、z=${early.z}` : 'no map');
    await page.waitForFunction(() => window.__state && window.__state._geoLanded, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200); // flyTo 動畫收斂
    const late = await center(page);
    ok('首開/定位回來後飛到我的位置', late && km(late, TPE) < 1.5,
       late ? `離台北 ${km(late, TPE).toFixed(2)}km、z=${late.z}` : 'no map');
    ok('首開/落點縮放為 z14', late && late.z === 14, late ? `z=${late.z}` : '');
    // 藍點要「看得見」不是「DOM 裡有」——列車 overlay 是獨立 canvas，元素在、卻被上層畫布整片蓋掉是真實風險。
    // 注意不能用 elementFromPoint 當判準：藍點刻意設 interactive:false（不擋地圖點擊）＝pointer-events:none，
    // 命中測試對它必然失敗、與有沒有顯示無關。唯一有效的證據是實際渲染像素。
    await page.evaluate(() => { const w = document.getElementById('howtoWrap'); if (w) w.remove(); });
    // 藍點畫在列車 overlay 畫布上（不是 DOM），所以判準只能是實際渲染像素。
    // 位置真值取自「頁面回報的我的座標」再自行投影，不直接相信畫的人說它畫在哪。
    const dotRect = await page.evaluate(() => {
      const me = window.__state && window.__state.meLoc;
      const m = window.__map; if (!m) return null;
      const ll = me || m.getCenter && { lat: m.getCenter().lat, lon: m.getCenter().lng };
      const p = m.latLngToContainerPoint([ll.lat, ll.lon]);
      const box = m.getContainer().getBoundingClientRect();
      return { x: box.left + p.x - 11, y: box.top + p.y - 11, w: 22, h: 22, painted: true };
    });
    ok('首開/取得藍點應在的位置', !!dotRect, JSON.stringify(dotRect));
    if (dotRect) {
      // 把實際渲染的畫面截回來、在瀏覽器裡解碼數像素（不引第三方影像套件）
      const shot = (await page.screenshot({ clip: { x: Math.max(0, dotRect.x - 6), y: Math.max(0, dotRect.y - 6),
                                                    width: dotRect.w + 12, height: dotRect.h + 12 } })).toString('base64');
      const px = await page.evaluate(async b64 => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let blue = 0;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          if (b > 190 && b - r > 70 && b - g > 40) blue++; // 藍點 #2b8fff = rgb(43,143,255)
        }
        return { blue, total: d.length / 4 };
      }, shot);
      ok('首開/藍點真的畫在畫面上（像素證據，非 DOM 存在）', px.blue >= 30,
         `藍色像素 ${px.blue}/${px.total}`);
    }
    const cached = await page.evaluate(k => localStorage.getItem(k), GEO_KEY);
    ok('首開/座標已寫入本機快取（下次開才可能 0 秒落點）', !!cached && JSON.parse(cached).lat.toFixed(3) === TPE.lat.toFixed(3));
    await ctx.close();
  }

  // 2) 第二次開（有快取）：這是這次改動的主要賣點——落點不該等定位
  {
    const seed = { lat: TPE.lat, lon: TPE.lon, acc: 60, t: Date.now() };
    const { ctx, page } = await newPage(browser, { seedGeo: seed });
    const ms = await timeToLand(page, `${BASE}/?geomock=${TPE.lat},${TPE.lon}&geodelay=6000`, TPE);
    ok('二次開/不等定位就落在我的位置', ms !== null && ms < 6000,
       ms === null ? '20 秒內都沒落點' : `${ms}ms（定位 mock 刻意設 6000ms 才回，落點早於它即證明走快取）`);
    await ctx.close();
  }

  // 3) 快取座標與真實位置不同（人移動了）：先用快取落點，新定位到了要靜靜校正過去
  {
    const seed = { lat: TPE.lat, lon: TPE.lon, acc: 60, t: Date.now() };
    const { ctx, page } = await newPage(browser, { seedGeo: seed });
    await page.goto(`${BASE}/?geomock=${KHH.lat},${KHH.lon}&geodelay=2000`, { waitUntil: 'commit' });
    await waitReady(page);
    await page.waitForTimeout(3500);
    const c = await center(page);
    ok('快取過期/人移動了：校正到真實位置', c && km(c, KHH) < 1.5,
       c ? `離高雄 ${km(c, KHH).toFixed(2)}km` : 'no map');
    await ctx.close();
  }

  // 4) 拒絕權限：不能崩、不能卡在空白，要安靜退回原本落點
  {
    const { ctx, page } = await newPage(browser);
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(`${BASE}/?geofail=1`, { waitUntil: 'commit' });
    await waitReady(page);
    await page.waitForTimeout(2000);
    const c = await center(page);
    ok('拒絕定位權限：不崩、地圖照常呈現全台', c && c.z >= 6 && errs.length === 0,
       `z=${c ? c.z : '?'}、pageerror ${errs.length} 筆`);
    await ctx.close();
  }

  // 5) 境外座標：地圖鎖台灣，不該把鏡頭丟到國外
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(`${BASE}/?geomock=${TKY.lat},${TKY.lon}&geodelay=500`, { waitUntil: 'commit' });
    await waitReady(page);
    await page.waitForTimeout(2500);
    const c = await center(page);
    ok('境外定位不落點（維持全台同框）', c && km(c, TKY) > 500, c ? `離東京 ${km(c, TKY).toFixed(0)}km` : 'no map');
    const cached = await page.evaluate(k => localStorage.getItem(k), GEO_KEY);
    ok('境外座標不寫進快取', !cached);
    await ctx.close();
  }

  // 6) 深連結優先：分享連結進來的人不該被定位搶走，連權限都不該被問
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(`${BASE}/?g=nat&at=${KHH.lat},${KHH.lon}&z=13&geomock=${TPE.lat},${TPE.lon}&geodelay=300`, { waitUntil: 'commit' });
    await waitReady(page);
    await page.waitForTimeout(2500);
    const c = await center(page);
    ok('深連結壓過定位（停在連結指定的地點）', c && km(c, KHH) < 2, c ? `離高雄 ${km(c, KHH).toFixed(2)}km` : 'no map');
    const started = await page.evaluate(() => !!(window.__state && window.__state._bootGeo));
    ok('深連結訪客根本不發起定位（不彈權限詢問）', started === false);
    await ctx.close();
  }

  // 7) 定位壓過「上次視野」（使用者選的優先序）
  {
    const { ctx, page } = await newPage(browser, { seedLastView: { g: 'all', lat: KHH.lat, lon: KHH.lon, z: 13, sel: null },
                                                   seedGeo: { lat: TPE.lat, lon: TPE.lon, acc: 60, t: Date.now() } });
    await page.goto(`${BASE}/?geomock=${TPE.lat},${TPE.lon}&geodelay=800`, { waitUntil: 'commit' });
    await waitReady(page);
    await page.waitForTimeout(2000);
    const c = await center(page);
    ok('定位優先於「上次視野」', c && km(c, TPE) < 1.5, c ? `離台北 ${km(c, TPE).toFixed(2)}km` : 'no map');
    await ctx.close();
  }

  // 8) 互動累積狀態：使用者已經自己拖了地圖，晚到的定位不准搶鏡頭
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(`${BASE}/?geomock=${TPE.lat},${TPE.lon}&geodelay=4000`, { waitUntil: 'commit' });
    await waitReady(page);
    await page.evaluate(() => { const el = document.getElementById('howtoWrap'); if (el) el.remove(); }); // 首訪教學卡 z800 蓋住全畫面，不移掉拖曳根本落不到地圖
    await page.mouse.move(195, 450); await page.mouse.down();
    await page.mouse.move(195, 330, { steps: 12 }); await page.mouse.up();
    // 獨立斷言：分辨「守門沒生效」與「拖曳根本沒發生」——兩者的表徵都是鏡頭被搶走
    const moved = await page.evaluate(() => !!(window.__state && window.__state._userMoved));
    ok('使用者拖曳有被認到（_userMoved 立起來）', moved === true);
    await page.waitForTimeout(1600); // 等 Leaflet 拖曳慣性滑完再取基準，否則量到的是滑行中途（WebKit 慣性比 Chromium 明顯）
    const afterDrag = await center(page);
    await page.waitForTimeout(4500);
    const later = await center(page);
    // 主判準取「有沒有落到定位目標上」——這條不受慣性影響，慣性只會讓鏡頭離目標更遠、不會把它送上目標
    ok('使用者已在操作：晚到的定位不把鏡頭搶到我的位置', later && km(later, TPE) > 20,
       later ? `最終離定位目標 ${km(later, TPE).toFixed(1)}km（>20 即未被搶走）` : 'no map');
    ok('使用者已在操作：慣性停下後鏡頭不再自己動', afterDrag && later && km(afterDrag, later) < 3,
       afterDrag && later ? `相差 ${km(afterDrag, later).toFixed(2)}km` : 'no map');
    await ctx.close();
  }

  // 9) 「附近車站」鈕：存在、點得到、開得出清單
  {
    const seed = { lat: TPE.lat, lon: TPE.lon, acc: 60, t: Date.now() };
    const { ctx, page } = await newPage(browser, { seedGeo: seed });
    await page.goto(`${BASE}/?geomock=${TPE.lat},${TPE.lon}&geodelay=500`, { waitUntil: 'commit' });
    await waitReady(page);
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const w = document.getElementById('howtoWrap'); if (w) w.remove(); }); // 首訪教學卡 z800 會擋住點擊
    const nb = page.locator('#nearBtn');
    ok('附近車站鈕：App 版可見', await nb.isVisible());
    // 命中測試：rect 中心真的點得到這顆鈕（不是被別的東西蓋住）
    const hit = await page.evaluate(() => {
      const b = document.getElementById('nearBtn'); if (!b) return 'no btn';
      const r = b.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el && (el === b || b.contains(el)) ? 'hit' : (el ? el.id || el.className || el.tagName : 'null');
    });
    ok('附近車站鈕：中心點命中自己（沒被蓋住）', hit === 'hit', String(hit));
    await nb.click();
    await page.waitForTimeout(900);
    const card = await page.evaluate(() => {
      const el = document.getElementById('nearCard');
      return el ? { hidden: el.hidden, rows: el.querySelectorAll('button, li, .near-row').length, txt: (el.textContent || '').slice(0, 40) } : null;
    });
    ok('附近車站鈕：點了開出車站清單', card && !card.hidden && card.rows > 0,
       card ? `hidden=${card.hidden}、列數=${card.rows}、「${card.txt.replace(/\s+/g, ' ')}」` : 'no card');
    await ctx.close();
  }

  // 10) 網站零變化：正式網站沒有原生定位橋接，整套開機定位與「附近車站」都不該出現
  //     （網站是活的，這次改動只准影響 App；不帶 geomock 參數＝正式網站的真實狀態）
  {
    const { ctx, page } = await newPage(browser);
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(`${BASE}/`, { waitUntil: 'commit' });
    await waitReady(page);
    await page.waitForTimeout(1500);
    const web = await page.evaluate(() => ({
      bridge: !!window.RAIL_NATIVE_GEOLOCATION,
      nearBtn: !!document.getElementById('nearBtn'),
      drawerRow: !!document.querySelector('.ms-row[data-proxy="nearBtn"]'),
      bootGeo: !!(window.__state && window.__state._bootGeo),
      cache: !!localStorage.getItem('trainmap-last-geo'),
      z: window.__map.getZoom(),
    }));
    ok('網站：沒有原生橋接就不注入 mock（LOCATE_ENABLED 維持 false）', web.bridge === false, JSON.stringify(web));
    ok('網站：不出現「附近車站」鈕與抽屜列（點了會沒反應）', !web.nearBtn && !web.drawerRow);
    ok('網站：完全不發起開機定位、不寫定位快取', !web.bootGeo && !web.cache);
    ok('網站：開場照舊全台同框、無 JS 例外', web.z >= 6 && web.z <= 9 && errs.length === 0, `z=${web.z}、pageerror ${errs.length}`);
    await ctx.close();
  }

  // 11) 版面碰撞：新鈕不能壓到任何既有控件（含公告橫幅出現時），多寬度掃描
  for (const w of [360, 375, 390, 414, 768]) {
    const { ctx, page } = await newPage(browser, { width: w, height: 844,
      seedGeo: { lat: TPE.lat, lon: TPE.lon, acc: 60, t: Date.now() } });
    await page.goto(`${BASE}/?geomock=${TPE.lat},${TPE.lon}&geodelay=400`, { waitUntil: 'commit' });
    await waitReady(page);
    await page.waitForTimeout(1200);
    await page.evaluate(() => { const el = document.getElementById('howtoWrap'); if (el) el.remove(); });

    for (const banner of [false, true]) {
      const res = await page.evaluate(showBanner => {
        const ab = document.getElementById('alertBanner');
        if (showBanner) { ab.hidden = false; ab.textContent = '⚠ 測試用公告橫幅：台鐵營運資訊'; }
        else { ab.hidden = true; ab.textContent = ''; }
        const nb = document.getElementById('nearBtn');
        if (!nb || nb.hidden) return { skip: true };
        const vis = el => { const s = getComputedStyle(el); const r = el.getBoundingClientRect();
          return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > .05 && !el.hidden && r.width > 0 && r.height > 0; };
        if (!vis(nb)) return { skip: true };
        const n = nb.getBoundingClientRect();
        const others = ['#randBtn', '.badge', '.topbar', '.alert-banner', '.controls', '.tabbar',
                        '.follow-panel', '.freq-card', '.leaflet-control-attribution', '.dwell-plate', '.xing-card'];
        const hits = [];
        for (const sel of others) {
          const el = document.querySelector(sel); if (!el || !vis(el)) continue;
          const r = el.getBoundingClientRect();
          const ix = Math.min(n.right, r.right) - Math.max(n.left, r.left);
          const iy = Math.min(n.bottom, r.bottom) - Math.max(n.top, r.top);
          if (ix > 1 && iy > 1) hits.push(`${sel}(${Math.round(ix)}×${Math.round(iy)}px)`);
        }
        return { hits, rect: { x: Math.round(n.x), y: Math.round(n.y), w: Math.round(n.width), h: Math.round(n.height) },
                 inView: n.right <= innerWidth + .5 && n.left >= -.5 && n.bottom <= innerHeight + .5 && n.top >= -.5,
                 tall: n.height >= 30 };
      }, banner);
      if (res.skip) continue;
      const tag = `${w}px${banner ? '＋公告橫幅' : ''}`;
      ok(`版面 ${tag}：附近車站鈕不壓到其他控件`, res.hits.length === 0, res.hits.join('、'));
      ok(`版面 ${tag}：附近車站鈕完整在畫面內`, res.inView, JSON.stringify(res.rect));
    }
    await ctx.close();
  }

  await browser.close();
}

await run(chromium, 'Chromium');
await run(webkit, 'WebKit（iPhone 上的引擎）');

const bad = R.filter(r => !r.p);
console.log(`\n═══ ${R.length - bad.length}/${R.length} 通過 ═══`);
if (bad.length) { console.log('未通過：'); bad.forEach(b => console.log(`  · ${b.n} — ${b.msg}`)); process.exit(1); }
