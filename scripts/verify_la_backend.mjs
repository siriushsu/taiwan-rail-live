// LA 後端驗收。本檔【不打正式站】,一律對本機 wrangler dev 跑。
// 起 server 的指令見計畫 Task 4 Step 3;埠由呼叫端指定並傳進 LA_BASE。
const BASE = process.env.LA_BASE;
// 🔴 base 必須是 https(worker.js 有 http→https 301,純 http 會讓所有 /api/* 無限重導),
//    且呼叫端要帶 NODE_TLS_REJECT_UNAUTHORIZED=0(本機自簽憑證)。起 server 的完整方式見計畫 Task 4 Step 3。
if (!BASE) { console.error('請設 LA_BASE=https://127.0.0.1:<port>'); process.exit(2); }
if (!BASE.startsWith('https://')) { console.error('LA_BASE 必須是 https,純 http 會被 301 無限重導'); process.exit(2); }
const results = [];
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };
const post = (path, body, hdr = {}) => fetch(BASE + path, {
  method: 'POST', headers: { 'content-type': 'application/json', ...hdr }, body: JSON.stringify(body),
});
const AUTH = { authorization: 'Bearer LA-LOCAL-TEST' };   // 對上 .dev.vars 的 LA_TEST_BEARER
const VALID = {
  token: 'ab'.repeat(32), sys: 'tra_sched', trainNo: '554',
  // at 是絕對 epoch 秒,且必須在現在前後一天內(端點會擋)——所以測資從 now 算,不寫死
  stops: [{ name: '潮州', at: Math.floor(Date.now() / 1000) + 600 },
          { name: '屏東', at: Math.floor(Date.now() / 1000) + 2040 }],
  staMap: { 5050: 1 }, stopCodes: ['5050', '5000'],
};

// ── 測試旁路的閘門必須【兩側都驗】,否則旗標機制一改,轉紅的會是散落各處的前置條件 ──
// B0 正向:旁路開著時,正確的 bearer 進得來(這條同時是 B1/B2 的正向對照)
{
  const r = await post('/api/la/bind', VALID, AUTH);
  ok('B0 齊備＋有效身分 → 200', r.status === 200, `HTTP ${r.status}`);
}
// B1 反向:完全不帶 authorization → 擋
{
  const r = await post('/api/la/bind', VALID);
  ok('B1 未帶 authorization 被拒', r.status === 401 || r.status === 403, `HTTP ${r.status}`);
}
// B2 反向:帶了但值不對 → 擋(證明旁路認的是值,不是「有沒有這個 header」)
{
  const r = await post('/api/la/bind', VALID, { authorization: 'Bearer WRONG' });
  ok('B2 錯誤 bearer 被拒', r.status === 401 || r.status === 403, `HTTP ${r.status}`);
}
// B3 欄位不全 → 400(與 B0 同身分,所以差異只可能來自欄位檢查)
{
  const r = await post('/api/la/bind', { token: VALID.token }, AUTH);
  ok('B3 欄位不全的 bind 被拒', r.status === 400, `HTTP ${r.status}`);
}
// B4 token 格式不對 → 400
{
  const r = await post('/api/la/bind', { ...VALID, token: 'nope' }, AUTH);
  ok('B4 token 格式錯被拒', r.status === 400, `HTTP ${r.status}`);
}
// B5 不支援的系統 → 400(台鐵/高鐵以外不收,避免默默收下一張永遠推不動的卡)
{
  const r = await post('/api/la/bind', { ...VALID, sys: 'trtc_live' }, AUTH);
  ok('B5 不支援的 sys 被拒', r.status === 400, `HTTP ${r.status}`);
}
// B6 at 離現在超過一天 → 400(擋掉「服務日算錯整整差一天」那類壞資料)
{
  const far = { ...VALID, stops: VALID.stops.map(s => ({ ...s, at: s.at + 86400 * 2 })) };
  const r = await post('/api/la/bind', far, AUTH);
  ok('B6 at 離現在太遠被拒', r.status === 400, `HTTP ${r.status}`);
}
// B9 stops 序列化超過大小上限 → 400(筆數上限只界定陣列長度,單一欄位仍可能被塞爆;
// 只改 name 長度,shape/count/時間範圍都維持合法,隔離出「只有大小上限這條斷言」在擋)
{
  const bigStops = [{ ...VALID.stops[0], name: 'X'.repeat(12500) }, VALID.stops[1]];
  const r = await post('/api/la/bind', { ...VALID, stops: bigStops }, AUTH);
  ok('B9 stops 序列化超過大小上限被拒', r.status === 400, `HTTP ${r.status}`);
}
// B10 staMap 鍵數超過上限 → 400(鍵多但單筆值小,JSON 總大小仍遠小於 8000,
// 隔離出「鍵數」與下面 B11「序列化大小」是兩條獨立斷言,不是同一條檢查的兩個名字)
{
  const manyKeysMap = {};
  for (let i = 0; i <= 400; i++) manyKeysMap[String(i)] = 1;   // 401 筆
  const r = await post('/api/la/bind', { ...VALID, staMap: manyKeysMap }, AUTH);
  ok('B10 staMap 鍵數超過上限被拒', r.status === 400, `HTTP ${r.status}`);
}
// B11 staMap 序列化超過大小上限 → 400(鍵數僅 1,不會被 B10 那條鍵數上限擋到)
{
  const bigValueMap = { '5050': 'X'.repeat(8500) };
  const r = await post('/api/la/bind', { ...VALID, staMap: bigValueMap }, AUTH);
  ok('B11 staMap 序列化超過大小上限被拒', r.status === 400, `HTTP ${r.status}`);
}
// B12 stopCodes 序列化超過大小上限 → 400(筆數仍等於 stops.length,不會被筆數檢查擋到)
{
  const bigStopCodes = ['X'.repeat(4500), VALID.stopCodes[1]];
  const r = await post('/api/la/bind', { ...VALID, stopCodes: bigStopCodes }, AUTH);
  ok('B12 stopCodes 序列化超過大小上限被拒', r.status === 400, `HTTP ${r.status}`);
}
// B13 同一 token 重複 bind、換不同車次 → 200(驗 upsert 路徑而非只測到 B0 那種首次 insert;
// 依賴 B0 已先綁定過 VALID.token——腳本本來就依序執行,B8 的冪等測試也同樣依賴 B0 的綁定存在。
// 必須排在 B8 之前:B8 會把 VALID.token 從表裡刪掉,順序反了這裡測到的就是首次 insert 不是 upsert)
{
  const r = await post('/api/la/bind', { ...VALID, trainNo: '999' }, AUTH);
  ok('B13 同 token 重複 bind 換車次 → 200', r.status === 200, `HTTP ${r.status}`);
}
// B7 GET 打 bind → 405(端點只收 POST;順帶證明 API_POST_ALLOWED 真的有掛上)
{
  const r = await fetch(BASE + '/api/la/bind');
  ok('B7 GET 打 bind 回 405', r.status === 405, `HTTP ${r.status}`);
}
// B8 unbind 冪等(重複送不報錯)
{
  const a = await post('/api/la/unbind', { token: VALID.token });
  const b = await post('/api/la/unbind', { token: VALID.token });
  ok('B8 unbind 冪等', a.status === 200 && b.status === 200, `${a.status}/${b.status}`);
}

const bad = results.filter(r => !r.p).length;
console.log(`\n總計 ${results.length} 項,FAIL ${bad}`);
process.exit(bad ? 1 : 0);
