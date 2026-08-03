// 用 Firestore 規則模擬器實測 firestore.rules（不是讀規則檔用推論）。
//
// 跑法（java 是 keg-only，要自己進 PATH）：
//   PATH="/usr/local/opt/openjdk/bin:$PATH" \
//   node_modules/.bin/firebase emulators:exec --only firestore --project demo-rail \
//     'node scripts/verify_firestore_rules.mjs'
//
// 專案 id 用 `demo-` 前綴 ⇒ 模擬器完全離線，不需要任何憑證，也絕不會碰到正式資料。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RULES_PATH = path.join(ROOT, 'firestore.rules');
const RULES = readFileSync(RULES_PATH, 'utf8');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] firestore.rules md5=${createHash('md5').update(RULES).digest('hex')}`);

const PORT = Number(process.env.FIRESTORE_EMULATOR_PORT || (process.env.FIRESTORE_EMULATOR_HOST || '').split(':')[1] || 8080);

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-rail',
  firestore: { rules: RULES, host: '127.0.0.1', port: PORT },
});

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log(`PASS ${name}`); }
  catch (e) { fail++; console.log(`FAIL ${name} — ${e && e.message ? e.message : String(e)}`); }
}

const UID_A = 'uid-a', UID_B = 'uid-b';
// 合法的同步文件形狀，逐欄對齊 rules 的 hasOnly 白名單。
const validDoc = () => ({
  version: 1, kind: 'favs', revision: 1, clientUpdatedAt: Date.now(),
  items: [], tombstones: [], updatedAt: serverTimestamp(),
});

const dataRef = (db, uid, kind = 'favs') => doc(db, 'users', uid, 'data', kind);

// ── 現行規則的既有保證（Task 8 收緊之後這些都不得退化）────────────────────────
await check('R1 本人可以寫自己的同步文件', async () => {
  const db = testEnv.authenticatedContext(UID_A).firestore();
  await assertSucceeds(setDoc(dataRef(db, UID_A), validDoc()));
});

await check('R2 本人可以讀自己的同步文件', async () => {
  const db = testEnv.authenticatedContext(UID_A).firestore();
  await assertSucceeds(getDoc(dataRef(db, UID_A)));
});

await check('R3 本人可以刪自己的同步文件（帳號刪除要走這條）', async () => {
  const db = testEnv.authenticatedContext(UID_A).firestore();
  await assertSucceeds(deleteDoc(dataRef(db, UID_A)));
});

await check('R4 別人的 uid 一律寫不了', async () => {
  const db = testEnv.authenticatedContext(UID_B).firestore();
  await assertFails(setDoc(dataRef(db, UID_A), validDoc()));
});

await check('R5 別人的 uid 一律讀不了', async () => {
  const db = testEnv.authenticatedContext(UID_B).firestore();
  await assertFails(getDoc(dataRef(db, UID_A)));
});

await check('R6 未登入一律寫不了', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(setDoc(dataRef(db, UID_A), validDoc()));
});

await check('R7 不在白名單的 kind 寫不了', async () => {
  const db = testEnv.authenticatedContext(UID_A).firestore();
  await assertFails(setDoc(dataRef(db, UID_A, 'secrets'), { ...validDoc(), kind: 'secrets' }));
});

await check('R8 多帶一個欄位就寫不了（hasOnly 白名單有牙）', async () => {
  const db = testEnv.authenticatedContext(UID_A).firestore();
  await assertFails(setDoc(dataRef(db, UID_A), { ...validDoc(), evil: 1 }));
});

await check('R9 entitlements 客戶端一律寫不了（只能由後端 Admin 憑證寫）', async () => {
  const db = testEnv.authenticatedContext(UID_A).firestore();
  await assertFails(setDoc(doc(db, 'entitlements', UID_A), { active: true }));
});

await check('R10 entitlements 本人讀得到', async () => {
  const db = testEnv.authenticatedContext(UID_A).firestore();
  await assertSucceeds(getDoc(doc(db, 'entitlements', UID_A)));
});

await testEnv.cleanup();
console.log(`\n合計 ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
