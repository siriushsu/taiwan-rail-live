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

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

// 🔴 每個案例各抓一份新的。整套跑完要五分鐘以上，若共用啟動時抓的那一份，
// 後段案例拿到的是老掉好幾分鐘的快照——車全部續推到很遠、支線全停，對照組會無故變紅
// （2026-08-17 Codex 複審抓到：正常 census 對照被誤判整線凍結，整套 exit 1）。
let livePayload = '{}';
const refreshLive = async () => {
  try { livePayload = await (await fetch(LIVE_URL, { headers: { 'cache-control': 'no-cache' } })).text(); }
  catch (e) { console.log(`❌ 取不到 ${LIVE_URL}：${e.message}`); process.exit(2); }
};
await refreshLive();

function serve(html) {
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/api/trtc-live') {
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
const cases = [
  ['對照組（原始碼）', INDEX, 0, ''],
  ...Object.entries(INJECT).map(([k, v]) => [`突變：${k}`, INDEX.replace(ANCHOR, v), 1, '']),
  // 對照組也要跑一次 census 版，證明紅的是突變不是 census 本身
  ['對照組（census）', INDEX, 0, '?census=1'],
  ['突變：lineGone', INDEX.replace(CENSUS_ANCHOR, CENSUS_INJECT), 1, '?census=1'],
];

for (const [name, html, wantCode, qs] of cases) {
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
