// 搭乘模式「過了抵達時間自動下車」的驗收（issue #63 6556 加班車、#70 週五夜車 452）。
//
// 真因：ridingTick 只在「換日」才清掉搭乘紀錄，且車不在 state.trains 就一直 return 等它回來。
// 夜車過午夜換班表、連假加班車隔天沒開，車永遠回不來 ⇒ 使用者卡在車上一整天，
// 唯一的「我下車了」又只在跟著同一班車時才出現（跟不到了）⇒ 也上不了別班車。
//
//   A 車不在班表、已過抵達時間 20 分 ⇒ 自動下車，上車時存的沿途站快照補蓋成「搭過」
//   B 車不在班表、還沒到抵達時間 ⇒ 留著（不得提早下車）
//   C 舊版紀錄（沒有 dueAt）、車不在、上車 13 小時前 ⇒ 自動下車（現在就卡著的人要被放出來）
//   D 舊版紀錄、車不在、上車 1 小時前 ⇒ 留著
//   E 車還在班表、紀錄日期是昨天（夜車過午夜）、還沒到抵達時間 ⇒ 留著（舊版會在午夜直接清掉）
//   F startRiding 寫入 dueAt 與沿途站快照
//   G 跟著別班車時按「搭乘中」鈕：確認 ⇒ 下車並回到「我上車了」；取消 ⇒ 仍在搭乘
//   H 同車次號但下車站名對不上（別天的同號車）⇒ 不當成同一班
//
// 用法：node scripts/verify_ride_expire.mjs [目標目錄]
//   INDEX_FILE=<路徑> 改用別份 index.html（跑控制組：舊版應在 A/C/E/G 紅）
//   ENGINES=chromium 只跑一個引擎
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(process.argv[2] || SELF_ROOT);
const INDEX = path.resolve(process.env.INDEX_FILE || path.join(ROOT, 'index.html'));
const PORT = Number(process.env.PORT || 5263);
const BASE = `http://localhost:${PORT}/`;
const ENGINES = (process.env.ENGINES || 'chromium,webkit').split(',');

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/thsr-schedule') return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
    return res.end('{}');
  }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (fp === path.join(ROOT, 'index.html')) fp = INDEX;
  else if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, r));

{
  const disk = createHash('md5').update(readFileSync(INDEX)).digest('hex');
  const served = createHash('md5').update(await (await fetch(BASE)).text()).digest('hex');
  const build = (readFileSync(INDEX, 'utf8').match(/const BUILD = '([^']+)'/) || [])[1];
  ok(`G0 驗的是 ${INDEX}（BUILD ${build}）`, disk === served, `磁碟 ${disk.slice(0, 10)} / 伺服器 ${served.slice(0, 10)}`);
  if (disk !== served) { server.close(); process.exit(1); }
}

// 每個情境：寫入一筆搭乘紀錄 → 直接呼叫 ridingTick() → 回報紀錄還在不在、蓋了哪些站
const CASE = `async ({ rec }) => {
  localStorage.setItem(RIDING_KEY, JSON.stringify(rec));
  const before = new Set(Object.keys((loadCheckins() || {}).st || {}));
  ridingTick();
  const after = Object.keys((loadCheckins() || {}).st || {});
  return { riding: !!loadRiding(), stamped: after.filter(k => !before.has(k)) };
}`;

async function runEngine(name, engine) {
  const browser = await engine.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await page.goto(BASE + '?demo=bounty', { waitUntil: 'domcontentloaded' }); // demo=bounty ⇒ PHYSICAL_COLLECT_ENABLED（App 才有搭乘模式）
  await page.waitForFunction(() => { try { return state.ready === true && (state.trains || []).length > 0; } catch (e) { return false; } }, null, { timeout: 60000 });
  const P = `[${name}]`;
  const now = await page.evaluate(() => Date.now());
  const gone = { sys: 'tra', train: '6556', date: '2026-09-27', fromIdx: 0, fromName: '七堵', toIdx: 3, toName: '松山', atIdx: 0, bv: 0 };
  const snap = [['八堵', 25.108, 121.729], ['汐止', 25.068, 121.662], ['松山', 25.049, 121.578]];
  const run = rec => page.evaluate(new Function('return ' + CASE)(), { rec });

  const a = await run({ ...gone, startedAt: now - 3 * 3600e3, dueAt: now - 21 * 60e3, stops: snap });
  ok(`${P} A 車不在班表、過抵達 21 分 ⇒ 自動下車並補蓋沿途站`, !a.riding && ['八堵', '汐止', '松山'].every(n => a.stamped.some(k => k.includes(n))), JSON.stringify(a));
  const b = await run({ ...gone, startedAt: now - 3600e3, dueAt: now + 30 * 60e3, stops: snap });
  ok(`${P} B 車不在班表、還沒到抵達時間 ⇒ 留著`, b.riding, JSON.stringify(b));
  const c = await run({ ...gone, startedAt: now - 13 * 3600e3, date: await page.evaluate(() => todayStr(activeTz())) });
  ok(`${P} C 舊版紀錄、車不在、上車 13 小時前 ⇒ 自動下車`, !c.riding, JSON.stringify(c));
  const d = await run({ ...gone, startedAt: now - 3600e3, date: await page.evaluate(() => todayStr(activeTz())) });
  ok(`${P} D 舊版紀錄、車不在、上車 1 小時前 ⇒ 留著`, d.riding, JSON.stringify(d));

  // E：挑一班現在正在跑、終點還沒到的車，把紀錄日期設成昨天（模擬夜車過午夜）
  const e = await page.evaluate(async (CASE) => {
    const tr = state.trains.find(t => !t.loop && t.stops.length >= 3 && (() => {
      const i = ridingArrivedIdx(t, ridingNowSched(t)); return i >= 0 && i < t.stops.length - 2;
    })());
    if (!tr) return { skip: true };
    const i0 = ridingArrivedIdx(tr, ridingNowSched(tr)), last = tr.stops.length - 1;
    const rec = { sys: tr.sys, train: String(tr.train), date: '2000-01-01', fromIdx: i0, fromName: tr.stops[i0].name,
      toIdx: last, toName: tr.stops[last].name, atIdx: i0, bv: 0, startedAt: Date.now() - 600e3,
      dueAt: Date.now() + Math.max(60, tr.stops[last].arrSec - ridingNowSched(tr)) * 1000,
      stops: tr.stops.slice(i0 + 1).map(s => [s.name, s.lat, s.lon]) };
    const out = await (new Function('return ' + CASE)())({ rec });
    return { ...out, train: rec.train };
  }, CASE);
  ok(`${P} E 車還在、紀錄日期是昨天、未到抵達 ⇒ 留著`, !e.skip && e.riding, JSON.stringify(e));

  // F：真的走 startRiding
  const f = await page.evaluate(() => {
    saveRiding(null);
    const tr = state.trains.find(t => !t.loop && t.stops.length >= 3 && (() => {
      const i = ridingBoardIdx(t); return i < t.stops.length - 2 && ridingArrivedIdx(t, ridingNowSched(t)) >= 0;
    })());
    if (!tr) return { skip: true };
    const i0 = ridingBoardIdx(tr), to = tr.stops.length - 1;
    const expect = Date.now() + (tr.stops[to].arrSec - ridingNowSched(tr)) * 1000;
    startRiding(tr, to);
    const r = loadRiding();
    return { dueOk: !!r && Math.abs(r.dueAt - expect) < 5000, snapOk: !!r && Array.isArray(r.stops) && r.stops.length === to - i0
      && r.stops[r.stops.length - 1][0] === tr.stops[to].name };
  });
  ok(`${P} F startRiding 寫入 dueAt 與沿途站快照`, !f.skip && f.dueOk && f.snapOk, JSON.stringify(f));

  // G：跟著別班車，按「搭乘中」鈕
  const g = await page.evaluate(async () => {
    saveRiding(null);
    localStorage.setItem(RIDING_KEY, JSON.stringify({ sys: 'tra', train: '6556', date: todayStr(activeTz()), fromIdx: 0, fromName: '七堵',
      toIdx: 3, toName: '松山', atIdx: 0, bv: 0, startedAt: Date.now() - 600e3, dueAt: Date.now() + 3600e3 }));
    const tr = state.trains.find(t => !t.loop && String(t.train) !== '6556' && ridingArrivedIdx(t, ridingNowSched(t)) >= 0 && ridingArrivedIdx(t, ridingNowSched(t)) < t.stops.length - 1);
    if (!tr) return { skip: true };
    setFollow(tr); updateRideBtn(tr);
    const btn = document.getElementById('fpRide');
    const label0 = btn && btn.textContent;
    window.confirm = () => false; btn.click();
    const keptOnCancel = !!loadRiding();
    window.confirm = () => true; btn.click();
    return { label0, keptOnCancel, cleared: !loadRiding(), label1: btn.textContent };
  });
  ok(`${P} G 「搭乘中」鈕：取消仍在搭、確認就下車並回到「我上車了」`,
    !g.skip && /6556/.test(g.label0 || '') && g.keptOnCancel && g.cleared && g.label1 === '我上車了', JSON.stringify(g));

  // H：同車次號但停站不同（別天的同號車）⇒ 不得拿來蓋章，當作車不在
  const h = await page.evaluate(() => {
    saveRiding(null);
    const tr = state.trains.find(t => !t.loop && t.stops.length >= 3);
    if (!tr) return { skip: true };
    const rec = { sys: tr.sys, train: String(tr.train), fromIdx: 0, fromName: tr.stops[0].name, toIdx: 1, toName: '不存在的站',
      atIdx: 0, bv: 0, startedAt: Date.now() - 600e3, dueAt: Date.now() + 3600e3 };
    return { found: !!ridingTrainOf(rec), foundReal: !!ridingTrainOf({ ...rec, toName: tr.stops[1].name }) };
  });
  ok(`${P} H 同車次號但下車站對不上 ⇒ 不當成同一班`, !h.skip && !h.found && h.foundReal, JSON.stringify(h));

  ok(`${P} 沒有頁面例外`, errs.length === 0, errs.join(' | '));
  await browser.close();
}

try {
  for (const e of ENGINES) await runEngine(e, e === 'webkit' ? webkit : chromium);
} finally { server.close(); }
const fail = results.filter(r => !r.pass).length;
console.log(`\n${results.length - fail}/${results.length} PASS`);
process.exit(fail ? 1 : 0);
