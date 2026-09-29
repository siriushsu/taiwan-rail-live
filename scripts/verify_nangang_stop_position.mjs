import fs from 'node:fs';
import { createRouteRuntime } from '../rail-3d/physical/route-runtime.js';
import { distanceM } from '../rail-3d/integration/train-path.js';

const pack = JSON.parse(fs.readFileSync('rail-3d/physical/metro-network.json'));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
const coordinateOf = nodeId => {
  for (const way of pack.ways) {
    const index = way.nodes.indexOf(nodeId);
    if (index >= 0) return way.coordinates[index];
  }
  return null;
};

const directions = [
  { key: 'mrt:BR:1', stationIndex: -1, pathId: 22, nodeId: '7093644633', oldNodeId: 'metro-stop:310746645:16:59645382' },
  { key: 'mrt:BR:-1', stationIndex: 0, pathId: 23, nodeId: '7093644634', oldNodeId: 'metro-stop:310746644:5:16565840' },
];
const runtime = createRouteRuntime(pack);

for (const test of directions) {
  const routeRecord = pack.routes[test.key];
  expect(Boolean(routeRecord), `${test.key} 路線不存在`);
  if (!routeRecord) continue;
  const stationName = test.stationIndex < 0 ? routeRecord.stationNames.at(-1) : routeRecord.stationNames[0];
  expect(stationName === '南港展覽館', `${test.key} 端點不是南港展覽館，而是 ${stationName}`);
  const official = coordinateOf(test.nodeId), old = coordinateOf(test.oldNodeId);
  expect(Boolean(official), `${test.nodeId} 正式 stop_position 不在打包股道中`);
  expect(pack.nodeTags[test.nodeId]?.public_transport === 'stop_position', `${test.nodeId} 缺少 OSM stop_position 標記`);
  expect(!pack.nodeTags[test.oldNodeId], `${test.oldNodeId} 仍被標成停車點`);
  const pathRecord = pack.paths[test.pathId];
  const actualNodeId = test.stationIndex < 0 ? pathRecord?.to : pathRecord?.from;
  expect(actualNodeId === test.nodeId, `${test.key} 仍停在 ${actualNodeId}，應改用 ${test.nodeId}`);
  if (!official || !routeRecord.pathIds?.length) continue;
  const route = runtime.route(routeRecord.pathIds, 'mrt', '#9B8065');
  const offset = test.stationIndex < 0 ? route.offsets.at(-1) : route.offsets[0];
  const actual = route.path.at(Math.max(0, Math.min(route.path.length, offset)))?.coordinate;
  const error = actual ? distanceM(actual, official) : Infinity;
  expect(error < 0.5, `${test.key} 實際停車位置離正式節點 ${error.toFixed(1)} m`);
  if (old) expect(distanceM(official, old) > 50, `${test.key} 正負控制點距離不足，測試無法攔截原本的彎道位置`);
  console.log(`${test.key}：${error.toFixed(2)} m（正式節點 ${test.nodeId}）`);
}

const builder = fs.readFileSync('scripts/build_metro_physical_routes.mjs', 'utf8');
expect(builder.includes('g.stopCandidates(st,st.system)'), '產生器沒有讀取正式 stop_position');
expect(builder.includes('hit.error<=45&&Math.abs(hit.s-s)<=100'), '產生器沒有用目前路線走廊隔開同名轉乘站');
expect(builder.includes('officialByGroup.get(trackGroup)'), '產生器沒有依股道優先採用正式 stop_position');

if (failures.length) {
  console.error(`南港展覽館停車位置驗收失敗（${failures.length} 項）`);
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}
console.log('南港展覽館停車位置驗收通過：文湖線兩方向均使用月台內的 OSM 正式 stop_position');
