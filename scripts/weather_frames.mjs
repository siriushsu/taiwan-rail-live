// 跟車即時天氣 P0：每 5 分鐘抓氣象署的雷達整合回波（O-A0059-001）、10 分鐘綜觀氣象（O-A0003-001）、
// 雨量站（O-A0002-001），雷達裁成本島範圍，三份合成一筆存進 D1 `weather_frames`（schema/0018），
// `/api/weather` 給最新一筆或指定時刻那一筆。畫面效果還沒做；這一版只蒐集資料，並留歷史給雷達對雨量站的比對
// （scripts/weather_compare.mjs）。氣象署只給最新一版、不給歷史，所以要自己存。
//
// 來源：有 `CWA_API_KEY`（氣象資料開放平臺會員授權碼）就走官方 fileapi；沒有或官方失敗才退到氣象署的公開檔案桶
// （cwaopendata S3，內容跟 fileapi 同一份，但沒有文件保證位置不變）。每筆都記下實際用了哪個來源。
// 授權：政府資料開放授權條款第 1 版，使用時標示「資料來源：中央氣象署」。

export const WEATHER_CRON = '2-59/5 * * * *';
export const WEATHER_IDS = { radar: 'O-A0059-001', obs: 'O-A0003-001', rain: 'O-A0002-001' };
const KEEP_MS = 90 * 86400e3;
const PRUNE_AT = '03:02'; // 台北時間；落在 WEATHER_CRON 的觸發分鐘上

// 本島＋外圍一格的範圍（WGS84）。澎湖、金門、馬祖沒有鐵道，不收。
export const WEATHER_BBOX = { lon0: 119.95, lon1: 122.10, lat0: 21.85, lat1: 25.35 };
// 雷達格點的座標系是 TWD67（contentDescription 寫的）。換成 WGS84 大約東移 0.0081°、南移 0.0018°（約 830 公尺，不到一格）。
// 數字取自 O-A0003-001 同一站同時附的 TWD67／WGS84 兩組座標：10-30 22:30 全部 363 站的中位數 +0.00814／−0.00177。
// weather_compare.mjs --files 每次都會重算中位數核對。
export const TWD67_TO_WGS84 = { dlon: 0.0081, dlat: -0.0018 };

const S3 = 'https://cwaopendata.s3.ap-northeast-1.amazonaws.com/Observation/';
const FILEAPI = 'https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/';

async function getDataset(id, env, fetchImpl) {
  const tries = [];
  if (env && env.CWA_API_KEY) tries.push(['cwa-api', `${FILEAPI}${id}?Authorization=${encodeURIComponent(env.CWA_API_KEY)}&downloadType=WEB&format=JSON`]);
  tries.push(['cwa-s3', `${S3}${id}.json`]);
  let err;
  for (const [source, url] of tries) {
    try {
      const r = await fetchImpl(url);
      if (!r.ok) throw new Error(`${id} ${source} HTTP ${r.status}`);
      return { source, text: await r.text() };
    } catch (e) { err = e; }
  }
  throw err;
}

const head = (text, key) => {
  const m = new RegExp(`"${key}"\\s*:\\s*"?([^",}]+)`).exec(text.slice(0, 8192));
  return m ? m[1] : null;
};

// 0＝沒有回波（-99 或 ≤ 0 dBZ）、1–254＝dBZ 四捨五入、255＝雷達範圍外或被品管移除（-999）。
export const encodeDbz = v => v <= -998 ? 255 : v <= 0 ? 0 : Math.min(254, Math.round(v));

// 雷達 JSON 約 9 MB、81 萬個數字。不 JSON.parse、不 split：直接在原文上用 indexOf 一路掃逗號，
// 只把落在範圍內的格子寫進 Uint8Array，記憶體只多一份裁切結果（約 5 萬 bytes）。
export function cropRadar(text, bbox = WEATHER_BBOX, shift = TWD67_TO_WGS84) {
  const lon0 = +head(text, 'StartPointLongitude'), lat0 = +head(text, 'StartPointLatitude');
  const res = +head(text, 'GridResolution'), w = +head(text, 'GridDimensionX'), h = +head(text, 'GridDimensionY');
  const at = head(text, 'DateTime'), sent = head(text, 'sent');
  if (![lon0, lat0, res, w, h].every(Number.isFinite) || !at) throw new Error('radar header');
  const twd67 = /TWD67/.test(text.slice(0, 16384));
  const dlon = twd67 ? shift.dlon : 0, dlat = twd67 ? shift.dlat : 0;
  // 格點 (i, j) 的 WGS84 座標＝(lon0 + i·res + dlon, lat0 + j·res + dlat)，j 由南往北
  const c0 = Math.max(0, Math.floor((bbox.lon0 - dlon - lon0) / res)), c1 = Math.min(w, Math.ceil((bbox.lon1 - dlon - lon0) / res) + 1);
  const r0 = Math.max(0, Math.floor((bbox.lat0 - dlat - lat0) / res)), r1 = Math.min(h, Math.ceil((bbox.lat1 - dlat - lat0) / res) + 1);
  const cw = c1 - c0, ch = r1 - r0, out = new Uint8Array(cw * ch);
  const m = /"content"\s*:\s*"/.exec(text);
  if (!m) throw new Error('radar content');
  const stop = text.indexOf('"', m.index + m[0].length);
  let p = m.index + m[0].length;
  for (let r = 0; r < r1; r++) {
    if (r < r0) { for (let c = 0; c < w; c++) p = text.indexOf(',', p) + 1; continue; }
    for (let c = 0; c < w; c++) {
      const q = text.indexOf(',', p), end = q < 0 || q > stop ? stop : q;
      if (end <= p) throw new Error(`radar short at row ${r} col ${c}`);
      if (c >= c0 && c < c1) out[(r - r0) * cw + (c - c0)] = encodeDbz(+text.slice(p, end));
      p = end + 1;
    }
  }
  return {
    at, sent, res, w: cw, h: ch, datum: twd67 ? 'TWD67→WGS84' : 'WGS84',
    lon0: +(lon0 + c0 * res + dlon).toFixed(5), lat0: +(lat0 + r0 * res + dlat).toFixed(5), bytes: out,
  };
}

// 取一個 WGS84 座標的 dBZ；格外回 null，範圍外（255）也回 null。
export function sampleRadar(radar, lon, lat, bytes = radar.bytes) {
  const i = Math.round((lon - radar.lon0) / radar.res), j = Math.round((lat - radar.lat0) / radar.res);
  if (i < 0 || j < 0 || i >= radar.w || j >= radar.h) return null;
  const v = bytes[j * radar.w + i];
  return v === 255 ? null : v;
}

const wgs84 = s => {
  const c = ((s.GeoInfo && s.GeoInfo.Coordinates) || []).find(x => x.CoordinateName === 'WGS84');
  return c ? [+(+c.StationLongitude).toFixed(4), +(+c.StationLatitude).toFixed(4)] : null;
};
const num = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
const str = v => v == null || v === '' || String(v).startsWith('-99') ? null : String(v);
const mode = xs => { const n = new Map(); for (const x of xs) if (x) n.set(x, (n.get(x) || 0) + 1); return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] || null; };
const stations = text => { const j = JSON.parse(text); return (j.cwaopendata && j.cwaopendata.dataset && j.cwaopendata.dataset.Station) || []; };

export function parseObs(text) {
  const list = stations(text), rows = [];
  for (const s of list) {
    const ll = wgs84(s), e = s.WeatherElement || {};
    if (ll) rows.push([s.StationId, ll[0], ll[1], str(e.Weather), str(e.VisibilityDescription)]);
  }
  return { at: mode(list.map(s => s.ObsTime && s.ObsTime.DateTime)), fields: ['id', 'lon', 'lat', 'weather', 'vis'], rows };
}

export function parseRain(text) {
  const list = stations(text), rows = [];
  for (const s of list) {
    const ll = wgs84(s), e = s.RainfallElement || {};
    if (ll) rows.push([s.StationId, ll[0], ll[1], num(e.Past10Min && e.Past10Min.Precipitation), num(e.Past1hr && e.Past1hr.Precipitation)]);
  }
  return { at: mode(list.map(s => s.ObsTime && s.ObsTime.DateTime)), fields: ['id', 'lon', 'lat', 'p10m', 'p1h'], rows };
}

const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const gzip = async s => new Response(new Blob([s]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
const gunzip = async bytes => new Response(new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'))).text();

export function frameBody(radar, obs, rain, sources) {
  const { bytes, ...meta } = radar;
  return JSON.stringify({
    v: 1, sources, attribution: '資料來源：中央氣象署',
    radar: { ...meta, enc: 'u8: 0=無回波, 1-254=dBZ, 255=範圍外', data: b64(bytes) },
    obs, rain,
  });
}

export async function weatherScheduled(event, env, { fetch: fetchImpl = fetch } = {}) {
  const now = event && event.scheduledTime ? event.scheduledTime : Date.now();
  const db = env.DELAY_DB;
  if (new Date(now + 8 * 3600e3).toISOString().slice(11, 16) === PRUNE_AT)
    await db.prepare('DELETE FROM weather_frames WHERE updated_ms < ?').bind(now - KEEP_MS).run();
  const last = await db.prepare('SELECT radar_at, obs_at, rain_at FROM weather_frames ORDER BY radar_at DESC LIMIT 1').first();
  const radarSrc = await getDataset(WEATHER_IDS.radar, env, fetchImpl);
  const radar = cropRadar(radarSrc.text);
  radarSrc.text = null;
  if (last && radar.at < last.radar_at) return { skipped: 'older', at: radar.at };
  // 這一格的雷達、測站、雨量站都收齊了就不再抓（測站約晚 12 分鐘才發，通常要第二輪才齊）
  if (last && last.radar_at === radar.at && last.obs_at === radar.at && last.rain_at === radar.at) return { skipped: 'complete', at: radar.at };
  const [obsSrc, rainSrc] = await Promise.allSettled([getDataset(WEATHER_IDS.obs, env, fetchImpl), getDataset(WEATHER_IDS.rain, env, fetchImpl)]);
  const obs = obsSrc.status === 'fulfilled' ? parseObs(obsSrc.value.text) : null;
  const rain = rainSrc.status === 'fulfilled' ? parseRain(rainSrc.value.text) : null;
  const sources = { radar: radarSrc.source, obs: obsSrc.value?.source || null, rain: rainSrc.value?.source || null };
  const body = await gzip(frameBody(radar, obs, rain, sources));
  await db.prepare(`INSERT INTO weather_frames (radar_at, obs_at, rain_at, sources, updated_ms, body) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(radar_at) DO UPDATE SET obs_at = excluded.obs_at, rain_at = excluded.rain_at, sources = excluded.sources, updated_ms = excluded.updated_ms, body = excluded.body`)
    .bind(radar.at, obs && obs.at, rain && rain.at, JSON.stringify(sources), now, body).run();
  return {
    at: radar.at, obsAt: obs && obs.at, rainAt: rain && rain.at, sources, gzBytes: body.byteLength,
    errors: [obsSrc, rainSrc].filter(x => x.status === 'rejected').map(x => String(x.reason && x.reason.message || x.reason)),
  };
}

// ── /api/weather ─────────────────────────────────────────────────────────────────────────────
// 不帶參數＝最新一筆；?at=<雷達時刻，例 2026-10-30T22:20:00+08:00>＝那一筆；?list=1&hours=N＝最近 N 小時有哪些筆（比對工具用）。
const AT_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:00\+08:00$/;
export async function weatherApi(request, env) {
  const url = new URL(request.url), db = env.DELAY_DB;
  const json = (body, status, cc) => new Response(body, { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cc } });
  try {
    if (url.searchParams.get('list') === '1') {
      const hours = Math.min(24 * 90, Math.max(1, Number(url.searchParams.get('hours')) || 24));
      const rows = (await db.prepare('SELECT radar_at, obs_at, rain_at, sources, updated_ms, length(body) AS gz FROM weather_frames WHERE updated_ms >= ? ORDER BY radar_at')
        .bind(Date.now() - hours * 3600e3).all()).results;
      return json(JSON.stringify({ frames: rows.map(r => ({ at: r.radar_at, obsAt: r.obs_at, rainAt: r.rain_at, sources: JSON.parse(r.sources), gzBytes: r.gz })) }), 200, 'public, s-maxage=60');
    }
    const at = url.searchParams.get('at');
    if (at != null && !AT_RE.test(at)) return json('{"error":"bad at"}', 400, 'no-store');
    const row = at
      ? await db.prepare('SELECT body FROM weather_frames WHERE radar_at = ?').bind(at).first()
      : await db.prepare('SELECT body FROM weather_frames ORDER BY radar_at DESC LIMIT 1').first();
    if (!row) return json('{"error":"no frame"}', 404, 'no-store');
    return json(await gunzip(row.body), 200, at ? 'public, s-maxage=300' : 'public, max-age=60, s-maxage=60');
  } catch (e) {
    console.error('[weather api] 失敗:', (e && e.stack) || String(e));
    return json('{"error":"unavailable"}', 503, 'no-store');
  }
}
