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
  // 這兩支在正式出貨鏈會真讀 railisland.tw 的即時 API；liveness 結果不得跨發複用。
  'scripts/verify_obs_removed.mjs',
  'scripts/verify_thsr_seat.mjs',
  // 夜間 gate 把 live OpenFreeMap building tiles 的數量／pixel／areTilesLoaded 當斷言輸入。
  'scripts/verify_night_design.mjs',
  // 這支 meta-gate 會動態掃全體 verify_*.mjs，無法用靜態 import closure 完整表達。
  'scripts/verify_engine_adapter.mjs',
  // 這支會讀 ship_web.mjs 做靜態接線檢查，那個被讀檔不是 import，不能只靠 import closure。
  'scripts/verify_ship_web_guard.mjs',
]);
// 這幾支是 composite gate：用 child_process 跑其他 verifier，而不是 import。只列明確的
// child，避免掃描註解裡所有 *.mjs 名字後把不相干的幾百支 gate 串成同一個 closure。
const EXTRA_GATE_DEPENDENCIES = new Map([
  ['scripts/verify_bus_transfer_all.mjs', [
    'scripts/verify_bus_transfer_core.mjs', 'scripts/verify_bus_transfer_index.mjs',
    'scripts/verify_bus_transfer_ui.mjs', 'scripts/verify_bus_transfer_worker.mjs',
    'scripts/verify_journey_share_worker.mjs', 'scripts/verify_bus_transfer_gate.mjs',
    'scripts/verify_bus_transfer_i18n.mjs', 'scripts/verify_bus_transfer_ui_server.mjs',
    'scripts/verify_bus_transfer_ui_browser.mjs',
  ]],
  ['scripts/verify_view_controls_gate.mjs', [
    'scripts/verify_view_controls_immersive.mjs', 'scripts/verify_ground_size.mjs',
    'scripts/verify_view_btn_side_entry.mjs',
  ]],
  ['scripts/verify_thsr_seat.mjs', [
    'scripts/dev_server.mjs', 'scripts/verify_punctual.mjs', 'scripts/verify_my_trains.mjs',
  ]],
  ['scripts/check_voice.mjs', ['docs/voice-rules.json']],
  ['scripts/verify_bounty_all.mjs', [
    'scripts/verify_bounty_hardening.mjs', 'scripts/verify_bounty_schema.mjs', 'scripts/verify_bounty_valuation.mjs',
    'scripts/verify_bounty_gates.mjs', 'scripts/verify_bounty_dwell.mjs', 'scripts/verify_bounty_api.mjs',
    'scripts/verify_bounty_ledger.mjs', 'scripts/verify_bounty_chips.mjs', 'scripts/verify_bounty_rules.mjs',
    'scripts/verify_bounty_redeem.mjs', 'scripts/verify_bounty_cloud.mjs', 'scripts/verify_bounty_merge.mjs',
    'scripts/verify_bounty_cron.mjs', 'scripts/verify_bounty_auth.mjs', 'scripts/verify_bounty_cron2.mjs',
    'scripts/verify_bounty_merge_web.mjs', 'scripts/verify_bounty_recorder_web.mjs', 'scripts/verify_bounty_chips_web.mjs',
  ]],
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

function normalizeChangelogForProduct(block) {
  let out = String(block);
  // 只略過公開紀錄既有的純文案 entry。li／span 若多出 onclick、script 等結構，callback
  // 會保留原文，產品指紋便會改變；data-cl 配對仍交給每次必重跑的 changelog gate。
  const marker = '<!-- ship-web:changelog-entries -->';
  out = out.replace(/<li\b([^>]*)>\s*<span\b([^>]*)>([^<]*)<\/span>\s*<span>([\s\S]*?)<\/span>\s*<\/li>/gi,
    (whole, liAttrs, dateAttrs, _date, copy) => {
      const li = liAttrs.trim();
      const allowedLi = !li || /^(?:data-cl(?:-of)?=(?:"[^"]*"|'[^']*')\s*)+$/.test(li);
      const allowedDate = /^class=(?:"d"|'d')$/.test(dateAttrs.trim());
      const allowedCopy = !/<(?!\/?b\s*>)/i.test(copy);
      return allowedLi && allowedDate && allowedCopy ? marker : whole;
    });
  // 同一主題裡增刪純文案 entry 不改產品；grp／ul／details／註解等結構仍原樣入指紋。
  out = out.replace(new RegExp(`(?:\\s*${marker}\\s*)+`, 'g'), `\n${marker}\n`);
  out = out.replace(/(<span class="foot-sub">)\s*\u6700\u5f8c\u66f4\u65b0\uff1a[^<]*(<\/span>)/,
    '$1<ship-web-last-update>$2');
  return out;
}

export function normalizeIndexForProduct(html) {
  let out = String(html);
  const block = changelogBlock(out);
  if (block) out = out.replace(block, normalizeChangelogForProduct(block));
  // 版本履歷只有在 marker 到 BUILD 之間逐行都是註解／空白時才略過。先前用 [\s\S]*?
  // 會把意外插在這段裡的可執行碼也正規化掉，讓產品真的變了卻誤吃舊帳。
  const historyStart = out.indexOf('// \u7248\u672c\u6233\u8a18:');
  const buildMatch = historyStart >= 0
    ? /^[ \t]*const BUILD[ \t]*=[ \t]*'[^'\r\n]*'[ \t]*;[ \t]*(?=\r?$)/m.exec(out.slice(historyStart))
    : null;
  const buildStart = buildMatch ? historyStart + buildMatch.index : -1;
  if (buildStart > historyStart) {
    const history = out.slice(historyStart, buildStart);
    // 若 marker 到候選宣告間不是純註解，候選很可能只是 template literal
    // 內的 payload。這時整段都不忽略，不只保留 history 卻仍改掉假 BUILD。
    if (history.split(/\r?\n/).every(line => !line.trim() || /^\s*\/\//.test(line))) {
      out = out.slice(0, historyStart) + '// ship-web:build-history\n'
        + "const BUILD = '<ship-web-build>';" + out.slice(buildStart + buildMatch[0].length);
    }
  }
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

function resolveLocal(root, from, specifier) {
  const bases = specifier.startsWith('.')
    ? [path.resolve(path.dirname(from), specifier)]
    : specifier.includes('/')
      ? [path.resolve(root, specifier), path.resolve(path.dirname(from), specifier)]
      : [path.resolve(path.dirname(from), specifier), path.resolve(root, specifier)];
  for (const base of bases) for (const candidate of [base, `${base}.mjs`, `${base}.js`, `${base}.cjs`, `${base}.json`, path.join(base, 'index.mjs'), path.join(base, 'index.js')]) {
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
    if (!/\.(?:mjs|js|cjs)$/.test(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of new Set([...importSpecifiers(source), ...(EXTRA_GATE_DEPENDENCIES.get(rel) || [])])) {
      const imported = resolveLocal(root, file, specifier);
      if (imported) queue.push(imported);
    }
  }
  return result.sort();
}

function normalizeValue(value, root) {
  return String(value).split(root).join('<ROOT>');
}

// 只把 gate 本身與本地 import closure 實際讀到的環境鍵納入 identity。整包 process.env
// 會讓 PWD、終端 session 等無關差異吃掉 preview→正式的命中；完全不納入則 TEST_DATE
// 之類的測試旋鈕改了仍會誤吃舊綠燈。只回傳鍵名，值在下面先雜湊，不落進帳本。
export function referencedEnvironmentKeys(root, files) {
  const keys = new Set();
  for (const rel of files) {
    if (!/\.(?:mjs|js|cjs)$/.test(rel)) continue;
    const source = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const re of [
      /\bprocess\.env\??\.([A-Za-z_$][\w$]*)/g,
      /\bprocess\.env(?:\?\.)?\[\s*(['"])([^'"]+)\1\s*\]/g,
    ]) for (let match; (match = re.exec(source));) keys.add(match[2] || match[1]);
    const destructuring = /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*process\.env\b/g;
    for (let match; (match = destructuring.exec(source));) {
      for (const part of match[1].split(',')) {
        const property = part.trim().match(/^(?:['"]([^'"]+)['"]|([A-Za-z_$][\w$]*))/);
        if (property) keys.add(property[1] || property[2]);
      }
    }
    // 已知形態擷取後若還有 process.env（如 process.env[variable]、const env=process.env；
    // env.KEY），無法可靠靜態還原；該 gate 改採完整 effective env 指紋。
    const residual = source
      .replace(/\bprocess\.env\??\.[A-Za-z_$][\w$]*/g, '')
      .replace(/\bprocess\.env(?:\?\.)?\[\s*(['"])[^'"]+\1\s*\]/g, '')
      .replace(/\b(?:const|let|var)\s*\{[^}]*\}\s*=\s*process\.env\b/g, '');
    if (/\bprocess\.env\b/.test(residual)) keys.add('*');
  }
  return [...keys].sort();
}

function environmentValueDigest(env, key, root) {
  const present = Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined;
  return hash(JSON.stringify({ present, value: present ? normalizeValue(env[key], root) : null }));
}

export function taipeiDay(at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function gateIdentity({ root, command, args = [], options = {}, sharedDependencies = [], serviceDay = taipeiDay() }) {
  const entry = args.find(arg => typeof arg === 'string' && /\.(?:mjs|js)$/.test(arg) && within(root, path.resolve(arg)));
  if (!entry) return null;
  const entryAbs = path.resolve(entry);
  const entryRel = within(root, entryAbs);
  const gateDependencies = dependencyFiles(root, entryAbs);
  const deps = new Set(gateDependencies);
  for (const file of sharedDependencies) if (fs.existsSync(file)) {
    const rel = within(root, file); if (rel) deps.add(rel);
  }
  const depHashes = [...deps].sort().map(rel => [rel, hash(fs.readFileSync(path.join(root, rel)))]);
  const effectiveEnv = options.env || process.env;
  const env = [];
  if (options.env) for (const [key, value] of Object.entries(options.env).sort(([a], [b]) => a.localeCompare(b))) {
    if (String(value ?? '') !== String(process.env[key] ?? '')) env.push([key, environmentValueDigest(options.env, key, root)]);
  }
  const referencedKeys = new Set(referencedEnvironmentKeys(root, gateDependencies));
  const inheritedKeys = new Set([
    'NODE_OPTIONS', 'TZ', 'LANG', 'LC_ALL', 'CI',
    ...(referencedKeys.has('*') ? Object.keys(effectiveEnv) : referencedKeys),
  ]);
  inheritedKeys.delete('*');
  const inheritedEnv = [...inheritedKeys].sort().map(key => [key, environmentValueDigest(effectiveEnv, key, root)]);
  const normalizedArgs = args.map(arg => normalizeValue(arg, root));
  const keyData = { command: path.basename(command), entry: entryRel, args: normalizedArgs, env, inheritedEnv };
  return {
    key: hash(JSON.stringify(keyData)),
    label: `${entryRel}${normalizedArgs.slice(1).length ? ' ' + normalizedArgs.slice(1).join(' ') : ''}`,
    entry: entryRel,
    // 多支 gate 會讀「今天」或內建到期日。台灣日只放 fingerprint、不放 key：隔日覆寫
    // 同一格而不是每天長一批 key；同日 preview→正式仍可共用。
    fingerprint: hash(JSON.stringify({ keyData, depHashes, serviceDay,
      node: process.versions.node, platform: process.platform, arch: process.arch })),
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

export function createGateRunner({ root, ledgerPath, sha, forceFull = false, serviceDay, spawnSync, log = console.log, warn = console.warn }) {
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
    // ship-web 可能跨過台灣日界線；每道 gate 在查帳當下取日，不在 runner 建立時凍結。
    const currentServiceDay = typeof serviceDay === 'function' ? serviceDay() : serviceDay || taipeiDay();
    const gate = path.basename(command) === 'node'
      ? gateIdentity({ root, command, args, options, sharedDependencies: shared, serviceDay: currentServiceDay }) : null;
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
    summary: () => ({ productFingerprint: product, ran, skipped, forceFull, serviceDay: typeof serviceDay === 'string' ? serviceDay : taipeiDay(), ledgerPath, cacheWritable }),
  };
}
