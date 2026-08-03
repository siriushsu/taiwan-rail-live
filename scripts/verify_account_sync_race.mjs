// Task 6(C-2:登出競態讓前一帳號資料寫回並污染下一帳號)行為驗證——Playwright 真引擎 + 本機靜態伺服器。
// 本腳本未參與實作;以下是我從 index.html 讀出、供本腳本判準依據的關鍵事實:
//
//   · accountSyncNow(reason) 現在只做閘門與序列化,實際交易邏輯拆到 accountSyncTxn(reason,myGen,myUid):
//     - a.loggingOut(由 accountSignOut() 設定)擋掉登出流程期間任何非登出的新同步。
//     - a.syncing 為真時:非登出呼叫維持原行為直接放棄;登出呼叫改成 `await a.syncPromise`
//       等既有同步做完,再自己補做最後一次——不會被 a.syncing 讓最後同步被靜默跳過。
//     - accountSyncTxn 在 Firestore 交易解決後、userDataWrite 之前重新比對
//       `a.gen !== myGen || !a.user || a.user.uid !== myUid`,對不上就丟棄結果(return false,
//       不寫本機)。a.gen 由 accountClearLocal()(每次登出/清本機)與 onAuthStateChanged 的每次
//       身分變動遞增。
//   · accountSignOut() 登出前先記下 uid、設 a.loggingOut=true、清掉 a.syncTimer,
//     await accountSyncNow('logout') 之後才呼叫 accountClearLocal(uid) 清本機。
//   · accountClearLocal(uid) 現在吃明確的 uid 參數(呼叫端負責在 onAuthStateChanged 把
//     state.account.user 設回 null 之前就決定好),依 uid 清對應分區,並讓 a.gen 前進。
//   · userDataRead(uid)/userDataWrite(data,uid):uid 省略時預設用 userDataActiveUid()
//     (=state.account.user.uid,未登入為 null);uid 為 null 明確代表匿名共用 key
//     (USER_DATA_KEY='trainmap-user-data-v1');已登入時 key 改成
//     `${USER_DATA_KEY}:uid:${uid}`,不同帳號各自獨立。
//   · userDataMigrateAccountPartition(uid):分區第一次被讀取時,若裝置記錄的上一個「驗證過身分」
//     的 uid(localStorage['trainmap-account-last-uid'],即 ACCOUNT_LAST_UID_KEY)不存在或等於
//     這個 uid,從匿名分區繼承既有資料(userDataRead(null));否則(上一個驗證過身分的是別人)
//     給空白 envelope——不把陌生帳號的殘留資料繼承給新登入的人。遷移結果立即寫回分區 key,
//     故重複讀取天然冪等。
//   · userDataSaveCollection(kind,values)/userDataRead()/userDataWrite() 這些既有產品函式全部
//     透過上述兩個新參數的預設值自動依登入狀態切換分區,呼叫端(收藏/釘選/完乘紀錄等既有程式碼)
//     完全不用跟著改。
//   · state.account.fb 的 Firestore stub 手法沿用 verify_plus_subscription.mjs Section H/P 既有慣例:
//     doc()/runTransaction()「有沒有被呼叫到」與 tx.set() 記錄的內容都可以當判準,不看回傳值巧合。
//
//   ── 2026-08-04 複審修復輪1(第 1 輪不通過)追加的機制 ──
//   · userDataActiveUid():state.account.user 存在就用它;否則 fallback 讀
//     localStorage['trainmap-account-uid'](ACCOUNT_UID_KEY)。這把 key 在 onAuthStateChanged
//     拿到 user 的當下就寫,不等同步成功、也不等 state.account 先被建立——解決非訂閱者
//     (state.account 整個 session 可能都不存在)與離線/CDN 被擋時,開機/整場都讀錯分區的問題。
//     accountClearLocal(登出/刪除帳號)會清掉這把 key,避免下一個匿名訪客被 fallback 誤判成
//     前一個帳號。
//   · ACCOUNT_LAST_UID_KEY('trainmap-account-last-uid')是獨立於上面那把的第二把 key,只服務
//     userDataMigrateAccountPartition 的「陌生人」判斷,與 ACCOUNT_UID_KEY 同時機寫入,但
//     accountClearLocal 刻意不清掉它——如果陌生人判斷也用會被登出清空的那把 key,任何人真的
//     登出後,下一個登入的人(不論是不是同一人)都會被判成「無人用過」而重新繼承共用 key,
//     陌生人防護形同失效(2026-08-04 複審 Important 2 重新設計 R4 時的實測發現)。
//   · onAuthStateChanged 裡,user 一旦 truthy 就無條件呼叫 userDataRenderAll()(渲染 6 支既有
//     消費者共用的清單),不再等 plusRefresh()/accountSyncNow('login') 的成功與否——非訂閱者的
//     同步恆被 plusIsActive() 擋下,舊版掛在同步成功之後等於非訂閱者登入後永遠不重繪。順序刻意
//     先 render 後寫 ACCOUNT_UID_KEY/ACCOUNT_LAST_UID_KEY:遷移判斷要用「這次登入之前」記錄的
//     uid,先寫的話遷移讀到的會是剛寫進去的這次 uid 本身,永遠判成同一人。
//   · accountReturning() 改讀 ACCOUNT_UID_KEY(不再讀 trainmap-last-sync-uid,那把 key 只在同步
//     成功時才寫,對非訂閱者永遠不存在)。
//   · accountDelete() 開頭設 a.syncSuspended=true 並清掉 a.syncTimer,finally 復原;
//     accountSyncNow()/accountScheduleSync() 都新增 a.syncSuspended 檢查(比 a.loggingOut 更嚴格,
//     沒有 'logout' 例外)——刪帳號期間(reauth popup 到 deleteDoc 迴圈之間有多個 await)一律
//     不受理任何同步,避免 visibilitychange 觸發的同步把剛刪掉的 Firestore 文件重建。
//   · accountSignOut() 在算出 uid 之後多一道 `if (!uid) return;`——a.user 已是 null 時不再往下
//     跑,避免 accountClearLocal(null) 誤清匿名分區。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// G0 自檢(心得32:驗收腳本第一道 gate 要印出驗的是哪個目錄):ROOT 由本檔自身路徑推導,
// 不吃任何 --root/env 參數,結構上不會誤驗到別的 worktree——在隔離樹裡直接執行本檔(它與
// index.html 同一顆 worktree 移動),天然驗到那棵樹自己的 index.html。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex')}`);

// 埠位可用 PORT env 覆寫(這台機器 30+ worktree 並行,硬編埠位可能撞到別的 session)。
const PORT = Number(process.env.PORT || 5463);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) { res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise((resolve, reject) => { server.on('error', reject); server.listen(PORT, resolve); });
const BASE = `http://localhost:${PORT}/`;

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

const allErrors = [];
let pagesCreated = 0, pagesAttached = 0;
function attach(page, tag) {
  const local = [];
  pagesAttached++;
  page.on('pageerror', e => { const m = `[${tag}] pageerror: ${e}`; local.push(m); allErrors.push(m); });
  page.on('console', m => { if (m.type() === 'error') { const s = `[${tag}] console.error: ${m.text()}`; local.push(s); allErrors.push(s); } });
  return local;
}
async function newPage(browser, { width = 1280, height = 800 } = {}) {
  pagesCreated++;
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
  const page = await ctx.newPage();
  return { ctx, page };
}
async function waitReady(page) {
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 30000 });
  await page.waitForTimeout(250);
}

const chromiumB = await chromium.launch();

// ══════════════ R1. 登出序列化:accountSignOut() 真的會等既有同步做完,不會搶先清本機 ══════════════
// 手法:Firestore stub 的 runTransaction 第一次呼叫卡在一個測試可控的 gate(deferred promise)上,
// 模擬「同步進行中」。先手動呼叫(不 await)accountSyncNow('local-change') 讓它卡住,再手動呼叫
// (不 await)accountSignOut()——JS 對 async function 是「同步跑到第一個真正的 await」,故這兩次
// page.evaluate 呼叫返回時,前者已經把 a.syncing 設成 true 並卡在 gate,後者也已經跑到
// `await a.syncPromise` 那一行並卡住(這正是要驗證的:登出沒有搶在同步前面清本機)。
// R1a 在放行 gate 之前檢查本機分區「仍然」是同步前寫入的內容(accountClearLocal 還沒執行);
// R1b 放行 gate、等兩個呼叫都收斂之後,確認本機分區最終真的被清空(登出流程沒有卡死,只是被序列化)。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'R1');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const UID = 'race-r1-uid';
  const r = await page.evaluate(async (UID) => {
    // 先以這個 uid 的身分寫一筆本機收藏(尚未登入 Firebase,但 userDataSaveCollection 依
    // userDataActiveUid() 自動選對分區——這裡先手動把 state.account.user 設好,模擬「已登入」)。
    state.plus = { active: true };
    state.account = {
      ready: true, syncing: false, lastSync: 0, actionError: '', error: '', syncTimer: 0, gen: 0, loggingOut: false, syncPromise: null,
      user: { uid: UID, email: 'r1@example.com' }, auth: {}, db: {},
    };
    userDataSaveCollection('favs', [{ train: 'R1_TRAIN' }]);
    const preKey = JSON.stringify(userDataRead(UID));

    let release; const gate = new Promise(res => { release = res; });
    window.__release = release;
    let txnCalls = 0;
    state.account.fb = {
      doc: (db, ...segs) => ({ kind: segs[segs.length - 1] }),
      runTransaction: async (db, fn) => {
        txnCalls++;
        if (txnCalls === 1) await gate; // 只擋第一次呼叫(模擬「同步進行中」);之後的重試/補做立刻放行
        const tx = {
          get: async () => ({ exists: () => false, data: () => null }), // 雲端目前沒有這幾份文件
          set: () => {},
        };
        return fn(tx);
      },
      serverTimestamp: () => 'SERVER_TIME_STUB',
      signOut: async () => {},
    };

    window.__p1 = accountSyncNow('local-change'); // 不 await:應該同步跑到 gate 卡住,a.syncing=true
    const midP1Syncing = state.account.syncing === true;

    window.__p2 = accountSignOut(); // 不 await:應該同步跑到 `await a.syncPromise` 卡住
    const midLoggingOut = state.account.loggingOut === true;
    // R1a 的核心量測:此刻 accountClearLocal 應該完全還沒有執行過——本機分區的內容應該與
    // 同步前一模一樣(還沒被清空,也還沒被同步寫回,因為 gate 還沒放行)。
    const midPartition = JSON.stringify(userDataRead(UID));
    // R1d(Important 3)的核心量測:txnCalls 的遞增在 runTransaction stub 的最頂端,呼叫 async
    // 函式時函式本體是同步跑到它自己第一個 await 為止——若 accountSyncNow('logout') 是真的
    // `await a.syncPromise`,accountSignOut() 這次呼叫此刻應該卡在那一行本身,連 accountSyncTxn
    // 的第二次呼叫(登出親自補做的那次)都還沒開始,txnCalls 必須仍是 1。見下方 R1d 斷言與
    // task-6-report.md 的 Mutation A2(把 await 改成 fire-and-forget 之後這裡會提早變成 2)。
    const txnCallsBeforeRelease = txnCalls;

    release(); // 放行 gate,讓 p1 的 transaction 真正跑完
    await window.__p1;
    await window.__p2;

    const finalPartition = userDataRead(UID);
    return {
      midP1Syncing, midLoggingOut,
      midUnchanged: midPartition === preKey,
      txnCalls, txnCallsBeforeRelease,
      finalEmpty: finalPartition.collections.favs.items.length === 0 && finalPartition.collections.pins.items.length === 0,
      finalRevision: finalPartition.revision,
    };
  }, UID);
  ok('R1 前置條件:accountSyncNow(\'local-change\') 呼叫後立刻卡在 gate 上(a.syncing===true,還沒解決)',
    r.midP1Syncing === true, JSON.stringify(r));
  ok('R1 前置條件:accountSignOut() 呼叫後立刻進入登出流程(a.loggingOut===true)', r.midLoggingOut === true, JSON.stringify(r));
  ok('R1a 序列化有牙:同步仍卡在 gate 時,accountSignOut() 沒有搶先清空本機(分區內容與同步前逐位元組相同)',
    r.midUnchanged === true, JSON.stringify(r));
  ok('R1b 序列化沒有卡死:放行 gate 後,登出流程最終仍會完整跑完、本機分區確實被清空',
    r.finalEmpty === true && r.finalRevision === 0, JSON.stringify(r));
  // R1c 是序列化「本身」唯一有牙的斷言:R1a/R1b 驗的是最終結果乾淨,但那個結果同時也會被
  // C-2 的另一道防線(世代複查)獨立保住——即使序列化整個被拔掉,accountClearLocal 一樣會讓
  // a.gen 前進,讓 p1 那筆卡住的交易事後解決時被世代複查擋下、寫不進本機,最終看起來一樣乾淨。
  // 真正只有序列化才會留下的痕跡,是「accountSyncNow('logout') 有沒有真的等 p1 做完、再親自補跑
  // 一次自己的交易」——沒有序列化就直接 return false,txnCalls 停在 1;有序列化則等 p1 解決後
  // 落到下面補做一次,txnCalls 會變成 2。這條斷言在 mutation A 才顯出唯一的區辨力,見 task-6-report.md。
  ok('R1c 序列化真的補做了最後一次同步(不是被 a.syncing 靜默跳過):txnCalls 達到 2(第一次是卡住的那次,第二次是登出等到之後親自補做的那次)',
    r.txnCalls === 2, JSON.stringify(r));
  // R1d(2026-08-04 複審 Important 3):R1a/R1b/R1c 驗的都是「最終結果」,複審實測把
  // `await a.syncPromise` 改成 `a.syncPromise.catch(() => {})`(fire-and-forget,不等待)之後,
  // 這三條全部維持綠燈——因為少了等待,accountSignOut() 會一路同步跑穿 accountSyncNow('logout')
  // -> accountSyncTxn -> runTransaction,搶在 release() 之前就把 txnCalls 推到 2,但那次交易的
  // get()/tx.set() 都還沒真正解決,最終結果照樣收斂成同一個乾淨分區(R1b/R1c 測不出差異)。
  // 真正只有「有沒有真的 await」這一個變因會影響的,是 release() 之前 txnCalls 停在哪裡——
  // 這條斷言不會被其他防線(世代複查、a.syncing 檢查)掩蓋,因為那些防線都不會讓 txnCalls
  // 提早遞增,見 task-6-report.md 的 Mutation A2 紅綠對照。
  ok('R1d 序列化真的用 await 等待(不是掛個 catch 就繼續跑):release() 之前,accountSyncTxn 的第二次呼叫(登出親自補做的那次)還沒開始——txnCallsBeforeRelease 仍是 1',
    r.txnCallsBeforeRelease === 1, JSON.stringify(r));
  ok('R1 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ R2. 登入世代複查:即使有路徑繞過序列化直接清本機,晚到的同步結果也不會復活 ══════════════
// accountDelete() 目前沒有像 accountSignOut() 一樣序列化(它有自己的刪帳號流程,見 Task 6 報告的
// 範圍討論)——用「同步進行中,直接呼叫 accountClearLocal(uid) 模擬 accountDelete 的清空時機」
// 複現這個更底層的情境:序列化不存在時,污染判準是否仍然靠世代複查擋下。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'R2');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const UID = 'race-r2-uid';
  const r = await page.evaluate(async (UID) => {
    state.plus = { active: true };
    state.account = {
      ready: true, syncing: false, lastSync: 0, actionError: '', error: '', syncTimer: 0, gen: 0, loggingOut: false, syncPromise: null,
      user: { uid: UID, email: 'r2@example.com' }, auth: {}, db: {},
    };
    userDataSaveCollection('favs', [{ train: 'R2_TRAIN' }]);

    let release; const gate = new Promise(res => { release = res; });
    state.account.fb = {
      doc: (db, ...segs) => ({ kind: segs[segs.length - 1] }),
      runTransaction: async (db, fn) => {
        await gate;
        const tx = { get: async () => ({ exists: () => false, data: () => null }), set: () => {} };
        return fn(tx);
      },
      serverTimestamp: () => 'SERVER_TIME_STUB',
    };

    const p1 = accountSyncNow('local-change'); // 卡在 gate
    await new Promise(r => setTimeout(r, 0)); // 讓上面這行真正跑到卡住(排除任何微任務時序疑慮)

    // 模擬 accountDelete() 這類「沒有序列化就清本機」的路徑——直接呼叫 accountClearLocal,
    // 不等待 p1。這一步會讓 a.gen 前進,也會把分區清空。
    accountClearLocal(UID);
    const rightAfterClear = userDataRead(UID); // 立刻確認清空真的生效了(不然下面的「維持空」沒有意義)

    release(); // 放行 p1 卡住的 transaction,讓它帶著「清空前擷取的舊快照」試著寫回本機
    const p1Result = await p1;

    const finalPartition = userDataRead(UID);
    return {
      clearedImmediately: rightAfterClear.collections.favs.items.length === 0,
      p1Result, // 世代複查應該讓 p1 回傳 false(結果被丟棄),不是 true
      staleTrainResurrected: finalPartition.collections.favs.items.some(x => x.value.train === 'R2_TRAIN'),
      finalRevision: finalPartition.revision, // accountClearLocal 寫入的 revision=0;若 p1 覆寫成功會變別的值
    };
  }, UID);
  ok('R2 前置條件:直接呼叫 accountClearLocal(uid) 立刻清空該分區(不等待進行中的同步)',
    r.clearedImmediately === true, JSON.stringify(r));
  ok('R2 世代複查有牙:同步卡在 gate 時分區被搶先清空(世代前進)⇒ 放行後,晚到的同步結果被丟棄(回傳 false)',
    r.p1Result === false, JSON.stringify(r));
  ok('R2 世代複查有牙(核心斷言):被丟棄的同步結果沒有把清空前的舊資料復活到本機(分區維持清空後的狀態)',
    r.staleTrainResurrected === false && r.finalRevision === 0, JSON.stringify(r));
  ok('R2 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ R3. 正向對照:單帳號正常同步——項目上得去、下得來、刪除產生的 tombstone 也正確 ══════════════
// 手法沿用 verify_plus_subscription.mjs 既有的 P2(「會記錄」的假雲端,斷言看 tx.set 寫入內容),
// 這裡延伸驗兩輪同步之間的刪除→tombstone 上傳,那是既有 P2 沒有覆蓋到的部分。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'R3');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const UID = 'race-r3-uid';
  const r = await page.evaluate(async (UID) => {
    state.plus = { active: true };
    state.account = {
      ready: true, syncing: false, lastSync: 0, actionError: '', error: '', syncTimer: 0, gen: 0, loggingOut: false, syncPromise: null,
      user: { uid: UID, email: 'r3@example.com' },
    };
    userDataSaveCollection('favs', [{ train: 'R3_LOCAL_A' }, { train: 'R3_LOCAL_B' }]);

    const cloudFavsDoc = {
      version: 1, kind: 'favs', revision: 5, clientUpdatedAt: Date.now(),
      items: [{ id: 'R3_CLOUD_ONLY', value: { train: 'R3_CLOUD_ONLY' }, updatedAt: Date.now() }],
      tombstones: [],
    };
    const writesLog = [];
    let txnRound = 0; // 每次呼叫 runTransaction 才前進一輪——一輪交易內四個 kind 各自呼叫一次 tx.set,不能用 writesLog.length 判斷輪次(那樣同一輪內第二個 kind 就會被誤判成下一輪)
    state.account.db = {};
    state.account.fb = {
      doc: (db, ...segs) => ({ kind: segs[segs.length - 1] }),
      runTransaction: async (db, fn) => {
        txnRound++;
        const round = txnRound;
        const tx = {
          get: async ref => { const d = ref.kind === 'favs' ? cloudFavsDoc : null; return { exists: () => !!d, data: () => d }; },
          set: (ref, data) => { writesLog.push({ round, kind: ref.kind, data }); },
        };
        return fn(tx);
      },
      serverTimestamp: () => 'SERVER_TIME_STUB',
    };

    const result1 = await accountSyncNow('manual');
    const write1 = writesLog.find(w => w.kind === 'favs' && w.round === 1);
    const afterSync1 = userDataRead(UID).collections.favs.items.map(x => x.value.train).sort();

    // 第二輪前:雲端文件更新成「第一輪剛寫進去的樣子」(模擬伺服器狀態已反映上一輪的寫入),
    // 再把 R3_LOCAL_A 從本機刪除——userDataSaveCollection 是「整批取代」語意,要保留的項目
    // (R3_LOCAL_B、剛從雲端下載回來的 R3_CLOUD_ONLY)都要留在清單裡,只拿掉 R3_LOCAL_A。
    Object.assign(cloudFavsDoc, write1.data);
    userDataSaveCollection('favs', [{ train: 'R3_LOCAL_B' }, { train: 'R3_CLOUD_ONLY' }]); // 拿掉 R3_LOCAL_A
    const hasTombstoneLocally = userDataRead(UID).collections.favs.tombstones.some(t => t.id === 'R3_LOCAL_A');

    const result2 = await accountSyncNow('manual');
    const write2 = writesLog.find(w => w.kind === 'favs' && w.round === 2);
    const afterSync2 = userDataRead(UID).collections.favs.items.map(x => x.value.train).sort();

    return {
      result1, result2,
      writeKinds1: [...new Set(writesLog.filter(w => w.round === 1).map(w => w.kind))].sort(),
      revision1: write1 && write1.data.revision,
      afterSync1,
      hasTombstoneLocally,
      write2Items: write2 && write2.data.items.map(x => x.id).sort(),
      write2Tombstones: write2 && write2.data.tombstones.map(t => t.id),
      afterSync2,
    };
  }, UID);
  ok('R3a 同步成功(第一輪與第二輪都回傳 true)', r.result1 === true && r.result2 === true, JSON.stringify(r));
  ok('R3b 四個 kind 都呼叫了 tx.set(pins/favs/rides/stations)',
    JSON.stringify(r.writeKinds1) === JSON.stringify(['favs', 'pins', 'rides', 'stations']), JSON.stringify(r.writeKinds1));
  ok('R3c 本機獨有的兩筆與雲端獨有的一筆,第一輪同時上傳與下載(merge 真的跑過,不是只挑一邊)',
    JSON.stringify(r.afterSync1) === JSON.stringify(['R3_CLOUD_ONLY', 'R3_LOCAL_A', 'R3_LOCAL_B']), JSON.stringify(r));
  ok('R3d revision = max(本機,雲端)+1(=6,雲端給的是5、本機剛建立是1)', r.revision1 === 6, `revision1=${r.revision1}`);
  ok('R3e 本機刪除一筆後,分區本身先產生一筆 tombstone(第二輪同步的前置事實)', r.hasTombstoneLocally === true, JSON.stringify(r));
  ok('R3f 第二輪同步真的把這筆 tombstone 上傳給雲端', (r.write2Tombstones || []).includes('R3_LOCAL_A'), JSON.stringify(r));
  ok('R3g 第二輪上傳的 items 不再包含被刪除的那一筆(tombstone 生效,不是刪了又傳上去)',
    !!(r.write2Items && !r.write2Items.includes('R3_LOCAL_A')), JSON.stringify(r));
  ok('R3h 正向對照:刪除後,其餘兩筆(雲端獨有＋本機留下的那筆)同步後仍然都在本機',
    JSON.stringify(r.afterSync2) === JSON.stringify(['R3_CLOUD_ONLY', 'R3_LOCAL_B']), JSON.stringify(r));
  ok('R3 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ R4. uid 分區:同一裝置依序登入 A→真正登出→登入 B,B 看不到 A 的東西 ══════════════
// 2026-08-04 複審 Important 2 重新設計:原本這裡直接 `state.account = { user: { uid: ... } }` 換
// 帳號、刻意不呼叫 accountClearLocal——但這樣共用 key 從頭到尾是空的,B 什麼都繼承不到只是因為
// 前置根本沒有任何資料在共用 key 裡,不是分區隔離本身擋下了什麼(複審原話:「對的斷言掛在不會
// 出事的前置」)。改成複審實測會真的出事的序列:先匿名寫一筆(裝置上唯一有東西的地方)→登入
// A(繼承)→A 新增自己的一筆→A 真正登出(呼叫 accountClearLocal,不是換個變數就算數)→登入 B。
// 複審用這個序列實測果然抓到 bView 混進 A_DEVICE_DATA——根因是 ACCOUNT_UID_KEY 在登出時必須被
// 清掉(見該常數說明),但陌生人判斷若也讀同一把 key,任何人登出後就沒有「上一個是誰」可比對,
// 落回繼承分支。已改成獨立的 ACCOUNT_LAST_UID_KEY(accountClearLocal 不清)修好這個洞,下面
// R4a 直接驗證修好後的結果。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'R4');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const r = await page.evaluate(() => {
    // 完全匿名先寫一筆(state.account 尚不存在,userDataActiveUid() 安全回傳 null,寫進共用 key)。
    userDataSaveCollection('favs', [{ train: 'A_DEVICE_DATA' }]);

    // 登入 A——比照真正的 onAuthStateChanged 拿到 user 時的行為,手動寫入 ACCOUNT_UID_KEY 與
    // ACCOUNT_LAST_UID_KEY(這裡直接操作 state.account 是延續本檔 R1/R2/R3 一貫的手法,跳過真的
    // Firebase Auth 撮合、聚焦在同步/分區邏輯本身,但這兩把 key 要一起補上,否則陌生人判斷永遠
    // 讀到「不存在」,測不到下面 R4a 真正要驗的分支)。
    state.account = { user: { uid: 'race-r4-a' }, gen: 0 };
    localStorage.setItem('trainmap-account-uid', 'race-r4-a');
    localStorage.setItem('trainmap-account-last-uid', 'race-r4-a');
    const aInherited = userDataRead('race-r4-a').collections.favs.items.some(x => x.value.train === 'A_DEVICE_DATA');
    userDataSaveCollection('favs', [{ train: 'A_DEVICE_DATA' }, { train: 'A_OWN_TRAIN' }]);

    // A 真正登出:呼叫真正的 accountClearLocal(A 的 uid),不是換個變數就算數——這一步正是
    // Important 2 指出「會出事的那一步」,舊版整個沒有這一步。
    accountClearLocal('race-r4-a');
    const clearedGen = state.account.gen;
    const aAfterClear = userDataRead('race-r4-a').collections.favs.items.map(x => x.value.train);
    const uidKeyAfterClear = localStorage.getItem('trainmap-account-uid');
    const lastUidKeyAfterClear = localStorage.getItem('trainmap-account-last-uid');

    // 登入 B(這台裝置從沒登入過的另一個帳號)。
    state.account = { user: { uid: 'race-r4-b' }, gen: clearedGen };
    const bBeforeWrite = userDataRead('race-r4-b').collections.favs.items.map(x => x.value.train);
    userDataSaveCollection('favs', [{ train: 'R4_B_TRAIN' }]);
    const bFavs = userDataRead('race-r4-b').collections.favs.items.map(x => x.value.train).sort();

    return { aInherited, aAfterClear, uidKeyAfterClear, lastUidKeyAfterClear, bBeforeWrite, bFavs };
  });
  ok('R4-pre 正向對照:A 第一次登入時,裝置上既有的匿名收藏(A_DEVICE_DATA)真的被繼承進 A 的分區(不是本來就是空的,下面「B 看不到」才有意義)',
    r.aInherited === true, JSON.stringify(r));
  ok('R4-clear 前置條件:accountClearLocal(A 的 uid)真的清空了 A 的本機分區、也真的移除了 trainmap-account-uid,但保留 trainmap-account-last-uid(三件事都要成立,登出呼叫才算真的生效——生效與否直接決定下面「B 看不到 A」是不是巧合)',
    r.aAfterClear.length === 0 && r.uidKeyAfterClear === null && r.lastUidKeyAfterClear === 'race-r4-a', JSON.stringify(r));
  ok('R4a Important 2 核心斷言:走過真正的 accountClearLocal 登出之後,B 登入時分區裡不含 A 的任何一筆(A_DEVICE_DATA / A_OWN_TRAIN 都不該出現)——這是複審實測會紅、且舊版 R4 完全測不到的情境',
    r.bBeforeWrite.length === 0, JSON.stringify(r));
  ok('R4b 帳號 B 自己新增的收藏只有自己的項目,不含 A 的', JSON.stringify(r.bFavs) === JSON.stringify(['R4_B_TRAIN']), JSON.stringify(r));
  ok('R4 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ R5. 既有資料遷移:改版前(或首次登入前)共用 key 的資料,第一次以 uid 讀取時繼承,且冪等 ══════════════
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'R5');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const r = await page.evaluate(() => {
    // 完全匿名情境下先寫一筆釘選(state.account 尚不存在,userDataActiveUid() 安全回傳 null)。
    userDataSaveCollection('pins', [{ lat: 25.04, lon: 121.51, label: 'R5_PIN' }]);
    // 2026-08-04 複審修復輪1:遷移閘門改讀 ACCOUNT_LAST_UID_KEY(trainmap-account-last-uid),
    // 不是 trainmap-last-sync-uid(那把 key 只在同步成功時才寫,見 index.html 該常數上方說明)。
    const lastUidBefore = localStorage.getItem('trainmap-account-last-uid');

    state.account = { user: { uid: 'race-r5-migrate' } };
    const first = userDataRead('race-r5-migrate');
    const second = userDataRead('race-r5-migrate'); // 冪等:第二次應該直接命中已寫回的分區 key,不重跑遷移
    const anonymousStill = userDataRead(null); // 匿名分區本身應該維持不變(遷移是「繼承」不是「搬移」)

    return {
      lastUidBefore,
      firstHasPin: first.collections.pins.items.some(x => x.value.label === 'R5_PIN'),
      idempotent: JSON.stringify(first) === JSON.stringify(second),
      anonymousStillHasPin: anonymousStill.collections.pins.items.some(x => x.value.label === 'R5_PIN'),
    };
  });
  ok('R5 前置條件:這台裝置從未驗證過任何帳號身分(trainmap-account-last-uid 不存在)', r.lastUidBefore === null, `lastUidBefore=${r.lastUidBefore}`);
  ok('R5a 遷移不遺失資料:改版前(匿名)寫入的既有釘選,第一次以帳號 uid 讀取時完整繼承進來',
    r.firstHasPin === true, JSON.stringify(r));
  ok('R5b 遷移冪等:同一個 uid 連續讀取兩次,結果逐位元組相同(第二次是直接命中分區 key,沒有重跑遷移)',
    r.idempotent === true, JSON.stringify(r));
  ok('R5c 匿名分區本身沒有被搬空:遷移是「繼承一份」,不是「移走」', r.anonymousStillHasPin === true, JSON.stringify(r));
  ok('R5 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ R6. 遷移安全網:上一個驗證過身分的帳號是「別人」時,不繼承陌生帳號的殘留資料 ══════════════
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'R6');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const r = await page.evaluate(() => {
    userDataSaveCollection('pins', [{ lat: 25.05, lon: 121.52, label: 'R6_STRANGER_PIN' }]);
    // 2026-08-04 複審修復輪1:同上,改寫 ACCOUNT_LAST_UID_KEY。
    localStorage.setItem('trainmap-account-last-uid', 'race-r6-someone-else'); // 裝置上一個驗證過身分的是別人

    state.account = { user: { uid: 'race-r6-new-uid' } };
    const migrated = userDataRead('race-r6-new-uid');
    return { inheritedStrangerPin: migrated.collections.pins.items.some(x => x.value.label === 'R6_STRANGER_PIN') };
  });
  ok('R6 遷移安全網有牙:上一個驗證過身分的帳號是別人時,新登入帳號的分區不會繼承陌生帳號留在共用 key 裡的資料',
    r.inheritedStrangerPin === false, JSON.stringify(r));
  ok('R6 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ R7. Important 4:登出時「擋新排程＋清 timer」原本零判準 ══════════════
// 複審把 accountScheduleSync() 的 `|| a.loggingOut` 刪掉,32 條全綠——需要三件事都有牙:
// (a) 一般情況下 accountScheduleSync() 真的會設出新 timer(用哨兵值證明呼叫後真的變了);
// (b) accountSignOut() 一開頭就把 a.syncTimer 清成 0(不是留著舊 timer 讓它之後意外觸發);
// (c) 登出流程「進行中」時,accountScheduleSync() 不會設出新 timer(哨兵值原樣保留)。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'R7');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const UID = 'race-r7-uid';
  const r = await page.evaluate(async (UID) => {
    state.plus = { active: true };
    state.account = {
      ready: true, syncing: false, lastSync: 0, actionError: '', error: '', syncTimer: 0, gen: 0, loggingOut: false, syncSuspended: false, syncPromise: null,
      user: { uid: UID, email: 'r7@example.com' }, auth: {}, db: {},
      fb: { signOut: async () => {} },
    };

    // R7a:一般情況下 accountScheduleSync() 真的會設一個新 timer——先塞一個真實 setTimeout 不可能
    // 剛好等於的哨兵值,證明呼叫後真的變了,不是原本就非 0 這種巧合。
    state.account.syncTimer = 999999;
    accountScheduleSync();
    const timerAfterSchedule = state.account.syncTimer;
    clearTimeout(timerAfterSchedule); // 這條 timer 不需要真的觸發,測完就清掉避免污染下一段

    // R7b/R7c:直接呼叫 accountSignOut(),把它唯一會 await 的地方(accountSyncNow('logout') 內部
    // 的 accountSyncTxn -> runTransaction)卡住,量「登出開頭那一刻」的兩件事有沒有真的發生。
    state.account.syncTimer = 888888; // 哨兵值:驗證 accountSignOut() 開頭會不會清掉它
    let releaseSignOut; const signOutGate = new Promise(res => { releaseSignOut = res; });
    state.account.fb.runTransaction = async () => { await signOutGate; return { version: USER_DATA_VERSION, revision: 1, updatedAt: Date.now(), collections: {} }; };
    state.account.fb.doc = () => ({});
    state.account.fb.serverTimestamp = () => 'T';
    const signOutP = accountSignOut(); // 不 await:同步跑到 runTransaction 卡在 gate 上(此刻 a.syncing 剛被設為 true,不影響本節斷言)
    const timerRightAfterSignOutStarts = state.account.syncTimer;
    const loggingOutRightAfterSignOutStarts = state.account.loggingOut;

    // R7d(Important 4 核心):登出流程「進行中」時(loggingOut 仍是 true,尚未 release),
    // 另一個路徑呼叫 accountScheduleSync() 不應該設出新 timer。
    state.account.syncTimer = 777777; // 哨兵值:若 accountScheduleSync 沒被擋,會被新 timer id 覆蓋掉
    accountScheduleSync();
    const timerAfterScheduleDuringLogout = state.account.syncTimer;

    releaseSignOut();
    await signOutP;

    return {
      timerAfterSchedule, timerRightAfterSignOutStarts, loggingOutRightAfterSignOutStarts,
      timerAfterScheduleDuringLogout, loggingOutFinal: state.account.loggingOut,
    };
  }, UID);
  ok('R7a accountScheduleSync() 在一般情況下真的會設出一個新 timer(不是原本的哨兵值 999999)',
    r.timerAfterSchedule !== 999999, JSON.stringify(r));
  ok('R7b accountSignOut() 一開頭就清掉了 a.syncTimer(哨兵值 888888 在同步卡到 gate 之前就變成 0,不是留著舊 timer)',
    r.timerRightAfterSignOutStarts === 0, JSON.stringify(r));
  ok('R7c accountSignOut() 一開頭就把 a.loggingOut 設成 true(卡在 gate 時仍是 true,登出流程確實已經開始)',
    r.loggingOutRightAfterSignOutStarts === true, JSON.stringify(r));
  ok('R7d Important 4 核心斷言:登出流程進行中(a.loggingOut===true 且卡在 gate)時,accountScheduleSync() 不會設出新 timer(哨兵值 777777 原樣保留)',
    r.timerAfterScheduleDuringLogout === 777777, JSON.stringify(r));
  ok('R7 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ R7(續). a.loggingOut 本身真的擋下 accountSyncNow('manual'/'foreground')
// ══════════════
// 若透過完整 accountSignOut() 流程測「登出期間 manual/foreground 同步被擋」,量到的時候
// a.syncing 多半已經是 true(登出自己觸發的同步在途)——這時候即使把 accountSyncNow 裡
// `a.loggingOut && !reason.startsWith('logout')` 那一行整個刪掉,`a.syncing` 那一關(對非 logout
// 理由直接 return false)照樣會擋下 manual/foreground,斷言看起來還是綠的,但那不是 a.loggingOut
// 的功勞——這正是複審這一輪反覆點名的「斷言被另一道保護掩蓋而假有牙」。這裡刻意繞開
// accountSignOut(),直接操作 state,構造一個 a.loggingOut===true 但 a.syncing 確定是 false
// (沒有任何同步在途)的場景,把兩道防線分開驗。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'R7f');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const UID = 'race-r7f-uid';
  const r = await page.evaluate(async (UID) => {
    state.plus = { active: true }; // 中和另一道閘門(!plusIsActive()),確保被擋的原因只可能是 a.loggingOut
    let txnCalls = 0;
    state.account = {
      ready: true, syncing: false, lastSync: 0, actionError: '', error: '', syncTimer: 0, gen: 0,
      loggingOut: true, // 直接構造:登出「進行中」,但下面證明沒有任何同步在途
      syncSuspended: false, syncPromise: null,
      user: { uid: UID, email: 'r7f@example.com' }, auth: {}, db: {},
      fb: {
        doc: () => ({}),
        runTransaction: async () => { txnCalls++; return { version: USER_DATA_VERSION, revision: 1, updatedAt: Date.now(), collections: {} }; },
        serverTimestamp: () => 'T',
      },
    };
    const syncingProvablyFalse = state.account.syncing === false; // 前置條件:下面被擋不能歸功於 a.syncing 那道閘門

    const manualResult = await accountSyncNow('manual');
    const manualTxnCalls = txnCalls;
    const foregroundResult = await accountSyncNow('foreground');
    const foregroundTxnCalls = txnCalls;

    // 正向對照:同一個場景,只要 a.loggingOut 改回 false,manual 同步應該真的會去碰 Firestore
    // (證明上面兩次是 a.loggingOut 真的擋下了什麼,不是 stub 本身有問題導致恆為 0)。
    state.account.loggingOut = false;
    const controlResult = await accountSyncNow('manual');
    const controlTxnCalls = txnCalls;

    return { syncingProvablyFalse, manualResult, manualTxnCalls, foregroundResult, foregroundTxnCalls, controlResult, controlTxnCalls };
  }, UID);
  ok('R7f 前置條件:a.loggingOut===true 但 a.syncing 確定是 false(沒有任何同步在途,下面被擋不能歸功於 a.syncing 那道閘門)',
    r.syncingProvablyFalse === true, JSON.stringify(r));
  ok("R7f Important 4 核心斷言(manual):a.loggingOut===true 時 accountSyncNow('manual') 回傳 false 且沒有觸碰 Firestore(txnCalls 維持 0)",
    r.manualResult === false && r.manualTxnCalls === 0, JSON.stringify(r));
  ok("R7f Important 4 核心斷言(foreground):同上,accountSyncNow('foreground') 也一樣被擋",
    r.foregroundResult === false && r.foregroundTxnCalls === 0, JSON.stringify(r));
  ok("R7f 正向對照:a.loggingOut 改回 false 之後,同一個 stub 場景下 accountSyncNow('manual') 真的會去碰 Firestore(txnCalls 變成 1)——證明上面兩次是 a.loggingOut 真的擋下,不是 stub 本身恆為 0",
    r.controlResult === true && r.controlTxnCalls === 1, JSON.stringify(r));
  ok('R7f 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ R8. Important 5:accountDelete() 不擋同步,會讓已刪除的個資在 Firestore 復活 ══════════════
// accountDelete() 原本完全沒有擋同步——reauth 的 popup/原生登入視窗到 deleteDoc 迴圈之間有多個
// await,若這期間 visibilitychange 觸發 accountSyncNow('foreground'),會把剛 deleteDoc 掉的文件
// 重建,deleteUser 照樣成功,帳號沒了但個資變孤兒文件留在 Firestore。修法是 accountDelete() 開頭
// 設 a.syncSuspended=true、finally 復原,accountSyncNow/accountScheduleSync 都新增這道檢查。這裡
// 把 4 個 deleteDoc 呼叫中的第一個卡住(此時 reauth 與 accountDeleteServerData 都已經跑完,真的
// 落在複審點名的「deleteDoc 迴圈到 deleteUser 之間」這個危險窗口),驗證卡住期間
// accountSyncNow('foreground') 真的被擋、也真的沒有寫進 Firestore;放行後驗證 accountDelete()
// 本身仍能正常跑完、旗標最終復原。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'R8');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const UID = 'race-r8-uid';
  const r = await page.evaluate(async (UID) => {
    state.plus = { active: true };
    let deleteDocCalls = 0, deleteUserCalled = false, txnCalls = 0;
    let releaseFirstDeleteDoc; const deleteDocGate = new Promise(res => { releaseFirstDeleteDoc = res; });
    let markFirstDeleteDocReached; const firstDeleteDocReached = new Promise(res => { markFirstDeleteDocReached = res; });
    window.confirm = () => true; // accountDelete() 開頭的原生 confirm 對話框
    state.account = {
      ready: true, syncing: false, lastSync: 0, actionError: '', error: '', syncTimer: 0, gen: 0,
      loggingOut: false, syncSuspended: false, syncPromise: null,
      user: { uid: UID, email: 'r8@example.com', providerData: [{ providerId: 'google.com' }], getIdToken: async () => 'fake-token' },
      auth: {}, db: {},
      fb: {
        doc: () => ({}),
        GoogleAuthProvider: function () {}, // new a.fb.GoogleAuthProvider() 只需要可建構,provider 物件本身不會被檢查內容
        reauthenticateWithPopup: async () => ({}),
        deleteDoc: async () => {
          deleteDocCalls++;
          if (deleteDocCalls === 1) { markFirstDeleteDocReached(); await deleteDocGate; } // 只卡第一個,模擬「這時候切出去再切回來」
        },
        deleteUser: async () => { deleteUserCalled = true; },
        runTransaction: async () => { txnCalls++; return { version: USER_DATA_VERSION, revision: 1, updatedAt: Date.now(), collections: {} }; },
        serverTimestamp: () => 'T',
      },
    };
    userDataSaveCollection('favs', [{ train: 'R8_TRAIN' }]); // 讓最後 accountClearLocal 真的有東西可以清,便於觀察

    const deleteP = accountDelete(); // 不 await
    await firstDeleteDocReached; // 等到真的卡在第一個 deleteDoc(reauth 與 accountDeleteServerData 都已跑完)
    const syncSuspendedWhileBlocked = state.account.syncSuspended;
    const foregroundResult = await accountSyncNow('foreground'); // 模擬卡住期間切出去再切回來觸發的補查
    const txnCallsWhileBlocked = txnCalls;

    releaseFirstDeleteDoc();
    await deleteP;

    return {
      syncSuspendedWhileBlocked, foregroundResult, txnCallsWhileBlocked,
      deleteDocCallsFinal: deleteDocCalls, deleteUserCalledFinal: deleteUserCalled,
      syncSuspendedFinal: state.account.syncSuspended,
      aFavsAfterDelete: userDataRead(UID).collections.favs.items.map(x => x.value.train),
    };
  }, UID);
  ok('R8-pre 前置條件:accountDelete() 真的卡在第一個 deleteDoc 時,a.syncSuspended 已經是 true(reauth 與伺服器端刪除都已完成,真的落在複審點名的危險窗口內)',
    r.syncSuspendedWhileBlocked === true, JSON.stringify(r));
  ok("R8 Important 5 核心斷言:刪帳號進行中,accountSyncNow('foreground') 回傳 false 且沒有觸碰 Firestore(txnCallsWhileBlocked===0)——不會把剛刪掉的文件重建",
    r.foregroundResult === false && r.txnCallsWhileBlocked === 0, JSON.stringify(r));
  ok('R8 正向對照:放行之後 accountDelete() 仍然完整跑完(4 個 deleteDoc 都被呼叫、deleteUser 也被呼叫)——syncSuspended 沒有把刪帳號本身卡死,只是暫停同步',
    r.deleteDocCallsFinal === 4 && r.deleteUserCalledFinal === true, JSON.stringify(r));
  ok('R8 旗標復原:accountDelete() 完成後 a.syncSuspended 復原成 false(不會永久卡住之後所有同步)',
    r.syncSuspendedFinal === false, JSON.stringify(r));
  ok('R8 正向對照:accountClearLocal 最終仍正常執行,本機分區確實被清空(R8_TRAIN 不在了)',
    r.aFavsAfterDelete.length === 0, JSON.stringify(r));
  ok('R8 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ R9. Critical 1 直接驗證(一):userDataActiveUid() 的 fallback 解析單元測試 ══════════════
// R1-R8 都是透過完整情境間接驗證 Critical 1 的效果,這裡直接對 userDataActiveUid() 本身做四種
// 輸入組合的單元測試,不依賴任何開機時序或 Firebase stub。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'R9-unit');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const r = await page.evaluate(() => {
    const savedAccount = state.account;
    try { localStorage.removeItem('trainmap-account-uid'); } catch (e) {}

    // 前置:兩者都沒有 ⇒ null(真正匿名的新裝置,不是巧合)。
    state.account = undefined;
    const preTrulyAnonymous = userDataActiveUid();

    // R9a:state.account 整個不存在(非訂閱者開機最早期的真實情況——見 accountReturning 修復前
    // 的討論),但裝置上有 fallback key。
    localStorage.setItem('trainmap-account-uid', 'fallback-uid');
    const r9a_noAccountWithKey = userDataActiveUid();

    // R9b:state.account 存在但 user 還是 null(onAuthStateChanged 非同步 callback 還沒解出來的窗口)。
    state.account = { user: null };
    const r9b_accountExistsUserNull = userDataActiveUid();

    // R9c:user 一旦存在,直接用它、不理會 fallback(即使 fallback 還留著別的值 'fallback-uid')
    // ——身分解析完成後不會被過期的 fallback 蓋回去。
    state.account = { user: { uid: 'real-uid' } };
    const r9c_userSet = userDataActiveUid();

    // 正向對照:拿掉 fallback key、且 user 又是 null ⇒ 回到 null(不會殘留任何一次解析的痕跡)。
    localStorage.removeItem('trainmap-account-uid');
    state.account = { user: null };
    const r9d_backToAnonymous = userDataActiveUid();

    state.account = savedAccount;
    return { preTrulyAnonymous, r9a_noAccountWithKey, r9b_accountExistsUserNull, r9c_userSet, r9d_backToAnonymous };
  });
  ok('R9-pre 正向對照:全新裝置(state.account 不存在、fallback key 也不存在)⇒ userDataActiveUid() 回傳 null',
    r.preTrulyAnonymous === null, JSON.stringify(r));
  ok('R9a state.account 整個不存在時,userDataActiveUid() 靠 fallback key 解析出正確的 uid(這正是非訂閱者開機最早期、以及 CDN 被擋整場的真實狀態)',
    r.r9a_noAccountWithKey === 'fallback-uid', JSON.stringify(r));
  ok('R9b state.account 存在但 user 還是 null(onAuthStateChanged 還沒解出來的窗口)時,同樣靠 fallback key',
    r.r9b_accountExistsUserNull === 'fallback-uid', JSON.stringify(r));
  ok('R9c state.account.user 一旦存在,直接用它、不理會 fallback key',
    r.r9c_userSet === 'real-uid', JSON.stringify(r));
  ok('R9d 正向對照:兩者都沒有 ⇒ 回傳 null(不會殘留任何一次解析的痕跡)',
    r.r9d_backToAnonymous === null, JSON.stringify(r));
  ok('R9-unit 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ R9(續). Critical 1 直接驗證(二):非訂閱者開機的「開機空窗期」就已經正確讀到
// 該 uid 的分區,期間的取消收藏在 auth 解出來之後也不會被推翻 ══════════════
// 手法沿用 verify_plus_refresh_lifecycle.mjs 的 L1/L2(RAIL_FIREBASE_TEST_MODULES 短路,讓
// onAuthStateChanged 非同步解出一個真使用者)——但這裡刻意不給任何 Plus 資格(不設
// RAIL_PLUS_TEST_ADAPTER/RAIL_REVENUECAT_CONFIG),直接對應複審點名的更嚴重情境:「非訂閱者的
// 同步恆被 plusIsActive() 擋下,若 render/建立 key 掛在同步成功之後,非訂閱者永遠不會受益」。
// 情境盡量貼近複審原文的失敗案例(匿名存 OLD_ANON→登入 U1 遷移繼承→登入後加 NEW_AFTER_LOGIN→
// 重開頁面 auth 未解析→使用者取消收藏→auth 解析後取消收藏憑空還原):這裡簡化成裝置上已有兩筆
// 收藏(對應完成過一次登入遷移之後的狀態,登入/遷移本身由 R4/R5 另外驗證),開機空窗期間取消收藏
// 其中一筆,驗證 auth 解析後那次取消不會「憑空還原」。
{
  const { ctx, page } = await newPage(chromiumB);
  await ctx.addInitScript((arg) => {
    try {
      const now = Date.now();
      localStorage.setItem('trainmap-account-uid', arg.uid);
      localStorage.setItem('trainmap-account-last-uid', arg.uid);
      localStorage.setItem('trainmap-user-data-v1:uid:' + arg.uid, JSON.stringify({
        version: 1, deviceId: 'test-device', revision: 3, updatedAt: now,
        collections: {
          pins: { items: [], tombstones: [] },
          favs: {
            items: [
              { id: 'PRE_EXISTING_FAV_A', value: { train: 'PRE_EXISTING_FAV_A' }, updatedAt: now },
              { id: 'PRE_EXISTING_FAV_B', value: { train: 'PRE_EXISTING_FAV_B' }, updatedAt: now },
            ],
            tombstones: [],
          },
          rides: { items: [], tombstones: [] },
          stations: { items: [], tombstones: [] },
        },
      }));
    } catch (e) {}
    window.RAIL_FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'x' };
    window.RAIL_FIREBASE_TEST_MODULES = {
      initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}),
      // 2000ms 是刻意留的安全邊際:waitReady() 本身在 state.ready===true 後還會多等 250ms,
      // 這裡要確保下面的 gapSnapshot 量測「確定」發生在 onAuthStateChanged 解出真使用者之前。
      onAuthStateChanged: (auth, cb) => { setTimeout(() => cb({ uid: arg.uid, email: 't@example.com' }), 2000); },
    };
  }, { uid: 'boot-gap-uid' });
  const errs = attach(page, 'R9-boot');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  // 關鍵時間點:state.ready===true(頁面骨架已就緒)但 onAuthStateChanged 的 2000ms 延遲還沒到
  // ——state.account 這時如果存在,user 應該還是 null/undefined。立刻讀,不能等。
  const gapSnapshot = await page.evaluate(() => ({
    accountExists: typeof state.account !== 'undefined',
    userStillNull: !(state.account && state.account.user),
    favsAtGap: userDataLoadCollection('favs').map(x => x.train).sort(),
  }));
  // 空窗期間取消收藏其中一筆(對應複審案例的「使用者在此取消收藏 OLD_ANON」)。
  await page.evaluate(() => { userDataSaveCollection('favs', [{ train: 'PRE_EXISTING_FAV_B' }]); });
  const gapAfterCancel = await page.evaluate(() => userDataLoadCollection('favs').map(x => x.train).sort());
  await page.waitForFunction(() => state.account && state.account.user && state.account.user.uid === 'boot-gap-uid', null, { timeout: 10000 });
  await page.waitForTimeout(300); // 讓 render/plusRefresh 等後續非同步收尾
  const afterAuthSnapshot = await page.evaluate(() => ({
    userNow: state.account && state.account.user && state.account.user.uid,
    favsAfterAuth: userDataLoadCollection('favs').map(x => x.train).sort(),
  }));
  ok('R9-boot-pre 前置條件:accountReturning() 修好之後,非訂閱者開機 state.account 真的會被建立(不必先點過 Plus/帳號入口)',
    gapSnapshot.accountExists === true, JSON.stringify(gapSnapshot));
  ok('R9-boot-pre 前置條件:量測當下 onAuthStateChanged 確實還沒解出真使用者(下面才是真正的「開機空窗期」,不是巧合量到已經解完的狀態)',
    gapSnapshot.userStillNull === true, JSON.stringify(gapSnapshot));
  ok('R9e Critical 1 核心斷言:開機空窗期就已經正確讀到這個 uid 的分區——裝置上既有的兩筆收藏都看得到,不是掉回匿名分區的空清單',
    JSON.stringify(gapSnapshot.favsAtGap) === JSON.stringify(['PRE_EXISTING_FAV_A', 'PRE_EXISTING_FAV_B']), JSON.stringify(gapSnapshot));
  ok('R9e-b 空窗期間取消收藏立刻反映在同一個分區(PRE_EXISTING_FAV_A 消失,B 還在)',
    JSON.stringify(gapAfterCancel) === JSON.stringify(['PRE_EXISTING_FAV_B']), JSON.stringify({ gapAfterCancel }));
  ok('R9f Critical 1 核心斷言(對應複審原文情境):auth 解析後,空窗期間的取消收藏不會「憑空還原」——A 依然消失,不是變回 [A,B]',
    JSON.stringify(afterAuthSnapshot.favsAfterAuth) === JSON.stringify(['PRE_EXISTING_FAV_B']), JSON.stringify(afterAuthSnapshot));
  ok('R9f 正向對照:auth 確實解析完成(state.account.user.uid 變成真正登入的 uid,不是上面兩條沒驗到東西的巧合)',
    afterAuthSnapshot.userNow === 'boot-gap-uid', JSON.stringify(afterAuthSnapshot));
  ok('R9-boot 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

await chromiumB.close();
server.close();

ok('Z 每顆開出來的 page 都掛上了錯誤收集器(newPage/attach 沒有漏配對)', pagesCreated === pagesAttached, `newPage=${pagesCreated} attach=${pagesAttached}`);
ok('Z 全程 pageerror/console.error 為零', allErrors.length === 0, allErrors.slice(0, 8).join(' | '));

const fail = results.filter(r => !r.pass);
console.log(`\n──────── ${results.length - fail.length}/${results.length} PASS ────────`);
if (fail.length) { console.log('FAIL:', fail.map(f => f.name + (f.detail ? ` (${f.detail})` : '')).join(' ; ')); process.exit(1); }
console.log('全部 PASS');
process.exit(0);
