// 模擬時鐘防漂移回歸測試（issue #13：使用者回報畫面時刻與實際差一兩分鐘）。
//
// 背景：原本只有 ?live 直播訊號源有時鐘校正，一般使用者沒有；而「回前景重錨」的條件寫成
// 「與現在的差距 ≤120 秒」，是單向陷阱——一旦漂超過 120 秒就永遠判定「不是即時」而不再重錨。
//
// 改法是引入 state.clockAtNow 旗標（開機對齊/按現在鈕為真，拖時刻尺或快轉為假），
// 所以驗收必須雙向：既要證明漂移會被收斂，也要證明「使用者刻意拖到別的時刻」不會被硬拉回現在。
//
// 用法：先在受測樹起 server，再 PORT=<port> ROOT=<樹路徑> node scripts/verify_clock_drift.mjs
import { createRequire } from 'module';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT || path.resolve(HERE, '..');
const PORT = Number(process.env.PORT || 5347);
const req = createRequire(fs.existsSync(path.join(ROOT, 'node_modules/playwright'))
  ? path.join(ROOT, 'package.json') : '/Users/xuxiang/Code/捷運小動畫/package.json');
const { chromium } = req('playwright');

const diskMd5 = createHash('md5').update(fs.readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
const servedMd5 = createHash('md5').update(Buffer.from(
  await (await fetch(`http://127.0.0.1:${PORT}/index.html`)).arrayBuffer())).digest('hex');
console.log(`G0 target=${ROOT}\n   disk=${diskMd5}\n   serve=${servedMd5}`);
if (diskMd5 !== servedMd5) { console.error('G0 FAIL：server 提供的不是目標樹的 index.html'); process.exit(1); }

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.error('PAGEERROR', e.message));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 100, null, { timeout: 180000 });

const drift = () => page.evaluate(() => +(state.simSec - nowSecOfDay(activeTz())).toFixed(2));
const flag = () => page.evaluate(() => !!state.clockAtNow);
const wait = ms => new Promise(r => setTimeout(r, ms));
const bg = async () => { await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }); };
const fg = async () => { await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }); };

let pass = 0, fail = 0;
const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

// 1. 開機後就處於「跟著現在」
t('開機後 clockAtNow 為真', await flag(), `漂移 ${await drift()}s`);

// 2. 前景漂移會被收斂（把時鐘推離 30 秒，不切背景）
await page.evaluate(() => { state.simSec = nowSecOfDay(activeTz()) - 30; });
await wait(2500);
const d2 = await drift();
t('前景漂移自動收斂（推離 30 秒）', Math.abs(d2) <= 2, `2.5 秒後漂移 ${d2}s`);

// 3. 陷阱（白箱）：進背景那一刻若已漂超過 120 秒，_wasLiveOnHide 仍須為 true。
//    舊寫法用「差距 ≤120 秒」推斷，這裡會是 false，回前景就永遠不重錨。
//    必須在同一個 evaluate 內完成「製造漂移 → 觸發 visibilitychange」，否則中間插進一次 tick，
//    前景校正會先把漂移修掉，這項就變成驗不到東西的假綠燈。
const wasLive = await page.evaluate(() => {
  state.clockAtNow = true;
  state.simSec = nowSecOfDay(activeTz()) + 200;
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  return state._wasLiveOnHide;
});
await fg(); await wait(1200);
const d3 = await drift();
t('進背景時已漂 200 秒仍判定為即時（原本是永不重錨的陷阱）', wasLive === true, `_wasLiveOnHide=${wasLive}`);
t('回前景後漂移已收斂', Math.abs(d3) <= 2, `漂移 ${d3}s`);

// 4. 反向：使用者拖時刻尺到過去，不可以被硬拉回現在
await page.evaluate(() => { setSimSec(nowSecOfDay(activeTz()) - 3600); });   // 拖到一小時前
const f4 = await flag();
await wait(2500);
const d4 = await drift();
t('拖時刻尺到 1 小時前不會被拉回現在', !f4 && d4 < -3000, `clockAtNow=${f4}、2.5 秒後漂移 ${d4}s`);

// 5. 反向：快轉中不可以被拉回
await page.evaluate(() => { setSpeed(30); });
await wait(1500);
const f5 = await flag();
t('快轉時 clockAtNow 為假（不會被拉回現在）', !f5);

// 6. 按「現在」鈕後恢復跟著現在，且校正重新生效
await page.evaluate(() => { jumpToNow(); });
const f6 = await flag();
await page.evaluate(() => { state.simSec = nowSecOfDay(activeTz()) - 20; });
await wait(2500);
const d6 = await drift();
t('按「現在」後恢復校正', f6 && Math.abs(d6) <= 2, `clockAtNow=${f6}、推離 20 秒後 2.5 秒回到 ${d6}s`);

// 7. 穩定狀態下時鐘必須連續前進，不可被校正反覆硬拉出跳變（那會讓車在畫面上抖動）。
//    判準寫「時鐘怎麼走」而不是「校正被呼叫幾次」：每 200ms 取樣，相鄰差應接近取樣間隔。
const samples = [];
for (let i = 0; i < 16; i++) { samples.push(await page.evaluate(() => state.simSec)); await wait(200); }
let maxJump = 0;
for (let i = 1; i < samples.length; i++) maxJump = Math.max(maxJump, Math.abs(samples[i] - samples[i - 1] - 0.2));
t('穩定狀態下時鐘連續前進，無跳變', maxJump < 0.5, `最大偏離 ${maxJump.toFixed(2)}s（取樣間隔 0.2s）`);

console.log(`\n合計 ${pass} PASS / ${fail} FAIL`);
await browser.close();
process.exit(fail ? 1 : 0);
