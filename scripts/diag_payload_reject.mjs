#!/usr/bin/env node
// 正式站此刻的官方名冊 payload，會不會被前端「整包退掉」？被退時是哪一台、哪個欄位不合格？
//
// 為什麼要有這支：trtcOfficialRosterPayloadValid() 是 return false 不是逐台過濾——
// 一台不合格就整包不更新，頁面拿上一份快照繼續外推。實測 2026-08-17 15:35–15:37 連續 10 輪全退，
// 名冊 113 台連 148 秒一字不變，兩台車就這樣撞在一起（使用者回報的「提前跑到這邊」真來源）。
// 那個狀態在畫面上看起來完全正常，只有「名冊很久沒變」這個間接跡象。
//
// 判準用產品函式本身（在真頁面裡呼叫），不另寫一份鏡像——鏡像會漂移，漂移後還是綠的。
// 用法：node scripts/diag_payload_reject.mjs [url] [輪數] [間隔秒]
import { chromium } from 'playwright';

const URL = process.argv[2] || 'https://railisland.tw/';
const ROUNDS = Number(process.argv[3] || 1);
const GAP = Number(process.argv[4] || 30);

const b = await chromium.launch();
const p = await b.newPage();
p.on('pageerror', e => console.log('  ⚠️ pageerror:', String(e).slice(0, 160)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 90000 });

let anyReject = 0, vacuous = 0;
for (let r = 0; r < ROUNDS; r++) {
  if (r) await new Promise(s => setTimeout(s, GAP * 1000));
  const out = await p.evaluate(async () => {
    const d = await (await fetch('/api/trtc-live', { cache: 'no-store' })).json();
    const bp = d && d.boardPos;
    if (!bp) return { err: 'payload 沒有 boardPos' };
    const vehicles = Array.isArray(bp.vehicles) ? bp.vehicles : [];
    // 產品在套用前會先跑 repairRun；這裡照同一順序，否則會誤報支線車不合格
    const repaired = vehicles.map(v => typeof trtcOfficialRosterRepairRun === 'function'
      ? trtcOfficialRosterRepairRun(v) : v);
    const whole = trtcOfficialRosterPayloadValid({ ...bp, vehicles: repaired });
    const bad = [];
    if (!whole) {
      // 逐台單獨過同一支驗證器，找出不合格的那些（重複 id 這種需要成對才顯現的另外查）
      for (const v of repaired) {
        if (!trtcOfficialRosterPayloadValid({ ...bp, vehicles: [v] })) {
          bad.push({ id: v.vehicleId, line: v.line, dir: v.dir, from: v.from, to: v.to,
            dest: v.dest, run: v.run, arr: v.arrEpoch, dep: v.depEpoch });
        }
      }
      if (!bad.length) {
        const seen = new Set(), dup = [];
        for (const v of repaired) { const id = String(v && v.vehicleId || '');
          if (seen.has(id)) dup.push(id); seen.add(id); }
        bad.push({ id: '(逐台都合格)', note: dup.length ? `重複 vehicleId：${dup.join(',')}` : '成因不在單台，查 feedMode/sourceRevision' });
      }
    }
    const byLine = {};
    for (const v of vehicles) byLine[v.line] = (byLine[v.line] || 0) + 1;
    return { whole, n: vehicles.length, byLine, bad,
      feedMode: bp.feedMode, rev: bp.sourceRevision,
      hold: state.trtcOfficialRosterHold || null,
      mine: (state.trtcOfficialRoster || {}).vehicles ? state.trtcOfficialRoster.vehicles.length : null,
      mineMode: (state.trtcOfficialRoster || {}).feedMode || null };
  });
  const ts = new Date().toTimeString().slice(0, 8);
  if (out.err) { console.log(`[${ts}] ${out.err}`); continue; }
  // 🔴 分母閘門：0 台時驗證器必然回 true，那是空洞通過、零資訊（判準盲點形態 11）。
  // 收班時段會這樣，不可當成「檢查過了」。
  if (!out.n) { vacuous++; console.log(`[${ts}] ⚪ 官方 0 台（收班/無資料）——本輪無資訊，不算驗過`); continue; }
  console.log(`[${ts}] payload ${out.whole ? '✅ 通過' : '❌ 整包被退'}｜官方 ${out.n} 台 ` +
    `${JSON.stringify(out.byLine)}｜feedMode=${out.feedMode} rev=${out.rev}｜` +
    `我們名冊 ${out.mine} 台(${out.mineMode})` + (out.hold ? `｜hold=${JSON.stringify(out.hold)}` : ''));
  if (!out.whole) { anyReject++; for (const x of out.bad) console.log('    不合格：' + JSON.stringify(x)); }
}
await b.close();
const real = ROUNDS - vacuous;
if (anyReject) console.log(`\n🔴 ${anyReject}/${real} 個有車的輪次整包被退——那幾輪名冊不更新、畫面靠外推`);
else if (!real) console.log(`\n⚪ ${ROUNDS} 輪全部沒車（收班或上游無資料）——這支【沒有驗到任何東西】,不要當成通過`);
else console.log(`\n✅ ${real} 個有車的輪次皆通過(另有 ${vacuous} 輪沒車不計)`);
process.exit(anyReject ? 1 : (real ? 0 : 2));
