#!/usr/bin/env node
// ship_web_gate_ledger.mjs 離線驗收：在暫存 git repo 里造出 BUILD-only、更新紀錄、
// 產品碼、閘門腳本與失敗重試，不會呼叫 ship-web、wrangler 或正式站。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createGateRunner, productFingerprint, changelogFingerprint, dependencyFiles,
  gateIdentity, referencedEnvironmentKeys,
} from './ship_web_gate_ledger.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

const index = ({ build = 'v1', recent = '甲', extraRecent = '', code = 'run(1);', history = '// v1：甲' } = {}) => `<!doctype html>
<footer class="site-foot">
  <details class="foot-box"><summary>更新紀錄<span class="foot-sub">最後更新：2026/1/1</span></summary>
    <ul><li data-cl-of="recent"><span class="d">1/1</span><span>${recent}</span></li>${extraRecent}</ul>
    <details class="foot-more"><summary>完整歷史</summary><ul><li data-cl="recent"><span class="d">1/1</span><span>${recent}</span></li></ul></details>
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
put('scripts/verify_obs_removed.mjs', 'console.log("obs");\n');
put('scripts/verify_thsr_seat.mjs', 'console.log("thsr");\n');
put('scripts/verify_engine_adapter.mjs', 'console.log("engine");\n');
put('scripts/check_voice.mjs', 'console.log("voice");\n');
put('docs/voice-rules.json', '{"version":1}\n');
put('scripts/verify_fail.mjs', 'console.log("fail");\n');
put('scripts/verify_night_design.mjs', 'console.log("night-v1");\n');
put('scripts/verify_helpers/env-helper.mjs', 'export const importedEnv = process.env.IMPORTED_AUDIT;\n');
put('scripts/verify_env.mjs', `import { importedEnv } from './verify_helpers/env-helper.mjs';
const { DESTRUCTURED_AUDIT } = process.env;
const bracket = process.env['BRACKET_AUDIT'];
const optional = process.env?.OPTIONAL_AUDIT;
const envAlias = process.env;
void importedEnv; void DESTRUCTURED_AUDIT; void bracket; void optional; void envAlias.ALIAS_AUDIT;
process.exit(process.env.TEST_DATE === 'good' ? 0 : 9);
`);
put('scripts/verify_secret.mjs', 'void process.env.AUDIT_SECRET;\n');
put('scripts/ship_web.mjs', '// orchestrator-v1\n');
put('scripts/ship_web_gate_ledger.mjs', '// ledger-engine-v1\n');
put('package.json', '{}\n');
git('init', '-q'); git('add', '.');

const baseProduct = productFingerprint(tmp);
const baseChangelog = changelogFingerprint(tmp);
put('index.html', index({ build: 'v2', recent: '乙', history: '// v2：只改版本履歷' }));
ok('BUILD／BUILD 履歷／更新紀錄不改產品指紋', productFingerprint(tmp) === baseProduct);
ok('更新紀錄有自己的指紋', changelogFingerprint(tmp) !== baseChangelog);
put('index.html', index({ extraRecent: '<li data-cl-of="extra"><span class="d">1/2</span><span>新增純文案</span></li>' }));
ok('增刪符合格式的純更新條目不改產品指紋', productFingerprint(tmp) === baseProduct);
put('index.html', index({ recent: '甲<script>globalThis.__ledgerMutation=true</script>' }));
ok('更新紀錄裡混入可執行標籤會改產品指紋', productFingerprint(tmp) !== baseProduct);
put('index.html', index().replace('data-cl-of="recent"', 'data-cl-of="recent" onclick="globalThis.__ledgerMutation=true"'));
ok('更新條目混入事件屬性會改產品指紋', productFingerprint(tmp) !== baseProduct);
put('index.html', index({ history: '// v2：履歷\nconst hiddenFeature = 1;' }));
const hiddenCodeOne = productFingerprint(tmp);
put('index.html', index({ history: '// v2：履歷\nconst hiddenFeature = 2;' }));
ok('BUILD 履歷區若混入可執行碼，產品指紋仍會改變', productFingerprint(tmp) !== hiddenCodeOne);
put('index.html', index({ code: `const payload = "const BUILD = 'one';";` }));
const buildPayloadOne = productFingerprint(tmp);
put('index.html', index({ code: `const payload = "const BUILD = 'two';";` }));
ok('字串內容長得像 BUILD 宣告也不會被正規化', productFingerprint(tmp) !== buildPayloadOne);
put('index.html', index({ history: `// v2：template payload
const payload = \`
const BUILD = 'one';
\`;` }));
const templateBuildOne = productFingerprint(tmp);
put('index.html', index({ history: `// v2：template payload
const payload = \`
const BUILD = 'two';
\`;` }));
ok('template literal 內獨立一行的假 BUILD 宣告不會被正規化', productFingerprint(tmp) !== templateBuildOne);
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
ok('同產品、不同 sha／歷史仍依內容複用，訊息保留上次真跑 sha', calls === 3
  && again.every(r => String(r.stdout).includes('帳本命中') && String(r.stdout).includes('aaaaaaaa')), `calls=${calls}`);

const dayLedger = path.join(tmp, 'day-ledger.json');
let dayCalls = 0;
const daySpawn = (_command, _args, options = {}) => {
  dayCalls++;
  return { status: 0, signal: null, stdout: options.encoding ? 'green' : Buffer.from('green'),
    stderr: options.encoding ? '' : Buffer.alloc(0) };
};
const runDay = (day, sha) => createGateRunner({ root: tmp, ledgerPath: dayLedger, sha, serviceDay: day, spawnSync: daySpawn })
  .run('node', [path.join(tmp, 'scripts', 'verify_beta.mjs')], { cwd: tmp, encoding: 'utf8' });
const dayFirst = runDay('2026-10-19', 'd1'.repeat(20));
const daySame = runDay('2026-10-19', 'd2'.repeat(20));
const dayNext = runDay('2026-10-20', 'd3'.repeat(20));
ok('同一台灣日 preview→正式可複用，跨台灣日必須重跑', dayCalls === 2
  && !String(dayFirst.stdout).includes('帳本命中') && String(daySame.stdout).includes('帳本命中')
  && !String(dayNext.stdout).includes('帳本命中'), `calls=${dayCalls}`);
ok('台灣日只換 fingerprint、不讓 ledger key 每天膨脹', Object.keys(JSON.parse(fs.readFileSync(dayLedger)).gates).length === 1);

const midnightLedger = path.join(tmp, 'midnight-ledger.json');
let liveDay = '2026-10-19';
const midnightRunner = createGateRunner({ root: tmp, ledgerPath: midnightLedger, sha: 'd4'.repeat(20),
  serviceDay: () => liveDay, spawnSync: daySpawn });
midnightRunner.run('node', [path.join(tmp, 'scripts', 'verify_beta.mjs')], { cwd: tmp, encoding: 'utf8' });
liveDay = '2026-10-20';
const afterMidnight = midnightRunner.run('node', [path.join(tmp, 'scripts', 'verify_beta.mjs')], { cwd: tmp, encoding: 'utf8' });
ok('同一趟 ship 跨台灣日時，後續 gate 以查帳當下日期重跑', dayCalls === 4
  && !String(afterMidnight.stdout).includes('帳本命中'), `calls=${dayCalls}`);

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

// gate 真的會吃到呼叫者繼承的環境變數。只比 options.env 的覆寫不夠：例如正式鏈的
// verify_physical_no_overlap 直接讀 TEST_DATE，換日期後若誤吃舊帳就會把真紅包成 exit 0。
const envScript = path.join(tmp, 'scripts', 'verify_env.mjs');
const envDependencies = dependencyFiles(tmp, envScript);
const envKeys = referencedEnvironmentKeys(tmp, envDependencies);
ok('環境鍵掃描涵蓋 dot／optional-dot／bracket／destructuring／local import closure／alias fallback',
  ['TEST_DATE', 'OPTIONAL_AUDIT', 'BRACKET_AUDIT', 'DESTRUCTURED_AUDIT', 'IMPORTED_AUDIT', '*']
    .every(key => envKeys.includes(key)),
  envKeys.join(','));

const savedEnv = new Map(['TEST_DATE', 'UNREFERENCED_AUDIT', 'AUDIT_SECRET'].map(key => [key, process.env[key]]));
const restoreEnv = () => { for (const [key, value] of savedEnv) {
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
} };
const envLedger = path.join(tmp, 'env-ledger.json');
process.env.TEST_DATE = 'good';
const envFirst = createGateRunner({ root: tmp, ledgerPath: envLedger, sha: 'e1'.repeat(20), spawnSync })
  .run('node', [envScript], { cwd: tmp, encoding: 'utf8' });
process.env.TEST_DATE = 'bad';
const envSecond = createGateRunner({ root: tmp, ledgerPath: envLedger, sha: 'e2'.repeat(20), spawnSync })
  .run('node', [envScript], { cwd: tmp, encoding: 'utf8' });
ok('繼承環境改變會換 identity 並真跑，不會把舊綠包成成功', envFirst.status === 0 && envSecond.status === 9
  && !String(envSecond.stdout).includes('帳本命中'), `first=${envFirst.status}, second=${envSecond.status}`);

process.env.UNREFERENCED_AUDIT = 'one';
const unusedOne = gateIdentity({ root: tmp, command: 'node', args: [path.join(tmp, 'scripts', 'verify_beta.mjs')] });
process.env.UNREFERENCED_AUDIT = 'two';
const unusedTwo = gateIdentity({ root: tmp, command: 'node', args: [path.join(tmp, 'scripts', 'verify_beta.mjs')] });
ok('gate 沒引用的環境變數不影響 identity', unusedOne.key === unusedTwo.key && unusedOne.fingerprint === unusedTwo.fingerprint);

const aliasBefore = process.env.ALIAS_AUDIT;
delete process.env.ALIAS_AUDIT;
const aliasMissing = gateIdentity({ root: tmp, command: 'node', args: [envScript] });
process.env.ALIAS_AUDIT = 'changed-through-alias';
const aliasPresent = gateIdentity({ root: tmp, command: 'node', args: [envScript] });
if (aliasBefore === undefined) delete process.env.ALIAS_AUDIT; else process.env.ALIAS_AUDIT = aliasBefore;
ok('process.env alias 的值改變也會換 identity', aliasMissing.key !== aliasPresent.key);

const secret = 'ledger-secret-must-not-leak-8f93';
process.env.AUDIT_SECRET = secret;
const secretLedger = path.join(tmp, 'secret-ledger.json');
const secretScript = path.join(tmp, 'scripts', 'verify_secret.mjs');
const secretIdentity = gateIdentity({ root: tmp, command: 'node', args: [secretScript] });
createGateRunner({ root: tmp, ledgerPath: secretLedger, sha: 'e3'.repeat(20), spawnSync: fakeSpawn })
  .run('node', [secretScript], { cwd: tmp, encoding: 'utf8' });
ok('環境值只存 digest，不把 secret 寫進 identity／帳本',
  !JSON.stringify(secretIdentity).includes(secret) && !fs.readFileSync(secretLedger, 'utf8').includes(secret));
restoreEnv();

const physicalEnvKeys = referencedEnvironmentKeys(ROOT,
  dependencyFiles(ROOT, path.join(ROOT, 'scripts', 'verify_physical_no_overlap.mjs')));
const physicalExpected = ['TEST_DATE', 'STEP', 'SAMPLE', 'FROM', 'TO', 'ENGINE', 'FORMATION_PROBE', 'REPORT', 'PORT'];
ok('正式台鐵重疊 gate 的環境旋鈕全部進 identity', physicalExpected.every(key => physicalEnvKeys.includes(key)),
  physicalExpected.filter(key => !physicalEnvKeys.includes(key)).join(',') || `${physicalExpected.length} keys`);
const networkBefore = process.env.NETWORK;
const dispatchBefore = process.env.DISPATCH;
const irrelevantBefore = process.env.UNREFERENCED_AUDIT;
delete process.env.NETWORK;
delete process.env.DISPATCH;
const physicalWithoutNetwork = gateIdentity({ root: ROOT, command: 'node',
  args: [path.join(ROOT, 'scripts', 'verify_physical_no_overlap.mjs')] });
process.env.NETWORK = '/tmp/a-different-physical-network.json';
const physicalWithNetwork = gateIdentity({ root: ROOT, command: 'node',
  args: [path.join(ROOT, 'scripts', 'verify_physical_no_overlap.mjs')] });
delete process.env.NETWORK;
process.env.DISPATCH = '/tmp/a-different-physical-dispatch.json';
const physicalWithDispatch = gateIdentity({ root: ROOT, command: 'node',
  args: [path.join(ROOT, 'scripts', 'verify_physical_no_overlap.mjs')] });
delete process.env.DISPATCH;
process.env.UNREFERENCED_AUDIT = 'one';
const physicalIrrelevantOne = gateIdentity({ root: ROOT, command: 'node',
  args: [path.join(ROOT, 'scripts', 'verify_physical_no_overlap.mjs')] });
process.env.UNREFERENCED_AUDIT = 'two';
const physicalIrrelevantTwo = gateIdentity({ root: ROOT, command: 'node',
  args: [path.join(ROOT, 'scripts', 'verify_physical_no_overlap.mjs')] });
if (networkBefore === undefined) delete process.env.NETWORK; else process.env.NETWORK = networkBefore;
if (dispatchBefore === undefined) delete process.env.DISPATCH; else process.env.DISPATCH = dispatchBefore;
if (irrelevantBefore === undefined) delete process.env.UNREFERENCED_AUDIT; else process.env.UNREFERENCED_AUDIT = irrelevantBefore;
ok('動態 process.env[env] 也納入 identity（NETWORK／DISPATCH 類）', physicalEnvKeys.includes('*')
  && physicalWithoutNetwork.key !== physicalWithNetwork.key && physicalWithoutNetwork.key !== physicalWithDispatch.key);
ok('有未知動態／alias 存取時保守納入整包 effective env',
  physicalIrrelevantOne.key !== physicalIrrelevantTwo.key);

// composite gate 透過 child_process 啟動的 verifier 也是 closure；只追 import 會在 child
// 改壞後繼續沿用父 gate 的舊綠燈。
put('scripts/verify_bus_transfer_core.mjs', 'console.log("child-v1");\n');
put('scripts/verify_bus_transfer_all.mjs', `import { spawnSync } from 'node:child_process';
spawnSync(process.execPath, ['./verify_bus_transfer_core.mjs']);
`);
const childLedger = path.join(tmp, 'child-ledger.json');
let childCalls = 0;
const childSpawn = (_command, _args, options = {}) => {
  childCalls++;
  return { status: 0, signal: null, stdout: options.encoding ? 'green' : Buffer.from('green'),
    stderr: options.encoding ? '' : Buffer.alloc(0) };
};
const parentScript = path.join(tmp, 'scripts', 'verify_bus_transfer_all.mjs');
createGateRunner({ root: tmp, ledgerPath: childLedger, sha: 'c1'.repeat(20), spawnSync: childSpawn })
  .run('node', [parentScript], { cwd: tmp, encoding: 'utf8' });
put('scripts/verify_bus_transfer_core.mjs', 'throw new Error("child-v2-red");\n');
const childAfterChange = createGateRunner({ root: tmp, ledgerPath: childLedger, sha: 'c2'.repeat(20), spawnSync: childSpawn })
  .run('node', [parentScript], { cwd: tmp, encoding: 'utf8' });
ok('spawn 的本地 child 腳本變動會讓父 gate 重跑', childCalls === 2
  && !String(childAfterChange.stdout).includes('帳本命中'), `calls=${childCalls}`);

const voiceLedger = path.join(tmp, 'voice-ledger.json');
let voiceCalls = 0;
const voiceSpawn = (_command, _args, options = {}) => {
  voiceCalls++;
  return { status: 0, signal: null, stdout: options.encoding ? 'green' : Buffer.from('green'),
    stderr: options.encoding ? '' : Buffer.alloc(0) };
};
const voiceScript = path.join(tmp, 'scripts', 'check_voice.mjs');
const voiceProduct = productFingerprint(tmp);
createGateRunner({ root: tmp, ledgerPath: voiceLedger, sha: 'v1'.repeat(20), spawnSync: voiceSpawn })
  .run('node', [voiceScript], { cwd: tmp, encoding: 'utf8' });
put('docs/voice-rules.json', '{"version":2}\n');
const voiceAfterRules = createGateRunner({ root: tmp, ledgerPath: voiceLedger, sha: 'v2'.repeat(20), spawnSync: voiceSpawn })
  .run('node', [voiceScript], { cwd: tmp, encoding: 'utf8' });
ok('docs/voice-rules.json 雖排除於產品指紋，變動仍會讓 check_voice 重跑',
  productFingerprint(tmp) === voiceProduct && voiceCalls === 2 && !String(voiceAfterRules.stdout).includes('帳本命中'),
  `calls=${voiceCalls}`);

const busClosure = dependencyFiles(ROOT, path.join(ROOT, 'scripts', 'verify_bus_transfer_all.mjs'));
const busChildren = [
  'verify_bus_transfer_core.mjs', 'verify_bus_transfer_index.mjs', 'verify_bus_transfer_ui.mjs',
  'verify_bus_transfer_worker.mjs', 'verify_journey_share_worker.mjs', 'verify_bus_transfer_gate.mjs',
  'verify_bus_transfer_i18n.mjs', 'verify_bus_transfer_ui_server.mjs', 'verify_bus_transfer_ui_browser.mjs',
].map(name => `scripts/${name}`);
const viewClosure = dependencyFiles(ROOT, path.join(ROOT, 'scripts', 'verify_view_controls_gate.mjs'));
const viewChildren = ['verify_view_controls_immersive.mjs', 'verify_ground_size.mjs', 'verify_view_btn_side_entry.mjs']
  .map(name => `scripts/${name}`);
const thsrClosure = dependencyFiles(ROOT, path.join(ROOT, 'scripts', 'verify_thsr_seat.mjs'));
const thsrChildren = ['dev_server.mjs', 'verify_punctual.mjs', 'verify_my_trains.mjs'].map(name => `scripts/${name}`);
const voiceClosure = dependencyFiles(ROOT, path.join(ROOT, 'scripts', 'check_voice.mjs'));
const bountyClosure = dependencyFiles(ROOT, path.join(ROOT, 'scripts', 'verify_bounty_all.mjs'));
const bountyChildren = ['hardening', 'schema', 'valuation', 'gates', 'dwell', 'api', 'ledger', 'chips', 'rules', 'redeem',
  'cloud', 'merge', 'cron', 'auth', 'cron2', 'merge_web'].map(name => `scripts/verify_bounty_${name}.mjs`);
ok('正式 composite gates 的 child verifier 都在 closure',
  busChildren.every(rel => busClosure.includes(rel)) && viewChildren.every(rel => viewClosure.includes(rel))
    && thsrChildren.every(rel => thsrClosure.includes(rel)) && voiceClosure.includes('docs/voice-rules.json')
    && bountyChildren.every(rel => bountyClosure.includes(rel)),
  `bus=${busChildren.filter(rel => busClosure.includes(rel)).length}/${busChildren.length}, `
    + `view=${viewChildren.filter(rel => viewClosure.includes(rel)).length}/${viewChildren.length}, `
    + `thsr=${thsrChildren.filter(rel => thsrClosure.includes(rel)).length}/${thsrChildren.length}, `
    + `voice=${voiceClosure.includes('docs/voice-rules.json') ? '1/1' : '0/1'}, `
    + `bounty=${bountyChildren.filter(rel => bountyClosure.includes(rel)).length}/${bountyChildren.length}`);

runner = make({ sha: 'f'.repeat(40) });
failNext = true;
const failed = run(runner, 'verify_fail.mjs');
const afterFailCalls = calls;
const retried = run(make({ sha: '1'.repeat(40) }), 'verify_fail.mjs');
ok('失敗不入帳，下一發一定重跑', failed.status === 1 && retried.status === 0 && calls === afterFailCalls + 1);

put('scripts/verify_interrupt.mjs', 'console.log("interrupt");\n');
const interruptLedger = path.join(tmp, 'interrupt-ledger.json');
let interruptCalls = 0;
const interruptSpawn = (_command, _args, options = {}) => {
  interruptCalls++;
  if (interruptCalls === 1) return { status: null, signal: 'SIGTERM', stdout: options.encoding ? '' : Buffer.alloc(0), stderr: options.encoding ? '' : Buffer.alloc(0) };
  return { status: 0, signal: null, stdout: options.encoding ? 'green' : Buffer.from('green'), stderr: options.encoding ? '' : Buffer.alloc(0) };
};
const interruptScript = path.join(tmp, 'scripts', 'verify_interrupt.mjs');
const interrupted = createGateRunner({ root: tmp, ledgerPath: interruptLedger, sha: 'i1'.repeat(20), spawnSync: interruptSpawn })
  .run('node', [interruptScript], { cwd: tmp, encoding: 'utf8' });
const interruptRetry = createGateRunner({ root: tmp, ledgerPath: interruptLedger, sha: 'i2'.repeat(20), spawnSync: interruptSpawn })
  .run('node', [interruptScript], { cwd: tmp, encoding: 'utf8' });
ok('被 signal 中斷不入帳，下一發一定真跑', interrupted.status === null && interrupted.signal === 'SIGTERM'
  && interruptRetry.status === 0 && interruptCalls === 2 && !String(interruptRetry.stdout).includes('帳本命中'));

runner = make({ sha: '2'.repeat(40) });
const schemaBefore = calls;
run(runner, 'verify_remote_schema.mjs');
run(make({ sha: '3'.repeat(40) }), 'verify_remote_schema.mjs');
ok('正式 D1 schema 不吃帳本，每發重查', calls === schemaBefore + 2);

const liveBefore = calls;
for (const name of ['verify_obs_removed.mjs', 'verify_thsr_seat.mjs', 'verify_engine_adapter.mjs']) {
  run(make({ sha: 'l1'.repeat(20) }), name);
  run(make({ sha: 'l2'.repeat(20) }), name);
}
ok('真讀即時 API 或動態掃描的 gates 同日第二發仍實跑', calls === liveBefore + 6,
  `calls=${calls - liveBefore}`);

// 先讓 beta 在當下產品碼入帳，再驗 --full 仍然實跑。
run(make({ sha: '4'.repeat(40) }), 'verify_beta.mjs');
const fullBefore = calls;
const forced = run(make({ sha: '5'.repeat(40), forceFull: true }), 'verify_beta.mjs');
ok('--full 強制實跑已綠閘門', calls === fullBefore + 1 && !String(forced.stdout).includes('帳本命中'));

const sharedLedger = path.join(tmp, 'shared-ledger.json');
let sharedCalls = 0;
const sharedSpawn = (_command, _args, options = {}) => {
  sharedCalls++;
  return { status: 0, signal: null, stdout: options.encoding ? 'green' : Buffer.from('green'), stderr: options.encoding ? '' : Buffer.alloc(0) };
};
const runShared = sha => createGateRunner({ root: tmp, ledgerPath: sharedLedger, sha, spawnSync: sharedSpawn })
  .run('node', [path.join(tmp, 'scripts', 'verify_beta.mjs')], { cwd: tmp, encoding: 'utf8' });
runShared('s1'.repeat(20));
put('scripts/ship_web.mjs', '// orchestrator-v2\n');
const afterOrchestrator = runShared('s2'.repeat(20));
put('scripts/ship_web.mjs', '// orchestrator-v1\n');
put('scripts/ship_web_gate_ledger.mjs', '// ledger-engine-v2\n');
const afterLedgerEngine = runShared('s3'.repeat(20));
put('scripts/ship_web_gate_ledger.mjs', '// ledger-engine-v1\n');
ok('出貨編排或帳本引擎自身變動會讓 gates 重跑', sharedCalls === 3
  && !String(afterOrchestrator.stdout).includes('帳本命中') && !String(afterLedgerEngine.stdout).includes('帳本命中'),
  `calls=${sharedCalls}`);

fs.writeFileSync(ledger, '{broken');
const brokenBefore = calls;
run(make({ sha: '6'.repeat(40) }), 'verify_beta.mjs');
ok('帳本損壞時 fail-open 全跑', calls === brokenBefore + 1);

// 夜間設計 gate 會以 live OpenFreeMap building tiles 做斷言，每發都必須真跑。
// 這組用獨立帳本，不借前面 alpha/beta 的狀態。
const nightLedger = path.join(tmp, 'night-ledger.json');
let nightCalls = 0;
const nightSpawn = (_command, args, options = {}) => {
  nightCalls++;
  const text = `green ${path.basename(args[0])}\n`;
  return { status: 0, signal: null, stdout: options.encoding ? text : Buffer.from(text), stderr: options.encoding ? '' : Buffer.alloc(0) };
};
const makeNight = ({ sha, forceFull = false } = {}) => createGateRunner({
  root: tmp, ledgerPath: nightLedger, sha: sha || '7'.repeat(40), forceFull,
  spawnSync: nightSpawn, log: () => {}, warn: () => {},
});
const runNight = runner => runner.run('node', [path.join(tmp, 'scripts', 'verify_night_design.mjs')],
  { cwd: tmp, encoding: 'utf8' });

const nightFirst = runNight(makeNight({ sha: '7'.repeat(40) }));
const nightAgain = runNight(makeNight({ sha: '8'.repeat(40) }));
ok('夜間 gate：live tile oracle 同輸入的第二發仍實跑', nightCalls === 2
  && !String(nightFirst.stdout).includes('帳本命中') && !String(nightAgain.stdout).includes('帳本命中'), `calls=${nightCalls}`);

const beforeCopyOnly = productFingerprint(tmp);
const copyOnly = fs.readFileSync(path.join(tmp, 'index.html'), 'utf8')
  .replace('更新紀錄已改', '夜間矩陣更新')
  .replace("const BUILD = 'v1';", "const BUILD = 'v9';");
put('index.html', copyOnly);
const nightCopy = runNight(makeNight({ sha: '9'.repeat(40) }));
ok('夜間 gate：純 BUILD／更新紀錄也實跑', productFingerprint(tmp) === beforeCopyOnly
  && nightCalls === 3 && !String(nightCopy.stdout).includes('帳本命中'), `calls=${nightCalls}`);

put('worker.js', 'export const value = 3;\n');
const nightProduct = runNight(makeNight({ sha: 'a'.repeat(40) }));
ok('夜間 gate：產品輸入變動必須重跑', nightCalls === 4
  && !String(nightProduct.stdout).includes('帳本命中'), `calls=${nightCalls}`);

put('scripts/verify_night_design.mjs', 'console.log("night-v2");\n');
const nightScript = runNight(makeNight({ sha: 'b'.repeat(40) }));
ok('夜間 gate：自己的腳本變動必須重跑', nightCalls === 5
  && !String(nightScript.stdout).includes('帳本命中'), `calls=${nightCalls}`);

const nightFull = runNight(makeNight({ sha: 'c'.repeat(40), forceFull: true }));
ok('夜間 gate：--full 無條件重跑', nightCalls === 6
  && !String(nightFull.stdout).includes('帳本命中'), `calls=${nightCalls}`);

fs.rmSync(tmp, { recursive: true, force: true });
const bad = R.filter(Boolean).length !== R.length;
console.log(`\n${R.filter(Boolean).length}/${R.length} 通過`);
process.exit(bad ? 1 : 0);
