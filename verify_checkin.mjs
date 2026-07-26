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

  // ── G 單站打卡動作（批次 A2）──
  // 判準與實作不同源：距離由本腳本自己的 haversine 算；通過／退回的案例刻意挑「任何合理半徑下
  // 結論都一樣」的距離（0 公尺必過、5 公里必退），因此不必複製實作的半徑表，也就不會跟著它一起錯。
  const hav = (a, b) => { // 自寫一份，不呼叫頁面的 haversineKm
    const R = 6371008.8, rad = d => d * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  // 站座標從頁面取（那是輸入資料不是待驗對象），再用它組 geomock 走真實使用者路徑
  const target = await page.evaluate(nm => {
    const s = (state.schedStations || []).find(x => x.name === nm);
    return s ? { name: s.name, sys: s.sys, lat: s.lat, lon: s.lon } : null;
  }, pick.name);
  if (!target) { console.log('FAIL  取不到目標站座標，G 組無法進行'); process.exit(1); }

  const gq = `/index.html?geomock=${target.lat},${target.lon}&geoacc=40`;
  const { ctx: gctx, page: gp } = await open(browser, { path: gq });
  await gp.evaluate(() => { localStorage.removeItem('trainmap-checkins-v1'); });
  await gp.evaluate(() => showNearby());
  await gp.waitForSelector('#nearCard .nx-row', { timeout: 15000 });

  const rows = await gp.evaluate(() => [...document.querySelectorAll('#nearCard .nx-row')].map((r, i) => ({
    i, name: r.querySelector('.nx-name').innerText.trim(),
    hasCk: !!r.querySelector('.nx-ck'),
    ckTxt: (r.querySelector('.nx-ck') || {}).innerText || '',
    ckCls: (r.querySelector('.nx-ck') || {}).className || '',
    st: (state._nearList || [])[i] || null,
  })));
  ok('G1 附近車站每一列都有打卡鈕', rows.length > 0 && rows.every(r => r.hasCk),
    `${rows.filter(r => r.hasCk).length}/${rows.length} 列有鈕`);
  const dist0 = rows[0].st ? hav(target, { lat: rows[0].st.lat, lon: rows[0].st.lon }) : -1;
  ok('G2 站上（自算距離 0 公尺）打卡鈕呈可蓋狀態', rows[0].name === target.name && dist0 < 1 && !/\bfar\b/.test(rows[0].ckCls),
    `第一列＝${rows[0].name}、自算距離 ${dist0.toFixed(1)} 公尺、class=${rows[0].ckCls}`);

  await gp.click('#nearCard .nx-row[data-i="0"] .nx-ck');
  await gp.waitForTimeout(300);
  const afterCk = await gp.evaluate(() => ({
    store: JSON.parse(localStorage.getItem('trainmap-checkins-v1') || '{}'),
    btn: (document.querySelector('#nearCard .nx-row[data-i="0"] .nx-ck') || {}).innerText || '',
    disabled: !!(document.querySelector('#nearCard .nx-row[data-i="0"] .nx-ck') || {}).disabled,
  }));
  const keys = Object.keys(afterCk.store.st || {});
  const entry = afterCk.store.st[keys[0]];
  ok('G3 打卡寫入 checkins：一筆、到訪態、次數 1', keys.length === 1 && entry && entry.s === 'visit' && entry.n === 1,
    `key=${keys[0]} ${JSON.stringify(entry)}`);
  ok('G4 打卡後鈕變成「今天已蓋」且不可再按', /已蓋/.test(afterCk.btn) && afterCk.disabled,
    `鈕文字「${afterCk.btn.trim()}」disabled=${afterCk.disabled}`);

  // 同日再按一次：次數不得增加（防站在月台狂按刷數字）
  await gp.evaluate(() => { const b = document.querySelector('#nearCard .nx-row[data-i="0"] .nx-ck'); if (b) { b.disabled = false; b.click(); } });
  await gp.waitForTimeout(200);
  const sameDay = await gp.evaluate(() => Object.values(JSON.parse(localStorage.getItem('trainmap-checkins-v1')).st)[0].n);
  ok('G5 同一天重複打卡不加次數', sameDay === 1, `次數 ${sameDay}`);

  // 把日期改成昨天 → 隔日應可再蓋，次數 +1
  await gp.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('trainmap-checkins-v1'));
    const k = Object.keys(c.st)[0];
    c.st[k].d = '2000-01-01';
    localStorage.setItem('trainmap-checkins-v1', JSON.stringify(c));
    renderNearbyStations();
  });
  await gp.click('#nearCard .nx-row[data-i="0"] .nx-ck');
  await gp.waitForTimeout(200);
  const nextDay = await gp.evaluate(() => Object.values(JSON.parse(localStorage.getItem('trainmap-checkins-v1')).st)[0].n);
  ok('G6 換一天可以再蓋，次數累加', nextDay === 2, `次數 ${nextDay}`);

  // 距離判定：把位置搬到 5 公里外（任何合理半徑都該退回），且不得寫入
  const far = { lat: target.lat + 0.045, lon: target.lon }; // 約 5 公里
  const farM = hav(target, far);
  const farRes = await gp.evaluate(([lat, lon]) => {
    const before = JSON.stringify(localStorage.getItem('trainmap-checkins-v1'));
    openNearbyStations(lat, lon, 30);
    const st = (state._nearList || [])[0];
    const wrote = doCheckin(st);
    return { wrote, changed: JSON.stringify(localStorage.getItem('trainmap-checkins-v1')) !== before, name: st && st.name,
      cls: (document.querySelector('#nearCard .nx-row[data-i="0"] .nx-ck') || {}).className || '',
      toast: (document.querySelector('.toast, #toast') || {}).innerText || '' };
  }, [far.lat, far.lon]);
  ok(`G7 自算 ${(farM / 1000).toFixed(1)} 公里外打卡被退回且未寫入`, farRes.wrote === false && farRes.changed === false,
    `wrote=${farRes.wrote} storage 變動=${farRes.changed}`);
  ok('G8 走不到的站鈕淡化但仍列出（不警告不封鎖）', /\bfar\b/.test(farRes.cls) && !!farRes.name,
    `${farRes.name} class=${farRes.cls}`);

  // 精度補償要有封頂：acc 給 100 公里，2 公里外仍須退回（否則精度一爛就能無限遠打卡）。
  // ⚠一定要指名同一座站——_nearList[0] 會隨位置改變，拿它測等於換了目標，結論無效。
  const capPos = { lat: target.lat + 0.018, lon: target.lon }; // 約 2 公里
  const capM = hav(target, capPos);
  const cap = await gp.evaluate(([lat, lon, t]) => {
    openNearbyStations(lat, lon, 100000);
    return { wrote: doCheckin(t), acc: state.meLoc.acc };
  }, [capPos.lat, capPos.lon, target]);
  ok(`G9 精度補償有封頂：精度 100 公里也不能在自算 ${Math.round(capM)} 公尺外打卡`,
    cap.wrote === false && capM > 1500, `wrote=${cap.wrote} acc=${cap.acc} 距離=${Math.round(capM)}m`);

  // 低精度仍給章，但要留下低信心標記（供批次 C 的眾包校正排除）
  const lowAcc = await gp.evaluate(([lat, lon]) => {
    localStorage.removeItem('trainmap-checkins-v1');
    openNearbyStations(lat, lon, 450);
    const st = (state._nearList || [])[0];
    const wrote = doCheckin(st);
    const e = Object.values(JSON.parse(localStorage.getItem('trainmap-checkins-v1') || '{"st":{}}').st)[0];
    return { wrote, lo: e && e.lo, s: e && e.s };
  }, [target.lat, target.lon]);
  ok('G10 低精度定位章照給，但標記低信心', lowAcc.wrote === true && lowAcc.lo === 1 && lowAcc.s === 'visit',
    `wrote=${lowAcc.wrote} lo=${lowAcc.lo} s=${lowAcc.s}`);

  // 半徑須隨站等單調（大站放寬）——只驗方向不驗數值，避免複製實作的表
  const mono = await gp.evaluate(nm => {
    const big = (state.schedStations || []).find(s => s.name === nm);
    const small = (state.schedStations || []).find(s => s.tier === 4);
    if (!big || !small) return null;
    return { big: checkinRadiusFor(big), small: checkinRadiusFor(small), bigName: big.name, smallName: small.name };
  }, pick.name);
  ok('G11 打卡半徑隨站等放寬（特等站 > 一般站）', !!mono && mono.big > mono.small,
    mono ? `${mono.bigName} ${mono.big}m > ${mono.smallName} ${mono.small}m` : '取不到對照站');

  // 捷運站鍵正規化：同一站不論從 freq 或 deco 視角打卡，都只能有一枚章
  const norm = await gp.evaluate(() => {
    localStorage.removeItem('trainmap-checkins-v1');
    const a = { name: '測試站', lat: 25, lon: 121.5, sys: 'freq' };
    const b = { name: '測試站', lat: 25, lon: 121.5, sys: 'deco' };
    state.meLoc = { lat: 25, lon: 121.5, acc: 20 };
    doCheckin(a);
    const c1 = JSON.parse(localStorage.getItem('trainmap-checkins-v1'));
    const k = Object.keys(c1.st)[0];
    c1.st[k].d = '2000-01-01'; localStorage.setItem('trainmap-checkins-v1', JSON.stringify(c1)); // 繞過同日限制
    doCheckin(b);
    const c2 = JSON.parse(localStorage.getItem('trainmap-checkins-v1'));
    return { keys: Object.keys(c2.st), n: Object.values(c2.st)[0].n };
  });
  ok('G12 捷運站 freq／deco 兩視角打卡合成同一枚章', norm.keys.length === 1 && norm.keys[0] === 'metro|測試站' && norm.n === 2,
    `keys=[${norm.keys.join(',')}] 次數=${norm.n}`);

  // 別名站不得重複計數。判準是外部事實（這三對經座標與站名逐對查證過是同一座實體車站，
  // 新左營在 1.5 公里外是真的另一座站），不是頁面自己的分群結果。
  const aliasRes = await gp.evaluate(pairs => {
    const out = [];
    for (const [alt, canon] of pairs) {
      localStorage.removeItem('trainmap-checkins-v1');
      const list = state.schedStations || [];
      const a = list.find(s => s.name === alt), c = list.find(s => s.name === canon);
      if (!a || !c) { out.push({ alt, canon, missing: true }); continue; }
      state.meLoc = { lat: a.lat, lon: a.lon, acc: 20 };
      doCheckin(a);
      const c1 = JSON.parse(localStorage.getItem('trainmap-checkins-v1'));
      const k = Object.keys(c1.st)[0]; c1.st[k].d = '2000-01-01';
      localStorage.setItem('trainmap-checkins-v1', JSON.stringify(c1)); // 繞過同日限制，才測得到「第二次」
      state.meLoc = { lat: c.lat, lon: c.lon, acc: 20 };
      doCheckin(c);
      const c2 = JSON.parse(localStorage.getItem('trainmap-checkins-v1'));
      const e = Object.values(c2.st)[0];
      out.push({ alt, canon, keys: Object.keys(c2.st).length, name: e.name, n: e.n });
    }
    return out;
  }, [['臺北-環島', '臺北'], ['左營', '左營(舊城)'], ['新城', '新城 (太魯閣)']]);
  const aliasBad = aliasRes.filter(r => r.missing || r.keys !== 1 || r.n !== 2 || r.name !== r.canon);
  ok('G18 同一實體站的別名合成一枚章（不因換個名字多收一座）', aliasBad.length === 0,
    aliasRes.map(r => `${r.alt}+${r.canon}→${r.missing ? '缺站' : r.keys + '枚/' + r.name + '×' + r.n}`).join('；'));
  const aliasCnt = await gp.evaluate(() => {
    localStorage.removeItem('trainmap-checkins-v1');
    userDataSaveCollection('rides', [{ train: 'X', sys: 'tra_sched', kind: '自強', from: '臺北', to: '臺北-環島', km: 1, date: '2026-07-20', dep: 1, stops: 2 }]);
    renderPassport();
    return [...document.querySelectorAll('#passport .stn-seal b')].map(b => b.innerText.replace(/\s+/g, ''));
  });
  ok('G19 完乘記錄的別名站也只算一座', aliasCnt.length === 1, `章＝[${aliasCnt.join(',')}]`);

  // 打卡完護照要當場更新（不必重整）
  const live = await gp.evaluate(() => {
    localStorage.removeItem('trainmap-checkins-v1');
    localStorage.setItem('trainmap-passport-open', '1');
    userDataSaveCollection('rides', []);
    renderPassport();
    const before = document.querySelectorAll('#passport .stn-seal').length;
    state.meLoc = { lat: 25, lon: 121.5, acc: 20 };
    doCheckin({ name: '即時站', lat: 25, lon: 121.5, sys: 'tra_sched' });
    const seals = [...document.querySelectorAll('#passport .stn-seal')];
    return { before, after: seals.length, txt: seals.map(s => s.querySelector('b').innerText).join('|') };
  });
  ok('G13 打卡後護照當場長出新章（無需重整）', live.before === 0 && live.after === 1 && /即時/.test(live.txt),
    `蓋章前 ${live.before} 枚 → 蓋章後 ${live.after} 枚（${live.txt}）`);

  // 整列點擊仍要開看板：打卡鈕不能吃掉原本的互動
  const rowClick = await gp.evaluate(([lat, lon]) => {
    openNearbyStations(lat, lon, 30);
    document.querySelector('#nearCard .nx-row[data-i="0"] .nx-name').click();
    const b = document.getElementById('board');
    return { boardOpen: !!b && !b.hidden, nearOpen: !document.getElementById('nearCard').hidden };
  }, [target.lat, target.lon]);
  ok('G14 點列名仍開看板（打卡鈕沒吃掉整列點擊）', rowClick.boardOpen === true, `board 開=${rowClick.boardOpen}`);
  await gctx.close();

  // 手機（專案鐵則：新功能必驗手機）——打卡鈕的觸控大小與不溢出
  const { ctx: gmctx, page: gmp } = await open(browser, { width: 375, height: 780, path: gq });
  await gmp.evaluate(() => { localStorage.removeItem('trainmap-checkins-v1'); showNearby(); });
  await gmp.waitForSelector('#nearCard .nx-ck', { timeout: 15000 });
  await gmp.waitForTimeout(400);
  const gmob = await gmp.evaluate(() => {
    const btns = [...document.querySelectorAll('#nearCard .nx-ck')];
    let overflow = 0, tooSmall = 0, covered = 0, minH = 999;
    const blockers = [];
    for (const b of btns) {
      let r = b.getBoundingClientRect();
      minH = Math.min(minH, r.height);
      if (r.right > window.innerWidth + 0.5 || r.left < -0.5) overflow++;
      if (r.height < 28 || r.width < 44) tooSmall++;
      // 命中測試前先捲進視野：卡片本身是可捲容器，「在摺線下」不等於「點不到」（心得 19）
      b.scrollIntoView({ block: 'center' });
      r = b.getBoundingClientRect();
      // 像素級命中測試（心得 24：computed style 不算數）——鈕中心真的點得到自己
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (!hit || !hit.closest('.nx-ck')) {
        covered++;
        blockers.push(hit ? (hit.tagName + '.' + (hit.className || '').toString().split(' ')[0]) : 'null(視窗外)');
      }
    }
    return { n: btns.length, overflow, tooSmall, covered, minH: Math.round(minH), vw: innerWidth, blockers };
  });
  ok('G15 手機 375：打卡鈕不超出視窗', gmob.n > 0 && gmob.overflow === 0, `${gmob.overflow}/${gmob.n} 溢出`);
  ok('G16 手機 375：打卡鈕觸控尺寸足夠（高≥28、寬≥44）', gmob.n > 0 && gmob.tooSmall === 0, `不足 ${gmob.tooSmall} 顆、最矮 ${gmob.minH}px`);
  ok('G17 手機 375：捲到後打卡鈕中心真的點得到（elementFromPoint 命中自己）', gmob.n > 0 && gmob.covered === 0,
    `被遮 ${gmob.covered}/${gmob.n} 顆${gmob.blockers.length ? '：' + gmob.blockers.join('、') : ''}`);
  await gmp.screenshot({ path: '_shot_checkin_nearby_mobile.png', clip: await gmp.evaluate(() => {
    const r = document.getElementById('nearCard').getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, 375), height: Math.min(r.height, 500) };
  }) });
  await gmctx.close();

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
