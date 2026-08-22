// 字級三階(標準/大/特大)驗收:chromium+webkit 雙引擎
//
// 用法:先起本機伺服器(預設埠 5261),再跑本檔
//   PORT=5261 node scripts/dev_server.mjs &
//   node scripts/verify_font_scale.mjs
//
// 設計來源:claude.ai/design 專案「軌島 App 版面重整」TURN 10(x1.25)/TURN 12(x1.5)——
// 「同一份版面吃倍率:字級、列高、圖示、觸控目標一起放大,欄位一個都沒收」。
//
// 這支腳本刻意分成三段,對應三種不同的失效方式:
//   A 段 幾何:字放大之後東西還在不在畫面裡(頂列四顆分頁、tab bar 標籤)
//   B 段 互動:真的用手指點那顆鈕會不會發生事(不是只看 CSS 算出什麼)
//   C 段 契約:?live=1 直播殼恆定標準字級、系統字級的正反向對照
import { chromium, webkit } from 'playwright';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 5261);
const URL_BASE = `http://127.0.0.1:${PORT}/index.html`;

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

// 🔴 第一道 gate:先證明「我驗的就是這棵樹的檔案」。驗收腳本指到別的目錄/別的 build 而全綠,
//    是這個 repo 踩過的坑(兩輪 21/21 全綠驗的都是幾個 commit 前的 worktree)。
async function assertTarget() {
  const disk = createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
  const served = createHash('md5').update(Buffer.from(await (await fetch(URL_BASE)).arrayBuffer())).digest('hex');
  ok(`T0 伺服器送出的 index.html 與這棵樹逐 byte 相同(md5 ${disk.slice(0, 8)})`, disk === served,
    disk === served ? ROOT : `disk=${disk.slice(0, 8)} served=${served.slice(0, 8)}`);
  if (disk !== served) { console.log('\n目標不符,後面全部不用看了。'); process.exit(1); }
}

async function boot(browser, { width = 393, tier = 'std', query = '' } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(t => {
    localStorage.setItem('trainmap-howto-seen', '1');                 // 首訪教學卡會蓋住地圖與頂列
    localStorage.setItem('iabHintDismiss', String(Date.now() + 1e9)); // 內嵌瀏覽器提示同理
    if (t !== 'std') localStorage.setItem('trainmap-fontscale', t);
  }, tier);
  await page.goto(URL_BASE + query, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.ready, null, { timeout: 45000 })
    .catch(() => {});
  await page.waitForTimeout(600);
  return { page, errs, close: () => ctx.close() };
}

// ── A 段:幾何——放大之後還在不在畫面裡 ────────────────────────────────────────
// 判準寫「四顆分頁的 rect 全部在視窗內」而不是「頂列高度 <= N px」:後者是會隨文案漂移的魔術數字。
async function sectionA(browser, engine) {
  for (const tier of ['std', 'large', 'xlarge']) {
    for (const width of [360, 393, 414]) {
      const { page, errs, close } = await boot(browser, { width, tier });
      // 捷運群組=最長的鄰站名(南港展覽館／頂埔),是頂列最擠的常態組合
      await page.evaluate(() => {
        document.querySelectorAll('.topbar .gtab').forEach(b => { if (b.textContent.trim() === '捷') b.click(); });
      });
      await page.waitForTimeout(900);
      const r = await page.evaluate(() => {
        const vis = e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
        const tabs = [...document.querySelectorAll('.topbar .grouptabs .gtab')].filter(vis);
        const outside = tabs.filter(t => {
          const b = t.getBoundingClientRect();
          return b.right > innerWidth + 0.5 || b.left < -0.5;
        }).map(t => t.textContent.trim());
        // 「框把自己的字切掉」與「跑出視窗」是兩種不同的壞法,要各自有判準
        const selfClipped = tabs.filter(t => t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1)
          .map(t => t.textContent.trim());
        const tl = document.querySelector('.tabbar .tl').getBoundingClientRect();
        // 上緣堆疊:頂列與時鐘徽章。判準用「rect 相交面積」而不是「徽章 top >= 某常數」——
        // 常數會隨頂列高度漂移,正是這條缺陷的成因。
        const bar = document.getElementById('topbar'), bg = document.querySelector('.badge');
        const br = bar.getBoundingClientRect(), gr = bg.getBoundingClientRect();
        const ix = Math.min(br.right, gr.right) - Math.max(br.left, gr.left);
        const iy = Math.min(br.bottom, gr.bottom) - Math.max(br.top, gr.top);
        return { n: tabs.length, outside, selfClipped, labelInside: tl.bottom <= innerHeight + 0.5,
          bothVisible: br.height > 0 && gr.height > 0,
          topStackOverlap: +(Math.max(0, ix) * Math.max(0, iy)).toFixed(0),
          badgeInlineTop: bg.style.top };
      });
      const tag = `${engine} ${tier} ${width}pt`;
      ok(`A1 ${tag} 正向對照:四顆群組分頁都量得到`, r.n === 4, `n=${r.n}`);
      // 標準檔在 360pt 本來就會切掉「捷」(網站既有缺陷,memory topbar-cut-fix-only-on-app-branch),
      // 不是本次改動造成的;寫成條件式判準,才不會把既有缺陷偽裝成本次回歸。
      const knownStdNarrow = tier === 'std' && width === 360;
      ok(`A2 ${tag} 四顆分頁都在視窗內${knownStdNarrow ? '(標準檔窄機=既有缺陷,只記錄)' : ''}`,
        knownStdNarrow ? true : r.outside.length === 0, r.outside.join(','));
      ok(`A3 ${tag} 分頁的字沒有被自己的框切掉`, r.selfClipped.length === 0, r.selfClipped.join(','));
      ok(`A4 ${tag} tab bar 的文字標籤沒有被切在畫面外`, r.labelInside);
      ok(`A5 ${tag} 零 pageerror`, errs.length === 0, errs.slice(0, 1).join(''));
      // 正向對照:`相交=0` 在「其中一個根本沒渲染」時也會成立,先證明兩者都真的量得到
      ok(`A6 ${tag} 正向對照:頂列與時鐘徽章都量得到`, r.bothVisible);
      ok(`A7 ${tag} 頂列與時鐘徽章不重疊`, r.topStackOverlap === 0, 'overlap=' + r.topStackOverlap);
      // 結構性判準:徽章的上緣位置必須留在 CSS(env() 保持符號式)。一旦有人把它算成一個絕對 px
      // 寫進 inline style,安全區晚一步注入(Capacitor 8)就會留下對不上的舊值——App 1.4.9 頂列
      // 與時鐘重疊即此。這一條擋的是「修法形狀」,不是某一次的數值。
      ok(`A8 ${tag} 徽章位置不是 JS 寫死的絕對 px`, r.badgeInlineTop === '', 'inline top=' + r.badgeInlineTop);
      await close();
    }
  }
}

// ── B 段:互動——真的點下去會不會發生事 ──────────────────────────────────────
// elementFromPoint / computed style 只答得出「命中誰」「算出什麼」,答不出「做得到嗎」。
async function sectionB(browser, engine) {
  const { page, errs, close } = await boot(browser, { tier: 'std' });
  const read = () => page.evaluate(() => ({
    ui: getComputedStyle(document.documentElement).getPropertyValue('--ui').trim(),
    fs: document.documentElement.getAttribute('data-fs'),
    ls: localStorage.getItem('trainmap-fontscale'),
    lsFollow: localStorage.getItem('trainmap-fontfollow'),
    rowPx: parseFloat(getComputedStyle(document.querySelector('.more-sheet .ms-row')).fontSize),
    // 面板自己就是字級的預覽場:量「預覽卡的站名」比量 --ui 誠實——--ui 對了但沒人吃它一樣是壞的
    prevPx: (() => { const e = document.querySelector('.fsp-prev-top .stn'); return e ? parseFloat(getComputedStyle(e).fontSize) : 0; })(),
    msVal: (document.getElementById('msFontVal') || {}).textContent,
    panelOpen: !document.getElementById('fontPanel').hidden,
    follow: document.getElementById('fsFollowTg').classList.contains('on'),
    on: [...document.querySelectorAll('#msFontSeg button')].filter(b => b.classList.contains('on')).map(b => b.dataset.v),
  }));
  const base = await read();
  ok(`B1 ${engine} 沒選過時是標準檔`, base.ui === '1' && base.fs === null, JSON.stringify(base));
  await page.tap('#tabMore'); await page.waitForTimeout(400);
  // 設計 6c:字級是「更多」裡的 `›` 子頁,不是抽屜裡的一排鈕。真的點那一列、真的把面板開起來,
  // 不是查 CSS 算出什麼——elementFromPoint／computed style 答得出「命中誰」,答不出「做得到嗎」。
  await page.tap('.ms-row[data-act="fontscale"]'); await page.waitForTimeout(500);
  const opened = await read();
  ok(`B2 ${engine} 「更多」→ 字級 開得起「顯示與字級」面板`, opened.panelOpen && opened.prevPx > 0, JSON.stringify(opened));
  await page.tap('#msFontSeg button[data-v="xlarge"]'); await page.waitForTimeout(500);
  const big = await read();
  // 量「面板預覽卡的站名真的變大了」,不是只量 --ui
  ok(`B3 ${engine} 點特大 → 倍率 1.5 且預覽卡的字真的變大`,
    big.ui === '1.5' && big.prevPx > opened.prevPx * 1.4, JSON.stringify(big));
  ok(`B4 ${engine} 選中態回饋在那一顆鈕上`, JSON.stringify(big.on) === '["xlarge"]', JSON.stringify(big.on));
  ok(`B5 ${engine} 偏好寫進 localStorage`, big.ls === 'xlarge');
  await page.tap('#msFontSeg button[data-v="std"]'); await page.waitForTimeout(400);
  const back = await read();
  // 反向對照:很多「開得起來」的設定其實關不回去(單向閥),要明確驗回程
  ok(`B6 ${engine} 點回標準真的回得去(不是單向閥)`,
    back.ui === '1' && back.fs === null && back.ls === 'std', JSON.stringify(back));
  ok(`B6b ${engine} 「更多」那一列顯示目前的階`, back.msVal === '標準', 'msVal=' + back.msVal);
  await page.tap('#msFontSeg button[data-v="large"]'); await page.waitForTimeout(300);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.ready, null, { timeout: 45000 }).catch(() => {});
  const again = await read();
  ok(`B7 ${engine} 重新載入後保留「大」`, again.ui === '1.25' && again.fs === 'large', JSON.stringify(again));
  ok(`B8 ${engine} data-fs 由 head 首繪腳本掛上(不會先閃一下標準字級)`,
    await page.evaluate(() => document.documentElement.getAttribute('data-fs')) === 'large');
  ok(`B9 ${engine} 全程零 pageerror`, errs.length === 0, errs.slice(0, 1).join(''));
  await close();
}

// ── C 段:契約——直播殼與系統字級 ────────────────────────────────────────────
async function sectionC(browser, engine) {
  // ?live=1 是 OBS 訊號源契約:版面固定,不可以因為某台裝置存過字級偏好就變形
  const live = await boot(browser, { tier: 'xlarge', query: '?live=1' });
  const lr = await live.page.evaluate(() => ({
    fs: document.documentElement.getAttribute('data-fs'),
    ui: getComputedStyle(document.documentElement).getPropertyValue('--ui').trim(),
  }));
  ok(`C1 ${engine} ?live=1 即使存過特大也恆定標準字級`, lr.fs === null && lr.ui === '1', JSON.stringify(lr));
  await live.close();

  // 系統字級:正反向對照。iOS 的 -apple-system-body 在輔助使用級別會回報 >= 28px。
  // 這裡用 !important 蓋掉探針 span 的字級來模擬——只有正向沒有反向的話,「永遠回 xlarge」也會全綠。
  const { page, close } = await boot(browser, { tier: 'std' });
  for (const [px, want, label] of [[30, 'xlarge', '輔助使用級別'], [16, null, '一般級別']]) {
    await page.evaluate(v => {
      document.getElementById('__fsprobe')?.remove();
      const st = document.createElement('style');
      st.id = '__fsprobe'; st.textContent = 'span{font-size:' + v + 'px !important}';
      document.head.appendChild(st);
      localStorage.setItem('trainmap-fontscale', 'std'); state.fontScale = 'std';
      document.dispatchEvent(new Event('visibilitychange'));  // 回前景時會重測一次
    }, px);
    await page.waitForTimeout(300);
    const got = await page.evaluate(() => document.documentElement.getAttribute('data-fs'));
    ok(`C2 ${engine} 系統字級 ${px}px(${label}) → data-fs=${want}`, got === want, 'got=' + got);
  }
  await close();
}

// ── D 段:跟隨系統字級的開關(設計 6a)——這一條的反向對照是整段的重點 ──────────────
// 使用者自己選了特大時,關掉跟隨看不出任何差別(兩條路都給特大)。要驗這顆開關真的有作用,
// 必須把「系統推的」與「使用者選的」拆開:使用者維持標準、系統推到輔助使用級別,
// 這時開關的開/關才是唯一變因。
async function sectionD(browser, engine) {
  const { page, errs, close } = await boot(browser, { tier: 'std' });
  const setSysFont = px => page.evaluate(v => {
    document.getElementById('__fsprobe')?.remove();
    const st = document.createElement('style');
    st.id = '__fsprobe'; st.textContent = 'span{font-size:' + v + 'px !important}';
    document.head.appendChild(st);
  }, px);
  const state1 = () => page.evaluate(() => ({
    fs: document.documentElement.getAttribute('data-fs'),
    follow: document.getElementById('fsFollowTg').classList.contains('on'),
    msVal: (document.getElementById('msFontVal') || {}).textContent,
    lsFollow: localStorage.getItem('trainmap-fontfollow'),
  }));
  await page.tap('#tabMore'); await page.waitForTimeout(350);
  await page.tap('.ms-row[data-act="fontscale"]'); await page.waitForTimeout(450);
  ok(`D0 ${engine} 跟隨系統字級預設是開的`, (await state1()).follow);
  await setSysFont(30);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(350);
  const onSt = await state1();
  ok(`D1 ${engine} 開關【開】+ 系統輔助使用級別 → 自動切到特大`, onSt.fs === 'xlarge', JSON.stringify(onSt));
  // 使用者選的仍是標準,抽屜列要說清楚「這是跟隨系統來的」,否則會以為自己的設定沒生效
  ok(`D2 ${engine} 抽屜列標示「跟隨系統」`, /跟隨系統/.test(onSt.msVal || ''), 'msVal=' + onSt.msVal);
  await page.tap('#fsFollowTg'); await page.waitForTimeout(400);
  const offSt = await state1();
  // 反向對照:關掉之後系統字級還是 30px,唯一變因是這顆開關
  ok(`D3 ${engine} 開關【關】+ 同一個系統字級 → 退回標準(反向對照)`,
    offSt.fs === null && offSt.follow === false, JSON.stringify(offSt));
  ok(`D4 ${engine} 關掉的偏好寫進 localStorage`, offSt.lsFollow === '0', 'lsFollow=' + offSt.lsFollow);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.ready, null, { timeout: 45000 }).catch(() => {});
  await setSysFont(30);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(400);
  const afterReload = await page.evaluate(() => document.documentElement.getAttribute('data-fs'));
  ok(`D5 ${engine} 重新載入後仍然是關的(不會自己開回來)`, afterReload === null, 'data-fs=' + afterReload);
  ok(`D6 ${engine} 全程零 pageerror`, errs.length === 0, errs.slice(0, 1).join(''));
  await close();
}

// ── E 段:車站看板列三階(設計 6b)——「最會撞版的一列」 ─────────────────────────
// 設計原文:標準單行、大改兩行(六個欄位一個都不收)、特大才收欄位,且收掉的欄位一定有可達路徑。
// 三條判準各對一種壞法:字被切掉(E1)、欄位收了卻回不來(E3/E4)、出口把跟車熱區吃掉(E5)。
async function sectionE(browser, engine) {
  const openBoard = async page => page.evaluate(() => {
    const e = buildStnIndex().find(s => s.sysId === 'tra_sched' && s.name === '板橋')
      || buildStnIndex().find(s => s.sysId === 'tra_sched');
    if (!e) return false;
    openBoard({ name: e.name, sys: e.sysId, lat: e.lat, lon: e.lon });
    return true;
  });
  for (const tier of ['std', 'large', 'xlarge']) {
    for (const width of [360, 393]) {
      const { page, close } = await boot(browser, { width, tier });
      const okBoard = await openBoard(page);
      await page.waitForTimeout(500);
      const r = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#board .row[data-no]')];
        // 🔴 不能用 .dest 的 offsetParent 判可見:大檔的 .dest 是 display:contents(自己沒有盒),
        //    offsetParent 恆為 null,拿它當判準會把「排得好好的」誤判成「被收起來」(本支第一版實際踩到)。
        //    量真正承載文字的 .ty／.to 才問得到「這個欄位在不在畫面上」。
        const shown = el => !!(el && el.getClientRects().length);
        const clipped = rows.filter(row => [...row.querySelectorAll('.ty, .to')]
          .some(e => shown(e) && e.scrollWidth > e.clientWidth + 1)).length;
        const full = rows.filter(row => shown(row.querySelector('.ty')) && shown(row.querySelector('.to'))).length;
        const anyField = rows.filter(row => shown(row.querySelector('.ty')) || shown(row.querySelector('.to'))).length;
        return { n: rows.length, clipped, full, anyField };
      });
      const tag = `${engine} ${tier} ${width}pt`;
      ok(`E1 ${tag} 正向對照:看板列量得到`, okBoard && r.n > 0, `n=${r.n}`);
      ok(`E2 ${tag} 沒有任何一列的車種／方向被切字`, r.clipped === 0, `clipped=${r.clipped}`);
      // 大不收欄位(設計明文:長者最常抱怨「功能不見了」);特大才收
      if (tier !== 'xlarge') ok(`E3 ${tag} 標準／大不收任何欄位(車種與方向都在)`, r.full === r.n, `${r.full}/${r.n}`);
      else ok(`E3 ${tag} 特大預設收起車種與方向`, r.anyField === 0, `${r.anyField}/${r.n}`);
      await close();
    }
  }
  // 可達路徑與熱區:只在特大有意義
  const { page, errs, close } = await boot(browser, { tier: 'xlarge' });
  await openBoard(page); await page.waitForTimeout(500);
  const chev = page.locator('#board .row[data-no] .rmore').first();
  ok(`E4a ${engine} 特大時列尾有「›」出口`, await chev.isVisible());
  await chev.tap(); await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const row = document.querySelector('#board .row[data-no]');
    const to = row && row.querySelector('.to'), ty = row && row.querySelector('.ty');
    const shown = el => !!(el && el.getClientRects().length);
    return { boardOpen: !document.getElementById('board').hidden, following: !!state.followTrain,
      destShown: shown(to) && shown(ty), txt: to ? to.textContent.trim() : '' };
  });
  // 收掉的欄位一定有可達路徑——點開就是原本那三個欄位
  ok(`E4b ${engine} 點「›」把車種與方向叫回來`, after.destShown && /往/.test(after.txt), JSON.stringify(after));
  // 🔴 整列本來就是「跟隨這班」的熱區,出口若沒把事件擋住,點展開會直接跟車並關掉看板
  ok(`E5 ${engine} 點「›」不會誤觸跟車(看板還開著、沒有跟車)`,
    after.boardOpen && !after.following, JSON.stringify(after));
  // 反向對照:同一張看板點「列」本身仍然要跟車——否則上面那條用「什麼都不會發生」也能過
  await page.locator('#board .row[data-no] b').first().tap(); await page.waitForTimeout(600);
  const followed = await page.evaluate(() => ({ following: !!state.followTrain, boardOpen: !document.getElementById('board').hidden }));
  ok(`E6 ${engine} 反向對照:點列本身仍然會跟車`, followed.following && !followed.boardOpen, JSON.stringify(followed));
  ok(`E7 ${engine} 全程零 pageerror`, errs.length === 0, errs.slice(0, 1).join(''));
  await close();
}

// ── F 段:「更多」抽屜三階(設計 6c)＋兩條倍率的契約 ────────────────────────────
// 設計檔 TURN 5/6 的對照表不是一顆倍率:主文 1／1.25／1.5,小標籤與次要說明只有
// 1／1.14／1.29。F4 就是在守這件事——少了它,把 --uis 直接設成 --ui 也能全綠。
const F_ROWH = { std: 48, large: 68, xlarge: 80 };   // 設計對照表「列高」那一列
const F_SECPX = { std: 11, large: 12.5, xlarge: 14 }; // 設計對照表「小標籤」那一列

async function sectionF(browser, engine) {
  // F0 結構性:掃原始碼,確認兩條倍率沒有互相跑錯邊(數值判準抓不到「某一處忘了改」)
  if (engine === 'chromium') {
    const src = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const strayMain = [...src.matchAll(/font-size:\s*calc\(((?:\d(?:\.5)?|10(?:\.5)?|11(?:\.5)?|12)px)\s*\*\s*var\(--ui\)\)/g)];
    const straySmall = [...src.matchAll(/font-size:\s*calc\((1[2-9]\.5px|1[3-9]px|[2-9]\d[\d.]*px)\s*\*\s*var\(--uis\)\)/g)];
    ok('F0a 12px 以下的字級沒有一處還留在主倍率 --ui 上', strayMain.length === 0,
      strayMain.slice(0, 3).map(m => m[1]).join(','));
    ok('F0b 12.5px 以上的字級沒有一處跑到小倍率 --uis 上', straySmall.length === 0,
      straySmall.slice(0, 3).map(m => m[1]).join(','));
    ok('F0c 兩條倍率三檔都宣告齊全',
      /--uis:\s*1;/.test(src) && /html\[data-fs=large\][^}]*--uis:\s*1\.14/.test(src)
      && /html\[data-fs=xlarge\][^}]*--uis:\s*1\.29/.test(src));
  }

  for (const tier of ['std', 'large', 'xlarge']) {
    for (const width of [360, 393]) {
      const tag = `${engine} ${tier} ${width}pt`;
      const { page, errs, close } = await boot(browser, { width, tier });
      const r = await page.evaluate(() => {
        document.getElementById('tabMore').click();
        const sheet = document.querySelector('.more-sheet');
        const vis = el => el && el.getClientRects().length > 0;
        const rows = [...sheet.querySelectorAll('.ms-row')].filter(vis);
        const sec = [...sheet.querySelectorAll('.ms-sec')].filter(vis)[0];
        const px = el => +getComputedStyle(el).fontSize.replace('px', '');
        const R = el => { const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
        const fsRow = sheet.querySelector('.ms-row[data-act="fontscale"]');
        const lab = R(fsRow.firstElementChild), val = R(fsRow.querySelector('#msFontVal')),
          chev = R(fsRow.querySelector('.ms-tail .chev')), rr = R(fsRow);
        return {
          n: rows.length,
          minH: Math.min(...rows.map(x => x.getBoundingClientRect().height)),
          secPx: sec ? px(sec) : null,
          labPx: px(fsRow.firstElementChild),
          stacked: val.y >= lab.y + lab.h - 1,
          inline: Math.abs(val.y - lab.y) < 3,
          valLeft: Math.abs(val.x - lab.x) < 3,
          chevRight: chev.x + chev.w >= rr.x + rr.w - 26,
          chevMid: Math.abs((chev.y + chev.h / 2) - (rr.y + rr.h / 2)) < 6,
        };
      });

      // 正向對照:先證明列與段標題都真的量得到——不然下面每一條在「面板沒開」時也成立
      ok(`F1 ${tag} 正向對照:抽屜列與段標題都量得到`, r.n >= 12 && r.secPx > 0, `n=${r.n} sec=${r.secPx}`);
      // 列高吃設計對照表,不是吃「目前量到多少」:特大原本只有 49px,連 60px 觸控目標都不到
      ok(`F2 ${tag} 每一列都不低於設計列高 ${F_ROWH[tier]}px`, r.minH >= F_ROWH[tier] - 0.5, `minH=${r.minH}`);
      ok(`F3 ${tag} 段標題字級 ≈ ${F_SECPX[tier]}px(小倍率)`, Math.abs(r.secPx - F_SECPX[tier]) <= 0.6, `secPx=${r.secPx}`);
      // 兩條倍率必須真的不一樣:小標籤的放大幅度要明顯小於主文,否則就是又退回一顆倍率
      const smallRatio = r.secPx / F_SECPX.std, mainRatio = r.labPx / 13.5;
      ok(`F4 ${tag} 小字倍率確實比主倍率溫和(${smallRatio.toFixed(2)}× vs ${mainRatio.toFixed(2)}×)`,
        tier === 'std' ? Math.abs(smallRatio - mainRatio) < 0.02 : mainRatio - smallRatio > 0.1,
        `small=${smallRatio.toFixed(3)} main=${mainRatio.toFixed(3)}`);
      // 值的位置:特大掉第二行、其餘同一行——兩個方向都寫死,少收或多收都會轉紅
      ok(`F5 ${tag} 目前值${tier === 'xlarge' ? '掉到第二行並切齊標籤左緣' : '與標籤同一行'}`,
        tier === 'xlarge' ? (r.stacked && r.valLeft && !r.inline) : (r.inline && !r.stacked),
        JSON.stringify({ inline: r.inline, stacked: r.stacked, valLeft: r.valLeft }));
      ok(`F6 ${tag} 「›」始終留在右緣且垂直置中`, r.chevRight && r.chevMid,
        JSON.stringify({ chevRight: r.chevRight, chevMid: r.chevMid }));
      ok(`F7 ${tag} 零 pageerror`, errs.length === 0, errs.slice(0, 1).join(''));
      await close();
    }
  }
}

await assertTarget();
for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await launcher.launch();
  await sectionA(browser, engine);
  await sectionB(browser, engine);
  await sectionC(browser, engine);
  await sectionD(browser, engine);
  await sectionE(browser, engine);
  await sectionF(browser, engine);
  await browser.close();
}
const pass = results.filter(r => r.pass).length;
console.log(`\n=== ${pass}/${results.length} 通過 ===`);
process.exit(pass === results.length ? 0 : 1);
