// 懸賞四個端點的離線驗收。不起伺服器、不用 wrangler：直接呼叫 worker.js 導出的處理函式，
// D1 用 scripts/d1_local.mjs 的真 SQLite 替身（模式抄 scripts/verify_rate_limit.mjs）。
// 跑法：node scripts/verify_bounty_api.mjs
import { readFileSync } from 'node:fs';
import worker, { _bounty } from '../worker.js';
import { openTestDb } from './d1_local.mjs';

// Node 沒有全域 caches（Workers Cache API），worker.js 多個端點含 bountyBoard 都用
// caches.default——比照 verify_rate_limit.mjs／verify_usage_split.mjs／dev_server.mjs 的既有慣例補 mock。
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };

const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
const req = (path, init) => new Request('https://railisland.tw' + path, init);
const body = async res => JSON.parse(await res.text());

// 節流替身：limit() 回 success:false 代表額度用完
const limiter = blocked => ({ limit: async () => ({ success: !blocked }) });
// ASSETS 替身：bountyRules() 讀 data/bounty_rules.json——與前端讀的是同一份實體檔。
const ASSETS = { fetch: async () => new Response(readFileSync('data/bounty_rules.json', 'utf8'), { status: 200 }) };
const ENV = (DELAY_DB, over = {}) => ({ DELAY_DB, BOUNTY_LIMITER: limiter(false), ASSETS, ...over });

// 種子：兩條線、track 與 dwell 都有、一筆已收滿
const SEED = `
INSERT INTO bounty_board (seg_key,sys,train_kind,dir,kind,slot,l1,l2,points,per_day,first_listed_at,first_claimable_at,sample_count,covered_at) VALUES
 ('tra_sched|南迴線|大武|太麻里','tra_sched','自強',0,'track','',3,1,3,4,1700000000000,1700000000000,0,NULL),
 ('tra_sched|南迴線|大武|枋寮',  'tra_sched','自強',0,'track','',3,1,3,4,1700000000000,1700000000000,0,NULL),
 ('tra_sched|南迴線|大武|太麻里','tra_sched','自強',1,'track','',3,1,3,4,1700000000000,1700000000000,0,NULL),
 ('tra_sched|縱貫線北段|七堵|臺北',  'tra_sched','區間',0,'track','',1,1,1,60,1700000000000,1700000000000,1,1700000900000),
 ('tra_sched|南迴線|臺東|臺東',  'tra_sched','自強',0,'dwell','peak',3,1,3,4,1700000000000,1700000000000,0,NULL);
INSERT INTO bounty_claims (id,actor,seg_key,train_kind,dir,kind,slot,points_locked,claimed_at,expires_at,status) VALUES
 ('c1|0','dev-a','tra_sched|南迴線|大武|太麻里','自強',0,'track','',3,1700000000000,1799999999999,'open'),
 ('c2|0','dev-b','tra_sched|南迴線|大武|太麻里','自強',0,'track','',3,1700000000000,1700000000001,'open');
`;

// ── A 組：GET /api/bounty-board ───────────────────────────────────────────
{
  const { groupBoardRows, bountyCardId, bountySegLine } = _bounty;

  // A1 純函式分組：判準由測試自己算，不呼叫實作的聚合
  const rows = [
    { seg_key: 'tra_sched|南迴線|大武|太麻里', sys: 'tra_sched', train_kind: '自強', dir: 0, kind: 'track', slot: '', points: 3, sample_count: 0 },
    { seg_key: 'tra_sched|南迴線|大武|枋寮', sys: 'tra_sched', train_kind: '自強', dir: 0, kind: 'track', slot: '', points: 3, sample_count: 0 },
    { seg_key: 'tra_sched|南迴線|大武|太麻里', sys: 'tra_sched', train_kind: '自強', dir: 1, kind: 'track', slot: '', points: 3, sample_count: 0 },
  ];
  const cards = groupBoardRows(rows, new Map([['tra_sched|南迴線|大武|太麻里|自強|0|track|', 2]]), { TRA: 1, THSR: 1, metro: 3 });
  const dir0 = cards.find(c => c.dir === 0), dir1 = cards.find(c => c.dir === 1);
  ok('A1 依 (sys,lnId,dir,trainKind,kind,slot) 分組成兩張卡', cards.length === 2, JSON.stringify(cards.map(c => c.id)));
  ok('A2 dir0 卡有 2 個單位、6 點（3+3，測試自己加的）', dir0 && dir0.units === 2 && dir0.points === 6, JSON.stringify(dir0));
  ok('A3 dir1 卡有 1 個單位、3 點', dir1 && dir1.units === 1 && dir1.points === 3, JSON.stringify(dir1));
  ok('A4 cardId 六段', bountyCardId(rows[0]) === 'tra_sched|南迴線|0|自強|track|', bountyCardId(rows[0]));
  ok('A5 dwell 鍵解得出 isDwell', bountySegLine('tra_sched|南迴線|臺東|臺東').isDwell === true && bountySegLine('tra_sched|南迴線|大武|枋寮').isDwell === false);
  ok('A6 claimers 取自傳入的計數，不是自己去查 D1', dir0 && dir0.claimers === 2, JSON.stringify(dir0));

  // A7–A10 端點層
  const { DELAY_DB } = openTestDb(SEED);
  const res = await _bounty.bountyBoard(req('/api/bounty-board'), ENV(DELAY_DB));
  const b = await body(res);
  ok('A7 回 200 且有 cards', res.status === 200 && Array.isArray(b.cards), String(res.status));
  ok('A8 已收滿的 track 單位不在板上', !b.cards.some(c => c.unitKeys.includes('tra_sched|縱貫線北段|七堵|臺北')),
    JSON.stringify(b.cards.map(c => c.id)));
  ok('A9 收滿的 dwell 仍在板上（規格 §4：停站點留著、獎勵衰減但不歸零）',
    b.cards.some(c => c.kind === 'dwell'), JSON.stringify(b.cards.map(c => c.id)));
  // A10 過期的 claim 不算人數：種子裡 c2 的 expires_at 已過
  const nh0 = b.cards.find(c => c.id === 'tra_sched|南迴線|0|自強|track|');
  ok('A10 過期的認領不計入 claimers（應為 1 不是 2）', nh0 && nh0.claimers === 1, JSON.stringify(nh0));
  ok('A11 回應帶 coverN 供前端顯示「已有 1/3 趟」', b.coverN && b.coverN.metro === 3, JSON.stringify(b.coverN));
}

// ── B 組：POST /api/bounty-claim ──────────────────────────────────────────
// 🔴 actor 字面值已從 brief 原文的 'dev-x'/'dev-y'/'dev-old'（5/5/7 碼）訂正為
// 'device-x'/'device-y'/'device-old'（8/8/10 碼）：Step 4 的 isActorId 正規表示式下限是
// {8,64}，brief 原文的短助記字串短於下限，逐字照抄會讓 B2/B4/B6/B7/B9 全部卡在 400 bad_actor，
// 測不到真正要驗的情境（B1 因節流檢查在 isActorId 之前短路不受影響；B8 的四個髒輸入案例無論
// actor 長度為何都預期 400，不受影響，但放著不修會讓 B8 變成掩蓋 B2 等真實失敗的巧合通過）。
// 8/8/10 碼與正式環境實測的 actor 長度吻合（index.html:5616 userDataDeviceId()：
// crypto.randomUUID() 36 碼／回退格式 20+ 碼／保底 'ephemeral' 9 碼，三條路徑全部 ≥9 碼）。
// SEED 常數裡的 'dev-a'／'dev-b'（Task 2 既有、直接寫入 D1 的認領列）不受影響——那兩個從未經過
// isActorId（不是任何 B 組測試呼叫 bountyClaim() 時傳入的 b.actor）。B9 的 'uid-1' 也不變——
// 它是 resolveActor 查表後的內部值，同樣從未經過 isActorId。
{
  const { bountyClaim } = _bounty;
  const post = (b, over) => req('/api/bounty-claim', {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...(over || {}) },
    body: JSON.stringify(b),
  });

  // B1 節流擋在任何 D1 寫入之前（判準是「有沒有寫進去」，不是「回不回 429」）
  {
    const { db, DELAY_DB } = openTestDb(SEED);
    const r = await bountyClaim(post({ actor: 'device-x', cardId: 'tra_sched|南迴線|0|自強|track|' }),
      ENV(DELAY_DB, { BOUNTY_LIMITER: limiter(true) }));
    const n = db.prepare('SELECT COUNT(*) c FROM bounty_claims').get().c;
    ok('B1 被節流時回 429 且一列都沒寫進 D1', r.status === 429 && n === 2, `status=${r.status} rows=${n}`);
  }

  // B2 正常認領：把卡展開成單位、鎖當時的點數
  const { db, DELAY_DB } = openTestDb(SEED);
  const r2 = await bountyClaim(post({ actor: 'device-x', cardId: 'tra_sched|南迴線|0|自強|track|' }), ENV(DELAY_DB));
  const b2 = await body(r2);
  ok('B2 回 200、2 個單位、鎖 6 點（測試自己加：3+3）',
    r2.status === 200 && b2.units === 2 && b2.pointsLocked === 6, JSON.stringify(b2));
  ok('B3 24 小時後過期', Math.abs((b2.expiresAt - Date.now()) - 86400000) < 5000, String(b2.expiresAt));

  // B4 鎖價不獨佔：第二個人接同一張卡照樣成功
  const r4 = await bountyClaim(post({ actor: 'device-y', cardId: 'tra_sched|南迴線|0|自強|track|' }), ENV(DELAY_DB));
  const b4 = await body(r4);
  ok('B4 第二人接同一張卡照樣成功（鎖價不鎖獨佔）', r4.status === 200 && b4.units === 2, JSON.stringify(b4));
  ok('B5 回傳「已有 N 人接了這段」', b4.claimers >= 2, String(b4.claimers));

  // B6 鎖價真的鎖住：板上漲價之後，先接的那筆 points_locked 不動
  db.exec("UPDATE bounty_board SET points=99 WHERE seg_key='tra_sched|南迴線|大武|太麻里'");
  const locked = db.prepare("SELECT points_locked FROM bounty_claims WHERE actor='device-x' AND seg_key='tra_sched|南迴線|大武|太麻里'").get();
  ok('B6 事後漲價不影響已鎖的價', locked && locked.points_locked === 3, JSON.stringify(locked));

  // B7 已收滿的 track 單位不可認領
  const r7 = await bountyClaim(post({ actor: 'device-x', cardId: 'tra_sched|縱貫線北段|0|區間|track|' }), ENV(DELAY_DB));
  ok('B7 已收滿的卡回 404', r7.status === 404, String(r7.status));

  // B8 髒輸入不打 D1
  for (const bad of [{ actor: 'device-x' }, { cardId: 'tra_sched|南迴線|0|自強|track|' }, { actor: '../../etc', cardId: 'tra_sched|南迴線|0|自強|track|' },
    { actor: 'device-x', cardId: 'not-a-card' }]) {
    const rr = await bountyClaim(post(bad), ENV(DELAY_DB));
    ok('B8 髒輸入回 400 — ' + JSON.stringify(bad), rr.status === 400, String(rr.status));
  }

  // B9 resolveActor：合併過的 device token 寫入要轉向 uid
  {
    const { DELAY_DB: DB2, db: db2 } = openTestDb(SEED + `
      INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES ('device-old',NULL,0,'uid-1',1700000000000);
      INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES ('uid-1','uid-1',5,NULL,1700000000000);`);
    await bountyClaim(post({ actor: 'device-old', cardId: 'tra_sched|南迴線|0|自強|track|' }), ENV(DB2));
    const who = db2.prepare("SELECT DISTINCT actor FROM bounty_claims WHERE seg_key='tra_sched|南迴線|大武|枋寮'").all().map(x => x.actor);
    ok('B9 合併過的 token 認領記在 uid 名下', who.includes('uid-1') && !who.includes('device-old'), who.join(','));
  }
}

// ── C 組：POST /api/bounty-submit ─────────────────────────────────────────
{
  const { bountySubmit, hasGeoKeys, sanitizeSamples } = _bounty;
  const post = b => req('/api/bounty-submit', {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
    body: JSON.stringify(b),
  });
  // 🔴 actor 字面值已從 brief 原文的 'dev-x'（5 碼）訂正為 'device-x'（8 碼）：isActorId 的長度
  // 下限是 {8,64}（Task 3 建立），brief 原文的短助記字串短於下限，逐字照抄會讓 C4/C5/C7 卡在
  // 400 bad_actor（已實測確認，見 task-4-report.md）。與 Task 3 的 B 組是同一類、不同處的矛盾，
  // 同一種修法：只動字面值長度，不動任何斷言邏輯或 isActorId 本身。
  const OKBODY = {
    actor: 'device-x', sys: 'TRA', lnId: 'NH', trainNo: '312', dir: 0, tripDate: '2026-07-28', batch: 1,
    samples: [{ d: 1000, t: 30000, v: 25, acc: 8 }, { d: 1025, t: 30001, v: 25.1, acc: 9 }],
  };

  // C1 經緯度掃描是正向掃 key，不是抽查特定欄位（規格 §11）
  ok('C1 hasGeoKeys 抓得到各種寫法', [
    { lat: 25 }, { lon: 121 }, { latitude: 25 }, { longitude: 121 }, { coords: { latitude: 25 } },
    [{ a: 1 }, { LAT: 25 }], { deep: { deeper: [{ lng: 121 }] } },
  ].every(hasGeoKeys) && !hasGeoKeys({ d: 1, t: 2, v: 3, acc: 4 }));

  // C2 sanitizeSamples 只留四個欄位，多的直接丟（不是保留、不是報錯）
  {
    const r = sanitizeSamples([{ d: 1, t: 2, v: 3, acc: 4, lat: 25, note: 'x' }, { d: 'bad' }, { d: 5, t: 6, v: 7, acc: 8 }], 100);
    ok('C2 只留 d/t/v/acc 且丟掉壞列',
      r.samples.length === 2 && JSON.stringify(Object.keys(r.samples[0]).sort()) === '["acc","d","t","v"]' && r.dropped === 1,
      JSON.stringify(r));
  }

  const { db, DELAY_DB } = openTestDb(SEED);

  // C0 router entry 真的接上（驗收條件 3）：不透過 _bounty.bountySubmit() 直接呼叫，改走完整
  // worker.fetch() 的路由分派——這裡故意送一個必然在 bountySubmit() 內部驗證第一關就失敗的
  // body（actor 空字串），斷言回應是 bountySubmit() 自己的 JSON 錯誤碼 bad_actor。
  // 為什麼這樣就能證明「真的接上」：405 白名單（API_POST_ALLOWED）Task 3 已經放行這個路徑，
  // 不會卡在那關；若 router 那行 else-if 沒接上，會落到 `else res = await env.ASSETS.fetch(request)`
  // ——這裡的 env 沒有提供 ASSETS，對 undefined 呼叫 .fetch 會直接拋例外，測試會整個崩潰而不是
  // 拿到一個乾淨的 400 JSON。「沒有拋例外、且錯誤碼精確等於 bad_actor（不是隨便一個 4xx）」
  // 兩者合起來才是真正命中 bountySubmit() 的證據。
  {
    const r = await worker.fetch(req('/api/bounty-submit', {
      method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
      body: JSON.stringify({ ...OKBODY, actor: '' }),
    }), {});
    const b = await body(r);
    ok('C0 router entry 真的接上：完整 worker.fetch() 路由分派命中 bountySubmit()，不是掉到 405 或資產層 fallback',
      r.status === 400 && b.error === 'bad_actor', JSON.stringify({ status: r.status, body: b }));
  }

  // C3 節流擋在 D1 寫入之前
  {
    const r = await bountySubmit(post(OKBODY), ENV(DELAY_DB, { BOUNTY_LIMITER: limiter(true) }));
    const n = db.prepare('SELECT COUNT(*) c FROM bounty_samples').get().c;
    ok('C3 被節流時回 429 且零寫入', r.status === 429 && n === 0, `status=${r.status} rows=${n}`);
  }

  // C4 正常上傳
  {
    const r = await bountySubmit(post(OKBODY), ENV(DELAY_DB));
    const b = await body(r);
    const row = db.prepare('SELECT * FROM bounty_samples').get();
    ok('C4 回 200、verdict=pending、寫進一列',
      r.status === 200 && b.verdict === 'pending' && b.accepted === 2 && row && row.verdict === 'pending',
      JSON.stringify({ s: r.status, b, row: row && row.id }));
    ok('C5 payload 裡沒有任何經緯度欄位（正向掃存進 D1 的那份字串）',
      row && !hasGeoKeys(JSON.parse(row.payload)) && !/lat|lon|lng/i.test(row.payload), String(row && row.payload).slice(0, 80));
  }

  // C6 夾帶座標一律 400，且不寫任何一列
  {
    const before = db.prepare('SELECT COUNT(*) c FROM bounty_samples').get().c;
    const r = await bountySubmit(post({ ...OKBODY, samples: [{ d: 1, t: 2, v: 3, acc: 4, latitude: 25.04 }] }), ENV(DELAY_DB));
    const after = db.prepare('SELECT COUNT(*) c FROM bounty_samples').get().c;
    ok('C6 夾帶座標回 400 且零寫入', r.status === 400 && before === after, `status=${r.status}`);
  }

  // C7 同一趟的第二批獨立成列（斷線時已傳出去的不會丟＝部分覆蓋也計點的前提）
  {
    await bountySubmit(post({ ...OKBODY, batch: 2, samples: [{ d: 2000, t: 30060, v: 26, acc: 7 }] }), ENV(DELAY_DB));
    const rows = db.prepare("SELECT id FROM bounty_samples WHERE actor='device-x' AND trip_date='2026-07-28' AND train_no='312'").all();
    ok('C7 兩批各一列，靠 (actor,trip_date,train_no) 併回同一趟', rows.length === 2, String(rows.length));
  }

  // C8 髒輸入與超量
  for (const [name, b] of [
    ['沒有 actor', { ...OKBODY, actor: '' }],
    ['車次號有奇怪字元', { ...OKBODY, trainNo: '../x' }],
    ['日期格式不對', { ...OKBODY, tripDate: '2026/07/28' }],
    ['samples 不是陣列', { ...OKBODY, samples: 'x' }],
    ['samples 空陣列', { ...OKBODY, samples: [] }],
    ['一批塞五千筆', { ...OKBODY, samples: Array.from({ length: 5000 }, (_, i) => ({ d: i, t: i, v: 1, acc: 1 })) }],
  ]) {
    const r = await bountySubmit(post(b), ENV(DELAY_DB));
    ok('C8 ' + name + ' → 400', r.status === 400, String(r.status));
  }

  // ── 驗收條件 4（硬要求）：值形狀判準，不是 key 名稱判準 ────────────────────
  // hasGeoKeys 是「已知 key 名」的黑名單（C1/C5/C6 驗的是這一層）。C9/C10 要證明的是另一層、
  // 不依賴 key 名稱的防線：即使座標換了個 hasGeoKeys 認不出來的 key 名字（甚至塞進陣列），
  // 真正落進 D1 的資料裡仍然找不到「看起來像座標」的數值形狀。
  //
  // 判準只看「同一個物件或同一個陣列裡，有沒有一個數字落在台灣緯度(21.5–25.5)、同時有另一個
  // 數字落在台灣經度(119.5–122.5)」——用「一緯一經同時出現」當條件，不是「單一數字落在任一
  // 區間」。理由：後者會對合法資料假陽性——OKBODY 自己的 v:25／v:25.1（正常車速 90/90.4km/h）
  // 就剛好落在緯度區間，d/v/acc 的合法值域本來就會自然跟座標區間重疊(25m/s 是正常速度、
  // 22 公尺是正常精度或短區間距離)。「一緯一經同時出現」才是「這是座標」唯一站得住腳的證據，
  // 也正是規格 §11 舉的 {a:24.1, b:121.5} 範例的形狀。
  const TW_LAT = v => typeof v === 'number' && Number.isFinite(v) && v >= 21.5 && v <= 25.5;
  const TW_LON = v => typeof v === 'number' && Number.isFinite(v) && v >= 119.5 && v <= 122.5;
  function scanCoordPairs(node) {
    const hits = [];
    const walk = (v, p) => {
      if (v == null || typeof v !== 'object') return;
      const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x]) : Object.entries(v);
      const nums = entries.filter(([, val]) => typeof val === 'number');
      if (nums.some(([, val]) => TW_LAT(val)) && nums.some(([, val]) => TW_LON(val)))
        hits.push({ path: p.join('.') || '(root)', nums: nums.map(([k, val]) => `${k}=${val}`) });
      for (const [k, val] of entries) walk(val, p.concat(k));
    };
    walk(node, []);
    return hits;
  }
  // C8b 掃描器自檢：先證明它不會對合法資料假陽性、也真的抓得到規格舉例的攻擊形狀——
  // 否則下面 C9b/C10b 的「零命中」證明不了任何事（可能只是掃描器本身是瞎的）。
  ok('C8b 值形狀掃描器自檢：合法 OKBODY.samples 零命中（v:25/25.1 不該被單獨當座標），規格範例攻擊形狀抓得到',
    scanCoordPairs(OKBODY.samples).length === 0 && scanCoordPairs({ a: 24.1, b: 121.5 }).length === 1,
    JSON.stringify({ legit: scanCoordPairs(OKBODY.samples), attack: scanCoordPairs({ a: 24.1, b: 121.5 }) }));

  // C9 座標對藏在 hasGeoKeys 認不出來的 key 名底下（a/b，不是 lat/lon 系列字樣），且藏在
  // samples[i] 物件裡，與合法的 d/t/v/acc 同一層。
  {
    const c9Body = { ...OKBODY, batch: 10, samples: [{ d: 500, t: 100, v: 10, acc: 5, a: 24.1, b: 121.5 }] };
    ok('C9 前提：偽裝過的座標對真的騙得過 hasGeoKeys（證明「只擋已知 key 名」這層不夠，見上方理由）',
      hasGeoKeys(c9Body) === false, String(hasGeoKeys(c9Body)));
    const r = await bountySubmit(post(c9Body), ENV(DELAY_DB));
    const b = await body(r);
    ok('C9a 因此這包被接受（200），不是被 hasGeoKeys 擋下——後面才驗證真正的防線在哪',
      r.status === 200, JSON.stringify(b));
    const row = b.id && db.prepare('SELECT payload FROM bounty_samples WHERE id=?').get(b.id);
    const hits = row ? scanCoordPairs(JSON.parse(row.payload)) : [{ path: '(查無此列，異常)' }];
    ok('C9b 值形狀掃描：即使騙過 hasGeoKeys，真正寫進 D1 的 payload 裡仍找不到座標對' +
      '（靠 sanitizeSamples 的正向白名單擋下——a/b 不在 d/t/v/acc 之列，進不了 D1）',
      hits.length === 0, JSON.stringify(hits));
  }

  // C10 座標對塞在陣列裡、藏在一個不像座標的根層欄位名（extra）底下（規格 §11 原話
  // 「塞在陣列裡就漏了」）：hasGeoKeys 對陣列只遞迴陣列「元素」，元素若本身就是原始數字
  // （不是物件），迴圈一進去就因 typeof !== 'object' 直接返回 false，等於沒掃到。
  {
    const c10Body = { ...OKBODY, batch: 11, extra: [24.1, 121.5] };
    ok('C10 前提：陣列包原始數字的座標對，一樣騙得過 hasGeoKeys',
      hasGeoKeys(c10Body) === false, String(hasGeoKeys(c10Body)));
    const r = await bountySubmit(post(c10Body), ENV(DELAY_DB));
    const b = await body(r);
    ok('C10a 因此這包被接受（200）', r.status === 200, JSON.stringify(b));
    const row = b.id && db.prepare('SELECT payload FROM bounty_samples WHERE id=?').get(b.id);
    const hits = row ? scanCoordPairs(JSON.parse(row.payload)) : [{ path: '(查無此列，異常)' }];
    ok('C10b 值形狀掃描：extra 欄位整個沒有被讀取／寫入（bountySubmit 的 INSERT 語句只認得白名單' +
      '欄位，extra 從未被引用），D1 裡零座標對',
      hits.length === 0, JSON.stringify(hits));
  }
}

// ── I 組：GET /api/bounty-me ──────────────────────────────────────────────
// 🔴 actor 字面值已從 brief 原文的 'dev-x'（5 碼）訂正為 'device-x'（8 碼）：與 Task 3／Task 4
// 同一類、第三次獨立踩到的矛盾——isActorId 的長度下限是 {8,64}，brief 原文的短助記字串短於
// 下限。已實測 RED 證據（訂正前）：I1 回 400 bad_actor（不是 200），I2 因此崩潰——
// `TypeError: Cannot read properties of undefined (reading 'filter')`（b.trips 不存在，因為
// bountyMe 在 isActorId 這關就短路回傳 {error:'bad_actor'}）。修法比照 Task 3/4：只動字面值
// 長度，不動任何斷言邏輯或 isActorId 本身。I8 的 '../x' 維持不變——那是測字元集合不合法，
// 不論長度門檻在哪都預期 400。
{
  const { bountyMe } = _bounty;
  const { DELAY_DB } = openTestDb(`
    INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES ('device-x',NULL,42,NULL,1700000000000);
    INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,segs,submitted_at,verdict,verdict_at,quality_code,reject_code) VALUES
     ('m1','device-x','tra_sched','南迴線','312',0,'2026-07-28','[]','[{"key":"tra_sched|南迴線|A|B","cov":1},{"key":"tra_sched|南迴線|B|C","cov":1}]',1,'ok',2,NULL,NULL),
     ('m2','device-x','tra_sched','南迴線','313',0,'2026-07-27','[]','[{"key":"tra_sched|南迴線|C|D","cov":0.9}]',1,'unusable',2,'acc_blocked',NULL),
     ('m3','device-x','tra_sched','縱貫線北段','101',0,'2026-07-26','[]','[]',1,'suspect',2,NULL,'doppler_too_clean');`);

  const r = await bountyMe(req('/api/bounty-me?actor=device-x'), ENV(DELAY_DB));
  const b = await body(r);
  ok('I1 回 200 與點數', r.status === 200 && b.points === 42, JSON.stringify({ s: r.status, p: b.points }));
  // 護照那句「校正 12 段（其中 9 段已採用）」：分子分母是**段**不是**趟**
  ok('I2 corrected 數的是段：3 段校正（ok 2 + unusable 1）、2 段已採用',
    b.corrected && b.corrected.segs === 3 && b.corrected.adopted === 2, JSON.stringify(b.corrected));
  ok('I3 suspect 不計入付出（那一筆沒排除作弊，章本來就沒給）',
    b.trips.filter(t => t.verdict === 'suspect').length === 1 && b.corrected.segs === 3, JSON.stringify(b.corrected));
  ok('I4 unusable 那筆帶得出「原因＋怎麼改善」的文案',
    (b.trips.find(t => t.id === 'm2') || {}).quality &&
    b.trips.find(t => t.id === 'm2').quality.title && b.trips.find(t => t.id === 'm2').quality.how,
    JSON.stringify((b.trips.find(t => t.id === 'm2') || {}).quality));
  ok('I5 逐線統計（校正者印章是路線專屬的）',
    Array.isArray(b.lines) && b.lines.some(l => l.lnId === '南迴線' && l.segs === 3), JSON.stringify(b.lines));

  // 🔴 I6 正向掃整包回應的所有字串，不是抽查特定欄位（規格 §11）
  {
    const raw = JSON.stringify(b);
    const leaked = ['doppler_too_clean', 'impossible_physics', 'delay_mismatch', 'future_date', 'stale_date']
      .filter(code => raw.includes(code));
    ok('I6 整包回應不含任何 reject_code 的值', leaked.length === 0, leaked.join(','));
    ok('I7 也不含 reject_code 這個欄位名（免得日後有人手滑把整列 SELECT * 丟出去）',
      !raw.includes('reject'), raw.slice(0, 120));
  }
  ok('I8 髒 actor 回 400', (await bountyMe(req('/api/bounty-me?actor=../x'), ENV(DELAY_DB))).status === 400);

  // I9 掃描器自檢（比照 Task 4 的 C8b，驗收條件 4 硬要求）：I6/I7 用的是「整包 JSON.stringify
  // 後字串搜尋」這個機制本身——不是一個獨立函式，所以自檢直接對「刻意構造的洩漏樣本」跑同一套
  // 掃法，證明零命中不是因為掃描器是瞎的。兩種藏法都要驗：(a) 特徵值被塞進深層巢狀欄位或跟其他
  // 文字拼接（I6 那種「掃值」的自檢）；(b) 藏著 reject 這個字樣本身，包含被塞進一個看起來無害的
  // 欄位名或訊息字串（I7 那種「掃欄位名／字樣」的自檢）。
  {
    const leakyValue = { ok: true, nested: { deeper: [{ note: 'debug hint: doppler_too_clean happened here' }] } };
    const rawLeakyValue = JSON.stringify(leakyValue);
    const leakedValue = ['doppler_too_clean', 'impossible_physics', 'delay_mismatch', 'future_date', 'stale_date']
      .filter(code => rawLeakyValue.includes(code));
    ok('I9a 自檢（對應 I6）：刻意藏進巢狀欄位＋拼接文字裡的 reject_code 特徵值，同一套掃法真的抓得到',
      leakedValue.length === 1 && leakedValue[0] === 'doppler_too_clean', JSON.stringify(leakedValue));

    const leakyKey = { ok: true, debugInfo: { rejectCodeHint: 'x' } };
    const rawLeakyKey = JSON.stringify(leakyKey);
    ok('I9b 自檢（對應 I7）：刻意藏進看似無害的巢狀欄位名（rejectCodeHint）裡的 "reject" 字樣，同一套掃法真的抓得到',
      rawLeakyKey.includes('reject'), rawLeakyKey);

    // 反向對照：確認這套掃法對「真的乾淨」的樣本不會誤報（不是掃太寬、隨便什麼都算命中）
    const cleanSample = JSON.stringify({ ok: true, quality: { code: 'acc_blocked', title: '訊號被遮蔽了' } });
    const cleanLeaked = ['doppler_too_clean', 'impossible_physics', 'delay_mismatch', 'future_date', 'stale_date']
      .filter(code => cleanSample.includes(code));
    ok('I9c 反向對照：不含任何 reject_code 特徵值／reject 字樣的乾淨樣本，掃描結果真的是零命中（不是誤報帶來的假陽性）',
      cleanLeaked.length === 0 && !cleanSample.includes('reject'), cleanSample);
  }
}

// ── J 組：POST /api/bounty-merge ──────────────────────────────────────────
{
  const { bountyMerge } = _bounty;
  // Firebase 替身：lookup 回一個固定 uid。🔴 驗收條件 5：全程零真實網路——worker.js 沒有任何
  // import，所有 fetch(...) 呼叫點都是解析到 globalThis.fetch 的裸識別字（比照
  // scripts/verify_rate_limit.mjs 已驗證過的同一套技巧），這裡額外記錄每次呼叫的網址與次數，
  // 不只是覆寫掉而已——次數與網址都要能斷言，零命中或命中到非預期網址都要能被抓到。
  const realFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url));
    return new Response(JSON.stringify({ users: [{ localId: 'uid-777' }] }), { status: 200 });
  };
  const post = (b, tok) => req('/api/bounty-merge', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
    body: JSON.stringify(b),
  });
  const FB = { FIREBASE_WEB_API_KEY: 'k', AUTH_LIMITER: limiter(false) };

  const { db, DELAY_DB } = openTestDb(`
    INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES ('dev-mine',NULL,30,NULL,1);
    INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES ('uid-777','uid-777',5,NULL,1);`);

  ok('J1 沒帶 token 回 401', (await bountyMerge(post({ actor: 'dev-mine' }), ENV(DELAY_DB, FB))).status === 401);
  ok('J1b 沒帶 token 時 firebaseUid 完全沒被呼叫（isActorId 通過但 auth 沒有 Bearer，短路在打 Firebase 之前）',
    fetchCalls.length === 0, JSON.stringify(fetchCalls));
  ok('J2 髒 actor 回 400', (await bountyMerge(post({ actor: '../x' }, 'tok'), ENV(DELAY_DB, FB))).status === 400);
  ok('J2b 髒 actor 短路在 isActorId，同樣沒有打到 Firebase（即使帶了 token）',
    fetchCalls.length === 0, JSON.stringify(fetchCalls));

  const r3 = await bountyMerge(post({ actor: 'dev-mine' }, 'tok'), ENV(DELAY_DB, FB));
  const b3 = await body(r3);
  const uidRow = () => db.prepare("SELECT * FROM bounty_points WHERE actor='uid-777'").get();
  const devRow = () => db.prepare("SELECT * FROM bounty_points WHERE actor='dev-mine'").get();
  ok('J3 合併後 uid 拿到 35 點（5+30，測試自己加）',
    r3.status === 200 && b3.points === 35 && uidRow().points === 35, JSON.stringify({ s: r3.status, b3, u: uidRow() }));
  ok('J4 來源列歸零並標上 merged_into',
    devRow().points === 0 && devRow().merged_into === 'uid-777', JSON.stringify(devRow()));

  const r5 = await bountyMerge(post({ actor: 'dev-mine' }, 'tok'), ENV(DELAY_DB, FB));
  const b5 = await body(r5);
  ok('J5 重複合併不重複計點（冪等）', r5.status === 200 && uidRow().points === 35 && b5.merged === false,
    JSON.stringify({ u: uidRow(), b5 }));

  ok('J6 沒有點數的裝置也能合併（第一次登入的正常情況）',
    (await bountyMerge(post({ actor: 'dev-fresh' }, 'tok'), ENV(DELAY_DB, FB))).status === 200);
  ok('J7 合併後 resolveActor 會把該 token 的寫入轉向 uid',
    (await _bounty.resolveActor(ENV(DELAY_DB, FB), 'dev-mine')) === 'uid-777');

  // J8（我方補寫，對應驗收條件 4「router entry 真的接上」）：brief 給的 J1–J7 全部透過
  // _bounty.bountyMerge() 直接呼叫，從未走過 worker.fetch() 的路由分派，測不到 router 那行
  // else-if 有沒有真的接上（比照 Task 4 的 C0／Task 7 的 I9 慣例，補一個獨立案例）。這裡故意
  // 送一個必然在 bountyMerge() 內部驗證第一關（isActorId）就失敗的 body（actor 空字串），
  // env 刻意不給 ASSETS：若 router 那行沒接上，會落到 `else res = await env.ASSETS.fetch(request)`
  // ——對 undefined 呼叫 .fetch 會直接拋例外讓整支測試崩潰，不會拿到一個乾淨的 400 JSON。
  // 「沒有拋例外、且錯誤碼精確等於 bad_actor（不是隨便一個 4xx，例如 404 或 405）」兩者合起來
  // 才是真正命中 bountyMerge() 的證據。
  {
    const r = await worker.fetch(req('/api/bounty-merge', {
      method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
      body: JSON.stringify({ actor: '' }),
    }), {});
    const b = await body(r);
    ok('J8 router entry 真的接上：完整 worker.fetch() 路由分派命中 bountyMerge()，不是掉到 404 或資產層 fallback',
      r.status === 400 && b.error === 'bad_actor', JSON.stringify({ status: r.status, body: b }));
  }

  // J9（我方補寫，對應驗收條件 3「冪等性要用連續呼叫兩次的實測證明」硬要求的完整範圍）：
  // brief 給的 J3–J5 只驗證了 bounty_points 的點數冪等；驗收條件 3 明文還要求
  // 「bounty_samples 筆數、bounty_claims 筆數在第二次呼叫前後完全相同」——這兩張表 J1–J7 完全
  // 沒碰。用獨立種子資料（新開一個 DELAY_DB，不與 J1–J7 共用，避免互相污染）直接驗證：
  // 種子先塞兩筆 bounty_samples／一筆 bounty_claims（actor='dev-mine2'），呼叫兩次
  // bountyMerge，比較兩次呼叫「後」的快照（點數總和／樣本列數／認領列數）是否完全相同。
  {
    const { db: db9, DELAY_DB: DB9 } = openTestDb(`
      INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES ('dev-mine2',NULL,10,NULL,1);
      INSERT INTO bounty_samples (id,actor,sys,ln_id,train_no,dir,trip_date,payload,submitted_at,verdict) VALUES
        ('js1','dev-mine2','tra_sched','南迴線','312',0,'2026-07-28','[]',1,'pending'),
        ('js2','dev-mine2','tra_sched','南迴線','313',0,'2026-07-27','[]',1,'pending');
      INSERT INTO bounty_claims (id,actor,seg_key,train_kind,dir,kind,slot,points_locked,claimed_at,expires_at,status) VALUES
        ('jc1|0','dev-mine2','tra_sched|南迴線|大武|太麻里','自強',0,'track','',3,1,1799999999999,'open');`);
    const snapshot = () => ({
      pointsSum: db9.prepare('SELECT COALESCE(SUM(points),0) s FROM bounty_points').get().s,
      samples: db9.prepare('SELECT COUNT(*) c FROM bounty_samples').get().c,
      claims: db9.prepare('SELECT COUNT(*) c FROM bounty_claims').get().c,
    });

    const r1 = await bountyMerge(post({ actor: 'dev-mine2' }, 'tok'), ENV(DB9, FB));
    const b1 = await body(r1);
    const snap1 = snapshot();
    ok('J9a 第一次呼叫成功搬動 bounty_samples／bounty_claims 的 actor（前提：搬動真的發生了，不是原本就沒東西可搬）',
      r1.status === 200 && b1.merged === true &&
      db9.prepare("SELECT COUNT(*) c FROM bounty_samples WHERE actor='uid-777'").get().c === 2 &&
      db9.prepare("SELECT COUNT(*) c FROM bounty_claims WHERE actor='uid-777'").get().c === 1,
      JSON.stringify({ b1, snap1 }));

    const r2 = await bountyMerge(post({ actor: 'dev-mine2' }, 'tok'), ENV(DB9, FB));
    const b2 = await body(r2);
    const snap2 = snapshot();
    ok('J9b 連續呼叫第二次：狀態 200、merged=false，且點數總和／bounty_samples 筆數／bounty_claims 筆數三者與第一次呼叫後完全相同（驗收條件 3 硬要求）',
      r2.status === 200 && b2.merged === false &&
      snap2.pointsSum === snap1.pointsSum && snap2.samples === snap1.samples && snap2.claims === snap1.claims,
      JSON.stringify({ snap1, snap2, b2 }));
  }

  // J10（驗收條件 5：全程零真實網路的最終斷言）：整個 J 區塊結束前，累計的 fetchCalls 應該
  // 恰好等於「有帶 token 且 actor 通過 isActorId」的呼叫次數（J3/J5/J6/J9a/J9b 共 5 次；
  // J1/J2/J8 因短路不打 Firebase，已各自在上方即時斷言為 0），且每一次都命中預期的
  // identitytoolkit 端點——不是 0（證明 mock 真的被跑到，不是死程式碼）、也沒有命中任何其他
  // 網址（證明沒有意外打到真實端點或其他上游）。這支腳本從頭到尾只有這裡改寫過
  // globalThis.fetch，離開這個區塊前才復原，架構上 realFetch 在此之前不可能被任何程式碼路徑
  // 呼叫到——這裡的斷言是「反面驗證」：如果真的不慎打到真網路，網址不會是 identitytoolkit
  // 假網址返回的固定字串，命中數與網址其中一項就會不符而崩潰測試。
  ok('J10 全程零真實網路：5 次 Firebase 查 uid 呼叫全部命中假的 globalThis.fetch（identitytoolkit 端點），次數精確吻合「有 token 且 actor 合法」的呼叫次數',
    fetchCalls.length === 5 && fetchCalls.every(u => u.includes('identitytoolkit.googleapis.com')),
    JSON.stringify(fetchCalls));

  globalThis.fetch = realFetch;
  ok('J11 離開區塊後 globalThis.fetch 已還原成真正的 fetch（後續測試／腳本收尾不會繼續被假掉）',
    globalThis.fetch === realFetch, String(globalThis.fetch === realFetch));
}

const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
