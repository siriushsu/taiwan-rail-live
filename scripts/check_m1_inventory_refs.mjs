// M1 模組盤點的可重現行號／呼叫數守門人。
// 計數口徑刻意比照 verify_engine_adapter.mjs G1：逐行 test，同一行命中多次仍算一處。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY = path.join(ROOT, 'docs/superpowers/m1-prep/m1-module-inventory.json');
const document = JSON.parse(readFileSync(INVENTORY, 'utf8'));
const modules = document.modules;
const sourceCache = new Map();
const failures = [];

function sourceLines(file) {
  if (!sourceCache.has(file)) sourceCache.set(file, readFileSync(path.join(ROOT, file), 'utf8').split('\n'));
  return sourceCache.get(file);
}

function allRefs(items = modules) {
  const refs = [];
  for (const mod of items) {
    for (const field of ['entries', 'leafletTouches', 'residualL']) {
      for (const ref of mod[field] || []) refs.push({ module: mod.module, field, ...ref });
    }
  }
  return refs;
}

function checkRefs(items = modules, report = true) {
  const bad = [];
  const refs = allRefs(items);
  for (const ref of refs) {
    const lines = sourceLines(ref.file);
    const actual = lines[ref.line - 1];
    if (typeof actual !== 'string' || !actual.includes(ref.snippet)) {
      bad.push(`${ref.module}.${ref.field} ${ref.file}:${ref.line} 缺少 ${JSON.stringify(ref.snippet)}`);
    }
    // 極少數原始行本身不足 20 字元（例如 `function drawMe() {`）；這時只能接受整行，
    // 不能為了湊長度把下一行冒充同一行 snippet。
    if (ref.snippet.length < 20 && actual && actual.trim().length >= 20)
      bad.push(`${ref.module}.${ref.field} ${ref.file}:${ref.line} snippet 少於 20 字元`);
  }
  if (report) {
    console.log(`refs ${refs.length}／不符 ${bad.length}`);
    for (const item of bad) console.log(`  FAIL ${item}`);
  }
  return { refs, bad };
}

function countHitLines(lines, makeRegex) {
  let total = 0;
  for (const line of lines) {
    const re = makeRegex();
    if (re.test(line)) total++;
  }
  return total;
}

function pass(ok, name, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

const base = checkRefs();
if (base.bad.length) failures.push('行號／snippet 引用');

const indexLines = sourceLines('index.html');
const leafletRefs = modules.reduce((n, mod) => n + mod.leafletTouches.length, 0);
const actualLeaflet = countHitLines(indexLines, () => /\bM\.leaflet\b/g);
pass(leafletRefs === actualLeaflet, 'leafletTouches 總數等於全檔 M.leaflet 實際命中行', `${leafletRefs}／${actualLeaflet}`);

const residualRefs = modules.reduce((n, mod) => n + mod.residualL.length, 0);
const actualResidual = countHitLines(indexLines, () => /\bL\.[A-Za-z_][A-Za-z0-9_]*\s*\(/g);
pass(residualRefs === actualResidual, 'residualL 總數等於全檔 L.xxx( 實際命中行', `${residualRefs}／${actualResidual}`);

const allowedStatus = new Set(['現役', '內部契約', '已放棄', '已刪除']);
const allowedClass = new Set(['直接可用', '需引擎中立化', '需重想']);
pass(modules.length === 35 && new Set(modules.map(mod => mod.module)).size === 35,
  '35 模組齊全且 module 不重複', `${modules.length} 格`);
for (const mod of modules) {
  pass(allowedStatus.has(mod.status), `${mod.module} status 合法`, mod.status);
  pass(allowedClass.has(mod.classification), `${mod.module} classification 合法`, mod.classification);
  pass(Number.isInteger(mod.proposedBatch) && mod.proposedBatch >= 1 && mod.proposedBatch <= 5,
    `${mod.module} proposedBatch 在 1..5`, String(mod.proposedBatch));

  const actual = {};
  for (let lineNo = mod.range.from; lineNo <= mod.range.to; lineNo++) {
    const line = indexLines[lineNo - 1] || '';
    for (const hit of line.matchAll(/\bM\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
      actual[hit[1]] = (actual[hit[1]] || 0) + 1;
    }
  }
  pass(JSON.stringify(actual) === JSON.stringify(mod.mCalls), `${mod.module} mCalls 與 range 實際值相等`,
    `${mod.range.from}-${mod.range.to} ${JSON.stringify(actual)}`);
}

// 正向對照：只改記憶體副本，不碰 JSON。壞 snippet 必紅；還原原物件必綠。
const mutated = structuredClone(modules);
const firstModuleWithRef = mutated.find(mod => mod.entries.length || mod.leafletTouches.length || mod.residualL.length);
const firstFieldWithRef = ['entries', 'leafletTouches', 'residualL'].find(field => firstModuleWithRef[field].length);
firstModuleWithRef[firstFieldWithRef][0].snippet += '__M1_MUTATION_MUST_FAIL__';
const mutationBad = checkRefs(mutated, false).bad.length;
const restoredBad = checkRefs(modules, false).bad.length;
pass(mutationBad > base.bad.length, '正向對照：記憶體內改壞一筆 snippet 必紅', `不符 ${mutationBad}`);
pass(restoredBad === 0, '正向對照：還原後必綠', `不符 ${restoredBad}`);

console.log(failures.length ? `\n${failures.length} 項未過：${failures.join('、')}` : '\nM1 inventory refs 全部通過');
process.exit(failures.length ? 1 : 0);
