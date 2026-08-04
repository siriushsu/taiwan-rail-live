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

// 任何提早離開的路徑（例外、reject、逾時）都要印得出可辨識的一行——空輸出或裸 Node stack
// trace 會被「grep 有沒有 FAIL」的判斷者（人或 CI）誤讀成全綠。這是本批次真的踩到的坑。
function bail(line) {
  console.log(line);
  process.exit(1);
}
process.on('unhandledRejection', (reason) => {
  bail(`FAIL unhandled rejection — ${reason && reason.message ? reason.message : String(reason)}`);
});
process.on('uncaughtException', (err) => {
  bail(`FAIL uncaught exception — ${err && err.message ? err.message : String(err)}`);
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RULES_PATH = path.join(ROOT, 'firestore.rules');
const RULES = readFileSync(RULES_PATH, 'utf8');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] firestore.rules md5=${createHash('md5').update(RULES).digest('hex')}`);

// 預期會執行的斷言數。具名常數，刻意寫死——**不可**從下面的 pass/fail 計數自己推導，
// 那樣「少跑幾條」永遠會自動通過，這道閘門就變成零資訊的裝飾品。
const EXPECTED_CHECK_COUNT = 14;

const HOST = '127.0.0.1';
const PORT = Number(process.env.FIRESTORE_EMULATOR_PORT || (process.env.FIRESTORE_EMULATOR_HOST || '').split(':')[1] || 8080);

// 啟動前先比對 env port 與 firebase.json：不一致就直接 FAIL 並把兩個值都印出來，不要等到
// 連線逾時才發現——這正是本批次踩到的真實情境（用了 8579，firebase.json 宣告 8577）。
const FIREBASE_JSON_PATH = path.join(ROOT, 'firebase.json');
const firebaseJson = JSON.parse(readFileSync(FIREBASE_JSON_PATH, 'utf8'));
const DECLARED_PORT = firebaseJson?.emulators?.firestore?.port;
if (typeof DECLARED_PORT !== 'number') {
  bail(`FAIL firebase.json 沒有宣告 emulators.firestore.port（path=${FIREBASE_JSON_PATH}）`);
}
if (PORT !== DECLARED_PORT) {
  bail(`FAIL port 不一致 — env 解析出 FIRESTORE_EMULATOR_PORT=${PORT}，但 firebase.json 宣告 `
    + `emulators.firestore.port=${DECLARED_PORT}（兩者必須相同，否則模擬器沒連上也不會有人發現）`);
}

// 連不上要大聲失敗：具名 timeout＋具名 catch。沒有這層時，模擬器沒起來只會是一則沒有
// 「FAIL」字樣的裸 Node stack trace（見 Codex 2026-08-04 Minor 3）。
const CONNECT_TIMEOUT_MS = 15_000;
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 逾時 ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

let testEnv;
try {
  testEnv = await withTimeout(
    initializeTestEnvironment({
      projectId: 'demo-rail',
      firestore: { rules: RULES, host: HOST, port: PORT },
    }),
    CONNECT_TIMEOUT_MS,
    `connect ${HOST}:${PORT}`,
  );
} catch (e) {
  bail(`FAIL emulator connection ${HOST}:${PORT} — ${e && e.message ? e.message : String(e)}`);
}

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log(`PASS ${name}`); }
  catch (e) { fail++; console.log(`FAIL ${name} — ${e && e.message ? e.message : String(e)}`); }
}

const UID_A = 'uid-a', UID_B = 'uid-b';
// 合法的同步文件形狀，逐欄對齊 rules 的 hasOnly 白名單。
const validDoc = (kind = 'favs', revision = 1) => ({
  version: 1, kind, revision, clientUpdatedAt: Date.now(),
  items: [], tombstones: [], updatedAt: serverTimestamp(),
});

const dataRef = (db, uid, kind = 'favs') => doc(db, 'users', uid, 'data', kind);
const entitlementRef = (db, uid) => doc(db, 'entitlements', uid);
const entitlementDoc = ({ active = true, activeUntilMs = Date.now() + 86_400_000 } = {}) => ({
  active, activeUntilMs, updatedAtMs: Date.now(), source: 'plus-status',
});

async function seedEntitlement(uid, data = entitlementDoc()) {
  await testEnv.withSecurityRulesDisabled(async context => {
    await assertSucceeds(setDoc(entitlementRef(context.firestore(), uid), data));
  });
}

async function removeEntitlement(uid) {
  await testEnv.withSecurityRulesDisabled(async context => {
    await deleteDoc(entitlementRef(context.firestore(), uid));
  });
}

async function seedData(uid, kind = 'favs') {
  await testEnv.withSecurityRulesDisabled(async context => {
    await assertSucceeds(setDoc(dataRef(context.firestore(), uid, kind), validDoc(kind)));
  });
}

async function removeData(uid, kind = 'favs') {
  await testEnv.withSecurityRulesDisabled(async context => {
    await deleteDoc(dataRef(context.firestore(), uid, kind));
  });
}

// ── 現行規則的既有保證（Task 8 收緊之後這些都不得退化）────────────────────────
await check('R1 本人有有效資格時可以建立與更新自己的同步文件', async () => {
  await seedEntitlement(UID_A);
  const db = testEnv.authenticatedContext(UID_A).firestore();
  await assertSucceeds(setDoc(dataRef(db, UID_A), validDoc()));
  await assertSucceeds(setDoc(dataRef(db, UID_A), validDoc('favs', 2)));
});

await check('R2 本人無資格仍可以讀自己的同步文件', async () => {
  const uid = 'r2-no-entitlement';
  await removeEntitlement(uid);
  await seedData(uid);
  const db = testEnv.authenticatedContext(uid).firestore();
  await assertSucceeds(getDoc(dataRef(db, uid)));
});

await check('R3 本人無資格仍可以刪自己的同步文件（帳號刪除要走這條）', async () => {
  const uid = 'r3-no-entitlement';
  await removeEntitlement(uid);
  await seedData(uid);
  const db = testEnv.authenticatedContext(uid).firestore();
  await assertSucceeds(deleteDoc(dataRef(db, uid)));
});

await check('R4 別人的 uid 一律寫不了', async () => {
  const uid = 'r4-owner';
  await seedEntitlement(uid);
  const intruderDb = testEnv.authenticatedContext(UID_B).firestore();
  const ownerDb = testEnv.authenticatedContext(uid).firestore();
  await removeData(uid);
  await assertFails(setDoc(dataRef(intruderDb, uid), validDoc()));
  await assertSucceeds(setDoc(dataRef(ownerDb, uid), validDoc()));
  await assertFails(setDoc(dataRef(intruderDb, uid), validDoc('favs', 2)));
  await assertSucceeds(setDoc(dataRef(ownerDb, uid), validDoc('favs', 2)));
  await assertFails(deleteDoc(dataRef(intruderDb, uid)));
  await assertSucceeds(deleteDoc(dataRef(ownerDb, uid)));
});

await check('R5 別人的 uid 一律讀不了', async () => {
  const uid = 'r5-owner';
  await seedEntitlement(uid);
  await seedData(uid);
  const intruderDb = testEnv.authenticatedContext(UID_B).firestore();
  const ownerDb = testEnv.authenticatedContext(uid).firestore();
  await assertFails(getDoc(dataRef(intruderDb, uid)));
  await assertSucceeds(getDoc(dataRef(ownerDb, uid)));
});

await check('R6 未登入一律寫不了', async () => {
  const uid = 'r6-owner';
  await seedEntitlement(uid);
  const unauthDb = testEnv.unauthenticatedContext().firestore();
  const ownerDb = testEnv.authenticatedContext(uid).firestore();
  await assertFails(setDoc(dataRef(unauthDb, uid), validDoc()));
  await assertSucceeds(setDoc(dataRef(ownerDb, uid), validDoc()));
});

await check('R7 不在白名單的 kind 寫不了', async () => {
  const uid = 'r7-owner';
  await seedEntitlement(uid);
  const db = testEnv.authenticatedContext(uid).firestore();
  await assertFails(setDoc(dataRef(db, uid, 'secrets'), validDoc('secrets')));
  await assertSucceeds(setDoc(dataRef(db, uid), validDoc()));
});

await check('R8 多帶一個欄位就寫不了（hasOnly 白名單有牙）', async () => {
  const uid = 'r8-owner';
  await seedEntitlement(uid);
  const db = testEnv.authenticatedContext(uid).firestore();
  await assertFails(setDoc(dataRef(db, uid), { ...validDoc(), evil: 1 }));
  await assertSucceeds(setDoc(dataRef(db, uid), validDoc()));
});

await check('R9 entitlements 客戶端一律寫不了（只能由後端 Admin 憑證寫）', async () => {
  const uid = 'r9-owner';
  const db = testEnv.authenticatedContext(uid).firestore();
  await assertFails(setDoc(entitlementRef(db, uid), entitlementDoc()));
  await seedEntitlement(uid);
});

await check('R10 entitlements 本人讀得到', async () => {
  await seedEntitlement(UID_A);
  const db = testEnv.authenticatedContext(UID_A).firestore();
  await assertSucceeds(getDoc(entitlementRef(db, UID_A)));
});

// ── Task 8：Plus 資格閘門。拒絕案例都在同一情境內附可寫的正向對照。──────────
await check('E1 無資格文件時 create/update 都不可寫；有效資格對照可寫', async () => {
  const uid = 'e1-missing';
  const db = testEnv.authenticatedContext(uid).firestore();
  await removeEntitlement(uid);
  await removeData(uid);
  await assertFails(setDoc(dataRef(db, uid), validDoc()));
  await seedData(uid);
  await assertFails(setDoc(dataRef(db, uid), validDoc('favs', 2)));

  await seedEntitlement(uid);
  await removeData(uid);
  await assertSucceeds(setDoc(dataRef(db, uid), validDoc()));
  await assertSucceeds(setDoc(dataRef(db, uid), validDoc('favs', 2)));
});

await check('E2 active:false 時 create/update 都不可寫；active:true 對照可寫', async () => {
  const uid = 'e2-inactive';
  const db = testEnv.authenticatedContext(uid).firestore();
  await seedEntitlement(uid, entitlementDoc({ active: false, activeUntilMs: 0 }));
  await removeData(uid);
  await assertFails(setDoc(dataRef(db, uid), validDoc()));
  await seedData(uid);
  await assertFails(setDoc(dataRef(db, uid), validDoc('favs', 2)));

  await seedEntitlement(uid);
  await removeData(uid);
  await assertSucceeds(setDoc(dataRef(db, uid), validDoc()));
  await assertSucceeds(setDoc(dataRef(db, uid), validDoc('favs', 2)));
});

await check('E3 資格已過期時 create/update 都不可寫；未到期對照可寫', async () => {
  const uid = 'e3-expired';
  const db = testEnv.authenticatedContext(uid).firestore();
  await seedEntitlement(uid, entitlementDoc({ activeUntilMs: Date.now() - 86_400_000 }));
  await removeData(uid);
  await assertFails(setDoc(dataRef(db, uid), validDoc()));
  await seedData(uid);
  await assertFails(setDoc(dataRef(db, uid), validDoc('favs', 2)));

  await seedEntitlement(uid);
  await removeData(uid);
  await assertSucceeds(setDoc(dataRef(db, uid), validDoc()));
  await assertSucceeds(setDoc(dataRef(db, uid), validDoc('favs', 2)));
});

await check('E4 activeUntilMs == 0 的終身資格可 create/update', async () => {
  const uid = 'e4-lifetime';
  const db = testEnv.authenticatedContext(uid).firestore();
  await seedEntitlement(uid, entitlementDoc({ activeUntilMs: 0 }));
  await removeData(uid);
  await assertSucceeds(setDoc(dataRef(db, uid), validDoc()));
  await assertSucceeds(setDoc(dataRef(db, uid), validDoc('favs', 2)));
});

await testEnv.cleanup();

// executed count 閘門：實際跑過的斷言數必須等於預期條數，抓「少跑一條卻沒人發現」。
const executed = pass + fail;
if (executed !== EXPECTED_CHECK_COUNT) {
  fail += 1;
  console.log(`FAIL executed count ${executed} != expected ${EXPECTED_CHECK_COUNT}`
    + `（有斷言沒被跑到——對照上面逐行 PASS/FAIL 找漏掉哪條）`);
}

console.log(`\n合計 ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
