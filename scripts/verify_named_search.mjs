// 具名列車搜尋驗證(WebKit+Chromium):名稱→觀光列車介紹卡/可跟班次、既有站名車次不退化
import { chromium, webkit } from 'playwright';

const URL = 'http://localhost:5178/index.html';
let fail = 0;
const ck = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) fail++; };

for (const [name, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
  const br = await launcher.launch();
  const pg = await br.newPage({ viewport: { width: 375, height: 812 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(URL, { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof state !== "undefined" && state.trains && state.trains.length > 500 && state.special, null, { timeout: 30000 });
  console.log(`[${name}]`);

  const r = await pg.evaluate(() => {
    const inp = document.getElementById('trainSearch'), drop = document.getElementById('searchDrop');
    const q = s => { inp.value = s; renderSearchDrop(); return {
      named: [...drop.querySelectorAll('.named-row .nm')].map(x => x.textContent),
      trs: [...drop.querySelectorAll('.tr-row .nm')].map(x => x.textContent),
      stns: drop.querySelectorAll('.stn-row').length };
    };
    const out = {};
    out.shanlan = q('山嵐'); out.mingri = q('鳴日'); out.lanpi = q('藍皮');
    out.taipei = q('台北'); out.num = q('123');
    inp.value = '山嵐'; renderSearchDrop();
    drop.querySelector('.named-row').click();
    out.intro = { has: !!drop.querySelector('.sd-named'), story: (drop.querySelector('.sd-named p') || {}).textContent || '' };
    inp.value = '藍皮'; renderSearchDrop();
    drop.querySelector('.tr-row').click();
    out.follow = state.followId;
    const rect = drop.getBoundingClientRect();
    out.noOverflowX = document.documentElement.scrollWidth <= innerWidth;
    return out;
  });
  ck(r.shanlan.named.length === 1 && r.shanlan.named[0].includes('山嵐號'), `山嵐→觀光列車列 (${r.shanlan.named})`);
  ck(r.mingri.named.length === 1 && r.mingri.named[0].includes('鳴日號'), `鳴日→觀光列車列`);
  ck(r.lanpi.trs.length === 2, `藍皮→2 班可跟隨 (${r.lanpi.trs})`);
  ck(r.taipei.stns >= 4, `台北→站名 ${r.taipei.stns} 筆(不退化)`);
  ck(r.num.trs.length >= 1, `123→車次 ${r.num.trs.length} 筆(不退化)`);
  ck(r.intro.has && r.intro.story.includes('縱谷'), `介紹卡含 story`);
  ck(r.follow === '5898', `點藍皮列跟隨 5898 (got ${r.follow})`);
  ck(r.noOverflowX, `無橫向溢出`);
  ck(errs.length === 0, `無 pageerror (${errs.slice(0, 2).join(';')})`);
  await br.close();
}
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
