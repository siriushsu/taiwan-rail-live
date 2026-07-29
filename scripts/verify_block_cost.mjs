// issue #17 的效能閘門：耦合掃描每幀都要跑，不能把 900+ 班車變成 O(n²)。
// 判準寫「怎麼長」而不是「幾毫秒」——毫秒數綁機器，換一台就要改門檻；
// 「車數翻倍時耗時不得翻四倍」則是演算法本身的性質，跨機器都成立。
//
// 跑法：A_PORT=<改動後> [B_PORT=<改動前>] node scripts/verify_block_cost.mjs

import { createRequire } from 'node:module';
const require = createRequire('/Users/xuxiang/Code/捷運小動畫/package.json');
const { chromium } = require('playwright');

const A = process.env.A_PORT || 5361;
const B = process.env.B_PORT || '';

async function measure(port, label) {
  const b = await chromium.launch();
  const page = await b.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('typeof state !== "undefined" && state.trains && state.trains.length > 300', null, { timeout: 180000 });
  const r = await page.evaluate(() => {
    state.playing = false;
    const has = typeof updateBlockHolds === 'function';
    const all = state.trains;
    const tra = all.filter(t => t.sys === 'tra_sched');
    // 尖峰時刻（在線車數最多的那一刻）才是要量的點
    let best = 0, bestN = -1;
    for (let t = 0; t < 86400; t += 300) {
      state.simSec = t;
      let n = 0; for (const tr of tra) if (trainPos(tr, t)) n++;
      if (n > bestN) { bestN = n; best = t; }
    }
    const timeIt = (fn, reps) => { const t0 = performance.now(); for (let i = 0; i < reps; i++) fn(i); return (performance.now() - t0) / reps; };
    const runAt = subset => {
      state.trains = subset;
      if (has) { _blockHold.clear(); _blockGap.clear(); _blockPrevD.clear(); _blockSim = null; }
      state.simSec = best;
      if (has) updateBlockHolds();                       // 暖機一次，避免把首次快取算進去
      return has ? timeIt(i => { state.simSec = best + i * 2; updateBlockHolds(); }, 120) : 0;
    };
    // 半量 vs 全量：O(n²) 會是 4 倍，O(n log n) 約 2.2 倍
    const half = all.filter((t, i) => i % 2 === 0);
    const msHalf = runAt(half), nHalf = half.filter(t => t.sys === 'tra_sched').length;
    const msFull = runAt(all), nFull = tra.length;
    state.simSec = best;
    const msDraw = timeIt(i => { state.simSec = best + i * 2; if (has) updateBlockHolds(); draw(); }, 60);
    return { has, best, onlineAtPeak: bestN, nHalf, nFull, msHalf, msFull, msDraw };
  });
  await b.close();
  console.log(`${label}  尖峰 ${new Date(r.best * 1000).toISOString().slice(11, 16)} 在線 ${r.onlineAtPeak} 班`);
  console.log(`   updateBlockHolds：半量(${r.nHalf} 班) ${r.msHalf.toFixed(2)}ms → 全量(${r.nFull} 班) ${r.msFull.toFixed(2)}ms` +
    (r.has ? `　倍率 ${(r.msFull / Math.max(r.msHalf, 1e-6)).toFixed(2)}×（O(n²) 會是 4×）` : '（此版本沒有耦合掃描）'));
  console.log(`   一幀（掃描＋draw）：${r.msDraw.toFixed(2)}ms  ⇒ ${(1000 / r.msDraw).toFixed(0)} fps 上限`);
  return { ...r, errs };
}

const a = await measure(A, '改動後');
const bb = B ? await measure(B, '改動前') : null;

const ratio = a.msFull / Math.max(a.msHalf, 1e-6);
const checks = [
  ['C1 車數翻倍不得讓耗時翻四倍（不是 O(n²)）', ratio < 3, `倍率 ${ratio.toFixed(2)}×`],
  ['C2 耦合掃描不得吃掉一幀的一半', a.msFull < a.msDraw / 2, `掃描 ${a.msFull.toFixed(2)}ms／整幀 ${a.msDraw.toFixed(2)}ms`],
  ['C3 無 runtime 錯誤', a.errs.length === 0, a.errs.length ? a.errs[0] : '零 pageerror'],
];
if (bb) checks.push(['C4 整幀時間不得比改動前多一倍', a.msDraw < bb.msDraw * 2, `${a.msDraw.toFixed(2)}ms vs 改動前 ${bb.msDraw.toFixed(2)}ms`]);
let fail = 0;
for (const [n, ok, d] of checks) { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} — ${d}`); }
console.log(`\n合計 ${checks.length - fail} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
