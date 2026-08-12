#!/usr/bin/env node

/**
 * 稽核網站現行站間距離分支，並產生兩份衍生資料：
 *   data/seg_distance_audit.json  完整逐區間稽核報告
 *   data/tra_seg_cumdist.json     TRA 官方站間里程查表
 *
 * 輸入資料一律唯讀；腳本只覆寫上面兩個自身產生的衍生檔。
 * 現行語意逐字對齊 index.html：
 *   hasShape = !!(ln.shape && ln.stations[0].d != null)
 *   gap = hasShape ? Math.abs(d2 - d1) : haversineKm(a, b)
 *
 * 站序直接採網站載入的 data/*.json lines[].stations 順序，不另排序。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const AUDIT_PATH = path.join(ROOT, 'data', 'seg_distance_audit.json');
const TRA_TABLE_PATH = path.join(ROOT, 'data', 'tra_seg_cumdist.json');

const SYSTEMS = [
  {
    id: 'TRA', label: '台鐵', localFile: 'data/tra.json',
    officialFiles: ['data/tra_station_of_line.json'],
  },
  {
    id: 'THSR', label: '高鐵', localFile: 'data/thsr_track.json',
    officialFiles: ['data/tdx/THSR_StationOfLine.json'],
  },
  {
    id: 'AFR', label: '阿里山林鐵', localFile: 'data/afr.json',
    officialFiles: ['data/tdx/AFR_StationOfLine.json'],
  },
  {
    id: 'TRTC', label: '北捷／新北環狀線', localFile: 'data/trtc.json',
    officialFiles: ['data/tdx/TRTC_StationOfLine.json', 'data/tdx/NTMC_StationOfLine.json'],
  },
  {
    id: 'TYMC', label: '桃園機捷', localFile: 'data/tymc.json',
    officialFiles: ['data/tdx/TYMC_StationOfLine.json'],
  },
  {
    id: 'NTDLRT', label: '淡海輕軌', localFile: 'data/ntdlrt.json',
    officialFiles: ['data/tdx/NTDLRT_StationOfLine.json'],
  },
  {
    id: 'NTALRT', label: '安坑輕軌', localFile: 'data/ntalrt.json',
    officialFiles: ['data/tdx/NTALRT_StationOfLine.json'],
  },
  {
    id: 'SANYING', label: '三鶯線', localFile: 'data/sanying.json',
    officialFiles: ['data/tdx/SANYING_StationOfLine.json'],
  },
  {
    id: 'KRTC', label: '高捷／高雄輕軌', localFile: 'data/krtc.json',
    officialFiles: ['data/tdx/KRTC_StationOfLine.json', 'data/tdx/KLRT_StationOfLine.json'],
  },
  {
    id: 'TMRT', label: '台中捷運', localFile: 'data/tmrt.json',
    officialFiles: ['data/tdx/TMRT_StationOfLine.json'],
  },
];

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function writeJson(abs, value) {
  fs.writeFileSync(abs, JSON.stringify(value, null, 2) + '\n');
}

// 對齊 index.html 的 traStnKey()：臺→台、剝尾端半形括號註記、trim。
// 不自行擴張成模糊比對，避免同名／近名站被錯接。
function normalizeStationName(name) {
  return String(name ?? '').replace(/臺/g, '台').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function haversineKm(a, b) {
  const R = 6371;
  const toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR;
  const dLon = (b.lon - a.lon) * toR;
  const la1 = a.lat * toR;
  const la2 = b.lat * toR;
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function rawOfficialLines(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.lines)) return raw.lines;
  if (Array.isArray(raw.StationOfLines)) return raw.StationOfLines;
  return [];
}

function parseOfficialLines(files) {
  const out = [];
  for (const sourceFile of files) {
    const raw = readJson(sourceFile);
    for (const line of rawOfficialLines(raw)) {
      const stationsRaw = line.stations || line.Stations || [];
      const stations = stationsRaw
        .map(station => ({
          id: String(station.id ?? station.StationID ?? ''),
          name: normalizeStationName(station.name ?? station.StationName?.Zh_tw),
          sourceName: String(station.name ?? station.StationName?.Zh_tw ?? ''),
          sequence: Number(station.seq ?? station.Sequence),
          cumulativeKm: Number(station.cumKm ?? station.CumulativeDistance),
        }))
        .filter(station => station.name && Number.isFinite(station.cumulativeKm))
        .sort((a, b) => a.sequence - b.sequence);
      if (!stations.length) continue;
      out.push({
        sourceFile,
        lineId: String(line.lineId ?? line.LineID ?? line.LineNo ?? ''),
        stations,
      });
    }
  }
  return out;
}

/**
 * 以網站本地線的相鄰端點為問題，在同系統每條 TDX StationOfLine 內找兩端。
 * TDX 有零里程別名與把分支附在主線陣列尾端的資料形狀，因此不要求兩端在原始陣列
 * 中相鄰；官方值依題意直接取兩端 CumulativeDistance 絕對差。若多條官方線都含
 * 同一對站，優先選原始索引跨度最短者；目前資料沒有「候選官方里程互相矛盾」案例。
 */
function officialMatch(officialLines, fromName, toName) {
  const from = normalizeStationName(fromName);
  const to = normalizeStationName(toName);
  const candidates = [];
  for (const line of officialLines) {
    const fromIndex = line.stations.findIndex(station => station.name === from);
    const toIndex = line.stations.findIndex(station => station.name === to);
    if (fromIndex < 0 || toIndex < 0) continue;
    const a = line.stations[fromIndex];
    const b = line.stations[toIndex];
    candidates.push({
      sourceFile: line.sourceFile,
      sourceLineId: line.lineId,
      sourceFromStationId: a.id,
      sourceToStationId: b.id,
      sourceFromSequence: a.sequence,
      sourceToSequence: b.sequence,
      sourceIndexSpan: Math.abs(toIndex - fromIndex),
      officialKm: Math.abs(b.cumulativeKm - a.cumulativeKm),
    });
  }
  candidates.sort((a, b) => a.sourceIndexSpan - b.sourceIndexSpan
    || a.sourceFile.localeCompare(b.sourceFile)
    || a.sourceLineId.localeCompare(b.sourceLineId));
  if (!candidates.length) return { best: null, candidates: [] };
  return { best: candidates[0], candidates };
}

// Type-7 線性插值分位數（與常見統計套件預設一致）；不是平均值。
function quantile(values, p) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

function errorStats(segments) {
  const comparable = segments.filter(segment => segment.officialKm != null);
  const abs = comparable.map(segment => segment.error.absoluteKm);
  const pct = comparable.map(segment => segment.error.percent).filter(Number.isFinite);
  return {
    sampleCount: comparable.length,
    absoluteKm: {
      median: round(quantile(abs, 0.5)),
      p90: round(quantile(abs, 0.9)),
      max: round(quantile(abs, 1)),
    },
    percent: {
      median: round(quantile(pct, 0.5)),
      p90: round(quantile(pct, 0.9)),
      max: round(quantile(pct, 1)),
    },
  };
}

function countSummary(segments) {
  const hasShapeSegments = segments.filter(segment => segment.branch === 'hasShape').length;
  const fallbackSegments = segments.length - hasShapeSegments;
  const officialSegments = segments.filter(segment => segment.officialKm != null).length;
  return {
    segments: segments.length,
    hasShapeSegments,
    fallbackSegments,
    fallbackPercent: round(segments.length ? fallbackSegments / segments.length * 100 : 0, 3),
    officialSegments,
    officialMissingSegments: segments.length - officialSegments,
  };
}

function auditAll() {
  const generatedAt = new Date().toISOString();
  const segments = [];
  const lines = [];
  const officialBySystem = new Map();

  for (const system of SYSTEMS) {
    const local = readJson(system.localFile);
    const officialLines = parseOfficialLines(system.officialFiles);
    officialBySystem.set(system.id, officialLines);

    for (const line of local.lines || []) {
      const stations = line.stations || [];
      // 刻意保留 index.html 的 truthy 判斷，不加 shape.length 等自訂條件。
      const hasShape = Boolean(line.shape && stations[0]?.d != null);
      const lineSegments = [];
      for (let index = 1; index < stations.length; index++) {
        const a = stations[index - 1];
        const b = stations[index];
        const haversine = haversineKm(a, b);
        const shapeKm = hasShape ? Math.abs(Number(b.d) - Number(a.d)) : null;
        const currentKm = hasShape ? shapeKm : haversine;
        const matched = officialMatch(officialLines, a.name, b.name);
        const officialKm = matched.best ? matched.best.officialKm : null;
        const absoluteKm = officialKm == null ? null : Math.abs(currentKm - officialKm);
        const percent = officialKm > 0 ? absoluteKm / officialKm * 100 : null;
        const differingCandidateKm = new Set(matched.candidates.map(candidate => round(candidate.officialKm))).size;

        const segment = {
          system: system.id,
          systemLabel: system.label,
          localSourceFile: system.localFile,
          lineId: String(line.id),
          lineName: String(line.name || line.id),
          index: index - 1,
          from: String(a.name),
          to: String(b.name),
          normalizedFrom: normalizeStationName(a.name),
          normalizedTo: normalizeStationName(b.name),
          branch: hasShape ? 'hasShape' : 'haversineKm',
          haversineKm: round(haversine),
          currentShapeKm: round(shapeKm),
          currentKm: round(currentKm),
          officialKm: round(officialKm),
          officialSource: matched.best ? {
            sourceFile: matched.best.sourceFile,
            lineId: matched.best.sourceLineId,
            fromStationId: matched.best.sourceFromStationId,
            toStationId: matched.best.sourceToStationId,
            fromSequence: matched.best.sourceFromSequence,
            toSequence: matched.best.sourceToSequence,
            sourceIndexSpan: matched.best.sourceIndexSpan,
          } : null,
          officialCandidateCount: matched.candidates.length,
          officialCandidateConflict: differingCandidateKm > 1,
          error: officialKm == null ? null : {
            absoluteKm: round(absoluteKm),
            percent: round(percent),
            signedCurrentMinusOfficialKm: round(currentKm - officialKm),
          },
        };
        segments.push(segment);
        lineSegments.push(segment);
      }
      lines.push({
        system: system.id,
        systemLabel: system.label,
        localSourceFile: system.localFile,
        lineId: String(line.id),
        lineName: String(line.name || line.id),
        hasShape,
        ...countSummary(lineSegments),
        errorStats: errorStats(lineSegments),
      });
    }
  }

  const bySystem = {};
  for (const system of SYSTEMS) {
    const systemSegments = segments.filter(segment => segment.system === system.id);
    bySystem[system.id] = {
      label: system.label,
      lines: lines.filter(line => line.system === system.id).length,
      ...countSummary(systemSegments),
      errorStats: errorStats(systemSegments),
    };
  }

  const top20 = segments
    .filter(segment => segment.error)
    .slice()
    .sort((a, b) => b.error.absoluteKm - a.error.absoluteKm
      || b.error.percent - a.error.percent)
    .slice(0, 20)
    .map(segment => ({
      system: segment.system,
      lineId: segment.lineId,
      lineName: segment.lineName,
      from: segment.from,
      to: segment.to,
      haversineKm: segment.haversineKm,
      currentShapeKm: segment.currentShapeKm,
      currentKm: segment.currentKm,
      officialKm: segment.officialKm,
      absoluteErrorKm: segment.error.absoluteKm,
      percentError: segment.error.percent,
    }));

  const report = {
    _meta: {
      schemaVersion: 1,
      generatedAt,
      purpose: '量測 index.html 現行 hasShape／haversineKm 分支與 TDX 官方累積里程差異',
      runtimeSemantics: 'hasShape = !!(ln.shape && ln.stations[0].d != null); current = hasShape ? abs(d2-d1) : haversineKm(a,b)',
      stationOrder: '直接使用各 localSourceFile 的 lines[].stations 陣列順序',
      stationNormalization: 'String(name).replace(/臺/g, "台").replace(/\\s*\\([^)]*\\)\\s*$/, "").trim()',
      quantileMethod: 'Type-7 linear interpolation',
      localSourceFiles: SYSTEMS.map(system => system.localFile),
      officialSourceFiles: [...new Set(SYSTEMS.flatMap(system => system.officialFiles))],
      auditJson: path.relative(ROOT, AUDIT_PATH),
      traLookupJson: path.relative(ROOT, TRA_TABLE_PATH),
    },
    totals: {
      lines: lines.length,
      ...countSummary(segments),
      errorStats: errorStats(segments),
      bySystem,
    },
    lines,
    top20,
    segments,
  };

  return { report, officialBySystem, generatedAt };
}

function buildTraLookup(report, generatedAt) {
  const traLines = report.lines.filter(line => line.system === 'TRA');
  const lineMap = {};
  const lookup = {};
  let segmentCount = 0;

  for (const line of traLines) {
    const sourceSegments = report.segments.filter(segment =>
      segment.system === 'TRA' && segment.lineId === line.lineId && segment.officialKm != null);
    const tableSegments = sourceSegments.map(segment => ({
      from: segment.normalizedFrom,
      to: segment.normalizedTo,
      km: segment.officialKm,
      sourceLineId: segment.officialSource.lineId,
      sourceFromStationId: segment.officialSource.fromStationId,
      sourceToStationId: segment.officialSource.toStationId,
    }));
    lineMap[line.lineId] = {
      name: line.lineName,
      segmentCount: tableSegments.length,
      totalKm: round(tableSegments.reduce((sum, segment) => sum + segment.km, 0)),
      segments: tableSegments,
    };
    for (const segment of tableSegments) {
      const key = `${line.lineId}|${segment.from}|${segment.to}`;
      if (Object.hasOwn(lookup, key)) throw new Error(`TRA lookup key 重複：${key}`);
      lookup[key] = segment.km;
      segmentCount++;
    }
  }

  const source = readJson('data/tra_station_of_line.json');
  return {
    _meta: {
      schemaVersion: 1,
      generatedAt,
      source: source.source || 'TDX v3 Rail/TRA/StationOfLine',
      sourceFiles: ['data/tra_station_of_line.json', 'data/tra.json'],
      sourceFetchedAt: source.fetched_at || null,
      sourceTdxUpdateTime: source.tdx_update_time || null,
      unit: 'km',
      lineCount: Object.keys(lineMap).length,
      segmentCount,
      stationNormalization: '對齊 index.html traStnKey：臺→台、剝尾端半形括號註記、trim',
      keyFormat: '<local line id>|<normalized from station>|<normalized to station>',
      inclusion: '只收本地線相鄰站在 TDX StationOfLine 同一條官方線內兩端都有 CumulativeDistance 的區間',
    },
    lines: lineMap,
    lookup,
  };
}

function formatNumber(value, digits = 3) {
  return value == null ? '—' : Number(value).toFixed(digits);
}

function printTable(rows, columns) {
  const widths = columns.map(column => Math.max(
    column.title.length,
    ...rows.map(row => String(column.value(row)).length),
  ));
  const render = values => values.map((value, index) => String(value).padEnd(widths[index])).join('  ');
  console.log(render(columns.map(column => column.title)));
  console.log(render(widths.map(width => '-'.repeat(width))));
  for (const row of rows) console.log(render(columns.map(column => column.value(row))));
}

function printHumanReport(report) {
  console.log('逐路線站間距離分支');
  printTable(report.lines, [
    { title: '系統', value: row => row.system },
    { title: '路線', value: row => row.lineId },
    { title: '區間', value: row => row.segments },
    { title: 'hasShape', value: row => row.hasShapeSegments },
    { title: 'haversine', value: row => row.fallbackSegments },
    { title: '退路%', value: row => formatNumber(row.fallbackPercent, 1) },
    { title: '官方可算', value: row => row.officialSegments },
  ]);

  console.log('\n誤差分布（官方里程 vs 現行值；Type-7 分位數）');
  const statsRows = [
    { scope: 'ALL', ...report.totals.errorStats },
    ...Object.entries(report.totals.bySystem).map(([scope, value]) => ({ scope, ...value.errorStats })),
  ];
  printTable(statsRows, [
    { title: '範圍', value: row => row.scope },
    { title: '樣本', value: row => row.sampleCount },
    { title: 'abs中位km', value: row => formatNumber(row.absoluteKm.median) },
    { title: 'abs p90km', value: row => formatNumber(row.absoluteKm.p90) },
    { title: 'abs最大km', value: row => formatNumber(row.absoluteKm.max) },
    { title: '%中位', value: row => formatNumber(row.percent.median, 2) },
    { title: '% p90', value: row => formatNumber(row.percent.p90, 2) },
    { title: '%最大', value: row => formatNumber(row.percent.max, 2) },
  ]);

  console.log('\n絕對誤差最大的前 20 個區間');
  printTable(report.top20, [
    { title: '系統', value: row => row.system },
    { title: '路線', value: row => row.lineId },
    { title: '區間', value: row => `${row.from}→${row.to}` },
    { title: 'haversine', value: row => formatNumber(row.haversineKm) },
    { title: '現行shape', value: row => formatNumber(row.currentShapeKm) },
    { title: '官方', value: row => formatNumber(row.officialKm) },
    { title: '差km', value: row => formatNumber(row.absoluteErrorKm) },
    { title: '差%', value: row => formatNumber(row.percentError, 2) },
  ]);

  const t = report.totals;
  console.log(`\nJSON：${path.relative(ROOT, AUDIT_PATH)}`);
  console.log(`TRA 查表：${path.relative(ROOT, TRA_TABLE_PATH)}`);
  console.log(`總計：${t.lines} 條線、${t.segments} 個區間；hasShape ${t.hasShapeSegments}，haversineKm 退路 ${t.fallbackSegments}（${formatNumber(t.fallbackPercent, 1)}%）；官方可算 ${t.officialSegments}。`);
}

const { report, generatedAt } = auditAll();
const traLookup = buildTraLookup(report, generatedAt);
writeJson(AUDIT_PATH, report);
writeJson(TRA_TABLE_PATH, traLookup);
printHumanReport(report);
