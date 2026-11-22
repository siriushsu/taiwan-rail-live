// 算繪發布影片：逐格呼叫 film.html 的 renderAt(t) 截圖，再用 ffmpeg 編成 MP4。
// 用法：node prototypes/ride-guide/film/render_film.mjs [--fps 60] [--scale 1.3333] [--from 0] [--to 58] [--audio 配樂.wav]
//   先跑 capture_assets.mjs 產生 assets/（原型真實畫面）；配樂用 python3 score.py 產生（對準同一份剪接點）。
//   時間以成片時間 T 計，每格先經 FILM.warp(T) 換成動畫時間，剪接點才會落在配樂拍點上。
//   需要：playwright（或 PLAYWRIGHT_MODULE 指向全域安裝）、系統 ffmpeg（libx264）、本機 Noto Sans TC 字型。
// 輸出：prototypes/ride-guide/_video/ride-guide-launch.mp4（2560×1440、60fps；_video/ 與 frames/ 都不進版控）
//
// 為什麼逐格而不是錄影：renderAt(t) 是純函數，逐格截圖不會掉格、不受機器快慢影響，每一格都是滿解析度。
import { createServer } from 'node:http';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { availableParallelism } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const FPS = arg('fps', 60);
const SCALE = arg('scale', 4 / 3); // 1920×1080 舞台 × 4/3 ＝ 2560×1440
const ai = process.argv.indexOf('--audio');
const AUDIO = ai > 0 ? process.argv[ai + 1] : null;
const frameDir = join(here, 'frames');
const outDir = join(root, '_video');
await rm(frameDir, { recursive: true, force: true });
await mkdir(frameDir, { recursive: true });
await mkdir(outDir, { recursive: true });

let pw;
try { pw = await import('playwright'); } catch {
  if (!process.env.PLAYWRIGHT_MODULE) throw new Error('找不到 playwright；請 npm install 或設定 PLAYWRIGHT_MODULE');
  pw = await import(process.env.PLAYWRIGHT_MODULE);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = normalize(decodeURIComponent(u.pathname)).replace(/^\/+/, '');
  const f = join(root, p);
  if (!f.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }).end(await readFile(f)); }
  catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/film/film.html?render=1`;

const browser = await pw.chromium.launch();
const probe = await browser.newPage();
await probe.goto(url);
await probe.waitForFunction(() => window.FILM && window.FILM.ready === true, null, { timeout: 60000 });
const DUR = await probe.evaluate(() => window.FILM.DUR);
await probe.close();
const from = arg('from', 0), to = Math.min(arg('to', DUR), DUR);
const first = Math.round(from * FPS), last = Math.round(to * FPS); // [first, last)
const total = last - first;

// 幾個分頁平行算繪，各自負責一段連續的格
const WORKERS = Math.max(1, Math.min(4, availableParallelism() - 1));
const t0 = Date.now();
let done = 0;
async function worker(w) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: SCALE });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.FILM && window.FILM.ready === true, null, { timeout: 60000 });
  const per = Math.ceil(total / WORKERS);
  for (let i = first + w * per; i < Math.min(last, first + (w + 1) * per); i++) {
    await page.evaluate((T) => new Promise((r) => { window.FILM.renderAt(window.FILM.warp(T)); requestAnimationFrame(() => r()); }), i / FPS);
    await page.screenshot({ path: join(frameDir, `${String(i - first).padStart(6, '0')}.jpg`), type: 'jpeg', quality: 95 });
    if (++done % 120 === 0) console.log(`${done}/${total} 格，${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
  }
  if (errs.length) throw new Error('頁面錯誤：' + errs.join('；'));
  await page.close();
}
await Promise.all(Array.from({ length: WORKERS }, (_, w) => worker(w)));
await browser.close();
server.close();
console.log(`算繪 ${total} 格完成，${((Date.now() - t0) / 1000).toFixed(0)} 秒`);

const mp4 = join(outDir, 'ride-guide-launch.mp4');
const audioArgs = AUDIO ? ['-ss', String(from), '-t', String(to - from), '-i', AUDIO] : [];
const audioOut = AUDIO ? ['-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '256k', '-shortest'] : [];
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(frameDir, '%06d.jpg'), ...audioArgs,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-profile:v', 'high', '-pix_fmt', 'yuv420p', ...audioOut, '-movflags', '+faststart', mp4], { stdio: 'inherit' });
await rm(frameDir, { recursive: true, force: true });
console.log('寫出', mp4);
