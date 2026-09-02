#!/usr/bin/env node
// design-mock.html 的第一個 <style> 必須與 index.html 的 <style> 逐 byte 相同——這是 Claude Design
// 往返流程的鐵則：設計是在那份樣式上打磨，mock 落後就等於在過期的 CSS 上畫圖，回包合併時會把
// 已上線的樣式整片蓋掉（第五輪回包就吃掉過已上線功能，靠逐項回補才救回）。
//
// 這件事原本只寫在 design-mock.html 檔尾的一行 HTML 註解裡、全靠人記得做,結果 2026-09-01 實測
// 已經落後 56 顆 index.html commit、相似度只剩 42%(4316 行 vs 1657 行)。所以固化成指令。
//
//   node scripts/sync_design_mock.mjs           把 index.html 的 style 抽進 mock
//   node scripts/sync_design_mock.mjs --check   只檢查、不寫入(不同步就 exit 1,可當閘門)
//
// 只動第一個 <style>。檔尾的 <style id="mockOverrides"> 是 mock 專用(手機殼替身等),合併時本來
// 就要忽略,這支腳本一個字都不會碰它。

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const P_INDEX = path.join(ROOT, 'index.html');
const P_MOCK = path.join(ROOT, 'design-mock.html');

const fail = m => { console.error(`❌ ${m}`); process.exit(1); };

const index = readFileSync(P_INDEX, 'utf8');
const mock = readFileSync(P_MOCK, 'utf8');

// index.html 只該有一個 <style>。多於一個就停——代表結構變了,盲目取 [0] 會抽錯那份。
const idxStyles = [...index.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)];
if (idxStyles.length !== 1) fail(`index.html 有 ${idxStyles.length} 個 <style>,預期 1 個——結構變了,先確認要抽哪一份`);
const want = idxStyles[0][1];

// mock 的第一個 <style> 是正式樣式區;第二個(id="mockOverrides")不可動。
const mockStyles = [...mock.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)];
if (mockStyles.length < 1) fail('design-mock.html 找不到任何 <style>');
const first = mockStyles[0];
if (/id\s*=\s*["']mockOverrides["']/.test(first[0]))
  fail('design-mock.html 的第一個 <style> 就是 mockOverrides——順序不對,不敢覆蓋');

const have = first[1];
const same = have === want;

const lines = s => s.split('\n').length;
console.log(`  index.html  <style>: ${lines(want)} 行 / ${want.length} bytes`);
console.log(`  design-mock <style>: ${lines(have)} 行 / ${have.length} bytes`);
console.log(`  其餘 <style> 區(不動): ${mockStyles.length - 1} 個`);

if (same) { console.log('✅ 已同步(逐 byte 相同)'); process.exit(0); }

if (CHECK) fail(`design-mock.html 的樣式區與 index.html 不同步——跑 node scripts/sync_design_mock.mjs 重抽`);

// 只換第一個 <style> 的內文,開閉標籤與其餘檔案原樣保留。
const out = mock.slice(0, first.index) + first[0].replace(have, want) + mock.slice(first.index + first[0].length);
writeFileSync(P_MOCK, out);

// 寫回後立刻讀回驗證,不要相信「我寫過了」。
const after = [...readFileSync(P_MOCK, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)];
if (after[0][1] !== want) fail('寫回後讀出來仍不相同——沒有真的落地');
if (after.length !== mockStyles.length) fail(`寫回後 <style> 數量從 ${mockStyles.length} 變成 ${after.length}——動到了不該動的區塊`);
console.log(`✅ 已同步:${lines(have)} 行 → ${lines(want)} 行`);
