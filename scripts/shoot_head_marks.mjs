#!/usr/bin/env node
// 頭牌接觸圖：37 款車頭各拍一張拼成一張，給人看牌掛得對不對。車模或 rail-3d/head-marks.js 改了就重跑。
// 用法：node scripts/shoot_head_marks.mjs [輸出檔] [車款…]，預設 output/head-marks/sheet.png、全部車款；指定車款時每格拍大一點。
// 掛錯的車款到 build_head_marks.mjs 的 BAND 指定高度重掃。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'output/head-marks/sheet.png'));
const MIME = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const PAGE = '<!doctype html><canvas id="c" style="position:fixed;inset:0;width:100%;height:100%"></canvas><script src="/my-train-plan.js"></script><script src="/my-train-marks.js"></script>';
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname === '/') { res.setHeader('content-type', 'text/html'); return res.end(PAGE); }
  const fp = path.join(ROOT, decodeURIComponent(pathname));
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 }, reducedMotion: 'reduce' });
page.on('pageerror', e => console.error('頁面錯誤', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
const png = await page.evaluate(async only => {
  const canvas = document.getElementById('c'), wait = ms => new Promise(ok => setTimeout(ok, ms));
  const { createRoundhouseStage } = await import('/rail-3d/roundhouse-stage.js');
  const stage = await createRoundhouseStage({ canvas, lite: false, label: s => s, reduced: true, markImage: id => MyTrainMarks.canvas(id, 512, '首航'), layout: () => ({ top: 0, bottom: 0, side: 0, under: 0, narrow: false }) });
  const ids = only.length ? only : Object.keys(MyTrainPlan.MODELS), W = only.length ? 600 : 300, H = only.length ? 376 : 188, cols = only.length ? 3 : 6;
  const sheet = document.createElement('canvas'); sheet.width = W * cols; sheet.height = H * Math.ceil(ids.length / cols);
  const g = sheet.getContext('2d'); g.font = '700 15px sans-serif';
  for (let a = 0; a < ids.length; a += 6) {
    const batch = ids.slice(a, a + 6);
    await stage.setFleet(Array.from({ length: 6 }, (_, i) => (batch[i] ? { model: batch[i], state: 'home', mark: 'maiden' } : { model: null, state: 'empty', mark: null })));
    for (let i = 0; i < batch.length; i++) {
      stage.select(i); await wait(350);
      stage.look(true); await wait(350);
      stage.frame();
      const n = a + i, x = n % cols * W, y = Math.floor(n / cols) * H;
      g.drawImage(canvas, x, y, W, H);
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x, y, g.measureText(batch[i]).width + 12, 22);
      g.fillStyle = '#fff'; g.fillText(batch[i], x + 6, y + 16);
      stage.back(); await wait(300);
    }
  }
  return sheet.toDataURL('image/png').split(',')[1];
}, process.argv.slice(3));
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.from(png, 'base64'));
console.log(OUT);
await browser.close();
server.close();
