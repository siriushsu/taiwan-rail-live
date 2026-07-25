// 桌面「☰ 更多」抽屜（偏好類 6 顆設定收納）驗收
// 跑法：node verify_tools_drawer.mjs [base]   預設 base=http://127.0.0.1:5178
//
// 判準來源刻意獨立於實作：
//   ・「收起來還能用」逐一點抽屜列，讀 state 真值的前後變化（不呼叫代理邏輯本身）
//   ・「面板看得到、點得到」用 rect 在視窗內 ＋ elementFromPoint 命中（computed style 不算數，見心得 24）
//   ・帶寬度用子元素座標算真實內容寬（scrollWidth 在內容<容器時會被夾成容器寬）
//   ・手機零回歸的基準取「改動前 HEAD 版本」另存頁面實測（不拿改後狀態自比，見心得 23）
import { chromium, webkit } from 'playwright';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:5178';
const BASELINE = '_baseline_tmp.html';
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p, msg }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const info = (n, msg) => console.log(`  ·    ${n} — ${msg}`);

async function open(browser, { width = 1440, height = 900, path = '/index.html', dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  await page.goto(BASE + path, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, { timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { const h = document.getElementById('howtoWrap'); if (h) h.remove(); });
  return { ctx, page };
}
const bandWidth = page => page.evaluate(() => {
  const c = document.querySelector('.controls');
  const padR = parseFloat(getComputedStyle(c).paddingRight);
  return Math.ceil(Math.max(...[...c.children].filter(x => x.getBoundingClientRect().width > 0)
    .map(x => x.offsetLeft + x.offsetWidth)) + padR);
});
const openDrawer = async page => {
  const isOpen = await page.evaluate(() => document.body.classList.contains('tools-open'));
  if (!isOpen) await page.click('#toolsFab');
  await page.waitForTimeout(250);
};

{
  const browser = await chromium.launch();
  const { ctx, page } = await open(browser, { width: 1440 });

  // T1 帶上只剩內容型入口＋☰
  const tools = await page.evaluate(() => [...document.querySelectorAll('.stage-tools button')]
    .filter(x => x.getBoundingClientRect().width > 0)
    .map(x => (x.querySelector('.tl') || {}).textContent || x.id));
  const w = await bandWidth(page);
  ok('T1 帶上工具鈕收到 8 顆、內容寬進得了 1152 視窗（≤1092）', tools.length === 8 && w <= 1092,
     `${tools.length} 顆 [${tools.join(' ')}]，內容 ${w}px`);
  ok('T1b 六顆偏好鈕已從帶上收起', !/站介紹|方向|平交道|省電|外觀|軌道/.test(tools.join(' ')), tools.join(' '));

  // T2 抽屜錨在 ☰ 鈕正上方、整個在視窗內
  await openDrawer(page);
  const pos = await page.evaluate(() => {
    const s = document.getElementById('moreSheet').getBoundingClientRect();
    const f = document.getElementById('toolsFab').getBoundingClientRect();
    return { sl: Math.round(s.left), sr: Math.round(s.right), st: Math.round(s.top), sb: Math.round(s.bottom),
             fl: Math.round(f.left), ft: Math.round(f.top), vw: innerWidth, vh: innerHeight,
             w: Math.round(s.width), expanded: document.getElementById('toolsFab').getAttribute('aria-expanded') };
  });
  ok('T2 抽屜完整落在視窗內（沒被裁）',
     pos.sl >= 0 && pos.sr <= pos.vw && pos.st >= 0 && pos.sb <= pos.vh,
     `面板 x${pos.sl}–${pos.sr} y${pos.st}–${pos.sb} / 視窗 ${pos.vw}×${pos.vh}`);
  ok('T2b 貼在 ☰ 鈕正上方（左緣對齊、底緣在鈕上方 8px）',
     Math.abs(pos.sl - pos.fl) <= 1 && Math.abs(pos.sb - (pos.ft - 8)) <= 2 && pos.w === 340,
     `面板左 ${pos.sl} vs 鈕左 ${pos.fl}；面板底 ${pos.sb} vs 鈕頂 ${pos.ft}；寬 ${pos.w}`);
  ok('T2c aria-expanded 同步', pos.expanded === 'true', `aria-expanded=${pos.expanded}`);

  // T3 像素級可及性：每一列都點得到。
  // 判準要照心得 19——rect 落在捲動區外只代表「首屏看不到」，不代表不可及；
  // 先在 .ms-body 內把列捲進視野再做 elementFromPoint，另外單獨回報「要不要捲」。
  const reach = await page.evaluate(async () => {
    const body = document.getElementById('moreBody');
    const rows = [...document.querySelectorAll('#moreBody .ms-row')].filter(r => r.getBoundingClientRect().width > 0);
    const bad = [], offscreen = [];
    for (const r of rows) {
      const bb = body.getBoundingClientRect(), r0 = r.getBoundingClientRect();
      if (r0.top < bb.top - 1 || r0.bottom > bb.bottom + 1) offscreen.push((r.textContent || '').trim().slice(0, 6));
      r.scrollIntoView({ block: 'center' });
      await new Promise(res => requestAnimationFrame(res));
      const b = r.getBoundingClientRect();
      const el = document.elementFromPoint(b.left + 12, b.top + b.height / 2);
      if (!el || (!r.contains(el) && el !== r)) bad.push((r.textContent || '').trim().slice(0, 8));
    }
    body.scrollTop = 0;
    return { total: rows.length, bad, offscreen, scrollable: body.scrollHeight > body.clientHeight + 1,
             need: Math.max(0, body.scrollHeight - body.clientHeight) };
  });
  ok('T3 抽屜每一列都點得到（捲進視野後 elementFromPoint 命中）', reach.bad.length === 0,
     `${reach.total} 列，未命中：${reach.bad.join('/') || '無'}`);
  ok('T3b 一般桌面（900 高）整份設定不必捲就看完', !reach.scrollable,
     reach.scrollable ? `還差 ${reach.need}px，首屏外：${reach.offscreen.join('/')}` : '12 列全在首屏');

  // T7 桌面不出現會搬走桌面本體的列，且開抽屜後頁面上的走勢圖還在原位
  const rowsShown = await page.evaluate(() => {
    const shown = sel => { const e = document.querySelector(sel); return !!(e && e.getBoundingClientRect().width > 0); };
    return { flow: shown('.ms-row[data-act="flow"]'), cities: shown('.ms-row[data-act="cities"]'),
             about: shown('#msAboutSec'),
             flowHome: document.getElementById('flowWrap') ? document.getElementById('flowWrap').parentNode.id : null,
             footBoxes: document.querySelectorAll('.site-foot .foot-box').length };
  });
  ok('T7 桌面抽屜不含走勢/縣市/關於段（桌面本體已有）',
     !rowsShown.flow && !rowsShown.cities && !rowsShown.about,
     `flow=${rowsShown.flow} cities=${rowsShown.cities} about=${rowsShown.about}`);
  ok('T7b 開抽屜沒有把頁面上的走勢圖與頁尾盒搬走',
     rowsShown.flowHome !== 'msFlowSlot' && rowsShown.footBoxes === 4,
     `走勢圖 parent=#${rowsShown.flowHome}，頁尾盒 ${rowsShown.footBoxes} 個`);

  // T4 收起來的六個功能，透過抽屜列真的還能用（讀 state 真值）
  const TOGGLES = [
    ['特殊站介紹', 'introBtn', () => state.stnIntro],
    ['列車方向箭頭', 'dirBtn', () => state.dirArrow],
    ['平交道記號', 'xingBtn', () => state.xingOn],
    ['省電模式', 'powerBtn', () => state.powerSave],
  ];
  for (const [label, id] of TOGGLES) {
    await openDrawer(page);
    const r = await page.evaluate(async pid => {
      const read = { introBtn: () => !!state.stnIntro, dirBtn: () => !!state.dirArrow,
                     xingBtn: () => !!state.xingOn, powerBtn: () => !!state.powerSave }[pid];
      const row = document.querySelector(`.ms-row[data-proxy="${pid}"]`);
      if (!row) return { err: 'no-row' };
      const before = read();
      row.click();
      await new Promise(res => setTimeout(res, 250));
      const after = read();
      const tg = row.querySelector('.toggle');
      return { before, after, tgOn: tg ? tg.classList.contains('on') : null };
    }, id);
    ok(`T4 抽屜切換「${label}」生效`, !r.err && r.before !== r.after && r.tgOn === r.after,
       `state ${r.before} → ${r.after}，列上開關顯示 ${r.tgOn}`);
  }
  // 外觀（seg 三顆，不是 proxy）
  await openDrawer(page);
  const th = await page.evaluate(async () => {
    const seg = document.querySelectorAll('#msThemeSeg button');
    const before = document.documentElement.getAttribute('data-theme');
    [...seg].find(b => b.dataset.v === 'dark').click();
    await new Promise(r => setTimeout(r, 200));
    const mid = document.documentElement.getAttribute('data-theme');
    [...seg].find(b => b.dataset.v === 'light').click();
    await new Promise(r => setTimeout(r, 200));
    return { before, mid, after: document.documentElement.getAttribute('data-theme'), pref: state.appearance,
             segOn: [...seg].filter(b => b.classList.contains('on')).map(b => b.dataset.v) };
  });
  ok('T4e 抽屜切換「外觀」生效（暗→亮）', th.mid === 'dark' && th.after === 'light' && th.segOn.join() === 'light',
     `${th.before} → ${th.mid} → ${th.after}，seg on=${th.segOn.join()}`);
  // 軌道與路線（開面板，並關抽屜）
  await openDrawer(page);
  const tr = await page.evaluate(async () => {
    document.querySelector('.ms-row[data-act="track"]').click();
    await new Promise(r => setTimeout(r, 300));
    const p = document.getElementById('trackPanel');
    const b = p.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + 30);
    return { open: !p.hidden, drawerClosed: !document.body.classList.contains('tools-open'),
             reachable: !!(hit && p.contains(hit)), chips: p.querySelectorAll('.chip').length };
  });
  ok('T4f 抽屜「軌道與路線」開面板、抽屜自動收、面板點得到',
     tr.open && tr.drawerClosed && tr.reachable && tr.chips > 0,
     `面板開=${tr.open} 抽屜收=${tr.drawerClosed} 可點=${tr.reachable} 篩選票根=${tr.chips}`);
  await page.evaluate(() => { const c = document.getElementById('trackClose'); if (c) c.click(); });

  // T6 關閉路徑：Esc、點面板外面、再點 ☰
  await openDrawer(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const escClosed = await page.evaluate(() => !document.body.classList.contains('tools-open'));
  await openDrawer(page);
  await page.mouse.click(300, 300); // 點地圖
  await page.waitForTimeout(200);
  const outClosed = await page.evaluate(() => !document.body.classList.contains('tools-open'));
  await openDrawer(page);
  await page.click('#toolsFab');
  await page.waitForTimeout(200);
  const fabClosed = await page.evaluate(() => !document.body.classList.contains('tools-open'));
  ok('T6 Esc／點外面／再點 ☰ 都能關', escClosed && outClosed && fabClosed,
     `Esc=${escClosed} 點外面=${outClosed} 再點鈕=${fabClosed}`);

  await ctx.close();

  // T8 深色主題：面板不透明、有邊框、列可讀
  const dk = await open(browser, { width: 1440, dark: true });
  await openDrawer(dk.page);
  const dark = await dk.page.evaluate(() => {
    const s = document.getElementById('moreSheet'), cs = getComputedStyle(s);
    const row = document.querySelector('#moreBody .ms-row');
    const b = s.getBoundingClientRect();
    return { bg: cs.backgroundColor, border: cs.borderTopWidth, theme: document.documentElement.getAttribute('data-theme'),
             rowColor: getComputedStyle(row).color, inView: b.top >= 0 && b.bottom <= innerHeight };
  });
  ok('T8 深色主題面板不透明、有邊框、在視窗內',
     !/rgba\(0, 0, 0, 0\)|transparent/.test(dark.bg) && parseFloat(dark.border) > 0 && dark.inView,
     `theme=${dark.theme} 底色=${dark.bg} 邊框=${dark.border} 列字色=${dark.rowColor}`);
  await dk.ctx.close();

  // T9 各桌面寬度：帶溢出量 ＋ 抽屜是否仍完整在視窗內
  for (const width of [1024, 1152, 1280, 1366]) {
    const s = await open(browser, { width });
    const bw = await bandWidth(s.page);
    await openDrawer(s.page);
    const p = await s.page.evaluate(() => {
      const c = document.querySelector('.controls');
      const b = document.getElementById('moreSheet').getBoundingClientRect();
      return { over: Math.max(0, c.scrollWidth - c.clientWidth), client: c.clientWidth,
               inView: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight,
               box: `x${Math.round(b.left)}–${Math.round(b.right)} y${Math.round(b.top)}–${Math.round(b.bottom)}` };
    });
    ok(`T9 ${width}px：抽屜完整在視窗內`, p.inView, `${p.box}；帶內容 ${bw}px/可視 ${p.client}px 溢出 ${p.over}px`);
    await s.ctx.close();
  }

  // T10 手機零回歸：基準釘在改動前的 commit（不可用 HEAD——HEAD 一前進就變成自己比自己）
  // 基準頁只能由本機 server 供應,所以對正式站跑時這兩項跳過（不帶參數跑＝本機驗）
  const BASE_REF = '20cd7ec'; // 桌面抽屜上線前一顆(時刻尺)
  if (!/127\.0\.0\.1|localhost/.test(BASE)) info('T10/T10b 手機零回歸對照', `略過：基準頁需本機 server（現在的 base 是 ${BASE}）`);
  else {
  writeFileSync(BASELINE, execSync(`git show ${BASE_REF}:index.html`, { maxBuffer: 64 * 1024 * 1024 }));
  try {
    for (const width of [375, 768]) {
      const nw = await open(browser, { width, height: 812 });
      const bl = await open(browser, { width, height: 812, path: '/' + BASELINE });
      const probe = p => p.evaluate(() => {
        const c = document.querySelector('.controls').getBoundingClientRect();
        const fab = document.getElementById('toolsFab');
        const tb = document.querySelector('.tabbar');
        return { cw: Math.round(c.width), ch: Math.round(c.height), cy: Math.round(c.top),
                 fabShown: !!(fab && fab.getBoundingClientRect().width > 0),
                 tabbar: !!(tb && tb.getBoundingClientRect().width > 0),
                 tools: [...document.querySelectorAll('.stage-tools button')].filter(x => x.getBoundingClientRect().width > 0).length };
      });
      const a = await probe(nw.page), b = await probe(bl.page);
      ok(`T10 手機 ${width}：控制帶與工具鈕數與改動前一致、☰ 仍隱藏`,
         Math.abs(a.cw - b.cw) <= 1 && Math.abs(a.ch - b.ch) <= 1 && Math.abs(a.cy - b.cy) <= 1
         && a.fabShown === false && a.tabbar === b.tabbar && a.tools === b.tools,
         `新 ${a.cw}×${a.ch}@y${a.cy} 鈕${a.tools}顆 ☰=${a.fabShown} tabbar=${a.tabbar} vs 舊 ${b.cw}×${b.ch}@y${b.cy} 鈕${b.tools}顆`);
      // 手機抽屜仍是全寬底部抽屜（沒被桌面 inline 定位污染）
      await nw.page.evaluate(() => document.getElementById('tabMore').click());
      await nw.page.waitForTimeout(250);
      const ms = await nw.page.evaluate(() => {
        const b = document.getElementById('moreSheet').getBoundingClientRect();
        return { left: Math.round(b.left), right: Math.round(b.right), bottom: Math.round(b.bottom), vw: innerWidth, vh: innerHeight,
                 flow: !!document.querySelector('.ms-row[data-act="flow"]').getBoundingClientRect().width };
      });
      ok(`T10b 手機 ${width}：抽屜仍是全寬底部抽屜、走勢列還在`,
         ms.left === 0 && ms.right === ms.vw && Math.abs(ms.bottom - ms.vh) <= 1 && ms.flow,
         `x${ms.left}–${ms.right}/${ms.vw} 底 ${ms.bottom}/${ms.vh} 走勢列=${ms.flow}`);
      await nw.ctx.close(); await bl.ctx.close();
    }
  } finally { try { unlinkSync(BASELINE); } catch (e) {} }
  }

  await browser.close();
}

// WebKit 佐證（macOS 使用者的引擎）
{
  const browser = await webkit.launch();
  const { ctx, page } = await open(browser, { width: 1440 });
  const w = await bandWidth(page);
  await openDrawer(page);
  const r = await page.evaluate(async () => {
    const s = document.getElementById('moreSheet').getBoundingClientRect();
    const f = document.getElementById('toolsFab').getBoundingClientRect();
    const row = document.querySelector('.ms-row[data-proxy="xingBtn"]');
    const b = row.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + 12, b.top + b.height / 2);
    const before = !!state.xingOn;
    row.click();
    await new Promise(res => setTimeout(res, 250));
    return { inView: s.left >= 0 && s.right <= innerWidth && s.top >= 0 && s.bottom <= innerHeight,
             anchored: Math.abs(s.left - f.left) <= 1 && Math.abs(s.bottom - (f.top - 8)) <= 2,
             reachable: !!(hit && row.contains(hit)), before, after: !!state.xingOn };
  });
  ok('W1 WebKit：帶寬度、抽屜位置與可及性', w <= 1092 && r.inView && r.anchored && r.reachable,
     `內容 ${w}px 視窗內=${r.inView} 貼齊鈕=${r.anchored} 可點=${r.reachable}`);
  ok('W2 WebKit：抽屜切換平交道生效', r.before !== r.after, `${r.before} → ${r.after}`);
  await ctx.close(); await browser.close();
}

const bad = R.filter(r => !r.p);
console.log(`\n=== ${R.length - bad.length}/${R.length} 通過 ===`);
if (bad.length) { console.log('未過：'); bad.forEach(b => console.log(' ・' + b.n + ' — ' + b.msg)); process.exit(1); }
