// 本機開發伺服器：靜態檔案＋ /api/*（直接載入 Cloudflare worker.js）
// 用法：node scripts/dev_server.mjs（金鑰讀專案根目錄 .env）
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 5179);

// 讀 .env 進 process.env（僅補缺，不覆蓋既有環境變數）
try {
  for (const line of readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch (e) { console.warn('.env 讀取失敗，/api/tra-live 將無法運作'); }

// Cloudflare Workers 環境 shim:Node 沒有 caches 全域,給個不快取的假物件
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
const worker = (await import(path.join(ROOT, 'worker.js'))).default;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    const resp = await worker.fetch(new Request('http://localhost' + req.url), process.env);
    res.statusCode = resp.status;
    resp.headers.forEach((v, k) => res.setHeader(k, v));
    return res.end(Buffer.from(await resp.arrayBuffer()));
  }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
}).listen(PORT, () => console.log(`dev server http://localhost:${PORT}`));
