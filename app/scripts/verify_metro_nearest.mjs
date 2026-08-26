#!/usr/bin/env node
// 驗收「自動選站的最近站計算」——差分測試:
//   受測物 = 真的會出貨的 Swift(MetroWidgetCatalog + MetroNearestMath,大括號抽取後裸編譯,
//            與 render_metro_widget.mjs 同一套抽取,抽不到直接失敗不留退路)
//   判準   = 本檔用【獨立實作】的 haversine 對同一份目錄自己掃一遍(不同語言、不同程式碼路徑,
//            只共享「大圓距離」的數學定義)——兩邊對不上就是有一邊寫錯了(心得 29:判準不與實作同源)。
// 探針點是固定字面值(不用亂數):三個系統各一個「站點自身座標」的恆等探針、
// 一個 ~280m 偏移探針(鄰站距離餘裕 ≫ 浮點雜訊,不會踩到近平手翻面)、
// 一個只斷言系統歸屬的跨系統探針(高雄市區必須解析到 krtc,證明掃描沒有被第一個系統遮蔽)。
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const widgetDir = resolve(here, '../ios/App/RailBoardWidget');
const dataPath = join(widgetDir, 'MetroWidgetData.json');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

// ---- 大括號抽取(與 render_metro_widget.mjs 完全同一份實作) ----
function extractDeclaration(source, header, { occurrence = 1 } = {}) {
  let searchFrom = 0;
  let found = -1;
  for (let i = 0; i < occurrence; i += 1) {
    found = source.indexOf(header, searchFrom);
    if (found < 0) break;
    searchFrom = found + header.length;
  }
  if (found < 0) throw new Error(`抽不到宣告：${header}（原始碼是不是改名了？）`);
  const open = source.indexOf('{', found);
  if (open < 0) throw new Error(`找不到 ${header} 的左大括號`);
  let depth = 0, inString = false, inLineComment = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i], next = source[i + 1];
    if (inLineComment) { if (ch === '\n') inLineComment = false; continue; }
    if (inString) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '/' && next === '/') { inLineComment = true; i += 1; continue; }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') { depth -= 1; if (depth === 0) return source.slice(found, i + 1); }
  }
  throw new Error(`${header} 的大括號沒有配對成功`);
}

// ---- JS 側獨立實作(判準) ----
const D = JSON.parse(readFileSync(dataPath, 'utf8'));
function jsHaversine(lat1, lon1, lat2, lon2) {
  const r = 6371000, toRad = x => x * Math.PI / 180;
  const p1 = toRad(lat1), p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1), dl = toRad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function jsNearest(lat, lon) {
  let best = null, bestD = Infinity;
  for (const s of D.systems) {
    const seen = new Set();
    for (const l of s.lines) for (const st of l.stations) {
      if (seen.has(st.name)) continue;   // 與 Swift 的 stationNames 去重語意一致
      seen.add(st.name);
      if (typeof st.lat !== 'number' || typeof st.lon !== 'number') continue;
      const d = jsHaversine(lat, lon, st.lat, st.lon);
      if (d < bestD) { bestD = d; best = `${s.id}|${st.name}`; }
    }
  }
  return best;
}
const coordOf = (sys, name) => {
  for (const s of D.systems) if (s.id === sys)
    for (const l of s.lines) for (const st of l.stations) if (st.name === name) return st;
  throw new Error(`目錄裡找不到 ${sys}|${name}`);
};

// ---- 探針點 ----
const zoo = coordOf('trtc', '動物園');
const tpe = coordOf('trtc', '台北車站');
const hamasen = coordOf('krtc', '哈瑪星');
// 機捷的站名在 geo 檔就自帶「站」尾綴(照抄字面,不是別名層的事)。
const a12 = coordOf('tymc', '機場第二航廈站');
const probes = [
  { name: '恆等-北捷動物園', lat: zoo.lat, lon: zoo.lon, expect: 'trtc|動物園' },
  { name: '恆等-高捷哈瑪星', lat: hamasen.lat, lon: hamasen.lon, expect: 'krtc|哈瑪星' },
  { name: '恆等-機捷二航廈', lat: a12.lat, lon: a12.lon, expect: 'tymc|機場第二航廈站' },
  // 偏移探針的期望值不寫死,由 JS 獨立實作現場算——這才是差分的本體。
  { name: '偏移-台北車站東北280m', lat: tpe.lat + 0.002, lon: tpe.lon + 0.002, expect: null },
  { name: '跨系統-高雄市區歸krtc', lat: 22.63, lon: 120.30, expect: null, sysOnly: 'krtc' },
];

// ---- 組 Swift harness、編譯、執行 ----
// 🔴 MetroWidgetCatalog 2026-08-22 搬到 App/MetroWidgetShared.swift(App target 也要用它:
//    等車卡從小工具背景開卡時,perform() 在 App 行程裡跑)。
const sharedSource = readFileSync(join(widgetDir, '..', 'App', 'MetroWidgetShared.swift'), 'utf8');
const nearestSource = readFileSync(join(widgetDir, 'MetroNearest.swift'), 'utf8');
const harness = `
import Foundation
${extractDeclaration(sharedSource, 'struct MetroWidgetCatalog')}
${extractDeclaration(nearestSource, 'enum MetroNearestMath')}
let probesPath = CommandLine.arguments[1]
let raw = try! Data(contentsOf: URL(fileURLWithPath: probesPath))
let probes = try! JSONSerialization.jsonObject(with: raw) as! [[Double]]
let catalog = MetroWidgetCatalog.shared
for p in probes {
    if let hit = MetroNearestMath.nearest(catalog: catalog, lat: p[0], lon: p[1]) {
        print("\\(hit.sys)|\\(hit.station)")
    } else { print("nil") }
}
`;

const work = mkdtempSync(join(tmpdir(), 'metro-nearest-'));
writeFileSync(join(work, 'harness.swift'), harness);
// Bundle.main 對裸執行檔=執行檔所在目錄,目錄檔放旁邊就找得到(render harness 已證實)。
copyFileSync(dataPath, join(work, 'MetroWidgetData.json'));
writeFileSync(join(work, 'probes.json'), JSON.stringify(probes.map(p => [p.lat, p.lon])));
execFileSync('xcrun', ['swiftc', '-O', join(work, 'harness.swift'), '-o', join(work, 'harness')],
             { stdio: ['ignore', 'inherit', 'inherit'] });
const out = execFileSync(join(work, 'harness'), [join(work, 'probes.json')], { encoding: 'utf8' })
  .trim().split('\n');

ok('H0 探針數與輸出行數一致', out.length === probes.length, `${out.length} vs ${probes.length}`);
probes.forEach((p, i) => {
  const got = out[i];
  const expected = p.expect ?? jsNearest(p.lat, p.lon);
  if (p.sysOnly) {
    ok(`H${i + 1} ${p.name}`, (got || '').split('|')[0] === p.sysOnly, `got=${got}`);
    // 系統歸屬之外,站名也要與 JS 判準一致(不寫死站名,避免站點增修時變魔術數字)。
    ok(`H${i + 1}b ${p.name}(與JS判準一致)`, got === jsNearest(p.lat, p.lon),
       `swift=${got} js=${jsNearest(p.lat, p.lon)}`);
  } else {
    ok(`H${i + 1} ${p.name}`, got === expected, `swift=${got} 判準=${expected}`);
  }
});

console.log(`\n總計 PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
