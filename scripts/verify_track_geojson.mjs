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

// 來源、產出與 index.html 永遠取自本腳本所在的那棵樹。原本有個 TRACK_SOURCE_ROOT 環境變數供沙箱
// 隔離目錄用,交付後拔掉:「驗哪個目錄」的可覆寫參數會讓守門人悄悄改讀別棵樹,綠了也不知道量的是誰。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const SOURCE_DATA_DIR = DATA_DIR;
const BUILD_SCRIPT = path.join(ROOT, 'scripts', 'build_track_geojson.mjs');
const INDEX_HTML = path.join(ROOT, 'index.html');
const OUTPUTS = ['track_lines.geojson', 'track_stations.geojson'];

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

function railMix(color, keep, base) {
  if (!/^#[0-9a-fA-F]{6}$/.test(color) || !/^#[0-9a-fA-F]{6}$/.test(base)) return color;
  const ch = (value, index) => parseInt(value.slice(index, index + 2), 16);
  let out = '#';
  for (const index of [1, 3, 5]) {
    out += Math.round(ch(color, index) * keep + ch(base, index) * (1 - keep))
      .toString(16).padStart(2, '0');
  }
  return out;
}

function requiredCapture(text, regex, label) {
  const match = text.match(regex);
  if (!match) throw new Error(`無法從 index.html parse ${label}`);
  return match[1];
}

function parseNumberConstant(html, name) {
  const raw = requiredCapture(
    html,
    new RegExp(`\\b${name}\\s*=\\s*(\\.?\\d+(?:\\.\\d+)?)\\b`),
    name,
  );
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`index.html 的 ${name} 不是有限數字`);
  return value;
}

function parseQuotedProperty(block, name, label) {
  return requiredCapture(block, new RegExp(`\\b${name}\\s*:\\s*['\"]([^'\"]+)['\"]`), label);
}

function parseIndexColorContract() {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const mixNames = ['RAIL_DIM', 'FOLLOW_DIM', 'FAINT_GLOW', 'FAINT_LIGHT', 'GHOST_GLOW', 'GHOST_LIGHT'];
  const mix = Object.fromEntries(mixNames.map(name => [name, parseNumberConstant(html, name)]));
  const paletteBlock = requiredCapture(html, /const\s+MAP_PAL\s*=\s*\{([\s\S]*?)\n\};/, 'MAP_PAL');
  const roles = ['railCase', 'stnFill', 'followCase', 'collectGrey'];
  const palette = {};
  for (const theme of ['light', 'dark', 'sat']) {
    const themeBlock = requiredCapture(
      paletteBlock,
      new RegExp(`\\b${theme}\\s*:\\s*\\{([^}]+)\\}`),
      `MAP_PAL.${theme}`,
    );
    palette[theme] = Object.fromEntries(roles.map(role => [
      role,
      parseQuotedProperty(themeBlock, role, `MAP_PAL.${theme}.${role}`),
    ]));
  }
  return { html, mix, palette, parsedCount: mixNames.length + roles.length * 3 };
}

function parseInlineStyleObject(block, label) {
  const colorKeys = ['fillColor', 'color'];
  const numberKeys = ['fillOpacity', 'opacity', 'weight'];
  const parsed = {};
  for (const key of colorKeys) parsed[key] = parseQuotedProperty(block, key, `${label}.${key}`);
  for (const key of numberKeys) {
    const raw = requiredCapture(
      block,
      new RegExp(`\\b${key}\\s*:\\s*(\\.?\\d+(?:\\.\\d+)?)\\b`),
      `${label}.${key}`,
    );
    parsed[key] = Number(raw);
    if (!Number.isFinite(parsed[key])) throw new Error(`index.html 的 ${label}.${key} 不是有限數字`);
  }
  return parsed;
}

function parseOfflineLandContract(html) {
  const body = requiredCapture(
    html,
    /function\s+offlineLandStyle\s*\(\)\s*\{([\s\S]*?)\n\}/,
    'offlineLandStyle()',
  );
  const sat = requiredCapture(
    body,
    /if\s*\(state\.basemap\s*===\s*['\"]sat['\"]\)\s*return\s*\{([^}]+)\}/,
    'offlineLandStyle().sat',
  );
  const dark = requiredCapture(
    body,
    /if\s*\(state\.mapDark\)\s*return\s*\{([^}]+)\}/,
    'offlineLandStyle().dark',
  );
  const returns = [...body.matchAll(/return\s*\{([^}]+)\}/g)];
  if (returns.length !== 3) throw new Error(`offlineLandStyle() return 分支數 ${returns.length} != 3`);
  return {
    light: parseInlineStyleObject(returns.at(-1)[1], 'offlineLandStyle().light'),
    dark: parseInlineStyleObject(dark, 'offlineLandStyle().dark'),
    sat: parseInlineStyleObject(sat, 'offlineLandStyle().sat'),
    parsedCount: 15,
  };
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
    const data = readJson(path.join(SOURCE_DATA_DIR, source.file));
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

function checkG2(records, lineFeatures, stationFeatures, contract) {
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
    const required = ['sys', 'id', 'lineKey', 'name', 'color', 'colorDark', 'sortKey', 'kind'];
    if (required.some(key => properties[key] === undefined)
        || properties.kind !== 'track' || !Number.isInteger(properties.sortKey)
        || feature.geometry?.type !== 'LineString') propertyErrors++;
    const source = sourceByKey.get(logicalKey(properties));
    if (!source || properties.color !== source.color
        || properties.lineKey !== `${properties.sys}|${properties.id}`
        || properties.colorDark !== railMix(
          source.color,
          contract.mix.RAIL_DIM,
          contract.palette.dark.railCase,
        )) propertyErrors++;
  }
  for (const feature of stationFeatures) {
    const properties = feature.properties || {};
    const required = ['sys', 'lineId', 'lineKey', 'name', 'color', 'colorDark'];
    if (required.some(key => properties[key] === undefined) || feature.geometry?.type !== 'Point') propertyErrors++;
    const source = sourceByKey.get(`${properties.sys}\u0000${properties.lineId}`);
    if (!source || properties.color !== source.color
        || properties.lineKey !== `${properties.sys}|${properties.lineId}`
        || properties.colorDark !== railMix(
          source.color,
          contract.mix.RAIL_DIM,
          contract.palette.dark.railCase,
        )) propertyErrors++;
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

function runtimeColors(color, contract) {
  const { mix, palette } = contract;
  return {
    colorDark: railMix(color, mix.RAIL_DIM, palette.dark.railCase),
    colorFaintLight: railMix(color, mix.FAINT_LIGHT, palette.light.railCase),
    colorFaintDark: railMix(color, mix.FAINT_GLOW, palette.dark.railCase),
    colorFaintSat: railMix(color, mix.FAINT_GLOW, palette.sat.railCase),
    colorHiddenLight: railMix(color, mix.GHOST_LIGHT, palette.light.railCase),
    colorHiddenDark: railMix(color, mix.GHOST_GLOW, palette.dark.railCase),
    colorHiddenSat: railMix(color, mix.GHOST_GLOW, palette.sat.railCase),
    colorFollowDark: railMix(color, mix.FOLLOW_DIM, palette.dark.railCase),
  };
}

function evaluateG8(records, lineFeatures, stationFeatures, contract) {
  const sourceByKey = new Map(records.map(record => [`${record.sys}\u0000${record.line.id}`, record.line]));
  const stateKeys = [
    'colorDark',
    'colorFaintLight',
    'colorFaintDark',
    'colorFaintSat',
    'colorHiddenLight',
    'colorHiddenDark',
    'colorHiddenSat',
  ];
  let lineMismatches = 0;
  let stationMismatches = 0;
  let followMismatches = 0;

  for (const feature of lineFeatures) {
    const properties = feature.properties || {};
    const source = sourceByKey.get(`${properties.sys}\u0000${properties.id}`);
    if (!source) {
      lineMismatches += stateKeys.length;
      followMismatches++;
      continue;
    }
    const expected = runtimeColors(source.color, contract);
    for (const key of stateKeys) if (properties[key] !== expected[key]) lineMismatches++;
    if (properties.colorFollowDark !== expected.colorFollowDark) followMismatches++;
  }

  for (const feature of stationFeatures) {
    const properties = feature.properties || {};
    const source = sourceByKey.get(`${properties.sys}\u0000${properties.lineId}`);
    if (!source) {
      stationMismatches += stateKeys.length;
      followMismatches++;
      continue;
    }
    const expected = runtimeColors(source.color, contract);
    for (const key of stateKeys) if (properties[key] !== expected[key]) stationMismatches++;
    if (properties.colorFollowDark !== expected.colorFollowDark) followMismatches++;
  }

  return { lineMismatches, stationMismatches, followMismatches };
}

function checkG8(records, lineFeatures, stationFeatures, contract) {
  const baseline = evaluateG8(records, lineFeatures, stationFeatures, contract);
  assertGate(baseline.lineMismatches === 0, `G8 線 Feature 狀態色有 ${baseline.lineMismatches} 個不符`);
  assertGate(baseline.stationMismatches === 0, `G8 站點 Feature 狀態色有 ${baseline.stationMismatches} 個不符`);
  assertGate(baseline.followMismatches === 0, `G8 follow dark 色有 ${baseline.followMismatches} 個不符`);

  const mutatedContract = structuredClone(contract);
  mutatedContract.mix.RAIL_DIM = 0.99;
  const mutated = evaluateG8(records, lineFeatures, stationFeatures, mutatedContract);
  const restored = evaluateG8(records, lineFeatures, stationFeatures, contract);
  assertGate(mutated.lineMismatches > 0, 'G8 把 parse 到的 RAIL_DIM 改為 0.99 後沒有變紅');
  assertGate(
    restored.lineMismatches === 0 && restored.stationMismatches === 0 && restored.followMismatches === 0,
    'G8 還原 parse 常數後沒有變綠',
  );
  console.log(
    `G8 常數不同源：parse 到 ${contract.parsedCount} 個常數／比對 ${lineFeatures.length} 條線／不符 ${baseline.lineMismatches}`
      + `；站點 ${stationFeatures.length}／不符 ${baseline.stationMismatches}；follow 不符 ${baseline.followMismatches}`
      + `；RAIL_DIM→0.99 後不符 ${mutated.lineMismatches}（紅）／還原 ${restored.lineMismatches}（綠）`,
  );
}

const jsonEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function offlineThemePaint(sourceStyle) {
  return {
    'offline-land-fill': {
      'fill-color': sourceStyle.fillColor,
      'fill-opacity': sourceStyle.fillOpacity,
    },
    'offline-land-line': {
      'line-color': sourceStyle.color,
      'line-opacity': sourceStyle.opacity,
      'line-width': sourceStyle.weight,
    },
  };
}

function evaluateG9(style, landContract, landData) {
  const errors = [];
  const layers = style.layers || [];
  const expectedLayerMeta = [
    { id: 'offline-land-fill', type: 'fill' },
    { id: 'offline-land-line', type: 'line' },
  ];
  if (style.source?.id !== 'offline-land' || style.source?.type !== 'geojson'
      || style.source?.data !== 'data/taiwan_land.json') errors.push('source 契約');
  for (const [index, expected] of expectedLayerMeta.entries()) {
    const layer = layers[index];
    if (!layer || layer.id !== expected.id || layer.type !== expected.type
        || layer.source !== 'offline-land') errors.push(`layer ${expected.id}`);
  }
  if (layers.length !== 2) errors.push(`layer 數 ${layers.length}`);

  for (const theme of ['light', 'dark', 'sat']) {
    const expected = offlineThemePaint(landContract[theme]);
    for (const id of Object.keys(expected)) {
      if (!jsonEqual(style.themes?.[theme]?.[id]?.paint, expected[id])) {
        errors.push(`${theme}.${id}.paint`);
      }
    }
  }
  const light = offlineThemePaint(landContract.light);
  if (!jsonEqual(layers[0]?.paint, light['offline-land-fill'])) errors.push('layers fill 預設');
  if (!jsonEqual(layers[1]?.paint, light['offline-land-line'])) errors.push('layers line 預設');
  if (!style._readme?.includes('圖磚層之下') || !style._readme?.includes('data/taiwan_land.json')) {
    errors.push('_readme 位置或資料來源');
  }

  const polygonCount = landData.geometry?.type === 'MultiPolygon'
    && Array.isArray(landData.geometry.coordinates)
    ? landData.geometry.coordinates.length
    : -1;
  if (landData.type !== 'Feature' || landData.geometry?.type !== 'MultiPolygon' || polygonCount !== 39) {
    errors.push('taiwan_land 幾何契約');
  }
  return { errors, polygonCount };
}

function changeLastHexDigit(color) {
  const last = color.at(-1).toLowerCase();
  return `${color.slice(0, -1)}${last === '0' ? '1' : '0'}`;
}

function checkG9(style, landContract, landData) {
  const baseline = evaluateG9(style, landContract, landData);
  assertGate(baseline.errors.length === 0, `G9 離線陸地有 ${baseline.errors.length} 個錯誤：${baseline.errors.join('、')}`);

  const mutatedStyle = structuredClone(style);
  const paint = mutatedStyle.themes.light['offline-land-fill'].paint;
  paint['fill-color'] = changeLastHexDigit(paint['fill-color']);
  const mutated = evaluateG9(mutatedStyle, landContract, landData);
  const restored = evaluateG9(style, landContract, landData);
  assertGate(mutated.errors.length > 0, 'G9 fill-color 改一碼後沒有變紅');
  assertGate(restored.errors.length === 0, 'G9 還原 offline land style 後沒有變綠');
  console.log(
    `G9 離線陸地：parse 到 ${landContract.parsedCount} 個 style 值／2 層／3 主題／polygon ${baseline.polygonCount}`
      + `／不符 ${baseline.errors.length}；fill-color 改一碼 ${mutated.errors.length}（紅）／還原 ${restored.errors.length}（綠）`,
  );
}

function propertyExpression(name) {
  return ['get', name];
}

function statePaint(contract, state, theme) {
  const palette = contract.palette[theme];
  let lineColor;
  if (state === 'collect') lineColor = palette.collectGrey;
  else if (state === 'auto') lineColor = propertyExpression(theme === 'dark' ? 'colorDark' : 'color');
  else {
    const suffix = `${theme[0].toUpperCase()}${theme.slice(1)}`;
    lineColor = propertyExpression(`color${state[0].toUpperCase()}${state.slice(1)}${suffix}`);
  }
  return {
    'track-casing': { 'line-color': palette.railCase },
    'track-line': { 'line-color': lineColor },
    'track-stations': {
      'circle-color': palette.stnFill,
      'circle-stroke-color': lineColor,
    },
  };
}

function evaluateG10(style, contract) {
  const errors = [];
  const states = ['auto', 'faint', 'hidden', 'collect'];
  const themes = ['light', 'dark', 'sat'];
  const layerIds = ['track-casing', 'track-line', 'track-stations'];
  for (const state of states) for (const theme of themes) {
    const expected = statePaint(contract, state, theme);
    for (const id of layerIds) {
      const paint = style.states?.[state]?.[theme]?.[id]?.paint;
      if (!paint || !Object.keys(paint).length) errors.push(`${state}.${theme}.${id} 缺 paint`);
      else if (!jsonEqual(paint, expected[id])) errors.push(`${state}.${theme}.${id}.paint`);
    }
  }
  if (!jsonEqual(style.states?.auto, style.themes)) errors.push('states.auto != themes');

  const template = ['in', ['get', 'lineKey'], ['literal', []]];
  const follow = style.followLayers?.layers || [];
  const followMeta = [
    { id: 'track-follow-casing', width: 8.5 },
    { id: 'track-follow-line', width: 4.4 },
  ];
  for (const [index, expected] of followMeta.entries()) {
    const layer = follow[index];
    if (!layer || layer.id !== expected.id || layer.type !== 'line' || layer.source !== 'track-lines'
        || layer.paint?.['line-width'] !== expected.width
        || layer.layout?.['line-cap'] !== 'round' || layer.layout?.['line-join'] !== 'round'
        || !jsonEqual(layer.layout?.['line-sort-key'], ['get', 'sortKey'])
        || !jsonEqual(layer.filter, template)) errors.push(`follow layer ${expected.id}`);
  }
  if (follow.length !== 2) errors.push(`follow layer 數 ${follow.length}`);
  for (const theme of themes) {
    const palette = contract.palette[theme];
    const casingPaint = style.followLayers?.themes?.[theme]?.['track-follow-casing']?.paint;
    const linePaint = style.followLayers?.themes?.[theme]?.['track-follow-line']?.paint;
    if (!jsonEqual(casingPaint, { 'line-color': palette.followCase })) {
      errors.push(`follow ${theme} casing paint`);
    }
    const expectedLine = propertyExpression(theme === 'dark' ? 'colorFollowDark' : 'color');
    if (!jsonEqual(linePaint, { 'line-color': expectedLine })) errors.push(`follow ${theme} line paint`);
  }
  if (!jsonEqual(style.visibilityFilter?.filter, template)) errors.push('visibilityFilter');
  if (!style._readme?.includes('states.auto') || !style._readme?.includes('themes')) {
    errors.push('_readme states/themes 關係');
  }
  if (!style._readme?.includes('hidden') || !style.followLayers?._readme?.includes('整組關掉')) {
    errors.push('_readme hidden follow 契約');
  }
  return errors;
}

function checkG10(style, contract) {
  const baseline = evaluateG10(style, contract);
  assertGate(baseline.length === 0, `G10 states/follow 有 ${baseline.length} 個錯誤：${baseline.join('、')}`);

  const mutatedStyle = structuredClone(style);
  delete mutatedStyle.states.faint.dark;
  const mutated = evaluateG10(mutatedStyle, contract);
  const restored = evaluateG10(style, contract);
  assertGate(mutated.length > 0, 'G10 拿掉 states.faint.dark 後沒有變紅');
  assertGate(restored.length === 0, 'G10 還原 states.faint.dark 後沒有變綠');
  console.log(
    `G10 states/follow：4 states × 3 themes × 3 layers = 36 paint；follow 2 層；錯誤 ${baseline.length}`
      + `；移除 faint.dark ${mutated.length}（紅）／還原 ${restored.length}（綠）`,
  );
}

function main() {
  let colorContract;
  let landContract;
  try {
    colorContract = parseIndexColorContract();
  } catch (error) {
    console.error(`G8 常數不同源：FAIL；${error.message}；不使用 fallback`);
    process.exitCode = 1;
    return;
  }
  try {
    landContract = parseOfflineLandContract(colorContract.html);
  } catch (error) {
    console.error(`G9 離線陸地：FAIL；${error.message}；不使用 fallback`);
    process.exitCode = 1;
    return;
  }

  const records = loadSources();
  const crossings = readJson(path.join(SOURCE_DATA_DIR, 'rail_crossing_levels.json')).crossings;

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
  const offlineStyle = readJson(path.join(DATA_DIR, 'offline_land_style.json'));
  const landData = readJson(path.join(SOURCE_DATA_DIR, 'taiwan_land.json'));
  assertGate(lines.type === 'FeatureCollection' && Array.isArray(lines.features), 'track_lines 不是 FeatureCollection');
  assertGate(stations.type === 'FeatureCollection' && Array.isArray(stations.features), 'track_stations 不是 FeatureCollection');

  checkG1(records, lines.features);
  checkG2(records, lines.features, stations.features, colorContract);
  const g3 = checkG3(crossings, lines.features);
  checkG4(records, stations.features);
  checkG5(style);
  checkG6(crossings, lines.features, g3);

  const reproducible = sameHashes(firstHashes, secondHashes);
  assertGate(reproducible, 'G7 build 連跑兩次 md5 不同');
  console.log(`G7 可重現：${reproducible ? 'PASS' : 'FAIL'}；${OUTPUTS.map(file => `${file}=${secondHashes[file]}`).join('；')}`);

  checkG8(records, lines.features, stations.features, colorContract);
  checkG9(offlineStyle, landContract, landData);
  checkG10(style, colorContract);

  if (failures.length) {
    console.error(`\nFAIL：${failures.length} 項`);
    failures.forEach(message => console.error(`- ${message}`));
    process.exitCode = 1;
  } else {
    console.log('\nPASS：G0–G10 軌道 GeoJSON／runtime states／follow／離線陸地全綠');
  }
}

try {
  main();
} catch (error) {
  console.error(`verify-track-geojson 基礎故障：${error.message}`);
  process.exitCode = 2;
}
