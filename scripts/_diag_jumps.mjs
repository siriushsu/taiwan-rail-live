// 使用者:「每十幾秒就有五輛八輛九輛車在跳」。這支量「跳」本身,不量我們的中間量。
// 每秒取樣畫出來的位置;捷運極速約 80km/h=22m/s ⇒ 一秒移動 >40m 物理上不可能,就是跳。
// 同時記錄那一台當下的 observedEpoch 有沒有前進(官方那一輪剛給新資料)與 source,
// 用來分辨「官方新資料造成的重定位」還是「我們自己的顯示層造成的」。
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
  window.__jp = { ticks: 0, jumps: [], perTick: [], veh: [] };
  const hav = (a, b) => { const R = 6371000, r = Math.PI / 180;
    const df = (b.lat - a.lat) * r, dl = (b.lon - a.lon) * r, ph = (a.lat + b.lat) / 2 * r;
    return Math.hypot(df, dl * Math.cos(ph)) * R; };
  let prev = new Map(), t0 = 0;
  const snap = () => {
    const now = Date.now() / 1000, cur = new Map();
    for (const v of ((state.trtcOfficialRoster && state.trtcOfficialRoster.vehicles) || [])) {
      const ln = trtcCensusLine(v.line); if (!ln) continue;
      let pos = null, raw = null;
      try { pos = trtcOfficialDisplayPosition(ln, v, now); } catch (e) { }
      try { raw = trtcOfficialVehiclePosition(ln, v, now); } catch (e) { }
      if (!pos || !Number.isFinite(pos.lat)) continue;
      cur.set(String(v.vehicleId), { lat: pos.lat, lon: pos.lon, line: v.line,
        obs: Number(v.observedEpoch), src: String(v.source || ''), from: v.from, to: v.to,
        rawLat: raw && raw.lat, rawLon: raw && raw.lon });
    }
    window.__jp.ticks++; window.__jp.veh.push(cur.size);
    const dt = t0 ? now - t0 : 0; t0 = now;
    let n = 0;
    if (dt > 0.3 && dt < 3) {
      for (const [id, c] of cur) { const p0 = prev.get(id); if (!p0) continue;
        const d = hav(p0, c) / dt; // 公尺/秒
        if (d <= 40) continue;
        n++;
        if (window.__jp.jumps.length < 400) window.__jp.jumps.push({ id, line: c.line, mps: Math.round(d),
          m: Math.round(hav(p0, c)), newObs: c.obs !== p0.obs, src: c.src,
          seg: `${p0.from}->${p0.to} ⇒ ${c.from}->${c.to}`,
          lagBefore: (p0.rawLat != null) ? Math.round(hav(p0, { lat: p0.rawLat, lon: p0.rawLon })) : null });
      }
    }
    window.__jp.perTick.push(n);
    prev = cur;
  };
  snap(); window.__jpTimer = setInterval(snap, 1000);
});
await p.waitForTimeout(SEC * 1000);
const r = await p.evaluate(() => { clearInterval(window.__jpTimer); return window.__jp; });
await b.close();
const J = r.jumps, withNew = J.filter(x => x.newObs).length;
const ms = J.map(x => x.m).sort((a, c) => a - c);
const busy = r.perTick.map((n, i) => [i, n]).filter(([, n]) => n >= 3);
console.log(`取樣 ${r.ticks} 秒｜平均 ${Math.round(r.veh.reduce((a, c) => a + c, 0) / r.veh.length)} 台`);
console.log(`跳(>40 m/s) 共 ${J.length} 次｜其中 ${withNew} 次(${Math.round(withNew / Math.max(1, J.length) * 100)}%) 發生在官方剛給新資料那一格`);
console.log(`跳幅 中位 ${ms[Math.floor(ms.length / 2)] || 0}m  P90 ${ms[Math.floor(ms.length * .9)] || 0}m  最大 ${ms[ms.length - 1] || 0}m`);
console.log(`同一秒內 ≥3 台一起跳的秒數:${busy.length} 次｜最多一次 ${Math.max(0, ...r.perTick)} 台`);
const byLine = {}; for (const x of J) byLine[x.line] = (byLine[x.line] || 0) + 1;
console.log(`分線:${JSON.stringify(byLine)}`);
const bySrc = {}; for (const x of J) bySrc[x.src] = (bySrc[x.src] || 0) + 1;
console.log(`分來源:${JSON.stringify(bySrc)}`);
console.log('前 6 例:');
for (const x of J.slice(0, 6)) console.log(`   ${x.line} ${x.m}m (${x.mps} m/s) 官方新資料=${x.newObs} src=${x.src} 區間 ${x.seg} 跳前落後官方 ${x.lagBefore}m`);
