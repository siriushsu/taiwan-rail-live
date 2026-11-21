// node scripts/verify_landscape_surface_roads.mjs
import assert from 'node:assert/strict';
// 這支量網站自己的道路畫法（沿圖資收線的黃線、橋面與護欄）：地景引擎的 tw2 標線、T 型墩全關（tw2=0），tw2 那套的畫面另外實拍看。
// shared/tw2.mjs 載入時就讀 location.search，所以要在匯入道路網格之前設好。
globalThis.location = { search: '?tw2=0' };
const { roadRibbons } = await import('../landscape-web/road-ribbons.mjs');
import { surfaceMarkings } from '../landscape-web/surface-markings.mjs';
import { COARSE_N, encodeTerrain } from '../landscape-web/engine/shared/terrain.mjs';

const road = (pts, cls = 'primary', w = 12) => ({ cls, w, pts });
const rank = cls => ({ primary: 6, residential: 3, motorway: 7 })[cls];
const runs = roads => [...surfaceMarkings(roads, rank)].map(run => run.map(p => p.slice(0, 2)));
const main = road([[0, 50], [100, 50]]);
const cross = road([[50, 0], [50, 100]], 'residential', 6);
const branch = road([[50, 50], [50, 100]], 'residential', 6);
const parallel = road([[70, 60], [30, 60]]);

for (const reverse of [false, true]) {
  const travel = r => reverse ? { ...r, pts: [...r.pts].reverse() } : r;
  const spans = r => runs([travel(main), travel(r)]).filter(run => run.every(p => p[1] === 50))
    .map(run => [run[0][0], run.at(-1)[0]].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
  for (const other of [cross, branch]) assert.deepEqual(spans(other), [[0, 46.5], [53.5, 100]]);
  assert.deepEqual(spans(parallel), [[0, 30], [70, 100]]);
  assert.deepEqual(spans(road([[25, 85], [75, 85]])), [[0, 100]]);
  const bend = [main, road([[100, 50], [100, 110]])].map(travel);
  assert.deepEqual(runs(bend), bend.map(r => r.pts));
}
assert.deepEqual(runs([road([[0, 50], [2, 50]])]), [[[0, 50], [2, 50]]]);
assert.deepEqual(runs([road([[0, 50], [100, 50]], 'motorway', 13)]), []);

// 不同高度的道路可以相交，兩層的標線各自連續。
const over = road([[0, 50, 8], [100, 50, 8]]);
assert.deepEqual([...surfaceMarkings([over], rank, [over, cross])], [over.pts]);
const elevatedCross = road([[50, 0, 8], [50, 100, 8]], 'residential', 6);
assert.equal([...surfaceMarkings([over], rank, [over, elevatedCross])].length, 2);

// 有橫坡的彎橋：護欄必須接在本段兩端真正的橋緣上；路面左右共用橋面高。
const curve = road([[0, 0, 8], [9, 0, 8], [9, 0, 8], [17, 5, 8], [17, 35, 8]]);
const geometry = roadRibbons([curve], (x, y) => x * 0.2 + y * 0.1);
const points = channel => Array.from({ length: geometry.n }, (_, i) => i)
  .filter(i => geometry.col[i * 4] === channel)
  .map(i => Array.from(geometry.pos.subarray(i * 3, i * 3 + 3)));
const rims = points(22), walls = points(150);
assert.ok(rims.length > 0 && walls.length > 0);
for (let i = 0; i < rims.length; i += 2) assert.equal(rims[i][1], rims[i + 1][1]);
for (const [x, y, z] of walls) assert.ok(rims.some(([rx, ry, rz]) =>
  rx === x && rz === z && Math.min(Math.abs(y - ry - 0.9), Math.abs(y - ry + 1.4)) < 1e-5));
// 分成兩筆的直角彎，中間一對斷面頂點應完全對上，包括把第二筆反向儲存。
for (const reverse of [false, true]) {
  const turn = road([[20, 0], [20, 20]]);
  if (reverse) turn.pts.reverse();
  const bendMesh = roadRibbons([road([[0, 0], [20, 0]]), turn], () => 0, 0, 0, [], 1, 0, 0, 3);
  const endA = Array.from(bendMesh.pos.slice(12,18));
  const endB = Array.from(reverse ? bendMesh.pos.slice(-6) : bendMesh.pos.slice(18,24));
  if (reverse) endB.push(...endB.splice(0,3));
  assert.deepEqual(endA, endB);
}
const masked = roadRibbons([{ ...over, edgeSkip: [[1, 25, 75]] }], () => 0);
const white = Array.from(masked.idx).filter(i => masked.col[4*i] === 204 && masked.pos[3*i+2] < -50);
assert.ok(white.some(i => masked.pos[3*i] === 25) && white.some(i => masked.pos[3*i] === 75));
assert.ok(white.every(i => masked.pos[3*i] <= 25 || masked.pos[3*i] >= 75));

// 從正式 near 工作入口量路面。重現直路在中段遇到並行匝道，並在路口上方跨過一座橋。
const terrain = encodeTerrain(new Float32Array(COARSE_N ** 2), new Map());
const bridge = road([[10, 10, 8], [90, 90, 8]]);
globalThis.fetch = async url => {
  const name = new URL(url).pathname.split('/').at(-1);
  if (name === 'terrain.bin') return new Response(terrain);
  if (name === 'buildings.json') return Response.json([]);
  if (name === 'roads.json') return Response.json({ roads: [main, parallel, cross, bridge], context: [] });
  return new Response(null, { status: 404 });
};
let message;
globalThis.self = { postMessage: value => { message = value; } };
await import('../landscape-web/engine/tile.worker.js');
await self.onmessage({ data: { type: 'near', url: 'https://tiles.invalid/test/', rdMode: 3, vf: { 'terrain.bin': { v: 'test' } } } });
assert.ok(!message.error, message.error);
const { flat, roads: deck } = message.result;
assert.ok(deck.n > 0);
assert.ok(Math.max(...deck.pos.filter((_, i) => i % 3 === 1)) > 8);
let asphalt = 0, paint = 0;
for (let i = 0; i < flat.n; i += 2) {
  const x = (flat.pos[i * 3] + flat.pos[i * 3 + 3]) / 2;
  const y = -(flat.pos[i * 3 + 2] + flat.pos[i * 3 + 5]) / 2;
  const onRoad = Math.abs(y - 50) < 1e-4 || Math.abs(x - 50) < 1e-4 || Math.abs(y - 60) < 1e-4 && x >= 30 && x <= 70;
  assert.ok(onRoad, '路面或標線偏離圖資 ' + [x, y]);
  if (flat.col[i * 4] > flat.col[i * 4 + 2]) {
    assert.ok(y === 50 && (x <= 30 || x >= 70), '匝道旁或路口有多餘黃線');
    paint++;
  } else asphalt++;
}
assert.ok(asphalt > 0 && paint > 0);
console.log('通過：路面與標線對齊、雙方向、十字／丁字路口、分段彎道、並行匝道、短線接邊與高架橋。');
