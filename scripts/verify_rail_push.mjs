#!/usr/bin/env node
// AI 營運整理推播（scripts/rail_push.mjs）的離線驗收：真 SQL（d1_local＋schema/*.sql）、假 Claude、假 APNs、假 Google OAuth＋FCM。
// 不連網、不花錢、不推任何東西。用法：node scripts/verify_rail_push.mjs
import { generateKeyPairSync, verify as cryptoVerify } from 'node:crypto';
import { openTestDb } from './d1_local.mjs';
import { railPushScheduled, railPushRegister, railPushUnregister, railPushDecide, tierOf, approvalPayload, fcmNoticeMessage } from './rail_push.mjs';

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };

const { db, DELAY_DB } = openTestDb();
const env = {
  DELAY_DB, ANTHROPIC_API_KEY: 'test-key', APNS_KEY_ID: 'KEYID', APNS_TEAM_ID: 'TEAMID',
  APNS_KEY_P8: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }),
};
const T0 = Date.parse('2026-10-23T17:00:00+08:00');
const MIN = 60e3;

// ── 假世界 ─────────────────────────────────────────────────────────────────────────────────
// apns[token]＝這個 token 屬於哪個環境：'prod'／'sandbox'／'gone'（410）／'bad'（兩邊都 BadDeviceToken）
// fcm[token]＝'gone'（UNREGISTERED）／'bad'（INVALID_ARGUMENT）／'down'（503）／'auth'（401），沒寫＝成功
const world = { draft: null, check: null, claudeCalls: [], apns: {}, pushes: [], fcm: {}, fcmSends: [], oauth: [] };
const fcmKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const fcmErr = (status, code) => new Response(JSON.stringify({ error: { code: status, status: code === 'UNREGISTERED' ? 'NOT_FOUND' : code,
  details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: code }] } }), { status });
const reply = (model, out, usage = { input_tokens: 2000, output_tokens: 300 }) => new Response(JSON.stringify({
  model, stop_reason: 'end_turn', usage, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(out) }],
}), { status: 200 });
async function fakeFetch(url, init = {}) {
  url = String(url);
  if (url === 'https://api.anthropic.com/v1/messages') {
    const body = JSON.parse(init.body);
    world.claudeCalls.push({ body, headers: init.headers });
    const fn = body.model === 'claude-haiku-5-5' ? world.draft : world.check;
    return fn(body);
  }
  if (url === 'https://oauth2.googleapis.com/token') {
    const form = new URLSearchParams(init.body), jwt = form.get('assertion').split('.');
    const claims = JSON.parse(Buffer.from(jwt[1], 'base64url'));
    const sigOk = cryptoVerify('RSA-SHA256', Buffer.from(`${jwt[0]}.${jwt[1]}`), fcmKeys.publicKey, Buffer.from(jwt[2], 'base64url'));
    world.oauth.push({ grant: form.get('grant_type'), header: JSON.parse(Buffer.from(jwt[0], 'base64url')), claims, sigOk, redirect: init.redirect });
    return new Response(JSON.stringify({ access_token: 'ya29.test-' + world.oauth.length, expires_in: 3599, token_type: 'Bearer' }), { status: 200 });
  }
  if (url.startsWith('https://fcm.googleapis.com/')) {
    const message = JSON.parse(init.body).message;
    world.fcmSends.push({ url, headers: init.headers, message });
    const kind = world.fcm[message.token];
    if (kind === 'gone') return fcmErr(404, 'UNREGISTERED');
    if (kind === 'bad') return fcmErr(400, 'INVALID_ARGUMENT');
    if (kind === 'down') return fcmErr(503, 'UNAVAILABLE');
    if (kind === 'auth') return new Response(JSON.stringify({ error: { code: 401, status: 'UNAUTHENTICATED' } }), { status: 401 });
    return new Response(JSON.stringify({ name: 'projects/railisland-test/messages/1' }), { status: 200 });
  }
  // token 不限 hex：Android 的 FCM token 被誤送到 APNs 時也要記到
  const m = url.match(/^https:\/\/(api(?:\.sandbox)?\.push\.apple\.com)\/3\/device\/([^/]+)$/);
  if (m) {
    const host = m[1], token = m[2], kind = world.apns[token] || 'prod';
    world.pushes.push({ host, token, headers: init.headers, payload: JSON.parse(init.body) });
    if (kind === 'gone') return new Response(JSON.stringify({ reason: 'Unregistered' }), { status: 410 });
    if (kind === 'bad' || (kind === 'sandbox') !== (host === 'api.sandbox.push.apple.com')) return new Response(JSON.stringify({ reason: 'BadDeviceToken' }), { status: 400 });
    return new Response(null, { status: 200 });
  }
  return new Response('not found', { status: 404 });
}
const draftOut = (category, title = '北捷文湖線 18:00 起停駛', extra = {}) => ({
  category, title, titleEn: 'EN ' + title, titleJa: 'JA ' + title, body: '文湖線及高架路段 18:00 起暫停營運，地下段照常。點開看各線狀況。',
  bodyEn: 'Wenhu line suspended from 18:00.', bodyJa: '文湖線は18時から運休。', reason: '整線停駛', ...extra,
});
const checkOut = (verdict = 'pass') => ({
  verdict, summary: verdict === 'pass' ? '區間與時刻和 17:10 速報一致' : '時刻與原文不符',
  items: ['區間', '時刻', '車次', '是否舊方案', '該不該推', '推給誰'].map(item => ({ item, ok: verdict === 'pass' || item !== '時刻', note: 'ok' })),
});

// ── 資料工具 ─────────────────────────────────────────────────────────────────────────────────
const entry = (state, status = state, at = T0) => ({ id: 'x', status, detail: status, impacts: state === '正常' ? [] : [{ scope: '全線', state, from: '', until: '', trains: [] }], updatedAt: at, sourceUrls: [] });
let systems = { trtc: entry('正常'), tra: entry('正常'), tymc: entry('正常'), thsr: entry('正常') };
function revise(now, changes) {
  systems = { ...systems, ...changes };
  db.prepare('INSERT INTO rail_ai_revisions (at_ms, changed, systems, cost_usd, meta) VALUES (?, ?, ?, 0, NULL)')
    .run(now, JSON.stringify(Object.keys(changes)), JSON.stringify(systems));
}
const post = (fn, body, now) => fn(new Request('https://railisland.tw/x', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), env, now);
const tok = c => c.repeat(64);
const reg = (t, extra = {}, now = T0) => post(railPushRegister, { token: t, platform: 'ios', topic: 'tw.railisland.app.nativedev', lang: 'zh', off: [], ...extra }, now);
const tick = now => railPushScheduled({ scheduledTime: now }, env, { fetch: fakeFetch });
const lastReq = () => db.prepare('SELECT * FROM rail_push_requests ORDER BY id DESC LIMIT 1').get();
const devRow = t => db.prepare('SELECT * FROM rail_push_devices WHERE token = ?').get(t);
const pushesTo = t => world.pushes.filter(p => p.token === t);
const approvalOf = id => world.pushes.find(p => p.payload.rp && p.payload.rp.kind === 'approval' && p.payload.rp.id === id);

// ── 1. 註冊 ────────────────────────────────────────────────────────────────────────────────
const A = tok('a'), B = tok('b'), C = tok('c'), D = tok('d'), E = tok('e'), F = tok('f');
let r = await reg(A);
check('註冊：合法 token 回 200 並存起來', r.status === 200 && devRow(A).topic === 'tw.railisland.app.nativedev' && devRow(A).off === '[]');
check('註冊：token 不是 hex／長度不對回 400', (await reg('xyz')).status === 400 && (await reg('ab'.repeat(10))).status === 400);
check('註冊：不認得的 bundle id 回 400', (await post(railPushRegister, { token: B, platform: 'ios', topic: 'com.evil.app', off: [] }, T0)).status === 400 && !devRow(B));
check('註冊：壞掉的 JSON 回 400', (await post(railPushRegister, '{', T0)).status === 400);
db.prepare('UPDATE rail_push_devices SET admin = 1, tester = 1, apns_env = ? WHERE token = ?').run('prod', A);
await reg(A, { lang: 'en', off: ['trtc', 'nope'] });
check('重新註冊：保留管理者、測試機旗標與環境，不認得的系統濾掉', devRow(A).admin === 1 && devRow(A).tester === 1 && devRow(A).apns_env === 'prod' && devRow(A).off === '["trtc"]' && devRow(A).lang === 'en');
await reg(A, { lang: 'zh', off: [] });
await reg(B); world.apns[B] = 'sandbox';
await reg(C, { off: ['trtc'] });
await reg(D); world.apns[D] = 'gone';
await reg(E, { watching: ['tymc'], watchingUntil: T0 + 90 * MIN });
await reg(F, { lang: 'ja' });
check('註冊：開著的卡片系統與到期時間存起來（到期上限 24 小時）', devRow(E).watching === '["tymc"]' && devRow(E).watching_until === T0 + 90 * MIN
  && (await reg(tok('9'), { watching: ['tymc'], watchingUntil: T0 + 99 * 3600e3 }), devRow(tok('9')).watching_until === T0 + 24 * 3600e3));
await post(railPushUnregister, { token: tok('9') }, T0);
check('註銷：刪掉；不存在或格式錯也回 200', !devRow(tok('9')) && (await post(railPushUnregister, { token: 'zz' }, T0)).status === 200);

// ── 2. 分級規則 ────────────────────────────────────────────────────────────────────────────
check('分級：台鐵、高鐵的停駛與重大事件＝全國', tierOf('tra', 'suspension') === 'national' && tierOf('thsr', 'major') === 'national' && tierOf('tra', 'minor') === 'general');
check('分級：其他系統整線停駛＝停駛，重大事故沒停駛＝一般', tierOf('trtc', 'suspension') === 'suspension' && tierOf('trtc', 'major') === 'general');
check('分級：恢復沿用這件事推過的範圍，沒推過就不發', tierOf('trtc', 'recovery', { tier: 'suspension' }) === 'suspension' && tierOf('trtc', 'recovery', { tier: 'general' }) === 'general' && tierOf('trtc', 'recovery', null) === null);
check('分級：不值得推＝不送', tierOf('tra', 'none') === null);

// ── 3. 第一次上線：只記基準 ──────────────────────────────────────────────────────────────────
revise(T0, { trtc: entry('正常') });
world.draft = () => { throw new Error('不該叫模型'); };
let out = await tick(T0);
check('第一次上線：只記基準，不寫草稿、不推', out.drafts && out.drafts.baseline && world.claudeCalls.length === 0 && world.pushes.length === 0, JSON.stringify(out.drafts));
out = await tick(T0 + MIN);
check('沒有新的一版：什麼都不做', out.drafts === null && world.claudeCalls.length === 0);

// ── 4. 北捷停駛 → 停駛等級、推全體、核可請求只送管理者 ─────────────────────────────────────────────
world.draft = b => reply(b.model, draftOut('suspension'));
world.check = b => reply(b.model, checkOut('pass'), { input_tokens: 20000, output_tokens: 1000 });
revise(T0 + 2 * MIN, { trtc: entry('停駛', '文湖線停駛', T0 + 2 * MIN) });
out = await tick(T0 + 3 * MIN);
let req = lastReq();
const drafted = world.claudeCalls.find(c => c.body.model === 'claude-haiku-5-5'), checked = world.claudeCalls.find(c => c.body.model === 'claude-opus-5-5');
check('北捷停駛：Haiku 寫草稿、Opus 做檢查', !!drafted && !!checked && world.claudeCalls.length === 2);
check('草稿請求：結構化輸出、不帶備援參數（Haiku 沒有伺服器端備援）', drafted.body.output_config.format.type === 'json_schema' && !('fallbacks' in drafted.body) && !drafted.headers['anthropic-beta']);
check('檢查請求：帶 fallbacks default 與對應 beta header', checked.body.fallbacks === 'default' && checked.headers['anthropic-beta'] === 'server-side-fallback-2026-07-01');
check('檢查請求：附上一版、現況、草稿與等級', /<previous_entry>/.test(checked.body.messages[0].content) && /<draft>/.test(checked.body.messages[0].content) && /等級：停駛/.test(checked.body.messages[0].content));
check('請求列：待核可、停駛、推全體、檢查通過', req.status === 'pending' && req.tier === 'suspension' && req.audience === 'all' && req.check_verdict === 'pass' && req.test === 0);
check('預估人數：排除關掉北捷的人（A B D E F，不含 C）', req.estimate === 5, String(req.estimate));
check('費用：Haiku＋Opus 記進當月花費', Math.abs(req.cost_usd - ((2000 * 0.1 + 300 * 0.5) / 1e6 + (20000 * 4 + 1000 * 20) / 1e6)) < 1e-9
  && Math.abs(Number(JSON.parse(db.prepare(`SELECT v FROM rail_ai_kv WHERE k = 'spend:2026-10'`).get().v)) - req.cost_usd) < 1e-9);
let ap = approvalOf(req.id);
check('核可請求：只送到管理者 A（沒有推給使用者）', world.pushes.length === 1 && ap && ap.token === A && req.admin_sent === 1);
check('核可請求：類別、collapse id、alert 推播類型', ap.payload.aps.category === 'RAIL_PUSH_APPROVAL' && ap.headers['apns-collapse-id'] === 'rp-approval-trtc' && ap.headers['apns-push-type'] === 'alert' && ap.headers['apns-topic'] === 'tw.railisland.app.nativedev');
check('核可請求：顯示等級、對象與 AI 檢查結論', /^待核可｜北捷/.test(ap.payload.aps.alert.title) && /停駛・推全體/.test(ap.payload.aps.alert.subtitle) && /AI 檢查：通過/.test(ap.payload.aps.alert.body));
check('核可請求：隨機碼只在推播裡，資料庫只存雜湊', /^[0-9a-f]{32}$/.test(ap.payload.rp.nonce) && req.nonce_hash.length === 64 && !JSON.stringify(req).includes(ap.payload.rp.nonce));
out = await tick(T0 + 4 * MIN);
check('沒核可：下一分鐘不會推給使用者', world.pushes.length === 1);

// ── 5. 核可 ────────────────────────────────────────────────────────────────────────────────
const nonce = ap.payload.rp.nonce;
check('核可：隨機碼不對回 403', (await post(railPushDecide, { id: req.id, nonce: '0'.repeat(32), decision: 'approve' }, T0 + 5 * MIN)).status === 403);
check('核可：參數不對回 400', (await post(railPushDecide, { id: req.id, nonce, decision: 'yes' }, T0 + 5 * MIN)).status === 400);
r = await post(railPushDecide, { id: req.id, nonce, decision: 'approve' }, T0 + 5 * MIN);
check('核可：對的隨機碼回 200、狀態 approved', r.status === 200 && lastReq().status === 'approved');
r = await post(railPushDecide, { id: req.id, nonce, decision: 'skip' }, T0 + 5 * MIN);
check('核可：已經決定過的回 409 並附狀態（不能改成略過）', r.status === 409 && (await r.json()).status === 'approved' && lastReq().status === 'approved');

// ── 6. 送出 ────────────────────────────────────────────────────────────────────────────────
world.pushes = [];
out = await tick(T0 + 6 * MIN);
req = lastReq();
check('送出：全體排除關掉北捷的 C', !pushesTo(C).length && pushesTo(A).length === 1 && pushesTo(F).length === 1);
check('送出：sandbox token 先撞正式環境 BadDeviceToken、改送 sandbox 成功並記下環境', pushesTo(B).length === 2 && pushesTo(B)[1].host === 'api.sandbox.push.apple.com' && devRow(B).apns_env === 'sandbox');
check('送出：410 的 token 刪掉', !devRow(D));
check('送出：狀態 sent、計數正確', req.status === 'sent' && req.sent === 4 && req.failed === 1, `${req.status} ${req.sent}/${req.failed}`);
const pf = pushesTo(F)[0].payload;
check('送出：點開落在整理頁那一段（url 帶系統）', pf.url === 'railisland://open/rail-status?sys=trtc' && pf.rp.kind === 'notice' && pushesTo(F)[0].headers['apns-collapse-id'] === 'rs-trtc');
check('送出：依裝置語言給標題（ja）', pf.aps.alert.title === 'JA 北捷文湖線 18:00 起停駛');
check('送出：記下這件事推過全體', JSON.parse(db.prepare(`SELECT v FROM rail_ai_kv WHERE k = 'push-incident:trtc'`).get().v).tier === 'suspension');
check('全體推播不記收件人', db.prepare('SELECT COUNT(*) n FROM rail_push_recipients').get().n === 0);

// ── 7. 北捷恢復：模型說 minor，但段落已經正常 → 恢復；沿用全體 ──────────────────────────────────────
world.pushes = []; world.claudeCalls = [];
world.draft = b => reply(b.model, draftOut('minor', '北捷文湖線恢復營運'));
revise(T0 + 60 * MIN, { trtc: entry('正常', '全線正常', T0 + 60 * MIN) });
await tick(T0 + 61 * MIN);
req = lastReq();
check('恢復：段落正常就當恢復，沿用這件事的全體範圍', req.category === 'recovery' && req.tier === 'suspension' && req.audience === 'all' && req.incident.startsWith('trtc-'));
check('恢復：核可請求寫「恢復」，不寫成「停駛」', /^恢復（沿用停駛範圍）・推全體/.test(approvalOf(req.id).payload.aps.alert.subtitle));
await post(railPushDecide, { id: req.id, nonce: approvalOf(req.id).payload.rp.nonce, decision: 'approve' }, T0 + 62 * MIN);
await tick(T0 + 63 * MIN);
check('恢復送完：這件事結束（下次停駛是新的一件事）', lastReq().status === 'sent' && !db.prepare(`SELECT v FROM rail_ai_kv WHERE k = 'push-incident:trtc'`).get());

// ── 8. 一般等級：只推開著卡片的人；恢復時推收過的人 ─────────────────────────────────────────────────
world.pushes = [];
world.draft = b => reply(b.model, draftOut('minor', '機捷班距調整'));
revise(T0 + 70 * MIN, { tymc: entry('減班或改點', '班距 15 分', T0 + 70 * MIN) });
await tick(T0 + 71 * MIN);
req = lastReq();
check('一般：推給開著機捷卡片的 E（1 台）', req.tier === 'general' && req.audience === 'affected' && req.estimate === 1, `${req.tier} ${req.estimate}`);
await post(railPushDecide, { id: req.id, nonce: approvalOf(req.id).payload.rp.nonce, decision: 'approve' }, T0 + 72 * MIN);
await tick(T0 + 73 * MIN);
check('一般：只送 E，並記為收件人', world.pushes.filter(p => p.payload.rp.kind === 'notice').map(p => p.token).join() === E
  && db.prepare('SELECT COUNT(*) n FROM rail_push_recipients WHERE token = ? AND incident = ?').get(E, req.incident).n === 1);
world.pushes = [];
world.draft = b => reply(b.model, draftOut('recovery', '機捷恢復正常'));
revise(T0 + 200 * MIN, { tymc: entry('正常', '正常', T0 + 200 * MIN) });
await tick(T0 + 201 * MIN);
req = lastReq();
check('一般恢復：卡片已經關了（過期），E 仍因收過這件事而在名單上', req.tier === 'general' && req.estimate === 1);
await post(railPushDecide, { id: req.id, nonce: approvalOf(req.id).payload.rp.nonce, decision: 'approve' }, T0 + 202 * MIN);
await tick(T0 + 203 * MIN);
check('一般恢復：送給 E', world.pushes.filter(p => p.payload.rp.kind === 'notice').map(p => p.token).join() === E);

// ── 8b. 沒推過的事件恢復：不寫核可請求、不叫檢查（以前會變成一般等級，AI 檢查一律判「推給誰」不通過）──────────
world.pushes = []; world.claudeCalls = [];
world.draft = b => reply(b.model, draftOut('recovery', '高捷恢復正常'));
revise(T0 + 210 * MIN, { krtc: entry('正常', '正常', T0 + 210 * MIN) });
await tick(T0 + 211 * MIN);
req = lastReq();
check('沒推過的事件恢復：記成 dropped、不叫檢查、不送核可', req.system === 'krtc' && req.status === 'dropped' && req.category === 'recovery'
  && world.claudeCalls.length === 1 && world.pushes.length === 0, `${req.system} ${req.status} calls=${world.claudeCalls.length} pushes=${world.pushes.length}`);

// ── 9. 台鐵加開＝全國；不值得推＝不送核可；同系統新的一則取代舊的 ────────────────────────────────────
world.pushes = [];
world.draft = b => reply(b.model, draftOut('major', '台鐵加開 3 列自強號'));
revise(T0 + 210 * MIN, { tra: entry('減班或改點', '加開', T0 + 210 * MIN) });
await tick(T0 + 211 * MIN);
const traFirst = lastReq();
check('台鐵加開：全國、推全體', traFirst.tier === 'national' && traFirst.audience === 'all');
world.draft = b => reply(b.model, draftOut('major', '台鐵加開 5 列自強號'));
revise(T0 + 214 * MIN, { tra: entry('減班或改點', '加開更多', T0 + 214 * MIN) });
await tick(T0 + 215 * MIN);
check('同系統新的一則：舊的待核可改成作廢', db.prepare('SELECT status FROM rail_push_requests WHERE id = ?').get(traFirst.id).status === 'superseded' && lastReq().status === 'pending');
const oldNonce = approvalOf(traFirst.id).payload.rp.nonce;
check('作廢的那則再按核可回 409', (await post(railPushDecide, { id: traFirst.id, nonce: oldNonce, decision: 'approve' }, T0 + 216 * MIN)).status === 409);
world.pushes = [];
world.draft = b => reply(b.model, draftOut('none', '台鐵公告措辭修正'));
revise(T0 + 220 * MIN, { thsr: entry('正常', '正常（措辭）', T0 + 220 * MIN) });
await tick(T0 + 221 * MIN);
check('不值得推：記成 dropped，不叫檢查、不送核可', lastReq().status === 'dropped' && world.pushes.length === 0);

// ── 10. 過期、失敗、月上限 ───────────────────────────────────────────────────────────────────
const pendingTra = db.prepare(`SELECT id FROM rail_push_requests WHERE system = 'tra' AND status = 'pending'`).get();
await tick(T0 + 215 * MIN + 6 * 3600e3 + MIN);
check('待核可超過 6 小時：過期，不會自動發', db.prepare('SELECT status FROM rail_push_requests WHERE id = ?').get(pendingTra.id).status === 'expired');
world.draft = () => new Response(JSON.stringify({ error: { type: 'overloaded_error' } }), { status: 529 });
revise(T0 + 700 * MIN, { trtc: entry('停駛', '停駛', T0 + 700 * MIN) });
await tick(T0 + 701 * MIN);
check('草稿失敗：記成 error，不送核可', lastReq().status === 'error' && /claude 529/.test(lastReq().error));
world.draft = b => reply(b.model, draftOut('suspension'));
world.check = () => new Response(JSON.stringify({ model: 'claude-opus-5-5', stop_reason: 'refusal', usage: { input_tokens: 100, output_tokens: 0 }, content: [] }), { status: 200 });
world.pushes = [];
revise(T0 + 710 * MIN, { trtc: entry('停駛', '停駛二', T0 + 710 * MIN) });
await tick(T0 + 711 * MIN);
req = lastReq();
check('檢查沒跑完：照樣送核可請求，標「沒跑完」', req.status === 'pending' && req.check_verdict === 'error' && /AI 檢查：沒跑完/.test(approvalOf(req.id).payload.aps.alert.body));
db.prepare(`UPDATE rail_ai_kv SET v = '60' WHERE k = 'spend:2026-10'`).run();
world.claudeCalls = [];
revise(T0 + 720 * MIN, { tra: entry('停駛', '停駛', T0 + 720 * MIN) });
await tick(T0 + 721 * MIN);
check('到了月上限：不叫模型，記成 error', world.claudeCalls.length === 0 && lastReq().status === 'error' && /monthly cap/.test(lastReq().error));
db.prepare(`UPDATE rail_ai_kv SET v = '0' WHERE k = 'spend:2026-10'`).run();

// ── 11. 測試請求：只推測試機 ─────────────────────────────────────────────────────────────────
world.pushes = [];
world.check = b => reply(b.model, checkOut('fail'));
db.prepare(`UPDATE rail_push_devices SET tester = 1 WHERE token = ?`).run(F);
db.prepare(`INSERT INTO rail_ai_kv (k, v, updated_ms) VALUES ('push-test:trtc', '1', ?)`).run(T0);
await tick(T0 + 730 * MIN);
req = lastReq();
check('測試請求：推測試機（A、F；C 關掉北捷不算）', req.test === 1 && req.audience === 'testers' && req.estimate === 2 && !db.prepare(`SELECT k FROM rail_ai_kv WHERE k = 'push-test:trtc'`).get());
ap = approvalOf(req.id);
check('測試請求：標題標［測試］、collapse id 不跟正式請求共用、檢查不通過照樣顯示', /^［測試］待核可/.test(ap.payload.aps.alert.title) && ap.headers['apns-collapse-id'] === 'rp-test-trtc' && /不通過/.test(ap.payload.aps.alert.body));
check('測試請求不會作廢正式的待核可', db.prepare(`SELECT COUNT(*) n FROM rail_push_requests WHERE system = 'trtc' AND status = 'pending' AND test = 0`).get().n === 1);
await post(railPushDecide, { id: req.id, nonce: ap.payload.rp.nonce, decision: 'approve' }, T0 + 731 * MIN);
world.pushes = [];
await tick(T0 + 732 * MIN);
check('測試請求核可後：只送 A、F，不記事件', world.pushes.map(p => p.token).sort().join() === [A, F].sort().join() && !db.prepare(`SELECT v FROM rail_ai_kv WHERE k = 'push-incident:trtc' AND v LIKE ?`).get('%' + req.incident + '%'));

// ── 12. 分批：每分鐘 200 台，記游標 ────────────────────────────────────────────────────────────
for (let i = 0; i < 205; i++) db.prepare(`INSERT INTO rail_push_devices (token, platform, topic, created_ms, updated_ms) VALUES (?, 'ios', 'tw.railisland.app', 0, 0)`).run('0' + i.toString(16).padStart(63, '0'));
const bulk = db.prepare(`SELECT id FROM rail_push_requests WHERE system = 'trtc' AND status = 'pending' AND test = 0`).get();
db.prepare(`UPDATE rail_push_requests SET status = 'approved', decided_ms = ? WHERE id = ?`).run(T0 + 740 * MIN, bulk.id);
world.pushes = [];
await tick(T0 + 741 * MIN);
let b1 = db.prepare('SELECT * FROM rail_push_requests WHERE id = ?').get(bulk.id);
check('分批：第一分鐘送 200 台、還在送', world.pushes.length === 200 && b1.status === 'approved' && b1.sent === 200);
const firstBatch = new Set(world.pushes.map(p => p.token));
world.pushes = [];
await tick(T0 + 742 * MIN);
b1 = db.prepare('SELECT * FROM rail_push_requests WHERE id = ?').get(bulk.id);
check('分批：第二分鐘從游標接著送、不重送、送完', b1.status === 'sent' && world.pushes.length > 0 && !world.pushes.some(p => firstBatch.has(p.token)), `${b1.status} ${b1.sent}`);

// ── 13. 推播大小 ─────────────────────────────────────────────────────────────────────────────
const long = '很長'.repeat(400);
const big = approvalPayload({ id: 1, nonce: 'a'.repeat(32), system: 'tra', tier: 'national', audience: 'all', estimate: 9, test: false,
  title: { zh: long.slice(0, 40) }, body: { zh: long.slice(0, 160) }, reason: long.slice(0, 200), check: { verdict: 'pass', summary: long.slice(0, 60) } });
check('核可請求：最長的欄位也在 APNs 4 KB 上限內', new TextEncoder().encode(JSON.stringify(big)).length < 4096, String(new TextEncoder().encode(JSON.stringify(big)).length));

// ── 14. worker.js 接線：路由、方法、限流 ─────────────────────────────────────────────────────────
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
const worker = (await import('../worker.js')).default;
const wenv = { DELAY_DB, LA_LIMITER: { limit: async () => ({ success: true }) } };
let wr = await worker.fetch(new Request('https://railisland.tw/api/push/register', { method: 'POST', body: JSON.stringify({ token: tok('7'), platform: 'ios', topic: 'tw.railisland.app', off: [] }) }), wenv, { waitUntil() {} });
check('worker：POST /api/push/register 進得到註冊', wr.status === 200 && !!devRow(tok('7')));
wr = await worker.fetch(new Request('https://railisland.tw/api/rail-push/decide'), wenv, { waitUntil() {} });
check('worker：GET /api/rail-push/decide 回 405', wr.status === 405);
wr = await worker.fetch(new Request('https://railisland.tw/api/push/unregister', { method: 'POST', body: JSON.stringify({ token: tok('7') }) }),
  { DELAY_DB, LA_LIMITER: { limit: async () => ({ success: false }) } }, { waitUntil() {} });
check('worker：被限流回 429、不刪', wr.status === 429 && !!devRow(tok('7')));

// ── 15. Android（FCM）──────────────────────────────────────────────────────────────────────
// 服務帳號沿用 Firestore 那一組；私鑰故意寫成字面 \n（密碼管理器常見的貼法）。
env.FIRESTORE_PROJECT_ID = 'railisland-test';
env.FIRESTORE_SERVICE_ACCOUNT_EMAIL = 'firebase-adminsdk@railisland-test.iam.gserviceaccount.com';
env.FIRESTORE_SERVICE_ACCOUNT_PRIVATE_KEY = fcmKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).trim().replace(/\n/g, '\\n');
db.prepare(`DELETE FROM rail_push_devices WHERE token LIKE '0%'`).run(); // 第 12 段的 205 台，這段不需要
const ftok = c => 'f' + c + ':APA91b' + c.repeat(150);
const G = ftok('G'), H = ftok('H'), I = ftok('I'), J = ftok('J'), K = ftok('K'), L = ftok('L');
const regA = (t, extra = {}, now = T0) => post(railPushRegister, { token: t, platform: 'android', topic: 'tw.railisland.app.nativedev', lang: 'zh', off: [], ...extra }, now);
r = await regA(G);
check('Android 註冊：合法 FCM token 回 200、存成 android', r.status === 200 && devRow(G).platform === 'android' && devRow(G).topic === 'tw.railisland.app.nativedev' && devRow(G).apns_env === null);
check('Android 註冊：token 有空白／太短、iOS 平台配 FCM token、不認得的平台都回 400',
  (await regA('abc def'.repeat(20))).status === 400 && (await regA('fG:short')).status === 400
  && (await reg(ftok('M'))).status === 400 && (await post(railPushRegister, { token: ftok('M'), platform: 'web', topic: 'tw.railisland.app', off: [] }, T0)).status === 400 && !devRow(ftok('M')));
await regA(ftok('N'));
await post(railPushUnregister, { token: ftok('N') }, T0);
check('Android 註銷：刪掉', !devRow(ftok('N')));
await regA(H, { lang: 'ja', off: ['trtc'] });
await regA(I); world.fcm[I] = 'gone';
await regA(J); world.fcm[J] = 'bad';
await regA(K); world.fcm[K] = 'down';
await regA(L, { lang: 'en' });
db.prepare('UPDATE rail_push_devices SET admin = 1 WHERE token = ?').run(G);

world.pushes = []; world.fcmSends = []; world.oauth = [];
world.draft = b => reply(b.model, draftOut('suspension', '北捷板南線停駛'));
world.check = b => reply(b.model, checkOut('pass'));
revise(T0 + 1000 * MIN, { trtc: entry('停駛', '板南線停駛', T0 + 1000 * MIN) });
await tick(T0 + 1001 * MIN);
req = lastReq();
check('Android 核可請求：管理者旗標在 Android 上也不送（核可只走 iOS）', req.status === 'pending' && world.fcmSends.length === 0
  && world.pushes.length === 1 && world.pushes[0].token === A && req.admin_sent === 1);
check('Android 預估人數：算進 Android、排除關掉北捷的 H', req.estimate === db.prepare(`SELECT COUNT(*) n FROM rail_push_devices WHERE token != ?`).get(C).n - 1, String(req.estimate));
await post(railPushDecide, { id: req.id, nonce: approvalOf(req.id).payload.rp.nonce, decision: 'approve' }, T0 + 1002 * MIN);
world.pushes = [];
await tick(T0 + 1003 * MIN);
req = lastReq();
const oa = world.oauth[0];
check('FCM access token：服務帳號簽 RS256 JWT（iss、scope、aud、簽章對得上公鑰）、不跟轉址',
  world.oauth.length === 1 && oa.sigOk && oa.header.alg === 'RS256' && oa.grant === 'urn:ietf:params:oauth:grant-type:jwt-bearer'
  && oa.claims.iss === env.FIRESTORE_SERVICE_ACCOUNT_EMAIL && oa.claims.scope === 'https://www.googleapis.com/auth/firebase.messaging'
  && oa.claims.aud === 'https://oauth2.googleapis.com/token' && oa.claims.exp - oa.claims.iat === 3600 && oa.redirect === 'manual');
const fsTo = t => world.fcmSends.filter(x => x.message.token === t);
const fg = fsTo(G)[0];
check('FCM 送出：v1 messages:send、帶 Bearer access token', !!fg && fg.url === 'https://fcm.googleapis.com/v1/projects/railisland-test/messages:send' && fg.headers.authorization === 'Bearer ya29.test-1');
check('FCM 送出：data-only、值全是字串、HIGH、collapse_key 與 ttl 對齊 iOS', !!fg && !fg.message.notification
  && Object.values(fg.message.data).every(v => typeof v === 'string') && fg.message.android.priority === 'HIGH'
  && fg.message.android.collapse_key === 'rs-trtc' && fg.message.android.ttl === '10800s');
check('FCM 送出：點開帶系統（url 同 iOS）、依裝置語言給字', fg.message.data.kind === 'notice' && fg.message.data.sys === 'trtc' && fg.message.data.id === String(req.id)
  && fg.message.data.url === 'railisland://open/rail-status?sys=trtc' && fg.message.data.title === '北捷板南線停駛' && fsTo(L)[0].message.data.title === 'EN 北捷板南線停駛');
check('FCM 送出：全體排除關掉北捷的 Android 裝置 H', fsTo(H).length === 0 && fsTo(G).length === 1 && fsTo(L).length === 1);
check('FCM 送出：UNREGISTERED 刪掉、INVALID_ARGUMENT 只記一次失敗、503 不動', !devRow(I) && devRow(J).fail_streak === 1 && devRow(K).fail_streak === 0);
const iosSent = world.pushes.filter(p => p.payload.rp && p.payload.rp.kind === 'notice').length;
check('FCM 送出：iOS 照送，計數含兩個平台', iosSent > 0 && req.status === 'sent' && req.sent === iosSent + 2 && req.failed === 3, `${req.status} ${req.sent}/${req.failed} ios=${iosSent}`);

// 下一則：access token 沿用快取；401 作廢快取，再下一則重換
world.fcmSends = []; world.fcm[G] = 'auth';
db.prepare(`UPDATE rail_push_requests SET status = 'approved', cursor = NULL, decided_ms = ? WHERE id = ?`).run(T0 + 1010 * MIN, req.id);
await tick(T0 + 1011 * MIN);
check('FCM：下一則沿用快取的 access token，不重換', world.oauth.length === 1 && world.fcmSends.every(x => x.headers.authorization === 'Bearer ya29.test-1'));
check('FCM：401 不刪 token、不算 token 的錯', !!devRow(G) && devRow(G).fail_streak === 0);
delete world.fcm[G]; world.fcmSends = [];
db.prepare(`UPDATE rail_push_requests SET status = 'approved', cursor = NULL, decided_ms = ? WHERE id = ?`).run(T0 + 1020 * MIN, req.id);
await tick(T0 + 1021 * MIN);
check('FCM：401 之後作廢快取，下一輪重換 access token', world.oauth.length === 2 && world.fcmSends[0].headers.authorization === 'Bearer ya29.test-2');
check('FCM：INVALID_ARGUMENT 連續 3 次才刪', !devRow(J));

// 沒有服務帳號：Android 算失敗、token 留著，iOS 照送
const sa = env.FIRESTORE_SERVICE_ACCOUNT_PRIVATE_KEY; delete env.FIRESTORE_SERVICE_ACCOUNT_PRIVATE_KEY;
world.fcmSends = []; world.pushes = [];
db.prepare(`UPDATE rail_push_requests SET status = 'approved', cursor = NULL, sent = 0, failed = 0, decided_ms = ? WHERE id = ?`).run(T0 + 1030 * MIN, req.id);
await tick(T0 + 1031 * MIN);
const noKey = db.prepare('SELECT * FROM rail_push_requests WHERE id = ?').get(req.id);
check('沒設服務帳號：不叫 FCM、Android 算失敗不刪、iOS 照送', world.fcmSends.length === 0 && !!devRow(G) && !!devRow(L)
  && world.pushes.length > 0 && noKey.failed === db.prepare(`SELECT COUNT(*) n FROM rail_push_devices WHERE platform = 'android' AND token != ?`).get(H).n, `${noKey.sent}/${noKey.failed}`);
env.FIRESTORE_SERVICE_ACCOUNT_PRIVATE_KEY = sa;

const longReq = { id: 1, system: 'ntmetro', title: JSON.stringify({ zh: '很長'.repeat(20), ja: '長'.repeat(40) }), body: JSON.stringify({ zh: '很長'.repeat(80), ja: '長'.repeat(160) }) };
const bigFcm = JSON.stringify(fcmNoticeMessage(longReq, 'ja', ftok('Z')));
check('FCM：最長的標題與內文也在 4 KB 上限內', new TextEncoder().encode(bigFcm).length < 4096, String(new TextEncoder().encode(bigFcm).length));
wr = await worker.fetch(new Request('https://railisland.tw/api/push/register', { method: 'POST', body: JSON.stringify({ token: ftok('W'), platform: 'android', topic: 'tw.railisland.app', off: [] }) }), wenv, { waitUntil() {} });
check('worker：POST /api/push/register 收 Android', wr.status === 200 && devRow(ftok('W')).platform === 'android');

console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
