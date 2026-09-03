// Cloudflare Analytics Engine 查詢的共用層:憑證探索、帳號 id、SQL API、輸出小工具。
//
// 2026-09-03 從 usage_split.mjs 抽出來:usage_ofm_fallback.mjs 也要查 AE,再抄一份 token 邏輯
// 就是兩份會各自漂的東西(wrangler 的憑證位置已經換過一次,舊路徑那份會留在原地慢慢過期)。
// 邏輯與抽出前相同;usage_split.mjs 的輸出格式沒有變。
//
// 憑證:優先 CLOUDFLARE_API_TOKEN;沒有就借 wrangler 已登入的 OAuth token(實測可查 AE SQL)。
//       token 過期就跑一次 `npx wrangler whoami` 讓 wrangler 自動換新,再重跑呼叫端。
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// wrangler 的憑證位置換過(4.111 用 ~/.wrangler,更早是 ~/Library/Preferences/.wrangler),
// 舊路徑那份會留在原地慢慢過期 → 全部撈出來、依到期時間新到舊排,逐把試。
export function wranglerTokens() {
  const files = [
    path.join(os.homedir(), '.wrangler/config/default.toml'),
    path.join(os.homedir(), 'Library/Preferences/.wrangler/config/default.toml'),
    path.join(os.homedir(), '.config/.wrangler/config/default.toml'),
  ];
  const found = [];
  for (const f of files) {
    try {
      const t = readFileSync(f, 'utf8');
      const tok = (t.match(/^oauth_token\s*=\s*"([^"]+)"/m) || [])[1];
      if (tok) found.push({ tok, exp: Date.parse((t.match(/^expiration_time\s*=\s*"([^"]+)"/m) || [])[1] || '') || 0 });
    } catch (e) { /* 換下一個候選路徑 */ }
  }
  return found.sort((a, b) => b.exp - a.exp).map(x => x.tok);
}

// 找不到任何憑證就印提示並以 1 退出——每支查詢腳本的第一句都是這個,不必各自再寫。
export function requireTokens() {
  const tokens = process.env.CLOUDFLARE_API_TOKEN ? [process.env.CLOUDFLARE_API_TOKEN] : wranglerTokens();
  if (!tokens.length) {
    console.error('找不到憑證：設 CLOUDFLARE_API_TOKEN，或先 `npx wrangler login`。');
    process.exit(1);
  }
  return tokens;
}

// fetchImpl 可注入:離線測試把它換成假的,就能在不碰 Cloudflare 的前提下驗查詢腳本的組句與輸出。
export function makeClient(tokens, fetchImpl = fetch) {
  async function cf(url, init) {
    const what = init && init.method === 'POST' ? 'AE SQL' : 'API';
    for (let i = 0; i < tokens.length; i++) {
      const r = await fetchImpl(url, { ...init, headers: { authorization: 'Bearer ' + tokens[i], ...(init && init.headers) } });
      const text = await r.text();
      if (r.ok) return text;
      // 401/403＝這把過期或沒權限,還有別把就換下一把試
      if ((r.status === 401 || r.status === 403) && i < tokens.length - 1) continue;
      const hint = r.status === 401 || r.status === 403 ? '\n（token 過期了？跑一次 `npx wrangler whoami` 讓 wrangler 自動換新再重跑）' : '';
      throw new Error(`${what} ${r.status}: ${text.slice(0, 300)}${hint}`);
    }
  }
  async function accountId() {
    if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID;
    // 公開 repo 不寫死帳號 id,用 token 自己問
    const j = JSON.parse(await cf('https://api.cloudflare.com/client/v4/accounts?per_page=50'));
    const list = (j && j.result) || [];
    if (!list.length) throw new Error('這個 token 看不到任何 account');
    if (list.length > 1) console.error(`（有 ${list.length} 個 account，用第一個「${list[0].name}」；要指定請設 CLOUDFLARE_ACCOUNT_ID）`);
    return list[0].id;
  }
  // 回 data 陣列。呼叫端要記得:_sample_interval 是 AE 的取樣權重,必須加總它才是真實筆數(直接 count() 會低估)。
  async function aeSql(sql) {
    const acct = await accountId();
    return JSON.parse(await cf(`https://api.cloudflare.com/client/v4/accounts/${acct}/analytics_engine/sql`, { method: 'POST', body: sql })).data || [];
  }
  return { cf, accountId, aeSql };
}

// --hours=N(1..744,預設 24)
export function parseHours(args, dflt = 24) {
  return Math.max(1, Math.min(24 * 31, parseInt((args.find(a => a.startsWith('--hours=')) || '').split('=')[1], 10) || dflt));
}
export const n = v => Number(v).toLocaleString('en-US');
export const pad = (s, w) => String(s) + ' '.repeat(Math.max(0, w - String(s).length));
export const padL = (s, w) => ' '.repeat(Math.max(0, w - String(s).length)) + String(s);
