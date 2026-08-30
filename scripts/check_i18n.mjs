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
  // HELP_GROUPS 含 App 平台分支；稽核只需展開字串，不執行功能。用網站端作穩定基準，
  // Android 分支的額外字串仍會由下方原始碼硬編碼掃描與原生目錄 gate 覆蓋。
  const local = { IS_NATIVE_APP: false, window: {} };
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

// 第一層「最近更新」是滾動檢視,不是正本(index.html 的 foot-recent 註解寫明:每條用 data-cl-of
// 指向第二層某條 data-cl,新功能一進榜舊的就會被合法擠出去)。所以【條數是會漂移的量】——
// 這裡原本寫死「應為 8 筆」,而實測 08-21～08-29 之間它在 7/8/9 之間來回漂了六次,每次漂到
// 非 8 就讓整支稽核假紅(唯一失敗項),於是「i18n 有沒有漏譯」實質上沒有閘門在守。
// 改成綁身分與覆蓋率,不綁條數:(a) 收集器真的收到東西(否則下面全稱斷言全部空過)
// (b) 區塊裡每一條 li 都被解析到(regex 靜默漏抓一條 ⇒ 那條的 en/ja 永遠不會被檢查)
// (c) 每條都在第二層有正本——正本是「較早歷史改用主題摘要」能接住被擠出去那幾條的前提。
// 🔴 2026-08-30 改判:原本這裡寫「版面上限 8 條由 verify_plus_subscription.mjs 的 CL2 守」——那是
// 空的委派。那支是 Playwright 腳本,不在 package.json、不在 ship-web preflight、不在任何鏈上,
// 「不在出貨鏈上的驗收腳本等於不存在」。實際後果:App 線 build/android-1.5.0-16 把第一層養到 12 條、
// 第二層長出兩份 8/23「追蹤一班車」,一路出到 Android 1.5.0 都沒有任何閘門紅過。所以那兩條搬進這裡
// ——本支已經在解析同樣這兩個區塊,而且它是 ship-web preflight 真的會跑到的地方(CL 那邊原樣保留,
// 當走 DOM 的第二層防線)。
const recentBlock = /<ul class="foot-list foot-recent">([\s\S]*?)<\/ul>/.exec(indexSource)?.[1] || '';
const recentItems = [...recentBlock.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/g)]
  .filter(match => !/class="[^"]*\bgrp\b[^"]*"/.test(match[1])); // li.grp 是「最近更新」標題,不是內容
const changelogMore = indexSource.slice(indexSource.indexOf('<details class="foot-more">'));
const canonIdList = [...changelogMore.slice(0, changelogMore.indexOf('</details>'))
  .matchAll(/<li data-cl="([^"]+)"/g)].map(match => match[1]);
const canonIds = new Set(canonIdList);
const recentTexts = [...recentBlock.matchAll(/<li data-cl-of="[^"]+">[\s\S]*?<span>([^<]+)<\/span><\/li>/g)].map(match => match[1].replace(/&amp;/g, '&'));
// 正向對照:分母自己要有斷言,否則第一層或第二層整個抓不到時,下面三條全稱斷言會一起空過報綠。
if (!recentItems.length || !canonIds.size) {
  fail(`公開更新紀錄收集器空轉：第一層內容 ${recentItems.length} 條、第二層正本 ${canonIds.size} 條（兩者都必須 ≥1，否則下面的檢查是空過的）`);
}
// 覆蓋率具名斷言:每一條 li 都要被上面那條 regex 解析到,漏抓的那條不會有人檢查它的 en/ja。
if (recentTexts.length !== recentItems.length) {
  fail(`公開更新紀錄有 ${recentItems.length} 條內容項目，只解析出 ${recentTexts.length} 條精簡文字（${recentItems.length - recentTexts.length} 條未納入 en/ja 檢查，多半是 li 內部標記變了）`);
}
// 比照 CL1:要被擠出第一層,正本必須已經在第二層——否則那次變更唯一一筆可辨識的對外紀錄會整條消失。
for (const [, attrs, body] of recentItems) {
  const id = /data-cl-of="([^"]+)"/.exec(attrs)?.[1];
  if (!id) fail(`公開更新紀錄有一條沒宣告正本（缺 data-cl-of）：${body.replace(/<[^>]+>/g, '').trim().slice(0, 24)}`);
  else if (!canonIds.has(id)) fail(`公開更新紀錄「${id}」在完整更新歷史裡找不到正本（data-cl-of → data-cl 對不上）`);
}
// 正本 id 不得重複(CL1b)。重複在這支特別隱形:canonIds 是 Set,兩條同 id 會靜默收斂成一條,
// 於是上面那條「正本找得到嗎」照樣綠——但 DOM 的 querySelector 只取得到其中一顆,另一顆是
// 沒人指得到、卻照樣渲染在完整更新歷史裡的死文字(使用者會看到同一件事寫兩遍)。
const dupCanon = [...new Set(canonIdList.filter((id, index) => canonIdList.indexOf(id) !== index))];
if (dupCanon.length) {
  fail(`完整更新歷史有重複的正本 id：${dupCanon.join('、')}（兩條互相蓋掉，對映指到哪一條無法預期，沒被指到的那條是渲染得出來卻沒人維護的死文字）`);
}
// 版面預算 8 條(CL2)。這是 index.html 的 foot-recent 註解自己訂的編排上限,不是量出來的值,
// 所以判準直接綁那個數字;要改預算就連同那段註解一起改。li.grp 標題不計入(recentItems 已濾掉)。
const RECENT_BUDGET = 8;
if (recentItems.length > RECENT_BUDGET) {
  fail(`公開更新紀錄第一層有 ${recentItems.length} 條內容，超出版面預算 ${RECENT_BUDGET} 條（li.grp 標題不算）——要放新的就先擠掉舊的，被擠掉那條的正本已經在完整更新歷史裡`);
}
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
