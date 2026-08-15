#!/usr/bin/env node
// 北捷官方訊號中斷的「使用者看得到嗎」驗收。
//
// 為什麼要有這支：2026-08-15 06:27～07:00 北捷官方看板斷了 33 分鐘，畫面上列車被推到互相超車、
// 車站倒數整個找不到車，而**沒有任何一處**告訴使用者發生了什麼——連 #metroBadge 都還亮著「官方即時」
// （它讀的是後端從來沒送過的 roster.held）。所以這裡驗的不是「函式回傳對不對」，而是
// 「東西真的出現在畫面上、點得到、字是對的」。
//
// 判準紀律：
//   * 只用「真的做一次那個互動 + 量它造成的狀態改變」，不用 computed style 當存在證明（心得 24/33/37）
//   * 每條正向斷言都配一個對照組（訊號正常時必須不出現），否則「有出現」證明不了它是被中斷觸發的
//   * 每條斷言都配突變：把對應的產品程式碼改壞，該條必須轉紅，否則它沒有牙（心得 35）
//   * 語料用 2026-08-15 真實斷線 payload 重放（rebase 到現在），不自己編一份
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = path.join(ROOT, 'index.html');
const INDEX = fs.readFileSync(INDEX_PATH, 'utf8');
const FIX = path.join(ROOT, 'fixtures/trtc-outage-20260815');

let failures = 0;
const log = [];
function check(pass, label, detail = '') {
  if (!pass) failures++;
  const line = `${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`;
  log.push(line); console.log(line);
}

function replaceExactly(source, before, after, label) {
  const pieces = source.split(before);
  if (pieces.length !== 2) throw new Error(`${label} mutation anchor 應恰好一處，實際 ${pieces.length - 1}`);
  return pieces[0] + after + pieces[1];
}

// ── 語料：真實斷線 payload rebase 到「現在」 ────────────────────────────────
// 深走整棵樹把 2026 年的 unix 秒整體平移，不逐欄列舉——欄位一多就會漏（漏掉的那欄會變成
// 假的「這台車的觀測是 8 個月前」，判準會因為錯誤的理由變綠或變紅）。
const EPOCH_LO = 1.70e9, EPOCH_HI = 1.90e9;
function shiftEpochs(node, delta) {
  if (typeof node === 'number') return node >= EPOCH_LO && node <= EPOCH_HI ? node + delta : node;
  if (Array.isArray(node)) return node.map(v => shiftEpochs(v, delta));
  if (node && typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node)) out[k] = shiftEpochs(node[k], delta);
    return out;
  }
  return node;
}
function loadFixture(name) {
  const raw = JSON.parse(fs.readFileSync(path.join(FIX, `${name}.json`), 'utf8'));
  return raw.boardPos ? raw : { src: 'trtc', board: [], boardPos: raw };
}
const OUTAGE = loadFixture('outage_0652');
const RECOVERED = loadFixture('recovered_0701');

const TRTC_LINES = new Set(['BR', 'R', 'R_XBT', 'G', 'G_XBT', 'O_XINZHUANG', 'O_LUZHOU', 'BL']);
// 幾種「上游新鮮度」情境。extraDelay 讓斷線再老 N 秒（測簽章穩定用）。
function payloadFor(mode, extraDelay = 0) {
  // 🔴 前綴比對，不是等值：recovered-notice 也必須拿恢復後的語料當底。第一版寫成 === 'recovered'，
  // 於是 recovered-notice 悄悄落回斷訊語料，害「恢復說明看得到」那條在錯的情境下變綠。
  const base = mode.startsWith('recovered') ? RECOVERED : OUTAGE;
  const now = Date.now() / 1000;
  const shifted = shiftEpochs(base, now - Number(base.boardPos.at));
  const bp = shifted.boardPos;
  bp.at = now; bp.sourceRevision = now;
  if (mode === 'outage' && extraDelay) // 讓中斷再老一點：只動觀測時戳，快照本身仍是這一秒抓的
    for (const v of bp.vehicles) if (TRTC_LINES.has(v.line) && Number.isFinite(v.observedEpoch)) v.observedEpoch -= extraDelay;
  if (mode === 'y-only') { // 反混算對照：北捷全新鮮、只有環狀線斷
    for (const v of bp.vehicles) v.observedEpoch = TRTC_LINES.has(v.line) ? now : now - 1800;
  }
  // 訊號剛回來的那一輪：後端會多帶一份恢復記錄。數字全部取自 2026-08-15 真事故的實測結果
  // （六條線斷 2011 秒、66 台裡接回 57 台、清掉 9 台），不自己編。
  if (mode === 'recovered-notice') {
    bp.recovery = { atEpoch: now, lines: ['BL', 'BR', 'G', 'O_LUZHOU', 'O_XINZHUANG', 'R'],
      outageSec: 2011, partial: true, removed: 9, before: 77, after: 84,
      confirmed: true, reason: 'trackinfo-outage' };
  }
  return shifted;
}

// ── server ────────────────────────────────────────────────────────────────
let feedMode = 'outage', feedExtraDelay = 0, indexOverride = null;
function makeServer() {
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/__feed') {
      feedMode = url.searchParams.get('m') || 'outage';
      feedExtraDelay = Number(url.searchParams.get('d')) || 0;
      res.statusCode = 200; return res.end('ok');
    }
    if (url.pathname.startsWith('/api/')) {
      res.statusCode = 200; res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/thsr-schedule')
        return res.end(fs.readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
      if (url.pathname === '/api/trtc-live') return res.end(JSON.stringify(payloadFor(feedMode, feedExtraDelay)));
      return res.end('{}');
    }
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!path.resolve(file).startsWith(ROOT) || !fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
    if (path.resolve(file) === INDEX_PATH && indexOverride) {
      res.setHeader('content-type', mime['.html']); return res.end(indexOverride);
    }
    res.setHeader('content-type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
}

// ── 頁面探針 ──────────────────────────────────────────────────────────────
// 「看得到」的判準一律走像素：rect 有面積 + rect 中心的 elementFromPoint 命中自己或自己的子孫。
// 只查 hidden 屬性會被 overflow 裁切、stacking context 封頂整類失效穿過去（心得 24）。
// 🔴 一定要傳「真的函式」給 page.evaluate：傳字串的話 Playwright 當成表達式求值、**參數會被忽略**，
//    回來的是 undefined，而 undefined 會讓每一條斷言都以「找不到元素」的理由變紅（假紅）。
const VISIBLE_PROBE = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return { found: false };
  const r = el.getBoundingClientRect();
  const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
  const hit = document.elementFromPoint(cx, cy);
  const owned = !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  return { found: true, w: Math.round(r.width), h: Math.round(r.height),
    onScreen: r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0,
    hit: owned, text: (el.textContent || '').trim().slice(0, 400),
    cls: String(el.className || ''), hidden: !!el.hidden };
};

async function bootPage(browser, baseUrl, { width = 390, height = 844, group = 'metro', mobile = true } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile,
    deviceScaleFactor: 1, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  await context.addInitScript(() => {
    // 首訪教學卡會蓋住整個地圖，elementFromPoint 會全滅（verify-fixture-stub-drift）
    localStorage.setItem('trainmap-howto-seen', '1');
    localStorage.setItem('trainmap-appearance', 'light');
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  await page.goto(`${baseUrl}?officialroster=1&g=${group}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 60000 });
  await page.waitForFunction(() => state.trtcOfficialRoster?.feedMode === 'official', null, { timeout: 30000 });
  return { context, page, errors };
}

// 換上游 → 叫頁面自己重抓（不是塞 state：塞了就繞過 applyTrtcOfficialRoster 的整條驗收鏈）
async function setFeed(baseUrl, page, mode, extraDelay = 0) {
  await fetch(`${baseUrl}/__feed?m=${mode}&d=${extraDelay}`);
  const before = await page.evaluate(() => state.trtcOfficialRoster?.receivedEpoch || 0);
  await page.evaluate(() => pollTrtcLive());
  await page.waitForFunction(b => (state.trtcOfficialRoster?.receivedEpoch || 0) > b, before, { timeout: 20000 });
  await page.evaluate(() => { renderAlertBanner(); updateMetroBadge(); });
}

// 讀公告現況。🔴 一定要重新展開詳情再讀：renderAlertBanner 在清單變空時只是把 #alertDetail 設成
// hidden、**不清 innerHTML**，直接讀 textContent 會讀到上一輪的殘影（本檔第一版就因此把三條對照組
// 判成紅的）。所以「有沒有在講中斷」一律以「使用者現在真的看得到的字」為準。
async function readAlert(page) {
  const chip = await page.evaluate(VISIBLE_PROBE, '#alertChip');
  await page.evaluate(() => {
    const c = document.getElementById('alertChip'), d = document.getElementById('alertDetail');
    if (d) d.hidden = true;          // 先收起，逼 renderAlertDetail 重畫，殘影不算數
    if (c && !c.hidden) c.click();
  });
  const detailHidden = await page.evaluate(() => !!document.getElementById('alertDetail')?.hidden);
  const firstRow = await page.evaluate(VISIBLE_PROBE, '#alertDetail .ad-row');
  const text = detailHidden ? '' :
    await page.evaluate(() => (document.getElementById('alertDetail')?.textContent || '').trim());
  return { chip, detailHidden, firstRow, text };
}

// 開一張北捷站的看板（板南線 忠孝復興），走產品自己的開板路徑
async function openBoard(page) {
  return page.evaluate(() => {
    const pools = [...(state.lines || []), ...(state.decoLines || [])];
    const ln = pools.find(l => l.id === 'BL');
    if (!ln) return { ok: false, why: 'BL 不在畫面上' };
    const st = ln.stations.find(s => s.name.includes('忠孝復興')) || ln.stations[10];
    state.boardStation = { name: st.name, sys: state.mode === 'sched' ? 'deco' : 'mrt', lat: st.lat, lon: st.lon };
    renderBoard();
    return { ok: true, station: st.name };
  });
}

// ── 一輪完整情境 ──────────────────────────────────────────────────────────
async function runScenario(browser, baseUrl, engine, { label = '', mutation = null } = {}) {
  const out = {};
  await fetch(`${baseUrl}/__feed?m=outage&d=0`);
  const { context, page, errors } = await bootPage(browser, baseUrl);
  try {
    await page.evaluate(() => { renderAlertBanner(); updateMetroBadge(); });

    const a0 = await readAlert(page);
    out.chip = a0.chip; out.detail = a0.firstRow; out.detailAll = a0.text;
    out.badge = await page.evaluate(() => {
      const el = document.getElementById('metroBadge');
      if (!el) return null;
      const cs = getComputedStyle(el), root = getComputedStyle(document.documentElement);
      return { text: (el.textContent || '').trim(), anom: el.classList.contains('anom'),
        color: cs.color, warnInk: root.getPropertyValue('--warn-ink').trim(), hidden: el.hidden };
    });
    out.board = await openBoard(page);
    out.boardNote = await page.evaluate(VISIBLE_PROBE, '#board .sub.stale');

    // 對照組：上游恢復後，同一批斷言必須全部消失
    await setFeed(baseUrl, page, 'recovered');
    await page.evaluate(() => renderBoard());
    out.ctlBadge = await page.evaluate(() => {
      const el = document.getElementById('metroBadge');
      return el ? { text: (el.textContent || '').trim(), anom: el.classList.contains('anom') } : null;
    });
    const a1 = await readAlert(page);
    out.ctlDetail = a1.text; out.ctlChipHidden = !!a1.chip.hidden;
    out.ctlBoardNote = await page.evaluate(() => !!document.querySelector('#board .sub.stale'));

    // 反混算：只有環狀線斷時不得指控臺北捷運
    await setFeed(baseUrl, page, 'y-only');
    out.yOnly = (await readAlert(page)).text;

    out.errors = errors;
  } finally { await context.close(); }
  return out;
}

// 斷訊回歸 → 真的跳訊息（走 draw → display cache → 每秒 tick → showToast → DOM）
async function runResync(browser, baseUrl) {
  await fetch(`${baseUrl}/__feed?m=outage&d=0`);
  const { context, page, errors } = await bootPage(browser, baseUrl);
  try {
    await page.waitForFunction(() => _trtcOfficialDisplay.size > 0, null, { timeout: 20000 });
    // 讓快取看起來像「已經續推 30 分鐘」——這就是斷線半小時後的真實狀態，不是竄改判準
    const primed = await page.evaluate(() => {
      const now = Date.now() / 1000; let n = 0;
      for (const [k, v] of _trtcOfficialDisplay) {
        if (!v.coasted) continue;
        _trtcOfficialDisplay.set(k, { ...v, coastSince: now - 1800 }); n++;
      }
      _trtcOfficialResync.at = 0; _trtcOfficialResync.notifiedAt = 0;
      _trtcOfficialResync.count = 0; _trtcOfficialResync.outageSec = 0;
      document.getElementById('toasts').innerHTML = '';
      return n;
    });
    // 用「帶恢復記錄」的那一輪：2026-08-15 起訊號回來不只跳位置，還會少車，訊息必須講到少車。
    await setFeed(baseUrl, page, 'recovered-notice');
    await page.waitForFunction(() => document.querySelectorAll('#toasts .toast').length > 0,
      null, { timeout: 20000 }).catch(() => {});
    const toast = await page.evaluate(() =>
      [...document.querySelectorAll('#toasts .toast')].map(t => (t.textContent || '').trim()));
    // 🔴 textContent 有字不等於使用者看得到：.toast 預設 white-space:nowrap + text-overflow:ellipsis，
    // 手機 390px 只顯示得下前 20 個字，整句說明會被 … 吃掉（2026-08-15 靠截圖才發現，
    // 當時所有文字斷言都是綠的）。所以這裡量的是真實排版：有沒有橫向溢出、是不是被壓成一行。
    const toastFit = await page.evaluate(() => {
      const t = document.querySelector('#toasts .toast');
      if (!t) return { found: false };
      const line = parseFloat(getComputedStyle(t).lineHeight) || 20;
      return { found: true, clipped: t.scrollWidth > t.clientWidth + 1,
        lines: Math.round(t.clientHeight / line), chars: (t.textContent || '').length };
    });
    const rec = await page.evaluate(() => ({ at: _trtcOfficialResync.at, notified: _trtcOfficialResync.notifiedAt }));
    // 恢復後的常駐說明：toast 幾秒就消失，斷線 33 分鐘後才打開頁面的人只剩這一條看得到。
    const alertAfter = await readAlert(page);
    // 指名去抓「恢復」那一列，不假設它排第一：排序改了也不能讓這條偷偷驗到別的公告。
    const recoveryRow = await page.evaluate(() => {
      const el = [...document.querySelectorAll('#alertDetail .ad-row')]
        .find(row => /即時訊號已恢復/.test(row.textContent || ''));
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return { found: true, onScreen: r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0,
        hit: !!hit && (hit === el || el.contains(hit) || hit.contains(el)),
        text: (el.textContent || '').trim().slice(0, 400) };
    });
    // 對照組：同一份恢復資料但後端沒帶恢復記錄 → 這條常駐說明必須不出現
    await setFeed(baseUrl, page, 'recovered');
    const alertPlain = await readAlert(page);
    return { primed, toast, toastFit, rec, errors,
      recoveryAlert: alertAfter.text, recoveryRow, plainAlert: alertPlain.text };
  } finally { await context.close(); }
}

// 按掉之後不准每分鐘再彈（簽章必須不含分鐘數）
async function runDismiss(browser, baseUrl) {
  await fetch(`${baseUrl}/__feed?m=outage&d=0`);
  const { context, page } = await bootPage(browser, baseUrl, { width: 1280, height: 800, mobile: false });
  try {
    await page.evaluate(() => renderAlertBanner());
    const shown = await page.evaluate(() => !document.getElementById('alertBanner').hidden);
    const title0 = await page.evaluate(() => (document.querySelector('#alertBanner .ab-title')?.textContent || '').trim());
    await page.evaluate(() => document.querySelector('#alertBanner .ab-close')?.click());
    const afterClose = await page.evaluate(() => document.getElementById('alertBanner').hidden);
    await setFeed(baseUrl, page, 'outage', 180); // 中斷再老 3 分鐘 → 標題的分鐘數一定會變
    const title1 = await page.evaluate(() => {
      renderAlertBanner();
      return (document.querySelector('#alertBanner .ab-title')?.textContent || '').trim();
    });
    const stillHidden = await page.evaluate(() => document.getElementById('alertBanner').hidden);
    return { shown, title0, afterClose, title1, stillHidden };
  } finally { await context.close(); }
}

// ── 判準 ──────────────────────────────────────────────────────────────────
function gradeScenario(r, tag, { quiet = false } = {}) {
  const v = [];
  const say = (pass, label, detail) => { v.push(pass); if (!quiet) check(pass, `${tag}${label}`, detail); };
  const hasOutageWord = s => /即時訊號中斷/.test(s || '');

  say(!!r.chip?.found && !r.chip.hidden && r.chip.onScreen && r.chip.hit,
    '⚠ 公告鈕真的出現在畫面上且點得到', JSON.stringify(r.chip));
  say(hasOutageWord(r.detailAll) && /臺北捷運/.test(r.detailAll) &&
      /位置/.test(r.detailAll) && /倒數/.test(r.detailAll),
    '公告內容講明「北捷訊號中斷、位置與倒數都可能不準」',
    (r.detailAll || '').slice(0, 90) + '…');
  say(hasOutageWord(r.detail?.text) , '訊號中斷排在公告第一則（橫幅標題就是它）',
    (r.detail?.text || '').slice(0, 60));
  say(/^官方中斷 \d+ 分$/.test(r.badge?.text || '') && r.badge?.anom === true,
    '徽章轉「官方中斷 N 分」且帶警示色', JSON.stringify(r.badge));
  say(!!r.boardNote?.found && r.boardNote.onScreen && r.boardNote.hit &&
      /臺北捷運/.test(r.boardNote.text) && /分鐘/.test(r.boardNote.text),
    '車站看板上的倒數警語真的看得到', JSON.stringify({ ...r.boardNote, text: (r.boardNote?.text || '').slice(0, 60) }));

  // 對照組
  say(r.ctlBadge?.text === '官方即時' && r.ctlBadge?.anom === false,
    '對照組：上游恢復後徽章回到「官方即時」', JSON.stringify(r.ctlBadge));
  say(!hasOutageWord(r.ctlDetail) && r.ctlChipHidden === true,
    '對照組：上游恢復後 ⚠ 鈕收起、公告不再提中斷',
    `chipHidden=${r.ctlChipHidden}；${(r.ctlDetail || '(空)').slice(0, 40)}`);
  say(r.ctlBoardNote === false, '對照組：上游恢復後看板警語消失', String(r.ctlBoardNote));
  // 反混算
  say(hasOutageWord(r.yOnly) && /環狀線/.test(r.yOnly) && !/臺北捷運/.test(r.yOnly),
    '只有環狀線斷時，不得指控臺北捷運（逐上游分開算）', (r.yOnly || '(空)').slice(0, 80));
  say((r.errors || []).length === 0, '零 pageerror', JSON.stringify(r.errors || []));
  return v;
}

// ── main ──────────────────────────────────────────────────────────────────
const server = makeServer();
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const baseUrl = `http://127.0.0.1:${server.address().port}`;

console.log('== 語料自我檢查 ==');
{
  const o = payloadFor('outage').boardPos, rc = payloadFor('recovered').boardPos;
  const ageOf = (bp, pred) => {
    const xs = bp.vehicles.filter(v => pred(v.line)).map(v => v.observedEpoch);
    return xs.length ? bp.at - Math.max(...xs) : null;
  };
  check(ageOf(o, l => TRTC_LINES.has(l)) > 600, '重放語料的北捷確實在斷線中',
    `北捷最新觀測距今 ${Math.round(ageOf(o, l => TRTC_LINES.has(l)))} 秒`);
  check(Math.abs(ageOf(o, l => l === 'Y')) < 60, '同一輪的環狀線是新鮮的（天然對照組）',
    `環狀線 ${Math.round(ageOf(o, l => l === 'Y'))} 秒`);
  check(Math.abs(ageOf(rc, l => TRTC_LINES.has(l))) < 60, '恢復語料的北捷是新鮮的',
    `${Math.round(ageOf(rc, l => TRTC_LINES.has(l)))} 秒`);
}

const chrome = await chromium.launch({ headless: true });
let webkitBrowser = null;
try {
  console.log('\n== chromium 390px 手機：斷線中的四個提示 ==');
  const base = await runScenario(chrome, baseUrl, 'chromium');
  const baseline = gradeScenario(base, '');

  // 全台同框是開站預設落點，而它走 trtcOutageEntries 的**另一條分支**（deco/decoLines，
  // 不是 freqSel）——只驗捷運分頁等於這條分支一次都沒跑過。
  console.log('\n== 全台同框（開站預設落點）也要看得到 ==');
  {
    await fetch(`${baseUrl}/__feed?m=outage&d=0`);
    const { context, page } = await bootPage(chrome, baseUrl, { group: 'all' });
    try {
      const mode = await page.evaluate(() => ({ mode: state.mode, deco: !!state.deco,
        decoLines: (state.decoLines || []).length }));
      check(mode.deco === true && mode.decoLines > 0, '前提：全台同框確實走裝飾捷運層', JSON.stringify(mode));
      await page.evaluate(() => { renderAlertBanner(); updateMetroBadge(); });
      const a = await readAlert(page);
      check(!!a.chip.found && !a.chip.hidden && a.chip.onScreen && a.chip.hit && /即時訊號中斷/.test(a.text),
        '全台同框：⚠ 鈕出現且內容講中斷', (a.text || '(空)').slice(0, 50));
      await setFeed(baseUrl, page, 'recovered');
      const b = await readAlert(page);
      check(b.chip.hidden === true, '全台同框對照組：恢復後 ⚠ 鈕收起', `chipHidden=${b.chip.hidden}`);
    } finally { await context.close(); }
  }

  console.log('\n== 斷訊回歸：真的跳訊息 ==');
  const rs = await runResync(chrome, baseUrl);
  check(rs.primed > 0, '前提：斷線期間快取裡確實有續推中的車', `${rs.primed} 台`);
  const toastText = (rs.toast || []).join(' / ');
  check(/官方訊號恢復/.test(toastText) && /分鐘/.test(toastText) && /台/.test(toastText),
    '回歸時跳出訊息說明「為什麼車會跳」', toastText.slice(0, 120) || '(沒有任何 toast)');
  check(rs.rec.at > 0 && rs.rec.notified === rs.rec.at, '訊息只發一次（notifiedAt 已對齊）', JSON.stringify(rs.rec));
  // 2026-08-15 起訊號回來會少車（以官方名單為準）。少車比跳位置更容易被當成當機，訊息必須講到。
  check(/9 台/.test(toastText) && /移除/.test(toastText) && /不代表.*停駛/.test(toastText),
    '訊息同時講明「有 N 台推估列車被移除、不代表停駛」', toastText.slice(0, 200) || '(沒有任何 toast)');
  check(rs.toastFit && rs.toastFit.found && rs.toastFit.clipped === false && rs.toastFit.lines >= 3,
    '這則說明在手機 390px 上是整句排開的，沒有被單行截斷（文字斷言照不到這件事）',
    JSON.stringify(rs.toastFit));
  check(/即時訊號已恢復/.test(rs.recoveryAlert || '') && /重新對齊/.test(rs.recoveryAlert || '') &&
    /9 台/.test(rs.recoveryAlert || '') && rs.recoveryRow && rs.recoveryRow.onScreen === true &&
    rs.recoveryRow.hit === true,
    'toast 消失後仍有一條看得到、點得到的常駐說明（斷線後才開頁面的人只剩這條）',
    (rs.recoveryAlert || '(空)').slice(0, 120));
  check(!/即時訊號已恢復/.test(rs.plainAlert || ''),
    '對照組：後端沒帶恢復記錄時不得憑空冒出恢復說明', (rs.plainAlert || '(空)').slice(0, 80));
  check((rs.errors || []).length === 0, '回歸情境零 pageerror', JSON.stringify(rs.errors || []));

  console.log('\n== 按掉公告之後不准每分鐘再彈 ==');
  const dz = await runDismiss(chrome, baseUrl);
  check(dz.shown === true, '桌面橫幅一開始有出現', dz.title0.slice(0, 50));
  check(dz.afterClose === true, '按 × 之後收起', String(dz.afterClose));
  check(dz.title1 !== dz.title0, '前提：分鐘數確實變了（不然這條測不到東西）', `${dz.title0} → ${dz.title1}`);
  check(dz.stillHidden === true, '分鐘數變了也不再自己彈回來', String(dz.stillHidden));

  console.log('\n== 手機第二引擎（WebKit 375px）==');
  webkitBrowser = await webkit.launch({ headless: true });
  const wk = await runScenario(webkitBrowser, baseUrl, 'webkit');
  gradeScenario(wk, 'WebKit ');

  // ── 突變：每條斷言都要有牙 ─────────────────────────────────────────────
  console.log('\n== 突變測試 ==');
  const MUTATIONS = [
    { name: '徽章退回讀後端的 roster.held（2026-08-15 的原始缺陷）',
      apply: s => replaceExactly(s,
        'const stale = official ? trtcOfficialStaleFeeds(roster, Date.now() / 1000) : [];',
        'const stale = official && roster.held ? [{ label: "x", lines: [], ageSec: 999 }] : [];', 'badge'),
      expect: '徽章轉「官方中斷 N 分」且帶警示色' },
    { name: '看板不插警語',
      apply: s => replaceExactly(s, 'eventRowsHtml(st) + staleNote +', 'eventRowsHtml(st) +', 'boardNote'),
      expect: '車站看板上的倒數警語真的看得到' },
    { name: '公告清單不帶訊號中斷條目',
      apply: s => replaceExactly(s, 'return trtcOutageEntries().concat(trtcRecoveryEntries(), official,',
        'return [].concat(official,', 'alert'),
      expect: '⚠ 公告鈕真的出現在畫面上且點得到' },
    { name: '把兩家上游混成一組算新鮮度',
      apply: s => replaceExactly(s,
        `{ label: '環狀線', lines: ['Y'] },`,
        `{ label: '臺北捷運', lines: ['Y'] },`, 'pool'),
      expect: '只有環狀線斷時，不得指控臺北捷運（逐上游分開算）' },
  ];
  const LABELS = ['⚠ 公告鈕真的出現在畫面上且點得到', '公告內容講明「北捷訊號中斷、位置與倒數都可能不準」',
    '訊號中斷排在公告第一則（橫幅標題就是它）', '徽章轉「官方中斷 N 分」且帶警示色',
    '車站看板上的倒數警語真的看得到', '對照組：上游恢復後徽章回到「官方即時」',
    '對照組：上游恢復後 ⚠ 鈕收起、公告不再提中斷', '對照組：上游恢復後看板警語消失',
    '只有環狀線斷時，不得指控臺北捷運（逐上游分開算）', '零 pageerror'];

  for (const m of MUTATIONS) {
    indexOverride = m.apply(INDEX);
    const r = await runScenario(chrome, baseUrl, 'chromium', { mutation: m.name });
    indexOverride = null;
    const verdicts = gradeScenario(r, '', { quiet: true });
    const idx = LABELS.indexOf(m.expect);
    const reds = LABELS.filter((_, i) => !verdicts[i]);
    check(verdicts[idx] === false, `突變「${m.name}」→ 該轉紅的轉紅了`,
      reds.length ? `實際轉紅：${reds.join('、')}` : '沒有任何一條轉紅');
  }

  // 簽章突變單獨跑（它只影響「按掉之後」那條）
  indexOverride = replaceExactly(INDEX,
    `return list.map(a => a.sig ? '§sig:' + a.sig : (a.title || '') + '|' + (a.start || '')).join('§');`,
    `return list.map(a => (a.title || '') + '|' + (a.sig || a.start || '')).join('§');`, 'sig');
  const dz2 = await runDismiss(chrome, baseUrl);
  indexOverride = null;
  check(dz2.stillHidden === false, '突變「簽章含分鐘數」→「按掉不再彈」必須轉紅',
    `stillHidden=${dz2.stillHidden}`);

  // 恢復通知的兩個介面各自單獨突變（它們只在 runResync 那條路徑上看得到）
  indexOverride = replaceExactly(INDEX,
    `+ (removed ? \`另有 <b>\${removed} 台</b>推估中的列車因為不在官方名單上而移除，這不代表它們停駛。\` : '');`,
    `+ '';`, 'toastRemoved');
  const mr1 = await runResync(chrome, baseUrl);
  indexOverride = null;
  const mr1Text = (mr1.toast || []).join(' / ');
  check(!(/9 台/.test(mr1Text) && /移除/.test(mr1Text)),
    '突變「訊息不提被移除的車」→「講明有 N 台被移除」必須轉紅', mr1Text.slice(0, 100) || '(無 toast)');

  indexOverride = replaceExactly(INDEX,
    'return trtcOutageEntries().concat(trtcRecoveryEntries(), official,',
    'return trtcOutageEntries().concat(official,', 'recoveryEntry');
  const mr2 = await runResync(chrome, baseUrl);
  indexOverride = null;
  check(!(mr2.recoveryRow && mr2.recoveryRow.found),
    '突變「公告清單不帶恢復說明」→「常駐說明看得到」必須轉紅',
    (mr2.recoveryAlert || '(空)').slice(0, 80));
} finally {
  await chrome.close();
  if (webkitBrowser) await webkitBrowser.close();
  server.close();
}

console.log(`\n${failures ? `❌ 北捷斷線提示 UI：${failures} 項未過` : '✅ 北捷斷線提示 UI：全數通過'}`);
process.exit(failures ? 1 : 0);
