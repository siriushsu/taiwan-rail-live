#!/usr/bin/env node
// 跨層對齊:OpenFreeMap 底圖(MapLibre GL)與列車 overlay 有沒有對在一起。
//
// 🔴 判準為什麼是「數畫面上的像素」而不是比兩個投影函式:
// 記憶 心得 29 的教訓——判準的真值來源若與實作共用任何推導假設(同一顆矩陣、同一條公式、
// 同一個基準模型),量出來的 0px 是零資訊。這裡量的是**最終合成畫面上的兩個亮點**:
//   · 洋紅(#ff00ff, r=18):交給 MapLibre 自己依經緯度畫,完全不經過我們的投影程式碼
//   · 青色(#00ffff, r=5) :畫在列車畫布上,走 map.latLngToContainerPoint()——**列車用的同一條路徑**
// 兩者唯一的共同點是那個經緯度字面值。距離幾像素,列車就跟底圖差幾像素。
//
// 🔴 情境為什麼不能只有「乾淨載入」:心得 28/29——投影 bug 常常只在「平移之後」才顯形
// (panePos 非零時才與 layer-space 公式分岔),乾淨載入時兩邊恰好等價,整套判準會集體失明。
// 所以五個情境有四個帶互動累積狀態。
//
// 用法:node scripts/verify_basemap_align.mjs [www目錄]
//       MUTATE=basemap|overlay 注入已知偏移,用來證明這支判準有牙。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const WWW = resolve(process.argv[2] || join(import.meta.dirname, '..', 'app', 'www'));
const PORT = Number(process.env.ALIGN_PORT || 43531);
const MUTATE = process.env.MUTATE || '';
// 🔴 探針位置刻意選在中央山脈(玉山一帶)這種**沒有鐵路**的地方,不是台北車站。
// 實測教訓:在台北車站量到「差 9.7px」,追下去發現不是真的錯位——列車 overlay 會把
// 路線與站名畫在洋紅探針上面,洋紅只剩 109/1018 個像素的碎片,形心被遮擋咬歪了。
// (外接框中心其實只差 1px ⇒ 底圖本來就是對的,是判準被汙染。)
// 換到沒有鐵路的地方,overlay 除了那顆青點什麼都不畫,兩顆都乾淨。
const DOT = { lat: 23.4700, lng: 120.9570 };
const THRESHOLD_PX = 2;                                // 計畫驗收條件:對照組 ≤ 2px
// 探針健全性下限——這幾個數字不是憑感覺,是實測乾淨狀態量到的:洋紅 791px/34x34、青色 70px/10x10。
// 🔴 這道閘門是本檔最重要的一條:洋紅一旦被 overlay 蓋掉,形心會安靜地偏掉幾像素,
// 距離照樣算得出來、看起來也還算小 ⇒ 假數字比缺數字危險得多,所以寧可當場失敗。
const MAG_MIN_PX = 600, MAG_MAX_PX = 1200, CY_MIN_PX = 45, CY_MAX_PX = 110;
const MUT_OFFSET = 30;                                 // 突變注入的已知偏移量
// 起始 zoom 刻意不用低倍率:z7 的視野比台灣框還大,maxBounds 會把中心釘死,
// panBy 就拉不回探針(症狀是「探針不見了」)。整組情境保持在 12–15 之間。
const START_Z = 13;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

const built = await readFile(join(WWW, 'index.html'), 'utf8');
console.log(`[G0] 目標 ${WWW}  index.html ${built.length} bytes  MUTATE=${MUTATE || '(無,對照組)'}`);
for (const f of ['aligndot', "L.maplibreGL({ style: OFM_STYLE[k]"]) {
  if (!built.includes(f)) { console.error(`❌ [G0] 這份 build 缺「${f}」——驗錯目標或 build 過期`); process.exit(1); }
}

const server = createServer(async (rq, rs) => {
  try {
    const p = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
    const f = join(WWW, p === '/' ? 'index.html' : p);
    if (!f.startsWith(WWW)) { rs.statusCode = 403; return rs.end(); }
    const b = await readFile(f);
    rs.setHeader('content-type', MIME[extname(f)] || 'application/octet-stream');
    rs.end(b);
  } catch { rs.statusCode = 404; rs.end('nf'); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
// Stadia 是計費端點,一律假 PNG,驗收絕不去打它
await ctx.route('**://tiles.stadiamaps.com/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG1 }));
// /api 走真正式站:用 {} 假 stub 會讓 boot 拋 sys.data.trains,列車畫布的 draw() 就不會跑,
// 青色那顆探針畫不出來 ⇒ 整支判準靜默失效(實測踩過)
await ctx.route('**/api/**', async r => {
  const u = new URL(r.request().url());
  try {
    const res = await fetch('https://railisland.tw' + u.pathname + u.search, { headers: { accept: 'application/json' } });
    await r.fulfill({ status: res.status, contentType: res.headers.get('content-type') || 'application/json',
      headers: { 'access-control-allow-origin': '*' }, body: await res.text() });
  } catch { await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }); }
});
// 首訪教學卡會蓋住地圖 ⇒ 兩顆探針一顆都量不到(既有 E2E 慣例,實測踩過)
await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-appearance', 'light'); } catch (e) {} });

const page = await ctx.newPage();
const pageErrs = [];
page.on('pageerror', e => pageErrs.push(String(e).slice(0, 110)));
await page.goto(`http://127.0.0.1:${PORT}/index.html?aligndot=${DOT.lat},${DOT.lng}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.__map !== 'undefined' && window.__map && window.__ofmGl, null, { timeout: 45000 });
// 🔴 一定要等 boot 真的跑完再 setView。實測教訓:boot 後段會把視圖重設成全島(z7),
// 早設的 setView 被無聲蓋掉 ⇒ 整組情境其實跑在 z7。而 z7 落在上面說的 maxBounds 釘死區,
// 於是失敗訊息顯示成「探針不見了」,跟真正的原因(setView 沒生效)差了十萬八千里。
await page.waitForFunction(() => window.__state && window.__state.ready, null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.evaluate(([lat, lng, z]) => window.__map.setView([lat, lng], z, { animate: false }), [DOT.lat, DOT.lng, START_Z]);
await page.waitForFunction(() => window.__ofmGl && window.__ofmGl.loaded() && window.__ofmGl.isStyleLoaded(), null, { timeout: 45000 });
await page.waitForTimeout(3000);
// 前置閘門:確認 setView 真的生效——沒有這條,上面那個坑會再靜默重演一次
const zStart = await page.evaluate(() => window.__map.getZoom());
if (zStart !== START_Z) {
  console.error(`❌ 前置失敗:setView 沒生效(現在 z=${zStart},期望 ${START_Z})——boot 又把視圖蓋掉了,情境全部無效`);
  await browser.close(); server.close(); process.exit(1);
}

// 突變要在**每次量測前**重新套用,不能只在開頭套一次。
// 實測教訓:縮放時 Leaflet 會重新定位 maplibre 的 pane 並把 canvas 的 inline transform 覆寫掉,
// 於是「底圖平移」這個突變只在 S1/S2 有效,S3 之後自己消失、判準看起來沒牙——
// 那是產品把注入抹掉了,不是判準漏抓。overlay 那半是包裝函式所以本來就活得下來,
// 但為了兩邊對稱、也為了不重複包裝,一律走這支冪等的 applyMutation()。
async function applyMutation() {
  if (MUTATE === 'basemap') {
    await page.evaluate(d => { window.__ofmGl.getCanvas().style.transform = `translateX(${d}px)`; }, MUT_OFFSET);
  } else if (MUTATE === 'overlay') {
    await page.evaluate(d => {
      const m = window.__map;
      if (m.__alignMutated) return;               // 冪等:重複包裝會變成 60px、90px…
      const orig = m.latLngToContainerPoint.bind(m);
      m.latLngToContainerPoint = (...a) => { const p = orig(...a); return new L.Point(p.x, p.y + d); };
      m.__alignMutated = true;
    }, MUT_OFFSET);
  }
}
await applyMutation();

const settle = async () => {
  await page.waitForFunction(() => window.__ofmGl && window.__ofmGl.loaded(), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1800);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
};

// 找一種顏色的連通亮點:回傳形心、像素數與外接框(外接框用來擋「量到雜訊」)
function blob(data, w, h, ch, test) {
  let n = 0, sx = 0, sy = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * ch;
    if (!test(data[i], data[i + 1], data[i + 2])) continue;
    n++; sx += x; sy += y;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return n ? { n, cx: sx / n, cy: sy / n, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null;
}

const results = [];
// 縮放是繞著地圖中心進行的,所以連縮幾階就會把探針推出畫面(實測 S4/S5 兩顆都量不到)。
// 這裡在量測前把它拉回可視範圍——刻意不拉到正中心,讓 Leaflet 的 pane 位移保持非零,
// 因為「平移之後」正是投影 bug 才會顯形的狀態(心得 28/29),歸零等於把要驗的東西驗掉。
async function keepVisible() {
  await page.evaluate(([lat, lng]) => {
    const m = window.__map, s = m.getSize(), p = m.latLngToContainerPoint([lat, lng]);
    if (p.x > 90 && p.y > 90 && p.x < s.x - 90 && p.y < s.y - 90) return;
    m.panBy([Math.round(p.x - (s.x * 0.5 + 57)), Math.round(p.y - (s.y * 0.5 - 43))], { animate: false });
  }, [DOT.lat, DOT.lng]);
}

const zoomNow = () => page.evaluate(() => window.__map.getZoom());
async function measure(id, act) {
  const z0 = await zoomNow();
  if (act) await page.evaluate(act);
  const z1 = await zoomNow();
  await keepVisible();
  const z2 = await zoomNow();
  await settle();
  const z3 = await zoomNow();
  console.log(`   [z軌跡] ${id}: 動作前 ${z0} → 動作後 ${z1} → 拉回後 ${z2} → settle後 ${z3}`);
  await applyMutation();                 // 重新套用(縮放會把 inline transform 抹掉)
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const view = await page.evaluate(([lat, lng]) => {
    const m = window.__map, s = m.getSize(), p = m.latLngToContainerPoint([lat, lng]);
    return { z: m.getZoom(), sx: s.x, sy: s.y, px: Math.round(p.x), py: Math.round(p.y) };
  }, [DOT.lat, DOT.lng]);
  const where = `z=${view.z} 探針容器座標=(${view.px},${view.py}) 容器=${view.sx}x${view.sy}`;
  const buf = await page.screenshot();
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  const mag = blob(data, w, h, ch, (r, g, b) => r > 200 && g < 70 && b > 200);
  const cy = blob(data, w, h, ch, (r, g, b) => r < 70 && g > 200 && b > 200);
  // 偵測器健全性:兩顆都要在,而且要夠小夠緊——量到一大片就是抓到別的東西(UI/路線色),
  // 那時候的「距離」毫無意義,必須當場失敗而不是安靜地報一個數字。
  if (!mag || !cy) { results.push({ id, pass: false, detail: `探針不見了(洋紅=${mag ? mag.n : 0}px 青色=${cy ? cy.n : 0}px)——判準失效,不是對齊良好｜${where}` }); return; }
  if (mag.w > 60 || mag.h > 60 || cy.w > 40 || cy.h > 40) {
    results.push({ id, pass: false, detail: `亮點外接框過大(洋紅 ${mag.w}x${mag.h}、青色 ${cy.w}x${cy.h})——很可能量到 UI 或路線色` }); return;
  }
  if (mag.n < MAG_MIN_PX || mag.n > MAG_MAX_PX || cy.n < CY_MIN_PX || cy.n > CY_MAX_PX) {
    results.push({ id, pass: false,
      detail: `探針像素數不在乾淨區間(洋紅 ${mag.n}∉[${MAG_MIN_PX},${MAG_MAX_PX}]／青色 ${cy.n}∉[${CY_MIN_PX},${CY_MAX_PX}])`
        + `——多半是被 overlay 蓋掉一部分,此時形心會被遮擋咬歪,算出來的距離是假的｜${where}` }); return;
  }
  const d = Math.hypot(mag.cx - cy.cx, mag.cy - cy.cy);
  const want = MUTATE ? d >= MUT_OFFSET * 0.6 : d <= THRESHOLD_PX;
  results.push({ id, pass: want, d,
    detail: `距離 ${d.toFixed(2)}px（洋紅 ${mag.n}px @${mag.cx.toFixed(1)},${mag.cy.toFixed(1)}／青色 ${cy.n}px @${cy.cx.toFixed(1)},${cy.cy.toFixed(1)}）` });
}

const D = [DOT.lat, DOT.lng];
await measure('S1 乾淨載入', null);
await measure('S2 平移後', () => window.__map.panBy([137, 89], { animate: false }));
await measure('S3 平移後再縮放', () => { window.__map.panBy([-71, 53], { animate: false }); window.__map.setZoom(window.__map.getZoom() + 1, { animate: false }); });
await measure('S4 連續累積縮放', () => { const m = window.__map; for (let i = 0; i < 2; i++) m.setZoom(m.getZoom() + 1, { animate: false }); m.setZoom(m.getZoom() - 1, { animate: false }); });
await measure('S5 縮放→平移→再縮放', () => { const m = window.__map; m.setZoom(m.getZoom() - 2, { animate: false }); m.panBy([211, -97], { animate: false }); m.setZoom(m.getZoom() + 1, { animate: false }); });

await browser.close(); server.close();
console.log('');
for (const r of results) console.log(`${r.pass ? '✅' : '❌'} ${r.id} — ${r.detail}`);
if (pageErrs.length) console.log(`（頁面錯誤：${pageErrs[0]}）`);
const bad = results.filter(r => !r.pass);
const label = MUTATE ? `突變 ${MUTATE}（期望每個情境都 ≥${MUT_OFFSET * 0.6}px）` : `對照組（期望每個情境都 ≤${THRESHOLD_PX}px）`;
console.log(`\n${label}：${results.length} 項，通過 ${results.length - bad.length}，失敗 ${bad.length}`);
process.exit(bad.length ? 1 : 0);
