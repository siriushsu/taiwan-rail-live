// 自製列車通行證：真觸控入口、地圖資格、存檔保留及資格恢復。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const originalSource = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const mutations = {
  entry: s => s.replace('if (!PLUS_ENABLED || plusIsActive()) return true;', 'return true;'),
  map: s => s.replace('(PLUS_ENABLED && !plusIsActive()) || !saved.trains.length', '!saved.trains.length'),
  paid: s => s.replace('(PLUS_ENABLED && !plusIsActive()) || !saved.trains.length', 'true || !saved.trains.length'),
  sync: s => s.replaceAll('ownTrainEntitlementSync();', ''),
  storage: s => s.replace('function ownTrainEntitlementSync() {', 'function ownTrainEntitlementSync() {\n  if (!plusIsActive()) localStorage.removeItem(MyTrainUI.STORAGE_KEY);'),
  layout: s => s.replace("plusRequire('my-train', onGranted);", "plusRequire('my-train', onGranted);\n  document.documentElement.style.minWidth = '2000px';"),
  exception: s => s.replace('function ownTrainRequire(onGranted) {', "function ownTrainRequire(onGranted) {\n  setTimeout(() => { throw Error('my-train-plus-mutation'); }, 0);"),
  disabled: s => s.replace('if (!PLUS_ENABLED || plusIsActive()) return true;', 'if (plusIsActive()) return true;'),
  assignment: s => s.replace('p.active = data.active;', ''),
  follow: s => s.replace('state.followTrain = rec; state.followId = rec.train; ownTrainPanelUpdate(rec);', 'ownTrainPanelUpdate(rec);'),
};
const mutation = process.env.MYTRAIN_MUTATION || '';
if (mutation && !mutations[mutation]) throw Error(`未知突變：${mutation}`);
// 在本機回應中變更產品碼，磁碟上的版本維持不變，可與唯讀驗收並行。
const source = mutation ? mutations[mutation](originalSource) : originalSource;
if (mutation && source === originalSource) throw Error(`突變未命中：${mutation}`);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname.startsWith('/api/')) {
    res.setHeader('content-type', 'application/json');
    return res.end(u.pathname === '/api/thsr-schedule' ? readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')) : '{}');
  }
  let f = path.resolve(ROOT, '.' + decodeURIComponent(u.pathname));
  if (path.relative(ROOT, f).startsWith('..')) return res.writeHead(404).end();
  if (existsSync(f) && statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!existsSync(f)) return res.writeHead(404).end();
  res.setHeader('content-type', mime[path.extname(f)] || 'application/octet-stream');
  res.end(f === path.join(ROOT, 'index.html') ? source : readFileSync(f));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const rows = [];
const check = (id, pass, detail = '') => {
  rows.push({ id, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${detail}`);
};
const assignments = [...source.matchAll(/^\s*(?:p\.active = (?:data\.active|plusActiveFrom\(info\));|if \(state\.plus\) \{ state\.plus\.active = false;)[^\n]*\n(?:[^\n]*\n){0,3}/gm)];
check('S0 資格寫入路徑完整', assignments.length === 7, String(assignments.length));
for (let i = 0; i < assignments.length; i++) check(`S${i + 1} 資格寫入後同步自製列車`, assignments[i][0].includes('ownTrainEntitlementSync();'));
const rides = Array.from({ length: 4 }, (_, i) => ({ train: `P00${i}`, date: `2026-01-0${i + 1}`, sys: 'tra_sched', from: '臺北', to: '臺東', km: 310 }));
async function tap(page, selector) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  if (!b) throw Error(`控件不可見：${selector}`);
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  const hit = await el.evaluate((e, p) => e === document.elementFromPoint(p.x, p.y) || e.contains(document.elementFromPoint(p.x, p.y)), { x, y });
  if (!hit) throw Error(`控件被遮住：${selector}`);
  await page.tap(selector);
}
async function garage(page) {
  await page.evaluate(() => openTrainGarage());
  await page.waitForSelector('#trainGarage[open]');
  await tap(page, '#trainGarage [data-filter="all"]');
  await tap(page, '#trainGarage .g-car[data-model="emu800"]');
}
async function station(page, which, name) {
  await tap(page, `[data-mt-f="${which}"]`);
  await page.locator(`[data-mt-f="${which}"]`).fill(name);
  const suggestion = page.locator(`[data-mt-sug="${which}"] [data-mt-sug-key]`).filter({ hasText: new RegExp(`^${name}$`) }).first();
  await suggestion.waitFor({ state: 'visible' });
  await suggestion.scrollIntoViewIfNeeded();
  const b = await suggestion.boundingBox();
  if (!b) throw Error('選站建議不可見');
  await page.tap(`[data-mt-sug="${which}"] [data-mt-sug-key="${await suggestion.getAttribute('data-mt-sug-key')}"]`);
}
async function snapshot(page) {
  return page.evaluate(() => ({ n: state.myTrains.length, hits: state._ownTrainHits?.length || 0,
    save: localStorage.getItem(MyTrainUI.STORAGE_KEY), follow: isMyTrain(state.followTrain),
    form: !!document.querySelector('#mtForm[open]'), paywall: !document.getElementById('plusModal').hidden }));
}
async function qualify(page, active) {
  await page.evaluate(active => plusApplyCustomerInfo({ entitlements: { active: active ? { plus: { identifier: 'plus' } } : {} } }), active);
}
async function modalScan(page) {
  const controls = page.locator('#plusModal button, #plusModal a');
  const failures = [];
  for (let i = 0; i < await controls.count(); i++) {
    const el = controls.nth(i);
    if (!(await el.isVisible())) continue;
    await el.scrollIntoViewIfNeeded();
    const bad = await el.evaluate(e => {
      const r = e.getBoundingClientRect(), p = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1 || !(p === e || e.contains(p));
    });
    if (bad) failures.push(await el.textContent());
  }
  // 掃全部既有互動控件；與遮罩重疊的控件必須真的被遮罩攔下，不能穿透點擊。
  const scan = await page.evaluate(() => {
    const panel = document.querySelector('#plusModal .plus-panel') || document.querySelector('#plusBody').parentElement;
    const r = panel.getBoundingClientRect();
    const bad = [];
    for (const el of document.querySelectorAll('button,a,input,select,[role="button"]')) {
      if (el.closest('#plusModal') || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
      const b = el.getBoundingClientRect(), x = Math.max(r.left, b.left), y = Math.max(r.top, b.top);
      if (Math.min(r.right, b.right) <= x || Math.min(r.bottom, b.bottom) <= y) continue;
      const hit = document.elementFromPoint(x + .1, y + .1);
      if (!hit?.closest('#plusModal')) bad.push(el.id || el.className);
    }
    return { bad, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  return [...failures, ...scan.bad, ...(scan.overflow ? ['水平溢出'] : [])];
}
const widths = String(process.env.MYTRAIN_WIDTHS || '360,375,414,768').split(',').map(Number);
try {
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    if (process.env.MYTRAIN_ENGINE && process.env.MYTRAIN_ENGINE !== name) continue;
    const browser = await engine.launch(name === 'chromium' ? { channel: 'chrome', headless: true } : { headless: true });
    try {
      let savedTrain = null;
      for (const width of widths) {
        const prefix = `${name}/${width}`;
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, isMobile: true, hasTouch: true, locale: 'zh-TW' });
        try {
          await ctx.addInitScript(rides => {
            localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-language', 'zh-TW');
            localStorage.setItem('trainmap-rides', JSON.stringify(rides)); localStorage.setItem('trainmap-powersave', '0');
          }, rides);
          const page = await ctx.newPage(), errors = [];
          page.on('pageerror', e => errors.push(e.message));
          await page.goto(base + '/?g=nat', { waitUntil: 'domcontentloaded' });
          await page.waitForFunction(() => state.ready && state.trains.length && window.MyTrainUI && window.MyTrainPlan, null, { timeout: 60000 });
          await page.evaluate(() => { state.playing = false; state.simSec = 8 * 3600; });
          await garage(page);
          await tap(page, '#trainGarage [data-mt-g="schedule"]');
          const a = await snapshot(page);
          check(`${prefix} A1 未持證入口打開付費牆`, a.paywall && !a.form && a.n === 0);
          const ui = [];
          if (a.paywall) {
            for (const fs of [false, true]) {
              await page.evaluate(fs => {
                document.body.classList.toggle('fs', fs);
                state.alert = { ...(state.alert || {}), list: fs ? [{ sys: 'tra_sched', sysLabel: '台鐵', title: '驗收公告', desc: '驗收公告內容' }] : [] };
                renderAlertBanner();
                document.getElementById('alertDetail').hidden = !fs;
                document.body.classList.toggle('tools-open', fs);
                if (fs) openRidePanel(); else closeRidePanel();
              }, fs);
              ui.push(...await modalScan(page));
            }
            check(`${prefix} UI 付費牆全控件命中、背景交集及溢出掃描`, ui.length === 0, ui.join(','));
            await tap(page, '#plusX');
          } else check(`${prefix} UI 付費牆全控件命中、背景交集及溢出掃描`, false, '付費牆未開啟');
          await page.evaluate(() => {
            document.body.classList.remove('fs','tools-open'); closeRidePanel(); document.getElementById('alertDetail').hidden = true;
            // 前一情境即使被突變開了表單，後面的獨立判準仍須完整執行。
            MyTrainUI.closeForm(); window.TrainGarage?.close();
          });
          await qualify(page, true);
          await garage(page);
          await tap(page, '#trainGarage [data-mt-g="schedule"]');
          await page.waitForSelector('#mtForm[open]', { timeout: 5000 });
          await station(page, 'from', '臺北'); await station(page, 'to', '板橋');
          await page.locator('[data-mt-f="name"]').fill('通行證測');
          await page.locator('[data-mt-f="name"]').dispatchEvent('input');
          await tap(page, '[data-mt-f="depart"]');
          // 排好車留在機務段;這支接著驗跟車,接到車庫「去看它」同一條路。
          await page.waitForFunction(() => !document.getElementById('mtForm').open, null, { timeout: 8000 });
          await page.evaluate(() => { MyTrainDepot.close(); ownTrainFollow({ id: MyTrainUI.load().trains.at(-1).id }); });
          const drawn = await page.evaluate(() => {
            const tr = state.myTrains[0]; if (!tr) return false;
            state.simSec = tr.stops[0].depSec + 20; state.clockAtNow = false;
            const p = trainPos(tr, state.simSec); if (!p) return false;
            M.setView([p.lat,p.lon], 13); draw();
            return state._ownTrainHits.some(h => h.tr === tr);
          });
          const b = await snapshot(page);
          savedTrain = b.save;
          check(`${prefix} B1 持證可新建且地圖畫出列車`, b.n === 1 && drawn && JSON.parse(b.save || '{}').trains?.length === 1);
          // 同一次取樣避免正常跟車 rAF 混入資格重驗前後的比較。
          const refreshed = await page.evaluate(() => {
            const before = { time: state.simSec, center: [M.getCenter().lat, M.getCenter().lng] };
            plusApplyCustomerInfo({ entitlements: { active: { plus: { identifier: 'plus' } } } });
            return { same: state.followTrain === state.myTrains[0], before, time: state.simSec,
              center: [M.getCenter().lat, M.getCenter().lng] };
          });
          check(`${prefix} C4 資格重驗保留同班跟隨、時鐘與鏡頭`, refreshed.same && refreshed.time === refreshed.before.time
            && JSON.stringify(refreshed.center) === JSON.stringify(refreshed.before.center), JSON.stringify(refreshed));
          await qualify(page, false);
          const c = await snapshot(page);
          check(`${prefix} C1 資格失效撤下地圖並結束跟隨`, c.n === 0 && c.hits === 0 && !c.follow);
          check(`${prefix} C2 資格失效保留原始存檔`, !!b.save && c.save === b.save);
          await page.evaluate(() => ownTrainRebuild());
          check(`${prefix} A2 未持證重建仍為零台`, (await snapshot(page)).n === 0);
          // 存檔仍有資料的入口及表單、面板回呼都要經過相同的付費牆。
          const bypass = await page.evaluate(() => {
            const train = MyTrainUI.load().trains[0];
            const calls = [() => ownTrainSchedule(train.modelId), () => ownTrainReplan(), () => ownTrainOpenForm(),
              () => ownTrainView(), () => ownTrainFollow(), () => ownTrainDepart(train), () => ownTrainEdit(train),
              () => ownTrainSetAppearance({ haloOn: false }), () => MyTrainUI.openForm(ownTrainHost(), { modelId: train.modelId })];
            return calls.map(call => { plusClose(); call(); return !document.getElementById('plusModal').hidden && !document.querySelector('#mtForm[open]'); }).every(Boolean);
          });
          check(`${prefix} A3 車庫、表單與面板回呼皆擋未持證`, bypass && (await snapshot(page)).save === b.save);
          await page.evaluate(() => { plusClose(); plusState().afterUnlock = null; });
          await qualify(page, true);
          const d = await snapshot(page);
          check(`${prefix} C3 資格恢復自動回到地圖`, d.n === 1 && d.save === b.save);
          check(`${prefix} E1 零頁面例外`, errors.length === 0, errors.join('|'));
        } catch (e) { check(`${prefix} 執行完成`, false, e.stack); }
        finally { await ctx.close(); }
      }
      const disabled = await browser.newContext({ viewport: { width: 360, height: 900 }, isMobile: true, hasTouch: true });
      try {
        await disabled.addInitScript(({ save, rides }) => {
          window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {} };
          window.RAIL_ANDROID_PLUS_ENABLED = false;
          localStorage.setItem('trainmap-howto-seen', '1'); localStorage.setItem('trainmap-language', 'zh-TW');
          localStorage.setItem('trainmap-rides', JSON.stringify(rides));
          if (save) localStorage.setItem('trainmap-my-fleet-v1', save);
        }, { save: savedTrain, rides });
        const page = await disabled.newPage();
        await page.goto(base + '/?g=nat', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => state.ready && window.MyTrainUI, null, { timeout: 60000 });
        await page.evaluate(() => ownTrainOpenForm());
        const result = await page.evaluate(() => ({ disabled: !PLUS_ENABLED, active: plusIsActive(), n: state.myTrains.length,
          form: !!document.querySelector('#mtForm[open]'), paywall: !document.getElementById('plusModal').hidden }));
        check(`${name} D1 關閉通行證環境比照匯入直接可用`, result.disabled && !result.active && result.n === 1 && result.form && !result.paywall, JSON.stringify(result));
      } catch (e) { check(`${name} D1 執行完成`, false, e.message); }
      finally { await disabled.close(); }
    } finally { await browser.close(); }
  }
} finally { server.close(); }
const failed = rows.filter(x => !x.pass);
console.log(`總計 ${rows.length} 項，PASS ${rows.length - failed.length}／FAIL ${failed.length}`);
process.exitCode = failed.length ? 1 : 0;
