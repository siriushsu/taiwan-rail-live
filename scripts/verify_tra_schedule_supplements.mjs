// 官網加班車尚未進 ODS 時，班表與當日名冊必須同日補齊；舊 App 才不會將它們判為停駛。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import supplements from './tra_schedule_supplements.json' with { type: 'json' };
const root = fileURLToPath(new URL('../', import.meta.url));
const originalFetch = globalThis.fetch, originalNow = Date.now;
let day = '2026-10-08', ods = ['1000', '1001', '5321'];
globalThis.caches = { default: { match: async () => undefined, put: async (_k, r) => { await r.text(); } } };
globalThis.fetch = async url => String(url).includes('/JSON/list')
  ? new Response(`<a href="/exceptionDataResource/abcdef">${day.replaceAll('-', '')}.json</a>`)
  : new Response(JSON.stringify({ UpdateTime: '2026-10-05 12:00:00', TrainInfos: ods.map(Train => ({ Train })) }));
const worker = (await import('../worker.js')).default;
const call = async d => {
  day = d; Date.now = () => Date.parse(d + 'T12:00:00+08:00');
  const r = await worker.fetch(new Request('https://localhost/api/tra-daily-trains'), { TRA_DAILY_TTL_MS_OVERRIDE: '0' });
  assert.equal(r.status, 200);
  const b = await r.json(); assert.equal(b.date, d); assert.equal(b.count, b.trains.length);
  assert.equal(new Set(b.trains).size, b.count);
  return b;
};
try {
  let b = await call('2026-10-08');
  assert.deepEqual(b.supplements, ['5435']);
  assert.equal(b.trains.filter(n => n === '5321').length, 1);
  // 取消一般班次仍有效：補充只加公告列車，不把整份靜態班表併回名冊。
  ods = ['1000']; b = await call('2026-10-08');
  assert(!b.trains.includes('1001'));
  assert.deepEqual(b.supplements, ['5321', '5435']);
  b = await call('2026-10-11'); assert.deepEqual(b.supplements, ['5326', '5437', '5440']);
  for (const d of ['2026-10-09', '2026-10-12', '2027-10-08']) {
    b = await call(d); assert.deepEqual(b.trains, ['1000']); assert.deepEqual(b.supplements, []);
  }
  console.log('PASS 當日名冊補充、ODS 已收錄去重、一般停駛仍有效、日期與年度隔離');
} finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
// 只核對仍在這次資料窗內的補充；窗滾過之後，不要求已過期紀錄出現在新班表裡。
const raw = JSON.parse(fs.readFileSync(root + 'data/tra_schedule.json'));
const dense = JSON.parse(fs.readFileSync(root + 'data/tra_schedule_dense.json'));
const widget = JSON.parse(fs.readFileSync(root + 'data/tra_widget_schedule.json'));
for (const e of supplements.trains) {
  if (!raw.dates[e.date]) continue;
  const no = e.trainInfo.Train;
  for (const doc of [raw, dense]) {
    const found = doc.dates[e.date].map(i => doc.trains[i]).filter(t => t.train === no);
    assert.equal(found.length, 1, `${e.date} ${no} 班表缺班／重複`);
    assert(found[0].stops.length >= e.trainInfo.TimeInfos.length);
  }
  assert.equal(widget.dates[e.date].map(i => widget.trains[i]).filter(t => t[0] === no).length, 1, `${no} 小工具班表`);
}
console.log('PASS 原始／密化／小工具班表的公告車次完整且不重複');
