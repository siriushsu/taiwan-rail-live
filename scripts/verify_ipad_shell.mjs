// iPad Universal 驗收:殼斷點、側欄、沉浸入口。chromium+webkit × 觸控寬度矩陣
//
// 為什麼要有這一支:全 repo 既有 23 支驗收的 hasTouch 一律只配寬度 ≤768,
// 「(any-pointer: coarse) and (max-width: 1400px)」這條新分支結構上零覆蓋。
//
// 突變測試紀錄(2026-08-29,每發都先指名「要考哪一條」再跑;基準 110/110):
//  A 互補區塊改回 @media(min-width:901px)and(min-height:501px) → 考 S3
//      ⇒ 90/110:S3×8 S5×8 I1×2 I2×2 紅,D1 正確維持綠(該突變只壞 iPad 不壞桌面)。
//      診斷值 tabbar=false toolsFab=false stageTools=false ＝兩個區塊打架、兩種控制項都沒有。
//  B 把 RAIL_MQ 的第一段(原條件)刪掉只留新分支 → 考 iPhone SE 橫 的 S2
//      ⇒ 104/110:恰好 iPhone SE 橫 的 S2/S4/S5 紅,其餘全綠。這正是「用 min-width:700 取代原條件
//      會靜默退掉 667×375 的側欄」那個坑。
//  C --rail-w 改成 clamp(320px,30vw,420px) → 考 iPhone 兩格的 S4
//      ⇒ 106/110:SE 量到 320(應 280.1)、Pro Max 量到 320(應 340);iPad 三格維持綠。
//  C2 --rail-w 改成固定 340px → 考 iPad 的 S4
//      ⇒ 104/110:iPad 11"/13" 與 SE 紅,iPhone 橫(932)正確維持綠。
//  D 刪掉抽屜的 data-proxy="immBtn" 那一列 → 考 I1/I2 ⇒ 106/110:恰好那 4 條紅。
//
// 這支驗不到的事(別誤以為綠就代表沒問題):
//  1. any-pointer vs pointer 的差別。Playwright 的 isMobile 讓兩者同時為 coarse,
//     「iPad 接巧控鍵盤觸控板 ⇒ pointer 翻 fine、any-pointer 仍 coarse」只有真機驗得到。
//  2. 換殼過渡(Stage Manager 連續 resize 跨越 900/1400)。setViewportSize 不會重跑
//     context 的 hasTouch/isMobile,跨 1400 那一側量不到真實行為。
//  3. 原生殼行為(Split View、Slide Over 真實幾何、小工具)。
import { chromium, webkit } from 'playwright';

const PORT = process.env.PORT || 5191;
const URL = `http://localhost:${PORT}/`;
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

async function bootPage(browser, { width, height, touch = false, immersive = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    hasTouch: touch, isMobile: touch,
  });
  await ctx.addInitScript(imm => {
    localStorage.setItem('trainmap-howto-seen', '1');   // 關首訪教學卡,否則它蓋住地圖
    localStorage.setItem('trainmap-appearance', 'light');
    if (imm) localStorage.setItem('trainmap-immersive', '1');
  }, immersive);
  const page = await ctx.newPage();
  await page.route(/\/api\/(delay-stats|today-board|station-events)/,
    r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));   // 逾時訊息零資訊,先掛這條才看得到真因
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    try { return typeof state !== 'undefined' && state.ready; } catch (e) { return false; }
  }, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}

// 開「更多」抽屜。#tabMore 不可見就回 false 而不是逾時崩掉——會死的 harness 比報紅的更糟:
// 突變測試時它一崩,後面所有判準(含 D1)整段沒跑,看起來像「沒抓到」。
async function openMoreDrawer(page) {
  const visible = await page.evaluate(() => {
    const el = document.getElementById('tabMore');
    if (!el) return false;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
  });
  if (!visible) return false;
  await page.click('#tabMore');
  await page.waitForFunction(() => document.body.classList.contains('tools-open'), null, { timeout: 5000 });
  return true;
}

// ── 前提:hasTouch 到底有沒有讓 any-pointer:coarse 為真 ──
// 這條不過,下面整組判準都是空的(判準對象不存在),必須改用真模擬器 Safari 驗。
for (const [engName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch();
  const { ctx, page } = await bootPage(browser, { width: 1194, height: 834, touch: true });
  const mq = await page.evaluate(() => ({
    anyCoarse: matchMedia('(any-pointer: coarse)').matches,
    pointerCoarse: matchMedia('(pointer: coarse)').matches,
  }));
  ok(`${engName} P0 hasTouch 讓 any-pointer:coarse 為真`, mq.anyCoarse === true, JSON.stringify(mq));
  await ctx.close();
  await browser.close();
}

// ── 殼落點矩陣 ──
// 規格 §3.4。前三格是「不准退掉」的既有情境,改動前後都必須綠。
const SHELL_CASES = [
  { name: 'iPhone SE 橫', w: 667, h: 375, touch: true, wantMobile: true, wantRail: true },
  { name: 'iPhone 橫', w: 932, h: 430, touch: true, wantMobile: true, wantRail: true },
  { name: 'iPhone 直', w: 390, h: 844, touch: true, wantMobile: true, wantRail: false },
  { name: 'iPad mini 橫', w: 1133, h: 744, touch: true, wantMobile: true, wantRail: true },
  { name: 'iPad 11" 橫', w: 1210, h: 834, touch: true, wantMobile: true, wantRail: true },
  { name: 'iPad 13" 橫', w: 1376, h: 1032, touch: true, wantMobile: true, wantRail: true },
  { name: 'iPad 13" 直', w: 1032, h: 1376, touch: true, wantMobile: true, wantRail: false },
  { name: 'iPad 11" 直', w: 834, h: 1210, touch: true, wantMobile: true, wantRail: false },
  { name: 'Slide Over', w: 320, h: 1024, touch: true, wantMobile: true, wantRail: false },
  { name: 'Split 1/2', w: 678, h: 1032, touch: true, wantMobile: true, wantRail: false },
  { name: '桌機 1440', w: 1440, h: 900, touch: false, wantMobile: false, wantRail: false },
  { name: '桌機 1280', w: 1280, h: 800, touch: false, wantMobile: false, wantRail: false },
];

for (const [engName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch();
  for (const c of SHELL_CASES) {
    const { ctx, page } = await bootPage(browser, { width: c.w, height: c.h, touch: c.touch });

    const got = await page.evaluate(() => {
      const vis = sel => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
      };
      // --rail-w 是自訂屬性,getPropertyValue 回的是「字面 token」(min(340px, 42vw))不是長度。
      // 要拿用值只能塞一個真元素進去量。未定義時 width 失效 ⇒ 量到 0。
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;left:-9999px;top:0;height:1px;width:var(--rail-w);';
      document.body.appendChild(d);
      const railW = d.getBoundingClientRect().width;
      d.remove();
      return {
        fs: document.body.classList.contains('fs'),
        rail: typeof sheetIsSideRail === 'function' ? sheetIsSideRail() : null,
        railW,
        tabbarVis: vis('.tabbar'),
        toolsFabVis: vis('#toolsFab'),
        stageToolsVis: vis('.stage-tools'),
      };
    });

    ok(`${engName} S1 ${c.name} 落在預期的殼`, got.fs === c.wantMobile,
      `fs=${got.fs} want=${c.wantMobile}`);
    ok(`${engName} S2 ${c.name} sheetIsSideRail() 回預期值`, got.rail === c.wantRail,
      `rail=${got.rail} want=${c.wantRail}`);

    // S3:抓「手機殼區塊與互補區塊打架」。互補區塊會 .tabbar{display:none!important}
    // 並 #toolsFab{display:inline-flex!important};只放寬 MOBILE_MQ 沒動互補區塊時,
    // iPad 橫放會兩邊都命中而互補區塊(在後面)贏 ⇒ 這條轉紅。
    // 註:.stage .controls 在手機殼並沒有被藏(122x41 的殘件),不能拿它當判別。
    ok(`${engName} S3 ${c.name} tab bar 與桌面工具帶各自只在自己的殼出現`,
      got.tabbarVis === c.wantMobile && got.toolsFabVis === !c.wantMobile
      && got.stageToolsVis === !c.wantMobile,
      `tabbar=${got.tabbarVis} toolsFab=${got.toolsFabVis} stageTools=${got.stageToolsVis}`);

    if (c.wantRail) {
      // CSS clamp(MIN,VAL,MAX) = max(MIN, min(VAL,MAX));此處 MIN = min(340px, 42vw)
      const lo = Math.min(340, c.w * 0.42);
      const want = Math.max(lo, Math.min(c.w * 0.30, 420));
      ok(`${engName} S4 ${c.name} 側欄寬符合 clamp`, Math.abs(got.railW - want) < 1.5,
        `railW=${Math.round(got.railW * 10) / 10} want=${Math.round(want * 10) / 10}`);
    }

    // S5:真的開一個面板,量它落在哪。這條刻意不問 sheetIsSideRail(),
    // 判準來源是像素而不是實作的同一個函式(避免同源假綠)。
    // 閘門看「實際觀測到的 tab bar」而不是「期望的殼」:期望手機殼但實際還在桌面殼時,
    // 硬點會讓腳本逾時崩掉(看起來像壞掉),要的是一條紅燈。
    if (c.wantMobile && !got.tabbarVis) {
      ok(`${engName} S5 ${c.name} 面板形態(像素)`, false, 'tab bar 不可見,開不了面板(殼還沒切過來)');
    } else if (c.wantMobile) {
      await page.click('#tabSearch');
      await page.waitForTimeout(450);
      const g = await page.evaluate(() => {
        const el = document.getElementById('searchPanel');
        if (!el || el.hidden) return null;
        const b = el.getBoundingClientRect();
        return {
          x: b.x, y: b.y, w: b.width, h: b.height,
          gapRight: innerWidth - b.right, vw: innerWidth, vh: innerHeight,
        };
      });
      if (!g) {
        ok(`${engName} S5 ${c.name} 面板形態(像素)`, false, '面板沒開起來');
      } else if (c.wantRail) {
        // 右側欄形態 = 右貼齊 + 滿高 + 不吃滿寬。刻意不用 x 的絕對門檻:
        // #searchPanel 寬是 max(420px, 50vw)(比 --rail-w 寬,見 index.html:4133),
        // 在 667 這種窄橫向 x 只有 vw 的 37%,拿 40% 當門檻會誤殺既有正確行為。
        const pass = g.gapRight < 2 && g.h >= g.vh * 0.95 && g.w <= g.vw * 0.8;
        ok(`${engName} S5 ${c.name} 面板形態(像素)=右側欄`, pass,
          `x=${Math.round(g.x)} w=${Math.round(g.w)} h=${Math.round(g.h)} gapR=${Math.round(g.gapRight)} vw=${g.vw} vh=${g.vh}`);
      } else {
        const pass = g.w >= g.vw * 0.9 && g.y > 8;
        ok(`${engName} S5 ${c.name} 面板形態(像素)=上錨 sheet`, pass,
          `x=${Math.round(g.x)} y=${Math.round(g.y)} w=${Math.round(g.w)} vw=${g.vw}`);
      }
    }

    await ctx.close();
  }
  await browser.close();
}

// ── 極簡沉浸在手機殼要有入口,而且要能關掉 ──
// 為什麼:#immBtn 住在 .stage-tools 裡,而手機殼把 .stage-tools 三態全部 display:none
// ⇒ 父層不算數,`body.fs #immBtn{display:flex}` 救不了它。更糟的是 immersive 會從
// localStorage 還原(開機時 setImmersive(true)),而 body.fs.immersive 會藏掉 .follow-panel/
// .followbar/#randBtn/#nearBtn ⇒ 在桌面開過極簡,到 iPad 就卡在沉浸態、沒有 UI 關得掉。
// 注意:setMore 是 index.html 那個區塊內的 const,page.evaluate 的全域看不到它
// (原始碼裡 `typeof setMore === 'function'` 那句就是證據)。一律真的點 #tabMore 開抽屜。
for (const [engName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch();

  // I1 抽屜裡有沉浸列,且點得到(≥44 觸控高)
  {
    const { ctx, page } = await bootPage(browser, { width: 1210, height: 834, touch: true });
    const opened = await openMoreDrawer(page);
    await page.waitForTimeout(250);
    // 抽屜是可捲容器,這一列在「觀看模式」段、預設位置在視窗外(1210×834 時 y≈1051)。
    // 直接對視窗外的點做 elementFromPoint 會回 null ⇒ 誤判成「被蓋住/點不到」。
    // 要問的是「捲得到而且捲到之後點得到」,所以先 scrollIntoView 再命中測試。
    await page.evaluate(() => {
      const el = document.querySelector('#moreBody .ms-row[data-proxy="immBtn"]');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const row = await page.evaluate(() => {
      const el = document.querySelector('#moreBody .ms-row[data-proxy="immBtn"]');
      if (!el) return null;
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      const inView = r.top >= 0 && r.bottom <= innerHeight;
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return {
        w: r.width, h: r.height, display: cs.display, inView,
        hitIsRow: !!(hit && el.contains(hit)),
        hitWas: hit ? (hit.tagName + (hit.className && typeof hit.className === 'string' ? '.' + hit.className.trim().split(/\s+/)[0] : '')) : 'null',
      };
    });
    ok(`${engName} I1 抽屜有極簡沉浸列,捲得到且點得到`,
      opened && !!(row && row.w > 0 && row.h >= 44 && row.display !== 'none' && row.inView && row.hitIsRow),
      !opened ? '開不了「更多」抽屜(#tabMore 不可見)'
        : row ? JSON.stringify({ ...row, w: Math.round(row.w), h: Math.round(row.h) }) : '找不到該列');
    await ctx.close();
  }

  // I2 從「桌面開過沉浸」的狀態進 iPad,關得掉(這是卡死那條)
  {
    const { ctx, page } = await bootPage(browser, { width: 1210, height: 834, touch: true, immersive: true });
    const before = await page.evaluate(() => document.body.classList.contains('immersive'));
    const opened = await openMoreDrawer(page);
    await page.waitForTimeout(250);
    const clicked = opened && await page.evaluate(() => {
      const el = document.querySelector('#moreBody .ms-row[data-proxy="immBtn"]');
      if (!el) return false;
      el.click();   // 走真實的 data-proxy 派發器,不是直接呼叫 setImmersive
      return true;
    });
    await page.waitForTimeout(350);
    const after = await page.evaluate(() => document.body.classList.contains('immersive'));
    ok(`${engName} I2 沉浸態在 iPad 關得掉`, opened && before === true && clicked && after === false,
      `開抽屜=${opened} before=${before} 找到列=${clicked} after=${after}`);
    await ctx.close();
  }

  await browser.close();
}

// ── D1:互補區塊(原 index.html:4154 的 @media,現為 :where(body:not(.fs)) 巢狀)在桌面逐條仍生效 ──
// 為什麼要驗:改成巢狀之後,以 body 開頭的選取器會生成 `body … body …` 而靜默失效;
// 「規則還在檔案裡」不是證據,要看 computed style。
// 這幾顆的期望值是 2026-08-29 從改動前的版本量到的,且都在「整塊失效」的突變中轉紅(有牙)。
// 註:#ambientStyleBtn 刻意不列——index.html:1579 已有一條基礎規則把它藏著,
// 互補區塊那條在非放空態是多餘的,拿它當判準恆綠、零資訊。
const DESK_EXPECT = [
  ['.tabbar', 'display', 'none'],
  ['.more-sheet .grab', 'display', 'none'],
  ['.more-sheet .ms-row', 'minHeight', '40px'],
  ['#toolsFab', 'display', 'flex'],
  ['#introBtn', 'display', 'none'],
  ['#musicBtn .tl', 'display', 'none'],
  ['.controls', 'bottom', '6px'],
];
for (const [engName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch();
  const { ctx, page } = await bootPage(browser, { width: 1440, height: 900, touch: false });
  const got = await page.evaluate(exp => exp.map(([sel, prop]) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el)[prop] : 'NO_MATCH';
  }), DESK_EXPECT);
  const bad = DESK_EXPECT.map((e, i) => [e, got[i]]).filter(([e, g]) => g !== e[2]);
  ok(`${engName} D1 互補區塊在桌面逐條生效`, bad.length === 0,
    bad.length ? bad.map(([e, g]) => `${e[0]}.${e[1]}=${g}(want ${e[2]})`).join('; ')
               : `${DESK_EXPECT.length} 條全中`);
  await ctx.close();
  await browser.close();
}

console.log(`\n總計 ${results.filter(r => r.pass).length}/${results.length}`);
const failed = results.filter(r => !r.pass);
if (failed.length) console.log('FAIL 清單:\n' + failed.map(r => `  ${r.name} — ${r.detail}`).join('\n'));
process.exit(failed.length ? 1 : 0);
