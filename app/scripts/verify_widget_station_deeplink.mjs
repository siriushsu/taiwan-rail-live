#!/usr/bin/env node
// 桌面看板點進 App 的跨層契約：小工具產生 station URL → 原生殼轉成
// waitOpen(view=station) → 網頁以「系統＋站名」開站。少一層都會讓臺北掉回同名捷運站。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = path => readFileSync(join(root, path), 'utf8');
const files = {
  html: read('index.html'),
  iosRail: read('app/ios/App/RailBoardWidget/RailBoardWidget.swift'),
  iosMixed: read('app/ios/App/RailBoardWidget/MixedBoardWidget.swift'),
  iosPlugin: read('app/ios/App/App/RailMetroWaitPlugin.swift'),
  androidRail: read('app/android/app/src/main/java/tw/railisland/app/RailBoardWidgetProvider.java'),
  androidMixed: read('app/android/app/src/main/java/tw/railisland/app/MixedWidgetRender.java'),
  androidPlugin: read('app/android/app/src/main/java/tw/railisland/app/RailMetroWaitPlugin.java'),
};

const rules = [
  ['iOS 發車看板產生 station 深連結', /components\.host = "station"/.test(files.iosRail)
    && /widgetURL\(RailBoardDeepLink\.stationURL/.test(files.iosRail)],
  ['iOS 雙看板整卡退路是鐵路起站',
    /RailBoardDeepLink\.stationURL\(originKey: entry\.configuration\.railOrigin\)/.test(files.iosMixed)],
  ['Android 發車看板深連結帶 sys 與 station', /authority\("station"\)/.test(files.androidRail)
    && /appendQueryParameter\("sys", sys\)/.test(files.androidRail)
    && /appendQueryParameter\("station", station\)/.test(files.androidRail)],
  ['Android 雙看板鐵路區與捷運區分開導向',
    /wmx_root, railTap/.test(files.androidMixed)
    && /wmx_rail_rows, railTap/.test(files.androidMixed)
    && /wmx_metro_rows, metroTap/.test(files.androidMixed)],
  ['iOS 原生殼接 station host 並標記 station view', /url\.host == "station"/.test(files.iosPlugin)
    && /comps\.host == "station" \{ data\["view"\] = "station"/.test(files.iosPlugin)],
  ['Android 原生殼接 station host 並標記 station view', /"station"\.equals\(host\)/.test(files.androidPlugin)
    && /"station"\.equals\(uri\.getHost\(\)\)\) data\.put\("view", "station"\)/.test(files.androidPlugin)],
  ['網頁必須同時核對 sched 系統與站名', /evt\.view === 'station'/.test(files.html)
    && /rec\.mode === 'sched' && ids\.includes\(rec\.systemId\)/.test(files.html)
    && /webMcpNorm\(rec\.name\) === key/.test(files.html)],
];

let failed = 0;
for (const [label, pass] of rules) {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`);
  if (!pass) failed++;
}
if (failed) process.exitCode = 1;
else console.log(`桌面看板深連結契約：${rules.length}/${rules.length}`);
