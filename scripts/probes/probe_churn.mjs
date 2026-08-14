// 「消失」到底是真的不見，還是身分換號？只讀正式站 /api/trtc-live，逐輪比對。
//
// 🔴 2026-08-14 訂正：舊版把「這一輪整包讀不到」也算成消失——讀不到的那一輪全線
// 一次記 170 台消失，量出來的「真的不見」幾乎全是探針自己的讀取失敗。現在讀不到就
// 整輪跳過、不更新比較基準，並把讀取失敗率獨立列出來（那是另一個問題，不是車不見）。
//
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
const rows = [], vanishSamples = [], churnSamples = [];
let revChanges = 0, readFail = 0, totalGone = 0, churn = 0, vanish = 0, atDest = 0;
const bornRound = new Map();

for (let i = 0; i < ROUNDS; i++) {
  const t0 = Date.now();
  let j = null, why = '';
  try {
    const res = await fetch(URL_, { headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) why = `http-${res.status}`; else j = await res.json();
  } catch (e) { why = 'fetch-throw'; }
  const bp = j && j.boardPos;
  const vs = bp && Array.isArray(bp.vehicles) ? bp.vehicles : null;
  if (!vs || !vs.length) {
    // 讀不到＝我們這端的事，不是車不見。整輪跳過，比較基準留在上一輪成功的那次。
    readFail++;
    const row = { i, read: 'FAIL', why: why || (bp ? 'empty-vehicles' : 'no-boardPos') };
    rows.push(row); console.log(JSON.stringify(row));
    const w0 = EVERY_MS - (Date.now() - t0); if (i < ROUNDS - 1 && w0 > 0) await sleep(w0);
    continue;
  }
  const rev = Number(bp.sourceRevision);
  const by = new Map(vs.map(v => [String(v.vehicleId), v]));
  for (const id of by.keys()) if (!bornRound.has(id)) bornRound.set(id, i);

  let g = 0, c = 0, va = 0, ad = 0;
  if (prev && rev !== prevRev) {
    revChanges++;
    const bornList = [...by.values()].filter(v => !prev.has(String(v.vehicleId)));
    for (const [id, old] of prev) {
      if (by.has(id)) continue;
      g++;
      const oldRp = rp(old);
      const replaced = bornList.some(b => gk(b) === gk(old) && rp(b) >= oldRp && rp(b) <= oldRp + 2);
      if (Number(old.to) === Number(old.dest)) ad++;
      else if (replaced) { c++; if (churnSamples.length < 8) churnSamples.push({ id, line: old.line, dir: old.dir, to: old.to, dest: old.dest }); }
      else { va++; if (vanishSamples.length < 10) vanishSamples.push({ id, line: old.line, dir: old.dir, from: old.from, to: old.to, dest: old.dest, livedRounds: i - (bornRound.get(id) ?? i) }); }
    }
    totalGone += g; churn += c; vanish += va; atDest += ad;
  }
  const row = { i, read: 'OK', rev, changed: rev !== prevRev, n: vs.length, gone: g, churn: c, vanish: va, atDest: ad };
  rows.push(row); console.log(JSON.stringify(row));
  prev = by; prevRev = rev;
  const w = EVERY_MS - (Date.now() - t0);
  if (i < ROUNDS - 1 && w > 0) await sleep(w);
}
try { fs.mkdirSync('./tmp', { recursive: true }); fs.writeFileSync(OUT, rows.map(r => JSON.stringify(r)).join('\n')); } catch {}
const ok = rows.filter(r => r.read === 'OK');
console.log('\n──── 總結 ────');
console.log('輪數', rows.length, '｜讀取失敗', readFail, `(${(readFail / rows.length * 100).toFixed(1)}%)`,
  '｜成功且 sourceRevision 真的換了', revChanges, '次');
console.log('每輪車數', ok.length ? `${Math.min(...ok.map(r => r.n))}~${Math.max(...ok.map(r => r.n))}` : '無');
console.log('消失合計', totalGone, '＝ 到終點站', atDest, '＋ 換號(同位置有新車)', churn, '＋ 真的不見', vanish);
console.log('換號率 = 每次 revision 變動', (churn / Math.max(1, revChanges)).toFixed(2), '台',
  '｜真的不見 = 每次', (vanish / Math.max(1, revChanges)).toFixed(2), '台');
console.log('真的不見的樣本', JSON.stringify(vanishSamples));
console.log('換號的樣本', JSON.stringify(churnSamples));
console.log('證據檔', OUT);
