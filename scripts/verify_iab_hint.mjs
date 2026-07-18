// App 內建瀏覽器逃生提示(iab-hint)驗證:UA 偵測矩陣 × 顯示/不顯示 × 按鈕組裝 × 關閉持久化 × 幾何(44px/不壓 tabbar)
// 用法:node scripts/verify_iab_hint.mjs            (預設打本機 dev server http://localhost:5179)
//       VURL=https://<預覽或正式站> node scripts/verify_iab_hint.mjs
import { chromium, webkit } from 'playwright';

const BASE = process.env.VURL || 'http://localhost:5179';
const SHOW_WAIT = 2600; // 提示卡 1400ms 後浮出,留餘裕

const UA = {
  threadsIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22F76 Barcelona 382.1.0.34.109',
  igIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22F76 Instagram 382.0.0.0 (iPhone16,2; iOS 18_5; zh_TW)',
  fbAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.135 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.38.108;]',
  lineIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 Line/15.10.0/IAB',
  wvAndroid: 'Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36',
  safariIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.122 Mobile Safari/537.36',
  criOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1',
};

let pass = 0, fail = 0;
const bad = [];
function chk(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; bad.push(name); console.log(`  ❌ ${name}${extra ? '　' + extra : ''}`); }
}

async function openPage(browser, { ua, w = 375, h = 812, preDismiss = false, freshHowto = false } = {}) {
  const ctx = await browser.newContext({
    userAgent: ua, viewport: { w, h } && { width: w, height: h },
    isMobile: true, hasTouch: true, locale: 'zh-TW',
  });
  // 預設把首訪教學卡標成已看過(它 z 800 蓋全場,提示卡會等它收掉);接棒順序另有專測(freshHowto)
  if (!freshHowto) await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  if (preDismiss) await ctx.addInitScript(() => { try { localStorage.setItem('iabHintDismiss', '1'); } catch (e) {} });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(SHOW_WAIT);
  return { ctx, page, errs };
}

async function hintState(page) {
  return page.evaluate(() => {
    const el = document.getElementById('iabHint');
    if (!el) return { exists: false };
    const btns = [...el.querySelectorAll('.ih-btns button')].map(b => b.textContent.trim());
    return { exists: true, hidden: el.hidden, btns, note: (document.getElementById('iabNote') || {}).textContent || '' };
  });
}

async function main() {
  console.log(`目標:${BASE}`);
  for (const engineName of ['chromium', 'webkit']) {
    const engine = engineName === 'chromium' ? chromium : webkit;
    const browser = await engine.launch();
    console.log(`\n=== ${engineName} ===`);

    // 1) 顯示矩陣:in-app UA 要出現、一般瀏覽器不出現
    const showCases = [
      ['Threads iOS(Barcelona)', UA.threadsIOS, true, '複製網址'],
      ['IG iOS', UA.igIOS, true, '複製網址'],
      ['FB Android(FB_IAB+wv)', UA.fbAndroid, true, '用瀏覽器開啟'],
      ['LINE iOS', UA.lineIOS, true, '用瀏覽器開啟'],
      ['generic Android wv', UA.wvAndroid, true, '用瀏覽器開啟'],
      ['Safari iOS 真瀏覽器', UA.safariIOS, false],
      ['Chrome Android 真瀏覽器', UA.chromeAndroid, false],
      ['Chrome iOS(CriOS)', UA.criOS, false],
    ];
    for (const [name, ua, expectShow, primary] of showCases) {
      const { ctx, page, errs } = await openPage(browser, { ua });
      const st = await hintState(page);
      const shown = st.exists && !st.hidden;
      chk(`${name} → ${expectShow ? '顯示' : '不顯示'}`, shown === expectShow, JSON.stringify(st));
      if (expectShow && shown && primary) chk(`${name} 主按鈕=${primary}`, st.btns[0] === primary, `實際 ${JSON.stringify(st.btns)}`);
      if (expectShow && shown && name === 'Threads iOS(Barcelona)') chk('iOS 有「⋯」指引文字', /⋯|外部瀏覽器/.test(st.note), st.note);
      chk(`${name} 零 pageerror`, errs.length === 0, errs.join(' | '));
      await ctx.close();
    }

    // 2) 桌機一般 UA 不顯示(預設 UA、桌機視窗)
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(SHOW_WAIT);
      const st = await hintState(page);
      chk('桌機預設 UA → 不顯示', st.exists && st.hidden, JSON.stringify(st));
      await ctx.close();
    }

    // 3) 已按過 × 的訪客不再顯示
    {
      const { ctx, page } = await openPage(browser, { ua: UA.threadsIOS, preDismiss: true });
      const st = await hintState(page);
      chk('localStorage 已關 → 不顯示', st.hidden === true, JSON.stringify(st));
      await ctx.close();
    }

    // 4) 關閉流程:點 × → 隱藏 + 記 localStorage → 重整仍隱藏
    {
      const { ctx, page } = await openPage(browser, { ua: UA.threadsIOS });
      await page.click('#iabClose');
      const st1 = await hintState(page);
      const flag = await page.evaluate(() => localStorage.getItem('iabHintDismiss'));
      chk('點 × 後隱藏且寫入 localStorage', st1.hidden === true && flag === '1', `hidden=${st1.hidden} flag=${flag}`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(SHOW_WAIT);
      const st2 = await hintState(page);
      chk('重整後仍不顯示', st2.hidden === true, JSON.stringify(st2));
      await ctx.close();
    }

    // 5) 複製網址:按下後按鈕變「已複製 ✓」(clipboard 失敗會走 execCommand 後備,仍應變字)
    {
      const { ctx, page } = await openPage(browser, { ua: UA.threadsIOS });
      if (engineName === 'chromium') { try { await ctx.grantPermissions(['clipboard-write', 'clipboard-read']); } catch (e) {} }
      await page.click('#iabBtns button');
      await page.waitForTimeout(400);
      const st = await hintState(page);
      chk('複製後按鈕變「已複製 ✓」', st.btns[0] === '已複製 ✓', JSON.stringify(st.btns));
      await ctx.close();
    }

    // 6) LINE 逃生:點「用瀏覽器開啟」→ 導向帶 openExternalBrowser=1
    {
      const { ctx, page } = await openPage(browser, { ua: UA.lineIOS });
      await page.click('#iabBtns button');
      await page.waitForURL(/openExternalBrowser=1/, { timeout: 8000 }).catch(() => {});
      chk('LINE 導向帶 openExternalBrowser=1', /openExternalBrowser=1/.test(page.url()), page.url());
      await ctx.close();
    }

    // 6b) 首訪接棒順序:教學卡開著時提示卡不出,關掉教學卡後 ~2s 內浮出
    {
      const { ctx, page } = await openPage(browser, { ua: UA.threadsIOS, freshHowto: true });
      const before = await page.evaluate(() => ({
        howto: !document.getElementById('howtoWrap').hidden,
        hint: !document.getElementById('iabHint').hidden,
      }));
      chk('教學卡開著時提示卡不出', before.howto === true && before.hint === false, JSON.stringify(before));
      await page.click('#howtoSkip');
      await page.waitForTimeout(2200);
      const after = await hintState(page);
      chk('關教學卡後提示卡浮出', after.hidden === false, JSON.stringify(after));
      await ctx.close();
    }

    // 7) 幾何掃描(Threads UA):卡片在視窗內、不壓 tabbar、按鈕 ≥44px(僅 chromium 掃四寬度,webkit 掃 375)
    const widths = engineName === 'chromium' ? [360, 375, 414, 768] : [375];
    for (const w of widths) {
      const { ctx, page } = await openPage(browser, { ua: UA.threadsIOS, w, h: 812 });
      const g = await page.evaluate(() => {
        const el = document.getElementById('iabHint');
        const r = el.getBoundingClientRect();
        const tb = document.querySelector('.tabbar');
        const tbr = tb && getComputedStyle(tb).display !== 'none' ? tb.getBoundingClientRect() : null;
        const btnHs = [...el.querySelectorAll('button')].map(b => b.getBoundingClientRect().height);
        return { r: { t: r.top, b: r.bottom, l: r.left, rt: r.right }, tbTop: tbr ? tbr.top : null, btnHs, vw: innerWidth, vh: innerHeight };
      });
      const inWin = g.r.l >= 0 && g.r.rt <= g.vw + 0.5 && g.r.t >= 0 && g.r.b <= g.vh + 0.5;
      const clearTb = g.tbTop === null || g.r.b <= g.tbTop + 0.5;
      const btn44 = g.btnHs.every(h2 => h2 >= 43.5);
      chk(`w=${w} 卡片在視窗內`, inWin, JSON.stringify(g.r));
      chk(`w=${w} 不壓 tabbar`, clearTb, `卡底 ${g.r.b} vs tabbar頂 ${g.tbTop}`);
      chk(`w=${w} 按鈕全 ≥44px`, btn44, JSON.stringify(g.btnHs));
      await ctx.close();
    }

    await browser.close();
  }
  console.log(`\n結果:${pass} 過 / ${fail} 敗${fail ? '　敗項:' + bad.join('、') : ''}`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
