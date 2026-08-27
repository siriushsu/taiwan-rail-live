import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dictionarySource = fs.readFileSync(path.join(root, 'i18n/translations.js'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'i18n/stations.json'), 'utf8'));
const legalDictionarySource = fs.readFileSync(path.join(root, 'i18n/legal-translations.js'), 'utf8');
const failures = [];

function fail(message) { failures.push(message); }

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(dictionarySource, sandbox, { filename: 'i18n/translations.js' });
vm.runInContext(legalDictionarySource, sandbox, { filename: 'i18n/legal-translations.js' });
const messages = sandbox.window.RAIL_I18N_MESSAGES || {};
const languages = ['en', 'ja'];

for (const lang of languages) {
  if (!messages[lang] || typeof messages[lang] !== 'object') fail(`${lang} 字典不存在`);
}

const keySets = Object.fromEntries(languages.map(lang => [lang, new Set(Object.keys(messages[lang] || {}))]));
for (const key of keySets.en || []) if (!keySets.ja.has(key)) fail(`ja 缺少 en 已有的 key：${key}`);
for (const key of keySets.ja || []) if (!keySets.en.has(key)) fail(`en 缺少 ja 已有的 key：${key}`);

// runtime 直接呼叫 t('繁中原文') 的 key 必須兩種外語都有；動態變數 key 另外由核心清單守門。
const literalKeys = [...indexSource.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)].map(match => match[2]);
for (const key of new Set(literalKeys)) {
  for (const lang of languages) if (!keySets[lang]?.has(key)) fail(`${lang} 缺少 runtime key：${key}`);
}

const coreStaticKeys = [
  '歡迎搭乘', '軌島怎麼玩', '上面', '全／台／高／捷', '選要看哪個系統',
  '點', '列車', '＝鏡頭跟著它跑，陪到終點蓋完乘章', '車站', '＝看接下來的班次與倒數',
  '暫停／播放（空白鍵）', '模擬時刻：左右拖曳調整，方向鍵每次 1 分鐘',
  '更多設定：外觀、軌道與路線、平交道、站介紹、方向箭頭、省電模式',
  '語言', '選擇介面語言', '隱私權政策', '使用條款',
  '列車位置、誤點資訊與系統覆蓋永遠免費——Plus 不影響準確度。',
  '訂閱到期前會依商店規則自動續訂扣款；你可以隨時在 App Store／Google Play 或帳號的訂閱設定中取消，取消後於當期結束時停止續訂。',
  '載入中…', '沒有資料', '網路連線失敗，請稍後再試',
];
for (const key of coreStaticKeys) {
  for (const lang of languages) if (!keySets[lang]?.has(key)) fail(`${lang} 缺少核心靜態字串：${key}`);
}

for (const [lang, dictionary] of Object.entries(messages)) {
  for (const [key, value] of Object.entries(dictionary)) {
    if (value == null || value === '') fail(`${lang} 的翻譯為空：${key}`);
    if (typeof value !== 'string' && (typeof value !== 'object' || Array.isArray(value))) {
      fail(`${lang} 的翻譯型別不支援：${key}`);
    }
  }
}

const legalMessages = sandbox.window.RAIL_I18N_LEGAL_MESSAGES || {};
const legalKeyCount = Object.keys(legalMessages.en || {}).length;
for (const file of ['privacy.html', 'terms.html']) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const visibleSource = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  const textKeys = [...visibleSource.matchAll(/>([^<>]+)</g)]
    .map(match => match[1].replace(/\s+/g, ' ').trim())
    .filter(value => value && /[\u3400-\u9fff]/.test(value));
  const description = /<meta\s+name="description"\s+content="([^"]+)"/.exec(html)?.[1];
  if (description) textKeys.push(description);
  for (const key of new Set(textKeys)) for (const lang of languages) {
    if (!Object.prototype.hasOwnProperty.call(legalMessages[lang] || {}, key)) fail(`${file} 的 ${lang} 法務翻譯缺少：${key}`);
  }
}
for (const lang of languages) {
  const own = new Set(Object.keys(legalMessages[lang] || {}));
  const other = new Set(Object.keys(legalMessages[lang === 'en' ? 'ja' : 'en'] || {}));
  for (const key of own) if (!other.has(key)) fail(`${lang === 'en' ? 'ja' : 'en'} 法務字典缺少 ${lang} 已有的 key：${key}`);
}

let stationCount = 0;
for (const [system, rows] of Object.entries(catalog.systems || {})) {
  for (const [name, translated] of Object.entries(rows || {})) {
    stationCount++;
    for (const lang of languages) if (!translated?.[lang]) fail(`${system}「${name}」缺少 ${lang} 站名或安全 fallback`);
  }
}
for (const group of ['routes', 'trainTypes']) {
  for (const [system, rows] of Object.entries(catalog[group] || {})) {
    const entries = group === 'trainTypes' ? [[system, rows]] : Object.entries(rows || {});
    for (const [name, translated] of entries) {
      for (const lang of languages) if (!translated?.[lang]) fail(`${group}「${name}」缺少 ${lang} 名稱或安全 fallback`);
    }
  }
}

// 核心動態 renderer 的 DOM 寫入若仍夾帶未經 t() 的中文，視為回歸。
function functionSource(name) {
  const start = indexSource.indexOf(`function ${name}(`);
  if (start < 0) { fail(`找不到核心 renderer：${name}`); return ''; }
  const brace = indexSource.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < indexSource.length; i++) {
    const char = indexSource[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return indexSource.slice(start, i + 1);
  }
  fail(`無法解析核心 renderer：${name}`);
  return '';
}
const dynamicRenderers = [
  'renderSystemsBar', 'renderFreqBoard', 'renderBoard', 'updateFollowPanel',
  'renderAlertBanner', 'renderAlertDetail', 'plusRender', 'onLocateFail',
  'renderNearbyStations', 'renderPinCard', 'renderRidePanel', 'renderPassport',
];
for (const name of dynamicRenderers) {
  const lines = functionSource(name).split('\n');
  lines.forEach((line, index) => {
    if (!/[\u3400-\u9fff]/.test(line) || !/(innerHTML|textContent|showToast|\.title|aria-label|placeholder)/.test(line)) return;
    if (/\bt\s*\(/.test(line) || /^\s*\/\//.test(line)) return;
    fail(`${name} 第 ${index + 1} 行仍有未包 t() 的核心 DOM 中文：${line.trim()}`);
  });
}

if (failures.length) {
  console.error(`i18n 稽核失敗（${failures.length} 項）`);
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log(`i18n 稽核通過：${keySets.en.size} 個 UI key、${legalKeyCount} 個法務 key、${literalKeys.length} 個 runtime 呼叫、${stationCount} 筆站名，en/ja key 完整對齊。`);
