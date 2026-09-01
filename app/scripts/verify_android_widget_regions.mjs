#!/usr/bin/env node
// 驗 Android 起站選單的「縣市分段」這件事。會無聲壞掉的是資料與名單，不是 Java 邏輯，
// 所以判準全都對著會漂移的那幾樣東西：
//
//   1 打包目錄每一站都要有縣市——少一站就掉進「其他」，而選單看起來完全正常。
//   2 出現過的縣市都要在 Java 的 REGION_ORDER 裡——新縣市不在名單只會被排到最後面，
//     不會報錯（這正是「壞掉了但全綠」的形態）。
//   3 Java 的 REGION_ORDER 與 iOS 的 StationOption.regionOrder 逐字相同——兩邊各自維護必漂移。
//   4 高鐵新竹（新竹縣）與台鐵新竹（新竹市）不可同縣市——iOS 註解點名過的坑，
//     一旦有人「順手」拿站名回退查台鐵表就會中。
//
// 用法：node app/scripts/verify_android_widget_regions.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const results = [];
const check = (label, pass, detail = '') => results.push({ label, pass: !!pass, detail });

const out = join(mkdtempSync(join(tmpdir(), 'widget-regions-')), 'RailWidgetData.json');
execFileSync('node', [join(ROOT, 'app/scripts/build_rail_widget_data.mjs'), '--out', out], { stdio: 'pipe' });
const doc = JSON.parse(readFileSync(out, 'utf8'));

const list = source => [...(readFileSync(join(ROOT, source.file), 'utf8')
  .match(source.re)?.[1] ?? '').matchAll(/[「"'“]?([一-鿿]{2,3}[縣市])[」"'”]?/g)].map(m => m[1]);
const androidOrder = list({
  file: 'app/android/app/src/main/java/tw/railisland/app/RailWidgetData.java',
  re: /REGION_ORDER = Arrays\.asList\(([\s\S]*?)\);/,
});
const iosOrder = list({
  file: 'app/ios/App/RailBoardWidget/RailBoardData.swift',
  re: /regionOrder = \[([\s\S]*?)\]/,
});

check('Java 讀得到 REGION_ORDER 名單', androidOrder.length > 0, `${androidOrder.length} 個縣市`);
check('iOS 讀得到 regionOrder 名單', iosOrder.length > 0, `${iosOrder.length} 個縣市`);
check('Android 與 iOS 的縣市順序逐字相同',
  androidOrder.length > 0 && androidOrder.join('／') === iosOrder.join('／'),
  androidOrder.join('／') === iosOrder.join('／') ? '' : `Android ${androidOrder.join('／')}\n    iOS     ${iosOrder.join('／')}`);

for (const system of doc.systems) {
  const missing = system.stations.filter(s => !s.region);
  check(`${system.label}每一站都有縣市`, missing.length === 0,
    missing.length ? `缺 ${missing.length} 站：${missing.map(s => s.name).join('、')}` : `${system.stations.length} 站`);
  const strays = [...new Set(system.stations.map(s => s.region).filter(r => r && !androidOrder.includes(r)))];
  check(`${system.label}沒有 REGION_ORDER 名單外的縣市`, strays.length === 0,
    strays.length ? `名單外：${strays.join('、')}（會被排到最後而不是照南北順序）` : '');
}

const region = (id, name) => doc.systems.find(s => s.id === id)?.stations.find(s => s.name === name)?.region;
check('高鐵新竹與台鐵新竹不同縣市（不可用站名回退查台鐵表）',
  region('thsr', '新竹') === '新竹縣' && region('tra', '新竹') === '新竹市',
  `高鐵 ${region('thsr', '新竹')}／台鐵 ${region('tra', '新竹')}`);

for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.label}${r.detail ? `\n    ${r.detail}` : ''}`);
const passed = results.filter(r => r.pass).length;
console.log(`\n${passed}/${results.length} 通過`);
process.exit(passed === results.length ? 0 : 1);
