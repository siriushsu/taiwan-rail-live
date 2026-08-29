// 預算剖面搬家案的收貨閘門。三方比對，缺一邊就會變成拿資料跟自己比：
//
//   A 離線產物  ──(1)──  B 前端【現算】(把剖面檔藏起來)  ──(2)──  C 前端【讀預算值】
//
//   (1) 證明「我對資料載入與貼軌前置的移植是對的」——兩邊共用同一段模型原始碼，會出錯的
//       是我重寫的那一半：哪些軌道算同一系統、站名補充投影吃到哪些座標、跑段怎麼切。
//   (2) 證明「前端改成讀預算值之後畫的位置沒有變」——這是使用者真正在乎的那條。
//
// 另外兩條具名斷言擋「資料整批沒被採用」：那種失敗【兩種結果都是對的畫面】，沒有紅燈，
// 只是調校從此又要重出 build 才生效——不主動 gate 就會無聲發生。
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { computeProfiles, readPassObs, collectProfiles } from './build_run_profiles.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5490);   // 每棵樹用不同埠，避免撞到別的 session
const ENGINE = process.env.ENGINE || 'chromium';
const PROF = '/data/tra_run_profiles.json';
const MIME = { '.html': 'text/html', '.json': 'application/json', '.js': 'text/javascript',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const fails = [];
const check = (n, ok, d) => { console.log(`${ok ? '✓' : '✗'} ${n}${d ? ' · ' + d : ''}`); if (!ok) fails.push(n); };

// 比對前先把物件鍵排序：讀預算值那條路徑會【後補】h 與 obs，插入順序因此與現算不同，
// 而 JSON.stringify 照插入順序輸出。鍵序不是行為屬性（取值一律具名），拿它當差異會是假紅。
// 注意這只正規化順序，不動任何值——數值仍然是逐字比對，沒有引入容差。
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k2 => [k2, x[k2]])) : x));

// 供檔時就地弄壞剖面檔——這兩發考的是【前端新加的那段程式碼】，離線側的突變考不到它們：
//   corrupt：把每條剖面的一個折點時間挪掉 → 前端若真的在讀檔，位置就會與現算不同。
//            這比「used 計數 >0」強：計數只證明程式碼跑過，不證明讀進來的值真的被用上。
//   badL：把跑段長度改掉 → T/L 閘門應該要擋下來（stale>0），而不是拿舊剖面畫新里程。
function serveProfiles() {
  const j = JSON.parse(readFileSync(join(ROOT, 'data/tra_run_profiles.json'), 'utf8'));
  for (const tn of Object.keys(j.trains)) for (const k of Object.keys(j.trains[tn])) {
    const p = j.trains[tn][k];
    if (process.env.MUTATE === 'corrupt' && p.xs.length > 2) p.xs[1] += 7;
    if (process.env.MUTATE === 'badL') p.L += 500;
  }
  return Buffer.from(JSON.stringify(j));
}

let hideProfiles = false;
const server = createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]);
  if (hideProfiles && rel === PROF) { res.writeHead(404); res.end(); return; }
  const p = join(ROOT, normalize(rel === '/' ? '/index.html' : rel));
  if (!p.startsWith(ROOT) || !existsSync(p) || !statSync(p).isFile()) { res.writeHead(404); res.end(); return; }
  const body = (rel === PROF && (process.env.MUTATE === 'corrupt' || process.env.MUTATE === 'badL'))
    ? serveProfiles() : readFileSync(p);
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
  res.end(body);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

// 把每台台鐵車的剖面指派原樣收下來。剖面物件用「這台車內第幾條」編號，比對才對得起來。
async function boot(hide, label) {
  hideProfiles = hide;
  const browser = await ({ chromium, webkit })[ENGINE].launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/?g=tra`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.ready && (state.trains || []).length,
    null, { timeout: 90_000 });
  check(`${ENGINE}／${label} 開機無 pageerror`, errs.length === 0, errs.join('; ').slice(0, 200));
  const got = await page.evaluate(() => {
    const out = {};
    for (const tr of state.trains || []) {
      if (tr.sys !== 'tra_sched' || !tr.stops) continue;
      const profs = [], byRef = new Map();
      const stops = tr.stops.map(s => {
        if (!s.rp) return null;
        if (!byRef.has(s.rp)) { byRef.set(s.rp, profs.length); profs.push(s.rp); }
        return { i: byRef.get(s.rp), dep: s.rpDep, off: s.rpOff, km: s.rpSegKm,
          arr: s.arrSec, dsec: s.depSec, stop: s.stop !== false };
      });
      out[String(tr.train)] = { profs, stops };
    }
    return { trains: out, pre: { ..._rpPre }, hasTable: !!state.runProfiles };
  });
  await browser.close();
  return got;
}

// ── B：把剖面檔藏起來，逼前端走現算路徑（＝改動前的行為） ──────────────────────
const fresh = await boot(true, '現算');
check('藏起剖面檔時，前端確實沒讀到表', !fresh.hasTable, `runProfiles=${fresh.hasTable}`);
check('藏起剖面檔時，一條預算剖面都沒被採用（控制組）', fresh.pre.used === 0, JSON.stringify(fresh.pre));

// ── C：正常供檔，前端應該改讀預算值 ──────────────────────────────────────
const pre = await boot(false, '讀預算值');
check('正常供檔時，預算剖面真的被採用了', pre.pre.used > 0, JSON.stringify(pre.pre));
check('沒有任何一條因幾何對不上而被拒（stale=0）', pre.pre.stale === 0, `stale=${pre.pre.stale}`);

// ── (2) 讀預算值 vs 現算：使用者真正在乎的那條 ────────────────────────────
{
  let diff = 0, cmp = 0;
  const ex = [];
  for (const tn of Object.keys(fresh.trains)) {
    const a = fresh.trains[tn], b = pre.trains[tn];
    if (!b) { diff++; continue; }
    for (let k = 0; k < a.stops.length; k++) {
      cmp++;
      if (canon(a.stops[k]) !== canon(b.stops[k])) {
        diff++; if (ex.length < 3) ex.push(`${tn} 次第 ${k} 站\n    現算 ${JSON.stringify(a.stops[k])}\n    預算 ${JSON.stringify(b.stops[k])}`);
      }
    }
    for (let k = 0; k < a.profs.length; k++) {
      cmp++;
      if (canon(a.profs[k]) !== canon(b.profs[k])) {
        diff++; if (ex.length < 3) ex.push(`${tn} 次剖面 #${k}\n    現算 ${JSON.stringify(a.profs[k]).slice(0, 180)}\n    預算 ${JSON.stringify(b.profs[k]).slice(0, 180)}`);
      }
    }
  }
  check('讀預算值與現算，畫出來的每一格逐字相同', diff === 0, `比對 ${cmp} 項，不同 ${diff}`);
  if (ex.length) console.log('\n  ' + ex.join('\n  '));
}

// ── (1) 離線產物 vs 前端現算 ─────────────────────────────────────────────
const schedule = JSON.parse(readFileSync(join(ROOT, 'data/tra_schedule_dense.json'), 'utf8'));
const track = JSON.parse(readFileSync(join(ROOT, 'data/tra.json'), 'utf8'));
let passObs = readPassObs(join(ROOT, 'data/tra_pass_obs.json'));

// 突變測試：只弄壞【離線這一側】，瀏覽器那側不動＝控制組。每一發指名它要考倒哪一條。
let mutate = null;
switch (process.env.MUTATE) {
  case 'passobs':   // 考 (1)：實測資料餵錯層 → 全數退回梯形（實際踩過的那個洞）
    passObs = JSON.parse(readFileSync(join(ROOT, 'data/tra_pass_obs.json'), 'utf8')); break;
  case 'zone':      // 考 (1)：彎道速限值變了 → 只有咬得到的那幾條跑段會變
    mutate = 'SPEED_ZONES[0].v.puyuma = 120;'; break;
  case 'track':     // 考 (1) 與「貼軌幾何零差異」：少一條軌道 → 里程與跑段切法會變
    track.lines = track.lines.slice(0, -1); break;
  case 'obsfit':    // 考 (1)：實測折點整體挪 5% → 折點變、幾何不變
    for (const k of Object.keys(passObs)) {
      const o = {}; for (const [n, v] of Object.entries(passObs[k])) o[n] = v * 1.05;
      passObs[k] = o;
    } break;
  case 'corrupt': case 'badL': break;   // 在 serveProfiles() 就地弄壞供出去的檔，離線側不動
  case undefined: case '': break;
  default: throw new Error('未知的 MUTATE：' + process.env.MUTATE);
}
if (process.env.MUTATE) console.log(`\n【突變 ${process.env.MUTATE}】離線側已故意弄壞，以下應該要紅\n`);

computeProfiles({ indexPath: join(ROOT, 'index.html'), schedule, track, passObs, mutate });
const offline = {};
for (const tr of schedule.trains) {
  const profs = [], byRef = new Map();
  const stops = tr.stops.map(s => {
    if (!s.rp) return null;
    if (!byRef.has(s.rp)) { byRef.set(s.rp, profs.length); profs.push(s.rp); }
    return { i: byRef.get(s.rp), dep: s.rpDep, off: s.rpOff, km: s.rpSegKm,
      arr: s.arrSec, dsec: s.depSec, stop: s.stop !== false };
  });
  offline[String(tr.train)] = { profs, stops };
}

// 逐字比對而不是「差值 < ε」：這裡要的是【一模一樣】，不是「差不多」。同一段程式碼、
// 同一組輸入，浮點必然逐 bit 相同（實測 Node／Chromium／WebKit 三方 L 相對差 0.000e+0）；
// 不同就是移植有洞，不是誤差。訂容差等於把自己挑的數字寫成判準。
let diffStops = 0, diffProfs = 0, cmpTrains = 0, cmpProfs = 0, cmpStops = 0;
const samples = [], badTrains = new Map();
for (const [tn, L] of Object.entries(fresh.trains)) {
  const O = offline[tn];
  if (!O) continue;
  cmpTrains++;
  const rec = { stops: 0, profs: 0, geom: 0 };
  for (let k = 0; k < L.stops.length; k++) {
    cmpStops++;
    const a = L.stops[k], b = O.stops[k];
    if (canon(a) === canon(b)) continue;
    diffStops++; rec.stops++;
    // 幾何（貼軌里程／跑段切法）不同比時刻不同嚴重得多：時刻可能只是下游重鋪，
    // 幾何不同代表移植真的錯了。分開計數才看得出是哪一種。
    if (!a || !b || a.i !== b.i || a.off !== b.off || a.km !== b.km || a.dep !== b.dep) rec.geom++;
  }
  for (let k = 0; k < L.profs.length; k++) {
    cmpProfs++;
    const a = canon(L.profs[k]), b = canon(O.profs[k]);
    if (a !== b) {
      diffProfs++; rec.profs++;
      if (samples.length < 3) samples.push(`${tn} 次剖面 #${k}\n    瀏覽器 ${a.slice(0, 180)}\n    離線   ${b.slice(0, 180)}`);
    }
  }
  if (rec.stops || rec.profs) badTrains.set(tn, rec);
}

// 唯一允許缺的是環島之星（8888／8889）：它們是前端 buildLoopTrains 依站名清單【合成】的，
// 班表檔裡根本沒有這兩筆，貼軌後還會被 retimeLoopTrains 重鋪時刻。不是「我漏算」，
// 是「這個檔案裝不下它們」。判準寫成雙向：缺的必須【恰好】是這組，而且必須真的不在班表檔裡——
// 只寫「允許缺 2 台」的話，哪天真的漏算兩台真車也會照樣通過。
const SYNTH = new Set(['8888', '8889']);
const schedHas = new Set(schedule.trains.map(t => String(t.train)));
const missed = Object.keys(fresh.trains).filter(tn => !offline[tn]);
check('離線缺的車次恰好只有合成的環島之星', missed.every(t => SYNTH.has(t)),
  missed.length ? `缺 ${missed.join('／')}` : '一台都不缺');
check('那些車確實不在班表檔裡（證明是合成的、不是我漏算）',
  missed.every(t => !schedHas.has(t)), missed.map(t => `${t}:${schedHas.has(t) ? '檔裡有' : '檔裡沒有'}`).join('，'));
check('離線 vs 前端現算：每個停站節點逐字相同', diffStops === 0, `比對 ${cmpStops} 個節點，不同 ${diffStops}`);
check('離線 vs 前端現算：每條跑段剖面逐字相同', diffProfs === 0, `比對 ${cmpProfs} 條剖面（${cmpTrains} 車次），不同 ${diffProfs}`);
check('貼軌幾何（里程／跑段切法）零差異', [...badTrains].every(([, r]) => !r.geom),
  `幾何有差的車次 ${[...badTrains].filter(([, r]) => r.geom).length} 台`);

// 覆蓋率也要有具名斷言：分母會無聲縮水（同號衝突變多、obs 資料變少都會讓收錄量掉下來），
// 只把數字印在旁邊等於沒 gate。門檻取「當下實測的九成」而不是手打的常數。
const { table } = collectProfiles(schedule);
const covered = Object.keys(table).length;
check('剖面表涵蓋的車次號沒有異常縮水', covered >= 240,
  `收錄 ${covered} 個車次號（實測基準 274，門檻 240）`);

if (samples.length) console.log('\n差異樣本：\n  ' + samples.join('\n  '));
console.log(`\nFAIL ${fails.length}`);
server.close();
process.exit(fails.length ? 1 : 0);
