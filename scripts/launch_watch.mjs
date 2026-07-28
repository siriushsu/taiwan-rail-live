#!/usr/bin/env node
// 上線期觀測：把「App Store 名次」與「用量／燒圖速度」記成同一條時間序列。
//
// 用法：
//   node scripts/launch_watch.mjs                  記一筆（名次 + AE 用量 + 估算 Stadia credits）
//   node scripts/launch_watch.mjs --credits=500000 同上，但用 Stadia 後台實讀值校準比例
//   node scripts/launch_watch.mjs --log            看時間序列
//
// 三個資料源：
//   名次   Apple 官方 iTunes RSS（公開免金鑰，實測隨時更新）
//   用量   我方 Analytics Engine（即時，延遲 3–5 分鐘）——App 殼與網頁的 /api/* 請求數
//   credits Stadia 後台手動讀入；記過實讀值之後，未來各筆用「credits/App 請求」比例估算
//
// ⚠ 名次不是下載數：Apple 榜單看的是近期下載「速度」且經過平滑，換算不出絕對值，
//   只能看趨勢。真實下載數要等 ASC 銷售與趨勢（隔日）。
// ⚠ credits 估算值僅供盯盤：比例會隨「使用者都在做什麼」漂移（放空掛機的人多，比例就高）。
//   要決定方案級距時以 Stadia 後台實數為準。
//
// TODO：Stadia 管理 API（GET https://client.stadiamaps.com/api/v1/<property_id>/stats/，
//   標頭 `Authorization: Token <key>`，property 94732）可讓 credits 也自動化，
//   但需先寫信 support@stadiamaps.com 申請開通 Management API access。
import fs from 'fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ID = '6792673516';
const DATASET = 'railisland_traffic';
// 專案路徑含中文，用 fileURLToPath 而非 new URL().pathname（後者會 percent-encode）
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG = path.join(ROOT, '.cache', 'launch_watch.tsv');  // .cache/ 已在 .gitignore，不進版控也不上傳
const args = process.argv.slice(2);
const creditsArg = (args.find(a => a.startsWith('--credits=')) || '').split('=')[1];
const esriArg = (args.find(a => a.startsWith('--esri=')) || '').split('=')[1];

// esri 是後來才加的欄位，故擺在最後——舊列少一格讀回來是 undefined，當 '-' 處理即可
const COLS = ['時間', '旅遊', '導航', '總榜', 'App請求', '網頁請求', 'credits', '來源', 'Esri圖磚'];

if (args.includes('--log')) {
  if (!fs.existsSync(LOG)) { console.log('尚無記錄，先跑一次 node scripts/launch_watch.mjs'); process.exit(0); }
  const rows = fs.readFileSync(LOG, 'utf8').trim().split('\n').map(l => l.split('\t'));
  console.log(COLS[0].padEnd(18) + COLS.slice(1, 4).map(c => c.padStart(6)).join('') +
    COLS.slice(4, 7).map(c => c.padStart(11)).join('') + COLS[8].padStart(11) + '  ' + COLS[7]);
  let prevC = null, prevT = null;
  for (const r of rows) {
    const [t, tr, nv, ov, app, web, cr, src, esri] = r;
    let rate = '';
    if (prevC && cr !== '-' && prevC !== '-') {
      const dh = (new Date(t.replace(' ', 'T') + ':00') - new Date(prevT.replace(' ', 'T') + ':00')) / 3.6e6;
      if (dh > 0.05) rate = `　${Math.round((cr - prevC) / dh / 1000)}k/時`;
    }
    console.log(t.padEnd(18) + [tr, nv, ov].map(v => String(v).padStart(6)).join('') +
      [app, web, cr, esri || '-'].map(v => String(v).padStart(11)).join('') + '  ' + (src || '') + rate);
    if (cr !== '-') { prevC = cr; prevT = t; }
  }
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
const [r, u] = await Promise.all([ranks(), usage()]);

// credits：有實讀值就用它並更新比例；否則用歷史最近一次實讀的比例估算。
// Esri 沒有代理可估，只能沿用當日最後一次手動讀數——連同它的時點一起記住，
// 否則拿 18:00 的讀數除以 22 小時外推會嚴重低估。
const hrsOf = t => +t.slice(11, 13) + +t.slice(14, 16) / 60;
let credits = creditsArg ? Math.round(+creditsArg) : null;
let src = credits !== null ? '實讀' : '-';
let ratio = null;
let esri = esriArg ? Math.round(+esriArg) : null;
let esriHrs = esriArg ? hrsOf(now) : null;
if (fs.existsSync(LOG)) {
  const rows = fs.readFileSync(LOG, 'utf8').trim().split('\n').map(l => l.split('\t'));
  for (let i = rows.length - 1; i >= 0; i--) {
    const [t, , , , app, , cr, s, es] = rows[i];
    if (t.slice(0, 10) !== now.slice(0, 10)) continue;             // 只認同一天
    if (ratio === null && s === '實讀' && cr !== '-' && app !== '-' && +app > 0) ratio = +cr / +app;
    if (esri === null && es && es !== '-') { esri = +es; esriHrs = hrsOf(t); }
    if (ratio !== null && esri !== null) break;
  }
}
if (credits === null && ratio && u.app) { credits = Math.round(u.app * ratio); src = `估算(×${ratio.toFixed(2)})`; }
if (credits !== null && creditsArg && u.app) ratio = credits / u.app;

console.log(`軌島上線觀測　${now}（台北）\n`);
console.log('  App Store 台灣免費榜');
for (const k of ['旅遊', '導航', '總榜']) console.log(`    ${k}　${r[k] ? '第 ' + r[k] + ' 名' : '未進前 100'}`);
console.log('\n  今日累計 /api/* 請求（我方埋點，即時）');
console.log(`    App 殼　${u.app ?? '查詢失敗' + (u.err ? '：' + u.err : '')}`);
console.log(`    網頁　　${u.web ?? '-'}`);
if (credits !== null) {
  console.log(`\n  Stadia credits　${credits.toLocaleString()}　(${src})`);
  if (ratio) console.log(`    比例 ${ratio.toFixed(2)} credits / App 請求`);
  // 方案交叉線：Standard $80 含 7.5M、超額 $0.02/千；Professional $250 含 25M。
  // 80 + (X-7.5M)/1000*0.02 = 250 → X = 16.0M/月。超過就該升 Professional。
  const CROSS = 16e6;
  const hrs = +now.slice(11, 13) + +now.slice(14, 16) / 60;
  if (hrs > 3) {
    const perDay = credits / hrs * 24, perMonth = perDay * 30;
    console.log(`    以今日速率推估　${Math.round(perDay / 1000)}k/日　${(perMonth / 1e6).toFixed(1)}M/月`);
    console.log(`    Professional 交叉線 16.0M/月（≈533k/日）→ ` +
      (perMonth > CROSS ? `⚠ 超出 ${((perMonth / CROSS - 1) * 100).toFixed(0)}%，維持數日就該升級`
                        : `尚在線下 ${((1 - perMonth / CROSS) * 100).toFixed(0)}%，Standard 划算`));

    // Esri（衛星）：2M 免費、超額 $0.15/千張。若併到 Stadia 的 Alidade Satellite：
    // 4 張 Esri 256 圖磚 ＝ 1 張 Stadia 512 圖磚 ＝ 4 credits ⇒ 張數換 credits 是 1:1。
    if (esri !== null && esriHrs > 3) {
      const eDay = esri / esriHrs * 24, eMonth = eDay * 30;
      const eCost = Math.max(0, eMonth - 2e6) / 1000 * 0.15;
      const std = m => 80 + Math.max(0, m - 7.5e6) / 1000 * 0.02;
      const pro = m => 250 + Math.max(0, m - 25e6) / 1000 * 0.015;
      const merged = perMonth + eMonth;
      const now2 = Math.min(std(perMonth), pro(perMonth)) + eCost;
      const after = Math.min(std(merged), pro(merged));
      console.log(`\n  Esri 衛星圖磚　${esri.toLocaleString()}` +
        (esriArg ? '　(實讀)' : `　(沿用 ${String(Math.floor(esriHrs)).padStart(2, '0')}:` +
          `${String(Math.round(esriHrs % 1 * 60)).padStart(2, '0')} 的讀數)`));
      console.log(`    以今日速率推估　${Math.round(eDay / 1000)}k/日　${(eMonth / 1e6).toFixed(1)}M/月` +
        `（免費 2M，超額 $0.15/千）→ US$${eCost.toFixed(0)}/月`);
      console.log(`\n  月費試算（今日速率外推，非帳單）`);
      console.log(`    現況分開兩家　Stadia US$${Math.min(std(perMonth), pro(perMonth)).toFixed(0)}` +
        ` ＋ Esri US$${eCost.toFixed(0)}　＝ US$${now2.toFixed(0)}`);
      console.log(`    衛星併到 Stadia　${(merged / 1e6).toFixed(1)}M credits/月　` +
        `＝ US$${after.toFixed(0)}（${pro(merged) < std(merged) ? 'Professional' : 'Standard'}）`);
      console.log(`    差額　US$${(now2 - after).toFixed(0)}/月` +
        (after < now2 ? `　省 ${((1 - after / now2) * 100).toFixed(0)}%` : ''));
    }
  }
} else {
  console.log('\n  Stadia credits　尚無基準——先讀一次後台數字並帶入：');
  console.log('    node scripts/launch_watch.mjs --credits=<後台的今日 credits>');
}
if (esri === null) console.log('\n  Esri 衛星圖磚　未帶入（加 --esri=<今日張數> 才會試算兩家合併）');

fs.appendFileSync(LOG, [now, r.旅遊 ?? '-', r.導航 ?? '-', r.總榜 ?? '-',
  u.app ?? '-', u.web ?? '-', credits ?? '-', src, esri ?? '-'].join('\t') + '\n');
console.log(`\n已記錄。看趨勢：node scripts/launch_watch.mjs --log`);
