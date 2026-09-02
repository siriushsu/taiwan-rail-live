#!/usr/bin/env node

const endpoint = process.env.RAIL_CDP_ENDPOINT || 'http://127.0.0.1:9222';
const [centerX = '206', centerY = '420', startRadius = '24', endRadius = '105'] = process.argv.slice(2);
const cx = Number(centerX), cy = Number(centerY), r0 = Number(startRadius), r1 = Number(endRadius);

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
  if (message.error) reject(new Error(JSON.stringify(message.error)));
  else resolve(message.result);
});
const send = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const points = radius => [
  { x: cx - radius, y: cy, radiusX: 6, radiusY: 6, force: 1, id: 0 },
  { x: cx + radius, y: cy, radiusX: 6, radiusY: 6, force: 1, id: 1 },
];

await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(r0) });
for (let step = 1; step <= 12; step++) {
  const radius = r0 + (r1 - r0) * step / 12;
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(radius) });
  await wait(35);
}
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
socket.close();

console.log(JSON.stringify({ center: [cx, cy], startRadius: r0, endRadius: r1, steps: 12 }));
