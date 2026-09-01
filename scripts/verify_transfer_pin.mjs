#!/usr/bin/env node
// 轉乘接續:釘選互動驗收(Task 4)。真 Playwright 點擊 + 量狀態改變——elementFromPoint 只答
// 「命中誰」,答不了「做得到嗎」,所以每個「點得到」的斷言都真的點一次再讀 state/DOM。
//
// 種資料的方式:直接呼叫 setTransferConn(真正的產品函式)灌入 Task 3 已驗證過的真實案例
// (台中 T-THSR-1040,15:38 台鐵到站),不去找一班「現在剛好要到新烏日」的車去真的跟。
// 理由:Task 4 要驗的是釘選互動本身(點擊委派→setXferPin/clearXferPin→refreshXferConns→
// 重畫),推導鏈(哪一班車、算出哪個 xgid/atSec)已由 verify_transfer_connections.mjs 的 56 項
// 測試連同真實資料涵蓋。直接呼叫渲染函式灌入已知案例是本 repo 既有慣例
// (verify_station_transfer_ui.mjs 直接呼叫 updateFreqCard(...) 灌入具名案例,理由相同)。
//
// 慣例依 task-4-context.md:自帶 node:http 靜態伺服器(不用 wrangler dev,不吃 .wrangler 快取)、
// 不用全攔式 route、語系三重釘死、關首訪教學卡、pageerror 掛勾、BUILD 身分自檢。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5219);
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
    // 高鐵動態班表:回泛用 {} 會被當成「成功但形狀不對」,boot 直接對 sys.data.trains 疊代噴例外
    // (不會像 404 那樣退回 fallbackUrl)。餵真檔案內容,行為與正式站在無 token 時的退路一致。
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

// ── T0 目標自檢(先證明「我在驗誰」,不要驗到別的 worktree 或快取) ──────────────
const idxSrc = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const md5 = createHash('md5').update(idxSrc).digest('hex').slice(0, 12);
const localBuild = (idxSrc.match(/const BUILD = '([^']*)'/) || [])[1] || '?';
console.log(`\n目標: ${path.join(ROOT, 'index.html')}\n      md5=${md5}  BUILD=${localBuild}  ${idxSrc.split('\n').length} 行\n`);

const browser = await chromium.launch();
// 語系釘死(①newContext locale ②③ addInitScript 裡的 localStorage)——不釘的話文案判準
// 隨機器語系假紅,雖然本腳本不斷言文案文字,但釘死是本 repo 慣例,順手做不留隱患。
const ctx = await browser.newContext({ locale: 'zh-TW' });
await ctx.addInitScript(() => {
  localStorage.setItem('trainmap-howto-seen', '1'); // 不關首訪教學卡,卡片會蓋住地圖擋掉後續操作
  localStorage.setItem('trainmap-language', 'zh-TW');
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE-ERR: ' + m.text()); });

await page.goto(`http://localhost:${PORT}/?lang=zh-TW`, { waitUntil: 'domcontentloaded' });
try {
  await page.waitForFunction(() => {
    try { return typeof state !== 'undefined' && state.ready && !!state.transferDepartures; }
    catch (e) { return false; }
  }, null, { timeout: 30000 });
} catch (e) {
  console.log('boot 未就緒,pageerror/console-error:', errors.slice(0, 5));
  throw e;
}
const servedBuild = await page.evaluate(() => typeof BUILD !== 'undefined' ? BUILD : '?');
ok('T0 服務端 BUILD 與本機檔案一致(沒有驗到快取或別的版本)', servedBuild === localBuild, `served=${servedBuild} local=${localBuild}`);

// ── 種資料 ───────────────────────────────────────────────────────────────────
// GID_TAICHUNG/atSec 抄自 verify_transfer_connections.mjs 的 G1(已核實真實資料:THSR 成員
// 「台中」/TRA 成員「新烏日」,15:38 台鐵到站查得到 32 班 THSR、前兩班用來當「未釘選時」基準)。
const S = (h, m) => h * 3600 + m * 60;
const GID_TAICHUNG = 'T-THSR-1040';
const AT = S(15, 38);

const seed = await page.evaluate(({ gid, at }) => {
  // #fpConn 的祖先容器 #followPanel 預設 [hidden](display:none),不解开的話 Playwright 的
  // 真點擊會在 actionability 檢查(元素要可見)卡住——所以先解開,才符合「這裡本來就是使用者
  // 正在跟車、看得到這張卡」的前提,而不是隔著一層看不見的容器去點。
  document.getElementById('followPanel').hidden = false;
  setTransferConn('fpConn', gid, at, 'TRA');
  // fcConn/tcConn 也餵同一組真實資料(不必真的模擬捷運跟隨或手機列車卡開啟)——這裡要驗的是
  // refreshXferConns() 有沒有走完 xferConnArgs 這個 Map 的每一個 key,不是這兩個容器各自的
  // 產線調用點(那件事 verify_transfer_connections.mjs 的 G12/G12b 已經用原始碼比對驗過)。
  setTransferConn('fcConn', gid, at, 'TRA');
  setTransferConn('tcConn', gid, at, 'TRA');
  return {
    fp: [...document.querySelectorAll('#fpConn .xfc-row')].map(el => el.dataset.xn),
    fc: [...document.querySelectorAll('#fcConn .xfc-row')].map(el => el.dataset.xn),
    tc: [...document.querySelectorAll('#tcConn .xfc-row')].map(el => el.dataset.xn),
  };
}, { gid: GID_TAICHUNG, at: AT });
// G0 —— 先證明畫面上真的有接續區塊可點,否則後面全是空過(三個容器都要有 ≥2 列)
ok('G0 三個容器種資料後都有多於一列可點', seed.fp.length >= 2 && seed.fc.length >= 2 && seed.tc.length >= 2,
  JSON.stringify(seed));
// 反向對照:釘選前不應該有取消釘選鈕——不然「釘選後出現」就可能是「本來就在,只是沒被蓋掉」的假象。
const unpinBefore = await page.evaluate(() => document.querySelectorAll('.xfer-conn .xfc-unpin').length);
ok('G0b 釘選前沒有取消釘選鈕', unpinBefore === 0, `${unpinBefore} 顆`);

// ── G1 —— 真的點一下 #fpConn 第一列,量狀態改變 ───────────────────────────────
const row1 = page.locator('#fpConn .xfc-row').first();
const no1 = await row1.getAttribute('data-xn');
const sys1 = await row1.getAttribute('data-xs');
await row1.click();
await page.waitForFunction(() => !!window.__state.xferPin, null, { timeout: 5000 });
const pin1 = await page.evaluate(() => ({ ...window.__state.xferPin }));
ok('G1 點了真的釘住(state.xferPin.n 對得上點的那列)', pin1.n === no1, `點的=${no1} 釘的=${pin1.n}`);
ok('G1b 釘住的 sys 也對得上', pin1.sys === sys1, `點的=${sys1} 釘的=${pin1.sys}`);

// ── G2 —— 釘選後 #fpConn 只剩那一班(2026-09-01 裁示) ─────────────────────────
const after1 = await page.evaluate(() => [...document.querySelectorAll('#fpConn .xfc-row')].map(e => e.dataset.xn));
ok('G2 只剩一列', after1.length === 1, `${after1.length} 列`);
ok('G2b 剩的是點的那一班', after1[0] === no1, `${after1[0]} vs ${no1}`);
// G2c —— 釘選態 show 只有一列 ⇒ headSys 恆為 null ⇒ 逐列小標一定要出現(task-4-brief.md 已指出
// 這一點,不是「釘選後沒有小標」;寫成正向斷言防止有人把這個行為誤改)。
const hasSysTag1 = await page.evaluate(() => !!document.querySelector('#fpConn .xfc-sys'));
ok('G2c 釘選態仍有 xfc-sys 逐列小標(headSys 恆 null)', hasSysTag1);
// G2d —— 取消釘選鈕出現、且只有一顆(不是每次重畫疊加)
const unpinAfter1 = await page.evaluate(() => document.querySelectorAll('#fpConn .xfc-unpin').length);
ok('G2d 釘選後出現取消釘選鈕(且只有一顆)', unpinAfter1 === 1, `${unpinAfter1} 顆`);

// ── G7 —— 三個顯示實例同步:另外兩個容器也該收斂成同一班 ─────────────────────
// 證明 refreshXferConns() 真的走了 Map 裡的每一個 key,不是寫死某一個 id 就交差。
const synced = await page.evaluate(() => ({
  fc: [...document.querySelectorAll('#fcConn .xfc-row')].map(e => e.dataset.xn),
  tc: [...document.querySelectorAll('#tcConn .xfc-row')].map(e => e.dataset.xn),
}));
ok('G7 fcConn 三實例同步(也只剩釘選那班)', synced.fc.length === 1 && synced.fc[0] === no1, JSON.stringify(synced.fc));
ok('G7b tcConn 三實例同步(也只剩釘選那班)', synced.tc.length === 1 && synced.tc[0] === no1, JSON.stringify(synced.tc));

// ── G3 —— 取消釘選回得去(三個容器都要回去) ───────────────────────────────────
await page.locator('#fpConn .xfc-unpin').click();
await page.waitForFunction(() => !window.__state.xferPin, null, { timeout: 5000 });
const after2 = await page.evaluate(() => ({
  fp: [...document.querySelectorAll('#fpConn .xfc-row')].map(e => e.dataset.xn),
  fc: [...document.querySelectorAll('#fcConn .xfc-row')].map(e => e.dataset.xn),
  tc: [...document.querySelectorAll('#tcConn .xfc-row')].map(e => e.dataset.xn),
  unpinGone: document.querySelectorAll('.xfer-conn .xfc-unpin').length,
}));
ok('G3 取消後 fpConn 回到原本列數', after2.fp.length === seed.fp.length, `${after2.fp.length} vs 原 ${seed.fp.length}`);
ok('G3b 取消後內容與原本逐項相同(不是碰巧列數一樣)',
  JSON.stringify(after2.fp) === JSON.stringify(seed.fp), `${JSON.stringify(after2.fp)} vs ${JSON.stringify(seed.fp)}`);
ok('G3c 取消後 fcConn/tcConn 也回到原狀', JSON.stringify(after2.fc) === JSON.stringify(seed.fc) &&
  JSON.stringify(after2.tc) === JSON.stringify(seed.tc), JSON.stringify(after2));
ok('G3d 取消釘選鈕整個消失(三個容器都沒有)', after2.unpinGone === 0, `${after2.unpinGone} 顆`);

// ── G4 —— 點按鈕內的子元素也要能觸發(closest 真的有在冒泡路徑上找,不是只認按鈕本身) ──
// 點第二列的 .xfc-no(車次數字那個 span 本身),不是整顆按鈕的空白處。
const row2 = page.locator('#fpConn .xfc-row').nth(1);
const no2 = await row2.getAttribute('data-xn');
ok('G4pre 第二列與第一列不是同一班(換一班測試才有意義)', no2 !== no1, `${no2} vs ${no1}`);
await row2.locator('.xfc-no').click();
await page.waitForFunction(() => !!window.__state.xferPin, null, { timeout: 5000 });
const pin2 = await page.evaluate(() => window.__state.xferPin.n);
ok('G4 點按鈕內的子元素(.xfc-no)一樣能釘住,而且是點的那一班', pin2 === no2, `點的=${no2} 釘的=${pin2}`);
await page.locator('#fpConn .xfc-unpin').click();
await page.waitForFunction(() => !window.__state.xferPin, null, { timeout: 5000 });

ok('Z 頁面零例外', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();
const bad = results.filter(r => !r.pass);
console.log(`\n總計 ${results.length - bad.length}/${results.length} 通過`);
if (bad.length) { console.log('未過:'); bad.forEach(r => console.log('  - ' + r.name + (r.detail ? '  — ' + r.detail : ''))); }
process.exit(bad.length ? 1 : 0);
