// 查「街道底圖(OpenFreeMap)的健康判定失敗、也就是 L2 退場」多常發生。
//
// 為什麼需要這支:App 判定 OFM 上場後 8 秒內載不出來(或連錯 4 次)就當場退回 Stadia raster,整個
// session 都留在計費底圖上;網站則跳「街道底圖載入異常」。2026-09-03 之前這件事只在使用者的 console
// 留一行 warn,全體使用者裡有多少人正在燒 Stadia 一個數字都沒有(使用者自己的手機在 WiFi 上就中過一次)。
// 現在 index.html 的 ofmFailBeacon 在 fail 那一刻打一發 /api/basemap-fallback,Worker 寫一筆
// railisland_usage(blob1='ofmfail',blob2=裝置 m|d,blob3=來源 app|web,blob4=原因 slow|error|na,double1=zoom)。
//
// 分母從 railisland_traffic 拿:
//   App  = /api/basemap-src 的 app 請求數——App 每次開機都打一次(L1 遠端開關),等於開機數。
//   網頁 = /api/basemap-token 的 web 請求數——網站每次進站要一次 Esri token;瀏覽器會快取 5 分鐘,
//          所以這是「近似的進站數」,同一人 5 分鐘內重整不會重複計。
// 兩者相除就是「每次開機(進站)的退場率」。
//
// 用法:node scripts/usage_ofm_fallback.mjs [--hours=24] [--sql]
// 憑證同 usage_split.mjs(CLOUDFLARE_API_TOKEN,或 wrangler 已登入的 OAuth token)。
import { requireTokens, makeClient, parseHours, n, pad, padL } from './lib/cf_analytics.mjs';

const USAGE = 'railisland_usage', TRAFFIC = 'railisland_traffic';
const args = process.argv.slice(2);
const hours = parseHours(args);
const showSql = args.includes('--sql');
const { aeSql } = makeClient(requireTokens());

// _sample_interval 是 AE 的取樣權重,必須加總它才是真實筆數(直接 count() 會低估)。
// AVG(double1) 是未加權平均——這種列一天幾筆到幾十筆,AE 對稀疏的 index 幾乎不取樣,先夠用。
const SQL_FAIL = `SELECT blob3 AS plat, blob2 AS dev, blob4 AS why, SUM(_sample_interval) AS n, AVG(double1) AS z
FROM ${USAGE}
WHERE timestamp > NOW() - INTERVAL '${hours}' HOUR AND blob1 = 'ofmfail'
GROUP BY plat, dev, why
ORDER BY n DESC`;
const SQL_DENOM = `SELECT blob1 AS plat, blob2 AS endpoint, SUM(_sample_interval) AS req
FROM ${TRAFFIC}
WHERE timestamp > NOW() - INTERVAL '${hours}' HOUR AND blob2 IN ('basemap-src', 'basemap-token', 'basemap-fallback')
GROUP BY plat, endpoint`;

if (showSql) console.log(SQL_FAIL + '\n\n' + SQL_DENOM + '\n');
const fails = await aeSql(SQL_FAIL);
const denom = await aeSql(SQL_DENOM);

const byPlat = { app: 0, web: 0 };
for (const r of fails) byPlat[r.plat === 'app' ? 'app' : 'web'] += Number(r.n);
const hit = (plat, ep) => denom.filter(r => r.plat === plat && r.endpoint === ep).reduce((s, r) => s + Number(r.req), 0);
const boots = hit('app', 'basemap-src'), visits = hit('web', 'basemap-token');
const beacons = { app: hit('app', 'basemap-fallback'), web: hit('web', 'basemap-fallback') };
const pct = (a, b) => b > 0 ? (a / b * 100).toFixed(2) + '%' : 'n/a';
const platName = p => p === 'app' ? 'App 殼' : p === 'web' ? '網頁' : p;

console.log(`\n過去 ${hours} 小時的街道底圖退場（OpenFreeMap 健康判定失敗；分子 ${USAGE}，分母 ${TRAFFIC}）\n`);
console.log(`  ${pad('來源', 8)}${padL('退場次數', 10)}${padL('分母', 12)}  ${pad('分母定義', 24)}${padL('退場率', 9)}`);
console.log(`  ${pad('App 殼', 8)}${padL(n(byPlat.app), 10)}${padL(n(boots), 12)}  ${pad('basemap-src（＝開機數）', 24)}${padL(pct(byPlat.app, boots), 9)}`);
console.log(`  ${pad('網頁', 8)}${padL(n(byPlat.web), 10)}${padL(n(visits), 12)}  ${pad('basemap-token（≈進站數）', 24)}${padL(pct(byPlat.web, visits), 9)}`);

if (!fails.length) {
  console.log('\n  這段時間沒有任何退場紀錄。');
  if (!denom.length) console.log('  分母也是空的——若埋點才剛上線，要等正式站部署後才會開始寫入（AE 資料不回溯）。');
} else {
  console.log(`\n  ${pad('來源', 8)}${pad('裝置', 9)}${pad('原因', 7)}${padL('次數', 8)}${padL('平均 zoom', 11)}`);
  for (const r of fails) {
    console.log(`  ${pad(platName(r.plat), 8)}${pad(r.dev === 'm' ? '手機 UA' : '桌機 UA', 9)}${pad(r.why, 7)}${padL(n(r.n), 8)}${padL(Number(r.z).toFixed(1), 11)}`);
  }
}
// 交叉核對:同一件事 TRAFFIC 也會按端點記到一筆請求。兩邊應相近;USAGE 那邊偏少＝被限流(429 不寫)
// 或 USAGE 綁定缺席;TRAFFIC 偏少通常是邊緣層先擋掉了。
console.log(`\n  交叉核對：${TRAFFIC} 記到的 basemap-fallback 請求 App ${n(beacons.app)}／網頁 ${n(beacons.web)}（應與上表退場次數相近）`);
console.log('  註：原因 slow＝上場後 8 秒內沒有 load 事件（OFM 半死時是慢不是錯）；error＝連續 4 次 GL error；na＝沒帶原因。');
console.log('      App 每中一次＝那個 session 之後的街道圖磚全部走 Stadia 計費，直到重開 App。\n');
