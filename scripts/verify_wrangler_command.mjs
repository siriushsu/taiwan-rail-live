#!/usr/bin/env node
// 離線驗證：實跑 schema verifier 與受控 Wrangler 子行程，不連正式庫、不 upload／deploy。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { wranglerCommand } from './wrangler_command.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = '/fixture with spaces/wrangler.js';
const operations = [
  ['d1', 'execute', 'DELAY_DB', '--remote', '--json', '--command', "SELECT name, sql FROM sqlite_master WHERE type='table'"],
  ['versions', 'upload'],
  ['versions', 'deploy', '11111111-1111-4111-8111-111111111111@100%', '--yes'],
];
for (const args of operations) {
  const original = [...args];
  const mac = wranglerCommand(wrangler, args, { platform: 'darwin' });
  assert.equal(mac.command, 'arch');
  assert.deepEqual(mac.args, ['-arm64', 'node', wrangler, ...args]);
  for (const platform of ['linux', 'win32']) {
    const other = wranglerCommand(wrangler, args, { platform, execPath: '/node with spaces/node' });
    assert.equal(other.command, '/node with spaces/node');
    assert.deepEqual(other.args, [wrangler, ...args]);
  }
  assert.deepEqual(args, original, 'runtime 選擇不得改寫原命令');
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrangler-command-'));
try {
  for (const sub of ['scripts', 'schema', 'node_modules/wrangler/bin']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  for (const name of ['verify_remote_schema.mjs', 'wrangler_command.mjs'])
    fs.copyFileSync(path.join(root, 'scripts', name), path.join(dir, 'scripts', name));
  fs.writeFileSync(path.join(dir, 'schema', '0001_fixture.sql'),
    'CREATE TABLE sample (id TEXT PRIMARY KEY, seen INTEGER);\nALTER TABLE sample ADD COLUMN arrived INTEGER;\n');
  fs.writeFileSync(path.join(dir, 'node_modules/wrangler/bin/wrangler.js'), `
    const assert = require('node:assert/strict');
    assert.deepEqual(process.argv.slice(2), ${JSON.stringify(operations[0])});
    if (process.env.SCHEMA_FIXTURE_MODE === 'unavailable') {
      console.error('fixture remote query unavailable'); process.exit(7);
    }
    const sql = process.env.SCHEMA_FIXTURE_MODE === 'missing'
      ? 'CREATE TABLE sample (id TEXT PRIMARY KEY, seen INTEGER)'
      : 'CREATE TABLE sample (id TEXT PRIMARY KEY, seen INTEGER, arrived INTEGER)';
    console.log(JSON.stringify([{ results: [{ name: 'sample', sql }] }]));
  `);
  for (const [mode, status, expected] of [
    ['complete', 0, /schema ✓/],
    ['missing', 1, /sample\.arrived/],
    ['unavailable', 2, /fixture remote query unavailable/],
  ]) {
    const result = spawnSync(process.execPath, [path.join(dir, 'scripts/verify_remote_schema.mjs')], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, SCHEMA_FIXTURE_MODE: mode },
    });
    assert.equal(result.status, status, `${mode}: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout + result.stderr, expected);
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

// 實際執行出貨檔裡的新 gate 區塊：每支 verifier 都必須執行，任何一支紅都應中止。
const ship = fs.readFileSync(path.join(root, 'scripts/ship_web.mjs'), 'utf8');
const groups = [
  ['verify_krtc_terminal_display', 'verify_train_terminal_fade', 'verify_metro_core_bridge', 'verify_krtc_terminal_browser'],
  ['verify_glass_cache', 'verify_glass_transition', 'verify_glass_transition_browser'],
];
for (const names of groups) {
  const start = ship.indexOf(`  for (const name of ['${names[0]}'`);
  assert(start > 0 && start < ship.indexOf('  const rawBytes ='), '新守門必須在 strip 與 upload 前');
  const end = ship.indexOf('\n  }', start);
  assert(end > start);
  const block = ship.slice(start, end + 4);
  for (const failedName of [null, ...names]) {
    const called = [];
    const run = () => vm.runInNewContext(block, {
      wt: '/clean-shipping-tree', path,
      process: { env: { GLASS_MUTATE: 'opaque', KRTC_TEST_PLAYWRIGHT: '/runtime/krtc.mjs', GLASS_TEST_PLAYWRIGHT: '/runtime/glass.mjs' },
        stdout: { write() {} }, stderr: { write() {} } },
      spawnSync(command, args, options) {
        assert.equal(command, 'node');
        assert.equal(options.cwd, '/clean-shipping-tree');
        const name = path.basename(args[0], '.mjs'); called.push(name);
        assert.equal(args[0], `/clean-shipping-tree/scripts/${name}.mjs`);
        if (name.startsWith('verify_glass_')) {
          assert.equal(options.env.GLASS_MUTATE, '');
          assert.equal(options.env.GLASS_TEST_PLAYWRIGHT, '/runtime/glass.mjs');
        }
        return { status: name === failedName ? 1 : 0, stdout: '', stderr: '' };
      },
      fail(message) { throw new Error(message); },
    });
    if (failedName) {
      assert.throws(run, new RegExp(failedName));
      assert.deepEqual(called, names.slice(0, names.indexOf(failedName) + 1));
    } else {
      run(); assert.deepEqual(called, names);
    }
  }
}
assert.equal((ship.match(/'verify_glass_cache'/g) || []).length, 1, '玻璃快取守門不應重跑');
assert.match(ship, /wranglerCommand\(wrangler, \['versions', 'upload'\]\)/);
assert.match(ship, /wranglerCommand\(wrangler, \['versions', 'deploy', `\$\{verId\}@100%`, '--yes'\]\)/);
assert(!ship.includes("spawnSync('arch'"), '出貨腳本不得另走硬編碼架構的命令');
console.log('PASS Wrangler 跨平台 argv、實際 schema 子行程成功／缺欄／查詢失敗，以及 KRTC／建物新守門失敗阻擋');
