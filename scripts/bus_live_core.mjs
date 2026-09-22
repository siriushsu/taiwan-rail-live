// 公車站牌到站的純函式核心（provider 無關）。
//
// 這個模組刻意不碰 DOM、timer、fetch 或 Cloudflare binding：
// - 建置腳本用它驗設定檔、正規化站牌索引列。
// - Worker 用它把兩種 provider 的原始回應收斂成同一個資料契約。
// - 驗收腳本用固定 fixture 驗「負值不可收斂成同一個沒資料」「方向不明時不准猜」。
//
// 🔴 為什麼不直接沿用 bus_transfer_core.mjs：那一支的入口是「車站 → 附近站牌叢集」，
// 本批的入口是「單一站位 → 下一班」。兩者共用的是 `sourceState` 詞彙與 normalizeN1State，
// 直接 import 重用，不複製一份平行實作。

import { normalizeN1State, N1_STALE_AFTER_SEC, parseTimeMs, zhName } from './bus_transfer_core.mjs';

export const BUS_PROVIDER_SCHEMA = 1;
export const BUS_STOP_INDEX_SCHEMA = 1;
export { N1_STALE_AFTER_SEC };

// 臺北市 GetEstimateTime 的負值，逐字取自《臺北市 Data.Taipei 平台 API 說明文件》v6.3 第 4 頁：
//   「預估到站剩餘時間（單位：秒） -1：尚未發車 -2：交管不停靠 -3：末班車已過 -4：今日未營運」
// 對應到 TDX StopStatus 的官方字面（bus_transfer_core.mjs:140「0 正常、1 尚未發車、2 交管不停靠、
// 3 末班車已過、4 今日未營運」）——兩份官方文件的中文用字逐字相同，所以 -n ↔ StopStatus n
// 是照抄後的對齊，不是從資料自行推測。設定檔 data/bus_providers.json 是這張表的正本，
// 本常數只是 Worker 冷啟前的預設；兩者不一致時以設定檔為準（parseProviderConfig 會驗）。
export const TAIPEI_NEGATIVE_ESTIMATE_CODES = Object.freeze({
  '-1': 'not_departed',
  '-2': 'skipped',
  '-3': 'last_bus_passed',
  '-4': 'not_operating',
});

// 「0：去程 1：返程 2：尚未發車 3：末班已駛離」——2 與 3 官方寫的不是方向，
// 🔴 所以方向一律 null，不猜去程或返程。
export const TAIPEI_GOBACK_DIRECTION = Object.freeze({ 0: 0, 1: 1, 2: null, 3: null });

const SOURCE_STATES = Object.freeze([
  'arriving', 'countdown', 'scheduled', 'not_departed',
  'no_estimate', 'unknown', 'skipped', 'last_bus_passed', 'not_operating',
]);
export const BUS_SOURCE_STATES = SOURCE_STATES;

const finite = value => {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

// ── 設定檔 ────────────────────────────────────────────────────────────────
// 設定檔壞掉要當場拋，不可以退回「假裝某縣市不存在」——那會讓整個縣市靜默消失而零錯誤訊息。
export function parseProviderConfig(raw) {
  if (!raw || raw.schemaVersion !== BUS_PROVIDER_SCHEMA) throw new Error('bus provider config schema mismatch');
  const formats = raw.directBulkFormats || {};
  const cities = raw.cities || {};
  const names = Object.keys(cities);
  if (!names.length) throw new Error('bus provider config 沒有任何縣市');
  for (const city of names) {
    const entry = cities[city];
    if (!entry || typeof entry !== 'object') throw new Error(`bus provider config 縣市 ${city} 形狀錯誤`);
    if (!['direct-bulk', 'tdx-per-stop'].includes(entry.provider)) throw new Error(`bus provider config 縣市 ${city} provider 未知：${entry.provider}`);
    if (entry.tdxScope !== `City/${city}`) throw new Error(`bus provider config 縣市 ${city} tdxScope 與鍵不符：${entry.tdxScope}`);
    if (entry.provider !== 'direct-bulk') continue;
    const direct = entry.directBulk;
    if (!direct || !direct.endpoints) throw new Error(`bus provider config 縣市 ${city} 宣告 direct-bulk 卻沒有 endpoints`);
    const format = formats[direct.format];
    if (!format) throw new Error(`bus provider config 縣市 ${city} 的 format 未定義：${direct.format}`);
    for (const kind of ['estimate', 'stop', 'route']) {
      const url = direct.endpoints[kind];
      // 🔴 只收 https 絕對網址：設定檔是唯一的端點來源，程式碼裡不得有備援網址可退。
      if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new Error(`bus provider config 縣市 ${city} 的 ${kind} 端點不是 https 絕對網址`);
    }
    // 🔴 碼表必須由設定檔宣告，不得省略。省略時會靜靜退回本檔的臺北預設值，等於把臺北的
    // 官方碼義套到另一個城市的來源上——那正是「自己猜官方值是什麼意思」的另一種寫法。
    if (!format.negativeEstimateCodes || !Object.keys(format.negativeEstimateCodes).length) {
      throw new Error(`bus provider config format ${direct.format} 沒有宣告 negativeEstimateCodes（不得沿用別的城市的碼義）`);
    }
    if (!format.goBackCodes || !Object.keys(format.goBackCodes).length) {
      throw new Error(`bus provider config format ${direct.format} 沒有宣告 goBackCodes（不得沿用別的城市的碼義）`);
    }
    for (const [code, state] of Object.entries(format.negativeEstimateCodes)) {
      if (!SOURCE_STATES.includes(state)) throw new Error(`bus provider config format ${direct.format} 的 ${code} 對到未知狀態 ${state}`);
    }
  }
  return { schemaVersion: raw.schemaVersion, defaultProvider: raw.defaultProvider || 'tdx-per-stop', directBulkFormats: formats, cities };
}

export function providerForCity(config, city) {
  const entry = config && config.cities && config.cities[city];
  if (!entry) return null;
  return entry;
}

// ── direct-bulk 正規化 ────────────────────────────────────────────────────
// 臺北市快照的 UpdateTime 是 "2026/09/11 10:07:20"（無時區）。官方 CenterName 是台北市公車動態
// 資訊中心，時間即台北時間 ⇒ 補 +08:00 再 parse。不補的話 V8 會當成本地時間，Worker 在 UTC 上
// 會整整早八小時，算出來的 age 變成 28800 秒、每一筆都被判成 stale。
export function parseDirectBulkUpdateTime(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const m = /^(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (m) return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`);
  return parseTimeMs(text);
}

// 一列 {RouteID, StopID, EstimateTime, GoBack} → 與 normalizeN1State 同形狀的 live 物件。
// 🔴 etaSec 要扣掉快照本身的年齡：EstimateTime 是「快照產生當下的剩餘秒數」，不是「現在」。
export function normalizeDirectBulkRow(row, {
  nowMs = Date.now(),
  snapshotMs = null,
  negativeCodes = TAIPEI_NEGATIVE_ESTIMATE_CODES,
  staleAfterSec = N1_STALE_AFTER_SEC,
} = {}) {
  const estimateRaw = row == null ? null : row.EstimateTime;
  const estimateSecAtSource = finite(estimateRaw);
  const ageSec = snapshotMs == null ? null : Math.max(0, Math.floor((nowMs - snapshotMs) / 1000));
  let sourceState;
  let etaSec = null;
  if (estimateSecAtSource != null && estimateSecAtSource >= 0) {
    etaSec = Math.max(0, Math.round(estimateSecAtSource - (ageSec || 0)));
    sourceState = etaSec <= 60 ? 'arriving' : 'countdown';
  } else if (estimateSecAtSource != null && negativeCodes[String(estimateSecAtSource)]) {
    sourceState = negativeCodes[String(estimateSecAtSource)];
  } else {
    // 官方沒列舉過的值：保留原值、顯示「無即時資料」，不自己猜它是什麼意思。
    sourceState = 'unknown';
  }
  const stale = ageSec == null || ageSec > staleAfterSec;
  return {
    state: stale ? 'stale' : sourceState,
    sourceState,
    etaSec,
    estimateSecAtSource,
    nextBusTime: null,
    stopStatus: null,
    sourceUpdatedAt: snapshotMs == null ? null : new Date(snapshotMs).toISOString(),
    ageSec,
    staleAfterSec,
  };
}

export function directBulkDirection(goBack, table = TAIPEI_GOBACK_DIRECTION) {
  const n = finite(goBack);
  if (n == null) return null;
  return Object.prototype.hasOwnProperty.call(table, n) ? table[n] : null;
}

// 一個站位（可能對到多個實體站牌 id）→ 每條路線方向一列。
// stopIds：該站位在 direct-bulk 來源的數字站牌 id 集合。
// routeNames：routeId → 路線名稱（GetRoute 表）。查不到名稱時列出 id，不丟掉那一列
// ——丟掉會讓「這站到底有沒有這班車」變成看不出來的缺口。
export function resolveDirectBulkStop({
  stopIds, rows, routeNames = new Map(), nowMs = Date.now(), snapshotMs = null,
  negativeCodes = TAIPEI_NEGATIVE_ESTIMATE_CODES, goBackTable = TAIPEI_GOBACK_DIRECTION,
  staleAfterSec = N1_STALE_AFTER_SEC, limit = 60,
}) {
  const wanted = new Set((stopIds || []).map(id => String(id)));
  const byKey = new Map();
  for (const row of rows || []) {
    const stopId = String(row && row.StopID != null ? row.StopID : '');
    if (!wanted.has(stopId)) continue;
    const routeId = String(row.RouteID != null ? row.RouteID : '');
    const direction = directBulkDirection(row.GoBack, goBackTable);
    const key = `${routeId}|${direction == null ? '' : direction}|${stopId}`;
    const live = normalizeDirectBulkRow(row, { nowMs, snapshotMs, negativeCodes, staleAfterSec });
    const arrival = {
      key,
      routeId,
      routeName: routeNames.get(routeId) || routeNames.get(Number(routeId)) || routeId,
      direction,
      goBackRaw: row.GoBack == null ? null : String(row.GoBack),
      stopId,
      live,
    };
    const prev = byKey.get(key);
    if (!prev || (arrival.live.etaSec ?? Infinity) < (prev.live.etaSec ?? Infinity)) byKey.set(key, arrival);
  }
  return sortArrivals([...byKey.values()]).slice(0, limit);
}

// ── tdx-per-stop 正規化 ───────────────────────────────────────────────────
export function resolveTdxStop({ stopUids, rows, nowMs = Date.now(), staleAfterSec = N1_STALE_AFTER_SEC, limit = 60 }) {
  const wanted = new Set((stopUids || []).map(uid => String(uid)));
  const byKey = new Map();
  for (const row of rows || []) {
    const stopUid = String((row && (row.StopUID || row.StopID)) || '');
    if (!wanted.has(stopUid)) continue;
    const routeUid = String(row.RouteUID || row.RouteID || '');
    const subRouteUid = String(row.SubRouteUID || row.SubRouteID || '');
    const dirRaw = finite(row.Direction);
    const direction = dirRaw === 0 || dirRaw === 1 ? dirRaw : null;
    const key = `${routeUid}|${subRouteUid}|${direction == null ? '' : direction}|${stopUid}`;
    const arrival = {
      key,
      routeId: routeUid,
      routeName: zhName(row.RouteName) || routeUid,
      subRouteName: zhName(row.SubRouteName) || '',
      direction,
      goBackRaw: null,
      stopId: stopUid,
      plate: String(row.PlateNumb || '') || null,
      live: normalizeN1State(row, nowMs, staleAfterSec),
    };
    const prev = byKey.get(key);
    if (!prev || (arrival.live.ageSec ?? Infinity) < (prev.live.ageSec ?? Infinity)) byKey.set(key, arrival);
  }
  return sortArrivals([...byKey.values()]).slice(0, limit);
}

const STATE_RANK = { arriving: 0, countdown: 1, scheduled: 2, not_departed: 3, no_estimate: 4, unknown: 5, skipped: 6, last_bus_passed: 7, not_operating: 8, stale: 9 };
export const busStateRank = state => (STATE_RANK[state] ?? 10);

function sortArrivals(list) {
  return list.sort((a, b) => busStateRank(a.live.state) - busStateRank(b.live.state)
    || (a.live.etaSec ?? Infinity) - (b.live.etaSec ?? Infinity)
    || String(a.routeName).localeCompare(String(b.routeName), 'zh-Hant', { numeric: true })
    || String(a.key).localeCompare(String(b.key)));
}

// 同一條路線方向只留「下一班」與「再下一班」：卡面與搜尋結果要的是這兩個，不是全部。
export function nextTwoByRoute(arrivals) {
  const byRoute = new Map();
  for (const a of arrivals || []) {
    const routeKey = `${a.routeId}|${a.direction == null ? '' : a.direction}`;
    if (!byRoute.has(routeKey)) byRoute.set(routeKey, { routeId: a.routeId, routeName: a.routeName, direction: a.direction, arrivals: [] });
    byRoute.get(routeKey).arrivals.push(a);
  }
  return [...byRoute.values()].map(entry => ({ ...entry, arrivals: entry.arrivals.slice(0, 2) }))
    .sort((a, b) => busStateRank(a.arrivals[0].live.state) - busStateRank(b.arrivals[0].live.state)
      || (a.arrivals[0].live.etaSec ?? Infinity) - (b.arrivals[0].live.etaSec ?? Infinity)
      || String(a.routeName).localeCompare(String(b.routeName), 'zh-Hant', { numeric: true }));
}

// ── 站牌索引與搜尋 ────────────────────────────────────────────────────────
// 索引是 TSV：一行一個站位。欄位固定七欄，順序不可改（Worker 與驗收腳本共用本常數）。
export const BUS_STOP_INDEX_COLUMNS = Object.freeze(['stationUid', 'name', 'city', 'lat', 'lon', 'routes', 'providerStopIds']);

export function parseBusStopIndexLine(line) {
  const cols = String(line).split('\t');
  if (cols.length !== BUS_STOP_INDEX_COLUMNS.length) return null;
  const [stationUid, name, city, lat, lon, routes, providerStopIds] = cols;
  if (!stationUid || !name) return null;
  return {
    stationUid, name, city,
    lat: finite(lat), lon: finite(lon),
    routes: routes ? routes.split('|') : [],
    providerStopIds: providerStopIds ? providerStopIds.split('|') : [],
  };
}

// 與 index.html 既有 stnSearchMatch 同一把尺：臺→台、去空白、英數小寫。不做別的正規化。
export const busSearchNorm = value => String(value || '').replace(/臺/g, '台').replace(/\s+/g, '').toLowerCase();

// 站牌名比對 + 路線號比對，一次掃完。分數：站名精準 0 < 站名前綴 1 < 路線號精準 2 <
// 站名包含 3 < 路線號前綴 4。同分先短名。
// 🔴 掃的是「行」不是物件陣列：全台約 6 萬個站位，字串 indexOf 比先 JSON.parse 快一個量級，
// 而 Worker 的冷啟成本正是被 parse 吃掉的。
export function busSearchMatch(lines, query, { limit = 12 } = {}) {
  const nq = busSearchNorm(query);
  if (!nq) return [];
  const out = [];
  for (const line of lines) {
    const parsed = parseBusStopIndexLine(line);
    if (!parsed) continue;
    const name = busSearchNorm(parsed.name);
    let score = 9;
    if (name === nq) score = 0;
    else if (name.startsWith(nq)) score = 1;
    else if (name.indexOf(nq) >= 0) score = 3;
    if (score > 2) {
      for (const route of parsed.routes) {
        const r = busSearchNorm(route);
        if (r === nq) { score = Math.min(score, 2); break; }
        if (r.startsWith(nq)) score = Math.min(score, 4);
      }
    }
    if (score === 9) continue;
    out.push({ score, stop: parsed });
  }
  out.sort((a, b) => a.score - b.score || a.stop.name.length - b.stop.name.length
    || a.stop.name.localeCompare(b.stop.name, 'zh-Hant') || a.stop.stationUid.localeCompare(b.stop.stationUid));
  return { total: out.length, rows: out.slice(0, limit).map(o => o.stop) };
}
