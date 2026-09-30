#!/usr/bin/env node
// 路段懸賞＋籌碼的出貨總閘門：15 支 node 驗收並行跑，merge_web（真 Chromium 無視窗）最後單獨跑。
// - 每支的輸出直接寫進暫存檔、不經管道：子程序最後呼叫 process.exit 時，管道上還沒寫完的 stdout 會被丟掉
//   （gates 曾因此只剩半份 log、後段的 FAIL 行不見）。自己也不呼叫 process.exit，只設 exitCode。
// - 驗收讀 data/bounty_rules.json 用相對路徑，所以 cwd 一律是 repo 根目錄。
// - scripts/ 底下每一支 verify_bounty_*.mjs 都要在清單裡：新增的驗收沒掛上來＝這道閘門紅，不會被靜默跳過。
// - 離開碼 0 還不夠：每支都要印出「N/N」摘要行而且 N>0，缺了就當沒跑完。
// 全綠只印每支一行摘要；有紅的印那一支的 FAIL 行與結尾幾行，暫存檔留著並印出路徑。
// 跑法：node scripts/verify_bounty_all.mjs（npm run check-bounty）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE_SUITES = ['hardening', 'schema', 'valuation', 'gates', 'dwell', 'api', 'ledger', 'chips', 'rules',
  'redeem', 'cloud', 'merge', 'cron', 'auth', 'cron2'];
const BROWSER_SUITES = ['merge_web'];
const TIMEOUT_MS = 15 * 60 * 1000;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bounty-all-'));
const children = new Set();
process.on('exit', () => { for (const c of children) c.kill('SIGTERM'); });   // 只收本支自己啟動的子程序
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(1));

function runSuite(name) {
  const script = path.join(ROOT, 'scripts', `verify_bounty_${name}.mjs`);
  const log = path.join(tmp, `${name}.log`);
  if (!fs.existsSync(script)) return Promise.resolve({ name, code: 1, log: null, note: '找不到腳本' });
  const fd = fs.openSync(log, 'w');
  return new Promise(resolve => {
    const child = spawn(process.execPath, [script], { cwd: ROOT, env: process.env, stdio: ['ignore', fd, fd] });
    children.add(child);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, TIMEOUT_MS);
    const done = (code, note) => {
      clearTimeout(timer);
      children.delete(child);
      fs.closeSync(fd);
      resolve({ name, code, log, note });
    };
    child.on('error', err => done(1, `啟動失敗：${err.message}`));
    child.on('close', (code, signal) => done(code ?? 1, timedOut ? `逾時 ${TIMEOUT_MS / 60000} 分鐘` : signal ? `被 ${signal} 中止` : ''));
  });
}

function judge(r) {
  const text = r.log ? fs.readFileSync(r.log, 'utf8') : '';
  const lines = text.split('\n');
  const fails = lines.filter(l => /^FAIL\s/.test(l));
  const summary = lines.filter(l => /\d+\/\d+ (通過|passed|條判準通過)/.test(l)).pop() || '';
  const m = summary.match(/(\d+)\/(\d+)/);
  const complete = !!m && Number(m[2]) > 0 && m[1] === m[2];
  return { ...r, fails, summary: summary.trim(), total: m ? Number(m[2]) : 0, pass: r.code === 0 && !fails.length && complete, tail: lines.slice(-20) };
}

const listed = new Set([...NODE_SUITES, ...BROWSER_SUITES, 'all']);
const onDisk = fs.readdirSync(path.join(ROOT, 'scripts'))
  .map(f => f.match(/^verify_bounty_(.+)\.mjs$/)?.[1]).filter(Boolean);
const unlisted = onDisk.filter(n => !listed.has(n));

const results = await Promise.all(NODE_SUITES.map(runSuite));
for (const name of BROWSER_SUITES) results.push(await runSuite(name));
const judged = results.map(judge);

let total = 0;
for (const r of judged) {
  total += r.total;
  console.log(`${r.pass ? '  ok ' : 'FAIL '} ${r.name.padEnd(10)} ${r.summary || '（沒有摘要行）'}${r.note ? ' — ' + r.note : ''}${r.code ? ` rc=${r.code}` : ''}`);
}
const bad = judged.filter(r => !r.pass);
for (const r of bad) {
  console.log(`\n── ${r.name} 未過 ${r.log ? '（完整輸出：' + r.log + '）' : ''}`);
  for (const l of r.fails.slice(0, 40)) console.log(l.slice(0, 400));
  if (r.fails.length > 40) console.log(`…另有 ${r.fails.length - 40} 行 FAIL`);
  if (!r.fails.length) for (const l of r.tail) console.log(l.slice(0, 400));
}
if (unlisted.length) console.log(`\nFAIL  scripts/ 有沒掛進這道閘門的懸賞驗收：${unlisted.map(n => `verify_bounty_${n}.mjs`).join('、')}`
  + '——加進 NODE_SUITES／BROWSER_SUITES，並在 ship_web_gate_ledger.mjs 的 EXTRA_GATE_DEPENDENCIES 補同一支');

if (bad.length || unlisted.length) {
  process.exitCode = 1;
  console.log(`\n路段懸賞驗收未過：${bad.map(r => r.name).join('、') || '（清單不完整）'}`);
} else {
  fs.rmSync(tmp, { recursive: true, force: true });   // 本支自己建的暫存目錄
  console.log(`\n路段懸賞驗收 ${judged.length} 支全綠（共 ${total} 條判準）。`);
}
