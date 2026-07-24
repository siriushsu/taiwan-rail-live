// 黑箱驗證：分頁/App 回前景時模擬時鐘（state.simSec）重新錨定行為。
// 用法：cd 到本 repo 根目錄後 `node verify_clock_reanchor.mjs`（需要本目錄的 node_modules/playwright）。
// 本檔案不改動 index.html，僅用 Playwright 真 Chromium 驅動黑箱行為測試。
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET_URL = 'file://' + path.join(__dirname, 'index.html');

// file:// 環境下 data/*.json 一律 fetch 失敗（瀏覽器對 file: scheme 的 fetch() 內建限制），
// 這與本次要驗的時鐘重錨行為無關，過濾掉，只保留真正的 JS 例外。
const IGNORE_ERR_PATTERNS = [
  /cannot load file:/i,
  /URL scheme "file" is not supported/i,
  /Failed to load resource/i,
  /Failed to fetch/i,
  /net::ERR_/i,
];
function isIgnorable(text) { return IGNORE_ERR_PATTERNS.some(re => re.test(text)); }

// 86400 秒環狀時鐘上的最短距離（處理跨午夜 wraparound）
function circDist(a, b) {
  const d = Math.abs(a - b) % 86400;
  return Math.min(d, 86400 - d);
}

async function newPreparedPage(browser) {
  const context = await browser.newContext();
  const errors = [];
  // 必須在頁面任何 script 執行前就覆寫 document.hidden / visibilityState，
  // 否則不能自行控制「背景/前景」時序（Claude 內建 Browser pane 的 document.hidden 恆 true 就是反例）。
  await context.addInitScript(() => {
    let hiddenFlag = false;
    Object.defineProperty(document, 'hidden', { get: () => hiddenFlag, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => (hiddenFlag ? 'hidden' : 'visible'), configurable: true });
    window.__setHidden = v => {
      hiddenFlag = !!v;
      document.dispatchEvent(new Event('visibilitychange'));
    };
  });
  const page = await context.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error' && !isIgnorable(msg.text())) errors.push('[console] ' + msg.text());
  });
  page.on('pageerror', err => errors.push('[pageerror] ' + err.message));
  await page.goto(TARGET_URL);
  // 資料 fetch 全失敗時 boot() 會提早 return（state.systems 空），不會走到 state.ready=true；
  // 但重錨邏輯掛在 visibilitychange 監聽器（top-level 註冊，不靠 boot 完成），故只需等 window.__state 與相關函式可用即可。
  await page.waitForFunction(() =>
    window.__state && typeof window.setSimSec === 'function' && typeof window.setSpeed === 'function' &&
    typeof window.togglePlay === 'function' && typeof window.metroLiveGate === 'function' &&
    typeof window.nowSecOfDay === 'function' && typeof window.activeTz === 'function' &&
    typeof window.__setHidden === 'function'
  );
  return { context, page, errors };
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch();

// ── 情境 1（漂移重錨）+ 情境 5（gate 恢復，接續情境 1 的重錨結果，同一頁不重載）──
{
  const { context, page, errors } = await newPreparedPage(browser);
  try {
    // 先把模擬時鐘同步到現在（模擬真實使用中「資料已載完、正貼著現在」的常態），
    // 這是 hide 那一刻 _wasLiveOnHide 判斷的前提，不是重錨邏輯本身。
    await page.evaluate(() => { window.__state.simSec = window.nowSecOfDay(window.activeTz()); });
    await page.evaluate(() => window.__setHidden(true));
    // 「改 simSec」必須在 hidden 期間做，順序才對得上真實的「背景凍結、rAF 不動」情境
    await page.evaluate(() => {
      const now = window.nowSecOfDay(window.activeTz());
      window.__state.simSec = ((now - 300) % 86400 + 86400) % 86400;
    });
    await page.evaluate(() => window.__setHidden(false));
    await page.waitForTimeout(300); // 重錨賦值在監聽器內同步發生，300ms 遠在題目允許的 2s 內
    const after1 = await page.evaluate(() => ({ simSec: window.__state.simSec, now: window.nowSecOfDay(window.activeTz()) }));
    const d1 = circDist(after1.simSec, after1.now);
    record('1. 漂移重錨', d1 <= 5, `simSec=${after1.simSec.toFixed(1)} now=${after1.now.toFixed(1)} diff=${d1.toFixed(2)}s（期望 ≤5s）`);

    // 情境 5：gate 有 1 秒記憶化，等它翻新後呼叫
    await page.waitForTimeout(1500);
    const gate = await page.evaluate(() => window.metroLiveGate());
    record('5. gate 恢復', gate === true, `metroLiveGate()=${gate}（期望 true）`);
  } catch (e) {
    record('1&5 執行例外', false, String(e && e.stack || e));
  }
  if (errors.length) record('1&5 期間無新增 JS 錯誤', false, errors.join(' | '));
  else record('1&5 期間無新增 JS 錯誤', true, '');
  await context.close();
}

// ── 情境 2：手動調時保護（拖到未來 2 小時，背景/前景不應被拉回現在）──
{
  const { context, page, errors } = await newPreparedPage(browser);
  try {
    const target = await page.evaluate(() => {
      const now = window.nowSecOfDay(window.activeTz());
      window.setSimSec(now + 7200);
      return ((now + 7200) % 86400 + 86400) % 86400;
    });
    await page.evaluate(() => window.__setHidden(true));
    await page.evaluate(() => window.__setHidden(false));
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.__state.simSec);
    const d = circDist(after, target);
    record('2. 手動調時保護', d <= 60, `simSec=${after.toFixed(1)} target(now+7200)=${target.toFixed(1)} diff=${d.toFixed(2)}s（期望 ≤60s，即未被拉回現在）`);
  } catch (e) {
    record('2 執行例外', false, String(e && e.stack || e));
  }
  if (errors.length) record('2 期間無新增 JS 錯誤', false, errors.join(' | '));
  else record('2 期間無新增 JS 錯誤', true, '');
  await context.close();
}

// ── 情境 3：暫停保護（playing=false 時不應重錨）──
{
  const { context, page, errors } = await newPreparedPage(browser);
  try {
    const target = await page.evaluate(() => {
      window.togglePlay(); // 預設 playing=true → 切成 false
      const now = window.nowSecOfDay(window.activeTz());
      const t = ((now - 300) % 86400 + 86400) % 86400;
      window.__state.simSec = t;
      return t;
    });
    const playingAfterToggle = await page.evaluate(() => window.__state.playing);
    await page.evaluate(() => window.__setHidden(true));
    await page.evaluate(() => window.__setHidden(false));
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.__state.simSec);
    const d = circDist(after, target);
    record('3. 暫停保護', playingAfterToggle === false && d <= 5,
      `playing=${playingAfterToggle}（期望 false）, simSec=${after.toFixed(1)} target(now-300)=${target.toFixed(1)} diff=${d.toFixed(2)}s（期望 ≤5s，即未被重錨）`);
  } catch (e) {
    record('3 執行例外', false, String(e && e.stack || e));
  }
  if (errors.length) record('3 期間無新增 JS 錯誤', false, errors.join(' | '));
  else record('3 期間無新增 JS 錯誤', true, '');
  await context.close();
}

// ── 情境 4：快轉保護（speedMult=30 時不應重錨）──
{
  const { context, page, errors } = await newPreparedPage(browser);
  try {
    const target = await page.evaluate(() => {
      window.setSpeed(30);
      const now = window.nowSecOfDay(window.activeTz());
      const t = ((now - 300) % 86400 + 86400) % 86400;
      window.__state.simSec = t;
      return t;
    });
    const speedAfter = await page.evaluate(() => window.__state.speedMult);
    await page.evaluate(() => window.__setHidden(true));
    await page.evaluate(() => window.__setHidden(false));
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.__state.simSec);
    const d = circDist(after, target);
    record('4. 快轉保護', speedAfter === 30 && d <= 5,
      `speedMult=${speedAfter}（期望 30）, simSec=${after.toFixed(1)} target(now-300)=${target.toFixed(1)} diff=${d.toFixed(2)}s（期望 ≤5s，即未被重錨）`);
  } catch (e) {
    record('4 執行例外', false, String(e && e.stack || e));
  }
  if (errors.length) record('4 期間無新增 JS 錯誤', false, errors.join(' | '));
  else record('4 期間無新增 JS 錯誤', true, '');
  await context.close();
}

await browser.close();

const allPass = results.every(r => r.pass);
console.log('\n' + '='.repeat(60));
console.log(allPass ? 'TOTAL: PASS（五情境全過＋無新增 JS 錯誤）' : 'TOTAL: FAIL（見上方 FAIL 項目）');
console.log('='.repeat(60));
process.exit(allPass ? 0 : 1);
