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
  // 桃園機捷 2026-09-07 新聞稿(show-2421)逐字:
  //   「自9月21日起,再增開平日傍晚18時04分由A1台北車站發車,往機場方向行駛的加班車。
  //     新增班次沿途各站皆停靠,預計18時50分抵達終點站A13機場第二航廈站」
  // A1 = 站索引 0、A13 = 站索引 12;常態加班(無 dates),落在平日 set。
  // 設計展期間官網各站時刻表把這班標■,圖例逐字「2026台灣設計展期間，調整為開往A21班次(每站停靠)」,
  // 附註「9/24(四)-10/11(日)」:那段期間終點改 A21(站索引 20)。官網是出發時刻表,
  // 終點站沒有時刻,所以展期內只驗終點與每站停,不驗到達時刻。
  'tymc-20260921-a1-1804': {
    out: 'data/tymc_times.json', base: '平日',
    add: { line: 'A', from: 0, to: 12, dep: '18:04', arr: '18:50' },
    expo: { through: '2026-10-11', to: 20 },
  },
  // 桃園機捷官網各站時刻表,查詢日期 2026-10-02(週五,非國定假日,網站本來走平日 set),2026-09-25 實查:
  //   圖例「2026台灣設計展期間，增開區間服務班次(A12←→A21，每站停靠)」(空心圓○)
  //   A12 往老街溪○ 10:49 起每 15 分到 15:34、20:04 起每 15 分到 21:49(TDX 平日沒有的部分)
  //   A21 往台北○   10:44 起每 15 分到 15:29、20:14 起每 15 分到 21:59
  //   首班逐站 A12 10:49 A13 10:51 A14a 10:54 A15 10:57 A16 11:00 A17 11:03 A18 11:07 A19 11:10 A20 11:15
  //           A21 10:44 A20 10:48 A19 10:53 A18 10:57 A17 11:01 A16 11:04 A15 11:07 A14a 11:10 A13 11:13
  // A12 = 站索引 11、A21 = 站索引 20;○是普通車(kinds '1')。
  'tymc-20261002-expo-friday': {
    out: 'data/tymc_times.json', base: '平日', date: '2026-10-02',
    dateAdd: { line: 'A', kind: '1', runs: [
      { from: 11, to: 20, windows: [['10:49', '15:34'], ['20:04', '21:49']], everyMin: 15,
        firstHm: ['10:49', '10:51', '10:54', '10:57', '11:00', '11:03', '11:07', '11:10', '11:15'] },
      { from: 20, to: 11, windows: [['10:44', '15:29'], ['20:14', '21:59']], everyMin: 15,
        firstHm: ['10:44', '10:48', '10:53', '10:57', '11:01', '11:04', '11:07', '11:10', '11:13'] },
    ] },
  },
  // 桃園機捷官網各站時刻表,查詢日期 2026-10-11(週日,設計展最後一天,網站本來走假日 set),2026-09-25 實查:
  //   公告逐字「及10/11(日) 11:00至20:00 於A12-A21區間啟動加班車疏運」
  //   A12 往老街溪○ 37 班 10:49…19:49(假日 45 班到 21:49);A21 往台北○ 38 班 10:44…19:59(假日 46 班到 21:59)
  // ⇒ 那天只少 20:00 以後的○:A12 20:04–21:49、A21 20:14–21:59 各 8 班;20:00 以前的○照開。
  'tymc-20261011-expo-last-day': {
    out: 'data/tymc_times.json', base: '假日', date: '2026-10-11',
    dateDrop: { line: 'A', runs: [
      { from: 11, to: 20, windows: [['20:04', '21:49']], everyMin: 15, keepLast: '19:49' },
      { from: 20, to: 11, windows: [['20:14', '21:59']], everyMin: 15, keepLast: '19:59' },
    ] },
  },
};
// 臺北日期,只給上面 expo.through 用;VERIFY_TODAY=YYYY-MM-DD 覆寫(測展期後那條路徑)
const TODAY = process.env.VERIFY_TODAY || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());

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

  if (E.add) {
    const X = E.add, L = T[X.line], set = L && L.sets[E.base];
    if (!set) { ok(false, `線 ${X.line} 的基準 set「${E.base}」存在`); continue; }
    ok(!op.dates, '常態加班沒有 dates(不是只在特定日期生效)');
    ok([1, 2, 3, 4, 5].every(w => L.days[w] === E.base), `週一到週五都走「${E.base}」`);
    const expo = E.expo && TODAY <= E.expo.through, to = expo ? E.expo.to : X.to;
    const hits = set.map((tr, i) => [tr, i]).filter(([tr]) => tr[0] === X.from && depOf(tr) === toSec(X.dep));
    ok(hits.length === 1, `${E.base} 恰有一班 ${X.dep} 由站索引 ${X.from} 發車 — 實際 ${hits.length} 班`);
    if (hits.length === 1) {
      const [tr, i] = hits[0], idx = tr.filter((_, j) => j % 2 === 0);
      ok(tr[tr.length - 2] === to && (expo || tr[tr.length - 1] === toSec(X.arr)), expo
        ? `設計展期間(到 ${E.expo.through})官方改開到站索引 ${to} — 實際終點 ${tr[tr.length - 2]}`
        : `終點站索引 ${X.to}、${X.arr} 到達 — 實際 ${tr[tr.length - 2]}、${hh(tr[tr.length - 1])}`);
      ok(idx.every((v, j) => v === X.from + j) && idx.length === to - X.from + 1, `沿途各站皆停(${idx.length} 站)`);
      ok(tr.every((v, j) => j < 3 || j % 2 === 0 || v > tr[j - 2]), '逐站時刻嚴格遞增');
      const ks = L.kinds && L.kinds[E.base];
      ok(!ks || (ks.length === set.length && ks[i] === '1'), `kinds 與 set 等長且這班標普通車('1') — 實際 ${ks ? ks[i] : '(無 kinds)'}`);
    }
    for (const w of [0, 6]) ok(!L.sets[L.days[w]].some(tr => tr[0] === X.from && depOf(tr) === toSec(X.dep) && tr[tr.length - 2] === to), `對照:${w ? '週六' : '週日'}沒有這班(公告只說平日)`);
    continue;
  }

  if (E.dateAdd) {
    const X = E.dateAdd, L = T[X.line], base = L && L.sets[E.base];
    const setName = L && L.dates && L.dates[E.date], sp = setName && L.sets[setName];
    ok(!!sp && !!base, `${E.date} 指到例外 set「${setName || '無'}」、基準「${E.base}」也在`);
    if (!sp || !base) continue;
    ok(Object.keys(L.dates).filter(d => L.dates[d] === setName).join(',') === E.date, `只有 ${E.date} 走「${setName}」`);
    const kOf = (s, i) => ((L.kinds && L.kinds[s]) || '')[i] || '';
    ok(L.kinds && L.kinds[setName] && L.kinds[setName].length === sp.length, `kinds 與例外 set 等長(前端長度對不上會整天不標車種)`);
    // 例外 set 扣掉基準的每一班(連同車種)＝多出來的班;基準少任何一班都算錯
    const key = (tr, k) => tr.join(',') + '|' + k, pool = new Map();
    sp.forEach((tr, i) => pool.set(key(tr, kOf(setName, i)), (pool.get(key(tr, kOf(setName, i))) || 0) + 1));
    const lost = base.filter((tr, i) => { const q = key(tr, kOf(E.base, i)), c = pool.get(q) || 0; if (c) pool.set(q, c - 1); return !c; });
    ok(!lost.length, `基準「${E.base}」${base.length} 班連同車種原樣保留 — 少了 ${lost.length} 班`);
    const extra = [...pool].flatMap(([q, c]) => Array(c).fill(q)).map(q => { const [s, k] = q.split('|'); return [s.split(',').map(Number), k]; });
    let want = 0;
    for (const R of X.runs) {
      const deps = R.windows.flatMap(([a, b]) => { const r = []; for (let t = toSec(a); t <= toSec(b); t += R.everyMin * 60) r.push(t); return r; });
      const offs = R.firstHm.map(h => toSec(h) - toSec(R.firstHm[0])), step = R.to > R.from ? 1 : -1;
      want += deps.length;
      const bad = deps.filter(d => {
        const hit = extra.filter(([tr]) => tr[0] === R.from && depOf(tr) === d);
        if (hit.length !== 1) return true;
        const [tr, k] = hit[0], idx = tr.filter((_, j) => j % 2 === 0);
        return !(k === X.kind && tr[tr.length - 2] === R.to && idx.length === Math.abs(R.to - R.from) + 1
          && idx.every((v, j) => v === R.from + j * step) && offs.every((o, j) => tr[2 * j + 1] === d + o));
      });
      ok(!bad.length, `站索引 ${R.from}→${R.to} ${deps.length} 班(${R.windows.map(w => w.join('–')).join('、')} 每 ${R.everyMin} 分)逐班都在、每站停、逐站時分同官方首班、車種 ${X.kind} — 不符 ${bad.length} 班${bad.length ? ':' + bad.slice(0, 3).map(hh).join(',') : ''}`);
      ok(!base.some(tr => tr[0] === R.from && deps.includes(depOf(tr))), `對照:基準「${E.base}」本來沒有這些班(例外確實有加東西)`);
    }
    ok(extra.length === want, `例外 set 只比基準多這 ${want} 班 — 實際多 ${extra.length} 班`);
    continue;
  }

  if (E.dateDrop) {
    const X = E.dateDrop, L = T[X.line], base = L && L.sets[E.base];
    const setName = L && L.dates && L.dates[E.date], sp = setName && L.sets[setName];
    ok(!!sp && !!base, `${E.date} 指到例外 set「${setName || '無'}」、基準「${E.base}」也在`);
    if (!sp || !base) continue;
    ok(Object.keys(L.dates).filter(d => L.dates[d] === setName).join(',') === E.date, `只有 ${E.date} 走「${setName}」`);
    const kOf = (s, i) => ((L.kinds && L.kinds[s]) || '')[i] || '';
    ok(L.kinds && L.kinds[setName] && L.kinds[setName].length === sp.length, `kinds 與例外 set 等長(前端長度對不上會整天不標車種)`);
    // 基準扣掉例外 set 的每一班(連同車種)＝被取消的班;例外 set 多出任何一班都算錯
    const key = (tr, k) => tr.join(',') + '|' + k, pool = new Map();
    base.forEach((tr, i) => pool.set(key(tr, kOf(E.base, i)), (pool.get(key(tr, kOf(E.base, i))) || 0) + 1));
    const alien = sp.filter((tr, i) => { const q = key(tr, kOf(setName, i)), c = pool.get(q) || 0; if (c) pool.set(q, c - 1); return !c; });
    ok(!alien.length, `例外 set 每班(連同車種)都來自基準「${E.base}」— 多出 ${alien.length} 班`);
    const gone = [...pool].flatMap(([q, c]) => Array(c).fill(q.split('|')[0].split(',').map(Number)));
    let want = 0;
    for (const R of X.runs) {
      const deps = R.windows.flatMap(([a, b]) => { const r = []; for (let t = toSec(a); t <= toSec(b); t += R.everyMin * 60) r.push(t); return r; });
      want += deps.length;
      const bad = deps.filter(d => gone.filter(tr => tr[0] === R.from && depOf(tr) === d && tr[tr.length - 2] === R.to).length !== 1);
      ok(!bad.length, `站索引 ${R.from}→${R.to} ${R.windows.map(w => w.join('–')).join('、')} 每 ${R.everyMin} 分 ${deps.length} 班逐班取消 — 沒取消到 ${bad.length} 班${bad.length ? ':' + bad.slice(0, 3).map(hh).join(',') : ''}`);
      const last = sp.filter(tr => tr[0] === R.from && tr[tr.length - 2] === R.to).map(depOf).sort((a, b) => a - b).pop();
      ok(last === toSec(R.keepLast), `對照:官方那天最後一班 ${R.keepLast} 仍在(只砍 20:00 以後)— 實際最後一班 ${last == null ? '無' : hh(last)}`);
    }
    ok(gone.length === want, `例外 set 只比基準少這 ${want} 班 — 實際少 ${gone.length} 班`);
    continue;
  }

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
