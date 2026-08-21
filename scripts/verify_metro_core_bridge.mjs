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

const graceSandbox = {
  METRO_CORE_FOLLOW_GRACE_SEC: 30,
  metroCoreFollowRecord: () => graceSandbox.current,
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
  ['地圖命中保留 Core 來源', /hits\.push\(\{ ln: h\.ln, k: h\.k, tr: h\.tr, core: !!h\.core,[\s\S]*?systemId: h\.systemId/],
  ['snapshot 看板與車強制同線同向同終點', /String\(train\.lineId\) !== String\(board\.lineId\)[\s\S]*?Number\(train\.direction\) !== Number\(row\.direction\)[\s\S]*?Number\(train\.destinationStationIndex\) !== Number\(row\.destinationStationIndex\)/],
  ['Core 跟隨有兩批寬限', /METRO_CORE_FOLLOW_GRACE_SEC = 30/],
  ['Core 上線後斷訊判斷不再讀背景 legacy 時戳', /function metroCoreTrtcFeedState[\s\S]*?failedFor >= 30[\s\S]*?ageSec >= TRTC_FEED_STALE_SEC/],
  ['進站文字查驗實際距離', /distanceM <= 25/],
  ['失效時回到既有站牌', /if \(core\) \{ renderMetroCoreFreqBoard[\s\S]*?const official = trtcOfficialBoardView/],
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
console.log(`Metro Core bridge 靜態契約通過：${contracts.length + appContracts.length} 項，雙方向補間 4 項、跟隨寬限 3 項`);
