// /api/tra-daily-trains 的 worker 側驗收:直接把 worker.js 載進 Node,上游指向本機 fixture server。
//
// 為什麼要 fixture 而不是只打真的 ODS:要驗的是「上游壞掉時我們怎麼辦」——清單頁沒有今天、
// 逐日檔車次為空、逐日檔 500——這三種真實上游不會配合演出。真上游另跑一次冒煙(見檔尾 SMOKE=1)。
//
// TRA_DAILY_TTL_MS_OVERRIDE=0 讓每次呼叫都重抓,否則 30 分鐘的 mem 會讓第 2 個情境之後全部走快取,
// 「上游掛掉退回舊名冊」那條分支永遠測不到(批次 1 學到的:等 TTL 到期不是辦法)。
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
const worker = (await import(path.join(ROOT, 'worker.js'))).default;

let fail = 0;
const ck = (ok, m) => { console.log((ok ? '  ✓ ' : '  ✗ ') + m); if (!ok) fail++; };
const twToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const TODAY = twToday(), YMD = TODAY.replace(/-/g, '');

// ── SMOKE=1:不套任何 override,直接打真的臺鐵 ODS,證明「網址、解析、上游可達」在現實中成立。
// fixture 驗的是壞掉時的行為,這一段驗的是好的時候真的通——兩邊都要,少一邊就是只驗了替身。
if (process.env.SMOKE === '1') {
  const t0 = Date.now();
  const r = await worker.fetch(new Request('https://localhost/api/tra-daily-trains'), {});
  const b = await r.json();
  ck(r.status === 200, `真 ODS → ${r.status}(${Date.now() - t0}ms)` + (r.status !== 200 ? ' ' + JSON.stringify(b).slice(0, 120) : ''));
  if (r.status === 200) {
    ck(b.date === TODAY, `date=${b.date} 是台北今日`);
    ck(b.count >= 700 && b.count <= 1200, `車次數 ${b.count} 落在台鐵一天的合理量級`);
    ck(b.count === b.trains.length, `count 與 trains 長度一致`);
    ck(/^\d{4}-\d{2}-\d{2} /.test(b.updateTime || ''), `官方 UpdateTime=${b.updateTime}`);
    ck(new Set(b.trains).size === b.trains.length, `車次無重複`);
    ck(JSON.stringify(b).length < 20000, `回應 ${JSON.stringify(b).length} bytes(官方原始檔是 2MB)`);
  }
  console.log(fail ? `\nFAIL ${fail}` : '\n✅ 真 ODS 冒煙通過');
  process.exit(fail ? 1 : 0);
}

// ── fixture server:mode 由外部變數切換,一台 server 演完所有上游情境 ──
let mode = 'ok';
const RID = 'deadbeef0123456789abcdef01234567';
const mkDay = (n, upd) => JSON.stringify({
  UpdateTime: upd,
  TrainInfos: Array.from({ length: n }, (_, i) => ({ Train: String(1000 + i), Type: '1', TimeInfos: [] })),
});
const srv = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/list') {
    if (mode === 'list-no-today') {
      // 真實清單頁的形狀,但今天那筆不在(官方尚未發布/清單頁改版)
      return res.end(`<a href="/x/exceptionDataResource/${RID}">20991231.json</a>`);
    }
    if (mode === 'list-500') { res.statusCode = 500; return res.end('boom'); }
    return res.end(`<td><a href="/x/exceptionDataResource/${RID}">${YMD}.json</a></td>` +
      `<td><a href="/x/exceptionDataResource/aaaa1111bbbb2222cccc3333dddd4444">20991231.json</a></td>`);
  }
  if (u.pathname.startsWith('/day/')) {
    if (mode === 'day-500') { res.statusCode = 500; return res.end('boom'); }
    if (mode === 'day-empty') return res.end(JSON.stringify({ UpdateTime: 'x', TrainInfos: [] }));
    return res.end(mkDay(120, '2026-08-18 14:38:08'));
  }
  res.statusCode = 404; res.end('nope');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;
const ENV = {
  TRA_ODS_LIST_URL_OVERRIDE: base + '/list',
  TRA_ODS_DAY_URL_OVERRIDE: base + '/day/',
  TRA_DAILY_TTL_MS_OVERRIDE: '0',
};
const call = async () => {
  const r = await worker.fetch(new Request('https://localhost/api/tra-daily-trains'), ENV);
  return { status: r.status, cc: r.headers.get('cache-control'), body: await r.json() };
};

console.log(`台北今日 ${TODAY}｜fixture ${base}`);

// W1 清單頁沒有今天 → 502(此時 mem 還是空的,沒有舊值可退)
mode = 'list-no-today';
let r = await call();
ck(r.status === 502 && /沒有 \d{8}/.test(r.body.error || ''), `清單頁沒有今天 → 502「${r.body.error}」`);

// W2 逐日檔車次為空 → 502,且**不可**寫進 mem(下一個情境會證明)
mode = 'day-empty';
r = await call();
ck(r.status === 502 && /為空/.test(r.body.error || ''), `逐日檔車次為空 → 502「${r.body.error}」`);

// W3 正常
mode = 'ok';
r = await call();
const good = r.body;
ck(r.status === 200, `正常 → 200`);
ck(good.date === TODAY, `date=${good.date} 是台北今日`);
ck(good.count === 120 && good.trains.length === 120, `count=${good.count} 與 trains 長度一致`);
ck(good.updateTime === '2026-08-18 14:38:08', `updateTime 原樣帶出=${good.updateTime}`);
ck(good.trains[0] === '1000' && typeof good.trains[0] === 'string', `車次是字串「${good.trains[0]}」`);
ck(/s-maxage=1800/.test(r.cc || ''), `快取標頭 ${r.cc}`);

// W4 上游逐日檔 500 → 退回同日舊名冊(200),內容逐字相同
mode = 'day-500';
r = await call();
ck(r.status === 200 && JSON.stringify(r.body) === JSON.stringify(good), `上游 500 → 退回同日舊名冊(內容逐字相同)`);
ck(/s-maxage=300/.test(r.cc || ''), `退舊值時快取只給 5 分鐘:${r.cc}`);

// W5 清單頁 500 → 一樣退舊值
mode = 'list-500';
r = await call();
ck(r.status === 200 && r.body.count === 120, `清單頁 500 → 仍退回舊名冊`);

// W6 空名冊沒有污染快取:回到 day-empty,應該仍然退**舊的好名冊**而不是空的
mode = 'day-empty';
r = await call();
ck(r.status === 200 && r.body.count === 120, `空回應沒有污染 mem(仍是 120 班,不是 0 班)`);

srv.close();
console.log(fail ? `\nFAIL ${fail}` : '\n✅ worker 側全部通過');
process.exit(fail ? 1 : 0);
