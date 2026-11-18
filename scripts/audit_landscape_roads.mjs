// node scripts/audit_landscape_roads.mjs <與圖磚倉同版的目錄>
// 逐格核對道路檔的雜湊，用正式道路網格和同格地形重畫，再核對三角形、顏色與跨格的道路中心端點。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { roadRibbons } from '../landscape-web/road-ribbons.mjs';
import { TILE_M, buildGrid, decodeTerrain, gridAt } from '../landscape-web/engine/shared/terrain.mjs';

const root = process.argv[2];
if (!root) throw Error('請指定地景圖磚目錄');
const read = (...p) => fs.readFileSync(path.join(root, ...p));
const ids = new Set(Object.keys(JSON.parse(read('index.json')).tiles));
function distanceSquared(p, a, b) {
  const x = b[0] - a[0], y = b[1] - a[1], l = x*x + y*y;
  const f = l ? Math.max(0, Math.min(1, ((p[0]-a[0])*x + (p[1]-a[1])*y)/l)) : 0;
  return (p[0]-a[0]-f*x)**2 + (p[1]-a[1]-f*y)**2;
}
// 獨立對照原始中心線，連分段內插出來的斷面也要對。座標入 GPU 是 Float32，容差 1 mm。
function centerlineIndex(roads) {
  const grid = new Map(), cell = v => Math.floor(v/48);
  for (const road of roads) for (let i = 1; i < road.pts.length; i++) {
    const a = road.pts[i-1], b = road.pts[i], segment = [a,b];
    for (let x = cell(Math.min(a[0], b[0])-.001); x <= cell(Math.max(a[0], b[0])+.001); x++) {
      for (let y = cell(Math.min(a[1], b[1])-.001); y <= cell(Math.max(a[1], b[1])+.001); y++) {
        const k = x*100 + y;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(segment);
      }
    }
  }
  return p => (grid.get(cell(p[0])*100 + cell(p[1])) || []).some(([a,b]) => distanceSquared(p,a,b) < .001**2);
}
const borders = new Map(), counts = { tiles: 0, fragments: 0, decks: 0, flatMeshes: 0, bridgeMeshes: 0, triangles: 0, markedTiles: 0, centerChecks: 0, boundsMatched: 0, neighborPavement: 0, sourceEnds: 0, unresolved: 0 };
for (const id of ids) {
  const bytes = read(id, 'roads.json'), meta = JSON.parse(read(id, 'tile.json'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), meta.files['roads.json'].sha256, id + ' 道路檔雜湊');
  const { roads, piers } = JSON.parse(bytes), flat = [], elevated = [];
  const [, east, north] = /^E(\d+)_N(\d+)$/.exec(id).map(Number);
  for (const r of roads) {
    (r.pts.some(p => p[2] > 0.3) ? elevated : flat).push(r);
    for (const p of [r.pts[0], r.pts.at(-1)]) {
      const de = p[0] === 0 ? -1 : p[0] === TILE_M ? 1 : 0;
      const dn = p[1] === 0 ? -1 : p[1] === TILE_M ? 1 : 0;
      if ((!de && !dn) || !ids.has('E' + (east + de) + '_N' + (north + dn))) continue;
      const key = (east * TILE_M + p[0]).toFixed(2) + ',' + (north * TILE_M + p[1]).toFixed(2) + ',' + r.cls;
      let boundary = borders.get(key);
      if (!boundary) borders.set(key, boundary = { tiles: new Set(), neighbor: 'E' + (east + de) + '_N' + (north + dn),
        p: [p[0] - de*TILE_M, p[1] - dn*TILE_M] });
      boundary.tiles.add(id);
    }
  }
  const grid = buildGrid(decodeTerrain(read(id, 'terrain.bin'))), ground = (x, y) => gridAt(grid, x, y);
  let painted = false;
  const onCenter = centerlineIndex(roads);
  for (const mesh of [roadRibbons(flat, ground, 1, 0, [], 1, 0, 0, 3, roads),
                      roadRibbons(elevated, ground, 1, 0, piers, 1, 1, 1, 0, roads)]) {
    assert.equal(mesh.pos.length, mesh.n * 3, id);
    assert.equal(mesh.nor.length, mesh.n * 4, id);
    assert.equal(mesh.col.length, mesh.n * 4, id);
    assert.ok(mesh.pos.every(Number.isFinite) && mesh.idx.every(i => i < mesh.n), id + ' 頂點／索引');
    assert.equal(mesh.nMain % 3, 0, id);
    for (let i = 0; i < mesh.n; i += 2) {
      // 護欄、路緣白線和橋墩本來就在道路兩側，其餘每一對頂點的中點應落在圖資線形上。
      if ([140, 150, 204].includes(mesh.col[i*4])) continue;
      const m = [(mesh.pos[3*i]+mesh.pos[3*i+3])/2, -(mesh.pos[3*i+2]+mesh.pos[3*i+5])/2];
      assert.ok(onCenter(m), id + ' 斷面偏離道路 ' + m);
      counts.centerChecks++;
    }
    // 白色路緣或黃色中線確實被三角形索引使用。
    if (!painted) painted = mesh.idx.some(i => mesh.col[i * 4] === 148 || mesh.col[i * 4] === 204);
    counts.triangles += mesh.nMain / 3;
  }
  counts.tiles++; counts.fragments += roads.length; counts.decks += elevated.length;
  counts.flatMeshes += flat.length ? 1 : 0; counts.bridgeMeshes += elevated.length ? 1 : 0;
  if (painted) counts.markedTiles++;
  if (counts.tiles % 500 === 0) console.log(counts.tiles + '/' + ids.size);
}
for (const { tiles, neighbor, p } of borders.values()) {
  if (tiles.size > 1) { counts.boundsMatched++; continue; }
  // 接的是鄰格路段中間、分類不同或座標四捨五入時，依實際路面範圍核對。
  const { roads, context } = JSON.parse(read(neighbor, 'roads.json'));
  if (roads.some(r => r.pts.some((a,i) => i && distanceSquared(p, r.pts[i-1], a) <= (r.w/2)**2))) {
    counts.neighborPavement++; continue;
  }
  // 道路本身在磚界結束：帶界外緩衝的原始線形也在同一點終止。
  if (context.some(line => [line[0], line.at(-1)].some(q => q && Math.hypot(p[0]-q[0],p[1]-q[1]) < .02))) counts.sourceEnds++;
  else { counts.unresolved++; console.warn('鄰格未接上的端點', neighbor, p); }
}
console.log(JSON.stringify(counts, null, 2));
assert.equal(counts.unresolved, 0, '請核對未接上的端點');
