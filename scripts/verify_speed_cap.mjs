// 台鐵位置模型的速度合理性回歸測試（issue #15：EMU3000 顯示 148 km/h）。
//
// 判準刻意寫「是什麼」而不是「幾 km/h」：上界一律由當下資料推導——
//   允許峰值 = max(該車種極速 perf.v, 該跑段時刻表要求的最快區間平均速度 maxDel)
// 插值的職責是不要「無中生有製造速度」，所以超過這個上界才算缺陷。
// 跑段分兩類，紅燈成因可分辨：
//   (a) 節點資料一致（maxDel ≤ 極速）→ 插值若超上界就是插值的錯，硬 gate 為 0。
//   (b) 節點資料矛盾（maxDel > 極速，時刻表要求的速度該車跑不到）→ 插值壓不下去，
//       屬車種判定或里程資料問題，只斷言數量沒有惡化。
//
// 用法：先在受測樹起 server，再 PORT=<port> ROOT=<樹路徑> node scripts/verify_speed_cap.mjs
import { createRequire } from 'module';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT || path.resolve(HERE, '..');
const PORT = Number(process.env.PORT || 5347);
// playwright 可能只裝在主 repo（worktree 不帶 node_modules）
const req = createRequire(fs.existsSync(path.join(ROOT, 'node_modules/playwright'))
  ? path.join(ROOT, 'package.json') : '/Users/xuxiang/Code/捷運小動畫/package.json');
const { chromium } = req('playwright');

// G0（心得 32）：驗的必須是當前工作樹，不是某個釘死的舊副本
const diskMd5 = createHash('md5').update(fs.readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
const servedMd5 = createHash('md5').update(Buffer.from(
  await (await fetch(`http://127.0.0.1:${PORT}/index.html`)).arrayBuffer())).digest('hex');
console.log(`G0 target=${ROOT}\n   disk=${diskMd5}\n   serve=${servedMd5}`);
if (diskMd5 !== servedMd5) { console.error('G0 FAIL：server 提供的不是目標樹的 index.html'); process.exit(1); }

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.error('PAGEERROR', e.message));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof state !== 'undefined' && state.trains && state.trains.some(t => t.sys === 'tra_sched' && t.stops && t.stops.some(s => s.rp)),
  null, { timeout: 180000 });

const d = await page.evaluate(() => {
  const seen = new Set(), runs = [];
  let uiWorst = { kmh: 0 }, maxPerfV = 0;
  for (const tr of state.trains) {
    if (tr.sys !== 'tra_sched') continue;
    const perf = resolvePerf(tr);
    maxPerfV = Math.max(maxPerfV, perf.v);
    // 模型層：每條跑段曲線的瞬時峰值
    for (const s of tr.stops) {
      if (!s.rp || seen.has(s.rp)) continue;
      seen.add(s.rp);
      const rp = s.rp;
      let maxDel = 0;
      if (rp.obs) for (let i = 0; i < rp.xs.length - 1; i++)
        maxDel = Math.max(maxDel, (rp.ys[i + 1] - rp.ys[i]) / (rp.xs[i + 1] - rp.xs[i]) * 3.6);
      else maxDel = rp.vc * 3.6;
      let vmax = 0; const step = Math.max(1, Math.floor(rp.T / 2000));
      for (let t = 0; t + step <= rp.T; t += step) {
        const v = (profTimeToProg(rp, t + step) - profTimeToProg(rp, t)) * rp.L / step * 3.6;
        if (v > vmax) vmax = v;
      }
      runs.push({ train: tr.train, car: tr.carName, obs: !!rp.obs,
        vmax: +vmax.toFixed(1), perfV: perf.v, maxDel: +maxDel.toFixed(1) });
    }
    // 顯示層：跟車小卡印出來的時速（與 index.html 的 fpSpd 同一式）
    const t0 = tr.stops[0].depSec, t1 = tr.stops[tr.stops.length - 1].arrSec;
    for (let t = t0; t <= t1 - 20; t += 10) {
      const pa = trainPos(tr, t), pb = trainPos(tr, t + 20);
      if (!pa || !pb) continue;
      const kmh = haversineKm(pa, pb) / 20 * 3600;
      if (kmh > uiWorst.kmh) uiWorst = { kmh: +kmh.toFixed(1), train: tr.train, car: tr.carName, perfV: perf.v };
    }
  }
  return { runs, uiWorst, maxPerfV };
});
await browser.close();

let pass = 0, fail = 0;
const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

const allow = x => Math.max(x.perfV, x.maxDel) * 1.03;   // 3% 留給逐區間迭代的殘留
const conflict = d.runs.filter(x => x.obs && x.maxDel > x.perfV);
const consistent = d.runs.filter(x => !(x.obs && x.maxDel > x.perfV));
const bad = consistent.filter(x => x.vmax > allow(x));

console.log(`\n跑段 ${d.runs.length}（實測剖面 ${d.runs.filter(x => x.obs).length}／梯形 ${d.runs.filter(x => !x.obs).length}）`);
t('節點資料一致的跑段：插值未製造超速', bad.length === 0,
  bad.length ? `${bad.length} 段，最嚴重 ${Math.max(...bad.map(x => (x.vmax / allow(x) - 1) * 100)).toFixed(1)}%（${bad[0].train} ${bad[0].car}）` : `${consistent.length} 段全數在上界內`);

// 資料矛盾段：2026-07-29 基線 14 段。惡化代表車種表或班表資料退步，要查。
const CONFLICT_BASELINE = 14;
t(`節點資料矛盾的跑段未惡化（基線 ${CONFLICT_BASELINE}）`, conflict.length <= CONFLICT_BASELINE,
  `現在 ${conflict.length} 段` + (conflict.length ? `，最嚴重要求 ${Math.max(...conflict.map(x => x.maxDel))} km/h` : ''));

// 顯示層：最快車種極速 + 5 是「畫面不該再出現明顯不可能的數字」的上界
const uiCap = d.maxPerfV + 5;
t(`跟車小卡時速不超過 ${uiCap} km/h（最快車種極速 ${d.maxPerfV} + 5）`, d.uiWorst.kmh <= uiCap,
  `全網最快 ${d.uiWorst.kmh} km/h（${d.uiWorst.train} ${d.uiWorst.car}，極速 ${d.uiWorst.perfV}）`);

if (conflict.length) {
  console.log('\n[待辦] 時刻表要求速度 > 車種極速的跑段（車種判定或里程資料問題，非插值缺陷）：');
  for (const c of conflict.slice().sort((a, b) => b.maxDel - a.maxDel).slice(0, 5))
    console.log(`   ${c.train} ${c.car}：要求 ${c.maxDel} km/h，車種極速 ${c.perfV}`);
}
console.log(`\n合計 ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
