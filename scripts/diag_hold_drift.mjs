// 被 hold 的車會不會「照舊時刻表繼續跑」而跑到官方位置的前面？
// 判準用外部獨立來源：官方 stn（車站代碼）vs 我們畫出來的區間站名——不看管線中間量。
// 用法：node scripts/diag_hold_drift.mjs "402,412,432" [輪數] [間隔秒] [url]
import { chromium } from 'playwright';
const WANT = (process.argv[2] || '402,412,432').split(',').map(s => s.trim());
const ROUNDS = Number(process.argv[3] || 12), GAP = Number(process.argv[4] || 15);
const URL = process.argv[5] || 'http://127.0.0.1:5399/?census=1';
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 90000 });
await p.evaluate(() => {
  const g = (typeof GROUPS !== 'undefined' ? GROUPS : []).find(x => (x.members || []).includes('mrt'));
  if (g) selectGroup(g);
});
await p.waitForTimeout(2500);
await p.evaluate(() => window.__map.fitBounds([[24.90, 121.30], [25.25, 121.75]], { animate: false }));
await p.waitForTimeout(4000);

for (let r = 0; r < ROUNDS; r++) {
  if (r) await new Promise(s => setTimeout(s, GAP * 1000));
  const out = await p.evaluate(async want => {
    const live = await (await fetch('/api/trtc-live', { cache: 'no-store' })).json();
    const now = Date.now() / 1000;
    const lines = (state.lines || []).concat(state.decoLines || []);
    const R = (state.trtcOfficialRoster || {}).vehicles || [];
    const rows = [];
    for (const no of want) {
      const t = (live.trains || []).find(x => String(x.no) === no) || null;
      const v = R.find(x => String(x.vehicleId).split(':').pop() === no) || null;
      const ln = v ? lines.find(l => l.id === v.line) : null;
      const pos = ln ? trtcOfficialVehiclePosition(ln, v, now) : null;
      rows.push({
        no,
        off: t ? { stn: t.stn, dir: t.dir, dest: t.dest, age: Math.round(now - t.at), nPath: (t.path || []).length } : null,
        mine: v ? { line: v.line, src: v.source, hold: v.holdReason || null,
          seg: (ln && ln.stations[v.from] ? ln.stations[v.from].name : v.from) + '>' +
               (ln && ln.stations[v.to] ? ln.stations[v.to].name : v.to),
          dArr: Math.round((v.arrEpoch || 0) - now), nTl: (v.timeline || []).length,
          frac: pos && pos.fraction != null ? +pos.fraction.toFixed(2) : null, drawn: !!pos } : null,
      });
    }
    const held = R.filter(x => x.source === 'census-hold');
    return { rows, n: R.length, feed: (state.trtcOfficialRoster || {}).feedMode,
      heldN: held.length, heldNos: held.map(x => String(x.vehicleId).split(':').pop() + (x.holdReason ? '/' + x.holdReason : '')) };
  }, WANT);
  const ts = new Date().toTimeString().slice(0, 8);
  console.log(`[${ts}] 名冊 ${out.n}（${out.feed}）hold ${out.heldN}：${out.heldNos.join(' ') || '—'}`);
  for (const x of out.rows) console.log('   ' + x.no + ' 官方=' + (x.off ? JSON.stringify(x.off) : '不在清單') +
    ' ｜我們=' + (x.mine ? JSON.stringify(x.mine) : '沒有這台'));
}
await b.close();
