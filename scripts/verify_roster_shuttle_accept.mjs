// 兩站支線（小碧潭 G_XBT、新北投 R_XBT）不得把整包官方名冊拖下水。
//
// 2026-08-17 實測的故障：支線車前進成 from≠to 後 run 仍是 0，而名冊驗證器的幾何規則要求
// 「非同站必須 run>0」，且它是整包 return false ⇒ 連續 10 輪全北捷 100 台的官方資料都沒換上，
// 名冊 113 台連 148 秒一字不變，頁面拿舊快照往前外推：402 照兩分半前的計畫開進古亭、
// 432 停在原地，兩台撞在一起。
//
// 判準分兩層：
//   1. 對照組：同一份 payload，只差「有沒有套 run 修復」——沒套必須被拒、套了必須通過。
//      這證明判準有牙，也證明是修復本身在起作用（不是別的東西剛好讓它綠）。
//   2. 端到端：連續 N 輪對真實 API 建名冊套用，零次被拒，且名冊的 receivedEpoch 真的在前進
//      （凍結時它不會動——這是當初「全綠卻凍結」照不到的那個維度）。
import { chromium } from 'playwright';
const ROUNDS = Number(process.argv[2] || 6), GAP = Number(process.argv[3] || 12);
const URL = process.argv[4] || 'http://127.0.0.1:5399/?census=1';
let pass = 0, fail = 0;
const ok = (name, cond, got) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : '　實測：' + got}`); };

const b = await chromium.launch();
const p = await b.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 90000 });
await p.evaluate(() => {
  const g = (typeof GROUPS !== 'undefined' ? GROUPS : []).find(x => (x.members || []).includes('mrt'));
  if (g) selectGroup(g);
});
await p.waitForTimeout(3000);

// ── 1. 對照組：合成一台「前進中但 run=0」的支線車 ─────────────────────────────
const ctl = await p.evaluate(() => {
  const mk = line => ({ vehicleId: 'test:' + line, line, dir: 2, from: 0, to: 1, dest: 1,
    run: 0, arrEpoch: Math.floor(Date.now() / 1000) + 60, terminal: false });
  const out = {};
  for (const line of ['G_XBT', 'R_XBT']) {
    const raw = { feedMode: 'official', sourceRevision: Math.floor(Date.now() / 1000), vehicles: [mk(line)] };
    const repaired = { ...raw, vehicles: raw.vehicles.map(trtcOfficialRosterRepairRun) };
    out[line] = { withoutRepair: trtcOfficialRosterPayloadValid(raw),
      withRepair: trtcOfficialRosterPayloadValid(repaired), runAfter: repaired.vehicles[0].run };
  }
  return out;
});
for (const line of ['G_XBT', 'R_XBT']) {
  const c = ctl[line];
  ok(`控制組 ${line}：沒套修復時必須被拒（判準有牙）`, c.withoutRepair === false, `valid=${c.withoutRepair}`);
  ok(`${line}：套了修復後整包通過`, c.withRepair === true, `valid=${c.withRepair}`);
  ok(`${line}：run 由線形補出正值`, Number(c.runAfter) > 0, `run=${c.runAfter}`);
}

// ── 2. 端到端：真實 payload 連續 N 輪都要套得上，且名冊真的在前進 ────────────────
const seenRecv = [];
let rejects = 0, sampled = 0;
const bad = [];
for (let r = 0; r < ROUNDS; r++) {
  if (r) await new Promise(s => setTimeout(s, GAP * 1000));
  const s = await p.evaluate(async () => {
    const live = await (await fetch('/api/trtc-live', { cache: 'no-store' })).json();
    const now = Math.floor(Date.now() / 1000);
    await trtcCodesEnsure();
    const built = trtcCensusVehicles(live.trains || [], now, todayStr());
    if (!built) return { skip: true };
    const covered = new Set(built.map(v => v.line));
    const kept = (live.boardPos.vehicles || []).filter(v => !covered.has(v.line));
    const payload = { ...live.boardPos, vehicles: built.concat(kept), feedMode: 'official' };
    const repaired = { ...payload, vehicles: payload.vehicles.map(trtcOfficialRosterRepairRun) };
    const valid = trtcOfficialRosterPayloadValid(repaired);
    const offenders = valid ? [] : repaired.vehicles.filter(v => {
      const ln = trtcOfficialRosterGeometryLine(v.line), sc = ln && ln.stations && ln.stations.length;
      const from = Number(v.from), to = Number(v.to), dir = Number(v.dir), run = Number(v.run);
      if (!Number.isInteger(sc)) return true;
      return !(from === to ? run === 0 : to === from + (dir === 2 ? 1 : -1) && run > 0);
    }).map(v => `${v.line}/${v.vehicleId}(from=${v.from} to=${v.to} run=${v.run})`);
    const R = state.trtcOfficialRoster || {};
    return { valid, offenders, official: (live.trains || []).length, builtN: built.length,
      payloadN: payload.vehicles.length, recv: R.receivedEpoch || null, feed: R.feedMode,
      rosterN: (R.vehicles || []).length };
  });
  if (s.skip) continue;
  sampled++;
  if (!s.valid) { rejects++; bad.push(s.offenders.slice(0, 4).join(' ')); }
  if (s.recv != null) seenRecv.push(Math.round(s.recv));
  console.log(`   [${new Date().toTimeString().slice(0, 8)}] 官方 ${s.official} → 建 ${s.builtN} → payload ${s.payloadN}` +
    `｜驗證 ${s.valid ? '過' : '❌' + s.offenders.slice(0, 3).join(' ')}｜名冊 ${s.feed}/${s.rosterN}`);
}
ok(`端到端：${sampled} 輪真實 payload 零次被拒`, sampled > 0 && rejects === 0, `被拒 ${rejects} 輪：${bad.join('；')}`);
const distinct = new Set(seenRecv).size;
ok('名冊真的在換新（receivedEpoch 有前進，非凍結）', distinct >= Math.max(2, Math.ceil(sampled / 2)),
  `${sampled} 輪只看到 ${distinct} 個不同的 receivedEpoch`);
ok('沒有 pageerror', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log(`\n合計 ${pass} 過 / ${fail} 失敗`);
await b.close();
process.exit(fail ? 1 : 0);
