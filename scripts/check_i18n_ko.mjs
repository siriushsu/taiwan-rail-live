import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const box = { window: {} };
vm.createContext(box);
for (const file of ['translations', 'content-translations', 'bus-transfer-translations', 'ko-translations', 'legal-translations', 'ko-legal-translations']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'i18n', file + '.js'), 'utf8'), box);
}
const { en, ko } = box.window.RAIL_I18N_MESSAGES;
assert(ko && Object.keys(ko).length > 0, '韓文草稿不可為空');
const placeholders = value => [...value.matchAll(/\{\w+\}/g)].map(m => m[0]).sort();
const tags = value => [...value.matchAll(/<\/?[a-z][^>]*>/gi)].map(m => m[0]).sort();
for (const [key, value] of Object.entries(ko)) {
  assert(Object.hasOwn(en, key), `未知的韓文鍵：${key}`);
  assert.equal(typeof value, 'string', `韓文譯文必須是字串：${key}`);
  assert(value.trim(), `韓文譯文空白：${key}`);
  assert.deepEqual(placeholders(value), placeholders(key), `韓文佔位不一致：${key}`);
  assert.deepEqual(tags(value), tags(key), `韓文 HTML 標記不一致：${key}`);
}
const weekendSource = fs.readFileSync(path.join(root,'weekend.html'),'utf8');
const weekendSpan = vm.runInNewContext('('+weekendSource.match(/var SPAN = ([\s\S]*?\n});/)[1]+')').ko;
for (const [key,value] of Object.entries(weekendSpan)) {
  const sourceKey=key==='kind'?'鐵道活動':key==='pair'?'{holiday}連假':key;
  assert.equal(value.replace('{h}','{holiday}'),ko[sourceKey],`活動頁與主介面韓文不一致：${key}`);
}
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'i18n/stations.json'), 'utf8'));
const sections = {
  stations: Object.values(catalog.systems).flatMap(rows => Object.entries(rows)),
  routes: Object.values(catalog.routes).flatMap(rows => Object.entries(rows)),
  trainTypes: Object.entries(catalog.trainTypes),
};
const coverage = Object.fromEntries(Object.entries(sections).map(([group, rows]) => [group, {
  total: rows.length, drafted: rows.filter(([, row]) => row.ko).length,
  pending: rows.filter(([, row]) => !row.ko).map(([source]) => source),
}]));
const pending = Object.entries(en).filter(([key]) => !Object.hasOwn(ko, key))
  .map(([source, reference]) => ({ source, reference }));
const missingLeaves = (source, translated, prefix = '') => Object.entries(source || {}).flatMap(([key, value]) => {
  const at = prefix ? `${prefix}.${key}` : key;
  if (typeof value === 'string') return typeof translated?.[key] === 'string' ? [] : [at];
  return missingLeaves(value, translated?.[key], at);
});
const contentPending = missingLeaves(box.window.RAIL_I18N_CONTENT_DATA.en, box.window.RAIL_I18N_CONTENT_DATA.ko);
const historyPending = missingLeaves(box.window.RAIL_I18N_CHANGELOG.en, box.window.RAIL_I18N_CHANGELOG.ko);
const legalPending = Object.keys(box.window.RAIL_I18N_LEGAL_MESSAGES.en).filter(key => !box.window.RAIL_I18N_LEGAL_MESSAGES.ko?.[key]);
const report = {
  status: 'ready-for-review', ui: { total: Object.keys(en).length, drafted: Object.keys(ko).length, pending },
  catalog: coverage,
  contentPending, historyPending, legalPending,
  sourceLanguageContent: ['營運單位動態公告與活動原文沿用來源，與英日版相同'],
};
const at = process.argv.indexOf('--report');
if (at >= 0) {
  assert(process.argv[at + 1], '--report 後需給輸出檔路徑');
  fs.writeFileSync(process.argv[at + 1], JSON.stringify(report, null, 2) + '\n');
}
console.log(`韓文草稿：介面 ${report.ui.drafted}/${report.ui.total}；站名 ${coverage.stations.drafted}/${coverage.stations.total}；路線 ${coverage.routes.drafted}/${coverage.routes.total}；車種 ${coverage.trainTypes.drafted}/${coverage.trainTypes.total}。`);
console.log(`佔位、HTML 標記與既有來源鍵檢查通過。介面缺稿 ${pending.length}，長篇欄位缺稿 ${contentPending.length}，歷史缺稿 ${historyPending.length}，法律頁缺稿 ${legalPending.length}。`);
if (process.argv.includes('--release')) {
  assert(pending.length === 0 && Object.values(coverage).every(row => row.drafted === row.total) && contentPending.length === 0 && historyPending.length === 0 && legalPending.length === 0,
    '韓文仍有缺稿或未審內容，不可當成完整韓文版出貨');
}
