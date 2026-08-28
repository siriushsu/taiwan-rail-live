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

await browser.close();
server.close();
const bad = results.filter(r => !r.pass);
console.log(`\n總計 ${results.length} 項,PASS ${results.length - bad.length},FAIL ${bad.length}`);
process.exit(bad.length ? 1 : 0);
