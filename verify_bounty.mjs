// GPS 路段收集懸賞 前端驗收（規格 `打卡收集系統設計_GPS懸賞_2026-07-27.html`）
// 跑法：node verify_bounty.mjs [base]   預設 base=http://127.0.0.1:5178
//
// 判準來源刻意與實作不同源（心得 29）：
//   ・旅程卡的端點與段數 → 測試自己從塞進去的假 board 回應算，不呼叫 bountyCardName()
//   ・上傳 payload 不含經緯度 → 正向掃 key，不是抽查特定欄位
//   ・按鈕可不可按 → elementFromPoint 命中，不是量 rect（心得 33）
//   ・門檻一致性 → Task 5（即時品質提示／「客端訊號燈」）之後才會有：現在客端根本沒有這個
//     UI 可比對，RULES 先留著只是佔位（見下面 RULES 宣告旁的註記）
import { chromium, webkit, devices } from 'playwright';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const BASE = process.argv[2] || 'http://127.0.0.1:5178';
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
// 中止時也要留下 N/M（2026-07-28 Codex 審查 F-11）：把 index.html 的必要 DOM id 改壞（例如
// recStop）會讓 top-level 綁定在開機就丟例外 ⇒ 開機等待逾時 ⇒ 整份腳本中止，既沒有斷言名、
// 也沒有總計行，看的人分不出「哪一條行為壞了」還是「腳本自己爆了」。這個 exit hook 讓任何
// 中止路徑至少都印得出當下的 N/M，open() 那邊則把 pageerror 原文帶進錯誤訊息裡指出真因。
let summaryPrinted = false;
const printSummary = () => {
  if (summaryPrinted) return;
  summaryPrinted = true;
  console.log(`\n${R.filter(r => r.p).length}/${R.length} 通過`);
};
process.on('exit', printSummary);
// 最終審查 E-4：載入後目前沒有任何斷言使用它——Task 4/5(取樣上傳／即時品質提示)還沒做，
// 客端根本沒有可比對的「訊號燈」。不要因為現在沒消費者就刪掉：Task 5 一旦把即時提示接上，
// 這裡就是拿門檻值來比對的既有掛勾，先留著、只是暫時不用。
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
// 🔴🔴 2026-07-28 Task 1 審查糾正（協調者拍板）：上面那次修正只對了一半。card.sys 仍錯——
// 懸賞卡的鍵空間＝前端收集系統既有的鍵空間，segKey(sys,lnId,a,b) 產出的區間鍵長這樣
// 'tra_sched|南迴線|加祿|枋寮'（實測 lineNetwork() 對 tra_sched|南迴線 印出的第一把 key 逐字元
// 相同）——sys 桶代碼從來就是 SYS_DEFS id 本身（'tra_sched'/'thsr_sched'/'afr_sched'，沒有
// metro），不是 'TRA' 這種兩三碼縮寫。Task 1 實作者的 BOUNTY_SYS_MAP（'TRA'→'tra_sched'）是
// 自己想像出來的映射層，即將被刪掉；這裡不跟著它錯，sys 與 unitKeys 一律用實測值。
// unitKeys 也不能留空——空陣列讓 bountyCardName 掉進「沒有 want 集合＝全線」的分支，會巧合算對
// 但測不到 unitKeys 真的被拿去過濾這件事。以下兩條線的 key 都是實測 lineNetwork() 吐出來的
// 全線 segs（南迴線 11 段、宜蘭線 26 段），units 改成真實總段數（原本 13／40 超過真實線長，
// 不可能存在）。
const BOARD = {
  at: 1700000000000,
  coverN: { TRA: 1, THSR: 1, metro: 3 },
  cards: [
    { id: 'tra_sched|南迴線|0|自強|track|', sys: 'tra_sched', lnId: '南迴線', dir: 0, trainKind: '自強', kind: 'track', slot: '',
      unitKeys: [
        'tra_sched|南迴線|加祿|枋寮', 'tra_sched|南迴線|內獅|加祿', 'tra_sched|南迴線|內獅|枋山',
        'tra_sched|南迴線|枋山|枋野', 'tra_sched|南迴線|大武|枋野', 'tra_sched|南迴線|大武|瀧溪',
        'tra_sched|南迴線|瀧溪|金崙', 'tra_sched|南迴線|太麻里|金崙', 'tra_sched|南迴線|太麻里|知本',
        'tra_sched|南迴線|康樂|知本', 'tra_sched|南迴線|康樂|臺東',
      ], units: 11, points: 39, claimers: 2, samples: 0, coverN: 1 },
    { id: 'tra_sched|宜蘭線|0|區間|track|', sys: 'tra_sched', lnId: '宜蘭線', dir: 0, trainKind: '區間', kind: 'track', slot: '',
      unitKeys: [
        'tra_sched|宜蘭線|蘇澳|蘇澳新', 'tra_sched|宜蘭線|新馬|蘇澳新', 'tra_sched|宜蘭線|冬山|新馬',
        'tra_sched|宜蘭線|冬山|羅東', 'tra_sched|宜蘭線|中里|羅東', 'tra_sched|宜蘭線|中里|二結',
        'tra_sched|宜蘭線|二結|宜蘭', 'tra_sched|宜蘭線|四城|宜蘭', 'tra_sched|宜蘭線|四城|礁溪',
        'tra_sched|宜蘭線|礁溪|頂埔', 'tra_sched|宜蘭線|頂埔|頭城', 'tra_sched|宜蘭線|外澳|頭城',
        'tra_sched|宜蘭線|外澳|龜山', 'tra_sched|宜蘭線|大溪|龜山', 'tra_sched|宜蘭線|大溪|大里',
        'tra_sched|宜蘭線|大里|石城', 'tra_sched|宜蘭線|石城|福隆', 'tra_sched|宜蘭線|福隆|貢寮',
        'tra_sched|宜蘭線|貢寮|雙溪', 'tra_sched|宜蘭線|牡丹|雙溪', 'tra_sched|宜蘭線|三貂嶺|牡丹',
        'tra_sched|宜蘭線|三貂嶺|猴硐', 'tra_sched|宜蘭線|猴硐|瑞芳', 'tra_sched|宜蘭線|四腳亭|瑞芳',
        'tra_sched|宜蘭線|四腳亭|暖暖', 'tra_sched|宜蘭線|八堵|暖暖',
      ], units: 26, points: 40, claimers: 0, samples: 0, coverN: 1 },
  ],
};
async function stubApi(ctx, over = {}) {
  await ctx.route('**/api/bounty-board*', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(over.board || BOARD) }));
  await ctx.route('**/api/bounty-claim', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(over.claim || { ok: true, claimId: 'cl-1', units: 11, pointsLocked: 39,
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
  const perr = [];
  page.on('pageerror', e => perr.push(String((e && e.message) || e)));
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  // 開機沒完成時把 pageerror 原文帶出來（F-11）：光看「waitForFunction timeout」分不出
  // 是資料載入慢還是 index.html 在 top-level 就丟例外（必要 DOM id 被改名就是這一種）。
  try {
    await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, { timeout: 40000 });
  } catch (e) {
    throw new Error('開機沒完成（40s 內 state.trains 仍為空）'
      + (perr.length ? `；頁面丟出例外：${perr.slice(0, 2).join(' ｜ ')}` : '；期間沒有 pageerror'));
  }
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
  // 🔴🔴 2026-07-28 更正（Task 1 審查／協調者拍板）：此處原本刻意餵 sys:'TRA'，理由寫著
  // 「測伺服器→前端映射」——這個理由本身是錯的。實測 lineNetwork() 對 tra_sched|南迴線 吐出的
  // 第一把 key 逐字元等於 'tra_sched|南迴線|加祿|枋寮'：懸賞卡的鍵空間就是前端收集系統既有的
  // 鍵空間，伺服器從來不會傳 'TRA' 這種桶代碼給 card.sys，BOUNTY_SYS_MAP 是憑空想像出來的映射層
  // （即將被刪除）。這裡改回餵 rec.sys（真實值 'tra_sched'），不是「拿 bountyCardName 吃得下的值
  // 測自己」的恆真寫法——是餵「伺服器實際會傳的值」。期望值仍然是測試自己從 lineNetwork() 獨立算的，
  // 不呼叫 bountyCardName 內部邏輯。
  const a3 = await page.evaluate(() => {
    const rec = [...lineNetwork().values()].find(r => r.sys === 'tra_sched');
    if (!rec) return { skip: true };
    const keys = rec.segs.slice(0, 5).map(s => s.key);
    const got = bountyCardName({ sys: rec.sys, lnId: rec.id, unitKeys: keys, units: keys.length });
    // 期望：這 5 段的所有端點站裡，里程最小與最大的那兩座
    const names = new Set();
    for (const s of rec.segs.slice(0, 5)) { names.add(s.a); names.add(s.b); }
    const sts = rec.ln.stations.filter(s => names.has(s.name)).slice().sort((x, y) => x.d - y.d);
    return { got, wantFrom: sts[0].name, wantTo: sts[sts.length - 1].name, lineName: rec.name };
  });
  // 最終審查 D:改成 !a3.skip &&(…)——原本 a3.skip ||(…)在 fixture 線 id 解析不到時整條自動
  // true,這條正是守 Task 1 鍵空間裁定的斷言,不該在解析失敗時悄悄放行。
  ok('A3 旅程卡端點＝該批段的里程極值兩站（餵伺服器實際傳的 sys 值 tra_sched；期望值測試自己算）',
    !a3.skip && (a3.got.from === a3.wantFrom && a3.got.to === a3.wantTo), JSON.stringify(a3));

  // C1b（審查 C1 糾正的補充斷言）：餵一張逐值等同 BOARD.cards[0] 契約形狀的卡直接測 bountyCardName()——
  // 不透過 DOM 渲染（那是 A4b 在測的路徑），直接測函式本身在真實契約輸入下不會掉進 fallback。
  // 期望值不是抄 bountyCardName 怎麼算，是從 lineNetwork() 用 unitKeys 集合獨立反推「這批鍵覆蓋的
  // 站當中里程最小/最大是誰」——跟 A3 同一套邏輯，但這次餵的是完整契約形狀的真實 unitKeys（11 段整批），
  // 不是隨手切的前 5 段，且直接斷言等於具體站名（枋寮/臺東），不只是「非空」。
  // 突變測試：把 bountyCardName() 裡的 card.sys + '|' + card.lnId 改回 card.lnId（拿掉 sys 前綴），
  // 這條必須 FAIL（掉進 fallback，from 變回線名「南迴線」、to 變空字串）。
  const c1b = await page.evaluate((card) => {
    const got = bountyCardName(card);
    const rec = [...lineNetwork().values()].find(r => r.sys === card.sys && r.id === card.lnId);
    if (!rec) return { skip: true, got };
    const want = new Set(card.unitKeys);
    const names = new Set();
    for (const s of rec.segs) if (want.has(s.key)) { names.add(s.a); names.add(s.b); }
    const sts = rec.ln.stations.filter(s => names.has(s.name)).slice().sort((x, y) => x.d - y.d);
    return { got, wantFrom: sts[0].name, wantTo: sts[sts.length - 1].name };
  }, BOARD.cards[0]);
  // 最終審查 D:同上,改成 !c1b.skip &&(…)——這條守的是 Task 1 鍵空間裁定本身,解析不到 rec
  // 時不該悄悄放行,必須明確判 FAIL。
  ok('C1b 完整契約形狀的卡直接測 bountyCardName()，不掉進 fallback（枋寮 → 臺東，不是內部代碼或線名）',
    !c1b.skip && (c1b.got.from === c1b.wantFrom && c1b.got.to === c1b.wantTo &&
      c1b.got.from === '枋寮' && c1b.got.to === '臺東'), JSON.stringify(c1b));

  // A4 卡面要看得到點數與「已有 N 人接了這段」（那是資訊不是禁令）
  const a4r = await page.evaluate(() => document.querySelector('.bt-card .bt-r').textContent);
  const a4 = await page.evaluate(() => document.querySelector('.bt-card').innerText);
  ok('A4 卡面有點數', /39\s*點/.test(a4), a4.replace(/\n/g, ' / '));
  // 最終審查 E-3：stub 卡的 sys 早已改成鍵空間裁定後的 'tra_sched'（見上面 BOARD 定義），
  // 這裡原本仍寫著改前的 'TRA'——斷言本身沒錯，只是註解沒跟著更新。
  // A4b 卡面端點是真的站名，不是掉進 fallback 印出內部代碼：stub 卡是 { sys:'tra_sched', lnId:'南迴線' }，
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

  // I3（審查）：#bountyModal 是六顆既有 modal 家族裡唯一沒有 Esc／背景關閉／ARIA 屬性的一顆——
  // 實測 afterEsc=false、afterBackdrop=false，只有 × 有效。比照 setupTakeoutUi 等既有六顆
  // modal 的寫法補齊，這裡各補一條斷言。放在 A7 之後、ctx.close() 之前，因為 I3b/I3c 會把
  // modal 關掉，要留到不再需要「modal 保持開著」的斷言（A3–A7）都跑完才做。
  const i3a = await page.evaluate(() => {
    const box = document.querySelector('#bountyModal .tk-box');
    const titleId = box && box.getAttribute('aria-labelledby');
    const titleEl = titleId && document.getElementById(titleId);
    const x = document.getElementById('bountyClose');
    return {
      role: box && box.getAttribute('role'), ariaModal: box && box.getAttribute('aria-modal'),
      hasTitle: !!(titleEl && titleEl.textContent.trim()), xAriaLabel: x && x.getAttribute('aria-label'),
    };
  });
  ok('I3a #bountyModal 有 role=dialog/aria-modal/aria-labelledby（指向真實標題），關閉鈕有 aria-label="關閉"',
    i3a.role === 'dialog' && i3a.ariaModal === 'true' && i3a.hasTitle === true && i3a.xAriaLabel === '關閉',
    JSON.stringify(i3a));

  const i3b = await page.evaluate(() => {
    const m = document.getElementById('bountyModal');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    return { hidden: m.hidden };
  });
  ok('I3b 按 Esc 可以關閉 #bountyModal', i3b.hidden === true, JSON.stringify(i3b));

  // 上一條已經把 modal 關掉了，重開一次才能驗背景點擊
  await page.evaluate(() => openBountyBoard());
  const i3c = await page.evaluate(() => {
    const m = document.getElementById('bountyModal');
    m.dispatchEvent(new MouseEvent('click', { bubbles: true })); // 直接 dispatch 在 m 本身＝target 就是背景
    return { hidden: m.hidden };
  });
  ok('I3c 點背景可以關閉 #bountyModal', i3c.hidden === true, JSON.stringify(i3c));

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
  // 若只在 click() 後同一個 evaluate() 裡「同步」讀 state，測到的永遠是「還沒寫入」，跟 guard
  // 在不在無關（突變測試親自證實：把 guard 拆掉，這樣寫法仍然 19/19 全過，A10 沒抓到）。
  // 必須等非同步鏈真正有機會落地，才能驗證「即使等了也還是零寫入」。
  // 🔴🔴 審查 M10 糾正：原本用實作自己的 loadBounty() 判「零寫入」——判準與實作同源（心得 29），
  // 若哪天寫錯 key（例如打錯字寫進 'trainmap-bounty-v2' 而不是 loadBounty() 真正讀的 key），
  // loadBounty() 讀到的仍是空的，這條測試照樣綠燈。改成不透過實作、直接對整包 localStorage
  // 前後快照逐 key 比對——任何一個 key 的值有變、或多出新 key，都會被抓到。
  const snapLS = () => page.evaluate(() => {
    const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); }
    return o;
  });
  const lsBefore = await snapLS();
  await page.evaluate(() => { document.querySelector('.bt-card .bt-take').click(); });
  await page.waitForTimeout(500);
  const lsAfter = await snapLS();
  ok('A10 網頁端點下去不會真的接下（整包 localStorage 前後快照比對，判準不靠 loadBounty() 自己解讀）',
    JSON.stringify(lsBefore) === JSON.stringify(lsAfter), JSON.stringify({ before: lsBefore, after: lsAfter }));
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

// I2（審查）：桌面「📍 懸賞板」入口鈕的點擊接線——A11a/A11b 只驗「節存在」，沒驗「鈕點得下去」。
// 實測：把 renderPassport() onclick 裡 [data-act="bountyboard"] 那行整行刪掉，全部斷言依然全綠，
// 桌面入口變死鈕而測試無感。這裡補：真的用 elementFromPoint 命中後再 click，確認懸賞板真的開起來
// （跟 A12/A12b/A12c 的手機版是同一件事的桌面版）。
{
  const { ctx, page } = await open(browser, { app: true });
  const hit = await page.evaluate(() => {
    localStorage.setItem('trainmap-passport-open', '1');
    renderPassport();
    const btn = document.querySelector('#passport [data-act="bountyboard"]');
    if (!btn) return { found: false };
    btn.scrollIntoView({ block: 'center' });
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { found: true, hit: el === btn || btn.contains(el), x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  ok('I2a 桌面「📍 懸賞板」入口鈕點得到（elementFromPoint 命中）', hit.found && hit.hit === true, JSON.stringify(hit));
  if (hit.found && hit.hit) {
    await page.mouse.click(hit.x, hit.y);
    await page.waitForTimeout(200);
    const opened = await page.evaluate(() => !document.getElementById('bountyModal').hidden);
    ok('I2b 點下去桌面懸賞板真的開起來', opened === true);
  } else {
    ok('I2b 點下去桌面懸賞板真的開起來', false, '上一步未命中，略過但記為 FAIL');
  }
  await ctx.close();
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
  // A12d：分隔線的守門員（2026-07-28 複審第三輪發現的覆蓋缺口）。
  // 舊版把分隔線掛在收合時 display:none 的內容 div 上，預設狀態根本不生效，修好後卻**沒有
  // 任何斷言在保護它**——拿掉那條 border-bottom 全套 57 項照樣全綠。護照高度預算(L10)只量
  // 總高度，量不到「這一條線在不在」（可以拿掉線再用等量 padding 補回高度，L10 一樣綠）。
  // 判準：跟同一份護照裡其他節的標題列比，不寫死 1px（心得 29：不與實作共用假設，
  // 用「它必須跟兄弟節長得一樣」這個外部關係當判準）。
  const sep = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('#ridePanel .ph-sec')];
    const cs = e => getComputedStyle(e).borderBottomWidth;
    const mine = heads.find(h => h.dataset.sec === 'correct');
    const others = heads.filter(h => h.dataset.sec !== 'correct');
    return { mine: mine ? cs(mine) : null, others: [...new Set(others.map(cs))], n: heads.length };
  });
  ok('A12d 「校正貢獻」節的分隔線與其他節一致（不是唯一沒有線的那一節）',
    !!sep.mine && parseFloat(sep.mine) > 0 && sep.others.includes(sep.mine), JSON.stringify(sep));
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
    // M7（審查）：.bt-take 先前零外觀樣式，手機實測只有 69.3×25px，低於專案 ≥28 高×44 寬
    // 的觸控門檻（.ph-sec .pl-map 那條註解訂的同一個門檻）。這裡在剛開起來的懸賞板量真實 rect。
    const m7 = await page.evaluate(() => {
      const btn = document.querySelector('#bountyModal .bt-card .bt-take');
      if (!btn) return { found: false };
      const r = btn.getBoundingClientRect();
      return { found: true, w: r.width, h: r.height };
    });
    ok('M7 「接下這段」觸控尺寸達標（≥28 高×44 寬）', m7.found && m7.h >= 28 && m7.w >= 44, JSON.stringify(m7));
  } else {
    ok('A12c 真觸控點下去懸賞板真的開起來', false, '上一步未命中，略過但記為 FAIL');
    ok('M7 「接下這段」觸控尺寸達標（≥28 高×44 寬）', false, '上一步未命中，略過但記為 FAIL');
  }
  await ctx.close();
}

// ── B 組：出發前說明卡 ───────────────────────────────────────────────────
{
  const { ctx, page } = await open(browser, { app: true });
  const b1 = await page.evaluate(async () => {
    await openBountyBoard();
    document.querySelector('.bt-card .bt-take').click();
    await new Promise(r => setTimeout(r, 300));
    const m = document.getElementById('bountyBriefModal');
    return { hidden: m.hidden, parent: m.parentElement.tagName, txt: m.innerText };
  });
  ok('B1 接下之後跳出說明卡（掛在 body 層）', b1.hidden === false && b1.parent === 'BODY', JSON.stringify({ h: b1.hidden, p: b1.parent }));
  // 審查 M1 糾正：原本只驗「39 點」，把整句「錄 枋寮 → 臺東（南迴線，11 段）」換成空泛的
  // 「錄這一段」照樣過——沒驗到「哪一段」這件事本身。規格第一段明講三件事：哪一段／多少點／
  // 大概多久，缺一項都算沒做到，這裡一次補齊三項；起訖站與路線名判準取自 BOARD stub 自己塞的
  // 資料（枋寮/臺東/南迴線），不呼叫 bountyCardName()，同源判準見檔頭注記。
  ok('B2 第一段：哪一段(起訖站/路線名)、多少點、大概多久都在（不能被「錄這一段」這種空泛敘述取代）',
    /枋寮/.test(b1.txt) && /臺東/.test(b1.txt) && /南迴線/.test(b1.txt) && /39\s*點/.test(b1.txt)
      && /(約\s*\d+\s*分鐘|大概多久算不出來)/.test(b1.txt),
    b1.txt.slice(0, 200).replace(/\n/g, ' / '));
  // 🔴 B2c（2026-07-28 Codex 審查 F-11）：B2 只驗「有一個數字」——實測突變（bountySpanMinutes()
  // 直接 return 1）依然 86/86 全綠，那個「約 1 分鐘」是可證明的假綠。這裡補兩道**不與實作同源**
  // 的判準：
  //   ① 物理下界：枋寮→臺東的里程差由測試自己從 lineNetwork() 的站里程取（不呼叫任何懸賞函式），
  //      台鐵最高營運速度 130km/h ⇒ 全程不可能少於 km/130*60 分鐘。這是外部常數，不是抄實作。
  //   ② 真實班次區間：測試自己掃一遍 state.systems 的班表（規則刻意與實作不同——實作取「同車種
  //      中位數」，這裡取「所有兩端都是真站的車次」的 min/max 全距），顯示值必須落在裡面。
  const b2c = await page.evaluate(() => {
    const rec = [...lineNetwork().values()].find(r => r.sys === 'tra_sched' && r.id === '南迴線');
    const dOf = {}; for (const s of (rec ? rec.ln.stations : [])) if (s.d != null) dOf[s.name] = s.d;
    const km = Math.abs(dOf['臺東'] - dOf['枋寮']);
    const trains = ((state.systems || []).find(s => s.id === 'tra_sched') || {}).data;
    const mins = [];
    for (const tr of ((trains && trains.trains) || [])) {
      const st = tr.stops || [];
      const i = st.findIndex(s => s.name === '枋寮'), j = st.findIndex((s, k) => k > i && s.name === '臺東');
      if (i < 0 || j < 0 || !st[i].stop || !st[j].stop) continue;
      const m = (st[j].arrSec - st[i].depSec) / 60;
      if (m > 0) mins.push(m);
    }
    const shown = (document.getElementById('bountyBriefBody').innerText.match(/約\s*(\d+)\s*分鐘/) || [])[1];
    return { km, shown: shown == null ? null : Number(shown), n: mins.length,
      lo: mins.length ? Math.min(...mins) : null, hi: mins.length ? Math.max(...mins) : null };
  });
  const b2cFloor = b2c.km / 130 * 60; // 台鐵最高營運速度 130km/h：不可能比這更快
  ok('B2c 「約 N 分鐘」不是隨便一個數字：要過物理下界（里程/130km/h），也要落在真實班次的時間全距內',
    b2c.shown != null && b2c.n > 0 && b2c.shown >= b2cFloor
      && b2c.shown >= Math.floor(b2c.lo) && b2c.shown <= Math.ceil(b2c.hi),
    JSON.stringify({ ...b2c, 物理下界: Math.round(b2cFloor) }));
  // 🔴 B2b（最終審查 C）：24 小時鎖價期限原本只在接下當下的 toast 一閃即逝，這張常駐的說明卡
  // 完全沒提；使用者接了段之後回頭想確認期限就找不到，直接造成客訴。
  ok('B2b 第一段：24 小時鎖價期限有寫在說明卡上（不是只在接下當下一閃即逝的 toast）',
    /24\s*小時/.test(b1.txt), b1.txt.slice(0, 200).replace(/\n/g, ' / '));
  ok('B3 第二段：三件事都在（精確位置／低耗電／靠窗）',
    /精確位置/.test(b1.txt) && /低耗電/.test(b1.txt) && /靠窗/.test(b1.txt), b1.txt.replace(/\n/g, ' / ').slice(0, 300));
  // 🔴 B4 是這一節存在的理由：三態判定的承諾必須寫在 UI 上
  ok('B4 第三段：明講「即使資料不能用，章與點數還是你的」',
    /即使/.test(b1.txt) && /(還是你的|照樣是你的)/.test(b1.txt), b1.txt.replace(/\n/g, ' / ').slice(-260));
  ok('B5 第三段：明講「錄到一半中斷沒關係」', /中斷/.test(b1.txt) && /(照樣算|也算)/.test(b1.txt));
  // 🔴 B6 沒有實測資料時不准憑印象寫地下段名單（規格 §13）
  ok('B6 沒有實測缺口資料時不顯示地下段那一句', !/在地下/.test(b1.txt), b1.txt.replace(/\n/g, ' / '));

  // B7 沒有原生 openSettings 時要退回純文字引導，不留一顆點了沒反應的鈕（比照 LOCALNOTIFY 的既有做法）
  const b7 = await page.evaluate(() => {
    const btn = document.getElementById('bountyOpenSettings');
    const how = document.querySelector('#bountyBriefModal .bb-how');
    return { exists: !!btn, display: btn ? getComputedStyle(btn).display : '(不存在)', howText: how ? how.textContent : '(不存在)' };
  });
  ok('B7 沒有原生設定橋接時，那顆鈕整顆不在', b7.exists === false || b7.display === 'none', JSON.stringify(b7));
  // 審查 M2 糾正：B7 先前只驗「鈕不在」，沒驗「純文字引導真的有內容」。之前用 /精確位置/ 當判準
  // 的舊 B3 測不到這個坑，因為 <b>精確位置</b> 這個靜態標籤本身就會讓正則過，跟 .bb-how 那段
  // 動態引導文字是否真的渲染出來無關。app/src/native-bridge.mjs 把 openSettings 寫死 null，
  // 正式 App 恆走這條純文字路徑——這段若被換成空字串，使用者看到的只有「打開精確位置」五個字、
  // 沒有任何可執行步驟，且舊測試全綠、完全抓不到。這裡直接讀 .bb-how 元素自己的 textContent，
  // 不透過 innerText 整坨字串，天生免疫「標籤字樣剛好也含精確位置」這個假陽性來源。
  ok('B7b 沒有原生設定橋接時，純文字引導的實際內容要在（不是只驗鈕不在——見上方註記）',
    /隱私權與安全性/.test(b7.howText) && /定位服務/.test(b7.howText) && /軌島/.test(b7.howText),
    JSON.stringify(b7));

  // B8 開始錄製鈕點得到（elementFromPoint，不是量 rect）
  const b8 = await page.evaluate(() => {
    const btn = document.getElementById('bountyBriefGo');
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { hit: hit === btn || btn.contains(hit), cls: hit && hit.className };
  });
  ok('B8 「開始錄製」點得到', b8.hit === true, JSON.stringify(b8));
  await ctx.close();
}

// ── C 組：極簡錄製畫面 ＋ Wake Lock ────────────────────────────────────────
{
  const { ctx, page } = await open(browser, { app: true, width: 390, height: 844, touch: true });

  // 🔴 2026-07-28 審查 B1 糾正：C7/C8 原本讀 state._wakeLockRequested——那是實作專門為了
  // 讓這兩條斷言過而寫的旗標（正式碼裡只寫不讀），判準與實作同源等於沒有守門員（心得 29；
  // 突變測試 M1 把 acquireWakeLock() 呼叫拿掉、只留旗標賦值，57/57 全綠證實了這件事）。
  // 改成直接覆寫真正的 navigator.wakeLock.request，用測試自己種的計數器記呼叫次數——
  // headless 拿不拿得到真 sentinel 不重要，我們驗的是「有沒有去要」。必須在 startBountyRecording()
  // 之前就設好，才能算到它內部第一次 acquireWakeLock() 的呼叫（C7 要驗的那一次）。
  await page.evaluate(() => {
    window.__wlCalls = 0;
    // sentinel 的 release() 也要記帳（2026-07-28 Codex 審查 F-11）：C9 原本只驗「模式關了、
    // 會說謊的 UI 回來」，實測突變（把 stopBountyRecording() 裡的 releaseWakeLock() 刪掉）
    // 依然 86/86 全綠——螢幕會一直不睡，而這正是「一小時錄製」最貴的資源。
    window.__wlReleases = 0;
    navigator.wakeLock.request = (type) => {
      window.__wlCalls++;
      const s = { type, released: false, addEventListener() {}, removeEventListener() {} };
      s.release = () => { window.__wlReleases++; s.released = true; return Promise.resolve(); };
      return Promise.resolve(s);
    };
  });

  await page.evaluate(async () => {
    await openBountyBoard();
    startBountyRecording(bountyBoardMem.cards[0]);
  });
  await page.waitForTimeout(300);

  const c1 = await page.evaluate(() => ({
    on: !!state.recording,
    bodyCls: document.body.classList.contains('recording'),
    screen: !document.getElementById('recordScreen').hidden,
    parent: document.getElementById('recordScreen').parentElement.tagName,
  }));
  ok('C1 錄製模式開起來、body 有 recording class、畫面在 body 層',
    c1.on && c1.bodyCls && c1.screen && c1.parent === 'BODY', JSON.stringify(c1));

  // 🔴 C2 會說謊的 UI 要真的不在（量實際渲染，不是查 class）
  const c2 = await page.evaluate(() => {
    const q = s => { const el = document.querySelector(s); return el ? getComputedStyle(el).display : '(不存在)'; };
    return { badge: q('.badge'), actions: q('.map-actions'), controls: q('.controls'), tabbar: q('.tabbar') };
  });
  ok('C2 時鐘徽章／地圖動作列／播放控制／頁籤列全部收起',
    Object.values(c2).every(v => v === 'none' || v === '(不存在)'), JSON.stringify(c2));

  // C3 四個必要資訊都在（規格 §5 之一）
  const c3 = await page.evaluate(() => document.getElementById('recordScreen').innerText);
  ok('C3 顯示里程／段數／點數／錄製中', /公里|km/.test(c3) && /段/.test(c3) && /點/.test(c3) && /錄製中/.test(c3),
    c3.replace(/\n/g, ' / '));

  // 🔴 C3b/C3c（審查 B2）：「誠實佔位」目前零測試覆蓋——renderRecordScreen() 現在確實只讀
  // state.recording，但沒有任何斷言擋著；Task 4 接上真資料後很容易在這裡開始造假（審查突變測試
  // M2：把顯示值全部印成捏造的 12.7 公里／5 段／143 點／42%，57/57 依然全綠，C3 的鬆散正則
  // 甚至把假數字印進自己的 pass 訊息）。期望值直接手算，不呼叫 bountyCardName() 或任何本檔
  // 實作函式生成（心得 29）。
  const c3b = await page.evaluate(() => {
    Object.assign(state.recording, { dNow: 12700, segs: { a: 0.9, b: 0.7 }, points: 7 });
    renderRecordScreen();
    return {
      km: document.getElementById('recKm').textContent,
      segs: document.getElementById('recSegs').textContent,
      pts: document.getElementById('recPts').textContent,
    };
  });
  ok('C3b 顯示值真的綁回 state.recording，不是憑空數字（12700mm→12.7km／2段命中≥0.6門檻／7點）',
    c3b.km === '12.7' && c3b.segs === '2' && c3b.pts === '7', JSON.stringify(c3b));

  const c3c = await page.evaluate(() => {
    Object.assign(state.recording, { dNow: 0, segs: {}, points: 0 });
    renderRecordScreen();
    return {
      km: document.getElementById('recKm').textContent,
      segs: document.getElementById('recSegs').textContent,
      pts: document.getElementById('recPts').textContent,
      bar: document.getElementById('recBar').style.width,
    };
  });
  ok('C3c 開錄當下的真實狀態（全零）必須顯示 0，不殘留上一輪也不假裝已有進度',
    c3c.km === '0.0' && c3c.segs === '0' && c3c.pts === '0' && c3c.bar === '0%', JSON.stringify(c3c));

  // C4 黑底（省電＋視覺上明確標示正在錄製，規格 §5 之一的理由①③）
  const c4 = await page.evaluate(() => getComputedStyle(document.getElementById('recordScreen')).backgroundColor);
  ok('C4 錄製畫面是黑底', /rgba?\(\s*(0|1[0-9]?|2[0-9])\s*,\s*(0|1[0-9]?|2[0-9])\s*,/.test(c4), c4);

  // 🔴 C5 判準是「點它會發生什麼」（心得 33）
  const c5 = await page.evaluate(() => {
    const btn = document.getElementById('recStop');
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { hit: hit === btn || btn.contains(hit), w: Math.round(r.width), h: Math.round(r.height) };
  });
  ok('C5 停止鈕點得到', c5.hit === true, JSON.stringify(c5));
  ok('C6 停止鈕夠大（手機上要一小時後迷迷糊糊也按得到；44pt 是 Apple 的最小可觸控尺寸）',
    c5.h >= 44 && c5.w >= 44, JSON.stringify(c5));

  // C7 Wake Lock：既有的 acquireWakeLock 有被呼叫到（判準＝測試自己種的計數器，見上方 stub）
  const c7 = await page.evaluate(() => window.__wlCalls);
  ok('C7 進錄製模式會去要 Wake Lock', c7 >= 1, String(c7));

  // 🔴 C8 切走再切回來要重新取得（iOS 不會自動恢復）——判準是既有 handler 的條件有沒有涵蓋錄製；
  // 計數器歸零後重新分派 visibilitychange，確認又新增一次真的呼叫（不是讀 state._wakeLockRequested）
  const c8 = await page.evaluate(() => {
    window.__wlCalls = 0;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    return window.__wlCalls;
  });
  ok('C8 回前景會重新取得 Wake Lock', c8 >= 1, String(c8));

  // C9 停止之後全部還原
  await page.waitForTimeout(150); // C8 那次 acquire 是 async，等 state._wakeLock 真的被指派
  const c9 = await page.evaluate(() => {
    const held = !!state._wakeLock;
    window.__wlReleases = 0; // 只算「停止」這一下釋放了幾次
    stopBountyRecording();
    return { heldBefore: held, releases: window.__wlReleases, stillHeld: !!state._wakeLock,
      on: !!state.recording, cls: document.body.classList.contains('recording'),
      badge: getComputedStyle(document.querySelector('.badge')).display };
  });
  ok('C9 停止後模式關閉、會說謊的 UI 回來', !c9.on && !c9.cls && c9.badge !== 'none', JSON.stringify(c9));
  // 🔴 C9b（Codex 審查 F-11）：Wake Lock 是這個模式最貴的資源，「停止」必須真的把它還回去。
  // 判準是 sentinel 自己的 release() 被呼叫（測試種的計數器）＋ state._wakeLock 歸零，
  // 不是讀任何實作專門為測試而寫的旗標。
  ok('C9b 停止後 Wake Lock 真的被釋放（sentinel.release() 有被呼叫且不再持有）',
    c9.heldBefore === true && c9.releases === 1 && c9.stillHeld === false, JSON.stringify(c9));
  await ctx.close();
}

// ── F4 組：loadBounty() 缺 claims 時補洞、不整包丟（2026-07-28 審查糾正第二輪，Critical）───
// 舊版驗證邏輯是「trips 與 claims 兩個欄位都要型別正確才放行，一個沒過就整包回傳空殼」——
// 空殼再被 saveBounty() 寫回磁碟，等於把使用者已經存在的 trips 永久清空。這裡直接重現審查
// 給的 repro：舊資料缺 claims、但 trips 有 3 筆真實紀錄。判準不透過 loadBounty() 自己讀回值
// 再驗（同源）——直接 JSON.parse 原始 localStorage 字串，與 A10「整包快照比對」同一個原則
// （判準不與實作同源，心得 29）。
{
  const { ctx, page } = await open(browser, {});
  const f4 = await page.evaluate(() => {
    const KEY = 'trainmap-bounty-v1';
    const legacy = { v: 1, trips: { // 懸賞功能上線前就存在的 3 筆 trips，缺 claims 欄位
      'trip-a': { lnId: 'x', sys: 'tra_sched' },
      'trip-b': { lnId: 'y', sys: 'tra_sched' },
      'trip-c': { lnId: 'z', sys: 'tra_sched' },
    } };
    localStorage.setItem(KEY, JSON.stringify(legacy));
    const b = loadBounty();
    const tripsKeptInMemory = Object.keys(b.trips || {}).length;
    const claimsIsObj = !!(b.claims && typeof b.claims === 'object');
    // 模擬一次真正的寫入路徑（比照 bountyClaim() 的用法）：loadBounty() 之後加一筆 claims 再
    // 存檔，確認補洞後的物件寫回磁碟時，trips 沒有被牽連著一起消失。
    b.claims['new-claim'] = { cardId: 'new-claim', points: 1 };
    saveBounty(b);
    const onDisk = JSON.parse(localStorage.getItem(KEY));
    return {
      tripsKeptInMemory, claimsIsObj,
      onDiskTrips: Object.keys((onDisk && onDisk.trips) || {}).length,
      onDiskHasNewClaim: !!(onDisk && onDisk.claims && onDisk.claims['new-claim']),
    };
  });
  ok('F4 loadBounty() 缺 claims 時補洞而非整包丟棄——舊資料的 3 筆 trips 在記憶體與磁碟上都還在',
    f4.tripsKeptInMemory === 3 && f4.claimsIsObj === true && f4.onDiskTrips === 3 && f4.onDiskHasNewClaim === true,
    JSON.stringify(f4));

  // F4b：陣列形狀。`typeof [] === 'object'` ⇒ 只檢查 typeof 會把陣列當合法物件放行，
  // 而 JSON.stringify 對陣列**只序列化索引元素**，之後寫進去的具名鍵會在落盤時無聲蒸發
  // （UI 顯示成功、磁碟上什麼都沒有）——與 F4 同一種傷害，只是換了入口。
  // 判準刻意只看「寫進去的東西在不在磁碟上」，不看實作怎麼判型別（心得 29）。
  const f4b = await page.evaluate(() => {
    const KEY = 'trainmap-bounty-v1';
    const run = raw => {
      localStorage.setItem(KEY, raw);
      const b = loadBounty();
      b.claims['probe'] = { cardId: 'probe', points: 7 };
      b.trips['t-probe'] = { lnId: 'p', sys: 'tra_sched' };
      saveBounty(b);
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      return !!(d && d.claims && d.claims.probe && d.trips && d.trips['t-probe']);
    };
    return {
      claimsIsArray: run(JSON.stringify({ v: 1, trips: {}, claims: [1, 2, 3] })),
      tripsIsArray: run(JSON.stringify({ v: 1, trips: [1, 2], claims: {} })),
      wholeIsArray: run(JSON.stringify([1, 2, 3])),
    };
  });
  ok('F4b 畸形的「陣列形狀」也要被補成物件，否則之後寫進去的東西會在落盤時無聲蒸發',
    f4b.claimsIsArray === true && f4b.tripsIsArray === true && f4b.wholeIsArray === true,
    JSON.stringify(f4b));
  await ctx.close();
}

// ── F3 組：bountyClaim() 渲染例外不該被誤判成網路失敗（2026-07-28 審查糾正第二輪，Important）──
// 故意讓 showBountyBrief() 爆炸，驗證：(a) 不出現「網路不通」這句誤導 toast，(b) 成功 toast
// 仍然出現(因為伺服器與本機其實都已經接受了這次認領，只是渲染那步另外壞掉)，(c) claim 真的
// 寫進 localStorage（判準直接讀原始 localStorage，不透過 loadBounty()，同源顧慮同上）。
// ?demo=bounty 分支不受影響——這裡走的是預設的真後端 stub 路徑，不是 DEMO_MODE 分支。
{
  const { ctx, page } = await open(browser, { app: true });
  const f3 = await page.evaluate(async () => {
    await openBountyBoard();
    window.showBountyBrief = () => { throw new Error('F3 故意讓渲染爆炸'); };
    document.querySelector('.bt-card .bt-take').click();
    await new Promise(r => setTimeout(r, 400));
    const toasts = [...document.querySelectorAll('.toast')].map(e => e.textContent || '');
    const raw = JSON.parse(localStorage.getItem('trainmap-bounty-v1') || 'null');
    return { toasts, claimed: !!(raw && raw.claims && Object.keys(raw.claims).length > 0) };
  });
  ok('F3 showBountyBrief() 拋例外不會被誤判成網路失敗（不出現「網路不通」、成功 toast 仍在、claim 已寫入本機）',
    !f3.toasts.some(t => /網路不通/.test(t)) && f3.toasts.some(t => /接下了/.test(t)) && f3.claimed === true,
    JSON.stringify(f3));
  await ctx.close();
}

// ── F7 組：出發前說明卡手機版下方空白 251px（2026-07-28 審查糾正第二輪，Minor 但很顯眼）─────
// 根因與修法見 index.html #bountyBriefModal .tk-box 那條 CSS 旁的完整註解：手機版
// .takeout-modal 的 place-items:stretch 把 .tk-box 拉滿 max-height，內容撐不滿，剩下的高度
// 變成看得見的空白；桌面版 place-items:center 不受影響。判準：卡片底部到視窗底部的差距不能
// 再是「一大截空白」的量級（修前實測 251px），且底部按鈕在新版面下用真觸控（page.touchscreen）
// 仍點得到——修過頭把鈕擠出視窗、或把卡片整個推出視窗，同樣算沒修好。
{
  const { ctx, page } = await open(browser, { app: true, width: 375, height: 812, touch: true });
  await page.evaluate(async () => { await openBountyBoard(); });
  const takeBox = await page.evaluate(() => {
    const b = document.querySelector('.bt-card .bt-take').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.touchscreen.tap(takeBox.x, takeBox.y);
  await page.waitForTimeout(300);
  const f7 = await page.evaluate(() => {
    const modal = document.getElementById('bountyBriefModal');
    const box = modal.querySelector('.tk-box');
    const foot = modal.querySelector('.tk-foot');
    const bx = box.getBoundingClientRect();
    return {
      hidden: modal.hidden,
      gapBelowFoot: Math.round(bx.bottom - foot.getBoundingClientRect().bottom),
      withinViewport: bx.top >= 0 && bx.bottom <= window.innerHeight,
    };
  });
  ok('F7 手機版說明卡底部不再空一大截（≤20px，修前實測 251px）且卡片仍完整在視窗內',
    f7.hidden === false && f7.gapBelowFoot <= 20 && f7.withinViewport === true, JSON.stringify(f7));
  const laterBox = await page.evaluate(() => {
    const b = document.getElementById('bountyBriefLater').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.touchscreen.tap(laterBox.x, laterBox.y);
  await page.waitForTimeout(150);
  const closed = await page.evaluate(() => document.getElementById('bountyBriefModal').hidden === true);
  ok('F7b 新版面下「等一下再說」用真觸控仍點得到（不是只驗鈕在不在，而是點下去真的關掉）', closed === true);
  // 對照：#bountyModal（懸賞板列表）沒有被 F7 的修法牽動——CSS 選擇器是 #bountyBriefModal
  // 限定，列表本來的 stretch 行為要維持原樣（見 index.html CSS 旁的完整註解）。
  const boardAlign = await page.evaluate(async () => {
    await openBountyBoard();
    const box = document.getElementById('bountyModal').querySelector('.tk-box');
    return getComputedStyle(box).alignSelf;
  });
  ok('F7c #bountyModal（懸賞板列表）的 align-self 沒被牽動，仍是 auto（未特別覆寫）', boardAlign === 'auto', boardAlign);
  await ctx.close();
}

// ── D 組：?demo=bounty（備援站確認設計用）────────────────────────────────
// 為什麼要有這一組：備援站是靜態站、**沒有 /api/***，而懸賞板→說明卡整條流程又被
// PHYSICAL_COLLECT_ENABLED 擋在 App 內 ⇒ 沒有這個開關就沒有任何辦法在備援站確認設計。
// 這一組刻意讓**所有** /api/* 回 404（GitHub Pages 的實況），不是用假後端。
{
  const mk = async (qs, w = 390) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, hasTouch: true });
    await ctx.route('**/api/**', r => r.fulfill({ status: 404, body: 'Not Found' })); // 備援站實況
    const page = await ctx.newPage();
    await page.goto(BASE + '/index.html' + qs, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, null, { timeout: 40000 });
    await page.evaluate(() => { const h = document.getElementById('howtoWrap'); if (h) h.remove(); });
    return { ctx, page };
  };

  const { ctx: dctx, page: dp } = await mk('?demo=bounty');
  const d0 = await dp.evaluate(() => ({ app: IS_NATIVE_APP, phys: PHYSICAL_COLLECT_ENABLED }));
  ok('D1 ?demo=bounty 讓網頁也走得完 App 才有的收集流程（但它不是真的 App 殼）',
    d0.app === false && d0.phys === true, JSON.stringify(d0));

  await dp.evaluate(() => openBountyBoard());
  await dp.waitForTimeout(700);
  const d2 = await dp.evaluate(() => {
    const cards = [...document.querySelectorAll('#bountyList .bt-card')].map(c => ({
      r: c.querySelector('.bt-r').textContent, meta: c.querySelector('.bt-meta').textContent }));
    return { sub: document.getElementById('bountySub').textContent, cards };
  });
  ok('D2 零 /api/* 時懸賞板仍出得來（備援站的唯一目的）', d2.cards.length >= 3, `${d2.cards.length} 張卡`);
  // 判準刻意只用「契約」不用實作：掉進 fallback 時 bountyCardName 回的是
  // { from: card.lnId, to: '' } ⇒ 只要「to 非空且 from 不等於線名」就能區分成功與 fallback。
  // 這條同時是鍵空間契約（tra_sched|南迴線|A|B）的活體檢查——形狀錯了這裡必紅。
  const bad = d2.cards.filter(c => {
    const m = /^(.*?)\s*→\s*(.*)$/.exec(c.r) || [];
    const lineName = (c.meta.split('・')[0] || '').trim();
    return !m[1] || !m[2] || m[1] === m[2] || m[1] === lineName || c.r.includes('|');
  });
  ok('D3 卡面是真站名不是內部代碼（掉進 fallback 會顯示線名且終點空白）', bad.length === 0,
    bad.length ? JSON.stringify(bad) : d2.cards.map(c => c.r).join('、'));
  ok('D4 示範資料必須自己講明是假的（不能讓人以為那是真的懸賞）', /示範資料/.test(d2.sub), d2.sub.slice(0, 40));

  const d5 = await dp.evaluate(() => {
    const btn = document.querySelector('#bountyList .bt-card .bt-take'); if (!btn) return { missing: true };
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { missing: false, w: Math.round(r.width), h: Math.round(r.height), hitSelf: !!(hit && hit.closest('.bt-take')) };
  });
  ok('D5 手機 390：「接下這段」尺寸夠且中心真的點得到自己',
    !d5.missing && d5.hitSelf === true && d5.h >= 28 && d5.w >= 44, JSON.stringify(d5));
  await dp.tap('#bountyList .bt-card .bt-take');
  await dp.waitForTimeout(700);
  const d6 = await dp.evaluate(() => {
    const m = document.getElementById('bountyBriefModal');
    return { exists: !!m, hidden: m ? m.hidden : null, len: m ? (m.innerText || '').length : 0 };
  });
  ok('D6 零 /api/* 時「接下這段」仍走得到出發前說明卡（不接住就會停在「網路不通」）',
    d6.exists === true && d6.hidden === false && d6.len > 80, JSON.stringify(d6));

  // 🔴 D6b（Task 3）：明天使用者在備援站實際會走的路徑——零 /api/* 時「開始錄製」也要真的
  // 走得到錄製畫面，不能停在網路錯誤。startBountyRecording 本身不打網路，但這條斷言守住
  // 「以後不會有人不小心把網路請求埋進這條路徑」。
  await dp.evaluate(() => document.getElementById('bountyBriefGo').click());
  await dp.waitForTimeout(300);
  const d6b = await dp.evaluate(() => ({
    recording: !!state.recording, screenHidden: document.getElementById('recordScreen').hidden,
    bodyCls: document.body.classList.contains('recording'),
  }));
  ok('D6b ?demo=bounty 下「開始錄製」真的進到錄製畫面（不停在網路錯誤）',
    d6b.recording === true && d6b.screenHidden === false && d6b.bodyCls === true, JSON.stringify(d6b));

  // 🔴 D6c（審查 B4）：明天使用者在備援站實際會走的路徑——開板→接一段→開始錄製之後很可能
  // 重新整理或分享網址。clearFollow() 的 replaceState 是全站唯一的抹除點，修法補在 clearFollow()
  // 內部本身（見 index.html 該函式內的完整註解），不是只補在 startBountyRecording 收尾——
  // 這樣不論從哪個呼叫路徑觸發都護得到（下面獨立的 D1b 驗的正是另一條路徑：boot 本身那次呼叫）。
  // 此刻 dp 已經走完 D2(開板)→D5/D6(接一段)→D6b(開始錄製)，直接重新整理：PHYSICAL_COLLECT_ENABLED
  // 是重新執行一次 script 讀到的新值，不是同一份記憶體裡的舊 const——網址列上留不住 demo 參數就會變 false。
  const preReloadSearch = await dp.evaluate(() => location.search);
  await dp.reload({ waitUntil: 'load' });
  const d6c = await dp.evaluate(() => ({ search: location.search, phys: PHYSICAL_COLLECT_ENABLED }));
  ok('D6c 走完開板→接一段→開始錄製之後重新整理，?demo=bounty 撐得住、PHYSICAL_COLLECT_ENABLED 仍是 true',
    d6c.search.includes('demo=bounty') && d6c.phys === true,
    `重載前 search=${preReloadSearch}　重載後 ${JSON.stringify(d6c)}`);

  // 🔴 D8（最終審查 A-1+A-2）：Task 7 做的懸賞地圖層要看得到金色線，前提是①有進得去的入口
  // （零完乘記錄時「校正貢獻」節也要露出收集地圖鈕）②?demo=bounty 種得出校正記錄，否則
  // bountyCorrectedSegs() 是空集合、地圖層一個像素都畫不出來。此刻 dp 剛做完 D6c 的重新整理
  // （使用者明早很可能做的事：開了板、接了段、開始錄，中途重新整理），驗完 reload 之後這條路
  // 還走得通。走真實 UI 路徑（護照→「校正貢獻」節的收集地圖鈕→開懸賞層開關），不直接呼叫
  // setCollectMap()／state.collectBounty=true 這些內部函式——這樣同一條斷言同時覆蓋 A-1
  // （入口存在且點得到）與 A-2（畫得出金色），不是各驗一半。
  // 🔴 D6c 自己的斷言只讀 location.search／PHYSICAL_COLLECT_ENABLED（兩者在 reload 後立刻可讀，
  // 不必等 boot 跑完），所以原本沒有補 waitForFunction；但 D8a/D8b 要讀 state.mode／render 出來
  // 的內容，這裡比照 D1b 自己 reload 後的既有寫法，補上等 boot 真的跑到 state.trains 就緒。
  await dp.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, null, { timeout: 40000 });
  await dp.waitForTimeout(700); // 比照 D2 等 lineNetwork() 建好的窗:bountyCorrectedSegs() 雖只讀 localStorage 不靠它，但 buildCorrectSection() 同時呼叫 lineCompletion() 一起判斷
  // dp 是 390 寬(mk() 預設)，落在 MOBILE_MQ(max-width:900px)內：桌面 #passport 這裡是
  // display:none(探針量過，rect 全 0)，護照真正的家是 #ridePanel，要先 openRidePanel() 才會
  // hidden=false 並觸發 renderRidePanel()——直接對 #passport 找按鈕會「存在但點不到」。
  const d8a = await dp.evaluate(() => {
    document.getElementById('howtoWrap')?.remove(); // reload 後首訪卡會重新出現，比照 mk() 的既有清理
    openRidePanel();
    return { btn: !!document.querySelector('#ridePanel [data-sec="correct"] [data-act="collectmap"]') };
  });
  ok('D8a ?demo=bounty 重新整理後，手機護照 sheet「校正貢獻」節仍看得到收集地圖入口（A-1：零完乘記錄不能沒有路可去）',
    d8a.btn === true, JSON.stringify(d8a));

  // D8b 不用 if(d8a.btn) 把整條 ok() 包起來跳過——比照本檔 D5 的既有寫法(斷言本身把
  // 「入口存不存在」納入判準),入口不存在時 D8b 也要明確變紅,不能讓它從報告裡悄悄消失。
  const d8b = d8a.btn ? await (async () => {
    await dp.click('#ridePanel [data-sec="correct"] [data-act="collectmap"]');
    await dp.waitForTimeout(200);
    await dp.evaluate(() => document.getElementById('collectBountyBtn').click());
    await dp.waitForTimeout(200);
    return dp.evaluate(() => {
      const c = document.getElementById('overlay');
      const g = c.getContext('2d');
      const px = g.getImageData(0, 0, c.width, c.height).data;
      let gold = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 200) continue;
        if (Math.abs(px[i] - 0xff) <= 24 && Math.abs(px[i + 1] - 0xd6) <= 24 && Math.abs(px[i + 2] - 0x0a) <= 24) gold++;
      }
      return { collectMap: state.collectMap, collectBounty: state.collectBounty, gold };
    });
  })() : { collectMap: false, collectBounty: false, gold: -1, skippedNoEntryBtn: true };
  ok('D8b ?demo=bounty 收集地圖上真的有懸賞金色像素，不是只有「函式有回東西」（A-2）',
    d8b.collectMap === true && d8b.collectBounty === true && d8b.gold > 0, JSON.stringify(d8b));
  await dctx.close();

  // 🔴 D1b（審查 B4 查證後追加，獨立 context）：demo 模式在使用者做任何事之前就可能已經死了——
  // 實測用 history.replaceState 打樁抓呼叫堆疊，boot() 的 loadAllGroup() 一開機就無條件呼叫一次
  // clearFollow()（loadAllGroup→clearFollow→history.replaceState(pathname)），跟「開始錄製」
  // 完全無關，比審查原本抓到的那個時間點還早：什麼都還沒點，trains 一就緒 location.search 就已經
  // 是空字串。這裡驗最壞情況——開站後立刻重新整理，不經過開板/接一段/開始錄製任何一步。
  // 刻意用獨立 context（不是接在上面 dp 那條流程中間）：這條斷言如果失敗，demo 模式在這個
  // page 上就整個死掉，若跟 D2–D6c 共用同一個 page，會連鎖拖垮後面一整串不相干的斷言，
  // 讓「乾淨單項 FAIL」變成「整份腳本中止」（突變測試親自撞過這個坑，見 task-3-report.md）。
  {
    const { ctx: d1bctx, page: d1bp } = await mk('?demo=bounty');
    const d1PreSearch = await d1bp.evaluate(() => location.search);
    await d1bp.reload({ waitUntil: 'load' });
    await d1bp.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, null, { timeout: 40000 });
    const d1c = await d1bp.evaluate(() => ({ search: location.search, phys: PHYSICAL_COLLECT_ENABLED }));
    ok('D1b 什麼都還沒點、開站後就重新整理，?demo=bounty 也要撐得住（boot 本身的 clearFollow 呼叫比開始錄製那步更早發生）',
      d1c.search.includes('demo=bounty') && d1c.phys === true,
      `開站當下(尚未任何互動) search=${d1PreSearch}　重載後 ${JSON.stringify(d1c)}`);
    await d1bctx.close();
  }

  // 反向：沒帶參數的網頁必須維持網頁的樣子，示範開關不能外洩
  const { ctx: nctx, page: np } = await mk('');
  const d7 = await np.evaluate(() => ({ app: IS_NATIVE_APP, phys: PHYSICAL_COLLECT_ENABLED }));
  ok('D7 沒帶 ?demo=bounty 的網頁不受影響（示範開關不外洩）',
    d7.app === false && d7.phys === false, JSON.stringify(d7));
  await nctx.close();
}

// ── H 組：懸賞地圖層 ─────────────────────────────────────────────────────
// 🔴 brief 草稿的 `await fetchBountyMe()` 與 `over:{me:ME}` 拿掉：fetchBountyMe()/bountyMeMem
// 是 Task 6（護照校正貢獻節）的產出，而 progress.md 的排程刻意把 Task 7 排在 Task 6 之前
// （「順序：1(修復) → 2 → 3 → 7 → 6」），這份 index.html 裡目前沒有 fetchBountyMe 這個函式——
// 呼叫它會在 page.evaluate 裡丟 ReferenceError，讓整支腳本中止在這裡而不是乾淨 FAIL。
// 且下面 H1–H5 的斷言本來就不需要它：bountyCorrectedSegs() 只讀本機 loadBounty()（見它自己的
// 註解「不必等後端回；後端回的 segs 只是跨裝置時的補充來源」），這裡直接塞本機記錄即可。
// 🔴 `rec.sys === 'TRA'` 改成 `'tra_sched'`：lineNetwork() 的 sys 桶代碼是 SYS_DEFS id 本身
// （'tra_sched'/'thsr_sched'/'afr_sched'，沒有 metro），'TRA' 那套已被 Task 1 審查裁定廢止
// （本檔 A3/C1b/D3 等既有斷言都已經改用 'tra_sched'，這裡跟著同一套鍵空間）。
{
  const { ctx, page } = await open(browser, { app: true });
  const h = await page.evaluate(async () => {
    const rec = [...lineNetwork().values()].find(r => r.sys === 'tra_sched');
    const keys = rec.segs.slice(0, 3).map(s => s.key);
    // 🔴 T7-4（審查 Important）：suspect 過濾（規格 §8 防偽閘）零覆蓋——brief 原 fixture 只有
    // 一筆 verdict:'ok' 的 trip，從來沒有 suspect 記錄，index.html:9235 那行 `if (verdict===
    // 'suspect') continue;` 整行刪掉照樣 64/64 全綠。這裡補一筆 segs 完全不同的 suspect trip，
    // 才驗得到「該排除時真的排除了」這個方向。
    const suspectKeys = rec.segs.slice(3, 6).map(s => s.key);
    // 直接塞本機的校正記錄（不依賴後端把 segs 回來）
    const b = loadBounty();
    b.trips['x'] = { lnId: rec.id, sys: rec.sys, trainNo: '1', dir: 0, tripDate: '2026-07-28',
      verdict: 'ok', segs: keys, u: Date.now() };
    b.trips['y'] = { lnId: rec.id, sys: rec.sys, trainNo: '2', dir: 0, tripDate: '2026-07-28',
      verdict: 'suspect', segs: suspectKeys, u: Date.now() };
    saveBounty(b);
    setCollectMap(true);
    // 開場鏡頭是「全台同框」遠景(整條台灣塞進一個畫面),3 段區間在那個尺度下投影出來的像素
    // 可能整段落在螢幕外或細到反鋸齒後量不到——飛到第一段所在位置,H4 才量得到東西。
    map.setView([rec.segs[0].pA.lat, rec.segs[0].pA.lon], 13, { animate: false });
    const corr = bountyCorrectedSegs();
    // 🔴 T7-3（審查 Important）：舊判準只驗鈕存在於 document 任一角落——把鈕搬出 #collectBar、
    // 塞進 display:none 的容器，元素仍「存在」，H2 照樣過。補 DOM 容器歸屬檢查。
    const btn = document.getElementById('collectBountyBtn'), bar = document.getElementById('collectBar');
    return { corrected: corr.size, suspectLeaked: suspectKeys.filter(k => corr.has(k)),
      bar: bar.innerText, toggle: !!btn, toggleInBar: !!(btn && bar && bar.contains(btn)), id: rec.id };
  });
  ok('H1 本機的校正段撿得出來（suspect 那筆不算，corrected 仍是 3——見 T7-4）',
    h.corrected === 3 && h.suspectLeaked.length === 0,
    JSON.stringify({ corrected: h.corrected, suspectLeaked: h.suspectLeaked }));
  ok('H2 收集地圖列上有懸賞層的切換，且真的掛在 #collectBar 底下（不是被搬走藏起來——見 T7-3）',
    h.toggle === true && h.toggleInBar === true, h.bar.replace(/\n/g, ' / '));

  const h3 = await page.evaluate(() => {
    document.getElementById('collectBountyBtn').click();
    return { on: state.collectBounty };
  });
  ok('H3 切得開', h3.on === true, JSON.stringify(h3));

  // 🔴 H4 判準改寫：brief 草稿只數「整張 canvas 上有幾種相異顏色」——實測發現這個判準太鈍,
  // 車站圖示/站名文字反鋸齒本身就能在整張 1440×900 canvas 上湊出破千種顏色,即使把懸賞層的
  // 描線整段停用（突變測試：if(corr&&corr.size) 改成 if(false&&corr&&corr.size)),colors 依然
  // 是 1194、64/64 全綠——判準對真正的缺陷完全無感。改成直接數「畫面上有幾個像素落在懸賞金色
  // #ffd60a 附近(容差 24,吃反鋸齒與外描混色)」,同一個突變下這裡會確實掉到 0。
  const h4 = await page.evaluate(() => {
    const c = document.getElementById('overlay');
    const g = c.getContext('2d');
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let gold = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 200) continue;
      if (Math.abs(px[i] - 0xff) <= 24 && Math.abs(px[i + 1] - 0xd6) <= 24 && Math.abs(px[i + 2] - 0x0a) <= 24) gold++;
    }
    return { gold };
  });
  ok('H4 開了懸賞層之後畫面上真的有懸賞金色(#ffd60a)像素，不是只有灰底／走過色', h4.gold >= 20, JSON.stringify(h4));

  // 🔴 T7-1（審查 Important）：懸賞層原本另開一個 lineNetwork() 迴圈，沒有繼承「走過」層的
  // state.trackVisible 守門——關掉某條線的軌道顯示後，該線的金色校正段仍會畫出來，變成一條
  // 沒有軌道的懸空金線（t7_trackvis_hidden_line.png）。production 端已修（併進同一個迴圈共用
  // 守門，見 drawCollectSegs）。這裡驗：關掉 h.id 那條線的 trackVisible 後，金色像素要歸零
  // （H1–H4 的 3 段校正記錄全部屬於同一條線 h.id，理論上關掉就是全部歸零，不是「顯著下降」）。
  const h6 = await page.evaluate((rid) => {
    state.trackVisible.delete(rid);
    draw();
    const c = document.getElementById('overlay');
    const g = c.getContext('2d');
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let gold = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 200) continue;
      if (Math.abs(px[i] - 0xff) <= 24 && Math.abs(px[i + 1] - 0xd6) <= 24 && Math.abs(px[i + 2] - 0x0a) <= 24) gold++;
    }
    state.trackVisible.add(rid); // 立刻還原,不留副作用給後面的斷言
    draw();
    return { gold };
  }, h.id);
  ok('H6（T7-1）關掉該線的軌道顯示(trackVisible)後，懸賞金色像素歸零（原本懸賞層沒繼承 trackVisible 守門，會畫出懸空金線）',
    h6.gold === 0, JSON.stringify(h6));

  // 🔴 T7-2（審查 Important）：H4 只驗「有沒有金色像素」，量不到「沿線形描，不是站到站直線弦」
  // 這個規格 §8 的唯一賣點——日後有人把 drawSegOnShape 改成畫直線弦（或效能考量），H1–H6 不會
  // 有任何反應。判準刻意不呼叫 drawSegOnShape/shapeSlice/bountyCorrectedSegs，只用 Leaflet 中性
  // 的 latLngToContainerPoint 把 s.pA/s.pB 換算成螢幕座標自己算弦，量畫面像素驗兩件事：
  // (a) 弦中點附近（半徑 4px——量測時發現反鋸齒會讓精確中心那顆像素的色差以極小誤差跨過容差，
  //     單一整數像素量測會 false negative，見探針實測：中點像素 b=37 vs 容差上限 34）沒有金色；
  // (b) 金色像素裡有真的離「弦線段」（用夾在 [0,1] 的投影參數 t，不是弦的無限延長線）超過 6px。
  // fixture 選 南迴線 大武–枋野（審查員建議的彎道段）：探針腳本實測 z12 下真實描線離弦最遠
  // 107px、弦中點附近最近的金色像素在 97.9px 外；模擬「懸賞層改畫直線弦」的突變後，同樣位置
  // 的金色像素只在 0.7px 內——兩個數字差兩個量級，不是雜訊（探針腳本未進 repo，數字取自實跑）。
  const h7 = await page.evaluate(() => {
    const rec = [...lineNetwork().values()].find(r => r.id === '南迴線' && r.sys === 'tra_sched');
    const seg = rec.segs.find(s => s.key === 'tra_sched|南迴線|大武|枋野');
    const b = loadBounty();
    b.trips = { t72: { lnId: rec.id, sys: rec.sys, trainNo: '9', dir: 0, tripDate: '2026-07-28',
      verdict: 'ok', segs: [seg.key], u: Date.now() } };
    saveBounty(b);
    map.setView([(seg.pA.lat + seg.pB.lat) / 2, (seg.pA.lon + seg.pB.lon) / 2], 12, { animate: false });
    draw();
    const pA = map.latLngToContainerPoint([seg.pA.lat, seg.pA.lon]);
    const pB = map.latLngToContainerPoint([seg.pB.lat, seg.pB.lon]);
    const c = document.getElementById('overlay');
    const g = c.getContext('2d');
    const px = g.getImageData(0, 0, c.width, c.height).data;
    const isGold = (x, y) => {
      if (x < 0 || y < 0 || x >= c.width || y >= c.height) return false;
      const i = (y * c.width + x) * 4;
      return px[i + 3] > 200 && Math.abs(px[i] - 0xff) <= 24 && Math.abs(px[i + 1] - 0xd6) <= 24 && Math.abs(px[i + 2] - 0x0a) <= 24;
    };
    const midX = (pA.x + pB.x) / 2, midY = (pA.y + pB.y) / 2;
    let midAreaGold = false;
    for (let dy = -4; dy <= 4 && !midAreaGold; dy++)
      for (let dx = -4; dx <= 4 && !midAreaGold; dx++)
        if (isGold(Math.round(midX + dx), Math.round(midY + dy))) midAreaGold = true;
    const dx = pB.x - pA.x, dy = pB.y - pA.y, len2 = dx * dx + dy * dy || 1;
    let maxDist = 0, over6 = 0, goldCount = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 200) continue;
      if (!(Math.abs(px[i] - 0xff) <= 24 && Math.abs(px[i + 1] - 0xd6) <= 24 && Math.abs(px[i + 2] - 0x0a) <= 24)) continue;
      goldCount++;
      const idx = i / 4, x = idx % c.width, y = Math.floor(idx / c.width);
      const t = Math.max(0, Math.min(1, ((x - pA.x) * dx + (y - pA.y) * dy) / len2));
      const dist = Math.hypot(x - (pA.x + t * dx), y - (pA.y + t * dy));
      if (dist > maxDist) maxDist = dist;
      if (dist > 6) over6++;
    }
    return { midAreaGold, maxDist: +maxDist.toFixed(1), over6, goldCount };
  });
  ok('H7（T7-2）懸賞層沿線形描，不是站到站直線弦——南迴線 大武–枋野彎道：弦中點附近沒有金色 且 '
    + '有金色像素離弦(線段)>6px（判準只用 latLngToContainerPoint 換算 s.pA/s.pB 自己算，不呼叫 drawSegOnShape）',
    h7.midAreaGold === false && h7.maxDist > 6 && h7.over6 > 0 && h7.goldCount > 0, JSON.stringify(h7));

  const h5 = await page.evaluate(() => { setCollectMap(false); return { bounty: state.collectBounty, cm: state.collectMap }; });
  // 🔴 brief 草稿把 bounty 收進回傳物件卻沒放進判準——只驗 cm===false 測不到「懸賞層一起關」本身
  // （setCollectMap(false) 本來就會把 cm 關掉,跟這裡的新行為無關）,補上 h5.bounty===false 才是這條真正要守的東西。
  ok('H5 離開收集地圖時懸賞層一起關（不留一個看不到的開關）', h5.cm === false && h5.bounty === false, JSON.stringify(h5));
  await ctx.close();
}

// 🔴 T7-3（審查 Important）：H2 的「按不按得到」缺口——這顆鈕在整份腳本裡原本沒有任何
// elementFromPoint 或真觸控斷言，本檔開頭第 6 行自己寫著「按鈕可不可按 → elementFromPoint
// 命中，不是量 rect（心得 33）」，D5/A12b 對另外兩顆鈕都確實這樣做了，這裡補上同款
// 375/390 雙寬度常設斷言（elementFromPoint 命中 ＋ page.touchscreen.tap 真觸控＋驗證點擊生效）。
{
  const { ctx, page } = await open(browser, { app: true, width: 375, height: 812, touch: true });
  const hit375 = await page.evaluate(() => {
    setCollectMap(true);
    const btn = document.getElementById('collectBountyBtn');
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { w: Math.round(r.width), h: Math.round(r.height),
      hitSelf: !!(el && el.closest('#collectBountyBtn')), x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  ok('H8（T7-3）手機 375：「📍 校正過的」鈕尺寸夠且中心真的點得到自己（elementFromPoint 命中，不是只量 rect）',
    hit375.hitSelf === true && hit375.w >= 44 && hit375.h >= 28, JSON.stringify(hit375));
  const before375 = await page.evaluate(() => state.collectBounty);
  await page.touchscreen.tap(hit375.x, hit375.y);
  await page.waitForTimeout(150);
  const after375 = await page.evaluate(() => state.collectBounty);
  ok('H9（T7-3）手機 375：真觸控點下去 state.collectBounty 真的翻轉（不只是點得到，點下去要有效）',
    before375 === false && after375 === true, JSON.stringify({ before: before375, after: after375 }));
  await ctx.close();
}
{
  const { ctx, page } = await open(browser, { app: true, width: 390, height: 844, touch: true });
  const hit390 = await page.evaluate(() => {
    setCollectMap(true);
    const btn = document.getElementById('collectBountyBtn');
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { w: Math.round(r.width), h: Math.round(r.height),
      hitSelf: !!(el && el.closest('#collectBountyBtn')), x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  ok('H10（T7-3）手機 390：「📍 校正過的」鈕尺寸夠且中心真的點得到自己（elementFromPoint 命中，不是只量 rect）',
    hit390.hitSelf === true && hit390.w >= 44 && hit390.h >= 28, JSON.stringify(hit390));
  const before390 = await page.evaluate(() => state.collectBounty);
  await page.touchscreen.tap(hit390.x, hit390.y);
  await page.waitForTimeout(150);
  const after390 = await page.evaluate(() => state.collectBounty);
  ok('H11（T7-3）手機 390：真觸控點下去 state.collectBounty 真的翻轉（不只是點得到，點下去要有效）',
    before390 === false && after390 === true, JSON.stringify({ before: before390, after: after390 }));
  await ctx.close();
}

// 🔴 H12（最終審查 B）：新增的 #collectBountyBtn(93px)把 #collectStat 的可用寬從 155px
// 壓到 68px(375)／53px(360)／83px(390)，「6 條線・500 km・全線走完 2」被截成「6 條線・5…」。
// 審查員做過控制組(同一份 build 把按鈕 display:none，clientW 立刻回到 155、不截斷)確認是這顆
// 新按鈕造成的。768 以上不受影響，這裡不測。用真的有完乘資料的場景（比照 seedCollectDemo() 的
// 做法）——零搭乘記錄時的文案本身更長，那是另一個獨立於本次改動、早就存在的截斷（關掉
// #collectBountyBtn 量過，截斷依舊在），不在這次 findings 範圍內，這裡刻意種資料只驗新按鈕
// 造成的回歸，不去解一個 findings 沒點名的舊問題。
for (const w of [360, 375, 390]) {
  const { ctx, page } = await open(browser, { app: true, width: w, height: 812, touch: true });
  const r = await page.evaluate(() => {
    const recs = [...lineNetwork().values()].sort((a, b) => b.segs.length - a.segs.length).slice(0, 6);
    const sg = {};
    recs.forEach((rec, i) => { rec.segs.slice(0, Math.max(1, Math.round(rec.segs.length * [1, 0.55, 1, 0.3, 0.75, 0.2][i])))
      .forEach(s => sg[s.key] = 1); });
    localStorage.setItem('trainmap-checkins-v1', JSON.stringify({ v: 1, st: {}, sg }));
    setCollectMap(true);
    const el = document.getElementById('collectStat');
    return { text: el.textContent, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  ok(`H12（最終審查 B）手機 ${w}：#collectStat 沒有被新按鈕擠到截斷（scrollWidth<=clientWidth）`,
    r.scrollWidth <= r.clientWidth, JSON.stringify(r));
  await ctx.close();
}

// 🔴 H13（最終審查 A，本專案手機鐵則）：A 組的端到端不能只驗「函式有沒有回東西」，375／390
// 兩個寬度都要用 elementFromPoint 命中＋真觸控 page.touchscreen.tap()，不是 .click()／直呼
// 內部函式。走 ?demo=bounty 真實開機路徑（不手動塞 state），到 #ridePanel（這兩個寬度落在
// MOBILE_MQ 內，桌面 #passport 是 display:none，見上面 D8a 的既有教訓）找 A-1 新入口，
// 真的點兩下（先進收集地圖，再開懸賞層），最後數金色像素收尾，同一條路徑上把 A-1 與 A-2
// 一起走完，不是各自孤立測。
for (const w of [375, 390]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 812 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(BASE + '/index.html?demo=bounty', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, { timeout: 40000 });
  await page.waitForTimeout(700); // 等 setupBountyDemo() 的 tick 追上 lineNetwork() 就緒（比照 D8a）
  await page.evaluate(() => {
    document.getElementById('howtoWrap')?.remove();
    openRidePanel();
    const btn = document.querySelector('#ridePanel [data-sec="correct"] [data-act="collectmap"]');
    btn?.scrollIntoView({ block: 'center' }); // sheet 內容可捲動，rect 沒捲到位會落在視窗外(見 H13a 首輪 cy=918 教訓)
  });
  await page.waitForTimeout(150); // 等捲動落定再量 rect，避免量到過渡中的座標
  const h13a = await page.evaluate(() => {
    const btn = document.querySelector('#ridePanel [data-sec="correct"] [data-act="collectmap"]');
    if (!btn) return { missing: true };
    const r = btn.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    return { missing: false, w: Math.round(r.width), h: Math.round(r.height),
      hitSelf: !!(hit && hit.closest('[data-act="collectmap"]')), cx, cy };
  });
  ok(`H13a（最終審查 A）手機 ${w}：護照「校正貢獻」節的收集地圖入口尺寸夠且中心真的點得到自己（elementFromPoint 命中）`,
    !h13a.missing && h13a.hitSelf === true && h13a.w >= 44 && h13a.h >= 28, JSON.stringify(h13a));

  // H13b/H13c 不用 if(!h13a.missing) 把整條 ok() 包起來跳過——比照本檔 D8b 的既有寫法
  // （斷言本身把「入口存不存在」納入判準），入口不存在時這兩條也要明確變紅，不能讓它們
  // 從報告裡悄悄消失、也不能讓總數在不同執行之間浮動。
  const h13b = !h13a.missing ? await (async () => {
    await page.touchscreen.tap(h13a.cx, h13a.cy); // 真觸控，不是 .click()
    await page.waitForTimeout(200);
    return page.evaluate(() => ({ collectMap: state.collectMap }));
  })() : { collectMap: false, skippedNoEntryBtn: true };
  ok(`H13b（最終審查 A）手機 ${w}：真觸控點下收集地圖入口後 state.collectMap 真的翻轉`,
    !h13a.missing && h13b.collectMap === true, JSON.stringify(h13b));

  const h13c = h13b.collectMap ? await (async () => {
    const tgl = await page.evaluate(() => {
      const btn = document.getElementById('collectBountyBtn');
      const r = btn.getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return { hitSelf: !!(hit && hit.closest('#collectBountyBtn')), cx, cy };
    });
    await page.touchscreen.tap(tgl.cx, tgl.cy); // 真觸控開懸賞層
    await page.waitForTimeout(300);
    // 注意：page.evaluate() 的 callback 在瀏覽器內執行，讀不到外層 Node 變數 tgl——
    // tglHitSelf 從 Node 端併回結果物件，不能寫進 evaluate() 內部（首輪在此炸過
    // ReferenceError: tgl is not defined）。
    const raw = await page.evaluate(() => {
      const c = document.getElementById('overlay');
      const g = c.getContext('2d');
      const px = g.getImageData(0, 0, c.width, c.height).data;
      let gold = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 200) continue;
        if (Math.abs(px[i] - 0xff) <= 24 && Math.abs(px[i + 1] - 0xd6) <= 24 && Math.abs(px[i + 2] - 0x0a) <= 24) gold++;
      }
      return { collectBounty: state.collectBounty, gold };
    });
    return { ...raw, tglHitSelf: tgl.hitSelf };
  })() : { collectBounty: false, gold: -1, tglHitSelf: false, skippedNoCollectMap: true };
  ok(`H13c（最終審查 A）手機 ${w}：真觸控開懸賞層開關後 state.collectBounty 翻轉且畫面上有金色像素`,
    h13b.collectMap === true && h13c.tglHitSelf === true && h13c.collectBounty === true && h13c.gold > 0, JSON.stringify(h13c));

  await ctx.close();
}

// ── X 組：Codex 獨立審查（2026-07-28）的修復守門員 ─────────────────────────
// 每一條都對應一個**已實測重現過**的失效情境，不是照著建議清單補的形式主義斷言。
// 判準一律不與實作同源：XSS 看 DOM 有沒有真的長出 <img>／marker 有沒有被設，
// 資料層看 localStorage 原始字串，方向看端點站名本身。
{
  // X1/X2：惡意 API 回應（F-01）。伺服器回的 points／pointsLocked 走 innerHTML ⇒
  // 實測 '<img src=x onerror=…>' 真的被執行、document.documentElement.dataset 被設起來。
  const EVIL = '<img src=x onerror="document.documentElement.dataset.xssMark=1">';
  const evilCard = { id: 'x-evil', sys: 'tra_sched', lnId: '南迴線', dir: 0, trainKind: '自強',
    kind: 'track', slot: '', unitKeys: ['tra_sched|南迴線|加祿|枋寮'], units: 1,
    points: EVIL, claimers: EVIL, samples: EVIL, coverN: EVIL };
  {
    const { ctx, page } = await open(browser, { app: true, over: { board: { at: 1, coverN: {}, cards: [evilCard] } } });
    await page.evaluate(() => openBountyBoard());
    await page.waitForTimeout(400);
    const x1 = await page.evaluate(() => ({
      mark: document.documentElement.dataset.xssMark || null,
      imgs: document.querySelectorAll('#bountyList img').length,
      handlers: [...document.querySelectorAll('#bountyList *')].filter(el => el.hasAttribute('onerror') || el.hasAttribute('onload')).length,
      pt: (document.querySelector('#bountyList .bt-pt') || {}).textContent || '',
    }));
    ok('X1 懸賞板：伺服器回的 points 是惡意 HTML 時不會被當程式碼執行（零 <img>、零事件屬性、marker 沒被設）',
      x1.mark === null && x1.imgs === 0 && x1.handlers === 0, JSON.stringify(x1));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { app: true, over: {
      board: { at: 1, coverN: {}, cards: [{ ...evilCard, points: 3, claimers: 0, samples: 0, coverN: 1 }] },
      claim: { ok: true, claimId: 'cl-1', units: 1, pointsLocked: EVIL, expiresAt: Date.now() + 86400000 } } });
    await page.evaluate(() => openBountyBoard());
    await page.waitForTimeout(300);
    await page.evaluate(() => bountyClaim('x-evil'));
    await page.waitForTimeout(700);
    const x2 = await page.evaluate(() => ({
      mark: document.documentElement.dataset.xssMark || null,
      imgs: document.querySelectorAll('#toasts img').length,
      toast: [...document.querySelectorAll('#toasts .toast')].map(t => t.textContent).join(' / '),
      storedPts: (((JSON.parse(localStorage.getItem('trainmap-bounty-v1') || '{}').claims) || {})['x-evil'] || {}).points,
    }));
    ok('X2 接下成功的 toast：伺服器回的 pointsLocked 是惡意 HTML 時不會被執行，落盤的也是數字不是字串',
      x2.mark === null && x2.imgs === 0 && typeof x2.storedPts === 'number', JSON.stringify(x2));
    await ctx.close();
  }
  // X3：落盤失敗不准報成功（F-02）。實測 QuotaExceededError 時舊版照樣說「接下了・39 點」，
  // 磁碟卻是 null——伺服器已經接下、本機什麼都沒有，重新整理就失聯。
  {
    const { ctx, page } = await open(browser, { app: true });
    await page.evaluate(() => openBountyBoard());
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === 'trainmap-bounty-v1') { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
        return orig.call(this, k, v);
      };
    });
    await page.evaluate(() => bountyClaim('tra_sched|南迴線|0|自強|track|'));
    await page.waitForTimeout(700);
    const x3 = await page.evaluate(() => ({
      toast: [...document.querySelectorAll('#toasts .toast')].map(t => t.textContent).join(' / '),
      onDisk: localStorage.getItem('trainmap-bounty-v1'),
    }));
    // 判準兩面：不可以出現無條件的成功句，而且要明講「這台裝置沒存下來」——只做前者，
    // 一句話都不說也會過，那對使用者一樣是靜默失敗。
    ok('X3 localStorage 寫不進去時：不顯示一般成功訊息，且明講這台裝置沒保存住',
      x3.onDisk === null && !/^接下了/.test(x3.toast) && /存不下來|無法保存|沒保存/.test(x3.toast), JSON.stringify(x3));
    await ctx.close();
  }
  // X4：示範資料不得跨出示範（F-04）。舊版把合成旅程與示範認領寫進正式 BOUNTY_KEY，
  // 回到一般網址後金線照畫、bountyToCollections() 照樣把它當真的校正紀錄匯出。
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await ctx.route('**/api/**', r => r.fulfill({ status: 404, body: 'Not Found' })); // 備援站實況
    const page = await ctx.newPage();
    await page.goto(BASE + '/index.html?demo=bounty', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, { timeout: 40000 });
    await page.waitForTimeout(1200); // seedBountyDemo() 的 tick 要等線網建好
    await page.evaluate(() => openBountyBoard());
    await page.waitForTimeout(600);
    await page.evaluate(() => { const c = document.querySelector('.bt-card'); if (c) bountyClaim(c.dataset.card); });
    await page.waitForTimeout(600);
    // X4b 先驗「隔離沒有把示範功能弄壞」——demo 模式自己還是要看得到金線，
    // 否則這條隔離就是拿使用者明天要看的東西去換乾淨。
    // X4b 只問「功能還在不在」，不問「資料放哪」——放哪是 X4 的事。兩件事分開問，
    // 隔離壞掉時才會是 X4 單獨紅，而不是兩條一起紅、分不出是漏了還是壞了。
    const x4b = await page.evaluate(() => ({
      corrected: bountyCorrectedSegs().size,
      claims: Object.keys(loadBounty().claims || {}).length,
    }));
    ok('X4b ?demo=bounty 自己仍然完整：示範旅程有校正段、示範認領存得住（隔離沒有把示範弄壞）',
      x4b.corrected > 0 && x4b.claims === 1, JSON.stringify(x4b));
    // 回到一般網址（同一個 context ⇒ 同一份 localStorage）
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, { timeout: 40000 });
    const x4 = await page.evaluate(() => {
      const raw = localStorage.getItem('trainmap-bounty-v1');
      const b = loadBounty();
      return { rawRealKey: raw, demoKeyUsed: !!localStorage.getItem('trainmap-bounty-demo-v1'),
        trips: Object.keys(b.trips || {}), claims: Object.keys(b.claims || {}),
        corrected: bountyCorrectedSegs().size,
        exported: bountyToCollections(b).corrections.items.map(i => i.id) };
    });
    ok('X4 離開 ?demo=bounty 之後正式資料乾乾淨淨：正式 key 一個字都沒被寫、金色層 0 段、匯出 0 筆',
      x4.rawRealKey === null && x4.demoKeyUsed === true
      && x4.trips.length === 0 && x4.claims.length === 0 && x4.corrected === 0 && x4.exported.length === 0,
      JSON.stringify(x4));
    // 🔴 X4c 存量清理：07-28 06:35 之前的版本已經在使用者裝置上把示範旅程寫進**正式** key
    //（備援站今早就是那一版）。命名空間隔離只保護未來，那一筆得靠 ?demo=off 清掉——而且只能
    // 清掉它自己，同一包裡使用者真正的校正旅程一筆都不能少。
    await page.evaluate(() => {
      localStorage.setItem('trainmap-bounty-v1', JSON.stringify({ v: 1, claims: { 'real-card': { cardId: 'real-card', points: 9 } },
        trips: { 'demo-南迴線-枋寮-臺東': { lnId: '南迴線', sys: 'tra_sched', verdict: 'ok', segs: ['tra_sched|南迴線|加祿|枋寮'], u: 1 },
          'real-trip': { lnId: '宜蘭線', sys: 'tra_sched', verdict: 'ok', segs: ['tra_sched|宜蘭線|蘇澳|蘇澳新'], u: 2 } } }));
    });
    await page.goto(BASE + '/index.html?demo=off', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, { timeout: 40000 });
    await page.waitForTimeout(800);
    const x4c = await page.evaluate(() => {
      const b = JSON.parse(localStorage.getItem('trainmap-bounty-v1') || 'null') || {};
      return { trips: Object.keys(b.trips || {}), claims: Object.keys(b.claims || {}),
        demoKeyLeft: localStorage.getItem('trainmap-bounty-demo-v1') };
    });
    ok('X4c ?demo=off 清得掉舊版寫進正式 key 的那筆示範旅程，且使用者真正的資料一筆沒少',
      x4c.trips.length === 1 && x4c.trips[0] === 'real-trip'
      && x4c.claims.length === 1 && x4c.demoKeyLeft === null, JSON.stringify(x4c));
    await ctx.close();
  }
  // X5：認領狀態（F-05）。舊版按幾次就 POST 幾次、按鈕永遠是「接下這段」，
  // 使用者在說明卡按「等一下再說」之後既看不出自己接過，也回不到那張卡。
  {
    let posts = 0;
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => { Object.assign(window, { RAIL_MUSIC_AVAILABLE: true,
      RAIL_ONLINE_BASEMAPS_AVAILABLE: true, RAIL_APP_CONFIG: { platform: 'ios', build: 'test' } }); });
    await ctx.route('**/api/bounty-board*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BOARD) }));
    await ctx.route('**/api/bounty-claim', r => { posts++; r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, claimId: 'cl-' + posts, units: 11, pointsLocked: 39, expiresAt: Date.now() + 86400000 }) }); });
    await ctx.route('**/api/bounty-me*', r => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ actor: 'x', points: 0, corrected: { segs: 0, adopted: 0 }, lines: [], firsts: [], trips: [] }) }));
    const page = await ctx.newPage();
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, { timeout: 40000 });
    await page.evaluate(() => { const h = document.getElementById('howtoWrap'); if (h) h.remove(); });
    const CID = BOARD.cards[0].id;
    await page.evaluate(() => openBountyBoard());
    await page.waitForTimeout(400);
    await page.evaluate(id => bountyClaim(id), CID);
    await page.waitForTimeout(700);
    const x5 = await page.evaluate(() => {
      const btn = document.querySelector('#bountyList .bt-take');
      const cl = Object.values(loadBounty().claims || {})[0] || {};
      return { label: btn ? btn.textContent : '(無)', claimed: btn ? btn.dataset.claimed : null,
        hasClaimId: typeof cl.claimId === 'string' && cl.claimId.length > 0 };
    });
    // 第二次點下去（真的走按鈕的路徑）：不可以再送一次 POST，且要把說明卡叫回來
    await page.evaluate(() => { document.getElementById('bountyBriefModal').hidden = true; });
    await page.locator('#bountyList .bt-take').first().click();
    await page.waitForTimeout(700);
    const x5b = await page.evaluate(() => ({ briefBack: !document.getElementById('bountyBriefModal').hidden }));
    ok('X5 接下之後卡片看得出已接下（按鈕改字），且 claimId 有存下來',
      /已接下/.test(x5.label) && x5.claimed === '1' && x5.hasClaimId === true, JSON.stringify(x5));
    ok('X5b 再點同一張卡不會重送認領，而是把說明卡叫回來（POST 恰好 1 次）',
      posts === 1 && x5b.briefBack === true, JSON.stringify({ posts, ...x5b }));
    // X5c 鎖價過期後要恢復成可接——否則 24 小時之後這張卡就永遠按不了
    const x5c = await page.evaluate(() => {
      const b = loadBounty();
      for (const k of Object.keys(b.claims)) b.claims[k].expiresAt = Date.now() - 1000;
      saveBounty(b);
      renderBountyBoard();
      const btn = document.querySelector('#bountyList .bt-take');
      return { label: btn ? btn.textContent : '(無)', claimed: btn ? btn.dataset.claimed : null };
    });
    ok('X5c 鎖價過期之後卡片恢復成「接下這段」（不是永久鎖死）',
      /接下這段/.test(x5c.label) && !x5c.claimed, JSON.stringify(x5c));
    await ctx.close();
  }
  // X6：一筆壞資料不得拖垮整包（F-06）。實測 trips.bad=null 讓收集地圖與匯出雙雙丟 TypeError；
  // trips.bad.segs='BAD' 更糟——字串是 iterable，金色集合被污染成 'B'/'A'/'D' 三個偽段鍵。
  {
    const { ctx, page } = await open(browser, { app: true });
    const x6 = await page.evaluate(() => {
      const K = 'trainmap-bounty-v1', GOOD = 'tra_sched|南迴線|加祿|枋寮';
      const good = { lnId: '南迴線', sys: 'tra_sched', segs: [GOOD], verdict: 'ok', u: 1 };
      const cases = {
        nullLeaf: { good, bad: null },
        arrayLeaf: { good, bad: [1, 2, 3] },
        strSegs: { good, bad: { lnId: 'X', sys: 'y', segs: 'BAD', verdict: 'ok', u: 1 } },
        objSegs: { good, bad: { lnId: 'X', sys: 'y', segs: { x: 1 }, verdict: 'ok', u: 1 } },
      };
      const res = {};
      for (const [name, trips] of Object.entries(cases)) {
        localStorage.setItem(K, JSON.stringify({ v: 1, claims: {}, trips }));
        const r = { threw: null, segs: null, exported: null };
        try {
          r.segs = [...bountyCorrectedSegs()];
          r.exported = bountyToCollections(loadBounty()).corrections.items.map(i => i.id);
        } catch (e) { r.threw = String(e).slice(0, 60); }
        res[name] = r;
      }
      localStorage.removeItem(K);
      return { res, GOOD };
    });
    const x6ok = Object.values(x6.res).every(r => r.threw === null
      && Array.isArray(r.segs) && r.segs.length === 1 && r.segs[0] === x6.GOOD   // 合法的那筆還在，且沒有偽段鍵
      && Array.isArray(r.exported) && r.exported.includes('good'));              // 合法的那筆照樣匯得出來
    ok('X6 同包裡有壞掉的一筆時：不丟例外、合法那筆原樣保留、金色集合零偽段鍵（null／陣列／字串 segs／物件 segs 四種）',
      x6ok, JSON.stringify(x6.res));
    await ctx.close();
  }
  // X7：方向（F-07）。舊版 card.dir 從沒被讀過 ⇒ dir:0 與 dir:1 兩張卡的說明卡都印
  // 「枋寮 → 臺東」、預估時間都是同一個數字，使用者出發前看到的是反的方向。
  {
    const { ctx, page } = await open(browser, { app: true });
    const x7 = await page.evaluate(() => {
      const mk = dir => ({ id: 'x', sys: 'tra_sched', lnId: '南迴線', dir, trainKind: '自強', units: 11,
        unitKeys: ['tra_sched|南迴線|加祿|枋寮', 'tra_sched|南迴線|康樂|臺東'] });
      const n0 = bountyCardName(mk(0)), n1 = bountyCardName(mk(1));
      // 期望值：測試自己掃班表算出「該方向自強車次的中位數分鐘」，不呼叫 bountySpanMinutes()。
      // 🔴 第一版寫成「落在該方向的時間全距內」——實測突變（拿掉方向）**照樣全綠**，因為兩個
      // 方向的全距重疊得很厲害（up 71–187、down 70–202），77 分鐘同時落在兩邊。全距太寬＝沒有牙。
      // 改成算具體期望值：方向被忽略時 span1 會拿到 up 的中位數而不是 down 的，兩者今日 77 vs 79。
      const medianOf = (a, b) => {
        const out = [];
        for (const tr of ((((state.systems || []).find(s => s.id === 'tra_sched') || {}).data || {}).trains || [])) {
          const st = tr.stops || [];
          const i = st.findIndex(s => s.name === a), j = st.findIndex((s, k) => k > i && s.name === b);
          if (i < 0 || j < 0 || !st[i].stop || !st[j].stop) continue;
          const m = (st[j].arrSec - st[i].depSec) / 60;
          if (m > 0 && ((tr.typeName || '') + (tr.carName || '')).includes('自強')) out.push(m);
        }
        out.sort((x, y) => x - y);
        return out.length ? Math.round(out[Math.floor(out.length / 2)]) : null;
      };
      return { dir0: [n0.from, n0.to], dir1: [n1.from, n1.to],
        span0: bountySpanMinutes('tra_sched', n0.from, n0.to, '自強'),
        span1: bountySpanMinutes('tra_sched', n1.from, n1.to, '自強'),
        wantUp: medianOf('枋寮', '臺東'), wantDown: medianOf('臺東', '枋寮') };
    });
    ok('X7 dir:1 的卡端點是反的（臺東 → 枋寮），dir:0 才是 枋寮 → 臺東',
      x7.dir0[0] === '枋寮' && x7.dir0[1] === '臺東' && x7.dir1[0] === '臺東' && x7.dir1[1] === '枋寮',
      JSON.stringify({ dir0: x7.dir0, dir1: x7.dir1 }));
    ok('X7b 預估時間跟著方向走：各自等於該方向自強車次的中位數（期望值由測試自己掃班表算出來）',
      x7.wantUp != null && x7.wantDown != null && x7.span0 === x7.wantUp && x7.span1 === x7.wantDown,
      JSON.stringify({ span0: x7.span0, wantUp: x7.wantUp, span1: x7.span1, wantDown: x7.wantDown }));
    // X7c 端到端：不是只有函式回對，說明卡上真的印出反方向
    const x7c = await page.evaluate(async () => {
      const card = { id: 'x1', sys: 'tra_sched', lnId: '南迴線', dir: 1, trainKind: '自強', units: 11,
        unitKeys: ['tra_sched|南迴線|加祿|枋寮', 'tra_sched|南迴線|康樂|臺東'] };
      showBountyBrief(card, { points: 39, expiresAt: Date.now() + 86400000 });
      await new Promise(r => setTimeout(r, 200));
      return document.getElementById('bountyBriefBody').innerText.replace(/\n/g, ' ');
    });
    ok('X7c 說明卡上真的印出反方向（臺東 → 枋寮），不是只有函式回傳值對',
      /臺東\s*→\s*枋寮/.test(x7c), x7c.slice(0, 120));
    await ctx.close();
  }
  // X8：verdict 白名單（F-09）。規格 §7 的三態表只有 ok／unusable 給章；pending 是「還沒判」，
  // 舊版只排除 suspect ⇒ pending、缺 verdict、未來新增的任何值都自動當成已通過防偽上金色。
  {
    const { ctx, page } = await open(browser, { app: true });
    const x8 = await page.evaluate(() => {
      const K = 'trainmap-bounty-v1';
      const res = {};
      for (const v of ['ok', 'unusable', 'suspect', 'pending', '(缺 verdict)', 'brand_new_value']) {
        const t = { lnId: '南迴線', sys: 'tra_sched', segs: ['tra_sched|南迴線|加祿|枋寮'], u: 1 };
        if (v !== '(缺 verdict)') t.verdict = v;
        localStorage.setItem(K, JSON.stringify({ v: 1, claims: {}, trips: { t } }));
        res[v] = bountyCorrectedSegs().size;
      }
      localStorage.removeItem(K);
      return res;
    });
    ok('X8 只有 ok／unusable 上金色：suspect、pending、缺 verdict、未知值一律 fail-closed',
      x8.ok === 1 && x8.unusable === 1 && x8.suspect === 0 && x8.pending === 0
      && x8['(缺 verdict)'] === 0 && x8.brand_new_value === 0, JSON.stringify(x8));
    await ctx.close();
  }
}

const pass = R.filter(r => r.p).length;
printSummary();
await browser.close();
process.exit(pass === R.length ? 0 : 1);
