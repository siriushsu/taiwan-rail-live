// 批次 3 第 5 項:兩段加速的【離線敏感度分析】。不改出貨碼,只回答「如果改成兩段,會發生什麼」。
//
// 方法上的一個刻意選擇:基準線不自己重寫,而是**把頁面真的建出來的剖面撈出來**——
// 自己重寫一份 buildProfile 當基準,等於拿我的重寫跟我的重寫比（心得 29:判準不得與實作同源）。
// 撈出來的 prof 物件帶 SI 單位的 a/b，可以直接反推它退到第幾層（1.4/1.5、1.4/2.7、2.0/2.7）。
// 兩段解則是真正的新碼,注入頁面後對**同一組 (L,T)** 重解,是蘋果對蘋果。
//
// 用法:VURL=http://127.0.0.1:6551/index.html node scripts/analyze_hsr_two_stage.mjs
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const VURL = process.env.VURL;
if (!VURL) { console.log('需要 VURL'); process.exit(2); }
const PROD_MD5 = '182fa7bb4ddbae5e2c288d9b2c84b60f';   // 2026-08-20 正式站 index.html
let fail = 0;
const ck = (ok, m) => { console.log((ok ? '  ✓ ' : '  ✗ ') + m); if (!ok) fail++; };

console.log('── G0 我在分析誰');
{
  const disk = createHash('md5').update(readFileSync(new URL('../index.html', import.meta.url))).digest('hex');
  const served = createHash('md5').update(Buffer.from(await (await fetch(VURL)).arrayBuffer())).digest('hex');
  ck(disk === served, `server 供的與磁碟同一份（${served}）`);
  ck(served === PROD_MD5, `而且＝正式站現行版（${PROD_MD5}）——分析的是真的在跑的模型`);
}

const br = await chromium.launch();
const pg = await br.newPage({ viewport: { width: 1280, height: 800 } });
await pg.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
await pg.goto(VURL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 500,
  null, { timeout: 60000 });

// ── 1. 把高鐵每一個跑段的 (L, T) 與現行解撈出來
const harvest = await pg.evaluate(() => {
  const sysObj = state.systems.find(x => x.id === 'thsr_sched');
  if (!sysObj) return { err: '找不到 thsr_sched' };
  if (state.sysId !== 'thsr_sched') loadSystem(sysObj);
  const P = PERF_HSR;
  const segs = [], seen = new Set(), byName = {};
  for (const tr of sysObj.data.trains) {
    const s = tr.stops;
    for (let i = 0; i < s.length - 1; i++) {
      const rp = s[i].rp;
      if (!rp || rp.obs) continue;                       // 高鐵不走實測剖面,保險起見排除
      const key = rp.L.toFixed(3) + '|' + rp.T;
      const pair = s[i].name + '→' + s[i + 1].name;
      if (seen.has(key)) { byName[key].trains.push(tr.train); continue; }
      seen.add(key);
      // 退到第幾層:prof 上的 a/b 是 SI(km/h/s ÷ 3.6),直接反推用了哪組參數
      const aK = rp.a * 3.6, bK = rp.b * 3.6;
      const tier = Math.abs(aK - P.a) < .01 && Math.abs(bK - P.b) < .01 ? 1
        : Math.abs(aK - P.a) < .01 && Math.abs(bK - P.bAlt) < .01 ? 2
        : Math.abs(aK - P.aAlt) < .01 && Math.abs(bK - P.bAlt) < .01 ? 3 : 0;
      const rec = { key, pair, trains: [tr.train], L: rp.L, T: rp.T, tier,
        depSec: s[i].depSec, arrSec: s[i + 1].arrSec,
        vc: rp.vc * 3.6, rho: rp.vb / rp.vc,
        tAcc: rp.tAcc, tCru: rp.tCru, tCoast: rp.tCoast, tDec: rp.tDec };
      byName[key] = rec; segs.push(rec);
    }
  }
  // 「退回線性」＝三層都解不出來 ⇒ 那個 stop 上根本沒有 rp。數一下有多少段是這種。
  let linear = 0, total = 0;
  for (const tr of sysObj.data.trains)
    for (let i = 0; i < tr.stops.length - 1; i++) { total++; if (!tr.stops[i].rp) linear++; }
  return { segs, linear, total, perf: { a: P.a, b: P.b, aAlt: P.aAlt, bAlt: P.bAlt, v: P.v, coast: P.coast } };
});
if (harvest.err) { console.log('❌ ' + harvest.err); process.exit(1); }
console.log(`\n── 撈到 ${harvest.segs.length} 個相異跑段（去重前 ${harvest.total} 段次；退回線性 ${harvest.linear}）`);
ck(harvest.segs.length > 20, `相異跑段數合理（${harvest.segs.length}）`);
ck(harvest.linear === 0, `現行模型退回線性 ${harvest.linear} 段（記憶說應為 0）`);
{
  const t = n => harvest.segs.filter(s => s.tier === n).length;
  console.log(`     退階分布：第一層(1.4/1.5) ${t(1)}｜第二層(1.4/2.7) ${t(2)}｜第三層(2.0/2.7) ${t(3)}｜認不出 ${t(0)}`);
}

// ── 2. 注入兩段解,對同一組 (L,T) 重解
const RESULT = await pg.evaluate(({ segs, perf, GRID }) => {
  // 兩段加速的封閉解。獨立推導（與計畫書的式子一致,但我自己重推過一次）:
  //   加速時間 = vc/a2 + Kt,  Kt = v1(1/a1 − 1/a2)
  //   加速距離 = vc²/(2a2) + Kd, Kd = (v1/2)·Kt
  //   ⇒ D2·vc² − (T − Kt)·vc + (L − Kd) = 0,  D2 = 1/(2a2) + (1−ρ)²/(2c) + ρ(2−ρ)/(2b)
  // vc ≤ v1 時第二段不存在 ⇒ 退回單段（用 a1）。
  function build2(Lm, T, a1K, a2K, v1K, bK, vK, coast) {
    const a1 = a1K / 3.6, a2 = a2K / 3.6, v1 = v1K / 3.6, b = bK / 3.6, vmax = vK / 3.6, L = Lm;
    if (!(L > 0) || !(T > 0) || !(a1 > 0) || !(a2 > 0) || !(b > 0)) return null;
    const cc = coast && coast.c > 0 ? coast.c / 3.6 : 0;
    const rho0 = cc > 0 && cc < b && coast.rho >= 0 && coast.rho < 1 ? coast.rho : 1;
    const Kt = v1 * (1 / a1 - 1 / a2), Kd = (v1 / 2) * Kt;
    const solve = rho => {
      const glide = rho < 1;
      const D2 = 1 / (2 * a2) + (glide ? (1 - rho) * (1 - rho) / (2 * cc) : 0) + rho * (2 - rho) / (2 * b);
      const Te = T - Kt, Le = L - Kd;
      const disc = Te * Te - 4 * D2 * Le;
      if (disc < 0) return null;
      const vc = (Te - Math.sqrt(disc)) / (2 * D2);
      if (!(vc > 0)) return null;
      if (vc <= v1) {                                   // 沒進到第二段 ⇒ 用單段 a1 重解（與現行同式）
        const D1 = 1 / (2 * a1) + (glide ? (1 - rho) * (1 - rho) / (2 * cc) : 0) + rho * (2 - rho) / (2 * b);
        const d1 = T * T - 4 * D1 * L;
        if (d1 < 0) return null;
        const v = (T - Math.sqrt(d1)) / (2 * D1);
        if (!(v > 0)) return null;
        const tA = v / a1, tC = glide ? v * (1 - rho) / cc : 0, tD = rho * v / b;
        const tCru = T - tA - tC - tD;
        return tCru >= 0 ? { vc: v, tAcc: tA, tCru, tCoast: tC, tDec: tD, oneStage: true } : null;
      }
      const tAcc = v1 / a1 + (vc - v1) / a2;
      const tCoast = glide ? vc * (1 - rho) / cc : 0, tDec = rho * vc / b;
      const tCru = T - tAcc - tCoast - tDec;
      if (!(tCru >= 0)) return null;
      return { vc, tAcc, tCru, tCoast, tDec, oneStage: false };
    };
    let prof = solve(1);
    if (!prof || prof.vc > vmax) return null;
    if (rho0 < 1) {
      const deep = solve(rho0);
      if (deep && deep.vc <= vmax) prof = deep;
      else {
        let lo = rho0, hi = 1;
        for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2, p = solve(mid); if (p && p.vc <= vmax) { hi = mid; prof = p; } else lo = mid; }
      }
    }
    return prof;
  }
  const out = [];
  for (const g of GRID) {
    const rows = [];
    for (const s of segs) {
      // 比照現行的三層退階,只是把加速換成兩段
      let p = build2(s.L, s.T, g.a1, g.a2, g.v1, perf.b, perf.v, perf.coast), tier = 1;
      if (!p) { p = build2(s.L, s.T, g.a1, g.a2, g.v1, perf.bAlt, perf.v, perf.coast); tier = 2; }
      if (!p) { p = build2(s.L, s.T, g.a1 * (perf.aAlt / perf.a), g.a2 * (perf.aAlt / perf.a), g.v1, perf.bAlt, perf.v, perf.coast); tier = 3; }
      // 🔴 另一種退階設計:只把【高速段】a2 逐級加硬,a1 不動。物理上比較說得通——
      // 排點最緊的段要的是高速段爬得快,不是起步爬得快;而且不會把「起步很猛」這個
      // 我們有實測的值(1.42)給改掉。逐級 ×1.5 最多七級(0.147→2.5),仍不行才算真的解不出。
      let p2 = build2(s.L, s.T, g.a1, g.a2, g.v1, perf.b, perf.v, perf.coast), lad = 0, a2x = g.a2;
      while (!p2 && lad < 7) { a2x *= 1.5; lad++; p2 = build2(s.L, s.T, g.a1, a2x, g.v1, perf.b, perf.v, perf.coast); }
      if (!p2) { let bb = perf.bAlt, a3 = g.a2; lad = 10; p2 = build2(s.L, s.T, g.a1, a3, g.v1, bb, perf.v, perf.coast);
        while (!p2 && lad < 17) { a3 *= 1.5; lad++; p2 = build2(s.L, s.T, g.a1, a3, g.v1, bb, perf.v, perf.coast); } }
      rows.push({ key: s.key, pair: s.pair, ok: !!p, tier: p ? tier : 0,
        vc: p ? p.vc * 3.6 : null, oneStage: p ? !!p.oneStage : null,
        ok2: !!p2, lad2: p2 ? lad : null, vc2: p2 ? p2.vc * 3.6 : null, a2used: p2 ? (lad >= 10 ? null : a2x) : null });
    }
    out.push({ g, rows });
  }
  return { out, build2Available: true };
}, { segs: harvest.segs, perf: harvest.perf, GRID: (() => {
  const G = [];
  for (const v1 of [160, 180, 195, 220])
    for (const a1 of [1.42])
      for (const a2 of [0.147, 0.25, 0.4, 0.6, 0.79, 1.0, 1.42])
        G.push({ v1, a1, a2 });
  return G;
})() });

// ── 3. 四個實測段:用車上讀數當外部判準
// 🔴 車上讀數幾乎全是【下界】不是平台。原始讀數（memory hsr-onboard-speed-calibration）:
//   18:45=280 18:46=295 | 19:08=300 19:15=285 19:16=195 19:18 到桃園
//   19:21:30=110 19:22:30=195 19:23:30=205 19:24:30=212 19:25:30=225 19:27:30=239
// 判斷是不是平台要看【連續兩點是否停止上升】。280→295 仍在升、239 仍在升（+0.2 km/h/s）。
// index.html 的註解與本計畫書 §3-2 都寫「桃園→板橋 實測 205→212、沒有在變快了」——那是
// 08-18 當下的誤讀,memory 事後訂正過（「我曾拿 212 對上模型的 213 宣稱差 1 km/h,兩分鐘後
// 它就爬到 239,那個吻合是假的」),但訂正沒有回寫到程式註解。本分析採 memory 的版本。
// 語意:lo=有把握的下界（模型低於它就是真的偏低）;plateau=是否觀察到停止上升。
// 🔴 讀數要對回哪一段,先確認車準不準點:讀數裡的「19:18 到桃園」與時刻表的桃園 arr 19:18
// 完全相符 ⇒ 這班準點,可以直接用時刻表把讀數切段。切下來的結果與 index.html 註解的表【不一致】:
//   台中(dep 18:36)→苗栗(arr 18:54):18:45=280、18:46=295  ⇒ 下界 295（仍在升,後面還有 8 分鐘）
//   苗栗(dep 18:56)→新竹(arr 19:07):【沒有乾淨讀數】。註解表寫的 295 其實是 18:46 那點,
//       那點在【台中→苗栗】段裡——整列借錯段了。
//   新竹(dep 19:08)→桃園(arr 19:18):19:15=285、19:16=195 ⇒ 下界 285（285→195/60s 恰為 b=1.5,
//       確認是煞車段,所以 285 是煞車前最後一點）
//   桃園(dep 19:20)→板橋(arr 19:31):110→239,19:27:30 仍以 +0.2 km/h/s 在爬 ⇒ 下界 239
//   19:08=300 這點對不上任何段（19:08 車正停在新竹）⇒ 判定為記時誤差,不採用。
// 故本分析只採三段,苗栗→新竹 標為無資料而不是硬塞一個借來的值。
const MEAS = [
  { pair: '台中→苗栗', lo: 295, plateau: false },
  { pair: '苗栗→新竹', lo: null, plateau: false },   // 無乾淨讀數,不參與判準
  { pair: '新竹→桃園', lo: 285, plateau: false },
  { pair: '桃園→板橋', lo: 239, plateau: false },
];
const base = new Map(harvest.segs.map(s => [s.key, s]));
// 🔴 只能取【0846 那一班自己的】排點。同一組站名在班表裡有 2–3 種不同的 (L,T)
// （直達車跳站、慢車多停），把它們一起拿去跟「某一天某一班車上的讀數」比，
// 量到的是班次之間的排點差異，不是模型誤差——第一版就是這樣，誤差中位被灌到 26.6、
// 最大 110.8 而且對所有參數組合幾乎不動（＝那個數字根本不隨受測參數變化，零資訊）。
const MEAS_TRAIN = '0846';
const measKeys = MEAS.map(m => {
  const hit = harvest.segs.filter(s => s.pair === m.pair && s.trains.includes(MEAS_TRAIN));
  return { ...m, keys: hit.map(s => s.key), n: hit.length };
});
console.log(`\n── 四個實測段（限 ${MEAS_TRAIN} 這一班自己的排點）`);
for (const m of measKeys) {
  const b = base.get(m.keys[0]);
  console.log(`     ${m.pair} ${m.lo == null ? '【無乾淨讀數,不參與判準】' : '實測下界 ' + m.lo}｜現行解出 ${b ? b.vc.toFixed(0) : '?'}` +
    (b ? `（L=${(b.L / 1000).toFixed(1)}km T=${b.T}s 平均${(b.L / b.T * 3.6).toFixed(0)}）` : ''));
  ck(m.n === 1, `${m.pair} 在 ${MEAS_TRAIN} 上恰好對到一段（實得 ${m.n}）`);
}
// 判準改成【違反下界的量】:讀數是下界,模型高於它並不算錯（真車還在爬,平台可能更高）,
// 模型【低於】它才是可證偽的偏低。用「誤差絕對值」會把「模型 284 vs 下界 239」記成錯 45,
// 那是把未知的上界當成已知——第一版就是這樣,還因此把最該修的長段誤判成第二名。
const shortfall = (v, m) => (v == null || m.lo == null) ? null : Math.max(0, m.lo - v);

const median = a => { const b = [...a].sort((x, y) => x - y); return b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };
const baseShort = measKeys.map(m => ({ pair: m.pair, s: shortfall(base.get(m.keys[0]).vc, m) })).filter(x => x.s != null);
const baseErr = Math.max(...baseShort.map(x => x.s));
const baseVcs = harvest.segs.map(s => s.vc);
console.log(`\n── 基準（現行單段 a=1.4）：巡航中位 ${median(baseVcs).toFixed(1)}｜` +
  `違反下界最大 ${baseErr.toFixed(1)} km/h（${baseShort.filter(x => x.s > 0).map(x => x.pair + ' 差' + x.s.toFixed(0)).join('、') || '無'}）`);

console.log('\n── 敏感度表（a1 固定 1.42＝我們的實測值）');
console.log('  v1   a2    可解  退階1/2/3  只用單段  巡航中位  巡航p10  巡航p90  違反下界總和  單段最大違反');
const table = [];
for (const { g, rows } of RESULT.out) {
  const ok = rows.filter(r => r.ok);
  const vcs = ok.map(r => r.vc).sort((a, b) => a - b);
  const p = q => vcs.length ? vcs[Math.min(vcs.length - 1, Math.floor(q * vcs.length))] : NaN;
  const byKey = new Map(rows.map(r => [r.key, r]));
  const errs = measKeys.map(m => { const r = byKey.get(m.keys[0]); return r && r.ok ? shortfall(r.vc, m) : null; }).filter(x => x != null);
  const t = n => rows.filter(r => r.tier === n).length;
  const ok2 = rows.filter(r => r.ok2);
  const errs2 = measKeys.map(m => { const r = byKey.get(m.keys[0]); return r && r.ok2 ? shortfall(r.vc2, m) : null; }).filter(x => x != null);
  const row = { v1: g.v1, a2: g.a2, solved: ok.length, n: rows.length, t1: t(1), t2: t(2), t3: t(3),
    solved2: ok2.length, noLadder: rows.filter(r => r.lad2 === 0).length,
    err2Max: errs2.length ? Math.max(...errs2) : NaN,
    one: ok.filter(r => r.oneStage).length, med: median(vcs), p10: p(.1), p90: p(.9),
    errMed: errs.length ? errs.reduce((a, b) => a + b, 0) : NaN, errMax: errs.length ? Math.max(...errs) : NaN };
  table.push(row);
  console.log(`  ${String(g.v1).padStart(3)} ${String(g.a2).padStart(5)} ${String(row.solved + '/' + row.n).padStart(8)}` +
    `  ${String(row.t1 + '/' + row.t2 + '/' + row.t3).padStart(9)}  ${String(row.one).padStart(8)}` +
    `  ${row.med.toFixed(1).padStart(8)} ${row.p10.toFixed(1).padStart(8)} ${row.p90.toFixed(1).padStart(8)}` +
    `  ${row.errMed.toFixed(1).padStart(14)} ${row.errMax.toFixed(1).padStart(9)}`);
}

writeFileSync(new URL('../scratch_hsr_two_stage.json', import.meta.url),
  JSON.stringify({ generatedFrom: PROD_MD5, base: { segs: harvest.segs, errMed: baseErr, vcMed: median(baseVcs) },
    meas: measKeys, grid: RESULT.out.map(o => ({ g: o.g, rows: o.rows })), table }, null, 1));
console.log('\n（逐段明細已寫到 scratch_hsr_two_stage.json）');

await br.close();
console.log(fail ? `\n❌ ${fail} 項前置失敗` : '\n✅ 前置全部成立');
process.exit(fail ? 1 : 0);
