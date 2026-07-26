// 驗「高成本端點的節流真的擋在 outbound fetch 之前」（稽核 2026-07-26）。
//
// 為什麼判準是「有沒有打上游」而不是「回不回 429」：
// /api/delay-history 與 /api/account-delete 在判斷 token 有沒有效之前，就已經對
// Firebase identitytoolkit 發出一次 fetch。也就是說隨便一串垃圾 Bearer 都能逼我們打上游一次，
// 是不需要任何憑證的配額放大。節流若加在那兩發 fetch 後面，429 會照回、上游照樣被打爆——
// 所以只斷言狀態碼等於沒驗到重點，一定要數 fetch 次數。
//
// 用法：node scripts/verify_rate_limit.mjs
import { _rateLimit } from '../worker.js';

const { rateLimited, delayHistory, deletePaidProfile } = _rateLimit;
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`  ${ok ? 'PASS' : '❌FAIL'}  ${msg}`); };

// ── 替身 ────────────────────────────────────────────────────────────────────
let upstream = [];                       // 每一發 outbound fetch 的網址
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => { upstream.push(String(url)); return new Response('{}', { status: 500 }); };
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

const limiter = (blocked) => ({ limit: async () => ({ success: !blocked }) });
const ENV = (over = {}) => ({
  FIREBASE_WEB_API_KEY: 'k', REVENUECAT_PROJECT_ID: 'p', REVENUECAT_V2_SECRET_KEY: 's',
  DELAY_DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }), first: async () => ({ m: '2026-07-25' }) }) },
  ...over,
});
const req = (path, method = 'GET') => new Request('https://railisland.tw' + path, {
  method, headers: { Authorization: 'Bearer ' + 'x'.repeat(900), 'cf-connecting-ip': '203.0.113.9' },
});

// ── 1. rateLimited 本身：fail-open 契約 ─────────────────────────────────────
console.log('\n===== rateLimited 契約 =====');
check(await rateLimited(undefined, req('/')) === false, 'binding 不存在 → 放行（fail-open，不讓限流服務缺席就整站 429）');
check(await rateLimited({}, req('/')) === false, 'binding 形狀不對 → 放行');
check(await rateLimited({ limit: async () => { throw new Error('down'); } }, req('/')) === false, '限流服務丟例外 → 放行');
check(await rateLimited(limiter(true), req('/')) === true, '額度用完 → 擋');
check(await rateLimited(limiter(false), req('/')) === false, '額度還有 → 放行');

// ── 2. /api/delay-history ───────────────────────────────────────────────────
console.log('\n===== /api/delay-history =====');
upstream = [];
let r = await delayHistory(req('/api/delay-history?train=1234'), ENV({ AUTH_LIMITER: limiter(true) }));
check(r.status === 429, `被擋時回 429（實際 ${r.status}）`);
check(upstream.length === 0, `被擋時一發上游都沒打（實際 ${upstream.length} 發：${upstream.join(', ') || '無'}）`);

upstream = [];
r = await delayHistory(req('/api/delay-history?train=1234'), ENV({ AUTH_LIMITER: limiter(false) }));
check(r.status !== 429, `額度還有時不會被誤擋（實際 ${r.status}）`);
check(upstream.length === 1 && upstream[0].includes('identitytoolkit'),
  `放行時才會走到 Firebase 驗證（實際 ${upstream.length} 發）— 證明上面那個 0 是節流擋下的，不是這條路本來就不打上游`);

upstream = [];
r = await delayHistory(req('/api/delay-history?train=@@bad@@'), ENV({ AUTH_LIMITER: limiter(false) }));
check(r.status === 400 && upstream.length === 0, '車次格式不合先擋掉，不浪費額度也不打上游');

// ── 3. /api/account-delete ──────────────────────────────────────────────────
console.log('\n===== /api/account-delete =====');
upstream = [];
r = await deletePaidProfile(req('/api/account-delete', 'POST'), ENV({ DELETE_LIMITER: limiter(true) }));
check(r.status === 429, `被擋時回 429（實際 ${r.status}）`);
check(upstream.length === 0, `被擋時一發上游都沒打（實際 ${upstream.length} 發）`);

upstream = [];
r = await deletePaidProfile(req('/api/account-delete', 'POST'), ENV({ DELETE_LIMITER: limiter(false) }));
check(upstream.length === 1 && upstream[0].includes('identitytoolkit'),
  `放行時才會走到 Firebase 驗證（實際 ${upstream.length} 發）`);

upstream = [];
r = await deletePaidProfile(req('/api/account-delete', 'GET'), ENV({ DELETE_LIMITER: limiter(false) }));
check(r.status === 405 && upstream.length === 0, 'GET 先擋在 405，不打上游');

globalThis.fetch = realFetch;
console.log(`\n===== ${fails === 0 ? '全部通過' : fails + ' 項失敗'} =====`);
process.exit(fails ? 1 : 0);
