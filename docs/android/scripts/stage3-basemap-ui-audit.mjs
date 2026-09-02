#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';

const endpoint = process.env.RAIL_CDP_ENDPOINT || 'http://127.0.0.1:9222';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const targets = await fetch(`${endpoint}/json`).then(response => {
  if (!response.ok) throw new Error(`CDP target list failed: ${response.status}`);
  return response.json();
});
const target = targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl);
if (!target) throw new Error('No debuggable WebView page target found');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message)));
  else resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  return result.result?.value;
};

const original = await evaluate(`({ basemap: state.basemap, mapDark: state.mapDark })`);
const modes = [
  { name: 'light', basemap: 'map', mapDark: false, expectedHost: 'tiles.stadiamaps.com' },
  { name: 'dark', basemap: 'map', mapDark: true, expectedHost: 'tiles.stadiamaps.com' },
  { name: 'sat', basemap: 'sat', mapDark: true, expectedHost: 'ibasemaps-api.arcgis.com' },
];

const results = [];
for (const mode of modes) {
  await evaluate(`(() => {
    document.body.classList.remove('tools-open');
    state.basemap = ${JSON.stringify(mode.basemap)};
    state.mapDark = ${JSON.stringify(mode.mapDark)};
    setBasemap();
    return true;
  })()`);
  await wait(mode.name === 'sat' ? 5000 : 3500);

  const scan = await evaluate(`(() => {
    const selector = 'button,a[href],input:not([type=hidden]),select,textarea,[role="button"],[onclick]';
    const round = value => +value.toFixed(2);
    const visible = element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (element.disabled || rect.width < 1 || rect.height < 1) return false;
      if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none' || +style.opacity === 0) return false;
      return rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    };
    // Attribution links are intentionally compact legal credits rather than product controls;
    // the mobile CSS also clips the attribution strip by design. Audit the text/host separately.
    const controls = [...document.querySelectorAll(selector)]
      .filter(element => !element.closest('.leaflet-control-attribution'))
      .filter(visible);
    controls.forEach((element, index) => { element.dataset.stage3MapAuditKey = 'c' + index; });
    const owner = element => element?.closest?.('[data-stage3-map-audit-key]')?.dataset.stage3MapAuditKey || null;
    const label = element => element.id
      ? '#' + element.id
      : (element.innerText || element.value || element.getAttribute('aria-label') || element.tagName)
        .trim().replace(/\\s+/g, ' ').slice(0, 60);
    const controlRows = controls.map(element => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const key = element.dataset.stage3MapAuditKey;
      const owns = (sampleX, sampleY) => owner(document.elementFromPoint(sampleX, sampleY)) === key;
      let hitLeft = Math.floor(x), hitRight = Math.ceil(x), hitTop = Math.floor(y), hitBottom = Math.ceil(y);
      while (hitLeft > 0 && owns(hitLeft - 1, y)) hitLeft--;
      while (hitRight < innerWidth && owns(hitRight + 1, y)) hitRight++;
      while (hitTop > 0 && owns(x, hitTop - 1)) hitTop--;
      while (hitBottom < innerHeight && owns(x, hitBottom + 1)) hitBottom++;
      const effectiveHit = {
        // Integer sampling includes both boundary samples.
        width: round(hitRight - hitLeft + 1),
        height: round(hitBottom - hitTop + 1),
      };
      return {
        key,
        label: label(element),
        rect: { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) },
        centerHit: owner(document.elementFromPoint(x, y)),
        effectiveHit,
        clipped: rect.left < -0.5 || rect.top < -0.5 || rect.right > innerWidth + 0.5 || rect.bottom > innerHeight + 0.5,
        below44: rect.width < 44 || rect.height < 44,
        effectiveBelow44: effectiveHit.width < 44 || effectiveHit.height < 44,
      };
    });
    const overlaps = [];
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
      const a = controls[i].getBoundingClientRect();
      const b = controls[j].getBoundingClientRect();
      const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (width > 0.5 && height > 0.5) overlaps.push({
        a: controls[i].dataset.stage3MapAuditKey,
        b: controls[j].dataset.stage3MapAuditKey,
        width: round(width),
        height: round(height),
      });
    }
    const tilesByHost = {};
    for (const tile of document.querySelectorAll('.leaflet-tile-pane img')) {
      let host = 'invalid';
      try { host = new URL(tile.currentSrc || tile.src).hostname; } catch {}
      const row = tilesByHost[host] ||= { total: 0, loaded: 0 };
      row.total++;
      if (tile.complete && tile.naturalWidth > 0) row.loaded++;
    }
    return {
      mode: state.basemap === 'sat' ? 'sat' : (state.mapDark ? 'dark' : 'light'),
      viewport: { width: round(innerWidth), height: round(innerHeight), dpr: devicePixelRatio },
      attribution: document.querySelector('.leaflet-control-attribution')?.innerText.replace(/\\s+/g, ' ').trim() || '',
      tilesByHost,
      controls: controlRows,
      overlaps,
    };
  })()`);
  const host = scan.tilesByHost[mode.expectedHost] || { total: 0, loaded: 0 };
  results.push({
    ...scan,
    expectedHost: mode.expectedHost,
    summary: {
      modeMatches: scan.mode === mode.name,
      tileTotal: host.total,
      tileLoaded: host.loaded,
      tilesPass: host.total > 0 && host.total === host.loaded,
      controlCount: scan.controls.length,
      overlapCount: scan.overlaps.length,
      centerHitFailures: scan.controls.filter(control => control.centerHit !== control.key).map(control => control.label),
      clippedControls: scan.controls.filter(control => control.clipped).map(control => control.label),
      below44Controls: scan.controls.filter(control => control.below44).map(control => control.label),
      effectiveBelow44Controls: scan.controls.filter(control => control.effectiveBelow44).map(control => control.label),
    },
  });
}

await evaluate(`(() => {
  state.basemap = ${JSON.stringify(original.basemap)};
  state.mapDark = ${JSON.stringify(original.mapDark)};
  setBasemap();
  return true;
})()`);

const output = new URL('../shots/basemap-ui-audit.json', import.meta.url);
await writeFile(output, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2) + '\n');
socket.close();

const summaries = results.map(result => ({ mode: result.mode, ...result.summary }));
console.log(JSON.stringify(summaries));
if (summaries.some(summary => !summary.modeMatches || !summary.tilesPass
  || summary.overlapCount || summary.centerHitFailures.length || summary.clippedControls.length
  || summary.effectiveBelow44Controls.length)) process.exitCode = 1;
