#!/usr/bin/env node
// 沿線小故事（網站版）的瀏覽器驗收：真的跟一班車、撥到有故事的那一段，看字幕卡、試播邀請、配音、
// 車次卡那一列、沿途清單、車站看板那一列、全文卡、Esc 收面板、放空版位置、手機四寬度、英文介面不出現。
// 一律無視窗：Chromium 走 channel:'chrome' headless、另跑 WebKit。HTML 回應帶上 _headers 的正式 CSP，
// 這樣「配音從 tiles.railisland.tw 播」在本機也量得到 CSP 有沒有擋（本機 server 平常不送 CSP）。
// 用法：node scripts/verify_rail_stories_browser.mjs [--shots <資料夾>] [--engine chromium|webkit] [--base https://railisland.tw/]
//   --base：改開這個網址（出貨後對正式站收貨用；CSP 由該站自己送，/api 也是真的）。
//   配音要連外網抓 tiles.railisland.tw 的 mp3；抓不到時那一項記「沒量到」，不算紅。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const SHOTS = opt('--shots');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const ONLY = opt('--engine');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.pbf': 'application/x-protobuf' };
const csp = /Content-Security-Policy:\s*(.+)/.exec(readFileSync(path.join(ROOT, '_headers'), 'utf8'))?.[1]?.trim();
if (!csp) { console.error('讀不到 _headers 的 CSP'); process.exit(1); }
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/data/rail_weather_notice.json') { res.setHeader('content-type', 'application/json'); return res.end('null'); }
  if (url.pathname.startsWith('/api/')) { res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  const ext = path.extname(fp);
  res.setHeader('content-type', MIME[ext] || 'application/octet-stream');
  if (ext === '.html') res.setHeader('content-security-policy', csp);
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = opt('--base') || `http://127.0.0.1:${server.address().port}/`;
if (opt('--base')) console.log(`對 ${BASE} 驗收（不用本機 server）`);

const results = [];
const ok = (name, pass, detail) => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? '✓' : '✗'} ${name}${detail != null ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); };
const note = (name, detail) => { results.push({ name, pass: true, note: true, detail }); console.log(`· ${name}  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); };

const T2173 = 12 * 3600 + 31 * 60 + 50; // 2173 開過三義、進三義–泰安第一則（verify_rail_stories 量過 12:31:45 開始）

async function boot(browser, { width, height, mobile, lang = 'zh-TW', storage = {}, url }) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: !!mobile, hasTouch: !!mobile, locale: lang === 'en' ? 'en-US' : 'zh-TW', timezoneId: 'Asia/Taipei' });
  await context.addInitScript(s => { try { localStorage.setItem('trainmap-howto-seen', '1'); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); } catch (e) {} }, storage);
  const page = await context.newPage();
  const errors = [], cspHits = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { const t = m.text(); if (/Content Security Policy|Refused to load/i.test(t)) cspHits.push(t.slice(0, 200)); });
  await page.goto(BASE + (url || `?g=all&train=2173&t=12:31&lang=${lang}`), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state === 'object' && state.ready && window.RailStoriesUI, null, { timeout: 90000 });
  return { context, page, errors, cspHits };
}
async function followAt(page, train, sec) {
  await page.waitForFunction(t => state.followTrain && String(state.followTrain.train) === t, train, { timeout: 60000 }).catch(() => {});
  await page.evaluate(({ train, sec }) => {
    if (!state.followTrain || String(state.followTrain.train) !== train) { const tr = findTrain(train); if (tr) setFollow(tr); }
    state.playing = false; setSimSec(sec);
  }, { train, sec });
}
// 字幕卡跟哪些常駐介面重疊（面積 > 4px² 才算），回傳重疊的選擇器
async function overlaps(page, sel = '#storyCap') {
  await page.waitForTimeout(2200); // 字幕每秒照版面重排一次；剛切模式時旁邊的卡還在變高，等兩拍再量
  return page.evaluate(sel => {
    const cap = document.querySelector(sel);
    if (!cap || cap.hidden) return { hidden: true };
    const c = cap.getBoundingClientRect();
    const hits = [];
    const qs = ['#randBtn', '.controls', '#followPanel', '#freqCard', '#trainCard', '#statBadge', '#mapActions > *', '#followLockBtn', '#viewSettingsBtn',
      '#viewDock .view-rail', '.board:not([hidden])', '#tabBar', '.tabbar', '#mobileTabs'];
    for (const q of qs) for (const e of document.querySelectorAll(q)) {
      if (e === cap || e.hidden || e.closest('[hidden]')) continue;
      const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
      const ix = Math.min(c.right, r.right) - Math.max(c.left, r.left), iy = Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top);
      if (ix > 2 && iy > 2) hits.push(q + (e.id ? '#' + e.id : '') + ` ${Math.round(ix)}×${Math.round(iy)}`);
    }
    const inView = c.left >= -1 && c.top >= -1 && c.right <= innerWidth + 1 && c.bottom <= innerHeight + 1;
    const rb = document.querySelector('#randBtn'), rbr = rb && !rb.hidden ? rb.getBoundingClientRect() : null;
    const badge = document.querySelector('#statBadge'), br = badge ? badge.getBoundingClientRect() : null;
    const ctl = document.querySelector('.controls'), cr = ctl ? ctl.getBoundingClientRect() : null;
    const fp = document.querySelector('#followPanel'), fr = fp && !fp.hidden ? fp.getBoundingClientRect() : null;
    return { hits, inView, cap: [c.left, c.top, c.right, c.bottom].map(Math.round), randTop: rbr && rbr.height ? Math.round(rbr.top) : null,
      badgeBottom: br && br.height ? Math.round(br.bottom) : null, ctlTop: cr && cr.height ? Math.round(cr.top) : null, fpTop: fr && fr.height ? Math.round(fr.top) : null,
      cls: cap.className, overflow: document.documentElement.scrollWidth - innerWidth };
  }, sel);
}
const capInfo = page => page.evaluate(() => {
  const el = document.getElementById('storyCap'); const S = window.RailStoriesUI._s;
  return { visible: !!el && !el.hidden, name: el?.querySelector('.sc-name')?.textContent || '', text: el?.querySelector('.sc-text')?.textContent || '',
    ask: !!el && !el.querySelector('.sc-ask').hidden, trial: !!S.play?.trial, voice: !!S.play?.voice, playing: !!S.play,
    story: S.play?.pass?.story?.id || null, auto: S.auto, invite: localStorage.getItem('trainmap-story-invite'), autoKey: localStorage.getItem('trainmap-story-auto') };
});
const waitCap = (page, ms = 15000, amb = null) => page.waitForFunction(amb => { const el = document.getElementById('storyCap');
  return el && !el.hidden && window.RailStoriesUI._s.play && (amb == null || el.classList.contains('sc-ambient') === amb); }, amb, { timeout: ms }).then(() => true, () => false);
// 放空：先切跟車視角進場，再換成要量的那班、停鐘撥到有故事的時刻（自動導覽會換車，所以關掉）
async function enterAmbient(page, sec) {
  await page.evaluate(() => { setAmbientStyle('follow'); setAmbient(true); });
  await page.waitForTimeout(800);
  await page.evaluate(sec => { setAutoTour(false); const tr = findTrain('2173'); if (tr) setFollow(tr, true); state.playing = false; setSimSec(sec); }, sec);
}
const near = (a, b, gap) => a != null && b != null && a <= b && b - a <= gap; // a 在 b 的上方（或左方）、相距不超過 gap
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

async function desktop(browser, E) {
  const W = 1440, H = 900;
  const { context, page, errors, cspHits } = await boot(browser, { width: W, height: H });
  await followAt(page, '2173', T2173);
  // 車次卡那一列
  const tc = await page.waitForFunction(() => { const e = document.getElementById('tcStories'); return e && !e.hidden && e.textContent; }, null, { timeout: 30000 }).then(h => h.jsonValue(), () => '');
  ok(`${E} 電腦 車次卡「沿途故事」列`, /沿途故事\s*71 則/.test(tc), tc);
  // 第一次跟車＝試播一則、只出字、下面有邀請
  const got = await waitCap(page);
  const c1 = await capInfo(page);
  ok(`${E} 電腦 第一次跟車試播（只出字＋邀請）`, got && c1.trial && c1.ask && !c1.voice && c1.invite === '1', c1);
  const lab = await page.evaluate(() => { const p = window.RailStoriesUI._s.play, el = document.querySelector('#storyCap .sc-name');
    return { index: p?.index, label: el?.textContent, want: p ? (p.index === 0 ? p.pass.tag : p.pass.story.name) : null }; });
  ok(`${E} 電腦 字幕上面小字：名稱那一頁放地點與哪側看得到、之後放名稱（同 App）`, lab.label && lab.label === lab.want, lab);
  const o1 = await overlaps(page);
  ok(`${E} 電腦跟車 字幕緊貼「隨機跟隨」上面、不壓任何介面`, !o1.hidden && o1.hits.length === 0 && o1.inView && near(o1.cap[3], o1.randTop, 24) && !/sc-mobile|sc-ambient/.test(o1.cls), o1);
  await shot(page, `${E}-desktop-follow-trial`);
  // 打開＝開關打開、這一則從頭念（念不念得出來要看外網）
  await page.locator('#storyCap .sc-ask .yes').click();
  const c2 = await capInfo(page);
  ok(`${E} 電腦 按「打開」→ 開關開、這一則從頭、不再是試播`, c2.auto && c2.autoKey === '1' && c2.invite === 'done' && c2.playing && !c2.trial && c2.story === c1.story, c2);
  const rowOn = await page.evaluate(() => { const r = document.getElementById('storyRow'); return r && r.getAttribute('aria-checked'); });
  ok(`${E} 電腦 觀看設定那一列跟著變成開`, rowOn === 'true', rowOn);
  const voice = await page.waitForFunction(() => window.RailStoriesUI._s.play?.voice, null, { timeout: 20000 }).then(() => true, () => false);
  const a = await page.evaluate(() => { const au = window.RailStoriesUI._s.audio; return au ? { src: au.currentSrc || au.src, rs: au.readyState, err: au.error && au.error.code, dur: au.duration } : null; });
  if (voice) ok(`${E} 電腦 配音從 tiles.railisland.tw 播起來、字幕改跟著聲音`, /^https:\/\/tiles\.railisland\.tw\/rail-stories\/voice\//.test(a?.src || '') && cspHits.length === 0, { a, cspHits });
  else note(`${E} 電腦 配音沒播起來（可能是無視窗沒有音效裝置或連不到外網）`, { a, cspHits });
  if (cspHits.length) ok(`${E} 電腦 沒有 CSP 擋下任何東西`, false, cspHits);
  await shot(page, `${E}-desktop-follow-voice`);
  // 沿途清單
  await page.locator('#tcStories').click();
  const list = await page.evaluate(() => { const p = document.getElementById('storyPanel'); return { open: !p.hidden, title: p.querySelector('h3')?.textContent, n: p.querySelectorAll('.sp-li').length,
    now: p.querySelectorAll('.sp-li.now').length, past: p.querySelectorAll('.sp-li.past').length, cap: !document.getElementById('storyCap').hidden }; });
  ok(`${E} 電腦 沿途清單 71 則、有「現在」、字幕先收起`, list.open && list.n === 71 && list.now >= 1 && !list.cap, list);
  await shot(page, `${E}-desktop-list`);
  await page.locator('#storyPanel .sp-seg button[data-seen="1"]').click();
  const seen = await page.evaluate(() => ({ n: document.querySelectorAll('#storyPanel .sp-li').length, want: window.RailStoriesUI._s.follow.seenCount }));
  ok(`${E} 電腦 「車上看得到」篩選`, seen.n === seen.want && seen.n > 0 && seen.n < 71, seen);
  await page.locator('#storyPanel .sp-li').first().click();
  const card = await page.evaluate(() => { const p = document.getElementById('storyPanel'); return { name: p.querySelector('.sp-name')?.textContent, text: (p.querySelector('.sp-text')?.textContent || '').length, src: p.querySelectorAll('.sp-src a').length, foot: p.querySelector('.sp-foot')?.textContent }; });
  ok(`${E} 電腦 全文卡（名稱、全文、出處連結、回清單）`, card.name && card.text > 20 && card.src >= 1 && /沿途 71 則故事/.test(card.foot || ''), card);
  await shot(page, `${E}-desktop-card`);
  await page.locator('#storyPanel .sp-foot').click();
  const back = await page.evaluate(() => document.querySelectorAll('#storyPanel .sp-li').length);
  ok(`${E} 電腦 從全文卡回到清單（保留篩選）`, back === seen.n, back);
  await page.locator('#storyPanel .sp-li').first().focus();
  await page.keyboard.press('Escape');
  const esc = await page.evaluate(() => document.getElementById('storyPanel').hidden);
  ok(`${E} 電腦 Esc 收起故事面板`, esc, esc);
  // 車站看板那一列：挑一站有好幾則（開清單）、一站只有一則（同 App 直接開全文）
  const stns = await page.evaluate(() => {
    const S = window.RailStoriesUI._s, n = new Map();
    for (const x of S.book.stories) if (x.system === 'tra_sched' && x.stations.length === 1) n.set(x.stations[0], (n.get(x.stations[0]) || 0) + 1);
    const all = [...n.entries()];
    return { many: all.sort((a, b) => b[1] - a[1])[0], one: all.find(e => e[1] === 1) };
  });
  const openStn = name => page.evaluate(name => {
    const alt = name.replace(/台/g, '臺');
    const ln = state.trackLines.find(l => l.sys === 'tra_sched' && l.stations.some(x => x.name === name || x.name === alt));
    const x = ln && ln.stations.find(v => v.name === name || v.name === alt);
    openBoard({ name: x ? x.name : name, sys: 'tra_sched', lat: x ? x.lat : 24.44, lon: x ? x.lon : 120.74 });
  }, name);
  const browText = () => page.waitForFunction(() => { const b = document.querySelector('#board:not([hidden]) .story-brow'); return b && b.textContent; }, null, { timeout: 15000 }).then(h => h.jsonValue(), () => '');
  await openStn(stns.many[0]);
  const brow = await browText();
  // 跟車中字幕還在播時開看板：面板一換手字幕就要讓開，不能等下一秒的重排（量 0.2 秒時）
  const quick = await page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 200));
    const cap = document.getElementById('storyCap'), bd = document.getElementById('board');
    if (!cap || cap.hidden || !window.RailStoriesUI._s.play) return { noCap: true };
    const a = cap.getBoundingClientRect(), b = bd.getBoundingClientRect();
    return { capRight: Math.round(a.right), boardLeft: Math.round(b.left), overlap: a.right > b.left + 2 && a.bottom > b.top && a.top < b.bottom };
  });
  if (quick.noCap) note(`${E} 電腦 開看板時字幕剛好沒在播，沒量到讓位速度`, quick);
  else ok(`${E} 電腦 開看板 0.2 秒內字幕就讓開看板`, !quick.overlap, quick);
  ok(`${E} 電腦 車站看板「這站的故事」列（${stns.many[0]}，${stns.many[1]} 則）`, brow.includes('這站的故事') && brow.includes(stns.many[1] + ' 則'), brow);
  await shot(page, `${E}-desktop-board`);
  await page.locator('#board .story-brow').click();
  const sv = await page.evaluate(() => { const p = document.getElementById('storyPanel'); return { open: !p.hidden, board: !document.getElementById('board').hidden, title: p.querySelector('h3')?.textContent, n: p.querySelectorAll('.sp-li').length }; });
  ok(`${E} 電腦 這站的故事清單（看板讓位）`, sv.open && !sv.board && sv.n === stns.many[1] && sv.title.includes(stns.many[0] + '站的故事'), sv);
  await page.locator('#storyPanel .sp-li').first().click();
  await page.locator('#storyPanel .sp-foot[data-back="stn"]').click();
  await page.locator('#storyPanel .sp-foot[data-back="board"]').click();
  const reb = await page.evaluate(() => ({ board: !document.getElementById('board').hidden, story: !document.getElementById('storyPanel').hidden }));
  ok(`${E} 電腦 全文卡 → 這站的故事 → 回看板`, reb.board && !reb.story, reb);
  await openStn(stns.one[0]);
  const brow1 = await browText();
  await page.locator('#board .story-brow').click();
  const one = await page.evaluate(() => { const p = document.getElementById('storyPanel'); return { name: p.querySelector('.sp-name')?.textContent, foot: p.querySelector('.sp-foot')?.textContent }; });
  ok(`${E} 電腦 只有一則的站（${stns.one[0]}）直接開全文、可回看板`, !!one.name && brow1.includes(one.name) && /回.*看板/.test(one.foot || ''), { brow1, one });
  await page.locator('#storyPanel .sp-foot[data-back="board"]').click();
  ok(`${E} 電腦 全文卡 → 回看板`, await page.evaluate(() => !document.getElementById('board').hidden && document.getElementById('storyPanel').hidden));
  ok(`${E} 電腦 沒有 pageerror`, errors.length === 0, errors.slice(0, 3));
  await context.close();
}

async function desktopAmbient(browser, E) {
  const { context, page, errors } = await boot(browser, { width: 1440, height: 900, storage: { 'trainmap-story-auto': '1', 'trainmap-story-invite': 'done' } });
  await followAt(page, '2173', T2173);
  await enterAmbient(page, T2173 + 120);
  const got = await waitCap(page, 20000, true);
  const o = await overlaps(page);
  const pe = await page.evaluate(() => getComputedStyle(document.getElementById('storyCap')).pointerEvents);
  ok(`${E} 電腦放空 開關開著會播、緊貼站台帶上面、不吃點擊、不壓介面`, got && /sc-ambient/.test(o.cls) && pe === 'none' && o.hits.length === 0 && o.inView && near(o.cap[3], o.ctlTop, 24),
    Object.assign({ pe }, o));
  await shot(page, `${E}-desktop-ambient`);
  // 群車視角不播
  await page.evaluate(() => setAmbientStyle('hotspot'));
  await page.waitForTimeout(2500);
  const hot = await capInfo(page);
  ok(`${E} 電腦放空 切到群車就停`, !hot.playing && !hot.visible, hot);
  ok(`${E} 電腦放空 沒有 pageerror`, errors.length === 0, errors.slice(0, 3));
  await context.close();
}

async function mobileCase(browser, E, width) {
  const height = width >= 768 ? 1024 : 812;
  const { context, page, errors } = await boot(browser, { width, height, mobile: true });
  await followAt(page, '2173', T2173);
  const got = await waitCap(page, 20000);
  const c = await capInfo(page);
  const o = await overlaps(page);
  const isMob = await page.evaluate(() => matchMedia(MOBILE_MQ).matches);
  const posOk = isMob ? near(o.badgeBottom, o.cap[1], 24) : near(o.cap[3], o.randTop, 24);
  ok(`${E} ${width}px 跟車試播出現、位置對、不壓介面、沒有橫向捲動`, got && c.trial && o.hits.length === 0 && o.inView && posOk && o.overflow <= 0, Object.assign({ isMob }, o));
  await shot(page, `${E}-m${width}-follow`);
  // 真觸控點「不用」＝不再問
  await page.locator('#storyCap .sc-ask .no').tap();
  const c2 = await capInfo(page);
  ok(`${E} ${width}px 點「不用」收起、不再問`, !c2.visible && c2.invite === 'done' && !c2.auto, c2);
  // 放空（開關打開）：手機在左下合併卡上面
  await context.close();
  const b = await boot(browser, { width, height, mobile: true, storage: { 'trainmap-story-auto': '1', 'trainmap-story-invite': 'done' } });
  await followAt(b.page, '2173', T2173);
  await enterAmbient(b.page, T2173 + 120);
  const got2 = await waitCap(b.page, 20000, true);
  const o2 = await overlaps(b.page);
  const pos2 = isMob ? near(o2.cap[3], o2.fpTop, 24) : near(o2.cap[3], o2.ctlTop, 24);
  ok(`${E} ${width}px 放空 字幕緊貼左下卡上面、不壓介面`, got2 && /sc-ambient/.test(o2.cls) && o2.hits.length === 0 && o2.inView && pos2, o2);
  await shot(b.page, `${E}-m${width}-ambient`);
  ok(`${E} ${width}px 沒有 pageerror`, errors.length === 0 && b.errors.length === 0, errors.concat(b.errors).slice(0, 3));
  await b.context.close();
}

async function english(browser, E) {
  const { context, page, errors } = await boot(browser, { width: 1440, height: 900, lang: 'en', storage: { 'trainmap-story-auto': '1' } });
  await followAt(page, '2173', T2173);
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => ({
    tc: !document.getElementById('tcStories').hidden, row: (() => { const e = document.getElementById('storyRow'); return !!e && !e.hidden; })(),
    cap: (() => { const e = document.getElementById('storyCap'); return !!e && !e.hidden; })(), book: !!window.RailStoriesUI._s.book,
    help: HELP_GROUPS.flatMap(g => g.secs).filter(helpSecOk).some(s => s.key === 'stories'),
    storyReq: performance.getEntriesByType('resource').some(x => /rail_stories|rail_story_directions/.test(x.name)),
  }));
  ok(`${E} 英文介面 不出現任何故事入口、不載故事資料、說明中心不列`, !r.tc && !r.row && !r.cap && !r.book && !r.help && !r.storyReq, r);
  const zhHelp = await page.evaluate(() => { const was = I18N_LANG; I18N_LANG = 'zh-TW'; const v = HELP_GROUPS.flatMap(g => g.secs).filter(helpSecOk).some(s => s.key === 'stories'); I18N_LANG = was; return v; });
  ok(`${E} 中文介面 說明中心有「沿線小故事」`, zhHelp, zhHelp);
  ok(`${E} 英文介面 沒有 pageerror`, errors.length === 0, errors.slice(0, 3));
  await context.close();
}

async function directions(browser, E) {
  const { context, page, errors } = await boot(browser, { width: 1440, height: 900, url: '?g=all&train=4172&t=12:00&lang=zh-TW', storage: { 'trainmap-story-invite': 'done' } });
  const out = {};
  for (const train of ['4172', '4171']) {
    const r = await page.evaluate(async t => {
      const tr = findTrain(t); if (!tr) return { missing: true };
      setFollow(tr); state.playing = false;
      await new Promise(r => setTimeout(r, 2500));
      const f = window.RailStoriesUI._s.follow;
      const p = f && f.passes.find(x => x.story.id === 'n-024');
      return { count: f && f.count, n024: p ? { dir: p.direction, tag: p.tag, from: p.from, to: p.to } : null };
    }, train);
    out[train] = r;
  }
  const s = out['4172']?.n024, n = out['4171']?.n024;
  if (out['4172']?.missing || out['4171']?.missing) note(`${E} 4171／4172 今天沒開，方向版本只靠 verify_rail_stories 量`, out);
  else ok(`${E} 南下 4172 用南下版、北上 4171 用北上版（n-024）`, s && n && s.dir !== n.dir && /左側/.test(s.tag), out);
  ok(`${E} 方向 沒有 pageerror`, errors.length === 0, errors.slice(0, 3));
  await context.close();
}

// 捷運：網站的捷運沒有逐站時刻，照跟車卡的下一站＋終點算方向（同 App metroRoute）；跟車卡要有「沿途故事」那一列。
// 高捷紅線、橘線各挑正在跑的班次（兩個方向都挑），量：跟車卡那一列、清單、同一則故事兩個方向用不同的方向版本。
async function metro(browser, E) {
  const { context, page, errors } = await boot(browser, { width: 1440, height: 900, url: '?g=all&t=12:31&lang=zh-TW', storage: { 'trainmap-story-invite': 'done' } });
  const runs = await page.evaluate(async () => {
    const out = [];
    for (const id of ['KR', 'KO']) {
      const ln = state.decoLines.find(l => l.id === id && freqSysIdOf(l) === 'krtc');
      if (!ln) { out.push({ id, missing: true }); continue; }
      const live = ln._tt.filter(tr => freqTrainInfoAt(ln, tr, state.simSec));
      const seenDest = new Set();
      for (const tr of live) {
        const info = freqTrainInfoAt(ln, tr, state.simSec);
        if (!info || !info.termName || !info.nextName || seenDest.has(info.termName)) continue; // 停在端點、還沒有終點資訊的班次不挑
        seenDest.add(info.termName);
        setFreqFollow({ ln, tr });
        await new Promise(r => setTimeout(r, 2600));
        const S = window.RailStoriesUI._s, f = S.follow, row = document.getElementById('fcStories');
        out.push({ id, term: info.termName, next: info.nextName, kind: S.ctx && S.ctx.kind, count: f ? f.count : 0,
          row: row && !row.hidden ? row.textContent : '', dirs: f ? f.passes.filter(p => p.direction).map(p => p.story.id + ':' + p.direction.label) : [] });
        if (seenDest.size >= 2) break;
      }
    }
    return out;
  });
  const good = runs.filter(r => r.kind === 'metro' && r.count > 0);
  ok(`${E} 高捷 跟車卡「沿途故事」列（紅、橘線兩個方向）`, good.length >= 3 && good.every(r => /沿途故事\s*\d+ 則/.test(r.row)), runs.map(r => ({ id: r.id, term: r.term, kind: r.kind, count: r.count, row: r.row })));
  const byStory = new Map();
  for (const r of good) for (const d of r.dirs) { const [id, label] = d.split(':'); if (!byStory.has(id)) byStory.set(id, new Set()); byStory.get(id).add(label); }
  const both = [...byStory].filter(([, v]) => v.size >= 2).map(([k, v]) => k + '=' + [...v].join('/'));
  ok(`${E} 高捷 同一則故事兩個方向用不同方向版本`, both.length >= 1, both);
  if (good.length) {
    await page.locator('#fcStories').click();
    const list = await page.evaluate(() => { const p = document.getElementById('storyPanel'); return { open: !p.hidden, title: p.querySelector('h3')?.textContent, n: p.querySelectorAll('.sp-li').length, nost: p.querySelectorAll('.sp-li.nost').length }; });
    ok(`${E} 高捷 從跟車卡開沿途清單（沒有時刻欄）`, list.open && list.n > 0 && list.nost === list.n && /沿途故事/.test(list.title || ''), list);
    await shot(page, `${E}-desktop-metro-list`);
  }
  ok(`${E} 高捷 沒有 pageerror`, errors.length === 0, errors.slice(0, 3));
  await context.close();
}

const engines = [['chromium', () => chromium.launch({ channel: 'chrome', headless: true })], ['webkit', () => webkit.launch({ headless: true })]]
  .filter(([n]) => !ONLY || n === ONLY);
for (const [E, launch] of engines) {
  const browser = await launch();
  try {
    for (const [label, fn] of [['desktop', () => desktop(browser, E)], ['ambient', () => desktopAmbient(browser, E)],
      ...[360, 375, 414, 768].map(w => [`m${w}`, () => mobileCase(browser, E, w)]), ['english', () => english(browser, E)], ['directions', () => directions(browser, E)], ['metro', () => metro(browser, E)]]
      .filter(([label]) => !opt('--case') || opt('--case').split(',').includes(label))) {
      try { await fn(); } catch (e) { ok(`${E} ${label} 跑完沒有拋例外`, false, String(e && e.message || e).slice(0, 300)); }
    }
  } finally { await browser.close(); }
}
server.close();
const bad = results.filter(r => !r.pass);
console.log(`\nverify_rail_stories_browser：${results.filter(r => r.pass && !r.note).length} 項通過、${bad.length} 項失敗、${results.filter(r => r.note).length} 項沒量到`);
process.exit(bad.length ? 1 : 0);
