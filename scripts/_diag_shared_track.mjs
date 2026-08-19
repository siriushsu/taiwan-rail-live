// 使用者回報的永安市場在中和新蘆線共線段(南勢角↔大橋頭),而我們把它拆成 O_LUZHOU 與
// O_XINZHUANG 兩條線 ⇒ 只在同一條線內配對的判準看不到「兩條線各畫一台疊在同一段軌道上」。
// 這支跨這兩條線配對。
import { chromium } from 'playwright';
import fs from 'node:fs';
const SEC = Number(process.argv[2] || 120);
const html = fs.readFileSync(process.argv[3] || 'index.html', 'utf8');
const b = await chromium.launch(); const p = await b.newPage();
const U = 'https://railisland.tw/';
await p.route(u => { const x = new URL(u); return x.origin + x.pathname === new URL(U).origin + '/'; },
  r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
if (process.argv[4]) { const body = fs.readFileSync(process.argv[4], 'utf8');
  await p.route(u => new URL(u).pathname.endsWith('/data/trtc.json'),
    r => r.fulfill({ status: 200, contentType: 'application/json', body })); }
await p.goto(U + '?g=metro', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 120000 });
await p.evaluate(() => {
  window.__st = { ticks: 0, pairs: new Map() };
  const hav = (a, b) => { const R = 6371000, r = Math.PI / 180;
    const df = (b.lat - a.lat) * r, dl = (b.lon - a.lon) * r, ph = (a.lat + b.lat) / 2 * r;
    return Math.hypot(df, dl * Math.cos(ph)) * R; };
  const snap = () => {
    const P = [];
    for (const v of ((state.trtcOfficialRoster && state.trtcOfficialRoster.vehicles) || [])) {
      const ln = trtcCensusLine(v.line); if (!ln) continue;
      let info = null; try { info = trtcOfficialVehicleInfo(ln, v, Date.now() / 1000); } catch (e) { }
      const pos = info && info.pos; if (!pos || !Number.isFinite(pos.lat)) continue;
      const names = trtcCensusNames(ln) || [];
      P.push({ id: String(v.vehicleId), line: v.line, dir: v.dir, lat: pos.lat, lon: pos.lon,
        no: v.officialNo, at: names[v.to] || ('#' + v.to), from: names[v.from] || ('#' + v.from),
        src: String(v.source || ''), atSt: !!pos.atStation });
    }
    window.__st.ticks++;
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const A = P[i], C = P[j];
      if (String(A.dir) !== String(C.dir)) continue;
      const same = A.line === C.line;
      const oPair = (A.line === 'O_LUZHOU' && C.line === 'O_XINZHUANG') ||
        (A.line === 'O_XINZHUANG' && C.line === 'O_LUZHOU');
      if (!same && !oPair) continue;
      const d = hav(A, C); if (d > 300) continue;
      const k = [A.id, C.id].sort().join('~');
      const cur = window.__st.pairs.get(k);
      window.__st.pairs.set(k, { n: (cur ? cur.n : 0) + 1, min: Math.min(cur ? cur.min : 1e9, Math.round(d)),
        kind: same ? '同線' : '共線段跨線', a: A, c: C });
    }
  };
  snap(); window.__stTimer = setInterval(snap, 3000);
});
await p.waitForTimeout(SEC * 1000);
const r = await p.evaluate(() => { clearInterval(window.__stTimer); return { ticks: window.__st.ticks, pairs: [...window.__st.pairs] }; });
await b.close();
const P = r.pairs.sort((x, y) => x[1].min - y[1].min);
console.log(`${r.ticks} 格｜<300m 的配對 ${P.length} 對（含跨線共線段）`);
for (const [, v] of P) {
  console.log(`\n▼ ${v.kind}  最近 ${v.min}m  持續 ${v.n * 3}s`);
  for (const s of [v.a, v.c]) console.log(`   ${s.line} 方向${s.dir} no=${s.no} ${s.from}→${s.at} src=${s.src}${s.atSt ? ' 停在站上' : ''}`);
}
