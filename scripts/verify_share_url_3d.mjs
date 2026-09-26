import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = {
  '.css': 'text/css',
  '.geojson': 'application/json',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://rail-island.local');
  if (url.pathname.startsWith('/api/')) return res.writeHead(503).end('{}');
  let file = path.resolve(root, `.${decodeURI(url.pathname)}`);
  if (!file.startsWith(`${root}${path.sep}`) && file !== root) return res.writeHead(404).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('content-type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
// route 在固定的 await 切點注入競態，單跑一輪就是決定性的；ship-web 另明確傳 10 壓測。
const rounds = Math.max(1, Number.parseInt(process.env.ROUNDS || '1', 10) || 1);
const scenarios = [
  {
    id: 'settings', label: '關閉立體列車／三節／起伏地形／原比例',
    params: { scene: '2d', formation: 'three', ground: 'terrain', trainSize: 'scale', tracks: 'legacy' },
  },
  {
    id: 'zoom', label: '立體視角 z=19',
    // index.html 的 deepZ 會限制到 18；實得 19 才能證明 rail-3d 自己的原始 z 有被消費。
    params: { scene: '3d', z: '19', tracks: 'legacy' },
  },
  {
    id: 'visit', label: '立體地標導覽',
    params: { scene: '3d', visit: 'taipei101', tracks: 'legacy' },
  },
  {
    id: 'tracks-default', label: '預設實體股道正向對照', once: true,
    params: { scene: '2d' },
  },
];
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass ? '' : ` ${JSON.stringify(detail ?? '')}`}`);
}

try {
  for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch(engineName === 'chromium'
      ? { channel: 'chromium', headless: true }
      : { headless: true });
    try {
      for (const scenario of scenarios) for (let round = 1; round <= (scenario.once ? 1 : rounds); round++) {
        const context = await browser.newContext({
          viewport: { width: 414, height: 900 }, locale: 'zh-TW', isMobile: true, hasTouch: true,
        });
        await context.addInitScript(() => {
          localStorage.setItem('trainmap-howto-seen', '1');
          // 跟網址參數刻意相反，避免網址遺失時碰巧沿用偏好而假綠。
          localStorage.setItem('ri-trains-enabled', '1');
          localStorage.setItem('ri-formation-mode', 'actual');
          localStorage.setItem('ri-ground-mode', 'flat');
          localStorage.setItem('ri-landscape-ground', 'flat');
          localStorage.setItem('ri-train-size-v21', 'readable');
        });
        const page = await context.newPage();
        await page.clock.setFixedTime(new Date('2026-09-26T12:00:00+08:00'));
        const errors = [];
        let forcedClear = 0;
        let physicalClientRequests = 0;
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => {
          if (request.url().includes('/rail-3d/physical/client.js')) physicalClientRequests++;
        });
        // 舊碼先 await 這支 import，回來後才讀 location.search；在這個切點清掉 query，
        // 穩定重現 boot() 的 loadAllGroup→clearFollow race，不靠引擎剛好跑得快或慢。
        await page.route('**/rail-3d/integration/follow-camera-lock.js', async route => {
          forcedClear++;
          await page.evaluate(() => history.replaceState(null, '', location.pathname));
          await route.continue();
        });
        const query = new URLSearchParams({ ...scenario.params, lang: 'zh-TW' });
        await page.goto(`${base}?${query}`, { waitUntil: 'domcontentloaded' });
        if (scenario.id === 'settings' || scenario.id === 'tracks-default') {
          await page.waitForFunction(() => typeof state !== 'undefined'
            && state.ready && window.railIslandIntegration?.renderer?.stats,
            null, { timeout: 120000 });
        } else if (scenario.id === 'zoom') {
          await page.waitForFunction(() => typeof state !== 'undefined'
            && state.ready && window.railIslandIntegration?.renderer?.stats
            && state.map3d && M.getPitch() > 50 && Math.abs(M.getZoom() - 19) < 0.05,
          null, { timeout: 120000 });
        } else {
          await page.waitForFunction(() => typeof state !== 'undefined'
            && state.ready && window.railIslandIntegration?.guide?.current?.key === 'taipei101'
            && window.railIslandIntegration.guide.current.status === 'ready',
          null, { timeout: 120000 });
        }
        const actual = await page.evaluate(id => {
          const snapshot = typeof RAIL_3D_BOOT_PARAMS === 'undefined'
            ? null
            : Object.fromEntries(RAIL_3D_BOOT_PARAMS.entries());
          const shared = railIslandIntegration.shareParams(new URL('https://railisland.tw/'));
          const common = {
            search: location.search,
            snapshot,
            scene: shared.searchParams.get('scene'),
            enabled: railIslandIntegration.capture().display.enabled,
            pitch: M.getPitch(), zoom: M.getZoom(), map3d: state.map3d,
          };
          if (id === 'settings') return {
            ...common,
            formation: railIslandIntegration.formationMode,
            sharedFormation: shared.searchParams.get('formation'),
            ground: railIslandIntegration.groundMode,
            sharedGround: shared.searchParams.get('ground'),
            rendererFormation: railIslandIntegration.renderer.stats.formationMode,
            rendererGround: railIslandIntegration.renderer.stats.groundMode,
            rendererTrainSize: railIslandIntegration.renderer.stats.trainSizeMode,
          };
          if (id === 'visit') return {
            ...common,
            visit: railIslandIntegration.guide.current,
            center: M.raw.getCenter().toArray(),
          };
          return common;
        }, scenario.id);
        const expected = scenario.params;
        const snapshot = actual.snapshot && Object.fromEntries(
          Object.keys(expected).map(key => [key, actual.snapshot[key] ?? null]),
        );
        let behavior = false;
        if (scenario.id === 'settings') behavior = !actual.enabled
          && actual.scene === '2d'
          && actual.formation === 'three'
          && actual.sharedFormation === 'three'
          && actual.rendererFormation === 'three'
          && actual.ground === 'terrain'
          && actual.sharedGround === 'terrain'
          && actual.rendererGround === 'terrain'
          && actual.rendererTrainSize === 'scale';
        else if (scenario.id === 'zoom') behavior = actual.enabled
          && actual.scene === null
          && actual.map3d
          && actual.pitch > 50
          && Math.abs(actual.zoom - 19) < 0.05;
        else if (scenario.id === 'visit') behavior = actual.enabled
          && actual.scene === null
          && actual.visit?.key === 'taipei101'
          && actual.visit?.status === 'ready'
          && Math.hypot(actual.visit.view.center[0] - 121.56455513294843,
            actual.visit.view.center[1] - 25.033946307135494) < 1e-6
          && Math.hypot(actual.center[0] - 121.56455513294843,
            actual.center[1] - 25.033946307135494) < 1e-6;
        else behavior = !actual.enabled && actual.scene === '2d';
        const physicalOk = scenario.id === 'tracks-default'
          ? physicalClientRequests > 0
          : physicalClientRequests === 0;
        const pass = forcedClear === 1
          && actual.search === ''
          && JSON.stringify(snapshot) === JSON.stringify(expected)
          && behavior
          && physicalOk
          && errors.length === 0;
        const runTotal = scenario.once ? 1 : rounds;
        check(`${engineName} ${scenario.label} 第 ${round}/${runTotal} 輪`, pass,
          { forcedClear, physicalClientRequests, errors, ...actual });
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log(`3D 分享參數驗收：${results.filter(result => result.pass).length}/${results.length} 通過`
  + `（${Object.keys({ chromium, webkit }).length} 引擎 ×（3 契約情境 × ${rounds} 輪＋1 正向對照））`);
if (results.some(result => !result.pass)) process.exitCode = 1;
