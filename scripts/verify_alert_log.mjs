// 公告狀態機驗證（worker.js 的 _alertLog 純函式）。
//
// 為什麼判準要包含「來源失敗時不准把公告標成已解除」：
// 三個來源任一發 fetch 掛掉，若當成「這輪沒看到＝公告解除了」，就會在上游抖動時
// 產生一次假解除；接上推播之後那就是一則假的「營運已恢復」通知。這比漏記嚴重得多，
// 所以 diff 一律只對「本輪真的取得成功」的系統做 clear（B5 案）。
//
// 用法：node scripts/verify_alert_log.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _alertLog, _metroAlert } from '../worker.js';

const { alertKey, normalizeAlertPayload } = _alertLog;
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`  ${ok ? 'PASS' : '❌FAIL'}  ${msg}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('A. normalizeAlertPayload');
{
  const payload = {
    alerts: [
      { title: '正常營運', status: 1, desc: '正常營運', sys: 'mrt' },
      { title: '115年7月27日地震恢復營運訊息', status: 0, desc: '已完成巡視作業。', sys: 'krtc', start: '2026-07-27T00:00:00+08:00', end: '2026-07-27T23:59:00+08:00', lines: [], sysLabel: '高雄捷運' },
      { title: '', status: 0, desc: '無標題', sys: 'mrt' },
      { title: '【官方新聞稿】A6 站設備異常', status: 0, desc: '', sys: 'tymc', news: true },
    ],
  };
  const out = normalizeAlertPayload(payload, a => a.sys);
  check(out.length === 2, `濾掉 status=1 與空標題後剩 2 筆（實得 ${out.length}）`);
  check(out[0].sys === 'krtc' && out[0].title.includes('地震'), '第一筆是高捷地震公告');
  check(out[0].start === '2026-07-27T00:00:00+08:00', 'start 原樣帶出');
  check(out[0].end === '2026-07-27T23:59:00+08:00', 'end 原樣帶出');
  check(out[0].desc === '已完成巡視作業。', 'desc 原樣帶出');
  check(out[1].news === true, '新聞稿旗標帶出');
  check(eq(out[0].lines, []), 'lines 顯式空陣列原樣帶出');
  check(eq(out[1].lines, []), 'lines 缺值時回退成空陣列');
  check(out[0].label === '高雄捷運', 'label 從 sysLabel 帶出');
}
{
  const out = normalizeAlertPayload({ alerts: [{ title: '東部幹線延誤', status: 0, lines: ['宜蘭線', '北迴線'] }] }, () => 'tra');
  check(out.length === 1 && out[0].sys === 'tra', 'sysOf 常數回傳（台鐵/高鐵來源無 sys 欄）');
  check(eq(out[0].lines, ['宜蘭線', '北迴線']), 'lines 陣列帶出');
  check(out[0].label === '', 'label 缺值時回退成空字串');
}
check(eq(normalizeAlertPayload(null, () => 'tra'), []), 'payload=null 回空陣列不炸');
check(eq(normalizeAlertPayload({ alerts: 'x' }, () => 'tra'), []), 'alerts 非陣列回空陣列不炸');

console.log('B. diffAlertState');
const { diffAlertState } = _alertLog;
const NOW = '2026-07-27T12:00:00.000Z';
const rec = (sys, title, desc = '', start = '', label = '') => ({ sys, title, desc, lines: [], start, end: '', news: false, label, sysLabel: label });
const row = (sys, title, descr = '', start = '', label = '') => {
  const akey = (label ? label + '|' : '|') + title + '|' + start;
  return { sys, akey, title, descr, first_seen: '2026-07-27T11:00:00.000Z', last_seen: '2026-07-27T11:59:00.000Z', label };
};
const ALL = new Set(['mrt', 'krtc', 'tymc', 'tmrt', 'tra', 'thsr']);

{ // B1 全新
  const d = diffAlertState([], [rec('krtc', '地震恢復營運')], ALL, NOW);
  check(d.added.length === 1 && d.cleared.length === 0, 'B1 第一次看到＝added，無 cleared');
  check(d.upserts.length === 1 && d.upserts[0].akey === '|地震恢復營運|', 'B1 upsert 帶正確 akey');
  check(d.upserts[0].at === NOW, 'B1 時間戳來自參數不是系統時鐘');
}
{ // B2 續存
  const d = diffAlertState([row('krtc', '地震恢復營運')], [rec('krtc', '地震恢復營運')], ALL, NOW);
  check(d.added.length === 0 && d.updated.length === 0 && d.cleared.length === 0, 'B2 第二輪同一則＝零事件');
  check(d.upserts.length === 1, 'B2 仍要 upsert（更新 last_seen）');
}
{ // B3 內容變了
  const d = diffAlertState([row('krtc', '地震', '停駛檢查中')], [rec('krtc', '地震', '已恢復行駛')], ALL, NOW);
  check(d.updated.length === 1 && d.added.length === 0, 'B3 標題同、內文變＝updated');
  check(d.updated.length > 0 && d.updated[0].descr === '已恢復行駛', 'B3 updated 帶新內文');
}
{ // B4 消失
  const d = diffAlertState([row('krtc', '地震恢復營運')], [], ALL, NOW);
  check(d.cleared.length === 1 && d.clears.length === 1, 'B4 這輪沒看到＝cleared');
  check(d.clears.length > 0 && d.clears[0].sys === 'krtc' && d.clears[0].akey === '|地震恢復營運|', 'B4 clear 帶 sys+akey');
}
{ // B5 來源失敗（關鍵回歸）
  const live = new Set(['mrt', 'krtc', 'tymc', 'tmrt']); // metro 成功、台鐵那發掛了
  const d = diffAlertState([row('tra', '東部幹線延誤')], [], live, NOW);
  check(d.cleared.length === 0 && d.clears.length === 0, 'B5 來源失敗的系統不准被判成解除');
}
{ // B6 同輪重複
  const d = diffAlertState([], [rec('krtc', '地震'), rec('krtc', '地震')], ALL, NOW);
  check(d.added.length === 1 && d.upserts.length === 1, 'B6 同輪同鍵只算一則');
}
{ // B7 空輸入
  const d = diffAlertState(null, null, ALL, NOW);
  check(d.upserts.length === 0 && d.clears.length === 0, 'B7 兩邊皆 null 不炸');
}
{ // B8 upsert 的欄位形狀(六個欄位一次驗完)
  const d = diffAlertState([], [{ sys: 'tra', title: '東部幹線延誤', desc: '搶修中', lines: ['宜蘭線', '北迴線'], start: 'S1', end: 'E1', news: true, label: '' }], ALL, NOW);
  const u = d.upserts.length > 0 ? d.upserts[0] : null;
  check(u && u.sys === 'tra' && u.title === '東部幹線延誤', 'B8 sys 與 title 帶出');
  check(u && u.lines === '["宜蘭線","北迴線"]', 'B8 lines 存成 JSON 字串不是陣列');
  check(u && u.news === 1, 'B8 news 存成 1/0 不是 boolean');
  check(u && u.start_at === 'S1' && u.end_at === 'E1', 'B8 start_at 與 end_at 沒有寫反');
}
{ // B9 liveSys 不是 Set 時一律不解除(防禦分支)
  const d = diffAlertState([row('tra', '東部幹線延誤')], [], undefined, NOW);
  check(d.cleared.length === 0, 'B9 liveSys 非 Set 時不做解除判定');
}
{ // B10 高捷與高雄輕軌同標題不同內容:兩則都要留,不准吞掉
  const a = { sys: 'krtc', title: '地震恢復營運', desc: '全線正常', lines: [], start: '', end: '', news: false, label: '高雄捷運', sysLabel: '高雄捷運' };
  const b = { sys: 'krtc', title: '地震恢復營運', desc: 'C14-C21 暫停', lines: [], start: '', end: '', news: false, label: '高雄輕軌', sysLabel: '高雄輕軌' };
  const d = diffAlertState([], [a, b], ALL, NOW);
  check(d.upserts.length === 2 && d.added.length === 2, 'B10 同 sys 同標題但不同營運者的兩則都保留');
  check(d.upserts.length >= 2 && d.upserts[0].akey !== d.upserts[1].akey, 'B10 兩則的 akey 不同');
}
{ // B11 標題含字面直線不得與另一組 (標題,起始) 撞鍵
  const x = { sys: 'tra', title: 'A|B', desc: 'x', lines: [], start: 'C', end: '', news: false, label: '' };
  const y = { sys: 'tra', title: 'A', desc: 'y', lines: [], start: 'B|C', end: '', news: false, label: '' };
  const d = diffAlertState([], [x, y], ALL, NOW);
  check(d.upserts.length === 2, 'B11 標題含直線不與另一組撞鍵');
}
{ // B12 只有預計恢復時間改了(內文一字沒動)也要算一次 updated
  const base = { ...rec('tra', '東部幹線延誤', '搶修中', 'S'), end: 'E1' };
  const prevRow = { ...row('tra', '東部幹線延誤', '搶修中', 'S'), end_at: 'E1' };
  check(diffAlertState([prevRow], [base], ALL, NOW).updated.length === 0, 'B12 什麼都沒變時不算 updated');
  const later = { ...base, end: 'E2' };
  check(diffAlertState([prevRow], [later], ALL, NOW).updated.length === 1, 'B12 只有 end 改了也算 updated');
}

console.log('C. mergeMetroAlertParts（metroAlert 內部聚合，Critical 1 第一層防線）');
const { mergeMetroAlertParts } = _metroAlert;
{
  // C1 全部營運者都成功:degraded 是空陣列,alerts 正常合併
  const ok1 = { list: [{ title: 'X', sys: 'mrt' }], sys: 'mrt' };
  const ok2 = { list: [{ title: 'Y', sys: 'tmrt' }], sys: 'tmrt' };
  const m1 = mergeMetroAlertParts([ok1, ok2], []);
  check(eq(m1.degraded, []), 'C1 全部成功時 degraded 是空陣列');
  check(m1.alerts.length === 2, 'C1 alerts 正常合併（未受影響）');
}
{
  // C2 單一營運者(TRTC/mrt)fetch 失敗、走 fallback:那個 sys 要標進 degraded
  const fail = { list: [], sys: 'mrt', degraded: true };
  const ok = { list: [{ title: 'Y', sys: 'tmrt' }], sys: 'tmrt' };
  const m2 = mergeMetroAlertParts([fail, ok], []);
  check(eq(m2.degraded, ['mrt']), 'C2 單一營運者失敗時只有那個 sys 進 degraded');
}
{
  // C3a KRTC 與 KLRT 共用 sys='krtc':兩個 op 都退化時,合併後 krtc 只列一次(不是兩次)
  const bothFail = mergeMetroAlertParts([
    { list: [], sys: 'krtc', degraded: true },
    { list: [], sys: 'krtc', degraded: true },
  ], []);
  check(eq(bothFail.degraded, ['krtc']), 'C3a KRTC 與 KLRT 都退化時，krtc 只列一次（不是兩次)');
  // C3b 只有其中一個 op(KRTC)退化、另一個(KLRT)成功:krtc 整體仍要算退化(任一退化就夠)
  const oneFail = mergeMetroAlertParts([
    { list: [], sys: 'krtc', degraded: true },
    { list: [{ title: 'Z', sys: 'krtc' }], sys: 'krtc' },
  ], []);
  check(eq(oneFail.degraded, ['krtc']), 'C3b KRTC 退化、KLRT 成功時，krtc 仍整體算退化（任一退化就夠,不需要兩個都失敗）');
}
{
  // C4 news 陣列照樣併入 alerts,不影響 degraded 判斷
  const m4 = mergeMetroAlertParts([], [{ title: 'News', sys: 'tymc' }]);
  check(m4.alerts.length === 1 && eq(m4.degraded, []), 'C4 news 陣列併入 alerts，不影響 degraded');
}

console.log('E. ingestAlertLog（fetch 與 D1 替身）');
const { ingestAlertLog } = _alertLog;
const realFetch = globalThis.fetch;

// SELECT 的欄位清單 → 把一列 row 投影成「只留真的被 SELECT 到的欄位」。模擬真實 D1 的行為:
// 真的資料庫少 SELECT 一欄,回傳列就是沒有那個屬性(undefined),不是「反正物件裡還在」。
// 沒有這層投影,fakeDb.all() 會不管 SQL 寫了什麼、原樣回傳測試建構的 prevRows,SELECT 少列
// 一欄的 bug 永遠測不出來(2026-07-27 審查 Important 2:拿掉 descr 或 akey,52 條斷言原本全過,
// 根因就是這裡沒投影)。非 SELECT 語句(INSERT/UPDATE)原樣跳過,不影響 bind() 路徑。
function projectColumns(sql, row) {
  const m = /^SELECT\s+([^]+?)\s+FROM\b/i.exec(String(sql || ''));
  if (!m) return row;
  const cols = m[1].split(',').map(c => c.trim());
  const out = {};
  for (const c of cols) out[c] = row[c];
  return out;
}
// D1 替身:prepared 記下所有進到 prepare() 的語句(E4 要用來檢查 SELECT 撈了哪些欄位,
// 那發 SELECT 不帶參數、走不到 bind);sql 記下 bind 過的語句與參數。
function fakeDb(prevRows) {
  const calls = { batch: [], sql: [], prepared: [] };
  const mk = sql => {
    calls.prepared.push(sql);
    return {
      bind: (...args) => { calls.sql.push({ sql, args }); return { sql, args }; },
      all: async () => ({ results: prevRows.map(r => projectColumns(sql, r)) }),
      run: async () => ({ meta: { changes: 0 } }),
      first: async () => null,
    };
  };
  return { db: { prepare: sql => mk(sql), batch: async st => { calls.batch.push(st.length); return []; } }, calls };
}
// fetch 替身:okPaths 內的路徑回 200＋指定 payload,其餘回 500。
function fakeFetch(map) {
  globalThis.fetch = async (url) => {
    const p = new URL(String(url)).pathname;
    if (!(p in map)) return new Response('nope', { status: 500 });
    return new Response(JSON.stringify(map[p]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

{ // E1 全部來源掛掉→整輪略過,零 D1 寫入
  fakeFetch({});
  const { db, calls } = fakeDb([]);
  const r = await ingestAlertLog({ DELAY_DB: db });
  check(r.skipped === true, 'E1 全來源失敗回 skipped');
  check(calls.batch.length === 0, 'E1 全來源失敗零 D1 batch 寫入');
}
{ // E2 台鐵那發掛掉,台鐵既有公告不准被解除(端到端版的 B5)
  fakeFetch({
    '/api/metro-alert': { alerts: [{ title: '正常營運', status: 1, sys: 'mrt' }] },
    '/api/thsr-alert': { alerts: [{ title: '全線營運正常(Normal)', status: 1 }] },
  });
  const { db, calls } = fakeDb([{ sys: 'tra', akey: '|東部幹線延誤|', title: '東部幹線延誤', descr: '', end_at: '' }]);
  const r = await ingestAlertLog({ DELAY_DB: db });
  check(r.cleared === 0, 'E2 台鐵來源失敗時,台鐵公告不被標解除');
  check(r.live.includes('mrt') && !r.live.includes('tra'), 'E2 live 只含成功的來源');
}
{ // E3 正常路徑:新公告寫進去
  fakeFetch({
    '/api/metro-alert': { alerts: [{ title: '地震恢復營運', status: 0, desc: '已巡視', sys: 'krtc', lines: [] }] },
    '/api/tra-alert': { alerts: [{ title: '全線營運正常', status: 1 }] },
    '/api/thsr-alert': { alerts: [{ title: '全線營運正常(Normal)', status: 1 }] },
  });
  const { db, calls } = fakeDb([]);
  const r = await ingestAlertLog({ DELAY_DB: db });
  check(r.added === 1 && r.cleared === 0, 'E3 新公告記成 added');
  const up = calls.sql.find(c => c.sql.includes('INSERT INTO alert_log'));
  check(!!up, 'E3 有下 upsert');
  const a = (up && up.args) || [];
  check(a.length === 10, `E3 upsert 綁 10 個參數(實得 ${a.length})`);
  check(a[0] === 'krtc' && a[1] === '|地震恢復營運|', 'E3 前兩個參數是 sys 與 akey');
  check(a[8] === a[9] && !!a[8], 'E3 first_seen 與 last_seen 初值相同且非空');
}
{ // E4 SELECT 必須撈 end_at,否則「預計恢復時間改了」永遠算不出 updated
  fakeFetch({
    '/api/metro-alert': { alerts: [{ title: '正常營運', status: 1, sys: 'mrt' }] },
    '/api/tra-alert': { alerts: [{ title: '全線營運正常', status: 1 }] },
    '/api/thsr-alert': { alerts: [{ title: '全線營運正常(Normal)', status: 1 }] },
  });
  const { db, calls } = fakeDb([]);
  await ingestAlertLog({ DELAY_DB: db });
  const sel = calls.prepared.find(s => /^SELECT/.test(s) && /FROM alert_log/.test(s));
  check(!!sel, 'E4 有下 SELECT');
  check(!!sel && /\bend_at\b/.test(sel), 'E4 SELECT 有撈 end_at');
}
{ // E5 續存案:已存在且完全沒變的公告,一輪 SELECT→diff→upsert 不該產生任何事件。
  // E3/E4 的既有列全是空的,測不到「prev 真的有一列走進比對」這件事——這條同時守 SELECT
  // 的 descr 與 akey 有沒有真的撈到(2026-07-27 審查 Important 2:拿掉 descr 或 akey 都能讓
  // 52 條舊斷言全過)。
  fakeFetch({
    '/api/metro-alert': { alerts: [{ title: '地震恢復營運', status: 0, desc: '已巡視', sys: 'krtc', lines: [] }] },
    '/api/tra-alert': { alerts: [{ title: '全線營運正常', status: 1 }] },
    '/api/thsr-alert': { alerts: [{ title: '全線營運正常(Normal)', status: 1 }] },
  });
  const { db, calls } = fakeDb([{ sys: 'krtc', akey: '|地震恢復營運|', title: '地震恢復營運', descr: '已巡視', end_at: '', first_seen: 'F', last_seen: 'L' }]);
  const r = await ingestAlertLog({ DELAY_DB: db });
  check(r.added === 0 && r.updated === 0 && r.cleared === 0, 'E5 續存且未變＝零事件（SELECT 的 descr/akey 都要對得上才能算出這個結果）');
}
{ // E6 有公告解除時,UPDATE 語句綁的三個參數順序要對:cleared_at=? WHERE sys=? AND akey=?
  // 是 (now, sys, akey)。E3 對 upsert 有三層參數斷言,clear 這條對稱的檢查原本一條都沒有
  // (2026-07-27 審查 Important 3:參數順序打亂,52 條舊斷言全過)。
  fakeFetch({
    '/api/metro-alert': { alerts: [{ title: '正常營運', status: 1, sys: 'mrt' }] },
    '/api/tra-alert': { alerts: [{ title: '全線營運正常', status: 1 }] },
    '/api/thsr-alert': { alerts: [{ title: '全線營運正常(Normal)', status: 1 }] },
  });
  const { db, calls } = fakeDb([{ sys: 'tra', akey: '|東部幹線延誤|', title: '東部幹線延誤', descr: '', end_at: '' }]);
  const r = await ingestAlertLog({ DELAY_DB: db });
  check(r.cleared === 1, 'E6 公告消失且來源正常＝cleared');
  const cl = calls.sql.find(c => c.sql.includes('UPDATE alert_log SET cleared_at'));
  check(!!cl, 'E6 有下 clear UPDATE');
  const ca = (cl && cl.args) || [];
  check(ca.length === 3, `E6 clear 綁 3 個參數（實得 ${ca.length}）`);
  check(!!ca[0] && /^\d{4}-\d{2}-\d{2}T/.test(String(ca[0])), 'E6 clear 第 1 個參數是時間戳（對應 cleared_at=?）');
  check(ca[1] === 'tra' && ca[2] === '|東部幹線延誤|', 'E6 clear 第 2/3 個參數依序是 sys、akey（不是反過來）');
}
{ // E7 metro-alert 整包 200,但 payload.degraded 標出 mrt 這個營運者本輪是 fallback
  // (2026-07-27 審查 Critical 1)→ mrt 既有公告不准被解除,未退化的 krtc 正常判。
  fakeFetch({
    '/api/metro-alert': { at: new Date().toISOString(), alerts: [{ title: '地震恢復營運', status: 0, desc: '已巡視', sys: 'krtc', lines: [] }], degraded: ['mrt'] },
    '/api/tra-alert': { alerts: [{ title: '全線營運正常', status: 1 }] },
    '/api/thsr-alert': { alerts: [{ title: '全線營運正常(Normal)', status: 1 }] },
  });
  const { db, calls } = fakeDb([{ sys: 'mrt', akey: '|台北車站信號異常|', title: '台北車站信號異常', descr: '', end_at: '' }]);
  const r = await ingestAlertLog({ DELAY_DB: db });
  check(r.cleared === 0, 'E7 payload.degraded 標出 mrt 時,mrt 既有公告不被解除（單一營運者退化≠整個來源失敗）');
  check(r.live.includes('krtc') && !r.live.includes('mrt'), 'E7 live 含未退化的 krtc,不含退化的 mrt');
  check(r.added === 1, 'E7 未退化的 krtc 新公告正常記成 added');
}
{ // E8 metro-alert 的 at 過期(模擬 metroAlert() 外層 catch 沿用舊 mem 的情境)→即使
  // payload.degraded 是空陣列,整包涵蓋的 sys 全部視為退化(第二道安全網,見
  // alertSourceDegradedSys)。
  const stale = new Date(Date.now() - 200e3).toISOString(); // 200 秒前,超過 130 秒安全網門檻
  fakeFetch({
    '/api/metro-alert': { at: stale, alerts: [], degraded: [] },
    '/api/tra-alert': { alerts: [{ title: '全線營運正常', status: 1 }] },
    '/api/thsr-alert': { alerts: [{ title: '全線營運正常(Normal)', status: 1 }] },
  });
  const { db, calls } = fakeDb([{ sys: 'tmrt', akey: '|台中捷運信號異常|', title: '台中捷運信號異常', descr: '', end_at: '' }]);
  const r = await ingestAlertLog({ DELAY_DB: db });
  check(r.cleared === 0, 'E8 metro-alert 的 at 過期時,即使 degraded 是空陣列,既有公告仍不被解除');
  check(!r.live.includes('mrt') && !r.live.includes('tmrt') && !r.live.includes('krtc') && !r.live.includes('tymc'), 'E8 過期時 metro 涵蓋的四個 sys 全部不進 liveSys');
  check(r.live.includes('tra') && r.live.includes('thsr'), 'E8 其他正常來源不受影響');
}
{ // E9 對照組:at 是新鮮的(遠低於門檻)→不誤觸過期安全網,degraded 為空時涵蓋的 sys 正常判活。
  const fresh = new Date(Date.now() - 5e3).toISOString(); // 5 秒前
  fakeFetch({
    '/api/metro-alert': { at: fresh, alerts: [{ title: '正常營運', status: 1, sys: 'mrt' }], degraded: [] },
    '/api/tra-alert': { alerts: [{ title: '全線營運正常', status: 1 }] },
    '/api/thsr-alert': { alerts: [{ title: '全線營運正常(Normal)', status: 1 }] },
  });
  const { db, calls } = fakeDb([]);
  const r = await ingestAlertLog({ DELAY_DB: db });
  check(r.live.includes('mrt') && r.live.includes('krtc') && r.live.includes('tymc') && r.live.includes('tmrt'), 'E9 at 新鮮且 degraded 為空時,metro 涵蓋的 sys 正常進 liveSys（不誤觸過期安全網）');
}
globalThis.fetch = realFetch;

console.log('D. alertKey');
check(alertKey({ title: 'A', start: 'S', label: '' }) === '|A|S', 'label+標題+起始時間組合成鍵');
check(alertKey({ title: 'A', label: '' }) === '|A|', 'start 缺值不炸、以空字串入鍵');
check(alertKey({ title: ' A ', start: ' S ', label: '' }) === '|A|S', '前後空白去掉（官方公告常帶尾空白）');
check(alertKey({ title: 'A', start: 'S', label: '高雄捷運' }) === '高雄捷運|A|S', 'label 有值時帶進去');
check(alertKey({ title: 'A|B', start: 'C', label: '' }) === '|A｜B|C', '標題含直線換全形直線');

console.log('F. cron 設定跨檔一致性');
{
  // worker.js 的 ALERT_LOG_CRON 與 wrangler.jsonc 的 triggers.crons 必須逐字相同,分派才會對
  // (2026-07-27 審查 Important 4:兩處各自寫死,合併其他 cron 陣列時可能被改寫成等價字串如
  // '*/1 * * * *',event.cron===ALERT_LOG_CRON 就不成立,整條公告狀態機悄悄停跑、零紅字)。
  // 直接讀 worker.js 目前的常數值(不寫死字面值),兩邊分別改動任一側都測得到。
  const { ALERT_LOG_CRON } = _alertLog;
  const wranglerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'wrangler.jsonc');
  const text = fs.readFileSync(wranglerPath, 'utf8');
  const m = text.match(/"crons"\s*:\s*(\[[^\]]*\])/);
  const crons = m ? JSON.parse(m[1]) : [];
  check(crons.length > 0, 'F1 wrangler.jsonc 讀到 crons 陣列（正規式抓到東西）');
  check(crons.includes(ALERT_LOG_CRON), `F2 wrangler.jsonc 的 crons 含有與 worker.js ALERT_LOG_CRON 逐字相同的項目（ALERT_LOG_CRON=${JSON.stringify(ALERT_LOG_CRON)}，crons=${JSON.stringify(crons)}）`);
}

console.log('G. trafficTag（cron 自身流量不誤記,2026-07-27 審查 Important 5）');
{
  const { trafficTag, ALERT_LOG_CRON_UA } = _alertLog;
  check(trafficTag('', ALERT_LOG_CRON_UA) === null, 'G1 cron 專屬 UA 一律不記（不分 origin）');
  check(trafficTag('capacitor://localhost', ALERT_LOG_CRON_UA) === null, 'G2 cron UA 即使 origin 像 App 殼也不記（UA 判斷優先）');
  const web = trafficTag('', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15');
  check(!!web && web.plat === 'web' && web.dev === 'd', 'G3 一般網頁桌機請求照舊記成 web/d');
  const app = trafficTag('capacitor://localhost', 'RailIsland/1.0');
  check(!!app && app.plat === 'app' && app.dev === 'd', 'G4 App 殼 origin 照舊記成 app');
  const mobile = trafficTag('', 'Mozilla/5.0 (iPhone; CPU iPhone OS) AppleWebKit Mobile/15E148');
  check(!!mobile && mobile.dev === 'm', 'G5 UA 含 Mobile 記成 m（不受 cron 判斷影響）');
}

console.log(fails ? `\n❌ ${fails} 項未過` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
