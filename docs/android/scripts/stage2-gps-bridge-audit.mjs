#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const adb = process.env.RAIL_ADB || '/Users/xuxiang/Library/Android/sdk/platform-tools/adb';
const endpoint = process.env.RAIL_CDP_ENDPOINT || 'http://127.0.0.1:9222';
const appId = 'tw.railisland.app';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const adbRun = async (...args) => {
  const { stdout = '', stderr = '' } = await execFile(adb, args, { maxBuffer: 16 * 1024 * 1024 });
  return `${stdout}${stderr}`;
};

await adbRun('shell', 'am', 'force-stop', appId);
await adbRun('emu', 'geo', 'fix', '121.5654', '25.0330');
await adbRun('shell', 'am', 'start', '-W', '-n', `${appId}/.MainActivity`);
await wait(5000);
const appPid = (await adbRun('shell', 'pidof', appId)).trim();
if (!appPid) throw new Error('App PID not found after start');
await adbRun('forward', 'tcp:9222', `localabstract:webview_devtools_remote_${appPid}`);

const targets = await fetch(`${endpoint}/json`).then(response => response.json());
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
  const promise = pending.get(message.id);
  pending.delete(message.id);
  if (message.error || message.result?.exceptionDetails) promise.reject(new Error(JSON.stringify(message)));
  else promise.resolve(message.result?.result?.value);
});
const evaluate = expression => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
});

const permissions = await adbRun('shell', 'dumpsys', 'package', appId);
const permissionLines = permissions.split(/\r?\n/).filter(line => /ACCESS_(FINE|COARSE)_LOCATION/.test(line)).map(line => line.trim());
const watchId = await evaluate(`(async () => {
  window.__stage2GpsPhase = 'foreground-initial';
  window.__stage2GpsEvents = [];
  window.__stage2GpsWatch = await window.RAIL_NATIVE_GEOLOCATION.watchPosition(
    {enableHighAccuracy:true, timeout:20000, maximumAge:0},
    (position, error) => window.__stage2GpsEvents.push({
      at: Date.now(), phase: window.__stage2GpsPhase, hidden: document.hidden,
      coords: position && position.coords ? {
        latitude: position.coords.latitude, longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      } : null,
      error: error ? {code:error.code || null, message:error.message || String(error)} : null
    })
  );
  return window.__stage2GpsWatch;
})()`);

await wait(3500);
await evaluate(`window.__stage2GpsPhase='foreground-moved'`);
await adbRun('emu', 'geo', 'fix', '121.5664', '25.0340');
await wait(3500);
const foregroundCount = await evaluate('window.__stage2GpsEvents.length');

await evaluate(`window.__stage2GpsPhase='background'`);
await adbRun('shell', 'input', 'keyevent', 'KEYCODE_HOME');
await wait(1500);
await adbRun('emu', 'geo', 'fix', '121.5674', '25.0350');
await wait(4000);

await adbRun('shell', 'am', 'start', '-n', `${appId}/.MainActivity`);
await wait(2000);
await evaluate(`window.__stage2GpsPhase='foreground-resumed'`);
await adbRun('emu', 'geo', 'fix', '121.5684', '25.0360');
await wait(3500);
const resumedCount = await evaluate('window.__stage2GpsEvents.length');

await evaluate(`window.__stage2GpsPhase='screen-off'`);
await adbRun('shell', 'input', 'keyevent', 'KEYCODE_POWER');
await wait(1500);
await adbRun('emu', 'geo', 'fix', '121.5694', '25.0370');
await wait(4000);
await adbRun('shell', 'input', 'keyevent', 'KEYCODE_POWER');
await adbRun('shell', 'input', 'keyevent', 'KEYCODE_MENU');
await adbRun('shell', 'am', 'start', '-n', `${appId}/.MainActivity`);
await wait(2500);
await evaluate(`window.__stage2GpsPhase='screen-on-resumed'`);
await adbRun('emu', 'geo', 'fix', '121.5704', '25.0380');
await wait(3500);

await evaluate(`(async () => {
  await window.RAIL_NATIVE_GEOLOCATION.clearWatch(window.__stage2GpsWatch);
  window.__stage2GpsPhase='after-clear';
})()`);
const countAtClear = await evaluate('window.__stage2GpsEvents.length');
await adbRun('emu', 'geo', 'fix', '121.5714', '25.0390');
await wait(4000);
const events = await evaluate('window.__stage2GpsEvents');

const result = {
  api: Number((await adbRun('shell', 'getprop', 'ro.build.version.sdk')).trim()),
  appPid,
  permissionLines,
  watchId,
  foregroundCount,
  resumedCount,
  countAtClear,
  countAfterClearMove: events.length,
  events,
  summary: {
    receivedForegroundFix: events.some(event => event.phase.startsWith('foreground') && event.coords),
    receivedAfterBackgroundResume: events.some(event => event.phase === 'foreground-resumed' && event.coords),
    receivedAfterScreenOnResume: events.some(event => event.phase === 'screen-on-resumed' && event.coords),
    clearStoppedCallbacks: events.length === countAtClear,
    // Phase is assigned just before HOME/POWER. A callback already queued on the
    // foreground looper can retain that label, so document.hidden is the deciding
    // evidence for whether it was actually delivered while backgrounded.
    backgroundCallbacks: events.filter(event => event.phase === 'background' && event.hidden).length,
    screenOffCallbacks: events.filter(event => event.phase === 'screen-off' && event.hidden).length,
    foregroundTransitionCallbacks: events.filter(event => event.phase === 'background' && !event.hidden).length,
  },
};
await writeFile(new URL('../shots/gps-bridge-audit.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
socket.close();
console.log(JSON.stringify(result.summary));
