// 搜尋接上車種／車型（網友回報 issue #48）驗收：chromium＋webkit，桌面視窗（搜尋框常駐 header）。
// 用法：node scripts/verify_search_train_type.mjs [目標目錄]   ENGINES=chromium 只跑一個引擎
//
// 判準的真值來源刻意與實作不同源（判準盲點 1）：
//   車型名稱／story 的期望值直接讀磁碟上的 data/tra_special_trains.json，不問頁面；
//   「哪些班次現在在途」由本檔自己從當日名冊的 stops 算，不呼叫頁面的 searchTypeMatch。
//   若拿頁面自己的函式當期望值，兩邊永遠自洽、這支閘門會恆綠。
// 釘死模擬時鐘 09:41（比照 verify_query_tab.mjs）：本檔的排序判準要「現在有車在跑」才有意義，
//   拿真實牆鐘跑，深夜會全線無班次 ⇒ G3／G5 集體假紅，屬三種紅裡的「環境條件」。
// 語系釘 zh-TW：車種名（自強／區間車）在別的語系會被 trainTypeName 翻掉，判準會隨機器語系假紅。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(process.argv[2] || SELF_ROOT);
const PORT = Number(process.env.PORT || 5281);
const BASE = `http://localhost:${PORT}/`;
const ENGINES = (process.env.ENGINES || 'chromium,webkit').split(',');
const PIN_SEC = 9 * 3600 + 41 * 60;

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.geojson': 'application/json' };
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

// G0：先證明「驗的是這棵樹」——多 worktree 並行，硬編埠號很容易連到別人的伺服器。
{
  const disk = createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
  const served = createHash('md5').update(await (await fetch(BASE)).text()).digest('hex');
  const build = (readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/const BUILD = '([^']+)'/) || [])[1];
  ok(`G0 驗的是目標目錄（${ROOT}，BUILD ${build}，md5 ${disk.slice(0, 8)}）`, disk === served, `磁碟 ${disk.slice(0, 10)} / 伺服器 ${served.slice(0, 10)}`);
  if (disk !== served) { server.close(); process.exit(1); }
}

// ── 期望值：獨立讀磁碟資料，不問頁面 ────────────────────────────────────
const SPECIAL = JSON.parse(readFileSync(path.join(ROOT, 'data/tra_special_trains.json'), 'utf8'));
// 產品讀的是 data/tra_schedule_dense.json（index.html 的 SYS 表 tra_sched.url），而且那是 14 天逐日制：
// trains[] 是整個 dateRange 的聯集（991 班），resolveScheduleDay() 再用 dates[今天] 的索引挑出當日名冊。
// 拿整份 trains 當期望值會量到 188 班自強，而使用者看到的是今天的 132 班——判準會對著錯的分母紅。
// 這裡照同一條規則自己挑一次（不呼叫頁面的函式，維持不同源）：今天不在涵蓋範圍就退回最接近的一天。
const DENSE = JSON.parse(readFileSync(path.join(ROOT, 'data/tra_schedule_dense.json'), 'utf8'));
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const DAY_KEY = DENSE.dates && DENSE.dates[TODAY] ? TODAY
  : Object.keys(DENSE.dates || {}).sort((a, b) => Math.abs(Date.parse(a) - Date.parse(TODAY)) - Math.abs(Date.parse(b) - Date.parse(TODAY)))[0];
const SCHED = { trains: (DENSE.dates[DAY_KEY] || []).map(i => DENSE.trains[i]).filter(Boolean) };
console.log(`（期望值來源：data/tra_schedule_dense.json 的 ${DAY_KEY} 名冊，${SCHED.trains.length} 班；全檔 ${DENSE.trains.length} 班是 ${DENSE.dateRange.join('～')} 的聯集）`);
const STOCK_BY_ID = Object.fromEntries(SPECIAL.rollingStock.map(r => [r.id, r]));
const norm = s => String(s || '').replace(/臺/g, '台').replace(/\s+/g, '').replace(/號/g, '').toLowerCase();
const carToStock = new Map();
for (const r of SPECIAL.rollingStock) for (const cn of (r.carNames || [])) carToStock.set(cn, r);

/** 本檔自己算：查詢 q 應該命中哪些班次、其中哪些現在（PIN_SEC）在途。 */
function expectHits(q) {
  const nq = norm(q);
  const stocks = SPECIAL.rollingStock.filter(r => [r.name, r.id, ...(r.carNames || [])].some(v => norm(v).includes(nq)));
  const ids = new Set(stocks.map(r => r.id));
  const trains = (SCHED.trains || []).filter(tr => {
    const st = carToStock.get(tr.carName);
    return (st && ids.has(st.id)) || norm(tr.typeName).includes(nq);
  });
  const running = trains.filter(tr => {
    const dep = tr.stops[0].depSec, arr = tr.stops[tr.stops.length - 1].arrSec;
    return dep <= PIN_SEC && PIN_SEC <= arr;
  });
  return { stocks, trains, running };
}

async function boot(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('trainmap-howto-seen', '1');
      localStorage.setItem('iabHintDismiss', String(Date.now() + 1e9));
      localStorage.setItem('trainmap-appearance', 'light');
      localStorage.setItem('trainmap-language', 'zh-TW');
    } catch (e) {}
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await page.goto(BASE + '?lang=zh-TW', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 60000 });
  await page.evaluate(sec => { nowSecOfDay = () => sec; setSimSec(sec); state.clockAtNow = false; }, PIN_SEC);
  await page.waitForTimeout(300);
  return { ctx, page, errs };
}

/** 在搜尋框輸入 q，回傳下拉的結構化內容。 */
async function search(page, q) {
  return page.evaluate(query => {
    const inp = document.getElementById('trainSearch');
    inp.value = query;
    renderSearchDrop();
    const drop = document.getElementById('searchDrop');
    const secs = [...drop.querySelectorAll('.sd-sec')].map(e => e.textContent.trim());
    const stockRows = [...drop.querySelectorAll('.row.stock-row')].map(e => e.querySelector('.nm').textContent.trim());
    const trRows = [...drop.querySelectorAll('.row.tr-row')].map(e => ({
      no: e.querySelector('.nm').textContent.trim(),
      meta: e.querySelector('.tr-meta').textContent.trim(),
    }));
    const count = (drop.querySelector('.stn-count') || {}).textContent || '';
    return { hidden: drop.hidden, secs, stockRows, trRows, count, empty: !!drop.querySelector('.empty'), html: drop.innerHTML.length };
  }, q);
}

for (const engine of ENGINES) {
  const browser = await (engine === 'webkit' ? webkit : chromium).launch();
  const { ctx, page, errs } = await boot(browser);
  const E = n => `[${engine}] ${n}`;

  // G1 打「自強號」——issue #48 的原始症狀：改動前這裡是 0 筆＋「查無車站、車次或列車」
  {
    const exp = expectHits('自強號');
    const r = await search(page, '自強號');
    ok(E(`G1a 「自強號」不再查無（期望命中 ${exp.trains.length} 班）`), !r.empty && r.trRows.length > 0, `列出 ${r.trRows.length} 列`);
    ok(E('G1b 「自強號」列出的每一列都是自強號'), r.trRows.length > 0 && r.trRows.every(x => x.meta.includes('自強')),
      r.trRows.map(x => x.no + ':' + x.meta.slice(0, 14)).slice(0, 3).join(' / '));
    // 覆蓋率具名 gate（判準盲點 6）：分母不能無聲縮水
    ok(E('G1c 命中總數行寫出正確的班數'), r.count.includes(String(exp.trains.length)), `期望含 ${exp.trains.length}，實得「${r.count.trim()}」`);
  }

  // G2 車型查詢：EMU3000 含數字，改動前會被當車次前綴查而落空
  {
    const exp = expectHits('EMU3000');
    const want = STOCK_BY_ID.emu3000.name;
    const r = await search(page, 'EMU3000');
    ok(E('G2a 「EMU3000」出現車型區'), r.secs.includes('車型') && r.stockRows.length > 0, `車型列 ${JSON.stringify(r.stockRows)}`);
    ok(E(`G2b 車型列的名稱＝資料檔的 ${want}`), r.stockRows.includes(want), `實得 ${JSON.stringify(r.stockRows)}`);
    ok(E(`G2c 「EMU3000」列出班次（期望命中 ${exp.trains.length} 班）`), r.trRows.length > 0, `列出 ${r.trRows.length} 列`);
    ok(E('G2d 車型查詢的班次列有標出車型'), r.trRows.length > 0 && r.trRows.every(x => x.meta.includes(want)),
      r.trRows.slice(0, 2).map(x => x.meta.slice(0, 26)).join(' / '));
  }

  // G3 排序：正在跑的排前面（期望值由本檔自己從 stops 算）
  {
    const exp = expectHits('自強號');
    const r = await search(page, '自強號');
    const runningNos = new Set(exp.running.map(t => String(t.train)));
    const shown = r.trRows.map(x => x.no);
    const firstIsRunning = shown.length > 0 && runningNos.has(shown[0]);
    ok(E(`G3a 09:41 有自強號在途（分母 ${exp.running.length} 班，否則本段無意義）`), exp.running.length > 0, `在途 ${exp.running.length} / 全日 ${exp.trains.length}`);
    if (exp.running.length > 0) {
      ok(E('G3b 第一列是現在在途的班次'), firstIsRunning, `第一列 ${shown[0]}，在途集合大小 ${runningNos.size}`);
      const shownRunning = shown.filter(n => runningNos.has(n)).length;
      const prefix = shown.slice(0, Math.min(shown.length, exp.running.length)).every(n => runningNos.has(n));
      ok(E('G3c 在途班次全部排在非在途之前'), prefix, `列出 ${shown.length} 列，其中在途 ${shownRunning}`);
    }
  }

  // G4 車型介紹卡：rollingStock 的 story 在搜尋裡有了第二個入口
  {
    await search(page, '太魯閣');
    const want = STOCK_BY_ID.taroko;
    const r = await page.evaluate(() => {
      const row = document.querySelector('#searchDrop .row.stock-row');
      if (!row) return { clicked: false };
      row.click();
      const card = document.querySelector('#searchDrop .sd-named');
      return { clicked: true, title: card ? card.querySelector('.tn').textContent.trim() : '', body: card ? card.querySelector('p').textContent.trim() : '' };
    });
    ok(E('G4a 「太魯閣」有車型列可點'), r.clicked === true);
    ok(E(`G4b 點了開出介紹卡，標題＝${want.name}`), r.title === want.name, `實得「${r.title}」`);
    ok(E('G4c 介紹卡內文＝資料檔的 story'), r.body === want.story, `實得 ${r.body.length} 字 / 期望 ${want.story.length} 字`);
  }

  // G5 反向對照（判準盲點 5）：不存在的詞必須仍然查無——否則上面每一條 ok 都可能是恆真
  {
    const r = await search(page, '銀河特快霍格華茲');
    ok(E('G5a 不存在的詞仍然查無'), r.empty === true && r.trRows.length === 0 && r.stockRows.length === 0,
      `車次列 ${r.trRows.length}／車型列 ${r.stockRows.length}／empty=${r.empty}`);
    // 1 字查詢不啟動（nq.length < 2 那條），否則「自」會掃出整片
    const one = await search(page, '自');
    ok(E('G5b 單字查詢不觸發車種比對'), one.stockRows.length === 0, `車型列 ${one.stockRows.length}`);
  }

  // G6 車種：區間車／莒光也要查得到（使用者說的「區間車除外」是指不必再細分，不是不能查）
  {
    for (const q of ['區間車', '莒光']) {
      const exp = expectHits(q);
      const r = await search(page, q);
      ok(E(`G6 「${q}」查得到（期望 ${exp.trains.length} 班）`), exp.trains.length === 0 || r.trRows.length > 0,
        `列出 ${r.trRows.length} 列`);
    }
  }

  ok(E('G7 全程零 pageerror'), errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
  await browser.close();
}

server.close();
const fail = results.filter(r => !r.pass);
console.log(`\n${results.length - fail.length}/${results.length} PASS`);
if (fail.length) { console.log('FAIL:\n' + fail.map(f => ' - ' + f.name + (f.detail ? ' — ' + f.detail : '')).join('\n')); process.exit(1); }
