// 桌面合成一支「像真機」的探針錄影(MapLibre 換引擎,設計書 3.2):手機視窗 402×874、dpr 3,連拍裝置像素截圖再用 x264
// yuv420p 壓成 mp4(手機錄影同款壓縮);頁面開 ?engine=maplibre&aligndot=follow,腳本代替手指做:平移、縮放、旋轉、傾斜、跟車、退出跟車、切暗色。
// 不用 Playwright 的 recordVideo:它的 screencast 在 CSS 解析度擷取再放大到指定尺寸,dpr3 的環會糊成 1/9 的像素、兩顆探針全找不到(09-04 實測)。
// 用途:真機錄影還沒到手之前,給 analyze_device_recording.mjs 一支「環探針＋影片壓縮＋dpr3」的控制組——
// 09-03 那支真機錄影是實心圓時代的(只能 --probe disc 跑),環的幾何在壓縮影片裡長什麼樣只有這支能先看到。
// 它不是真機:沒有合成器時序失步、沒有 WebKit,所以它 PASS 不能拿來解鎖 M4;它 FAIL 則一定是分析器或探針本身的問題。
// 用法:node scripts/record_probe_clip.mjs [--out 目錄]  → 印出影片路徑與擷取率;接著
//       node scripts/analyze_device_recording.mjs <影片.mp4> --dpr 3 --fps <擷取率>
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const OUT = path.resolve(opt('--out', path.join(ROOT, '.superpowers', 'probe-clip')));
const PORT = 43544, W = 402, H = 874, DPR = 3;
mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.geojson': 'application/geo+json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    res.setHeader('content-type', 'application/json');
    if (u.pathname === '/api/thsr-schedule') return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
    return res.end('{}');
  }
  let fp = path.join(ROOT, decodeURIComponent(u.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!existsSync(fp)) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true, locale: 'zh-TW' });
const page = await ctx.newPage(), errs = [];
page.on('pageerror', e => errs.push(String(e && e.message || e)));
await page.addInitScript(() => { localStorage.setItem('trainmap-howto-seen', '1'); });
await page.goto(`http://127.0.0.1:${PORT}/index.html?lang=zh-TW&engine=maplibre&aligndot=follow`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__state?.ready && window.__alignProbe && window.__alignProbe.state().live, null, { timeout: 60000 });
await page.waitForTimeout(1500);
// 連拍:截圖是一次完整合成(GL＋overlay 同一幀),能到幾 fps 就幾 fps;影格時距不均勻就當等距——這是幾何/顏色/壓縮的控制組,不是計時器
const frames = []; let capturing = true; const t0 = performance.now();
const capture = (async () => { while (capturing) { try { const png = await page.screenshot({ type: 'png' }); frames.push({ t: performance.now() - t0, png }); } catch (e) { break; } } })();
const step = async (name, fn, ms) => { console.log(`${name} …`); await page.evaluate(fn); await page.waitForTimeout(ms); };
await step('縮到台北 z13', () => __M.setView([25.046, 121.517], 13, { animate: false }), 2500);
await step('平移', () => __M.raw.panBy([120, 90], { duration: 1800 }), 2200);
await step('平移回來', () => __M.raw.panBy([-140, -60], { duration: 1800 }), 2200);
await step('放大', () => __M.raw.zoomTo(__M.getZoom() + 1.6, { duration: 1800 }), 2200);
await step('縮小', () => __M.raw.zoomTo(__M.getZoom() - 1.2, { duration: 1800 }), 2200);
await step('旋轉', () => __M.raw.rotateTo(40, { duration: 1800 }), 2200);
await step('傾斜', () => __M.raw.easeTo({ pitch: 45, duration: 1500 }), 2000);
await step('轉回＋放平', () => __M.raw.easeTo({ bearing: 0, pitch: 0, duration: 1500 }), 2000);
const fol = await page.evaluate(() => {
  const cand = (state.trains || []).map(tr => { const a = trainPos(tr, state.simSec - 5), b = trainPos(tr, state.simSec + 5); return { tr, heading: a && b ? initialBearing(a, b) : null }; })
    .find(x => Number.isFinite(x.heading) && Math.abs(x.heading) > 15);
  if (!cand) return null; setFollow(cand.tr, false, false); return cand.tr.train;
});
console.log('跟車', fol);
await page.waitForTimeout(9000); // 讓 app 自己的跟車相機跑(heading-up 每幀轉),探針要自己重錨
await step('退出跟車', () => clearFollow(), 1500);
await step('切暗色', () => __M.setStyleKind('dark'), 3000);
await step('切回亮色', () => __M.setStyleKind('light'), 2500);
const probeState = await page.evaluate(() => __alignProbe.state());
capturing = false; await capture;
await ctx.close(); await browser.close(); server.close();
const fdir = path.join(OUT, 'frames'); rmSync(fdir, { recursive: true, force: true }); mkdirSync(fdir, { recursive: true });
frames.forEach((fr, i) => writeFileSync(path.join(fdir, `f_${String(i + 1).padStart(5, '0')}.png`), fr.png));
const secs = (frames[frames.length - 1].t - frames[0].t) / 1000, fps = Math.max(1, Math.round((frames.length - 1) / secs));
const file = path.join(OUT, `probe-clip-dpr${DPR}-${fps}fps.mp4`);
const enc = spawnSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(fps), '-i', path.join(fdir, 'f_%05d.png'), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '20', file], { encoding: 'utf8' });
if (enc.status !== 0) { console.error('ffmpeg 失敗:' + enc.stderr); process.exit(1); }
console.log(`連拍 ${frames.length} 幀／${secs.toFixed(1)} 秒 ≈ ${fps} fps`);
console.log(`探針狀態:${JSON.stringify(probeState)}\npageerror:${JSON.stringify(errs)}\n影片:${file}\n下一步:node scripts/analyze_device_recording.mjs "${file}" --dpr ${DPR} --fps ${fps}`);
