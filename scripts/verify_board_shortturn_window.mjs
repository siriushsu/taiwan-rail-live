// 尖峰加開的短程車不得被當成「另一條線」提早列在看板上。
//
// 2026-08-17 使用者截圖：松江南京同時出現兩列「往台電大樓」16:40／16:56（61 分、77 分），
// 而官方看板那一輪對該站只給 5 列（松山／新店／蘆洲／迴龍／南勢角，倒數全在 5 分內）。
// 那兩列是班表補列，補列窗原本是 7200 秒（兩小時）。
//
// 判準：北捷看板列的倒數不得超過該線當下班距的三倍（不寫死分鐘數）；同時官方那幾列
// 一列都不准被這道窗連帶砍掉——只砍班表補列，不砍官方即時列。
import { chromium } from 'playwright';
const URL = process.argv[2] || 'http://127.0.0.1:5399/?census=1';
const STATION = process.argv[3] || '松江南京';
let pass = 0, fail = 0;
const ok = (name, cond, got) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : '　實測：' + got}`); };

const b = await chromium.launch();
const p = await b.newPage();
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 90000 });
await p.evaluate(() => {
  const g = (typeof GROUPS !== 'undefined' ? GROUPS : []).find(x => (x.members || []).includes('mrt'));
  if (g) selectGroup(g);
});
await p.waitForTimeout(4000);

const r = await p.evaluate(name => {
  const lines = state.lines || [];
  let st = null;
  for (const ln of lines) for (const s of ln.stations || [])
    if (trtcOfficialStationName(s.name) === trtcOfficialStationName(name)) { st = s; break; }
  if (!st) return { err: '找不到站：' + name };
  const view = trtcOfficialBoardView(st, lines, false);
  if (!view) return { err: '看板 view 是 null（官方看板可能不在即時模式）' };
  const rows = [];
  for (const g of view.groups) {
    const hw = headwayOf(g.ln, state.simSec / 3600) || 600;
    if (g.kind === 'official') for (const rec of g.rows)
      rows.push({ kind: 'official', line: g.ln.id, dest: g.destName, sec: Math.round(rec.left), hw });
    else for (const row of g.rows)
      rows.push({ kind: 'legacy', line: g.ln.id, dest: g.destName, sec: Math.round(row.dtm), hw });
  }
  // 控制組：直接從班表算「這一站有哪些終點的下一班還在舊窗（7200s）內、但超出新窗」。
  // 這證明輸入資料裡真的有那種列、舊窗會收它、是新窗把它排除的——不是資料剛好沒有而假綠。
  const wouldShow = [];
  for (const ln of lines) {
    if (!isTrtcBoardLine(ln) || !ln._tt) continue;
    const si = (ln.stations || []).findIndex(s => trtcOfficialStationName(s.name) === trtcOfficialStationName(name));
    if (si < 0) continue;
    const hw = headwayOf(ln, state.simSec / 3600) || 600;
    const best = new Map();
    for (const trip of ln._tt) {
      let i = -1;
      for (let k = 0; k < trip.length; k += 2) if (trip[k] === si) { i = k; break; }
      if (i < 0 || i === trip.length - 2) continue;
      const destName = ln.stations[trip[trip.length - 2]].name;
      let dtm = trip[i + 1] + metroShiftSec(ln, trip) - state.simSec;
      if (dtm > 43200) dtm -= 86400; else if (dtm < -43200) dtm += 86400;
      if (dtm < -30 || dtm > 7200) continue;
      if (!best.has(destName) || dtm < best.get(destName)) best.set(destName, dtm);
    }
    for (const [destName, dtm] of best)
      if (dtm > 3 * hw) wouldShow.push({ line: ln.id, dest: destName, sec: Math.round(dtm), hw });
  }
  return { rows, wouldShow };
}, STATION);

if (r.err) { console.log('❌ ' + r.err); await b.close(); process.exit(2); }
for (const x of r.rows) console.log(`   ${x.kind === 'official' ? '官方' : '班表'} ${x.line} 往${x.dest} ${Math.round(x.sec / 60)}分（${x.sec}s，班距 ${x.hw}s）`);

const far = r.rows.filter(x => x.kind === 'legacy' && x.sec > 3 * x.hw);
ok(`${STATION}：班表補列不得超過三班班距`, far.length === 0,
  far.map(x => `往${x.dest} ${Math.round(x.sec / 60)}分 > ${Math.round(3 * x.hw / 60)}分`).join('、'));
const official = r.rows.filter(x => x.kind === 'official');
ok('官方即時列仍在（這道窗只砍班表補列）', official.length > 0, `官方列 ${official.length} 列`);
ok('看板至少有一列可看', r.rows.length > 0, `共 ${r.rows.length} 列`);
// 控制組：舊窗會收、新窗排除的那些列，必須真的存在（否則這條判準是空的）並且真的不在看板上
for (const x of r.wouldShow) console.log(`   ［舊窗會收］${x.line} 往${x.dest} ${Math.round(x.sec / 60)}分`);
// 控制組只在「這一站這個時刻真的有那種列」時才成立——多數車站沒有短程車終點，
// 無條件要求它存在會讓大部分車站假紅（把「這裡沒東西可驗」誤報成「產品壞了」）。
if (r.wouldShow.length === 0)
  console.log('⏭ 控制組跳過：這一站這個時刻沒有「舊窗會收、新窗排除」的列（松江南京平日午後有台電大樓短程車可驗）');
else
  ok('控制組：資料裡真的有「舊窗會收、新窗排除」的列（判準不是空跑）', true, '');
const leaked = r.wouldShow.filter(x => r.rows.some(y => y.dest === x.dest && y.kind === 'legacy'));
ok('那些列確實沒被畫上看板', leaked.length === 0, leaked.map(x => '往' + x.dest).join('、'));

console.log(`\n合計 ${pass} 過 / ${fail} 失敗`);
await b.close();
process.exit(fail ? 1 : 0);
