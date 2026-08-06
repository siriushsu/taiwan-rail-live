#!/usr/bin/env node

// 產生 Widget extension 內建的輕量車站目錄。它只在 App Group 的完整看板尚未建立時
// 供 AppIntent 選站，不含班次，也不參與時間軸計算。

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const outputPath = join(
  repoRoot,
  'app/ios/App/RailBoardWidget/RailBoardFallbackStations.json',
);

const readJSON = async relative => JSON.parse(
  await readFile(join(repoRoot, relative), 'utf8'),
);
const [traSchedule, thsrSchedule, stationInfo] = await Promise.all([
  readJSON('data/tra_schedule_dense.json'),
  readJSON('data/thsr_schedule_dense.json'),
  readJSON('data/tra_station_info.json'),
]);

const orderedNames = schedule => {
  const seen = new Set();
  const result = [];
  for (const train of schedule.trains) {
    for (const stop of train.stops) {
      if (seen.has(stop.name)) continue;
      seen.add(stop.name);
      result.push(stop.name);
    }
  }
  return result;
};

const normalize = name => name
  .replaceAll('臺', '台')
  .replaceAll(' ', '')
  .replaceAll('　', '')
  .replace(/[（(].*$/, '');
const infoByName = new Map(
  Object.entries(stationInfo).map(([name, info]) => [normalize(name), info]),
);
const regionFromAddress = address => {
  const region = address.replace(/^\d+/, '').slice(0, 3);
  return /[縣市]$/.test(region) ? region : null;
};
const traStations = orderedNames(traSchedule).map(name => {
  const info = infoByName.get(normalize(name));
  const region = info && regionFromAddress(info.address);
  if (!region) throw new Error(`台鐵車站缺少縣市：${name}`);
  return { n: name, s: 'tra', c: region };
});

const thsrRegions = {
  南港: '臺北市', 台北: '臺北市', 板橋: '新北市', 桃園: '桃園市',
  新竹: '新竹縣', 苗栗: '苗栗縣', 台中: '臺中市', 彰化: '彰化縣',
  雲林: '雲林縣', 嘉義: '嘉義縣', 台南: '臺南市', 左營: '高雄市',
};
const thsrStations = orderedNames(thsrSchedule).map(name => {
  const region = thsrRegions[name];
  if (!region) throw new Error(`高鐵車站缺少縣市：${name}`);
  return { n: name, s: 'thsr', c: region };
});

const document = {
  v: 1,
  systems: { tra: '台鐵', thsr: '高鐵' },
  stations: [...traStations, ...thsrStations],
};
const encoded = `${JSON.stringify(document)}\n`;

if (process.argv.includes('--stdout')) {
  process.stdout.write(encoded);
} else if (process.argv.includes('--check')) {
  const existing = await readFile(outputPath, 'utf8').catch(() => '');
  if (existing !== encoded) {
    throw new Error('RailBoardFallbackStations.json 已過期，請重跑本腳本');
  }
  console.log(`[widget-fallback] ✅ ${document.stations.length} 站與目前班表一致`);
} else {
  await writeFile(outputPath, encoded);
  console.log(`[widget-fallback] 已寫入 ${document.stations.length} 站：${outputPath}`);
}
