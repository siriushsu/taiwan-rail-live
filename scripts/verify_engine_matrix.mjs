#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENGINES,
  ENGINE_MATRIX_ASSERTION_PREFIX,
  engineUrl,
  runEngineMatrix,
} from './lib/engine_matrix.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_COMMIT = '84405108';
const UNIT_ONLY = process.argv.includes('--unit');
const gateFailures = [];

function gate(section, pass, label, detail = '') {
  const line = `${pass ? 'PASS' : 'FAIL'} ${section} ${label}${detail ? ` — ${detail}` : ''}`;
  console.log(line);
  if (!pass) gateFailures.push(line);
}

function stats(section, { engines, assertions, engineSpecific, mismatches }) {
  console.log(`${section} 統計：引擎=${engines}，斷言=${assertions}，引擎專屬=${engineSpecific}，不符=${mismatches}`);
}

// M1：固定雙引擎、網址合併與標籤隔離。
const seen = [];
const m1 = await runEngineMatrix(({ engine, check }) => {
  seen.push(engine);
  check(true, '共同情境確實執行');
});
const urlCases = [
  engineUrl('http://example.test/index.html', 'leaflet') === 'http://example.test/index.html?engine=leaflet',
  engineUrl('http://example.test/index.html?lang=zh-TW', 'maplibre') === 'http://example.test/index.html?lang=zh-TW&engine=maplibre',
  engineUrl('http://example.test/index.html?engine=leaflet#panel', 'maplibre', 'probe=1') ===
    'http://example.test/index.html?engine=maplibre&probe=1#panel',
  engineUrl('/index.html#map', 'leaflet', { lang: 'zh-TW' }) === '/index.html?lang=zh-TW&engine=leaflet#map',
];
const m1Checks = [
  ENGINES.join(',') === 'leaflet,maplibre',
  seen.join(',') === 'leaflet,maplibre',
  m1.results.every(item => item.label.startsWith(`[${item.engine}] `)
    && !item.label.startsWith(`[${item.engine === 'leaflet' ? 'maplibre' : 'leaflet'}] `)),
  m1.passed,
  urlCases.every(Boolean),
];
gate('M1', m1Checks.every(Boolean), '固定雙跑、標籤不混且 engineUrl 正確', JSON.stringify({ seen, urlCases }));
stats('M1', { engines: m1.stats.engines, assertions: m1.stats.assertions, engineSpecific: 0,
  mismatches: m1Checks.filter(value => !value).length });

// M2：兩個方向都做故障注入，再還原為全綠。
const maplibreRed = await runEngineMatrix(({ engine, check }) =>
  check(engine !== 'maplibre', 'MapLibre 單邊故障注入'));
const leafletRed = await runEngineMatrix(({ engine, check }) =>
  check(engine !== 'leaflet', 'Leaflet 單邊故障注入'));
const restored = await runEngineMatrix(({ check }) => check(true, '故障注入還原'));
const m2Checks = [
  maplibreRed.failures.length === 1 && maplibreRed.failures[0].engine === 'maplibre',
  leafletRed.failures.length === 1 && leafletRed.failures[0].engine === 'leaflet',
  restored.passed && restored.assertions.length === 2,
];
gate('M2', m2Checks.every(Boolean), '單邊紅能指名引擎，還原後雙邊全綠',
  `maplibreRed=${maplibreRed.failures.map(item => item.engine)} leafletRed=${leafletRed.failures.map(item => item.engine)}`);
stats('M2', { engines: ENGINES.length,
  assertions: maplibreRed.stats.assertions + leafletRed.stats.assertions + restored.stats.assertions,
  engineSpecific: 0, mismatches: m2Checks.filter(value => !value).length });

// M3：引擎專屬斷言必須有理由，且至少在目標引擎執行一次。
const exclusiveReason = '範例直接量測 .leaflet-* DOM，只適用 Leaflet';
const exclusiveLive = await runEngineMatrix(({ onlyFor }) =>
  onlyFor('leaflet', exclusiveReason, 'Leaflet DOM 範例', true));
const exclusiveDead = await runEngineMatrix(({ engine, onlyFor }) => {
  if (engine === 'maplibre') onlyFor('leaflet', exclusiveReason, '刻意注入的死斷言');
});
const exclusiveRestored = await runEngineMatrix(({ onlyFor }) =>
  onlyFor('leaflet', exclusiveReason, 'Leaflet DOM 範例', true));
const m3Checks = [
  exclusiveLive.passed && exclusiveLive.stats.engineSpecific === 1,
  exclusiveLive.results.some(item => item.engine === 'maplibre' && item.status === 'skipped'
    && item.detail.includes(exclusiveReason)),
  exclusiveDead.failures.length === 1 && exclusiveDead.failures[0].engine === 'leaflet'
    && exclusiveDead.failures[0].engineSpecific?.dead === true,
  exclusiveRestored.passed,
];
gate('M3', m3Checks.every(Boolean), '專屬理由可見、兩邊皆未執行時必紅且正向對照可還原');
stats('M3', { engines: ENGINES.length,
  assertions: exclusiveLive.stats.assertions + exclusiveDead.stats.assertions + exclusiveRestored.stats.assertions,
  engineSpecific: exclusiveLive.stats.engineSpecific + exclusiveDead.stats.engineSpecific + exclusiveRestored.stats.engineSpecific,
  mismatches: m3Checks.filter(value => !value).length });

const PILOTS = [
  { path: 'scripts/verify_krtc_peak.mjs', parser: 'words', env: { PORT: '5392' } },
  // 第三支換過兩次,理由都是「不符合試點前提」,不是判準有問題:
  //   verify_crossing_levels    原版在本樹就 23 過 2 敗(真表:「BR」每一格都在上面 53/319),
  //                             不符合「只從原版全綠者挑」。該紅在 M0 之前的 6ce1846e 上一模一樣,
  //                             不是換引擎造成的。
  //   verify_train_overlap_pick 原版連跑兩次逐項相同、轉換後單獨跑也綠,但在本 harness 底下
  //                             (原版與轉換後背靠背、負載加倍)會飄:B 斷言在 手機375 兩次執行
  //                             一次過一次敗。它有多處固定時間預算(waitMapStill 4000ms 到期
  //                             靜默回 false),負載一重就踩到。
  // M4 的前提是「同一支跑兩次結果可重現」,所以試點必須挑跨執行穩定的。
  // Codex 的沙箱起不了 listener 與 Chromium,這兩個前提它結構上都驗不到,已誠實回報。
  { path: 'scripts/verify_webmcp.mjs', parser: 'words' },
  { path: 'scripts/verify_web_basemap_notice.mjs' },   // 輸出是 ✅／❌ ⇒ 用預設的符號 parser
];

function withoutAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function parseBaseline(text, parser) {
  const records = [];
  for (const rawLine of withoutAnsi(text).split(/\r?\n/)) {
    if (parser === 'words') {
      const match = /^(PASS|FAIL)\s+(.+)$/.exec(rawLine);
      if (!match) continue;
      records.push({
        label: match[2].split(' — ')[0].trim(),
        status: match[1] === 'PASS' ? 'passed' : 'failed',
      });
    } else {
      const match = /^\s*([✅❌])\s+(.+)$/.exec(rawLine);
      if (!match) continue;
      records.push({
        // 先切「 — 」再切連續空白:符號式腳本兩種分隔都有人用
        // (verify_web_basemap_notice 是 `✅ ${id} — ${detail}`,只切連續空白會把整串 detail
        //  黏進標籤 ⇒ 與轉換後的 baseLabel 永遠對不上,36 條各算一次缺一次多＝72 條假不符)。
        label: match[2].trimStart().split(' — ')[0].split(/\s{2,}/)[0].trim(),
        status: match[1] === '✅' ? 'passed' : 'failed',
      });
    }
  }
  return records;
}

function parseConverted(text) {
  const records = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(ENGINE_MATRIX_ASSERTION_PREFIX)) continue;
    records.push(JSON.parse(line.slice(ENGINE_MATRIX_ASSERTION_PREFIX.length)));
  }
  return records;
}

function resultMultimap(records) {
  const map = new Map();
  for (const record of records) {
    const label = record.label.trim();
    const statuses = map.get(label) || [];
    statuses.push(record.status);
    map.set(label, statuses);
  }
  for (const statuses of map.values()) statuses.sort();
  return map;
}

function compareRecords(baseline, convertedLeaflet) {
  const before = resultMultimap(baseline);
  const after = resultMultimap(convertedLeaflet.map(item => ({ label: item.baseLabel, status: item.status })));
  const mismatches = [];
  for (const label of new Set([...before.keys(), ...after.keys()])) {
    const left = before.get(label) || [];
    const right = after.get(label) || [];
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      mismatches.push(`${label}: 原版=${left.join(',') || '(無)'} 轉換後=${right.join(',') || '(無)'}`);
    }
  }
  return mismatches;
}

function childRun(scriptPath, args, env) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  });
}

async function runM4Pilot(pilot) {
  const shown = spawnSync('git', ['show', `${BASELINE_COMMIT}:${pilot.path}`], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  if (shown.status !== 0) {
    return { assertions: 0, engineSpecific: 0, mismatches: [`git show 失敗：${shown.stderr || shown.error}`], diagnostics: [] };
  }

  const tempPath = path.join(ROOT, 'scripts', `.engine-matrix-baseline-${process.pid}-${path.basename(pilot.path)}`);
  await writeFile(tempPath, shown.stdout, { flag: 'wx' });
  try {
    const args = pilot.args || [];
    const baselineRun = childRun(tempPath, args, pilot.env || {});
    const convertedRun = childRun(path.join(ROOT, pilot.path), args,
      { ...(pilot.env || {}), ENGINE_MATRIX_JSON: '1' });
    const baseline = parseBaseline(`${baselineRun.stdout || ''}\n${baselineRun.stderr || ''}`, pilot.parser);
    let converted = [];
    const mismatches = [];
    try {
      converted = parseConverted(`${convertedRun.stdout || ''}\n${convertedRun.stderr || ''}`);
    } catch (error) {
      mismatches.push(`轉換後機器輸出無法解析：${error.message}`);
    }
    const convertedLeaflet = converted.filter(item => item.engine === 'leaflet' && item.status !== 'skipped');
    const ranEngines = [...new Set(converted.map(item => item.engine))].sort();

    if (baselineRun.status !== 0) mismatches.push(`原版 exit=${baselineRun.status ?? 'null'} signal=${baselineRun.signal || '-'} error=${baselineRun.error?.message || '-'}`);
    // 轉換後腳本的 exit code 刻意不當成 M4 違反:M4 只問「Leaflet 那半邊有沒有變」。
    // M1 期間 MapLibre 半邊本來就會紅(那正是 M1 要修的),若把整支 exit≠0 算成 Leaflet 對等失敗,
    // 這道閘門要等整個遷移做完才可能綠一次,等於在最需要它的期間永遠是紅的。MapLibre 半邊的失敗
    // 改成下面的 maplibreFailures 情報行,由各批自己的驗收去要求它變綠(設計總綱 §3.3 第 1 條)。
    // 轉換後若整支炸掉,仍會被「實跑引擎不是 leaflet,maplibre」與 compareRecords 抓到,不會漏。
    const maplibreFailures = converted.filter(item => item.engine === 'maplibre' && item.status === 'failed');
    if (!baseline.length) mismatches.push('原版沒有解析到任何斷言');
    if (ranEngines.join(',') !== 'leaflet,maplibre') mismatches.push(`轉換後實跑引擎=${ranEngines.join(',') || '(無)'}`);
    if (!(convertedRun.stdout || '').includes('本次跑了哪些引擎：leaflet、maplibre')) {
      mismatches.push('轉換後缺少可見的完整引擎範圍行');
    }
    mismatches.push(...compareRecords(baseline, convertedLeaflet));

    const diagnostics = [];
    if (mismatches.length) {
      const baselineTail = withoutAnsi(`${baselineRun.stdout || ''}\n${baselineRun.stderr || ''}`).split(/\r?\n/).slice(-12).join(' | ');
      const convertedTail = withoutAnsi(`${convertedRun.stdout || ''}\n${convertedRun.stderr || ''}`).split(/\r?\n/).slice(-12).join(' | ');
      diagnostics.push(`原版尾端：${baselineTail}`, `轉換後尾端：${convertedTail}`);
    }
    return { assertions: baseline.length, engineSpecific: converted.filter(item => item.engineSpecific).length,
      mismatches, diagnostics,
      maplibreFailures: maplibreFailures.map(item => item.label),
      convertedExit: convertedRun.status };
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}

if (UNIT_ONLY) {
  const comparatorBaseline = [
    { label: 'A', status: 'passed' },
    { label: 'B', status: 'failed' },
    { label: 'B', status: 'passed' },
  ];
  const comparatorSame = [
    { baseLabel: 'A', status: 'passed' },
    { baseLabel: 'B', status: 'passed' },
    { baseLabel: 'B', status: 'failed' },
  ];
  const comparatorMutated = [
    { baseLabel: 'A', status: 'failed' },
    { baseLabel: 'B', status: 'passed' },
  ];
  const sameMismatches = compareRecords(comparatorBaseline, comparatorSame);
  const mutationMismatches = compareRecords(comparatorBaseline, comparatorMutated);
  gate('M4-UNIT', sameMismatches.length === 0 && mutationMismatches.length === 2,
    '逐項比較器保留重複標籤，且抓得到結果翻轉與缺項',
    `same=${sameMismatches.length} mutated=${mutationMismatches.length}`);
  console.log('M4 統計：未執行（--unit；瀏覽器能力 gate 留給完整指令）');
} else {
  let assertionCount = 0;
  let engineSpecificCount = 0;
  let maplibreOpen = 0;
  const m4Mismatches = [];
  for (const pilot of PILOTS) {
    const result = await runM4Pilot(pilot);
    assertionCount += result.assertions;
    engineSpecificCount += result.engineSpecific;
    if (result.mismatches.length) {
      m4Mismatches.push(...result.mismatches.map(detail => `${pilot.path}: ${detail}`));
    }
    gate('M4', result.mismatches.length === 0, `${pilot.path} Leaflet 原版逐項對等`,
      [...result.mismatches, ...result.diagnostics].slice(0, 4).join(' | '));
    // 情報行:MapLibre 半邊現況。不是閘門,但要看得見——這是 M1 各批要逐一收掉的清單。
    const mf = result.maplibreFailures || [];
    console.log(`M4 情報 ${pilot.path}：MapLibre 半邊失敗 ${mf.length} 條${mf.length ? `（${mf.slice(0, 3).join('；')}${mf.length > 3 ? ' …' : ''}）` : ''}；轉換後整支 exit=${result.convertedExit ?? 'null'}`);
    maplibreOpen += mf.length;
  }
  stats('M4', { engines: ENGINES.length, assertions: assertionCount,
    engineSpecific: engineSpecificCount, mismatches: m4Mismatches.length });
  console.log(`M4 情報總計：MapLibre 半邊尚未通過的斷言 ${maplibreOpen} 條（M1 各批要逐一收掉，不是本閘門的判準）`);
}

console.log(`${UNIT_ONLY ? 'ENGINE MATRIX UNIT RESULT（M4 未執行）' : 'ENGINE MATRIX RESULT'}：${gateFailures.length ? 'RED' : 'GREEN'}，gate failures=${gateFailures.length}`);
if (gateFailures.length) process.exitCode = 1;
