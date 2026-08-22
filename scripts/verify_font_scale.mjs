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

async function boot(browser, { width = 393, tier = 'std', query = '', scheme } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    ...(scheme ? { colorScheme: scheme } : {}),   // 不傳＝沿用 Playwright 預設,既有各段行為不變
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
  // ── 展開態要跨重繪存活 ────────────────────────────────────────────────────
  // 看板每 20 模擬秒 `el.innerHTML = …` 整個重建,只掛在 DOM 上的 .rx 會被洗掉:使用者剛按「›」
  // 叫回來的車種與方向自己收回去(高倍速下不到半秒)。這裡**直接呼叫 renderBoard()** 打一次重繪,
  // 不等時間走到那一拍——那是機率,判準不能架在機率上(E4b 原本就是這樣偶發假紅的)。
  const rd = await page.evaluate(() => {
    const key = r => (r.dataset.no || '') + '|' + (r.dataset.sys || '');
    const shown = el => !!(el && el.getClientRects().length);
    const before = [...document.querySelectorAll('#board .row[data-no]')];
    const openBefore = before.filter(r => r.classList.contains('rx')).map(key);
    renderBoard();
    const after2 = [...document.querySelectorAll('#board .row[data-no]')];
    const openAfter = after2.filter(r => r.classList.contains('rx')).map(key);
    const row = after2.find(r => r.classList.contains('rx'));
    return {
      rebuilt: before.length > 0 && before.every(r => !r.isConnected), // 舊節點真的被換掉了
      n: after2.length, openBefore, openAfter,
      destShown: !!(row && shown(row.querySelector('.ty')) && shown(row.querySelector('.to'))),
    };
  });
  const sameKeys = (a, b) => a.length === b.length && a.every(k => b.includes(k));
  // 🔴 正向對照:沒有這條,「renderBoard() 根本沒重建任何東西」也會讓下面兩條無條件成立
  ok(`E4c ${engine} 正向對照:renderBoard() 真的把整批列重建了(舊節點已離開文件)`,
    rd.rebuilt && rd.n > 1, JSON.stringify({ 重建: rd.rebuilt, 重繪後列數: rd.n }));
  // 展開的是不是同一班車要逐鍵比(車次|系統),不是只數「有幾列展開」
  ok(`E4d ${engine} 重繪之後展開中的那一列還是展開的(車種與方向仍在畫面上)`,
    rd.openBefore.length === 1 && sameKeys(rd.openBefore, rd.openAfter) && rd.destShown,
    JSON.stringify(rd));
  // 🔴 對照組:只有被點過的那一列該展開。少了這條,「每一列都無條件掛 .rx」也能通過上面那條。
  ok(`E4e ${engine} 對照組:沒展開過的列不會自己長出展開態`,
    rd.openAfter.every(k => rd.openBefore.includes(k)) && rd.n > rd.openAfter.length,
    JSON.stringify({ 展開: rd.openAfter, 原本展開: rd.openBefore, 總列數: rd.n }));
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
  // 開看板**之前**先量一次可視窗——H7 要比的是兩個狀態,不是拿看板自己的位置驗看板自己(見下)。
  const P = await s2.page.evaluate(c => eval('(' + c + ')')(), H_CENSUS.toString());
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
    // 🔴 看板是「內容撐高、上限 46%」不是固定 46%:深夜班次少的時候整張只有 187px(實測 00:35 的
    //    板橋只剩 1 班),可視窗下緣自然掉到 550。所以下面那條判準不能寫死一個 px 門檻。
    const bd = document.getElementById('board'), br = bd.getBoundingClientRect();
    return { ...r, ok: true, py: +pt.y.toFixed(1), sheetUp: r.seen.includes('sheet'),
      inBand: pt.y >= r.bandTop && pt.y <= r.bandBot,
      sheetTop: Math.round(br.top - mc.top), sheetH: Math.round(br.height), rows: bd.querySelectorAll('.row').length,
      covered: !!chrome, hit: hit ? (hit.id || String(hit.className).slice(0, 28)) : 'none' };
  }, H_CENSUS.toString());
  // 正向對照:看板真的開著、而且它真的吃進「開板前看得到的地圖」(否則這一格跟 H2 是同一個情境)。
  // 🔴 兩個寫法都試過、都不能用:
  //   ① 手打 `bandBot < 520` —— 看板是**內容撐高、上限 46%**,深夜班次少時整張只有 187px
  //      (實測 00:35 的板橋只剩 1 班,下緣自然掉到 550) ⇒ 判準跟著環境假紅(同 G6 那次)。
  //   ② 改成「下緣 ≤ 看板頂緣」—— **那是恆真的**:census 的 bandBot 本來就是從看板頂緣算出來的
  //      (bandBot = 頂緣 − 8),等於拿看板自己的位置驗看板自己(心得 29 同源)。實測把看板整個
  //      translateY(100%) 推出畫面,②照樣綠。
  // 所以判準改成**跨狀態比較**:看板頂緣要落在「開板前的可視窗下緣」之上(真的侵入原本看得到的
  // 地圖),而且下緣真的縮了。兩個數字來自兩次獨立量測,沒有共用推導。
  ok(`H7 ${tag} 正向對照:跟車中開得起看板,而且看板真的吃進開板前看得到的地圖`,
    // (班次列數只印不判:深夜 0 班、白天十幾班都是正常的營運狀態,不是版面回歸)
    started && S.ok && S.sheetUp && P.bandBot > 0 &&
    S.sheetTop < P.bandBot && S.bandBot < P.bandBot,
    `${S.why || ''} sheet=${S.sheetUp} 開板前下緣=${P.bandBot} 開板後下緣=${S.bandBot} ` +
    `看板頂緣=${S.sheetTop} 看板高=${S.sheetH}(班次列 ${S.rows})`);
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

const L_SNAP = () => {
  const bd = document.getElementById('board');
  const fp = document.getElementById('followPanel');
  const tc = document.getElementById('trainCard');
  const vis = e => !!e && e.getClientRects().length > 0;
  const h = id => { const e = document.getElementById(id); const r = e && e.getBoundingClientRect();
    return r ? Math.round(r.height) : 0; };
  // 🔴 量「這一段在不在」要量整段(標題＋內容),不要量內層清單:旅程日誌的內層本來被釘成 88px
  //    的捲動盒,拿它當基準等於把「憑空留 88px 白」寫進判準;拿掉那顆盒子之後空日誌只有一行。
  const hSel = sel => { const e = document.querySelector(sel); const r = e && e.getBoundingClientRect();
    return r ? Math.round(r.height) : 0; };
  const hint = fp && fp.querySelector('.uni-more');
  const hr = hint ? hint.getBoundingClientRect() : null;
  return {
    following: !!state.followTrain,
    tabSel: (([...bd.querySelectorAll('.uni-tabs button')].find(b => b.getAttribute('aria-selected') === 'true')) || {}).textContent || '',
    fpInSlot: !!(fp && fp.closest('.uni-slot')),
    tcInFp: !!(tc && tc.closest('#followPanel')), tcVis: vis(tc),
    intro: h('tcIntro'), events: hSel('#followPanel .tc-events'), spark: h('tcSpark'), stops: h('tcStops'),
    eventsNote: !!document.querySelector('#followPanel #tcEvents')?.textContent.trim(),
    stopRows: document.querySelectorAll('#tcStops .tc-st').length,
    stopsHidden: !!(document.getElementById('tcStops') || {}).hidden,
    // 單一捲軸:看板自己捲,卡不可以再捲一層
    boardScroll: bd.scrollHeight - bd.clientHeight,
    // 🔴 「卡自己不捲」要看它**能不能**捲(overflow/max-height),不是量 scrollHeight 差幾 px:
    //    邊框與內距會讓它恆差 1–2px,拿數字當門檻只是換一個會漂移的魔術數字(心得 35)。
    fpOverflowY: fp ? getComputedStyle(fp).overflowY : '',
    fpMaxH: fp ? getComputedStyle(fp).maxHeight : '',
    boardOverflowY: getComputedStyle(bd).overflowY,
    // 🔴 巢狀捲動不是只看卡本身:卡**裡面**任何一個能捲的盒子都會截住手指(桌面併卡那條把
    //    旅程日誌釘成 88px 的捲動盒,就是這樣躲過只看 #followPanel 的判準)。整個槽掃一遍。
    nestedScrollers: (() => { const slot = bd.querySelector('.uni-slot'); if (!slot) return [];
      // 判「能不能捲」而不是「此刻有沒有溢出」:日誌空著的時候那顆 88px 盒子量不到溢出,
      // 但它還是會在日誌長出來的那天把手指截住——結構性的東西要用結構性判準(心得 35)。
      return [...slot.querySelectorAll('*')].filter(e => {
        const oy = getComputedStyle(e).overflowY;
        return oy === 'auto' || oy === 'scroll';
      }).map(e => e.id || e.className || e.tagName).slice(0, 4); })(),
    boardTop: Math.round(bd.scrollTop),
    size: bd.classList.contains('expand') ? 'large' : bd.classList.contains('sheet-small') ? 'small' : 'medium',
    hintVis: vis(hint), hintH: hr ? Math.round(hr.height) : 0,
    hintHit: hr && vis(hint) ? (() => { const q = document.elementFromPoint(hr.left + hr.width / 2, (hr.top + hr.bottom) / 2);
      return !!(q && q.closest('.uni-more')); })() : false,
    hintTxt: hint ? hint.textContent.replace(/\s+/g, ' ').trim() : '',
    // 🔴 getClientRects().length>0 對 opacity:0 的元素照樣是真——契約③(body.sheet-full 把跟隨小卡
    //    整張淡出)就是這樣穿過 L6 的:分頁列還在、卡也還在槽裡,只有內容看不見。改量兩件事:
    //    卡到根的累乘不透明度、以及卡內容的中心點打到的是不是卡自己(淡出那條連 pointer-events 一起關)。
    fpOpacity: fp ? (() => { let o = 1, n = fp; while (n && n.nodeType === 1) { o *= parseFloat(getComputedStyle(n).opacity || '1'); n = n.parentElement; } return +o.toFixed(3); })() : 0,
    cardHit: (() => { const e = document.getElementById('tcIntro') || document.getElementById('fpProgTxt');
      if (!e) return false; const r = e.getBoundingClientRect();
      if (!(r.width > 2 && r.height > 2)) return false;
      const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
      const y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
      const q = document.elementFromPoint(x, y); return !!(q && q.closest('#followPanel')); })(),
  };
};

// 🔴 像素證據(不需要解 PNG):同一塊區域拍兩張——原樣一張、把槽 visibility:hidden 一張。
//    兩張逐 byte 相同 ⇒ 那塊區域根本沒有畫任何東西(整張透明/被蓋住)。visibility 不動版面,
//    所以背景與周邊完全不變,差異只可能來自槽自己。L 段開頭已暫停播放,背景是靜止的。
async function slotPaints(page) {
  const r = await page.evaluate(() => { const s = document.querySelector('.uni-slot'); if (!s) return null;
    const b = s.getBoundingClientRect();
    return { x: Math.max(0, Math.round(b.x)), y: Math.max(0, Math.round(b.y)), w: Math.round(b.width), h: Math.round(b.height) }; });
  if (!r || r.w < 8 || r.h < 8) return { painted: false, note: '槽量不到' };
  const clip = { x: r.x, y: r.y, width: Math.min(r.w, 393 - r.x), height: Math.min(r.h, 852 - r.y) };
  const a = await page.screenshot({ clip });
  await page.evaluate(() => { const s = document.querySelector('.uni-slot'); if (s) s.style.visibility = 'hidden'; });
  const b = await page.screenshot({ clip });
  await page.evaluate(() => { const s = document.querySelector('.uni-slot'); if (s) s.style.visibility = ''; });
  return { painted: Buffer.compare(a, b) !== 0, note: `${clip.width}×${clip.height}` };
}

// ── L 段:詳細資訊卡 3a(一個捲軸從摘要到停靠表)────────────────────────────
// 設計 -前段3 TURN 3 的 3a:詳細＝88% 展開態,「一個捲軸從摘要到停靠表,不用學新導覽」,
// 40%/46% 那兩段看不出下面還有東西 ⇒ 卡緣一條「往上拉看詳細」。
async function sectionL(browser, engine) {
  const tag = `${engine} 393pt`;
  const { page, errs, close } = await boot(browser, { width: 393 });
  const snap = () => page.evaluate(c => eval('(' + c + ')')(), L_SNAP.toString());
  await page.evaluate(() => { if (state.playing) togglePlay(); }); // 重繪會洗掉手動狀態(E4b 教訓)

  const started = await followSomeTrain(page);
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const e = buildStnIndex().find(x => x.sysId === 'tra_sched' && x.name === '板橋');
    if (e) openBoard({ name: e.name, sys: e.sysId, lat: e.lat, lon: e.lon });
  });
  await page.waitForTimeout(1400);
  await page.evaluate(() => document.querySelector('.uni-tabs button[data-t="train"]')?.click());
  await page.waitForTimeout(900);
  const A = await snap();
  ok(`L1 ${tag} 正向對照:跟到車、在「這班車」那一頁、資訊卡併進卡裡`,
    started && A.following && A.tabSel === '這班車' && A.fpInSlot && A.tcInFp && A.tcVis, JSON.stringify(A));
  // 3a 的四段內容全部在同一頁裡量得到(逐段都要,少一段就是「有些東西沒搬過來」)
  ok(`L2 ${tag} 詳細四段都在:車型介紹／旅程日誌／速度曲線／停靠時刻`,
    A.intro > 20 && A.events > 20 && A.eventsNote && A.spark > 20 && A.stops > 80 && A.stopRows >= 4,
    JSON.stringify({ intro: A.intro, events: A.events, 日誌有字: A.eventsNote, spark: A.spark, stops: A.stops, rows: A.stopRows }));
  // 🔴 「一個捲軸」是這條的重點:卡自己不可以再捲一層,否則手指從卡上往上滑只捲得到卡的底
  ok(`L3 ${tag} 一個捲軸:看板是捲動容器、卡沒有自己的捲軸也沒有限高`,
    A.boardScroll > 100 && A.boardOverflowY === 'auto' && A.fpOverflowY === 'visible' && A.fpMaxH === 'none'
      && A.nestedScrollers.length === 0,
    JSON.stringify({ 看板可捲: A.boardScroll, 看板overflowY: A.boardOverflowY, 卡overflowY: A.fpOverflowY,
      卡maxHeight: A.fpMaxH, 槽內還能捲的盒子: A.nestedScrollers }));
  ok(`L4 ${tag} 停靠時刻表預設就是打開的(不用先找到那顆鈕)`,
    !A.stopsHidden && A.stops > 80, JSON.stringify({ hidden: A.stopsHidden, h: A.stops }));

  // 卡緣提示列:存在、觸控目標 44、真的命中自己
  ok(`L5 ${tag} 卡緣有「往上拉看完整資料」提示,觸控目標 ≥44 且命中自己`,
    A.hintVis && /往上拉/.test(A.hintTxt) && A.hintH >= 44 && A.hintHit,
    JSON.stringify({ vis: A.hintVis, h: A.hintH, hit: A.hintHit, txt: A.hintTxt }));

  // 點它 → 88%;提示列自己收掉(已經看得到了)
  // 🔴 點不到不可以用拋例外收場:那會把整段帶走,L7 之後全部沒跑到而輸出只看得到幾條紅
  //    (突變測試實測:把提示列藏起來 ⇒ 只剩 13 筆結果,L7 這條反向對照根本沒發言)。記一筆紅再往下走。
  const clicked = await page.locator('.uni-more').click({ timeout: 5000 }).then(() => true, () => false);
  await page.waitForTimeout(900);
  const B = await snap();
  const paint88 = await slotPaints(page);
  ok(`L6 ${tag} 點提示列 ⇒ 段高變 88%,提示列自己收掉,而且那一頁真的畫得出來`,
    clicked && B.size === 'large' && !B.hintVis && B.following && B.fpInSlot && paint88.painted,
    JSON.stringify({ 點得到: clicked, 有畫東西: paint88.painted, 區域: paint88.note, ...B }));
  // 🔴 第二種證據(心得 24 的雙證據):卡到根的累乘不透明度＝1,且卡內容中心點打到的是卡自己。
  //    契約③ 淡出時 opacity 0＋pointer-events:none,兩者會同時倒——而 DOM 檢查全綠。
  ok(`L12 ${tag} 88% 那一頁不是透明的:不透明度 1 且卡內容命中自己`,
    B.fpOpacity === 1 && B.cardHit, JSON.stringify({ opacity: B.fpOpacity, 命中卡: B.cardHit }));
  // 反向對照:回到中段提示列要回來——少了這半,「提示列永遠不顯示」也會讓 L6 過
  await page.evaluate(() => setSheetSize(document.getElementById('board'), 'medium'));
  await page.waitForTimeout(900);
  const C = await snap();
  ok(`L7 ${tag} 反向對照:回到中段提示列又出現`,
    C.size === 'medium' && C.hintVis, JSON.stringify({ size: C.size, hintVis: C.hintVis }));

  // 捲動位置保留:捲到停靠表之後重繪一次(看板每 20 模擬秒會自己來一發),不可以被彈回頂端
  const scrolled = await page.evaluate(() => {
    const bd = document.getElementById('board');
    bd.scrollTop = bd.scrollHeight; return Math.round(bd.scrollTop);
  });
  await page.evaluate(() => renderBoard());
  await page.waitForTimeout(700);
  const D = await snap();
  ok(`L8 ${tag} 捲到停靠表後重繪:捲動位置保留(詳細不會每 20 秒被彈回頂端)`,
    scrolled > 50 && Math.abs(D.boardTop - scrolled) <= 8, `捲到 ${scrolled} → 重繪後 ${D.boardTop}`);
  // 反向對照:換一站要歸零(不是無條件保留上一站的位置)
  await page.evaluate(() => {
    const e = buildStnIndex().find(x => x.sysId === 'tra_sched' && x.name === '台中')
      || buildStnIndex().find(x => x.sysId === 'tra_sched' && x.name !== '板橋');
    if (e) openBoard({ name: e.name, sys: e.sysId, lat: e.lat, lon: e.lon });
  });
  await page.waitForTimeout(1000);
  const E = await snap();
  ok(`L9 ${tag} 反向對照:換一站捲動歸零`, E.boardTop === 0, JSON.stringify({ top: E.boardTop }));

  // 關看板 ⇒ 資訊卡搬回原位,而且在手機上重新隱藏(不能留在畫面上變孤兒)
  await page.evaluate(() => closeBoard());
  await page.waitForTimeout(900);
  const F = await snap();
  ok(`L10 ${tag} 反向對照:關看板 ⇒ 資訊卡搬回原位且重新隱藏、提示列不留`,
    !F.tcInFp && !F.tcVis && !F.hintVis && F.following, JSON.stringify(F));
  ok(`L11 ${tag} 零 pageerror`, errs.length === 0, errs.slice(0, 1).join(''));
  await close();
}

// ── M 段:今日亮點 3e(今日之最四格邊框卡)────────────────────────────────
// 設計 -前段3 TURN 3 的 3e:「四格用 1.5px 邊框卡 而不是實色底,避免跟看板列的虛線分隔打架。
// 點任一列＝直接跟隨,所以整列都是 48px 觸控目標。」四格固定＝最遠征／開最久／停最多站／平均最快。
const M_SNAP = () => {
  const body = document.getElementById('expBody');
  const cards = [...document.querySelectorAll('#explorePanel .hl-card')];
  const secs = [...document.querySelectorAll('#explorePanel .sec')].map(e => e.textContent.trim());
  const cs = cards[0] ? getComputedStyle(cards[0]) : null;
  return {
    open: !document.getElementById('explorePanel').hidden,
    n: cards.length,
    nos: cards.map(c => c.dataset.no || ''),
    ks: cards.map(c => (c.querySelector('.hc-k') || {}).textContent || ''),
    hs: cards.map(c => Math.round(c.getBoundingClientRect().height)),
    // 🔴 四張都要測命中,不是只測第一張(並排元件的熱區重疊是這個 repo 踩過的坑)
    hits: cards.map(c => { const r = c.getBoundingClientRect();
      if (!(r.width > 2 && r.height > 2)) return false;
      const q = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!(q && q.closest('.hl-card') === c); }),
    // 「今日之最」要排在「特別列車出沒中」前面(設計 3e 的順序)
    secOrder: secs,
    bestFirst: secs.indexOf('今日之最') === 0,
    // 邊框卡而不是實色底。🔴 用到的寬度不能當判準:chromium 把 1.5px 量成 1px(webkit 給 1.5),
    //    引擎差異會讓「1.5」這個數字永遠對不齊。改成兩件事各驗一次——樣式表裡**宣告**的是 1.5px
    //    (逐字,引擎無關),而畫面上**真的有**一條實線邊框且背景透明。
    borderUsed: cs ? parseFloat(cs.borderTopWidth) : 0,
    borderStyle: cs ? cs.borderTopStyle : '',
    // 讀 cssText:帶 var() 的簡寫在 CSSOM 會序列化成空字串(見 N 段同款註解)
    borderDecl: (() => { for (const sh of document.styleSheets) {
        let rules; try { rules = sh.cssRules; } catch (e) { continue; }
        for (const r of rules || []) if (r.selectorText === '#explorePanel .hl-card')
          return (r.cssText.match(/border:\s*[^;]+/) || [''])[0] || r.style.borderWidth || '';
      } return ''; })(),
    bgAlpha: cs ? (cs.backgroundColor.match(/[\d.]+\)$/) ? parseFloat(cs.backgroundColor.match(/([\d.]+)\)$/)[1]) : 1) : 1,
    // 🔴 橫向溢出要量**真正在捲的那個容器**:#expBody 是 overflow:visible,永遠不捲,拿它量
    //    只會量到頁尾註腳那條刻意的滿版負邊界(margin:0 -14px),與卡片無關(心得 19 的同族)。
    //    而且不只看數字,還真的推一下 scrollLeft 看它動不動。
    panelScrollX: (() => { const pn = document.getElementById('explorePanel');
      const b0 = pn.scrollLeft; pn.scrollLeft = 999; const moved = pn.scrollLeft; pn.scrollLeft = b0;
      return { over: pn.scrollWidth - pn.clientWidth, moved }; })(),
    inPanel: (() => { const pn = document.getElementById('explorePanel');
      const r = pn.getBoundingClientRect(), pr = parseFloat(getComputedStyle(pn).paddingRight) || 0;
      return cards.every(c => c.getBoundingClientRect().right <= r.right - pr + 1); })(),
    following: state.followTrain ? String(state.followTrain.train) : '',
  };
};
async function sectionM(browser, engine, tier = 'std') {
  const tag = `${engine} 393pt${tier === 'std' ? '' : ' ' + tier}`;
  const { page, errs, close } = await boot(browser, { width: 393, tier });
  const snap = () => page.evaluate(c => eval('(' + c + ')')(), M_SNAP.toString());
  await page.evaluate(() => { if (state.playing) togglePlay(); });
  await page.evaluate(() => document.getElementById('tabExplore').click());
  await page.waitForTimeout(1300);
  await page.evaluate(() => setSheetSize(document.getElementById('explorePanel'), 'large'));
  await page.waitForTimeout(800);
  const A = await snap();
  ok(`M1 ${tag} 正向對照:亮點面板開著,今日之最四格,而且排在最前面`,
    A.open && A.n === 4 && A.bestFirst, JSON.stringify({ open: A.open, n: A.n, 區塊順序: A.secOrder.slice(0, 3) }));
  // 🔴 四個頭銜一個都不能少:舊寫法遇到同一班車蟬聯就把後面的頭銜整個丟掉(四格變三格)
  ok(`M2 ${tag} 四個頭銜齊全,而且是四班不同的車`,
    ['最遠征', '開最久', '停最多站', '平均最快'].every((k, i) => A.ks[i] === k)
      && new Set(A.nos).size === 4 && A.nos.every(Boolean), JSON.stringify({ 頭銜: A.ks, 車次: A.nos }));
  ok(`M3 ${tag} 每一格都是觸控目標(≥44)且四格各自命中自己`,
    A.hs.every(h => h >= 44) && A.hits.length === 4 && A.hits.every(Boolean),
    JSON.stringify({ 高度: A.hs, 命中: A.hits }));
  ok(`M4 ${tag} 邊框卡不是實色底(樣式表宣告 1.5px、畫面上是實線邊框、背景透明)`,
    /1\.5px/.test(A.borderDecl) && A.borderUsed > 0 && A.borderStyle === 'solid' && A.bgAlpha === 0,
    JSON.stringify({ 宣告: A.borderDecl, 用到: A.borderUsed, 線型: A.borderStyle, 底色不透明度: A.bgAlpha }));
  ok(`M5 ${tag} 兩欄不撐破面板(面板推不動、卡的右緣不出界)`,
    A.panelScrollX.over <= 1 && A.panelScrollX.moved === 0 && A.inPanel,
    JSON.stringify({ 面板橫向: A.panelScrollX, 卡都在面板內: A.inPanel }));
  // 🔴 驗按鈕是驗「點它會發生什麼」:真的點第二格,面板要收掉而且跟到卡上那一班
  const want = A.nos[1];
  await page.locator('#explorePanel .hl-card').nth(1).click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const B = await snap();
  ok(`M6 ${tag} 點第二格 ⇒ 面板收掉且跟到卡上那一班(${want})`,
    !B.open && B.following === want, JSON.stringify({ 面板還開著: B.open, 跟到: B.following, 應該是: want }));
  ok(`M7 ${tag} 零 pageerror`, errs.length === 0, errs.slice(0, 1).join(''));
  await close();
}
async function sectionMx(browser, engine) { await sectionM(browser, engine, 'xlarge'); }

// ── N 段:搜尋 3h(聚焦藏青框／清除鈕 44 熱區／查無結果的下一步)──────────────
// 設計 -前段3 TURN 3 的 3h:「輸入框給 2px 藏青框＝聚焦態,跟未聚焦的 1.5px 中性框分開。
// 清除鈕 20px 但熱區 44px」。46% peek 那半刻意不跟:我方搜尋 sheet 是**上錨**的(iOS 鍵盤會
// 蓋掉底部 sheet 的輸入框與結果),那是既有決定,見 #searchPanel 的 CSS 註解。
const N_SNAP = () => {
  const inp = document.getElementById('trainSearch'), clr = document.getElementById('searchClear');
  const cs = getComputedStyle(inp), r = inp.getBoundingClientRect();
  const cr = clr ? clr.getBoundingClientRect() : null;
  const hit = cr && cr.width > 2 ? (() => { const q = document.elementFromPoint(cr.left + cr.width / 2, (cr.top + cr.bottom) / 2);
    return !!(q && q.id === 'searchClear'); })() : false;
  return {
    open: !document.getElementById('searchPanel').hidden,
    fontPx: parseFloat(cs.fontSize), inH: Math.round(r.height),
    border: parseFloat(cs.borderTopWidth), borderCol: cs.borderTopColor, outline: cs.outlineStyle,
    navy: getComputedStyle(document.documentElement).getPropertyValue('--navy').trim(),
    clrW: cr ? Math.round(cr.width) : 0, clrH: cr ? Math.round(cr.height) : 0, clrHit: hit,
    padR: parseFloat(cs.paddingRight),
    // 清除鈕不可以蓋到輸入的文字:padding 要讓開它
    clrInside: cr ? (cr.right <= r.right + 1 && cr.left >= r.left) : false,
    val: inp.value, focusId: (document.activeElement || {}).id || '',
    dropHidden: !!document.getElementById('searchDrop').hidden,
    emptyTip: (document.querySelector('#searchDrop .empty .sd-tip') || {}).textContent || '',
  };
};
async function sectionN(browser, engine, tier = 'std') {
  const tag = `${engine} 393pt${tier === 'std' ? '' : ' ' + tier}`;
  const { page, errs, close } = await boot(browser, { width: 393, tier });
  await page.evaluate(() => { if (state.playing) togglePlay(); });
  const snap = () => page.evaluate(c => eval('(' + c + ')')(), N_SNAP.toString());
  await page.evaluate(() => document.getElementById('tabSearch').click());
  await page.waitForTimeout(900);
  await page.evaluate(() => document.getElementById('trainSearch').blur());
  await page.waitForTimeout(200);
  const A = await snap();
  ok(`N1 ${tag} 正向對照:搜尋面板開著,輸入框 16px 起跳(iOS 聚焦不放大),空欄沒有清除鈕`,
    A.open && A.fontPx >= 16 && A.clrW === 0, JSON.stringify({ open: A.open, 字級: A.fontPx, 清除鈕寬: A.clrW }));
  const rgbNavy = await page.evaluate(() => { const d = document.createElement('div');
    d.style.color = getComputedStyle(document.documentElement).getPropertyValue('--navy').trim();
    document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; });
  // 🔴 不用 computed 寬度當絕對判準:chromium 把宣告的 1.5px 量成 1(webkit 給 1.5),
  //    這個數字永遠對不齊兩個引擎。未聚焦這條只判「顏色是中性、不是藏青」＋樣式表宣告 1.5px。
  // 🔴 讀 cssText 不讀 style.border:簡寫裡只要有 var()(border-color: var(--line)),CSSOM 就把
  //    整個簡寫與它的所有 longhand 序列化成空字串(pending-substitution),對不對都會變成「查無宣告」。
  const declBorder = await page.evaluate(() => { for (const sh of document.styleSheets) {
      let rules; try { rules = sh.cssRules; } catch (e) { continue; }
      // CSSOM 會把 [type=text] 正規化成 [type="text"],逐字比對選擇器會查無 ⇒ 去引號再比
      for (const r of rules || []) if ((r.selectorText || '').replace(/["']/g, '') === '.search input[type=text]')
        return (r.cssText.match(/border:\s*[^;]+/) || [''])[0];
    } return ''; });
  ok(`N2 ${tag} 未聚焦是中性框(樣式表宣告 1.5px,顏色不是藏青)`,
    /1\.5px/.test(declBorder) && A.border > 0 && A.borderCol !== rgbNavy,
    JSON.stringify({ 宣告: declBorder, 用到: A.border, 顏色: A.borderCol }));
  await page.locator('#trainSearch').click();
  await page.locator('#trainSearch').fill('2');
  await page.waitForTimeout(500);
  const B = await snap();
  // 聚焦態的重點是「跟未聚焦分得出來」:比同一個引擎自己的兩個狀態,不比跨引擎的絕對值。
  ok(`N3 ${tag} 聚焦 ⇒ 藏青框、比未聚焦粗,而且不是全域那圈紅色 outline`,
    B.borderCol === rgbNavy && B.border > A.border && B.outline === 'none',
    JSON.stringify({ 未聚焦: A.border, 聚焦: B.border, 顏色: B.borderCol, 藏青: rgbNavy, outline: B.outline }));
  ok(`N4 ${tag} 打字後清除鈕出現:熱區 ≥44、命中自己、貼在框內、文字讓開`,
    B.clrW >= 44 && B.clrH >= 44 && B.clrHit && B.clrInside && B.padR >= 44,
    JSON.stringify({ 寬: B.clrW, 高: B.clrH, 命中: B.clrHit, 在框內: B.clrInside, 右內距: B.padR }));
  // 🔴 驗按鈕是驗「點它會發生什麼」:值要清掉、下拉要收、焦點要留著(手機鍵盤不能因為按清除就收)
  await page.locator('#searchClear').click();
  await page.waitForTimeout(400);
  const C = await snap();
  ok(`N5 ${tag} 點清除 ⇒ 值清空·下拉收起·焦點留在輸入框·鈕自己消失`,
    C.val === '' && C.dropHidden && C.focusId === 'trainSearch' && C.clrW === 0,
    JSON.stringify({ 值: C.val, 下拉收起: C.dropHidden, 焦點: C.focusId, 清除鈕寬: C.clrW }));
  // 🔴 反向對照:**程式**寫進去的值也要讓鈕出現。這條專門守「顯示條件不是 JS 開關」——
  //    這顆輸入框有十幾處程式在寫 value,用 JS 同步會漏掉其中一處而長出「空欄卻有鈕」。
  await page.evaluate(() => { const i = document.getElementById('trainSearch'); i.value = '152'; i.blur(); });
  await page.waitForTimeout(300); // 連焦點都拿掉:顯示條件只能看「有沒有值」,不能看聚焦也不能看事件
  const D = await snap();
  ok(`N6 ${tag} 反向對照:程式直接寫 value(不觸發 input 事件)⇒ 清除鈕照樣出現`,
    D.clrW >= 44 && D.val === '152', JSON.stringify({ 清除鈕寬: D.clrW, 值: D.val }));
  // 查無結果:設計 3h 的那句下一步
  await page.locator('#trainSearch').fill('zzzz沒有這種車');
  await page.waitForTimeout(600);
  const E = await snap();
  ok(`N7 ${tag} 查無結果時給下一步(不是只寫「查無」)`,
    /今天的班次/.test(E.emptyTip) && /加班車/.test(E.emptyTip), E.emptyTip.slice(0, 40));
  ok(`N8 ${tag} 零 pageerror`, errs.length === 0, errs.slice(0, 1).join(''));
  await close();
}
async function sectionNx(browser, engine) { await sectionN(browser, engine, 'xlarge'); }

// ── O 段:設計 3f 我的最愛——清點、每列狀態、右欄一顆星就是唯一的移除入口 ──────────
// 🔴 這一段**必須自己種資料**:全新的瀏覽器 profile 一筆收藏都沒有,不種就是對著空面板
//    跑斷言——每一條都恆真,最典型的假綠。種法一律走 app 自己的 API(userDataSaveCollection/
//    saveFavs/savePins),不自己捏 localStorage 結構:結構會變,捏錯了種出來的形狀真使用者
//    身上永遠不會出現。
const O_SEED = () => {
  const idx = buildStnIndex();
  const sts = [];
  for (const n of ['板橋', '花蓮', '宜蘭']) {
    const e = idx.find(x => x.sysId === 'tra_sched' && x.name === n);
    if (e) sts.push({ name: e.name, lat: e.lat, lon: e.lon, sys: 'tra_sched', group: state.group, label: '台鐵' });
  }
  // 🔴 再種一站「此刻真的有班次」的——不然深夜跑的時候每一站都留白,O6 的「有班次就要對得上」
  //    那一半永遠踩不到(判準看起來全綠,其實只驗了空的那一半)。從班表挑最近一班發車的站,
  //    有就種、沒有(全線收班)就算了,O6 會自己說它走的是哪一半。
  let soon = null;
  for (const tr of (state.trains || [])) {
    if ((tr.sys || '') !== 'tra_sched') continue;
    for (const st of tr.stops) {
      const dtm = st.depSec - state.simSec;
      if (dtm > 90 && dtm < 3 * 3600 && (!soon || dtm < soon.dtm)) soon = { name: st.name, dtm };
    }
  }
  if (soon && !sts.some(x => x.name === soon.name)) {
    const e = idx.find(x => x.sysId === 'tra_sched' && x.name === soon.name);
    if (e) sts.push({ name: e.name, lat: e.lat, lon: e.lon, sys: 'tra_sched', group: state.group, label: '台鐵' });
  }
  sts.push({ name: '永安市場', lat: 24.9908, lon: 121.5115, sys: 'metro', group: state.group, label: '台北捷運 中和新蘆線' });
  userDataSaveCollection('stations', sts);
  const trs = (state.trains || []).slice(0, 3).map(t => ({ train: String(t.train), sys: t.sys || 'tra_sched',
    label: t.stops[0].name + '→' + t.stops[t.stops.length - 1].name }));
  saveFavs(trs);
  savePins([{ lat: 25.0478, lon: 121.5170, label: '台北車站前' }]);
  return { st: sts.length, tr: trs.length, pin: 1, trNos: trs.map(t => t.train), soon: soon ? soon.name : null };
};
const O_SNAP = () => {
  const el = document.getElementById('favPanel');
  const rows = [...el.querySelectorAll('.row')];
  const info = r => {
    const b = r.querySelector('.rm');
    let star = null;
    if (b) {
      // 🔴 面板是 46% 的 sheet,一半的列在摺線以下——不先捲進來就對著被裁掉的位置做命中測試,
      //    量到的是「首屏看不到」而不是「點不到」(心得 19)。捲一下再問,才是使用者真的會做的事。
      r.scrollIntoView({ block: 'center' });
      const q = b.getBoundingClientRect(), rr = r.getBoundingClientRect();
      const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      const svg = b.querySelector('svg');
      star = { w: +q.width.toFixed(1), h: +q.height.toFixed(1), tag: b.tagName,
        // 「點得到嗎」只有命中測試答得出來(心得 33/37):rect 對不代表點得到
        hit: !!(hit && hit.closest('.rm') === b),
        // 實心＝已收藏。符號本身是純描邊(.ri-icon{fill:none}),要靠 CSS 補 fill 才讀得出「已收藏」
        fill: svg ? getComputedStyle(svg).fill : '',
        gapRight: +(rr.right - q.right).toFixed(1),
        // 🔴 列名與星要在同一條水平線上。.board .row 是 align-items:baseline,列被 44 的星撐高之後
        //    文字會釘在頂端、星卻置中 ⇒ 看起來是「字在上、星掛在右下」(實測截圖如此)。
        //    量兩個中心的落差,不量列高——列高再對,歪掉還是歪掉。
        dy: (() => { const nb = r.querySelector('b'); if (!nb) return 0;
          const nr = nb.getBoundingClientRect();
          return +Math.abs((nr.top + nr.height / 2) - (q.top + q.height / 2)).toFixed(1); })() };
    }
    return { cls: r.className, txt: r.textContent.replace(/\s+/g, ' ').trim(),
      h: +r.getBoundingClientRect().height.toFixed(1), star,
      min: ((r.querySelector('.min') || {}).textContent || '').trim() };
  };
  return { open: !el.hidden, sub: ((el.querySelector('.sub') || {}).textContent || '').trim(),
    rows: rows.map(info),
    // 反向對照:整張面板不該再有第二個移除入口(舊的 × 或「編輯」模式)
    otherRm: [...el.querySelectorAll('.row *')].filter(x => /^[×✕✖]$/.test((x.textContent || '').trim())).length +
      [...el.querySelectorAll('.row button')].filter(x => /編輯/.test(x.textContent || '')).length };
};
async function sectionO(browser, engine) {
  const tag = `${engine} 393pt`;
  const { page, errs, close } = await boot(browser, { width: 393 });
  await page.evaluate(() => { if (state.playing) togglePlay(); });
  // 🔴 把時鐘撥到早上 8:15 再種資料。理由:深夜跑的時候全網一班車都沒有 ⇒ 「下一班」每一站都留白,
  //    O6 的「有班次就要對得上」那一半**永遠踩不到**(只驗到空的那一半,看起來卻是全綠)。
  //    撥鐘是這支腳本唯一能讓正向那一半在任何時間都跑得到的辦法;契約本身與時間無關。
  //    直接寫 state.simSec 一定要同時關 clockAtNow,否則下一個 tick 會把它拉回「現在」。
  await page.evaluate(() => { setSimSec(8 * 3600 + 15 * 60); state.clockAtNow = false; });
  await page.waitForTimeout(600);
  const seed = await page.evaluate(c => eval('(' + c + ')')(), O_SEED.toString());
  await page.evaluate(() => document.getElementById('tabFav').click());
  await page.waitForTimeout(1200);
  const snap = () => page.evaluate(c => eval('(' + c + ')')(), O_SNAP.toString());
  const A = await snap();
  const stRows = A.rows.filter(r => /fvst/.test(r.cls)), trRows = A.rows.filter(r => /\bfv\b/.test(r.cls)),
    pinRows = A.rows.filter(r => /fvpin/.test(r.cls));
  ok(`O1 ${tag} 正向對照:面板開著,種進去的站/車/地點三種列都在`,
    A.open && stRows.length === seed.st && trRows.length === seed.tr && pinRows.length === seed.pin,
    JSON.stringify({ open: A.open, 站: stRows.length, 車: trRows.length, 地點: pinRows.length, 種: seed }));
  // 清點列:數字要跟著實際筆數走(拿當下量到的列數推導,不寫死字串)
  const wantSub = [`${seed.tr} 班車`, `${seed.st} 站`, `${seed.pin} 個地點`].join(' · ');
  ok(`O2 ${tag} 標題下面是清點,而且數字＝實際筆數`, A.sub === wantSub, `實際「${A.sub}」應為「${wantSub}」`);
  const starBad = A.rows.filter(r => !r.star || r.star.w < 44 || r.star.h < 44 || !r.star.hit ||
    // fill 必須是「真的有顏色」:'none'(只有描邊)與 ''(根本沒有圖示,例如退回打字的 ×)都不算實心星
    r.star.tag !== 'BUTTON' || !/^rgb/.test(r.star.fill) || r.star.gapRight > 20);
  ok(`O3 ${tag} 每一列右欄都有一顆實心星:44 觸控格·真的命中自己·是 button·貼在最右`,
    A.rows.length > 0 && starBad.length === 0,
    starBad.length ? JSON.stringify(starBad.slice(0, 2)) : `${A.rows.length} 列全過(星 ${A.rows[0].star.w}×${A.rows[0].star.h} fill=${A.rows[0].star.fill})`);
  ok(`O4 ${tag} 反向對照:星是唯一的移除入口(沒有第二顆 × 也沒有編輯模式)`,
    A.otherRm === 0, `另外找到 ${A.otherRm} 個移除入口`);
  ok(`O5 ${tag} 每一列高 ≥44(整列都是觸控目標)`,
    A.rows.every(r => r.h >= 44), JSON.stringify(A.rows.map(r => r.h)));
  const skew = A.rows.filter(r => r.star && r.star.dy > 2);
  ok(`O5b ${tag} 星與列名在同一條水平線上(不是字在上、星掛右下)`,
    A.rows.length > 0 && skew.length === 0,
    skew.length ? JSON.stringify(skew.map(r => ({ txt: r.txt.slice(0, 12), dy: r.star.dy }))) : `最大落差 ${Math.max(...A.rows.map(r => (r.star || {}).dy || 0))}px`);
  // 🔴 下一班:面板與看板必須是同一個時刻。判準寫成**雙向**契約,才不會在深夜(沒有班次可列)
  //    變成恆真:面板有寫時刻 ⇒ 看板第一列同一個時刻;面板留白 ⇒ 看板也真的沒有班次可列。
  const cmp = await page.evaluate(() => {
    const el = document.getElementById('favPanel');
    const rows = [...el.querySelectorAll('.row.fvst')].filter(x => /台鐵/.test(x.textContent));
    // 有寫時刻的優先(那是要驗的正向那一半);全部留白才退回驗「兩邊都空」
    const r = rows.find(x => ((x.querySelector('.min') || {}).textContent || '').trim()) || rows[0];
    if (!r) return { skip: '沒有台鐵站列' };
    const panel = ((r.querySelector('.min') || {}).textContent || '').trim();
    const name = (r.querySelector('b') || {}).textContent || '';
    const e = buildStnIndex().find(x => x.sysId === 'tra_sched' && x.name === name);
    if (!e) return { skip: '站索引找不到 ' + name };
    openBoard({ name: e.name, sys: e.sysId, lat: e.lat, lon: e.lon });
    const bd = document.getElementById('board');
    const first = bd.querySelector('.row .hm');
    const late = bd.querySelector('.row .lateTag');
    return { name, panel, boardRows: bd.querySelectorAll('.row').length,
      boardFirst: first ? first.textContent.trim() : '', boardLate: late ? late.textContent.trim() : '' };
  });
  const okNext = cmp.skip ? false
    : cmp.panel ? (cmp.boardRows > 0 && cmp.panel.includes(cmp.boardFirst))
                : cmp.boardRows === 0;
  ok(`O6 ${tag} 「下一班」與車站看板是同一個時刻(${cmp.panel ? '走到正向那一半:有班次,要對得上' : '此刻全線無班次可列,只驗兩邊都留白'})`,
    okNext, JSON.stringify(cmp));
  // 捷運站:官方到站時刻不走班表,我方不自己推一份 ⇒ 留白(而不是寫 0 或 --)
  const metroRow = A.rows.find(r => /捷運/.test(r.txt));
  ok(`O7 ${tag} 捷運站不猜下一班(留白,不是 0 或 --)`,
    !!metroRow && metroRow.min === '', metroRow ? `min=「${metroRow.min}」` : '沒有捷運站列');
  // 🔴 O6 的 openBoard 走 soloPanel ⇒ **最愛面板已經被收掉了**(第一版沒發現,O8 的「點不到」
  //    其實是面板不在,不是星壞掉——長得跟真缺陷一模一樣)。重新開回來,並重新取一次基準。
  await page.evaluate(() => { closeBoard(); document.getElementById('tabFav').click(); });
  await page.waitForTimeout(1000);
  const A2 = await snap();
  const stRows2 = A2.rows.filter(r => /fvst/.test(r.cls));
  ok(`O8a ${tag} 從看板回到最愛,四種列原封不動`,
    A2.open && stRows2.length === stRows.length && A2.sub === A.sub, `站 ${stRows2.length} sub「${A2.sub}」`);
  // 真的點一下星:那一筆消失、其餘留著、清點跟著減一(只驗 DOM 不驗行為 = 沒驗,心得 37)
  const before = stRows2.map(r => r.txt);
  const clicked = await page.locator('#favPanel .row.fvst .rm').first().click({ timeout: 5000 })
    .then(() => true, () => false);
  await page.waitForTimeout(700);
  const B = await snap();
  const stAfter = B.rows.filter(r => /fvst/.test(r.cls));
  ok(`O8 ${tag} 真的點星 ⇒ 那一筆被移除,其他列原封不動,清點跟著減一`,
    clicked && stAfter.length === stRows2.length - 1 &&
    !stAfter.some(r => r.txt === before[0]) &&
    B.sub === [`${seed.tr} 班車`, `${seed.st - 1} 站`, `${seed.pin} 個地點`].join(' · '),
    `點到=${clicked} 站 ${stRows2.length}→${stAfter.length} sub「${B.sub}」`);
  ok(`O9 ${tag} 零 pageerror`, errs.length === 0, errs.slice(0, 1).join(''));
  await close();
}

// ── P 段:設計 3g 旅程護照——三格統計(完乘/總里程/收集章)＋章面印取得日期 ──────────
// 🔴 同 O 段:全新 profile 一趟完乘都沒有,不種資料就是對著空護照跑斷言(恆真=假綠)。
//    種的四趟裡有兩趟蓋**同一枚**明星章、日期一早一晚——那是專門為了驗「取最早那天」而種的,
//    只種一趟的話「取最早」與「取最晚」會給出同一個答案,判準等於沒驗到規則。
const P_SEED = () => {
  const sd = state.special;
  if (!sd) return { ok: false, why: 'state.special 還沒載入' };
  const named = sd.namedTrains.filter(n => n.trainNos.length)[0];
  const stock = sd.rollingStock[0], branch = sd.branchLines[0];
  if (!named || !stock || !branch) return { ok: false, why: '特別列車資料不齊' };
  const rides = [
    { train: '231', sys: 'tra_sched', kind: named.name, from: '花蓮', to: '樹林', km: 207,
      date: '2026-08-19', dep: 8 * 3600, stops: 12, namedId: named.id },
    { train: '4211', sys: 'tra_sched', kind: stock.name, from: '蘇澳', to: '樹林', km: 118,
      date: '2026-08-17', dep: 9 * 3600, stops: 20, stockId: stock.id },
    { train: '372', sys: 'tra_sched', kind: '自強', from: '花蓮', to: '潮州', km: 421,
      date: '2026-08-14', dep: 7 * 3600, stops: 18, branchIds: [branch.id] },
    // 同一枚明星章的第二趟,日期更早 ⇒ 章面應該印這一天
    { train: '232', sys: 'tra_sched', kind: named.name, from: '樹林', to: '花蓮', km: 600,
      date: '2026-08-02', dep: 6 * 3600, stops: 12, namedId: named.id },
  ];
  saveRides(rides);
  return { ok: true, n: rides.length, km: rides.reduce((a, r) => a + r.km, 0),
    namedId: named.id, namedName: named.name, total: stampTotal() };
};
const P_SNAP = () => {
  const el = document.getElementById('ridePanel');
  const cell = i => { const c = el.querySelectorAll('.ride-stats .rs-cell')[i];
    return c ? { k: (c.querySelector('i') || {}).textContent || '', v: (c.querySelector('b') || {}).textContent || '' } : null; };
  const seals = [...el.querySelectorAll('.ph-stamps .seal')].map(x => ({
    cat: x.dataset.cat || '', id: x.dataset.id || '', na: x.classList.contains('na'),
    foot: ((x.querySelector('small') || {}).textContent || '').trim() }));
  return { open: !el.hidden, cells: [cell(0), cell(1), cell(2)], seals,
    // 統計列不該撐破面板(推一下才知道,不是看數字)
    sx: (() => { const before = el.scrollLeft; el.scrollLeft = 999; const after = el.scrollLeft; el.scrollLeft = before; return after; })() };
};
async function sectionP(browser, engine) {
  const tag = `${engine} 393pt`;
  const { page, errs, close } = await boot(browser, { width: 393 });
  await page.evaluate(() => { if (state.playing) togglePlay(); });
  await page.waitForFunction(() => state.special && state.special.namedTrains, null, { timeout: 20000 }).catch(() => {});
  const seed = await page.evaluate(c => eval('(' + c + ')')(), P_SEED.toString());
  await page.evaluate(() => document.getElementById('tabRide').click());
  await page.waitForTimeout(1200);
  const A = await page.evaluate(c => eval('(' + c + ')')(), P_SNAP.toString());
  ok(`P1 ${tag} 正向對照:護照開著,統計列是三格(完乘/總里程/收集章)`,
    seed.ok && A.open && A.cells.every(Boolean) &&
    A.cells.map(c => c.k).join('|') === '完乘|總里程|收集章',
    JSON.stringify({ seed: seed.why || seed.n, cells: A.cells }));
  // 數字從**種進去的資料**獨立算一次,不是把畫面上的字抄下來再跟自己比
  ok(`P2 ${tag} 完乘趟數與總里程＝種進去的資料算出來的值(含千分位)`,
    seed.ok && A.cells[0] && A.cells[0].v === `${seed.n} 趟` &&
    A.cells[1] && A.cells[1].v === `${seed.km.toLocaleString('en-US')} km`,
    JSON.stringify({ 趟: A.cells[0] && A.cells[0].v, 里程: A.cells[1] && A.cells[1].v, 應為: seed.km }));
  const got = A.seals.filter(x => !x.na && x.cat);
  ok(`P3 ${tag} 收集章 G/T:G＝畫面上真的亮著的章數,T＝章總數`,
    seed.ok && A.cells[2] && A.cells[2].v === `${got.length} / ${seed.total}`,
    `顯示「${A.cells[2] && A.cells[2].v}」 亮著的章 ${got.length} 總數 ${seed.total}`);
  // 章面印日期,而且同一枚章有兩趟時取**最早**那天(種的是 08-19 與 08-02 ⇒ 要印 08.02)
  const namedSeal = A.seals.find(x => x.cat === 'named' && x.id === seed.namedId);
  ok(`P4 ${tag} 金章印取得日期,同一枚章有兩趟時取最早那天(08.02 不是 08.19)`,
    !!namedSeal && !namedSeal.na && namedSeal.foot === '08.02',
    namedSeal ? `${seed.namedName} 章印「${namedSeal.foot}」` : '找不到那枚章');
  ok(`P5 ${tag} 反向對照:沒蓋到的灰章仍寫「點我重播」(日期沒印到灰章上)`,
    A.seals.some(x => x.na) && A.seals.filter(x => x.na).every(x => x.foot === '點我重播'),
    JSON.stringify([...new Set(A.seals.filter(x => x.na).map(x => x.foot))]));
  ok(`P6 ${tag} 統計列沒把面板撐到可以橫捲`, A.sx === 0, `scrollLeft=${A.sx}`);
  // 🔴 反向對照:桌面護照**不**吃日期(buildStamps 的 opts 分工)。沒有這一條,
  //    「乾脆全部都印日期」也會全綠,桌面就被順手改掉了。
  const deskFoot = await page.evaluate(() => {
    const rides = loadRides();
    const html = buildStamps(rides);                       // 桌面呼叫法:不傳 opts
    const d = document.createElement('div'); d.innerHTML = html;
    return [...d.querySelectorAll('.seal')].filter(x => !x.classList.contains('na'))
      .map(x => (x.querySelector('small') || {}).textContent || '');
  });
  ok(`P7 ${tag} 反向對照:桌面護照那條路徑仍是「已收藏」(日期只給護照 sheet)`,
    deskFoot.length > 0 && deskFoot.every(t => t === '已收藏'),
    JSON.stringify([...new Set(deskFoot)]));
  ok(`P8 ${tag} 零 pageerror`, errs.length === 0, errs.slice(0, 1).join(''));
  await close();
}

// ── Q 段:設計 3d 更多——四段分組(已有)＋每一列左邊一顆單字圓章 ─────────────────
// 設計 3d 的三項提案裡,分組與「省電模式」我方本來就有(議題 3 那批),真正缺的是圓章欄。
const Q_SNAP = () => {
  const sheet = document.getElementById('moreSheet');
  const rows = [...sheet.querySelectorAll('.ms-row')].filter(r => r.offsetParent !== null || !r.hidden);
  const vis = r => r.getClientRects().length > 0 && getComputedStyle(r).display !== 'none';
  const info = r => {
    // 摺線以下的列要先捲進來再做命中測試(心得 19:量到的否則是「首屏看不到」不是「點不到」)
    r.scrollIntoView({ block: 'center' });
    const ic = r.querySelector('.ms-ic');
    const label = r.querySelector('span:not(.ms-ic):not(.chev):not(.seg):not(.toggle):not(.ms-tail)');
    const rr = r.getBoundingClientRect();
    const tail = r.querySelector('.chev, .toggle, .seg, .ms-tail');
    return { stat: r.classList.contains('ms-stat'), vis: vis(r),
      ic: ic ? (ic.textContent || '').trim() : null,
      icW: ic ? +ic.getBoundingClientRect().width.toFixed(1) : 0,
      labelLeft: label ? +(label.getBoundingClientRect().left - rr.left).toFixed(1) : null,
      txt: label ? (label.textContent || '').trim() : '',
      h: +rr.height.toFixed(1),
      // 圓章撐不撐高整列:量「這一列的內容空間」(最小高度扣掉內距與底線)夠不夠放這顆圓章。
      // 數字全部從當下量到的樣式推導,不寫死 23/40/48(心得 35)。
      room: (() => { const cs = getComputedStyle(r);
        const mh = parseFloat(cs.minHeight) || 0;
        return +(mh - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth)).toFixed(1); })(),
      icH: ic ? +ic.getBoundingClientRect().height.toFixed(1) : 0,
      tailRight: tail ? +(rr.right - tail.getBoundingClientRect().right).toFixed(1) : null,
      // 真的點得到嗎:命中列的中央偏左(標籤區),要落在這一列裡面
      hit: (() => { const el = document.elementFromPoint(rr.left + rr.width * 0.4, rr.top + rr.height / 2);
        return !!(el && el.closest('.ms-row') === r); })() };
  };
  return { open: sheet.classList.contains('open') || getComputedStyle(sheet).transform !== 'none',
    secs: [...sheet.querySelectorAll('.ms-sec')].map(x => (x.textContent || '').trim()),
    rows: rows.map(info) };
};
async function sectionQ(browser, engine) {
  const tag = `${engine} 393pt`;
  const { page, errs, close } = await boot(browser, { width: 393 });
  await page.evaluate(() => { if (state.playing) togglePlay(); });
  await page.evaluate(() => document.getElementById('tabMore').click());
  await page.waitForTimeout(900);
  const A = await page.evaluate(c => eval('(' + c + ')')(), Q_SNAP.toString());
  const act = A.rows.filter(r => !r.stat && r.vis), stat = A.rows.filter(r => r.stat);
  ok(`Q1 ${tag} 正向對照:更多開得起來,每一個動作列都有一顆帶字的圓章`,
    act.length >= 10 && act.every(r => r.ic && r.ic.length === 1 && r.icW >= 20),
    JSON.stringify({ 動作列: act.length, 沒圓章: act.filter(r => !r.ic).map(r => r.txt) }));
  // 圓章要能當定位點:兩列同一個字就失去辨識力
  const dup = Object.entries(act.reduce((m, r) => (m[r.ic] = (m[r.ic] || 0) + 1, m), {})).filter(([, n]) => n > 1);
  ok(`Q2 ${tag} 圓章的字彼此不重複`, dup.length === 0, JSON.stringify(dup));
  // 圓章不可以把標籤擠歪或把尾巴推離右緣:所有動作列的標籤左緣要一致
  const lefts = [...new Set(act.map(r => Math.round(r.labelLeft)))];
  ok(`Q3 ${tag} 所有動作列的標籤起點對齊,尾巴仍貼右`,
    lefts.length === 1 && act.every(r => r.tailRight == null || r.tailRight <= 20),
    JSON.stringify({ 標籤左緣: lefts, 尾巴離右緣: [...new Set(act.map(r => r.tailRight))] }));
  // 資料狀態是**讀數不是動作**:不給動作圓章,但標籤要對齊(不然那五列會凸出來)
  // 有幾列讀數會現身是 D4 的狀態(即時/捷運/重播/時段/車數 各自依狀態 hidden),不是本段的事:
  // 這裡只要求「現身的那些」沒有動作圓章、而且對齊。
  ok(`Q4 ${tag} 資料狀態列沒有動作圓章,但標籤與其他列對齊(現身 ${stat.length} 列)`,
    stat.length >= 1 && stat.every(r => !r.ic) &&
    stat.every(r => r.labelLeft != null && Math.abs(r.labelLeft - lefts[0]) <= 2),
    JSON.stringify({ 讀數列: stat.length, 左緣: [...new Set(stat.map(r => r.labelLeft))], 動作列左緣: lefts }));
  ok(`Q5 ${tag} 四段分組標題都在`,
    ['地圖顯示', '資訊', '觀看模式', '分享與資料'].every(k => A.secs.includes(k)), JSON.stringify(A.secs));
  // 反向對照:舊的臨時符號(◐ ♪ ◌ ⏺ ◎ ↗ 與「縣 」前綴)不可以還留在標籤裡——不然就變成
  // 「圓章加上去了,但舊符號也還在」,兩套圖示疊著。
  ok(`Q6 ${tag} 反向對照:標籤裡的臨時符號都清掉了`,
    act.every(r => !/[◐♪◌⏺◎↗]/.test(r.txt)), JSON.stringify(act.map(r => r.txt).filter(t => /[◐♪◌⏺◎↗]/.test(t))));
  ok(`Q7 ${tag} 每一列 ≥48 高,而且標籤區真的點得到`,
    act.every(r => r.h >= 48 && r.hit), JSON.stringify(act.filter(r => r.h < 48 || !r.hit).map(r => ({ t: r.txt, h: r.h, hit: r.hit }))));
  // 🔴 反向對照:更新那列會改自己的字。圓章是第一個子元素,用 firstElementChild 寫就會寫進圓章裡
  //    (實作時真的踩到)。這條專門守它:換完字之後,圓章還是「版」、標籤才是新字。
  const upd = await page.evaluate(() => {
    appUpdateRender({ state: { hasUpdate: true, showBanner: false }, latest: { v: '9.9.9' } });
    const row = document.querySelector('.ms-row[data-act="update"]');
    return { ic: (row.querySelector('.ms-ic') || {}).textContent || '',
      label: (row.querySelector('span:not(.ms-ic)') || {}).textContent || '' };
  });
  ok(`Q8 ${tag} 反向對照:更新列換字換的是標籤,不是圓章`,
    upd.ic === '版' && /有新版可更新/.test(upd.label), JSON.stringify(upd));
  // 🔴 圓章不可以把列撐高。實作時真的踩到:26px 的圓章讓**每一列**都長高,零變化對照抓到
  //    #msThemeSeg 整條往下掉 4.5px。判準比的是「圓章高」與「這一列本來就有的內容空間」,
  //    不是某個固定的 px 值——列的最小高度在三個字級檔各不相同(40/68/80)。
  const tall = act.filter(r => r.icH > r.room);
  ok(`Q10 ${tag} 圓章塞得進列本來的高度(不把每一列都撐高)`,
    act.length > 0 && tall.length === 0,
    tall.length ? JSON.stringify(tall.slice(0, 2).map(r => ({ t: r.txt, 圓章: r.icH, 空間: r.room })))
                : `圓章 ${act[0].icH} ≤ 空間 ${act[0].room}`);
  ok(`Q9 ${tag} 零 pageerror`, errs.length === 0, errs.slice(0, 1).join(''));
  await close();
}

// ── R 段:設計 14c 空狀態——四處一律 1.5px 虛線框 ──────────────────────────────
// 🔴 「有沒有框」與「框有沒有貼齊容器邊緣」是兩件事:borderStyle 對後者完全盲(貼邊的框看起來像破圖,
//    computed 值卻一切正常)。R5 量的就是後者,實測釘選卡第一版左右只剩 2px,只有 R5 抓得到。
const R_INSET = (sel, csel) => {
  const e = document.querySelector(sel), c = e && e.closest(csel);
  if (!e || !c) return null;
  const a = e.getBoundingClientRect(), b = c.getBoundingClientRect();
  return { l: +(a.left - b.left).toFixed(1), r: +(b.right - a.right).toFixed(1) };
};
const R_FRAME = () => {
  const g = el => {
    if (!el || !el.getClientRects().length) return null;
    const cs = getComputedStyle(el);
    return { style: cs.borderTopStyle, w: parseFloat(cs.borderTopWidth), r: parseFloat(cs.borderRadius),
      padL: parseFloat(cs.paddingLeft), txt: (el.textContent || '').slice(0, 12) };
  };
  return {
    pin: g(document.querySelector('#pinCard .xc-empty')),
    pass: g(document.querySelector('#ridePanel .ph-empty, .passport .ph-empty')),
    board: g(document.querySelector('#board .empty')),
    search: g(document.querySelector('#searchDrop .empty')),
  };
};
async function sectionR(browser, engine) {
  const { page, errs, close } = await boot(browser, { width: 393 });
  await page.evaluate(() => { if (state.playing) togglePlay(); });

  // 🔴 宣告值逐字讀樣式表:1.5px 的 computed 值 chromium 量成 1px、webkit 給 1.5(M/N 段同款教訓),
  //    跨引擎比絕對值必假紅。這裡改比「樣式表裡宣告了什麼」,引擎無關。
  const decl = await page.evaluate(() => {
    for (const sh of document.styleSheets) {
      let rs; try { rs = sh.cssRules; } catch { continue; }
      for (const r of rs) {
        const sel = (r.selectorText || '').replace(/["']/g, '');
        if (sel.includes('.xc-empty') && sel.includes('.ph-empty') && sel.includes('#searchDrop .empty'))
          return r.style.cssText;
      }
    }
    return null;
  });
  ok(`R1 ${engine} 四處共用同一條規則,宣告 1.5px dashed 且沿用專案既有的 --line-dash`,
    !!decl && /1\.5px\s+dashed\s+var\(--line-dash\)/.test(decl), decl || '找不到規則');

  // ① 釘選卡:落在中央山脈(1.5 km 內沒有鐵路)
  // 🔴 要在開護照【之前】量:openRidePanel() 走 soloPanel,會把釘選卡關掉(右上欄諸卡擇一)
  await page.evaluate(() => openPinAt(23.50, 121.05));
  await page.waitForTimeout(400);
  const s0 = await page.evaluate(R_FRAME);
  const i0 = await page.evaluate(f => eval('(' + f + ')')('#pinCard .xc-empty', '.xing-card'), R_INSET.toString());
  // ② 護照:全新裝置沒有完乘記錄
  await page.evaluate(() => openRidePanel());
  await page.waitForTimeout(400);
  const s1 = await page.evaluate(R_FRAME);
  // ③ 車站看板:用 app 自己的計算找一個此刻真的沒有班次的站,不猜站名也不寫死時刻
  const pick = await page.evaluate(() => {
    setSimSec(3 * 3600 + 20 * 60); state.clockAtNow = false;
    for (const e of buildStnIndex().filter(s => s.sysId === 'tra_sched')) {
      if (schedBoardRows({ name: e.name, sys: e.sysId }).length === 0) {
        openBoard({ name: e.name, sys: e.sysId, lat: e.lat, lon: e.lon });
        return e.name;
      }
    }
    return null;
  });
  await page.waitForTimeout(500);
  const s2 = await page.evaluate(R_FRAME);
  const i2 = await page.evaluate(f => eval('(' + f + ')')('#board .empty', '#board'), R_INSET.toString());
  // ④ 搜尋:打一個不存在的車次(手機的搜尋框在 sheet 裡,沒開就不可見)
  await page.evaluate(() => openSearchPanel());
  await page.waitForTimeout(400);
  await page.fill('#trainSearch', '99999');
  await page.waitForTimeout(500);
  const s3 = await page.evaluate(R_FRAME);
  const i3 = await page.evaluate(f => eval('(' + f + ')')('#searchDrop .empty', '#searchDrop'), R_INSET.toString());

  for (const [k, v] of Object.entries({ 釘選卡: s0.pin, 護照: s1.pass, 看板: s2.board, 搜尋: s3.search })) {
    ok(`R2 ${engine} ${k} 空狀態量得到,而且長出虛線框`,
      !!v && v.style === 'dashed' && v.w > 0 && v.r > 0 && v.padL >= 10, JSON.stringify(v));
  }
  ok(`R3 ${engine} 正向對照:看板真的挑到一個沒有班次的站`, !!pick, `站=${pick}`);

  const insets = { 釘選卡: i0, 看板: i2, 搜尋: i3 };
  ok(`R5 ${engine} 三處的框都沒有貼齊容器邊緣(左右各 ≥8px)`,
    Object.values(insets).every(v => v && v.l >= 8 && v.r >= 8), JSON.stringify(insets));

  // 反向對照:有內容時不該長框——少了這條,「不分空不空一律加框」也會全綠。
  const rev = await page.evaluate(() => {
    setSimSec(8 * 3600 + 15 * 60); state.clockAtNow = false;
    const e = buildStnIndex().find(s => s.sysId === 'tra_sched' && s.name === '板橋')
      || buildStnIndex().find(s => s.sysId === 'tra_sched');
    openBoard({ name: e.name, sys: e.sysId, lat: e.lat, lon: e.lon });
    const rows = document.querySelectorAll('#board .row[data-no]').length;
    // 🔴 班次列本來就有虛線【分隔】(border-bottom),不能拿 borderTopStyle 判「有沒有被加框」;
    //    要判的是「有沒有長出四邊都在的框」,故量左緣——border 簡寫錯套會讓左緣也變虛線。
    return { rows, em: document.querySelectorAll('#board .empty').length,
      rowCs: rows ? getComputedStyle(document.querySelector('#board .row[data-no]')).borderLeftStyle : '' };
  });
  ok(`R4 ${engine} 反向對照:看板有班次時沒有空狀態框,班次列也沒被套上四邊框`,
    rev.rows > 0 && rev.em === 0 && rev.rowCs !== 'dashed', JSON.stringify(rev));

  ok(`R6 ${engine} 零 pageerror`, errs.length === 0, errs.slice(0, 1).join(''));
  await close();
}

// ── S 段:設計 14g 落釘模式常駐提示條 ────────────────────────────────────────────
// 🔴 這一段驗的是「點它會發生什麼」,不是「它長什麼樣」:一個只把提示條藏起來、卻沒有真的退出
//    模式的實作(很像樣的錯誤)在畫面上完全看不出差別——S8 因為連旗標、地圖游標與「釘」鈕的
//    標籤一起驗,才擋得住它(突變實測)。
async function sectionS(browser, engine) {
  for (const width of [393, 1280]) {
    const { page, errs, close } = await boot(browser, { width });
    await page.evaluate(() => { if (state.playing) togglePlay(); });
    const tag = `${engine} ${width}pt`;

    // 反向對照先做:沒開模式時它不該在——少了這條,「永遠顯示」也會讓下面整批全綠。
    const off0 = await page.evaluate(() => {
      const el = document.getElementById('pinHint');
      return { hidden: el.hidden, rects: el.getClientRects().length, drop: !!state.dropMode };
    });
    ok(`S1 ${tag} 反向對照:沒開落釘模式時提示條不存在於畫面上`,
      off0.hidden && off0.rects === 0 && !off0.drop, JSON.stringify(off0));

    await page.evaluate(() => state._setDropMode(true, true));
    await page.waitForTimeout(350);
    const on = await page.evaluate(() => {
      const el = document.getElementById('pinHint'), b = el.getBoundingClientRect();
      const ex = document.getElementById('pinHintExit'), eb = ex.getBoundingClientRect();
      const hit = document.elementFromPoint(eb.x + eb.width / 2, eb.y + eb.height / 2);
      const inter = (a, sel) => {
        const o = document.querySelector(sel); if (!o || !o.getClientRects().length) return false;
        const r = o.getBoundingClientRect();
        return !(a.right <= r.left || a.left >= r.right || a.bottom <= r.top || a.top >= r.bottom);
      };
      return { shown: !el.hidden && el.getClientRects().length > 0,
        txt: (el.textContent || '').replace(/\s+/g, ''), w: Math.round(b.width),
        inView: b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth,
        exW: Math.round(eb.width), exH: Math.round(eb.height),
        exHit: !!(hit && (hit === ex || ex.contains(hit))),
        hitTopbar: inter(b, '#topbar'), hitTabbar: inter(b, '#tabbar') };
    });
    ok(`S2 ${tag} 開了模式就有常駐提示,整條在視窗內`, on.shown && on.inView,
      JSON.stringify({ shown: on.shown, inView: on.inView, w: on.w }));
    ok(`S3 ${tag} 說明講明白「點地圖」與「不會收起面板」這個 1a 的例外`,
      on.txt.includes('落釘模式進行中') && on.txt.includes('點地圖') && on.txt.includes('不會收起面板'),
      on.txt.slice(0, 40));
    ok(`S4 ${tag} 出口鈕 ≥44 而且命中自己(沒被別的東西蓋住)`,
      on.exH >= 44 && on.exW >= 44 && on.exHit, JSON.stringify({ w: on.exW, h: on.exH, hit: on.exHit }));
    ok(`S5 ${tag} 提示條沒有壓到頂列或分頁列`, !on.hitTopbar && !on.hitTabbar,
      JSON.stringify({ 頂列: on.hitTopbar, 分頁列: on.hitTabbar }));

    // 卡與提示條共用同一個槽位(見 #pinHint 的 class),必須互斥而不是疊在一起
    await page.evaluate(() => openPinAt(23.50, 121.05));   // 中央山脈:1.5 km 內沒有鐵路
    await page.waitForTimeout(350);
    const withCard = await page.evaluate(() => ({
      card: !document.getElementById('pinCard').hidden,
      hint: !document.getElementById('pinHint').hidden, drop: !!state.dropMode }));
    ok(`S6 ${tag} 落釘之後卡接手、提示條讓位(同一個槽位不重疊)`,
      withCard.card && !withCard.hint && withCard.drop, JSON.stringify(withCard));

    await page.evaluate(() => closePinCard());
    await page.waitForTimeout(300);
    const back = await page.evaluate(() => ({
      hint: !document.getElementById('pinHint').hidden, drop: !!state.dropMode }));
    ok(`S7 ${tag} 收掉卡之後提示條回來(模式還開著)`, back.hint && back.drop, JSON.stringify(back));

    const eb = await page.evaluate(() => {
      const b = document.getElementById('pinHintExit').getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await page.mouse.click(eb.x, eb.y);          // 真的點下去
    await page.waitForTimeout(350);
    const after = await page.evaluate(() => ({
      drop: !!state.dropMode, hidden: document.getElementById('pinHint').hidden,
      cursor: map.getContainer().style.cursor,
      btn: document.querySelector('#pinBtn .tl').textContent }));
    ok(`S8 ${tag} 點「結束」真的退出落釘模式(旗標、地圖游標、鈕的標籤全部跟著回去)`,
      after.drop === false && after.hidden && after.cursor !== 'crosshair' && after.btn === '儲存',
      JSON.stringify(after));

    ok(`S9 ${tag} 零 pageerror`, errs.length === 0, errs.slice(0, 1).join(''));
    await close();
  }
}

// ── T 段:設計 16e 車種 chip 的關閉態——空心圓點,顏色留著 ─────────────────────────
// 🔴 核心是 T4:關閉態的框線色必須【逐字等於】開啟態的背景色。寫成「框線有顏色就好」的話,
//    改成固定灰框(＝把車種色吃掉,正是設計要擋的那件事)照樣全綠——突變實測 T3 綠、只有 T4 紅。
async function sectionT(browser, engine) {
  const { page, errs, close } = await boot(browser, { width: 1280 });
  await page.evaluate(() => { if (state.playing) togglePlay(); });
  await page.evaluate(() => {
    const b = document.getElementById('trackBtn') || document.querySelector('[data-proxy="trackBtn"]');
    if (b) b.click();
  });
  await page.waitForTimeout(500);
  const n0 = await page.evaluate(() => document.querySelectorAll('#lineToggles .chip').length);
  ok(`T1 ${engine} 正向對照:量得到車種 chip`, n0 >= 3, `chip=${n0}`);
  if (n0 < 3) { await close(); return; }

  const READ = sel => {
    const el = document.querySelector(sel); if (!el) return null;
    const d = el.querySelector('.dot'), cs = getComputedStyle(d);
    return { txt: el.textContent.trim(), bg: cs.backgroundColor, bw: parseFloat(cs.borderTopWidth),
      bc: cs.borderTopColor, deco: getComputedStyle(el).textDecorationLine,
      w: Math.round(d.getBoundingClientRect().width) };
  };
  const on = await page.evaluate(r => eval('(' + r + ')')('#lineToggles .chip:not(.off)'), READ.toString());
  ok(`T2 ${engine} 開著的圓點是實心(背景就是車種色,沒有框)`,
    !!on && on.bg !== 'rgba(0, 0, 0, 0)' && on.bw === 0, JSON.stringify(on));

  // 真的點一下關掉它(不是直接加 class)——連帶驗它有沒有真的切到篩選
  await page.evaluate(() => document.querySelector('#lineToggles .chip:not(.off)').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => ({
    vis: state.visible.size, cnt: document.querySelectorAll('#lineToggles .chip.off').length }));
  const box = await page.evaluate(() => {
    const b = document.querySelector('#lineToggles .chip:not(.off)').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(300);
  const off = await page.evaluate(r => eval('(' + r + ')')('#lineToggles .chip.off'), READ.toString());
  const after = await page.evaluate(() => ({
    vis: state.visible.size, cnt: document.querySelectorAll('#lineToggles .chip.off').length }));

  ok(`T3 ${engine} 關掉之後圓點變空心(背景透明、框線有寬度)`,
    !!off && off.bg === 'rgba(0, 0, 0, 0)' && off.bw > 0, JSON.stringify(off));
  ok(`T4 ${engine} 🔴 車種色沒有被狀態吃掉:關閉態的框線色逐字等於開啟態的背景色`,
    !!off && off.bc === on.bg && off.txt === on.txt,
    JSON.stringify({ 開啟背景: on.bg, 關閉框線: off && off.bc, 同一顆: !!off && off.txt === on.txt }));
  ok(`T5 ${engine} 關掉之後沒有刪除線(刪除線的語意是「沒了」,這裡只是「暫時不看」)`,
    !!off && !/line-through/.test(off.deco), off && off.deco);
  ok(`T6 ${engine} 圓點沒有因為多了框而變大(全域 box-sizing 有吃到)`,
    !!off && off.w === on.w, `開 ${on.w} / 關 ${off && off.w}`);
  ok(`T7 ${engine} 點下去真的切到篩選(可見車種 −1、關閉數 +1)`,
    after.vis === before.vis - 1 && after.cnt === before.cnt + 1, JSON.stringify({ before, after }));
  ok(`T8 ${engine} 零 pageerror`, errs.length === 0, errs.slice(0, 1).join(''));
  await close();
}


// ── U 段:設計 16e 全日流量圖——當下那根用印章紅、其餘藏青半透明,兩個主題各有色票 ─────
// 判準量的是 canvas 的【實際像素】不是 CSS 宣告:色碼寫死的舊版在 CSS 上一樣「有設色」,
// 差別只在畫出來是誰的顏色。🔴 U9/U10 是這段的重點——沒有它們,「暗色主題畫亮色色票」
// (drawSpark 的註解說它修過一次的同一個病)會 32/32 全綠穿過去,突變實測確認。
async function sectionU(browser, engine) {
  const got = {};
  for (const scheme of ['light', 'dark']) {
    const { page, errs, close } = await boot(browser, { width: 1280, scheme });
    const tag = `${engine}/${scheme}`;
    await page.evaluate(() => { if (state.playing) togglePlay(); });
    const st = await page.evaluate(() => ({
      hidden: document.getElementById('flowWrap').hidden,
      bins: state.flowBins ? state.flowBins.length : 0, max: state.flowMax,
    }));
    ok(`U1 ${tag} 正向對照:流量圖有顯示、有資料`, !st.hidden && st.bins > 0 && st.max > 1, JSON.stringify(st));
    if (st.hidden || !st.bins) { await close(); continue; }

    await page.evaluate(() => { setSimSec(17 * 3600 + 50 * 60); state.clockAtNow = false; drawFlow(); });
    await page.waitForTimeout(250);
    // 取第 i 根柱的柱身像素(避開頂緣抗鋸齒);柱高不足回 null
    const at = i => page.evaluate(j => {
      const c = document.getElementById('flowChart'), dpr = state.dpr || 1;
      const cssW = c.clientWidth, cssH = c.clientHeight, bw = cssW / FLOW_BINS;
      const h = state.flowBins[j] / state.flowMax * (cssH - 12);
      if (h < 3) return null;
      const d = c.getContext('2d').getImageData(
        Math.round((j * bw + Math.max(1, bw - 0.6) / 2) * dpr), Math.round((cssH - h / 2) * dpr), 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    }, i);
    const nowBin = await page.evaluate(() => Math.floor(state.simSec / 600) % FLOW_BINS);
    const pNow = await at(nowBin), pOther = await at((nowBin + 30) % 144);

    ok(`U2 ${tag} 當下那根是不透明的印章紅`,
      !!pNow && pNow[3] > 240 && pNow[0] > pNow[2] + 60, JSON.stringify({ nowBin, px: pNow }));
    ok(`U3 ${tag} 其餘的柱是藏青【半透明】(alpha 明顯低於飽和)`,
      !!pOther && pOther[3] > 60 && pOther[3] < 200 && pOther[2] > pOther[0], JSON.stringify(pOther));
    ok(`U4 ${tag} 🔴 兩者不同色(不是整排同色再疊東西上去)`,
      !!pNow && !!pOther && (Math.abs(pNow[0] - pOther[0]) > 40 || Math.abs(pNow[3] - pOther[3]) > 40),
      JSON.stringify({ 當下: pNow, 其餘: pOther }));
    ok(`U5 ${tag} 柱色不再是寫死的 #8fa8c6(143,168,198)`,
      !!pOther && !(pOther[0] === 143 && pOther[1] === 168 && pOther[2] === 198), JSON.stringify(pOther));

    // 深夜台鐵幾乎沒車 ⇒ 當下那根柱高趨近 0(實測 0.5px)。設計稿是 17:50 畫的,柱夠高所以
    // 看不到這個情況;照字面只塗紅、不留貫穿全高的游標線,「現在在哪」會整個消失。
    await page.evaluate(() => { setSimSec(3 * 3600 + 30 * 60); state.clockAtNow = false; drawFlow(); });
    await page.waitForTimeout(250);
    const night = await page.evaluate(() => {
      const c = document.getElementById('flowChart'), dpr = state.dpr || 1;
      const cssW = c.clientWidth, cssH = c.clientHeight;
      const i = Math.floor(state.simSec / 600) % FLOW_BINS;
      const barH = state.flowBins[i] / state.flowMax * (cssH - 12);
      const x = Math.round(state.simSec / 86400 * cssW * dpr);
      const d = c.getContext('2d').getImageData(Math.max(0, x - 2), 0, 5, Math.round(cssH * dpr * 0.5)).data;
      let red = 0;
      for (let k = 0; k < d.length; k += 4) if (d[k + 3] > 100 && d[k] > d[k + 2] + 50) red++;
      return { barH: +barH.toFixed(1), redPxUpperHalf: red };
    });
    ok(`U6 ${tag} 🔴 深夜柱高趨近 0 時「現在」仍找得到(上半部有貫穿的紅)`,
      night.redPxUpperHalf > 5, JSON.stringify(night));

    const jump = await page.evaluate(async () => {
      const c = document.getElementById('flowChart'), b = c.getBoundingClientRect();
      const before = state.simSec, mode = state.mode;
      c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: b.x + b.width * 0.5, clientY: b.y + b.height / 2 }));
      await new Promise(r => setTimeout(r, 200));
      return { mode, before, after: state.simSec, moved: Math.abs(state.simSec - before) > 600 };
    });
    ok(`U7 ${tag} 點圖表仍會跳到該時刻(mode=${jump.mode})`, jump.mode !== 'sched' || jump.moved, JSON.stringify(jump));

    // 刻度色這輪也換成隨主題的值(原本暗色畫的是亮色的奶油色)。canvas 是透明底、紙色由
    // CSS 畫在後面 ⇒「看不看得見」＝刻度色與 --paper 的亮度差。
    const tick = await page.evaluate(() => {
      const c = document.getElementById('flowChart'), dpr = state.dpr || 1;
      const cssW = c.clientWidth, cssH = c.clientHeight;
      const d = c.getContext('2d').getImageData(0, Math.round((cssH - 2) * dpr), Math.round(cssW * dpr), 1).data;
      let best = null;
      for (let k = 0; k < d.length; k += 4)
        if (d[k + 3] > 200 && !(d[k] > 150 && d[k] > d[k + 2] + 60)) { best = [d[k], d[k + 1], d[k + 2], d[k + 3]]; break; }
      const pap = getComputedStyle(c).backgroundColor.match(/\d+/g).map(Number);
      const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return { tick: best, paper: pap, d: best ? Math.round(Math.abs(lum(best) - lum(pap))) : null };
    });
    ok(`U11 ${tag} 整點刻度與紙底有對比(暗色不能沿用亮色的奶油色,也不能低到看不見)`,
      !!tick.tick && tick.d >= 30, JSON.stringify(tick));
    ok(`U8 ${tag} 零 pageerror`, errs.length === 0, errs.slice(0, 1).join(''));
    got[scheme] = { bar: pOther, now: pNow };
    await close();
  }
  const L = got.light, D = got.dark;
  const diff = (a, b) => !!a && !!b && a.some((v, i) => Math.abs(v - b[i]) > 20);
  ok(`U9 ${engine} 🔴 兩個主題畫出來的柱色【真的不同】(色票有跟著主題翻面)`,
    diff(L && L.bar, D && D.bar), JSON.stringify({ 亮: L && L.bar, 暗: D && D.bar }));
  ok(`U10 ${engine} 🔴 兩個主題的「當下」色也不同`,
    diff(L && L.now, D && D.now), JSON.stringify({ 亮: L && L.now, 暗: D && D.now }));
}

await assertTarget();
// SECTIONS=H,I 只跑指定段(突變測試用);不設就跑全部——預設永遠是「全跑」,不能靠環境變數才完整。
const ALL = { A: sectionA, B: sectionB, C: sectionC, D: sectionD, E: sectionE, F: sectionF, G: sectionG, H: sectionH, I: sectionI, J: sectionJ, K: sectionK, L: sectionL, M: sectionM, MX: sectionMx, N: sectionN, NX: sectionNx, O: sectionO, P: sectionP, Q: sectionQ, R: sectionR, S: sectionS, T: sectionT, U: sectionU };
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
