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
import { createHash } from 'node:crypto';

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

async function open(browser, { width = 1440, height = 900, path = '/index.html', touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch });
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

// ── G0 自檢：先確認「我到底在驗哪一份檔案」──────────────────────────────
// rules 心得 32：驗收腳本吃「驗哪個目錄」的參數時，第一道 gate 就要印出目標並斷言它
// 等於腳本自己所在的那棵樹，否則全綠可能是驗了別人的樹。2026-07-26 另一 session 實際
// 踩到：在主 repo 跑本腳本，但 :5178 上的 server 服務的是這個 worktree，A/B/C 全 ok
// 卻驗的是別人的 index.html。斷言逐 byte 相同，不符直接中止——不要讓它「大致上對」就過。
{
  const diskMd5 = createHash('md5').update(readFileSync('index.html')).digest('hex');
  let servedMd5 = '(抓不到)';
  try {
    const buf = Buffer.from(await (await fetch(BASE + '/index.html')).arrayBuffer());
    servedMd5 = createHash('md5').update(buf).digest('hex');
  } catch (e) { servedMd5 = '(fetch 失敗: ' + e.message + ')'; }
  const same = diskMd5 === servedMd5;
  ok('G0 驗的是本腳本所在的那棵樹（server 回的 index.html 與磁碟逐 byte 相同）', same,
    `BASE=${BASE}　cwd=${process.cwd()}　磁碟 ${diskMd5.slice(0, 8)}　server ${servedMd5.slice(0, 8)}`);
  if (!same) {
    console.log('\n中止：server 服務的不是這份 index.html。帶對 port 再跑，例如 node verify_checkin.mjs http://127.0.0.1:<你的port>');
    process.exit(1);
  }
}

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

  // ── D 既有護照沒被弄壞（基準＝本功能開工前那一版）──
  // ⚠基準絕不能用 HEAD：每 commit 一次 HEAD 就前進，基準會把自己的改動一起吃進去，
  // 隔一個 commit 再跑就變成「40 vs 40、差 0」的假通過／假失敗。釘在分支點（本功能的第一個
  // commit 的父）才穩定；merge-base 取不到（基底分支被刪）就退回當時記下的 SHA。
  const BASE_FALLBACK = '1bfac956021006760f78234c0468138d30b2debe'; // = 45a5bd7^，打卡功能的第一個 commit 之前
  let baseRef = BASE_FALLBACK;
  try { baseRef = execSync('git merge-base HEAD feat/boot-geolocation', { encoding: 'utf8' }).trim() || BASE_FALLBACK; }
  catch (e) { baseRef = BASE_FALLBACK; }
  info('D 基準', `${baseRef.slice(0, 7)}（打卡功能開工前）`);
  execSync(`git show ${baseRef}:index.html > ${BASELINE}`, { stdio: 'pipe' });
  const { ctx: bctx, page: bpage } = await open(browser, { path: '/' + BASELINE });
  await seed(bpage, rides);
  const before = await legacyCounts(bpage);
  await bctx.close();
  const after = await legacyCounts(page);
  // 批次 B 蓄意新增 4 枚成就（車站巡禮／百站達成／通勤的證明／老通勤族），所以總數與灰章各 +4；
  // 這裡驗的是「既有的一枚都沒少、也沒多冒出別的」，不是絕對數字不變。
  const NEW_ACH = 4;
  ok(`D1 既有章一枚沒少，只多了 ${NEW_ACH} 枚新成就`, after.seals - before.seals === NEW_ACH,
    `改動前 ${before.seals} / 現在 ${after.seals}（差 ${after.seals - before.seals}）`);
  ok('D2 金章（已解鎖成就）數不變——新成就此時都還沒達成', before.gold === after.gold, `改動前 ${before.gold} / 現在 ${after.gold}`);
  ok(`D3 灰章（未解鎖）恰好多 ${NEW_ACH} 枚`, after.na - before.na === NEW_ACH, `改動前 ${before.na} / 現在 ${after.na}`);
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

  // ── H 搭乘模式（批次 B・兩點法）──
  // 搭乘模式刻意讀真實時鐘，測試無法等時間流逝，故用「把誤點值設成負數」把表定時間軸往前推
  // （那是 ridingNowSched 的輸入，不是被測邏輯本身）。哪幾站該被蓋，一律由本腳本從 stops 的
  // 到站秒數自己算，不呼叫 ridingArrivedIdx —— 判準與實作不同源（心得 29）。
  const { ctx: hctx, page: hp } = await open(browser);
  const trip = await hp.evaluate(() => {
    window.liveDelaySec = () => 0; // 誤點歸零，讓表定時間軸＝真實時鐘，測試好算
    const now = nowSecOfDay(activeTz());
    const t = (state.trains || []).find(x => !x.loop && x.stops && x.stops.length >= 6 &&
      x.stops[0].arrSec <= now - 120 && x.stops[x.stops.length - 1].arrSec >= now + 600);
    if (!t) return null;
    return { train: String(t.train), sys: t.sys, now,
      stops: t.stops.map(s => ({ name: s.name, arrSec: s.arrSec, depSec: s.depSec })) };
  });
  if (!trip) { console.log('FAIL  現在沒有正在行駛的班次可供 H 組測試（清晨/深夜跑會這樣）'); process.exit(1); }
  // 獨立算：上車站＝表定已抵達的最後一站
  const arrivedIdxAt = t => { let k = -1; trip.stops.forEach((s, i) => { if (s.arrSec <= t) k = i; }); return k; };
  const expectFrom = Math.max(0, arrivedIdxAt(trip.now));
  const expectTo = Math.min(expectFrom + 3, trip.stops.length - 1);
  info('H 基準', `${trip.train} 次（${trip.sys}）現在在第 ${expectFrom} 站「${trip.stops[expectFrom].name}」；` +
    `本測試搭到第 ${expectTo} 站「${trip.stops[expectTo].name}」`);

  const started = await hp.evaluate(([train, sys, toIdx]) => {
    localStorage.removeItem('trainmap-checkins-v1');
    localStorage.removeItem('trainmap-riding-v1');
    userDataSaveCollection('rides', []);
    const tr = state.trains.find(x => String(x.train) === train && x.sys === sys);
    state.followTrain = tr;
    const st = tr.stops[0];
    state.meLoc = null; // 先測「沒定位也能上車」
    const okStart = startRiding(tr, toIdx);
    const r = JSON.parse(localStorage.getItem('trainmap-riding-v1') || 'null');
    const ck = JSON.parse(localStorage.getItem('trainmap-checkins-v1') || '{"st":{}}').st;
    return { okStart, r, ckKeys: Object.keys(ck), ck };
  }, [trip.train, trip.sys, expectTo]);
  ok('H1 上車成功並存下搭乘狀態', started.okStart === true && !!started.r && started.r.train === trip.train,
    JSON.stringify(started.r));
  ok('H2 上車站＝獨立算出的「表定已抵達的最後一站」', !!started.r && started.r.fromIdx === expectFrom && started.r.fromName === trip.stops[expectFrom].name,
    `程式 ${started.r ? started.r.fromIdx + '/' + started.r.fromName : '—'}　獨立算 ${expectFrom}/${trip.stops[expectFrom].name}`);
  ok('H3 沒定位也能上車，上車站先記「搭過」不是「到訪」',
    started.ckKeys.length === 1 && started.ck[started.ckKeys[0]].s === 'pass',
    `${started.ckKeys[0]}＝${JSON.stringify(started.ck[started.ckKeys[0]])}`);

  // 拖時刻尺／快轉都不該影響搭乘收集（那是動畫的時間，不是你人在的時間）
  const scrub = await hp.evaluate(() => {
    const before = Object.keys(JSON.parse(localStorage.getItem('trainmap-checkins-v1')).st).length;
    setSimSec((nowSecOfDay(activeTz()) + 7200) % 86400); // 把動畫時鐘往前拖 2 小時
    ridingTick(); ridingTick();
    return { before, after: Object.keys(JSON.parse(localStorage.getItem('trainmap-checkins-v1')).st).length };
  });
  ok('H4 拖時刻尺／快轉不會多蓋章（搭乘模式只認真實時鐘）', scrub.before === scrub.after,
    `拖動前 ${scrub.before} 枚 → 拖動後 ${scrub.after} 枚`);

  // 把表定時間軸推進到「剛好過了下一站」——只該多蓋一站
  const oneMore = expectFrom + 1;
  const jump1 = trip.stops[oneMore].arrSec - trip.now + 5;
  const step1 = await hp.evaluate(j => {
    window.liveDelaySec = () => -j; // schedNow = 真實時鐘 + j
    ridingTick();
    const ck = JSON.parse(localStorage.getItem('trainmap-checkins-v1')).st;
    const r = JSON.parse(localStorage.getItem('trainmap-riding-v1') || 'null');
    return { names: Object.values(ck).map(e => e.name), atIdx: r && r.atIdx, passes: Object.values(ck).filter(e => e.s === 'pass').length };
  }, jump1);
  ok('H5 車過一站就即時蓋一站（不必等下車）',
    step1.names.length === 2 && step1.names.includes(trip.stops[oneMore].name) && step1.atIdx === oneMore,
    `已蓋 [${step1.names.join('、')}] atIdx=${step1.atIdx} / 期望多出「${trip.stops[oneMore].name}」`);

  // 一路推到終點之後：只能蓋到選定的下車站，不准超收
  const jump2 = trip.stops[trip.stops.length - 1].arrSec - trip.now + 600;
  const step2 = await hp.evaluate(j => {
    window.liveDelaySec = () => -j;
    ridingTick();
    const ck = JSON.parse(localStorage.getItem('trainmap-checkins-v1')).st;
    return { names: Object.values(ck).map(e => e.name), riding: localStorage.getItem('trainmap-riding-v1'),
      counts: Object.values(ck).map(e => e.name + '×' + e.n) };
  }, jump2);
  const wantNames = trip.stops.slice(expectFrom, expectTo + 1).map(s => s.name);
  const gotSorted = [...step2.names].sort(), wantSorted = [...new Set(wantNames)].sort();
  ok('H6 只蓋到選定的下車站為止，沒有一路超收到終點',
    JSON.stringify(gotSorted) === JSON.stringify(wantSorted),
    `蓋了 [${step2.names.join('、')}]　應為 [${wantNames.join('、')}]`);
  ok('H7 抵達下車站後自動結束搭乘', step2.riding === null, `riding=${step2.riding}`);
  ok('H8 每站各記一次，下車站沒被重複計數', step2.counts.every(c => /×1$/.test(c)), step2.counts.join('、'));

  // 提前下車：只收到當下這站，後面的站不算
  const early = await hp.evaluate(([train, sys, toIdx, j1]) => {
    localStorage.removeItem('trainmap-checkins-v1');
    localStorage.removeItem('trainmap-riding-v1');
    window.liveDelaySec = () => 0;
    const tr = state.trains.find(x => String(x.train) === train && x.sys === sys);
    state.followTrain = tr;
    startRiding(tr, toIdx);
    window.liveDelaySec = () => -j1; // 只前進到下一站
    endRidingNow();
    const ck = JSON.parse(localStorage.getItem('trainmap-checkins-v1')).st;
    return { names: Object.values(ck).map(e => e.name), riding: localStorage.getItem('trainmap-riding-v1') };
  }, [trip.train, trip.sys, expectTo, jump1]);
  ok('H9 提前下車只收到當下這站，後面的站不算',
    early.names.length === 2 && early.riding === null,
    `蓋了 [${early.names.join('、')}]（訂到第 ${expectTo} 站但在第 ${oneMore} 站就下車）`);

  // 不得同時搭兩班車；跨日殘留要清掉
  const guard = await hp.evaluate(([train, sys, toIdx]) => {
    localStorage.removeItem('trainmap-checkins-v1');
    localStorage.removeItem('trainmap-riding-v1');
    window.liveDelaySec = () => 0;
    const tr = state.trains.find(x => String(x.train) === train && x.sys === sys);
    startRiding(tr, toIdx);
    const second = startRiding(tr, toIdx); // 已在搭乘中，應被擋
    const r = JSON.parse(localStorage.getItem('trainmap-riding-v1'));
    r.date = '2000-01-01'; localStorage.setItem('trainmap-riding-v1', JSON.stringify(r)); // 假裝是昨天忘了下車
    ridingTick();
    return { second, afterStale: localStorage.getItem('trainmap-riding-v1') };
  }, [trip.train, trip.sys, expectTo]);
  ok('H10 搭乘中不能再上另一班車', guard.second === false, `第二次上車回傳 ${guard.second}`);
  ok('H11 跨日殘留的搭乘紀錄會被清掉（不會隔天繼續亂蓋）', guard.afterStale === null, `殘留=${guard.afterStale}`);

  // GPS 在上車站 → 升級成「到訪」
  const withGps = await hp.evaluate(([train, sys, toIdx, fromIdx]) => {
    localStorage.removeItem('trainmap-checkins-v1');
    localStorage.removeItem('trainmap-riding-v1');
    window.liveDelaySec = () => 0;
    const tr = state.trains.find(x => String(x.train) === train && x.sys === sys);
    const s = tr.stops[fromIdx];
    state.meLoc = { lat: s.lat, lon: s.lon, acc: 25 };
    startRiding(tr, toIdx);
    const ck = JSON.parse(localStorage.getItem('trainmap-checkins-v1')).st;
    return Object.values(ck).map(e => e.name + ':' + e.s);
  }, [trip.train, trip.sys, expectTo, expectFrom]);
  ok('H12 人真的在上車站（GPS 驗到）→ 上車站記「到訪」', withGps.length === 1 && /:visit$/.test(withGps[0]), withGps.join('、'));

  // 票券鈕三態
  const btn = await hp.evaluate(([train, sys]) => {
    const tr = state.trains.find(x => String(x.train) === train && x.sys === sys);
    state.followTrain = tr; state.mode = 'sched';
    updateRideBtn(tr);
    const b = document.getElementById('fpRide');
    const riding = { txt: b.textContent, cls: b.className, hidden: b.hidden };
    localStorage.removeItem('trainmap-riding-v1');
    updateRideBtn(tr);
    const idle = { txt: b.textContent, cls: b.className, hidden: b.hidden };
    localStorage.setItem('trainmap-riding-v1', JSON.stringify({ sys, train: '9999', date: todayStr(activeTz()), fromIdx: 0, toIdx: 1, atIdx: 0, toName: 'X' }));
    updateRideBtn(tr);
    const other = { txt: b.textContent, cls: b.className };
    localStorage.removeItem('trainmap-riding-v1');
    return { riding, idle, other };
  }, [trip.train, trip.sys]);
  ok('H13 票券鈕三態正確（未上車／搭這班／搭別班）',
    /我下車了/.test(btn.riding.txt) && /\bon\b/.test(btn.riding.cls) &&
    /我上車了/.test(btn.idle.txt) && !/\bon\b|\bbusy\b/.test(btn.idle.cls) &&
    /搭乘中/.test(btn.other.txt) && /\bbusy\b/.test(btn.other.cls),
    `搭這班「${btn.riding.txt}」／未上車「${btn.idle.txt}」／搭別班「${btn.other.txt}」`);

  // ── I 路段收集與里程碑成就（三軸的「線」＋使用者指名的 100／500 次成就）──
  // 判準獨立：該有幾段、鍵長什麼樣，都由本腳本從 stops 名單自己算。
  const segRes = await hp.evaluate(([train, sys, toIdx, jumpAll]) => {
    localStorage.removeItem('trainmap-checkins-v1');
    localStorage.removeItem('trainmap-riding-v1');
    userDataSaveCollection('rides', []);
    window.liveDelaySec = () => 0;
    const tr = state.trains.find(x => String(x.train) === train && x.sys === sys);
    startRiding(tr, toIdx);
    window.liveDelaySec = () => -jumpAll;
    ridingTick();
    const c = JSON.parse(localStorage.getItem('trainmap-checkins-v1'));
    return { sg: c.sg || {}, stN: Object.keys(c.st).length };
  }, [trip.train, trip.sys, expectTo, trip.stops[trip.stops.length - 1].arrSec - trip.now + 600]);
  // 獨立算應該記到哪些最細區間：直接讀該線自己的站列（ln.stations，依 d 排序的相鄰兩站），
  // 取「中點落在本趟停靠區間 [dA,dB] 內」者——與實作同一份原始資料，但這裡是自己重算一遍，
  // 不呼叫 lineNetwork()/writeSegments()。
  const wantSeg = await hp.evaluate(([train, sys, fromIdx, toIdx]) => {
    const tr = state.trains.find(x => String(x.train) === train && x.sys === sys);
    const out = [];
    for (let i = fromIdx; i < toIdx; i++) {
      const sg = tr.stops[i];
      if (!sg.segLn) continue;
      const sts = (sg.segLn.stations || []).filter(s => s.d != null && s.name).slice().sort((a, b) => a.d - b.d);
      const lo = Math.min(sg.dA, sg.dB), hi = Math.max(sg.dA, sg.dB);
      for (let j = 1; j < sts.length; j++) {
        const a = sts[j - 1], b = sts[j], km = Math.abs(b.d - a.d);
        if (a.name === b.name || km < 0.05) continue;
        const mid = (a.d + b.d) / 2;
        if (mid >= lo && mid <= hi) out.push(sg.segLn.sys + '|' + sg.segLn.id + '|' + (a.name < b.name ? a.name + '|' + b.name : b.name + '|' + a.name));
      }
    }
    return out;
  }, [trip.train, trip.sys, expectFrom, expectTo]);
  const gotSegs = Object.keys(segRes.sg).sort();
  ok('I1 搭一趟就記下沿途每一段路（區間清單＝獨立重算出的）',
    JSON.stringify(gotSegs) === JSON.stringify([...new Set(wantSeg)].sort()) && gotSegs.length > 0,
    `記到 ${gotSegs.length} 段　獨立算 ${new Set(wantSeg).size} 段`);
  // sg 值形狀是 {n,nv}（Task 1，規格 §6）：這裡讀的是 writeSegments 寫入的原始 storage，
  // 不是 segmentCollection()，所以要自己拆 .n；不拆＝拿物件跟數字比一定 false。
  ok('I2 每段各記一次', Object.values(segRes.sg).every(v => (v && typeof v === 'object' ? v.n : v) === 1), JSON.stringify(segRes.sg).slice(0, 100));
  // 快車跳過的站也要算走過：記到的區間數應 ≥ 停靠區間數（一段停靠可跨好幾個實體區間）
  ok('I3 快車跳站的區間照樣算走過（記到的實體區間數 ≥ 停靠區間數）',
    gotSegs.length >= (expectTo - expectFrom),
    `實體區間 ${gotSegs.length} 段　停靠區間 ${expectTo - expectFrom} 段`);

  // 來回同一段路要累加到同一個鍵（不分方向）——通勤族的次數不能被方向腰斬
  const bidir = await hp.evaluate(([train, sys, fromIdx, toIdx]) => {
    const c = JSON.parse(localStorage.getItem('trainmap-checkins-v1'));
    const before = Object.keys(c.sg).length;
    const k0 = Object.keys(c.sg)[0];
    const tr = state.trains.find(x => String(x.train) === train && x.sys === sys);
    // 造一班「同樣的段但方向相反」的假車：把 dA/dB 對調
    const rev = { sys, stops: [] };
    for (let i = fromIdx; i < toIdx; i++) {
      const s = tr.stops[i];
      rev.stops.push(s.segLn ? { name: s.name, segLn: s.segLn, dA: s.dB, dB: s.dA } : { name: s.name });
    }
    rev.stops.push({ name: 'END' });
    writeSegments(rev, 0, rev.stops.length - 1);
    const c2 = JSON.parse(localStorage.getItem('trainmap-checkins-v1'));
    const v = c2.sg[k0]; // 同上：原始 storage 是 {n,nv}，拆 .n 才是次數
    return { before, after: Object.keys(c2.sg).length, n: (v && typeof v === 'object') ? v.n : v };
  }, [trip.train, trip.sys, expectFrom, expectTo]);
  ok('I4 反方向搭同一段路併入同一筆（不分方向）',
    bidir.after === bidir.before && bidir.n === 2, `段數 ${bidir.before}→${bidir.after}，該段次數 ${bidir.n}`);

  // 完乘率：分母＝每條線自己的最細區間數（使用者 07-26 拍板「每條線分開算」）
  const comp = await hp.evaluate(() => {
    const lines = lineCompletion();
    const net = lineNetwork();
    return {
      lines: lines.map(l => ({ id: l.id, ridN: l.ridN, nSeg: l.nSeg, pct: +(l.pct * 100).toFixed(1) })),
      // 隨便挑一條線塞滿它全部區間，驗 100% 到得了
      fullTest: (() => {
        const rec = [...net.values()][0];
        const sg = {};
        for (const s of rec.segs) sg[s.key] = 1;
        localStorage.setItem('trainmap-checkins-v1', JSON.stringify({ v: 1, st: {}, sg }));
        const got = lineCompletion().find(l => l.id === rec.id);
        return { id: rec.id, pct: got ? +(got.pct * 100).toFixed(2) : -1, ridN: got ? got.ridN : -1, nSeg: rec.segs.length };
      })(),
    };
  });
  ok('I5 完乘率每條線各自算，且只列走過的線', comp.lines.length > 0 && comp.lines.every(l => l.ridN <= l.nSeg && l.pct > 0),
    comp.lines.map(l => `${l.id} ${l.ridN}/${l.nSeg}=${l.pct}%`).join('、').slice(0, 130));
  ok('I6 把一條線的區間全數走完＝100%（分子分母同一鍵空間，湊得滿）',
    comp.fullTest.pct === 100 && comp.fullTest.ridN === comp.fullTest.nSeg,
    `${comp.fullTest.id} ${comp.fullTest.ridN}/${comp.fullTest.nSeg}=${comp.fullTest.pct}%`);

  // 成就門檻：以獨立塞入的計數驗，不看實作怎麼算
  const achRes = await hp.evaluate(() => {
    const mk = (stnN, segN) => {
      const st = {}, sg = {};
      for (let i = 0; i < stnN; i++) st['tra_sched|測試站' + i] = { name: '測試站' + i, sys: 'tra_sched', s: 'pass', n: 1, d: '2026-07-26' };
      if (segN) sg['tra_sched|縱貫線北段|甲|乙'] = segN; // 4 段式鍵：sys|線id|站A|站B
      localStorage.setItem('trainmap-checkins-v1', JSON.stringify({ v: 1, st, sg }));
      return [...unlockedAchievements([])];
    };
    return { none: mk(24, 99), stn25: mk(25, 99), stn100: mk(100, 99), c100: mk(0, 100), c500: mk(0, 500) };
  });
  ok('I7 24 座站／99 次都還沒解鎖（門檻不會提前給）',
    !achRes.none.includes('stn25') && !achRes.none.includes('stn100') && !achRes.none.includes('commute100'),
    `[${achRes.none.join(',')}]`);
  ok('I8 25 座站解鎖「車站巡禮」、100 座解鎖「百站達成」',
    achRes.stn25.includes('stn25') && !achRes.stn25.includes('stn100') && achRes.stn100.includes('stn100'),
    `25座→[${achRes.stn25.join(',')}]　100座→[${achRes.stn100.join(',')}]`);
  ok('I9 同一段路 100／500 次解鎖通勤成就（使用者指名的門檻）',
    achRes.c100.includes('commute100') && !achRes.c100.includes('commute500') && achRes.c500.includes('commute500'),
    `100次→[${achRes.c100.filter(x => /commute/.test(x)).join(',')}]　500次→[${achRes.c500.filter(x => /commute/.test(x)).join(',')}]`);
  // 章面只印縮寫名，所以比對 title（完整說明）而不是可見文字；重點是「真的渲染成金章了」
  const achUi = await hp.evaluate(() => {
    const st = {}, sg = { 'tra_sched|縱貫線北段|甲|乙': 500 };
    for (let i = 0; i < 100; i++) st['tra_sched|測試站' + i] = { name: '測試站' + i, sys: 'tra_sched', s: 'pass', n: 1, d: '2026-07-26' };
    localStorage.setItem('trainmap-checkins-v1', JSON.stringify({ v: 1, st, sg }));
    localStorage.setItem('trainmap-passport-open', '1');
    userDataSaveCollection('rides', []);
    renderPassport();
    const gold = [...document.querySelectorAll('#passport .seal.gold')].map(s => s.title);
    const secTxt = [...document.querySelectorAll('#passport .ph-sec')].map(s => s.innerText).join(' | ');
    return { gold, secTxt };
  });
  const wantDesc = ['車站收集達 25 座', '車站收集達 100 座', '同一段路來回搭滿 100 次', '同一段路來回搭滿 500 次'];
  const missing = wantDesc.filter(d => !achUi.gold.some(t => t === d));
  ok('I10 四枚新成就都真的渲染成金章（不是只存在資料裡）', missing.length === 0,
    missing.length ? `沒渲染：${missing.join('、')}` : `金章 ${achUi.gold.length} 枚`);
  ok('I11 護照標題列有露出路段數與「最常搭」', /路段\s*1/.test(achUi.secTxt) && /最常搭.*500\s*次/.test(achUi.secTxt),
    achUi.secTxt.replace(/\s+/g, ' ').slice(0, 130)); // 壓成單行：內嵌換行會讓終端輸出看起來像缺漏

  // 「跟完」不該染實體路網：只有搭乘模式會寫路段
  const virt = await hp.evaluate(() => {
    localStorage.removeItem('trainmap-checkins-v1');
    userDataSaveCollection('rides', [{ train: 'V', sys: 'tra_sched', kind: '自強', from: '臺北', to: '高雄', km: 350, date: '2026-07-20', dep: 1, stops: 12 }]);
    renderPassport();
    const c = JSON.parse(localStorage.getItem('trainmap-checkins-v1') || '{"sg":{}}');
    return Object.keys(c.sg || {}).length;
  });
  ok('I12 完乘（跟完動畫）不會產生路段——虛實雙軌的分界', virt === 0, `路段 ${virt} 段`);

  // ── J 收集地圖（獨立檢視：全路網轉灰，只有搭過的區間亮起）──
  // 判準刻意不同源（心得 29）：不讀 COLLECT_GREY／trackLineColor／state.collectMap 當「有沒有變灰」的證據，
  // 一律從 #overlay 畫布實際像素量「彩度（chroma = (max−min)/255）」——彩度是外部性質，
  // 實作算錯顏色它就會跟著錯，不會像同源判準那樣一起錯成綠燈。
  // 取樣：以區間中點為心的小窗（心得 25：窗開太大會把鄰近高對比物當成自己的墨跡）。
  const cmSetup = await hp.evaluate(() => {
    // 先停跟車再設視野:H 組留下的跟隨會讓相機每幀把畫面拉回那班車身上,
    // setView 設好的取樣位置下一幀就被拉走(實測 18:00 那班車在彰化,取樣點全數出畫面)。
    // 這條測試曾經「會過」純粹是因為當時那班車剛好在取樣點附近——與時間有關,不是與正確性有關。
    clearFollow();
    localStorage.removeItem('trainmap-riding-v1');
    userDataSaveCollection('rides', []);
    // 挑一條有線形、區間夠多的線，前 4 段標成「搭過」，其餘留白當對照組
    const net = lineNetwork();
    const rec = [...net.values()].find(r => r.ln.shape && r.segs.length >= 10);
    if (!rec) return { missing: true };
    const rid = rec.segs.slice(0, 4), un = rec.segs.slice(5);
    const sg = {};
    for (const s of rid) sg[s.key] = 1;
    localStorage.setItem('trainmap-checkins-v1', JSON.stringify({ v: 1, st: {}, sg }));
    // 把視野對到這幾段上，取樣點才在畫面內
    const mid = posAlongShape(rec.ln, (rid[0].dA + rid[rid.length - 1].dB) / 2);
    map.setView([mid.lat, mid.lon], 12, { animate: false });
    renderPassport();
    return {
      lnId: rec.id, color: rec.color, nRid: rid.length,
      ridMids: rid.map(s => posAlongShape(rec.ln, (s.dA + s.dB) / 2)),
      unMids: un.map(s => posAlongShape(rec.ln, (s.dA + s.dB) / 2)),
    };
  });
  info('J 基準', cmSetup.missing ? '找不到可用線' : `${cmSetup.lnId}　線色 ${cmSetup.color}　搭過 ${cmSetup.nRid} 段`);

  // 入口鈕：存在、可見、真的點得到（心得 33：驗按鈕要驗「點它會發生什麼」）
  const cmEntry = await hp.evaluate(() => {
    const b = document.querySelector('#passport [data-act="collectmap"]');
    if (!b) return { missing: true };
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { txt: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height),
      hitSelf: !!(hit && b.contains(hit)), hitTag: hit ? (hit.id || hit.className || hit.tagName) : 'null' };
  });
  ok('J1 護照裡有收集地圖入口，且中心真的點得到',
    !cmEntry.missing && cmEntry.hitSelf && cmEntry.h >= 28,
    cmEntry.missing ? '找不到入口鈕' : `「${cmEntry.txt}」${cmEntry.w}×${cmEntry.h}　命中 ${cmEntry.hitSelf ? '自己' : cmEntry.hitTag}`);

  // 取樣器：回傳窗內「最大彩度」與該像素的 rgb
  const sampleChroma = async (pts) => hp.evaluate((pts) => {
    const cv = document.getElementById('overlay');
    const g = cv.getContext('2d', { willReadFrequently: true });
    // RAD=3:軌道線寬 3px(灰)/3.8px(亮起),±3px 的窗剛好蓋住線本身而不碰到鄰居。
    // 實測半徑掃描 1→10:未搭段彩度在 1–5 平在 0.07,到 7 才跳 0.286(窗角吃進旁邊的東西);
    // 真的沒轉灰的話 RAD=1 就會高。開大窗＝心得 25 的假墨跡,別再調回去。
    const dpr = state.dpr || 1, RAD = 3;
    return pts.map(ll => {
      const p = map.latLngToContainerPoint([ll.lat, ll.lon]);
      const cx = Math.round(p.x * dpr), cy = Math.round(p.y * dpr), s = RAD * dpr;
      if (cx - s < 0 || cy - s < 0 || cx + s >= cv.width || cy + s >= cv.height) return { oob: true }; // 出畫面
      const d = g.getImageData(cx - s, cy - s, s * 2 + 1, s * 2 + 1).data;
      let best = -1, rgb = null;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 200) continue; // 半透明邊緣不算
        const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
        const ch = (mx - mn) / 255;
        if (ch > best) { best = ch; rgb = [d[i], d[i + 1], d[i + 2]]; }
      }
      return best < 0 ? { blank: true } : { ch: +best.toFixed(3), rgb };
    });
  }, pts);

  // 進入收集地圖：走真的點擊，不直接呼叫 setCollectMap
  const cmOn = await hp.evaluate(() => {
    const b = document.querySelector('#passport [data-act="collectmap"]');
    const r = b.getBoundingClientRect();
    b.click();
    const bar = document.getElementById('collectBar');
    return {
      on: state.collectMap, barShown: !bar.hidden,
      barTxt: bar.innerText.replace(/\s+/g, ' ').trim(),
      ctlHidden: getComputedStyle(document.querySelector('.controls')).display === 'none',
      // 不畫車的模式下這兩個都會誤導:徽章恆「0 班奔跑中」、隨機跟隨沒車可跟
      badgeHidden: getComputedStyle(document.querySelector('.badge')).display === 'none',
      actHidden: getComputedStyle(document.querySelector('.map-actions')).display === 'none',
      trains: state._trainHits.length, freq: state._freqHits.length,
    };
  });
  await hp.waitForTimeout(400);
  ok('J2 點入口就進收集地圖：狀態列出現，播放控制列／時鐘徽章／隨機跟隨都收起',
    cmOn.on === true && cmOn.barShown && cmOn.ctlHidden && cmOn.badgeHidden && cmOn.actHidden,
    `collectMap=${cmOn.on}　狀態列「${cmOn.barTxt}」　控制列/徽章/隨機跟隨收起=${cmOn.ctlHidden}/${cmOn.badgeHidden}/${cmOn.actHidden}`);

  const chOf = a => { const v = a.filter(x => x.ch != null).map(x => x.ch); return v.length ? Math.max(...v) : -1; };
  const whyOf = a => `${a.filter(x => x.oob).length} 出畫面／${a.filter(x => x.blank).length} 該處空白／${a.filter(x => x.ch != null).length} 量到`;
  const ridPx = await sampleChroma(cmSetup.ridMids);
  const unPx = await sampleChroma(cmSetup.unMids);
  const maxRid = chOf(ridPx), maxUn = chOf(unPx);
  const diag = await hp.evaluate(([lnId]) => ({
    center: map.getCenter(), zoom: map.getZoom(),
    trackVisibleHas: !state.trackVisible || state.trackVisible.has(lnId),
    trackStyle: state.trackStyle, nTrackLines: (state.trackLines || []).length,
  }), [cmSetup.lnId]);
  if (maxRid < 0 || maxUn < 0) info('J 取樣診斷',
    `搭過[${whyOf(ridPx)}]　未搭[${whyOf(unPx)}]　zoom=${diag.zoom} 中心=${diag.center.lat.toFixed(3)},${diag.center.lng.toFixed(3)}　` +
    `該線在 trackVisible=${diag.trackVisibleHas}　軌道顯示=${diag.trackStyle}　線數=${diag.nTrackLines}`);
  // 線色本身的彩度＝這條線「亮起來」該有的樣子（來自資料檔 ln.color，不是我的繪製程式）
  const hex = (cmSetup.color || '#000000').replace('#', '');
  const lc = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  const lineCh = (Math.max(...lc) - Math.min(...lc)) / 255;
  ok('J3 搭過的區間亮起：實測彩度接近線色本身（不是灰的）',
    maxRid >= lineCh * 0.5 && maxRid > 0.2,
    `搭過段最大彩度 ${maxRid}　線色 ${cmSetup.color} 彩度 ${lineCh.toFixed(3)}（門檻 ${(lineCh * 0.5).toFixed(3)}）`);
  ok('J4 沒搭過的區間是灰的：彩度遠低於搭過的段',
    maxUn >= 0 && maxUn < 0.12 && maxUn < maxRid * 0.3,
    `未搭段最大彩度 ${maxUn}　vs 搭過段 ${maxRid}　${whyOf(unPx)}`);
  ok('J5 收集地圖不畫跑動的列車（畫面只剩你走過的路）',
    cmOn.trains === 0 && cmOn.freq === 0,
    `台鐵/高鐵車 ${cmOn.trains} 台　捷運車 ${cmOn.freq} 台`);

  // 離開：畫面要真的還原（同一批取樣點的彩度回到「兩邊都有顏色」）
  const cmOff = await hp.evaluate(() => {
    document.getElementById('collectExit').click();
    return { on: state.collectMap, barShown: !document.getElementById('collectBar').hidden,
      ctlShown: getComputedStyle(document.querySelector('.controls')).display !== 'none',
      badgeShown: getComputedStyle(document.querySelector('.badge')).display !== 'none',
      actShown: getComputedStyle(document.querySelector('.map-actions')).display !== 'none' };
  });
  await hp.waitForTimeout(400);
  // J7 問的是「軌道層」有沒有復原,所以量之前先把列車層關掉(走既有的車種篩選,不是改繪製程式)——
  // 否則窗內量到的最高彩度可能是剛回來的車號牌(實測 0.859,比線色 0.510 還高),
  // 那樣即使軌道沒復原也會綠燈=判準量錯對象。
  await hp.evaluate(() => { window.__vis = new Set(state.visible); state.visible.clear(); draw(); });
  const unPxOff = await sampleChroma(cmSetup.unMids);
  await hp.evaluate(() => { state.visible = window.__vis; draw(); });
  const offCh = unPxOff.filter(x => x.ch != null).map(x => x.ch);
  const maxUnOff = offCh.length ? Math.max(...offCh) : -1;
  const minUnOff = offCh.length ? Math.min(...offCh) : -1;
  ok('J6 「離開」回到即時地圖：狀態列收起，控制列／徽章／隨機跟隨都回來',
    cmOff.on === false && !cmOff.barShown && cmOff.ctlShown && cmOff.badgeShown && cmOff.actShown,
    `collectMap=${cmOff.on}　狀態列隱藏=${!cmOff.barShown}　控制列/徽章/隨機跟隨回來=${cmOff.ctlShown}/${cmOff.badgeShown}/${cmOff.actShown}`);
  // 逐點都要脫離灰帶(不是只看最大值,否則一點復原就能蓋過其他點沒復原)。
  // 註:南港/臺北/萬華一帶高鐵與縱貫線重疊,那幾點量到的是後畫的高鐵橘 #E85D0D(彩度 0.859)——
  // 「回到某條線的原色」即為所求,不必等於縱貫線自己的藍。
  ok('J7 離開後路線恢復原色（灰化只是檢視，不是永久改掉線色）',
    minUnOff > 0.12 && minUnOff > maxUn,
    `同一批「沒搭過」的取樣點：收集地圖內最高彩度 ${maxUn}（灰）→ 離開後最低 ${minUnOff}／最高 ${maxUnOff}`);

  // 沒有任何路段時不該露出入口（點進去是一張全灰的地圖，等於死路）
  const noSeg = await hp.evaluate(() => {
    localStorage.setItem('trainmap-checkins-v1', JSON.stringify({ v: 1, st: {}, sg: {} }));
    renderPassport();
    return { btn: !!document.querySelector('#passport [data-act="collectmap"]'),
      sec: [...document.querySelectorAll('#passport .ph-sec')].some(s => /路線完乘/.test(s.textContent)) };
  });
  ok('J8 還沒搭過任何路段時不露出入口（避免點進去是一張全灰地圖）',
    noSeg.btn === false && noSeg.sec === false, `入口鈕存在=${noSeg.btn}　路線完乘區存在=${noSeg.sec}`);
  await hctx.close();

  // 手機：上車流程的下車站選單與按鈕觸控尺寸
  const { ctx: hmctx, page: hmp } = await open(browser, { width: 375, height: 780, touch: true }); // K 組要真的 tap
  const hmob = await hmp.evaluate(([train, sys]) => {
    const tr = state.trains.find(x => String(x.train) === train && x.sys === sys);
    if (!tr) return { missing: true };
    state.followTrain = tr; state.mode = 'sched';
    document.getElementById('followPanel').hidden = false;
    document.getElementById('followPanel').classList.remove('fp-min');
    localStorage.removeItem('trainmap-riding-v1');
    openRideBox(tr);
    const box = document.getElementById('fpRideBox');
    const els = [document.getElementById('fpRideTo'), document.getElementById('fpRideGo'), document.getElementById('fpRideCancel')];
    const pr = document.getElementById('followPanel').getBoundingClientRect();
    // 命中測試三點（中心＋左右內緣）：只驗中心會漏掉「被別的浮層蓋住一半」的情況
    const m = els.map(e => {
      const r = e.getBoundingClientRect();
      const at = (x, y) => { const h = document.elementFromPoint(x, y); return h && h.closest('#' + e.id) ? '' : (h ? (h.id || h.tagName) : 'null'); };
      const blocked = [at(r.x + r.width / 2, r.y + r.height / 2), at(r.x + 8, r.y + r.height / 2), at(r.right - 8, r.y + r.height / 2)].filter(Boolean);
      return { id: e.id, w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right),
        inCard: r.right <= pr.right + 0.5 && r.left >= pr.left - 0.5, blocked };
    });
    return { missing: false, boxHidden: box.hidden, opts: document.getElementById('fpRideTo').options.length, m, vw: innerWidth };
  }, [trip.train, trip.sys]);
  ok('H14 手機 375：下車站選單開得出來且有選項', !hmob.missing && hmob.boxHidden === false && hmob.opts > 0,
    `選項 ${hmob.opts} 個`);
  ok('H15 手機 375：選單與按鈕觸控高度足夠、且都在卡片框內',
    !hmob.missing && hmob.m.every(x => x.h >= 36 && x.right <= hmob.vw + 0.5 && x.inCard),
    hmob.m.map(x => `${x.id} ${x.w}×${x.h}${x.inCard ? '' : '(出框)'}`).join('、'));
  // 跟隨小卡在站台帶下方（z650 vs z700），選單這一列剛好落在站台帶的座位上——
  // 只量 rect 看不出來，一定要真的做命中測試（心得 24）
  ok('H16 手機 375：選單與兩顆鈕都沒被站台帶蓋住（三點命中測試）',
    !hmob.missing && hmob.m.every(x => x.blocked.length === 0),
    hmob.m.map(x => `${x.id}${x.blocked.length ? ' 被 ' + x.blocked.join('/') + ' 蓋住' : ' ✓'}`).join('、'));
  // 挑站挑到一半取消跟隨：body.ride-picking 一定要收掉，否則站台帶會永遠隱形
  const leak = await hmp.evaluate(() => {
    const on = document.body.classList.contains('ride-picking');
    clearFollow();
    const after = document.body.classList.contains('ride-picking');
    const ctrl = document.querySelector('.controls');
    return { on, after, opacity: ctrl ? getComputedStyle(ctrl).opacity : '—' };
  });
  ok('H17 挑站中途取消跟隨，站台帶會回來（不殘留 ride-picking）',
    leak.on === true && leak.after === false && leak.opacity !== '0',
    `挑站時 ${leak.on} → 取消跟隨後 ${leak.after}，站台帶 opacity=${leak.opacity}`);

  // ── K 收集地圖・手機 375（狀態列的「離開」是這個模式唯一的出口，點不到＝把人關在裡面）──
  const cmMob = await hmp.evaluate(() => {
    clearFollow();
    const net = lineNetwork();
    const rec = [...net.values()].find(r => r.ln.shape && r.segs.length >= 10);
    const sg = {}; for (const s of rec.segs.slice(0, 4)) sg[s.key] = 1;
    localStorage.setItem('trainmap-checkins-v1', JSON.stringify({ v: 1, st: {}, sg }));
    openRidePanel();
    const b = document.querySelector('#ridePanel [data-act="collectmap"]');
    if (!b) return { missing: true };
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { w: Math.round(r.width), h: Math.round(r.height),
      inView: r.x >= 0 && r.right <= innerWidth,
      hitSelf: !!(hit && b.contains(hit)), hitTag: hit ? (hit.id || hit.className || hit.tagName) : 'null' };
  });
  ok('K1 手機 375：護照 sheet 裡的收集地圖入口沒被切掉、點得到',
    !cmMob.missing && cmMob.inView && cmMob.hitSelf && cmMob.h >= 28,
    cmMob.missing ? '找不到入口鈕' : `${cmMob.w}×${cmMob.h}　視窗內=${cmMob.inView}　命中 ${cmMob.hitSelf ? '自己' : cmMob.hitTag}`);

  // 真的點下去（不是呼叫 setCollectMap），再驗出口
  const cmMobOn = await hmp.evaluate(() => {
    document.querySelector('#ridePanel [data-act="collectmap"]').click();
    const bar = document.getElementById('collectBar'), ex = document.getElementById('collectExit');
    const br = bar.getBoundingClientRect(), er = ex.getBoundingClientRect();
    const hit = document.elementFromPoint(er.x + er.width / 2, er.y + er.height / 2);
    const tb = document.querySelector('.tabbar');
    return {
      on: state.collectMap,
      barIn: br.x >= 0 && br.right <= innerWidth && br.y >= 0 && br.bottom <= innerHeight,
      exW: Math.round(er.width), exH: Math.round(er.height),
      exHit: !!(hit && ex.contains(hit)), exTag: hit ? (hit.id || hit.className || hit.tagName) : 'null',
      tabHidden: !tb || getComputedStyle(tb).display === 'none',
      sheetGone: document.getElementById('ridePanel').hidden,
    };
  });
  ok('K2 手機 375：狀態列整條在視窗內，護照 sheet 自動收起',
    cmMobOn.on === true && cmMobOn.barIn && cmMobOn.sheetGone,
    `狀態列在視窗內=${cmMobOn.barIn}　sheet 收起=${cmMobOn.sheetGone}　tabbar 隱藏=${cmMobOn.tabHidden}`);
  ok('K3 手機 375：唯一出口「離開」觸控尺寸足夠且中心真的點得到',
    cmMobOn.exHit && cmMobOn.exH >= 28 && cmMobOn.exW >= 44,
    `${cmMobOn.exW}×${cmMobOn.exH}　命中 ${cmMobOn.exHit ? '自己' : cmMobOn.exTag}`);

  // 端到端：真的用觸控點下去，要回得到即時地圖（心得 33：驗按鈕要驗「點它會發生什麼」）
  await hmp.tap('#collectExit');
  await hmp.waitForTimeout(400);
  const cmMobOff = await hmp.evaluate(() => ({
    on: state.collectMap,
    barHidden: document.getElementById('collectBar').hidden,
    tabBack: getComputedStyle(document.querySelector('.tabbar')).display !== 'none',
  }));
  ok('K4 手機 375：真的觸控「離開」就回到即時地圖（tab bar 也回來）',
    cmMobOff.on === false && cmMobOff.barHidden && cmMobOff.tabBack,
    `collectMap=${cmMobOff.on}　狀態列隱藏=${cmMobOff.barHidden}　tabbar 回來=${cmMobOff.tabBack}`);

  // ── L 護照分節收合（使用者 2026-07-26：「旅程護照現在佔太大塊了」）──
  // 判準刻意不同源（心得 29）：不讀 ppSecOpen()／localStorage 當「有沒有收起來」的證據
  //（那是實作自己的狀態，實作判斷錯就會一起錯成綠燈），一律量**實際渲染高度**與
  //  真的用滑鼠／手指點下去之後畫面變成怎樣——高度與命中都是外部性質。
  const lSeed = await page.evaluate(() => {
    localStorage.removeItem('trainmap-passport-secs');   // 從乾淨預設起手，測的是「預設值」
    localStorage.setItem('trainmap-passport-open', '1');
    // 用多條線湊出**真實規模**的車站牆：只取一條線只有 31 座，那個量級根本踩不到
    // 「車站牆太高」這個功能存在的理由，測出來的節省幅度會失真。
    const recs = [...lineNetwork().values()].sort((a, b) => b.segs.length - a.segs.length).slice(0, 6);
    if (!recs.length) return { missing: true };
    const st = {}, sg = {};
    recs.forEach(rec => rec.segs.forEach((sgm, i) => {
      sg[sgm.key] = 1;
      for (const nm of [sgm.a, sgm.b])
        st[favStationKey({ sys: rec.sys, name: nm })] = { name: nm, sys: rec.sys, s: 'pass', n: 1 + (i % 3), d: '2026-07-20' };
    }));
    const rec = recs[0];
    localStorage.setItem('trainmap-checkins-v1', JSON.stringify({ v: 1, st, sg }));
    userDataSaveCollection('rides', [
      { train: 'R1', sys: rec.sys, kind: '區間', from: rec.segs[0].a, to: rec.segs[0].b, km: 10, date: '2026-07-20', dep: 30000, stops: 3 },
      { train: 'R2', sys: rec.sys, kind: '自強', from: rec.segs[1].a, to: rec.segs[1].b, km: 20, date: '2026-07-21', dep: 30000, stops: 4 },
    ]);
    renderPassport();
    return { nStn: Object.keys(st).length, nSeg: Object.keys(sg).length };
  });
  info('L 基準', lSeed.missing ? '找不到夠長的線' : `造 ${lSeed.nStn} 座站／${lSeed.nSeg} 段（車站牆上限 24）`);

  // 各節標題與其內容區的實際高度（內容區＝標題的下一個兄弟）
  const secState = () => page.evaluate(() => {
    const out = {};
    for (const h of document.querySelectorAll('#passport .ph-sec[data-sec]')) {
      const body = h.nextElementSibling;
      out[h.dataset.sec] = {
        closed: h.classList.contains('closed'),
        bodyH: body ? Math.round(body.getBoundingClientRect().height) : -1,
        caret: !!h.querySelector('.ph-caret'),
        n: Number(h.dataset.n) || 0,
      };
    }
    out._total = Math.round(document.getElementById('passport').getBoundingClientRect().height);
    return out;
  });
  const s0 = await secState();
  const secKeys = Object.keys(s0).filter(k => k[0] !== '_');
  ok('L1 每一節都長出收合把手（箭頭），且節數如預期',
    secKeys.length >= 6 && secKeys.every(k => s0[k].caret),
    `${secKeys.length} 節：${secKeys.join('／')}`);

  // 站數 60 > 上限 24 → 車站收集該「預設就收起」；封頂的圖鑑三節該預設展開
  ok('L2 沒上限的車站收集預設收起，封頂的圖鑑／成就預設展開（不是一律收起）',
    s0.stn && s0.stn.closed && s0.stn.bodyH === 0 &&
    ['named', 'stock', 'branch'].every(k => s0[k] && !s0[k].closed && s0[k].bodyH > 0),
    `車站收集 closed=${s0.stn && s0.stn.closed}(${s0.stn && s0.stn.n} 座)　` +
    `明星/車種/支線 bodyH=${['named','stock','branch'].map(k => s0[k] ? s0[k].bodyH : '-').join('/')}`);

  // 真的用滑鼠點標題列（不是呼叫函式）
  await page.click('#passport .ph-sec[data-sec="named"]');
  const s1 = await secState();
  ok('L3 點標題列真的收起來：內容區渲染高度歸零，整卡跟著變矮',
    s1.named.closed && s1.named.bodyH === 0 && s1._total < s0._total,
    `明星列車 bodyH ${s0.named.bodyH}→${s1.named.bodyH}　整卡 ${s0._total}→${s1._total}px`);
  await page.click('#passport .ph-sec[data-sec="stn"]');
  const s2 = await secState();
  ok('L4 再點收起的那節會展開（雙向都通）',
    !s2.stn.closed && s2.stn.bodyH > 0,
    `車站收集 bodyH ${s0.stn.bodyH}→${s2.stn.bodyH}`);

  // 車站牆收斂：預設只露 24 座 ＋「還有 N 座」；點了露出全部
  const wall0 = await page.evaluate(() => ({
    seals: document.querySelectorAll('#passport .stn-seal').length,
    more: (document.querySelector('#passport .stn-more') || {}).textContent || '',
  }));
  await page.click('#passport .stn-more');
  const wall1 = await page.evaluate(() => ({
    seals: document.querySelectorAll('#passport .stn-seal').length,
    more: (document.querySelector('#passport .stn-more') || {}).textContent || '',
  }));
  ok('L5 車站牆預設只露上限那批，「還有 N 座」點了真的全部展開',
    wall0.seals === 24 && /還有 \d+ 座/.test(wall0.more) && wall1.seals === lSeed.nStn && /收起/.test(wall1.more),
    `${wall0.seals} 座「${wall0.more.trim()}」→ 點擊後 ${wall1.seals} 座「${wall1.more.trim()}」（實際共 ${lSeed.nStn} 座）`);

  // 節內按鈕不可以被收合把手吃掉（收集地圖鈕、完乘記錄排序鈕都長在標題列上）
  await page.click('#passport [data-act="collectmap"]');
  const mapOn = await page.evaluate(() => ({ on: state.collectMap, linesClosed: !!document.querySelector('#passport .ph-sec[data-sec="lines"].closed') }));
  await page.evaluate(() => setCollectMap(false));
  ok('L6 標題列上的「🗺 收集地圖」鈕點了是進收集地圖，不是把那一節收起來',
    mapOn.on === true && mapOn.linesClosed === false,
    `collectMap=${mapOn.on}　路線完乘那節被誤收=${mapOn.linesClosed}`);

  const sortBefore = await page.evaluate(() => (document.querySelector('#phSortSeg button.on') || {}).dataset?.v || '');
  const sortOther = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#phSortSeg button')].find(x => !x.classList.contains('on'));
    return b ? b.dataset.v : '';
  });
  if (sortOther) await page.click(`#phSortSeg button[data-v="${sortOther}"]`);
  const sortAfter = await page.evaluate(() => ({
    v: (document.querySelector('#phSortSeg button.on') || {}).dataset?.v || '',
    ridesClosed: !!document.querySelector('#passport .ph-sec[data-sec="rides"].closed'),
  }));
  ok('L7 完乘記錄的排序鈕點了是換排序，不是把那一節收起來',
    !!sortOther && sortAfter.v === sortOther && sortAfter.ridesClosed === false,
    `排序 ${sortBefore}→${sortAfter.v}　完乘記錄那節被誤收=${sortAfter.ridesClosed}`);

  // 標題列排版：加了前置箭頭之後，「完乘記錄」不可以被 space-between 推到中間
  const headLayout = await page.evaluate(() => {
    const h = document.querySelector('#passport .ph-sec-rides');
    if (!h) return { missing: true };
    const caret = h.querySelector('.ph-caret');
    const tn = [...h.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
    if (!caret || !tn) return { missing: true };
    const r = document.createRange(); r.selectNodeContents(tn);
    return { gap: Math.round(r.getBoundingClientRect().left - caret.getBoundingClientRect().right) };
  });
  ok('L8 「完乘記錄」標題緊跟在箭頭後面（沒被排版推開）',
    !headLayout.missing && headLayout.gap >= 0 && headLayout.gap < 24,
    headLayout.missing ? '找不到標題列' : `箭頭與文字間距 ${headLayout.gap}px（門檻 <24）`);

  // 收合狀態要記得住：重開一頁看同一節還是不是收著的
  await page.click('#passport .ph-sec[data-sec="achv"]');
  // 必須 reload 同一個 context——browser.newContext() 的 localStorage 是隔離的，
  // 開新 context 去驗「有沒有記住」永遠會 FAIL，而且是測試自己的錯不是產品的錯。
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, { timeout: 40000 });
  await page.waitForTimeout(600);
  const persisted = await page.evaluate(() => {
    document.getElementById('howtoWrap')?.remove();
    localStorage.setItem('trainmap-passport-open', '1'); renderPassport();
    const h = document.querySelector('#passport .ph-sec[data-sec="achv"]');
    return { closed: h ? h.classList.contains('closed') : null,
      bodyH: h && h.nextElementSibling ? Math.round(h.nextElementSibling.getBoundingClientRect().height) : -1 };
  });
  ok('L9 收合狀態跨頁面記得住（重開一頁，剛收起的那節還是收著）',
    persisted.closed === true && persisted.bodyH === 0,
    `成就徽章 closed=${persisted.closed}　bodyH=${persisted.bodyH}`);

  // 整體效果：與「全部展開＋車站牆不收斂」相比要明顯變矮
  const heights = await page.evaluate(() => {
    const pp = document.getElementById('passport');
    const prefs = { named: 1, stock: 1, branch: 1, stn: 1, lines: 1, achv: 1, rides: 1, stnAll: 1 };
    localStorage.setItem('trainmap-passport-secs', JSON.stringify(prefs));
    renderPassport();
    const all = Math.round(pp.getBoundingClientRect().height);
    localStorage.removeItem('trainmap-passport-secs');
    renderPassport();
    return { all, def: Math.round(pp.getBoundingClientRect().height), vh: innerHeight };
  });
  ok('L10 預設狀態比「全部攤開」省下可觀高度，且收得進一個視窗',
    heights.all - heights.def >= 200 && heights.def <= heights.vh,
    `全部攤開 ${heights.all}px → 預設 ${heights.def}px（省 ${heights.all - heights.def}px，門檻 ≥200）　` +
    `${(heights.def / heights.vh).toFixed(2)} 個視窗（門檻 ≤1.0）`);

  // 手機 sheet：真觸控收合（手機的護照長在 #ridePanel，走的是另一條 render 路徑）
  const { page: lmp, ctx: lmctx } = await open(browser, { width: 390, height: 844, touch: true });
  await lmp.waitForTimeout(800);
  const mobSec = await lmp.evaluate(() => {
    localStorage.removeItem('trainmap-passport-secs');
    const rec = [...lineNetwork().values()].find(r => r.segs.length >= 30);
    const st = {}, sg = {};
    rec.segs.slice(0, 30).forEach((sgm, i) => {
      sg[sgm.key] = 1;
      for (const nm of [sgm.a, sgm.b]) st[favStationKey({ sys: rec.sys, name: nm })] = { name: nm, sys: rec.sys, s: 'pass', n: 1, d: '2026-07-20' };
    });
    localStorage.setItem('trainmap-checkins-v1', JSON.stringify({ v: 1, st, sg }));
    document.getElementById('howtoWrap')?.remove();
    openRidePanel();
    const h = document.querySelector('#ridePanel .ph-sec[data-sec="named"]');
    if (h) h.scrollIntoView({ block: 'center' });
    return { has: !!h };
  });
  await lmp.waitForTimeout(500);
  const mob0 = await lmp.evaluate(() => {
    const h = document.querySelector('#ridePanel .ph-sec[data-sec="named"]');
    const r = h.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { bodyH: Math.round(h.nextElementSibling.getBoundingClientRect().height),
      hitSelf: !!(hit && (h.contains(hit) || hit === h)), hitTag: hit ? (hit.id || hit.className || hit.tagName) : 'null',
      x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (mob0.hitSelf) await lmp.touchscreen.tap(mob0.x, mob0.y);
  const mob1 = await lmp.evaluate(() => {
    const h = document.querySelector('#ridePanel .ph-sec[data-sec="named"]');
    return { closed: h.classList.contains('closed'), bodyH: Math.round(h.nextElementSibling.getBoundingClientRect().height) };
  });
  await lmctx.close();
  ok('L11 手機 390：護照 sheet 內的節標題真的觸控得到，點下去就收起',
    mobSec.has && mob0.hitSelf && mob1.closed && mob1.bodyH === 0,
    `命中 ${mob0.hitSelf ? '自己' : mob0.hitTag}　bodyH ${mob0.bodyH}→${mob1.bodyH}`);

  await hmp.evaluate(([train, sys]) => { // 截圖前把畫面還原成挑站中
    const tr = state.trains.find(x => String(x.train) === train && x.sys === sys);
    state.followTrain = tr; state.mode = 'sched';
    const fp = document.getElementById('followPanel');
    fp.hidden = false; fp.classList.remove('fp-min');
    openRideBox(tr);
  }, [trip.train, trip.sys]);
  await hmp.waitForTimeout(700); // 站台帶淡出是 0.5s transition，等它落定再截，否則會拍到半透明的誤導畫面
  await hmp.screenshot({ path: '_shot_ride_mobile.png', clip: await hmp.evaluate(() => {
    const r = document.getElementById('followPanel').getBoundingClientRect();
    // 往右多留 200px：跟隨小卡右側就是站台帶的座位，截圖要照得到「有沒有壓在一起」
    return { x: Math.max(0, r.x - 4), y: Math.max(0, r.y - 4), width: Math.min(r.width + 208, 375), height: Math.min(r.height + 16, innerHeight - Math.max(0, r.y - 4)) };
  }) });
  await hmctx.close();

  await page.screenshot({ path: '_shot_checkin_desktop.png', clip: await page.evaluate(() => {
    const r = document.getElementById('passport').getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, 900), height: Math.min(r.height, 900) };
  }) });

  // ── M 組：sg 的值形狀（規格 §6）─────────────────────────────
  // 判準不與實作同源：測試自己塞 localStorage 的原始 JSON、自己算期望值，
  // 不呼叫 segmentCollection()／writeSegments()。
  {
    const { page, ctx } = await open(browser, {});

    // M1 舊資料（v1，值是純數字）讀進來要自動升成 {n, nv:0}
    const m1 = await page.evaluate(() => {
      localStorage.setItem('trainmap-checkins-v1', JSON.stringify({
        v: 1, st: {}, sg: { 'TRA|WL|A|B': 3, 'TRA|WL|B|C': 1 },
      }));
      const c = loadCheckins();
      return { a: c.sg['TRA|WL|A|B'], b: c.sg['TRA|WL|B|C'], v: c.v };
    });
    ok('M1 v1 的數字值升成 {n,nv:0}',
      m1.v === 2 && m1.a && m1.a.n === 3 && m1.a.nv === 0 && m1.b.n === 1 && m1.b.nv === 0,
      JSON.stringify(m1));

    // M2 沒有在場證據的舊資料一律 nv=0——寧可低估，不可讓沒驗過的進懸賞分母
    const m2 = await page.evaluate(() => {
      const sgAll = segmentCollection(), sgV = segmentCollectionVerified();
      return { all: sgAll['TRA|WL|A|B'], ver: sgV['TRA|WL|A|B'], verKeys: Object.keys(sgV).length };
    });
    ok('M2 segmentCollection 仍回總次數、Verified 回 0 筆', m2.all === 3 && m2.ver === undefined && m2.verKeys === 0,
      JSON.stringify(m2));

    // M3 v2 資料直接讀，不被再升一次（升級要冪等）
    const m3 = await page.evaluate(() => {
      localStorage.setItem('trainmap-checkins-v1', JSON.stringify({
        v: 2, st: {}, sg: { 'TRA|WL|A|B': { n: 5, nv: 2 } },
      }));
      const c = loadCheckins();
      return c.sg['TRA|WL|A|B'];
    });
    ok('M3 v2 讀進來不變形', m3 && m3.n === 5 && m3.nv === 2, JSON.stringify(m3));

    // M4 segmentCollection 的六個消費者拿到的仍是數字（型別不可改，否則完乘率與收集地圖會壞）
    const m4 = await page.evaluate(() => {
      const sg = segmentCollection();
      return Object.values(sg).every(v => typeof v === 'number');
    });
    ok('M4 segmentCollection 的值仍是 number', m4 === true, String(m4));

    await ctx.close();
  }
} finally {
  try { unlinkSync(BASELINE); } catch (e) {}
  await browser.close();
}
const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
