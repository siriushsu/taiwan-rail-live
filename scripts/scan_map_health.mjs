#!/usr/bin/env node
// 地圖動畫健康掃描：對任一 URL（正式站／預覽站／本機）跑一次，回報畫面上的車有沒有異常。
//
// 判準一律落在 state._freqHits ——那是畫車迴圈每一幀重建的「這台車實際畫在螢幕哪裡」，
// 不是管線算出來的中間量。08-17 稽核的教訓：量 lastShift 中位數／roster.positions
// 這類與實作同源的量，實作錯了判準會跟著一起錯，38 項全綠也看不到 4 倍超衝。
//
// 量九件事（都是使用者真的會看到的形態；編號與下面的小節一致）：
//  -1. 每日 cron（台北 09:15）有沒有跑：它一天只有一次機會、無重試無告警，掛掉會讓高鐵班表
//      停在前一天（當天新增班次看不到、取消的畫成幽靈車）。主指紋取誤點統計的 generated
//      ＝那發自己寫的時戳，故**同日**就抓得到；只看高鐵班表日期會晚一天。
//  -2. 官方即時資料源新不新：站牌倒數在純班表模式下**仍然是官方即時**，所以上游停更照樣
//      是使用者看得到的傷害。這條不依賴任何前端旗標，是純班表模式下唯一照得到上游停更的。
//   0. 名冊有沒有在換新：整包被驗證器退掉時，車會照舊時間線繼續跑（動得很順），
//      下面 1–5 全部照不到——只有 receivedEpoch 照得到（08-17 那次疊車事故的唯一證人）。
//      ⚠️ 2026-08-18 訂正：舊註解寫「正式站走純班表 ⇒ 這條恆為不適用」是**錯的**。實測正式站
//      不帶參數時 OFFICIAL_ROSTER_ENABLED / CENSUS_ROSTER_ENABLED 都是 true，這條一直有牙。
//   1. 同向疊車：同線同方向的車在畫面上重疊。對向交會是正常的，必須先分方向再算。
//   1b. 同站堆積：同一站同方向擠 3 台以上（被拖回站上的形態）。
//   2. 倒退：兩次取樣之間沿線位移為負。
//   3. 停滯：整段觀測窗完全沒動，而同線其他車有動。
//   4. 車數：與官方逐車清單比，過多（幽靈）或過少（掉車）。
//   5. 整條線不見：官方名冊說這條線有車，畫面上卻一台都沒有。
//
// 不計入離開碼的兩類（都會大聲印出來，理由寫在各自的程式碼旁）：
//   ⚠️ KNOWN_OPEN_CLUMP 列出的「已知未解、使用者裁示另案追」的線；
//   ⚠️ 上游沒給官方資料（feedMode≠official）＝環境條件，不是我們畫錯。
//
// 用法：
//   node scripts/scan_map_health.mjs [url] [--json out.json] [--gap 20]
//   TRTC_SCAN_URL=https://... node scripts/scan_map_health.mjs
// 離開碼：0 全部在門檻內；1 有超標項；2 掃描本身沒跑起來（零斷言／取不到車）。
import fs from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const URL_ARG = args.find(a => !a.startsWith('--')) || process.env.TRTC_SCAN_URL || 'https://railisland.tw/';
const JSON_OUT = (() => { const i = args.indexOf('--json'); return i >= 0 ? args[i + 1] : null; })();
const GAP_SEC = Number((() => { const i = args.indexOf('--gap'); return i >= 0 ? args[i + 1] : 20; })());

// 門檻。刻意寫成「結構性質」而不是魔術數字：疊車用車號牌的實際半寬，
// 倒退用 0（任何負位移都不該有），車數用相對比例。
// 疊車分兩級。使用者回報的症狀是「好幾台疊在同一個點」，那在物理上不可能；
// 但兩百多公尺是可能的——前車在月台停靠、後車進站前被號誌擋住就是這個量級。
// 把兩者混成一個門檻，不是漏掉真缺陷就是每四輪吵一次假警報。
const OVERLAP_BAD_M = 100;  // 物理上不可能：號誌不會讓兩台車靠這麼近 ⇒ 判缺陷
// 🔴 產品的分離守則就是把後車夾到「剛好 OVERLAP_BAD_M」，浮點運算會讓結果落在 99.999…，
// 於是 `m < 100` 對每一對被正常夾住的車都成立 ⇒ 守則越正常，這條判準叫得越大聲（08-18 實測
// 改用精確座標後第一輪就報 G|1 100m）。判準的門檻不能等於受測物的目標值，要留數值餘裕。
// 2m 是餘裕不是放寬：真疊車是「守則沒生效」，那種對子的間距是 0–70m，不會落在 98–100m。
const CLAMP_EPS_M = 2;
const OVERLAP_WARN_M = 250; // 罕見但可能（前車停靠、後車進站中）⇒ 只記警告不判缺陷
const AT_STATION_M = 60;    // 離最近車站這麼近就算「停在站上」。
// 同站疊車不能無條件豁免——使用者回報的截圖正是「好幾台疊在站附近」，而突變測試也證實
// 把校正量灌壞時，車全部被拖回站上疊成一堆（13 對），無條件豁免會讓這條判準完全沒有牙。
// 同向同站最多 2 台（一台停靠、一台進站中）；3 台以上物理上不可能。
const AT_STATION_MAX_PER_STOP = 2;   // 同一站同一方向的車數上限
const AT_STATION_MAX_PAIRS = 3;      // 全系統同站疊車對數上限（正常營運實測 0–1 對）

// 🔴 已知未解、且使用者已裁示「另案追」的缺陷 → 印成「已知未解」而不計入離開碼。
// 理由不是「數字小可以當噪音」（那是明文禁止的），而是這支每小時跑一次：
// 一條永遠紅的判準會讓它對「新出現的問題」永久失去通報能力。
// 例外只按「線 × 缺陷類別」開，**不按數量**——寫死數量就是下次一改動就被推翻的魔術數字；
// 實測數字一律照原樣印出來。那條線修好就把它從這裡刪掉（留著＝繼續瞎）。
const KNOWN_OPEN_CLUMP = {
  Y: '環狀線不在逐車名冊（census）覆蓋內、走舊帳本路徑。08-17 把北捷位置切回官方即時後，'
    + '這個既有缺陷被曝光（同一份程式碼在 ?census=0 純班表模式下實測 0 對）。使用者裁示「另案追」。',
};
const knownOpenClump = g => KNOWN_OPEN_CLUMP[String(g).split('|')[0]];
// 刻意不用像素門檻：像素會隨縮放漂移，而這支掃描是把整個路網框在一個畫面裡跑的，
// 密集路段（文湖線彎道）沿線 500 公尺在畫面上本來就只有幾個像素。
// 🔴 這個 15 公尺是「投影抖動」的估值，但抖動的真實下限是**一個像素**：實測掃描器視野
// 每像素 69 公尺 ⇒ 一像素的整數座標抖動就是 69m 的假倒退（實測 `BL#…hw:216 −69m`
// 正好等於一像素）。門檻必須從當下量到的解析度推導，不能寫死公尺數，否則這條判準
// 在報雜訊、每小時排程會狼來了。下面用 max(BACKWARD_M, 2×每像素公尺)。
const BACKWARD_M = 15;      // 地板值；實際門檻見 backCap（取 max(此值, 2×每像素公尺)）
const STALL_RATIO = .9;     // 幾乎整條線的車都沒動才算凍結。停站本身就會讓車不動，
                            // 門檻抓一半會把「正常停站」誤判成凍結（實測 8 秒觀測窗下 BL 10/19 全在停站）
const MIN_GAP_SEC = 20;     // 觀測窗要長過停站時間，否則「沒動」分不出是停站還是凍結

let problems = [];
const note = (level, msg, detail) => problems.push({ level, msg, detail });
// 有專屬 console.log 的判準用 note()；沒有的用 noteLoud()——否則收尾只印「1 項超標」，
// 看不出是哪一項，要開 JSON 才知道（Codex 08-17 複審指出的「日誌太安靜」）。
const noteLoud = (level, msg, detail) => {
  console.log(`${level === 'bad' ? '❌' : level === 'warn' ? '⚠️' : 'ℓ'} ${msg}`);
  note(level, msg, detail);
};

const SAMPLE = () => {
  const hits = state._freqHits || [];
  const out = [];
  for (const h of hits) {
    const ln = h.ln; if (!ln) continue;
    const tr = h.tr;
    // 沿線里程：用畫面座標反投影回線形，這是與繪製同一組座標，但比對的是
    // 「同一台車前後兩次」，不涉及與別條管線的真值比較，所以不受同源問題影響。
    let d = null, nearM = null, nearIdx = -1, dsrc = 'px';
    try {
      // 🔴 名冊車優先讀「產品自己寫下的最終浮點座標」，不要用畫面整數像素反投影。
      // 疊車門檻 100m 在這支掃描的視野只有 1.45 像素 ⇒ 像素來源帶 ±35m 量化誤差：
      // 分離守則就是把後車夾到剛好 100m，那個真值被反推回來會長成 64–98m，
      // 於是「守則正常運作」與「真疊車」在這條判準底下完全同形（08-18 實測 G 69m、
      // Y 64/69/92m 全是這樣來的，同一刻直接量沿線里程都是 100m）。
      // `_trtcOfficialDisplay` 是每格繪製後寫回的最終位置（含分離守則夾過的結果），純讀不改。
      // 🔴 但這個來源靠一個不變式：「產品寫進 _trtcOfficialDisplay 的就是它畫出來的」。
      // 若哪天有人在寫入之後又動了位置，這支掃描會安靜地量到舊值、全線報綠。
      // 所以浮點值一律回投影成畫面座標與真正畫出來的 h.x/h.y 對一次；對不上就退回像素並記錄，
      // 那本身就是要吵的缺陷（判準不能建立在沒被驗證的不變式上）。
      let ll = null;
      if (h.vehicleId && typeof _trtcOfficialDisplay !== 'undefined') {
        const rec = _trtcOfficialDisplay.get(`${ln.id}|${h.vehicleId}`);
        if (rec && rec.pos && Number.isFinite(rec.pos.lat) && Number.isFinite(rec.pos.lon)) {
          const cp = map.latLngToContainerPoint([rec.pos.lat, rec.pos.lon]);
          if (Math.hypot(cp.x - h.x, cp.y - h.y) <= 2) { ll = { lat: rec.pos.lat, lng: rec.pos.lon }; dsrc = 'float'; }
          else dsrc = 'mismatch';
        }
      }
      if (!ll) ll = map.containerPointToLatLng([h.x, h.y]);
      const pr = projectOntoShape(ln, ll.lat, ll.lng);
      d = pr && pr.d != null ? pr.d : null;
      if (d != null && ln.stations) {
        let best = Infinity, bi = -1;
        ln.stations.forEach((st, i) => {
          if (st && st.d != null) { const gap = Math.abs(st.d - d); if (gap < best) { best = gap; bi = i; } }
        });
        nearM = best * 1000; nearIdx = bi;
      }
    } catch (e) {}
    // 方向。三種畫車路徑各有各的 hit 形狀，取不到就是 0（後面的位移判定會跳過）：
    //   班表車 {ln,tr}／示意車 {ln,k}／名冊車 {ln,vehicleId}（?census=1 與 ?officialroster=1 走這條）
    let dir = 0;
    try {
      if (h.vehicleId) {
        const v = ((state.trtcOfficialRoster || {}).vehicles || [])
          .find(x => String(x.vehicleId) === String(h.vehicleId));
        if (v) dir = v.dir === 2 ? 1 : -1;   // 統一成「里程遞增為 +1」
      } else if (tr && ln.stations) {
        dir = Math.sign(ln.stations[tr[tr.length - 2]].d - ln.stations[tr[0]].d) || 0;
      }
    } catch (e) {}
    out.push({
      // 名冊車的身分是 vehicleId（hit 裡沒有 tr／k，用舊寫法會讓整條線塌成同一個 key，
      // 位移與疊車判定全部失效）
      key: h.vehicleId ? `${ln.id}#${h.vehicleId}` : (tr ? `${ln.id}#tr${(ln._tt || []).indexOf(tr)}` : `${ln.id}#k${h.k}`),
      line: ln.id, abbr: ln.abbr, dir, x: h.x, y: h.y, d, dsrc, nearM, nearIdx,
      stations: Array.isArray(ln.stations) ? ln.stations.length : null,
      sys: typeof freqSysIdOf === 'function' ? freqSysIdOf(ln) : null,
    });
  }
  const R = state.trtcOfficialRoster || {};
  // 每像素幾公尺：疊車判準的公尺值是「畫面整數座標→反投影→沿線里程」推回來的，
  // 所以它的解析度上限就是一個像素。這個值必須跟著回報，否則公尺值會被過度解讀
  // （實測 zoom 11／69m 一像素 ⇒ 100m 門檻只有 1.45 像素、公尺值帶 ±35m 量化誤差；
  //  而在沒有 fitBounds 的全台視野下是 1121m 一像素 ⇒ 同一套判準完全沒有解析度）。
  let mpp = null;
  try { mpp = map.distance(map.containerPointToLatLng([100, 300]), map.containerPointToLatLng([101, 300])); }
  catch (e) {}
  return { at: Date.now(), simSec: state.simSec, zoom: map.getZoom(), n: out.length, hits: out, mpp,
    censusFallbackLines: R.censusFallbackLines || null,
    // 名冊本身的新鮮度：整包被驗證器退掉時車還是會照舊時間線往前跑，位置全綠、
    // 卻是在演一份舊快照（2026-08-17 實測連續 148 秒）。這兩個值是唯一照得到的證據。
    rosterFeed: R.feedMode || null, rosterRecv: R.receivedEpoch || null,
    // 🔴 被擋的原因存在**兩個地方**，只讀一個會在冷啟動時全瞎：
    //    已有一份好名冊時被擋 ⇒ trtcOfficialRosterHold() 寫 state.trtcOfficialRosterHold；
    //    還沒有名冊（或已在 outage）時被擋 ⇒ 走 trtcOfficialRosterOutage()，原因寫在
    //    state.trtcOfficialRoster.reason，而 trtcOfficialRosterHold 從頭到尾不會被設。
    //    2026-08-17 的 rosterStale 突變就是這樣連三輪假綠：整包從第一輪就被退 ⇒ 永遠沒有
    //    好名冊 ⇒ 永遠走 outage 那條 ⇒ 判準讀不到 'malformed'，把它當成上游斷訊放行。
    rosterReason: R.reason || null,
    rosterN: (R.vehicles || []).length,
    // 名冊路徑沒啟用時「沒有名冊」是正常的，不是缺陷 ⇒ 判準要先看這顆旗標。
    rosterEnabled: typeof OFFICIAL_ROSTER_ENABLED !== 'undefined' ? !!OFFICIAL_ROSTER_ENABLED : null,
    rosterHold: state.trtcOfficialRosterHold
      ? { reason: state.trtcOfficialRosterHold.reason, epoch: state.trtcOfficialRosterHold.epoch } : null };
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
await ctx.addInitScript(() => {
  localStorage.setItem('trainmap-howto-seen', '1');
  localStorage.setItem('trainmap-appearance', 'light');
});
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message).slice(0, 200)));

console.log(`【掃描】${URL_ARG}`);
await page.goto(URL_ARG, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 90000 });

// 切到捷運群組並框到整個大台北，否則 _freqHits 只收視野內的車、分母會無聲縮水
const switched = await page.evaluate(() => {
  const g = (typeof GROUPS !== 'undefined' ? GROUPS : []).find(x => (x.members || []).includes('mrt'));
  if (g) selectGroup(g);
  return g ? g.id : null;
});
await page.waitForTimeout(2500);
await page.evaluate(() => map.fitBounds([[24.90, 121.30], [25.25, 121.75]], { animate: false }));
await page.waitForTimeout(3000);

if (GAP_SEC < MIN_GAP_SEC)
  noteLoud('warn', `觀測窗 ${GAP_SEC}s 短於停站時間，凍結判定不可靠`, { MIN_GAP_SEC });
const s1 = await page.evaluate(SAMPLE);
await page.waitForTimeout(GAP_SEC * 1000);
const s2 = await page.evaluate(SAMPLE);

// 官方逐車清單當車數對照（獨立來源，不經我們的名冊）
let official = null;
try {
  const base = new URL(URL_ARG); base.pathname = '/api/trtc-live'; base.search = '';
  const live = await (await fetch(base.href, { headers: { 'cache-control': 'no-cache' } })).json();
  const feed = live.trains || [];
  // 逐線車數也留下來。2026-08-17 踩到:名冊來源換成官方逐車清單時,那份清單只涵蓋北捷
  // (高運量＋文湖線),環狀線與兩條支線一台都沒有 ⇒ 整份名冊換掉就讓那三條線整條消失,
  // 而總車數只掉 17 台、疊車倒退全綠,四項判準沒有一項會紅。整條線不見必須自己成為一條判準。
  // 分母只算「會動的車」:停在終點站的車依裁示本來就不畫(到終點就收車),把它們算進去
  // 會讓兩條支線(小碧潭、新北投)每次都假紅——那是兩站區間車,多數時間就停在端點,
  // 實測 G_XBT／R_XBT 名冊上各 2 台全是 terminal、在跑的 0 台。
  const bpv = (live.boardPos?.vehicles || []).filter(v => !v.terminal);
  const byLine = {};
  for (const v of bpv) byLine[v.line] = (byLine[v.line] || 0) + 1;
  official = { hw: feed.filter(t => t.sys === 'hw').length, br: feed.filter(t => t.sys === 'br').length,
    roster: (live.boardPos?.vehicles || []).length, running: bpv.length, byLine, age: Math.round(Date.now() / 1000 - (live.boardPos?.sourceRevision || 0)) };
} catch (e) { official = { error: e.message }; }

// 每日 cron（台北 09:15 那發）到底有沒有跑。
// 🔴 2026-08-17 事故：那發掛掉 ⇒ 高鐵班表停在前一天（16 班看不到＋41 班畫成幽靈車）、
//    台鐵誤點統計停更，而**沒有任何機制會告訴我們**——靠使用者回報「有 1504 高鐵，地圖上沒有」
//    才發現。第二發 `15 4 * * *` 是 owner 刻意停用的（不得自行加回），所以一天只有一次機會、
//    失敗無重試無告警。這裡補的就是那個缺掉的告警。
// 為什麼取 `/api/delay-stats` 的 `_meta.generated` 當主指紋：它是**那發 cron 自己寫的時戳**，
//    掛掉當天就對不上 ⇒ 同日抓到。只驗高鐵班表的 `date` 會晚一天才顯形（ingest 抓「今天＋明天」，
//    所以今天掛掉要到明天才見底）。`?date=` 參數上游忽略，問不到明天，故只能這樣拆。
let daily = null;
try {
  const at = u => { const b = new URL(URL_ARG); b.pathname = u; b.search = 'cb=' + Date.now(); return b.href; };
  const get = async u => (await fetch(at(u), { headers: { 'cache-control': 'no-cache' } })).json();
  const [ds, thsr, tb] = await Promise.all([
    get('/api/delay-stats').catch(e => ({ _err: e.message })),
    get('/api/thsr-schedule').catch(e => ({ _err: e.message })),
    get('/api/today-board').catch(e => ({ _err: e.message })),
  ]);
  daily = {
    statsGen: ds?._meta?.generated || null,          // 那發 cron 的直接指紋
    statsRange: ds?._meta?.date_range || null,
    thsrDate: thsr?.date || null,                    // 20260817 這種緊湊格式
    thsrServed: thsr?.served_date || null,           // 有值＝退回舊日鍵（本身就是健康指標）
    thsrN: (thsr?.trains || []).length,
    boardDate: tb?.date || null,
    errs: [ds?._err, thsr?._err, tb?._err].filter(Boolean),
  };
} catch (e) { daily = { error: e.message }; }

await browser.close();

// ── 判讀 ──────────────────────────────────────────────────────────────────────
console.log(`  群組 ${switched}｜zoom ${s2.zoom}｜第一次取樣 ${s1.n} 台、${GAP_SEC} 秒後 ${s2.n} 台`);
if (official && !official.error)
  console.log(`  官方逐車：高運量 ${official.hw} 台、文湖線 ${official.br} 台｜我們名冊 ${official.roster} 台｜資料齡 ${official.age}s`);

if (!s1.n || !s2.n) {
  console.log('❌ 畫面上一台車都沒有——掃描沒有意義，先查頁面');
  process.exit(2);
}
if (pageErrors.length) noteLoud('warn', `頁面拋錯 ${pageErrors.length} 次`, pageErrors.slice(0, 3));
// 逐車名冊模式下，某條「本該由逐車清單接管」的主線退回舊綁定器＝那條線的幽靈車風險回來了。
// 環狀線與兩條支線是預期的退回（逐車清單沒有它們），前端已經先排除掉。
// 🔴 判準寫成**條件式**（心得 34）：名冊路徑沒啟用時「退回舊綁定器」是常態不是缺陷，
//    此時判紅＝每小時假警報；啟用時它才是真缺陷，而原本只 warn＝exit 0 ⇒ 排程不會通知人。
if (!s2.rosterEnabled)
  noteLoud('info', '「退回舊綁定器」本條不適用（名冊路徑未啟用，全線本來就走舊路徑）',
    { rosterEnabled: s2.rosterEnabled, censusFallbackLines: s2.censusFallbackLines });
else if (s2.censusFallbackLines && s2.censusFallbackLines.length)
  noteLoud('bad', `這些線退回舊綁定器：${s2.censusFallbackLines.join('、')}＝那幾條線的幽靈車風險回來了`,
    s2.censusFallbackLines);

// -1. 每日 cron（台北 09:15）有沒有跑。詳細動機見上面 daily 的抓取註解。
const CRON_TW_HOUR = 9;            // wrangler.jsonc 的 `15 1 * * *`（UTC）＝台北 09:15
{
  const twDay = ms => new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });   // YYYY-MM-DD
  const today = twDay(Date.now());
  const twHour = Number(new Date().toLocaleString('en-GB',
    { timeZone: 'Asia/Taipei', hour: '2-digit', hour12: false }));
  // 只有在那發 cron 的預定時刻**過了一小時**之後才要求「必須是今天」——否則每天 06–09 點的
  // 掃描都會因為「今天那發還沒跑」而假紅。這個門檻是從 cron 時刻推導的，不是手打的魔術數字。
  const due = twHour >= CRON_TW_HOUR + 1;
  const compact = d => (d || '').replace(/-/g, '');
  if (!daily || daily.error) noteLoud('warn', `每日 cron 哨兵抓不到資料（${daily?.error || '無回應'}）`, daily);
  else if (daily.errs.length) noteLoud('warn', `每日 cron 哨兵有端點失敗：${daily.errs.join('；')}`, daily);
  else {
    const statsDay = daily.statsGen ? twDay(Date.parse(daily.statsGen)) : null;
    const stale = [];
    if (statsDay !== today) stale.push(`誤點統計 generated=${statsDay || '無'}`);
    if (compact(daily.thsrDate) !== compact(today)) stale.push(`高鐵班表 date=${daily.thsrDate || '無'}`);
    if (daily.thsrServed) stale.push(`高鐵班表退回舊日鍵 served_date=${daily.thsrServed}`);
    if (compact(daily.boardDate) !== compact(today)) stale.push(`今日看板 date=${daily.boardDate || '無'}`);
    const detail = { today, twHour, due, ...daily };
    if (!stale.length)
      noteLoud('info', `每日 cron 已跑（誤點統計 ${statsDay}、高鐵班表 ${daily.thsrDate}／${daily.thsrN} 班、` +
        `今日看板 ${daily.boardDate}）`, detail);
    else if (!due)
      noteLoud('info', `每日 cron 這些還是舊值，但台北 ${twHour} 點還沒過 ${CRON_TW_HOUR + 1} 點` +
        `＝今天那發還沒跑，本條先不判：${stale.join('、')}`, detail);
    else
      noteLoud('bad', `每日 cron（台北 ${CRON_TW_HOUR}:15 那發）看起來沒跑成功：${stale.join('、')}。` +
        '⚠️ 它沒有第二發、沒有重試、沒有其他告警；高鐵班表過期會讓當天新增班次看不到、' +
        '取消的班次畫成幽靈車。手動補跑法見 memory daily-cron-single-run-silent-failure', detail);
  }
}

// -2. 官方即時資料源本身新不新（站牌倒數的來源）。
// 🔴 這條與第 0 條「名冊有沒有換新」的差別：第 0 條量的是**我們的名冊**（旗標關掉時才不適用，
//    正式站現況是開的）；這條量的是**上游站牌倒數本身**，不依賴任何前端旗標 ⇒ 旗標怎麼設定
//    都照得到上游停更，而上游停更是使用者看得到的傷害。
const FEED_WARN_SEC = 300;         // 官方 15–60 秒一輪；五分鐘＝短暫斷訊（常態，屬環境條件）
const FEED_BAD_SEC = 1800;         // 半小時＝已經不是短暫斷訊，站牌倒數在騙人
{
  if (!official || official.error)
    noteLoud('warn', `官方即時資料源抓不到（${official?.error || '無回應'}）`, official);
  else if (!(official.age >= 0) || !Number.isFinite(official.age))
    noteLoud('bad', '官方即時資料源沒有 sourceRevision，無法判斷它新不新', official);
  else if (official.age > FEED_BAD_SEC)
    noteLoud('bad', `官方即時資料源 ${Math.round(official.age / 60)} 分鐘沒更新（上限 ` +
      `${FEED_BAD_SEC / 60} 分）＝車站倒數在騙人`, { age: official.age });
  else if (official.age > FEED_WARN_SEC)
    noteLoud('warn', `官方即時資料源 ${official.age} 秒沒更新（>${FEED_WARN_SEC}s）＝上游短暫斷訊，` +
      '屬環境條件不計入離開碼', { age: official.age });
  else
    noteLoud('info', `官方即時資料源 ${official.age} 秒前更新`, { age: official.age });
}

// 0. 名冊本身有沒有在換新。
// 🔴 這條是 2026-08-17 補的：支線車 run=0 讓驗證器整包退掉 payload，車照舊時間線繼續跑
//    ⇒ 疊車、倒退、凍結、車數、整條線不見這五條全綠了 148 秒，因為它們量的都是「畫面上的車
//    動不動」，而演一份舊快照的車動得非常順。名冊的 receivedEpoch 是唯一照得到的證據。
const ROSTER_STALE_SEC = 120;      // 官方 15–60 秒一輪；兩分鐘沒換新＝整包被退或上游真的斷了
{
  const ageSec = s2.rosterRecv ? Math.round((s2.at - s2.rosterRecv * 1000) / 1000) : null;
  const held = s2.rosterHold ? s2.rosterHold.reason : null;
  // 兩個來源取聯集：feedMode 不是 official 時，原因在 roster.reason 上（見 SAMPLE 的註解）
  const heldReason = held || (s2.rosterFeed !== 'official' ? s2.rosterReason : null);
  if (!s2.rosterEnabled)
    noteLoud('info', '官方名冊路徑未啟用（純班表模式），本條不適用', { rosterEnabled: s2.rosterEnabled });
  // 🔴 **先看 hold 原因，再看 feedMode**——順序反了會把牙齒拔掉：整包被退（malformed）若從第一輪
  //    就發生，`state.trtcOfficialRoster` 根本沒建立過 ⇒ feedMode 是 null ⇒ 會掉進下面那條
  //    「上游斷訊」的警告而放行（2026-08-17 實測踩到：rosterStale 突變因此以 exit 0 通過）。
  //    只有 `feed-outage` 是環境條件，其餘任何 hold 原因都是我們這邊的管線問題。
  else if (heldReason && heldReason !== 'feed-outage')
    noteLoud('bad', `官方名冊被前端擋掉（${heldReason}）＝這一輪的官方資料沒套上，` +
      '畫面在演舊快照或整條線沒車', { heldReason, held, rosterReason: s2.rosterReason,
      rosterFeed: s2.rosterFeed, rosterN: s2.rosterN, ageSec });
  // 上游真的沒給官方資料是**環境條件不是我們畫錯**——每小時排程若為此變紅，就會在每次北捷／TDX
  // 斷訊時發假警報，久了整支巡檢就沒人看了（同族教訓見 memory [[trtc-outage-badge-false-alarm]]：
  // 徽章量的是「我手上名冊多舊」不是「上游掛沒掛」）。站內本來就有斷訊徽章負責告知使用者，
  // 這裡只要大聲印出來、並明說這一輪驗不到什麼。
  else if (s2.rosterFeed !== 'official')
    noteLoud('warn', `官方名冊不在 official 模式（${s2.rosterFeed}${heldReason ? `／${heldReason}` : ''}）＝上游這輪` +
      '沒給官方位置。屬環境條件不計入離開碼；代價是這一輪驗不到「名冊有沒有換新」',
      { rosterFeed: s2.rosterFeed, rosterN: s2.rosterN, held });
  else if (ageSec == null)
    noteLoud('bad', '官方名冊沒有 receivedEpoch，無法判斷它有沒有換新', { rosterN: s2.rosterN });
  else if (ageSec > ROSTER_STALE_SEC)
    noteLoud('bad', `官方名冊 ${ageSec} 秒沒換新（上限 ${ROSTER_STALE_SEC}s）＝畫面在演舊快照` +
      (held ? `，最近一次被擋原因：${held}` : ''), { ageSec, held, rosterN: s2.rosterN });
  else
    noteLoud('info', `官方名冊 ${s2.rosterN} 台、${ageSec} 秒前換新` + (held ? `（曾被擋：${held}）` : ''),
      { ageSec, held, rosterN: s2.rosterN });
}

// 1. 同向疊車（先分線再分方向；對向交會是正常的）
const groups = new Map();
for (const h of s2.hits) {
  const g = `${h.line}|${h.dir}`;
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(h);
}
const clumps = [], nearPairs = [];
let atStationPairs = 0, atStationPairsReal = 0;
const stationStack = new Map();   // "line|dir@站序" → 同站疊車對數
for (const [g, arr] of groups) {
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
    const px = Math.hypot(arr[i].x - arr[j].x, arr[i].y - arr[j].y);
    const m = (arr[i].d != null && arr[j].d != null) ? Math.abs(arr[i].d - arr[j].d) * 1000 : null;
    if (m == null || m >= OVERLAP_WARN_M) continue;
    // 兩台都停在同一個車站＝正常（多月台／折返），不算疊車
    const bothAtSameStation = arr[i].nearM != null && arr[j].nearM != null &&
      arr[i].nearM < AT_STATION_M && arr[j].nearM < AT_STATION_M && arr[i].nearIdx === arr[j].nearIdx;
    if (bothAtSameStation) {
      atStationPairs++;
      if (!knownOpenClump(g)) atStationPairsReal++;
      const sk = `${g}@${arr[i].nearIdx}`;
      stationStack.set(sk, (stationStack.get(sk) || 0) + 1);
      continue;
    }
    // 兩邊都是產品浮點座標才算精確；只要有一邊靠像素反推，這個公尺值就帶 ±半像素量化誤差
    const exact = arr[i].dsrc === 'float' && arr[j].dsrc === 'float';
    const rec = { group: g, px: Math.round(px), m: Math.round(m), exact, a: arr[i].key, b: arr[j].key };
    // 精確座標才享有夾持餘裕；像素來源本來就帶 ±半像素，多扣 2m 沒有意義也不該扣
    (m < (exact ? OVERLAP_BAD_M - CLAMP_EPS_M : OVERLAP_BAD_M) ? clumps : nearPairs).push(rec);
  }
}
// 解析度自證：疊車判準用的公尺值是從整數畫面座標反投影回來的，一個像素就是它的解析度上限。
// 門檻若不到 2 個像素，公尺值只能當「相距一兩個像素」讀，不可當精確距離；
// 若連 100m 都遠小於一個像素（例如忘了 fitBounds 的全台視野），這條判準等於沒有解析度，
// 一律標成「無法判定」而不是報 0 對——報 0 對會把「量不到」講成「沒問題」。
// 名冊車已改讀產品浮點座標（見 SAMPLE 的 dsrc），那些對子完全不受像素解析度影響；
// 下面的解析度閘門只對「還有像素來源參與」的對子才有意義，全浮點時套用等於自嚇自己。
const nFloat = s2.hits.filter(h => h.dsrc === 'float').length;
const nMismatch = s2.hits.filter(h => h.dsrc === 'mismatch').length;
const nPx = s2.hits.length - nFloat;
// 不變式壞掉＝掃描的位置來源不可信，這比任何一條位置判準都嚴重，要單獨吵。
if (nMismatch)
  noteLoud('bad', `位置來源不一致：${nMismatch} 台的 _trtcOfficialDisplay 座標與實際畫出的位置差超過 2 像素` +
    '（產品在寫入顯示座標之後又動了位置？此輪這些車退回像素反投影，公尺值帶量化誤差）',
    { nMismatch, sample: s2.hits.filter(h => h.dsrc === 'mismatch').slice(0, 6).map(h => h.key) });
const mppNow = Number(s2.mpp);
const thresholdPx = Number.isFinite(mppNow) && mppNow > 0 ? OVERLAP_BAD_M / mppNow : null;
if (nPx === 0 && s2.hits.length)
  console.log(`ℓ 解析度：${nFloat} 台全部取產品最終浮點座標（非畫面像素）⇒ ` +
    `${OVERLAP_BAD_M}m 門檻不受 zoom ${s2.zoom}／每像素 ${Math.round(mppNow)}m 的量化誤差影響`);
else if (thresholdPx == null)
  noteLoud('warn', '取不到每像素公尺數，疊車公尺值的解析度未知', { mpp: s2.mpp, zoom: s2.zoom });
else if (thresholdPx < 0.5)
  noteLoud('bad', `疊車判準在此視野無解析度：zoom ${s2.zoom}／每像素 ${Math.round(mppNow)}m ⇒ ` +
    `${OVERLAP_BAD_M}m 門檻只有 ${thresholdPx.toFixed(2)} 像素。此輪疊車與同站堆積一律無法判定` +
    '（多半是忘了把視野收到目標區域）', { mpp: mppNow, zoom: s2.zoom, thresholdPx });
else
  console.log(`ℓ 解析度：zoom ${s2.zoom}／每像素 ${Math.round(mppNow)}m ⇒ ${OVERLAP_BAD_M}m 門檻＝` +
    `${thresholdPx.toFixed(2)} 像素，公尺值量化誤差約 ±${Math.round(mppNow / 2)}m` +
    `${thresholdPx < 2 ? '（門檻與解析度同一量級：公尺值只能當「相距一兩個像素」讀）' : ''}` +
    `｜其中 ${nFloat} 台取產品浮點座標不受此限、${nPx} 台仍靠像素反推`);

// 🔴 疊車要「兩次取樣都成立」才判缺陷。分離守則把後車夾到剛好 100m，資料進來時若兩台
// 已經比 100m 近，守則依設計不把後車往回拉（只凍住等前車走開）⇒ 會出現一兩輪 93-96m 的
// 瞬態，那是設計行為不是缺陷。持續存在的才是守則失效（08-18 實測單次瞬態每半小時一兩次，
// 而突變測試造出來的真疊車在兩次取樣都成立）。
const clumpKey = c => `${c.group}|${[c.a, c.b].sort().join('|')}`;
const s1Clumped = new Set();
{
  const g1 = new Map();
  for (const h of s1.hits) { const g = `${h.line}|${h.dir}`; if (!g1.has(g)) g1.set(g, []); g1.get(g).push(h); }
  for (const [g, arr] of g1) for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
    const m = (arr[i].d != null && arr[j].d != null) ? Math.abs(arr[i].d - arr[j].d) * 1000 : null;
    const exact = arr[i].dsrc === 'float' && arr[j].dsrc === 'float';
    if (m != null && m < (exact ? OVERLAP_BAD_M - CLAMP_EPS_M : OVERLAP_BAD_M))
      s1Clumped.add(`${g}|${[arr[i].key, arr[j].key].sort().join('|')}`);
  }
}
const clumpsTransient = clumps.filter(c => !s1Clumped.has(clumpKey(c)));
const clumpsBoth = clumps.filter(c => s1Clumped.has(clumpKey(c)));
const clumpsKnown = clumpsBoth.filter(c => knownOpenClump(c.group));
const clumpsReal = clumpsBoth.filter(c => !knownOpenClump(c.group));
if (clumpsTransient.length)
  console.log(`ℓ 單次取樣才出現的靠近 ${clumpsTransient.length} 對（20 秒後已解，屬守則的凍結瞬態，不判缺陷）：` +
    clumpsTransient.slice(0, 4).map(c => `${c.group} ${c.m}m`).join('、'));
console.log(`${clumpsReal.length ? '❌' : '✅'} 同向疊車（<${OVERLAP_BAD_M}m）：${clumpsReal.length} 對` +
  (clumpsReal.length ? `　例：${clumpsReal.slice(0, 4).map(c => `${c.group} ${c.m}m${c.exact ? '' : '(±像素)'}`).join('、')}`
    : `（靠近 <${OVERLAP_WARN_M}m ${nearPairs.length} 對、同站 ${atStationPairs} 對，皆屬正常範圍）`));
if (clumpsReal.length) note('bad', `同向疊車 ${clumpsReal.length} 對`, clumpsReal.slice(0, 10));
if (nearPairs.length) note('warn', `同向靠近 ${nearPairs.length} 對（<${OVERLAP_WARN_M}m）`, nearPairs.slice(0, 6));
// 同站疊車：1 對＝一停靠一進站，正常；3 台以上擠在同一站、或全系統成堆，就是被拖回站上的形態
const overStopAll = [...stationStack.entries()].filter(([, pairs]) => pairs + 1 > AT_STATION_MAX_PER_STOP);
const overStop = overStopAll.filter(([k]) => !knownOpenClump(k));
const overStopKnown = overStopAll.filter(([k]) => knownOpenClump(k));
const stationBad = overStop.length > 0 || atStationPairsReal > AT_STATION_MAX_PAIRS;
console.log(`${stationBad ? '❌' : '✅'} 同站堆積：${atStationPairsReal} 對` +
  (overStop.length ? `　超載車站：${overStop.slice(0, 4).map(([k, n]) => `${k}=${n + 1}台`).join('、')}` : '（每站最多 2 台，正常）'));
if (stationBad) note('bad', `同站堆積 ${atStationPairsReal} 對`,
  { overStop: overStop.slice(0, 6), atStationPairs: atStationPairsReal });
// 已知未解的那幾條：照原樣印出實測數字，但不計入離開碼（理由見 KNOWN_OPEN_CLUMP）
for (const [line, why] of Object.entries(KNOWN_OPEN_CLUMP)) {
  const c = clumpsKnown.filter(x => String(x.group).split('|')[0] === line);
  const s = overStopKnown.filter(([k]) => String(k).split('|')[0] === line);
  if (!c.length && !s.length) continue;
  const detail = [c.length ? `疊車 ${c.length} 對（${c.slice(0, 3).map(x => `${x.group} ${x.m}m`).join('、')}）` : '',
    s.length ? `超載車站 ${s.slice(0, 3).map(([k, n]) => `${k}=${n + 1}台`).join('、')}` : ''].filter(Boolean).join('；');
  console.log(`⚠️ 已知未解（不計入離開碼）${line}：${detail}`);
  console.log(`   ↳ ${why}`);
  note('warn', `已知未解 ${line}：${detail}`, { line, clumps: c.slice(0, 6), overStop: s.slice(0, 6) });
}

// 2. 倒退
// 解析度地板：低於兩個像素的負位移分不出是真倒退還是整數座標抖動（見 BACKWARD_M 上方註解）
const backCap = Math.max(BACKWARD_M, Number.isFinite(mppNow) && mppNow > 0 ? 2 * mppNow : 0);
const before = new Map(s1.hits.map(h => [h.key, h]));
let moved = 0, back = [], stalled = [], turned = 0;
for (const h of s2.hits) {
  const b = before.get(h.key);
  if (!b || h.d == null || b.d == null || !h.dir) continue;
  // 🔴 到終點折返：同一台車 dir 變號，兩筆之間的位移沿「新方向」看必然是大負值。
  // 這是合法行為不是倒退（08-18 實測 BR 22>23 折返為 23>23，dir 2→1，
  // 被算成 −214m）；舊版靠 138m 解析度地板把它蓋住，量準了才浮出來。
  if (b.dir && b.dir !== h.dir) { turned++; continue; }
  const delta = (h.d - b.d) * h.dir * 1000; // 公尺，沿行進方向為正
  // 門檻跟著「這台車這兩筆是怎麼量到的」走：兩筆都是產品浮點座標就沒有像素抖動，
  // 套 2×每像素的地板等於把 138m 以內的真倒退全部藏起來（守則第 3 條：絕不倒退）。
  const cap = (h.dsrc === 'float' && b.dsrc === 'float') ? BACKWARD_M : backCap;
  if (delta < -cap) back.push({ key: h.key, m: Math.round(delta), cap: Math.round(cap) });
  else if (Math.abs(delta) < 1) stalled.push(h.key);
  else moved++;
}
console.log(`${back.length ? '❌' : '✅'} 倒退：${back.length} 台（浮點座標門檻 ${BACKWARD_M}m、` +
  `像素來源門檻 ${Math.round(backCap)}m＝解析度地板）` +
  (back.length ? `　例：${back.slice(0, 4).map(b => `${b.key} ${b.m}m(門檻 ${b.cap})`).join('、')}`
    : `（${moved} 台正常前進${turned ? `、${turned} 台終點折返不計` : ''}）`));
if (back.length) note('bad', `倒退 ${back.length} 台`, back.slice(0, 10));

// 3. 停滯（同線多數不動＝疑似凍結，單台不動可能只是停站）
const stallByLine = {};
for (const k of stalled) { const ln = k.split('#')[0]; stallByLine[ln] = (stallByLine[ln] || 0) + 1; }
const totalByLine = {};
for (const h of s2.hits) totalByLine[h.line] = (totalByLine[h.line] || 0) + 1;
// 兩站區間車（小碧潭、新北投）的常態就是兩台各停一端等發車 ⇒ 「整條線都沒動」對它們
// 恆真，不是故障訊號。線＝單一區間時，這個統計量本來就沒有意義（整條線不見那條判準
// 仍然守著它們：真的全消失照樣會紅）。
const shuttleLines = new Set(s2.hits.filter(h => h.stations != null && h.stations <= 2).map(h => h.line));
const frozen = Object.entries(stallByLine).filter(([ln]) => !shuttleLines.has(ln))
  .filter(([ln, n]) => n / (totalByLine[ln] || 1) > STALL_RATIO)
  .map(([ln, n]) => `${ln} ${n}/${totalByLine[ln]}`);
console.log(`${frozen.length ? '❌' : '✅'} 整線凍結：${frozen.length ? frozen.join('、') : '無'}（單台停站 ${stalled.length} 台，正常）`);
if (frozen.length) note('bad', `疑似整線凍結：${frozen.join('、')}`);

// 4. 車數（只對北捷比；官方逐車是獨立來源）
if (official && !official.error) {
  // 🔴 分子分母必須對齊：官方逐車清單是「臺北捷運」的，只涵蓋高運量與文湖線。
  // 環狀線（新北捷運公司）與小碧潭／新北投兩條支線它一台都沒有，把它們算進分子
  // 會讓比值天生虛高（實測量到 112%），上界再怎麼收都是虛的。
  const censusCovered = h => h.sys === 'mrt' && h.line !== 'Y' && !(h.stations != null && h.stations <= 2);
  const drawnTrtc = s2.hits.filter(censusCovered).length;
  const expect = official.hw + official.br;
  const ratio = expect ? drawnTrtc / expect : 0;
  // 下界寬、上界緊，兩邊的理由不對稱：
  //   少畫有一堆正當理由——停在終點站的依裁示本來就不畫（實測每輪約 5 台）、共線段真歧義
  //   解不出的 1–3 台、剛折返還沒配到方向的。實測正式站 83%、census 85%，取 .7 留餘裕；
  //   而「逐線流失」由第五條判準（整條線不見）接手，那條比一個總量比值敏感得多。
  //   多畫則沒有正當理由——分子分母對齊之後，畫面上不該出現官方沒說的車，所以上界收到
  //   1.1（只留給「官方那份比畫面舊幾秒」的抖動）。Codex 複審指出舊的 1.6 讓 59 台幽靈車
  //   仍全綠，那是對的。
  const ok = ratio >= .7 && ratio <= 1.1;
  // 分子的組成也印出來——「兩邊對齊」是這條判準的前提，不可以只寫在註解裡靠信任
  const numByLine = {};
  for (const h of s2.hits) if (censusCovered(h)) numByLine[h.line] = (numByLine[h.line] || 0) + 1;
  const excluded = {};
  for (const h of s2.hits) if (h.sys === 'mrt' && !censusCovered(h)) excluded[h.line] = (excluded[h.line] || 0) + 1;
  console.log(`${ok ? '✅' : '❌'} 車數：${drawnTrtc} 台 vs 官方逐車 ${expect} 台（${(ratio * 100).toFixed(0)}%）` +
    `　［兩邊都只算高運量＋文湖線］`);
  console.log(`     分子 ${JSON.stringify(numByLine)}`);
  console.log(`     兩邊都不算（不在官方逐車清單裡）${JSON.stringify(excluded)}`);
  if (!ok) note('bad', `車數比例異常 ${(ratio * 100).toFixed(0)}%`, { drawnTrtc, expect, numByLine });
}

// 5. 整條線不見（官方那份名冊說這條線有車，畫面卻一台都沒有）
// 真值取 API 的 boardPos.vehicles——那是完全獨立於前端狀態的來源；用前端自己的
// state.trtcOfficialRoster 當分母會與缺陷同源（名冊被換掉時它自己也沒有那條線）。
if (official && !official.error && official.byLine) {
  const drawnLines = new Set(s2.hits.map(h => h.line));
  const emptyLines = Object.entries(official.byLine)
    .filter(([id, n]) => n > 0 && !drawnLines.has(id))
    .map(([id, n]) => `${id}(官方 ${n} 台在跑)`);
  console.log(`${emptyLines.length ? '❌' : '✅'} 整條線不見：${emptyLines.length ? emptyLines.join('、') : `官方 ${Object.keys(official.byLine).length} 條線畫面上都有車`}`);
  if (emptyLines.length) note('bad', `整條線不見：${emptyLines.join('、')}`, official.byLine);
}

const bad = problems.filter(p => p.level === 'bad');
console.log(`\n${bad.length ? `❌ ${bad.length} 項超標` : '✅ 全部在門檻內'}｜警告 ${problems.filter(p => p.level === 'warn').length} 項`);
if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({ url: URL_ARG, at: new Date().toISOString(), official,
    counts: { s1: s1.n, s2: s2.n }, clumps, back, frozen, problems }, null, 1));
  console.log(`  明細 → ${JSON_OUT}`);
}
process.exit(bad.length ? 1 : 0);
