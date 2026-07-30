// 完乘蓋章的邊界驗收：使用者 2026-07-30 回報「我剛搜尋車次，剛好是已經結束的車次，結果就跳出成就達成了」。
//
// 真因：setFollow 對「現在沒在跑」的車會把 simSec 撥回發車前，但沒有離開「跟著現在」的狀態
// （clockAtNow 仍為 true）⇒ 每秒跑一次的 clockDriftGuard 在 1 秒內把時鐘拉回真實時刻，而完乘資格
// 快照 followStartEff 已經記在撥回後的時刻（＝合格）⇒ updateFollowCamera 立刻判定抵達並蓋章。
//
// 判準刻意寫成三件互相牽制的行為，缺一都能被「錯的修法」蒙過去：
//   A 搜尋跑完／還沒發車的車不得產生完乘記錄（使用者的原話）
//   B「撥回發車前」這個原意要留住——時鐘不得又被拉回現在（只把 recordRide 擋掉就會漏掉這條）
//   C 真正該蓋章的路徑（護照灰章重播：從發車前跟到終點）仍要蓋得到章（否則直接停用蓋章也會全綠）
//
// 用法：node scripts/verify_ride_gate.mjs [目標目錄]   ENGINES=chromium 只跑一個引擎
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(process.argv[2] || SELF_ROOT);
const PORT = Number(process.env.PORT || 5261);
const BASE = `http://localhost:${PORT}/`;
const ENGINES = (process.env.ENGINES || 'chromium,webkit').split(',');

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) { res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, r));

// G0：先證明「驗的是當前工作區」——20+ 個 worktree 並行，硬編埠號很容易連到別人的伺服器。
{
  const disk = createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
  const served = createHash('md5').update(await (await fetch(BASE)).text()).digest('hex');
  const build = (readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/const BUILD = '([^']+)'/) || [])[1];
  ok(`G0 驗的是目標目錄（${ROOT}，BUILD ${build}）`, disk === served, `磁碟 ${disk.slice(0, 10)} / 伺服器 ${served.slice(0, 10)}`);
  if (disk !== served) { server.close(); process.exit(1); }
}

const SNAP = `(() => ({
  simSec: Math.round(state.simSec), clockAtNow: !!state.clockAtNow, playing: !!state.playing,
  speed: state.speedMult, mode: state.mode, jumped: !!state.followTimeJumped,
  startEff: state.followStartEff == null ? null : Math.round(state.followStartEff),
  status: state.followStatus, follow: state.followTrain ? String(state.followTrain.train) : null,
  rides: loadRides().length,
  rideEvent: (state.followEvents || []).some(e => /完乘達成/.test(e.msg || '')),
}))()`;

async function boot(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('trainmap-howto-seen', '1');
      localStorage.setItem('trainmap-appearance', 'light');
      localStorage.removeItem('trainmap-rides'); // 每輪從零筆完乘起手
    } catch (e) {}
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 45000 });
  await page.evaluate(() => selectGroup(GROUPS.find(g => g.id === 'tra')));
  await page.waitForFunction(() => state.mode === 'sched' && (state.trains || []).some(t => t.sys === 'tra_sched'), null, { timeout: 45000 });
  return { ctx, page, errs };
}

/// 每個情境都從「開機那一刻的狀態」重新起手：1×、播放中、時鐘貼著現在。
/// 這正是使用者搜尋車次時的狀態，也是 clockDriftGuard 唯一會動手的狀態。
async function reset(page) {
  await page.evaluate(() => {
    clearFollow();
    setSpeed(1);
    if (!state.playing) togglePlay();
    state.simSec = nowSecOfDay(activeTz());
    state.clockAtNow = true;
    state.followTimeJumped = false;
    saveRides([]); // 完乘記錄每個情境各自從零筆起手，否則上一個情境蓋的章會讓下一項無條件紅／綠
    state.followEvents = []; state._evSeen = {};
    syncTimeUI();
  });
  await page.waitForTimeout(150);
}

/// 從真實班表挑四種樣本：已跑完、還沒發車、正在跑、全天最短程（正向對照用）
async function pickTrains(page) {
  return await page.evaluate(() => {
    const now = state.simSec;
    const pool = state.trains.filter(t => t.sys === 'tra_sched' && !t.loop && t.stops && t.stops.length > 2
      && t.stops[t.stops.length - 1].arrSec < 86400);
    const info = t => ({ no: String(t.train), dep: t.stops[0].depSec, arr: t.stops[t.stops.length - 1].arrSec });
    const done = pool.filter(t => t.stops[t.stops.length - 1].arrSec < now - 600)
      .sort((a, b) => b.stops[b.stops.length - 1].arrSec - a.stops[a.stops.length - 1].arrSec)[0];
    const future = pool.filter(t => t.stops[0].depSec > now + 1800)
      .sort((a, b) => a.stops[0].depSec - b.stops[0].depSec)[0];
    const running = pool.filter(t => t.stops[0].depSec + 180 < now && now < t.stops[t.stops.length - 1].arrSec - 180)
      .sort((a, b) => a.stops[0].depSec - b.stops[0].depSec)[0];
    const short = pool.filter(t => t.stops[t.stops.length - 1].arrSec - t.stops[0].depSec > 300)
      .sort((a, b) => (a.stops[a.stops.length - 1].arrSec - a.stops[0].depSec) - (b.stops[b.stops.length - 1].arrSec - b.stops[0].depSec))[0];
    return {
      now, done: done && info(done), future: future && info(future),
      running: running && info(running), short: short && info(short),
    };
  });
}

for (const engineName of ENGINES) {
  const engine = engineName === 'webkit' ? webkit : chromium;
  const browser = await engine.launch();
  const { ctx, page, errs } = await boot(browser);
  const picks = await pickTrains(page);
  const hhmm = s => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}`;
  ok(`G1 ${engineName} 四種樣本都取得到（現在 ${hhmm(picks.now)}）`,
    !!(picks.done && picks.future && picks.running && picks.short),
    `跑完 ${picks.done && picks.done.no} / 未發 ${picks.future && picks.future.no} / 在跑 ${picks.running && picks.running.no} / 最短 ${picks.short && picks.short.no}`);

  // ── A 已經跑完的車：使用者回報的那條路 ──
  if (picks.done) {
    const t = picks.done;
    await reset(page);
    const pre = await page.evaluate(c => eval(c), SNAP);
    ok(`G2 ${engineName} 前置條件成立（1×、播放中、時鐘貼現在、0 筆完乘）`,
      pre.speed === 1 && pre.playing && pre.clockAtNow && pre.rides === 0 && pre.mode === 'sched',
      JSON.stringify(pre));

    await page.evaluate(no => followTrainNo(no, { sys: 'tra_sched' }), t.no);
    await page.waitForTimeout(400);
    const at04 = await page.evaluate(c => eval(c), SNAP);
    await page.waitForTimeout(3200); // clockDriftGuard 每秒一次：等它有機會動手
    const at36 = await page.evaluate(c => eval(c), SNAP);
    const tag = `${engineName} 搜尋已跑完的 ${t.no}（${hhmm(t.dep)}→${hhmm(t.arr)}，現在 ${hhmm(picks.now)}）`;

    ok(`G3 ${tag} 不得蓋完乘章`, at36.rides === 0 && !at36.rideEvent,
      `完乘記錄 ${at36.rides} 筆、面板事件 ${at36.rideEvent ? '有' : '無'}「完乘達成」`);
    ok(`G4 ${tag} 時鐘撥回這班車還沒跑完的時刻，3 秒後仍然如此`,
      at04.simSec < t.arr - 1 && at36.simSec < t.arr - 1,
      `0.4 秒 ${hhmm(at04.simSec)} / 3.6 秒 ${hhmm(at36.simSec)}（終點 ${hhmm(t.arr)}）`);
    ok(`G5 ${tag} 跟隨狀態不是「已抵達」`, at36.status !== 'done', `status=${at36.status}`);
  }

  // ── B 還沒發車的車：同一個真因的另一半症狀（時鐘撥不過去） ──
  if (picks.future) {
    const t = picks.future;
    await reset(page);
    await page.evaluate(no => followTrainNo(no, { sys: 'tra_sched' }), t.no);
    await page.waitForTimeout(3400);
    const s = await page.evaluate(c => eval(c), SNAP);
    const tag = `${engineName} 搜尋還沒發車的 ${t.no}（${hhmm(t.dep)} 發）`;
    ok(`G6 ${tag} 時鐘停在發車前後，不是被拉回現在`,
      Math.abs(s.simSec - t.dep) <= 120,
      `時鐘 ${hhmm(s.simSec)}（發車 ${hhmm(t.dep)}、現在 ${hhmm(picks.now)}）`);
    ok(`G7 ${tag} 不得蓋完乘章`, s.rides === 0 && !s.rideEvent, `完乘記錄 ${s.rides} 筆`);
  }

  // ── C 正在跑的車：不該被撥時鐘，也不該掉出「跟著現在」 ──
  if (picks.running) {
    const t = picks.running;
    await reset(page);
    await page.evaluate(no => followTrainNo(no, { sys: 'tra_sched' }), t.no);
    await page.waitForTimeout(2400);
    const s = await page.evaluate(c => eval(c), SNAP);
    const tag = `${engineName} 跟一班正在跑的 ${t.no}（${hhmm(t.dep)}→${hhmm(t.arr)}）`;
    ok(`G8 ${tag} 時鐘維持在現在（不撥時光機）`, Math.abs(s.simSec - picks.now) <= 30,
      `時鐘 ${hhmm(s.simSec)}（現在 ${hhmm(picks.now)}）`);
    ok(`G9 ${tag} 仍在「跟著現在」狀態`, s.clockAtNow === true, `clockAtNow=${s.clockAtNow}`);
    ok(`G10 ${tag} 中途接手不蓋章、狀態是行進中`, s.rides === 0 && s.status === 'run',
      `完乘 ${s.rides} 筆、status=${s.status}`);
  }

  // ── D 正向對照：真正該蓋章的路徑還要蓋得到（不然「停用蓋章」也會全綠） ──
  if (picks.short) {
    const t = picks.short;
    await reset(page);
    await page.evaluate(no => followTrainNo(no, { sys: 'tra_sched', fromStart: true }), t.no);
    const dur = t.arr - t.dep;
    const budget = Math.ceil(dur / 30) + 45; // fromStart 固定 30×，加開機/停站讓位的餘裕
    let s = null;
    for (let i = 0; i < budget; i++) {
      s = await page.evaluate(c => eval(c), SNAP);
      if (s.rides > 0) break;
      await page.waitForTimeout(1000);
    }
    const tag = `${engineName} 灰章重播 ${t.no}（${hhmm(t.dep)}→${hhmm(t.arr)}，${Math.round(dur / 60)} 分鐘）`;
    ok(`G11 ${tag} 從發車跟到終點會蓋章`, s && s.rides === 1 && s.rideEvent,
      `完乘記錄 ${s && s.rides} 筆、status=${s && s.status}、時鐘 ${s && hhmm(s.simSec)}`);
  }

  ok(`G12 ${engineName} 無 JS 錯誤`, errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
  await browser.close();
}

server.close();
const failed = results.filter(r => !r.pass);
console.log(`\n== ${results.length - failed.length}/${results.length} PASS ==`);
if (failed.length) { console.log(failed.map(f => '  FAIL ' + f.name).join('\n')); process.exit(1); }
