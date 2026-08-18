// 官方逐班追蹤契約:「這一輪切不出車」是缺訊,只能 hold,不准清名冊。
// 清掉的後果是下一輪整線拿到全新 id ⇒ 跟車中斷、位置整批跳,正是使用者最在意的那個病。
// 兩組同時跑、同一份正式站即時資料,只差程式碼:
//   對照 = ce9bb79(有這個 bug)   修法 = 本工作樹
// 做法:實際把某線的倒數建車 stub 成回空陣列一輪以上,再恢復,比對「車還是不是同一批」。
// 🔴 判準寫成組間比較,不是絕對值——這段時間本來就會有車進出,絕對留存率沒有意義。
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const LINE = process.argv.find(a => /^(BR|Y)$/.test(a)) || 'Y';
const PHASE = Number(process.argv.find(a => /^\d+$/.test(a)) || 75);
// 停站秒樣本數的量測掛鉤由腳本注入,不留在正式程式碼裡。兩組都注入才比得了。
const HOOK_AT = '  if (hopObs.length >= ';
const withHook = src => {
  const i = src.indexOf(HOOK_AT);
  if (i < 0) return src;
  return src.slice(0, i) + "  try { window.__hop = window.__hop || {};\n"
    + "    window.__hop[lineId] = Math.max(window.__hop[lineId] || 0, hopObs.length); } catch (e) {}\n"
    + src.slice(i);
};
const CUR = withHook(fs.readFileSync('index.html', 'utf8'));
const BASE = withHook(execFileSync('git', ['show', 'ce9bb79:index.html'], { encoding: 'utf8', maxBuffer: 1 << 28 }));

async function run(html, label) {
  const L = []; const say = t => L.push(t);
  const b = await chromium.launch(); const p = await b.newPage();
  const U = 'https://railisland.tw/';
  await p.route(u => { const x = new URL(u); return x.origin + x.pathname === new URL(U).origin + '/'; },
    r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await p.goto(U + '?g=metro&officialroster=1&census=1', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 120000 });
  // 先讓它跑一輪,拿到穩定的一批車
  await p.waitForTimeout(25000);
  const ids = () => p.evaluate(ln => ((state.trtcOfficialRoster && state.trtcOfficialRoster.vehicles) || [])
    .filter(v => String(v.line) === ln).map(v => String(v.vehicleId)), LINE);
  const A = await ids();
  // 讓這條線「這一輪切不出車」——這正是缺訊的樣子
  const stubbed = await p.evaluate(ln => {
    if (typeof trtcBrVehiclesFromBoard !== 'function') return false;
    window.__orig = trtcBrVehiclesFromBoard;
    trtcBrVehiclesFromBoard = function (id) { return id === ln ? [] : window.__orig.apply(this, arguments); };
    return true;
  }, LINE);
  if (!stubbed) { await b.close(); throw new Error(`${label} 找不到 trtcBrVehiclesFromBoard,無法製造缺訊`); }
  await p.waitForTimeout(PHASE * 1000);
  await p.evaluate(() => { trtcBrVehiclesFromBoard = window.__orig; });
  await p.waitForTimeout(PHASE * 1000);
  const B = await ids();
  const hop = await p.evaluate(() => (window.__hop && { ...window.__hop }) || null);
  await b.close();
  const inter = A.filter(x => B.includes(x)).length;
  const ratio = A.length ? inter / A.length : null;
  say(`  ${label.padEnd(16)} 缺訊前 ${String(A.length).padStart(2)} 台 → 恢復後 ${String(B.length).padStart(2)} 台`
    + `｜同一批車留存 ${inter}/${A.length}`
    + `${ratio === null ? '' : '（' + (ratio * 100).toFixed(0) + '%）'}`);
  if (hop) say(`     停站秒樣本數：${Object.entries(hop).map(([k, v]) => k + ':' + v).join('  ')}`);
  return { label, A: A.length, B: B.length, inter, ratio, hop, log: L };
}
console.log(`缺訊只 hold、不清名冊：兩組同時跑，${LINE} 線 stub 成空 ${PHASE}s 再恢復 ${PHASE}s`);
const res = await Promise.all([['對照(ce9bb79)', BASE], ['修法', CUR]].map(([l, h]) => run(h, l)));
for (const r of res) for (const s of r.log) console.log(s);
const [c, f] = res;
const fail = [];
if (c.A < 4) fail.push(`分母:對照組缺訊前只有 ${c.A} 台,樣本太少(離峰請改尖峰重跑)`);
if (f.A < 4) fail.push(`分母:修法組缺訊前只有 ${f.A} 台,樣本太少`);
if (!fail.length) {
  if (!(f.ratio > 0.5)) fail.push(`修法組留存率只有 ${(f.ratio * 100).toFixed(0)}%（應 >50%）⇒ 缺訊後仍在換 id`);
  // 🔴 突變/控制組:對照組必須真的壞,否則這支腳本沒有牙
  if (!(c.ratio < f.ratio)) fail.push(`對照組留存率 ${(c.ratio * 100).toFixed(0)}% 沒有比修法組差 ⇒ 這支測不到東西,判準無效`);
}
console.log('');
if (fail.length) { console.log('❌ 未通過：'); for (const x of fail) console.log('   - ' + x); process.exit(1); }
console.log(`✅ 缺訊後身分保住：修法 ${(f.ratio * 100).toFixed(0)}% vs 對照 ${(c.ratio * 100).toFixed(0)}%`);
