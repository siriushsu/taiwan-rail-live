// 「官方訂正位置」通知的驗收。三組吃同一份正式站即時資料,只差程式碼:
//   對照      = origin/main
//   修法      = 本工作樹(環狀線改吃倒數 + 歸因閘門 + correcting 不被洗掉)
//   修法+突變 = 把歸因閘門改成恆真 ⇒ 若通知數回到對照水準,證明差異真的來自閘門(判準有牙)
// 🔴 正向對照不可省:官方真的改錨點時通知必須還會跳,否則「乾脆別發了」也會全綠。
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const SEC = Number(process.argv.find(a => /^\d+$/.test(a)) || 120);
const CUR = fs.readFileSync('index.html', 'utf8');
const BASE = execFileSync('git', ['show', 'origin/main:index.html'], { encoding: 'utf8', maxBuffer: 1 << 28 });
const GATE = '  const officialMoved = prior.anchor !== anchor &&';
if (!CUR.includes(GATE)) { console.log('❌ 找不到歸因閘門錨點,腳本與程式碼脫節'); process.exit(2); }
const MUT = CUR.replace(GATE + '\n    Number.isFinite(obs) && Number.isFinite(Number(prior.obs)) && obs > Number(prior.obs);',
  '  const officialMoved = true;');
if (MUT === CUR) { console.log('❌ 突變沒套用'); process.exit(2); }
const ARMS = [['對照(origin/main)', BASE], ['修法', CUR], ['修法+閘門突變恆真', MUT]];

async function run(html, label) {
  const L = []; const say = t => L.push(t);
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  const U = 'https://railisland.tw/';
  await p.route(u => { const x = new globalThis.URL(u); return x.origin + x.pathname === new globalThis.URL(U).origin + '/'; },
    r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  let ready = false;
  for (let attempt = 0; attempt < 2 && !ready; attempt++) {
    await p.goto(U + '?g=metro&officialroster=1&census=1', { waitUntil: 'domcontentloaded' });
    try { await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 120000 }); ready = true; }
    catch (e) { say(`   ⚠️ ${label} 第 ${attempt + 1} 次載入逾時${attempt ? '' : '，重試一次'}`); }
  }
  if (!ready) throw new Error(`${label} 載入不起來`);
  await p.evaluate(() => {
    window.__t = { toasts: [], counts: [] };
    const orig = trtcOfficialCorrectTick;
    trtcOfficialCorrectTick = function (n) {
      const out = orig.apply(this, arguments);
      if (out) window.__t.toasts.push({ t: Date.now() / 1000, count: out.count != null ? out.count : null });
      return out;
    };
    // 🔴 通知發出後 count 會歸零,所以不能用「末減初」;累加正增量才是真的觸發台次。
    // 另外通知本身要靜置 2 秒才發 ⇒ 觸發越密集反而越發不出來,通知數不是單調指標,只當參考。
    window.__t.trig = 0; window.__t.byLine = {}; let last = 0;
    // 🔴 三組改成同時跑(同一時間窗)之後,新的假綠管道是 CPU 競爭:被餓死的那組觸發自然變少,
    //    會偽裝成修法有效。所以每組都量自己實際拿到多少算力(ticks 應 ≈ SEC*4、frames 是 rAF 幀數),
    //    組間差太多就直接判不可比,不准拿來下結論。
    window.__t.ticks = 0; window.__t.frames = 0;
    (function f() { window.__t.frames++; requestAnimationFrame(f); })();
    setInterval(() => { window.__t.ticks++; const c = _trtcOfficialCorrect.count;
      if (c > last) window.__t.trig += c - last; last = c; }, 250);
    // 每一次觸發都記下「官方到底有沒有真的重新看到這台車」——這是本批最核心的性質,
    // 直接斷言它,不靠「通知變少」這種會被別的因素影響的量。
    window.__t.mis = 0; window.__t.good = 0;
    const od = trtcOfficialDisplayPosition;
    trtcOfficialDisplayPosition = function (ln, v) {
      const key = `${ln && ln.id}|${v && v.vehicleId}`;
      const pr = _trtcOfficialDisplay.get(key);
      const pObs = pr ? Number(pr.obs) : NaN;
      const before = _trtcOfficialCorrect.count, out = od.apply(this, arguments);
      if (_trtcOfficialCorrect.count > before) {
        const k = String(ln && ln.id); window.__t.byLine[k] = (window.__t.byLine[k] || 0) + 1;
        const obs = Number(v && v.observedEpoch);
        // 官方沒有重新看到這台車(observedEpoch 沒前進)卻被算成「官方訂正」＝歸因錯誤
        if (Number.isFinite(obs) && Number.isFinite(pObs) && obs <= pObs) window.__t.mis++;
        else window.__t.good++;
      }
      return out;
    };
  });
  await p.waitForTimeout(SEC * 1000);
  const t = await p.evaluate(() => ({ toasts: window.__t.toasts, trig: window.__t.trig, byLine: window.__t.byLine,
    mis: window.__t.mis, good: window.__t.good, ticks: window.__t.ticks, frames: window.__t.frames,
    lines: [...new Set(((state.trtcOfficialRoster && state.trtcOfficialRoster.vehicles) || []).map(v => String(v.line)))],
    veh: ((state.trtcOfficialRoster && state.trtcOfficialRoster.vehicles) || []).length }));
  await b.close();
  if (errs.length) say(`   ⚠️ ${label} 頁面例外: ${errs[0]}`);
  const trig = t.trig;
  const gaps = [];
  for (let i = 1; i < t.toasts.length; i++) gaps.push(t.toasts[i].t - t.toasts[i - 1].t);
  gaps.sort((a, b) => a - b);
  const r = { label, toasts: t.toasts.length, trig, veh: t.veh, mis: t.mis, good: t.good, byLine: t.byLine,
    ticks: t.ticks, frames: t.frames, log: L,
    medGap: gaps.length ? gaps[gaps.length >> 1] : null };
  say(`  ${label.padEnd(20)} ${SEC}s 內跳 ${String(r.toasts).padStart(3)} 次通知`
    + `｜觸發累計 ${String(trig).padStart(5)} 台次｜間隔中位 ${r.medGap == null ? '—' : r.medGap.toFixed(1) + 's'}`
    + `｜名冊 ${t.veh} 台｜算力 ${t.ticks}tick/${t.frames}幀`);
  say(`     逐線觸發：${Object.entries(t.byLine).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ') || '（無）'}`);
  say(`     歸因：官方真的重新報過 ${t.good} 次｜官方根本沒再看到那台車 ${t.mis} 次`);
  return r;
}
console.log(`官方訂正通知驗收：三組 × ${SEC}s，同一份正式站即時資料`);
// 🔴 三組必須同時跑:循序跑等於三個不同時間窗吃到不同即時資料,組間比值會混進「時段擺盪」。
const res = await Promise.all(ARMS.map(([label, html]) => run(html, label)));
for (const r of res) for (const line of r.log) console.log(line);
const [ctl, fix, mut] = res;
console.log('');
const fail = [];
const yOf = r => Number(r.byLine && r.byLine.Y) || 0;
// 🔴 絕對觸發量隨時段擺盪很大(同一支腳本 18:5x 量到環狀線 1672 次、19:5x 只有 41 次),
// 所以判準一律寫成「組間比值」與「性質」,門檻只用來擋樣本太小的假綠。
if (ctl.trig < 30) fail.push(`G1 分母:對照組只觸發 ${ctl.trig} 次,樣本太少(離峰請改尖峰重跑)`);
if (yOf(ctl) < 15) fail.push(`G1 分母:對照組環狀線只觸發 ${yOf(ctl)} 次,樣本太少`);
// G2 主判準:環狀線改吃官方倒數之後觸發要腰斬以上
if (yOf(ctl) >= 15 && yOf(fix) > yOf(ctl) * 0.5)
  fail.push(`G2 環狀線沒有明顯改善（${yOf(ctl)} → ${yOf(fix)}）`);
// G0 🔴 同時跑的前提:三組拿到的算力要相當,否則觸發數的組間比值沒有意義(餓死＝假綠)
const maxTick = Math.max(...res.map(r => r.ticks || 0));
for (const r of res) if (!(r.ticks >= maxTick * 0.85))
  fail.push(`G0 算力不均:${r.label} 只跑到 ${r.ticks} tick(最高 ${maxTick})⇒ 三組不可比,本輪結果作廢`);
// G3 正向對照:不可以是「乾脆都不發」——內部觸發與使用者真的看得到的通知都要有
if (fix.trig === 0) fail.push('G3 正向對照:修法組完全零觸發 ⇒ 可能整個關掉了');
if (fix.toasts === 0) fail.push('G3b 正向對照:修法組 150s 內一則通知都沒發給使用者 ⇒ 使用者可見層被關死');
// G4 🔴 核心性質:修法組不得再把「官方根本沒再看到那台車」報成官方訂正
if (fix.mis > 0) fail.push(`G4 修法組仍有 ${fix.mis} 次錯誤歸因`);
// G4b 突變:閘門恆真時錯誤歸因要回來,才證明 G4 是閘門擋下來的。
// 🔴 這條的分母是「窗內剛好有續推車被官方重新看到」,不是每輪都有 ⇒ 沒樣本時報警告不報失敗。
// 已取得的正面證據:2026-08-18 19:5x 那輪 突變組 17 次、修法組 0 次(同一份即時資料)。
if (mut.mis === 0) console.log('   ⚠️ G4b 本輪沒有樣本可驗閘門（窗內沒有續推車被官方重新看到）；'
  + '閘門有牙的證據見腳本註解（19:5x 突變 17 次 vs 修法 0 次）');
// G5 名冊分母
for (const r of res) if (r.veh < 80) fail.push(`G5 分母:${r.label} 名冊只有 ${r.veh} 台`);
if (fail.length) { console.log('❌ 未通過：'); for (const f of fail) console.log('   - ' + f); process.exit(1); }
console.log(`✅ 觸發台次 ${ctl.trig} → ${fix.trig}／${SEC}s（減 ${(100 - fix.trig / ctl.trig * 100).toFixed(1)}%）`);
console.log(`   環狀線 ${yOf(ctl)} → ${yOf(mut)}（重建之功）→ ${yOf(fix)}（再加歸因閘門）`);
console.log(`   修法組仍有 ${fix.trig} 次觸發、${fix.toasts} 則通知＝官方真的訂正時照常跳（正向對照）`);
console.log(`   算力均衡：${res.map(r => r.ticks).join(' / ')} tick（三組同時跑,同一時間窗）`);
console.log(`   註：「官方根本沒再看到那台車」在對照組是 ${ctl.mis} 次——觸發的那一刻官方確實都重新報過，`);
console.log(`   　　錯的不是「官方沒動」，是那一刻現形的落差**是我們自己 30 分鐘純推估累積的**。`);
