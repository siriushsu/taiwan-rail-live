// 台鐵即時列車動態代理（TDX v3 TrainLiveBoard）
// 金鑰只存在環境變數（Vercel 專案設定），前端一律打這支、不直連 TDX。
// CDN 快取 55 秒：全站訪客共用同一份回應，TDX 端用量恆定約每分鐘 1 次。
const AUTH_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const API_URL = 'https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/TrainLiveBoard?%24format=JSON';

let tok = null, tokExp = 0;
async function getToken() {
  if (tok && Date.now() < tokExp - 60e3) return tok;
  const r = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.TDX_CLIENT_ID,
      client_secret: process.env.TDX_CLIENT_SECRET,
    }),
  });
  if (!r.ok) throw new Error('tdx auth ' + r.status);
  const d = await r.json();
  tok = d.access_token;
  tokExp = Date.now() + (d.expires_in || 86400) * 1000;
  return tok;
}

let cache = null, cacheAt = 0;
export default async function handler(req, res) {
  try {
    if (!cache || Date.now() - cacheAt > 55e3) {
      const r = await fetch(API_URL, { headers: { authorization: 'Bearer ' + await getToken() } });
      if (r.status === 401) { tok = null; throw new Error('tdx 401'); }
      if (!r.ok) throw new Error('tdx api ' + r.status);
      const d = await r.json();
      const list = Array.isArray(d) ? d : d.TrainLiveBoards || [];
      cache = {
        at: d.UpdateTime || new Date().toISOString(),
        trains: list.map(t => ({ no: t.TrainNo, delay: t.DelayTime || 0, sta: t.StationID, status: t.TrainStationStatus })),
      };
      cacheAt = Date.now();
    }
    res.setHeader('cache-control', 'public, s-maxage=55, stale-while-revalidate=300');
    res.status(200).json(cache);
  } catch (e) {
    if (cache) {
      res.setHeader('cache-control', 'public, s-maxage=15');
      return res.status(200).json(cache);
    }
    res.status(502).json({ error: String(e.message || e) });
  }
}
