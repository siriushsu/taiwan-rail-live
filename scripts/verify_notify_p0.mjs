// 本地到站提醒（P0）+ 批次A2 驗收腳本 —— Playwright，涵蓋 §6 A–F。
//
// 跑法：
//   1) 於 repo 根目錄起靜態站：  python3 -m http.server 5178
//   2) 執行：                    node scripts/verify_notify_p0.mjs
//   （要換 port：NOTIFY_BASE=http://127.0.0.1:5179/ node scripts/verify_notify_p0.mjs）
//
// 涵蓋：
//   A 既有零回歸（批次A 全部案例：無 mock 入口、一般/收藏/終點到達、跨日/過近拒絕、
//     誤點快照凍結、20 筆上限/候補/雙跑同步冪等、primer/denied、手機四寬觸控）＋ v0721e 下拉過站過濾/淺色禁選/自動跳選
//   B ①基準切換（中途站可切到達前＝arrSec、獨立重算相等；終點鎖定；切換後 disabled 重算＋不合法自動跳；舊 schema migration 零位移）
//   C ②末班車（≤5 班且尚未發車；撥到最後一班之後全禁選＋toast；儲存後清單/上限/同步照舊；真實 board 🔔 入口可開）
//   D ④總覽（2 班不同車次→兩筆；刪一筆即時消失＋mock pending 同步；空清單顯示空狀態）
//   E 手機四寬掃描含全部新入口（board 🔔、更多列、basis 切換鈕）：命中／相交／44px／無橫向溢出
//   F 無 mock：所有新入口不可見、零 console error
//
// 斷言刻意避開會腐化的字面值：BUILD 只驗格式 /v\d{4}[a-z]/，不 assert 具體版號與更新紀錄日期。

let pw;
try { pw = await import('playwright'); }
catch { pw = await import(process.env.PLAYWRIGHT_MJS ?? '/Users/xuxiang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'); }
const { chromium } = pw;

const BASE = process.env.NOTIFY_BASE || 'http://127.0.0.1:5178/';
const STORAGE_KEY = 'trainmap-local-reminders-v1';
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
const results = {}; // caseName -> 'PASS' | 'FAIL: ...'
const detail = {};

async function boot(page, query = '') {
  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(BASE + query, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__state && window.__state.ready, null, { timeout: 60000 });
  if (await page.locator('#howtoWrap').isVisible()) await page.locator('#howtoSkip').click();
}
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  return errors;
}
async function openRandomFollow(page) {
  await page.locator('#randBtn').click();
  await page.locator('#followPanel:not([hidden])').waitFor();
}
async function openNotifyFromFollow(page) {
  await page.locator('#fpNotify').click();
  await page.locator('#notifyModal:not([hidden])').waitFor();
}
async function readDraft(page) {
  return page.evaluate(() => {
    const d = document.getElementById('notifyModal').dataset;
    return {
      baseSec: +d.notifyBaseSec, serviceEpoch: +d.notifyServiceEpoch,
      delay: +d.notifySnapshotDelaySec, offset: +d.notifyOffsetMin,
      walk: +d.notifyWalkMin, fireAt: +d.notifyFireAt,
      mode: document.getElementById('notifyModeLabel').textContent,
      preview: document.getElementById('notifyPreview').textContent,
    };
  });
}
async function mockState(page) {
  return page.evaluate(k => ({
    log: window.__notifyMockLog,
    pending: window.__notifyMockPending,
    items: JSON.parse(localStorage.getItem(k) || '[]'),
  }), STORAGE_KEY);
}
function assertMath(draft, label) {
  assert(draft.fireAt === draft.serviceEpoch + draft.baseSec + draft.delay - (draft.offset + draft.walk) * 60,
    `${label}: fireAt 數學不一致`);
}
// 手機掃描：能見控件的命中、相交、44px、橫向溢出。min44Exempt=不強制 44（板頭圖示鈕沿用 ☆/× 22px 慣例）。
async function scan(page, selectors) {
  return page.evaluate(selectors => {
    const visible = el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > .01 && r.width > 0 && r.height > 0; };
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; };
    const hitSelf = el => { const r = el.getBoundingClientRect(), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && (h === el || el.contains(h)); };
    const topmost = el => { const r = el.getBoundingClientRect(), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && (h === el || el.contains(h)); };
    const targets = selectors.flatMap(s => [...document.querySelectorAll(s)]).filter(visible);
    const controls = [...document.querySelectorAll('button,a[href],input,select,label,[role=button],.rm,.row[data-no],.row[data-stkey],#followPanel,#alertBanner,.ms-row,.notify-basis button')].filter(visible);
    const collisions = [];
    for (const a of targets) { const ar = a.getBoundingClientRect(); for (const b of controls) { if (a === b || a.contains(b) || b.contains(a) || !topmost(b)) continue; const br = b.getBoundingClientRect(); const iw = Math.min(ar.right, br.right) - Math.max(ar.left, br.left), ih = Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top); if (iw > 1 && ih > 1) collisions.push(`${a.id || a.className}<->${b.id || b.className}`); } }
    return { targets: targets.map(el => ({ id: el.id || el.className, rect: rect(el), hit: hitSelf(el), min44: el.getBoundingClientRect().width >= 44 && el.getBoundingClientRect().height >= 44 })), collisions, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  }, selectors);
}
async function toSchedTraStation(page) {
  // 切到「國家鐵路（sched）」群組並取一個台鐵站（只數台鐵班次，避開共構同名站）
  await page.evaluate(() => { const g = GROUPS.find(x => x.id === 'nat'); if (state.group !== 'nat') selectGroup(g); else if (state.mode !== 'sched') loadSchedGroup(g); });
  await page.waitForFunction(() => state.mode === 'sched' && state.trains && state.trains.length > 0, null, { timeout: 30000 });
  return page.evaluate(() => {
    const c = {}; for (const tr of state.trains) { if (tr.sys !== 'tra_sched') continue; for (const s of tr.stops || []) if (s.stop !== false) c[s.name] = (c[s.name] || 0) + 1; }
    const name = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
    return { name, sys: 'tra_sched' };
  });
}

const browser = await chromium.launch({ headless: true });
async function run(name, fn) {
  const context = await browser.newContext(name.startsWith('E:') ? undefined : { viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = watchErrors(page);
  try { await fn(page, errors, context); results[name] = 'PASS'; }
  catch (e) { results[name] = 'FAIL: ' + e.message; }
  finally { await context.close(); }
}

try {
  // ─────────── A. 既有零回歸（批次A 全部案例）───────────

  // A1 無 mock：兩處入口皆不存在（§F 亦覆蓋，這裡先驗跟隨/收藏入口）
  await run('A1:web-no-mock', async (page, errors) => {
    await boot(page, '?case=nomock');
    assert(await page.locator('#fpNotify').count() === 0, '無 mock 時跟隨入口仍存在');
    await openRandomFollow(page);
    await page.locator('#tcStar').click(); await page.locator('#favBtn').click();
    assert(await page.locator('.row.fv').count() === 1, '無 mock 收藏列未建立');
    assert(await page.locator('.fv-notify').count() === 0, '無 mock 時收藏入口仍存在');
    assert(/v\d{4}[a-z]/.test(await page.locator('#buildVer').innerText()), 'BUILD 格式不符 /v\\d{4}[a-z]/');
    assert(errors.length === 0, '無 mock console error: ' + errors.join(' | '));
    detail.A1 = { followEntry: 0, favoriteEntry: 0, consoleErrors: 0 };
  });

  // A2 一般案／收藏入口／終點到達基準案
  await run('A2:general-terminal', async (page, errors) => {
    await boot(page, '?notifymock=1&notifyreset=1&notifynow=0&case=general');
    await openRandomFollow(page); assert(await page.locator('#fpNotify').isVisible(), '跟隨入口不可見');
    await openNotifyFromFollow(page);
    assert(await page.getByText('提前', { exact: true }).count() === 1, '缺少定稿欄位標籤「提前」');
    await page.locator('#notifyStation').selectOption({ index: 0 });
    const general = await readDraft(page); assert(general.mode === '開車前', '一般案不是發車基準'); assertMath(general, '一般案');
    await page.locator('#notifySave').click();
    await page.locator('.notify-reminder-row').waitFor();
    let state = await mockState(page); let scheduled = state.log.filter(x => x.op === 'schedule').at(-1).notifications[0];
    assert(new Date(scheduled.schedule.at).getTime() === general.fireAt * 1000, '一般案 payload at 不一致');
    assert(scheduled.title.includes('開車前'), '一般案(dep) 通知標題未含「開車前」');
    await page.locator('#notifyClose').click(); await page.locator('#tcStar').click(); await page.locator('#favBtn').click();
    assert(await page.locator('.fv-notify').count() === 1, '收藏提醒入口不是 1');
    await page.locator('.fv-notify').click(); assert(await page.locator('#notifyStation').evaluate(el => el.selectedIndex) === 0, '收藏入口未預選起點');
    const options = await page.locator('#notifyStation option').count();
    await page.locator('#notifyStation').selectOption({ index: options - 1 }); await page.locator('#notifyWalk').fill('5');
    const terminal = await readDraft(page); assert(terminal.mode === '到達前', '終點未改到達基準'); assertMath(terminal, '終點案');
    await page.locator('#notifySave').click();
    await page.waitForFunction(() => window.__notifyMockLog.filter(x => x.op === 'schedule').length >= 2);
    state = await mockState(page); scheduled = state.log.filter(x => x.op === 'schedule').at(-1).notifications[0];
    assert(scheduled.title.includes('抵達前 15 分鐘'), '終點通知 title 未含步行提前量');
    assert(errors.length === 0, '一般/終點 console error: ' + errors.join(' | '));
    detail.A2 = { generalFireAt: general.fireAt, terminalFireAt: terminal.fireAt, favoriteEntry: 1 };
  });

  // A3 跨日案／過近拒絕案
  let crossInfo;
  await run('A3:crossday-near', async (page, errors) => {
    await boot(page, '?notifymock=1&notifyreset=1&notifynow=0&case=cross');
    crossInfo = await page.evaluate(() => JSON.parse(document.documentElement.dataset.notifyMockCrossDay));
    await page.locator('#trainSearch').fill(crossInfo.train); await page.locator('#trainSearch').press('Enter');
    await page.locator('#fpNotify').waitFor(); await openNotifyFromFollow(page);
    const options = await page.locator('#notifyStation option').count(); await page.locator('#notifyStation').selectOption({ index: options - 1 });
    const cross = await readDraft(page); assert(cross.baseSec > 86400, '跨日案 baseSec 未超過 86400'); assertMath(cross, '跨日案');
    await page.getByRole('button', { name: '設定提醒', exact: true }).click(); await page.locator('.notify-reminder-row').waitFor();
    const crossState = await mockState(page); const crossPayload = crossState.log.filter(x => x.op === 'schedule').at(-1).notifications[0];
    assert(new Date(crossPayload.schedule.at).getTime() === cross.fireAt * 1000, '跨日 payload at 不一致');
    await page.locator('#notifyClose').click(); await openNotifyFromFollow(page); await page.locator('#notifyStation').selectOption({ index: options - 1 });
    const near = await readDraft(page); await page.evaluate(v => { window.__notifyMockNowEpoch = v; window.__notifyMockLog.length = 1; }, near.fireAt - 30);
    await page.getByRole('button', { name: '更新提醒', exact: true }).click();
    await page.getByText('太接近發車時間，來不及提醒', { exact: true }).waitFor();
    assert((await mockState(page)).log.every(x => x.op !== 'schedule'), '過近案仍發出 schedule');
    assert(errors.length === 0, '跨日/過近 console error: ' + errors.join(' | '));
    detail.A3 = { train: crossInfo.train, baseSec: cross.baseSec, rejected: true };
  });

  // A4 誤點快照凍結
  await run('A4:delay-snapshot', async (page, errors) => {
    const cross = crossInfo || (await page.evaluate(() => JSON.parse(document.documentElement.dataset.notifyMockCrossDay || 'null')));
    await boot(page, `?notifymock=1&notifyreset=1&notifynow=0&notifydelay=360&train=${(cross && cross.train) || ''}&case=delay`);
    await page.locator('#fpNotify').waitFor(); await openNotifyFromFollow(page);
    const options = await page.locator('#notifyStation option').count(); await page.locator('#notifyStation').selectOption({ index: options - 1 });
    const first = await readDraft(page); assert(first.preview.includes('+6 分'), '預覽未反映 +6 分');
    await page.getByRole('button', { name: '設定提醒', exact: true }).click(); await page.locator('.notify-reminder-row').waitFor();
    const stored = (await mockState(page)).items[0];
    await page.locator('#notifyClose').click(); await page.evaluate(() => { window.__notifyMockDelaySec = 720; }); await openNotifyFromFollow(page);
    await page.locator('#notifyStation').selectOption({ index: options - 1 }); const second = await readDraft(page); const after = (await mockState(page)).items[0];
    assert(second.preview.includes('+12 分'), '新預覽未反映 +12 分');
    assert(stored.fireAt === after.fireAt && after.snapshotDelaySec === 360, '既有提醒的快照被改寫');
    assert(errors.length === 0, '誤點快照 console error: ' + errors.join(' | '));
    detail.A4 = { firstPreview: first.preview, secondPreview: second.preview, frozenDelaySec: after.snapshotDelaySec };
  });

  // A5 上限/候補/雙跑冪等
  await run('A5:limit-idempotence', async (page, errors) => {
    await boot(page, '?notifymock=1&notifyreset=1&notifyseed=21&notifysync=2&notifynow=0&case=limit');
    let state = await mockState(page); const initialCalls = state.log.filter(x => x.op === 'schedule');
    assert(state.pending.length === 20 && state.items.filter(x => x.state === 'scheduled').length === 20 && state.items.filter(x => x.state === 'standby').length === 1, '21 筆上限狀態錯誤');
    assert(initialCalls.length === 1 && initialCalls[0].notifications.length === 20, '雙跑同步不冪等');
    await openRandomFollow(page); await openNotifyFromFollow(page); assert(await page.getByText('候補中', { exact: true }).count() === 1, '清單沒有候補中');
    await page.locator('.notify-reminder-row button').first().click(); await page.waitForFunction(k => JSON.parse(localStorage.getItem(k)).length === 20, STORAGE_KEY);
    state = await mockState(page); assert(state.pending.length === 20 && state.items.every(x => x.state === 'scheduled'), '刪除後未選候補');
    const before = state.log.length; await page.evaluate(async () => { await syncLocalReminders(); await syncLocalReminders(); });
    state = await mockState(page); assert(state.log.length === before, '刪除後雙跑同步又產生動作');
    assert(errors.length === 0, '20 筆上限 console error: ' + errors.join(' | '));
    detail.A5 = { pending: 20, standby: 1, repeatedSyncExtraOps: 0 };
  });

  // A6 primer / denied
  await run('A6:primer-denied', async (page, errors) => {
    await boot(page, '?notifymock=1&notifyreset=1&notifynow=0&notifyperm=prompt&case=primer');
    await openRandomFollow(page); await openNotifyFromFollow(page); await page.getByRole('button', { name: '設定提醒', exact: true }).click();
    await page.getByRole('heading', { name: '開車前叫你', exact: true }).waitFor(); await page.getByRole('button', { name: '先不要', exact: true }).click();
    assert((await mockState(page)).log.every(x => x.op !== 'requestPermissions'), '先不要仍請求系統權限');
    await page.getByRole('button', { name: '設定提醒', exact: true }).click(); await page.getByRole('button', { name: '好，提醒我', exact: true }).click();
    await page.locator('.notify-reminder-row').waitFor(); assert((await mockState(page)).log.filter(x => x.op === 'requestPermissions').length === 1, 'primer 未正確請求權限');
    await page.locator('#notifyClose').click(); await page.evaluate(() => { window.__notifyMockPermission = 'denied'; }); await openNotifyFromFollow(page);
    await page.getByText('通知權限已關閉，請到 設定 > 軌島 開啟', { exact: true }).waitFor();
    assert(!(await page.locator('#notifySettings').isVisible()), '沒有 openSettings 卻顯示按鈕');
    assert(errors.length === 0, 'primer console error: ' + errors.join(' | '));
    detail.A6 = { primerRequired: true, confirmedRequests: 1, deniedGuide: true };
  });

  // A7 v0721e 下拉：過站過濾 + 淺色禁選 + 自動跳選
  await run('A7:v0721e-dropdown', async (page, errors) => {
    await boot(page, '?notifymock=1&notifyreset=1&notifynow=0&case=v0721e');
    await openRandomFollow(page); await openNotifyFromFollow(page);
    // 過站過濾：下拉每個選項對應的站 arrSec 都 > schedNow（已過的站不列）
    const filt = await page.evaluate(() => {
      const d = localReminderDraft; const schedNow = effT(d.tr) - d.snapshotDelaySec;
      return { totalStops: d.tr.stops.length, listed: d.stops.length, allUpcoming: d.stops.every(x => x.s.arrSec > schedNow) };
    });
    assert(filt.allUpcoming, '過站過濾失效：下拉列出已過站');
    assert(filt.listed >= 1 && filt.listed <= filt.totalStops, '過站過濾後站數異常');
    // 淺色禁選＋自動跳選：把時鐘撥到第一個上車站的 fireAt 之後 → 該站 disabled、選擇自動跳到下一個來得及的站
    const jump = await page.evaluate(() => {
      const d = localReminderDraft;
      if (d.stops.length < 2) return { skip: true };
      const fa0 = localReminderFireAtFor(d, d.stops[0]);
      const fa1 = localReminderFireAtFor(d, d.stops[1]);
      window.__notifyMockNowEpoch = Math.floor(fa0 + 30); // 介於 stop0 與(較晚的)stop1 之間
      renderLocalReminderDraft();
      const opts = [...document.querySelectorAll('#notifyStation option')];
      return { skip: false, opt0Disabled: opts[0].disabled, selIdx: document.getElementById('notifyStation').selectedIndex, selDisabled: opts[document.getElementById('notifyStation').selectedIndex].disabled, fa0, fa1 };
    });
    if (!jump.skip) {
      assert(jump.opt0Disabled, 'v0721e：來不及的站未淺色禁選');
      assert(!jump.selDisabled && jump.selIdx > 0, 'v0721e：未自動跳到來得及的站');
    }
    await page.evaluate(() => { window.__notifyMockNowEpoch = 0; });
    assert(errors.length === 0, 'v0721e console error: ' + errors.join(' | '));
    detail.A7 = { ...filt, autoJumped: jump.skip ? 'n/a(單站)' : (jump.selIdx > 0) };
  });

  // ─────────── B. ①基準切換 ───────────
  await run('B:basis-switch', async (page, errors) => {
    await boot(page, '?notifymock=1&notifyreset=1&notifynow=0&case=basis');
    await openRandomFollow(page); await openNotifyFromFollow(page);
    // 中途站切到達前 → baseSec 用 arrSec，且 fireAt 獨立重算相等
    const mid = await page.evaluate(() => {
      const d = localReminderDraft;
      const midIdx = d.stops.findIndex(x => x.i !== d.tr.stops.length - 1); // 非終點
      const sel = document.getElementById('notifyStation'); sel.selectedIndex = midIdx; sel.dispatchEvent(new Event('change'));
      const stop = localReminderDraft.stops.find(x => x.i === localReminderDraft.stIndex);
      return { midIdx, arrSec: stop.s.arrSec, depSec: stop.s.depSec };
    });
    const beforeSwitch = await readDraft(page);
    assert(beforeSwitch.baseSec === mid.depSec, '中途站預設應為開車前(depSec)');
    await page.locator('#notifyBasis button[data-basis="arr"]').click();
    const afterSwitch = await readDraft(page);
    const recalc = await page.evaluate(() => {
      const d = localReminderDraft; const stop = d.stops.find(x => x.i === d.stIndex);
      return { baseSec: d.baseSec, indepFireAt: localReminderServiceEpoch(d.svcDate, stop.s.arrSec) + d.snapshotDelaySec - (d.offsetMin + d.walkMin) * 60, arrSec: stop.s.arrSec, mode: d.mode };
    });
    assert(afterSwitch.mode === '到達前', '切換後模式非到達前');
    assert(recalc.baseSec === recalc.arrSec, '切到達前後 baseSec 未改為 arrSec');
    assert(afterSwitch.fireAt === recalc.indepFireAt, '到達前 fireAt 與獨立重算不符');
    assertMath(afterSwitch, '到達前案');
    // 終點站鎖定：選最後一站 → 開車前鈕 disabled、到達前 on
    const term = await page.evaluate(() => {
      const d = localReminderDraft; const lastListed = d.stops[d.stops.length - 1];
      const sel = document.getElementById('notifyStation'); sel.value = String(lastListed.i); sel.dispatchEvent(new Event('change'));
      const isTerm = lastListed.i === d.tr.stops.length - 1;
      const btns = [...document.querySelectorAll('#notifyBasis button')].reduce((o, b) => (o[b.dataset.basis] = { on: b.classList.contains('on'), dis: b.disabled }, o), {});
      return { isTerm, btns, mode: document.getElementById('notifyModeLabel').textContent };
    });
    if (term.isTerm) {
      assert(term.btns.dep.dis && term.btns.arr.on && term.mode === '到達前', '終點站未鎖定到達前');
    }
    // 切換 basis 重算 disabled 集合 + 不合法自動跳：對「有停站時間(dwell>0)」的中途站,
    // 設時鐘 now = depFa-61 → 開車前基準下該站仍合法、到達前基準下變 disabled(門檻 <= now+60)。
    const recompute = await page.evaluate(() => {
      const d = localReminderDraft;
      const lead = (x) => d.snapshotDelaySec - (d.offsetMin + d.walkMin) * 60;
      const fa = (x, sec) => localReminderServiceEpoch(d.svcDate, sec) + lead(x);
      // 找第一個非終點且 depSec>arrSec(有停站秒數)的站
      const target = d.stops.find(x => x.i !== d.tr.stops.length - 1 && x.s.depSec > x.s.arrSec);
      if (!target) return { skip: true };
      const sel = document.getElementById('notifyStation'); sel.value = String(target.i); sel.dispatchEvent(new Event('change'));
      const depFa = fa(target, target.s.depSec);
      window.__notifyMockNowEpoch = Math.floor(depFa) - 61; // dep 來得及(depFa>now+60)、arr 來不及(arrFa<=now+60)
      localReminderDraft.basis = 'dep'; renderLocalReminderDraft();
      const depIdx = localReminderDraft.stIndex;
      const depOptDisabled = [...document.querySelectorAll('#notifyStation option')].find(o => Number(o.value) === target.i).disabled;
      // 切到 arr：目前站變 disabled → 自動跳到別站
      document.querySelector('#notifyBasis button[data-basis="arr"]').click();
      const arrIdx = localReminderDraft.stIndex;
      const arrOptForTargetDisabled = [...document.querySelectorAll('#notifyStation option')].find(o => Number(o.value) === target.i).disabled;
      window.__notifyMockNowEpoch = 0;
      return { skip: false, depStayed: depIdx === target.i, depOptDisabled, jumped: arrIdx !== target.i, arrOptForTargetDisabled };
    });
    if (!recompute.skip) {
      assert(recompute.depStayed && !recompute.depOptDisabled, '開車前基準下該站應仍合法且可選');
      assert(recompute.arrOptForTargetDisabled, '切到達前後該站未被淺色禁選');
      assert(recompute.jumped, '切到達前後不合法站未自動跳選');
    }
    // 舊 schema migration 零位移：植入無 basis 的舊項目，sync 後 payload.at 不變、item 補上 basis
    const migrate = await page.evaluate(async k => {
      const now = localNotifyNowEpoch();
      const legacy = [{ id: 777, sys: 'tra', train: '1234', stName: '臺北', mode: 'dep', offsetMin: 10, walkMin: 0, fireAt: now + 7200, snapshotDelaySec: 0, svcDate: todayStr('Asia/Taipei'), state: 'scheduled' }];
      localStorage.setItem(k, JSON.stringify(legacy));
      window.__notifyMockLog.length = 0; window.__notifyMockPending.length = 0;
      await syncLocalReminders();
      const loaded = window.__localNotifyTest.load().find(x => x.id === 777);
      const sch = window.__notifyMockLog.filter(x => x.op === 'schedule').at(-1);
      const payload = sch.notifications.find(n => n.id === 777);
      return { origFireAt: now + 7200, scheduledAt: new Date(payload.schedule.at).getTime() / 1000, loadedBasis: loaded.basis, loadedFireAt: loaded.fireAt, title: payload.title };
    }, STORAGE_KEY);
    assert(migrate.scheduledAt === migrate.origFireAt, 'migration 後 fireAt 位移');
    assert(migrate.loadedFireAt === migrate.origFireAt, 'migration 改寫了 fireAt');
    assert(migrate.loadedBasis === 'dep', 'migration 未由 mode 推得 basis=dep');
    assert(migrate.title.includes('開車前'), 'migration(dep) 標題非「開車前」');
    assert(errors.length === 0, 'basis console error: ' + errors.join(' | '));
    detail.B = { midArrEqualsArrSec: true, migrationZeroShift: true, autoJumpOnBasis: recompute.skip ? 'n/a' : recompute.jumped, terminalLock: term.isTerm ? true : 'n/a' };
  });

  // ─────────── C. ②末班車 ───────────
  await run('C:last-train', async (page, errors) => {
    await boot(page, '?notifymock=1&notifyreset=1&notifynow=0&case=lasttrain');
    const st = await toSchedTraStation(page);
    // 讀候選（固定 5 班）並把時鐘撥到「全部尚未發車」之前 → 全 enabled、皆尚未發車
    const cands = await page.evaluate(s => window.__localNotifyTest.lastTrainCands(s.name, s.sys), st);
    assert(cands.length >= 1 && cands.length <= 5, `末班車候選數應 1..5，實得 ${cands.length}`);
    const svcEpoch = await page.evaluate(s => window.__localNotifyTest.serviceEpoch(todayStr('Asia/Taipei'), 0), st);
    const depEpochs = cands.map(c => svcEpoch + c.depSec);
    const minDep = Math.min(...depEpochs), maxDep = Math.max(...depEpochs);
    await page.evaluate(v => { window.__notifyMockNowEpoch = v; }, minDep - 3600); // 全部尚未發車
    await page.evaluate(s => window.__localNotifyTest.lastTrain(s.name, s.sys), st);
    await page.locator('#notifyModal:not([hidden])').waitFor();
    const early = await page.evaluate(() => {
      const view = document.getElementById('notifyModal').dataset.notifyView;
      const lt = JSON.parse(document.getElementById('notifyModal').dataset.notifyLastTrain || '[]');
      const opts = [...document.querySelectorAll('#notifyStation option')];
      return { view, title: document.getElementById('notifyTitle').textContent, n: opts.length, allEnabled: opts.every(o => !o.disabled), allUpcoming: lt.every(c => c.depEpoch > window.__notifyMockNowEpoch), fmtOk: /往.+\d{2}:\d{2}$/.test(opts[0].textContent.trim()) };
    });
    assert(early.view === 'lasttrain' && early.title === '末班車提醒', '末班車模式標題/檢視錯誤');
    assert(early.n <= 5 && early.n >= 1, '末班車列數非 ≤5');
    assert(early.allUpcoming, '末班車列出已發車班次（非「尚未發車」）');
    assert(early.allEnabled, '尚未發車卻有淺色禁選');
    assert(early.fmtOk, '選項格式非「車次 往終點 HH:MM」');
    // 撥到最後一班之後 → 全禁選 + toast
    await page.evaluate(() => { const b = document.getElementById('toasts'); if (b) b.innerHTML = ''; });
    await page.evaluate(v => { window.__notifyMockNowEpoch = v; }, maxDep + 3600);
    await page.evaluate(s => window.__localNotifyTest.lastTrain(s.name, s.sys), st);
    await page.waitForTimeout(150);
    const late = await page.evaluate(() => ({
      allDisabled: [...document.querySelectorAll('#notifyStation option')].every(o => o.disabled),
      toast: [...document.querySelectorAll('#toasts .toast')].map(t => t.textContent),
    }));
    assert(late.allDisabled, '撥到末班後未全禁選');
    assert(late.toast.includes('今天的末班車已經開走了'), '末班全禁選未出現 toast');
    // 儲存一筆（撥回可選時段）→ 進既有 engine：清單/pending/冪等
    await page.evaluate(v => { window.__notifyMockNowEpoch = v; }, minDep - 3600);
    await page.evaluate(s => window.__localNotifyTest.lastTrain(s.name, s.sys), st);
    await page.locator('#notifyModal:not([hidden])').waitFor();
    await page.evaluate(() => { window.__notifyMockLog.length = 0; });
    await page.getByRole('button', { name: '設定提醒', exact: true }).click();
    await page.locator('.notify-reminder-row').waitFor();
    const saved = await page.evaluate(async () => {
      const items = window.__localNotifyTest.load();
      const before = window.__notifyMockLog.length; await syncLocalReminders(); await syncLocalReminders();
      return { count: items.length, pending: window.__notifyMockPending.length, extraOps: window.__notifyMockLog.length - before, storedMode: items[0] && items[0].mode, storedBasis: items[0] && items[0].basis };
    });
    assert(saved.count === 1 && saved.pending === 1, '末班車儲存後清單/pending 不是 1');
    assert(saved.extraOps === 0, '末班車儲存後雙跑同步不冪等');
    assert(saved.storedMode === 'dep' && saved.storedBasis === 'dep', '末班車項目非 basis=dep');
    // 真實 board 🔔 入口可開（桌面點板頭鈴鐺）
    await page.locator('#notifyClose').click();
    await page.evaluate(s => { const stObj = state.schedStations.find(x => x.sys === s.sys && x.name === s.name); openBoard(stObj); }, st);
    await page.locator('#board:not([hidden])').waitFor();
    assert(await page.locator('#boardNotify').count() === 1, 'board sticky h3 內無 🔔 入口');
    await page.locator('#boardNotify').click();
    await page.locator('#notifyModal:not([hidden])').waitFor();
    assert(await page.evaluate(() => document.getElementById('notifyModal').dataset.notifyView) === 'lasttrain', 'board 🔔 未開末班車模式');
    assert(errors.length === 0, 'last-train console error: ' + errors.join(' | '));
    detail.C = { candidates: cands.length, earlyAllEnabled: true, lateAllDisabledToast: true, savedViaEngine: true, boardEntry: true };
  });

  // ─────────── D. ④總覽 ───────────
  await run('D:overview', async (page, errors) => {
    await boot(page, '?notifymock=1&notifyreset=1&notifynow=0&case=overview');
    // 植入兩班不同車次的提醒 + sync
    await page.evaluate(async k => {
      const now = localNotifyNowEpoch();
      const two = [
        { id: 11, sys: 'tra', train: '111', stName: '臺北', mode: 'dep', basis: 'dep', offsetMin: 10, walkMin: 0, fireAt: now + 3600, snapshotDelaySec: 0, svcDate: todayStr('Asia/Taipei'), state: 'scheduled' },
        { id: 22, sys: 'thsr', train: '222', stName: '板橋', mode: 'arr', basis: 'arr', offsetMin: 10, walkMin: 0, fireAt: now + 7200, snapshotDelaySec: 0, svcDate: todayStr('Asia/Taipei'), state: 'scheduled' },
      ];
      localStorage.setItem(k, JSON.stringify(two)); window.__notifyMockLog.length = 0; window.__notifyMockPending.length = 0;
      await syncLocalReminders();
    }, STORAGE_KEY);
    await page.evaluate(() => window.__localNotifyTest.overview());
    await page.locator('#notifyModal:not([hidden])').waitFor();
    const ov = await page.evaluate(() => ({
      view: document.getElementById('notifyModal').dataset.notifyView,
      title: document.getElementById('notifyTitle').textContent,
      rows: document.querySelectorAll('.notify-reminder-row').length,
      formHidden: getComputedStyle(document.querySelector('.notify-primary')).display === 'none' && getComputedStyle(document.querySelector('.notify-preview')).display === 'none',
    }));
    assert(ov.view === 'overview' && ov.title === '已排提醒', '總覽檢視/標題錯誤');
    assert(ov.rows === 2, `總覽應顯示兩筆，實得 ${ov.rows}`);
    assert(ov.formHidden, '總覽未隱藏草稿表單');
    // 刪一筆 → 即時消失 + mock pending 同步
    await page.locator('.notify-reminder-row button').first().click();
    await page.waitForFunction(() => document.querySelectorAll('.notify-reminder-row').length === 1);
    const afterDel = await page.evaluate(() => ({ rows: document.querySelectorAll('.notify-reminder-row').length, pending: window.__notifyMockPending.length, items: window.__localNotifyTest.load().length }));
    assert(afterDel.rows === 1 && afterDel.pending === 1 && afterDel.items === 1, '刪一筆後清單/pending 未同步為 1');
    // 刪最後一筆 → 空狀態
    await page.locator('.notify-reminder-row button').first().click();
    await page.waitForFunction(() => document.querySelectorAll('.notify-reminder-row').length === 0);
    const empty = await page.evaluate(() => { const e = document.querySelector('.notify-empty'); return { present: !!e, visible: e && getComputedStyle(e).display !== 'none', text: e && e.textContent }; });
    assert(empty.present && empty.visible && empty.text === '還沒有排任何提醒', '空清單未顯示空狀態文案');
    assert(errors.length === 0, 'overview console error: ' + errors.join(' | '));
    detail.D = { twoRows: true, deleteLive: true, emptyState: true };
  });

  // ─────────── E. 手機四寬掃描（含全部新入口）───────────
  const widths = [360, 375, 414, 768];
  const mobile = [];
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: width === 768 ? 1024 : 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(); const errors = watchErrors(page);
    const key = `E:mobile-${width}`;
    try {
      await boot(page, `?notifymock=1&notifyreset=1&notifynow=0&notifyperm=prompt&case=mobile-${width}`);
      const env = await page.evaluate(() => ({ fs: document.body.classList.contains('fs'), touch: navigator.maxTouchPoints }));
      assert(env.fs && env.touch > 0, `${width}: 不是 fs/觸控 context`);
      // 跟隨 ⏰ 入口
      await page.tap('#randBtn'); await page.locator('#fpNotify').waitFor();
      const followScan = await scan(page, ['#fpNotify']);
      assert(!followScan.overflow && !followScan.collisions.length && followScan.targets.every(x => x.hit && x.min44), `${width}: 跟隨鈕 ${JSON.stringify(followScan)}`);
      // notify sheet：含 basis 切換鈕（≥44px）
      await page.tap('#fpNotify'); await page.locator('#notifyModal:not([hidden])').waitFor();
      const sheetScan = await scan(page, ['#notifyClose', '#notifyStation', '#notifyWalk', '#notifySave', '#notifyOffsets label', '#notifyBasis button']);
      assert(!sheetScan.overflow && !sheetScan.collisions.length && sheetScan.targets.every(x => x.hit && x.min44), `${width}: sheet(含 basis) ${JSON.stringify(sheetScan)}`);
      const basisScan = await scan(page, ['#notifyBasis button']);
      assert(basisScan.targets.length === 2 && basisScan.targets.every(x => x.hit && x.min44), `${width}: basis 兩鈕命中/44px 失敗 ${JSON.stringify(basisScan)}`);
      await page.tap('#notifyClose');
      // 更多抽屜「已排提醒」列（≥44px）
      await page.tap('#tabMore'); await page.waitForFunction(() => document.body.classList.contains('tools-open'));
      const moreScan = await scan(page, ['.ms-row[data-act="notify"]']);
      assert(!moreScan.overflow && !moreScan.collisions.length && moreScan.targets.length === 1 && moreScan.targets.every(x => x.hit && x.min44), `${width}: 更多列 ${JSON.stringify(moreScan)}`);
      // 點更多列 → 開總覽
      await page.tap('.ms-row[data-act="notify"]'); await page.locator('#notifyModal:not([hidden])').waitFor();
      assert(await page.evaluate(() => document.getElementById('notifyModal').dataset.notifyView) === 'overview', `${width}: 更多列未開總覽`);
      await page.tap('#notifyClose');
      // board 🔔 入口（台鐵站；沿用 ☆/× 22px 圖示鈕慣例，驗命中/相交/無溢出，不強制 44px）
      const st = await toSchedTraStation(page);
      await page.evaluate(s => { const stObj = state.schedStations.find(x => x.sys === s.sys && x.name === s.name); openBoard(stObj); }, st);
      await page.locator('#board:not([hidden])').waitFor();
      const boardScan = await scan(page, ['#boardNotify']);
      assert(!boardScan.overflow && !boardScan.collisions.length && boardScan.targets.length === 1 && boardScan.targets.every(x => x.hit), `${width}: board 🔔 ${JSON.stringify(boardScan)}`);
      await page.tap('#boardNotify'); await page.locator('#notifyModal:not([hidden])').waitFor();
      assert(await page.evaluate(() => document.getElementById('notifyModal').dataset.notifyView) === 'lasttrain', `${width}: board 🔔 未開末班車`);
      assert(errors.length === 0, `${width}: console error ${errors.join(' | ')}`);
      mobile.push({ width, touch: env.touch, basisTargets: basisScan.targets.length, moreRow: moreScan.targets.length, boardNotify: boardScan.targets.length, boardNotifyPx: boardScan.targets[0] && [Math.round(boardScan.targets[0].rect.w), Math.round(boardScan.targets[0].rect.h)] });
      results[key] = 'PASS';
    } catch (e) { results[key] = 'FAIL: ' + e.message; }
    finally { await context.close(); }
  }
  detail.E = mobile;

  // ─────────── F. 無 mock：所有新入口不可見、零 console error ───────────
  await run('F:no-mock-entries', async (page, errors) => {
    await boot(page, '?case=nomock-entries');
    // 更多列不存在、跟隨 ⏰ 不存在
    assert(await page.locator('.ms-row[data-act="notify"]').count() === 0, '無 mock 時「已排提醒」更多列仍在');
    assert(await page.locator('#fpNotify').count() === 0, '無 mock 時跟隨 ⏰ 仍在');
    // 開台鐵站看板 → 無 🔔
    const st = await toSchedTraStation(page);
    await page.evaluate(s => { const stObj = state.schedStations.find(x => x.sys === s.sys && x.name === s.name); openBoard(stObj); }, st);
    await page.locator('#board:not([hidden])').waitFor();
    assert(await page.locator('#boardNotify').count() === 0, '無 mock 時 board 🔔 仍在');
    // 測試 API 不存在
    assert(await page.evaluate(() => !window.__localNotifyTest) === true, '無 mock 時測試 API 仍掛載');
    assert(errors.length === 0, '無 mock console error: ' + errors.join(' | '));
    detail.F = { moreRow: 0, followEntry: 0, boardNotify: 0, testApi: false };
  });

  // ─────────── 總結 ───────────
  const fails = Object.entries(results).filter(([, v]) => v !== 'PASS');
  console.log('\n===== 驗收結果 =====');
  for (const [k, v] of Object.entries(results)) console.log(`  ${v === 'PASS' ? 'PASS' : 'FAIL'}  ${k}${v === 'PASS' ? '' : '  → ' + v.slice(6)}`);
  console.log('\n===== 明細 =====');
  console.log(JSON.stringify(detail, null, 2));
  console.log(`\n${fails.length === 0 ? 'ALL PASS ✅' : fails.length + ' 個案例 FAIL ❌'} （共 ${Object.keys(results).length} 案）`);
  process.exitCode = fails.length === 0 ? 0 : 1;
} finally {
  await browser.close();
}
