// 時刻尺（取代 ±5 分鈕）驗收
// 跑法：node verify_timerail.mjs [base]   預設 base=http://127.0.0.1:5178
//
// 為什麼用 Playwright 不用內建 Browser pane：這裡要量真實拖曳與 rAF 驅動的重繪，
// 內建 pane 的 rAF 是凍結的、視窗尺寸也量不到（見 rules 心得 12/21）。
//
// 判準來源刻意與實作不同源：
//   ・「列車真的跟著動」讀 canvas 實際像素雜湊 + 命中表座標，不呼叫任何時間相關內部函式
//   ・「拖多少＝走多少分鐘」用外部常數（拖 30px 就該走 30 分鐘），讀畫面上的時刻文字
//   ・「指針對著讀數」用元素 rect（渲染真值），不看 CSS 宣告
//   ・手機版沒被改壞：基準取「改動前的 HEAD 版本」另存一份頁面實測（不拿改後狀態自比）
import { chromium, webkit } from 'playwright';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:5178';
const BASELINE = '_baseline_tmp.html';
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p, msg }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const info = (n, msg) => console.log(`  ·    ${n} — ${msg}`);

async function open(browser, { width = 1440, height = 900, path = '/index.html', dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  await page.goto(BASE + path, { waitUntil: 'load' });
  // state 是頂層 const（不掛 window），要用 typeof 守門免得資料還沒到時丟 ReferenceError
  await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, { timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { const h = document.getElementById('howtoWrap'); if (h) h.remove(); }); // z800 首訪卡會蓋住命中測試
  return { ctx, page };
}

// 畫面實況簽章：canvas 像素雜湊 + 列車命中表座標和（都不經時間函式）
const frameSig = page => page.evaluate(async () => {
  await new Promise(res => { let n = 0; const f = () => (++n >= 5 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const hits = state._trainHits || [];
  let sx = 0, sy = 0;
  for (const h of hits) { sx += h.x; sy += h.y; }
  const cv = document.getElementById('overlay');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let hh = 2166136261;
  for (let i = 0; i < d.length; i += 401) { hh ^= d[i]; hh = (hh * 16777619) >>> 0; }
  return { hash: hh, n: hits.length, cx: Math.round(sx), cy: Math.round(sy), clock: document.getElementById('todOut').textContent };
});
const clockMin = page => page.evaluate(() => {
  const [h, m] = document.getElementById('todOut').textContent.split(':').map(Number);
  return h * 60 + m;
});
const railBox = page => page.evaluate(() => {
  const t = document.getElementById('todTape').getBoundingClientRect();
  return { x: t.left + t.width / 2, y: t.top + t.height / 2, w: t.width };
});
// 拖曳：真滑鼠事件（含 setPointerCapture 路徑）
async function drag(page, dx, { hold = 0 } = {}) {
  const b = await railBox(page);
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  if (hold) await page.waitForTimeout(hold);
  await page.mouse.move(b.x + dx / 2, b.y, { steps: 4 });
  const mid = await frameSig(page);
  await page.mouse.move(b.x + dx, b.y, { steps: 4 });
  await page.waitForTimeout(120);
  const end = await frameSig(page);
  await page.mouse.up();
  return { mid, end };
}

// ── 桌面主場（Chromium）──
{
  const browser = await chromium.launch();
  const { ctx, page } = await open(browser, { width: 1440 });

  // G1/G2 站台帶不再溢出、音樂鈕像素可及（rect 出視窗只能推「看不到」，命中測試才是「不可及」的證據）
  const band = await page.evaluate(() => {
    const c = document.querySelector('.controls');
    const cr = c.getBoundingClientRect(), m = document.getElementById('musicBtn').getBoundingClientRect();
    const hit = document.elementFromPoint(m.left + m.width / 2, m.top + m.height / 2);
    return { client: c.clientWidth, scroll: c.scrollWidth, over: c.scrollWidth - c.clientWidth,
             musicRight: Math.round(m.right - cr.left), hitOnMusic: !!(hit && hit.closest('#musicBtn')) };
  });
  ok('G1 1440：站台帶不溢出（無橫捲軸）', band.over <= 0, `內容 ${band.scroll}px / 可視 ${band.client}px`);
  ok('G2 1440：音樂鈕整顆可見且點得到', band.musicRight <= band.client && band.hitOnMusic,
     `右緣 ${band.musicRight} ≤ ${band.client}，命中=${band.hitOnMusic}`);

  // G10/G11 命中分工：刻度尺可拖、讀數留給原生時刻選擇器
  const hits = await page.evaluate(() => {
    const t = document.getElementById('todTape').getBoundingClientRect();
    const o = document.getElementById('todOut').getBoundingClientRect();
    const a = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2);
    const b = document.elementFromPoint(o.left + o.width / 2, o.top + o.height / 2);
    return { tape: a && a.id, out: b && b.id };
  });
  ok('G10 刻度尺中心命中刻度尺本身（可拖前提）', hits.tape === 'todTape', `命中 #${hits.tape}`);
  ok('G11 讀數中心仍命中時刻選擇器（點讀數直接指定時刻）', hits.out === 'todPick', `命中 #${hits.out}`);

  // G8 指針對著讀數（rect 真值）
  const align = await page.evaluate(() => {
    const n = document.querySelector('.tr-needle').getBoundingClientRect();
    const o = document.getElementById('todOut').getBoundingClientRect();
    return Math.abs((n.left + n.width / 2) - (o.left + o.width / 2));
  });
  ok('G8 指針與時刻讀數同軸', align <= 1.5, `偏差 ${align.toFixed(2)}px`);

  // G8b 拖曳中冒出的位移量標籤不得把讀數推歪（版面零位移）
  const bx = await railBox(page);
  const outCx = () => page.evaluate(() => {
    const o = document.getElementById('todOut').getBoundingClientRect();
    return o.left + o.width / 2;
  });
  const c0 = await outCx();
  await page.mouse.move(bx.x, bx.y); await page.mouse.down();
  await page.mouse.move(bx.x + 33, bx.y, { steps: 3 });
  const c1 = await outCx();
  const dTxt = await page.evaluate(() => document.getElementById('todDelta').textContent);
  await page.mouse.move(bx.x, bx.y, { steps: 3 }); await page.mouse.up();
  ok('G8b 拖曳中讀數不位移（標籤不參與置中）', Math.abs(c1 - c0) <= 0.5,
     `讀數中心 ${c0.toFixed(2)} → ${c1.toFixed(2)}，標籤顯示「${dTxt}」`);

  // 先暫停，量「拖多少＝走多少分鐘」
  await page.evaluate(() => { if (state.playing) document.getElementById('pp').click(); });
  await page.waitForTimeout(200);

  const t0 = await clockMin(page), s0 = await frameSig(page);
  const d1 = await drag(page, 30);
  const t1 = await clockMin(page);
  ok('G4 往右拖 30px＝時間 +30 分', Math.abs(((t1 - t0) + 1440) % 1440 - 30) <= 1, `${t0} → ${t1} 分`);
  ok('G6 拖曳「中途」列車就已經在動（像素＋座標雙證據）',
     d1.mid.hash !== s0.hash && (d1.mid.cx !== s0.cx || d1.mid.cy !== s0.cy),
     `座標和 (${s0.cx},${s0.cy}) → (${d1.mid.cx},${d1.mid.cy})`);
  ok('G6b 拖到底列車位置再次改變', d1.end.cx !== d1.mid.cx || d1.end.cy !== d1.mid.cy,
     `(${d1.mid.cx},${d1.mid.cy}) → (${d1.end.cx},${d1.end.cy})`);

  const t2 = await clockMin(page);
  await drag(page, -45);
  const t3 = await clockMin(page);
  ok('G5 往左拖 45px＝時間 −45 分', Math.abs(((t3 - t2) + 1440) % 1440 - 1395) <= 1, `${t2} → ${t3} 分`);

  // G9 捲動速率：時間前進 30 分，刻度尺位移恰好 30px（讀 CSSOM computed value = 渲染輸入）
  const posAt = async min => page.evaluate(m => {
    setSimSec(m * 60);
    return parseFloat(getComputedStyle(document.getElementById('todTape')).backgroundPositionX);
  }, min);
  const p1 = await posAt(9 * 60), p2 = await posAt(9 * 60 + 30);
  ok('G9 刻度尺捲動速率＝1px/分鐘', Math.abs((((p1 - p2) % 60) + 60) % 60 - 30) <= 0.6,
     `09:00 ${p1.toFixed(2)}px → 09:30 ${p2.toFixed(2)}px`);

  // G12 鍵盤 ←/→＝1 分鐘（且沒被全域 ±10 分連帶觸發）
  const k0 = await clockMin(page);
  await page.evaluate(() => document.getElementById('timeRail').focus());
  await page.keyboard.press('ArrowRight');
  const k1 = await clockMin(page);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  const k2 = await clockMin(page);
  ok('G12 尺聚焦後方向鍵＝每次 1 分鐘', (k1 - k0 === 1) && (k2 - k1 === -2), `${k0} → ${k1} → ${k2} 分`);

  // G7 播放中：按住不動時間不前進（積分暫停）、放手續播
  await page.evaluate(() => { setSpeed(60); if (!state.playing) document.getElementById('pp').click(); });
  await page.waitForTimeout(200);
  const b1 = await railBox(page);
  await page.mouse.move(b1.x, b1.y);
  await page.mouse.down();
  const h0 = await clockMin(page);
  await page.waitForTimeout(1500);              // 60× 下這 1.5 秒等於 90 模擬分鐘
  const h1 = await clockMin(page);
  await page.mouse.up();
  await page.waitForTimeout(900);
  const h2 = await clockMin(page);
  ok('G7 按住刻度尺時時間凍結（不與播放拉扯）', h0 === h1, `按住 1.5s（60×）：${h0} → ${h1} 分`);
  ok('G7b 放手後自動續播', ((h2 - h1) + 1440) % 1440 > 0, `放手 0.9s：${h1} → ${h2} 分`);

  // G18 互動累積狀態後再驗一次（不只驗乾淨初始態；rules 心得 28）
  await page.evaluate(() => { setSpeed(1); if (state.playing) document.getElementById('pp').click(); });
  await drag(page, 12); await drag(page, -7); await drag(page, 40);
  await page.evaluate(() => { map.setZoom(map.getZoom() - 1); map.panBy([120, -60], { animate: false }); });
  await page.waitForTimeout(600);
  const a0 = await clockMin(page);
  await drag(page, 30);
  const a1 = await clockMin(page);
  ok('G18 多次拖曳＋縮放平移之後，比例尺仍是 1px/分鐘',
     Math.abs(((a1 - a0) + 1440) % 1440 - 30) <= 1, `${a0} → ${a1} 分`);

  // G14 切到捷運分頁（mode!=='sched'）：時鐘與刻度尺照走（tick 改動的回歸）
  const metro = await page.evaluate(async () => {
    const tabs = [...document.querySelectorAll('.grouptabs .gtab')];
    const t = tabs.find(b => /北北桃|中南部/.test(b.textContent));
    if (!t) return { skip: true };
    t.click();
    await new Promise(r => setTimeout(r, 2500));
    if (!state.playing) document.getElementById('pp').click();
    setSpeed(60);
    const c0 = document.getElementById('clock').textContent;
    const p0 = getComputedStyle(document.getElementById('todTape')).backgroundPositionX;
    await new Promise(r => setTimeout(r, 1200));
    return { skip: false, mode: state.mode, c0, c1: document.getElementById('clock').textContent,
             p0, p1: getComputedStyle(document.getElementById('todTape')).backgroundPositionX };
  });
  if (metro.skip) info('G14 捷運分頁', '找不到頁籤，略過');
  else ok('G14 捷運分頁時鐘與刻度尺照走', metro.c0 !== metro.c1 && metro.p0 !== metro.p1,
          `mode=${metro.mode} 時鐘 ${metro.c0}→${metro.c1}、尺 ${metro.p0}→${metro.p1}`);

  await ctx.close();

  // G17 深色主題：刻度三層都有顏色（非 transparent）＋不溢出
  const dk = await open(browser, { width: 1440, dark: true });
  const dark = await dk.page.evaluate(() => {
    const t = document.getElementById('todTape'), cs = getComputedStyle(t);
    const c = document.querySelector('.controls');
    return { img: cs.backgroundImage, over: c.scrollWidth - c.clientWidth,
             needle: getComputedStyle(document.querySelector('.tr-needle')).backgroundColor,
             theme: document.documentElement.getAttribute('data-theme') };
  });
  const grads = (dark.img.match(/gradient/g) || []).length;
  ok('G17 深色主題：三層刻度都在、指針有色、帶不溢出',
     grads === 3 && !/transparent\)/.test(dark.needle) && dark.over <= 0,
     `theme=${dark.theme} 漸層層數=${grads} 指針=${dark.needle} 溢出=${dark.over}px`);
  await dk.ctx.close();

  // 窄桌面實情（誠實回報，不當 FAIL：站台帶本來就靠橫捲收納 16 顆工具鈕）
  for (const w of [1280, 1152, 1024]) {
    const s = await open(browser, { width: w });
    const r = await s.page.evaluate(() => {
      const c = document.querySelector('.controls');
      const cr = c.getBoundingClientRect(), m = document.getElementById('musicBtn').getBoundingClientRect();
      return { over: c.scrollWidth - c.clientWidth, fit: m.right - cr.left <= c.clientWidth };
    });
    info(`G3 ${w}px 視窗`, `溢出 ${r.over}px，音樂鈕${r.fit ? '看得到' : '仍需橫捲'}`);
    await s.ctx.close();
  }

  // ── G15/G16 手機沒被改壞：基準取改動前的 HEAD 版本 ──
  writeFileSync(BASELINE, execSync('git show HEAD:index.html', { maxBuffer: 64 * 1024 * 1024 }));
  try {
    for (const w of [375, 768]) {
      const nw = await open(browser, { width: w, height: 812 });
      const bl = await open(browser, { width: w, height: 812, path: '/' + BASELINE });
      const probe = p => p.evaluate(() => {
        const c = document.querySelector('.controls').getBoundingClientRect();
        const o = document.getElementById('todOut').getBoundingClientRect();
        const tape = document.getElementById('todTape');
        return { cw: Math.round(c.width), ch: Math.round(c.height), cy: Math.round(c.top),
                 ow: Math.round(o.width), oh: Math.round(o.height),
                 tapeShown: !!tape && tape.getClientRects().length > 0 };
      });
      const a = await probe(nw.page), b = await probe(bl.page);
      ok(`G15 手機 ${w}：控制帶尺寸與改動前一致`,
         Math.abs(a.cw - b.cw) <= 1 && Math.abs(a.ch - b.ch) <= 1 && Math.abs(a.cy - b.cy) <= 1,
         `新 ${a.cw}×${a.ch}@y${a.cy} vs 舊 ${b.cw}×${b.ch}@y${b.cy}`);
      ok(`G16 手機 ${w}：只留時刻讀數、刻度尺收起`,
         a.tapeShown === false && a.ow === b.ow && a.oh === b.oh,
         `尺顯示=${a.tapeShown}，讀數 ${a.ow}×${a.oh} vs 舊 ${b.ow}×${b.oh}`);
      await nw.ctx.close(); await bl.ctx.close();
    }
  } finally { try { unlinkSync(BASELINE); } catch (e) {} }

  await browser.close();
}

// ── WebKit 佐證（macOS/iOS 使用者的引擎；rules 心得 8）──
{
  const browser = await webkit.launch();
  const { ctx, page } = await open(browser, { width: 1440 });
  const band = await page.evaluate(() => {
    const c = document.querySelector('.controls');
    const cr = c.getBoundingClientRect(), m = document.getElementById('musicBtn').getBoundingClientRect();
    const hit = document.elementFromPoint(m.left + m.width / 2, m.top + m.height / 2);
    const t = document.getElementById('todTape').getBoundingClientRect();
    const ht = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2);
    return { over: c.scrollWidth - c.clientWidth, hitMusic: !!(hit && hit.closest('#musicBtn')), tape: ht && ht.id };
  });
  ok('W1 WebKit 1440：帶不溢出＋音樂鈕點得到', band.over <= 0 && band.hitMusic, `溢出 ${band.over}px 命中=${band.hitMusic}`);
  ok('W2 WebKit：刻度尺可命中', band.tape === 'todTape', `命中 #${band.tape}`);
  await page.evaluate(() => { if (state.playing) document.getElementById('pp').click(); });
  await page.waitForTimeout(200);
  const w0 = await clockMin(page), s0 = await frameSig(page);
  const d = await drag(page, 30);
  const w1 = await clockMin(page);
  ok('W3 WebKit：拖 30px＝+30 分', Math.abs(((w1 - w0) + 1440) % 1440 - 30) <= 1, `${w0} → ${w1} 分`);
  ok('W4 WebKit：拖曳中列車跟著移動', d.mid.hash !== s0.hash, `雜湊 ${s0.hash} → ${d.mid.hash}`);
  await ctx.close(); await browser.close();
}

const bad = R.filter(r => !r.p);
console.log(`\n=== ${R.length - bad.length}/${R.length} 通過 ===`);
if (bad.length) { console.log('未過：'); bad.forEach(b => console.log(' ・' + b.n + ' — ' + b.msg)); process.exit(1); }
