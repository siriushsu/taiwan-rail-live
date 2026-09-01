#!/usr/bin/env node

// 估算「公車轉乘」新功能的 TDX 增量用量；不含本站原有的台鐵／高鐵／捷運 API。
// 資料取自使用者點開當下，不含任何背景輪詢。

const defaults = {
  stationOpens: 10_000,
  routeOpens: 4_000,
  cacheHitRate: 0,
  stationBytes: 10_000,
  routeBytes: 1_500,
};

const args = process.argv.slice(2);
const readNumber = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} 必須是非負數`);
  return value;
};

const stationOpens = readNumber('station-opens', defaults.stationOpens);
const routeOpens = readNumber('route-opens', defaults.routeOpens);
const cacheHitRate = readNumber('cache-hit-rate', defaults.cacheHitRate);
const stationBytes = readNumber('station-bytes', defaults.stationBytes);
const routeBytes = readNumber('route-bytes', defaults.routeBytes);
if (cacheHitRate > 1) throw new Error('--cache-hit-rate 請用 0–1 之間的小數');

// 車站卡：City N1 + InterCity N1；路線展開：A1 + A2。
// OAuth token 取得不列入資料 API 呼叫；臺北擁擠度來自臺北市公開檔，不列入 TDX。
const missRate = 1 - cacheHitRate;
const coldStationOpens = stationOpens * missRate;
const coldRouteOpens = routeOpens * missRate;
const calls = 2 * (coldStationOpens + coldRouteOpens);
const bytes = coldStationOpens * stationBytes + coldRouteOpens * routeBytes;
const pointsByCalls = calls / 1_500;
const pointsByBytes = bytes / 150_000_000;
const totalPoints = pointsByCalls + pointsByBytes;

const integer = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const mb = bytes / 1_000_000;

console.log(`車站卡開啟: ${integer.format(stationOpens)} 次/月`);
console.log(`路線詳情開啟: ${integer.format(routeOpens)} 次/月`);
console.log(`20 秒 raw cache 命中率: ${decimal.format(cacheHitRate * 100)}%`);
console.log(`TDX 資料 API 呼叫: ${integer.format(calls)} 次 → ${decimal.format(pointsByCalls)} 點（計次）`);
console.log(`TDX 傳輸量: ${decimal.format(mb)} MB → ${decimal.format(pointsByBytes)} 點（計量）`);
console.log(`估計增量合計: ${decimal.format(totalPoints)} 點/月`);

