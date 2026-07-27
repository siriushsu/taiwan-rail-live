// 公告狀態機驗證（worker.js 的 _alertLog 純函式）。
//
// 為什麼判準要包含「來源失敗時不准把公告標成已解除」：
// 三個來源任一發 fetch 掛掉，若當成「這輪沒看到＝公告解除了」，就會在上游抖動時
// 產生一次假解除；接上推播之後那就是一則假的「營運已恢復」通知。這比漏記嚴重得多，
// 所以 diff 一律只對「本輪真的取得成功」的系統做 clear（B5 案）。
//
// 用法：node scripts/verify_alert_log.mjs
import { _alertLog } from '../worker.js';

const { alertKey, normalizeAlertPayload } = _alertLog;
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`  ${ok ? 'PASS' : '❌FAIL'}  ${msg}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('A. normalizeAlertPayload');
{
  const payload = {
    alerts: [
      { title: '正常營運', status: 1, desc: '正常營運', sys: 'mrt' },
      { title: '115年7月27日地震恢復營運訊息', status: 0, desc: '已完成巡視作業。', sys: 'krtc', start: '2026-07-27T00:00:00+08:00', end: '2026-07-27T23:59:00+08:00', lines: [] },
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
}
{
  const out = normalizeAlertPayload({ alerts: [{ title: '東部幹線延誤', status: 0, lines: ['宜蘭線', '北迴線'] }] }, () => 'tra');
  check(out.length === 1 && out[0].sys === 'tra', 'sysOf 常數回傳（台鐵/高鐵來源無 sys 欄）');
  check(eq(out[0].lines, ['宜蘭線', '北迴線']), 'lines 陣列帶出');
}
check(eq(normalizeAlertPayload(null, () => 'tra'), []), 'payload=null 回空陣列不炸');
check(eq(normalizeAlertPayload({ alerts: 'x' }, () => 'tra'), []), 'alerts 非陣列回空陣列不炸');

console.log('D. alertKey');
check(alertKey({ title: 'A', start: 'S' }) === 'A|S', '標題與起始時間組合成鍵');
check(alertKey({ title: 'A' }) === 'A|', 'start 缺值不炸、以空字串入鍵');
check(alertKey({ title: ' A ', start: ' S ' }) === 'A|S', '前後空白去掉（官方公告常帶尾空白）');

console.log(fails ? `\n❌ ${fails} 項未過` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
