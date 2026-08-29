// 頂列軌島牌「裝得下自己的標題、也不會把別人擠出畫面」驗收（2026-08-29 新增）
//
// 起因：Android 1.5.0(18) 實機（SM-A5460，系統字級放大 ⇒ data-fs=xlarge，且當時有一則營運公告）
// 在英文語系下，左上角軌島牌顯示成「Rail Isla」——牌被壓到比標題還窄，溢出的字又被 .stage 的
// overflow 硬切掉，連省略號都沒有。同一個根因在**標準字級**下的顯形是另一件事：英文的牌比中文寬
// 60px 以上，加上公告鈕之後直接把群組切換鈕（手機唯一的換系統入口）整顆推出視窗右緣。
//
// 判準刻意不寫任何寬度常數（會隨字型、文案、公告則數漂移），只測身分與結構：
//   G1 標題文字完整＝該語系字典裡的那一個字串（textContent，不受省略號影響）
//   G2 標題單行（絕不准折成直排的「軌島」）
//   G3 牌不溢出頂列
//   G4 群組切換鈕整顆在視窗內（牌讓位的代價不可以是別人不見）
//   G5 起訖站帶還在（牌讓位的方式是站名省略，不是整條消失）
//   G6 標題若真的裝不下，必須是 overflow:hidden + text-overflow:ellipsis 的省略，不是硬切
//   G7 前置條件閘門：data-fs／lang／公告鈕真的是這一格宣稱的狀態（否則整批空過）
//   G8 沒有公告時，標題一律完整不裁
//   G9 棘輪：有公告時真的裝不下的格子，必須恰好等於下面 KNOWN_TIGHT 那幾格
//      （那幾格是「特大字級＋公告＋≤393dp」的寬度預算本來就不夠——中文也只剩 0px 餘裕；
//       誰把預算挪出來了就會在這裡轉紅，提醒你把清單縮短，不是默默好了。）
//
// 用法：先在 repo 根目錄起靜態站（python3 -m http.server 5178），再
//   node scripts/verify_topbar_plate_fit.mjs [http://127.0.0.1:5178]
// 控制組（證明判準有牙）：PLATE_PAGE=<改動前的 index 檔名> 指過去，en 的多格必須轉紅。
import { chromium, webkit } from 'playwright';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 🔴 容得下「連檔名一起貼進來」的網址：BASE 後面還會接 /${PAGE}，直接吃 argv 會變成
//    /index.html/index.html ⇒ 每一格 404、等滿 90 秒 ready 逾時，144 格要三小時才會告訴你。
//    （2026-08-29 真的這樣白跑了 65 分鐘。）緊接著還有一道目標自檢，指錯就當場停。
const BASE = (process.argv[2] || process.env.PLATE_BASE || 'http://127.0.0.1:5178')
  .replace(/\/index[^/]*$/, '').replace(/\/$/, '');
const PAGE = process.env.PLATE_PAGE || 'index.html';

// ── 第 0 道閘門：我在量的到底是哪一份檔案 ──────────────────────────────────────
// server 指錯目錄、網址多帶檔名、或有人在別棵 worktree 起了 server，下面 144 格的結論就全是空的。
{
  const res = await fetch(BASE + '/' + PAGE).catch(e => ({ ok: false, status: String(e.message) }));
  if (!res.ok) { console.log('✗ 連不到 ' + BASE + '/' + PAGE + '（' + res.status + '）——先在 repo 根目錄起 server'); process.exit(1); }
  const served = createHash('md5').update(Buffer.from(await res.arrayBuffer())).digest('hex');
  const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const onDisk = createHash('md5').update(readFileSync(join(repoRoot, PAGE))).digest('hex');
  if (served !== onDisk) {
    console.log('✗ server 送出的 ' + PAGE + ' 與這棵樹的不同（送出 ' + served.slice(0, 8) + '、樹上 ' + onDisk.slice(0, 8) + '）');
    console.log('  ——server 起在別的目錄或別棵 worktree，量到的不是這次的改動');
    process.exit(1);
  }
  console.log('目標自檢 ✓ ' + BASE + '/' + PAGE + ' md5 ' + served.slice(0, 8) + '（與工作樹逐 byte 相同）');
}
// 360=Android 最窄、375=iPhone SE/13 mini、393=iPhone 14/15/16、414=iPhone Plus 舊版,
// 402=iPhone 16/17 Pro、440=iPhone 17 Pro Max(2026-08-30 為 iOS 比照處理時補上——
// 這條列在 900 以下沒有斷點、純 flex,理論上寬的比窄的鬆,但 fitBadgeDetail() 的降級是離散的,
// 不量就只是推論)。
const WIDTHS = [360, 375, 393, 402, 414, 440];
const SCALES = ['std', 'large', 'xlarge'];
const LANGS = { 'zh-TW': '軌島', en: 'Rail Island', ja: '軌島' };
// 已知裝不下的格（engine|lang|scale|width，皆為「有公告」那半）：特大字級＋公告＋360dp。
// 這一格的寬度預算本來就是負的——中文在同一格也只剩 0px 餘裕（need 恰好等於 room）。
// 而 360dp 是 Android 寬度，實機走的是 chromium；webkit(iPhone) 最窄是 375，兩者都已經裝得下，
// 所以這一格在真機上碰不到。留著是為了讓「誰把預算挪出來了」會在這裡轉紅。
const KNOWN_TIGHT = new Set([
  'webkit|en|xlarge|360',
]);

let pass = 0;
const fails = [];
const tightSeen = new Set();
function check(ok, name, detail) { if (ok) pass++; else fails.push(`${name} — ${detail}`); }

async function cell(engine, browser, lang, title, scale, w, chip) {
  const tag = `${engine} ${lang} ${scale} ${w} ${chip ? '有公告' : '無公告'}`;
  const ctx = await browser.newContext({ viewport: { width: w, height: 820 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(value => {
    localStorage.setItem('trainmap-howto-seen', '1');
    localStorage.setItem('trainmap-fontscale', value);
    localStorage.setItem('trainmap-fontfollow', '0'); // 系統字級不介入，三檔由本檔自己掃
  }, scale);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/${PAGE}?lang=${lang}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  try {
    await page.waitForFunction(() => window.__i18n?.catalogReady && typeof state !== 'undefined' && state.ready, null, { timeout: 90_000 });
  } catch {
    fails.push(`${tag} — 頁面沒進 ready：${errs.slice(0, 2).join(' / ') || '(無 pageerror)'}`);
    await ctx.close();
    return;
  }
  // 公告鈕由真實公告驅動（renderAlertBanner），本機不保證有；這裡用 CSS 強制現身來造出「有公告」那一半，
  // 幾何等價（同一顆鈕、同一組尺寸規則），而且 G7 會確認它真的排進頂列、佔到寬度。
  // 🔴 兩側都釘：公告鈕由真實公告驅動（renderAlertBanner），本機「有沒有公告」是會變的環境條件
  //    ——2026-08-29 就真的整天有公告在亮，於是「無公告」那半量到的其實是有公告的寬度預算，
  //    G7 前置閘門 72 格同時轉紅（這正是它存在的理由）。
  //    改元素的 hidden 沒有用:真的有公告時 renderAlertBanner 每輪重繪都會把它設回 false,
  //    所以兩側一律用 CSS 蓋——display:grid 就是這顆在 body.fs 底下的真實形態(36 圓鈕)。
  await page.addStyleTag({ content: chip ? '#alertChip{display:grid !important}' : '#alertChip{display:none !important}' });
  // 🔴 釘死頂列的即時狀態:時鐘每分鐘會變、LIVE／看板校正／尖峰旗標隨資料現身或消失,
  // 而它們就排在牌旁邊——不釘的話同一支腳本兩次跑會量到不同的可用寬(實測差 3–16px,
  // 足以讓「牌被壓多少」整格翻面)。釘法:時鐘凍成固定字串(它每秒會被 tick 覆寫,故改成唯讀屬性),
  // 旗標固定成「LIVE＋看板校正兩顆亮、REPLAY/尖峰不亮」,再讓 fitBadgeDetail 照它的階梯降級。
  await page.evaluate(() => {
    const clock = document.getElementById('clock');
    if (clock) { clock.textContent = '15:29'; Object.defineProperty(clock, 'textContent', { get: () => '15:29', set() {} }); }
    for (const [id, show] of [['liveBadge', 1], ['metroBadge', 1], ['replayBadge', 0], ['peak', 0]]) {
      const e = document.getElementById(id); if (e) e.hidden = !show;
    }
    try { fitBadgeDetail(true); } catch (e) {}
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => { try { fitBadgeDetail(true); } catch (e) {} }); // 多/少一顆鈕要重量狀態旗標
  await page.waitForTimeout(120);

  const m = await page.evaluate(() => {
    const bar = document.getElementById('topbar');
    const plate = bar?.querySelector('.tb-plate');
    if (!bar || !plate || !plate.getClientRects().length) return null;
    const h1 = plate.querySelector('h1');
    const cs = getComputedStyle(h1);
    const rect = e => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, w: b.width }; };
    const chipEl = document.getElementById('alertChip');
    const switcher = [document.getElementById('gtabOne'), document.getElementById('topTabs')]
      .filter(e => e && e.getClientRects().length).map(e => ({ id: e.id, ...rect(e) }));
    return {
      fs: document.documentElement.getAttribute('data-fs') || 'std',
      lang: document.documentElement.lang,
      title: h1.textContent,
      h1Scroll: h1.scrollWidth, h1Client: h1.clientWidth, h1Lines: h1.getClientRects().length,
      overflow: cs.overflowX, ellipsis: cs.textOverflow, nowrap: cs.whiteSpace,
      plate: rect(plate), bar: rect(bar),
      chipW: chipEl && chipEl.getClientRects().length ? chipEl.getBoundingClientRect().width : 0,
      stns: [...plate.querySelectorAll('.plate-foot .stn')].map(s => ({ txt: s.textContent, w: s.getBoundingClientRect().width })),
      switcher, vw: innerWidth,
    };
  });
  if (!m) { fails.push(`${tag} — 找不到頂列軌島牌（.topbar .tb-plate 沒渲染）`); await ctx.close(); return; }

  const fits = m.h1Scroll <= m.h1Client;
  const key = `${engine}|${lang}|${scale}|${w}`;

  check(m.title === title, `G1 ${tag} 標題完整`, `期望 ${JSON.stringify(title)}，實得 ${JSON.stringify(m.title)}`);
  check(m.h1Lines === 1, `G2 ${tag} 標題單行`, `佔了 ${m.h1Lines} 行（nowrap=${m.nowrap}）`);
  check(m.plate.r <= m.bar.r + 0.5 && m.plate.l >= m.bar.l - 0.5, `G3 ${tag} 牌在頂列內`,
    `牌 ${m.plate.l.toFixed(1)}–${m.plate.r.toFixed(1)} vs 頂列 ${m.bar.l.toFixed(1)}–${m.bar.r.toFixed(1)}`);
  check(m.switcher.length > 0, `G4 ${tag} 群組切換鈕在場`, '一顆都沒渲染');
  for (const s of m.switcher) {
    check(s.r <= m.vw + 0.5 && s.l >= -0.5, `G4 ${tag} 群組鈕 #${s.id} 在視窗內`,
      `${s.l.toFixed(1)}–${s.r.toFixed(1)} vs 視窗 0–${m.vw}`);
  }
  check(m.stns.length === 2 && m.stns.every(s => s.txt.trim() && s.w > 0), `G5 ${tag} 起訖站帶還在`, JSON.stringify(m.stns));
  check(fits || (m.overflow === 'hidden' && m.ellipsis === 'ellipsis'), `G6 ${tag} 裝不下要收成省略號`,
    `overflow=${m.overflow} text-overflow=${m.ellipsis}（缺 ${(m.h1Scroll - m.h1Client)}px）`);
  check(m.fs === scale, `G7 ${tag} 字級前置條件`, `期望 data-fs=${scale}，實得 ${m.fs}`);
  check(m.lang === lang, `G7 ${tag} 語系前置條件`, `期望 ${lang}，實得 ${m.lang}`);
  check(chip ? m.chipW > 0 : m.chipW === 0, `G7 ${tag} 公告鈕前置條件`, `公告鈕寬度 ${m.chipW}`);

  if (!chip) {
    check(fits, `G8 ${tag} 標題完整顯示`, `scrollWidth ${m.h1Scroll} > clientWidth ${m.h1Client}（缺 ${m.h1Scroll - m.h1Client}px）`);
  } else {
    if (!fits) tightSeen.add(key);
    check(fits || KNOWN_TIGHT.has(key), `G9 ${tag} 標題完整顯示（不在已知超支清單裡）`,
      `scrollWidth ${m.h1Scroll} > clientWidth ${m.h1Client}（缺 ${m.h1Scroll - m.h1Client}px）`);
  }
  await ctx.close();
}

for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await launcher.launch();
  for (const [lang, title] of Object.entries(LANGS))
    for (const scale of SCALES)
      for (const w of WIDTHS)
        for (const chip of [0, 1]) await cell(engine, browser, lang, title, scale, w, chip);
  await browser.close();
}

for (const key of KNOWN_TIGHT) {
  check(tightSeen.has(key), `G9 已知超支清單該紅的沒紅：${key}`,
    '這一格現在裝得下了 ⇒ 把它從 KNOWN_TIGHT 移除（有人把寬度預算挪出來了，清單不縮就等於沒守門）');
}

console.log(`\n${PAGE} @ ${BASE}`);
if (fails.length) {
  console.log(`✗ ${pass} 過 / ${fails.length} 不過`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`✓ ${pass}/${pass} 全過（已知超支 ${tightSeen.size} 格，皆以省略號收尾）`);
