// 驗證跟車視角旋轉手勢不中斷跟隨，且車頭朝上轉彎時列車始終置中
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'zh-TW',
  });
  await context.addInitScript(() => {
    localStorage.setItem('trainmap-howto-seen', '1');
  });

  const page = await context.newPage();
  const base = process.env.BASE_URL || 'http://127.0.0.1:5208/';
  await page.goto(`${base}?g=all&train=117&t=12:00&lang=zh-TW`);
  await page.waitForFunction(() => state.ready && state.followTrain, null, { timeout: 30000 });

  const canvasBox = await page.locator('.maplibregl-canvas').boundingBox();
  const cx = canvasBox.x + canvasBox.width / 2;
  const cy = canvasBox.y + canvasBox.height / 2;

  // 1. 驗證右鍵拖曳旋轉時維持 followLock
  console.log('1. Testing right-click rotation gesture...');
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + 100, cy - 50, { steps: 5 });
  const midRotate = await page.evaluate(() => ({
    followLock: state.followLock,
    gestureActive: M.mapGestureActive?.(),
  }));
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(400);

  if (!midRotate.followLock) {
    throw new Error('followLock was unlocked during right-click rotation!');
  }
  const lockAfterRotate = await page.evaluate(() => state.followLock);
  if (!lockAfterRotate) {
    throw new Error('followLock was unlocked after right-click rotation finished!');
  }
  console.log('PASS: Rotation gesture keeps followLock active.');

  // 2. 驗證車頭朝上轉彎時列車穩定置中（不漂移、不發散）
  console.log('2. Testing followHeadingUp around curves...');
  await page.evaluate(() => {
    setFollowLock(true);
    setFollowHeadingUp(true);
    setSimSec(43205);
    state.playing = true;
    state.speedMult = 1;
  });

  let initialScr = null;
  const offsets = [];
  for (let step = 0; step < 10; step++) {
    await page.waitForTimeout(200);
    const info = await page.evaluate(() => {
      const f = railIslandIntegration?.capture?.();
      const v = f?.vehicles?.find(x => x.followed);
      const coord = v ? [v.longitude, v.latitude] : [0, 0];
      const scr = M.raw.project(coord);
      return { scr };
    });
    if (!initialScr) initialScr = info.scr;
    const drift = Math.hypot(info.scr.x - initialScr.x, info.scr.y - initialScr.y);
    offsets.push(drift);
  }

  const maxDrift = Math.max(...offsets);
  console.log('Max drift during followHeadingUp:', maxDrift.toFixed(2), 'px');
  if (maxDrift > 10) {
    throw new Error(`Train drifted from its anchor during followHeadingUp: ${maxDrift}px`);
  }
  console.log('PASS: Train stays perfectly anchored during followHeadingUp.');

  // 3. 驗證純平移手勢（左鍵 Pan）依然正常解鎖
  console.log('3. Testing pure pan gesture unlocks followLock...');
  await page.evaluate(() => {
    setFollowHeadingUp(false);
    setFollowLock(true);
  });
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(cx + 150, cy + 150, { steps: 5 });
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(300);

  const lockAfterPan = await page.evaluate(() => state.followLock);
  if (lockAfterPan !== false) {
    throw new Error('Expected pure pan gesture to unlock followLock!');
  }
  console.log('PASS: Pure pan unlocks followLock as expected.');

  console.log('\nAll follow & rotation verifications PASSED!');
  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
