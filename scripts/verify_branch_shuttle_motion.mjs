#!/usr/bin/env node
// 支線區間車會不會動（2026-08-17 使用者回報「小碧潭那邊就是有著沒在動停站上的車」）。
//
// 根因：小碧潭（七張↔小碧潭）與新北投（北投↔新北投）只有兩站，於是看板每一列算出來的
// 「前一站」都掉出線外（北投 0→−1、小碧潭 1→2）⇒ 帳本一律判成起點列 run=0；推進成
// from≠to 之後 run 仍是 0，而繪製端對 run<=0 是整台回 null ⇒ 車一發車就消失，
// 畫面上永遠只剩下一台停在起點的，看起來就是「一直停在站上不會動」。
//
// 這支不等真實班次（支線每 3–10 分鐘才一班），直接對 trtcOfficialVehiclePosition 餵一台
// 合成的「已發車但 run=0」的車，判它有沒有沿線前進。控制組把補值拿掉，必須退回 null——
// 沒有控制組就只證明「現在會動」，證不出「這條判準看得見那個缺陷」。
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ANCHOR = 'const segRun = run > 0 ? run : (() => {';
const MUTATED = INDEX.replace(ANCHOR, 'const segRun = run > 0 ? run : 0; const _dead = (() => {');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

// boot 需要真的看板資料才會 ready（全部回 {} 會讓它靜默卡住，逾時訊息本身零資訊）
let livePayload = '{}';
try { livePayload = await (await fetch('https://railisland.tw/api/trtc-live',
  { headers: { 'cache-control': 'no-cache' } })).text(); }
catch (e) { console.log(`❌ 取不到 trtc-live：${e.message}`); process.exit(2); }

function serve(html) {
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.setHeader('content-type', MIME['.html']); return res.end(html);
    }
    if (url.pathname === '/api/trtc-live') {
      res.setHeader('content-type', 'application/json'); return res.end(livePayload);
    }
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('content-type', 'application/json');
      const f = { '/api/thsr-schedule': 'data/thsr_schedule_dense.json' }[url.pathname];
      if (f && fs.existsSync(path.join(ROOT, f))) return res.end(fs.readFileSync(path.join(ROOT, f)));
      return res.end('{}');
    }
    const file = path.join(ROOT, decodeURIComponent(url.pathname).replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.statusCode = 404; return res.end('nope');
    }
    res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
}

let failures = 0, assertions = 0;
const check = (pass, label, detail = '') => {
  assertions++; if (!pass) failures++;
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
};

// 頁面裡量：對兩條支線各餵一台「已發車、run=0」的車，取三個時刻的位置
const PROBE = () => {
  const out = {};
  const lines = (state.lines || []).concat(state.decoLines || []);
  for (const id of ['G_XBT', 'R_XBT']) {
    const ln = lines.find(l => l.id === id);
    if (!ln) { out[id] = { error: '線不在畫面上' }; continue; }
    const n = ln.stations.length;
    const from = n - 1, to = n - 2;          // 從線末往回開（＝小碧潭→七張、新北投→北投）
    const t0 = 1800000000;                   // 固定時鐘，與真實時間無關
    const arr = t0 + 120;                    // 兩分鐘後到站
    const v = { vehicleId: 'probe:' + id, line: id, dir: 1, from, to, dest: to,
      run: 0, arrEpoch: arr, terminal: true, timeline: [] };
    const at = s => {
      const p = trtcOfficialVehiclePosition(ln, v, t0 + s);
      return p ? { lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), fraction: p.fraction } : null;
    };
    out[id] = { stations: n, segRun: (ln.segs && ln.segs[Math.min(from, to)] || {}).run ?? null,
      p10: at(10), p60: at(60), p110: at(110) };
  }
  return out;
};

for (const [name, html, wantMotion] of [['修正版', INDEX, true], ['控制組（拿掉補值）', MUTATED, false]]) {
  if (html === INDEX && !wantMotion) { check(false, `${name}：突變沒套上（anchor 找不到）`); continue; }
  const server = serve(html);
  await new Promise((r, j) => { server.once('error', j); server.listen(0, '127.0.0.1', r); });
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  await ctx.addInitScript(() => { localStorage.setItem('trainmap-howto-seen', '1'); });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 90000 });
  } catch (e) {
    console.log(`❌ ${name}：頁面沒 ready`, errs.slice(0, 3));
    await browser.close(); server.close(); failures++; assertions++; continue;
  }
  await page.evaluate(() => {
    const g = (typeof GROUPS !== 'undefined' ? GROUPS : []).find(x => (x.members || []).includes('mrt'));
    if (g) selectGroup(g);
  });
  await page.waitForTimeout(2000);
  const r = await page.evaluate(PROBE);
  await browser.close(); server.close();

  console.log(`\n【${name}】`);
  for (const id of ['G_XBT', 'R_XBT']) {
    const d = r[id];
    if (d.error) { check(false, `${id} 探針跑得起來`, d.error); continue; }
    console.log(`  ${id}：${d.stations} 站、區間 ${d.segRun}s｜` +
      `10s=${d.p10 ? d.p10.fraction.toFixed(3) : 'null'} 60s=${d.p60 ? d.p60.fraction.toFixed(3) : 'null'} 110s=${d.p110 ? d.p110.fraction.toFixed(3) : 'null'}`);
    if (wantMotion) {
      const ok = d.p10 && d.p60 && d.p110 &&
        d.p60.fraction > d.p10.fraction && d.p110.fraction > d.p60.fraction &&
        (d.p60.lat !== d.p10.lat || d.p60.lon !== d.p10.lon);
      check(ok, `${id} 已發車的車沿線前進（run=0 時用線形區間秒補回來）`,
        ok ? `進度 ${d.p10.fraction.toFixed(2)}→${d.p110.fraction.toFixed(2)}，座標有變` : JSON.stringify(d));
    } else {
      check(d.p10 === null && d.p60 === null, `${id} 拿掉補值後整台回 null（＝這條判準看得見那個缺陷）`,
        d.p10 === null ? '' : `仍回得到位置 ${JSON.stringify(d.p10)}`);
    }
  }
  if (errs.length) console.log('  pageerror:', errs.slice(0, 2));
}

console.log(`\n斷言 ${assertions} 條，失敗 ${failures} 條`);
if (assertions === 0) { console.log('❌ 零斷言＝沒跑起來'); process.exit(2); }
process.exit(failures ? 1 : 0);
