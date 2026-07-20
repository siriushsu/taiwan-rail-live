// Cloudflare Worker 入口:靜態資產(assets binding)+ /api/tra-live 台鐵即時動態代理
// + /api/tra-alert 台鐵營運通阻公告 + /api/thsr-alert 高鐵營運狀態公告(颱風停駛等)
// + /api/metro-alert 捷運營運狀態公告(五家聚合)
// + /api/delay-stats 台鐵準點率統計(唯讀查 D1 預先算好的 blob,原樣回傳,不解析)
// 金鑰只存在 Worker 環境變數(dashboard Variables and Secrets),前端不直連 TDX。
// 雙層快取護住 TDX 用量:PoP 邊緣快取 55 秒(workers.dev 網域上 Cache API 無效,
// 屆時靠 isolate 記憶體快取,約每 isolate 每分鐘 1 次)——用量恆定,不隨訪客數增加。
const AUTH_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const API_URL = 'https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/TrainLiveBoard?%24format=JSON';
const ALERT_URL = 'https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/Alert?%24format=JSON';
// 高鐵營運狀態:TDX 僅 v2 有 Rail/THSR/AlertInfo(v3 為 404),回頂層陣列,正常時單筆「全線營運正常(Normal)」
const THSR_ALERT_URL = 'https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/AlertInfo?%24format=JSON';

let tok = null, tokExp = 0;
async function getToken(env) {
  if (tok && Date.now() < tokExp - 60e3) return tok;
  const r = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.TDX_CLIENT_ID,
      client_secret: env.TDX_CLIENT_SECRET,
    }),
  });
  if (!r.ok) throw new Error('tdx auth ' + r.status);
  const d = await r.json();
  tok = d.access_token;
  tokExp = Date.now() + (d.expires_in || 86400) * 1000;
  return tok;
}

let mem = null, memAt = 0;
const jsonRes = (obj, status, cc) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cc },
});

async function traLive(request, env, ctx) {
  // 用量埋點:前景分鐘計數器(cam/z 由前端輪詢帶,cache 命中與否都要記到)。觀測絕不可影響服務,例外整段吞掉。
  if (env.USAGE) {
    try {
      const u = new URL(request.url);
      const camRaw = u.searchParams.get('cam');
      const cam = ['follow', 'amb', 'idle', 'theater'].includes(camRaw) ? camRaw : 'na';
      const z = parseInt(u.searchParams.get('z'), 10);
      const dev = /Mobile/.test(request.headers.get('user-agent') || '') ? 'm' : 'd';
      env.USAGE.writeDataPoint({ blobs: [cam, dev], doubles: [isNaN(z) ? 0 : z], indexes: [cam] });
    } catch (e) {}
  }
  const cacheKey = new Request(new URL('/api/tra-live', request.url), { method: 'GET' });
  const edge = caches.default;
  const hit = await edge.match(cacheKey);
  if (hit) return hit;
  try {
    if (!mem || Date.now() - memAt > 55e3) {
      const r = await fetch(API_URL, { headers: { authorization: 'Bearer ' + await getToken(env) } });
      if (r.status === 401) { tok = null; throw new Error('tdx 401'); }
      if (!r.ok) throw new Error('tdx api ' + r.status);
      const d = await r.json();
      const list = Array.isArray(d) ? d : d.TrainLiveBoards || [];
      mem = {
        at: d.UpdateTime || new Date().toISOString(),
        trains: list.map(t => ({ no: t.TrainNo, delay: t.DelayTime || 0, sta: t.StationID, status: t.TrainStationStatus })),
      };
      memAt = Date.now();
      // 逐站觀測事件擷取:只搭「真的刷新上游」這班順風車(cache 命中/mem 未過期都到不了這裡),零新增 TDX 呼叫
      recordStationEvents(mem, env, ctx);
    }
    const res = jsonRes(mem, 200, 'public, s-maxage=55, stale-while-revalidate=300');
    await edge.put(cacheKey, res.clone());
    return res;
  } catch (e) {
    if (mem) return jsonRes(mem, 200, 'public, s-maxage=15');
    return jsonRes({ error: String(e.message || e) }, 502, 'no-store');
  }
}

// ── 台鐵逐站觀測事件擷取:piggyback /api/tra-live 上游刷新,零新增 TDX 呼叫、零新增 cron ──
// 為「今日逐站歷程」「今日準點/誤點榜」累積資料。鐵則:記錄絕不可影響 tra-live 服務本身——
// diff 是純函式微秒級同步做完,只有 D1 寫入丟 ctx.waitUntil 背景跑,失敗整段吞掉(比照上方 USAGE 埋點精神)。
// POP 之間、isolate 重生造成的重複觀測,靠下面 upsert 的 PK(service_date,train_no,sta,status)天然去重。
const STATION_EVENT_UPSERT = 'INSERT INTO tra_station_events (service_date,train_no,sta,status,delay,delay_max,obs_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(service_date,train_no,sta,status) DO UPDATE SET delay_max = excluded.delay_max WHERE excluded.delay_max > tra_station_events.delay_max';
let stEventsPrev = null; // train_no → {sta,status,delay};null=本 isolate 尚未播種(第一次刷新只播種、不寫事件)

// 台北今日 YYYY-MM-DD(台北無日光節約,固定 +8;沿用 isoFromDate 讀 UTC 欄位即得台北日)。
function twToday() { return isoFromDate(new Date(Date.now() + 8 * 3600 * 1000)); }
// mem.at(TDX UpdateTime)→台北服務日。帶 +08:00 的已是台北牆鐘,直接 slice 日期(不可再 +8);
// fallback 是 new Date().toISOString() 的 UTC ISO(以 Z / +00:00 結尾)→ +8 小時再取日期。
function twDayFromMemAt(at) {
  const s = String(at == null ? '' : at);
  if (s.includes('+08:00')) return s.slice(0, 10);
  const ms = Date.parse(s);
  return isoFromDate(new Date((Number.isNaN(ms) ? Date.now() : ms) + 8 * 3600 * 1000));
}

// 逐車 diff → 回傳「有變化、要寫的」車列 [{no,sta,status,delay}]。純函式:不碰 D1、不碰時間,供離線測試。
// prevMap=null 代表本 isolate 尚未播種 → 一律回 [](首輪只播種,避免 isolate 重生把整批當新事件)。
// 有變才發:prev 沒這車 / 換站 / 換狀態 / 誤點變動;no 或 sta 缺一律跳過(sta 空的觀測無意義)。
function diffTrains(prevMap, trains) {
  if (!(prevMap instanceof Map) || !Array.isArray(trains)) return [];
  const out = [];
  for (const t of trains) {
    const no = t && t.no != null ? String(t.no) : '';
    const sta = t && t.sta != null ? String(t.sta) : '';
    if (!no || !sta) continue;
    const p = prevMap.get(no);
    if (!p || p.sta !== sta || p.status !== t.status || p.delay !== t.delay) out.push({ no, sta, status: t.status, delay: t.delay });
  }
  return out;
}

// 當前 trains → 下輪 diff 的 prev 快照;與 diffTrains 用同一套 no/sta 有效性規則,避免兩邊漂移。
function snapshotTrains(trains) {
  const m = new Map();
  if (!Array.isArray(trains)) return m;
  for (const t of trains) {
    const no = t && t.no != null ? String(t.no) : '';
    const sta = t && t.sta != null ? String(t.sta) : '';
    if (!no || !sta) continue;
    m.set(no, { sta, status: t.status, delay: t.delay });
  }
  return m;
}

// 把本次刷新的變動寫進 D1。delay 與 delay_max 都填當下誤點:新事件是首見值;同 PK 已存在時 upsert 只在
// 「當下誤點更大」才升 delay_max(見 STATION_EVENT_UPSERT 的 WHERE),誤點回落不覆蓋。整段 try/catch 吞掉。
function recordStationEvents(mem, env, ctx) {
  try {
    if (!env || !env.DELAY_DB || !mem || !Array.isArray(mem.trains)) return;
    const changed = diffTrains(stEventsPrev, mem.trains); // 首輪 prev=null → [](只播種)
    stEventsPrev = snapshotTrains(mem.trains);            // 即使本輪零事件也要更新快照當下輪基準
    if (!changed.length) return;
    const serviceDate = twDayFromMemAt(mem.at), obsAt = String(mem.at);
    const stmt = env.DELAY_DB.prepare(STATION_EVENT_UPSERT);
    const write = env.DELAY_DB.batch(changed.map(c => stmt.bind(serviceDate, c.no, c.sta, c.status, c.delay, c.delay, obsAt)));
    // D1 寫入丟背景不擋 tra-live 回應;ctx 可能為 undefined(防),rejection 一律吞掉不冒泡
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(write.catch(() => {}));
    else if (write && typeof write.catch === 'function') write.catch(() => {});
  } catch (e) {}
}

// 營運通阻公告:來源每 120 秒更新,快取 110 秒。正常時 TDX 回單筆 Status:1「全線營運正常」,
// 異常條目原樣帶出 Title/Description/Scope 等欄位,前端只轉述官方公告、不自行推定停駛班次
let alertMem = null, alertMemAt = 0;
async function traAlert(request, env) {
  const cacheKey = new Request(new URL('/api/tra-alert', request.url), { method: 'GET' });
  const edge = caches.default;
  const hit = await edge.match(cacheKey);
  if (hit) return hit;
  try {
    if (!alertMem || Date.now() - alertMemAt > 110e3) {
      const r = await fetch(ALERT_URL, { headers: { authorization: 'Bearer ' + await getToken(env) } });
      if (r.status === 401) { tok = null; throw new Error('tdx 401'); }
      if (!r.ok) throw new Error('tdx api ' + r.status);
      const d = await r.json();
      alertMem = {
        at: d.UpdateTime || new Date().toISOString(),
        alerts: (d.Alerts || []).map(a => ({
          title: a.Title, status: a.Status, desc: a.Description,
          level: a.Level, effect: a.Effect, reason: a.Reason,
          start: a.StartTime, end: a.EndTime,
          lines: ((a.Scope && a.Scope.Lines) || []).map(l => (l.LineName && (l.LineName.Zh_tw || l.LineName)) || l.LineID).filter(Boolean),
          stations: ((a.Scope && a.Scope.Stations) || []).map(s => (s.StationName && (s.StationName.Zh_tw || s.StationName)) || s.StationID).filter(Boolean),
        })),
      };
      alertMemAt = Date.now();
    }
    const res = jsonRes(alertMem, 200, 'public, s-maxage=110, stale-while-revalidate=600');
    await edge.put(cacheKey, res.clone());
    return res;
  } catch (e) {
    if (alertMem) return jsonRes(alertMem, 200, 'public, s-maxage=30');
    return jsonRes({ error: String(e.message || e) }, 502, 'no-store');
  }
}

// 高鐵營運狀態公告:正常時 TDX 回單筆「全線營運正常(Normal)」(AlertID 全零),標為 status:1 供前端濾除;
// 異常條目(颱風停駛等)標 status:0 帶出。輸出結構同 /api/tra-alert,前端 pollAlert 可共用。
let thsrAlertMem = null, thsrAlertMemAt = 0;
async function thsrAlert(request, env) {
  const cacheKey = new Request(new URL('/api/thsr-alert', request.url), { method: 'GET' });
  const edge = caches.default;
  const hit = await edge.match(cacheKey);
  if (hit) return hit;
  try {
    if (!thsrAlertMem || Date.now() - thsrAlertMemAt > 110e3) {
      const r = await fetch(THSR_ALERT_URL, { headers: { authorization: 'Bearer ' + await getToken(env) } });
      if (r.status === 401) { tok = null; throw new Error('tdx 401'); }
      if (!r.ok) throw new Error('tdx api ' + r.status);
      const d = await r.json();
      const list = Array.isArray(d) ? d : (d.AlertInfos || []);
      thsrAlertMem = {
        at: new Date().toISOString(),
        alerts: list.map(a => {
          const normal = /正常|Normal/.test(a.Title || '') || /^0*$/.test((a.AlertID || '').replace(/-/g, ''));
          return {
            title: a.Title, status: normal ? 1 : 0, desc: a.Description || '',
            start: (a.StartTime && !String(a.StartTime).startsWith('0001')) ? a.StartTime : '',
            end: a.EndTime || '', lines: ['高鐵'],
          };
        }),
      };
      thsrAlertMemAt = Date.now();
    }
    const res = jsonRes(thsrAlertMem, 200, 'public, s-maxage=110, stale-while-revalidate=600');
    await edge.put(cacheKey, res.clone());
    return res;
  } catch (e) {
    if (thsrAlertMem) return jsonRes(thsrAlertMem, 200, 'public, s-maxage=30');
    return jsonRes({ error: String(e.message || e) }, 502, 'no-store');
  }
}

// 捷運營運狀態公告:TDX v2 Rail/Metro/Alert/{op},僅五家有端點(新北捷運/淡海/安坑輕軌無此 API)。
// 正常條目(如中捷例行「正常營運」)標 status:1 供前端濾除;颱風調整班距/異常等帶出。
// 每筆附 sys(前端系統 id)供捷運分頁按勾選中的系統過濾。輸出結構同 /api/tra-alert。
const METRO_ALERT_OPS = [
  { op: 'TRTC', sys: 'mrt', label: '台北捷運' },
  { op: 'KRTC', sys: 'krtc', label: '高雄捷運' },
  { op: 'KLRT', sys: 'krtc', label: '高雄輕軌' },
  { op: 'TYMC', sys: 'tymc', label: '桃園機捷' },
  { op: 'TMRT', sys: 'tmrt', label: '台中捷運' },
];

// 單一營運者「上次成功結果」留存(2026-07-17 修法:上游一次抖動失敗會讓 metroAlertMem 整批
// 快取 alerts:[],連帶把還活著的事故公告吃掉數分鐘,被高雄輕軌一次實際事故撞到)。某營運者
// 本輪 fetch 失敗時,若留存 ≤30 分鐘內就沿用,超過才回空——這層記的是「每個營運者各自」
// 最後一次成功的結果,與整體 metroAlertMem 的 110s 快取是不同層,互不影響。
const metroAlertOpMem = new Map(); // op → { list, at }
const METRO_ALERT_STALE_MS = 30 * 60e3;
function metroAlertOpFallback(prev, nowMs) {
  if (prev && nowMs - prev.at <= METRO_ALERT_STALE_MS) return prev.list;
  return [];
}

// 桃園機捷新聞稿(TDX v2 Rail/Metro/News/TYMC):Alert 端點對「設備異常」等事後才澄清的事故
// 常常全程回「正常營運」,News 事後新聞稿是唯一機器可讀痕跡(2026-07-17 A6 站設備異常案實測:
// Alert 全程正常,News 延遲約 2 小時補發新聞稿)。只接 TYMC,其他家 News 全是行銷內容不接。
// 獨立 10 分鐘快取(News 更新慢,不跟著 Alert 的 110s 打);失敗沿用舊值,無舊值就略過,
// 不影響 Alert 聚合。
const TYMC_NEWS_URL = 'https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/News/TYMC?%24top=30&%24format=JSON';
const METRO_NEWS_TTL_MS = 10 * 60e3;
const METRO_NEWS_RECENT_MS = 24 * 3600e3;
const METRO_NEWS_DESC_MAX = 300;
const METRO_NEWS_INCIDENT_RE = /異常|延誤|誤點|事故|暫停|中斷|停駛|疏運|故障/;

// UpdateTime(不用 PublishTime——實測 PublishTime 只給日期 00:00:00,不可信)是否在 24 小時內。
function isRecentNews(updateTimeIso, nowMs) {
  const ms = Date.parse(updateTimeIso);
  if (!Number.isFinite(ms)) return false;
  return Math.abs(nowMs - ms) <= METRO_NEWS_RECENT_MS;
}
// 標題是否為事故類新聞稿(排除行銷/活動類)。
function isIncidentNewsTitle(title) {
  return typeof title === 'string' && METRO_NEWS_INCIDENT_RE.test(title);
}
// 去 HTML 標籤、把換行(\r\n)與連續空白壓成單一空白,超長截斷加刪節號。
function stripHtmlAndTruncate(html, maxLen) {
  if (typeof html !== 'string') return '';
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}
// 標題不含「新聞稿」字樣就前綴【官方新聞稿】,讓前端能區分事後公告與即時通阻;含了就不重複加。
function formatNewsTitle(title) {
  const t = String(title || '');
  return t.includes('新聞稿') ? t : '【官方新聞稿】' + t;
}
// 單筆 TDX News 項目 → 與現有 alert 條目相容的結構。
function mapNewsToAlert(item) {
  return {
    title: formatNewsTitle(item.Title),
    status: 0,
    desc: stripHtmlAndTruncate(item.Description, METRO_NEWS_DESC_MAX),
    start: item.UpdateTime, end: '', lines: [],
    sys: 'tymc', sysLabel: '桃園機捷', news: true,
  };
}
// 篩選(UpdateTime 24 小時內 + 標題含事故關鍵字,全部成立才帶出)+ 轉換。
function filterAndMapNews(items, nowMs) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(it => it && isRecentNews(it.UpdateTime, nowMs) && isIncidentNewsTitle(it.Title))
    .map(mapNewsToAlert);
}

let tymcNewsMem = null, tymcNewsMemAt = 0;
async function fetchTymcNewsAlerts(token) {
  if (tymcNewsMem && Date.now() - tymcNewsMemAt <= METRO_NEWS_TTL_MS) return tymcNewsMem;
  try {
    const r = await fetch(TYMC_NEWS_URL, { headers: { authorization: 'Bearer ' + token } });
    if (r.status === 401) { tok = null; throw new Error('tdx 401'); }
    if (!r.ok) throw new Error('tdx api ' + r.status);
    const d = await r.json();
    const list = Array.isArray(d) ? d : (d.Newses || d.News || d.NewsList || []);
    tymcNewsMem = filterAndMapNews(list, Date.now());
    tymcNewsMemAt = Date.now();
    return tymcNewsMem;
  } catch (e) {
    return tymcNewsMem || []; // 失敗沿用舊值;無舊值就略過,不影響 Alert 聚合
  }
}

let metroAlertMem = null, metroAlertMemAt = 0;
async function metroAlert(request, env) {
  const cacheKey = new Request(new URL('/api/metro-alert', request.url), { method: 'GET' });
  const edge = caches.default;
  const hit = await edge.match(cacheKey);
  if (hit) return hit;
  try {
    if (!metroAlertMem || Date.now() - metroAlertMemAt > 110e3) {
      const token = await getToken(env);
      const [parts, newsAlerts] = await Promise.all([
        Promise.all(METRO_ALERT_OPS.map(async ({ op, sys, label }) => {
          try {
            const r = await fetch(`https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/Alert/${op}?%24format=JSON`,
              { headers: { authorization: 'Bearer ' + token } });
            if (r.status === 401) { tok = null; throw new Error('tdx 401'); }
            if (!r.ok) throw new Error('tdx api ' + r.status);
            const d = await r.json();
            const list = (d.Alerts || []).map(a => {
              const normal = /正常營運|營運正常|正常行駛/.test(a.Title || '');
              return {
                title: a.Title, status: normal ? 1 : 0, desc: a.Description || '',
                reason: a.Reason, effect: a.Effect,
                start: (a.StartTime && !String(a.StartTime).startsWith('0001')) ? a.StartTime : '',
                end: (a.EndTime && !String(a.EndTime).startsWith('0001')) ? a.EndTime : '',
                lines: ((a.Scope && a.Scope.Lines) || []).map(l => (l.LineName && (l.LineName.Zh_tw || l.LineName)) || l.LineID).filter(Boolean),
                sys, sysLabel: label,
              };
            });
            metroAlertOpMem.set(op, { list, at: Date.now() });
            return list;
          } catch (e) {
            // 單一營運者失敗不再靜默回空:沿用該營運者 ≤30 分鐘內的上次成功結果(見上方 metroAlertOpFallback)
            return metroAlertOpFallback(metroAlertOpMem.get(op), Date.now());
          }
        })),
        fetchTymcNewsAlerts(token),
      ]);
      metroAlertMem = { at: new Date().toISOString(), alerts: parts.flat().concat(newsAlerts) };
      metroAlertMemAt = Date.now();
    }
    const res = jsonRes(metroAlertMem, 200, 'public, s-maxage=110, stale-while-revalidate=600');
    await edge.put(cacheKey, res.clone());
    return res;
  } catch (e) {
    if (metroAlertMem) return jsonRes(metroAlertMem, 200, 'public, s-maxage=30');
    return jsonRes({ error: String(e.message || e) }, 502, 'no-store');
  }
}

// 捷運到站看板(TDX Metro LiveBoard,上游 30-60 秒更新):前端把動畫錨定到官方看板倒數用。
// op 依前端系統 id 聚合:mrt=TRTC、krtc=KRTC+KLRT、tymc=TYMC(新北捷/中捷無此 API)。
// 北捷特性:只在列車即將進站時發佈(EstimateTime 幾乎全 0),桃捷/高捷/輕軌為全站倒數。
// 雙層快取比照 tra-live:有人看才打上游,用量恆定不隨訪客數增加。$top 必帶(TDX 預設截斷 30 筆)。
const METRO_LIVE_OPS = { mrt: ['TRTC'], krtc: ['KRTC', 'KLRT'], tymc: ['TYMC'] };
const metroLiveMem = new Map(); // sys → { data, at }
async function metroLive(request, env, sys) {
  const cacheKey = new Request(new URL('/api/metro-live?sys=' + sys, request.url), { method: 'GET' });
  const edge = caches.default;
  const hit = await edge.match(cacheKey);
  if (hit) return hit;
  const stale = metroLiveMem.get(sys);
  try {
    // TTL 115s(v0716c 自 55s 上調):全台同框(預設視圖+24/7 直播分頁)也套校正後,55s 會讓上游翻倍貼爆 TDX 銅級點數;
    // shift 是逐線中位數、變化以分鐘計,前端 60s 輪詢下實際約每 2 分鐘拿到新值,無感差異
    if (!stale || Date.now() - stale.at > 115e3) {
      const token = await getToken(env);
      const parts = await Promise.all(METRO_LIVE_OPS[sys].map(async op => {
        const r = await fetch(`https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/LiveBoard/${op}?%24top=5000&%24format=JSON`,
          { headers: { authorization: 'Bearer ' + token } });
        if (r.status === 401) { tok = null; throw new Error('tdx 401'); }
        if (!r.ok) throw new Error('tdx api ' + r.status);
        const d = await r.json();
        return (Array.isArray(d) ? d : []).map(x => ({
          l: x.LineID,
          s: (x.StationName && x.StationName.Zh_tw) || '',
          d: (x.DestinationStationName && x.DestinationStationName.Zh_tw) || '',
          e: x.EstimateTime,   // 到站倒數(整數分鐘,可 null)
          st: x.ServiceStatus, // 0=正常 1=未發車 2=交管不停 3=末班已過 4=未營運
          op,
        }));
      }));
      metroLiveMem.set(sys, { data: { at: new Date().toISOString(), rows: parts.flat() }, at: Date.now() });
    }
    const res = jsonRes(metroLiveMem.get(sys).data, 200, 'public, s-maxage=110, stale-while-revalidate=240');
    await edge.put(cacheKey, res.clone());
    return res;
  } catch (e) {
    if (stale) return jsonRes(stale.data, 200, 'public, s-maxage=15');
    return jsonRes({ error: String(e.message || e) }, 502, 'no-store');
  }
}

// ── 新北捷官網列車動態代理(trainstatus.ntmetro.com.tw,免金鑰) ──
// 環狀線=逐車軌道區間佔用、淡海/安坑=逐站到站倒數。未文件化端點:去函詢問使用同意中(2026-07 起),
// 對方拒絕即移除本段;失敗前端自動退回時刻表推演,零損害。快取後全站對上游=每端點約 55s 一次,
// 遠低於其官網單一訪客的 10s 輪詢負載。
// Set 而非物件字面量:物件的 in/[] 查表吃原型鏈(sys='constructor'/'__proto__'/'toString' 會誤判 truthy),
// Set.has() 只認自身成員,擋掉用原型成員名繞過白名單、把本 proxy 打成對新北捷官網的未快取放大代理。
const NTM_LIVE_SYS = new Set(['circular', 'danhai', 'ankeng']);
const ntmLiveMem = new Map(); // sys → { data, at }
async function ntmetroLive(request, env, sys) {
  const cacheKey = new Request(new URL('/api/ntmetro-live?sys=' + sys, request.url), { method: 'GET' });
  const edge = caches.default;
  const hit = await edge.match(cacheKey);
  if (hit) return hit;
  const stale = ntmLiveMem.get(sys);
  try {
    if (!stale || Date.now() - stale.at > 55e3) {
      const r = await fetch(`https://trainstatus.ntmetro.com.tw/roadmap/${sys}_data.php`,
        { headers: { 'user-agent': 'railisland.tw metro animation (+https://railisland.tw)' } });
      if (!r.ok) throw new Error('ntmetro ' + r.status);
      const d = await r.json();
      ntmLiveMem.set(sys, { data: { at: new Date().toISOString(), src: d && d.data != null ? d.data : null }, at: Date.now() });
    }
    const res = jsonRes(ntmLiveMem.get(sys).data, 200, 'public, s-maxage=50, stale-while-revalidate=120');
    await edge.put(cacheKey, res.clone());
    return res;
  } catch (e) {
    if (stale) return jsonRes(stale.data, 200, 'public, s-maxage=15');
    // 軟失敗:回 200+src:null(前端 applyNtmLive 對 null 直接 no-op,退回時刻表推演),不回 5xx 免得訪客 console 留紅字。
    // 負向結果也快取 15s:白名單收緊後雖已無繞過放大,但合法 sys 遇上游持續 5xx 時,無此快取會讓每個請求 1:1 重打上游,
    // 上游越掛我們打越兇。不帶 error 字串進 body,免洩內部訊息。
    const res = jsonRes({ at: new Date().toISOString(), src: null }, 200, 'public, s-maxage=15');
    await edge.put(cacheKey, res.clone());
    return res;
  }
}

// 台鐵準點率統計(D1 唯讀查詢):資料由外部批次工作預先算好寫入 kv_blobs,Worker 只做單列查詢+
// 原樣回傳字串,不 JSON.parse 再 stringify、不跑 cron/scheduled handler——免費方案 10ms CPU 預算裡最省的做法。
async function delayStats(request, env) {
  const cacheKey = new Request(new URL('/api/delay-stats', request.url), { method: 'GET' });
  const edge = caches.default;
  const hit = await edge.match(cacheKey);
  if (hit) return hit;
  try {
    const row = await env.DELAY_DB.prepare("SELECT v FROM kv_blobs WHERE k='tra_delay_stats_30d'").first();
    if (!row) return jsonRes({ error: 'not_ready' }, 503, 'public, s-maxage=60');
    const res = new Response(row.v, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
    await edge.put(cacheKey, res.clone());
    return res;
  } catch (e) {
    return jsonRes({ error: 'not_ready' }, 503, 'public, s-maxage=60');
  }
}

// 逐車次「近 90 天」誤點履歷(唯讀查 D1 tra_delay_daily 逐日原始列):供未來誤點履歷圖表 UI(Plus
// 頭牌功能)用。跟 /api/delay-stats 的差異:delay-stats 吐每車 30 天聚合值(a/p/d/m),這裡吐逐日
// 序列(d=service_date、fd=final_delay、md=max_delay)。train 白名單同 stationEvents(台鐵車次
// 1~6 碼英數),一律 bind、禁止字串拼 SQL。
const DELAY_HISTORY_WINDOW_DAYS = 90;

// 視窗基準:「表內最大 service_date」(dbMaxDate,呼叫端先查 MAX(service_date) 拿到)回推
// windowDays-1 天——語意同 buildBlob 的 30 天窗(見下方 BLOB_WINDOW_DAYS),不是這班車自己的
// 最大日期,避免某車次近日剛好沒發車就被誤判成整段空窗。dbMaxDate 為 null(表空)回傳 null。
function delayHistoryWindow(dbMaxDate, windowDays) {
  if (!dbMaxDate) return null;
  const maxDate = String(dbMaxDate);
  return { startDate: addDays(maxDate, -(windowDays - 1)), maxDate };
}

// 台鐵車次格式白名單(同 stationEvents 的驗證慣例:1~6 碼英數,擋任意字串打 D1)。
// 抽成獨立純函式只是為了讓這條驗證規則可離線單元測試,邏輯與既有 stationEvents 內的行內版本一致。
function isValidTrainNo(train) { return /^[0-9A-Za-z]{1,6}$/.test(train); }

// 把單一車次的 D1 列組成 /api/delay-history 回應 body(純函式,供離線測試,不碰網路/D1)。
// rows 不假設已排序或已按窗過濾——本函式自己再篩再排一次,對齊 buildBlob「呼叫端篩過我還是
// 自己再篩一次」的防禦風格。fd/md 用 toInt 轉整數,轉不出來的列(髒資料)整列丟棄,不讓 null
// 混進圖表資料。win 為 null(表空)直接回空陣列、date_range 為 null。
function buildDelayHistoryBody(train, rows, windowDays, win, generatedIso) {
  let days = [];
  if (win) {
    days = (rows || [])
      .map(r => ({ d: String(r.service_date), fd: toInt(r.final_delay), md: toInt(r.max_delay) }))
      .filter(r => r.d >= win.startDate && r.d <= win.maxDate && r.fd !== null && r.md !== null)
      .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  }
  return {
    train,
    days,
    _meta: {
      window_days: windowDays,
      date_range: win ? [win.startDate, win.maxDate] : null,
      n: days.length,
      generated: generatedIso,
    },
  };
}

async function delayHistory(request, env) {
  const train = new URL(request.url).searchParams.get('train') || '';
  if (!isValidTrainNo(train)) return jsonRes({ error: 'bad train' }, 400, 'no-store');
  // 快取鍵手動把 train 併進 URL 字串(同 stationEvents 慣例)——caches.default 精確比對傳入的
  // Request URL,鍵若只用不帶 query 的路徑,不同車次會互相污染快取。train 已白名單化,免 encode。
  const cacheKey = new Request(new URL('/api/delay-history?train=' + train, request.url), { method: 'GET' });
  const edge = caches.default;
  const hit = await edge.match(cacheKey);
  if (hit) return hit;
  try {
    const dbMaxRow = await env.DELAY_DB.prepare('SELECT MAX(service_date) AS m FROM tra_delay_daily').first();
    const win = delayHistoryWindow(dbMaxRow && dbMaxRow.m ? String(dbMaxRow.m) : null, DELAY_HISTORY_WINDOW_DAYS);
    let rows = [];
    if (win) {
      const rs = await env.DELAY_DB.prepare(
        'SELECT service_date, final_delay, max_delay FROM tra_delay_daily WHERE train_no=? AND service_date>=? AND service_date<=? ORDER BY service_date ASC'
      ).bind(train, win.startDate, win.maxDate).all();
      rows = rs.results || [];
    }
    const body = buildDelayHistoryBody(train, rows, DELAY_HISTORY_WINDOW_DAYS, win, utcStamp());
    const res = jsonRes(body, 200, 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
    await edge.put(cacheKey, res.clone());
    return res;
  } catch (e) {
    return jsonRes({ error: 'not_ready' }, 503, 'public, s-maxage=60');
  }
}

// 今日逐站歷程(唯讀查 D1 tra_station_events):給前端「這班車今天到過哪些站、各站誤點/最大誤點」。
// train 白名單化(台鐵車次 1~6 碼英數),擋任意字串打 D1;只查台北今日、按觀測時間升冪。空/無列自然回空陣列。
async function stationEvents(request, env) {
  const train = new URL(request.url).searchParams.get('train') || '';
  if (!/^[0-9A-Za-z]{1,6}$/.test(train)) return jsonRes({ error: 'bad train' }, 400, 'no-store');
  const cacheKey = new Request(new URL('/api/station-events?train=' + train, request.url), { method: 'GET' });
  const edge = caches.default;
  const hit = await edge.match(cacheKey);
  if (hit) return hit;
  try {
    const date = twToday();
    const rs = await env.DELAY_DB.prepare(
      'SELECT sta, status, delay, delay_max, obs_at FROM tra_station_events WHERE service_date=? AND train_no=? ORDER BY obs_at ASC'
    ).bind(date, train).all();
    const events = (rs.results || []).map(r => ({ sta: r.sta, status: r.status, delay: r.delay, delayMax: r.delay_max, at: r.obs_at }));
    const res = jsonRes({ date, train, events }, 200, 'public, s-maxage=30, stale-while-revalidate=120');
    await edge.put(cacheKey, res.clone());
    return res;
  } catch (e) {
    return jsonRes({ error: 'not_ready' }, 503, 'public, s-maxage=30');
  }
}

// 今日準點/誤點榜(唯讀查 D1):每班車一列=今天最新一筆事件(obs_at 最大)+今天整體 max(delay_max)。
// 用視窗函式在 SQL 端聚合(絕不把全日事件撈回 JS 再算);空表優雅回空陣列。
async function todayBoard(request, env) {
  const cacheKey = new Request(new URL('/api/today-board', request.url), { method: 'GET' });
  const edge = caches.default;
  const hit = await edge.match(cacheKey);
  if (hit) return hit;
  try {
    const date = twToday();
    const rs = await env.DELAY_DB.prepare(
      'SELECT train_no, sta, status, delay, obs_at, dmax FROM (' +
      ' SELECT train_no, sta, status, delay, obs_at,' +
      ' ROW_NUMBER() OVER (PARTITION BY train_no ORDER BY obs_at DESC) AS rn,' +
      ' MAX(delay_max) OVER (PARTITION BY train_no) AS dmax' +
      ' FROM tra_station_events WHERE service_date=?' +
      ') WHERE rn=1 ORDER BY train_no'
    ).bind(date).all();
    const trains = (rs.results || []).map(r => ({ no: r.train_no, sta: r.sta, status: r.status, delay: r.delay, delayMax: r.dmax, at: r.obs_at }));
    const res = jsonRes({ date, trains }, 200, 'public, s-maxage=120, stale-while-revalidate=300');
    await edge.put(cacheKey, res.clone());
    return res;
  } catch (e) {
    return jsonRes({ error: 'not_ready' }, 503, 'public, s-maxage=30');
  }
}

// 刪除帳號前清除 RevenueCat customer。Secret API key 只能存在 Worker runtime；
// 先以 Firebase Auth REST lookup 驗證呼叫者的 ID token，再只刪除該 token 自己的 uid，
// 不接受前端傳 customer id，避免知道別人 uid 就能刪除對方購買資料。
async function deletePaidProfile(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, 'no-store');
  if (!env.FIREBASE_WEB_API_KEY || !env.REVENUECAT_PROJECT_ID || !env.REVENUECAT_V2_SECRET_KEY)
    return jsonRes({ error: 'account deletion service is not configured' }, 503, 'no-store');
  const auth = request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i), idToken = match && match[1];
  if (!idToken || idToken.length > 4096) return jsonRes({ error: 'unauthorized' }, 401, 'no-store');
  try {
    const lookup = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }),
    });
    if (!lookup.ok) return jsonRes({ error: 'unauthorized' }, 401, 'no-store');
    const identity = await lookup.json(), uid = identity && identity.users && identity.users[0] && identity.users[0].localId;
    if (!uid || typeof uid !== 'string') return jsonRes({ error: 'unauthorized' }, 401, 'no-store');
    const rc = await fetch(`https://api.revenuecat.com/v2/projects/${encodeURIComponent(env.REVENUECAT_PROJECT_ID)}/customers/${encodeURIComponent(uid)}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${env.REVENUECAT_V2_SECRET_KEY}`, Accept: 'application/json' },
    });
    // 從未開過購買頁的帳號可能沒有 RevenueCat customer；404 代表已達成「沒有資料可刪」。
    if (!(rc.ok || rc.status === 404)) return jsonRes({ error: 'purchase profile deletion failed' }, 502, 'no-store');
    return jsonRes({ ok: true }, 200, 'no-store');
  } catch (e) {
    return jsonRes({ error: 'account deletion service unavailable' }, 502, 'no-store');
  }
}

// 安全標頭在 Worker 出口補（只涵蓋 /api/* 與非資產路徑;靜態資產直出不經 Worker,標頭見根目錄 _headers）
const SEC_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};
const APP_ORIGINS = new Set(['capacitor://localhost', 'https://localhost']);

function addAppCors(headers, origin) {
  if (!APP_ORIGINS.has(origin)) return;
  headers.set('Access-Control-Allow-Origin', origin);
  const vary = (headers.get('Vary') || '').split(',').map(v => v.trim()).filter(Boolean);
  if (!vary.some(v => v.toLowerCase() === 'origin')) vary.push('Origin');
  headers.set('Vary', vary.join(', '));
}

// ── 台鐵準點統計「每日增量」cron(scheduled handler) ────────────────────────
// 把本機 python 腳本 scripts/ingest_tra_delay.py 的邏輯搬進 worker:每天自動抓 TDX
// 歷史 API 前一日資料 → 寫 D1 tra_delay_daily → 重建 kv_blobs 統計 blob(供 /api/
// delay-stats 唯讀吐回)。python 腳本留作手動備援,不動。解析/建列/聚合切成純函式並
// export const _ingest 供離線回歸測試;scheduled 只做 IO 編排。語意須與 python 版一致。
const HIST_DELAY_URL = 'https://tdx.transportdata.tw/api/historical/v2/Historical/Rail/TRA/LiveTrainDelay';
const DELAY_BLOB_KEY = 'tra_delay_stats_30d';
const DELAY_BLOB_NOTE = 'a=平均最終誤點(分,1位小數) p=準點率%(final_delay≤5,四捨五入整數) d=有紀錄天數 m=單日最大誤點(分)。最終誤點=最後回報站(終點前一站)離站時誤點';
const BLOB_WINDOW_DAYS = 30;   // 統計 blob 的日曆窗
const SCAN_WINDOW_DAYS = 35;   // 缺日偵測觀察窗
const MAX_DATES_PER_RUN = 3;   // 單次 cron 最多補幾天(避免單發吃太多 CPU/流量)
const D1_BATCH_SIZE = 80;      // 每個 batch() 最多幾句 prepared statement

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 日期工具:全走 UTC 計算(台北無日光節約,固定 +8);ISO 皆 YYYY-MM-DD。
function pad2(n) { return String(n).padStart(2, '0'); }
function isoFromDate(d) { return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }
function addDays(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoFromDate(new Date(Date.UTC(y, m - 1, d + delta)));
}
// SrcUpdateTime(UTC ISO,帶 +00:00 offset)→台北當地 { ms, date, hour }。
// P0 鐵則:SrcUpdateTime 是 UTC,跨日判斷務必先 +8 轉台北再看日期/時。
function twParts(srcIso) {
  const ms = Date.parse(srcIso);
  if (Number.isNaN(ms)) return null;
  const tw = new Date(ms + 8 * 3600 * 1000);
  return { ms, date: isoFromDate(tw), hour: tw.getUTCHours() };
}
// python datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ") 等價(去掉毫秒)
function utcStamp() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }

// python int():數字截尾、純整數字串可、其餘無效(回 null=跳過該筆)。
function toInt(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
  if (typeof v === 'string') { const s = v.trim(); return /^[+-]?\d+$/.test(s) ? parseInt(s, 10) : null; }
  return null;
}

// python round_half_up:對「數值的最短字串表示」做 ROUND_HALF_UP(逢五進位、遠離零),
// 回傳定小數位字串。刻意對字串(而非 double)取整——與 python Decimal(str(x)) 一致,避開
// JS Math.round(2.05*10)/10=2.0 而 python 得 2.1 的分歧(P0 明列的 .5 邊界地雷)。
function incDigits(s) {
  const a = s.split('');
  let i = a.length - 1;
  for (; i >= 0; i--) {
    if (a[i] === '9') a[i] = '0';
    else { a[i] = String.fromCharCode(a[i].charCodeAt(0) + 1); break; }
  }
  if (i < 0) a.unshift('1');
  return a.join('');
}
function roundHalfUpStr(value, ndigits) {
  let s = String(value);
  // 本資料域(分鐘級均值、0~100 百分率)不會出現指數表示;出現即屬非預期,直接擋下。
  if (s.indexOf('e') !== -1 || s.indexOf('E') !== -1) throw new Error('roundHalfUpStr exponent: ' + s);
  let neg = false;
  if (s[0] === '-') { neg = true; s = s.slice(1); }
  const dot = s.indexOf('.');
  const intPart = dot === -1 ? s : s.slice(0, dot);
  let frac = dot === -1 ? '' : s.slice(dot + 1);
  let roundUp = false;
  if (frac.length > ndigits) {
    roundUp = frac.charCodeAt(ndigits) - 48 >= 5;   // HALF_UP:首個捨去位 >=5 即進位
    frac = frac.slice(0, ndigits);
  } else {
    frac = frac.padEnd(ndigits, '0');
  }
  let digits = intPart + frac;
  if (roundUp) digits = incDigits(digits);
  let outInt, outFrac;
  if (ndigits === 0) { outInt = digits; outFrac = ''; }
  else {
    const cut = digits.length - ndigits;
    outInt = cut <= 0 ? '0' : digits.slice(0, cut);
    outFrac = cut <= 0 ? digits.padStart(ndigits, '0') : digits.slice(cut);
  }
  outInt = outInt.replace(/^0+(?=\d)/, '');
  let out = ndigits === 0 ? outInt : outInt + '.' + outFrac;
  // 本資料 DelayTime 恆 >=0 → 均值恆 >=0,不會生 -0.0;仍保守:結果為全零就去負號。
  if (neg && !/^0(\.0*)?$/.test(out)) out = '-' + out;
  return out;
}

// 解析 TDX JSONL 回應:剝 BOM、逐行 JSON.parse、只留四欄。解析失敗的行略過。
function parseDayEvents(text) {
  if (typeof text !== 'string') return [];
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);   // BOM 地雷
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    out.push({ TrainNo: r.TrainNo, StationID: r.StationID, DelayTime: r.DelayTime, SrcUpdateTime: r.SrcUpdateTime });
  }
  return out;
}

// 依 TrainNo 分組、SrcUpdateTime 轉台北時間後依時間排序。欄位缺漏/型別不對整筆跳過。
function groupAndSort(events) {
  const byTrain = new Map();
  for (const r of events) {
    if (r.SrcUpdateTime == null || r.TrainNo == null || r.StationID == null) continue;
    const tp = twParts(r.SrcUpdateTime);
    if (!tp) continue;
    const delay = toInt(r.DelayTime);
    if (delay == null) continue;
    const trainNo = String(r.TrainNo);
    let arr = byTrain.get(trainNo);
    if (!arr) { arr = []; byTrain.set(trainNo, arr); }
    arr.push({ ms: tp.ms, hour: tp.hour, delay, station: String(r.StationID), src: r.SrcUpdateTime });
  }
  for (const arr of byTrain.values()) arr.sort((a, b) => a.ms - b.ms);   // 穩定排序,同時間保留檔序
  return byTrain;
}

// 建 run + 跨日併回(語意逐字對齊 ingest_tra_delay.process_day)。
// serviceDate:當日 ISO;events:當日抓取原始事件;prevDayRows:前一日 D1 既有列
// (Map<train_no,{final_delay,max_delay,events,last_station,last_seen}>)。
// 回傳 { ownRows, mergedPrev }:ownRows=當日 INSERT OR REPLACE 列;mergedPrev=併回前一日 UPDATE。
function buildDayRows(serviceDate, events, prevDayRows) {
  const prevDate = addDays(serviceDate, -1);
  const byTrain = groupAndSort(events);
  const prev = prevDayRows instanceof Map ? prevDayRows : new Map(Object.entries(prevDayRows || {}));
  const ownRows = [];
  const mergedPrev = [];
  for (const [trainNo, evs] of byTrain) {
    const early = evs.filter(e => e.hour < 3);
    const rest = evs.filter(e => e.hour >= 3);
    const p = prev.get(trainNo);
    let mergeNow = false, alreadyAbsorbed = false;
    if (p != null && early.length) {
      const pl = twParts(String(p.last_seen));
      if (pl && pl.date === prevDate && pl.hour >= 22) mergeNow = true;             // 前一天跑到深夜 → 併回
      else if (pl && pl.date === serviceDate && pl.hour < 3) alreadyAbsorbed = true; // 上次已併過 → 冪等保護
    }
    if (mergeNow) {
      const last = early[early.length - 1];
      let em = early[0].delay;
      for (const e of early) if (e.delay > em) em = e.delay;
      mergedPrev.push({
        train_no: trainNo,
        final_delay: last.delay,
        max_delay: Math.max(toInt(p.max_delay), em),
        events: toInt(p.events) + early.length,
        last_station: last.station,
        last_seen: last.src,
      });
    }
    const own = (mergeNow || alreadyAbsorbed) ? rest : early.concat(rest);
    if (own.length) {
      const last = own[own.length - 1];
      let mx = own[0].delay;
      for (const e of own) if (e.delay > mx) mx = e.delay;
      ownRows.push({
        train_no: trainNo,
        final_delay: last.delay,
        max_delay: mx,
        events: own.length,
        last_station: last.station,
        last_seen: last.src,
      });
    }
  }
  return { ownRows, mergedPrev };
}

// 重建近 30 天(日曆窗:max(service_date) 往前 29 天)逐車次統計 blob。
// rows:{service_date,train_no,final_delay,max_delay}[];generatedIso:_meta.generated。
// 回傳 { _meta, trains, json }:trains={train_no:{a,p,d,m}}(數值,供測試);json 為緊湊字串
// (數字格式對齊 python json.dumps:a 帶小數點如 "5.0",p/d/m 為整數)。rows 空回 null。
function buildBlob(rows, generatedIso) {
  let maxDate = null;
  for (const r of rows) { const sd = String(r.service_date); if (maxDate === null || sd > maxDate) maxDate = sd; }
  if (maxDate === null) return null;
  const startDate = addDays(maxDate, -(BLOB_WINDOW_DAYS - 1));
  const byTrain = new Map();
  for (const r of rows) {
    const sd = String(r.service_date);
    if (sd < startDate || sd > maxDate) continue;
    const t = String(r.train_no);
    let g = byTrain.get(t);
    if (!g) { g = { finals: [], maxes: [] }; byTrain.set(t, g); }
    g.finals.push(toInt(r.final_delay));
    g.maxes.push(toInt(r.max_delay));
  }
  const trains = {};
  const parts = [];
  for (const [t, g] of byTrain) {
    const n = g.finals.length;
    let sum = 0, onTime = 0, m = g.maxes[0];
    for (const d of g.finals) { sum += d; if (d <= 5) onTime++; }
    for (const x of g.maxes) if (x > m) m = x;
    const aStr = roundHalfUpStr(sum / n, 1);
    const pStr = roundHalfUpStr(100 * onTime / n, 0);
    trains[t] = { a: Number(aStr), p: Number(pStr), d: n, m };
    parts.push(JSON.stringify(t) + ':{"a":' + aStr + ',"p":' + pStr + ',"d":' + n + ',"m":' + m + '}');
  }
  const nTrains = byTrain.size;
  const meta = { window_days: BLOB_WINDOW_DAYS, date_range: [startDate, maxDate], n_trains: nTrains, generated: generatedIso, note: DELAY_BLOB_NOTE };
  const json = '{"_meta":{"window_days":' + BLOB_WINDOW_DAYS
    + ',"date_range":[' + JSON.stringify(startDate) + ',' + JSON.stringify(maxDate) + ']'
    + ',"n_trains":' + nTrains
    + ',"generated":' + JSON.stringify(generatedIso)
    + ',"note":' + JSON.stringify(DELAY_BLOB_NOTE) + '}'
    + ',"trains":{' + parts.join(',') + '}}';
  return { _meta: meta, trains, json };
}

// 抓單日 TDX 歷史 LiveTrainDelay(JSONL,$top 必帶大值)。429 等 5 秒重試一次。
async function fetchDelayDay(token, dayIso) {
  const url = `${HIST_DELAY_URL}?Dates=${dayIso}&%24top=1000000&%24format=JSONL`;
  const headers = { authorization: 'Bearer ' + token, accept: 'application/json, text/plain, */*' };
  let r = await fetch(url, { headers });
  if (r.status === 429) { await sleep(5000); r = await fetch(url, { headers }); }
  if (r.status === 401) { tok = null; throw new Error('tdx 401 historical'); }
  if (!r.ok) throw new Error('tdx historical ' + r.status + ' for ' + dayIso);
  return await r.text();
}

// 把一日的 mergedPrev(UPDATE 前一日)+ ownRows(INSERT OR REPLACE 當日)分批寫入 D1。
async function writeDayRows(db, prevDate, dayIso, ownRows, mergedPrev) {
  const upd = db.prepare('UPDATE tra_delay_daily SET final_delay=?, max_delay=?, events=?, last_station=?, last_seen=? WHERE service_date=? AND train_no=?');
  const ins = db.prepare('INSERT OR REPLACE INTO tra_delay_daily (service_date, train_no, final_delay, max_delay, events, last_station, last_seen) VALUES (?,?,?,?,?,?,?)');
  const stmts = [];
  for (const r of mergedPrev) stmts.push(upd.bind(r.final_delay, r.max_delay, r.events, r.last_station, r.last_seen, prevDate, r.train_no));
  for (const r of ownRows) stmts.push(ins.bind(dayIso, r.train_no, r.final_delay, r.max_delay, r.events, r.last_station, r.last_seen));
  for (let i = 0; i < stmts.length; i += D1_BATCH_SIZE) await db.batch(stmts.slice(i, i + D1_BATCH_SIZE));
  return stmts.length;
}

// scheduled handler 的主流程(冪等:中途死掉下次 cron 自動從缺日續補)。
async function ingestDelayHistory(env) {
  const db = env.DELAY_DB;
  // 1. 缺日掃描:到「昨天」為止近 35 天(cron 跑台北 09:15/12:15,昨天必已發布)。
  const yesterday = isoFromDate(new Date(Date.now() + 8 * 3600 * 1000 - 24 * 3600 * 1000));
  const expected = [];
  for (let i = SCAN_WINDOW_DAYS - 1; i >= 0; i--) expected.push(addDays(yesterday, -i));   // 時間序,舊→新
  const since = expected[0];
  const existRes = await db.prepare('SELECT DISTINCT service_date FROM tra_delay_daily WHERE service_date >= ?').bind(since).all();
  const existing = new Set((existRes.results || []).map(r => String(r.service_date)));
  const missing = expected.filter(d => !existing.has(d));
  const todo = missing.slice(0, MAX_DATES_PER_RUN);
  console.log(`[cron delay] 窗 ${since}..${yesterday} 缺 ${missing.length} 天, 本次 ${JSON.stringify(todo)}`);

  const written = [];
  if (todo.length) {
    const token = await getToken(env);
    for (let i = 0; i < todo.length; i++) {
      const day = todo[i];
      if (i > 0) await sleep(2000);   // 兩日抓取間隔 2 秒(與即時代理共用金鑰 5 req/s 上限)
      const text = await fetchDelayDay(token, day);
      const events = parseDayEvents(text);
      if (events.length === 0) { console.log(`[cron delay] ${day} 空回應(尚未發布),跳過`); continue; }
      const prevDate = addDays(day, -1);
      const prevRes = await db.prepare('SELECT train_no, final_delay, max_delay, events, last_station, last_seen FROM tra_delay_daily WHERE service_date = ?').bind(prevDate).all();
      const prevRows = new Map((prevRes.results || []).map(r => [String(r.train_no), r]));
      const { ownRows, mergedPrev } = buildDayRows(day, events, prevRows);
      const nStmt = await writeDayRows(db, prevDate, day, ownRows, mergedPrev);
      written.push(day);
      console.log(`[cron delay] ${day}: 事件 ${events.length}, 本日列 ${ownRows.length}, 併回前一日 ${mergedPrev.length}, 寫入 ${nStmt} 句`);
    }
  }

  // 4. blob 重建:任何一天有寫入就做;零寫入時若 blob 迄日 < D1 max(service_date) 也做(自癒)。
  const dbMaxRow = await db.prepare('SELECT MAX(service_date) AS m FROM tra_delay_daily').first();
  const dbMax = dbMaxRow && dbMaxRow.m ? String(dbMaxRow.m) : null;
  let doBlob = written.length > 0;
  if (!doBlob && dbMax) {
    const blobRow = await db.prepare('SELECT v FROM kv_blobs WHERE k=?').bind(DELAY_BLOB_KEY).first();
    let blobMax = null;
    if (blobRow && blobRow.v) { try { blobMax = (JSON.parse(blobRow.v)._meta || {}).date_range[1] || null; } catch { blobMax = null; } }
    if (!blobMax || blobMax < dbMax) doBlob = true;
  }
  if (doBlob && dbMax) {
    const start = addDays(dbMax, -(BLOB_WINDOW_DAYS - 1));
    const rowsRes = await db.prepare('SELECT service_date, train_no, final_delay, max_delay FROM tra_delay_daily WHERE service_date >= ?').bind(start).all();
    const blob = buildBlob(rowsRes.results || [], utcStamp());
    if (blob) {
      await db.prepare("INSERT OR REPLACE INTO kv_blobs(k,v,updated) VALUES(?,?,datetime('now'))").bind(DELAY_BLOB_KEY, blob.json).run();
      console.log(`[cron delay] blob 重建: n_trains=${blob._meta.n_trains} range=${JSON.stringify(blob._meta.date_range)} bytes=${blob.json.length}`);
    }
  } else {
    console.log('[cron delay] blob 無需重建');
  }
  return { written, dbMax };
}

// 逐站事件保留期 30 天:刪掉台北今日往前 30 天以外的舊列(重用 addDays/twToday)。獨立於 delay ingest——
// 放進 scheduled 的 finally,ingest 成功或失敗(rethrow)都會執行;本函式失敗只由呼叫端 console.error、
// 不 rethrow,不動既有「ingest 失敗要 rethrow」的語意。
async function pruneStationEvents(env) {
  const cutoff = addDays(twToday(), -30);
  const r = await env.DELAY_DB.prepare('DELETE FROM tra_station_events WHERE service_date < ?').bind(cutoff).run();
  console.log(`[cron station-events] 清理 < ${cutoff}: ${(r.meta && r.meta.changes) || 0} 列`);
}

export default {
  // 每天台北 09:15 / 12:15 觸發(wrangler.jsonc triggers.crons)。錯誤 console.error 後
  // rethrow,讓 Cloudflare 把該次 cron 標記為失敗(observability 可查)。
  async scheduled(event, env) {
    try {
      const r = await ingestDelayHistory(env);
      console.log(`[cron delay] 完成: 寫入日 ${JSON.stringify(r.written)}, D1 迄日 ${r.dbMax}`);
    } catch (e) {
      console.error('[cron delay] 失敗:', (e && e.stack) || String(e));
      throw e;
    } finally {
      // 逐站事件保留期清理:獨立 try/catch,不影響上面 ingest 的成功/失敗(rethrow)語意;finally 確保 ingest 失敗也會跑
      try { await pruneStationEvents(env); }
      catch (e) { console.error('[cron station-events] 清理失敗:', (e && e.stack) || String(e)); }
    }
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    const isApi = url.pathname.startsWith('/api/');
    const origin = request.headers.get('Origin') || '';
    if (isApi && request.method === 'OPTIONS') {
      const h = new Headers(SEC_HEADERS);
      if (APP_ORIGINS.has(origin)) {
        addAppCors(h, origin);
        h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        h.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        h.set('Access-Control-Max-Age', '86400');
      }
      return new Response(null, { status: APP_ORIGINS.has(origin) ? 204 : 403, headers: h });
    }
    let res;
    if (url.pathname === '/api/tra-live') res = await traLive(request, env, ctx);
    else if (url.pathname === '/api/tra-alert') res = await traAlert(request, env);
    else if (url.pathname === '/api/thsr-alert') res = await thsrAlert(request, env);
    else if (url.pathname === '/api/metro-alert') res = await metroAlert(request, env);
    else if (url.pathname === '/api/metro-live') {
      const sys = url.searchParams.get('sys');
      // hasOwnProperty.call 而非 METRO_LIVE_OPS[sys]:後者吃原型鏈,sys='constructor' 等會誤過閘門
      res = Object.prototype.hasOwnProperty.call(METRO_LIVE_OPS, sys) ? await metroLive(request, env, sys) : jsonRes({ error: 'bad sys' }, 400, 'no-store');
    }
    else if (url.pathname === '/api/ntmetro-live') {
      const sys = url.searchParams.get('sys');
      res = NTM_LIVE_SYS.has(sys) ? await ntmetroLive(request, env, sys) : jsonRes({ error: 'bad sys' }, 400, 'no-store');
    }
    else if (url.pathname === '/api/delay-stats') res = await delayStats(request, env);
    else if (url.pathname === '/api/delay-history') res = await delayHistory(request, env);
    else if (url.pathname === '/api/station-events') res = await stationEvents(request, env);
    else if (url.pathname === '/api/today-board') res = await todayBoard(request, env);
    else if (url.pathname === '/api/account-delete') res = await deletePaidProfile(request, env);
    else res = await env.ASSETS.fetch(request);
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(SEC_HEADERS)) h.set(k, v);
    if (isApi) addAppCors(h, origin);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  },
};

// 純函式導出,供離線回歸測試 import(不影響 fetch/scheduled 執行路徑)。
export const _ingest = { parseDayEvents, buildDayRows, buildBlob, roundHalfUpStr, addDays, twParts };
// 純函式導出,供離線回歸測試 import:metroAlert 的 per-op last-known-good + News/TYMC 過濾轉換。
export const _metroAlert = {
  metroAlertOpFallback, isRecentNews, isIncidentNewsTitle,
  stripHtmlAndTruncate, formatNewsTitle, mapNewsToAlert, filterAndMapNews,
};
// 純函式導出,供離線回歸測試 import:逐站事件 diff 與 mem.at→台北日換算。
export const _stationEvents = { diffTrains, twDayFromMemAt };
// 純函式導出,供離線回歸測試 import:誤點履歷視窗計算、車次驗證與回應組裝。
export const _delayHistory = { delayHistoryWindow, buildDelayHistoryBody, isValidTrainNo };
