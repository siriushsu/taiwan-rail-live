#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const endpoint = process.env.RAIL_CDP_ENDPOINT || 'http://127.0.0.1:9222';
const args = process.argv.slice(2);

if (!args.length) {
  console.error('Usage: webview-eval.mjs <expression> | --file <path>');
  process.exit(2);
}

const expression = args[0] === '--file'
  ? await readFile(args[1], 'utf8')
  : args.join(' ');

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

const id = 1;
socket.send(JSON.stringify({
  id,
  method: 'Runtime.evaluate',
  params: {
    expression,
    awaitPromise: true,
    returnByValue: true,
  },
}));

const response = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('CDP evaluation timed out')), 30_000);
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id !== id) return;
    clearTimeout(timeout);
    resolve(message);
  });
  socket.addEventListener('error', reject, { once: true });
});

socket.close();

if (response.error || response.result?.exceptionDetails) {
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(response.result?.result?.value ?? null, null, 2));
