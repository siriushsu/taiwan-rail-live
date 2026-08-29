// 手機殼頂列「換系統」入口的驗收：中文維持四顆短標分頁，英/日收成一顆會打開的鈕。
//
// 為什麼需要這支：英文的短標是整個單字（All／TRA／HSR／Metro），四顆並排比中文寬 130~180px，
// 最後一顆整個落在視窗外——實測 en 393pt 第四顆 406~472 而 vw 只有 393，elementFromPoint 回 null。
// 手機唯一的換系統入口就這麼沒了，而「頁籤還在 DOM 裡、rect 也量得到」讓任何只看存在性的檢查全綠。
//
// 判準刻意寫「是什麼／點下去會發生什麼」，不寫「幾顆／幾 px」：
//   · 誰現身 → 對契約（恰好一種入口現身），不是對數量常數
//   · 點得到 → elementFromPoint 命中自己 + 沿 x 軸三點取樣（單點只證明那條線）
//   · 會不會動 → 真的點一次，量 state.group 有沒有變（命中不等於做得到）
//
// 用法：先在 repo root 起 server（python3 -m http.server 5402），再
//   node scripts/verify_topbar_group_switcher.mjs [url]
// 控制組（對改動前的頁面跑，應該要紅）：GROUP_PAGE=index_before.html node scripts/...
import { chromium, webkit } from 'playwright';

const BASE = (process.argv[2] || 'http://127.0.0.1:5402').replace(/\/index[^/]*$/, '');
const PAGE = process.env.GROUP_PAGE || 'index.html';
const LANGS = [['zh-TW', 'tabs'], ['en', 'one'], ['ja', 'one']];   // 期望的入口形態
const WIDTHS = [360, 375, 393, 414];
const CHIPS = [false, true];

// 已知超支（不是本次改動造成，改動前的 origin/main 逐字同樣紅）：
// 中文在 360pt 且「同時有兩則以上公告在亮」（公告 pill 多一個計數字、寬 11px）時，第四顆頁籤「捷」的右緣被切掉 0.8px(chromium)／4.2px(webkit)，
// webkit 連右端取樣點都命中不到——公告 pill 佔掉 margin-left:auto 原本吃著的空白，整排就被擠出去。
// 沒公告時 350 < 360，四顆都在。四顆 44px＋3 個 6px gap＝194，加上軌島牌與間距超過 (360−20) 的可用寬。
// 兩側都斷言：清單上的必須真的紅、清單外的必須全綠——否則這張清單會爛掉而沒人發現。
const KNOWN_TIGHT = new Set(['chromium|zh-TW|360|有公告', 'webkit|zh-TW|360|有公告']);
const tightSeen = new Set();
const fails = [];
let pass = 0;
const seen = new Set();
const ok = (cell, name, cond, detail = '') => {
  if (cond) pass++; else fails.push(`${cell} ${name}${detail ? ' ⟨' + detail + '⟩' : ''}`);
};

for (const [engName, eng] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await eng.launch();
  for (const [lang, want] of LANGS) {
    for (const w of WIDTHS) {
      for (const chip of CHIPS) {
        const cell = `${engName}|${lang}|${w}|${chip ? '有公告' : '乾淨'}`;
        seen.add(cell);
        const ctx = await browser.newContext({ viewport: { width: w, height: 780 }, locale: lang, deviceScaleFactor: 2 });
        const page = await ctx.newPage();
        await page.addInitScript(l => {
          try { localStorage.setItem('trainmap-language', l); localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
        }, lang);
        await page.goto(`${BASE}/${PAGE}?lang=${lang}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2600);
        // 公告鈕兩側都釘死：它是真的會亮的即時狀態，不釘的話「乾淨」那半會隨當下有沒有公告漂移
        // （實測 08-29 當天真的有公告在亮，整批「乾淨」格量到的其實是有公告的寬度）。
        // 🔴 用 CSS 蓋，不要只改元素的 hidden：真的有公告時 renderAlertBanner 每輪重繪都會把 hidden
        //    設回去，而沒有公告時它又會把它設回 true——兩種漂移都會讓「乾淨／有公告」變成看天吃飯。
        //    display:flex 是這顆在手機直式下的真實形態（琥珀 pill），不是隨便挑一個值。
        await page.addStyleTag({ content: chip ? '#alertChip{display:flex !important}' : '#alertChip{display:none !important}' });
        // 🔴 連「計數字」也要釘：renderAlertBanner 只在公告 ≥2 則時才寫數字，而那顆數字讓 pill
        //    寬 11px ⇒ 中文 360pt 的四顆頁籤剛好被推出右緣。只釘現身不釘字，量到的是比較寬鬆的那一態。
        await page.evaluate(on => {
          const n = document.getElementById('alertChipN');
          if (n) n.textContent = on ? '2' : '';
        }, chip);
        // 🔴 頂列其餘的即時狀態也要一起釘：時鐘每分鐘跳字、LIVE／看板校正／尖峰三顆徽章會自己亮滅，
        //    它們就長在同一排、直接吃寬度。不釘的話同一格在不同時間會量到不同的擠壓程度
        //    ——我第一輪就是這樣量出「沒公告時反而更擠」的假結論。
        await page.evaluate(() => {
          const c = document.getElementById('clock');
          if (c) c.textContent = '15:29';
          for (const [id, show] of [['liveBadge', 1], ['metroBadge', 1], ['replayBadge', 0], ['peak', 0]]) {
            const e = document.getElementById(id); if (e) e.hidden = !show;
          }
        });
        await page.waitForTimeout(200);

        const r = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const shown = el => !!(el && el.getClientRects().length && getComputedStyle(el).display !== 'none');
          const box = el => { const b = el.getBoundingClientRect(); return { l: +b.left.toFixed(1), r: +b.right.toFixed(1), t: +b.top.toFixed(1), b: +b.bottom.toFixed(1) }; };
          // 沿 x 軸三點取樣：左端、中心、右端。單點只證明那條線上點得到（心得：空間性斷言要覆蓋端點）
          const hit3 = el => {
            const bb = el.getBoundingClientRect();
            const y = Math.round(bb.top + bb.height / 2);
            return [bb.left + 4, bb.left + bb.width / 2, bb.right - 4].map(x0 => {
              const x = Math.round(x0);
              if (x < 0 || x > vw || y < 0 || y > innerHeight) return 'off';
              const t = document.elementFromPoint(x, y);
              if (!t) return 'null';
              return (t === el || el.contains(t)) ? 'self' : (t.id || t.className || t.tagName);
            });
          };
          const tabsBox = document.getElementById('topTabs');
          const one = document.getElementById('gtabOne');
          const gtabs = [...(tabsBox ? tabsBox.querySelectorAll('.gtab') : [])];
          return {
            vw, fs: document.body.classList.contains('fs'), lang: document.documentElement.lang,
            howto: !document.getElementById('howtoWrap') || document.getElementById('howtoWrap').hidden,
            chipShown: shown(document.getElementById('alertChip')),
            tabsShown: shown(tabsBox), oneShown: shown(one),
            oneTx: one ? one.textContent.replace(/\s+/g, '') : null,
            oneBox: one && shown(one) ? box(one) : null,
            oneHit: one && shown(one) ? hit3(one) : null,
            oneDisabled: one ? !!one.disabled : null,
            tabs: gtabs.map(b => ({ tx: b.textContent.trim(), ...box(b), hit: hit3(b), dis: !!b.disabled })),
            groupsExpected: (typeof TAB_GROUPS !== 'undefined' ? TAB_GROUPS : []).map(g => t(g.short)),
          };
        });

        // P0 前置閘門：量的是不是我以為的那個東西
        ok(cell, 'P0 語系與手機殼到位', r.lang === lang && r.fs === true, `lang=${r.lang} fs=${r.fs}`);
        ok(cell, 'P0 首訪教學卡沒擋著', r.howto === true);
        ok(cell, 'P0 公告鈕狀態與情境相符', r.chipShown === chip, `chipShown=${r.chipShown}`);
        // 契約：恰好一種入口現身，永遠不會兩種都在或兩種都不在
        ok(cell, 'G1 恰好一種換系統入口現身', r.tabsShown !== r.oneShown, `四顆=${r.tabsShown} 一顆=${r.oneShown}`);
        ok(cell, 'G1 現身的是這個語系該有的那種', want === 'one' ? r.oneShown : r.tabsShown);

        if (r.oneShown) {
          ok(cell, 'G2 收合鈕整顆在視窗內', r.oneBox.l >= -0.5 && r.oneBox.r <= r.vw + 0.5, `[${r.oneBox.l},${r.oneBox.r}] vw=${r.vw}`);
          ok(cell, 'G3 收合鈕三點都點得到自己', r.oneHit.every(h => h === 'self'), r.oneHit.join('/'));
          ok(cell, 'G3 收合鈕沒有被停用', r.oneDisabled === false);
          ok(cell, 'G4 收合鈕顯示得出目前群組', !!r.oneTx && r.oneTx.replace('▾', '').length > 0, `字=${r.oneTx}`);
        }
        if (r.tabsShown) {
          const allIn = r.tabs.every(g => g.l >= -0.5 && g.r <= r.vw + 0.5);
          if (KNOWN_TIGHT.has(cell)) {
            tightSeen.add(cell);
            ok(cell, 'G7 已知超支格必須真的還在超支（清單沒爛掉）', !allIn,
              r.tabs.map(g => `${g.tx}:${g.l}-${g.r}`).join(' ') + ` vw=${r.vw}`);
          } else {
            ok(cell, 'G2 四顆頁籤每顆都整顆在視窗內', allIn,
              r.tabs.map(g => `${g.tx}:${g.l}-${g.r}`).join(' ') + ` vw=${r.vw}`);
            ok(cell, 'G3 四顆頁籤三點都點得到自己',
              r.tabs.every(g => g.hit.every(h => h === 'self')),
              r.tabs.map(g => `${g.tx}:${g.hit.join('/')}`).join(' '));
          }
          ok(cell, 'G3 四顆頁籤都沒被停用', r.tabs.every(g => g.dis === false));
          ok(cell, 'G4 四顆頁籤的字＝TAB_GROUPS 的譯文',
            JSON.stringify(r.tabs.map(g => g.tx)) === JSON.stringify(r.groupsExpected),
            `${JSON.stringify(r.tabs.map(g => g.tx))} vs ${JSON.stringify(r.groupsExpected)}`);
        }

        // G5 真的做一次那個互動：命中不等於做得到（點得到 ≠ 點下去會換群組）
        if (r.oneShown) {
          const before = await page.evaluate(() => state.group);
          await page.locator('#gtabOne').click({ timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(160);
          const popped = await page.evaluate(() => {
            const pop = document.getElementById('gtabPop');
            if (!pop || pop.hidden) return { open: false };
            const vw = document.documentElement.clientWidth, vh = innerHeight;
            const pb = pop.getBoundingClientRect();
            const rows = [...pop.querySelectorAll('.gp-row')].map(b => {
              const bb = b.getBoundingClientRect();
              const x = Math.round(bb.left + bb.width / 2), y = Math.round(bb.top + bb.height / 2);
              const tt = (x >= 0 && x <= vw && y >= 0 && y <= vh) ? document.elementFromPoint(x, y) : null;
              return { tx: b.textContent.trim(), inView: bb.left >= -0.5 && bb.right <= vw + 0.5 && bb.top >= -0.5 && bb.bottom <= vh + 0.5, hit: tt ? (tt === b || b.contains(tt) ? 'self' : (tt.id || tt.className)) : 'null' };
            });
            return { open: true, inView: pb.left >= -0.5 && pb.right <= vw + 0.5 && pb.top >= -0.5 && pb.bottom <= vh + 0.5, rows, n: rows.length };
          });
          ok(cell, 'G5 點收合鈕會打開選單', popped.open === true);
          if (popped.open) {
            ok(cell, 'G5 選單整片在視窗內', popped.inView === true);
            ok(cell, 'G5 選單每一列都在視窗內且點得到',
              popped.rows.length > 1 && popped.rows.every(x => x.inView && x.hit === 'self'),
              popped.rows.map(x => `${x.tx}:${x.inView ? '' : '出界'}${x.hit}`).join(' '));
            // 點最後一列（離鈕最遠、最容易掉出視窗的那一列），驗它真的換了群組
            const lastTx = popped.rows[popped.rows.length - 1].tx;
            await page.locator('#gtabPop .gp-row').last().click({ timeout: 4000 }).catch(() => {});
            await page.waitForTimeout(260);
            const after = await page.evaluate(() => ({
              g: state.group, popHidden: document.getElementById('gtabPop').hidden,
              tx: document.getElementById('gtabOneTx').textContent.trim(),
            }));
            ok(cell, 'G5 選了一項之後群組真的變了', after.g !== before, `${before} → ${after.g}`);
            ok(cell, 'G5 選完選單自己收起來', after.popHidden === true);
            ok(cell, 'G5 鈕上的字跟著換到新群組', lastTx.includes(after.tx) || after.tx.length > 0, `鈕=${after.tx} 選的=${lastTx}`);
          }
        }
        await ctx.close();
      }
    }
  }
  await browser.close();
}

// 覆蓋率本身要有一條具名斷言：分母無聲縮水的話，上面全綠也沒有意義
const expected = 2 * LANGS.length * WIDTHS.length * CHIPS.length;
ok('覆蓋率', 'G6 每一格都真的跑到', seen.size === expected, `${seen.size}/${expected}`);
ok('覆蓋率', 'G7 已知超支清單每一格都碰到了', tightSeen.size === KNOWN_TIGHT.size,
  `${tightSeen.size}/${KNOWN_TIGHT.size}`);

console.log(`\n${PAGE} @ ${BASE}`);
if (fails.length) {
  console.log(`✗ ${pass} 過 / ${fails.length} 不過`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`✓ ${pass}/${pass} 全過（${seen.size} 格）`);
