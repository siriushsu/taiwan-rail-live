// 端到端驗收:8/16 傍晚畫面上 V09–V11 這段到底還有沒有車。
// 資料判準(verify_special_ops.mjs)只證明 JSON 對;這支證明「前端真的選到例外班表、畫面真的沒車」。
// 控制組是同月的普通週日 2026-08-09——沒有控制組的話,「零台車」也可能只是我把整條線弄壞了。
// 用法:VURL=http://localhost:PORT/index.html node scripts/verify_special_ops_live.mjs
import { chromium } from 'playwright';

const URL = (process.env.VURL || 'http://localhost:5178/index.html') + '?g=north';
const BRANCH_FROM = 9;                 // V09 濱海沙崙=8 是交會點,支線自 V10=9 起
const AT = 18 * 3600;                  // 18:00,停駛時刻之後一小時
const DATES = { '2026-08-16': '煙火日', '2026-08-09': '普通週日(控制組)' };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

const browser = await chromium.launch();
const page = await (await browser.newContext({ bypassCSP: true })).newPage();
page.on('pageerror', e => console.log('  ⚠ pageerror:', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
// state 是 script 頂層 const,不在 window 上;必須用裸識別字 + try/catch
await page.waitForFunction(() => {
  try { return typeof state !== "undefined" && state.ready && (state.lines || []).length > 0; } catch (e) { return false; }
}, null, { timeout: 90000 });

const out = {};
for (const d of Object.keys(DATES)) {
  out[d] = await page.evaluate(({ d, BRANCH_FROM, AT }) => {
    const lines = state.lines.filter(l => l._sys === 'ntdlrt');
    const r = {};
    for (const ln of lines) {
      prepFreqTimes(ln, d);
      const tt = ln._tt || [];
      // 「此刻在支線上」= 該班有支線停靠、且 AT 落在它整趟的時間區間內
      let onBranch = 0, running = 0;
      for (const tr of tt) {
        const inRun = AT >= tr[1] && AT <= tr[tr.length - 1];
        if (!inRun) continue;
        running++;
        for (let i = 0; i < tr.length; i += 2) if (tr[i] >= BRANCH_FROM) { onBranch++; break; }
      }
      r[ln.id] = { set: tt.length, running, onBranch };
    }
    return r;
  }, { d, BRANCH_FROM, AT });
  console.log(`\n[${d} ${DATES[d]}] ${JSON.stringify(out[d])}`);
}

const fire = out['2026-08-16'], ctrl = out['2026-08-09'];
console.log('\n[判準]');
ok(ctrl.V && ctrl.V.onBranch > 0, `控制組:普通週日 18:00 支線上有 ${ctrl.V ? ctrl.V.onBranch : 0} 台車(判準看得到車)`);
ok(fire.V && fire.V.onBranch === 0, `煙火日 18:00 支線(V10–V11)零列車 — 實際 ${fire.V ? fire.V.onBranch : '?'} 台`);
ok(fire.V && fire.V.running === 0, `煙火日 18:00 綠山線全線零列車 — 實際 ${fire.V ? fire.V.running : '?'} 台`);
ok(fire.VB && ctrl.VB && fire.VB.running > ctrl.VB.running,
  `煙火日 18:00 藍海線車比平常多(${ctrl.VB ? ctrl.VB.running : '?'} → ${fire.VB ? fire.VB.running : '?'} 台)`);
ok(fire.V && ctrl.V && fire.V.set !== ctrl.V.set, `兩天選到不同班表(${ctrl.V ? ctrl.V.set : '?'} vs ${fire.V ? fire.V.set : '?'} 班)`);

await browser.close();
console.log(`\n${fail ? '✗' : '✓'} ${pass} 過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
