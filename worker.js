// Cloudflare Worker 入口:靜態資產(assets binding)+ /api/tra-live 台鐵即時動態代理
// + /api/tra-alert 台鐵營運通阻公告 + /api/thsr-alert 高鐵營運狀態公告(颱風停駛等)
// + /api/metro-alert 捷運營運狀態公告(五家聚合)
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

async function traLive(request, env) {
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
    }
    const res = jsonRes(mem, 200, 'public, s-maxage=55, stale-while-revalidate=300');
    await edge.put(cacheKey, res.clone());
    return res;
  } catch (e) {
    if (mem) return jsonRes(mem, 200, 'public, s-maxage=15');
    return jsonRes({ error: String(e.message || e) }, 502, 'no-store');
  }
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
let metroAlertMem = null, metroAlertMemAt = 0;
async function metroAlert(request, env) {
  const cacheKey = new Request(new URL('/api/metro-alert', request.url), { method: 'GET' });
  const edge = caches.default;
  const hit = await edge.match(cacheKey);
  if (hit) return hit;
  try {
    if (!metroAlertMem || Date.now() - metroAlertMemAt > 110e3) {
      const token = await getToken(env);
      const parts = await Promise.all(METRO_ALERT_OPS.map(async ({ op, sys, label }) => {
        try {
          const r = await fetch(`https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/Alert/${op}?%24format=JSON`,
            { headers: { authorization: 'Bearer ' + token } });
          if (r.status === 401) { tok = null; throw new Error('tdx 401'); }
          if (!r.ok) throw new Error('tdx api ' + r.status);
          const d = await r.json();
          return (d.Alerts || []).map(a => {
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
        } catch (e) { return []; } // 單一營運者失敗略過,不影響其他系統
      }));
      metroAlertMem = { at: new Date().toISOString(), alerts: parts.flat() };
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
const NTM_LIVE_SYS = { circular: 1, danhai: 1, ankeng: 1 };
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
    // 軟失敗:回 200+src:null(前端 applyNtmLive 對 null 直接 no-op,退回時刻表推演),
    // 不回 5xx 免得上游瞬斷時訪客 console 留紅字
    return jsonRes({ at: new Date().toISOString(), src: null, error: String(e.message || e) }, 200, 'no-store');
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

export default {
  async fetch(request, env) {
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
    if (url.pathname === '/api/tra-live') res = await traLive(request, env);
    else if (url.pathname === '/api/tra-alert') res = await traAlert(request, env);
    else if (url.pathname === '/api/thsr-alert') res = await thsrAlert(request, env);
    else if (url.pathname === '/api/metro-alert') res = await metroAlert(request, env);
    else if (url.pathname === '/api/metro-live') {
      const sys = url.searchParams.get('sys');
      res = METRO_LIVE_OPS[sys] ? await metroLive(request, env, sys) : jsonRes({ error: 'bad sys' }, 400, 'no-store');
    }
    else if (url.pathname === '/api/ntmetro-live') {
      const sys = url.searchParams.get('sys');
      res = NTM_LIVE_SYS[sys] ? await ntmetroLive(request, env, sys) : jsonRes({ error: 'bad sys' }, 400, 'no-store');
    }
    else if (url.pathname === '/api/account-delete') res = await deletePaidProfile(request, env);
    else res = await env.ASSETS.fetch(request);
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(SEC_HEADERS)) h.set(k, v);
    if (isApi) addAppCors(h, origin);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  },
};
