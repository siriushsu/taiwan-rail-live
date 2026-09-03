/**
 * track GeoJSON 守門人。每個 G gate 都會印出統計；契約違反 exit 1，
 * 檔案無法讀取或 build 無法執行等基礎故障 exit 2。
 *
 * 執行：node scripts/verify_track_geojson.mjs
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const BUILD_SCRIPT = path.join(ROOT, 'scripts', 'build_track_geojson.mjs');
const OUTPUTS = ['track_lines.geojson', 'track_stations.geojson'];
const RAIL_DIM = 0.40;
const DARK_RAIL_CASE = '#10141c';

const SOURCES = [
  { sys: 'tra_sched', file: 'tra.json' },
  { sys: 'thsr_sched', file: 'thsr_track.json' },
  { sys: 'afr_sched', file: 'afr.json' },
  { sys: 'mrt', file: 'trtc.json' },
  { sys: 'tymc', file: 'tymc.json' },
  { sys: 'ntdlrt', file: 'ntdlrt.json' },
  { sys: 'ntalrt', file: 'ntalrt.json' },
  { sys: 'sanying', file: 'sanying.json' },
  { sys: 'krtc', file: 'krtc.json' },
  { sys: 'tmrt', file: 'tmrt.json' },
];

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const logicalKey = properties => `${properties.sys}\u0000${properties.id}`;
const printableKey = properties => `${properties.sys}/${properties.id}`;
const failures = [];

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

function assertGate(condition, message) {
  if (!condition) failures.push(message);
  return condition;
}

function runBuild() {
  const result = spawnSync(process.execPath, [BUILD_SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`build exit ${result.status}${detail ? `：${detail}` : ''}`);
  }
}

function md5Outputs() {
  return Object.fromEntries(OUTPUTS.map(file => [
    file,
    crypto.createHash('md5').update(fs.readFileSync(path.join(DATA_DIR, file))).digest('hex'),
  ]));
}

function sameHashes(left, right) {
  return OUTPUTS.every(file => left[file] === right[file]);
}

function loadSources() {
  const records = [];
  for (const source of SOURCES) {
    const data = readJson(path.join(DATA_DIR, source.file));
    for (const line of data.lines || []) records.push({ ...source, line });
  }
  return records;
}

function coordinateEqual(left, right) {
  return left[0] === right[0] && left[1] === right[1];
}

function checkG1(records, lineFeatures) {
  const sourceLineCount = records.length;
  const sourceVertexCount = records.reduce((sum, record) => sum + record.line.shape.length, 0);
  const groups = new Map();
  for (const feature of lineFeatures) {
    const key = logicalKey(feature.properties);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(feature);
  }

  let outputVertexCount = 0;
  for (const [key, features] of groups) {
    let vertices = 0;
    for (const [index, feature] of features.entries()) {
      const coordinates = feature.geometry.coordinates;
      vertices += coordinates.length;
      if (index > 0) {
        const previous = features[index - 1].geometry.coordinates;
        assertGate(
          coordinateEqual(previous.at(-1), coordinates[0]),
          `G1 ${key.replace('\u0000', '/')} 的分段 ${index - 1}/${index} 沒有共用同一端點`,
        );
      }
    }
    outputVertexCount += vertices - (features.length - 1);
  }

  assertGate(groups.size === sourceLineCount, `G1 邏輯線數 ${groups.size} != 來源 ${sourceLineCount}`);
  assertGate(outputVertexCount === sourceVertexCount, `G1 頂點 ${outputVertexCount} != 來源 ${sourceVertexCount}`);
  console.log(`G1 頂點守恆：線數 ${groups.size}／頂點 ${outputVertexCount}（來源 ${sourceLineCount}／${sourceVertexCount}；Feature ${lineFeatures.length}）`);
}

function allCoordinates(feature) {
  return feature.geometry.type === 'Point' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
}

function hasSixDecimalPrecision(value) {
  return Math.abs(value * 1e6 - Math.round(value * 1e6)) < 1e-6;
}

function checkG2(records, lineFeatures, stationFeatures) {
  let coordinateCount = 0;
  let invalidCount = 0;
  for (const feature of [...lineFeatures, ...stationFeatures]) {
    for (const coordinate of allCoordinates(feature)) {
      coordinateCount++;
      const [lon, lat] = coordinate;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)
          || lon < 118 || lon > 123 || lat < 21 || lat > 26.5
          || !hasSixDecimalPrecision(lon) || !hasSixDecimalPrecision(lat)) invalidCount++;
    }
  }

  const sourceByKey = new Map(records.map(record => [`${record.sys}\u0000${record.line.id}`, record.line]));
  let propertyErrors = 0;
  for (const feature of lineFeatures) {
    const properties = feature.properties || {};
    const required = ['sys', 'id', 'name', 'color', 'colorDark', 'sortKey', 'kind'];
    if (required.some(key => properties[key] === undefined)
        || properties.kind !== 'track' || !Number.isInteger(properties.sortKey)
        || feature.geometry?.type !== 'LineString') propertyErrors++;
    const source = sourceByKey.get(logicalKey(properties));
    if (!source || properties.color !== source.color || properties.colorDark !== railMix(source.color)) propertyErrors++;
  }
  for (const feature of stationFeatures) {
    const properties = feature.properties || {};
    const required = ['sys', 'lineId', 'name', 'color', 'colorDark'];
    if (required.some(key => properties[key] === undefined) || feature.geometry?.type !== 'Point') propertyErrors++;
    const source = sourceByKey.get(`${properties.sys}\u0000${properties.lineId}`);
    if (!source || properties.color !== source.color || properties.colorDark !== railMix(source.color)) propertyErrors++;
  }
  assertGate(invalidCount === 0, `G2 有 ${invalidCount} 個座標無效、越界或超過小數 6 位`);
  assertGate(propertyErrors === 0, `G2 有 ${propertyErrors} 個 Feature properties/geometry 不合契約`);
  console.log(`G2 座標健全：檢查 ${coordinateCount} 點，違反 ${invalidCount}；properties 違反 ${propertyErrors}`);
}

function distanceToFeature(feature, crossing) {
  let best = Infinity;
  for (const [lon, lat] of feature.geometry.coordinates) {
    const distance = (lat - crossing.lat) ** 2 + (lon - crossing.lon) ** 2;
    if (distance < best) best = distance;
  }
  return best;
}

function resolveFeatures(endpoint, crossing, groups) {
  const sameSystem = [...groups.entries()].filter(([, features]) => features[0].properties.sys === endpoint.sys);
  const exact = sameSystem.filter(([, features]) => features[0].properties.id === endpoint.id);
  const selectedGroups = exact.length ? exact : sameSystem;
  return selectedGroups.map(([, features]) => features.reduce((best, feature) => (
    distanceToFeature(feature, crossing) < distanceToFeature(best, crossing) ? feature : best
  )));
}

function evaluateCrossings(crossings, lineFeatures) {
  const groups = new Map();
  for (const feature of lineFeatures) {
    const key = logicalKey(feature.properties);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(feature);
  }
  const violations = [];
  const unmatched = [];
  for (const [index, crossing] of crossings.entries()) {
    const above = resolveFeatures(crossing.above, crossing, groups);
    const below = resolveFeatures(crossing.below, crossing, groups);
    if (!above.length || !below.length) {
      unmatched.push({ index: index + 1, crossing, above: above.length, below: below.length });
      continue;
    }
    for (const upper of above) for (const lower of below) {
      if (upper.properties.sortKey <= lower.properties.sortKey) {
        violations.push({
          index: index + 1,
          note: crossing.note,
          above: `${printableKey(upper.properties)}:k${upper.properties.sortKey}`,
          below: `${printableKey(lower.properties)}:k${lower.properties.sortKey}`,
        });
      }
    }
  }
  return { violations, unmatched };
}

function printCrossingDetails(result) {
  for (const violation of result.violations) {
    console.error(`  crossing #${violation.index} ${violation.note}：above ${violation.above} <= below ${violation.below}`);
  }
  for (const missing of result.unmatched) {
    console.warn(`  crossing #${missing.index} 對不到：above ${missing.above} 組／below ${missing.below} 組；${missing.crossing.note}`);
  }
}

function checkG3(crossings, lineFeatures) {
  const result = evaluateCrossings(crossings, lineFeatures);
  printCrossingDetails(result);
  assertGate(result.violations.length === 0, `G3 有 ${result.violations.length} 筆 crossing 排序違反`);
  console.log(`G3 交叉口順序：31 筆／違反 ${result.violations.length}／對不到 ${result.unmatched.length}`);
  return result;
}

function checkG4(records, stationFeatures) {
  const sourceStations = records.reduce((sum, record) => sum + record.line.stations.length, 0);
  assertGate(stationFeatures.length === sourceStations, `G4 站點 ${stationFeatures.length} != 來源 ${sourceStations}`);
  console.log(`G4 站點守恆：輸出 ${stationFeatures.length}／來源 ${sourceStations}`);
}

function checkG5(style) {
  const expectedIds = ['track-casing', 'track-line', 'track-stations'];
  const layers = style.layers || [];
  const ids = layers.map(layer => layer.id);
  let errors = 0;
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) errors++;
  for (const [index, layer] of layers.entries()) {
    if (!layer.id || !layer.type || !layer.source || !layer.paint || !Object.keys(layer.paint).length) errors++;
    if (index < 2 && layer.source !== 'track-lines') errors++;
    if (index === 2 && layer.source !== 'track-stations') errors++;
  }
  const casing = layers[0];
  const line = layers[1];
  const stations = layers[2];
  if (!casing || casing.type !== 'line' || casing.paint?.['line-width'] !== 5.6
      || casing.layout?.['line-cap'] !== 'round' || casing.layout?.['line-join'] !== 'round'
      || JSON.stringify(casing.layout?.['line-sort-key']) !== JSON.stringify(['get', 'sortKey'])) errors++;
  if (!line || line.type !== 'line' || line.paint?.['line-width'] !== 3
      || line.layout?.['line-cap'] !== 'round' || line.layout?.['line-join'] !== 'round'
      || JSON.stringify(line.layout?.['line-sort-key']) !== JSON.stringify(['get', 'sortKey'])) errors++;
  if (!stations || stations.type !== 'circle' || stations.minzoom !== 11
      || stations.paint?.['circle-radius'] !== 2.4 || stations.paint?.['circle-stroke-width'] !== 1.5
      || stations.paint?.['circle-stroke-opacity'] !== 0.9) errors++;
  for (const themeName of ['light', 'dark', 'sat']) {
    const theme = style.themes?.[themeName];
    if (!theme) { errors++; continue; }
    for (const id of expectedIds) {
      if (!theme[id]?.paint || !Object.keys(theme[id].paint).length) errors++;
    }
  }
  assertGate(errors === 0, `G5 style 層或主題覆寫有 ${errors} 個契約錯誤`);
  console.log(`G5 style 層：${ids.join(' → ')}；light/dark/sat 覆寫齊全；錯誤 ${errors}`);
}

function checkG6(crossings, lineFeatures, originalResult) {
  const candidateIndex = crossings.findIndex((crossing, index) => (
    !originalResult.unmatched.some(item => item.index === index + 1)
  ));
  if (candidateIndex < 0) {
    assertGate(false, 'G6 找不到可做正向對照的 crossing');
    console.log('G6 正向對照：無可用 crossing');
    return;
  }
  const mutated = structuredClone(crossings);
  [mutated[candidateIndex].above, mutated[candidateIndex].below] = [
    mutated[candidateIndex].below,
    mutated[candidateIndex].above,
  ];
  const mutatedResult = evaluateCrossings(mutated, lineFeatures);
  const restoredResult = evaluateCrossings(crossings, lineFeatures);
  assertGate(mutatedResult.violations.length > 0, 'G6 對調 crossing 後沒有變紅，G3 沒有牙');
  assertGate(restoredResult.violations.length === 0, 'G6 還原 crossing 後沒有變綠');
  console.log(`G6 正向對照：對調 #${candidateIndex + 1} 後違反 ${mutatedResult.violations.length}（紅）；還原後 ${restoredResult.violations.length}（綠）`);
}

function main() {
  const records = loadSources();
  const crossings = readJson(path.join(DATA_DIR, 'rail_crossing_levels.json')).crossings;

  // G0 磁碟＝重建:先記下 data/ 裡「已提交」的兩個 geojson 的 md5,再重跑 build 比對。少了這條,本腳本會先重建再檢查,
  // 等於永遠只驗 build 演算法、驗不到磁碟上那份(手改過或忘了重跑 build 的檔都會綠;2026-09-03 收貨時用磁碟突變抓到)。
  const committedHashes = OUTPUTS.every(file => fs.existsSync(path.join(DATA_DIR, file))) ? md5Outputs() : null;
  runBuild();
  const firstHashes = md5Outputs();
  runBuild();
  const secondHashes = md5Outputs();

  const fresh = Boolean(committedHashes) && sameHashes(committedHashes, firstHashes);
  assertGate(fresh, committedHashes
    ? 'G0 磁碟上的 geojson 不等於重建結果(手改過或忘了重跑 npm run build-track-geojson)'
    : 'G0 磁碟上缺 geojson 產出檔');
  console.log(`G0 磁碟＝重建：${fresh ? 'PASS' : 'FAIL'}；${OUTPUTS.map(file => `${file}=${committedHashes ? committedHashes[file] : '缺檔'}`).join('；')}`);

  const lines = readJson(path.join(DATA_DIR, 'track_lines.geojson'));
  const stations = readJson(path.join(DATA_DIR, 'track_stations.geojson'));
  const style = readJson(path.join(DATA_DIR, 'track_style_layers.json'));
  assertGate(lines.type === 'FeatureCollection' && Array.isArray(lines.features), 'track_lines 不是 FeatureCollection');
  assertGate(stations.type === 'FeatureCollection' && Array.isArray(stations.features), 'track_stations 不是 FeatureCollection');

  checkG1(records, lines.features);
  checkG2(records, lines.features, stations.features);
  const g3 = checkG3(crossings, lines.features);
  checkG4(records, stations.features);
  checkG5(style);
  checkG6(crossings, lines.features, g3);

  const reproducible = sameHashes(firstHashes, secondHashes);
  assertGate(reproducible, 'G7 build 連跑兩次 md5 不同');
  console.log(`G7 可重現：${reproducible ? 'PASS' : 'FAIL'}；${OUTPUTS.map(file => `${file}=${secondHashes[file]}`).join('；')}`);

  if (failures.length) {
    console.error(`\nFAIL：${failures.length} 項`);
    failures.forEach(message => console.error(`- ${message}`));
    process.exitCode = 1;
  } else {
    console.log('\nPASS：G0–G7 全綠');
  }
}

try {
  main();
} catch (error) {
  console.error(`verify-track-geojson 基礎故障：${error.message}`);
  process.exitCode = 2;
}
