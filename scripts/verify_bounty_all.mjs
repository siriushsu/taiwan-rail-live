#!/usr/bin/env node
// 路段懸賞＋籌碼的出貨總閘門：15 支 node 驗收並行跑，merge_web、recorder_web（真 Chromium 無視窗）、chips_web（Chromium＋WebKit 無視窗，
// 護照籌碼列、懸賞身分與快取）最後逐支跑。
// - 每支的輸出直接寫進暫存檔、不經管道：子程序最後呼叫 process.exit 時，管道上還沒寫完的 stdout 會被丟掉
//   （gates 曾因此只剩半份 log、後段的 FAIL 行不見）。自己也不呼叫 process.exit，只設 exitCode。
// - 驗收讀 data/bounty_rules.json 用相對路徑，所以 cwd 一律是 repo 根目錄。
// - scripts/ 底下每一支 verify_bounty_*.mjs 都要在清單裡：新增的驗收沒掛上來＝這道閘門紅，不會被靜默跳過。
// - 離開碼 0 還不夠：每支都要印出「N/N」摘要行而且 N>0，缺了就當沒跑完。
// - N 還要恰好等於 EXPECT 裡那一支的判準數（棘輪）：只看「N/N 且 N>0」的話，一段判準被整段跳過
//   （fixture 空了、attempt 提早 return、迴圈的清單變空）分母會無聲縮水、照樣全綠。新增判準的同一個 commit 把數字調上去；
//   真的要刪判準，也在同一個 commit 把數字調低、commit 訊息寫原因。
// - 判法本身有自我測試（總閘門 EXPECT 自檢）：開跑前拿假的輸出餵 judgeText，少一條、多一條、EXPECT 沒列、
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
const BROWSER_SUITES = ['merge_web', 'recorder_web', 'chips_web'];
const EXPECT = { hardening: 183, schema: 47, valuation: 88, gates: 75, dwell: 16, api: 105, ledger: 71, chips: 40, rules: 16,
  redeem: 91, cloud: 124, merge: 58, cron: 70, auth: 89, cron2: 131, merge_web: 27, recorder_web: 8, chips_web: 641 };
// 逾時是拿來抓「卡住」的，不是拿來抓「慢」：別的工作把 1 分鐘負載壓到 16 以上時，chips_web 單獨跑完就要 16 分鐘以上，
// 固定的「每支 15 分鐘」會把還在一條一條出結果的驗收砍掉。所以分兩道：
// - STALL_MS 這麼久輸出檔一個位元組都沒長＝卡住（頁面卡死、evaluate 不回、或機器忙到動不了）；
// - CAP_MS 是總時長的保險，還在出結果也停。
// 中止當下記住輸出檔的長度：那之前寫下的 FAIL 是真的判準結果；之後的是中止造成的（Playwright 收到 SIGTERM 只關瀏覽器、
// 不結束程序，後面每一條都變成「browser has been closed」），判的時候不算、也不列。SIGTERM 之後 KILL_GRACE_MS 還沒結束就 SIGKILL。
// 計時用 performance.now()（單調時鐘，筆電睡眠時不走）：Date.now() 會把睡掉的時間算成「沒有輸出」，一醒來就誤判卡住。
const STALL_MS = 10 * 60 * 1000, CAP_MS = 60 * 60 * 1000, POLL_MS = 15 * 1000, KILL_GRACE_MS = 30 * 1000;
// 該不該中止（純函式，自我測試直接餵數字）。先看沒輸出多久：卡住的就算剛好也跑滿總時長，也標卡住，不說成還在出結果。
const stopWhy = (elapsed, quiet) => quiet >= STALL_MS ? 'stall' : elapsed >= CAP_MS ? 'cap' : null;
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
    const t0 = performance.now();
    let size = 0, grewAt = t0, stop = null, finished = false;
    const poll = setInterval(() => {
      const now = performance.now(), cur = fs.fstatSync(fd).size;
      if (cur !== size) { size = cur; grewAt = now; }
      const why = stopWhy(now - t0, now - grewAt);
      if (!why) return;
      clearInterval(poll);
      stop = { why, cut: cur, min: Math.round((now - t0) / 60000), quiet: Math.round((now - grewAt) / 60000), load: os.loadavg()[0], cpus: os.cpus().length };
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS).unref();
    }, POLL_MS);
    // 啟動失敗時 error 與 close 兩個事件都會來（高負載下 fork 失敗就是這樣），只收第一次：第二次 closeSync 會丟 EBADF、整支崩掉
    const done = (code, note) => {
      if (finished) return;
      finished = true;
      clearInterval(poll);
      children.delete(child);
      fs.closeSync(fd);
      resolve({ name, code, log, note, stop });
    };
    child.on('error', err => done(1, `啟動失敗：${err.message}`));
    child.on('close', (code, signal) => done(code ?? 1, !stop && signal ? `被 ${signal} 中止` : ''));
  });
}

// 判一支（純函式，只吃離開碼與輸出文字；下面的自我測試直接餵假的輸出）。
// stop：這一支被逾時中止過，stop.at 是中止當下已經寫到第幾個字。只判那之前的部分、一律紅，並說明停在哪裡、當時的負載。
function judgeText(name, code, text, note0 = '', stop = null) {
  const lines = (stop ? text.slice(0, stop.at) : text).split('\n');
  const fails = lines.filter(l => /^FAIL\s/.test(l));
  const summary = lines.filter(l => /\d+\/\d+ (通過|passed|條判準通過)/.test(l)).pop() || '';
  const m = summary.match(/(\d+)\/(\d+)/);
  const complete = !!m && Number(m[2]) > 0 && m[1] === m[2];
  const total = m ? Number(m[2]) : 0, want = EXPECT[name];
  const count = !(want > 0) ? `EXPECT 沒有 ${name} 的判準數` : !m || total === want ? '' : total < want
    ? `判準數 ${total} 比 EXPECT 的 ${want} 少 ${want - total} 條：有判準被刪、整段被跳過或流程提早結束（分母無聲縮水）`
    : `判準數 ${total} 比 EXPECT 的 ${want} 多 ${total - want} 條：新增判準就在同一個 commit 把 EXPECT.${name} 調成 ${total}`;
  const note = [note0, count, stop && stopNote(stop, lines, fails, text.slice(stop.at), want)].filter(Boolean).join('；');
  return { note, fails, summary: summary.trim(), total, pass: !stop && code === 0 && !fails.length && complete && !count, tail: lines.slice(-20) };
}
// 跑滿總時長還在出結果＝機器太忙（環境）；連續一段時間沒有輸出＝卡住，可能是環境、也可能是頁面或腳本卡死，靠當時的負載分辨。
function stopNote(stop, lines, fails, rest, want) {
  const ran = lines.filter(l => /^(\s*ok\s|FAIL\s)/.test(l)).length;
  const dropped = rest.split('\n').filter(l => /^FAIL\s/.test(l)).length;
  const when = `第 ${stop.min} 分鐘中止（最後一筆輸出在 ${stop.quiet} 分鐘前；當時 1 分鐘負載 ${stop.load.toFixed(1)}、${stop.cpus} 核）`;
  const head = stop.why === 'cap'
    ? `環境：逾時——跑滿 ${CAP_MS / 60000} 分鐘還沒跑完，${when}；逾時本身不是判準紅，負載降下來後單獨重跑這一支`
    : `卡住——連續 ${STALL_MS / 60000} 分鐘沒有新輸出，${when}；負載高就先當環境、降下來後重跑，負載不高就是腳本或頁面卡死，看最後幾行`;
  const real = fails.length ? `其中 ${fails.length} 條 FAIL 是真的判準結果，照列` : '其中沒有 FAIL';
  return `${head}。中止前出了 ${ran} 條結果（EXPECT ${want}），${real}；中止後的 ${dropped} 條 FAIL 是中止造成的，不列`;
}
// 輸出檔與中止點都是位元組，換成字元位置才交給 judgeText（中文一個字 3 個位元組，直接拿位元組當字元位置會切進下一行）。
function judgeBuf(name, code, buf, note0 = '', stop = null) {
  return judgeText(name, code, buf.toString('utf8'), note0, stop && { ...stop, at: buf.subarray(0, stop.cut).toString('utf8').length });
}
function judge(r) {
  return { ...r, ...judgeBuf(r.name, r.code, r.log ? fs.readFileSync(r.log) : Buffer.alloc(0), r.note, r.stop) };
}
// 自我測試：判準數從 EXPECT 讀（不寫死），調 EXPECT 不必改這裡；守的是判法本身。
// [標籤, 哪一支, 離開碼, 輸出, 該不該綠, 紅的時候 note 要含的字, 中止資訊, 該列出的 FAIL 行]
const SELF = (() => {
  const n = EXPECT.rules, h = EXPECT.hardening, g = EXPECT.gates;
  // 逾時中止的假輸出：中止前一條真的 FAIL（帶中文，中止點換算錯了就會切進下一行）；中止後一條「瀏覽器被關」造成的 FAIL，
  // 再加一行看起來完整的摘要。中止點跟真的一樣用位元組。
  const pre = `  ok  R1\nFAIL  R2 真的紅\n`, post = `FAIL  R3 browser has been closed\n${n}/${n} passed\n`, allOk = `  ok  R1\n${n}/${n} passed\n`;
  const cut = (why, head) => ({ why, cut: Buffer.byteLength(head), min: 61, quiet: 0, load: 33.2, cpus: 18 });
  const judged = [
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
    ['逾時：中止前的 FAIL 照列、中止後的不列', 'rules', 1, pre + post, false, '環境：逾時', cut('cap', pre), ['FAIL  R2 真的紅']],
    ['卡住：中止前沒有 FAIL、中止後印出完整摘要也要紅', 'rules', 0, `  ok  R1\n` + post, false, '卡住', cut('stall', `  ok  R1\n`), []],
    ['中止前摘要已經完整、離開碼 0 也要紅', 'rules', 0, allOk, false, '環境：逾時', cut('cap', allOk), []],
  ].map(([label, name, code, text, want, needle, stop, failsWant]) => {
    const j = judgeBuf(name, code, Buffer.from(text), '', stop);
    return { label, ok: j.pass === want && (!needle || j.note.includes(needle)) && (!failsWant || JSON.stringify(j.fails) === JSON.stringify(failsWant)),
      got: j.pass ? '綠' : '紅', note: j.note };
  });
  // 中止判定：[跑了多久（總時長的幾倍）, 多久沒有輸出（卡住門檻的幾倍）, 該判成什麼]
  const stops = [[0.1, 0.1, null], [1.01, 0.1, 'cap'], [0.5, 1.01, 'stall'], [1.01, 1.01, 'stall'], [1.01, 0.9, 'cap']].map(([e, q, w]) => {
    const got = stopWhy(e * CAP_MS, q * STALL_MS);
    return { label: `中止判定：跑了總時長的 ${e} 倍、沒輸出的時間是卡住門檻的 ${q} 倍`, ok: got === w, got: got || '不停', note: '' };
  });
  return [...judged, ...stops];
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
  (selfBad.length ? ' — ' + selfBad.map(c => `${c.label}（判成 ${c.got}${c.note ? '：' + c.note : ''}）`).join('；') : ''));
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
