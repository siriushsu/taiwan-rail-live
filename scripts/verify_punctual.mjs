// 「準點排行」(近30天最準點的10班台鐵車;固定取前10名,不是任何門檻)驗收：
// 排行榜邏輯(資料充足性篩選＋四鍵排序)／跨系統閘門突變測試／排序第4鍵突變測試／
// 地圖綠環像素證據／今日之最金環零回歸／探索面板文案誠實線／手機三寬度雙引擎／更新紀錄結構。
// 跑法：node scripts/verify_punctual.mjs [base]   預設 base=http://127.0.0.1:8917
//
// 判準來源刻意獨立於實作(比照本 repo 既有 verify_*.mjs 慣例)：
//   ・跨系統閘門用「突變測試」證明有牙——拿掉 tr.sys==='tra_sched' 那道條件,同一份測試必須從綠翻紅
//     (測不出差別的判準等於沒有判準,這個專案已吃過很多次虧,見 assertion-blindspot-taxonomy)
//   ・排序第4鍵(車次號)同樣用突變測試,但額外誠實揭露一個方法論細節(見 Section B2 開頭註解)：
//     punctualRanked() 用 for-in 建列,而車次號是無前導零正整數字串,ECMAScript 規格保證這類鍵
//     無論插入順序一律按數值遞增列舉——疊上穩定排序,對「真實資料形狀」跑這個突變可能量不出差異,
//     這不是測試沒寫好,是資料形狀本身已提供等效保護;因此改用非典型鍵(前導零)隔離出第4鍵比較式
//     本身的邏輯是否正確,兩種資料形狀的結果都據實回報,不因其中一種測不出來就跳過或改判準。
//   ・綠環像素證據直接讀 #overlay canvas 的 getImageData(注意 devicePixelRatio：backing store 是
//     CSS 尺寸的 dpr 倍,座標不乘 dpr 會採到別的地方、整片全 0)
//   ・今日之最金環零回歸雙重驗證：(a) drawFeaturedRing 原始碼與改動前 commit 逐字比對
//     (b) 真實(未 mock delayStats)資料下,今日之最仍實際畫得出金色像素、不混綠
//   ・手機不溢出用 elementFromPoint／真點擊命中測試,不只靠 rect 幾何(心得19/37)
//   ・固定前10名不是門檻:塞入 15 筆合格候選只留 10 筆,證明「不是 m/a 卡出來的數量」

import { chromium, webkit } from 'playwright';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:8917';
const BASE_REF = '24e9c2c'; // 本分支基準(origin/main,改動前一顆)
const MUTANT_PATH = '_mutant_punctual_tmp.html';
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p, msg }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const info = (n, msg) => console.log(`  ·    ${n} — ${msg}`);

async function open(browser, { width = 1440, height = 900, path = '/index.html', dark = false, hasTouch = false } = {}) {
  // 本回歸以繁中標題與誠實線文案作判準；多語化後首次語言會依瀏覽器 locale，固定 zh-TW
  // 才不會讓 Chromium／WebKit 因預設 locale 不同而驗到兩種語言。
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? 'dark' : 'light', hasTouch, locale: 'zh-TW' });
  const page = await ctx.newPage();
  await page.goto(BASE + path, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.trains && state.trains.length > 0, { timeout: 30000 });
  await page.evaluate(() => {
    const h = document.getElementById('howtoWrap'); if (h) h.remove();
    state.playing = false; // 凍結模擬時鐘：位置在整個測試過程保持穩定,不因真實秒數流逝而漂移
  });
  await page.waitForTimeout(250);
  return { ctx, page };
}

// 挑一班「現在畫得出來」的台鐵列車：sys/visible/running/在視窗內都要成立,跟 drawSched 迴圈同一組前提
const pickOnscreenTraTrain = page => page.evaluate(() => {
  const cands = state.trains.filter(t => t.sys === 'tra_sched' && state.visible.has(t.typeName) && trainPos(t, state.simSec));
  for (const tr of cands) {
    const pos = trainPos(tr, state.simSec);
    const cp = map.latLngToContainerPoint([pos.lat, pos.lon]);
    if (cp.x >= 30 && cp.x <= innerWidth - 30 && cp.y >= 30 && cp.y <= innerHeight - 30) return String(tr.train);
  }
  return null;
});

// #overlay canvas 在給定「CSS 像素」座標附近取樣,回傳綠環色(≈rgb(34,197,94))/金環色(≈rgb(240,180,41)偏黃橙)的像素數
const samplePixels = (page, cssX, cssY, boxCss = 44) => page.evaluate(({ cssX, cssY, boxCss }) => {
  const dpr = window.devicePixelRatio || 1;
  const cv = document.getElementById('overlay');
  const c2 = cv.getContext('2d');
  const sx = Math.max(0, Math.round((cssX - boxCss / 2) * dpr));
  const sy = Math.max(0, Math.round((cssY - boxCss / 2) * dpr));
  const sw = Math.max(0, Math.min(cv.width - sx, Math.round(boxCss * dpr)));
  const sh = Math.max(0, Math.min(cv.height - sy, Math.round(boxCss * dpr)));
  if (sw <= 0 || sh <= 0) return { green: 0, gold: 0, total: 0 };
  const img = c2.getImageData(sx, sy, sw, sh);
  let green = 0, gold = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2], a = img.data[i + 3];
    if (a < 10) continue;
    if (g > r + 30 && g > b + 30 && g > 100) green++;
    else if (r > 180 && g > 130 && g < 235 && b < 150) gold++;
  }
  return { green, gold, total: img.data.length / 4 };
}, { cssX, cssY, boxCss });

const rectAround = (cp, size, vw, vh) => {
  const half = size / 2;
  return { x: Math.max(0, Math.min(vw - size, cp.x - half)), y: Math.max(0, Math.min(vh - size, cp.y - half)), width: size, height: size };
};

// 跨系統閘門檢查本體：挑一班畫面上的真台鐵車,複製一份改標成高鐵(同車次號,issue#23 那種真實碰撞情境),
// 讓兩者都「應該」通過判定式,重建後檢查準點排行 Set／清單是否仍只收台鐵那一份。同一支函式跑兩種頁面(正常/突變)。
const crossGateCheck = page => page.evaluate(() => {
  const trX = state.trains.find(t => t.sys === 'tra_sched' && state.visible.has(t.typeName) && trainPos(t, state.simSec));
  if (!trX) return { error: 'no-candidate' };
  const no = String(trX.train);
  const fake = Object.assign({}, trX, { sys: 'thsr_sched' }); // 淺拷貝:同車次號、同班表,只換系統標記
  state.trains.push(fake);
  state.delayStats = {}; state.delayStats[no] = { a: 0, d: 22, m: 1 };
  state._punctual = null;
  buildPunctual();
  const list = punctualTrainList();
  const hasRealOnly = state._punctual.has(trX) && !state._punctual.has(fake);
  const leaked = state._punctual.has(fake) || list.some(t => t.sys !== 'tra_sched');
  state.trains.pop(); // 清掉塞入的假車,避免污染同頁後續操作
  return { no, setSize: state._punctual.size, hasRealOnly, leaked };
});

let mutantWritten = false;
try {

// ── Section A：排行榜邏輯(純函式,不需要真車)——資料充足性篩選／固定10名／四鍵排序 ──
{
  const browser = await chromium.launch();
  const { ctx, page } = await open(browser, { width: 1440 });

  // A0：判準寫「有沒有相對基準遞增」,不寫死當下那個字串——寫死的話下一次改版必然假紅
  // (BUILD 是每次出貨都會動的漂移量,心得 35:判準要從當下量到的東西推導,不要手打常數)。
  {
    const baseBuild = (execSync(`git show ${BASE_REF}:index.html`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .match(/const BUILD = '([^']+)'/) || [])[1] || null;
    const nowBuild = await page.evaluate(() => BUILD);
    ok('A0 BUILD 相對基準已遞增', !!baseBuild && !!nowBuild && nowBuild !== baseBuild, `${baseBuild} → ${nowBuild}`);
  }

  // A1：d>=20 是資料充足性保護,不是品質門檻——樣本太少的即使 m/a 完美也不能進榜
  const dGate = await page.evaluate(() => {
    state.delayStats = { d19_perfect: { a: 0, d: 19, m: 0 }, d20_ok: { a: 0, d: 20, m: 0 } };
    const nos = punctualRanked().map(r => r.no);
    return { has19: nos.includes('d19_perfect'), has20: nos.includes('d20_ok') };
  });
  ok('A1 d<20 即使 m/a 完美也不進榜(資料充足性保護)', !dGate.has19 && dGate.has20, JSON.stringify(dGate));

  // A2：固定前10名,不是任何 m/a 的門檻——塞 15 筆全部合格(d>=20)的候選,只能剩 10 筆
  const top10 = await page.evaluate(() => {
    const ds = {};
    for (let i = 0; i < 15; i++) ds['9' + String(i).padStart(4, '0')] = { a: i * 0.1, d: 25, m: i }; // m 0..14,越小越好
    state.delayStats = ds;
    return punctualRanked().length;
  });
  ok('A2 固定取前10名(塞15筆合格候選只留10筆,不是門檻卡出來的數量)', top10 === 10, `實得 ${top10} 筆`);

  // A3：四鍵排序——用「反向塞入」的候選驗證 m/a/d 三鍵的排序方向(遞增/遞增/遞減)
  const order3 = await page.evaluate(() => {
    state.delayStats = {
      byM_worse: { a: 0, d: 25, m: 5 }, byM_better: { a: 0, d: 25, m: 1 },     // m 遞增:1 該排在 5 前面
      byA_worse: { a: 9, d: 25, m: 1 }, byA_better: { a: 0.1, d: 25, m: 1 },   // m 打平時比 a,越小越前面
      byD_worse: { a: 0, d: 20, m: 1 }, byD_better: { a: 0, d: 30, m: 1 },     // m/a 都打平時比 d,越大越前面
    };
    return punctualRanked().map(r => r.no);
  });
  const idx = no => order3.indexOf(no);
  ok('A3a 鍵①m 遞增(較小的 m 排前面)', idx('byM_better') < idx('byM_worse'), order3.join(','));
  ok('A3b 鍵②a 遞增(m 打平時,較小的 a 排前面)', idx('byA_better') < idx('byA_worse'), order3.join(','));
  ok('A3c 鍵③d 遞減(m/a 都打平時,較大的 d 排前面)', idx('byD_better') < idx('byD_worse'), order3.join(','));

  // A4：真實 D1 資料的已知結果核對(供對照,見任務規格表;跨日會變動,只驗「前10名如預期」這一天的快照)
  const knownToday = await page.evaluate(() => {
    state.delayStats = {
      '1108': { a: 0, d: 29, m: 0 }, '1106': { a: 0, d: 29, m: 1 }, '4704': { a: 0, d: 28, m: 1 },
      '4239': { a: 0.1, d: 29, m: 1 }, '3116': { a: 0, d: 30, m: 2 }, '3305': { a: 0, d: 29, m: 2 },
      '4003': { a: 0, d: 29, m: 2 }, '4106': { a: 0, d: 29, m: 2 }, '4712': { a: 0, d: 29, m: 2 },
      '4821': { a: 0.1, d: 29, m: 2 }, '4824': { a: 0.1, d: 29, m: 2 }, '2609': { a: 0.2, d: 29, m: 2 },
    };
    return punctualRanked().map(r => r.no);
  });
  const expectedTop10 = ['1108', '1106', '4704', '4239', '3116', '3305', '4003', '4106', '4712', '4821'];
  ok('A4 對照規格表提供的真實資料快照:前10名名次與內容完全吻合(4821 進榜、4824 落榜第11)',
     JSON.stringify(knownToday) === JSON.stringify(expectedTop10), `實得 ${knownToday.join(',')}`);

  // A5：防呆——state.delayStats 未載入(undefined)時不可拋錯,回空陣列
  const emptyOk = await page.evaluate(() => { state.delayStats = undefined; try { return punctualRanked().length === 0; } catch (e) { return false; } });
  ok('A5 delayStats 未載入時 punctualRanked() 回空陣列不拋錯', emptyOk, '');

  await ctx.close(); await browser.close();
}

// ── Section B：跨系統閘門突變測試(整支腳本最重要的一段) ──
{
  const browser = await chromium.launch();

  // B1：原始(未突變)程式碼——正確行為
  {
    const { ctx, page } = await open(browser, { width: 1440 });
    const r = await crossGateCheck(page);
    ok('B1 原始碼：準點排行 Set 只收台鐵、高鐵同號車不會混入', !r.error && r.hasRealOnly && !r.leaked, JSON.stringify(r));
    await ctx.close();
  }

  // 產生突變版：拿掉 punctualTrainList() 裡 `tr.sys === 'tra_sched' &&` 那道跨系統閘門
  const GATE = "tr.sys === 'tra_sched' && order.has(String(tr.train))";
  const REPLACEMENT = "order.has(String(tr.train))";
  const orig = readFileSync('index.html', 'utf8');
  const occurrences = orig.split(GATE).length - 1;
  if (occurrences !== 1) {
    ok('B2 突變目標字串在檔案中恰好出現一次(找不到就不硬做突變)', false, `實際出現 ${occurrences} 次`);
  } else {
    writeFileSync(MUTANT_PATH, orig.replace(GATE, REPLACEMENT));
    mutantWritten = true;
    const { ctx, page } = await open(browser, { width: 1440, path: '/' + MUTANT_PATH });
    const r = await crossGateCheck(page);
    ok('B2 突變版(拿掉跨系統閘門)：測試如預期翻紅——高鐵同號車混入準點排行 Set', !r.error && r.leaked,
       r.leaked ? '確認翻紅(高鐵同號車混入,證明判準有牙)' : JSON.stringify(r));
    await ctx.close();

    // B3：還原——重新對原始檔跑一次同一支檢查,確認變綠(未曾被突變腳本動到真正的 index.html,這裡只是再次證明)
    const { ctx: ctx2, page: page2 } = await open(browser, { width: 1440 });
    const r2 = await crossGateCheck(page2);
    ok('B3 還原後(對照原始 index.html 再跑一次)：確認變回綠', !r2.error && r2.hasRealOnly && !r2.leaked, JSON.stringify(r2));
    await ctx2.close();
  }

  await browser.close();
}

// ── Section B2：排序第4鍵(車次號,穩定排序用)突變測試 ──
// 🔴方法論誠實揭露(跑之前就想清楚,不是跑完才找理由)：punctualRanked() 用 `for (const no in ds)` 建列,
// 而 state.delayStats 的鍵是「無前導零正整數字串」(車次號,如 "4821")——ECMAScript 規格規定這類
// 「陣列索引」鍵,for-in/Object.keys 無論插入順序一律按數值遞增列舉(V8/Chromium/WebKit 三方已個別
// 實測驗證一致),疊上 Array.prototype.sort 自 ES2019 起保證穩定,兩者相加代表：對這種鍵形狀,即使拿掉
// 第4鍵,同分的列在排序前就已經是「car 號遞增」順序,穩定排序不會打亂它——這個突變在「真實資料形狀」下
// 很可能量不出差異。這不是測試沒寫好,是資料形狀本身已提供等效保護。所以下面用兩種鍵形狀各跑一次：
//   B4：真實形狀(車次號,如規格表 4821/4824)——誠實回報實測結果,不論有沒有差異都算「資訊」不算「判準」
//   B5：非典型形狀(前導零,刻意跳脫 for-in 的陣列索引自動排序)——隔離出第4鍵比較式「本身邏輯」是否正確,
//       這才是本節唯一的 pass/fail 判準(如果拿掉第4鍵這裡都測不出差異,才是測試沒有牙)
{
  const browser = await chromium.launch();

  const KEY4 = ' || (Number(x.no) - Number(y.no))';
  const orig = readFileSync('index.html', 'utf8');
  const occ4 = orig.split(KEY4).length - 1;
  if (occ4 !== 1) {
    ok('B4 突變目標(排序第4鍵)字串在檔案中恰好出現一次(找不到就不硬做突變)', false, `實際出現 ${occ4} 次`);
  } else {
    const MUTANT2_PATH = '_mutant_punctual_key4_tmp.html';
    writeFileSync(MUTANT2_PATH, orig.replace(KEY4, ''));
    try {
      const runTie = (page, entries) => page.evaluate((entries) => {
        const ds = {}; entries.forEach(e => { ds[e.no] = e.v; });
        state.delayStats = ds;
        return punctualRanked().map(r => r.no);
      }, entries);

      // B4：真實形狀——m/a/d 三值完全相同,只有車次號不同(比照規格表 4821 vs 4824 那組真實並列案例)
      const tieCanonical = [{ no: '4824', v: { a: 0.1, d: 29, m: 2 } }, { no: '4821', v: { a: 0.1, d: 29, m: 2 } }];
      const { ctx: co, page: po } = await open(browser, { width: 1440 });
      const origCanonical = await runTie(po, tieCanonical);
      await co.close();
      const { ctx: cm, page: pm } = await open(browser, { width: 1440, path: '/' + MUTANT2_PATH });
      const mutCanonical = await runTie(pm, tieCanonical);
      await cm.close();
      const sameCanonical = JSON.stringify(origCanonical) === JSON.stringify(mutCanonical);
      info('B4', `真實資料形狀(車次號鍵,對照規格表 4821/4824 並列案例)：原始=[${origCanonical.join(',')}] 拿掉第4鍵=[${mutCanonical.join(',')}]` +
        (sameCanonical
          ? ' → 相同,如預期(for-in 對無前導零正整數鍵一律按數值遞增列舉+穩定排序,此形狀下第4鍵目前是「正確但目前不可觀測」的防禦性寫法；見 B5 用非典型鍵隔離出比較式本身邏輯)'
          : ' → 不同(這個引擎/情境下,即使是真實鍵形狀,拿掉第4鍵仍可觀測到差異)'));

      // B5：非典型形狀(前導零)——刻意跳脫 for-in 的陣列索引自動排序,才是本節的 pass/fail 判準
      const tieNonCanonical = [{ no: '04824', v: { a: 0.1, d: 29, m: 2 } }, { no: '04821', v: { a: 0.1, d: 29, m: 2 } }];
      const { ctx: co2, page: po2 } = await open(browser, { width: 1440 });
      const origNC = await runTie(po2, tieNonCanonical);
      await co2.close();
      const { ctx: cm2, page: pm2 } = await open(browser, { width: 1440, path: '/' + MUTANT2_PATH });
      const mutNC = await runTie(pm2, tieNonCanonical);
      await cm2.close();

      ok('B5a 原始碼:非典型鍵(前導零,跳脫 for-in 自動排序)下,第4鍵仍正確把 04821 排在 04824 前面',
         JSON.stringify(origNC) === JSON.stringify(['04821', '04824']), `原始=[${origNC.join(',')}]`);
      ok('B5b 突變版(拿掉第4鍵):非典型鍵下順序改變(榜尾真的動了,證明第4鍵比較式本身有牙)',
         JSON.stringify(mutNC) !== JSON.stringify(origNC), `原始=[${origNC.join(',')}] 突變=[${mutNC.join(',')}]`);
    } finally {
      try { unlinkSync(MUTANT2_PATH); } catch (e) {}
    }
  }

  await browser.close();
}

// ── Section C：像素證據(綠環)＋今日之最金環零回歸 ──
{
  const browser = await chromium.launch();

  // C1/C2：綠環在亮/暗主題都畫得出綠色像素,存截圖佐證
  {
    const { ctx, page } = await open(browser, { width: 1440 });
    const no = await pickOnscreenTraTrain(page);
    ok('C0 找得到目前畫面內的台鐵列車(供像素測試)', !!no, `no=${no}`);
    if (no) {
      await page.evaluate((no) => {
        state.delayStats = {}; state.delayStats[no] = { a: 0, d: 22, m: 1 };
        state._punctual = null; buildPunctual(); draw();
      }, no);
      const cp = await page.evaluate((no) => {
        const tr = state.trains.find(t => String(t.train) === no && t.sys === 'tra_sched');
        const pos = trainPos(tr, state.simSec);
        return map.latLngToContainerPoint([pos.lat, pos.lon]);
      }, no);
      const px = await samplePixels(page, cp.x, cp.y, 44);
      ok('C1 綠環在亮色主題確實畫出綠色像素', px.green > 50, `green px=${px.green}／取樣框 ${px.total}px`);
      await page.screenshot({ path: '_shot_punctual_ring_light.png', clip: rectAround(cp, 70, 1440, 900) });

      await page.evaluate(() => { state.mapDark = true; draw(); });
      await page.waitForTimeout(80);
      const px2 = await samplePixels(page, cp.x, cp.y, 44);
      ok('C2 綠環在暗色主題確實畫出綠色像素', px2.green > 50, `green px=${px2.green}`);
      await page.screenshot({ path: '_shot_punctual_ring_dark.png', clip: rectAround(cp, 70, 1440, 900) });
    }
    await ctx.close();
  }

  // C3：drawFeaturedRing 原始碼與改動前 commit 逐字相同(金環外觀零變化的最強保證)
  {
    const curSrc = readFileSync('index.html', 'utf8');
    const baseSrc = execSync(`git show ${BASE_REF}:index.html`, { maxBuffer: 64 * 1024 * 1024 }).toString();
    const extract = src => (src.match(/function drawFeaturedRing\(p\) \{[\s\S]*?\n\}/) || [null])[0];
    const curFn = extract(curSrc), baseFn = extract(baseSrc);
    ok('C3 drawFeaturedRing 原始碼與改動前 commit 逐字相同', !!curFn && curFn === baseFn,
       curFn === baseFn ? '' : `長度 改動前${(baseFn || '').length} vs 現在${(curFn || '').length}`);
  }

  // C4：真實(未 mock)資料下,今日之最仍實際畫出金色像素、且無綠像素混入(功能面零回歸)
  {
    const { ctx, page } = await open(browser, { width: 1440 }); // 本機無後端 → delayStats={} → _punctual 恆空
    // 🔴時間錨定:computeHighlights()(今日之最的選拔)本身完全不看 state.simSec(只看全日總里程/總時數/
    // 停站數/均速這種整天統計量,見 index.html:12854-12868),但本測試要驗的「逐台置中後畫得出金環嗎」
    // 得先用 trainPos(tr, state.simSec) 判斷該車此刻在不在路上——這一步是時間相依的。open() 只凍結時鐘
    // (playing=false),不保證凍在「有車跑」的時段:半夜跑這支腳本會讓當選的 3 班車全部「尚未發車/已跑完」,
    // 0 台可查,跟我的程式碼零關係、純粹是「剛好半夜測」的環境巧合。改用既有的 setSimSec()(非自製,index.html
    // 本來就靠它做跳時間/時光機)釘死在通勤尖峰 09:00,讓這項測試不論真實世界幾點跑都可重現。
    const pinnedSec = await page.evaluate(() => { setSimSec(9 * 3600); return state.simSec; });
    info('C4', `模擬時鐘釘死在 ${Math.floor(pinnedSec / 3600)}:${String(Math.floor(pinnedSec % 3600 / 60)).padStart(2, '0')}(通勤尖峰),與真實世界跑測試的時刻無關`);
    const info4 = await page.evaluate(() => {
      buildFeatured(); buildPunctual(); draw();
      return { featuredSize: state._featured.size, punctualSize: state._punctual.size };
    });
    ok('C4a 未 mock 資料時準點排行 Set 為空(本機無後端,不影響今日之最判定)', info4.punctualSize === 0, `punctualSize=${info4.punctualSize}`);
    // 預設「全」視角是拉遠看全台(甚至含中國海岸),今日之最未必落在初始畫面內——逐台把地圖瞬間置中(不用動畫,
    // 避免補間期間位置與繪製對不上)到它現在的實際位置再取樣,才是對「這台車畫得出金環嗎」的公平測試。
    let goldOk = 0, goldChecked = 0, notRunning = 0;
    const featuredNos = await page.evaluate(() => [...state._featured].map(t => String(t.train)));
    for (const fno of featuredNos) {
      const cp = await page.evaluate((fno) => {
        const tr = [...state._featured].find(t => String(t.train) === fno);
        const pos = trainPos(tr, state.simSec);
        if (!pos) return null;
        map.setView([pos.lat, pos.lon], 13, { animate: false });
        const cp2 = map.latLngToContainerPoint([pos.lat, pos.lon]);
        draw();
        return cp2;
      }, fno);
      if (!cp) { notRunning++; continue; }
      goldChecked++;
      const px = await samplePixels(page, cp.x, cp.y, 44);
      if (px.gold > 20 && px.green === 0) goldOk++;
      else info('C4b', `車次 ${fno} 置中後 gold px=${px.gold} green px=${px.green}`);
    }
    ok(`C4b 今日之最(共 ${info4.featuredSize} 台)逐台置中後都仍畫出金色像素、零綠色混入`,
       goldChecked > 0 && goldOk === goldChecked, `檢查 ${goldChecked} 台(${notRunning} 台目前未發車)，金色正確 ${goldOk} 台`);
    await ctx.close();
  }

  await browser.close();
}

// ── Section D：探索面板內容＋文案誠實線＋點擊跟隨 ──
{
  const browser = await chromium.launch();
  const { ctx, page } = await open(browser, { width: 1440 });

  const setup = await page.evaluate(() => {
    const nos = [...new Set(state.trains.filter(t => t.sys === 'tra_sched').map(t => String(t.train)))].slice(0, 3);
    state.delayStats = {};
    nos.forEach(no => { state.delayStats[no] = { a: 0, d: 22, m: 1 }; });
    state._punctual = null; buildPunctual();
    return { nos, expectLen: punctualTrainList().length };
  });
  ok('D0 測試前置：至少湊得出 1 班準點排行候選車供面板核對', setup.expectLen > 0, JSON.stringify(setup));

  const opener = (await page.$('#exploreBtn')) ? '#exploreBtn' : '#tabExplore';
  await page.click(opener);
  await page.waitForTimeout(250);
  const html = await page.evaluate(() => document.getElementById('expBody').innerHTML);

  const secStart = html.indexOf('<div class="sec">準點排行');
  ok('D1 探索面板出現「準點排行」節', secStart >= 0, '');
  let seg = '', rowCount = -1, firstNo = null;
  if (secStart >= 0) {
    const rest = html.slice(secStart);
    const nextSec = rest.indexOf('<div class="sec">', 10);
    seg = nextSec < 0 ? rest : rest.slice(0, nextSec);
    rowCount = (seg.match(/data-no="/g) || []).length;
    const m = seg.match(/data-no="([^"]+)"/);
    firstNo = m ? m[1] : null;
  }
  ok('D2 列出的車次數與判定式算出的一致', rowCount === setup.expectLen, `面板 ${rowCount} 列 vs 判定式 ${setup.expectLen} 班`);

  // 誠實線(規格更正第二版硬性要求)：標題方向要講「排行」不講「規則」,不可再對全榜下統一宣稱
  // (如「全程誤點沒超過 N 分」——那是已作廢的門檻式講法)；改成揭露排序方式與資料範圍/門數。
  const mustHave = ['30 天', '20 天', '台鐵', '10 班'];
  const mustNotHave = ['零誤點', '準點率100%', '準點率 100%', '從不誤點', '抵達誤點', '沒超過'];
  const missing = mustHave.filter(s => !seg.includes(s));
  const forbidden = mustNotHave.filter(s => html.includes(s));
  ok('D3a 誠實線：小字揭露近30天/20天/台鐵/10班資料範圍與名額', missing.length === 0, missing.length ? `缺：${missing.join('、')}` : '');
  ok('D3b 誠實線：面板全文不含禁用字樣(零誤點/準點率100%/從不誤點/抵達誤點/沒超過)', forbidden.length === 0, forbidden.length ? `出現：${forbidden.join('、')}` : '');

  // D3c：每一列自己帶證據(最糟/平均/天數字),不是對全榜下統一宣稱——規格更正第二版新增的硬性要求
  const rowChunks = seg.split('<div class="row"').slice(1);
  const evidenceRe = /最糟[\d.?]+分・平均[\d.?]+分・[\d?]+天/;
  const withEvidence = rowChunks.filter(c => evidenceRe.test(c)).length;
  ok('D3c 誠實線：每一列自己秀出最糟/平均/天數證據(不是全榜通則式宣稱)',
     rowChunks.length > 0 && withEvidence === rowChunks.length, `${withEvidence}/${rowChunks.length} 列含自身證據`);

  if (firstNo) {
    await page.click(`#explorePanel .row[data-no="${firstNo}"]`);
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => ({
      followNo: state.followTrain ? String(state.followTrain.train) : null,
      followSys: state.followTrain ? state.followTrain.sys : null,
      panelHidden: document.getElementById('explorePanel').hidden,
    }));
    ok('D4 點準點排行列 → 正確跟隨該班台鐵車且面板關閉', after.followNo === firstNo && after.followSys === 'tra_sched' && after.panelHidden, JSON.stringify(after));
  }
  await ctx.close();

  // D5：零合格車時,面板不出現該節(不留空節)
  {
    const { ctx: ctx2, page: page2 } = await open(browser, { width: 1440 });
    await page2.evaluate(() => { state.delayStats = {}; state._punctual = null; buildPunctual(); });
    const opener2 = (await page2.$('#exploreBtn')) ? '#exploreBtn' : '#tabExplore';
    await page2.click(opener2);
    await page2.waitForTimeout(250);
    const html2 = await page2.evaluate(() => document.getElementById('expBody').innerHTML);
    ok('D5 零合格車時,不出現「準點排行」節(不留空節)', !html2.includes('準點排行'), '');
    await ctx2.close();
  }

  // D6：全端管線「固定10列」——不同於 A2(純函式合成資料),這裡用「真實存在於 state.trains 的台鐵車」
  // 當候選(≥11班皆合格),驗證掛到真實列車清單、經 punctualTrainList() 交集後,仍只列前10班,不是門檻卡出來的。
  {
    const { ctx: ctx3, page: page3 } = await open(browser, { width: 1440 });
    const tenCheck = await page3.evaluate(() => {
      const nos = [...new Set(state.trains.filter(t => t.sys === 'tra_sched').map(t => String(t.train)))].slice(0, 14);
      if (nos.length < 11) return { skip: true, have: nos.length };
      const ds = {};
      nos.forEach((no, i) => { ds[no] = { a: 0, d: 25, m: i }; }); // m 各不相同,嚴格排序無並列疑慮
      state.delayStats = ds; state._punctual = null; buildPunctual();
      return { skip: false, total: nos.length, listLen: punctualTrainList().length };
    });
    if (tenCheck.skip) {
      ok('D6 全端管線固定10列(目前畫面內台鐵車不足11班,誠實跳過非硬性失敗)', true, `僅 ${tenCheck.have} 班,無法排除邊界情境`);
    } else {
      ok(`D6 全端管線:餵入 ${tenCheck.total} 班真實候選車(皆已存在於 state.trains)都合格,punctualTrainList() 仍恰好只列前10班`,
         tenCheck.listLen === 10, `實得 ${tenCheck.listLen} 班`);
    }
    await ctx3.close();
  }

  await browser.close();
}

// ── Section E：WebKit 佐證(使用者是 macOS/iOS,WebKit 是主戰場)──
{
  const browser = await webkit.launch();
  const { ctx, page } = await open(browser, { width: 1440 });

  const r = await crossGateCheck(page);
  ok('E1 WebKit：跨系統閘門正確(準點排行 Set 只收台鐵)', !r.error && r.hasRealOnly && !r.leaked, JSON.stringify(r));

  const no = await pickOnscreenTraTrain(page);
  if (no) {
    await page.evaluate((no) => {
      state.delayStats = {}; state.delayStats[no] = { a: 0, d: 22, m: 1 };
      state._punctual = null; buildPunctual(); draw();
    }, no);
    const cp = await page.evaluate((no) => {
      const tr = state.trains.find(t => String(t.train) === no && t.sys === 'tra_sched');
      const pos = trainPos(tr, state.simSec);
      return map.latLngToContainerPoint([pos.lat, pos.lon]);
    }, no);
    const px = await samplePixels(page, cp.x, cp.y, 44);
    ok('E2 WebKit：綠環確實畫出綠色像素', px.green > 50, `green px=${px.green}`);
  } else ok('E2 WebKit：綠環確實畫出綠色像素', false, '找不到畫面內台鐵列車');

  const setup = await page.evaluate(() => {
    const nos = [...new Set(state.trains.filter(t => t.sys === 'tra_sched').map(t => String(t.train)))].slice(0, 2);
    state.delayStats = {}; nos.forEach(n => { state.delayStats[n] = { a: 0, d: 22, m: 1 }; });
    state._punctual = null; buildPunctual();
    return punctualTrainList().length;
  });
  const opener = (await page.$('#exploreBtn')) ? '#exploreBtn' : '#tabExplore';
  await page.click(opener);
  await page.waitForTimeout(250);
  const html = await page.evaluate(() => document.getElementById('expBody').innerHTML);
  ok('E3 WebKit：探索面板正確顯示準點排行節', html.includes('準點排行') && setup > 0, `expectLen=${setup}`);

  await ctx.close(); await browser.close();
}

// ── Section F：手機三寬度(375/414/768)× 雙引擎——不溢出、不重疊、真點擊命中 ──
for (const engineName of ['chromium', 'webkit']) {
  const browser = await (engineName === 'chromium' ? chromium.launch() : webkit.launch());
  for (const width of [375, 414, 768]) {
    const height = width === 768 ? 1024 : 812;
    const { ctx, page } = await open(browser, { width, height, hasTouch: true });

    const setup = await page.evaluate(() => {
      const nos = [...new Set(state.trains.filter(t => t.sys === 'tra_sched').map(t => String(t.train)))].slice(0, 4);
      state.delayStats = {}; nos.forEach(n => { state.delayStats[n] = { a: 0, d: 22, m: 1 }; });
      state._punctual = null; buildPunctual();
      return punctualTrainList().length;
    });

    const opener = (await page.$('#tabExplore')) ? '#tabExplore' : '#exploreBtn';
    await page.click(opener);
    await page.waitForTimeout(300);

    const geom = await page.evaluate(() => {
      const panel = document.getElementById('explorePanel');
      const pr = panel.getBoundingClientRect();
      const rows = [...document.querySelectorAll('#explorePanel .row[data-no]')];
      // 只取「準點排行」節內的列(該節之後沒有其他 data-no 節,見 index.html renderExplorePanel 排版順序)
      const secEls = [...document.querySelectorAll('#explorePanel .sec')];
      const puncSec = secEls.find(s => s.textContent.trim() === '準點排行');
      let puncRows = [];
      if (puncSec) {
        let n = puncSec.nextElementSibling;
        while (n && n.classList.contains('row')) { if (n.hasAttribute('data-no')) puncRows.push(n); n = n.nextElementSibling; }
      }
      return {
        scrollWidth: document.documentElement.scrollWidth, innerWidth: innerWidth,
        panelInView: pr.left >= -1 && pr.right <= innerWidth + 1,
        totalRows: rows.length, puncRowCount: puncRows.length,
        firstPuncNo: puncRows[0] ? puncRows[0].dataset.no : null,
      };
    });
    ok(`F1 手機${width}px(${engineName})：面板不造成頁面橫向溢出`, geom.scrollWidth <= geom.innerWidth + 1, `scrollWidth=${geom.scrollWidth} vs ${geom.innerWidth}`);
    ok(`F2 手機${width}px(${engineName})：面板完整落在視窗寬度內`, geom.panelInView, '');
    ok(`F3 手機${width}px(${engineName})：準點排行列數符合預期`, geom.puncRowCount === setup, `面板 ${geom.puncRowCount} vs 預期 ${setup}`);

    // 真點擊命中：把第一列捲進視野後用 elementFromPoint 命中測試(心得19/37——rect 不落在可捲祖先內不代表不可點)
    if (geom.firstPuncNo) {
      const hit = await page.evaluate((no) => {
        const row = document.querySelector(`#explorePanel .row[data-no="${no}"]`);
        row.scrollIntoView({ block: 'center' });
        const b = row.getBoundingClientRect();
        const el = document.elementFromPoint(b.left + 12, b.top + b.height / 2);
        return { hitInRow: !!(el && (row.contains(el) || el === row)), x: b.left + 12, y: b.top + b.height / 2 };
      }, geom.firstPuncNo);
      ok(`F4 手機${width}px(${engineName})：準點排行列捲進視野後真的點得到`, hit.hitInRow, '');
      if (hit.hitInRow) {
        await page.tap(`#explorePanel .row[data-no="${geom.firstPuncNo}"]`);
        await page.waitForTimeout(250);
        const followNo = await page.evaluate(() => state.followTrain ? String(state.followTrain.train) : null);
        ok(`F5 手機${width}px(${engineName})：實點觸控後正確跟隨`, followNo === geom.firstPuncNo, `followNo=${followNo}`);
      }
    }
    await ctx.close();
  }
  await browser.close();
}

// ── Section G：更新紀錄結構完整性(比照 rail-changelog-required.md 的 CL0/CL1/CL1b/CL2) ──
{
  const html = readFileSync('index.html', 'utf8');
  const foot = (html.match(/<ul class="foot-list foot-recent">([\s\S]*?)<\/ul>/) || [, ''])[1];
  const ofIds = [...foot.matchAll(/data-cl-of="([^"]+)"/g)].map(m => m[1]);
  const allClIds = [...html.matchAll(/data-cl="([^"]+)"/g)].map(m => m[1]);
  ok('G1 首層(最近更新)≤8 條', ofIds.length <= 8, `實際 ${ofIds.length} 條`);
  // 🔴 2026-08-14 改判準:原本斷言「首層有本次 punctualtrains 條目」。首層(.foot-recent)是「最近更新」的
  //    滾動檢視,硬上限 8 條(CL2),新功能一進榜舊的就會被合法擠出去——CL1 明文允許這件事,只要正本
  //    還在第二層。所以「我的功能在第一層」是個會隨時間自然失效的量,綁它等於保證幾批更新之後永久假紅,
  //    訓練大家忽略這支腳本的輸出(比照 verify_live_activity.mjs 2026-08-04 的同一次修正)。
  //    改成綁真正該保證的事:正本在第二層恰好一條。首層自身的結構完整性已由 G1(≤8 條)與
  //    G4(首層每條都找得到正本)覆蓋,不需要這條再管。
  const canonCount = allClIds.filter(id => id === 'punctualtrains').length;
  ok('G2 第二層有「punctualtrains」正本(恰好一條)', canonCount === 1, `實際 ${canonCount} 條`);
  const dupes = [...new Set(allClIds.filter((id, i) => allClIds.indexOf(id) !== i))];
  ok('G3 第二層 data-cl id 不重複', dupes.length === 0, dupes.join('、'));
  const missing = ofIds.filter(id => !allClIds.includes(id));
  ok('G4 首層每條都找得到第二層正本', missing.length === 0, missing.join('、'));
}

} finally {
  if (mutantWritten) { try { unlinkSync(MUTANT_PATH); } catch (e) {} }
}

const bad = R.filter(r => !r.p);
console.log(`\n=== ${R.length - bad.length}/${R.length} 通過 ===`);
if (bad.length) { console.log('未過：'); bad.forEach(b => console.log(' ・' + b.n + ' — ' + b.msg)); process.exit(1); }
