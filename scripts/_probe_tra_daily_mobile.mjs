// 停駛列的手機幾何檢查：360/375/414/768 × chromium+webkit。
// 停駛列是新的常駐 UI(看板內),依專案鐵則所有 UI 改動都要過這一關。
// 判準用命中測試而不是 computed style(心得 24):停駛列不是 pointer-events:none,
// 中心點 elementFromPoint 打得到自己＝它真的在畫面上而且沒被蓋住。
import { chromium, webkit } from 'playwright';
const VURL = process.env.VURL;
const WIDTHS = [360, 375, 414, 768];
const TODAY = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Taipei' });
let fail = 0;
const ck = (ok, m) => { console.log((ok ? '  ✓ ' : '  ✗ ') + m); if (!ok) fail++; };

for (const eng of (process.env.ENGINES || 'chromium,webkit').split(',')) {
  const br = await (eng === 'webkit' ? webkit : chromium).launch();
  for (const w of WIDTHS) {
    const pg = await br.newPage({ viewport: { width: w, height: 780 } });
    await pg.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
    await pg.route('**/api/tra-live*', r => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ at: new Date().toISOString(), srv: Date.now(), trains: [] }) }));
    // 先放行,拿到名冊之後才知道要停駛哪幾班 → 用兩段式:第一次載入拿名冊,第二次帶停駛名單
    let payload = null;
    await pg.route('**/api/tra-daily-trains*', r => payload == null
      ? r.fulfill({ status: 502, contentType: 'application/json', body: '{}' })
      : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }));
    await pg.goto(VURL, { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 500,
      null, { timeout: 60000 });
    const info = await pg.evaluate(() => {
      const tra = state.trains.filter(t => t.sys === 'tra_sched');
      const nos = [...new Set(tra.filter(t => t.stops && !t.stops._prevNight && !t.loop).map(t => String(t.train)))];
      const now = state.simSec;
      for (const tr of tra) {
        if (tr.loop || !tr.stops) continue;
        for (let i = 0; i < tr.stops.length - 1; i++) {
          const s = tr.stops[i];
          if (s.stop === false) continue;
          const d = s.depSec - now;
          if (d > 900 && d < 2 * 3600) return { nos, train: String(tr.train), station: s.name };
        }
      }
      return { nos, train: null, station: null };
    });
    payload = { date: TODAY, updateTime: 'x', trains: info.nos.filter(n => n !== info.train), count: info.nos.length - 1 };
    await pg.reload({ waitUntil: 'load' });
    await pg.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 500,
      null, { timeout: 60000 });
    const r = await pg.evaluate((nm) => {
      const st = (state.schedStations || []).find(s => s.name === nm && s.sys === 'tra_sched');
      state.simSec = Math.round(nowSecOfDay()) + 60; state.clockAtNow = false;
      state.boardStation = st; renderBoard();
      const el = document.getElementById('board');
      const row = el.querySelector('.row.off');
      if (!row) return { has: false, cancelled: (state.traCancelled || []).length };
      const q = row.getBoundingClientRect(), b = el.getBoundingClientRect();
      const hitEl = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      const min = row.querySelector('.min'), mq = min.getBoundingClientRect();
      return { has: true,
        inBoard: q.left >= b.left - 1 && q.right <= b.right + 1,
        inVp: q.top >= 0 && q.bottom <= innerHeight && q.left >= 0 && q.right <= innerWidth,
        hit: !!(hitEl && (hitEl === row || row.contains(hitEl))),
        boardOverflow: Math.round(el.scrollWidth - el.clientWidth),
        docOverflow: Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
        minTxt: min.textContent, minW: Math.round(mq.width), rowH: Math.round(q.height),
        cursor: getComputedStyle(row).cursor };
    }, info.station);
    ck(r.has, `${eng} ${w}px 看板出現停駛列（停駛 ${r.cancelled ?? '?'} 班）`);
    if (r.has) {
      ck(r.inBoard, `${eng} ${w}px 停駛列沒有超出看板左右緣`);
      ck(r.inVp, `${eng} ${w}px 停駛列完全在視窗內`);
      ck(r.hit, `${eng} ${w}px 停駛列中心點命中自己（沒被蓋住）`);
      ck(r.boardOverflow <= 0 && r.docOverflow <= 0,
        `${eng} ${w}px 無橫向溢出（看板 ${r.boardOverflow}／頁面 ${r.docOverflow}）`);
      ck(r.minTxt === '停駛' && r.cursor !== 'pointer',
        `${eng} ${w}px 右欄字面「${r.minTxt}」、cursor=${r.cursor}（不可點）`);
      console.log(`     ↳ 停駛徽章寬 ${r.minW}px、列高 ${r.rowH}px`);
    }
    await pg.close();
  }
  await br.close();
}
console.log(fail ? `FAIL ${fail}` : 'ALL PASS');
process.exit(fail ? 1 : 0);
