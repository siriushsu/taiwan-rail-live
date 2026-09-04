// 手機版權列「一條單行貼齊底緣、且每個授權來源仍然點得到」驗收（2026-08-29 新增）
//
// 起因：使用者實機（SM-A5460／Android 16／系統字級放大）回報「右下角地圖版權變成一大塊，
// 直接蓋到速度調整的按鈕」。根因不是平台差異，是**底圖字串長度**——
//   light/dark: '© OpenStreetMap © CARTO'（短）
//   sat:        'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics'（長，index.html:29412）
// 手機規則當時是 white-space:normal + max-width:calc(100vw-216px)，長字串就折成三行
// （放大字級四行），高 37.5px，落進速度膠囊（收合的 .controls）的高度帶。
// 改動前實測：chromium/webkit × 360/384/393/414 八格**全部**相交，338–787 px²。
//
// 判準刻意不寫死任何 px（會隨字型、字級、底圖、公告漂移），只測身分與結構：
//   G1 前置閘門：長字串真的在場、data-fs 真的是這一格宣稱的那一檔（否則整批空過）
//   G2 單行：版權列只佔一個 line box
//   G3 高度＝一個行高（從 computed line-height 推導，不是常數）
//   G4 與速度膠囊相交面積＝0  ← 使用者回報的那件事
//   G5 左下卡（#freqCard／#followPanel）在場時相交面積＝0，且 :has() 真的讓了位
//      （反向對照：卡不在場時 max-width 必須是「沒讓位」那個值，否則「乾脆一直讓位」也會全綠）
//   G6 貼齊底緣：版權列底緣到 tab bar 頂緣的距離 ≤ 一個行高（不是浮在半空）
//   G7 授權連結全部可及：逐個捲進視野後 elementFromPoint 命中它自己
//      （改成 overflow-x:auto 之後，「看得到」不等於「構得到」——要真的捲一次）
//   G8 來源完整：Leaflet／內政部／Esri 三個來源的連結或文字一個都沒被裁掉
//
// 用法：先起 dev server（PORT=5191 node scripts/dev_server.mjs），再
//   node scripts/verify_attribution_strip.mjs [http://127.0.0.1:5191]
// 控制組（證明判準有牙）：ATTR_PAGE=<改動前的 index 檔名> 指過去，G2/G3/G4 必須轉紅。
import { chromium, webkit } from 'playwright';

const BASE = (process.argv[2] || process.env.ATTR_BASE || 'http://127.0.0.1:5191').replace(/\/$/, '');
const PAGE = process.env.ATTR_PAGE || 'index.html';
const WIDTHS = [360, 384, 393, 414];
const SCALES = ['std', 'large', 'xlarge'];
const SAT_ATTR = 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics';

let pass = 0;
const fails = [];
function check(ok, name, detail) { if (ok) pass++; else fails.push(`${name} — ${detail}`); }

async function cell(engine, browser, scale, w, withCard) {
  const tag = `${engine} ${scale} ${w} ${withCard ? '有跟隨卡' : '無跟隨卡'}`;
  const ctx = await browser.newContext({ viewport: { width: w, height: 832 } });
  await ctx.addInitScript(value => {
    localStorage.setItem('trainmap-howto-seen', '1');
    localStorage.setItem('trainmap-fontscale', value);
    localStorage.setItem('trainmap-fontfollow', '0');
  }, scale);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/${PAGE}?lang=zh-TW`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  try {
    await page.waitForFunction(() => window.__i18n?.catalogReady && typeof state !== 'undefined' && state.ready, null, { timeout: 90_000 });
  } catch {
    fails.push(`${tag} — 頁面沒進 ready：${errs.slice(0, 2).join(' / ') || '(無 pageerror)'}`);
    await ctx.close();
    return;
  }
  // 造出衛星底圖那條長字串（與 index.html 的 sat.attribution 逐字相同）。用 Leaflet 自己的
  // API 加，不是塞 innerHTML —— 走的是真正的那條路徑。
  // M4-A 起預設 MapLibre:署名走適配層 setAttribution(整份替換;OFM 來源署名由樣式自帶,連結仍在),Leaflet 照舊 addAttribution。
  await page.evaluate(a => { const M = window.__M; if (M && M.engine === 'maplibre') M.setAttribution([a, '臺灣輪廓：內政部']); else window.__map.attributionControl.addAttribution(a); }, SAT_ATTR);
  if (withCard) await page.evaluate(() => { const c = document.getElementById('freqCard'); if (c) c.hidden = false; });
  await page.waitForTimeout(250);

  const m = await page.evaluate(() => {
    const a = document.querySelector('.leaflet-control-attribution, .maplibregl-ctrl-attrib');
    if (!a || !a.getClientRects().length) return null;
    const R = e => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    const inter = (p, q) => Math.max(0, Math.min(p.r, q.r) - Math.max(p.l, q.l)) * Math.max(0, Math.min(p.b, q.b) - Math.max(p.t, q.t));
    const ar = R(a), cs = getComputedStyle(a);
    const pick = sel => { const e = document.querySelector(sel); return e && e.getClientRects().length ? R(e) : null; };
    const controls = pick('.controls'), tabbar = pick('.tabbar');
    const cards = ['#freqCard', '#followPanel'].map(s => ({ sel: s, r: pick(s) })).filter(x => x.r);
    return {
      fs: document.documentElement.getAttribute('data-fs') || 'std',
      engine: window.__ENGINE || 'leaflet',
      text: a.textContent.replace(/\s+/g, ' ').trim(),
      attr: ar, lines: a.getClientRects().length,
      lineHeight: parseFloat(cs.lineHeight), maxWidth: cs.maxWidth, whiteSpace: cs.whiteSpace, overflowX: cs.overflowX,
      scrollW: a.scrollWidth, clientW: a.clientWidth,
      controlsOverlap: controls ? inter(ar, controls) : null,
      cardOverlap: cards.length ? Math.max(...cards.map(c => inter(ar, c.r))) : null,
      cardsSeen: cards.map(c => c.sel),
      cardRight: cards.length ? Math.max(...cards.map(c => c.r.r)) : null,
      gapToTabbar: tabbar ? tabbar.t - ar.b : null,
      anchors: [...a.querySelectorAll('a')].map(x => x.textContent.trim()),
    };
  });
  if (!m) { fails.push(`${tag} — 版權列沒渲染`); await ctx.close(); return; }

  // G1 前置閘門
  check(/Earthstar Geographics/.test(m.text), `G1 ${tag} 長字串前置條件`, `文字＝${JSON.stringify(m.text.slice(0, 80))}`);
  check(m.fs === scale, `G1 ${tag} 字級前置條件`, `期望 data-fs=${scale}，實得 ${m.fs}`);
  check(withCard ? m.cardsSeen.length > 0 : m.cardsSeen.length === 0, `G1 ${tag} 跟隨卡前置條件`,
    `期望${withCard ? '有' : '無'}，實得 ${JSON.stringify(m.cardsSeen)}`);

  // G2／G3 單行
  check(m.lines === 1, `G2 ${tag} 版權列單行`, `佔了 ${m.lines} 行（white-space=${m.whiteSpace}）`);
  check(m.attr.h <= m.lineHeight * 1.2 + 0.5, `G3 ${tag} 高度＝一個行高`,
    `高 ${m.attr.h.toFixed(1)}px vs 行高 ${m.lineHeight}px（＝${(m.attr.h / m.lineHeight).toFixed(2)} 行）`);

  // G4 使用者回報的那件事
  check(m.controlsOverlap === 0, `G4 ${tag} 不壓到速度膠囊`, `相交 ${m.controlsOverlap?.toFixed(0)} px²`);

  // G5 跟隨卡讓位。判準全部是結構的：「讓到卡的右邊」與「沒卡時真的用滿」，
  // 不寫任何預留常數——CSS 那個預留量本身就是從卡寬推導的，判準再手打一次就會跟著漂。
  if (withCard) {
    check(m.cardOverlap === 0, `G5 ${tag} 不壓到左下跟隨卡`, `相交 ${m.cardOverlap?.toFixed(0)} px²`);
    check(m.cardRight !== null && m.attr.l >= m.cardRight, `G5 ${tag} 讓位到卡的右緣之外`,
      `版權列左緣 ${m.attr.l.toFixed(1)} vs 卡右緣 ${m.cardRight?.toFixed(1)}`);
  } else {
    // 反向對照：沒卡時必須真的用滿整條（否則「乾脆一直讓位」也會過上面那兩條）。
    // 內容本來就比視窗寬（scrollW > clientW），所以「用滿」＝左緣頂到 Leaflet 的邊距。
    check(m.scrollW > m.clientW, `G5 ${tag} 前置：內容真的比視窗寬`,
      `scrollWidth ${m.scrollW} vs clientWidth ${m.clientW}——字串不夠長,這格證明不了任何事`);
    check(m.attr.l <= m.lineHeight * 2, `G5 ${tag} 沒卡時整條用滿`,
      `左緣 ${m.attr.l.toFixed(1)}px,仍縮在給卡的預留裡（max-width=${m.maxWidth}）`);
  }

  // G6 貼齊底緣
  check(m.gapToTabbar !== null && m.gapToTabbar >= -0.5 && m.gapToTabbar <= m.lineHeight,
    `G6 ${tag} 貼齊底緣`, `底緣到 tab bar 頂 ${m.gapToTabbar?.toFixed(1)}px（上限一個行高 ${m.lineHeight}px）`);

  // G7 每個連結真的構得到：捲進視野後 elementFromPoint 命中它自己
  const reach = await page.evaluate(() => {
    const a = document.querySelector('.leaflet-control-attribution, .maplibregl-ctrl-attrib');
    const out = [];
    for (const link of a.querySelectorAll('a')) {
      link.scrollIntoView({ block: 'nearest', inline: 'center' });
      const b = link.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2));
      out.push({ txt: link.textContent.trim(), ok: !!hit && (hit === link || link.contains(hit) || hit.contains(link)), hit: hit ? (hit.tagName + '.' + hit.className).slice(0, 40) : null });
    }
    a.scrollLeft = 0;
    return out;
  });
  for (const r of reach) check(r.ok, `G7 ${tag} 連結「${r.txt}」點得到`, `命中的是 ${r.hit}`);
  check(reach.length > 0, `G7 ${tag} 至少有一個授權連結`, '一個都沒有');

  // G8 來源完整。來源清單依實際引擎:Leaflet 路徑的版權列有「Leaflet」;MapLibre 路徑沒有這個來源,
  // 街道底圖那一段是「OpenFreeMap」(M4-A 起裸網址預設 MapLibre,再拿「Leaflet」當必含字串就是判準過期)。
  const SOURCES = m.engine === 'maplibre' ? ['OpenFreeMap', '內政部', 'Esri'] : ['Leaflet', '內政部', 'Esri'];
  for (const src of SOURCES) {
    check(m.text.includes(src), `G8 ${tag} 來源「${src}」沒被裁掉`, `文字＝${JSON.stringify(m.text.slice(0, 90))}`);
  }
  await ctx.close();
}

for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await launcher.launch();
  for (const scale of SCALES)
    for (const w of WIDTHS)
      for (const withCard of [0, 1]) await cell(engine, browser, scale, w, withCard);
  await browser.close();
}

console.log(`\n${PAGE} @ ${BASE}`);
if (fails.length) {
  console.log(`✗ ${pass} 過 / ${fails.length} 不過`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`✓ ${pass}/${pass} 全過`);
