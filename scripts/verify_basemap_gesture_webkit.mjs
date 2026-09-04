#!/usr/bin/env node
// WebKit（Safari／WKWebView 引擎）版的手勢跨層同步驗證——verify_basemap_gesture.mjs 是 Chromium（CDP screencast），
// 但「拖曳時軌道慢半拍」是 WebKit 才看得到的（rAF 排程順序不同），App 又是 WKWebView，所以這支專門用 WebKit 量：
//   (1) drag：桌面拖曳中連拍截圖，量底圖探針（洋紅，MapLibre 畫）與 overlay 探針（青，latLngToContainerPoint 畫）的距離
//   (2) pinch：Playwright WebKit 沒有觸控捏合協定，改用 Leaflet TouchZoom 內部同一組呼叫（_moveStart/_move(pinch)/_animateZoom）
//       模擬「捏合 → 放手收斂動畫」，焦點刻意離探針 ~250px（仿射 k 標錯時探針才會明顯分開），動畫中連拍
// 用法：arch -arm64 node scripts/verify_basemap_gesture_webkit.mjs [www目錄=repo 根] [--engine webkit|chromium] [--out 截圖目錄]
// 判準：drag 12 次取樣中距離 >1.5px 的 ≤2 次（閒置基準 0.5–0.9px 是次像素取整）；pinch 收斂動畫每一拍距離 ≤2px；頁面錯誤 0
// 已知基準（2026-08-19，修復前 bc2d649）：drag 9/12 取樣 1.9–3.3px；pinch 動畫整段 206–217px（overlay 停在捏合前版面）
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { webkit, chromium } from 'playwright';
import sharp from 'sharp';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const WWW = resolve(positional[0] || join(import.meta.dirname, '..'));
const ENGINE = opt('engine', 'webkit'); const OUT = opt('out', '');
const PORT = Number(process.env.GESTURE_PORT || (ENGINE === 'webkit' ? 43591 : 43592));
const DOT = { lat: 23.4700, lng: 120.9570 };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const built = await readFile(join(WWW, 'index.html'), 'utf8');
console.log(`[G0] ${ENGINE} ${WWW} index.html ${built.length} bytes`);
if (!built.includes('aligndot')) { console.error('❌ [G0] 這份 build 缺 aligndot 探針——驗錯目標'); process.exit(1); }
const server = createServer(async (rq, rs) => { try { const p = decodeURIComponent(new URL(rq.url, 'http://x').pathname); const f = join(WWW, p === '/' ? 'index.html' : p); if (!f.startsWith(WWW)) { rs.statusCode = 403; return rs.end(); } const b = await readFile(f); rs.setHeader('content-type', MIME[extname(f)] || 'application/octet-stream'); rs.end(b); } catch { rs.statusCode = 404; rs.end('nf'); } });
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
if (OUT) await mkdir(OUT, { recursive: true });
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();

async function openPage(mobile) {
  const ctx = await browser.newContext(mobile
    ? { viewport: { width: 393, height: 780 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }
    : { viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
  await ctx.route('**://tiles.stadiamaps.com/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG1 }));
  await ctx.route('**/api/**', async r => { const u = new URL(r.request().url()); try { const res = await fetch('https://railisland.tw' + u.pathname + u.search, { headers: { accept: 'application/json' } }); await r.fulfill({ status: res.status, contentType: res.headers.get('content-type') || 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await res.text() }); } catch { await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }); } });
  await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-appearance', 'light'); localStorage.setItem('trainmap-powersave', '0'); } catch (e) {} });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  // M4-A(2026-09-04)起預設引擎是 MapLibre;這支量的是 Leaflet TouchZoom 內部呼叫與 Leaflet 的 aligndot 路徑,釘 ?engine=leaflet 守逃生口那條路。
  // MapLibre 的 WebKit 手勢與探針對齊由 verify_map_orientation.mjs／verify_align_follow.mjs 守。
  await page.goto(`http://127.0.0.1:${PORT}/index.html?engine=leaflet&aligndot=${DOT.lat},${DOT.lng}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__map && window.__ofmGl, null, { timeout: 45000 });
  await page.waitForFunction(() => window.__state && window.__state.ready, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.evaluate(([lat, lng]) => window.__map.setView([lat, lng], 12, { animate: false }), [DOT.lat, DOT.lng]);
  await page.waitForFunction(() => window.__ofmGl.loaded() && window.__ofmGl.isStyleLoaded(), null, { timeout: 45000 });
  await page.waitForTimeout(2500);
  return { ctx, page, errs };
}
function blob(data, w, h, ch, test) { let n = 0, sx = 0, sy = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * ch; if (!test(data[i], data[i + 1], data[i + 2])) continue; n++; sx += x; sy += y; } return n ? { n, cx: sx / n, cy: sy / n } : null; }
async function gap(page, dpr, tag) {
  const st = await page.evaluate(() => { const s = window.__state, m = window.__map; return { za: !!s._zoomAnim, k: s._zaAff ? +s._zaAff.k.toFixed(3) : null, z: +m.getZoom().toFixed(3), anim: !!m._animatingZoom }; });
  const buf = await page.screenshot();
  if (OUT) await writeFile(join(OUT, `${ENGINE}-${tag}.png`), buf);
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const mag = blob(data, info.width, info.height, info.channels, (r, g, b) => r > 200 && g < 70 && b > 200);
  const cy = blob(data, info.width, info.height, info.channels, (r, g, b) => r < 70 && g > 200 && b > 200);
  const d = mag && cy ? Math.hypot(mag.cx - cy.cx, mag.cy - cy.cy) / dpr : null;
  const line = `${tag} z=${st.z} anim=${st.anim ? 1 : 0} za=${st.za ? 1 : 0} k=${st.k === null ? '-' : st.k}: ` + (d === null ? `探針缺(${mag ? mag.n : 0}/${cy ? cy.n : 0})`
    : `洋紅(${(mag.cx / dpr).toFixed(1)},${(mag.cy / dpr).toFixed(1)}) 青(${(cy.cx / dpr).toFixed(1)},${(cy.cy / dpr).toFixed(1)}) 距離 ${d.toFixed(1)}px`);
  return { d, line, st };
}

const results = [];
// ── (1) 桌面拖曳 ──
{
  const { ctx, page, errs } = await openPage(false);
  const rows = [await gap(page, 1, 'drag-idle')];
  const cx = 550, cy0 = 380;
  await page.mouse.move(cx, cy0); await page.mouse.down();
  // 驅動端連發中繼 mousemove（不等待），中途連拍截圖插隊進協定佇列 → 拿到拖曳進行中的合成幀
  const mv = page.mouse.move(cx - 300, cy0 - 200, { steps: 400 }).catch(() => {});
  for (let i = 0; i < 12; i++) rows.push(await gap(page, 1, 'drag' + i));
  await mv; await page.mouse.up();
  rows.push(await gap(page, 1, 'drag-released')); await page.waitForTimeout(600); rows.push(await gap(page, 1, 'drag-settled'));
  for (const r of rows) console.log('  ' + r.line);
  const mid = rows.slice(1, 13).map(r => r.d);
  const over = mid.filter(d => d === null || d > 1.5).length;
  const ok = over <= 2 && errs.length === 0;
  console.log(`${ok ? '✅' : '❌'} drag：拖曳中 12 次取樣，>1.5px 的 ${over} 次（最大 ${Math.max(...mid.filter(d => d !== null)).toFixed(1)}px）｜頁面錯誤 ${errs.length}`);
  results.push(ok); await ctx.close();
}
// ── (2) 手機捏合 → 放手收斂動畫 ──
{
  const { ctx, page, errs } = await openPage(true);
  const rows = [await gap(page, 2, 'pinch-idle')];
  await page.evaluate(() => {
    const m = window.__map, size = m.getSize();
    const P = L.point(size.x / 2 + 120, size.y / 2 + 200), Pll = m.containerPointToLatLng(P), half = size.divideBy(2);
    window.__pinch = { i: 0, N: 20, done: false };
    m._moveStart(true, false);
    const step = () => {
      const p = window.__pinch; p.i++;
      const z = 12 + 0.926 * p.i / p.N;
      const c = m.unproject(m.project(Pll, z).subtract(P.subtract(half)), z); // 焦點 P 底下的世界點不動（TouchZoom 同款）
      m._move(c, z, { pinch: true, round: false });
      if (p.i < p.N) { requestAnimationFrame(step); return; }
      setTimeout(() => { m._animateZoom(c, m._limitZoom(z), true, m.options.zoomSnap); p.done = true; }, 40); // TouchZoom._onTouchEnd 同款
    };
    requestAnimationFrame(step);
  });
  await page.waitForFunction(() => window.__pinch && window.__pinch.done, null, { timeout: 5000 });
  for (let i = 0; i < 9; i++) rows.push(await gap(page, 2, 'pinch-anim' + i));
  await page.waitForTimeout(500); rows.push(await gap(page, 2, 'pinch-settled'));
  for (const r of rows) console.log('  ' + r.line);
  const anim = rows.filter(r => r.st.anim);
  const bad = anim.filter(r => r.d === null || r.d > 2).length;
  const ok = anim.length >= 3 && bad === 0 && errs.length === 0;
  console.log(`${ok ? '✅' : '❌'} pinch：收斂動畫中量到 ${anim.length} 拍，>2px 的 ${bad} 拍（最大 ${anim.length ? Math.max(...anim.map(r => r.d ?? 999)).toFixed(1) : '-'}px）｜頁面錯誤 ${errs.length}`);
  results.push(ok); await ctx.close();
}
await browser.close(); server.close();
const fails = results.filter(x => !x).length;
console.log(fails ? `❌ ${fails}/${results.length} 未過` : `✅ ${results.length}/${results.length} 通過`);
process.exit(fails ? 1 : 0);
