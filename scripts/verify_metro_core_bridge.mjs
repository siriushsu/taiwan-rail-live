#!/usr/bin/env node
// Private Metro Core 公開端橋接的純靜態契約驗收：不打網路、不啟動瀏覽器。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.resolve(HERE, '..', 'index.html'), 'utf8');
const headers = fs.readFileSync(path.resolve(HERE, '..', '_headers'), 'utf8');
const prepareWeb = fs.readFileSync(path.resolve(HERE, '..', 'app/scripts/prepare-web.mjs'), 'utf8');
const verifyRelease = fs.readFileSync(path.resolve(HERE, '..', 'app/scripts/verify-release.mjs'), 'utf8');
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`找不到 ${name}`);
  const open = html.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth += 1;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`${name} 大括號未閉合`);
}

const sandbox = {};
vm.runInNewContext(`${extractFunction('metroCoreSampleTrajectory')}; this.sample = metroCoreSampleTrajectory;`, sandbox);
const increasing = [{ epoch: 100, progress: 2 }, { epoch: 120, progress: 3 }];
const decreasing = [{ epoch: 100, progress: 5 }, { epoch: 120, progress: 4 }];
check(sandbox.sample(increasing, 110).progress === 2.5, '里程遞增方向補間錯誤');
check(sandbox.sample(decreasing, 110).progress === 4.5, '里程遞減方向補間錯誤');
check(sandbox.sample(increasing, 90).progress === 2, '發車前應鉗在第一個軌跡點');
check(sandbox.sample(decreasing, 130).progress === 4, '退場前應鉗在最後一個軌跡點');

const contracts = [
  ['網站預設開啟且保留顯式關閉', /if \(METRO_CORE_QUERY_MODE === 'off'\) return false;[\s\S]*?return true;[\s\S]*?const METRO_CORE_ENABLED = metroCoreFlag\(location\.search\)/],
  ['App 可注入獨立布林旗標', /typeof window\.RAIL_METRO_CORE_ENABLED === 'boolean'/],
  ['正式 endpoint 不再指向 Preview', /https:\/\/railisland-metro-core\.sirius1984\.workers\.dev\/v1\/metro\/snapshot/],
  ['snapshot 有 schema 驗證', /snapshot\.schema !== METRO_CORE_SCHEMA/],
  ['snapshot 過期會降級', /Number\(snapshot\.validUntil\) >= Number\(nowEpoch\)/],
  ['非真實現在會降級', /trtcOfficialBoardRealNow\(\)/],
  ['支援 ETag', /headers\['if-none-match'\] = state\.metroCore\.etag/],
  ['支援 304 保留快照', /response\.status === 304/],
  ['防止舊 snapshot 倒灌', /snapshot rollback/],
  ['一般捷運層讀取 Core', /function drawFreq[\s\S]*?metroCoreItemsForLine\(ln, officialNow\)/],
  ['全台裝飾層讀取 Core', /function drawDecoTrains[\s\S]*?metroCoreItemsForLine\(ln, officialNow\)/],
  ['站牌共用 vehicle ID', /data-core-vehicle/],
  ['跟隨保存 Core 身分形狀', /\{ core: true, systemId: String\(target\.systemId\), lineId: String\(target\.ln\.id\), vehicleId: String\(target\.vehicleId\) \}/],
  ['進站文字查驗實際距離', /distanceM <= 25/],
  ['失效時回到既有站牌', /if \(core\) \{ renderMetroCoreFreqBoard[\s\S]*?const official = trtcOfficialBoardView/],
  // ── 2026-08-21 復原批次補上的九道基底防線（行為面另有 verify_metro_core_defense.mjs）──
  ['P0-1 某線 0 台回 null，不得用空陣列短路 legacy', /return out\.length \? out : null;/],
  ['P0-1 snapshot 缺該系統也回 null', /if \(!system\) return null; \/\/ 🔴 P0-1/],
  ['P0-2 逐線車數相對基線腰斬閘門', /const METRO_CORE_COUNT_DROP = 0\.5;[\s\S]*?function metroCoreEvaluateCounts\(/],
  ['P0-2 判為異常那一輪不進基線（防自我漂移）', /else \{ history\.push\(cur\);/],
  ['P0-3 十一個合法 lineId 寫成常數', /const METRO_CORE_LINE_IDS = \{[\s\S]*?trtc: \['BR', 'R', 'R_XBT', 'G', 'G_XBT', 'O_XINZHUANG', 'O_LUZHOU', 'BL', 'Y'\][\s\S]*?krtc: \['KR', 'KO'\]/],
  ['P0-3 未知 lineId 整包退回並指名', /if \(lineIdIssues\.unknown\.length\) \{[\s\S]*?throw new Error\('lineId 契約外：'/],
  ['P0-3 建線時做 id 契約自檢', /function metroCoreSelfCheckLineIds\(\)[\s\S]*?state\.metroCore\.selfCheck = result/],
  ['P0-4 跟隨 30 秒寬限常數', /const METRO_CORE_FOLLOW_GRACE_SEC = 30;/],
  ['P0-4 每幀跟隨判定走寬限版', /function updateFreqFollowCamera[\s\S]*?metroCoreFollowRecordWithGrace\(f, Date\.now\(\) \/ 1000\)/],
  ['P0-4 退場文案講真因', /連續兩批不在即時模型中，已結束跟隨/],
  ['P0-5 徽章不再以 hidden 表示 0 台', /el\.textContent = '即時資料異常';/],
  ['P0-5 0 台的判準取自不同來源（既有路徑會畫幾台）', /const legacy = corePool\.reduce\(\(sum, ln\) => sum \+ metroCoreLegacyCountForLine\(ln\), 0\);/],
  ['P1-8 錯誤要推到徽章，不只存在 state', /state\.metroCore\.error = String\(error && error\.message \|\| error\);\s*\n\s*updateMetroBadge\(\);/],
  ['P2-9 match 欄位真的被讀（不再只賦值）', /const declared = row\.match == null \? null : String\(row\.match\);/],
  ['P2-9 比例判準配正向對照（total 為 0 不判定）', /ratio: total \? matched \/ total : null/],
  ['退回閘門同時作用在看板路徑', /systemId: systemId && !metroCoreLineBlocked\(systemId, ln\.id\) \? systemId : null/],
  // ── 共站辨線（#7 9bc4348 的前端保護，以 v0821b 資料結構重寫）──
  ['共站辨線：看板列的線／方向／終點都要對得上它指到的車',
    /function metroCoreRowVehicleId\(system, board, row\)[\s\S]*?String\(train\.lineId\) !== String\(board\.lineId\)[\s\S]*?Number\(train\.direction\) !== Number\(row\.direction\)[\s\S]*?Number\(train\.destinationStationIndex\) !== Number\(row\.destinationStationIndex\)/],
  ['共站辨線：對不上只讓那一列失去身分，不整包退回',
    /const vehicleId = metroCoreRowVehicleId\(system, board, row\);[\s\S]*?vehicleId, match: vehicleId == null \? 'unmatched' :/],
  ['共站辨線：誤配的列不得算進 P2-9 分子',
    /if \(declared !== 'unmatched' && metroCoreRowVehicleId\(system, board, row\) != null\) matched\+\+;/],
  ['地圖點車保留 Core 身分（否則 applyFreqFollow 會拿 Core 的 vehicleId 去查 legacy 名冊）',
    /if \(inside\) hits\.push\(\{ ln: h\.ln, k: h\.k, tr: h\.tr, core: !!h\.core,\s*\n\s*systemId: h\.systemId, vehicleId: h\.vehicleId/],
];
for (const [label, pattern] of contracts) check(pattern.test(html), label);
const appContracts = [
  ['正式站 CSP 放行 Core endpoint', /connect-src[^\n]*https:\/\/railisland-metro-core\.sirius1984\.workers\.dev/, headers],
  ['App build 有明確環境旗標', /process\.env\.RAIL_ENABLE_METRO_CORE === '1'/, prepareWeb],
  ['App bundle 注入 Core 旗標', /window\.RAIL_METRO_CORE_ENABLED=\$\{enableMetroCore\}/, prepareWeb],
  ['App 發行閘門核對 Core 旗標', /expectMetroCore/, verifyRelease],
];
for (const [label, pattern, source] of appContracts) check(pattern.test(source), label);

if (failures.length) {
  console.error(`Metro Core bridge 驗收失敗（${failures.length}）`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Metro Core bridge 靜態契約通過：${contracts.length + appContracts.length} 項，雙方向補間 4 項`);
