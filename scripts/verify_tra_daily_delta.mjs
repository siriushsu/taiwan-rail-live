// 台鐵今日停駛偵測的前端驗收。
//
// 判準不同源:
//  - 「有沒有套用」問的是 state.trains 的實際成員(不是 state.traDaily 自己報的旗標);
//  - 「使用者看到什麼」問的是看板 DOM 的字面內容;
//  - 零變化控制組比的是**看板 HTML 逐字相同**,不是「數字差不多」。
// 每個情境開新分頁:停駛套用發生在開機那一刻,共用分頁會吃到前一個情境的名冊。
//
// 用法:VURL=http://127.0.0.1:PORT/index.html node scripts/verify_tra_daily_delta.mjs
import { chromium, webkit } from 'playwright';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VURL = process.env.VURL;
if (!VURL) { console.log('需要 VURL'); process.exit(2); }
let fail = 0;
const ck = (ok, m) => { console.log((ok ? '  ✓ ' : '  ✗ ') + m); if (!ok) fail++; };
const md5 = b => createHash('md5').update(b).digest('hex');
const TODAY = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Taipei' });

// ── G0 自檢:我到底在驗哪一份檔(心得 32:驗收腳本第一道閘門要證明驗的是當前工作區)──
{
  const served = Buffer.from(await (await fetch(VURL)).arrayBuffer());
  // TARGET_FILE 只在突變測試時指到隔離目錄的那份;不設就是工作區的 index.html。
  // 不做成「跳過 G0」的開關是刻意的——突變跑也要證明「我驗的就是我改的那份」。
  const disk = readFileSync(process.env.TARGET_FILE || path.join(ROOT, 'index.html'));
  ck(md5(served) === md5(disk), `G0 服務端與磁碟同一份 index.html (${md5(disk).slice(0, 12)}…)`);
  if (md5(served) !== md5(disk)) { console.log('  基準不成立,中止'); process.exit(1); }
}

// daily 端點的替身。null = 端點 502(前端該 fail-open)
function mockDaily(pg, payload) {
  return pg.route('**/api/tra-daily-trains*', r => payload == null
    ? r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"stub"}' })
    : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }));
}

async function open(br, payload) {
  const pg = await br.newPage({ viewport: { width: 1280, height: 900 } });
  await pg.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  // 即時誤點固定成「沒有車誤點」:誤點會動到看板的排序與 +N 標,零變化控制組會量到它而不是量到我
  await pg.route('**/api/tra-live*', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ at: new Date().toISOString(), srv: Date.now(), trains: [] }) }));
  await mockDaily(pg, payload);
  await pg.goto(VURL, { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 500,
    null, { timeout: 60000 });
  // 🔴 前置條件:等 pollLive() 真的回來。看板副標寫「已套用台鐵即時誤點」還是「依時刻表」由
  // liveActive()/liveFresh() 決定,而它們要 state.live 存在。不等就會發生「先開的那頁等到了、
  // 後開的那頁還沒等到」,零變化控制組因此假 FAIL——量到的是載入時序,不是我的改動。
  await pg.waitForFunction(() => typeof state !== 'undefined' && !!state.live, null, { timeout: 60000 });
  return pg;
}

// 畫面現況:台鐵名冊、旗標、以及一個「有停靠且三小時內有班次」的站的看板 HTML
const SNAP = `(() => {
  const tra = (state.trains || []).filter(t => t.sys === 'tra_sched');
  return {
    n: tra.length,
    nos: tra.map(t => String(t.train)).sort(),
    // 跨午夜借進來的昨夜車(_prevNight)不屬於今天的名冊,traDailyDelta 不判它們。
    // 替身要照這個定義生,否則那些車號會被算成「官方有、我們沒有」＝假的加開(第一版就是這樣紅的)。
    ownNos: [...new Set(tra.filter(t => t.stops && !t.stops._prevNight && !t.loop).map(t => String(t.train)))].sort(),
    loopNos: tra.filter(t => t.loop).map(t => String(t.train)).sort(),
    daily: state.traDaily || null,
    cancelledN: (state.traCancelled || []).length,
  };
})()`;

for (const eng of (process.env.ENGINES || 'chromium,webkit').split(',')) {
  const br = await (eng === 'webkit' ? webkit : chromium).launch();
  console.log(`\n── ${eng} ──`);

  // ── 基準:端點 502,前端必須 fail-open(維持改動前的行為)
  const p0 = await open(br, null);
  const base = await p0.evaluate(SNAP);
  ck(base.n > 500, `${eng} 基準名冊 ${base.n} 班`);
  ck(base.daily && base.daily.ok === false && base.cancelledN === 0,
    `${eng} 端點 502 → 不套用、名冊不動(fail-open)`);
  // 挑一班「此刻起三小時內在某站有停靠」的車當受測停駛對象,並記下該站
  const pick = await p0.evaluate(() => {
    const now = state.simSec;
    for (const tr of state.trains) {
      if (tr.sys !== 'tra_sched' || tr.loop || !tr.stops) continue;
      for (let i = 0; i < tr.stops.length - 1; i++) {
        const s = tr.stops[i];
        if (s.stop === false) continue;
        const d = s.depSec - now;
        if (d > 900 && d < 2 * 3600) return { train: String(tr.train), station: s.name, depSec: s.depSec };
      }
    }
    return null;
  });
  ck(!!pick, `${eng} 找到受測車次 ${pick ? pick.train + '（' + pick.station + '）' : '（無）'}`);
  // 同一個 PIN 才比得了「逐字相同」:看板的「N 分」是相對 state.simSec 算的,兩趟差幾十秒就會不同。
  // 撥鐘必清 clockAtNow(專案鐵則),且撥鐘→重繪→讀 DOM 在同一次同步 evaluate 內完成,rAF 插不進來。
  const boardOf = async (pg, stName, pin) => pg.evaluate(([nm, pin]) => {
    const st = (state.schedStations || []).find(s => s.name === nm && s.sys === 'tra_sched');
    if (!st) return null;
    state.simSec = pin; state.clockAtNow = false;
    state.boardStation = st; renderBoard();
    const el = document.getElementById('board');
    return { html: el.innerHTML, rows: el.querySelectorAll('.row').length,
      off: [...el.querySelectorAll('.row.off')].map(r => ({ txt: r.textContent.replace(/\s+/g, ' ').trim(),
        no: r.getAttribute('data-no'), title: r.getAttribute('title') })) };
  }, [stName, pin]);
  // ── Part A:直接餵純函式 traDailyDelta,不經開機時序 ──────────────────────────
  // 為什麼要這一段:有些不變量在**現在的開機順序下**根本不可能顯形。例如「虛構班次(山海號/平原號)
  // 不可以被判成停駛」——buildLoopTrains 目前恰好在 applyTraDailyDelta 之後才跑,所以端到端情境
  // 怎麼測都是綠的(實測突變掉 !t.loop 那道排除,端到端 27 項全綠)。那道排除是防「順序被改動」的,
  // 只有直接餵函式才驗得到。這正是心得 37 說的:突變測試由實作者自己設計時會漏掉沒想到的維度。
  const A = await p0.evaluate(([today, sample]) => {
    const mk = (no, extra) => ({ train: no, stops: Object.assign([{ name: 'X', stop: true, arrSec: 0, depSec: 0 }], extra || {}) });
    const roster = sample.map(n => mk(n));
    const d = (r, trains, date) => traDailyDelta(r, { date: date || today, trains, count: trains.length }, today);
    const loopTr = { train: '8888', loop: true, stops: [{ name: 'X', stop: true, arrSec: 0, depSec: 0 }] };
    const prevTr = mk('9999', { _prevNight: true });
    const nos = sample.slice();
    return {
      zero: d(roster, nos),
      canc: d(roster, nos.slice(0, nos.length - 3)),
      add: d(roster, nos.concat(['A1', 'A2'])),
      loop: d(roster.concat([loopTr]), nos),                    // 虛構班次不在官方名冊裡
      prev: d(roster.concat([prevTr]), nos),                    // 昨夜借車不在官方名冊裡
      few: d(roster, nos.slice(0, 50)),
      alien: d(roster, nos.map((_, i) => 'Z' + i)),
      wrongDay: d(roster, nos, '2000-01-01'),
      empty: d(roster, []),
    };
  }, [TODAY, base.ownNos]);
  const cancNos = k => (A[k].cancelled || []).map(t => String(t.train));
  ck(A.zero.ok && !A.zero.cancelled.length && !A.zero.added.length, `${eng} A1 名冊相同 → 停駛 0、加開 0`);
  ck(A.canc.ok && A.canc.cancelled.length === 3, `${eng} A2 官方少 3 班 → 停駛 3`);
  ck(A.add.ok && A.add.added.length === 2 && !A.add.cancelled.length, `${eng} A3 官方多 2 班 → 加開 2、停駛 0`);
  ck(A.loop.ok && !cancNos('loop').includes('8888'),
    `${eng} A4 虛構班次 8888 不在官方名冊裡也不判停駛（停駛=${cancNos('loop').join(',') || '無'}）`);
  ck(A.prev.ok && !cancNos('prev').includes('9999'),
    `${eng} A5 昨夜借車 9999 不判停駛（停駛=${cancNos('prev').join(',') || '無'}）`);
  ck(!A.few.ok && /視為檔案有問題/.test(A.few.reason), `${eng} A6 官方名冊 50 班 → 不套用`);
  ck(!A.alien.ok && /只認得/.test(A.alien.reason), `${eng} A7 官方名冊全陌生 → 不套用`);
  ck(!A.wrongDay.ok && /營運日對不上/.test(A.wrongDay.reason), `${eng} A8 官方是別天的 → 不套用`);
  ck(!A.empty.ok && /沒有官方名冊/.test(A.empty.reason), `${eng} A9 官方名冊空 → 不套用`);

  const ALL = { date: TODAY, updateTime: '2026-08-18 14:38:08', count: base.ownNos.length, trains: base.ownNos };

  // ── 零變化控制組:官方名冊＝畫面名冊 ⇒ 看板 HTML 必須逐字相同
  // 🔴 兩頁必須同時開著、背靠背畫,而且用同一個 PIN:
  //   ① PIN 取「渲染當下的 now+60」而不是基準頁載入時的 simSec——liveActive 要求 simSec 不得落後
  //      現在 120 秒以上,而每開一頁要 20~40 秒,寫死較早的 PIN 會讓後開的那頁掉出即時校正,
  //      副標從「已套用台鐵即時誤點」變成「依時刻表（無誤點資訊）」＝假 FAIL(第一版就是這樣紅的);
  //   ② 同一個絕對 PIN 才讓「N 分」與三小時窗的成員完全一致。
  const p1 = await open(br, ALL);
  const PIN = await p1.evaluate(() => Math.round(nowSecOfDay()) + 60);
  const b1 = await boardOf(p1, pick.station, PIN);
  const baseBoard = await boardOf(p0, pick.station, PIN);
  ck(baseBoard && baseBoard.rows > 0, `${eng} 基準看板有 ${baseBoard ? baseBoard.rows : 0} 列`);
  ck(baseBoard.html.includes(pick.train), `${eng} 基準看板上找得到 ${pick.train} 次`);
  await p0.close();
  const s1 = await p1.evaluate(SNAP);
  ck(s1.daily && s1.daily.ok === true, `${eng} 官方＝畫面 → 判定成立`);
  ck(s1.daily.cancelled === 0 && s1.daily.added === 0, `${eng} 停駛 0、加開 0`);
  ck(s1.n === base.n, `${eng} 名冊數不變 ${s1.n}`);
  // 山海號/平原號是我們自己合成的,官方名冊永遠沒有它們——不排除就會天天被判停駛。
  // 這一條是對照組:上面的替身刻意不含它們,所以「沒被判停駛」必須是排除規則的功勞。
  ck(base.loopNos.length >= 2 && base.loopNos.every(n => s1.nos.includes(n)),
    `${eng} 虛構班次 ${base.loopNos.join('/')} 沒被判成停駛`);
  ck(b1.html === baseBoard.html, `${eng} 零變化:看板 HTML 與基準逐字相同`);
  if (b1.html !== baseBoard.html) {
    const A = baseBoard.html, B = b1.html;
    let i = 0; while (i < A.length && i < B.length && A[i] === B[i]) i++;
    console.log('      首個差異 @' + i + '\n        基準:…' + A.slice(Math.max(0, i - 60), i + 90).replace(/\n/g, ' ')
      + '\n        本版:…' + B.slice(Math.max(0, i - 60), i + 90).replace(/\n/g, ' '));
  }
  await p1.close();

  // ── 停駛:官方名冊拿掉 3 班(含受測那班)
  const dead = [pick.train, ...base.ownNos.filter(n => n !== pick.train).slice(0, 2)];
  const p2 = await open(br, { ...ALL, trains: base.ownNos.filter(n => !dead.includes(n)), count: base.ownNos.length - 3 });
  const s2 = await p2.evaluate(SNAP);
  ck(s2.daily.ok === true && s2.daily.cancelled === 3, `${eng} 官方少 3 班 → 判定停駛 3`);
  ck(s2.n === base.n - 3, `${eng} 名冊少了 3 班(${base.n}→${s2.n})`);
  ck(dead.every(n => !s2.ownNos.includes(n)), `${eng} 那 3 班確實不在名冊裡`);
  // 地圖真的畫不到:trainPos 對已移除的車不存在;用「名冊裡找不到它」＋「跟不了它」雙證
  const gone = await p2.evaluate(no => {
    const inRoster = (state.trains || []).some(t => t.sys === 'tra_sched' && String(t.train) === no);
    let followed = null;
    try { followTrainNo(no, { sys: 'tra_sched' }); followed = state.followTrain ? String(state.followTrain.train) : null; } catch (e) {}
    return { inRoster, followed };
  }, pick.train);
  ck(!gone.inRoster && gone.followed !== pick.train, `${eng} ${pick.train} 次跟不到也畫不到(followTrain=${gone.followed})`);
  const b2 = await boardOf(p2, pick.station, await p2.evaluate(() => Math.round(nowSecOfDay()) + 60));
  ck(b2.off.length >= 1, `${eng} 看板出現 ${b2.off.length} 列停駛列`);
  const row = b2.off.find(r => r.txt.includes(pick.train));
  ck(!!row, `${eng} 停駛列就是 ${pick.train} 次:「${row ? row.txt : '找不到'}」`);
  ck(!!row && row.txt.includes('停駛'), `${eng} 該列字面上寫著「停駛」`);
  ck(!!row && row.no === null && row.title === null, `${eng} 停駛列沒有 data-no/title(點不動、不會去跟一台不存在的車)`);
  ck(b2.html.includes('今日官方停駛 3 班'), `${eng} 看板副標標出停駛班數`);
  await p2.close();

  // ── 守門三則:都必須「不套用」,名冊與基準相同
  const guards = [
    ['官方名冊只有 50 班', { ...ALL, trains: base.ownNos.slice(0, 50), count: 50 }, '視為檔案有問題'],
    ['官方名冊全是陌生車次', { ...ALL, trains: base.ownNos.map((_, i) => 'ZZ' + i), count: base.ownNos.length }, '只認得'],
    ['官方名冊是別天的', { ...ALL, date: '2000-01-01' }, '營運日對不上'],
  ];
  for (const [name, payload, why] of guards) {
    const pg = await open(br, payload);
    const s = await pg.evaluate(SNAP);
    ck(s.daily.ok === false && new RegExp(why).test(s.daily.reason || ''),
      `${eng} 守門「${name}」→ 不套用:${s.daily.reason}`);
    ck(s.n === base.n && s.cancelledN === 0, `${eng} 守門「${name}」→ 名冊完全沒動(${s.n})`);
    await pg.close();
  }

  // ── 加開:官方多兩班陌生車次 ⇒ 只計數、不進名冊
  const p3 = await open(br, { ...ALL, trains: [...base.ownNos, 'X001', 'X002'], count: base.ownNos.length + 2 });
  const s3 = await p3.evaluate(SNAP);
  ck(s3.daily.ok === true && s3.daily.added === 2 && s3.daily.cancelled === 0, `${eng} 官方多 2 班 → 加開 2、停駛 0`);
  ck(s3.n === base.n, `${eng} 加開不進名冊(${s3.n},與基準相同)`);
  await p3.close();

  await br.close();
}
console.log(fail ? `\nFAIL ${fail}` : '\n✅ 前端全部通過');
process.exit(fail ? 1 : 0);
