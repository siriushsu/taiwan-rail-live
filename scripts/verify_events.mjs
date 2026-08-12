// 活動公告(events)驗證:時間窗 × 錨點解析 × 兩條看板路徑 × 今日亮點 × 空狀態 × endGuess 兩側
// 用法:node scripts/verify_events.mjs            (預設 http://localhost:5187)
//       VURL=http://localhost:<port> node scripts/verify_events.mjs
// 🔴 route 只攔 data/events.json 一條:全攔式 ctx.route('**/*') 會把 CDN 的 Leaflet 一起擋掉,
//    頁面 boot 會拋錯而永遠不 ready(2026-08-10 的教訓)。
import { chromium, webkit } from 'playwright';

const BASE = process.env.VURL || 'http://localhost:5187';
let pass = 0, fail = 0;
const bad = [];
function chk(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; bad.push(name); console.log(`  ❌ ${name}${extra ? '　' + extra : ''}`); }
}

// 今天(台北)與相對日期,測試資料用它組出「已結束/太早/剛好在窗內」三種
const TPE = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
const iso = d => d.toISOString().slice(0, 10);
const shift = n => { const d = new Date(Date.UTC(TPE.getFullYear(), TPE.getMonth(), TPE.getDate())); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

const FIXTURE = {
  updated: shift(0),
  events: [
    { id: 'in-window-metro', source: 'official', title: '窗內捷運活動', start: shift(1), end: shift(3),
      anchor: { kind: 'station', sys: 'mrt', name: '大安森林公園' }, url: 'https://example.invalid/a' },
    { id: 'in-window-tra', source: 'official', title: '窗內台鐵活動', start: shift(0), end: shift(2),
      anchor: { kind: 'station', sys: 'tra_sched', name: '花蓮' }, url: 'https://example.invalid/b' },
    { id: 'ended', source: 'official', title: '已結束活動', start: shift(-9), end: shift(-1),
      anchor: { kind: 'station', sys: 'tra_sched', name: '花蓮' }, url: 'https://example.invalid/c' },
    { id: 'too-early', source: 'official', title: '太早活動', start: shift(15), end: shift(16),
      anchor: { kind: 'station', sys: 'tra_sched', name: '花蓮' }, url: 'https://example.invalid/d' },
    { id: 'edge-13', source: 'official', title: '窗邊活動', start: shift(13), end: shift(14),
      anchor: { kind: 'station', sys: 'tra_sched', name: '花蓮' }, url: 'https://example.invalid/e' },
    { id: 'sys-level', source: 'official', title: '系統級活動', start: shift(0), end: shift(5),
      anchor: { kind: 'system', sys: 'tra_sched' }, url: 'https://example.invalid/f' },
    { id: 'guess-end', source: 'official', title: '推定結束活動', start: shift(-1), end: shift(20), endGuess: true,
      anchor: { kind: 'station', sys: 'tra_sched', name: '台東' }, url: 'https://example.invalid/g' },
    { id: 'partner-one', source: 'partner', title: '合作活動', start: shift(0), end: shift(4),
      anchor: { kind: 'station', sys: 'tra_sched', name: '台東' }, url: 'https://example.invalid/h' },
  ],
};

async function openPage(browser, { events = FIXTURE, w = 1280, h = 800 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'zh-TW' });
  await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  await ctx.route('**/data/events.json*', r =>
    events === null ? r.fulfill({ status: 404, body: 'not found' })
                    : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(events) }));
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message || e)));
  await pg.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => state && state.ready === true, null, { timeout: 45000 });
  pg._errs = errs;
  return { ctx, pg };
}

// 等活動資料真的載完:ensureEvents() 是非同步的,fetch 回來才在 .then 裡把 _events 填好、
// 若面板還開著才補畫一次(見 index.html ensureEvents 定義)。openStationBoard() 呼叫的 openBoard()
// 會同步觸發 ensureEvents() 但不等它,兩者之間有個實測約 30-40ms 的窗口,openStationBoard() 一
// 返回就查 DOM 會不穩定命中這個窗口(fix round 1 的根因)。
// 用裸 _events 不是 window._events —— classic script 的頂層 let/const 不會掛到 window
// (Task 1 對 state 已踩過同一坑,見 openPage() 的寫法)。
// 404 情境已讀 index.html 源碼確認(非假設):fetchJSONAt() 對非 200 一律回傳 null(不會拋例外),
// ensureEvents() 的 .then 拿到 null 仍會把 _events 設成 []而不是留在 null,所以這個等待條件在
// 404 時一樣會成立,不會卡到 timeout。
async function awaitEvents(pg) {
  await pg.waitForFunction(() => typeof _events !== 'undefined' && _events !== null, null, { timeout: 10000 });
}

// 直接開某站的看板(繞過地圖點擊,那是另一件事的測試)。openBoard() 會觸發 ensureEvents(),
// 這裡順便等它載完,呼叫端不必自己補等待。
// 🔴 這裡刻意不在 openExplorePanel() 之後也呼叫 awaitEvents——目前 renderExplorePanel()
// 完全沒有呼叫 ensureEvents()(接上今日亮點是 Task 3 的範圍,尚未實作;grep index.html 確認
// ensureEvents 只有一個呼叫點,在 renderBoard() 內)。若在 openExplorePanel() 後面也等 _events,
// 凡是該 test block 從未呼叫過 openStationBoard() 的情境(Section E/F 正是如此),_events 永遠
// 不會離開 null,會卡滿 10 秒 timeout 甚至讓整支腳本因未捕捉的 rejection 中止、不印總計行。
async function openStationBoard(pg, sysId, name) {
  const ok = await pg.evaluate(([sysId, name]) => {
    const k = name.replace(/臺/g, '台');
    let st = null;
    if (state.mode === 'sched') st = state.schedStations.find(s => s.sys === sysId && s.name.replace(/臺/g, '台') === k) || null;
    if (!st) {
      const lines = state.mode === 'sched' ? (state.decoLines || []) : (state.lines || []);
      for (const ln of lines) {
        const s = (ln.stations || []).find(x => x.name.replace(/臺/g, '台') === k);
        if (s) { st = { name: s.name, lat: s.lat, lon: s.lon, sys: state.mode === 'sched' ? 'deco' : 'freq' }; break; }
      }
    }
    if (!st) return false;
    openBoard(st);
    return true;
  }, [sysId, name]);
  if (ok) await awaitEvents(pg);
  return ok;
}

async function run(browser, engine) {
  console.log(`\n── ${engine} ──`);

  // A. 台鐵站(renderBoard sched 路徑)
  {
    const { ctx, pg } = await openPage(browser);
    const ok = await openStationBoard(pg, 'tra_sched', '花蓮');
    chk(`${engine} A0 花蓮站看板開得起來`, ok);
    const rows = await pg.$$eval('#board .ev-row b', ns => ns.map(n => n.textContent.trim()));
    chk(`${engine} A1 窗內台鐵活動出現`, rows.includes('窗內台鐵活動'), JSON.stringify(rows));
    chk(`${engine} A2 已結束活動不出現`, !rows.includes('已結束活動'), JSON.stringify(rows));
    chk(`${engine} A3 太早(15天)活動不出現`, !rows.includes('太早活動'), JSON.stringify(rows));
    chk(`${engine} A4 窗邊(13天)活動出現`, rows.includes('窗邊活動'), JSON.stringify(rows));
    chk(`${engine} A5 系統級活動不進車站看板`, !rows.includes('系統級活動'), JSON.stringify(rows));
    await ctx.close();
  }

  // B. 捷運站(renderFreqBoard 路徑) —— 必須切到捷運分頁
  {
    const { ctx, pg } = await openPage(browser);
    await pg.evaluate(() => selectGroup(GROUPS.find(g => g.id === 'metro')));
    await pg.waitForFunction(() => state.mode === 'freq' && state.lines.length > 0, null, { timeout: 30000 });
    const ok = await openStationBoard(pg, 'mrt', '大安森林公園');
    chk(`${engine} B0 大安森林公園站看板開得起來`, ok);
    const rows = await pg.$$eval('#board .ev-row b', ns => ns.map(n => n.textContent.trim()));
    chk(`${engine} B1 捷運活動出現在 freq 看板`, rows.includes('窗內捷運活動'), JSON.stringify(rows));
    chk(`${engine} B2 台鐵活動不出現在捷運站`, !rows.includes('窗內台鐵活動'), JSON.stringify(rows));
    await ctx.close();
  }

  // C. 反向對照:沒有活動的站不得有活動列(含不得有空容器)
  {
    const { ctx, pg } = await openPage(browser);
    const ok = await openStationBoard(pg, 'tra_sched', '瑞芳');
    chk(`${engine} C0 瑞芳站看板開得起來`, ok);
    const n = await pg.$$eval('#board .ev-row, #board .ev-rows', ns => ns.length);
    chk(`${engine} C1 無活動的站零活動節點`, n === 0, `找到 ${n} 個`);
    await ctx.close();
  }

  // D. endGuess 兩側 + partner 標記
  {
    const { ctx, pg } = await openPage(browser);
    await openStationBoard(pg, 'tra_sched', '台東');
    const txt = await pg.$$eval('#board .ev-row', ns => ns.map(n => n.textContent.trim()));
    const guessRow = txt.find(t => t.includes('推定結束活動')) || '';
    const partnerRow = txt.find(t => t.includes('合作活動')) || '';
    chk(`${engine} D1 endGuess 顯示「進行中」`, guessRow.includes('進行中'), guessRow);
    chk(`${engine} D2 endGuess 不顯示精確結束日`, !/\d+\/\d+–\d+\/\d+/.test(guessRow), guessRow);
    chk(`${engine} D3 非 endGuess 顯示日期區間`, /\d+\/\d+/.test(partnerRow), partnerRow);
    chk(`${engine} D4 partner 有可見差別`, partnerRow.includes('合作'), partnerRow);
    await ctx.close();
  }

  // E. 今日亮點:活動節、排序位置、系統級也在
  {
    const { ctx, pg } = await openPage(browser);
    await pg.evaluate(() => openExplorePanel());
    await awaitEvents(pg);
    const secs = await pg.$$eval('#expBody .sec', ns => ns.map(n => n.textContent.trim()));
    chk(`${engine} E1 今日亮點有「近期活動」節`, secs.includes('近期活動'), JSON.stringify(secs));
    const titles = await pg.$$eval('#expBody .row[data-ev] b', ns => ns.map(n => n.textContent.trim()));
    chk(`${engine} E2 系統級活動出現在清單`, titles.includes('系統級活動'), JSON.stringify(titles));
    chk(`${engine} E3 已結束活動不在清單`, !titles.includes('已結束活動'), JSON.stringify(titles));
    // 排序:活動節必須在「今日之最」之前
    const iEv = secs.indexOf('近期活動'), iBest = secs.indexOf('今日之最');
    chk(`${engine} E4 活動節排在今日之最之前`, iEv >= 0 && (iBest < 0 || iEv < iBest), `ev=${iEv} best=${iBest}`);
    await ctx.close();
  }

  // F. 今日亮點點一列 → 真的開了那站的看板(不是只驗命中)
  {
    const { ctx, pg } = await openPage(browser);
    await pg.evaluate(() => openExplorePanel());
    await awaitEvents(pg);
    const sel = '#expBody .row[data-ev="in-window-tra"]';
    const exists = await pg.$(sel);
    chk(`${engine} F0 找得到台鐵活動那一列`, !!exists);
    if (exists) {
      await pg.click(sel);
      await pg.waitForTimeout(600);
      const opened = await pg.evaluate(() => state.boardStation ? state.boardStation.name : null);
      chk(`${engine} F1 點一列後開啟花蓮站看板`, opened === '花蓮', String(opened));
    }
    await ctx.close();
  }

  // G. 空狀態:events 為空陣列
  {
    const { ctx, pg } = await openPage(browser, { events: { updated: shift(0), events: [] } });
    await pg.evaluate(() => openExplorePanel());
    await awaitEvents(pg);
    const secs = await pg.$$eval('#expBody .sec', ns => ns.map(n => n.textContent.trim()));
    chk(`${engine} G1 空陣列不產生活動節`, !secs.includes('近期活動'), JSON.stringify(secs));
    await openStationBoard(pg, 'tra_sched', '花蓮');
    const n = await pg.$$eval('#board .ev-row, #board .ev-rows', ns => ns.length);
    chk(`${engine} G2 空陣列時看板零活動節點`, n === 0, `找到 ${n} 個`);
    await ctx.close();
  }

  // H. 資料檔 404 不得壞頁
  {
    const { ctx, pg } = await openPage(browser, { events: null });
    await pg.evaluate(() => openExplorePanel());
    await awaitEvents(pg); // 404 也會 resolve(見 awaitEvents 上方註解),不會卡 timeout
    // 查 #expBody 必須搶在 openStationBoard 之前:openBoard() 內部會呼叫 closeExplorePanel(),
    // 後者會清空 #expBody(el.innerHTML=''),晚查一步 secs 恆為 0,H1 不管實作對錯都測不出東西。
    const secs = await pg.$$eval('#expBody .sec', ns => ns.length);
    chk(`${engine} H1 404 時今日亮點照常有內容`, secs > 0, `節數 ${secs}`);
    await openStationBoard(pg, 'tra_sched', '花蓮');
    chk(`${engine} H2 404 時無未捕捉錯誤`, pg._errs.length === 0, pg._errs.join(' | '));
    await ctx.close();
  }

  // I. 時區:裝置時鐘設在不同日期,結果不變
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW', timezoneId: 'Pacific/Kiritimati' });
    await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
    await ctx.route('**/data/events.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE) }));
    const pg = await ctx.newPage();
    await pg.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => state && state.ready === true, null, { timeout: 45000 });
    await openStationBoard(pg, 'tra_sched', '花蓮');
    const rows = await pg.$$eval('#board .ev-row b', ns => ns.map(n => n.textContent.trim()));
    chk(`${engine} I1 裝置時區不影響時間窗`, rows.includes('窗內台鐵活動') && !rows.includes('已結束活動'), JSON.stringify(rows));
    await ctx.close();
  }

  // J. 手機寬度:活動列不與既有控件相交,且真的點得到
  {
    const { ctx, pg } = await openPage(browser, { w: 375, h: 812 });
    await openStationBoard(pg, 'tra_sched', '花蓮');
    const geo = await pg.evaluate(() => {
      const row = document.querySelector('#board .ev-row');
      if (!row) return null;
      const r = row.getBoundingClientRect();
      const others = [...document.querySelectorAll('#board h3, #board .sub')].map(n => n.getBoundingClientRect());
      const hit = others.some(o => !(r.right <= o.left || r.left >= o.right || r.bottom <= o.top || r.top >= o.bottom));
      const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { overlap: hit, inRow: !!(mid && mid.closest('.ev-row')), w: r.width };
    });
    chk(`${engine} J1 手機有活動列`, !!geo, 'null');
    if (geo) {
      chk(`${engine} J2 不與標題/說明相交`, !geo.overlap);
      chk(`${engine} J3 列中心命中活動列本身`, geo.inRow);
    }
    await ctx.close();
  }
}

const cr = await chromium.launch();
await run(cr, 'chromium');
await cr.close();
const wk = await webkit.launch();
await run(wk, 'webkit');
await wk.close();

console.log(`\n總計：${pass} 過 / ${fail} 失敗`);
if (fail) { console.log('失敗項：' + bad.join('、')); process.exit(1); }
