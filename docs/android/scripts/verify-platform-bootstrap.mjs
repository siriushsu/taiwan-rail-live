#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../../../index.html', import.meta.url), 'utf8');
const marker = '/* 首繪前套用手機殼、面板偏好與平台能力 class';
const markerAt = html.indexOf(marker);
assert.notEqual(markerAt, -1, 'platform bootstrap marker missing');
const scriptStart = html.lastIndexOf('<script>', markerAt);
const scriptEnd = html.indexOf('</script>', markerAt);
assert.ok(scriptStart >= 0 && scriptEnd > scriptStart, 'platform bootstrap script bounds missing');
const bootstrap = html.slice(scriptStart + '<script>'.length, scriptEnd);

function run(userAgent, { touchMac = false } = {}) {
  const classes = new Set();
  const document = {
    body: { classList: { add: (...names) => names.forEach(name => classes.add(name)) } },
  };
  if (touchMac) document.ontouchend = null;
  vm.runInNewContext(bootstrap, {
    document,
    navigator: { userAgent },
    localStorage: { getItem: () => null },
    matchMedia: () => ({ matches: false }),
  });
  return [...classes].sort();
}

const results = {
  iphone: run('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'),
  ipadDesktopUa: run('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', { touchMac: true }),
  androidWebView: run('Mozilla/5.0 (Linux; Android 15; Pixel 7 Build/AP3A) AppleWebKit/537.36; wv'),
};

assert.ok(results.iphone.includes('music-volume-unavailable'), 'iPhone must retain unavailable volume class');
assert.ok(results.ipadDesktopUa.includes('music-volume-unavailable'), 'touch Macintosh iPadOS must retain unavailable volume class');
assert.ok(!results.androidWebView.includes('music-volume-unavailable'), 'Android WebView must not receive unavailable volume class');

console.log(JSON.stringify(results));
