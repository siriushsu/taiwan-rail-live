#!/usr/bin/env node
// 公車站牌搜尋的前端靜態守門（單元 C 第一批）。
//
// 這一支只驗「程式與資料檔上看得到的事實」；按下去會不會動要看 verify_bus_stop_browser.mjs。
// 🔴 每個反向判準都配正向對照——「找不到 X」在檔案讀錯時也會成立，那是恆真的假綠。

import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { BUS_STOP_INDEX_COLUMNS, parseBusStopIndexLine, parseProviderConfig } from './bus_live_core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const prepare = readFileSync(path.join(ROOT, 'app', 'scripts', 'prepare-web.mjs'), 'utf8');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name} — ${error.message}`); }
};

check('搜尋下拉真的有公車站牌區，且點擊有分流', () => {
  assert(/class="row bus-row" data-bi=/.test(index), '沒有 bus-row 列');
  assert(/closest\('\.row\.bus-row'\)/.test(index), 'searchDrop 的 click 沒有分流到 bus-row');
  assert(/renderBusStopCard\(/.test(index), '沒有到站卡片的渲染函式');
  assert(/\/api\/bus-stop-search\?q=/.test(index), '沒有呼叫搜尋端點');
  assert(/\/api\/bus-stop-live\?stop=/.test(index), '沒有呼叫到站端點');
});

check('後到的搜尋結果有防過期：查詢字串與 token 都要比對', () => {
  const fn = index.slice(index.indexOf('function scheduleBusSearch'), index.indexOf('async function renderBusStopCard'));
  assert(fn.includes('busSearchToken'), '沒有 token 防過期');
  assert(/inp\.value\.trim\(\)\s*!==\s*query/.test(fn), '沒有比對「查詢字串還是不是同一個」');
});

check('五種到站語意各有自己的文案，不得收斂成同一句', () => {
  const block = index.slice(index.indexOf('const BUS_STATE_TEXT'), index.indexOf('function busEtaText'));
  for (const key of ['not_departed', 'skipped', 'last_bus_passed', 'not_operating']) {
    assert(block.includes(`${key}:`), `BUS_STATE_TEXT 少了 ${key}`);
  }
  // 四個官方負值的文案必須互不相同（收斂成同一句正是設計書點名禁止的事）。
  const texts = ['not_departed', 'skipped', 'last_bus_passed', 'not_operating']
    .map(key => new RegExp(`${key}:\\s*'([^']+)'`).exec(block))
    .map(m => m && m[1]);
  assert(texts.every(Boolean), `抓不到四種文案：${JSON.stringify(texts)}`);
  assert.equal(new Set(texts).size, 4, `四種語意共用了同一句文案：${JSON.stringify(texts)}`);
});

check('沒有即時資料不得用班表推估頂替', () => {
  const block = index.slice(index.indexOf('function busEtaText'), index.indexOf('function scheduleBusSearch'));
  // 只有 countdown／scheduled 且真的有 etaSec 才准顯示分鐘數；其餘一律走文案。
  assert(/Number\.isFinite\(live\.etaSec\)/.test(block), 'busEtaText 沒有檢查 etaSec 是不是有限數');
  assert(!/schedule|班表|estimateFrom/i.test(block.replace(/'scheduled'/g, '')), 'busEtaText 疑似引入了班表推估');
});

check('本批用到的 i18n 鍵沒有被後載入的字典遮蔽（看得到的那份不是生效的那份）', () => {
  // index.html 依序載入三份字典，後載入的同名鍵會蓋掉前面的。本批曾經因此在英日語顯示
  // 另一份字典的文案，而 translations.js 裡看得到「正確」的那份——最難查的那種錯。
  const files = [...index.matchAll(/<script src="\.\/(i18n\/[a-z-]+\.js)"><\/script>/g)].map(m => m[1]);
  assert(files.length >= 2, `index.html 只掃到 ${files.length} 份字典，選取器可能過期`);
  const layers = [];
  const box = { window: {} };
  for (const f of files) {
    vm.runInNewContext(readFileSync(path.join(ROOT, f), 'utf8'), box);
    layers.push({ file: f, snapshot: JSON.parse(JSON.stringify(box.window.RAIL_I18N_MESSAGES)) });
  }
  const effective = layers[layers.length - 1].snapshot;
  // 某個鍵是在哪一份字典宣告的（第一個有值的那層）＋最後生效的是哪一份。
  const shadowed = (key) => {
    const declaredAt = layers.filter(l => ['en', 'ja'].some(lang => l.snapshot[lang][key] !== undefined));
    if (!declaredAt.length) return null;
    const first = declaredAt[0], last = layers[layers.length - 1];
    for (const lang of ['en', 'ja']) {
      if (JSON.stringify(first.snapshot[lang][key]) !== JSON.stringify(last.snapshot[lang][key])) {
        return `${key}[${lang}]：${first.file} 宣告 ${JSON.stringify(first.snapshot[lang][key])}，實際生效 ${JSON.stringify(last.snapshot[lang][key])}`;
      }
    }
    return null;
  };
  // 本批自己在 translations.js 新增的鍵：一個都不准被後載入的字典蓋掉（我控制得了的部分）。
  const OWN_KEYS = ['公車站牌', '共 {n} 個站牌符合', '查詢中…', '無即時資料',
    '這一站目前沒有任何路線回報', '目前拿不到這一站的即時到站', '實際到站時間請以各公車業者官方資訊為準'];
  const bad = OWN_KEYS.map(shadowed).filter(Boolean);
  assert.equal(bad.length, 0, `本批新增的鍵被後載入的字典蓋掉：\n  ${bad.join('\n  ')}`);

  // 沿用既有公車用語正本的鍵：不管誰宣告，「最後生效的那份」必須存在且語意分得開。
  const BORROWED_KEYS = ['進站中', '即將進站', '{n} 分', '尚未發車', '交管不停靠', '末班已過', '今日未營運', '資料已過期'];
  for (const key of [...OWN_KEYS, ...BORROWED_KEYS]) for (const lang of ['en', 'ja']) {
    assert(effective[lang][key] !== undefined, `${lang} 字典缺 ${key}（英日語會落回中文）`);
  }
  // 四個官方負值＋兩種進站語意，在每個語系都必須兩兩不同（收斂成同一句＝把官方語意抹平）。
  for (const lang of ['en', 'ja']) {
    const neg = ['尚未發車', '交管不停靠', '末班已過', '今日未營運'].map(k => JSON.stringify(effective[lang][k]));
    assert.equal(new Set(neg).size, 4, `${lang} 的四種官方負值共用了文案：${neg.join(' / ')}`);
    assert.notEqual(JSON.stringify(effective[lang]['進站中']), JSON.stringify(effective[lang]['即將進站']),
      `${lang} 的「進站中」與「即將進站」變成同一句`);
  }

  // 🔴 正向對照：這個偵測器真的抓得到遮蔽（`=== 0` 型判準在讀錯檔時也會成立）。
  // '尚未發車' 同時被 content-translations.js（列車語境，ja「発車前」）與
  // bus-transfer-translations.js（公車語境，ja「未発車」）宣告 —— 既有狀況，非本批造成，
  // 這裡只拿它當「偵測器沒瞎」的證據，不修別人的字典。
  assert(shadowed('尚未發車'), '正向對照失敗：偵測器連已知的 尚未發車[ja] 遮蔽都抓不到，上面的 0 是假綠');
});

check('資料來源與授權清單補上了公車兩條（署名是政府資料開放授權的生效要件）', () => {
  const start = index.indexOf('資料來源與授權');
  const end = index.indexOf('</details>', index.indexOf('foot-note', start));
  const block = index.slice(start, end);
  assert(block.includes('TDX 運輸資料流通服務（Bus/Station'), '缺 TDX 公車署名');
  assert(block.includes('臺北市政府交通局公共運輸處'), '缺臺北市公車來源署名');
  assert(block.includes('政府資料開放授權條款'), '缺授權條款字樣');
  // 正向對照：同一段裡本來就有的鐵道條目必須也找得到，證明我切到的真的是那一段。
  assert(block.includes('台鐵官方 OpenData'), '正向對照失敗：切到的不是資料來源清單那一段');
  const items = (block.match(/<li[ >]/g) || []).length;
  assert(items >= 10, `清單條目只有 ${items} 條，公車兩條疑似沒進去（原本 8 條）`);
});

check('本批沒有在 repo 根目錄新增前端 JS／CSS（新增就必須同輪進 prepare-web 字面清單）', () => {
  // 這批刻意把搜尋擴充寫進 index.html，因為它與 renderSearchDrop／drop click 同一段邏輯。
  // 若日後真的拆出根目錄檔案，下面這條會紅，提醒去補 prepare-web.mjs 的清單與守門人。
  const rootAssets = readdirSync(ROOT).filter(f => /^bus[-_].*\.(js|css)$/.test(f));
  for (const f of rootAssets) {
    assert(prepare.includes(`'${f}'`), `${f} 在 repo 根目錄但不在 prepare-web.mjs 的字面清單裡 ⇒ App 會靜默少功能`);
  }
  // 正向對照：既有的 bus-transfer-ui.js 確實在清單裡，證明這條檢查抓得到。
  assert(rootAssets.includes('bus-transfer-ui.js'), '正向對照失敗：掃不到既有的 bus-transfer-ui.js');
  assert(prepare.includes(`'bus-transfer-ui.js'`), '正向對照失敗：prepare-web.mjs 應該有 bus-transfer-ui.js');
});

check('設定檔與索引產物都在，且格式對得起來', () => {
  const config = parseProviderConfig(JSON.parse(readFileSync(path.join(ROOT, 'data', 'bus_providers.json'), 'utf8')));
  const manifestPath = path.join(ROOT, 'data', 'bus_stops_index.json');
  const tsvPath = path.join(ROOT, 'data', 'bus_stops_index.tsv');
  assert(existsSync(manifestPath) && existsSync(tsvPath), '索引產物不存在（先跑 npm run build-bus-stop-index）');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(manifest.columns, BUS_STOP_INDEX_COLUMNS, 'manifest 的欄位順序與核心常數不符');
  const lines = readFileSync(tsvPath, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, manifest.stationCount, `TSV ${lines.length} 行與 manifest ${manifest.stationCount} 不符`);
  // 每一行都要 parse 得出來，而且縣市都在設定檔裡（縣市漏掉＝那一整縣的站牌點下去 503）。
  const cities = new Set();
  for (const line of lines) {
    const row = parseBusStopIndexLine(line);
    assert(row, `TSV 有 parse 不出來的行：${line.slice(0, 80)}`);
    cities.add(row.city);
  }
  for (const city of cities) assert(config.cities[city], `索引裡的縣市 ${city} 不在設定檔裡`);
});

check('對照表覆蓋率是具名斷言，分母不得是 0', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'data', 'bus_stops_index.json'), 'utf8'));
  const entries = Object.entries(manifest.crosswalk || {});
  assert(entries.length >= 1, '一個 direct-bulk 縣市的對照表報告都沒有');
  for (const [city, report] of entries) {
    for (const dim of ['idMatch', 'nameMatch', 'geoMatch']) {
      const { hit, total } = report[dim];
      assert(total > 0, `${city} 的 ${dim} 分母是 0（分母無聲縮水）`);
      const ratio = hit / total;
      assert(ratio >= manifest.crosswalkMinRatio, `${city} 的 ${dim} ${hit}/${total} = ${(ratio * 100).toFixed(2)}% 低於門檻`);
      console.log(`  ${city} ${dim}: ${hit}/${total} = ${(ratio * 100).toFixed(2)}%`);
    }
    assert(Array.isArray(report.unmatchedDirect), '對不起來的那幾筆必須列出來，不可以靜默丟掉');
  }
});

check('設定檔宣告的 stopIdPrefix 是用實際資料驗過的', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'data', 'bus_stops_index.json'), 'utf8'));
  const rows = manifest.stopIdPrefixCheck || [];
  assert(rows.length >= 1, 'manifest 沒有 stopIdPrefixCheck');
  const bad = rows.filter(r => !r.ok);
  assert.equal(bad.length, 0, `stopIdPrefix 與實際資料不符：${JSON.stringify(bad)}`);
});

if (failures) { console.error(`\n${failures} 項未過`); process.exit(1); }
console.log('\nGREEN 全部通過');
