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
//     await accountSyncNow('logout') 之後才呼叫 accountEndSession()。
//   · accountClearLocal(uid) 吃明確的 uid 參數(呼叫端負責在 onAuthStateChanged 把
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
//     跑,沒有已驗證身分就不該有登出副作用(signOut()、拆 Plus 狀態與 CustomerInfo listener)。
//
//   ── 2026-08-04 複審修復輪2(第 2 輪不通過,新發現)追加的機制 ──
//   · accountClearLocal(uid) 拆成三支,因為登出與刪除帳號該清的範圍其實相反:
//       accountForgetIdentity() 兩者共用「這台裝置不再有已驗證身分」(gen 前進、Plus 狀態、
//                               ACCOUNT_UID_KEY、last-sync-uid),刻意完全不碰收藏資料;
//       accountEndSession()     登出 = accountForgetIdentity() + userDataRenderAll()。
//                               本機收藏原封不動留在該帳號的分區,同一個帳號再登入就回得來。
//       accountClearLocal(uid)  刪除帳號 = accountForgetIdentity() + 把空 envelope 寫進「該 uid
//                               分區」與「共用匿名 key」(後者連帶清四個 legacy 陣列,走
//                               userDataWrite 的 if (!uid) 分支)+ 重繪。
//     輪2 之前兩邊共用一套清法:對登出清太多(登入期間的編輯當場銷毀,非訂閱者的登入同步恆被
//     plusIsActive() 擋下 ⇒ 永久消失),對刪帳號又清太少(共用 key 與 legacy 陣列沒清,含經緯度
//     的釘選重新整理就回到畫面,牴觸 privacy.html / account-deletion.html 的明文承諾)。
//   · onAuthStateChanged 的 user 為 null 分支(輪2 之前完全不存在):清掉 ACCOUNT_UID_KEY 並重繪。
//     沒有它,程式分不出「auth 還沒解析」與「auth 解析結果就是沒登入」——伺服器端讓 session 失效
//     時(token 撤銷、帳號在別台被刪)畫面已回到未登入態,userDataActiveUid() 卻仍靠 fallback 解析
//     成上一個帳號,且登出鈕只在 a.user 為真時才畫,使用者連清掉它的入口都沒有。
//   · accountDelete() 在設完 a.syncSuspended 之後補上 `if (a.syncing) await a.syncPromise`——
//     syncSuspended 只擋得住「新發起」的同步,擋不住「已在途」那一筆(它的 tx.set 會在 deleteDoc
//     迴圈之後才提交,把剛刪掉的四份文件重建;世代複查只擋本機回寫,擋不到雲端那一半)。
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
    let txnCalls = 0, signOutCalls = 0;
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
      signOut: async () => { signOutCalls++; },
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
      txnCalls, txnCallsBeforeRelease, signOutCalls,
      loggingOutFinal: state.account.loggingOut,
      uidKeyFinal: localStorage.getItem('trainmap-account-uid'),
      finalFavs: finalPartition.collections.favs.items.map(x => x.value.train),
    };
  }, UID);
  ok('R1 前置條件:accountSyncNow(\'local-change\') 呼叫後立刻卡在 gate 上(a.syncing===true,還沒解決)',
    r.midP1Syncing === true, JSON.stringify(r));
  ok('R1 前置條件:accountSignOut() 呼叫後立刻進入登出流程(a.loggingOut===true)', r.midLoggingOut === true, JSON.stringify(r));
  ok('R1a 序列化有牙:同步仍卡在 gate 時,accountSignOut() 沒有搶先清空本機(分區內容與同步前逐位元組相同)',
    r.midUnchanged === true, JSON.stringify(r));
  // R1b 原本量的是「分區被清空」——那在輪2 之前是登出跑完的證據,現在登出刻意不清資料
  // (複審輪2 Important 4,見 accountEndSession),再拿它當證據就是把已修好的缺陷寫回判準。
  // 改量登出流程本身留下的三個痕跡:signOut 被呼叫、loggingOut 被 finally 復原、身分 key 已清。
  ok('R1b 序列化沒有卡死:放行 gate 後,登出流程最終仍完整跑完(fb.signOut 被呼叫一次、a.loggingOut 由 finally 復原成 false、ACCOUNT_UID_KEY 已清)——它只是被序列化,不是被卡死',
    r.signOutCalls === 1 && r.loggingOutFinal === false && r.uidKeyFinal === null, JSON.stringify(r));
  ok('R1e Important 4(序列化路徑):登出等完在途同步之後也沒有摧毀本機資料——R1_TRAIN 仍在該帳號的分區裡(最後一次同步的合併結果照常寫回)',
    JSON.stringify(r.finalFavs) === JSON.stringify(['R1_TRAIN']), JSON.stringify(r));
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
// accountDelete() 自輪2 起也會等在途同步(見 R8w),但世代複查是比序列化更底層、獨立的一道防線:
// 未來若有其他路徑在同步進行中清空本機而沒有等待,晚到的寫入依然不能復活成資料。這裡直接呼叫
// accountClearLocal(uid)(輪2 起它是刪除帳號專用的「真的清資料」那一支)複現那個情境:序列化不
// 存在時,污染判準是否仍然靠世代複查擋下。
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
    // 最愛的唯一鍵是「系統別|車次」(P2-2/Task 9 起,缺 sys 者一律歸 tra_sched)。這裡刻意寫死
    // 字面值而不呼叫 userDataItemId()——判準要獨立聲明鍵格式,跟實作共用推導式的話,鍵算錯時
    // 兩邊會一起錯而全綠。本檔原生於還沒有 Task 9 的分支,合併後才需要補上前綴。
    const hasTombstoneLocally = userDataRead(UID).collections.favs.tombstones.some(t => t.id === 'tra_sched|R3_LOCAL_A');

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
  ok('R3f 第二輪同步真的把這筆 tombstone 上傳給雲端', (r.write2Tombstones || []).includes('tra_sched|R3_LOCAL_A'), JSON.stringify(r)); // 前綴同 R3e 說明
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

    // A 真正登出:呼叫真正的 accountEndSession(),不是換個變數就算數——這一步正是
    // Important 2 指出「會出事的那一步」,舊版整個沒有這一步。
    accountEndSession();
    const clearedGen = state.account.gen;
    const aAfterLogout = userDataRead('race-r4-a').collections.favs.items.map(x => x.value.train).sort();
    const uidKeyAfterLogout = localStorage.getItem('trainmap-account-uid');
    const lastUidKeyAfterLogout = localStorage.getItem('trainmap-account-last-uid');

    // 登出後這台裝置回到匿名(state.account.user 為 null,ACCOUNT_UID_KEY 已被清)——此刻畫面該
    // 讀到的是匿名共用分區,不是 A 的分區。A 的分區內容(多一筆 A_OWN_TRAIN)與匿名分區內容
    // (只有 A_DEVICE_DATA)刻意做成可區分,不然「讀到哪一個」測不出來。
    state.account = { user: null, gen: clearedGen };
    const anonViewAfterLogout = userDataLoadCollection('favs').map(x => x.train).sort();

    // 登入 B(這台裝置從沒登入過的另一個帳號)。
    state.account = { user: { uid: 'race-r4-b' }, gen: clearedGen };
    const bBeforeWrite = userDataRead('race-r4-b').collections.favs.items.map(x => x.value.train);
    userDataSaveCollection('favs', [{ train: 'R4_B_TRAIN' }]);
    const bFavs = userDataRead('race-r4-b').collections.favs.items.map(x => x.value.train).sort();

    return { aInherited, aAfterLogout, uidKeyAfterLogout, lastUidKeyAfterLogout, anonViewAfterLogout, bBeforeWrite, bFavs };
  });
  ok('R4-pre 正向對照:A 第一次登入時,裝置上既有的匿名收藏(A_DEVICE_DATA)真的被繼承進 A 的分區(不是本來就是空的,下面「B 看不到」才有意義)',
    r.aInherited === true, JSON.stringify(r));
  ok('R4-logout 前置條件:accountEndSession()(登出)真的生效了——trainmap-account-uid 被移除,但 trainmap-account-last-uid 保留成 A(兩件事都要成立,下面「B 看不到 A」才不是巧合)',
    r.uidKeyAfterLogout === null && r.lastUidKeyAfterLogout === 'race-r4-a', JSON.stringify(r));
  // R4c 是複審輪2 Important 4 的核心斷言,也是 brief 對 Task 8 的前置要求(「非訂閱者走完整登出
  // 流程 ⇒ 本機資料沒有被摧毀」)。輪1 的登出把空 envelope 寫進 :uid:A 分區,登入期間新增的
  // A_OWN_TRAIN 當場消失;非訂閱者的登入同步恆被 plusIsActive() 擋下,雲端也拿不回來。
  ok('R4c Important 4 核心斷言:登出「不摧毀資料」——A 登入期間新增的 A_OWN_TRAIN 與繼承來的 A_DEVICE_DATA,登出後都仍完整留在 A 自己的分區裡(同一個帳號再登入就回得來)',
    JSON.stringify(r.aAfterLogout) === JSON.stringify(['A_DEVICE_DATA', 'A_OWN_TRAIN']), JSON.stringify(r));
  ok('R4d 登出後畫面切回匿名分區:讀到的是共用 key 的內容(只有 A_DEVICE_DATA),不是 A 的分區(那裡多一筆 A_OWN_TRAIN)——「資料留著」不等於「還看得到別人的資料」',
    JSON.stringify(r.anonViewAfterLogout) === JSON.stringify(['A_DEVICE_DATA']), JSON.stringify(r));
  ok('R4a Important 2 核心斷言:走過真正的 accountEndSession 登出之後,B 登入時分區裡不含 A 的任何一筆(A_DEVICE_DATA / A_OWN_TRAIN 都不該出現)——這是複審實測會紅、且舊版 R4 完全測不到的情境',
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
  // 🔴 2026-08-04 複審輪2 Minor 7:這一行原本沒有 .catch()——複審突變 M6(把 accountReturning()
  // 退回舊 key)讓 state.account 從此不會在開機被建立,waitForFunction 逾時直接把整支腳本 uncaught
  // 打斷,下面四條專門為 Critical 1 設計的 R9-boot 斷言「一條都沒有跑到」,輸出裡卻只看得到一個
  // Playwright 堆疊,看不出那四條是沒跑還是跑了沒事(＝假綠的一種)。改成先收斂成布林、再當一條
  // 具名斷言回報,逾時本身就是 FAIL,而且後面四條照常執行、照常印出各自讀到的值。
  const authResolvedInTime = await page
    .waitForFunction(() => state.account && state.account.user && state.account.user.uid === 'boot-gap-uid', null, { timeout: 10000 })
    .then(() => true).catch(() => false);
  await page.waitForTimeout(300); // 讓 render/plusRefresh 等後續非同步收尾
  const afterAuthSnapshot = await page.evaluate(() => ({
    userNow: state.account && state.account.user && state.account.user.uid,
    favsAfterAuth: userDataLoadCollection('favs').map(x => x.train).sort(),
  }));
  ok('R9-boot-pre 前置條件:accountReturning() 修好之後,非訂閱者開機 state.account 真的會被建立(不必先點過 Plus/帳號入口)',
    gapSnapshot.accountExists === true, JSON.stringify(gapSnapshot));
  ok('R9-boot-pre 前置條件(Minor 7):onAuthStateChanged 在時限內真的解析出真使用者——這一條逾時代表下面四條核心斷言的前提不成立,必須看得見是「沒跑到」而不是靜靜地綠',
    authResolvedInTime === true, `authResolvedInTime=${authResolvedInTime}`);
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

// ══════════════ R8w. 複審輪2 Important 3:accountDelete() 必須等「已在途」的同步收斂 ══════════════
// a.syncSuspended(R8 驗的那道)只擋得住「新發起」的同步。已經進到 Firestore 交易裡的那一筆擋不住:
// 它的 tx.set 會在 deleteDoc 迴圈跑完之後才提交,把剛刪掉的四份文件原地重建(accountSyncTxn 尾端
// 的世代複查只擋本機回寫,tx.set 在交易內早已發生,擋不到雲端那一半;deleteUser 之後 ID token 仍
// 有效約一小時,rules 的 request.auth.uid 照樣放行)。手法:runTransaction 卡在 gate 上模擬「在途」,
// 然後呼叫 accountDelete(),量兩件事——(a) 在途同步解決之前,刪除流程一步都不該動;
// (b) 最終的 Firestore 動作順序裡,所有 tx.set 都在第一個 deleteDoc 之前。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'R8w');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const UID = 'race-r8w-uid';
  const r = await page.evaluate(async (UID) => {
    state.plus = { active: true };
    window.confirm = () => true;
    const ops = []; // 依序記錄三種 Firestore 動作,順序本身就是判準
    let releaseTxn; const txnGate = new Promise(res => { releaseTxn = res; });
    state.account = {
      ready: true, syncing: false, lastSync: 0, actionError: '', error: '', syncTimer: 0, gen: 0,
      loggingOut: false, syncSuspended: false, syncPromise: null,
      user: { uid: UID, email: 'r8w@example.com', providerData: [{ providerId: 'google.com' }], getIdToken: async () => 'fake-token' },
      auth: {}, db: {},
      fb: {
        doc: () => ({}),
        GoogleAuthProvider: function () {},
        reauthenticateWithPopup: async () => ({}),
        runTransaction: async (db, fn) => {
          await txnGate; // 這一筆同步「已在途」:交易已經開始、還沒解決
          const tx = { get: async () => ({ exists: () => false, data: () => null }), set: () => { ops.push('TXN_SET'); } };
          return fn(tx);
        },
        serverTimestamp: () => 'T',
        deleteDoc: async () => { ops.push('DELETE_DOC'); },
        deleteUser: async () => { ops.push('DELETE_USER'); },
      },
    };
    userDataSaveCollection('favs', [{ train: 'R8W_TRAIN' }]);

    const syncP = accountSyncNow('local-change'); // 卡在交易內,a.syncing=true、a.syncPromise 已設好
    await new Promise(res => setTimeout(res, 0));
    const syncingBeforeDelete = state.account.syncing === true;

    const deleteP = accountDelete(); // 應該卡在新增的 `await a.syncPromise` 那一行
    // 250ms 遠超過「沒有等待」的版本跑完 reauth -> accountDeleteServerData(打本機 stub server)
    // -> 4 個 deleteDoc -> deleteUser 所需的時間,所以下面 opsWhileSyncInFlight 為空是有意義的。
    await new Promise(res => setTimeout(res, 250));
    const opsWhileSyncInFlight = ops.slice();

    releaseTxn();
    await syncP; await deleteP;
    const opsFinal = ops.slice();
    return {
      syncingBeforeDelete, opsWhileSyncInFlight, opsFinal,
      txnSetCount: opsFinal.filter(x => x === 'TXN_SET').length,
      deleteDocCount: opsFinal.filter(x => x === 'DELETE_DOC').length,
      deleteUserCount: opsFinal.filter(x => x === 'DELETE_USER').length,
      allSetsBeforeFirstDelete: opsFinal.includes('DELETE_DOC') && opsFinal.includes('TXN_SET')
        && opsFinal.indexOf('DELETE_DOC') > opsFinal.lastIndexOf('TXN_SET'),
    };
  }, UID);
  ok('R8w 前置條件:呼叫 accountDelete() 之前,真的有一筆同步在途(a.syncing===true 且卡在 Firestore 交易裡)',
    r.syncingBeforeDelete === true, JSON.stringify(r));
  ok('R8w Important 3 核心斷言:在途同步還沒解決之前,刪除流程一步都還沒動(250ms 內零 DELETE_DOC、零 DELETE_USER)——accountDelete() 真的在等 a.syncPromise,不是只設個旗標就往下衝',
    r.opsWhileSyncInFlight.length === 0, JSON.stringify(r));
  ok('R8w Important 3 核心斷言(順序):最終的 Firestore 動作順序裡,所有 tx.set 都發生在第一個 deleteDoc 之前——剛刪掉的文件不會被在途同步重建',
    r.allSetsBeforeFirstDelete === true, JSON.stringify(r));
  ok('R8w 正向對照(同一支收集器):三種動作最終都真的被記錄到(4 筆 tx.set、4 筆 deleteDoc、1 筆 deleteUser)——證明上面「為 0」與「順序」不是因為 stub 根本沒被呼叫',
    r.txnSetCount === 4 && r.deleteDocCount === 4 && r.deleteUserCount === 1, JSON.stringify(r));
  ok('R8w 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ R10. 複審輪2 Minor 5:onAuthStateChanged 內「先 render 後寫 key」的順序 ══════════════
// 報告 §8.2 宣稱這個順序是關鍵,但輪1 的套件對它零覆蓋:複審把那兩行對調,63/63 全綠,他自己的
// 端到端探針卻直接紅(B 登入後看到了裝置上的匿名資料)。原因是 R4/R5/R6 都是手動塞 state.account
// 與兩把 key,走不到 onAuthStateChanged,結構上照不到「這兩件事誰先誰後」。這裡改用
// RAIL_FIREBASE_TEST_MODULES 走真的 onAuthStateChanged 路徑,而且把 callback 的觸發時機交給測試,
// 才能在「登入之前」把裝置狀態擺成複審那個會出事的樣子:裝置上有匿名資料、上一個驗證過身分的是
// 別人(A 登出後留下的 ACCOUNT_LAST_UID_KEY)、現在換 B 登入。
// 順序正確 ⇒ userDataRenderAll() 先跑,遷移讀到的 lastUid 還是 A,判定陌生人 ⇒ B 拿到空分區。
// 順序對調 ⇒ 兩把 key 先被寫成 B,遷移讀到的 lastUid 變成 B 自己,判成同一人 ⇒ B 繼承裝置上的匿名資料。
{
  const { ctx, page } = await newPage(chromiumB);
  await ctx.addInitScript(() => {
    window.RAIL_FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'x' };
    window.RAIL_FIREBASE_TEST_MODULES = {
      initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}),
      onAuthStateChanged: (auth, cb) => { window.__authCb = cb; }, // 觸發時機交給測試,不自己跑
    };
  });
  const errs = attach(page, 'R10');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const pre = await page.evaluate(async () => {
    // 裝置狀態:A 曾經登入過又登出(ACCOUNT_UID_KEY 已被清、ACCOUNT_LAST_UID_KEY 留著),
    // 共用匿名 key 裡有一筆這台裝置的資料。
    localStorage.setItem('trainmap-account-last-uid', 'r10-uid-a');
    localStorage.removeItem('trainmap-account-uid');
    userDataSaveCollection('favs', [{ train: 'R10_ANON_ON_DEVICE' }]);
    await accountEnsureInit(); // 登出態的裝置要由使用者主動點帳號/Plus 入口才會初始化,這裡等價地直接呼叫
    return {
      anonFavs: userDataRead(null).collections.favs.items.map(x => x.value.train),
      lastUidBeforeLogin: localStorage.getItem('trainmap-account-last-uid'),
      uidKeyBeforeLogin: localStorage.getItem('trainmap-account-uid'),
      authCbRegistered: typeof window.__authCb === 'function',
      bPartitionExisted: localStorage.getItem('trainmap-user-data-v1:uid:r10-uid-b') !== null,
    };
  });
  const post = await page.evaluate(async () => {
    // 加 typeof 守衛:callback 沒註冊時本節只會在自己的前置條件具名失敗,不會丟 TypeError 把整支
    // 腳本打斷(輪2 Minor 7 的教訓——沒跑到的斷言看起來跟綠的一樣)。
    if (typeof window.__authCb === 'function') await window.__authCb({ uid: 'r10-uid-b', email: 'b@example.com' }); // B 登入(走真的 callback 本體)
    return {
      bFavs: userDataRead('r10-uid-b').collections.favs.items.map(x => x.value.train),
      lastUidAfterLogin: localStorage.getItem('trainmap-account-last-uid'),
      uidKeyAfterLogin: localStorage.getItem('trainmap-account-uid'),
      anonStill: userDataRead(null).collections.favs.items.map(x => x.value.train),
    };
  });
  ok('R10-pre 正向對照:登入之前,裝置的共用匿名 key 裡真的有一筆資料(R10_ANON_ON_DEVICE)——不然下面「B 分區為空」只是因為本來就沒東西可繼承',
    JSON.stringify(pre.anonFavs) === JSON.stringify(['R10_ANON_ON_DEVICE']), JSON.stringify(pre));
  ok('R10-pre 前置條件:登入之前,上一個驗證過身分的是別人(last-uid=r10-uid-a)、ACCOUNT_UID_KEY 已被登出清掉、B 的分區還不存在、真的 onAuthStateChanged callback 已註冊',
    pre.lastUidBeforeLogin === 'r10-uid-a' && pre.uidKeyBeforeLogin === null && pre.authCbRegistered === true && pre.bPartitionExisted === false, JSON.stringify(pre));
  ok('R10a Minor 5 核心斷言:走真的 onAuthStateChanged 讓 B 登入之後,B 的分區不含裝置上的匿名資料——遷移的陌生人判斷讀到的是「這次登入之前」的 last-uid(A),不是剛被寫進去的 B 自己',
    post.bFavs.length === 0, JSON.stringify(post));
  ok('R10b 正向對照(同一支收集器):callback 本體真的跑完了那兩行——兩把 key 都已經被寫成 B(證明上面的「空」不是因為 callback 根本沒執行)',
    post.uidKeyAfterLogin === 'r10-uid-b' && post.lastUidAfterLogin === 'r10-uid-b', JSON.stringify(post));
  ok('R10c 登入沒有搬走匿名分區:共用 key 的內容原樣還在(遷移是「繼承一份」不是「移走」,這裡是不繼承,更不該動它)',
    JSON.stringify(post.anonStill) === JSON.stringify(['R10_ANON_ON_DEVICE']), JSON.stringify(post));
  ok('R10 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ R11. 複審輪2 Minor 6:accountSignOut() 的 `if (!uid) return;` 守衛零覆蓋 ══════════════
// 複審突變(拔掉那道守衛)→ 63/63 全綠。修對了但沒有任何判準看守。輪2 起登出已經不清本機資料,
// 所以這道守衛擋的不再是「誤清匿名分區」,而是「沒有已驗證身分卻跑完整條登出副作用」:真的去
// signOut()、把 Plus 狀態與 CustomerInfo listener 拆掉、世代前進(讓在途同步的結果被丟棄)。
// 判準因此改量那些副作用有沒有發生,而不是量資料還在不在(輪2 之後資料兩邊都會在,量它沒有牙)。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'R11');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const r = await page.evaluate(async () => {
    userDataSaveCollection('favs', [{ train: 'R11_ANON' }]);
    state.plus = { active: true };
    let signOutCalls = 0, loggingOutWhenSignOutCalled = null;
    state.account = {
      ready: true, syncing: false, lastSync: 0, actionError: '', error: '', syncTimer: 0, gen: 0,
      loggingOut: false, syncSuspended: false, syncPromise: null,
      user: null, // ← 沒有已驗證身分(還沒登入,或已經在登出中)
      auth: {}, db: {},
      fb: {
        signOut: async () => { signOutCalls++; loggingOutWhenSignOutCalled = state.account.loggingOut; },
        doc: () => ({}),
        runTransaction: async () => ({ version: USER_DATA_VERSION, revision: 1, updatedAt: Date.now(), collections: {} }),
        serverTimestamp: () => 'T',
      },
    };

    await accountSignOut(); // 守衛應該讓它立刻返回,什麼都不做
    const noUserSignOutCalls = signOutCalls, noUserGen = state.account.gen;
    const anonAfter = userDataLoadCollection('favs').map(x => x.train);

    // 正向對照:同一個 stub、同一顆頁面,只把 user 補上,accountSignOut() 就真的會走完登出流程。
    state.account.user = { uid: 'r11-uid', email: 'r11@example.com' };
    await accountSignOut();
    return {
      noUserSignOutCalls, noUserGen, anonAfter,
      controlSignOutCalls: signOutCalls, controlLoggingOut: loggingOutWhenSignOutCalled, controlGen: state.account.gen,
    };
  });
  ok('R11-pre 前置條件:這台裝置的匿名分區真的有一筆資料(下面的觀察都建立在「有東西可波及」之上)',
    JSON.stringify(r.anonAfter) === JSON.stringify(['R11_ANON']), JSON.stringify(r));
  ok('R11a Minor 6 核心斷言:a.user 為 null 時呼叫 accountSignOut(),連 fb.signOut() 都不會被呼叫(守衛擋在整條流程之前,不是跑完才發現沒事做)',
    r.noUserSignOutCalls === 0, JSON.stringify(r));
  ok('R11b Minor 6 核心斷言(第二個副作用):同一次呼叫也沒有讓世代前進(a.gen 仍是 0)——accountForgetIdentity() 完全沒被跑到,不會誤丟別的在途同步結果',
    r.noUserGen === 0, JSON.stringify(r));
  ok('R11c 正向對照(同一支收集器):把 user 補上之後,同一個 stub 的 fb.signOut() 真的被呼叫了一次、當下 a.loggingOut===true、世代也前進到 1——證明上面兩條的「0」是守衛擋下來的,不是 stub 本身恆為 0',
    r.controlSignOutCalls === 1 && r.controlLoggingOut === true && r.controlGen === 1, JSON.stringify(r));
  ok('R11 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ R12. 複審輪2 Important 1:刪除帳號要真的清掉「這台裝置內的私人收藏」 ══════════════
// 複審實測:登入前先匿名存過釘選的人,刪帳號後重新整理,那顆含經緯度的釘選會回到畫面上——因為
// accountClearLocal 只把空 envelope 寫進 :uid:<uid> 分區,而 userDataWrite 的 legacy 雙寫被
// if (!uid) 限縮成只給匿名分區,共用 key 與四個 legacy 陣列動都沒動。這牴觸 privacy.html:110 與
// account-deletion.html:30 的明文承諾,而且是 Task 6 引入的回歸(複審對照組 678af69^ 為 PASS)。
// 這裡走完整的 accountDelete() 流程,再真的 reload 一次頁面,量使用者真正會看到的結果。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'R12');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const UID = 'race-r12-uid';
  const r = await page.evaluate(async (UID) => {
    // 登入前的匿名使用:存一顆含經緯度的釘選(複審重現情境的第一步)。
    userDataSaveCollection('pins', [{ lat: 25.0478, lon: 121.517, label: 'R12_HOME_PIN' }]);
    const anonBefore = userDataRead(null).collections.pins.items.map(x => x.value.label);
    const legacyBefore = localStorage.getItem(USER_DATA_LEGACY.pins) || '';

    state.plus = { active: true };
    window.confirm = () => true;
    let deleteUserCalled = false;
    state.account = {
      ready: true, syncing: false, lastSync: 0, actionError: '', error: '', syncTimer: 0, gen: 0,
      loggingOut: false, syncSuspended: false, syncPromise: null,
      user: { uid: UID, email: 'r12@example.com', providerData: [{ providerId: 'google.com' }], getIdToken: async () => 'fake-token' },
      auth: {}, db: {},
      fb: {
        doc: () => ({}),
        GoogleAuthProvider: function () {},
        reauthenticateWithPopup: async () => ({}),
        deleteDoc: async () => {},
        deleteUser: async () => { deleteUserCalled = true; },
        runTransaction: async () => ({ version: USER_DATA_VERSION, revision: 1, updatedAt: Date.now(), collections: {} }),
        serverTimestamp: () => 'T',
      },
    };
    localStorage.setItem('trainmap-account-uid', UID);
    localStorage.setItem('trainmap-account-last-uid', UID);
    // 第一次登入把裝置上既有的匿名收藏繼承進帳號分區(既有行為,R5 另外驗)。
    const inheritedIntoAccount = userDataRead(UID).collections.pins.items.map(x => x.value.label);

    await accountDelete();
    return {
      anonBefore, legacyBeforeHasPin: legacyBefore.includes('R12_HOME_PIN'), inheritedIntoAccount, deleteUserCalled,
      partitionAfter: userDataRead(UID).collections.pins.items.map(x => x.value.label),
      anonAfter: userDataRead(null).collections.pins.items.map(x => x.value.label),
      legacyAfter: USER_DATA_COLLECTIONS.map(k => localStorage.getItem(USER_DATA_LEGACY[k])),
      uidKeyAfter: localStorage.getItem('trainmap-account-uid'),
      lastUidKeyAfter: localStorage.getItem('trainmap-account-last-uid'),
    };
  }, UID);
  // 真的重新整理一次:複審描述的傷害就是「重新整理就回到畫面上」,只量 localStorage 不夠貼近。
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const afterReload = await page.evaluate(() => ({
    activeUid: userDataActiveUid(),
    pins: userDataLoadCollection('pins').map(x => x.label),
  }));
  ok('R12-pre 正向對照:刪帳號之前,那顆含經緯度的釘選真的同時存在於共用匿名 key、legacy 陣列與帳號分區三個地方(三處都要先有東西,下面「三處都空」才有意義)',
    JSON.stringify(r.anonBefore) === JSON.stringify(['R12_HOME_PIN']) && r.legacyBeforeHasPin === true
    && JSON.stringify(r.inheritedIntoAccount) === JSON.stringify(['R12_HOME_PIN']), JSON.stringify(r));
  ok('R12-pre 前置條件:accountDelete() 真的整條跑完了(deleteUser 被呼叫、ACCOUNT_UID_KEY 已清)',
    r.deleteUserCalled === true && r.uidKeyAfter === null, JSON.stringify(r));
  ok('R12a Important 1 核心斷言(帳號分區):刪帳號後,該 uid 自己的分區被清空',
    r.partitionAfter.length === 0, JSON.stringify(r));
  ok('R12b Important 1 核心斷言(共用匿名 key):刪帳號後,登入前存進共用 key 的私人收藏也被清掉——輪1 只清了分區,這裡原封不動留著',
    r.anonAfter.length === 0, JSON.stringify(r));
  ok('R12c Important 1 核心斷言(四個 legacy 陣列):trainmap-pins/favs/rides/fav-stations 四把舊 key 全部被清成空陣列——輪1 完全沒碰它們',
    r.legacyAfter.every(v => v === '[]'), JSON.stringify(r.legacyAfter));
  ok('R12d Important 1 使用者可見結果:刪帳號後真的重新整理頁面,那顆含經緯度的釘選沒有回到畫面上(這正是 privacy.html/account-deletion.html「清除目前裝置內的私人收藏」承諾的兌現)',
    afterReload.pins.length === 0 && afterReload.activeUid === null, JSON.stringify(afterReload));
  // 2026-08-04 park 的 Minor:LAST_UID 在登出時刻意保留(R4 的前置條件正是在驗這件事),但刪帳號
  // 是不可逆的終點——那把 key 指向一個已經不存在的 uid。留著的話,同一個人重新註冊會拿到新 uid、
  // 被自己的裝置判成陌生人,於是他在刪帳號之後累積的匿名收藏不會被帶進新帳號。
  // 下面不只驗 key 的狀態,直接把「刪帳號 → 繼續匿名使用 → 重新註冊」整條走完,量他看得到什麼。
  ok('R12e 刪帳號清掉 last-uid(與登出相反:R4 的前置條件驗的是登出必須保留它)——帳號都刪了,這台裝置已經沒有「上一個已驗證身分」可言',
    r.lastUidKeyAfter === null, JSON.stringify({ lastUidKeyAfter: r.lastUidKeyAfter, uidKeyAfter: r.uidKeyAfter }));
  const reReg = await page.evaluate(() => {
    // 刪帳號之後繼續用(匿名),存一筆新的東西。
    userDataSaveCollection('pins', [{ lat: 24.1477, lon: 120.6736, label: 'R12_AFTER_DELETE_PIN' }]);
    // 重新註冊:新帳號一定是新的 uid。比照 onAuthStateChanged 的順序,先讀遷移結果再寫兩把 key。
    const NEWUID = 'race-r12-uid-2';
    state.account = { user: { uid: NEWUID }, gen: 0 };
    localStorage.setItem('trainmap-account-uid', NEWUID);
    const inherited = userDataRead(NEWUID).collections.pins.items.map(x => x.value.label);
    return { inherited };
  });
  ok('R12f 使用者可見結果:刪帳號後繼續匿名累積的收藏,在重新註冊(新 uid)時真的被帶進新帳號——留著舊 last-uid 的話,他會被自己的裝置當成陌生人而拿到空的',
    JSON.stringify(reReg.inherited) === JSON.stringify(['R12_AFTER_DELETE_PIN']), JSON.stringify(reReg));
  ok('R12 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ R13. 複審輪2 Important 2:session 在伺服器端失效(未走登出)後的身分痕跡 ══════════════
// onAuthStateChanged 收到 user===null 時輪1 什麼都不做,於是程式分不出「auth 還沒解析」(fallback
// 該生效)與「auth 解析結果就是沒登入」(fallback 不該生效)。token 被撤銷/帳號在別台被刪/憑證失效
// 時就走這條:畫面回到未登入態,userDataActiveUid() 卻仍解析成上一個 uid,那個人的私人收藏還看得到、
// 還能編輯,之後這台裝置的匿名使用也全部寫進他的分區;而且登出鈕只在 a.user 為真時才畫,使用者
// 連清掉它的入口都沒有。這裡用可控的 onAuthStateChanged callback 先送 user、再送 null,量前後差異。
{
  const { ctx, page } = await newPage(chromiumB);
  await ctx.addInitScript((arg) => {
    try {
      const now = Date.now();
      localStorage.setItem('trainmap-account-uid', arg.uid);       // 這台裝置上一次驗證過的身分
      localStorage.setItem('trainmap-account-last-uid', arg.uid);
      localStorage.setItem('trainmap-user-data-v1:uid:' + arg.uid, JSON.stringify({
        version: 1, deviceId: 'test-device', revision: 2, updatedAt: now,
        collections: {
          pins: { items: [], tombstones: [] },
          favs: { items: [{ id: 'A_SECRET', value: { train: 'A_SECRET' }, updatedAt: now }], tombstones: [] },
          rides: { items: [], tombstones: [] },
          stations: { items: [], tombstones: [] },
        },
      }));
    } catch (e) {}
    window.RAIL_FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'x' };
    window.RAIL_FIREBASE_TEST_MODULES = {
      initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}),
      // 先如常送出已登入的 user(session 還原),之後由測試自己送 null 模擬伺服器端失效。
      onAuthStateChanged: (auth, cb) => { window.__authCb = cb; cb({ uid: arg.uid, email: 'a@example.com' }); },
    };
  }, { uid: 'r13-uid-a' });
  const errs = attach(page, 'R13');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  // 刻意自己再呼叫一次 accountEnsureInit()(冪等):這個裝置本來就會因為 accountReturning()===true
  // 在開機自動初始化,但本節要驗的是 session 失效,不是開機路徑——不依賴它,accountReturning() 若被
  // 改壞,本節也只會在自己的前置條件上具名失敗,不會因為 window.__authCb 不存在而整支腳本崩掉
  // (輪2 Minor 7 的同一個教訓:斷言沒跑到看起來卻是綠的)。
  const before = await page.evaluate(async () => {
    await accountEnsureInit();
    return {
      authCbRegistered: typeof window.__authCb === 'function',
      userUid: state.account && state.account.user && state.account.user.uid,
      activeUid: userDataActiveUid(),
      uidKey: localStorage.getItem('trainmap-account-uid'),
      favs: userDataLoadCollection('favs').map(x => x.train),
    };
  });
  const after = await page.evaluate(async () => {
    if (typeof window.__authCb === 'function') await window.__authCb(null); // session 在伺服器端失效:accountSignOut() 從未被呼叫
    return {
      userNow: state.account && state.account.user,
      activeUid: userDataActiveUid(),
      uidKey: localStorage.getItem('trainmap-account-uid'),
      favs: userDataLoadCollection('favs').map(x => x.train),
      lastUidKey: localStorage.getItem('trainmap-account-last-uid'),
      partitionStillOnDisk: (() => {
        try { return JSON.parse(localStorage.getItem('trainmap-user-data-v1:uid:r13-uid-a')).collections.favs.items.map(x => x.id); }
        catch (e) { return null; }
      })(),
    };
  });
  ok('R13-pre 正向對照:session 失效之前,這台裝置確實解析成 A、而且畫面上真的看得到 A 的私人收藏(下面「看不到了」才是變化,不是本來就空)',
    before.authCbRegistered === true && before.userUid === 'r13-uid-a' && before.activeUid === 'r13-uid-a'
    && before.uidKey === 'r13-uid-a' && JSON.stringify(before.favs) === JSON.stringify(['A_SECRET']), JSON.stringify(before));
  ok('R13-pre 前置條件:送出 null 之後 state.account.user 真的變成 falsy(auth 確實解析成「沒有登入」)',
    !after.userNow, JSON.stringify(after));
  ok('R13a Important 2 核心斷言:session 失效後 ACCOUNT_UID_KEY 被清掉——不然它會一直卡著(登出鈕只在 a.user 為真時才畫,使用者沒有任何入口清得掉)',
    after.uidKey === null, JSON.stringify(after));
  ok('R13b Important 2 核心斷言:userDataActiveUid() 不再解析成上一個帳號(回到 null=匿名),之後這台裝置的匿名使用不會寫進那個帳號的分區',
    after.activeUid === null, JSON.stringify(after));
  ok('R13c Important 2 核心斷言:畫面上也不再看得到上一個帳號的私人收藏(A_SECRET 消失)——面板顯示未登入、內容卻還是別人的私人資料是最糟的組合',
    JSON.stringify(after.favs) === JSON.stringify([]), JSON.stringify(after));
  ok('R13d 這是「切走身分」不是「銷毀資料」:A 的分區本身仍完整留在裝置上(A 重新登入回得來),陌生人判斷用的 last-uid 也保留',
    // 前綴同 R3e 的說明:最愛 canonical key 是「系統別|車次」,字面寫死不與實作共用推導式。
    JSON.stringify(after.partitionStillOnDisk) === JSON.stringify(['tra_sched|A_SECRET']) && after.lastUidKey === 'r13-uid-a', JSON.stringify(after));
  ok('R13 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ R14. Task 8:permission-denied 的兩個成因不可混為一談 ══════════════
// 收緊 firestore.rules(寫入要求有效 Plus 資格)之後,accountSyncTxn 的 catch 會收到兩種
// permission-denied:(a) 新 collection 還沒被 rules 放行——退回舊清單(去掉 stations)重試有意義;
// (b) 這個人沒有有效資格——四個 kind 全被擋,重試一樣被擋。原本的 catch 只認 error.code,不分成因,
// 於是唯一走得到那裡的非訂閱者路徑(登出例外)會多打一次註定失敗的交易,而且把 a.legacyKinds
// 永久設成 true(整個 session 不重置)⇒ 他若在同一個 session 內買了 Plus,之後每次同步都靜默
// 少傳 stations,直到重新整理。修法用 plusIsActive() 分辨成因,並把「沒資格而被擋」當成設計本身
// (條款寫明無資格時新變更留在裝置)而不報「同步失敗」。
// 三組互為對照:非訂閱者(不重試、不設旗標、不報錯)/ 訂閱者(照舊重試、旗標設起來)/
// 非訂閱者但錯誤不是 permission-denied(照舊報錯)——第二三組證明沉默是有範圍的,不是把 catch 拆了。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'R14');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const r = await page.evaluate(async () => {
    const denied = () => { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; return e; };
    // 每組都重新建 state.account:a.legacyKinds 是 session 級旗標,共用會讓後一組看到前一組的殘留。
    const run = async (plusActive, thrown) => {
      let txnCalls = 0;
      state.plus = plusActive ? { active: true } : { active: false };
      state.account = {
        ready: true, syncing: false, lastSync: 0, actionError: '', error: '', syncTimer: 0, gen: 0,
        loggingOut: false, syncSuspended: false, syncPromise: null, legacyKinds: false,
        user: { uid: 'race-r14-uid', email: 'r14@example.com' }, auth: {}, db: {},
        fb: { doc: () => ({}), runTransaction: async () => { txnCalls++; throw thrown(); }, serverTimestamp: () => 'T' },
      };
      // 用 'logout' —— 非訂閱者唯一走得到 accountSyncTxn 的 reason(其餘都被 plusIsActive() 閘門擋在外面)。
      const result = await accountSyncNow('logout');
      return { result, txnCalls, legacyKinds: state.account.legacyKinds, actionError: state.account.actionError, plusSeen: plusIsActive() };
    };
    return {
      nonSubscriber: await run(false, denied),
      subscriber: await run(true, denied),
      otherError: await run(false, () => new Error('瀏覽器儲存空間不足')),
    };
  });
  ok('R14 前置條件:三組的 plusIsActive() 真的照設定分流(非訂閱=false、訂閱=true),否則下面全是同一組場景跑三遍',
    r.nonSubscriber.plusSeen === false && r.subscriber.plusSeen === true && r.otherError.plusSeen === false, JSON.stringify(r));
  ok('R14a 核心斷言:非訂閱者被 rules 擋下時只打一次交易,不做註定失敗的 legacy 重試(txnCalls===1)',
    r.nonSubscriber.txnCalls === 1, JSON.stringify(r.nonSubscriber));
  ok('R14b 核心斷言:非訂閱者被擋不可以污染 a.legacyKinds——設起來就等於「他這個 session 若買了 Plus,之後每次同步都靜默少傳 stations」',
    r.nonSubscriber.legacyKinds === false, JSON.stringify(r.nonSubscriber));
  ok('R14c 核心斷言:沒有資格而被擋是設計本身不是故障,不報「同步失敗」(登出不清本機,他一筆都沒少)',
    r.nonSubscriber.actionError === '' && r.nonSubscriber.result === false, JSON.stringify(r.nonSubscriber));
  ok('R14d 正向對照(有資格):同一個 permission-denied,訂閱者仍會退回舊清單重試——證明 R14a 的「只打一次」是成因判斷擋下的,不是重試路徑被整條拆掉(txnCalls===2 且旗標設起來)',
    r.subscriber.txnCalls === 2 && r.subscriber.legacyKinds === true, JSON.stringify(r.subscriber));
  ok('R14e 正向對照(非 permission-denied):同樣是非訂閱者,換成別的錯誤照舊回報「同步失敗」——證明 R14c 的沉默只涵蓋「被 rules 擋」,不是把整個 catch 的錯誤回報拆了',
    /同步失敗/.test(r.otherError.actionError) && r.otherError.txnCalls === 1, JSON.stringify(r.otherError));
  ok('R14 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ R15. 批二-E(整合稽核 2026-08-04 Minor 1):session 非正常失效時要拆掉 Plus 身分 ══════════════
// R13 已經驗過「ACCOUNT_UID_KEY 被清、userDataActiveUid() 回到 null、本機分區不受影響」,但那次稽核
// 之後才發現:那條路徑(輪2 當時的版本)只清了 uid fallback key,從沒真的把 Plus 身分拆掉——
// refresh token 被撤銷/帳號在別台被刪/session 在伺服器端失效,都會走到 onAuthStateChanged 的 else
// 分支而 accountSignOut() 從未被呼叫,plusIsActive() 仍是 true、plusRequire() 仍會放行 granted
// callback,畫面已經換成訪客,同一台裝置的匿名使用者卻仍拿得到純客端付費功能(Takeout 匯入/
// 行程分享/衛星 Retina/Live Activity)。
//
// 手法:比照 R10/R13 用可控的 window.__authCb(登記時不自動觸發,交給測試決定何時送出),但這裡
// 每次都直接 `await window.__authCb(...)`——callback 本體就是 index.html 的
// `async user => {...}`,直接 await 它等於 await 到內部的 plusRefresh()/accountSyncNow('login')/
// (批二-E 新增的)`await accountForgetIdentity()` 全部真正跑完,不必用 waitForTimeout 猜時間。
// window.RAIL_NATIVE_PLUS_ADAPTER 而不是 RAIL_PLUS_TEST_ADAPTER:accountForgetIdentity() 的
// clearUser() 只認前者(見 index.html accountForgetIdentity/plusAdapterFor),要驗「native logout」
// 這個副作用一定要用這顆全域。removeCustomerInfoUpdateListener 刻意做成真的非同步(setTimeout,不是
// 微任務就結束)——只有這樣,「呼叫了但沒 await」與「呼叫且 await 完成」在測試裡才是可觀察的差異
// (若用純同步 mock,即使 index.html 忘了 await,JS 對 async function 一路跑到第一個真 await 之前都是
// 同步的,side effect 一樣會在 window.__authCb(...) 返回前發生,測不出「忘了 await」這個退化)。
{
  const { ctx, page } = await newPage(chromiumB);
  await ctx.addInitScript((arg) => {
    const now = Date.now();
    try {
      localStorage.setItem('trainmap-user-data-v1:uid:' + arg.uid, JSON.stringify({
        version: 1, deviceId: 'test-device', revision: 2, updatedAt: now,
        collections: {
          pins: { items: [], tombstones: [] },
          favs: { items: [{ id: 'R15_SECRET', value: { train: 'R15_SECRET' }, updatedAt: now }], tombstones: [] },
          rides: { items: [], tombstones: [] },
          stations: { items: [], tombstones: [] },
        },
      }));
    } catch (e) {}
    window.__spy = { addListener: 0, removeListener: 0, clearUser: 0, setUser: 0 };
    window.__removedIds = [];
    window.RAIL_NATIVE_PLUS_ADAPTER = {
      setUser: async () => { window.__spy.setUser++; },
      getCustomerInfo: async () => ({ entitlements: { active: { plus: { identifier: 'plus' } } } }),
      getOfferings: async () => ({ all: {}, current: { availablePackages: [] } }),
      addCustomerInfoUpdateListener: async () => { window.__spy.addListener++; return 'r15-listener-id-' + window.__spy.addListener; },
      // 刻意用真的 setTimeout(不是純微任務)讓「呼叫了」與「呼叫且完成」可以被測試分辨——見上方區塊註解。
      removeCustomerInfoUpdateListener: async id => new Promise(res => setTimeout(() => { window.__spy.removeListener++; window.__removedIds.push(id); res(); }, 30)),
      clearUser: async () => { window.__spy.clearUser++; },
    };
    window.RAIL_REVENUECAT_CONFIG = { entitlement: 'plus', offeringId: 'plus' };
    window.RAIL_FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'x' };
    window.RAIL_FIREBASE_TEST_MODULES = {
      initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}),
      onAuthStateChanged: (auth, cb) => { window.__authCb = cb; }, // 觸發時機交給測試,不自己跑(R10/R13 既有手法)
    };
  }, { uid: 'r15-uid-a' });
  const errs = attach(page, 'R15');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);

  const pre = await page.evaluate(async () => {
    await accountEnsureInit();
    await window.__authCb({ uid: 'r15-uid-a', email: 'a@example.com' }); // 登入(比照 session 還原),await 到 plusRefresh()/accountSyncNow('login') 都跑完
    return {
      authCbRegistered: typeof window.__authCb === 'function',
      plusActive: plusIsActive(),
      addListenerCalls: window.__spy.addListener,
      clearUserCalls: window.__spy.clearUser,
    };
  });
  ok('R15-pre 前置條件:登入之後 plusIsActive() 真的是 true、CustomerInfo listener 真的註冊了一次、clearUser 還沒被叫過——下面「變成 false / 被拆」才有意義,不是本來就是那樣',
    pre.authCbRegistered === true && pre.plusActive === true && pre.addListenerCalls === 1 && pre.clearUserCalls === 0, JSON.stringify(pre));

  const post = await page.evaluate(async () => {
    window.__grantedCalled = 0;
    await window.__authCb(null); // 整合稽核 Minor 1 的核心場景:伺服器端讓 session 失效,accountSignOut() 從未被呼叫
    const requireResult = await plusRequire('r15', () => { window.__grantedCalled++; });
    return {
      plusActive: plusIsActive(),
      requireResult, grantedCalled: window.__grantedCalled,
      removeListenerCalls: window.__spy.removeListener, removedIds: window.__removedIds.slice(),
      clearUserCalls: window.__spy.clearUser,
      uidKey: localStorage.getItem('trainmap-account-uid'),
      lastUidKey: localStorage.getItem('trainmap-account-last-uid'),
      partitionStillOnDisk: (() => {
        try { return JSON.parse(localStorage.getItem('trainmap-user-data-v1:uid:r15-uid-a')).collections.favs.items.map(x => x.id); }
        catch (e) { return null; }
      })(),
    };
  });
  ok('R15a 核心斷言(整合稽核 Minor 1):非正常 session 失效後 plusIsActive() 變成 false——修復前這裡恆為 true,付費牆在客戶端形同沒關',
    post.plusActive === false, JSON.stringify(post));
  ok('R15b 核心斷言:plusRequire() 不再放行——回傳值不是 true、granted callback 也沒有被呼叫(修復前訪客樣貌的裝置仍能直接拿到付費功能)',
    post.requireResult === false && post.grantedCalled === 0, JSON.stringify(post));
  ok('R15c 核心斷言:listener 真的被拆(可觀測的替身證明——removeCustomerInfoUpdateListener 真的被呼叫一次且真的跑完,帶著註冊時拿到的同一個 id;不是只看 plusTeardownListener 有沒有被呼叫,也不是呼叫了但沒等它做完)',
    post.removeListenerCalls === 1 && post.removedIds[0] === 'r15-listener-id-1', JSON.stringify(post));
  ok('R15d 核心斷言:native adapter 的 clearUser() 也真的被呼叫一次——與登出同一套 teardown(accountForgetIdentity)連原生殼的副作用都一起做了',
    post.clearUserCalls === 1, JSON.stringify(post));
  ok('R15e 既有不變式沒有被破壞:ACCOUNT_UID_KEY 仍然被清掉(這件事不看 previousUid,任何 null 都該清——與批二-E 之前的既有行為一致)',
    post.uidKey === null, JSON.stringify(post));
  ok('R15f 不可回歸:這是「切走身分」不是「銷毀資料」——本機分區(R15_SECRET)原樣留在裝置上、ACCOUNT_LAST_UID_KEY(陌生人判斷)也沒被動到,accountForgetIdentity() 刻意不碰這兩者',
    // 前綴同 R13d 的說明:最愛 canonical key 是「系統別|車次」,字面寫死不與實作共用推導式。
    JSON.stringify(post.partitionStillOnDisk) === JSON.stringify(['tra_sched|R15_SECRET']) && post.lastUidKey === 'r15-uid-a', JSON.stringify(post));
  ok('R15 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ R15(續). 正向對照:冷啟動的第一次 null 不該觸發 native logout ══════════════
// 「冷啟動」定義:這個 session(這顆分頁的記憶體)從來沒有送過一次 truthy user——即使裝置磁碟上
// 還留著上次登入的 ACCOUNT_UID_KEY fallback 痕跡(這正是 accountReturning()===true 會自動觸發
// accountEnsureInit() 的那個情境),auth 第一次解析出來的結果就是「沒有登入」時,previousUid 應該是
// falsy(state.account.user 從初始化以來從未被設成 truthy 值過)。這種情況不該呼叫 native adapter 的
// clearUser(),也不該去拆一個從沒註冊過的 listener——這裡用同一顆 RAIL_NATIVE_PLUS_ADAPTER 的 spy
// 直接量「有沒有被呼叫」,不是猜測。
{
  const { ctx, page } = await newPage(chromiumB);
  await ctx.addInitScript((arg) => {
    try { localStorage.setItem('trainmap-account-uid', arg.staleUid); } catch (e) {} // 裝置上次登入留下的 fallback 痕跡(這個 session 記憶體裡從未出現過的身分)
    window.__spy = { addListener: 0, removeListener: 0, clearUser: 0, setUser: 0 };
    window.__removedIds = [];
    window.RAIL_NATIVE_PLUS_ADAPTER = {
      setUser: async () => { window.__spy.setUser++; },
      getCustomerInfo: async () => ({ entitlements: { active: {} } }),
      getOfferings: async () => ({ all: {}, current: { availablePackages: [] } }),
      addCustomerInfoUpdateListener: async () => { window.__spy.addListener++; return 'r15-cold-listener-id'; },
      removeCustomerInfoUpdateListener: async id => { window.__spy.removeListener++; window.__removedIds.push(id); },
      clearUser: async () => { window.__spy.clearUser++; },
    };
    window.RAIL_FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'x' };
    window.RAIL_FIREBASE_TEST_MODULES = {
      initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}),
      onAuthStateChanged: (auth, cb) => { window.__authCb = cb; },
    };
  }, { staleUid: 'r15-stale-uid' });
  const errs = attach(page, 'R15-cold');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);

  const r = await page.evaluate(async () => {
    await accountEnsureInit(); // 這個裝置本來就會因為 accountReturning()===true 在開機自動初始化(見 R10/R13 同一句註解),這裡等價地直接呼叫,冪等
    const authCbRegistered = typeof window.__authCb === 'function';
    const beforeUser = state.account && state.account.user;
    const beforeUidKey = localStorage.getItem('trainmap-account-uid');
    if (authCbRegistered) await window.__authCb(null); // 冷啟動的第一次 null——這個 session 從未送過 truthy user
    return {
      authCbRegistered, beforeUserIsNull: beforeUser === null, beforeUidKey,
      afterUidKey: localStorage.getItem('trainmap-account-uid'),
      clearUserCalls: window.__spy.clearUser,
      removeListenerCalls: window.__spy.removeListener,
      addListenerCalls: window.__spy.addListener,
    };
  });
  ok('R15-cold-pre 前置條件:進場時裝置上確實留著上次的 ACCOUNT_UID_KEY fallback 痕跡、真的 onAuthStateChanged callback 已註冊、state.account.user 此刻是 null(這才是「冷啟動的第一次 null」要驗的起點,不是巧合)',
    r.authCbRegistered === true && r.beforeUserIsNull === true && r.beforeUidKey === 'r15-stale-uid', JSON.stringify(r));
  ok('R15g 正向對照核心斷言(整合稽核 Minor 1 的邊界情況):冷啟動的第一次 null 不觸發 native adapter 的 clearUser()——這個 session 從來沒有一個已驗證身分可拆,對本來就是訪客的人做這個副作用沒有意義',
    r.clearUserCalls === 0, JSON.stringify(r));
  ok('R15h 正向對照核心斷言:同一次冷啟動 null 也沒有呼叫 removeCustomerInfoUpdateListener——addListenerCalls 也是 0 證明真的從沒註冊過,不是「拆了一個空的」湊巧看起來沒事',
    r.removeListenerCalls === 0 && r.addListenerCalls === 0, JSON.stringify(r));
  ok('R15i 既有行為不受影響(回歸安全網):即使是冷啟動的第一次 null,ACCOUNT_UID_KEY 仍然被清掉——這件事不看 previousUid,見 else 分支最後兩行',
    r.afterUidKey === null, JSON.stringify(r));
  ok('R15-cold 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ R16. 批二-B(整合稽核 Important 2／3):買完 Plus 之後的資格落地握手 ══════════════
// Plus 有兩個獨立的真相,而修復前的程式把它們當同一件事:
//   · 帳務資格(RevenueCat 說有沒有訂閱)—— 買完當下就為真,決定純客端功能。
//   · /entitlements/{uid} 資格文件有沒有落地 —— firestore.rules 讀的是它,它不在時**四個 kind 全滅**。
// 稽核描述的症狀:買完 → 客戶端立刻認為自己是 Plus 而開始同步 → 文件還沒寫好 → permission-denied
// → 退回舊清單(去掉 stations)重試 → 一樣被擋,而 a.legacyKinds 是 session 級旗標且永不重置
// ⇒ 文件之後真的落地了,他每次同步仍然靜默少傳 stations,直到重新整理。
//
// 本段驗的是完整時序:買完 → 文件還沒落地(被擋、降級) → 落地 → 全量補傳,而且斷言落在
// **使用者真正看得到的結果**(收藏站點最後有沒有真的被提交上雲),不是只看旗標值。
//
// 判準的真值來源刻意獨立於被測程式(心得 29):「文件在不在」由本檔在 Node 這一側用 docLanded 掌握,
// 透過 exposeFunction 交給頁面裡的假 Firestore 當 rules 的裁決依據;前端的 state.plus 完全不參與
// 這個裁決。假 Worker 也忠實模擬真 Worker 的因果:/api/plus-status 這條路徑**本身就是資格文件的
// writer**(見 worker.js plusStatus),所以「打它」就是「讓文件落地」,回應的 cloudSyncReady 是那次
// 寫入的結果,不是另一個獨立旗標。假 Firestore 在 **commit 時**才裁決(tx.get 照樣成功——rules 對
// 這四份文件的 read 本來就不要求資格),這樣「嘗試寫了哪些 kind」與「真的提交了哪些 kind」是兩組
// 可分辨的觀測,才測得到「試了但沒上去」這種修復前的實際狀態。
// 期望的 kind 名單、順序與 canonical id 全部是本檔寫死的字面值,不從 USER_DATA_COLLECTIONS 推導。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'R16');
  let workerCanWrite = false, docLanded = false;
  const statusAuth = [];
  await page.exposeFunction('__railDocLanded', () => docLanded);
  await page.route('**/api/plus-status', route => {
    statusAuth.push(route.request().headers()['authorization'] || '');
    if (workerCanWrite) docLanded = true;               // 這條路徑就是 writer:寫得進去 ⇒ 文件此刻落地
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ active: true, cloudSyncReady: workerCanWrite }),
    });
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const UID = 'race-r16-uid';
  const setup = await page.evaluate(async (UID) => {
    window.__attempts = []; window.__commits = [];
    state.plus = null; plusState().active = true;       // 剛買完:帳務資格為真,cloudSyncReady 仍是初始的 false
    state.account = {
      ready: true, syncing: false, lastSync: 0, actionError: '', error: '', syncTimer: 0, gen: 0,
      loggingOut: false, syncSuspended: false, syncPromise: null, legacyKinds: false,
      user: { uid: UID, email: 'r16@example.com' }, auth: {}, db: {},
    };
    // 走產品的儲存函式,不直接寫 localStorage——這兩筆就是下面要看「有沒有真的上雲」的東西。
    userDataSaveCollection('stations', [{ sys: 'tra_sched', name: 'R16_STATION', lat: 25.047675, lon: 121.517055 }]); // stations 的 CleanValue 要求 lat/lon 合法,缺了會被整筆丟掉
    userDataSaveCollection('favs', [{ sys: 'tra_sched', train: 'R16_TRAIN' }]);
    state.account.fb = {
      doc: (db, ...segs) => ({ kind: segs[segs.length - 1] }),
      getIdToken: async () => 'R16_FAKE_ID_TOKEN',      // 握手要 Firebase ID token(見 plusReconcileEntitlement)
      serverTimestamp: () => 'SERVER_TIME_STUB',
      runTransaction: async (db, fn) => {
        const attempt = [];
        const tx = {
          get: async () => ({ exists: () => false, data: () => null }), // rules 允許讀,只有寫要資格
          set: (ref, data) => attempt.push({ kind: ref.kind, ids: (data.items || []).map(i => i.id) }),
        };
        const out = await fn(tx);
        window.__attempts.push(attempt.map(w => w.kind));
        if (!(await window.__railDocLanded())) {        // rules 在 commit 才裁決:文件不在 ⇒ 整筆被擋
          const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e;
        }
        window.__commits.push(attempt);
        return out;
      },
    };
    return {
      plusActive: plusIsActive(), cloudReady: plusCloudSyncReady(),
      stationsLocal: userDataRead(UID).collections.stations.items.map(i => i.id),
    };
  }, UID);
  ok('R16-pre 前置條件:兩個狀態一開始就是分家的——帳務資格已經是 true(剛買完),資格文件落地仍是 false(下面的「被擋」才不是因為他根本沒訂閱)',
    setup.plusActive === true && setup.cloudReady === false, JSON.stringify(setup));
  ok('R16-pre 正向對照:本機真的有一筆收藏站點可以被送上去(id 是 canonical 的「系統別|站名」),不然下面「stations 有沒有上雲」量的是空氣',
    JSON.stringify(setup.stationsLocal) === JSON.stringify(['tra_sched|R16_STATION']), JSON.stringify(setup));

  // ── 第 1 段:文件還沒落地(假 Worker 這一刻寫不進 Firestore)──────────────────────────
  const p1 = await page.evaluate(async () => {
    const r = await accountSyncNow('local-change');
    return {
      r, attempts: window.__attempts.slice(), commits: window.__commits.slice(),
      legacyKinds: state.account.legacyKinds, actionError: state.account.actionError,
      cloudReady: plusCloudSyncReady(), plusActive: plusIsActive(),
    };
  });
  ok('R16a 核心斷言:資格文件還沒落地時,一筆都沒有真的寫上雲(零 commit),而且不對使用者謊稱成功——回傳 false 且面板上留著錯誤訊息',
    p1.r === false && p1.commits.length === 0 && /同步失敗/.test(p1.actionError), JSON.stringify(p1));
  ok('R16b 核心斷言:握手真的發生了——/api/plus-status 被打了 1 次,而且帶著 Bearer 身分(沒帶身分的請求後端只會回 401,等於白打)',
    statusAuth.length === 1 && /^Bearer .+/.test(statusAuth[0] || ''), JSON.stringify({ statusAuth }));
  ok('R16c 核心斷言:被擋時交易次數有上限——整次同步只送出 2 發(第一發全量、第二發是退回舊清單的重試),不是對著註定被 rules 擋下的規則洗版',
    JSON.stringify(p1.attempts) === JSON.stringify([['pins', 'favs', 'rides', 'stations'], ['pins', 'favs', 'rides']]),
    JSON.stringify(p1.attempts));
  ok('R16d 前置事實(下面「收回降級」才有東西可收):文件落地之前,a.legacyKinds 確實被設成 true,而且 cloudSyncReady 仍是 false',
    p1.legacyKinds === true && p1.cloudReady === false, JSON.stringify(p1));

  // ── 第 2 段:文件落地(假 Worker 這一刻寫得進去)──────────────────────────────────────
  workerCanWrite = true;
  const p2 = await page.evaluate(async () => {
    const r = await accountSyncNow('local-change');
    return {
      r, attempts: window.__attempts.slice(), commits: window.__commits.slice(),
      legacyKinds: state.account.legacyKinds, actionError: state.account.actionError,
      cloudReady: plusCloudSyncReady(), plusActive: plusIsActive(), lastSync: state.account.lastSync,
    };
  });
  ok('R16e 核心斷言:資格文件落地的那一刻,之前的降級被收回來——a.legacyKinds 變回 false(修復前它是 session 級旗標且永不重置)',
    p2.legacyKinds === false, JSON.stringify(p2));
  ok('R16f 核心斷言(使用者真正看得到的結果):落地後那一次同步真的把四個 kind 全量提交上雲,而且 stations 裡就是他那筆收藏站點——降級期間沒上去的東西補上去了',
    p2.commits.length === 1
      && JSON.stringify(p2.commits[0].map(w => w.kind)) === JSON.stringify(['pins', 'favs', 'rides', 'stations'])
      && JSON.stringify((p2.commits[0].find(w => w.kind === 'stations') || {}).ids) === JSON.stringify(['tra_sched|R16_STATION']),
    JSON.stringify(p2.commits));
  ok('R16g 核心斷言(時序):這一輪的兩發交易依序是「舊清單(還在降級中)→ 握手成功後的全量重試」——證明全量那發是握手促成的,不是第一發就送全量碰巧成功',
    JSON.stringify(p2.attempts.slice(2)) === JSON.stringify([['pins', 'favs', 'rides'], ['pins', 'favs', 'rides', 'stations']]),
    JSON.stringify(p2.attempts));
  ok('R16h 兩個狀態各自到位:資格文件落地後 plusCloudSyncReady() 變 true、plusIsActive() 仍是 true,而且這次同步回傳 true、錯誤訊息被清掉',
    p2.cloudReady === true && p2.plusActive === true && p2.r === true && p2.actionError === '' && p2.lastSync > 0, JSON.stringify(p2));
  ok('R16i 握手每次同步最多一次:這一輪只多打 1 發 /api/plus-status(累計 2),重試不會再打一次',
    statusAuth.length === 2, JSON.stringify({ statusAuth }));

  // ── 第 3 段:握手成功之後不再重打 ────────────────────────────────────────────────────
  const p3 = await page.evaluate(async () => {
    const before = window.__attempts.length;
    const r = await accountSyncNow('local-change');
    return { r, newAttempts: window.__attempts.slice(before), commits: window.__commits.length };
  });
  ok('R16j 握手不重打:資格文件已確認落地之後,再同步一次完全不碰 /api/plus-status(累計仍是 2),而且交易一發就成功',
    statusAuth.length === 2 && p3.r === true
      && JSON.stringify(p3.newAttempts) === JSON.stringify([['pins', 'favs', 'rides', 'stations']]) && p3.commits === 2,
    JSON.stringify({ statusAuth, p3 }));
  ok('R16 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ R17. 批二-B:購買完成當下就主動握手,不等第一次同步撞牆 ══════════════
// R16 驗的是「撞上 permission-denied 之後補救」這條被動路徑。這一段驗主動路徑:買完就先確認資格
// 文件落地,讓使用者的第一次同步一次就成功——購買之前他的所有本機變更都被資格閘門擋著沒上雲
// (見 accountSyncNow 的閘門),握手之後那次全量同步才是它們第一次有機會上去。
// 走的是真的 plusPurchase()(商店替身比照 verify_plus_subscription 的 injectPlus),不是手動設旗標。
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'R17');
  let docLanded = false;
  const statusAuth = [];
  await page.exposeFunction('__railDocLanded', () => docLanded);
  await page.route('**/api/plus-status', route => {
    statusAuth.push(route.request().headers()['authorization'] || '');
    docLanded = true;                                    // 打它＝資格文件落地(同 R16 的因果)
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ active: true, cloudSyncReady: true }) });
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const UID = 'race-r17-uid';
  const before = await page.evaluate(async (UID) => {
    window.__attempts = []; window.__commits = [];
    state.plus = null;
    state.account = {
      ready: true, syncing: false, lastSync: 0, actionError: '', error: '', syncTimer: 0, gen: 0,
      loggingOut: false, syncSuspended: false, syncPromise: null, legacyKinds: false,
      user: { uid: UID, email: 'r17@example.com' }, auth: {}, db: {},
      fb: {
        doc: (db, ...segs) => ({ kind: segs[segs.length - 1] }),
        getIdToken: async () => 'R17_FAKE_ID_TOKEN',
        serverTimestamp: () => 'SERVER_TIME_STUB',
        runTransaction: async (db, fn) => {
          const attempt = [];
          const tx = {
            get: async () => ({ exists: () => false, data: () => null }),
            set: (ref, data) => attempt.push({ kind: ref.kind, ids: (data.items || []).map(i => i.id) }),
          };
          const out = await fn(tx);
          window.__attempts.push(attempt.map(w => w.kind));
          if (!(await window.__railDocLanded())) { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e; }
          window.__commits.push(attempt);
          return out;
        },
      },
    };
    userDataSaveCollection('stations', [{ sys: 'tra_sched', name: 'R17_STATION', lat: 25.047675, lon: 121.517055 }]); // 同 R16:stations 需要合法 lat/lon
    const blocked = await accountSyncNow('local-change'); // 購買之前:被資格閘門擋在 Firestore 之外
    // 商店替身(同 verify_plus_subscription injectPlus 的形狀):買下去才變成有資格。
    window.RAIL_REVENUECAT_CONFIG = { entitlement: 'plus', offeringId: 'plus' };
    let sub = false;
    const info = () => ({ entitlements: { active: sub ? { plus: { identifier: 'plus' } } : {} }, managementURL: '' });
    const offering = { availablePackages: [{ identifier: '$rc_annual', packageType: 'ANNUAL', webBillingProduct: { currentPrice: { formattedPrice: 'NT$1' } } }] };
    window.RAIL_PLUS_TEST_ADAPTER = {
      setUser: async () => {}, getCustomerInfo: async () => info(),
      getOfferings: async () => ({ all: { plus: offering }, current: offering }),
      purchase: async () => { sub = true; return { customerInfo: info() }; },
      restore: async () => info(),
    };
    await plusRefresh();                                  // 備妥 adapter 與方案(真實流程打開面板時就會做)
    return {
      blocked, attemptsBefore: window.__attempts.length,
      plusActive: plusIsActive(), cloudReady: plusCloudSyncReady(), hasPkg: !!(state.plus && state.plus.pkgAnnual),
    };
  }, UID);
  ok('R17-pre 正向對照:購買之前同步被資格閘門擋下——一發交易都沒送出去、回傳 false,而且兩個狀態都還是 false',
    before.blocked === false && before.attemptsBefore === 0 && before.plusActive === false && before.cloudReady === false,
    JSON.stringify(before));
  ok('R17-pre 前置條件:商店替身備妥了年訂方案(下面 plusPurchase 才叫得動),而且此刻一發 /api/plus-status 都還沒打過',
    before.hasPkg === true && statusAuth.length === 0, JSON.stringify({ before, statusAuth }));

  const after = await page.evaluate(async () => {
    await plusPurchase('annual');
    // 購買流程內的 accountSyncNow('entitlement') 是 fire-and-forget,等它自己收斂(不猜固定秒數)。
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) {
      if (state.account.syncPromise) { try { await state.account.syncPromise; } catch (e) {} }
      else if (!state.account.syncing) break;
      await new Promise(r => setTimeout(r, 10));
    }
    return {
      plusActive: plusIsActive(), cloudReady: plusCloudSyncReady(),
      attempts: window.__attempts.slice(), commits: window.__commits.slice(),
      legacyKinds: state.account.legacyKinds, lastSync: state.account.lastSync,
    };
  });
  ok('R17a 核心斷言:購買完成當下就打了 1 次 /api/plus-status——握手是購買流程主動做的,不是等第一次同步撞上 permission-denied 才補救',
    statusAuth.length === 1 && /^Bearer .+/.test(statusAuth[0] || ''), JSON.stringify({ statusAuth }));
  ok('R17b 核心斷言(使用者真正看得到的結果):握手之後真的補了一次全量同步,四個 kind 全部提交,stations 裡就是購買前存下的那筆站點',
    after.commits.length === 1
      && JSON.stringify(after.commits[0].map(w => w.kind)) === JSON.stringify(['pins', 'favs', 'rides', 'stations'])
      && JSON.stringify((after.commits[0].find(w => w.kind === 'stations') || {}).ids) === JSON.stringify(['tra_sched|R17_STATION']),
    JSON.stringify(after.commits));
  ok('R17c 兩個狀態都到位:購買後 plusIsActive() 與 plusCloudSyncReady() 都是 true,而且第一次同步就成功(lastSync 有值、沒有進入降級)',
    after.plusActive === true && after.cloudReady === true && after.lastSync > 0 && after.legacyKinds === false, JSON.stringify(after));
  ok('R17 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
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
