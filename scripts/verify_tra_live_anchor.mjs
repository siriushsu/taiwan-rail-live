// 台鐵 TrainLiveBoard 站點錨點驗收。
//
// 要守的不變量：
//   1. 同號重複列不再由「最後一筆」決定，陣列兩種排序都取較大誤點。
//   2. 第一次看到 StationID 不冒充新事件；後續確實換站且 status=2 才建錨點。
//   3. 已有漸變條目遇到可信過站錨點時，+4 分（小於原本 5 分門檻）也立即回到 240 秒偏移。
//   4. 沒有換站時仍保留慢速吸收，不把所有小誤點都變成瞬移。
//   5. 班表里程遞增／遞減兩方向各一班，同一條錨點邏輯都成立。
//
// 用法：node scripts/verify_tra_live_anchor.mjs
import { createRequire } from 'module';
import { createHash } from 'crypto';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.ROOT || path.join(HERE, '..'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.geojson': 'application/geo+json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
let port = Number(process.env.PORT);
let server = null;
if (!port) {
  server = createServer((q, s) => {
    const u = new URL(q.url, 'http://x');
    let fp = path.join(ROOT, decodeURIComponent(u.pathname));
    if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
    if (u.pathname.startsWith('/api/') || !path.resolve(fp).startsWith(ROOT + path.sep) || !fs.existsSync(fp)) {
      s.statusCode = 404; return s.end();
    }
    s.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
    s.end(fs.readFileSync(fp));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
}

const require = createRequire(fs.existsSync(path.join(ROOT, 'node_modules/playwright'))
  ? path.join(ROOT, 'package.json') : '/Users/xuxiang/Code/捷運小動畫/package.json');
const playwright = require('playwright');
const engine = process.env.ENGINE || 'chromium';
if (!playwright[engine]) throw new Error(`不支援的 ENGINE=${engine}`);
const disk = fs.readFileSync(path.join(ROOT, 'index.html'));
const served = Buffer.from(await (await fetch(`http://127.0.0.1:${port}/index.html`)).arrayBuffer());
if (createHash('md5').update(disk).digest('hex') !== createHash('md5').update(served).digest('hex')) {
  throw new Error('受測 server 提供的不是當前工作樹');
}

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await playwright[engine].launch();
const page = await browser.newPage();
page.on('pageerror', e => console.error('PAGEERROR', e.message));
await page.route('**/*tra-live*', route => route.abort());
await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof state !== 'undefined' && state.stnInfoMap
  && state.trains && state.trains.some(t => t.sys === 'tra_sched' && t.stops?.some(s => s.segLn && s.dA != null && s.dB != null)),
  null, { timeout: 180000 });

const out = await page.evaluate(() => {
  const traSys = state.systems.find(s => s.id === 'tra_sched');
  state.mode = 'sched';
  state.schedSystems = [{ ...(traSys || {}), id: 'tra_sched', live: '/api/tra-live' }];
  state.playing = false;
  nowSecOfDay = () => state.simSec;

  const codeOf = stop => ((state.stnInfoMap || {})[traStnKey(stop.name)] || {}).id || null;
  const picked = new Map();
  for (const tr of state.trains) {
    if (tr.sys !== 'tra_sched' || tr.loop) continue;
    for (let i = 0; i + 1 < tr.stops.length; i++) {
      const a = tr.stops[i], b = tr.stops[i + 1];
      const dir = a.segLn && Math.sign(a.dB - a.dA);
      const aCode = codeOf(a), bCode = codeOf(b);
      if (!dir || !aCode || !bCode || aCode === bCode || !(b.depSec > a.depSec)) continue;
      if (!picked.has(dir)) picked.set(dir, { tr, dir, a, b, aCode, bCode });
      if (picked.has(1) && picked.has(-1)) break;
    }
    if (picked.has(1) && picked.has(-1)) break;
  }

  const isoAt = sec => new Date(Date.UTC(2026, 8, 18, 16) * 1 + sec * 1000).toISOString(); // 9/19 台北零時，可自然跨日
  const reset = () => {
    _traLiveStationObs.clear(); _easedShift.clear();
    _traGateEp.on = true; _traGateEp.ep += 1; _traGateEp.at = performance.now() - 10000;
  };
  const apply = (atSec, trains) => {
    const stats = applyTraLivePayload({ at: isoAt(atSec), trains });
    state.live.srcMs = null; // 本格驗錨點邏輯，資料齡另有 verify_live_freshness 專責
    state.live.at = Date.now(); state.simSec = atSec;
    return stats;
  };

  const dirs = [];
  for (const dir of [1, -1]) {
    const p = picked.get(dir);
    if (!p) { dirs.push({ dir, missing: true }); continue; }
    reset();
    const firstSec = p.a.depSec + 60 + 20;
    apply(firstSec, [{ no: p.tr.train, delay: 1, sta: p.aCode, status: 2 }]);
    const firstObs = state.live.obs.get(String(p.tr.train));
    const firstShift = liveDelaySec(p.tr); // 已關掉 gate 初始 5 秒窗：1 分首見從 0 慢速吸收

    const secondSec = p.b.depSec + 4 * 60 + 30;
    apply(secondSec, [{ no: p.tr.train, delay: 4, sta: p.bCode, status: 2 }]);
    const before = trainPosAt(p.tr, state.simSec - firstShift);
    const secondObs = state.live.obs.get(String(p.tr.train));
    const secondShift = liveDelaySec(p.tr);
    const after = trainPosAt(p.tr, state.simSec - secondShift);
    const movedM = before && after ? haversineKm(before, after) * 1000 : null;
    dirs.push({ dir, train: String(p.tr.train), firstAnchored: firstObs.anchored, firstShift,
      secondAnchored: secondObs.anchored, secondShift, stopIndex: secondObs.stopIndex,
      elapsedSec: secondObs.elapsedSec, movedM });
  }

  // 同站、同 status：即使 delay 1→4，沒有新過站證據就不觸發瞬間校正。
  const sameP = picked.get(1) || picked.get(-1);
  let same = null;
  if (sameP) {
    reset();
    const sec = sameP.a.depSec + 80;
    apply(sec, [{ no: sameP.tr.train, delay: 1, sta: sameP.aCode, status: 2 }]);
    const first = liveDelaySec(sameP.tr);
    apply(sec + 2, [{ no: sameP.tr.train, delay: 4, sta: sameP.aCode, status: 2 }]);
    const obs = state.live.obs.get(String(sameP.tr.train));
    const next = liveDelaySec(sameP.tr);
    same = { first, next, anchored: obs.anchored };
  }

  // 最大值規則必須與陣列順序無關，且異常分母只算唯一車次。
  const no = sameP ? String(sameP.tr.train) : '9999';
  const sta = sameP ? sameP.aCode : '1000';
  const d1 = apply(12 * 3600, [{ no, delay: 6, sta, status: 2 }, { no, delay: 5, sta, status: 2 }]);
  const v1 = state.live.map.get(no);
  const d2 = apply(12 * 3600 + 60, [{ no, delay: 5, sta, status: 2 }, { no, delay: 6, sta, status: 2 }]);
  const v2 = state.live.map.get(no);

  // 與台鐵撞號的高鐵不可讀到台鐵錨點／誤點。
  const fakeHsr = sameP ? { ...sameP.tr, sys: 'thsr_sched' } : null;
  const hsrShift = fakeHsr ? liveDelaySec(fakeHsr) : null;
  return { dirs, same, duplicate: { v1, v2, total1: d1.total, total2: d2.total, delayed1: d1.delayed }, hsrShift };
});

check('A 里程遞增與遞減方向都找到真實班次', out.dirs.length === 2 && out.dirs.every(x => !x.missing), JSON.stringify(out.dirs));
for (const row of out.dirs) {
  if (row.missing) continue;
  const label = row.dir > 0 ? '里程遞增' : '里程遞減';
  check(`B ${label}：首見站點不冒充錨點`, row.firstAnchored === false && row.firstShift === 0,
    `車次 ${row.train}，anchored=${row.firstAnchored}，shift=${row.firstShift}`);
  check(`C ${label}：換站 status=2 將 +4 分立即對齊`, row.secondAnchored === true && Math.abs(row.secondShift - 240) < 1e-6,
    `車次 ${row.train}，elapsed=${row.elapsedSec}，shift=${row.secondShift}`);
  check(`D ${label}：校正真的改變列車地圖位置`, row.movedM != null && row.movedM > 1,
    `車次 ${row.train}，位移 ${row.movedM == null ? '無位置' : row.movedM.toFixed(1) + 'm'}`);
}
check('E 沒有換站時 +4 分仍慢速吸收', out.same && !out.same.anchored && out.same.next > 0 && out.same.next < 240,
  JSON.stringify(out.same));
check('F 同號重複列兩種排序都取誤點較大的 6 分', out.duplicate.v1 === 6 && out.duplicate.v2 === 6,
  JSON.stringify(out.duplicate));
check('G 重複列不膨脹列車總數與誤點班數', out.duplicate.total1 === 1 && out.duplicate.total2 === 1 && out.duplicate.delayed1 === 1,
  JSON.stringify(out.duplicate));
check('H 高鐵等非 live 系統不讀台鐵同號車錨點', out.hsrShift === 0, `shift=${out.hsrShift}`);

await browser.close();
if (server) await new Promise(resolve => server.close(resolve));
const failed = results.filter(x => !x.pass);
console.log(`\n${failed.length ? 'FAIL' : 'PASS'} ${engine} ${results.length - failed.length}/${results.length}`);
if (failed.length) process.exit(1);
