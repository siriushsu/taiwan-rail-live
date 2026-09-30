#!/usr/bin/env node
// 車站收集小工具的台灣輪廓資料產生器：iOS、Android 讀同一份多邊形，兩邊的輪廓才會一樣。
//
// 讀 data/taiwan_land.json（GeoJSON MultiPolygon，內政部縣市界線 dissolve 取海岸線），投影到點陣的
// 0..1000 正規化空間，只留跟投影框相交或貼近框的島，寫出兩份產物（不要手改，改這支再重跑）：
//   app/ios/App/RailBoardWidget/CollectionOutlineData.swift
//   app/android/app/src/main/java/tw/railisland/app/CollectionOutlineData.java
//
// 用法：node app/scripts/build_collect_outline.mjs            重產兩份產物
//       node app/scripts/build_collect_outline.mjs --check    只比對，產物跟重產結果不同就 exit 1
//
// 投影跟點相同（docs/collect-widget-contract.md 的 box，也是 index.html 送出 payload 時用的框）：
//   x = (lon − 120.15)/(122.0 − 120.15) × 1000      y = (25.27 − lat)/(25.27 − 22.2) × 1000
// payload 的點會四捨五入並夾在 0..1000；輪廓不夾、保留小數兩位，所以主島南端（恆春半島）與西岸
// 會超出 0..1000，這是資料本來的樣子。

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const OUT_SWIFT = join(repo, 'app/ios/App/RailBoardWidget/CollectionOutlineData.swift');
const OUT_JAVA = join(repo, 'app/android/app/src/main/java/tw/railisland/app/CollectionOutlineData.java');
const [LON0, LAT0, LON1, LAT1] = [120.15, 22.2, 122.0, 25.27];
const NEAR = 0.3; // 度：bbox 與「投影框外擴 0.3°」相交才留。澎湖東緣離框 0.45°、金馬更遠，都排除；蘭嶼南緣離框 0.2°，留。

const geo = JSON.parse(readFileSync(join(repo, 'data/taiwan_land.json'), 'utf8'));
const polysLL = geo.geometry.type === 'MultiPolygon' ? geo.geometry.coordinates : [geo.geometry.coordinates];
const px = lon => ((lon - LON0) / (LON1 - LON0)) * 1000;
const py = lat => ((LAT1 - lat) / (LAT1 - LAT0)) * 1000;
const r2 = v => Math.round(v * 100) / 100;
// 每個 0..1000 單位的地面長度（km），算面積用
const kmX = (LON1 - LON0) * Math.cos(((LAT0 + LAT1) / 2) * Math.PI / 180) * 111.32 / 1000;
const kmY = (LAT1 - LAT0) * 111.32 / 1000;

const kept = [], dropped = [];
for (const poly of polysLL) {
  if (poly.length !== 1) throw new Error('有內環（洞）：目前的資料沒有，兩個平台的畫法也沒處理');
  const ring = poly[0];
  const lons = ring.map(c => c[0]), lats = ring.map(c => c[1]);
  const bb = { w: Math.min(...lons), e: Math.max(...lons), s: Math.min(...lats), n: Math.max(...lats) };
  const nearBox = bb.e >= LON0 - NEAR && bb.w <= LON1 + NEAR && bb.n >= LAT0 - NEAR && bb.s <= LAT1 + NEAR;
  let a2 = 0;
  for (let i = 0; i < ring.length - 1; i += 1) a2 += px(ring[i][0]) * py(ring[i + 1][1]) - px(ring[i + 1][0]) * py(ring[i][1]);
  const areaKm2 = Math.abs(a2 / 2) * kmX * kmY;
  // 西岸外的潮間帶沙洲（外傘頂洲等）：縣市界線把它們算進雲林、嘉義，但那是沙洲不是島，縮圖上只會是海裡的雜點。
  const westShoal = bb.e < 120.17 && bb.s > 23.3 && bb.n < 23.6;
  const speck = areaKm2 < 1; // 小於 1 km²：全台縮圖上不到 0.3pt
  const why = !nearBox ? '離框太遠' : westShoal ? '西岸沙洲' : speck ? '面積<1km²' : '';
  const pts = ring.slice(0, ring.length - 1); // 拿掉 GeoJSON 重複的封閉點，畫的時候自己封閉
  const flat = [];
  for (const [lon, lat] of pts) flat.push(r2(px(lon)), r2(py(lat)));
  (why ? dropped : kept).push({ flat, n: pts.length, bb, areaKm2, why });
}
kept.sort((a, b) => b.n - a.n);

const all = kept.flatMap(k => k.flat);
const xs = all.filter((_, i) => i % 2 === 0), ys = all.filter((_, i) => i % 2 === 1);
const ext = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
const total = kept.reduce((s, k) => s + k.n, 0);

const doc = [
  '台灣本島與近岸小島（龜山島、綠島、蘭嶼、小琉球）的海岸線，已投影到點陣的 0..1000 正規化空間，',
  '跟點是同一個投影框，所以輪廓與點共用同一條座標公式。每個多邊形攤平成 x,y,x,y…（沒有重複的封閉點、沒有內環）。',
  '主島南端與西岸會超出 0..1000，這是資料本來的樣子，不夾回。',
  '來源：data/taiwan_land.json（內政部 直轄市、縣市界線，dissolve 取海岸線；政府資料開放授權條款第 1 版，',
  'App 的資料來源頁已署名「臺灣輪廓：內政部」）。澎湖、金門、馬祖離投影框太遠，不收。',
  `共 ${kept.length} 個多邊形、${total} 點；範圍 x ${ext.x0.toFixed(1)}…${ext.x1.toFixed(1)}、y ${ext.y0.toFixed(1)}…${ext.y1.toFixed(1)}。`,
];
const head = '由 app/scripts/build_collect_outline.mjs 產生，不要手改。';
const num = v => (Number.isInteger(v) ? v.toFixed(1) : String(v));

const swift = [
  `// ${head}`,
  '',
  ...doc.map(l => `/// ${l}`),
  'enum CollectionOutlineData {',
  '    static let polygons: [[Double]] = [',
  ...kept.map(k => `        [${k.flat.map(num).join(', ')}],`),
  '    ]',
  '}',
  '',
].join('\n');

const java = [
  `// ${head}`,
  'package tw.railisland.app;',
  '',
  '/**',
  ...doc.map(l => ` * ${l}`),
  ' */',
  'final class CollectionOutlineData {',
  '    private CollectionOutlineData() {}',
  '',
  '    static final float[][] POLYGONS = {',
  ...kept.map(k => `        {${k.flat.map(v => `${num(v)}f`).join(', ')}},`),
  '    };',
  '}',
  '',
].join('\n');

if (process.argv.includes('--check')) {
  const bad = [[OUT_SWIFT, swift], [OUT_JAVA, java]].filter(([p, s]) => {
    try { return readFileSync(p, 'utf8') !== s; } catch { return true; }
  });
  if (bad.length) {
    console.error(`輪廓產物跟產生器不一致：${bad.map(([p]) => p.slice(repo.length + 1)).join('、')}（重跑 node app/scripts/build_collect_outline.mjs）`);
    process.exit(1);
  }
  console.log(`輪廓產物一致（${kept.length} 個多邊形、${total} 點）`);
} else {
  writeFileSync(OUT_SWIFT, swift);
  writeFileSync(OUT_JAVA, java);
  console.log(`保留 ${kept.length} 個多邊形、${total} 點；排除 ${dropped.length} 個`);
  for (const k of kept) console.log(`  留 ${String(k.n).padStart(4)} 點 ${k.areaKm2.toFixed(1).padStart(7)} km²  lon ${k.bb.w.toFixed(3)}–${k.bb.e.toFixed(3)}  lat ${k.bb.s.toFixed(3)}–${k.bb.n.toFixed(3)}`);
  console.log(`範圍 x ${ext.x0.toFixed(1)}…${ext.x1.toFixed(1)}  y ${ext.y0.toFixed(1)}…${ext.y1.toFixed(1)}`);
}
