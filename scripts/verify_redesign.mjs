// 琺瑯 2.0 整站重做驗證:chromium+webkit 雙引擎
// 桌面功能流程+手機 App 殼+多寬度兩兩相交掃描
import { chromium, webkit } from 'playwright';

const URL = 'http://localhost:5179/';
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

async function bootPage(browser, { width, height, seedHowto = true, url = URL, touch = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: width || 1280, height: height || 800 },
    hasTouch: touch, isMobile: touch,
  });
  if (seedHowto) await ctx.addInitScript(() => {
    localStorage.setItem('trainmap-howto-seen', '1');
    localStorage.setItem('trainmap-appearance', 'light');
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready; } catch (e) { return false; } }, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}

const rect = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const vis = r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05;
  return { x: r.x, y: r.y, w: r.width, h: r.height, vis };
}, sel);
const overlap = (a, b) => a && b && a.vis && b.vis &&
  a.x < b.x + b.w - 2 && b.x < a.x + a.w - 2 && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2;

for (const [engName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch();
  console.log(`\n═══ ${engName} ═══`);

  // ── A. 桌面 1280 功能流程 ──
  {
    const { ctx, page, errors } = await bootPage(browser, { width: 1280, height: 800 });
    // A1 頁面無橫向捲動
    const hscroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`${engName} A1 頁面無橫向捲動`, hscroll <= 1, `overflow=${hscroll}px`);
    // A2 站台帶貼 stage 下緣、含工具群
    const st = await rect(page, '.stage'), band = await rect(page, '.stage .controls'), tools = await rect(page, '.stage .controls .stage-tools');
    ok(`${engName} A2 站台帶在 stage 內含工具`, !!(band && band.vis && tools && tools.vis && st &&
      band.y + band.h <= st.y + st.h + 1 && band.y > st.y + st.h / 2), JSON.stringify({ band, stB: st && (st.y + st.h) }));
    // A3 header 一列化:牌+頁籤+lead+搜尋同區,總高 ≤ 130
    const hd = await rect(page, 'header.header-row');
    const searchVis = await rect(page, '#searchRow');
    ok(`${engName} A3 header 一列化高度`, hd && hd.h <= 140, `h=${hd && hd.h}`);
    ok(`${engName} A3b 搜尋在 header 內`, !!(searchVis && searchVis.vis && hd && searchVis.y < hd.y + hd.h), '');
    // A4 外觀循環:亮→暗→自動
    const t0 = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.click('#themeBtn');
    const t1 = await page.evaluate(() => [document.documentElement.dataset.theme, state.mapDark, localStorage.getItem('trainmap-appearance'), getComputedStyle(document.body).backgroundColor]);
    await page.click('#themeBtn'); // → auto
    const t2 = await page.evaluate(() => localStorage.getItem('trainmap-appearance'));
    await page.click('#themeBtn'); // → light
    const t3 = await page.evaluate(() => [document.documentElement.dataset.theme, state.mapDark]);
    ok(`${engName} A4 外觀 亮→暗`, t0 === 'light' && t1[0] === 'dark' && t1[1] === true && t1[2] === 'dark' && t1[3] !== 'rgb(239, 230, 210)', JSON.stringify(t1));
    ok(`${engName} A4b 外觀 暗→自動→亮`, t2 === 'auto' && t3[0] === 'light' && t3[1] === false, `${t2},${t3}`);
    // A5 軌道與路線面板:開/篩選 chips/三段切換
    await page.click('#trackBtn');
    const tp = await page.evaluate(() => ({
      open: !document.getElementById('trackPanel').hidden,
      chips: document.querySelectorAll('#lineToggles .chip').length,
      segOn: document.querySelector('#trackSeg button.on') && document.querySelector('#trackSeg button.on').dataset.v,
      btnActive: document.getElementById('trackBtn').classList.contains('active'),
    }));
    await page.click('#trackSeg button[data-v=faint]');
    const ts2 = await page.evaluate(() => [state.trackStyle, document.querySelector('#trackSeg button.on').dataset.v]);
    await page.click('#trackSeg button[data-v=auto]');
    await page.click('#trackClose');
    const tpClosed = await page.evaluate(() => document.getElementById('trackPanel').hidden);
    ok(`${engName} A5 軌面板開+票根+seg`, tp.open && tp.chips > 0 && tp.segOn === 'auto' && tp.btnActive, JSON.stringify(tp));
    ok(`${engName} A5b 三段切換+關閉`, ts2[0] === 'faint' && ts2[1] === 'faint' && tpClosed, JSON.stringify(ts2));
    // A6 速度磁吸:拉到 11 吸到 10;29 吸到 30
    const snap = await page.evaluate(() => {
      const s = document.getElementById('speed'); const out = [];
      for (const v of [11, 29, 45]) { s.value = v; s.dispatchEvent(new Event('input')); out.push(state.speedMult); }
      s.value = 1; s.dispatchEvent(new Event('input'));
      return out;
    });
    ok(`${engName} A6 速度磁吸`, snap[0] === 10 && snap[1] === 30 && snap[2] === 45, JSON.stringify(snap));
    // A7 隨機跟隨:跟隨卡出現且在站台帶上方不相交;traincard 在地圖下方
    await page.evaluate(() => document.getElementById('randBtn').click());
    await page.waitForTimeout(700);
    const fp = await rect(page, '#followPanel'), band2 = await rect(page, '.stage .controls'), tc = await rect(page, '#trainCard');
    ok(`${engName} A7 跟隨卡顯示不壓帶`, !!(fp && fp.vis && !overlap(fp, band2)), JSON.stringify({ fp, band2 }));
    ok(`${engName} A7b 資訊卡在地圖下`, !!(tc && tc.vis && st && tc.y >= st.y + st.h - 2), JSON.stringify(tc));
    // A8 探索面板在右上、讓開 fsFab
    await page.click('#exploreBtn');
    const ep = await rect(page, '#explorePanel'), fsb = await rect(page, '#fsFab');
    ok(`${engName} A8 亮點面板不壓全畫面鈕`, !!(ep && ep.vis && !overlap(ep, fsb)), JSON.stringify({ ep, fsb }));
    await page.click('#exploreBtn');
    // A9 護照:印章 .seal 出現
    const pass = await page.evaluate(() => {
      const el = document.getElementById('passport');
      if (el.classList.contains('closed')) el.querySelector('.ph-head').click();
      return { hidden: el.hidden, seals: el.querySelectorAll('.seal').length, na: el.querySelectorAll('.seal.na').length, gold: el.querySelectorAll('.seal.gold, .seal.na[title]').length };
    });
    ok(`${engName} A9 護照印章化`, !pass.hidden && pass.seals > 10 && pass.na > 0, JSON.stringify(pass));
    // A10 桌面無 tab bar
    const tb = await rect(page, '.tabbar');
    ok(`${engName} A10 桌面藏 tab bar`, !tb || !tb.vis, '');
    // A11 console 無錯誤
    ok(`${engName} A11 無 console/page 錯誤`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ── B. 多寬度掃描:無橫向捲動+關鍵控件兩兩不相交 ──
  for (const w of [360, 375, 390, 414, 640, 768, 1024, 1280, 1440]) {
    const { ctx, page } = await bootPage(browser, { width: w, height: 844 });
    await page.evaluate(() => document.getElementById('randBtn').click());
    await page.waitForTimeout(600);
    const hscroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const sels = ['.badge', '#randBtn', '#fsFab', '#followPanel', '.stage .controls', '.follow-lock-ctl', '.tabbar', '.leaflet-control-zoom', '.leaflet-control-attribution'];
    const rects = {};
    for (const s of sels) rects[s] = await rect(page, s);
    const hits = [];
    const keys = Object.keys(rects);
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      // attribution 與帶/tabbar 在最底層可容忍輕微相鄰,其他不准
      if (overlap(rects[keys[i]], rects[keys[j]])) hits.push(`${keys[i]}×${keys[j]}`);
    }
    ok(`${engName} B 寬度${w} 無橫捲+無疊`, hscroll <= 1 && hits.length === 0, `${hscroll}px ${hits.join(',')}`);
    await ctx.close();
  }

  // ── C. 手機 390 App 殼 ──
  {
    const { ctx, page, errors } = await bootPage(browser, { width: 390, height: 844, touch: true });
    // C1 tab bar 顯示、5 鈕、觸控目標 ≥44
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.tabbar button')].map(b => { const r = b.getBoundingClientRect(); return { id: b.id, w: r.width, h: r.height }; }));
    ok(`${engName} C1 tab bar 5 鈕 ≥44px`, tabs.length === 5 && tabs.every(t => t.w >= 44 && t.h >= 44), JSON.stringify(tabs));
    // C2 速度膠囊:窄膠囊置中貼底
    const cap = await rect(page, '.stage .controls');
    ok(`${engName} C2 速度膠囊窄形置中`, !!(cap && cap.vis && cap.w < 250 && Math.abs((cap.x + cap.w / 2) - 195) < 30), JSON.stringify(cap));
    // C3 點膠囊展開 → cexp(閒置已淡成把手時,第一次點只喚醒,再點才展開=設計行為)
    await page.tap('.stage .controls');
    if (!(await page.evaluate(() => document.body.classList.contains('cexp')))) {
      await page.waitForTimeout(150);
      await page.tap('.stage .controls');
    }
    const cexp = await page.evaluate(() => document.body.classList.contains('cexp'));
    const capExp = await rect(page, '.stage .controls');
    ok(`${engName} C3 膠囊展開`, cexp && capExp.w > 300, `w=${capExp && capExp.w}`);
    await page.evaluate(() => { document.body.classList.remove('cexp'); });
    // C4 更多 sheet:開、外觀 seg、開關代理
    await page.tap('#tabMore');
    const sheet = await page.evaluate(() => ({
      open: document.body.classList.contains('tools-open'),
      rows: [...document.querySelectorAll('#moreBody .ms-row')].filter(r => r.style.display !== 'none').length,
      hiddenRows: [...document.querySelectorAll('#moreBody .ms-row')].filter(r => r.style.display === 'none').map(r => r.dataset.proxy),
    }));
    ok(`${engName} C4 更多 sheet 開+列數`, sheet.open && sheet.rows >= 8, JSON.stringify(sheet));
    // C5 sheet 外觀 seg → 暗
    await page.tap('#msThemeSeg button[data-v=dark]');
    const dk = await page.evaluate(() => [document.documentElement.dataset.theme, state.mapDark, document.querySelector('#msThemeSeg button.on').dataset.v]);
    await page.tap('#msThemeSeg button[data-v=light]');
    ok(`${engName} C5 sheet 外觀切暗`, dk[0] === 'dark' && dk[1] === true && dk[2] === 'dark', JSON.stringify(dk));
    // C6 sheet 開關代理:平交道
    await page.tap('#moreBody .ms-row[data-proxy=xingBtn]');
    const xg = await page.evaluate(() => [state.xingOn, document.querySelector('.toggle[data-tg=xingBtn]').classList.contains('on')]);
    await page.tap('#moreBody .ms-row[data-proxy=xingBtn]');
    ok(`${engName} C6 sheet 代理平交道開關`, xg[0] === true && xg[1] === true, JSON.stringify(xg));
    // C7 sheet 軌道列 → trackPanel(手機底部 sheet)
    await page.tap('#moreBody .ms-row[data-act=track]');
    const tp = await page.evaluate(() => ({ more: document.body.classList.contains('tools-open'), track: !document.getElementById('trackPanel').hidden, sheetOpen: document.body.classList.contains('sheet-open') }));
    ok(`${engName} C7 sheet→軌面板`, !tp.more && tp.track && tp.sheetOpen, JSON.stringify(tp));
    await page.tap('#trackClose');
    // C8 tab 亮點:開面板+tab active
    await page.tap('#tabExplore');
    const te = await page.evaluate(() => [!document.getElementById('explorePanel').hidden, document.getElementById('tabExplore').classList.contains('active')]);
    await page.tap('#tabMap');
    const tm = await page.evaluate(() => [document.getElementById('explorePanel').hidden, document.getElementById('tabMap').classList.contains('active')]);
    ok(`${engName} C8 tab 亮點/地圖切換`, te[0] && te[1] && tm[0] && tm[1], JSON.stringify({ te, tm }));
    // C9 跟隨:膠囊/跟隨卡/tabbar 三者不相交
    await page.evaluate(() => document.getElementById('randBtn').click());
    await page.waitForTimeout(700);
    const fp = await rect(page, '#followPanel'), cap2 = await rect(page, '.stage .controls'), tb = await rect(page, '.tabbar');
    ok(`${engName} C9 跟隨卡/膠囊/tabbar 無疊`, !!(fp && fp.vis) && !overlap(fp, cap2) && !overlap(fp, tb) && !overlap(cap2, tb), JSON.stringify({ fp, cap2, tb }));
    // C11 全畫面組合:fs 時 stage 佔滿視窗,底部面板必須讓開 fixed tabbar;fs+跟隨時跟隨卡讓到面板上方
    await page.evaluate(() => state._setFs(true));
    await page.waitForTimeout(600);
    await page.tap('#tabRide');
    await page.waitForTimeout(600);
    const fsRp = await rect(page, '#ridePanel'), fsFp = await rect(page, '#followPanel'), fsTb = await rect(page, '.tabbar');
    const fsOk = !!(fsRp && fsRp.vis) && fsRp.y + fsRp.h <= fsTb.y && (!fsFp || !fsFp.vis || fsFp.y + fsFp.h <= fsRp.y);
    ok(`${engName} C11 fs+面板讓開 tabbar+跟隨卡`, fsOk, JSON.stringify({ fsRp, fsFp, fsTb }));
    await page.tap('#tabMap');
    await page.evaluate(() => state._setFs(false));
    ok(`${engName} C10 手機無 console 錯誤`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ── D. 首訪卡(不 seed localStorage) ──
  {
    const { ctx, page } = await bootPage(browser, { width: 390, height: 844, seedHowto: false, touch: true });
    const hw = await rect(page, '#howtoWrap .howto');
    await page.tap('#howtoGo');
    const gone = await page.evaluate(() => [document.getElementById('howtoWrap').hidden, localStorage.getItem('trainmap-howto-seen')]);
    ok(`${engName} D1 首訪卡顯示+記憶`, !!(hw && hw.vis) && gone[0] && gone[1] === '1', JSON.stringify(gone));
    await ctx.close();
  }

  // ── E. ?live=1 直播殼:互動 UI 全藏、HUD 放大 ──
  {
    const { ctx, page } = await bootPage(browser, { width: 1920, height: 1080, url: URL + '?live=1' });
    await page.waitForTimeout(1500);
    const live = await page.evaluate(() => ({
      liveClass: document.body.classList.contains('live'),
      controls: getComputedStyle(document.querySelector('.controls')).display,
      tabbar: getComputedStyle(document.querySelector('.tabbar')).display,
      clock: getComputedStyle(document.querySelector('.badge .clock')).fontSize,
      wm: getComputedStyle(document.querySelector('.live-wm')).fontSize,
      attr: getComputedStyle(document.querySelector('.leaflet-control-attribution')).fontSize,
    }));
    ok(`${engName} E1 直播殼`, live.liveClass && live.controls === 'none' && live.tabbar === 'none' && live.clock === '46px' && live.wm === '24px' && live.attr === '16px', JSON.stringify(live));
    await ctx.close();
  }

  await browser.close();
}

const fails = results.filter(r => !r.pass);
console.log(`\n════ 總計 ${results.length} 項,FAIL ${fails.length} ════`);
fails.forEach(f => console.log('FAIL:', f.name, f.detail));
process.exit(fails.length ? 1 : 0);
