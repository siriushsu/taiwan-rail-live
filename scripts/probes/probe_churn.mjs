// 「消失」到底是真的不見，還是身分換號？只讀正式站 /api/trtc-live，逐輪比對。
// 判準：一台 gone 的車，若同一 line|dir|dest 群組裡有一台 born 的車，routePosition 落在
// [gone.rp, gone.rp+2]（同位置或前進一兩站），就算「換號」不是「消失」。
import fs from 'node:fs';
const URL_ = 'https://railisland.tw/api/trtc-live';
const ROUNDS = Number(process.argv[2] || 40), EVERY_MS = Number(process.argv[3] || 8000);
const OUT = './tmp/churn_rounds.jsonl';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rp = v => Number(v.dir) === 2 ? Number(v.to) : -Number(v.to);
const gk = v => `${v.line}|${v.dir}|${v.dest}`;

let prev = null, prevRev = null;
const rows = [], churnSamples = [], vanishSamples = [];
let revChanges = 0, totalGone = 0, churn = 0, vanish = 0, atDest = 0;
const alive = new Map();  // vehicleId -> 第一次看到的輪次

for (let i = 0; i < ROUNDS; i++) {
  const t0 = Date.now();
  let j = null; try { j = await (await fetch(URL_, { headers: { 'Cache-Control': 'no-cache' } })).json(); } catch {}
  const bp = j && j.boardPos, vs = (bp && bp.vehicles) || [];
  const rev = bp ? Number(bp.sourceRevision) : NaN;
  const by = new Map(vs.map(v => [String(v.vehicleId), v]));
  for (const id of by.keys()) if (!alive.has(id)) alive.set(id, i);

  let g = 0, c = 0, va = 0, ad = 0;
  if (prev && rev !== prevRev) {
    revChanges++;
    const bornList = [...by.values()].filter(v => !prev.has(String(v.vehicleId)));
    for (const [id, old] of prev) {
      if (by.has(id)) continue;
      g++;
      const oldRp = rp(old);
      const replaced = bornList.some(b => gk(b) === gk(old) && rp(b) >= oldRp && rp(b) <= oldRp + 2);
      if (Number(old.to) === Number(old.dest)) { ad++; }
      else if (replaced) { c++; if (churnSamples.length < 6) churnSamples.push({ id, line: old.line, dir: old.dir, to: old.to, dest: old.dest }); }
      else { va++; if (vanishSamples.length < 8) vanishSamples.push({ id, line: old.line, dir: old.dir, from: old.from, to: old.to, dest: old.dest, livedRounds: i - (alive.get(id) ?? i) }); }
    }
    totalGone += g; churn += c; vanish += va; atDest += ad;
  }
  const row = { i, rev, changed: rev !== prevRev, n: vs.length, gone: g, churn: c, vanish: va, atDest: ad };
  rows.push(row); console.log(JSON.stringify(row));
  prev = by; prevRev = rev;
  const wait = EVERY_MS - (Date.now() - t0);
  if (i < ROUNDS - 1 && wait > 0) await sleep(wait);
}
fs.writeFileSync(OUT, rows.map(r => JSON.stringify(r)).join('\n'));
console.log('\n──── 總結 ────');
console.log('輪數', rows.length, '｜sourceRevision 真的換了', revChanges, '次');
console.log('消失合計', totalGone, '＝ 到終點站', atDest, '＋ 換號(同位置有新車)', churn, '＋ 真的不見', vanish);
console.log('真的不見的樣本', JSON.stringify(vanishSamples));
console.log('換號的樣本', JSON.stringify(churnSamples));
console.log('若一律續推 600 秒，同時掛著的幽靈上限 ≈', (vanish / Math.max(1, revChanges)).toFixed(2),
  '台/輪 ×', (600 / (EVERY_MS / 1000 * (rows.length / Math.max(1, revChanges)))).toFixed(0), '輪 =',
  (vanish / Math.max(1, revChanges) * (600 / (EVERY_MS / 1000 * (rows.length / Math.max(1, revChanges))))).toFixed(0), '台');
console.log('證據檔', OUT);
