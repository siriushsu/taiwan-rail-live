// GPS 路段收集懸賞 前端驗收（規格 `打卡收集系統設計_GPS懸賞_2026-07-27.html`）
// 跑法：node verify_bounty.mjs [base]   預設 base=http://127.0.0.1:5178
//
// 判準來源刻意與實作不同源（心得 29）：
//   ・旅程卡的端點與段數 → 測試自己從塞進去的假 board 回應算，不呼叫 bountyCardName()
//   ・上傳 payload 不含經緯度 → 正向掃 key，不是抽查特定欄位
//   ・按鈕可不可按 → elementFromPoint 命中，不是量 rect（心得 33）
//   ・門檻一致性 → 用同一批座標序列，比對客端訊號燈與 data/bounty_rules.json 的門檻
import { chromium, webkit, devices } from 'playwright';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const BASE = process.argv[2] || 'http://127.0.0.1:5178';
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const RULES = JSON.parse(readFileSync('data/bounty_rules.json', 'utf8'));

// ── G0 自檢：先確認「我到底在驗哪一份檔案」──────────────────────────────
// 心得 32：驗收腳本吃「驗哪個目錄」的參數時，第一道 gate 就要印出目標並斷言它等於腳本自己
// 所在的那棵樹。2026-07-26 實際踩到：在主 repo 跑腳本、:5178 服務的卻是 worktree，全綠但驗錯樹。
{
  const diskMd5 = createHash('md5').update(readFileSync('index.html')).digest('hex');
  let servedMd5 = '(抓不到)';
  try {
    const buf = Buffer.from(await (await fetch(BASE + '/index.html')).arrayBuffer());
    servedMd5 = createHash('md5').update(buf).digest('hex');
  } catch (e) { servedMd5 = '(fetch 失敗: ' + e.message + ')'; }
  const same = diskMd5 === servedMd5;
  ok('G0 驗的是本腳本所在的那棵樹（server 回的 index.html 與磁碟逐 byte 相同）', same,
    `BASE=${BASE}　cwd=${process.cwd()}　磁碟 ${diskMd5.slice(0, 8)}　server ${servedMd5.slice(0, 8)}`);
  if (!same) {
    console.log('\n中止：server 服務的不是這份 index.html。帶對 port 再跑，例如 node verify_bounty.mjs http://127.0.0.1:<你的port>');
    process.exit(1);
  }
}

// ── 假的後端：計畫 B 的端點還沒部署也能驗前端 ──────────────────────────
// 用 page.route 攔截，回的形狀逐字照計畫 B 的〈API 契約〉。契約改了這裡要同步改，
// 而「同步改」正是這份 stub 存在的價值——它讓契約不一致變成一個會紅的測試，不是一個上線才發現的驚喜。
// 🔴 lnId 從 brief 草稿的 'NH'/'WL' 改成真實可解析的 lineNetwork() id（'南迴線'/'宜蘭線'）：
// 實測發現 lineNetwork() 的線 id 是完整中文名（見 index.html:8826 lineNetwork() 讀 ln.id，
// 資料來自 data/tra.json），不是兩碼英文縮寫；'NH'/'WL' 在真實資料裡查無此線,
// bountyCardName 會整條掉進 fallback。segKey(sys, lnId, a, b) 直接把 ln.id 嵌進計價單位的
// key 字串（index.html:8777），所以真實後端傳回的 lnId 極可能就是這個中文 id 本身。
// '南迴線'／39 點與 brief 自己舉的例子「枋寮→台東 南迴線 39 點」完全對上，
// 這組數字很可能就是brief 作者當初想表達的那張卡，只是 lnId 縮寫沒對到真實資料。
const BOARD = {
  at: 1700000000000,
  coverN: { TRA: 1, THSR: 1, metro: 3 },
  cards: [
    { id: 'TRA|南迴線|0|自強|track|', sys: 'TRA', lnId: '南迴線', dir: 0, trainKind: '自強', kind: 'track', slot: '',
      unitKeys: [], units: 13, points: 39, claimers: 2, samples: 0, coverN: 1 },
    { id: 'TRA|宜蘭線|0|區間|track|', sys: 'TRA', lnId: '宜蘭線', dir: 0, trainKind: '區間', kind: 'track', slot: '',
      unitKeys: [], units: 40, points: 40, claimers: 0, samples: 0, coverN: 1 },
  ],
};
async function stubApi(ctx, over = {}) {
  await ctx.route('**/api/bounty-board*', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(over.board || BOARD) }));
  await ctx.route('**/api/bounty-claim', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(over.claim || { ok: true, claimId: 'cl-1', units: 13, pointsLocked: 39,
      expiresAt: Date.now() + 86400000, claimers: 3 }) }));
  await ctx.route('**/api/bounty-submit', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, id: 'bs-1', verdict: 'pending', accepted: 60 }) }));
  await ctx.route('**/api/bounty-me*', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(over.me || { actor: 'dev-x', points: 0, corrected: { segs: 0, adopted: 0 },
      lines: [], firsts: [], trips: [] }) }));
}

// app：注入「真正會讓 IS_NATIVE_APP 判定為 true」的 global；web：不注入
// 🔴 這裡沒有逐字照抄 brief 草稿裡「只設 window.RAIL_APP_CONFIG」的寫法——實測
// （node 探針，開兩個 context 直接讀 IS_NATIVE_APP/PHYSICAL_COLLECT_ENABLED）證實只設
// RAIL_APP_CONFIG 時 PHYSICAL_COLLECT_ENABLED 仍是 false，跟網頁模式沒有差別。
// index.html 的 IS_NATIVE_APP 讀的是 RAIL_ONLINE_BASEMAPS_AVAILABLE（或 Capacitor），
// 不是 RAIL_APP_CONFIG 本身——這正是 verify_checkin.mjs 已經踩過並修好的坑（該檔案
// APP_BUILD_GLOBALS 上方的註解：「IS_NATIVE_APP 曾經是 !!window.RAIL_APP_CONFIG…
// 舊 fixture 注入的是假形狀」）。沿用該檔案已驗證正確的 licensed 組合，
// 並保留 platform/build 兩個欄位（沒有壞處，以防日後有程式碼讀它們）。
async function open(browser, { app = false, width = 1440, height = 900, touch = false, geo = null, over = {} } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height }, hasTouch: touch,
    ...(geo ? { permissions: ['geolocation'], geolocation: geo } : {}),
  });
  if (app) await ctx.addInitScript(() => {
    Object.assign(window, { RAIL_MUSIC_AVAILABLE: true, RAIL_ONLINE_BASEMAPS_AVAILABLE: true,
      RAIL_APP_CONFIG: { platform: 'ios', build: 'test' } });
  });
  await stubApi(ctx, over);
  const page = await ctx.newPage();
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, { timeout: 40000 });
  await page.evaluate(() => { const h = document.getElementById('howtoWrap'); if (h) h.remove(); });
  return { ctx, page };
}

const browser = await chromium.launch();

// ── A 組：懸賞板旅程卡 ────────────────────────────────────────────────────
{
  const { ctx, page } = await open(browser, { app: true });

  const a1 = await page.evaluate(async () => {
    await openBountyBoard();
    const m = document.getElementById('bountyModal');
    const takeBtn = document.querySelector('.bt-card .bt-take');
    return { hidden: m.hidden, parent: m.parentElement.tagName, cards: document.querySelectorAll('.bt-card').length,
      physicalEnabled: PHYSICAL_COLLECT_ENABLED, takeBtnText: takeBtn ? takeBtn.textContent : '' };
  });
  // A0 是本檔對 brief 草稿唯一的實質偏離所需要的自我驗證：確認上面 open() 的 app fixture
  // 真的讓 App 情境判定為 App，不是巧合通過（心得 32 的精神——先確認驗的是什麼情境）。
  ok('A0 App fixture 真的讓 PHYSICAL_COLLECT_ENABLED=true（不是只設 RAIL_APP_CONFIG 就以為算數）',
    a1.physicalEnabled === true, `physicalEnabled=${a1.physicalEnabled}`);
  ok('A1 懸賞板開得起來且有兩張卡', a1.hidden === false && a1.cards === 2, JSON.stringify(a1));
  // 🔴 浮層一律放 body 層：.stage 會把 z2200 封頂成 1000（index.html:2926 的既有註解）
  ok('A2 modal 掛在 body 層不是 .stage 裡', a1.parent === 'BODY', a1.parent);
  ok('A2b App 端按鈕文字是「接下這段」（驗證 A0 的修正真的影響到 renderBountyBoard 的渲染分支，' +
    '不是只影響一個獨立變數）', /接下這段/.test(a1.takeBtnText), a1.takeBtnText);

  // A3 端點名由前端從 lineNetwork() 算——判準：測試自己拿該線的站列取里程極值
  // 🔴 這裡刻意餵 sys:'TRA'（bounty_rules.json／stub 用的計畫 B bucket 代碼），不是
  // rec.sys（lineNetwork() 內部 id 'tra_sched'）——原 brief 草稿餵的是 rec.sys，等於拿
  // bountyCardName 自己吃得下的值去測自己，恆真通過，測不到「伺服器代碼→前端代碼」這段映射。
  // 實測踩到的真 bug：不映射的話卡面會顯示「NH → 」這種內部代碼而不是站名（見下方 A4b）。
  // 期望值仍然是測試自己從 lineNetwork() 獨立算的，不呼叫 bountyCardName 內部邏輯。
  const a3 = await page.evaluate(() => {
    const rec = [...lineNetwork().values()].find(r => r.sys === 'tra_sched');
    if (!rec) return { skip: true };
    const keys = rec.segs.slice(0, 5).map(s => s.key);
    const got = bountyCardName({ sys: 'TRA', lnId: rec.id, unitKeys: keys, units: keys.length });
    // 期望：這 5 段的所有端點站裡，里程最小與最大的那兩座
    const names = new Set();
    for (const s of rec.segs.slice(0, 5)) { names.add(s.a); names.add(s.b); }
    const sts = rec.ln.stations.filter(s => names.has(s.name)).slice().sort((x, y) => x.d - y.d);
    return { got, wantFrom: sts[0].name, wantTo: sts[sts.length - 1].name, lineName: rec.name };
  });
  ok('A3 旅程卡端點＝該批段的里程極值兩站（餵伺服器 sys 代碼 TRA，測伺服器→前端映射；期望值測試自己算）',
    a3.skip || (a3.got.from === a3.wantFrom && a3.got.to === a3.wantTo), JSON.stringify(a3));

  // A4 卡面要看得到點數與「已有 N 人接了這段」（那是資訊不是禁令）
  const a4r = await page.evaluate(() => document.querySelector('.bt-card .bt-r').textContent);
  const a4 = await page.evaluate(() => document.querySelector('.bt-card').innerText);
  ok('A4 卡面有點數', /39\s*點/.test(a4), a4.replace(/\n/g, ' / '));
  // A4b 卡面端點是真的站名，不是掉進 fallback 印出內部代碼：stub 卡是 { sys:'TRA', lnId:'南迴線' }，
  // 若映射或線 id 對不上，renderBountyBoard 會落回 bountyCardName 的 fallback、直接把 lnId 整條
  // 線名印上卡面且 to 端留空（"南迴線 → "）。獨立判準：from/to 兩端都要非空，且卡面要出現
  // 「枋寮」或「臺東」（南迴線兩端真實站名，brief 自己舉的例子）而不是線名本身。
  ok('A4b 卡面端點是真的站名，不是掉進 fallback 印出內部代碼（線名）',
    /^\S+\s*→\s*\S+$/.test(a4r.trim()) && !a4r.trim().startsWith('南迴線') &&
    (a4r.includes('枋寮') || a4r.includes('臺東') || a4r.includes('台東')), a4r.trim());
  ok('A5 卡面有「已有 2 人」', /已有\s*2\s*人/.test(a4), a4.replace(/\n/g, ' / '));
  ok('A6 沒人接的那張不顯示人數（0 人不是資訊）', !/已有\s*0\s*人/.test(
    await page.evaluate(() => document.querySelectorAll('.bt-card')[1].innerText)));

  // 🔴 A7 判準是「點它會發生什麼」不是幾何（心得 33）
  const a7 = await page.evaluate(() => {
    const btn = document.querySelector('.bt-card .bt-take');
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { hit: hit === btn || btn.contains(hit), tag: hit && hit.className };
  });
  ok('A7 App 端「接下這段」點得到（elementFromPoint 命中）', a7.hit === true, JSON.stringify(a7));
  await ctx.close();
}

// A8–A10：網頁端看得到、接不了（規格 §9，這是下載誘因）
{
  const { ctx, page } = await open(browser, { app: false });
  const a8 = await page.evaluate(async () => {
    await openBountyBoard();
    const btn = document.querySelector('.bt-card .bt-take');
    return { cards: document.querySelectorAll('.bt-card').length, btnText: btn ? btn.innerText : '(沒有鈕)' };
  });
  ok('A8 網頁端一樣看得到懸賞板與卡', a8.cards === 2, JSON.stringify(a8));
  ok('A9 網頁端的鈕改成「要用 App」不是「接下這段」', /App/.test(a8.btnText), a8.btnText);
  // 🔴 bountyClaim() 是 async（內部 await fetch），onclick handler 又不 await 它——
  // 若只在 click() 後同一個 evaluate() 裡「同步」讀 loadBounty()，測到的永遠是「還沒寫入」，
  // 跟 guard 在不在無關（突變測試親自證實：把 guard 拆掉，這樣寫法仍然 19/19 全過，A10 沒抓到）。
  // 必須等非同步鏈真正有機會落地，才能驗證「即使等了也還是零寫入」。
  await page.evaluate(() => { document.querySelector('.bt-card .bt-take').click(); });
  await page.waitForTimeout(500);
  const a10 = await page.evaluate(() => ({ claimed: !!(loadBounty().claims && Object.keys(loadBounty().claims).length) }));
  ok('A10 網頁端點下去不會真的接下（等非同步落地後仍是本機零寫入）', a10.claimed === false, JSON.stringify(a10));
  await ctx.close();
}

// A11：護照多一節「校正貢獻」，且兩個平台都在（觀看面不因平台消失）
{
  for (const app of [true, false]) {
    const { ctx, page } = await open(browser, { app });
    const has = await page.evaluate(() => {
      localStorage.setItem('trainmap-passport-open', '1');
      renderPassport();
      return !!document.querySelector('#passport [data-sec="correct"]');
    });
    ok(`A11${app ? 'a' : 'b'} 護照有「校正貢獻」節（${app ? 'App' : '網頁'}）`, has === true);
    await ctx.close();
  }
}

// A12：手機護照 sheet（#ridePanel，#tabRide 實際走的路徑）也要有入口——既有契約：手機用
// renderRidePanel() 走另一條 render 路徑，不是 #passport 的縮小版（verify_checkin.mjs E3 同一個
// 既有斷言精神）。brief 的 Step 6 只點名 renderPassport()，但 buildLineBars 等既有節一律「桌面
// #passport 與護照 sheet #ridePanel 單一事實來源」（index.html:8612 附近註解），只接桌面會讓手機
// 使用者在護照裡找不到懸賞板入口，故本檔額外驗兩邊都有——這行斷言直接對應 index.html 裡我方多做的
// 那兩處 buildCorrectSection() 接線（renderRidePanel 的 stamps 組合與 onclick）。
{
  const { ctx, page } = await open(browser, { app: true, width: 375, height: 812, touch: true });
  const m = await page.evaluate(() => {
    localStorage.setItem('trainmap-checkins-v1', JSON.stringify({ v: 1, st: {}, sg: {} }));
    document.getElementById('howtoWrap')?.remove();
    openRidePanel();
    const h = document.querySelector('#ridePanel [data-sec="correct"]');
    if (h) h.scrollIntoView({ block: 'center' });
    return { has: !!h };
  });
  await page.waitForTimeout(200);
  const hit = await page.evaluate(() => {
    const btn = document.querySelector('#ridePanel [data-act="bountyboard"]');
    if (!btn) return { found: false };
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { found: true, hit: el === btn || btn.contains(el) };
  });
  ok('A12 手機護照 sheet(#ridePanel) 也有「校正貢獻」節', m.has === true, JSON.stringify(m));
  ok('A12b 手機上懸賞板入口鈕真的點得到（elementFromPoint 命中，真觸控 context 375 寬）',
    hit.found && hit.hit === true, JSON.stringify(hit));
  if (hit.found && hit.hit) {
    await page.evaluate(() => document.querySelector('#ridePanel [data-act="bountyboard"]').scrollIntoView({ block: 'center' }));
    const btnBox = await page.evaluate(() => {
      const b = document.querySelector('#ridePanel [data-act="bountyboard"]').getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await page.touchscreen.tap(btnBox.x, btnBox.y);
    await page.waitForTimeout(300);
    const opened = await page.evaluate(() => !document.getElementById('bountyModal').hidden);
    ok('A12c 真觸控點下去懸賞板真的開起來', opened === true);
  } else {
    ok('A12c 真觸控點下去懸賞板真的開起來', false, '上一步未命中，略過但記為 FAIL');
  }
  await ctx.close();
}

const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
await browser.close();
process.exit(pass === R.length ? 0 : 1);
