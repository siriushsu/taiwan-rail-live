// 量「車子為什麼會消失」：對正式站連續拉 /api/trtc-live，逐輪比對 vehicleId 集合。
// 只讀，不寫任何東西。
import fs from 'node:fs';

const URL_ = 'https://railisland.tw/api/trtc-live';
const ROUNDS = Number(process.argv[2] || 24);
const EVERY_MS = Number(process.argv[3] || 5000);
const OUT = './tmp/roster_rounds.jsonl';

const sleep = ms => new Promise(r => setTimeout(r, ms));
let prevIds = null, prevRev = null, prevById = null;
const seenEver = new Map();          // vehicleId -> 最後出現的輪次
const gaps = [];                     // 消失後又回來的紀錄
const rows = [];

for (let i = 0; i < ROUNDS; i++) {
  const t0 = Date.now();
  let j = null, err = '';
  try {
    const res = await fetch(URL_, { headers: { 'Cache-Control': 'no-cache' } });
    j = await res.json();
  } catch (e) { err = String(e && e.message || e); }
  const bp = j && j.boardPos;
  const vs = bp && Array.isArray(bp.vehicles) ? bp.vehicles : [];
  const rev = bp ? Number(bp.sourceRevision) : NaN;
  const now = Date.now() / 1000;
  const ids = new Set(vs.map(v => String(v.vehicleId)));
  const byId = new Map(vs.map(v => [String(v.vehicleId), v]));

  let kept = 0, gone = 0, born = 0, moved = 0, reanchored = 0, past = 0;
  if (prevIds) {
    for (const id of prevIds) (ids.has(id) ? kept++ : gone++);
    for (const id of ids) if (!prevIds.has(id)) born++;
    for (const id of ids) {
      if (!prevById.has(id)) continue;
      const a = prevById.get(id), b = byId.get(id);
      if (Number(a.to) !== Number(b.to) || Number(a.from) !== Number(b.from)) moved++;
      // 同一個區間但 arrEpoch 被往後推 >3 秒＝重新判斷（畫面上就是跳一下）
      else if (Math.abs(Number(a.arrEpoch) - Number(b.arrEpoch)) > 3) reanchored++;
    }
  }
  // 已經越過自己 arrEpoch 的車＝畫面上卡在站上不動
  for (const v of vs) if (Number(v.arrEpoch) < now) past++;

  for (const id of ids) {
    if (seenEver.has(id) && seenEver.get(id) < i - 1) gaps.push({ round: i, id, missedRounds: i - seenEver.get(id) - 1 });
    seenEver.set(id, i);
  }

  const row = { i, ts: new Date().toISOString(), err, feedMode: bp && bp.feedMode, rev,
    ageSec: Number.isFinite(rev) ? +(now - rev).toFixed(1) : null,
    n: vs.length, ext: vs.filter(v => v.extension).length,
    numbered: vs.filter(v => v.officialNo).length,
    kept, gone, born, moved, reanchored, past, revChanged: rev !== prevRev };
  rows.push(row);
  console.log(JSON.stringify(row));
  prevIds = ids; prevRev = rev; prevById = byId;
  const wait = EVERY_MS - (Date.now() - t0);
  if (i < ROUNDS - 1 && wait > 0) await sleep(wait);
}

fs.writeFileSync(OUT, rows.map(r => JSON.stringify(r)).join('\n'));
const withPrev = rows.filter(r => r.i > 0 && !r.err);
const sum = k => withPrev.reduce((a, r) => a + (r[k] || 0), 0);
console.log('\n──── 總結 ────');
console.log('輪數', rows.length, '｜每輪車數', Math.min(...rows.map(r => r.n)), '~', Math.max(...rows.map(r => r.n)));
console.log('資料齡秒 min/max', Math.min(...rows.map(r => r.ageSec ?? 0)), '/', Math.max(...rows.map(r => r.ageSec ?? 0)),
  '｜超過 30 秒的輪數', rows.filter(r => (r.ageSec ?? 0) > 30).length);
console.log('消失(gone) 合計', sum('gone'), '｜新生(born) 合計', sum('born'), '｜留存(kept) 合計', sum('kept'));
console.log('換區間(moved)', sum('moved'), '｜同區間被重新錨定(reanchored)', sum('reanchored'));
console.log('已越過 arrEpoch 卡站上(past) 每輪平均', (rows.reduce((a, r) => a + r.past, 0) / rows.length).toFixed(1));
console.log('消失後又回來的次數', gaps.length, gaps.slice(0, 8).map(g => `${g.id}(缺${g.missedRounds}輪)`).join(' '));
console.log('證據檔', OUT);
