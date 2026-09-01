#!/usr/bin/env node
// 轉乘接續:【跟車中】用真滑鼠/真手指釘選(2026-09-01 最終廣審 Finding 1＋Finding 2)。
//
// 為什麼要另立一支:既有五支腳本沒有任何一支照得到這件事——它們全部繞過跟車迴圈
// (verify_transfer_pin.mjs 甚至為了讓點擊穩定,刻意把 state.followTrain 清空),於是測的是
// 「沒有在跟車時的釘選」,而那不是這個功能的使用情境。真正的情境裡:
//   updateFollowCamera 每個 animation frame 都呼叫 updateFollowPanel → setTransferConn,
//   原本無條件 `el.innerHTML = html` ⇒ 接續區塊每幀被整段汰換(內容逐字元相同、節點是新的)。
//   使用者按下滑鼠到放開之間原節點已卸離(isConnected=false)⇒ 依 UI Events 規範 click 不派發
//   ⇒ 真人按壓(>16ms)必定失敗。廣審實測按壓 0/60/120/250ms 全部 xferPin=null。
//
// 本檔的四個硬性判準(findings 明文):
//   ① 真的跟一班車(state.followTrain 有值、rAF 迴圈在跑)——F1 直接量,不假設;
//   ② 真滑鼠按住 >=120ms 再放開(page.mouse.down/up,不是 dispatchEvent)——F3;
//   ③ 量 state.xferPin 確實被設起來——F3;
//   ④ 反向對照:F4 要求同一次點擊之後畫面【確實重畫】成釘選態。沒有這一條的話,
//      「乾脆整段不重畫」也會讓 F3 通過,而那會讓接續內容永遠不更新。
// 另外 F5/F6 是 Finding 2:手機上點接續列不可以順便把「列車」sheet 拉上來。F5pre 先用一個
// 非排除區的觸控證明那條分支真的活著,否則 F6 的「維持 false」是恆真的空斷言。
//
// 🔴 兩個引擎都跑(chromium + webkit)。本 repo 的教訓明載 headless 的陰性結果不可信
// (rAF 凍結、捲軸不渲染、visibility 閘門恆關…),而「點得到」正是最容易被引擎差異騙的一類,
// 所以同一組判準在 WebKit 上再量一次。某個引擎起不來 ⇒ 具名 FAIL,不靜默跳過。
//
// 慣例依 task-4-context.md(硬性):自帶 node:http 靜態伺服器(不用 wrangler dev)、不用全攔式
// route(會擋掉 CDN 的 Leaflet ⇒ boot 拋錯 ⇒ 逾時且零資訊)、語系三重釘死、關首訪教學卡、
// pageerror 掛勾、T0 身分自檢。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5523);
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
    // boot 對 sys.data.trains 疊代直接噴例外(比照 verify_transfer_pin.mjs 同款處理)。
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

// 開機前置:語系三重釘死(①context locale ②localStorage ③網址 ?lang)、關首訪教學卡、
// 關省電節流(省電會把跟隨重繪降到 30fps——本檔要量的正是重繪行為,不要引入第二個變因)、
// 跟隨卡不要記憶成膠囊態(fp-min 會讓 #fpConn 收起來,點不到)。
const INIT = () => {
  localStorage.setItem('trainmap-howto-seen', '1');
  localStorage.setItem('trainmap-language', 'zh-TW');
  localStorage.setItem('trainmap-powersave', '0');
  localStorage.setItem('trainmap-fprail-min', '0');
};

// 找一班「下一站是轉乘錨點、且該時刻真的有對向班次」的台鐵車,撥鐘到到站前 120 秒再跟上去。
// 判準用產品自己的 transferAnchorForStop/transferConnections(已由 verify_transfer_connections
// 獨立驗過的 oracle),不用「站名出現在某個扁平 Set」那種會巧合命中的寫法。
const FIND_AND_FOLLOW = () => {
  for (const tr of state.trains) {
    if (tr.sys !== 'tra_sched') continue;
    const stops = tr.stops;
    const last = stops[stops.length - 1];
    if (Math.max(last.arrSec, last.depSec) > 86400) continue; // 跨午夜的車不測
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
      if (!rows || rows.length < 2) continue;    // 要 >=2 列:釘選後「只剩一列」才有鑑別力
      // 🔴 刻意【不】清空 state.followTrain(verify_transfer_pin.mjs 為了繞開每幀重畫才清):
      // 本檔要驗的就是「rAF 跟車迴圈仍在跑」的情況下點得到。simSec 凍結只是讓量測可重現,
      // 不影響機制——updateFollowCamera 不受 state.playing 節流,照樣每幀重寫面板。
      state.playing = false;
      state.simSec = at; state.clockAtNow = false;
      followTrainNo(tr.train, { sys: tr.sys });
      return { no: tr.train, sys: tr.sys, stn: st.name, at, gid, want: rows.slice(0, 2).map(r => r.n) };
    }
  }
  return null;
};

// 取樣窗:量兩件事——(a) 跟車迴圈真的在跑(#fpNext 每幀被 textContent 重寫 ⇒ childList 有動靜),
// (b) #fpConn 的子節點在同一段時間內完全沒有被汰換。兩者用同一個窗,結論才可比。
const SAMPLE_FN = ms => new Promise(res => {
  const conn = document.getElementById('fpConn');
  const next = document.getElementById('fpNext');
  let cn = 0, nx = 0;
  const o1 = new MutationObserver(rs => { cn += rs.length; });
  const o2 = new MutationObserver(rs => { nx += rs.length; });
  o1.observe(conn, { childList: true, subtree: true });
  o2.observe(next, { childList: true, characterData: true, subtree: true });
  setTimeout(() => { o1.disconnect(); o2.disconnect(); res({ connMut: cn, nextMut: nx }); }, ms);
});

async function runEngine(engineName, engine) {
  const P = s => `${engineName} ${s}`;
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    ok(P('F0 瀏覽器起得來'), false, String(e && e.message).slice(0, 200));
    return;
  }

  // ══ 桌面:Finding 1 —— 跟車中真滑鼠按住 150ms 釘選 ═════════════════════════════
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'zh-TW' });
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE-ERR: ' + m.text()); });
    await page.goto(`http://localhost:${PORT}/?lang=zh-TW&g=nat`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(() => {
        try { return typeof state !== 'undefined' && state.ready && !!state.transferDepartures && (state.trains || []).length > 0; }
        catch (e) { return false; }
      }, null, { timeout: 40000 });
    } catch (e) {
      ok(P('F0 boot 就緒'), false, errors.slice(0, 3).join(' | ') || String(e.message).slice(0, 120));
      await ctx.close(); await browser.close(); return;
    }
    const servedBuild = await page.evaluate(() => typeof BUILD !== 'undefined' ? BUILD : '?');
    ok(P('T0 服務端 BUILD 與本機檔案一致(沒有驗到快取或別的版本)'), servedBuild === localBuild, `served=${servedBuild} local=${localBuild}`);

    const found = await page.evaluate(FIND_AND_FOLLOW);
    ok(P('F0 找到一班「下一站是轉乘站且有對向班次」的車並跟上'), !!found, JSON.stringify(found));
    if (found) {
      await page.waitForFunction(() => document.querySelectorAll('#fpConn .xfc-row').length >= 2, null, { timeout: 8000 }).catch(() => {});
      const st = await page.evaluate(() => ({
        following: !!(state.followTrain && state.followTrain.train),
        rows: [...document.querySelectorAll('#fpConn .xfc-row')].map(e => e.dataset.xn),
        pin: state.xferPin,
      }));
      ok(P('F0b 跟車中且 #fpConn 有 >=2 列可點、尚未釘選(前提成立)'),
        st.following && st.rows.length >= 2 && !st.pin, JSON.stringify(st));

      // ── F1/F2 —— 取樣 600ms:跟車迴圈在跑,但接續區塊完全不被汰換 ────────────────
      const s = await page.evaluate(SAMPLE_FN, 600);
      ok(P('F1 跟車 rAF 迴圈確實在跑(#fpNext 在取樣窗內被重寫)'), s.nextMut > 0, JSON.stringify(s));
      ok(P('F2 跟車中 #fpConn 子節點零汰換(修復前每幀整段換掉 ⇒ 點擊被吃掉)'), s.connMut === 0, JSON.stringify(s));

      // ── F3 —— 真滑鼠:移到第一列中心、按住 150ms、放開。不是 dispatchEvent ────────
      // 🔴 座標與車次都用 page.evaluate 當場重新查詢,不用 Playwright 的 locator:突變成
      // 「每幀整段重寫」時 locator.boundingBox() 會因為節點一直被換掉而回 null,於是 F3pre
      // 先紅、真正要考的 F3 反而拿不到執行機會(第一次跑突變就是這個結果)。改成即時查詢後,
      // 突變下照樣按得下去,F3 就能具名回報「釘的=null」——那才是這條 finding 的直接證據。
      const first = await page.evaluate(() => {
        const r = document.querySelector('#fpConn .xfc-row');
        if (!r) return null;
        const b = r.getBoundingClientRect();
        return { no: r.dataset.xn, x: b.x, y: b.y, width: b.width, height: b.height };
      });
      const no = first && first.no;
      const box = first && first.width > 0 && first.height > 0 ? first : null;
      ok(P('F3pre 第一列量得到座標(不是零尺寸/被摺疊)'), !!box, JSON.stringify(first));
      if (box) {
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        // 命中判準:那個座標上真的是這一列(或它的子元素),而且節點還在 DOM 上。
        const hit = await page.evaluate(({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          return { tag: el && el.tagName, inRow: !!(el && el.closest && el.closest('#fpConn .xfc-row')), connected: !!(el && el.isConnected) };
        }, { x: cx, y: cy });
        ok(P('F3pre2 該座標命中的是接續列本身且節點在場'), hit.inRow && hit.connected, JSON.stringify(hit));

        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.waitForTimeout(150);       // 真人按壓 >=120ms;60fps 下必定跨過多次重畫
        await page.mouse.up();
        const after = await page.evaluate(() => ({
          pin: state.xferPin ? { ...state.xferPin } : null,
          rows: [...document.querySelectorAll('#fpConn .xfc-row')].map(e => e.dataset.xn),
          unpin: document.querySelectorAll('#fpConn .xfc-unpin').length,
          following: !!(state.followTrain && state.followTrain.train),
        }));
        ok(P('F3 跟車中真滑鼠按住 150ms 放開,確實釘住點的那一班(Finding 1 核心)'),
          !!after.pin && after.pin.n === no && after.following, `點的=${no} 釘的=${after.pin && after.pin.n} 仍在跟車=${after.following}`);
        // 🔴 反向對照:沒有這一條,「乾脆整段不重畫」也會讓 F3 過,而那會讓接續內容永遠不更新。
        ok(P('F4 反向對照:同一次點擊後畫面確實重畫成釘選態(只剩一列+取消釘選鈕)'),
          after.rows.length === 1 && after.rows[0] === no && after.unpin === 1, JSON.stringify(after));
      }
    }
    ok(P('F桌面 頁面零例外'), errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ══ 手機 375×812 真觸控:Finding 2 —— 點接續列不可以順便開「列車」sheet ══════════
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'zh-TW', hasTouch: true });
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE-ERR: ' + m.text()); });
    await page.goto(`http://localhost:${PORT}/?lang=zh-TW&g=nat`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(() => {
        try { return typeof state !== 'undefined' && state.ready && !!state.transferDepartures && (state.trains || []).length > 0; }
        catch (e) { return false; }
      }, null, { timeout: 40000 });
    } catch (e) {
      ok(P('F5 手機 boot 就緒'), false, errors.slice(0, 3).join(' | ') || String(e.message).slice(0, 120));
      await ctx.close(); await browser.close(); return;
    }
    const found = await page.evaluate(FIND_AND_FOLLOW);
    ok(P('F5pre0 手機:找到車並跟上'), !!found, JSON.stringify(found));
    if (found) {
      await page.waitForFunction(() => document.querySelectorAll('#fpConn .xfc-row').length >= 1, null, { timeout: 8000 }).catch(() => {});
      const shell = await page.evaluate(() => ({
        fs: document.body.classList.contains('fs'),
        mobile: matchMedia(MOBILE_MQ).matches,
        trainOpen: document.body.classList.contains('train-open'),
        inUniSlot: !!document.getElementById('followPanel').closest('.uni-slot'),
      }));
      ok(P('F5pre1 手機殼成立(body.fs + MOBILE_MQ + 卡不在整合槽 + sheet 尚未開)'),
        shell.fs && shell.mobile && !shell.trainOpen && !shell.inUniSlot, JSON.stringify(shell));

      // 座標與車次即時查詢(理由見桌面段 F3pre),並【連命中結果一起量】。
      // 🔴 停等條件是「這個座標現在真的打得到那一列」,不是「座標不動了」:手機殼開機後跟隨小卡
      // 還會再挪一次位,兩次取樣相同只證明「這一拍沒動」——實測踩到過 y=773.67 連續兩拍相同、
      // 其實整列坐在底部 tab bar 底下(elementFromPoint 命中一顆 className 空的 BUTTON,tap 下去
      // pin 是 null)。改成輪詢到 inRow 為真才算就緒,直接量的就是「點得到」這件事本身。
      const PROBE = () => page.evaluate(() => {
        const r = document.querySelector('#fpConn .xfc-row');
        if (!r) return null;
        const b = r.getBoundingClientRect();
        if (!(b.width > 0 && b.height > 0)) return { no: r.dataset.xn, x: b.x, y: b.y, width: b.width, height: b.height, inRow: false };
        const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        return {
          no: r.dataset.xn, x: b.x, y: b.y, width: b.width, height: b.height,
          inRow: !!(el && el.closest && el.closest('#fpConn .xfc-row')),
          hitTag: el && el.tagName, hitCls: el && String(el.className).slice(0, 40),
        };
      });
      let probe = null;
      for (let i = 0; i < 25; i++) {
        probe = await PROBE();
        if (probe && probe.inRow) break;
        await page.waitForTimeout(150);
      }
      ok(P('F5pre3 手機:接續列量得到座標'), !!probe && probe.width > 0 && probe.height > 0, JSON.stringify(probe));
      ok(P('F5pre4 手機:該座標命中的是接續列本身(沒被 tab bar 之類的家具蓋住)'), !!probe && probe.inRow, JSON.stringify(probe));
      if (probe && probe.inRow) {
        const noM = probe.no;
        await page.touchscreen.tap(probe.x + probe.width / 2, probe.y + probe.height / 2);
        await page.waitForFunction(() => !!state.xferPin, null, { timeout: 3000 }).catch(() => {});
        // sheet 是動畫上滑的:多等一拍,不要讓「還沒滑上來」冒充成「沒有被打開」。
        await page.waitForTimeout(500);
        const res = await page.evaluate(() => ({
          pin: state.xferPin ? { ...state.xferPin } : null,
          trainOpen: document.body.classList.contains('train-open'),
        }));
        ok(P('F5 手機真觸控點接續列,確實釘住那一班'), !!res.pin && res.pin.n === noM, `點的=${noM} 釘的=${res.pin && res.pin.n}`);
        ok(P('F6 且不會順便打開「列車」sheet(Finding 2:.xfc-row 要在排除清單裡)'),
          res.trainOpen === false, `train-open=${res.trainOpen}`);

        // 🔴 F7 正向對照必須在 F6 之後、同一頁做:少了它,F6 的「train-open 維持 false」在那條
        // 分支根本沒被走到時是恆真的空斷言。刻意不擺在 F5/F6 前面——開關一次「列車」sheet 會讓
        // 跟隨小卡重新排版,收合動畫期間量到的座標會落在別的家具上(見上面 F5pre3 的註解)。
        const nextBox = await page.evaluate(() => {
          const e = document.querySelector('#followPanel .fp-next');
          if (!e) return null;
          const b = e.getBoundingClientRect();
          return { x: b.x, y: b.y, width: b.width, height: b.height };
        });
        if (nextBox && nextBox.width > 0) {
          await page.touchscreen.tap(nextBox.x + nextBox.width / 2, nextBox.y + nextBox.height / 2);
          await page.waitForFunction(() => document.body.classList.contains('train-open'), null, { timeout: 3000 }).catch(() => {});
        }
        const opened = await page.evaluate(() => document.body.classList.contains('train-open'));
        // nextBox 要有尺寸才算數:F6 若已經紅了(sheet 早就被那一 tap 打開),.fp-next 會收成
        // 0×0、這裡等於沒點就宣告成功——正向對照自己也需要「我真的做了那個動作」的證據。
        ok(P('F7 正向對照:同一頁點卡片非排除區確實會開「列車」sheet(證明 F6 不是空斷言)'),
          opened && !!nextBox && nextBox.width > 0 && nextBox.height > 0,
          `train-open=${opened} nextBox=${JSON.stringify(nextBox)}`);
      }
    }
    ok(P('F手機 頁面零例外'), errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  await browser.close();
}

// 引擎清單可用 ENGINES=chromium 縮減(除錯用);預設兩個都跑——headless 的陰性結果不可信,
// 「點得到」這類判準一定要有第二個引擎佐證。
const want = (process.env.ENGINES || 'chromium,webkit').split(',').map(s => s.trim()).filter(Boolean);
const ENGINES = { chromium, webkit };
for (const name of want) {
  if (!ENGINES[name]) { ok(`${name} 引擎名稱有效`, false, '只認 chromium / webkit'); continue; }
  console.log(`\n──────── ${name} ────────`);
  await runEngine(name, ENGINES[name]);
}

server.close();
const bad = results.filter(r => !r.pass);
console.log(`\n總計 ${results.length - bad.length}/${results.length} 通過`);
if (bad.length) { console.log('未過:'); bad.forEach(r => console.log('  - ' + r.name + (r.detail ? '  — ' + r.detail : ''))); }
process.exit(bad.length ? 1 : 0);
