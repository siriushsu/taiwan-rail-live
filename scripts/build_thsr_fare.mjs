#!/usr/bin/env node
// 高鐵票價 → 建置期靜態表(單元 A,2026-09-11 設計)。
// 資料源:TDX Rail/THSR/ODFare/{起站}/to/{迄站}(v2)。票價幾乎不變動,不必逐次打 TDX,
// 這支腳本只由開發者手動執行,不掛 package script 常態排程、不掛 cron、不掛 Worker scheduled。
//
// 🔴 只打「小站碼→大站碼」單一方向:2026-09-11 實測反向(左營1070→台北1000)與正向
// (台北1000→左營1070)逐價相符(僅 Direction 欄位與 Origin/Dest 互換),故 66 個無序站對只呼叫
// 一次,票價表由前端查詢時自行把兩個站碼由小到大排序後查表——省下一半 TDX 呼叫,不是假設,
// 是實測過的官方行為(見 docs/specs/實作筆記-A.md「票價探針結果」)。
//
// 用法:node scripts/build_thsr_fare.mjs [--env-file <path>]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUTH_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const API_BASE = 'https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/ODFare';
const OUTPUT_PATH = path.join(ROOT, 'data/thsr_fare.json');

// 12 站官方站碼(2026-09-11 對 TDX 逐一實測確認,南北序)。高鐵目前固定 12 站,新站極罕見,
// 若日後新增站,這裡要跟著補。
const STATIONS = {
  '0990': '南港', '1000': '台北', '1010': '板橋', '1020': '桃園', '1030': '新竹',
  '1035': '苗栗', '1040': '台中', '1043': '彰化', '1047': '雲林', '1050': '嘉義',
  '1060': '台南', '1070': '左營',
};

// 官方代碼定義,逐字取自 TDX swagger 的 description(2026-09-11 抄錄),不自行命名。
const CODES = {
  ticketType: {
    1: '一般票(單程票)', 2: '來回票', 3: '電子票證(悠遊卡、一卡通)', 4: '回數票',
    5: '定期票(30天期)', 6: '定期票(60天期)', 7: '早鳥票', 8: '團體票',
  },
  fareClass: {
    1: '成人', 2: '學生', 3: '孩童', 4: '敬老', 5: '愛心', 6: '愛心孩童', 7: '愛心優待、愛心陪伴', 8: '軍警', 9: '法優',
  },
  cabinClass: { 1: '標準座車廂', 2: '商務座車廂', 3: '自由座車廂' },
};

function readEnv() {
  const out = { ...process.env };
  const envArg = process.argv.indexOf('--env-file');
  const envPath = envArg >= 0 && process.argv[envArg + 1]
    ? path.resolve(process.argv[envArg + 1])
    : (process.env.TDX_ENV_FILE ? path.resolve(process.env.TDX_ENV_FILE) : path.join(ROOT, '.env'));
  try {
    for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const i = line.indexOf('=');
      const key = line.slice(0, i).trim();
      const value = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
      if (out[key] == null) out[key] = value;
    }
  } catch (error) {
    throw new Error(`讀不到 TDX env:${envPath}`);
  }
  if (!out.TDX_CLIENT_ID || !out.TDX_CLIENT_SECRET) throw new Error('缺 TDX_CLIENT_ID／TDX_CLIENT_SECRET');
  return out;
}

async function tokenOf(env) {
  const response = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.TDX_CLIENT_ID,
      client_secret: env.TDX_CLIENT_SECRET,
    }),
    redirect: 'manual',
  });
  if (!response.ok) throw new Error(`TDX OAuth HTTP ${response.status}`);
  const data = await response.json();
  if (!data.access_token) throw new Error('TDX OAuth 回應缺 access_token');
  return data.access_token;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 單一 OD 查詢,429 退避 20 秒重試(同 fetch_thsr.py/fetch_tdx.py 既有慣例)。
// 同站到同站(理論上不會被下面的迴圈叫到,防禦寫著)與查無資料一律回 []。
async function fetchOdFare(token, originId, destId) {
  const url = `${API_BASE}/${originId}/to/${destId}?%24format=JSON`;
  for (;;) {
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, redirect: 'manual' });
    if (r.status === 429) { console.log('    rate-limited, waiting…'); await sleep(20000); continue; }
    if (!r.ok) throw new Error(`ODFare ${originId}->${destId} HTTP ${r.status}`);
    const body = await r.json();
    const list = Array.isArray(body) ? body : [];
    return list[0] && Array.isArray(list[0].Fares) ? list[0].Fares : [];
  }
}

async function main() {
  const env = readEnv();
  const token = await tokenOf(env);
  const ids = Object.keys(STATIONS).sort(); // 站碼字串等長(4 碼),字典序等於數值序
  const fares = {};
  let pairCount = 0, priceCount = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const o = ids[i], d = ids[j];
      const key = `${o}|${d}`;
      const rawFares = await fetchOdFare(token, o, d);
      fares[key] = rawFares.map(f => ({
        ticketType: f.TicketType, fareClass: f.FareClass, cabinClass: f.CabinClass, price: f.Price,
      }));
      pairCount++; priceCount += fares[key].length;
      console.log(`  [${pairCount}/66] ${STATIONS[o]}(${o}) ↔ ${STATIONS[d]}(${d}):${fares[key].length} 組`);
      await sleep(1200); // 同 fetch_thsr.py 的節流慣例
    }
  }
  const out = {
    source_notes: '交通部 TDX Rail/THSR/ODFare(v2),2026-09-11 建置期擷取;票價幾乎不變動,靜態表,' +
      '不逐次打 TDX。鍵為「小站碼|大站碼」(字典序),雙向共用同一份資料——2026-09-11 實測反向與正向' +
      '逐價相符,僅 Direction 欄位互換。查表前請把兩個站碼由小到大排序。',
    generated_at: new Date().toISOString(),
    codes: CODES,
    stations: STATIONS,
    fares,
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(out));
  console.log(`\n寫出 ${OUTPUT_PATH}:${pairCount} 個站對、共 ${priceCount} 筆價目`);
}

main().catch(e => { console.error('FAILED:', e.stack || e); process.exit(1); });
