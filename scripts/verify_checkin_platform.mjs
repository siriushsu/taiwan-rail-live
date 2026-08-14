#!/usr/bin/env node
// 驗「單站打卡改用月台幾何判定」(issue #28：汐科月台 338m，站在月台上打不到卡)。
//
// 判準怎麼設計的（避免假綠）：
//   ・核心那條要能被「還原成舊行為」殺掉 → E1 把 state.stnPlatforms 拔掉後，同一批座標必須全紅。
//     只驗「新座標會過」的話，任何順便放寬判定的改動都能讓它綠（判準落在受測物下游）。
//   ・不得誤判 → C2 機械窮舉：每一站的月台兩端點＋中點，拿去對「其他 196 座站」判定，
//     一律必須不過。抽樣會漏掉恰好相鄰的那一對，所以全掃。
//   ・零回歸 → D1/D2：改動宣稱是「兩塊區域取聯集」，那麼原本過的每一個點都必須還是過。
//     這條在改成「只用月台線段」時會紅（那正是要防的退化）。
//   ・判定一律呼叫頁面上真的在跑的 checkinJudge()，不在腳本裡重算一份（重算＝判準與實作同源）。
//
// 用法：node scripts/verify_checkin_platform.mjs [http://127.0.0.1:5178]
import { chromium, webkit } from 'playwright';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = process.argv[2] || 'http://127.0.0.1:5178';
// macOS／iOS 使用者是 WebKit，而打卡本身就是 App（WKWebView）限定 ⇒ 兩個引擎都要跑
const ENGINE = (process.env.ENGINE || 'chromium').toLowerCase();
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };

// G0 自檢：伺服器吐的必須就是這棵樹的 index.html（這台機器同時有 20+ 個 worktree 各自起 server）
{
  const served = createHash('md5').update(Buffer.from(
    await (await fetch(BASE + '/index.html')).arrayBuffer())).digest('hex');
  const disk = createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
  ok('G0 伺服器吐的 index.html ＝ 這棵工作樹的', served === disk, `${served.slice(0, 8)} vs ${disk.slice(0, 8)}`);
  if (served !== disk) { console.log('\n驗錯目標，停手'); process.exit(1); }
}
// G0b 同理：月台資料檔也要是這棵樹的（前端讀的是伺服器那份）
{
  const served = createHash('md5').update(Buffer.from(
    await (await fetch(BASE + '/data/tra_platforms.json')).arrayBuffer())).digest('hex');
  const disk = createHash('md5').update(readFileSync(path.join(ROOT, 'data/tra_platforms.json'))).digest('hex');
  ok('G0b 伺服器吐的 tra_platforms.json ＝ 這棵工作樹的', served === disk, `${served.slice(0, 8)} vs ${disk.slice(0, 8)}`);
  if (served !== disk) { console.log('\n驗錯目標，停手'); process.exit(1); }
}

const disk = JSON.parse(readFileSync(path.join(ROOT, 'data/tra_platforms.json'), 'utf8'));
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch();
console.log(`引擎：${ENGINE}`);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// 假裝原生殼：定位與附近車站是 App 限定（LOCATE_ENABLED），網站沒有入口
await ctx.addInitScript(() => {
  // 定位與附近車站是 App 限定（LOCATE_ENABLED＝有沒有這座橋）。這裡給的是「永遠拒絕」的橋：
  // 判定用的座標一律由測試自己塞進 state.meLoc，不讓開機定位干擾。
  const deny = () => Promise.reject(new Error('test: denied'));
  window.RAIL_NATIVE_GEOLOCATION = {
    getCurrentPosition: deny, watchPosition: deny, clearWatch: () => {},
  };
  // 打卡鈕整條被 PHYSICAL_COLLECT_ENABLED 擋在 App 內，而那是靠 RAIL_ONLINE_BASEMAPS_AVAILABLE
  // 判斷「是不是原生殼」的 ⇒ 少這一顆，F 段的鈕根本不會被渲染出來
  window.RAIL_ONLINE_BASEMAPS_AVAILABLE = true;
  window.RAIL_MUSIC_AVAILABLE = true;
  window.RAIL_APP_CONFIG = { followZoomCap: 16, satRetina: true };
  // 首訪教學卡（#howtoWrap，z800、inset:0）會攔掉所有點擊 ⇒ F 段的真點擊全部逾時。開頁前先標已看過。
  try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
});
const page = await ctx.newPage();
const errs = [], badData = [];
page.on('pageerror', e => errs.push('pageerror:' + String(e)));
// 本機 dev server 沒有 .env ⇒ /api/* 會 404/502，那是環境不是缺陷；資料檔載不到才是缺陷，分開記。
page.on('console', m => {
  if (m.type() !== 'error') return;
  if (/Failed to load resource/i.test(m.text())) return;
  errs.push('console:' + m.text().slice(0, 160));
});
page.on('response', r => { if (r.url().includes('/data/') && !r.ok()) badData.push(`${r.status()} ${r.url().split('/').pop()}`); });
await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
try {
  await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0
    && state.schedStations && state.schedStations.length > 0 && state.stnPlatforms !== undefined, { timeout: 60000 });
} catch (e) {
  console.log('boot 沒完成，pageerror：', errs.slice(0, 3).join(' | ') || '(無)');
  process.exit(1);
}

// ── A 資料檔本身 ────────────────────────────────────────────────────────────
const loaded = await page.evaluate(() => state.stnPlatforms);
ok('A1 前端真的載到月台幾何', !!loaded && Object.keys(loaded).length > 100, `${loaded ? Object.keys(loaded).length : 0} 站`);
ok('A2 磁碟檔與前端載到的站數一致', Object.keys(disk.stations).length === Object.keys(loaded || {}).length);
ok('A3 汐科在資料裡', !!(loaded && loaded['汐科']));
{
  const bad = Object.entries(disk.stations).filter(([, s]) =>
    !Array.isArray(s) || s.length !== 2 || s.some(p => !Array.isArray(p) || p.length !== 2
      || p[0] < 21.5 || p[0] > 25.5 || p[1] < 119.5 || p[1] > 122.5));
  ok('A4 每站都是「台灣範圍內的兩點線段」', bad.length === 0, bad.slice(0, 3).map(b => b[0]).join('、'));
}
{
  // 站名查不到＝前端一輩子用不到那筆（checkinPlatformSeg 用 st.name 查）
  const miss = await page.evaluate(() => {
    const names = new Set(state.schedStations.filter(s => s.sys === 'tra_sched').map(s => s.name));
    return Object.keys(state.stnPlatforms).filter(n => !names.has(n));
  });
  ok('A5 每個鍵都對得上班表站名', miss.length === 0, miss.slice(0, 5).join('、'));
}

// 頁面內共用的小工具：依站名取 schedStations 的站物件、對某座標判定
await page.evaluate(() => {
  window.__stOf = n => state.schedStations.find(s => s.sys === 'tra_sched' && s.name === n);
  window.__judge = (n, lat, lon, acc = 0) => {
    const st = window.__stOf(n); if (!st) return null;
    state.meLoc = { lat, lon, acc };
    const j = checkinJudge(st);
    return { ok: j.ok, distM: Math.round(j.distM || 0), r: j.r };
  };
  window.__mid = seg => [(seg[0][0] + seg[1][0]) / 2, (seg[0][1] + seg[1][1]) / 2];
});

// ── B 汐科：月台上任一處都要打得到卡 ───────────────────────────────────────
const xike = disk.stations['汐科'];
const xikeMid = [(xike[0][0] + xike[1][0]) / 2, (xike[0][1] + xike[1][1]) / 2];
for (const [label, p] of [['西端', xike[0]], ['中點', xikeMid], ['東端', xike[1]]]) {
  const j = await page.evaluate(([n, la, lo]) => window.__judge(n, la, lo), ['汐科', p[0], p[1]]);
  ok(`B 汐科月台${label}（acc=0）打得到卡`, !!j && j.ok, j ? `距離 ${j.distM}m / 範圍 ${j.r}m` : 'null');
}
{
  const j = await page.evaluate(() => { const s = window.__stOf('汐科'); return window.__judge('汐科', s.lat, s.lon); });
  ok('B4 汐科站點座標本身仍打得到卡（不得回歸）', !!j && j.ok, j ? `距離 ${j.distM}m / 範圍 ${j.r}m` : 'null');
}
// 端點正好落在線段上（距離 0），只驗端點的話「橫向容忍改成 0」也照樣全綠 ⇒ 補兩個橫向偏移點，
// 把容忍值本身釘住：40m（並排月台、天橋、站房都在這個量級）要過，200m 要不過。
const offset = m => {                                   // 由中點沿線段的垂直方向推 m 公尺
  const kx = 111320 * Math.cos(xikeMid[0] * Math.PI / 180), ky = 110540;
  const dx = (xike[1][1] - xike[0][1]) * kx, dy = (xike[1][0] - xike[0][0]) * ky;
  const L = Math.hypot(dx, dy);
  return [xikeMid[0] + (dx / L) * m / ky, xikeMid[1] - (dy / L) * m / kx];
};
for (const [m, want] of [[40, true], [200, false]]) {
  const p = offset(m);
  const j = await page.evaluate(([la, lo]) => window.__judge('汐科', la, lo), p);
  ok(`B5 汐科月台中點橫向 ${m}m ⇒ ${want ? '過' : '不過'}`, !!j && j.ok === want, j ? `距離 ${j.distM}m / 範圍 ${j.r}m` : 'null');
}

// ── C 不得誤判成別站 ───────────────────────────────────────────────────────
{
  const j = await page.evaluate(() => { const s = window.__stOf('汐止'); return window.__judge('汐科', s.lat, s.lon); });
  ok('C1 站在汐止站點座標，不會判成到了汐科', !!j && !j.ok, j ? `距離 ${j.distM}m / 範圍 ${j.r}m` : 'null');
}
{
  // 月台西端再往西 400m（沿線外推）＝界外，必須不過
  const [a, b] = xike;
  const far = [a[0] + (a[0] - b[0]) * 1.2, a[1] + (a[1] - b[1]) * 1.2];
  const j = await page.evaluate(([la, lo]) => window.__judge('汐科', la, lo), far);
  ok('C2 汐科月台外推 400m 打不到卡（線段不是無限長）', !!j && !j.ok, j ? `距離 ${j.distM}m` : 'null');
}
{
  // 機械窮舉：每站月台兩端＋中點，對「其他每一座有幾何的站」判定都必須不過
  const bad = await page.evaluate(() => {
    const P = state.stnPlatforms, names = Object.keys(P), out = [];
    for (const n of names) {
      const pts = [P[n][0], window.__mid(P[n]), P[n][1]];
      for (const m of names) {
        if (m === n) continue;
        const st = window.__stOf(m); if (!st) continue;
        for (const p of pts) {
          state.meLoc = { lat: p[0], lon: p[1], acc: 0 };
          if (checkinJudge(st).ok) out.push(`${n}的月台點 → 誤判成 ${m}`);
        }
      }
    }
    return out;
  });
  ok('C3 全站窮舉：站 A 的月台點不會判成站 B（197×196×3）', bad.length === 0, bad.slice(0, 4).join('；'));
}

// ── D 零回歸：聯集，原本過的都還要過 ───────────────────────────────────────
{
  const bad = await page.evaluate(() => {
    const out = [];
    for (const st of state.schedStations.filter(s => s.sys === 'tra_sched')) {
      state.meLoc = { lat: st.lat, lon: st.lon, acc: 0 };
      if (!checkinJudge(st).ok) out.push(st.name);
    }
    return out;
  });
  ok('D1 全台鐵站：站在自己的站點座標都還打得到卡', bad.length === 0, bad.slice(0, 5).join('、'));
}
{
  // 沒有月台幾何的 44 座：行為必須與改動前一致（站等半徑內過、半徑＋50m 外不過）
  const res = await page.evaluate(() => {
    const P = state.stnPlatforms, inside = [], outside = [];
    for (const st of state.schedStations.filter(s => s.sys === 'tra_sched' && !P[s.name])) {
      const r = checkinRadiusFor(st);
      state.meLoc = { lat: st.lat, lon: st.lon, acc: 0 };
      if (!checkinJudge(st).ok) inside.push(st.name);
      // 往北推 半徑+50m
      state.meLoc = { lat: st.lat + (r + 50) / 110540, lon: st.lon, acc: 0 };
      if (checkinJudge(st).ok) outside.push(st.name);
    }
    return { n: state.schedStations.filter(s => s.sys === 'tra_sched' && !P[s.name]).length, inside, outside };
  });
  ok(`D2 無月台幾何的 ${res.n} 座站：半徑內過`, res.inside.length === 0, res.inside.slice(0, 5).join('、'));
  ok(`D2b 無月台幾何的 ${res.n} 座站：半徑+50m 外不過`, res.outside.length === 0, res.outside.slice(0, 5).join('、'));
}

// ── E 核心那條真的來自新資料（把資料拔掉必須全紅） ─────────────────────────
{
  const res = await page.evaluate(([a, mid, b]) => {
    const keep = state.stnPlatforms;
    state.stnPlatforms = null;                       // 模擬「缺檔／改動前」
    const st = window.__stOf('汐科');
    const r = [a, mid, b].map(p => { state.meLoc = { lat: p[0], lon: p[1], acc: 0 }; return checkinJudge(st).ok; });
    state.stnPlatforms = keep;
    return r;
  }, [xike[0], xikeMid, xike[1]]);
  // 舊行為精確長這樣：站點座標在月台東端外 141m、半徑 180m ⇒ 只有最東端那一小截打得到卡，
  // 西端（476m）與中點（約 300m）都不行。這條同時釘住「改壞了什麼」與「本來就對的那一小截」。
  ok('E1 拔掉月台幾何後，汐科月台西端與中點打不到卡（證明 B 的綠來自新資料）',
    res[0] === false && res[1] === false, JSON.stringify(res));
  ok('E1b 拔掉月台幾何後，汐科月台東端仍打得到卡（舊行為就是只有這一截能用）',
    res[2] === true, JSON.stringify(res));
  const back = await page.evaluate(([la, lo]) => window.__judge('汐科', la, lo), xikeMid);
  ok('E2 資料放回去後又打得到（斷言真的在看那份資料）', !!back && back.ok);
}

// ── F 端到端：真的把鈕點下去，章要真的進 localStorage ─────────────────────
// 判定函式回 true 不等於使用者蓋得到章（鈕可能是淡的、可能被別的元素蓋住、可能寫不進去）。
{
  await page.setViewportSize({ width: 390, height: 844 });          // 手機：使用者的實際情境
  const open = async (lat, lon) => page.evaluate(([la, lo]) => {
    localStorage.removeItem('trainmap-checkins-v1');
    state.meLoc = { lat: la, lon: lo, acc: 15 };
    renderNearbyStations();
    const rows = [...document.querySelectorAll('#nearCard .nx-row')];
    const i = rows.findIndex(r => r.querySelector('.nx-name')?.textContent === '汐科');
    return { i, names: rows.map(r => r.querySelector('.nx-name')?.textContent) };
  }, [lat, lon]);

  const r1 = await open(xikeMid[0], xikeMid[1]);
  ok('F1 站在汐科月台中點，附近車站列得出汐科', r1.i >= 0, r1.names.slice(0, 4).join('、'));
  if (r1.i >= 0) {
    const btn = page.locator('#nearCard .nx-row').nth(r1.i).locator('.nx-ck');
    ok('F2 蓋章鈕不是淡的（.far ⇒ 使用者看到的是「走不到」）',
      !(await btn.getAttribute('class') || '').includes('far'), await btn.getAttribute('class'));
    await btn.click();
    const st = await page.evaluate(() => JSON.parse(localStorage.getItem('trainmap-checkins-v1') || '{}'));
    const e = st.st && (st.st['tra_sched|汐科'] || Object.entries(st.st).find(([k]) => k.endsWith('|汐科'))?.[1]);
    ok('F3 點下去章真的寫進 localStorage，狀態＝到訪', !!e && e.s === 'visit', JSON.stringify(e || null));
  }
  // 控制組：站在月台外 400m，同一顆鈕必須是淡的、點了不會寫章
  const [a, b] = xike;
  const outside = [a[0] + (a[0] - b[0]) * 1.2, a[1] + (a[1] - b[1]) * 1.2];
  const r2 = await open(outside[0], outside[1]);
  if (r2.i >= 0) {
    const btn = page.locator('#nearCard .nx-row').nth(r2.i).locator('.nx-ck');
    ok('F4 控制組：站在月台外 400m，蓋章鈕是淡的',
      (await btn.getAttribute('class') || '').includes('far'), await btn.getAttribute('class'));
    await btn.click();
    const st = await page.evaluate(() => JSON.parse(localStorage.getItem('trainmap-checkins-v1') || '{}'));
    ok('F5 控制組：點了不會寫進章', !st.st || !Object.keys(st.st).some(k => k.endsWith('|汐科')), JSON.stringify(st.st || {}));
  } else ok('F4/F5 控制組：月台外仍列得出汐科（5km 內）', false, '沒列到，無法驗控制組');
}

ok('G1 全程零 pageerror／console.error（/api 的 404/502 是本機無 .env，不計）', errs.length === 0, errs.slice(0, 3).join(' | '));
ok('G2 所有 data/*.json 都載得到', badData.length === 0, badData.slice(0, 4).join(' | '));

await browser.close();
const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
