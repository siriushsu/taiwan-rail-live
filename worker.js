// Cloudflare Worker 入口:靜態資產(assets binding)+ /api/tra-live 台鐵即時動態代理
// + /api/tra-alert 台鐵營運通阻公告 + /api/thsr-alert 高鐵營運狀態公告(颱風停駛等)
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

// 安全標頭統一在出口補（含 API 與靜態資產）；明文 HTTP 一律 301 轉 HTTPS
const SEC_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    let res;
    if (url.pathname === '/api/tra-live') res = await traLive(request, env);
    else if (url.pathname === '/api/tra-alert') res = await traAlert(request, env);
    else if (url.pathname === '/api/thsr-alert') res = await thsrAlert(request, env);
    else res = await env.ASSETS.fetch(request);
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(SEC_HEADERS)) h.set(k, v);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  },
};
