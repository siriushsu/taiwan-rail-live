#!/usr/bin/env node

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(process.argv[2] || fileURLToPath(new URL('../www', import.meta.url)));
const types = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json'], ['.png', 'image/png'], ['.woff2', 'font/woff2'],
]);

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = normalize(join(root, relative));
    if (!file.startsWith(root) || !(await stat(file)).isFile()) throw new Error('not found');
    res.writeHead(200, { 'content-type': types.get(extname(file)) || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((resolveListen, rejectListen) => {
  server.once('error', rejectListen);
  server.listen(0, '127.0.0.1', resolveListen);
});

const port = server.address().port;
const browser = await chromium.launch({ headless: true });
const widths = [360, 375, 414, 768];
const results = [];

try {
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: width === 768 ? 1024 : 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message || error)));
    await page.route('**/native-bridge.js', route => route.fulfill({
      contentType: 'text/javascript',
      body: `
        window.RAIL_APP=true;
        window.Capacitor={getPlatform:()=>"android",isNativePlatform:()=>true,Plugins:{}};
        window.RAIL_NATIVE_PLUS_ADAPTER={
          setUser:async()=>{},clearUser:async()=>{},
          getCustomerInfo:async()=>({entitlements:{active:{}}}),
          getOfferings:async()=>({all:{plus:{availablePackages:[]}}}),
          purchase:async()=>({customerInfo:{entitlements:{active:{plus:{isSandbox:false}}}}}),
          restore:async()=>({entitlements:{active:{}}})
        };
      `,
    }));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof plusRender === 'function' && typeof plusConfigured === 'function');
    const stateResult = await page.evaluate(() => {
      state.account = { gen: 1, user: { uid: 'ui-test', email: 'ui@example.invalid', getIdToken: async () => 'x' } };
      state.plus = {
        active: false, entitlementEnvironment: '', founding: false, loading: false, error: '',
        pkgMonthly: { product: { priceString: 'NT$60' } },
        pkgAnnual: { product: { priceString: 'NT$600' } },
        mgmtUrl: '', adapter: window.RAIL_NATIVE_PLUS_ADAPTER, afterUnlock: null,
        cloudSyncReady: false, cloudSyncPromise: null,
      };
      const modal = document.getElementById('plusModal');
      modal.hidden = false;
      plusRender();
      window.__androidPlusTapped = [];
      modal.addEventListener('click', event => {
        const target = event.target.closest('button,a');
        if (!target) return;
        event.preventDefault(); event.stopImmediatePropagation();
        window.__androidPlusTapped.push(target.id || target.dataset.plus || target.textContent.trim());
      }, true);
      const text = document.getElementById('plusBody').innerText;
      return {
        plusEnabled: PLUS_ENABLED,
        plusConfigured: plusConfigured(),
        sandboxBuild: PLUS_SANDBOX_BUILD,
        hasGooglePlay: text.includes('Google Play'),
        hasAppStore: text.includes('App Store'),
        hasIosOnlyFeature: text.includes('動態島') || text.includes('iOS 17.6') || text.includes('iPhone 捷運小工具'),
        planCount: document.querySelectorAll('.plus-plan').length,
        restoreCount: document.querySelectorAll('.plus-restore').length,
      };
    });
    if (!stateResult.plusEnabled || !stateResult.plusConfigured || stateResult.sandboxBuild !== '16'
        || !stateResult.hasGooglePlay || stateResult.hasAppStore || stateResult.hasIosOnlyFeature
        || stateResult.planCount !== 2 || stateResult.restoreCount !== 1) {
      throw new Error(`${width}px Android Plus 狀態不符：${JSON.stringify(stateResult)}`);
    }

    const controls = await page.locator('#plusModal button, #plusModal a').count();
    const hitFailures = [];
    for (let i = 0; i < controls; i++) {
      const locator = page.locator('#plusModal button, #plusModal a').nth(i);
      await locator.scrollIntoViewIfNeeded();
      const hit = await locator.evaluate(element => {
        const r = element.getBoundingClientRect();
        const x = Math.max(r.left + 1, Math.min(r.right - 1, r.left + r.width / 2));
        const y = Math.max(r.top + 1, Math.min(r.bottom - 1, r.top + r.height / 2));
        const found = document.elementFromPoint(x, y);
        return { ok: found === element || element.contains(found), label: element.id || element.textContent.trim(), rect: [r.left, r.top, r.right, r.bottom] };
      });
      if (!hit.ok) hitFailures.push(hit);
      await locator.tap();
    }
    const geometry = await page.evaluate(() => {
      const dialog = document.querySelector('.plus-dialog').getBoundingClientRect();
      return {
        dialog: [dialog.left, dialog.top, dialog.right, dialog.bottom],
        viewport: [innerWidth, innerHeight],
        pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        tapped: window.__androidPlusTapped,
      };
    });
    if (hitFailures.length || geometry.pageOverflow || geometry.tapped.length !== controls
        || geometry.dialog[0] < -1 || geometry.dialog[2] > geometry.viewport[0] + 1) {
      throw new Error(`${width}px 觸控／版面稽核失敗：${JSON.stringify({ hitFailures, geometry, controls })}`);
    }
    results.push({ width, state: stateResult, controls, geometry, pageErrors: errors });
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}

console.log(JSON.stringify({ target: root, results }, null, 2));
