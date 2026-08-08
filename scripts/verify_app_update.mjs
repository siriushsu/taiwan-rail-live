// 更新提示驗收:純函式 → 狀態機 → 查詢層 → UI → 跨引擎四寬度。
//
// 判準刻意不看實作怎麼寫:版本比較的期望值來自 Apple 的語意(逐段比整數),
// 不是來自 index.html 裡那段程式碼。`1.02` vs `1.1` 那一組是關鍵案例——
// 線上真的出現過 `1.02` 這個版本字串(見 app/scripts/set-release-mode.mjs:34-38),
// 字串比較會判反,只有逐段比整數才會對。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 5399;
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const md5 = b => createHash('md5').update(b).digest('hex');

// ── 第一道閘:確認驗的是哪一棵樹 ──(驗收腳本驗到別的 worktree 的舊檔是真的發生過的事)
const localHash = md5(readFileSync(path.join(ROOT, 'index.html')));
console.log(`驗證目標：${ROOT}\nindex.html md5：${localHash}\n`);
const servedHash = md5(Buffer.from(await (await fetch(BASE + '/index.html')).arrayBuffer()));
ok(servedHash === localHash, `伺服器供的 index.html 與本樹逐 byte 相同（served ${servedHash.slice(0, 8)}）`);
if (servedHash !== localHash) { console.log('\n目標不符,後續斷言無意義,中止。'); process.exit(1); }

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.log('  ⚠ pageerror: ' + e.message));
await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.cmpVer === 'function', { timeout: 20000 })
  .catch(() => console.log('  ⚠ cmpVer 尚未存在'));

console.log('\n【A】cmpVer 逐段比整數');
const cases = [
  ['1.4.0', '1.4.1', -1, '小版號較舊'],
  ['1.4.1', '1.4.0',  1, '小版號較新'],
  ['1.4.1', '1.4.1',  0, '相同'],
  ['1.4',   '1.4.0',  0, '段數不同,短的補 0'],
  ['1.02',  '1.1',    1, '🔴 1.02＝[1,2] 大於 1.1＝[1,1];字串比會判反'],
  ['1.2',   '1.10',  -1, '10 > 2,逐段比整數不是字典序'],
];
for (const [a, b, want, why] of cases) {
  const got = await page.evaluate(([x, y]) => (window.cmpVer ? window.cmpVer(x, y) : 'NOFN'), [a, b]);
  ok(got === want, `cmpVer('${a}','${b}') = ${got}（期望 ${want}）— ${why}`);
}
for (const bad of ['', 'abc', '1.4.x', null]) {
  const got = await page.evaluate(v => (window.cmpVer ? window.cmpVer(v, '1.0.0') : 'NOFN'), bad);
  ok(got === null, `cmpVer(${JSON.stringify(bad)},'1.0.0') 回 null（不比較）`);
}

console.log('\n【B】appUpdateState 六種狀態');
const S = (mine, latest, st) => page.evaluate(
  ([m, l, s]) => (window.appUpdateState ? window.appUpdateState(m, l, s) : null), [mine, latest, st]);
let r;
r = await S('1.4.0', '1.4.1', { seen: '1.4.0', dismissed: null, whatsnewSeen: null });
ok(!!r && r.hasUpdate === true && r.showBanner === true && r.showWhatsNew === false, 'A1 有新版 → 橫幅出現');
r = await S('1.4.0', '1.4.1', { seen: '1.4.0', dismissed: '1.4.1', whatsnewSeen: null });
ok(!!r && r.hasUpdate === true && r.showBanner === false, 'A1 已關掉同一版 → 橫幅不出現,但仍標示有新版');
r = await S('1.4.1', '1.4.1', { seen: '1.4.0', dismissed: null, whatsnewSeen: null });
ok(!!r && r.showWhatsNew === true && r.showBanner === false, 'A2 剛更新完 → 顯示「更新了什麼」');
r = await S('1.4.1', '1.4.1', { seen: '1.4.1', dismissed: null, whatsnewSeen: null });
ok(!!r && r.showWhatsNew === false && r.hasUpdate === false, 'A3 平常 → 什麼都不顯示');
r = await S('1.4.1', '1.4.1', { seen: null, dismissed: null, whatsnewSeen: null });
ok(!!r && r.showWhatsNew === false, '🔴 第一次裝(seen 不存在) → 不可迎面丟一張卡片');
r = await S('1.4.1', '1.4.1', { seen: '1.4.0', dismissed: null, whatsnewSeen: '1.4.1' });
ok(!!r && r.showWhatsNew === false, '同一版的更新卡片看過就不再出現');
r = await S('1.4.1', null, { seen: '1.4.0', dismissed: null, whatsnewSeen: null });
ok(!!r && r.hasUpdate === false && r.showBanner === false && r.showWhatsNew === false,
   '查詢失敗(latest 為 null) → 全部安靜');

await browser.close();
console.log(`\n總計：${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
