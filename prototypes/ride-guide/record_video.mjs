// 錄製委員簡報影片：自動播放 present.html，逐格擷取畫面，再用 ffmpeg 合成 1080p MP4。
// 用法：node prototypes/ride-guide/record_video.mjs
//   需要：playwright（或 PLAYWRIGHT_MODULE 指向全域安裝）、系統 ffmpeg（libx264）。
//   字型：頁面字型棧優先用 Noto Sans TC；本機沒有時會退回系統中文字型，畫面仍可用但較不精緻。
// 輸出：prototypes/ride-guide/_video/ride-guide-demo.mp4（本目錄 .gitignore 已排除）
//
// 為什麼不用 Playwright 內建錄影：它固定低位元率 VP8，文字會糊。這裡改用 Chrome 的 screencast
// 逐格拿 JPEG，依每格的時間戳記換算停留時間，再交給 ffmpeg 以 30fps 編碼，文字清楚。
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '_video');
const frameDir = join(outDir, 'frames');
await rm(frameDir, { recursive: true, force: true });
await mkdir(frameDir, { recursive: true });

let pw;
try { pw = await import('playwright'); } catch {
  if (!process.env.PLAYWRIGHT_MODULE) throw new Error('找不到 playwright；請 npm install 或設定 PLAYWRIGHT_MODULE');
  pw = await import(process.env.PLAYWRIGHT_MODULE);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = normalize(decodeURIComponent(u.pathname)).replace(/^\/+/, '');
  if (!p || p.endsWith('/')) p += 'index.html';
  const f = join(here, p);
  if (!f.startsWith(here)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }).end(await readFile(f)); }
  catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
// 錄影環境不連外：Google Fonts 擋掉，直接用本機字型，避免載入時間影響節奏
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
await page.goto(base + 'present.html?record=1');
await page.waitForFunction(() => window.__tourReady === true);
// 先把所有導覽站跑一遍，讓照片進快取，錄影時不會出現圖片慢慢載入
for (const n of [5, 9, 14, 15]) { await page.evaluate((k) => window.RideTourStage.show(k), n); await page.waitForTimeout(900); }
await page.evaluate(() => window.RideTourStage.show(0));
await page.waitForTimeout(800);

const cdp = await ctx.newCDPSession(page);
const frames = [];
let pending = Promise.resolve();
cdp.on('Page.screencastFrame', (f) => {
  const k = frames.length;
  const file = join(frameDir, `${String(k).padStart(6, '0')}.jpg`);
  frames.push({ ts: f.metadata.timestamp, file });
  pending = pending.then(() => writeFile(file, Buffer.from(f.data, 'base64')));
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
await page.waitForTimeout(300);
const t0 = Date.now();
await page.evaluate(() => { window.__tourDone = false; document.getElementById('play').click(); });
await page.waitForFunction(() => window.__tourDone === true, null, { timeout: 10 * 60 * 1000, polling: 500 });
await page.waitForTimeout(1500);
await cdp.send('Page.stopScreencast');
await pending;
console.log(`擷取 ${frames.length} 格，實際長度 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
await browser.close();
server.close();

// 每格的停留時間＝下一格時間戳記－這一格；最後一格停 1.5 秒
const lines = ['ffconcat version 1.0'];
frames.forEach((f, k) => {
  const next = frames[k + 1];
  const d = next ? Math.max(0.001, next.ts - f.ts) : 1.5;
  lines.push(`file '${f.file}'`, `duration ${d.toFixed(4)}`);
});
lines.push(`file '${frames[frames.length - 1].file}'`);
const list = join(outDir, 'frames.ffconcat');
await writeFile(list, lines.join('\n') + '\n');
const mp4 = join(outDir, 'ride-guide-demo.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
  '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
await rm(frameDir, { recursive: true, force: true });
await rm(list, { force: true });
console.log('寫出', mp4);
