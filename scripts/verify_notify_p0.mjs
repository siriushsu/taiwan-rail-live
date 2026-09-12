// 本地到站提醒（P0）+ 批次A2 驗收腳本 —— Playwright，涵蓋 §6 A–F。
//
// 跑法：node scripts/verify_notify_p0.mjs（或 npm run check-notify）——server 本檔自己起,
//       不必先開靜態站。要指向已經在跑的 server：NOTIFY_BASE=http://127.0.0.1:5179/ node …
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

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';

let pw;
try { pw = await import('playwright'); }
catch { pw = await import(process.env.PLAYWRIGHT_MJS ?? '/Users/xuxiang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'); }
const { chromium } = pw;

// 🔴 自己起 dev server(比照 verify_afr.mjs)。沒有這段的話本檔【上不了出貨鏈】——ship_web 跑在
//    一棵乾淨的 worktree 上,沒有人在服那棵樹,而「不在出貨鏈上的驗收腳本等於不存在」。
//    dev_server 而不是 http.server:本檔的 mock 走 /api/* 全攔,但頁面開機仍要拿得到靜態資產。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const freePort = () => new Promise(res => { const srv = createServer(); srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => res(port)); }); });
let devChild = null;
let BASE = process.env.NOTIFY_BASE;
if (!BASE) {
  const port = await freePort();
  BASE = `http://127.0.0.1:${port}/`;
  devChild = spawn(process.execPath, [path.join(ROOT, 'scripts/dev_server.mjs')], {
    cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'inherit'] });
  process.on('exit', () => devChild?.kill());
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { devChild?.kill(); process.exit(1); });
  for (let i = 0; ; i++) { // 等它真的聽得到,不用固定秒數
    try { const r = await fetch(BASE + 'index.html'); if (r.ok) break; } catch {}
    if (i > 100) { console.error('✗ dev server 起不來（' + BASE + '）'); devChild.kill(); process.exit(1); }
    await new Promise(r => setTimeout(r, 100));
  }
}
// 🔴 判準盲點 0「我在量的是誰」:NOTIFY_BASE 可以把整支指到【別棵樹】,而紅綠會長得一模一樣。
//    所以第一行就印出這支實際服的根目錄與 index.html 的 md5,出貨鏈紅掉時才分辨得出樹對不對。
console.log('驗收目標：' + (process.env.NOTIFY_BASE ? 'NOTIFY_BASE=' + BASE + '（外部 server,樹未知）'
  : ROOT + '  index.html md5=' + createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex')));

// 高鐵班表自 2026-08-07 改以 apiUrl('api/thsr-schedule') 為主來源、靜態檔降級為 fallbackUrl。
// 下面 boot() 那條 **/api/** 的全攔 route 會把它也一起吃掉,而 `[]` 是 200 ⇒ fetchJSONAt
// 視同成功 ⇒ fallback 永不啟動 ⇒ applySchedSystems 迭代 undefined 的 sys.data.trains 拋錯
// ⇒ __state.ready 永遠不為真 ⇒ 15 個案例全部倒在同一個 waitForFunction 逾時。
// 這裡吐打包的那份(同 schema)。readFileSync 直接吃 URL 物件,不經過會被 percent-encode 的 pathname。
const THSR_SCHED = readFileSync(new URL('../data/thsr_schedule_dense.json', import.meta.url));
const STORAGE_KEY = 'trainmap-local-reminders-v1';
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
const results = {}; // caseName -> 'PASS' | 'FAIL: ...'
const detail = {};

// 🔴 語系一律釘死:本檔大量用中文字串找元件與比對標籤,而 Playwright 的預設 locale 是 en-US
//    ⇒ 頁面整份切成英文 ⇒ 15 案裡 12 案紅,而且紅的樣子完全不像語系問題(「缺少欄位標籤」「點不到」
//    「標題錯誤」)。兩邊都要釘:網址參數決定頁面語系,context locale 決定 Intl 的格式化結果。
const ZH = 'lang=zh-TW';
async function boot(page, query = '') {
  query = query ? (query + '&' + ZH) : ('?' + ZH);
  await page.route('**/api/**', route => {
    if (new URL(route.request().url()).pathname.endsWith('/api/thsr-schedule'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: THSR_SCHED });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.goto(BASE + query, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__state && window.__state?.ready, null, { timeout: 60000 });
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
  const context = await browser.newContext(name.startsWith('E:') ? { locale: 'zh-TW' } : { viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
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
    const context = await browser.newContext({ viewport: { width, height: width === 768 ? 1024 : 844 }, isMobile: true, hasTouch: true, locale: 'zh-TW' });
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
      // 單元 B 的重複列：四顆模式鈕 + 展開後的七顆星期鈕，都要摸得到、夠大、不互相蓋。
      const repeatScan = await scan(page, ['#notifyRepeat button']);
      assert(repeatScan.targets.length === 4 && !repeatScan.collisions.length && repeatScan.targets.every(x => x.hit && x.min44),
        `${width}: 重複四鈕 ${JSON.stringify(repeatScan)}`);
      // 四顆擠一列,最長的「週一到五」在 360px 只差 1px 就折成兩行(修法＝字級 12→11、去掉左右內距)。
      // 折了不溢出也不被切掉,按鈕的 min-height:44px 還會把兩行整個蓋住,所以沒有這條就【沒有任何訊號】。
      // 🔴 量法不可以用 line-height：這些鈕算出來是 'normal',parseFloat 得 NaN,判準會整條變 null
      //    （第一版就是這樣，四個寬度同時紅）。改量「強制單行時這行字需要多寬 vs 框內有多寬」。
      const lineScan = await page.evaluate(() => [...document.querySelectorAll('#notifyRepeat button')].map(el => {
        const keep = el.style.whiteSpace; el.style.whiteSpace = 'nowrap';
        const need = el.scrollWidth, have = el.clientWidth;
        el.style.whiteSpace = keep;
        return { t: el.textContent, need, have };
      }));
      assert(lineScan.every(x => x.need <= x.have), `${width}: 重複鈕的字放不進一行 ${JSON.stringify(lineScan)}`);
      // 正向對照:塞一個一定放不下的字串,同一把尺必須量到放不下。沒有它,量法寫錯
      //（need 恆等於 have 之類）會讓上面那條恆真空過。
      const tooLong = await page.evaluate(() => {
        const el = document.querySelector('#notifyRepeat button[data-repeat="weekdays"]');
        const keepT = el.textContent, keepW = el.style.whiteSpace;
        el.textContent = '週一到五'.repeat(20); el.style.whiteSpace = 'nowrap'; // 20 份:最寬的 768 也一定塞不下
        const out = { need: el.scrollWidth, have: el.clientWidth };
        el.textContent = keepT; el.style.whiteSpace = keepW; return out;
      });
      assert(tooLong.need > tooLong.have, `${width}: 換行量尺失效——連塞爆的字串都說放得下 ${JSON.stringify(tooLong)}`);
      await page.tap('#notifyRepeat button[data-repeat="custom"]');
      await page.locator('#notifyRepeatDays button[data-weekday="4"]').waitFor({ state: 'visible', timeout: 15000 });
      const daysScan = await scan(page, ['#notifyRepeatDays button']);
      assert(daysScan.targets.length === 7 && !daysScan.overflow && !daysScan.collisions.length && daysScan.targets.every(x => x.hit),
        `${width}: 星期七鈕 ${JSON.stringify(daysScan)}`);
      // 七顆擠在一列,寬度一定小於 44;高度仍要守住(比照板頭圖示鈕沿用既有慣例的寫法,只是這裡改守高)
      assert(daysScan.targets.every(x => x.rect.h >= 40), `${width}: 星期鈕高度不足 ${JSON.stringify(daysScan.targets.map(x => Math.round(x.rect.h)))}`);
      await page.tap('#notifyRepeat button[data-repeat="none"]');
      await page.waitForFunction(() => document.getElementById('notifyModal').dataset.notifyRepeat === 'null');
      await page.tap('#notifyClose');
      await page.waitForFunction(() => document.getElementById('notifyModal').hidden);
      // board 🔔 入口（台鐵站；沿用 ☆/× 22px 圖示鈕慣例，驗命中/相交/無溢出，不強制 44px）
      const st = await toSchedTraStation(page);
      await page.evaluate(s => { const stObj = state.schedStations.find(x => x.sys === s.sys && x.name === s.name); openBoard(stObj); }, st);
      await page.locator('#board:not([hidden])').waitFor();
      const boardScan = await scan(page, ['#boardNotify']);
      assert(!boardScan.overflow && !boardScan.collisions.length && boardScan.targets.length === 1 && boardScan.targets.every(x => x.hit), `${width}: board 🔔 ${JSON.stringify(boardScan)}`);
      await page.tap('#boardNotify'); await page.locator('#notifyModal:not([hidden])').waitFor();
      assert(await page.evaluate(() => document.getElementById('notifyModal').dataset.notifyView) === 'lasttrain', `${width}: board 🔔 未開末班車`);
      await page.tap('#notifyClose');
      await page.waitForFunction(() => document.getElementById('notifyModal').hidden);
      // 「已排提醒」的手機入口。🔴 2026-09-06 查詢分頁定案之後它搬到【查詢 sheet 的快捷列】,
      //    更多抽屜那一列在手機被 CSS 藏起來(.more-sheet .ms-row[data-home="query"])。兩邊都驗:
      //    只驗新的,舊那列哪天又冒出來沒人知道;只驗舊的,就是現在這支腳本紅了兩個月的原因。
      //    順序刻意把抽屜放最後——抽屜蓋住整條分頁列,開了就點不到 #tabSearch。
      await page.tap('#tabSearch');
      await page.locator('#queryLinks .ql-row[data-act="notify"]').waitFor({ state: 'visible', timeout: 20000 });
      const qlScan = await scan(page, ['#queryLinks .ql-row[data-act="notify"]']);
      assert(!qlScan.overflow && !qlScan.collisions.length && qlScan.targets.length === 1 && qlScan.targets.every(x => x.hit && x.min44), `${width}: 查詢快捷列 ${JSON.stringify(qlScan)}`);
      await page.tap('#queryLinks .ql-row[data-act="notify"]'); await page.locator('#notifyModal:not([hidden])').waitFor();
      assert(await page.evaluate(() => document.getElementById('notifyModal').dataset.notifyView) === 'overview', `${width}: 查詢快捷列未開總覽`);
      await page.tap('#notifyClose');
      await page.waitForFunction(() => document.getElementById('notifyModal').hidden);
      await page.tap('#tabMore'); await page.waitForFunction(() => document.body.classList.contains('tools-open'));
      const moreHidden = await page.evaluate(() => {
        const el = document.querySelector('.ms-row[data-act="notify"]');
        // 正向對照:同一個抽屜裡有別的列是看得見的 ⇒ 證明抽屜真的開了,而不是整個抽屜都沒渲染。
        return { exists: !!el, display: el ? getComputedStyle(el).display : null,
                 siblingsVisible: [...document.querySelectorAll('.ms-row[data-act]')].filter(x => getComputedStyle(x).display !== 'none').length };
      });
      assert(moreHidden.exists && moreHidden.display === 'none' && moreHidden.siblingsVisible > 0,
        `${width}: 更多抽屜那列應該存在、被藏起來,且同抽屜其他列看得見 ${JSON.stringify(moreHidden)}`);
      assert(errors.length === 0, `${width}: console error ${errors.join(' | ')}`);
      mobile.push({ width, touch: env.touch, basisTargets: basisScan.targets.length, repeatTargets: repeatScan.targets.length, repeatFit: lineScan.map(x => x.need + '/' + x.have), dayTargets: daysScan.targets.length, queryLink: qlScan.targets.length, moreRowHidden: moreHidden.display === 'none', siblingsVisible: moreHidden.siblingsVisible, boardNotify: boardScan.targets.length, boardNotifyPx: boardScan.targets[0] && [Math.round(boardScan.targets[0].rect.w), Math.round(boardScan.targets[0].rect.h)] });
      results[key] = 'PASS';
    } catch (e) { results[key] = 'FAIL: ' + e.message; }
    finally { await context.close(); }
  }
  detail.E = mobile;

  // ─────────── G. 單元 B：重複規則 ───────────
  // 時鐘一律釘死成字面 epoch(台北牆上時刻推出來),不讀系統時間:這一組全部在判「星期幾」,
  // 跟著真實時間跑的話同一支腳本在星期一與星期四會得到不同結果,紅起來完全不像時鐘問題。
  // 2026-09-14 是星期一(ISO 1)。
  const TPE = (y, m, d, hh, mm) => Math.floor(Date.UTC(y, m - 1, d, hh, mm) / 1000) - 8 * 3600;
  const MON = TPE(2026, 9, 14, 8, 30); // 錨點:週一 08:30

  // G1 假時鐘逐日推進一週:指定星期只在那幾天響,其餘每一天都不可以。
  await run('G1:repeat-clock-walk', async (page, errors) => {
    await boot(page, `?notifymock=1&notifyreset=1&notifynow=${MON}&case=repeat-clock`);
    const out = await page.evaluate(([anchor, tpeBase]) => {
      const api = window.__localNotifyTest;
      const day = 86400;
      const at = (k, hh, mm) => tpeBase + k * day + hh * 3600 + mm * 60; // tpeBase = 週一 00:00
      const weekly = { id: 1, fireAt: anchor, repeat: { kind: 'weekly', days: [1, 5] } };
      const daily = { id: 2, fireAt: anchor, repeat: { kind: 'daily' } };
      const once = { id: 3, fireAt: anchor };
      const isoOf = e => api.taipeiParts(e).iso;
      const dateOf = e => api.taipeiParts(e).date;
      const walk = [];
      for (let k = 0; k < 14; k++) {           // 連走兩週,跨週界也要對
        const now = at(k, 0, 5);               // 每天 00:05 問「下一次是什麼時候」
        walk.push({ k, nowIso: isoOf(now), weeklyIso: isoOf(api.nextFireAt(weekly, now)), weeklyDate: dateOf(api.nextFireAt(weekly, now)),
                    dailyDate: dateOf(api.nextFireAt(daily, now)) });
      }
      const weeklyAts = [];
      for (let k = 0; k < 14; k++) { const now = at(k, 0, 5); weeklyAts.push({ now, next: api.nextFireAt(weekly, now) }); }
      return {
        walk,
        monotonic: weeklyAts.every((x, i) => i === 0 || x.next >= weeklyAts[i - 1].next),
        allFuture: weeklyAts.every(x => x.next > x.now),
        weeklyIsoSet: [...new Set(walk.map(x => x.weeklyIso))].sort(),
        weeklyDates: [...new Set(walk.map(x => x.weeklyDate))].sort(),
        dailySameDay: api.nextFireAt(daily, at(0, 7, 0)) === at(0, 8, 30),   // 當天時刻還沒到 → 今天
        dailyNextDay: api.nextFireAt(daily, at(0, 9, 0)) === at(1, 8, 30),   // 當天時刻過了 → 明天
        weeklyMonToFri: api.nextFireAt(weekly, at(0, 9, 0)) === at(4, 8, 30), // 週一過了 → 週五
        weeklyFriToMon: api.nextFireAt(weekly, at(4, 9, 0)) === at(7, 8, 30), // 週五過了 → 下週一
        onceStaysAnchor: api.nextFireAt(once, at(9, 0, 0)) === anchor,        // 不重複:永遠是錨點本身
      };
    }, [MON, TPE(2026, 9, 14, 0, 0)]);
    assert(out.walk.length === 14 && out.walk[0].nowIso === 1, 'G1: 假時鐘沒有從週一開始走 ' + JSON.stringify(out.walk[0]));
    // 正向:只落在週一與週五。反向對照:任何一天都不可以落在其他五個星期幾(沒有這條,判準對「永遠回同一天」也會綠)
    assert(JSON.stringify(out.weeklyIsoSet) === JSON.stringify([1, 5]), 'G1: 指定星期落到別的日子 ' + JSON.stringify(out.weeklyIsoSet));
    // 獨立真值:日期字串自己算星期幾(不經過被測的那支函式),再加上「不倒退」與「一定在未來」。
    const isoOfDate = d => { const w = new Date(d + 'T00:00:00Z').getUTCDay(); return w === 0 ? 7 : w; };
    assert(out.weeklyDates.every(d => [1, 5].includes(isoOfDate(d))), 'G1: 命中的日期自己算出來不是週一或週五 ' + JSON.stringify(out.weeklyDates));
    assert(out.weeklyDates.length >= 4, 'G1: 兩週的窗只命中 ' + out.weeklyDates.length + ' 個日期,太少 ' + JSON.stringify(out.weeklyDates));
    assert(out.monotonic, 'G1: 逐日推進時「下一次」倒退了 ' + JSON.stringify(out.walk));
    assert(out.allFuture, 'G1: 有一天算出來的「下一次」不在未來');
    assert(out.dailySameDay && out.dailyNextDay, 'G1: 每天的當日/隔日邊界錯 ' + JSON.stringify(out));
    assert(out.weeklyMonToFri && out.weeklyFriToMon, 'G1: 週一↔週五的接續錯 ' + JSON.stringify(out));
    assert(out.onceStaysAnchor, 'G1: 不重複項目的下一次不應該被推算');
    assert(errors.length === 0, 'G1 console error: ' + errors.join(' | '));
    detail.G1 = { weeklyIsoSet: out.weeklyIsoSet, weeklyDates: out.weeklyDates, dailySameDay: out.dailySameDay, dailyNextDay: out.dailyNextDay };
  });

  // G2 原生排程 payload 的形狀:重複走 on+repeats、一次性走 at;ISO→Capacitor 星期碼要真的轉過。
  await run('G2:repeat-payload', async (page, errors) => {
    await boot(page, `?notifymock=1&notifyreset=1&notifynow=${MON}&case=repeat-payload`);
    const out = await page.evaluate(anchor => {
      const api = window.__localNotifyTest;
      const mk = (id, repeat) => ({ id, sys: 'tra', train: '123', stName: '臺北', mode: 'dep', offsetMin: 10, walkMin: 0, fireAt: anchor, snapshotDelaySec: 0, svcDate: '2026-09-14', repeat });
      const once = api.payloads(mk(1, null));
      const daily = api.payloads(mk(2, { kind: 'daily' }));
      const weekdays = api.payloads(mk(3, { kind: 'weekly', days: [1, 2, 3, 4, 5] }));
      const sunday = api.payloads(mk(4, { kind: 'weekly', days: [7] }));
      return {
        once: { n: once.length, hasAt: !!(once[0].schedule && once[0].schedule.at), repeats: !!once[0].schedule.repeats },
        daily: { n: daily.length, on: daily[0].schedule.on, repeats: daily[0].schedule.repeats },
        weekdays: { n: weekdays.length, weekdays: weekdays.map(p => p.schedule.on.weekday).sort((a, b) => a - b), allRepeat: weekdays.every(p => p.schedule.repeats === true), hours: [...new Set(weekdays.map(p => p.schedule.on.hour))] },
        sundayWeekday: sunday[0].schedule.on.weekday,
        titleSame: new Set([...once, ...daily, ...weekdays].map(p => p.title)).size === 1,
      };
    }, MON);
    assert(out.once.n === 1 && out.once.hasAt && !out.once.repeats, 'G2: 一次性應該恰一筆 at 且不重複 ' + JSON.stringify(out.once));
    assert(out.daily.n === 1 && out.daily.repeats === true && out.daily.on.hour === 8 && out.daily.on.minute === 30 && out.daily.on.weekday === undefined,
      'G2: 每天應該恰一筆、綁時分不綁星期 ' + JSON.stringify(out.daily));
    // Capacitor 的 Weekday 是 Sunday=1…Saturday=7;ISO 的週一到五(1..5)要變成 2..6。
    assert(out.weekdays.n === 5 && JSON.stringify(out.weekdays.weekdays) === JSON.stringify([2, 3, 4, 5, 6]) && out.weekdays.allRepeat,
      'G2: 週一到五的星期碼沒有從 ISO 轉成 Capacitor ' + JSON.stringify(out.weekdays));
    assert(out.sundayWeekday === 1, 'G2: ISO 週日(7)必須轉成 Capacitor 的 1,實得 ' + out.sundayWeekday);
    assert(JSON.stringify(out.weekdays.hours) === JSON.stringify([8]), 'G2: 五筆的時刻應該一致 ' + JSON.stringify(out.weekdays.hours));
    assert(out.titleSame, 'G2: 同一則提醒的各槽位標題應該一致');
    assert(errors.length === 0, 'G2 console error: ' + errors.join(' | '));
    detail.G2 = out;
  });

  // G3 原生 id 不相交:重複的衍生 id 不可以撞到別則提醒的 id,而且要放得進 Android 的 int32。
  await run('G3:slot-id-disjoint', async (page, errors) => {
    await boot(page, `?notifymock=1&notifyreset=1&notifynow=${MON}&case=slot-id`);
    const out = await page.evaluate(anchor => {
      const api = window.__localNotifyTest;
      const all = [], per = {};
      for (let id = 1; id <= 60; id++) {
        for (const [tag, repeat] of [['once', null], ['daily', { kind: 'daily' }], ['week', { kind: 'weekly', days: [1, 2, 3, 4, 5, 6, 7] }]]) {
          const ids = api.slotIds({ id, fireAt: anchor, repeat });
          per[tag + id] = ids;
          if (tag !== 'once' || true) all.push(...ids);
        }
      }
      const onceIds = Object.entries(per).filter(([k]) => k.startsWith('once')).flatMap(([, v]) => v);
      const recurIds = Object.entries(per).filter(([k]) => !k.startsWith('once')).flatMap(([, v]) => v);
      return {
        onceIsIdentity: onceIds.every((v, i) => v === i + 1),
        overlap: onceIds.filter(v => recurIds.includes(v)).length,
        recurDup: recurIds.length - new Set(recurIds).size,
        maxId: Math.max(...all),
        int32Ok: Math.max(...all) <= 2147483647,
        weekCount: per.week7.length, dailyCount: per.daily7.length, onceCount: per.once7.length,
      };
    }, MON);
    assert(out.onceIsIdentity, 'G3: 一次性的原生 id 應該就是項目 id(舊版排下去的 pending 才不會churn)');
    assert(out.overlap === 0, `G3: 重複的衍生 id 撞到一次性的 id ${out.overlap} 次`);
    assert(out.recurDup === 0, `G3: 不同項目的重複槽位撞號 ${out.recurDup} 次`);
    assert(out.int32Ok, `G3: 最大 id ${out.maxId} 超出 int32,Android 會排不下去`);
    assert(out.onceCount === 1 && out.dailyCount === 1 && out.weekCount === 7, 'G3: 槽位數不對 ' + JSON.stringify(out));
    assert(errors.length === 0, 'G3 console error: ' + errors.join(' | '));
    detail.G3 = out;
  });

  // G4 端到端:在畫面上設一則「週一到五」,存檔後原生真的收到五筆重複排程,清單也標出來。
  await run('G4:repeat-end-to-end', async (page, errors) => {
    await boot(page, '?notifymock=1&notifyreset=1&notifynow=0&case=repeat-e2e');
    await openRandomFollow(page); await openNotifyFromFollow(page);
    const before = await page.evaluate(() => document.getElementById('notifyModal').dataset.notifyRepeat);
    assert(before === 'null', 'G4: 預設應該是不重複,實得 ' + before);
    await page.evaluate(() => window.__localNotifyTest.setRepeat({ kind: 'weekly', days: [1, 2, 3, 4, 5] }));
    await page.locator('#notifySave').click();
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('trainmap-local-reminders-v1') || '[]')).length === 1);
    const out = await page.evaluate(() => {
      const items = JSON.parse(localStorage.getItem('trainmap-local-reminders-v1') || '[]');
      const pending = window.__notifyMockPending;
      return {
        repeat: items[0].repeat, snapshot: items[0].snapshotDelaySec,
        pendingN: pending.length,
        allRepeat: pending.every(p => p.schedule && p.schedule.repeats === true),
        weekdays: pending.map(p => p.schedule.on.weekday).sort((a, b) => a - b),
        tagCount: document.querySelectorAll('#notifyReminderList .notify-repeat-tag').length,
        tagEmpty: [...document.querySelectorAll('#notifyReminderList .notify-repeat-tag')].some(x => !x.textContent.trim()),
      };
    });
    assert(out.repeat && out.repeat.kind === 'weekly' && JSON.stringify(out.repeat.days) === JSON.stringify([1, 2, 3, 4, 5]), 'G4: 存下來的重複規則不對 ' + JSON.stringify(out.repeat));
    assert(out.snapshot === 0, 'G4: 重複提醒必須以表定為錨點(誤點快照要歸零),實得 ' + out.snapshot);
    assert(out.pendingN === 5 && out.allRepeat, 'G4: 原生應收到五筆重複排程 ' + JSON.stringify(out));
    assert(JSON.stringify(out.weekdays) === JSON.stringify([2, 3, 4, 5, 6]), 'G4: 原生星期碼不對 ' + JSON.stringify(out.weekdays));
    assert(out.tagCount === 1 && !out.tagEmpty, 'G4: 清單沒有標出重複 ' + JSON.stringify(out));
    assert(errors.length === 0, 'G4 console error: ' + errors.join(' | '));
    detail.G4 = out;
  });

  // G5 改時刻要真的重排。🔴 這是本批最容易靜默壞掉的一處:星期集合沒變 ⇒ 槽位 id 一模一樣 ⇒
  //    sync 看到 pending 裡 id 都在就判定「已排好」,鬧鐘會停在舊時刻,而畫面完全正常。
  await run('G5:repeat-edit-reschedules', async (page, errors) => {
    await boot(page, '?notifymock=1&notifyreset=1&notifynow=0&case=repeat-edit');
    await openRandomFollow(page); await openNotifyFromFollow(page);
    await page.evaluate(() => window.__localNotifyTest.setRepeat({ kind: 'weekly', days: [1, 2, 3, 4, 5] }));
    await page.locator('#notifySave').click();
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('trainmap-local-reminders-v1') || '[]')).length === 1);
    const first = await page.evaluate(() => ({ ids: window.__notifyMockPending.map(p => p.id).sort(), on: window.__notifyMockPending[0].schedule.on, fireAt: JSON.parse(localStorage.getItem('trainmap-local-reminders-v1'))[0].fireAt }));
    // 提前量 10 → 30 分（同一則、同一個星期集合）
    await page.locator('#notifyOffsets label:has(input[value="30"])').click(); // radio 本身 opacity:0/pointer-events:none,要點 label
    await page.locator('#notifySave').click();
    await page.waitForFunction(prev => JSON.parse(localStorage.getItem('trainmap-local-reminders-v1'))[0].fireAt !== prev, first.fireAt);
    const second = await page.evaluate(() => ({ ids: window.__notifyMockPending.map(p => p.id).sort(), on: window.__notifyMockPending[0].schedule.on, n: window.__notifyMockPending.length, items: JSON.parse(localStorage.getItem('trainmap-local-reminders-v1')).length }));
    assert(second.items === 1 && second.n === 5, 'G5: 更新後應該仍是一則五槽 ' + JSON.stringify(second));
    assert(JSON.stringify(first.ids) === JSON.stringify(second.ids), 'G5: 星期集合沒變,槽位 id 不該換 ' + JSON.stringify([first.ids, second.ids]));
    assert(first.on.hour * 60 + first.on.minute !== second.on.hour * 60 + second.on.minute,
      `G5: 提前量改了 20 分鐘,原生排程的時刻卻沒動(${JSON.stringify(first.on)} → ${JSON.stringify(second.on)})——鬧鐘停在舊時刻`);
    assert((first.on.hour * 60 + first.on.minute - (second.on.hour * 60 + second.on.minute) + 1440) % 1440 === 20,
      `G5: 時刻要正好往前 20 分鐘 ${JSON.stringify([first.on, second.on])}`);
    assert(errors.length === 0, 'G5 console error: ' + errors.join(' | '));
    detail.G5 = { ids: first.ids.length, from: first.on, to: second.on };
  });

  // G8 【縮小】星期集合或關掉重複,舊槽位必須跟著消失。缺這個行為的症狀是使用者
  //    【關掉的提醒繼續每週響】,而畫面上一則都看不到。G5 量不到:星期集合沒變時新舊槽位
  //    id 一模一樣,量不出「舊的有沒有被清掉」。
  //    🔴 突變測試的誠實紀錄(2026-09-13):清孤兒有兩層——commitLocalReminderDraft() 取新舊
  //    槽位聯集來取消,以及 syncLocalReminders() 把 pending 裡不在 desiredIds 的一律取消。
  //    單獨拿掉任一層,本案都照樣綠(兩層互相蓋住);兩層【同時】拿掉才紅。所以這一案考的是
  //    「這個行為還在不在」,不是任何單一層防線,別把它當成聯集那一行的守門人。
  await run('G8:repeat-shrink-cancels-orphans', async (page, errors) => {
    await boot(page, '?notifymock=1&notifyreset=1&notifynow=0&case=repeat-shrink');
    await openRandomFollow(page); await openNotifyFromFollow(page);
    await page.evaluate(() => window.__localNotifyTest.setRepeat({ kind: 'weekly', days: [1, 2, 3, 4, 5] }));
    await page.locator('#notifySave').click();
    await page.waitForFunction(() => window.__notifyMockPending.length === 5);
    const wide = await page.evaluate(() => ({ ids: window.__notifyMockPending.map(p => p.id).sort((a, b) => a - b), item: JSON.parse(localStorage.getItem('trainmap-local-reminders-v1'))[0] }));

    // (a) 週一到五 → 只剩週一。期望值獨立算:用實作曝露的 slotIds 對【縮小後的那份】求值。
    await page.evaluate(() => window.__localNotifyTest.setRepeat({ kind: 'weekly', days: [1] }));
    await page.locator('#notifySave').click();
    await page.waitForFunction(() => window.__notifyMockPending.length !== 5);
    const narrow = await page.evaluate(() => {
      const it = JSON.parse(localStorage.getItem('trainmap-local-reminders-v1'))[0];
      return { ids: window.__notifyMockPending.map(p => p.id).sort((a, b) => a - b), want: window.__localNotifyTest.slotIds(it).sort((a, b) => a - b), days: it.repeat && it.repeat.days };
    });
    assert(JSON.stringify(narrow.days) === '[1]', 'G8: 縮小後應該只剩週一 ' + JSON.stringify(narrow.days));
    assert(JSON.stringify(narrow.ids) === JSON.stringify(narrow.want),
      `G8: 縮小星期集合後,原生待排清單要恰好等於新的槽位(殘留＝關掉的日子還會響) pending=${JSON.stringify(narrow.ids)} want=${JSON.stringify(narrow.want)}`);
    const orphans = wide.ids.filter(id => !narrow.want.includes(id) && narrow.ids.includes(id));
    assert(orphans.length === 0, 'G8: 有舊槽位沒被取消 ' + JSON.stringify(orphans));
    // 正向對照:上一步確實【曾經】排過那 4 個槽位,否則「殘留 0」是恆真的空話。
    assert(wide.ids.length === 5 && wide.ids.filter(id => !narrow.want.includes(id)).length === 4,
      'G8 正向對照: 縮小前應該有 4 個之後該消失的槽位 ' + JSON.stringify(wide.ids));

    // (b) 再關掉重複 ⇒ 槽位要回到「一次性」那一段(id 本身),週期段一個都不能留。
    await page.evaluate(() => window.__localNotifyTest.setRepeat(null));
    await page.locator('#notifySave').click();
    await page.waitForFunction(() => !JSON.parse(localStorage.getItem('trainmap-local-reminders-v1'))[0].repeat);
    const off = await page.evaluate(() => {
      const it = JSON.parse(localStorage.getItem('trainmap-local-reminders-v1'))[0];
      return { ids: window.__notifyMockPending.map(p => p.id).sort((a, b) => a - b), want: window.__localNotifyTest.slotIds(it), id: it.id, repeats: window.__notifyMockPending.map(p => !!(p.schedule && p.schedule.repeats)) };
    });
    assert(JSON.stringify(off.ids) === JSON.stringify([off.id]),
      `G8: 關掉重複後只該剩 id=${off.id} 這一則一次性 pending=${JSON.stringify(off.ids)}`);
    assert(off.repeats.every(r => r === false), 'G8: 關掉重複後不該有任何 repeats:true 的排程 ' + JSON.stringify(off.repeats));
    assert(errors.length === 0, 'G8 console error: ' + errors.join(' | '));
    detail.G8 = { wide: wide.ids.length, narrow: narrow.ids, off: off.ids };
  });

  // G6 兩道上限:一則重複算一則項目(不展開成七則),但原生槽位總數不可以衝破預算。
  await run('G6:repeat-limits', async (page, errors) => {
    await boot(page, `?notifymock=1&notifyreset=1&notifynow=${MON}&case=repeat-limit`);
    const out = await page.evaluate(async anchor => {
      const api = window.__localNotifyTest;
      const mk = (id, repeat, off) => ({ id, sys: 'tra', train: String(1000 + id), stName: '臺北', mode: 'dep', basis: 'dep', offsetMin: 10, walkMin: 0, fireAt: anchor + off, snapshotDelaySec: 0, svcDate: '2026-09-14', repeat, state: 'scheduled' });
      // (a) 19 則一次性 ＋ 1 則七天重複 ⇒ 項目 20(剛好在上限內)、槽位 19+7=26(遠低於預算)
      const a = [];
      for (let i = 1; i <= 19; i++) a.push(mk(i, null, 3600 + i * 60));
      a.push(mk(20, { kind: 'weekly', days: [1, 2, 3, 4, 5, 6, 7] }, 3600 + 20 * 60));
      api.save(a); await api.sync();
      const afterA = { pending: window.__notifyMockPending.length, standby: api.load().filter(x => x.state === 'standby').length };
      // (b) 九則七天重複 ⇒ 項目 9(遠低於 20),槽位 63 > 預算 60 ⇒ 必須有項目被推去候補
      const b = [];
      for (let i = 1; i <= 9; i++) b.push(mk(i, { kind: 'weekly', days: [1, 2, 3, 4, 5, 6, 7] }, 3600 + i * 60));
      await window.RAIL_NATIVE_LOCALNOTIFY.cancel(window.__notifyMockPending.map(p => p.id));
      api.save(b); await api.sync();
      const afterB = { pending: window.__notifyMockPending.length, standby: api.load().filter(x => x.state === 'standby').length, items: api.load().length };
      return { afterA, afterB };
    }, MON);
    assert(out.afterA.pending === 26 && out.afterA.standby === 0,
      'G6: 一則七天重複應該只算一則項目(20 則全排、槽位 26) ' + JSON.stringify(out.afterA));
    // 反向對照:沒有槽位預算這條的話,下面會排出 63 筆,iOS 超過 64 的部分會被系統靜默丟掉。
    assert(out.afterB.items === 9 && out.afterB.pending === 56 && out.afterB.standby === 1,
      'G6: 槽位預算沒有生效(9 則 x 7 天 = 63 槽,預算 60 ⇒ 只能排 8 則 56 槽、1 則候補) ' + JSON.stringify(out.afterB));
    assert(errors.length === 0, 'G6 console error: ' + errors.join(' | '));
    detail.G6 = out;
  });

  // G7 既有 v1 資料零遷移:沒有 repeat 欄位的項目一律當不重複,行為與改版前相同。
  await run('G7:legacy-v1-untouched', async (page, errors) => {
    await boot(page, `?notifymock=1&notifyreset=1&notifyseed=3&notifynow=${MON}&case=legacy`);
    const out = await page.evaluate(() => {
      const api = window.__localNotifyTest;
      const items = api.load();
      return {
        n: items.length,
        noRepeatField: items.every(x => !('repeat' in x) || x.repeat == null),
        slotIsIdentity: items.every(x => { const s = api.slotIds(x); return s.length === 1 && s[0] === x.id; }),
        payloadHasAt: items.every(x => { const p = api.payloads(x)[0]; return !!p.schedule.at && !p.schedule.repeats; }),
        nextIsAnchor: items.every(x => api.nextFireAt(x, 0) === x.fireAt),
        tags: document.querySelectorAll('#notifyReminderList .notify-repeat-tag').length,
      };
    });
    assert(out.n === 3, 'G7: 種子資料沒進來 ' + JSON.stringify(out));
    assert(out.noRepeatField && out.slotIsIdentity && out.payloadHasAt && out.nextIsAnchor,
      'G7: 舊資料被改動或被當成重複 ' + JSON.stringify(out));
    assert(out.tags === 0, 'G7: 舊資料不該出現重複標籤');
    assert(errors.length === 0, 'G7 console error: ' + errors.join(' | '));
    detail.G7 = out;
  });

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
  devChild?.kill();
}
