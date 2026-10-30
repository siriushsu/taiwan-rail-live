// AI 營運整理（P1）：每 3 分鐘掃官方公告列表與首頁燈號，偵測到營運相關變化就請 Claude 增量改寫那個系統，
// 每一版存進 D1；/api/rail-status 讀最新一版給 rail-status.html。
// 跟人工彙整（data/rail_weather_bulletin.json、weather-status.html、三個通阻端點裡的「軌島」那則）完全分開，
// 不改既有端點的輸出。schema：schema/0015_rail_ai_status.sql。原型與颱風重播在 native/build/ai-bulletin-proto/。
//
// Claude API 用 fetch 直接呼叫、不引 SDK：worker.js 沒有任何 npm 執行期相依，出貨鏈各棵 worktree 共用
// 主 repo 的 node_modules，加套件會讓還沒裝的樹出貨時打包失敗。
import manualBulletin from '../data/rail_weather_bulletin.json' with { type: 'json' };

export const RAIL_AI_SYSTEMS = [
  { id: 'tra', label: '台鐵' },
  { id: 'afr', label: '阿里山林鐵' },
  { id: 'thsr', label: '台灣高鐵' },
  { id: 'trtc', label: '台北捷運' },
  { id: 'tymc', label: '桃園機場捷運' },
  { id: 'ntmetro', label: '新北捷運（環狀、淡海、安坑、三鶯）' },
  { id: 'tmrt', label: '台中捷運' },
  { id: 'krtc', label: '高雄捷運紅橘線' },
  { id: 'klrt', label: '高雄輕軌' },
];
const SYSTEM_IDS = new Set(RAIL_AI_SYSTEMS.map(s => s.id));
export const labelOf = id => (RAIL_AI_SYSTEMS.find(s => s.id === id) || {}).label || id;

const EVERY_MIN = 3;
const MODEL = 'claude-opus-5-5';
const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 }; // US$／百萬 tokens（Opus 5.5，10-06 價目）
export const MONTHLY_CAP_USD = 60; // 這個功能（含 rail_push.mjs 的推播草稿與檢查）每月最多花多少；超過就只偵測不整理（每月 US$400 額度還要留給其他功能）
const AI_LOCK_MS = 12 * 60e3; // 一輪整理最長多久；超過視為上一輪已死、可以接手
const PAGE_CAP = 20000; // 單篇原文本文上限（字元）
const CONTEXT_CAP = 60000; // 一個系統一次送給模型的原文總量上限（字元）
const ARTICLE_WINDOW_MS = 72 * 3600e3; // 送給模型的公告只取最近 72 小時內出現的
const EVENT_KEEP_MS = 30 * 86400e3;
const SHOW_NORMAL_MS = 24 * 3600e3; // 已恢復正常的系統在頁面上再留 24 小時
const STALE_MS = 12 * 3600e3; // 還沒恢復正常、卻這麼久沒有新整理的，頁面提醒現況可能已經改變
const LAG_MS = 10 * 60e3; // 偵測到新變化超過這麼久還沒整理進來，頁面提醒先看官方
const MAX_FAILS = 3; // 同一系統連續失敗這麼多次就停手，等下一個新變化再試
const REFETCH_PER_ROUND = 3; // 每輪補抓幾則之前抓不到內文的公告
const RELEVANT = /颱風|停駛|停止|暫停|恢復|復駛|班距|營運|異常|中斷|延誤|搶修|事故|地震|豪雨|慢速|降速|加開|加班車|疏運|改點|取消/;

export const pageText = html => html
  .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/\s+/g, ' ').trim();

// 列表頁：抓符合 href 規則的連結，key＝絕對網址，值＝標題（同一網址多個連結取最長的文字）
function listItems(html, hrefRe, base) {
  const items = {};
  for (const m of html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].replace(/&amp;/g, '&');
    if (!hrefRe.test(href)) continue;
    const url = new URL(href, base).href;
    const title = pageText(m[2]);
    if (!items[url] || title.length > items[url].length) items[url] = title.slice(0, 200);
  }
  return items;
}

// 臺鐵官網 2026-07-01 起改用 www.trc.com.tw，舊網址 www.railway.gov.tw 2027-01-01 停用（官網 2026-05-20 公告）。
// 換網域前存進 D1 的網址（列表基準、已存原文）視同新網域，不然換網域那一輪整頁公告都會被當成新公告排整理。
const TRA_OLD = 'https://www.railway.gov.tw/', TRA_NEW = 'https://www.trc.com.tw/';
const traNew = u => u.startsWith(TRA_OLD) ? TRA_NEW + u.slice(TRA_OLD.length) : u;

// 只收 Worker 抓得到內容的來源（10-24 從 Cloudflare 實測 200）。高捷、中捷、桃捷的列表要跑 JavaScript 才有內容，
// 臉書是登入牆，這幾家目前只能靠 TDX 公告。
export const RAIL_AI_SOURCES = [
  { id: 'tra-list', system: 'tra', kind: 'list', url: 'https://www.trc.com.tw/tra-tip-web/tip/tip009/tip911/newsList',
    parse: (h, u) => listItems(h, /newsDtl\?newsNo=[0-9a-f]+/, u) },
  { id: 'trtc-list', system: 'trtc', kind: 'list', url: 'https://www.metro.taipei/News.aspx?n=30CCEFD2A45592BF&sms=72544237BBE4C5F6',
    parse: (h, u) => listItems(h, /News_Content\.aspx\?n=30CCEFD2A45592BF/, u) },
  { id: 'afr-list', system: 'afr', kind: 'list', url: 'https://afrch.forest.gov.tw/AllNews',
    parse: (h, u) => listItems(h, /^\/AllNews\/\d+$/, u) },
  { id: 'thsr-home', system: 'thsr', kind: 'list', url: 'https://www.thsrc.com.tw/',
    parse: (h, u) => listItems(h, /ArticleContent\/[0-9a-f-]{36}/, u) },
  { id: 'ntmetro-home', system: 'ntmetro', kind: 'status', url: 'https://www.ntmetro.com.tw/',
    parse: h => {
      const t = pageText(h);
      const status = ((t.match(/營運狀況(.*?)公司簡介/) || [])[1] || '').trim();
      const marquee = pageText((h.match(/<div[^>]*id="home-marquee"[\s\S]*?<\/div>\s*<\/div>/) || [''])[0]);
      return status ? { 營運狀況: status, 跑馬: marquee } : {};
    } },
];

// TDX 通阻公告 → 系統。來源是 worker.js 的三個端點（sysLabel 見 METRO_ALERT_OPS）。
const TDX_SYSTEM = { tra: 'tra', thsr: 'thsr' };
const METRO_LABEL_SYSTEM = { '台北捷運': 'trtc', '高雄捷運': 'krtc', '高雄輕軌': 'klrt', '桃園機捷': 'tymc', '台中捷運': 'tmrt' };
const TDX_SYSTEMS = [...Object.values(TDX_SYSTEM), ...Object.values(METRO_LABEL_SYSTEM)];
// 只回這一輪確定拿得到的系統：端點失敗（null）整個跳過；捷運端點某一家查失敗時那家是空的，跟「沒有公告」分不出來，
// 所以捷運系統至少要有一筆（含例行「正常營運」）才算拿到。例行正常留著，值以 [1] 開頭：恢復時它是唯一的正向訊號。
function tdxItems(alerts) {
  const bySystem = {};
  for (const [ep, list] of Object.entries(alerts || {})) {
    if (!Array.isArray(list)) continue;
    if (TDX_SYSTEM[ep]) bySystem[TDX_SYSTEM[ep]] ||= {};
    for (const a of list) {
      if (!a || a.bulletin || a.sysLabel === '軌島') continue; // 自己寫的彙整不算
      const sys = TDX_SYSTEM[ep] || METRO_LABEL_SYSTEM[a.sysLabel];
      if (!sys) continue;
      const key = [a.sysLabel || ep, a.title || '', (a.lines || []).join('、'), a.start || ''].join('｜');
      (bySystem[sys] ||= {})[key] = `[${a.status}] ${a.desc || a.title || ''}`.slice(0, 2000);
    }
  }
  return bySystem;
}
const routineNormal = v => /^\[1\]/.test(v); // TDX 例行「正常營運」：本身出現或消失都不算變化，非正常那筆消失才算

const twTime = ms => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).slice(0, 16);
export const monthKey = ms => 'spend:' + new Date(ms + 8 * 3600e3).toISOString().slice(0, 7);

export async function kvGet(db, k) {
  const row = await db.prepare('SELECT v FROM rail_ai_kv WHERE k = ?').bind(k).first();
  return row ? JSON.parse(row.v) : null;
}
export const kvPut = (db, k, v, now) => db.prepare('INSERT INTO rail_ai_kv (k, v, updated_ms) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_ms = excluded.updated_ms')
  .bind(k, JSON.stringify(v), now);

async function getText(fetchImpl, url) {
  const r = await fetchImpl(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; RailIsland/1.0; +https://railisland.tw)' }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

// ── 偵測：抓每個來源、跟上一輪比，記下變化；營運相關的變化把系統標成待整理 ──────────────────────
export async function railAiDetect(env, { now = Date.now(), fetch: fetchImpl = fetch, alerts = null } = {}) {
  const db = env.DELAY_DB;
  const events = [], errors = [], newArticles = [];
  const results = await Promise.all(RAIL_AI_SOURCES.map(async s => {
    try {
      const items = s.parse(await getText(fetchImpl, s.url), s.url);
      if (!Object.keys(items).length) throw new Error('解析不到內容（版面可能改了）');
      return { s, items };
    } catch (e) { errors.push(`${s.id}: ${e.message}`); return null; }
  }));
  const tdx = alerts ? tdxItems(alerts) : null;
  const sources = results.filter(Boolean);
  // TDX 只比這一輪確定拿到的系統（什麼時候會傳進來見 railAiScheduled）
  if (tdx) for (const sys of Object.keys(tdx))
    sources.push({ s: { id: 'tdx-' + sys, system: sys, kind: 'alert' }, items: tdx[sys] });
  const isRelevant = (s, k, v) => s.kind === 'list' ? RELEVANT.test(k + v) : s.kind === 'alert' ? !routineNormal(v) : RELEVANT.test(k + v);
  // 列表上「新出現」的網址如果以前就存過（被擠下去又回來），不算新公告
  const candidates = [];
  for (const { s, items } of sources) if (s.kind === 'list') for (const u of Object.keys(items))
    candidates.push(u, ...(u.startsWith(TRA_NEW) ? [TRA_OLD + u.slice(TRA_NEW.length)] : []));
  const known = new Set();
  for (let i = 0; i < candidates.length; i += 50) {
    const part = candidates.slice(i, i + 50);
    for (const r of (await db.prepare(`SELECT url FROM rail_ai_articles WHERE url IN (${part.map(() => '?').join(',')})`).bind(...part).all()).results) known.add(traNew(r.url));
  }

  const writes = [];
  for (const { s, items } of sources) {
    const stored = await kvGet(db, 'src:' + s.id);
    const prev = stored && Object.fromEntries(Object.entries(stored).map(([k, v]) => [traNew(k), v]));
    writes.push(kvPut(db, 'src:' + s.id, items, now));
    if (!prev) { // 第一次看到這個來源（剛上線、或第一次拿到 TDX）：記基準。上面已經有營運相關的公告或燈號，就存原文、
      // 直接整理一次——不然頁面會在官方還掛著停駛公告時顯示「沒有異常」，要等下一則新公告才補上
      const rel = Object.entries(items).filter(([k, v]) => s.kind === 'list' ? RELEVANT.test(v) : isRelevant(s, k, v));
      events.push({ source: s.id, system: s.system, type: 'baseline', key: null, value: String(Object.keys(items).length), prev: null, relevant: rel.length ? 1 : 0 });
      if (s.kind === 'list') for (const [url, title] of rel) newArticles.push({ url, system: s.system, title, relevant: 1 });
      continue;
    }
    for (const [k, v] of Object.entries(items)) {
      if (!(k in prev)) {
        const relevant = s.kind === 'list' && known.has(k) ? 0 : isRelevant(s, k, v) ? 1 : 0;
        events.push({ source: s.id, system: s.system, type: 'new', key: k, value: v, prev: null, relevant });
        if (s.kind === 'list') newArticles.push({ url: k, system: s.system, title: v, relevant });
      } else if (prev[k] !== v) {
        const relevant = isRelevant(s, k, v) || isRelevant(s, k, prev[k]) ? 1 : 0;
        events.push({ source: s.id, system: s.system, type: 'changed', key: k, value: v, prev: prev[k], relevant });
        if (s.kind === 'list') newArticles.push({ url: k, system: s.system, title: v, relevant });
      }
    }
    // 列表上的舊文章會自然被擠出頁面；只有燈號與 TDX 公告的「消失」才有意義（但消失不等於恢復，交給模型判斷）
    if (s.kind !== 'list') for (const k of Object.keys(prev)) if (!(k in items))
      events.push({ source: s.id, system: s.system, type: 'removed', key: k, value: null, prev: prev[k], relevant: s.kind === 'alert' && routineNormal(prev[k]) ? 0 : 1 });
  }

  // 新公告存原文（只存營運相關的；不相關的只記事件，不抓內文）
  await Promise.all(newArticles.filter(a => a.relevant).map(async a => {
    let text = null;
    try { text = pageText(await getText(fetchImpl, a.url)).slice(0, PAGE_CAP); }
    catch (e) { errors.push(`article ${a.url}: ${e.message}`); }
    writes.push(db.prepare(`INSERT INTO rail_ai_articles (url, system, title, relevant, first_seen_ms, fetched_ms, text) VALUES (?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET title = excluded.title, fetched_ms = excluded.fetched_ms, text = COALESCE(excluded.text, rail_ai_articles.text)`)
      .bind(a.url, a.system, a.title, now, now, text));
  }));
  // 之前抓不到內文的相關公告（官網偶爾逾時）：每輪補抓幾則，抓到就當成新資訊排整理
  const missing = (await db.prepare('SELECT url, system, title FROM rail_ai_articles WHERE relevant = 1 AND text IS NULL AND first_seen_ms > ? ORDER BY first_seen_ms DESC LIMIT ?')
    .bind(now - ARTICLE_WINDOW_MS, REFETCH_PER_ROUND).all()).results;
  await Promise.all(missing.map(async a => {
    try {
      const text = pageText(await getText(fetchImpl, a.url)).slice(0, PAGE_CAP);
      writes.push(db.prepare('UPDATE rail_ai_articles SET text = ?, fetched_ms = ? WHERE url = ?').bind(text, now, a.url));
      events.push({ source: 'refetch', system: a.system, type: 'fetched', key: a.url, value: a.title, prev: null, relevant: 1 });
    } catch (e) { errors.push(`article ${a.url}: ${e.message}`); }
  }));

  for (const e of events) writes.push(db.prepare('INSERT INTO rail_ai_events (at_ms, source, system, type, item_key, value, prev, relevant) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(now, e.source, e.system, e.type, e.key, e.value, e.prev, e.relevant));
  for (const err of errors) writes.push(db.prepare('INSERT INTO rail_ai_events (at_ms, source, system, type, item_key, value, prev, relevant) VALUES (?, ?, ?, ?, ?, ?, ?, 0)')
    .bind(now, 'detector', 'all', 'error', null, err.slice(0, 500), null));

  // 待整理的系統：每個系統一列 pending:<id>，值＝最後一次相關變化的時間。整理成功時只刪掉不晚於整理開始的，
  // 整理途中下一輪偵測到的新變化會留著（一列一系統，增刪都是單句 SQL，不會互相蓋掉）
  const dirty = [...new Set(events.filter(e => e.relevant).map(e => e.system))];
  for (const sys of dirty) writes.push(db.prepare(`INSERT INTO rail_ai_kv (k, v, updated_ms) VALUES (?, ?, ?)
    ON CONFLICT(k) DO UPDATE SET v = MAX(CAST(rail_ai_kv.v AS INTEGER), CAST(excluded.v AS INTEGER)), updated_ms = excluded.updated_ms`)
    .bind('pending:' + sys, String(now), now));
  if (writes.length) await db.batch(writes);
  return { events: events.length, relevant: events.filter(e => e.relevant && e.type !== 'baseline').length, dirty, errors };
}

// ── 整理：待整理的系統各呼叫一次 Claude，結果合成新的一版 ─────────────────────────────────────
const SYSTEM_PROMPT = `你負責軌島 App 的「即時營運整理」：把鐵道營運單位的官方原文，整理成乘客看得懂、而且不會誤導的狀態說明。這一次只更新一個系統。

原則：
- 只轉述官方原文寫明的內容，不推定。「預計」「視情況」要照原樣保留成預估，不寫成已確認。
- 寫出依據的是哪一則官方公告、發布時間；原文標題上的時刻不等於生效或發布時刻，除非原文明說。
- 被新公告取代的舊方案不能寫成現況。
- 文章消失、轉址、讀不到，都不能當作復駛或恢復正常的證據；讀不到就寫讀不到。
- 營運單位的即時狀態（TDX 通阻公告、官網首頁燈號）寫「正常營運」，可以當作目前正常營運的依據。但如果還有寫明時段、還沒結束的官方調整公告，以那則公告為準，並寫出兩邊說法不一致。
- 寫出來的車次、時刻、區間、班距照原文抄，不自行合併或四捨五入。
- 列車照常不代表附屬服務（停車場、行李託運、商品館等）都恢復；原文沒寫就不寫。
- 跟營運無關的公告（促銷、活動、招標、徵才）不寫進去。

寫法（讀者是正要出門的乘客，在手機上看）：
- detail 先講現在能不能搭、哪些路線區段或車次受影響、預計什麼時候恢復。250 字內；台鐵這類一次調整很多車次的公告最多 400 字。最多三段。
- 時刻只寫關鍵的：起訖、首末班、預計恢復，以及特開、替代、恢復的那幾班的車次與起站開車時刻。逐站時刻表不要抄，寫「各站時刻見官方公告」。
- 不要寫你的查核過程或判斷理由，例如讀取時間、哪個欄位無法核實、為什麼不採用某個時刻。原文沒寫的事直接不寫。整理時間與原文連結頁面會另外顯示。
- 舊方案與歷史只在不寫會讓人誤會時才提，一句帶過。
- 附屬服務只寫乘客會用到的，一句帶過。
- 中文用台灣用語。英文、日文版內容要跟中文版一致，不增不減。
- impacts 只列原文寫明的影響；state 用「停駛」「部分停駛」「減班或改點」「正常」「未確認」其中之一，trains 只放原文明列的車次。
- sourceUrls 只放這次實際依據、而且在下方原文裡出現過的網址。`;

const IMPACT = {
  type: 'object', additionalProperties: false, required: ['scope', 'state', 'from', 'until', 'trains'],
  properties: {
    scope: { type: 'string', description: '路線或區間，例如「基隆=彰化 對號列車」' },
    state: { type: 'string', enum: ['停駛', '部分停駛', '減班或改點', '正常', '未確認'] },
    from: { type: 'string', description: '原文寫明的開始時刻，沒寫就空字串' },
    until: { type: 'string', description: '原文寫明的結束或預計恢復時刻，沒寫就空字串' },
    trains: { type: 'array', items: { type: 'string' } },
  },
};
const ENTRY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['status', 'statusEn', 'statusJa', 'detail', 'detailEn', 'detailJa', 'sourceUrls', 'impacts'],
  properties: {
    status: { type: 'string', description: '15 字內的狀態摘要' },
    statusEn: { type: 'string' }, statusJa: { type: 'string' },
    detail: { type: 'string', description: '給乘客看的說明，250 字內（台鐵大量調整時最多 400 字）' }, detailEn: { type: 'string' }, detailJa: { type: 'string' },
    sourceUrls: { type: 'array', items: { type: 'string' } },
    impacts: { type: 'array', items: IMPACT },
  },
};

// 給模型看的官方原文：72 小時內的營運相關公告、首頁燈號、TDX 公告。推播的 AI 檢查（rail_push.mjs）也用這一份。
// urls＝這次附上的原文與這個系統的來源網址（模型只能引用這些）。
export async function sourceBlocks(db, sys, now) {
  const arts = (await db.prepare('SELECT url, title, first_seen_ms, fetched_ms, text FROM rail_ai_articles WHERE system = ? AND relevant = 1 AND first_seen_ms > ? ORDER BY first_seen_ms DESC LIMIT 8')
    .bind(sys, now - ARTICLE_WINDOW_MS).all()).results;
  let budget = CONTEXT_CAP;
  const blocks = [];
  for (const a of arts) {
    const body = a.text == null ? '（抓取失敗，讀不到內文）' : a.text.slice(0, Math.max(0, budget));
    budget -= body.length;
    blocks.push(`<source url="${a.url}" title="${(a.title || '').replace(/"/g, '\'')}" first_seen="${twTime(a.first_seen_ms)}" fetched="${twTime(a.fetched_ms)}">\n${body || '（超過本次長度上限，未附內文）'}\n</source>`);
  }
  for (const s of RAIL_AI_SOURCES.filter(x => x.system === sys && x.kind === 'status')) {
    const items = await kvGet(db, 'src:' + s.id);
    if (items) blocks.push(`<source url="${s.url}" title="官方首頁燈號與跑馬（無日期）">\n${Object.entries(items).map(([k, v]) => `${k}：${v}`).join('\n')}\n</source>`);
  }
  const tdx = await kvGet(db, 'src:tdx-' + sys);
  if (tdx && Object.keys(tdx).length) blocks.push(`<tdx>\n${Object.entries(tdx).map(([k, v]) => `${k}\n${v}`).join('\n\n')}\n</tdx>`);
  return { blocks, urls: [...arts.map(a => a.url), ...RAIL_AI_SOURCES.filter(x => x.system === sys).map(x => x.url)] };
}

async function buildPrompt(db, sys, prevEntry, now) {
  const since = prevEntry ? prevEntry.updatedAt : now - ARTICLE_WINDOW_MS;
  const ev = (await db.prepare('SELECT at_ms, source, type, item_key, value, prev FROM rail_ai_events WHERE system = ? AND relevant = 1 AND type != ? AND at_ms > ? ORDER BY at_ms DESC, id DESC LIMIT 40')
    .bind(sys, 'baseline', since).all()).results.reverse();
  const src = await sourceBlocks(db, sys, now);
  const blocks = src.blocks;

  const prevView = prevEntry && { status: prevEntry.status, detail: prevEntry.detail, sourceUrls: prevEntry.sourceUrls, updatedAt: twTime(prevEntry.updatedAt) };
  // 模型能引用的網址：這次附上的原文、首頁燈號來源，加上一版已經引用過的（沿用上一版內容時）
  const urls = new Set([...src.urls, ...((prevEntry && prevEntry.sourceUrls) || [])]);
  const text = `現在時間：${twTime(now)}（台灣時間）
系統：${sys}（${labelOf(sys)}）

${prevView ? `<previous_entry>\n${JSON.stringify(prevView, null, 1)}\n</previous_entry>` : '（這個系統之前沒有整理過，從零寫。下面的原文是目前列表上看得到的營運相關公告，first_seen 是第一次讀到的時間、不是發布時間；以原文的發布日期判斷新舊，已經過去的方案不要寫成現況。）'}

這次偵測到的變化：
${ev.length ? ev.map(e => `- ${twTime(e.at_ms)} ${e.source} ${({ new: '新出現', changed: '內容改變', removed: '消失', fetched: '補抓到內文' })[e.type] || e.type}：${e.item_key || ''} ${e.value || e.prev || ''}`.slice(0, 600)).join('\n') : '（無）'}

以下是官方原文（已去掉 HTML，可能含網站選單雜訊）：
${blocks.join('\n') || '（目前沒有可讀的官方原文）'}
${prevView ? `
請以上一版為基礎更新：
- 原文跟上一版一致的部分，沿用上一版的內容。
- 有新公告就改寫成新方案；被取代的舊方案不寫成現況，只在不寫會讓人誤會時一句帶過。
- 上一版有依據、但這次讀不到的來源，保留上一版的方案並寫明最後成功核讀的時間，不能當作已撤銷或已恢復。` : ''}`;
  return { text, urls };
}

// Messages API（串流）。只收 text 區塊；thinking 區塊不需要。
async function callClaude(env, userText, fetchImpl) {
  const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2026-10-21', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 32000, stream: true,
      output_config: { effort: 'high', format: { type: 'json_schema', schema: ENTRY_SCHEMA } },
      system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userText }],
    }),
    signal: AbortSignal.timeout(8 * 60e3),
    redirect: 'manual', // 帶 key 的請求不跟轉址（worker.js 檔頭 C-1）
  });
  if (!r.ok) throw new Error(`claude ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const decoder = new TextDecoder();
  const reader = r.body.getReader();
  const text = {}, usage = {};
  let buf = '', stop = null, model = MODEL;
  const handle = raw => {
    const line = raw.split('\n').find(l => l.startsWith('data:'));
    if (!line) return;
    const d = JSON.parse(line.slice(5));
    if (d.type === 'message_start') { Object.assign(usage, d.message.usage); model = d.message.model || model; }
    else if (d.type === 'content_block_delta' && d.delta.type === 'text_delta') text[d.index] = (text[d.index] || '') + d.delta.text;
    else if (d.type === 'message_delta') { stop = d.delta.stop_reason; Object.assign(usage, d.usage); }
    else if (d.type === 'error') throw new Error('claude stream: ' + JSON.stringify(d.error).slice(0, 300));
  };
  // 費用：串流中途斷掉（錯誤事件、逾時、連線中斷）時還沒收到最後的 output_tokens，用已收到的字數估（中文約一字一 token，偏高估）
  const costNow = () => {
    const out = Math.max(usage.output_tokens || 0, stop ? 0 : Object.values(text).join('').length);
    return ((usage.input_tokens || 0) * PRICE.input + out * PRICE.output
      + (usage.cache_creation_input_tokens || 0) * PRICE.cacheWrite + (usage.cache_read_input_tokens || 0) * PRICE.cacheRead) / 1e6;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      // 換行統一要在併進緩衝區之後做：\r\n 可能剛好被切在兩個封包之間
      buf = (buf + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 2); }
    }
    if (buf.trim()) handle(buf);
  } catch (e) { throw Object.assign(e, { cost: costNow() }); }
  const cost = costNow();
  if (stop !== 'end_turn') throw Object.assign(new Error('claude stop_reason ' + stop), { cost });
  try {
    return { entry: JSON.parse(Object.keys(text).sort((a, b) => a - b).map(k => text[k]).join('')), usage, cost, model };
  } catch (e) { throw Object.assign(new Error('claude output not JSON: ' + e.message), { cost }); }
}

// 當月花費用 SQL 累加，不用開頭讀到的值回寫（避免蓋掉別處同時寫入的；推播草稿與檢查也記在同一列）
export const addSpend = (db, cost, now) => db.prepare(`INSERT INTO rail_ai_kv (k, v, updated_ms) VALUES (?, ?, ?)
  ON CONFLICT(k) DO UPDATE SET v = CAST(CAST(rail_ai_kv.v AS REAL) + CAST(excluded.v AS REAL) AS TEXT), updated_ms = excluded.updated_ms`).bind(monthKey(now), String(cost), now);

export async function latestRevision(db) {
  const row = await db.prepare('SELECT id, at_ms, changed, systems, cost_usd, meta FROM rail_ai_revisions ORDER BY id DESC LIMIT 1').first();
  return row ? { ...row, systems: JSON.parse(row.systems), changed: JSON.parse(row.changed) } : null;
}

export async function railAiSummarize(env, { now = Date.now(), fetch: fetchImpl = fetch } = {}) {
  const db = env.DELAY_DB;
  if (!env.ANTHROPIC_API_KEY) return { skipped: 'no key' };
  const pending = new Map((await db.prepare(`SELECT k, v FROM rail_ai_kv WHERE k LIKE 'pending:%'`).all()).results.map(r => [r.k.slice(8), Number(r.v)]));
  const fails = new Map((await db.prepare(`SELECT k, v FROM rail_ai_kv WHERE k LIKE 'fail:%'`).all()).results.map(r => [r.k.slice(5), JSON.parse(r.v)]));
  const locked = new Set((await db.prepare('SELECT system FROM rail_ai_locks').all()).results.map(r => r.system));
  // 失敗退避：第 n 次失敗後等 3×2ⁿ 分鐘再試，連續 MAX_FAILS 次就停手；之後偵測到新變化（pending 比上次失敗新）才重來
  const backoff = s => { const f = fails.get(s); return f && !(pending.get(s) > f.at) && (f.n >= MAX_FAILS || now - f.at < EVERY_MIN * 60e3 * 2 ** f.n); };
  const todo = [...pending.keys()].filter(s => SYSTEM_IDS.has(s) && !locked.has(s) && !backoff(s));
  if (!todo.length) return { skipped: 'nothing pending' };
  const spent = (await kvGet(db, monthKey(now))) || 0;
  if (spent >= MONTHLY_CAP_USD) return { skipped: `monthly cap US$${MONTHLY_CAP_USD} reached` };
  // 執行鎖：上一輪還在跑（模型回應要一兩分鐘）就不重複叫
  const got = await db.prepare(`INSERT INTO rail_ai_kv (k, v, updated_ms) VALUES ('ai_lock', ?, ?)
    ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_ms = excluded.updated_ms WHERE CAST(rail_ai_kv.v AS INTEGER) < ?`)
    .bind(String(now + AI_LOCK_MS), now, now).run();
  if (!got.meta || got.meta.changes !== 1) return { skipped: 'locked by another run' };
  try {
    const prev = await latestRevision(db);
    const systems = { ...(prev ? prev.systems : {}) };
    const done = [], failed = [];
    let cost = 0;
    const t0 = Date.now();
    await Promise.all(todo.map(async sys => {
      try {
        const prompt = await buildPrompt(db, sys, systems[sys], now);
        const r = await callClaude(env, prompt.text, fetchImpl);
        cost += r.cost;
        const sourceUrls = r.entry.sourceUrls.filter(u => prompt.urls.has(u) && /^https?:\/\//.test(u));
        systems[sys] = { ...r.entry, sourceUrls, id: sys, label: labelOf(sys), updatedAt: now, model: r.model };
        done.push(sys);
      } catch (e) { cost += e.cost || 0; failed.push(`${sys}: ${String(e.message || e).slice(0, 300)}`); }
    }));
    const writes = [addSpend(db, cost, now)];
    for (const sys of done) writes.push(db.prepare('DELETE FROM rail_ai_kv WHERE k = ?').bind('fail:' + sys));
    for (const f of failed) { const sys = f.split(':')[0]; writes.push(kvPut(db, 'fail:' + sys, { n: ((fails.get(sys) || {}).n || 0) + 1, at: now }, now)); }
    if (done.length) {
      writes.push(db.prepare('INSERT INTO rail_ai_revisions (at_ms, changed, systems, cost_usd, meta) VALUES (?, ?, ?, ?, ?)')
        .bind(now, JSON.stringify(done.sort()), JSON.stringify(systems), cost, JSON.stringify({ secs: Math.round((Date.now() - t0) / 1000), failed })));
      for (const sys of done) writes.push(db.prepare('DELETE FROM rail_ai_kv WHERE k = ? AND CAST(v AS INTEGER) <= ?').bind('pending:' + sys, now));
    }
    for (const f of failed) writes.push(db.prepare('INSERT INTO rail_ai_events (at_ms, source, system, type, item_key, value, prev, relevant) VALUES (?, ?, ?, ?, ?, ?, ?, 0)')
      .bind(now, 'summarizer', f.split(':')[0], 'error', null, f, null));
    await db.batch(writes);
    return { done, failed, cost };
  } finally {
    await db.prepare(`UPDATE rail_ai_kv SET v = '0', updated_ms = ? WHERE k = 'ai_lock'`).bind(Date.now()).run();
  }
}

// cron 入口（worker.js 每分鐘 cron 的分支）。整點後每 3 分鐘偵測一次，有待整理的系統就接著整理。
// TDX 公告只在呼叫端給了才比：worker.js 只在 NCDR 有生效示警、而且災害監看已經叫醒三個通阻端點的那一分鐘傳進來，
// 這時三個端點的 isolate 記憶體快取是熱的，不會為了這裡多打 TDX（端點成本按次數計點）。
export async function railAiScheduled(event, env, { hazardActive = false, loadAlerts = null, fetch: fetchImpl = fetch } = {}) {
  const now = event && event.scheduledTime ? event.scheduledTime : Date.now();
  if (Math.floor(now / 60e3) % EVERY_MIN !== 0) return { skipped: 'not this minute' };
  // 示警結束後恢復營運的系統（高捷、輕軌、桃捷、中捷只有 TDX 看得到）也要看到「正常營運」回來，
  // 所以頁面上還有 TDX 系統沒恢復（72 小時內）時也讀；端點自己快取 300 秒，每 3 分鐘讀一次約每兩輪打一次上游
  const alerts = loadAlerts && (hazardActive || await tdxStillOpen(env.DELAY_DB, now)) ? await loadAlerts() : null;
  const detect = await railAiDetect(env, { now, fetch: fetchImpl, alerts });
  const summarize = await railAiSummarize(env, { now, fetch: fetchImpl });
  if (new Date(now + 8 * 3600e3).toISOString().slice(11, 16) === '03:03') await env.DELAY_DB.batch([
    env.DELAY_DB.prepare('DELETE FROM rail_ai_events WHERE at_ms < ?').bind(now - EVENT_KEEP_MS),
    env.DELAY_DB.prepare('DELETE FROM rail_ai_articles WHERE first_seen_ms < ?').bind(now - EVENT_KEEP_MS),
    env.DELAY_DB.prepare('DELETE FROM rail_ai_revisions WHERE at_ms < ? AND id < (SELECT MAX(id) FROM rail_ai_revisions)').bind(now - EVENT_KEEP_MS),
  ]);
  return { detect, summarize };
}
async function tdxStillOpen(db, now) {
  const rev = await latestRevision(db);
  return !!rev && TDX_SYSTEMS.some(s => rev.systems[s] && !isNormal(rev.systems[s]) && now - rev.systems[s].updatedAt < ARTICLE_WINDOW_MS);
}

// ── /api/rail-status ─────────────────────────────────────────────────────────────────────────
export const isNormal = e => !e.impacts || !e.impacts.length || e.impacts.every(i => i.state === '正常');

function manualEntry(id, now) {
  if (!(now >= Date.parse(manualBulletin.displayFrom) && now < Date.parse(manualBulletin.expiresAt))) return null;
  const s = manualBulletin.systems.find(x => x.id === id);
  if (!s) return null;
  return {
    id, label: s.label, status: s.status, statusEn: s.statusI18n?.en || s.status, statusJa: s.statusI18n?.ja || s.status,
    detail: s.detail, detailEn: s.detailI18n?.en || s.detail, detailJa: s.detailI18n?.ja || s.detail,
    sourceUrls: [s.sourceUrl, ...(s.additionalSources || []).map(a => a.sourceUrl)].filter(Boolean),
    impacts: [], updatedAt: Date.parse(manualBulletin.checkedAt), basis: 'manual',
  };
}

export async function railAiStatus(request, env, now = Date.now()) {
  const db = env.DELAY_DB;
  const url = new URL(request.url);
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, s-maxage=30' };
  try {
    if (url.searchParams.get('list') === '1') {
      const rows = (await db.prepare('SELECT id, at_ms, changed, cost_usd FROM rail_ai_revisions ORDER BY id DESC LIMIT 200').all()).results;
      return new Response(JSON.stringify({ revisions: rows.map(r => ({ id: r.id, at: r.at_ms, changed: JSON.parse(r.changed), costUsd: Math.round(r.cost_usd * 1000) / 1000 })) }), { headers });
    }
    const revId = Number(url.searchParams.get('rev'));
    const rev = revId
      ? await db.prepare('SELECT id, at_ms, changed, systems FROM rail_ai_revisions WHERE id = ?').bind(revId).first().then(r => r && { ...r, systems: JSON.parse(r.systems), changed: JSON.parse(r.changed) })
      : await latestRevision(db);
    if (revId && !rev) return new Response(JSON.stringify({ error: 'no such revision' }), { status: 404, headers });
    const locks = new Map((await db.prepare('SELECT system, locked_ms, note FROM rail_ai_locks').all()).results.map(r => [r.system, r]));
    const kv = (await db.prepare(`SELECT k, v, updated_ms FROM rail_ai_kv WHERE k LIKE 'src:%' OR k LIKE 'pending:%'`).all()).results;
    const srcState = kv.filter(r => r.k.startsWith('src:'));
    const checkedAt = srcState.length ? Math.max(...srcState.map(r => r.updated_ms)) : null;
    // 偵測到新變化卻一直沒整理進來（失敗、被鎖、到了月上限）：列出來，頁面提醒先看官方
    const lagging = revId ? [] : kv.filter(r => r.k.startsWith('pending:') && now - Number(r.v) > LAG_MS).map(r => r.k.slice(8)).filter(id => SYSTEM_IDS.has(id))
      .map(id => ({ id, label: labelOf(id), since: Number(kv.find(r => r.k === 'pending:' + id).v), url: (RAIL_AI_SOURCES.find(x => x.system === id) || {}).url || null }));
    const titles = new Map();
    const urls = [...new Set(Object.values(rev ? rev.systems : {}).flatMap(e => e.sourceUrls || []))];
    for (let i = 0; i < urls.length; i += 50) {
      const part = urls.slice(i, i + 50);
      const rows = (await db.prepare(`SELECT url, title FROM rail_ai_articles WHERE url IN (${part.map(() => '?').join(',')})`).bind(...part).all()).results;
      for (const r of rows) titles.set(r.url, r.title);
    }
    const systems = [];
    for (const { id } of RAIL_AI_SYSTEMS) {
      let e = rev && rev.systems[id] ? { ...rev.systems[id], basis: 'ai' } : null;
      if (locks.has(id)) e = manualEntry(id, now) || (e && { ...e, basis: 'ai-frozen' });
      if (!e) continue;
      if (!revId && e.basis !== 'manual' && isNormal(e) && now - e.updatedAt > SHOW_NORMAL_MS) continue;
      const stale = e.basis !== 'manual' && !isNormal(e) && now - e.updatedAt > STALE_MS;
      systems.push({ ...e, locked: locks.has(id), stale, sources: (e.sourceUrls || []).map(u => ({ url: u, title: titles.get(u) || null })) });
    }
    systems.sort((a, b) => isNormal(a) - isNormal(b));
    return new Response(JSON.stringify({ generatedAt: now, checkedAt, revision: rev ? { id: rev.id, at: rev.at_ms, changed: rev.changed } : null, lagging, systems }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'rail_status_unavailable' }), { status: 503, headers: { ...headers, 'cache-control': 'no-store' } });
  }
}
