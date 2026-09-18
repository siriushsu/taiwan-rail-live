// 跟車轉動視角的守門人:轉動鏡頭時跟車不能停在原地,轉動手勢本身也不能被相機打斷。
//
// 這支閘門的前身只斷言 state.followLock 有沒有被清掉,而且在 state.ready 之後立刻就動滑鼠——
// 立體列車要再 4 到 6 秒才真的載起來,所以它碰到的是平面那條路徑,拿去跑修正前的 commit 一樣全過。
// 現在改成量「地圖中心離跟隨中列車多遠」:鏡頭停住的話,列車每秒會被甩開幾百公尺,一眼就分得出來。
// 對照組(2026-09-18 實測,4 倍速、2 秒右鍵旋轉):未修版偏離 653 公尺,修正後 36 公尺。
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5208/';
const DRIFT_LIMIT = 120; // 公尺:相對於手勢開始前的取景偏移量,超過就是鏡頭沒跟上(修正後量到 36,未修版 677)
const results = [];

async function openFollowing(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW' });
  await context.addInitScript(() => localStorage.setItem('trainmap-howto-seen', '1'));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${BASE}?scene=3d&g=all&train=117&t=12:00&z=18&formation=actual&ground=flat&lang=zh-TW`);
  await page.waitForFunction(() => state.ready && state.followTrain, null, { timeout: 60000 });
  // 立體列車真的接手相機之後才算數:followMoves 要開始跳,否則量到的是平面那條路徑。
  await page.waitForFunction(
    () => !!window.railIslandIntegration?.active && window.railIslandIntegration.renderer.stats.followMoves > 0,
    null, { timeout: 60000 });
  return { context, page, errors };
}

// 地圖中心離「跟隨中的那班車」多遠。用列車自己的即時座標,不用 stats.followFraming——
// 後者只在跟車相機真的跑過時才更新,鏡頭停住時它會跟著一起停,量出來永遠是 0。
const followGap = page => page.evaluate(() => {
  const v = window.railIslandIntegration.capture().vehicles.find(x => x.followed);
  if (!v) return null;
  const c = M.raw.getCenter(), R = 6371000, rad = d => d * Math.PI / 180;
  return {
    m: Math.hypot(rad(v.longitude - c.lng) * Math.cos(rad(c.lat)), rad(v.latitude - c.lat)) * R,
    bearing: M.raw.getBearing(), lock: !!state.followLock,
  };
});

async function setUp(page, headingUp) {
  await page.evaluate(up => {
    if (!state.followLock) setFollowLock(true);
    setFollowHeadingUp(up);
    state.speedMult = 4; // 鏡頭一停就甩開,倍率太低量不出來;太高會整段跑完停站
  }, headingUp);
  await page.waitForTimeout(1500);
}

// 右鍵拖曳＝MapLibre 的 dragRotate(Ctrl＋左鍵同一條路徑);平移是 dragPan,兩者要分開驗。
async function rotateCase(browser, headingUp) {
  const name = `旋轉中維持跟車(車頭朝上${headingUp ? '開' : '關'})`;
  const { context, page, errors } = await openFollowing(browser);
  try {
    await setUp(page, headingUp);
    const before = await followGap(page), cx = 640, cy = 400, samples = [];
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'right' });
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(cx + 22 * (i + 1), cy - 7 * (i + 1), { steps: 2 });
      await page.waitForTimeout(250);
      samples.push(await followGap(page));
    }
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(800);
    const after = await followGap(page);
    const drift = Math.max(...samples.map(s => Math.abs(s.m - before.m)));
    // 轉過的角度要真的有動:相機若用 jumpTo 提交,MapLibre 會 stop() 掉旋轉,使用者反而轉不動。
    const turned = Math.abs(((after.bearing - before.bearing + 540) % 360) - 180);
    results.push({
      name, pass: drift <= DRIFT_LIMIT && turned >= 60 && after.lock && !errors.length,
      driftM: +drift.toFixed(1), turnedDeg: +turned.toFixed(1), stillFollowing: after.lock, errors: errors.slice(0, 2),
    });
  } catch (e) { results.push({ name, pass: false, error: e.stack }); } finally { await context.close(); }
}

async function panCase(browser, headingUp, shouldUnlock) {
  const name = `平移${shouldUnlock ? '解除' : '維持'}跟車(車頭朝上${headingUp ? '開' : '關'})`;
  const { context, page, errors } = await openFollowing(browser);
  try {
    await setUp(page, headingUp);
    const cx = 640, cy = 400;
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(cx + 170, cy + 150, { steps: 6 });
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(1200);
    const after = await followGap(page);
    results.push({ name, pass: after.lock === !shouldUnlock && !errors.length, stillFollowing: after.lock, errors: errors.slice(0, 2) });
  } catch (e) { results.push({ name, pass: false, error: e.stack }); } finally { await context.close(); }
}

const browser = await chromium.launch();
try {
  await rotateCase(browser, false); // #58／#50:轉動視角時跟車視角停在原地
  await rotateCase(browser, true);
  await panCase(browser, true, false); // 9/16:車頭朝上時只由開關解鎖
  await panCase(browser, false, true); // 一般桌面平面視角仍可拖曳解鎖
} finally { await browser.close(); }

for (const r of results) console.log(r.pass ? 'PASS' : 'FAIL', JSON.stringify(r));
if (results.some(r => !r.pass)) process.exitCode = 1;
