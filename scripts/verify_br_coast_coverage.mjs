#!/usr/bin/env node
// 文湖線「缺訊續推」驗收。一次只動一個變因:兩組都是同一份 index.html,
// 對照組只把續推那一行關掉(if (matched[k]) continue; → 恆 continue)。API 都走正式站 ⇒ 同一份即時資料。
//
// 判準(全部要過):
//  G1 不得提早消失:一台車最後一次出現時,它的 to 必須等於官方講的 dest(＝真的跑到終點才收車)。
//     這是使用者裁示「終點車我們用前一站的時間繼續往下推」「到終點站車子就拿掉」的直接翻譯。
//     不用「台數缺口」當判準:相對 CarWeightBR 的 2.5 台缺口幾乎都是在終點站折返中的車,
//     那批依裁示本來就不該畫,拿它當目標會逼續推去補不該補的車。
//  G2 不得倒退:同一個 vehicleId 沿行進方向不得往回(容許半個站間的 along 抖動)。
//  G3 不得疊車:同一方向同一區間不得同時有兩台。
//  G4 不得跑掉:續推車不得超過官方講的終點站。
//  G5 分母閘門:每組每輪都要真的取到 BR 車,取不到直接 FAIL(避免空集合假綠)。
import { chromium } from 'playwright';
import fs from 'node:fs';
const URL = 'https://railisland.tw/';
const N = Number(process.argv.find(a => /^\d+$/.test(a)) || 10), GAP = 15;
const CUR = fs.readFileSync('index.html', 'utf8');
const ANCHOR = '      if (matched[k]) continue;';
if (!CUR.includes(ANCHOR)) { console.log('❌ 找不到續推開關的錨點,腳本與程式碼脫節'); process.exit(2); }
let code = CUR;
if (process.argv.includes('--mut-no-retire')) { // 突變:拿掉「到終點站就收車」,確認 G4 真的有牙
  const a = '      if (to === e.dest) return null;                       // 到終點站,車子拿掉';
  if (!code.includes(a)) { console.log('❌ 突變錨點找不到'); process.exit(2); }
  code = code.replace(a, '      if (false) return null;');
}
if (process.argv.includes('--mut-no-ceiling')) { // 突變:拿掉「不准跨過前車」,確認 G3 真的有牙
  const a = '      if (ceil != null && nxt * step > ceil * step) { held = true; break; } // 不准進前車的區間,停在站上等';
  if (!code.includes(a)) { console.log('❌ 突變錨點找不到'); process.exit(2); }
  code = code.replace(a, '      if (false) { held = true; break; }');
}
const ARMS = [['對照(不續推)', code.replace(ANCHOR, '      if (matched[k] || 1) continue;')], ['續推　　　', code]];

async function run(html, label) {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.route(u => { const x = new globalThis.URL(u); return x.origin + x.pathname === new globalThis.URL(URL).origin + '/'; },
    r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 90000 });
  const snaps = [];
  for (let i = 0; i < N; i++) {
    const vs = await p.evaluate(() => ((state.trtcOfficialRoster && state.trtcOfficialRoster.vehicles) || [])
      .filter(v => String(v.line) === 'BR')
      .map(v => ({ id: String(v.vehicleId), dir: Number(v.dir), from: Number(v.from), to: Number(v.to),
        dest: Number(v.dest), run: Number(v.run), arr: Number(v.arrEpoch), src: String(v.source || '') })));
    let cw = null;
    try {
      const r = await (await fetch(URL + 'api/trtc-live', { headers: { 'Cache-Control': 'no-cache' } })).json();
      cw = r && r.cd && r.cd.brSeg ? Number(r.cd.brSeg.cwRows) : null;
    } catch { /* 量不到就不計入分母 */ }
    snaps.push({ at: Date.now() / 1000, cw, vs });
    if (i < N - 1) await p.waitForTimeout(GAP * 1000);
  }
  await b.close();
  if (errs.length) console.log(`   ⚠️ ${label} 頁面例外:`, errs[0]);
  return snaps;
}
const along = (v, now) => {
  const step = v.dir === 2 ? 1 : -1;
  const left = v.run > 0 ? Math.max(0, Math.min(1, (v.arr - now) / v.run)) : 0;
  return (v.to - step * left) * step;
};
function score(snaps, label) {
  let back = 0, pairs = 0, clump = 0, slots = 0, past = 0, emptyRounds = 0, coasted = 0, total = 0;
  const counts = [], cws = [], clumpSamples = [];
  for (const s of snaps) {
    if (!s.vs.length) { emptyRounds++; continue; }   // 暖機輪(資料還沒到)不計入任何統計
    counts.push(s.vs.length); if (Number.isFinite(s.cw)) cws.push(s.cw);
    for (const v of s.vs) { total++; if (v.src === 'board-coast') coasted++; }
    for (const dir of [1, 2]) {
      const d = s.vs.filter(v => v.dir === dir), seg = new Map();
      for (const v of d) { const k = `${v.from}>${v.to}`; if (!seg.has(k)) seg.set(k, []); seg.get(k).push(v); }
      for (const [k, list] of seg) {
        slots++;
        if (list.length > 1) {
          clump++;
          if (clumpSamples.length < 5) clumpSamples.push(`輪${snaps.indexOf(s)} dir${dir} ${k}：` +
            list.map(v => `${v.id.slice(-4)}(${v.src},dest=${v.dest},剩${Math.round(v.arr - s.at)}s)`).join(' + '));
        }
      }
      for (const v of d) { const step = dir === 2 ? 1 : -1; if ((v.to - v.dest) * step > 0) past++; }
    }
  }
  // 提早消失:某個 id 最後一次被看到時還沒到 dest。末尾兩輪不算(可能只是還沒推完)。
  const lastSeen = new Map();
  snaps.forEach((s, i) => { for (const v of s.vs) lastSeen.set(v.id, { i, v }); });
  let early = 0, ended = 0;
  const earlySamples = [];
  for (const [id, o] of lastSeen) {
    if (o.i >= snaps.length - 2) continue;               // 還在畫面上,不算結束
    ended++;
    const step = o.v.dir === 2 ? 1 : -1;
    if ((o.v.dest - o.v.to) * step > 0) { early++; if (earlySamples.length < 4) earlySamples.push(`${id.slice(-4)} 停在 ${o.v.to} 但 dest=${o.v.dest}`); }
  }
  const rejoin = [];
  for (let i = 1; i < snaps.length; i++) {
    const prev = new Map(snaps[i - 1].vs.map(v => [v.id, v]));
    for (const y of snaps[i].vs) {
      const x = prev.get(y.id); if (!x) continue;
      pairs++;
      if (along(y, snaps[i].at) < along(x, snaps[i - 1].at) - 0.5) back++;
      // 上一輪是續推、這一輪官方又看到了 ⇒ 量我們推的位置與官方位置差多少(目標:對得上)
      if (x.src === 'board-coast' && y.src !== 'board-coast')
        rejoin.push(Math.abs(along(y, snaps[i].at) - along(x, snaps[i - 1].at)));
    }
  }
  const avg = a => a.length ? a.reduce((p, q) => p + q, 0) / a.length : NaN;
  const r = { label, n: avg(counts), cw: avg(cws), back, pairs, clump, slots, past, emptyRounds, coasted, total, rejoin, early, ended, earlySamples, clumpSamples };
  r.gap = r.cw - r.n;
  console.log(`  ${label}：畫面 ${r.n.toFixed(1)} 台　CarWeightBR ${r.cw.toFixed(1)} 組　缺口 ${r.gap.toFixed(1)}　倒退 ${back}/${pairs}　疊車 ${clump}/${slots}　超過終點 ${past}　提早消失 ${early}/${ended}　續推車 ${coasted}/${total}　接回誤差 ${rejoin.length ? (rejoin.reduce((p, q) => p + q, 0) / rejoin.length).toFixed(2) + '站×' + rejoin.length : '無樣本'}`);
  return r;
}
console.log(`文湖線缺訊續推驗收：${N} 輪 × ${GAP}s，兩組同一份程式碼只差續推開關`);
const res = [];
for (const [label, html] of ARMS) res.push(score(await run(html, label), label));
const [ctl, on] = res;
const fail = [];
if (on.emptyRounds > 1 || ctl.emptyRounds > 1) fail.push('G5 分母:有非暖機輪完全沒取到 BR 車');
if (on.total < 8 * (N - 1) || ctl.total < 8 * (N - 1)) fail.push('G5 分母:取到的車次數過少,統計無意義');
if (!Number.isFinite(on.gap) || !Number.isFinite(ctl.gap)) fail.push('G5 分母:CarWeightBR 基準量不到');
if (!ctl.ended || !on.ended) fail.push('G1 分母:這段時間沒有任何車跑完,判準量不到東西(跑久一點)');
else if (on.early > 0) fail.push(`G1 續推組仍有 ${on.early}/${on.ended} 台在到終點前就消失：${on.earlySamples.join('；')}`);
else if (ctl.early === 0) fail.push('G1 對照組也零提早消失 ⇒ 這段時間沒有可修的目標,判準沒被驗到(跑久一點或換時段)');
if (on.back > 0) fail.push(`G2 續推組出現倒退 ${on.back} 台次`);
if (on.clump > 0) fail.push(`G3 續推組出現疊車 ${on.clump} 組：${on.clumpSamples.join('｜')}`);
if (on.past > 0) fail.push(`G4 續推組有車跑過官方終點站 ${on.past} 次`);
if (on.rejoin.length && Math.max(...on.rejoin) > 1)
  fail.push(`G6 續推車被官方重新看到時位置對不上,最差差 ${Math.max(...on.rejoin).toFixed(2)} 個站間`);
console.log('');
if (fail.length) { console.log('❌ 未通過：'); for (const f of fail) console.log('   - ' + f); process.exit(1); }
console.log(`✅ 全過：缺口 ${ctl.gap.toFixed(1)} → ${on.gap.toFixed(1)} 台，倒退 0、疊車 0、超過終點 0`);
