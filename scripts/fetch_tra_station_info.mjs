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
