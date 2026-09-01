#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const ship = fs.readFileSync(new URL('./ship_web.mjs', import.meta.url), 'utf8');
const all = fs.readFileSync(new URL('./verify_bus_transfer_all.mjs', import.meta.url), 'utf8');

assert.equal(packageJson.scripts?.['check-bus-transfer'], 'node scripts/verify_bus_transfer_all.mjs',
  'package.json 必須保留公車轉乘總驗收入口');
assert.match(ship, /verify_bus_transfer_all\.mjs/,
  'ship-web preflight 必須執行公車轉乘總驗收');
for (const script of [
  'verify_bus_transfer_core.mjs',
  'verify_bus_transfer_index.mjs',
  'verify_bus_transfer_ui.mjs',
  'verify_bus_transfer_worker.mjs',
  'verify_bus_transfer_ui_browser.mjs',
]) {
  assert(all.includes(script), `總驗收漏掉 ${script}`);
}

console.log('公車轉乘出貨鏈掛載守門通過。');
