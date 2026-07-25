// 獨立判準驗收：遮蔽真停靠站 → 用「官方表定＋官方 DelayTime」當真值，量模型對「不知道會停的站」的預測誤差。
//
// 為什麼不能用原本那種 LOO：真值與模型預測同源（都由同一批 first 時間戳推出），
// 指標只量到「跨日可重現性」。實證：對觀測注入憑空的固定偏差，梯形基準跟著變差、實測層卻不動，
// 「改善率」反而更漂亮——同源指標會獎勵錯誤模型（心得 29）。
//
// ⚠️ 跑完才發現本判準的天花板：「照官方表定排點」這條基準線的誤差中位是 0s——
// 真值＝表定＋整車一個誤點值,跑段內的時間結構完全來自表定,所以本判準其實是在問
// 「模型多接近表定」,而梯形本來就在逼近表定 → 對通過站的真實位置零資訊,梯形天生占優。
// 因此它只能當 sanity floor（偵測模型亂跑）,不能當精度證明。實測：
//   正常：表定 0s／梯形 41s／模型 44s（A 41、B 56）
//   安慰劑 ±120s：模型惡化到 95s（A 110s）＋物理閘門把採用節點從 16473 剔到 5496 → 有牙
// 可誠實宣稱的精度證據改用「訊號對噪音比」,見 研究_快車位置推估模型_2026-07-25.md 第 4 節。
//
// 用法：node eval_pass_obs.mjs [--placebo=120] [--mad=45]
import { readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { buildProfile, profProgToTime, resolvePerf, norm, med, loadObs, CACHE } from './scripts/build_pass_obs.mjs';

const ROOT = process.cwd();
const TMP = '/private/tmp/claude-501/-Users-xuxiang-Code------/9806cec5-61fe-410f-b75a-9046662eec7b/scratchpad/eval';
const argv = process.argv.slice(2);
const arg = k => { const a = argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const PLACEBO = arg('placebo');
const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };

const dates = readdirSync(CACHE).filter(f => f.endsWith('.jsonl.gz')).map(f => f.slice(0, 10)).sort();
const ob = loadObs(dates);
const have = dates.filter(d => ob[d]);
const sched = JSON.parse(readFileSync(join(ROOT, 'data/tra_schedule_dense.json'), 'utf8'));
const sol = JSON.parse(readFileSync(join(ROOT, 'data/tra_station_of_line.json'), 'utf8'));
const pairKm = new Map();
for (const ln of sol.lines) { const st = ln.stations;
  for (let i = 0; i < st.length; i++) for (let j = i + 1; j < Math.min(st.length, i + 12); j++) {
    const km = Math.abs(st[j].cumKm - st[i].cumKm);
    for (const k of [`${norm(st[i].name)}|${norm(st[j].name)}`, `${norm(st[j].name)}|${norm(st[i].name)}`])
      if (!pairKm.has(k) || pairKm.get(k) > km) pairKm.set(k, km);
  } }
const R = 6371.0088, rd = Math.PI / 180;
const hav = (a, b) => { const dp = (b.lat - a.lat) * rd, dl = (b.lon - a.lon) * rd;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(a.lat * rd) * Math.cos(b.lat * rd) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)); };
const segDist = (a, b) => pairKm.get(`${norm(a.name)}|${norm(b.name)}`) ?? hav(a, b);

// ── 遮蔽集合：短停靠站（dwell≤60s，行為最接近通過），依站名排序取每隔一個
//    只遮一半：整批遮蔽會讓跑段長到失真，也留下未遮蔽站當跑段邊界。
const dwell = {};
for (const t of sched.trains) for (const x of t.stops) {
  if (x.stop === false) continue;
  const d = x.depSec - x.arrSec; if (d < 0) continue;
  (dwell[norm(x.name)] || (dwell[norm(x.name)] = [])).push(d);
}
const shortSt = Object.keys(dwell).filter(k => med(dwell[k]) <= 60).sort();
const MASK = shortSt.filter((_, i) => i % 2 === 0);
console.log(`遮蔽 ${MASK.length} 站（短停靠站共 ${shortSt.length}，取每隔一個）`);

mkdirSync(TMP, { recursive: true });
const rows = [];   // {err, errTrap, src}
for (const dEval of have) {
  const train = have.filter(d => d !== dEval);
  const out = join(TMP, dEval + (PLACEBO ? '_p' : ''));
  mkdirSync(out, { recursive: true });
  const a = ['scripts/build_pass_obs.mjs', `--only=${train.join(',')}`, `--mask=${MASK.join(',')}`, `--out=${out}`, '--quiet'];
  if (PLACEBO) a.push(`--placebo=${PLACEBO}`);
  if (arg('mad')) a.push(`--mad=${arg('mad')}`);
  execFileSync('node', a, { cwd: ROOT, stdio: 'inherit' });
  const model = JSON.parse(readFileSync(join(out, 'tra_pass_obs.json'), 'utf8'));
  const src = JSON.parse(readFileSync(join(out, 'tra_pass_obs_model.json'), 'utf8'));

  for (const t of sched.trains) {
    const T = ob[dEval][t.train]; if (!T) continue;
    const s = t.stops, names = s.map(x => norm(x.name));
    if (new Set(names).size !== names.length) continue;
    const day0 = Math.floor((Object.values(T)[0].first + 8 * 3600) / 86400) * 86400 - 8 * 3600;
    // 遮蔽後的跑段邊界
    const isStop = s.map((x, i) => i === 0 || i === s.length - 1 || (x.stop !== false && !MASK.includes(names[i])));
    const bounds = []; for (let i = 0; i < s.length; i++) if (isStop[i]) bounds.push(i);
    const segKm = []; for (let i = 0; i < s.length - 1; i++) segKm.push(segDist(s[i], s[i + 1]));
    const perf = resolvePerf(t);
    for (let bi = 0; bi < bounds.length - 1; bi++) {
      const k0 = bounds[bi], k1 = bounds[bi + 1]; if (k1 - k0 < 2) continue;
      const eA = T[names[k0]], eB = T[names[k1]]; if (!eA || !eB) continue;
      // 真值端點：官方表定 ＋ 官方 DelayTime（與模型吃的時間戳不同源）
      const tA = day0 + s[k0].depSec + eA.dlyLast * 60, tB = day0 + s[k1].arrSec + eB.dlyFirst * 60;
      const dur = tB - tA; if (!(dur > 60) || dur > 3 * 3600) continue;
      if (Math.abs(eB.dlyFirst - eA.dlyLast) >= 2) continue;      // 端點誤點漂移日不評（模型結構上也不採）
      let runKm = 0; for (let i = k0; i < k1; i++) runKm += segKm[i];
      const rp = buildProfile(runKm, s[k1].arrSec - s[k0].depSec, perf.a, perf.b, perf.v);
      let cum = 0;
      for (let i = k0 + 1; i < k1; i++) {
        cum += segKm[i - 1];
        if (!MASK.includes(names[i])) continue;                   // 只評被遮蔽的站（真停靠 → 有官方真值）
        const e = T[names[i]]; if (!e) continue;
        const tX = day0 + s[i].arrSec + e.dlyFirst * 60;          // 真值：該站官方表定到站＋該站官方誤點
        const fAct = (tX - tA) / dur; if (!(fAct > 0.01 && fAct < 0.99)) continue;
        const fPred = model.trains?.[t.train]?.[names[i]];
        const fTrap = rp ? profProgToTime(rp, cum / runKm) / rp.T : cum / runKm;
        // 第三條基準線：照官方表定排點。被遮蔽的站是真停靠站,官方時刻表本來就給了它的到站時刻,
        // 而真值＝表定＋該站誤點 → 這條線的誤差幾乎全是真值自身的噪音（誤點只有整分解析度＝±30s）。
        // 它同時量出本判準對梯形的偏袒程度：梯形逼近表定,而真正的通過站沒有表定可抄。
        const fSch = (s[i].arrSec - s[k0].depSec) / (s[k1].arrSec - s[k0].depSec);
        rows.push({
          err: fPred == null ? null : Math.abs(fPred / 1000 - fAct) * dur,
          errTrap: Math.abs(fTrap - fAct) * dur,
          errSch: Math.abs(fSch - fAct) * dur,
          src: fPred == null ? 'none' : (src.trains_layerA?.[t.train]?.[names[i]] != null ? 'A' : 'B'),
        });
      }
    }
  }
}

const rep = (label, arr) => {
  if (!arr.length) { console.log(`  ${label}：無樣本`); return; }
  console.log(`  ${label}：n=${arr.length} 中位 ${med(arr).toFixed(0)}s p75 ${q(arr, .75).toFixed(0)}s p90 ${q(arr, .90).toFixed(0)}s`);
};
const withPred = rows.filter(r => r.err != null);
console.log(`\n══ 獨立判準結果${PLACEBO ? `（安慰劑 ±${PLACEBO}s）` : ''} ══`);
console.log(`樣本 ${rows.length}（有預測 ${withPred.length}／退梯形 ${rows.length - withPred.length}）`);
rep('照官方表定排點（真值噪音下限）', rows.map(r => r.errSch));
rep('梯形基準（全樣本）', rows.map(r => r.errTrap));
rep('模型（有預測者）', withPred.map(r => r.err));
rep('  ↳ 同批的梯形', withPred.map(r => r.errTrap));
for (const k of ['A', 'B']) {
  const g = rows.filter(r => r.src === k);
  if (!g.length) continue;
  rep(`第${k === 'A' ? '一' : '二'}層（${k}）`, g.map(r => r.err));
  rep(`  ↳ 同批的梯形`, g.map(r => r.errTrap));
}
const m1 = med(withPred.map(r => r.err)), m0 = med(withPred.map(r => r.errTrap));
console.log(`\n改善（有預測樣本、中位）：${m0.toFixed(0)}s → ${m1.toFixed(0)}s＝${((1 - m1 / m0) * 100).toFixed(1)}%`);
const cov = withPred.length / rows.length;
console.log(`覆蓋率加權後的整體中位：${(med(rows.map(r => r.err ?? r.errTrap))).toFixed(0)}s（覆蓋 ${(cov * 100).toFixed(1)}%）`);
