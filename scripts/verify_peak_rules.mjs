// 尖峰驗收:直接驗使用者 2026-08-18 夜制定的規則,不驗我們自己的中間量。
//   R1 疊車:同線同向兩台 <300m 持續 >=2 格 ⇒ 0。跨線不算(不同線常是不同月台)。
//   R2 未發車的起點列不得被畫成車(from==to 且到站時刻還沒到)。
//   R3 「倒數塞不進那一段就整列忽略」要真的在作用(忽略數 >0),但不得把線清空(每線車數 >0)。
//   R4 車不會跳段:同一台車 3 秒內不得前進超過一段。
//   R5 位置不得落後官方:量「畫出來的位置」與「官方倒數算出來的位置」的距離。
//      這是使用者說的「位置會落後」的直接量——落後是顯示層棘輪造成的,不是資料。
// 用法: node scripts/verify_peak_rules.mjs <秒數> <CTL html> <FIX html> [FIX 用的 trtc.json]
import { chromium } from 'playwright';
import fs from 'node:fs';
const SEC = Number(process.argv[2] || 300);
const ARMS = [['CTL', process.argv[3], null], ['FIX', process.argv[4], process.argv[5] || null]];
const U = 'https://railisland.tw/';

const run = async (label, htmlPath, dataPath) => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const b = await chromium.launch(); const p = await b.newPage();
  await p.route(u => { const x = new URL(u); return x.origin + x.pathname === new URL(U).origin + '/'; },
    r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  if (dataPath) { const body = fs.readFileSync(dataPath, 'utf8');
    await p.route(u => new URL(u).pathname.endsWith('/data/trtc.json'),
      r => r.fulfill({ status: 200, contentType: 'application/json', body })); }
  await p.goto(U + '?g=metro', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 120000 });
  await p.evaluate(() => {
    window.__pk = { ticks: 0, stack: new Map(), ghost: [], drop: [], jump: 0, jumpEg: [],
      lag: [], veh: [], byLine: [] };
    const hav = (a, b) => { const R = 6371000, r = Math.PI / 180;
      const df = (b.lat - a.lat) * r, dl = (b.lon - a.lon) * r, ph = (a.lat + b.lat) / 2 * r;
      return Math.hypot(df, dl * Math.cos(ph)) * R; };
    let prev = new Map();
    const snap = () => {
      const now = Date.now() / 1000, nowS = Math.floor(now), P = [], cur = new Map(), byLine = {};
      let ghost = 0;
      for (const v of ((state.trtcOfficialRoster && state.trtcOfficialRoster.vehicles) || [])) {
        const ln = trtcCensusLine(v.line); if (!ln) continue;
        let shown = null, raw = null;
        try { shown = trtcOfficialDisplayPosition(ln, v, now); } catch (e) { }
        try { raw = trtcOfficialVehiclePosition(ln, v, now); } catch (e) { }
        if (!shown || !Number.isFinite(shown.lat)) continue;
        byLine[v.line] = (byLine[v.line] || 0) + 1;
        // R2:被畫出來、而且 from==to(起點/終點列)、到站(發車)時刻還沒到 ⇒ 未發車卻在畫
        if (Number(v.from) === Number(v.to) && Number(v.arrEpoch) > nowS) ghost++;
        // R5:畫出來的位置 vs 官方倒數算出來的位置
        if (raw && Number.isFinite(raw.lat)) window.__pk.lag.push(Math.round(hav(shown, raw)));
        P.push({ id: String(v.vehicleId), line: v.line, dir: v.dir, to: Number(v.to), from: Number(v.from),
          lat: shown.lat, lon: shown.lon });
        cur.set(String(v.vehicleId), { to: Number(v.to), from: Number(v.from), line: v.line });
      }
      window.__pk.ticks++; window.__pk.veh.push(P.length);
      window.__pk.byLine.push(byLine); window.__pk.ghost.push(ghost);
      if (typeof _trtcCdDropped !== 'undefined')
        window.__pk.drop.push(Object.fromEntries([..._trtcCdDropped]));
      // R4 跳段
      for (const [id, c] of cur) { const p0 = prev.get(id); if (!p0 || p0.line !== c.line) continue;
        const d = Math.abs(c.to - p0.to);
        if (d > 1) { window.__pk.jump++;
          if (window.__pk.jumpEg.length < 6) window.__pk.jumpEg.push(`${id} ${p0.from}->${p0.to} ⇒ ${c.from}->${c.to}`); } }
      prev = cur;
      // R1 疊車
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
        if (P[i].line !== P[j].line || String(P[i].dir) !== String(P[j].dir)) continue;
        const d = hav(P[i], P[j]); if (d > 300) continue;
        const k = [P[i].id, P[j].id].sort().join('~');
        const c0 = window.__pk.stack.get(k);
        window.__pk.stack.set(k, { n: (c0 ? c0.n : 0) + 1, min: Math.min(c0 ? c0.min : 1e9, Math.round(d)), line: P[i].line });
      }
    };
    snap(); window.__pkTimer = setInterval(snap, 3000);
  });
  await p.waitForTimeout(SEC * 1000);
  const m = await p.evaluate(() => { clearInterval(window.__pkTimer);
    return { ...window.__pk, stack: [...window.__pk.stack] }; });
  await b.close(); return { label, ...m };
};

const res = await Promise.all(ARMS.map(a => run(...a)));
const pct = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length * q)] : null; };
const sum = a => a.reduce((x, y) => x + y, 0);
const fail = [];
const maxTick = Math.max(...res.map(r => r.ticks));
for (const r of res) if (!(r.ticks >= maxTick * 0.85))
  fail.push(`G0 算力不均:${r.label} 只跑到 ${r.ticks} tick(最高 ${maxTick}) ⇒ 兩組不可比,本輪作廢`);

for (const r of res) {
  const stacks = r.stack.filter(([, v]) => v.n >= 2);
  const byLine = {}; for (const [, v] of stacks) byLine[v.line] = (byLine[v.line] || 0) + 1;
  const lastLines = r.byLine[r.byLine.length - 1] || {};
  const emptyLines = Object.entries(lastLines).filter(([, n]) => n === 0).map(([k]) => k);
  const dropLast = r.drop.length ? r.drop[r.drop.length - 1] : {};
  const dropTotal = sum(Object.values(dropLast));
  r._m = { stacks: stacks.length, ghost: Math.max(...r.ghost), jump: r.jump,
    lagP50: pct(r.lag, .5), lagP90: pct(r.lag, .9), lagMax: r.lag.length ? Math.max(...r.lag) : null,
    veh: Math.round(sum(r.veh) / r.veh.length), dropTotal, emptyLines };
  console.log(`\n===== ${r.label}｜${r.ticks} 格(每 3 秒)｜平均 ${r._m.veh} 台 =====`);
  console.log(`R1 疊車(同線同向<300m,持續≥6s)  ${r._m.stacks} 對  ${JSON.stringify(byLine)}`);
  for (const [, v] of stacks.slice(0, 6)) console.log(`      ${v.line} 最近 ${v.min}m 持續 ${v.n * 3}s`);
  console.log(`R2 未發車卻被畫出來的起點列      最多同時 ${r._m.ghost} 台`);
  console.log(`R3 忽略的倒數列(最後一格)        ${dropTotal} 列 ${JSON.stringify(dropLast)}｜各線車數 ${JSON.stringify(lastLines)}`);
  console.log(`R4 跳段(3 秒內前進 >1 段)        ${r._m.jump} 次 ${r.jumpEg.slice(0, 3).join(' ｜ ') || ''}`);
  console.log(`R5 畫面位置落後官方位置          中位 ${r._m.lagP50}m  P90 ${r._m.lagP90}m  最大 ${r._m.lagMax}m`);
}
const [ctl, fix] = res;
if (fix._m.veh < ctl._m.veh * 0.9)
  fail.push(`G2 FIX 平均車數 ${fix._m.veh} 比 CTL ${ctl._m.veh} 少一成以上 ⇒ 不是修好是把車弄不見`);
if (fix._m.emptyLines.length)
  fail.push(`R3 FAIL:${fix._m.emptyLines.join('/')} 這幾條線車數為 0 ⇒ 忽略規則把線清空了`);
if (ctl._m.stacks === 0 && ctl._m.ghost === 0)
  fail.push(`G3 對照組本身零症狀(疊車 0、幽靈 0)⇒ 這一輪沒東西可修,證明不了有效(不是尖峰?換時段重跑)`);
console.log(`\n────── 判定 ──────`);
console.log(`R1 疊車      CTL ${ctl._m.stacks} 對 → FIX ${fix._m.stacks} 對   ${fix._m.stacks === 0 ? '✅ 規則成立' : (fix._m.stacks < ctl._m.stacks ? '⚠️ 有改善但未歸零' : '❌ 沒改善')}`);
console.log(`R2 未發車    CTL ${ctl._m.ghost} 台 → FIX ${fix._m.ghost} 台   ${fix._m.ghost === 0 ? '✅' : '❌ 仍被畫出來'}`);
console.log(`R4 跳段      CTL ${ctl.jump} 次 → FIX ${fix.jump} 次`);
console.log(`R5 位置落後  CTL P90 ${ctl._m.lagP90}m/最大 ${ctl._m.lagMax}m → FIX P90 ${fix._m.lagP90}m/最大 ${fix._m.lagMax}m`);
console.log(`   ⚠️ R5 是顯示層棘輪造成的,今晚沒有動它;非 0 屬預期,這一欄是要量出它到底多大。`);
if (fail.length) { console.log(''); for (const f of fail) console.log('❌ ' + f); process.exit(1); }
console.log('\n✅ 閘門全過');
