// easedShift 條目的身分不得跨營運日重用(改進計畫 2-6)。
//
// 缺陷:liveDelaySec 的漸變鍵是 `sys + ':' + 車次`,沒有營運日維度。台鐵名冊是
// 「逐日子集」(resolveScheduleDay,index.html:23080),而 _easedShift 是模組級 Map,
// 頁面不重載就一直活著。可達路徑:頁面開著跨過午夜 → 使用者切一次系統／群組
// (loadSystem 會重跑 resolveScheduleDay,拿到新一天的名冊、全新的 tr 物件)⇒
// 今天的 421 次讀到昨天 421 次留下來的漸變值,一開跑就被推到幾公里外,
// 而且只能以 ≤1× 模擬時間的速率慢慢滑回來(600 秒的誤點要 600 秒才滑完)。
// App 殼的 refreshStaleSchedule(index.html:23204)也會在頁面存活期間換名冊,同一條路。
//
// 判準三格,除了「營運日」這一個變因之外其餘輸入逐格相同(judgment 心得 39b):
//   ① 換營運日 + 同車次 ⇒ 不得繼承(這是缺陷本身)
//   ② 同營運日 + 同車次 ⇒ 必須繼承(反向對照:否則「乾脆全部不繼承」也能讓 ① 綠)
//   ③ 同營運日 + 不同車次 ⇒ 不得繼承(確認 ② 的「繼承」不是「任何呼叫都回同一個值」)
// 另加一格端到端:換營運日之後,畫面位置 trainPos 必須等於純表定位置 trainPosAt
// (trainPosAt 完全不碰 liveDelaySec/easedShift,是刻意的非同源真值)。
//
// 用法:PORT=6427 ROOT=<受測樹> ENGINES=chromium,webkit node scripts/verify_tra_eased_roster_day.mjs
import { createRequire } from 'module';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT || path.resolve(HERE, '..');
const PORT = Number(process.env.PORT || 6427);
const ENGINES = (process.env.ENGINES || 'chromium').split(',').map(s => s.trim()).filter(Boolean);
const req = createRequire(fs.existsSync(path.join(ROOT, 'node_modules/playwright'))
  ? path.join(ROOT, 'package.json') : '/Users/xuxiang/Code/捷運小動畫/package.json');
const pw = req('playwright');

const diskMd5 = createHash('md5').update(fs.readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
const servedMd5 = createHash('md5').update(Buffer.from(
  await (await fetch(`http://127.0.0.1:${PORT}/index.html`)).arrayBuffer())).digest('hex');
console.log(`G0 target=${ROOT}\n   disk=${diskMd5}\n   serve=${servedMd5}`);
if (diskMd5 !== servedMd5) { console.error('G0 FAIL：server 提供的不是目標樹的 index.html'); process.exit(1); }

const results = [];
const check = (n, pass, detail) => { results.push({ n, pass }); console.log(`${pass ? 'PASS ' : 'FAIL '} ${n} — ${detail}`); };

for (const eng of ENGINES) {
  const browser = await pw[eng].launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('PAGEERROR', e.message));
  // 只擋 tra-live 這一支:頁面自己的 60 秒輪詢會把注入的 state.live 整顆換掉(比照 verify_tra_motion)。
  await page.route('**/*tra-live*', r => r.abort());
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof state !== 'undefined' && state.trains && state.trains.some(t => t.sys === 'tra_sched' && t.stops),
    null, { timeout: 180000 });

  const r = await page.evaluate(() => {
    const DELAY_MIN = 10, FULL = DELAY_MIN * 60;
    const sysObj = state.schedSystems.find(s => s.id === 'tra_sched');
    const day0 = sysObj.data._schedDay;
    state.playing = false;
    state.simSec = nowSecOfDay(); state.clockAtNow = true;
    // 在跑的車才有位置可比;取兩台不同車次
    const running = state.trains.filter(t => t.sys === 'tra_sched' && !t.loop && t.stops && t.stops.length > 4
      && state.simSec > t.stops[0].depSec + 120 && state.simSec < t.stops[t.stops.length - 1].arrSec - 120);
    if (running.length < 2) return { err: `此刻在跑的台鐵車只有 ${running.length} 台,無法佈題` };
    const A = running[0], other = running.find(t => String(t.train) !== String(A.train));
    const setLive = m => { state.live = { map: new Map(m), at: Date.now(), srcMs: Date.now(), delayed: m.length, srcAt: '' }; };

    // prime:讓 A 的漸變條目帶滿 FULL 秒。閘門由關→開的首見會 snap 到 target,一次就滿。
    const prime = () => {
      _easedShift.clear(); _traGateEp.on = false; _traGateEp.ep = 0; _traGateEp.at = 0;
      setLive([[String(A.train), DELAY_MIN]]);
      return liveDelaySec(A);
    };

    const out = { day0, trainA: String(A.train), trainB: String(other.train) };
    // 名冊日是不是真的由出貨路徑標上去的(而不是只有本腳本自己在戳):全台鐵車逐台比對。
    const tra = state.trains.filter(t => t.sys === 'tra_sched');
    out.stamped = tra.filter(t => t._rday === day0).length;
    out.traN = tra.length;
    out.primed = prime();
    out.gateOn = liveActive();   // 🔴 要在 prime() 注入 state.live 之後才讀:之前讀恆為 false(state.live 還是 null)

    // ① 換營運日 + 同車次(新名冊裡的同號車=不同物件、同號同系統)
    {
      const B = { ...A, _rday: '2999-01-01' };      // 新一天名冊裡的同號車
      setLive([]);                                   // 新的一天,這班沒有誤點
      out.crossDay = liveDelaySec(B);
      const p1 = trainPos(B, state.simSec), p2 = trainPosAt(B, state.simSec);
      const R = 6371008.8, rad = d => d * Math.PI / 180;
      out.crossDayMetres = (p1 && p2)
        ? Math.hypot(rad(p2.lat - p1.lat), rad(p2.lon - p1.lon) * Math.cos(rad((p1.lat + p2.lat) / 2))) * R
        : null;
    }

    // ② 同營運日 + 同車次 ⇒ 必須繼承(反向對照)
    { out.primed2 = prime(); const B = { ...A }; setLive([]); out.sameDay = liveDelaySec(B); }

    // ③ 同營運日 + 不同車次 ⇒ 不得繼承
    { out.primed3 = prime(); setLive([]); out.otherTrain = liveDelaySec(other); }

    _easedShift.clear();
    return out;
  });

  if (r.err) { check(`[${eng}] 佈題`, false, r.err); await browser.close(); continue; }

  check(`[${eng}] 佈題:閘門開、漸變條目確實帶滿 600 秒`,
    r.gateOn === true && Math.abs(r.primed - 600) < 1 && Math.abs(r.primed2 - 600) < 1 && Math.abs(r.primed3 - 600) < 1,
    `營運日=${r.day0}、受測車 ${r.trainA}／對照車 ${r.trainB}、三次 prime=${r.primed}/${r.primed2}/${r.primed3} 秒`);
  // 這一條把「本腳本戳的 _rday」接回出貨路徑:名冊日必須是 applySchedSystems 真的標上去的,
  // 否則 ①②③ 全部只是在測我自己捏出來的欄位(judgment 心得 29:判準不得與實作同源)。
  check(`[${eng}] 佈題':名冊日由出貨路徑標上每一班台鐵車`, r.traN > 100 && r.stamped === r.traN,
    `${r.stamped}/${r.traN} 班的 tr._rday === 系統名冊日 ${r.day0}`);
  check(`[${eng}] ① 換營運日的同號車不得繼承昨天的漸變值`, Math.abs(r.crossDay) < 1,
    `換日後 liveDelaySec=${r.crossDay.toFixed(1)} 秒(應為 0)`);
  check(`[${eng}] ①' 端到端:換營運日後畫面位置＝純表定位置`, r.crossDayMetres != null && r.crossDayMetres < 5,
    r.crossDayMetres == null ? '取不到位置(車不在跑?)' : `trainPos 與 trainPosAt 相距 ${r.crossDayMetres.toFixed(1)} 公尺(容忍 5)`);
  check(`[${eng}] ② 反向對照:同營運日的同號車必須繼承`, Math.abs(r.sameDay - 600) < 30,
    `同日再問 liveDelaySec=${r.sameDay.toFixed(1)} 秒(應仍約 600 ⇒ 修法沒有把「同一台車的連續性」一起砍掉)`);
  check(`[${eng}] ③ 同營運日的不同車次不得繼承`, Math.abs(r.otherTrain) < 1,
    `對照車 ${r.trainB} 的 liveDelaySec=${r.otherTrain.toFixed(1)} 秒(應為 0)`);

  await browser.close();
}

const bad = results.filter(x => !x.pass).length;
console.log(`\n總計 ${results.length - bad}/${results.length} 通過`);
process.exit(bad ? 1 : 0);
