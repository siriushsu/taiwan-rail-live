// 把台鐵待避側線的進出站路徑補進出貨路網的 paths（只補路徑：way 已在 network.json，也不改派車表）。
// rail-3d/physical/overtake-sidings.js 待避換股只從已打包的路徑挑；pack_physical_network.mjs 只打包派車表用到的路徑，
// 派車表從沒派過車的側線就換不過去——10/9 6016 在南平等 2 次，側線 way 1175170157（OSM service=siding）走得到，
// 兩車卻停／過同一股。2026-09-29 使用者裁示「補打包那兩條路徑」：只補既有 OSM 側線上的路徑，不造新股道。
//
// 每條路徑都要過：經過的 way 與下面逐條覆核過的清單相同；不逆向走方向股道（track_directions.mjs 的 wrongOn）；
// 進站段、出站段在停車點接得上，與同站對現行派車路徑的前一段、後一段也接得上（turnOK：道岔不倒車）。
// 長度：側線要繞進繞出，出站段比該站對派車表最長的路徑長 0.146 m。跑段剖面的站間長取該站對「會畫的路徑」最長者
// （maxPathM，點速才恆 ≤ 車種極速、不留容差），所以 build_tra_track_sections.mjs 與 overtake-sidings.js 都把這裡記的
// overtakePaths 算進最長路徑；這裡只擋「比派車表最長的長超過 1 m」，免得一條側線把整個站對的剖面拉長。
//
// 跑法：node scripts/extend_tra_overtake_sidings.mjs（就地改 rail-3d/physical/network.json；NETWORK=／OUT= 可換檔），
// 之後重跑 node scripts/build_tra_track_sections.mjs、npm run build-run-profiles、npm run build-manifest。
// 🔴 重新打包 network.json 之後要再跑一次；用 extensions 記錄判斷是否已補入，重跑無害。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeDirectionModel } from './lib/track_directions.mjs';

const NAME = '台鐵待避側線路徑（南平）';
const file = process.env.NETWORK || 'rail-3d/physical/network.json', out = process.env.OUT || file;
const net = JSON.parse(fs.readFileSync(file, 'utf8'));
if (net.extensions?.some(e => e.name === NAME)) { console.log('已補入', NAME); process.exit(0); }
const dispatch = JSON.parse(fs.readFileSync('rail-3d/physical/dispatch.json', 'utf8'));

// 南下（林榮新光→南平→鳳林）停側線上的推估停車點；mainline＝同一站對現行派車的正線路徑（接頭對照用）。
const SIDINGS = [{
  station: '南平', stop: 'estimated:tra_sched:南平:1175170157:2', siding: '1175170157',
  legs: [
    { from: '7026780284', to: 'estimated:tra_sched:南平:1175170157:2', pair: ['林榮新光', '南平'], mainline: 4440,
      ways: ['549750562', '549750560', '549750559', '549750556', '549750561', '1175170157'] },
    { from: 'estimated:tra_sched:南平:1175170157:2', to: '10920130434', pair: ['南平', '鳳林'], mainline: 3868,
      ways: ['1175170157', '1021846206', '1021846207', '1021846208', '1021846210', '1175170155', '1175170154', '1175170151'] },
  ],
}];

const M = makeDirectionModel({ net, dispatch });
const { clean } = M.classify();
const pairMax = new Map();
for (const [, plan] of M.plans) {
  const sig = M.sigOf(plan);
  plan.pathIds.forEach((id, i) => { const k = [sig[i][0], sig[i + 1][0]].sort().join('|'); if (M.paths[id]) pairMax.set(k, Math.max(pairMax.get(k) || 0, M.paths[id].lengthM)); });
}
const neighbours = (id, side) => new Set(M.plans.flatMap(([, p]) => p.pathIds.flatMap((x, i) => x !== id ? [] : side < 0 ? (i ? [p.pathIds[i - 1]] : []) : (i + 1 < p.pathIds.length ? [p.pathIds[i + 1]] : []))));
const overtakePaths = {}, report = [];
for (const s of SIDINGS) {
  assert.equal(net.ways.find(w => String(w.id) === s.siding)?.tags?.service, 'siding', s.station + ' 側線 way 不在路網或不是 siding');
  const ids = s.legs.map(leg => {
    const main = M.paths[leg.mainline];
    assert(main && (main.from === leg.from || main.to === leg.to), leg.pair.join('→') + ' 對照的正線路徑端點不符');
    const r = M.cleanRoute(leg.from, leg.to, main.lengthM, clean, new Map());
    assert(r, leg.pair.join('→') + ' 找不到順向路徑');
    const p = M.paths[r.id];
    assert(!net.paths[r.id], leg.pair.join('→') + ' 已有同一條路徑 ' + r.id);
    assert.deepEqual([...new Set(p.edgeIds.map(e => M.edges[e].wayId))], leg.ways, leg.pair.join('→') + ' 經過的 way 與覆核清單不同');
    assert.equal(M.wrongOn(p, clean).length, 0, leg.pair.join('→') + ' 逆向走方向股道');
    const max = pairMax.get(leg.pair.map(n => 'tra_sched:' + n).sort().join('|'));
    assert(max > 0 && p.lengthM - max < 1, `${leg.pair.join('→')} ${p.lengthM.toFixed(3)} m 比派車表最長 ${max} m 長超過 1 m`);
    report.push(`${leg.pair.join('→')} 路徑 ${r.id}：${p.lengthM.toFixed(3)} m（正線 ${main.lengthM.toFixed(3)}、派車表最長 ${max.toFixed(3)}）`);
    return r.id;
  });
  assert(M.turnOK(ids[0], ids[1]), s.station + ' 進站段接不上出站段');
  for (const prev of neighbours(s.legs[0].mainline, -1)) if (M.turnOK(prev, s.legs[0].mainline)) assert(M.turnOK(prev, ids[0]), s.station + ' 前一段 ' + prev + ' 接不上進站段');
  for (const next of neighbours(s.legs[1].mainline, 1)) if (M.turnOK(s.legs[1].mainline, next)) assert(M.turnOK(ids[1], next), s.station + ' 出站段接不上後一段 ' + next);
  s.legs.forEach((leg, i) => { overtakePaths[ids[i]] = leg.pair; });
}
for (const id of Object.keys(overtakePaths)) net.paths[id] = M.newPaths[id];
net.extensions = [...(net.extensions || []), {
  name: NAME, source: 'OpenStreetMap（way 本來就在出貨路網；只補路徑）', date: '2026-09-29', overtakePaths,
  note: '同向待避換股用（rail-3d/physical/overtake-sidings.js）；派車表沒有派車。overtakePaths＝路徑編號→[前站, 後站]，'
    + 'build_tra_track_sections.mjs 與 overtake-sidings.js 把它們算進該站對的最長路徑。',
}];
fs.writeFileSync(out, JSON.stringify(net));
console.log(report.join('\n') + `\n補入 ${Object.keys(overtakePaths).length} 條路徑 → ${out}`);
