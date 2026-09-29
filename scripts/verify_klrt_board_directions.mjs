// 從真正 renderer 抽出分組段，真班表獨立重算雙向配額；不拿受測 helper 當真值。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
let src = readFileSync(new URL('index.html', root), 'utf8');
if (process.env.KLRT_BOARD_MUTATION === 'merge') src = src.replace("klrtRoute ? klrtRoute.direction + '|' + destName : destName", 'destName');
if (process.env.KLRT_BOARD_MUTATION === 'seam') src = src.replace('delta === 1 ? 1 : delta === count - 1 ? -1 : 0', 'Math.sign(trip[i + 2] - trip[i])');
const data = JSON.parse(readFileSync(new URL('data/krtc.json', root)));
const times = JSON.parse(readFileSync(new URL('data/krtc_times.json', root)));
const helpers = src.includes('function klrtBoardRoute(')
  ? src.slice(src.indexOf('function klrtBoardRoute('), src.indexOf('// opts.compact', src.indexOf('function klrtBoardRoute('))) : '';
const start = src.indexOf('  const key = st.name', src.indexOf('function renderFreqBoard('));
const end = src.indexOf('  const hasEstimated', start);
const sandbox = vm.createContext({ metroShiftSec: () => 0, tymcKindOf: () => null });
vm.runInContext(helpers + '\nfunction groups(st, lines, isDeco, state) {' + src.slice(start, end) + '\nreturn groups;}', sandbox);
let cases = 0;
for (const [set, trips] of Object.entries(times.lines.C.sets)) {
  const ln = { ...data.lines.find(l => l.id === 'C'), _sys: 'krtc', _tt: trips };
  // 起點 0→37 與末段 37→0：不能用索引大小決定環線方向。
  const dir = trip => trip[2] === 1 ? 1 : -1;
  for (const minute of [8 * 60 + 57, 18 * 60, 21 * 60 + 30]) for (let si = 0; si < ln.stations.length; si++) {
    const expected = new Map();
    trips.forEach((trip, ci) => {
      const i = trip.findIndex((v, k) => k % 2 === 0 && v === si);
      if (i < 0 || i === trip.length - 2) return;
      let dtm = trip[i + 1] - minute * 60;
      if (dtm > 43200) dtm -= 86400; else if (dtm < -43200) dtm += 86400;
      if (dtm < -30 || dtm > 7200) return;
      const d = dir(trip);
      if (!expected.has(d)) expected.set(d, []);
      expected.get(d).push({ ci, dtm });
    });
    for (const rows of expected.values()) rows.sort((a, b) => a.dtm - b.dtm);
    for (const isDeco of [false, true]) {
      const groups = sandbox.groups(ln.stations[si], [ln], isDeco, { simSec: minute * 60, visible: new Set(['C']) });
      const tag = `${set}/${si}/${minute}/${isDeco}`;
      assert.equal(groups.length, expected.size, `${tag} 必須按雙向分組，不能因同終點合併`);
      for (const g of groups) {
        const d = dir(trips[g.rows[0].ci]);
        assert(g.rows.every(r => dir(trips[r.ci]) === d), `${tag} 不可混向`);
        assert.deepEqual(Array.from(g.rows, r => r.ci), expected.get(d).slice(0, 2).map(r => r.ci), `${tag} 每向最近兩班`);
        assert.equal(g.destName, '籬仔內', `${tag} 不改真實終點`);
        const route = g.klrtRoute;
        assert.equal(route.direction, d);
        const trip = trips[g.rows[0].ci], i = trip.findIndex((v, k) => k % 2 === 0 && v === si);
        const ahead = trip.filter((v, k) => k > i && k % 2 === 0).map(v => ln.stations[v].name);
        assert.equal(route.nextName, ahead[0]);
        assert(ahead.includes(route.viaName), `${tag} 指示站一定在終點以前、不能越過終點`);
      }
      cases++;
    }
  }
}
const ln = { ...data.lines.find(l => l.id === 'C'), _sys: 'krtc', _tt: times.lines.C.sets['平日'] };
const groups = sandbox.groups(ln.stations[5], [ln], false, { simSec: 8 * 3600 + 57 * 60, visible: new Set(['C']) });
assert(groups.some(g => g.klrtRoute.direction === 1 && g.klrtRoute.viaName === '駁二大義'));
assert(groups.some(g => g.klrtRoute.direction === -1 && g.klrtRoute.nextName === '夢時代'));
assert.deepEqual(Array.from(groups, g => g.rows.map(r => r.t / 60)).flat().sort((a,b) => a-b), [540,548,551,566]);
assert.equal(sandbox.klrtBoardRoute({ ...ln, _sys: 'mrt' }, ln._tt[0], 0), null, '不可影響其他系統');
assert.equal(sandbox.klrtBoardRoute({ ...ln, id: 'KR' }, ln._tt[0], 0), null, '不可影響高捷紅線');
// 非輕軌負向對照：与修正前分組輸出逐班相同，不只看 helper 回 null。
const baseline = execFileSync('git', ['show', 'd09307a8:index.html'], { cwd: fileURLToPath(root), maxBuffer: 8e6, encoding: 'utf8' });
const bstart = baseline.indexOf('  const key = st.name', baseline.indexOf('function renderFreqBoard('));
const bend = baseline.indexOf('  const hasEstimated', bstart);
vm.runInContext('function baselineGroups(st, lines, isDeco, state) {' + baseline.slice(bstart,bend) + '\nreturn groups;}', sandbox);
for (const id of ['KR','KO']) for (const trips of Object.values(times.lines[id].sets)) {
  const line = { ...data.lines.find(l => l.id === id), _sys:'krtc', _tt:trips };
  for (const st of line.stations) {
    const state = { simSec:18*3600, visible:new Set([id]) };
    const comparable = gs => Array.from(gs, g => ({ destName:g.destName, rows:Array.from(g.rows, r => ({ ...r })) }));
    assert.deepEqual(comparable(sandbox.groups(st,[line],false,state)),comparable(sandbox.baselineGroups(st,[line],false,state)));
  }
}
console.log(`PASS ${cases} 組真班表雙向／全站／全台同框配額；經貿園區 08:57 保留 09:00、09:08、09:11、09:26 四班。`);
