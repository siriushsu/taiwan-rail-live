// 驗證跨裝置同步不再讓快鐘永久壓過較新的合法變更，同時保留小偏移與離線編輯。
//
// 判準刻意用外部情境作真值：A 裝置快 3 天、Firestore 寫入時刻正常；B 在伺服器時間
// 1 分鐘後才編輯，B 必須贏。期望值不呼叫產品的校正函式，也不重算實作公式。
//
// 用法：node scripts/verify_user_data_clock_skew.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// G0：ROOT 只由本檔位置推導，並印出受測 index.html 的 md5，避免多 worktree 驗錯樹。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'index.html');
const SRC = readFileSync(INDEX, 'utf8');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${createHash('md5').update(SRC).digest('hex')}`);

function extractFunction(src, name) {
  const hit = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(src);
  if (!hit) throw new Error(`找不到 ${name}()`);
  let i = hit.index + hit[0].length, depth = 1, quote = '', escaped = false;
  while (i < src.length && depth > 0) {
    const c = src[i++];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
  }
  if (depth !== 0) throw new Error(`${name}() 大括號不完整`);
  return src.slice(hit.index, i);
}

const coreStart = SRC.indexOf("const USER_DATA_KEY = 'trainmap-user-data-v1';");
const coreEnd = SRC.indexOf('// ── Google Takeout 匯入核心', coreStart);
if (coreStart < 0 || coreEnd < 0) throw new Error('找不到使用者資料核心區塊');
const core = SRC.slice(coreStart, coreEnd);
const cloudEnvelope = extractFunction(SRC, 'accountCloudEnvelope');
const store = new Map();
const localStorage = {
  getItem: key => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => store.set(key, String(value)),
};
const windowStub = { dispatchEvent() {} };
const api = new Function('localStorage', 'crypto', 'CustomEvent', 'window', 'STN_STATUS_RANK', `
  ${core}
  ${cloudEnvelope}
  return { userDataMergeEnvelopes, accountCloudEnvelope };
`)(localStorage, { randomUUID: () => 'verify-device' }, class CustomEvent {}, windowStub, {});

const SERVER_COMMIT = Date.UTC(2030, 0, 15, 12, 0, 0);
const FAST_THREE_DAYS = SERVER_COMMIT + 3 * 24 * 60 * 60 * 1000;
const LATER_ONE_MINUTE = SERVER_COMMIT + 60 * 1000;
const SMALL_THREE_MINUTES = SERVER_COMMIT + 3 * 60 * 1000;
const OFFLINE_EDIT = SERVER_COMMIT - 12 * 60 * 60 * 1000;
const OFFLINE_OLDER = OFFLINE_EDIT + 60 * 1000;
const OFFLINE_SMALL_SKEW = OFFLINE_EDIT + 3 * 60 * 1000;

const blankCollections = () => Object.fromEntries(['pins', 'favs', 'rides', 'stations'].map(k => [k, { items: [], tombstones: [] }]));
function localEnvelope({ item = null, tombstone = null } = {}) {
  const collections = blankCollections();
  if (item) collections.favs.items.push(item);
  if (tombstone) collections.favs.tombstones.push(tombstone);
  return { version: 1, deviceId: 'device-b', revision: 1, updatedAt: SERVER_COMMIT, collections };
}
function cloudDoc({ item = null, tombstone = null, clientAt }) {
  return {
    version: 1, kind: 'favs', revision: 4, clientUpdatedAt: clientAt,
    updatedAt: { toMillis: () => SERVER_COMMIT },
    items: item ? [item] : [], tombstones: tombstone ? [tombstone] : [],
  };
}
function merge(local, favsDoc) {
  return api.userDataMergeEnvelopes(local, api.accountCloudEnvelope({ favs: favsDoc })).collections.favs;
}
const fav = (label, updatedAt) => ({ id: 'same-train', value: { train: 'same-train', label }, updatedAt });
const del = deletedAt => ({ id: 'same-train', deletedAt });

let pass = 0, fail = 0;
function check(name, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// 1. 快 3 天的 item 先寫入；B 在可信伺服器時刻 1 分鐘後才改同一筆，B 必須立即贏。
{
  const col = merge(localEnvelope({ item: fav('B 較新', LATER_ONE_MINUTE) }),
    cloudDoc({ item: fav('A 快鐘舊值', FAST_THREE_DAYS), clientAt: FAST_THREE_DAYS }));
  const got = col.items.find(x => x.id === 'same-train');
  check('C1 快 3 天的 item 不會壓過他機稍後的合法編輯', got?.value.label === 'B 較新', JSON.stringify(got));
}

// 2. +3 分鐘仍在正常寬限內；它確實比 +1 分鐘的新，且時間不得被改寫。
{
  const col = merge(localEnvelope({ item: fav('B 較早', LATER_ONE_MINUTE) }),
    cloudDoc({ item: fav('A 小偏移', SMALL_THREE_MINUTES), clientAt: SMALL_THREE_MINUTES }));
  const got = col.items.find(x => x.id === 'same-train');
  check('C2 小偏移 item 仍依原時間生效且不被誤夾',
    got?.value.label === 'A 小偏移' && got.updatedAt === SMALL_THREE_MINUTES, JSON.stringify(got));
}

// 3. 離線 12 小時前的編輯在上線後仍保留原時間，並贏過同時段較早的值。
{
  const col = merge(localEnvelope({ item: fav('B 離線較早', OFFLINE_OLDER) }),
    cloudDoc({ item: fav('A 離線較新', OFFLINE_SMALL_SKEW), clientAt: SMALL_THREE_MINUTES }));
  const got = col.items.find(x => x.id === 'same-train');
  check('C3 小偏移的離線 item 上線後仍生效且保留原時間',
    got?.value.label === 'A 離線較新' && got.updatedAt === OFFLINE_SMALL_SKEW, JSON.stringify(got));
}

// 4. 快鐘 tombstone 不能刪掉 B 在可信伺服器時刻 1 分鐘後重新建立的項目。
{
  const col = merge(localEnvelope({ item: fav('B 稍後重建', LATER_ONE_MINUTE) }),
    cloudDoc({ tombstone: del(FAST_THREE_DAYS), clientAt: FAST_THREE_DAYS }));
  const got = col.items.find(x => x.id === 'same-train');
  check('C4 快 3 天的 tombstone 不會壓過他機稍後的合法重建', got?.value.label === 'B 稍後重建', JSON.stringify(col));
}

// 5. +3 分鐘的小偏移 tombstone 應照常贏過 +1 分鐘的舊 item，且刪除時間不被改寫。
{
  const col = merge(localEnvelope({ item: fav('B 較早', LATER_ONE_MINUTE) }),
    cloudDoc({ tombstone: del(SMALL_THREE_MINUTES), clientAt: SMALL_THREE_MINUTES }));
  const tomb = col.tombstones.find(x => x.id === 'same-train');
  check('C5 小偏移 tombstone 仍依原時間生效且不被誤夾',
    !col.items.some(x => x.id === 'same-train') && tomb?.deletedAt === SMALL_THREE_MINUTES, JSON.stringify(col));
}

// 6. 離線 12 小時前的刪除在上線後仍保留原時間，並刪掉同時段較早的項目。
{
  const col = merge(localEnvelope({ item: fav('B 離線較早', OFFLINE_OLDER) }),
    cloudDoc({ tombstone: del(OFFLINE_SMALL_SKEW), clientAt: SMALL_THREE_MINUTES }));
  const tomb = col.tombstones.find(x => x.id === 'same-train');
  check('C6 小偏移的離線 tombstone 上線後仍生效且保留原時間',
    !col.items.some(x => x.id === 'same-train') && tomb?.deletedAt === OFFLINE_SMALL_SKEW, JSON.stringify(col));
}

// 7. envelope 的同步錨點要取 Firestore serverTimestamp，不再優先採信快 3 天的 client 值。
{
  const cloud = api.accountCloudEnvelope({ favs: cloudDoc({ item: fav('A', FAST_THREE_DAYS), clientAt: FAST_THREE_DAYS }) });
  check('C7 雲端 envelope 以 Firestore 伺服器時間作同步錨點', cloud.updatedAt === SERVER_COMMIT,
    `updatedAt=${cloud.updatedAt} server=${SERVER_COMMIT}`);
}

console.log(`\n合計 ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
