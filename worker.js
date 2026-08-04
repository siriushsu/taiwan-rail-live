import {
  TRTC_LEDGER_SCHEMA, buildTrtcModel, buildLedgerFromRaw,
  trtcOperatingState, trtcServiceDay, resolveBoardRows, claimBoardRows, collapseClaims,
} from './scripts/trtc_board_ledger.mjs';

// Cloudflare Worker 入口:靜態資產(assets binding)+ /api/tra-live 台鐵即時動態代理
// + /api/tra-alert 台鐵營運通阻公告 + /api/thsr-alert 高鐵營運狀態公告(颱風停駛等)
// + /api/metro-alert 捷運營運狀態公告(五家聚合)
// + /api/hazard-alert NCDR 生效中災害示警(只當營運檢查觸發器,不參與列車名冊/位置)
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

// 災害示警觸發器:NCDR 官方「生效中的示警」總 JSON,免 key、每分鐘更新。
// 這層只回答「現在有沒有值得加強監看的外部事件」；不把災害推定成鐵路異常，更不會改列車名冊或位置。
// 用總 feed 一次抓回再篩選，避免颱風/地震/降雨/雷雨四支各打一次而放大 NCDR 流量。
const NCDR_ACTIVE_HAZARD_URL = 'https://alerts.ncdr.nat.gov.tw/JSONAtomFeeds.ashx';
const HAZARD_TYPES = [
  '土石流及大規模崩塌', '颱風', '地震', '雷雨', '降雨', '強風', '海嘯', '淹水', '火山',
];
const HAZARD_MEM_TTL_MS = 60e3;
const HAZARD_FAIL_TTL_MS = 30e3;
const HAZARD_FETCH_TIMEOUT_MS = 8e3;
let hazardMem = null, hazardMemAt = 0, hazardRefresh = null, hazardFailAt = 0;

function ncdrText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return value.map(ncdrText).find(Boolean) || '';
  if (typeof value === 'object') return ncdrText(value['#text'] ?? value._ ?? value['@term'] ?? value.term ?? value.name ?? value.title);
  return '';
}

// NCDR JSON feed 的 effective/expires 實測會是「2026/7/23 下午 11:30:00」；Date.parse 在不同
// runtime 對中文上午/下午不一致，所以明確換成 UTC epoch。ISO 8601 則先交給 Date.parse。
function ncdrTimeMs(value) {
  const text = ncdrText(value);
  if (!text) return null;
  const direct = Date.parse(text);
  if (Number.isFinite(direct)) return direct;
  const m = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(上午|下午)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  let hour = Number(m[5]) % 12;
  if (m[4] === '下午') hour += 12;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, Number(m[6]), Number(m[7] || 0)) - 8 * 3600e3;
}

function ncdrHazardType(entry) {
  const categories = Array.isArray(entry && entry.category) ? entry.category : [entry && entry.category];
  const text = categories.map(ncdrText).filter(Boolean).concat(ncdrText(entry && entry.title)).join(' ');
  return HAZARD_TYPES.find(type => text.includes(type)) || null;
}

// 官方 Atom extension 在 XML/部分 JSON 轉換器會保留 cap: 前綴；舊版總 JSON 則可能攤平成無前綴鍵。
// 兩種都讀，但缺欄位不猜：狀態或有效期無法確認的 entry 不得觸發正式監看。
function ncdrField(entry, name) {
  return entry && (entry[`cap:${name}`] ?? entry[name]);
}

function normalizeNcdrHazards(feed, nowMs = Date.now()) {
  const root = feed && feed.feed && typeof feed.feed === 'object' ? feed.feed : feed;
  const entries = Array.isArray(root && root.entry) ? root.entry : (root && root.entry ? [root.entry] : []);
  const hazards = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const status = ncdrText(ncdrField(entry, 'status'));
    const msgType = ncdrText(ncdrField(entry, 'msgType'));
    if (status !== 'Actual') continue; // 缺 status 也 fail-closed；Test/Exercise/Draft 不可喚醒正式監看
    if (!/^(Alert|Update)$/i.test(msgType)) continue; // Cancel/Error/Ack 與缺值都不可沿用成有效示警
    const type = ncdrHazardType(entry);
    if (!type) continue;
    const effective = ncdrText(ncdrField(entry, 'effective'));
    const expires = ncdrText(ncdrField(entry, 'expires'));
    const effectiveMs = ncdrTimeMs(effective), expiresMs = ncdrTimeMs(expires);
    if (!Number.isFinite(effectiveMs) || !Number.isFinite(expiresMs)) continue;
    if (effectiveMs > nowMs || expiresMs <= nowMs) continue;
    const id = ncdrText(entry.id);
    if (!id) continue; // 沒穩定 id 無法在前端去重，fail-closed 不觸發
    hazards.push({
      id, type, title: ncdrText(entry.title) || type,
      updated: ncdrText(entry.updated), effective, expires,
      effectiveAt: new Date(effectiveMs).toISOString(), expiresAt: new Date(expiresMs).toISOString(),
    });
  }
  return hazards.sort((a, b) => a.id.localeCompare(b.id));
}

function resetHazardMem() { hazardMem = null; hazardMemAt = 0; hazardRefresh = null; hazardFailAt = 0; }

function refreshHazardMem(env) {
  if (hazardRefresh) return hazardRefresh; // 同 isolate cache miss 共流，避免同一瞬間所有訪客一起打 NCDR
  hazardRefresh = (async () => {
    const sourceUrl = (env && env.NCDR_ALERT_URL) || NCDR_ACTIVE_HAZARD_URL; // 測試可注入本機 fixture；正式環境不設即鎖官方源
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HAZARD_FETCH_TIMEOUT_MS);
    let r;
    try {
      r = await fetch(sourceUrl, { headers: { accept: 'application/json' }, signal: controller.signal });
    } catch (e) {
      if (controller.signal.aborted) throw new Error('ncdr timeout');
      throw e;
    } finally { clearTimeout(timer); }
    if (!r.ok) throw new Error('ncdr api ' + r.status);
    const d = await r.json();
    const root = d && d.feed && typeof d.feed === 'object' ? d.feed : d;
    hazardMem = {
      at: ncdrText(root && root.updated) || new Date().toISOString(), observedAt: new Date().toISOString(),
      source: 'NCDR', stale: false, hazards: normalizeNcdrHazards(d, Date.now()),
    };
    hazardMemAt = Date.now(); hazardFailAt = 0;
  })().catch(e => { hazardFailAt = Date.now(); throw e; })
    .finally(() => { hazardRefresh = null; });
  return hazardRefresh;
}

async function hazardAlert(request, env) {
  const cacheKey = new Request(new URL('/api/hazard-alert', request.url), { method: 'GET' });
  const edge = caches.default;
  const hit = await edge.match(cacheKey);
  if (hit) return hit;
  try {
    if (!hazardMem || Date.now() - hazardMemAt > HAZARD_MEM_TTL_MS) {
      if (!hazardMem && hazardFailAt && Date.now() - hazardFailAt < HAZARD_FAIL_TTL_MS) throw new Error('ncdr cooldown');
      await refreshHazardMem(env);
    }
    const res = jsonRes(hazardMem, 200, 'public, s-maxage=60, stale-while-revalidate=60');
    await edge.put(cacheKey, res.clone());
    return res;
  } catch (e) {
    // NCDR 短暫失敗時沿用 isolate 內最後成功狀態並明標 stale；不要因一輪 429 就把仍生效的監看關掉。
    if (hazardMem) {
      const now = Date.now();
      const hazards = hazardMem.hazards.filter(h => {
        const expires = ncdrTimeMs(h.expiresAt || h.expires);
        return Number.isFinite(expires) && expires > now;
      });
      const res = jsonRes({ ...hazardMem, stale: true, hazards }, 200, 'public, s-maxage=30');
      await edge.put(cacheKey, res.clone());
      return res;
    }
    // 冷啟動失敗也短暫負向快取；仍回 502，前端會保留舊狀態，不把「來源掛掉」解讀成「災害解除」。
    const res = jsonRes({ error: 'hazard_not_ready' }, 502, 'public, s-maxage=30');
    await edge.put(cacheKey, res.clone());
    return res;
  }
}

// 每分鐘 cron 先看災害；有生效事件才喚醒三個既有官方營運公告端點。端點自己的 110 秒雙層快取
// 仍是上游節流閘，所以 cron 每分鐘執行不等於每分鐘重打 TDX。北捷列車資料則沿用同一分鐘本來就會跑的
// trtcLedgerScheduled，不因災害多打一份上游，也不把災害訊號混進列車存在性。
async function hazardMonitorScheduled(event, env) {
  const base = 'https://railisland.tw';
  const r = await hazardAlert(new Request(base + '/api/hazard-alert'), env);
  if (!r.ok) throw new Error('hazard api ' + r.status);
  const d = await r.json();
  const hazards = Array.isArray(d && d.hazards) ? d.hazards : [];
  if (!hazards.length) return { active: 0, announcements: false };
  const settled = await Promise.allSettled([
    traAlert(new Request(base + '/api/tra-alert'), env),
    thsrAlert(new Request(base + '/api/thsr-alert'), env),
    metroAlert(new Request(base + '/api/metro-alert'), env),
  ]);
  return { active: hazards.length, announcements: true,
    failed: settled.filter(x => x.status === 'rejected' || !(x.value && x.value.ok)).length };
}

function hazardMonitorWithTimeout(event, env, timeoutMs = 12000) {
  let timer;
  return Promise.race([
    hazardMonitorScheduled(event, env),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('hazard timeout')), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
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

// ── 北捷官方會員 API 代理(逐車位置) ──
// 帳密只在 Worker:這套認證把帳密明文放 request body,前端直連＝公開帳密(repo 是 PUBLIC)。
// 三支並行:CarWeight(高運量逐車) / CarWeightBR(文湖線逐車) / TrackInfo(終點與未來路徑)。
// TrackInfo 掛掉只退化成「無未來路徑」,不讓整包失敗。TTL 15s 配合上游更新頻率
// (實測 NowDateTime 每 15 秒換值;現制 /api/metro-live 的 115s 對逐車太久,車 2 分鐘就過一站)。
const TRTC_SOAP = (inner) =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${inner}</soap:Body></soap:Envelope>`;
// .asmx 直接 Response.Write 一段 JSON、其後才接空 SOAP envelope ⇒ 抓開頭 JSON;
// 例外:CarWeightBR 包在 <...Result> 內。兩種都試。實測(2026-08-01)兩條路徑皆有命中,維持原樣。
function trtcParse(txt) {
  let m = txt.match(/^\s*(\[[\s\S]*?\])\s*(?=<\?xml|<soap)/);
  if (m) { try { return JSON.parse(m[1]); } catch (e) { /* fall through */ } }
  m = txt.match(/<\w*Result>([\s\S]*?)<\/\w*Result>/);
  if (m) { try { return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')); } catch (e) { /* fall through */ } }
  return null;
}
async function trtcCall(url, method, env) {
  const cred = `<userName>${env.TRTC_API_USER}</userName><passWord>${env.TRTC_API_PASS}</passWord>`;
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    body: TRTC_SOAP(`<${method} xmlns="http://tempuri.org/">${cred}</${method}>`) });
  if (!r.ok) throw new Error(method + ' ' + r.status);
  const d = trtcParse(await r.text());
  // 上游故障會回 HTML 錯誤頁但 HTTP 仍 200(規格書「列車位置」端點即如此,本設計不用它)⇒ 解不出 JSON 視同失敗
  if (!Array.isArray(d)) throw new Error(method + ' 非陣列回應');
  return d;
}
function trtcApiUrl(env, endpoint) {
  const base = String((env && env.TRTC_API_BASE) || 'https://api.metro.taipei').replace(/\/$/, '');
  return `${base}/metroapi/${endpoint}.asmx`;
}
// 官方時刻字串 "2026-07-31 22:12:27"(台北時間,無時區標示)→ epoch 秒
function trtcEpoch(s) {
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000) - 8 * 3600;
}
// 上游偶爾對同一車次回多筆「抵站歷史」而非現況:文湖線 CarWeightBR 實測(2026-08-01 07:40)
// 31 筆/17 唯一車次,13 筆是舊站舊時刻的重複列(同車次兩筆站碼與 UpdateTime 一起往回走,
// 例:BR04@07:34:22 → BR03@07:36:31)。高運量 CarWeight 同時段 69/69 零重複,但同供應商
// 同形狀的資料,防禦性地兩支都套用去重,不留「只驗過其中一支」的假設。
// 依 TrainNumber 分組只留 timeField 最新(epoch 最大)的一筆。
function dedupeLatest(rows, timeField) {
  const latest = new Map(); // TrainNumber → { row, t }
  for (const r of rows) {
    const t = trtcEpoch(r[timeField]);
    if (t == null) continue;
    const prev = latest.get(r.TrainNumber);
    if (!prev || t > prev.t) latest.set(r.TrainNumber, { row: r, t });
  }
  return [...latest.values()].map(v => v.row);
}
// 每節車廂擁擠度(task-12,TDX 沒有的官方獨家資料,免費):高運量 6 節、文湖線 4 節,節數不同
// 但值域是同一套 4 級(見官方新聞稿,2022-06-22)。worker 這層只搬運不解讀:不做等級對映、
// 不依 sys 分岔語意——標籤與顏色統一在前端一處決定。缺值就整個不帶欄位(回傳 null),
// 不要塞 0/null 進陣列——下游要能用「有沒有這個欄位」判斷可用性,混進假值會讓 UI 畫出
// 不存在的空車廂。
// 複審 Important 2(task-12):值域必須收在官方 1–4 級的整數,不能只擋「非正數」——
// 上游若曾送出 9/5/2.5 這類值域外的髒值,前端逐格對照表(TRTC_CROWD[v])查無對應項會
// 整格跳過不畫,導致「少畫一格、整條左移」(fail-shifted,指到錯的節次),比整條不顯示更糟
// (需求書原文:「講錯方向比不講更糟」)。任何一格出界,整讀視同缺值,整個 cars 欄位不帶。
const carsOf = (r, keys) => {
  const v = keys.map(k => Number(r[k]));
  return v.every(x => Number.isInteger(x) && x >= 1 && x <= 4) ? v : null;
};
let trtcMem = null; // { data, at }
// 記憶體層門檻抽成獨立可測函式(task-11):驗收腳本要直接量這個條件式的邊界(14999/15001ms),
// 不透過真的等待 15 秒,也不靠讀常數字面值反推——見 verify_trtc_freshness.mjs。
function trtcMemoStale(stale, now) { return !stale || now - stale.at > 15e3; }
async function trtcLive(request, env) {
  const cacheKey = new Request(new URL('/api/trtc-live', request.url), { method: 'GET' });
  const edge = caches.default;
  const hit = await edge.match(cacheKey);
  if (hit) return hit;
  const stale = trtcMem;
  try {
    if (trtcMemoStale(stale, Date.now())) {
      // 三支各自吞錯:任一支當輪打不到不該拖垮其他支(文湖線抖一下不該讓高運量 69 台一起熄燈)。
      // TrackInfo 是加值(終點＋未來路徑),掛掉只退化成「無未來路徑」。
      const [hwRaw, brRaw, tk] = await Promise.all([
        trtcCall(trtcApiUrl(env, 'CarWeight'), 'getCarWeightByInfoEx', env).catch(() => []),
        trtcCall(trtcApiUrl(env, 'CarWeightBR'), 'getCarWeightBRInfo', env).catch(() => []),
        trtcCall(trtcApiUrl(env, 'TrackInfo'), 'getTrackInfo', env).catch(() => []),
      ]);
      // hw 與 br 只有一支空 ⇒ 該系統當輪沒車(或暫時打不到),另一支照常輸出;
      // 兩支都空才算整體真的掛了,走下面 catch 的降級路徑。
      if (hwRaw.length === 0 && brRaw.length === 0) throw new Error('trtc hw/br 全空,上游疑似全掛');
      const hw = dedupeLatest(hwRaw, 'utime');
      const br = dedupeLatest(brRaw, 'UpdateTime');
      // 車次 → { dest, path[] }。TrackInfo 一台車在前方數站各一筆。
      // CountDown 的值域**不是**只有 MM:SS 與「列車進站」——實測至少還有「營運時間已過」「資料擷取中」
      // 「月台暫停服務」,而且是一個晚上陸續冒出來的,不可當成窮舉。解不出秒數一律丟列(fail-closed),
      // 未知的第 N 種值也一樣被丟掉;丟掉幾列由下面的 cd:{rows,dropped} 回報給驗收腳本。
      const meta = new Map();
      // 🔴 觀測性(複審第二輪 Important 4):解不出時刻一律 fail-closed 跳過是對的行為,但跟 board
      // 一樣不可以「靜默」丟——上游哪天在部分列停送 NowDateTime,path 會靜默縮水,症狀是地圖與卡片
      // 退回表定班次,看起來像「沒有官方資料」而不是「我們把資料丟了」,兩者要能從回傳分得開。
      // pathNoTrainNo(task-12 補記):board 迴圈(下面)不濾 TrainNumber,path 迴圈這裡濾,
      // 兩邊各自對 tk.length 的差額若沒有計數器會對不上帳——上游若哪天對更多列停送
      // TrainNumber,path 會靜默縮水成「看起來只是資料變少」而非「我們把它丟了」,和
      // pathCdDropped/pathDateDropped 同一組觀測性缺口,只補計數不改行為。
      let pathCdDropped = 0, pathDateDropped = 0, pathNoTrainNo = 0, carsRejected = 0;
      for (const r of tk) {
        if (!r.TrainNumber) { pathNoTrainNo++; continue; }
        let e = meta.get(r.TrainNumber);
        if (!e) meta.set(r.TrainNumber, e = { dest: r.DestinationName || null, path: [] });
        const cd = String(r.CountDown);
        const mm = cd.match(/^(\d+):(\d+)$/);
        const sec = mm ? (+mm[1] * 60 + +mm[2]) : (cd === '列車進站' ? 0 : null);
        if (sec == null) { pathCdDropped++; continue; }
        // 基準比照下面 board 的做法(:539-541)用上游自己的 NowDateTime,不用我們的 fetch 時刻。
        // 這裡原本是迴圈外算一次的 Date.now(),與 board 各自的 per-row NowDateTime 基準不一致
        // ——複審實測兩者對同一批 tk 列算出的 eta 差 6~10 秒(=Date.now()−NowDateTime 這個固定量,
        // 不是雜訊),導致卡片(讀這裡的 path）／地圖 trtcPos(也讀 path)比看板／上游實際時刻系統性偏晚。
        // 解不出上游時刻就跳過這筆,不用我們的時刻頂替(比照 board 的 :541)。
        const base = trtcEpoch(r.NowDateTime);
        if (base == null) { pathDateDropped++; continue; }
        e.path.push({ name: String(r.StationName || '').replace(/站$/, ''), eta: base + sec });
      }
      for (const e of meta.values()) e.path.sort((a, b) => a.eta - b.eta);
      // 看板列:TrackInfo 原始列就是月台告示牌的內容(319 筆涵蓋 118 站=北捷全部車站)。
      // ⚠️ 2026-08-03:上面這句是**未經驗證的斷言**——沒有人拿實體月台顯示器跟畫面同框比對過。
      // 已驗證的只到「我方看板列 == 獨立打上游 getTrackInfo 逐列相等」(verify_trtc_board.mjs:89)。
      // 對外文案不得據此宣稱「和站內顯示器一致」(2026-08-03 已把更新紀錄兩條改掉)。
      // 基準時刻用上游自己的 NowDateTime,不用我們的 fetch 時刻——實測上游資料可落後約 15 秒,
      // 用 fetch 時刻會讓倒數系統性樂觀。不從 trains 反推:join 不到車次的車(文湖線尤其)
      // 會整批消失,看板會缺列,故直接對 tk 原始列各自取值。
      // 🔴 觀測性(複審 Minor):解不出秒數就丟列是正確且 fail-closed 的行為(未知的第四種值也一樣
      // 被丟掉),但「靜默丟掉」會讓「上游把常態值換成新寫法」偽裝成「現在是深夜、上游本來就沒列」
      // ——涵蓋判準只會走「跳過B:上游 feed 沒有這一站的列」。這裡只加計數不改行為,讓兩者分得開。
      // 實測第三種非時間值:「營運時間已過」(末班後整批出現),brief 第 24 行寫「唯一非時間值是
      // 列車進站」是錯的。
      const board = [];
      let cdDropped = 0, boardDateDropped = 0;
      for (const r of tk) {
        const cd = String(r.CountDown);
        const mm = cd.match(/^(\d+):(\d+)$/);
        const sec = mm ? (+mm[1] * 60 + +mm[2]) : (cd === '列車進站' ? 0 : null);
        if (sec == null) { cdDropped++; continue; }
        const base = trtcEpoch(r.NowDateTime);
        // 複審第二輪 Important 4:這裡原本沒計數,和上面 board 的 cdDropped 不對稱——補上,
        // 讓「NowDateTime 這個上游欄位開始壞掉」不會偽裝成「這班車本來就不在 board 上」。
        if (base == null) { boardDateDropped++; continue; }
        board.push({ name: String(r.StationName || ''), dest: String(r.DestinationName || ''),
                     eta: base + sec, no: String(r.TrainNumber || '') });
      }
      const trains = [];
      for (const r of hw) {
        const m = meta.get(r.TrainNumber);
        const cars = carsOf(r, ['Cart1L', 'Cart2L', 'Cart3L', 'Cart4L', 'Cart5L', 'Cart6L']);
        if (!cars) carsRejected++; // 複審第二輪 Important 4:整讀拒收(缺值或值域外)也要計數,理由同 :551-553
        trains.push({ no: String(r.TrainNumber), sys: 'hw', dir: +r.CID, stn: r.StationID,
          at: trtcEpoch(r.utime), dest: m ? m.dest : null, path: m ? m.path : [], ...(cars ? { cars } : {}) });
      }
      for (const r of br) {
        const no = String(r.TrainNumber);
        // meta 的鍵全部來自 TrackInfo 的 TrainNumber;TrackInfo 對文湖線只給站名/倒數,
        // 該線各列 TrainNumber 恆為空字串(上面建 meta 時已被 `if (!r.TrainNumber) continue`
        // 濾掉),⇒ meta 裡不可能存在任何合法的文湖線鍵。舊寫法多一層
        // `meta.get(no.split(',')[0])`,把 "137,200" 降級比對成 "137" 去撞高運量的車次鍵,
        // 是穩定的假匹配(實測 2026-08-01,4 個車次 34 筆全部撞錯),不是偶發噪音。
        // 這裡只做 exact match——對現有上游形狀恆為 undefined,不做任何降級比對。
        const m = meta.get(no);
        const cars = carsOf(r, ['Car1', 'Car2', 'Car3', 'Car4']);
        if (!cars) carsRejected++; // 同上,hw/br 合計一個計數器即可(不分系統),只加計數不改行為
        trains.push({ no, sys: 'br', dir: +r.CID, stn: r.StationID,
          at: trtcEpoch(r.UpdateTime), dest: m ? m.dest : null, path: m ? m.path : [], ...(cars ? { cars } : {}) });
      }
      const legacy = { at: new Date().toISOString(), src: 'trtc',
        trains: trains.filter(t => t.at != null && /^[A-Z]+\d+$/.test(t.stn) && (t.dir === 1 || t.dir === 2)),
        board, cd: { rows: tk.length, dropped: cdDropped, dateDropped: boardDateDropped,
          pathDropped: pathCdDropped, pathDateDropped, pathNoTrainNo, carsRejected } };
      // 前端逐班校正只消費這份「物理位置錨點」。站名正規化、支線/終點消歧與
      // 倒數是否真能證明車在上一區間，全部復用 B1 已驗的純函式，不在前端重造一套。
      // 錨點沒有列車名冊欄位，更不會產生車；它只說「這裡有一筆可用位置證據」。
      let boardPos = { at: null, rows: [], dropped: {} };
      try { boardPos = await trtcBoardPositionAnchors(env, tk); }
      catch (e) { console.error('[trtc board-pos] 錨點組裝失敗:', (e && e.stack) || String(e)); }
      // legacy 的 at/src/trains/board/cd 產生路徑與欄位順序不動；帳本預覽失敗一律
      // 回空陣列，不能拖垮原本逐車 API。
      let ledger = [];
      try { ledger = await trtcLedgerPreview(env, hwRaw, brRaw, tk); }
      catch (e) { console.error('[trtc ledger] API 組裝失敗:', (e && e.stack) || String(e)); }
      trtcMem = { data: { ...legacy, boardPos, ledger }, raw: { hw: hwRaw, br: brRaw, tk }, at: Date.now() };
    }
    const res = jsonRes(trtcMem.data, 200, 'public, s-maxage=15, stale-while-revalidate=120');
    await edge.put(cacheKey, res.clone());
    return res;
  } catch (e) {
    // stale 快取設 5 分鐘齡限:TTL 15s 的資料若因上游持續掛掉而擺到 5 分鐘還沒更新,
    // 列車實際位置可能已經跑出 2-3 站,繼續標成 src:'trtc' 送出去是主動誤導,不如降級成 null。
    if (stale && Date.now() - stale.at < 5 * 60e3) return jsonRes(stale.data, 200, 'public, s-maxage=15');
    // 軟失敗:回 200+src:null(前端 applyTrtcLive 對 null 直接 no-op,退回時刻表＋現制看板校正)。
    // 負向結果也快取 15s,免得上游持續掛時每個請求 1:1 重打上游。不帶 error 字串進 body。
    // board 不帶(降級時看板前端直接退回 _tt 路徑,不需要空陣列以外的形狀)。
    // cd 一併帶上(值為 0/0):少了它,驗收腳本的觀測性斷言會紅在「worker 沒回 cd 欄位」,
    // 把「上游掛掉」這個環境問題指成程式缺陷(Re-review-2 P-5)。
    let ledger = [];
    try { ledger = await trtcLedgerMaterialized(env, Math.floor(Date.now() / 1000)); } catch (e) {}
    const res = jsonRes({ at: new Date().toISOString(), src: null, trains: [], board: [], boardPos: { at: null, rows: [], dropped: {} },
      cd: { rows: 0, dropped: 0, dateDropped: 0, pathDropped: 0, pathDateDropped: 0, pathNoTrainNo: 0 }, ledger }, 200, 'public, s-maxage=15');
    await edge.put(cacheKey, res.clone());
    return res;
  }
}

// ── 北捷看板事件帳本(B1):D1 編排層 ──
// 事件推導與身分指派全在 scripts/trtc_board_ledger.mjs 的純函式；這裡只負責資產、上游、D1。
let trtcLedgerModelPromise = null;
let trtcBoardModelPromise = null;
let trtcLedgerSchemaReady = false;

async function trtcLedgerAssetJson(env, path) {
  const r = await env.ASSETS.fetch(new Request(`https://assets.local/${path}`));
  if (!r.ok) throw new Error(`ledger asset ${path} ${r.status}`);
  return r.json();
}

function trtcModelSources(env) {
  return Promise.all([
    trtcLedgerAssetJson(env, 'data/trtc.json'),
    trtcLedgerAssetJson(env, 'data/trtc_times.json'),
    trtcLedgerAssetJson(env, 'data/trtc_codes.json'),
  ]);
}

async function trtcLedgerModel(env) { // 帳本用:排除 Y(不佔 D1 寫入額度)
  if (!trtcLedgerModelPromise) trtcLedgerModelPromise = trtcModelSources(env)
    .then(([trtc, times, codes]) => buildTrtcModel(trtc, times, codes));
  return trtcLedgerModelPromise;
}

async function trtcBoardModel(env) { // 前端位置錨點用:含 Y(同一份 TrackInfo 已夾帶,不多打上游也不多寫帳本)
  if (!trtcBoardModelPromise) trtcBoardModelPromise = trtcModelSources(env)
    .then(([trtc, times, codes]) => buildTrtcModel(trtc, times, codes, { includeY: true }));
  return trtcBoardModelPromise;
}

async function ensureTrtcLedger(env) {
  if (!env || !env.TRTC_LEDGER) return false;
  if (!trtcLedgerSchemaReady) {
    await env.TRTC_LEDGER.batch(TRTC_LEDGER_SCHEMA.map(sql => env.TRTC_LEDGER.prepare(sql)));
    trtcLedgerSchemaReady = true;
  }
  return true;
}

async function trtcLedgerContext(env, day, nowEpoch) {
  if (!await ensureTrtcLedger(env)) return { priorTracks: [], aliases: [], historicalEvents: [] };
  const db = env.TRTC_LEDGER;
  const [tracks, aliases, events] = await Promise.all([
    db.prepare(`SELECT day,track_id,line,dir,station_idx,progress,official_no,crowd,evidence,
        evidence_epoch,last_seen_epoch,payload FROM trtc_tracks
        WHERE day=? AND last_seen_epoch>=?`).bind(day, nowEpoch - 30 * 60).all(),
    db.prepare(`SELECT day,alias_type,alias,track_id,first_seen_epoch,last_seen_epoch
        FROM trtc_track_aliases WHERE day=?`).bind(day).all(),
    // 同一分鐘重跑必須用同一組基線：本分鐘才寫的事件不可立刻回頭改變本分鐘的 run。
    db.prepare(`SELECT day,line,dir,train_key,station_idx,kind,epoch,src,state
        FROM trtc_events WHERE day=? AND kind='arr' AND state<>'forecast' AND updated_epoch<?
        ORDER BY epoch DESC LIMIT 4000`).bind(day, nowEpoch).all(),
  ]);
  return {
    priorTracks: tracks.results || [], aliases: aliases.results || [], historicalEvents: events.results || [],
  };
}

function trtcBoardEpoch(rows, fallbackEpoch) {
  let newest = null;
  for (const row of rows || []) {
    const t = trtcEpoch(row && row.NowDateTime);
    if (Number.isFinite(t) && (newest == null || t > newest)) newest = t;
  }
  return newest == null ? fallbackEpoch : newest;
}

let trtcBoardBranchHintDay = null;
let trtcBoardBranchHints = new Map();
let trtcBoardBranchHintsLoaded = false;

async function loadTrtcBoardBranchHints(env, day) {
  if (!await ensureTrtcLedger(env)) return new Map();
  const result = await env.TRTC_LEDGER.prepare(`SELECT a.alias,t.line
      FROM trtc_track_aliases a JOIN trtc_tracks t ON t.day=a.day AND t.track_id=a.track_id
      WHERE a.day=? AND a.alias_type='hw_no' AND t.line IN ('O_LUZHOU','O_XINZHUANG')`)
    .bind(day).all();
  return new Map((result.results || []).map(x => [String(x.alias), String(x.line)]));
}

async function trtcBoardPositionAnchors(env, rows) {
  const nowEpoch = trtcBoardEpoch(rows, Math.floor(Date.now() / 1000));
  const day = trtcServiceDay(nowEpoch);
  if (trtcBoardBranchHintDay !== day) {
    trtcBoardBranchHintDay = day;
    trtcBoardBranchHints = new Map();
    trtcBoardBranchHintsLoaded = false;
  }
  if (!trtcBoardBranchHintsLoaded) {
    try {
      for (const [no, line] of await loadTrtcBoardBranchHints(env, day)) trtcBoardBranchHints.set(no, line);
      trtcBoardBranchHintsLoaded = true;
    } catch (e) {
      console.warn('[trtc board-pos] 橘線分支提示讀取失敗:', (e && e.message) || String(e));
    }
  }
  const model = await trtcBoardModel(env);
  const resolved = resolveBoardRows(model, rows, trtcEpoch, trtcBoardBranchHints);
  trtcBoardBranchHints = resolved.lineHints;
  const claimed = claimBoardRows(model, resolved.rows, nowEpoch, new Map());
  const collapsed = collapseClaims(claimed.claims);
  return {
    at: nowEpoch,
    rows: collapsed.map(x => ({ line: x.line, dir: x.dir, from: x.from, to: x.to,
      dest: x.destIdx, run: x.run, arrEpoch: x.arrEpoch, no: x.no || '', terminal: !!x.terminal })),
    dropped: { ...resolved.dropped, unclaimed: claimed.unclaimed.length,
      collapsed: claimed.claims.length - collapsed.length,
      branchHinted: resolved.branch.hinted, branchFallback: resolved.branch.fallback,
      branchConflicts: resolved.branch.conflicts },
  };
}

function ledgerTrackRows(updates) {
  return (updates || []).map(x => ({
    day: x.day, track_id: x.trackId, line: x.line, dir: x.dir, station_idx: x.stationIdx,
    progress: x.progress, official_no: x.officialNo, crowd: x.crowd == null ? null : JSON.stringify(x.crowd),
    evidence: x.evidence, evidence_epoch: x.evidenceEpoch, last_seen_epoch: x.lastSeenEpoch,
    payload: JSON.stringify(x.payload),
  }));
}

function ledgerEventRows(events) {
  return (events || []).map(x => ({
    day: x.day, line: x.line, dir: x.dir, train_key: x.trackId, station_idx: x.stationIdx,
    kind: x.kind, epoch: x.epoch, src: x.src,
    crowd: x.crowd == null ? null : JSON.stringify(x.crowd), state: x.state,
    observed_epoch: x.observedEpoch, updated_epoch: x.updatedEpoch,
  }));
}

function dedupeRows(rows, keyOf) {
  const out = new Map();
  for (const row of rows) out.set(keyOf(row), row);
  return [...out.values()];
}

function multiInsertStatements(db, table, columns, rows, chunkSize, suffix) {
  const statements = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const part = rows.slice(i, i + chunkSize);
    const values = part.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
    const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES ${values} ${suffix}`;
    statements.push(db.prepare(sql).bind(...part.flatMap(row => columns.map(c => row[c]))));
  }
  return statements;
}

async function persistTrtcLedger(env, parts, nowEpoch) {
  if (!await ensureTrtcLedger(env)) return { events: 0, tracks: 0, aliases: 0 };
  const db = env.TRTC_LEDGER;
  const eventRows = dedupeRows(parts.flatMap(x => ledgerEventRows(x.events)),
    x => `${x.day}|${x.line}|${x.dir}|${x.train_key}|${x.station_idx}|${x.kind}|${x.src}`);
  const trackRows = dedupeRows(parts.flatMap(x => ledgerTrackRows(x.trackUpdates)), x => `${x.day}|${x.track_id}`);
  const aliasRows = dedupeRows(parts.flatMap(x => x.aliasUpdates || []).map(x => ({
    day: x.day, alias_type: x.aliasType, alias: x.alias, track_id: x.trackId,
    first_seen_epoch: x.epoch, last_seen_epoch: x.epoch,
  })), x => `${x.day}|${x.alias_type}|${x.alias}`);

  const statements = [];
  statements.push(...multiInsertStatements(db, 'trtc_events',
    ['day','line','dir','train_key','station_idx','kind','epoch','src','crowd','state','observed_epoch','updated_epoch'],
    eventRows, 5,
    `ON CONFLICT(day,line,dir,train_key,station_idx,kind,src) DO UPDATE SET
       epoch=excluded.epoch, crowd=COALESCE(excluded.crowd,trtc_events.crowd),
       state=excluded.state, observed_epoch=excluded.observed_epoch, updated_epoch=excluded.updated_epoch
     WHERE trtc_events.state='forecast' AND
       (excluded.state='observed' OR trtc_events.epoch>excluded.observed_epoch)`));
  statements.push(...multiInsertStatements(db, 'trtc_tracks',
    ['day','track_id','line','dir','station_idx','progress','official_no','crowd','evidence','evidence_epoch','last_seen_epoch','payload'],
    trackRows, 5,
    `ON CONFLICT(day,track_id) DO UPDATE SET
       line=excluded.line,dir=excluded.dir,station_idx=excluded.station_idx,progress=excluded.progress,
       official_no=COALESCE(excluded.official_no,trtc_tracks.official_no),crowd=COALESCE(excluded.crowd,trtc_tracks.crowd),
       evidence=excluded.evidence,evidence_epoch=excluded.evidence_epoch,last_seen_epoch=excluded.last_seen_epoch,
       payload=excluded.payload`));
  statements.push(...multiInsertStatements(db, 'trtc_track_aliases',
    ['day','alias_type','alias','track_id','first_seen_epoch','last_seen_epoch'], aliasRows, 10,
    `ON CONFLICT(day,alias_type,alias) DO UPDATE SET
       last_seen_epoch=excluded.last_seen_epoch`));
  // 預測過時後凍結；只轉 state，不再改 epoch。真正「觀測到進站」的列在上面先升成 observed。
  statements.push(db.prepare(`UPDATE trtc_events SET state='elapsed',updated_epoch=?
    WHERE state='forecast' AND epoch<=?`).bind(nowEpoch, nowEpoch));
  await db.batch(statements);
  return { events: eventRows.length, tracks: trackRows.length, aliases: aliasRows.length };
}

function trackUpdateAsPrior(x) {
  return { day: x.day, track_id: x.trackId, line: x.line, dir: x.dir, station_idx: x.stationIdx,
    progress: x.progress, official_no: x.officialNo, crowd: x.crowd == null ? null : JSON.stringify(x.crowd),
    evidence: x.evidence, evidence_epoch: x.evidenceEpoch, last_seen_epoch: x.lastSeenEpoch,
    payload: JSON.stringify(x.payload) };
}
function aliasUpdateAsPrior(x) {
  return { day: x.day, alias_type: x.aliasType, alias: x.alias, track_id: x.trackId,
    first_seen_epoch: x.epoch, last_seen_epoch: x.epoch };
}
function eventAsHistory(x) {
  return { day: x.day, line: x.line, dir: x.dir, train_key: x.trackId, station_idx: x.stationIdx,
    kind: x.kind, epoch: x.epoch, src: x.src, state: x.state };
}

async function trtcLedgerPreview(env, hw, br, boardRows) {
  if (!env || !env.TRTC_LEDGER) return [];
  const fallback = Math.floor(Date.now() / 1000);
  const nowEpoch = trtcBoardEpoch(boardRows, fallback);
  const day = trtcServiceDay(nowEpoch);
  const [model, context] = await Promise.all([trtcLedgerModel(env), trtcLedgerContext(env, day, nowEpoch)]);
  const built = buildLedgerFromRaw({ model, boardRows, hwRows: hw, brRows: br, epochOf: trtcEpoch,
    ...context, nowEpoch, day });
  return built.frame;
}

async function trtcLedgerMaterialized(env, nowEpoch) {
  if (!await ensureTrtcLedger(env)) return [];
  const day = trtcServiceDay(nowEpoch);
  const r = await env.TRTC_LEDGER.prepare(`SELECT payload,evidence_epoch FROM trtc_tracks
    WHERE day=? AND last_seen_epoch>=? ORDER BY line,dir,progress`).bind(day, nowEpoch - 15 * 60).all();
  const out = [];
  for (const row of r.results || []) {
    try { const p = JSON.parse(row.payload); p.ageSec = Math.max(0, nowEpoch - Number(row.evidence_epoch)); out.push(p); } catch (e) {}
  }
  return out;
}

function trtcLedgerNowEpoch(event, env) {
  const forced = Number(env && env.TRTC_NOW_EPOCH);
  if (Number.isFinite(forced) && forced > 0) return Math.floor(forced);
  const scheduled = Number(event && event.scheduledTime);
  return Number.isFinite(scheduled) && scheduled > 0 ? Math.floor(scheduled / 1000) : Math.floor(Date.now() / 1000);
}

async function pruneTrtcLedger(env, nowEpoch) {
  if (!await ensureTrtcLedger(env)) return 0;
  // 保留「當日 + 往前 7 個服務日」共 8 天；delete < today-7。
  const cutoff = addDays(trtcServiceDay(nowEpoch), -7);
  const db = env.TRTC_LEDGER;
  const results = await db.batch([
    db.prepare('DELETE FROM trtc_events WHERE day<?').bind(cutoff),
    db.prepare('DELETE FROM trtc_tracks WHERE day<?').bind(cutoff),
    db.prepare('DELETE FROM trtc_track_aliases WHERE day<?').bind(cutoff),
  ]);
  const changes = results.reduce((n, r) => n + Number(r.meta && r.meta.changes || 0), 0);
  console.log(`[cron trtc-ledger] 清理 < ${cutoff}: ${changes} 列`);
  return changes;
}

async function trtcLedgerScheduled(event, env) {
  const gateNow = trtcLedgerNowEpoch(event, env);
  const gate = trtcOperatingState(gateNow);
  if (gate.prune) await pruneTrtcLedger(env, gateNow);
  if (!gate.open) {
    console.log(`[cron trtc-ledger] 窗外 ${gate.minute}min，不呼叫上游`);
    return { skipped: true, pruned: gate.prune };
  }
  const delayRaw = env && env.TRTC_BOARD_SAMPLE_DELAY_MS;
  const delayMs = delayRaw == null ? 30000 : Math.max(0, Math.min(60000, Number(delayRaw) || 0));
  const [model, first] = await Promise.all([
    trtcLedgerModel(env),
    Promise.all([
      trtcCall(trtcApiUrl(env, 'TrackInfo'), 'getTrackInfo', env).catch(e => {
        console.warn('[cron trtc-ledger] TrackInfo 第一次取樣失敗:', (e && e.message) || String(e));
        return [];
      }),
      trtcCall(trtcApiUrl(env, 'CarWeight'), 'getCarWeightByInfoEx', env).catch(() => []),
      trtcCall(trtcApiUrl(env, 'CarWeightBR'), 'getCarWeightBRInfo', env).catch(() => []),
    ]),
  ]);
  const [board1, hwRaw, brRaw] = first;
  if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
  const board2 = await trtcCall(trtcApiUrl(env, 'TrackInfo'), 'getTrackInfo', env).catch(e => {
    console.warn('[cron trtc-ledger] TrackInfo 第二次取樣失敗:', (e && e.message) || String(e));
    return [];
  });
  const now1 = trtcBoardEpoch(board1, gateNow), day = trtcServiceDay(now1);
  const context = await trtcLedgerContext(env, day, now1);
  const part1 = buildLedgerFromRaw({ model, boardRows: board1, hwRows: hwRaw, brRows: brRaw,
    epochOf: trtcEpoch, ...context, nowEpoch: now1, day });
  const now2 = trtcBoardEpoch(board2, now1 + Math.round(delayMs / 1000));
  const part2 = buildLedgerFromRaw({ model, boardRows: board2, hwRows: hwRaw, brRows: brRaw, epochOf: trtcEpoch,
    priorTracks: part1.trackUpdates.map(trackUpdateAsPrior),
    aliases: context.aliases.concat(part1.aliasUpdates.map(aliasUpdateAsPrior)),
    historicalEvents: context.historicalEvents.concat(part1.events.map(eventAsHistory)), nowEpoch: now2, day });
  const stats = await persistTrtcLedger(env, [part1, part2], now2);
  console.log(`[cron trtc-ledger] ${day}: board ${board1.length}+${board2.length}, hwRaw ${hwRaw.length}, brRaw ${brRaw.length}, ` +
    `events ${stats.events}, tracks ${stats.tracks}, aliases ${stats.aliases}`);
  return { skipped: false, day, stats, diagnostics: [part1.diagnostics, part2.diagnostics] };
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

// 按來源 IP 節流。回 true 代表「這一發要擋掉」。
// 刻意 fail-open:binding 不存在(舊版本、本機 dev)或限流服務自己出錯時放行——
// 限流是防濫用不是防功能,寧可漏擋也不要讓付費使用者整批 429。
// failClosed 只給「會寫進 D1」的端點用（2026-07-29 稽核：limiter 是 fail-open 的）。
// 唯讀端點維持放行——限流器掛掉時誤擋真人的代價，大於多打幾次上游的代價；寫入端點反過來，
// 放行等於整條寫入路徑在限流器故障期間完全沒有上限。
// 只有「limit() 真的拋例外」才 fail closed；binding 沒設定（本機、測試）仍然放行——那是設定
// 狀態不是故障，一律 503 會讓沒綁 binding 的環境整批寫不進去。
async function rateLimited(limiter, request, failClosed) {
  if (!limiter || typeof limiter.limit !== 'function') return false;
  const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';
  try { const { success } = await limiter.limit({ key: ip }); return !success; }
  catch (e) { return !!failClosed; }
}

async function delayHistory(request, env) {
  const train = new URL(request.url).searchParams.get('train') || '';
  if (!isValidTrainNo(train)) return jsonRes({ error: 'bad train' }, 400, 'no-store');
  // 節流要在下面的 Firebase／RevenueCat 呼叫之前:那兩發 fetch 在「token 有沒有效」判斷出來
  // 之前就送出去了,擋在後面等於沒擋。20 次/分鐘對真人查誤點履歷綽綽有餘。
  if (await rateLimited(env.AUTH_LIMITER, request)) return jsonRes({ error: 'rate_limited' }, 429, 'no-store');
  // ── Plus 付費牆:誤點履歷是 Plus 頭牌功能,先驗 Firebase ID token + RevenueCat entitlement ──
  // 此閘一定要在下方 edge.match 之前:授權後的 200 資料會寫進 train-keyed 共享邊緣快取;閘若放在
  // match 之後,無 token 的人也能從共享快取讀到,付費牆漏底。401/403/503 一律 no-store,不入共享快取。
  // 驗證範式抄自 deleteAccountData(同一組 env secret)。secret 未設定→fail-closed 503(不放行任何人)。
  if (!env.FIREBASE_WEB_API_KEY || !env.REVENUECAT_PROJECT_ID || !env.REVENUECAT_V2_SECRET_KEY)
    return jsonRes({ error: 'entitlement_unavailable' }, 503, 'no-store');
  const authHeader = request.headers.get('Authorization') || '';
  const authMatch = authHeader.match(/^Bearer\s+(.+)$/i), idToken = authMatch && authMatch[1];
  if (!idToken || idToken.length > 4096) return jsonRes({ error: 'unauthorized' }, 401, 'no-store');
  try {
    const lookup = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }),
    });
    if (!lookup.ok) return jsonRes({ error: 'unauthorized' }, 401, 'no-store');
    const identity = await lookup.json(), uid = identity && identity.users && identity.users[0] && identity.users[0].localId;
    if (!uid || typeof uid !== 'string') return jsonRes({ error: 'unauthorized' }, 401, 'no-store');
    // 軌島 Plus 是單一 entitlement 產品,故「有任何 active entitlement=有 Plus」。若日後新增第二種
    // entitlement tier,這裡要改成比對特定 entitlement——注意 RevenueCat v2 的
    // active_entitlements.items[].entitlement_id 是內部不透明 id(entl...),不是 dashboard 設的
    // lookup_key(plus);屆時需先用 GET /v2/projects/{pid}/entitlements 把 lookup_key 解析成內部 id 再比對。
    const rc = await fetch(`https://api.revenuecat.com/v2/projects/${encodeURIComponent(env.REVENUECAT_PROJECT_ID)}/customers/${encodeURIComponent(uid)}/active_entitlements`, {
      headers: { Authorization: `Bearer ${env.REVENUECAT_V2_SECRET_KEY}`, Accept: 'application/json' },
    });
    if (rc.status === 404) return jsonRes({ error: 'not_entitled' }, 403, 'no-store');       // 此 uid 從未在 RevenueCat 出現=沒買過
    if (!rc.ok) return jsonRes({ error: 'entitlement_unavailable' }, 503, 'no-store');        // 上游暫時性錯誤:不當有資格、也不永久拒絕,讓前端可重試
    const ent = await rc.json();
    const entitled = Array.isArray(ent.items) && ent.items.length > 0;
    if (!entitled) return jsonRes({ error: 'not_entitled' }, 403, 'no-store');
  } catch (e) {
    return jsonRes({ error: 'entitlement_unavailable' }, 503, 'no-store');                    // 網路/解析暫時性錯誤:可重試
  }
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

// ── 網站衛星底圖的 Esri token 下發 ────────────────────────────────────────────
// 為什麼要有這條：token 一定得送到瀏覽器才用得了，所以這裡**不是在保密**。它解決的是另外兩件事：
//   (1) 不寫進 index.html——這個 repo 是公開的，寫死等於連同 git 歷史一起推上 GitHub 給爬蟲撿
//       （2026-07-25 commit 5aab5c4 就是這樣外流了一把，32 小時後才發現）；
//   (2) 換 key 只要 `wrangler secret put ESRI_WEB_TOKEN`，不必重新部署整站。
// 真正的濫用防線是 Esri 後台的 referrer 白名單（瀏覽器抓圖磚會帶 Referer，擋得住盜用；
// 原生 App 不送 Referer，所以 App 那把是另一把 key、另外管控）。
// 未設 secret → 404，前端據此把「衛星」鈕整顆藏掉，不讓使用者點到一片白圖。
async function basemapToken(request, env) {
  if (!env.ESRI_WEB_TOKEN) return jsonRes({ error: 'not_configured' }, 404, 'no-store');
  // 這條無從要求憑證（token 本來就得送到瀏覽器才用得了），所以只剩按來源 IP 節流可做：擋掉
  // 「拿它當公用 token 水龍頭迴圈抽取」——抽走的每一把都會去打我們計費的 Esri 額度。
  // 60 次/分鐘對真人綽綽有餘：前端整個 session 只取一次，取不到才重試。
  // 注意這是縱深防禦不是閘門：一個人只要成功拿到一次就夠了，真正的濫用防線仍是 Esri 後台的
  // referrer 白名單（原生 App 不送 Referer，故 App 另用一把 key）。
  if (await rateLimited(env.BASEMAP_LIMITER, request)) return jsonRes({ error: 'rate_limited' }, 429, 'no-store');
  // 全站同一個值，放邊緣快取省 Worker 呼叫；max-age 壓在 5 分鐘讓輪替後很快生效。
  return jsonRes({ esri: env.ESRI_WEB_TOKEN }, 200, 'public, max-age=300, s-maxage=300');
}

// ── 衛星底圖的第二種計費方式：basemap session ────────────────────────────────
// Esri 兩種計價擇一：按張數，或按 session（一顆管 12 小時、期間圖磚無限）。
// 兩者有個損益兩平點：一顆 session 要涵蓋夠多張圖磚才划算——所以前端刻意
// 不是一開站就換，而是等這個客戶端在衛星上真的載超過 SAT_SESSION_AT 張才來要，
// 讓「瞄一眼就走」的人留在按張數那邊（見 index.html 的 satTileLoaded）。
//
// 為什麼由 Worker 代開而不是前端自己打 Esri：網站那把金鑰有 referrer 白名單，而
// sessions/start 這個端點是真的會驗 referer 的（實測不帶或帶錯都回 401/498），Worker 端沒有
// 瀏覽器 Referer，得自己補上。順帶好處是 API 金鑰不必為了這條再往外送一次。
async function basemapSession(request, env) {
  if (!env.ESRI_WEB_TOKEN) return jsonRes({ error: 'not_configured' }, 404, 'no-store');
  // 每顆 session 都要錢，所以這條比 basemap-token 更該節流（那條抽再多次也只是同一個值）。
  if (await rateLimited(env.BASEMAP_LIMITER, request)) return jsonRes({ error: 'rate_limited' }, 429, 'no-store');
  try {
    const r = await fetch(
      'https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/sessions/start'
      + '?styleFamily=arcgis&token=' + encodeURIComponent(env.ESRI_WEB_TOKEN),
      { headers: { referer: 'https://railisland.tw/' } });
    const d = await r.json();
    // 失敗一律回 502 不回顯上游 body——那裡面可能帶著我們送出去的 token 片段。
    if (!r.ok || !d || !d.sessionToken) return jsonRes({ error: 'upstream' }, 502, 'no-store');
    // 每個客戶端要自己的一顆（官方定義是「單一使用者的單一應用程式」），所以絕不可快取。
    return jsonRes({ sessionToken: d.sessionToken, endTime: d.endTime }, 200, 'no-store');
  } catch (e) {
    return jsonRes({ error: 'upstream' }, 502, 'no-store');
  }
}

// 刪除帳號時清除「我們這邊」的伺服器資料：RevenueCat customer ＋ D1 的懸賞校正旅程資料。
// Secret API key 只能存在 Worker runtime；先以 Firebase Auth REST lookup 驗證呼叫者的 ID token，
// 再只刪除該 token 自己的 uid，不接受前端傳 customer id／actor，避免知道別人 uid 就能刪除對方資料。
//
// 🔴 2026-07-29 稽核抓到的洞：舊版只刪 RevenueCat，D1 的 bounty_samples／bounty_claims／
// bounty_points 完全沒碰——那裡面是路線、乘車日期、車次與沿線時間／速度，而且匿名 actor 在登入時
// 會被 bountyMerge 改名成 Firebase uid，所以刪帳號之後那些列還原封不動掛在同一個 uid 底下。
// 「刪除帳號會刪掉什麼」是寫在隱私政策與 App 送審說明裡的承諾，實際行為對不上就是三者不一致。
//
// 🔴 順序與閘門也一起改了：舊版在 RevenueCat 未設定時直接 503，於是「沒設 RevenueCat 的環境」
// 連帶把校正資料也刪不掉。現在必要條件只有 FIREBASE_WEB_API_KEY（沒有它就無法確認你是誰，
// 不可能安全地刪任何東西）；RevenueCat 未設定＝沒有購買資料可刪，不是錯誤。
async function deleteAccountData(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, 'no-store');
  // 同 delayHistory:擋在 Firebase／RevenueCat 呼叫前面。刪帳號是一次性動作,5 次/分鐘已經很寬。
  if (await rateLimited(env.DELETE_LIMITER, request)) return jsonRes({ error: 'rate_limited' }, 429, 'no-store');
  if (!env.FIREBASE_WEB_API_KEY)
    return jsonRes({ error: 'account deletion service is not configured' }, 503, 'no-store');
  const auth = request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i), idToken = match && match[1];
  if (!idToken || idToken.length > 4096) return jsonRes({ error: 'unauthorized' }, 401, 'no-store');
  // body 是選配的：舊版前端不送 body，解析失敗就當沒帶（見 bountyPurgeUid 對 deviceActor 的說明）。
  let deviceActor = null;
  try { const j = await request.json(); if (j && isActorId(j.actor)) deviceActor = String(j.actor); } catch (e) {}
  try {
    const lookup = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }),
    });
    if (!lookup.ok) return jsonRes({ error: 'unauthorized' }, 401, 'no-store');
    const identity = await lookup.json(), uid = identity && identity.users && identity.users[0] && identity.users[0].localId;
    if (!uid || typeof uid !== 'string') return jsonRes({ error: 'unauthorized' }, 401, 'no-store');
    // 校正資料先刪：它是這支端點唯一「就在我們自己資料庫裡」的個資，不該被第三方服務有沒有設定
    // 綁架。失敗就整支回錯，讓前端保留帳號不刪——寧可使用者再按一次，也不要回報「已刪除」
    // 卻留著資料（那正是這次稽核抓到的那種不一致）。
    let purged;
    try { purged = await bountyPurgeUid(env, uid, deviceActor); }
    catch (e) { return jsonRes({ error: 'calibration data deletion failed' }, 502, 'no-store'); }
    if (env.REVENUECAT_PROJECT_ID && env.REVENUECAT_V2_SECRET_KEY) {
      const rc = await fetch(`https://api.revenuecat.com/v2/projects/${encodeURIComponent(env.REVENUECAT_PROJECT_ID)}/customers/${encodeURIComponent(uid)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${env.REVENUECAT_V2_SECRET_KEY}`, Accept: 'application/json' },
      });
      // 從未開過購買頁的帳號可能沒有 RevenueCat customer；404 代表已達成「沒有資料可刪」。
      if (!(rc.ok || rc.status === 404)) return jsonRes({ error: 'purchase profile deletion failed' }, 502, 'no-store');
    }
    return jsonRes({ ok: true, deleted: purged }, 200, 'no-store');
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
// 非 GET 的白名單。🔴 這道門是刻意關死的:預設所有 /api/* 只收 GET/HEAD,要開洞就逐條加進來,
// 不可以改成「全部放行」——擋掉的是「隨手對唯讀端點打 POST」這類探測,而那正是最便宜的防線。
const API_POST_ALLOWED = new Set(['/api/account-delete', '/api/bounty-claim', '/api/bounty-submit', '/api/bounty-merge']);
// /api 端點白名單——只給流量埋點的 blob 用(不是路由閘門,路由在 fetch 裡)。不在名單內一律記成
// 'other',否則隨便打 /api/<亂數> 就能把 blob 基數炸開。新增端點時要一起加進來。
const API_ENDPOINTS = new Set([
  'tra-live', 'tra-alert', 'thsr-alert', 'metro-alert', 'hazard-alert', 'metro-live', 'ntmetro-live', 'trtc-live',
  'delay-stats', 'delay-history', 'station-events', 'today-board', 'basemap-token', 'basemap-session', 'account-delete',
  'bounty-board', 'bounty-claim', 'bounty-submit', 'bounty-me', 'bounty-merge',
]);

function addAppCors(headers, origin) {
  if (!APP_ORIGINS.has(origin)) return;
  headers.set('Access-Control-Allow-Origin', origin);
  const vary = (headers.get('Vary') || '').split(',').map(v => v.trim()).filter(Boolean);
  if (!vary.some(v => v.toLowerCase() === 'origin')) vary.push('Origin');
  headers.set('Vary', vary.join(', '));
}

// ══ GPS 路段收集懸賞 ═══════════════════════════════════════════════════════
// 規格：打卡收集系統設計_GPS懸賞_2026-07-27.html。D1 四張表在 schema/0002_bounty.sql。
// 分層刻意做得很硬：估值與判定全是純函式（下面的 _bounty 導出），端點與 cron 只做 IO 與組裝。
// 理由是這兩組邏輯的正確性只能靠離線測試證明——它們依賴「時間流過」與「有人真的去搭車」，
// 線上根本沒辦法造測試情境。

// 計價單位的對外身分：sys|lnId|dir|trainKind|kind|slot（六段，末段可空）。
// 刻意與 seg_key（四段 sys|lnId|A|B）不同長度，混用時一眼看得出來。
function bountyCardId(r) {
  const p = String(r.seg_key).split('|');
  return `${p[0]}|${p[1]}|${r.dir}|${r.train_kind}|${r.kind}|${r.slot || ''}`;
}
// dwell 列的 seg_key 是 sys|lnId|站名|站名（A==B）。真實軌道區間的兩端必為相異站，
// 所以 A==B 唯一代表「這是一座站」，不必另發明標記字元。
// sys 桶對照：coverN 的鍵是「系統家族」，seg_key 的 sys 是 SYS_DEFS 的 id，兩者不同層次。
// 實測 lineNetwork() 的 sys 全集＝tra_sched／thsr_sched／afr_sched，沒有 metro，
// 所以懸賞 v1 不出 metro 卡（出了前端也畫不出來——沒有 metro 幾何）。
const BOUNTY_SYS_BUCKET = { tra_sched: 'TRA', thsr_sched: 'THSR', afr_sched: 'TRA' };

function bountySegLine(segKey) {
  const p = String(segKey).split('|');
  return { sys: p[0], lnId: p[1], a: p[2], b: p[3], isDwell: p[2] === p[3] };
}
// 門檻與文案讀 data/bounty_rules.json（ASSETS 綁定，與前端讀的是同一份檔）。
// 🔴 規格 §5：即時提示與事後判定刻意同源——即時提示的意義就是「預告事後會怎麼判」，
// 兩邊用不同門檻才是 bug（使用者一路看到綠燈、隔天卻收到不合格）。所以門檻只能有一份定義。
// 刻意不寫任何 fallback 常數：有 fallback 就有分歧的可能，而分歧正是這裡唯一要防的東西。
// 讀不到就讓呼叫端失敗（board 回 503、cron 直接中止讓樣本留在 pending，隔天再判）。
let bountyRulesMem = null;
async function bountyRules(env) {
  if (bountyRulesMem) return bountyRulesMem;
  const r = await env.ASSETS.fetch(new Request('https://railisland.tw/data/bounty_rules.json'));
  if (!r.ok) throw new Error('bounty_rules unavailable: ' + r.status);
  bountyRulesMem = await r.json();
  return bountyRulesMem;
}

// actor 白名單:crypto.randomUUID() 的形狀，或 Firebase uid（英數 28 碼上下）。
// 不白名單化就等於讓任意字串進 D1 的主鍵欄位——那是 delayHistory 對車次號做過的同一件事。
function isActorId(s) { return typeof s === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(s); }

// Firebase ID token → uid。管線與 delayHistory（付費牆）／deleteAccountData（刪帳號）完全相同，
// 抽成函式只是為了不再抄第三遍。驗不過一律回 null，呼叫端自己決定要回 401 還是降級。
async function firebaseUid(env, idToken) {
  if (!env.FIREBASE_WEB_API_KEY) return null;
  if (!idToken || idToken.length > 4096) return null;
  try {
    const lookup = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }),
    });
    if (!lookup.ok) return null;
    const identity = await lookup.json();
    const uid = identity && identity.users && identity.users[0] && identity.users[0].localId;
    return (uid && typeof uid === 'string') ? uid : null;
  } catch (e) { return null; }
}

// 合併過的 device token，後續寫入一律轉向 uid（規格 §6「身分與合併」）。
// 只跟一跳:合併端點保證 merged_into 一定指向一個沒有 merged_into 的列(uid 列)，
// 跟多跳等於默許鏈狀合併，而那會在合併失敗重試時繞成環。
async function resolveActor(env, actor) {
  const row = await env.DELAY_DB.prepare('SELECT merged_into FROM bounty_points WHERE actor=?').bind(actor).first();
  return (row && row.merged_into) ? String(row.merged_into) : actor;
}

// 🔴 正向掃描整包 payload 有沒有任何經緯度欄位（規格 §11：正向掃 key，不是抽查特定欄位）。
// 為什麼伺服器端也要擋:「上傳的是沿線里程不是座標」這句話會寫進隱私政策與 App 送審說明。
// 只靠客戶端不送的話，那句話就是一個沒有強制力的承諾——客戶端改版／debug 旗標任何一個手滑
// 都能讓座標流進 D1，而且不會有任何測試失敗。這裡直接 400，那句話才是真的。
const GEO_KEY_RE = /^(lat|lon|lng|latitude|longitude|coords?|position|geo)$/i;
function hasGeoKeys(v, depth) {
  if (v == null || typeof v !== 'object') return false;
  if ((depth || 0) > 8) return true;                 // 深到這種程度的結構本來就不該出現，保守判有
  if (Array.isArray(v)) return v.some(x => hasGeoKeys(x, (depth || 0) + 1));
  for (const k of Object.keys(v)) {
    if (GEO_KEY_RE.test(k)) return true;
    if (hasGeoKeys(v[k], (depth || 0) + 1)) return true;
  }
  return false;
}
// 只留 d(公尺) t(台北當日秒) v(m/s) acc(公尺) 四個數值欄位。多的欄位直接丟不報錯:
// 前端日後多帶一個 debug 欄位不該讓整趟上傳失敗，但那個欄位也絕不該進 D1。
// (夾帶座標是另一回事——那個要 400，見 hasGeoKeys。)
function sanitizeSamples(arr, max) {
  const out = []; let dropped = 0;
  for (const s of arr) {
    const d = Number(s && s.d), t = Number(s && s.t), v = Number(s && s.v), acc = Number(s && s.acc);
    if (!Number.isFinite(d) || !Number.isFinite(t)) { dropped++; continue; }
    out.push({ d: Math.round(d * 10) / 10, t: Math.round(t), v: Number.isFinite(v) ? Math.round(v * 100) / 100 : null,
      acc: Number.isFinite(acc) ? Math.round(acc) : null });
    if (out.length >= max) break;
  }
  return { samples: out, dropped };
}

// 把內部的計價單位聚合成對外的旅程卡。使用者看到的是「枋寮→台東 南迴線 39 點」，
// 不是六千筆 (段,車種,方向) 的內部帳。
// 端點名（枋寮／台東）刻意不在這裡算——排出一條路需要里程順序，那住在前端的 lineNetwork()。
// 把線網拓樸複製進 worker 等於製造第二個真相源，改點時兩邊會不同步。
// claimCounts 由呼叫端查好傳進來（純函式不碰 DB，才測得動）。
function groupBoardRows(rows, claimCounts, coverN) {
  const m = new Map();
  for (const r of rows) {
    const id = bountyCardId(r), ln = bountySegLine(r.seg_key);
    let c = m.get(id);
    if (!c) {
      c = { id, sys: ln.sys, lnId: ln.lnId, dir: Number(r.dir), trainKind: r.train_kind,
        kind: r.kind, slot: r.slot || '', unitKeys: [], units: 0, points: 0, samples: 0,
        claimers: 0, coverN: (coverN && coverN[BOUNTY_SYS_BUCKET[ln.sys]]) || 1 };
      m.set(id, c);
    }
    c.unitKeys.push(r.seg_key);
    c.units += 1;
    c.points += Number(r.points) || 0;
    c.samples += Number(r.sample_count) || 0;
    const k = `${r.seg_key}|${r.train_kind}|${r.dir}|${r.kind}|${r.slot || ''}`;
    c.claimers = Math.max(c.claimers, (claimCounts && claimCounts.get(k)) || 0);
  }
  // 點數高的排前面：那正是「還沒人跑、值得跑」的訊號，不必另外做推薦
  return [...m.values()].sort((a, b) => b.points - a.points || a.id.localeCompare(b.id));
}

// GET /api/bounty-board：公開、免驗證。網頁也讀得到（規格 §9：看得到、接不了）。
async function bountyBoard(request, env) {
  const cacheKey = new Request(new URL('/api/bounty-board', request.url), { method: 'GET' });
  const edge = caches.default;
  const hit = await edge.match(cacheKey);
  if (hit) return hit;
  try {
    const rules = await bountyRules(env);
    const now = Date.now();
    // track 收滿就下架；dwell 收滿仍留在架上（規格 §4：停站點獎勵衰減但不歸零，
    // 因為任何軌跡經過車站都自帶樣本，邊際成本近零）
    const rs = await env.DELAY_DB.prepare(
      "SELECT seg_key, sys, train_kind, dir, kind, slot, points, sample_count FROM bounty_board" +
      " WHERE kind='dwell' OR covered_at IS NULL"
    ).all();
    const cs = await env.DELAY_DB.prepare(
      "SELECT seg_key, train_kind, dir, kind, slot, COUNT(DISTINCT actor) AS n FROM bounty_claims" +
      " WHERE status='open' AND expires_at > ? GROUP BY seg_key, train_kind, dir, kind, slot"
    ).bind(now).all();
    const counts = new Map((cs.results || []).map(r =>
      [`${r.seg_key}|${r.train_kind}|${r.dir}|${r.kind}|${r.slot || ''}`, Number(r.n) || 0]));
    const cards = groupBoardRows(rs.results || [], counts, rules.coverN);
    // 板一天只重算一次，但 claimers 會隨時變——5 分鐘是「認領人數夠新」與「別把 D1 打爆」的折衷
    const res = jsonRes({ at: now, coverN: rules.coverN, cards }, 200, 'public, s-maxage=300, stale-while-revalidate=900');
    await edge.put(cacheKey, res.clone());
    return res;
  } catch (e) {
    return jsonRes({ error: 'not_ready' }, 503, 'public, s-maxage=60');
  }
}

// POST /api/bounty-claim：接下一張旅程卡。
// 🔴 鎖的是價格，不是獨佔權（規格 §3）。第二個人照樣接得到、照樣計點——捷運段的採用門檻本來
// 就需要多趟一致（N≥3），做成獨佔會直接擋掉自己需要的樣本。使用者只看到「已有 N 人接了這段」。
async function bountyClaim(request, env) {
  // 節流擋在任何 D1 寫入之前（比照 delayHistory:被擋掉的請求若已經花掉錢，擋在後面等於沒擋）
  if (await rateLimited(env.BOUNTY_LIMITER, request, true)) return jsonRes({ error: 'rate_limited' }, 429, 'no-store');
  if (bountyWritesOff(env)) return jsonRes({ error: 'bounty_paused' }, 503, 'no-store');
  let b;
  try { b = await request.json(); } catch (e) { return jsonRes({ error: 'bad_json' }, 400, 'no-store'); }
  if (!b || !isActorId(b.actor)) return jsonRes({ error: 'bad_actor' }, 400, 'no-store');
  const parts = String(b.cardId || '').split('|');
  if (parts.length !== 6 || !parts[0] || !parts[1] || !parts[3] || (parts[4] !== 'track' && parts[4] !== 'dwell'))
    return jsonRes({ error: 'bad_card' }, 400, 'no-store');
  const [sys, lnId, dirStr, trainKind, kind, slot] = parts;
  const dir = Number(dirStr);
  if (!(dir === 0 || dir === 1)) return jsonRes({ error: 'bad_card' }, 400, 'no-store');
  try {
    const actor = await resolveActor(env, b.actor);
    const now = Date.now(), expires = now + 86400000;
    // 只認領還開著的單位。track 收滿就下架；dwell 收滿仍可接（獎勵衰減但不歸零）
    const rs = await env.DELAY_DB.prepare(
      "SELECT seg_key, points FROM bounty_board WHERE sys=? AND train_kind=? AND dir=? AND kind=? AND slot=?" +
      " AND seg_key LIKE ? AND (kind='dwell' OR covered_at IS NULL)"
    ).bind(sys, trainKind, dir, kind, slot, sys + '|' + lnId + '|%').all();
    const units = rs.results || [];
    if (!units.length) return jsonRes({ error: 'no_open_units' }, 404, 'no-store');
    const claimId = 'cl-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    const stmt = env.DELAY_DB.prepare(
      'INSERT INTO bounty_claims (id,actor,seg_key,train_kind,dir,kind,slot,points_locked,claimed_at,expires_at,status)' +
      " VALUES (?,?,?,?,?,?,?,?,?,?,'open')");
    await env.DELAY_DB.batch(units.map((u, i) =>
      stmt.bind(`${claimId}|${i}`, actor, u.seg_key, trainKind, dir, kind, slot, Number(u.points) || 0, now, expires)));
    const cnt = await env.DELAY_DB.prepare(
      "SELECT COUNT(DISTINCT actor) AS n FROM bounty_claims WHERE seg_key=? AND train_kind=? AND dir=? AND kind=? AND slot=?" +
      " AND status='open' AND expires_at > ?"
    ).bind(units[0].seg_key, trainKind, dir, kind, slot, now).first();
    return jsonRes({
      ok: true, claimId, units: units.length,
      pointsLocked: units.reduce((a, u) => a + (Number(u.points) || 0), 0),
      expiresAt: expires, claimers: Number(cnt && cnt.n) || 1,
    }, 200, 'no-store');
  } catch (e) {
    return jsonRes({ error: 'claim_failed' }, 503, 'no-store');
  }
}

// 伺服器端寫入總閘（2026-07-29 稽核：「沒有伺服器功能總閘」）。出事時把 BOUNTY_WRITES 設成
// 'off' 就能立刻停掉所有懸賞寫入，不必改前端、不必等 App 送審——前端把批次留在上傳佇列，
// 恢復後照樣傳得上來。預設開著：沒設這個變數的環境行為完全不變。
// 刻意不擋 /api/bounty-merge：那支要帶 Firebase token、只搬既有的列、不長資料，關掉它只會讓
// 停機期間登入的人看不到自己登入前的貢獻。
function bountyWritesOff(env) { return String(env.BOUNTY_WRITES || '').toLowerCase() === 'off'; }

const BOUNTY_MAX_SAMPLES_PER_BATCH = 600;   // 60 秒批次 @1Hz ＝ 60 筆；600 給重試合併留十倍餘裕
// 每人每日批次上限（2026-07-29 稽核：「沒有每 actor／每日總量」）。一批＝60 秒錄製，
// 720 批＝12 小時，比任何一天真實的乘車紀錄都寬，但把「單一 actor 無限灌」壓成一個有界的數字。
// 🔴 誠實揭露這道防線的極限：actor 是客戶端產生的，換一個 actor 就換到一份新額度。它擋得住的是
// 失控重試與單機灌資料；有決心的分散式灌注要靠另外三件事合起來擋——BOUNTY_LIMITER（每 IP 每分鐘）、
// 下面的路線白名單（unknown_line：形狀對但不存在的線一律不收），以及 BOUNTY_WRITES=off 總閘。
const BOUNTY_MAX_BATCHES_PER_DAY = 720;
// 乘車日只收「最近 7 天到明天」。往前：更舊的批次補傳沒有意義（驗證 cron 隔日就跑完了）；
// 往後：未來日期是純粹的偽造訊號。順帶讓上面的每日額度真的有界——不然換一個假日期就換到新額度。
const BOUNTY_TRIP_DATE_BACK_DAYS = 7;
// 🔴 lnId 不可以用 ASCII 白名單擋（2026-07-29 修）：台鐵 16 條線的 id 本身就是中文
// （data/tra.json 的 lines[].id ＝「南迴線」「山線」「海線」…），舊的
// /^[A-Za-z0-9_-]{1,32}$/ 會讓每一批台鐵上傳吃 400 bad_line ——而懸賞刻意只收台鐵、
// 高鐵、林鐵（捷運不進懸賞），所以那等於整條上傳路徑是死的。
// 後端 394 項驗收之所以全綠：submit 的 fixture 寫 lnId:'NH'，那是早就作廢的鍵空間，
// 剛好是 ASCII —— fixture 缺了「能讓它變紅的那一筆」。
// 仍然必須擋 '|'：seg_key（sys|lnId|A|B）與卡片 id（sys|lnId|dir|…）都用它分段，
// 放進來就能偽造段鍵。控制字元一併擋掉。
const BOUNTY_LINE_ID_RE = /^[^|\u0000-\u001f\u007f]{1,32}$/u;
// POST /api/bounty-submit：沿途每 60 秒一批。一批一列、不在寫入時合併——
// 每批獨立可驗，斷線／沒電時已經傳出去的不會丟，這是「部分覆蓋也計點」的前提（規格 §5）。
async function bountySubmit(request, env) {
  if (await rateLimited(env.BOUNTY_LIMITER, request, true)) return jsonRes({ error: 'rate_limited' }, 429, 'no-store');
  if (bountyWritesOff(env)) return jsonRes({ error: 'bounty_paused' }, 503, 'no-store');
  let b;
  try { b = await request.json(); } catch (e) { return jsonRes({ error: 'bad_json' }, 400, 'no-store'); }
  if (!b || !isActorId(b.actor)) return jsonRes({ error: 'bad_actor' }, 400, 'no-store');
  if (!/^[A-Za-z0-9_-]{1,16}$/.test(String(b.sys || '')) || !BOUNTY_LINE_ID_RE.test(String(b.lnId || '')))
    return jsonRes({ error: 'bad_line' }, 400, 'no-store');
  if (!/^[0-9A-Za-z]{1,8}$/.test(String(b.trainNo || ''))) return jsonRes({ error: 'bad_train' }, 400, 'no-store');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.tripDate || ''))) return jsonRes({ error: 'bad_date' }, 400, 'no-store');
  // BOUNTY_NOW 是既有的測試鉤（驗證 cron 也用同一個）：日期窗若綁死真實時鐘，測試會在今天全綠、
  // 下週自己變紅，那種紅燈最難辨認。台北無日光節約，固定 +8 讀 UTC 欄位即得台北日。
  const twToday = isoFromDate(new Date((Number(env.BOUNTY_NOW) || Date.now()) + 8 * 3600 * 1000));
  if (String(b.tripDate) < addDays(twToday, -BOUNTY_TRIP_DATE_BACK_DAYS) || String(b.tripDate) > addDays(twToday, 1))
    return jsonRes({ error: 'bad_date' }, 400, 'no-store');
  const dir = Number(b.dir);
  if (!(dir === 0 || dir === 1)) return jsonRes({ error: 'bad_dir' }, 400, 'no-store');
  if (!Array.isArray(b.samples) || !b.samples.length || b.samples.length > BOUNTY_MAX_SAMPLES_PER_BATCH)
    return jsonRes({ error: 'bad_samples' }, 400, 'no-store');
  if (hasGeoKeys(b)) return jsonRes({ error: 'coordinates_not_accepted' }, 400, 'no-store');
  const { samples, dropped } = sanitizeSamples(b.samples, BOUNTY_MAX_SAMPLES_PER_BATCH);
  if (!samples.length) return jsonRes({ error: 'bad_samples' }, 400, 'no-store');
  try {
    // 路線白名單（2026-07-29 稽核：「sys／lnId 只驗字串形狀，不驗是否為真實路線」）。
    // 判準用 data/bounty_units.json——就是驗證 cron 自己用的那一份，所以「過得了這關」等於
    // 「這批資料日後判得出結果」。形狀對但不存在的線（亂打、舊鍵空間、捷運）以前照收，
    // 只會在 D1 裡變成永遠 pending 的垃圾列，每天被 cron 重讀一次。
    // fail-closed：資產讀不到就 503，讓客戶端把批次留在上傳佇列重試，不要收無法驗證的資料。
    let units;
    try { units = await bountyUnits(env); }
    catch (e) { return jsonRes({ error: 'not_ready' }, 503, 'no-store'); }
    if (!units || !units.lines || !units.lines[`${b.sys}|${b.lnId}`])
      return jsonRes({ error: 'unknown_line' }, 400, 'no-store');
    const actor = await resolveActor(env, b.actor);
    // 每人每日批次上限。idx_samples_trip (actor, trip_date, train_no) 正好服務這個 COUNT，
    // 而且擋在 INSERT 之前——擋在後面等於已經寫進去了才說不行。
    const used = await env.DELAY_DB.prepare(
      'SELECT COUNT(*) AS n FROM bounty_samples WHERE actor=? AND trip_date=?'
    ).bind(actor, String(b.tripDate)).first();
    if ((Number(used && used.n) || 0) >= BOUNTY_MAX_BATCHES_PER_DAY)
      return jsonRes({ error: 'daily_quota' }, 429, 'no-store');
    const now = Date.now();
    const id = 'bs-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    await env.DELAY_DB.prepare(
      'INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict)' +
      " VALUES (?,?,?,?,?,?,?,?,NULL,?,'pending')"
    ).bind(id, actor, String(b.sys), String(b.lnId), String(b.trainNo), dir, String(b.tripDate),
      JSON.stringify(samples), now).run();
    // 立刻回，前端當下蓋灰章（規格 §3：事後真相驗證 ＋ 即時灰章）
    return jsonRes({ ok: true, id, verdict: 'pending', accepted: samples.length, dropped }, 200, 'no-store');
  } catch (e) {
    return jsonRes({ error: 'submit_failed' }, 503, 'no-store');
  }
}

// GET /api/bounty-me：護照「校正貢獻」那一節的資料來源。
// 🔴 護照顯示兩個數字不是一個（規格 §8）：「校正 12 段（其中 9 段已採用）」。
// 只顯示前者會讓使用者不知道自己的資料其實常常不能用、失去改善機會；只顯示後者則是把 unusable 的
// 付出當成沒發生。兩個並列時，差距本身就是一個不帶懲罰的改善提示。
// 🔴 這個端點永遠不回 reject_code。整包回應裡連那個字都不該出現——不是靠「記得別選它」，
// 是靠下面的 SELECT 只列白名單欄位。
async function bountyMe(request, env) {
  const url = new URL(request.url);
  let who = url.searchParams.get('actor') || '';
  const auth = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (auth) {
    if (await rateLimited(env.AUTH_LIMITER, request)) return jsonRes({ error: 'rate_limited' }, 429, 'no-store');
    const uid = await firebaseUid(env, auth[1]);
    if (!uid) return jsonRes({ error: 'unauthorized' }, 401, 'no-store');
    who = uid;
  }
  if (!isActorId(who)) return jsonRes({ error: 'bad_actor' }, 400, 'no-store');
  try {
    const rules = await bountyRules(env);
    const actor = await resolveActor(env, who);
    const p = await env.DELAY_DB.prepare('SELECT points FROM bounty_points WHERE actor=?').bind(actor).first();
    // 白名單欄位：reject_code 連 SELECT 都不選進來，才不會有人日後手滑把整列丟出去
    const rs = await env.DELAY_DB.prepare(
      'SELECT id, ln_id, sys, train_no, trip_date, verdict, quality_code, segs FROM bounty_samples' +
      ' WHERE actor=? ORDER BY trip_date DESC, id DESC LIMIT 60').bind(actor).all();
    const rows = rs.results || [];
    const segSeen = new Set(), segOk = new Set(), byLine = new Map(), firsts = [];
    for (const r of rows) {
      let cov = [];
      try { cov = JSON.parse(r.segs || '[]'); } catch (e) {}
      if (r.verdict === 'suspect') continue;               // 沒排除作弊的那筆，章本來就沒給
      const lk = `${r.sys}|${r.ln_id}`;
      const L = byLine.get(lk) || { sys: r.sys, lnId: r.ln_id, segs: 0, adopted: 0 };
      for (const c of cov) {
        // 規格 §8 的護照數字與收集地圖明定是「校正 N 段」；dwell 沒有可畫的路段，不能把一站
        // 混進 segs 後在前端叫成「一段」。dwell 的榮譽仍進總點數，這裡只守住路段統計的語意。
        if (c && c.kind === 'dwell') continue;
        if (!segSeen.has(c.key)) { segSeen.add(c.key); L.segs++; }
        if (r.verdict === 'ok' && !segOk.has(c.key)) { segOk.add(c.key); L.adopted++; }
      }
      byLine.set(lk, L);
    }
    // 首位校正者：只給 ok（規格 §8 的例外——那是對資料署名，不是對付出表揚）。
    // 只顯示給自己，不顯示別人的暱稱：顯示他人自填暱稱＝UGC，會觸發 Apple Guideline 1.2。
    for (const key of segOk) {
      const f = await env.DELAY_DB.prepare(
        "SELECT actor FROM bounty_samples WHERE verdict='ok' AND segs LIKE ? ORDER BY verdict_at ASC LIMIT 1"
      ).bind('%' + key + '%').first();
      if (f && f.actor === actor) firsts.push(key);
    }
    const trips = rows.map(r => ({
      id: r.id, tripDate: r.trip_date, trainNo: r.train_no, sys: r.sys, lnId: r.ln_id, verdict: r.verdict,
      quality: r.quality_code ? Object.assign({ code: r.quality_code }, rules.qualityText[r.quality_code] || {}) : null,
    }));
    return jsonRes({
      actor, points: Number(p && p.points) || 0,
      corrected: { segs: segSeen.size, adopted: segOk.size },
      lines: [...byLine.values()].sort((a, b) => b.segs - a.segs),
      firsts, trips,
    }, 200, 'no-store');
  } catch (e) {
    return jsonRes({ error: 'not_ready' }, 503, 'no-store');
  }
}

// POST /api/bounty-merge：登入時把匿名 device token 的點數併進 Firebase uid（規格 §6）。
// 🔴 必須冪等：網路重試、使用者連點兩下、多裝置同時登入都會重複呼叫。做法是「只有 merged_into
// 還是 NULL 的來源列才搬」，搬完立刻標記並歸零——所以第二次呼叫看到的是一個已標記的列，直接跳過。
// 🔴 但「冪等」不等於「併發安全」（2026-07-29 稽核抓到）：舊版是三個獨立的 D1 round-trip
// ——先讀來源點數、再標記來源、最後把讀到的值加進 uid。兩個同時抵達的請求會雙雙讀到「尚未合併」，
// 標記只有一個會成功（WHERE merged_into IS NULL 擋住另一個），但兩個都會拿著同一份 carry 去加
// ——重複計點，而那是憑空生出點數。連續呼叫兩次的測試照不到這件事，因為它們之間沒有交錯。
// 現在整段搬移改成一次 db.batch()：D1 的 batch 是單一交易，所以 (a) 加點的來源值是在交易內
// 用子查詢當場讀的，不是上一個 round-trip 的舊值；(b)「merged_into IS NULL」的守衛與加點落在
// 同一個寫鎖內，第二個併發請求進來時看到的必然是已標記的列，子查詢回 NULL → 加 0。
// 順帶解掉稽核的第二半：樣本與認領改名以前在交易外，中途失敗會留下「點數搬走了、樣本還掛在
// 舊 actor」的半套狀態；現在同批同交易，要嘛全成、要嘛全退。
async function bountyMerge(request, env) {
  if (await rateLimited(env.AUTH_LIMITER, request)) return jsonRes({ error: 'rate_limited' }, 429, 'no-store');
  let b;
  try { b = await request.json(); } catch (e) { return jsonRes({ error: 'bad_json' }, 400, 'no-store'); }
  if (!b || !isActorId(b.actor)) return jsonRes({ error: 'bad_actor' }, 400, 'no-store');
  const auth = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  const uid = auth ? await firebaseUid(env, auth[1]) : null;
  if (!uid) return jsonRes({ error: 'unauthorized' }, 401, 'no-store');
  if (b.actor === uid) return jsonRes({ ok: true, uid, points: 0, merged: false }, 200, 'no-store');
  try {
    const now = Date.now(), db = env.DELAY_DB;
    // 語句順序有意義：② 必須排在 ③ 之前，否則來源已經被 ③ 歸零，② 讀到的永遠是 0。
    const res = await db.batch([
      // ① 目的列先確保存在（第一次登入時還沒有）
      db.prepare(
        'INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES (?,?,0,NULL,?)' +
        ' ON CONFLICT(actor) DO UPDATE SET uid = excluded.uid, updated_at = excluded.updated_at'
      ).bind(uid, uid, now),
      // ② 加點：來源值在交易內當場讀，且同押 merged_into IS NULL——已被別人合併過的來源加 0
      db.prepare(
        'UPDATE bounty_points SET points = points + COALESCE(' +
        '(SELECT points FROM bounty_points WHERE actor=? AND merged_into IS NULL), 0),' +
        ' updated_at=? WHERE actor=?'
      ).bind(b.actor, now, uid),
      // ③ 標記來源並歸零。changes=0 ⇔ ② 也必然加了 0（同一個守衛、同一筆交易），兩者不可能不一致
      db.prepare(
        'UPDATE bounty_points SET points=0, merged_into=?, updated_at=? WHERE actor=? AND merged_into IS NULL'
      ).bind(uid, now, b.actor),
      // ④⑤ 樣本與認領也一起改名，否則 /api/bounty-me 查 uid 會看不到登入前的貢獻
      db.prepare('UPDATE bounty_samples SET actor=? WHERE actor=?').bind(uid, b.actor),
      db.prepare('UPDATE bounty_claims  SET actor=? WHERE actor=?').bind(uid, b.actor),
    ]);
    // merged ＝「這一次呼叫真的消化掉了來源列」，直接讀 ③ 改了幾列，不再靠事前讀到的 carry 推論。
    const merged = Number(res[2] && res[2].meta && res[2].meta.changes) > 0;
    const p = await db.prepare('SELECT points FROM bounty_points WHERE actor=?').bind(uid).first();
    return jsonRes({ ok: true, uid, points: Number(p && p.points) || 0, merged }, 200, 'no-store');
  } catch (e) {
    return jsonRes({ error: 'merge_failed' }, 503, 'no-store');
  }
}

// 刪除某個 Firebase uid 在懸賞後端的全部個人資料——bountyMerge 的反向動作，由 /api/account-delete
// 呼叫（2026-07-29 稽核：刪帳號沒有刪 D1 的校正旅程資料）。
// 🔴 範圍必須含「曾經併進這個 uid 的匿名 device token」：合併時樣本與認領已改名成 uid，但 token
// 自己那一列還留在 bounty_points（merged_into=uid）當作防重複合併的墓碑；只刪 actor=uid 會把
// 那些墓碑連同它們可能殘留的樣本一起留下。
// 🔴 順序固定：兩張明細表都要用 bounty_points 的 merged_into 反查 token，所以 bounty_points 最後刪。
// 一次 batch＝單一交易，不會出現「點數刪了、樣本還在」的半套狀態。
//
// 🔴 deviceActor 這個參數不是可有可無的（否則這支函式今天一列都刪不到）：前端的 bountyActor()
// 目前送的是匿名裝置 UUID，/api/bounty-merge 還沒接進登入流程，所以 D1 裡現存的每一列 actor
// 都是裝置 token、沒有一列等於 Firebase uid。只刪 uid＝形式上有刪、實際上零效果。
// 安全性：呼叫端要帶通過驗證的 Firebase ID token、限流 5 次/分鐘，而 device actor 是裝置上
// crypto.randomUUID() 產生、從不對外顯示的值。要濫用得先知道別人的 device id，而且能做的只有
// 「刪掉對方的校正紀錄」（讀不到任何東西）——與「真正的擁有者刪不掉自己的資料」相比，這個取捨划算。
// 唯一守衛：已經併進「別的 uid」的 token 不刪，那是別人帳號底下的資料。
async function bountyPurgeUid(env, uid, deviceActor) {
  const db = env.DELAY_DB;
  if (!db) return { samples: 0, claims: 0, points: 0 };
  const dev = (deviceActor && deviceActor !== uid) ? String(deviceActor) : null;
  const sub = 'SELECT actor FROM bounty_points WHERE merged_into=?';
  // 「這個 token 沒有被併進別的 uid」。注意它讀的是 bounty_points，所以刪 bounty_points 的那句
  // 必須排在最後——提前刪掉就等於把自己的守衛拆了。
  const notElsewhere = ' AND NOT EXISTS (SELECT 1 FROM bounty_points' +
    ' WHERE actor=? AND merged_into IS NOT NULL AND merged_into<>?)';
  const stmts = [
    db.prepare(`DELETE FROM bounty_samples WHERE actor=? OR actor IN (${sub})`).bind(uid, uid),
    db.prepare(`DELETE FROM bounty_claims  WHERE actor=? OR actor IN (${sub})`).bind(uid, uid),
  ];
  if (dev) stmts.push(
    db.prepare(`DELETE FROM bounty_samples WHERE actor=?${notElsewhere}`).bind(dev, dev, uid),
    db.prepare(`DELETE FROM bounty_claims  WHERE actor=?${notElsewhere}`).bind(dev, dev, uid),
  );
  stmts.push(dev
    ? db.prepare('DELETE FROM bounty_points WHERE actor=? OR merged_into=?' +
        ' OR (actor=? AND (merged_into IS NULL OR merged_into=?))').bind(uid, uid, dev, uid)
    : db.prepare('DELETE FROM bounty_points WHERE actor=? OR merged_into=?').bind(uid, uid));
  const res = await db.batch(stmts);
  const n = i => Number(res[i] && res[i].meta && res[i].meta.changes) || 0;
  return dev
    ? { samples: n(0) + n(2), claims: n(1) + n(3), points: n(4) }
    : { samples: n(0), claims: n(1), points: n(2) };
}

// ── 估值:兩層乘數,兩層都從既有資料自動算,沒有任何一段的價格是人設的(規格 §4)──────────
// 核心主張:不要手調每一段的價格。猜不對就會一直錯,而且錯了沒有回饋機制。
function bountyMedian(nums) {
  const a = nums.filter(n => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
// L1 班次密度＝我們「推測」的招募難度。冷啟動時 L2 全是 1×,沒有 L1 的話南迴要等好幾週才漲得動。
// 分母粒度必須等於計價單位(含車種),否則普快車會被自強平均掉。
function bountyL1(perDay, medianPerDay) {
  const n = Number(perDay);
  if (!(n > 0)) return 3;                      // 沒有班次資料的單位視同最難招募,不是視同最容易
  return Math.min(3, Math.max(1, Number(medianPerDay) / n));
}
// L2 時間乘數＝「真實」的招募難度。市場自己發現——沒人跑就一直漲,跟我們想不想得到無關。
// 🔴 起算點是 first_claimable_at(真的有人「能」去跑的那一刻),不是上架時間。NULL＝還沒有人能接 → 恆 1。
// 規格 §4 鐵則:只要有任何期間板上得去但接得了的人是零,L2 照漲就會把整張板系統性高估,
// 而 ×5 的上限會讓它自己觸發自動開關＝用一個假訊號打開真金流。
function bountyL2(nowMs, firstClaimableAt) {
  const from = Number(firstClaimableAt);
  if (!from) return 1;
  const days = Math.floor((Number(nowMs) - from) / 86400000);
  if (!(days > 0)) return 1;
  return Math.min(5, Math.pow(1.2, Math.floor(days / 7)));
}
function bountyPointsOf(l1, l2) { return Math.max(1, Math.round(1 * Number(l1) * Number(l2))); }
// 自動開關(規格 §1 拍板 1、§8):三個條件同時成立才置 1。讓「沒人領」自己說話,
// 不用主觀決定哪一段該給錢。
function bountyUnlocked(row, nowMs) {
  const capped = Number(row.l2_capped_at);
  return (Number(row.l2) >= 5 && Number(row.sample_count) === 0 && capped > 0 &&
    (Number(nowMs) - capped) >= 30 * 86400000) ? 1 : 0;
}
// 計價單位清單(建置期產生,見 scripts/build_bounty_units.mjs)。與 bountyRules 同樣不設 fallback:
// 讀不到就讓 cron 中止,而不是拿一份猜的清單去改寫整張懸賞板。
let bountyUnitsMem = null;
async function bountyUnits(env) {
  if (bountyUnitsMem) return bountyUnitsMem;
  const r = await env.ASSETS.fetch(new Request('https://railisland.tw/data/bounty_units.json'));
  if (!r.ok) throw new Error('bounty_units unavailable: ' + r.status);
  bountyUnitsMem = await r.json();
  return bountyUnitsMem;
}

// 每日估值:把清單裡的新單位補上架,並重算所有還開著的單位的 l1／l2／points。
// 冪等:重跑只會得到同一個結果(insert 用 OR IGNORE、update 全欄位重算),cron 補跑無害。
async function bountyValuationCron(env) {
  const M = await bountyUnits(env);
  const rules = await bountyRules(env);
  const dwellCoveredMultiplier = Number(rules.dwellReward && rules.dwellReward.coveredMultiplier);
  if (!(dwellCoveredMultiplier > 0 && dwellCoveredMultiplier <= 1)) {
    throw new Error('invalid bounty rule: dwellReward.coveredMultiplier');
  }
  const now = Date.now();
  // 起算點是一個要有人明確按下去的動作(Worker secret),不是一個會自己發生的副作用。
  // 未設定 → first_claimable_at 留 NULL → L2 恆 1。見 bountyL2 的註解。
  const claimableFrom = Number(env.BOUNTY_CLAIMABLE_FROM) || 0;
  const med = bountyMedian(M.units.map(u => Number(u.perDay)));
  const ins = env.DELAY_DB.prepare(
    'INSERT OR IGNORE INTO bounty_board (seg_key,sys,train_kind,dir,kind,slot,l1,l2,points,per_day,first_listed_at,first_claimable_at)' +
    ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  let inserted = 0;
  for (let i = 0; i < M.units.length; i += 80) {          // 比照既有 D1_BATCH_SIZE:一批 80 句
    const chunk = M.units.slice(i, i + 80);
    const res = await env.DELAY_DB.batch(chunk.map(u => {
      const l1 = bountyL1(u.perDay, med), l2 = bountyL2(now, claimableFrom);
      return ins.bind(u.segKey, u.sys, u.trainKind, u.dir, u.kind, u.slot || '', l1, l2,
        bountyPointsOf(l1, l2), Number(u.perDay) || 0, now, claimableFrom || null);
    }));
    inserted += res.reduce((a, r) => a + ((r.meta && r.meta.changes) || 0), 0);
  }
  // 重算:只動還開著的(track 未收滿、dwell 恆算)。已下架的段留著歷史值,不必每天重寫。
  const rs = await env.DELAY_DB.prepare(
    "SELECT seg_key,train_kind,dir,kind,slot,per_day,l2_capped_at,sample_count,covered_at,first_claimable_at" +
    " FROM bounty_board WHERE kind='dwell' OR covered_at IS NULL").all();
  const upd = env.DELAY_DB.prepare(
    'UPDATE bounty_board SET l1=?, l2=?, points=?, first_claimable_at=?, l2_capped_at=?, unlocked_offer=?' +
    ' WHERE seg_key=? AND train_kind=? AND dir=? AND kind=? AND slot=?');
  let updated = 0, capped = 0, unlocked = 0;
  const rows = rs.results || [];
  for (let i = 0; i < rows.length; i += 80) {
    await env.DELAY_DB.batch(rows.slice(i, i + 80).map(r => {
      const from = Number(r.first_claimable_at) || claimableFrom || 0;
      const l1 = bountyL1(r.per_day, med), l2 = bountyL2(now, from);
      const basePoints = bountyPointsOf(l1, l2);
      const points = r.kind === 'dwell' && Number(r.covered_at)
        ? Math.max(1, Math.round(basePoints * dwellCoveredMultiplier))
        : basePoints;
      // l2_capped_at 只記第一次到頂:自動開關的 30 天要從「到頂那一刻」起算,重寫等於永遠不會滿 30 天
      const cap = Number(r.l2_capped_at) || (l2 >= 5 ? now : 0);
      if (!Number(r.l2_capped_at) && cap) capped++;
      const un = bountyUnlocked({ l2, sample_count: r.sample_count, l2_capped_at: cap }, now);
      if (un) unlocked++;
      updated++;
      return upd.bind(l1, l2, points, from || null, cap || null, un,
        r.seg_key, r.train_kind, r.dir, r.kind, r.slot);
    }));
  }
  return { inserted, updated, capped, unlocked };
}

// ── 判定：兩組閘門、三種結果（規格 §7）─────────────────────────────────────
// 沿途每 60 秒一批、一批一列，判定時依 (actor, trip_date, train_no) 併回同一趟。
function assembleTrip(rows) {
  const first = rows[0];
  const pts = [];
  for (const r of rows) { try { pts.push(...JSON.parse(r.payload)); } catch (e) {} }
  pts.sort((a, b) => a.t - b.t);
  // 上傳的 dir 是錄製開始時的提示值；dwell 卡本身不分方向，使用者又不一定先跟隨一班車，
  // 所以不能拿它判真實軌跡是否「倒退」。完整趟已經組回來後，以首末里程判實際方向；
  // 只有資料短到無法判斷時才保留上傳值，交給品質閘判 too_short。
  const d0 = Number(pts[0] && pts[0].d), d1 = Number(pts[pts.length - 1] && pts[pts.length - 1].d);
  const dir = pts.length >= 2 && Number.isFinite(d0) && Number.isFinite(d1) && d0 !== d1
    ? (d1 < d0 ? 1 : 0) : Number(first.dir);
  return { actor: first.actor, tripDate: first.trip_date, trainNo: first.train_no, sys: first.sys,
    lnId: first.ln_id, dir, sampleIds: rows.map(r => r.id), pts };
}
const median = a => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1;
  return !s.length ? 0 : (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2); };
// 每個正規區間錄到多少:把樣本點的里程投在區間 [dA,dB] 上,看有多少「秒」落在裡面對應到的距離比例。
// 用距離比例不用點數比例:取樣稀疏的那一段不該因為點少就被判成沒錄到,錄到的距離才是真的。
//
// dwell 不是「有點靠近車站」就算：那會把不停靠的通過車也算進來。共同判準放在
// data/bounty_rules.json quality.dwell：站中心附近要有一段真的接近靜止的連續速度，
// 而且該站前後兩側都要有樣本。peak/off 的切法不在這裡猜，直接吃
// build_bounty_units.mjs 寫進同一份單位產物的 peakHoursBySys；門檻缺漏直接中止，不偷偷降級。
//
// 🔴 兩側樣本的例外（2026-07-29）：使用者自己上下車的那一站只會有單側樣本——在月台上開始錄，
// 站前那一側根本不存在；停穩後結束錄，站後那一側也不存在。但那一站的停靠與離站時刻同樣有意義，
// 不該收不到。所以「另一側」只在**這趟軌跡自己真的走到得了**的時候才要求：以整趟的里程範圍
// [tripLoM, tripHiM] 判斷，範圍沒跨過去就不能拿那一側當否決理由。
// 這一條同時涵蓋了線端站（軌跡不可能走出線外），所以不必再對 stations 的頭尾寫特例。
// 仍要求至少一側有樣本——只有一個落在站心的孤點不算到過那一站。
// 前端 bountyUpdateDwellProgress() 必須用同一組判斷（規格 §5：兩邊門檻不同才是 bug），
// 那邊的里程範圍取 r._dLo/_dHi（整趟），不是 _recent 的視窗。
function coverageOf(trip, line, rules, peakHoursBySys) {
  const sts = (line.stations || []).slice().sort((a, b) => a.d - b.d);
  const out = [];
  const ds = trip.pts.map(p => p.d / 1000);          // 上傳是公尺，站里程是公里
  if (!ds.length) return out;
  for (let i = 1; i < sts.length; i++) {
    const a = sts[i - 1], b = sts[i], lo = Math.min(a.d, b.d), hi = Math.max(a.d, b.d);
    if (a.name === b.name || hi - lo < 0.05) continue;
    let lo2 = Infinity, hi2 = -Infinity, n = 0;
    for (const d of ds) if (d >= lo && d <= hi) { lo2 = Math.min(lo2, d); hi2 = Math.max(hi2, d); n++; }
    if (n < 2) continue;
    out.push({ key: `${line.sys}|${line.lnId}|${a.name < b.name ? a.name + '|' + b.name : b.name + '|' + a.name}`,
      kind: 'track', slot: '', dir: Number(trip.dir), cov: Math.min(1, (hi2 - lo2) / (hi - lo)) });
  }

  const D = rules && rules.quality && rules.quality.dwell;
  if (!D) throw new Error('invalid bounty rule: quality.dwell');
  const day = new Date(`${trip.tripDate}T00:00:00Z`).getUTCDay();
  const holiday = day === 0 || day === 6;
  const peakHours = peakHoursBySys && peakHoursBySys[line.sys];
  if (!holiday && !Array.isArray(peakHours)) return out;
  const seen = new Set();
  const tripDs = trip.pts.map(p => Number(p.d));
  const tripLoM = Math.min(...tripDs), tripHiM = Math.max(...tripDs);
  for (let i = 0; i < sts.length; i++) {
    const st = sts[i], key = `${line.sys}|${line.lnId}|${st.name}|${st.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const centerM = Number(st.d) * 1000;
    const local = trip.pts.filter(p => Math.abs(Number(p.d) - centerM) <= D.stationWindowM);
    if (!local.length) continue;
    const localDs = local.map(p => Number(p.d));
    const hasBefore = Math.min(...localDs) <= centerM - D.sideMinM;
    const hasAfter = Math.max(...localDs) >= centerM + D.sideMinM;
    const needBefore = tripLoM <= centerM - D.sideMinM;   // 這趟有走到站前，就必須錄到站前
    const needAfter = tripHiM >= centerM + D.sideMinM;    // 這趟有走到站後，就必須錄到站後
    const spatialPass = (!needBefore || hasBefore) && (!needAfter || hasAfter) && (hasBefore || hasAfter);
    if (!spatialPass) continue;

    let runStart = null, prevT = null, stopAt = null;
    for (const p of local) {
      const t = Number(p.t), v = Number(p.v);
      const low = Math.abs(Number(p.d) - centerM) <= D.stopRadiusM &&
        Number.isFinite(v) && v <= D.stopSpeedMaxMps;
      if (!low) { runStart = null; prevT = null; continue; }
      if (runStart == null || !(t > prevT) || t - prevT > D.maxLowSpeedGapSec) runStart = t;
      prevT = t;
      if (t - runStart >= D.stopMinSec) { stopAt = t; break; }
    }
    if (stopAt == null) continue;
    const hour = Math.floor((((stopAt % 86400) + 86400) % 86400) / 3600);
    const slot = holiday ? 'holiday' : peakHours.includes(hour) ? 'peak' : 'off';
    out.push({ key, kind: 'dwell', slot, dir: 0, cov: 1 });
  }
  return out;
}
// 防偽閘：四重，全部不告知細節（給細節等於教人怎麼繞過）。
// ⚠️ 這一組只回答「這是不是偽造的」，不回答「資料能不能用」。判錯的代價是懲罰誠實的使用者，
// 所以每一重都刻意寫得保守：模稜兩可一律放行，交給品質閘去降級成 unusable。
function integrityGate(trip, ctx, rules) {
  const R = rules.integrity, now = Number(ctx.now) || Date.now();
  // 第一重：對得上表定。⚠️ 只有「日期在未來」或「日期超出上傳窗」才算防偽失敗——
  // 車次存在但軌跡對不上是「選錯車次」，那是自動修正的機會不是作弊（規格 §7）。
  const tripMs = Date.parse(trip.tripDate + 'T00:00:00Z');
  if (!Number.isFinite(tripMs)) return { pass: false, code: 'future_date' };
  if (tripMs > now + 86400000) return { pass: false, code: 'future_date' };
  if (now - tripMs > R.tripDateMaxAgeDays * 86400000) return { pass: false, code: 'stale_date' };
  const pts = trip.pts;
  if (pts.length < 2) return { pass: true, code: null };        // 太短交給品質閘判 too_short
  // 第三重：物理可能——里程單調（同方向）、加速度上限、速度上限依系統
  // 查表鍵是系統家族（TRA/THSR/metro），trip.sys 是 SYS_DEFS 的 id（tra_sched/…），要先過桶對照。
  // 直接拿 trip.sys 查會恆常 undefined 落到 default(36.2m/s=130km/h)，高鐵 300km/h 每趟都被判
  // impossible_physics；台鐵剛好卡在 130 邊界，GPS 抖動就誤判。
  const cap = R.speedCapMps[BOUNTY_SYS_BUCKET[trip.sys]] || R.speedCapMps.default;
  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i].t - pts[i - 1].t, dd = pts[i].d - pts[i - 1].d;
    if (dt <= 0) continue;
    const forwardDd = Number(trip.dir) === 1 ? -dd : dd;
    if (forwardDd < -50) return { pass: false, code: 'impossible_physics' };     // 50m 容差吸收 GPS 抖動
    const v = forwardDd / dt;
    if (v > cap * 1.15) return { pass: false, code: 'impossible_physics' };      // 15% 容差吸收投影誤差
    const dv = (Number(pts[i].v) || v) - (Number(pts[i - 1].v) || v);
    if (Math.abs(dv / dt) > R.maxAccelMps2 * 3) return { pass: false, code: 'impossible_physics' };
  }
  // 第四重：都卜勒一致性。coords.speed 是都卜勒量測不是位置微分，真實資料兩者會有適度差異；
  // spoof 工具產出的兩者過度一致。相關係數高到接近 1 才判——這一重刻意只抓最粗糙的偽造。
  const a = [], b = [];
  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i].t - pts[i - 1].t;
    if (dt <= 0 || !Number.isFinite(pts[i].v)) continue;
    a.push(pts[i].v); b.push(Math.abs(pts[i].d - pts[i - 1].d) / dt);
  }
  if (a.length >= 30) {
    const mA = a.reduce((s, x) => s + x, 0) / a.length, mB = b.reduce((s, x) => s + x, 0) / b.length;
    let sab = 0, sa = 0, sb = 0;
    for (let i = 0; i < a.length; i++) { const x = a[i] - mA, y = b[i] - mB; sab += x * y; sa += x * x; sb += y * y; }
    const corr = (sa > 0 && sb > 0) ? sab / Math.sqrt(sa * sb) : 0;
    if (corr > R.dopplerCorrMax) return { pass: false, code: 'doppler_too_clean' };
  }
  // 第二重：對得上當時的獨立誤點回報。這是最難繞的一重——偽造者得同時猜中我們幾小時前存下來的值。
  // 🔴 沒有獨立紀錄時直接跳過，不判失敗：捷運沒有車次級誤點源（規格 §7 那個不對稱），
  // 在那裡判失敗等於把整個捷運的樣本全部殺掉，而捷運正是最需要收的地方。
  const events = (ctx.events || []).filter(e => Number.isFinite(Number(e.schedSec)));
  if (events.length && ctx.line) {
    const sts = (ctx.line.stations || []);
    let worst = 0;
    for (const e of events) {
      const st = sts.find(s => s.name === e.sta);
      if (!st) continue;
      // 樣本推得的通過時刻：里程最接近該站的那個點
      let best = null;
      for (const p of pts) { const gap = Math.abs(p.d / 1000 - st.d); if (!best || gap < best.gap) best = { gap, t: p.t }; }
      if (!best || best.gap > 0.5) continue;                                   // 沒經過那一站就不比
      worst = Math.max(worst, Math.abs(best.t - (Number(e.schedSec) + Number(e.delay || 0) * 60)));
    }
    if (worst > R.delayMatchToleranceSec) return { pass: false, code: 'delay_mismatch' };
  }
  return { pass: true, code: null };
}
// 品質閘：決定資料採不採用，不決定給不給章。每一項都有可以告知的原因與可以行動的建議
// （文案在 data/bounty_rules.json 的 qualityText，前端錄製當下用的是同一份）。
// 順序照規格 §7 那張表：先講使用者控制得了的（精確位置、遮蔽、取樣頻率），再講環境的。
function qualityGate(trip, ctx, rules) {
  const Q = rules.quality, pts = trip.pts;
  if (!trip.trainNo) return { pass: false, code: 'unknown_train' };
  if (pts.length < 10) return { pass: false, code: 'too_short' };
  const accs = pts.map(p => Number(p.acc)).filter(Number.isFinite);
  const accMed = median(accs);
  // 精確位置被關：誤差不只大，而且「平坦」——真實的遮蔽會忽好忽壞，關掉精確位置是恆定的粗略值
  if (accMed > Q.accMedianPreciseOffM) {
    const spread = accs.length ? (Math.max(...accs) - Math.min(...accs)) : 0;
    if (spread < accMed * 0.25) return { pass: false, code: 'precise_off' };
    return { pass: false, code: 'acc_blocked' };
  }
  if (accMed > Q.accMedianBlockedM) return { pass: false, code: 'acc_blocked' };
  const gaps = [];
  for (let i = 1; i < pts.length; i++) gaps.push(pts[i].t - pts[i - 1].t);
  if (median(gaps) > Q.sampleGapMedianSec) return { pass: false, code: 'too_sparse' };
  if (gaps.some(g => g > Q.noFixGapSec)) return { pass: false, code: 'underground' };
  const cov = ctx.line ? coverageOf(trip, ctx.line, rules) : [];
  if (!cov.length || !cov.some(c => c.cov >= Q.segCoverageMin)) return { pass: false, code: 'too_short' };
  return { pass: true, code: null };
}
// 三態。🔴 順序固定：先防偽、後品質。防偽決定「給不給章」，品質決定「資料採不採用」。
// unusable 那一支的每一件事都要與 ok 相同，只有計不計入下架門檻不同——規格 §11 明說這是最容易寫錯的地方。
function verdictOf(ig, qg) {
  if (!ig.pass) return { verdict: 'suspect', qualityCode: null, rejectCode: ig.code };
  if (!qg.pass) return { verdict: 'unusable', qualityCode: qg.code, rejectCode: null };
  return { verdict: 'ok', qualityCode: null, rejectCode: null };
}

// 測試專用重置:bountyRulesMem／bountyUnitsMem 是模組層級快取(各自宣告處已有註解),同一個
// process 內對同一份 env 內容只讀一次。正式環境每次 cron 呼叫都是全新 isolate,快取不會跨呼叫
// 殘留,沒有這個問題;但同一支測試檔案若想在不同情境間換 ASSETS 內容重跑 bountyVerifyCron,
// 第二個情境會讀到第一個情境快取住的舊值(Task 2 report 風險 #4、Task 5 report 風險 #1 都提過
// 這個設計)。供測試在切換情境前呼叫清空,不供正式流程使用,production 路徑不 import 這個函式。
function bountyResetMemCaches() { bountyRulesMem = null; bountyUnitsMem = null; }

// 單次 cron 最多處理幾列 pending 樣本。4000 列 ≒ 66 小時的 1Hz 錄製，遠大於任何一天的真實
// 上傳量，但把最壞情況變成一個常數。超出的部分留到明天那一發（它們還是 pending）。
const BOUNTY_VERIFY_MAX_ROWS = 4000;
// 隔日判定。BOUNTY_NOW 只給測試用（cron 沒辦法等時間流過，而三態的判定與時間有關）。
async function bountyVerifyCron(env) {
  const rules = await bountyRules(env);
  const M = await bountyUnits(env);
  const now = Number(env.BOUNTY_NOW) || Date.now();
  // 🔴 一定要有 LIMIT（2026-07-29 稽核）：這支 cron 每天跑一次，舊版一句 SELECT * 就把所有
  // pending 列連 payload（每列一整批里程序列）全讀進記憶體。寫入端點是免登入的，所以「有多少
  // pending」是外部可控的數字——沒有上限就等於把 cron 的記憶體與 CPU 交給任何人決定。
  // 多出來的下次再跑（它們仍是 pending），代價是延後一天，不是遺失。
  const rs = await env.DELAY_DB.prepare(
    "SELECT * FROM bounty_samples WHERE verdict='pending' ORDER BY actor, trip_date, train_no, submitted_at LIMIT ?"
  ).bind(BOUNTY_VERIFY_MAX_ROWS + 1).all();
  const fetched = rs.results || [];
  // 🔴 截斷必須切在「趟」的邊界上。ORDER BY 讓同一趟 (actor,trip_date,train_no) 的列相鄰，
  // 從中間切開會讓那一趟被當成半趟送去判定＝品質閘判 too_short，那是把資料判錯，不是延後。
  const tripKey = r => `${r.actor}|${r.trip_date}|${r.train_no}`;
  const rows = fetched.slice(0, BOUNTY_VERIFY_MAX_ROWS);
  let truncated = false;
  if (fetched.length > BOUNTY_VERIFY_MAX_ROWS) {
    truncated = true;
    const lastKey = tripKey(rows[rows.length - 1]);
    // 只在還剩得下東西時才砍尾——單一趟就超過上限（不可能發生：一天 1Hz 最多 1440 批）時
    // 全砍會讓 cron 每天原地空轉，永遠處理不完。那種情況寧可整趟照跑。
    let cut = rows.length;
    while (cut > 0 && tripKey(rows[cut - 1]) === lastKey) cut--;
    if (cut > 0) rows.length = cut;
  }
  const groups = new Map();
  for (const r of rows) {
    const k = tripKey(r);
    (groups.get(k) || groups.set(k, []).get(k)).push(r);
  }
  const stat = { trips: 0, ok: 0, unusable: 0, suspect: 0, truncated };
  for (const rows of groups.values()) {
    stat.trips++;
    const trip = assembleTrip(rows);
    const line = M.lines[`${trip.sys}|${trip.lnId}`] || null;
    // 第二重要用的獨立真相源：我們自己幾小時前存下的逐站觀測（台鐵才有）
    let events = [];
    try {
      const ev = await env.DELAY_DB.prepare(
        'SELECT sta, delay, obs_at FROM tra_station_events WHERE service_date=? AND train_no=?'
      ).bind(trip.tripDate, trip.trainNo).all();
      events = ev.results || [];
    } catch (e) {}
    const ctx = { line, events, now };
    const v = verdictOf(integrityGate(trip, ctx, rules), qualityGate(trip, ctx, rules));
    stat[v.verdict]++;
    const cov = (v.verdict === 'suspect' || !line) ? [] : coverageOf(trip, line, rules, M.peakHoursBySys)
      .filter(c => c.cov >= rules.quality.segCoverageMin);
    const segsJson = JSON.stringify(cov);
    const upd = env.DELAY_DB.prepare(
      'UPDATE bounty_samples SET verdict=?, verdict_at=?, quality_code=?, reject_code=?, segs=? WHERE id=?');
    await env.DELAY_DB.batch(trip.sampleIds.map(id =>
      upd.bind(v.verdict, now, v.qualityCode, v.rejectCode, segsJson, id)));
    if (v.verdict === 'suspect') continue;                    // 不給章、不計點、不計入門檻
    // 🔴 unusable 與 ok 在點數上完全一樣：排除作弊就照給（規格 §1 拍板 3、§8）
    let earned = 0;
    const creditedKinds = new Map();
    for (const c of cov) {
      const creditKey = `${c.key}|${c.dir}|${c.kind}|${c.slot}`;
      const lock = await env.DELAY_DB.prepare(
        "SELECT points_locked,train_kind FROM bounty_claims WHERE actor=? AND seg_key=? AND dir=? AND kind=? AND slot=?" +
        " AND status='open' AND expires_at>=? ORDER BY claimed_at DESC,id DESC LIMIT 1"
      ).bind(trip.actor, c.key, c.dir, c.kind, c.slot, Date.parse(trip.tripDate + 'T00:00:00Z')).first();
      if (lock) {
        creditedKinds.set(creditKey, String(lock.train_kind));
        earned += Number(lock.points_locked) || 0;
        continue;
      }
      // 沒接懸賞就直接錄（跟車面板的第二個入口）：用當下的板價，不是 0
      const row = await env.DELAY_DB.prepare(
        'SELECT points,train_kind FROM bounty_board WHERE seg_key=? AND kind=? AND dir=? AND slot=?' +
        ' ORDER BY points DESC,train_kind LIMIT 1'
      ).bind(c.key, c.kind, c.dir, c.slot).first();
      if (row) creditedKinds.set(creditKey, String(row.train_kind));
      earned += Number(row && row.points) || 0;
    }
    earned = Math.min(earned, rules.dailyPointsCap);          // 每人每日計點上限（規格 §7 其他防線）
    await env.DELAY_DB.prepare(
      'INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES (?,NULL,?,NULL,?)' +
      ' ON CONFLICT(actor) DO UPDATE SET points = points + excluded.points, updated_at = excluded.updated_at'
    ).bind(trip.actor, earned, now).run();
    if (v.verdict !== 'ok') continue;                         // ⬅ unusable 到此為止：不計入下架門檻
    // 只有 ok 才推進 sample_count，收滿才下架（coverN 分系統：捷運要 N≥3 趟一致）
    // 同 integrityGate 的 speedCapMps：coverN 的鍵是系統家族，要過桶對照才查得到。
    // 直接查 trip.sys 會恆常落到 coverN.metro(3)，與 groupBoardRows 給前端看的 coverN.TRA(1)
    // 不一致——使用者跑完一趟看到「1/1 收滿」，段卻永遠不下架。
    const need = rules.coverN[BOUNTY_SYS_BUCKET[trip.sys]] || rules.coverN.metro;
    for (const c of cov) {
      const trainKind = creditedKinds.get(`${c.key}|${c.dir}|${c.kind}|${c.slot}`);
      if (!trainKind) continue;
      await env.DELAY_DB.prepare(
        'UPDATE bounty_board SET sample_count = sample_count + 1,' +
        ' covered_at = CASE WHEN sample_count + 1 >= ? THEN COALESCE(covered_at, ?) ELSE covered_at END' +
        ' WHERE seg_key=? AND train_kind=? AND dir=? AND kind=? AND slot=?'
      ).bind(need, now, c.key, trainKind, c.dir, c.kind, c.slot).run();
      await env.DELAY_DB.prepare(
        "UPDATE bounty_claims SET status='fulfilled' WHERE actor=? AND status='open'" +
        ' AND seg_key=? AND train_kind=? AND dir=? AND kind=? AND slot=?'
      ).bind(trip.actor, c.key, trainKind, c.dir, c.kind, c.slot).run();
    }
  }
  return stat;
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

// 逐站事件保留期:刪掉台北今日往前 STATION_EVENT_KEEP_DAYS 天以外的舊列(重用 addDays/twToday)。
// 獨立於 delay ingest——放進 scheduled 的 finally,ingest 成功或失敗(rethrow)都會執行;本函式失敗
// 只由呼叫端 console.error、不 rethrow,不動既有「ingest 失敗要 rethrow」的語意。
//
// 2026-07-25 由 30 天延長為 365 天:這批逐站觀測是「當日真實位置回放」唯一的資料來源,而過去的
// 觀測一旦刪掉就永遠補不回來(TDX 只給即時,沒有歷史位置)。負擔實測:寫入量不變(每天約 2 萬列,
// 搭 /api/tra-live 刷新的順風車,零新增 TDX 呼叫)、查詢速度不變(PK 以 service_date 起頭且
// WITHOUT ROWID=按日期叢集,查某一天是連續範圍掃描,與總天數無關)、儲存約 2MB/天 → 一年約
// 730MB(D1 單庫上限 10GB)。要收回來只改這個常數,下一次 cron 就會把超期的刪掉。
const STATION_EVENT_KEEP_DAYS = 365;
async function pruneStationEvents(env) {
  const cutoff = addDays(twToday(), -STATION_EVENT_KEEP_DAYS);
  const r = await env.DELAY_DB.prepare('DELETE FROM tra_station_events WHERE service_date < ?').bind(cutoff).run();
  console.log(`[cron station-events] 清理 < ${cutoff}: ${(r.meta && r.meta.changes) || 0} 列`);
}

export default {
  // 每天台北 09:15 / 12:15 觸發(wrangler.jsonc triggers.crons)。錯誤 console.error 後
  // rethrow,讓 Cloudflare 把該次 cron 標記為失敗(observability 可查)。
  async scheduled(event, env, ctx) {
    // 每分鐘的北捷帳本與每日台鐵誤點 cron 必須完全分流；不然會每分鐘重跑台鐵 ingest。
    if (event && event.cron === '* * * * *') {
      // 災害監看與北捷帳本平行跑：前者即使失敗只記錄，不得拖垮不可重現的帳本取樣；
      // 帳本若失敗仍照舊 rethrow，讓 Cloudflare 把 cron 標紅。
      const hazardTask = hazardMonitorWithTimeout(event, env).catch(e => {
        console.error('[cron hazard] 失敗:', (e && e.stack) || String(e));
        return { error: String((e && e.message) || e) };
      });
      // 災害來源/公告不能延遲或改變北捷帳本 cron 的成功/失敗契約；scheduled runtime 一定提供 waitUntil。
      // 本機直接呼叫 default.scheduled 若沒帶 ctx，catch 已吞住 rejection，帳本仍照原路徑完成。
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(hazardTask);
      try {
        const ledger = await trtcLedgerScheduled(event, env);
        return ledger; // 維持原本 scheduled 回傳 shape，避免帳本驗收/觀測端因加觸發器而變契約
      }
      catch (e) {
        console.error('[cron trtc-ledger] 失敗:', (e && e.stack) || String(e));
        throw e;
      }
    }
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
      // 懸賞估值只掛第二班(台北 12:15)。掛兩班等於每天重算兩次估值,而 L2 是以「天」為單位的,
      // 多跑一次只是多花 D1 寫入。挑第二班是因為第一班要先讓 ingestDelayHistory 把前一日的
      // 誤點資料寫進來——驗證閘的第二重要對那份資料。獨立 try/catch,不影響上面 ingest 的 rethrow 語意。
      if (event && event.cron === '15 4 * * *') {
        try {
          const v = await bountyValuationCron(env);
          console.log(`[cron bounty 估值] 新上架 ${v.inserted}, 重算 ${v.updated}, 首次到頂 ${v.capped}, 自動開關 ${v.unlocked}`);
        } catch (e) { console.error('[cron bounty 估值] 失敗:', (e && e.stack) || String(e)); }
        // 順序是先估值後驗證:驗證要用到板上的當下點數(沒接懸賞直接錄的那條路徑),先估值才是當天的價。
        // 獨立 try/catch,不影響上面估值的 catch 語意,也不影響上層 ingest 的 rethrow 語意。
        try {
          const q = await bountyVerifyCron(env);
          console.log(`[cron bounty 驗證] ${q.trips} 趟 → 採用 ${q.ok}／可惜 ${q.unusable}／可疑 ${q.suspect}`);
        } catch (e) { console.error('[cron bounty 驗證] 失敗:', (e && e.stack) || String(e)); }
      }
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
    // 流量來源埋點:App 殼與網頁打的是同一顆 Worker,CF 的請求計數把兩邊混成一個數字,這裡按 Origin 拆開。
    // App 殼是跨來源請求(capacitor://localhost),瀏覽器必帶 Origin;網頁同源 GET 不帶 Origin → 落 'web'。
    // 只記 /api/*:靜態資產直出不喚醒 Worker(見本檔頂註與 wrangler.jsonc 的 run_worker_first 鐵則),
    // 也就是說計費的 Worker 請求全在這裡,拆到這層就是完整的;資產請求則結構上 100% 來自網頁。
    // blob1=來源(app|web) blob2=端點 blob3=裝置(m|d),index=來源。觀測絕不可影響服務,例外整段吞掉。
    if (isApi && env.TRAFFIC) {
      try {
        const seg = url.pathname.slice(5);
        const plat = APP_ORIGINS.has(origin) ? 'app' : 'web';
        const dev = /Mobile/.test(request.headers.get('user-agent') || '') ? 'm' : 'd';
        env.TRAFFIC.writeDataPoint({ blobs: [plat, API_ENDPOINTS.has(seg) ? seg : 'other', dev], indexes: [plat] });
      } catch (e) {}
    }
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
    if (isApi && !API_POST_ALLOWED.has(url.pathname) && request.method !== 'GET' && request.method !== 'HEAD') {
      res = jsonRes({ error: 'method not allowed' }, 405, 'no-store');
      res.headers.set('Allow', 'GET, HEAD, OPTIONS');
    }
    else if (url.pathname === '/api/tra-live') res = await traLive(request, env, ctx);
    else if (url.pathname === '/api/tra-alert') res = await traAlert(request, env);
    else if (url.pathname === '/api/thsr-alert') res = await thsrAlert(request, env);
    else if (url.pathname === '/api/metro-alert') res = await metroAlert(request, env);
    else if (url.pathname === '/api/hazard-alert') res = await hazardAlert(request, env);
    else if (url.pathname === '/api/metro-live') {
      const sys = url.searchParams.get('sys');
      // hasOwnProperty.call 而非 METRO_LIVE_OPS[sys]:後者吃原型鏈,sys='constructor' 等會誤過閘門
      res = Object.prototype.hasOwnProperty.call(METRO_LIVE_OPS, sys) ? await metroLive(request, env, sys) : jsonRes({ error: 'bad sys' }, 400, 'no-store');
    }
    else if (url.pathname === '/api/ntmetro-live') {
      const sys = url.searchParams.get('sys');
      res = NTM_LIVE_SYS.has(sys) ? await ntmetroLive(request, env, sys) : jsonRes({ error: 'bad sys' }, 400, 'no-store');
    }
    else if (url.pathname === '/api/trtc-live') { res = await trtcLive(request, env); }
    else if (url.pathname === '/api/delay-stats') res = await delayStats(request, env);
    else if (url.pathname === '/api/delay-history') res = await delayHistory(request, env);
    else if (url.pathname === '/api/station-events') res = await stationEvents(request, env);
    else if (url.pathname === '/api/today-board') res = await todayBoard(request, env);
    else if (url.pathname === '/api/basemap-token') res = await basemapToken(request, env);
    else if (url.pathname === '/api/basemap-session') res = await basemapSession(request, env);
    else if (url.pathname === '/api/account-delete') res = await deleteAccountData(request, env);
    else if (url.pathname === '/api/bounty-board') res = await bountyBoard(request, env);
    else if (url.pathname === '/api/bounty-claim') res = await bountyClaim(request, env);
    else if (url.pathname === '/api/bounty-submit') res = await bountySubmit(request, env);
    else if (url.pathname === '/api/bounty-me') res = await bountyMe(request, env);
    else if (url.pathname === '/api/bounty-merge') res = await bountyMerge(request, env);
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
// NCDR 災害觸發器純解析 + 端點/cron 編排，供 fixture-only 離線回歸測試。
export const _hazard = { ncdrTimeMs, normalizeNcdrHazards, hazardAlert, hazardMonitorScheduled, resetHazardMem };
// 純函式導出,供離線回歸測試 import:逐站事件 diff 與 mem.at→台北日換算。
export const _stationEvents = { diffTrains, twDayFromMemAt };
// 純函式導出,供離線回歸測試 import:誤點履歷視窗計算、車次驗證與回應組裝。
export const _delayHistory = { delayHistoryWindow, buildDelayHistoryBody, isValidTrainNo };
// 供離線回歸測試 import:驗「節流擋在 outbound fetch 之前」。這兩個不是純函式,測試得自備
// env 替身與 fetch 替身;導出的目的就是讓測試能數「被擋掉時到底有沒有打上游」。
export const _rateLimit = { rateLimited, delayHistory, deleteAccountData };
// 純函式與端點處理器導出，供離線回歸測試 import（scripts/verify_bounty_*.mjs）。
// 端點也導出的理由同 _rateLimit：這些不是純函式，測試要自備 env 替身才驗得到「節流有沒有擋在
// D1 寫入之前」「回應裡有沒有夾帶 reject_code」這類只在編排層才成立的性質。
export const _bounty = { bountyCardId, bountySegLine, groupBoardRows, bountyBoard, isActorId, resolveActor,
  bountyClaim, hasGeoKeys, sanitizeSamples, bountySubmit, firebaseUid, bountyMe, bountyMerge, bountyPurgeUid,
  bountyMedian, bountyL1, bountyL2, bountyPointsOf, bountyUnlocked, bountyValuationCron,
  assembleTrip, integrityGate, qualityGate, verdictOf, coverageOf, bountyVerifyCron, bountyResetMemCaches };
// 純函式導出,供離線回歸測試 import:trtcParse 雙路徑解析(含上游故障回 HTML 錯誤頁、
// HTTP 仍 200 那個坑應回 null)、trtcEpoch 台北時間換算、dedupeLatest 同車次抵站歷史去重
// (文湖線 CarWeightBR 把歷史當現況回傳的真實坑,C1)。trtcCall 不是純函式(真的打上游),
// 導出目的是讓 Task 10 的看板驗收腳本能繞過我們自己 worker 的 15 秒快取,直接打
// getTrackInfo 拿當下最新的 CountDown/NowDateTime 做獨立比對(判準不可與 board[] 同源)——
// 呼叫端須自備 { TRTC_API_USER, TRTC_API_PASS } 的 env 物件,帳密從 .dev.vars/環境變數讀。
// trtcMemoStale 是記憶體層門檻的獨立可測版本(task-11),供 verify_trtc_freshness.mjs 量邊界。
// carsOf 是每節車廂擁擠度的缺值防護(task-12):導出讓驗收腳本直接測邊界(缺值/非數字/
// 非正數一律回 null),不必等真的上游漏欄位才驗到。
export const _trtc = { trtcParse, trtcEpoch, dedupeLatest, trtcCall, trtcApiUrl, trtcMemoStale, carsOf };
// B1 驗收用：導出編排層供本機 D1/fixture 測試，正式 router 不因此增加任何路徑。
export const _trtcLedger = {
  trtcBoardEpoch, trtcLedgerContext, persistTrtcLedger, trtcLedgerPreview,
  trtcLedgerMaterialized, trtcLedgerNowEpoch, pruneTrtcLedger, trtcLedgerScheduled,
};
