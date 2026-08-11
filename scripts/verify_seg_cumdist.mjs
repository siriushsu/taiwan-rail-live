#!/usr/bin/env node

/**
 * 驗證 data/tra_seg_cumdist.json 本身。
 *
 * 容差理由：
 * - TDX_TOTAL_TOLERANCE_KM = 0.01 km：查表保留 6 位小數，這個 10 公尺容差只吸收
 *   JSON 十進位序列化與 JS 浮點加總誤差；遠小於 TRA StationOfLine 常見 0.1 km 粒度。
 * - EXTERNAL_TOLERANCE_KM = 0.11 km：外部台鐵「營業里程」PDF 只刊到 0.1 km，
 *   110 公尺容差涵蓋兩端各一位小數的呈現誤差，沒有放寬到足以吞掉一個真實站間偏差。
 *
 * 外部常數來源（不是由本查表或稽核 JSON 反推）：
 * 國營臺灣鐵路股份有限公司「營業里程」PDF，114-05-08 版：
 * https://tip-tr4cdn.cdn.hinet.net/tra-tip-web/static/file/T-table1140508/mile.pdf
 * 臺北 28.5、板橋 35.7、臺中 193.1、彰化 210.9 km。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TABLE_FILE = 'data/tra_seg_cumdist.json';
const AUDIT_FILE = 'data/seg_distance_audit.json';
const LOCAL_FILE = 'data/tra.json';
const TDX_FILE = 'data/tra_station_of_line.json';
const TDX_TOTAL_TOLERANCE_KM = 0.01;
const EXTERNAL_TOLERANCE_KM = 0.11;

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function normalizeStationName(name) {
  return String(name ?? '').replace(/臺/g, '台').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function round(value, digits = 6) {
  return Number(value.toFixed(digits));
}

const table = readJson(TABLE_FILE);
const audit = readJson(AUDIT_FILE);
const local = readJson(LOCAL_FILE);
const tdx = readJson(TDX_FILE);
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function parseTdxLines() {
  return (tdx.lines || []).map(line => ({
    lineId: String(line.lineId),
    stations: (line.stations || []).slice().sort((a, b) => a.seq - b.seq).map(station => ({
      name: normalizeStationName(station.name),
      cumulativeKm: Number(station.cumKm),
      sequence: Number(station.seq),
    })),
  }));
}

const tdxLines = parseTdxLines();

function officialCandidates(from, to) {
  const aName = normalizeStationName(from);
  const bName = normalizeStationName(to);
  const candidates = [];
  for (const line of tdxLines) {
    const fromIndex = line.stations.findIndex(station => station.name === aName);
    const toIndex = line.stations.findIndex(station => station.name === bName);
    if (fromIndex < 0 || toIndex < 0) continue;
    const a = line.stations[fromIndex];
    const b = line.stations[toIndex];
    candidates.push({
      line,
      lineId: line.lineId,
      fromIndex,
      toIndex,
      fromCumKm: a.cumulativeKm,
      toCumKm: b.cumulativeKm,
      sourceIndexSpan: Math.abs(toIndex - fromIndex),
      officialKm: Math.abs(b.cumulativeKm - a.cumulativeKm),
    });
  }
  return candidates.sort((a, b) => a.sourceIndexSpan - b.sourceIndexSpan
    || a.lineId.localeCompare(b.lineId));
}

function bestOfficial(from, to) {
  return officialCandidates(from, to)[0] || null;
}

function tableSegments() {
  return Object.entries(table.lines || {}).flatMap(([lineId, line]) =>
    (line.segments || []).map(segment => ({ lineId, ...segment })));
}

function expectedTdxSpanTotal(localLine) {
  const matches = [];
  const stations = localLine.stations || [];
  for (let index = 1; index < stations.length; index++) {
    const match = bestOfficial(stations[index - 1].name, stations[index].name);
    if (!match) return { totalKm: null, missing: `${stations[index - 1].name}→${stations[index].name}`, runs: [] };
    matches.push({
      ...match,
      from: normalizeStationName(stations[index - 1].name),
      to: normalizeStationName(stations[index].name),
      direction: Math.sign(match.toIndex - match.fromIndex),
    });
  }

  // 同一 TDX 線、來源索引首尾相接、方向不變的相鄰區間合成一個 endpoint span。
  // 這不是把每段再加一次，而是獨立以該 run 的首尾 CumulativeDistance 相減；
  // 可抓到中間漏段、重複段或錯把別條官方線接入的問題。
  const runs = [];
  for (const match of matches) {
    const previous = runs.at(-1);
    if (previous
      && previous.lineId === match.lineId
      && previous.toIndex === match.fromIndex
      && previous.direction === match.direction) {
      previous.to = match.to;
      previous.toIndex = match.toIndex;
      previous.toCumKm = match.toCumKm;
    } else {
      runs.push({
        lineId: match.lineId,
        from: match.from,
        to: match.to,
        fromIndex: match.fromIndex,
        toIndex: match.toIndex,
        fromCumKm: match.fromCumKm,
        toCumKm: match.toCumKm,
        direction: match.direction,
      });
    }
  }
  const totalKm = runs.reduce((sum, run) => sum + Math.abs(run.toCumKm - run.fromCumKm), 0);
  return { totalKm, missing: null, runs };
}

function sumRange(lineId, from, to) {
  const line = table.lines?.[lineId];
  if (!line) throw new Error(`查無路線 ${lineId}`);
  const segments = line.segments || [];
  const fromName = normalizeStationName(from);
  const toName = normalizeStationName(to);
  const forwardStart = segments.findIndex(segment => segment.from === fromName);
  if (forwardStart >= 0) {
    let sum = 0;
    for (let index = forwardStart; index < segments.length; index++) {
      sum += Number(segments[index].km);
      if (segments[index].to === toName) return sum;
    }
  }
  const reverseStart = segments.findIndex(segment => segment.to === fromName);
  if (reverseStart >= 0) {
    let sum = 0;
    for (let index = reverseStart; index >= 0; index--) {
      sum += Number(segments[index].km);
      if (segments[index].from === toName) return sum;
    }
  }
  throw new Error(`${lineId} 找不到連續範圍 ${fromName}→${toName}`);
}

const allSegments = tableSegments();
const localById = new Map((local.lines || []).map(line => [String(line.id), line]));

check(
  'META 路線數與 lines 實際鍵數一致',
  table._meta?.lineCount === Object.keys(table.lines || {}).length,
  `meta=${table._meta?.lineCount} actual=${Object.keys(table.lines || {}).length}`,
);
check(
  'META 區間數與 lines 實際區間數一致',
  table._meta?.segmentCount === allSegments.length,
  `meta=${table._meta?.segmentCount} actual=${allSegments.length}`,
);

for (const [lineId, line] of Object.entries(table.lines || {})) {
  const localLine = localById.get(lineId);
  const segments = line.segments || [];
  const breaks = [];
  for (let index = 1; index < segments.length; index++) {
    if (segments[index - 1].to !== segments[index].from) {
      breaks.push(`#${index - 1} ${segments[index - 1].to} != #${index} ${segments[index].from}`);
    }
  }
  if (!localLine) breaks.push(`data/tra.json 查無本地線 ${lineId}`);
  if (localLine && segments.length) {
    const expectedFirst = normalizeStationName(localLine.stations[0].name);
    const expectedLast = normalizeStationName(localLine.stations.at(-1).name);
    if (segments[0].from !== expectedFirst) breaks.push(`起點 ${segments[0].from} != ${expectedFirst}`);
    if (segments.at(-1).to !== expectedLast) breaks.push(`終點 ${segments.at(-1).to} != ${expectedLast}`);
    if (segments.length !== localLine.stations.length - 1) {
      breaks.push(`區間數 ${segments.length} != 本地相鄰站間 ${localLine.stations.length - 1}`);
    }
  }
  check(
    `CHAIN ${lineId} 區間可串成連續鏈`,
    breaks.length === 0,
    breaks.length ? breaks.join('；') : `${segments[0]?.from}→${segments.at(-1)?.to}，${segments.length} 段`,
  );

  if (!localLine) {
    check(`LENGTH ${lineId} 區間總和約等於 TDX 總長`, false, '缺本地線，無法建立 TDX endpoint span');
    continue;
  }
  const expected = expectedTdxSpanTotal(localLine);
  const actualKm = segments.reduce((sum, segment) => sum + Number(segment.km), 0);
  const deltaKm = expected.totalKm == null ? Infinity : Math.abs(actualKm - expected.totalKm);
  const runDetail = expected.runs.map(run => `${run.lineId}:${run.from}→${run.to}`).join(' + ');
  check(
    `LENGTH ${lineId} 區間總和約等於 TDX 總長`,
    deltaKm <= TDX_TOTAL_TOLERANCE_KM,
    expected.missing
      ? `TDX 缺 ${expected.missing}`
      : `table=${round(actualKm)}km TDX-span=${round(expected.totalKm)}km Δ=${round(deltaKm)}km；${runDetail}`,
  );
}

const valueProblems = [];
for (const segment of allSegments) {
  const match = bestOfficial(segment.from, segment.to);
  if (!match) {
    valueProblems.push(`${segment.lineId} ${segment.from}→${segment.to}：TDX 查無兩端`);
    continue;
  }
  const delta = Math.abs(Number(segment.km) - match.officialKm);
  if (delta > TDX_TOTAL_TOLERANCE_KM || segment.sourceLineId !== match.lineId) {
    valueProblems.push(`${segment.lineId} ${segment.from}→${segment.to}：table=${segment.km}/${segment.sourceLineId} TDX=${round(match.officialKm)}/${match.lineId}`);
  }
}
check(
  'VALUES 每筆 km 與原始 TDX CumulativeDistance 差一致',
  valueProblems.length === 0,
  valueProblems.length ? valueProblems.join('；') : `${allSegments.length} 段全部相符`,
);

const lookupProblems = [];
const lookupEntries = Object.entries(table.lookup || {});
if (lookupEntries.length !== allSegments.length) {
  lookupProblems.push(`lookup 數 ${lookupEntries.length} != segments 數 ${allSegments.length}`);
}
for (const segment of allSegments) {
  const key = `${segment.lineId}|${segment.from}|${segment.to}`;
  if (!Object.hasOwn(table.lookup || {}, key)) lookupProblems.push(`缺 key ${key}`);
  else if (Number(table.lookup[key]) !== Number(segment.km)) lookupProblems.push(`${key} 值不一致`);
}
check(
  'LOOKUP 扁平鍵與 lines 區間一一對應',
  lookupProblems.length === 0,
  lookupProblems.length ? lookupProblems.join('；') : `${lookupEntries.length} keys`,
);

const auditOfficialTra = audit.totals?.bySystem?.TRA?.officialSegments;
check(
  'COVERAGE 表裡的區間數 = 稽核腳本回報 TRA 有官方里程可算的區間數',
  allSegments.length === auditOfficialTra,
  `table=${allSegments.length} audit.TRA.officialSegments=${auditOfficialTra}`,
);

const externalCases = [
  {
    name: '臺北–板橋', expectedKm: 7.2,
    actual: () => sumRange('縱貫線北段', '臺北', '板橋'),
    basis: '35.7 - 28.5',
  },
  {
    name: '臺北–臺中', expectedKm: 164.6,
    actual: () => sumRange('縱貫線北段', '臺北', '竹南') + sumRange('山線', '竹南', '臺中'),
    basis: '193.1 - 28.5',
  },
  {
    name: '臺中–彰化', expectedKm: 17.8,
    actual: () => sumRange('山線', '臺中', '彰化'),
    basis: '210.9 - 193.1',
  },
];

for (const sample of externalCases) {
  try {
    const actualKm = sample.actual();
    const deltaKm = Math.abs(actualKm - sample.expectedKm);
    check(
      `EXTERNAL 台鐵營業里程常數 ${sample.name}`,
      deltaKm <= EXTERNAL_TOLERANCE_KM,
      `table=${round(actualKm)}km published=${sample.expectedKm}km (${sample.basis}) Δ=${round(deltaKm)}km`,
    );
  } catch (error) {
    check(`EXTERNAL 台鐵營業里程常數 ${sample.name}`, false, error.message);
  }
}

const pass = results.filter(result => result.ok).length;
const fail = results.length - pass;
console.log(`\n驗證總計：PASS ${pass}，FAIL ${fail}`);
if (fail) process.exitCode = 1;

