#!/usr/bin/env node
// v0901 兩件版面改動的守門人（Claude Design 回包的另外兩項）：
//   A. 捷運跟車卡新增「車廂擁擠度」欄（.fc-crowd）
//   B. 桌面車站看板 .board 由 280px 加寬到 360px
//
// 為什麼要另立一支：既有 148 條轉乘斷言全部繞不到這兩塊——它們驗的是接續資料與釘選互動。
//
// 🔴 A 的核心風險不是「畫不畫得出來」，是【join 鍵拿錯】：freqFollow.vehicleId 是由各站官方
//    倒數合成的內部 id，而 crowdByNo 是用【官方車號 officialNo】當鍵。拿錯的話 freqCrowdCars()
//    恆回 null ⇒ 整個功能靜默留白、畫面上看起來只是「這班沒資料」，沒有任何錯誤訊息。
//    所以 A3/A4 一定要驗「顯示的值真的是【這一台】的值」，不是「有東西畫出來」。
//    第二個風險是 2026-08-29 修掉的那個缺陷復發：拿同終點的另一台頂替（文湖線 4 節長出 6 格）。
//    A4 用兩台不同車、不同陣列來釘死這件事。
//
// 🔴 本機沒有北捷官方即時資料（/api/* 一律回 {}），所以 roster 與 crowdByNo 用【注入的 fixture】
//    當 oracle。這是刻意的：fixture 與被測的 join 邏輯不同源，「顯示值 === fixture 值」才有資訊；
//    若拿產品自己算出來的東西當期望值，相等是零資訊（判準盲點第 1 條）。
//
// 慣例同 verify_transfer_follow_pin.mjs：自帶 node:http 靜態伺服器、不用全攔式 route、語系釘死、
// 關首訪教學卡、pageerror 掛勾、T0 目標自檢、chromium + webkit 雙引擎（版面改動的 repo 慣例）。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5527);
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/thsr-schedule') return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
    return res.end('{}');
  }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, r));

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// ── T0 目標自檢（先證明「我在驗誰」）────────────────────────────────────────────
const idxSrc = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const md5 = createHash('md5').update(idxSrc).digest('hex').slice(0, 12);
const localBuild = (idxSrc.match(/const BUILD = '([^']*)'/) || [])[1] || '?';
console.log(`\n目標: ${path.join(ROOT, 'index.html')}\n      md5=${md5}  BUILD=${localBuild}\n`);

const INIT = () => {
  localStorage.setItem('trainmap-howto-seen', '1');
  localStorage.setItem('trainmap-language', 'zh-TW');
  localStorage.setItem('trainmap-powersave', '0');
};

// 注入 fixture 並直接呼叫 updateFreqCard，同步量完。
// 直接呼叫而不是走 rAF 迴圈：迴圈裡的 updateFreqFollowCamera 解不出位置就會 clearFreqFollow()，
// 而本檔要驗的是「算繪與 join」，不是相機。每幀重畫那條（A8）另外用節點同一性直接驗，
// 不用計時取樣——計時判準會被機器負載影響，節點同一性是確定性的。
const CROWD_FIXTURE = {
  A: { no: '077', cars: [1, 2, 2, 3, 2, 1] },
  B: { no: '099', cars: [4, 4, 3, 4, 4, 4] },
};

async function runEngine(engineName, engine) {
  const P = s => `${engineName} ${s}`;
  let browser;
  try { browser = await engine.launch(); }
  catch (e) { ok(P('T1 瀏覽器起得來'), false, String(e && e.message).slice(0, 200)); return; }

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'zh-TW' });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE-ERR: ' + m.text()); });
  // 🔴 ?g=metro：捷運路線物件只有在捷運群組才會進 state.lines（?g=nat 是 0 條，
  //    第一版就是這樣讓 boot 判準永遠不成立、整支逾時）。
  await page.goto(`http://localhost:${PORT}/?lang=zh-TW&g=metro`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => {
      try { return typeof state !== 'undefined' && state.ready && (state.lines || []).length > 0; }
      catch (e) { return false; }
    }, null, { timeout: 40000 });
  } catch (e) {
    ok(P('T1 boot 就緒'), false, errors.slice(0, 3).join(' | ') || String(e.message).slice(0, 120));
    await ctx.close(); await browser.close(); return;
  }
  const servedBuild = await page.evaluate(() => typeof BUILD !== 'undefined' ? BUILD : '?');
  ok(P('T0 服務端 BUILD 與本機檔案一致（沒有驗到快取或別的版本）'), servedBuild === localBuild,
    `served=${servedBuild} local=${localBuild}`);

  // ══ A. 車廂擁擠度欄 ══════════════════════════════════════════════════════════
  const crowd = await page.evaluate(fx => {
    const out = {};
    const boardLn = (state.lines || []).find(l => isTrtcBoardLine(l));
    const otherLn = (state.lines || []).find(l => !isTrtcBoardLine(l));
    out.boardLnId = boardLn ? boardLn.id : null;
    out.otherLnId = otherLn ? otherLn.id : null;
    if (!boardLn) return out;

    const now = Date.now() / 1000;
    const veh = (id, officialNo) => ({ vehicleId: id, line: boardLn.id, officialNo, dir: 0, dest: '', extension: false });
    state.trtcOfficialRoster = {
      at: now, feedMode: 'official', sourceRevision: 1, receivedEpoch: now, held: false, holdReason: null,
      vehicles: [veh('CD:A', fx.A.no), veh('CD:B', fx.B.no), veh('CD:NONO', '')],
    };
    state.trtcOfficialBoard = {
      rows: [], sourceAt: now, receivedAt: Date.now(),
      crowdByNo: { [fx.A.no]: fx.A.cars.slice(), [fx.B.no]: fx.B.cars.slice() },
    };
    const info = { ln: boardLn, loop: false, termName: '', nextName: '', nextSec: null };
    const el = () => document.getElementById('fcCrowd');
    const read = () => {
      const e = el();
      const bars = [...e.querySelectorAll('.cars i')];
      return {
        hidden: e.hidden, state: e.dataset.state,
        bars: bars.length,
        colors: bars.map(b => b.style.background || ''),
        txt: (e.querySelector('.txt') || {}).textContent || '',
        hasAge: !!e.querySelector('.age'),
      };
    };
    const follow = id => { state.freqFollow = { official: true, lineId: boardLn.id, vehicleId: id }; updateFreqCard(info); };

    out.realNow = trtcOfficialBoardRealNow();
    out.rosterLive = trtcOfficialRosterLive(now);

    follow('CD:A'); out.a = read(); out.aCars = freqCrowdCars();
    // 同一份 state 再算一次：有守門判斷的話，.cars 節點必須是【同一顆】
    const beforeNode = el().querySelector('.cars');
    updateFreqCard(info);
    out.nodeStable = beforeNode === el().querySelector('.cars');
    // 正向對照：換一台車之後，節點必須被換掉（證明 nodeStable 不是「整段乾脆不重畫」）
    follow('CD:B'); out.b = read(); out.bCars = freqCrowdCars();
    out.nodeReplaced = beforeNode !== el().querySelector('.cars');

    follow('CD:NONO'); out.noNo = read();          // 有車但沒有官方車號（＝文湖線/環狀線）
    state.freqFollow = { official: true, lineId: boardLn.id, vehicleId: 'CD:GHOST' };
    updateFreqCard(info); out.ghost = read();      // roster 裡根本沒這台

    if (otherLn) {                                  // 非北捷官方板路線 ⇒ 整塊不畫
      follow('CD:A');
      updateFreqCard({ ln: otherLn, loop: false, termName: '', nextName: '', nextSec: null });
      out.other = read();
    }
    // 期望色也讓瀏覽器正規化一次再比：style.background 讀回來一律是 rgb(...)，
    // 直接拿 hex 比會恆不相等（第一版就是這樣紅的，是判準的問題不是產品的）。
    const norm = hex => { const d = document.createElement('i'); d.style.background = hex; return d.style.background; };
    out.expect = { A: fx.A.cars, B: fx.B.cars, colorA: fx.A.cars.map(v => norm(trtcOfficialCrowdColor(v))) };
    state.freqFollow = null;
    return out;
  }, CROWD_FIXTURE);

  ok(P('A0 前提：找得到一條北捷官方板路線，且 fixture 讓 roster 進入 live'),
    !!crowd.boardLnId && crowd.realNow === true && crowd.rosterLive === true,
    `line=${crowd.boardLnId} realNow=${crowd.realNow} rosterLive=${crowd.rosterLive}`);

  if (crowd.boardLnId) {
    ok(P('A1 有官方擁擠度時欄位出現，且格數＝官方陣列長度'),
      crowd.a && !crowd.a.hidden && crowd.a.state === 'ok' && crowd.a.bars === CROWD_FIXTURE.A.cars.length,
      JSON.stringify(crowd.a));
    // 🔴 這是本檔的主判準：顯示的值必須是【這一台】的值。join 鍵拿錯（vehicleId 當 officialNo）
    //    會讓 aCars 是 null；拿同終點第一台頂替會讓 aCars 等於別台的陣列。
    ok(P('A2 顯示的逐節值＝該車 officialNo 對到的官方陣列（join 鍵正確）'),
      JSON.stringify(crowd.aCars) === JSON.stringify(CROWD_FIXTURE.A.cars),
      `顯示=${JSON.stringify(crowd.aCars)} 期望=${JSON.stringify(CROWD_FIXTURE.A.cars)}`);
    ok(P('A3 每一格的顏色＝官方分級色（與車站看板、桌面小工具同一份色票）'),
      JSON.stringify(crowd.a && crowd.a.colors.map(c => c.replace(/\s/g, ''))) ===
      JSON.stringify(crowd.expect.colorA.map(c => c.replace(/\s/g, ''))),
      `顯示=${JSON.stringify(crowd.a && crowd.a.colors)} 期望=${JSON.stringify(crowd.expect.colorA)}`);
    // 換一台車值就要跟著換——沒有這一條，「永遠顯示同一台」也會讓 A2 通過
    ok(P('A4 換跟另一台車，逐節值跟著換（不是常數、也不是拿同終點的第一台頂替）'),
      JSON.stringify(crowd.bCars) === JSON.stringify(CROWD_FIXTURE.B.cars) &&
      JSON.stringify(crowd.aCars) !== JSON.stringify(crowd.bCars),
      `A=${JSON.stringify(crowd.aCars)} B=${JSON.stringify(crowd.bCars)}`);
    ok(P('A5 沒有官方車號的車（文湖線/環狀線）留白，且佔位只有一條、不宣稱節數'),
      crowd.noNo && crowd.noNo.state === 'none' && crowd.noNo.bars === 1 && crowd.noNo.txt.length > 0,
      JSON.stringify(crowd.noNo));
    ok(P('A6 roster 裡查無這台時也留白（不借值）'),
      crowd.ghost && crowd.ghost.state === 'none' && crowd.ghost.bars === 1, JSON.stringify(crowd.ghost));
    ok(P('A7 非北捷官方板路線整塊不畫（其他營運商官方沒有逐節資料）'),
      !crowd.otherLnId || (crowd.other && crowd.other.hidden === true),
      `otherLn=${crowd.otherLnId} ${JSON.stringify(crowd.other)}`);
    // 🔴 updateFreqCard 每幀跑。無條件 innerHTML= 會讓子節點每幀汰換（跟車面板點擊被吃掉那個
    //    缺陷的同一個機制）。A8 驗守門判斷在，A8b 是它的正向對照。
    ok(P('A8 內容沒變時不重寫 DOM（.cars 仍是同一顆節點）'), crowd.nodeStable === true, `stable=${crowd.nodeStable}`);
    ok(P('A8b 正向對照：內容變了確實有重畫（證明 A8 不是「乾脆都不畫」）'),
      crowd.nodeReplaced === true, `replaced=${crowd.nodeReplaced}`);
  }

  // ══ B. 桌面看板加寬 280 → 360 ════════════════════════════════════════════════
  // 另開 ?g=nat 的 context：台鐵班表在磁碟上、開得出有列的看板；捷運官方板本機沒有即時資料。
  // 開法用 repo 既有慣例（verify_board_direction_groups.mjs）：state.boardStation + renderBoard()。
  const bctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'zh-TW' });
  await bctx.addInitScript(INIT);
  const bp = await bctx.newPage();
  const berrs = [];
  bp.on('pageerror', e => berrs.push('PAGEERROR: ' + e.message));
  await bp.goto(`http://localhost:${PORT}/?lang=zh-TW&g=nat`, { waitUntil: 'domcontentloaded' });
  let bootOk = true;
  try {
    await bp.waitForFunction(() => {
      try { return typeof state !== 'undefined' && state.ready && (state.schedStations || []).length > 0; }
      catch (e) { return false; }
    }, null, { timeout: 40000 });
  } catch (e) { bootOk = false; }
  const board = !bootOk ? { found: false, boot: false } : await bp.evaluate(() => {
    const el = document.getElementById('board');
    if (!el) return { found: false };
    // 🔴 先把模擬時鐘撥到尖峰：本機在深夜跑時台鐵幾乎沒有班次，每一站都排不出 5 列，
    //    判準會紅在「環境條件」而不是回歸（判準盲點第 8 條）。直接寫 simSec 一律要同時
    //    清 clockAtNow（見 [[clock-jump-must-clear-clockatnow]]）。
    state.simSec = 8 * 3600; state.clockAtNow = false;
    // 挑第一個排得出 >=5 列的台鐵站——列數少的站量不到截斷，等於沒驗。
    let used = null, rows = 0;
    for (const st of (state.schedStations || []).filter(s => s.sys === 'tra_sched').slice(0, 40)) {
      state.boardStation = st; renderBoard();
      const n = el.querySelectorAll('.row').length;
      if (n >= 5) { used = st.name; rows = n; break; }
    }
    if (!used) return { found: false, rows: 0 };
    const truncated = () => [...el.querySelectorAll('.row .dest')]
      .filter(d => d.scrollWidth > d.clientWidth + 1).length;
    const declared = Math.round(el.getBoundingClientRect().width);
    const at360 = truncated();
    el.style.width = '280px';                 // 控制組：改回舊寬，截斷數必須上升
    void el.offsetWidth;
    const at280 = truncated();
    el.style.width = '';
    return { found: true, declared, rows, at360, at280, used };
  });
  ok(P('B0 前提：開得出一個 >=5 列的車站看板'), board.found && board.rows >= 5, JSON.stringify(board));
  if (board.found && board.rows >= 5) {
    ok(P('B1 桌面 .board 實際寬度＝360px'), board.declared === 360, `量到 ${board.declared}px`);
    ok(P('B2 360px 下沒有任何一列的「車種·往哪」被截斷'), board.at360 === 0,
      `${board.used}：截斷 ${board.at360}/${board.rows} 列`);
    // 🔴 反向判準必配正向對照：at360===0 在「.dest 根本沒有 ellipsis 規則」時也是恆真的。
    ok(P('B3 正向對照：寬度改回 280px 時確實有列被截斷（證明 B2 不是恆真）'), board.at280 > 0,
      `${board.used}：280px 截斷 ${board.at280} 列、360px 截斷 ${board.at360} 列`);
  }
  ok(P('B 看板頁零例外'), berrs.length === 0, berrs.slice(0, 3).join(' | '));
  await bctx.close();

  // 手機仍是整寬 sheet，不吃 360
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-TW', hasTouch: true });
  await mctx.addInitScript(INIT);
  const mp = await mctx.newPage();
  await mp.goto(`http://localhost:${PORT}/?lang=zh-TW&g=nat`, { waitUntil: 'domcontentloaded' });
  await mp.waitForFunction(() => {
    try { return typeof state !== 'undefined' && state.ready && (state.schedStations || []).length > 0; }
    catch (e) { return false; }
  }, null, { timeout: 40000 }).catch(() => {});
  const mob = await mp.evaluate(() => {
    const st = (state.schedStations || []).find(s => s.sys === 'tra_sched');
    const el = document.getElementById('board');
    if (!st || !el) return null;
    state.simSec = 8 * 3600; state.clockAtNow = false;
    state.boardStation = st; renderBoard();
    return { w: Math.round(el.getBoundingClientRect().width), vw: window.innerWidth,
      rows: el.querySelectorAll('.row').length };
  });
  ok(P('B4 手機仍是整寬 sheet（不套 360，也沒有因加寬而溢出畫面）'),
    !!mob && mob.w !== 360 && mob.w <= mob.vw, JSON.stringify(mob));
  await mctx.close();

  ok(P('Z 頁面零例外'), errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
  await browser.close();
}

const want = (process.env.ENGINES || 'chromium,webkit').split(',').map(s => s.trim()).filter(Boolean);
const ENGINES = { chromium, webkit };
for (const name of want) {
  if (!ENGINES[name]) { ok(`${name} 引擎名稱有效`, false, '只認 chromium / webkit'); continue; }
  console.log(`\n──────── ${name} ────────`);
  await runEngine(name, ENGINES[name]);
}

server.close();
const bad = results.filter(r => !r.pass);
console.log(`\n總計 ${results.length - bad.length}/${results.length} 通過`);
if (bad.length) { console.log('未過:'); bad.forEach(r => console.log('  - ' + r.name + (r.detail ? '  — ' + r.detail : ''))); }
process.exit(bad.length ? 1 : 0);
