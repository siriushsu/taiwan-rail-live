#!/usr/bin/env node
// 政府行政機關辦公日曆表的兩份副本必須逐 key 相同——npm run check-daytype-sync
//（已掛進 ship_web 的 preflight）
//
// 為什麼要有這支：同一份資料在這個 repo 有兩個副本，服務兩條不同的路徑——
//   index.html 的 TW_DAYTYPE      → 前端 prepFreqTimes() 選當天要跑哪一份捷運班表
//   data/tw_daytype.json          → worker.js 的 trtcDayTypeTable() 做北捷逐班綁定，
//                                    以及 scripts/trtc_board_ledger.mjs 的 buildTripSetsByLineDir
// 兩邊分岔的症狀是「某個國定假日前端跑假日班表、後端拿平日班表綁車」：畫面照常出車、
// API 全部 200、沒有任何錯誤訊息，只有綁定率會莫名其妙掉一天。
//
// 新年度的日曆是「人工補兩個地方」的動作，補一邊忘另一邊是遲早的事——這支讓它變成
// 部署前就擋下來的紅燈，而不是某個連假當天才被使用者發現。
//
// 🔴 這支不檢查「內容對不對」（那要對人事行政總處的公告），只檢查「兩份一不一樣」。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const fail = m => fails.push(m);
const ok = m => console.log('  ✓ ' + m);

// index.html 的 TW_DAYTYPE 是一個字面量物件常數，用括號配對抓到結尾的 '};'
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const m = /const TW_DAYTYPE = \{([\s\S]*?)\n\};/.exec(html);
if (!m) {
  fail('🔴 index.html 裡找不到 `const TW_DAYTYPE = {...};` —— 常數被改名或改形狀了，'
    + '這支守門人已經失去作用，請先確認前端的假日判定還在，再更新這裡的比對方式');
} else {
  const inline = {};
  for (const kv of m[1].matchAll(/'(\d{4}-\d{2}-\d{2})':\s*(\d)/g)) inline[kv[1]] = Number(kv[2]);
  const jsonPath = path.join(ROOT, 'data/tw_daytype.json');
  let json = null;
  try { json = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); }
  catch (e) { fail(`🔴 data/tw_daytype.json 讀不到或不是合法 JSON：${e.message}`); }

  if (json) {
    if (!Object.keys(inline).length) {
      fail('🔴 從 index.html 抽出 0 筆日期 —— 抽取用的正則已經對不上實際寫法，'
        + '這支等於恆綠（比對「空的」與「空的」永遠會過）');
    }
    const onlyHtml = Object.keys(inline).filter(k => !(k in json)).sort();
    const onlyJson = Object.keys(json).filter(k => !(k in inline)).sort();
    const diff = Object.keys(inline).filter(k => k in json && json[k] !== inline[k]).sort();
    if (onlyHtml.length) fail(`🔴 只在 index.html 有、data/tw_daytype.json 缺：${onlyHtml.join(', ')}`
      + ' —— 後端(北捷逐班綁定)會把這些日子當平日');
    if (onlyJson.length) fail(`🔴 只在 data/tw_daytype.json 有、index.html 缺：${onlyJson.join(', ')}`
      + ' —— 前端會在這些日子跑錯班表');
    if (diff.length) fail(`🔴 兩邊值不同：${diff.map(k => `${k}(html=${inline[k]} json=${json[k]})`).join(', ')}`);
    if (!onlyHtml.length && !onlyJson.length && !diff.length) {
      ok(`兩份辦公日曆表逐 key 相同（${Object.keys(inline).length} 筆）`);
    }
  }
}

if (fails.length) {
  console.error('\n❌ 辦公日曆表同步檢查未過：\n' + fails.map(f => '  ✗ ' + f).join('\n'));
  console.error('\n兩份副本分岔不會有任何錯誤訊息，只有某個假日的班表與綁定會靜靜出錯 —— 修好再出貨。');
  process.exit(1);
}
console.log('\n✅ 辦公日曆表同步檢查通過');
