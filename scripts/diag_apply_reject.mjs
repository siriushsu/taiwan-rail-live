// 名冊為什麼凍結？逐輪量 apply 的結果與拒絕原因，並在被拒時把「哪一台車不合格、哪一條規則」找出來。
import { chromium } from 'playwright';
const ROUNDS = Number(process.argv[2] || 10), GAP = Number(process.argv[3] || 12);
const URL = process.argv[4] || 'http://127.0.0.1:5399/?census=1';
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 90000 });
await p.evaluate(() => {
  const g = (typeof GROUPS !== 'undefined' ? GROUPS : []).find(x => (x.members || []).includes('mrt'));
  if (g) selectGroup(g);
});
await p.waitForTimeout(3000);

for (let r = 0; r < ROUNDS; r++) {
  if (r) await new Promise(s => setTimeout(s, GAP * 1000));
  const out = await p.evaluate(async () => {
    const live = await (await fetch('/api/trtc-live', { cache: 'no-store' })).json();
    const now = Math.floor(Date.now() / 1000);
    await trtcCodesEnsure();
    const built = trtcCensusVehicles(live.trains || [], now, todayStr());
    let payload = null, bad = [];
    if (built) {
      const covered = new Set(built.map(v => v.line));
      const kept = (live.boardPos.vehicles || []).filter(v => !covered.has(v.line));
      payload = { ...live.boardPos, vehicles: built.concat(kept), feedMode: 'official' };
      // 逐台重跑驗證器的每一條規則，把不合格的那幾台指出來
      for (const v of payload.vehicles) {
        const ln = trtcOfficialRosterGeometryLine(v.line), sc = ln && ln.stations && ln.stations.length;
        const dir = Number(v.dir), from = Number(v.from), to = Number(v.to), dest = Number(v.dest),
          run = Number(v.run), arr = Number(v.arrEpoch);
        const why = [];
        if (!(dir === 1 || dir === 2)) why.push('dir=' + v.dir);
        if (!Number.isInteger(from) || !Number.isInteger(to) || !Number.isInteger(dest)) why.push('非整數 from/to/dest');
        if (!Number.isFinite(run) || run < 0) why.push('run=' + v.run);
        if (!Number.isFinite(arr)) why.push('arrEpoch=' + v.arrEpoch);
        if (!Number.isInteger(sc) || !(sc > 0)) why.push('線不存在:' + v.line);
        else if (!(from >= 0 && from < sc && to >= 0 && to < sc && dest >= 0 && dest < sc)) why.push('索引越界');
        else if (!(from === to ? run === 0 : to === from + (dir === 2 ? 1 : -1) && run > 0))
          why.push(`幾何不合:from=${from} to=${to} dir=${dir} run=${run}`);
        const dep = v.depEpoch != null ? v.depEpoch : null;
        if (!(dep == null || Number.isFinite(dep) && (from === to ? dep <= arr : dep < arr))) why.push('depEpoch>arrEpoch');
        if (why.length) bad.push({ id: v.vehicleId, line: v.line, src: v.source, hold: v.holdReason, why });
      }
    }
    const R = state.trtcOfficialRoster || {};
    return { officialN: (live.trains || []).length, builtN: built ? built.length : null,
      payloadN: payload ? payload.vehicles.length : null, badN: bad.length, bad: bad.slice(0, 6),
      valid: payload ? trtcOfficialRosterPayloadValid(payload) : null,
      rev: payload ? payload.sourceRevision : null, highWater: state.trtcOfficialRosterRevisionHighWater,
      rosterFeed: R.feedMode, rosterN: (R.vehicles || []).length, rosterRev: R.sourceRevision,
      rosterAge: R.receivedEpoch ? Math.round(now - R.receivedEpoch) : null,
      holdInfo: state.trtcOfficialRosterHold ? { ...state.trtcOfficialRosterHold,
        ago: Math.round(now - state.trtcOfficialRosterHold.epoch) } : null };
  });
  console.log(`[${new Date().toTimeString().slice(0, 8)}] 官方 ${out.officialN} → 建 ${out.builtN} → payload ${out.payloadN}` +
    ` ｜驗證 ${out.valid === true ? '過' : out.valid === false ? '❌不過' : '—'}（不合格 ${out.badN} 台）` +
    ` ｜名冊 ${out.rosterFeed}/${out.rosterN} 台，齡 ${out.rosterAge}s，rev ${out.rosterRev}` +
    ` ｜highWater ${out.highWater}，本輪 rev ${out.rev}` +
    (out.holdInfo ? ` ｜最近 hold=${out.holdInfo.reason}（${out.holdInfo.ago}s 前）` : ''));
  for (const x of out.bad) console.log('     ✗ ' + JSON.stringify(x));
}
await b.close();
