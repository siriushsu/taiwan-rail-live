#!/usr/bin/env node
// /api/bus-stop-search 與 /api/bus-stop-live 的離線回歸（fixture-only，不打真網路）。
//
// 🔴 語系與時鐘都釘死：
//    - 時鐘：全程用固定的 FIXED_NOW，不用 Date.now() 當期望值（否則判準會跟著實作一起漂）。
//    - 語系：不用任何中文字串找東西，全部用 stationUid／sourceState 這類語系無關的鍵比對。
// 🔴 每個反向判準（「不該有 X」）都配一個正向對照，證明它該紅的時候真的會紅。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import worker, { _busStop } from '../worker.js';
import { BUS_STOP_INDEX_COLUMNS, parseProviderConfig } from './bus_live_core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const providersRaw = readFileSync(path.join(ROOT, 'data', 'bus_providers.json'));
const providers = JSON.parse(providersRaw);
const workerSource = readFileSync(path.join(ROOT, 'worker.js'), 'utf8');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name} — ${error.message}`); }
};

// 釘死的時鐘。快照時間比 now 早 5 秒 ⇒ ageSec = 5，遠小於 N1_STALE_AFTER_SEC(180) ⇒ 不 stale。
const FIXED_NOW = Date.parse('2026-09-11T10:00:00+08:00');
const SNAPSHOT_TEXT = '2026/09/11 09:59:55';
const realDateNow = Date.now;
Date.now = () => FIXED_NOW;

// 兩個 fixture 站位：一個 direct-bulk（Taipei），一個 tdx-per-stop（YilanCounty）。
const INDEX_ROWS = [
  ['TPE-FIX-1', '固定站甲', 'Taipei', '25.047000', '121.517000', '0東|307', '111111|222222'],
  ['ILA-FIX-1', '固定站乙', 'YilanCounty', '24.757000', '121.758000', '綠19', 'ILA299137'],
];
const INDEX_TSV = INDEX_ROWS.map(r => r.join('\t')).join('\n') + '\n';
const INDEX_MANIFEST = {
  schemaVersion: 1, generatedAt: '2026-09-11T02:00:00.000Z', partial: true,
  columns: BUS_STOP_INDEX_COLUMNS, asset: '/data/bus_stops_index.tsv', stationCount: INDEX_ROWS.length,
  cities: {}, crosswalk: {}, stopIdPrefixCheck: [],
};

// 臺北市快照 fixture：五種 EstimateTime 各一筆（正數、-1、-2、-3、-4），外加一筆別站的
// （證明不會被本站吃進來）。GoBack 2／3 依官方字面不是方向 ⇒ direction 必須是 null。
const DIRECT_ESTIMATE = {
  EssentialInfo: { Location: { name: '台北市' }, UpdateTime: SNAPSHOT_TEXT },
  BusInfo: [
    { RouteID: 901, StopID: 111111, EstimateTime: '300', GoBack: '0' },
    { RouteID: 902, StopID: 111111, EstimateTime: '-1', GoBack: '2' },
    { RouteID: 903, StopID: 222222, EstimateTime: '-2', GoBack: '1' },
    { RouteID: 904, StopID: 222222, EstimateTime: '-3', GoBack: '3' },
    { RouteID: 905, StopID: 222222, EstimateTime: '-4', GoBack: '0' },
    { RouteID: 906, StopID: 999999, EstimateTime: '30', GoBack: '0' },
    { RouteID: 907, StopID: 111111, EstimateTime: '30', GoBack: '0' },
  ],
};
const DIRECT_ROUTE = {
  EssentialInfo: { Location: { name: '台北市' }, UpdateTime: SNAPSHOT_TEXT },
  BusInfo: [901, 902, 903, 904, 905, 906, 907].map(id => ({ Id: id, nameZh: `R${id}` })),
};

const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
const edge = new Map();
globalThis.caches = {
  default: {
    async match(request) { return edge.has(request.url) ? edge.get(request.url).clone() : undefined; },
    async put(request, response) { edge.set(request.url, response.clone()); },
  },
};

let authCalls = 0;
const directCalls = [];
const tdxCalls = [];
globalThis.fetch = async requestLike => {
  const url = new URL(requestLike instanceof URL ? requestLike.href : (typeof requestLike === 'string' ? requestLike : requestLike.url));
  if (url.hostname === 'auth.test') { authCalls += 1; return Response.json({ access_token: 'fixture-token', expires_in: 3600 }); }
  if (url.hostname === 'direct.test') {
    directCalls.push(url.pathname);
    const body = url.pathname.endsWith('/route') ? DIRECT_ROUTE : DIRECT_ESTIMATE;
    return new Response(gzipSync(Buffer.from(JSON.stringify(body))), { headers: { 'content-type': 'application/gzip' } });
  }
  if (url.hostname === 'bus.test') {
    tdxCalls.push(url);
    return Response.json([
      { RouteUID: 'ILA0583', RouteID: '0583', RouteName: { Zh_tw: '綠19' }, SubRouteUID: 'ILA058302', Direction: 1,
        StopUID: 'ILA299137', StopID: '299137', PlateNumb: 'KKA-2705', EstimateTime: 870, StopStatus: 0,
        SrcUpdateTime: new Date(FIXED_NOW - 5000).toISOString() },
      { RouteUID: 'ILA0999', RouteID: '0999', RouteName: { Zh_tw: '無即時' }, Direction: 0,
        StopUID: 'ILA299137', StopID: '299137', StopStatus: 1,
        SrcUpdateTime: new Date(FIXED_NOW - 5000).toISOString() },
      { RouteUID: 'ILA0111', RouteName: { Zh_tw: '別站' }, Direction: 0, StopUID: 'ILA-OTHER', StopStatus: 0,
        EstimateTime: 10, SrcUpdateTime: new Date(FIXED_NOW - 5000).toISOString() },
    ]);
  }
  throw new Error(`未預期 outbound fetch：${url}`);
};

let limiterCalls = 0;
let limiterAllow = Infinity;
const makeEnv = (overrides = {}) => ({
  TDX_CLIENT_ID: 'fixture-id',
  TDX_CLIENT_SECRET: 'fixture-secret',
  TDX_AUTH_URL_OVERRIDE: 'https://auth.test/token',
  BUS_N1_BASE_URL_OVERRIDE: 'https://bus.test/n1',
  BUS_DIRECT_BASE_OVERRIDE: 'https://direct.test',
  BUS_TRANSFER_DEBUG: true,
  BUS_LIMITER: { async limit() { limiterCalls += 1; return { success: limiterCalls <= limiterAllow }; } },
  ASSETS: {
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/data/bus_providers.json') return new Response(providersRaw, { headers: { 'content-type': 'application/json' } });
      if (url.pathname === '/data/bus_stops_index.json') return Response.json(INDEX_MANIFEST);
      if (url.pathname === '/data/bus_stops_index.tsv') return new Response(INDEX_TSV, { headers: { 'content-type': 'text/tab-separated-values' } });
      return new Response('not found', { status: 404 });
    },
  },
  ...overrides,
});

const reset = () => { _busStop.resetBusStopCaches(); edge.clear(); directCalls.length = 0; tdxCalls.length = 0; limiterCalls = 0; limiterAllow = Infinity; };
const get = (url, env) => worker.fetch(new Request(url), env, {});

// ── 設定檔就是端點的唯一來源 ──────────────────────────────────────────────
await check('worker.js 沒有寫死任何 direct-bulk 端點網址（設定檔才是正本）', () => {
  // 正向對照：同一條規則套在設定檔上必須命中，證明這個 regex 真的抓得到這種網址。
  const hostPattern = /tcgbusfs\.blob\.core\.windows\.net\/blobbus\/Get[A-Za-z]+\.gz/;
  assert(hostPattern.test(String(providersRaw)), '正向對照失敗：設定檔裡應該找得到臺北市端點');
  // 反向判準：worker.js 只准留 BusSeatEvent.gz（那是單元 C 之前就有的擁擠度來源，不在本批範圍）。
  const hits = workerSource.match(/https:\/\/tcgbusfs\.blob\.core\.windows\.net\/blobbus\/[A-Za-z]+\.gz/g) || [];
  assert.deepEqual(hits, ['https://tcgbusfs.blob.core.windows.net/blobbus/BusSeatEvent.gz'],
    `worker.js 不該再出現公車到站端點網址，實際命中：${JSON.stringify(hits)}`);
});

await check('設定檔壞掉要當場拋，不可以靜默讓縣市消失', async () => {
  reset();
  const bad = JSON.stringify({ ...providers, cities: { ...providers.cities, Taipei: { ...providers.cities.Taipei, provider: 'made-up' } } });
  const env = makeEnv({ ASSETS: { async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/data/bus_providers.json') return new Response(bad, { headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/data/bus_stops_index.json') return Response.json(INDEX_MANIFEST);
    if (url.pathname === '/data/bus_stops_index.tsv') return new Response(INDEX_TSV);
    return new Response('not found', { status: 404 });
  } } });
  const res = await get('https://railisland.tw/api/bus-stop-live?stop=TPE-FIX-1', env);
  assert.equal(res.status, 503, '設定檔 provider 值未知時應該 503，不可以當成沒有這個縣市');
});

await check('新增 direct-bulk 縣市時漏宣告碼表要當場拋，不得沿用臺北的碼義', () => {
  // 🔴 漏宣告時舊寫法會靜靜退回程式碼裡的臺北預設值——那等於把臺北的官方碼義套到別的城市，
  //    是「自己猜官方值是什麼意思」的另一種寫法，而且完全沒有錯誤訊息。
  const fmt = providers.cities.Taipei.directBulk.format;
  for (const field of ['negativeEstimateCodes', 'goBackCodes']) {
    const broken = JSON.parse(JSON.stringify(providers));
    delete broken.directBulkFormats[fmt][field];
    assert.throws(() => parseProviderConfig(broken), new RegExp(field), `format 漏了 ${field} 卻沒有拋`);
  }
  // 正向對照：真的設定檔必須過得了，否則上面兩條可能只是「什麼都拋」。
  assert(parseProviderConfig(JSON.parse(JSON.stringify(providers))), '正向對照失敗：真的設定檔應該解析得過');
});

// ── direct-bulk ───────────────────────────────────────────────────────────
await check('direct-bulk：五種 EstimateTime 各自對到官方字面的語意，不收斂成同一個沒資料', async () => {
  reset();
  const res = await get('https://railisland.tw/api/bus-stop-live?stop=TPE-FIX-1', makeEnv());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.provider, 'direct-bulk');
  const byRoute = Object.fromEntries(body.arrivals.map(a => [a.routeId, a]));
  assert.equal(byRoute['901'].live.sourceState, 'countdown');
  assert.equal(byRoute['901'].live.etaSec, 295, 'etaSec 要扣掉快照年齡 5 秒：300-5=295');
  assert.equal(byRoute['902'].live.sourceState, 'not_departed');   // -1 尚未發車
  assert.equal(byRoute['903'].live.sourceState, 'skipped');        // -2 交管不停靠
  assert.equal(byRoute['904'].live.sourceState, 'last_bus_passed');// -3 末班車已過
  assert.equal(byRoute['905'].live.sourceState, 'not_operating');  // -4 今日未營運
  assert.equal(byRoute['907'].live.sourceState, 'arriving');       // <=60 秒
  // 四個負值必須各自是一種語意，不可以被收斂成同一個「沒資料」。
  const negatives = ['902', '903', '904', '905'].map(id => byRoute[id].live.sourceState);
  assert.equal(new Set(negatives).size, 4, `四種負值語意被收斂了：${negatives.join(',')}`);
  // 原值保留：UI 要顯示不出來時仍能回頭查官方字面。
  assert.deepEqual(['902', '903', '904', '905'].map(id => byRoute[id].live.estimateSecAtSource), [-1, -2, -3, -4]);
});

await check('direct-bulk：GoBack 2／3 官方寫的不是方向 ⇒ direction 必須是 null，不准猜', async () => {
  reset();
  const body = await (await get('https://railisland.tw/api/bus-stop-live?stop=TPE-FIX-1', makeEnv())).json();
  const byRoute = Object.fromEntries(body.arrivals.map(a => [a.routeId, a]));
  assert.equal(byRoute['902'].direction, null, 'GoBack=2（尚未發車）不是方向');
  assert.equal(byRoute['904'].direction, null, 'GoBack=3（末班已駛離）不是方向');
  // 正向對照：0／1 真的是方向，必須解析出來——否則上面兩條可能只是「全部都 null」的假綠。
  assert.equal(byRoute['901'].direction, 0);
  assert.equal(byRoute['903'].direction, 1);
});

await check('direct-bulk：不屬於本站的 StopID 不得混進來（配正向對照）', async () => {
  reset();
  const body = await (await get('https://railisland.tw/api/bus-stop-live?stop=TPE-FIX-1', makeEnv())).json();
  assert(!body.arrivals.some(a => a.stopId === '999999'), '別站的列被吃進來了');
  // 正向對照：本站兩個 providerStopIds 都要真的有列，否則「沒有 999999」可能只是因為一列都沒有。
  assert(body.arrivals.some(a => a.stopId === '111111'), '正向對照失敗：111111 一列都沒有');
  assert(body.arrivals.some(a => a.stopId === '222222'), '正向對照失敗：222222 一列都沒有');
});

await check('direct-bulk：mem TTL 內只打一次上游，整份快照全站共用', async () => {
  reset();
  await get('https://railisland.tw/api/bus-stop-live?stop=TPE-FIX-1', makeEnv());
  const afterFirst = directCalls.filter(p => p.endsWith('/estimate')).length;
  edge.clear();                       // 清掉邊緣，逼它回到 Worker
  await get('https://railisland.tw/api/bus-stop-live?stop=TPE-FIX-1', makeEnv());
  const afterSecond = directCalls.filter(p => p.endsWith('/estimate')).length;
  assert.equal(afterFirst, 1, `第一次應該剛好打一次，實際 ${afterFirst}`);
  assert.equal(afterSecond, 1, `mem TTL 內不該再打上游，實際 ${afterSecond}`);
});

await check('direct-bulk 不取 TDX token（它不計 TDX 配額）', async () => {
  reset();
  const before = authCalls;
  await get('https://railisland.tw/api/bus-stop-live?stop=TPE-FIX-1', makeEnv());
  assert.equal(authCalls, before, 'direct-bulk 路徑不該打 TDX auth');
});

// ── tdx-per-stop ──────────────────────────────────────────────────────────
await check('tdx-per-stop：以 StopUID 叢集查詢，濾條件只含本站 StopUID', async () => {
  reset();
  const res = await get('https://railisland.tw/api/bus-stop-live?stop=ILA-FIX-1', makeEnv());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.provider, 'tdx-per-stop');
  assert.equal(tdxCalls.length, 1);
  const filter = tdxCalls[0].searchParams.get('$filter');
  assert(filter.includes("StopUID eq 'ILA299137'"), `filter 沒帶本站 StopUID：${filter}`);
  assert(!filter.includes('TPE'), 'filter 混入別縣市站牌');
  assert(!body.arrivals.some(a => a.stopId === 'ILA-OTHER'), '別站的列被吃進來了');
  assert(body.arrivals.some(a => a.stopId === 'ILA299137'), '正向對照失敗：本站一列都沒有');
});

await check('tdx-per-stop：沒有即時資料就照實說沒有，不用班表頂替也不留白', async () => {
  reset();
  const body = await (await get('https://railisland.tw/api/bus-stop-live?stop=ILA-FIX-1', makeEnv())).json();
  const noLive = body.arrivals.find(a => a.routeId === 'ILA0999');
  assert(noLive, '沒有即時資料那一列應該仍然在列表裡（留白會讓人以為壞了）');
  assert.equal(noLive.live.sourceState, 'not_departed', 'StopStatus 1 要保留成尚未發車');
  assert.equal(noLive.live.etaSec, null, '沒有即時資料不得編造秒數');
  const live = body.arrivals.find(a => a.routeId === 'ILA0583');
  assert.equal(live.live.sourceState, 'countdown');
  assert.equal(live.live.etaSec, 865, '870 秒扣掉 5 秒的來源年齡');
});

await check('tdx-per-stop：快取鍵是 StopUID 叢集，不是座標', () => {
  // 邊緣快取鍵在 tdxStopSnapshot 內組出來；證明它帶的是 stops 不是 lat/lon。
  const source = workerSource.slice(workerSource.indexOf('async function tdxStopSnapshot'), workerSource.indexOf('async function busStopSearch'));
  assert(source.includes('stops=') && source.includes('clusterKey'), '快取鍵沒帶 StopUID 叢集');
  assert(!/lat|lon|PositionLat/.test(source), '快取鍵疑似帶了座標');
});

// ── 搜尋 ──────────────────────────────────────────────────────────────────
await check('搜尋：站牌名與路線號都認得（語系無關的鍵比對）', async () => {
  reset();
  const byName = await (await get('https://railisland.tw/api/bus-stop-search?q=%E5%9B%BA%E5%AE%9A%E7%AB%99%E7%94%B2', makeEnv())).json();
  assert.deepEqual(byName.rows.map(r => r.stationUid), ['TPE-FIX-1']);
  reset();
  const byRoute = await (await get('https://railisland.tw/api/bus-stop-search?q=%E7%B6%A019', makeEnv())).json();
  assert.deepEqual(byRoute.rows.map(r => r.stationUid), ['ILA-FIX-1'], '路線號查不到');
  reset();
  const miss = await (await get('https://railisland.tw/api/bus-stop-search?q=zzzzzz', makeEnv())).json();
  assert.deepEqual(miss.rows, [], '不該命中的查詢卻有結果');
  assert.equal(miss.total, 0);
});

await check('搜尋：回傳帶 provider 與縣市標籤（前端要靠它講清楚資料來源）', async () => {
  reset();
  const body = await (await get('https://railisland.tw/api/bus-stop-search?q=%E5%9B%BA%E5%AE%9A%E7%AB%99', makeEnv())).json();
  const tpe = body.rows.find(r => r.stationUid === 'TPE-FIX-1');
  const ila = body.rows.find(r => r.stationUid === 'ILA-FIX-1');
  assert.equal(tpe.provider, 'direct-bulk');
  assert.equal(ila.provider, 'tdx-per-stop');
  assert.equal(tpe.cityLabel, providers.cities.Taipei.label);
});

await check('索引行數與 manifest 不符要拋，不可以靜默少站', async () => {
  reset();
  const env = makeEnv({ ASSETS: { async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/data/bus_providers.json') return new Response(providersRaw);
    if (url.pathname === '/data/bus_stops_index.json') return Response.json({ ...INDEX_MANIFEST, stationCount: 99 });
    if (url.pathname === '/data/bus_stops_index.tsv') return new Response(INDEX_TSV);
    return new Response('not found', { status: 404 });
  } } });
  const res = await get('https://railisland.tw/api/bus-stop-search?q=%E5%9B%BA%E5%AE%9A', env);
  assert.equal(res.status, 503);
});

// ── limiter：要證明它真的會擋 ─────────────────────────────────────────────
await check('limiter 擋得住：超過上限回 429，且不再打任何上游', async () => {
  reset();
  limiterAllow = 2;                  // 前兩發放行，第三發起擋下
  const env = makeEnv();
  const first = await get('https://railisland.tw/api/bus-stop-live?stop=TPE-FIX-1', env);
  assert.equal(first.status, 200, '第一發應該放行');
  const second = await get('https://railisland.tw/api/bus-stop-search?q=%E5%9B%BA%E5%AE%9A', env);
  assert.equal(second.status, 200, '第二發應該放行');
  const upstreamBefore = directCalls.length + tdxCalls.length;
  const third = await get('https://railisland.tw/api/bus-stop-live?stop=ILA-FIX-1', env);
  assert.equal(third.status, 429, `第三發應該被擋，實際 ${third.status}`);
  assert.deepEqual(await third.json(), { error: 'rate_limited' });
  assert.equal(directCalls.length + tdxCalls.length, upstreamBefore, '被擋下之後不該再打上游');
});

await check('limiter 也掛在既有的 bus-transfer／bus-leg-live 上（本批補的那兩支）', () => {
  for (const fn of ['async function busTransfer(', 'async function busLegLive(']) {
    const start = workerSource.indexOf(fn);
    assert(start > 0, `找不到 ${fn}`);
    const head = workerSource.slice(start, start + 1400);
    assert(head.includes('rateLimited(env.BUS_LIMITER, request)'), `${fn} 沒掛 BUS_LIMITER`);
  }
  // 正向對照：同一把尺套在一支「本來就沒有 limiter」的端點上必須失敗，證明這個檢查有牙。
  const noLimiter = workerSource.slice(workerSource.indexOf('async function thsrFreeSeat('), workerSource.indexOf('async function thsrFreeSeat(') + 1400);
  assert(!noLimiter.includes('rateLimited(env.BUS_LIMITER'), '正向對照失敗：對照組竟然也有 BUS_LIMITER');
});

await check('wrangler.jsonc 有宣告 BUS_LIMITER binding', () => {
  const wrangler = readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8');
  assert(/"name":\s*"BUS_LIMITER"/.test(wrangler), 'wrangler.jsonc 沒有 BUS_LIMITER');
  const ids = [...wrangler.matchAll(/"namespace_id":\s*"(\d+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, `namespace_id 重複：${ids.join(',')}`);
});

// ── 雙層 TTL 的算式要與註解一致 ───────────────────────────────────────────
await check('雙層 TTL：實際上游間隔＝最小的、大於 mem 的 edge 倍數', () => {
  const pairs = [
    ['direct-bulk', _busStop.BUS_DIRECT_EDGE_TTL_SEC, _busStop.BUS_DIRECT_MEM_TTL_MS / 1000, 20],
    ['tdx-per-stop', _busStop.BUS_TDX_EDGE_TTL_SEC, _busStop.BUS_TDX_MEM_TTL_MS / 1000, 60],
  ];
  for (const [kind, edgeSec, memSec, expected] of pairs) {
    assert(memSec > edgeSec, `${kind}: mem(${memSec}) 必須大於 edge(${edgeSec})`);
    const actual = Math.ceil((memSec + 1e-9) / edgeSec) * edgeSec;
    assert.equal(actual, expected, `${kind}: 算出來的上游間隔 ${actual} 與註解寫的 ${expected} 不符`);
  }
});

globalThis.fetch = realFetch;
globalThis.caches = realCaches;
Date.now = realDateNow;
if (failures) { console.error(`\n${failures} 項未過`); process.exit(1); }
console.log('\nGREEN 全部通過');
