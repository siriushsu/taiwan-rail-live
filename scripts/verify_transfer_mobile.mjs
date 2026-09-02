#!/usr/bin/env node
// 轉乘接續:手機四寬相交掃描(Task 5)。判準寫「怎麼排」不寫「幾 px」(task-5-brief 明示):
// 斷言「接續區塊與其他常駐家具不相交」,不斷言高度/寬度上限這種會被文案長度或未來改版推翻的
// 魔術數字。360/375/414/768 四個手機寬度——這個範圍內沒有其他 CSS 斷點(唯一相關斷點是
// max-width:900px 的手機殼,四個測試寬度全部落在殼內),故不必再插中間寬度。
//
// 三個顯示實例(task-5-brief「現況」明列,都要涵蓋到):
//   #fpConn 跟隨小卡 / #fcConn 捷運班距卡 / #tcConn 手機列車卡
// 🔴 brief 原始 Step 1 範例程式碼寫 `document.querySelector('.xfer-conn')`——這個選擇器不分
// hidden、且三個容器共用同一個 class,查到的永遠是 DOM 序最前面那個(#fpConn),不管它有沒有
// 資料、不管另外兩個是不是真的在畫面上。等於「三個要涵蓋到」的三個只測了一個,另兩個連被摸到
// 都沒有。若某容器的祖先仍是 [hidden](#freqCard、.traincard 沒開 tc-sheet 時都是),
// getBoundingClientRect() 會整組收斂成 0,相交測試對零尺寸方塊恆真——全綠但沒驗到東西
// (本 repo assertion-blindspot 家族同型陷阱,見 memory)。所以本檔改成:
//   - #fpConn:followTrainNo(...)(setFollow→showFollowPanel→updateFollowPanel 同步寫入,
//     production 本尊,不繞路)
//   - #tcConn:再呼叫 openTrainSheet()(手機「列車」sheet;四個測試寬度都 <=900,body.fs 開機
//     inline script 已自動加上,state.followTrain 剛設好)——它本身不寫 tcConn,要等下一輪
//     rAF tick 的 updateFollowPanel(body.train-open 分支)才寫入,故用 waitForFunction 等
//   - #fcConn:比照 verify_transfer_pin.mjs G10 的做法——loadSystem('mrt')+state.freqFollow+
//     unhide #freqCard+直接呼叫 updateFreqCard(production 本尊渲染函式,不繞路,只是不經過
//     UI 點擊選車這一段互動——那段已由其他驗收腳本涵蓋),沿用其已核實非空的真實參數
//   每個實例測完都用 clearFollow()/clearFreqFollow() 收乾淨,不讓上一個實例的殘留面板
//   跟下一個實例搶位置、污染量測。
//
// 慣例依 task-4-context.md(硬性):自帶 node:http 靜態伺服器(不用 wrangler dev)、不用全攔式
// route(會擋掉 CDN 的 Leaflet)、語系三重釘死、關首訪教學卡、pageerror 掛勾、T0 身分自檢。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5511);
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    // ?g=nat 含 thsr_sched,loadSchedGroup 開機就會打這支——回泛用 {} 會被當成「成功但形狀不對」,
    // boot 對 sys.data.trains 疊代直接噴例外(不會像 404 那樣退回 fallbackUrl,比照
    // verify_transfer_pin.mjs/verify_transfer_transitions.mjs 同款處理)。餵真檔案內容。
    if (url.pathname === '/api/thsr-schedule') return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
    return res.end('{}');
  }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, r));

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// ── T0 目標自檢(先證明「我在驗誰」,不要驗到別的 worktree 或快取) ──────────────
const idxSrc = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const md5 = createHash('md5').update(idxSrc).digest('hex').slice(0, 12);
const localBuild = (idxSrc.match(/const BUILD = '([^']*)'/) || [])[1] || '?';
console.log(`\n目標: ${path.join(ROOT, 'index.html')}\n      md5=${md5}  BUILD=${localBuild}  ${idxSrc.split('\n').length} 行\n`);

const WIDTHS = [360, 375, 414, 768];
// 接續區塊本來就該閃避的常駐地圖家具(task-5-brief 明列)。不同顯示實例(#fpConn/#tcConn 為
// sched 模式家具,#fcConn 為 freq 模式)彼此本來就不完全共存——比方說 loadSystem('mrt') 一換到
// freq 模式,#randBtn 就依 updateSchedTools() 合法收起(隨機跟隨只對排班列車有意義)。所以每個
// 元素各自 `!el.hidden && el.offsetParent` 才納入比較,不強求四顆同時在場——但「目標容器本身
// 量到非零尺寸」這一關是每個實例都必過的硬門檻,防止祖先仍 [hidden] 時整組收斂成 0 卻誤判過關
// (見檔頭說明)。
const OTHERS = ['#statBadge', '.rec-pill', '#randBtn', '#nearBtn'];
const browser = await chromium.launch();
let firstPage = true;

for (const w of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 812 }, locale: 'zh-TW' });
  await ctx.addInitScript(() => {
    localStorage.setItem('trainmap-howto-seen', '1'); // 不關首訪教學卡,卡片會蓋住地圖擋掉後續操作
    localStorage.setItem('trainmap-language', 'zh-TW');
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE-ERR: ' + m.text()); });

  // ?g=nat 才是真參數(國家鐵路=台鐵+高鐵+林鐵,index.html:14302);?nat=1 不存在。
  await page.goto(`http://localhost:${PORT}/?lang=zh-TW&g=nat`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => {
      try { return typeof state !== 'undefined' && state.ready && !!state.transferDepartures && (state.trains || []).length > 0; }
      catch (e) { return false; }
    }, null, { timeout: 30000 });
  } catch (e) {
    console.log(`寬度 ${w} boot 未就緒,pageerror/console-error:`, errors.slice(0, 5));
    await browser.close(); server.close();
    console.log(`\n${results.filter(r => !r.pass).length + 1} 項未過`);
    process.exit(1);
  }
  if (firstPage) {
    firstPage = false;
    const servedBuild = await page.evaluate(() => typeof BUILD !== 'undefined' ? BUILD : '?');
    ok('T0 服務端 BUILD 與本機檔案一致(沒有驗到快取或別的版本)', servedBuild === localBuild, `served=${servedBuild} local=${localBuild}`);
  }

  // ── 量測:目標容器非零尺寸(防祖先仍 hidden 時整組收斂成 0 的假綠)+ 與 OTHERS 不相交 ──────
  async function measure(label, elId) {
    const r = await page.evaluate(({ elId, sels }) => {
      const box = e => { const b = e.getBoundingClientRect();
        return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
      const hit = (a, c) => !(a.r <= c.l || c.r <= a.l || a.b <= c.t || c.b <= a.t);
      const el = document.getElementById(elId);
      if (!el || el.hidden || !el.offsetParent) return { present: false };
      const me = box(el);
      const clashes = []; const checked = [];
      for (const s of sels) {
        const o = document.querySelector(s);
        if (!o || o.hidden || !o.offsetParent) continue;
        const ob = box(o);
        if (!ob.w || !ob.h) continue;
        checked.push(s);
        if (hit(me, ob)) clashes.push(s);
      }
      return { present: true, me, clashes, checked, scrollW: document.documentElement.scrollWidth, inner: innerWidth };
    }, { elId, sels: OTHERS });
    ok(`${w} ${label} 容器在場且非零尺寸(祖先沒有仍是 [hidden])`, r.present && r.me.w > 0 && r.me.h > 0, JSON.stringify(r.present ? r.me : r));
    if (!r.present || !(r.me.w > 0 && r.me.h > 0)) return;
    ok(`${w} ${label} 與其他家具不相交`, r.clashes.length === 0, `比對過 ${r.checked.join(',') || '(無在場家具)'}；相交 ${r.clashes.join(',')}`);
    ok(`${w} ${label} 沒有溢出視窗右緣`, r.me.r <= w + 1, `right=${r.me.r}`);
    ok(`${w} ${label} 頁面不橫向捲動`, r.scrollW <= r.inner, `${r.scrollW} > ${r.inner}`);
  }

  // ── 找一班「停靠站是轉乘錨點」的台鐵車,並把時鐘撥到到站前,讓 #fpConn 真的有資料 ──────────
  // 🔴 brief 原始 Step 1 範例只做「站名是否出現在任一群任一系統成員清單的扁平 Set」就直接
  // followTrainNo,完全沒有撥鐘——updateFollowPanel 只在「這班車現在(state.simSec)所在的
  // 停靠站」算 xgid,不是「這班車未來某站的名字」。找到的車在真實跟隨當下八成不在那個轉乘站
  // 附近,xgid 算出 null,#fpConn 整塊隱藏——實測四寬全部 present:false 就是這個根因(不是
  // 佈局問題,是候選車根本沒被撥到會顯示資料的時刻)。改用產品自己的查詢層
  // (transferAnchorForStop/transferConnections,已由 verify_transfer_connections.mjs 56/56
  // 獨立驗過的 oracle)在「到站前 120 秒」這個時間點確認真的有非空候選,再把 state.simSec
  // 撥到那個時刻、暫停播放,才呼叫 followTrainNo——這是 verify_transfer_transitions.mjs G0/T1
  // 同款做法,只是不需要它的 T1b/T2c 那些多時間點精度,一個乾淨時間點夠佈局掃描用。
  const found = await page.evaluate(() => {
    for (const tr of state.trains) {
      if (tr.sys !== 'tra_sched') continue;
      const stops = tr.stops;
      const last = stops[stops.length - 1];
      if (Math.max(last.arrSec, last.depSec) > 86400) continue; // 跨午夜的車不測,非本輪要測的東西
      const xsys = TRANSFER_SCHED_SYSTEM[tr.sys];
      for (let i = 1; i < stops.length - 1; i++) {
        const st = stops[i];
        if (st.stop === false || !Number.isFinite(st.arrSec)) continue;
        // 前一站要夠早到,120 秒前置量測點才不會被 nextStopInfo 誤判成還在指前一站
        if (stops[i - 1].stop !== false && stops[i - 1].arrSec > st.arrSec - 150) continue;
        const anchor = transferAnchorForStop(xsys, st);
        const gid = anchor && anchor.station ? anchor.station.transferId : null;
        if (!gid) continue;
        const at = st.arrSec - 120;
        if (at < 0) continue;
        const rows = transferConnections(gid, at, xsys);
        if (!rows || !rows.length) continue;
        state.playing = false; // 佈局掃描要精確控制 simSec,不讓真實時間在量測期間把車推過站
        state.simSec = at; state.clockAtNow = false;
        followTrainNo(tr.train, { sys: tr.sys }); // 裸全域,見 Task 4b
        return { no: tr.train, sys: tr.sys, stn: st.name, at };
      }
    }
    return null;
  });
  ok(`${w} 找到可跟的車(已撥鐘到到站前,#fpConn 確定有真實資料)`, !!found, JSON.stringify(found));

  if (found) {
    // #fpConn(跟隨小卡):followTrainNo 內的 setFollow→showFollowPanel→updateFollowPanel 同步寫入
    await measure('#fpConn(跟隨小卡)', 'fpConn');

    // #tcConn(手機列車卡):openTrainSheet() 本身不寫 tcConn,下一輪 rAF tick 的
    // updateFollowPanel(body.train-open 分支)才會寫——tick() 不受 state.playing 節流,
    // 短逾時足夠等到(pin.mjs 已驗證過這個時序)。
    await page.evaluate(() => openTrainSheet());
    try {
      await page.waitForFunction(() => {
        const el = document.getElementById('tcConn');
        return !!el && !el.hidden && el.querySelectorAll('.xfc-row').length > 0;
      }, null, { timeout: 5000 });
    } catch (e) { /* 逾時就讓下面 measure() 的「非零尺寸」斷言具名 FAIL,不吞掉 */ }
    await measure('#tcConn(手機列車卡)', 'tcConn');

    // 收乾淨:取消跟隨(連帶收掉「列車」sheet),不讓 fpConn/tcConn 殘留面板跟下面的 fcConn 搶位置。
    await page.evaluate(() => clearFollow());
  }

  // ── #fcConn(捷運班距卡):比照 verify_transfer_pin.mjs G10——loadSystem('mrt')+
  // state.freqFollow+unhide #freqCard+直接呼叫 updateFreqCard(production 本尊渲染函式)。
  // 引數沿用 pin.mjs 已核實非空的真實組合(「台北車站」經 transferAnchorNear 解到
  // gid=T-THSR-1000,nextSec=63060 下有 93 筆候選)。這個函式是純排程查詢,不吃即時時鐘,
  // 與腳本實際執行的時間無關,可放心沿用固定值。
  //
  // 🔴 實測發現(本輪除錯,非猜測):setup 與量測不能分成兩次 page.evaluate()——中間會經過
  // 一次事件迴圈,足夠讓下一個 rAF tick 跑到 updateFreqFollowCamera(index.html:10210)。
  // 它對 {ln,k} 這種班距幽靈車形狀的保險絲是「!ln.sched || f.k >= ln.n」(index.html:10239);
  // 而北捷九條線經 loadSystem('mrt') 之後實測 ln.n 恆為 0、ln._tt 恆為 true(全部已改成
  // 逐班真時刻表,見 8/3 更新紀錄「北捷列車位置改為逐班跟著官方秒級到站倒數校正」)——
  // k:0 對北捷任何一條線都是 0>=0,保險絲必定觸發,下一幀就會自動 clearFreqFollow()
  // 把 #freqCard 收隱藏(#fcConn 自己的 hidden/innerHTML 不會被動,但祖先 hidden=true 讓
  // offsetParent 收斂成 null)。pin.mjs 的 G10 測得到,是因為它在同一次 evaluate() 裡設好
  // 立刻斷言,從沒讓 rAF 有機會跑;分兩次 evaluate() 量測就會撞見這個安全網,四個寬度連續
  // FAIL、且 present:false——不是版面問題,是這個合成態撐不過一個 tick。改成 setup 與量測
  // 全部塞進同一次 evaluate()(getBoundingClientRect() 仍會強制同步 reflow,量出來的版面
  // 數字不受影響),繞開這個與版面驗收無關的競態,不改動 index.html 任何邏輯。
  const fc = await page.evaluate(({ sels }) => {
    const box = e => { const b = e.getBoundingClientRect();
      return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    const hit = (a, c) => !(a.r <= c.l || c.r <= a.l || a.b <= c.t || c.b <= a.t);
    loadSystem(state.systems.find(s => s.id === 'mrt'));
    const ln = (state.lines || []).find(l => l.id === 'BL');
    if (!ln) return { ok: false, reason: '找不到 BL 線' };
    state.freqFollow = { ln, k: 0 };
    document.getElementById('freqCard').hidden = false;
    updateFreqCard({ nextName: '台北車站', nextSec: 63060, loop: false, termName: '南港展覽館' });
    const el = document.getElementById('fcConn');
    if (!el || el.hidden || !el.offsetParent) return { ok: true, present: false };
    const me = box(el);
    const clashes = []; const checked = [];
    for (const s of sels) {
      const o = document.querySelector(s);
      if (!o || o.hidden || !o.offsetParent) continue;
      const ob = box(o);
      if (!ob.w || !ob.h) continue;
      checked.push(s);
      if (hit(me, ob)) clashes.push(s);
    }
    return { ok: true, present: true, me, clashes, checked, scrollW: document.documentElement.scrollWidth, inner: innerWidth };
  }, { sels: OTHERS });
  ok(`${w} 捷運班距卡場景就緒(loadSystem+freqFollow+updateFreqCard)`, fc.ok, JSON.stringify(fc.reason || ''));
  ok(`${w} #fcConn(捷運班距卡) 容器在場且非零尺寸(祖先沒有仍是 [hidden])`, fc.ok && fc.present && fc.me?.w > 0 && fc.me?.h > 0, JSON.stringify(fc.present ? fc.me : fc));
  if (fc.ok && fc.present && fc.me?.w > 0 && fc.me?.h > 0) {
    ok(`${w} #fcConn(捷運班距卡) 與其他家具不相交`, fc.clashes.length === 0, `比對過 ${fc.checked.join(',') || '(無在場家具)'}；相交 ${fc.clashes.join(',')}`);
    ok(`${w} #fcConn(捷運班距卡) 沒有溢出視窗右緣`, fc.me.r <= w + 1, `right=${fc.me.r}`);
    ok(`${w} #fcConn(捷運班距卡) 頁面不橫向捲動`, fc.scrollW <= fc.inner, `${fc.scrollW} > ${fc.inner}`);
  }
  await page.evaluate(() => { if (typeof clearFreqFollow === 'function') clearFreqFollow(); });

  ok(`${w} 頁面零例外`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();
  await ctx.close();
}

await browser.close();
server.close();
const bad = results.filter(r => !r.pass);
console.log(`\n總計 ${results.length - bad.length}/${results.length} 通過`);
if (bad.length) { console.log('未過:'); bad.forEach(r => console.log('  - ' + r.name + (r.detail ? '  — ' + r.detail : ''))); }
process.exit(bad.length ? 1 : 0);
