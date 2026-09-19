import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);
const freePort = () => new Promise(resolve => {
  const server = createServer();
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});
const port = await freePort();
const base = `http://127.0.0.1:${port}/`;
const server = spawn(process.execPath, [path.join(ROOT, 'scripts/dev_server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'ignore', 'inherit'],
});
process.on('exit', () => server.kill());
for (let i = 0; ; i++) {
  try { if ((await fetch(base + 'index.html')).ok) break; } catch {}
  if (i > 100) throw new Error(`dev server 起不來：${base}`);
  await new Promise(resolve => setTimeout(resolve, 100));
}

const official = { 1: [121.6178771, 25.0552565], '-1': [121.6179004, 25.055378] };
const failures = [];
for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-TW' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(() => localStorage.setItem('trainmap-howto-seen', '1'));
  try {
    await page.goto(base + '?g=all&scene=3d&t=08:00&at=25.0553,121.6179&z=19&lang=zh-TW');
    await page.waitForFunction(() => state.ready && window.railIslandPhysical?.metro && window.railIslandIntegration?.renderer?.stats.models > 0, null, { timeout: 90000 });
    for (const direction of [1, -1]) {
      await page.evaluate(({ direction, official }) => {
        state.playing = false;
        clearFollow();
        clearFreqFollow();
        railIslandIntegration.render = () => {};
        railIslandIntegration.setFormationMode('actual');
        const ln = state.decoLines.find(line => line._sys === 'mrt' && line.id === 'BR');
        const selected = railIslandPhysical.metro.routeFor(ln, direction);
        const position = railIslandPhysical.metro.sample(ln, { progress: selected.record.endIndex }, direction);
        const routeOffset = direction === 1 ? selected.route.offsets.at(-1) : selected.route.offsets[0];
        const endpoint = selected.route.path.at(Math.max(0, Math.min(selected.route.path.length, routeOffset))).coordinate;
        const distance = (a, b) => {
          const mx = 111320 * Math.cos(a[1] * Math.PI / 180);
          return Math.hypot((a[0] - b[0]) * mx, (a[1] - b[1]) * 111320);
        };
        const id = `nangang-br-${direction}`;
        const vehicle = { id, longitude: position.lon, latitude: position.lat, route: position.route, chainageM: position.chainageM, routeId: 'BR', systemId: 'mrt', color: ln.color, railDirection: position.railDirection, followed: true };
        const frame = railIslandIntegration.capture();
        M.raw.jumpTo({ center: [position.lon, position.lat], zoom: 19, pitch: 55, bearing: 0 });
        window.__nangangFixture = { id, frame, vehicle, endpointErrorM: distance(endpoint, official), centreToOfficialM: distance([position.lon, position.lat], official), centre: [position.lon, position.lat] };
        window.__nangangUpdate = () => {
          railIslandIntegration.renderer.update({ ...frame, vehicles: [vehicle], routes: [position.route], clearanceRoutes: [], selectedVehicleId: id, display: { ...frame.display, enabled: true, modelMode: 'all' } });
          return railIslandIntegration.renderer.hasModel(id);
        };
        __nangangUpdate();
      }, { direction, official: official[direction] });
      await page.waitForFunction(() => __nangangUpdate(), null, { timeout: 30000 });
      const result = await page.evaluate(() => {
        const { id, endpointErrorM, centreToOfficialM, centre } = __nangangFixture;
        const pose = railIslandIntegration.renderer.stats.poseSamples.find(sample => sample.id === id);
        return {
          build: BUILD,
          endpointErrorM,
          centreToOfficialM,
          centre,
          cars: pose?.cars?.map(car => car.coordinate) || [],
          visible: railIslandIntegration.renderer.hasModel(id),
          errors: [...railIslandIntegration.errors],
        };
      });
      const minCarLon = Math.min(...result.cars.map(coordinate => coordinate[0]));
      const pass = result.build === 'v0920a' && result.endpointErrorM < 0.5 && result.centreToOfficialM < 40
        && result.visible && result.cars.length === 4 && minCarLon > 121.61725 && !result.errors.length;
      console.log(JSON.stringify({ engine: engineName, direction, pass, minCarLon, ...result }));
      if (!pass) failures.push(`${engineName} direction ${direction}`);
      await page.screenshot({ path: `/tmp/nangang-stop-${engineName}-${direction}.png` });
    }
    if (errors.length) failures.push(`${engineName} pageerror: ${errors.join('／')}`);
  } finally {
    await browser.close();
  }
}
server.kill();
if (failures.length) {
  console.error('南港展覽館真實瀏覽器驗收失敗：' + failures.join('；'));
  process.exit(1);
}
console.log('南港展覽館真實瀏覽器驗收通過：Chromium／WebKit 手機畫面兩方向均停在直線月台');
