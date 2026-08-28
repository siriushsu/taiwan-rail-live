#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const fail = message => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };

const catalog = JSON.parse(read('app/ios/App/RailBoardWidget/Localizable.xcstrings'));
const info = JSON.parse(read('app/ios/App/App/InfoPlist.xcstrings'));
const stations = JSON.parse(read('i18n/stations.json'));
const strings = catalog.strings || {};

assert(catalog.sourceLanguage === 'zh-Hant', `原生來源語言錯誤：${catalog.sourceLanguage}`);
for (const [key, value] of Object.entries(strings)) {
  for (const lang of ['en', 'ja']) {
    const translated = value?.localizations?.[lang]?.stringUnit?.value;
    assert(typeof translated === 'string' && translated.trim(), `原生 ${lang} 缺字串：${key}`);
    assert(translated !== 'undefined', `原生 ${lang} 洩漏 undefined：${key}`);
  }
}

const sourceNames = new Set();
for (const section of ['systems', 'routes']) {
  for (const values of Object.values(stations[section] || {})) {
    for (const key of Object.keys(values || {})) sourceNames.add(key);
  }
}
for (const key of Object.keys(stations.trainTypes || {})) sourceNames.add(key);
for (const key of sourceNames) assert(strings[key], `站名／路線／車種沒有進原生目錄：${key}`);

const expected = {
  '追蹤這一站的車': ['Track trains at this station', 'この駅の列車を追跡'],
  '結束等車追蹤': ['End station tracking', '駅の追跡を終了'],
  '進站': ['Arriving', '到着'],
  '往 {station}': ['To {station}', '{station}方面'],
  '約 {n} 分': ['about {n} min', '約{n}分'],
  '臺北捷運': ['Taipei Metro', '台北メトロ'],
  '動物園': ['Taipei Zoo', '動物園'],
  '南港展覽館': ['Taipei Nangang Exhibition Center', '南港展覧館'],
  '自強': ['Tze-Chiang Limited Express', '自強号'],
  '縱貫線北段': ['Western Trunk Line (North Section)', '縦貫線北段'],
};
for (const [key, [en, ja]] of Object.entries(expected)) {
  assert(strings[key]?.localizations?.en?.stringUnit?.value === en, `原生英文值錯誤：${key}`);
  assert(strings[key]?.localizations?.ja?.stringUnit?.value === ja, `原生日文值錯誤：${key}`);
}

const swiftFiles = fs.readdirSync(path.join(root, 'app/ios/App/RailBoardWidget'))
  .filter(name => name.endsWith('.swift'));
for (const file of swiftFiles) {
  const source = read(`app/ios/App/RailBoardWidget/${file}`);
  for (const match of source.matchAll(/RailNativeL10n\.text\(\s*"((?:[^"\\]|\\.)*)"/gs)) {
    const key = JSON.parse(`"${match[1]}"`);
    assert(strings[key], `${file} 使用未收錄的原生翻譯 key：${key}`);
  }
  for (const match of source.matchAll(/Text\(\s*"([^"\\]*[\u3400-\u9fff][^"\\]*)"/g)) {
    assert(match[1] === '軌島', `${file} 仍直接顯示未受手動語言控制的中文：${match[1]}`);
  }
}

for (const key of ['CFBundleDisplayName', 'NSLocationWhenInUseUsageDescription', 'NSLocationAlwaysAndWhenInUseUsageDescription']) {
  for (const lang of ['en', 'ja']) {
    assert(info.strings?.[key]?.localizations?.[lang]?.stringUnit?.value, `InfoPlist ${key} 缺 ${lang}`);
  }
}

const pbx = read('app/ios/App/App.xcodeproj/project.pbxproj');
for (const marker of ['Localizable.xcstrings', 'InfoPlist.xcstrings', 'RailLanguagePlugin.swift', 'ja', 'STRING_CATALOG_GENERATE_SYMBOLS = NO']) {
  assert(pbx.includes(marker), `Xcode 專案未納入：${marker}`);
}
const helper = read('app/ios/App/RailBoardWidget/RailNativeL10n.swift');
const plugin = read('app/ios/App/App/RailLanguagePlugin.swift');
const web = read('index.html');
assert(helper.includes('rail.language') && helper.includes('Bundle.main.path(forResource: language'), '原生 runtime 沒有讀取手動語言或語言 bundle');
assert(plugin.includes('reloadAllTimelines') && plugin.includes('Activity<RailFollowAttributes>.activities') && plugin.includes('Activity<MetroWaitAttributes>.activities'), '切換語言沒有即時刷新小工具／兩種即時動態');
assert(web.includes('Plugins?.RailLanguage') && web.includes('i18nSyncNativeLanguage(lang)'), '網站語言選擇沒有同步到原生 extension');

console.log(`原生多語稽核通過：${Object.keys(strings).length} keys，${sourceNames.size} 個站名／路線／車種，App＋Widget＋Live Activity 同步。`);
