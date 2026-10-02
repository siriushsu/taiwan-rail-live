// 從 TDX v3 Rail/TRA/Station 抓台鐵各站地址，產 data/tra_station_info.json。
// 金鑰讀 .env（TDX_CLIENT_ID / TDX_CLIENT_SECRET）。以站名（Zh_tw）為 key，
// 同時登記臺/台正規化別名，好對上 tra.json 來自 OSM 的站名。
// 特色（feature）欄先留空字串，之後要補人工/AI 內容就填這裡。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const AUTH = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const API = 'https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/Station?%24format=JSON';

async function token() {
  const r = await fetch(AUTH, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.TDX_CLIENT_ID,
      client_secret: env.TDX_CLIENT_SECRET,
    }),
  });
  if (!r.ok) throw new Error('auth ' + r.status);
  return (await r.json()).access_token;
}

const norm = s => s.replace(/臺/g, '台'); // key 一律用「台」正規化

const r = await fetch(API, { headers: { authorization: 'Bearer ' + await token() } });
if (!r.ok) throw new Error('api ' + r.status);
const d = await r.json();
const list = Array.isArray(d) ? d : d.Stations || [];

const out = {};
for (const s of list) {
  const name = s.StationName?.Zh_tw;
  if (!name) continue;
  out[norm(name)] = {
    name,
    id: s.StationID,
    address: s.StationAddress || '',
    lat: s.StationPosition?.PositionLat,
    lon: s.StationPosition?.PositionLon,
    feature: '', // 特色，之後補
  };
}

// ── 先行站：已經營運、但 TDX 與台鐵 ODS 車站清單都還沒上架的站 ─────────────────
// 平鎮臨時站 2026-10-03 啟用，ODS 逐日時刻表 10/3 起就有站碼 1105 停靠（123～126 班），
// 但 10-02 實查 TDX（245 站，UpdateTime 09-15）與 ODS 車站清單（245 站）都沒有它。
// 等清單上架才收，啟用當天地圖上沒有這站、也蓋不到章，所以先用這筆補上（provisional:true）。
// TDX 一上架這站，上面的官方紀錄就會蓋掉這筆（只在 TDX 沒有時才補），之後這筆可以刪掉。
// 座標不是官方值：站碼與站名取自 ODS 逐日時刻表；位置取「官方里程 K68+880～K69+109 換算到軌道上的
// 月台範圍」與「媒體轉述的新富一街×新富三街路口（月台南端外約 90 m）」兩者合起來的中點，
// 投影在縱貫線北段的軌道上（data/tra.json 沿線里程 d≈68.96）。到月台兩端 157／73 m、到路口 162 m；站等表沒有平鎮，前端依停靠班次推站等，
// 蓋章判定半徑實測 260 m，三處都蓋得到，離中壢 1,494 m 也不會互吃。
// 地址：台鐵新聞稿（中央社 2026-09-29 轉述）只寫「位於桃園市平鎮區」，就填到這裡為止，郵遞區號與門牌不編造。
// 公車轉乘索引與小工具的縣市分組都從地址取縣市，空字串會讓那幾支產生器直接丟錯。
const PROVISIONAL = {
  '平鎮': { name: '平鎮', id: '1105', address: '桃園市平鎮區', lat: 24.9440379, lon: 121.2154434, feature: '', provisional: true },
};
for (const [k, v] of Object.entries(PROVISIONAL)) {
  if (out[k] || Object.values(out).some(o => o.id === v.id)) {
    console.log(`先行站「${k}」(${v.id}) 已在 TDX 上架，改用官方紀錄；PROVISIONAL 這一筆可以刪了`);
    continue;
  }
  out[k] = v;
  console.log(`先行站「${k}」(${v.id}) TDX 尚未上架，補先行紀錄（座標非官方值）`);
}

const dst = path.join(ROOT, 'data', 'tra_station_info.json');
fs.writeFileSync(dst, JSON.stringify(out, null, 0));
console.log('wrote', dst, '—', Object.keys(out).length, 'stations, with address:',
  Object.values(out).filter(v => v.address).length);

// 對照 tra.json 的站名覆蓋率
const tra = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tra.json'), 'utf8'));
const names = new Set();
for (const ln of tra.lines) for (const st of ln.stations) names.add(norm(st.name));
const miss = [...names].filter(n => !out[n]);
console.log('tra.json unique:', names.size, '| unmatched:', miss.length, miss.slice(0, 40).join(' '));
