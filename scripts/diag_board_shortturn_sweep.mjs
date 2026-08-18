// 全北捷看板線逐站盤查：班表補列裡有沒有「加班車／短程車被提前排進來」。
//
// 使用者 2026-08-17 先回報松江南京同時出現兩列「往台電大樓」（61 分／77 分），
// 隨後回報「藍線同樣有加班車提前排進班表的問題，這個需要你全部檢查一次」。
//
// 判準（不寫死分鐘數）：
//   A. 補列的目的地是不是該線的**正常終點**（線的頭尾兩站）。不是 ⇒ 短程／加班車終點。
//   B. 補列的倒數有沒有超過該線當下班距的三倍（現行窗）。
//   C. 對照「舊窗 7200 秒」會收哪些 ⇒ 證明現行窗真的有在砍，不是資料剛好沒有。
// 只印事實，不做判定；每一列都標明官方即時列 vs 班表補列。
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://127.0.0.1:5399/';
const b = await chromium.launch();
const p = await b.newPage();
p.on('pageerror', e => console.log('❌ pageerror：' + e.message));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 90000 });
await p.evaluate(() => {
  const g = (typeof GROUPS !== 'undefined' ? GROUPS : []).find(x => (x.members || []).includes('mrt'));
  if (g) selectGroup(g);
});
await p.waitForTimeout(4000);

const r = await p.evaluate(() => {
  const lines = state.lines || [];
  const boardLines = lines.filter(ln => typeof isTrtcBoardLine === 'function' && isTrtcBoardLine(ln));
  const out = [];
  for (const ln of boardLines) {
    const sts = ln.stations || [];
    const termini = new Set([sts[0] && sts[0].name, sts[sts.length - 1] && sts[sts.length - 1].name].filter(Boolean));
    const hw = (typeof headwayOf === 'function' ? headwayOf(ln, state.simSec / 3600) : 600) || 600;
    const rec = { line: ln.id, abbr: ln.abbr, hw, termini: [...termini], stations: sts.length,
      rows: [], oldWindow: [], removedByTerminus: [] };
    for (let si = 0; si < sts.length; si++) {
      let view = null;
      try { view = trtcOfficialBoardView(sts[si], lines, false); } catch (e) { continue; }
      if (!view) continue;
      for (const g of (view.groups || [])) {
        if (!g.ln || g.ln.id !== ln.id) continue;
        if (g.kind === 'official') continue;   // 官方即時列不在本次盤查範圍
        for (const row of (g.rows || []))
          rec.rows.push({ st: sts[si].name, dest: g.destName, sec: Math.round(row.dtm),
            shortTurn: !termini.has(g.destName) });
      }
      // 對照組：舊窗（7200s）會收、現行窗（3×班距）排除的補列
      if (ln._tt) {
        const best = new Map();
        for (const trip of ln._tt) {
          let i = -1;
          for (let k = 0; k < trip.length; k += 2) if (trip[k] === si) { i = k; break; }
          if (i < 0 || i === trip.length - 2) continue;
          const destName = sts[trip[trip.length - 2]].name;
          let dtm = trip[i + 1] + metroShiftSec(ln, trip) - state.simSec;
          if (dtm > 43200) dtm -= 86400; else if (dtm < -43200) dtm += 86400;
          if (dtm < -30 || dtm > 7200) continue;
          if (!best.has(destName) || dtm < best.get(destName)) best.set(destName, dtm);
        }
        // 🔴 同一輪、同一份資料內的控制組：現行兩級窗（正常終點 3×班距、短程終點 1×班距）
        //    從舊窗 7200s 裡拿掉了哪些列。不可以拿「十分鐘前另一次執行的結果」比對——
        //    資料每輪都在變，那不是控制組（本輪就靠這條證明 Y 的列消失是資料漂移不是規則）。
        for (const [destName, dtm] of best) {
          const shortTurn = !termini.has(destName);
          if (dtm > (shortTurn ? 1 : 3) * hw)
            rec.removedByTerminus.push({ st: sts[si].name, dest: destName, sec: Math.round(dtm), shortTurn });
        }
      }
    }
    out.push(rec);
  }
  return { simSec: state.simSec, at: new Date().toTimeString().slice(0, 8), lines: out };
});

console.log(`\n盤查時刻 ${r.at}（模擬秒 ${r.simSec}）\n`);
let anyBad = 0;
for (const L of r.lines) {
  const cap = 3 * L.hw;
  const over = L.rows.filter(x => x.sec > cap);
  const shortTurns = L.rows.filter(x => x.shortTurn);
  console.log(`■ ${L.line}（${L.abbr}）班距 ${L.hw}s／窗 ${Math.round(cap / 60)} 分　正常終點：${L.termini.join('、')}`);
  console.log(`   班表補列共 ${L.rows.length} 列；其中短程／加班車終點 ${shortTurns.length} 列；超出窗 ${over.length} 列`);
  if (over.length) {
    anyBad += over.length;
    for (const x of over.slice(0, 6))
      console.log(`   ❌ ${x.st} 往${x.dest} ${Math.round(x.sec / 60)} 分（窗 ${Math.round(cap / 60)} 分）${x.shortTurn ? '［短程車終點］' : ''}`);
  }
  // 短程車終點即使在窗內也列出來讓人看得到（使用者要看的是「有沒有提前排進來」）
  const byDest = new Map();
  for (const x of shortTurns) {
    if (!byDest.has(x.dest)) byDest.set(x.dest, []);
    byDest.get(x.dest).push(x);
  }
  for (const [dest, arr] of byDest) {
    const mx = Math.max(...arr.map(x => x.sec)), mn = Math.min(...arr.map(x => x.sec));
    console.log(`   ▸ 短程終點「${dest}」出現在 ${arr.length} 站，倒數 ${Math.round(mn / 60)}–${Math.round(mx / 60)} 分` +
      (mx > cap ? '　❌ 有超窗' : '　（皆在窗內）'));
  }
  for (const flag of [true, false]) {
    const rm = L.removedByTerminus.filter(x => x.shortTurn === flag);
    const label = flag ? `短程終點（窗 ${Math.round(L.hw / 60)} 分）` : `正常終點（窗 ${Math.round(cap / 60)} 分）`;
    if (!rm.length) { console.log(`   ［舊窗會收、現行窗排除］${label}：0 列`); continue; }
    const dests = [...new Set(rm.map(x => x.dest))];
    const mx = Math.max(...rm.map(x => x.sec)), mn = Math.min(...rm.map(x => x.sec));
    console.log(`   ［舊窗會收、現行窗排除］${label}：${rm.length} 列，終點 ${dests.join('、')}，` +
      `倒數 ${Math.round(mn / 60)}–${Math.round(mx / 60)} 分`);
  }
}
console.log(`\n${anyBad ? `❌ 共 ${anyBad} 列超出現行窗` : '✅ 沒有任何補列超出現行窗'}`);
await b.close();
process.exit(anyBad ? 1 : 0);
