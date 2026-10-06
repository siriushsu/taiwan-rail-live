// 台鐵待避股道閘門：時刻表明示的待避（通過型：超越車不停、通過時刻落在待避車停站窗內；停站型：超越車後到先開），
// 待避車要停較彎的股道、超越車走較直的股道，兩車不共用節點。判準與修復器 repair_tra_overtake_tracks.mjs 同一份
//（scripts/lib/tra_overtake_pairs.mjs），規格在 docs/specs/2026-10-06-tra-overtake-main-siding.md。
// G0 名冊分母／G1 每天通過型與停站型都有待避對／G2 局部最優（還有可行、又不增 B、C、單線交會與待避對共用節點的換股沒做就紅）／
// G3 共用節點只准是修了會違反硬性條件的／G4 單線交會共用節點逐日不多於基準派車表（BASE_REF，執行時現算）／G5 已知案例與正向對照。
// 窗外前後 60 秒的近距配對只寫進報告，不進任何一條判準。
// 班表釘在 SCHEDULE_REF 加 9/13 考卷；路網與派車讀出貨檔，NETWORK=／DISPATCH= 可換檔做突變。
// --rolling：改用磁碟上每週換窗的班表、不加考卷，只寫報告不擋（離開碼 0）；npm run fetch-schedule 最後一步會跑。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createStationConflictModel } from './lib/tra_station_conflicts.mjs';
import { SCHEDULE_REF, REASON_SHORT, loadOvertakeInputs, makeOvertakeJudge, findOvertakePairs, makeProtection, makeOvertakeSolver, makeMeetCounter } from './lib/tra_overtake_pairs.mjs';

const ROLLING = process.argv.includes('--rolling');
const NETWORK = process.env.NETWORK || 'rail-3d/physical/network.json', DISPATCH = process.env.DISPATCH || 'rail-3d/physical/dispatch.json';
const REPORT = process.env.REPORT || `output/overtake-tracks/${ROLLING ? 'rolling' : 'gate'}-report.json`;
// 已知案例（10/6 全日畫面掃描找到的通過型）：湖口是做反的、新烏日是做對的
const KNOWN = [
  { day: '2026-10-06', station: 'tra_sched:湖口', q: '1187', p: '165', expect: 'violation' },
  { day: '2026-10-06', station: 'tra_sched:新烏日', q: '3128', p: '162', expect: 'clear' },
];
const md5 = f => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
let failed = 0;
const check = (ok, label, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; };
// 各段耗時（秒）印在報告行之前：把這支掛進出貨流程、決定怎麼跑時看這一行。
const t0 = Date.now(), laps = []; let tLap = t0;
const lap = label => { const now = Date.now(); laps.push(`${label} ${((now - tLap) / 1000).toFixed(1)}`); tLap = now; };
console.log(`受測 network ${NETWORK} md5 ${md5(NETWORK)}；dispatch ${DISPATCH} md5 ${md5(DISPATCH)}；班表 ${ROLLING ? 'data/tra_schedule_dense.json md5 ' + md5('data/tra_schedule_dense.json') : SCHEDULE_REF}`);

const I = loadOvertakeInputs({ scheduleRef: ROLLING ? null : SCHEDULE_REF, withExam: !ROLLING, network: NETWORK, dispatch: DISPATCH });
lap('讀檔');
const model = (net, dispatch) => createStationConflictModel({ net, dispatch, sched: I.sched, timed: I.timed, protectedPlanKeys: new Set(Object.keys(I.protectedPlans)),
  report: { materialised: 0 }, stats: {}, roster: 'f2b', base: I.base, extraDays: I.extraDays });
const S = model(I.net, I.dispatch);
S.buildBorrowerIndex();
const rs = S.rosterStats;
lap('建模型');
check(rs.keys > 0 && rs.skippedLength === 0 && rs.misaligned.length === 0 && rs.unlinked === 0, 'G0 名冊完整',
  `${rs.keys} 個車次鍵、平鎮子集綁定 ${rs.subsetBound}、借用 ${rs.borrowed}、綁不到 ${rs.unbound}、站數不符被略過 ${rs.skippedLength}、跨日對不上 ${rs.misaligned.length}、借用切片對不回來源 ${rs.unlinked}`);

const J = makeOvertakeJudge(S), { pairs, near } = findOvertakePairs(S), days = S.sources.map(x => x.day);
const perDay = Object.fromEntries(days.map(d => [d, { pass: 0, stop: 0, near: 0 }])), byDayStation = {};
for (const c of pairs) for (const d of c.days) { perDay[d][c.type]++; ((byDayStation[d] ||= {})[c.st.split(':')[1]] ||= { pass: 0, stop: 0 })[c.type]++; }
for (const x of near) perDay[x.day].near++;
// 兩型都要每天出現：某一型整天是 0，多半是偵測壞了（安靜失敗），不能放行。
check(days.length === S.days.length + (ROLLING ? 0 : 1) && days.every(d => perDay[d].pass > 0 && perDay[d].stop > 0), 'G1 每天通過型與停站型都有待避對',
  Object.entries(perDay).map(([d, n]) => `${d.slice(5)} 通過${n.pass}／停站${n.stop}（近距${n.near}，不計）`).join(' '));
lap('找待避對');

const meets = makeMeetCounter(S, I.sections);
const X = makeOvertakeSolver(S, J, { pairs, isProtected: makeProtection(S, I), meets });
lap('建求解器與判定每一對');
const viol = X.violating(), reasons = new Map(viol.map(c => [c.id, X.explain(c)]));
lap('explain 全部違規');
const hist = { pass: {}, stop: {} }; for (const c of viol) { const r = reasons.get(c.id); hist[c.type][r] = (hist[c.type][r] || 0) + 1; }
const name = c => `${c.st.split(':')[1]} ${c.q.no}/${c.p.no}（${c.type === 'pass' ? '通過' : '停站'}）`;
const fixable = viol.filter(c => reasons.get(c.id) === 'FIXABLE'), vt = X.violationsByType();
check(fixable.length === 0, 'G2 局部最優：沒有可行又不增 B、C、單線交會與共用節點的換股沒做',
  `違規 通過型 ${vt.pass}／停站型 ${vt.stop} 件次；原因（組）${JSON.stringify(hist)}${fixable.length ? '；例：' + fixable.slice(0, 5).map(name).join('、') : ''}`);
// 修了會違反硬性條件的才准留（規格第 6 節第 3 條）；FIXABLE 與「會增加別的違規」不准留。
const okShared = new Set(['沒有替代股道', '替代組合都仍違規', REASON_SHORT, '受保護', '會增加 B 或 C', '會增加單線交會共用節點', '會增加共用節點']);
const shared = viol.filter(c => X.state(c).kind === 'shared'), sharedBad = shared.filter(c => !okShared.has(reasons.get(c.id)));
check(sharedBad.length === 0, 'G3 共用節點只剩修了會違反硬性條件的',
  `共用 ${shared.length} 組，其中原因不是沒有替代的 ${sharedBad.length} 組${sharedBad.length ? '：' + sharedBad.slice(0, 5).map(c => name(c) + ' ' + reasons.get(c.id)).join('、') : ''}`);

// G4 基準在執行時從 BASE_REF 的路網與派車表現算（同一份班表與時刻），不寫死件數。
const meetSample = [], meetNow = meets.perDay({ collect: meetSample });
lap('G4 現行派車單線交會');
const S0 = model(I.base.net, I.base.dispatch), meetBase = makeMeetCounter(S0, I.sections).perDay();
lap('G4 基準模型與單線交會');
const over = days.filter(d => (meetNow[d] || 0) > (meetBase[d] || 0));
check(over.length === 0, 'G4 單線交會共用節點逐日不多於基準派車表',
  `${days.map(d => `${d.slice(5)} ${meetNow[d] || 0}/${meetBase[d] || 0}`).join(' ')}${over.length ? '；超過：' + over.join('、') : ''}`);

if (!ROLLING) {
  const got = KNOWN.map(k => ({ k, c: pairs.find(c => c.type === 'pass' && c.days.includes(k.day) && c.st === k.station && c.q.no === k.q && c.p.no === k.p) }));
  check(got.every(x => x.c), 'G5a 已知待避對偵測得到', got.map(x => `${x.k.station.split(':')[1]} ${x.k.q}/${x.k.p}${x.c ? '' : ' 找不到'}`).join('、'));
  const clear = got.find(x => x.k.expect === 'clear')?.c;
  check(!!clear && !X.state(clear).viol, 'G5a 已知做對的那對判為不違規', clear ? JSON.stringify(X.state(clear)) : '找不到');
  // G5b 正向對照：把一對判為 ok 的兩車對調股道（待避車停到超越車那一股、超越車改走待避車那一股），判準必須翻成違規。
  let swapped = null;
  for (const c of [clear, ...pairs]) {
    if (!c || c.type !== 'pass' || X.state(c).kind !== 'ok') continue;
    const qIds = S.current.get(c.q.key), pIds = S.current.get(c.p.key);
    const qo = J.routeOptions(c.q.key, c.q.i, qIds).find(o => o.m === S.nodeAt(pIds, c.p.i));
    const po = J.routeOptions(c.p.key, c.p.i, pIds).find(o => o.m === S.nodeAt(qIds, c.q.i));
    if (qo && po) { swapped = { c, v: J.verdict(c, qo.ids2, po.ids2) }; break; }
  }
  check(!!swapped && swapped.v.viol, 'G5b 正向對照：做對的一對對調後判為違規', swapped ? `${name(swapped.c)} → ${JSON.stringify(swapped.v)}` : '找不到可對調的一對');
}
lap('G5');

const pairDays = pairs.flatMap(c => {
  const v = X.state(c), reason = v.viol ? reasons.get(c.id) : v.kind === 'ambiguous' ? '分不出直彎' : null, ll = S.coords.get(c.st) || {};
  return c.days.map(day => ({ day, type: c.type, station: c.st, lat: ll.lat, lon: ll.lon, q: c.q, p: c.p, ...c.at[day], kind: v.kind, reason, rq: v.rq, rp: v.rp, tq: v.tq, tp: v.tp }));
});
fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, JSON.stringify({ inputs: { network: [NETWORK, md5(NETWORK)], dispatch: [DISPATCH, md5(DISPATCH)], schedule: ROLLING ? 'disk' : SCHEDULE_REF },
  rosterStats: { ...rs, misaligned: rs.misaligned.slice(0, 50) }, pairsPerDay: perDay, pairsByDayStation: byDayStation,
  violations: vt, reasons: hist, meets: { now: meetNow, base: meetBase, sample: meetSample.slice(0, 200) }, pairDays, nearPairDays: near }, null, 1));
lap('寫報告');
console.log(`各段耗時（秒）：${laps.join('／')}`);
console.log(`報告 → ${REPORT}（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`);
process.exit(ROLLING ? 0 : failed ? 1 : 0);
