#!/usr/bin/env node
// 上線期觀測：把「App Store 名次」與「圖磚燒錄」記成同一條時間序列。
//
// 用法：
//   node scripts/launch_watch.mjs                記一筆（名次 + AE 用量 + Stadia 實數）
//   node scripts/launch_watch.mjs --esri=250000  同上，並帶入 Esri 後台當日張數（Esri 無 API，只能手動）
//   node scripts/launch_watch.mjs --log          看時間序列
//
// 資料源：
//   名次    Apple 官方 iTunes RSS（公開免金鑰）
//   AE 用量 我方 Analytics Engine（即時，延遲 3–5 分鐘）——App 殼 vs 網頁的 /api/* 請求數
//   Stadia  管理 API 實數（GET /api/v1/properties/<id>/stats/，需 .env 的 STADIA_MGMT_KEY）
//   Esri    手動帶入（ArcGIS 無對應的免申請 API）
//
// ⚠ 兩種「今天」不一樣，不要混算：
//   AE 用的是**台北日**（00:00–24:00 +08）；Stadia 管理 API 的日期鍵是 **UTC 日**
//   （UTC 00:00 = 台北 08:00）。所以 Stadia 的「今日」其實是「今天早上 8 點到明天早上 8 點」，
//   它會把整個白天尖峰收在同一格、而不被凌晨的離峰稀釋。兩者的每日數字本來就不該相等。
// ⚠ 名次不是下載數：Apple 榜單看的是近期下載「速度」且經過平滑，換算不出絕對值。
//   真實下載數要等 ASC 銷售與趨勢（隔日）。
//
// 🔒 STADIA_MGMT_KEY 只從 .env 讀，永遠不印出、不寫進記錄檔。
import fs from 'fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dayWindow, rates } from './lib/stadia_projection.mjs';

const APP_ID = '6792673516';
const DATASET = 'railisland_traffic';
const PROPERTY = 94732;
// 專案路徑含中文，用 fileURLToPath 而非 new URL().pathname（後者會 percent-encode）
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG = path.join(ROOT, '.cache', 'launch_watch.tsv');  // .cache/ 已在 .gitignore 與 .assetsignore
const args = process.argv.slice(2);
const esriArg = (args.find(a => a.startsWith('--esri=')) || '').split('=')[1];

// 第三方方案額度與單價：供應商定價表與我們的用量、成本推估都屬營運資訊，不放進這個公開 repo。
// 改讀 .cache/vendor-pricing.json（`.cache/` 已在 .gitignore 與 .assetsignore）。
// 檔案不存在時只跳過「成本推估」那幾行，名次、請求數與實際用量照常輸出。
// 形狀如下（值全是佔位符，不是真的方案內容）：
//   { "stadia": { "quotaPlan": "<方案名>", "quotaIncl": <含額度>,
//                 "plans": [ { "name": "<方案名>", "base": <月費>, "incl": <含額度>, "over": <每千超額單價> } ] },
//     "esri":   { "incl": <免費張數>, "overPerK": <每千張超額單價> } }
const PRICING_FILE = path.join(ROOT, '.cache', 'vendor-pricing.json');
let PRICING = null;
try { PRICING = JSON.parse(fs.readFileSync(PRICING_FILE, 'utf8')); } catch (e) { /* 沒有就降級,不是錯誤 */ }
const PLANS = (PRICING && PRICING.stadia && PRICING.stadia.plans) || [];
const planCost = (p, credits) => p.base + Math.max(0, credits - p.incl) / 1000 * p.over;
const bestPlan = credits => PLANS.map(p => ({ p, c: planCost(p, credits) })).sort((a, b) => a.c - b.c)[0];
const n = v => Math.round(v).toLocaleString();

if (args.includes('--log')) {
  if (!fs.existsSync(LOG)) { console.log('尚無記錄，先跑一次 node scripts/launch_watch.mjs'); process.exit(0); }
  const rows = fs.readFileSync(LOG, 'utf8').trim().split('\n').map(l => l.split('\t'));
  console.log('時間'.padEnd(18) + ['旅遊', '導航', '總榜'].map(c => c.padStart(6)).join('') +
    ['App請求', '網頁請求', 'Stadia日', '期間累計', 'Esri'].map(c => c.padStart(11)).join(''));
  const num = v => (v !== undefined && /^\d+$/.test(v) ? (+v).toLocaleString() : '-');
  for (const [t, tr, nv, ov, app, web, day, cum, esri] of rows)
    console.log(t.padEnd(18) + [tr, nv, ov].map(v => String(v ?? '-').padStart(6)).join('') +
      [app, web, day, cum, esri].map(v => num(v).padStart(12)).join(''));
  console.log('\n註：Stadia 欄是 UTC 日、AE 請求欄是台北日，兩者的「今天」範圍不同（見檔頭）。');
  process.exit(0);
}

// ── 名次 ──────────────────────────────────────────────
async function ranks() {
  const out = {};
  for (const [key, g] of [['旅遊', '6003'], ['導航', '6010'], ['總榜', '']]) {
    try {
      const url = `https://itunes.apple.com/tw/rss/topfreeapplications/limit=100${g ? '/genre=' + g : ''}/json`;
      const d = await (await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } })).json();
      const e = d.feed.entry || [];
      const i = e.findIndex(x => x.id.attributes['im:id'] === APP_ID);
      out[key] = i >= 0 ? i + 1 : null;
    } catch { out[key] = null; }
  }
  return out;
}

// ── Stadia 管理 API ───────────────────────────────────
function readEnv() {
  try {
    return Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
      .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
      .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  } catch { return {}; }
}

async function stadia() {
  const key = readEnv().STADIA_MGMT_KEY;
  if (!key) return { err: '.env 沒有 STADIA_MGMT_KEY' };
  try {
    const r = await fetch(`https://client.stadiamaps.com/api/v1/properties/${PROPERTY}/stats/`,
      { headers: { Authorization: 'Token ' + key, accept: 'application/json' } });
    if (!r.ok) return { err: `HTTP ${r.status}` };          // 不回顯 body：避免任何形式的憑證回音
    const j = await r.json();
    // data.maps 是「每日」用量（UTC 日），data.cumulative 是累計且鍵往後偏一天
    // （實測 cumulative[d] === Σ maps[<d]）。用 maps 當日序列才是誠實的。
    // ⚠️ 這裡**不可**加 `.filter(([, v]) => v > 0)`：零用量日是真的一天，濾掉會讓
    //    下游「近 N 完整日均值」的分母縮水、均值系統性偏高。要排除的是「還沒到的日子」，
    //    那件事由 dayWindow() 用日期判，不是在這裡用數值判（見 lib/stadia_projection.mjs）。
    const daily = Object.entries(j.data.maps || {})
      .map(([d, v]) => [d.slice(0, 10), Math.round(v)])
      .sort((a, b) => a[0] < b[0] ? -1 : 1);
    return { start: j.start_date.slice(0, 10), end: j.end_date.slice(0, 10), total: j.total_usage, daily };
  } catch (e) { return { err: e.message.slice(0, 50) }; }
}

// ── AE 用量（今日台北日累計）────────────────────────────
function wranglerTokens() {
  const files = ['.wrangler/config/default.toml', 'Library/Preferences/.wrangler/config/default.toml',
    '.config/.wrangler/config/default.toml'].map(f => path.join(os.homedir(), f));
  const found = [];
  for (const f of files) {
    try {
      const t = fs.readFileSync(f, 'utf8');
      const tok = (t.match(/^oauth_token\s*=\s*"([^"]+)"/m) || [])[1];
      if (tok) found.push({ tok, exp: Date.parse((t.match(/^expiration_time\s*=\s*"([^"]+)"/m) || [])[1] || '') || 0 });
    } catch {}
  }
  return found.sort((a, b) => b.exp - a.exp).map(x => x.tok);
}

async function usage() {
  const tokens = process.env.CLOUDFLARE_API_TOKEN ? [process.env.CLOUDFLARE_API_TOKEN] : wranglerTokens();
  if (!tokens.length) return { app: null, web: null, err: '無 Cloudflare 憑證' };
  const cf = async (url, init) => {
    for (let i = 0; i < tokens.length; i++) {
      const r = await fetch(url, { ...init, headers: { authorization: 'Bearer ' + tokens[i], ...(init && init.headers) } });
      const text = await r.text();
      if (r.ok) return text;
      if ((r.status === 401 || r.status === 403) && i < tokens.length - 1) continue;
      throw new Error(`${r.status}`);
    }
  };
  try {
    const acct = process.env.CLOUDFLARE_ACCOUNT_ID ||
      JSON.parse(await cf('https://api.cloudflare.com/client/v4/accounts?per_page=50')).result[0].id;
    const sql = `SELECT blob1 AS plat, SUM(_sample_interval) AS req FROM ${DATASET}
      WHERE toDate(timestamp + INTERVAL '8' HOUR) = toDate(NOW() + INTERVAL '8' HOUR) GROUP BY plat`;
    const rows = JSON.parse(await cf(`https://api.cloudflare.com/client/v4/accounts/${acct}/analytics_engine/sql`,
      { method: 'POST', body: sql })).data || [];
    let app = 0, web = 0;
    for (const r of rows) { if (r.plat === 'app') app += +r.req; else web += +r.req; }
    return { app, web };
  } catch (e) { return { app: null, web: null, err: e.message.slice(0, 40) }; }
}

// ── 主流程 ────────────────────────────────────────────
const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).slice(0, 16);
const utcNow = new Date().toISOString();
const [r, u, s] = await Promise.all([ranks(), usage(), stadia()]);

console.log(`軌島上線觀測　${now}（台北）\n`);
console.log('  App Store 台灣免費榜');
for (const k of ['旅遊', '導航', '總榜']) console.log(`    ${k}　${r[k] ? '第 ' + r[k] + ' 名' : '未進前 100'}`);

console.log('\n  今日 /api/* 請求（我方埋點，台北日，即時）');
console.log(`    App 殼　${u.app !== null ? n(u.app) : '查詢失敗' + (u.err ? '：' + u.err : '')}`);
console.log(`    網頁　　${u.web !== null ? n(u.web) : '-'}`);

let sDay = '-', sCum = '-';
if (s.err) {
  console.log(`\n  Stadia　查詢失敗：${s.err}`);
  console.log('    需 .env 的 STADIA_MGMT_KEY（管理 API 須向 support@stadiamaps.com 申請開通）');
} else {
  const days = s.daily;
  const { complete, partial } = dayWindow(days, utcNow.slice(0, 10));
  sDay = partial ? partial[1] : (complete.length ? complete[complete.length - 1][1] : '-');
  sCum = s.total;
  const periodDays = Math.round((Date.parse(s.end) - Date.parse(s.start)) / 864e5);
  const elapsed = Math.round((Date.parse(utcNow.slice(0, 10)) - Date.parse(s.start)) / 864e5) + 1;
  const utcHrs = new Date(utcNow).getUTCHours() + new Date(utcNow).getUTCMinutes() / 60;

  console.log(`\n  Stadia credits（管理 API 實數，UTC 日）`);
  console.log(`    計費期　${s.start} → ${s.end}　第 ${elapsed}/${periodDays} 日`);
  const sq = (PRICING && PRICING.stadia && PRICING.stadia.quotaIncl) ? PRICING.stadia : null;
  console.log(`    期間累計　${n(s.total)}` +
    (sq ? ` / ${n(sq.quotaIncl)}　(${(s.total / sq.quotaIncl * 100).toFixed(1)}% of ${sq.quotaPlan})` : ''));
  console.log(`    近日　　${complete.slice(-6).map(([d, v]) => `${d.slice(5)} ${n(v)}`).join('　')}`);
  if (partial) console.log(`    ⚠ 今日（UTC ${partial[0]}）尚未結束，已過 ${utcHrs.toFixed(1)}/24 小時，目前 ${n(partial[1])}——**不列入速率**`);

  // 期末推估：給區間而不是單一數字——尖峰日不能當常態，但也不能假裝沒發生。
  // 兩個速率都只從**完整** UTC 日算（為什麼：見 lib/stadia_projection.mjs 開頭）。
  const rt = rates(complete);
  const left = periodDays - elapsed;
  if (!rt) {
    console.log(`\n    期末推估　資料不足：計費期內還沒有任何一個完整 UTC 日`);
  } else {
    console.log(`\n    期末推估（剩 ${left} 日，只用完整 UTC 日）`);
    for (const [tag, rate] of [[`若回落到近 ${rt.loN} 完整日均值`, rt.lo], [`若維持 ${rt.hiDay.slice(5)} 水準`, rt.hi]]) {
      const end = s.total + left * rate;
      const b = PLANS.length ? bestPlan(end) : null;
      console.log(`      ${tag.padEnd(16)}　${n(rate)}/日 → 期末 ${(end / 1e6).toFixed(1)}M` +
        (b ? `　最省方案 ${b.p.name} US$${b.c.toFixed(0)}` : '　(方案試算需 .cache/vendor-pricing.json)'));
    }
  }
}

// ── Esri（無 API，手動帶入；沿用當日最後一次讀數）────────
let esri = esriArg ? Math.round(+esriArg) : null;
if (esri === null && fs.existsSync(LOG)) {
  const rows = fs.readFileSync(LOG, 'utf8').trim().split('\n').map(l => l.split('\t'));
  for (let i = rows.length - 1; i >= 0; i--) {
    const [t, , , , , , , , es] = rows[i];
    if (t.slice(0, 10) === now.slice(0, 10) && es && es !== '-') { esri = +es; break; }
  }
}
if (esri !== null) {
  // Esri 的免費張數與超額單價同樣讀 .cache/vendor-pricing.json。計費期與 Stadia 不同，須另外看後台。
  console.log(`\n  Esri 衛星圖磚　${n(esri)}　(${esriArg ? '實讀' : '沿用當日前一筆'})`);
  const eMonth = esri * 30;
  const ep = (PRICING && PRICING.esri) || null;
  console.log(`    若每日維持此量　${(eMonth / 1e6).toFixed(1)}M/月` +
    (ep ? `　→ US$${(Math.max(0, eMonth - ep.incl) / 1000 * ep.overPerK).toFixed(0)}/月`
        : '　(成本試算需 .cache/vendor-pricing.json)'));
  console.log(`    ⚠ Esri 計費期與 Stadia 不同，期間累計要自己看後台（無 API 可查）`);
} else {
  console.log('\n  Esri 衛星圖磚　未帶入（加 --esri=<後台今日張數>）');
}

fs.appendFileSync(LOG, [now, r.旅遊 ?? '-', r.導航 ?? '-', r.總榜 ?? '-',
  u.app ?? '-', u.web ?? '-', sDay, sCum, esri ?? '-'].join('\t') + '\n');
console.log(`\n已記錄。看趨勢：node scripts/launch_watch.mjs --log`);
