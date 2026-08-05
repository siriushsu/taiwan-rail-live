#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const adb = process.env.RAIL_ADB || '/Users/xuxiang/Library/Android/sdk/platform-tools/adb';
const endpoint = process.env.RAIL_CDP_ENDPOINT || 'http://127.0.0.1:9222';
const desiredWidth = Number(process.argv[2]);
const density = Number(process.argv[3]);
if (!desiredWidth || !density) {
  console.error('Usage: stage2-width-audit.mjs <css-width> <density-dpi>');
  process.exit(2);
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const adbRun = async (...args) => {
  const { stdout = '', stderr = '' } = await execFile(adb, args, { maxBuffer: 16 * 1024 * 1024 });
  return `${stdout}${stderr}`;
};

await adbRun('shell', 'wm', 'density', String(density));
await wait(2500);
await adbRun('shell', 'am', 'force-stop', 'tw.railisland.app');
await adbRun('shell', 'am', 'start', '-W', '-n', 'tw.railisland.app/.MainActivity');
await wait(5000);
const appPid = (await adbRun('shell', 'pidof', 'tw.railisland.app')).trim();
if (!appPid) throw new Error('App PID not found after start');
await adbRun('forward', 'tcp:9222', `localabstract:webview_devtools_remote_${appPid}`);
await wait(500);

const targets = await fetch(`${endpoint}/json`).then(response => {
  if (!response.ok) throw new Error(`CDP target list failed: ${response.status}`);
  return response.json();
});
const target = targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl);
if (!target) throw new Error('No debuggable WebView page target found');
const targetDescription = JSON.parse(target.description || '{}');

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
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return result.result?.value;
};
const scanExpression = `(() => {
  const selector = 'button,a[href],input:not([type=hidden]),select,textarea,[role="button"],[onclick]';
  const visible = e => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    if (e.disabled || r.width < 1 || r.height < 1 || s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none' || +s.opacity === 0) return false;
    return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
  };
  const all = [...document.querySelectorAll(selector)].filter(visible);
  all.forEach((e, i) => e.dataset.stage2AuditKey = 'c' + i);
  const owner = e => {
    const o = e && e.closest && e.closest('[data-stage2-audit-key]');
    return o ? o.dataset.stage2AuditKey : null;
  };
  const round = n => +n.toFixed(2);
  const label = e => (e.id ? '#' + e.id : (e.dataset.proxy ? '[proxy=' + e.dataset.proxy + ']' : e.tagName.toLowerCase() + ':' + (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 42)));
  const controls = all.map(e => {
    const r = e.getBoundingClientRect();
    const points = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + Math.min(6, r.width / 3), r.top + r.height / 2],
      [r.right - Math.min(6, r.width / 3), r.top + r.height / 2],
      [r.left + r.width / 2, r.top + Math.min(6, r.height / 3)],
      [r.left + r.width / 2, r.bottom - Math.min(6, r.height / 3)],
    ].map(([x, y]) => ({ x: round(x), y: round(y), owner: owner(document.elementFromPoint(x, y)) }));
    const pseudo = ['::before', '::after'].map(which => {
      const p = getComputedStyle(e, which);
      return { which, content: p.content, pointerEvents: p.pointerEvents, width: p.width, height: p.height };
    }).filter(p => p.content && p.content !== 'none' && p.content !== 'normal');
    return {
      key: e.dataset.stage2AuditKey,
      label: label(e),
      tag: e.tagName,
      text: (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
      rect: { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) },
      points,
      centerHit: points[0].owner,
      pseudo,
    };
  });
  const overlaps = [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    if (all[i].contains(all[j]) || all[j].contains(all[i])) continue;
    const a = all[i].getBoundingClientRect(), b = all[j].getBoundingClientRect();
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (w > .5 && h > .5) overlaps.push({ a: all[i].dataset.stage2AuditKey, b: all[j].dataset.stage2AuditKey, width: round(w), height: round(h) });
  }
  const ys = [];
  for (const e of all) {
    const r = e.getBoundingClientRect(), y = r.top + r.height / 2;
    if (!ys.some(v => Math.abs(v - y) < 2)) ys.push(y);
  }
  const rowSweeps = ys.sort((a, b) => a - b).map(y => {
    const samples = [];
    for (let x = 1; x < innerWidth; x += 2) samples.push({ x, owner: owner(document.elementFromPoint(x, y)) });
    const segments = [];
    for (const sample of samples) {
      const last = segments[segments.length - 1];
      if (!last || last.owner !== sample.owner) segments.push({ from: sample.x, to: sample.x, owner: sample.owner });
      else last.to = sample.x;
    }
    return { y: round(y), segments };
  });
  return {
    viewport: { innerWidth, innerHeight, dpr: devicePixelRatio, visualScale: visualViewport.scale },
    bodyClasses: document.body.className,
    controls,
    overlaps,
    rowSweeps,
  };
})()`;

const snapshotExpression = `(() => ({
  url: location.href,
  sysId: typeof state === 'undefined' ? null : state.sysId,
  group: typeof state === 'undefined' ? null : state.group,
  follow: typeof state === 'undefined' || !state.followTrain ? null : String(state.followTrain.train || ''),
  body: document.body.className,
  visiblePanels: [...document.querySelectorAll('[id$="Panel"],[id$="Card"],#moreBody')].filter(e => {
    const r=e.getBoundingClientRect(),s=getComputedStyle(e);return !e.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight;
  }).map(e => e.id).sort(),
}))()`;

const scan = await evaluate(scanExpression);
const touches = [];
for (const original of scan.controls) {
  // Header chips can be re-rendered by the live-data tick while the audit is running.
  // Re-scan before every physical tap so the current nodes regain their audit keys.
  const current = await evaluate(scanExpression);
  const control = current.controls.find(item => item.key === original.key);
  if (!control) {
    touches.push({ key: original.key, label: original.label, pass: false, error: 'control missing before tap' });
    continue;
  }
  const before = await evaluate(snapshotExpression);
  await evaluate(`(() => {
    window.__stage2TapLog = [];
    const owner = e => { const o=e&&e.closest&&e.closest('[data-stage2-audit-key]'); return o?o.dataset.stage2AuditKey:null; };
    for (const type of ['pointerdown','pointerup']) document.addEventListener(type, e => window.__stage2TapLog.push({type,target:e.target.id||e.target.tagName,owner:owner(e.target)}), {capture:true, once:true});
    document.addEventListener('click', e => {
      window.__stage2TapLog.push({type:'click',target:e.target.id||e.target.tagName,owner:owner(e.target)});
      e.preventDefault();
      e.stopImmediatePropagation();
    }, {capture:true, once:true});
    return true;
  })()`);
  const xCss = control.rect.x + control.rect.width / 2;
  const yCss = control.rect.y + control.rect.height / 2;
  const xDevice = Math.round(xCss * scan.viewport.dpr);
  const yDevice = Math.round((targetDescription.screenY || 0) + yCss * scan.viewport.dpr);
  await adbRun('shell', 'input', 'tap', String(xDevice), String(yDevice));
  await wait(800);
  const activityDump = await adbRun('shell', 'dumpsys', 'activity', 'activities');
  const topLine = activityDump.split(/\r?\n/).find(line => line.includes('topResumedActivity='))?.trim() || '';
  let events = [], after = null;
  try { events = await evaluate('window.__stage2TapLog || []'); } catch {}
  try { after = await evaluate(snapshotExpression); } catch {}
  const down = events.find(event => event.type === 'pointerdown');
  const click = events.find(event => event.type === 'click');
  touches.push({
    key: original.key,
    label: original.label,
    cssCenter: [Number(xCss.toFixed(2)), Number(yCss.toFixed(2))],
    deviceTap: [xDevice, yDevice],
    elementFromPoint: control.centerHit,
    events,
    topActivity: topLine,
    stateChanged: JSON.stringify(before) !== JSON.stringify(after),
    before,
    after,
    pass: control.centerHit === original.key && down?.owner === original.key && click?.owner === original.key,
  });
}

const result = {
  requestedWidth: desiredWidth,
  densityDpi: density,
  appPid,
  targetDescription,
  scan,
  touches,
  summary: {
    actualWidth: scan.viewport.innerWidth,
    controlCount: scan.controls.length,
    overlapCount: scan.overlaps.length,
    centerHitFailures: scan.controls.filter(item => item.centerHit !== item.key).map(item => item.key),
    touchFailures: touches.filter(item => !item.pass).map(item => item.key),
    pseudoControlCount: scan.controls.filter(item => item.pseudo.length).length,
  },
};
const output = new URL(`../shots/ui-audit-${desiredWidth}.json`, import.meta.url);
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
socket.close();

console.log(JSON.stringify(result.summary));
