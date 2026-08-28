#!/usr/bin/env node
// 跟車配樂:情境判定(地點/時間)、選池計分、播放模式與資格折疊的行為驗收。
//
// 為什麼載真的 index.html 直接呼叫那幾支函式:如果另寫一份 JS 期望模型來對答案,
// 判準就與實作共用同一套假設,兩邊一起錯的時候會集體全綠(記憶 心得 29)。
// 所以這裡只用【外部常數】當判準——已知座標屬於哪個縣市、幾點屬於哪個時段,
// 都是查得到的事實,不是從實作推導出來的。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(process.env.MUSIC_SCORING_PORT || 46471);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };
const ZONES = ['metro', 'north-city', 'north-coast', 'yilan', 'hualien', 'taitung', 'west-plain', 'south', 'mountain'];
const HOURS = ['dawn', 'day', 'dusk', 'evening', 'night'];

// ── G0 自檢:證明驗的是當前工作區那一份,不是別的 worktree(記憶 心得 32/38)──
const src = await readFile(join(ROOT, 'index.html'), 'utf8');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html ${src.length} bytes、${src.split('\n').length} 行`);
if (!existsSync(join(ROOT, 'data', 'music.json'))) { console.error('❌ [G0] 缺 data/music.json,先跑 npm run build-music'); process.exit(1); }

const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.startsWith('/api/')) {
      res.statusCode = 200; res.setHeader('content-type', 'application/json');
      // 🔴 高鐵班表不能回空物件:200 會讓前端認為拿到資料而【不】走靜態 fallback,boot 反而中止
      //    (2026-08-13 的 verify_music_playlist.mjs 已踩過並記下)。
      if (p === '/api/thsr-schedule') return res.end(await readFile(join(ROOT, 'data/thsr_schedule_dense.json')));
      return res.end('{}');
    }
    const file = join(ROOT, p === '/' ? 'index.html' : p);
    if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
    res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('nf'); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const results = [];
const ok = (id, pass, detail = '') => { results.push({ id, pass }); console.log(`${pass ? '✅' : '❌'} ${id}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('pageerror', e => console.error('   [pageerror]', String(e).slice(0, 160)));
await ctx.addInitScript(() => {           // 鍵名照 2026-08-13 那份驗收腳本,不是憑猜
  try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {}
  try { localStorage.setItem('trainmap-appearance', 'light'); } catch (e) {}
});
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.musicPickPool === 'function'
  && window.MUSIC_DATA && window.MUSIC_DATA.pools && window.MUSIC_DATA.pools.length === 16,
  null, { timeout: 30000 });

// ── A. 分區判定。期望值來自「這個座標在哪個縣市」這個外部事實 ──
for (const [nm, lat, lon, sys, want] of [
  ['台北車站', 25.0478, 121.5170, null, 'north-city'],
  ['基隆火車站', 25.1310, 121.7400, null, 'north-coast'],
  ['宜蘭火車站', 24.7540, 121.7580, null, 'yilan'],
  ['花蓮火車站', 23.9930, 121.6010, null, 'hualien'],
  ['台東火車站', 22.7930, 121.1230, null, 'taitung'],
  ['台中火車站', 24.1370, 120.6870, null, 'west-plain'],
  ['高雄火車站', 22.6390, 120.3020, null, 'south'],
  ['南投埔里', 23.9650, 120.9660, null, 'mountain'],
  // 🔴 這一格是唯一能區分「取最小面積框」與「取第一個命中框」的案例:內灣站同時落在
  //    taoyuan[24.60,120.96,25.12,121.45](排序在前、面積 0.255)與
  //    hsinchu[24.55,120.85,24.92,121.30](面積 0.167)裡。取第一個會判成 north-city。
  //    沒有這一格,整組 A 都測不到那條邏輯(2026-08-29 設計突變測試時發現)。
  ['內灣站(桃竹重疊區)', 24.7086, 121.1955, null, 'west-plain'],
  ['台北座標但搭捷運', 25.0478, 121.5170, 'mrt', 'metro'],
  ['嘉義座標但搭林鐵', 23.5100, 120.8000, 'afr', 'mountain'],
  ['海上(界外)', 24.0000, 119.0000, null, null],
]) {
  const got = await page.evaluate(([a, b, c]) => window.musicZoneOf(a, b, c), [lat, lon, sys]);
  ok(`A ${nm} → ${want}`, got === want, `實際 ${got}`);
}

// ── B. 時段切分。含每一段的兩個邊界 ──
for (const [sec, want] of [[4 * 3600, 'dawn'], [6 * 3600 + 3599, 'dawn'], [7 * 3600, 'day'],
  [15 * 3600 + 3599, 'day'], [16 * 3600, 'dusk'], [18 * 3600 + 3599, 'dusk'], [19 * 3600, 'evening'],
  [22 * 3600 + 3599, 'evening'], [23 * 3600, 'night'], [3 * 3600 + 3599, 'night'], [0, 'night'],
  [24 * 3600 + 8 * 3600, 'day']]) {
  const got = await page.evaluate(s => window.musicHourBucket(s), sec);
  ok(`B ${String(Math.floor(sec / 3600)).padStart(2, '0')}時 → ${want}`, got === want, `實際 ${got}`);
}

// ── C. 45 格覆蓋率(行為層):每格都選得出,且選出的池真的相容 ──
const grid = await page.evaluate(([zs, hs]) => {
  const out = [];
  for (const z of zs) for (const h of hs) {
    const p = window.musicPickPool(z, h, window.MUSIC_DATA.pools, null);
    out.push({ z, h, id: p && p.id, zones: p && p.zones, hours: p && p.hours, auto: p && p.auto });
  }
  return out;
}, [ZONES, HOURS]);
ok('C1 格數分母 = 45', grid.length === 45, `實際 ${grid.length}`);
ok('C2 每格都選得出池', grid.every(g => g.id), grid.filter(g => !g.id).map(g => `${g.z}×${g.h}`).join(', '));
ok('C3 選出的池與情境相容', grid.every(g => !g.id ||
  ((g.zones === null || g.zones.includes(g.z)) && (g.hours === null || g.hours.includes(g.h)))),
  grid.filter(g => g.id && ((g.zones && !g.zones.includes(g.z)) || (g.hours && !g.hours.includes(g.h))))
    .map(g => `${g.z}×${g.h}→${g.id}`).join(', '));
ok('C4 選出的池一律是 auto', grid.every(g => !g.id || g.auto === true),
  grid.filter(g => g.id && !g.auto).map(g => g.id).join(', '));
// 正向對照:auto:false 的池絕不可被自動選到(否則「乾脆全放行」也會全綠)
ok('C5 手動限定池不得出現在任何一格',
  !grid.some(g => ['rainy-city', 'island-community', 'rail-texture-score'].includes(g.id)),
  grid.filter(g => ['rainy-city', 'island-community', 'rail-texture-score'].includes(g.id)).map(g => `${g.z}×${g.h}→${g.id}`).join(', '));

// ── D. 同分輪替。花蓮×清晨是刻意的平手格(花蓮山海地理命中 2 分、晨曦初班時段命中 2 分)──
const picks = await page.evaluate(() => {
  const seen = []; let last = null;
  for (let i = 0; i < 10; i++) { const p = window.musicPickPool('hualien', 'dawn', window.MUSIC_DATA.pools, last); seen.push(p.id); last = p.id; }
  return seen;
});
ok('D1 平手格會輪替', new Set(picks).size >= 2, picks.join(','));
ok('D2 連續兩次不重複', picks.every((v, i) => i === 0 || v !== picks[i - 1]), picks.join(','));
// 非平手格必須穩定:捷運×白天只有「捷運流動」能命中(都會日行的 zones 不含 metro)
const stable = await page.evaluate(() => {
  const s = []; let last = null;
  for (let i = 0; i < 6; i++) { const p = window.musicPickPool('metro', 'day', window.MUSIC_DATA.pools, last); s.push(p.id); last = p.id; }
  return s;
});
ok('D3 非平手格必須穩定不亂跳', new Set(stable).size === 1 && stable[0] === 'metro-motion', stable.join(','));

// ── E. 播放模式與資格折疊 ──────────────────────────────────────────────────────
const e1 = await page.evaluate(() => {
  state.plus = { active: false };
  window.musicApplyMode({ kind: 'pool', id: 'metro-motion' }, { noLoad: true });
  return { mode: state.music.mode, eff: window.musicEffectiveMode().kind, n: state.music.list.length };
});
ok('E1 無資格時付費模式折成 free', e1.eff === 'free', JSON.stringify(e1));
ok('E2 無資格時播的是免費 57 首', e1.n === 57, `實際 ${e1.n}`);
ok('E3 使用者的選擇要留著(不被改寫)', e1.mode.kind === 'pool' && e1.mode.id === 'metro-motion', JSON.stringify(e1.mode));

const e4 = await page.evaluate(() => {
  state.plus = { active: true };
  window.musicApplyMode({ kind: 'pool', id: 'metro-motion' }, { noLoad: true });
  const pool = state.music.list.slice();
  window.musicApplyMode({ kind: 'family', id: 'city-circuit' }, { noLoad: true });
  const fam = state.music.list.slice();
  window.musicApplyMode({ kind: 'free' }, { noLoad: true });
  return { pool: pool.length, fam: fam.length, free: state.music.list.length,
    poolAllPaid: pool.every(x => x.startsWith('_pass/metro-motion/')),
    famAllPaid: fam.every(x => x.startsWith('_pass/')) };
});
ok('E4 單池模式只播那一池(7 首)', e4.pool === 7 && e4.poolAllPaid, JSON.stringify(e4));
ok('E5 家族模式聚合該家族已上架的池(9+6+7=22 首)', e4.fam === 22 && e4.famAllPaid, JSON.stringify(e4));
ok('E5b 免費模式回到 57 首', e4.free === 57, JSON.stringify(e4));

// 空池不得讓音樂靜掉:未上架的池要退回免費
const e6 = await page.evaluate(() => {
  state.plus = { active: true };
  window.musicApplyMode({ kind: 'pool', id: 'yilan-line' }, { noLoad: true });   // 尚未上架
  return { n: state.music.list.length, mode: state.music.mode.id };
});
ok('E6 選到未上架的池會退回免費而不是靜掉', e6.n === 57 && e6.mode === 'yilan-line', JSON.stringify(e6));

// musicLabel:付費路徑不得顯示 "_pass"(2026-08-27 裁示:顯示歌單名,不顯示曲名)
const lab = await page.evaluate(() => [
  window.musicLabel('Afloat/Zero Gravity Dream.mp3'),
  window.musicLabel('_pass/metro-motion/Metro Pulse.mp3'),
  window.musicLabel('_pass/urban-jazz/Blue Signal.mp3'),
]);
ok('E7 免費曲標籤 = 資料夾名', lab[0] === 'Afloat', JSON.stringify(lab));
ok('E8 付費曲標籤 = 池的中文名,不得是 _pass', lab[1] === '捷運流動' && lab[2] === '都市爵士', JSON.stringify(lab));

// ── F. 遲滯與曲末換池 ─────────────────────────────────────────────────────────
// 🔴 每次改情境要 tick【兩次】:第一次只是把新情境登記成候選並重新計時(必定 return),
//    遲滯邏輯要到第二次才上場。只 tick 一次的話,遲滯設成 0 也照樣不換 ⇒ 判準恆真。
//    (2026-08-29 突變測試發現:HOLD=0 的突變讓不動任何判準變紅,才抓到這個真空。)
const f = await page.evaluate(() => {
  const R = {};
  state.plus = { active: true };
  state.followTrain = null;
  const set = (z, h) => { window.__musicTestCtx = { zone: z, hour: h }; };
  set('north-city', 'night');
  window.musicApplyMode({ kind: 'auto' }, { noLoad: true });
  state.music._ctxKey = ''; state.music._ctxCand = ''; state.music._ctxAt = 0;
  window.musicContextTick(0);
  R.k0 = state.music._ctxKey;
  set('yilan', 'night');
  window.musicContextTick(1000);                 // 登記候選,_ctxAt = 1000
  window.musicContextTick(61000);                // 已過 60 秒 < 90 ⇒ 不得換
  R.k60 = state.music._ctxKey;
  set('north-city', 'night'); window.musicContextTick(62000);   // 候選換回去 ⇒ 計時重來
  set('yilan', 'night');      window.musicContextTick(63000);   // 又換過去 ⇒ _ctxAt = 63000
  window.musicContextTick(120000);               // 距 63000 才 57 秒 ⇒ 仍不得換
  R.kReset = state.music._ctxKey;
  window.musicContextTick(160000);               // 距 63000 已 97 秒 ⇒ 必須換
  R.kFinal = state.music._ctxKey;
  return R;
});
ok('F1 開機當下的情境立即成立', f.k0 === 'north-city|night', JSON.stringify(f));
ok('F2 跨區 60 秒不得換(遲滯 90 秒)', f.k60 === 'north-city|night', JSON.stringify(f));
ok('F3 候選中途變過就重新計時(119 秒但只連續 57 秒 ⇒ 不換)', f.kReset === 'north-city|night', JSON.stringify(f));
ok('F4 連續成立 97 秒必須換', f.kFinal === 'yilan|night', JSON.stringify(f));

const g = await page.evaluate(() => {
  state.plus = { active: true };
  window.__musicTestCtx = { zone: 'metro', hour: 'day' };
  window.musicApplyMode({ kind: 'auto' }, { noLoad: true });
  state.music._ctxKey = ''; state.music._ctxCand = ''; state.music._ctxAt = 0;
  window.musicContextTick(0);
  const before = state.music.list.slice();
  window.__musicTestCtx = { zone: 'north-city', hour: 'dusk' };
  for (let t = 0; t <= 400000; t += 50000) window.musicContextTick(t);
  return { sameList: JSON.stringify(before) === JSON.stringify(state.music.list), key: state.music._ctxKey };
});
ok('F5 情境變了但清單不得當場被換掉(不打斷正在播的曲子)', g.sameList, JSON.stringify(g));
ok('F6 生效情境已更新(等 ended 才換池)', g.key === 'north-city|dusk', JSON.stringify(g));

// F7/F8 手動即釘住:釘住之後情境再怎麼變、曲末也不得換池。
// 🔴 情境刻意用 north-city|dusk——那格【選得出】已上架的都市爵士,所以「保護失效就會換池」。
//    用選不出池的情境(如 north-city|night,三個已上架池全不命中)會讓這條恆真。
const pin = await page.evaluate(() => {
  state.plus = { active: true };
  window.musicApplyMode({ kind: 'pool', id: 'metro-motion' }, { noLoad: true });
  const before = state.music.list.slice().sort();
  window.__musicTestCtx = { zone: 'north-city', hour: 'dusk' };
  state.music._ctxKey = ''; state.music._ctxCand = ''; state.music._ctxAt = 0;
  window.musicContextTick(0);
  const wouldPick = window.musicAutoPool();       // 先證明這個情境真的選得出別的池
  window.musicNext();
  return { same: JSON.stringify(before) === JSON.stringify(state.music.list.slice().sort()),
    kind: window.musicEffectiveMode().kind, wouldPick: wouldPick && wouldPick.id };
});
ok('F7a 這個情境確實選得出另一個池(前置條件成立)', pin.wouldPick === 'urban-jazz', JSON.stringify(pin));
ok('F7 釘住後曲末不換池', pin.same, JSON.stringify(pin));
ok('F8 釘住期間模式維持 pool', pin.kind === 'pool', JSON.stringify(pin));

// F9 自動模式在曲末【要】換池(否則「乾脆都別換」也會讓 F7 全綠)
const auto = await page.evaluate(() => {
  state.plus = { active: true };
  window.__musicTestCtx = { zone: 'metro', hour: 'day' };
  window.musicApplyMode({ kind: 'auto' }, { noLoad: true });
  state.music._ctxKey = ''; state.music._ctxCand = ''; state.music._ctxAt = 0;
  window.musicContextTick(0);
  window.musicNext();
  const a = state.music.list.slice();
  window.__musicTestCtx = { zone: 'north-city', hour: 'dusk' };
  for (let t = 0; t <= 400000; t += 100000) window.musicContextTick(t);
  window.musicNext();
  return { from: a[0], to: state.music.list[0], pool: state.music._curPoolId };
});
ok('F9 自動模式曲末真的換池(正向對照)',
  auto.from && auto.to && auto.from.split('/')[1] !== auto.to.split('/')[1], JSON.stringify(auto));

// ── G. 資格回得去 ─────────────────────────────────────────────────────────────
// 🔴 跨 runtime 資格旗標是單向閥(true 推得出、false 推不回)是既有踩坑,
//    只驗「訂閱後解鎖」會整組全綠而照不到撤銷那半,更照不到「撤銷後回得去」。
const gg = await page.evaluate(() => {
  const R = {};
  state.plus = { active: true };
  state.music._effKey = '';
  window.musicApplyMode({ kind: 'family', id: 'city-circuit' }, { noLoad: true });
  window.musicReconcileMode();
  R.onEff = window.musicEffectiveMode().kind; R.onN = state.music.list.length;
  state.plus = { active: false };                 // 撤銷資格
  window.musicReconcileMode();
  R.offEff = window.musicEffectiveMode().kind; R.offN = state.music.list.length;
  R.offMode = state.music.mode.kind + ':' + state.music.mode.id;   // 使用者的選擇要留著
  state.plus = { active: true };                  // 資格回來
  window.musicReconcileMode();
  R.backEff = window.musicEffectiveMode().kind; R.backN = state.music.list.length;
  return R;
});
ok('G1 有資格時家族模式生效(22 首)', gg.onEff === 'family' && gg.onN === 22, JSON.stringify(gg));
ok('G2 撤銷後退回免費 57 首', gg.offEff === 'free' && gg.offN === 57, JSON.stringify(gg));
ok('G3 撤銷後【不】改寫使用者的選擇', gg.offMode === 'family:city-circuit', JSON.stringify(gg));
ok('G4 資格回來自動接回(回得去)', gg.backEff === 'family' && gg.backN === 22, JSON.stringify(gg));

// G5 同一個生效模式重複呼叫不得重洗清單(開機期會跑好幾次,重洗會把正在播的曲子切掉)
const g5 = await page.evaluate(() => {
  state.plus = { active: true };
  state.music._effKey = '';
  window.musicApplyMode({ kind: 'pool', id: 'urban-jazz' }, { noLoad: true });
  window.musicReconcileMode();
  const a = state.music.list.slice();
  for (let i = 0; i < 5; i++) window.musicReconcileMode();
  return { same: JSON.stringify(a) === JSON.stringify(state.music.list) };
});
ok('G5 生效模式沒變時重複呼叫不重洗', g5.same, JSON.stringify(g5));

await browser.close();
server.close();
const bad = results.filter(r => !r.pass);
console.log(`\n總計 ${results.length} 項,PASS ${results.length - bad.length},FAIL ${bad.length}`);
process.exit(bad.length ? 1 : 0);
