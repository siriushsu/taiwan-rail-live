// 08-19 尖峰:進站交棒修法的同時段雙開對照。
// 判準(全部外部事實,不與實作同源):
//  S 停住 = 同一台車連續 >=N 秒位移 <20m。官方停靠秒最長 45 秒 ⇒ 超過 75 秒就不是停站。
//  P 疊車 = 同線【同向】兩台 <300m 且持續 >=6 秒(跨線/反向一律不算,不同線常是不同月台)。
//  C 車數 = 不得比對照組少一成(否則是把車弄不見不是修好)。
import { chromium } from 'playwright';
import fs from 'node:fs';
const SEC = Number(process.argv[2] || 300);
const ARMS = [['CTL', process.argv[3]], ['FIX', process.argv[4]]];
const U = 'https://railisland.tw/';
async function arm(label, htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const b = await chromium.launch(); const p = await b.newPage();
  await p.route(u => { const x = new URL(u); return x.origin + x.pathname === new URL(U).origin + '/'; },
    r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await p.goto(U + '?g=metro', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 120000 });
  await p.evaluate(() => {
    window.__a = { ticks: 0, v: new Map(), pairs: new Map(), counts: [] };
    const hav = (a, b) => { const R = 6371000, r = Math.PI / 180;
      const df = (b.lat - a.lat) * r, dl = (b.lon - a.lon) * r, ph = (a.lat + b.lat) / 2 * r;
      return Math.hypot(df, dl * Math.cos(ph)) * R; };
    window.__aT = setInterval(() => {
      const now = Date.now() / 1000, A = window.__a; A.ticks++;
      const rows = [];
      for (const v of ((state.trtcOfficialRoster && state.trtcOfficialRoster.vehicles) || [])) {
        const ln = trtcCensusLine(v.line); if (!ln) continue;
        let info = null; try { info = trtcOfficialVehicleInfo(ln, v, now); } catch (e) { continue; }
        const pos = info && info.pos; if (!pos) continue;
        const id = String(v.vehicleId);
        // 🔴 判準修正(08-19):原本用「每秒位移 <20m」判停住——時速 60 公里的車每秒才走 16.7 公尺,
        // 這條對幾乎每台車恆真,於是 163 台裡量出「停住 172 台」。改成滑動窗的**淨位移**。
        const rec = A.v.get(id) || { line: v.line, pts: [], ticks: 0 };
        rec.pts.push({ t: A.ticks, lat: pos.lat, lon: pos.lon }); rec.ticks++;
        if (rec.pts.length > 400) rec.pts.shift();
        rec.no = v.officialNo == null ? '' : String(v.officialNo);
        rec.src = String(v.source || ''); rec.dest = v.dest;
        if (!rec.st) rec.st = [];
        const d = (typeof _trtcOfficialDisplay !== 'undefined')
          ? _trtcOfficialDisplay.get(`${ln.id}|${v.vehicleId}`) : null;
        if (rec.st.length < 400) rec.st.push([A.ticks, `${v.from}->${v.to}`,
          Math.round(Number(v.arrEpoch) - now), pos.atStation ? 'S' : '.', pos.coasted ? 'C' : '.',
          `${pos.motionFrom}->${pos.motionTo}`,
          d && Number.isFinite(Number(d.progress)) ? Number(d.progress).toFixed(2) : '—',
          d && d.dr ? String(d.dr.station) : '—',
          d && d.arrivedAt != null && Number.isFinite(d.arrivedAt) ? String(Math.round(now - d.arrivedAt)) : '—']);
        A.v.set(id, rec);
        rows.push({ id, line: v.line, step: trtcOfficialMotionStep(v, pos), pos, no: v.officialNo });
      }
      A.counts.push(rows.length);
      for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
        if (rows[i].line !== rows[j].line || rows[i].step !== rows[j].step) continue;
        const m = hav(rows[i].pos, rows[j].pos); if (m >= 300) continue;
        const pk = `${rows[i].line}|${[rows[i].id, rows[j].id].sort().join('~')}`;
        const c = A.pairs.get(pk) || { line: rows[i].line, n: 0, min: 1e9 };
        c.n++; c.min = Math.min(c.min, Math.round(m)); A.pairs.set(pk, c);
      }
    }, 1000);
  });
  await p.waitForTimeout(SEC * 1000);
  const r = await p.evaluate(() => { clearInterval(window.__aT);
    const hav = (a, b) => { const R = 6371000, r = Math.PI / 180;
      const df = (b.lat - a.lat) * r, dl = (b.lon - a.lon) * r, ph = (a.lat + b.lat) / 2 * r;
      return Math.hypot(df, dl * Math.cos(ph)) * R; };
    return { ticks: window.__a.ticks, counts: window.__a.counts,
      v: [...window.__a.v].map(([k, x]) => {
        // 🔴 判準修正 2(08-19):只比窗頭窗尾的淨位移會把**終點折返**整段算成停住——車開出去
        // 再折返回原處,頭尾距離 <20m,於是量出「停住 226 秒 / 在線 189 秒」這種比在線還久的鬼值。
        // 正解:窗內**每一點**都不得離窗頭 20m(真停住的車不會離開),且窗內時間必須連續
        // (車消失又出現的空檔不算它停在那裡)。
        let best = 0;
        for (let i = 0; i < x.pts.length; i++) {
          for (let j = i + 1; j < x.pts.length; j++) {
            if (x.pts[j].t - x.pts[j - 1].t !== 1) break;      // 中間掉過幀 ⇒ 這個窗不成立
            if (hav(x.pts[i], x.pts[j]) >= 20) break;          // 有任何一點跑掉 ⇒ 不是停住
            best = Math.max(best, x.pts[j].t - x.pts[i].t);
          }
        }
        return [k, { line: x.line, maxStill: best, ticks: x.ticks, no: x.no, src: x.src, dest: x.dest,
          st: best >= 75 ? x.st.filter((_, i) => i % 25 === 0).slice(0, 8) : [] }]; }),
      pairs: [...window.__a.pairs].map(([k, x]) => x) }; });
  await b.close(); return { label, ...r };
}
const out = await Promise.all(ARMS.map(([l, h]) => arm(l, h)));
const sum = r => {
  const avg = Math.round(r.counts.reduce((a, b) => a + b, 0) / Math.max(1, r.counts.length));
  const st = r.v.filter(([, x]) => x.maxStill >= 75);
  const byL = {}; for (const [, x] of st) byL[x.line] = (byL[x.line] || 0) + 1;
  const pr = r.pairs.filter(x => x.n >= 6);
  const pByL = {}; for (const x of pr) pByL[x.line] = (pByL[x.line] || 0) + 1;
  return { avg, stall: st.length, byL, pairs: pr.length, pByL,
    worstStill: Math.max(0, ...r.v.map(([, x]) => x.maxStill)),
    worstPair: pr.length ? Math.min(...pr.map(x => x.min)) : null };
};
for (const r of out) { const s = sum(r);
  console.log(`\n===== ${r.label}｜${r.ticks} 秒｜平均 ${s.avg} 台 =====`);
  console.log(`  S 停住 >=75 秒的車      ${s.stall} 台 ${JSON.stringify(s.byL)}｜最久 ${s.worstStill} 秒`);
  const d = r.v.map(([, x]) => x.maxStill).sort((a, b) => a - b);
  console.log(`  ─ 停住時長分布(驗判準有牙): 中位 ${d[Math.floor(d.length / 2)]}s  P90 ${d[Math.floor(d.length * .9)]}s  最大 ${d[d.length - 1]}s`);
  console.log(`  P 疊車(同線同向<300m)   ${s.pairs} 對 ${JSON.stringify(s.pByL)}｜最近 ${s.worstPair}m`); }
const [c, f] = out.map(sum);
console.log(`\n────── 判定 ──────`);
console.log(`停住  CTL ${c.stall} 台(最久${c.worstStill}s) → FIX ${f.stall} 台(最久${f.worstStill}s)  ` +
  (f.stall < c.stall ? '✅ 有改善' : f.stall === c.stall ? '＝ 沒差' : '❌ 更糟'));
console.log(`疊車  CTL ${c.pairs} 對 → FIX ${f.pairs} 對  ` +
  (f.pairs < c.pairs ? '✅ 有改善' : f.pairs === c.pairs ? '＝ 沒差' : '❌ 更糟'));
console.log(`車數  CTL ${c.avg} → FIX ${f.avg}  ` + (f.avg >= c.avg * 0.9 ? '✅ 沒把車弄不見' : '❌ 車變少'));
if (!c.stall && !c.pairs) console.log(`⚠️ 對照組零症狀 ⇒ 這一輪證明不了任何事`);
const SIDE = Number(process.env.DUMP_SIDE || 0);
const worst = out[SIDE].v.filter(([, x]) => x.maxStill >= 150).sort((a, b) => b[1].maxStill - a[1].maxStill).slice(0, 5);
console.log(`\n════ 停住最久的車在做什麼(${SIDE ? '修法組' : '對照組'}) ════`);
console.log(`   欄位: t 名冊段 倒數 raw在站/續推 raw畫的段 | 顯示進度 自走目標 到站幾秒前`);
for (const [id, x] of worst) {
  console.log(`\n▸ ${x.line} no=${x.no || '—'} src=${x.src} dest=${x.dest} 停住 ${x.maxStill}s / 在線 ${x.ticks}s`);
  for (const r of x.st) console.log(`    t=${String(r[0]).padStart(3)} 名冊段${r[1].padEnd(7)} 倒數${String(r[2]).padStart(5)}s ${r[3] === 'S' ? '在站上' : '段上  '} ${r[4] === 'C' ? '續推' : '官方'} 畫${r[5].padEnd(7)}｜顯示${String(r[6]).padStart(7)} 自走→${String(r[7]).padStart(3)} 到站${String(r[8]).padStart(4)}s前`);
}
