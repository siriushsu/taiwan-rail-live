#!/usr/bin/env node
// AI 營運整理（scripts/rail_ai_status.mjs）的離線驗收：真 SQL（d1_local＋schema/*.sql）、假官網、假 Claude 串流。
// 不連網、不花錢。用法：node scripts/verify_rail_ai_status.mjs
import { openTestDb } from './d1_local.mjs';
import { railAiDetect, railAiSummarize, railAiScheduled, railAiStatus, RAIL_AI_SOURCES } from './rail_ai_status.mjs';
import manual from '../data/rail_weather_bulletin.json' with { type: 'json' };

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };

const TRA = RAIL_AI_SOURCES.find(s => s.id === 'tra-list').url;
const traItem = (no, title) => `<li><a href="/tra-tip-web/tip/tip009/tip911/newsDtl?newsNo=${no}">${title}</a></li>`;
const traUrl = no => new URL(`/tra-tip-web/tip/tip009/tip911/newsDtl?newsNo=${no}`, TRA).href;

// 假世界：官網列表、公告內文、Claude 的回應都由測試控制
const world = {
  lists: {
    'tra-list': [traItem('aa01', '中秋連假加開列車')],
    'trtc-list': ['<a href="News_Content.aspx?n=30CCEFD2A45592BF&s=1">捷運商品館新品上市</a>'],
    'afr-list': ['<a href="/AllNews/0001">林鐵徵才公告</a>'],
    'thsr-home': ['<a href="/ArticleContent/00000000-0000-0000-0000-000000000001">高鐵會員活動</a>'],
  },
  ntm: { status: '全線正常營運', marquee: '環狀線正常' },
  articles: { [traUrl('aa01')]: '<p>中秋連假加開 3 列自強號</p>' },
  claude: null, claudeCalls: [],
};
const listHtml = id => `<html><body><ul>${world.lists[id].join('')}</ul></body></html>`;
const ntmHtml = () => `<html><body><div>營運狀況 ${world.ntm.status} 公司簡介</div><div id="home-marquee"><div>${world.ntm.marquee}</div></div></body></html>`;

function sse(events, { crlf = false, chunk = 7 } = {}) {
  const nl = crlf ? '\r\n' : '\n';
  const body = events.map(e => `event: ${e.type}${nl}data: ${JSON.stringify(e)}${nl}${nl}`).join('');
  const bytes = new TextEncoder().encode(body);
  let i = 0;
  return new Response(new ReadableStream({ pull(c) { if (i >= bytes.length) return c.close(); c.enqueue(bytes.slice(i, i += chunk)); } }), { status: 200 });
}
function claudeReply(entry, { stop = 'end_turn', crlf = false } = {}) {
  const text = JSON.stringify(entry);
  return sse([
    { type: 'message_start', message: { model: 'claude-opus-5-5', usage: { input_tokens: 10000, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '想一下' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(0, 20) } },
    { type: 'ping' },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(20) } },
    { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 5000 } },
    { type: 'message_stop' },
  ], { crlf });
}
const entry = (status, state = '停駛', url = traUrl('bb02')) => ({
  status, statusEn: 'EN ' + status, statusJa: 'JA ' + status, detail: `台鐵公告：${status}`, detailEn: 'en', detailJa: 'ja',
  sourceUrls: [url, 'javascript:alert(1)'], impacts: [{ scope: '基隆=彰化', state, from: '12:00', until: '', trains: [] }],
});

async function fakeFetch(url, init = {}) {
  url = String(url);
  if (url === 'https://api.anthropic.com/v1/messages') {
    const body = JSON.parse(init.body);
    world.claudeCalls.push({ body, headers: init.headers });
    return world.claude(body);
  }
  const src = RAIL_AI_SOURCES.find(s => s.url === url);
  if (src && src.id === 'ntmetro-home') return new Response(ntmHtml());
  if (src) return new Response(listHtml(src.id));
  if (url in world.articles) return new Response(world.articles[url]);
  return new Response('not found', { status: 404 });
}

const { db, DELAY_DB } = openTestDb();
const env = { DELAY_DB, ANTHROPIC_API_KEY: 'test-key' };
const T0 = Date.parse('2026-10-24T09:00:00+08:00');
const api = async (now, qs = '') => { const r = await railAiStatus(new Request('https://railisland.tw/api/rail-status' + qs), env, now); return { status: r.status, body: await r.json() }; };

// 1. 第一輪記基準；列表上已經有營運相關公告（台鐵加開）、燈號有營運狀況（新北捷）的系統直接排整理
world.claude = () => { throw new Error('不該叫模型'); };
let d = await railAiDetect(env, { now: T0, fetch: fakeFetch });
check('第一輪：每個來源都記基準，有營運相關內容的系統排整理', d.dirty.join() === 'tra,ntmetro' && d.relevant === 0 && d.errors.length === 0 && db.prepare(`SELECT COUNT(*) n FROM rail_ai_events WHERE type='baseline'`).get().n === RAIL_AI_SOURCES.length, JSON.stringify(d));
check('第一輪：列表上既有的營運相關公告先存原文、不相關的不存', db.prepare('SELECT text FROM rail_ai_articles WHERE url = ?').get(traUrl('aa01'))?.text.includes('加開 3 列')
  && db.prepare('SELECT COUNT(*) n FROM rail_ai_articles').get().n === 1);
// 第一輪的整理在第 17 節用另一個庫驗；這裡清掉，下面的流程從沒有待整理開始
db.prepare(`DELETE FROM rail_ai_kv WHERE k LIKE 'pending:%'`).run();
let s = await railAiSummarize(env, { now: T0, fetch: fakeFetch });
check('沒有待整理就不呼叫模型', s.skipped === 'nothing pending' && world.claudeCalls.length === 0);

// 2. 不相關的新公告：記事件、不整理、不抓內文
world.lists['tra-list'].unshift(traItem('aa02', '台鐵便當新口味'));
d = await railAiDetect(env, { now: T0 + 3 * 60e3, fetch: fakeFetch });
check('不相關的新公告不會標成待整理', d.events === 1 && d.relevant === 0 && d.dirty.length === 0);
check('不相關的新公告不存原文', db.prepare('SELECT COUNT(*) n FROM rail_ai_articles WHERE url = ?').get(traUrl('aa02')).n === 0);

// 3. 相關的新公告：存原文、標待整理、整理一次、出新版
world.lists['tra-list'].unshift(traItem('bb02', '因應颱風 列車停駛公告'));
world.articles[traUrl('bb02')] = '<html><script>var x=1</script><body><h1>因應颱風 列車停駛公告</h1><p>基隆=彰化 12 時起停駛</p></body></html>';
const T1 = T0 + 6 * 60e3;
d = await railAiDetect(env, { now: T1, fetch: fakeFetch });
check('相關的新公告標成待整理', d.dirty.join() === 'tra', JSON.stringify(d));
const art = db.prepare('SELECT title, text FROM rail_ai_articles WHERE url = ?').get(traUrl('bb02'));
check('相關公告存了去掉 HTML 的原文', art && art.text.includes('12 時起停駛') && !art.text.includes('var x'));
world.claude = () => claudeReply(entry('部分停駛'), { crlf: true });
s = await railAiSummarize(env, { now: T1, fetch: fakeFetch });
check('整理一個系統、算出費用', s.done && s.done.join() === 'tra' && s.failed.length === 0 && Math.abs(s.cost - 0.14) < 1e-9, JSON.stringify(s));
const call = world.claudeCalls.at(-1);
check('請求帶 2026-10-21 版本、結構化輸出、串流、金鑰在標頭', call.headers['anthropic-version'] === '2026-10-21' && call.body.stream === true
  && call.body.output_config.format.type === 'json_schema' && call.headers['x-api-key'] === 'test-key' && !('temperature' in call.body));
check('送給模型的內容含新公告原文與變化清單', call.body.messages[0].content.includes('12 時起停駛') && call.body.messages[0].content.includes('新出現'));
check('整理完清掉待整理', db.prepare(`SELECT COUNT(*) n FROM rail_ai_kv WHERE k LIKE 'pending:%'`).get().n === 0);
let a = await api(T1 + 60e3);
const tra = a.body.systems.find(x => x.id === 'tra');
check('API 回這一版：標 AI、附官方原文標題、濾掉非 http 網址', a.status === 200 && tra && tra.basis === 'ai' && tra.sources.length === 1
  && tra.sources[0].title === '因應颱風 列車停駛公告' && tra.statusEn === 'EN 部分停駛', JSON.stringify(tra && tra.sources));
check('API 帶最近一次檢查官方來源的時間與版本', a.body.checkedAt === T1 && a.body.revision && a.body.revision.changed.join() === 'tra');

// 4. 第二版是增量：上一版內容會送進去
world.lists['tra-list'].unshift(traItem('cc03', '颱風後 列車恢復行駛'));
world.articles[traUrl('cc03')] = '<p>15 時起恢復正常行駛</p>';
const T2 = T1 + 30 * 60e3;
await railAiDetect(env, { now: T2, fetch: fakeFetch });
world.claude = () => claudeReply(entry('恢復正常', '正常', traUrl('cc03')));
s = await railAiSummarize(env, { now: T2, fetch: fakeFetch });
const c2 = world.claudeCalls.at(-1).body.messages[0].content;
check('第二版把上一版當基礎送進去', c2.includes('<previous_entry>') && c2.includes('部分停駛') && c2.includes('15 時起恢復'));
check('版本累積兩版', db.prepare('SELECT COUNT(*) n FROM rail_ai_revisions').get().n === 2);
a = await api(T2 + 60e3, '?list=1');
check('?list=1 列出每一版與費用', a.body.revisions.length === 2 && a.body.revisions[0].changed.join() === 'tra');
a = await api(T2 + 60e3, '?rev=1');
check('?rev=1 回第一版的內容', a.body.systems.find(x => x.id === 'tra').status === '部分停駛');

// 5. 已恢復正常的系統留 24 小時後從頁面消失；看舊版（?rev）不受影響
a = await api(T2 + 23 * 3600e3);
check('恢復正常 23 小時內還在頁面上', a.body.systems.some(x => x.id === 'tra'));
a = await api(T2 + 25 * 3600e3);
check('恢復正常超過 24 小時就不列', !a.body.systems.some(x => x.id === 'tra'));

// 6. 燈號型來源（新北首頁）的改變算相關變化
world.ntm.marquee = '安坑輕軌暫停營運';
d = await railAiDetect(env, { now: T2 + 3 * 60e3, fetch: fakeFetch });
check('新北首頁跑馬改變標成待整理', d.dirty.join() === 'ntmetro');

// 7. 執行鎖：上一輪還沒結束，第二輪不重複叫模型；鎖過期才接手
const T3 = T2 + 6 * 60e3;
db.prepare(`INSERT INTO rail_ai_kv (k, v, updated_ms) VALUES ('ai_lock', ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`).run(String(T3 + 5 * 60e3), T3);
const callsBefore = world.claudeCalls.length;
s = await railAiSummarize(env, { now: T3, fetch: fakeFetch });
check('鎖還在就跳過', s.skipped === 'locked by another run' && world.claudeCalls.length === callsBefore);

// 8. 整理途中又有新變化：整理完不能清掉那一筆
world.claude = () => claudeReply(entry('安坑暫停', '部分停駛', 'https://www.ntmetro.com.tw/'));
const later = T3 + 13 * 60e3;
db.prepare(`UPDATE rail_ai_kv SET v = ? WHERE k = 'pending:ntmetro'`).run(String(later + 60e3)); // 模擬下一輪偵測在整理途中寫入
s = await railAiSummarize(env, { now: later, fetch: fakeFetch });
check('整理途中的新變化保留在待整理', s.done && s.done.join() === 'ntmetro' && db.prepare(`SELECT COUNT(*) n FROM rail_ai_kv WHERE k = 'pending:ntmetro'`).get().n === 1, JSON.stringify(s));
check('整理完釋放執行鎖', db.prepare(`SELECT v FROM rail_ai_kv WHERE k = 'ai_lock'`).get().v === '0');

// 9. 模型沒寫完（max_tokens）：不出新版、記錯誤、待整理留著
world.claude = () => claudeReply(entry('x'), { stop: 'max_tokens' });
const revsBefore = db.prepare('SELECT COUNT(*) n FROM rail_ai_revisions').get().n;
s = await railAiSummarize(env, { now: later + 3 * 60e3, fetch: fakeFetch });
check('模型沒寫完就不出新版、記錯誤', s.done.length === 0 && s.failed.length === 1 && db.prepare('SELECT COUNT(*) n FROM rail_ai_revisions').get().n === revsBefore
  && db.prepare(`SELECT COUNT(*) n FROM rail_ai_events WHERE source='summarizer' AND type='error'`).get().n === 1, JSON.stringify(s));
check('沒寫完的費用照樣記進當月花費', db.prepare(`SELECT v FROM rail_ai_kv WHERE k LIKE 'spend:%'`).get().v > 0.42);

// 10. 手動鎖定：AI 不改寫；人工彙整在適用期間內就改顯示人工版
db.prepare('INSERT INTO rail_ai_locks (system, locked_ms, note) VALUES (?, ?, ?)').run('ntmetro', later, '測試');
world.claude = () => { throw new Error('鎖住的系統不該叫模型'); };
s = await railAiSummarize(env, { now: later + 6 * 60e3, fetch: fakeFetch });
check('鎖住的系統不整理', s.skipped === 'nothing pending', JSON.stringify(s));
const inManual = Date.parse(manual.displayFrom) + 60e3;
a = await api(inManual);
const nt = a.body.systems.find(x => x.id === 'ntmetro');
check('鎖住且人工彙整有效：顯示人工版', nt && nt.basis === 'manual' && nt.locked === true && nt.detail === manual.systems.find(x => x.id === 'ntmetro').detail);
a = await api(Date.parse(manual.expiresAt) + 60e3);
const nt2 = a.body.systems.find(x => x.id === 'ntmetro');
check('鎖住但人工彙整過期：顯示鎖定前最後一版並標暫停', nt2 && nt2.basis === 'ai-frozen' && nt2.status === '安坑暫停');
db.prepare('DELETE FROM rail_ai_locks').run();

// 11. 當月花費到上限就只偵測不整理
db.prepare(`UPDATE rail_ai_kv SET v = '1000' WHERE k LIKE 'spend:%'`).run();
s = await railAiSummarize(env, { now: later + 9 * 60e3, fetch: fakeFetch });
check('到當月上限就不整理', /monthly cap/.test(s.skipped || ''), JSON.stringify(s));

// 12. 沒有金鑰：只偵測
s = await railAiSummarize({ DELAY_DB }, { now: later + 12 * 60e3, fetch: fakeFetch });
check('沒有金鑰就不整理', s.skipped === 'no key');

// 13. cron 入口只在每 3 分鐘那一分鐘跑
const offMinute = Math.floor(later / 60e3) * 60e3 + 60e3 * (Math.floor(later / 60e3) % 3 === 0 ? 1 : 0);
const r = await railAiScheduled({ scheduledTime: offMinute }, env, { fetch: fakeFetch });
check('不是 3 的倍數分鐘就不跑', r.skipped === 'not this minute');

// 14. 官網抓不到：記錯誤，不當成公告消失
const brokenFetch = (url, init) => String(url).includes('trc.com.tw') ? Promise.reject(new Error('ETIMEDOUT')) : fakeFetch(url, init);
d = await railAiDetect(env, { now: later + 15 * 60e3, fetch: brokenFetch });
check('官網抓不到只記錯誤、不產生消失事件', d.errors.length === 1 && d.dirty.length === 0, JSON.stringify(d));

// 15. TDX 公告：有傳進來才比；自己寫的彙整與例行正常不算
const alerts = { tra: [{ bulletin: true, sysLabel: '軌島', title: '彙整' }, { status: 1, title: '全線營運正常' }],
  thsr: [], metro: [{ sysLabel: '高雄輕軌', status: 2, title: '輕軌部分區間停駛', desc: '因強風', lines: ['C'] }] };
d = await railAiDetect(env, { now: later + 18 * 60e3, fetch: fakeFetch, alerts });
check('第一次拿到 TDX：已經有營運相關公告的系統直接排整理（高雄輕軌）', d.dirty.join() === 'klrt', JSON.stringify(d));
alerts.metro[0].desc = '因強風，預計 16 時恢復';
d = await railAiDetect(env, { now: later + 21 * 60e3, fetch: fakeFetch, alerts });
check('TDX 公告內容改變標成待整理（高雄輕軌）', d.dirty.join() === 'klrt', JSON.stringify(d));

// 16. 資料表不存在（正式庫漏套 migration）時 API 回 503，不丟例外
const bad = await railAiStatus(new Request('https://railisland.tw/api/rail-status'), { DELAY_DB: { prepare() { throw new Error('no such table: rail_ai_revisions'); } } });
check('資料表不存在回 503', bad.status === 503);

// 17. 剛上線的第一輪：直接整理，提示裡要說明 first_seen 不是發布時間
{
  const fresh = openTestDb();
  const env2 = { DELAY_DB: fresh.DELAY_DB, ANTHROPIC_API_KEY: 'test-key' };
  world.claudeCalls.length = 0;
  world.claude = () => claudeReply(entry('加開列車', '正常', traUrl('aa01')));
  await railAiDetect(env2, { now: T0, fetch: fakeFetch });
  const s2 = await railAiSummarize(env2, { now: T0, fetch: fakeFetch });
  const prompts = world.claudeCalls.map(c => c.body.messages[0].content);
  check('剛上線第一輪就整理有營運相關內容的系統', s2.done && s2.done.sort().join() === 'ntmetro,tra' && fresh.db.prepare('SELECT COUNT(*) n FROM rail_ai_revisions').get().n === 1, JSON.stringify(s2));
  check('第一輪的提示說明 first_seen 不是發布時間，並附上既有公告原文', prompts.length === 2 && prompts.every(p => p.includes('不是發布時間'))
    && prompts.some(p => p.includes('加開 3 列')) && prompts.some(p => p.includes('全線正常營運')));
}

// ── 18–23：上線前複審抓到的情境，各用一個乾淨的庫 ──
const TB = Date.parse('2026-10-25T09:00:00+08:00'); // 整點，是 3 的倍數分鐘
const fresh = () => { const f = openTestDb(); return { ...f, env: { DELAY_DB: f.DELAY_DB, ANTHROPIC_API_KEY: 'test-key' } }; };
const apiOn = async (e, now, qs = '') => { const r = await railAiStatus(new Request('https://railisland.tw/api/rail-status' + qs), e, now); return { status: r.status, body: await r.json() }; };
const reply = (status, state, urls = []) => claudeReply({ ...entry(status, state), sourceUrls: urls });
const savedTra = [...world.lists['tra-list']];

// 18. 只靠 TDX 的系統（高雄輕軌）：示警結束後恢復，也要看得到、改寫成正常；端點失敗不當成公告消失
{
  const f = fresh();
  const stop = { sysLabel: '高雄輕軌', status: 2, title: '輕軌停駛', desc: '因強風全線停駛', lines: ['C'] };
  const normal = label => ({ sysLabel: label, status: 1, title: '正常營運', desc: '正常營運' });
  let alertsNow = { tra: [], thsr: [], metro: [stop, normal('高雄捷運')] }, loads = 0, klrt = ['輕軌停駛', '停駛'];
  const loadAlerts = async () => { loads++; return alertsNow; };
  world.claudeCalls.length = 0;
  world.claude = body => body.messages[0].content.includes('系統：klrt') ? reply(...klrt) : reply('正常', '正常');
  const tick = (min, hazardActive) => railAiScheduled({ scheduledTime: TB + min * 60e3 }, f.env, { hazardActive, loadAlerts, fetch: fakeFetch });
  await tick(0, true);
  const latest = () => JSON.parse(f.db.prepare('SELECT systems FROM rail_ai_revisions ORDER BY id DESC LIMIT 1').get().systems);
  check('示警期間讀 TDX：輕軌停駛排整理並寫成停駛、例行正常的高捷不整理', loads === 1 && latest().klrt?.status === '輕軌停駛' && !latest().krtc);
  const calls = world.claudeCalls.length;
  await tick(3, false);
  check('示警結束、輕軌還沒恢復：照樣讀 TDX，沒變化不叫模型', loads === 2 && world.claudeCalls.length === calls);
  alertsNow = { tra: [], thsr: [], metro: [normal('高雄輕軌'), normal('高雄捷運')] }; klrt = ['恢復正常', '正常'];
  await tick(6, false);
  const p = world.claudeCalls.at(-1).body.messages[0].content;
  check('輕軌恢復：停駛那筆消失、例行正常出現 → 整理，提示裡有 TDX 的正常營運', loads === 3 && p.includes('系統：klrt') && p.includes('[1] 正常營運') && p.includes('消失') && latest().klrt.status === '恢復正常');
  check('提示允許把營運單位標示的正常營運當作依據', p.length > 0 && world.claudeCalls.at(-1).body.system.includes('可以當作目前正常營運的依據'));
  await tick(9, false);
  check('TDX 系統都恢復正常後，沒有示警就不再讀 TDX', loads === 3);
  const before = f.db.prepare(`SELECT COUNT(*) n FROM rail_ai_events WHERE system IN ('tra','klrt') AND type IN ('new','removed')`).get().n;
  alertsNow = { tra: null, thsr: [], metro: [normal('高雄捷運')] };
  await tick(12, true);
  check('台鐵端點失敗、輕軌那家查不到：不算公告消失、不排整理', f.db.prepare(`SELECT COUNT(*) n FROM rail_ai_events WHERE system IN ('tra','klrt') AND type IN ('new','removed')`).get().n === before
    && f.db.prepare(`SELECT COUNT(*) n FROM rail_ai_kv WHERE k LIKE 'pending:%'`).get().n === 0);
}

// 19. 失敗退避，串流中途出錯的費用照樣算進當月花費
{
  const f = fresh();
  world.claudeCalls.length = 0;
  world.claude = () => sse([
    { type: 'message_start', message: { model: 'claude-opus-5-5', usage: { input_tokens: 10000, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x'.repeat(100) } },
    { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
  ]);
  await railAiDetect(f.env, { now: TB, fetch: fakeFetch }); // 基準：台鐵（加開）、新北（燈號）排整理
  let r = await railAiSummarize(f.env, { now: TB, fetch: fakeFetch });
  const spend = () => Number(f.db.prepare(`SELECT v FROM rail_ai_kv WHERE k LIKE 'spend:%'`).get()?.v || 0);
  check('串流中途出錯：兩個系統都記失敗，已花的費用算進當月', r.failed?.length === 2 && Math.abs(spend() - 2 * (10000 * 4 + 100 * 20) / 1e6) < 1e-9, JSON.stringify(r) + ' spend ' + spend());
  const n0 = world.claudeCalls.length;
  r = await railAiSummarize(f.env, { now: TB + 3 * 60e3, fetch: fakeFetch });
  check('失敗後 3 分鐘：退避中不叫模型', r.skipped === 'nothing pending' && world.claudeCalls.length === n0);
  r = await railAiSummarize(f.env, { now: TB + 6 * 60e3, fetch: fakeFetch });
  check('第一次失敗後 6 分鐘：再試', r.failed?.length === 2);
  await railAiSummarize(f.env, { now: TB + 18 * 60e3, fetch: fakeFetch });
  const n3 = world.claudeCalls.length;
  r = await railAiSummarize(f.env, { now: TB + 10 * 3600e3, fetch: fakeFetch });
  check('連續 3 次失敗：停手，幾小時後也不再叫', r.skipped === 'nothing pending' && world.claudeCalls.length === n3 && n3 === 6);
  world.lists['tra-list'] = [traItem('ee05', '颱風 列車停駛公告'), ...savedTra];
  world.articles[traUrl('ee05')] = '<p>停駛</p>';
  await railAiDetect(f.env, { now: TB + 10 * 3600e3 + 3 * 60e3, fetch: fakeFetch });
  world.claude = () => reply('部分停駛', '部分停駛', [traUrl('ee05')]);
  r = await railAiSummarize(f.env, { now: TB + 10 * 3600e3 + 3 * 60e3, fetch: fakeFetch });
  check('停手後有新公告：只重試有新變化的台鐵，成功後清掉失敗紀錄', r.done?.join() === 'tra' && r.failed.length === 0
    && f.db.prepare(`SELECT COUNT(*) n FROM rail_ai_kv WHERE k = 'fail:tra'`).get().n === 0 && f.db.prepare(`SELECT COUNT(*) n FROM rail_ai_kv WHERE k = 'fail:ntmetro'`).get().n === 1, JSON.stringify(r));
  // 21. 卡住的系統與太久沒更新的系統，頁面要提醒
  let a = await apiOn(f.env, TB + 11 * 3600e3);
  check('新北一直整理失敗：API 列在 lagging，附官網網址', a.body.lagging.length === 1 && a.body.lagging[0].id === 'ntmetro' && a.body.lagging[0].url === 'https://www.ntmetro.com.tw/', JSON.stringify(a.body.lagging));
  check('台鐵剛整理過：不標太久沒更新', a.body.systems.find(x => x.id === 'tra')?.stale === false);
  a = await apiOn(f.env, TB + 23 * 3600e3);
  check('台鐵停駛 12 小時沒有新整理：標 stale', a.body.systems.find(x => x.id === 'tra')?.stale === true);
  a = await apiOn(f.env, TB + 11 * 3600e3, '?rev=1');
  check('看舊版不列 lagging', a.body.lagging.length === 0);
}

// 20、22、23. 抓不到的內文會補抓；被擠下去又回來的舊公告不算新；模型只能引用餵給它的網址
{
  const f = fresh();
  world.lists['tra-list'] = [traItem('dd01', '颱風 停駛公告'), ...savedTra];
  delete world.articles[traUrl('dd01')];
  await railAiDetect(f.env, { now: TB, fetch: fakeFetch });
  check('內文抓不到：先存標題、內文空著', f.db.prepare('SELECT text FROM rail_ai_articles WHERE url = ?').get(traUrl('dd01'))?.text === null);
  f.db.prepare(`DELETE FROM rail_ai_kv WHERE k LIKE 'pending:%'`).run();
  world.articles[traUrl('dd01')] = '<p>補到的內文：全線停駛</p>';
  let d = await railAiDetect(f.env, { now: TB + 3 * 60e3, fetch: fakeFetch });
  check('下一輪補抓到內文：存起來並排整理', d.dirty.includes('tra') && f.db.prepare('SELECT text FROM rail_ai_articles WHERE url = ?').get(traUrl('dd01')).text.includes('補到的內文'), JSON.stringify(d));
  world.claude = () => reply('停駛', '停駛', [traUrl('dd01'), 'https://evil.example/fake']);
  await railAiSummarize(f.env, { now: TB + 3 * 60e3, fetch: fakeFetch });
  const sys = JSON.parse(f.db.prepare('SELECT systems FROM rail_ai_revisions ORDER BY id DESC LIMIT 1').get().systems);
  check('模型引用沒餵給它的網址會被濾掉', JSON.stringify(sys.tra.sourceUrls) === JSON.stringify([traUrl('dd01')]), JSON.stringify(sys.tra.sourceUrls));
  world.lists['tra-list'] = [...savedTra];
  await railAiDetect(f.env, { now: TB + 6 * 60e3, fetch: fakeFetch });
  world.lists['tra-list'] = [traItem('dd01', '颱風 停駛公告'), ...savedTra];
  d = await railAiDetect(f.env, { now: TB + 9 * 60e3, fetch: fakeFetch });
  check('被擠下去又回來的舊公告：不算新公告、不排整理', !d.dirty.includes('tra') && d.relevant === 0, JSON.stringify(d));
}
world.lists['tra-list'] = savedTra;

// 24. 臺鐵官網換網域：D1 裡還是舊網域（www.railway.gov.tw）存的列表與原文，換網域那一輪不能整頁變成新公告
{
  const f = fresh();
  world.lists['tra-list'] = [traItem('ee01', '颱風 停駛公告'), ...savedTra];
  world.articles[traUrl('ee01')] = '<p>颱風停駛</p>';
  await railAiDetect(f.env, { now: TB, fetch: fakeFetch });
  f.db.prepare(`DELETE FROM rail_ai_kv WHERE k LIKE 'pending:%'`).run();
  const toOld = `REPLACE(%s, 'https://www.trc.com.tw/', 'https://www.railway.gov.tw/')`;
  f.db.prepare(`UPDATE rail_ai_kv SET v = ${toOld.replace('%s', 'v')} WHERE k = 'src:tra-list'`).run();
  f.db.prepare(`UPDATE rail_ai_articles SET url = ${toOld.replace('%s', 'url')}`).run();
  let d = await railAiDetect(f.env, { now: TB + 3 * 60e3, fetch: fakeFetch });
  check('換網域那一輪：舊網域存的公告不算新公告、不排整理', d.events === 0 && !d.dirty.includes('tra'), JSON.stringify(d));
  world.lists['tra-list'] = [...savedTra];
  await railAiDetect(f.env, { now: TB + 6 * 60e3, fetch: fakeFetch });
  world.lists['tra-list'] = [traItem('ee01', '颱風 停駛公告'), ...savedTra];
  d = await railAiDetect(f.env, { now: TB + 9 * 60e3, fetch: fakeFetch });
  check('換網域後被擠下去又回來的舊公告（原文存在舊網域）：不算新公告', !d.dirty.includes('tra') && d.relevant === 0, JSON.stringify(d));
}
world.lists['tra-list'] = savedTra;

console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
