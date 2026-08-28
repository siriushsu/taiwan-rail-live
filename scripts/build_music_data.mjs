#!/usr/bin/env node
// 產出 data/music.json。免費池從磁碟掃、時長與大小用 ffprobe/stat 量；
// 池的 metadata 是本檔常數（那是設計，不是掃得出來的東西）。
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MUSIC_DIR = path.join(ROOT, 'suno musics');

// 免費曲庫【凍結】在這六個資料夾。新歌一律進付費池，不再加進這裡。
const FREE_FOLDERS = ['Afloat', 'Midnight stories', 'Moonlake', 'Rainy day', 'Star & Neon', 'peaceful piano'];
// App bundle 只放這 12 首（每資料夾 2 首）。與 index.html 的 MUSIC_BUNDLED 逐字相同，
// verify_music_data.mjs 的 A8 會把兩邊釘在一起，改一邊沒改另一邊會當場紅。
const BUNDLED = [
  'Afloat/Zero Gravity Dream.mp3', 'Afloat/Floating in Zero Gravity (Extend)-2.mp3',
  'Midnight stories/Midnight Whispers.mp3', 'Midnight stories/Skyline Pillow Thoughts.mp3',
  'Moonlake/Untitled-5.mp3', 'Moonlake/Untitled-9.mp3', 'Rainy day/City Rain Reverie.mp3',
  'Rainy day/Urban Night.mp3', 'Star & Neon/Neon Glow.mp3', "Star & Neon/Stargazer's Lullaby.mp3",
  'peaceful piano/Inspired by peaceful piano.mp3', 'peaceful piano/Inspired by peaceful piano-6.mp3',
];

const FAMILIES = [
  { id: 'city-circuit', zh: '城市環線', desc: '白天到深夜的城市與捷運' },
  { id: 'open-landscape', zh: '開闊風景', desc: '海岸、平原與東部縱谷' },
  { id: 'quiet-hours', zh: '靜謐時刻', desc: '清晨、山霧與黃昏' },
];

// 🔴 zones/hours 為 null＝不限。auto:false＝只出現在手動選單，不參與自動選池。
//    「都市爵士」的 zones 刻意含三個都會區——只給 north-city 會讓
//    west-plain×evening 與 south×evening 兩格選不出池（45 格覆蓋率會當場紅）。
const POOLS = [
  { id: 'city-pop-day', zh: '都會日行', family: 'city-circuit', desc: '高架捷運、玻璃帷幕與城市白天的向前感',
    zones: ['north-city', 'west-plain', 'south'], hours: ['day'], weather: null, auto: true },
  { id: 'urban-jazz', zh: '都市爵士', family: 'city-circuit', desc: '站前咖啡店、傍晚轉乘與暖色窗光',
    zones: ['north-city', 'west-plain', 'south'], hours: ['dusk', 'evening'], weather: null, auto: true },
  { id: 'metro-motion', zh: '捷運流動', family: 'city-circuit', desc: '日常通勤、短站距與乾淨俐落的城市節奏',
    zones: ['metro'], hours: null, weather: null, auto: true },
  { id: 'rainy-city', zh: '城市雨景', family: 'city-circuit', desc: '小雨、陣雨與雨後的低彩度城市',
    zones: ['north-city', 'west-plain', 'south'], hours: null, weather: ['rain'], auto: false },
  { id: 'midnight-city', zh: '午夜城市', family: 'city-circuit', desc: '末班車後、空月台與仍未睡的窗',
    zones: ['north-city', 'west-plain', 'south'], hours: ['night'], weather: null, auto: true },
  { id: 'north-coast', zh: '北海岸天色', family: 'open-landscape', desc: '基隆、北海岸與東北角的陰天與港景',
    zones: ['north-coast'], hours: null, weather: null, auto: true },
  { id: 'yilan-line', zh: '蘭陽雨原', family: 'open-landscape', desc: '蘭陽平原的雨與開闊',
    zones: ['yilan'], hours: null, weather: null, auto: true },
  { id: 'hualien-cliffs', zh: '花蓮山海', family: 'open-landscape', desc: '清水斷崖與縱谷之間',
    zones: ['hualien'], hours: null, weather: null, auto: true },
  { id: 'taitung-open', zh: '台東開闊線', family: 'open-landscape', desc: '南迴與花東縱谷的開闊',
    zones: ['taitung'], hours: null, weather: null, auto: true },
  { id: 'western-plains', zh: '西部平原', family: 'open-landscape', desc: '縱貫線中段的稻田與長直線',
    zones: ['west-plain'], hours: ['day', 'dusk'], weather: null, auto: true },
  { id: 'southern-sun', zh: '南方日光', family: 'open-landscape', desc: '嘉南到屏東的強光與熱空氣',
    zones: ['south'], hours: ['day'], weather: null, auto: true },
  { id: 'mountain-branch', zh: '山霧支線', family: 'quiet-hours', desc: '山線、林鐵與霧',
    zones: ['mountain'], hours: null, weather: null, auto: true },
  { id: 'first-light', zh: '晨曦初班', family: 'quiet-hours', desc: '第一班車與還沒醒的月台',
    zones: null, hours: ['dawn'], weather: null, auto: true },
  { id: 'golden-hour', zh: '黃昏斜光', family: 'quiet-hours', desc: '斜射光與一天的收尾',
    zones: null, hours: ['dusk'], weather: null, auto: true },
  { id: 'island-community', zh: '山海聚落共創', family: null, desc: '與原民音樂人共創（尚未開放）',
    zones: null, hours: null, weather: null, auto: false },
  { id: 'rail-texture-score', zh: '鐵道質地配樂', family: null, desc: '鐵道質地的聲音設計',
    zones: null, hours: null, weather: null, auto: false },
];

function probe(rel) {
  const abs = path.join(MUSIC_DIR, rel);
  const out = execFileSync('ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', abs], { encoding: 'utf8' });
  return { src: rel, dur: Math.round(parseFloat(out.trim())), bytes: statSync(abs).size };
}

const free = FREE_FOLDERS.flatMap(d =>
  readdirSync(path.join(MUSIC_DIR, d)).filter(f => f.endsWith('.mp3')).sort().map(f => probe(`${d}/${f}`)));

// 付費曲目：`_pass/<pool-id>/` 一池一資料夾。目錄不存在＝該池尚未上架，tracks 留空陣列。
// 🔴 WAV 母帶在 `_pass` 的兄弟目錄 `_masters/`，已進 .gitignore 與 .assetsignore，永不出貨。
const pools = POOLS.map(p => {
  const dir = path.join(MUSIC_DIR, '_pass', p.id);
  const tracks = existsSync(dir)
    ? readdirSync(dir).filter(f => f.endsWith('.mp3')).sort().map(f => probe(`_pass/${p.id}/${f}`))
    : [];
  return { ...p, tracks };
});

// source_notes 供 build_data_provenance 讀取。刻意不寫時間戳:那個閘門要求重跑逐 byte 相同。
const out = {
  source_notes: '本站自製配樂,無外部資料源。曲目由 Suno 生成後人工挑選,'
    + 'dur/bytes 由 scripts/build_music_data.mjs 以 ffprobe 與檔案大小量出;'
    + '情境池的分區/時段/家族歸屬是產品設計,定義在同一支建置腳本的 POOLS 常數',
  free: { tracks: free, bundled: BUNDLED }, families: FAMILIES, pools,
};
writeFileSync(path.join(ROOT, 'data', 'music.json'), JSON.stringify(out, null, 2) + '\n');
const shipped = pools.filter(p => p.tracks.length);
const mins = (ts) => Math.round(ts.reduce((a, x) => a + x.dur, 0) / 60);
console.log(`data/music.json：免費 ${free.length} 首（${mins(free)} 分）、家族 ${FAMILIES.length} 套、池 ${pools.length} 個`);
console.log(`已上架 ${shipped.length} 池：` + shipped.map(p => `${p.zh} ${p.tracks.length} 首/${mins(p.tracks)} 分`).join('、'));
