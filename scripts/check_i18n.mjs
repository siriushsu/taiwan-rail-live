import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dictionarySource = fs.readFileSync(path.join(root, 'i18n/translations.js'), 'utf8');
const contentDictionarySource = fs.readFileSync(path.join(root, 'i18n/content-translations.js'), 'utf8');
const busTransferDictionarySource = fs.readFileSync(path.join(root, 'i18n/bus-transfer-translations.js'), 'utf8');
const busTransferSource = fs.readFileSync(path.join(root, 'bus-transfer-ui.js'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'i18n/stations.json'), 'utf8'));
const specialData = JSON.parse(fs.readFileSync(path.join(root, 'data/tra_special_trains.json'), 'utf8'));
const legalDictionarySource = fs.readFileSync(path.join(root, 'i18n/legal-translations.js'), 'utf8');
const failures = [];

function fail(message) { failures.push(message); }

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(dictionarySource, sandbox, { filename: 'i18n/translations.js' });
vm.runInContext(contentDictionarySource, sandbox, { filename: 'i18n/content-translations.js' });
vm.runInContext(busTransferDictionarySource, sandbox, { filename: 'i18n/bus-transfer-translations.js' });
vm.runInContext(legalDictionarySource, sandbox, { filename: 'i18n/legal-translations.js' });
const messages = sandbox.window.RAIL_I18N_MESSAGES || {};
const languages = ['en', 'ja'];

// ── 同物件重複鍵 ─────────────────────────────────────────────────────────
// JS 物件字面量同名鍵是【後者覆蓋前者】,而且不是錯誤、沒有任何警告。後果不是當下顯示錯,
// 是下一個人要改文案時 grep 先找到被蓋掉的那份,改完完全沒有效果也沒有訊息可查。
// 2026-09-12 實測 i18n/translations.js 有 30 組(16 個唯一鍵,en/ja 各半),其中 20 組兩份
// 的值不同——包含「晚 {n} 分」的前導空白修法被一個無空白的版本蓋掉,英文因此渲染成
// "Western Line5 min late"。上面把字典 vm.runInContext 進來【看不到】這件事:重複鍵在
// 解析階段就被摺疊掉了,求值後的字典永遠是乾淨的。所以只能掃原始碼字面量。
//
// 🔴 只掃 i18n/*.js,不掃 index.html:那是 HTML,裡面的 CSS 區塊會被當成物件字面量,
//    `color:`／`width:` 這種宣告在同一條規則裡重複出現就會變成假陽性(實測 276 個)。
function duplicateKeysIn(source) {
  const readString = (at) => {
    const quote = source[at];
    let cursor = at + 1;
    while (cursor < source.length) {
      if (source[cursor] === '\\') { cursor += 2; continue; }
      if (source[cursor] === quote) break;
      cursor++;
    }
    return cursor + 1;
  };
  // 鍵的偵測必須在「泛用字串分支」之前、且從空白位置往前窺視,否則每個帶引號的鍵
  // 都會先被當成一般字串吃掉,結果永遠掃不到任何鍵(全綠=假綠)。
  const peekKey = (at) => {
    let cursor = at;
    while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
    let key = null, after = cursor;
    if (source[cursor] === '"' || source[cursor] === "'") {
      after = readString(cursor);
      key = source.slice(cursor + 1, after - 1);
    } else if (/[A-Za-z_$]/.test(source[cursor] || '')) {
      let end = cursor;
      while (end < source.length && /[A-Za-z_$0-9]/.test(source[end])) end++;
      key = source.slice(cursor, end); after = end;
    } else return null;
    let colon = after;
    while (colon < source.length && /\s/.test(source[colon])) colon++;
    return source[colon] === ':' ? { key, after: colon + 1 } : null;
  };
  const stack = [], dupes = [];
  let at = 0, line = 1;
  while (at < source.length) {
    const ch = source[at], pair = source.slice(at, at + 2);
    if (ch === '\n') { line++; at++; continue; }
    if (pair === '//') { while (at < source.length && source[at] !== '\n') at++; continue; }
    if (pair === '/*') { at += 2; while (at < source.length && source.slice(at, at + 2) !== '*/') { if (source[at] === '\n') line++; at++; } at += 2; continue; }
    if (stack.length) {
      const hit = peekKey(at);
      if (hit) {
        const top = stack[stack.length - 1];
        if (top.has(hit.key)) dupes.push({ key: hit.key, first: top.get(hit.key), second: line });
        else top.set(hit.key, line);
        at = hit.after; continue;
      }
    }
    if (ch === '"' || ch === "'") { at = readString(at); continue; }
    if (ch === '{') { stack.push(new Map()); at++; continue; }
    if (ch === '}') { stack.pop(); at++; continue; }
    at++;
  }
  return dupes;
}

const dictionaryFiles = [
  ['i18n/translations.js', dictionarySource],
  ['i18n/content-translations.js', contentDictionarySource],
  ['i18n/bus-transfer-translations.js', busTransferDictionarySource],
  ['i18n/legal-translations.js', legalDictionarySource],
  ['i18n/legal-pages.js', fs.readFileSync(path.join(root, 'i18n/legal-pages.js'), 'utf8')],
];
for (const [name, source] of dictionaryFiles) {
  for (const dupe of duplicateKeysIn(source)) {
    fail(`${name} 同一個物件裡「${dupe.key}」重複(L${dupe.first} 與 L${dupe.second})——後者會靜默蓋掉前者,請只留一份`);
  }
}
// 覆蓋率具名斷言。分母【取自磁碟】,不是上面那份清單:拿 scanned === list.length 當判準是假的,
// 從清單刪掉一個檔會讓兩邊一起縮水而永遠相等。這樣寫,新增一個 i18n/*.js 卻忘了納入掃描會當場紅。
const dictionariesOnDisk = fs.readdirSync(path.join(root, 'i18n')).filter(name => name.endsWith('.js')).sort();
const dictionariesScanned = dictionaryFiles.map(([name]) => name.replace('i18n/', '')).sort();
const unscanned = dictionariesOnDisk.filter(name => !dictionariesScanned.includes(name));
if (unscanned.length) fail(`i18n/ 底下這些字典檔沒被重複鍵掃描涵蓋:${unscanned.join('、')}——請加進 check_i18n.mjs 的 dictionaryFiles`);

// 功能模組字典(bus-transfer-translations.js)只准【新增】鍵,不准改寫核心字典(translations.js＋content-translations.js)
// 已有的譯文:它最後載入、Object.assign 進同一份全域字典,而 bus-transfer-ui.js 的 tr() 直接用宿主的 t()
// ⇒ 同一個中文鍵全站只有一個譯文。2026-09-19 實測它把「我上車了」改成 'I’m on the bus'／'乗車しました'
// (火車跟車卡的「我上車了」鈕在英文版因此寫著 on the bus)、把日文「取消」改成「取消」(全站對話框的
// キャンセル鈕一起變),9/3 上線至今沒有任何閘門紅過:上面的重複鍵掃描只看得到同一個物件字面量裡的重複。
// 值完全相同的冗餘不算。公車畫面真的需要不同說法時,換一個中文鍵,不要改寫共用鍵。
const isolatedMessages = sources => {
  const box = { window: { RAIL_I18N_MESSAGES: { en: {}, ja: {} } } };
  vm.createContext(box);
  for (const source of sources) vm.runInContext(source, box);
  return box.window.RAIL_I18N_MESSAGES;
};
const coreMessages = isolatedMessages([dictionarySource, contentDictionarySource]);
const busMessages = isolatedMessages([busTransferDictionarySource]);
if (!Object.keys(busMessages.en || {}).length) fail('公車轉乘字典單獨求值後是空的——下面的「不得改寫核心譯文」檢查會空過');
for (const lang of languages) for (const [key, value] of Object.entries(busMessages[lang] || {})) {
  if (!Object.prototype.hasOwnProperty.call(coreMessages[lang] || {}, key)) continue;
  if (JSON.stringify(coreMessages[lang][key]) !== JSON.stringify(value)) {
    fail(`bus-transfer-translations.js 改寫了核心字典的 ${lang}「${key}」：${JSON.stringify(coreMessages[lang][key])} → ${JSON.stringify(value)}（它最後載入，全站同一個鍵都會被蓋掉）`);
  }
}

for (const lang of languages) {
  if (!messages[lang] || typeof messages[lang] !== 'object') fail(`${lang} 字典不存在`);
}

const keySets = Object.fromEntries(languages.map(lang => [lang, new Set(Object.keys(messages[lang] || {}))]));
for (const key of keySets.en || []) if (!keySets.ja.has(key)) fail(`ja 缺少 en 已有的 key：${key}`);
for (const key of keySets.ja || []) if (!keySets.en.has(key)) fail(`en 缺少 ja 已有的 key：${key}`);

// runtime 直接呼叫 t('繁中原文') 的 key 必須兩種外語都有；動態變數 key 另外由核心清單守門。
const discoverySource = fs.readFileSync(path.join(root, 'rail-discovery.js'), 'utf8');
const discoveryBox = { window: {} }; vm.runInNewContext(discoverySource, discoveryBox);
const garageSource = fs.readFileSync(path.join(root, 'train-garage.js'), 'utf8');
const literalKeys = [...indexSource.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)].map(match => match[2]);
literalKeys.push(...[...busTransferSource.matchAll(/\btr\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)].map(match => match[2]));
literalKeys.push(...[...discoverySource.matchAll(/\b(?:t|tx)\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)].map(m => m[2]));
literalKeys.push(...discoveryBox.window.RailDiscovery.scenes.flatMap(s => [s.title, s.note]));
// 立體設定與編組說明同樣是首頁文案，不能因為移到獨立模組而漏查。
literalKeys.push(...[...garageSource.matchAll(/\btr\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)].map(m => m[2]));
literalKeys.push('完乘 {count} 趟','累積旅程 {count} 公里','收集 {count} 座車站','取得 {count} 枚支線章');
const rail3dSource = fs.readFileSync(path.join(root, 'rail-3d.js'), 'utf8');
literalKeys.push(...[...rail3dSource.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)].map(m => m[2]));
literalKeys.push('其他設定','觀看設定','關閉觀看設定','觀看設定分類','觀看','視角','地圖','列車','標示','導覽','畫面');
const guideSource = fs.readFileSync(path.join(root, 'rail-3d/integration/place-guide.js'), 'utf8');
literalKeys.push(...[...guideSource.matchAll(/\btranslate\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)].map(m => m[2]));
literalKeys.push('車站', '地標', '取景資料尚未載入', '暫時無法前往，請再試一次');
for (const file of ['station-catalog.js', 'landmark-catalog.js']) {
  const source = fs.readFileSync(path.join(root, 'rail-3d', file), 'utf8');
  literalKeys.push(...[...source.matchAll(/"name":\s*"([^"]+)"/g)].map(m => m[1]));
}
const rail3dLabels = rail3dSource.match(/const labels=(\{[^;]+\});/);
if (rail3dLabels) literalKeys.push(...Object.values(vm.runInNewContext('(' + rail3dLabels[1] + ')')).flat());
literalKeys.push('{n} 分節 · 標準編組', '{n} 節 · 標準編組');
const platformSource = fs.readFileSync(path.join(root, 'rail-platform-ui.js'), 'utf8');
literalKeys.push(...[...platformSource.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)].map(m => m[2]));
const platformLabels = platformSource.match(/const labels=(\{[^;]+\});/);
if (platformLabels) literalKeys.push(...Object.values(vm.runInNewContext('(' + platformLabels[1] + ')')));
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

// data/thsr_fare.json 的官方代碼名稱(TicketType/FareClass/CabinClass)經 thsrFareCodeName() 動態
// 查表後才 t(),同樣是【資料】不是 index.html 字面 t('…'),上面的 runtime key 掃描看不到——
// 理由與作法都同 music.json 那條。
const thsrFareData = JSON.parse(fs.readFileSync(path.join(root, 'data/thsr_fare.json'), 'utf8'));
const thsrFareCodeKeys = [
  ...Object.values(thsrFareData.codes.ticketType),
  ...Object.values(thsrFareData.codes.fareClass),
  ...Object.values(thsrFareData.codes.cabinClass),
];
// 分母自己也要有斷言:欄位改名或代碼表清空時,這條檢查會靜默縮成 0 個而不是報錯(同 music.json 那條的理由)。
if (thsrFareCodeKeys.length !== 8 + 9 + 3) fail(`高鐵票價代碼字串取到 ${thsrFareCodeKeys.length} 個,不等於官方代碼表筆數(8+9+3),欄位名可能改了`);
for (const key of new Set(thsrFareCodeKeys)) {
  for (const lang of languages) if (!keySets[lang]?.has(key)) fail(`${lang} 缺少高鐵票價代碼字串：${key}`);
}

// 座位三態(THSR_SEAT_LABEL)與票價摘要三車廂短稱(priceRow 的 label 參數)都是 index.html 裡的
// JS 物件/字面值,經變數查表後才 t(id)——同樣不是字面 t('…'),上面的 runtime key 掃描看不到,
// 用同一套「補成第一級來源」處理,不必為此另外解析 index.html 的物件定義。
const thsrSeatBoardKeys = ['有位', '剩不多', '售完', '標準座', '商務座', '自由座'];
for (const key of thsrSeatBoardKeys) {
  for (const lang of languages) if (!keySets[lang]?.has(key)) fail(`${lang} 缺少高鐵座位／票價短稱字串：${key}`);
}

const coreStaticKeys = [
  '歡迎搭乘', '軌島怎麼玩', '上面', '全／台／高／捷', '選要看哪個系統',
  '點', '列車', '＝鏡頭跟著它跑，陪到終點蓋完乘章', '車站', '＝看接下來的班次與倒數',
  '暫停／播放（空白鍵）', '模擬時刻：左右拖曳調整，方向鍵每次 1 分鐘',
  '更多設定：外觀、軌道與路線、平交道、站介紹、方向箭頭、省電模式',
  '語言', '選擇介面語言', '隱私權政策', '使用條款',
  '列車位置、誤點資訊與系統覆蓋現在免費提供——通行證不影響準確度。',
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
// 全形標點也一樣：2026-09-19 實測英文畫面有「Future（including Future Dining）」「Ko-fi（credit card / PayPal）」。
// 「・」是全站三語共用的分隔符、「　」是更新列刻意的版本間隔，這兩個不算。
function scanEnglishCjk(value, label) {
  if (typeof value === 'string') {
    if (/[\u3400-\u9fff]/.test(value)) fail(`英文翻譯仍含中文：${label} = ${value}`);
    else if (/[（）「」『』【】、。，：；！？]/.test(value)) fail(`英文翻譯含全形標點（英文要用半形 ( ) , : ; ! ? 與 “ ”）：${label} = ${value}`);
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
  namedTrains: ['name', 'story', 'tags', 'mapLabel'],
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
for (const achievement of ACHIEVEMENTS) for (const source of [achievement.name, achievement.desc, achievement.how].filter(Boolean)) for (const lang of languages) {
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
    helpSources.push(section.nm, section.one, ...(section.steps || []), section.tip, ...(section.widgets || []).flatMap(w => [w.name, w.sizes]));
    // 說明卡圖示也是真正顯示的文字；HTML 圖示只取出其中的可見中文字。
    if (section.ic) helpSources.push(...String(section.ic).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean));
    if (section.tipDesktop) helpSources.push(...String(section.tipDesktop).split(/<\/?b>/).filter(Boolean));
  }
}
for (const source of new Set(helpSources.filter(value => value && /[\u3400-\u9fff]/.test(value)))) for (const lang of languages) {
  if (!keySets[lang]?.has(source)) fail(`使用說明缺少 ${lang}：${source}`);
}

// 手動策展公告(CURATED_NOTICES)的標題／內文／系統名是【資料】,經 renderAlertBanner／renderAlertDetail
// 的 t(a.title)／t(a.desc)／t(a.sysLabel) 查表——不是字面 t('…'),上面的 runtime key 掃描看不到。
// 2026-09-19 實測:8/29 上架的三則全都沒有 en/ja,英文首頁的公告橫幅標題就是中文(verify_i18n 的
// desktopCore 從那時起就紅)。只守「還會顯示」的那幾則(until ≥ 今天,台北時間,同 curatedNoticeEntries
// 的日期窗):過期的永遠不再顯示,替它補譯是白工;時間經過只會讓這條變寬鬆,不會讓已綠的出貨轉紅。
// 形狀斷言對每一則都做(含過期):欄位改名時 [title, desc] 會變成 undefined 而被略過、
// until 不是日期字串時 >= 比較恆 false,兩種都會讓下面那條全稱斷言無聲空過。
const { CURATED_NOTICES = [] } = evaluateConstBlock('const CURATED_NOTICES =', 'function curatedNoticeEntries', ['CURATED_NOTICES']);
const taipeiToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
for (const notice of CURATED_NOTICES) {
  const shapeOk = ['title', 'desc', 'sysLabel'].every(field => typeof notice[field] === 'string' && notice[field])
    && [notice.from, notice.until].every(day => /^\d{4}-\d{2}-\d{2}$/.test(day || ''));
  if (!shapeOk) { fail(`手動公告形狀不對（需 title／desc／sysLabel 字串與 from／until 日期）：${JSON.stringify(notice).slice(0, 120)}`); continue; }
  if (notice.until < taipeiToday) continue;
  for (const source of [notice.title, notice.desc, notice.sysLabel]) for (const lang of languages) {
    if (!keySets[lang]?.has(source)) fail(`手動公告（${notice.sys}，顯示到 ${notice.until}）缺少 ${lang}：${source}`);
  }
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
// 🔴 第二層「完整更新歷史」對 en/ja 【不是】翻譯 index.html 那 332 條正本——i18nRenderChangelog()
// 對外語一律 details.replaceChildren(),整塊改用 RAIL_I18N_CHANGELOG 的主題摘要重建(實測換手發生在
// 開頁後約 0.43 秒)。所以正本那 332 條的中文【永遠不會】出現在外語畫面上,不可以照第一層的作法去
// 要求它們有 en/ja key:那會讓 271 條已發佈的歷史條目當場轉紅,而且紅的是一個不存在的問題。
// 外語使用者真正看得到的是下面這份摘要 ⇒ 閘門就要守這一份。原本只驗「陣列在、每組有 name 與 items」,
// 是純結構檢查:摘要裡塞中文、或 ja 少掉一整組,兩種都照樣全綠。
for (const lang of languages) {
  const summaries = sandbox.window.RAIL_I18N_CHANGELOG?.[lang];
  if (!Array.isArray(summaries) || !summaries.length || summaries.some(group => !group.name || !group.items?.length)) {
    fail(`${lang} 缺少歷史更新主題摘要`);
  }
}
// 摘要不在 messages.en 底下,檔頭那次 scanEnglishCjk(messages.en) 掃不到它 ⇒ 英文摘要沒補譯、
// 直接留中文原句貼進去,是外語畫面上真的看得到中文的唯一途徑,而目前沒有任何守門人。
scanEnglishCjk(sandbox.window.RAIL_I18N_CHANGELOG?.en, 'changelog.en');
// 兩語是同一份摘要的兩個版本。少掉的那一組不會有任何錯誤訊息——ja 使用者只是靜靜地少看到一段歷史,
// 跟第一層「被擠出去就消失」是同一類無聲缺損,所以組數與每組條目數都要對齊。
const summaryShape = lang => (sandbox.window.RAIL_I18N_CHANGELOG?.[lang] || []).map(group => group.items?.length ?? 0);
const enShape = summaryShape('en'), jaShape = summaryShape('ja');
if (enShape.join(',') !== jaShape.join(',')) {
  fail(`歷史更新主題摘要的 en 與 ja 結構對不上：en ${enShape.length} 組（各 ${enShape.join('／')} 條）、ja ${jaShape.length} 組（各 ${jaShape.join('／')} 條）——同一份摘要的兩個版本,少掉的那組在該語言的畫面上會無聲消失`);
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

// ── inline <script> 的詞法掃描(下面兩道 sink 檢查共用) ──────────────────────────────────
// 2026-09-19 審查 ecaad67b 實測:舊版逐行找 `/*` 當區塊註解開頭,卻不認得 `//` 註解與字串——註解裡寫一句
// 「data/*.json」「/api/*」「i18n/*.js」就開出一段幽靈區塊註解,一路吃到下一個真的 `*/`。五段合計約 6400 行
// (21.8% 的 script)從來沒被掃過,懸賞板兩則 GPS 提示的裸中文就藏在裡面。另一個洞是「整行只要出現 t( 就整行
// 豁免」:`showToast(t('甲') + '乙')` 的「乙」照樣直接上畫面。所以改成真正的詞法掃描,豁免只給到字面值層級。
// jsLex 認得 '…' "…" `…${…}…`(可巢狀)、/正則/、// 與 /* */,輸出兩份與原文等長、換行位置不變的文字:
//   code:註解換成空白;mask:再把字面值內容換成 _ ——在 mask 上配對括號、找 sink 不會被字串或註解騙,
//   而且位置與行號可以直接對回原檔。零依賴,下面有三道自我檢查(掃描器自己錯了要紅,不是默默少掃)。
function jsLex(src) {
  const n = src.length;
  const code = src.split(''), mask = src.split('');
  const literals = [], comments = [];
  const KEYWORDS_BEFORE_EXPRESSION = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
  let last = null;        // 上一個有意義的 token:決定 '/' 是除號還是正則開頭
  let depth = 0;          // 大括號深度
  const templateStack = []; // 樣板字串的 ${ 開在哪個大括號深度
  const blank = (chars, from, to, ch) => { for (let k = from; k < to; k++) if (src[k] !== '\n') chars[k] = ch; };
  const regexAllowed = () => {
    if (!last) return true;
    if (last.type === 'id') return KEYWORDS_BEFORE_EXPRESSION.has(last.value);
    if (last.type === 'punct') return last.value !== ')' && last.value !== ']';
    return false; // 數字/字串/樣板/正則之後的 '/' 是除號
  };
  // 讀樣板字串的一段文字,停在結尾的 ` 或 ${
  const readQuasi = from => {
    let j = from;
    while (j < n) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '`') { literals.push({ start: from, end: j }); blank(mask, from, j, '_'); return { end: j + 1, open: false }; }
      if (c === '$' && src[j + 1] === '{') { literals.push({ start: from, end: j }); blank(mask, from, j, '_'); return { end: j + 2, open: true }; }
      j++;
    }
    literals.push({ start: from, end: n }); blank(mask, from, n, '_');
    return { end: n, open: false };
  };
  let i = 0;
  while (i < n) {
    const c = src[i], next = src[i + 1];
    if (c === '/' && (next === '/' || next === '*')) {
      let j;
      if (next === '/') { j = i; while (j < n && src[j] !== '\n') j++; }
      else { j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; }
      comments.push({ start: i, end: j, text: src.slice(i, j) });
      blank(code, i, j, ' '); blank(mask, i, j, ' ');
      i = j; continue;
    }
    if (c === '\'' || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      literals.push({ start: i + 1, end: j }); blank(mask, i + 1, j, '_');
      i = j + 1; last = { type: 'str' }; continue;
    }
    if (c === '`' || (c === '}' && templateStack.length && templateStack[templateStack.length - 1] === depth)) {
      if (c === '}') templateStack.pop();
      const quasi = readQuasi(i + 1);
      if (quasi.open) { templateStack.push(depth); last = { type: 'punct', value: '${' }; }
      else last = { type: 'tmpl' };
      i = quasi.end; continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1, inClass = false, closed = false;
      while (j < n && src[j] !== '\n') {
        const ch = src[j];
        if (ch === '\\') { j += 2; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) { closed = true; break; }
        j++;
      }
      if (closed) {
        let k = j + 1; while (k < n && /[A-Za-z]/.test(src[k])) k++;
        blank(mask, i + 1, j, '_');
        i = k; last = { type: 'regex' }; continue;
      }
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1; while (j < n && /[\w$]/.test(src[j])) j++;
      last = { type: 'id', value: src.slice(i, j) }; i = j; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(next || ''))) {
      let j = i + 1;
      while (j < n && (/[\w.]/.test(src[j]) || ((src[j] === '+' || src[j] === '-') && /[eE]/.test(src[j - 1]) && !/^0[xX]/.test(src.slice(i, j))))) j++;
      last = { type: 'num' }; i = j; continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    last = { type: 'punct', value: c };
    i++;
  }
  return { code: code.join(''), mask: mask.join(''), literals, comments };
}
const HAN = /[㐀-鿿]/;
const indexLineStarts = [0];
for (let at = indexSource.indexOf('\n'); at >= 0; at = indexSource.indexOf('\n', at + 1)) indexLineStarts.push(at + 1);
function indexLineAt(offset) { // offset 是 indexSource 裡的位置,回 1 起算的行號
  let lo = 0, hi = indexLineStarts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (indexLineStarts[mid] <= offset) lo = mid; else hi = mid - 1; }
  return lo + 1;
}
// 字面值「會被翻譯」的位置:t()/tr()/tx() 與站名／路線／車種／方向查表函式的原文參數(i18nCatalogValue 是第 3 個)。
// 只有這個參數本身算——t('{n} 站', { n: '甲' }) 裡的「甲」是插值,照樣原字上畫面。
const TRANSLATED_ARGUMENT = new Map([
  ['t', 0], ['tr', 0], ['tx', 0], ['stationName', 0], ['routeName', 0], ['trainTypeName', 0], ['stationDirection', 0], ['i18nCatalogValue', 2],
]);
function analyzeScript(src, base = 0, lineAt = null) {
  const lex = jsLex(src), { mask } = lex;
  const match = new Int32Array(src.length).fill(-1);
  const stack = [];
  for (let i = 0; i < mask.length; i++) {
    const c = mask[i];
    if (c === '(' || c === '[' || c === '{') stack.push(i);
    else if (c === ')' || c === ']' || c === '}') { const open = stack.pop(); if (open !== undefined) { match[open] = i; match[i] = open; } }
  }
  const opens = [];
  for (let i = 0; i < mask.length; i++) if (match[i] > i) opens.push(i);
  const line = lineAt ? pos => lineAt(base + pos) : pos => src.slice(0, pos).split('\n').length;
  const hanLiterals = lex.literals.filter(l => HAN.test(src.slice(l.start, l.end)));
  // 豁免標記:// i18n-literal-ok: 理由 ——寫在字面值那一行或 sink 起點那一行。沒寫理由的標記不算數,另外報錯。
  const tags = new Map();
  for (const comment of lex.comments) {
    const tag = /i18n-literal-ok\b[:：]?\s*(.*?)\s*(?:\*\/)?$/.exec(comment.text.split('\n')[0]);
    if (tag) tags.set(line(comment.start), tag[1]);
  }
  return { src, base, lex, mask, match, opens, line, hanLiterals, tags };
}
function nameBefore(mask, pos) { // `foo.bar (` → { name: 'bar', object: 'foo' }
  let j = pos - 1; while (j >= 0 && /\s/.test(mask[j])) j--;
  const end = j + 1; while (j >= 0 && /[\w$]/.test(mask[j])) j--;
  const name = mask.slice(j + 1, end);
  let k = j; while (k >= 0 && /\s/.test(mask[k])) k--;
  if (mask[k] !== '.') return { name, object: null };
  let q = k - 1; while (q >= 0 && /\s/.test(mask[q])) q--;
  const objectEnd = q + 1; while (q >= 0 && /[\w$]/.test(mask[q])) q--;
  return { name, object: mask.slice(q + 1, objectEnd) };
}
function argumentIndexAt(script, open, pos) { // pos 落在 open 這組括號的第幾個參數
  const { mask, match } = script;
  let index = 0;
  for (let i = open + 1; i < pos; i++) {
    const c = mask[i];
    if (c === '(' || c === '[' || c === '{') { if (match[i] > i && match[i] < pos) { i = match[i]; continue; } break; }
    if (c === ',') index++;
  }
  return index;
}
// 這個字面值為什麼可以是中文:'translated'(在翻譯參數裡)、'console'(只進開發者主控台),否則 null。
// floor 之前的括號不看(sink 本身或函式本體的外面)。
function literalExemption(script, literal, floor) {
  const { opens, match, mask } = script;
  let lo = 0, hi = opens.length - 1, k = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (opens[mid] < literal.start) { k = mid; lo = mid + 1; } else hi = mid - 1; }
  for (; k >= 0 && opens[k] > floor; k--) {
    const open = opens[k];
    if (match[open] < literal.end || mask[open] !== '(') continue;
    const { name, object } = nameBefore(mask, open);
    if ((object === null || object === '__i18n') && TRANSLATED_ARGUMENT.has(name)
      && argumentIndexAt(script, open, literal.start) === TRANSLATED_ARGUMENT.get(name)) return 'translated';
    if (object === 'console') return 'console';
  }
  return null;
}
// sink 共 14 種:4 個對話框/提示呼叫、setAttribute 的四個可見屬性(alt 是圖片替代文字)、8 個屬性右值(含 += 累加;document.title 就是 .title)、
// insertAdjacentHTML。回傳每一個「流進 sink、沒被翻譯」的中文字面值。
function findSinkLiterals(script) {
  const { mask, match, src, lex } = script;
  const found = [], sites = { call: 0, attribute: 0, property: 0, html: 0 };
  const collect = (kind, sinkAt, from, to) => {
    for (const literal of script.hanLiterals) {
      if (literal.start < from || literal.end > to || literalExemption(script, literal, sinkAt)) continue;
      found.push({ kind, literal, text: src.slice(literal.start, literal.end), line: script.line(literal.start), sinkLine: script.line(sinkAt) });
    }
  };
  for (const m of mask.matchAll(/\b(showToast|confirm|alert|prompt)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    if (match[open] < 0 || /\bfunction\s*$/.test(mask.slice(Math.max(0, m.index - 20), m.index))) continue;
    sites.call++; collect(m[1] + '()', m.index, open + 1, match[open]);
  }
  for (const m of mask.matchAll(/\.setAttribute\s*\(/g)) {
    const open = m.index + m[0].length - 1, close = match[open];
    if (close < 0) continue;
    const name = lex.literals.find(l => l.start > open && l.start < close);
    if (!name || !/^\s*['"]$/.test(mask.slice(open + 1, name.start))) continue;
    const attribute = src.slice(name.start, name.end);
    if (!['title', 'aria-label', 'placeholder', 'alt'].includes(attribute)) continue;
    let comma = name.end + 1; while (comma < close && mask[comma] !== ',') comma++;
    sites.attribute++; collect(`setAttribute('${attribute}')`, m.index, comma + 1, close);
  }
  // 屬性右值的結尾:同層的 ; 或 ,、跳出外層括號,或換行且上下兩行都不像接續(運算子結尾/開頭)。
  const statementEnd = from => {
    for (let i = from; i < mask.length; i++) {
      const c = mask[i];
      if (c === '(' || c === '[' || c === '{') { if (match[i] > i) { i = match[i]; continue; } return i; }
      if (c === ')' || c === ']' || c === '}' || c === ';' || c === ',') return i;
      if (c !== '\n') continue;
      let p = i - 1; while (p >= from && /[ \t\r]/.test(mask[p])) p--;
      if (p < from) continue; // 右值從下一行才開始
      let q = i + 1; while (q < mask.length && /\s/.test(mask[q])) q++;
      if (/[+\-*/%=&|?:,(\[{.<>!~^]/.test(mask[p]) || /[+\-*%&|?:.]/.test(mask[q])) continue;
      return i;
    }
    return mask.length;
  };
  for (const m of mask.matchAll(/\.(textContent|innerText|innerHTML|outerHTML|title|placeholder|ariaLabel|alt)\s*(\+?=)(?!=)/g)) {
    const from = m.index + m[0].length;
    sites[/HTML$/.test(m[1]) ? 'html' : 'property']++;
    collect(`.${m[1]} ${m[2]}`, m.index, from, statementEnd(from));
  }
  for (const m of mask.matchAll(/\.insertAdjacentHTML\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    if (match[open] < 0) continue;
    sites.html++; collect('insertAdjacentHTML()', m.index, open + 1, match[open]);
  }
  return { found, sites };
}
// 豁免判定(兩道檢查共用):標記在字面值那行或 sink 起點那行;沒寫理由的標記不豁免,另報一條。
const badTags = new Set(), usedTagLines = new Set();
function tagExempts(script, lines) {
  for (const line of lines) {
    if (!script.tags.has(line)) continue;
    if (script.tags.get(line)) { usedTagLines.add(line); return true; }
    badTags.add(line);
  }
  return false;
}

// ── 掃描器自我檢查一:合成夾具(該紅的要紅、該放的要放) ──────────────────────────────────
// 每一種騙過舊版的寫法各一行:註解裡的 data/*.json、正則裡的引號、樣板字串 ${} 巢狀、t() 的插值參數、
// 同一行有 t( 但另一段沒包、註解裡的 sink。兩個方向都驗——少抓(漏網)與多抓(誤報)都算掃描器壞了。
{
  const fixture = analyzeScript([
    '// 路徑 data/*.json 與 /api/* 只是註解文字,不可以開出區塊註解',
    "const re = /['\"`]/g, half = 1 / 2; showToast('夾具甲');",
    "el.innerHTML = `<b>${t('已翻譯')}</b>${list.map(x => `<i>${x}</i>夾具乙`).join('')}`;",
    "el.setAttribute('aria-label', cond ? t('已翻譯') : '夾具丙');",
    "document.title = '夾具丁';",
    "showToast(t('{n} 站', { n: '夾具戊' }) + '夾具己');",
    "showToast(t('已翻譯')); /* 註解裡的 showToast('不是夾具') */",
    "el.textContent = t(x ? '已翻譯' : '也已翻譯');",
    "el.title = cond",
    "  ? '夾具庚'",
    "  : window.__i18n.t('已翻譯');",
    "showToast((console.warn('只進主控台'), t('已翻譯')));",
    "el.placeholder = '合法例外'; // i18n-literal-ok: 夾具用的合法例外",
    "el.title = '夾具辛'; // i18n-literal-ok",
  ].join('\n'));
  const got = findSinkLiterals(fixture).found.filter(f => !tagExempts(fixture, [f.line, f.sinkLine])).map(f => f.text).sort().join('、');
  const want = ['夾具甲', '</i>夾具乙', '夾具丙', '夾具丁', '夾具戊', '夾具己', '夾具庚', '夾具辛'].sort().join('、');
  if (got !== want) fail(`sink 掃描器自我測試失敗：夾具應抓到「${want}」，實際抓到「${got}」——掃描器壞了，下面的全文掃描結果不可信`);
  badTags.clear(); usedTagLines.clear();
}

// ── 核心動態 renderer:DOM 寫入那一行的中文字面值要在 t() 裡 ──────────────────────────────
// 原本逐行比對、而且整行只要有 t( 就整行放行;現在逐個字面值判斷,只有在 t() 翻譯參數裡的那一個才放行。
const scriptBlocks = [...indexSource.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(block => !/application\/ld\+json/.test(block[1])); // 結構化資料是 JSON,不是程式
if (!scriptBlocks.length) fail('sink 全文掃描找不到任何 inline <script> 區塊——掃描空轉');
const scripts = scriptBlocks.map(block => analyzeScript(block[2], block.index + block[0].length - block[2].length - '</script>'.length, indexLineAt));
// ── 掃描器自我檢查二、三:對真檔 ──────────────────────────────────────────────────────
// 二、mask 裡不准剩任何中文:中文只會出現在字串/樣板/註解裡,剩下來就代表某個 '/' 被誤判(除號當正則或反過來),
//     從那裡起的字面值邊界全錯。三、mask 要跟原文一樣能被解析:字面值邊界認錯,把內容換成 _ 幾乎一定會解析失敗。
for (const script of scripts) {
  const stray = HAN.exec(script.mask);
  if (stray) fail(`詞法掃描器在 index.html 第 ${script.line(stray.index)} 行把中文當成程式碼——掃描器認錯了字串或正則的邊界，sink 掃描結果不可信`);
  let parses = true;
  try { new vm.Script(script.src); } catch { parses = false; }
  if (parses) {
    try { new vm.Script(script.mask); } catch (error) { fail(`詞法掃描器產生的 mask 無法解析（${error.message}）——字面值邊界認錯了，sink 掃描結果不可信`); }
  }
}
function findFunction(name) {
  for (const script of scripts) {
    const hit = new RegExp(`\\bfunction\\s+${name}\\s*\\(`).exec(script.mask);
    if (!hit) continue;
    const params = hit.index + hit[0].length - 1;
    let body = script.match[params] + 1;
    while (body < script.mask.length && script.mask[body] !== '{') body++;
    if (script.match[params] < 0 || script.match[body] < 0) return null;
    return { script, from: body, to: script.match[body] };
  }
  return null;
}
const dynamicRenderers = [
  'renderSystemsBar', 'renderFreqBoard', 'renderBoard', 'updateFollowPanel',
  'renderAlertBanner', 'renderAlertDetail', 'plusRender', 'onLocateFail',
  'renderNearbyStations', 'renderPinCard', 'renderRidePanel', 'renderPassport',
  'stationIntroText', 'renderTrainCard', 'buildStamps', 'buildAchv', 'punctualRow',
  'renderExplorePanel', 'renderNamedIntro', 'renderSearchDrop', 'renderHelp',
  'takeoutSyncConfirm', 'takeoutRenderPreview', 'takeoutStartManual', 'accountRender', 'accountBtnSlot',
  'setupPlusEntry', 'plusEntrySync',
  'myTrainRow', 'myTrainSection', 'renderFavs', 'renderFavPanel', 'todayRow', 'renderTodayEvents', 'renderTodayPanel',
  'renderFollowEvents', 'renderDelayRow', 'renderDelayHist', 'eventRowsHtml', 'eventSecHtml',
  'announceCollections', 'doCheckin', 'startRiding', 'finishRiding', 'updateRideBtn',
  'renderTripSharePanel', 'renderTripBanner', 'metroWaitOpenPicker',
  'traWaitOpenPicker', 'renderCrossingCard', 'renderSugarCard', 'renderBountyBoard', 'showBountyBrief',
];
const rendererWriteLine = /(innerHTML|textContent|showToast|\.title|aria-label|placeholder)/;
let literalOkCount = 0;
for (const name of dynamicRenderers) {
  const fn = findFunction(name);
  if (!fn) { fail(`找不到核心 renderer：${name}`); continue; }
  const { script } = fn;
  for (const literal of script.hanLiterals) {
    if (literal.start < fn.from || literal.end > fn.to) continue;
    const lineStart = script.src.lastIndexOf('\n', literal.start) + 1;
    const lineEnd = script.src.indexOf('\n', literal.start);
    if (!rendererWriteLine.test(script.lex.code.slice(lineStart, lineEnd < 0 ? undefined : lineEnd))) continue;
    if (literalExemption(script, literal, fn.from)) continue;
    const line = script.line(literal.start);
    if (tagExempts(script, [line])) { literalOkCount++; continue; }
    fail(`${name}（index.html 第 ${line} 行）仍有未包 t() 的核心 DOM 中文：「${script.src.slice(literal.start, literal.end)}」`);
  }
}

// ── 任務項目5:整個 inline <script> 裡「裸中文直接流入」互動/DOM sink ──────────────────────
// 上面的 dynamicRenderers 只掃固定的具名函式清單;旗標關閉的功能(懸賞板 BOUNTY_ENABLED、收集地圖
// COLLECT_MAP_ENABLED、各種 demo 模式)平常不會被那份白名單掃到——旗標關掉不代表可以中文,旗標打開的那天
// 不能突然變成沒翻譯,所以需要一份不管中文出現在哪個函式裡、只要流進 sink 就算的全文掃描。
// 範圍是 sink 的整個參數/右值(跨行也算,例如 innerHTML = 一整段 map 出來的樣板),不是 sink 所在的那一行。
// 只掃 index.html 自己的 inline <script>,不含 src="..." 外部檔(那些檔案的 runtime key 覆蓋率由上面 literalKeys 負責)。
// 合法例外(只在繁中顯示、外語由別處整段換掉之類)在字面值或 sink 那一行加 `// i18n-literal-ok: 理由`。
const sinkSites = { call: 0, attribute: 0, property: 0, html: 0 };
for (const script of scripts) {
  const { found, sites } = findSinkLiterals(script);
  for (const kind of Object.keys(sinkSites)) sinkSites[kind] += sites[kind];
  for (const hit of found) {
    if (tagExempts(script, [hit.line, hit.sinkLine])) { literalOkCount++; continue; }
    fail(`index.html 第 ${hit.line} 行（script 全文掃描，sink ${hit.kind} 起於第 ${hit.sinkLine} 行）裸中文直接流入 sink，沒在 t() 的翻譯參數裡也沒有 i18n-literal-ok 豁免：「${hit.text}」`);
  }
}
// 分母具名斷言:任一類 sink 一個都沒找到,多半是 regex 或詞法掃描壞了,上面那條全稱斷言是空過的。
for (const [kind, count] of Object.entries(sinkSites)) if (!count) fail(`sink 全文掃描在 index.html 找不到任何 ${kind} 類 sink——掃描空轉`);
for (const line of badTags) fail(`index.html 第 ${line} 行的 i18n-literal-ok 沒寫理由——格式是「// i18n-literal-ok: 為什麼這段中文可以不翻」`);
console.log(`sink 全文掃描：${Object.entries(sinkSites).map(([kind, count]) => `${kind} ${count}`).join('、')} 處 sink；${literalOkCount} 個中文字面值由 ${usedTagLines.size} 行 i18n-literal-ok 標記豁免（一行標記可以涵蓋同一行的好幾個字面值）。`);

// ── 靜態 HTML:<body> 裡寫死的中文要翻得到 ──────────────────────────────────────────
// 上面兩道 sink 檢查只看 <script>。寫死在 HTML 裡的字靠 i18nTranslateTree 換語言,而它只認「整段文字
// (去頭尾空白)剛好是字典鍵」或 I18N_TEXT_PATTERNS 的樣板句——對不上就原樣留中文,不會報錯。
// 這裡照翻譯器的規則逐段對字典:文字節點,以及它會翻的屬性(index.html 的 I18N_TREE_ATTRS);
// 其他屬性寫中文翻譯器根本不看,一律紅(data-* 是給程式讀的,不算)。<script>/<style>/註解當成節點邊界。
// 整段排除兩種:完整更新歷史(.foot-more:外語由 i18nRenderChangelog 整段換成主題摘要,摘要上面另有檢查;
// 第一層「最近更新」data-cl-of 那幾條照樣要有字典鍵,所以照常檢查)、
// 語言自稱(data-lang:「繁中／日本語」本來就不翻)。排除的元素必須用自己的結束標籤收尾,否則排除範圍會
// 一路吞掉後面的內容(分母無聲縮水),那也算紅。其餘對不上字典的只能進下面的豁免清單並寫理由;
// 清單裡的字在 HTML 找不到了(或已經有譯文)也紅——豁免不准過期還掛著。
const STATIC_HTML_EXEMPT = {
  recRow: { texts: ['已覆蓋・', '點已鎖定'], why: '錄製畫面 #recordScreen 開機時隱藏，錄製一開始 renderRecordScreen 就用 t() 整列覆寫，這兩段只是佔位' },
  notifyRepeatDays: { texts: ['一', '二', '三', '四', '五', '六', '日'], why: 'renderLocalReminderDraft 依介面語言用 Intl 重寫七顆星期鈕，HTML 裡的字只是沒有腳本時的退路' },
};
{
  const treeAttrsSource = /const I18N_TREE_ATTRS = (\[[^\]]*\]);/.exec(indexSource)?.[1];
  const patternsSource = /const I18N_TEXT_PATTERNS = (\[[\s\S]*?\n\]);/.exec(indexSource)?.[1];
  const treeAttrs = treeAttrsSource ? vm.runInNewContext(treeAttrsSource) : [];
  const textPatterns = patternsSource ? vm.runInNewContext(patternsSource) : [];
  if (!treeAttrs.length) fail('index.html 找不到 const I18N_TREE_ATTRS = [...]——靜態 HTML 檢查不知道翻譯器會翻哪些屬性');
  if (!textPatterns.length) fail('index.html 找不到 const I18N_TEXT_PATTERNS = [...]——靜態 HTML 檢查不知道翻譯器認得哪些樣板句');
  // 遮掉 <script>/<style>/註解的內容但保留位置(行號才對得上),頭尾留 <! > 讓切分器當成節點邊界。
  const masked = indexSource.replace(/<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->/gi,
    block => '<!' + block.slice(2, -1).replace(/[^\n]/g, ' ') + '>');
  const bodyFrom = masked.search(/<body\b/i), bodyTo = masked.lastIndexOf('</body>');
  const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: String.fromCharCode(160) };
  const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e) => e[0] === '#'
    ? String.fromCodePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    : NAMED_ENTITIES[e.toLowerCase()] ?? whole);
  const translatable = text => languages.every(lang => keySets[lang].has(text))
    || textPatterns.some(p => p.re.test(text) && languages.every(lang => keySets[lang].has(p.key)));
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const stats = { text: 0, attr: 0, changelog: 0, endonym: 0, exempt: 0 };
  const usedExempt = new Set(), stack = [];
  const exemptKey = text => {
    for (let i = stack.length - 1; i >= 0; i--) if (STATIC_HTML_EXEMPT[stack[i].id]?.texts.includes(text)) return `${stack[i].id}#${text}`;
    return null;
  };
  const check = (text, where, offset) => {
    const excluded = stack.findLast(el => el.excluded)?.excluded;
    if (excluded) { stats[excluded]++; return; }
    if (translatable(text)) { stats[where === 'text' ? 'text' : 'attr']++; return; }
    const exempt = where === 'text' && exemptKey(text);
    if (exempt) { usedExempt.add(exempt); stats.exempt++; return; }
    fail(`index.html 第 ${indexLineAt(offset)} 行的靜態${where === 'text' ? '文字' : ` ${where} 屬性`}「${text}」en/ja 字典沒有這個鍵，換語言會原樣留中文（整段文字要剛好是字典鍵；真的不必翻就加進 check_i18n.mjs 的 STATIC_HTML_EXEMPT 並寫理由）`);
  };
  const closeTo = (index, own) => { // 彈出 stack[index..];被別人的結束標籤順便關掉的排除元素要報
    for (const el of stack.slice(index)) if (el.excluded && el !== own) fail(`index.html 第 ${indexLineAt(el.at)} 行的 <${el.tag}>（${el.excluded === 'changelog' ? '完整更新歷史' : '語言自稱'}，整段不檢查）沒有自己的 </${el.tag}>——排除範圍會吞掉後面的內容`);
    stack.length = index;
  };
  if (bodyFrom < 0 || bodyTo < bodyFrom) fail('index.html 找不到 <body>…</body>——靜態 HTML 檢查空轉');
  else {
    const tagRe = /<(?:!([^>]*)|(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*))>/g;
    const textBetween = (from, to) => {
      const slice = masked.slice(from, to), text = decode(slice).trim();
      if (!text || !HAN.test(text) || /^(noscript|textarea)$/.test(stack.at(-1)?.tag || '')) return; // 翻譯器也跳過這兩種
      check(text, 'text', from + slice.search(/\S/));
    };
    tagRe.lastIndex = bodyFrom;
    let at = bodyFrom, m;
    while ((m = tagRe.exec(masked)) && m.index < bodyTo) {
      textBetween(at, m.index);
      at = m.index + m[0].length;
      if (m[1] !== undefined) continue; // 被遮掉的 script/style/註解:只是邊界
      const tag = m[3].toLowerCase();
      if (m[2]) {
        const index = stack.findLastIndex(el => el.tag === tag);
        if (index >= 0) closeTo(index, stack[index]);
        continue;
      }
      const attrs = new Map([...m[4].matchAll(/([^\s=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)]
        .map(a => [a[1].toLowerCase(), decode(a[2] ?? a[3] ?? a[4] ?? '')]));
      const el = { tag, at: m.index, id: attrs.get('id') || '',
        excluded: /(^|\s)foot-more(\s|$)/.test(attrs.get('class') || '') ? 'changelog' : attrs.has('data-lang') ? 'endonym' : null };
      stack.push(el);
      for (const [name, value] of attrs) {
        if (!HAN.test(value) || name.startsWith('data-')) continue;
        if (treeAttrs.includes(name)) { check(value.trim(), name, m.index); continue; }
        if (!stack.some(e => e.excluded)) fail(`index.html 第 ${indexLineAt(m.index)} 行 <${tag}> 的 ${name} 屬性寫了中文「${value.trim()}」——翻譯器只翻 ${treeAttrs.join('／')}，這個屬性換語言不會變`);
      }
      if (VOID.has(tag) || /\/\s*$/.test(m[4])) stack.pop();
    }
    textBetween(at, bodyTo);
    closeTo(0, null);
  }
  for (const [id, rule] of Object.entries(STATIC_HTML_EXEMPT)) for (const text of rule.texts) {
    if (!usedExempt.has(`${id}#${text}`)) fail(`check_i18n.mjs STATIC_HTML_EXEMPT 的 #${id}「${text}」在 index.html 已經找不到或已經有譯文——豁免過期了，從清單拿掉`);
  }
  // 分母具名斷言:對上字典的文字或屬性任一類是 0,多半是 <body> 切錯或整段被排除吞掉,上面的全稱檢查是空過的。
  if (!stats.text || !stats.attr) fail(`靜態 HTML 檢查只對到文字 ${stats.text} 段、屬性 ${stats.attr} 個——有一類是 0，掃描空轉`);
  console.log(`靜態 HTML：文字 ${stats.text} 段、屬性 ${stats.attr} 個對上字典；排除完整更新歷史 ${stats.changelog} 段、語言自稱 ${stats.endonym} 段；豁免 ${stats.exempt} 段（${Object.keys(STATIC_HTML_EXEMPT).map(id => '#' + id).join('、')}）。`);
}

// weekend.html 不載 i18n/*.js,期間名(本週末／假日／這個連假／<節日>連假)自帶一份 SPAN 譯名;
// 探索面板那一列(index.html weekendSpanName)查的是主字典。同一個期間在兩處要叫同一個名字——
// 兩份靠註解「一起改」沒有牙,這裡逐鍵比對。kind＝「鐵道活動」,pair 的 {h}＝字典「{holiday}連假」的 {holiday}。
{
  const weekendSource = fs.readFileSync(path.join(root, 'weekend.html'), 'utf8');
  const spanBlock = /var SPAN = (\{[\s\S]*?\n\});/.exec(weekendSource)?.[1];
  if (!spanBlock) fail('weekend.html 找不到 var SPAN = {…}; ——期間名譯名的一致性檢查會空過');
  else {
    const SPAN = vm.runInNewContext(`(${spanBlock})`);
    for (const lang of languages) {
      const table = SPAN[lang] || {};
      const pairs = Object.entries(table);
      if (pairs.length < 5) fail(`weekend.html SPAN.${lang} 只有 ${pairs.length} 個鍵——期間名譯名的一致性檢查會空過`);
      for (const [key, value] of pairs) {
        const dictKey = key === 'kind' ? '鐵道活動' : key === 'pair' ? '{holiday}連假' : key;
        const expected = messages[lang]?.[dictKey];
        const actual = key === 'pair' ? value.replace('{h}', '{holiday}') : value;
        if (expected !== actual) fail(`weekend.html SPAN.${lang}「${key}」＝${JSON.stringify(value)}，主字典「${dictKey}」＝${JSON.stringify(expected)}——兩處譯名要一致`);
      }
    }
  }
}

if (failures.length) {
  console.error(`i18n 稽核失敗（${failures.length} 項）`);
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log(`i18n 稽核通過：${keySets.en.size} 個 UI／內容 key、${legalKeyCount} 個法務 key、${literalKeys.length} 個 runtime 呼叫、${stationCount} 筆站名，以及特色列車／車種／支線／特色站／說明／成就／更新紀錄的 en/ja 覆蓋。`);
