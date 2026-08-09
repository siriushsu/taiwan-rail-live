#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';
import {
  ANDROID_PLUS_GATE_LINE,
  assertAndroidPlusGate,
} from './verify-release.mjs';

const target = resolve(process.argv[2] || new URL('../www/index.html', import.meta.url).pathname);
const html = await readFile(target, 'utf8');

const initializerMatch = html.match(/const PLUS_ENABLED = \(\(\) => \{ try \{[\s\S]*?\} catch \(e\) \{ return false; \} \}\)\(\);/);
if (!initializerMatch) throw new Error('找不到 PLUS_ENABLED initializer');

function loadPlusEnabled(source, { native, platform, search, userAgent }) {
  const capacitor = native ? {
    getPlatform: () => platform,
    isNativePlatform: () => true,
  } : undefined;
  const context = {
    IS_NATIVE_APP: native,
    window: { Capacitor: capacitor },
    Capacitor: capacitor,
    location: { search },
    navigator: { userAgent },
    URLSearchParams,
  };
  vm.runInNewContext(`${source}\nglobalThis.__plusEnabled = PLUS_ENABLED;`, context);
  return context.__plusEnabled;
}

const chromiumDesktopUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36';
const webkitDesktopUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15';
const cases = [
  { name: 'android-native', native: true, platform: 'android', search: '?plus=1', userAgent: chromiumDesktopUa, expected: false },
  { name: 'ios-native', native: true, platform: 'ios', search: '', userAgent: webkitDesktopUa, expected: true },
  { name: 'chromium-web-plus', native: false, platform: 'web', search: '?plus=1', userAgent: chromiumDesktopUa, expected: true },
  { name: 'chromium-web-off', native: false, platform: 'web', search: '', userAgent: chromiumDesktopUa, expected: false },
  { name: 'webkit-web-plus', native: false, platform: 'web', search: '?plus=1', userAgent: webkitDesktopUa, expected: true },
  { name: 'webkit-web-off', native: false, platform: 'web', search: '', userAgent: webkitDesktopUa, expected: false },
];

assertAndroidPlusGate(html);
const results = cases.map(testCase => {
  const actual = loadPlusEnabled(initializerMatch[0], testCase);
  if (actual !== testCase.expected) {
    throw new Error(`${testCase.name}: expected ${testCase.expected}, got ${actual}`);
  }
  return { name: testCase.name, actual };
});

const mutatedHtml = html.replace(`${ANDROID_PLUS_GATE_LINE}\n`, '');
let negativeRejected = false;
try { assertAndroidPlusGate(mutatedHtml); } catch { negativeRejected = true; }
if (!negativeRejected) throw new Error('負樣本移除 Android gate 後仍通過 verifier');
const mutatedInitializer = initializerMatch[0].replace(`${ANDROID_PLUS_GATE_LINE}\n`, '');
const mutationAndroidValue = loadPlusEnabled(mutatedInitializer, cases[0]);
if (mutationAndroidValue !== true) {
  throw new Error(`移除 gate 後 Android native 應回到 true，實際為 ${mutationAndroidValue}`);
}

console.log(JSON.stringify({ target, results, negativeRejected, mutationAndroidValue }));
