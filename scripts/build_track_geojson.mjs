/**
 * 將目前 canvas 軌道來源整理成 MapLibre 可直接載入的 GeoJSON。
 *
 * 輸入：SYS_DEFS 實際使用的 3 個國鐵軌道檔與 7 個捷運／輕軌檔，另讀
 * data/rail_crossing_levels.json 決定 line-sort-key。全程只讀本機檔案。
 *
 * 重建：node scripts/build_track_geojson.mjs
 * 驗證：node scripts/verify_track_geojson.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const RAIL_DIM = 0.40;
const DARK_RAIL_CASE = '#10141c';

const SOURCES = [
  { sys: 'tra_sched', label: '台鐵', file: 'tra.json' },
  { sys: 'thsr_sched', label: '高鐵', file: 'thsr_track.json' },
  { sys: 'afr_sched', label: '阿里山林鐵', file: 'afr.json' },
  { sys: 'mrt', label: '台北捷運', file: 'trtc.json' },
  { sys: 'tymc', label: '桃園機捷', file: 'tymc.json' },
  { sys: 'ntdlrt', label: '淡海輕軌', file: 'ntdlrt.json' },
  { sys: 'ntalrt', label: '安坑輕軌', file: 'ntalrt.json' },
  { sys: 'sanying', label: '三鶯線', file: 'sanying.json' },
  { sys: 'krtc', label: '高雄捷運', file: 'krtc.json' },
  { sys: 'tmrt', label: '台中捷運', file: 'tmrt.json' },
];

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const lineKey = (sys, id) => `${sys}\u0000${id}`;
const displayKey = key => key.replace('\u0000', '/');
const round6 = value => Number(Number(value).toFixed(6));

function railMix(color, keep = RAIL_DIM, base = DARK_RAIL_CASE) {
  if (!/^#[0-9a-fA-F]{6}$/.test(color) || !/^#[0-9a-fA-F]{6}$/.test(base)) return color;
  const ch = (value, index) => parseInt(value.slice(index, index + 2), 16);
  let out = '#';
  for (const index of [1, 3, 5]) {
    out += Math.round(ch(color, index) * keep + ch(base, index) * (1 - keep))
      .toString(16).padStart(2, '0');
  }
  return out;
}

function loadLines() {
  const records = [];
  for (const source of SOURCES) {
    const data = readJson(path.join(DATA_DIR, source.file));
    if (!Array.isArray(data.lines)) throw new Error(`${source.file} 缺少 lines[]`);
    for (const line of data.lines) {
      if (!line.id || !Array.isArray(line.shape) || line.shape.length < 2 || !Array.isArray(line.stations)) {
        throw new Error(`${source.file} 的路線 ${line.id || '(無 id)'} 結構不完整`);
      }
      records.push({ ...source, line, key: lineKey(source.sys, line.id) });
    }
  }
  return records;
}

function resolveLineRecords(endpoint, records) {
  const sameSystem = records.filter(record => record.sys === endpoint.sys);
  const exact = sameSystem.filter(record => record.line.id === endpoint.id);
  return exact.length ? exact : sameSystem;
}

function crossingEdges(crossings, records) {
  const edges = [];
  const unmatched = [];
  for (const [index, crossing] of crossings.entries()) {
    const below = resolveLineRecords(crossing.below, records);
    const above = resolveLineRecords(crossing.above, records);
    if (!below.length || !above.length) {
      unmatched.push({ index, crossing, below: below.length, above: above.length });
      continue;
    }
    for (const lower of below) for (const upper of above) {
      if (lower.key !== upper.key) edges.push([lower.key, upper.key]);
    }
  }
  return { edges, unmatched };
}

function cyclicNodes(nodes, edges) {
  const adjacency = new Map(nodes.map(node => [node, []]));
  for (const [from, to] of edges) adjacency.get(from)?.push(to);
  let nextIndex = 0;
  const indices = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const cyclic = new Set();

  function visit(node) {
    indices.set(node, nextIndex);
    low.set(node, nextIndex++);
    stack.push(node);
    onStack.add(node);
    for (const target of adjacency.get(node)) {
      if (!indices.has(target)) {
        visit(target);
        low.set(node, Math.min(low.get(node), low.get(target)));
      } else if (onStack.has(target)) {
        low.set(node, Math.min(low.get(node), indices.get(target)));
      }
    }
    if (low.get(node) !== indices.get(node)) return;
    const component = [];
    let current;
    do {
      current = stack.pop();
      onStack.delete(current);
      component.push(current);
    } while (current !== node);
    const selfLoop = component.length === 1 && adjacency.get(component[0]).includes(component[0]);
    if (component.length > 1 || selfLoop) component.forEach(key => cyclic.add(key));
  }

  for (const node of nodes) if (!indices.has(node)) visit(node);
  return cyclic;
}

function nearestShapeIndex(shape, crossing) {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < shape.length; index++) {
    const point = shape[index];
    const distance = (point[0] - crossing.lat) ** 2 + (point[1] - crossing.lon) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function cutIndicesFor(record, crossings, records, cyclic) {
  if (!cyclic.has(record.key)) return [];
  const indices = [];
  for (const crossing of crossings) {
    const sides = ['above', 'below'];
    if (!sides.some(side => resolveLineRecords(crossing[side], records).some(item => item.key === record.key))) continue;
    indices.push(nearestShapeIndex(record.line.shape, crossing));
  }
  return [...new Set(indices)].sort((a, b) => a - b);
}

function clusterNearbyIndices(indices) {
  const clusters = [];
  for (const index of indices) {
    const last = clusters.at(-1);
    // 同一個實體交叉點的資料座標可能讓相鄰頂點分別成為最近點；合成一個局部段。
    if (last && index - last.at(-1) <= 2) last.push(index);
    else clusters.push([index]);
  }
  return clusters;
}

function splitRecord(record, cutIndices) {
  const lastIndex = record.line.shape.length - 1;
  if (!cutIndices.length) {
    return [{ uid: `${record.key}\u00000`, record, start: 0, end: lastIndex, cutIndices: [], local: false }];
  }

  const clusters = clusterNearbyIndices(cutIndices).map(indices => ({
    cutIndices: indices,
    start: Math.max(0, indices[0] - 1),
    end: Math.min(lastIndex, indices.at(-1) + 1),
  }));
  const segments = [];
  let cursor = 0;
  const add = (start, end, local, indices = []) => {
    if (end <= start) return;
    segments.push({
      uid: `${record.key}\u0000${segments.length}`,
      record,
      start,
      end,
      cutIndices: indices,
      local,
    });
  };
  for (const cluster of clusters) {
    add(cursor, cluster.start, false);
    add(cluster.start, cluster.end, true, cluster.cutIndices);
    cursor = cluster.end;
  }
  add(cursor, lastIndex, false);
  return segments;
}

function topologicalRanks(features, edges) {
  const nodes = features.map(feature => feature.uid);
  const adjacency = new Map(nodes.map(node => [node, new Set()]));
  const indegree = new Map(nodes.map(node => [node, 0]));
  for (const [from, to] of edges) {
    if (from === to || adjacency.get(from).has(to)) continue;
    adjacency.get(from).add(to);
    indegree.set(to, indegree.get(to) + 1);
  }
  const ready = nodes.filter(node => indegree.get(node) === 0).sort();
  const order = [];
  while (ready.length) {
    const node = ready.shift();
    order.push(node);
    for (const target of [...adjacency.get(node)].sort()) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) {
        ready.push(target);
        ready.sort();
      }
    }
  }
  if (order.length !== nodes.length) throw new Error('分段後的 crossing sortKey 圖仍有環');
  const ranks = new Map(nodes.map(node => [node, 0]));
  for (const node of order) {
    for (const target of adjacency.get(node)) {
      ranks.set(target, Math.max(ranks.get(target), ranks.get(node) + 1));
    }
  }
  return ranks;
}

function segmentAtCrossing(record, segmentsByLine, crossing) {
  const segments = segmentsByLine.get(record.key);
  if (segments.length === 1) return segments[0];
  const nearest = nearestShapeIndex(record.line.shape, crossing);
  const local = segments.find(segment => segment.local && segment.cutIndices.includes(nearest));
  if (!local) throw new Error(`${displayKey(record.key)} 的 crossing 最近點 ${nearest} 未落在局部段`);
  return local;
}

function build() {
  const records = loadLines();
  const crossingData = readJson(path.join(DATA_DIR, 'rail_crossing_levels.json'));
  if (!Array.isArray(crossingData.crossings)) throw new Error('rail_crossing_levels.json 缺少 crossings[]');
  const crossings = crossingData.crossings;
  const logical = crossingEdges(crossings, records);
  const cyclic = cyclicNodes(records.map(record => record.key), logical.edges);

  const segmentsByLine = new Map();
  for (const record of records) {
    const cuts = cutIndicesFor(record, crossings, records, cyclic);
    segmentsByLine.set(record.key, splitRecord(record, cuts));
  }
  const segments = records.flatMap(record => segmentsByLine.get(record.key));

  const featureEdges = [];
  for (const crossing of crossings) {
    const below = resolveLineRecords(crossing.below, records);
    const above = resolveLineRecords(crossing.above, records);
    if (!below.length || !above.length) continue;
    for (const lower of below) for (const upper of above) {
      const from = segmentAtCrossing(lower, segmentsByLine, crossing);
      const to = segmentAtCrossing(upper, segmentsByLine, crossing);
      if (from.uid !== to.uid) featureEdges.push([from.uid, to.uid]);
    }
  }
  const ranks = topologicalRanks(segments, featureEdges);

  const lineFeatures = segments.map(segment => {
    const { record } = segment;
    return {
      type: 'Feature',
      properties: {
        sys: record.sys,
        id: record.line.id,
        name: record.line.name,
        color: record.line.color,
        colorDark: railMix(record.line.color),
        sortKey: ranks.get(segment.uid),
        kind: 'track',
      },
      geometry: {
        type: 'LineString',
        coordinates: record.line.shape.slice(segment.start, segment.end + 1)
          .map(([lat, lon]) => [round6(lon), round6(lat)]),
      },
    };
  });

  const stationFeatures = records.flatMap(record => record.line.stations.map(station => ({
    type: 'Feature',
    properties: {
      sys: record.sys,
      lineId: record.line.id,
      name: station.name,
      color: record.line.color,
      colorDark: railMix(record.line.color),
    },
    geometry: {
      type: 'Point',
      coordinates: [round6(station.lon), round6(station.lat)],
    },
  })));

  fs.writeFileSync(path.join(DATA_DIR, 'track_lines.geojson'), `${JSON.stringify({
    type: 'FeatureCollection',
    features: lineFeatures,
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(DATA_DIR, 'track_stations.geojson'), `${JSON.stringify({
    type: 'FeatureCollection',
    features: stationFeatures,
  }, null, 2)}\n`);

  const sourceVertices = records.reduce((sum, record) => sum + record.line.shape.length, 0);
  console.log(`完成：來源線數 ${records.length}／頂點 ${sourceVertices}／站點 ${stationFeatures.length}`);
  console.log(`輸出：LineString Feature ${lineFeatures.length}（分段增加 ${lineFeatures.length - records.length}）`);
  console.log(`sortKey：${cyclic.size ? `全線圖有環，局部分段 ${cyclic.size} 條` : '全線拓撲排序，未切段'}；對不到 crossing ${logical.unmatched.length} 筆`);
  for (const record of records.filter(item => cyclic.has(item.key))) {
    const details = segmentsByLine.get(record.key)
      .map(segment => `${segment.start}–${segment.end}:k${ranks.get(segment.uid)}${segment.local ? '*' : ''}`)
      .join('、');
    console.log(`  ${displayKey(record.key)} ${details}`);
  }
}

try {
  build();
} catch (error) {
  console.error(`build-track-geojson 失敗：${error.message}`);
  process.exitCode = 1;
}
