// 台鐵即時層的「資料齡」與「裝置時鐘偏差」驗收（2026-08-20 批次 1）。
//
// 被修的缺陷：liveActive()/liveFresh() 原本判的是 `Date.now() - state.live.at`，而 at 是
// 【我們收到回應的時刻】不是資料的時刻。TDX TrainLiveBoard 掛掉時 worker.js 的 catch 分支會把
// 上一份快照以 HTTP 200 回下來，前端每分鐘照樣「收到」新回應 ⇒ 齡永遠≈0 ⇒ 徽章持續綠色 LIVE，
// 實際套的是幾十分鐘前的誤點。實測 22 天內三次整批斷線 65–95 分鐘（全在週一早高峰）。
//
// 判準刻意不與實作同源：
//   ・「誤點有沒有真的被套用」用 trainPosAt(tr, simSec)（純表定軸，整支函式不碰 liveDelaySec）
//     跟畫面實際繪製的 trainPos(tr, simSec) 比距離 —— 由軌道幾何回答，不是由新的閘門自己回答。
//   ・「使用者看到什麼」讀 #liveBadge 的 DOM（文字／est class／title），不呼叫 liveFresh()。
// 這支對【改動前的樹】必須整批轉紅（A2/A3/B2 三項）——那就是它有牙的證明。
//
// 用法：VURL=http://127.0.0.1:6521/index.html node scripts/verify_live_freshness.mjs
//       ENGINES=chromium,webkit 可雙引擎
import { chromium, webkit } from 'playwright';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.env.VURL || 'http://127.0.0.1:6521/index.html';
const ENGINES = (process.env.ENGINES || 'chromium').split(',').map(s => s.trim()).filter(Boolean);
const DELAY_MIN = 15;
let fail = 0;
const ck = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) fail++; };

// G0（judgment 心得 32）：印出受測目標並確認 server 提供的就是這棵樹
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const md5 = b => createHash('md5').update(b).digest('hex');
const diskHash = md5(readFileSync(path.join(ROOT, 'index.html')));
const servedHash = md5(Buffer.from(await (await fetch(URL)).arrayBuffer()));
console.log(`G0 目標自檢：ROOT=${ROOT}\n   ${URL}\n   disk=${diskHash} served=${servedHash}`);
if (diskHash !== servedHash) { console.log('  ✗ G0 服務中的不是這棵樹'); process.exit(1); }
console.log('  ✓ G0 驗的就是這棵樹');

for (const eng of ENGINES) {
  console.log(`\n===== ${eng} =====`);
  const br = await (eng === 'webkit' ? webkit : chromium).launch();

  // 每個情境開新分頁：easedShift 有跨輪狀態，同一頁改 payload 會量到「正在收斂中」的中間值。
  const scenario = async (name, { ageSec = 0, srvSkewSec = null, srvExtra = [], noSrv = false }) => {
    const pg = await br.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = []; pg.on('pageerror', e => errs.push(String(e)));
    let trainNo = '';
    let extraQueue = srvExtra.slice();     // 先吐幾筆「被墊高」的 srv 樣本，驗 min filter
    await pg.route('**/api/tra-live*', r => {
      const now = Date.now();
      const body = { at: new Date(now - ageSec * 1000).toISOString(),
        trains: trainNo ? [{ no: trainNo, delay: DELAY_MIN }] : [] };
      if (!noSrv) {
        const bump = extraQueue.length ? extraQueue.shift() : (srvSkewSec || 0);
        body.srv = now - bump * 1000;      // 裝置比伺服器快 bump 秒（或快取重播讓 srv 落後 bump 秒）
      }
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await pg.goto(URL, { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 500,
      null, { timeout: 60000 });

    // 挑一班此刻在跑、且沒有被防追撞夾持的台鐵車（夾持在停用即時層時也會造成位移，會混淆判準）。
    // 「在跑」用 trainSeg 判、不用 stops[0].depSec 比大小：跨午夜班次的時刻是 >86400 的編碼，
    // 直接比會把深夜唯一還在跑的那些車全部濾掉（00:12 實測 17 班在跑、用比大小只剩 0 班）。
    // 還要求「往前 15 分鐘也在跑」——否則注入的 15 分誤點會把車推到發車之前，trainPos 回 null。
    trainNo = await pg.evaluate((dm) => {
      const t = state.simSec;
      const tr = (state.trains || []).find(x => x.sys === 'tra_sched' && !x.loop && x.stops &&
        x.stops.length >= 5 && trainSeg(x, t) && !trainSeg(x, t).dwell && trainSeg(x, t - dm * 60) &&
        blockHoldSec(x) === 0);
      return tr ? String(tr.train) : '';
    }, DELAY_MIN);
    if (!trainNo) { console.log(`  [${name}] 此刻沒有可用的台鐵在跑班次，中止`); await pg.close(); process.exit(2); }

    // 讓即時層拉到這份 payload（多拉幾次餵滿時鐘偏差的 min filter）
    for (let i = 0; i < 3; i++) await pg.evaluate(() => pollLive());
    await pg.waitForTimeout(400);

    const out = await pg.evaluate((no) => {
      const el = document.getElementById('liveBadge');
      const tr = (state.trains || []).find(t => t.sys === 'tra_sched' && String(t.train) === no);
      const a = trainPos(tr, state.simSec), b = trainPosAt(tr, state.simSec);   // 畫面位置 vs 純表定軸
      return {
        hidden: !!el.hidden, text: el.textContent, est: el.classList.contains('est'), title: el.title,
        offM: (a && b) ? Math.round(haversineKm(a, b) * 1000) : -1,
      };
    }, trainNo);
    out.errs = errs;
    out.trainNo = trainNo;
    await pg.close();
    return out;
  };

  // ── A 上游凍結：at 停在過去，srv 仍是現在（＝資料舊、時鐘沒錯）
  const a1 = await scenario('A1', { ageSec: 20 });          // 20 秒：正常
  ck(!a1.hidden && a1.text === 'LIVE' && !a1.est, `A1 資料 20 秒新 → 綠 LIVE（車${a1.trainNo} 偏移 ${a1.offM}m）`);
  ck(a1.offM > 200, `A1 誤點 ${DELAY_MIN} 分確實套進位置（離純表定 ${a1.offM}m > 200m）`);

  const a2 = await scenario('A2', { ageSec: 600 });         // 10 分：超過 fresh 門檻、未超過套用門檻
  ck(!a2.hidden && a2.text === '推估' && a2.est, `A2 資料 10 分舊 → 灰「推估」不再宣稱即時（實得「${a2.text}」）`);
  ck(/資料已 \d+ 分鐘未更新/.test(a2.title), `A2 title 說得出為什麼：${a2.title.slice(-30)}`);
  ck(a2.offM > 200, `A2 仍在投射最後已知誤點（離純表定 ${a2.offM}m）`);

  const a3 = await scenario('A3', { ageSec: 3600 });        // 60 分：超過 30 分套用上限
  ck(a3.hidden, `A3 資料 60 分舊 → 徽章熄滅（liveActive 關）`);
  ck(a3.offM <= 5, `A3 陳舊誤點不再套用，車回到純表定位置（離 ${a3.offM}m ≤ 5m）`);

  // ── B 裝置時鐘偏差：資料是新的，但裝置時鐘比伺服器快
  const b1 = await scenario('B1', { ageSec: 20, srvSkewSec: 150 });
  ck(!b1.hidden && b1.text === '推估' && b1.est, `B1 裝置快 150 秒 → 降為「推估」（實得「${b1.text}」）`);
  ck(/裝置時鐘與伺服器差/.test(b1.title), `B1 title 指名時鐘：${b1.title.slice(-26)}`);

  const b2 = await scenario('B2', { ageSec: 20, srvSkewSec: 0, srvExtra: [200, 180] });
  ck(!b2.hidden && b2.text === 'LIVE' && !b2.est,
    `B2 min filter：前兩筆被快取墊高 200/180 秒、第三筆是真值 0 → 不誤報時鐘偏差（實得「${b2.text}」）`);

  // ── C 向後相容：舊版 worker（沒有 srv 欄）行為與改動前相同
  const c1 = await scenario('C1', { ageSec: 20, noSrv: true });
  ck(!c1.hidden && c1.text === 'LIVE' && !c1.est, `C1 payload 無 srv → 時鐘偏差維持「未知」，不影響 tier`);
  ck(c1.errs.length === 0, `C1 零 pageerror${c1.errs.length ? '：' + c1.errs[0].slice(0, 60) : ''}`);

  // ── D 診斷欄：位置管線那行
  const pg = await br.newPage({ viewport: { width: 1280, height: 800 } });
  const derrs = []; pg.on('pageerror', e => derrs.push(String(e)));
  await pg.route('**/api/tra-live*', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ at: new Date().toISOString(), srv: Date.now(), trains: [] }) }));
  // setDiagStrip 住在 IIFE 裡不是全域；開機時會讀這個 localStorage 旗標自行開啟（走的正是使用者
  // 從「更多 → 診斷資訊」開啟後重新載入的那條路徑）
  await pg.addInitScript(() => { try { localStorage.setItem('trainmap-diagstrip', '1'); } catch (e) {} });
  await pg.goto(URL, { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 500,
    null, { timeout: 60000 });
  const d = await pg.evaluate(async () => {
    const el = () => document.getElementById('diagStrip');
    const lines = () => [...el().children].map(c => ({ t: c.textContent, vis: getComputedStyle(c).display !== 'none' }));
    const before = lines();
    const t = state.simSec;
    const tr = (state.trains || []).find(x => x.sys === 'tra_sched' && !x.loop && x.stops &&
      x.stops.length >= 5 && trainSeg(x, t) && !trainSeg(x, t).dwell);
    if (!tr) return { before, after: before, followed: false };
    setFollow(tr, false, true);
    await new Promise(r => setTimeout(r, 1300));            // 等診斷欄的 1 秒 tick 重畫
    return { before, after: lines(), followed: !!tr };
  });
  // 對照組（改動前的樹）只有一行、沒有子元素 → 這裡必須回報 FAIL 而不是拋例外中止：
  // 「腳本掛掉」與「判準轉紅」在終端上長得不一樣，前者會讓後面幾項假裝不存在（judgment 心得 36）
  const bl = d.before[1] || { t: '', vis: false }, al = d.after[1] || { t: '', vis: false };
  ck(d.before.length === 2 && !d.before[0].vis && bl.t.startsWith('v'),
    `D1 沒跟車時位置行隱藏、渲染健康那行照舊（"${bl.t.slice(0, 22)}…"）`);
  const pos = d.after[0] || { t: '', vis: false };
  ck(pos.vis && /^pos /.test(pos.t), `D2 跟車後位置行出現：${pos.t}`);
  ck(/lv:[fe-]/.test(pos.t) && /\bds-?\d/.test(pos.t) && /\bbh\d/.test(pos.t) &&
     /rn:\S+/.test(pos.t) && /cr:\S+/.test(pos.t) && /\bda/.test(pos.t) && /\bsk/.test(pos.t),
    `D3 六個欄位齊全（lv/ds/bh/rn/cr/da/sk）`);
  ck(al.t.startsWith('v') && /\brf\d/.test(al.t) && / h[01]$| h[01] /.test(al.t + ' '),
    `D4 渲染健康那行內容未被改動（"${al.t.slice(0, 30)}…"）`);
  ck(derrs.length === 0, `D5 零 pageerror${derrs.length ? '：' + derrs[0].slice(0, 60) : ''}`);
  await pg.close();
  await br.close();
}

console.log(fail ? `\nFAIL ${fail} 項` : '\nALL PASS');
process.exit(fail ? 1 : 0);
