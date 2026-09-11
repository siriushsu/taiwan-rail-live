// 三鶯線營運時段驗證(Chromium+WebKit):公告營運窗之外不得出現列車。
// 起因:v0711j 把「正式營運後 6時至24時」的規劃當成現況寫死 06:00-23:30,
// 每天生出 7.5 小時幽靈列車(使用者 2026-07-18 回報「開到八點而已,現場沒有車」)。
// 官方依據 https://www.ntmetro.com.tw/basic/?mode=detail&node=863
//   2026-08-16 起「試營運營業時間為6時至24時」(原 08:00-22:00、更早 10:00-20:00);
//   尖峰 06:30-08:30、17:30-19:30 六分,離峰及假日八分。
//   改點時改下面的 OPEN/CLOSE/OUT 三個常數,案例會自己跟著長。
import { chromium, webkit } from 'playwright';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url'; // 下面的 URL 常數會遮蔽全域 URL,路徑一律走 path

// 伺服器自己起、連接埠由 OS 指派(照抄 verify_afr.mjs 的作法)。原本寫死 5178 要人先手動
// 起 server,而本機同時開著 30+ 個 worktree,5178 當下很可能是別棵樹的 server ⇒ 全綠也
// 毫無意義。ROOT 由本檔自身路徑推導、不吃參數,結構上只可能服務自己這棵樹;再用 md5 斷言
// 「伺服器吐回來的 index.html === ROOT/index.html」,把「我在量誰」變成具名閘門。
// VURL 仍可覆寫(指向已在跑的 server),但那條路要自己負責樹對不對,md5 閘門一樣會跑。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);
const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
let child = null;
const PORT = process.env.VURL ? null : await freePort();
const URL = process.env.VURL || `http://localhost:${PORT}/index.html`;
if (!process.env.VURL) {
  child = spawn(process.execPath, [path.join(ROOT, 'scripts/dev_server.mjs')], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'inherit'] });
  process.on('exit', () => child?.kill());
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { child?.kill(); process.exit(1); });
}
for (let i = 0; ; i++) { // 等它真的聽得到,不用固定秒數
  try { const r = await fetch(URL); if (r.ok) break; } catch {}
  if (i > 100) { console.error(`✗ dev server 起不來（${URL}）`); child?.kill(); process.exit(1); }
  await new Promise(r => setTimeout(r, 100));
}
let fail = 0;
const ck = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) fail++; };
const hm = s => String(s / 3600 | 0).padStart(2, '0') + ':' + String(s % 3600 / 60 | 0).padStart(2, '0');
const S = t => { const [h, m] = t.split(':').map(Number); return h * 3600 + m * 60; };

// 公告營運窗(= build_metro_times.mjs 的 first/last)。CLOSE 是末班「發車」時刻。
// 2026-08-16 起 CLOSE 就是日界(24:00),末班跑完全程約到隔日 00:27——當日秒模型測不到隔日,
// 故「收班後」的陰性案例改由清晨那一段承擔(OUT 與 OPEN-60),窗外仍然兩側都驗得到。
const OPEN = '06:00', CLOSE = '24:00', OUT = '04:00';
// [當日秒, 是否應有車] —— 窗外取三點、窗內兩端各取一分鐘,中間鋪滿全窗(含早尖峰 06:30-08:30)
const CASES = [
  [S('00:30'), false], [S(OUT), false], [S(OPEN) - 60, false],
  [S(OPEN) + 60, true], [S('07:00'), true], [S('08:20'), true], [S('11:00'), true],
  [S('14:00'), true], [S('18:00'), true], [S('21:00'), true], [S('23:30'), true],
  [S(CLOSE) - 60, true],
];

// ── 資料層:官方公告的首班與末班「發車」時刻,每個起點每種日型都要真的有那一班 ──
// 2026-09-11 補。下面那些「某時刻有幾班在跑」的取樣抓不到末班缺席:合成器的班距格點落不到
// 24:00 時(平日 6 分/8 分混排,最後一班停在 23:54),23:59 仍有 6 班在途中,整支照樣全綠。
// 官方逐站表(node=863 的 1150814 圖)兩端點平常日/例假日末班都是 00:00,首班都是 06:00。
// 起點集合從資料推導,不寫死站號。
console.log('[data] data/sanying_times.json');
const md5 = b => createHash('md5').update(b).digest('hex');
const localMd5 = md5(readFileSync(path.join(ROOT, 'index.html')));
const servedMd5 = md5(Buffer.from(await (await fetch(URL)).arrayBuffer()));
ck(localMd5 === servedMd5, `量的是這棵樹(ROOT ${localMd5.slice(0, 8)} / server 吐回 ${servedMd5.slice(0, 8)})`);
const LB = JSON.parse(readFileSync(path.join(ROOT, 'data/sanying_times.json'), 'utf8')).lines.LB;
for (const [tag, trains] of Object.entries(LB.sets)) {
  for (const head of [...new Set(trains.map(t => t[0]))].sort((a, b) => a - b)) {
    const deps = trains.filter(t => t[0] === head).map(t => t[1]);
    const first = Math.min(...deps), last = Math.max(...deps);
    ck(first === S(OPEN), `${tag} 起點 idx=${head} 首班發車 ${hm(first)}（應 ${OPEN}）`);
    ck(last === S(CLOSE), `${tag} 起點 idx=${head} 末班發車 ${hm(last)}（應 ${CLOSE}）`);
  }
}

for (const [name, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
  const br = await launcher.launch();
  // 🔴 語言要釘死成繁中:Playwright 預設 locale 是 en-US(webkit 則跟隨系統),下面兩條
  // 導言/註記的比對是中文字面 ⇒ 不釘就只有 webkit 過、chromium 恆紅,而且紅起來完全
  // 不像語系問題(2026-08-29~09-11 就這樣被當成「文案改寫過」誤記了兩週)。
  const ctx = await br.newContext({ viewport: { width: 375, height: 812 }, locale: 'zh-TW' });
  await ctx.addInitScript(() => { localStorage.setItem('trainmap-language', 'zh'); });
  const pg = await ctx.newPage();
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
  const grp = await pg.evaluate(outside => {
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
    setSimSec(outside); recomputeTrains(); o.northNight = cnt(state.lines);
    setSimSec(14 * 3600); recomputeTrains(); o.northDay = cnt(state.lines);
    loadAllGroup(GROUPS.find(g => g.mode === 'all'));
    setSimSec(outside); buildDecoLines(); o.allNight = cnt(state.decoLines);
    setSimSec(14 * 3600); buildDecoLines(); o.allDay = cnt(state.decoLines);
    return o;
  }, S(OUT));
  for (const [key, label, expectRun] of [
    ['northNight', `北北桃 ${OUT}`, false], ['northDay', '北北桃 14:00', true],
    ['allNight', `全台同框 ${OUT}`, false], ['allDay', '全台同框 14:00', true]]) {
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
