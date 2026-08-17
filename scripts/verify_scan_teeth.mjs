#!/usr/bin/env node
// scan_map_health 的控制組：把 2026-08-17 上午使用者實際看到的兩個症狀注射回去，
// 確認掃描器真的抓得到。沒有這支，「掃描全綠」只證明掃描器沒壞掉地跑完，不證明它有眼睛。
//
// 注射兩種（都用 metroShiftSec，因為上午的真根因就是它——k×班距 的錯配校正量）：
//   clump    ：一半的車套 900 秒校正 ⇒ 被拖回起點與另一半疊在一起（使用者的截圖形態）
//   backward ：校正量隨牆鐘增長 ⇒ 位置隨時間往回走（使用者說的「倒退跑」）
//   lineGone ：名冊整包換成逐車清單而不保留它蓋不到的線 ⇒ 環狀線整條消失
//              （2026-08-17 使用者實際回報「現在環狀線都沒車」的那個缺陷；當時四項判準
//               全綠，總車數只掉 17 台也在容許區間內——所以它必須自己是一條判準）
// 兩種都必須讓 scan 以離開碼 1 收場；任一種沒被抓到，就是掃描器在那個維度上是瞎的。
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const LIVE_URL = process.env.TRTC_LIVE_URL || 'https://railisland.tw/api/trtc-live';
const ANCHOR = 'function metroShiftSec(ln, tr) { // ';

const INJECT = {
  // 一半的車被拖回 15 分鐘前的位置 ⇒ 與正常那半疊在一起
  clump: `function metroShiftSec(ln, tr) { if (trtcPureSchedule(ln)) {
    const i = (ln._tt || []).indexOf(tr); return i % 2 === 0 ? 900 : 0; } // `,
  // 校正量成長速度快過牆鐘（3 秒/秒）⇒ 車沿線往回退。
  // 注意：若只用 1 秒/秒，shifted = rosterTime - sh 恆定 ⇒ 車靜止不動，那是「凍結」不是「倒退」，
  // 會驗不到倒退這個維度（第一版就是這樣，掃描器報 0 台倒退卻通過）。
  backward: `function metroShiftSec(ln, tr) { if (trtcPureSchedule(ln))
    return 200 + (Date.now() / 1000 * 3) % 1200; // `,
};

// 這一發要走 ?census=1 才碰得到合併那段碼，且改的是別的錨點。
const CENSUS_ANCHOR = 'const covered = new Set(built.map(v => v.line));';
const CENSUS_INJECT = 'const covered = new Set(((state.lines||[]).concat(state.decoLines||[])).map(l => l.id));';

// rosterStale：拿掉支線 run 補值 ⇒ 兩站支線車一前進成 from≠to，run 仍是 0，名冊驗證器
// 整包退掉 payload ⇒ 車照舊時間線繼續跑（動得很順），疊車／倒退／凍結／車數／整條線不見
// 五條全綠，只有「名冊有沒有換新」照得到（2026-08-17 實測全綠 148 秒的那個缺陷）。
const REPAIR_ANCHOR = '  if (Array.isArray(boardPos.vehicles)) // ROSTER_FRONTEND_REPAIR_RUN\n' +
  '    boardPos = { ...boardPos, vehicles: boardPos.vehicles.map(trtcOfficialRosterRepairRun) };';
// 🔴 光是「不補 run」是**資料相依**的突變：那一刻兩台支線車若都剛好停在端點（from===to），
// payload 本來就合法 ⇒ 突變零效果 ⇒ 案例以對照組的身分假綠通過（2026-08-17 實測踩到一次：
// 同一支突變 16:0x 抓得到、17:1x 抓不到）。改成「不補 run ＋ 保證有一台 from≠to 而 run=0 的車」，
// 讓它與上游此刻剛好有幾台支線車在跑無關。
// 這一發同時仍在驗「補值有沒有接上」：補值若還在，它會把這台合成違規車一併補好 ⇒ 綠。
const REPAIR_INJECT = '  if (Array.isArray(boardPos.vehicles) && boardPos.vehicles.length)\n' +
  '    boardPos = { ...boardPos, vehicles: boardPos.vehicles.map((v, i) =>\n' +
  '      i === 0 ? { ...v, from: 0, to: 1, run: 0 } : v) };';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

// 🔴 每個案例各抓一份新的。整套跑完要五分鐘以上，若共用啟動時抓的那一份，
// 後段案例拿到的是老掉好幾分鐘的快照——車全部續推到很遠、支線全停，對照組會無故變紅
// （2026-08-17 Codex 複審抓到：正常 census 對照被誤判整線凍結，整套 exit 1）。
let livePayload = '{}';
// 整套要跑七分鐘，中間一次暫時性的網路失誤就 exit 2 ⇒ 整輪判不出「環境」還是「回歸」。重試三次。
let liveAt = 0;
const refreshLive = async () => {
  for (let i = 1; i <= 3; i++) {
    try {
      livePayload = await (await fetch(LIVE_URL, { headers: { 'cache-control': 'no-cache' } })).text();
      liveAt = Date.now();
      return;
    } catch (e) {
      console.log(`⚠️ 取 ${LIVE_URL} 第 ${i} 次失敗：${e.message}`);
      if (i === 3) { console.log('❌ 三次都取不到，環境問題，非產品回歸'); process.exit(2); }
      await new Promise(r => setTimeout(r, 4000));
    }
  }
};
await refreshLive();

function serve(html) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/api/trtc-live') {
      // 🔴 不可以整個案例都餵同一份 payload。頁面每 60 秒重抓一次，若每次都拿到同一份，
      //    car 的 arrEpoch 全部凍在過去而牆鐘一直走 ⇒ census builder 會推出驗證器不收的幾何，
      //    未突變的對照組也會被判 malformed（2026-08-17 實測：凍結時控制組紅，同一份程式碼
      //    對真上游跑則全綠 ⇒ 那個紅是 harness 造的，不是產品）。所以逾時就重抓。
      if (Date.now() - liveAt > 20000) await refreshLive();
      res.setHeader('content-type', 'application/json'); return res.end(livePayload);
    }
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('content-type', 'application/json');
      const f = { '/api/thsr-schedule': 'data/thsr_schedule_dense.json' }[url.pathname];
      if (f && fs.existsSync(path.join(ROOT, f))) return res.end(fs.readFileSync(path.join(ROOT, f)));
      return res.end('{}');
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.setHeader('content-type', MIME['.html']); return res.end(html);
    }
    const file = path.join(ROOT, decodeURIComponent(url.pathname).replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.statusCode = 404; return res.end('nope');
    }
    res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
}

function runScan(url) {
  return new Promise(resolve => {
    const p = spawn('node', [path.join(ROOT, 'scripts/scan_map_health.mjs'), url, '--gap', '22'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('close', code => resolve({ code, out }));
  });
}

let failures = 0, assertions = 0;
const check = (pass, label, detail = '') => {
  assertions++; if (!pass) failures++;
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
};

// 對照組：未突變的原始碼必須全綠。它若也是紅的，後面兩個紅就沒有鑑別力。
//
// 🔴 每個案例的 query string 必須跟「這一發注射的那段碼現在跑不跑得到」對齊，否則突變是空包彈：
//    clump／backward 注射在 metroShiftSec 的 `trtcPureSchedule(ln)` 分支 ⇒ 要**純班表**模式；
//    lineGone／rosterStale 注射在逐車名冊的合併與 run 補值 ⇒ 要 `?census=1`。
//    2026-08-17 這顆旗標的預設值當天翻了兩次（早上關→傍晚開→晚上又關），每翻一次都要
//    重新問一遍這件事；當天就踩過一次「預設開啟後 clump 那兩發等於什麼都沒改」的假綠。
//    現行預設＝純班表（位置維持班表推估，名冊路徑要 ?census=1 才開）。
const PURE = '';            // 預設就是純班表
const CENSUS = '?census=1'; // 逐車名冊路徑
// 🔴 已知狀態（2026-08-17 晚）：`對照組（?census=1 逐車名冊）` **目前預期會紅**，原因是
//    逐車名冊路徑有一個未解的同向疊車（防倒退把前車 hold 住、後車追上）。那條路徑
//    **沒有出貨**（正式站預設純班表），根因正在另案追。判讀規則：
//      - `對照組（預設＝純班表）` 紅 ⇒ 真的有回歸，出貨路徑壞了，停手。
//      - `對照組（?census=1）` 紅且訊息是疊車 ⇒ 已知未解，不是新回歸。
//      - `對照組（?census=1）` 紅但訊息**不是**疊車（例如 malformed）⇒ 新問題，要查。
//    疊車修好後把這段註解刪掉，並要求該對照組轉綠。
const cases = [
  ['對照組（預設＝純班表）', INDEX, 0, PURE],
  ...Object.entries(INJECT).map(([k, v]) => [`突變：${k}`, INDEX.replace(ANCHOR, v), 1, PURE]),
  ['對照組（?census=1 逐車名冊）', INDEX, 0, CENSUS],
  ['突變：lineGone', INDEX.replace(CENSUS_ANCHOR, CENSUS_INJECT), 1, CENSUS],
  ['突變：rosterStale', INDEX.replace(REPAIR_ANCHOR, REPAIR_INJECT), 1, CENSUS],
];
// 錨點打錯字＝突變其實沒注射進去，案例會以「對照組」的身分假綠通過（心得 37 同族）。
for (const [label, anchor] of [['ANCHOR', ANCHOR], ['CENSUS_ANCHOR', CENSUS_ANCHOR], ['REPAIR_ANCHOR', REPAIR_ANCHOR]])
  if (!INDEX.includes(anchor)) { console.log(`❌ ${label} 在 index.html 找不到，突變不會生效`); process.exit(2); }

// 迭代用：--only <子字串> 只跑名稱含該字串的案例（整套要七分鐘,改一條判準不必全跑）。
// 🔴 只跑一條時**必須**連對照組一起跑,否則「紅」分不出是突變被抓到還是整體壞了。
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i >= 0 ? process.argv[i + 1] : null; })();
const picked = ONLY ? cases.filter(c => c[0].includes(ONLY) || c[0].includes('對照組')) : cases;
if (ONLY) console.log(`（--only ${ONLY}：跑 ${picked.length} 個案例，含對照組）`);
for (const [name, html, wantCode, qs] of picked) {
  if (html === INDEX && wantCode === 1) { check(false, `${name}：突變沒套上（anchor 找不到）`); continue; }
  await refreshLive();
  const server = serve(html);
  await new Promise((r, j) => { server.once('error', j); server.listen(0, '127.0.0.1', r); });
  const url = `http://127.0.0.1:${server.address().port}/${qs}`;
  const { code, out } = await runScan(url);
  server.close();
  const summary = out.split('\n').filter(l => /^[✅❌]/.test(l)).join('　');
  check(code === wantCode, `${name}：掃描離開碼應為 ${wantCode}，實際 ${code}`, summary.slice(0, 240));
}

console.log(`\n斷言 ${assertions} 條，失敗 ${failures} 條`);
if (assertions === 0) { console.log('❌ 零斷言＝沒跑起來'); process.exit(2); }
process.exit(failures ? 1 : 0);
