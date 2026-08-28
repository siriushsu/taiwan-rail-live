import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dictionarySource = fs.readFileSync(path.join(root, 'i18n/translations.js'), 'utf8');
const contentDictionarySource = fs.readFileSync(path.join(root, 'i18n/content-translations.js'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'i18n/stations.json'), 'utf8'));
const specialData = JSON.parse(fs.readFileSync(path.join(root, 'data/tra_special_trains.json'), 'utf8'));
const legalDictionarySource = fs.readFileSync(path.join(root, 'i18n/legal-translations.js'), 'utf8');
const failures = [];

function fail(message) { failures.push(message); }

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(dictionarySource, sandbox, { filename: 'i18n/translations.js' });
vm.runInContext(contentDictionarySource, sandbox, { filename: 'i18n/content-translations.js' });
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

// data/music.json 的家族/池名稱與說明會經 musicPlRow() 的 t() 顯示,但它們是【資料】不是
// index.html 的字面 t('…'),上面那條 runtime key 掃描完全看不到 ⇒ 兩種語言【同時】漏掉時
// 整份稽核照樣全綠(突變測試證實)。這裡把資料檔的顯示字串補成第一級來源。
const musicData = JSON.parse(fs.readFileSync(path.join(root, 'data/music.json'), 'utf8'));
const musicDisplayKeys = [
  ...musicData.families.flatMap(family => [family.zh, family.desc]),
  ...musicData.pools.flatMap(pool => [pool.zh, pool.desc]),
].filter(Boolean);
// 分母自己也要有斷言:欄位改名或曲庫清空時,這條檢查會靜默縮成 0 個而不是報錯。
if (musicDisplayKeys.length < 2 * (musicData.families.length + musicData.pools.length)) {
  fail(`配樂曲庫顯示字串取到 ${musicDisplayKeys.length} 個,少於家族+池數 x 2,欄位名可能改了`);
}
for (const key of new Set(musicDisplayKeys)) {
  for (const lang of languages) if (!keySets[lang]?.has(key)) fail(`${lang} 缺少配樂曲庫字串：${key}`);
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

// 英文字典本身不得殘留漢字；否則畫面雖然經過 t()，仍會悄悄露出中文。
function scanEnglishCjk(value, label) {
  if (typeof value === 'string') {
    if (/[\u3400-\u9fff]/.test(value)) fail(`英文翻譯仍含中文：${label} = ${value}`);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) scanEnglishCjk(child, `${label}.${key}`);
}
scanEnglishCjk(messages.en, 'messages.en');

// 特色列車／車種／支線以資料檔穩定 id 對譯，不改寫原始 JSON；每個顯示欄位與陣列長度都要對齊。
const contentData = sandbox.window.RAIL_I18N_CONTENT_DATA || {};
scanEnglishCjk(contentData.en, 'content.en');
const contentFields = {
  namedTrains: ['name', 'story', 'tags'],
  rollingStock: ['name', 'story', 'facts'],
  branchLines: ['name', 'section', 'story'],
};
for (const [group, fields] of Object.entries(contentFields)) {
  for (const item of specialData[group] || []) for (const lang of languages) {
    const translated = contentData[lang]?.[group]?.[item.id];
    if (!translated) { fail(`${group}「${item.id}」缺少 ${lang} 內容資料`); continue; }
    for (const field of fields) {
      if (typeof item[field] === 'string' && !translated[field]) fail(`${group}「${item.id}.${field}」缺少 ${lang}`);
      if (Array.isArray(item[field]) && (!Array.isArray(translated[field]) || translated[field].length !== item[field].length)) {
        fail(`${group}「${item.id}.${field}」的 ${lang} 陣列未與繁中對齊`);
      }
    }
  }
}

function evaluateConstBlock(startMarker, endMarker, names) {
  const start = indexSource.indexOf(startMarker), end = indexSource.indexOf(endMarker, start);
  if (start < 0 || end < 0) { fail(`找不到內容區塊：${startMarker}`); return {}; }
  const local = {};
  vm.createContext(local);
  vm.runInContext(`${indexSource.slice(start, end)}\nglobalThis.__out = { ${names.join(', ')} };`, local);
  return local.__out || {};
}
const { ACHIEVEMENTS = [] } = evaluateConstBlock('const ACHIEVEMENTS =', 'const ACH_TESTS =', ['ACHIEVEMENTS']);
const { STATION_INTRO = {} } = evaluateConstBlock('const STATION_INTRO =', '// 有精選特色', ['STATION_INTRO']);
const helpBlocks = evaluateConstBlock('const HELP_QUICK =', 'const HELP_TRY =', ['HELP_QUICK', 'HELP_GROUPS']);
const { SYS_META = {} } = evaluateConstBlock('const SYS_META =', '// 播放/速度/時間', ['SYS_META']);
const { GROUPS = [] } = evaluateConstBlock('const GROUPS =', 'const groupOf', ['GROUPS']);
const { METRO_OFFICIAL = [] } = evaluateConstBlock('const METRO_OFFICIAL =', 'function metroLinksHtml', ['METRO_OFFICIAL']);

for (const source of Object.values(STATION_INTRO)) for (const lang of languages) {
  if (!keySets[lang]?.has(source)) fail(`特色車站缺少 ${lang}：${source}`);
}
for (const achievement of ACHIEVEMENTS) for (const source of [achievement.name, achievement.desc]) for (const lang of languages) {
  if (!keySets[lang]?.has(source)) fail(`成就「${achievement.id}」缺少 ${lang}：${source}`);
}
const metadataSources = [
  ...Object.values(SYS_META).flatMap(meta => [meta.sub, meta.lead]),
  ...GROUPS.flatMap(group => [group.label, group.short, group.plate?.sub, group.plate?.lead]),
  ...METRO_OFFICIAL.map(item => item.label),
].filter(value => value && /[\u3400-\u9fff]/.test(value));
for (const source of new Set(metadataSources)) for (const lang of languages) {
  if (!keySets[lang]?.has(source)) fail(`系統導言／官方連結缺少 ${lang}：${source}`);
}
const hiddenHelpKeys = new Set(['bounty', 'bountyrec', 'bountyme']);
const helpSources = [];
for (const quick of helpBlocks.HELP_QUICK || []) helpSources.push(...String(quick.tx || '').split(/<\/?b>/).filter(Boolean));
for (const group of helpBlocks.HELP_GROUPS || []) {
  helpSources.push(group.name);
  for (const section of group.secs || []) {
    if (hiddenHelpKeys.has(section.key)) continue; // 尚未上線的 GPS 校正實驗功能，不屬公開說明。
    helpSources.push(section.nm, section.one, ...(section.steps || []), section.tip);
    // 說明卡圖示也是真正顯示的文字；HTML 圖示只取出其中的可見中文字。
    if (section.ic) helpSources.push(...String(section.ic).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean));
    if (section.tipDesktop) helpSources.push(...String(section.tipDesktop).split(/<\/?b>/).filter(Boolean));
  }
}
for (const source of new Set(helpSources.filter(value => value && /[\u3400-\u9fff]/.test(value)))) for (const lang of languages) {
  if (!keySets[lang]?.has(source)) fail(`使用說明缺少 ${lang}：${source}`);
}

const recentBlock = /<ul class="foot-list foot-recent">([\s\S]*?)<\/ul>/.exec(indexSource)?.[1] || '';
const recentTexts = [...recentBlock.matchAll(/<li data-cl-of="[^"]+">[\s\S]*?<span>([^<]+)<\/span><\/li>/g)].map(match => match[1].replace(/&amp;/g, '&'));
if (recentTexts.length !== 8) fail(`公開更新紀錄近期項目應為 8 筆，目前 ${recentTexts.length} 筆`);
for (const source of recentTexts) for (const lang of languages) {
  if (!keySets[lang]?.has(source)) fail(`近期更新缺少 ${lang} 精簡翻譯：${source}`);
}
for (const lang of languages) {
  const summaries = sandbox.window.RAIL_I18N_CHANGELOG?.[lang];
  if (!Array.isArray(summaries) || !summaries.length || summaries.some(group => !group.name || !group.items?.length)) {
    fail(`${lang} 缺少歷史更新主題摘要`);
  }
}

const legalMessages = sandbox.window.RAIL_I18N_LEGAL_MESSAGES || {};
scanEnglishCjk(legalMessages.en, 'legal.en');
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
  'stationIntroText', 'renderTrainCard', 'buildStamps', 'buildAchv', 'punctualRow',
  'renderExplorePanel', 'renderNamedIntro', 'renderSearchDrop', 'renderHelp',
  'takeoutSyncConfirm', 'takeoutRenderPreview', 'takeoutStartManual', 'accountRender', 'accountBtnSlot',
  'myTrainRow', 'myTrainSection', 'renderFavs', 'renderFavPanel', 'todayRow', 'renderTodayEvents', 'renderTodayPanel',
  'renderFollowEvents', 'renderDelayRow', 'renderDelayHist', 'eventRowsHtml', 'eventSecHtml',
  'announceCollections', 'doCheckin', 'startRiding', 'finishRiding', 'updateRideBtn',
  'renderTripSharePanel', 'renderTripBanner', 'metroWaitOpenPicker',
];
for (const name of dynamicRenderers) {
  const lines = functionSource(name).split('\n');
  lines.forEach((line, index) => {
    const code = line.replace(/\/\/.*$/, '');
    if (!/[\u3400-\u9fff]/.test(code) || !/(innerHTML|textContent|showToast|\.title|aria-label|placeholder)/.test(code)) return;
    if (/\bt\s*\(/.test(code) || /^\s*\/\//.test(code)) return;
    fail(`${name} 第 ${index + 1} 行仍有未包 t() 的核心 DOM 中文：${code.trim()}`);
  });
}

if (failures.length) {
  console.error(`i18n 稽核失敗（${failures.length} 項）`);
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log(`i18n 稽核通過：${keySets.en.size} 個 UI／內容 key、${legalKeyCount} 個法務 key、${literalKeys.length} 個 runtime 呼叫、${stationCount} 筆站名，以及特色列車／車種／支線／特色站／說明／成就／更新紀錄的 en/ja 覆蓋。`);
