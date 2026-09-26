#!/usr/bin/env node
// ship_web_gate_ledger.mjs 離線驗收：在暫存 git repo 里造出 BUILD-only、更新紀錄、
// 產品碼、閘門腳本與失敗重試，不會呼叫 ship-web、wrangler 或正式站。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createGateRunner, productFingerprint, changelogFingerprint } from './ship_web_gate_ledger.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-web-ledger-'));
const ledger = path.join(tmp, 'ledger.json');
const R = [];
const ok = (name, pass, detail = '') => {
  R.push(pass);
  console.log(`${pass ? 'PASS' : '❌FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const put = (rel, body) => {
  const file = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};
const git = (...args) => execFileSync('git', ['-c', 'init.defaultBranch=main', ...args], { cwd: tmp, encoding: 'utf8' });

const index = ({ build = 'v1', recent = '甲', code = 'run(1);', history = '// v1：甲' } = {}) => `<!doctype html>
<footer class="site-foot">
  <details class="foot-box"><summary>更新紀錄</summary><ul><li>${recent}</li></ul>
    <details class="foot-more"><summary>完整歷史</summary><ul><li>${recent}</li></ul></details>
  </details>
  <details class="foot-box"><summary>資料來源</summary><p>不可被正規化</p></details>
</footer>
<script>
// 版本戳記:測試
${history}
const BUILD = '${build}';
${code}
</script>
`;

put('index.html', index());
put('worker.js', 'export const value = 1;\n');
put('app/App.swift', 'let value = 1\n');
put('i18n/translations.js', 'window.T = {};\n');
put('scripts/verify_helpers/helper.mjs', 'export const helper = 1;\n');
put('scripts/verify_alpha.mjs', "import { helper } from './verify_helpers/helper.mjs'; console.log(helper);\n");
put('scripts/verify_beta.mjs', 'console.log("beta");\n');
put('scripts/verify_changelog_copy.mjs', 'console.log("copy");\n');
put('scripts/verify_remote_schema.mjs', 'console.log("schema");\n');
put('scripts/verify_fail.mjs', 'console.log("fail");\n');
put('package.json', '{}\n');
git('init', '-q'); git('add', '.');

const baseProduct = productFingerprint(tmp);
const baseChangelog = changelogFingerprint(tmp);
put('index.html', index({ build: 'v2', recent: '乙', history: '// v2：只改版本履歷' }));
ok('BUILD／BUILD 履歷／更新紀錄不改產品指紋', productFingerprint(tmp) === baseProduct);
ok('更新紀錄有自己的指紋', changelogFingerprint(tmp) !== baseChangelog);
put('index.html', index());

let calls = 0;
let failNext = false;
const fakeSpawn = (_command, args, options = {}) => {
  calls++;
  const failed = failNext && String(args[0]).endsWith('verify_fail.mjs');
  if (failed) failNext = false;
  const text = `${failed ? 'red' : 'green'} ${path.basename(args[0])}\n`;
  return { status: failed ? 1 : 0, signal: null, stdout: options.encoding ? text : Buffer.from(text), stderr: options.encoding ? '' : Buffer.alloc(0) };
};
const run = (runner, name, env) => runner.run('node', [path.join(tmp, 'scripts', name)], { cwd: tmp, encoding: 'utf8', ...(env ? { env: { ...process.env, ...env } } : {}) });
const make = (extra = {}) => createGateRunner({ root: tmp, ledgerPath: ledger, sha: extra.sha || 'a'.repeat(40), forceFull: !!extra.forceFull,
  spawnSync: fakeSpawn, log: () => {}, warn: () => {} });

let runner = make();
run(runner, 'verify_alpha.mjs'); run(runner, 'verify_beta.mjs'); run(runner, 'verify_changelog_copy.mjs');
ok('第一發帳本空白，全部實跑', calls === 3, `calls=${calls}`);

runner = make({ sha: 'b'.repeat(40) });
const again = [run(runner, 'verify_alpha.mjs'), run(runner, 'verify_beta.mjs'), run(runner, 'verify_changelog_copy.mjs')];
ok('同產品、同閘門可全數複用', calls === 3 && again.every(r => String(r.stdout).includes('帳本命中')), `calls=${calls}`);

put('scripts/verify_helpers/helper.mjs', 'export const helper = 2;\n');
runner = make({ sha: 'c'.repeat(40) });
const alphaChanged = run(runner, 'verify_alpha.mjs');
const betaSame = run(runner, 'verify_beta.mjs');
ok('閘門的相對 import 變動時，只重跑那道', calls === 4 && !String(alphaChanged.stdout).includes('帳本命中') && String(betaSame.stdout).includes('帳本命中'), `calls=${calls}`);

put('index.html', index({ recent: '更新紀錄已改' }));
runner = make({ sha: 'd'.repeat(40) });
const alphaAfterCopy = run(runner, 'verify_alpha.mjs');
const copyAfterCopy = run(runner, 'verify_changelog_copy.mjs');
ok('只改更新紀錄：一般閘門略過，文案閘門重跑', calls === 5 && String(alphaAfterCopy.stdout).includes('帳本命中') && !String(copyAfterCopy.stdout).includes('帳本命中'), `calls=${calls}`);

put('worker.js', 'export const value = 2;\n');
runner = make({ sha: 'e'.repeat(40) });
const beforeProduct = calls;
run(runner, 'verify_alpha.mjs'); run(runner, 'verify_beta.mjs'); run(runner, 'verify_changelog_copy.mjs');
ok('產品碼變動仍全跑', calls - beforeProduct === 3, `new calls=${calls - beforeProduct}`);

put('app/App.swift', 'let value = 2\n');
const appProduct = productFingerprint(tmp);
put('app/App.swift', 'let value = 3\n');
ok('App 變動會改產品指紋', productFingerprint(tmp) !== appProduct);
put('i18n/translations.js', 'window.T = { en: {} };\n');
const i18nProduct = productFingerprint(tmp);
put('i18n/translations.js', 'window.T = { en: { x: 1 } };\n');
ok('i18n 變動會改產品指紋', productFingerprint(tmp) !== i18nProduct);

runner = make({ sha: 'f'.repeat(40) });
failNext = true;
const failed = run(runner, 'verify_fail.mjs');
const afterFailCalls = calls;
const retried = run(make({ sha: '1'.repeat(40) }), 'verify_fail.mjs');
ok('失敗不入帳，下一發一定重跑', failed.status === 1 && retried.status === 0 && calls === afterFailCalls + 1);

runner = make({ sha: '2'.repeat(40) });
const schemaBefore = calls;
run(runner, 'verify_remote_schema.mjs');
run(make({ sha: '3'.repeat(40) }), 'verify_remote_schema.mjs');
ok('正式 D1 schema 不吃帳本，每發重查', calls === schemaBefore + 2);

// 先讓 beta 在當下產品碼入帳，再驗 --full 仍然實跑。
run(make({ sha: '4'.repeat(40) }), 'verify_beta.mjs');
const fullBefore = calls;
const forced = run(make({ sha: '5'.repeat(40), forceFull: true }), 'verify_beta.mjs');
ok('--full 強制實跑已綠閘門', calls === fullBefore + 1 && !String(forced.stdout).includes('帳本命中'));

fs.writeFileSync(ledger, '{broken');
const brokenBefore = calls;
run(make({ sha: '6'.repeat(40) }), 'verify_beta.mjs');
ok('帳本損壞時 fail-open 全跑', calls === brokenBefore + 1);

fs.rmSync(tmp, { recursive: true, force: true });
const bad = R.filter(Boolean).length !== R.length;
console.log(`\n${R.filter(Boolean).length}/${R.length} 通過`);
process.exit(bad ? 1 : 0);
