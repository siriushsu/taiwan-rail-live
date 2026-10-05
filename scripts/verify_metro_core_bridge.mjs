#!/usr/bin/env node
// Private Metro Core 公開端橋接的純靜態契約驗收：不打網路、不啟動瀏覽器。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.resolve(HERE, '..', 'index.html'), 'utf8');
const headers = fs.readFileSync(path.resolve(HERE, '..', '_headers'), 'utf8');
const worker = fs.readFileSync(path.resolve(HERE, '..', 'worker.js'), 'utf8');
const prepareWeb = fs.readFileSync(path.resolve(HERE, '..', 'app/scripts/prepare-web.mjs'), 'utf8');
const verifyRelease = fs.readFileSync(path.resolve(HERE, '..', 'app/scripts/verify-release.mjs'), 'utf8');
const krtcData = JSON.parse(fs.readFileSync(path.resolve(HERE, '..', 'data/krtc.json'), 'utf8'));
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

const klrtLine = (krtcData.lines || []).find(line => line && line.id === 'C');
check(klrtLine && klrtLine.loop === true && klrtLine.stations?.length === 38,
  'KLRT C 靜態線形必須維持 38 個真實站且標為環線');

const graceSandbox = {
  ntmFeedForSystem: () => null,
  METRO_CORE_FOLLOW_GRACE_SEC: 30,
  metroCoreDisplayFollowRecord: () => graceSandbox.current,
  metroCorePositionAt: (ln, train, epoch) => epoch < train.retireAt ? { lat: epoch, lon: 0 } : null,
  current: { systemId: 'trtc', train: { retireAt: 1000 }, ln: { id: 'BL' }, pos: { lat: 0, lon: 0 } }
};
vm.runInNewContext(`${extractFunction('metroCoreFollowRecordWithGrace')}; this.followGrace = metroCoreFollowRecordWithGrace;`, graceSandbox);
const follow = {};
check(graceSandbox.followGrace(follow, 100) === graceSandbox.current, 'Core 跟隨首次命中未保存身分');
graceSandbox.current = null;
check(graceSandbox.followGrace(follow, 129)?.grace === true, 'Core 短暫漏一批時未沿用已確認軌跡');
check(graceSandbox.followGrace(follow, 131) === null, 'Core 漏超過兩批後仍未結束寬限');

const contracts = [
  // 2026-08-28 網站預設重新開啟（return true）；App 的兩個注入點必須在 return 之前，
  // 否則網站的預設值會蓋掉 App v13 的原生恆開。這條同時把「順序」釘住。
  ['網站預設開啟且 App 注入點在預設值之前', /if \(METRO_CORE_QUERY_MODE === 'off'\) return false;[\s\S]*?typeof window\.RAIL_METRO_CORE_ENABLED === 'boolean'[\s\S]*?typeof APP_CFG\.metroCore === 'boolean'[\s\S]*?\n  return true;\n\}[\s\S]*?const METRO_CORE_ENABLED = metroCoreFlag\(location\.search\)/],
  ['?metrocore=1 仍可顯式開啟（預覽站的開關）', /if \(value === '1' \|\| value === 'preview'\) return true;/],
  ['App 可注入獨立布林旗標', /typeof window\.RAIL_METRO_CORE_ENABLED === 'boolean'/],
  ['正式 endpoint 不再指向 Preview', /https:\/\/railisland-metro-core\.sirius1984\.workers\.dev\/v1\/metro\/snapshot/],
  ['snapshot 有 schema 驗證', /snapshot\.schema !== METRO_CORE_SCHEMA/],
  ['snapshot 過期會降級', /Number\(snapshot\.validUntil\) >= Number\(nowEpoch\)/],
  ['非真實現在會降級', /trtcOfficialBoardRealNow\(\)/],
  ['支援 ETag', /headers\['if-none-match'\] = state\.metroCore\.etag/],
  ['支援 304 保留快照', /response\.status === 304/],
  ['防止舊 snapshot 倒灌', /snapshot rollback/],
  ['一般捷運層讀取 Core 顯示名單', /function drawFreq[\s\S]*?metroCoreDisplayItemsForLine\(ln, officialNow\)/],
  ['全台裝飾層讀取 Core 顯示名單', /function drawDecoTrains[\s\S]*?metroCoreDisplayItemsForLine\(ln, officialNow\)/],
  ['Core 地圖與跟隨逐字採用 canonical 軌跡，不在顯示層遮掩跳動',
    /function metroCoreItemsForLine[\s\S]*?metroCorePositionAt\(ln, train, nowEpoch\)[\s\S]*?function metroCoreFollowRecord[\s\S]*?metroCorePositionAt\(ln, train, nowEpoch\)/],
  ['站牌共用 vehicle ID', /data-core-vehicle/],
  ['Core 看板缺單一方向時只補該方向班表',
    /const officialDirections = new Set[\s\S]*?metroCoreLegacyGroupsForEntry\(entry, officialDirections\)/],
  ['跟隨保存 Core 身分形狀', /\{ core: true, systemId: String\(target\.systemId\), lineId: String\(target\.ln\.id\), vehicleId: String\(target\.vehicleId\) \}/],
  ['地圖命中保留 Core 來源', /hits\.push\(\{ ln: h\.ln, k: h\.k, tr: h\.tr, core: !!h\.core,[\s\S]*?systemId: h\.systemId/],
  ['snapshot 看板與車強制同線同向同終點', /String\(train\.lineId\) !== String\(board\.lineId\)[\s\S]*?Number\(train\.direction\) !== Number\(row\.direction\)[\s\S]*?Number\(train\.destinationStationIndex\) !== Number\(row\.destinationStationIndex\)/],
  ['Core 跟隨有兩批寬限', /METRO_CORE_FOLLOW_GRACE_SEC = 30/],
  ['Core 上線後斷訊判斷不再讀背景 legacy 時戳', /function metroCoreTrtcFeedState[\s\S]*?failedFor >= 30[\s\S]*?ageSec >= TRTC_FEED_STALE_SEC/],
  ['進站文字查驗實際距離', /distanceM <= 25/],
  ['失效時回到既有站牌',
    /const core = metroCoreBoardView\([^;]+;[\s\S]*?if \(core\) return renderMetroCoreFreqBoard\([^;]+;[\s\S]*?const official = trtcOfficialBoardView/],
  // ── 2026-08-21 復原批次補上的九道基底防線（行為面另有 verify_metro_core_defense.mjs）──
  ['P0-1 某線 0 台回 null，不得用空陣列短路 legacy', /return out\.length \? out : null;/],
  ['P0-1 snapshot 缺該系統也回 null', /if \(!system\) return null; \/\/ 🔴 P0-1/],
  ['P0-2 逐線車數相對基線腰斬閘門', /const METRO_CORE_COUNT_DROP = 0\.5;[\s\S]*?function metroCoreEvaluateCounts\(/],
  ['P0-2 判為異常那一輪不進基線（防自我漂移）', /else \{ history\.push\(cur\);/],
  ['P0-3 十二個合法 lineId 寫成常數（含獨立 KLRT C）', /const METRO_CORE_LINE_IDS = \{[\s\S]*?trtc:\s*\['BR', 'R', 'R_XBT', 'G', 'G_XBT', 'O_XINZHUANG', 'O_LUZHOU', 'BL', 'Y'\][\s\S]*?krtc:\s*\['KR', 'KO'\][\s\S]*?klrt:\s*\['C'\]/],
  ['KLRT C 映射到獨立 Core system，不混進 krtc',
    /function metroCoreSystemIdForLine\(ln\)[\s\S]*?sys === 'krtc' && id === 'C' && ln && ln\.loop\) return 'klrt';/],
  ['KLRT 虛擬 38 只在補間後映回真實站 0',
    /function metroCoreKlrtLoop\(ln\)[\s\S]*?String\(ln\.id\) === 'C'[\s\S]*?metroCoreSystemIdForLine\(ln\) === 'klrt'[\s\S]*?function metroCoreFlatMax\(ln\)[\s\S]*?metroCoreKlrtLoop\(ln\) \? ln\.stations\.length : ln\.stations\.length - 1[\s\S]*?function metroCoreStationAt\(ln, flatIndex\)[\s\S]*?index === ln\.stations\.length\) return ln\.stations\[0\]/],
  ['KLRT 站 0 逆行起點轉成虛擬 38',
    /function metroCoreBoardFlatIndex\(ln, stationIndex, direction\)[\s\S]*?metroCoreKlrtLoop\(ln\) && index === 0 && Number\(direction\) === 1[\s\S]*?\? ln\.stations\.length : index/],
  ['KLRT 37→38 用真實 37→0 補間且保留 raw progress',
    /function metroCorePositionAt\(ln, train, epoch\)[\s\S]*?metroCoreSampleTrain\(train, epoch\)[\s\S]*?metroCoreFlatMax\(ln\)[\s\S]*?metroCoreStationAt\(ln, from\)[\s\S]*?metroCoreStationAt\(ln, to\)[\s\S]*?physicalTo[\s\S]*?posBetweenStations\(ln, physicalFrom, physicalTo, progress - from\)[\s\S]*?return pos \? \{ \.\.\.sampled, \.\.\.pos, progress,/],
  ['Core C 看板用 flat adapter 取虛擬終點、rec 保留原 destinationStationIndex',
    /function metroCoreBoardView\([\s\S]*?const destIndex = Number\(row\.destinationStationIndex\)[\s\S]*?dest\s*=\s*metroCoreStationAt\(entry\.ln, destIndex\)[\s\S]*?destinationStationIndex: destIndex/],
  ['Core C 看板方向由 Core direction 2／1 對應順行／逆行',
    /function metroCoreKlrtBoardRoute\(ln, stationIndex, direction\)[\s\S]*?metroCoreKlrtLoop\(ln\)[\s\S]*?step = direction === 2 \? 1 : -1[\s\S]*?return \{ direction: step, nextName: next\.name, viaName \}/],
  ['Core C 看板沿用環線雙行 markup，且途經站不被目的地取代',
    /function renderMetroCoreFreqBoard\([\s\S]*?const route = group\.klrtRoute;[\s\S]*?route\.direction === 1 \? '順行' : '逆行'[\s\S]*?class="row\$\{route \? ' klrt-board-row' : ''\}[\s\S]*?route \? t\('經 \{stations\}'/],
  ['KLRT Core GPS 來源顯示衛星定位校正文案',
    /(?:source\s*===\s*'gps'|case\s*'gps'\s*:)[\s\S]{0,300}?t\('● 已依官方列車衛星定位校正'\)/],
  ['KLRT Core board 來源顯示逐站倒數推算文案',
    /(?:source\s*===\s*'board'|case\s*'board'\s*:)[\s\S]{0,300}?t\('● 已依官方到站看板逐站倒數推算'\)/],
  ['KLRT Core hold 來源明示沿用最後官方位置',
    /(?:source\s*===\s*'hold'|case\s*'hold'\s*:)[\s\S]{0,300}?t\('官方資料暫時中斷，沿用最後一次官方位置'\)/],
  ['KLRT Core 跟車卡保留環狀線循環語意',
    /function metroCoreVehicleInfo\(rec\)[\s\S]*?return \{ ln, pos, loop: !!ln\.loop/],
  ['KLRT 待發兩方向從 flat 0／38 推出真正下一站',
    /function metroCoreVehicleInfo\(rec\)[\s\S]*?exactIndex !== destinationIndex[\s\S]*?exactIndex \+ step[\s\S]*?routeDirection: metroCoreKlrtLoop\(ln\) \? step : null/],
  ['KLRT Core 跟車卡明示順行／逆行',
    /const fcDirTxt = info\.loop[\s\S]*?info\.routeDirection === 1 \? t\('順行'\)[\s\S]*?info\.routeDirection === -1 \? t\('逆行'\)/],
  ['KLRT 合法匿名倒數不觸發整個 system 的 match fallback',
    /for \(const sysId in ratios\)[\s\S]*?if \(sysId === 'klrt'\) continue;[\s\S]*?r\.ratio < METRO_CORE_MATCH_MIN/],
  ['P0-3 未知 lineId 只隔離所屬系統', /function metroCoreSystemLineIdError\(system\)[\s\S]*?return unknown\.length \? \{ reason: 'lineId', unknown \} : null/],
  ['P0-3 schema 錯誤逐系統隔離', /function metroCorePrepareSnapshot\(snapshot\)[\s\S]*?isolatedSystems\[key\] = issue[\s\S]*?systems\.push\(system\)/],
  ['P0-3 建線時做 id 契約自檢', /function metroCoreSelfCheckLineIds\(\)[\s\S]*?state\.metroCore\.selfCheck = result/],
  ['P0-4 跟隨 30 秒寬限常數', /const METRO_CORE_FOLLOW_GRACE_SEC = 30;/],
  ['P0-4 每幀跟隨判定走寬限版', /function updateFreqFollowCamera[\s\S]*?metroCoreFollowRecordWithGrace\(f, Date\.now\(\) \/ 1000\)/],
  // 文案在 994a9ce 改成「超過 30 秒」（實際條件是 METRO_CORE_FOLLOW_GRACE_SEC=30 秒，
  // 不是「兩批」）。判準只綁「講的是即時模型找不到這台車」這個真因，不綁確切措辭，
  // 否則每改一次文案就假紅一次；同時排除舊的錯誤歸因「官方名冊已更新」。
  ['P0-4 退場文案講真因', /不在即時模型中，已結束跟隨/],
  ['P0-5 徽章不再以 hidden 表示 0 台', /el\.textContent = t\('即時資料異常'\);/],
  ['P0-5 0 台的判準取自不同來源（既有路徑會畫幾台）', /const legacy = corePool\.reduce\(\(sum, ln\) => sum \+ metroCoreLegacyCountForLine\(ln\), 0\);/],
  ['P1-8 錯誤要推到徽章，不只存在 state', /state\.metroCore\.error = String\(error && error\.message \|\| error\);\s*\n\s*updateMetroBadge\(\);/],
  ['P2-9 match 欄位真的被讀（不再只賦值）', /const declared = row\.match == null \? null : String\(row\.match\);/],
  ['P2-9 比例判準配正向對照（total 為 0 不判定）', /ratio: total \? matched \/ total : null/],
  ['核心看板仍遵守快照與退回閘門；獨立有效倒數不依賴核心',
    /const usable = coreLive && systemId && !metroCoreLineBlocked\(systemId, ln\.id\) && !!metroCoreSystem\(systemId\);[\s\S]*?systemId: usable \? systemId : null[\s\S]*?metroSourceRowsForEntry\(entry, nowEpoch\)/],
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
  ['KLRT 看板代理保留官方方向與來源時刻欄位',
    /op === 'KLRT' \? ',TripHeadSign,SrcUpdateTime'[\s\S]*?encodeURIComponent\(select\)[\s\S]*?op === 'KLRT'[\s\S]*?TripHeadSign\.Zh_tw[\s\S]*?su: x\.SrcUpdateTime/, worker],
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
console.log(`Metro Core bridge 靜態契約通過：${contracts.length + appContracts.length} 項，雙方向補間 4 項、跟隨寬限 3 項`);
