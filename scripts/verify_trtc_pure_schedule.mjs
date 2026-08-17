#!/usr/bin/env node
// 純班表契約驗收：使用者 2026-08-17 裁示「北捷列車位置＝班表推估，不是實際位置」。
// 契約 = 官方名冊關著時，畫面上每一台北捷列車的座標與 freqTrainPosRaw 逐 byte 相同。
//
// 這支刻意做三件別的 verify_* 沒做的事（來自 08-17 稽核的教訓）：
//   1. 自檢閘：印出樹身分與斷言總數，斷言數為 0 一律非零碼收場（五支 gate 曾死在 import
//      卻因為輸出裡沒有 FAIL 而看起來像全綠）。
//   2. 覆蓋率有具名斷言：若這一輪根本沒有任何一台車「有機會」被錨定或被 hold，
//      那 0 差異是零資訊，必須報 vacuous 而不是報過。
//   3. 探針自檢：另服務一份強制注入 300 秒校正的突變版，它必須量到偏移。
//      量不到就代表這支的比對是瞎的（第一版真的瞎過：位置是 {lat,lon} 物件卻用 [0]/[1] 取，
//      NaN > 1e-9 恆假 ⇒ 不管怎麼弄壞產品都報 0 差異）。
// 真版與突變版共用同一份凍結的 /api/trtc-live 回應，兩邊的差異只可能來自注入的校正量。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = path.join(ROOT, 'index.html');
const INDEX = fs.readFileSync(INDEX_PATH, 'utf8');
const LIVE_URL = process.env.TRTC_LIVE_URL || 'https://railisland.tw/api/trtc-live';
let failures = 0, assertions = 0;

function check(pass, label, detail = '') {
  assertions++;
  if (!pass) failures++;
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
}

function replaceExactly(source, before, after, label) {
  const pieces = source.split(before);
  if (pieces.length !== 2) throw new Error(`${label} mutation anchor 應恰好一處，實際 ${pieces.length - 1}`);
  return pieces[0] + after + pieces[1];
}

// ── 自檢閘：先證明「我讀的是哪棵樹」，再開始驗任何東西 ───────────────────────────
console.log('【自檢】');
const md5 = crypto.createHash('md5').update(INDEX).digest('hex');
console.log(`  index.html：${INDEX_PATH}`);
console.log(`  行數 ${INDEX.split('\n').length}｜md5 ${md5}｜BUILD ${(INDEX.match(/const BUILD\s*=\s*'([^']+)'/) || [])[1] || '?'}`);
check(/function trtcPureSchedule\(ln\)/.test(INDEX), '自檢：trtcPureSchedule 存在於受測樹');

// 突變體＝對北捷強制注入 300 秒校正量。這是「探針自檢」而不是產品突變：
// 它證明這支的比對真的看得見偏移。看不見就代表整份綠是零資訊，不是通過。
// 試過四種產品側突變全部無效，原因記在這裡免得後人重踩（也是這支測不了的邊界）：
//   ・拿掉 trtcHeadwayPosition 的純班表閘門：hold 要 lead 也在跑且車距已被壓縮，正常班表不觸發
//   ・放大 TRTC_BOARD_MIN_GAP_KM：wanted 被 link.km 夾住，改常數對 wanted 無效
//   ・還原 applyTrtcBoard 的 _easedShift 旁路：寫進去了但 metroShiftSec 讀那端也擋著，寫了沒人用
//   ・拿掉 metroLiveOn 的純班表早退：這個無頭 harness 裡看板幾乎綁不到班表車
//     （positions 只有個位數），沒有錨點也沒有 shift 可套 ⇒ 拿掉閘門也不會動。
//     ⚠ 所以「真版 0 差異」在這個 harness 只是弱證據；契約的強證據是對正式站的實測。
const MUTANT = replaceExactly(INDEX,
  'function metroShiftSec(ln, tr) { // ',
  'function metroShiftSec(ln, tr) { if (trtcPureSchedule(ln)) return 300; // MUTATED: 強制 300 秒校正\n  // ',
  'metroShiftSec 注入');
check(MUTANT !== INDEX && MUTANT.length !== INDEX.length, '自檢：突變版與真版確實不同');

// ── 凍結一份真實 payload，真版與突變版共用 ─────────────────────────────────────
let livePayload = null;
try {
  const res = await fetch(LIVE_URL, { headers: { 'cache-control': 'no-cache' } });
  livePayload = await res.text();
} catch (e) {
  console.log(`❌ 取不到 ${LIVE_URL}：${e.message}`);
  process.exit(1);
}
const live = JSON.parse(livePayload);
console.log(`  /api/trtc-live：${(live.boardPos?.vehicles || []).length} 台名冊、` +
  `${(live.board || []).length} 列站牌、資料齡 ${Math.round(Date.now() / 1000 - (live.boardPos?.sourceRevision || 0))}s`);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname === '/api/trtc-live') {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    return res.end(livePayload);
  }
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    const f = { '/api/thsr-schedule': 'data/thsr_schedule_dense.json' }[url.pathname];
    if (f && fs.existsSync(path.join(ROOT, f))) return res.end(fs.readFileSync(path.join(ROOT, f)));
    return res.end('{}');
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.setHeader('content-type', MIME['.html']); return res.end(INDEX);
  }
  if (url.pathname === '/mutant.html') {
    res.setHeader('content-type', MIME['.html']); return res.end(MUTANT);
  }
  const file = path.join(ROOT, url.pathname.replace(/^\//, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404; return res.end('nope');
  }
  res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

// 頁面內量測：對每一條北捷線的每一班在跑的車，比 freqTrainPosAt vs freqTrainPosRaw。
// 判準落在「畫車迴圈真的會呼叫的那個函式」，不是管線中間量（08-17 稽核：同源判準會集體失明）。
const PROBE = () => {
  const out = { lines: [], trains: 0, diffs: [], anchorable: 0, headwayLinked: 0,
    dirs: {}, pure: {}, decoScanned: 0, badShape: 0 };
  const groups = [['lines', state.lines || []], ['decoLines', state.decoLines || []]];
  for (const [groupName, arr] of groups) {
    for (const ln of arr) {
      if (typeof isTrtcBoardLine !== 'function' || !isTrtcBoardLine(ln)) continue;
      if (groupName === 'decoLines') out.decoScanned++;
      out.lines.push(`${groupName}:${ln.id}`);
      out.pure[ln.id] = trtcPureSchedule(ln);
      for (const tr of ln._tt || []) {
        const rosterTime = freqTrainTime(tr, state.simSec);
        if (rosterTime == null) continue;
        out.trains++;
        const dir = tr.dir != null ? tr.dir : (tr[0] < tr[tr.length - 2] ? 2 : 1);
        out.dirs[dir] = (out.dirs[dir] || 0) + 1;
        // 覆蓋率分母：這台車「有沒有機會」被錨定 / 被 hold
        try { if (trtcBoardPosition(ln, tr, state.simSec)) out.anchorable++; } catch (e) {}
        const board = ln._trtcBoard;
        if (board && board.headways && board.headways.get(tr)) out.headwayLinked++;
        const drawn = freqTrainPosAt(ln, tr, state.simSec);
        const raw = freqTrainPosRaw(ln, tr, rosterTime);
        if (!drawn || !raw) { if (!drawn !== !raw) out.diffs.push({ ln: ln.id, dir, kind: 'null' }); continue; }
        // 位置是 {lat, lon} 物件不是陣列——用 [0]/[1] 取會得到 undefined，
        // 比較式變成 NaN > 1e-9 恆假，整支測試會永遠報 0 差異（08-17 踩過）。
        const aLat = Number(drawn.lat), aLon = Number(drawn.lon);
        const bLat = Number(raw.lat), bLon = Number(raw.lon);
        if (!Number.isFinite(aLat) || !Number.isFinite(bLat)) { out.badShape++; continue; }
        const dLat = Math.abs(aLat - bLat), dLng = Math.abs(aLon - bLon);
        if (dLat > 1e-9 || dLng > 1e-9) {
          const m = Math.round(Math.hypot(dLat * 111320, dLng * 101000));
          out.diffs.push({ ln: ln.id, dir, m });
        }
      }
    }
  }
  return out;
};

async function probe(engine, url) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('trainmap-howto-seen', '1');
    localStorage.setItem('trainmap-appearance', 'light');
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 60000 });
  // 預設群組「全」時北捷全在 decoLines（使用者一打開網站看到的就是這條繪製路徑）；
  // 切到捷運群組後才會進 state.lines。兩條路徑各有一個畫車迴圈，兩條都要驗。
  const ready = () => [...(state.lines || []), ...(state.decoLines || [])]
    .some(l => isTrtcBoardLine(l) && l._tt && l._tt.length);
  await page.waitForFunction(ready, null, { timeout: 30000 });
  const deco = await page.evaluate(PROBE);

  const switched = await page.evaluate(() => {
    const g = (typeof GROUPS !== 'undefined' ? GROUPS : []).find(x => (x.members || []).includes('mrt'));
    if (!g) return null;
    selectGroup(g);
    return g.id;
  });
  let lines = null;
  if (switched) {
    await page.waitForFunction(() => (state.lines || []).some(l => isTrtcBoardLine(l) && l._tt && l._tt.length),
      null, { timeout: 30000 }).catch(() => {});
    lines = await page.evaluate(PROBE);
  }
  await browser.close();
  return { deco, lines, switched, errors };
}

await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;

try {
  for (const [name, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
    console.log(`\n【${name}】`);
    const real = await probe(engine, `${base}/`);
    check(real.errors.length === 0, `${name}：零 pageerror`, real.errors.slice(0, 2).join(' | '));
    check(!!real.switched, `${name}：切得到捷運群組`, String(real.switched));

    for (const [tag, r] of [['全台同框(decoLines)', real.deco], ['捷運群組(state.lines)', real.lines]]) {
      if (!r) { check(false, `${name} ${tag}：量到資料`); continue; }
      check(r.trains > 0, `${name} ${tag}：掃到在跑的北捷列車`, `${r.trains} 台／${r.lines.length} 線`);
      check(Object.keys(r.pure).length > 0 && Object.values(r.pure).every(v => v === true),
        `${name} ${tag}：每條北捷線都判定為純班表`, JSON.stringify(r.pure));
      check(Object.keys(r.dirs).length === 2, `${name} ${tag}：兩個方向都掃到`, JSON.stringify(r.dirs));
      check(r.diffs.length === 0, `${name} ${tag}：每一台車都畫在班表位置`,
        r.diffs.length ? JSON.stringify(r.diffs.slice(0, 5)) : `${r.trains} 台全等`);
    }

    const mutant = await probe(engine, `${base}/mutant.html`);
    const mDiffs = [...(mutant.deco?.diffs || []), ...(mutant.lines?.diffs || [])];
    const reach = (mutant.deco?.anchorable || 0) + (mutant.deco?.headwayLinked || 0) +
      (mutant.lines?.anchorable || 0) + (mutant.lines?.headwayLinked || 0);
    // 覆蓋率：0 差異若只是因為「本來就沒東西動得了它」，那是零資訊不是通過
    check(reach > 0, `${name}：覆蓋率非空——突變版確實有車拿得到錨點或 lead`, `可及 ${reach}`);
    check(mDiffs.length > 0, `${name}：探針自檢：強制注入 300 秒校正後必須量到偏移——證明這支看得見偏移`,
      mDiffs.length ? `${mDiffs.length} 台偏移，最大 ${Math.max(...mDiffs.map(d => d.m || 0))}m` : '突變版也 0 差異＝測試無效');
  }
} finally {
  server.close();
}

console.log(`\n斷言 ${assertions} 條，失敗 ${failures} 條`);
if (assertions === 0) { console.log('❌ 零斷言＝這支根本沒跑起來'); process.exit(2); }
process.exit(failures ? 1 : 0);
