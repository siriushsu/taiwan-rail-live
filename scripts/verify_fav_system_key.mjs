// 最愛列車跨系統唯一鍵與舊資料遷移驗證（Task 9）。
//
// fixture 不猜車次：從目前台鐵／高鐵真實班表現算一組重號，再用頁面已載入的真實列車物件操作
// toggleFav()。遷移 fixture 則照 USER_DATA_VERSION=1 已公開運作的 envelope 形狀，刻意混用舊 id
//（純車次）與新 id（系統|車次），驗本機、雲端兩個方向。
//
// G0：ROOT 由本檔位置推導；先印目標與 index.html md5，再驗本機 server 吐出的位元組完全相同。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'index.html');
const SRC = readFileSync(INDEX);
const INDEX_MD5 = createHash('md5').update(SRC).digest('hex');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${INDEX_MD5}`);

const trainsOf = file => (JSON.parse(readFileSync(path.join(ROOT, file), 'utf8')).trains || []);
const traNos = new Set(trainsOf('data/tra_schedule_dense.json').map(t => String(t.train)));
const collisionNo = trainsOf('data/thsr_schedule_dense.json').map(t => String(t.train)).find(no => traNos.has(no));
if (!collisionNo) {
  console.error('FAIL G0 真實班表找不到台鐵／高鐵重號，無法建立有效 fixture');
  process.exit(1);
}
console.log(`[G0] 真實班表重號 fixture=${collisionNo}`);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  // 高鐵班表已改走 /api/thsr-schedule(commit 9f05f2f):真實端點只有兩種合法形狀——200 帶完整文件,
  // 或(上游失敗時)404。下面通用的 /api/* 200 `{}` 是這支假伺服器自己造出來、現實中不存在的第三種
  // 形狀——`{}` 是 truthy,index.html 的 fallbackUrl 退路只在 raw 為假值時才啟動,於是 resolveScheduleDay
  // 原樣放行 `{}`、sys.data.trains 變成 undefined,開機時 for...of 直接丟 TypeError。這裡回真實靜態檔
  // 內容,才是這條路徑成功時的忠實模擬。
  if (url.pathname === '/api/thsr-schedule') {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
  }
  if (url.pathname.startsWith('/api/')) { res.statusCode = 200; res.setHeader('content-type', 'application/json'); res.end('{}'); return; }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; res.end('nf'); return; }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(resolve => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

let fails = 0, passes = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passes++; else fails++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const served = Buffer.from(await (await fetch(base)).arrayBuffer());
const servedMd5 = createHash('md5').update(served).digest('hex');
ok('G0 server 與 ROOT/index.html 逐 byte 相同', servedMd5 === INDEX_MD5, `served=${servedMd5} root=${INDEX_MD5}`);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch {} });
const page = await ctx.newPage();
const runtimeErrors = [];
page.on('pageerror', e => runtimeErrors.push('pageerror:' + String(e)));
page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource:')) runtimeErrors.push('console:' + m.text()); });
await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  try {
    return typeof state !== 'undefined' && state.ready === true
      && state.systems.some(s => s.id === 'tra_sched') && state.systems.some(s => s.id === 'thsr_sched');
  } catch { return false; }
}, null, { timeout: 60000 });

const coexist = await page.evaluate(no => {
  localStorage.removeItem(USER_DATA_KEY); localStorage.removeItem(USER_DATA_LEGACY.favs);
  const find = sys => state.systems.find(s => s.id === sys).data.trains.find(t => String(t.train) === no);
  const tra = find('tra_sched'), thsr = find('thsr_sched');
  toggleFav(tra); toggleFav(thsr);
  const raw = JSON.parse(localStorage.getItem(USER_DATA_KEY));
  return {
    favs: loadFavs().map(f => ({ train: f.train, sys: f.sys })).sort((a, b) => a.sys.localeCompare(b.sys)),
    ids: raw.collections.favs.items.map(x => x.id).sort(),
  };
}, collisionNo);
ok('F1 台鐵／高鐵同號可同時收藏，canonical keys 互異',
  coexist.favs.length === 2
    && coexist.favs.some(f => f.train === collisionNo && f.sys === 'tra_sched')
    && coexist.favs.some(f => f.train === collisionNo && f.sys === 'thsr_sched')
    && JSON.stringify(coexist.ids) === JSON.stringify([`thsr_sched|${collisionNo}`, `tra_sched|${collisionNo}`]),
  JSON.stringify(coexist));

const toggleOne = await page.evaluate(no => {
  localStorage.removeItem(USER_DATA_KEY); localStorage.removeItem(USER_DATA_LEGACY.favs);
  const find = sys => state.systems.find(s => s.id === sys).data.trains.find(t => String(t.train) === no);
  const tra = find('tra_sched'), thsr = find('thsr_sched');
  toggleFav(tra); toggleFav(thsr); toggleFav(tra);
  return loadFavs().map(f => `${f.sys}|${f.train}`);
}, collisionNo);
ok('F2 再按一次台鐵收藏只取消台鐵，高鐵同號仍在',
  JSON.stringify(toggleOne) === JSON.stringify([`thsr_sched|${collisionNo}`]), JSON.stringify(toggleOne));

const removeOne = await page.evaluate(no => {
  localStorage.removeItem(USER_DATA_KEY); localStorage.removeItem(USER_DATA_LEGACY.favs);
  const find = sys => state.systems.find(s => s.id === sys).data.trains.find(t => String(t.train) === no);
  toggleFav(find('tra_sched')); toggleFav(find('thsr_sched'));
  removeFav(no, 'thsr_sched');
  return loadFavs().map(f => `${f.sys}|${f.train}`);
}, collisionNo);
ok('F3 removeFav 指名高鐵只移除高鐵，台鐵同號仍在',
  JSON.stringify(removeOne) === JSON.stringify([`tra_sched|${collisionNo}`]), JSON.stringify(removeOne));

const panelRemove = await page.evaluate(no => {
  localStorage.removeItem(USER_DATA_KEY); localStorage.removeItem(USER_DATA_LEGACY.favs);
  const find = sys => state.systems.find(s => s.id === sys).data.trains.find(t => String(t.train) === no);
  toggleFav(find('tra_sched')); toggleFav(find('thsr_sched'));
  openFavPanel();
  const rowsBefore = [...document.querySelectorAll('#favPanel .row.fv')].map(x => `${x.dataset.sys}|${x.dataset.no}`).sort();
  const rm = document.querySelector('#favPanel .row.fv[data-sys="thsr_sched"] .rm');
  if (rm) rm.click();
  return { rowsBefore, clicked: !!rm, after: loadFavs().map(f => `${f.sys}|${f.train}`) };
}, collisionNo);
ok('F4 最愛面板的高鐵 × 帶著系統別刪除，台鐵同號仍在',
  JSON.stringify(panelRemove.rowsBefore) === JSON.stringify([`thsr_sched|${collisionNo}`, `tra_sched|${collisionNo}`])
    && panelRemove.clicked && JSON.stringify(panelRemove.after) === JSON.stringify([`tra_sched|${collisionNo}`]),
  JSON.stringify(panelRemove));

const migrated = await page.evaluate(no => {
  localStorage.removeItem(USER_DATA_KEY); localStorage.removeItem(USER_DATA_LEGACY.favs);
  const env = userDataEmpty();
  env.revision = 7; env.updatedAt = 700;
  env.collections.favs = { items: [{ id: no, value: { train: no, label: '升級前收藏' }, updatedAt: 123 }], tombstones: [] };
  localStorage.setItem(USER_DATA_KEY, JSON.stringify(env));
  const visible = loadFavs();
  const raw = JSON.parse(localStorage.getItem(USER_DATA_KEY));
  return { visible, revision: raw.revision, updatedAt: raw.updatedAt, items: raw.collections.favs.items };
}, collisionNo);
ok('F5 舊格式收藏升級後仍可見，補上 tra_sched 並以新 key 寫回且不改同步時序',
  migrated.visible.length === 1 && migrated.visible[0].train === collisionNo && migrated.visible[0].sys === 'tra_sched'
    && migrated.revision === 7 && migrated.updatedAt === 700
    && migrated.items.length === 1 && migrated.items[0].id === `tra_sched|${collisionNo}` && migrated.items[0].updatedAt === 123,
  JSON.stringify(migrated));

const idempotent = await page.evaluate(no => {
  localStorage.removeItem(USER_DATA_KEY); localStorage.removeItem(USER_DATA_LEGACY.favs);
  const env = userDataEmpty();
  env.collections.favs = {
    items: [{ id: no, value: { train: no, label: '冪等收藏' }, updatedAt: 100 }],
    tombstones: [{ id: no + '9', deletedAt: 90 }],
  };
  localStorage.setItem(USER_DATA_KEY, JSON.stringify(env));
  userDataRead(); const once = localStorage.getItem(USER_DATA_KEY);
  userDataRead(); const twice = localStorage.getItem(USER_DATA_KEY);
  return { same: once === twice, once: JSON.parse(once), twice: JSON.parse(twice) };
}, collisionNo);
ok('F6 最愛 key 遷移跑兩次結果逐 byte 相同（冪等）', idempotent.same,
  `once=${JSON.stringify(idempotent.once.collections.favs)} twice=${JSON.stringify(idempotent.twice.collections.favs)}`);

const tombstones = await page.evaluate(no => {
  const envelope = (itemAt, tombAt, tombLocal) => {
    const env = userDataEmpty();
    env.collections.favs = tombLocal
      ? { items: [], tombstones: [{ id: no, deletedAt: tombAt }] }
      : { items: [{ id: no, value: { train: no, label: '舊收藏' }, updatedAt: itemAt }], tombstones: [] };
    return env;
  };
  const cloudDoc = (itemAt, tombAt, tombCloud) => tombCloud
    ? { version: 1, kind: 'favs', revision: 1, clientUpdatedAt: tombAt, items: [], tombstones: [{ id: no, deletedAt: tombAt }] }
    : { version: 1, kind: 'favs', revision: 1, clientUpdatedAt: itemAt, items: [{ id: no, value: { train: no, label: '舊收藏' }, updatedAt: itemAt }], tombstones: [] };
  const localDelete = userDataMergeEnvelopes(envelope(100, 200, true), accountCloudEnvelope({ favs: cloudDoc(100, 0, false) }));
  const cloudDelete = userDataMergeEnvelopes(envelope(100, 0, false), accountCloudEnvelope({ favs: cloudDoc(0, 200, true) }));
  const olderDelete = userDataMergeEnvelopes(envelope(300, 0, false), accountCloudEnvelope({ favs: cloudDoc(0, 200, true) }));
  return {
    localDeleteItems: localDelete.collections.favs.items,
    cloudDeleteItems: cloudDelete.collections.favs.items,
    olderDeleteItems: olderDelete.collections.favs.items,
    localTombs: localDelete.collections.favs.tombstones,
    cloudTombs: cloudDelete.collections.favs.tombstones,
  };
}, collisionNo);
ok('F7 舊 tombstone 在本機／雲端兩方向仍刪除較舊收藏；較新的重新收藏可存活（正向對照）',
  tombstones.localDeleteItems.length === 0 && tombstones.cloudDeleteItems.length === 0
    && tombstones.olderDeleteItems.length === 1 && tombstones.olderDeleteItems[0].id === `tra_sched|${collisionNo}`
    && tombstones.localTombs.some(x => x.id === `tra_sched|${collisionNo}`)
    && tombstones.cloudTombs.some(x => x.id === `tra_sched|${collisionNo}`),
  JSON.stringify(tombstones));

const oldLocalNewCloud = await page.evaluate(no => {
  localStorage.removeItem(USER_DATA_KEY); localStorage.removeItem(USER_DATA_LEGACY.favs);
  const local = userDataEmpty();
  local.collections.favs = { items: [{ id: no, value: { train: no, label: '本機舊台鐵' }, updatedAt: 100 }], tombstones: [] };
  localStorage.setItem(USER_DATA_KEY, JSON.stringify(local));
  const cloud = accountCloudEnvelope({ favs: {
    version: 1, kind: 'favs', revision: 2, clientUpdatedAt: 200,
    items: [{ id: `thsr_sched|${no}`, value: { train: no, sys: 'thsr_sched', label: '雲端新高鐵' }, updatedAt: 200 }], tombstones: [],
  } });
  const merged = userDataMergeEnvelopes(userDataRead(), cloud);
  return merged.collections.favs.items.map(x => ({ id: x.id, sys: x.value.sys })).sort((a, b) => a.id.localeCompare(b.id));
}, collisionNo);
const newLocalOldCloud = await page.evaluate(no => {
  localStorage.removeItem(USER_DATA_KEY); localStorage.removeItem(USER_DATA_LEGACY.favs);
  const local = userDataEmpty();
  local.collections.favs = {
    items: [{ id: `thsr_sched|${no}`, value: { train: no, sys: 'thsr_sched', label: '本機新高鐵' }, updatedAt: 200 }], tombstones: [],
  };
  localStorage.setItem(USER_DATA_KEY, JSON.stringify(local));
  const cloud = accountCloudEnvelope({ favs: {
    version: 1, kind: 'favs', revision: 2, clientUpdatedAt: 100,
    items: [{ id: no, value: { train: no, label: '雲端舊台鐵' }, updatedAt: 100 }], tombstones: [],
  } });
  const merged = userDataMergeEnvelopes(userDataRead(), cloud);
  return merged.collections.favs.items.map(x => ({ id: x.id, sys: x.value.sys })).sort((a, b) => a.id.localeCompare(b.id));
}, collisionNo);
const mixedExpected = JSON.stringify([
  { id: `thsr_sched|${collisionNo}`, sys: 'thsr_sched' }, { id: `tra_sched|${collisionNo}`, sys: 'tra_sched' },
]);
ok('F8 本機舊＋雲端新／本機新＋雲端舊兩方向合併都保留兩個系統',
  JSON.stringify(oldLocalNewCloud) === mixedExpected && JSON.stringify(newLocalOldCloud) === mixedExpected,
  `舊本機=${JSON.stringify(oldLocalNewCloud)} 新本機=${JSON.stringify(newLocalOldCloud)}`);

ok('G1 驗收過程零 pageerror／非預期 console.error', runtimeErrors.length === 0, runtimeErrors.slice(0, 4).join(' | '));

await ctx.close();
await browser.close();
await new Promise(resolve => server.close(resolve));
console.log(`\n${passes}/${passes + fails} PASS`);
process.exit(fails ? 1 : 0);
