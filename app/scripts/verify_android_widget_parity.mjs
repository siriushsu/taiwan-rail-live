#!/usr/bin/env node
// 平台能力 gate：iOS WidgetBundle 的出貨集合有對應 Android provider／Live Update 才算過。
// 這支故意驗「功能集合」，不是驗某個 provider 自己編得過；過去正是後者全綠卻漏了三項。
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');

export function verifyAndroidWidgetParity({ log = true } = {}) {
  const manifest = read('app/android/app/src/main/AndroidManifest.xml');
  const main = read('app/android/app/src/main/java/tw/railisland/app/MainActivity.java');
  const bridge = read('app/src/native-bridge.mjs');
  const bundle = read('app/ios/App/RailBoardWidget/RailBoardWidgetBundle.swift');
  const rules = new Map([
    ['RailBoardWidget()', [manifest, /android:name="\.RailBoardWidgetProvider"/]],
    ['MetroBoardWidget()', [manifest, /android:name="\.MetroWidgetProvider"/]],
    ['MixedBoardWidget()', [manifest, /android:name="\.MixedBoardWidgetProvider"/]],
    ['RailFollowActivityWidget()', [main, /registerPlugin\(RailFollowLivePlugin\.class\)/]],
    ['MetroWaitActivityWidget()', [main, /registerPlugin\(RailMetroWaitPlugin\.class\)/]],
  ]);
  const body = bundle.match(/var\s+body\s*:\s*some\s+Widget\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? '';
  const shipped = [...body.matchAll(/^\s*(\w+\(\))\s*$/gm)].map(match => match[1]);
  const results = [...rules].map(([ios, rule]) => {
    return {
      label: `${ios} 在 iOS 出貨且有 Android 對應能力`,
      pass: shipped.includes(ios) && rule[1].test(rule[0])
    };
  });
  for (const ios of shipped.filter(name => !rules.has(name))) {
    results.push({ label: `${ios} 尚未定義 Android 對應規則`, pass: false });
  }
  results.push({
    label: 'Android native bridge 對 iOS／Android 都掛出跟車即時卡',
    pass: /platform === 'ios'\s*\|\|\s*platform === 'android'/.test(bridge)
      && /registerPlugin\([^\n]*'RailFollowLive'/.test(bridge)
  });
  if (log) {
    for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.label}`);
  }
  const failed = results.filter(result => !result.pass);
  if (failed.length) {
    throw new Error(`Android/iOS 小工具 parity：${failed.map(result => result.label).join('；')}`);
  }
  if (log) console.log(`Android/iOS 小工具 parity：${shipped.length}/${shipped.length}`);
  return { shipped: shipped.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    verifyAndroidWidgetParity();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
