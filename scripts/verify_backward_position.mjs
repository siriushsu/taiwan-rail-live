// 驗使用者裁示的「倒數大於區段行駛秒 ⇒ 車在更前面的區段」有沒有真的把疊車與假停站修掉。
// 判準用外部事實,不用我們自己的模型:這個時段班距 5~6 分鐘,同線同向兩台相距 <1500m 是
// 物理上不可能的(使用者裁示「這個時段根本不可能會有兩輛車黏在一起」)。
import { chromium } from 'playwright';
import fs from 'node:fs';
const SEC = Number(process.argv[2] || 150);
const U = 'https://railisland.tw/';
const ARMS = [['CTL', process.argv[3], null], ['FIX', process.argv[4], process.argv[5]]];
const run = async (label, htmlPath, dataPath) => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const b = await chromium.launch(); const p = await b.newPage();
  await p.route(u => { const x = new URL(u); return x.origin + x.pathname === new URL(U).origin + '/'; },
    r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  if (dataPath) {
    const body = fs.readFileSync(dataPath, 'utf8');
    await p.route(u => new URL(u).pathname.endsWith('/data/trtc.json'),
      r => r.fulfill({ status: 200, contentType: 'application/json', body }));
  }
  await p.goto(U + '?g=metro', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 120000 });
  await p.evaluate(() => {
    window.__m = { ticks: 0, close: new Map(), parked: [], veh: [], ySeg: null };
    const hav = (a, b) => { const R = 6371000, r = Math.PI / 180;
      const df = (b.lat - a.lat) * r, dl = (b.lon - a.lon) * r, ph = (a.lat + b.lat) / 2 * r;
      return Math.hypot(df, dl * Math.cos(ph)) * R; };
    const snap = () => {
      const P = [];
      for (const v of ((state.trtcOfficialRoster && state.trtcOfficialRoster.vehicles) || [])) {
        const ln = trtcCensusLine(v.line); if (!ln) continue;
        if (window.__m.ySeg === null && v.line === 'Y') window.__m.ySeg = trtcCensusRun(ln, 0, 1);
        let info = null; try { info = trtcOfficialVehicleInfo(ln, v, Date.now() / 1000); } catch (e) { }
        const pos = info && info.pos; if (!pos || !Number.isFinite(pos.lat)) continue;
        const names = trtcCensusNames(ln) || [];
        P.push({ id: String(v.vehicleId), line: v.line, dir: v.dir, lat: pos.lat, lon: pos.lon,
          atSt: !!pos.atStation, no: v.officialNo, src: String(v.source || ''),
          from: names[v.from] || ('#' + v.from), at: names[v.to] || ('#' + v.to),
          cd: Number.isFinite(Number(v.arrEpoch)) ? Math.round(Number(v.arrEpoch) - Date.now() / 1000) : null });
      }
      window.__m.ticks++; window.__m.veh.push(P.length);
      window.__m.parked.push(P.filter(x => x.atSt).length);
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
        if (String(P[i].dir) !== String(P[j].dir)) continue;
        // 🔴 使用者裁示(08-18):兩條不同線即使共用實體軌道,也要當成不同路段,不算疊車。
        if (P[i].line !== P[j].line) continue;
        const d = hav(P[i], P[j]); if (d > 1500) continue;
        const k = [P[i].id, P[j].id].sort().join('~');
        const cur = window.__m.close.get(k);
        window.__m.close.set(k, { n: (cur ? cur.n : 0) + 1, min: Math.min(cur ? cur.min : 1e9, Math.round(d)),
          line: P[i].line, a: P[i], c: P[j] });
      }
    };
    snap(); window.__mTimer = setInterval(snap, 3000);
  });
  await p.waitForTimeout(SEC * 1000);
  const m = await p.evaluate(() => { clearInterval(window.__mTimer); return { ...window.__m, close: [...window.__m.close] }; });
  await b.close(); return { label, ...m };
};
const res = await Promise.all(ARMS.map(a => run(...a)));
const fail = [];
const maxTick = Math.max(...res.map(r => r.ticks));
for (const r of res) if (!(r.ticks >= maxTick * 0.85))
  fail.push(`G0 算力不均:${r.label} 只跑到 ${r.ticks} tick(最高 ${maxTick}) ⇒ 兩組不可比,本輪作廢`);
for (const r of res) {
  const avgVeh = Math.round(r.veh.reduce((a, b) => a + b, 0) / r.veh.length);
  const avgPark = Math.round(r.parked.reduce((a, b) => a + b, 0) / r.parked.length);
  const p300 = r.close.filter(([, v]) => v.min < 300 && v.n >= 2);
  const p150 = r.close.filter(([, v]) => v.min < 150 && v.n >= 2);
  r._p300 = p300.length; r._p150 = p150.length;
  const byLine = {}; for (const [, v] of p300) byLine[v.line] = (byLine[v.line] || 0) + 1;
  console.log(`${r.label}｜${r.ticks} 格｜平均 ${avgVeh} 台｜畫成停在站上 ${avgPark} 台` +
    `｜疊車 <300m ${p300.length} 對 ${JSON.stringify(byLine)}｜<150m ${p150.length} 對｜Y 段秒=${r.ySeg}`);
  for (const [, v] of p300.slice(0, 8)) {
    console.log(`      ${v.line} 最近 ${v.min}m 持續 ${v.n * 3}s`);
    for (const x of [v.a, v.c]) console.log(`         ${x.id} no=${x.no} ${x.from}→${x.at} 倒數${x.cd}s src=${x.src}${x.atSt ? ' 停在站上' : ''}`);
  }
}
const [ctl, fix] = res;
if (fix.ySeg === ctl.ySeg) fail.push(`G1 Y 的區間秒兩組相同(${fix.ySeg}) ⇒ 資料檔沒被換掉,本輪測的不是新資料`);
const cn = ctl._p300, fn = fix._p300;
if (fix.veh.reduce((a, b) => a + b, 0) / fix.veh.length < ctl.veh.reduce((a, b) => a + b, 0) / ctl.veh.length * 0.9)
  fail.push(`G2 FIX 的車比 CTL 少一成以上 ⇒ 不是修好是把車弄不見了`);
console.log(`\n疊車(<300m):CTL ${cn} 對 → FIX ${fn} 對　｜　<150m:CTL ${ctl._p150} → FIX ${fix._p150}`);
if (cn === 0) fail.push('G3 對照組本身就 0 對 ⇒ 這一輪沒有症狀可修,判準無從證明有效(換時段重跑)');
if (fail.length) { for (const f of fail) console.log('❌ ' + f); process.exit(1); }
console.log(fn < cn ? '✅ 有改善' : (fn === cn ? '⚠️ 沒有變化' : '❌ 變差'));
