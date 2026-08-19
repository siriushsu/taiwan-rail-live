// 診斷欄兩行化的手機幾何檢查：360/375/414/768 ＋ WebKit。
// 問三件事：(1) 有沒有把頁面撐出橫向捲動 (2) tab bar 的鈕還點不點得到（pointer-events:none 要真的成立）
// (3) 蓋掉 tab bar 多少高度（給人裁示用的事實，不是判準）
import { chromium, webkit } from 'playwright';
const URL = process.env.VURL;
const WIDTHS = [360, 375, 414, 768];
let fail = 0;
const ck = (ok, m) => { console.log((ok ? '  ✓ ' : '  ✗ ') + m); if (!ok) fail++; };

for (const eng of (process.env.ENGINES || 'chromium,webkit').split(',')) {
  const br = await (eng === 'webkit' ? webkit : chromium).launch();
  for (const w of WIDTHS) {
    const pg = await br.newPage({ viewport: { width: w, height: 780 } });
    await pg.route('**/api/tra-live*', r => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ at: new Date().toISOString(), srv: Date.now(), trains: [] }) }));
    await pg.addInitScript(() => { try { localStorage.setItem('trainmap-diagstrip', '1'); } catch (e) {} });
    await pg.goto(URL, { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 500,
      null, { timeout: 60000 });
    const r = await pg.evaluate(async () => {
      const t = state.simSec;
      const tr = (state.trains || []).find(x => x.sys === 'tra_sched' && !x.loop && x.stops &&
        x.stops.length >= 5 && trainSeg(x, t) && !trainSeg(x, t).dwell);
      if (tr) setFollow(tr, false, true);
      await new Promise(r => setTimeout(r, 1400));
      const d = document.getElementById('diagStrip');
      const dr = d.getBoundingClientRect();
      const tb = document.querySelector('.tabbar');
      const tbr = tb ? tb.getBoundingClientRect() : null;
      const btns = tb ? [...tb.querySelectorAll('button')] : [];
      // 每顆 tab 鈕的中心點做命中測試：命中自己或自己的子孫才算點得到
      const hits = btns.map(b => {
        const q = b.getBoundingClientRect();
        const el = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
        return !!(el && (el === b || b.contains(el)));
      });
      return {
        lines: d.childElementCount, followed: !!tr,
        stripRight: Math.round(dr.right), stripTop: Math.round(dr.top), stripH: Math.round(dr.height),
        docOverflow: Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
        tabTop: tbr ? Math.round(tbr.top) : null, tabH: tbr ? Math.round(tbr.height) : null,
        cover: tbr ? Math.max(0, Math.round(tbr.bottom - dr.top)) : 0,
        btnAll: hits.length, btnOk: hits.filter(Boolean).length,
      };
    });
    ck(r.docOverflow <= 0, `${eng} ${w}px 無橫向溢出（scrollWidth−clientWidth=${r.docOverflow}）`);
    ck(r.stripRight <= w, `${eng} ${w}px 診斷欄不出視窗右緣（right=${r.stripRight}）`);
    ck(r.btnAll === 0 || r.btnOk === r.btnAll, `${eng} ${w}px tab bar ${r.btnOk}/${r.btnAll} 顆仍點得到`);
    console.log(`     ↳ 行數=${r.lines} 跟車=${r.followed} 高=${r.stripH}px 蓋住 tab bar ${r.cover}px（tab 高 ${r.tabH}）`);
    await pg.close();
  }
  await br.close();
}
console.log(fail ? `FAIL ${fail}` : 'ALL PASS');
process.exit(fail ? 1 : 0);
