#!/usr/bin/env node
// 轉乘接續的展開/收合驗收(2026-09-11 使用者:「資訊卡需要整理一下,轉乘要能夠收起來,否則太長了」)。
//
// 靜態那一半(收合態的字串長什麼樣、收合那行答案與展開第一列是不是同一班車)已經在
// verify_transfer_connections.mjs 的 G25 組裡,不在這裡重複。這一支只驗**只有真瀏覽器量得到**的:
//   C1 全新 profile 預設就是收合(沒有 localStorage 時的初值)
//   C2 收合真的讓卡片變短——省下的高度至少一整列(門檻由當下量到的列高推導,不寫死 px)
//   C3 真滑鼠按下去會展開(不是 el.click();跟隨面板每幀重畫會把真實點擊吃掉,
//      見 memory follow-panel-repaint-eats-clicks 與 verify_transfer_follow_pin 的 F5/F6)
//   C4 點收合鈕不會順便把手機「列車」sheet 滑上來(.xfc-t 要在 openTrainSheet 的排除清單裡)
//   C5 重新載入之後記得住(localStorage trainmap-xfer-open)
//   C6 三個顯示實例同時換,不是只換被點的那一個(refreshXferConns)
//   C7 兩種狀態都不橫向溢出、不蓋到其他常駐家具
//
// 慣例照 verify_transfer_mobile.mjs:自帶 node:http 靜態伺服器、不用全攔式 route(會擋掉 CDN 的
// Leaflet)、語系三重釘死、關首訪教學卡、掛 pageerror、T0 身分自檢。
// 🔴 引擎跑兩個:chromium 預設 en-US、webkit 跟隨系統語系,兩者結論不同就是語系沒釘死
//    (memory verify-locale-must-be-pinned)。webkit 只跑 375 一個寬度,四寬掃描交給 chromium。
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

// ── T0 目標自檢:先證明「我在驗誰」(不是別的 worktree、不是快取) ──────────────────
const idxSrc = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const md5 = createHash('md5').update(idxSrc).digest('hex').slice(0, 12);
const localBuild = (idxSrc.match(/const BUILD = '([^']*)'/) || [])[1] || '?';
console.log(`\n目標: ${path.join(ROOT, 'index.html')}\n      md5=${md5}  BUILD=${localBuild}\n`);

// [引擎, 寬度]。四寬掃描只在 chromium(那四個寬度之間沒有其他斷點,唯一相關的是 900px 手機殼);
// webkit 跑 375 當語系與引擎的對照組。
const MATRIX = [['chromium', 360], ['chromium', 375], ['chromium', 414], ['chromium', 768], ['webkit', 375]];
const OTHERS = ['#statBadge', '#randBtn', '#nearBtn'];
const ENGINES = { chromium, webkit };
let t0Done = false;

for (const [engName, w] of MATRIX) {
  const P = n => `${engName} ${w} ${n}`;
  const browser = await ENGINES[engName].launch();
  // 🔴 刻意不設 trainmap-xfer-open:C1 量的就是「沒有這個鍵時的預設」。
  const ctx = await browser.newContext({ viewport: { width: w, height: 812 }, locale: 'zh-TW' });
  await ctx.addInitScript(() => {
    localStorage.setItem('trainmap-howto-seen', '1');
    localStorage.setItem('trainmap-language', 'zh-TW');
    localStorage.setItem('trainmap-powersave', '0');
    localStorage.setItem('trainmap-fprail-min', '0');
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE-ERR: ' + m.text()); });

  const boot = async () => {
    await page.goto(`http://localhost:${PORT}/?lang=zh-TW&g=nat`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      try { return typeof state !== 'undefined' && state.ready && !!state.transferDepartures && (state.trains || []).length > 0; }
      catch (e) { return false; }
    }, null, { timeout: 45000 });
  };
  try { await boot(); } catch (e) {
    ok(P('boot 就緒'), false, errors.slice(0, 3).join(' | ') || String(e).slice(0, 120));
    await browser.close(); continue;
  }
  if (!t0Done) {
    t0Done = true;
    const servedBuild = await page.evaluate(() => typeof BUILD !== 'undefined' ? BUILD : '?');
    ok('T0 服務端 BUILD 與本機檔案一致(沒有驗到快取或別的版本)', servedBuild === localBuild, `served=${servedBuild} local=${localBuild}`);
  }

  // 找一班「停靠站是轉乘錨點、且到站前 120 秒真的查得到接續」的台鐵車,撥鐘過去再跟車。
  // 與 verify_transfer_mobile.mjs 同一套 oracle(transferAnchorForStop + transferConnections)。
  const FIND = () => {
    for (const tr of state.trains) {
      if (tr.sys !== 'tra_sched') continue;
      const stops = tr.stops, last = stops[stops.length - 1];
      if (Math.max(last.arrSec, last.depSec) > 86400) continue;
      const xsys = TRANSFER_SCHED_SYSTEM[tr.sys];
      for (let i = 1; i < stops.length - 1; i++) {
        const st = stops[i];
        if (st.stop === false || !Number.isFinite(st.arrSec)) continue;
        if (stops[i - 1].stop !== false && stops[i - 1].arrSec > st.arrSec - 150) continue;
        const anchor = transferAnchorForStop(xsys, st);
        const gid = anchor && anchor.station ? anchor.station.transferId : null;
        if (!gid) continue;
        const at = st.arrSec - 120;
        if (at < 0) continue;
        const rows = transferConnections(gid, at, xsys);
        if (!rows || !rows.length) continue;
        state.playing = false; state.simSec = at; state.clockAtNow = false;
        followTrainNo(tr.train, { sys: tr.sys });
        return { no: tr.train, stn: st.name, at };
      }
    }
    return null;
  };
  const found = await page.evaluate(FIND);
  ok(P('找到可跟的車(已撥鐘到到站前,#fpConn 確定有真實資料)'), !!found, JSON.stringify(found));
  if (!found) { await browser.close(); continue; }

  const snap = () => page.evaluate(sels => {
    const box = e => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
    const hit = (a, c) => !(a.r <= c.l || c.r <= a.l || a.b <= c.t || c.b <= a.t);
    const c = document.getElementById('fpConn');
    const p = document.getElementById('followPanel');
    const me = box(c);
    const clashes = [];
    for (const s of sels) {
      const o = document.querySelector(s);
      if (!o || o.hidden || !o.offsetParent) continue;
      const ob = box(o);
      if (!ob.w || !ob.h) continue;
      if (hit(me, ob)) clashes.push(s);
    }
    const row = c.querySelector('.xfc-row');
    // 每個「有內容」的 .xfer-conn 各自回報自己的狀態,用來驗三個實例是否同步
    const all = [...document.querySelectorAll('.xfer-conn')].filter(e => e.querySelector('.xfc-t'))
      .map(e => ({ id: e.id, aria: e.querySelector('.xfc-t').getAttribute('aria-expanded'),
                   rows: e.querySelectorAll('.xfc-row').length }));
    return {
      hidden: c.hidden, conn: me, panel: box(p).h,
      rows: c.querySelectorAll('.xfc-row').length,
      toggles: c.querySelectorAll('.xfc-t').length,
      sum: (c.querySelector('.xfc-sum') || {}).textContent || '',
      firstRowH: row ? +row.getBoundingClientRect().height.toFixed(1) : 0,
      firstNo: (c.querySelector('.xfc-no') || {}).textContent || '',
      firstLeft: (c.querySelector('.xfc-left') || {}).textContent || '',
      foot: !!c.querySelector('.xfc-f'),
      aria: c.querySelector('.xfc-t') ? c.querySelector('.xfc-t').getAttribute('aria-expanded') : null,
      ls: (() => { try { return localStorage.getItem('trainmap-xfer-open'); } catch (e) { return 'ERR'; } })(),
      trainOpen: document.body.classList.contains('train-open'),
      clashes, scrollW: document.documentElement.scrollWidth, inner: innerWidth,
    };
  }, OTHERS);

  // ── C1 全新 profile 預設收合 ───────────────────────────────────────────────
  const a = await snap();
  ok(P('C1 全新 profile(沒有 trainmap-xfer-open)預設就是收合'),
     !a.hidden && a.toggles === 1 && a.aria === 'false' && a.rows === 0 && !a.foot,
     `aria=${a.aria} rows=${a.rows} foot=${a.foot} ls=${a.ls}`);
  ok(P('C1b 收合態容器仍非零尺寸(祖先沒有還是 [hidden],不是整組收斂成 0 的假綠)'),
     a.conn.w > 0 && a.conn.h > 0, JSON.stringify(a.conn));
  ok(P('C1c 收合態那一行答案有印出來(收合不等於把答案藏起來)'),
     /剩 \d+ 分/.test(a.sum), a.sum);
  ok(P('C7 收合態不與其他常駐家具相交、不橫向捲動、不溢出右緣'),
     a.clashes.length === 0 && a.scrollW <= a.inner && a.conn.r <= w + 1,
     `clash=${a.clashes.join(',')||'無'} scrollW=${a.scrollW}/${a.inner} right=${a.conn.r}`);

  // ── C3/C4 真滑鼠點一次 → 展開 ──────────────────────────────────────────────
  await page.locator('#fpConn .xfc-t').click();
  await page.waitForFunction(() => {
    const e = document.querySelector('#fpConn .xfc-t');
    return !!e && e.getAttribute('aria-expanded') === 'true';
  }, null, { timeout: 5000 }).catch(() => {});
  const b = await snap();
  ok(P('C3 真滑鼠點 toggle 會展開(面板每幀重畫沒有把點擊吃掉)'),
     b.aria === 'true' && b.rows >= 1 && b.foot, `aria=${b.aria} rows=${b.rows} foot=${b.foot}`);
  ok(P('C3b 展開態不再印收合那一行答案(與第一列重複就是雜訊)'), b.sum === '', b.sum);
  ok(P('C3c 收合那一行答案 = 展開後第一列的車次與剩 N 分(跨狀態是同一班車)'),
     !!b.firstLeft && a.sum === [b.firstNo, b.firstLeft].filter(Boolean).join(' · '),
     `${a.sum} vs ${[b.firstNo, b.firstLeft].filter(Boolean).join(' · ')}`);
  ok(P('C4 點 toggle 不會順便把「列車」sheet 滑上來'), b.trainOpen === false, `train-open=${b.trainOpen}`);
  ok(P('C5 展開狀態寫進 localStorage'), b.ls === '1', `ls=${b.ls}`);

  // ── C2 收合真的讓卡片變短:省下的高度至少一整列(門檻由當下量到的列高推導) ────────
  ok(P('C2 收合比展開矮,而且省下的至少是一整列的高度'),
     a.conn.h < b.conn.h - b.firstRowH + 1,
     `收合 ${a.conn.h} / 展開 ${b.conn.h} / 一列 ${b.firstRowH} / 卡片 ${a.panel}→${b.panel}`);
  ok(P('C7b 展開態同樣不與其他家具相交、不橫向捲動、不溢出右緣'),
     b.clashes.length === 0 && b.scrollW <= b.inner && b.conn.r <= w + 1,
     `clash=${b.clashes.join(',')||'無'} scrollW=${b.scrollW}/${b.inner} right=${b.conn.r}`);

  // ── C6 三個實例一起換:把手機「列車」sheet 也打開(#tcConn),再切一次狀態 ─────────
  await page.evaluate(() => { if (typeof openTrainSheet === 'function') openTrainSheet(); });
  await page.waitForFunction(() => {
    const e = document.querySelector('#tcConn .xfc-t');
    return !!e;
  }, null, { timeout: 5000 }).catch(() => {});
  const two = await page.evaluate(() => [...document.querySelectorAll('.xfer-conn')]
    .filter(e => e.querySelector('.xfc-t'))
    .map(e => ({ id: e.id, aria: e.querySelector('.xfc-t').getAttribute('aria-expanded'),
                 rows: e.querySelectorAll('.xfc-row').length })));
  ok(P('C6pre 同時有兩個以上的顯示實例在場(只有一個的話 C6 恆真)'), two.length >= 2,
     two.map(x => `${x.id}:${x.aria}/${x.rows}`).join(' '));
  ok(P('C6 所有在場的實例狀態一致'),
     two.length >= 2 && two.every(x => x.aria === two[0].aria && x.rows === two[0].rows),
     two.map(x => `${x.id}:${x.aria}/${x.rows}`).join(' '));
  // 再點一次收回:從 #tcConn 那顆點,收的必須是全部
  await page.locator('#tcConn .xfc-t').click();
  await page.waitForFunction(() => {
    const e = document.querySelector('#tcConn .xfc-t');
    return !!e && e.getAttribute('aria-expanded') === 'false';
  }, null, { timeout: 5000 }).catch(() => {});
  const three = await page.evaluate(() => [...document.querySelectorAll('.xfer-conn')]
    .filter(e => e.querySelector('.xfc-t'))
    .map(e => ({ id: e.id, aria: e.querySelector('.xfc-t').getAttribute('aria-expanded'),
                 rows: e.querySelectorAll('.xfc-row').length })));
  ok(P('C6b 從另一個實例點收合,全部一起收(含剛剛展開的那一個)'),
     three.length >= 2 && three.every(x => x.aria === 'false' && x.rows === 0),
     three.map(x => `${x.id}:${x.aria}/${x.rows}`).join(' '));

  // ── C5 重新載入之後記得住 ─────────────────────────────────────────────────
  await page.evaluate(() => { try { localStorage.setItem('trainmap-xfer-open', '1'); } catch (e) {} });
  try { await boot(); } catch (e) { ok(P('C5b 重載後 boot 就緒'), false, String(e).slice(0, 100)); await browser.close(); continue; }
  await page.evaluate(FIND);
  const d = await snap();
  ok(P('C5b 重新載入之後維持展開(localStorage 記得住)'),
     d.aria === 'true' && d.rows >= 1, `aria=${d.aria} rows=${d.rows} ls=${d.ls}`);

  ok(P('無 pageerror / console error'), errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

server.close();
const bad = results.filter(r => !r.pass);
console.log(bad.length ? `\n${bad.length} 項未過` : `\n全部通過(${results.length} 條)`);
process.exit(bad.length ? 1 : 0);
