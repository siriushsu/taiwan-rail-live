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
//   · userDataMigrateAccountPartition(uid):分區第一次被讀取時,若裝置記錄的上一個同步帳號
//     (localStorage['trainmap-last-sync-uid'])不存在或等於這個 uid,從匿名分區繼承既有資料
//     (userDataRead(null));否則(上一個同步帳號是別人)給空白 envelope——不把陌生帳號的
//     殘留資料繼承給新登入的人。遷移結果立即寫回分區 key,故重複讀取天然冪等。
//   · userDataSaveCollection(kind,values)/userDataRead()/userDataWrite() 這些既有產品函式全部
//     透過上述兩個新參數的預設值自動依登入狀態切換分區,呼叫端(收藏/釘選/完乘紀錄等既有程式碼)
//     完全不用跟著改。
//   · state.account.fb 的 Firestore stub 手法沿用 verify_plus_subscription.mjs Section H/P 既有慣例:
//     doc()/runTransaction()「有沒有被呼叫到」與 tx.set() 記錄的內容都可以當判準,不看回傳值巧合。
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

    release(); // 放行 gate,讓 p1 的 transaction 真正跑完
    await window.__p1;
    await window.__p2;

    const finalPartition = userDataRead(UID);
    return {
      midP1Syncing, midLoggingOut,
      midUnchanged: midPartition === preKey,
      txnCalls,
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

// ══════════════ R4. uid 分區:登出後登入另一個帳號,看不到前一帳號的項目;正向對照:前一帳號的資料仍完好 ══════════════
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'R4');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const r = await page.evaluate(() => {
    state.account = { user: { uid: 'race-r4-a' } };
    userDataSaveCollection('favs', [{ train: 'R4_A_TRAIN' }]);

    // 換成另一個帳號——刻意不呼叫 accountClearLocal(模擬「萬一某個路徑忘了清」的最壞情況):
    // 分區隔離本身就必須擋下污染,不能只靠登出時的清空機制。
    state.account = { user: { uid: 'race-r4-b' } };
    const bSeesABeforeWrite = userDataRead('race-r4-b').collections.favs.items.some(x => x.value.train === 'R4_A_TRAIN');
    userDataSaveCollection('favs', [{ train: 'R4_B_TRAIN' }]);

    const bFavs = userDataRead('race-r4-b').collections.favs.items.map(x => x.value.train).sort();
    const aFavs = userDataRead('race-r4-a').collections.favs.items.map(x => x.value.train).sort(); // 正向對照:A 自己的分區
    return { bSeesABeforeWrite, bFavs, aFavs };
  });
  ok('R4a 換成帳號 B 之後,B 的分區(即使沒被清空過)一開始就不含 A 的項目', r.bSeesABeforeWrite === false, JSON.stringify(r));
  ok('R4b 帳號 B 自己新增的收藏只有自己的項目,不含 A 的', JSON.stringify(r.bFavs) === JSON.stringify(['R4_B_TRAIN']), JSON.stringify(r));
  ok('R4c 正向對照:帳號 A 自己的分區資料完好如初(不是被銷毀,只是換人看不到)',
    JSON.stringify(r.aFavs) === JSON.stringify(['R4_A_TRAIN']), JSON.stringify(r));
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
    const lastUidBefore = localStorage.getItem('trainmap-last-sync-uid');

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
  ok('R5 前置條件:這台裝置從未有任何帳號同步過(trainmap-last-sync-uid 不存在)', r.lastUidBefore === null, `lastUidBefore=${r.lastUidBefore}`);
  ok('R5a 遷移不遺失資料:改版前(匿名)寫入的既有釘選,第一次以帳號 uid 讀取時完整繼承進來',
    r.firstHasPin === true, JSON.stringify(r));
  ok('R5b 遷移冪等:同一個 uid 連續讀取兩次,結果逐位元組相同(第二次是直接命中分區 key,沒有重跑遷移)',
    r.idempotent === true, JSON.stringify(r));
  ok('R5c 匿名分區本身沒有被搬空:遷移是「繼承一份」,不是「移走」', r.anonymousStillHasPin === true, JSON.stringify(r));
  ok('R5 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ══════════════ R6. 遷移安全網:上一個同步過的帳號是「別人」時,不繼承陌生帳號的殘留資料 ══════════════
{
  const { ctx, page } = await newPage(chromiumB);
  const errs = attach(page, 'R6');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  const r = await page.evaluate(() => {
    userDataSaveCollection('pins', [{ lat: 25.05, lon: 121.52, label: 'R6_STRANGER_PIN' }]);
    localStorage.setItem('trainmap-last-sync-uid', 'race-r6-someone-else'); // 裝置上一個同步過的帳號是別人

    state.account = { user: { uid: 'race-r6-new-uid' } };
    const migrated = userDataRead('race-r6-new-uid');
    return { inheritedStrangerPin: migrated.collections.pins.items.some(x => x.value.label === 'R6_STRANGER_PIN') };
  });
  ok('R6 遷移安全網有牙:上一個同步帳號是別人時,新登入帳號的分區不會繼承陌生帳號留在共用 key 裡的資料',
    r.inheritedStrangerPin === false, JSON.stringify(r));
  ok('R6 本輪零 pageerror/console.error', errs.length === 0, errs.slice(0, 3).join(' | '));
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
