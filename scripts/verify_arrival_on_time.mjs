#!/usr/bin/env node
// 「車依站牌時間到站」的端到端驗證（使用者定的準確判準：站牌時間照官方,車依那個時間到站）。
//
// 作法:t 時刻記下某站的官方倒數 c 秒 ⇒ 預測 t+c 時該站會有車;等到 t+c 再看畫面上
// 那一站有沒有車。驗證時刻不重算任何位置,只問「車在不在那裡」,所以不吃同源問題。
//
// 用法: node scripts/verify_arrival_on_time.mjs [url] [取樣數]
import { chromium } from 'playwright';
const URL = process.argv[2] || 'https://railisland.tw/';
const WANT = Number(process.argv[3] || 8);
const NEAR_M = 250;          // 判「在這一站」的半徑。站距最短約 600m,250m 不會跨到鄰站
const WIN_LO = 45, WIN_HI = 200;  // 只取這個倒數區間:太短來不及佈署觀測,太長期間會換班次

const b = await chromium.launch(); const p = await b.newPage();
p.on('pageerror', e => console.log('  ⚠️ pageerror:', String(e).slice(0, 160)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 90000 });
await p.evaluate(() => { const g = GROUPS.find(x => (x.members || []).includes('mrt')); if (g) selectGroup(g); });
await p.waitForTimeout(2500);
// 🔴 視野要框住整個北捷:_trtcOfficialDisplay 只留「這一格有畫出來」的車,
// 預設視野若沒涵蓋路網,它會是空的 ⇒ 分母 0,長得跟「此刻沒車」一模一樣。
await p.evaluate(() => map.fitBounds([[24.90, 121.30], [25.25, 121.75]], { animate: false }));
await p.waitForTimeout(3000);

// 站牌倒數的唯一來源:名冊車的 timeline(產品就是拿它顯示站牌秒數的官方值)
const pick = () => p.evaluate(({ lo, hi }) => {
  const now = Date.now() / 1000, out = []; let skippedTerminal = 0;
  for (const [key, v] of _trtcOfficialDisplay) {
    const lnId = key.split('|')[0], vid = key.slice(lnId.length + 1);
    const veh = ((state.trtcOfficialRoster || {}).vehicles || []).find(x => String(x.vehicleId) === vid);
    if (!veh || !Array.isArray(veh.timeline)) continue;
    for (const item of veh.timeline) {
      const eta = Number(item.arrEpoch) - now;
      if (!(eta >= lo && eta <= hi)) continue;
      // 終點站到站後車依契約就被拿掉(使用者裁示「到終點站車子就拿掉」),
      // 那一刻本來就不該有車,拿它當「沒準時」是判準錯不是產品錯。
      if (item.terminal) { skippedTerminal++; continue; }
      out.push({ key, lnId, vid, stationIdx: Number(item.to), etaSec: Math.round(eta),
        dueEpoch: Number(item.arrEpoch) });
      break;
    }
  }
  return { out, skippedTerminal };
}, { lo: WIN_LO, hi: WIN_HI });

const picked = await pick();
let cands = picked.out;
// 每條線最多取 2 筆,避免整批集中在同一條線
const byLine = new Map();
cands = cands.sort((a, c) => a.etaSec - c.etaSec).filter(x => {
  const n = byLine.get(x.lnId) || 0; if (n >= 2) return false;
  byLine.set(x.lnId, n + 1); return true;
}).slice(0, WANT);

if (!cands.length) {
  const why = await p.evaluate(() => {
    const now = Date.now() / 1000;
    const vs = ((state.trtcOfficialRoster || {}).vehicles || []);
    const etas = vs.flatMap(v => (v.timeline || []).map(t => Math.round(Number(t.arrEpoch) - now)))
      .filter(Number.isFinite).sort((a, c) => a - c);
    return { display: _trtcOfficialDisplay.size, vehicles: vs.length, withTimeline: vs.filter(v => (v.timeline || []).length).length,
      etaMin: etas[0], etaMax: etas[etas.length - 1], etaN: etas.length };
  });
  console.log(`❌ 分母為 0，什麼都沒驗到｜畫面上名冊車 ${why.display} 台、名冊 ${why.vehicles} 台` +
    `（有 timeline ${why.withTimeline} 台、共 ${why.etaN} 筆到站時刻，倒數範圍 ${why.etaMin}~${why.etaMax}s）` +
    `｜略過終點站 ${picked.skippedTerminal} 筆`);
  await b.close(); process.exit(2);
}
console.log(`取樣 ${cands.length} 筆（倒數 ${WIN_LO}-${WIN_HI} 秒）：` +
  cands.map(c => `${c.lnId}#${c.vid.slice(-8)}→站${c.stationIdx} ${c.etaSec}s`).join('、'));

const results = [];
for (const c of cands.sort((a, x) => a.dueEpoch - x.dueEpoch)) {
  const waitMs = Math.max(0, c.dueEpoch * 1000 - Date.now());
  if (waitMs > 0) await p.waitForTimeout(waitMs);
  const r = await p.evaluate(({ lnId, stationIdx, nearM, vid }) => {
    const ln = (state.lines || []).concat(state.decoLines || []).find(l => l.id === lnId);
    const st = ln && ln.stations && ln.stations[stationIdx];
    if (!st) return { err: '找不到該站' };
    const R = 6371000, rad = x => x * Math.PI / 180;
    const dist = (a, o) => { const dLat = rad(o.lat - a.lat), dLon = rad(o.lon - a.lon);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(o.lat)) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); };
    const vehOf = id => ((state.trtcOfficialRoster || {}).vehicles || []).find(x => String(x.vehicleId) === id);
    const want = vehOf(vid); const wantDir = want && want.dir;
    let self = null, best = null;
    for (const [key, v] of _trtcOfficialDisplay) {
      if (key.split('|')[0] !== lnId || !v.pos) continue;
      const id = key.slice(lnId.length + 1);
      const d = dist(st, v.pos);
      if (id === vid) self = Math.round(d);
      // 「有沒有車準時到」只認同向的車;對向車剛好停在該站與這件事無關
      const o = vehOf(id); if (!o || (wantDir && Number(o.dir) !== Number(wantDir))) continue;
      if (!best || d < best.m) best = { key: id, m: Math.round(d) };
    }
    // BR 沒有官方車號,身分是我們自己切出來的、可被重新指派 ⇒ 使用者已裁示身分不必對,
    // 只要「有車依那個時間到站」。有官方車號的線維持嚴格判準(同一台車要到)。
    const lenient = lnId === 'BR';
    const m = lenient ? (best && best.m) : self;
    return { station: st.name, self, nearest: best, lenient, ok: m != null && m <= nearM };
  }, { lnId: c.lnId, stationIdx: c.stationIdx, nearM: NEAR_M, vid: c.vid });
  const ts = new Date().toTimeString().slice(0, 8);
  const tag = r.err ? '⚠️' : r.ok ? '✅' : '❌';
  console.log(`${tag} [${ts}] ${c.lnId} 站牌說 ${c.etaSec}s 後到「${r.station || '?'}」` +
    (r.err ? `　${r.err}` : `　那一刻該車距站 ${r.self == null ? '車已不在名冊' : r.self + 'm'}` +
      (r.nearest ? `（同向最近的車 ${r.nearest.m}m${r.lenient ? '←BR 用這個判' : ''}）` : '（同向無車）')));
  results.push({ ...c, ...r });
}
const done = results.filter(r => !r.err);
const pass = done.filter(r => r.ok).length;
console.log(`\n準時到站：${pass}/${done.length}（判準：預測時刻該車距該站 ≤${NEAR_M}m；` +
  `BR 因無官方車號改判「同向最近的車」；終點站到站不取樣，本輪略過 ${picked.skippedTerminal} 筆）`);
await b.close();
process.exit(done.length && pass === done.length ? 0 : 1);
