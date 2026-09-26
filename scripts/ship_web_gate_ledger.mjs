// ship-web 閘門帳本：只在「同一份產品程式碼」重試時複用已通過的結果。
//
// 這不是依檔名猜「這次改動會影響哪個功能」：任何產品、資料、部署設定、i18n 或 App
// 內容一變，每道閘門的輸入指紋都會變，仍然全跑。只有兩種情形可略過：
//   1. 只改 BUILD／BUILD 歷史註解／更新紀錄（仍重跑字數與 i18n 閘門）。
//   2. 前一發在中途失敗，修好那支閘門後重試；已綠的前段不重跑，變動的閘門會重跑。
//
// 帳本只是效能快取：讀不懂、寫不進、找不到主腳本時一律 fail-open 成「全跑」，
// 不得因快取壞掉而讓出貨關閉。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SCHEMA = 1;
const CHANGELOG_SENSITIVE = new Set([
  'scripts/verify_changelog_copy.mjs',
  'scripts/check_i18n.mjs',
  'scripts/verify_i18n.mjs',
]);
const ALWAYS_RUN = new Set([
  // 正式 D1 會被外部 migration 改動，不能拿前一發的結果代替當下查詢。
  'scripts/verify_remote_schema.mjs',
  // 這支會讀 ship_web.mjs 做靜態接線檢查，那個被讀檔不是 import，不能只靠 import closure。
  'scripts/verify_ship_web_guard.mjs',
]);

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const posix = value => value.split(path.sep).join('/');
const within = (root, file) => {
  const rel = path.relative(root, file);
  return rel && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel) ? posix(rel) : null;
};

function balancedDetails(html, start) {
  if (start < 0) return null;
  const tag = /<\/?details\b[^>]*>/gi;
  tag.lastIndex = start;
  let depth = 0;
  for (let match; (match = tag.exec(html));) {
    if (/^<\/details/i.test(match[0])) depth--;
    else depth++;
    if (depth === 0) return { start, end: tag.lastIndex, text: html.slice(start, tag.lastIndex) };
  }
  return null;
}

export function changelogBlock(html) {
  const footer = html.indexOf('<footer class="site-foot">');
  const start = html.indexOf('<details class="foot-box">', Math.max(0, footer));
  return balancedDetails(html, start)?.text || '';
}

export function normalizeIndexForProduct(html) {
  let out = String(html);
  const block = changelogBlock(out);
  if (block) out = out.replace(block, '<details class="foot-box"><!-- ship-web:changelog --></details>');
  // 這段是純註解的版本履歷，終點釘在唯一的 const BUILD。產品程式碼從 BUILD 後繼續。
  out = out.replace(/\/\/ \u7248\u672c\u6233\u8a18:[\s\S]*?(?=const BUILD\s*=)/, '// ship-web:build-history\n');
  out = out.replace(/const BUILD\s*=\s*'[^']*'\s*;/, "const BUILD = '<ship-web-build>';" );
  return out;
}

function isToolingOnly(rel) {
  // scripts/ 不能整包排除：worker.js 會在 runtime import trtc_board_ledger、
  // bus_transfer_core 等模組。只排除「守門人本身」與 ship-web 工具，其他腳本
  // 一律當產品輸入；多跑比漏跑安全。
  const scriptTool = rel.startsWith('scripts/') && (
    /(?:^|\/)(?:verify_|check_)/.test(rel.slice('scripts/'.length))
    || rel === 'scripts/ship_web.mjs'
    || rel === 'scripts/ship_web_guard.mjs'
    || rel === 'scripts/ship_web_gate_ledger.mjs'
    || rel === 'scripts/pw_gpu_preload.mjs'
  );
  return scriptTool
    || rel.startsWith('docs/')
    || rel.startsWith('prototypes/')
    || rel.startsWith('.github/')
    || rel.startsWith('.claude/')
    || rel.endsWith('.md');
}

export function trackedFiles(root) {
  return execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z'], {
    cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }).split('\0').filter(Boolean).sort();
}

export function productFingerprint(root, files = trackedFiles(root)) {
  const h = crypto.createHash('sha256');
  for (const rel of files) {
    if (isToolingOnly(rel)) continue;
    const file = path.join(root, rel);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    let body = fs.readFileSync(file);
    if (rel === 'index.html') body = Buffer.from(normalizeIndexForProduct(body.toString('utf8')));
    h.update(rel).update('\0').update(body).update('\0');
  }
  return h.digest('hex');
}

export function changelogFingerprint(root) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  return hash(changelogBlock(html));
}

function importSpecifiers(source) {
  const found = new Set();
  const staticImport = /(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g;
  const dynamicImport = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const re of [staticImport, dynamicImport]) for (let m; (m = re.exec(source));) found.add(m[1]);
  return [...found];
}

function resolveLocal(from, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.mjs`, `${base}.js`, `${base}.json`, path.join(base, 'index.mjs'), path.join(base, 'index.js')]) {
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch {}
  }
  return null;
}

export function dependencyFiles(root, entry) {
  const queue = [entry], seen = new Set(), result = [];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const rel = within(root, file);
    if (!rel || !fs.existsSync(file)) continue;
    result.push(rel);
    if (!/\.(?:mjs|js)$/.test(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      const imported = resolveLocal(file, specifier);
      if (imported) queue.push(imported);
    }
  }
  return result.sort();
}

function normalizeValue(value, root) {
  return String(value).split(root).join('<ROOT>');
}

export function gateIdentity({ root, command, args = [], options = {}, sharedDependencies = [] }) {
  const entry = args.find(arg => typeof arg === 'string' && /\.(?:mjs|js)$/.test(arg) && within(root, path.resolve(arg)));
  if (!entry) return null;
  const entryAbs = path.resolve(entry);
  const entryRel = within(root, entryAbs);
  const deps = new Set(dependencyFiles(root, entryAbs));
  for (const file of sharedDependencies) if (fs.existsSync(file)) {
    const rel = within(root, file); if (rel) deps.add(rel);
  }
  const depHashes = [...deps].sort().map(rel => [rel, hash(fs.readFileSync(path.join(root, rel)))]);
  const env = {};
  if (options.env) for (const [key, value] of Object.entries(options.env)) {
    if (String(value ?? '') !== String(process.env[key] ?? '')) env[key] = normalizeValue(value ?? '', root);
  }
  const inheritedEnv = {};
  for (const key of ['NODE_OPTIONS', 'TZ', 'LANG', 'LC_ALL', 'CI']) {
    if (process.env[key] !== undefined) inheritedEnv[key] = normalizeValue(process.env[key], root);
  }
  const normalizedArgs = args.map(arg => normalizeValue(arg, root));
  const keyData = { command: path.basename(command), entry: entryRel, args: normalizedArgs, env, inheritedEnv };
  return {
    key: hash(JSON.stringify(keyData)),
    label: `${entryRel}${normalizedArgs.slice(1).length ? ' ' + normalizedArgs.slice(1).join(' ') : ''}`,
    entry: entryRel,
    fingerprint: hash(JSON.stringify({ keyData, depHashes, node: process.versions.node, platform: process.platform, arch: process.arch })),
  };
}

function loadLedger(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed?.schema !== SCHEMA || !parsed.gates || typeof parsed.gates !== 'object') throw new Error('schema');
    return parsed;
  } catch {
    return { schema: SCHEMA, gates: {} };
  }
}

function saveLedger(file, ledger) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export function createGateRunner({ root, ledgerPath, sha, forceFull = false, spawnSync, log = console.log, warn = console.warn }) {
  const product = productFingerprint(root);
  const changelog = changelogFingerprint(root);
  // 閘門執行引擎或出貨編排本身變動時，不繼承舊帳；這類變動少，安全比省時重要。
  const shared = [
    path.join(root, 'scripts', 'pw_gpu_preload.mjs'),
    path.join(root, 'scripts', 'ship_web.mjs'),
    path.join(root, 'scripts', 'ship_web_gate_ledger.mjs'),
  ];
  const ledger = loadLedger(ledgerPath);
  let cacheWritable = true;
  let ran = 0, skipped = 0;

  const persist = () => {
    if (!cacheWritable) return;
    try {
      ledger.schema = SCHEMA;
      ledger.lastProductFingerprint = product;
      ledger.lastSha = sha;
      ledger.updatedAt = new Date().toISOString();
      saveLedger(ledgerPath, ledger);
    } catch (error) {
      cacheWritable = false;
      warn(`⚠️ ship-web 閘門帳本寫入失敗，本發改為全跑：${error.message}`);
    }
  };

  const run = (command, args = [], options = {}) => {
    const gate = path.basename(command) === 'node'
      ? gateIdentity({ root, command, args, options, sharedDependencies: shared }) : null;
    if (!gate) return spawnSync(command, args, options);
    const input = hash([product, gate.fingerprint, CHANGELOG_SENSITIVE.has(gate.entry) ? changelog : ''].join('\0'));
    const previous = ledger.gates[gate.key];
    const reusable = cacheWritable && !forceFull && !ALWAYS_RUN.has(gate.entry)
      && previous?.inputFingerprint === input;
    if (reusable) {
      skipped++;
      const message = `⏭️ 閘門帳本命中：${gate.label}（${String(previous.sha || '').slice(0, 8) || '舊紀錄'} 已通過）\n`;
      return { status: 0, signal: null, stdout: options.encoding ? message : Buffer.from(message), stderr: options.encoding ? '' : Buffer.alloc(0) };
    }
    ran++;
    const result = spawnSync(command, args, options);
    if (result.status === 0) {
      ledger.gates[gate.key] = {
        label: gate.label, entry: gate.entry, inputFingerprint: input, gateFingerprint: gate.fingerprint,
        productFingerprint: product, changelogFingerprint: CHANGELOG_SENSITIVE.has(gate.entry) ? changelog : null,
        sha, passedAt: new Date().toISOString(),
      };
      persist();
    }
    return result;
  };

  return {
    run,
    summary: () => ({ productFingerprint: product, ran, skipped, forceFull, ledgerPath, cacheWritable }),
  };
}
