// 「上次視野記憶」(v0718o)獨立行為驗證——Playwright 真引擎(chromium+webkit)+本機靜態伺服器。
// 本腳本未參與實作,以下是我從 index.html 原始碼讀出的關鍵事實(供本腳本判準依據,寫在這裡以免只留在回報裡):
//
//   · localStorage key = 'trainmap-last-view' (index.html:9547 `const LAST_VIEW_KEY`)。
//   · saveLastView()(9548-9563)守門序:!state.ready→不存;liveMode||director→不存(?live= 契約);
//     autoTour||_hotScene→不存(放空巡航/群車俯瞰);followTrain||freqFollow→不存(跟車)。
//     全部通過才 GROUPS.find(state.group) 存在才寫 {g,lat,lon,z,sel},sel 依 g.mode 取 freqSel/schedSel/null。
//     全檔僅 3 處呼叫點:toggleFreqMember/toggleSchedMember 顯式呼叫(勾選不移動地圖不發 moveend)+
//     map.on('moveend', saveLastView) 註冊(9537,在開機還原用的 setView 之後才掛,故開機自身的還原動作不會誤存)。
//   · loadLastView()(9565-9577)還原防呆:JSON.parse 例外→null;lat/lon 非 finite→null;
//     群組 id 找不到→null;sel 只留在 g.members 內的項目。全包在 try/catch。
//   · boot() 優先序(9497-9536):deepG/deepAt/deepTrain/deepTrip 任一有值,或 state.liveMode 為真
//     →lastView 強制 null(9512),分享連結/跟車連結/行程連結/直播一律蓋過本機記憶。
//     沒有深連結時才 loadLastView();bootGroup 預設 'all'(全台同框)。
//   · GROUPS(4964-4977):all(全台同框,mode:all)/nat(國家鐵路,sched)/north(北北桃,freq,
//     members=[mrt,tymc,ntdlrt,ntalrt,sanying])/south(中南部,freq,members=[tmrt,krtc])。
//   · 群組頁籤 DOM:#systems .gtab(文字=g.label,onclick=selectGroup);成員核取:
//     #systems .mem[data-id=系統id](freq 模式 onclick=toggleFreqMember)。
//   · 放空模式(#ambientBtn→setAmbient(true)):若當時已在 sched 模式,不會走 loadSystem 分支
//     (無額外 fitData/moveend 干擾);ambientStyle 預設 'hotspot'(v0717v),進場後下一影格
//     hotspotTick 就把 state._hotScene 設好『之後』才 map.setView,故該次 moveend 觸發時 guard 已生效。
//   · 跟車(#trainSearch 打車號+Enter→followNo→followTrainNo→setFollow):setFollow 同步設
//     state.followTrain 在前,camera 置中靠每影格 updateFollowCamera()/recenterTo,故跟隨期間任何
//     moveend 觸發時 guard 必已生效。
//   · state.simSec 從不進 saveLastView 的 payload,且每次載入群組都用 nowSecOfDay(tz) 重新起算——
//     「上次視野」只記地圖視角,不記時刻。
//
// 設計取捨(供覆核):
//   · 用 page.evaluate 呼叫 map.setView(...)/setSimSec(...) 直接製造精確座標與時間,而非用滑鼠拖曳/
//     滾輪模擬——這呼叫的是 Leaflet 真正的公開 API 與 app 自己的公開函式,和使用者拖曳/縮放最終
//     觸發的事件路徑相同(moveend),只是用來取得可斷言的精確數值,不是繞過待驗證的邏輯本身。
//   · F(跟車豁免)以「填 #trainSearch + 按 Enter」實際操作 UI(非直接呼叫 setFollow),車次資料
//     來自另一次乾淨開機讀 state.trains 篩出的真實存在車次,避免憑空杜撰車次號。
//   · 判斷「是否行駛中」用 app 自己的 trainPos(tr,t) 函式(非本腳本重新實作列車運行邏輯)。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5199;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) { res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, r));
const BASE = `http://localhost:${PORT}/`;

const LAST_VIEW_KEY = 'trainmap-last-view'; // 確認來源:index.html:9547

const results = [];
const skips = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const skip = (name, reason) => { skips.push({ name, reason }); console.log(`SKIP ${name} — ${reason}`); };

const allErrors = [];
function attach(page, tag) {
  const local = [];
  page.on('pageerror', e => { const m = `[${tag}] pageerror: ${e}`; local.push(m); allErrors.push(m); });
  page.on('console', m => { if (m.type() === 'error') { const s = `[${tag}] console.error: ${m.text()}`; local.push(s); allErrors.push(s); } });
  return local;
}

async function newPage(browser, { width = 1280, height = 800, touch = false, seed = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  // 抑制首訪「怎麼玩」教學卡(#howtoWrap,index.html:8713-8730)——它與 last-view 記憶功能無關,
  // 但全螢幕擋在畫面上會讓後續真實點擊(.gtab/#ambientBtn/#trainSearch)卡住;比照既有
  // scripts/verify_ride_sort.mjs 的作法,固定先寫 trainmap-howto-seen=1 抑制它,不影響本腳本任何判準。
  await ctx.addInitScript(([key, raw]) => {
    try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
    if (raw != null) { try { localStorage.setItem(key, raw); } catch (e) {} }
  }, [LAST_VIEW_KEY, seed]);
  const page = await ctx.newPage();
  return { ctx, page };
}
async function waitReady(page) {
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 30000 });
  await page.waitForTimeout(350);
}
async function gotoReady(page, qs = '') {
  await page.goto(BASE + qs, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
}
const centerOf = (page) => page.evaluate(() => { const c = map.getCenter(); return { lat: c.lat, lng: c.lng, z: map.getZoom() }; });
const rawLV = (page) => page.evaluate(k => localStorage.getItem(k), LAST_VIEW_KEY);
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;
const moved = (c1, c2) => Math.abs(c1.lat - c2.lat) > 1e-4 || Math.abs(c1.lng - c2.lng) > 1e-4 || Math.round(c1.z) !== Math.round(c2.z);

const chromiumB = await chromium.launch();
const webkitB = await webkit.launch();

// ══════════════ A. 首訪(乾淨 localStorage) ══════════════
{
  const { ctx, page } = await newPage(chromiumB);
  attach(page, 'A');
  await gotoReady(page);
  const group = await page.evaluate(() => state.group);
  const tabTxt = await page.evaluate(() => document.querySelector('#systems .gtab.active')?.textContent || null);
  const lv1 = await rawLV(page);
  ok('A1 首訪預設群組=all(全台同框)', group === 'all', `實際=${group}`);
  ok('A2 首訪頁籤文字=全台同框', tabTxt === '全台同框', `實際=${tabTxt}`);
  ok('A3 首訪開機未操作即未寫入 last-view', lv1 === null, `實際=${lv1}`);
  await page.waitForTimeout(3000);
  const lv2 = await rawLV(page);
  ok('A4 閒置3秒(仍未操作)未寫入 last-view', lv2 === null, `實際=${lv2}`);
  await ctx.close();
}

// ══════════════ Fixture:抓真實車次/行程資料,供 C2/C3/F 使用 ══════════════
let FIX_TRAIN_ANY = null, FIX_TRAIN_ACTIVE = null, FIX_TRIP = null;
{
  const { ctx, page } = await newPage(chromiumB);
  attach(page, 'FIX');
  await gotoReady(page);
  const fx = await page.evaluate(() => {
    const numeric = tr => /^\d+$/.test(String(tr.train));
    const anyTr = state.trains.find(numeric);
    let active = null;
    for (const tr of state.trains) {
      if (!numeric(tr)) continue;
      const p0 = trainPos(tr, state.simSec), p1 = trainPos(tr, state.simSec + 5);
      if (p0 && p1 && (Math.abs(p0.lat - p1.lat) > 1e-5 || Math.abs(p0.lon - p1.lon) > 1e-5)) { active = { train: tr.train, sys: tr.sys }; break; }
    }
    let trip = null;
    for (const tr of state.trains) {
      if (!numeric(tr)) continue;
      const code = tripSysCode(tr.sys);
      if (!code) continue;
      const rem = tripRemainingStops(tr);
      if (rem.length) { trip = { train: tr.train, sys: tr.sys, code, dest: rem[0].s.name, date: tripOpsDate() }; break; }
    }
    return { anyTr: anyTr ? { train: anyTr.train, sys: anyTr.sys } : null, active, trip };
  });
  FIX_TRAIN_ANY = fx.anyTr; FIX_TRAIN_ACTIVE = fx.active; FIX_TRIP = fx.trip;
  console.log('FIXTURE 真實車次(任一,供C2)=', JSON.stringify(FIX_TRAIN_ANY));
  console.log('FIXTURE 真實行駛中車次(供F)=', JSON.stringify(FIX_TRAIN_ACTIVE));
  console.log('FIXTURE 行程分享車次(供C3)=', JSON.stringify(FIX_TRIP));
  await ctx.close();
}

// ══════════════ B/I/J 共用流程:切頁籤+改勾選+移動地圖 → reload → 驗證還原 ══════════════
async function persistRestoreFlow(browser, label, { width = 1280, height = 800, touch = false } = {}) {
  const { ctx, page } = await newPage(browser, { width, height, touch });
  attach(page, label);
  await gotoReady(page);
  const act = async (sel) => { if (touch) await page.locator(sel).tap(); else await page.click(sel); };

  await act('#systems .gtab:text-is("北北桃")');
  await page.waitForTimeout(500);
  await act('#systems .mem[data-id="tymc"]');
  await page.waitForTimeout(150);
  await act('#systems .mem[data-id="sanying"]');
  await page.waitForTimeout(150);
  const target = { lat: 25.0330, lon: 121.5654, z: 14 };
  await page.evaluate((t) => map.setView([t.lat, t.lon], t.z, { animate: false }), target);
  await page.waitForTimeout(300);

  const savedRaw = await rawLV(page);
  let saved = null; try { saved = JSON.parse(savedRaw); } catch (e) {}
  ok(`${label}0 操作後已寫入 last-view(g=north+目標座標+去掉tymc/sanying)`,
    !!saved && saved.g === 'north' && near(saved.lat, target.lat, 0.001) && near(saved.lon, target.lon, 0.001) && saved.z === target.z &&
    Array.isArray(saved.sel) && !saved.sel.includes('tymc') && !saved.sel.includes('sanying'),
    `實際=${savedRaw}`);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitReady(page);

  const group = await page.evaluate(() => state.group);
  const tabTxt = await page.evaluate(() => document.querySelector('#systems .gtab.active')?.textContent || null);
  const cz = await centerOf(page);
  const sel = await page.evaluate(() => state.freqSel ? [...state.freqSel].sort() : null);
  const memberUI = await page.evaluate(() => ({
    tymc: document.querySelector('#systems .mem[data-id="tymc"]')?.classList.contains('on'),
    sanying: document.querySelector('#systems .mem[data-id="sanying"]')?.classList.contains('on'),
    mrt: document.querySelector('#systems .mem[data-id="mrt"]')?.classList.contains('on'),
  }));
  const expectSel = ['mrt', 'ntdlrt', 'ntalrt'].sort();

  ok(`${label}1 reload 後群組還原為 north(北北桃)`, group === 'north' && tabTxt === '北北桃', `group=${group} 頁籤=${tabTxt}`);
  ok(`${label}2 reload 後地圖中心還原(誤差<0.01度)`, near(cz.lat, target.lat, 0.01) && near(cz.lng, target.lon, 0.01),
    `實際=lat${cz.lat},lng${cz.lng} 期望=lat${target.lat},lon${target.lon}`);
  ok(`${label}3 reload 後縮放倍率還原`, Math.round(cz.z) === target.z, `實際=${cz.z} 期望=${target.z}`);
  ok(`${label}4 reload 後勾選系統集合還原(排除 tymc/sanying)`, JSON.stringify(sel) === JSON.stringify(expectSel),
    `實際=${JSON.stringify(sel)} 期望=${JSON.stringify(expectSel)}`);
  ok(`${label}5 reload 後成員核取 UI 亦反映還原狀態`, memberUI.tymc === false && memberUI.sanying === false && memberUI.mrt === true,
    `實際=${JSON.stringify(memberUI)}`);

  await ctx.close();
}

await persistRestoreFlow(chromiumB, 'B');                                   // 桌面 chromium 1280×800
await persistRestoreFlow(chromiumB, 'I', { width: 375, height: 812, touch: true }); // 手機寬度 375(觸控)
await persistRestoreFlow(webkitB, 'J');                                     // WebKit 引擎

// ══════════════ C. 分享連結優先(最高風險) ══════════════
const CONFLICT_SEED = JSON.stringify({ g: 'north', lat: 24.99, lon: 121.30, z: 11, sel: ['mrt'] });

// C1: ?g=south&at=...&z=...
{
  const { ctx, page } = await newPage(chromiumB, { seed: CONFLICT_SEED });
  attach(page, 'C1');
  await gotoReady(page, '?g=south&at=22.63,120.30&z=13');
  const group = await page.evaluate(() => state.group);
  const cz = await centerOf(page);
  ok('C1 群組=south(不被本機記憶的north蓋掉)', group === 'south', `實際=${group}`);
  ok('C1 地圖中心=連結座標(22.63,120.30,誤差<0.01)', near(cz.lat, 22.63, 0.01) && near(cz.lng, 120.30, 0.01), `實際=${JSON.stringify(cz)}`);
  ok('C1 縮放=連結指定的13', Math.round(cz.z) === 13, `實際=${cz.z}`);
  await ctx.close();
}

// C2: ?train=<真實車次>
if (FIX_TRAIN_ANY) {
  const { ctx, page } = await newPage(chromiumB, { seed: CONFLICT_SEED });
  attach(page, 'C2');
  await gotoReady(page, `?train=${encodeURIComponent(String(FIX_TRAIN_ANY.train))}`);
  const info = await page.evaluate(() => ({
    group: state.group,
    followId: state.followTrain ? String(state.followTrain.train) : null,
    followSys: state.followTrain ? state.followTrain.sys : null,
  }));
  ok('C2 群組=all(未被記憶的north帶走)', info.group === 'all', `實際=${info.group}`);
  ok('C2 確實跟隨了連結指定車次', info.followId === String(FIX_TRAIN_ANY.train), `實際=${info.followId} 期望=${FIX_TRAIN_ANY.train}`);
  await ctx.close();
} else skip('C2 ?train= 深連結', '抓不到任何真實存在的數字車次(state.trains 為空)');

// C3: ?trip=<真實行程分享>
if (FIX_TRIP) {
  const segs = [FIX_TRIP.code, String(FIX_TRIP.train), encodeURIComponent(FIX_TRIP.dest), FIX_TRIP.date];
  const tripParam = segs.join('.');
  const { ctx, page } = await newPage(chromiumB, { seed: CONFLICT_SEED });
  attach(page, 'C3');
  await gotoReady(page, `?trip=${tripParam}`);
  const info = await page.evaluate(() => ({
    group: state.group,
    tripErr: state._trip ? state._trip.err : 'NO_TRIP_STATE',
    tripDest: state._trip && state._trip.dest ? state._trip.dest.name : null,
    followTrain: state.followTrain ? String(state.followTrain.train) : null,
  }));
  ok('C3 群組=all(未被記憶的north帶走)', info.group === 'all', `實際=${info.group}`);
  ok('C3 行程解析成功(err=null)', info.tripErr === null, `實際=${info.tripErr} (tripParam=${tripParam})`);
  ok('C3 跟隨連結指定車次', info.followTrain === String(FIX_TRIP.train), `實際=${info.followTrain} 期望=${FIX_TRIP.train}`);
  ok('C3 目的站=連結指定站', info.tripDest === FIX_TRIP.dest, `實際=${info.tripDest} 期望=${FIX_TRIP.dest}`);
  await ctx.close();
} else skip('C3 ?trip= 行程分享連結', '抓不到可用的行程分享車次(無剩餘停站的數字車次)');

// ══════════════ D. 直播豁免(?live=1) ══════════════
{
  const seedStr = JSON.stringify({ g: 'north', lat: 24.99, lon: 121.30, z: 11, sel: ['mrt', 'tymc'] });
  const { ctx, page } = await newPage(chromiumB, { seed: seedStr });
  attach(page, 'D');
  await gotoReady(page, '?live=1');
  await page.waitForFunction(() => state.autoTour === true || state.ambient === true, null, { timeout: 15000 }).catch(() => {});
  const group = await page.evaluate(() => state.group);
  const raw1 = await rawLV(page);
  const cz1 = await centerOf(page);
  await page.waitForTimeout(4000);
  const cz2 = await centerOf(page);
  const raw2 = await rawLV(page);
  ok('D1 live=1 不讀記憶,開場仍為 all(全台同框)', group === 'all', `實際=${group}`);
  ok('D2 live=1 開場後 last-view 仍是原封不動的種子值', raw1 === seedStr, `實際=${raw1}`);
  ok('D3 直播鏡頭確實自動移動了(巡航中)', moved(cz1, cz2), `移動前=${JSON.stringify(cz1)} 移動後=${JSON.stringify(cz2)}`);
  ok('D4 巡航移動後 last-view 仍與種子值逐字相同(未被改寫)', raw2 === seedStr, `巡航前=${raw1} 巡航後=${raw2}`);
  await ctx.close();
}

// ══════════════ E. 巡航豁免(非直播,放空模式) ══════════════
{
  const { ctx, page } = await newPage(chromiumB);
  attach(page, 'E');
  await gotoReady(page);
  await page.evaluate(() => map.setView([23.9, 120.9], 9, { animate: false }));
  await page.waitForTimeout(300);
  const baseline = await rawLV(page);
  ok('E0 進入放空前已有一筆使用者操作的記憶', !!baseline, `實際=${baseline}`);

  await page.click('#ambientBtn');
  await page.waitForTimeout(500);
  const engaged = await page.evaluate(() => ({ ambient: state.ambient, autoTour: state.autoTour, hotScene: !!state._hotScene }));
  const cz1 = await centerOf(page);
  await page.waitForTimeout(5000);
  const cz2 = await centerOf(page);
  const after = await rawLV(page);
  ok('E1 放空模式確實進入(ambient=true 且 autoTour或群車熱區已啟動)', engaged.ambient === true && (engaged.autoTour === true || engaged.hotScene === true),
    `實際=${JSON.stringify(engaged)}`);
  ok('E2 放空鏡頭確實移動了(巡航中)', moved(cz1, cz2), `移動前=${JSON.stringify(cz1)} 移動後=${JSON.stringify(cz2)}`);
  ok('E3 放空巡航中 last-view 未被改寫成巡航位置', after === baseline, `巡航前=${baseline} 巡航後=${after}`);
  await ctx.close();
}

// ══════════════ F. 跟車豁免 ══════════════
if (FIX_TRAIN_ACTIVE) {
  const { ctx, page } = await newPage(chromiumB);
  attach(page, 'F');
  await gotoReady(page);
  await page.evaluate(() => map.setView([23.5, 121.0], 8, { animate: false }));
  await page.waitForTimeout(300);
  const baseline = await rawLV(page);

  await page.fill('#trainSearch', String(FIX_TRAIN_ACTIVE.train));
  await page.press('#trainSearch', 'Enter');
  await page.waitForFunction((no) => state.followTrain && String(state.followTrain.train) === String(no), FIX_TRAIN_ACTIVE.train, { timeout: 5000 }).catch(() => {});
  const followed = await page.evaluate(() => state.followTrain ? String(state.followTrain.train) : null);
  const cz1 = await centerOf(page);
  await page.waitForTimeout(5000);
  const cz2 = await centerOf(page);
  const after = await rawLV(page);

  ok('F1 確實進入跟車狀態(跟到指定車次)', followed === String(FIX_TRAIN_ACTIVE.train), `實際=${followed} 期望=${FIX_TRAIN_ACTIVE.train}`);
  ok('F2 跟車中 last-view 未被改寫成列車位置', after === baseline, `跟車前=${baseline} 跟車後=${after}`);
  console.log(`F 補充觀察:跟車期間鏡頭是否移動 = ${moved(cz1, cz2)}(前=${JSON.stringify(cz1)} 後=${JSON.stringify(cz2)},非判準,僅供參考)`);
  await ctx.close();
} else skip('F 跟車豁免', '此刻(抓 fixture 當下)找不到任何行駛中的真實列車可測');

// ══════════════ G. 壞值防呆 ══════════════
const G_CASES = [
  ['G1 不存在的頁籤id', JSON.stringify({ g: 'not-a-real-group-xyz', lat: 25.0, lon: 121.5, z: 12, sel: null })],
  ['G2 非數字座標', JSON.stringify({ g: 'north', lat: 'abc', lon: 'xyz', z: 12, sel: null })],
  ['G3 被截斷的JSON', '{"g":"north","lat":25.0'],
];
for (const [label, seed] of G_CASES) {
  const { ctx, page } = await newPage(chromiumB, { seed });
  const localErrs = attach(page, label);
  let bootOk = true;
  try { await gotoReady(page); } catch (e) { bootOk = false; }
  const group = bootOk ? await page.evaluate(() => state.group).catch(() => null) : null;
  const notBlank = bootOk ? await page.evaluate(() => {
    const sys = document.getElementById('systems');
    const cv = document.getElementById('overlay');
    return !!(sys && sys.children.length > 0 && cv && cv.width > 0 && cv.height > 0 && state.trains && state.trains.length > 0);
  }).catch(() => false) : false;
  await page.waitForTimeout(300); // 讓可能延遲的例外(若有)有機會浮現再收尾
  ok(`${label}: 安全開機不當機`, bootOk, bootOk ? '' : 'waitForFunction(state.ready) 逾時/拋錯');
  ok(`${label}: 安靜退回全台同框(group=all)`, group === 'all', `實際=${group}`);
  ok(`${label}: 畫面非白屏(系統列/畫布/列車資料皆非空)`, notBlank, `實際=${notBlank}`);
  ok(`${label}: 零 console/page error`, localErrs.length === 0, localErrs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ H. 時間軸不被記憶 ══════════════
{
  const { ctx, page } = await newPage(chromiumB);
  attach(page, 'H');
  await gotoReady(page);
  const before = await page.evaluate(() => {
    const real = nowSecOfDay(activeTz());
    const fake = (real + 12 * 3600) % 86400; // 刻意設一個保證遠離現在時刻(12小時外)的假時刻
    setSimSec(fake);
    map.setView([24.0, 121.2], 10, { animate: false }); // 順便觸發一次寫入,檢驗payload不含時間欄位
    return { real, fake, applied: state.simSec };
  });
  await page.waitForTimeout(250);
  const savedRaw = await rawLV(page);
  let savedKeys = [];
  try { savedKeys = Object.keys(JSON.parse(savedRaw) || {}); } catch (e) {}
  ok('H0 記憶payload不含任何時間欄位(只有g/lat/lon/z/sel)', savedKeys.length > 0 && savedKeys.every(k => ['g', 'lat', 'lon', 'z', 'sel'].includes(k)),
    `實際鍵=${JSON.stringify(savedKeys)}`);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const after = await page.evaluate(() => ({ sim: state.simSec, real: nowSecOfDay(activeTz()) }));
  const cdiffNow = Math.min(Math.abs(after.sim - after.real), 86400 - Math.abs(after.sim - after.real));
  const cdiffFake = Math.min(Math.abs(after.sim - before.fake), 86400 - Math.abs(after.sim - before.fake));
  ok('H1 reload後模擬時鐘貼回現在時刻(而非離開時刻)', cdiffNow < 120, `simSec=${after.sim} 現在=${after.real} 差=${cdiffNow}s`);
  ok('H2 reload後模擬時鐘明顯不是離開前刻意設的假時刻(12小時外)', cdiffFake > 3600, `simSec=${after.sim} 假時刻=${before.fake} 差=${cdiffFake}s`);
  await ctx.close();
}

// ══════════════ K. 全程零例外(彙整所有情境) ══════════════
ok('K 全程 pageerror/console.error 為零', allErrors.length === 0, allErrors.slice(0, 8).join(' | '));

server.close();
await chromiumB.close();
await webkitB.close();

const fail = results.filter(r => !r.pass);
console.log(`\n──────── ${results.length - fail.length}/${results.length} PASS ────────`);
if (skips.length) console.log(`SKIP ${skips.length} 項:${skips.map(s => s.name).join('；')}`);
if (fail.length) { console.log('FAIL:', fail.map(f => f.name).join(' ; ')); process.exit(1); }
console.log('全部 PASS');
process.exit(0);
