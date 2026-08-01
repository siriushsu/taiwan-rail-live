// 三鶯線營運時段驗證(Chromium+WebKit):公告營運窗之外不得出現列車。
// 起因:v0711j 把「正式營運後 6時至24時」的規劃當成現況寫死 06:00-23:30,
// 每天生出 7.5 小時幽靈列車(使用者 2026-07-18 回報「開到八點而已,現場沒有車」)。
// 官方依據 https://www.ntmetro.com.tw/basic/?mode=detail&node=863
//   2026-08-01 起延長為 08:00-22:00(原 10:00-20:00);平日尖峰 08:00-08:30、17:30-19:30 六分,
//   平日離峰及假日八分。改點時只改下面的 OPEN/CLOSE 兩個常數,案例會自己跟著長。
import { chromium, webkit } from 'playwright';

const URL = process.env.VURL || 'http://localhost:5178/index.html';
let fail = 0;
const ck = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) fail++; };
const hm = s => String(s / 3600 | 0).padStart(2, '0') + ':' + String(s % 3600 / 60 | 0).padStart(2, '0');
const S = t => { const [h, m] = t.split(':').map(Number); return h * 3600 + m * 60; };

// 公告營運窗(= build_metro_times.mjs 的 first/last)。CLOSE 是末班「發車」時刻,
// 末班跑完全程還要約 28 分鐘,故收班後的陰性案例要留到 CLOSE+RUN 之後。
const OPEN = '08:00', CLOSE = '22:00', RUN = 40 * 60;
// [當日秒, 是否應有車] —— 兩端各取窗外一分鐘與窗內一分鐘,中間鋪滿全窗(含新增的早尖峰)
const CASES = [
  [S('05:00'), false], [S(OPEN) - 60, false],
  [S(OPEN) + 60, true], [S('08:20'), true], [S('11:00'), true], [S('14:00'), true],
  [S('18:00'), true], [S('21:00'), true], [S(CLOSE) - 60, true],
  [S(CLOSE) + RUN + 60, false], [S('23:30'), false],
];

for (const [name, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
  const br = await launcher.launch();
  const pg = await br.newPage({ viewport: { width: 375, height: 812 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(URL, { waitUntil: 'load' });
  // 必須等 boot「整段」跑完再切系統:boot 逐項 await 載資料,最後才 loadSystem(預設台鐵)。
  // 只等 state.systems 或 _times 會踩兩個雷——(1) _tt 還沒填,每個時段都量到 0 班(假陰性);
  // (2) 自己切好的系統被 boot 尾端的預設 loadSystem 覆蓋掉(檔案有無快取會改變時序,時好時壞)。
  // state.special 是最後一個大 await,配 state.sysId 即代表尾端 loadSystem 已執行。
  // (別用 state.lines.length 當訊號:預設系統台鐵是 sched 模式,列車在 state.trains,lines 恆為空)
  await pg.waitForFunction(() => {
    if (typeof state === 'undefined' || !state.systems || !state.special || !state.sysId) return false;
    const s = state.systems.find(x => x.id === 'sanying');
    return !!(s && s.data && s._times);
  }, null, { timeout: 30000 });
  console.log(`[${name}]`);

  // 切換+取樣併在同一個 evaluate:recomputeTrains 是同步的,中間不讓 rAF/系統輪替重建 state.lines
  const res = await pg.evaluate(cases => {
    state.playing = false;
    loadSystem(state.systems.find(x => x.id === 'sanying'));
    const ln = state.lines.find(l => l.id === 'LB');
    if (!ln || !ln._tt || !ln._tt.length) return { err: 'LB 線或時刻表未就緒' };
    const out = [];
    for (const [sec] of cases) {
      setSimSec(sec);
      out.push({ sec, running: ln._tt.filter(tr => freqTrainTime(tr, state.simSec) != null).length });
    }
    return { out, ttLen: ln._tt.length, lead: (document.getElementById('lead') || {}).textContent || '',
      note: (document.getElementById('note') || {}).textContent || '' };
  }, CASES);
  ck(!res.err, '載入三鶯線視圖（時刻表已就緒' + (res.err ? '：' + res.err : '，' + res.ttLen + ' 班') + '）');
  if (res.err) { await br.close(); continue; }

  for (const [i, [sec, expectRun]] of CASES.entries()) {
    const n = res.out[i].running;
    ck(expectRun ? n > 0 : n === 0,
      `${hm(sec)} 在跑 ${n} 班（應${expectRun ? '有車' : '為 0'}）`);
  }
  ck(res.lead.includes(`${OPEN}–${CLOSE}`), `導言標示營運時段 ${OPEN}–${CLOSE}`);
  ck(res.note.includes(`${OPEN}-${CLOSE}`), '資料來源註記含官方營運時段');

  // 三鶯線另外兩條繪製路徑:北北桃群組(state.lines)、全台同框裝飾層(state.decoLines)
  // ——使用者多半是在這兩個視圖看到幽靈車,單系統視圖過了不代表這裡也過
  const grp = await pg.evaluate(night => {
    const cnt = arr => {
      const ln = (arr || []).find(l => l.id === 'LB');
      if (!ln) return null;
      const tt = ln._tt || [];
      return { tt: tt.length, ghost: ln.n || 0,
        run: tt.filter(tr => freqTrainTime(tr, state.simSec) != null).length };
    };
    const o = {};
    state.playing = false;
    loadFreqGroup(GROUPS.find(g => g.id === 'north'));
    setSimSec(night); recomputeTrains(); o.northNight = cnt(state.lines);
    setSimSec(14 * 3600); recomputeTrains(); o.northDay = cnt(state.lines);
    loadAllGroup(GROUPS.find(g => g.mode === 'all'));
    setSimSec(night); buildDecoLines(); o.allNight = cnt(state.decoLines);
    setSimSec(14 * 3600); buildDecoLines(); o.allDay = cnt(state.decoLines);
    return o;
  }, S('23:30'));
  for (const [key, label, expectRun] of [
    ['northNight', '北北桃 23:30', false], ['northDay', '北北桃 14:00', true],
    ['allNight', '全台同框 23:30', false], ['allDay', '全台同框 14:00', true]]) {
    const g = grp[key];
    ck(g && (expectRun ? g.run > 0 : g.run === 0),
      `${label} 三鶯線在跑 ${g ? g.run : '(找不到線)'} 班（應${expectRun ? '有車' : '為 0'}）`);
    if (g) ck(g.ghost === 0, `${label} 幽靈車數 ln.n = ${g.ghost}（有時刻表就不該撒班距假車）`);
  }

  ck(errs.length === 0, 'pageerror 為零' + (errs.length ? '：' + errs.join(' | ') : ''));
  await br.close();
}
console.log(fail ? `\n✗ ${fail} 項未過` : '\n✓ 全部通過');
process.exit(fail ? 1 : 0);
