#!/usr/bin/env node
// 修改版 HTML＋正式即時 API 的診斷管線煙測：確認 BR／Y 每批真的留下 observe/resolve，
// resolver 輸出 ID 唯一，續推車不超過有限缺訊上限。根頁改送本工作樹 HTML，其餘 API/資產走正式站。
import { chromium } from 'playwright';
import fs from 'node:fs';

const ROOT_URL = 'https://railisland.tw/';
const html = fs.readFileSync('index.html', 'utf8');
const browser = await chromium.launch(), page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.route(url => {
  const u = new globalThis.URL(url);
  return u.origin + u.pathname === ROOT_URL;
}, route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
await page.goto(ROOT_URL + '?g=metro&officialroster=1&census=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof state !== 'undefined' && state.ready === true, null, { timeout: 120000 });
await page.waitForFunction(() => typeof getTrtcEntityDiagnostics === 'function' &&
  getTrtcEntityDiagnostics().frames.some(x => x.kind === 'resolve' && x.line === 'BR') &&
  getTrtcEntityDiagnostics().frames.some(x => x.kind === 'resolve' && x.line === 'Y'), null, { timeout: 90000 });
await page.waitForTimeout(20000); // 再跨至少一批，確定不是只有 boot 首批會寫

const result = await page.evaluate(() => {
  const snap = getTrtcEntityDiagnostics(), now = Date.now() / 1000;
  const byLine = {};
  for (const line of ['BR', 'Y']) {
    const frames = snap.frames.filter(x => x.line === line), resolves = frames.filter(x => x.kind === 'resolve');
    const outputs = resolves.flatMap(x => x.output || []);
    const duplicateIds = resolves.reduce((n, frame) => {
      const ids = (frame.output || []).map(x => String(x.id));
      return Math.max(n, ids.length - new Set(ids).size);
    }, 0);
    const roster = ((state.trtcOfficialRoster && state.trtcOfficialRoster.vehicles) || []).filter(v => v.line === line);
    byLine[line] = { frames: frames.length, observes: frames.filter(x => x.kind === 'observe').length,
      resolves: resolves.length, outputs: outputs.length, duplicateIds,
      roster: roster.length, overAgeCoast: roster.filter(v => v.source === 'board-coast' &&
        now - Number(v.observedEpoch) > 45.5).map(v => v.vehicleId),
      reasons: [...new Set(resolves.flatMap(x => (x.directions || []).flatMap(d =>
        [...(d.retired || []).map(r => r.reason), ...(d.candidates || []).map(c => c.action)])))],
    };
  }
  return { schema: snap.schema, windowSec: snap.windowSec, count: snap.frames.length,
    stateCount: state._trtcCdDiag && state._trtcCdDiag.count,
    oldestAge: snap.frames.length ? now - snap.frames[0].at : 0, byLine,
    exportType: typeof exportTrtcEntityDiagnostics };
});

let failures = 0;
const check = (pass, label, detail = '') => {
  if (!pass) failures++;
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? `：${detail}` : ''}`);
};
check(result.schema === 1 && result.windowSec === 600 && result.count === result.stateCount,
  '環形紀錄 schema／窗口／狀態把手一致', JSON.stringify({ count: result.count, stateCount: result.stateCount }));
check(result.oldestAge <= 600.5, '正式資料紀錄沒有超過十分鐘', `oldest=${result.oldestAge.toFixed(1)}s`);
check(result.exportType === 'function', '匯出函式已掛到頁面主世界');
for (const line of ['BR', 'Y']) {
  const x = result.byLine[line];
  check(x.observes >= 2 && x.resolves >= 2, `${line}：跨至少兩批留下 observe＋resolve`,
    `observe=${x.observes} resolve=${x.resolves}`);
  check(x.duplicateIds === 0, `${line}：每個 resolver frame 的輸出 ID 唯一`, `duplicates=${x.duplicateIds}`);
  check(x.overAgeCoast.length === 0, `${line}：畫面沒有超過 45 秒仍續推的舊車`, x.overAgeCoast.join(','));
  check(x.roster > 0, `${line}：正式即時名冊仍有列車`, `roster=${x.roster}`);
}
check(errors.length === 0, '正式資料頁沒有 pageerror', errors[0] || '');
console.log('\n診斷摘要：', JSON.stringify(result.byLine));
await browser.close();
console.log(failures ? `\n❌ ${failures} 項未通過` : '\n✅ 全部通過');
process.exit(failures ? 1 : 0);
