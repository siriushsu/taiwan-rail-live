#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const adb = process.env.RAIL_ADB || '/Users/xuxiang/Library/Android/sdk/platform-tools/adb';
const endpoint = process.env.RAIL_CDP_ENDPOINT || 'http://127.0.0.1:9222';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const adbRun = async (...args) => {
  const { stdout = '', stderr = '' } = await execFile(adb, args, { maxBuffer: 16 * 1024 * 1024 });
  return String(stdout) + String(stderr);
};

const targets = await fetch(endpoint + '/json').then(response => {
  if (!response.ok) throw new Error('CDP target list failed: ' + response.status);
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
  const handlers = pending.get(message.id);
  pending.delete(message.id);
  if (message.error || message.result?.exceptionDetails) handlers.reject(new Error(JSON.stringify(message)));
  else handlers.resolve(message.result);
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

const scanExpression = [
  '(() => {',
  "  const defs = [{ key: 'alert', selector: '#alertChip' }].concat(",
  "    [...document.querySelectorAll('#topTabs .gtab')].map(button => ({ key: button.innerText.trim(), element: button })));",
  "  const owner = element => element?.closest?.('[data-stage3-topbar-key]')?.dataset.stage3TopbarKey || null;",
  '  const round = value => +value.toFixed(2);',
  '  const rows = defs.map(def => {',
  '    const element = def.element || document.querySelector(def.selector);',
  '    if (!element) return { key: def.key, missing: true };',
  '    element.dataset.stage3TopbarKey = def.key;',
  '    const rect = element.getBoundingClientRect();',
  '    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;',
  '    const points = [',
  "      ['center', cx, cy], ['left', cx - 21, cy], ['right', cx + 21, cy],",
  "      ['top', cx, cy - 21], ['bottom', cx, cy + 21],",
  '    ].map(([name, x, y]) => ({ name, x: round(x), y: round(y), owner: owner(document.elementFromPoint(x, y)) }));',
  '    const owns = (x, y) => owner(document.elementFromPoint(x, y)) === def.key;',
  '    let hitLeft = Math.floor(cx), hitRight = Math.ceil(cx), hitTop = Math.floor(cy), hitBottom = Math.ceil(cy);',
  '    while (hitLeft > 0 && owns(hitLeft - 1, cy)) hitLeft--;',
  '    while (hitRight < innerWidth && owns(hitRight + 1, cy)) hitRight++;',
  '    while (hitTop > 0 && owns(cx, hitTop - 1)) hitTop--;',
  '    while (hitBottom < innerHeight && owns(cx, hitBottom + 1)) hitBottom++;',
  "    const after = getComputedStyle(element, '::after');",
  '    return {',
  '      key: def.key, text: element.innerText.trim(),',
  '      rect: { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) },',
  '      center: { x: round(cx), y: round(cy) }, points,',
  '      effectiveHit: { left: hitLeft, right: hitRight, top: hitTop, bottom: hitBottom,',
  '        width: hitRight - hitLeft + 1, height: hitBottom - hitTop + 1 },',
  '      pseudoAfter: { content: after.content, width: after.width, height: after.height, pointerEvents: after.pointerEvents },',
  '    };',
  '  });',
  '  const present = rows.filter(row => !row.missing).sort((a, b) => a.center.x - b.center.x);',
  '  const midpoints = [];',
  '  for (let i = 0; i < present.length - 1; i++) {',
  '    const left = present[i], right = present[i + 1];',
  '    const x = (left.center.x + right.center.x) / 2, y = (left.center.y + right.center.y) / 2;',
  '    midpoints.push({ left: left.key, right: right.key, x: round(x), y: round(y), owner: owner(document.elementFromPoint(x, y)),',
  '      leftHitRight: left.effectiveHit.right, rightHitLeft: right.effectiveHit.left });',
  '  }',
  '  return { viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, rows, midpoints };',
  '})()',
].join('\n');
const scan = () => evaluate(scanExpression);

const installEventLog = () => evaluate([
  '(() => {',
  '  window.__stage3TopbarTouchLog = [];',
  "  const owner = element => element?.closest?.('[data-stage3-topbar-key]')?.dataset.stage3TopbarKey || null;",
  "  for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, event => {",
  "    window.__stage3TopbarTouchLog.push({ type, owner: owner(event.target), target: event.target.id || event.target.innerText || event.target.tagName });",
  '  }, { capture: true, once: true });',
  '  return true;',
  '})()',
].join('\n'));

const original = await evaluate("({ group: state.group, detailHidden: document.getElementById('alertDetail').hidden })");
const initial = await scan();
const actions = [];
const actionDefs = [
  { key: 'alert', type: 'alert' },
  { key: '全', type: 'group', expected: 'all', seed: 'metro' },
  { key: '台', type: 'group', expected: 'tra', seed: 'all' },
  { key: '高', type: 'group', expected: 'hsr', seed: 'tra' },
  { key: '捷', type: 'group', expected: 'metro', seed: 'hsr' },
];

for (const action of actionDefs) {
  if (action.type === 'alert') {
    await evaluate("document.getElementById('alertDetail').hidden = true");
  } else {
    await evaluate("(() => { const group = GROUPS.find(item => item.id === " + JSON.stringify(action.seed)
      + "); selectGroup(group, true); return state.group; })()");
    await wait(450);
  }
  const current = await scan();
  const row = current.rows.find(item => item.key === action.key);
  if (!row) {
    actions.push({ ...action, pass: false, error: 'control missing before tap' });
    continue;
  }
  await installEventLog();
  // Tap 21 CSS px above center: outside the 36 px visual box, inside the new 44 px hit area.
  const cssTap = { x: row.center.x, y: row.center.y - 21 };
  const deviceTap = {
    x: Math.round(cssTap.x * current.viewport.dpr),
    y: Math.round((targetDescription.screenY || 0) + cssTap.y * current.viewport.dpr),
  };
  await adbRun('shell', 'input', 'tap', String(deviceTap.x), String(deviceTap.y));
  await wait(900);
  const after = await evaluate([
    '({',
    '  group: state.group,',
    "  detailOpen: !document.getElementById('alertDetail').hidden,",
    "  activeTopTab: document.querySelector('#topTabs .gtab.active')?.innerText.trim() || null,",
    '  events: window.__stage3TopbarTouchLog || [],',
    '})',
  ].join('\n'));
  const click = after.events.find(event => event.type === 'click');
  const statePass = action.type === 'alert' ? after.detailOpen : after.group === action.expected;
  actions.push({
    ...action, cssTap, deviceTap,
    visualTop: row.rect.y,
    tapOutsideVisual: cssTap.y < row.rect.y,
    elementFromPointOwner: row.points.find(point => point.name === 'top')?.owner || null,
    after,
    pass: cssTap.y < row.rect.y && row.points.find(point => point.name === 'top')?.owner === action.key
      && click?.owner === action.key && statePass,
  });
}

await evaluate("(() => { document.getElementById('alertDetail').hidden = "
  + JSON.stringify(original.detailHidden)
  + "; const group = GROUPS.find(item => item.id === " + JSON.stringify(original.group)
  + "); selectGroup(group, true); return true; })()");

const pointFailures = initial.rows.flatMap(row => row.missing
  ? [{ key: row.key, point: 'missing', owner: null }]
  : row.points.filter(point => point.owner !== row.key).map(point => ({ key: row.key, point: point.name, owner: point.owner })));
const sizeFailures = initial.rows.filter(row => row.missing
  || row.effectiveHit.width < 44 || row.effectiveHit.height < 44).map(row => row.key);
const midpointViolations = initial.midpoints.filter(midpoint =>
  midpoint.owner === midpoint.left || midpoint.owner === midpoint.right
  || midpoint.leftHitRight >= midpoint.x || midpoint.rightHitLeft <= midpoint.x);
const actionFailures = actions.filter(action => !action.pass).map(action => action.key);
const result = {
  generatedAt: new Date().toISOString(),
  targetDescription,
  initial,
  actions,
  summary: { pointFailures, sizeFailures, midpointViolations, actionFailures },
};
await writeFile(new URL('../shots/topbar-44px-audit.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
socket.close();

console.log(JSON.stringify(result.summary));
if (pointFailures.length || sizeFailures.length || midpointViolations.length || actionFailures.length) process.exitCode = 1;
