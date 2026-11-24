// 場地面重疊修正的實拍：同一個地點轉一圈拍（每個方位角一張），改前改後兩個本機站各拍一輪，拼成並排圖。無視窗 Chrome。
//   node scripts/shot_landscape_field_views.mjs <輸出資料夾> <站 1 名=網址> [<站 2 名=網址>] -- <lon,lat[,zoom,pitch]>…
//   例：node scripts/shot_landscape_field_views.mjs build/x 改前=http://127.0.0.1:8292 改後=http://127.0.0.1:8291 -- 121.39144,24.970733
// 每個地點拍 6 個方位角（0、60、120、180、240、300°），輸出 <地點>-<站>-<方位>.jpg 與 <地點>-並排.jpg（上排改前、下排改後）。
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const args = process.argv.slice(2), cut = args.indexOf('--'), OUT = path.resolve(args[0]); mkdirSync(OUT, { recursive: true });
const sites = args.slice(1, cut).map(s => { const i = s.indexOf('='); return { name: s.slice(0, i), url: s.slice(i + 1) }; });
const spots = args.slice(cut + 1).map(s => { const [lon, lat, zoom = 18.4, pitch = 62] = s.split(',').map(Number); return { lon, lat, zoom, pitch }; });
const BEARINGS = (process.env.BEARINGS || '0,60,120,180,240,300').split(',').map(Number), W = 900, H = 640;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
try {
  const shots = {};
  for (const site of sites) {
    const page = await browser.newPage({ viewport: { width: W, height: H } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('trainmap-howto-seen', '1'));
    const u = new URL(site.url); u.search = new URLSearchParams({ map: 'landscape', landscape: 'new', opening: '0', g: 'all', 'ls.auto': '0', t: '15:00' });
    await page.goto(u.href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.railIslandLandscapeWeb?.revealed, null, { timeout: 120000 });
    for (const [k, s] of spots.entries()) for (const b of BEARINGS) {
      await page.evaluate(([s, b]) => M.raw.jumpTo({ center: [s.lon, s.lat], zoom: s.zoom, pitch: s.pitch, bearing: b }), [s, b]);
      await page.waitForTimeout(800);
      await page.waitForFunction(() => window.railIslandLandscapeWeb.state.pending === 0, null, { timeout: 90000 }).catch(() => console.log('還在載', site.name, k, b));
      await page.waitForTimeout(1500);
      const f = path.join(OUT, `p${k}-${site.name}-${b}.jpg`); await page.screenshot({ path: f, type: 'jpeg', quality: 88 });
      (shots[k] ??= {})[site.name] = [...(shots[k][site.name] || []), f];
    }
    console.log(site.name, '頁面錯誤', errors.length, errors.slice(0, 3));
    await page.close();
  }
  // 並排：每個地點一張，每個站一排、每個方位一格（縮半）
  for (const [k, by] of Object.entries(shots)) {
    const cw = W / 2, ch = H / 2, rows = sites.length, cols = BEARINGS.length, comp = [];
    for (const [r, site] of sites.entries()) for (const [c, f] of by[site.name].entries()) comp.push({ input: await sharp(f).resize(cw, ch).toBuffer(), left: c * cw, top: r * ch });
    await sharp({ create: { width: cols * cw, height: rows * ch, channels: 3, background: '#000' } }).composite(comp).jpeg({ quality: 86 }).toFile(path.join(OUT, `p${k}-並排.jpg`));
  }
  console.log('寫出', OUT);
} finally { await browser.close(); }
