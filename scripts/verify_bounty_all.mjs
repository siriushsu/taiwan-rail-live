#!/usr/bin/env node
// 路段懸賞＋籌碼的出貨總閘門：15 支 node 驗收並行跑，merge_web、recorder_web（真 Chromium 無視窗）最後逐支跑。
// - 每支的輸出直接寫進暫存檔、不經管道：子程序最後呼叫 process.exit 時，管道上還沒寫完的 stdout 會被丟掉
//   （gates 曾因此只剩半份 log、後段的 FAIL 行不見）。自己也不呼叫 process.exit，只設 exitCode。
// - 驗收讀 data/bounty_rules.json 用相對路徑，所以 cwd 一律是 repo 根目錄。
// - scripts/ 底下每一支 verify_bounty_*.mjs 都要在清單裡：新增的驗收沒掛上來＝這道閘門紅，不會被靜默跳過。
// - 離開碼 0 還不夠：每支都要印出「N/N」摘要行而且 N>0，缺了就當沒跑完。
// - N 還要恰好等於 EXPECT 裡那一支的判準數（棘輪，第八輪獨立驗收）：只看「N/N 且 N>0」的話，一段判準被整段跳過
//   （fixture 空了、attempt 提早 return、迴圈的清單變空）分母會無聲縮水、照樣全綠。新增判準的同一個 commit 把數字調上去；
//   真的要刪判準，也在同一個 commit 把數字調低、commit 訊息寫原因。
// - 判法本身有自我測試（第九輪獨立驗收：總閘門 EXPECT 自檢）：開跑前拿假的輸出餵 judgeText，少一條、多一條、EXPECT 沒列、
//   有 FAIL 行卻離開碼 0、部分通過、沒有摘要行都要紅，正常的要綠；判法被改鬆（例如拿掉判準數比對）這裡先紅。
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
const BROWSER_SUITES = ['merge_web', 'recorder_web'];
const EXPECT = { hardening: 183, schema: 47, valuation: 52, gates: 75, dwell: 16, api: 88, ledger: 71, chips: 40, rules: 16,
  redeem: 90, cloud: 124, merge: 58, cron: 66, auth: 89, cron2: 131, merge_web: 27, recorder_web: 8 };
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

// 判一支（純函式，只吃離開碼與輸出文字；下面的自我測試直接餵假的輸出）。
function judgeText(name, code, text, note0 = '') {
  const lines = text.split('\n');
  const fails = lines.filter(l => /^FAIL\s/.test(l));
  const summary = lines.filter(l => /\d+\/\d+ (通過|passed|條判準通過)/.test(l)).pop() || '';
  const m = summary.match(/(\d+)\/(\d+)/);
  const complete = !!m && Number(m[2]) > 0 && m[1] === m[2];
  const total = m ? Number(m[2]) : 0, want = EXPECT[name];
  const count = !(want > 0) ? `EXPECT 沒有 ${name} 的判準數` : !m || total === want ? '' : total < want
    ? `判準數 ${total} 比 EXPECT 的 ${want} 少 ${want - total} 條：有判準被刪、整段被跳過或流程提早結束（分母無聲縮水）`
    : `判準數 ${total} 比 EXPECT 的 ${want} 多 ${total - want} 條：新增判準就在同一個 commit 把 EXPECT.${name} 調成 ${total}`;
  const note = [note0, count].filter(Boolean).join('；');
  return { note, fails, summary: summary.trim(), total, pass: code === 0 && !fails.length && complete && !count, tail: lines.slice(-20) };
}
function judge(r) {
  return { ...r, ...judgeText(r.name, r.code, r.log ? fs.readFileSync(r.log, 'utf8') : '', r.note) };
}
// 自我測試：判準數從 EXPECT 讀（不寫死），調 EXPECT 不必改這裡；守的是判法本身。
// [標籤, 哪一支, 離開碼, 輸出, 該不該綠, 紅的時候 note 要含的字]
const SELF = (() => {
  const n = EXPECT.rules, h = EXPECT.hardening, g = EXPECT.gates;
  return [
    ['對照：恰好 N/N', 'rules', 0, `  ok  R1\n\n${n}/${n} passed\n`, true],
    ['hardening 的 [SUMMARY] 格式', 'hardening', 0, `  ok  Z\n\n[SUMMARY] ${h}/${h} 條判準通過\n`, true],
    ['gates 的「通過」格式', 'gates', 0, `  ok  F1\n${g}/${g} 通過\n`, true],
    ['少一條（分母縮水）', 'rules', 0, `${n - 1}/${n - 1} passed\n`, false, `少 1 條`],
    ['多一條（EXPECT 沒調）', 'rules', 0, `${n + 1}/${n + 1} passed\n`, false, `多 1 條`],
    ['EXPECT 沒列這一支', 'nosuch', 0, `3/3 passed\n`, false, 'EXPECT 沒有 nosuch'],
    ['有 FAIL 行卻離開碼 0', 'rules', 0, `FAIL  R1 x\n${n}/${n} passed\n`, false],
    ['離開碼非 0', 'rules', 1, `${n}/${n} passed\n`, false],
    ['部分通過（離開碼 0）', 'rules', 0, `${n - 1}/${n} passed\n`, false],
    ['沒有摘要行', 'rules', 0, `  ok  R1\n`, false],
    ['0/0', 'rules', 0, `0/0 passed\n`, false],
  ].map(([label, name, code, text, want, needle]) => {
    const j = judgeText(name, code, text);
    return { label, ok: j.pass === want && (!needle || j.note.includes(needle)), got: j.pass, note: j.note };
  });
})();

const listed = new Set([...NODE_SUITES, ...BROWSER_SUITES, 'all']);
const onDisk = fs.readdirSync(path.join(ROOT, 'scripts'))
  .map(f => f.match(/^verify_bounty_(.+)\.mjs$/)?.[1]).filter(Boolean);
const unlisted = onDisk.filter(n => !listed.has(n));

const results = await Promise.all(NODE_SUITES.map(runSuite));
for (const name of BROWSER_SUITES) results.push(await runSuite(name));
const judged = results.map(judge);

const selfBad = SELF.filter(c => !c.ok);
console.log(`${selfBad.length ? 'FAIL ' : '  ok '} ${'selftest'.padEnd(10)} 棘輪判法自我測試 ${SELF.length - selfBad.length}/${SELF.length}` +
  (selfBad.length ? ' — ' + selfBad.map(c => `${c.label}（判成 ${c.got ? '綠' : '紅'}${c.note ? '：' + c.note : ''}）`).join('；') : ''));
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
  + '——加進 NODE_SUITES／BROWSER_SUITES、在 EXPECT 寫它的判準數，並在 ship_web_gate_ledger.mjs 的 EXTRA_GATE_DEPENDENCIES 補同一支');

if (bad.length || unlisted.length || selfBad.length) {
  process.exitCode = 1;
  console.log(`\n路段懸賞驗收未過：${[...bad.map(r => r.name), ...(selfBad.length ? ['棘輪自我測試'] : [])].join('、') || '（清單不完整）'}`);
} else {
  fs.rmSync(tmp, { recursive: true, force: true });   // 本支自己建的暫存目錄
  console.log(`\n路段懸賞驗收 ${judged.length} 支全綠（共 ${total} 條判準）。`);
}
