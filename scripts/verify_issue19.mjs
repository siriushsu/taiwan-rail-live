// issue #19 驗收：跟車面板的時間軸不得比地圖上的車落後一個誤點量。
//
// 判準刻意不與實作同源（心得 29）：不拿 nextStopInfo 去驗 journeyProgress（兩者同軸、必然自洽），
// 而是拿「地圖實際繪製的車輛座標」當外部真值——把面板宣稱的已行駛里程換算回路線上的一點，
// 量它與繪製點的實地距離；另一路用幾何投影把繪製點反算成里程，兩路互相對帳。
// 時間軸是唯一的自變數，里程/軌道幾何兩邊共用（那是量尺，不是待驗的假設）。
//
// 用法：PORT=<自選> node scripts/dev_server.mjs & 然後
//       VURL=http://localhost:<PORT>/index.html node scripts/verify_issue19.mjs
// 環境變數：DELAY_MIN 注入誤點（預設 7，對齊使用者影片的台鐵 2619）、OUT 落檔路徑、ENGINES 引擎清單
import { chromium, webkit } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.env.VURL || 'http://localhost:5288/index.html';
const DM = +(process.env.DELAY_MIN || 7), DS = DM * 60;
const ENGINES = (process.env.ENGINES || 'chromium').split(',').filter(Boolean);
const GAP_KM = 0.5;                 // 驗收門檻：面板里程換算回的點 vs 繪製點
let fail = 0;
const ck = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) fail++; };

// ── G0 自檢：確認 server 端的就是「當前工作區」那份 index.html。
// 這台機器同時有 20+ 個 worktree 在跑 server，驗到別人的檔案而全綠是真的發生過的事（心得 32）。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const md5 = b => createHash('md5').update(b).digest('hex');
const diskHash = md5(readFileSync(path.join(ROOT, 'index.html')));
const servedHash = md5(Buffer.from(await (await fetch(URL)).arrayBuffer()));
console.log(`G0 目標自檢：${URL}\n   工作區 ${ROOT}\n   disk=${diskHash} served=${servedHash}`);
if (diskHash !== servedHash) { console.log('  ✗ G0 服務中的檔案不是當前工作區——換一個 port 再跑'); process.exit(1); }
console.log('  ✓ G0 驗的就是當前工作區');

// 在頁面內注入的量測工具：全部只依賴軌道幾何與繪製函式，不碰面板的時間軸。
const PROBE = `
// 面板宣稱的里程 → 路線上的一點（純單位換算，用與繪製同一套軌道幾何）
window.__posAtDone = function (tr, doneKm) {
  const s = tr.stops;
  let cum = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const k = tr._segKm[i];
    if (doneKm <= cum + k || i === s.length - 2) {
      const f = k > 0 ? Math.max(0, Math.min(1, (doneKm - cum) / k)) : 0;
      return s[i].segLn ? schedSegmentPos(s[i], f)
        : { lat: s[i].lat + (s[i + 1].lat - s[i].lat) * f, lon: s[i].lon + (s[i + 1].lon - s[i].lon) * f };
    }
    cum += k;
  }
  return null;
};
// 繪製點 → 里程（幾何投影，與任何時間軸無關）
window.__geoDone = function (tr, P) {
  const s = tr.stops;
  let cum = 0, best = null;
  for (let i = 0; i < s.length - 1; i++) {
    const seg = s[i], segKm = tr._segKm[i];
    let along, err;
    if (seg.segLn) {
      const pr = projectOntoShape(seg.segLn, P.lat, P.lon);
      const lo = Math.min(seg.dA, seg.dB), hi = Math.max(seg.dA, seg.dB);
      const dc = Math.max(lo, Math.min(hi, pr.d));
      along = Math.abs(dc - seg.dA);
      err = pr.perpKm + Math.abs(dc - pr.d);   // 垂距 + 被夾出segment 的量
    } else {
      const A = s[i], B = s[i + 1];
      const kx = Math.cos(P.lat * Math.PI / 180) * 111.32, ky = 111.32;
      const ax = (A.lon - P.lon) * kx, ay = (A.lat - P.lat) * ky;
      const bx = (B.lon - P.lon) * kx, by = (B.lat - P.lat) * ky;
      const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / L2)) : 0;
      along = t * Math.sqrt(L2);
      err = Math.hypot(ax + vx * t, ay + vy * t);
    }
    if (!best || err < best.err) best = { km: cum + along, err };
    cum += segKm;
  }
  return best;
};
// 一次 tick 內同時取「地圖實況」與「面板實況」，避免兩者取樣時刻錯開
window.__snap = function () {
  const tr = state.followTrain;
  if (!tr) return { err: 'no followTrain' };
  journeyProgress(tr, 0);                       // 暖 _segKm/_totalKm
  const simSec = state.simSec;
  const dl = liveDelaySec(tr), hold = blockHoldSec(tr);
  const P = trainPos(tr, simSec);               // 地圖實際繪製的座標（index.html:5297 同一支）
  const pr = journeyProgress(tr, effTLive(tr)); // 面板進度（index.html:12440 同一支）
  const info = nextStopInfo(tr, effTLive(tr));
  const dw = dwellInfoOf(tr, effTLive(tr));
  const segMap = trainSeg(tr, simSec - dl - hold);   // 地圖側的段別（純幾何/時間，未經面板）
  const pPanel = P ? window.__posAtDone(tr, pr.done) : null;
  const geo = P ? window.__geoDone(tr, P) : null;
  const pa = trainPos(tr, simSec), pb = trainPos(tr, simSec + 20);
  const kmh = (pa && pb) ? Math.min(haversineKm(pa, pb) / 20 * 3600, speedCapOf(tr)) : 0;
  const txt = id => { const e = document.getElementById(id); return e ? (e.textContent || '') : null; };
  return {
    train: String(tr.train), sys: tr.sys, simSec, dl, hold,
    P, kmh,
    donePanel: pr.done, total: pr.total,
    gapKm: (P && pPanel) ? haversineKm(P, pPanel) : null,      // 主判準
    geoKm: geo ? geo.km : null, geoErr: geo ? geo.err : null,  // 對帳用
    geoGapKm: (geo && pr) ? Math.abs(geo.km - pr.done) : null,
    mapDwell: segMap ? !!segMap.dwell : null,
    mapDwellName: (segMap && segMap.dwell) ? tr.stops[segMap.i].name : null,
    panelDwellName: dw ? dw.st.name : null,
    nextName: info ? info.name : null, nextMin: info ? info.min : null,
    dom: { next: txt('fpNext'), eta: txt('fpEta'), status: txt('fpStatus'),
           prog: txt('fpProgTxt'), spd: txt('fpSpd'),
           tcNext: txt('tcLiveNext'), tcSpd: txt('tcLiveSpd'), tcDelay: txt('tcLiveDelay') },
  };
};
`;

const out = { url: URL, diskHash, delayMin: DM, engines: {} };

for (const eng of ENGINES) {
  const launcher = eng === 'webkit' ? webkit : chromium;
  console.log(`\n===== ${eng} =====`);
  const br = await launcher.launch();
  const ctx = await br.newContext({ viewport: { width: 1280, height: 800 } });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e)));

  let mockNo = null;
  await pg.route('**/api/tra-live*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ at: new Date().toISOString(), trains: mockNo ? [{ no: mockNo, delay: DM }] : [] }),
  }));
  await pg.addInitScript(PROBE);

  const boot = async () => {
    await pg.goto(URL, { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 500,
      null, { timeout: 60000 });
  };
  await boot();

  // ── 選車：台鐵、非環島、此刻在旅途中、且扣掉注入誤點後仍在旅途中（全程短於誤點量的車扣完會落在發車前）。
  // 另要求後段還有一個「停靠 ≥30 秒」的停站，供情境 B（車停在站上）使用。
  //
  // 🔴 排除「跨系統撞號」的車次：easedShift 的鍵是 'tra:'+車次、不含系統別，車次 1 同時存在於台鐵與
  // 林鐵時兩者共用同一個 entry，林鐵那班的 target=0 會把台鐵的誤點一路拖回去（實測 7 分 → 6 分且持續下滑）。
  // 那是 issue #19 以外、已知未修的另一條缺陷；拿它當樣本會讓本測的誤點量在量測途中漂移。
  const cand = await pg.evaluate(({ ds }) => {
    const now = nowSecOfDay(), out = [];
    const seen = new Map();                       // 車次 → 擁有它的 sched 系統集合
    for (const sy of state.systems.filter(x => x.mode === 'sched'))
      for (const t of ((sy.data && sy.data.trains) || [])) {
        const k = String(t.train);
        if (!seen.has(k)) seen.set(k, new Set());
        seen.get(k).add(sy.id);
      }
    for (const tr of state.trains) {
      if (tr.loop || !tr.stops || tr.stops.length < 4) continue;
      if (tr.sys !== 'tra_sched') continue;
      const s = tr.stops, first = s[0], last = s[s.length - 1];
      if (s.length > 60) continue;                                  // 環島觀光班次（195 站）不當樣本
      if (/環島/.test(last.name) || first.name === last.name) continue;
      if ((seen.get(String(tr.train)) || new Set()).size > 1) continue; // 跨系統撞號 → easedShift 共鍵，誤點會漂
      const live = now - ds;
      if (!(first.depSec < now && now < last.arrSec - 600)) continue;      // 現在在跑，且離終點還有 10 分
      if (!(live > first.depSec + 300 && live < last.arrSec - 600)) continue; // 扣完誤點也還在跑
      // 地圖時間（now-ds）之後還有停靠 ≥30 秒的停站
      const dwells = s.map((st, i) => ({ i, name: st.name, arrSec: st.arrSec, depSec: st.depSec,
        total: st.depSec - st.arrSec, stop: st.stop }))
        .filter(d => d.stop !== false && d.total >= 30 && d.arrSec > live + 120 && d.arrSec < last.arrSec);
      if (!dwells.length) continue;
      out.push({ no: String(tr.train), name: tr.typeName, from: first.name, to: last.name,
        dwells: dwells.slice(0, 4), stops: s.length });
    }
    return out.slice(0, 5);
  }, { ds: DS });

  if (!cand.length) { console.log('  找不到候選車次（時段問題），中止'); await br.close(); process.exit(2); }
  const pick = cand[0];
  console.log(`  候選：${pick.no} ${pick.name} ${pick.from}→${pick.to}（${pick.stops} 站）`);

  // 重新載入，讓即時名單在「閘門開啟瞬間」就帶著誤點——easedShift 的 snap 路徑才會直接對齊，
  // 否則上升鉗制會讓誤點以 1 秒/秒 慢慢爬（位置恆不倒退的設計）。
  mockNo = pick.no;
  await boot();
  await pg.evaluate(async no => { await pollLive(); followTrainNo(no, { sys: 'tra_sched' }); }, pick.no);
  await pg.waitForFunction(() => state.followTrain && !document.getElementById('followPanel').hidden,
    null, { timeout: 15000 });
  await pg.waitForTimeout(1200);

  const dlNow = await pg.evaluate(() => liveDelaySec(state.followTrain));
  ck(dlNow > DS * 0.9, `注入誤點已套用：liveDelaySec=${(dlNow / 60).toFixed(2)} 分（目標 ${DM}）`);

  // ── 情境 A：行進中，量「面板里程 vs 繪製座標」
  const A = [];
  for (let k = 0; k < 4; k++) {
    const s = await pg.evaluate(() => window.__snap());
    if (s.P && !s.mapDwell) A.push(s);
    await pg.waitForTimeout(700);
  }
  // 自然取樣可能整段落在停靠窗內（區間車站距短、長停多），那樣 A1/A2 根本沒被執行到＝沒驗。
  // 取不到就把時鐘撥到某個跑段正中央，強制製造行進中的狀態（只往未來撥，維持 liveActive）。
  if (!A.length) {
    const ok = await pg.evaluate(async () => {
      const tr = state.followTrain, s = tr.stops;
      const mapNow = state.simSec - liveDelaySec(tr) - blockHoldSec(tr);
      for (let i = 0; i < s.length - 1; i++) {
        const run = s[i + 1].arrSec - s[i].depSec;
        if (run < 90 || s[i].depSec < mapNow + 30) continue;      // 取夠長、且還沒跑過的跑段
        const mid = s[i].depSec + run / 2;
        for (let k = 0; k < 5; k++) {
          setSimSec(mid + liveDelaySec(tr) + blockHoldSec(tr));
          await new Promise(r => setTimeout(r, 220));
          const g = trainSeg(tr, state.simSec - liveDelaySec(tr) - blockHoldSec(tr));
          if (g && !g.dwell) return true;
        }
      }
      return false;
    });
    console.log(`    自然取樣全落在停靠窗 → 撥到跑段正中央重取（${ok ? '成功' : '失敗'}）`);
    for (let k = 0; k < 4 && ok; k++) {
      const s2 = await pg.evaluate(() => window.__snap());
      if (s2.P && !s2.mapDwell) A.push(s2);
      await pg.waitForTimeout(400);
    }
  }
  ck(A.length > 0, `情境 A 取得 ${A.length} 個行進中樣本`);
  for (const s of A) {
    const holdNote = s.hold > 0 ? `（阻擋 ${s.hold.toFixed(0)}s，issue #17 契約下面板本就不含 hold）` : '';
    console.log(`    t=${s.simSec} 誤點=${(s.dl / 60).toFixed(1)}分 時速=${s.kmh.toFixed(0)} ` +
      `面板=${s.donePanel.toFixed(2)}km 幾何=${s.geoKm == null ? '—' : s.geoKm.toFixed(2)}km ` +
      `落差=${s.gapKm == null ? '—' : s.gapKm.toFixed(2)}km ${holdNote}`);
  }
  // hold 是 issue #17 刻意的非對稱（只進 trainPos），把它折算回里程當容差，不讓它變成假紅
  const holdKm = s => (s.hold || 0) / 3600 * (s.kmh || 0);
  const worst = A.length ? A.reduce((m, s) => (s.gapKm - holdKm(s)) > (m.gapKm - holdKm(m)) ? s : m) : null;
  if (worst) {
    const eff = worst.gapKm - holdKm(worst);
    ck(eff < GAP_KM, `A1 面板里程換算回的點與繪製點落差 ${eff.toFixed(3)} km < ${GAP_KM}` +
      `（扣兩次的預期落差約 ${(worst.dl / 3600 * worst.kmh).toFixed(1)} km）`);
    // 幾何投影對帳：兩路量法必須說同一件事，否則是 harness 自己壞了
    const gv = A.filter(s => s.geoErr != null && s.geoErr < 0.3);
    if (gv.length) {
      const gw = gv.reduce((m, s) => s.geoGapKm > m.geoGapKm ? s : m);
      ck(gw.geoGapKm - holdKm(gw) < GAP_KM,
        `A2 幾何投影里程 vs 面板里程落差 ${(gw.geoGapKm - holdKm(gw)).toFixed(3)} km < ${GAP_KM}`);
    } else console.log('    （幾何投影垂距過大，該路對帳略過——不影響 A1）');
    // DOM 與計算值一致：證明量的是真的面板管線，不是我自己另算一份
    const domKm = worst.dom.prog ? +String(worst.dom.prog).split('/')[0].trim() : null;
    ck(domKm != null && Math.abs(domKm - worst.donePanel) <= 1.5,
      `A3 面板 DOM「${worst.dom.prog}」與計算值 ${worst.donePanel.toFixed(1)} km 一致（量到的是真面板）`);
  }

  // ── 情境 B：把時鐘撥到「地圖上的車正停在某站」的那一刻（＝使用者影片裡壞掉的畫面）。
  // 只往未來撥：liveActive 要求 simSec 不得落後現在 120 秒以上，往回撥會把誤點校正整個關掉。
  // 撥完鐘後動畫仍在推進、誤點量也可能微調，故用「撥→回讀→再撥」收斂到停靠窗正中央，
  // 而不是拿撥鐘當下的誤點值一次算死（前置不成立會讓 B1/B2 變成假紅，見心得 34）。
  const B = await pg.evaluate(async () => {
    const tr = state.followTrain, s = tr.stops;
    const mapNow = state.simSec - liveDelaySec(tr) - blockHoldSec(tr);
    // 優先取 ≥60 秒的停靠窗：時速讀數用 ±20 秒位移差算，窗太短會探到開車後、讀出非 0 的合法值
    const ahead = s.map((st, i) => ({ i, st })).filter(x => x.st.stop !== false &&
      (x.st.depSec - x.st.arrSec) >= 30 && x.st.arrSec > mapNow + 60);
    const d = ahead.find(x => (x.st.depSec - x.st.arrSec) >= 60) || ahead[0];
    if (!d) return { err: 'no dwell ahead' };
    const total = d.st.depSec - d.st.arrSec, mid = d.st.arrSec + total / 2;
    let ok = false;
    for (let k = 0; k < 5 && !ok; k++) {
      setSimSec(mid + liveDelaySec(tr) + blockHoldSec(tr)); // 讓地圖時間落在停靠窗正中央
      await new Promise(r => setTimeout(r, 220));
      const g = trainSeg(tr, state.simSec - liveDelaySec(tr) - blockHoldSec(tr));
      ok = !!(g && g.dwell && s[g.i] === d.st);
    }
    return { targetName: d.st.name, idx: d.i, total, converged: ok,
      nextStopName: (s.slice(d.i + 1).find(x => x.stop !== false) || {}).name || null };
  });
  if (B.err) { console.log(`  情境 B 略過：${B.err}`); }
  else {
    await pg.waitForTimeout(900);
    const s = await pg.evaluate(() => window.__snap());
    console.log(`    撥到 ${B.targetName} 停靠窗中央（停 ${B.total}s）：` +
      `地圖停靠=${s.mapDwellName || '行進中'} 時速=${s.kmh.toFixed(0)} 狀態列「${s.dom.status}」下一站「${s.dom.next}」`);
    ck(s.mapDwell === true && s.mapDwellName === B.targetName,
      `B0 前置成立：地圖上的車確實停在 ${B.targetName}`);
    ck(/^⏸ 停靠 /.test(s.dom.status || '') && (s.dom.status || '').includes(B.targetName),
      `B1 狀態列為「⏸ 停靠 ${B.targetName}」而非「▶ 行進中」`);
    ck(s.dom.next === B.nextStopName,
      `B2 下一站為 ${B.nextStopName}（該站的下一站），實得「${s.dom.next}」`);
    if (B.total >= 60) ck(Math.round(s.kmh) === 0, `B3 時速讀數 0（與停靠一致），實得 ${s.kmh.toFixed(1)}`);
    else console.log(`    B3 略過：停靠窗僅 ${B.total}s，±20 秒時速探針必然探到開車後（實得 ${s.kmh.toFixed(1)} km/h）`);
    out.engines[eng] = { ...(out.engines[eng] || {}), B: s, Bplan: B };
  }


  // ── 情境 C：手機寬度下「列車」sheet 的遙測列（tcLiveNext）必須與跟隨小卡（fpNext）說同一件事。
  // 兩者同一 tick 寫入但落在不同 DOM，改動若只修好其一就會在這裡現形。
  const C = {};
  for (const w of [360, 375, 414]) {
    try {
      await pg.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : null)).catch(() => {});
      await pg.waitForTimeout(300);
      await pg.setViewportSize({ width: w, height: 780 });
    } catch (e) { console.log(`    ${w}px：無法調整視窗（${String(e.message).split('\n')[0]}），略過`); continue; }
    await pg.waitForTimeout(600);
    const r = await pg.evaluate(() => new Promise(res => {
      openTrainSheet();
      setTimeout(() => {
        const txt = id => { const e = document.getElementById(id); return e ? (e.textContent || '') : null; };
        const tr = state.followTrain, info = tr ? nextStopInfo(tr, effTLive(tr)) : null;
        res({ open: document.body.classList.contains('train-open'), fs: document.body.classList.contains('fs'),
          next: txt('fpNext'), tcNext: txt('tcLiveNext'), spd: txt('fpSpd'), tcSpd: txt('tcLiveSpd'),
          infoName: info ? info.name : null, infoMin: info ? Math.round(info.min) : null });
      }, 800);
    }));
    C[w] = r;
    if (!r.open) { console.log(`    ${w}px：「列車」sheet 未開（fs=${r.fs}），略過`); continue; }
    const expect = r.infoName == null ? '已抵達終點'
      : (r.infoMin < 1 ? `即將進站 · ${r.infoName}` : `${r.infoName} · ${r.infoMin} 分`);
    ck(r.tcNext === expect && (r.infoName == null || r.next === r.infoName),
      `C${w} 遙測列「${r.tcNext}」與小卡「${r.next}」一致（期望「${expect}」）`);
    ck(r.tcSpd === r.spd, `C${w} 時速兩處一致：小卡「${r.spd}」/ 遙測列「${r.tcSpd}」`);
  }
  try {
    await pg.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : null)).catch(() => {});
    await pg.setViewportSize({ width: 1280, height: 800 });
  } catch (e) { /* 全螢幕鎖住視窗大小，還原失敗不影響已完成的量測 */ }

  out.engines[eng] = { ...(out.engines[eng] || {}), pick, dlNow, A, C };
  ck(errs.length === 0, `無 pageerror${errs.length ? '：' + errs.slice(0, 2).join(' | ') : ''}`);
  await br.close();
}

if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out, null, 2));
console.log(`\n${fail === 0 ? '✅ 全部通過' : `❌ ${fail} 項失敗`}`);
process.exit(fail === 0 ? 0 : 1);
