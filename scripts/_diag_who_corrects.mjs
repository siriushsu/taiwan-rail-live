// 使用者:「每次都在校正的是什麼車?」——直接列名單。
// 顯示層 _trtcOfficialDisplay 每台車存了 correcting 旗標(落後官方 >=150m 時為 true),
// 每秒掃一次,join 回名冊拿身分,統計「誰一直在被校正」。
import { chromium } from 'playwright';
import fs from 'node:fs';
const SEC = Number(process.argv[2] || 150);
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
  window.__wc = { ticks: 0, hits: new Map(), seen: new Map() };
  const hav = (a, b) => { const R = 6371000, r = Math.PI / 180;
    const df = (b.lat - a.lat) * r, dl = (b.lon - a.lon) * r, ph = (a.lat + b.lat) / 2 * r;
    return Math.hypot(df, dl * Math.cos(ph)) * R; };
  const snap = () => {
    const now = Date.now() / 1000;
    const byId = new Map();
    for (const v of ((state.trtcOfficialRoster && state.trtcOfficialRoster.vehicles) || []))
      byId.set(String(v.vehicleId), v);
    window.__wc.ticks++;
    for (const [key, d] of _trtcOfficialDisplay) {
      // key 可能帶前綴,取結尾與 vehicleId 對得上的那筆
      let v = byId.get(String(key));
      if (!v) for (const [id, vv] of byId) if (String(key).includes(id)) { v = vv; break; }
      const id = v ? String(v.vehicleId) : String(key);
      const s = window.__wc.seen.get(id) || { n: 0 };
      s.n++; window.__wc.seen.set(id, s);
      if (!d || !d.correcting) continue;
      const ln = v ? trtcCensusLine(v.line) : null;
      let raw = null; if (ln && v) { try { raw = trtcOfficialVehiclePosition(ln, v, now); } catch (e) { } }
      const lag = (raw && d.pos && Number.isFinite(raw.lat)) ? Math.round(hav(d.pos, raw)) : null;
      const h = window.__wc.hits.get(id) || { n: 0, maxLag: 0, line: v ? v.line : '?',
        src: v ? String(v.source || '') : '?', no: v ? v.officialNo : null,
        coasted: 0, carried: 0, segs: new Set() };
      h.n++; if (lag != null) h.maxLag = Math.max(h.maxLag, lag);
      if (v) { if (v.coasted) h.coasted++; if (v.carried) h.carried++; h.segs.add(`${v.from}->${v.to}`); }
      window.__wc.hits.set(id, h);
    }
  };
  snap(); window.__wcTimer = setInterval(snap, 1000);
});
await p.waitForTimeout(SEC * 1000);
const r = await p.evaluate(() => { clearInterval(window.__wcTimer);
  return { ticks: window.__wc.ticks, total: window.__wc.seen.size,
    hits: [...window.__wc.hits].map(([id, h]) => [id, { ...h, segs: [...h.segs].slice(0, 4) }]) }; });
await b.close();
const H = r.hits.sort((a, b2) => b2[1].n - a[1].n);
console.log(`取樣 ${r.ticks} 秒｜出現過的車 ${r.total} 台｜曾處於校正狀態的 ${H.length} 台 (${Math.round(H.length / Math.max(1, r.total) * 100)}%)`);
const byLine = {}, bySrc = {}; let coast = 0, carry = 0, noNo = 0;
for (const [, h] of H) { byLine[h.line] = (byLine[h.line] || 0) + 1; bySrc[h.src] = (bySrc[h.src] || 0) + 1;
  if (h.coasted) coast++; if (h.carried) carry++; if (h.no == null) noNo++; }
console.log(`分線 ${JSON.stringify(byLine)}`);
console.log(`分來源 ${JSON.stringify(bySrc)}｜續推中 ${coast} 台｜carried ${carry} 台｜沒有官方車號 ${noNo} 台`);
console.log(`\n被校正最久的前 12 台:`);
for (const [id, h] of H.slice(0, 12))
  console.log(`  ${String(h.n).padStart(3)} 秒  ${h.line.padEnd(12)} no=${String(h.no).padEnd(5)} src=${h.src.padEnd(12)} 最大落後 ${String(h.maxLag).padStart(5)}m  區間 ${h.segs.join(',')}`);
