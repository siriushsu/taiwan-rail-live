#!/usr/bin/env node
// 不看身分,只問「畫出來的位置」與「官方資料算出來的位置」對不對得上(使用者裁示:
// 車號認不出來就算了,但有資訊位置就一定要對)。
// 逐線逐方向做貪婪最近配對:每個官方位置找最近的畫面位置,配完看殘差。
import { chromium } from 'playwright';
import fs from 'node:fs';
// --local <index.html>：主文件改餵本機這一份,其餘請求(含 api/)照樣走同一個網域的正式站。
// 這樣「同一份即時資料、只換程式碼」,不必起 server,也不會踩工作樹起埠不回應的坑。
const li = process.argv.indexOf('--local');
const LOCAL = li > 0 ? process.argv[li + 1] : null;
const URL = process.argv[2] || 'https://railisland.tw/';
const ROUNDS = Number(process.argv[3] || 4), GAP = Number(process.argv[4] || 20);
const TOL_M = 150;   // 容忍值:官方每 15 秒更新一次,一輪內車走約 150m
const b = await chromium.launch(); const p = await b.newPage();
p.on('pageerror', e => console.log('  ⚠️ pageerror:', String(e).slice(0, 140)));
if (LOCAL) {
  const html = fs.readFileSync(LOCAL, 'utf8');
  await p.route(u => { const x = new globalThis.URL(u); return x.origin + x.pathname === new globalThis.URL(URL).origin + '/'; },
    r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  console.log(`（主文件改用本機 ${LOCAL}，API 仍走 ${URL}）`);
}
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 90000 });
await p.evaluate(() => { const g = GROUPS.find(x => (x.members || []).includes('mrt')); if (g) selectGroup(g); });
await p.waitForTimeout(2500);
await p.evaluate(() => window.__map.fitBounds([[24.90, 121.30], [25.25, 121.75]], { animate: false }));
await p.waitForTimeout(2500);
let totalOff = 0, totalMatched = 0;
for (let r = 0; r < ROUNDS; r++) {
  if (r) await p.waitForTimeout(GAP * 1000);
  const out = await p.evaluate(({ tol }) => {
    const now = Date.now() / 1000, per = [];
    const R = 6371000, rad = x => x * Math.PI / 180;
    const dist = (a, o) => { const dLat = rad(o.lat - a.lat), dLon = rad(o.lon - a.lon);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(o.lat)) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); };
    for (const ln of (state.lines || []).concat(state.decoLines || [])) {
      const vs = ((state.trtcOfficialRoster || {}).vehicles || []).filter(v => String(v.line) === ln.id);
      if (!vs.length) continue;
      for (const dir of [1, 2]) {
        const official = [], drawn = [];
        for (const v of vs.filter(x => Number(x.dir) === dir)) {
          const raw = trtcOfficialVehiclePosition(ln, v, now);
          if (raw && Number.isFinite(raw.lat)) official.push({ lat: raw.lat, lon: raw.lon });
          const d = _trtcOfficialDisplay.get(`${ln.id}|${v.vehicleId}`);
          if (d && d.pos && Number.isFinite(d.pos.lat)) drawn.push({ lat: d.pos.lat, lon: d.pos.lon });
        }
        if (!official.length) continue;
        const used = new Set(); let matched = 0; const misses = [];
        for (const o of official) {
          let bi = -1, bd = Infinity;
          drawn.forEach((x, i) => { if (used.has(i)) return; const dd = dist(o, x); if (dd < bd) { bd = dd; bi = i; } });
          if (bi >= 0 && bd <= tol) { used.add(bi); matched++; } else misses.push(Math.round(bd));
        }
        per.push({ line: ln.id, dir, off: official.length, drawn: drawn.length, matched,
          misses: misses.sort((a, c) => c - a).slice(0, 3) });
      }
    }
    return per;
  }, { tol: TOL_M });
  const off = out.reduce((s, x) => s + x.off, 0), mat = out.reduce((s, x) => s + x.matched, 0);
  totalOff += off; totalMatched += mat;
  const bad = out.filter(x => x.matched < x.off).sort((a, c) => (c.off - c.matched) - (a.off - a.matched));
  console.log(`[${new Date().toTimeString().slice(0,8)}] 官方 ${off} 個位置，畫面對得上 ${mat} 個（${(mat/off*100).toFixed(0)}%，容忍 ${TOL_M}m）`);
  for (const x of bad.slice(0, 6)) console.log(`   ${x.line}|dir${x.dir} 官方 ${x.off} 台、畫面 ${x.drawn} 台、對上 ${x.matched}｜落單的最近距離 ${x.misses.join('、')}m`);
}
if (!totalOff) { console.log('❌ 分母為 0：這幾輪畫面上沒有任何官方名冊車，什麼都沒驗到'); await b.close(); process.exit(2); }
console.log(`\n合計 ${totalMatched}/${totalOff}（${(totalMatched/totalOff*100).toFixed(1)}%）官方位置在畫面上找得到對應的車（容忍 ${TOL_M}m）`);
await b.close();
process.exit(totalMatched === totalOff ? 0 : 1);
