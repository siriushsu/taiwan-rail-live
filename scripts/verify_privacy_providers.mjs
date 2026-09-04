#!/usr/bin/env node
// privacy.html 的「三、服務供應商」與**實際會收到使用者請求的第三方**之間的對稱性守門人。
//
// 為什麼要有這支:底圖供應商改動後,privacy.html 曾經沒有同步更新。程式碼那面有 verify
// 腳本擋,對外文字那面也需要同樣的自動判準。
//
// 判準的兩個方向(缺一都會留下破口):
//   A 正向  每一個「實際會收到使用者請求」的第三方主機,都要對應到清單裡的一個供應商名字
//   B 反向  清單裡的每一個供應商,都要真的還在用(或明文標「不接收使用者資料」)
//
// 🔴 這支**失敗封閉**:掃到一個 HOSTS 表沒有登記的主機就 FAIL。新接一家供應商時它會擋下來,
//    而不是靜默放行——這正是上次漏掉的那個形狀(沒有人「決定不列」,是根本沒人想到要列)。
//
// 用法:node scripts/verify_privacy_providers.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(path.join(ROOT, f), 'utf8');

const R = [];
const ok = (id, pass, detail) => { R.push(pass); console.log(`${pass ? '✅' : '❌'} ${id} — ${detail}`); };

// ── 主機 → privacy.html 裡該出現的供應商名字 ──────────────────────────────────
// 值必須與清單裡的寫法**逐字相同**(比對是 includes)。
const HOSTS = {
  'static.cloudflareinsights.com': 'Cloudflare',
  'cloudflareinsights.com': 'Cloudflare',
  'railisland-metro-core.sirius1984.workers.dev': 'Cloudflare',
  'www.gstatic.com': 'Google Firebase',
  'googleapis.com': 'Google Firebase',
  'api.revenuecat.com': 'RevenueCat',
  'cdn.jsdelivr.net': 'jsDelivr',
  'tiles.openfreemap.org': 'OpenFreeMap',
  'tiles.stadiamaps.com': 'Stadia Maps',
  'ibasemaps-api.arcgis.com': 'Esri',
};
// 沒有網路主機、但確實在處理使用者資料的供應商(原生管道:登入、商店交易)。
// 它們掃不到,所以反向判準要放行——但要在這裡具名,不能靠「掃不到就算了」。
const NATIVE_ONLY = ['Apple', 'Google'];

// ── 掃描一:CSP 的 script-src / connect-src ⇒ 瀏覽器會對它發請求的第三方 ────────
const headers = read('_headers');
// CSP 整份寫在同一行、用 `;` 分隔各指令(不是每行一條)——第一版就是照著換行寫正規式,
// 兩條 S0 全紅、cspHosts 空的,而 A1/A2 照樣綠(掃不到東西的判準恆真)。留這行當標記。
const cspLine = (headers.match(/Content-Security-Policy:([^\n]*)/) || [])[1] || '';
ok('S0 _headers 取得 CSP', cspLine.length > 100, `${cspLine.length} bytes`);
const cspHosts = new Set();
for (const dir of ['script-src', 'connect-src']) {
  const seg = cspLine.split(';').map(x => x.trim()).find(x => x.startsWith(dir + ' '));
  if (!seg) { ok(`S0 CSP 含 ${dir}`, false, 'CSP 結構變了,這支掃不到東西'); continue; }
  for (const tok of seg.split(/\s+/)) {
    if (!tok.startsWith('https://')) continue;                 // 'self'／'unsafe-inline'／data: 都不是第三方
    cspHosts.add(tok.replace(/^https:\/\//, '').replace(/^\*\./, ''));
  }
}
ok('S1 CSP 掃得到第三方主機', cspHosts.size >= 5, `${cspHosts.size} 個:${[...cspHosts].join(' ')}`);

// ── 掃描二:圖磚網址 ⇒ 底圖供應商(這類不受 CSP 逐一列名,img-src 被 https: 放寬過)────
// 判準:網址樣板同時含 {z}{x}{y} 才算圖磚,避免把說明文字裡的連結當成供應商。
const tileHosts = new Set();
for (const f of ['index.html', 'app/scripts/prepare-web.mjs']) {
  for (const m of read(f).matchAll(/https:\/\/([a-z0-9.{}-]+)\/[^\s'"`]*\{z\}[^\s'"`]*/gi)) {
    const host = m[1].replace(/^\{s\}\./, '');
    // 網站原始碼仍保留 CARTO entry 當共用 App 設定的結構閘門；網站不會建立這兩層，
    // prepare-web 也會在 App 出貨時整段替換，不能把靜態字串誤算成實際供應商。
    if (f === 'index.html' && host === 'basemaps.cartocdn.com') continue;
    tileHosts.add(host);
  }
}
ok('S2 掃得到圖磚主機', tileHosts.size >= 2, `${tileHosts.size} 個:${[...tileHosts].join(' ')}`);

// ── privacy.html 的「三、服務供應商」清單 ────────────────────────────────────
const priv = read('privacy.html');
const sec = (priv.match(/<h2>三、服務供應商<\/h2>[\s\S]*?<\/ul>/) || [])[0] || '';
ok('S3 privacy.html 找得到服務供應商清單', !!sec, sec ? `${sec.length} bytes` : '找不到 <h2>三、服務供應商</h2>…</ul>');
const items = [...sec.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
ok('S4 清單解析得出項目', items.length >= 5, `${items.length} 項`);

// ── A 正向:每個掃到的主機都要有對應供應商,且那個名字真的在清單裡 ─────────────
const unmapped = [], missing = [];
const scanned = new Set([...cspHosts, ...tileHosts]);
const hit = new Set();
for (const h of scanned) {
  const provider = HOSTS[h] || HOSTS[Object.keys(HOSTS).find(k => h.endsWith(k)) || ''];
  if (!provider) { unmapped.push(h); continue; }
  hit.add(provider);
  if (!items.some(t => t.includes(provider))) missing.push(`${h} ⇒ 需要「${provider}」`);
}
// 🔴 覆蓋率要有具名斷言:上一版 A2 的訊息印的是 HOSTS 表的家數(常數),掃到 0 個主機也照印
//    「8 家都在清單裡」——分母無聲縮水時判準看起來完全正常。
ok('A0 掃描真的有覆蓋到 HOSTS 表登記的供應商', hit.size === new Set(Object.values(HOSTS)).size,
  `掃到 ${hit.size}/${new Set(Object.values(HOSTS)).size} 家:${[...hit].join('、')}`);
// 🔴 失敗封閉那條:新供應商接上去時,是這條擋下來的。
ok('A1 沒有掃到「表裡沒登記」的第三方主機', unmapped.length === 0,
  unmapped.length ? `${unmapped.join(' / ')} ——接了新供應商就要同時更新 HOSTS 表與 privacy.html` : `全部 ${scanned.size} 個主機都有登記`);
ok('A2 每個在用的供應商都列在 privacy.html', missing.length === 0,
  missing.length ? missing.join(' / ') : `掃到的 ${hit.size} 家都在清單裡(共 ${scanned.size} 個主機)`);

// ── B 反向:清單裡不該留著已經不用的供應商(這正是 08-18~08-26 那八天的破口)────
const known = new Set([...Object.values(HOSTS), ...NATIVE_ONLY]);
const stale = items.filter(t => {
  if (t.includes('不接收使用者資料')) return false;            // 圖資來源那類,本來就不是供應商
  return ![...known].some(k => t.includes(k));
});
ok('B1 清單裡沒有已經不用的供應商', stale.length === 0,
  stale.length ? stale.map(t => t.slice(0, 34)).join(' / ') : `${items.length} 項全部對得上`);

// ── C:退路型供應商要標明「只在什麼時候用」——它決定使用者的 IP 什麼時候會送過去 ──
for (const p of ['Stadia Maps']) {
  const li = items.find(t => t.includes(p)) || '';
  ok(`C/${p} 標明是退路(僅在 OpenFreeMap 無法載入時使用)`, /僅在[\s\S]*無法載入時使用/.test(li),
    li.slice(0, 60) || '(清單裡沒有這一項)');
}

const bad = R.filter(x => !x).length;
console.log(`\n總計 ${R.length - bad}/${R.length} 通過`);
process.exit(bad ? 1 : 0);
