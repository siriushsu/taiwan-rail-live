// 判準來自使用者 08-07 裁示:「站牌時間完全照官方,車依那個時間到站」。
// 量法:官方說「這台車 T 秒後到 X 站」;等到 now == T 那一格,量畫面上那台車離 X 站幾公尺。
// 這是**外部判準**——真值來自官方倒數,不是我們自己的任何一條公式(避免判準與實作同源)。
import { chromium } from 'playwright';
import fs from 'node:fs';
const SEC = Number(process.argv[2] || 180);
const ARMS = [['CTL', process.argv[3]], ['FIX', process.argv[4]]];
const DATA = process.argv[5] || null;
const U = 'https://railisland.tw/';
async function arm(label, htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const b = await chromium.launch(); const p = await b.newPage();
  await p.route(u => { const x = new URL(u); return x.origin + x.pathname === new URL(U).origin + '/'; },
    r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  if (DATA && label === 'FIX') { const body = fs.readFileSync(DATA, 'utf8');
    await p.route(u => new URL(u).pathname.endsWith('/data/trtc.json'),
      r => r.fulfill({ status: 200, contentType: 'application/json', body })); }
  await p.goto(U + '?g=metro', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 120000 });
  await p.evaluate(() => {
    window.__pk = { hits: [], ticks: 0 };
    const hav = (a, b) => { const R = 6371000, r = Math.PI / 180;
      const df = (b.lat - a.lat) * r, dl = (b.lon - a.lon) * r, ph = (a.lat + b.lat) / 2 * r;
      return Math.hypot(df, dl * Math.cos(ph)) * R; };
    window.__pkTimer = setInterval(() => {
      const now = Date.now() / 1000; window.__pk.ticks++;
      for (const v of ((state.trtcOfficialRoster && state.trtcOfficialRoster.vehicles) || [])) {
        const ln = trtcCensusLine(v.line); if (!ln) continue;
        let info = null; try { info = trtcOfficialVehicleInfo(ln, v, now); } catch (e) { continue; }
        const pos = info && info.pos; if (!pos) continue;
        // 目標站與官方到站時刻:一律取顯示物件自己帶的欄位,兩臂用同一組欄位。
        const to = Number.isInteger(Number(pos.coastTo)) ? Number(pos.coastTo) : Number(pos.motionTo);
        const arr = Number.isFinite(Number(pos.coastArrEpoch)) ? Number(pos.coastArrEpoch) : Number(v.arrEpoch);
        const st = ln.stations[to];
        if (!st || !Number.isFinite(arr)) continue;
        if (Math.abs(now - arr) > 1.0) continue;              // 只在「官方說的到站當格」量
        const key = `${v.vehicleId}|${to}|${Math.round(arr)}`;
        if (window.__pk.hits.some(h => h.key === key)) continue;
        window.__pk.hits.push({ key, line: v.line, no: v.officialNo == null ? null : String(v.officialNo),
          src: String(v.source || ''), m: Math.round(hav(pos, st)) });
      }
    }, 1000);
  });
  await p.waitForTimeout(SEC * 1000);
  const r = await p.evaluate(() => { clearInterval(window.__pkTimer); return window.__pk; });
  await b.close(); return { label, ...r };
}
const out = await Promise.all(ARMS.map(([l, h]) => arm(l, h)));
const q = (a, k) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * k))] : NaN;
for (const r of out) {
  const ms = r.hits.map(h => h.m);
  console.log(`\n===== ${r.label}｜${r.ticks} 格｜官方到站時刻取到 ${ms.length} 次 =====`);
  if (!ms.length) { console.log('  (這段時間沒有任何車走到官方說的到站時刻——取樣太短)'); continue; }
  console.log(`  到站當格離該站:  中位 ${q(ms, .5)}m   P90 ${q(ms, .9)}m   最大 ${Math.max(...ms)}m`);
  console.log(`  準時(<50m) ${ms.filter(m => m < 50).length}/${ms.length} = ${Math.round(ms.filter(m => m < 50).length / ms.length * 100)}%`
    + `｜差 >200m ${ms.filter(m => m > 200).length} 次`);
  const worst = r.hits.slice().sort((a, b) => b.m - a.m).slice(0, 4);
  for (const w of worst) console.log(`    最差: ${w.line} no=${w.no} src=${w.src} 差 ${w.m}m`);
}
const [c, f] = out.map(r => r.hits.map(h => h.m));
if (c.length && f.length) {
  const ok = a => Math.round(a.filter(m => m < 50).length / a.length * 100);
  console.log(`\n────── 判定 ──────\n準點率(到站當格 <50m)  CTL ${ok(c)}%  →  FIX ${ok(f)}%   `
    + (ok(f) > ok(c) ? '✅ 新模型更準時' : ok(f) === ok(c) ? '＝ 沒有差別' : '❌ 新模型更不準時'));
}
