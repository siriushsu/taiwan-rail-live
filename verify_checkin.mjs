// 車站打卡收集 批次 A1 驗收（設計書 `打卡收集系統設計_2026-07-25.html`）
// 跑法：node verify_checkin.mjs [base]   預設 base=http://127.0.0.1:5178
//
// 判準來源刻意與實作不同源（rules 心得 29：真值不得與實作共用推導假設）：
//   ・章數與次數 → 測試腳本自己從塞進去的 rides 獨立算，不呼叫 stationCollection()
//   ・特等站 → 直接讀 data/tra_station_class.json 的原始「特等」欄位，不讀 state.schedStations.tier
//   ・金框／歪斜 → 讀 computed style（渲染真值），不看 class 宣告
//   ・既有章沒被弄壞 → 基準取「改動前的 HEAD 版本」另存頁面實測（心得 23：不拿改後狀態自比）
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:5178';
const BASELINE = '_baseline_checkin.html';
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const info = (n, msg) => console.log(`  ·    ${n} — ${msg}`);

// ── 獨立真值 1：特等站清單直接來自原始資料檔 ──
const clsRaw = JSON.parse(readFileSync('data/tra_station_class.json', 'utf8'));
const TOP_STATIONS = Object.keys(clsRaw).filter(k => clsRaw[k] === '特等');
const NORMAL_STATIONS = Object.keys(clsRaw).filter(k => clsRaw[k] === '三等');

// ── 獨立真值 2：測試用完乘記錄，與預期由腳本自己算 ──
function makeRides(sys, topName) {
  return [
    { train: 'T1', sys, kind: '自強', from: topName, to: '高雄', km: 350, date: '2026-07-20', dep: 30000, stops: 12 },
    { train: 'T2', sys, kind: '自強', from: topName, to: '瑞芳', km: 30, date: '2026-07-22', dep: 30000, stops: 5 },
    { train: 'T3', sys, kind: '區間', from: '瑞芳', to: '侯硐', km: 8, date: '2026-07-24', dep: 30000, stops: 3 },
  ];
}
// 期望：每筆記錄的 from 與 to 各算一次經過
function expectedCounts(rides) {
  const m = new Map();
  for (const r of rides) for (const nm of [r.from, r.to]) m.set(nm, (m.get(nm) || 0) + 1);
  return m;
}

async function open(browser, { width = 1440, height = 900, path = '/index.html' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await page.goto(BASE + path, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, { timeout: 40000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => { const h = document.getElementById('howtoWrap'); if (h) h.remove(); });
  return { ctx, page };
}

// 塞完乘記錄走正規 API（順便驗這條路徑），並把護照展開
async function seed(page, rides, checkins) {
  return page.evaluate(([rides, checkins]) => {
    localStorage.setItem('trainmap-passport-open', '1');
    if (checkins) localStorage.setItem('trainmap-checkins-v1', JSON.stringify(checkins));
    else localStorage.removeItem('trainmap-checkins-v1');
    userDataSaveCollection('rides', rides);
    renderPassport();
    const el = document.getElementById('passport');
    return { hidden: el.hidden, mode: state.mode };
  }, [rides, checkins || null]);
}
const readStamps = page => page.evaluate(() => [...document.querySelectorAll('#passport .stn-seal')].map(el => {
  const cs = getComputedStyle(el);
  return {
    txt: el.querySelector('b').innerText.replace(/\s+/g, ''),
    small: (el.querySelector('small') || {}).innerText || '',
    cls: el.className,
    border: cs.borderTopColor,
    transform: cs.transform,
    w: Math.round(el.getBoundingClientRect().width),
  };
}));
// 既有章（明星/車種/支線/成就）數量——D 組拿它跟改動前版本比
const legacyCounts = page => page.evaluate(() => ({
  seals: document.querySelectorAll('#passport .seal').length,
  gold: document.querySelectorAll('#passport .seal.gold').length,
  na: document.querySelectorAll('#passport .seal.na').length,
  rows: document.querySelectorAll('#passport .ph-row').length,
}));

const browser = await chromium.launch();
try {
  const { page } = await open(browser);

  // 台鐵系統 id 由頁面提供（只取 key，不取 tier——tier 的正確性交給 C 組的金框驗證）
  const pick = await page.evaluate(tops => {
    const list = (state.schedStations || []);
    const hit = list.find(s => tops.includes(s.name));
    return hit ? { name: hit.name, sys: hit.sys, total: list.length } : null;
  }, TOP_STATIONS);
  if (!pick) { console.log('FAIL  找不到任何特等站於 schedStations，無法續測'); process.exit(1); }
  info('測試基準', `特等站 ${TOP_STATIONS.join('/')}；取用 ${pick.name}(${pick.sys})；schedStations ${pick.total} 座`);

  const rides = makeRides(pick.sys, pick.name);
  const want = expectedCounts(rides);
  const st0 = await seed(page, rides);
  if (st0.hidden) { console.log(`FAIL  護照未顯示（state.mode=${st0.mode}）`); process.exit(1); }

  // ── A 基本渲染 ──
  const stamps = await readStamps(page);
  ok('A1 章數＝獨立算出的去重站數', stamps.length === want.size, `畫面 ${stamps.length} / 期望 ${want.size}`);
  const byName = new Map(stamps.map(s => [s.txt, s]));
  ok('A2 每座站都有章且站名正確', [...want.keys()].every(n => byName.has(n)),
    `缺：${[...want.keys()].filter(n => !byName.has(n)).join('、') || '無'}`);
  const top = byName.get(pick.name);
  ok('A3 重複站標次數且數字正確', !!top && top.small === '×' + want.get(pick.name),
    `${pick.name} 顯示「${top ? top.small : '—'}」/ 期望「×${want.get(pick.name)}」`);
  const once = byName.get('侯硐');
  ok('A4 單次站顯示狀態文字不顯示次數', !!once && once.small === '跟完', `侯硐顯示「${once ? once.small : '—'}」`);
  // 護照預設收合，收合時只剩統計行——車站收集必須在那裡露出，否則等於不存在
  const deskStats = await page.evaluate(() => (document.querySelector('#passport .ph-stats') || {}).innerText || '');
  ok('A5 桌面統計行顯示車站座數（收合時的唯一入口）',
    new RegExp('車站\\s*' + want.size + '\\s*座').test(deskStats.replace(/\s+/g, ' ')), deskStats.replace(/\s+/g, ' '));

  // ── B 三態 ──
  ok('B1 完乘推導的站一律為「跟完」態', stamps.every(s => /\bfollow\b/.test(s.cls)),
    `非 follow：${stamps.filter(s => !/\bfollow\b/.test(s.cls)).map(s => s.txt).join('、') || '無'}`);
  const followBorder = once.border, followTransform = once.transform;

  // 打卡（模擬批次 A2 寫入）後同一站要升級
  await seed(page, rides, { v: 1, st: { [pick.sys + '|瑞芳']: { name: '瑞芳', sys: pick.sys, s: 'visit', n: 3, d: '2026-07-26' } } });
  const stamps2 = await readStamps(page);
  const ruifang = stamps2.find(s => s.txt === '瑞芳');
  ok('B2 打卡後升級為「到訪」態', !!ruifang && /\bvisit\b/.test(ruifang.cls), `class=${ruifang ? ruifang.cls : '—'}`);
  ok('B3 到訪章有歪斜、跟完章沒有（computed transform）',
    !!ruifang && ruifang.transform !== 'none' && followTransform === 'none',
    `visit=${ruifang ? ruifang.transform.slice(0, 28) : '—'} / follow=${followTransform}`);
  ok('B4 次數＝完乘次數＋打卡次數', !!ruifang && ruifang.small === '×' + (want.get('瑞芳') + 3),
    `顯示 ${ruifang ? ruifang.small : '—'} / 期望 ×${want.get('瑞芳') + 3}`);
  ok('B5 到訪章顏色與跟完章不同（渲染真值）', !!ruifang && ruifang.border !== followBorder,
    `visit=${ruifang ? ruifang.border : '—'} vs follow=${followBorder}`);

  // ── C 站等自動升級（L2）──
  // 金＝獎勵不是分類：沒去過的特等站不准亮金，否則會壓過「有沒有去過」的狀態區分
  const topFollow = stamps.find(s => s.txt === pick.name);       // 階段 1：只有完乘推導
  const plainFollow = stamps.find(s => s.txt === '侯硐');
  ok('C1 沒去過的特等站不亮金（與一般跟完章同色）',
    !!topFollow && !!plainFollow && topFollow.border === plainFollow.border,
    `${pick.name}=${topFollow ? topFollow.border : '—'} vs 侯硐=${plainFollow ? plainFollow.border : '—'}`);
  // 階段 3：特等站與一般站都打卡到訪，此時才比站等造成的差異
  await seed(page, rides, { v: 1, st: {
    [pick.sys + '|瑞芳']: { name: '瑞芳', sys: pick.sys, s: 'visit', n: 3, d: '2026-07-26' },
    [pick.sys + '|' + pick.name]: { name: pick.name, sys: pick.sys, s: 'visit', n: 1, d: '2026-07-26' },
  } });
  const stamps3 = await readStamps(page);
  const topVisit = stamps3.find(s => s.txt === pick.name);
  const plainVisit = stamps3.find(s => s.txt === '瑞芳');
  ok('C2 到訪過的特等站帶 t0 升級標記', !!topVisit && /\bt0\b/.test(topVisit.cls) && /\bvisit\b/.test(topVisit.cls),
    `class=${topVisit ? topVisit.cls : '—'}`);
  ok('C3 到訪特等站框色 ≠ 到訪一般站框色（computed，狀態相同只差站等）',
    !!topVisit && !!plainVisit && topVisit.border !== plainVisit.border,
    `${pick.name}=${topVisit ? topVisit.border : '—'} vs 瑞芳=${plainVisit ? plainVisit.border : '—'}`);
  const normalHit = await page.evaluate(names => {
    const list = state.schedStations || [];
    return list.filter(s => names.includes(s.name)).length;
  }, NORMAL_STATIONS.slice(0, 50));
  info('C 參考', `三等站在 schedStations 命中 ${normalHit} 座（僅供對照，不作判準）`);

  // ── D 既有護照沒被弄壞（基準＝改動前的 HEAD）──
  execSync(`git show HEAD:index.html > ${BASELINE}`, { stdio: 'pipe' });
  const { ctx: bctx, page: bpage } = await open(browser, { path: '/' + BASELINE });
  await seed(bpage, rides);
  const before = await legacyCounts(bpage);
  await bctx.close();
  const after = await legacyCounts(page);
  ok('D1 明星／車種／支線／成就章總數不變', before.seals === after.seals, `改動前 ${before.seals} / 現在 ${after.seals}`);
  ok('D2 金章（成就）數不變', before.gold === after.gold, `改動前 ${before.gold} / 現在 ${after.gold}`);
  ok('D3 灰章數不變', before.na === after.na, `改動前 ${before.na} / 現在 ${after.na}`);
  ok('D4 完乘記錄列數不變', before.rows === after.rows, `改動前 ${before.rows} / 現在 ${after.rows}`);

  // ── F 資料隔離：打卡不得污染 userData 四 kind ──
  const iso = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('trainmap-user-data-v1') || '{}');   // 真 key，見 USER_DATA_KEY
    const kinds = raw.collections ? Object.keys(raw.collections) : [];
    return {
      kinds,
      hasCheckinKind: kinds.includes('checkins'),
      ridesLen: userDataLoadCollection('rides').length,
      favStations: JSON.parse(localStorage.getItem('trainmap-fav-stations') || '[]').length, // 收藏車站≠打卡，不得被寫入
      ckLen: Object.keys(JSON.parse(localStorage.getItem('trainmap-checkins-v1') || '{}').st || {}).length,
    };
  });
  // kinds.length===4 一併驗「這次真的讀到了 userData」，避免 key 打錯時 trivially 通過
  ok('F1 打卡自成一個 storage，沒混進 userData 四 kind',
    iso.kinds.length === 4 && !iso.hasCheckinKind && iso.ckLen === 2,
    `kinds=[${iso.kinds.join(',')}] checkins 筆數=${iso.ckLen}`);
  ok('F2 完乘記錄未被打卡污染', iso.ridesLen === rides.length, `rides ${iso.ridesLen} / 期望 ${rides.length}`);
  ok('F3 打卡沒寫進「收藏車站」(stations kind)', iso.favStations === 0, `收藏車站 ${iso.favStations} 筆`);

  // ── E 手機版（專案鐵則：新功能必驗手機）──
  const { ctx: mctx, page: mpage } = await open(browser, { width: 375, height: 780 });
  await seed(mpage, rides, { v: 1, st: { [pick.sys + '|瑞芳']: { name: '瑞芳', sys: pick.sys, s: 'visit', n: 3, d: '2026-07-26' } } });
  const mob = await mpage.evaluate(() => {
    const wrap = document.querySelector('#passport .ph-stamps:last-of-type');
    const seals = [...document.querySelectorAll('#passport .stn-seal')];
    if (!seals.length) return { n: 0 };
    const box = wrap ? wrap.getBoundingClientRect() : null;
    let overflow = 0, clipped = 0;
    for (const s of seals) {
      const r = s.getBoundingClientRect();
      if (r.right > window.innerWidth + 0.5 || r.left < -0.5) overflow++;
      if (s.scrollWidth > s.clientWidth + 1 || s.scrollHeight > s.clientHeight + 1) clipped++;
    }
    return { n: seals.length, overflow, clipped, boxW: box ? Math.round(box.width) : -1, vw: window.innerWidth };
  });
  ok('E1 手機 375 寬：章不超出視窗', mob.n > 0 && mob.overflow === 0, `${mob.overflow} 枚溢出 / 共 ${mob.n} 枚`);
  ok('E2 手機 375 寬：站名沒被裁切', mob.n > 0 && mob.clipped === 0, `${mob.clipped} 枚內容溢出章面`);
  // 手機實際用的是底部護照 sheet(#ridePanel)不是桌面 #passport，兩邊都要接上 builder
  await mpage.evaluate(() => { const b = document.getElementById('tabRide'); if (b) b.click(); });
  await mpage.waitForTimeout(600);
  const sheet = await mpage.evaluate(() => {
    const el = document.getElementById('ridePanel');
    if (!el) return { missing: true };
    const seals = [...el.querySelectorAll('.stn-seal')];
    const vis = seals.filter(s => { const r = s.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    return { hidden: !!el.hidden, n: seals.length, visible: vis.length };
  });
  ok('E3 手機護照 sheet(#ridePanel) 也有站章且真的看得到',
    !sheet.missing && !sheet.hidden && sheet.visible > 0,
    `hidden=${sheet.hidden} 章=${sheet.n} 可見=${sheet.visible}`);
  const mStats = await mpage.evaluate(() => (document.querySelector('#ridePanel .ride-stats') || {}).innerText || '');
  ok('E4 手機統計行含站數且數字正確',
    new RegExp('站\\s*' + want.size + '(\\s|$|·)').test(mStats.replace(/\s+/g, ' ')), mStats.replace(/\s+/g, ' '));
  await mctx.close();

  await page.screenshot({ path: '_shot_checkin_desktop.png', clip: await page.evaluate(() => {
    const r = document.getElementById('passport').getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, 900), height: Math.min(r.height, 900) };
  }) });
} finally {
  try { unlinkSync(BASELINE); } catch (e) {}
  await browser.close();
}
const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
