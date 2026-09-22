#!/usr/bin/env node
// 引擎矩陣自我測試。M4-B(2026-09-05)起只剩 MapLibre 一個引擎,原本的 M4「Leaflet 原版逐項對等」
// 那條鏈(pinBaselineToLeaflet／compareRecords／PILOTS,把 84405108 的舊腳本釘 ?engine=leaflet
// 跑一次再逐項比對)已退役——它的存在理由是遷移期間「MapLibre 半邊改壞了 Leaflet 半邊要照得出來」,
// 而 Leaflet 半邊已經不存在了。留著只會每次跑都去 git show 一份必然對不上的舊腳本。
import { ENGINES, engineUrl, runEngineMatrix } from './lib/engine_matrix.mjs';

const gateFailures = [];

function gate(section, pass, label, detail = '') {
  const line = `${pass ? 'PASS' : 'FAIL'} ${section} ${label}${detail ? ` — ${detail}` : ''}`;
  console.log(line);
  if (!pass) gateFailures.push(line);
}

function stats(section, { engines, assertions, engineSpecific, mismatches }) {
  console.log(`${section} 統計：引擎=${engines}，斷言=${assertions}，引擎專屬=${engineSpecific}，不符=${mismatches}`);
}

// M1：引擎清單、網址合併與標籤隔離。M4-B 起只剩 MapLibre。
const seen = [];
const m1 = await runEngineMatrix(({ engine, check }) => {
  seen.push(engine);
  check(true, '共同情境確實執行');
});
// engineUrl 不再附加 engine=,而且會把 base 裡殘留的 engine= 拿掉。
const urlCases = [
  engineUrl('http://example.test/index.html', 'maplibre') === 'http://example.test/index.html',
  engineUrl('http://example.test/index.html?lang=zh-TW', 'maplibre') === 'http://example.test/index.html?lang=zh-TW',
  engineUrl('http://example.test/index.html?engine=leaflet#panel', 'maplibre', 'probe=1') ===
    'http://example.test/index.html?probe=1#panel',
  engineUrl('/index.html#map', 'maplibre', { lang: 'zh-TW' }) === '/index.html?lang=zh-TW#map',
];
// 正向對照:未知引擎(含已拔掉的 leaflet)一律 throw,不會安靜地放行。
let rejectedLeaflet = false;
try { engineUrl('http://example.test/index.html', 'leaflet'); } catch (e) { rejectedLeaflet = e instanceof TypeError; }
const m1Checks = [
  ENGINES.join(',') === 'maplibre',
  seen.join(',') === 'maplibre',
  m1.results.every(item => item.label.startsWith(`[${item.engine}] `)),
  m1.passed,
  urlCases.every(Boolean),
  rejectedLeaflet,
];
gate('M1', m1Checks.every(Boolean), '單引擎跑滿、標籤帶引擎名、engineUrl 不再釘 engine 且拒絕已拔掉的引擎',
  JSON.stringify({ seen, urlCases, rejectedLeaflet }));
stats('M1', { engines: m1.stats.engines, assertions: m1.stats.assertions, engineSpecific: 0,
  mismatches: m1Checks.filter(value => !value).length });

// M2：故障注入必須紅且指名引擎，還原後全綠。
const maplibreRed = await runEngineMatrix(({ engine, check }) =>
  check(engine !== 'maplibre', 'MapLibre 故障注入'));
const restored = await runEngineMatrix(({ check }) => check(true, '故障注入還原'));
const m2Checks = [
  maplibreRed.failures.length === 1 && maplibreRed.failures[0].engine === 'maplibre',
  restored.passed && restored.assertions.length === ENGINES.length,
];
gate('M2', m2Checks.every(Boolean), '故障注入必紅且能指名引擎，還原後全綠',
  `maplibreRed=${maplibreRed.failures.map(item => item.engine)}`);
stats('M2', { engines: ENGINES.length,
  assertions: maplibreRed.stats.assertions + restored.stats.assertions,
  engineSpecific: 0, mismatches: m2Checks.filter(value => !value).length });

// M3：引擎專屬斷言必須有理由，且至少執行一次（死斷言機制）。
const exclusiveReason = '範例直接讀 MapLibre style 物件，其他引擎沒有同型物件';
const exclusiveLive = await runEngineMatrix(({ onlyFor }) =>
  onlyFor('maplibre', exclusiveReason, 'MapLibre style 範例', true));
// 刻意注入死斷言:宣告了但 pass 給 undefined ⇒ 從頭到尾沒執行過,矩陣必須判紅。
const exclusiveDead = await runEngineMatrix(({ onlyFor }) =>
  onlyFor('maplibre', exclusiveReason, '刻意注入的死斷言'));
const exclusiveRestored = await runEngineMatrix(({ onlyFor }) =>
  onlyFor('maplibre', exclusiveReason, 'MapLibre style 範例', true));
const m3Checks = [
  exclusiveLive.passed && exclusiveLive.stats.engineSpecific === 1,
  exclusiveDead.failures.length === 1 && exclusiveDead.failures[0].engine === 'maplibre'
    && exclusiveDead.failures[0].engineSpecific?.dead === true,
  exclusiveRestored.passed,
];
gate('M3', m3Checks.every(Boolean), '專屬理由可見、宣告了卻沒執行時必紅且正向對照可還原');
stats('M3', { engines: ENGINES.length,
  assertions: exclusiveLive.stats.assertions + exclusiveDead.stats.assertions + exclusiveRestored.stats.assertions,
  engineSpecific: exclusiveLive.stats.engineSpecific + exclusiveDead.stats.engineSpecific + exclusiveRestored.stats.engineSpecific,
  mismatches: m3Checks.filter(value => !value).length });


console.log(`ENGINE MATRIX RESULT：${gateFailures.length ? 'RED' : 'GREEN'}，gate failures=${gateFailures.length}`);
if (gateFailures.length) process.exitCode = 1;
