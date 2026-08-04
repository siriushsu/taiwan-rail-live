#!/usr/bin/env node

// 把對外文案與資料處理行為放進同一輪驗證：同步種類取自 index.html:6379-6382，
// 雲端讀／刪與寫入資格取自 firestore.rules:9-26，前端一般同步閘門取自
// index.html:6999-7006，刪帳號順序取自 index.html:7108-7135，資格文件更新取自
// worker.js:708-719、879-896、915-949。行號只供人閱讀；判準本身解析當下檔案，不靠行號定位。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const rootAt = args.indexOf('--root');
const onlyAt = args.indexOf('--only');
const ROOT = rootAt >= 0 ? path.resolve(args[rootAt + 1] || '') : SELF_ROOT;
const ONLY = onlyAt >= 0 ? String(args[onlyAt + 1] || '') : '';

const FILES = {
  terms: 'terms.html',
  privacy: 'privacy.html',
  support: 'app-support.html',
  rules: 'firestore.rules',
  worker: 'worker.js',
  index: 'index.html',
};
const src = Object.fromEntries(Object.entries(FILES).map(([key, file]) => [key, readFileSync(path.join(ROOT, file), 'utf8')]));

// 這支吃 --root：下面的 [ROOT] 已經報了路徑，但路徑對不代表檔案是你以為的那份
// （沿用舊 worktree、或別的 session 正在改同一棵樹都照樣全綠）。逐檔 md5 才驗得到內容。
for (const [key, file] of Object.entries(FILES)) {
  console.log(`[G0] ${file} md5=${createHash('md5').update(src[key]).digest('hex')}`);
}

function stripComments(code) {
  let out = '', i = 0;
  while (i < code.length) {
    const c = code[i], n = code[i + 1];
    if (c === '/' && n === '/') { while (i < code.length && code[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c; out += c; i++;
      while (i < code.length) {
        out += code[i];
        if (code[i] === '\\') { i++; if (i < code.length) out += code[i]; i++; continue; }
        if (code[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

function extractFunction(code, name) {
  const clean = stripComments(code);
  const start = clean.search(new RegExp(`\\b(?:async\\s+)?function\\s+${name}\\s*\\(`));
  if (start < 0) throw new Error(`找不到 function ${name}`);
  const open = clean.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = open; i < clean.length; i++) {
    const c = clean[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return clean.slice(start, i + 1);
  }
  throw new Error(`function ${name} 缺少結尾`);
}

function htmlText(html) {
  return html
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[^]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[^]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[\s，。；：、（）「」『』—－]+/g, ' ').trim();
}

function sentenceWith(text, token) {
  const raw = htmlText(text);
  const at = raw.indexOf(token);
  if (at < 0) return '(未讀到)';
  return raw.slice(Math.max(0, at - 65), Math.min(raw.length, at + token.length + 105));
}

function paragraphWith(html, token) {
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([^]*?)<\/p>/gi)].map(match => htmlText(match[1]));
  return paragraphs.find(paragraph => paragraph.includes(token)) || '';
}

function elementWith(html, token) {
  const elements = [...html.matchAll(/<(?:p|li)\b[^>]*>([^]*?)<\/(?:p|li)>/gi)].map(match => htmlText(match[1]));
  return elements.find(element => element.includes(token)) || '';
}

function extractAllow(code, operations) {
  const clean = stripComments(code);
  const escaped = operations.replace(/\s+/g, '\\s*').replace(',', ',\\s*');
  const match = clean.match(new RegExp(`allow\\s+${escaped}\\s*:\\s*if\\s*([^;]+);`));
  if (!match) throw new Error(`找不到 allow ${operations}`);
  return match[1].replace(/\s+/g, ' ').trim();
}

function quotedValues(text) {
  return [...text.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]);
}

function unique(values) { return [...new Set(values)]; }
function sameSet(a, b) { return a.length === b.length && a.every(value => b.includes(value)); }
function callsNamed(code, pattern) {
  return unique([...code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map(match => match[1]).filter(name => pattern.test(name)));
}
function compact(value) { return String(value).replace(/\s+/g, ' ').trim(); }

const indexKindsMatch = stripComments(src.index).match(/const\s+USER_DATA_COLLECTIONS\s*=\s*\[([^\]]+)\]/);
if (!indexKindsMatch) throw new Error('找不到 USER_DATA_COLLECTIONS');
const indexKinds = quotedValues(indexKindsMatch[1]);
const readDeleteRule = extractAllow(src.rules, 'read, delete');
const createUpdateRule = extractAllow(src.rules, 'create, update');
const readDeleteKinds = quotedValues((readDeleteRule.match(/kind\s+in\s*\[([^\]]+)\]/) || [])[1] || '');
const createUpdateKinds = quotedValues((createUpdateRule.match(/kind\s+in\s*\[([^\]]+)\]/) || [])[1] || '');
const activeRule = extractFunction(src.rules, 'hasActiveEntitlement');
const syncFunction = extractFunction(src.index, 'accountSyncNow');
const deleteFunction = extractFunction(src.index, 'accountDelete');
const entitlementDocumentFunction = extractFunction(src.worker, 'plusEntitlementDocument');
const writeEntitlementFunction = extractFunction(src.worker, 'writePlusEntitlement');
const plusStatusFunction = extractFunction(src.worker, 'plusStatus');
const webhookFunction = extractFunction(src.worker, 'revenueCatWebhook');

const docs = { terms: htmlText(src.terms), privacy: htmlText(src.privacy), support: htmlText(src.support) };
const privacySyncList = htmlText((src.privacy.match(/<p>Plus 訂閱有效且登入後[^]*?<\/ul>/) || [])[0] || '');
const scopes = {
  termsAccount: paragraphWith(src.terms, '跨裝置同步屬軌島 Plus 功能'),
  termsTakeout: paragraphWith(src.terms, '你應只匯入自己有權使用'),
  privacyAccount: paragraphWith(src.privacy, '軌島使用這些資料建立帳號'),
  privacySyncList,
  privacyTakeout: paragraphWith(src.privacy, 'Google Takeout ZIP'),
  privacyInactive: paragraphWith(src.privacy, '沒有有效 Plus 資格時'),
  privacyRetention: elementWith(src.privacy, '曾在 Plus 資格有效期間同步'),
  supportLead: paragraphWith(src.support, '帳號用於在 Plus 資格有效期間'),
  supportTakeout: paragraphWith(src.support, '原始檔案只在裝置內解析'),
  supportInactive: paragraphWith(src.support, '沒有有效 Plus 資格時'),
};
const docConcepts = {
  最愛地點: /最愛地點/,
  最愛列車: /最愛列車/,
  最愛車站: /最愛車站/,
  完乘紀錄: /完乘(?:紀錄|日期)/,
};
const docLabels = Object.keys(docConcepts);

const assertions = [];
function check(id, side, title, run) { assertions.push({ id, side, title, run }); }

check('D1-SYNC-CATEGORIES', '文案', '三份文件都逐項說明同一組同步資料', () => {
  const found = Object.fromEntries(Object.entries({ terms: scopes.termsAccount, privacy: scopes.privacySyncList, support: scopes.supportInactive }).map(([name, text]) => [name, docLabels.filter(label => docConcepts[label].test(text))]));
  return {
    pass: Object.values(found).every(labels => sameSet(labels, docLabels)),
    detail: Object.entries(found).map(([name, labels]) => `${name}=[${labels.join('、') || '無'}]`).join('；'),
  };
});

check('D2-ACTIVE-LOGIN', '文案', '三份文件都把有效資格與登入寫成雲端同步條件', () => {
  const claims = {
    termsAccount: scopes.termsAccount,
    termsTakeout: scopes.termsTakeout,
    privacyAccount: scopes.privacyAccount,
    privacySyncList: scopes.privacySyncList,
    privacyTakeout: scopes.privacyTakeout,
    supportLead: scopes.supportLead,
    supportTakeout: scopes.supportTakeout,
  };
  const found = Object.fromEntries(Object.entries(claims).map(([name, text]) => {
    const effective = /(?:Plus\s*)?(?:訂閱|資格)有效(?:期間)?/.test(text);
    const login = /登入|帳號用於/.test(text);
    const at = text.indexOf('有效');
    const read = at >= 0 ? text.slice(Math.max(0, at - 38), at + 62) : text.slice(0, 100);
    return [name, { effective, login, read: read || '未讀到' }];
  }));
  const pass = Object.values(found).every(value => value.effective && value.login);
  return { pass, detail: Object.entries(found).map(([name, value]) => `${name}={有效:${value.effective},登入:${value.login},讀到:${value.read}}`).join('；') };
});

check('D3-INACTIVE-LOCAL', '文案', '三份文件都交代無有效資格時新變更留在裝置且不寫雲端', () => {
  const found = Object.fromEntries(Object.entries({ terms: scopes.termsAccount, privacy: scopes.privacyInactive, support: scopes.supportInactive }).map(([name, text]) => {
    const noActive = /沒有有效.{0,12}(?:訂閱|資格)/.test(text);
    const local = /(?:新變更.{0,40}(?:留在|保存在).{0,20}(?:裝置|本機)|(?:裝置|本機).{0,30}新增或修改.{0,55}(?:留在|保存在).{0,20}(?:裝置|本機))/.test(text);
    const noCloudWrite = /(?:只有在.{0,35}有效.{0,55}新變更.{0,30}才會寫入雲端|新變更.{0,35}不會寫入雲端|新增或修改.{0,80}不會寫入雲端)/.test(text);
    return [name, { noActive, local, noCloudWrite }];
  }));
  const pass = Object.values(found).every(value => value.noActive && value.local && value.noCloudWrite);
  return { pass, detail: Object.entries(found).map(([name, value]) => `${name}={無有效:${value.noActive},本機:${value.local},不寫雲端:${value.noCloudWrite}}`).join('；') };
});

check('D4-LAPSED-RETENTION', '文案', '三份文件都交代資格失效不會自動刪除既有雲端副本', () => {
  const found = Object.fromEntries(Object.entries({ terms: scopes.termsAccount, privacyContent: scopes.privacyInactive, privacyRetention: scopes.privacyRetention, support: scopes.supportInactive }).map(([name, plain]) => {
    const trigger = /資格失效/.test(plain) || (/(?:停止訂閱|失去 Plus 資格)/.test(plain) && /到期/.test(plain) && /退款/.test(plain));
    const retention = /(?:雲端副本.{0,25}不會.{0,10}自動刪除|雲端副本.{0,80}不會.{0,45}自動刪除|不會.{0,10}自動刪除.{0,15}雲端副本)/.test(plain);
    const untilDelete = /雲端副本.{0,150}刪除.{0,12}(?:軌島)?帳號/.test(plain);
    const at = plain.indexOf('自動刪除');
    const claim = at >= 0 ? plain.slice(Math.max(0, at - 72), at + 72) : plain.slice(0, 144) || '未讀到';
    return [name, { trigger, retention, untilDelete, claim }];
  }));
  const pass = Object.values(found).every(value => value.trigger && value.retention && value.untilDelete);
  return { pass, detail: Object.entries(found).map(([name, value]) => `${name}={失效情境:${value.trigger},不自刪:${value.retention},留至刪帳:${value.untilDelete},讀到:${value.claim}}`).join('；') };
});

check('D5-OWNER-ACCESS', '文案', '隱私政策區分本人讀刪與有效資格寫入', () => {
  const privacy = docs.privacy;
  const ownerReadDelete = /只允許本人讀取或刪除自己的資料/.test(privacy);
  const activeWrite = /新增或更新雲端資料.{0,20}(?:需要|需).{0,12}有效.{0,8}Plus 資格/.test(privacy);
  return { pass: ownerReadDelete && activeWrite, detail: `本人讀刪=${ownerReadDelete}；有效資格寫入=${activeWrite}；讀到=${sentenceWith(src.privacy, '存取控制')}` };
});

check('D6-ACCOUNT-DELETION', '文案', '三份文件都提供刪除帳號與同步資料的說明', () => {
  const found = {
    terms: /刪除後.{0,12}無法復原.{0,12}同步資料/.test(docs.terms),
    privacy: /刪除帳號會刪除.{0,45}(?:四類同步資料|同步資料)/.test(docs.privacy),
    support: /刪除帳號與同步資料/.test(docs.support) && /無論 Plus 資格是否仍有效/.test(docs.support),
  };
  return { pass: Object.values(found).every(Boolean), detail: Object.entries(found).map(([name, value]) => `${name}=${value}`).join('；') };
});

check('B1-SYNC-KINDS', '行為', '前端同步集合與規則允許集合一致', () => ({
  pass: sameSet(indexKinds, readDeleteKinds) && sameSet(indexKinds, createUpdateKinds),
  detail: `index.USER_DATA_COLLECTIONS=[${indexKinds.join(',')}]; read/delete.kind=[${readDeleteKinds.join(',')}]; create/update.kind=[${createUpdateKinds.join(',')}]`,
}));

check('B2-WRITE-ENTITLEMENT', '行為', '雲端新增與更新要求本人、有效資格及未過期', () => {
  const hasOwner = /\bowns\s*\(\s*uid\s*\)/.test(createUpdateRule);
  const callsGate = /\bhasActiveEntitlement\s*\(\s*uid\s*\)/.test(createUpdateRule);
  const exists = /entitlement\s*!=\s*null/.test(activeRule);
  const active = /\.data\.active\s*==\s*true/.test(activeRule);
  const unexpired = /activeUntilMs\s*==\s*0/.test(activeRule) && /activeUntilMs\s*>\s*request\.time\.toMillis\(\)/.test(activeRule);
  return { pass: hasOwner && callsGate && exists && active && unexpired, detail: `create/update.owns=${hasOwner}；create/update.hasActiveEntitlement=${callsGate}；gate=${compact(activeRule.match(/return[^;]+;/s)?.[0] || '未讀到')}` };
});

check('B3-READ-DELETE-NO-PLUS', '行為', '本人讀取與刪除不套用 Plus 資格條件', () => {
  const collect = expression => [...expression.matchAll(/\bhasActiveEntitlement\s*\(/g)].map(match => match.index);
  const readRefs = collect(readDeleteRule), writeRefs = collect(createUpdateRule);
  return { pass: readRefs.length === 0 && writeRefs.length > 0 && /\bowns\s*\(\s*uid\s*\)/.test(readDeleteRule), detail: `同一收集器 read/delete.hasActiveEntitlement=[${readRefs.join(',') || '無'}]；create/update.hasActiveEntitlement=[${writeRefs.join(',') || '無'}]；read/delete=${readDeleteRule}` };
});

check('B4-FRONTEND-SYNC-GATE', '行為', '前端非登出同步路徑在無有效資格時先停止', () => {
  const gate = syncFunction.match(/if\s*\([^\n{};]*!plusIsActive\(\)[^\n{};]*\)\s*return\s+false\s*;/)?.[0] || '';
  const manualCall = stripComments(src.index).match(/accountSyncNow\s*\(\s*['"]manual['"]\s*\)/)?.[0] || '';
  return { pass: !!gate && !!manualCall, detail: `accountSyncNow 閘門=${compact(gate) || '未讀到'}；手動同步呼叫=${manualCall || '未讀到'}；未對登出成功、重試或清本機結果下斷言` };
});

check('B5-ACCOUNT-DELETE', '行為', '刪帳號逐份刪除同步資料且不要求 Plus', () => {
  const deleteDocAt = deleteFunction.indexOf('deleteDoc(');
  const deleteUserAt = deleteFunction.indexOf('deleteUser(');
  const clearLocalAt = deleteFunction.indexOf('accountClearLocal(');
  const plusCollector = code => [...code.matchAll(/\bplusIsActive\s*\(/g)].map(match => match.index);
  const deletePlusRefs = plusCollector(deleteFunction), syncPlusRefs = plusCollector(syncFunction);
  const iteratesKinds = /for\s*\(\s*const\s+kind\s+of\s+USER_DATA_COLLECTIONS\s*\)/.test(deleteFunction);
  const ordered = deleteDocAt >= 0 && deleteDocAt < deleteUserAt && deleteUserAt < clearLocalAt;
  return { pass: iteratesKinds && ordered && deletePlusRefs.length === 0 && syncPlusRefs.length > 0, detail: `集合迭代=${iteratesKinds}；順序 deleteDoc@${deleteDocAt}<deleteUser@${deleteUserAt}<accountClearLocal@${clearLocalAt}=${ordered}；同一收集器 accountDelete.plusIsActive=[${deletePlusRefs.join(',') || '無'}]／accountSyncNow.plusIsActive=[${syncPlusRefs.join(',') || '無'}]` };
});

check('B6-LAPSED-CLOUD-RETENTION', '行為', '資格失效寫成 inactive，資格更新流程不刪同步資料', async () => {
  // 從 ROOT 的實體檔案載入,不要把原始碼包成 data: URL——data: 模組沒有目錄,worker.js 裡
  // 任何相對 import(北捷看板帳本那支)都會 "Failed to resolve module specifier" 而整條斷言掛掉。
  // 2026-08-04 併 origin/main 時實際踩到:兩條分支各自都綠,合起來才顯形。
  const workerModule = await import(pathToFileURL(path.join(ROOT, FILES.worker)).href);
  const makeDoc = workerModule._plus && workerModule._plus.plusEntitlementDocument;
  if (typeof makeDoc !== 'function') return { pass: false, detail: '未讀到 _plus.plusEntitlementDocument 導出' };
  const inactive = makeDoc({ items: [] }, 'plus', 'verify');
  const active = makeDoc({ items: [{ gives_access: true, environment: 'production', entitlements: { items: [{ lookup_key: 'plus' }] } }] }, 'plus', 'verify');
  const qualificationFlow = [plusStatusFunction, webhookFunction, writeEntitlementFunction].join('\n');
  const destructiveCollector = code => callsNamed(code.slice(code.indexOf('{') + 1), /(?:delete|remove|purge)/i);
  const qualificationDeletes = destructiveCollector(qualificationFlow);
  const accountDeletes = destructiveCollector(deleteFunction);
  const statusWrites = /\bwritePlusEntitlement\s*\(/.test(plusStatusFunction);
  const webhookWrites = /\bwritePlusEntitlement\s*\(/.test(webhookFunction);
  const entitlementPath = /documents\/entitlements\/\$\{documentId\}/.test(writeEntitlementFunction);
  return {
    pass: inactive.active === false && active.active === true && statusWrites && webhookWrites && entitlementPath && qualificationDeletes.length === 0 && accountDeletes.length > 0,
    detail: `空資格→active=${inactive.active}；有效正向對照→active=${active.active}；plus-status 寫資格=${statusWrites}；webhook 寫資格=${webhookWrites}；寫入路徑=entitlements:${entitlementPath}；同一破壞呼叫收集器 資格更新=[${qualificationDeletes.join(',') || '無'}]／accountDelete=[${accountDeletes.join(',') || '無'}]`,
  };
});

const selected = ONLY ? assertions.filter(assertion => assertion.id === ONLY) : assertions;
if (ONLY && selected.length === 0) {
  console.error(`FAIL UNKNOWN — 找不到判準 ${ONLY}`);
  process.exit(1);
}

console.log(`[ROOT] ${ROOT}`);
console.log(`[FILES] ${Object.values(FILES).join(', ')}`);
const results = [];
for (const assertion of selected) {
  try {
    const result = await assertion.run();
    results.push({ ...assertion, ...result });
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${assertion.id} [${assertion.side}] ${assertion.title} — ${result.detail}`);
  } catch (error) {
    results.push({ ...assertion, pass: false, detail: String(error && error.message || error) });
    console.log(`FAIL ${assertion.id} [${assertion.side}] ${assertion.title} — 例外：${String(error && error.message || error)}`);
  }
}

const passed = results.filter(result => result.pass).length;
console.log(`[SUMMARY] ${passed}/${results.length} PASS`);
if (passed !== results.length) process.exit(1);
