// 看車庫放音樂：真的點進車庫，量 <audio> 有沒有在走（currentTime），不是看旗標。
// 規則同 App（garageOpened／garageClosed）：開關開著、沒在放才換一首開播；關過不放；在放的不動；車庫開的才收。
// 自己起 dev_server：它支援 Range，python http.server 不支援，WebKit 拿不到 Range 會放不起來，那是假紅。
// 自動播放限制：Playwright 的 evaluate 帶 userGesture，輪詢一次頁面就算有過手勢，所以「沒手勢」那段只聽 console、不碰頁面；
// 其他段落的頁面已經被碰過，改靠 window.event 確認 play() 在真實點擊的同一拍。
import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, pass, info = '') => {
  results.push({ name, pass: !!pass });
  console.log(pass ? 'PASS' : 'FAIL', name, pass ? '' : JSON.stringify(info));
};

const server = spawn('node', ['scripts/dev_server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
const BASE = await new Promise((ok, no) => {
  server.stdout.on('data', d => { const m = /http:\/\/127\.0\.0\.1:\d+/.exec(d); if (m) ok(m[0] + '/'); });
  server.on('exit', c => no(Error('dev server 退出 ' + c)));
});

async function boot(b, { opts = {}, pref = null, query = '?lang=zh-TW', blockPlay = false, hands = true } = {}) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW', ...opts });
  ctx.setDefaultTimeout(15000);
  await ctx.addInitScript(({ pref, blockPlay }) => {
    localStorage.setItem('trainmap-howto-seen', '1');
    if (pref) localStorage.setItem('trainmap-music', JSON.stringify(pref));
    window.__rejected = [];
    addEventListener('unhandledrejection', e => window.__rejected.push(String(e.reason)));
    window.__plays = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__plays.push({ type: window.event?.type, trusted: window.event?.isTrusted });
      const result = blockPlay ? Promise.reject(new DOMException('blocked', 'NotAllowedError')) : play.call(this);
      result.then(() => console.log('play:ok'), e => console.log('play:' + e.name));
      return result;
    };
  }, { pref, blockPlay });
  await ctx.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.origin === new URL(BASE).origin) return r.continue();
    if (u.pathname.includes('style') || u.pathname.endsWith('/liberty') || u.pathname.endsWith('/dark')) return r.fulfill({ json: { version: 8, sources: {}, layers: [] } });
    return r.abort();
  });
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', e => errors.push(e.message));
  const played = new Promise(ok => { p.on('console', m => { if (m.text().startsWith('play:')) ok(m.text().slice(5)); }); setTimeout(ok, 90000, 'timeout'); });
  await p.goto(BASE + query);
  if (hands) await p.waitForFunction(() => typeof state !== 'undefined' && state.ready && state.music && state.music.list.length, null, { timeout: 60000 });
  return { ctx, p, errors, played };
}

const hit = (p, sel, touch) => touch ? p.locator(sel).tap() : p.locator(sel).click();
async function openMore(p, touch) {
  await hit(p, await p.locator('#tabMore').isVisible() ? '#tabMore' : '#toolsFab', touch);
  await p.waitForFunction(() => document.body.classList.contains('tools-open'));
}
async function enter(p, touch = false) {
  if (!await p.evaluate(() => document.body.classList.contains('tools-open'))) await openMore(p, touch);
  await p.locator('#moreSheet [data-act="garage"]').scrollIntoViewIfNeeded();
  await hit(p, '#moreSheet [data-act="garage"]', touch);
  await p.waitForFunction(() => TrainGarage.isOpen);
}
const snap = p => p.evaluate(() => {
  const m = state.music, a = m.audio, g = document.querySelector('.g-music');
  return { paused: a.paused, t: a.currentTime, vol: a.volume, want: m.vol, src: decodeURI(a.src), ready: a.readyState, enabled: m.enabled,
    pref: JSON.parse(localStorage.getItem('trainmap-music') || '{}').enabled, map: document.getElementById('musicBtn').classList.contains('playing'),
    garage: g && g.getAttribute('aria-pressed'), scene: document.querySelector('.g-sf-music')?.getAttribute('aria-pressed') };
});
// 在放＝沒暫停、currentTime 真的往前走、音量淡到設定值。
async function sounding(p) {
  await p.waitForFunction(() => { const a = state.music.audio; return !a.paused && a.readyState >= 2 && a.currentTime > 0; }, null, { timeout: 15000 }).catch(() => {});
  const a = await snap(p);
  await p.waitForTimeout(1500);
  const b = await snap(p);
  return !b.paused && b.t > a.t + .5 && Math.abs(b.vol - b.want) < .02;
}
// 沒在放＝淡出走完之後已暫停、currentTime 不動。場景頁 3D 忙的時候淡出的計時器會拖長，等暫停，不等固定秒數。
async function silent(p) {
  await p.waitForTimeout(1200);
  await p.waitForFunction(() => state.music.audio.paused, null, { timeout: 12000 }).catch(() => {});
  const a = await snap(p);
  await p.waitForTimeout(500);
  const b = await snap(p);
  return a.paused && b.paused && a.t === b.t;
}
// 桌面版地圖上 #musicBtn 就在工具列，手機收在「更多」裡。
async function mapMusic(p) {
  if (await p.locator('#musicBtn').isVisible()) return p.click('#musicBtn');
  await openMore(p);
  await p.click('#moreSheet [data-proxy="musicBtn"]');
}
const quiet = async (p, errors) => !errors.length && !(await p.evaluate(() => window.__rejected)).length;

// 新鈕：跟車庫裡其他控件不相交、在畫面內、點得到；頁面不橫向溢出。
const layout = (p, sel) => p.evaluate(sel => {
  const el = document.querySelector(sel), r = el.getBoundingClientRect(), dlg = document.getElementById('trainGarage');
  const scope = el.closest('.g-sf') || dlg;
  const shown = e => e !== el && !el.contains(e) && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  const hits = [...scope.querySelectorAll('button,a,select,input,summary,canvas,.g-brand')].filter(shown).filter(o => {
    const q = o.getBoundingClientRect();
    return q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top;
  }).map(o => o.className || o.tagName);
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { hits, on: el === top || el.contains(top), inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    size: [r.width, r.height], pageWide: document.documentElement.scrollWidth > innerWidth, dlgWide: dlg.scrollWidth > dlg.clientWidth };
}, sel);
const layoutOk = l => !l.hits.length && l.on && l.inside && l.size[0] >= 44 && l.size[1] >= 44 && !l.pageWide && !l.dlgWide;
async function openScene(p, touch) {
  await p.locator('[data-view="scene"]').scrollIntoViewIfNeeded();
  await hit(p, '[data-view="scene"]', touch);
  await p.waitForSelector('.g-sf:not([hidden])');
}

async function run(name, b) {
  const scene = async (label, fn) => {
    try { await fn(); } catch (e) { check(`${name} ${label}`, false, e.message.split('\n')[0]); }
  };

  await scene('預設', async () => {
    const { ctx, p, errors } = await boot(b);
    check(`${name} 進車庫前沒在放`, (await snap(p)).paused);
    await enter(p);
    const gesture = await p.evaluate(() => window.__plays.at(-1));
    check(`${name} play() 在真實點擊的同一拍`, gesture?.trusted === true && gesture.type === 'click', gesture);
    const playing = await sounding(p), on = await snap(p);
    check(`${name} 點進車庫音樂真的在放`, playing, on);
    check(`${name} 地圖鈕與車庫鈕都亮`, on.map && on.garage === 'true', on);
    await p.click('.g-close');
    const stopped = await silent(p), off = await snap(p);
    check(`${name} 離開車庫音樂停`, stopped, off);
    check(`${name} 離開不動開關偏好`, off.enabled === true && off.pref !== false, off);
    check(`${name} 離開後鈕面回到沒在放`, !off.map, off);
    await enter(p);
    const again = await sounding(p), next = await snap(p);
    check(`${name} 再進車庫換一首`, again && next.src !== on.src, [on.src, next.src]);
    await p.keyboard.press('Escape');
    check(`${name} Esc 離開也停`, await silent(p), await snap(p));
    check(`${name} 預設流程無例外`, await quiet(p, errors), errors);
    console.log(`  ${name} 兩次的曲子：${on.src.split('suno musics/')[1]} → ${next.src.split('suno musics/')[1]}`);
    await ctx.close();
  });

  await scene('關過', async () => {
    const { ctx, p, errors } = await boot(b, { pref: { enabled: false, vol: .5 } });
    await enter(p);
    const off = await snap(p);
    check(`${name} 關過音樂不自動放`, await silent(p) && off.garage === 'false' && !off.src.includes('suno'), off);
    await p.click('.g-music');
    const playing = await sounding(p), on = await snap(p);
    check(`${name} 車庫鈕打開就放且記住`, playing && on.pref === true && on.garage === 'true', on);
    await p.click('.g-close');
    check(`${name} 自己打開的離開照放`, await sounding(p), await snap(p));
    check(`${name} 關過流程無例外`, await quiet(p, errors), errors);
    await ctx.close();
  });

  await scene('在放', async () => {
    const { ctx, p, errors } = await boot(b);
    await mapMusic(p);
    await sounding(p);
    const before = await snap(p);
    await enter(p);
    const inside = await snap(p);
    check(`${name} 已經在放的不動`, inside.src === before.src && inside.t >= before.t && !inside.paused, [before, inside]);
    await p.click('.g-close');
    const still = await sounding(p), after = await snap(p);
    check(`${name} 不是車庫開的離開不停`, still && after.src === before.src, after);
    check(`${name} 在放流程無例外`, await quiet(p, errors), errors);
    await ctx.close();
  });

  await scene('車庫裡按開關', async () => {
    const { ctx, p, errors } = await boot(b);
    await enter(p);
    await sounding(p);
    await p.click('.g-music');
    const stopped = await silent(p), off = await snap(p);
    check(`${name} 車庫鈕關掉就停且記住`, stopped && off.pref === false && off.garage === 'false', off);
    await p.click('.g-music');
    await sounding(p);
    await p.click('.g-close');
    check(`${name} 中途自己按過就算他的、離開照放`, await sounding(p), await snap(p));
    await mapMusic(p);
    await silent(p);
    await enter(p);
    check(`${name} 地圖鈕關掉後進車庫不放`, await silent(p), await snap(p));
    check(`${name} 開關流程無例外`, await quiet(p, errors), errors);
    await ctx.close();
  });

  await scene('場景頁', async () => {
    const { ctx, p, errors } = await boot(b);
    await enter(p);
    await sounding(p);
    await openScene(p);
    await p.click('.g-sf-music');
    const stopped = await silent(p), off = await snap(p);
    check(`${name} 場景頁鈕是同一個開關`, stopped && off.scene === 'false' && off.garage === 'false' && off.pref === false, off);
    await p.click('.g-sf-music');
    await sounding(p);
    const on = await snap(p);
    check(`${name} 兩顆鈕跟著實際狀態`, on.scene === 'true' && on.garage === 'true', on);
    await p.click('.g-sf-leave');
    await p.click('.g-fs');
    await p.waitForFunction(() => document.getElementById('trainGarage').classList.contains('g-full'));
    check(`${name} 全畫面觀看沒有音樂鈕`, !await p.locator('.g-music').isVisible());
    check(`${name} 場景流程無例外`, await quiet(p, errors), errors);
    await ctx.close();
  });

  // 開網址直進車庫沒有使用者手勢：瀏覽器真的擋不擋是這支量的，不是假設的。
  await scene('沒手勢', async () => {
    const { ctx, p, errors, played } = await boot(b, { query: '?lang=zh-TW&garage=1', hands: false });
    const result = await played;
    console.log(`  ${name} 沒手勢直進車庫：${result}`);
    check(`${name} 沒手勢確實被自動播放政策擋`, result === 'NotAllowedError', result);
    await p.waitForTimeout(800);
    const s = await snap(p);
    check(`${name} 沒手勢時鈕面照實際狀態`, (s.garage === 'true') === !s.paused, s);
    check(`${name} 沒手勢無例外`, await quiet(p, errors), errors);
    await ctx.close();
  });

  await scene('被擋', async () => {
    const { ctx, p, errors } = await boot(b, { blockPlay: true });
    await enter(p);
    await p.waitForTimeout(800);
    const s = await snap(p);
    check(`${name} 被擋時車庫照開、鈕面不亮`, s.garage === 'false' && !s.map, s);
    check(`${name} 被擋時不跳提示`, !await p.locator('#toast.show, .toast.show').count());
    await p.click('.g-close');
    await p.waitForFunction(() => !TrainGarage.isOpen);
    check(`${name} 被擋時安靜失敗`, await quiet(p, errors), [errors, await p.evaluate(() => window.__rejected)]);
    await ctx.close();
  });

  for (const width of [360, 375, 414, 768]) await scene(`手機 ${width}`, async () => {
    const label = `${name} ${width}`;
    const { ctx, p, errors } = await boot(b, { opts: { viewport: { width, height: 800 }, isMobile: true, hasTouch: true } });
    await enter(p, true);
    const gesture = await p.evaluate(() => window.__plays.at(-1));
    check(`${label} 觸控的 play() 在真實點擊的同一拍`, gesture?.trusted === true && gesture.type === 'click', gesture);
    check(`${label} 真的點進車庫音樂在放`, await sounding(p), await snap(p));
    let l = await layout(p, '.g-music');
    check(`${label} 頂列音樂鈕不重疊、點得到`, layoutOk(l), l);
    const close = await layout(p, '.g-close');
    check(`${label} 回到地圖還點得到`, !close.hits.length && close.on && close.inside, close);
    await p.locator('.g-music').tap();
    const off = await silent(p), s = await snap(p);
    check(`${label} 觸控關掉音樂`, off && s.garage === 'false', s);
    await p.locator('.g-music').tap();
    check(`${label} 觸控打開音樂`, await sounding(p), await snap(p));
    await openScene(p, true);
    l = await layout(p, '.g-sf-music');
    check(`${label} 場景頁音樂鈕不重疊、點得到`, layoutOk(l), l);
    await p.locator('.g-sf-music').tap();
    check(`${label} 場景頁觸控關掉音樂`, await silent(p), await snap(p));
    await p.locator('.g-sf-leave').tap();
    await p.locator('.g-close').tap();
    await p.waitForFunction(() => !TrainGarage.isOpen);
    check(`${label} 無例外`, await quiet(p, errors), errors);
    await ctx.close();
  });

  // 最窄時外語的頂列也要放得下：品牌字可以省略，鈕不能被擠掉。
  for (const lang of ['en', 'ja', 'ko']) await scene(`360 ${lang}`, async () => {
    const { ctx, p } = await boot(b, { query: `?lang=${lang}`, pref: { enabled: false, vol: .5 }, opts: { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true } });
    await enter(p, true);
    let l = await layout(p, '.g-music');
    check(`${name} 360 ${lang} 頂列`, layoutOk(l), l);
    await openScene(p, true);
    l = await layout(p, '.g-sf-music');
    check(`${name} 360 ${lang} 場景頁`, layoutOk(l), l);
    await ctx.close();
  });
}

try {
  for (const [name, launch] of [
    ['chrome', () => chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=document-user-activation-required'] })],
    ['webkit', () => webkit.launch({ headless: true })],
  ]) {
    const b = await launch();
    try { await run(name, b); } finally { await b.close(); }
  }
} finally {
  server.kill();
}
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 過`);
if (failed.length) process.exitCode = 1;
