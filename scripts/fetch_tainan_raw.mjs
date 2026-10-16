// 台南歷史重播（memories/tainan-YYYY-MM-DD）的原始資料存檔。
// 每次執行都寫進輸出資料夾底下新的子資料夾 <種類>-<台北時間>，不覆蓋既有檔案；子資料夾附 SHA256SUMS、
// DOWNLOADED_AT 與 SUMMARY.json（檢查過的筆數、時間範圍）。
//   ods：臺鐵 ODS 逐日班表（清單頁的 exceptionDataResource）＋車站基本資料。逐日檔在日期過後會從清單下架，
//        要在當天晚上到隔天清晨之間抓。
//   tdx：TDX 歷史 LiveTrainDelay（逐日全台鐵逐站事件，約隔天釋出）。抓法同 build_pass_obs.mjs。
//   d1 ：railisland-delay-history 的 tra_station_events，匯出當天與隔天兩個 service_date（跨午夜的車次
//        記在隔天）。保留 365 天（worker.js STATION_EVENT_KEEP_DAYS），不急。
// 用法：node scripts/fetch_tainan_raw.mjs --date 2026-10-23 ods tdx d1 [--out 資料夾] [--wrangler 執行檔]
//   --out 預設是主樹的 .cache/tainan-<MMDD>-raw；TDX 憑證讀主樹的 .env；d1 需要 wrangler（--wrangler 或 WRANGLER）。
// 結束碼：0 全部成功；2 參數錯；3 資料還沒釋出或不完整（晚點再跑，會寫進新的子資料夾）；1 其他失敗。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const date = opt('--date');
const kinds = argv.filter((a, i) => ['ods', 'tdx', 'd1'].includes(a) && !argv[i - 1]?.startsWith('--'));
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !kinds.length) {
  console.error('用法：node scripts/fetch_tainan_raw.mjs --date YYYY-MM-DD ods|tdx|d1 ...'); process.exit(2);
}
const repo = path.resolve(import.meta.dirname, '..');
const mainRoot = path.dirname(execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {encoding: 'utf8'}).trim());
const outRoot = opt('--out') ?? path.join(mainRoot, '.cache', `tainan-${date.slice(5, 7)}${date.slice(8, 10)}-raw`);
const ymd = date.replaceAll('-', '');
const nextDay = new Date(Date.parse(date + 'T00:00:00Z') + 86400e3).toISOString().slice(0, 10);
const twNow = () => new Date(Date.now() + 8 * 3600e3).toISOString();
const stamp = twNow().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
class NotYet extends Error {}

async function get(url, init = {}) {
  for (let a = 0; a < 5; a++) {
    let r;
    try { r = await fetch(url, {...init, signal: AbortSignal.timeout(180e3)}); }
    catch (e) { console.log(`  ${url} 連線失敗（${e.message}），等 ${15 * (a + 1)}s`); await sleep(15e3 * (a + 1)); continue; }
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    if (![429, 500, 502, 503, 504].includes(r.status)) {
      const body = (await r.text()).slice(0, 300);
      throw Object.assign(Error(`${url} HTTP ${r.status} ${body}`), {status: r.status, body});
    }
    console.log(`  ${url} HTTP ${r.status}，等 ${15 * (a + 1)}s`); await sleep(15e3 * (a + 1));
  }
  throw Error(`${url} 重試耗盡`);
}

// 先在暫存子資料夾收齊、驗過，最後才改名成正式名稱；中途失敗而已經寫了檔的留在 .partial- 開頭的資料夾，不算存檔。
async function saveRun(kind, fn) {
  fs.mkdirSync(outRoot, {recursive: true});
  let n = 1, name;
  do { name = `${kind}-${stamp}${n > 1 ? '-' + n : ''}`; n++; }
  while (fs.existsSync(path.join(outRoot, name)) || fs.existsSync(path.join(outRoot, '.partial-' + name)));
  const final = path.join(outRoot, name), tmp = path.join(outRoot, '.partial-' + name);
  fs.mkdirSync(tmp);
  const files = [], put = (name, buf) => { fs.writeFileSync(path.join(tmp, name), buf, {flag: 'wx'}); files.push([name, buf]); };
  let summary;
  try { summary = await fn(put); }
  catch (e) { if (!files.length) fs.rmdirSync(tmp); throw e; }
  put('DOWNLOADED_AT', Buffer.from(`downloaded ${twNow().slice(0, 19).replace('T', ' ')} +0800\n`));
  put('SUMMARY.json', Buffer.from(JSON.stringify({date, kind, ...summary}, null, 1) + '\n'));
  fs.writeFileSync(path.join(tmp, 'SHA256SUMS'), files.map(([n, b]) => `${sha(b)}  ${n}\n`).join(''), {flag: 'wx'});
  fs.renameSync(tmp, final);
  console.log(JSON.stringify({kind, dir: final, ...summary}));
}

async function ods(put) {
  const B = 'https://ods.railway.gov.tw/tra-ods-web/ods/download/dataResource';
  const list = await get(`${B}/railway_schedule/JSON/list`), html = list.toString('utf8');
  const m = html.match(new RegExp(`<td>([0-9: -]{19})</td>\\s*<td><a href="[^"]*exceptionDataResource/([0-9a-f]+)">${ymd}\\.json</a>`));
  if (!m) {
    const listed = [...html.matchAll(/>(\d{8})\.json</g)].map(x => x[1]).sort();
    if (listed.length && ymd < listed[0]) throw Error(`${ymd}.json 已從清單下架（清單最早 ${listed[0]}）`);
    throw new NotYet(`清單裡還沒有 ${ymd}.json`);
  }
  const day = await get(`${B}/exceptionDataResource/${m[2]}`), j = JSON.parse(day.toString('utf8'));
  if (!Array.isArray(j.TrainInfos) || j.TrainInfos.length < 500 || !j.UpdateTime) throw Error(`${ymd}.json 內容不像逐日班表`);
  const st = await get(`${B}/0518b833e8964d53bfea3f7691aea0ee`), sj = JSON.parse(st.toString('utf8'));
  if (!Array.isArray(sj) || !sj.some(s => s.stationCode === '4220')) throw Error('車站資料沒有臺南（4220）');
  put('list.html', list); put(`${ymd}.json`, day); put('stations.json', st);
  const atTainan = j.TrainInfos.filter(t => t.TimeInfos?.some(x => x.Station === '4220')).length;
  return {listRowTime: m[1], resourceId: m[2], updateTime: j.UpdateTime, trains: j.TrainInfos.length, trainsAtTainan: atTainan, stations: sj.length};
}

function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) if (line.includes('=') && !line.trim().startsWith('#')) {
    const i = line.indexOf('='); out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

async function tdx(put) {
  const e = readEnv(path.join(mainRoot, '.env'));
  const r = await fetch('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', {
    method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type: 'client_credentials', client_id: e.TDX_CLIENT_ID, client_secret: e.TDX_CLIENT_SECRET}),
  });
  if (!r.ok) throw Error('TDX auth ' + r.status);
  const tok = (await r.json()).access_token;
  // 當天或未來的日期回 400「只能查詢過去日期」；已過去但還沒釋出的回 200 空內容（2026-10-17 實測）
  const buf = await get(`https://tdx.transportdata.tw/api/historical/v2/Historical/Rail/TRA/LiveTrainDelay?Dates=${date}&$top=1000000&$format=JSONL`, {headers: {authorization: 'Bearer ' + tok}})
    .catch(e => { throw e.status === 400 && e.body?.includes('過去日期') ? new NotYet(`TDX 只收過去日期，${date} 還不能查`) : e; });
  const rows = buf.toString('utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l.replace(/^﻿/, '')));
  if (!rows.length) throw new NotYet(`TDX 還沒釋出 ${date}`);
  const src = rows.map(x => x.SrcUpdateTime).filter(Boolean).sort();
  // 平常一天 7.2～7.5 萬筆（build_pass_obs.mjs）；明顯偏少多半是還沒釋出完整，先存下來但要求晚點重抓
  if (rows.length < 50000) { put(`tdx-LiveTrainDelay-${date}.jsonl`, buf); throw new NotYet(`TDX ${date} 只有 ${rows.length} 筆，疑似不完整`); }
  put(`tdx-LiveTrainDelay-${date}.jsonl`, buf);
  return {rows: rows.length, trains: new Set(rows.map(x => x.TrainNo)).size, srcUpdateMin: src[0], srcUpdateMax: src.at(-1)};
}

async function d1(put) {
  const bin = opt('--wrangler') ?? process.env.WRANGLER;
  if (!bin) throw Error('d1 需要 --wrangler <wrangler 執行檔>（不要用 npx wrangler，見 AGENTS.md）');
  const out = {};
  for (const d of [date, nextDay]) {
    const raw = execFileSync(bin, ['d1', 'execute', 'railisland-delay-history', '--remote', '--json', '--command',
      `SELECT * FROM tra_station_events WHERE service_date='${d}' ORDER BY obs_at, train_no, sta, status`],
      {cwd: repo, maxBuffer: 512 * 1024 * 1024});
    const j = JSON.parse(raw.toString('utf8'));
    if (!j[0]?.success || !Array.isArray(j[0].results)) throw Error(`D1 ${d} 回應不成功`);
    const res = j[0].results;
    put(`d1-tra_station_events-${d}.json`, raw);
    out[d] = {rows: res.length, obsMin: res[0]?.obs_at ?? null, obsMax: res.at(-1)?.obs_at ?? null};
  }
  if (!out[date].rows) throw new NotYet(`D1 沒有 ${date} 的事件`);
  return {exportedAt: twNow().slice(0, 19), serviceDates: out};
}

let failed = false, notYet = false;
for (const k of kinds) {
  try { await saveRun(k, {ods, tdx, d1}[k]); }
  catch (e) { console.error(`${k}：${e.message}`); if (e instanceof NotYet) notYet = true; else failed = true; }
}
process.exit(failed ? 1 : notYet ? 3 : 0);
