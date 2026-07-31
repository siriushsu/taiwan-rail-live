// 跨系統撞號家族第二處：liveDelaySec 把誤點交給漸變層時鍵寫死 'tra:'+車次，不含系統別。
// 台鐵 1 次與林鐵 1 次共用同一個 easedShift 條目 ⇒ 林鐵那班套到台鐵的誤點被推走，
// 而它自己的 target=0 又反過來把共用條目往 0 拉，兩班互相拉扯。
//
// 判準刻意不與實作同源：受害車的「應該在哪」用 trainPosAt(tr, simSec) 當真值——那是純表定軸，
// 整支函式碰都不碰 liveDelaySec/easedShift；拿它跟畫面實際繪製的 trainPos(tr, simSec) 比距離。
// 「誤點該不該套」這件事因此由軌道幾何回答，不是由誤點層自己回答。
//
// 用法：VURL=http://127.0.0.1:6400/index.html node scripts/verify_easedshift_key.mjs
import { chromium, webkit } from 'playwright';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.env.VURL || 'http://127.0.0.1:6400/index.html';
const DM = +(process.env.DELAY_MIN || 12), DS = DM * 60;
const ENGINES = (process.env.ENGINES || 'chromium').split(',').filter(Boolean);
const TOL_M = 5;             // 受害車偏離純表定位置的容忍（公尺）
let fail = 0;
const ck = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) fail++; };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const md5 = b => createHash('md5').update(b).digest('hex');
const diskHash = md5(readFileSync(path.join(ROOT, 'index.html')));
const servedHash = md5(Buffer.from(await (await fetch(URL)).arrayBuffer()));
console.log(`G0 目標自檢：${URL}\n   disk=${diskHash} served=${servedHash}`);
if (diskHash !== servedHash) { console.log('  ✗ G0 服務中的不是當前工作區'); process.exit(1); }
console.log('  ✓ G0 驗的就是當前工作區');

for (const eng of ENGINES) {
  const launcher = eng === 'webkit' ? webkit : chromium;
  console.log(`\n===== ${eng} =====`);
  const br = await launcher.launch();
  const pg = await br.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));

  let mockNos = [];
  await pg.route('**/api/tra-live*', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ at: new Date().toISOString(), trains: mockNos.map(n => ({ no: n, delay: DM })) }) }));

  const boot = async () => {
    await pg.goto(URL, { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 500,
      null, { timeout: 60000 });
  };
  await boot();

  // 找一組「此刻兩邊都在跑」的撞號配對：台鐵那班注入誤點，非台鐵那班是受害者
  const pair = await pg.evaluate(() => {
    const running = t => { const s = t.stops; return s && s.length > 1 && s[0].depSec < nowSecOfDay() && nowSecOfDay() < s[s.length - 1].arrSec; };
    const byNo = new Map();
    for (const t of state.trains) {
      if (t.loop || !t.stops) continue;
      const k = String(t.train);
      if (!byNo.has(k)) byNo.set(k, []);
      byNo.get(k).push(t);
    }
    const out = [];
    for (const [no, list] of byNo) {
      const tra = list.find(t => t.sys === 'tra_sched'), other = list.find(t => t.sys && t.sys !== 'tra_sched');
      if (!tra || !other) continue;
      out.push({ no, otherSys: other.sys, traRunning: running(tra), otherRunning: running(other),
        traSysField: tra.sys, otherStops: other.stops.length });
    }
    return { pairs: out, anyMissingSys: state.trains.some(t => !t.sys) };
  });
  const usable = pair.pairs.filter(p => p.traRunning && p.otherRunning);
  console.log(`  撞號配對 ${pair.pairs.length} 組；此刻兩邊都在跑 ${usable.length} 組` +
    `${usable.length ? '：' + usable.slice(0, 4).map(p => p.no + '(' + p.otherSys + ')').join('、') : ''}`);
  ck(pair.anyMissingSys === false, `所有班次都有 tr.sys 欄位（鍵可安全帶系統別）`);
  if (!usable.length) { console.log('  此刻沒有兩邊同時在跑的撞號配對（林鐵只跑白天），中止'); await br.close(); process.exit(2); }

  const pick = usable[0];
  // 對照組：一班「沒有撞號」的台鐵車，同樣注入誤點。它在修改前後都該拿到一模一樣的誤點量——
  // 這條是用來證明修法只動到撞號那 24 個號碼，其餘 974 班行為完全沒變。
  const ctrl = await pg.evaluate(({ ds }) => {
    const dup = new Set();
    const byNo = new Map();
    for (const t of state.trains) { const k = String(t.train); byNo.set(k, (byNo.get(k) || 0) + 1); }
    for (const [k, n] of byNo) if (n > 1) dup.add(k);
    const now = nowSecOfDay();
    const t = state.trains.find(x => x.sys === 'tra_sched' && !x.loop && x.stops && x.stops.length >= 5 &&
      x.stops.length <= 60 && !dup.has(String(x.train)) &&
      x.stops[0].depSec < now - ds && now < x.stops[x.stops.length - 1].arrSec - 600);
    return t ? String(t.train) : null;
  }, { ds: DS });
  console.log(`  對照組（無撞號的台鐵車）：${ctrl || '（找不到）'}`);
  mockNos = ctrl ? [pick.no, ctrl] : [pick.no];
  await boot();                                  // 重載讓 easedShift 走 snap 路徑直接對齊
  await pg.evaluate(() => pollLive());
  await pg.waitForTimeout(1000);

  const snap = await pg.evaluate(async ({ no }) => {
    const tra = state.trains.find(t => String(t.train) === no && t.sys === 'tra_sched');
    const oth = state.trains.find(t => String(t.train) === no && t.sys && t.sys !== 'tra_sched');
    const T = state.simSec;
    // 受害車：畫面實際繪製位置 vs 純表定軸位置（trainPosAt 不碰 liveDelaySec，故為獨立真值）
    const drawn = trainPos(oth, T), sched = trainPosAt(oth, T);
    // 🔴 純度不能用「同步連呼叫」量：easedShift 的 dt = (now - e.at)/1000，同步連呼叫 dt≈0 ⇒ 條目不動，
    // 壞的版本一樣是綠的（實測過）。拉扯要在「真實時間流逝＋畫面每幀各自呼叫」時才顯形，
    // 故改成隔 400ms 取樣、讓 render loop 在中間替兩班車各叫一輪。
    const seriesOther = [], seriesTra = [];
    for (let i = 0; i < 6; i++) {
      seriesOther.push(+liveDelaySec(oth).toFixed(1)); seriesTra.push(+liveDelaySec(tra).toFixed(1));
      await new Promise(r => setTimeout(r, 400));
    }
    return {
      no, otherSys: oth.sys,
      driftM: (drawn && sched) ? +(haversineKm(drawn, sched) * 1000).toFixed(1) : null,
      otherDelay: +liveDelaySec(oth).toFixed(3), traDelay: +liveDelaySec(tra).toFixed(3),
      seriesOther, seriesTra,
      traDrawn: !!trainPos(tra, T),
    };
  }, { no: pick.no });

  // 對照組量測：無撞號的車，誤點必須恰為注入值且穩定（修改前後皆然）
  let ctrlRes = null;
  if (ctrl) {
    ctrlRes = await pg.evaluate(async ({ no }) => {
      const t = state.trains.find(x => String(x.train) === no && x.sys === 'tra_sched');
      const ser = [];
      for (let i = 0; i < 4; i++) { ser.push(+liveDelaySec(t).toFixed(1)); await new Promise(r => setTimeout(r, 300)); }
      const T = state.simSec, drawn = trainPos(t, T), sched = trainPosAt(t, T);
      return { ser, driftM: (drawn && sched) ? +(haversineKm(drawn, sched) * 1000).toFixed(1) : null };
    }, { no: ctrl });
  }

  console.log(`    車次 ${snap.no}：台鐵注入 ${DM} 分 → 台鐵實得 ${(snap.traDelay / 60).toFixed(2)} 分、` +
    `${snap.otherSys} 那班實得 ${(snap.otherDelay / 60).toFixed(2)} 分`);
  console.log(`    ${snap.otherSys} 連續 6 次：${snap.seriesOther.join(' → ')}`);
  console.log(`    台鐵   連續 6 次：${snap.seriesTra.join(' → ')}`);

  ck(snap.driftM != null && snap.driftM <= TOL_M,
    `K1 ${snap.otherSys} 的車畫在純表定位置上（偏離 ${snap.driftM} m ≤ ${TOL_M}）——沒被台鐵的誤點推走`);
  ck(snap.otherDelay === 0, `K2 ${snap.otherSys} 那班的 liveDelaySec 恆 0，實得 ${snap.otherDelay}`);
  const span = a => Math.max(...a) - Math.min(...a);
  ck(span(snap.seriesOther) === 0 && snap.seriesOther[0] === 0,
    `K3 ${snap.otherSys} 跨 2.4 秒六次取樣恆 0（跨度 ${span(snap.seriesOther).toFixed(1)}s）`);
  ck(span(snap.seriesTra) <= 2,
    `K4 台鐵跨 2.4 秒六次取樣不被拉扯（跨度 ${span(snap.seriesTra).toFixed(1)}s ≤ 2）`);
  ck(snap.seriesTra[snap.seriesTra.length - 1] > DS * 0.9,
    `K5 台鐵的誤點沒有被對方拉低：收尾 ${(snap.seriesTra[snap.seriesTra.length - 1] / 60).toFixed(2)} 分（注入 ${DM}）`);

  if (ctrlRes) {
    const sp = Math.max(...ctrlRes.ser) - Math.min(...ctrlRes.ser);
    console.log(`    對照組 ${ctrl} 四次取樣：${ctrlRes.ser.join(' → ')}｜偏離純表定 ${ctrlRes.driftM} m`);
    ck(ctrlRes.ser.every(v => Math.abs(v - DS) < 1) && sp < 1,
      `K6 對照組（無撞號）誤點恰為注入的 ${DM} 分且穩定——修法沒波及非撞號車次`);
    ck(ctrlRes.driftM > 100,
      `K7 對照組確實被誤點推開了 ${ctrlRes.driftM} m（前置：誤點有在作用，K1 的 0m 才有意義）`);
  }
  ck(errs.length === 0, `無 pageerror${errs.length ? '：' + errs.slice(0, 2).join(' | ') : ''}`);
  await br.close();
}
console.log(`\n${fail === 0 ? '✅ 全部通過' : `❌ ${fail} 項失敗`}`);
process.exit(fail === 0 ? 0 : 1);
