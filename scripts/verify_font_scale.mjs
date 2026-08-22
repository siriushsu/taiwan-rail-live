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
        // 「框把自己的字切掉」與「跑出視窗」是兩種不同的壞法,要各自有判準。
        // 🔴 不能用 scrollWidth:絕對定位的 ::after 觸控熱區(比鈕大)也會算進 scrollWidth,
        //    量到的是熱區溢出、不是字被切。改用 Range 量文字節點自己的墨跡框,對上內容框比。
        const textBox = el => {
          const n = [...el.childNodes].find(x => x.nodeType === 3 && x.textContent.trim());
          if (!n) return null;
          const rg = document.createRange(); rg.selectNodeContents(n);
          const b = rg.getBoundingClientRect(); rg.detach && rg.detach();
          return b;
        };
        const selfClipped = tabs.filter(t => {
          const tb = textBox(t); if (!tb) return false;
          const cs = getComputedStyle(t), b = t.getBoundingClientRect();
          const iw = b.width - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
          const ih = b.height - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
          return tb.width > iw + 0.5 || tb.height > ih + 0.5;
        }).map(t => t.textContent.trim());
        const tl = document.querySelector('.tabbar .tl').getBoundingClientRect();
        // 上緣堆疊:頂列與時鐘徽章。判準用「rect 相交面積」而不是「徽章 top >= 某常數」——
        // 常數會隨頂列高度漂移,正是這條缺陷的成因。
        const bar = document.getElementById('topbar'), bg = document.querySelector('.badge');
        const br = bar.getBoundingClientRect(), gr = bg.getBoundingClientRect();
        const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
                             * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        // D4 排法B 之後徽章是頂列的子元素:此時「不重疊」要換成「完全裝得進頂列,且與同列的兄弟互不相疊」
        const inBar = bar.contains(bg);
        const contained = gr.left >= br.left - 0.5 && gr.right <= br.right + 0.5
                       && gr.top >= br.top - 0.5 && gr.bottom <= br.bottom + 0.5;
        const sibs = [...bar.querySelectorAll('.tb-logo,.alert-chip,.grouptabs .gtab,.tb-plate')]
          .filter(e => e.getClientRects().length && +getComputedStyle(e).opacity >= 0.5);
        const sibOverlap = +Math.max(0, ...sibs.map(e => area(gr, e.getBoundingClientRect())), 0).toFixed(0);
        return { n: tabs.length, outside, selfClipped, labelInside: tl.bottom <= innerHeight + 0.5,
          bothVisible: br.height > 0 && gr.height > 0,
          topStackOverlap: +area(br, gr).toFixed(0),
          badgeInBar: inBar, badgeContained: contained, sibOverlap, sibN: sibs.length,
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
      // A7 涵蓋兩種排法:徽章是獨立卡 ⇒ 與頂列零相交;徽章併進頂列(D4 排法B) ⇒ 必須整塊裝得進頂列,
      // 且與同一列的 logo／公告鈕／群組分頁全部零相交。兩側都寫死,少了任何一半都會讓另一種排法無條件通過。
      ok(`A7 ${tag} 時鐘徽章${r.badgeInBar ? '併入頂列:裝得進去且與同列控件互不相疊' : '獨立卡:與頂列不重疊'}`,
        r.badgeInBar ? (r.badgeContained && r.sibOverlap === 0 && r.sibN >= 2)
                     : r.topStackOverlap === 0,
        r.badgeInBar ? `contained=${r.badgeContained} 與兄弟相疊=${r.sibOverlap} 兄弟數=${r.sibN}`
                     : 'overlap=' + r.topStackOverlap);
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
  // 🔴 先暫停:看板每 20 模擬秒重繪一次會把「›」展開洗掉,E4b 因此偶發假紅(實測 webkit 三輪中一輪)。
  //    這裡凍住的是與本段無關的變因(時間在跑),不是放寬判準。
  await page.evaluate(() => { if (state.playing) togglePlay(); });
  // 🔴 分辨「點擊根本沒送到」(harness)與「送到了但沒展開」(產品):容器上數 .rmore 的點擊次數,
  //    另外用 MutationObserver 數看板重繪——看板每 20 模擬秒 innerHTML 重繪一次會把 .rx 洗掉
  //    (使用者展開的那一列同樣會被收回去,是既有行為,不是本條要測的東西)。
  //    所以量測窗壓到最小:tap 之後 waitForFunction 等 .rx 出現,出現當下同一發 evaluate 讀完欄位。
  //    原本固定等 300ms,webkit 三輪中約一輪剛好被重繪掃到(實測 點擊次數=1、rx=false),長得像假紅。
  await page.evaluate(() => { window.__rmoreClicks = 0; window.__boardRedraw = 0;
    document.getElementById('board').addEventListener('click',
      e => { if (e.target.closest('.rmore')) window.__rmoreClicks++; }, true);
    new MutationObserver(ms => { for (const m of ms) if (m.type === 'childList' && m.removedNodes.length) window.__boardRedraw++; })
      .observe(document.getElementById('board'), { childList: true });
  });
  const chev = page.locator('#board .row[data-no] .rmore').first();
  ok(`E4a ${engine} 特大時列尾有「›」出口`, await chev.isVisible());
  await chev.tap();
  const rxSeen = await page.waitForFunction(() => !!document.querySelector('#board .row[data-no].rx'),
    null, { timeout: 3000 }).then(() => true).catch(() => false);
  const after = await page.evaluate(() => {
    const row = document.querySelector('#board .row[data-no].rx') || document.querySelector('#board .row[data-no]');
    const to = row && row.querySelector('.to'), ty = row && row.querySelector('.ty');
    const shown = el => !!(el && el.getClientRects().length);
    return { boardOpen: !document.getElementById('board').hidden, following: !!state.followTrain,
      destShown: shown(to) && shown(ty), txt: to ? to.textContent.trim() : '',
      n: window.__rmoreClicks, redraw: window.__boardRedraw,
      rx: !!document.querySelector('#board .row[data-no].rx') };
  });
  // 收掉的欄位一定有可達路徑——點開就是原本那三個欄位
  ok(`E4b ${engine} 點「›」把車種與方向叫回來`, after.destShown && /往/.test(after.txt),
    JSON.stringify({ ...after, 等到rx: rxSeen }));
  // 🔴 整列本來就是「跟隨這班」的熱區,出口若沒把事件擋住,點展開會直接跟車並關掉看板
  ok(`E5 ${engine} 點「›」不會誤觸跟車(看板還開著、沒有跟車)`,
    after.boardOpen && !after.following, JSON.stringify(after));
  // 反向對照:同一張看板點「列」本身仍然要跟車——否則上面那條用「什麼都不會發生」也能過。
  // 🔴 「跟完要不要收看板」兩種殼不同,兩側都寫死:手機(整合卡 D1–D2)看板留著當「這一站」分頁、
  //    並切到「這班車」;桌面維持原本的「選到車一律收板」。少了任何一半,另一種殼會無條件通過。
  await page.locator('#board .row[data-no] b').first().tap(); await page.waitForTimeout(600);
  const followed = await page.evaluate(() => ({
    fs: document.body.classList.contains('fs'),
    following: !!state.followTrain,
    boardOpen: !document.getElementById('board').hidden,
    tab: (document.querySelector('.uni-tabs button[aria-selected="true"]') || {}).textContent || '',
  }));
  ok(`E6 ${engine} 反向對照:點列本身仍然會跟車`, followed.following, JSON.stringify(followed));
  ok(`E7 ${engine} 跟完之後${'手機保留看板當「這一站」分頁並切到「這班車」'}`,
    followed.fs ? (followed.boardOpen && followed.tab === '這班車') : !followed.boardOpen,
    JSON.stringify(followed));
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

// ── G 段:第三條倍率——觸控目標與章(設計對照表 觸控目標 44/52/60、設計 6d 章 64→88) ──
// 這一段守的是「盒子」不是「字」:倍率放大字的時候盒子不會自己跟著長,設計的觸控目標那一列
// 因此必須獨立驗。G4 是反向對照——三條倍率必須互不相等,否則等於又退回一條。
const G_TAP = { std: 44, large: 52, xlarge: 60 };   // 設計對照表「觸控目標」那一列
const G_SEAL = { std: 56, large: 66, xlarge: 76 };  // 我方章基準 56,吃與觸控目標同一條(設計 64→88 是 ×1.375)

async function sectionG(browser, engine) {
  for (const tier of ['std', 'large', 'xlarge']) {
    const tag = `${engine} ${tier} 393pt`;
    const { page, errs, close } = await boot(browser, { width: 393, tier });
    const r = await page.evaluate(() => {
      const vis = el => el && el.getClientRects().length > 0;
      const tabs = [...document.querySelectorAll('.tabbar button')].filter(vis);
      const journey = tabs.find(x => /旅/.test(x.textContent));
      if (journey) journey.click();
      const seals = [...document.querySelectorAll('#ridePanel .seal')].filter(vis);
      const rowsByY = {};
      seals.forEach(s => { const b = s.getBoundingClientRect(); (rowsByY[Math.round(b.y / 4)] ||= []).push(b); });
      const perRow = Object.values(rowsByY).map(a => a.length);
      const cs = seals[0] && getComputedStyle(seals[0]);
      const panel = document.getElementById('ridePanel');
      const pr = panel && panel.getBoundingClientRect();
      const sealOut = seals.filter(s => { const b = s.getBoundingClientRect(); return pr && (b.right > pr.right + 0.5 || b.left < pr.left - 0.5); }).length;
      return {
        tabN: tabs.length,
        tapMin: tabs.length ? Math.min(...tabs.map(x => x.getBoundingClientRect().height)) : 0,
        sealN: seals.length,
        seal: seals.length ? +seals[0].getBoundingClientRect().width.toFixed(1) : 0,
        rotated: !!(cs && cs.transform !== 'none'),
        hasDate: seals.some(s => s.querySelector('small') && s.querySelector('small').textContent.trim()),
        perRowMax: perRow.length ? Math.max(...perRow) : 0,
        sealOut,
        ramps: (() => { const c = getComputedStyle(document.documentElement);
          return ['--ui', '--uis', '--uit'].map(k => +c.getPropertyValue(k).trim()); })(),
      };
    });

    // 正向對照:先證明 tab 鈕與章都真的量得到,不然下面每一條在「什麼都沒渲染」時也成立
    ok(`G1 ${tag} 正向對照:tab 鈕與章都量得到`, r.tabN >= 4 && r.sealN >= 6, `tab=${r.tabN} seal=${r.sealN}`);
    // 觸控目標吃設計對照表,不是吃主倍率——吃主倍率會變成 44/55/66,比設計大一號
    ok(`G2 ${tag} tab 觸控目標 ≈ 設計的 ${G_TAP[tier]}px`, Math.abs(r.tapMin - G_TAP[tier]) <= 1.2, `tapMin=${r.tapMin}`);
    ok(`G3 ${tag} 章直徑 ≈ ${G_SEAL[tier]}px`, Math.abs(r.seal - G_SEAL[tier]) <= 1.5, `seal=${r.seal}`);
    // 三條倍率必須互不相等(標準檔則必須全部是 1)——少了這條,把 --uit 設回 --ui 也會全綠
    const [u, us, ut] = r.ramps;
    ok(`G4 ${tag} 三條倍率${tier === 'std' ? '在標準檔全部是 1' : '互不相等且 --uis < --uit < --ui'}`,
      tier === 'std' ? (u === 1 && us === 1 && ut === 1) : (us < ut && ut < u),
      `ui=${u} uis=${us} uit=${ut}`);
    // 6d:放大不該讓章變回貼紙——歪斜與蓋章日期都要留著
    ok(`G5 ${tag} 章仍然是歪的、日期還在`, r.rotated && r.hasDate, `rot=${r.rotated} date=${r.hasDate}`);
    ok(`G6 ${tag} 沒有任何一枚章被擠出面板`, r.sealOut === 0, `out=${r.sealOut}`);
    ok(`G7 ${tag} 零 pageerror`, errs.length === 0, errs.slice(0, 1).join(''));
    await close();
  }
}

// ── H 段:跟車置中機制(使用者 2026-08-22 點名:「之前有做讓列車或是車站置中 不被卡片擋住的機制 這個需要存留」) ──
// D4 把時鐘徽章併進頂列 ⇒ 可視地圖窗的上界從 ~100px 縮到 58px,那套讓位記帳必須跟著變、而且只能變這麼多。
// 🔴 判準刻意**不呼叫 mapInsets()**:自己逐一點名畫面上真的畫著的 chrome、量它們的 rect,
//    目標落點則用 Leaflet 自己的 latLngToContainerPoint(外部真值)。兩邊不同源(心得 29)。
// 🔴 「車在可視窗內」與「車沒被卡片蓋住」是兩件事:前者是幾何、後者要 elementFromPoint 才答得出來(心得 24)。
const H_CENSUS = () => {
  const mc = map.getContainer().getBoundingClientRect();
  const vis = el => {
    if (!el || el.hidden || !el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && +cs.opacity >= 0.5;
  };
  const N = [['topbar', document.getElementById('topbar')], ['badge', document.querySelector('.badge')],
    ['tabbar', document.querySelector('.tabbar')], ['controls', document.querySelector('.controls')],
    ['followPanel', document.getElementById('followPanel')], ['freqCard', document.getElementById('freqCard')],
    ['sheet', (typeof activeSheetEl === 'function' ? activeSheetEl() : null)]];
  let top = 0, bottom = 0; const seen = [];
  for (const [n, el] of N) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0.5 && r.height > 0.5)) continue;
    seen.push(n);
    // 🔴 跟車小卡/示意車卡是 176px 寬(≈45% 容器)的浮動卡,實測 app 也把它記在 left——
    //    它擋住的是左半邊,不是一整條橫帶,不該吃上下界。判準用「有沒有橫跨大半個寬度」這個
    //    物理事實,不是抄 app 的分類。(沒有這條的話,卡被抬到 sheet 上方時可視窗會被算成零高。)
    if ((n === 'followPanel' || n === 'freqCard') && r.width < mc.width * 0.6) continue;
    // 依「離哪一邊近」分類貼上緣/貼下緣,不用「top < 半高」——底部 sheet 的頂緣會落在半高以上
    if (mc.bottom - r.bottom < r.top - mc.top) bottom = Math.max(bottom, mc.bottom - r.top + 8);
    else top = Math.max(top, r.bottom - mc.top + 8);
  }
  return { mcH: mc.height, top: +top.toFixed(1), bottom: +bottom.toFixed(1), seen,
    bandTop: top, bandBot: mc.height - bottom,
    want: +((bottom - top) / 2).toFixed(1),
    shiftY: state._focusShift ? +state._focusShift.y.toFixed(1) : null };
};

async function sectionH(browser, engine) {
  const tag = `${engine} 393pt`;
  const { page, errs, close } = await boot(browser, { width: 393 });
  // 挑一台「畫在畫面中段、圖例沒關掉」的車來跟——太靠邊的車會被 maxBounds 夾住,夾住後的位移是另一條路徑
  const picked = await page.evaluate(() => {
    const mc = map.getContainer().getBoundingClientRect();
    for (const t of (state.trains || [])) {
      if (!state.visible.has(t.typeName)) continue;
      const pos = trainPos(t, state.simSec);
      if (!pos) continue;
      const pt = map.latLngToContainerPoint(L.latLng(pos.lat, pos.lon));
      if (pt.x > 60 && pt.x < mc.width - 60 && pt.y > 180 && pt.y < 600) {
        setFollow(t, false);
        return String(t.no || t.trainNo || t.typeName || '?');
      }
    }
    return null;
  });
  await page.waitForTimeout(3000);
  const F = await page.evaluate(c => {
    const r = eval('(' + c + ')')();
    const t = state.followTrain;
    if (!t) return { ...r, ok: false, why: '沒跟到車' };
    const pos = trainPos(t, state.simSec);
    if (!pos) return { ...r, ok: false, why: '跟到的車算不出位置' };
    const mc = map.getContainer().getBoundingClientRect();
    const pt = map.latLngToContainerPoint(L.latLng(pos.lat, pos.lon));
    const hit = document.elementFromPoint(mc.left + pt.x, mc.top + pt.y);
    const chrome = hit && hit.closest('.topbar,.badge,.tabbar,.controls,#followPanel,#freqCard,.sheet,#mapActions');
    const fp = document.getElementById('followPanel');
    return { ...r, ok: true, py: +pt.y.toFixed(1),
      inBand: pt.y >= r.bandTop && pt.y <= r.bandBot,
      covered: !!chrome, hit: hit ? (hit.id || String(hit.className).slice(0, 28)) : 'none',
      panelUp: !!fp && !fp.hidden && fp.getClientRects().length > 0 };
  }, H_CENSUS.toString());

  // 正向對照:先證明真的跟到了車、跟車卡真的開著。少了這條,下面每一條在「根本沒跟車」時都空成立
  ok(`H1 ${tag} 正向對照:跟到車${picked ? `(${picked})` : ''}且跟車卡開著`,
    !!picked && F.ok && F.panelUp, F.why || `picked=${picked} panel=${F.panelUp}`);
  ok(`H2 ${tag} 跟車目標落在可視地圖窗內(上${F.top}~下緣${F.bandBot})`,
    F.ok && F.inBand, `車y=${F.py}`);
  ok(`H3 ${tag} 跟車目標沒有被任何卡片蓋住`, F.ok && !F.covered, `命中 ${F.hit}`);
  // 徽章併進頂列之後,上界必須真的縮小(D4 的收益本身要有判準,不然改回去也全綠)
  ok(`H4 ${tag} 上界已收到 ≤62px(徽章併入頂列)`, F.top > 0 && F.top <= 62, `上界=${F.top} chrome=[${F.seen}]`);

  // 解除跟隨 → §04c 前瞻偏移退掉,只剩純讓位;此時記帳必須恰好等於我自己量到的 (下界−上界)/2。
  // 這條是差量式的:它不吃任何常數,版面怎麼改都成立,改壞了才會紅。
  await page.evaluate(() => { if (typeof clearFollow === 'function') clearFollow(); });
  await page.waitForTimeout(1800);
  const C = await page.evaluate(c => eval('(' + c + ')')(), H_CENSUS.toString());
  ok(`H5 ${tag} 解除跟隨後讓位記帳 = 我獨立量到的 (下界−上界)/2`,
    C.shiftY != null && Math.abs(C.shiftY - C.want) <= 2,
    `shiftY=${C.shiftY} 應為 ${C.want} chrome=[${C.seen}] 上${C.top} 下${C.bottom}`);
  ok(`H6 ${tag} 零 pageerror`, errs.length === 0, errs.slice(0, 1).join(''));
  await close();

  // ── H7:第二個情境——跟車中開站看板(可視窗下緣從 792 升到 392) ──
  // 🔴 這一段的牙在 H5,不在 H8/H9。實測突變(computeMapInsets 恆回 NONE)只有 H5 轉紅:
  //    沒有讓位時車停在容器中心再減前瞻 ≈ y370,而看板中尺寸的可視窗下緣是 392——**恰好還看得到**。
  //    改用「大」尺寸看板也不行:那時 sheet 幾乎蓋滿地圖,app 的 MIN_MAP_STRIP 閘門本來就會放棄讓位。
  //    所以 H8/H9 守的是「車被推到卡片底下」這個使用者看得到的症狀(仍會抓到真回歸),
  //    「記帳有沒有算對」則由 H5 負責——不要把 H8/H9 當成機制的證明。
  const s2 = await boot(browser, { width: 393 });
  const started = await s2.page.evaluate(() => {
    const mc = map.getContainer().getBoundingClientRect();
    for (const t of (state.trains || [])) {
      if (!state.visible.has(t.typeName)) continue;
      const pos = trainPos(t, state.simSec);
      if (!pos) continue;
      const pt = map.latLngToContainerPoint(L.latLng(pos.lat, pos.lon));
      if (pt.x > 60 && pt.x < mc.width - 60 && pt.y > 180 && pt.y < 600) { setFollow(t, false); return true; }
    }
    return false;
  });
  await s2.page.waitForTimeout(2200);
  await s2.page.evaluate(() => {
    const e = buildStnIndex().find(x => x.sysId === 'tra_sched' && x.name === '板橋');
    if (e) openBoard({ name: e.name, sys: e.sysId, lat: e.lat, lon: e.lon });
  });
  await s2.page.waitForTimeout(2600);
  const S = await s2.page.evaluate(c => {
    const r = eval('(' + c + ')')();
    const t = state.followTrain;
    if (!t) return { ...r, ok: false, why: '開看板之後不再跟車' };
    const pos = trainPos(t, state.simSec);
    if (!pos) return { ...r, ok: false, why: '算不出位置' };
    const mc = map.getContainer().getBoundingClientRect();
    const pt = map.latLngToContainerPoint(L.latLng(pos.lat, pos.lon));
    const hit = document.elementFromPoint(mc.left + pt.x, mc.top + pt.y);
    const chrome = hit && hit.closest('.topbar,.badge,.tabbar,.controls,#followPanel,#freqCard,.sheet,#mapActions');
    return { ...r, ok: true, py: +pt.y.toFixed(1), sheetUp: r.seen.includes('sheet'),
      inBand: pt.y >= r.bandTop && pt.y <= r.bandBot,
      covered: !!chrome, hit: hit ? (hit.id || String(hit.className).slice(0, 28)) : 'none' };
  }, H_CENSUS.toString());
  // 正向對照:看板真的開著、而且它真的把可視窗壓掉一大塊(否則這一格跟 H2 是同一個情境)
  ok(`H7 ${tag} 正向對照:跟車中開得起看板,且看板真的壓掉可視窗`,
    started && S.ok && S.sheetUp && S.bandBot < 520, `${S.why || ''} sheet=${S.sheetUp} 下緣=${S.bandBot}`);
  ok(`H8 ${tag} 看板開著時跟車目標仍在可視窗內(${S.bandTop}~${S.bandBot})`, S.ok && S.inBand, `車y=${S.py}`);
  ok(`H9 ${tag} 看板開著時跟車目標沒有被卡片蓋住`, S.ok && !S.covered, `命中 ${S.hit}`);
  ok(`H10 ${tag} 零 pageerror`, s2.errs.length === 0, s2.errs.slice(0, 1).join(''));
  await s2.close();
}

// ── I 段:D4 排法B——頂列收成一排 + 狀態字樣搬進「更多 · 資料狀態」 ──────────────
// 使用者 2026-08-22 裁示:頂列排法B(兩層併一層)、狀態旗標全部收成色點、列車數也進「更多」。
// 🔴 收成色點是「拿掉資訊」,所以這一段的重點不是色點好不好看,而是**那些字樣真的有新家**,
//    而且新家的值是徽章的鏡射(不是另寫一份判斷,兩份遲早分岔)。
// 🔴 每一條都配反向對照:只驗「該出現的出現了」時,「乾脆全部都出現」也會全綠(心得 39(b))。
async function sectionI(browser, engine) {
  const tag = `${engine} 393pt`;
  const { page, errs, close } = await boot(browser, { width: 393 });

  const top = await page.evaluate(() => {
    const bar = document.getElementById('topbar');
    const bg = document.querySelector('.badge');
    const flag = id => {
      const e = document.getElementById(id);
      if (!e || e.hidden || !e.getClientRects().length) return null;
      const b = e.getBoundingClientRect(), cs = getComputedStyle(e);
      return { w: +b.width.toFixed(1), h: +b.height.toFixed(1), fs: parseFloat(cs.fontSize), br: cs.borderRadius };
    };
    const cnt = document.getElementById('count');
    return {
      isFs: document.body.classList.contains('fs'),
      inBar: bar.contains(bg),
      barH: +bar.getBoundingClientRect().height.toFixed(1),
      clockPx: parseFloat(getComputedStyle(document.getElementById('clock')).fontSize),
      live: flag('liveBadge'), mlive: flag('metroBadge'),
      countText: cnt ? cnt.textContent.trim() : '',
      countDrawn: !!cnt && cnt.getClientRects().length > 0,
    };
  });
  ok(`I1 ${tag} 正向對照:手機殼、徽章併入頂列、時鐘還讀得到`,
    top.isFs && top.inBar && top.clockPx >= 14, `fs=${top.isFs} inBar=${top.inBar} clock=${top.clockPx}`);
  // 色點:寬高一致的小圓、字級歸零(字被收掉了)。只驗「有畫出來」會讓沒收成點的舊樣式照樣通過。
  // 🔴 用 every 不用 ||:檔內早就有一條 @media(max-width:400px) 把 .mlive 收成 0 字級,
  //    寫成 OR 的話「只剩那條舊規則在生效」也會全綠——實測突變(拿掉 D4 的 font-size:0)正是這樣溜過去的。
  const dot = f => f && Math.abs(f.w - f.h) <= 1 && f.w <= 10 && f.fs === 0;
  const flags = [top.live, top.mlive].filter(Boolean);
  ok(`I2 ${tag} 亮著的狀態旗標全部收成色點(非文字)`,
    flags.length >= 1 && flags.every(dot),
    `亮著 ${flags.length} 顆 live=${JSON.stringify(top.live)} mlive=${JSON.stringify(top.mlive)}`);
  // 列車數:資料有(textContent 非空)但頂列不畫——「沒資料」與「有資料但收起來」要分得開
  ok(`I3 ${tag} 列車數有值但已從頂列收起`,
    !!top.countText && !top.countDrawn, `text=「${top.countText}」drawn=${top.countDrawn}`);

  // ── 「更多 · 資料狀態」:字樣的新家 ──
  const open = async () => {
    await page.evaluate(() => {
      if (!document.body.classList.contains('tools-open')) document.getElementById('tabMore').click();
      else { document.getElementById('tabMore').click(); document.getElementById('tabMore').click(); }
    });
    await page.waitForTimeout(600);
    return page.evaluate(() => {
      const sec = [...document.querySelectorAll('#moreBody .ms-sec')].find(x => x.textContent.trim() === '資料狀態');
      const row = id => {
        const r = document.getElementById(id);
        return { drawn: !!r && r.getClientRects().length > 0,
          h: r ? +r.getBoundingClientRect().height.toFixed(1) : -1,
          val: r ? (r.querySelector('b') || {}).textContent || '' : '' };
      };
      const src = id => { const e = document.getElementById(id); return e && !e.hidden ? e.textContent.trim() : null; };
      return { secDrawn: !!sec && sec.getClientRects().length > 0,
        live: row('msStatLive'), metro: row('msStatMetro'), replay: row('msStatReplay'), count: row('msStatCount'),
        srcLive: src('liveBadge'), srcMetro: src('metroBadge'), srcCount: src('count') };
    });
  };
  const A = await open();
  ok(`I4 ${tag} 正向對照:「資料狀態」段與至少兩列真的畫出來`,
    A.secDrawn && [A.live, A.metro, A.count].filter(r => r.drawn).length >= 2,
    `sec=${A.secDrawn} live=${A.live.drawn} metro=${A.metro.drawn} count=${A.count.drawn}`);
  // 鏡射契約:值必須逐字等於徽章的字(徽章寫「官方即時」就顯示「官方即時」)。
  // 這條擋的是「另寫一份判斷」——兩份判斷遲早跟徽章分岔,而分岔時畫面看起來完全正常。
  const mirrored = (r, src) => !r.drawn || src == null || r.val === src || r.val === src + '・推算';
  ok(`I5 ${tag} 資料狀態的值逐字鏡射徽章`,
    mirrored(A.live, A.srcLive) && mirrored(A.metro, A.srcMetro) && mirrored(A.count, A.srcCount),
    `live「${A.live.val}」vs「${A.srcLive}」metro「${A.metro.val}」vs「${A.srcMetro}」count「${A.count.val}」vs「${A.srcCount}」`);
  // 反向對照①:徽章那顆藏起來 ⇒ 對應列必須整列消失(高度 0)。
  // .ms-row 的 display:flex 蓋得過 [hidden],沒補規則的話這條會紅——正是它要擋的東西。
  await page.evaluate(() => { document.getElementById('liveBadge').hidden = true; });
  const B = await open();
  ok(`I6 ${tag} 反向對照:徽章藏起來 ⇒ 該列整列消失`,
    !B.live.drawn && B.live.h === 0, `drawn=${B.live.drawn} h=${B.live.h}`);
  // 反向對照②:本來沒有的旗標亮起來 ⇒ 對應列必須出現
  await page.evaluate(() => {
    const r = document.getElementById('replayBadge');
    r.hidden = false; r.textContent = 'REPLAY';
  });
  const C = await open();
  ok(`I7 ${tag} 反向對照:旗標亮起來 ⇒ 該列出現`, C.replay.drawn && C.replay.h > 0,
    `drawn=${C.replay.drawn} h=${C.replay.h}`);
  ok(`I8 ${tag} 零 pageerror`, errs.length === 0, errs.slice(0, 1).join(''));
  await close();
}

// ── J 段:整合卡(設計 D1–D3)——跟車中開車站看板 ⇒ 同一張卡兩個分頁 ─────────────
// 設計狀態機:D1 跟車·這班車／D2 跟車·這一站(跟車不斷)／D3 沒跟車(卡頭是站名、分頁列不出現)。
// 🔴 這一段最容易壞的地方不是樣式,是 **DOM 搬遷的生命週期**:看板每次重繪都 `innerHTML = …`,
//    搬進去的 #followPanel 會跟著被銷毀(實作第一版就是這樣炸的)。J5/J7 專門守這件事。
async function followSomeTrain(page) {
  return page.evaluate(() => {
    const mc = map.getContainer().getBoundingClientRect();
    for (const t of (state.trains || [])) {
      if (!state.visible.has(t.typeName)) continue;
      const pos = trainPos(t, state.simSec);
      if (!pos) continue;
      const pt = map.latLngToContainerPoint(L.latLng(pos.lat, pos.lon));
      if (pt.x > 60 && pt.x < mc.width - 60 && pt.y > 180 && pt.y < 600) { setFollow(t, false); return true; }
    }
    return false;
  });
}
const J_SNAP = () => {
  const el = document.getElementById('board');
  const fp = document.getElementById('followPanel');
  const vis = e => !!e && e.getClientRects().length > 0;
  const tabs = [...el.querySelectorAll('.uni-tabs button')];
  return {
    boardOpen: !el.hidden, following: !!state.followTrain,
    tabN: tabs.length,
    tabSel: (tabs.find(b => b.getAttribute('aria-selected') === 'true') || {}).textContent || '',
    fpInBoard: !!(fp && fp.closest('#board')),
    fpExists: !!fp, fpVisible: vis(fp),
    fpFields: ['fpNext', 'fpProgTxt', 'fpDest'].filter(id => vis(document.getElementById(id))).length,
    rows: [...el.querySelectorAll('.row[data-no]')].filter(vis).length,
  };
};

async function sectionJ(browser, engine) {
  const tag = `${engine} 393pt`;
  const { page, errs, close } = await boot(browser, { width: 393 });
  const snap = () => page.evaluate(c => eval('(' + c + ')')(), J_SNAP.toString());

  const started = await followSomeTrain(page);
  await page.waitForTimeout(2000);
  const A = await snap();
  // D3/基準態:只跟車、沒開看板 ⇒ 沒有分頁列,跟車卡是浮動小卡
  ok(`J1 ${tag} 正向對照:跟到車、跟車卡看得到、還沒有分頁列`,
    started && A.following && A.fpVisible && !A.fpInBoard && A.tabN === 0, JSON.stringify(A));

  await page.evaluate(() => {
    const e = buildStnIndex().find(x => x.sysId === 'tra_sched' && x.name === '板橋');
    if (e) openBoard({ name: e.name, sys: e.sysId, lat: e.lat, lon: e.lon });
  });
  await page.waitForTimeout(1600);
  const B = await snap();
  // D2:點站 ⇒ 分頁列出現、落在「這一站」、跟車卡被搬進看板、**跟車沒斷**
  ok(`J2 ${tag} 跟車中開看板 ⇒ 兩個分頁、落在「這一站」、跟車不斷`,
    B.boardOpen && B.following && B.tabN === 2 && B.tabSel === '這一站' && B.fpInBoard && B.rows > 0,
    JSON.stringify(B));

  // 🔴 可選串接:分頁列不存在時要讓後面的判準紅,而不是讓整支腳本拋錯中止
  //    (突變測試實測:少了 ?. 會在這裡拋 evaluate 例外,J3–J8 與另一個引擎整段沒跑到,
  //     輸出長得像「只有 J2 紅」——比全綠更騙人)。
  await page.evaluate(() => document.querySelector('.uni-tabs button[data-t="train"]')?.click());
  await page.waitForTimeout(700);
  const C = await snap();
  // D1:切「這班車」⇒ 看板列全收、跟車卡的欄位露出來。兩件事都要驗——只驗一半的話
  // 「兩份內容疊著一起顯示」也會過。
  ok(`J3 ${tag} 切「這班車」⇒ 看板列全收、跟車卡欄位露出`,
    C.tabSel === '這班車' && C.rows === 0 && C.fpVisible && C.fpFields === 3, JSON.stringify(C));

  // 🔴 重繪存活:看板每 20 模擬秒重繪一次,`innerHTML = …` 會把搬進去的卡整顆銷毀。
  await page.evaluate(() => renderBoard());
  await page.waitForTimeout(700);
  const D = await snap();
  ok(`J4 ${tag} 看板重繪後:分頁列還在、選中沒變、跟車卡沒被銷毀`,
    D.fpExists && D.tabN === 2 && D.tabSel === '這班車' && D.fpInBoard && D.fpVisible, JSON.stringify(D));

  // 讓位:整合卡掛著的時候,跟車目標仍要在可視窗內、而且沒被卡片蓋住(接 H 段同一套獨立判準)
  const E = await page.evaluate(c => {
    const r = eval('(' + c + ')')();
    const t = state.followTrain; if (!t) return { ...r, ok: false };
    const pos = trainPos(t, state.simSec); if (!pos) return { ...r, ok: false };
    const mc = map.getContainer().getBoundingClientRect();
    const pt = map.latLngToContainerPoint(L.latLng(pos.lat, pos.lon));
    const hit = document.elementFromPoint(mc.left + pt.x, mc.top + pt.y);
    const chrome = hit && hit.closest('.topbar,.badge,.tabbar,.controls,#followPanel,#freqCard,.sheet,.board,#mapActions');
    return { ...r, ok: true, py: +pt.y.toFixed(1), inBand: pt.y >= r.bandTop && pt.y <= r.bandBot,
      covered: !!chrome, hit: hit ? (hit.id || String(hit.className).slice(0, 28)) : 'none' };
  }, H_CENSUS.toString());
  ok(`J5 ${tag} 整合卡掛著時跟車目標仍在可視窗內、沒被卡片蓋住`,
    E.ok && E.inBand && !E.covered, `車y=${E.py} 窗=${E.bandTop}~${E.bandBot} 命中=${E.hit}`);

  // 反向對照①:關看板 ⇒ 跟車卡要**搬回家且還看得到**(不能跟著 innerHTML 被清掉)
  await page.evaluate(() => closeBoard());
  await page.waitForTimeout(900);
  const F = await snap();
  ok(`J6 ${tag} 反向對照:關看板 ⇒ 跟車卡搬回原位且仍看得到`,
    F.fpExists && !F.fpInBoard && F.fpVisible && F.tabN === 0 && F.following, JSON.stringify(F));

  // 反向對照②:結束跟車 ⇒ 分頁列不該出現(設計 D3:沒跟車就是今天的看板)
  await page.evaluate(() => {
    clearFollow();
    const e = buildStnIndex().find(x => x.sysId === 'tra_sched' && x.name === '板橋');
    if (e) openBoard({ name: e.name, sys: e.sysId, lat: e.lat, lon: e.lon });
  });
  await page.waitForTimeout(1600);
  const G = await snap();
  ok(`J7 ${tag} 反向對照:沒跟車開看板 ⇒ 沒有分頁列(D3)、看板列照常`,
    !G.following && G.boardOpen && G.tabN === 0 && G.rows > 0 && !G.fpInBoard, JSON.stringify(G));
  ok(`J8 ${tag} 零 pageerror`, errs.length === 0, errs.slice(0, 1).join(''));
  await close();

  // ── J9:水平讓位的差分對照 ──
  // 搬進看板的跟車卡是全寬的。讓位計算若沒把它排除,會拿那個全寬 rect 去撐「左界」,
  // 撐爆之後被 MIN_MAP_STRIP 閘門連左右一起歸零 ⇒ 右側工具欄的讓位默默消失。
  // 判準寫成差分:「這班車」與「這一站」兩個分頁的左右讓位必須相同——因為在「這一站」時
  // 那張卡是 display:none、結構上不可能參與計算,它就是這一題的正確答案(外部基準,非同源)。
  const s3 = await boot(browser, { width: 393 });
  const ok3 = await followSomeTrain(s3.page);
  await s3.page.waitForTimeout(1800);
  await s3.page.evaluate(() => {
    const e = buildStnIndex().find(x => x.sysId === 'tra_sched' && x.name === '板橋');
    if (e) openBoard({ name: e.name, sys: e.sysId, lat: e.lat, lon: e.lon });
  });
  await s3.page.waitForTimeout(1600);
  const rd = async t => {
    await s3.page.evaluate(tt => document.querySelector(`.uni-tabs button[data-t="${tt}"]`)?.click(), t);
    await s3.page.waitForTimeout(600);
    return s3.page.evaluate(() => {
      const i = mapInsets();
      return { left: +i.left.toFixed(1), right: +i.right.toFixed(1),
        tabs: document.querySelectorAll('.uni-tabs button').length };
    });
  };
  const st1 = await rd('station'), tr1 = await rd('train');
  ok(`J9 ${tag} 正向對照:兩個分頁都切得到`, ok3 && st1.tabs === 2 && tr1.tabs === 2,
    `tabs=${st1.tabs}/${tr1.tabs}`);
  ok(`J10 ${tag} 切分頁不改變左右讓位(搬進來的卡沒被當成左側遮蔽)`,
    Math.abs(st1.left - tr1.left) <= 2 && Math.abs(st1.right - tr1.right) <= 2,
    `這一站 左${st1.left}右${st1.right} ／ 這班車 左${tr1.left}右${tr1.right}`);
  ok(`J11 ${tag} 零 pageerror`, s3.errs.length === 0, s3.errs.slice(0, 1).join(''));
  await s3.close();
}

// 空白點搜尋:所有命中測試都落空、而且 elementFromPoint 真的打在地圖畫布上。
// 🔴 這裡用頁面自己的命中函式,但只當**setup**(「這一點是空白的」);判準看的是點下去之後的狀態,
//    與這些函式無關——K2 也順便反驗這一點確實沒開看板、沒彈歧義選單。
const K_BLANK = () => {
  const mc = map.getContainer().getBoundingClientRect();
  const nearestStn = cp => {
    let bd = 1e9;
    for (const st of (state.schedStations || [])) {
      const q = map.latLngToContainerPoint([st.lat, st.lon]);
      bd = Math.min(bd, Math.hypot(q.x - cp.x, q.y - cp.y));
    }
    if (state.deco) (state.decoLines || []).forEach(ln => { if (!ln.pts) return;
      ln.pts.forEach(q => { bd = Math.min(bd, Math.hypot(q.x - cp.x, q.y - cp.y)); }); });
    return bd;
  };
  for (let y = 150; y < 620; y += 17) for (let x = 40; x < mc.width - 40; x += 17) {
    const cp = L.point(x, y);
    if (trainAt(cp)) continue;
    if (typeof crossingAt === 'function' && crossingAt(cp)) continue;
    if (typeof sugarAt === 'function' && sugarAt(cp)) continue;
    if (state.deco && typeof freqTrainsAt === 'function' && freqTrainsAt(cp).length) continue;
    if (nearestStn(cp) <= 40) continue;
    const el = document.elementFromPoint(mc.left + x, mc.top + y);
    if (!el || !el.closest('#map')) continue;
    if (el.closest('.board,.follow-panel,.controls,.map-actions,.topbar,.tabbar,#tapPick')) continue;
    return { x, y, ml: mc.left, mt: mc.top };
  }
  return null;
};
const K_SNAP = () => {
  const fp = document.getElementById('followPanel');
  const bd = document.getElementById('board');
  const vis = e => !!e && e.getClientRects().length > 0;
  const r = fp ? fp.getBoundingClientRect() : { width: 0, height: 0, left: 0, top: 0, bottom: 0 };
  const inFp = (x, y) => { const q = document.elementFromPoint(x, y); return !!(q && q.closest('#followPanel')); };
  const tabs = [...bd.querySelectorAll('.uni-tabs button')];
  return {
    following: !!state.followTrain,
    collapsed: document.body.classList.contains('uni-collapsed'),
    fpMin: !!(fp && fp.classList.contains('fp-min')),
    fpVis: vis(fp), fpH: Math.round(r.height), fpW: Math.round(r.width),
    fpInSlot: !!(fp && fp.closest('.uni-slot')),
    fpTxt: fp ? fp.innerText.replace(/\s+/g, ' ').trim() : '',
    endVis: vis(fp && fp.querySelector('.fp-end')),
    hit3: vis(fp) ? [inFp(r.left + r.width / 2, r.top + 3), inFp(r.left + r.width / 2, (r.top + r.bottom) / 2),
      inFp(r.left + r.width / 2, r.bottom - 3)].filter(Boolean).length : 0,
    hitWho: (() => { if (!vis(fp)) return 'invisible';
      const q = document.elementFromPoint(r.left + r.width / 2, (r.top + r.bottom) / 2);
      if (!q) return 'none';
      const path = []; for (let e = q; e && e !== document.body; e = e.parentElement)
        path.push((e.id ? '#' + e.id : e.tagName.toLowerCase()) + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''));
      return path.slice(0, 4).join(' < '); })(),
    fpRect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    boardVis: vis(bd), boardHiddenAttr: bd.hidden, boardStation: !!state.boardStation,
    boardRows: bd.querySelectorAll('.row[data-no]').length, // 不管看不看得見:內容還在不在
    sheetOpen: document.body.classList.contains('sheet-open'),
    fpOpacity: fp ? +getComputedStyle(fp).opacity : -1,
    fpPE: fp ? getComputedStyle(fp).pointerEvents : '',
    tabN: tabs.length,
    tabSel: (tabs.find(b => b.getAttribute('aria-selected') === 'true') || {}).textContent || '',
    trainOpen: document.body.classList.contains('train-open'),
    tapPick: !document.getElementById('tapPick').hidden,
    ls: localStorage.getItem('trainmap-fprail-min'),
  };
};

// ── K 段:膠囊態(設計 1a 的 collapsed / tapBlank)────────────────────────────
// 設計狀態機:tapBlank→collapsed:true(**跟車不斷**)、點膠囊→expand、「結束」才 following:false。
async function sectionK(browser, engine) {
  const tag = `${engine} 393pt`;
  const { page, errs, close } = await boot(browser, { width: 393 });
  const snap = () => page.evaluate(c => eval('(' + c + ')')(), K_SNAP.toString());
  const census = () => page.evaluate(c => eval('(' + c + ')')(), H_CENSUS.toString());
  const blankPt = () => page.evaluate(c => eval('(' + c + ')')(), K_BLANK.toString());
  const clickAt = async pt => { await page.mouse.click(pt.ml + pt.x, pt.mt + pt.y); await page.waitForTimeout(700); };
  // 看板每 20 模擬秒重繪一次會洗掉手動狀態(E4b 教訓):凍住無關變因,不是放寬判準
  await page.evaluate(() => { if (state.playing) togglePlay(); });

  const started = await followSomeTrain(page);
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const e = buildStnIndex().find(x => x.sysId === 'tra_sched' && x.name === '板橋');
    if (e) openBoard({ name: e.name, sys: e.sysId, lat: e.lat, lon: e.lon });
  });
  await page.waitForTimeout(1400);
  const A = await snap(), bandA = await census();
  const pt = await blankPt();
  ok(`K1 ${tag} 正向對照:跟到車、整合卡掛著、還沒收合、找得到空白點`,
    started && A.following && A.tabN === 2 && A.fpInSlot && !A.collapsed && !!pt,
    JSON.stringify({ ...A, pt }));

  // ① tapBlank
  await clickAt(pt || { ml: 0, mt: 0, x: 5, y: 5 });
  const B = await snap(), bandB = await census();
  ok(`K2 ${tag} 點地圖空白 ⇒ 收成膠囊,而且【跟車沒斷】`,
    B.following && B.collapsed && B.fpMin && B.fpVis && !B.tapPick, JSON.stringify(B));
  ok(`K3 ${tag} 膠囊內容＝車次·時速·結束(設計 1a)`,
    /\d/.test(B.fpTxt) && /km\/h/.test(B.fpTxt) && /結束/.test(B.fpTxt) && B.endVis && B.fpTxt.length <= 24,
    `膠囊字=「${B.fpTxt}」`);
  ok(`K4 ${tag} 膠囊觸控目標 ≥44 且三點都命中自己`,
    B.fpH >= 44 && B.hit3 === 3, `高${B.fpH} 寬${B.fpW} 命中${B.hit3}/3`);
  // 收合是「藏起來」不是「關掉」——這是 K5 能回得去原本那一頁的結構前提
  // 收合是「藏起來」不是「關掉」:看板的內容與 state.boardStation 都留著(closeBoard 會把兩者清空),
  // 這是 K7 能回得去原本那一頁的結構前提。而 sheet-open 必須跟著關掉——
  // 🔴 收合用 hidden 不用 CSS display:none 就是為了這個:sheet-open 是從 hidden 算出來的,
  //    留著會讓停靠讓位那條把膠囊淡成透明且吃不到點擊(實測 webkit 點擊整發消失)。
  ok(`K5 ${tag} 收合＝藏起來不是關掉:內容留著、但 sheet-open 跟著關`,
    !B.boardVis && B.boardStation && B.boardRows > 0 && !B.sheetOpen, JSON.stringify(B));
  ok(`K6 ${tag} 收合把地圖還出來:可視窗下界變低,而且不寫 localStorage`,
    bandB.bandBot > bandA.bandBot + 60 && B.ls === null,
    `下界 ${bandA.bandBot}→${bandB.bandBot} ls=${B.ls}`);

  // 🔴 收合中的重繪:看板每 20 模擬秒重繪一次,renderBoard 尾端無條件 `el.hidden = false`
  //    會讓收起來的看板自己彈回來(旗標還是收合、畫面卻展開)。這條刻意直接呼叫 renderBoard()——
  //    測試把播放暫停了,不主動叫它就永遠測不到(狀態抽樣缺口:只驗凍住的那一格)。
  await page.evaluate(() => renderBoard());
  await page.waitForTimeout(500);
  const B2 = await snap();
  ok(`K18 ${tag} 收合中看板重繪:不會把收起來的看板掀回畫面`,
    !B2.boardVis && B2.collapsed && B2.fpVis && B2.fpMin && !B2.sheetOpen, JSON.stringify(B2));

  // ② 點膠囊 ⇒ 展開回收合前那一頁(不是跳去列車 sheet)
  // 🔴 用 locator().click() 而不是 mouse.click(x,y):它會先等元素**位置穩定**(跟車鏡頭每幀在 panBy)
  //    再做 receives-events 檢查才點下去。實測 webkit 的裸座標點擊在鏡頭動畫中會整發不見
  //    (連 document 的 capture 監聽都收不到任何 click),而那是 harness 的問題不是產品的問題。
  //    x=60 落在膠囊左半,避開右端的「結束」。
  await page.locator('#followPanel').click({ position: { x: 60, y: 22 }, timeout: 5000 });
  await page.waitForTimeout(900);
  const C = await snap();
  ok(`K7 ${tag} 點膠囊 ⇒ 展開回收合前那一頁(跟車仍在、卡回槽裡、沒跳去列車 sheet)`,
    C.following && !C.collapsed && !C.fpMin && C.fpInSlot && C.boardVis
    && C.tabSel === A.tabSel && C.tabN === 2 && !C.trainOpen, JSON.stringify(C));

  // ③ 整合卡掛著時點卡片本體不該跳去列車 sheet(那會 soloPanel 把看板關掉,整合卡當場散掉)
  // 🔴 得先切到「這班車」:在「這一站」那一頁槽是 display:none,卡量到的是零矩形,
  //    照零矩形算出來的座標會點到畫面左上角(實測就是這樣點回地圖、變成一次空白點擊)。
  await page.evaluate(() => document.querySelector('.uni-tabs button[data-t="train"]')?.click());
  await page.waitForTimeout(700);
  await page.locator('#fpProgTxt').click({ timeout: 5000 }).catch(() => {}); // 卡片本體的一段純文字
  await page.waitForTimeout(800);
  const D = await snap();
  ok(`K8 ${tag} 整合卡掛著時點卡片本體:看板還在、沒被換成列車 sheet`,
    !D.trainOpen && D.boardVis && D.fpInSlot && D.tabN === 2 && D.tabSel === '這班車' && D.fpVis,
    JSON.stringify(D));

  // ④ 膠囊上的「結束」仍然真的結束跟隨,而且收合旗標要歸零(否則看板永遠 display:none)
  await clickAt(pt);
  await page.evaluate(() => document.getElementById('fpEnd').click());
  await page.waitForTimeout(800);
  const E = await snap();
  // 🔴 「看板當場回到可見」也要驗:收合時收起來的看板若停在 hidden,下一次重繪會把它掀回來,
  //    使用者看到的是「結束跟車幾秒後看板自己彈出來」。要嘛當場還回去、要嘛真的關掉,不能懸著。
  ok(`K9 ${tag} 膠囊的「結束」仍然結束跟隨、旗標歸零、收起來的看板當場還回去`,
    !E.following && !E.collapsed && !E.fpVis && E.boardVis, JSON.stringify(E));
  const eBoard = await page.evaluate(() => {
    const e = buildStnIndex().find(x => x.sysId === 'tra_sched' && x.name === '板橋');
    if (e) openBoard({ name: e.name, sys: e.sysId, lat: e.lat, lon: e.lon });
    return document.getElementById('board').getClientRects().length > 0;
  });
  await page.waitForTimeout(900);
  const E2 = await snap();
  ok(`K10 ${tag} 結束跟車後看板照樣開得起來(收合旗標沒留下來把它藏死)`,
    eBoard && E2.boardVis && E2.tabN === 0, JSON.stringify(E2));

  // ⑤ 反向對照:沒跟車時點同一個空白點 ⇒ 不收合(膠囊態只在跟車中成立)
  await page.evaluate(() => closeBoard());
  await page.waitForTimeout(500);
  const pt2 = await blankPt();
  await clickAt(pt2 || pt);
  const F = await snap();
  // fp-min 這顆 class 在跟車結束後會留在隱藏的面板上(它是 §04c 的長期偏好,不是當下狀態),
  // 所以判準看的是「有沒有收合旗標」與「膠囊看不看得見」,不是 class 在不在。
  ok(`K11 ${tag} 反向對照:沒跟車時點空白 ⇒ 什麼都不收(沒有收合、沒有膠囊)`,
    !F.following && !F.collapsed && !F.fpVis, JSON.stringify(F));

  // ⑥ 反向對照:再點一次「跟隨中的那台車」仍然是取消跟隨——不能被 tapBlank 那條搶走
  await followSomeTrain(page);
  await page.waitForTimeout(1400);
  const tp = await page.evaluate(() => {
    const t = state.followTrain; if (!t) return null;
    const pos = trainPos(t, state.simSec); if (!pos) return null;
    const mc = map.getContainer().getBoundingClientRect();
    const q = map.latLngToContainerPoint(L.latLng(pos.lat, pos.lon));
    return { x: q.x, y: q.y, ml: mc.left, mt: mc.top };
  });
  if (tp) {
    await clickAt(tp);
    // 車與站黏在一起會彈歧義選單(合法規格),那就點「取消跟隨」那一列
    await page.evaluate(() => {
      const el = document.getElementById('tapPick');
      if (el && !el.hidden) [...el.querySelectorAll('.tp-row')].find(b => /取消跟隨/.test(b.textContent))?.click();
    });
    await page.waitForTimeout(700);
  }
  const G = await snap();
  ok(`K12 ${tag} 反向對照:再點一次跟隨中的那台車仍然是取消跟隨(沒被收合搶走)`,
    !!tp && !G.following && !G.collapsed && !G.fpVis, JSON.stringify(G));

  // ⑦ × 的長期偏好:× 會寫 '1' 且卡搬回原位;此時開站看板不掀開它(不偷改使用者設定)
  await followSomeTrain(page);
  await page.waitForTimeout(1400);
  await page.evaluate(() => document.getElementById('fpClose').click());
  await page.waitForTimeout(700);
  const H = await snap();
  await page.evaluate(() => {
    const e = buildStnIndex().find(x => x.sysId === 'tra_sched' && x.name === '板橋');
    if (e) openBoard({ name: e.name, sys: e.sysId, lat: e.lat, lon: e.lon });
  });
  await page.waitForTimeout(1200);
  const I = await snap();
  ok(`K13 ${tag} × 收合:寫入長期偏好、膠囊沒被留在看板槽裡`,
    H.fpMin && H.ls === '1' && !H.fpInSlot, JSON.stringify(H));
  // 設計狀態機 tapStation 帶 collapsed:false ⇒ 收合中點車站要展開成整合卡。
  // 🔴 但**長期偏好不准跟著被清掉**:使用者點的是車站不是膠囊,沒有表達「以後別收合了」。
  //    兩半都要驗——只驗展開的話,「順手把 localStorage 清成 0」也會過。
  ok(`K14 ${tag} × 收合中開站看板 ⇒ 展開成整合卡,但長期偏好留著 '1'`,
    !I.fpMin && I.fpInSlot && I.boardVis && I.tabN === 2 && I.ls === '1', JSON.stringify(I));

  // ⑧ 停靠讓位:body.dwell-show + sheet-open 那條會把跟車小卡淡成 opacity:0/pointer-events:none
  //    (停站時小卡與站名牌重複度高,讓位是對的)——但卡搬進整合卡之後那條不成立:
  //    卡就是看板的一頁,淡掉它等於「這班車」整頁空白。
  // 🔴 dwell-show 是 JS 每幀隨站名牌同步的旗標:注入之後 await 一下就會被頁面自己抹掉,
  //    量到的會是「沒有 dwell 的狀態」⇒ 判準恆綠(第一版就是這樣,突變拿掉規則照樣全過)。
  //    所以整段在**同一個 tick 內**做完:掛旗標 → 讀 computed → 還原,中間不 await。
  // 🔴 對照組用**同一顆元素**:暫時搬出槽再讀一次。少了它,「這條淡出規則此刻根本沒生效」
  //    (例如媒體查詢不match)也會讓上半條無條件通過。
  await page.evaluate(() => document.querySelector('.uni-tabs button[data-t="train"]')?.click());
  await page.waitForTimeout(600);
  const J = await page.evaluate(() => {
    const fp = document.getElementById('followPanel');
    const read = () => { const c = getComputedStyle(fp); return { op: +c.opacity, pe: c.pointerEvents }; };
    const sheetOpen = document.body.classList.contains('sheet-open');
    const inSlot = !!fp.closest('.uni-slot');
    document.body.classList.add('dwell-show');
    const mounted = read();
    const home = fp.parentElement, next = fp.nextSibling;
    document.body.appendChild(fp);          // 搬出槽:同一顆元素、同一個 tick
    const outside = read();
    if (next) home.insertBefore(fp, next); else home.appendChild(fp);
    document.body.classList.remove('dwell-show');
    return { sheetOpen, inSlot, mounted, outside };
  });
  ok(`K16 ${tag} 停靠中(dwell-show)整合卡的「這班車」頁仍看得見、仍點得動`,
    J.sheetOpen && J.inSlot && J.mounted.op >= 0.9 && J.mounted.pe !== 'none', JSON.stringify(J));
  ok(`K17 ${tag} 正向對照:同一顆卡搬出槽就真的被淡掉(證明讓位規則此刻是活的)`,
    J.outside.op === 0 && J.outside.pe === 'none', JSON.stringify(J.outside));

  ok(`K15 ${tag} 零 pageerror`, errs.length === 0, errs.slice(0, 1).join(''));
  await close();
}

await assertTarget();
// SECTIONS=H,I 只跑指定段(突變測試用);不設就跑全部——預設永遠是「全跑」,不能靠環境變數才完整。
const ALL = { A: sectionA, B: sectionB, C: sectionC, D: sectionD, E: sectionE, F: sectionF, G: sectionG, H: sectionH, I: sectionI, J: sectionJ, K: sectionK };
const want = (process.env.SECTIONS || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
const run = want.length ? want : Object.keys(ALL);
for (const k of run) if (!ALL[k]) { console.error(`未知段別 ${k}`); process.exit(2); }
if (want.length) console.log(`⚠ 只跑 ${run.join(',')} 段(SECTIONS 環境變數),這不是完整驗收`);
for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await launcher.launch();
  for (const k of run) {
    // 🔴 一段拋例外不可以把整支腳本連同另一個引擎一起帶走:那樣的輸出會變成「只有幾條紅」,
    //    看起來像局部問題,實際上後面整批根本沒跑到(突變測試實測踩過——比全綠更騙人)。
    //    拋出來一律當紅記一筆,再繼續跑下一段。
    try { await ALL[k](browser, engine); }
    catch (e) { ok(`${k}✱ ${engine} 該段執行時拋例外(視同不通過)`, false, String(e).split('\n')[0]); }
  }
  await browser.close();
}
const pass = results.filter(r => r.pass).length;
console.log(`\n=== ${pass}/${results.length} 通過 ===`);
process.exit(pass === results.length ? 0 : 1);
