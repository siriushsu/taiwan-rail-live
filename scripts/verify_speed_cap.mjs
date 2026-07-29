// 台鐵位置模型的速度合理性回歸測試（issue #15：EMU3000 顯示 148 km/h）。
//
// 判準刻意寫「是什麼」而不是「幾 km/h」：上界一律取「該車種極速」，由 PERF_RULES 當下決定，
// 不留容差（使用者裁定：速度不能超過上限，比模型精度重要）。
//
// 四項判準的分工（重要，別誤信）：
//   1. 模型層：每條跑段曲線的瞬時峰值 ≤ 車種極速——驗 buildObsProfile 的導數夾限。
//   2. 節點層：不得殘留「時刻表要求速度 > 車種極速」的跑段——驗節點清洗閘門。
//   3. 顯示層全網掃描：腳本自己重算公式並套上限，覆蓋全班表，但**與實作同源**，
//      照不到「實作把上限拿掉」這種退步（實測突變後仍全綠）。
//   4. 顯示層 DOM 實讀：真的跟一班車、讀 #fpSpd 印出來的字，取樣點選在貼軌跳躍處
//      （rawWorst，未套上限時超標最多的位置）。**只有這項守得住顯示層的上限**，
//      突變（移除 clamp）時單獨變紅，已驗證。
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
  let uiWorst = { kmh: 0 }, rawWorst = { excess: -1e9 }, maxPerfV = 0;
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
    // 顯示層：跟車小卡的時速。同時記兩個——
    //   uiWorst = 含 index.html 的極速硬上限（判準用）
    //   rawWorst = 不含上限的原始位置差分（只用來挑 DOM 取樣點：那裡才是貼軌跳躍處，
    //              取樣落在這裡，DOM 判準才照得到「上限被拿掉」這種退步）
    const t0 = tr.stops[0].depSec, t1 = tr.stops[tr.stops.length - 1].arrSec;
    for (let t = t0; t <= t1 - 20; t += 10) {
      const pa = trainPos(tr, t), pb = trainPos(tr, t + 20);
      if (!pa || !pb) continue;
      const raw = haversineKm(pa, pb) / 20 * 3600;
      const kmh = Math.min(raw, speedCapOf(tr));
      if (kmh > uiWorst.kmh) uiWorst = { kmh: +kmh.toFixed(1), train: tr.train, car: tr.carName, perfV: perf.v, at: t };
      if (raw - perf.v > rawWorst.excess) rawWorst = { excess: raw - perf.v, raw: +raw.toFixed(1), train: tr.train, perfV: perf.v, at: t };
    }
  }
  return { runs, uiWorst, rawWorst, maxPerfV };
});

// 不同源複驗：上面是腳本重算公式，這裡真的跟一班車、讀 DOM 上印出來的字。
// 取樣點選在已知最容易超標的位置（貼軌不連續造成的跳躍處）。
const domCheck = await page.evaluate(async ({ train, at }) => {
  const tr = state.trains.find(t => t.sys === 'tra_sched' && String(t.train) === String(train));
  if (!tr) return { err: 'train not found' };
  followTrainNo(String(train), { sys: 'tra_sched' });
  const el = document.getElementById('fpSpd');
  let worst = 0, worstAt = 0;
  for (let t = at - 40; t <= at + 40; t++) {
    state.simSec = t;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const n = parseFloat((el.textContent || '').replace(/[^\d.]/g, ''));
    if (Number.isFinite(n) && n > worst) { worst = n; worstAt = t; }
  }
  return { worst, worstAt, perfV: resolvePerf(tr).v, train };
}, { train: d.rawWorst.train, at: d.rawWorst.at });
await browser.close();

let pass = 0, fail = 0;
const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

// 硬上限：速度不得超過車種極速，不留容差（使用者裁定優先於模型精度）。
// 唯一的例外是「時刻表本身就要求跑不到的速度」，那種段連線性都超標——節點閘門會清掉它們，
// 所以這裡斷言它為 0；若又冒出來，代表閘門失效或資料退步，必須紅。
const conflict = d.runs.filter(x => x.obs && x.maxDel > x.perfV);
const bad = d.runs.filter(x => x.vmax > x.perfV);

console.log(`\n跑段 ${d.runs.length}（實測剖面 ${d.runs.filter(x => x.obs).length}／梯形 ${d.runs.filter(x => !x.obs).length}）`);
t('無跑段的瞬時速度超過車種極速', bad.length === 0,
  bad.length ? `${bad.length} 段，最嚴重 ${bad.reduce((a, b) => a.vmax - a.perfV > b.vmax - b.perfV ? a : b).train} 超出 ${Math.max(...bad.map(x => x.vmax - x.perfV)).toFixed(1)} km/h`
    : `${d.runs.length} 段全數不超過各自極速`);

t('無「時刻表要求速度 > 車種極速」的殘留跑段', conflict.length === 0,
  conflict.length ? `${conflict.length} 段，最嚴重要求 ${Math.max(...conflict.map(x => x.maxDel))} km/h` : '節點閘門已全數清除');

// 顯示層硬上限：使用者實際看到的數字
t('跟車小卡時速不超過該車種極速（全網掃描）', d.uiWorst.kmh <= d.uiWorst.perfV,
  `全網最快 ${d.uiWorst.kmh} km/h（${d.uiWorst.train} ${d.uiWorst.car}，極速 ${d.uiWorst.perfV}）`);

t('跟車小卡時速不超過該車種極速（DOM 實讀）', !domCheck.err && domCheck.worst <= domCheck.perfV,
  domCheck.err ? domCheck.err : `${domCheck.train} 次在 t=${domCheck.worstAt} 讀到 ${domCheck.worst} km/h（極速 ${domCheck.perfV}）`);
console.log(`\n合計 ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
