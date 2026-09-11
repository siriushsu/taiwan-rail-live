#!/usr/bin/env node
// 全台公車站牌靜態索引。TDX Bus/Station（站位）＋各 direct-bulk 縣市的自有站牌表 → 一份 TSV。
//
// 這支只由開發者手動執行，不掛 cron 或 Worker scheduled；正式服務不會背景重抓。
// 產物：
//   data/bus_stops_index.tsv   一行一個站位（欄位順序由 BUS_STOP_INDEX_COLUMNS 決定）
//   data/bus_stops_index.json  manifest：筆數、各縣市統計、對照表覆蓋率、產生時間
//
// 🔴 對照表覆蓋率是具名閘門，不是印在 detail 裡的數字：低於門檻直接非零離開。
//    分母分子都會印出來，而且用「站名」與「座標」兩個獨立維度複驗，
//    因為「數字 id 相等」與被驗的實作同源，本身是零資訊。
//
// 用法：
//   node scripts/build_bus_stop_index.mjs                 # 全抓（會打 21 次 TDX）
//   node scripts/build_bus_stop_index.mjs --cache <dir>   # 先用快取，缺的才打網路
//   node scripts/build_bus_stop_index.mjs --cities Taipei,YilanCounty   # 只跑指定縣市（產物會標 partial）

import { createGunzip } from 'node:zlib';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { BUS_STOP_INDEX_COLUMNS, BUS_STOP_INDEX_SCHEMA, parseProviderConfig } from './bus_live_core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'data', 'bus_providers.json');
const TSV_PATH = path.join(ROOT, 'data', 'bus_stops_index.tsv');
const MANIFEST_PATH = path.join(ROOT, 'data', 'bus_stops_index.json');
const AUTH_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const STATION_BASE = 'https://tdx.transportdata.tw/api/basic/v2/Bus/Station/City';

// 對照表覆蓋率的硬門檻。2026-09-11 實測臺北市三個維度都是 100.00%／99.99%，
// 留 2% 餘裕吸收官方改版；掉到門檻以下代表對照假設壞了，必須停下來查，不可靜默出貨。
const CROSSWALK_MIN_RATIO = 0.98;
const GEO_MATCH_METERS = 150;

const args = process.argv.slice(2);
const argValue = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const CACHE_DIR = argValue('--cache');
const ONLY_CITIES = (argValue('--cities') || '').split(',').map(s => s.trim()).filter(Boolean);

const norm = s => String(s || '').replace(/臺/g, '台').replace(/\s+/g, '').trim();
const finite = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

function haversineM(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

function cachePath(name) { return CACHE_DIR ? path.join(CACHE_DIR, name) : null; }

async function readCached(name, loader) {
  const p = cachePath(name);
  if (p && existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  const data = await loader();
  if (p) { mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(p, JSON.stringify(data)); }
  await sleep(1200); // 真的打了網路才節流；命中快取不必等
  return data;
}

let tokenPromise = null;
function tdxToken() {
  if (tokenPromise) return tokenPromise;
  const id = process.env.TDX_CLIENT_ID, secret = process.env.TDX_CLIENT_SECRET;
  if (!id || !secret) throw new Error('缺 TDX_CLIENT_ID／TDX_CLIENT_SECRET（先 source .env）');
  // 🔴 TDX auth 端點有節流：整支腳本只取一次 token 重用，不要每個縣市各取一次。
  tokenPromise = fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}`,
  }).then(async r => {
    if (!r.ok) throw new Error(`TDX auth ${r.status}`);
    return (await r.json()).access_token;
  });
  return tokenPromise;
}



// 🔴 TDX 金鑰有每秒上限，連打 21 個縣市會在第 15 支左右吃到 429。
// 429 不是「資料沒有」而是「我打太快」——退避重試，不可當成空資料寫進索引。
async function fetchStations(city, attempt = 0) {
  const token = await tdxToken();
  const url = `${STATION_BASE}/${city}?%24format=JSON`;
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
  if (r.status === 429 && attempt < 5) {
    const wait = 2000 * (attempt + 1);
    process.stderr.write(`[${city}] 429，等 ${wait}ms 重試（第 ${attempt + 1} 次）\n`);
    await sleep(wait);
    return fetchStations(city, attempt + 1);
  }
  if (!r.ok) throw new Error(`TDX Station ${city} ${r.status}`);
  return await r.json();
}

async function fetchGzipJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const chunks = [];
  await pipeline(Readable.from(buf), createGunzip(), async function* (src) { for await (const c of src) chunks.push(c); });
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function main() {
  const config = parseProviderConfig(JSON.parse(readFileSync(CONFIG_PATH, 'utf8')));
  const cities = Object.keys(config.cities).filter(c => !ONLY_CITIES.length || ONLY_CITIES.includes(c));
  if (!cities.length) throw new Error('--cities 濾完沒有任何縣市');

  const lines = [];
  const perCity = {};
  const crosswalk = {};
  const prefixCheck = [];

  for (const city of cities) {
    const entry = config.cities[city];
    const stations = await readCached(`station_${city}.json`, () => fetchStations(city));
    if (!Array.isArray(stations)) throw new Error(`TDX Station ${city} 回傳不是陣列`);

    // stopIdPrefix 是設定檔上宣告的值 —— 用實際資料驗，不採信宣告。
    const prefixes = new Set();
    for (const st of stations) for (const s of st.Stops || []) {
      const uid = String(s.StopUID || ''), id = String(s.StopID || '');
      if (uid && id && uid.endsWith(id)) prefixes.add(uid.slice(0, uid.length - id.length));
    }
    const observed = [...prefixes];
    prefixCheck.push({ city, declared: entry.stopIdPrefix || null, observed, ok: observed.length === 1 && observed[0] === entry.stopIdPrefix });

    let directStops = null, directRoutes = null;
    if (entry.provider === 'direct-bulk') {
      directStops = await readCached(`direct_stop_${city}.json`, () => fetchGzipJson(entry.directBulk.endpoints.stop));
      directRoutes = await readCached(`direct_route_${city}.json`, () => fetchGzipJson(entry.directBulk.endpoints.route));
      crosswalk[city] = buildCrosswalkReport(city, stations, directStops);
    }

    let rows = 0;
    for (const st of stations) {
      const stationUid = String(st.StationUID || '');
      const name = String((st.StationName && (st.StationName.Zh_tw || st.StationName.En)) || '');
      if (!stationUid || !name) continue;
      const pos = st.StationPosition || {};
      const lat = finite(pos.PositionLat), lon = finite(pos.PositionLon);
      const routes = [...new Set((st.Stops || []).map(s => String((s.RouteName && (s.RouteName.Zh_tw || s.RouteName.En)) || '')).filter(Boolean))];
      // providerStopIds：direct-bulk 縣市存來源自己的數字站牌 id（Worker 要拿它去查快照）；
      // tdx-per-stop 縣市存 StopUID。兩者都是「這個站位在該 provider 的查詢鍵」。
      const providerStopIds = entry.provider === 'direct-bulk'
        ? [...new Set((st.Stops || []).map(s => String(s.StopID || '')).filter(Boolean))]
        : [...new Set((st.Stops || []).map(s => String(s.StopUID || '')).filter(Boolean))];
      if (!providerStopIds.length) continue;
      const cols = [stationUid, name, city, lat == null ? '' : lat.toFixed(6), lon == null ? '' : lon.toFixed(6), routes.join('|'), providerStopIds.join('|')];
      if (cols.some(c => String(c).includes('\t') || String(c).includes('\n'))) throw new Error(`${city} ${stationUid} 欄位含 tab／換行`);
      lines.push(cols.join('\t'));
      rows += 1;
    }
    perCity[city] = { provider: entry.provider, stations: stations.length, indexed: rows, directStops: directStops ? directStops.BusInfo.length : null, directRoutes: directRoutes ? directRoutes.BusInfo.length : null };
    process.stderr.write(`[${city}] ${entry.provider} 站位 ${stations.length} → 索引 ${rows}\n`);
  }

  lines.sort();
  writeFileSync(TSV_PATH, lines.join('\n') + '\n');

  const manifest = {
    schemaVersion: BUS_STOP_INDEX_SCHEMA,
    generatedAt: new Date().toISOString(),
    partial: ONLY_CITIES.length > 0,
    columns: BUS_STOP_INDEX_COLUMNS,
    asset: '/data/bus_stops_index.tsv',
    stationCount: lines.length,
    cities: perCity,
    crosswalk,
    stopIdPrefixCheck: prefixCheck,
    crosswalkMinRatio: CROSSWALK_MIN_RATIO,
    geoMatchMeters: GEO_MATCH_METERS,
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');

  // ── 具名閘門 ────────────────────────────────────────────────────────────
  const failures = [];
  for (const row of prefixCheck) {
    if (!row.ok) failures.push(`stopIdPrefix 不符：${row.city} 設定檔寫 ${row.declared}，實際觀察到 ${JSON.stringify(row.observed)}`);
  }
  for (const [city, r] of Object.entries(crosswalk)) {
    for (const dim of ['idMatch', 'nameMatch', 'geoMatch']) {
      const { hit, total } = r[dim];
      const ratio = total ? hit / total : 0;
      process.stderr.write(`[對照表 ${city}] ${dim} ${hit}/${total} = ${(ratio * 100).toFixed(2)}%\n`);
      if (total === 0) failures.push(`對照表 ${city} 的 ${dim} 分母是 0（分母無聲縮水）`);
      else if (ratio < CROSSWALK_MIN_RATIO) failures.push(`對照表 ${city} 的 ${dim} ${hit}/${total} = ${(ratio * 100).toFixed(2)}% 低於門檻 ${(CROSSWALK_MIN_RATIO * 100).toFixed(0)}%`);
    }
    if (r.unmatchedDirect.length) process.stderr.write(`[對照表 ${city}] 來源有而 TDX 無：${r.unmatchedDirect.length} 筆 ${JSON.stringify(r.unmatchedDirect.slice(0, 5))}\n`);
  }
  if (!lines.length) failures.push('索引一行都沒有');

  process.stderr.write(`\n總計 ${lines.length} 個站位 → ${TSV_PATH}\n`);
  if (failures.length) { for (const f of failures) process.stderr.write(`FAIL ${f}\n`); process.exit(1); }
  process.stderr.write('GREEN 全部閘門通過\n');
}

// 三個維度各自獨立：id 相等（與實作同源，零資訊）／站名相同／座標接近。
// 後兩者才是「不是 id 空間巧合碰撞」的證據。
function buildCrosswalkReport(city, stations, directStops) {
  const byId = new Map((directStops.BusInfo || []).map(s => [String(s.Id), s]));
  const tdxIds = new Set();
  let idHit = 0, idTotal = 0, nameHit = 0, nameTotal = 0, geoHit = 0, geoTotal = 0;
  const unmatchedTdx = [];
  for (const st of stations) {
    const stPos = st.StationPosition ? { lat: finite(st.StationPosition.PositionLat), lon: finite(st.StationPosition.PositionLon) } : null;
    for (const s of st.Stops || []) {
      const id = String(s.StopID || '');
      if (!id) continue;
      tdxIds.add(id);
      idTotal += 1;
      const d = byId.get(id);
      if (!d) { if (unmatchedTdx.length < 5) unmatchedTdx.push({ StopUID: s.StopUID, name: s.StopName && s.StopName.Zh_tw }); continue; }
      idHit += 1;
      nameTotal += 1;
      if (norm(d.nameZh) === norm(s.StopName && s.StopName.Zh_tw)) nameHit += 1;
      const dPos = { lat: finite(d.latitude), lon: finite(d.longitude) };
      if (dPos.lat != null && dPos.lon != null && stPos && stPos.lat != null) {
        geoTotal += 1;
        if (haversineM(stPos, dPos) <= GEO_MATCH_METERS) geoHit += 1;
      }
    }
  }
  const unmatchedDirect = (directStops.BusInfo || []).filter(s => !tdxIds.has(String(s.Id)))
    .map(s => ({ Id: s.Id, routeId: s.routeId, nameZh: s.nameZh }));
  return {
    idMatch: { hit: idHit, total: idTotal },
    nameMatch: { hit: nameHit, total: nameTotal },
    geoMatch: { hit: geoHit, total: geoTotal },
    unmatchedTdx,
    unmatchedDirect,
  };
}

main().catch(e => { process.stderr.write(`FAIL ${e && e.stack || e}\n`); process.exit(1); });
