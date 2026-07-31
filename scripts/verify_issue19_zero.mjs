// issue #19 零變化控制組：誤點 0 的車（台鐵）、高鐵（liveDelaySec 恆 0）、捷運（走 metroShiftSec，
// 且 freq 模式根本到不了那三個函式）——修改前後面板每一項數字必須完全相同。
//
// 決定性設計：一次同步 evaluate 內完成「撥鐘 → 重繪面板 → 讀 DOM」。JS 單執行緒，這段期間 rAF
// 不會插進來動 state.simSec，故兩棵樹在同一個 PIN 上的輸出可逐字比對，不受跑測耗時影響。
// 撥到「現在＋60 秒」而不是過去：liveActive 要求 simSec 不得落後現在 120 秒以上，撥到過去會把
// 即時校正整層關掉——那樣比的是「兩邊都沒有校正」，等於沒驗到（心得 34：環境條件會偽裝成產品行為）。
//
// 用法：BASE=http://127.0.0.1:6301/index.html MOD=http://127.0.0.1:6300/index.html node scripts/verify_issue19_zero.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE, MOD = process.env.MOD;
if (!BASE || !MOD) { console.log('需要 BASE 與 MOD 兩個 URL'); process.exit(2); }
let fail = 0;
const ck = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) fail++; };

const br = await chromium.launch();

// 兩邊看到完全一樣的即時名單：固定 payload，且刻意不含我們要驗的車次（＝該車誤點 0）
const LIVE = { at: '2026-07-31T00:00:00+08:00', trains: [{ no: '__none__', delay: 3 }] };

async function capture(url, pin) {
  const pg = await br.newPage({ viewport: { width: 1280, height: 800 } });
  await pg.route('**/api/tra-live*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LIVE) }));
  await pg.goto(url, { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 500, null, { timeout: 60000 });
  await pg.evaluate(() => pollLive());

  const out = {};
  // ── 台鐵 / 高鐵：兩班都在 sched 模式，走 updateFollowPanel
  for (const sys of ['tra_sched', 'thsr_sched']) {
    out[sys] = await pg.evaluate(({ sys, pin }) => {
      const syObj = state.systems.find(x => x.id === sys);
      if (state.sysId !== sys) loadSystem(syObj);
      const pool = (state.trains || []).filter(t => t.sys === sys && !t.loop && t.stops &&
        t.stops.length >= 5 && t.stops.length <= 60);   // 排除 195 站的環島觀光班次，取代表性車次
      // 挑一班在 pin 時刻確實在跑的車（否則面板一片「已抵達終點」，比什麼都一樣＝零資訊）
      const tr = pool.find(t => t.stops[0].depSec < pin && pin < t.stops[t.stops.length - 1].arrSec);
      if (!tr) return { err: 'no running train at pin', pool: pool.length };
      setFollow(tr, false, true);
      setSimSec(pin);                       // 以下同步執行，simSec 不會被動畫改到
      updateFollowPanel(tr);
      const txt = id => { const e = document.getElementById(id); return e ? e.textContent : null; };
      const html = id => { const e = document.getElementById(id); return e ? e.innerHTML : null; };
      const info = nextStopInfo(tr, effTLive(tr)), dw = dwellInfoOf(tr, effTLive(tr));
      const pr = journeyProgress(tr, effTLive(tr)), p = trainPos(tr, state.simSec);
      return {
        train: String(tr.train), simSec: state.simSec, dl: liveDelaySec(tr), hold: blockHoldSec(tr),
        next: txt('fpNext'), eta: html('fpEta'), status: txt('fpStatus'), prog: txt('fpProgTxt'), spd: html('fpSpd'),
        infoName: info && info.name, infoAt: info && info.at, infoMin: info && +info.min.toFixed(6),
        dwellName: dw && dw.st.name, dwellRemain: dw && +dw.remain.toFixed(6),
        done: +pr.done.toFixed(9), total: +pr.total.toFixed(9),
        lat: p && +p.lat.toFixed(9), lon: p && +p.lon.toFixed(9),
      };
    }, { sys, pin });
  }
  // ── 捷運：freq 模式。這一格刻意不比「卡片數值」——metroShiftSec 與台鐵的 liveDelaySec 共用 easedShift，
  // 值會隨「頁面活了多久」漸進收斂，兩趟必然不同（實測基準對基準自己就不一致），拿它比對只會量到跑測耗時。
  // 改驗真正該成立的不變式：freq 模式下那三個函式一次都不會被呼叫（mode gate 擋在 showFollowPanel /
  // scanFollowEvents / drawFollowMarker 三處）。並附 sched 模式的控制組，證明計數器真的數得到東西——
  // 否則「0 次」可能只是包裝沒生效的假綠。
  out.metroGate = await pg.evaluate(async ({ pin }) => {
    const names = ['nextStopInfo', 'dwellInfoOf', 'journeyProgress', 'drawFreq'];
    const cnt = {}, origs = {};
    for (const n of names) {
      cnt[n] = 0; origs[n] = window[n];
      window[n] = function (...a) { cnt[n]++; return origs[n].apply(this, a); };
    }
    try {
      // 控制組：台鐵 sched 模式下必須數得到
      loadSystem(state.systems.find(x => x.id === 'tra_sched'));
      await new Promise(r => setTimeout(r, 600));
      setSimSec(pin);
      const tr = (state.trains || []).find(t => t.sys === 'tra_sched' && !t.loop && t.stops &&
        t.stops.length >= 5 && t.stops.length <= 60 &&
        t.stops[0].depSec < pin && pin < t.stops[t.stops.length - 1].arrSec);
      if (tr) { setFollow(tr, false, true); updateFollowPanel(tr); }
      await new Promise(r => setTimeout(r, 900));
      const schedCnt = { ...cnt };

      // 受測組：切到捷運、跟一班「實際時刻」班次（走 metroShiftSec 那條），讓它跑幾十幀
      for (const n of names) cnt[n] = 0;
      loadSystem(state.systems.find(x => x.id === 'mrt'));
      await new Promise(r => setTimeout(r, 600));
      setSimSec(pin);
      recomputeTrains();
      let ln = null, trM = null;
      for (const l of (state.lines || [])) {
        if (!l._tt || !l._tt.length) continue;
        const hit = l._tt.find(t => freqTrainTime(t, state.simSec - metroShiftSec(l, t)) != null);
        if (hit) { ln = l; trM = hit; break; }
      }
      if (ln) { state.freqFollow = { ln, tr: trM }; updateFreqFollowCamera(true); }
      await new Promise(r => setTimeout(r, 1600));
      const metroCnt = { ...cnt }; const liveness = metroCnt.drawFreq; delete metroCnt.drawFreq;
      const txt = id => { const e = document.getElementById(id); return e ? e.textContent : null; };
      delete schedCnt.drawFreq;
      return { schedCnt, metroCnt, liveness, metroLine: ln && (ln.name || ln.abbr), followed: !!state.freqFollow,
        cardHidden: document.getElementById('freqCard').hidden, fcLine: txt('fcLine'), fcNext: txt('fcNext') };
    } finally { for (const n of names) window[n] = origs[n]; }
  }, { pin });

  await pg.close();
  return out;
}

// 兩邊用同一個 PIN；撥到現在＋60 秒讓 liveActive 維持開啟
const pin = await (async () => {
  const pg = await br.newPage();
  await pg.goto(MOD, { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => typeof nowSecOfDay === 'function', null, { timeout: 30000 });
  const v = await pg.evaluate(() => nowSecOfDay() + 60);
  await pg.close();
  return Math.round(v);
})();
console.log(`PIN simSec = ${pin}（現在＋60 秒，維持 liveActive 開啟）`);

// 背靠背交錯跑，兩趟之間不隔分鐘
const b1 = await capture(BASE, pin);
const m1 = await capture(MOD, pin);
const b2 = await capture(BASE, pin);

for (const key of ['tra_sched', 'thsr_sched']) {
  const B = b1[key], M = m1[key], B2 = b2[key];
  if (B && B.err) { console.log(`  ${key} 略過：${B.err}`); continue; }
  ck(JSON.stringify(B) === JSON.stringify(B2), `${key} 基準自身可重現（同一 PIN 兩趟一致）`);
  // 守門：抓到的值本身要有內容，否則「空 == 空」是零資訊的假綠
  const meat = B.next && B.prog && B.status;
  ck(!!meat, `${key} 抓到的面板內容非空（非「空 vs 空」的假綠）`);
  const same = JSON.stringify(B) === JSON.stringify(M);
  ck(same, `${key} 修改前後逐欄位相同${same ? '' : ''}`);
  if (!same) {
    for (const k of new Set([...Object.keys(B || {}), ...Object.keys(M || {})]))
      if (JSON.stringify(B[k]) !== JSON.stringify(M[k]))
        console.log(`      ${k}: 基準=${JSON.stringify(B[k])} 修改後=${JSON.stringify(M[k])}`);
  } else {
    console.log(`      車次/線 ${B.train || B.line}｜下一站 ${B.next || B.fcNext}｜進度 ${B.prog || '—'}｜誤點 ${B.dl != null ? B.dl : '—'}`);
  }
}

// ── 捷運不變式（在兩棵樹上都必須成立）
for (const [label, cap] of [['基準', b1], ['修改後', m1]]) {
  const g = cap.metroGate;
  const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
  ck(sum(g.schedCnt) > 0, `${label}｜控制組：sched 模式下計數器數得到 ${JSON.stringify(g.schedCnt)}（包裝確實生效）`);
  ck(sum(g.metroCnt) === 0,
    `${label}｜捷運 ${g.metroLine || '—'} 跟隨中，三個函式呼叫次數 ${JSON.stringify(g.metroCnt)} 全為 0`);
  // 前置：跟隨真的活著（卡片內容寫進去了）＋畫面真的在跑（drawFreq 每幀被呼叫）。
  // 少了後者，「三個函式 0 次」有可能只是頁面凍結，不是 mode gate 生效。
  ck(g.followed && !!g.fcLine && !!g.fcNext,
    `${label}｜前置成立：捷運跟隨卡有實際內容（${g.fcLine || '空'}／下一站 ${g.fcNext || '空'}）`);
  ck(g.liveness > 0, `${label}｜前置成立：捷運段畫面確實在跑（drawFreq ${g.liveness} 次）`);
}

await br.close();
console.log(`\n${fail === 0 ? '✅ 零變化控制組全部通過' : `❌ ${fail} 項失敗`}`);
process.exit(fail === 0 ? 0 : 1);
