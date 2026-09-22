// 把每條捷運／輕軌的雙軌指派翻成靠右行駛（對向股道在行進方向的左手邊）。
// 真值來源與量法：docs/metro-track-side-0909.md。建置端的偏好已在
// build_metro_physical_routes.mjs 改成偏右，但當初那份 .cache 輸入已不在本機，
// 所以同一個修正在封包上重做一次。本腳本自己量、自己判斷，重跑不會再翻回去。
//
// 翻面時只換 path 的內容，不動 routes 的 pathIds：索引是外部資料（例如
// scripts/fixtures/physical-taipei-0908.json 直接存 pathIds）認得的東西，重編會讓
// 那些固定樣本指到別條股道；就地換內容也不會留下一批沒人引用的孤兒 path。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRouteRuntime} from '../rail-3d/physical/route-runtime.js';
import {makePath} from '../rail-3d/integration/train-path.js';

const file = 'rail-3d/physical/metro-network.json';
const pack = JSON.parse(fs.readFileSync(file));
const metresX = lat => 111320 * Math.cos(lat * Math.PI / 180);

function resample(coordinates, step = 10) {
  const path = makePath(coordinates), out = [];
  for (let s = 0; s <= path.length; s += step) out.push(path.at(s).coordinate);
  return out;
}
// 固定 10 m 重新取樣後量左右：原始節點疏密不均，短區間只靠原節點會只剩幾個樣本。
// 2 m 以內視為同一條股道：雙軌中心距不會小於 3 m。
function measure(a, b) {
  const A = resample(a), B = resample(b);
  let left = 0, right = 0;
  for (let i = 2; i < A.length - 2; i++) {
    const p = A[i], mx = metresX(p[1]);
    const tx = (A[i + 2][0] - A[i - 2][0]) * mx, ty = (A[i + 2][1] - A[i - 2][1]) * 111320, tl = Math.hypot(tx, ty);
    if (tl < 3) continue;
    let best = null;
    for (const q of B) {
      const ex = (q[0] - p[0]) * mx, ey = (q[1] - p[1]) * 111320, d = Math.hypot(ex, ey);
      if (d < 2 || d > 45) continue;
      if (!best || d < best.d) best = {d, ex, ey};
    }
    if (!best) continue;
    // 只認橫向分量夠大的配對。來源只畫一條中心線時，兩個方向拿到的是同一批座標，
    // 最近點落在自己前後方（橫向分量近 0），那種「左右」純粹是取樣位移造成的雜訊。
    const lateral = -best.ex * ty / tl + best.ey * tx / tl;
    if (Math.abs(lateral) < 1.5) continue;
    if (lateral > 0) left++; else right++;
  }
  const total = left + right;
  return total < 5 ? '單線或樣本不足' : left / total > 0.85 ? '靠右' : left / total < 0.15 ? '靠左' : `混合 ${Math.round(100 * left / total)}%`;
}

// 就地換內容的前提：一個 path 索引只被一個方向的一個位置引用。
const seen = new Map();
for (const [key, route] of Object.entries(pack.routes)) for (const id of route.pathIds) {
  assert.ok(!seen.has(id), `path ${id} 同時被 ${seen.get(id)} 與 ${key} 引用，不能就地換內容`);
  seen.set(id, key);
}

// walk 三元組 [way, 起點索引, 帶號節數]：反向後起點移到原本走到的最後一個節點，節數變號。
const reverseContent = p => ({from: p.to, to: p.from, system: p.system, lengthM: p.lengthM,
  walk: [...p.walk].reverse().map(([way, start, count]) => [way, start + count - Math.sign(count), -count])});
// 沿同一條 way 從 a 直走到 b。負向走時起點索引要退一格：解碼是 a=i+1、b=i。
function alongWayContent(a, b) {
  const hit = pack.ways.map((w, index) => ({index, from: w.nodes.indexOf(a), to: w.nodes.indexOf(b)})).filter(w => w.from >= 0 && w.to >= 0);
  assert.equal(hit.length, 1, `找不到同時含 ${a} 與 ${b} 的唯一 way`);
  const {index, from, to} = hit[0];
  assert.notEqual(from, to);
  return {from: a, to: b, system: pack.ways[index].system, lengthM: 0, walk: [[index, from < to ? from : from - 1, to - from]]};
}
// 翻面後接縫對不上，代表兩個方向原本就在這裡互相跨到對方股道。把邊界那個區間
// 改成沿同一條 way 直走：外側鄰居的端點留著，內側取翻面後那段的另一端。
function mend(ids, lo, hi) {
  const broken = (a, b) => pack.paths[a].to !== pack.paths[b].from;
  const mended = [];
  if (lo > 0 && broken(ids[lo - 1], ids[lo])) {
    pack.paths[ids[lo]] = alongWayContent(pack.paths[ids[lo - 1]].to, pack.paths[ids[lo]].to);
    mended.push(ids[lo]);
  }
  if (hi < ids.length - 1 && broken(ids[hi], ids[hi + 1])) {
    pack.paths[ids[hi]] = alongWayContent(pack.paths[ids[hi]].from, pack.paths[ids[hi + 1]].from);
    mended.push(ids[hi]);
  }
  return mended;
}

const geometry = createRouteRuntime(pack);
const lineKeys = [...new Set(Object.keys(pack.routes).map(k => k.replace(/:-?1$/, '')))];
const report = [], flipped = [];
for (const key of lineKeys) {
  const forward = pack.routes[key + ':1'], back = pack.routes[key + ':-1'];
  if (!forward || !back) continue;
  const n = forward.pathIds.length;
  assert.equal(back.pathIds.length, n, `${key} 兩個方向的區間數不同`);
  const verdicts = [];
  for (let i = 0; i < n; i++) verdicts.push(measure(geometry.unfold(forward.pathIds[i]).coordinates, geometry.unfold(back.pathIds[n - 1 - i]).coordinates));
  // 量不出來的區間（來源只有一條中心線）跟著最近一個量得出來的鄰居走，不自成一段。
  const known = verdicts.map(v => v === '靠左' || v === '靠右' ? v : null);
  const wrong = known.map((v, i) => {
    if (v) return v === '靠左';
    const before = known.slice(0, i).filter(Boolean).at(-1), after = known.slice(i + 1).find(Boolean);
    return (before || after) === '靠左';
  });
  if (!wrong.some(Boolean)) { report.push({key, action: '不動', detail: `${verdicts.filter(v => v === '靠右').length}/${n} 區間已靠右`}); continue; }
  const start = wrong.indexOf(true), end = wrong.lastIndexOf(true);
  assert.ok(wrong.slice(start, end + 1).every(Boolean), `${key} 要翻面的區間不連續：${verdicts.join(' ')}`);
  flipped.push({key, forward, back, n, start, end});
}
for (const {n, forward, back, start, end} of flipped) {
  const swap = [];
  for (let i = start; i <= end; i++) swap.push([forward.pathIds[i], back.pathIds[n - 1 - i]]);
  const content = swap.map(([a, b]) => [reverseContent(pack.paths[b]), reverseContent(pack.paths[a])]);
  swap.forEach(([a, b], i) => { pack.paths[a] = content[i][0]; pack.paths[b] = content[i][1]; });
}
for (const row of flipped) {
  const mended = [...mend(row.forward.pathIds, row.start, row.end), ...mend(row.back.pathIds, row.n - 1 - row.end, row.n - 1 - row.start)];
  report.push({key: row.key, action: `翻面 ${row.start}–${row.end}`,
    detail: `${row.end - row.start + 1}/${row.n} 區間` + (mended.length ? `；接縫改直走 ${mended.length} 段` : '')});
}

const checked = createRouteRuntime(pack);
for (const [key, route] of Object.entries(pack.routes)) {
  for (let i = 1; i < route.pathIds.length; i++) {
    const a = pack.paths[route.pathIds[i - 1]], b = pack.paths[route.pathIds[i]];
    assert.equal(a.to, b.from, `${key} 在 ${route.stationNames[i]} 前後股道不連續`);
  }
  const built = checked.route(route.pathIds, key.split(':')[0], '#000');
  for (const id of route.pathIds) if (!pack.paths[id].lengthM) pack.paths[id].lengthM = checked.unfold(id).path.length;
  assert.ok(built.path.length > 0);
}
// route-runtime 會把展開後的線形記在 way 上當快取（sourcePath 的 w._path）。
// 那是執行期的東西，寫回檔案會讓封包多出幾百 KB 的重複座標。
for (const way of pack.ways) delete way._path;
fs.writeFileSync(file, JSON.stringify(pack));
for (const row of report) console.log(row.key.padEnd(20), row.action.padEnd(14), row.detail);
console.log({paths: pack.paths.length, 翻面: flipped.length});
