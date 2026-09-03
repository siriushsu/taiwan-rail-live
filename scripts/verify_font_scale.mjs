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
//   C 段 契約:系統字級的正反向對照
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

async function boot(browser, { width = 393, tier = 'std', query = '', scheme, native = null } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    ...(scheme ? { colorScheme: scheme } : {}),   // 不傳＝沿用 Playwright 預設,既有各段行為不變
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(a => {
    localStorage.setItem('trainmap-howto-seen', '1');                 // 首訪教學卡會蓋住地圖與頂列
    localStorage.setItem('iabHintDismiss', String(Date.now() + 1e9)); // 內嵌瀏覽器提示同理
    if (a.t !== 'std') localStorage.setItem('trainmap-fontscale', a.t);
    // 只有原生殼會注入的旗標(末班車提醒鈴鐺靠它才出現);瀏覽器驗收要驗三顆鈕的版面時才傳
    if (a.native) for (const k of a.native) window[k] = true;
  }, { t: tier, native });
  await page.goto(URL_BASE + query, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.ready, null, { timeout: 45000 })
    .catch(() => {});
  await page.waitForTimeout(600);
  return { page, errs, close: () => ctx.close() };
}

// ── 群組切換器:兩種形態共用的解析與真觸控 ────────────────────────────────────
// 🔴 2026-08-27 起手機殼把四顆群組分頁(全／台／高／捷)收成一顆 #gtabOne,點開才出選單。
//    腳本一律「解析出當下真的渲染出來的那一種」,不寫死是哪一種:寫死一種,另一種上線時
//    querySelectorAll 會回空陣列,而「空陣列裡沒有東西溢出視窗」恆真 ⇒ 整批判準無聲假綠
//    (心得 37d:覆蓋率本身要有具名斷言)。所以下面每一處用到它的地方都先驗「解析得到」。
const GS_RESOLVE = () => {
  const shown = e => !!e && !e.hidden && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
  // 🔴 `.grouptabs` 全頁有兩組:桌面 header 一組、手機 topbar 一組。收合鈕只存在於手機那組,
  //    但四顆分頁要掃**全頁**——桌面殼根本不渲染 .topbar,只掃 .topbar 會在桌面回「兩種都沒有」。
  const one = document.querySelector('.topbar .gtab-one');
  const tabs = [...document.querySelectorAll('.grouptabs .gtab')].filter(shown);
  return { kind: shown(one) ? 'one' : (tabs.length ? 'tabs' : null), oneShown: shown(one), tabsN: tabs.length,
    scope: tabs.length && tabs[0].closest('.topbar') ? 'topbar' : (tabs.length ? 'header' : null) };
};
// 真的用手指點一次換組(不是 selectGroup(),那繞過整條命中/熱區路徑)。
// 收合鈕形態:點鈕 ⇒ 選單 ⇒ 點那一列;四顆形態:直接點那顆。回傳換完的 state.group。
async function tapGroupByShort(page, short) {
  const kind = (await page.evaluate(GS_RESOLVE)).kind;
  if (kind === 'one') {
    await page.tap('.topbar .gtab-one');
    await page.waitForTimeout(260);
    const rows = page.locator('#gtabPop .gp-row');
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      if ((await rows.nth(i).locator('.gp-sh').textContent() || '').trim() === short) {
        await rows.nth(i).tap(); break;
      }
    }
  } else if (kind === 'tabs') {
    const tabs = page.locator('.grouptabs:visible .gtab');
    const n = await tabs.count();
    for (let i = 0; i < n; i++) {
      if ((await tabs.nth(i).textContent() || '').trim() === short) { await tabs.nth(i).tap(); break; }
    }
  }
  await page.waitForTimeout(900);
  // 🔴 `state` 是頁面的 top-level const,不是 window 的屬性 ⇒ `window.state` 恆 undefined
  //    (寫成 `window.state && state.group` 會短路成 undefined,判準看起來像產品壞了)
  return { kind, group: await page.evaluate(() => typeof state !== 'undefined' ? state.group : null) };
}

// ── A 段:幾何——放大之後還在不在畫面裡 ────────────────────────────────────────
// 判準寫「四顆分頁的 rect 全部在視窗內」而不是「頂列高度 <= N px」:後者是會隨文案漂移的魔術數字。
async function sectionA(browser, engine) {
  for (const tier of ['std', 'large', 'xlarge']) {
    for (const width of [360, 393, 414]) {
      const { page, errs, close } = await boot(browser, { width, tier });
      // 捷運群組=最長的鄰站名(南港展覽館／頂埔),是頂列最擠的常態組合。
      // 真觸控換組(收合鈕形態就是「點鈕→點選單那一列」),順便當這一段的前置條件。
      const sw = await tapGroupByShort(page, '捷');
      const r = await page.evaluate(() => {
        const vis = e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
        // 🔴 量的是「當下真的渲染出來的那個群組切換器」:收合鈕形態算一顆,四顆分頁形態算四顆。
        //    寫死其中一種,另一種上線時這裡會回空陣列而下面的「沒有東西溢出」恆真(假綠)。
        const one = document.querySelector('.topbar .gtab-one');
        const shownOne = one && !one.hidden && getComputedStyle(one).display !== 'none' && one.getClientRects().length > 0;
        const tabs = shownOne ? [one] : [...document.querySelectorAll('.topbar .grouptabs .gtab')].filter(vis);
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
        // 🔴 收合鈕把字包在 <span class=go-tx> 裡,textBox() 只找**直接**子文字節點 ⇒ 會回 null,
        //    而「null 就 return false」讓 selfClipped 變成空集合恆真(判準還在,但不再檢查任何東西)。
        //    所以量的對象一律取「真的帶著字的那個元素」。
        const labelOf = e => e.querySelector('.go-tx') || e;
        const selfClipped = tabs.filter(el => {
          const t = labelOf(el);
          const tb = textBox(t); if (!tb) return false;
          const cs = getComputedStyle(t), b = t.getBoundingClientRect();
          const iw = b.width - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
          const ih = b.height - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
          return tb.width > iw + 0.5;   // 只判水平:沒有 overflow:hidden 的話垂直切不掉,
                                         // 而 line-height:normal 的墨跡框本來就比行框高零點幾 px(心得 25)
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
        const sibs = [...bar.querySelectorAll('.tb-logo,.alert-chip,.grouptabs .gtab,.gtab-one,.tb-plate')]
          .filter(e => e.getClientRects().length && +getComputedStyle(e).opacity >= 0.5);
        const sibOverlap = +Math.max(0, ...sibs.map(e => area(gr, e.getBoundingClientRect())), 0).toFixed(0);
        return { n: tabs.length, kind: shownOne ? 'one' : 'tabs', outside, selfClipped, labelInside: tl.bottom <= innerHeight + 0.5,
          bothVisible: br.height > 0 && gr.height > 0,
          topStackOverlap: +area(br, gr).toFixed(0),
          badgeInBar: inBar, badgeContained: contained, sibOverlap, sibN: sibs.length,
          badgeInlineTop: bg.style.top };
      });
      const tag = `${engine} ${tier} ${width}pt`;
      // A1 正向對照:切換器真的量得到,而且**真的按得動**(tapGroupByShort 已經按過一次)。
      // 兩種形態各自寫死自己的顆數,少了任何一半都會讓另一種形態無條件通過。
      ok(`A1 ${tag} 正向對照:群組切換器量得到(${r.kind === 'one' ? '收合成一顆' : '四顆分頁'})且真的按得動`,
        (r.kind === 'one' ? r.n === 1 : r.n === 4) && sw.group === 'metro',
        `kind=${r.kind} n=${r.n} 換組後 state.group=${sw.group}`);
      // 2026-08-26:原本這裡對「標準檔 360pt」開了豁免——網站分支既有的「捷」被切缺陷
      // (memory:topbar-cut-fix-only-on-app-branch,同段 CSS 兩分支相反)。合併進 App 出貨線之後
      // 實測 outside 為空 ⇒ 該缺陷在這棵樹上已經不存在,豁免變成沒有牙的過期條款,拆掉。
      ok(`A2 ${tag} 切換器在視窗內`, r.outside.length === 0, r.outside.join(','));
      ok(`A3 ${tag} 切換器的字沒有被自己的框切掉`, r.selfClipped.length === 0, r.selfClipped.join(','));
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

// ── C 段:契約——系統字級 ────────────────────────────────────────────
async function sectionC(browser, engine) {
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
        // 🔴 標籤指名「不是列尾的那個 span」而不是 firstElementChild:2026-08-27 之前每一列
        //    最前面還有一顆單字圓章,照舊寫法量到的是【圓章】(12px)——判準會拿章當標籤,
        //    std 的主倍率被算成 0.89× 而恆紅。章拿掉了,這個寫法照樣對,而且列形再變也不會錯位。
        const labEl = fsRow.querySelector(':scope > span:not(.ms-tail)');
        const lab = R(labEl), val = R(fsRow.querySelector('#msFontVal')),
          chev = R(fsRow.querySelector('.ms-tail .chev')), rr = R(fsRow);
        return {
          n: rows.length,
          minH: Math.min(...rows.map(x => x.getBoundingClientRect().height)),
          secPx: sec ? px(sec) : null,
          labPx: px(labEl),
          stacked: val.y >= lab.y + lab.h - 1,
          inline: Math.abs(val.y - lab.y) < 3,
          valLeft: Math.abs(val.x - lab.x) < 3,
          chevRight: chev.x + chev.w >= rr.x + rr.w - 26,
          chevMid: Math.abs((chev.y + chev.h / 2) - (rr.y + rr.h / 2)) < 6,
          lines: Math.round(rr.h),
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
      // 圓章要跨著兩行垂直置中,不是被擠在第一行:特大級那條 grid 規則的標籤選擇器一旦對不到,
      // 整列會退化成「章與 › 各佔第一行、值排在標籤上面」——那個形狀 F2(列高)照樣過。
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
  const mc = window.__map.getContainer().getBoundingClientRect();
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
    const mc = window.__map.getContainer().getBoundingClientRect();
    for (const t of (state.trains || [])) {
      if (!state.visible.has(t.typeName)) continue;
      const pos = trainPos(t, state.simSec);
      if (!pos) continue;
      const pt = window.__M.toScreen(L.latLng(pos.lat, pos.lon));
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
    const mc = window.__map.getContainer().getBoundingClientRect();
    const pt = window.__M.toScreen(L.latLng(pos.lat, pos.lon));
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
    const mc = window.__map.getContainer().getBoundingClientRect();
    for (const t of (state.trains || [])) {
      if (!state.visible.has(t.typeName)) continue;
      const pos = trainPos(t, state.simSec);
      if (!pos) continue;
      const pt = window.__M.toScreen(L.latLng(pos.lat, pos.lon));
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
    const mc = window.__map.getContainer().getBoundingClientRect();
    const pt = window.__M.toScreen(L.latLng(pos.lat, pos.lon));
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
  // 🔴 2026-08-27 裁示推翻 08-22 的「一律收成色點」:「現在已經把右邊四個按鈕縮小的狀況下,
  //    時間按鈕其實可以直接寫詳細資訊了。」⇒ 新契約是「排得下就寫字,排不下才**逐顆**降級成色點」。
  //    舊判準(全部都必須是色點)照抄過來只會擋住裁示,所以整條改寫成三件事:
  //    I2  形態純度——每顆亮著的旗標要嘛是可讀的字、要嘛是 7px 圓點,不准有第三種(字被壓成 1px、
  //        色點變方形都算)。
  //    I2b 降級順序——色點集合必須是降級優先序的**前綴**(metro→尖峰→重播→即時);
  //        跳過低優先的先降高優先的就是壞了。
  //    I2c 反向對照——把最後降級的那一顆放回文字,整排必須**真的**塞不下。少了這條,
  //        「乾脆永遠全部收成色點」照樣全綠(那正是舊判準的樣子)。
  const fitProbe = await page.evaluate(() => {
    const DEG = ['metroBadge', 'peak', 'liveBadge'];
    const bar = document.getElementById('topbar');
    if (!bar) return { err: 'no-topbar' };
    const plate = bar.querySelector('.tb-plate');
    const els = DEG.map(id => document.getElementById(id))
      .filter(e => e && !e.hidden && e.getClientRects().length && e.textContent.trim());
    const form = e => {
      const b = e.getBoundingClientRect(), cs = getComputedStyle(e), fs = parseFloat(cs.fontSize);
      if (Math.abs(b.width - b.height) <= 1 && b.width <= 10 && fs === 0 && /50%|999/.test(cs.borderRadius)) return 'dot';
      if (fs >= 9 && b.width > b.height) return 'text';
      return `其他(w=${b.width.toFixed(1)} h=${b.height.toFixed(1)} fs=${fs} br=${cs.borderRadius})`;
    };
    const forms = els.map(e => ({ id: e.id, form: form(e) }));
    const dots = forms.map(f => f.form === 'dot');
    const prefixOk = dots.every((d, i) => !d || dots.slice(0, i).every(Boolean));
    const bs = getComputedStyle(bar);
    const room = bar.clientWidth - (parseFloat(bs.paddingLeft) || 0) - (parseFloat(bs.paddingRight) || 0) + 0.5;
    const gap = parseFloat(bs.gap) || 0;
    const need = () => {
      const k = [...bar.children].filter(e => e.getClientRects().length && getComputedStyle(e).position !== 'absolute');
      return k.reduce((a, e) => a + e.getBoundingClientRect().width, 0) + gap * Math.max(0, k.length - 1);
    };
    let undo = null;                       // null = 這一輪沒有任何一顆降級,不適用
    const lastDotIdx = dots.lastIndexOf(true);
    if (lastDotIdx >= 0) {
      const e = document.getElementById(forms[lastDotIdx].id);
      e.classList.remove('as-dot');
      // 🔴 量之前要把軌島牌釘成 flex:none——跟 fitBadgeDetail() 自己那一段同一招,理由也同一個:
      //    牌是這條列上唯一可縮的東西(2026-08-29 起全字級通用,原本只有大/特大),不釘的話多出來的
      //    寬度會被 flex 從牌身上吃掉,need 量到的永遠是「剛好不溢出」⇒ 這條反向對照結構上不可能
      //    成立,會把「降級是必要的」誤判成「降級是多餘的」。
      const prev = plate ? plate.style.flex : null;
      if (plate) plate.style.flex = 'none';
      undo = { id: e.id, need: +need().toFixed(1), room: +room.toFixed(1) };
      if (plate) { if (prev) plate.style.flex = prev; else plate.style.removeProperty('flex'); }
      e.classList.add('as-dot');
    }
    return { forms, prefixOk, undo, room: +room.toFixed(1), need: +need().toFixed(1) };
  });
  ok(`I2 ${tag} 每顆亮著的狀態旗標不是可讀的字就是 7px 色點(沒有第三種)`,
    !fitProbe.err && fitProbe.forms.length >= 1 && fitProbe.forms.every(f => f.form === 'dot' || f.form === 'text'),
    JSON.stringify(fitProbe.forms));
  ok(`I2b ${tag} 降級照優先序:色點是「metro→尖峰→重播→即時」的前綴`,
    !fitProbe.err && fitProbe.prefixOk, JSON.stringify(fitProbe.forms));
  ok(`I2c ${tag} 反向對照:最後降級的那顆放回文字就真的塞不下(降級是必要的)`,
    !fitProbe.err && (fitProbe.undo === null || fitProbe.undo.need > fitProbe.undo.room),
    fitProbe.undo ? `${fitProbe.undo.id} 放回文字後需要 ${fitProbe.undo.need} > 可用 ${fitProbe.undo.room}`
                  : `這一輪沒有任何一顆降級(整排 ${fitProbe.need} ≤ 可用 ${fitProbe.room}),不適用`);
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
        live: row('msStatLive'), metro: row('msStatMetro'), count: row('msStatCount'),
        srcLive: src('liveBadge'), srcMetro: src('metroBadge'), srcCount: src('count'),
        liveHidden: !!document.getElementById('liveBadge').hidden };
    });
  };
  const A = await open();
  ok(`I4 ${tag} 正向對照:「資料狀態」段與至少兩列真的畫出來`,
    A.secDrawn && [A.live, A.metro, A.count].filter(r => r.drawn).length >= 2,
    `sec=${A.secDrawn} live=${A.live.drawn} metro=${A.metro.drawn} count=${A.count.drawn}`);
  // 鏡射契約:值必須逐字等於徽章的字(徽章寫「官方即時」就顯示「官方即時」)。
  // 這條擋的是「另寫一份判斷」——兩份判斷遲早跟徽章分岔,而分岔時畫面看起來完全正常。
  // 後綴「・非即時」＝那顆燈掛著 .est(資料現在不新鮮)。2026-08-27 之前這裡寫「・推算」,
  // 隨徽章字樣一起改;舊字樣刻意不留在判準裡——留著等於允許它悄悄倒退回去。
  const mirrored = (r, src) => !r.drawn || src == null || r.val === src || r.val === src + '・非即時';
  ok(`I5 ${tag} 資料狀態的值逐字鏡射徽章`,
    mirrored(A.live, A.srcLive) && mirrored(A.metro, A.srcMetro) && mirrored(A.count, A.srcCount),
    `live「${A.live.val}」vs「${A.srcLive}」metro「${A.metro.val}」vs「${A.srcMetro}」count「${A.count.val}」vs「${A.srcCount}」`);
  // 反向對照①:徽章那顆藏起來 ⇒ 對應列必須整列消失(高度 0)。
  // .ms-row 的 display:flex 蓋得過 [hidden],沒補規則的話這條會紅——正是它要擋的東西。
  // 🔴 這裡要先把 updateLiveBadge 凍住:它每一拍都重寫 `el.hidden = !on && !out`,
  //    而 open() 中間有 600ms 等待 ⇒ 產品的下一拍會把測試設的 hidden 撤銷,I6 就以
  //    `drawn=true h=48`(跟 I7 期望值一模一樣)報一個假的產品失敗。2026-08-27 的 full run
  //    在 chromium 撞到一次、單獨重跑兩輪都綠——機器有載時那一拍更容易落在等待窗裡。
  //    凍的是「誰去改 hidden」這個無關變因,不是受測物:受測物是「hidden 的列會不會塌成 0 高」。
  await page.evaluate(() => {
    window.__realULB = window.updateLiveBadge;
    window.updateLiveBadge = () => {};
    document.getElementById('liveBadge').hidden = true;
  });
  const B = await open();
  // 前置條件要自己驗(心得 17):mutation 沒撐住就不能拿結果當產品判準
  ok(`I6a ${tag} 前置·徽章真的還藏著(產品的下一拍沒把它撤銷)`, B.liveHidden === true, `hidden=${B.liveHidden}`);
  ok(`I6 ${tag} 反向對照:徽章藏起來 ⇒ 該列整列消失`,
    !B.live.drawn && B.live.h === 0, `drawn=${B.live.drawn} h=${B.live.h}`);
  await page.evaluate(() => { if (window.__realULB) window.updateLiveBadge = window.__realULB; });
  // 反向對照②:旗標從暗變亮 ⇒ 對應列必須出現。改拿捷運看板燈當受測旗標(REPLAY 燈已隨 OBS 模式刪除)。
  // 它在捷運即時資料在場時本來就亮,所以不能假設它暗:先凍住 updateMetroBadge(同 I6 凍 updateLiveBadge 的理由)
  // 把它弄暗、驗過那一列真的塌成 0 高(前置),再點亮驗列出現——沒有這個前置,「本來就亮」會讓 I7 恆真。
  await page.evaluate(() => {
    window.__realUMB = window.updateMetroBadge;
    window.updateMetroBadge = () => {};
    document.getElementById('metroBadge').hidden = true;
  });
  const B2 = await open();
  ok(`I7a ${tag} 前置·捷運看板燈弄暗後該列真的消失`, !B2.metro.drawn && B2.metro.h === 0, `drawn=${B2.metro.drawn} h=${B2.metro.h}`);
  await page.evaluate(() => {
    const r = document.getElementById('metroBadge');
    r.hidden = false; r.textContent = '看板校正';
  });
  const C = await open();
  ok(`I7 ${tag} 反向對照:旗標亮起來 ⇒ 該列出現`, C.metro.drawn && C.metro.h > 0,
    `drawn=${C.metro.drawn} h=${C.metro.h}`);
  await page.evaluate(() => { if (window.__realUMB) window.updateMetroBadge = window.__realUMB; });
  ok(`I8 ${tag} 零 pageerror`, errs.length === 0, errs.slice(0, 1).join(''));
  await close();
}

// ── J 段:整合卡(設計 D1–D3)——跟車中開車站看板 ⇒ 同一張卡兩個分頁 ─────────────
// 設計狀態機:D1 跟車·這班車／D2 跟車·這一站(跟車不斷)／D3 沒跟車(卡頭是站名、分頁列不出現)。
// 🔴 這一段最容易壞的地方不是樣式,是 **DOM 搬遷的生命週期**:看板每次重繪都 `innerHTML = …`,
//    搬進去的 #followPanel 會跟著被銷毀(實作第一版就是這樣炸的)。J5/J7 專門守這件事。
async function followSomeTrain(page) {
  return page.evaluate(() => {
    const mc = window.__map.getContainer().getBoundingClientRect();
    for (const t of (state.trains || [])) {
      if (!state.visible.has(t.typeName)) continue;
      const pos = trainPos(t, state.simSec);
      if (!pos) continue;
      const pt = window.__M.toScreen(L.latLng(pos.lat, pos.lon));
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
    const mc = window.__map.getContainer().getBoundingClientRect();
    const pt = window.__M.toScreen(L.latLng(pos.lat, pos.lon));
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
  const mc = window.__map.getContainer().getBoundingClientRect();
  const nearestStn = cp => {
    let bd = 1e9;
    for (const st of (state.schedStations || [])) {
      const q = window.__M.toScreen([st.lat, st.lon]);
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
    const mc = window.__map.getContainer().getBoundingClientRect();
    const q = window.__M.toScreen(L.latLng(pos.lat, pos.lon));
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
    // 兩段制(2026-08-26):大段('large'／.expand)已退役,判法逐字對齊 app 自己的 sheetSizeOf()
    size: bd.classList.contains('sheet-small') ? 'small' : 'medium',
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
// 設計 -前段3 TURN 3 的 3a:詳細＝展開態,「一個捲軸從摘要到停靠表,不用學新導覽」,
// 小段看不出下面還有東西 ⇒ 卡緣一條「往上拉看詳細」。
// 2026-08-26 兩段制:展開態＝中段 46%(原 88% 大段已退役),提示列只在小段出現。
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

  // 點它 → 最大段(兩段制＝中段 46%);提示列自己收掉(已經看得到了)
  // 🔴 點不到不可以用拋例外收場:那會把整段帶走,L7 之後全部沒跑到而輸出只看得到幾條紅
  //    (突變測試實測:把提示列藏起來 ⇒ 只剩 13 筆結果,L7 這條反向對照根本沒發言)。記一筆紅再往下走。
  const clicked = await page.locator('.uni-more').click({ timeout: 5000 }).then(() => true, () => false);
  await page.waitForTimeout(900);
  const B = await snap();
  const paint88 = await slotPaints(page);
  ok(`L6 ${tag} 點提示列 ⇒ 段高變最大段,提示列自己收掉,而且那一頁真的畫得出來`,
    clicked && B.size === 'medium' && !B.hintVis && B.following && B.fpInSlot && paint88.painted,
    JSON.stringify({ 點得到: clicked, 有畫東西: paint88.painted, 區域: paint88.note, ...B }));
  // 🔴 第二種證據(心得 24 的雙證據):卡到根的累乘不透明度＝1,且卡內容中心點打到的是卡自己。
  //    契約③ 淡出時 opacity 0＋pointer-events:none,兩者會同時倒——而 DOM 檢查全綠。
  ok(`L12 ${tag} 展開段那一頁不是透明的:不透明度 1 且卡內容命中自己`,
    B.fpOpacity === 1 && B.cardHit, JSON.stringify({ opacity: B.fpOpacity, 命中卡: B.cardHit }));
  // 反向對照:回到小段提示列要回來——少了這半,「提示列永遠不顯示」也會讓 L6 過。
  // 兩段制之後提示列只掛在小段(中段已經看得到下面了),所以反向對照的目標段是 small。
  await page.evaluate(() => setSheetSize(document.getElementById('board'), 'small'));
  await page.waitForTimeout(900);
  const C = await snap();
  ok(`L7 ${tag} 反向對照:回到小段提示列又出現,而且照樣命中自己`,
    C.size === 'small' && C.hintVis && C.hintHit,
    JSON.stringify({ size: C.size, hintVis: C.hintVis, hit: C.hintHit }));

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
    // 🔴 四張都要測命中,不是只測第一張(並排元件的熱區重疊是這個 repo 踩過的坑)。
    //    2026-08-26:每張先捲進視野再打點——兩段制之後面板最高只到 46%,特大字級的四張卡
    //    (98px×4)本來就裝不進一屏,原本「四張同時打得到」其實是靠已退役的 88% 大段才成立的,
    //    那是段高的副作用不是熱區的性質。要驗的是「每一張各自命中自己(沒有互相蓋住)」,
    //    所以捲到它面前再打點;打完把捲動位置還原,不影響後面的判準。
    hits: (() => { const pn = document.getElementById('explorePanel'); const t0 = pn.scrollTop;
      const r0 = cards.map(c => { const r = c.getBoundingClientRect();
        if (!(r.width > 2 && r.height > 2)) return false;
        c.scrollIntoView({ block: 'center' });
        const b = c.getBoundingClientRect();
        const q = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return !!(q && q.closest('.hl-card') === c); });
      pn.scrollTop = t0; return r0; })(),
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
  // 撐到最大段:直接讀 app 自己的段位清單,免得段制再變一次時這裡又留著一個不存在的段名
  // (2026-08-26 兩段制上路時就是這樣留下 'large' ⇒ 面板只到 46%、後兩張卡掉出視野)
  await page.evaluate(() => setSheetSize(document.getElementById('explorePanel'), SHEET_SIZES[SHEET_SIZES.length - 1]));
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

// ── Q 段:更多選單——四段分組 ＋「每一列前面不再有單字圓章」(2026-08-27 使用者指示)────
// 這一段本來驗的是設計 3d 的單字圓章(Q1「每一列都有一顆帶字的圓章」/ Q2 字不重複 /
// Q10 章不撐高)。使用者 2026-08-27 明示「每一行前面都有一個字,那個有點多餘,改掉」⇒
// 契約整個反過來:圓章一顆都不准留。其餘幾條(標籤對齊、尾巴貼右、列高與命中、分組標題、
// 舊臨時符號不回來)與圓章無關,原樣保留——它們守的是「拆掉圓章時沒有把版面一起拆壞」。
const Q_SNAP = () => {
  const sheet = document.getElementById('moreSheet');
  const rows = [...sheet.querySelectorAll('.ms-row')].filter(r => r.offsetParent !== null || !r.hidden);
  const vis = r => r.getClientRects().length > 0 && getComputedStyle(r).display !== 'none';
  const info = r => {
    // 摺線以下的列要先捲進來再做命中測試(心得 19:量到的否則是「首屏看不到」不是「點不到」)
    r.scrollIntoView({ block: 'center' });
    const label = r.querySelector('span:not(.chev):not(.seg):not(.toggle):not(.ms-tail)');
    const rr = r.getBoundingClientRect();
    const tail = r.querySelector('.chev, .toggle, .seg, .ms-tail');
    return { stat: r.classList.contains('ms-stat'), vis: vis(r),
      ic: r.querySelector('.ms-ic') ? (r.querySelector('.ms-ic').textContent || '').trim() : null,
      labelLeft: label ? +(label.getBoundingClientRect().left - rr.left).toFixed(1) : null,
      txt: label ? (label.textContent || '').trim() : '',
      h: +rr.height.toFixed(1),
      tailRight: tail ? +(rr.right - tail.getBoundingClientRect().right).toFixed(1) : null,
      // 真的點得到嗎:命中列的中央偏左(標籤區),要落在這一列裡面
      hit: (() => { const el = document.elementFromPoint(rr.left + rr.width * 0.4, rr.top + rr.height / 2);
        return !!(el && el.closest('.ms-row') === r); })() };
  };
  return { open: sheet.classList.contains('open') || getComputedStyle(sheet).transform !== 'none',
    icCount: sheet.querySelectorAll('.ms-ic').length,
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
  // 正向對照先確認選單真的開著且有列可量——少了這半,「選單根本沒開」也會讓下面每一條全綠
  ok(`Q1 ${tag} 正向對照:更多開得起來,動作列量得到`, act.length >= 10,
    JSON.stringify({ 動作列: act.length, 讀數列: stat.length }));
  // 🔴 本段的主判準:圓章整組拿掉(整張選單一顆都不准有,包含 JS 動態建的列)
  ok(`Q2 ${tag} 每一列前面都沒有單字圓章了`, A.icCount === 0 && act.every(r => !r.ic),
    JSON.stringify({ 選單內圓章數: A.icCount, 還帶章的列: act.filter(r => r.ic).map(r => r.txt) }));
  // 標籤起點要一致、尾巴仍貼右:拆掉圓章那一欄之後最容易壞的就是這兩件
  const lefts = [...new Set(act.map(r => Math.round(r.labelLeft)))];
  ok(`Q3 ${tag} 所有動作列的標籤起點對齊,尾巴仍貼右`,
    lefts.length === 1 && act.every(r => r.tailRight == null || r.tailRight <= 20),
    JSON.stringify({ 標籤左緣: lefts, 尾巴離右緣: [...new Set(act.map(r => r.tailRight))] }));
  // 讀數列(唯讀)原本靠一段等寬縮排去對齊帶章的動作列;章拆了縮排也要拆,不然反而是它凸出來
  ok(`Q4 ${tag} 資料狀態列與動作列的標籤起點一致(縮排也一起拆乾淨了,現身 ${stat.length} 列)`,
    stat.length >= 1 && stat.every(r => r.labelLeft != null && Math.abs(r.labelLeft - lefts[0]) <= 2),
    JSON.stringify({ 讀數列: stat.length, 左緣: [...new Set(stat.map(r => r.labelLeft))], 動作列左緣: lefts }));
  ok(`Q5 ${tag} 四段分組標題都在`,
    ['地圖顯示', '資訊', '觀看模式', '分享與資料'].every(k => A.secs.includes(k)), JSON.stringify(A.secs));
  // 反向對照:更早那批臨時符號(◐ ♪ ◌ ⏺ ◎ ↗)也不可以趁著「拿掉圓章」倒回來
  ok(`Q6 ${tag} 反向對照:標籤裡沒有任何臨時符號`,
    act.every(r => !/[◐♪◌⏺◎↗]/.test(r.txt)), JSON.stringify(act.map(r => r.txt).filter(t => /[◐♪◌⏺◎↗]/.test(t))));
  ok(`Q7 ${tag} 每一列 ≥48 高,而且標籤區真的點得到`,
    act.every(r => r.h >= 48 && r.hit), JSON.stringify(act.filter(r => r.h < 48 || !r.hit).map(r => ({ t: r.txt, h: r.h, hit: r.hit }))));
  // 🔴 反向對照:更新那列會改自己的字。列裡還有一顆 .chev,選擇器指錯就會把「›」換成整句話。
  const upd = await page.evaluate(() => {
    appUpdateRender({ state: { hasUpdate: true, showBanner: false }, latest: { v: '9.9.9' } });
    const row = document.querySelector('.ms-row[data-act="update"]');
    return { chev: (row.querySelector('.chev') || {}).textContent || '',
      label: (row.querySelector('span:not(.chev)') || {}).textContent || '' };
  });
  ok(`Q8 ${tag} 反向對照:更新列換字換的是標籤,不是列尾的「›」`,
    upd.chev === '›' && /有新版可更新/.test(upd.label), JSON.stringify(upd));
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
      cursor: window.__map.getContainer().style.cursor,
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


// ── V 段:設計 16b 捷運看板每條線一個組標題 ───────────────────────────────────
// 🔴 前提是「捷運正在營運且有官方資料」——深夜跑 V1 會紅,那是環境不是回歸(判準刻意做成
//    正向對照先紅,而不是靜靜地全部略過:沒有列可量時「每個標題都配對正確」恆真)。
// 🔴 V4 刻意【不】要求「兩個分支同時出現在板上」:那取決於當下有沒有車,手機窄板每組又只
//    列得下 1 列(實測踩過,同一支腳本在 webkit/393 假紅)。改成「板上出現的每一列 O 分支,
//    標題都必須恰好是去掉括號的線名」,前提弱得多而且照樣抓得到沒去括號的實作。
async function sectionV(browser, engine) {
  const OPEN = `async (n) => {
    const k = n.replace(/臺/g, '台');
    let st = null;
    const pool = state.mode === 'sched' ? (state.decoLines || []) : (state.lines || []);
    for (const ln of pool) { const s = (ln.stations || []).find(x => x.name.replace(/臺/g, '台') === k); if (s) { st = { name: s.name, lat: s.lat, lon: s.lon, sys: 'deco' }; break; } }
    if (!st) return false;
    openBoard(st); await new Promise(r => setTimeout(r, 700)); return true;
  }`;
  const READ = `() => {
    const el = document.getElementById('board');
    const pool = state.mode === 'sched' ? (state.decoLines || []) : (state.lines || []);
    const hex = c => { const t = String(c || '').trim().toLowerCase();
      if (t.startsWith('#')) return t.length === 4 ? '#' + [...t.slice(1)].map(x => x + x).join('') : t;
      const m = t.match(/[0-9]+/g); return m ? '#' + m.slice(0, 3).map(x => (+x).toString(16).padStart(2, '0')).join('') : ''; };
    const out = []; let cur = null;
    for (const e of el.querySelectorAll('.grp, .row')) {
      if (e.classList.contains('grp')) {
        const d = e.querySelector('.gdot'), cs = getComputedStyle(d);
        cur = { label: e.querySelector('b').textContent, dot: hex(cs.backgroundColor), radius: cs.borderTopLeftRadius,
          fs: parseFloat(getComputedStyle(e.querySelector('b')).fontSize), first: e.classList.contains('first'),
          bt: parseFloat(getComputedStyle(e).borderTopWidth), right: Math.round(e.getBoundingClientRect().right), rows: [] };
        out.push(cur);
      } else {
        const rd = e.querySelector('.dot');
        const rec = { dest: (e.querySelector('.dest') || {}).textContent || '',
          dot: rd ? hex(getComputedStyle(rd).backgroundColor) : '',
          to: (e.querySelector('b') || {}).textContent || '',
          bt: parseFloat(getComputedStyle(e).borderTopWidth), fs: parseFloat(getComputedStyle(e).fontSize),
          radius: rd ? getComputedStyle(rd).borderTopLeftRadius : '', right: Math.round(e.getBoundingClientRect().right) };
        if (cur) cur.rows.push(rec); else out.push({ label: null, rows: [rec] });
      }
    }
    const colors = {};
    for (const ln of pool) {
      const lab = String(ln.name || ln.abbr || '').replace(/（[^（）]*）\\s*$/, '');
      if (lab && !colors[lab]) colors[lab] = hex(ln.color);
    }
    return { groups: out, colors, winW: document.documentElement.clientWidth };
  }`;
  for (const width of [1280, 393]) {
    const { page, errs, close } = await boot(browser, { width });
    await page.waitForTimeout(2500);   // 官方即時名冊要多等一輪才切得出組
    const tag = `${engine}/${width}`;
    const open = n => page.evaluate(([s, n]) => eval('(' + s + ')')(n), [OPEN, n]);
    const read = () => page.evaluate(s => eval('(' + s + ')')(), READ);
    if (!await open('古亭')) { ok(`V1 ${tag} 正向對照:開得了古亭看板`, false, '找不到站'); await close(); continue; }
    const r = await read(), named = r.groups.filter(g => g.label);
    ok(`V1 ${tag} 正向對照:古亭看板有列可量(深夜收班會紅,那是環境)`,
      r.groups.reduce((a, g) => a + g.rows.length, 0) >= 2, JSON.stringify(r.groups.map(g => [g.label, g.rows.length])));
    ok(`V2 ${tag} 轉乘站長出 ≥2 個組標題`, named.length >= 2, JSON.stringify(named.map(g => g.label)));
    // 🔴 列上已經不帶線名了(見 V14),配對只能靠【列的色點】驗:每一列的色點必須等於它所屬
    //    標題那條線的官方色。允許 #8fa8c6 那顆灰——那是官方板「認不出是哪條支線」的列刻意給的,
    //    但同一組至少要有一列是精確色,免得整組退化成灰也全綠。
    ok(`V3 ${tag} 🔴 每個標題底下的列都真的屬於那條線(用色點驗,標題沒配錯組)`,
      named.length > 0 && named.every(g => g.rows.length > 0
        && g.rows.every(x => x.dot === r.colors[g.label] || x.dot === '#8fa8c6')
        && g.rows.some(x => x.dot === r.colors[g.label])),
      JSON.stringify(named.map(g => ({ 標題: g.label, 官方色: r.colors[g.label], 列色點: g.rows.map(x => x.dot) }))));
    // 🔴 改成只看【標題本身】:原本靠「板上出現帶分支字樣的列」來辨識,但自從分支字樣會在
    //    目的地已經講過時被抑制(往迴龍不再標迴龍),那種列存不存在取決於當下有哪些車 ⇒ 會假紅。
    //    沒去掉括號的實作照樣抓得到:那會變成兩個標題(（迴龍）與（蘆洲）)而不是一個。
    const oHeads = named.filter(g => g.label.startsWith('中和新蘆線'));
    ok(`V4 ${tag} 🔴 兩個分支收成一個「中和新蘆線」標題(不切成兩條線、括號有去掉)`,
      oHeads.length === 1 && oHeads[0].label === '中和新蘆線',
      JSON.stringify({ O標題: oHeads.map(g => g.label), 全部標題: named.map(g => g.label) }));
    ok(`V4b ${tag} 標題字兩兩不重複`, new Set(named.map(g => g.label)).size === named.length, JSON.stringify(named.map(g => g.label)));
    // ── 使用者裁示(08-23):有組標題時,列上只留組標題沒講的那件事 ────────────────────
    ok(`V14 ${tag} 🔴 有標題時,列上不再重複標題那串線名`,
      named.length > 0 && named.every(g => g.rows.every(x => !x.dest.includes(g.label))),
      JSON.stringify(named.map(g => ({ 標題: g.label, 列: g.rows.map(x => x.dest) }))));
    // 🔴 規則式,不是「至少有一列帶分支」:後者取決於當下有哪些車。
    //    規則＝分支字樣【出現】⇔ 目的地【沒有】講過它。兩個方向都有牙:
    //    「往 迴龍　迴龍」(結巴)紅、「往 南勢角」卻不標分支(資訊掉了)也紅。
    const oPairs = (oHeads[0] ? oHeads[0].rows : []).map(x => ({
      to: x.to, chip: (x.dest.trim().match(/^(迴龍|蘆洲)/) || [''])[0] }));
    ok(`V15 ${tag} 🔴 分支字樣只在目的地沒講過時出現(不結巴,也不把分支資訊弄丟)`,
      oPairs.length > 0 && oPairs.every(p => p.chip ? !p.to.includes(p.chip) : /迴龍|蘆洲/.test(p.to)),
      JSON.stringify(oPairs));
    ok(`V16 ${tag} 線名空掉時沒有在車輛標籤前留下全形空白`,
      named.every(g => g.rows.every(x => x.dest === x.dest.trimStart())),
      JSON.stringify(named.flatMap(g => g.rows.map(x => JSON.stringify(x.dest)))));
    ok(`V5 ${tag} 🔴 色點逐字等於該線的官方線色(不是「有顏色就好」)`,
      named.length > 0 && named.every(g => r.colors[g.label] && g.dot === r.colors[g.label]),
      JSON.stringify(named.map(g => ({ [g.label]: g.dot, 官方: r.colors[g.label] }))));
    ok(`V6 ${tag} 第一組沒有上分隔線、之後每組都有;組內第一列不再畫列間分隔`,
      !!named[0] && named[0].first && named[0].bt === 0 && named.slice(1).every(g => g.bt > 0) &&
      named.every(g => g.rows[0] && g.rows[0].bt === 0),
      JSON.stringify(named.map(g => ({ f: g.first, bt: g.bt, r0: g.rows[0] && g.rows[0].bt }))));
    ok(`V7 ${tag} 標題與列都沒有溢出視窗`,
      r.groups.every(g => (g.right == null || g.right <= r.winW + 1) && g.rows.every(x => x.right <= r.winW + 1)),
      JSON.stringify({ winW: r.winW, 標題右緣: named.map(g => g.right) }));
    ok(`V12 ${tag} 標題字比列小(組標題是層級,不是又一列)`,
      named.length > 0 && named.every(g => g.rows[0] && g.fs < g.rows[0].fs),
      JSON.stringify(named.map(g => ({ 標題: g.fs, 列: g.rows[0] && g.rows[0].fs }))));
    ok(`V13 ${tag} 標題色點是圓角方塊、列的是圓——兩者形狀分得開`,
      named.length > 0 && named.every(g => g.radius !== '50%' && parseFloat(g.radius) > 0 && g.rows[0] && g.rows[0].radius === '50%'),
      JSON.stringify(named.map(g => ({ 標題: g.radius, 列: g.rows[0] && g.rows[0].radius }))));
    const click = await page.evaluate(async () => {
      const el = document.getElementById('board'), g = el.querySelector('.grp');
      const before = { open: !el.hidden, follow: !!state.freqFollow };
      g.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); g.click();
      await new Promise(r => setTimeout(r, 300));
      const midHead = { open: !document.getElementById('board').hidden, follow: !!state.freqFollow };
      const row = document.querySelector('#board .row[data-core-vehicle], #board .row[data-ci]');
      let after = null;
      if (row) { row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); row.click();
        await new Promise(r => setTimeout(r, 400)); after = { open: !document.getElementById('board').hidden, follow: !!state.freqFollow }; }
      return { before, midHead, after, hadRow: !!row };
    });
    ok(`V8 ${tag} 🔴 點組標題不跟車、看板不關(標題不是可點的東西)`,
      click.midHead.open === true && click.midHead.follow === click.before.follow, JSON.stringify(click));
    ok(`V9 ${tag} 正向對照:點列仍然跟得到車(看板關閉＝跟隨接手)`,
      !click.hadRow || !!(click.after && click.after.open === false), JSON.stringify(click.after));
    await page.evaluate(() => closeBoard());
    // 🔴 站別從永安市場換成象山:永安市場其實是【雙分支站】(迴龍與蘆洲的車都經過 ⇒ 兩個群組),
    //    自從標題門檻改看群組數之後它會長出一個「中和新蘆線」標題——那是正確行為不是回歸。
    //    象山才是真正的單組站。
    if (await open('象山')) {
      const s = await read();
      const all = s.groups.flatMap(g => g.rows);
      // 🔴 象山是端點站,班距空窗時整個看板可能一列都沒有(突變測試實測撞到過:兩發不相干的
      //    突變同時紅了 V10/V10b,追下去是那一刻沒車,不是突變造成的)。把「有沒有列可量」
      //    獨立成具名閘門,讓環境條件現形,而不是偽裝成 V10/V10b 的回歸。
      ok(`V10g ${tag} 正向對照:象山看板有列可量(端點站班距空窗會紅,那是環境不是回歸)`,
        all.length > 0, JSON.stringify(s.groups.map(g => [g.label, g.rows.length])));
      ok(`V10 ${tag} 🔴 單組站完全不長標題`,
        s.groups.every(g => !g.label),
        JSON.stringify(s.groups.map(g => [g.label, g.rows.length])));
      // 🔴 這條是本批的反向對照,不能少:「列上不重複線名」若沒有它把關,
      //    直接把整個線名欄刪掉也會全綠——但那樣單組站就再也沒有任何地方講得出這是哪條線。
      ok(`V10b ${tag} 🔴 沒有標題時,列上【仍然】帶得出線名(不是把整欄刪掉)`,
        all.length === 0 || all.every(x => x.dest.includes('淡水信義線')),
        JSON.stringify(all.map(x => x.dest)));
    } else ok(`V10 ${tag} 單組站不長標題`, false, '開不了象山');
    ok(`V11 ${tag} 零 pageerror`, errs.length === 0, errs.slice(0, 1).join(''));
    await close();
  }
}

// ── W 段:設計 16f 站內回報表單 → 預填好的 GitHub issue ───────────────────────────
// 🔴 這段的核心宣稱是「夾帶的診斷資訊全部攤開、不偷偷送」,所以判準一律驗【真的產生出來的
//    那條網址】,而不是畫面上有沒有把某一列變灰(W9/W10)。而 W15 再往下一層:W7 只證明
//    dataset 上那條字串長得對,證明不了按下去會發生什麼——突變實測「按鍵改成開裸網址」
//    (把使用者寫的全丟掉)時 W7 照樣全綠,只有 W15 紅。
async function sectionW(browser, engine) {
  for (const width of [393, 1280]) {
    const { page, errs, close } = await boot(browser, { width, query: `?bust=w16f${width}` });
    await page.waitForTimeout(700);
    const tag = `${engine}/${width}`;

    const ent = await page.evaluate(() => {
      const as = [...document.querySelectorAll('a.report-open')];
      return { n: as.length, hrefs: [...new Set(as.map(a => a.getAttribute('href')))] };
    });
    ok(`W1 ${tag} 兩顆入口都在,且【JS 壞掉時仍退回原本的 GitHub 連結】(href 沒被拿掉)`,
      ent.n === 2 && ent.hrefs.length === 1 && /github\.com\/.+\/issues\/new$/.test(ent.hrefs[0]), JSON.stringify(ent));

    const opened = await page.evaluate(async () => {
      document.querySelector('a.report-open').click();
      await new Promise(r => setTimeout(r, 350));
      const m = document.getElementById('reportModal');
      return { open: m && !m.hidden, kinds: [...document.querySelectorAll('#rpKinds button')].map(b => b.textContent),
        checked: [...document.querySelectorAll('#rpKinds button')].filter(b => b.getAttribute('aria-checked') === 'true').length,
        rows: [...document.querySelectorAll('#rpDiag .rp-row .rp-k')].map(e => e.textContent) };
    });
    ok(`W2 ${tag} 點入口開的是站內表單(不是直接跳走),四個類型齊、恰一個選中`,
      opened.open && opened.kinds.length === 4 && opened.checked === 1, JSON.stringify(opened));
    ok(`W3 ${tag} 診斷資訊【逐項攤開在畫面上】`, opened.rows.length >= 4, JSON.stringify(opened.rows));

    const fs = await page.evaluate(() => {
      const t = document.getElementById('rpText'), cs = getComputedStyle(t);
      return { fs: parseFloat(cs.fontSize), mono: getComputedStyle(document.querySelector('#rpDiag .rp-v')).fontFamily };
    });
    ok(`W4 ${tag} 🔴 輸入框恰為 16px(iOS 對更小的輸入框聚焦會放大整頁且退不回來)`, fs.fs === 16, JSON.stringify(fs));
    ok(`W5 ${tag} 診斷欄位用等寬字`, /mono|Menlo|SFMono/i.test(fs.mono), fs.mono);

    const empty = await page.evaluate(() => document.getElementById('rpGo').disabled);
    ok(`W6 ${tag} 沒寫說明時擋住(空的回報幫不上忙)`, empty === true, String(empty));

    await page.fill('#rpText', '文湖線的車停在忠孝復興沒動');
    await page.waitForTimeout(200);
    const u1 = await page.evaluate(() => ({ href: document.getElementById('rpGo').dataset.url, dis: document.getElementById('rpGo').disabled }));
    const q1 = new URL(u1.href), body1 = q1.searchParams.get('body') || '', title1 = q1.searchParams.get('title') || '';
    ok(`W7 ${tag} 寫了說明就放行,網址是 GitHub 新 issue 且帶著標題與內文`,
      u1.dis === false && /github\.com\/.+\/issues\/new$/.test(q1.origin + q1.pathname) &&
      body1.includes('文湖線的車停在忠孝復興沒動') && title1.startsWith('['), JSON.stringify({ title: title1, dis: u1.dis }));

    await page.evaluate(() => [...document.querySelectorAll('#rpKinds button')].find(b => b.textContent === '畫面壞了').click());
    await page.waitForTimeout(150);
    const t2 = new URL(await page.evaluate(() => document.getElementById('rpGo').dataset.url)).searchParams.get('title');
    ok(`W8 ${tag} 換問題類型,標題跟著換`, t2.startsWith('[畫面壞了]'), t2);

    // 🔴 關掉一項 → 必須真的從網址消失(不是只把畫面那一列變灰)
    const before = new URL(await page.evaluate(() => document.getElementById('rpGo').dataset.url)).searchParams.get('body');
    const gone = await page.evaluate(async () => {
      const c = [...document.querySelectorAll('#rpDiag input[data-k]')].find(x => x.dataset.k === '瀏覽器');
      c.click(); await new Promise(r => setTimeout(r, 200));
      return { k: c.dataset.k, greyed: c.closest('.rp-row').classList.contains('off') };
    });
    const after = new URL(await page.evaluate(() => document.getElementById('rpGo').dataset.url)).searchParams.get('body');
    ok(`W9 ${tag} 🔴 關掉某一項,它【真的從送出的網址裡消失】(不是只把畫面變灰)`,
      gone.greyed && /瀏覽器/.test(before) && !/瀏覽器/.test(after) && /版本/.test(after),
      JSON.stringify({ 關掉: gone.k, 關前有: /瀏覽器/.test(before), 關後有: /瀏覽器/.test(after) }));

    // 🔴 反向:網址裡不得出現任何沒攤在畫面上的東西。這條要成立,網址就必須【讀畫面上那幾列】
    //    而不是自己重算一次——重算的話畫面是開啟當下的快照、網址是按下去那一刻的值,時鐘跨一分鐘
    //    就對不上(實測抓到過)。突變「偷夾一個畫面上沒有的值」只有這條紅。
    const audit = await page.evaluate(() => {
      const shown = [...document.querySelectorAll('#rpDiag .rp-row')].filter(r => !r.classList.contains('off'))
        .map(r => r.querySelector('.rp-v').textContent);
      const body = new URL(document.getElementById('rpGo').dataset.url).searchParams.get('body');
      const tail = body.split('---')[1] || '';
      const vals = tail.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(l.indexOf('：') + 1));
      return { shown, vals };
    });
    ok(`W10 ${tag} 🔴 網址裡的每一個值都是畫面上攤開過的那一份(沒有夾帶沒顯示的東西)`,
      audit.vals.length > 0 && audit.vals.every(v => audit.shown.includes(v)) && audit.vals.length === audit.shown.length,
      JSON.stringify(audit));

    // 🔴 取樣點刻意打在【tabbar 自己身上】,不是對話框底緣:底緣那個點在多數機身根本碰不到
    //    tabbar,z-index 掉到 900 也照樣全綠(突變實測 0 紅)。對話框開著時整片 scrim 該吃掉所有
    //    點擊,所以「去點 tabbar 會點到 scrim」才是真正的不變量。
    const stack = await page.evaluate(() => {
      const m = document.getElementById('reportModal');
      const bar = document.querySelector('.tabbar');
      const vis = bar && bar.getBoundingClientRect().height > 0 && getComputedStyle(bar).display !== 'none';
      const b = vis ? bar.getBoundingClientRect()
        : document.querySelector('#reportModal .takeout-dialog').getBoundingClientRect();
      const hit = document.elementFromPoint(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2));
      const d = document.querySelector('#reportModal .takeout-dialog').getBoundingClientRect();
      return { host: m.parentElement.tagName, tabbar: !!vis,
        hit: hit && (hit.id || (typeof hit.className === 'string' ? hit.className : '') || hit.tagName),
        inModal: !!(hit && hit.closest && hit.closest('#reportModal')),
        dialogInView: d.top >= -1 && d.bottom <= innerHeight + 1 };
    });
    ok(`W11 ${tag} 🔴 對話框在 body 層;開著時連 tabbar 的位置都吃得到點擊(scrim 不是虛設)`,
      stack.host === 'BODY' && stack.inModal, JSON.stringify(stack));
    ok(`W11b ${tag} 對話框整個在視窗內(底部沒被切掉)`, stack.dialogInView, JSON.stringify(stack));

    const closed = await page.evaluate(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 250));
      return document.getElementById('reportModal').hidden;
    });
    ok(`W12 ${tag} Esc 關得掉`, closed === true, String(closed));

    // 送出鍵刻意是 <button> 不是 <a>:<a> 不吃 button 的 UA 樣式,不明寫就會和並排的「取消」
    // 大小/字重全對不上(實測 16px/400 vs 13.33/800);而 UA 字級 WebKit 11px、Chromium 13.33px,
    // 寫死一個數字等於在某個引擎一定歪,所以這條比的是「與旁邊那顆一致」不是某個常數。
    const pair = await page.evaluate(async () => {
      document.querySelector('a.report-open').click(); await new Promise(r => setTimeout(r, 250));
      const pick = el => { const c = getComputedStyle(el); return { fs: c.fontSize, fw: c.fontWeight, r: c.borderTopLeftRadius, h: Math.round(el.getBoundingClientRect().height) }; };
      return { go: pick(document.getElementById('rpGo')), cancel: pick(document.getElementById('rpCancel')) };
    });
    ok(`W14 ${tag} 🔴 送出鍵與並排的「取消」在字級/字重/高度/圓角上一致(<a> 不吃 button 的 UA 樣式)`,
      JSON.stringify(pair.go) === JSON.stringify(pair.cancel), JSON.stringify(pair));

    // 🔴 真的按下去,接住它開的那個分頁。攔住往 github.com 的導覽有兩個理由:(a) 沒登入的話
    //    GitHub 會先 302 到 /login,讀到的就不是我們送出的那條網址了(第一版判準這樣假紅過);
    //    (b) 順便不要真的去打人家的伺服器。
    const asked = [];
    await page.context().route('https://github.com/**', r => { asked.push(r.request().url()); r.abort(); });
    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 8000 }).catch(() => null),
      page.evaluate(() => document.getElementById('rpGo').click()),
    ]);
    if (popup) await popup.close().catch(() => {});
    const got = asked[0] || '';
    ok(`W15 ${tag} 🔴 真的按下去會開一個分頁,而且它請求的就是那條 GitHub 新 issue 網址`,
      !!popup && got.startsWith('https://github.com/siriushsu/taiwan-rail-live/issues/new?') &&
      decodeURIComponent(got).includes('文湖線的車停在忠孝復興沒動'),
      (got || '(沒有攔到請求)').slice(0, 110));
    await page.context().unroute('https://github.com/**').catch(() => {});

    ok(`W13 ${tag} 零 pageerror`, errs.length === 0, errs[0] || '');
    await close();
  }
}

await assertTarget();
// SECTIONS=H,I 只跑指定段(突變測試用);不設就跑全部——預設永遠是「全跑」,不能靠環境變數才完整。

// ── X:上緣堆疊不得互相重疊(2026-08-26 使用者實機回報「大字級時捷與隨機跟隨鈕疊在一起」)──
// 病根是一整族寫死常數:上緣堆疊的規則是「頂列底 + 間距」,實作卻把它凍結成
// 標準檔量到的數字(.map-actions 100、.alert-detail/#searchPanel/.trip-banner 56)。
// 字級一放大,頂列實高 42→103→117,常數就被壓進頂列裡。
// 🔴 判準刻意用「rect 相交面積 = 0」而不是「top ≥ 某常數」——常數判準正是這條缺陷的成因。
// 🔴 X1 是正向對照:相交=0 在「其中一個根本沒渲染」時也成立(而隨機跟隨鈕在列車載入前是 hidden,
//    我 08-22 正是因此誤判成「其餘條件式 UI 實測未相交」,放過了這個缺陷整整四天)。
const UPPER_STACK = ['.alert-detail', '#searchPanel', '.map-actions', '.trip-banner', '.dwell-plate', '.xing-card', '.xing-help'];
async function sectionX(browser, engine) {
  for (const tier of ['std', 'large', 'xlarge']) {
    for (const width of [360, 393, 414]) {
      const { page, errs, close } = await boot(browser, { width, tier });
      await page.waitForTimeout(2500);   // 等列車載入:#randBtn 在那之前是 hidden
      const r = await page.evaluate(sels => {
        const box = e => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
        const area = (a, b) => { const w = Math.min(a.r, b.r) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t); return (w > 0 && h > 0) ? Math.round(w * h) : 0; };
        const tbEl = document.getElementById('topbar');
        const maEl = document.querySelector('.map-actions');
        const randEl = document.getElementById('randBtn');
        const shown = e => !!e && !e.hidden && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0;
        const tb = tbEl && shown(tbEl) ? box(tbEl) : null;
        const ma = maEl && shown(maEl) ? box(maEl) : null;
        const rand = randEl && shown(randEl) ? box(randEl) : null;
        // 兩種形態(收合成一顆／四顆分頁)取當下真的渲染出來的那一種,見檔頭 GS_RESOLVE 的說明
        const oneEl = document.querySelector('.topbar .gtab-one');
        const tabs = (shown(oneEl) ? [oneEl] : [...document.querySelectorAll('.topbar .grouptabs .gtab')].filter(shown))
          .map(e => ({ ...box(e), txt: e.textContent.trim() }));
        // 上錨元件的 computed top 讀得到即使 display:none(讀的是計算值不是使用值),
        // 所以整族都掃得到,不必偽造可見狀態(偽造出來的幾何本來也不算數)。
        const tops = {};
        for (const s of sels) { const e = document.querySelector(s); if (e) { const n = parseFloat(getComputedStyle(e).top); if (!isNaN(n)) tops[s] = n; } }
        // 結構性:上錨元件的 top 不得由 JS 寫成絕對 px(安全區晚一步注入就對不上,見 memory 形狀一)
        const inlineTop = sels.filter(s => { const e = document.querySelector(s); return e && e.style.top && e.style.top.indexOf('calc') < 0 && e.style.top.indexOf('var(') < 0; });
        return { tb, ma, rand, tabs, tops, inlineTop, trains: (window.state && state.trains || []).length, dataFs: document.documentElement.getAttribute('data-fs'), tbh: getComputedStyle(document.documentElement).getPropertyValue('--tb-h').trim(),
          maVsTb: (tb && ma) ? area(tb, ma) : null,
          worstTab: rand ? tabs.map(t => ({ txt: t.txt, a: area(t, rand) })).sort((x, y) => y.a - x.a)[0] : null };
      }, UPPER_STACK);
      const tag = `${engine} ${width}pt ${tier}`;
      // X1 正向對照——沒有它,下面兩條在「東西根本沒畫」時也會全綠
      // 🔴 通過條件只看「兩個東西都真的有 rect」——那才是這條控制組要擋的失效
      //    (沒渲染 ⇒ 相交必為 0 ⇒ X2/X3 假綠)。列車數只當環境訊息印出來:它取決於
      //    班表算完沒,會隨機器負載浮動,綁進判準會變成每次都紅的假警報。
      ok(`X1 ${tag} 正向對照:頂列與隨機跟隨鈕都真的量得到(不是靠沒渲染騙過相交判準)`,
        !!r.tb && r.tb.h > 0 && !!r.rand && r.rand.h > 0,
        JSON.stringify({ 頂列高: r.tb && Math.round(r.tb.h), 隨機鈕高: r.rand && Math.round(r.rand.h), 列車: r.trains, tbh: r.tbh }));
      ok(`X2 ${tag} 🔴 頂列與地圖動作列相交面積 = 0`, r.maVsTb === 0,
        JSON.stringify({ 相交: r.maVsTb, 頂列底: r.tb && Math.round(r.tb.b), 動作列頂: r.ma && Math.round(r.ma.t) }));
      ok(`X3 ${tag} 🔴 群組切換器沒有被隨機跟隨鈕蓋到`, !!r.worstTab && r.worstTab.a === 0,
        r.worstTab ? `最嚴重的是「${r.worstTab.txt}」相交 ${r.worstTab.a}px²` : '量不到切換器或隨機鈕');
      // X4 整族一起掃:今天壞的是 .map-actions,明天可能是隔壁那條,它們共用同一個假設
      const below = Object.entries(r.tops).filter(([, v]) => r.tb && v < r.tb.b - 0.5).map(([k, v]) => `${k}=${v}<頂列底${Math.round(r.tb.b)}`);
      ok(`X4 ${tag} 🔴 上錨元件的 top 全部不高於頂列底緣(整族掃,不只今天壞的那個)`, below.length === 0,
        below.length ? below.join('、') : `${Object.keys(r.tops).length} 個全過(頂列底 ${r.tb && Math.round(r.tb.b)})`);
      ok(`X5 ${tag} 結構性:上錨元件的 top 不得是 JS 寫死的絕對 px(安全區晚注入會對不上)`,
        r.inlineTop.length === 0, r.inlineTop.join('、') || '零個');
      ok(`X6 ${tag} 零 pageerror`, errs.length === 0, errs.join(' | ') || '無');
      await close();
    }
  }
}

// ── Y 段:點地圖空白處要收掉車站看板(使用者要求;捷運與台鐵兩條分支各一套) ─────────────
// 這一段驗的是「互動能力」不是版面幾何,所以只跑 393pt/std——換字級不會改變點擊路由。
// 🔴 判準一律「真的用滑鼠點一次 + 量它造成的狀態改變」(#board.hidden 與 state.boardStation),
//    不用 elementFromPoint 命中誰下結論:命中對祖先容器恆真,答不了「點下去會發生什麼」。
//    (memory:assertion-blindspot-taxonomy／judgment 心得 33、37)
async function sectionY(browser, engine) {
  for (const [gtab, label] of [['捷', 'freq'], ['台', 'sched']]) {
    const { page, errs, close } = await boot(browser, { width: 393, tier: 'std' });
    const tag = `${engine} ${label}`;
    try {
      await tapGroupByShort(page, gtab);
      await page.waitForTimeout(2200);

      // 候選站:全台縮放下所有站擠成一團,挑不出「鄰站夠遠」的目標 ⇒ 逐顆放大到 z15 再判。
      // 🔴 「站上此刻沒有列車」是會飄的環境條件(車一停靠就會彈歧義選單而不是開看板),
      //    所以不寫進判準、改成多試幾顆——綁進判準會變成隨機紅(見 memory:心得 34)。
      const cands = await page.evaluate(() => {
        const out = [];
        if (state.mode === 'sched') (state.schedStations || []).forEach(s => out.push({ name: s.name, lat: s.lat, lon: s.lon }));
        else state.lines.forEach(ln => { if (state.visible.has(ln.id) && ln.stations) ln.stations.forEach(s => { if (s && s.lat) out.push({ name: s.name, lat: s.lat, lon: s.lon }); }); });
        const step = Math.max(1, Math.floor(out.length / 8)); // 跨線/跨區抽樣,不要全挑同一段
        return out.filter((_, i) => i % step === 0).slice(0, 8);
      });

      let chosen = null;
      for (const st of cands) {
        await page.evaluate(s => window.__map.setView([s.lat, s.lon], 15, { animate: false }), st);
        await page.waitForTimeout(1300);
        const c = await page.evaluate(nm => {
          const rect = window.__map.getContainer().getBoundingClientRect();
          const pts = [];
          if (state.mode === 'sched') (state.schedStations || []).forEach(s => { const p = window.__M.toScreen([s.lat, s.lon]); pts.push({ x: p.x, y: p.y, name: s.name }); });
          else state.lines.forEach(ln => { if (state.visible.has(ln.id) && ln.pts) ln.pts.forEach((p, i) => { if (ln.stations[i]) pts.push({ x: p.x, y: p.y, name: ln.stations[i].name }); }); });
          const me = pts.find(p => p.name === nm && Math.hypot(p.x - rect.width / 2, p.y - rect.height / 2) < 40);
          if (!me) return { ok: false, why: '不在畫面中央' };
          const el = document.elementFromPoint(rect.left + me.x, rect.top + me.y);
          if (!el || !el.closest('#map,#overlay')) return { ok: false, why: '被 UI 蓋住:' + (el ? (el.id || el.className) : 'null') };
          if (pts.filter(q => Math.hypot(q.x - me.x, q.y - me.y) < 26).length !== 1) return { ok: false, why: '鄰站太近' };
          if ((state.mode === 'sched' ? trainsAt : freqTrainsAt)(L.point(me.x, me.y)).length) return { ok: false, why: '站上停著車' };
          return { ok: true, x: me.x, y: me.y, name: nm, rect: { l: rect.left, t: rect.top } };
        }, st.name);
        if (c.ok) { chosen = c; break; }
      }

      const bd = () => page.evaluate(() => { const b = document.getElementById('board'); return { open: !b.hidden, stn: state.boardStation ? (state.boardStation.name || '') : null }; });

      // Y1 正向對照:真的點站 ⇒ 看板開、而且開的正是那一站。
      // 沒有這一條,Y3 的「看板關著」可能只是因為它從頭到尾就打不開(判準架空)。
      if (chosen) { await page.mouse.click(chosen.rect.l + chosen.x, chosen.rect.t + chosen.y); await page.waitForTimeout(900); }
      const s1 = chosen ? await bd() : { open: false, stn: null };
      ok(`Y1 ${tag} 正向對照:真的點一顆車站 ⇒ 看板打得開`, !!chosen && s1.open && s1.stn === chosen.name,
        chosen ? `點「${chosen.name}」→ 看板 ${s1.open ? '開' : '關'}${s1.stn ? '(' + s1.stn + ')' : ''}` : `${cands.length} 顆候選都挑不出乾淨目標`);

      // Y2 結構前提:待會要點的那一點,真的是空白(離最近站 >60px、沒有車牌罩住、最上層是地圖層)。
      // 🔴 必須在看板開起來之後才算:看板一開,讓位/置中機制會把地圖推走,開板前算的座標已經不是空白。
      const g2 = await page.evaluate(() => {
        const rect = window.__map.getContainer().getBoundingClientRect();
        const pts = [];
        if (state.mode === 'sched') (state.schedStations || []).forEach(s => { const p = window.__M.toScreen([s.lat, s.lon]); pts.push({ x: p.x, y: p.y }); });
        else state.lines.forEach(ln => { if (state.visible.has(ln.id) && ln.pts) ln.pts.forEach(p => pts.push({ x: p.x, y: p.y })); });
        const nTr = (x, y) => (state.mode === 'sched' ? trainsAt : freqTrainsAt)(L.point(x, y)).length;
        for (let y = 180; y < rect.height - 300; y += 11) {
          for (let x = 26; x < rect.width - 26; x += 11) {
            let mn = 1e9; for (const p of pts) mn = Math.min(mn, Math.hypot(p.x - x, p.y - y));
            if (mn <= 60 || nTr(x, y)) continue;
            const el = document.elementFromPoint(rect.left + x, rect.top + y);
            if (el && el.closest('#map,#overlay')) return { x, y, px: Math.round(mn), hit: el.id || el.className, rect: { l: rect.left, t: rect.top } };
          }
        }
        return null;
      });
      ok(`Y2 ${tag} 結構前提:找得到一個真的空白的點(離最近站>60px、無車牌、最上層是地圖)`, !!g2,
        g2 ? `(${g2.x},${g2.y}) 離最近站 ${g2.px}px,命中 ${g2.hit}` : '整張畫面找不到空白點');

      // Y3 主判準:看板開著時點空白處 ⇒ 看板關掉(hidden 且 boardStation 清空)。
      if (g2) { await page.mouse.click(g2.rect.l + g2.x, g2.rect.t + g2.y); await page.waitForTimeout(900); }
      const s2 = g2 ? await bd() : { open: true, stn: 'n/a' };
      ok(`Y3 ${tag} 看板開著時點地圖空白處 ⇒ 看板收掉`, !!g2 && s1.open && !s2.open && s2.stn === null,
        `點空白前 ${s1.open ? '開' : '關'} → 點空白後 ${s2.open ? '開' : '關'}(boardStation=${s2.stn})`);

      // Y4 反向對照:收掉之後地圖還活著——再點一次同一顆站,看板要重新開得起來。
      // 沒有這一條,「把地圖點擊整個弄壞」也會讓 Y3 全綠。
      if (chosen) { await page.mouse.click(chosen.rect.l + chosen.x, chosen.rect.t + chosen.y); await page.waitForTimeout(900); }
      const s3 = chosen ? await bd() : { open: false, stn: null };
      ok(`Y4 ${tag} 反向對照:收掉之後再點同一顆站,看板重新開得起來(沒把地圖點擊弄壞)`,
        !!chosen && s3.open && s3.stn === chosen.name, `重點「${chosen ? chosen.name : '-'}」→ ${s3.open ? '開(' + s3.stn + ')' : '關'}`);

      ok(`Y5 ${tag} 零 pageerror`, errs.length === 0, errs.slice(0, 2).join(' | ') || '無');
    } finally { await close(); }
  }
}


// ── Z 段:看板標題列三顆鈕(✕／☆／🔔)的觸控目標 ─────────────────────────────
// 使用者 2026-08-26:「再小的字體設定時,關掉的 X 太小了,容易點不到。」
// 真因:命中框寫死 22×22 且**不吃 --ui**——字級放大只放大字形、框一動也不動;
//   而標題列本身只有 38–40px 高,垂直方向在任何字級都先撞牆(所以三階都要驗,不是只驗 std)。
// 🔴 判準寫「點下去發生什麼」不只寫幾何(心得 33／37a):幾何綠只證明「看起來沒疊」,
//    答不了「點 ☆ 會不會其實開到 ✕」。每顆都真的 tap 一次並看它造成的狀態改變,
//    而且 ✕ 與 ☆ 互為正向對照——「✕ 會關」單獨成立沒有意義(整條標題列都關才更慘),
//    必須同時證明「☆ 不會關」。
// 🔴 撐大命中框時最容易踩的坑是**重疊**:框一重疊,DOM 較後的那顆整個蓋掉前一顆,
//    幾何與 computed style 都照不到(那次是兩顆並排鈕怎麼點都開到後面那顆)。Z2 專門守這件事。
const Z_RECT = `(() => {
  const bd = document.getElementById('board');
  const g = sel => { const e = bd.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect();
    return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: +r.left.toFixed(1), y: +r.top.toFixed(1),
      cx: +(r.left + r.width / 2).toFixed(1), cy: +(r.top + r.height / 2).toFixed(1) }; };
  const h3 = bd.querySelector('h3');
  return { close: g('.close'), star: g('.board-star'), notify: g('.board-notify'),
    h3h: h3 ? +h3.getBoundingClientRect().height.toFixed(1) : null,
    hidden: bd.hidden, fav: !!bd.querySelector('.board-star.on') };
})()`;
const zOverlap = (a, b) => {
  if (!a || !b) return 0;
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return (w > 0.5 && h > 0.5) ? +(w * h).toFixed(1) : 0;
};
async function sectionZ(browser, engine) {
  for (const tier of ['std', 'large', 'xlarge']) {
    const { page, errs, close } = await boot(browser, { width: 393, tier });
    const tag = `${engine} ${tier}`;
    try {
      await page.evaluate(() => selectGroup(GROUPS.find(g => g.id === 'tra')));
      await page.waitForFunction(() => state.mode === 'sched', null, { timeout: 45000 });
      await page.evaluate(() => openBoard({ name: '臺北', sys: 'tra_sched', lat: 25.0478, lon: 121.517 }));
      await page.waitForTimeout(700);
      const r0 = await page.evaluate(c => eval(c), Z_RECT);

      // Z1 幾何:44 是 Apple HIG 的觸控下限,不是實作值——寫死它不會隨實作漂移。
      ok(`Z1 ${tag} 看板 ✕／☆ 命中框 ≥44×44`,
        !!r0.close && !!r0.star && r0.close.w >= 44 && r0.close.h >= 44 && r0.star.w >= 44 && r0.star.h >= 44,
        JSON.stringify({ close: r0.close, star: r0.star }));
      ok(`Z2 ${tag} 看板標題列各鈕命中框互不重疊`,
        zOverlap(r0.close, r0.star) === 0,
        `重疊 ${zOverlap(r0.close, r0.star)} px²`);

      // Z3 命中歸屬:框中心與四角(內縮 2px)都要打到 ✕ 自己,不是被 h3／抓把蓋住
      const hit = await page.evaluate(c => {
        const bd = document.getElementById('board'), el = bd.querySelector('.close');
        const r = el.getBoundingClientRect(), p = 2, out = [];
        for (const [x, y] of [[r.left + r.width / 2, r.top + r.height / 2],
                              [r.left + p, r.top + p], [r.right - p, r.top + p],
                              [r.left + p, r.bottom - p], [r.right - p, r.bottom - p]]) {
          const t2 = document.elementFromPoint(x, y);
          out.push(t2 === el || (t2 && el.contains(t2)) ? 'ok' : (t2 ? (t2.className || t2.tagName) : 'null'));
        }
        return out;
      }, null);
      ok(`Z3 ${tag} ✕ 命中框中心＋四角都命中 ✕ 本身`,
        hit.every(v => v === 'ok'), JSON.stringify(hit));

      // Z4 正向對照:真的按 ☆ —— 最愛要翻轉,而且看板**不可以**關掉
      await page.mouse.click(r0.star.cx, r0.star.cy);
      await page.waitForTimeout(500);
      const rStar = await page.evaluate(c => eval(c), Z_RECT);
      ok(`Z4 ${tag} 真按 ☆:最愛翻轉且看板沒關(✕ 的正向對照)`,
        rStar.fav !== r0.fav && rStar.hidden === false,
        JSON.stringify({ favBefore: r0.fav, favAfter: rStar.fav, hidden: rStar.hidden }));
      // 復原最愛,免得污染同一個 profile 的後續判準
      if (rStar.star && rStar.fav !== r0.fav) { await page.mouse.click(rStar.star.cx, rStar.star.cy); await page.waitForTimeout(400); }

      // Z5 真按 ✕ —— 看板要關掉
      // 🔴 rPre.close 可能是 null:Z4 紅的典型形態就是「☆ 其實點到 ✕」⇒ 看板已經關了、鈕不在 DOM。
      //    不防的話這裡拋例外會把同段後面的判準一起帶走(m2 突變實測),紅的條數變得看不出原因。
      const rPre = await page.evaluate(c => eval(c), Z_RECT);
      if (!rPre.close) {
        ok(`Z5 ${tag} 真按 ✕:看板關掉`, false, '前一步之後 ✕ 已不在 DOM(看板被提早關掉,見 Z4)');
      } else {
        await page.mouse.click(rPre.close.cx, rPre.close.cy);
        await page.waitForTimeout(500);
        const rClose = await page.evaluate(c => eval(c), Z_RECT);
        ok(`Z5 ${tag} 真按 ✕:看板關掉`, rClose.hidden === true, JSON.stringify({ hidden: rClose.hidden }));
      }

      ok(`Z6 ${tag} 無 pageerror`, errs.length === 0, errs.slice(0, 2).join(' | '));
    } finally { await close(); }
  }

  // Z7 三顆鈕齊備(末班車提醒鈴鐺只有原生殼才有,用旗標注入把它叫出來):
  //    這是右上角最擠的組合,要同時成立三件事——每顆都 ≥44、彼此不重疊、標題列不因為
  //    右內距加大而換行(h3 高度不得超過兩顆鈕時的高度)。
  {
    const a = await boot(browser, { width: 393, tier: 'xlarge' });
    let h3Two = null;
    try {
      await a.page.evaluate(() => selectGroup(GROUPS.find(g => g.id === 'tra')));
      await a.page.waitForFunction(() => state.mode === 'sched', null, { timeout: 45000 });
      await a.page.evaluate(() => openBoard({ name: '臺北', sys: 'tra_sched', lat: 25.0478, lon: 121.517 }));
      await a.page.waitForTimeout(700);
      h3Two = (await a.page.evaluate(c => eval(c), Z_RECT)).h3h;
    } finally { await a.close(); }

    const b = await boot(browser, { width: 393, tier: 'xlarge', native: ['RAIL_NATIVE_LOCALNOTIFY'] });
    try {
      await b.page.evaluate(() => selectGroup(GROUPS.find(g => g.id === 'tra')));
      await b.page.waitForFunction(() => state.mode === 'sched', null, { timeout: 45000 });
      // 站名刻意挑長的:右內距加大之後最先出事的就是長站名
      await b.page.evaluate(() => openBoard({ name: '新左營', sys: 'tra_sched', lat: 22.687, lon: 120.307 }));
      await b.page.waitForTimeout(700);
      const r = await b.page.evaluate(c => eval(c), Z_RECT);
      const three = !!r.notify;
      ok(`${engine} Z7 前置·三顆鈕真的都在(鈴鐺靠原生旗標)`, three, JSON.stringify({ notify: r.notify }));
      if (three) {
        ok(`${engine} Z7 三顆鈕都 ≥44×44`,
          [r.close, r.star, r.notify].every(x => x && x.w >= 44 && x.h >= 44),
          JSON.stringify({ close: r.close, star: r.star, notify: r.notify }));
        ok(`${engine} Z7 三顆鈕兩兩不重疊`,
          zOverlap(r.close, r.star) === 0 && zOverlap(r.star, r.notify) === 0 && zOverlap(r.close, r.notify) === 0,
          `✕☆ ${zOverlap(r.close, r.star)} ／ ☆🔔 ${zOverlap(r.star, r.notify)} ／ ✕🔔 ${zOverlap(r.close, r.notify)} px²`);
        ok(`${engine} Z7 長站名＋三顆鈕標題列沒有被擠到換行`,
          h3Two != null && r.h3h <= h3Two + 1, `兩顆 ${h3Two} → 三顆 ${r.h3h}`);
      }
      ok(`${engine} Z7 無 pageerror`, b.errs.length === 0, b.errs.slice(0, 2).join(' | '));
    } finally { await b.close(); }
  }
}

// ── SP 段:資料狀態小卡——點時鐘徽章展開(2026-08-27 使用者要求)────────────────
// 「點時鐘的時候要顯示現在班次是 Live、還是非即時,把上面的燈號資訊詳細顯示出來」。
// 🔴 三件都要成立才算過:真的點得下去 / 卡真的看得見 / 字真的是徽章那顆燈的字。
//    - 只驗 hidden 旗標 ⇒ 卡被 .stage 的 z-index 封頂、或被 .topbar 的 pointer-events:none
//      擋在白名單外,兩種都會全綠(memory modal-stacking-context、judgment 心得 24/33 各踩一次)。
//    - 只驗「有沒有字」⇒ 把值寫死成同一句照樣過。所以 SP8/SP9 用**其餘輸入逐格相同、只差資料
//      年紀**的兩次渲染互比(judgment 心得 39 的反向對照);而且那兩次擺在**同一個同步任務**裡跑,
//      車數／捷運看板那些每秒在動的字才不會混進差異裡(心得 31:比較前先把即時旗標釘死)。
const SP_FORCE = (fresh) => {
  // 只動「新鮮度」這一個變因:兩次的 state.live 其餘欄位逐格相同,差別只有 srcMs 的年紀。
  const now = Date.now();
  state.mode = 'sched';
  state.schedSystems = [{ id: 'tra_sched', live: '/api/tra-live' }];
  state.simSec = nowSecOfDay();
  state.live = { at: now, srcMs: now - (fresh ? 10e3 : 600e3),
    srcAt: '2026-08-27T09:00:00', delayed: 3, map: new Map() };
  updateLiveBadge();
  const el = document.getElementById('liveBadge');
  return { txt: el.textContent.trim(), hidden: el.hidden, title: (el.title || '').trim() };
};
// 卡看不看得見只認像素:五個取樣點都要 elementFromPoint 命中卡自己(或它的子孫)。
const SP_SEE = () => {
  const pop = document.getElementById('statPop');
  if (!pop || pop.hidden || !pop.getClientRects().length) return { vis: false, hits: ['卡是關的'] };
  const r = pop.getBoundingClientRect();
  // 🔴 內縮 20px:卡是 12px 圓角,離角 3px 的點根本落在圓角外面,量到的是圓角不是「有沒有被蓋住」
  //    (第一版就是這樣紅的)。20 > 12 ⇒ 四個點都確實在卡身上,又仍然覆蓋兩個軸向的端點(心得 37(c))。
  const I = 20;
  const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + I, r.top + I],
    [r.right - I, r.top + I], [r.left + I, r.bottom - I], [r.right - I, r.bottom - I]];
  const hits = pts.map(([x, y]) => {
    const e = document.elementFromPoint(x, y);
    return e ? (pop.contains(e) ? 'ok' : (e.id || e.className || e.tagName)) : 'null';
  });
  return { vis: hits.every(h => h === 'ok'), hits,
    rect: { l: +r.left.toFixed(1), t: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
    inView: r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5 };
};
// 卡的內容 + 徽章當下**看得見**的燈(覆蓋率斷言用)。k→id 這張表測試自己寫一份,不讀實作的
// STAT_POP_KEYS——判準與實作同源會一起錯(judgment 心得 29)。
const SP_READ = () => {
  const K2ID = { live: 'liveBadge', metro: 'metroBadge', peak: 'peak', count: 'count' };
  const pop = document.getElementById('statPop');
  const rows = [...pop.querySelectorAll('.sp-row')].map(r => ({
    k: r.dataset.k,
    lab: ((r.querySelector('.lab') || {}).textContent || '').trim(),
    val: ((r.querySelector('.val') || {}).textContent || '').trim(),
  }));
  const lampIds = ['liveBadge', 'metroBadge', 'peak', 'count']
    .filter(id => { const e = document.getElementById(id); return e && !e.hidden && e.textContent.trim(); });
  return { rows, lampIds,
    covered: lampIds.filter(id => rows.some(r => K2ID[r.k] === id)),
    why: ((pop.querySelector('.sp-why') || {}).textContent || '').trim(),
    aria: document.getElementById('statBadge').getAttribute('aria-expanded') };
};
const SP_BADGE_RECT = () => {
  const b = document.getElementById('statBadge'), r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2,
    parent: b.parentElement.id || b.parentElement.className };
};
// 兩次渲染擺在同一個同步任務裡,中間沒有任何機會讓車數/看板那些字自己動。
const SP_DIFF = (code) => {
  const force = eval('(' + code + ')');
  const pop = document.getElementById('statPop');
  const read = () => ({
    rows: [...pop.querySelectorAll('.sp-row')].map(r => r.dataset.k + '=' + ((r.querySelector('.val') || {}).textContent || '').trim()),
    why: ((pop.querySelector('.sp-why') || {}).textContent || '').trim(),
  });
  const was = pop.hidden; pop.hidden = false;
  force(true); statPopRender(); const a = read();
  force(false); statPopRender(); const b = read();
  pop.hidden = was;
  return { a, b };
};
async function sectionSP(browser, engine) {
  for (const tier of ['std', 'large']) {
    const tag = `${engine} ${tier}`;
    const { page, errs, close } = await boot(browser, { width: 393, tier });
    try {
      await page.evaluate(() => { if (state.playing) togglePlay(); });
      for (const fresh of [true, false]) {
        const mode = fresh ? 'LIVE' : '非即時';
        const badge = await page.evaluate(([c, f]) => eval('(' + c + ')')(f), [SP_FORCE.toString(), fresh]);
        ok(`SP1 ${tag}/${mode} 前置·強制${fresh ? '新鮮' : '不新鮮'}後徽章自己就寫「${mode}」`,
          !badge.hidden && badge.txt === mode, JSON.stringify(badge));
        // 🔴 真的用滑鼠點(不是 .click()):.topbar 是 pointer-events:none＋白名單,
        //    白名單漏掉徽章時 .click() 照樣全綠、手指卻永遠點不到。
        const br = await page.evaluate(c => eval('(' + c + ')')(), SP_BADGE_RECT.toString());
        await page.mouse.click(br.x, br.y);
        await page.waitForTimeout(220);
        const see = await page.evaluate(c => eval('(' + c + ')')(), SP_SEE.toString());
        ok(`SP2 ${tag}/${mode} 真的點徽章(在 ${br.parent})就開卡,五個取樣點都看得見`, see.vis, JSON.stringify(see));
        ok(`SP2b ${tag}/${mode} 卡完整落在視窗內`, see.inView === true, JSON.stringify(see.rect));
        const rd = await page.evaluate(c => eval('(' + c + ')')(), SP_READ.toString());
        const live = rd.rows.find(r => r.k === 'live');
        ok(`SP3 ${tag}/${mode} 「即時資料」那列逐字等於徽章的字`,
          !!live && live.val === mode && live.lab === '即時資料', JSON.stringify({ live, badge: badge.txt }));
        // 「把上面的燈號資訊詳細顯示出來」= 每顆燈 title 裡的「為什麼」要真的落到卡上
        ok(`SP4 ${tag}/${mode} 燈號的「為什麼」(title 原文)出現在卡上`,
          badge.title.length > 0 && rd.why.includes(badge.title),
          JSON.stringify({ title: badge.title.slice(0, 70), why: rd.why.slice(0, 100) }));
        // 覆蓋率要有具名斷言:徽章看得見幾顆燈,卡上就要有幾列(心得 37(d),分母不准無聲縮水)
        ok(`SP5 ${tag}/${mode} 徽章看得見的燈全部有列(${rd.covered.length}/${rd.lampIds.length})`,
          rd.lampIds.length >= 1 && rd.covered.length === rd.lampIds.length,
          JSON.stringify({ 燈: rd.lampIds, 有列: rd.covered, 列: rd.rows.map(r => r.k) }));
        ok(`SP6 ${tag}/${mode} aria-expanded 開著時是 true`, rd.aria === 'true', String(rd.aria));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(160);
        const shut = await page.evaluate(() => ({
          hidden: document.getElementById('statPop').hidden,
          aria: document.getElementById('statBadge').getAttribute('aria-expanded') }));
        ok(`SP7 ${tag}/${mode} Esc 收得掉且 aria 跟著回 false`,
          shut.hidden === true && shut.aria === 'false', JSON.stringify(shut));
      }
      // 🔴 反向對照:同一個同步任務裡連渲染兩次,只差資料年紀 ⇒ 即時那列必須變、其餘列必須一字不差。
      //    少了這條,把值寫死成常數也會讓上面每一條全綠。
      const d = await page.evaluate(([c1, c2]) => eval('(' + c1 + ')')(c2), [SP_DIFF.toString(), SP_FORCE.toString()]);
      const va = Object.fromEntries(d.a.rows.map(s => [s.split('=')[0], s]));
      const vb = Object.fromEntries(d.b.rows.map(s => [s.split('=')[0], s]));
      const others = [...new Set([...Object.keys(va), ...Object.keys(vb)])].filter(k => k !== 'live');
      ok(`SP8 ${tag} 反向對照:只改新鮮度 ⇒ 即時那列變了,其餘列一字不差`,
        va.live !== vb.live && others.every(k => va[k] === vb[k]),
        JSON.stringify({ live: [va.live, vb.live], 其餘: others.map(k => [va[k], vb[k]]) }));
      ok(`SP9 ${tag} 反向對照:「為什麼」也跟著換(不是印死的同一段)`,
        d.a.why !== d.b.why && d.a.why.length > 0 && d.b.why.length > 0,
        JSON.stringify({ a: d.a.why.slice(0, 60), b: d.b.why.slice(0, 60) }));
      // ✕ 的熱區:視覺 22 圓靠置中的 ::after 補到 44(比照看板 ✕)
      const br = await page.evaluate(c => eval('(' + c + ')')(), SP_BADGE_RECT.toString());
      await page.mouse.click(br.x, br.y); await page.waitForTimeout(200);
      const xr = await page.evaluate(() => {
        const x = document.getElementById('statPopClose'), p = getComputedStyle(x, '::after'), r = x.getBoundingClientRect();
        return { w: parseFloat(p.width), h: parseFloat(p.height), cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      });
      ok(`SP10 ${tag} 關閉鈕熱區 ≥44×44`, xr.w >= 44 && xr.h >= 44, JSON.stringify(xr));
      const hitX = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? (e.id || e.tagName) : 'null'; },
        [xr.cx, xr.cy + 18]);
      ok(`SP10b ${tag} 熱區下緣(離視覺圓心 18px)仍命中關閉鈕`, hitX === 'statPopClose', String(hitX));
      await page.mouse.click(xr.cx, xr.cy); await page.waitForTimeout(180);
      ok(`SP11 ${tag} 按 ✕ 收得掉`, await page.evaluate(() => document.getElementById('statPop').hidden), '');
      await page.mouse.click(br.x, br.y); await page.waitForTimeout(200);
      ok(`SP12 ${tag} 前置·再點一次徽章又開起來`, await page.evaluate(() => !document.getElementById('statPop').hidden), '');
      // 開著時燈號自己變了 ⇒ 卡要跟著換,不能停在打開那一刻的舊值(徽章的字由好幾處程式各自寫)。
      // 🔴 受測輸入不能用 #count:那顆每一幀都被 render 迴圈重寫回去,量到的是「誰寫得比較快」
      //    而不是卡有沒有跟上(第一版就是這樣紅的)。改用新鮮度——它只由 updateLiveBadge 寫。
      const mut = await page.evaluate(async ([c]) => {
        const q = () => ((document.querySelector('#statPop .sp-row[data-k=live] .val') || {}).textContent || '').trim();
        const force = eval('(' + c + ')');
        force(true); await new Promise(r => setTimeout(r, 280));
        const before = q();
        force(false); await new Promise(r => setTimeout(r, 280));
        return { before, after: q(), open: !document.getElementById('statPop').hidden };
      }, [SP_FORCE.toString()]);
      ok(`SP13 ${tag} 開著時燈號變了,卡不用重開就跟著換`,
        mut.open && mut.before === 'LIVE' && mut.after === '非即時', JSON.stringify(mut));
      // 卡外任一處按下就收
      const away = await page.evaluate(() => {
        const r = document.getElementById('statPop').getBoundingClientRect();
        return [innerWidth / 2, Math.min(innerHeight - 130, r.bottom + 150)];
      });
      await page.mouse.click(away[0], away[1]); await page.waitForTimeout(200);
      ok(`SP14 ${tag} 點卡外任一處就收`, await page.evaluate(() => document.getElementById('statPop').hidden), JSON.stringify(away));
      ok(`SP15 ${tag} 零 pageerror`, errs.length === 0, errs.slice(0, 2).join(' | '));
    } finally { await close(); }
  }
}


// ── TB 段:頂列單排契約與群組選單(2026-08-27 使用者連下三個裁示)────────────────
//   ①「時鐘徽章現在在大跟特大設定 會跑到第二排 我希望無論如何都收在第一排」
//   ②「或者是 你把那四顆鈕收成一顆 點擊會打開就好」
//   ③ 標準字級也一起收(長方形牌 96px 讓不出第四顆鈕的位置;讓牌收寬會讓「軌島」兩字直排)
//   ④「左上的logo 我希望要維持以前的款式 就是長方形而非正方形的」(推翻 08-22 D4 的方形 logo)
//
// 🔴 這一段擋的是**排法**不是某次量到的數字:
//    TB2「單排」用「組件頂端落差 < 最高組件的高」而不是「頂列高 <= N px」——
//    後者是會隨文案/字級漂移的魔術數字(心得 35),而且頂列一換行它照樣可能小於門檻。
// 🔴 TB6 一定要在「有營運公告」的狀態量:頂列基底是 flex-wrap:wrap,而 wrap **會在縮之前先換行**,
//    公告鈕一出現(整排多約 49px)群組鈕就整顆掉到第二排。乾淨態量不到這個壞法——
//    2026-08-27 的 2×2 版正是這樣通過乾淨態、卻在有公告時破功(心得 28:互動/狀態累積後的態要量)。
const TB_ALERT = n => {
  // 走產品自己的路徑(塞公告資料再呼叫 renderAlertBanner),不是直接把鈕 hidden=false:
  // 手動掀開的鈕不保證與真實渲染同寬,量到的會是產品不會出現的幾何。
  // 不動 state.mode(那會讓畫面與資料對不上而拋錯);照當下模式塞進它自己的來源
  const list = Array.from({ length: n }, (_, i) => ({ title: `測試公告 ${i + 1}`, start: '2026-08-27' }));
  if (state.mode === 'sched') state.alert = { list }; else state.metroAlert = { list };
  renderAlertBanner();
  return { chipShown: !document.getElementById('alertChip').hidden,
           chipN: document.getElementById('alertChipN').textContent };
};
const TB_PROBE = () => {
  const R = e => { if (!e || !e.getClientRects().length) return null; const q = e.getBoundingClientRect();
    return { l: +q.left.toFixed(1), r: +q.right.toFixed(1), t: +q.top.toFixed(1), b: +q.bottom.toFixed(1), w: +q.width.toFixed(1), h: +q.height.toFixed(1) }; };
  const tb = document.querySelector('.topbar'), cs = getComputedStyle(tb);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
             + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  const parts = [['牌', tb.querySelector('.tb-plate')], ['時鐘', tb.querySelector('.badge')],
                 ['公告', tb.querySelector('.alert-chip')],
                 ['群組', tb.querySelector('.gtab-one') || tb.querySelector('.grouptabs')]];
  const vis = parts.map(([k, e]) => [k, R(e)]).filter(x => x[1]);
  return { tb: R(tb), padY: +padY.toFixed(1), vis,
    plate: R(tb.querySelector('.tb-plate')), logo: R(tb.querySelector('.tb-logo')),
    one: R(tb.querySelector('.gtab-one')), tabsBox: R(tb.querySelector('.grouptabs')),
    wrap: cs.flexWrap };
};
const TB_POP = () => {
  const pop = document.getElementById('gtabPop');
  const rows = [...document.querySelectorAll('#gtabPop .gp-row')].map(b => {
    const q = b.getBoundingClientRect();
    const tn = [...b.querySelector('.gp-nm').childNodes].find(x => x.nodeType === 3);
    let ink = null;
    if (tn) { const rg = document.createRange(); rg.selectNodeContents(tn); const t = rg.getBoundingClientRect(); ink = { w: t.width, h: t.height, l: t.left, r: t.right }; }
    const nb = b.querySelector('.gp-nm').getBoundingClientRect();
    // 🔴 「被切」只能綁真的會切的邊界。`.gp-nm` 與 #gtabPop 都沒有 overflow:hidden ⇒ 垂直方向
    //    永遠切不掉,而 line-height:normal 的墨跡框本來就會比行框高零點幾 px(字型 ascent/descent),
    //    拿它當判準會在 WebKit xlarge 報一個看不見的假缺陷(心得 25:盒對齊≠字形對齊)。
    //    真正會壞的是兩件事:字比自己的欄位寬(列被擠扁)、字跑到選單框外面。
    const pr = pop.getBoundingClientRect();
    return { sh: b.querySelector('.gp-sh').textContent.trim(), nm: b.querySelector('.gp-nm').textContent.trim(),
      cur: b.getAttribute('aria-current') === 'true', h: +q.height.toFixed(1),
      inView: q.left >= -0.5 && q.right <= innerWidth + 0.5 && q.top >= -0.5 && q.bottom <= innerHeight + 0.5,
      clipped: !!ink && (ink.w > nb.width + 0.5 || ink.l < pr.left - 0.5 || ink.r > pr.right + 0.5) };
  });
  return { open: !pop.hidden, expanded: document.getElementById('gtabOne')?.getAttribute('aria-expanded'),
    rows, want: TAB_GROUPS.map(g => g.short + '/' + g.label),
    oneTx: document.getElementById('gtabOneTx')?.textContent.trim(), group: state.group };
};
async function sectionTB(browser, engine) {
  // ── 桌面反向對照:寬螢幕不是手機殼,四顆分頁要在、收合鈕不能出現。
  //    少了這一半,「乾脆全平台都收成一顆」也會全綠。
  {
    const { page, errs, close } = await boot(browser, { width: 1280, tier: 'std' });
    const r = await page.evaluate(GS_RESOLVE);
    // 桌面殼根本不渲染 .topbar,四顆分頁住在桌面 header 裡——所以這裡連「在哪一組」一起驗
    ok(`TB0 ${engine} 反向對照·桌面 1280 維持四顆分頁(在桌面 header)、收合鈕不出現`,
      r.kind === 'tabs' && r.tabsN === 4 && r.oneShown === false && r.scope === 'header', JSON.stringify(r));
    ok(`TB0e ${engine} 反向對照·零 pageerror`, errs.length === 0, errs[0] || '');
    await close();
  }

  for (const tier of ['std', 'large', 'xlarge']) {
    for (const width of [360, 393, 414]) {
      const { page, errs, close } = await boot(browser, { width, tier });
      const tag = `${engine} ${tier} ${width}pt`;
      // 有公告是最擠的常態(見上方 TB6 的說明);先量乾淨態再加公告,兩態都要單排。
      const clean = await page.evaluate(TB_PROBE);
      const lit = await page.evaluate(TB_ALERT, 3);
      await page.waitForTimeout(220);
      const busy = await page.evaluate(TB_PROBE);

      // 裁示①③:三個字級都收成一顆
      ok(`TB1 ${tag} 四顆群組分頁收成一顆(#gtabOne 在、四顆那列不渲染)`,
        !!busy.one && !busy.tabsBox, `一顆=${!!busy.one} 四顆列=${!!busy.tabsBox}`);
      // 裁示④:長方形文字牌回來、方形 logo 讓位
      ok(`TB4 ${tag} 左上是長方形軌島牌,方形 logo 不露臉`,
        !!busy.plate && !busy.logo && busy.plate.w > busy.plate.h,
        `牌 ${busy.plate ? busy.plate.w + '×' + busy.plate.h : '無'} 方形logo=${!!busy.logo}`);
      ok(`TB5 ${tag} 前置·公告鈕真的被產品自己掀開了(${lit.chipN || '無數字'})`,
        lit.chipShown === true && busy.vis.some(v => v[0] === '公告'), JSON.stringify(lit));

      for (const [state_, r] of [['乾淨', clean], ['有公告', busy]]) {
        const maxH = Math.max(...r.vis.map(x => x[1].h));
        const spread = Math.max(...r.vis.map(x => x[1].t)) - Math.min(...r.vis.map(x => x[1].t));
        ok(`TB2 ${tag}/${state_} 頂列是單排(組件頂端落差 ${spread.toFixed(1)} < 最高組件 ${maxH})`,
          spread < maxH, r.vis.map(x => `${x[0]} t=${x[1].t}`).join(' '));
        const over = r.vis.filter(([, v]) => v.r > r.tb.r + 0.5 || v.l < r.tb.l - 0.5).map(([k, v]) => `${k}[${v.l},${v.r}]`);
        ok(`TB3 ${tag}/${state_} 沒有組件溢出頂列(${r.tb.l}~${r.tb.r})`, over.length === 0, over.join(' '));
        // 高度判準從當下量到的東西推導(最高組件+自己的內距),不寫死 px
        ok(`TB6 ${tag}/${state_} 頂列高 ${r.tb.h} 收在「最高組件 ${maxH} + 內距 ${r.padY}」之內`,
          r.tb.h <= maxH + r.padY + 1, `wrap=${r.wrap}`);
      }
      // 🔴 結構性:nowrap 是這條契約的機制本身(wrap 會在縮之前先換行)。
      //    只驗幾何不驗它,換一種寫法讓幾何碰巧過關時就沒有牙了。
      ok(`TB7 ${tag} 結構性:手機殼頂列是 nowrap(wrap 會在縮之前先換行)`, busy.wrap === 'nowrap', busy.wrap);

      // ── 選單:四個群組的字在這裡才需要活下來(收合之後頂列不再放它們)
      await page.tap('.topbar .gtab-one');
      await page.waitForTimeout(300);
      const p1 = await page.evaluate(TB_POP);
      ok(`TB8 ${tag} 點一顆就開選單,四個群組一個不少`, p1.open && p1.rows.length === 4
        && p1.rows.map(r => r.sh + '/' + r.nm).join() === p1.want.join(),
        JSON.stringify({ open: p1.open, got: p1.rows.map(r => r.sh + '/' + r.nm), want: p1.want }));
      ok(`TB9 ${tag} 選單每一列都在視窗內、字沒被自己的框切掉、觸控高度 ≥44`,
        p1.rows.length > 0 && p1.rows.every(r => r.inView && !r.clipped && r.h >= 43.5),
        JSON.stringify(p1.rows.map(r => ({ nm: r.nm, h: r.h, inView: r.inView, clipped: r.clipped }))));
      ok(`TB10 ${tag} 目前這一群在選單裡有標記(aria-current),且恰好一個`,
        p1.rows.filter(r => r.cur).length === 1, JSON.stringify(p1.rows.map(r => [r.nm, r.cur])));
      ok(`TB10b ${tag} aria-expanded 跟著開合走`, p1.expanded === 'true', String(p1.expanded));

      // 真的點一列換組:選單要收、state.group 要變、一顆鈕上的字要跟著換
      const target = p1.rows.find(r => !r.cur);
      const rows = page.locator('#gtabPop .gp-row');
      const n = await rows.count();
      for (let i = 0; i < n; i++) {
        if ((await rows.nth(i).locator('.gp-nm').textContent() || '').trim() === target.nm) { await rows.nth(i).tap(); break; }
      }
      await page.waitForTimeout(900);
      const p2 = await page.evaluate(TB_POP);
      ok(`TB11 ${tag} 點「${target.nm}」真的換組(${p1.group}→${p2.group})、選單收掉、鈕上的字跟著換成「${target.sh}」`,
        !p2.open && p2.group !== p1.group && p2.oneTx === target.sh,
        JSON.stringify({ open: p2.open, group: p2.group, oneTx: p2.oneTx, want: target.sh }));

      // 關法兩種:Esc 與點外面。兩條分開寫——只留一條時另一條壞掉沒人知道。
      await page.tap('.topbar .gtab-one'); await page.waitForTimeout(260);
      const beforeEsc = await page.evaluate(() => !document.getElementById('gtabPop').hidden);
      await page.keyboard.press('Escape'); await page.waitForTimeout(240);
      const afterEsc = await page.evaluate(() => !document.getElementById('gtabPop').hidden);
      ok(`TB12 ${tag} Esc 收得掉選單`, beforeEsc === true && afterEsc === false, `開=${beforeEsc} 關=${afterEsc}`);
      await page.evaluate(() => gtabPopSet(false));   // 不繼承上一條的結果:兩條要能各自指認自己壞了
      await page.waitForTimeout(160);
      await page.tap('.topbar .gtab-one'); await page.waitForTimeout(260);
      const beforeOut = await page.evaluate(() => !document.getElementById('gtabPop').hidden);
      await page.mouse.click(Math.round(width / 2), 600);
      await page.waitForTimeout(260);
      const afterOut = await page.evaluate(() => !document.getElementById('gtabPop').hidden);
      ok(`TB13 ${tag} 點選單外面收得掉`, beforeOut === true && afterOut === false, `開=${beforeOut} 關=${afterOut}`);

      ok(`TB14 ${tag} 零 pageerror`, errs.length === 0, errs[0] || '');
      await close();
    }
  }
}

const ALL = { A: sectionA, B: sectionB, C: sectionC, D: sectionD, E: sectionE, F: sectionF, G: sectionG, H: sectionH, I: sectionI, J: sectionJ, K: sectionK, L: sectionL, M: sectionM, MX: sectionMx, N: sectionN, NX: sectionNx, O: sectionO, P: sectionP, Q: sectionQ, R: sectionR, S: sectionS, T: sectionT, U: sectionU, V: sectionV, W: sectionW, X: sectionX, Y: sectionY, Z: sectionZ, SP: sectionSP, TB: sectionTB };
const want = (process.env.SECTIONS || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
const run = want.length ? want : Object.keys(ALL);
for (const k of run) if (!ALL[k]) { console.error(`未知段別 ${k}`); process.exit(2); }
if (want.length) console.log(`⚠ 只跑 ${run.join(',')} 段(SECTIONS 環境變數),這不是完整驗收`);
// ENGINES=webkit 之類的窄化只給突變測試用(跑一輪要分辨紅的是哪一發,不必兩個引擎各跑一次);
// 正式驗收不要傳,傳了會像 SECTIONS 一樣印出警告。
const ENG_ALL = [['chromium', chromium], ['webkit', webkit]];
const engWant = (process.env.ENGINES || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const ENG = engWant.length ? ENG_ALL.filter(e => engWant.includes(e[0])) : ENG_ALL;
if (engWant.length) console.log(`⚠ 只跑 ${ENG.map(e => e[0]).join(',')} 引擎(ENGINES 環境變數),這不是完整驗收`);
if (!ENG.length) { console.error('ENGINES 沒有對到任何引擎'); process.exit(2); }
for (const [engine, launcher] of ENG) {
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
// 🔴 尾端重列一次紅的:1040 條的輸出動輒被 `| tail` 截掉,只留總計等於知道有紅卻不知道紅在哪
//    (2026-08-26 實測白跑一輪)。清單放在總計之後,無論怎麼截都跟著總計一起留下來。
const bad = results.filter(r => !r.pass);
if (bad.length) console.log(bad.map(f => '  FAIL ' + f.name + (f.detail ? ' — ' + f.detail : '')).join('\n'));
process.exit(pass === results.length ? 0 : 1);
