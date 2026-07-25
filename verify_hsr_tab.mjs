// 手機／App 地圖頂列新增「高」（只看高鐵）驗收：台／鐵／高／捷 四顆
// 跑法：node verify_hsr_tab.mjs [base]   預設 base=http://127.0.0.1:5178
//
// 判準來源刻意獨立於實作：
//   ・「只看高鐵」讀 state.trains 每一輛車的 sys 真值 ＋ canvas 命中表（不看群組設定本身）
//   ・「四顆點得到、不打架」用 rect 兩兩相交掃描（含斷點之間的中間寬度）＋ 真觸控 tap 後讀 state
//   ・CLS：DOMContentLoaded 當下的靜態佔位 rect vs boot 重建後 rect（同一頁面前後對照）
import { chromium, webkit } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:5178';
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p, msg }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };

async function openMobile(browser, { width = 390, height = 844 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const h = document.getElementById('howtoWrap'); if (h) h.remove(); });
  return { ctx, page };
}
const topTabs = page => page.evaluate(() => [...document.querySelectorAll('#topTabs .gtab')].map(b => ({
  t: b.textContent, title: b.title, active: b.classList.contains('active'),
  x: Math.round(b.getBoundingClientRect().left), w: Math.round(b.getBoundingClientRect().width),
})));

{
  const browser = await chromium.launch();

  // ── H9 CLS：靜態佔位 vs boot 重建（同一頁面前後量，不同源比對）──
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    const before = await page.evaluate(() => [...document.querySelectorAll('#topTabs .gtab')]
      .map(b => { const r = b.getBoundingClientRect(); return { t: b.textContent, x: Math.round(r.left), w: Math.round(r.width) }; }));
    await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const after = await topTabs(page);
    const same = before.length === after.length &&
      before.every((b, i) => b.t === after[i].t && Math.abs(b.x - after[i].x) <= 1 && Math.abs(b.w - after[i].w) <= 1);
    ok('H9 CLS 靜態佔位與 boot 重建後幾何一致（四顆、同位置）', before.length === 4 && same,
       `靜態 [${before.map(b => b.t + '@' + b.x).join(' ')}] → 重建 [${after.map(b => b.t + '@' + b.x).join(' ')}]`);
    await ctx.close();
  }

  const { ctx, page } = await openMobile(browser);

  // H1 四顆、順序、標題
  const tabs = await topTabs(page);
  ok('H1 頂列四顆依序 台／鐵／高／捷',
     tabs.map(t => t.t).join('') === '台鐵高捷' && tabs[2].title === '高鐵',
     `[${tabs.map(t => `${t.t}(${t.title})`).join(' ')}]`);

  // H3/H4 真觸控點「高」→ 只剩高鐵的車，且畫面真的畫出來
  const before = await page.evaluate(() => ({ group: state.group, n: state.trains.length }));
  await page.tap('#topTabs .gtab:nth-child(3)');
  await page.waitForTimeout(2500);
  const hsr = await page.evaluate(async () => {
    await new Promise(res => { let n = 0; const f = () => (++n >= 5 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const sys = [...new Set(state.trains.map(t => t.sys))];
    const cv = document.getElementById('overlay');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let painted = 0;
    for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) painted++;
    return { group: state.group, n: state.trains.length, sys, hits: (state._trainHits || []).length, painted,
             plateL: document.getElementById('tbPlateL').textContent, plateR: document.getElementById('tbPlateR').textContent,
             active: [...document.querySelectorAll('#topTabs .gtab')].filter(b => b.classList.contains('active')).map(b => b.textContent),
             stations: state.schedStations ? state.schedStations.length : 0 };
  });
  ok('H3 點「高」只載高鐵（每一輛車的 sys 都是 thsr_sched）',
     hsr.group === 'hsr' && hsr.sys.length === 1 && hsr.sys[0] === 'thsr_sched' && hsr.n > 0,
     `group=${hsr.group} 車次 ${before.n}（鐵/台）→ ${hsr.n}，系統=[${hsr.sys.join()}]，車站 ${hsr.stations}`);
  ok('H4 高鐵畫面真的有畫出列車（命中表＋canvas 像素）', hsr.hits > 0 && hsr.painted > 0,
     `畫面上列車 ${hsr.hits} 台，非透明取樣點 ${hsr.painted}`);
  ok('H5 牌面換成高鐵起訖站（單成員走 SYS_META）', hsr.plateL === '南港' && hsr.plateR === '左營',
     `${hsr.plateL} → ${hsr.plateR}`);
  ok('H6 只有「高」高亮', hsr.active.join('') === '高', `亮的是 [${hsr.active.join()}]`);

  // H10 高鐵群組下能跟車（真觸控點畫面上一台高鐵；#overlay 是 pointer-events:none,要用頁面座標點）
  const follow = await page.evaluate(() => {
    const hit = (state._trainHits || [])[0];
    if (!hit) return { err: 'no-train' };
    const cv = document.getElementById('overlay').getBoundingClientRect();
    return { px: cv.left + hit.x, py: cv.top + hit.y, no: hit.tr.train };
  });
  if (!follow.err) {
    await page.touchscreen.tap(follow.px, follow.py);
    await page.waitForTimeout(1500);
    const f = await page.evaluate(() => ({ following: !!state.followTrain, train: state.followTrain ? state.followTrain.train : null,
                                            sys: state.followTrain ? state.followTrain.sys : null }));
    ok('H10 高鐵群組下點列車能跟車', f.following && f.sys === 'thsr_sched', `點 ${follow.no} → 跟到 ${f.train}（${f.sys}）`);
    await page.evaluate(() => { if (state.followTrain) clearFollow(); });
    await page.waitForTimeout(600);
  } else ok('H10 高鐵群組下點列車能跟車', false, '畫面上抓不到高鐵列車');

  // H11 高鐵車站看板有班次
  const board = await page.evaluate(async () => {
    const st = (state.schedStations || []).find(s => s.name === '台中' || s.name === '臺中') || (state.schedStations || [])[0];
    if (!st) return { err: 'no-station' };
    openBoard(st);
    await new Promise(r => setTimeout(r, 800));
    const el = document.getElementById('board');
    const shown = el && !el.hidden && el.getBoundingClientRect().width > 0;
    const txt = el ? el.textContent : '';
    return { name: st.name, shown, rows: (txt.match(/\d{2}:\d{2}/g) || []).length };
  });
  ok('H11 高鐵車站看板有班次', !board.err && board.shown && board.rows > 0,
     `${board.name} 站看板 ${board.rows} 個時刻（面板可見=${board.shown}）`);
  await page.evaluate(() => { const c = document.getElementById('boardClose'); if (c) c.click(); });
  await page.waitForTimeout(400);

  // H7 點回「鐵」→ 台鐵＋高鐵＋林鐵同框語意不變
  await page.tap('#topTabs .gtab:nth-child(2)');
  await page.waitForTimeout(3000);
  const nat = await page.evaluate(() => ({ group: state.group, sys: [...new Set(state.trains.map(t => t.sys))].sort(),
                                            n: state.trains.length }));
  ok('H7 「鐵」仍是台鐵＋高鐵＋林鐵同框（nat 未被動過）',
     nat.group === 'nat' && nat.sys.includes('tra_sched') && nat.sys.includes('thsr_sched'),
     `group=${nat.group} 系統=[${nat.sys.join()}] 共 ${nat.n} 車次`);

  // H13 選「高」之後重開，上次視野記憶要還原到高鐵（不然選了下次又跳掉）
  await page.tap('#topTabs .gtab:nth-child(3)');
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, { timeout: 30000 });
  await page.waitForTimeout(2000);
  const restored = await page.evaluate(() => ({ group: state.group, sys: [...new Set(state.trains.map(t => t.sys))] }));
  ok('H13 重開仍記得停在「高」', restored.group === 'hsr' && restored.sys.join() === 'thsr_sched',
     `group=${restored.group} 系統=[${restored.sys.join()}]`);
  await ctx.close();

  // H2 各手機寬度：四顆與頂列其他控件兩兩不相交（含斷點之間的中間寬度）
  for (const width of [360, 375, 390, 414, 768]) {
    const s = await openMobile(browser, { width, height: 812 });
    const geo = await s.page.evaluate(() => {
      const sel = ['#topTabs .gtab', '.tb-plate', '#randBtn', '#nearBtn', '#fsFab', '#clock', '.badge'];
      const boxes = [];
      sel.forEach(q => document.querySelectorAll(q).forEach((el, i) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) boxes.push({ k: q + (q.includes('gtab') ? ':' + el.textContent : i ? i : ''), el, r: { l: r.left, t: r.top, ri: r.right, b: r.bottom } });
      }));
      const bad = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        // 父子包含不算打架(#clock 住在 .badge 裡),只抓真正的兄弟相交
        if (boxes[i].el.contains(boxes[j].el) || boxes[j].el.contains(boxes[i].el)) continue;
        const a = boxes[i].r, b = boxes[j].r;
        const ov = Math.min(a.ri, b.ri) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5;
        if (ov) bad.push(boxes[i].k + '×' + boxes[j].k);
      }
      const tt = [...document.querySelectorAll('#topTabs .gtab')];
      const last = tt[tt.length - 1].getBoundingClientRect();
      return { bad, n: tt.length, rightEdge: Math.round(last.right), vw: innerWidth,
               hit: tt.every(b => { const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el === b || b.contains(el); }) };
    });
    ok(`H2 ${width}px：四顆與頂列控件零重疊、都在畫面內、都點得到`,
       geo.bad.length === 0 && geo.n === 4 && geo.rightEdge <= geo.vw && geo.hit,
       `重疊=${geo.bad.join('/') || '無'}；最右緣 ${geo.rightEdge}/${geo.vw}；命中=${geo.hit}`);
    await s.ctx.close();
  }

  // H8 桌面零變化：header 仍四籤、不含「高鐵」，且桌面頂列不出現
  {
    const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await dctx.newPage();
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, { timeout: 30000 });
    await page.waitForTimeout(1200);
    const d = await page.evaluate(() => ({
      tabs: [...document.querySelectorAll('#systems .grouptabs .gtab')].map(b => b.textContent),
      topbarShown: !!document.querySelector('.topbar') && document.querySelector('.topbar').getBoundingClientRect().width > 0,
    }));
    ok('H8 桌面 header 仍是四籤、沒有多出「高鐵」', d.tabs.join('｜') === '全台同框｜國家鐵路｜北北桃｜中南部' && !d.topbarShown,
       `[${d.tabs.join('｜')}]，手機頂列在桌面顯示=${d.topbarShown}`);
    await dctx.close();
  }
  await browser.close();
}

// WebKit（iPhone 實際引擎）佐證
{
  const browser = await webkit.launch();
  const { ctx, page } = await openMobile(browser, { width: 390, height: 844 });
  const tabs = await topTabs(page);
  await page.tap('#topTabs .gtab:nth-child(3)');
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({ group: state.group, sys: [...new Set(state.trains.map(t => t.sys))],
                                          n: state.trains.length, hits: (state._trainHits || []).length,
                                          plate: document.getElementById('tbPlateL').textContent + '→' + document.getElementById('tbPlateR').textContent }));
  ok('W1 WebKit：四顆齊、點「高」只剩高鐵且畫得出來',
     tabs.map(t => t.t).join('') === '台鐵高捷' && r.group === 'hsr' && r.sys.join() === 'thsr_sched' && r.hits > 0,
     `[${tabs.map(t => t.t).join('')}] group=${r.group} ${r.n} 車次 畫面 ${r.hits} 台 牌面 ${r.plate}`);
  await ctx.close(); await browser.close();
}

const bad = R.filter(r => !r.p);
console.log(`\n=== ${R.length - bad.length}/${R.length} 通過 ===`);
if (bad.length) { console.log('未過：'); bad.forEach(b => console.log(' ・' + b.n + ' — ' + b.msg)); process.exit(1); }
