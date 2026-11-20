// AI 營運整理的推播（P2 iOS、P3 Android）：整理頁每出新的一版，就替改到的系統各寫一則推播草稿，送核可請求到管理者的手機；
// 管理者按「核可送出」之後才分批推給使用者。第一版每一則都要人核可，沒人處理就過期，不會自動發。
// 同時跑 AI 檢查（影子模式）：另一個模型拿官方原文核對草稿，結論寫進紀錄、附在核可請求上，不影響發送。
// schema：schema/0016_rail_push.sql。整理本身在 rail_ai_status.mjs。
//
// 推給誰由規則決定，模型只判斷這次變化屬於哪一類（category）：
//   全國 national  ＝台鐵、高鐵的停駛、區間封鎖（單線雙向行車、雙線不通、路線中斷）、重大事故、加開車、全面營運方案 → 全體
//   停駛 suspension＝其他系統整線或主要區段停駛 → 全體
//   一般 general   ＝其餘 → 開著該系統跟車／等車卡的人，加上這件事之前收過通知的人
//   恢復正常沿用這件事推過的範圍：之前推全體，恢復也推全體。關掉某個系統的人，三種等級都不推。
//
// Claude API 用 fetch 直接呼叫、不引 SDK（理由同 rail_ai_status.mjs 檔頭）。
// iOS 走 APNs、Android 走 FCM（fcm_core.mjs）；核可請求只送 iOS（管理者的手機是 iPhone，Android 不做核可按鈕）。
import { laJwt, laJwtReset } from './la_push_core.mjs';
import { fcmConfigured, fcmAuth, fcmReset, fcmSend } from './fcm_core.mjs';
import {
  RAIL_AI_SYSTEMS, labelOf, latestRevision, sourceBlocks, kvGet, kvPut, addSpend, monthKey, MONTHLY_CAP_USD, isNormal,
} from './rail_ai_status.mjs';

const SYSTEM_IDS = new Set(RAIL_AI_SYSTEMS.map(s => s.id));
const NATIONAL = new Set(['tra', 'thsr']);
const DRAFT_MODEL = 'claude-haiku-5-5';
const CHECK_MODEL = 'claude-opus-5-5';
// US$／百萬 tokens（10-06 價目）。AI 檢查開了伺服器端備援，被拒時可能改由 Opus 5／4.8 回答，所以也列進來。
const PRICES = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 }, 'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 }, 'claude-opus-4-8': { input: 5, output: 25 },
};
const PENDING_MAX_MS = 6 * 3600e3; // 核可請求放多久沒人處理就過期
const INCIDENT_MAX_MS = 7 * 86400e3; // 一件事這麼久沒有新推播，下一則當成新的一件事
const SEND_BATCH = 200; // 每分鐘最多送幾台：同一個 cron 還有跟車卡等推播迴圈，共用子請求額度
const SEND_PARALLEL = 20;
const SEND_LOCK_MS = 2 * 60e3;
const FAIL_MAX = 3; // 同一個 token 連續幾次 BadDeviceToken 就刪掉
const RECIPIENT_KEEP_MS = 30 * 86400e3;
const TOPICS = new Set(['tw.railisland.app', 'tw.railisland.app.nativedev']);
const TOKEN_RE = /^(?:[0-9a-f]{2}){32,100}$/;
const FCM_TOKEN_RE = /^[A-Za-z0-9_:-]{64,1024}$/; // FCM registration token（emulator 實測 142 字，長度沒有保證）
const NOTICE_URL = 'railisland://open/rail-status?sys=';
const LANGS = ['zh', 'en', 'ja'];
const APNS_PROD = 'api.push.apple.com', APNS_SANDBOX = 'api.sandbox.push.apple.com';
const TIER_LABEL = { national: '全國', suspension: '停駛', general: '一般' };
const CHECK_ITEMS = ['區間', '時刻', '車次', '是否舊方案', '該不該推', '推給誰'];

const twTime = ms => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).slice(0, 16);
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const clip = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

// ── 分級 ─────────────────────────────────────────────────────────────────────────────────
export function tierOf(sys, category, incident) {
  if (category === 'none') return null;
  // 恢復沿用這件事推過的範圍；這件事沒推過（沒人核可、被略過或已過 7 天）就不發「已恢復」：沒收過事故通知的人收到恢復通知只是雜訊，
  // AI 檢查也一律判「推給誰」不通過（10/25～11/16 這種草稿 13 則）。測試請求不受影響（draftOne 對測試另外補 general）。
  if (category === 'recovery') return incident ? incident.tier : null;
  if (NATIONAL.has(sys) && (category === 'suspension' || category === 'major')) return 'national';
  return category === 'suspension' ? 'suspension' : 'general';
}
const audienceOf = (tier, test) => test ? 'testers' : tier === 'general' ? 'affected' : 'all';

// 推播對象的 WHERE（裝置表別名 d）。全體與測試機都排除關掉這個系統的人。
function audienceWhere(req, now) {
  const notOff = 'NOT EXISTS (SELECT 1 FROM json_each(d.off) WHERE value = ?)';
  if (req.audience === 'testers') return [`d.tester = 1 AND ${notOff}`, [req.system]];
  if (req.audience === 'all') return [notOff, [req.system]];
  return [`${notOff} AND ((d.watching_until > ? AND EXISTS (SELECT 1 FROM json_each(d.watching) WHERE value = ?))
    OR EXISTS (SELECT 1 FROM rail_push_recipients r WHERE r.incident = ? AND r.token = d.token))`, [req.system, now, req.system, req.incident]];
}
async function audienceCount(db, req, now) {
  const [where, binds] = audienceWhere(req, now);
  return (await db.prepare(`SELECT COUNT(*) n FROM rail_push_devices d WHERE ${where}`).bind(...binds).first()).n;
}

// ── Claude ─────────────────────────────────────────────────────────────────────────────────
async function claudeJson(env, { model, effort, schema, system, user, maxTokens, fallback = false }, fetchImpl) {
  const headers = { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2026-10-21', 'content-type': 'application/json' };
  if (fallback) headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers,
    body: JSON.stringify({
      model, max_tokens: maxTokens, output_config: { effort, format: { type: 'json_schema', schema } },
      system, messages: [{ role: 'user', content: user }], ...(fallback ? { fallbacks: 'default' } : {}),
    }),
    signal: AbortSignal.timeout(150e3),
    redirect: 'manual', // 帶 key 的請求不跟轉址（worker.js 檔頭 C-1）
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d) throw Object.assign(new Error(`claude ${r.status}: ${JSON.stringify(d).slice(0, 300)}`), { cost: 0 });
  const u = d.usage || {}, p = PRICES[d.model] || PRICES[model];
  const cost = ((u.input_tokens || 0) * p.input + (u.output_tokens || 0) * p.output
    + (u.cache_creation_input_tokens || 0) * p.input * 1.25 + (u.cache_read_input_tokens || 0) * p.input * 0.1) / 1e6;
  if (d.stop_reason !== 'end_turn') throw Object.assign(new Error('claude stop_reason ' + d.stop_reason), { cost });
  try {
    return { out: JSON.parse((d.content || []).filter(b => b.type === 'text').map(b => b.text).join('')), cost, model: d.model };
  } catch (e) { throw Object.assign(new Error('claude output not JSON: ' + e.message), { cost }); }
}

const DRAFT_SYSTEM = `你替軌島 App 寫鐵道營運推播。輸入是同一個系統在整理頁上的上一版與這一版段落（都是依官方原文整理好的）。你要判斷這次變化屬於哪一類，並寫一則推播。

分類（category）：
- suspension：整條路線或主要區段停駛，包含已經公布、還沒生效的停駛方案。
- major：重大事故；路線、設備或電車線故障造成區間封鎖，例如單線雙向行車、雙線不通、路線中斷（只封一條正線、另一條還能走也算）；加開列車；颱風或地震的全面營運方案。但沒有整線或主要區段停駛。
- minor：班距調整、部分車次截短或取消、沒有區間封鎖的列車延誤、單站設施異常等局部調整。
- recovery：恢復正常營運，或停駛區段部分恢復。
- none：不值得推，例如措辭小修、只是重述上一版、跟乘客要不要出門或改搭無關。

寫法：
- 只用這一版寫明的內容，不推定、不補充。時刻、區間、車次照抄。
- 日期寫成月/日（例如 10/25），不寫「今天、明天、明日」：推播可能隔一陣子才被看到。
- title 20 字內，寫出系統與發生了什麼。body 80 字內，寫受影響的區間或車次與時刻，最後一句「點開看各線狀況。」
- 中文用台灣用語；英文、日文版內容與中文一致。
- reason 用一句話說明為什麼是這一類。
- category 是 none 時 title、body 照樣寫，只是不會送出。`;

const DRAFT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['category', 'title', 'titleEn', 'titleJa', 'body', 'bodyEn', 'bodyJa', 'reason'],
  properties: {
    category: { type: 'string', enum: ['suspension', 'major', 'minor', 'recovery', 'none'] },
    title: { type: 'string' }, titleEn: { type: 'string' }, titleJa: { type: 'string' },
    body: { type: 'string' }, bodyEn: { type: 'string' }, bodyJa: { type: 'string' },
    reason: { type: 'string' },
  },
};

const CHECK_SYSTEM = `你負責在軌島 App 送出營運推播之前做查核。下面有官方原文、整理頁這一段的上一版與現況、推播草稿，以及系統依規則算出的等級與推播對象。逐項核對草稿：

- 區間：草稿寫的路線、區段、站名跟官方原文一致。
- 時刻：生效、恢復、首末班等時刻跟原文一致，沒有把「預計」寫成確定。
- 車次：草稿提到的車次都在原文裡。
- 是否舊方案：草稿寫的是目前有效的方案，不是已經被新公告取代的。
- 該不該推：這次變化會改變乘客的行動（措辭小修、重述上一版不該推）。
- 推給誰：依下面的規則，這則的等級與對象合理。

等級規則：台鐵、高鐵的停駛、區間封鎖（單線雙向行車、雙線不通、路線中斷，只封一條正線也算）、重大事故、加開車、全面營運方案推全體；其他系統整線或主要區段停駛推全體；其餘（例如沒有區間封鎖的列車延誤、班距調整）只推受影響的人；恢復正常沿用這件事之前推過的範圍。

原文沒寫到的事，草稿也沒寫，算通過。任何一項不通過，verdict 就是 fail。每一項的 note 寫一句理由；summary 寫給核可者看的一句結論，30 字內。`;

const CHECK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['verdict', 'items', 'summary'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    items: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['item', 'ok', 'note'],
      properties: { item: { type: 'string', enum: CHECK_ITEMS }, ok: { type: 'boolean' }, note: { type: 'string' } },
    } },
    summary: { type: 'string' },
  },
};

const entryView = e => e ? JSON.stringify({ status: e.status, detail: e.detail, impacts: e.impacts, updatedAt: twTime(e.updatedAt) }, null, 1) : '（之前沒有這個系統的段落）';
const audienceText = (req, estimate) => req.audience === 'testers' ? `只推測試機（${estimate} 台）`
  : req.audience === 'all' ? `推全體，關掉${labelOf(req.system)}的人除外（${estimate} 台）`
  : `推開著${labelOf(req.system)}卡片或收過這件事通知的人（${estimate} 台）`;

// ── 草稿、檢查、核可請求 ───────────────────────────────────────────────────────────────────
async function draftOne(env, db, { sys, prev, cur, revisionId, now, test }, fetchImpl) {
  let cost = 0;
  const row = { created_ms: now, system: sys, revision_id: revisionId, test: test ? 1 : 0 };
  const insert = async (fields) => {
    const r = { ...row, ...fields };
    const cols = Object.keys(r);
    const ins = await db.prepare(`INSERT INTO rail_push_requests (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING id`)
      .bind(...cols.map(c => r[c] === undefined ? null : r[c])).first();
    await addSpend(db, cost, now).run();
    return ins.id;
  };
  if (!cur) return { sys, id: await insert({ status: 'error', error: '最新一版沒有這個系統' }) };

  let draft;
  try {
    const r = await claudeJson(env, {
      model: DRAFT_MODEL, effort: 'low', schema: DRAFT_SCHEMA, system: DRAFT_SYSTEM, maxTokens: 4000,
      user: `現在時間：${twTime(now)}（台灣時間）\n系統：${sys}（${labelOf(sys)}）\n\n<previous>\n${entryView(prev)}\n</previous>\n\n<current>\n${entryView(cur)}\n</current>`,
    }, fetchImpl);
    cost += r.cost; draft = r.out;
  } catch (e) {
    cost += e.cost || 0;
    return { sys, id: await insert({ status: 'error', error: clip(e.message, 300), cost_usd: cost }) };
  }
  // 整理頁這一段已經是「正常」，任何值得推的變化都當恢復（模型偶爾會把恢復分成 minor）
  const category = draft.category !== 'none' && isNormal(cur) ? 'recovery' : draft.category;
  const incidentRow = await kvGet(db, 'push-incident:' + sys);
  const incident = incidentRow && now - incidentRow.at < INCIDENT_MAX_MS ? incidentRow : null;
  const tier = tierOf(sys, category, incident) || (test ? 'general' : null);
  const title = { zh: clip(draft.title, 40), en: clip(draft.titleEn, 80), ja: clip(draft.titleJa, 40) };
  const body = { zh: clip(draft.body, 160), en: clip(draft.bodyEn, 300), ja: clip(draft.bodyJa, 160) };
  const base = { category, title: JSON.stringify(title), body: JSON.stringify(body), reason: clip(draft.reason, 200) };
  if (!tier) return { sys, id: await insert({ ...base, status: 'dropped', cost_usd: cost }) };

  const req = { system: sys, tier, audience: audienceOf(tier, test), incident: incident ? incident.id : `${sys}-${now}` };
  const estimate = await audienceCount(db, req, now);

  let check;
  try {
    const src = await sourceBlocks(db, sys, now);
    const r = await claudeJson(env, {
      model: CHECK_MODEL, effort: 'medium', schema: CHECK_SCHEMA, system: CHECK_SYSTEM, maxTokens: 16000, fallback: true,
      user: `現在時間：${twTime(now)}（台灣時間）\n系統：${sys}（${labelOf(sys)}）\n\n官方原文（已去掉 HTML，可能含網站選單雜訊）：\n${src.blocks.join('\n') || '（目前沒有可讀的官方原文）'}\n\n`
        + `<previous_entry>\n${entryView(prev)}\n</previous_entry>\n\n<current_entry>\n${entryView(cur)}\n</current_entry>\n\n`
        + `<draft>\n${JSON.stringify({ category, title: title.zh, body: body.zh }, null, 1)}\n</draft>\n\n`
        + `等級：${TIER_LABEL[tier]}（${{ national: '全國事件，推全體', suspension: '停駛，推全體', general: '一般，只推受影響的人' }[tier]}）\n`
        + `這件事之前推過的範圍：${incident ? TIER_LABEL[incident.tier] : '沒有'}`,
    }, fetchImpl);
    cost += r.cost;
    check = { verdict: r.out.verdict, summary: clip(r.out.summary, 60), items: r.out.items, model: r.model };
  } catch (e) {
    cost += e.cost || 0;
    check = { verdict: 'error', summary: clip(e.message, 60) };
  }

  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  await db.prepare(`UPDATE rail_push_requests SET status = 'superseded' WHERE system = ? AND status = 'pending' AND test = ?`).bind(sys, row.test).run();
  const id = await insert({
    ...base, ...req, status: 'pending', nonce_hash: await sha256(nonce), estimate,
    check_verdict: check.verdict, check_detail: JSON.stringify(check), cost_usd: cost,
  });
  const admins = await sendApproval(env, db, { id, ...req, test, title, body, category, reason: base.reason, check, estimate, nonce }, fetchImpl);
  await db.prepare('UPDATE rail_push_requests SET admin_sent = ? WHERE id = ?').bind(admins, id).run();
  return { sys, id, tier, estimate, check: check.verdict, admins };
}

export function approvalPayload(r) {
  const checkText = { pass: '通過', fail: '不通過', error: '沒跑完' }[r.check.verdict] || r.check.verdict;
  // 恢復沿用這件事推過的範圍；直接寫「停駛」會讓核可者以為又停了
  const tierLabel = r.category === 'recovery' ? `恢復（沿用${TIER_LABEL[r.tier]}範圍）` : TIER_LABEL[r.tier];
  const payload = {
    aps: {
      alert: {
        title: `${r.test ? '［測試］' : ''}待核可｜${r.title.zh}`,
        subtitle: `${tierLabel}・${audienceText(r, r.estimate)}`,
        body: `${r.body.zh}\nAI 檢查：${checkText}（${r.check.summary}）`,
      },
      sound: 'default', category: 'RAIL_PUSH_APPROVAL', 'thread-id': 'rail-push-approval',
    },
    rp: {
      kind: 'approval', id: r.id, nonce: r.nonce, sys: r.system, tier: r.tier, tierLabel,
      audience: audienceText(r, r.estimate), title: r.title.zh, body: r.body.zh, reason: r.reason,
      check: { verdict: r.check.verdict, summary: r.check.summary }, test: !!r.test,
    },
  };
  // APNs 上限 4 KB；理由與檢查結論太長就先砍（標題、短訊與兩個按鈕要用到的欄位不動）
  if (new TextEncoder().encode(JSON.stringify(payload)).length > 3800) { payload.rp.reason = clip(payload.rp.reason, 40); payload.rp.check.summary = clip(payload.rp.check.summary, 30); }
  return payload;
}

export function noticePayload(req, lang) {
  const title = JSON.parse(req.title), body = JSON.parse(req.body);
  return {
    aps: { alert: { title: title[lang] || title.zh, body: body[lang] || body.zh }, sound: 'default', 'thread-id': 'rail-status-' + req.system },
    rp: { kind: 'notice', id: req.id, sys: req.system },
    url: NOTICE_URL + req.system,
  };
}

// Android：data-only 訊息，App 自己畫通知（頻道、點開去哪、關掉的系統再擋一次），App 在背景也會叫到收訊服務。
// FCM 的 data 值只能是字串。collapse_key、ttl 對齊 iOS 的 apns-collapse-id 與 3 小時效期。
export function fcmNoticeMessage(req, lang, token) {
  const title = JSON.parse(req.title), body = JSON.parse(req.body);
  return {
    token,
    data: { kind: 'notice', id: String(req.id), sys: req.system, title: title[lang] || title.zh, body: body[lang] || body.zh, url: NOTICE_URL + req.system },
    android: { priority: 'HIGH', ttl: '10800s', collapse_key: 'rs-' + req.system },
  };
}

async function sendApproval(env, db, r, fetchImpl) {
  if (!env.APNS_KEY_P8) return 0;
  const admins = (await db.prepare(`SELECT token, topic, apns_env FROM rail_push_devices WHERE admin = 1 AND platform = 'ios'`).all()).results;
  if (!admins.length) return 0;
  const jwt = await laJwt(env);
  const payload = approvalPayload(r);
  let ok = 0;
  for (const d of admins) {
    const res = await apnsSend(env, jwt, d, payload, { collapseId: `rp-${r.test ? 'test' : 'approval'}-${r.system}`, ttlSec: PENDING_MAX_MS / 1000 }, fetchImpl);
    if (res.ok) { ok++; if (!d.apns_env) await db.prepare('UPDATE rail_push_devices SET apns_env = ? WHERE token = ?').bind(res.env, d.token).run(); }
    else console.error(`[cron rail-push] 核可請求送不出去: status=${res.status} reason=${res.reason || '(無)'} token=${d.token.slice(0, 8)}…`);
  }
  return ok;
}

// ── APNs ─────────────────────────────────────────────────────────────────────────────────
// 環境未知的 token 兩邊都試（sandbox 的 token 送到正式環境回 400 BadDeviceToken），送成功就記下環境。
async function apnsSend(env, jwt, row, payload, { collapseId, ttlSec }, fetchImpl) {
  const first = row.apns_env === 'sandbox' ? APNS_SANDBOX : row.apns_env === 'prod' ? APNS_PROD : (String(env.APNS_HOST || '').trim() || APNS_PROD);
  const hosts = row.apns_env ? [first] : [first, first === APNS_SANDBOX ? APNS_PROD : APNS_SANDBOX];
  let last = null;
  for (const host of hosts) {
    try {
      const r = await fetchImpl(`https://${host}/3/device/${row.token}`, {
        method: 'POST',
        headers: {
          authorization: 'bearer ' + jwt, 'apns-topic': row.topic, 'apns-push-type': 'alert', 'apns-priority': '10',
          'apns-expiration': String(Math.floor(Date.now() / 1000) + ttlSec), ...(collapseId ? { 'apns-collapse-id': collapseId } : {}),
        },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(5000), redirect: 'manual',
      });
      let reason = null;
      if (!r.ok) { try { reason = (await r.json()).reason || null; } catch (e) {} }
      last = { ok: r.ok, status: r.status, reason, env: host === APNS_SANDBOX ? 'sandbox' : 'prod' };
      if (r.ok || !(r.status === 400 && reason === 'BadDeviceToken')) return last;
    } catch (e) { return { ok: false, status: 0, reason: String((e && e.message) || e), env: null }; }
  }
  return last;
}

// 核可過的推播：每分鐘送一批，記游標（token 字典序），送完標 sent。
async function sendApproved(env, db, now, fetchImpl) {
  const req = await db.prepare(`SELECT * FROM rail_push_requests WHERE status = 'approved' ORDER BY decided_ms, id LIMIT 1`).first();
  if (!req) return null;
  if (!env.APNS_KEY_P8 && !fcmConfigured(env)) return { skipped: 'no push keys' };
  const got = await db.prepare(`INSERT INTO rail_ai_kv (k, v, updated_ms) VALUES ('push_send_lock', ?, ?)
    ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_ms = excluded.updated_ms WHERE CAST(rail_ai_kv.v AS INTEGER) < ?`)
    .bind(String(now + SEND_LOCK_MS), now, now).run();
  if (!got.meta || got.meta.changes !== 1) return { skipped: 'locked by another run' };
  try {
    // 第一批：記下這件事推到哪個範圍（恢復正常時沿用）。測試請求不算一件事。
    if (!req.cursor && !req.test && req.category !== 'recovery') {
      const inc = await kvGet(db, 'push-incident:' + req.system);
      const wider = inc && inc.id === req.incident && inc.tier !== 'general' ? inc.tier : req.tier;
      await kvPut(db, 'push-incident:' + req.system, { id: req.incident, tier: wider, at: now }, now).run();
    }
    const [where, binds] = audienceWhere(req, now);
    const rows = (await db.prepare(`SELECT d.token, d.platform, d.topic, d.apns_env, d.lang, d.fail_streak FROM rail_push_devices d
      WHERE d.token > ? AND ${where} ORDER BY d.token LIMIT ?`).bind(req.cursor || '', ...binds, SEND_BATCH).all()).results;
    const android = d => d.platform === 'android';
    const jwt = env.APNS_KEY_P8 && rows.some(d => !android(d)) ? await laJwt(env) : null;
    let fcm = null;
    if (fcmConfigured(env) && rows.some(android)) {
      try { fcm = await fcmAuth(env, fetchImpl); } catch (e) { console.error('[cron rail-push] FCM access token 拿不到:', String((e && e.message) || e)); }
    }
    const writes = [];
    let sent = 0, failed = 0, reset403 = false, resetFcm = false;
    const drop = d => writes.push(db.prepare('DELETE FROM rail_push_devices WHERE token = ?').bind(d.token));
    const strike = d => writes.push(d.fail_streak + 1 >= FAIL_MAX ? db.prepare('DELETE FROM rail_push_devices WHERE token = ?').bind(d.token)
      : db.prepare('UPDATE rail_push_devices SET fail_streak = fail_streak + 1 WHERE token = ?').bind(d.token));
    const delivered = (d, update) => {
      sent++;
      writes.push(update);
      if (req.tier === 'general' && !req.test) writes.push(db.prepare('INSERT OR IGNORE INTO rail_push_recipients (incident, token, at_ms) VALUES (?, ?, ?)').bind(req.incident, d.token, now));
    };
    for (let i = 0; i < rows.length; i += SEND_PARALLEL) {
      await Promise.all(rows.slice(i, i + SEND_PARALLEL).map(async d => {
        const lang = LANGS.includes(d.lang) ? d.lang : 'zh';
        if (android(d)) {
          if (!fcm) { failed++; return; }
          const r = await fcmSend(fcm, fcmNoticeMessage(req, lang, d.token), fetchImpl);
          if (r.ok) return delivered(d, db.prepare('UPDATE rail_push_devices SET fail_streak = 0 WHERE token = ?').bind(d.token));
          failed++;
          if (r.code === 'UNREGISTERED') drop(d);
          else if (r.code === 'INVALID_ARGUMENT' || r.code === 'SENDER_ID_MISMATCH') strike(d);
          else if (r.status === 401 || r.status === 403) resetFcm = true;
          return;
        }
        if (!jwt) { failed++; return; }
        const r = await apnsSend(env, jwt, d, noticePayload(req, lang), { collapseId: 'rs-' + req.system, ttlSec: 3 * 3600 }, fetchImpl);
        if (r.ok) return delivered(d, db.prepare('UPDATE rail_push_devices SET apns_env = ?, fail_streak = 0 WHERE token = ?').bind(r.env, d.token));
        failed++;
        if (r.status === 410) drop(d);
        else if (r.status === 400 && (r.reason === 'BadDeviceToken' || r.reason === 'DeviceTokenNotForTopic')) strike(d);
        else if (r.status === 403) reset403 = true;
      }));
    }
    if (reset403) laJwtReset();
    if (resetFcm) fcmReset();
    const done = rows.length < SEND_BATCH;
    writes.push(db.prepare(`UPDATE rail_push_requests SET cursor = ?, sent = sent + ?, failed = failed + ?, status = ?, done_ms = ? WHERE id = ?`)
      .bind(rows.length ? rows[rows.length - 1].token : req.cursor, sent, failed, done ? 'sent' : 'approved', done ? now : null, req.id));
    if (done && req.category === 'recovery' && !req.test) writes.push(db.prepare('DELETE FROM rail_ai_kv WHERE k = ?').bind('push-incident:' + req.system));
    await db.batch(writes);
    return { id: req.id, sent, failed, done };
  } finally {
    await db.prepare(`UPDATE rail_ai_kv SET v = '0', updated_ms = ? WHERE k = 'push_send_lock'`).bind(Date.now()).run();
  }
}

// ── 排程入口（worker.js 每分鐘 cron，在 AI 整理之後）────────────────────────────────────────
// 新的一版：把 push:last_rev 從舊值推進到最新一版的那一輪才寫草稿（比較後寫入，兩輪重疊時只有一輪會成功）。
// 第一次上線只記基準，不替上線前就有的段落發推播。
async function draftChanged(env, db, now, fetchImpl) {
  const latest = await latestRevision(db);
  if (!latest) return null;
  const last = await kvGet(db, 'push:last_rev');
  if (last == null) { await kvPut(db, 'push:last_rev', latest.id, now).run(); return { baseline: latest.id }; }
  if (latest.id <= last) return null;
  const claim = await db.prepare(`UPDATE rail_ai_kv SET v = ?, updated_ms = ? WHERE k = 'push:last_rev' AND v = ?`)
    .bind(JSON.stringify(latest.id), now, JSON.stringify(last)).run();
  if (!claim.meta || claim.meta.changes !== 1) return { skipped: 'claimed by another run' };
  const prevRow = await db.prepare('SELECT systems FROM rail_ai_revisions WHERE id = ?').bind(last).first();
  const prevSystems = prevRow ? JSON.parse(prevRow.systems) : {};
  const changed = new Set();
  for (const r of (await db.prepare('SELECT changed FROM rail_ai_revisions WHERE id > ? AND id <= ?').bind(last, latest.id).all()).results)
    for (const s of JSON.parse(r.changed)) if (SYSTEM_IDS.has(s)) changed.add(s);
  if (((await kvGet(db, monthKey(now))) || 0) >= MONTHLY_CAP_USD) {
    for (const sys of changed) await db.prepare(`INSERT INTO rail_push_requests (created_ms, system, revision_id, status, error) VALUES (?, ?, ?, 'error', ?)`)
      .bind(now, sys, latest.id, `monthly cap US$${MONTHLY_CAP_USD} reached`).run();
    return { skipped: 'monthly cap' };
  }
  return Promise.all([...changed].map(sys => draftOne(env, db, { sys, prev: prevSystems[sys] || null, cur: latest.systems[sys], revisionId: latest.id, now, test: false }, fetchImpl)));
}

// 測試請求：在 rail_ai_kv 寫一列 push-test:<系統>，下一分鐘就拿那個系統最新一段跑一次完整流程，只推測試機。
async function runTests(env, db, now, fetchImpl) {
  const keys = (await db.prepare(`SELECT k FROM rail_ai_kv WHERE k LIKE 'push-test:%'`).all()).results.map(r => r.k);
  if (!keys.length) return null;
  const latest = await latestRevision(db);
  const out = [];
  for (const k of keys) {
    const del = await db.prepare('DELETE FROM rail_ai_kv WHERE k = ?').bind(k).run();
    if (!del.meta || del.meta.changes !== 1) continue;
    const sys = k.slice('push-test:'.length);
    if (!SYSTEM_IDS.has(sys)) continue;
    out.push(await draftOne(env, db, { sys, prev: null, cur: latest && latest.systems[sys], revisionId: latest && latest.id, now, test: true }, fetchImpl));
  }
  return out;
}

export async function railPushScheduled(event, env, { fetch: fetchImpl = fetch } = {}) {
  const db = env.DELAY_DB;
  const now = event && event.scheduledTime ? event.scheduledTime : Date.now();
  await db.prepare(`UPDATE rail_push_requests SET status = 'expired' WHERE status = 'pending' AND created_ms < ?`).bind(now - PENDING_MAX_MS).run();
  const send = await sendApproved(env, db, now, fetchImpl);
  const key = !!env.ANTHROPIC_API_KEY;
  const tests = key ? await runTests(env, db, now, fetchImpl) : null;
  const drafts = key ? await draftChanged(env, db, now, fetchImpl) : null;
  if (new Date(now + 8 * 3600e3).toISOString().slice(11, 16) === '03:04')
    await db.prepare('DELETE FROM rail_push_recipients WHERE at_ms < ?').bind(now - RECIPIENT_KEEP_MS).run();
  return { send, tests, drafts };
}

// ── 端點（worker.js 先做方法與限流檢查）──────────────────────────────────────────────────────
// 註冊不驗身分：token 只驗格式，假的 token 送幾次 BadDeviceToken（Android：INVALID_ARGUMENT／UNREGISTERED）就會被刪（同跟車卡的做法）。
// topic 是 App 的 bundle id／Android 套件名，兩平台同名。
// admin、tester、apns_env 不在這裡改：前兩個只能用 SQL 手動設定，環境是送成功才記。
export async function railPushRegister(request, env, now = Date.now()) {
  let b;
  try { b = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
  const sysList = v => Array.isArray(v) && v.length <= 20 ? [...new Set(v.filter(x => SYSTEM_IDS.has(x)))] : null;
  const token = String((b && b.token) || ''), off = sysList(b && b.off), watching = sysList((b && b.watching) || []);
  const tokenOk = b.platform === 'ios' ? TOKEN_RE.test(token) : b.platform === 'android' ? FCM_TOKEN_RE.test(token) : false;
  if (!tokenOk || !TOPICS.has(b.topic) || !off || !watching) return json({ error: 'bad_device' }, 400);
  const lang = LANGS.includes(b.lang) ? b.lang : 'zh';
  const until = watching.length ? Math.min(Number(b.watchingUntil) || 0, now + 24 * 3600e3) : 0;
  try {
    await env.DELAY_DB.prepare(`INSERT INTO rail_push_devices (token, platform, topic, lang, off, watching, watching_until, created_ms, updated_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(token) DO UPDATE SET platform = excluded.platform, topic = excluded.topic, lang = excluded.lang,
      off = excluded.off, watching = excluded.watching, watching_until = excluded.watching_until, updated_ms = excluded.updated_ms, fail_streak = 0`)
      .bind(token, b.platform, b.topic, lang, JSON.stringify(off), JSON.stringify(watching), until, now, now).run();
  } catch (e) { return json({ error: 'register_failed' }, 503); }
  return json({ ok: true });
}

// 冪等：不存在也回 200（同 laUnbind）。
export async function railPushUnregister(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return json({ ok: true }); }
  const t = String((b && b.token) || '');
  if (TOKEN_RE.test(t) || FCM_TOKEN_RE.test(t)) {
    try { await env.DELAY_DB.prepare('DELETE FROM rail_push_devices WHERE token = ?').bind(t).run(); } catch (e) {}
  }
  return json({ ok: true });
}

// 核可／略過。憑證是這則請求的一次性隨機碼：只出現在送給管理者裝置的推播裡，伺服器只存雜湊。
// 已經決定過的請求回 409 並附目前狀態，App 重送「核可」時看到 approved／sent 就當成功。
export async function railPushDecide(request, env, now = Date.now()) {
  let b;
  try { b = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
  const id = Number(b && b.id), nonce = String((b && b.nonce) || ''), decision = b && b.decision;
  if (!Number.isInteger(id) || !/^[0-9a-f]{32}$/.test(nonce) || !['approve', 'skip'].includes(decision)) return json({ error: 'bad_request' }, 400);
  const hash = await sha256(nonce);
  const db = env.DELAY_DB;
  try {
    const status = decision === 'approve' ? 'approved' : 'skipped';
    const r = await db.prepare(`UPDATE rail_push_requests SET status = ?, decided_ms = ? WHERE id = ? AND nonce_hash = ? AND status = 'pending'`)
      .bind(status, now, id, hash).run();
    if (r.meta && r.meta.changes === 1) return json({ ok: true, status });
    const row = await db.prepare('SELECT status, nonce_hash FROM rail_push_requests WHERE id = ?').bind(id).first();
    if (!row || row.nonce_hash !== hash) return json({ error: 'forbidden' }, 403);
    return json({ error: 'not_pending', status: row.status }, 409);
  } catch (e) { return json({ error: 'decide_failed' }, 503); }
}
