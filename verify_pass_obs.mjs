// 驗收「通過站實測剖面」（快車跳站校正 Phase 2）。
// 設計原則：判準盡量取自與實作無關的來源——artifact 檔本身、HEAD 舊版行為、物理常數、不變式，
// 不用實作自己的中間值當真值（心得 29）。
//
// 用法：node verify_pass_obs.mjs [新版目錄] [基準目錄]
//   預設新版＝混樹隔離出的 verify worktree，基準＝另建的 HEAD worktree。
import { chromium, webkit } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import { spawn, execSync } from 'child_process';

const NEW_DIR = process.argv[2] || '/private/tmp/claude-501/-Users-xuxiang-Code------/9806cec5-61fe-410f-b75a-9046662eec7b/verify';
const BASE_DIR = process.argv[3] || '/private/tmp/claude-501/-Users-xuxiang-Code------/9806cec5-61fe-410f-b75a-9046662eec7b/verify_base';
const P_NEW = 8792, P_BASE = 8791;
let pass = 0, fail = 0; const fails = [];
const ok = (n, c, msg = '') => { if (c) { pass++; console.log(`  ✅ ${n}${msg ? ' — ' + msg : ''}`); } else { fail++; fails.push(n); console.log(`  ❌ ${n}${msg ? ' — ' + msg : ''}`); } };
const info = (n, msg) => console.log(`  ℹ️  ${n} — ${msg}`);
const med = a => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const q = (a, p) => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };

function serve(dir, port) {
  const p = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: dir, stdio: 'ignore' });
  return p;
}
const boot = async (browser, port, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs = [], resErrs = [];   // errs=程式錯誤;resErrs=資源載入失敗(本機無 /api、圖磚外連被擋→環境噪音)
  page.on('console', m => { if (m.type() !== 'error') return;
    const t = m.text().slice(0, 160);
    (/Failed to load resource|ERR_FAILED|ERR_CONNECTION|net::/.test(t) ? resErrs : errs).push(t); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 160)));
  if (opts.blockObs) await page.route('**/tra_pass_obs.json', r => r.abort());
  await page.goto(`http://127.0.0.1:${port}/index.html?g=nat`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 500, null, { timeout: 90000 });  // state 是 let,不在 window 上
  return { ctx, page, errs, resErrs };
};

// 頁內量測（同一段程式碼跑在新版與基準，差異才有意義）
const PROBE = () => {
  const R = { trains: 0, runs: 0, obsRuns: 0, sys: {}, samples: {}, endpoints: [], invMax: 0, speedMax: 0, nulls: 0, nan: 0 };
  const tra = state.trains.filter(t => t.sys === 'tra_sched');
  R.trains = tra.length;
  for (const t of state.trains) {
    let o = 0, r = 0;
    for (const st of t.stops) if (st.rp) { r++; if (st.rp.obs) o++; }
    R.runs += r; R.obsRuns += o;
    const k = t.sys || '?';
    R.sys[k] = R.sys[k] || { rp: 0, obs: 0 };
    R.sys[k].rp += r; R.sys[k].obs += o;
  }
  // 取樣位置（固定車次清單、固定時間網格 → 兩版可逐點比對）
  const pick = tra.filter(t => t.stops.some(s => s.stop === false)).slice(0, 80);
  for (const t of pick) {
    const s = t.stops, t0 = s[0].depSec, t1 = s[s.length - 1].arrSec;
    const arr = [];
    for (let tt = t0; tt <= t1; tt += 10) {
      const p = trainPos(t, tt);
      if (!p) { R.nulls++; arr.push(null); continue; }
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) { R.nan++; arr.push(null); continue; }
      arr.push([+p.lat.toFixed(6), +p.lon.toFixed(6)]);
    }
    R.samples[t.train] = arr;
    // 端點不變式：起訖站表定時刻不可被改動
    R.endpoints.push([t.train, s[0].depSec, s[s.length - 1].arrSec]);
  }
  // 反解一致性（有 obs 的跑段）＋速度上限
  const hav = (a, b) => { const rad = Math.PI / 180, dp = (b[0] - a[0]) * rad, dl = (b[1] - a[1]) * rad; const h = Math.sin(dp / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dl / 2) ** 2; return 2 * 6371.0088 * Math.asin(Math.sqrt(h)); };
  for (const t of pick) for (const st of t.stops) {
    if (!st.rp || !st.rp.obs) continue;
    for (const f of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      const tt = profProgToTime(st.rp, f), back = profTimeToProg(st.rp, tt);
      R.invMax = Math.max(R.invMax, Math.abs(back - f) * st.rp.L / 1000);   // 公里誤差
    }
  }
  for (const k in R.samples) {
    const a = R.samples[k];
    for (let i = 1; i < a.length; i++) if (a[i] && a[i - 1]) R.speedMax = Math.max(R.speedMax, hav(a[i - 1], a[i]) / (10 / 3600));
  }
  return R;
};

async function main() {
  if (!existsSync(BASE_DIR)) {
    execSync(`git worktree add --detach ${BASE_DIR} HEAD`, { cwd: '/Users/xuxiang/Code/捷運小動畫', stdio: 'ignore' });
  }
  const s1 = serve(NEW_DIR, P_NEW), s2 = serve(BASE_DIR, P_BASE);
  await new Promise(r => setTimeout(r, 1200));
  const art = JSON.parse(readFileSync(`${NEW_DIR}/data/tra_pass_obs.json`, 'utf8'));
  const browser = await chromium.launch();
  try {
    console.log('\n═══ Chromium：新版 vs 基準(HEAD) ═══');
    const N = await boot(browser, P_NEW), B = await boot(browser, P_BASE);
    const rn = await N.page.evaluate(PROBE), rb = await B.page.evaluate(PROBE);

    // G1 資料載入
    const cnt = await N.page.evaluate(() => state.passObs ? Object.keys(state.passObs).length : 0);
    ok('G1 artifact 載入', cnt === Object.keys(art.trains).length, `state.passObs ${cnt} 車次 = 檔案 ${Object.keys(art.trains).length}`);
    ok('G1b 基準版沒有這份資料', await B.page.evaluate(() => !state.passObs), '基準版 state.passObs 為 null/undefined');

    // G2 實測剖面實際生效
    ok('G2 實測剖面生效', rn.obsRuns > 2000 && rb.obsRuns === 0, `新版 obs 段 ${rn.obsRuns}／總 ${rn.runs}；基準 ${rb.obsRuns}`);
    const traObs = rn.sys.tra_sched?.obs || 0, otherObs = Object.entries(rn.sys).filter(([k]) => k !== 'tra_sched').reduce((a, [, v]) => a + v.obs, 0);
    ok('G3 只作用於台鐵', traObs > 0 && otherObs === 0, `台鐵 obs ${traObs}、其他系統 obs ${otherObs}`);

    // G4 回填時刻與 artifact 一致（抽 152 臺南→新營）
    const chk = await N.page.evaluate(() => {
      const t = state.trains.find(x => x.train === '152' && x.sys === 'tra_sched');
      const s = t.stops, i0 = s.findIndex(x => x.name === '臺南'), i1 = s.findIndex(x => x.name === '新營');
      const runDep = s[i0].depSec, runT = s[i1].arrSec - runDep;
      return { runDep, runT, mid: s.slice(i0 + 1, i1).map(x => [x.name, x.arrSec, x.depSec, x.rp ? !!x.rp.obs : null]) };
    });
    let bad = 0, worst = 0;
    for (const [name, arr] of chk.mid.map(m => [m[0], m[1]])) {
      const f = art.trains['152']?.[name]; if (f == null) continue;
      const want = chk.runDep + f / 1000 * chk.runT, d = Math.abs(arr - want);
      worst = Math.max(worst, d); if (d > 2) bad++;
    }
    ok('G4 通過站回填＝artifact 比例', bad === 0, `152 臺南→新營 9 站，最大偏差 ${worst.toFixed(1)}s`);
    ok('G4b 通過站到離同刻（維持既有語意）', chk.mid.every(m => m[1] === m[2]), '所有通過站 arrSec===depSec');

    // G5 端點不變式（表定時刻不可被實測剖面改動）
    const em = new Map(rb.endpoints.map(e => [e[0], e]));
    const epBad = rn.endpoints.filter(e => { const b = em.get(e[0]); return !b || b[1] !== e[1] || b[2] !== e[2]; });
    ok('G5 跑段端點表定時刻不變', epBad.length === 0, `${rn.endpoints.length} 車次比對，異動 ${epBad.length}`);

    // G6 連續性與物理
    ok('G6 無斷點/NaN', rn.nulls === rb.nulls && rn.nan === 0, `新版 null ${rn.nulls}(基準 ${rb.nulls})、NaN ${rn.nan}`);
    ok('G6b 取樣速度上限合理(<165)', rn.speedMax < 165, `新版最快 ${rn.speedMax.toFixed(0)} km/h（基準 ${rb.speedMax.toFixed(0)}）`);

    // G6c 節點級物理閘門：每個 obs 節點對的割線速度都要合台鐵實況（端點相鄰段含起停,更嚴）
    const kn = await N.page.evaluate(() => {
      let worstMid = 0, worstEnd = 0, n = 0, badMid = 0, badEnd = 0;
      for (const t of state.trains) for (const st of t.stops) { const p = st.rp;
        if (!p || !p.obs) continue;
        for (let i = 0; i < p.xs.length - 1; i++) {
          const v = (p.ys[i + 1] - p.ys[i]) / (p.xs[i + 1] - p.xs[i]) * 3.6; n++;
          if (i === 0 || i === p.xs.length - 2) { if (v > worstEnd) worstEnd = v; if (v > 115.5) badEnd++; }
          else { if (v > worstMid) worstMid = v; if (v > 135.5) badMid++; }
        } }
      return { worstMid: +worstMid.toFixed(1), worstEnd: +worstEnd.toFixed(1), n, badMid, badEnd };
    });
    ok('G6c 節點割線速度合物理', kn.badMid === 0 && kn.badEnd === 0,
      `${kn.n} 個節點對：中段最快 ${kn.worstMid}、起停段最快 ${kn.worstEnd} km/h（超標 ${kn.badMid + kn.badEnd}）`);

    // G7 反解一致性
    ok('G7 profProgToTime 反解一致', rn.invMax < 0.02, `最大來回誤差 ${(rn.invMax * 1000).toFixed(1)} 公尺`);

    // G8 改動量級（不是通過就好，要看真的動了多少）
    const diffs = [];
    for (const k in rn.samples) {
      const a = rn.samples[k], b = rb.samples[k]; if (!b) continue;
      for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] && b[i]) {
        const rad = Math.PI / 180, dp = (b[i][0] - a[i][0]) * rad, dl = (b[i][1] - a[i][1]) * rad;
        const h = Math.sin(dp / 2) ** 2 + Math.cos(a[i][0] * rad) * Math.cos(b[i][0] * rad) * Math.sin(dl / 2) ** 2;
        diffs.push(2 * 6371.0088 * Math.asin(Math.sqrt(h)));
      }
    }
    info('G8 與基準的位置差', `n=${diffs.length} 中位 ${med(diffs).toFixed(2)}km p90 ${q(diffs, .9).toFixed(2)}km 最大 ${Math.max(...diffs).toFixed(2)}km`);
    ok('G8 有實質改動但不離譜', med(diffs) > 0.01 && q(diffs, .99) < 12, `p99 ${q(diffs, .99).toFixed(2)}km`);

    // G9 非台鐵逐點零差異
    const hsrDiff = await Promise.all([N, B].map(x => x.page.evaluate(() => {
      const out = {};
      for (const t of state.trains.filter(t => t.sys !== 'tra_sched').slice(0, 20)) {
        const s = t.stops, a = [];
        for (let tt = s[0].depSec; tt <= s[s.length - 1].arrSec; tt += 30) { const p = trainPos(t, tt); a.push(p ? [+p.lat.toFixed(7), +p.lon.toFixed(7)] : null); }
        out[t.sys + '|' + t.train] = a;
      }
      return out;
    })));
    let hsrBad = 0, hsrN = 0;
    for (const k in hsrDiff[0]) { const a = hsrDiff[0][k], b = hsrDiff[1][k] || []; for (let i = 0; i < a.length; i++) { hsrN++; if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) hsrBad++; } }
    ok('G9 高鐵/林鐵逐點與基準完全相同', hsrBad === 0, `${hsrN} 點比對，差異 ${hsrBad}`);

    // G10 缺檔優雅退回
    const F = await boot(browser, P_NEW, { blockObs: true });
    const rf = await F.page.evaluate(PROBE);
    ok('G10 缺檔退回梯形', rf.obsRuns === 0 && rf.trains === rn.trains && rf.nan === 0, `obs 段 ${rf.obsRuns}、車次 ${rf.trains}`);
    let fbBad = 0, fbN = 0;
    for (const k in rf.samples) { const a = rf.samples[k], b = rb.samples[k] || []; for (let i = 0; i < a.length; i++) { fbN++; if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) fbBad++; } }
    ok('G10b 退回後與基準逐點相同', fbBad === 0, `${fbN} 點比對，差異 ${fbBad}`);
    ok('G10c 缺檔無 console 錯誤', F.errs.length === 0, F.errs.slice(0, 2).join(' / ') || '無');
    await F.ctx.close();

    // G11 效能
    const perf = async (page) => page.evaluate(() => {
      const tra = state.trains.filter(t => t.sys === 'tra_sched').slice(0, 200);
      const t0 = performance.now();
      for (let k = 0; k < 20; k++) for (const t of tra) trainPos(t, t.stops[0].depSec + (t.stops[t.stops.length - 1].arrSec - t.stops[0].depSec) * (k / 20));
      return performance.now() - t0;
    });
    const pn = await perf(N.page), pb = await perf(B.page);
    ok('G11 trainPos 效能未退化', pn < pb * 1.6 + 5, `新版 ${pn.toFixed(0)}ms vs 基準 ${pb.toFixed(0)}ms（4000 次呼叫）`);

    ok('G12 無 console 錯誤', N.errs.length === 0, N.errs.slice(0, 2).join(' / ') || '無');

    // G13 手機寬度冒煙
    const M = await boot(browser, P_NEW, { viewport: { width: 390, height: 844 } });
    const mo = await M.page.evaluate(() => ({ obs: state.trains.reduce((a, t) => a + t.stops.filter(s => s.rp && s.rp.obs).length, 0), n: state.trains.length }));
    ok('G13 手機 390 正常載入且剖面生效', mo.obs > 1000 && M.errs.length === 0, `obs 段 ${mo.obs}、車次 ${mo.n}、錯誤 ${M.errs.length}`);
    await M.ctx.close();
    await N.ctx.close(); await B.ctx.close();
  } finally { await browser.close(); }

  // WebKit 覆核核心項
  const wb = await webkit.launch();
  try {
    console.log('\n═══ WebKit ═══');
    const W = await boot(wb, P_NEW);
    const rw = await W.page.evaluate(PROBE);
    ok('G14 WebKit 剖面生效且無 NaN', rw.obsRuns > 2000 && rw.nan === 0 && W.errs.length === 0, `obs 段 ${rw.obsRuns}、NaN ${rw.nan}、錯誤 ${W.errs.length}`);
    ok('G14b WebKit 速度上限合理(<165)', rw.speedMax < 165, `最快 ${rw.speedMax.toFixed(0)} km/h`);
    await W.ctx.close();
  } finally { await wb.close(); }

  s1.kill(); s2.kill();
  console.log(`\n═══ 結果：${pass} 通過 / ${fail} 失敗 ═══`);
  if (fails.length) console.log('失敗項：' + fails.join('、'));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('驗收腳本異常：', e); process.exit(2); });
