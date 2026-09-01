#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const ship = fs.readFileSync(new URL('./ship_web.mjs', import.meta.url), 'utf8');
const all = fs.readFileSync(new URL('./verify_bus_transfer_all.mjs', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.equal(packageJson.scripts?.['check-bus-transfer'], 'node scripts/verify_bus_transfer_all.mjs',
  'package.json 必須保留公車轉乘總驗收入口');
assert.match(ship, /verify_bus_transfer_all\.mjs/,
  'ship-web preflight 必須執行公車轉乘總驗收');

// 只斷言「有執行」擋不住「執行了但不擋」：把 `if (x.status !== 0) fail(...)` 改成
// `if (false)`，驗收照跑、紅字照印，版本仍然出得去，而 diff 只有一行。
// 判準綁在總驗收的結果變數怎麼被用，不寫死變數名，改名重構仍跟得住。
const spawnMatch = ship.match(/(?:const|let)\s+(\w+)\s*=\s*spawnSync\([^;]*verify_bus_transfer_all\.mjs/);
assert(spawnMatch, 'ship-web 必須把公車轉乘總驗收的結果指派給變數，才能判斷它過了沒');
assert.match(ship, new RegExp(`if\\s*\\(\\s*${spawnMatch[1]}\\.status\\s*!==\\s*0\\s*\\)\\s*fail\\(`),
  'ship-web 必須在公車轉乘總驗收非 0 時 fail——只執行不擋等於沒有守門');
for (const script of [
  'verify_bus_transfer_core.mjs',
  'verify_bus_transfer_index.mjs',
  'verify_bus_transfer_ui.mjs',
  'verify_bus_transfer_worker.mjs',
  'verify_bus_transfer_ui_browser.mjs',
]) {
  assert(all.includes(script), `總驗收漏掉 ${script}`);
}

// 子入口是壞掉時單獨重跑的唯一便道；總入口還在會讓 gate 空過，故逐支釘住。
for (const [name, script] of [
  ['check-bus-transfer-core', 'verify_bus_transfer_core.mjs'],
  ['check-bus-transfer-index', 'verify_bus_transfer_index.mjs'],
  ['check-bus-transfer-ui', 'verify_bus_transfer_ui.mjs'],
  ['check-bus-transfer-worker', 'verify_bus_transfer_worker.mjs'],
  ['check-bus-transfer-gate', 'verify_bus_transfer_gate.mjs'],
]) {
  assert.equal(packageJson.scripts?.[name], `node scripts/${script}`,
    `package.json 必須保留 ${name} 子入口，指向 scripts/${script}`);
}

// 公車卡自帶的 apiBase 預設是空字串＝相對路徑。App 載本地打包檔(origin capacitor://localhost),
// 相對路徑打不到 Worker ⇒ 卡片在 App 裡永遠顯示「暫時無法取得」,而固定文案讓它看起來只是暫時故障。
// 本機瀏覽器 harness 與頁面同源,結構上驗不到這件事,只能在這裡靜態釘住。
const mountCall = index.match(/BusTransferUI\.mount\(\{[\s\S]*?\n\s*\}\)/);
assert(mountCall, 'index.html 必須以物件參數呼叫 BusTransferUI.mount');
assert.match(mountCall[0], /apiBase:\s*API_BASE\b/,
  'BusTransferUI.mount 必須傳 apiBase: API_BASE——App 裡相對路徑打不到 Worker,卡片會全程失敗');
assert.match(index, /const\s+API_BASE\s*=\s*window\.RAIL_API_BASE/,
  'index.html 的 API_BASE 必須來自 window.RAIL_API_BASE(原生殼注入正式網域),寫死網域會讓預覽站打到正式站');

console.log('公車轉乘出貨鏈掛載守門通過。');
