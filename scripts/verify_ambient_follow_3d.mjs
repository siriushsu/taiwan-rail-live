// 放空「跟車」= 立體列車近景 — Playwright 真引擎 + 本機靜態伺服器。
//
// 來源(2026-09-07 使用者):「放空模式,如果是跟車,直接是放大到可以看到實際上的列車 3D 模型在跑的」
// 以及「之前新增的曲目都加入網站放空模式的輪播,但是不用讓他可以選擇」。
//
// 改動前的實況(本腳本的反向對照就是在釘這件事):放空跟車固定停在介面縮放 14,而 rail-3d 的三道門檻
// 都用 MapLibre 原生刻度(= 介面 − ML_Z)⇒ 原生只有 13,render() 低於 13.8 直接不 capture、
// recenter() 低於 14 不接手相機、cinematicPose 根本沒被呼叫 ⇒ pitch 恆 0、一台立體列車都沒有。
//
// 判準紀律:
//  - 每一條「近景成立」都配一個【控制組】(同一個 harness、視角切成群車)必須反向成立,否則就是沒牙。
//  - 縮放不比死值,比「畫面尺寸推導出來的目標值」——目標本身隨可視窗變動(手機/桌機差一個多檔次),
//    寫死數字會在改版面時假紅。手機是否真的比桌機遠,另外用 A4 明講。
//  - 曲庫比對用集合運算(免費/池各自的 src 集合),不比首數:加池不該讓這支假紅(見 music-playlist-design)。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5341);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.bin': 'application/octet-stream', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) { res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.setHeader('accept-ranges', 'bytes');
  const buf = readFileSync(fp), range = req.headers.range;
  if (range) { const m = /bytes=(\d+)-(\d*)/.exec(range); if (m) { const s = +m[1], e = m[2] ? +m[2] : buf.length - 1; res.statusCode = 206; res.setHeader('content-range', `bytes ${s}-${e}/${buf.length}`); return res.end(buf.subarray(s, e + 1)); } }
  res.end(buf);
});
await new Promise(r => server.listen(PORT, r));

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

// ── T0 目標自檢:先證明「我在驗誰」 ──────────────────────────────────────────────
const idxSrc = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
console.log(`\n目標: ${ROOT}/index.html  md5=${createHash('md5').update(idxSrc).digest('hex').slice(0, 12)}  BUILD=${(idxSrc.match(/const BUILD = '([^']*)'/) || [])[1]}\n`);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];

// style: 'follow' | 'hotspot';回傳進放空後的量測 + 離場還原
async function run({ style, width, height, mobile, app }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, locale: 'zh-TW',
    ...(mobile ? { hasTouch: true, isMobile: true } : {}) });
  await ctx.addInitScript(s => {
    localStorage.setItem('trainmap-howto-seen', '1');
    localStorage.setItem('trainmap-language', 'zh-TW');
    localStorage.setItem('trainmap-appearance', 'dark');
    localStorage.setItem('trainmap-ambient-style', s);
  }, style);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/?lang=zh-TW`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready && window.__M && state.mode === 'sched'
    && state.music && (window.MUSIC_DATA.pools || []).some(p => p.tracks && p.tracks.length); } catch (e) { return false; } }, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  if (app) await page.evaluate(() => { window.RAIL_APP_VERSION = '1.5.8'; });
  // 釘死模擬時鐘到傍晚尖峰(深夜幾乎沒車會讓「有沒有跟到車」變成擲骰子);速度先擺一個非預設值才驗得到還原
  await page.evaluate(() => { setSimSec(18 * 3600); setSpeed(10); });
  await page.waitForTimeout(300);
  const music = () => page.evaluate(() => { const m = state.music, D = window.MUSIC_DATA;
    const free = new Set((D.free.tracks || []).map(t => t.src));
    const pool = new Set(musicShippedPools().flatMap(p => p.tracks.map(t => t.src)));
    return { n: m.list.length, fromFree: m.list.filter(s => free.has(s)).length, fromPool: m.list.filter(s => pool.has(s)).length,
      freeTotal: free.size, poolTotal: pool.size, dup: m.list.length - new Set(m.list).size,
      plBtn: !!document.getElementById('musicPlBtn'), plRow: !!document.querySelector('.ms-row[data-act="musicpl"]') }; });
  const before = await music();
  await page.evaluate(() => setAmbient(true));
  await page.waitForTimeout(6000);   // 讓 3D 接手、cinematicPose 跑起來
  const cam = await page.evaluate(() => { const r = window.railIslandIntegration, st = r?.renderer?.stats || {};
    return { z: window.__M.getZoom(), want: ambientFollowZoom(), pitch: window.__M.raw.getPitch(), spd: state.speedMult,
      d3: !!r?.active, sel: r?.frame?.selectedVehicleId || null, pose: (st.poseSamples || []).length, cam: st.ambientCamera || null }; });
  const during = await music();
  const left = await page.evaluate(() => { setAmbient(false); return { spd: state.speedMult }; });
  await page.waitForTimeout(300);
  const after = await music();
  await ctx.close();
  return { cam, before, during, after, left };
}

const desk = await run({ style: 'follow', width: 1440, height: 900 });
const hot = await run({ style: 'hotspot', width: 1440, height: 900 });
const mob = await run({ style: 'follow', width: 402, height: 874, mobile: true });
const appRun = await run({ style: 'follow', width: 1440, height: 900, app: true });

// ── A 鏡頭:近景成立 + 群車控制組反向成立 ───────────────────────────────────────
ok('A0 前提 立體列車在這個 harness 裡真的有備妥', desk.cam.d3 && mob.cam.d3, `desk=${desk.cam.d3} mob=${desk.cam.d3}`);
ok('A1 跟車 縮放收斂到畫面推導出來的目標(±0.15)', Math.abs(desk.cam.z - desk.cam.want) <= 0.15,
  `z=${desk.cam.z.toFixed(2)} want=${desk.cam.want.toFixed(2)}`);
ok('A1b 跟車 目標高於 rail-3d 的三道門檻(介面 15 = 原生 14)', desk.cam.want >= 15 && desk.cam.z >= 15,
  `z=${desk.cam.z.toFixed(2)}`);
ok('A1c 控制組 群車 仍是平面俯瞰(< 15)', hot.cam.z < 15, `z=${hot.cam.z.toFixed(2)}`);
ok('A2 跟車 相機是斜的(pitch ≥ 45)', desk.cam.pitch >= 45, `pitch=${desk.cam.pitch}`);
ok('A2c 控制組 群車 pitch 維持 0', hot.cam.pitch === 0, `pitch=${hot.cam.pitch}`);
ok('A3 跟車 3D 幀真的有選中的車 + 至少一組車廂姿態', !!desk.cam.sel && desk.cam.pose >= 1,
  `sel=${desk.cam.sel} pose=${desk.cam.pose} cam=${desk.cam.cam}`);
ok('A3c 控制組 群車 3D 沒有選中車(不跟車)', !hot.cam.sel, `sel=${hot.cam.sel}`);
ok('A4 手機比桌機退一個檔次以上(高度由可視窗推導,不是寫死)', desk.cam.want - mob.cam.want >= 0.8,
  `desk=${desk.cam.want.toFixed(2)} mob=${mob.cam.want.toFixed(2)}`);
ok('A4b 手機仍在門檻之上(近景在窄螢幕不會被推回平面)', mob.cam.z >= 15, `z=${mob.cam.z.toFixed(2)}`);

// ── B 節奏:近景用真實速度,群車維持 5×,離場一律還原 ─────────────────────────────
ok('B1 跟車近景 節奏 = 1×(5× 在這個高度是每秒 1,680px)', desk.cam.spd === 1 && mob.cam.spd === 1,
  `desk=${desk.cam.spd} mob=${mob.cam.spd}`);
ok('B1c 控制組 群車 維持 5×', hot.cam.spd === 5, `spd=${hot.cam.spd}`);
ok('B2 離開放空 還原進場前的速度(進場前釘 10×)', desk.left.spd === 10 && hot.left.spd === 10,
  `follow=${desk.left.spd} hotspot=${hot.left.spd}`);

// ── C 曲庫:網站放空混進情境池,離場退回,App 不受影響,且沒有選擇入口 ───────────────
ok('C0 前提 情境池有上架曲目可混', desk.before.poolTotal > 0, `pool=${desk.before.poolTotal} free=${desk.before.freeTotal}`);
ok('C1 網站 放空前只有免費曲庫', desk.before.fromPool === 0 && desk.before.n === desk.before.freeTotal,
  `n=${desk.before.n}/${desk.before.freeTotal}`);
ok('C2 網站 放空中 = 免費 ∪ 已上架池(兩邊都全到齊)',
  desk.during.fromFree === desk.during.freeTotal && desk.during.fromPool === desk.during.poolTotal,
  `free ${desk.during.fromFree}/${desk.during.freeTotal} + pool ${desk.during.fromPool}/${desk.during.poolTotal} = ${desk.during.n}`);
ok('C2b 網站 放空曲庫無重複', desk.during.dup === 0, `dup=${desk.during.dup}`);
ok('C3 網站 離開放空退回免費曲庫', desk.after.fromPool === 0 && desk.after.n === desk.after.freeTotal, `n=${desk.after.n}`);
ok('C3b 群車視角也吃得到(放空就有,不分視角)', hot.during.fromPool === hot.during.poolTotal, `pool=${hot.during.fromPool}`);
ok('C4 控制組 App 放空不混入情境池(那是通行證的內容)', appRun.during.fromPool === 0 && appRun.during.n === appRun.during.freeTotal,
  `n=${appRun.during.n}/${appRun.during.freeTotal}`);
ok('C5 網站沒有情境選擇入口(裁示:不用讓他可以選擇)', !desk.before.plBtn && !desk.before.plRow,
  `btn=${desk.before.plBtn} row=${desk.before.plRow}`);

ok('Z 頁面零例外', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close(); server.close();
const pass = results.filter(r => r.pass).length;
console.log(`\n總計 ${pass}/${results.length} 通過`);
process.exit(pass === results.length ? 0 : 1);
