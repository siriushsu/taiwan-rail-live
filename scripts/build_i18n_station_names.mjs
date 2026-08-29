import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const out = { generated: new Date().toISOString().slice(0, 10), systems: {}, routes: {}, trainTypes: {} };

const sources = {
  tra_sched: null,
  thsr_sched: 'THSR',
  afr_sched: 'AFR',
  mrt: ['TRTC', 'NTMC'],
  tymc: 'TYMC',
  ntdlrt: 'NTDLRT',
  ntalrt: 'NTALRT',
  sanying: 'SANYING',
  krtc: ['KRTC', 'KLRT'],
  tmrt: 'TMRT',
};

function addStation(sys, zh, en, ja) {
  if (!zh) return;
  const bucket = out.systems[sys] || (out.systems[sys] = {});
  bucket[zh] = { en: en || zh, ja: ja || zh };
}
function stationRows(op) {
  const raw = read(`data/tdx/${op}_Station.json`);
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.Stations)) return raw.Stations;
  return [];
}

for (const [sys, rawOps] of Object.entries(sources)) {
  for (const op of rawOps == null ? [] : (Array.isArray(rawOps) ? rawOps : [rawOps])) {
    for (const st of stationRows(op)) {
      const n = st.StationName || {};
      addStation(sys, n.Zh_tw, n.En, n.Ja);
    }
  }
}

// 台鐵官方官網補 TDX 沒有的日文；高捷、林鐵、三鶯補官方／已裁示的 fallback。
const tra = read('docs/i18n/tra_station_names.json').stations;
for (const n of Object.values(tra)) addStation('tra_sched', n.zh, n.en, n.ja);
const supplements = read('docs/i18n/ja_station_names.json').operators;
const supplementalSystems = { TRA: 'tra_sched', KRTC: 'krtc', KLRT: 'krtc', AFR: 'afr_sched', SANYING: 'sanying' };
for (const [op, sys] of Object.entries(supplementalSystems)) {
  for (const n of Object.values(supplements[op].stations)) addStation(sys, n.zh, n.en, n.ja);
}

function lineRows(op) {
  const raw = read(`data/tdx/${op}_Line.json`);
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.Lines)) return raw.Lines;
  return [];
}
function addRoute(sys, zh, en, ja) {
  if (!zh) return;
  const bucket = out.routes[sys] || (out.routes[sys] = {});
  bucket[zh] = { en: en || zh, ja: ja || zh };
}
const lineSources = { thsr_sched: [], afr_sched: ['AFR'], mrt: ['TRTC', 'NTMC'], tymc: ['TYMC'], ntdlrt: ['NTDLRT'], ntalrt: ['NTALRT'], krtc: ['KRTC', 'KLRT'], tmrt: ['TMRT'] };
for (const [sys, ops] of Object.entries(lineSources)) {
  for (const op of ops) for (const line of lineRows(op)) {
    const n = line.LineName || {};
    addRoute(sys, n.Zh_tw, n.En, n.Ja);
  }
}

// TDX 目前缺這些公開線名的 En／Ja；採營運者既有對外名稱，未有官方日文者退回中文。
Object.assign(out.routes.krtc ||= {}, {
  '紅線': { en: 'Red Line', ja: '赤線' },
  '橘線': { en: 'Orange Line', ja: 'オレンジ線' },
  '環狀輕軌': { en: 'Circular Light Rail', ja: 'ライトレール' },
});
addRoute('sanying', '三鶯線', 'Sanying Line', '三鶯線');
addRoute('thsr_sched', '高鐵', 'Taiwan High Speed Rail', '台湾高速鉄道');

Object.assign(out.trainTypes, {
  '其他': { en: 'Other', ja: 'その他' },
  '區間快': { en: 'Fast Local', ja: '区間快速' },
  '區間車': { en: 'Local Train', ja: '区間車' },
  '自強': { en: 'Tze-Chiang Limited Express', ja: '自強号' },
  '莒光/復興': { en: 'Chu-Kuang / Fu-Hsing', ja: '莒光号／復興号' },
  '高鐵': { en: 'High Speed Rail', ja: '高速鉄道' },
  '阿里山號': { en: 'Alishan Express', ja: '阿里山号' },
  '神木線': { en: 'Shenmu Line', ja: '神木線' },
  '沼平線': { en: 'Zhaoping Line', ja: '沼平線' },
  '祝山線': { en: 'Zhushan Line', ja: '祝山線' },
});

for (const key of ['systems', 'routes']) {
  for (const value of Object.values(out[key])) {
    const sorted = Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'zh-Hant')));
    for (const k of Object.keys(value)) delete value[k];
    Object.assign(value, sorted);
  }
}

const targetDir = path.join(root, 'i18n');
fs.mkdirSync(targetDir, { recursive: true });
fs.writeFileSync(path.join(targetDir, 'stations.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`i18n/stations.json：${Object.values(out.systems).reduce((n, x) => n + Object.keys(x).length, 0)} 筆系統站名`);
