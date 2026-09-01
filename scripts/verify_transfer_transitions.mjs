#!/usr/bin/env node
// 轉乘接續:過渡態驗收(Task 4b)。規格 §6.3——整組判準最容易在「車穩穩停在兩站之間」的狀態下
// 全綠卻什麼都沒驗到:三個過渡瞬間(進站前/正在停靠/離站後)各有不同的失效方式,必須各自量。
// 慣例依 task-4-context.md(硬性):自帶 node:http 靜態伺服器、不用全攔式 route(會擋掉 CDN 的
// Leaflet)、語系三重釘死、關首訪教學卡、pageerror 掛勾、T0 身分自檢。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5507);
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
    // 高鐵動態班表:回泛用 {} 會被當成「成功但形狀不對」,boot 直接對 sys.data.trains 疊代噴例外
    // (不會像 404 那樣退回 fallbackUrl,verify_transfer_pin.mjs 同款處理)。?g=nat 含 thsr_sched,
    // loadSchedGroup 開機就會打這支,不能只回 {}。
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

// ── T0 目標自檢:先證明「我在驗誰」,不要驗到別的 worktree 或快取 ─────────────────
const idxSrc = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const md5 = createHash('md5').update(idxSrc).digest('hex').slice(0, 12);
const localBuild = (idxSrc.match(/const BUILD = '([^']*)'/) || [])[1] || '?';
console.log(`\n目標: ${path.join(ROOT, 'index.html')}\n      md5=${md5}  BUILD=${localBuild}  ${idxSrc.split('\n').length} 行\n`);

const browser = await chromium.launch();
// 語系三重釘死(①newContext locale ②③ addInitScript 裡的 localStorage)+ 關首訪教學卡 + 關省電
// 節流(渲染節流與本測試的精確 simSec 控制無關,但釘死不留隱患,比照 repo 既有慣例)。
const ctx = await browser.newContext({ locale: 'zh-TW' });
await ctx.addInitScript(() => {
  localStorage.setItem('trainmap-howto-seen', '1');
  localStorage.setItem('trainmap-language', 'zh-TW');
  localStorage.setItem('trainmap-powersave', '0');
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
  console.log('boot 未就緒,pageerror/console-error:', errors.slice(0, 5));
  await browser.close(); server.close();
  throw e;
}
const servedBuild = await page.evaluate(() => typeof BUILD !== 'undefined' ? BUILD : '?');
ok('T0 服務端 BUILD 與本機檔案一致(沒有驗到快取或別的版本)', servedBuild === localBuild, `served=${servedBuild} local=${localBuild}`);

// ── 挑一班「下一站是轉乘站」的台鐵車 ───────────────────────────────────────────
// 不用「站名是否出現在任一群任一系統成員清單」的扁平 Set(可能巧合命中別群/別系統的同名站),
// 直接呼叫產品自己的 transferAnchorForStop/transferConnections 當場核實這一站對 TRA 而言
// 真的是個轉乘錨點、且該時刻真的有非空的對向班次——比對名字精確得多。三個額外條件都是
// 為了讓 T1/T2/T3 的時間點落在乾淨、無歧義的區間裡,理由各自寫在旁邊:
const picked = await page.evaluate(() => {
  // 獨立重掃 stops 陣列算「這個時刻該顯示哪一站的接續」,刻意不呼叫 nextStopInfo/dwellInfoOf——
  // 那兩支正是待會兒 index.html 裡要檢查/修的東西,拿來算「期望值」會變成同一份推導自己驗自己
  // (只在「停靠判斷」這個環節迴避;transferAnchorForStop/transferConnections 是已由
  // verify_transfer_connections.mjs 56/56 獨立驗過的查詢層,當可信 oracle 沒有問題)。
  function resolveStopAt(stops, t) {
    for (const s of stops) if (s.stop !== false && t >= s.arrSec && t < s.depSec) return s; // 仍停靠在這一站
    for (const s of stops) if (s.stop !== false && s.arrSec > t) return s;                  // 尚未到達的第一個未過站
    return null;
  }
  function xferRowsFor(stop) {
    const anchor = stop && transferAnchorForStop('TRA', stop);
    const gid = (anchor && anchor.station && anchor.station.transferId) || null;
    const list = gid ? transferConnections(gid, stop.arrSec, 'TRA').slice(0, 2) : [];
    return { gid, rows: list.map(r => r.n), secs: list.map(r => r.sec) };
  }
  for (const tr of state.trains) {
    if (tr.sys !== 'tra_sched') continue;
    const stops = tr.stops;
    const last = stops[stops.length - 1];
    if (Math.max(last.arrSec, last.depSec) > 86400) continue; // 排除整趟跨午夜的車(schedWrapT 邊界情況,非本輪要測的東西)
    for (let i = 1; i < stops.length - 1; i++) {
      const st = stops[i];
      if (st.stop === false) continue;
      if (!Number.isFinite(st.arrSec) || !Number.isFinite(st.depSec)) continue;
      const dwell = st.depSec - st.arrSec;
      // 下限拉高到 80(原本 20):修復輪1 新增 T1b/T2c 各自要在同一階段內取兩個相隔至少 65 秒的
      // 探測點(arr+5 與 dep-5),兩點相隔要 >=60 秒才能保證「剩N分」四捨五入後的分鐘數必然不同
      // (差不到 60 秒有機率剛好落在同一個分鐘格,測不出遞減——見下方 T2c)。
      if (dwell < 80 || dwell > 300) continue;   // 太短 T2c 探測點 margin 不夠;太長不像正常轉乘站停靠
      if (st.arrSec + 700 > 86400) continue;      // T3 用 arr+600,留 100 秒緩衝不跨夜
      // T1 用 arr-120:前一個「真的會被 nextStopInfo 算到」的停靠站,到站時刻必須早於 arr-120
      // 至少 130 秒,否則 nextStopInfo(arrSec>t 判斷)在 T1 那一刻會回前一站而不是這一站。
      let priorOk = true;
      for (let j = 0; j < i; j++) {
        if (stops[j].stop === false) continue;
        if (stops[j].arrSec > st.arrSec - 130) { priorOk = false; break; }
      }
      if (!priorOk) continue;
      // Finding B 要釘住的獨立事實:這一站之後「下一個」真的會停的站是誰——純粹依 stops 陣列
      // 順序找,完全不呼叫 nextStopInfo(待驗證的正是它與 xstop 的分歧是否被誤統一),比重掃
      // 時間軸更直接可信。
      let nextName = null;
      for (let j = i + 1; j < stops.length; j++) { if (stops[j].stop !== false) { nextName = stops[j].name; break; } }
      if (!nextName || nextName === st.name) continue; // 理論上不該相同,求穩不讓巧合污染 T2b
      const at = xferRowsFor(st);
      if (!at.gid || !at.rows.length) continue;   // 這一刻這一群沒有真正的對向班次,換下一個候選
      // T2c 兩個停靠探測點固定為 arr+5 與 arr+75(見下方),第一列候選車自己的到站秒數
      // (at.secs[0])必須比 arr+75 還晚至少 60 秒,否則探測到第二點時它已經到站、掉出
      // transferConnections 的 [0,3h] 窗口,換成別班車頂替第一列——那不是「同一列在遞減」,
      // 是「換了一列」,期望值會整個算錯(踩過一次:南港/1217 候選 0841 在 arr+60 就到站,
      // dep-5 早就是負值)。
      if (at.secs[0] < st.arrSec + 135) continue;
      // 離站後(arr+600)獨立算出「正確答案該是什麼」,不是「必須跟原本不一樣」——後者在兩個
      // 相鄰轉乘大站(例如同一條高鐵線相鄰兩站)有真實機率巧合出現同一組班次,不能拿來當判準。
      // 但這裡仍然只挑「兩者確實不同」的候選:content 相同時 T3 測不出任何鑑別力,即使
      // 之後改用精確期望值比對,也應該優先挑一個真的能分辨「有沒有修好」的案例。
      const afterStop = resolveStopAt(stops, st.arrSec + 600);
      const after = xferRowsFor(afterStop);
      if (!after.gid || !after.rows.length) continue; // 換站後也要有真正的對向班次,T3 才有東西可比
      if (JSON.stringify(after.rows) === JSON.stringify(at.rows)) continue;
      return {
        no: tr.train, sys: tr.sys, stn: st.name, arr: st.arrSec, dep: st.depSec,
        gid: at.gid, expect: at.rows, expectSecs: at.secs, expectAfter: after.rows,
        nextName,
      };
    }
  }
  return null;
});
ok('G0 找到一班下一站是轉乘站的車(候選經真實函式核實,非站名巧合)', !!picked, JSON.stringify(picked));
if (!picked) {
  console.log('boot pageerror/console-error(若有):', errors.slice(0, 5));
  await browser.close(); server.close();
  console.log(`\n${results.filter(r => !r.pass).length} 項未過`);
  process.exit(1);
}

// 裸全域,不是 window.followTrainNo——repo 既有的 verify 腳本都這樣呼叫;opts.sys 是契約。
const followed = await page.evaluate(({ no, sys }) => {
  followTrainNo(no, { sys });
  state.playing = false; // 過渡態驗收要精確控制 simSec,不讓真實時間在等待期間漂移進來攪局
  return { train: state.followTrain && state.followTrain.train, panelHidden: document.getElementById('followPanel').hidden };
}, { no: picked.no, sys: picked.sys });
ok('G0b 真的跟上了挑到的那班車、跟隨面板已開', followed.train === picked.no && !followed.panelHidden, JSON.stringify(followed));

// 🔴 直接寫 simSec 一定要同時清 clockAtNow,否則下一拍會被「回到現在」蓋掉。重繪交給既有的
// rAF 迴圈(tick()→updateFollowCamera()→updateFollowPanel(),不受 state.playing 節流),不要自己呼叫 draw。
const jump = async sec => page.evaluate(s => { state.simSec = s; state.clockAtNow = false; }, sec);
const rowsOf = id => page.$$eval(`#${id} .xfc-row`, els => els.map(e => e.dataset.xn));
// Finding A 需要讀「剩 N 分」的精確分鐘數,不只是列表有沒有變。用 $$eval 取第一列再讀 .xfc-left,
// 不用 ':first-child'——innerHTML 灌進去後,容器裡實際的第一個子元素是 .xfc-h/取消釘選鈕,不是
// .xfc-row 本身,':first-child' 選不到東西。包 try/catch:若前面的 waitForRows 已經標記某探測點
// FAIL(內容不是預期的樣子甚至是空的),這裡不該讓整支腳本中止,讓它單純回 NaN 繼續往下跑。
const leftMinOf = async id => {
  try {
    return await page.$$eval(`#${id} .xfc-row`, els => parseInt(els[0].querySelector('.xfc-left').textContent.match(/\d+/)[0], 10));
  } catch (e) { return NaN; }
};
// 等到內容真的變成期望值再往下量,而不是固定睡一段時間:比較快,而且逾時本身就是具名 FAIL,
// 不會讓「畫面根本沒重繪」跟「重繪了但內容錯」混在一起看不出來(每個 waitForFunction 都包 try/catch)。
async function waitForRows(id, expect, timeout = 2000) {
  try {
    await page.waitForFunction(({ id, expect }) => {
      const got = [...document.querySelectorAll(`#${id} .xfc-row`)].map(e => e.dataset.xn);
      return JSON.stringify(got) === JSON.stringify(expect);
    }, { id, expect }, { timeout });
    return { settled: true, got: expect };
  } catch (e) {
    return { settled: false, got: await rowsOf(id) };
  }
}
// T1b/T2c 專用:光等「車名列表」不夠——同一次停靠前後兩個探測點,列表本身(data-xn)通常沒變
// (還是同兩班車),只有 .xfc-left 的分鐘數該變,waitForRows 的條件在 jump() 那一刻就已經是
// true(舊render留著的列表恰好等於期望值),會立刻resolve、根本沒等到下一次 tick 真的用新
// simSec 重算——量到的其實是上一個時間點的殘影。改成直接等「顯示的分鐘數」變成期望值,兩者
// 都能等到真正的重繪(第一次踩到:改用 arr+75 前用 dep-5 讀出的舊值誤判成「換車」,修好選
// 邏輯後這裡仍量到「12→12」不變,才揪出這一層更底層的競態)。
async function waitForLeftMin(id, expectMin, timeout = 2000) {
  try {
    await page.waitForFunction(({ id, expectMin }) => {
      const el = document.querySelector(`#${id} .xfc-row`);
      if (!el) return false;
      const m = el.querySelector('.xfc-left').textContent.match(/\d+/);
      return !!m && parseInt(m[0], 10) === expectMin;
    }, { id, expectMin }, { timeout });
    return { settled: true };
  } catch (e) {
    return { settled: false, got: await leftMinOf(id) };
  }
}

// ── T1 —— 到站前:接續內容應等於獨立算出的期望值(正向對照,證明挑到的候選本身是活的) ──────
await jump(picked.arr - 120);
const t1 = await waitForRows('fpConn', picked.expect);
ok('T1 到站前接續內容與期望相符', t1.settled, `期望 ${JSON.stringify(picked.expect)} 實際 ${JSON.stringify(t1.got)}`);

// ── T1b —— Finding A 必需的反向對照:行駛中換一個更晚、仍未到站的時間點,「剩 N 分」必須
// 跟 T1 那一刻完全相同、且都等於獨立算出的正確值(atSec 凍結在表定到站時刻不該逐秒遞減)。
// 這條與下面的 T2c 是同一組判準的兩半——只驗其中一半,「乾脆全部改成用現在」也能騙過去。
const expMoving = Math.round((picked.expectSecs[0] - picked.arr) / 60);
const w1a = await waitForLeftMin('fpConn', expMoving);
await jump(picked.arr - 60);
const w1b = await waitForLeftMin('fpConn', expMoving);
ok('T1b 行駛中兩拍「剩N分」維持不變(atSec 凍結在到站時刻,不該逐秒遞減)',
  w1a.settled && w1b.settled,
  `期望 ${expMoving} 分 實際 arr-120=${w1a.settled ? expMoving : w1a.got} arr-60=${w1b.settled ? expMoving : w1b.got}`);

// ── T2 —— 正在進站那一拍(arrSec 已過、還沒到 depSec):必須維持同一份內容,不能閃掉/換站 ──────
// 這是本檔最容易「全綠卻沒驗到東西」的一格:nextStopInfo 用 arrSec>t 判斷,車一到站(arrSec 一過)
// 就跳去回報下一站,但車其實還停在轉乘站月台上——「你到站時」這個標題錨定的是到站那一刻,
// 不該在停靠短短幾十秒到幾分鐘期間內悄悄換成別站的資料(甚至因為下一站不是轉乘點而整塊消失)。
await jump(picked.arr + 5);
const t2 = await waitForRows('fpConn', picked.expect);
ok('T2 進站當下內容維持不變(不能閃掉/換站)', t2.settled, `期望 ${JSON.stringify(picked.expect)} 實際 ${JSON.stringify(t2.got)}`);

// ── T2b —— Finding B:#fpConn(接續)跟 #fpNext(下一站,由 #fpXfer 標記轉乘)刻意錨定不同的
// 站——#fpNext 問的是「下一站是誰」吃 info.stop;#fpConn 問的是「你到站時/現在能轉什麼」,停靠
// 中吃停靠站。這是唯一能讓「有人好心把兩者統一」當場轉紅的機制,目前為止的驗收從沒讀過 #fpNext。
const nextText = await page.$eval('#fpNext', el => el.textContent.trim());
const expectNextText = await page.evaluate(({ name, sys }) => stationName(name, sys), { name: picked.nextName, sys: picked.sys });
const dwellText = await page.evaluate(({ name, sys }) => stationName(name, sys), { name: picked.stn, sys: picked.sys });
ok('T2b 停靠中 #fpNext(下一站)與 #fpConn 錨定站不同(刻意分歧,不該被統一)',
  nextText === expectNextText && nextText !== dwellText,
  `fpNext=${nextText} 期望下一站=${expectNextText} 停靠站(fpConn錨定)=${dwellText}`);

// ── T2c —— Finding A 正向:同一次停靠內再取一個更晚的時間點,「剩 N 分」必須確實下降,且降成
// 精確算出的正確值(不是只驗「有變」,連「變成多少」都釘住)。第二點固定用 arr+75(不是
// dep-5)——挑選階段已經保證 at.secs[0] 在 arr+75 之後至少 60 秒才選中,兩個探測點量到的
// 必須是同一班候選車,不會中途換車(候選車自己先到站掉出視窗換成第二名頂替第一列)。
// 🔴 這裡也用 waitForLeftMin,不是「T2 剛 settled 就地讀值」:T2 的 waitForRows 只等車名列表
// (data-xn),而停靠中列表通常跟行駛中是同一組(同兩班車),T1b/T2 那次 jump 之後列表可能
// 一直沒變過⇒waitForRows 在 jump 那一刻就已經是 true、沒等到 arr+5 真正重繪,就地讀值撈到
// 的其實是上一個時間點的殘影(第一次踩到:改好選車邏輯後仍量出「12→12」不變,查到才發現是
// 這一層更底層的競態,不是 xat 邏輯本身的問題)。
const expDwellA = Math.round((picked.expectSecs[0] - (picked.arr + 5)) / 60);
const expDwellB = Math.round((picked.expectSecs[0] - (picked.arr + 75)) / 60);
const w2a = await waitForLeftMin('fpConn', expDwellA);
await jump(picked.arr + 75);
const w2b = await waitForLeftMin('fpConn', expDwellB);
ok('T2c 停靠中「剩N分」確實遞減(atSec 隨現在時刻走,不再凍結於到站時刻)',
  w2a.settled && w2b.settled && expDwellA !== expDwellB,
  `期望 arr+5=${expDwellA}分 arr+75=${expDwellB}分 實際 ${w2a.settled ? expDwellA : w2a.got}→${w2b.settled ? expDwellB : w2b.got}`);

// ── T3 —— 已離站超過 10 分鐘:內容必須換成新站獨立算出的正確答案,不可殘留舊站內容 ─────────
// 判準是「等於 picked.expectAfter(挑選時已獨立算好、且已確認與 picked.expect 不同的正確值)」,
// 不是「不等於 picked.expect」——前者精確,連「換成別站但答案算錯」這種介於兩者之間的錯誤也
// 抓得到;挑選階段已經濾掉「換站後答案剛好與原站相同」的候選(南港→臺北緊鄰兩個轉乘大站
// 就踩過這個巧合:兩站當下最近的北上高鐵剛好是同兩班車),所以這裡不必再擔心巧合誤判。
await jump(picked.arr + 600);
const t3 = await waitForRows('fpConn', picked.expectAfter);
ok('T3 過站後內容換成新站正確答案(不是舊站殘留)', t3.settled,
  `期望 ${JSON.stringify(picked.expectAfter)} 實際 ${JSON.stringify(t3.got)}`);

// ── T4 —— 釘選跨站是否需要顯式清除:2026-09-01 修訂要求先驗證再決定,不准假設 ──────────────
// 假說(brief):groupId 已納入釘選鍵(state.xferPin.g),此刻(T3 的時間點)#fpConn 對應的
// groupId 已經跟 picked.gid 不同(picked.expectAfter 挑選時已確認與 picked.expect 不同,
// 對應的正是不同的站/群),對一個「舊站已經用過的候選」事後補釘,pinned 比對式要求
// g===groupId,理論上會自然比對不上、不會生效——如果這裡量出來是真的,Step 3 的清除邏輯
// 就是多餘的(YAGNI);如果量出來是假的(舊內容被強行釘住重現),才需要在 updateFollowPanel
// 加顯式清除。
const pinLeak = await page.evaluate(({ gid, no }) => {
  setXferPin(gid, no, 'TRA'); // production 本尊,不是灌 stub;refreshXferConns 會用 fpConn 當下
  return {                    // 存的 args(此刻對應的是新的 groupId,不是 picked.gid)原地重播一次
    hasUnpin: !!document.querySelector('#fpConn .xfc-unpin'),
    rows: [...document.querySelectorAll('#fpConn .xfc-row')].map(e => e.dataset.xn),
  };
}, { gid: picked.gid, no: picked.expect[0] });
await page.evaluate(() => clearXferPin());
ok('T4 對已離開的舊站事後補釘,不會在新站現出「已釘選」介面(驗證 brief 假說,決定要不要另寫清除邏輯)',
  !pinLeak.hasUnpin, JSON.stringify(pinLeak));

ok('Z 頁面零例外', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();
const bad = results.filter(r => !r.pass);
console.log(`\n總計 ${results.length - bad.length}/${results.length} 通過`);
if (bad.length) { console.log('未過:'); bad.forEach(r => console.log('  - ' + r.name + (r.detail ? '  — ' + r.detail : ''))); }
process.exit(bad.length ? 1 : 0);
