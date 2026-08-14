// 跨午夜跟隨重播的驗收（缺陷⑤：452 跟隨時在半夜 12 點跳掉）。
//
// 觸發路徑（使用者原話：「今天週五晚上的452號列車，如果選擇跟隨，他會在半夜12點直接跳掉」）：
//   452 週五 23:57 才發車 ⇒ 晚上點跟隨時 effTLive(tr) < first.depSec - 60
//   ⇒ setFollow 走「把時鐘撥回發車前 20 秒」那條分支，設 simSec=86200、clockAtNow=false
//   ⇒ 之後動的是**模擬**時鐘，真實日期仍然是週五＝名冊日
//   ⇒ 模擬時鐘走過 00:00 時，schedWrapT 的 _noPrevWrap 守衛把它當成「開行日清晨的幽靈班」擋掉。
//
// 兩種情境的 simSec 完全同值（都是 0~10800 這種小數字），唯一能區辨的是
// 「這是不是使用者刻意要求回放的那一班」，所以判準也照這個切：
//   A 正向——被 setFollow 撥回發車前的那一班，重播跨過午夜必須全程畫得出座標。（改動前紅）
//   B 對照——昨天有開的跨夜班（_noPrevWrap=false）走同一條路徑，改動前後都必須全綠。
//            它證明 A 指向的變因是 _noPrevWrap，不是「跨午夜」或「setFollow」本身。
//   C 反向——沒在跟隨時，開行日清晨的幽靈班必須照樣被擋。
//   C2 反向——先跟隨重播、再按「現在」(jumpToNow)，幽靈班必須重新被擋（例外不得殘留）。
//   C3 反向——先跟隨 452、再改跟隨別班，452 的例外必須失效。
// C 系列存在的理由：把守衛整個刪掉是能讓 A 變綠的，C 系列就是為了讓那條路走不通。
//
// 判準來源非同源：全程只問 trainPos() 畫不畫得出座標，不讀 schedWrapT 的回傳值、也不看 followWrapStops。
//
// 用法：PORT=6400 ROOT=<受測樹> ENGINES=chromium,webkit node scripts/verify_452_midnight.mjs
import { createRequire } from 'module';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT || path.resolve(HERE, '..');
const PORT = Number(process.env.PORT || 6400);
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
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof state !== 'undefined' && state.trains && state.trains.length > 100,
    null, { timeout: 180000 });

  const setup = await page.evaluate(() => {
    const cands = [];
    for (const tr of state.trains) {
      if (tr.sys !== 'tra_sched' || !tr.stops || !tr.stops.length || tr.loop) continue;
      const s = tr.stops, last = s[s.length - 1];
      if (Math.max(last.arrSec, last.depSec) <= 86400) continue;       // 不跨午夜
      if (s._prevNight) continue;                                       // 從昨天借進來的，走另一條分支
      cands.push({ train: String(tr.train), noPrevWrap: !!s._noPrevWrap,
        rosterDay: s._rosterDay || null, dep: s[0].depSec, lastArr: last.arrSec });
    }
    return { rosterDay: state.wallDay, cands };
  });

  const guarded = setup.cands.filter(c => c.noPrevWrap);
  const control = setup.cands.filter(c => !c.noPrevWrap);
  console.log(`[${eng}] 名冊日 ${setup.rosterDay}；跨午夜班 ${setup.cands.length}，其中 _noPrevWrap ${guarded.length}、對照 ${control.length}`);

  if (!guarded.length) {
    console.error('中止：今天的名冊裡沒有「跨午夜且昨天沒開」的班，這支腳本今天驗不到東西。' +
      '換一天跑（2026-08-14 有 452），或以固定語料重跑。中止不等於通過。');
    await browser.close();
    process.exit(2);
  }

  // 走使用者的真實路徑：setFollow 進去，讓它自己撥鐘，再逐點推進模擬時鐘掃過午夜。
  //
  // ⚠️ 取樣窗要從**每一班自己的班表**推導，不能用固定的 31 點：跨午夜班各自的終到時刻不同，
  // 已經到終點的車本來就該被收走（使用者裁示「到終點站車子就拿掉」），那不是缺陷。
  // 首輪就踩到：對照班 1283 終到 86880（00:08），固定窗的 500–600 六個點全落在它到站之後，
  // 讓 B 假紅。判準改成「只驗它還在路上的那些點」——窗長由 lastArr 算出來，不是手打的常數。
  const followSweep = (trainNo, secs, lastArr) => page.evaluate(({ trainNo, secs, lastArr }) => {
    const tr = state.trains.find(t => t.sys === 'tra_sched' && String(t.train) === trainNo);
    if (!tr) return null;
    setFollow(tr, false, true);                    // noJump=true：不要動地圖，只要它撥鐘
    const inRun = secs.filter(sec => sec + 86400 <= lastArr);   // 午夜後仍在路上的取樣點
    const rec = { train: trainNo, afterFollowSim: state.simSec, clockAtNow: state.clockAtNow,
      lastArr, drawn: 0, total: 0, gaps: [] };
    for (const sec of inRun) {
      state.simSec = sec;                          // 模擬時鐘前進（clockAtNow 維持 setFollow 設的 false）
      rec.total++;
      if (trainPos(tr, sec)) rec.drawn++; else rec.gaps.push(sec);
    }
    return rec;
  }, { trainNo, secs, lastArr });

  // 午夜之後的取樣點（秒/日 0..600，每 20 秒一點）——重播中的車此時仍在路上
  const afterMidnight = Array.from({ length: 31 }, (_, i) => i * 20);
  // 清晨取樣點（03:00 起每分鐘，共 13 點）——用來驗幽靈班仍被擋
  const earlyMorning = Array.from({ length: 13 }, (_, i) => 10800 + i * 60);

  const A = [];
  for (const c of guarded) A.push(await followSweep(c.train, afterMidnight, c.lastArr));
  // A0 分母閘門：窗長為 0 的話 A 是空過的全稱斷言（沒有任何點被驗到）
  const Athin = A.filter(r => !r || r.total < 1);
  check(`[${eng}] A0 分母閘門：每一班受測車在午夜後都還有取樣點（否則 A 是空過）`,
    A.length > 0 && Athin.length === 0,
    A.length === 0 ? '沒有受測車' : Athin.length === 0
      ? A.map(r => `${r.train} 窗長 ${r.total}（終到 ${r.lastArr}）`).join('；')
      : Athin.map(r => `${r ? r.train : '(找不到車)'} 窗長 0`).join('；'));
  const Abad = A.filter(r => r && r.gaps.length);
  check(`[${eng}] A 跟隨重播跨過午夜，車在自己還沒到站的期間必須畫得出座標`,
    Abad.length === 0,
    Abad.length === 0 ? `${A.length} 班全程有座標（setFollow 後 simSec=${A[0] && A[0].afterFollowSim}, clockAtNow=${A[0] && A[0].clockAtNow}）`
      : Abad.map(r => `${r.train} 只畫出 ${r.drawn}/${r.total}，消失於 秒/日 ${r.gaps[0]}–${r.gaps[r.gaps.length - 1]}`).join('；'));

  const Bset = control.slice(0, 3);
  const B = [];
  for (const c of Bset) B.push(await followSweep(c.train, afterMidnight, c.lastArr));
  const Bthin = B.filter(r => !r || r.total < 1);
  check(`[${eng}] B0 分母閘門：對照班在午夜後也還有取樣點（否則 B 是空過）`,
    Bset.length > 0 && Bthin.length === 0,
    Bset.length === 0 ? '沒有對照班可用——A 的變因無法歸因，視同不合格'
      : Bthin.length === 0 ? B.map(r => `${r.train} 窗長 ${r.total}（終到 ${r.lastArr}）`).join('；')
        : Bthin.map(r => `${r ? r.train : '(找不到車)'} 窗長 0`).join('；'));
  const Bbad = B.filter(r => r && r.gaps.length);
  check(`[${eng}] B 對照：昨天有開的跨夜班走同一條路徑不受影響`,
    Bbad.length === 0 && Bset.length > 0,
    Bset.length === 0 ? '沒有對照班可用——A 的變因無法歸因，視同不合格'
      : Bbad.length === 0 ? `${Bset.length} 班全程有座標` : Bbad.map(r => `${r.train} ${r.drawn}/${r.total}`).join('；'));

  // C：沒在跟隨、時鐘貼著現在 ⇒ 開行日清晨的幽靈班必須畫不出來
  const C = await page.evaluate(({ trains, secs }) => {
    clearFollow();
    state.clockAtNow = true;
    const out = [];
    for (const no of trains) {
      const tr = state.trains.find(t => t.sys === 'tra_sched' && String(t.train) === no);
      const rec = { train: no, drawn: 0, total: 0 };
      for (const sec of secs) { state.simSec = sec; rec.total++; if (trainPos(tr, sec)) rec.drawn++; }
      out.push(rec);
    }
    return out;
  }, { trains: guarded.map(c => c.train), secs: earlyMorning });
  const Cleak = C.filter(r => r.drawn > 0);
  check(`[${eng}] C 反向：沒在跟隨時，開行日清晨的幽靈班仍被擋掉`,
    Cleak.length === 0,
    Cleak.length === 0 ? `${C.length} 班在 03:00–04:00 全數無座標（正確：昨晚沒開這班）`
      : Cleak.map(r => `${r.train} 竟畫出 ${r.drawn}/${r.total}`).join('；'));

  // C2：先跟隨重播，再按「現在」，幽靈班必須重新被擋
  const C2 = await page.evaluate(({ trainNo, secs }) => {
    const tr = state.trains.find(t => t.sys === 'tra_sched' && String(t.train) === trainNo);
    setFollow(tr, false, true);
    jumpToNow();
    const rec = { train: trainNo, drawn: 0, total: 0 };
    for (const sec of secs) { state.simSec = sec; rec.total++; if (trainPos(tr, sec)) rec.drawn++; }
    return rec;
  }, { trainNo: guarded[0].train, secs: earlyMorning });
  check(`[${eng}] C2 反向：跟隨重播後按「現在」，例外必須清掉`,
    C2.drawn === 0, C2.drawn === 0 ? `${C2.train} 在清晨 ${C2.total} 點全數無座標` : `${C2.train} 仍畫出 ${C2.drawn}/${C2.total}`);

  // C3：先跟隨 452、再改跟隨別班，舊車的例外必須失效
  const C3 = await page.evaluate(({ trainNo, otherNo, secs }) => {
    const tr = state.trains.find(t => t.sys === 'tra_sched' && String(t.train) === trainNo);
    const other = state.trains.find(t => t.sys === 'tra_sched' && String(t.train) === otherNo);
    setFollow(tr, false, true);
    setFollow(other, false, true);
    state.clockAtNow = true;
    const rec = { train: trainNo, drawn: 0, total: 0 };
    for (const sec of secs) { state.simSec = sec; rec.total++; if (trainPos(tr, sec)) rec.drawn++; }
    return rec;
  }, { trainNo: guarded[0].train, otherNo: (control[0] || guarded[0]).train, secs: earlyMorning });
  check(`[${eng}] C3 反向：改跟隨別班後，前一班的例外必須失效`,
    C3.drawn === 0, C3.drawn === 0 ? `${C3.train} 在清晨 ${C3.total} 點全數無座標` : `${C3.train} 仍畫出 ${C3.drawn}/${C3.total}`);

  await browser.close();
}

const bad = results.filter(r => !r.pass).length;
console.log(`\n合計 ${results.length - bad} PASS / ${bad} FAIL`);
process.exit(bad ? 1 : 0);
