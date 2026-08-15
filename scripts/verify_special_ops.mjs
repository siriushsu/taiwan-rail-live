// 驗收 data/special_ops.json 的例外班表有沒有真的照官方公告落地。
// 用法:node scripts/verify_special_ops.mjs   (純資料,不需要 server)
//
// 判準的來源是「公告原文」,寫死在下面的 EXPECT,**不從 special_ops.json 讀**——
// 判準若跟著設定檔走,把規則刪掉判準就一起消失、把日期改掉判準就跟著改(判準與實作同源),
// 突變測試會全綠。每加一筆 op 就要在 EXPECT 補一筆,否則直接 FAIL。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const J = f => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));
const toSec = hm => { const [h, m] = hm.split(':').map(Number); return h * 3600 + m * 60; };
const hh = s => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}`;
const depOf = tr => tr[1], ascOf = tr => tr[tr.length - 2] > tr[0];

// 新北捷運 2026-08-14 公告(node=890)逐字:
//   「8月16日、23日及30日(連續三週星期日)」
//   「上述三日下午4時起,綠山線班距將調整為每30分鐘一班;下午5時起綠山線(V09至V11)暫停營運,
//     全數列車將集中投入藍海線運轉,提供3至6分鐘的高密度班距服務」
// V09/V10/V11 = 綠山線站索引 8/9/10(交會點 V09 濱海沙崙 = 索引 8,支線自索引 9 起)
const EXPECT = {
  'ntdlrt-2026-summer-fireworks': {
    out: 'data/ntdlrt_times.json', base: '假日',
    dates: ['2026-08-16', '2026-08-23', '2026-08-30'],
    lines: {
      V: { thinFrom: '16:00', thinHeadwayMin: 30, suspendFrom: '17:00', branchFrom: 9 },
      VB: { denseFrom: '17:00', gapMinSec: 180, gapMaxSec: 360 },
    },
  },
};

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

const cfg = J('data/special_ops.json');
const ids = (cfg.ops || []).map(o => o.id);
console.log('[覆蓋率]');
ok(ids.length > 0, `special_ops.json 有 ${ids.length} 筆 op`);
ok(ids.every(id => EXPECT[id]), `每筆 op 都有對應的公告期望值 — 缺:${ids.filter(id => !EXPECT[id]).join(',') || '無'}`);
ok(Object.keys(EXPECT).every(id => ids.includes(id)), `EXPECT 裡的每筆都還在設定檔中 — 消失的:${Object.keys(EXPECT).filter(id => !ids.includes(id)).join(',') || '無'}`);

for (const [id, E] of Object.entries(EXPECT)) {
  const op = (cfg.ops || []).find(o => o.id === id);
  console.log(`\n[${id}]`);
  if (!op) { ok(false, 'op 存在於 special_ops.json'); continue; }
  ok(!!op.source && !!op.quote, '有官方公告連結與原文引用(沒有原文的值不准上線)');
  ok(op.out === E.out, `輸出檔 ${op.out} == 公告涉及的 ${E.out}`);
  const T = J(E.out).lines;

  for (const [lid, X] of Object.entries(E.lines)) {
    const L = T[lid];
    console.log(` -- ${lid}`);
    if (!L) { ok(false, `線 ${lid} 存在`); continue; }
    const dates = L.dates || {};
    const setName = dates[E.dates[0]];
    ok(!!setName, `${E.dates[0]} 有指到例外 set`);
    ok(E.dates.every(d => dates[d] === setName), `公告載明的 ${E.dates.length} 天都指到同一個 set「${setName}」`);
    ok(Object.keys(dates).sort().join(',') === [...E.dates].sort().join(','),
      `dates 恰為公告載明的日期 — 實際:${Object.keys(dates).sort().join(',') || '(空)'}`);
    const sp = L.sets[setName], base = L.sets[E.base];
    if (!sp || !base) { ok(false, `例外 set 與基準 set「${E.base}」都存在`); continue; }
    ok(sp.length > 0, `例外班表非空(${sp.length} 班)`);
    ok(sp.every(tr => { for (let i = 3; i < tr.length; i += 2) if (tr[i] <= tr[i - 2]) return false; return true; }),
      '每班逐站時刻嚴格遞增');

    if (X.suspendFrom) {
      const from = toSec(X.suspendFrom), bf = X.branchFrom;
      const hit = t => { for (let i = 0; i < t.length; i += 2) if (t[i] >= bf && t[i + 1] >= from) return true; return false; };
      ok(sp.filter(hit).length === 0, `${X.suspendFrom} 起支線(站索引 ≥${bf})零列車 — 違反 ${sp.filter(hit).length} 班`);
      ok(sp.filter(tr => depOf(tr) >= from).length === 0, `${X.suspendFrom} 起本線零發車 — 違反 ${sp.filter(tr => depOf(tr) >= from).length} 班`);
      ok(base.filter(hit).length > 0, `對照組:基準「${E.base}」該時段本來有 ${base.filter(hit).length} 班(判準確實在動東西)`);
    }
    if (X.thinFrom) {
      const from = toSec(X.thinFrom), hw = X.thinHeadwayMin * 60;
      const win = sp.filter(tr => depOf(tr) >= from);
      ok(win.length > 0, `${X.thinFrom} 之後仍有車(${win.length} 班) — 不是整段砍光`);
      let tooDense = 0;
      for (const asc of [true, false]) {
        const d = win.filter(tr => ascOf(tr) === asc).sort((a, b) => depOf(a) - depOf(b));
        for (let i = 1; i < d.length; i++) if (depOf(d[i]) - depOf(d[i - 1]) < hw - 60) tooDense++;
      }
      ok(tooDense === 0, `${X.thinFrom} 起同方向班距 ≥ ${X.thinHeadwayMin} 分 — 違反 ${tooDense} 處`);
      // 上界不能用「到停駛時刻的空檔」來量:往支線那頭最後一班必須早發才趕得及在停駛前跑完,
      // 窗尾本來就會空一段(實測 52 分),那是兩條公告規則的正確結果、不是缺車。
      // 真正該擋的是「多砍」——每一班被丟掉的可行班次,都必須有 30 分鐘規則當理由(離某班留下的 < 30 分)。
      const kept = new Set(sp.map(tr => JSON.stringify(tr)));
      const feasible = tr => depOf(tr) < (X.suspendFrom ? toSec(X.suspendFrom) : Infinity)
        && (!X.suspendFrom || (() => { let m = -Infinity; for (let i = 0; i < tr.length; i += 2) if (tr[i] >= X.branchFrom) m = Math.max(m, tr[i + 1]); return m < toSec(X.suspendFrom); })());
      const unjust = base.filter(tr => depOf(tr) >= from && feasible(tr) && !kept.has(JSON.stringify(tr)))
        .filter(tr => !sp.some(k => ascOf(k) === ascOf(tr) && Math.abs(depOf(k) - depOf(tr)) < hw));
      ok(unjust.length === 0,
        `沒有「無正當理由被砍掉」的班次(可行、又離最近留下的班 ≥ ${X.thinHeadwayMin} 分) — 違反 ${unjust.length} 班${unjust.length ? ':' + unjust.slice(0, 3).map(tr => hh(depOf(tr))).join(',') : ''}`);
    }
    if (X.denseFrom) {
      const from = toSec(X.denseFrom);
      let bad = 0, n = 0;
      for (const asc of [true, false]) {
        const d = sp.filter(tr => ascOf(tr) === asc && depOf(tr) >= from).sort((a, b) => depOf(a) - depOf(b));
        for (let i = 1; i < d.length; i++) { const g = depOf(d[i]) - depOf(d[i - 1]); n++; if (g < X.gapMinSec || g > X.gapMaxSec) bad++; }
      }
      ok(n > 0 && bad === 0, `${X.denseFrom} 起同方向班距落在公告的 ${X.gapMinSec / 60}–${X.gapMaxSec / 60} 分 — ${n} 個間隔,違反 ${bad}`);
      ok(sp.length > base.length, `加密後班次變多(${base.length}→${sp.length})`);
      for (const asc of [true, false]) {
        const b = base.filter(tr => ascOf(tr) === asc), s = sp.filter(tr => ascOf(tr) === asc);
        if (!b.length || !s.length) continue;
        const bl = Math.max(...b.map(depOf)), sl = Math.max(...s.map(depOf));
        ok(sl <= bl, `${asc ? 'asc' : 'desc'} 末班發車未延長(基準 ${hh(bl)} → 例外 ${hh(sl)}) — 官方沒說要延長服務時間`);
      }
    }

    const cut = toSec(X.thinFrom || X.denseFrom);
    const early = arr => arr.filter(tr => depOf(tr) < cut).map(tr => JSON.stringify(tr)).sort().join('|');
    ok(early(base) === early(sp), `${hh(cut)} 之前與基準「${E.base}」逐班相同(沒有順手改到別的時段)`);
    for (const set of Object.keys(L.sets)) {
      if (set === setName) continue;
      ok(L.sets[set] && L.sets[set].length > 0, `常規 set「${set}」仍在(${L.sets[set].length} 班)`);
    }
  }
}

const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
console.log('\n[前端]');
ok(/t\.dates\s*&&\s*t\.dates\[serviceDay\]/.test(html), 'prepFreqTimes() 有依 serviceDay 查 dates 覆蓋');
ok(/if \(t\.dates[^\n]*\n\s*ln\._tt = \(day/.test(html), 'dates 覆蓋發生在挑 set 之前(不是算完才蓋)');

console.log(`\n${fail ? '✗' : '✓'} ${pass} 過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
