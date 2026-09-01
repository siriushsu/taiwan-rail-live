#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;
const scripts = [
  'verify_bus_transfer_core.mjs',
  'verify_bus_transfer_index.mjs',
  'verify_bus_transfer_ui.mjs',
  'verify_bus_transfer_worker.mjs',
  'verify_bus_transfer_gate.mjs',
];

function run(script, env = process.env) {
  const result = spawnSync(NODE, [path.join(ROOT, 'scripts', script)], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.status !== 0) process.exit(result.status || 1);
}

for (const script of scripts) run(script);

const server = spawn(NODE, [path.join(ROOT, 'scripts', 'verify_bus_transfer_ui_server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, PORT: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
let serverError = '';
server.stdout.setEncoding('utf8');
server.stderr.setEncoding('utf8');
server.stdout.on('data', chunk => { serverOutput += chunk; });
server.stderr.on('data', chunk => { serverError += chunk; });

const base = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`fixture server 啟動逾時\n${serverOutput}\n${serverError}`)), 10_000);
  const inspect = () => {
    const match = serverOutput.match(/http:\/\/127\.0\.0\.1:\d+/);
    if (!match) return;
    clearTimeout(timer);
    resolve(match[0]);
  };
  server.stdout.on('data', inspect);
  server.once('exit', code => {
    clearTimeout(timer);
    reject(new Error(`fixture server 提前結束（${code}）\n${serverOutput}\n${serverError}`));
  });
});

try {
  run('verify_bus_transfer_ui_browser.mjs', { ...process.env, BUS_UI_BASE: base });
} finally {
  server.kill('SIGTERM');
}

console.log('公車轉乘完整出貨守門全部通過。');
