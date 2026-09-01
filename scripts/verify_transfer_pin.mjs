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

// ── G8 —— 真實產線路徑,不繞過生產呼叫點 ───────────────────────────────────────
// G0–G7 種資料的方式是直接呼叫 setTransferConn(見檔頭說明),這樣測得到「釘選互動」本身,
// 但測不到「production 到底有沒有在正確的地方呼叫 setTransferConn」——如果
// updateFollowPanel 裡 setTransferConn('tcConn', …) 那一行被誤刪,G0–G7 完全不會發現
// (因為我們自己就直接呼叫過 tcConn 了,從沒依賴那一行)。這裡另外補一段:抓一班真的會停
// 新烏日的台鐵車(T-THSR-1040 的 TRA 成員,Task 3 的 G8 已核實 station_transfers.json 與
// transfer_departures.json 共用同一個群 id),撥模擬時鐘到它到站前,開 body.train-open
// (觸發 tcConn 那個呼叫點的 if 分支),直接呼叫 updateFollowPanel(tr)——這是 production
// 本尊,不是 stub。
const real = await page.evaluate(() => {
  const sys = state.systems.find(s => s.id === 'tra_sched');
  loadSystem(sys);
  const tr = state.trains.find(t => t.stops.some(s => s.stop !== false && s.name === '新烏日'));
  if (!tr) return { ok: false, reason: '找不到會停新烏日的台鐵車' };
  const idx = tr.stops.findIndex(s => s.name === '新烏日');
  state.followTrain = tr; state.followId = tr.train;
  // 到站前 60 秒(不能拉太長:前一站可能只離新烏日 1-2 分,拉到 300 秒會落在「上一站還沒到」
  // 的區間,nextStopInfo 會回上一站而非新烏日,xgid 就會解到錯的轉乘群——已用探針實測驗證)。
  state.simSec = tr.stops[idx].arrSec - 60;
  state.clockAtNow = false;
  state.playing = false; // 停止模擬時鐘前進(不影響下面這段結論,但仍是正確的測試前提)
  document.getElementById('followPanel').hidden = false;
  document.body.classList.add('train-open');
  updateFollowPanel(tr); // production 本尊,不是灌入 stub
  // updateFollowCamera() 在主 tick 迴圈裡不受 state.playing 節流,每一幀都會再呼叫一次
  // updateFollowPanel(state.followTrain),於是 #fpConn/#tcConn 整段 innerHTML 每幀被換掉一次
  // ——實測會讓 Playwright 的點擊在按下與放開之間目標「被偵測到已從 DOM 卸離」而重試到逾時。
  // 上面那次呼叫已經是我們要驗的「production 呼叫點是否存在」,資料也已經讀進回傳值;
  // 這裡把 followTrain 清空只是不讓相機迴圈接著替我們重播——不影響已經量到的 real.fp/real.tc。
  state.followTrain = null;
  return {
    ok: true, train: tr.train,
    fp: [...document.querySelectorAll('#fpConn .xfc-row')].map(e => e.dataset.xn),
    tc: [...document.querySelectorAll('#tcConn .xfc-row')].map(e => e.dataset.xn),
  };
});
ok('G8 真實產線路徑:真的一班車 + updateFollowPanel,fpConn 收到接續資料',
  real.ok && real.fp.length >= 1, JSON.stringify(real));
ok('G8b tcConn 也收到(這行斷言如果被刪掉呼叫點,會在這裡就地現形,不必依賴 G0–G7)',
  real.ok && real.tc.length >= 1 && JSON.stringify(real.tc) === JSON.stringify(real.fp), JSON.stringify(real));

// G8c —— 用真實產線路徑填出來的列去點,釘選一樣生效、tcConn 一樣同步收斂
if (real.ok && real.fp.length && real.tc.length) {
  const rowR = page.locator('#fpConn .xfc-row').first();
  const noR = await rowR.getAttribute('data-xn');
  await rowR.click();
  await page.waitForFunction(() => !!window.__state.xferPin, null, { timeout: 5000 });
  const tcAfterPin = await page.evaluate(() => [...document.querySelectorAll('#tcConn .xfc-row')].map(e => e.dataset.xn));
  ok('G8c 真實路徑下釘選後 tcConn 也同步收斂成同一班', tcAfterPin.length === 1 && tcAfterPin[0] === noR, JSON.stringify(tcAfterPin));
  await page.locator('#fpConn .xfc-unpin').click();
  await page.waitForFunction(() => !window.__state.xferPin, null, { timeout: 5000 });
} else {
  ok('G8c 真實路徑下釘選後 tcConn 也同步收斂成同一班', false, '前置 G8/G8b 未成立,無法測(見上方 detail)');
}

// ── G9/G9b —— Finding A:釘選不可跨轉乘群外溢(2026-09-01 修復輪1) ────────────────
// 真實資料核實(node 抽取 transferConnections 直接對 data/transfer_departures.json 跑):
// THSR 0841 同時是 T-THSR-1000(89 班候選,自然 top2=1208/2233,不含 0841)與
// T-THSR-1060(29 班候選,自然 top2=0838/0658,不含 0841)兩個群的候選——0841 不在任一群
// 的自然 top2,無法靠點一顆自然渲染出來的列觸發,所以直接呼叫 setXferPin(production 本尊,
// 不是點擊模擬)把它釘進 T-THSR-1000 這一群。
const AT_A = S(15, 38);
const before9 = await page.evaluate(({ gidA, gidB, at }) => {
  setTransferConn('fpConn', gidA, at, null);
  setTransferConn('fcConn', gidB, at, null);
  return {
    fp: [...document.querySelectorAll('#fpConn .xfc-row')].map(e => e.dataset.xn),
    fc: [...document.querySelectorAll('#fcConn .xfc-row')].map(e => e.dataset.xn),
  };
}, { gidA: 'T-THSR-1000', gidB: 'T-THSR-1060', at: AT_A });
ok('G9pre 兩容器種了不同轉乘群、且都不是碰巧已含 0841(測試前提成立)',
  before9.fp.length >= 2 && before9.fc.length >= 2 &&
  !before9.fp.includes('0841') && !before9.fc.includes('0841'), JSON.stringify(before9));

const after9 = await page.evaluate(() => {
  setXferPin('T-THSR-1000', '0841', 'THSR');
  return {
    fp: [...document.querySelectorAll('#fpConn .xfc-row')].map(e => e.dataset.xn),
    fc: [...document.querySelectorAll('#fcConn .xfc-row')].map(e => e.dataset.xn),
    fpUnpin: document.querySelectorAll('#fpConn .xfc-unpin').length,
    fcUnpin: document.querySelectorAll('#fcConn .xfc-unpin').length,
  };
});
// 正向對照:先證明真的會收斂,不是「怎麼點都不動」讓下面那條假安全通過。
ok('G9 釘選在自己那一群(T-THSR-1000)裡生效', after9.fp.length === 1 && after9.fp[0] === '0841' && after9.fpUnpin === 1,
  JSON.stringify(after9));
// Finding A 核心斷言:pinned 比對式拿掉 g===groupId 會讓這裡轉紅(T-THSR-1060 也會誤收斂成 0841)。
ok('G9b 不外溢到別的轉乘群(T-THSR-1060 維持原狀、無取消釘選鈕)',
  JSON.stringify(after9.fc) === JSON.stringify(before9.fc) && after9.fcUnpin === 0, JSON.stringify(after9));
await page.evaluate(() => clearXferPin());

// ── G10 —— Finding B:fcConn 唯一正式呼叫點(updateFreqCard,index.html:10172) ──────
// G0–G8c 種 fcConn 都是直接呼叫 setTransferConn,測不到「updateFreqCard 裡有沒有正確呼叫
// setTransferConn('fcConn', …)」這件事——審查實測刪掉那一行,21/21 仍全線。這裡改走真實
// 捷運跟隨路徑:loadSystem('mrt')→BL 線→直接呼叫 updateFreqCard(production 本尊),引數抄自
// verify_station_transfer_ui.mjs 既有驗證過的組合(「台北車站」經 transferAnchorNear 正規化
// 解到 gid=T-THSR-1000,已用 probe 核實 nextSec=63060 下有 93 筆候選、非空)。
const freq10 = await page.evaluate(() => {
  // ⚠️ 先強制清空 fcConn(G9 已經種過 T-THSR-1060 留下 ["0838","0658"])——不清空的話,
  // 如果 index.html:10172 那行被刪掉,updateFreqCard 根本不會碰 fcConn,斷言會讀到 G9
  // 留下的舊內容誤判「非空」而通過。清到跟開機時一樣的初始態,才能確定接下來讀到的東西
  // 一定是這次 updateFreqCard 呼叫本身寫進去的(第一次跑就親自撞見這個假陽性,已修正)。
  const fc = document.getElementById('fcConn');
  fc.innerHTML = ''; fc.hidden = true;
  loadSystem(state.systems.find(s => s.id === 'mrt'));
  const ln = (state.lines || []).find(l => l.id === 'BL');
  if (!ln) return { ok: false, reason: '找不到 BL 線' };
  state.freqFollow = { ln, k: 0 };
  document.getElementById('freqCard').hidden = false;
  updateFreqCard({ nextName: '台北車站', nextSec: 63060, loop: false, termName: '南港展覽館' });
  return { ok: true, fc: [...document.querySelectorAll('#fcConn .xfc-row')].map(e => e.dataset.xn) };
});
ok('G10 真實產線路徑(updateFreqCard→fcConn)收到接續資料(刪掉 index.html:10172 那行會在這裡就地現形)',
  freq10.ok && freq10.fc.length >= 1, JSON.stringify(freq10));

// ── G11 —— Finding C:同車次號、不同系統的釘選消歧(2026-09-01 修復輪1) ─────────────
// 真實資料核實:T-THSR-1000 群裡車次「1238」同時是 THSR(sec=61020)與 TRA(sec=67500)兩筆
// 獨立候選,AT_C=58000 落在 [56700,61020] 之間確保兩筆同時在 3 小時窗內。rows 依 sec 升冪
// 排序,若 pinned 比對式拿掉 && r.sys===xferPin.sys,rows.find 只認車次號會先比對到時間較早
// 的 THSR 那筆——即便釘的明明是 TRA。
const AT_C = 58000;
const before11 = await page.evaluate(({ gid, at }) => {
  setTransferConn('fpConn', gid, at, null);
  return [...document.querySelectorAll('#fpConn .xfc-row')].map(e => e.dataset.xn);
}, { gid: 'T-THSR-1000', at: AT_C });
ok('G11pre 種好 T-THSR-1000 @ AT_C(測試前提:容器有資料可看)', before11.length >= 1, JSON.stringify(before11));

const after11 = await page.evaluate(() => {
  setXferPin('T-THSR-1000', '1238', 'TRA');
  return [...document.querySelectorAll('#fpConn .xfc-row')].map(e => ({ n: e.dataset.xn, sys: e.dataset.xs }));
});
ok('G11 釘選同車次號時依 sys 消歧(拿掉 r.sys 比對會在這裡轉紅——會誤收斂成時間較早的 THSR 1238)',
  after11.length === 1 && after11[0].n === '1238' && after11[0].sys === 'TRA', JSON.stringify(after11));
await page.evaluate(() => clearXferPin());

ok('Z 頁面零例外', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();
const bad = results.filter(r => !r.pass);
console.log(`\n總計 ${results.length - bad.length}/${results.length} 通過`);
if (bad.length) { console.log('未過:'); bad.forEach(r => console.log('  - ' + r.name + (r.detail ? '  — ' + r.detail : ''))); }
process.exit(bad.length ? 1 : 0);
