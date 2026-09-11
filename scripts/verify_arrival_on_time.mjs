#!/usr/bin/env node
// 「車依站牌時間到站」的端到端驗證（使用者定的準確判準：站牌時間照官方,車依那個時間到站）。
//
// 作法:t 時刻記下某站的官方倒數 c 秒 ⇒ 預測 t+c 時該站會有車;等到 t+c 再看畫面上
// 那一站有沒有車。驗證時刻不重算任何位置,只問「車在不在那裡」,所以不吃同源問題。
//
// 用法: node scripts/verify_arrival_on_time.mjs [url] [取樣數]
import { chromium } from 'playwright';
import fs from 'node:fs';
// --local <index.html>：主文件餵本機這一份，API 仍走同網域正式站 ⇒ 同一份即時資料只換程式碼
const li = process.argv.indexOf('--local');
const LOCAL = li > 0 ? process.argv[li + 1] : null;
// 同樣用「找」不用「位置」：舊寫法 process.argv[2] 在 `--local x` 之後會拿到旗標名 `--local`,
// Playwright 直接報 Cannot navigate to invalid URL(2026-08-18 踩到)。
const URL = process.argv.slice(2).find(a => /^https?:\/\//.test(a)) || 'https://railisland.tw/';
// 🔴 參數用「找」不用「位置」：舊寫法 Number(process.argv[3]) 在 `--local x` 之後拿到旗標名,
// 得到 NaN,slice(0,NaN) 回空陣列 ⇒ 印出「分母為 0」的假故障(2026-08-18 連中兩次)。
// 取不到合法值就直接失敗,不要靜默用 NaN。
const _args = process.argv.slice(2).filter((a, i, arr) => a !== '--local' && arr[i - 1] !== '--local');
const WANT = Number(_args.find(a => /^\d+$/.test(a)) || 8);
if (!Number.isInteger(WANT) || WANT <= 0) { console.log('❌ 取樣筆數參數不合法:', WANT); process.exit(2); }
const NEAR_M = 250;          // 判「在這一站」的半徑。站距最短約 600m,250m 不會跨到鄰站
const WIN_LO = 45, WIN_HI = 200;  // 只取這個倒數區間:太短來不及佈署觀測,太長期間會換班次

// 🔴 視窗要夠大:下面要求「整張北捷網都在畫面內」**而且**縮放 ≥12(見下),兩者同時成立才有分母。
// 路網跨約 0.45° 經度 × 0.35° 緯度,z12 下 1600×1200 剛好包得住(1600/256×360/4096≈0.55°)。
// 預設的 1280×720 包不住,fitBounds 只好退到 z10.8,低於畫車門檻。
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1600, height: 1200 } });
p.on('pageerror', e => console.log('  ⚠️ pageerror:', String(e).slice(0, 160)));
if (LOCAL) {
  const html = fs.readFileSync(LOCAL, 'utf8');
  await p.route(u => { const x = new globalThis.URL(u); return x.origin + x.pathname === new globalThis.URL(URL).origin + '/'; },
    r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  console.log(`（主文件改用本機 ${LOCAL}）`);
}
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 90000 });
await p.evaluate(() => { const g = GROUPS.find(x => (x.members || []).includes('mrt')); if (g) selectGroup(g); });
await p.waitForTimeout(2500);
// 🔴 視野要框住整個北捷:_trtcOfficialDisplay 只留「這一格有畫出來」的車,
// 預設視野若沒涵蓋路網,它會是空的 ⇒ 分母 0,長得跟「此刻沒車」一模一樣。
// 走適配層 window.__M(不是 window.__map)。__map 是 M.raw＝裸的 maplibregl.Map:它有 fitBounds,
// 但吃 [lng, lat],而這裡傳的是 Leaflet 慣例的 [lat, lng] ⇒ 緯度 121.3 超出 ±90,MapLibre 的 LngLat
// 建構式當場拋 Invalid LngLat latitude value,整支腳本中斷。適配層自己做 [lat,lng]→LngLat 轉換。
await p.evaluate(() => window.__M.fitBounds([[24.90, 121.30], [25.25, 121.75]], { animate: false }));
// 🔴 前置閘門:上面那行是本腳本分母的唯一來源,它要是沒生效,下面會印「分母為 0」——與「此刻真的沒車」
// 長得一模一樣。所以這裡當場把框到的視野讀回來驗一次,框歪就直接說是框歪,不要讓它偽裝成沒車。
const view = await p.evaluate(() => { const c = window.__M.getCenter();
  return { lat: +c.lat.toFixed(4), lng: +c.lng.toFixed(4), z: +window.__M.getZoom().toFixed(2) }; });
// 🔴 光是「框對地方」還不夠:捷運的列車在 index.html:11105 是 `showTrain = z >= 12`,z 低於 12
// 一台都不畫 ⇒ _trtcOfficialDisplay 一樣是空的,而症狀與框錯地方、與「此刻沒車」三者完全同形
// (實測:同一份正式站資料,z10.84 時 disp=0、z12 時 disp=101)。fitBounds 只保證包得住、不保證
// 夠近,所以這裡把不足的補到門檻上;視窗已放大到 z12 仍包得住全網,補上去不會漏掉邊緣的車。
const MIN_DRAW_Z = 12; // index.html:11105 showTrain = z >= 12
if (view.z < MIN_DRAW_Z) {
  await p.evaluate(z => window.__M.setView([25.075, 121.525], z, { animate: false }), MIN_DRAW_Z);
  await p.waitForTimeout(1500);
  Object.assign(view, await p.evaluate(() => { const c = window.__M.getCenter();
    return { lat: +c.lat.toFixed(4), lng: +c.lng.toFixed(4), z: +window.__M.getZoom().toFixed(2) }; }));
}
const framed = view.lat > 24.9 && view.lat < 25.25 && view.lng > 121.3 && view.lng < 121.75 && view.z >= MIN_DRAW_Z;
console.log(`視野:中心 ${view.lat},${view.lng} z${view.z}${framed ? '(北捷路網範圍內、已達畫車門檻)' : ''}`);
if (!framed) { console.log(`❌ 視野沒有框到北捷路網或縮放低於畫車門檻 z${MIN_DRAW_Z},分母必然為 0,下面的結果一律不算數`); await b.close(); process.exit(2); }
// 🔴 等「完成訊號」不等固定秒數:_trtcOfficialDisplay 不是每一影格重算,而是**下一次名冊輪詢落地**
// 時才連同位置一起寫進去(實測:z 已經是 12、名冊也有 106 台,但名冊收到 12 秒時 disp 仍是 0,
// 下一份名冊一到就跳到 103)。原本固定等 3 秒,等於拿「剛好沒跨過輪詢邊界」當「此刻沒車」。
await p.waitForFunction(() => typeof _trtcOfficialDisplay !== 'undefined' && _trtcOfficialDisplay.size > 0,
  null, { timeout: 30000 }).catch(() => {});
const drawn = await p.evaluate(() => _trtcOfficialDisplay.size);
if (!drawn) { console.log('❌ 等了 30 秒(>一個名冊輪詢週期)畫面上仍然一台名冊車都沒有,分母為 0 的原因在這裡,不是「此刻沒車」'); await b.close(); process.exit(2); }
console.log(`畫面上名冊車 ${drawn} 台`);

// 站牌倒數的唯一來源:名冊車的 timeline(產品就是拿它顯示站牌秒數的官方值)
const pick = () => p.evaluate(({ lo, hi }) => {
  const now = Date.now() / 1000, out = []; let skippedTerminal = 0;
  for (const [key, v] of _trtcOfficialDisplay) {
    const lnId = key.split('|')[0], vid = key.slice(lnId.length + 1);
    const veh = ((state.trtcOfficialRoster || {}).vehicles || []).find(x => String(x.vehicleId) === vid);
    if (!veh || !Array.isArray(veh.timeline)) continue;
    for (const item of veh.timeline) {
      const eta = Number(item.arrEpoch) - now;
      if (!(eta >= lo && eta <= hi)) continue;
      // 終點站到站後車依契約就被拿掉(使用者裁示「到終點站車子就拿掉」),
      // 那一刻本來就不該有車,拿它當「沒準時」是判準錯不是產品錯。
      if (item.terminal) { skippedTerminal++; continue; }
      out.push({ key, lnId, vid, stationIdx: Number(item.to), etaSec: Math.round(eta),
        dueEpoch: Number(item.arrEpoch) });
      break;
    }
  }
  return { out, skippedTerminal };
}, { lo: WIN_LO, hi: WIN_HI });

const picked = await pick();
let cands = picked.out;
// 每條線最多取 2 筆,避免整批集中在同一條線
const byLine = new Map();
cands = cands.sort((a, c) => a.etaSec - c.etaSec).filter(x => {
  const n = byLine.get(x.lnId) || 0; if (n >= 2) return false;
  byLine.set(x.lnId, n + 1); return true;
}).slice(0, WANT);

if (!cands.length) {
  const why = await p.evaluate(() => {
    const now = Date.now() / 1000;
    const vs = ((state.trtcOfficialRoster || {}).vehicles || []);
    const etas = vs.flatMap(v => (v.timeline || []).map(t => Math.round(Number(t.arrEpoch) - now)))
      .filter(Number.isFinite).sort((a, c) => a - c);
    return { display: _trtcOfficialDisplay.size, vehicles: vs.length, withTimeline: vs.filter(v => (v.timeline || []).length).length,
      etaMin: etas[0], etaMax: etas[etas.length - 1], etaN: etas.length };
  });
  console.log(`❌ 分母為 0，什麼都沒驗到｜畫面上名冊車 ${why.display} 台、名冊 ${why.vehicles} 台` +
    `（有 timeline ${why.withTimeline} 台、共 ${why.etaN} 筆到站時刻，倒數範圍 ${why.etaMin}~${why.etaMax}s）` +
    `｜略過終點站 ${picked.skippedTerminal} 筆`);
  await b.close(); process.exit(2);
}
console.log(`取樣 ${cands.length} 筆（倒數 ${WIN_LO}-${WIN_HI} 秒）：` +
  cands.map(c => `${c.lnId}#${c.vid.slice(-8)}→站${c.stationIdx} ${c.etaSec}s`).join('、'));

const results = [];
for (const c of cands.sort((a, x) => a.dueEpoch - x.dueEpoch)) {
  const waitMs = Math.max(0, c.dueEpoch * 1000 - Date.now());
  if (waitMs > 0) await p.waitForTimeout(waitMs);
  const r = await p.evaluate(({ lnId, stationIdx, nearM, vid }) => {
    const ln = (state.lines || []).concat(state.decoLines || []).find(l => l.id === lnId);
    const st = ln && ln.stations && ln.stations[stationIdx];
    if (!st) return { err: '找不到該站' };
    const R = 6371000, rad = x => x * Math.PI / 180;
    const dist = (a, o) => { const dLat = rad(o.lat - a.lat), dLon = rad(o.lon - a.lon);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(o.lat)) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); };
    const vehOf = id => ((state.trtcOfficialRoster || {}).vehicles || []).find(x => String(x.vehicleId) === id);
    const want = vehOf(vid); const wantDir = want && want.dir;
    let self = null, best = null;
    for (const [key, v] of _trtcOfficialDisplay) {
      if (key.split('|')[0] !== lnId || !v.pos) continue;
      const id = key.slice(lnId.length + 1);
      const d = dist(st, v.pos);
      if (id === vid) self = Math.round(d);
      // 「有沒有車準時到」只認同向的車;對向車剛好停在該站與這件事無關
      const o = vehOf(id); if (!o || (wantDir && Number(o.dir) !== Number(wantDir))) continue;
      if (!best || d < best.m) best = { key: id, m: Math.round(d) };
    }
    // BR 沒有官方車號,身分是我們自己切出來的、可被重新指派 ⇒ 使用者已裁示身分不必對,
    // 只要「有車依那個時間到站」。有官方車號的線維持嚴格判準(同一台車要到)。
    const lenient = lnId === 'BR';
    const m = lenient ? (best && best.m) : self;
    // 🔴 沒到站有兩種完全不同的原因,修法相反,必須在同一刻分開量:
    //   (a) 官方自己把 ETA 往後改了(車誤點) ⇒ 站牌照官方就是對的,不是我們的錯
    //   (b) 我們畫的位置落後官方算出來的位置 ⇒ 追趕沒生效,是我們的錯
    let revisedEta = null, lagUnits = null, lagM = null;
    if (want) {
      const now = Date.now() / 1000;
      const t = (want.timeline || []).find(x => Number(x.to) === stationIdx);
      if (t) revisedEta = Math.round(Number(t.arrEpoch) - now);
      const rawPos = trtcOfficialVehiclePosition(ln, want, now);
      const op = rawPos ? trtcOfficialPositionProgress(ln, want, rawPos) : null;
      const disp = _trtcOfficialDisplay.get(`${lnId}|${vid}`);
      const dp = disp ? Number(disp.progress) : null;
      if (Number.isFinite(op) && Number.isFinite(dp)) {
        lagUnits = +(op - dp).toFixed(4);
        const step = Number(want.dir) === 2 ? 1 : -1;
        const need = trtcGapUnitsAt(ln, dp, step);          // 100m = need 個站序單位
        if (need > 0) lagM = Math.round(lagUnits * (100 / need));
      }
    }
    return { station: st.name, self, nearest: best, lenient, revisedEta, lagM,
      ok: m != null && m <= nearM };
  }, { lnId: c.lnId, stationIdx: c.stationIdx, nearM: NEAR_M, vid: c.vid });
  const ts = new Date().toTimeString().slice(0, 8);
  const tag = r.err ? '⚠️' : r.ok ? '✅' : '❌';
  console.log(`${tag} [${ts}] ${c.lnId} 站牌說 ${c.etaSec}s 後到「${r.station || '?'}」` +
    (r.err ? `　${r.err}` : `　那一刻該車距站 ${r.self == null ? '車已不在名冊' : r.self + 'm'}` +
      (r.nearest ? `（同向最近的車 ${r.nearest.m}m${r.lenient ? '←BR 用這個判' : ''}）` : '（同向無車）') +
      (r.ok ? '' : `　【那一刻官方改口說還要 ${r.revisedEta == null ? '?' : r.revisedEta}s；` +
        `我們畫的比官方位置落後 ${r.lagM == null ? '?' : r.lagM}m】`)));
  results.push({ ...c, ...r });
}
const done = results.filter(r => !r.err);
const pass = done.filter(r => r.ok).length;
console.log(`\n準時到站：${pass}/${done.length}（判準：預測時刻該車距該站 ≤${NEAR_M}m；` +
  `BR 因無官方車號改判「同向最近的車」；終點站到站不取樣，本輪略過 ${picked.skippedTerminal} 筆）`);
await b.close();
process.exit(done.length && pass === done.length ? 0 : 1);
