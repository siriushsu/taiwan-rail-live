#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';

const endpoint = process.env.RAIL_CDP_ENDPOINT || 'http://127.0.0.1:9222';
const output = process.env.RAIL_PLUS_GATE_AUDIT_OUT
  || new URL('../shots/stage4-android-plus-gate-audit.json', import.meta.url);

const targets = await fetch(endpoint + '/json').then(response => {
  if (!response.ok) throw new Error('CDP target list failed: ' + response.status);
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

const result = await evaluate(`(() => {
  const visible = element => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none'
      && style.visibility !== 'hidden' && !element.hidden;
  };
  const account = document.getElementById('accountBtn');
  const moreRow = document.querySelector('.ms-row[data-proxy="accountBtn"]');
  const original = {
    mode: state.mode,
    followTrain: state.followTrain,
    delayStats: state.delayStats,
    delayStatsFetching: state._delayStatsFetching,
    followHidden: document.getElementById('followPanel')?.hidden ?? true,
    delayHtml: document.getElementById('fpDelay')?.innerHTML || '',
    delayHidden: document.getElementById('fpDelay')?.hidden ?? true,
    delayTitle: document.getElementById('fpDelay')?.title || '',
  };
  const train = state.trains.find(item => item.sys === 'tra_sched');
  let delay30 = null;
  if (train) {
    state.mode = 'sched';
    state.followTrain = train;
    state._delayStatsFetching = true;
    showFollowPanel(train);
    state.delayStats = { [String(train.train)]: { a: 2, p: 90, d: 30, m: 12 } };
    renderDelayRow();
    const delay = document.getElementById('fpDelay');
    delay30 = {
      visible: visible(delay),
      text: delay?.innerText || '',
      paidLinkCount: delay?.querySelectorAll('.fp-dhlink').length || 0,
      cardPaidEntryHidden: document.getElementById('tcDelayHist')?.hidden ?? true,
    };
    state.mode = original.mode;
    state.followTrain = original.followTrain;
    state.delayStats = original.delayStats;
    state._delayStatsFetching = original.delayStatsFetching;
    if (delay) {
      delay.innerHTML = original.delayHtml;
      delay.hidden = original.delayHidden;
      delay.title = original.delayTitle;
    }
    if (original.followTrain) showFollowPanel(original.followTrain);
    else document.getElementById('followPanel').hidden = original.followHidden;
    renderDelayRow();
  }
  return {
    platform: window.Capacitor?.getPlatform?.() || '',
    isNativeApp: IS_NATIVE_APP,
    plusEnabled: PLUS_ENABLED,
    toolbarEntry: { exists: !!account, visible: visible(account) },
    moreEntry: { exists: !!moreRow, visible: visible(moreRow) },
    helpPlusAvailableCount: HELP_GROUPS.flatMap(group => group.secs)
      .filter(item => item.key === 'plus' && item.avail()).length,
    visiblePaidCtaCount: [...document.querySelectorAll('[data-dh-cta]')].filter(visible).length,
    delay30,
    free: {
      ready: !!state.ready,
      trainCount: state.trains.length,
      mapPresent: !!document.getElementById('map'),
      leafletPresent: !!window.L,
    },
  };
})()`);
socket.close();

const failures = [];
if (result.platform !== 'android') failures.push('platform is not android');
if (!result.isNativeApp) failures.push('IS_NATIVE_APP is false');
if (result.plusEnabled !== false) failures.push('PLUS_ENABLED is not false');
if (result.toolbarEntry.exists && result.toolbarEntry.visible) failures.push('toolbar pass entry is visible');
if (result.moreEntry.exists && result.moreEntry.visible) failures.push('more-sheet pass entry is visible');
if (result.helpPlusAvailableCount !== 0) failures.push('help pass section is available');
if (result.visiblePaidCtaCount !== 0) failures.push('delay-history paid CTA is visible');
if (!result.delay30?.visible || !result.delay30.text.includes('近30天平均誤點')) failures.push('free 30-day delay summary did not open');
if (result.delay30?.paidLinkCount !== 0 || result.delay30?.cardPaidEntryHidden !== true) failures.push('paid delay-history entry survived');
if (!result.free.ready || result.free.trainCount < 1 || !result.free.mapPresent || !result.free.leafletPresent) failures.push('free map/train runtime is not ready');

const report = { generatedAt: new Date().toISOString(), targetDescription: JSON.parse(target.description || '{}'), result, failures };
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ result, failures }));
if (failures.length) process.exitCode = 1;
