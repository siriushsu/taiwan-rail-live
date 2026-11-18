// 新地景（landscape-web/）接進「地景地圖」的閘門。
//   npm run check-landscape-web
// 自己起一個 scripts/dev_server.mjs（PORT=0，從它印的那一行拿埠）：新地景的圖磚要經它同源轉手圖磚倉，要能連網。
// 其他地景閘門在自動化瀏覽器裡一律量舊地景（index.html 的 LANDSCAPE_OLD）；這支量新地景時一律帶 ?landscape=new。
// 一般使用者不帶參數時用哪一個，照 index.html 的 LANDSCAPE_DESKTOP_MQ：電腦新地景、手機舊地景（第 4 段驗）。
import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = spawn(process.execPath, [path.join(ROOT, 'scripts/dev_server.mjs')], { cwd: ROOT, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
const base = await new Promise((resolve, reject) => {
  let buf = '';
  server.stdout.on('data', d => { buf += d; const m = /dev server (http:\/\/127\.0\.0\.1:\d+)/.exec(buf); if (m) resolve(m[1] + '/'); });
  server.on('exit', code => reject(Error('dev_server 結束了：' + code)));
});
console.log('dev server', base);

let failed = 0, count = 0;
const check = (name, yes, info = '') => { count++; console.log((yes ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!yes) failed++; };
// 0. 正式站的 CSP（_headers）要放行新地景讀圖磚的網域：engine 用 fetch 讀圖磚（主執行緒與 worker 都是）⇒ connect-src。
//    本機 dev server 不送 CSP、圖磚又走同源轉手，下面的瀏覽器段量不到這一條；網域從 index.html 的 landscapeWebTiles() 取，不寫死
{
  const tiles = (/function landscapeWebTiles\(\)[\s\S]*?: '(https:\/\/[^']+)'/.exec(readFileSync(path.join(ROOT, 'index.html'), 'utf8')) || [])[1];
  const csp = (/Content-Security-Policy:[^\n]*/.exec(readFileSync(path.join(ROOT, '_headers'), 'utf8')) || [''])[0];
  const connect = (csp.split(';').map(x => x.trim()).find(x => x.startsWith('connect-src ')) || '').split(/\s+/), origin = tiles && new URL(tiles).origin;
  check('正式站 CSP 的 connect-src 放行新地景圖磚網域', !!origin && connect.includes(origin), String(origin));
}
const AT = 'at=25.0478,121.5170&z=16&t=14:00&lang=zh-TW';
const HIDDEN = ['background', 'building-3d', 'station-building-context', 'landscape-hillshade', 'water'];
const KEPT = ['track-line-0', 'live-vehicles-3d'];

async function open(browser, query, { route, ctx } = {}) {
  const p = await browser.newPage({ viewport: { width: 1200, height: 800 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei', ...ctx });
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(() => localStorage.setItem('trainmap-howto-seen', '1'));
  await p.route('**/api/**', r => r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  if (route) await route(p);
  await p.goto(base + '?' + query);
  await p.waitForFunction(() => typeof state !== 'undefined' && state.ready && typeof M !== 'undefined' && !!M?.raw, null, { timeout: 60000 });
  return { p, errors };
}
const vis = (p, ids) => p.evaluate(ids => ids.map(id => M.raw.getLayer(id) ? (M.raw.getLayoutProperty(id, 'visibility') ?? 'visible') : 'missing'), ids);
const waitRevealed = p => p.waitForFunction(() => window.railIslandLandscapeWeb?.revealed && window.railIslandLandscapeWeb.state.pending === 0, null, { timeout: 90000 });
// 地圖區塊裡跟「沒有地景」那一格不一樣的像素比例：先照原樣截圖，再把地景畫布藏起來截一次
async function landscapePixels(p) {
  const box = await p.locator('#map').boundingBox();
  const clip = { x: box.x + 40, y: box.y + 120, width: Math.min(800, box.width - 80), height: Math.min(400, box.height - 240) };
  const a = await p.screenshot({ clip });
  await p.evaluate(() => { railIslandLandscapeWeb.canvas.style.visibility = 'hidden'; M.raw.triggerRepaint(); });
  await p.waitForTimeout(400);
  const b = await p.screenshot({ clip });
  await p.evaluate(() => { railIslandLandscapeWeb.canvas.style.visibility = ''; M.raw.triggerRepaint(); });
  return p.evaluate(async ([a, b]) => {
    const load = async s => { const im = new Image(); im.src = 'data:image/png;base64,' + s; await im.decode(); const c = new OffscreenCanvas(im.width, im.height), g = c.getContext('2d'); g.drawImage(im, 0, 0); return g.getImageData(0, 0, im.width, im.height).data; };
    const A = await load(a), B = await load(b); let diff = 0;
    for (let i = 0; i < A.length; i += 4) if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 30) diff++;
    return diff / (A.length / 4);
  }, [a.toString('base64'), b.toString('base64')]);
}
process.on('exit', () => server.kill());
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch(engine === chromium ? { channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] } : { headless: true });
  try {
    // 1. 新地景：載入、圖磚到齊後藏舊底圖、地景畫布真的有畫、列車與路線照舊
    {
      // 圖磚倉的 .bin／.png／.jpg 會被 CDN 快取 4 小時：engine 要帶內容雜湊 ?v=，換版時才不會新 JSON 配到舊檔（JSON 不快取、不帶 v）
      const cacheable = [];
      const { p, errors } = await open(browser, 'map=landscape&landscape=new&g=all&' + AT, { route: p => p.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/__landscape_tiles/') && /\.(bin|png|jpg)$/.test(u.pathname)) cacheable.push(u); }) });
      await waitRevealed(p);
      const lw = await p.evaluate(() => ({ active: railIslandLandscapeWeb.active, failed: railIslandLandscapeWeb.failed, tiles: [...railIslandLandscapeWeb.api().tiles.values()].filter(t => t.state === 'ready').length }));
      check(`${name} 新地景啟用、圖磚到齊`, lw.active && !lw.failed && lw.tiles > 0, JSON.stringify(lw));
      const noV = cacheable.filter(u => !/^[0-9a-f]{16}$/.test(u.searchParams.get('v') || ''));
      check(`${name} 圖磚的 .bin／.png／.jpg 都帶內容雜湊 ?v=`, cacheable.length > 20 && noV.length === 0, `${cacheable.length} 個、沒帶 ${noV.length} 個 ${noV.slice(0, 2).map(u => u.pathname).join(' ')}`);
      const hidden = await vis(p, HIDDEN), kept = await vis(p, KEPT);
      check(`${name} 舊底圖與重複圖層藏起來`, hidden.every(v => v === 'none'), HIDDEN.map((id, i) => id + '=' + hidden[i]).join(' '));
      check(`${name} 路線與列車照舊`, kept.every(v => v === 'visible'), KEPT.map((id, i) => id + '=' + kept[i]).join(' '));
      // 傾斜會讓網站自動開 3D 建築：要再被藏回去
      await p.evaluate(() => M.raw.jumpTo({ pitch: 60, bearing: 30 })); await p.waitForTimeout(1500);
      const after = await vis(p, ['building-3d', 'station-building-context']);
      check(`${name} 傾斜後舊 3D 建築沒冒出來`, after.every(v => v === 'none'), after.join(' '));
      await waitRevealed(p);
      const ratio = await landscapePixels(p);
      check(`${name} 地圖區塊的畫面來自地景畫布`, ratio > 0.5, '差異像素 ' + (ratio * 100).toFixed(1) + '%');
      const ground = await p.evaluate(() => ({ g: railIslandIntegration.groundMode, terrain: !!M.raw.getTerrain() }));
      check(`${name} 地面一律起伏（跟新地景同一份地形）`, ground.g === 'terrain' && ground.terrain, JSON.stringify(ground));
      const attr = await p.evaluate(() => document.querySelector('.maplibregl-ctrl-attrib-inner')?.textContent || '');
      check(`${name} 署名有地景來源`, attr.includes('Overture Maps') && attr.includes('Sentinel-2') && attr.includes('臺北市建築執照套繪圖'));
      // 換底圖：地景畫布收起、舊圖層放回；再切回來重新啟用
      await p.evaluate(() => chooseBasemap('light')); await p.waitForFunction(() => M.getStyleKind() === 'light' && !railIslandLandscapeWeb.active, null, { timeout: 30000 });
      const back = await p.evaluate(() => ({ canvas: railIslandLandscapeWeb.canvas.style.display, layer: !!M.raw.getLayer('landscape-web'), bg: M.raw.getLayer('background') ? (M.raw.getLayoutProperty('background', 'visibility') ?? 'visible') : 'missing' }));
      check(`${name} 切到明亮地圖時收起新地景`, back.canvas === 'none' && !back.layer && back.bg === 'visible', JSON.stringify(back));
      await p.evaluate(() => chooseBasemap('landscape')); await p.waitForFunction(() => M.getStyleKind() === 'landscape' && railIslandLandscapeWeb.active, null, { timeout: 30000 });
      await waitRevealed(p);
      check(`${name} 切回地景再啟用`, (await vis(p, ['background']))[0] === 'none');
      check(`${name} 零 pageerror`, errors.length === 0, errors.slice(0, 3).join(' | '));
      await p.close();
    }
    // 2. 鏡頭對齊：同一個地面點在兩邊投影到同一個像素
    {
      const { p } = await open(browser, 'map=landscape&landscape=new&g=all&' + AT);
      await waitRevealed(p);
      await p.evaluate(() => M.raw.jumpTo({ pitch: 55, bearing: -25 })); await p.waitForTimeout(1200);
      const r = await p.evaluate(async () => {
        const { toTM2, fromTM2 } = await import('./landscape-web/engine/proj/tm2.mjs');
        const raw = M.raw, api = railIslandLandscapeWeb.api(), cam = api.camera, c = raw.getCenter();
        const w = raw.getCanvas().clientWidth, h = raw.getCanvas().clientHeight, [E0, N0] = toTM2(c.lng, c.lat), res = [];
        const mulv = (m, x) => [0, 1, 2, 3].map(r => m[r] * x[0] + m[4 + r] * x[1] + m[8 + r] * x[2] + m[12 + r] * x[3]);
        raw.triggerRepaint(); await new Promise(r => raw.once('render', r));
        const MM = railIslandLandscapeWeb.mainMatrix, EARTH_C = 2 * Math.PI * 6371008.8;
        for (const [de, dn] of [[0, 0], [400, 0], [-400, 300], [200, -500], [-300, -300]]) {
          const E = E0 + de, N = N0 + dn, y = api.groundAt(E, N), [lng, lat] = fromTM2(E, N);
          const a = mulv(cam.projectionMatrix.elements, mulv(cam.matrixWorldInverse.elements, [E - api.origin.e, y, -(N - api.origin.n), 1]));
          const mx = (180 + lng) / 360, my = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))) / 360, mz = y / (EARTH_C * Math.cos(lat * Math.PI / 180));
          const b = mulv(MM, [mx, my, mz, 1]);
          const px = q => [(q[0] / q[3] + 1) / 2 * w, (1 - q[1] / q[3]) / 2 * h];
          const [ax, ay] = px(a), [bx, by] = px(b);
          res.push({ de, dn, d: Math.hypot(ax - bx, ay - by), on: bx > 0 && bx < w && by > 0 && by < h });
        }
        return res;
      });
      const worst = Math.max(...r.filter(x => x.on).map(x => x.d));
      check(`${name} 鏡頭對齊（畫面內地面點兩邊差 < 2 px）`, r.filter(x => x.on).length >= 3 && worst < 2, r.map(x => `${x.de},${x.dn}:${x.d.toFixed(2)}${x.on ? '' : '(畫面外)'}`).join(' '));
      await p.close();
    }
    // 3. 載入期間：新地景圖磚還沒到齊前，舊底圖留著（不空白）
    {
      const { p } = await open(browser, 'map=landscape&landscape=new&g=all&' + AT, { route: p => p.route('**/__landscape_tiles/**', async r => { await new Promise(s => setTimeout(s, 4000)); await r.continue(); }) });
      await p.waitForFunction(() => window.railIslandLandscapeWeb?.active, null, { timeout: 60000 }); await p.waitForTimeout(1500);
      const early = await p.evaluate(() => ({ revealed: railIslandLandscapeWeb.revealed, bg: M.raw.getLayoutProperty('background', 'visibility') ?? 'visible' }));
      check(`${name} 圖磚還沒到時舊底圖留著`, !early.revealed && early.bg === 'visible', JSON.stringify(early));
      // 每片圖磚都被拖慢，整個視角補滿要很久：這裡只等「換成新地景」（圖磚到齊或等滿 25 秒），不等全部補滿
      await p.waitForFunction(() => railIslandLandscapeWeb.revealed, null, { timeout: 60000 }); await p.waitForTimeout(500);
      check(`${name} 之後換成新地景`, (await vis(p, ['background']))[0] === 'none');
      await p.close();
    }
    // 4. 退回舊地景：網址指定、engine 載入失敗
    {
      const { p } = await open(browser, 'map=landscape&landscape=old&g=all&' + AT);
      await p.waitForTimeout(3000);
      const r = await p.evaluate(() => ({ lw: !!window.railIslandLandscapeWeb?.active, bg: M.raw.getLayoutProperty('background', 'visibility') ?? 'visible', layer: !!M.raw.getLayer('landscape-web') }));
      check(`${name} ?landscape=old 用舊地景`, !r.lw && !r.layer && r.bg === 'visible', JSON.stringify(r));
      await p.close();
    }
    // 一般使用者（非自動化瀏覽器）不帶 landscape 參數：電腦（符合 index.html 的 LANDSCAPE_DESKTOP_MQ）開新地景、地景鈕不標 Beta、保底打開；
    // 手機（375×812＋觸控）開舊地景、標 Beta。navigator.webdriver 改成 false 才量得到這條（自動化瀏覽器一律舊地景）；wd 不是 false 就算紅，免得空過
    {
      const mq = /const LANDSCAPE_DESKTOP_MQ = '([^']+)';/.exec(readFileSync(path.join(ROOT, 'index.html'), 'utf8'))?.[1];
      for (const [label, ctx, wantNew] of [['電腦', {}, true], ['手機', { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true }, false]]) {
        const { p } = await open(browser, 'map=landscape&g=all&' + AT, { ctx, route: p => p.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false })) });
        if (wantNew) await p.waitForFunction(() => window.railIslandLandscapeWeb?.active, null, { timeout: 60000 }).catch(() => {});
        else await p.waitForTimeout(3000);
        const r = await p.evaluate(mq => ({ wd: navigator.webdriver, mq: !!mq && matchMedia(mq).matches, lw: !!window.railIslandLandscapeWeb?.active, layer: !!M.raw.getLayer('landscape-web'), kind: M.getStyleKind(),
          beta: !!document.querySelector('#msBasemapSeg [data-map="landscape"] .ri-beta'), auto: !!window.railIslandLandscapeWeb?.probe }), mq);
        const ok = r.wd === false && r.kind === 'landscape' && r.mq === wantNew && (wantNew ? r.lw && r.layer && !r.beta && r.auto : !r.lw && !r.layer && r.beta);
        check(`${name} ${label}一般使用者不帶參數開${wantNew ? '新地景、不標 Beta、保底打開' : '舊地景、標 Beta'}`, ok, JSON.stringify(r));
        await p.close();
      }
    }
    // 保底不降解析度：像素比 2 的電腦、門檻壓到 0.01 ms 假裝跑不動 ⇒ 只用原本的像素比量一次就退回舊地景並跳提示，中間不降像素比
    {
      const { p } = await open(browser, 'map=landscape&g=all&ls.autoMs=0.01&' + AT, { ctx: { deviceScaleFactor: 2 }, route: p => p.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false })) });
      await p.waitForFunction(() => window.railIslandLandscapeWeb?.probe?.state === 'slow', null, { timeout: 90000 }).catch(() => {});
      await p.waitForTimeout(1500);
      const r = await p.evaluate(() => ({ state: railIslandLandscapeWeb.probe?.state, log: railIslandLandscapeWeb.probe?.log, pr: railIslandLandscapeWeb.api()?.renderer.getPixelRatio(), active: railIslandLandscapeWeb.active,
        kind: M.getStyleKind(), bg: M.raw.getLayoutProperty('background', 'visibility') ?? 'visible', toast: [...document.querySelectorAll('.toast, #toast, [class*="toast"]')].some(e => /吃力/.test(e.textContent)) }));
      const ok = r.state === 'slow' && r.log?.length === 1 && r.log[0][0] === 2 && r.pr === 2 && !r.active && r.kind === 'landscape' && r.bg === 'visible' && r.toast;
      check(`${name} 保底跑不動：用原本像素比（2）量一次就退回舊地景並提示、不降像素比`, ok, JSON.stringify(r));
      await p.close();
    }
    {
      const { p } = await open(browser, 'map=landscape&landscape=new&g=all&' + AT, { route: p => p.route('**/landscape-web/engine/main.js', r => r.abort()) });
      await p.waitForFunction(() => window.railIslandLandscapeWeb?.failed, null, { timeout: 60000 }); await p.waitForTimeout(1500);
      const r = await p.evaluate(() => ({ active: railIslandLandscapeWeb.active, kind: M.getStyleKind(), bg: M.raw.getLayoutProperty('background', 'visibility') ?? 'visible', b3d: M.raw.getLayer('building-3d') ? 'ok' : 'missing' }));
      check(`${name} engine 載入失敗退回舊地景`, !r.active && r.kind === 'landscape' && r.bg === 'visible', JSON.stringify(r));
      await p.close();
    }
    // 5. 被新地景大樓擋住的網站畫面要淡化：中和站環狀線高架穿過站體、後面有大樓（遮擋開／關要看得出差）
    {
      const { p, errors } = await open(browser, 'map=landscape&landscape=new&g=all&at=25.0015,121.4955&z=17&t=14:00&lang=zh-TW');
      await waitRevealed(p);
      // 時鐘暫停：列車在兩張截圖之間移動會差上千 px，蓋過遮擋本身的差
      await p.evaluate(() => { if (state.playing) togglePlay(); M.raw.jumpTo({ center: [121.4955, 25.0015], zoom: 17.4, pitch: 62, bearing: 20 }); }); await p.waitForTimeout(1500); await waitRevealed(p);
      const box = await p.locator('#map').boundingBox(), clip = { x: box.x + 40, y: box.y + 120, width: Math.min(800, box.width - 80), height: Math.min(400, box.height - 240) };
      const on = await p.screenshot({ clip });
      const st = await p.evaluate(() => ({ occluding: railIslandLandscapeWeb.occluding, meshes: railIslandLandscapeWeb.occluderMeshes, after: M.raw.getLayersOrder().indexOf('landscape-web-occluder') - M.raw.getLayersOrder().indexOf('live-vehicles-3d') }));
      await p.evaluate(() => railIslandLandscapeWeb.setOcclusion(false)); await p.waitForTimeout(600);
      const off = await p.screenshot({ clip });
      await p.evaluate(() => railIslandLandscapeWeb.setOcclusion(true));
      const diff = await p.evaluate(async ([a, b]) => {
        const load = async s => { const im = new Image(); im.src = 'data:image/png;base64,' + s; await im.decode(); const c = new OffscreenCanvas(im.width, im.height), g = c.getContext('2d'); g.drawImage(im, 0, 0); return g.getImageData(0, 0, im.width, im.height).data; };
        const A = await load(a), B = await load(b); let n = 0; for (let i = 0; i < A.length; i += 4) if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 30) n++; return n;
      }, [on.toString('base64'), off.toString('base64')]);
      check(`${name} 遮擋圖層緊接在列車圖層後面、有畫到大樓`, st.occluding && st.meshes > 0 && st.after === 1, JSON.stringify(st));
      check(`${name} 中和站被擋住的高架有淡化（時鐘暫停，遮擋開／關差 > 1500 px）`, diff > 1500, diff + ' px');
      check(`${name} 遮擋零 pageerror`, errors.length === 0, errors.slice(0, 3).join(' | '));
      await p.close();
    }
    // 6. 網站時刻與日期接進新地景：日夜光影開時 20:30 要比 12:00 暗很多；日期跟網站日夜光影同一天
    {
      const { p } = await open(browser, 'map=landscape&landscape=new&g=all&sun=on&' + AT);
      await waitRevealed(p);
      const luma = async t => {
        await p.evaluate(t => { if (state.playing) togglePlay(); setSimSec(t * 3600); M.raw.triggerRepaint(); }, t); await p.waitForTimeout(1500);
        const box = await p.locator('#map').boundingBox(), shot = await p.screenshot({ clip: { x: box.x + 40, y: box.y + 120, width: 600, height: 300 } });
        return p.evaluate(async s => { const im = new Image(); im.src = 'data:image/png;base64,' + s; await im.decode(); const c = new OffscreenCanvas(im.width, im.height), g = c.getContext('2d'); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, im.width, im.height).data; let sum = 0; for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; return sum / (d.length / 4); }, shot.toString('base64'));
      };
      const day = await luma(12), night = await luma(20.5);
      const date = await p.evaluate(() => ({ engine: railIslandLandscapeWeb.engineDate, site: todayStr('Asia/Taipei') }));
      check(`${name} 20:30 新地景是夜景（亮度 < 12:00 的 6 成）`, night < day * 0.6, `12:00=${day.toFixed(1)} 20:30=${night.toFixed(1)}`);
      check(`${name} 新地景日期＝網站日夜光影的日期`, date.engine === date.site, JSON.stringify(date));
      await p.close();
    }
    // 7. 旋轉中心貼地形：從台北用「去哪裡」飛到阿里山，中心高程要在地面附近；右鍵轉一圈鏡頭不鑽進地形
    {
      const { p, errors } = await open(browser, 'map=landscape&landscape=new&g=all&' + AT);
      await waitRevealed(p);
      await p.evaluate(() => railIslandIntegration.guide.station({ lon: 120.80488, lat: 23.51045, name: '阿里山', id: 'gate-alishan' }));
      await p.waitForTimeout(1500); await waitRevealed(p); await p.waitForTimeout(1000);
      const pose = () => p.evaluate(() => { const m = M.raw, cam = m.transform.getCameraLngLat(), g = m.queryTerrainElevation(m.getCenter()), gc = m.queryTerrainElevation(cam); return { pivot: +(m.getCenterElevation() - g).toFixed(1), clearance: +(m.transform.getCameraAltitude() - gc).toFixed(1), bearing: +m.getBearing().toFixed(0) }; });
      const arrived = await pose();
      const box = await p.locator('#map').boundingBox(), cx = box.x + box.width / 2 + 120, cy = box.y + box.height / 2 + 80;
      const drag = async (dx, dy) => { await p.mouse.move(cx, cy); await p.mouse.down({ button: 'right' }); for (let i = 1; i <= 20; i++) { await p.mouse.move(cx + dx * i / 20, cy + dy * i / 20); await p.waitForTimeout(16); } await p.mouse.up({ button: 'right' }); await p.waitForTimeout(700); };
      await drag(0, -300); const poses = [await pose()];
      for (let k = 0; k < 4; k++) { await drag(240, 0); poses.push(await pose()); }
      check(`${name} 導覽抵達阿里山：中心高程在地面上 0～600 m`, arrived.pivot >= -1 && arrived.pivot <= 600, JSON.stringify(arrived));
      check(`${name} 壓平轉一圈：中心一直貼地、鏡頭一直在地面上`, poses.every(q => q.pivot >= -1 && q.pivot <= 600 && q.clearance > 5), JSON.stringify(poses));
      check(`${name} 旋轉零 pageerror`, errors.length === 0, errors.slice(0, 3).join(' | '));
      await p.close();
    }
    // 8. 遠處淡出：傾斜看出去，地平線底下那一帶擠成一排的遠處路線要淡掉、不畫（立體線照鏡頭深度淡出＋地形霧＋拉近遠平面，見 landscape-web/site.js），
    //    近處與俯視照舊；拿掉淡出這一條會紅。只量 MapLibre 那一層：地景畫布、站名畫布藏起來，跟三張畫布都藏起來的底色比；時鐘暫停。
    {
      // 無視窗瀏覽器幀距常超過 60 ms，網站會中途把立體列車降回平面（還跳提示），路線畫法跟著變：先標成「這個分頁已降過」，量的時候不會換
      const { p, errors } = await open(browser, 'map=landscape&landscape=new&g=all&' + AT, { route: p => p.addInitScript(() => sessionStorage.setItem('trainmap-3d-autodegraded', '1')) });
      await waitRevealed(p);
      const box = await p.locator('#map').boundingBox();
      const hide = (sel, on) => p.evaluate(([sel, on]) => { for (const e of document.querySelectorAll(sel)) e.style.visibility = on ? 'hidden' : ''; }, [sel, on]);
      // 每一列跟底色差很多的像素數（MapLibre 畫上去的東西）
      const rows = async () => {
        await hide('.landscape-web-canvas, #overlay', true); await p.evaluate(() => M.raw.triggerRepaint()); await p.waitForTimeout(600);
        const a = await p.screenshot({ clip: box });
        await hide('canvas.maplibregl-canvas', true); await p.waitForTimeout(300);
        const b = await p.screenshot({ clip: box });
        await hide('.landscape-web-canvas, #overlay, canvas.maplibregl-canvas', false);
        return p.evaluate(async ([a, b]) => {
          const load = async s => { const im = new Image(); im.src = 'data:image/png;base64,' + s; await im.decode(); const c = new OffscreenCanvas(im.width, im.height), g = c.getContext('2d'); g.drawImage(im, 0, 0); return [g.getImageData(0, 0, im.width, im.height).data, im.width, im.height]; };
          const [A, w, h] = await load(a), [B] = await load(b), out = new Array(h).fill(0);
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 60) out[y]++; }
          return out;
        }, [a.toString('base64'), b.toString('base64')]);
      };
      const sum = (r, y0, y1) => r.slice(Math.max(0, Math.round(y0)), Math.max(0, Math.round(y1))).reduce((s, v) => s + v, 0);
      const both = async () => { const on = await rows(); await p.evaluate(() => railIslandLandscapeWeb.setFade('off')); const off = await rows(); await p.evaluate(() => railIslandLandscapeWeb.setFade()); return { on, off }; };
      // 台北車站往西南看、俯角 75°（地平線在畫面裡）：遠帶＝真地平線往下 8% 畫面高（遠處的線擠成一排的地方；再往下是 1～2 km 內、本來就不淡的線），近帶＝畫面下半
      await p.evaluate(() => { if (state.playing) togglePlay(); M.raw.jumpTo({ center: [121.5163, 25.0462], zoom: 15.7, pitch: 75, bearing: 205 }); }); await p.waitForTimeout(1500); await waitRevealed(p);
      const st = await p.evaluate(() => { const tr = M.raw.transform; return { fade: railIslandLandscapeWeb.fade, fog: M.raw.getSky()?.['fog-ground-blend'], sky: M.raw.getSky()?.['sky-color'], lines: M.raw.railIslandDistanceFade?.strength, farOverride: !tr.autoCalculateNearFarZ, horizon: M.horizonTop(), h: tr.height, skirt: M.raw.terrain?.getMeshFrameDelta(tr.zoom) }; });
      check(`${name} 新地景開著遠處淡出（立體線淡出＋地形霧＋遠平面拉近，天空透明）`, !!st.fade && st.fog < 1 && st.lines === 1 && st.farOverride && st.sky === 'rgba(0,0,0,0)', JSON.stringify(st));
      // 底圖藏掉後地形貼圖是透明的：MapLibre 地形網格的裙邊會把貼在地形上的線往下拉成直條，接手期間裙邊高度要是 0
      check(`${name} 新地景接手時 MapLibre 地形裙邊高度 0`, st.skirt === 0, String(st.skirt));
      const tilt = await both(), y0 = st.horizon, y1 = st.horizon + st.h * .08;
      const farOn = sum(tilt.on, y0, y1), farOff = sum(tilt.off, y0, y1), nearOn = sum(tilt.on, st.h * .5, st.h), nearOff = sum(tilt.off, st.h * .5, st.h);
      check(`${name} 俯角 75° 地平線底下那一帶的路線淡掉（淡出開／關：< 關的 25%）`, farOff > 1500 && farOn < farOff * .25, `開 ${farOn}／關 ${farOff} px`);
      check(`${name} 近處路線照舊（淡出開／關：畫面下半 ≥ 關的 97%）`, nearOff > 1500 && nearOn >= nearOff * .97, `開 ${nearOn}／關 ${nearOff} px`);
      // 俯視拉遠看整個台北盆地：開／關要幾乎一樣，遠平面照 MapLibre 自己的
      await p.evaluate(() => M.raw.jumpTo({ center: [121.53, 25.05], zoom: 11.2, pitch: 0, bearing: 0 })); await p.waitForTimeout(1500); await waitRevealed(p);
      const top = await both(), tOn = sum(top.on, 0, top.on.length), tOff = sum(top.off, 0, top.off.length), topAuto = await p.evaluate(() => M.raw.transform.autoCalculateNearFarZ);
      check(`${name} 俯視拉遠路線照舊（淡出開／關差 < 1%、遠平面不動）`, tOff > 1500 && Math.abs(tOn - tOff) < tOff * .01 && topAuto, `開 ${tOn}／關 ${tOff} px，auto ${topAuto}`);
      // 網站日夜光影會定時 setSky：新地景接手時天空要維持透明（不蓋地景自己的天空與遠山）
      const sun = await p.evaluate(async () => { const s = window.railIslandSunlight; if (!s) return 'no-sunlight'; s.setEnabled(true); s.update(true); await new Promise(r => setTimeout(r, 400)); const v = M.raw.getSky()?.['sky-color']; s.setEnabled(false); return v; });
      check(`${name} 日夜光影開著時新地景的天空仍透明`, sun === 'rgba(0,0,0,0)', String(sun));
      // 切回舊地景：霧拿掉、遠平面還給 MapLibre（舊地景的畫面不變）
      await p.evaluate(() => M.raw.jumpTo({ pitch: 75 })); await p.waitForTimeout(300);
      await p.evaluate(() => railIslandLandscapeWeb.setActive(false)); await p.waitForTimeout(500);
      const back = await p.evaluate(() => ({ fog: M.raw.getSky()?.['fog-ground-blend'], auto: M.raw.transform.autoCalculateNearFarZ, lines: M.raw.railIslandDistanceFade ?? null, skirt: M.raw.terrain?.getMeshFrameDelta(M.raw.getZoom()) }));
      check(`${name} 切回舊地景後沒有霧、遠平面還給 MapLibre、立體線不淡`, (back.fog === undefined || back.fog === 1) && back.auto && back.lines === null, JSON.stringify(back));
      check(`${name} 切回舊地景後地形裙邊放回`, back.skirt > 0, String(back.skirt));
      check(`${name} 遠處淡出零 pageerror`, errors.length === 0, errors.slice(0, 3).join(' | '));
      await p.close();
    }
    // 9. 接手一陣子之後才換地方（放空換車、搜尋、拖過去）：新地景接手時 rail-3d 的地面問新地景（map.railIslandGround），
    //    換過去那一刻中心那點的圖磚還沒到。rail-3d 不能因此退成平坦高度——退了列車、軌道、跟車鏡頭都掉到約 0 公尺
    //    （v1117c：接手 12 秒後一換地方就永久退成平坦，潮州高架站的列車畫在站房下方）。潮州是高架站：畫面裡高架段的列車要在地面以上。
    {
      const { p, errors } = await open(browser, 'map=landscape&landscape=new&g=all&' + AT);
      await waitRevealed(p);
      await p.waitForTimeout(14000);   // 超過 rail-3d 的 DEM 等待（map3d.js DEM_WAIT_MS＝12 秒）
      await p.evaluate(() => M.raw.jumpTo({ center: [120.5361, 22.5497], zoom: 16, pitch: 50 }));
      await p.waitForTimeout(1500); await waitRevealed(p); await p.waitForTimeout(2000);
      const r = await p.evaluate(() => {
        const st = railIslandIntegration.renderer.stats, m = M.raw, c = m.getCenter().toArray(), g = m.railIslandGround;
        const bridge = st.poseSamples.filter(s => s.level?.kind === 'bridge' && Math.hypot(s.coordinate[0] - c[0], s.coordinate[1] - c[1]) < .02)
          .map(s => ({ label: s.label, h: +s.displayHeightM.toFixed(1), ground: g ? +g.at(s.coordinate[0], s.coordinate[1]).toFixed(1) : null }));
        return { demUnavailable: st.demUnavailable, lastError: st.errors.at(-1) || null, ground: !!g, bridge };
      });
      check(`${name} 接手後換到潮州：rail-3d 沒有退成平坦高度`, r.ground && !r.demUnavailable, JSON.stringify(r));
      check(`${name} 潮州畫面裡高架段的列車都在地面以上（${r.bridge.length} 列）`, r.bridge.every(x => Number.isFinite(x.ground) && x.h > x.ground), JSON.stringify(r.bridge));
      // 拉遠（z11.5）直接換到沒去過的地方：近景與第一層遠景只載鏡頭附近，畫面上大半的地面是上層遠景塊（L2、L3）。
      // 軌道每一點都要問得到地面（v1117c 只認第一層，瑞和這樣看畫面九成問不到，軌道只畫出三成，12 秒後還退成平坦高度）
      await p.evaluate(() => M.raw.jumpTo({ center: [121.165, 22.953], zoom: 11.5, pitch: 60 }));
      await p.waitForTimeout(1500); await waitRevealed(p); await p.waitForTimeout(14000);
      const z = await p.evaluate(() => { const st = railIslandIntegration.renderer.stats; return { zoom: +M.raw.getZoom().toFixed(1), demUnavailable: st.demUnavailable, railSegments: st.railSegments, farMissingSamples: st.farMissingSamples }; });
      check(`${name} 拉遠換到瑞和：軌道每一點都問得到地面、沒有退成平坦高度`, !z.demUnavailable && z.railSegments > 0 && z.farMissingSamples === 0, JSON.stringify(z));
      check(`${name} 換地方零 pageerror`, errors.length === 0, errors.slice(0, 3).join(' | '));
      await p.close();
    }
  } finally { await browser.close(); }
}
server.kill();
console.log(`${count - failed}/${count} PASS`);
process.exit(failed ? 1 : 0);
