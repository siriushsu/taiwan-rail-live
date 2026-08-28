#!/usr/bin/env node
// 將實際出貨的網站／App 多語目錄彙整成單一人工複核文件。
// 完全相同的三語組合只列一次，但會保留所有來源；同一繁中原文若在不同情境有不同譯法則分列。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const readJson = rel => JSON.parse(read(rel));

const context = vm.createContext({ window: {} });
for (const rel of ['i18n/translations.js', 'i18n/content-translations.js', 'i18n/legal-translations.js']) {
  vm.runInContext(read(rel), context, { filename: rel });
}

const web = context.window.RAIL_I18N_MESSAGES || { en: {}, ja: {} };
const legal = context.window.RAIL_I18N_LEGAL_MESSAGES || { en: {}, ja: {} };
const content = context.window.RAIL_I18N_CONTENT_DATA || { en: {}, ja: {} };
const stationCatalog = readJson('i18n/stations.json');
const storySource = readJson('data/tra_special_trains.json');
const nativeCatalog = readJson('app/ios/App/RailBoardWidget/Localizable.xcstrings');
const infoCatalog = readJson('app/ios/App/App/InfoPlist.xcstrings');
const infoPlist = read('app/ios/App/App/Info.plist');
const index = read('index.html');
const build = index.match(/const BUILD = '([^']+)'/)?.[1] || 'unknown';
const output = path.resolve(root, process.argv[2] || `docs/i18n/translation-review-${build}.md`);

const categories = new Map();
const tripleIndex = new Map();
let nativeDuplicates = 0;

function display(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    return Object.entries(value).map(([branch, text]) => `[${branch}] ${display(text)}`).join('\n');
  }
  return String(value);
}

function tripleKey(zh, en, ja) {
  return JSON.stringify([display(zh), display(en), display(ja)]);
}

function add(category, zh, en, ja, source) {
  const row = { category, zh: display(zh), en: display(en), ja: display(ja), sources: new Set([source]) };
  if (!categories.has(category)) categories.set(category, []);
  categories.get(category).push(row);
  const key = tripleKey(row.zh, row.en, row.ja);
  if (!tripleIndex.has(key)) tripleIndex.set(key, row);
  return row;
}

function addDictionary(category, dictionaries, source) {
  const keys = new Set([...Object.keys(dictionaries.en || {}), ...Object.keys(dictionaries.ja || {})]);
  for (const zh of keys) add(category, zh, dictionaries.en?.[zh], dictionaries.ja?.[zh], source);
}

addDictionary('網站 UI、訊息與公開內容', web, 'i18n/translations.js、i18n/content-translations.js');
addDictionary('隱私權政策與服務條款', legal, 'i18n/legal-translations.js');

const storyGroups = {
  namedTrains: new Map((storySource.namedTrains || []).map(item => [item.id, item])),
  rollingStock: new Map((storySource.rollingStock || []).map(item => [item.id, item])),
  branchLines: new Map((storySource.branchLines || []).map(item => [item.id, item])),
};

function flattenStory(group, id, zh, en, ja, fieldPath = '') {
  if (Array.isArray(en) || Array.isArray(ja)) {
    const z = Array.isArray(zh) ? zh : [];
    const e = Array.isArray(en) ? en : [];
    const j = Array.isArray(ja) ? ja : [];
    const length = Math.max(z.length, e.length, j.length);
    for (let i = 0; i < length; i += 1) flattenStory(group, id, z[i], e[i], j[i], `${fieldPath}[${i}]`);
    return;
  }
  if ((en && typeof en === 'object') || (ja && typeof ja === 'object')) {
    const keys = new Set([...Object.keys(en || {}), ...Object.keys(ja || {})]);
    for (const key of keys) flattenStory(group, id, zh?.[key], en?.[key], ja?.[key], fieldPath ? `${fieldPath}.${key}` : key);
    return;
  }
  add('特色列車、車種與支線故事', zh, en, ja, `RAIL_I18N_CONTENT_DATA.${group}.${id}.${fieldPath}`);
}

for (const group of new Set([...Object.keys(content.en || {}), ...Object.keys(content.ja || {})])) {
  const ids = new Set([...Object.keys(content.en?.[group] || {}), ...Object.keys(content.ja?.[group] || {})]);
  for (const id of ids) {
    const zh = storyGroups[group]?.get(id);
    flattenStory(group, id, zh, content.en?.[group]?.[id], content.ja?.[group]?.[id]);
  }
}

for (const [system, values] of Object.entries(stationCatalog.systems || {})) {
  for (const [zh, translated] of Object.entries(values || {})) {
    add('站名', zh, translated.en, translated.ja, `i18n/stations.json systems.${system}`);
  }
}
for (const [system, values] of Object.entries(stationCatalog.routes || {})) {
  for (const [zh, translated] of Object.entries(values || {})) {
    add('路線名', zh, translated.en, translated.ja, `i18n/stations.json routes.${system}`);
  }
}
for (const [zh, translated] of Object.entries(stationCatalog.trainTypes || {})) {
  add('列車種類', zh, translated.en, translated.ja, 'i18n/stations.json trainTypes');
}

for (const [zh, record] of Object.entries(nativeCatalog.strings || {})) {
  const en = record?.localizations?.en?.stringUnit?.value;
  const ja = record?.localizations?.ja?.stringUnit?.value;
  const existing = tripleIndex.get(tripleKey(zh, en, ja));
  if (existing) {
    existing.sources.add('App／Widget／Live Activity Localizable.xcstrings');
    nativeDuplicates += 1;
  } else {
    add('App、Widget 與 Live Activity 專用文字', zh, en, ja, 'Localizable.xcstrings');
  }
}

function xmlDecode(value) {
  return String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function plistString(key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return xmlDecode(infoPlist.match(new RegExp(`<key>${escaped}<\\/key>\\s*<string>([\\s\\S]*?)<\\/string>`))?.[1] || '');
}
for (const [key, record] of Object.entries(infoCatalog.strings || {})) {
  add('iOS 系統權限與 App 名稱', plistString(key) || `[${key}]`, record?.localizations?.en?.stringUnit?.value, record?.localizations?.ja?.stringUnit?.value, `InfoPlist.xcstrings：${key}`);
}

function placeholders(value) {
  return [...new Set([...String(value || '').matchAll(/\{([\w]+)\}/g)].map(match => match[1]))].sort();
}
function sameList(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
function hint(row) {
  const notes = [];
  if (!row.en.trim()) notes.push('缺英文');
  if (!row.ja.trim()) notes.push('缺日文');
  if (row.en === row.zh && row.zh.trim()) notes.push('EN 沿用繁中，請確認');
  if (row.ja === row.zh && row.zh.trim()) notes.push('JA 沿用繁中，請確認是否為正式漢字');
  const sourceVars = placeholders(row.zh);
  if (!sameList(sourceVars, placeholders(row.en))) notes.push('英文插值變數不一致');
  if (!sameList(sourceVars, placeholders(row.ja))) notes.push('日文插值變數不一致');
  return notes.join('；') || '—';
}
function md(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

const preferredOrder = [
  '網站 UI、訊息與公開內容',
  '特色列車、車種與支線故事',
  '隱私權政策與服務條款',
  '站名', '路線名', '列車種類',
  'App、Widget 與 Live Activity 專用文字',
  'iOS 系統權限與 App 名稱',
];
const ordered = [...categories.keys()].sort((a, b) => preferredOrder.indexOf(a) - preferredOrder.indexOf(b));
const total = [...categories.values()].reduce((sum, rows) => sum + rows.length, 0);
const warningTotal = [...categories.values()].flat().filter(row => hint(row) !== '—').length;

const lines = [
  '# 軌島繁中／英文／日文翻譯全量複核稿',
  '',
  `- 出貨 build：\`${build}\``,
  '- 產生日期：2026-08-28',
  `- 唯一三語條目：${total.toLocaleString('en-US')} 筆`,
  `- 原生目錄中與網站／法務／站名完全相同、已合併來源而不重複列出的條目：${nativeDuplicates.toLocaleString('en-US')} 筆`,
  `- 自動提示需留意：${warningTotal.toLocaleString('en-US')} 筆（多數日文站名沿用漢字屬正常情況，仍保留給複核者確認）`,
  '',
  '## 複核方式',
  '',
  '這份文件直接讀取實際出貨字典、站名資料與 Xcode String Catalog 產生，不是另外手抄的翻譯清單。完全相同的「繁中／英文／日文」組合只列一次，來源欄會合併；同一繁中原文若因使用情境而有不同譯法，會保留成不同列。',
  '',
  '若翻譯儲存格以 `[one]`／`[other]` 分行，代表網站 runtime 會依數量的 plural rule 選擇其中一個分支；這是複核用展開格式，介面不會顯示括號標記或整個物件。Xcode 目錄則只收入原生畫面實際可安全插值的純文字值。',
  '',
  '複核時請特別檢查：語意是否自然、鐵道專名是否官方、按鈕字數是否過長、`{station}`／`{n}` 等插值是否完整、付費與權限文字是否可能誤導。可在最後一欄把 `□` 改成 `✓`，或直接在該列後方加註建議。',
  '',
];

let serial = 0;
for (const category of ordered) {
  const rows = categories.get(category).sort((a, b) => a.zh.localeCompare(b.zh, 'zh-Hant') || a.en.localeCompare(b.en, 'en'));
  lines.push(`## ${category}（${rows.length.toLocaleString('en-US')} 筆）`, '');
  lines.push('| # | 來源 | 繁中原文 | English | 日本語 | 自動提示 | 複核 |', '|---:|---|---|---|---|---|:---:|');
  for (const row of rows) {
    serial += 1;
    lines.push(`| ${serial} | ${md([...row.sources].join('；'))} | ${md(row.zh)} | ${md(row.en)} | ${md(row.ja)} | ${md(hint(row))} | □ |`);
  }
  lines.push('');
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${lines.join('\n')}\n`);
console.log(`翻譯複核稿已產生：${path.relative(root, output)}（${total} 筆，${nativeDuplicates} 筆完全相同來源已合併，${warningTotal} 筆自動提示）`);
