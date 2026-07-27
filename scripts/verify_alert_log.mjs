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
// news 參數自 2026-07-27 修復輪 3 起是 { list, degraded } 形狀(原本是原始陣列)——見 worker.js
// fetchTymcNewsAlerts 的回傳形狀變更。這裡 C1-C4 沿用既有語意但改傳新形狀,C6/C7 補這輪新增的
// news 退化折疊判斷。
{
  // C1 全部營運者都成功:degraded 是空陣列,alerts 正常合併
  const ok1 = { list: [{ title: 'X', sys: 'mrt' }], sys: 'mrt' };
  const ok2 = { list: [{ title: 'Y', sys: 'tmrt' }], sys: 'tmrt' };
  const m1 = mergeMetroAlertParts([ok1, ok2], { list: [], degraded: false });
  check(eq(m1.degraded, []), 'C1 全部成功時 degraded 是空陣列');
  check(m1.alerts.length === 2, 'C1 alerts 正常合併（未受影響）');
}
{
  // C2 單一營運者(TRTC/mrt)fetch 失敗、走 fallback:那個 sys 要標進 degraded
  const fail = { list: [], sys: 'mrt', degraded: true };
  const ok = { list: [{ title: 'Y', sys: 'tmrt' }], sys: 'tmrt' };
  const m2 = mergeMetroAlertParts([fail, ok], { list: [], degraded: false });
  check(eq(m2.degraded, ['mrt']), 'C2 單一營運者失敗時只有那個 sys 進 degraded');
}
{
  // C3a KRTC 與 KLRT 共用 sys='krtc':兩個 op 都退化時,合併後 krtc 只列一次(不是兩次)
  const bothFail = mergeMetroAlertParts([
    { list: [], sys: 'krtc', degraded: true },
    { list: [], sys: 'krtc', degraded: true },
  ], { list: [], degraded: false });
  check(eq(bothFail.degraded, ['krtc']), 'C3a KRTC 與 KLRT 都退化時，krtc 只列一次（不是兩次)');
  // C3b 只有其中一個 op(KRTC)退化、另一個(KLRT)成功:krtc 整體仍要算退化(任一退化就夠)
  const oneFail = mergeMetroAlertParts([
    { list: [], sys: 'krtc', degraded: true },
    { list: [{ title: 'Z', sys: 'krtc' }], sys: 'krtc' },
  ], { list: [], degraded: false });
  check(eq(oneFail.degraded, ['krtc']), 'C3b KRTC 退化、KLRT 成功時，krtc 仍整體算退化（任一退化就夠,不需要兩個都失敗）');
}
{
  // C4 news list 照樣併入 alerts,degraded:false 時不影響 degraded 判斷
  const m4 = mergeMetroAlertParts([], { list: [{ title: 'News', sys: 'tymc' }], degraded: false });
  check(m4.alerts.length === 1 && eq(m4.degraded, []), 'C4 news list 併入 alerts，degraded:false 時不影響 degraded');
}
{
  // C6(2026-07-27 修復輪 3)News 子來源退化時,tymc 要進 degraded——News 與 TYMC 的 Alert op
  // 共用 sys='tymc',任一邊退化就整個 tymc 算退化,policy 與 C3 的 KRTC/KLRT 一致。
  const m6 = mergeMetroAlertParts([{ list: [], sys: 'tymc' }], { list: [], degraded: true });
  check(eq(m6.degraded, ['tymc']), 'C6 News 子來源退化時,tymc 進 degraded（即使 TYMC 的 Alert op 本身成功）');
  check(eq(m6.alerts, []), 'C6 News 退化時 list 是空陣列,不會假造內容湊數');
}
{
  // C7 TYMC 的 Alert op 與 News 子來源都退化:tymc 仍只列一次(不是兩次),用 Set 去重與 C3 同一條防線
  const m7 = mergeMetroAlertParts([{ list: [], sys: 'tymc', degraded: true }], { list: [], degraded: true });
  check(eq(m7.degraded, ['tymc']), 'C7 Alert op 與 News 都退化時,tymc 只列一次（Set 去重）');
}

console.log('C5. fetchMetroAlertOp（metroAlert 內部單一營運者抓取，生產路徑第一道防線，2026-07-27 修復輪 2 M10 補牙）');
// 為什麼 C1-C4 不夠:那四條只測 mergeMetroAlertParts 這個吃手工 parts 的純函式,parts 裡的
// { list, sys, degraded:true } 是測試自己手寫的,沒有任何斷言證明 metroAlert() 真正的
// per-op try/catch 區塊會產出這個形狀。拿掉 worker.js 那段 catch 裡的 degraded:true,C1-C4
// 全過——這裡改測 fetchMetroAlertOp,那是從同一段 try/catch 原樣抽出來的函式,不是重寫。
const { fetchMetroAlertOp } = _metroAlert;
{
  const okFetch = async () => new Response(JSON.stringify({ Alerts: [{ Title: '測試公告', Description: 'x' }] }), { status: 200 });
  const r1 = await fetchMetroAlertOp({ op: '__TEST_OK__', sys: 'mrt', label: 'x' }, 'tok', okFetch);
  check(!r1.degraded, 'C5a 成功時沒有 degraded 旗標');
  check(r1.list.length === 1 && r1.list[0].title === '測試公告', 'C5a 成功時 list 帶出真的解析結果');
}
{
  const failFetch = async () => new Response('err', { status: 500 });
  const r2 = await fetchMetroAlertOp({ op: '__TEST_FAIL__', sys: 'mrt', label: 'x' }, 'tok', failFetch);
  check(r2.degraded === true, 'C5b HTTP 失敗時標 degraded:true（M10:生產路徑本尊，不是聚合函式）');
  check(eq(r2.list, []), 'C5b 無快取時 fallback 回空陣列');
}
{
  const throwFetch = async () => { throw new Error('network down'); };
  const r3 = await fetchMetroAlertOp({ op: '__TEST_THROW__', sys: 'krtc', label: 'x' }, 'tok', throwFetch);
  check(r3.degraded === true, 'C5c fetch 直接拋網路例外時也標 degraded:true');
}
{
  // C5d(2026-07-28 修復輪 4)有暖快取時仍要標退化——這正是修復輪 1 Critical 1 真正在守的
  // 那一半。C5b/C5c 用的 op 都沒有快取(fallback 回空陣列),測不到「有舊值可沿用時仍要標
  // 退化」;複審實測把這裡改成「有暖快取就不標退化」(往錯方向統一政策,呼應下面 C8c 曾經
  // 犯過的同一種錯)→ 98 條全過、0 FAIL,證明這一半原本沒有牙。
  const okFetch = async () => new Response(JSON.stringify({ Alerts: [{ Title: '舊公告', Description: 'x' }] }), { status: 200 });
  await fetchMetroAlertOp({ op: '__TEST_WARM__', sys: 'mrt', label: 'x' }, 'tok', okFetch); // 先成功一次,暖 metroAlertOpMem
  const failFetch = async () => new Response('err', { status: 500 });
  const r4 = await fetchMetroAlertOp({ op: '__TEST_WARM__', sys: 'mrt', label: 'x' }, 'tok', failFetch);
  check(r4.list.length === 1 && r4.list[0].title === '舊公告', 'C5d 有暖快取時 fallback 真的帶出舊內容（不是空殼，證明真的是暖快取情境）');
  check(r4.degraded === true, 'C5d 有暖快取仍標 degraded:true（修復輪 1 Critical 1 真正在守的那一半）');
}

console.log('C8. fetchTymcNewsAlerts（News 子來源，2026-07-27 修復輪 3 起：獨立 catch，2026-07-28 修復輪 4 起政策與 Alert op 完全對齊）');
// 為什麼 C6/C7 不夠(同一款 M10 教訓):那兩條餵的是手工構造的 { list, degraded },沒有斷言
// 證明 fetchTymcNewsAlerts 這支真的會在生產路徑上產出這個形狀。這裡直接打生產函式本尊,
// 用 _resetTymcNewsMemForTest 控制 module-level 的 tymcNewsMem/tymcNewsMemAt——這是單一
// 純量狀態,不像 metroAlertOpMem 有 op 可以用「各測試各用不同 key」避開重置。
const { fetchTymcNewsAlerts, _resetTymcNewsMemForTest, METRO_NEWS_TTL_MS } = _metroAlert;
{
  // C8a(本輪要修的生產實測案例本身)冷 isolate:tymcNewsMem 從沒成功過,這次 fetch 又失敗
  // → 沒有舊值可沿用,必須標 degraded:true。這是本輪防再犯的核心斷言:少了 worker.js 那行
  // `degraded: !tymcNewsMem`,這裡會先變紅。
  _resetTymcNewsMemForTest(null, 0);
  const failFetch = async () => new Response('err', { status: 500 });
  const r = await fetchTymcNewsAlerts('tok', failFetch);
  check(eq(r.list, []), 'C8a 冷 isolate 且 fetch 失敗時 list 是空陣列（沒有舊值可沿用）');
  check(r.degraded === true, 'C8a 冷 isolate 且 fetch 失敗時標 degraded:true（本輪核心防再犯斷言）');
}
{
  // C8b 冷 isolate 但這次 fetch 成功:正常解析、不標退化,且真的跑過 filterAndMapNews
  // (24 小時內＋事故關鍵字)這條既有邏輯,不是只回一個空殼。
  _resetTymcNewsMemForTest(null, 0);
  const recentIso = new Date(Date.now() - 3600e3).toISOString();
  const okFetch = async () => new Response(JSON.stringify({
    Newses: [{ Title: 'A6站設備異常疏運', Description: '<p>已排除,恢復正常</p>', UpdateTime: recentIso }],
  }), { status: 200 });
  const r = await fetchTymcNewsAlerts('tok', okFetch);
  check(r.degraded === false, 'C8b 冷 isolate 但 fetch 成功時不標退化');
  check(r.list.length === 1 && r.list[0].title.includes('【官方新聞稿】'), 'C8b 成功時真的跑過 filterAndMapNews 解析（不是空殼）');
}
{
  // C8c(sub-path A:有舊值,這輪刷新失敗)——2026-07-28 修復輪 4 政策推翻:已過 TTL 但曾經
  // 成功過,現在**仍然標退化**,不再是「沿用舊值就不標」。
  //
  // 修復輪 3 的舊論證是「這則新聞稿上一輪已經跟 D1 同步過,這輪原樣重複送出,diffAlertState
  // 比對不出差異」——複審端到端重現證明這不成立:tymcNewsMem 是 **per-isolate** 的模組層
  // 變數,但 D1 的狀態是**所有 isolate 歷來看過的聯集**。「回傳值＝本 isolate 上次成功抓到的
  // 集合」不蘊含「回傳值 ⊇ D1 中該 sys 所有 open 紀錄」——isolate A 只看過公告 A,D1 卻可能
  // 已經有 isolate B 寫入的公告 A+B(B 是別的 isolate 成功抓到、寫進 D1,A 從未看過)。這輪
  // isolate A 的 News 失敗、沿用只有 A 的 tymcNewsMem,公告 B 從 payload 消失,被誤判成解除。
  // 這正是 traAlert/thsrAlert/metroAlert 外層 catch 沿用「完整」mem 安全、但這裡不安全的
  // 關鍵差異:那三支的 mem 就是要送給前端的完整回應本身(單一 isolate 內自洽),這裡的
  // tymcNewsMem 只是「這個 isolate 恰好看過的子集」，不是「D1 需要的全集」。
  //
  // 新政策跟 fetchMetroAlertOp(C5d)完全對齊:只要進了 catch 就標退化,不管有沒有舊值可沿用。
  const prior = [{ title: '【官方新聞稿】舊案', status: 0, desc: 'x', sys: 'tymc' }];
  _resetTymcNewsMemForTest(prior, Date.now() - (METRO_NEWS_TTL_MS + 60e3));
  const failFetch = async () => new Response('err', { status: 500 });
  const r = await fetchTymcNewsAlerts('tok', failFetch);
  check(r.list === prior, 'C8c 有舊值時仍原樣沿用內容給 alerts 顯示（同一個參照,不是重新複製——這半沒變)');
  check(r.degraded === true, 'C8c 有舊值可沿用時現在也標 degraded:true（2026-07-28 修復輪 4 推翻舊政策,與 fetchMetroAlertOp 對齊）');
}
{
  // C8d TTL 命中的 fast path:連 try 都不進,不是失敗,是設計本身(News 更新慢,10 分鐘才問一次)。
  // 陷阱(突變測試時自己踩到、就地修正):原本用「一被呼叫就拋例外」的 fetchImpl 期待例外
  // 傳出來當作沒走 fast path 的證據——結果拿掉 fast path 讓它真的掉進 try/catch 後,catch 對
  // 「有舊值」那個分支(sub-path A)剛好也回傳一模一樣的 { list: prior, degraded:false },
  // 例外被吞掉、輸出跟正確版無法區分,突變測試殺不掉。改用呼叫計數器直接斷言 fetchImpl
  // 呼叫次數為 0,不依賴例外傳出來。
  const prior = [{ title: '【官方新聞稿】新案', status: 0, desc: 'y', sys: 'tymc' }];
  _resetTymcNewsMemForTest(prior, Date.now());
  let fetchCalls = 0;
  const countingFetch = async () => { fetchCalls++; return new Response('err', { status: 500 }); };
  const r = await fetchTymcNewsAlerts('tok', countingFetch);
  check(fetchCalls === 0, 'C8d TTL 命中時完全不打 fetch（不是剛好取得一樣的值——這條斷言本身被突變測試抓到一次沒牙,已修正）');
  check(r.list === prior && r.degraded === false, 'C8d TTL 命中時回傳舊值且不標退化（正常運作,不是失敗）');
}
_resetTymcNewsMemForTest(null, 0); // 清乾淨,不留給後面的區段

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
//
// bind() 的回傳值也要能再鏈 .all()(Task 4 alertLog 補的用法:SELECT 帶 since 參數,走
// prepare().bind(since).all() 三段連鎖)——ingestAlertLog 之前只有兩種用法:SELECT 不帶
// 參數(prepare().all() 直接呼叫,走不到這裡)、UPSERT/CLEAR 的 bind() 結果只會被塞進 batch()
// 的陣列(batch() 只在意 st.length,從不對元素呼叫 .all()),所以舊版 bind() 回傳陽春的
// {sql,args} 就夠用,不會被任何人真的呼叫 .all()。這裡加回 .all() 是既有能力的擴充,不是換
// 一顆更寬鬆的替身:投影邏輯(projectColumns)原封不動套用,只是讓 bind 過的查詢也能拿到跟不
// bind 時一樣、有經過欄位投影的結果。run/first 沒有任何呼叫者用到(alertLog 只用 .all()、
// ingestAlertLog 的 bind 結果只進 batch()),2026-07-28 修復輪 1 findings#7 拿掉,YAGNI。
function fakeDb(prevRows) {
  const calls = { batch: [], sql: [], prepared: [] };
  const mk = sql => {
    calls.prepared.push(sql);
    const project = () => ({ results: prevRows.map(r => projectColumns(sql, r)) });
    return {
      bind: (...args) => {
        calls.sql.push({ sql, args });
        // run 補回(Task 5):pruneAlertLog 走 prepare(sql).bind(cutoff).run(),是這裡第一個
        // 真正的呼叫者(上面段落說的「沒有任何呼叫者用到」是 findings#7 當時的事實,不是永遠)。
        return { all: async () => project(), run: async () => ({ meta: { changes: 0 } }) };
      },
      all: async () => project(),
      run: async () => ({ meta: { changes: 0 } }),
      first: async () => null,
    };
  };
  return { db: { prepare: sql => mk(sql), batch: async st => { calls.batch.push(st.length); return []; } }, calls };
}
// fetch 替身:okPaths 內的路徑回 200＋指定 payload,其餘回 500。fakeFetchCalls 記下每次呼叫的
// pathname 與 headers——2026-07-27 修復輪 2 M12 補牙要驗 cron 自己的 outbound fetch 真的帶了
// 專屬 UA(worker.js fetchAlertLogSources 的 headers:{'user-agent':ALERT_LOG_CRON_UA}),
// 只驗字串常數存在(G 段)不夠,要驗真的塞進了送出去的 headers。
let fakeFetchCalls = [];
function fakeFetch(map) {
  fakeFetchCalls = [];
  globalThis.fetch = async (url, init) => {
    const p = new URL(String(url)).pathname;
    fakeFetchCalls.push({ pathname: p, headers: (init && init.headers) || {} });
    if (!(p in map)) return new Response('nope', { status: 500 });
    return new Response(JSON.stringify(map[p]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
// 2026-07-27 修復輪 2:E 段所有 tra/thsr/metro payload 都要帶 at,且台鐵要用真實形狀——
// 台鐵的 at 是 TDX 的 UpdateTime(上游資料何時變動),不是抓取時刻,數小時沒動是常態
// (正式站實測 2026-07-27 23:00 台北,tra-alert 的 at 已 10,414 秒沒動)。這裡固定給 3 小時前,
// 相對「現在」算不寫死日期,測試在任何一天跑都一樣舊。用意:若安全網哪天被誰加回來,
// E3/E4/E5/E6/E7 這些「不是專門測這件事」的既有斷言也會連帶炸開,不必等到 E9 才抓到——
// 這正是這一輪要補的東西(舊版 E 段全部 tra payload 都沒有 at,78 條全綠照不到生產行為)。
const STALE_TRA_AT = () => new Date(Date.now() - 3 * 3600e3).toISOString();
const FRESH_AT = () => new Date(Date.now() - 5e3).toISOString();

{ // E1 全部來源掛掉→整輪略過,零 D1 寫入
  fakeFetch({});
  const { db, calls } = fakeDb([]);
  const r = await ingestAlertLog({ DELAY_DB: db });
  check(r.skipped === true, 'E1 全來源失敗回 skipped');
  check(calls.batch.length === 0, 'E1 全來源失敗零 D1 batch 寫入');
}
{ // E2 台鐵那發掛掉,台鐵既有公告不准被解除(端到端版的 B5)
  fakeFetch({
    '/api/metro-alert': { at: FRESH_AT(), alerts: [{ title: '正常營運', status: 1, sys: 'mrt' }] },
    '/api/thsr-alert': { at: FRESH_AT(), alerts: [{ title: '全線營運正常(Normal)', status: 1 }] },
  });
  const { db, calls } = fakeDb([{ sys: 'tra', akey: '|東部幹線延誤|', title: '東部幹線延誤', descr: '', end_at: '' }]);
  const r = await ingestAlertLog({ DELAY_DB: db });
  check(r.cleared === 0, 'E2 台鐵來源失敗時,台鐵公告不被標解除');
  check(r.live.includes('mrt') && !r.live.includes('tra'), 'E2 live 只含成功的來源');
}
{ // E3 正常路徑:新公告寫進去
  fakeFetch({
    '/api/metro-alert': { at: FRESH_AT(), alerts: [{ title: '地震恢復營運', status: 0, desc: '已巡視', sys: 'krtc', lines: [] }] },
    '/api/tra-alert': { at: STALE_TRA_AT(), alerts: [{ title: '全線營運正常', status: 1 }] },
    '/api/thsr-alert': { at: FRESH_AT(), alerts: [{ title: '全線營運正常(Normal)', status: 1 }] },
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
    '/api/metro-alert': { at: FRESH_AT(), alerts: [{ title: '正常營運', status: 1, sys: 'mrt' }] },
    '/api/tra-alert': { at: STALE_TRA_AT(), alerts: [{ title: '全線營運正常', status: 1 }] },
    '/api/thsr-alert': { at: FRESH_AT(), alerts: [{ title: '全線營運正常(Normal)', status: 1 }] },
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
    '/api/metro-alert': { at: FRESH_AT(), alerts: [{ title: '地震恢復營運', status: 0, desc: '已巡視', sys: 'krtc', lines: [] }] },
    '/api/tra-alert': { at: STALE_TRA_AT(), alerts: [{ title: '全線營運正常', status: 1 }] },
    '/api/thsr-alert': { at: FRESH_AT(), alerts: [{ title: '全線營運正常(Normal)', status: 1 }] },
  });
  const { db, calls } = fakeDb([{ sys: 'krtc', akey: '|地震恢復營運|', title: '地震恢復營運', descr: '已巡視', end_at: '', first_seen: 'F', last_seen: 'L' }]);
  const r = await ingestAlertLog({ DELAY_DB: db });
  check(r.added === 0 && r.updated === 0 && r.cleared === 0, 'E5 續存且未變＝零事件（SELECT 的 descr/akey 都要對得上才能算出這個結果）');
}
{ // E6 有公告解除時,UPDATE 語句綁的三個參數順序要對:cleared_at=? WHERE sys=? AND akey=?
  // 是 (now, sys, akey)。E3 對 upsert 有三層參數斷言,clear 這條對稱的檢查原本一條都沒有
  // (2026-07-27 審查 Important 3:參數順序打亂,52 條舊斷言全過)。
  fakeFetch({
    '/api/metro-alert': { at: FRESH_AT(), alerts: [{ title: '正常營運', status: 1, sys: 'mrt' }] },
    '/api/tra-alert': { at: STALE_TRA_AT(), alerts: [{ title: '全線營運正常', status: 1 }] },
    '/api/thsr-alert': { at: FRESH_AT(), alerts: [{ title: '全線營運正常(Normal)', status: 1 }] },
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
    '/api/metro-alert': { at: FRESH_AT(), alerts: [{ title: '地震恢復營運', status: 0, desc: '已巡視', sys: 'krtc', lines: [] }], degraded: ['mrt'] },
    '/api/tra-alert': { at: STALE_TRA_AT(), alerts: [{ title: '全線營運正常', status: 1 }] },
    '/api/thsr-alert': { at: FRESH_AT(), alerts: [{ title: '全線營運正常(Normal)', status: 1 }] },
  });
  const { db, calls } = fakeDb([{ sys: 'mrt', akey: '|台北車站信號異常|', title: '台北車站信號異常', descr: '', end_at: '' }]);
  const r = await ingestAlertLog({ DELAY_DB: db });
  check(r.cleared === 0, 'E7 payload.degraded 標出 mrt 時,mrt 既有公告不被解除（單一營運者退化≠整個來源失敗）');
  check(r.live.includes('krtc') && !r.live.includes('mrt'), 'E7 live 含未退化的 krtc,不含退化的 mrt');
  check(r.added === 1, 'E7 未退化的 krtc 新公告正常記成 added');
}
{ // E8（2026-07-27 修復輪 2 重寫,原本測「at 過期→整批退化」的安全網已拿掉,原斷言的期望值
  // 現在是錯的)metro-alert 的 at 是 3 小時前的舊值,但沒有明確標 degraded → 不因為 at 舊就
  // 排除,既有公告正常解除。這條反過來驗證「安全網移除後確實不再誤傷」——哪天有人把
  // alertSourceDegradedSys 的 stale 判斷加回去,這裡會先炸。
  fakeFetch({
    '/api/metro-alert': { at: STALE_TRA_AT(), alerts: [], degraded: [] },
    '/api/tra-alert': { at: STALE_TRA_AT(), alerts: [{ title: '全線營運正常', status: 1 }] },
    '/api/thsr-alert': { at: FRESH_AT(), alerts: [{ title: '全線營運正常(Normal)', status: 1 }] },
  });
  const { db, calls } = fakeDb([{ sys: 'tmrt', akey: '|台中捷運信號異常|', title: '台中捷運信號異常', descr: '', end_at: '' }]);
  const r = await ingestAlertLog({ DELAY_DB: db });
  check(r.cleared === 1, 'E8 metro-alert 的 at 是 3 小時前但沒有明確標 degraded 時,不因為 at 舊就排除,既有公告正常解除');
  check(r.live.includes('mrt') && r.live.includes('tmrt') && r.live.includes('krtc') && r.live.includes('tymc'), 'E8 metro 涵蓋的四個 sys 正常進 liveSys（at 舊不再是排除理由）');
}
{ // E9（2026-07-27 審查:本輪最重要的回歸案)台鐵的 at 是數小時前的 UpdateTime——這是正式站的
  // 真實形狀,不是抓取失敗,即使 at 很舊,台鐵仍要正常進 liveSys,既有公告該解除的要解除。
  // 上一輪的 130 秒安全網會把「台鐵 at 是 UpdateTime、天生就舊」誤判成「台鐵退化」,導致台鐵
  // 的解除事件幾乎永遠寫不進 D1,且舊版零測試失敗——因為當時 E 段所有 tra payload 都沒帶 at。
  // 防再犯核心:安全網若被加回來,r.live 不再含 'tra'、r.cleared 會變 0,這條斷言會直接翻紅。
  fakeFetch({
    '/api/metro-alert': { at: FRESH_AT(), alerts: [{ title: '正常營運', status: 1, sys: 'mrt' }] },
    '/api/tra-alert': { at: STALE_TRA_AT(), alerts: [{ title: '全線營運正常', status: 1 }] },
    '/api/thsr-alert': { at: FRESH_AT(), alerts: [{ title: '全線營運正常(Normal)', status: 1 }] },
  });
  const { db, calls } = fakeDb([{ sys: 'tra', akey: '|東部幹線延誤|', title: '東部幹線延誤', descr: '', end_at: '' }]);
  const r = await ingestAlertLog({ DELAY_DB: db });
  check(r.live.includes('tra'), 'E9 台鐵 at 是數小時前的 UpdateTime,仍要進 liveSys（防再犯核心斷言之一）');
  check(r.cleared === 1, 'E9 台鐵既有公告在 at 舊的情況下仍正常解除（防再犯核心斷言之二）');
}
{ // E10（2026-07-27 修復輪 2 M12 補牙)cron 自己打 /api/*-alert 時真的帶了專屬 UA。G 段只驗
  // ALERT_LOG_CRON_UA 這個字串常數存在,不驗 fetchAlertLogSources 真的把它塞進 outbound
  // headers——少了這個標頭,fetch() 的 TRAFFIC 埋點就認不出這是 cron 自己打的,會被誤記成
  // 一筆假的網頁流量(2026-07-27 審查 Important 5)。
  fakeFetch({
    '/api/metro-alert': { at: FRESH_AT(), alerts: [{ title: '正常營運', status: 1, sys: 'mrt' }] },
    '/api/tra-alert': { at: STALE_TRA_AT(), alerts: [{ title: '全線營運正常', status: 1 }] },
    '/api/thsr-alert': { at: FRESH_AT(), alerts: [{ title: '全線營運正常(Normal)', status: 1 }] },
  });
  const { db } = fakeDb([]);
  await ingestAlertLog({ DELAY_DB: db });
  check(fakeFetchCalls.length === 3, `E10 cron 打了 3 個來源(實得 ${fakeFetchCalls.length})`);
  check(fakeFetchCalls.every(c => c.headers['user-agent'] === _alertLog.ALERT_LOG_CRON_UA), 'E10 cron 的每一發 outbound fetch 都帶了專屬 UA（M12 補牙）');
}
{ // E11(2026-07-27 修復輪 3,直接對應複審自己重現的生產案例)metro-alert 整包 200、TYMC 的
  // Alert op 本身成功,但 payload.degraded 標出 tymc(News 子來源這輪冷 isolate 失敗,見
  // C8a/C6)→ 既有的新聞稿來源公告不准被解除。跟 E7 是同一條機制(任何 sys 進 payload.degraded
  // 都會被排除,ingestAlertLog 不特判字串內容),這裡刻意用複審重現案例的確切標題,讓覆蓋對得上
  // 事故本身、不只是抽象機制。
  fakeFetch({
    '/api/metro-alert': { at: FRESH_AT(), alerts: [{ title: '正常營運', status: 1, sys: 'mrt' }], degraded: ['tymc'] },
    '/api/tra-alert': { at: STALE_TRA_AT(), alerts: [{ title: '全線營運正常', status: 1 }] },
    '/api/thsr-alert': { at: FRESH_AT(), alerts: [{ title: '全線營運正常(Normal)', status: 1 }] },
  });
  const { db, calls } = fakeDb([{ sys: 'tymc', akey: '|【官方新聞稿】A6站設備異常疏運|', title: '【官方新聞稿】A6站設備異常疏運', descr: '', end_at: '' }]);
  const r = await ingestAlertLog({ DELAY_DB: db });
  check(r.cleared === 0, 'E11 News 子來源退化時,既有新聞稿公告不被解除（直接對應複審生產重現案例）');
  check(!r.live.includes('tymc'), 'E11 live 不含退化的 tymc');
}
{ // E12(2026-07-28 修復輪 4,直接對應複審這輪的反例重現)D1 有兩則 tymc 新聞稿公告(A、B,
  // 分屬不同 isolate 各自成功抓到、各自寫入 D1),這輪 payload 只反映 A(News 這輪在只看過 A
  // 的 isolate 上失敗,degraded 標出 tymc)→ A、B 都不准被解除,不是只保護「這輪剛好消失的
  // 那則」。這條測的是 sub-path A 推翻前會漏掉的正是這個:per-isolate 記憶體只蓋得到 A,
  // D1 的聯集還有 B,degraded 是 sys 粒度的保護,不是逐則記錄粒度,兩者都要保住。
  fakeFetch({
    '/api/metro-alert': { at: FRESH_AT(), alerts: [{ title: '正常營運', status: 1, sys: 'mrt' }], degraded: ['tymc'] },
    '/api/tra-alert': { at: STALE_TRA_AT(), alerts: [{ title: '全線營運正常', status: 1 }] },
    '/api/thsr-alert': { at: FRESH_AT(), alerts: [{ title: '全線營運正常(Normal)', status: 1 }] },
  });
  const { db, calls } = fakeDb([
    { sys: 'tymc', akey: '|【官方新聞稿】A12站電扶梯故障|', title: '【官方新聞稿】A12站電扶梯故障', descr: '', end_at: '' },
    { sys: 'tymc', akey: '|【官方新聞稿】另一則故障|', title: '【官方新聞稿】另一則故障', descr: '', end_at: '' },
  ]);
  const r = await ingestAlertLog({ DELAY_DB: db });
  check(r.cleared === 0, 'E12 News 退化時,D1 裡「這個 isolate 從未看過」的那則(不只是這輪消失的那則)也不准被解除（對應複審反例：跨 isolate 聯集缺口）');
}
globalThis.fetch = realFetch;

// ── Task 4(2026-07-28):/api/alert-log 唯讀查詢端點 ──────────────────────────
// 字母沿用不了 brief 原本指定的「C」段(mergeMetroAlertParts 已經佔用,且衍生出 C5/C8/C9
// 三個子段)——改用 H(buildAlertLogBody 純函式)與 I(alertLog 端點本身:days 參數/SQL/
// 快取/錯誤回退)兩個新字母,放在 E(ingestAlertLog,寫入側)之後、C9(metroAlert 接線,
// 另一支端點的整合測試)之前:alert_log 這張表的讀寫兩側測試相鄰,C9 不受影響。
console.log('H. buildAlertLogBody（/api/alert-log 讀取端資料整形，Task 4）');
const { buildAlertLogBody } = _alertLog;
{
  const out = buildAlertLogBody([{
    sys: 'tra', title: '東部幹線延誤', descr: '搶修中', lines: '["宜蘭線","北迴線"]',
    start_at: '2026-07-26T20:36:00+08:00', end_at: '', news: 0,
    first_seen: '2026-07-26T12:36:10.000Z', last_seen: '2026-07-26T14:02:00.000Z', cleared_at: null,
  }]);
  check(out.length === 1, 'H1 一列進一筆出');
  check(out[0].sys === 'tra' && out[0].title === '東部幹線延誤', 'H2 sys 與 title 原樣帶出');
  check(eq(out[0].lines, ['宜蘭線', '北迴線']), 'H3 lines 從 JSON 字串還原成陣列');
  check(out[0].news === false, 'H4 news 0/1 轉 boolean');
  check(out[0].cleared === '', 'H5 未解除時 cleared 是空字串不是 null');
  check(out[0].desc === '搶修中' && out[0].first === '2026-07-26T12:36:10.000Z', 'H6 欄位改名 descr→desc、first_seen→first');
  check(out[0].start === '2026-07-26T20:36:00+08:00' && out[0].end === '', 'H7 start_at→start、end_at→end 沒有寫反');
  check(out[0].seen === '2026-07-26T14:02:00.000Z', 'H8 last_seen→seen 帶出');
}
{
  const out = buildAlertLogBody([{ sys: 'mrt', title: 'x', lines: '{壞掉的 json', news: 1, first_seen: 'a', last_seen: 'b', cleared_at: 'c' }]);
  check(eq(out[0].lines, []), 'H9 壞掉的 lines JSON 不炸、回空陣列');
  check(out[0].news === true && out[0].cleared === 'c', 'H10 已解除時帶出 cleared 時間');
}
{
  // H11:lines 是合法 JSON 但解析結果不是陣列(例如純數字)——跟 H9(JSON.parse 本身丟例外)是
  // 不同的分支,只測 H9 測不到「Array.isArray(p) 這道檢查本身有沒有生效」。
  const out = buildAlertLogBody([{ sys: 'mrt', title: 'x', lines: '42', news: 0, first_seen: 'a', last_seen: 'b', cleared_at: null }]);
  check(eq(out[0].lines, []), 'H11 lines 是合法 JSON 但不是陣列(純數字)時回空陣列');
}
{
  // H12:lines 陣列內含非字串元素,要靠 .map(String) 轉成字串——用字串陣列的 H3 測不到這行,
  // 因為字串經過 String() 是恆等變換,拿掉 .map(String) 那行 H3 也不會有感覺。
  const out = buildAlertLogBody([{ sys: 'mrt', title: 'x', lines: '[1,2,3]', news: 0, first_seen: 'a', last_seen: 'b', cleared_at: null }]);
  check(eq(out[0].lines, ['1', '2', '3']), 'H12 lines 陣列內的非字串元素會被轉成字串');
}
check(eq(buildAlertLogBody(null), []), 'H13 null 進來回空陣列');
{ // H14 全空物件進來時,每個欄位都要是字串,而且不能是 'undefined'/'null' 這種字面值——
  // buildAlertLogBody 自陳「不讓一筆髒資料打掉整個回應」,那個承諾要對每個欄位成立,
  // 不是只對當初想到的那三個。日後加欄位忘了兜底,這條會紅。
  const [o] = buildAlertLogBody([{}]);
  const bad = Object.entries(o).filter(([k, v]) =>
    k !== 'lines' && k !== 'news' && (typeof v !== 'string' || v === 'undefined' || v === 'null'));
  check(bad.length === 0, `H14 空物件的每個字串欄位都有兜底（實得問題欄位 ${JSON.stringify(bad)}）`);
}

console.log('I. alertLog（/api/alert-log 端點本身:days 參數/SQL/快取/錯誤回退，Task 4）');
const { alertLog } = _alertLog;
const savedCachesI = globalThis.caches;
// 邊緣快取替身:真的用 Map 存取(不像 C9 那種永遠 miss 的版本),因為這裡要驗「快取命中時不
// 再打第二次 D1」與「快取鍵正規化」這兩件事,兩者都需要 put 過的內容真的能被 match 撈回來。
function fakeEdgeCache() {
  const store = new Map();
  const calls = { put: 0, match: 0 };
  return { calls, default: {
    match: async req => { calls.match++; return store.get(req.url); },
    put: async (req, res) => { calls.put++; store.set(req.url, res); },
  } };
}
const alertLogRow = (over = {}) => ({
  sys: 'tra', title: '東部幹線延誤', descr: '搶修中', lines: '["宜蘭線"]',
  start_at: '2026-07-27T08:00:00+08:00', end_at: '', news: 0,
  first_seen: '2026-07-27T00:00:00.000Z', last_seen: '2026-07-27T01:00:00.000Z', cleared_at: null,
  ...over,
});
const alertLogReq = (qs = '') => new Request('https://railisland.tw/api/alert-log' + qs);

{ // I1 沒帶 days → 預設 7
  globalThis.caches = fakeEdgeCache();
  const { db } = fakeDb([]);
  const body = await (await alertLog(alertLogReq(), { DELAY_DB: db })).json();
  check(body.days === 7, `I1 沒帶 days 時預設 7（實得 ${body.days}）`);
}
{ // I2 合法範圍內的 days 原樣採用
  globalThis.caches = fakeEdgeCache();
  const { db } = fakeDb([]);
  const body = await (await alertLog(alertLogReq('?days=3'), { DELAY_DB: db })).json();
  check(body.days === 3, `I2 合法 days 原樣採用（實得 ${body.days}）`);
}
{ // I3 超過上限 30 要夾住(不是回退成預設值,是夾到上限)
  globalThis.caches = fakeEdgeCache();
  const { db } = fakeDb([]);
  const body = await (await alertLog(alertLogReq('?days=999'), { DELAY_DB: db })).json();
  check(body.days === 30, `I3 超過上限夾到 30（實得 ${body.days}）`);
}
{ // I4 小於 1 要夾到 1(不是回退成預設值,是夾到下限)
  globalThis.caches = fakeEdgeCache();
  const { db } = fakeDb([]);
  const body = await (await alertLog(alertLogReq('?days=0'), { DELAY_DB: db })).json();
  check(body.days === 1, `I4 小於下限夾到 1（實得 ${body.days}）`);
}
{ // I5 非數字字串 → parseInt 是 NaN,回退預設 7(跟 I3/I4 的「夾住」是不同的處理路徑)
  globalThis.caches = fakeEdgeCache();
  const { db } = fakeDb([]);
  const body = await (await alertLog(alertLogReq('?days=abc'), { DELAY_DB: db })).json();
  check(body.days === 7, `I5 非數字字串回退預設 7（實得 ${body.days}）`);
}
{ // I6 回應形狀:at 是 ISO 時間戳、items 真的走過 buildAlertLogBody(不是原始 D1 列直接吐出)
  globalThis.caches = fakeEdgeCache();
  const { db } = fakeDb([alertLogRow()]);
  const body = await (await alertLog(alertLogReq(), { DELAY_DB: db })).json();
  check(/^\d{4}-\d{2}-\d{2}T/.test(body.at), 'I6a at 是 ISO 時間戳字串');
  check(Array.isArray(body.items) && body.items.length === 1, 'I6b items 是陣列且筆數對');
  check(body.items[0].desc === '搶修中' && eq(body.items[0].lines, ['宜蘭線']), 'I6c items 內容真的走過 buildAlertLogBody（欄位改名／lines 還原都生效,不是原始列直接回傳）');
}
{ // I7 SQL 撈的欄位、WHERE 與 LIMIT 照抄 brief——任一項出入都會讓「近期已解除的公告」查不到、
  // 排序跑掉,或無上限地把整張表撈出來。
  globalThis.caches = fakeEdgeCache();
  const { db, calls } = fakeDb([]);
  await alertLog(alertLogReq(), { DELAY_DB: db });
  const sel = calls.prepared.find(s => /^SELECT/.test(s) && /FROM alert_log/.test(s));
  check(!!sel, 'I7a 有下 SELECT');
  const colsMatch = sel && /^SELECT\s+([^]+?)\s+FROM\b/i.exec(sel);
  const cols = colsMatch ? colsMatch[1].split(',').map(c => c.trim()) : [];
  check(eq(cols, ['sys', 'title', 'descr', 'lines', 'start_at', 'end_at', 'news', 'first_seen', 'last_seen', 'cleared_at']), `I7b SELECT 十個欄位逐一相符、順序也照抄（實得 ${JSON.stringify(cols)}）`);
  // I7c(2026-07-28 修復輪 1 findings#4):WHERE/ORDER BY/LIMIT 原本各自用 sel.includes() 片段
  // 比對——對「追加條件」無感(WHERE ... OR cleared_at IS NULL OR 1=1 這種永遠為真的追加,
  // 142 條原本零 FAIL),對「放寬數字」也無感('LIMIT 5000' 字面上就包含 'LIMIT 500' 這個子
  // 字串)。三條弱斷言合併成一條整串逐字相等,失敗時把期望與實得都印出來。時間窗掛 last_seen
  // 不掛 first_seen 的理由見 alertLog 實作內的註解(first_seen 在 upsert 的 DO UPDATE SET 裡
  // 不更新,掛超過 days 天、剛解除的公告會整列從端點消失)。
  const expectSel = 'SELECT sys,title,descr,lines,start_at,end_at,news,first_seen,last_seen,cleared_at FROM alert_log WHERE last_seen >= ? OR cleared_at IS NULL ORDER BY last_seen DESC LIMIT 500';
  check(sel === expectSel, `I7c SQL 與期望值逐字相符\n    期望:${expectSel}\n    實得:${sel}`);
}
{ // I8 bind 的 since 參數真的用「夾取後」的 days 往前推,不是未夾取的 raw——用 ?days=999
  // 驗證(2026-07-28 修復輪 1 findings#3:原本用 ?days=3 這種本來就落在合法區間內的值,
  // raw === days,測不出夾取有沒有真的餵進查詢。回應裡回聲的 days 欄位不算數,I1–I5 已經
  // 驗過那個;這裡要驗的是 30 天上限這道資源閘門對「實際查詢窗」是否真的有效)
  globalThis.caches = fakeEdgeCache();
  const { db, calls } = fakeDb([]);
  const before = Date.now();
  await alertLog(alertLogReq('?days=999'), { DELAY_DB: db });
  const bound = calls.sql.find(c => /FROM alert_log/.test(c.sql));
  check(!!bound && bound.args.length === 1, 'I8a since 只綁一個參數');
  const sinceMs = bound ? Date.parse(bound.args[0]) : NaN;
  const expectMs = before - 30 * 86400e3;
  check(Number.isFinite(sinceMs) && Math.abs(sinceMs - expectMs) < 5000, `I8b days=999 夾到 30 後,since 約為 30 天前而非未夾取的 raw（誤差 ${Math.round(Math.abs(sinceMs - expectMs))}ms）`);
}
{ // I8c(2026-07-28 複審):I8b 的 fixture 從 ?days=3「換成」?days=999,而不是「再加一個」,
  // 結果 since 只剩下夾取後的邊界值(30)被驗到,普通值那條路沒有任何斷言。
  // 複審實測:把 since 改成「只有 days===30 時正確、其餘一律多算一天」,143 條零 FAIL。
  // 邊界與普通值是兩條不同的路,兩條都要有樣本。
  globalThis.caches = fakeEdgeCache();
  const { db, calls } = fakeDb([]);
  const before = Date.now();
  await alertLog(alertLogReq('?days=5'), { DELAY_DB: db });
  const bound = calls.sql.find(c => /FROM alert_log/.test(c.sql));
  const sinceMs = bound ? Date.parse(bound.args[0]) : NaN;
  const expectMs = before - 5 * 86400e3;
  check(Number.isFinite(sinceMs) && Math.abs(sinceMs - expectMs) < 5000,
    `I8c 沒觸及夾取的普通值(days=5)也要正確往前推（誤差 ${Math.round(Math.abs(sinceMs - expectMs))}ms）`);
}
{ // I9 成功時的狀態碼與快取標頭都要對(2026-07-28 修復輪 1 findings#5:狀態碼原本沒有任何
  // 斷言在守,把 200 改成 500 是 142 條零 FAIL——而且那顆 500 還會被 edge.put 寫進快取,
  // 送給後續打進來的所有人)
  globalThis.caches = fakeEdgeCache();
  const { db } = fakeDb([]);
  const res = await alertLog(alertLogReq(), { DELAY_DB: db });
  check(res.status === 200, `I9a 成功回應狀態碼是 200（實得 ${res.status}）`);
  check(res.headers.get('cache-control') === 'public, max-age=60, s-maxage=300, stale-while-revalidate=1800', `I9b 成功回應的 cache-control 逐字相符（實得 ${res.headers.get('cache-control')}）`);
}
{ // I10 D1 掛掉時回 503+not_ready,不是讓例外一路炸穿到路由器(對照 rateLimit/delayHistory
  // 既有端點的 fail-closed 慣例)
  globalThis.caches = fakeEdgeCache();
  const boomDb = { prepare: () => { throw new Error('boom'); } };
  const res = await alertLog(alertLogReq(), { DELAY_DB: boomDb });
  check(res.status === 503, `I10a D1 失敗回 503（實得 ${res.status}）`);
  const body = await res.json();
  check(body.error === 'not_ready', `I10b 錯誤回應帶 error:not_ready（實得 ${JSON.stringify(body)}）`);
  check(res.headers.get('cache-control') === 'public, s-maxage=60', `I10c 失敗回應也有較短的 cache-control（實得 ${res.headers.get('cache-control')}）`);
}
{ // I11 快取命中時不再打第二次 D1——這是這支端點唯一的正確性來源,快取命中卻沒省到 D1 的話,
  // 快取形同虛設,而且原本這個坑不會被任何黑盒斷言看到(回應內容一樣,只有「有沒有再打 D1」不一樣)。
  const edge = fakeEdgeCache();
  globalThis.caches = edge;
  const { db, calls } = fakeDb([alertLogRow()]);
  await (await alertLog(alertLogReq('?days=5'), { DELAY_DB: db })).json();
  const preparedAfterFirst = calls.prepared.length;
  check(preparedAfterFirst > 0, 'I11a 第一次呼叫真的打了 D1');
  const body2 = await (await alertLog(alertLogReq('?days=5'), { DELAY_DB: db })).json();
  check(calls.prepared.length === preparedAfterFirst, 'I11b 第二次同樣的 days 命中快取,沒有再打一次 D1');
  check(body2.days === 5, 'I11c 快取回應內容仍然正確(不是空殼)');
}
{ // I12 快取鍵用「正規化後」的 days,不是原始 query string——用 days=999 與 days=30(兩者都會
  // 被夾到 30)這組真的會撞鍵的組合驗證,比照 brief 原註解裡「?days=abc 與 ?days=999」的舉例
  // 更準確(那組正規化後分別是 7 與 30,實際上不會撞鍵——已在實作的註解裡改寫,見 worker.js)。
  const edge = fakeEdgeCache();
  globalThis.caches = edge;
  const { db, calls } = fakeDb([alertLogRow()]);
  await alertLog(alertLogReq('?days=999'), { DELAY_DB: db });
  const preparedAfterFirst = calls.prepared.length;
  const body2 = await (await alertLog(alertLogReq('?days=30'), { DELAY_DB: db })).json();
  check(calls.prepared.length === preparedAfterFirst, 'I12a ?days=999 與 ?days=30 正規化後同為 30,共用同一格快取(第二次沒有再打 D1)');
  check(body2.days === 30, 'I12b 快取命中的內容 days 仍是正規化後的值');
}
{ // I12c/d(2026-07-28 修復輪 1 findings#2)反向案例:正規化後「不同」的 days(3 與 10,兩者
  // 都在合法區間內、不會被夾到同一個值)必須各自佔一格快取,不能撞同一鍵——I11 只驗過「同一個
  // days 兩次」要命中快取,I12a/b 只驗過「正規化後相同」要撞鍵,兩者都是「應該撞鍵」的方向,
  // 沒有一條驗「正規化後不同必須不撞」。複驗過:把快取鍵拿掉 ?days= 正規化(改用
  // new URL('/api/alert-log', request.url)),142 條原本零 FAIL——先打 days=1 再打 days=30,
  // 第二發會吃到第一發的快取,回傳 1 天的資料集而且 days 欄位自稱是 1。
  const edge = fakeEdgeCache();
  globalThis.caches = edge;
  const { db, calls } = fakeDb([alertLogRow()]);
  await alertLog(alertLogReq('?days=3'), { DELAY_DB: db });
  const preparedAfterFirst = calls.prepared.length;
  const body2 = await (await alertLog(alertLogReq('?days=10'), { DELAY_DB: db })).json();
  check(calls.prepared.length > preparedAfterFirst, 'I12c 正規化後不同的 days(3/10)必須各自佔一格快取,第二發仍要打 D1');
  check(body2.days === 10, 'I12d 第二發回應的 days 是自己的 10,沒有吃到第一發(3)的快取內容');
}
{ // I13 失敗回應不進快取——否則一次 D1 抖動會讓 503 被快取 60 秒,期間所有人都看不到資料
  const edge = fakeEdgeCache();
  globalThis.caches = edge;
  const boomDb = { prepare: () => { throw new Error('boom'); } };
  await alertLog(alertLogReq('?days=9'), { DELAY_DB: boomDb });
  check(edge.calls.put === 0, 'I13 D1 失敗時沒有呼叫 edge.put,失敗回應不會被快取');
}
globalThis.caches = savedCachesI;

console.log('C9. metroAlert() 接線注入（2026-07-28 修復輪 4，M13/M14：同款 2026-07-27 修復輪 2 M11「接線沒測」教訓）');
// 為什麼 C5/C8 不夠:那兩段測的是被抽出來的函式本身(fetchMetroAlertOp/fetchTymcNewsAlerts)
// 給對的 fetchImpl 會怎樣,測不到 metroAlert() 這個唯一的呼叫端有沒有真的把 fetch 傳過去。
// 複審實測:拿掉 worker.js 裡 `fetchMetroAlertOp(o, token, fetch)` 或
// `fetchTymcNewsAlerts(token, fetch)` 的 fetch 參數 → 98 條全過。後果是靜默的:fetchImpl
// 變成 undefined,呼叫時 TypeError,直接落進各自的 catch——但那個 catch 本來就是「正常失敗
// 路徑」,不會噴任何獨特的錯誤,結果看起來就是「這輪剛好退化」,沒有任何斷言會注意到。
//
// 做法:真的呼叫 metroAlert() 本尊(新增導出),用 globalThis.fetch 依 URL 形狀回傳「有獨特
// 標記內容」的假資料(op 端點回 WIRING-OK-OP、News 端點回 WIRING-OK-NEWS異常、auth 端點回
// 假 token),caches.default 強制 miss。接線對時,兩邊的獨特內容都要出現在最終 alerts 裡、
// degraded 是空陣列;任一邊接線斷掉,那一側的內容會消失、degraded 會多出對應的 sys——
// 兩個斷言互相獨立,個別突變只會讓對應那一側變紅,不會兩邊一起倒(見下方突變測試)。
{
  const { metroAlert: realMetroAlert, _resetMetroAlertMemForTest } = _metroAlert;
  const savedCaches = globalThis.caches;
  const savedFetch = globalThis.fetch;
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/openid-connect/token')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 86400 }), { status: 200 });
    if (u.includes('/Rail/Metro/Alert/')) return new Response(JSON.stringify({ Alerts: [{ Title: 'WIRING-OK-OP', Description: 'x' }] }), { status: 200 });
    if (u.includes('/Rail/Metro/News/TYMC')) {
      const recentIso = new Date(Date.now() - 3600e3).toISOString();
      return new Response(JSON.stringify({ Newses: [{ Title: 'WIRING-OK-NEWS異常', Description: 'y', UpdateTime: recentIso }] }), { status: 200 });
    }
    return new Response('nope', { status: 500 });
  };
  _resetMetroAlertMemForTest();
  const res = await realMetroAlert(new Request('https://railisland.tw/api/metro-alert'), { TDX_CLIENT_ID: 'x', TDX_CLIENT_SECRET: 'y' });
  const body = await res.json();
  globalThis.caches = savedCaches;
  globalThis.fetch = savedFetch;
  const opsOk = body.alerts.some(a => a.title === 'WIRING-OK-OP');
  const newsOk = body.alerts.some(a => a.title.includes('WIRING-OK-NEWS異常'));
  check(opsOk, 'M14 metroAlert() 真的把 fetch 傳給 fetchMetroAlertOp——op 端點的獨特內容有出現在最終 alerts');
  check(newsOk, 'M13 metroAlert() 真的把 fetch 傳給 fetchTymcNewsAlerts——News 的獨特內容有出現在最終 alerts');
  check(eq(body.degraded, []), 'C9 兩邊接線都對時 degraded 是空陣列（任一邊斷線都會讓對應 sys 進 degraded，見上方突變測試）');
}

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
{
  // F3(2026-07-28):pruneAlertLog 真的有被 scheduled 的日排程呼叫。這條看起來多餘——函式本身
  // 已經有 J1/J2/J3 三條在守——但實測把 scheduled 裡那三行接線整段拿掉,148 條斷言零 FAIL。
  // 「函式寫對了、但沒有人呼叫」是這一層唯一測不到的失效方式,而後果(表無限成長)要好幾個月
  // 才看得出來。用讀原始碼的方式驗接線,跟 F1/F2 讀 wrangler.jsonc 是同一種手法:離線測不到
  // 真的 cron 觸發,只能驗「該有的接線在不在」。
  const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'worker.js');
  const wtext = fs.readFileSync(workerPath, 'utf8');
  const afterDefault = wtext.slice(wtext.indexOf('export default {'));
  check(/await pruneAlertLog\(env\)/.test(afterDefault),
    'F3 pruneAlertLog 有被 scheduled 的日排程呼叫（不是只定義了、沒接上線）');
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

// ── J 段:保留期清理(Task 5)──────────────────────────────────────────────
console.log('J. pruneAlertLog（公告紀錄 90 天保留期清理，Task 5）');
const { pruneAlertLog, ALERT_LOG_KEEP_DAYS, ALERT_LOG_MAX_DAYS } = _alertLog;

{ // J1 DELETE 的 SQL 逐字相符,判準用 cleared_at 兩處——不是 first_seen 也不是 last_seen。
  // 這條看起來像在重抄實作,但它守的是一個跨 Task 的不變量:清理若改以 first_seen 為準,
  // 「首見 100 天前、昨天才解除」的列會被刪掉,而 /api/alert-log 的 30 天窗(掛 last_seen)
  // 這時還查得到它 ⇒ 端點會回不出自己該回的列。未來任何一次「順手把欄位統一掉」都在這裡變紅。
  const { db, calls } = fakeDb([]);
  await pruneAlertLog({ DELAY_DB: db });
  const del = calls.sql.find(c => /DELETE FROM alert_log/.test(c.sql)) || {};
  const expectDel = 'DELETE FROM alert_log WHERE cleared_at IS NOT NULL AND cleared_at < ?';
  check(del.sql === expectDel, `J1 清理 SQL 與期望值逐字相符\n    期望:${expectDel}\n    實得:${del.sql}`);
}
{ // J2 cutoff 是「現在往前推 90 天」,方向沒寫反(推到未來會把整張表清空)
  const before = Date.now();
  const { db, calls } = fakeDb([]);
  await pruneAlertLog({ DELAY_DB: db });
  const del = calls.sql.find(c => /DELETE FROM alert_log/.test(c.sql));
  const cutoffMs = del ? Date.parse(del.args[0]) : NaN;
  const expectMs = before - 90 * 86400e3;
  check(Number.isFinite(cutoffMs) && Math.abs(cutoffMs - expectMs) < 5000,
    `J2 cutoff 約為 90 天前（誤差 ${Math.round(Math.abs(cutoffMs - expectMs))}ms）`);
}
{ // J3 保留期必須嚴格大於查詢窗上限——J1 註解那個不變量的機器版。只要有人把保留期調到
  // 30 天以下,端點就會查詢一段自己已經刪掉的區間,而且不會有任何其他測試發現。
  check(ALERT_LOG_KEEP_DAYS > ALERT_LOG_MAX_DAYS,
    `J3 保留期(${ALERT_LOG_KEEP_DAYS} 天)必須大於查詢窗上限(${ALERT_LOG_MAX_DAYS} 天)`);
}

console.log(fails ? `\n❌ ${fails} 項未過` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
