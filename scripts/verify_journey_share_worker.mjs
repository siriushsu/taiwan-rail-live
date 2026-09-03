#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker, { _journeyShare } from '../worker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = new DatabaseSync(':memory:');
db.exec(readFileSync(path.join(ROOT, 'schema', '0011_journey_share.sql'), 'utf8'));

let prepareCalls = 0;
const d1 = {
  prepare(sql) {
    prepareCalls += 1;
    const statement = db.prepare(sql);
    let args = [];
    return {
      bind(...next) { args = next; return this; },
      async first() { return statement.get(...args) || null; },
      async all() { return { results: statement.all(...args) }; },
      async run() { return statement.run(...args); },
    };
  },
};
const allow = { async limit() { return { success: true }; } };
const env = { DELAY_DB: d1, JOURNEY_SHARE_LIMITER: allow, ASSETS: { fetch: () => new Response('asset') } };
const post = body => worker.fetch(new Request('https://railisland.tw/api/journey-share', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}), env, {});
const get = id => worker.fetch(new Request(`https://railisland.tw/api/journey-share?id=${encodeURIComponent(id)}`), env, {});

const rail = {
  state: 'rail', updatedAt: Date.now(),
  rail: { sys: 'tra', trainNo: '117', kind: '自強', from: '臺北', destination: '臺南', transferStation: '臺南', date: '20260903', color: '#C43B32' },
};

const created = await post({ action: 'create', durationSec: 3600, locationEnabled: false, payload: rail });
assert.equal(created.status, 201);
const credentials = await created.json();
assert.match(credentials.id, /^[A-Za-z0-9_-]{22}$/);
assert.match(credentials.editToken, /^[A-Za-z0-9_-]{43}$/);
assert.equal(credentials.url, `https://railisland.tw/?journey=${credentials.id}`);

const stored = db.prepare('SELECT * FROM journey_shares WHERE public_id=?').get(credentials.id);
assert(stored);
assert.notEqual(stored.edit_hash, credentials.editToken, 'D1 不得保存明文編輯 token');
assert.equal(stored.location_enabled, 0);
assert.equal(stored.position_lat, null);

const publicRail = await get(credentials.id);
assert.equal(publicRail.status, 200);
const publicRailBody = await publicRail.json();
assert.equal(publicRailBody.payload.rail.trainNo, '117');
assert.equal(publicRailBody.editToken, undefined, '公開 GET 不得外洩編輯 token');
assert.equal(publicRailBody.devicePosition, undefined, '未同意位置分享時不得出現座標');

const forbidden = await post({ action: 'update', id: credentials.id, editToken: 'A'.repeat(43), locationEnabled: true, payload: rail });
assert.equal(forbidden.status, 403);

const beforeEnable = await post({ action: 'position', id: credentials.id, editToken: credentials.editToken,
  lat: 22.997, lon: 120.212, accuracy: 12 });
assert.equal(beforeEnable.status, 409, '位置分享未開啟時必須拒收座標');

const busPayload = {
  state: 'waiting', updatedAt: Date.now(),
  rail: rail.rail,
  bus: { routeName: '102', headsign: '安平', plate: 'TNN-001', stationName: '臺南',
    boardStop: { name: '臺南火車站（中山路）' }, alightStop: { name: '億載金城' }, ignored: '不得保存' },
  ignored: '不得保存',
};
const enabled = await post({ action: 'update', id: credentials.id, editToken: credentials.editToken,
  locationEnabled: true, payload: busPayload });
assert.equal(enabled.status, 200);

for (const [lat, lon, accuracy] of [[22.99711, 120.21211, 18.2], [22.99822, 120.21322, 9.8]]) {
  const position = await post({ action: 'position', id: credentials.id, editToken: credentials.editToken, lat, lon, accuracy });
  assert.equal(position.status, 200);
}
const publicBus = await get(credentials.id);
assert.equal(publicBus.status, 200);
const publicBusBody = await publicBus.json();
assert.equal(publicBusBody.locationEnabled, true);
assert.equal(publicBusBody.devicePosition.lat, 22.99822, '第二筆位置必須覆寫第一筆');
assert.equal(publicBusBody.devicePosition.lon, 120.21322);
assert.equal(publicBusBody.payload.ignored, undefined, '未知 payload 欄位不得落庫');
assert.equal(publicBusBody.payload.bus.ignored, undefined, '未知巢狀欄位不得落庫');
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM journey_shares').get().n, 1, '位置更新不得另建歷史列');

const disabled = await post({ action: 'update', id: credentials.id, editToken: credentials.editToken,
  locationEnabled: false, payload: busPayload });
assert.equal(disabled.status, 200);
const afterDisable = await get(credentials.id);
const afterDisableBody = await afterDisable.json();
assert.equal(afterDisableBody.devicePosition, undefined, '關閉位置分享要立即清除並停止公開座標');
assert.equal(db.prepare('SELECT position_lat FROM journey_shares WHERE public_id=?').get(credentials.id).position_lat, null);

const badPayloads = [
  { ...rail, state: 'invented' },
  { ...rail, rail: { ...rail.rail, sys: 'metro' } },
  { ...rail, vehicle: { lat: 0, lon: 0, at: Date.now() } },
  { ...rail, vehicle: { lat: 23, lon: 121, at: Date.now() - 2 * 86400e3 } },
];
for (const payload of badPayloads) assert.equal(_journeyShare.sanitizeJourneySharePayload(payload), null);

const end = await post({ action: 'end', id: credentials.id, editToken: credentials.editToken });
assert.equal(end.status, 200);
assert.equal((await get(credentials.id)).status, 404, '停止分享後舊連結必須立即失效');
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM journey_shares').get().n, 0, '停止分享必須刪除整列');

const expiring = await post({ action: 'create', durationSec: 900, locationEnabled: false, payload: rail });
const expiringBody = await expiring.json();
db.prepare('UPDATE journey_shares SET expires_at=? WHERE public_id=?').run(Math.floor(Date.now() / 1000) - 1, expiringBody.id);
assert.equal((await get(expiringBody.id)).status, 404, '到期列即使尚未清理也不可讀');
const pruneAt = new Date(Date.now() + 15 * 60e3);
pruneAt.setUTCMinutes(Math.ceil(pruneAt.getUTCMinutes() / 15) * 15, 0, 0);
await _journeyShare.pruneJourneyShares({ scheduledTime: pruneAt.getTime() }, env);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM journey_shares').get().n, 0, '15 分鐘清理要刪除到期實體列');

const callsBeforeRateLimit = prepareCalls;
const blockedEnv = { ...env, JOURNEY_SHARE_LIMITER: { async limit() { return { success: false }; } } };
const blocked = await worker.fetch(new Request('https://railisland.tw/api/journey-share', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'create', durationSec: 3600, payload: rail }),
}), blockedEnv, {});
assert.equal(blocked.status, 429);
assert.equal(prepareCalls, callsBeforeRateLimit, '限流必須擋在任何 D1 操作之前');

console.log('PASS 短效旅程分享：公開／編輯憑證分離、位置明示同意、只留最新一筆、關閉即刪、到期清理、寫入限流');
