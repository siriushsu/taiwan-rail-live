#!/usr/bin/env node
// Android 台鐵／高鐵小工具目錄：從 App 本來就會打包的 dense 班表抽掉軌道幾何等
// 小工具不使用的欄位，保留逐日車次集合、停靠／通過與站座標。台鐵直接使用這份逐日資料；
// 高鐵 runtime 另讀 /api/thsr-schedule 今日文件，這裡的舊單日班次只供設定頁站名／方向選項。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../..');
const outArg = process.argv.indexOf('--out');
const OUT = outArg >= 0 && process.argv[outArg + 1]
  ? resolve(process.argv[outArg + 1])
  : join(ROOT, 'app/android/app/src/main/assets/RailWidgetData.json');

const SOURCES = [
  { id: 'tra', label: '台鐵', live: true, file: 'data/tra_schedule_dense.json' },
  { id: 'thsr', label: '高鐵', live: false, file: 'data/thsr_schedule_dense.json' },
];

// 設定頁的起站清單依縣市分段（與 iOS AppIntent 的 stationRegionSections 同一套語意與順序）。
// 台鐵讀 tra_station_info.json 的 address 前綴；高鐵 12 站不在那份資料裡，且與同名台鐵站
// 不一定同縣市（高鐵新竹在新竹縣竹北、台鐵新竹在新竹市），所以寫死、不可用站名回退查台鐵表。
const THSR_REGIONS = {
  南港: '臺北市', 台北: '臺北市', 板橋: '新北市', 桃園: '桃園市',
  新竹: '新竹縣', 苗栗: '苗栗縣', 台中: '臺中市', 彰化: '彰化縣',
  雲林: '雲林縣', 嘉義: '嘉義縣', 台南: '臺南市', 左營: '高雄市',
};
const normalizeName = name => name
  .replaceAll('臺', '台')
  .replaceAll(' ', '')
  .replaceAll('\u3000', '')
  .replace(/[（(].*$/, '');
const regionFromAddress = address => {
  const region = String(address || '').replace(/^\d+/, '').slice(0, 3);
  return /[縣市]$/.test(region) ? region : null;
};
const traRegionByName = new Map(
  Object.entries(JSON.parse(readFileSync(join(ROOT, 'data/tra_station_info.json'), 'utf8')))
    .map(([name, info]) => [normalizeName(name), regionFromAddress(info && info.address)])
    .filter(([, region]) => region),
);
// 查不到縣市不擋 build:設定頁會把這種站收進「其他」分段放在最後,不會消失。
const regionOf = (sys, name) => (sys === 'thsr'
  ? THSR_REGIONS[normalizeName(name)]
  : traRegionByName.get(normalizeName(name))) || '';

const systems = SOURCES.map(source => {
  const raw = JSON.parse(readFileSync(join(ROOT, source.file), 'utf8'));
  const stationByName = new Map();
  const trains = (raw.trains || []).map(train => ({
    no: String(train.train || ''),
    type: String(train.typeName || train.carName || (source.id === 'thsr' ? '高鐵' : '其他')),
    color: String(train.color || (source.id === 'thsr' ? '#E85D0D' : '#8E44AD')),
    stops: (train.stops || []).map(stop => {
      const name = String(stop.name || '');
      if (name && !stationByName.has(name)) {
        stationByName.set(name, {
          name,
          lat: Number(stop.lat),
          lon: Number(stop.lon),
          region: regionOf(source.id, name),
        });
      }
      return {
        name,
        arr: Number(stop.arrSec),
        dep: Number(stop.depSec ?? stop.arrSec),
        stop: stop.stop !== false,
      };
    }),
  }));
  return {
    id: source.id,
    label: source.label,
    live: source.live,
    source: source.file,
    date: raw.date == null ? null : String(raw.date),
    dateRange: raw.dateRange || null,
    dates: raw.dates || null,
    types: raw.types || [],
    stations: [...stationByName.values()].filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon)),
    trains,
  };
});

// 共站採與 iOS 相同的「兩個系統實體車站相距很近」語意；Android 設定頁可一次選到
// 台鐵＋高鐵，不必由人維護台北／板橋／新烏日等名字不完全相同的對照表。
const tra = systems.find(s => s.id === 'tra');
const thsr = systems.find(s => s.id === 'thsr');
const meters = (a, b) => {
  const rad = Math.PI / 180;
  const p1 = a.lat * rad, p2 = b.lat * rad;
  const dp = (b.lat - a.lat) * rad, dl = (b.lon - a.lon) * rad;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
const composites = [];
if (tra && thsr) {
  for (const b of thsr.stations) {
    let best = null;
    for (const a of tra.stations) {
      const distance = meters(a, b);
      if (distance <= 800 && (!best || distance < best.distance)) best = { a, distance };
    }
    if (!best) continue;
    composites.push({
      key: `${best.a.name}|${b.name}`,
      label: best.a.name === b.name ? best.a.name : `${best.a.name}／高鐵${b.name}`,
      tra: best.a.name,
      thsr: b.name,
      lat: (best.a.lat + b.lat) / 2,
      lon: (best.a.lon + b.lon) / 2,
      meters: Math.round(best.distance),
    });
  }
}

const out = {
  version: 1,
  builtAt: new Date().toISOString(),
  systems,
  composites,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
const size = Buffer.byteLength(JSON.stringify(out));
console.log(`寫出 ${OUT}（${systems.map(s => `${s.label} ${s.trains.length} 班／${s.stations.length} 站`).join('，')}；共站 ${composites.length}；${(size / 1024 / 1024).toFixed(2)} MB）`);
