// 外語掃描：用英文開站、實際打開各面板／看板／跟車卡，收集畫面上「看得到卻仍是中文」的字。
// 也驗「切換語言後有沒有殘留上一個語言」：用日文開站、再切英文／繁中，掃 kana 殘留；
// 用英文開站再切日文，掃英文譯文殘留（反查字典值）。
//
// 用法：RAIL_I18N_URL=http://127.0.0.1:5191/ node scripts/verify_i18n_sweep.mjs [--app] [--report <file>]
//   --app：模擬原生 App（RAIL_APP_PLATFORM='ios'），走 App 限定的精簡看板與「更多」列。
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.RAIL_I18N_URL || 'http://127.0.0.1:5191/';
const APP = process.argv.includes('--app');
const reportAt = process.argv.indexOf('--report');
const REPORT = reportAt > 0 ? process.argv[reportAt + 1] : null;
const findings = [];
const failures = [];
// 「・」(U+30FB) 落在片假名區段，但繁中與英文譯文也拿它當分隔號（「台南地面鐵道・歷史重播」
// 「Commuter・To …」），不排除的話每張跟車卡都誤報成「殘留假名」。
const HAN_KANA = '[\\u3400-\\u9fff\\u3040-\\u30fa\\u30fc-\\u30ff]';
const KANA = '[\\u3040-\\u30fa\\u30fc-\\u30ff]';

function note(scenario, items) {
  for (const item of items) findings.push({ mode: APP ? 'app' : 'web', scenario, ...item });
  const tag = items.length ? `✗ ${items.length}` : '✓';
  console.log(`${tag} ${APP ? 'app' : 'web'} · ${scenario}${items.length ? '\n    ' + items.map(i => `${i.where} :: ${i.text}`).join('\n    ') : ''}`);
}

async function boot(browser, { lang, viewport, group, mobile }) {
  const context = await browser.newContext({
    viewport, locale: 'zh-TW', timezoneId: 'Asia/Taipei',
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  await context.addInitScript(({ lang, app }) => {
    localStorage.setItem('trainmap-howto-seen', '1');
    localStorage.setItem('trainmap-language', lang);
    if (app) {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {}, isPluginAvailable: () => false };
      window.RAIL_APP = true;
      window.RAIL_APP_PLATFORM = 'ios';
      window.RAIL_APP_VERSION = '1.6.5'; // 「更多」的「軌島」段（版本列、評分）只有帶版本號的 App 才出現
      const mark = () => { if (document.documentElement) document.documentElement.dataset.appPlatform = 'ios'; };
      mark(); document.addEventListener('DOMContentLoaded', mark, { once: true });
    }
  }, { lang, app: APP });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + (group ? `?g=${group}` : ''), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => window.__i18n?.catalogReady && typeof state !== 'undefined' && state.ready
    && (state.trains.length || state.lines.length || state.decoLines.length), null, { timeout: 120_000 });
  await page.waitForTimeout(1500); // 讓 i18nRefreshDynamic／更新紀錄換手跑完
  if (APP) {
    // 版本列與帳號列在真 App 由版本查詢／登入流程寫入（一次性 t() 寫進 DOM，正是換語言會卡住的那類），
    // 這裡用同一支函式直接寫，讓兩列出現在畫面上被掃到。
    await page.evaluate(() => {
      appUpdateRender({ state: { hasUpdate: false, updateChecked: true }, latest: { v: window.RAIL_APP_VERSION } });
      accountBtnSlot();
    });
  }
  return { context, page, errors };
}

// 收集 root 底下「渲染出來的」中文（不要求在視窗內：面板可以捲）。
// 刻意排除：語言切換鈕本身、宣告為中文原文的內容（data-source-lang）、台鐵官方站址與站點特色
// （.addr／.feat，資料源只有中文，與 verify_i18n.mjs 同一套排除），以及看板標題旁的原文站名小標
// （stationHeadingHtml 在外語時刻意附上中文站名；只排除「是已知站名」的那顆，系統徽章照掃）。
async function scanCjk(page, rootSelector, { pattern = HAN_KANA, includeHidden = false } = {}) {
  return page.evaluate(({ rootSelector, pattern, includeHidden }) => {
    const re = new RegExp(pattern);
    const roots = [...document.querySelectorAll(rootSelector)];
    const excluded = '[data-lang], [data-source-lang], .addr, .feat, script, style, noscript';
    const originalNameChip = (el, text) => el.matches('h3 > .sys-chip') && stationName(text, null) !== text;
    const shown = el => includeHidden || (el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true);
    const where = el => {
      const parts = [];
      for (let n = el; n && n !== document.body && parts.length < 3; n = n.parentElement) {
        parts.unshift(n.id ? '#' + n.id : n.tagName.toLowerCase() + (n.classList.length ? '.' + [...n.classList].slice(0, 2).join('.') : ''));
        if (n.id) break;
      }
      return parts.join('>');
    };
    const out = new Map();
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const text = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
        const parent = node.parentElement;
        if (!text || !re.test(text) || !parent || parent.closest(excluded) || !shown(parent) || originalNameChip(parent, text)) continue;
        const r = parent.getBoundingClientRect();
        if (!includeHidden && (r.width < 1 || r.height < 1)) continue;
        out.set(where(parent) + '|' + text, { where: where(parent), text });
      }
      for (const el of [root, ...root.querySelectorAll('[title], [aria-label], [placeholder]')]) {
        if (el.closest(excluded) || !shown(el)) continue;
        for (const attr of ['title', 'aria-label', 'placeholder']) {
          const value = el.getAttribute(attr) || '';
          if (re.test(value)) out.set(where(el) + '@' + attr + '|' + value, { where: where(el) + '@' + attr, text: value });
        }
      }
    }
    return [...out.values()];
  }, { rootSelector, pattern, includeHidden });
}

// 看板列被截字：任何一格 .dest 在最終畫面上 scrollWidth > clientWidth（被 ellipsis 截掉，或整段擠出框外）。
// 2026-09-19 使用者回報「車站資訊的字有些都被切到了」：英文台鐵板約三成的列「往哪裡」整段看不到、
// 捷運板把線名與車次擠成 0 寬。修法是一列塞不下就整板改兩行（data-wrap2），這裡驗它真的沒有截字。
async function scanClipped(page, rootSelector = '#board') {
  return page.evaluate(sel => {
    const out = [];
    for (const root of document.querySelectorAll(sel)) for (const d of root.querySelectorAll('.row > .dest')) {
      if (!(d.checkVisibility ? d.checkVisibility() : true)) continue;
      if (d.scrollWidth > d.clientWidth + 1) {
        out.push({ where: 'clip:' + (d.closest('[id]') ? '#' + d.closest('[id]').id : '') + ' .dest', text: `${d.textContent.replace(/\s+/g, ' ').trim().slice(0, 80)}（顯示 ${d.clientWidth}px／需要 ${d.scrollWidth}px）` });
      }
    }
    return out;
  }, rootSelector);
}

async function openMore(page) {
  await page.evaluate(() => {
    const mobile = document.body.classList.contains('mobile-shell') || matchMedia('(max-width: 900px)').matches;
    (document.getElementById(mobile ? 'tabMore' : 'toolsFab') || document.getElementById('tabMore')).click();
  });
  await page.waitForFunction(() => document.body.classList.contains('tools-open'));
  await page.waitForTimeout(300);
}
async function closeMore(page) {
  await page.evaluate(() => { if (document.body.classList.contains('tools-open')) document.getElementById('moreClose')?.click(); });
}

async function metroScenarios(page, label) {
  // 每條線抽起點、中段兩站開看板；每條線挑一台車跟隨。
  const plan = await page.evaluate(() => {
    const lines = (state.decoLines && state.decoLines.length ? state.decoLines : state.lines) || [];
    return lines.filter(ln => ln.stations && ln.stations.length > 1).map(ln => ({
      id: ln.id, name: ln.name,
      stations: [0, Math.floor(ln.stations.length / 2)].map(i => ({ name: ln.stations[i].name, lat: ln.stations[i].lat, lon: ln.stations[i].lon })),
    }));
  });
  // 兩輪：「現在」吃得到即時倒數那幾句（官方即時資料…）；半夜跑的話多數線已收班、看板沒有列，
  // 截字與列上文字等於沒驗 ⇒ 再撥到上午 10 點開一輪，每條線都有列。
  for (const when of ['現在', '10:00']) {
    if (when === '10:00') await page.evaluate(() => { closeBoard(); setSimSec(10 * 3600); });
    for (const ln of plan) {
      for (const st of ln.stations) {
        await page.evaluate(({ st, id }) => {
          const lines = (state.decoLines && state.decoLines.length ? state.decoLines : state.lines) || [];
          const line = lines.find(x => x.id === id);
          openBoard({ ...st, sys: 'freq', metroSysId: freqSysIdOf(line) });
        }, { st, id: ln.id });
        await page.waitForTimeout(400);
        note(`${label} 看板（${when}）${ln.id} ${st.name}`, [...await scanCjk(page, '#board'), ...await scanClipped(page)]);
      }
    }
  }
  await page.evaluate(() => closeBoard());
  // 等地圖畫出列車命中框（上面已撥到 10 點，每條線都該有車）
  await page.waitForFunction(() => (state._freqHits || []).length > 0, null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const lineIds = await page.evaluate(() => [...new Set((state._freqHits || []).map(h => h.ln && h.ln.id).filter(Boolean))]);
  const allLines = plan.map(ln => ln.id);
  const missing = allLines.filter(id => !lineIds.includes(id));
  // 覆蓋率是具名斷言，不只印出來：分母無聲縮水（半夜只抽到一兩條線）會讓整段跟車卡檢查形同沒跑。
  console.log(`${missing.length ? '✗' : '✓'} ${APP ? 'app' : 'web'} · ${label} 跟車卡覆蓋率 ${lineIds.length}/${allLines.length}${missing.length ? '（缺：' + missing.join(',') + '）' : ''}`);
  if (missing.length) failures.push(`${label} 跟車卡只抽到 ${lineIds.length}/${allLines.length} 條線（缺：${missing.join(',')}）`);
  for (const id of lineIds) {
    const ok = await page.evaluate(id => {
      const hit = (state._freqHits || []).find(h => h.ln && h.ln.id === id);
      if (!hit) return false;
      setFreqFollow(hit);
      return true;
    }, id);
    if (!ok) continue;
    await page.waitForTimeout(700);
    note(`${label} 跟車卡 ${id}`, await scanCjk(page, '#freqCard, #followBar'));
    await page.evaluate(() => clearFreqFollow());
  }
}

async function traScenarios(page, label) {
  const names = ['臺北', '七堵', '花蓮', '高雄', '新竹', '嘉義'];
  // 同捷運：半夜跑的看板幾乎沒有列（英文自強號把「往哪裡」擠掉就是白天才看得到），再撥到 10 點開一輪。
  for (const when of ['現在', '10:00']) {
    if (when === '10:00') await page.evaluate(() => { closeBoard(); setSimSec(10 * 3600); });
    for (const name of names) {
      const ok = await page.evaluate(name => {
        const st = state.schedStations.find(item => item.sys === 'tra_sched' && item.name.replace(/台/g, '臺') === name);
        if (!st) return false; openBoard(st); return true;
      }, name);
      if (!ok) continue;
      await page.waitForTimeout(500);
      note(`${label} 台鐵看板（${when}）${name}`, [...await scanCjk(page, '#board'), ...await scanClipped(page)]);
    }
    const thsr = await page.evaluate(() => {
      const st = state.schedStations.find(item => item.sys === 'thsr_sched');
      if (!st) return null; openBoard(st); return st.name;
    });
    if (thsr) { await page.waitForTimeout(500); note(`${label} 高鐵看板（${when}）${thsr}`, [...await scanCjk(page, '#board'), ...await scanClipped(page)]); }
  }
  await page.evaluate(() => closeBoard());
  // 跟一班行駛中的台鐵車
  const no = await page.evaluate(() => {
    const tr = state.trains.find(x => x.sys === 'tra_sched' && !x.loop && trainPos(x, state.simSec));
    if (!tr) return null; followTrainNo(tr.train, { sys: tr.sys }); return tr.train;
  });
  if (no) {
    await page.waitForTimeout(1200);
    note(`${label} 台鐵跟車 ${no}`, await scanCjk(page, '#followPanel, #trainCard, #followBar'));
    const share = await page.evaluate(() => {
      const b = document.getElementById('fpTripShare');
      return b ? { text: b.textContent.trim(), hidden: b.hidden } : null;
    });
    if (share) note(`${label} 行程分享鈕文字（不論是否顯示）`, /[㐀-鿿]/.test(share.text) ? [{ where: '#fpTripShare', text: share.text }] : []);
    await page.evaluate(() => { try { clearFollow(); } catch (e) {} });
  }
}

async function panelScenarios(page, label) {
  for (const [name, open, root, close] of [
    ['今日亮點', 'openExplorePanel()', '#explorePanel', 'closeExplorePanel()'],
    ['今日台鐵動態', 'openTodayPanel()', '#todayPanel', 'closeTodayPanel()'],
    ['最愛', 'openFavPanel()', '#favPanel', 'closeFavPanel()'],
  ]) {
    const ok = await page.evaluate(code => { try { (0, eval)(code); return true; } catch (e) { return String(e); } }, open);
    if (ok !== true) { note(`${label} ${name}（開不起來：${ok}）`, []); continue; }
    await page.waitForTimeout(2500);
    note(`${label} ${name}`, await scanCjk(page, root));
    await page.evaluate(code => { try { (0, eval)(code); } catch (e) {} }, close);
  }
}

async function run() {
  const browser = await chromium.launch();
  try {
    // 1) 英文：手機殼（App 使用者的畫面）
    {
      const { context, page, errors } = await boot(browser, { lang: 'en', viewport: { width: 390, height: 844 }, mobile: true });
      note('手機首屏', await scanCjk(page, 'body > *:not(#moreSheet):not(.site-foot)'));
      await openMore(page);
      note('手機「更多」全部列', await scanCjk(page, '#moreSheet'));
      await closeMore(page);
      for (const [tab, root] of [['tabSearch', '#searchPanel'], ['tabRide', '#ridePanel']]) {
        await page.evaluate(id => document.getElementById(id).click(), tab);
        await page.waitForTimeout(1200);
        note(`手機分頁 ${tab}`, [...await scanCjk(page, root), ...await scanClipped(page, root)]);
        await page.evaluate(id => document.getElementById(id).click(), tab); // 再點一次收起
        await page.waitForTimeout(300);
      }
      await panelScenarios(page, '手機');
      await traScenarios(page, '手機');
      if (errors.length) failures.push(`手機英文頁面錯誤：${errors.slice(0, 3).join(' | ')}`);
      await context.close();
    }
    {
      const { context, page, errors } = await boot(browser, { lang: 'en', viewport: { width: 390, height: 844 }, mobile: true, group: 'metro' });
      await metroScenarios(page, '手機捷運');
      if (errors.length) failures.push(`手機捷運英文頁面錯誤：${errors.slice(0, 3).join(' | ')}`);
      await context.close();
    }
    // 2) 英文：桌面頁尾（更新紀錄標題與「最後更新」）
    {
      const { context, page } = await boot(browser, { lang: 'en', viewport: { width: 1280, height: 900 } });
      note('桌面頁尾摘要', await scanCjk(page, '.site-foot summary'));
      await context.close();
    }
    // 3) 切換語言殘留：日文開站 → 英文 → 繁中 → 日文 → 英文
    {
      const { context, page } = await boot(browser, { lang: 'ja', viewport: { width: 390, height: 844 }, mobile: true });
      await openMore(page);
      const kana = KANA;
      await page.evaluate(() => window.__i18n.setLanguage('en')); await page.waitForTimeout(500);
      note('日→英 後「更多」殘留假名', await scanCjk(page, '#moreSheet', { pattern: kana }));
      note('日→英 後「更多」殘留任何漢字', await scanCjk(page, '#moreSheet'));
      await page.evaluate(() => window.__i18n.setLanguage('zh-TW')); await page.waitForTimeout(500);
      note('英→繁中 後「更多」殘留假名', await scanCjk(page, '#moreSheet', { pattern: kana }));
      await page.evaluate(() => window.__i18n.setLanguage('ja')); await page.waitForTimeout(500);
      await page.evaluate(() => window.__i18n.setLanguage('en')); await page.waitForTimeout(500);
      note('繁中→日→英 後「更多」殘留任何漢字', await scanCjk(page, '#moreSheet'));
      await context.close();
    }
    {
      // 英文開站 → 日文：掃英文譯文殘留（反查字典的 en 值）
      const { context, page } = await boot(browser, { lang: 'en', viewport: { width: 390, height: 844 }, mobile: true });
      await openMore(page);
      await page.evaluate(() => window.__i18n.setLanguage('ja')); await page.waitForTimeout(500);
      const stale = await page.evaluate(() => {
        const en = window.RAIL_I18N_MESSAGES.en, ja = window.RAIL_I18N_MESSAGES.ja;
        const values = new Set();
        for (const [k, v] of Object.entries(en)) if (typeof v === 'string' && v.length > 3 && /[a-z]{3}/i.test(v) && ja[k] !== v) values.add(v.trim());
        const out = [];
        const walker = document.createTreeWalker(document.getElementById('moreSheet'), NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const text = (node.nodeValue || '').trim();
          const el = node.parentElement;
          if (!text || !el || el.closest('[data-lang]') || !(el.checkVisibility?.() ?? true)) continue;
          if (values.has(text)) out.push({ where: el.id || el.className || el.tagName, text });
        }
        return out;
      });
      note('英→日 後「更多」殘留英文譯文', stale);
      await context.close();
    }
  } finally {
    await browser.close();
  }
  if (REPORT) fs.writeFileSync(REPORT, JSON.stringify({ app: APP, findings, failures }, null, 1));
  console.log(`\n共 ${findings.length} 處中文殘留或截字${failures.length ? '；另有 ' + failures.length + ' 項錯誤：\n' + failures.join('\n') : ''}`);
  process.exitCode = findings.length || failures.length ? 1 : 0;
}
await run();
