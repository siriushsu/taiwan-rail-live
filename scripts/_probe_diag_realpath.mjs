// 用「真使用者路徑」驗診斷欄:更多 → 診斷資訊,不注入 localStorage。
// 像素證據:同一塊區域「開啟後」vs「把 #diagStrip 拿掉」兩張截圖必須不同(心得 24)。
import { chromium, webkit } from 'playwright';
const URL = process.env.VURL;
let fail = 0;
const ck = (ok, m) => { console.log((ok ? '  ✓ ' : '  ✗ ') + m); if (!ok) fail++; };

for (const eng of ['chromium', 'webkit']) {
  const br = await (eng === 'webkit' ? webkit : chromium).launch();
  for (const [label, vp, opener] of [['桌面', { width: 1280, height: 800 }, '#toolsFab'],
                                     ['手機', { width: 390, height: 800 }, '#tabMore']]) {
    const pg = await br.newPage({ viewport: vp });
    await pg.route('**/api/tra-live*', r => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ at: new Date().toISOString(), srv: Date.now(), trains: [] }) }));
    // 只關首訪教學卡(z800 會攔掉所有點擊)——等同「回訪使用者」,不碰受測的診斷欄開關
    await pg.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
    await pg.goto(URL, { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 500,
      null, { timeout: 60000 });
    // 前置:一開始不該有診斷欄(否則後面「出現了」是零資訊)
    ck(await pg.locator('#diagStrip').count() === 0, `${eng} ${label}｜起始狀態沒有診斷欄`);

    // 真路徑:點開「更多」→ 找到「診斷資訊」那一列 → 點它
    const ob = pg.locator(opener);
    ck(await ob.count() === 1 && await ob.isVisible(), `${eng} ${label}｜「更多」入口 ${opener} 看得到`);
    await ob.click();
    await pg.waitForTimeout(500);
    const row = pg.locator('[data-act="diagStrip"]');
    ck(await row.count() === 1 && await row.isVisible(), `${eng} ${label}｜「診斷資訊」那一列在更多面板裡看得到`);
    await row.scrollIntoViewIfNeeded();
    await row.click();
    await pg.waitForTimeout(900);
    // 關掉更多面板才看得到底下的診斷欄
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(500);

    const g = await pg.evaluate(() => {
      const d = document.getElementById('diagStrip');
      if (!d) return { exists: false };
      const r = d.getBoundingClientRect(), cs = getComputedStyle(d);
      return { exists: true, x: Math.round(r.left), y: Math.round(r.top),
        w: Math.round(r.width), h: Math.round(r.height),
        inVp: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
        disp: cs.display, vis: cs.visibility, op: cs.opacity, z: cs.zIndex,
        txt: (d.textContent || '').trim().slice(0, 60), lines: d.childElementCount };
    });
    ck(g.exists, `${eng} ${label}｜點完之後 #diagStrip 存在`);
    if (g.exists) {
      ck(g.w > 20 && g.h > 6, `${eng} ${label}｜有實際尺寸 ${g.w}×${g.h}`);
      ck(g.inVp, `${eng} ${label}｜完全在視窗內 (x${g.x} y${g.y})`);
      ck(!!g.txt, `${eng} ${label}｜有文字內容「${g.txt}」`);
      // 像素證據:同區域「有它」vs「拿掉它」兩張圖必須不同
      const box = { x: Math.max(0, g.x - 2), y: Math.max(0, g.y - 2), width: g.w + 4, height: g.h + 4 };
      const withIt = await pg.screenshot({ clip: box });
      await pg.evaluate(() => { document.getElementById('diagStrip').style.display = 'none'; });
      await pg.waitForTimeout(250);
      const without = await pg.screenshot({ clip: box });
      await pg.evaluate(() => { document.getElementById('diagStrip').style.display = ''; });
      ck(Buffer.compare(withIt, without) !== 0, `${eng} ${label}｜像素證據:拿掉它畫面會變(真的看得見)`);

      // 跟一班車 → 位置那一行要出現
      const followed = await pg.evaluate(async () => {
        const t = state.simSec;
        const tr = (state.trains || []).find(x => x.sys === 'tra_sched' && !x.loop && x.stops &&
          x.stops.length >= 5 && trainSeg(x, t) && !trainSeg(x, t).dwell);
        if (!tr) return null;
        setFollow(tr, false, true);
        await new Promise(r => setTimeout(r, 1500));
        const d = document.getElementById('diagStrip');
        return { n: d.childElementCount, first: (d.children[0].textContent || '').trim(),
          firstShown: getComputedStyle(d.children[0]).display !== 'none', h: Math.round(d.getBoundingClientRect().height) };
      });
      if (!followed) { console.log(`     ↳ ${eng} ${label}：此刻沒有在跑的台鐵班次,略過位置行`); }
      else {
        ck(followed.firstShown && /^pos /.test(followed.first),
          `${eng} ${label}｜跟車後出現位置行「${followed.first.slice(0, 56)}」`);
        console.log(`     ↳ 兩行後高度 ${followed.h}px`);
      }
    }
    await pg.close();
  }
  await br.close();
}
console.log(fail ? `FAIL ${fail}` : 'ALL PASS');
process.exit(fail ? 1 : 0);
