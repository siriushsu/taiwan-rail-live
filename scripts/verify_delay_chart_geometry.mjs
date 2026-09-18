#!/usr/bin/env node
// 誤點履歷逐日長條圖(index.html 的 dhBarChart)幾何驗收。跑法:node scripts/verify_delay_chart_geometry.mjs
//
// 背景:2026-09-18 把 /api/delay-history 的視窗從 90 天放大到 365 天(DELAY_HISTORY_WINDOW_DAYS,
// 為了讓 257 天回填 2025-12-31~2026-09-13 真的拿得到)。舊版 dhBarChart 的幾何寫死在「大約 90 根」
// 的假設上:gap 固定 0.6、柱寬又夾在 1.2 以上(bw=Math.max(1.2,…))。N 一大,總寬 N×(bw+gap) 就
// 不再等於繪圖區寬度——實測 257 天算出 462 單位、365 天算出 656 單位,而繪圖區只有 292,柱子直接
// 溢出 y 軸與 viewBox 右緣(不是變醜,是畫到圖框外面)。現在改成 step=plotW/N,間隙只在有餘裕時
// 才留,總寬因此恆等於 plotW。
//
// 為什麼需要這一支:dhBarChart 唯一的既有覆蓋是 verify_delay_history_ui.mjs,而那支要 chromium
// ＋WebKit 兩顆瀏覽器(驗 Safari/iOS 渲染),在只有 chromium 的環境跑不起來,而且它餵的是固定
// 90 天假資料——正好是舊幾何還沒壞的那個長度,測不到溢出。這一支不需要瀏覽器:dhBarChart 是純
// 產字串的函式,把它的原始碼從 index.html 抽出來求值就能驗,因此能在任何環境當回歸閘門。
//
// 🔴 刻意從 index.html 抽【真的那一份】原始碼求值,不在這裡抄一份副本:抄副本會變成「驗到另一棵
// 樹」——index.html 改壞了而這支照樣全綠。函式若被改名或改簽名,這支會直接以「找不到」失敗,
// 那也是正確的訊號(表示該回來看這支還驗不驗得到目標)。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'index.html');
const src = readFileSync(INDEX, 'utf8');
// 形態 0:先證明「我在量的是誰」(同 verify_delay_self_heal.mjs 的 G0)。
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${createHash('md5').update(src).digest('hex')}`);

let failures = 0;
const ok = (name, pass, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!pass) failures++;
};

// ── 從 index.html 抽出 dhBarChart 的原始碼(大括號配對,不用正規表示式硬切)──────────
const SIGNATURE = 'function dhBarChart(days, windowDays) {';
const start = src.indexOf(SIGNATURE);
if (start < 0) {
  console.log(`FAIL 在 index.html 找不到 ${JSON.stringify(SIGNATURE)}——函式被改名或改簽名了,本支已經驗不到目標,請同步更新`);
  process.exit(1);
}
let depth = 0, end = -1;
for (let j = src.indexOf('{', start); j < src.length; j++) {
  if (src[j] === '{') depth++;
  else if (src[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
}
const fnSrc = src.slice(start, end);
console.log(`[G0] 抽出 dhBarChart 原始碼 ${fnSrc.length} bytes`);

// dhBarChart 用到的三個外部相依,在這裡給等價替身(escHtml 真的轉義、t 真的代入 {n}):
// 目的是驗幾何與標籤,不是驗 i18n 字典(那是 check_i18n.mjs 的職責)。
const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const t = (k, v) => k.replace(/\{(\w+)\}/g, (_, n) => (v && v[n] != null ? v[n] : `{${n}}`));
const i18nNumber = n => String(n);
const dhBarChart = new Function('escHtml', 't', 'i18nNumber', `${fnSrc}; return dhBarChart;`)(escHtml, t, i18nNumber);

// 這些數字鏡射 dhBarChart 內部的 viewBox 常數;它們是「圖框長怎樣」的契約,不是可調參數。
const VBW = 320, VBH = 128, padL = 22, padR = 6, padT = 8, padB = 20;
const plotW = VBW - padL - padR, plotH = VBH - padT - padB;
const MIN_LAB_GAP = 30;

// 假資料:每 17 天來一個 >5 分的誤點日(驗紅綠分類),其餘 0~4 分。
const mkDays = (n, startIso) => {
  const out = [], d0 = Date.parse(startIso + 'T00:00:00Z');
  for (let k = 0; k < n; k++) {
    const d = new Date(d0 + k * 86400000).toISOString().slice(0, 10);
    out.push({ d, fd: k % 17 === 0 ? 23 : k % 5, md: k % 17 === 0 ? 31 : k % 7 });
  }
  return out;
};

// N=90 是放大前的舊長度(不能回歸);257 是這次回填的實際天數;365 是新視窗上限。
// 30 天代表「資料還在累積」的短窗,1 天是退化邊界(N-1=0,除法與標籤都不能炸)。
for (const N of [1, 30, 90, 257, 365]) {
  console.log(`\n── N=${N} 天 ──`);
  const days = mkDays(N, '2025-12-31');
  let svg;
  try { svg = dhBarChart(days, N); } catch (e) {
    ok(`N=${N} 不拋例外`, false, String((e && e.message) || e));
    continue;
  }
  ok(`N=${N} 不拋例外`, true);

  const rects = [...svg.matchAll(/<rect class="dh-bar (ok|hi)" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)]
    .map(m => ({ cls: m[1], x: +m[2], y: +m[3], w: +m[4], h: +m[5] }));

  ok(`N=${N} 柱子數恰為天數`, rects.length === N, `rects=${rects.length}`);
  if (!rects.length) continue;
  ok(`N=${N} 每根寬度 > 0(不會算出 0 或負寬而整根消失)`,
    rects.every(r => r.w > 0), `最細=${Math.min(...rects.map(r => r.w)).toFixed(3)}`);

  // 🔴 這兩條就是舊幾何壞掉的地方:257/365 天時柱子會畫到繪圖區外面。
  const right = Math.max(...rects.map(r => r.x + r.w));
  ok(`N=${N} 不溢出繪圖區右緣(${padL + plotW})`, right <= padL + plotW + 0.01, `最右=${right.toFixed(2)}`);
  ok(`N=${N} 不越過 y 軸左緣(${padL})`,
    Math.min(...rects.map(r => r.x)) >= padL - 0.01, `最左=${Math.min(...rects.map(r => r.x)).toFixed(2)}`);
  ok(`N=${N} 垂直方向落在繪圖區內`,
    rects.every(r => r.y >= padT - 0.01 && r.y + r.h <= padT + plotH + 0.01));
  ok(`N=${N} 柱子依日期單調向右(順序沒被打亂)`,
    rects.every((r, k) => k === 0 || r.x >= rects[k - 1].x - 0.01));
  ok(`N=${N} 紅/綠分類正確(fd>5 → .hi,其餘 .ok)`,
    rects.every((r, k) => (+days[k].fd > 5 ? r.cls === 'hi' : r.cls === 'ok')));

  // x 軸標籤:只取畫在 y=VBH-7 那一排(y 軸刻度共用 .dh-axis,但畫在 x≈padL-3 的同一欄)。
  const labs = [...svg.matchAll(/<text class="dh-axis" x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]+)</g)]
    .filter(m => Math.abs(+m[2] - (VBH - 7)) < 0.5)
    .map(m => ({ x: +m[1], s: m[3] }));
  const sorted = [...labs].sort((a, b) => a.x - b.x);
  let minGap = Infinity;
  for (let k = 1; k < sorted.length; k++) minGap = Math.min(minGap, sorted[k].x - sorted[k - 1].x);
  ok(`N=${N} x 標籤互不重疊(最小間距 ${minGap === Infinity ? 'n/a(僅 1 個)' : minGap.toFixed(1)} ≥ ${MIN_LAB_GAP})`,
    minGap === Infinity || minGap >= MIN_LAB_GAP - 0.01, labs.map(l => l.s).join(' '));
  const lastLab = days[N - 1].d.slice(5).replace('-', '/');
  ok(`N=${N} 末筆(統計迄日 ${lastLab})一定有標籤`, labs.some(l => l.s === lastLab), labs.map(l => l.s).join(' '));
  ok(`N=${N} 標籤數合理(≥1,且不多於天數)`, labs.length >= 1 && labs.length <= N, `${labs.length} 個`);
  // 長窗改標月界:257/365 天時標籤應該落在各月的第一個有資料的日子(這裡假資料無缺日 ⇒ 就是 01 號),
  // 而不是「固定每 14 天」——後者在 292 單位寬裡會擠出二十幾個互相疊掉的標籤。
  if (N > 120) {
    const monthly = labs.slice(0, -1).every(l => l.s.endsWith('/01'));
    ok(`N=${N} 長窗標籤落在月界(末筆除外)`, monthly, labs.map(l => l.s).join(' '));
  }
  ok(`N=${N} aria-label 帶入實際窗天數`, svg.includes(`近 ${N} 天逐日誤點長條圖`));
}

console.log(`\n${'═'.repeat(40)}`);
console.log(failures ? `❌ ${failures} 項失敗` : '✅ 全部通過');
process.exit(failures ? 1 : 0);
