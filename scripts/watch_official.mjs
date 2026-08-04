#!/usr/bin/env node
// 官方資訊每日巡檢(偵測層)。**純唯讀、零判斷**——只回答「什麼變了、變多少」,
// 不回答「該怎麼辦」。判斷交給排程任務(processing layer)的模型,判斷結果一律要使用者點頭。
//
// 起因:2026-08-01 三鶯線營運時段由 10:00-20:00 延長為 08:00-22:00,使用者是自己看到新聞才想起來的。
//   同一輪順手實測發現破口更大:data/tdx/*.json 是 2026-07-16 手動抓的快照,凍在 repo 裡,
//   當天北捷 684 筆記錄已有 265 筆班表實質不同(R02 平日下行 55→58 班)——網站跑著兩週前的班表。
//
// 用法:
//   node scripts/watch_official.mjs                 # 巡檢並回報(不寫基準)
//   node scripts/watch_official.mjs --accept        # 把當前現況收為新基準(處理完變動後跑)
//   node scripts/watch_official.mjs --json <path>   # 另外寫一份機器可讀報告
//   node scripts/watch_official.mjs --only tdx|news|tra
// 離開碼:0=無變動 10=有變動待處理 1=探針自己壞了(網路/憑證/解析)
//
// 基準存 .cache/watch/state.json(.gitignore 與 .assetsignore 都已含 .cache,不會進版控也不會上線)。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = path.join(ROOT, '.cache', 'watch');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

// ── 來源表:新增系統就加一列 ────────────────────────────────────────────────
// 一律盯「最新消息列表頁」,不要釘死內容頁——2026-08-01 的教訓:三鶯線內容頁 node=863
// 到延長生效當天都還掛著舊的 10:00-20:00,而列表頁 node=10003 在 07-30 就貼出公告了。
// render:'browser' = 該站列表由 JS 產生,純 fetch 拿不到(實測北捷/高捷/桃捷/高鐵皆是)。
const SOURCES = [
  { id: 'ntmetro', name: '新北捷運(三鶯/淡海/安坑/環狀)', url: 'https://www.ntmetro.com.tw/basic/?node=10003', render: 'fetch' },
  { id: 'trtc', name: '台北捷運', url: 'https://www.metro.taipei/', render: 'browser' },
  { id: 'krtc', name: '高雄捷運(含輕軌)', url: 'https://www.krtc.com.tw/', render: 'browser' },
  { id: 'tymc', name: '桃園機捷', url: 'https://www.tymetro.com.tw/tymetro-new/tw/index.php', render: 'browser' },
  { id: 'tmrt', name: '台中捷運', url: 'https://www.tmrt.com.tw/announcement/latest-news', render: 'fetch' },
  { id: 'tra', name: '台鐵', url: 'https://www.railway.gov.tw/tra-tip-web/tip/tip009/tip911/newsList', render: 'fetch' },
  { id: 'thsr', name: '台灣高鐵', url: 'https://www.thsrc.com.tw/ArticleContent/6f0648a4-2e78-4a57-b669-44acd8e2daea', render: 'browser' },
  { id: 'afr', name: '阿里山林鐵', url: 'https://afrch.forest.gov.tw/AllNews', render: 'fetch' },
];

// ── TDX 監看集 ────────────────────────────────────────────────────────────
// schedule 類:只餵 build_metro_times.mjs,重建不動路線幾何/站序 → 可走自動路徑。
// structure 類:改到會牽動線檔與其後處理(站位修正等),一律停下通知,不自動重建。
const TDX_OPS = ['TRTC', 'KRTC', 'KLRT', 'TMRT', 'TYMC', 'NTDLRT', 'NTALRT', 'NTMC'];
const TDX_SETS = [
  ['StationTimeTable', 'schedule'], ['Frequency', 'schedule'], ['FirstLastTimetable', 'schedule'],
  ['Line', 'structure'], ['Station', 'structure'], ['StationOfLine', 'structure'],
  ['S2STravelTime', 'structure'], ['Shape', 'structure'],
];
// TDX 每次回傳都會動的欄位。**不剔除就是天天假警報**:2026-08-01 實測北捷含這些欄位與剔除後
// 都不同(那天是真變動),但多數日子只有這些在跳。
const VOLATILE = new Set(['UpdateTime', 'SrcUpdateTime', 'VersionID', 'SrcVersionID']);

// ── 小工具 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const hasFlag = f => argv.includes(f);
const flagVal = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const ONLY = flagVal('--only');
const want = kind => !ONLY || ONLY === kind;
// 指紋必須正規化到「同內容 → 同 hash」,否則天天假警報。兩層雜訊都踩過(2026-08-01):
//   (1) 欄位層:UpdateTime 這類每次都動的欄位 → VOLATILE 剔除;
//   (2) 陣列層:TDX 同樣的 296 筆記錄會以不同順序回傳(當天 KRTC 逐筆比對 0/296 筆實質不同,
//       但整包 hash 不同)→ 逐筆序列化後排序再 hash。key 順序也一併固定。
//   (3) 內層陣列:記錄「裡面」的 Timetables/Headways 每次呼叫也會換順序(2026-08-03 實測
//       淡海/安坑 StationTimeTable,時刻值集合完全相同、只有前後對調,commit 完隔 9 分鐘
//       再跑照樣報「有變」)。這兩個欄位是集合語意(同一站的各班車),排序不會蓋掉真變動;
//       Shape/StationOfLine 那種順序即語意的陣列**不可**排,所以只按欄位名排,不全域排。
const ORDER_FREE = new Set(['Timetables', 'Headways']);
const sortRecs = a => a.map(x => JSON.stringify(x)).sort().map(s => JSON.parse(s));
const canon = (v, key) => {
  if (Array.isArray(v)) {
    const a = v.map(x => canon(x));
    return ORDER_FREE.has(key) ? sortRecs(a) : a;
  }
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) if (!VOLATILE.has(k)) o[k] = canon(v[k], k);
    return o;
  }
  return v;
};
const stable = o => (Array.isArray(o) ? o.map(r => JSON.stringify(canon(r))).sort().join('\n')
  : JSON.stringify(canon(o)));
const md5 = o => createHash('md5').update(typeof o === 'string' ? o : stable(o)).digest('hex');
const readState = () => { try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { news: {}, tdx: {} }; } };
const J = f => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));

const report = { ranAt: new Date().toISOString(), tdx: { changed: [], errors: [], firstRun: [] },
  news: { newItems: [], errors: [], firstRun: [] }, tra: null, verdict: 'clean' };
const state = readState();

// ═══════════════ 探針一:TDX 機讀資料 ═══════════════
async function tdxToken() {
  const env = {};
  for (const ln of readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const t = ln.trim();
    if (t && !t.startsWith('#') && t.includes('=')) { const [k, ...v] = t.split('='); env[k] = v.join('=').trim().replace(/^["']|["']$/g, ''); }
  }
  if (!env.TDX_CLIENT_ID || !env.TDX_CLIENT_SECRET) throw new Error('.env 缺 TDX_CLIENT_ID/TDX_CLIENT_SECRET');
  const r = await fetch('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.TDX_CLIENT_ID, client_secret: env.TDX_CLIENT_SECRET }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`TDX 取 token 失敗 ${r.status}`);
  return (await r.json()).access_token;
}

// 把一份 StationTimeTable/Frequency 攤成「(站,路線,方向,營運日) → 班次數」,用來描述變動幅度。
// 描述用,不是判準——判準在 verify_metro_times.mjs(它比的是重建後的產物)。
const recKey = r => [r.StationID ?? r.LineID ?? r.RouteID ?? '?', r.RouteID ?? '', r.Direction ?? '',
  (r.ServiceDay || {}).ServiceTag ?? ''].join('/');
function countsOf(rows) {
  const m = {};
  if (!Array.isArray(rows)) return m;
  for (const r of rows) m[recKey(r)] = (r.Timetables || r.Headways || []).length;
  return m;
}

// 「班次數沒變但指紋不同」有兩種完全不同的成因,不分開講報表就只是「0 筆變了」讓人一頭霧水:
//   (a) TDX 改了資料格式(2026-08-01 實測:淡海/環狀線的 Timetables 多出 ArrivalTime 欄位,
//       68/68、50/50 筆全變,但一班車都沒增減)——重抓一次就消失,不是改點;
//   (b) 時刻值真的動了(同日機捷 Frequency 的 OperationTime.EndTime 00:29→00:28)——這才是改點。
function diffKind(live, snap) {
  const fields = o => { const s = new Set(); const walk = v => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const k of Object.keys(v)) { if (!VOLATILE.has(k)) { s.add(k); walk(v[k]); } } }; walk(o); return s; };
  const fl = fields(live), fs = fields(snap);
  const added = [...fl].filter(k => !fs.has(k)), removed = [...fs].filter(k => !fl.has(k));
  const ms = new Map((snap || []).map(r => [recKey(r), r]));
  let valueChanged = 0;
  // 與 canon 的 ORDER_FREE 同一個理由:內層順序會抖,排過再比才問得出「時刻值真的動了嗎」
  const times = o => JSON.stringify((o.Timetables || o.Headways || [])
    .map(t => JSON.stringify([t.DepartureTime, t.ArrivalTime ?? null, t.StartTime, t.EndTime])).sort());
  for (const r of live || []) { const b = ms.get(recKey(r)); if (b && times(r) !== times(b)) valueChanged++; }
  return { fieldsAdded: added, fieldsRemoved: removed, valueChanged };
}

async function probeTdx() {
  const token = await tdxToken();
  // TDX 會限流(2026-08-01 首跑 350ms 間隔就被 429 掉 7 個端點)。fetch_tdx.py 用 1.2s,照抄,
  // 並對 429 退避重試——被限流的端點會靜靜地變成「今天沒驗到」,那正是這支腳本要防的漏。
  // 限流不只回 429,連打之後會直接斷連(undici 吐 `fetch failed`)——兩種都要退避重試,
  // 否則失敗會靜靜地變成「今天沒驗到這個端點」,那正是這支腳本要防的漏。
  const get = async p => {
    for (let attempt = 0; ; attempt++) {
      let r;
      try {
        r = await fetch(`https://tdx.transportdata.tw/api/basic/v2/${p}?$format=JSON&$top=100000`,
          { headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(120000) });
      } catch (e) {
        if (attempt < 3) { await new Promise(s => setTimeout(s, 8000 * (attempt + 1))); continue; }
        throw new Error(String(e.message || e));
      }
      if (r.ok) return r.json();
      if ((r.status === 429 || r.status >= 500) && attempt < 3) { await new Promise(s => setTimeout(s, 8000 * (attempt + 1))); continue; }
      throw new Error(`HTTP ${r.status}`);
    }
  };
  for (const op of TDX_OPS) {
    for (const [set, cls] of TDX_SETS) {
      const key = `${op}_${set}`;
      const snapPath = path.join(ROOT, 'data', 'tdx', `${key}.json`);
      if (!existsSync(snapPath)) continue; // 這個系統沒有這份資料(如 TMRT 無 StationTimeTable)
      let live;
      try { live = await get(`Rail/Metro/${set}/${op}`); }
      catch (e) { report.tdx.errors.push({ key, error: String(e.message || e) }); continue; }
      await new Promise(r => setTimeout(r, 1200)); // 對 TDX 客氣一點(同 fetch_tdx.py)
      const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
      const liveH = md5(live), snapH = md5(snap);
      // 基準優先用 state(上次巡檢時的線上指紋);沒有就用磁碟快照——這樣第一次跑就抓得到
      // 「磁碟快照早就落後線上」這種既存漂移,而不是只從今天開始比。
      const base = state.tdx[key] || snapH;
      if (liveH === base && liveH === snapH) continue;
      const lc = countsOf(live), sc = countsOf(snap);
      const diffs = Object.keys({ ...lc, ...sc })
        .filter(k => (lc[k] ?? -1) !== (sc[k] ?? -1))
        .map(k => ({ k, from: sc[k] ?? null, to: lc[k] ?? null }));
      report.tdx.changed.push({
        key, op, set, cls,
        vsDisk: liveH !== snapH,            // 線上 ≠ repo 快照 ⇒ 網站現在跑的是舊資料
        vsLastRun: liveH !== (state.tdx[key] ?? null), // 線上 ≠ 上次巡檢 ⇒ 今天剛動
        countsChanged: diffs.length, records: Object.keys(lc).length, kind: diffKind(live, snap),
        onlyLive: Object.keys(lc).filter(k => !(k in sc)).length,
        onlySnap: Object.keys(sc).filter(k => !(k in lc)).length,
        sample: diffs.slice(0, 5),
      });
      state.tdx[key] = liveH;
    }
  }
}

// ═══════════════ 探針二:官網公告列表 ═══════════════
// 通則抽取:找「像日期」的行,往前三行取第一個不是日期也不是雜訊的當標題。
// 刻意不為每家寫 DOM 解析器——網站改版時整支就廢了,通則只會少抓幾則。
const DATE_RE = /(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})|(?:^|\D)1\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/;
const NOISE_RE = /^(read more|more|詳全文|更多|＞|>|\.{3}|…|首頁|回首頁|網站導覽|:::|\d+|發布日期|日期|版權所有)$/i;

// 一行「像日期」不夠——頁尾的計數器與產生時間也含日期,且每次載入都不同,不擋就天天假警報
// (2026-08-01 突變測試當場踩到兩則:高捷「…更新日期:2026-07-18瀏覽人次:76248722」、
//  台鐵「本頁產生時間:2026/08/01 15:15:32」)。判準寫成結構性的:把日期本身挖掉之後,
// 剩下的殘渣要夠短——真的日期欄殘渣是空的或「發布日期:」這種標籤,雜訊行殘渣一定很長。
function isDateLine(s) {
  const m = s.match(DATE_RE);
  if (!m || s.length > 40) return false;
  const rest = s.replace(m[0], '').replace(/[\s:：()（）\[\]|/-]/g, '');
  return rest.length <= 6;
}

// 日期行擋掉了「一行裡自帶日期」的頁尾,擋不掉「標題行與日期行分開兩行」的頁尾樣板
// (2026-08-03 實測兩則:北捷頁尾「臺北大眾捷運股份有限公司版權所有」+「115-08-03」、
//  新北捷運頁尾「網站最後更版時間:」+「2026/08/02」)。北捷那則的日期就是當天日期,
// 不擋就是天天假警報。NOISE_RE 是整行等值比對,對「公司名+版權所有」這種串接無效,
// 故另立子字串判準:命中的行是頁尾樣板,它後面那個日期不屬於任何公告 → 整則丟掉。
const CHROME_RE = /版權所有|all rights reserved|©|網站最後更版|最後更新|更新日期|本頁產生時間|資料更新時間|瀏覽人次|到訪人次|累計人次/i;

function extractItems(text) {
  const lines = text.split('\n').map(t => t.trim()).filter(t => t.length > 1);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isDateLine(lines[i])) continue;
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
      if (DATE_RE.test(lines[j]) || NOISE_RE.test(lines[j]) || lines[j].length < 6) continue;
      // 最近的候選標題就是標題。它若是頁尾樣板,代表這個日期長在頁尾區塊裡,
      // 再往前找只會撈到地址、電話等另一種雜訊 → 直接放棄這個日期行。
      if (CHROME_RE.test(lines[j])) break;
      out.push({ date: lines[i].replace(/^發布日期[:：]\s*/, ''), title: lines[j] });
      break;
    }
  }
  return out;
}
const stripHtml = h => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#\d+;/g, ' ');

async function probeNews() {
  let browser = null;
  try {
    for (const src of SOURCES) {
      let items = [];
      try {
        if (src.render === 'browser') {
          if (!browser) { const { chromium } = await import('playwright'); browser = await chromium.launch(); }
          const pg = await browser.newPage();
          try {
            await pg.goto(src.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
            await pg.waitForTimeout(3500); // 列表多由 JS 補上,domcontentloaded 之後還要一下
            items = extractItems(await pg.evaluate(() => document.body.innerText));
          } finally { await pg.close(); }
        } else {
          const r = await fetch(src.url, { headers: { 'user-agent': UA, 'accept-language': 'zh-TW,zh;q=0.9' },
            redirect: 'follow', signal: AbortSignal.timeout(45000) });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          items = extractItems(stripHtml(await r.text()));
        }
      } catch (e) { report.news.errors.push({ id: src.id, name: src.name, error: String(e.message || e) }); continue; }
      // 抓到 0 則多半是網站改版或被擋,不是「今天沒消息」——當成探針故障回報,不要靜靜地漏掉
      if (!items.length) { report.news.errors.push({ id: src.id, name: src.name, error: '解析到 0 則(疑似改版或被擋)' }); continue; }
      const keys = items.map(it => `${it.date}|${it.title}`);
      const seen = state.news[src.id];
      if (!seen) { report.news.firstRun.push({ id: src.id, name: src.name, count: items.length }); }
      else {
        const set = new Set(seen);
        for (const it of items) if (!set.has(`${it.date}|${it.title}`)) report.news.newItems.push({ id: src.id, name: src.name, url: src.url, ...it });
      }
      state.news[src.id] = [...new Set([...keys, ...(seen || [])])].slice(0, 300);
    }
  } finally { if (browser) await browser.close(); }
}

// ═══════════════ 探針三:台鐵 14 天班表窗 ═══════════════
// 台鐵是逐日制、只抓 14 天(見 memory tra-schedule-multiday),窗尾到期就會沒有班表可推。
function probeTra() {
  const d = J('data/tra_schedule.json');
  const end = (d.dateRange || [])[1];
  if (!end) { report.tdx.errors.push({ key: 'tra_schedule', error: '讀不到 dateRange' }); return; }
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const daysLeft = Math.floor((new Date(end + 'T23:59:59+08:00') - today) / 86400000);
  report.tra = { rangeEnd: end, daysLeft, needsRefresh: daysLeft < 5 };
}

// ═══════════════ 執行 ═══════════════
let probeFailed = false;
try {
  if (want('tdx')) await probeTdx();
  if (want('news')) await probeNews();
  if (want('tra')) probeTra();
} catch (e) { probeFailed = true; report.fatal = String(e.stack || e); }

const acted = report.tdx.changed.length || report.news.newItems.length || (report.tra && report.tra.needsRefresh);
report.verdict = probeFailed ? 'probe-error' : acted ? 'action' : 'clean';

// ── 人看的摘要 ──
const hm = report;
console.log(`官方資訊巡檢 ${hm.ranAt}`);
console.log('─'.repeat(64));
if (hm.tdx.changed.length) {
  console.log(`\n▍TDX 機讀資料:${hm.tdx.changed.length} 份有變`);
  for (const c of hm.tdx.changed) {
    const tag = c.cls === 'schedule' ? '班表' : '結構';
    const k = c.kind || {};
    const why = [
      c.countsChanged ? `${c.countsChanged} 筆班次數變了` : null,
      k.valueChanged ? `${k.valueChanged} 筆時刻值變了` : null,
      (k.fieldsAdded || []).length ? `TDX 新增欄位 ${k.fieldsAdded.join('/')}(格式變動,非改點)` : null,
      (k.fieldsRemoved || []).length ? `TDX 移除欄位 ${k.fieldsRemoved.join('/')}` : null,
      c.onlyLive || c.onlySnap ? `記錄新增${c.onlyLive}/消失${c.onlySnap}` : null,
    ].filter(Boolean);
    console.log(`  [${tag}] ${c.key}  ${c.records} 筆:${why.join('、') || '內容有差但分類不出來(要人看)'}` +
      (c.vsDisk ? '  ⚠ repo 快照落後線上' : ''));
    for (const s of c.sample) console.log(`         ${s.k}  ${s.from} → ${s.to}`);
  }
} else if (want('tdx') && !probeFailed) console.log('\n▍TDX 機讀資料:與 repo 快照一致');
if (hm.news.newItems.length) {
  console.log(`\n▍官網公告:${hm.news.newItems.length} 則新的`);
  for (const n of hm.news.newItems) console.log(`  [${n.name}] ${n.date}  ${n.title}`);
} else if (want('news') && !probeFailed) console.log('\n▍官網公告:無新項目');
if (hm.news.firstRun.length) console.log(`\n▍首次建立基準(不算變動):${hm.news.firstRun.map(f => `${f.name}×${f.count}`).join('、')}`);
if (hm.tra) console.log(`\n▍台鐵班表窗:到 ${hm.tra.rangeEnd},剩 ${hm.tra.daysLeft} 天` + (hm.tra.needsRefresh ? '  ⚠ 需重抓' : ''));
if (hm.tdx.errors.length || hm.news.errors.length) {
  console.log('\n▍探針錯誤(這些來源今天沒驗到,不等於沒變):');
  for (const e of [...hm.tdx.errors, ...hm.news.errors]) console.log(`  ${e.key || e.name}: ${e.error}`);
}
if (report.fatal) console.log('\n✗ 探針中斷:\n' + report.fatal);
console.log(`\n判定:${report.verdict}`);

// --accept 才寫基準:預設「只看不收」,這樣同一天重跑兩次不會第二次就靜音。
if (hasFlag('--accept') && !probeFailed) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
  console.log(`基準已更新 → ${path.relative(ROOT, STATE_FILE)}`);
}
const jsonOut = flagVal('--json');
if (jsonOut) { mkdirSync(path.dirname(jsonOut), { recursive: true }); writeFileSync(jsonOut, JSON.stringify(report, null, 1)); }

process.exit(probeFailed ? 1 : acted ? 10 : 0);
