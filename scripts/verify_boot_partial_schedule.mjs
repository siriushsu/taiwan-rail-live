#!/usr/bin/env node
// 「某個系統的班表殘缺，其餘系統仍要畫得出來」的守門人。
//
// 為什麼有這一支:2026-09-04 出貨閘門 check-obs-removed 偶發紅一次,症狀是
// `TypeError: sys.data.trains is not iterable` ＋ boot 60 秒內沒有 state.ready
// (＝使用者看到空白 App)。同一顆 commit 重跑三次都綠 ⇒ 那次是暫時性的班表載入失敗。
//
// 走得到的到底是哪條路(這一段決定了本檔怎麼注入故障,不要憑「回 500」想當然耳):
//   fetchJSONAt 對非 2xx／網路錯／body 不是 JSON 一律回 null
//     ⇒ raw=null ⇒ resolveScheduleDay(null) 回 null ⇒ boot 的 `day ? {…} : null` 把
//       整個系統丟掉 ⇒ 它根本不會進 state.systems,applySchedSystems 也就碰不到它。
//   所以 **500／空 body 重現不出這個 TypeError**。真正走得到的是
//   **HTTP 200 ＋ body 是合法 JSON、只是沒有 trains 陣列**(例如 `{}`):
//     resolveScheduleDay 第一行 `if (!data || !data.dates || !Array.isArray(data.trains)) return data;`
//     ——「舊格式/其他系統原樣通過」——把它原樣放行 ⇒ day 是 truthy ⇒
//     `{ …d, data: {} }` 進了 state.systems ⇒ applySchedSystems 迭代 sys.data.trains 當場拋錯。
//   上游 API 在故障時回 200 `{}`／`{"error":…}` 是最常見的一種壞法(高鐵班表就是走 /api/),
//   而 check-obs-networked 那支的 /api 代理在 fetch 拋錯時正是 fulfill 一個 200 `{}`。
//
// 閘門(三次開機,互為對照):
//   A 控制組(不注入):正常開機必須 ready、零 pageerror、三個系統都有車。
//     少了這條就分不出「注入組綠」是真的修好,還是整個 harness 根本沒跑起來(judgment §七.8)。
//   B 破台鐵、C 破高鐵、D 破林鐵(該系統班表回 200 `{}`),各四條:
//     ?1 注入生效——那個系統進了 state.systems 而 data.trains 不是陣列。
//        這是「證明我真的跑到那條路徑」的那一條:少了它,glob 打錯字會讓 ?2–?4 恆真空過,
//        而 ?3「零 pageerror」是反向判準、單獨看恆真無訊號。
//     ?2 boot 到 state.ready   ?3 零 pageerror   ?4 其餘兩個系統仍畫得出車。
//        ?4 擋的是「乾脆整包不畫就不會拋錯」那種假修法。
//
// 刻意離線:/api/** 一律回 404(本機 API_BASE 為空 ⇒ 高鐵班表自己退回打包靜態檔)。
// 不代理到正式站——那個網路代理正是原閘門偶發紅的來源,守門人自己不該有這種不確定性。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(process.argv[2] || join(import.meta.dirname, '..'));
const PORT = Number(process.env.BOOTSCHED_PORT || 43571);
// 兩個注入點,走的是兩條不同的崩潰路徑,缺一不可:
//   thsr 台鐵以外、無 special ⇒ 直接死在 applySchedSystems 的 `for (const tr of sys.data.trains)`
//        ——這正是 2026-09-04 回報的 `sys.data.trains is not iterable`(高鐵班表走 /api/,
//        而 check-obs-removed 的 /api 代理在 fetch 拋錯時 fulfill 的就是 200 `{}`)。
//   tra  有 special:true ⇒ applySchedSystems 更早一行的 buildLoopTrains(sys.data) 先炸
//        (`data.trains.some(...)`),連 for 迴圈都走不到。
//   afr  祝山線觀日列車 ⇒ 更早在 boot 的 addSunriseTrains() 就炸(同樣是 `.some`)。
//   三個 sched 系統各有自己的第一個炸點,只驗一個會漏掉另外兩條。
const BROKEN = {
  tra:  { glob: '**/data/tra_schedule_dense.json*', label: '台鐵', id: 'tra_sched' },
  thsr: { glob: '**/api/thsr-schedule*',            label: '高鐵', id: 'thsr_sched' },
  afr:  { glob: '**/data/afr_schedule_dense.json*', label: '林鐵', id: 'afr_sched' },
};
const ALL_SCHED = Object.values(BROKEN).map(x => x.id);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? '✅' : '❌'} ${name}${detail ? '  ' + detail : ''}`); };

const server = createServer(async (rq, rs) => {
  try {
    const p = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
    if (p.startsWith('/api/')) { rs.statusCode = 404; return rs.end('no api'); }
    const f = join(ROOT, p === '/' ? 'index.html' : p);
    if (!f.startsWith(ROOT)) { rs.statusCode = 403; return rs.end(); }
    const b = await readFile(f);
    rs.setHeader('content-type', MIME[extname(f)] || 'application/octet-stream');
    rs.end(b);
  } catch { rs.statusCode = 404; rs.end('nf'); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

// 一次開機。breakSys 給 'tra'／'thsr' 時把該系統的班表換成 200 `{}`;給 null 就是控制組。
async function boot(browser, breakSys) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  let hits = 0;
  if (breakSys) await ctx.route(BROKEN[breakSys].glob, async r => {
    hits++;
    await r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  // ?g=nat 釘死開場群組(台鐵＋高鐵＋林鐵同框,mode:'sched' ⇒ 一定走 applySchedSystems),
  // 順便讓 deepG 把「上次視野／預設地點」整條旁路掉;?lang=zh-TW 釘死語系。
  await page.goto(`http://127.0.0.1:${PORT}/index.html?g=nat&lang=zh-TW`, { waitUntil: 'domcontentloaded' });
  let ready = true;
  await page.waitForFunction(() => window.__state && window.__state.ready, null, { timeout: 60000 }).catch(() => { ready = false; });
  // boot 沒到 window.__state 時仍要拿得到讀數,不能讓 evaluate 拋錯把整支腳本炸掉
  const r = await page.evaluate(id => {
    const s = window.__state || {};
    const sys = id ? (s.systems || []).find(x => x.id === id) || null : null;
    const bySys = {};
    for (const t of (s.trains || [])) bySys[t.sys] = (bySys[t.sys] || 0) + 1;
    return {
      // 注入生效的證據:那個系統確實進了 state.systems,而它的 data.trains 不是陣列
      brokenPresent: !!sys,
      brokenIsArray: !!(sys && Array.isArray(sys.data && sys.data.trains)),
      brokenType: sys ? Object.prototype.toString.call(sys.data && sys.data.trains) : '(無此系統)',
      bySys,
    };
  }, breakSys ? BROKEN[breakSys].id : null)
    .catch(e => ({ evalFailed: String(e).slice(0, 120) }));
  await ctx.close();
  return { ready, errs, hits, ...r };
}

const browser = await chromium.launch();
try {
  // ── A 控制組:不注入 ──
  const a = await boot(browser, null);
  ok('A1 控制組 boot 到 state.ready', a.ready, a.ready ? '' : '60 秒內沒 ready——先看 pageerror');
  ok('A2 控制組零 pageerror', a.errs.length === 0, a.errs.slice(0, 2).join(' | '));
  ok('A3 控制組三個系統都有車(證明沒注入時這條路是有資料的)',
    !!(a.bySys && a.bySys.tra_sched > 0 && a.bySys.thsr_sched > 0 && a.bySys.afr_sched > 0),
    JSON.stringify(a.bySys || {}));

  // ── B/C 注入組:該系統班表回 200 `{}` ──
  for (const [k, tag] of [['tra', 'B'], ['thsr', 'C'], ['afr', 'D']]) {
    const g = await boot(browser, k);
    const lbl = BROKEN[k].label;
    const others = ALL_SCHED.filter(id => id !== BROKEN[k].id);
    ok(`${tag}1 注入生效:${lbl}進了 state.systems 而 data.trains 不是陣列`, g.brokenPresent && !g.brokenIsArray,
      `攔截 ${g.hits} 次, trains=${g.brokenType}`);
    ok(`${tag}2 ${lbl}班表殘缺仍 boot 到 state.ready`, g.ready, g.ready ? '' : '60 秒內沒 ready——先看 pageerror');
    ok(`${tag}3 ${lbl}班表殘缺零 pageerror`, g.errs.length === 0, g.errs.slice(0, 3).join(' | '));
    ok(`${tag}4 其餘系統仍畫得出車(${others.join('/')})`,
      !!(g.bySys && others.every(id => g.bySys[id] > 0)), JSON.stringify(g.bySys || {}));
  }
} finally {
  await browser.close();
  server.close();
}
const pass = results.filter(x => x.pass).length;
console.log(`\n=== ${pass}/${results.length} 通過 ===`);
process.exit(pass === results.length ? 0 : 1);
