// FCM HTTP v1（Android 推播）：在 Worker 裡用服務帳號簽 JWT、換 OAuth access token，再一台一台送。
// 服務帳號沿用通行證寫 Firestore 那一組（wrangler.jsonc 的 FIRESTORE_PROJECT_ID、FIRESTORE_SERVICE_ACCOUNT_EMAIL
// 加 secret FIRESTORE_SERVICE_ACCOUNT_PRIVATE_KEY）：它是同一個 Firebase 專案的 Admin SDK 帳號，App 的推播 token 也發在這個專案。
// 只是 scope 換成 FCM，access token 另外快取，不動 worker.js 裡 Firestore 那一份。
//
// 錯誤怎麼分（FCM 的 errorCode）：
//   UNREGISTERED（404）            token 已失效（App 移除、token 換新）→ 呼叫端直接刪
//   INVALID_ARGUMENT、SENDER_ID_MISMATCH 可能是 token 壞了，也可能是這邊的設定或內容錯 → 呼叫端累計幾次才刪
//   401、403 PERMISSION_DENIED     access token 或服務帳號權限的問題 → 作廢快取，下一輪重換
//   其他（429、5xx、逾時）          算失敗，不動 token
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_BASE = 'https://fcm.googleapis.com/v1/projects/';
const REFRESH_SKEW_MS = 5 * 60e3;

let cached = null; // { issuer, token, expiresAtMs }

export function fcmConfigured(env) {
  return !!(env.FIRESTORE_PROJECT_ID && env.FIRESTORE_SERVICE_ACCOUNT_EMAIL && env.FIRESTORE_SERVICE_ACCOUNT_PRIVATE_KEY);
}

const b64u = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64uJson = o => b64u(new TextEncoder().encode(JSON.stringify(o)));

// secret 可能是真換行，也可能被密碼管理器帶成字面上的 \n（同 worker.js serviceAccountPrivateKeyBytes）。
function pkcs8(pem) {
  const m = String(pem).replace(/\\n/g, '\n').trim().match(/^-----BEGIN PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+)\s+-----END PRIVATE KEY-----$/);
  if (!m) throw new Error('fcm: private key must be PKCS8');
  return Uint8Array.from(atob(m[1].replace(/\s/g, '')), c => c.charCodeAt(0));
}

/** 回 { token, projectId }；同一個服務帳號的 access token 快取到過期前 5 分鐘。 */
export async function fcmAuth(env, fetchImpl = fetch, nowMs = Date.now()) {
  if (!fcmConfigured(env)) throw new Error('fcm: service account missing');
  const issuer = String(env.FIRESTORE_SERVICE_ACCOUNT_EMAIL), projectId = String(env.FIRESTORE_PROJECT_ID);
  if (cached && cached.issuer === issuer && nowMs < cached.expiresAtMs - REFRESH_SKEW_MS) return { token: cached.token, projectId };
  const iat = Math.floor(nowMs / 1000);
  const input = `${b64uJson({ alg: 'RS256', typ: 'JWT' })}.${b64uJson({ iss: issuer, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 })}`;
  const key = await crypto.subtle.importKey('pkcs8', pkcs8(env.FIRESTORE_SERVICE_ACCOUNT_PRIVATE_KEY), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input)));
  const r = await fetchImpl(TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${input}.${b64u(sig)}` }).toString(),
    signal: AbortSignal.timeout(10e3), redirect: 'manual', // 帶憑證的請求不跟轉址（worker.js 檔頭 C-1）
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || typeof d.access_token !== 'string' || !d.access_token) throw new Error(`fcm oauth ${r.status}`);
  const life = Number(d.expires_in) > 0 ? Number(d.expires_in) * 1000 : 3600e3;
  cached = { issuer, token: d.access_token, expiresAtMs: nowMs + life };
  return { token: d.access_token, projectId };
}

export function fcmReset() { cached = null; }

/** 送一則（message 是 FCM v1 的 message 物件，含 token）。回 { ok, status, code }，code 是 FCM 的 errorCode。 */
export async function fcmSend(auth, message, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(`${SEND_BASE}${encodeURIComponent(auth.projectId)}/messages:send`, {
      method: 'POST', headers: { authorization: 'Bearer ' + auth.token, 'content-type': 'application/json' },
      body: JSON.stringify({ message }), signal: AbortSignal.timeout(5000), redirect: 'manual',
    });
    if (r.ok) return { ok: true, status: r.status, code: null };
    let code = null;
    try {
      const e = (await r.json()).error || {};
      code = ((e.details || []).find(x => x && x.errorCode) || {}).errorCode || e.status || null;
    } catch (e) {}
    return { ok: false, status: r.status, code };
  } catch (e) { return { ok: false, status: 0, code: String((e && e.message) || e) }; }
}
