// 訪客紀錄併入帳號（2026-09-01 兩位 Android 使用者「完乘紀錄／打卡護照／累積里程全空」事故的修法）行為驗證
// ——Playwright 真引擎（chromium＋webkit）＋本機靜態伺服器，全程真登入路徑、真點擊。
//
// 本腳本未參與實作；以下是我從 index.html 讀出、供本腳本判準依據的關鍵事實：
//
//   · userDataMigrateAccountPartition(uid)：帳號分區第一次被讀取時，若
//     localStorage['trainmap-account-last-uid']（ACCOUNT_LAST_UID_KEY）不存在或等於這個 uid，
//     從匿名分區（'trainmap-user-data-v1'）繼承；否則給【空白 envelope】——這就是事故現場：
//     這台裝置「還記著別的帳號」的人一登入，四個 collection 全部讀不到，而資料其實一筆沒少，
//     還躺在匿名分區裡。旅程護照的章、趟數與總里程全部由 rides 現算（renderPassport），
//     所以「一份 rides 讀不到」在使用者眼裡長成三個症狀。
//   · 修法只補「本人要怎麼把自己的東西拿回來」這一半：帳號面板多一顆
//     [data-action="guest-merge"]，走既有的 userDataMergeEnvelopes()（union＋逐筆 LWW＋
//     tombstone 勝出），不另寫一套合併規則。
//   · guestDataPending(uid)：把匿名分區併進來會【多幾筆】——0 就不打擾使用者（已併過的、
//     以及本來就共用同一份的都落在這裡）。它是拿真正的 merge 結果去比，不是數匿名分區有幾筆。
//   · guestDataMerge(uid)：userDataWrite(merge(帳號分區, 匿名分區), uid)。刻意【不清匿名分區】。
//   · 合併語意（userDataMergeEnvelopes）：同 id 取 updatedAt 較大者；tombstone 的 deletedAt
//     >= item.updatedAt 時該 id 被刪除。故「帳號裡刪掉的那筆」不會被訪客那份復活。
//
// 環境條件（不是產品規格，寫在這裡免得日後被誤讀成判準；心得 34）：
//   · 語系必須釘死 zh-TW——判準比對的是中文字面，Playwright chromium 預設 en-US 會讓它們
//     全數假紅。三重釘死：goto 的 ?lang=zh-TW（I18N_LANG 是載入當下凍結的，evaluate 塞不進去）、
//     newContext 的 locale、localStorage。並用 L0 具名閘門把「真的釘住了」變成一條斷言。
//   · renderPassport() 只在 state.mode === 'sched' 才畫（預設是 'freq'）。各情境在登入【之前】
//     就切好，讓登入的 userDataRenderAll() 自己把護照畫出來——量到的是真實渲染路徑。
//   · Firebase 走 window.RAIL_FIREBASE_TEST_MODULES 短路（既有慣例，見 verify_account_sync_race）：
//     onAuthStateChanged 真的被呼叫、userDataMigrateAccountPartition／ACCOUNT_UID_KEY 寫入
//     全走真程式碼，只有「向 Google 驗證」這一步是替身。不給 Plus 資格 ⇒ accountSyncNow 被
//     plusIsActive() 擋下（回 false，不碰網路），這正是絕大多數受害者的真實狀態。
//
// 突變測試（2026-09-01，四發各指名一層防線；控制組＝全部還原後兩顆引擎 73/73 全綠）：
//   M1 拔掉【UI 入口】(guestPending ? … : '') 改成 false ⇒ 16 條紅（S1/S3/S4 的框、鈕、
//      點擊、資料、護照、吐司全滅）。S2 維持全綠——它斷言的正是「不該有鈕」，這個不對稱
//      本身就是 S2 不是 S1 的鏡像的證據。
//   M2 拔掉【真的寫進去】guestDataMerge 改成 return true ⇒ 6 條紅（S1g/S1h/S1j、S3f/S3g、
//      S4b）。框與鈕照畫、pending 照算，只有「按了到底有沒有落地」轉紅。
//   M3 拔掉【偵測】guestDataPending 恆回 9 ⇒ 7 條紅，含 S2b/S2c 兩條反向對照——
//      這一發是唯一能證明「按鈕不是無條件出現」有牙的實驗。
//   M4 拔掉【合併語意】改成整份覆蓋 userDataWrite(guest, uid) ⇒ 只有 S3d/S3e 紅，
//      S1 全部照樣綠。這正是 S3 存在的理由：盲蓋會通過 S1 的每一條。
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// G0 自檢（心得 32：驗收腳本第一道 gate 要印出驗的是哪個目錄）：ROOT 由本檔自身路徑推導，
// 不吃任何 --root/env 參數，結構上不會誤驗到別的 worktree。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_MD5 = createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${INDEX_MD5}`);

const PORT = Number(process.env.PORT || 5471);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    res.statusCode = 200; res.setHeader('content-type', 'application/json');
    // 空物件對高鐵班表是「200＝成功」⇒ fallbackUrl 永不啟動 ⇒ applySchedSystems 迭代 undefined
    // ⇒ boot 停在 state.ready 之前 ⇒ waitReady 逾時（全 repo 同類腳本共用的慣例）。
    if (url.pathname === '/api/thsr-schedule') return res.end(readFileSync(path.join(ROOT, 'data/thsr_schedule_dense.json')));
    return res.end('{}');
  }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise((resolve, reject) => { server.on('error', reject); server.listen(PORT, resolve); });
const BASE = `http://localhost:${PORT}/?lang=zh-TW`;

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

{
  const served = createHash('md5').update(Buffer.from(await (await fetch(BASE)).arrayBuffer())).digest('hex');
  ok('G0 伺服器吐出的 index.html 與 ROOT 逐 byte 相同（證明下面驗的是這棵樹的產物）', served === INDEX_MD5, `served=${served} root=${INDEX_MD5}`);
}

const ME = 'guest-merge-me-uid';
const STRANGER = 'guest-merge-stranger-uid';

// 匿名分區的五筆（四個 collection 都有，因為事故回報是「完乘紀錄」「打卡護照」「累積里程」
// 三個症狀，但真正該驗的是四份資料一起回來）。rides 帶 km 讓護照的總里程有真值可比：60+40=100。
function fixtures() {
  return {
    guestRides: [
      { train: '1234', sys: 'tra_sched', date: '2026-08-20', km: 60 },
      { train: '5678', sys: 'tra_sched', date: '2026-08-21', km: 40 },
    ],
    guestFav: { train: '1234', sys: 'tra_sched' },
    guestStation: { name: '台北', lat: 25.047675, lon: 121.517055, sys: 'metro' },
    guestPin: { lat: 24.1477, lon: 120.6736, label: '台中' },
    accountRide: { train: '9999', sys: 'tra_sched', date: '2026-08-22', km: 5 },
  };
}

async function scenario(browser, engine, tag, { lastUid = '', seedAccount = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
  await ctx.addInitScript((arg) => {
    const now = Date.now(), older = now - 86400000; // 訪客那份「比較舊」——墓碑情境才有意義
    const item = (id, value, updatedAt) => ({ id, value, updatedAt });
    try {
      localStorage.setItem('trainmap-howto-seen', '1'); // 首訪教學卡會蓋住整張地圖
      localStorage.setItem('trainmap-language', 'zh-TW');
      localStorage.setItem('trainmap-user-data-v1', JSON.stringify({
        version: 1, deviceId: 'guest-device', revision: 4, updatedAt: older,
        collections: {
          pins: { items: [item('24.147700,120.673600', arg.f.guestPin, older)], tombstones: [] },
          favs: { items: [item('tra_sched|1234', arg.f.guestFav, older)], tombstones: [] },
          rides: {
            items: arg.f.guestRides.map(r => item(`tra_sched|${r.train}|${r.date}`, r, older)),
            tombstones: [],
          },
          stations: { items: [item('metro|台北', arg.f.guestStation, older)], tombstones: [] },
        },
      }));
      if (arg.lastUid) localStorage.setItem('trainmap-account-last-uid', arg.lastUid);
      if (arg.seedAccount) localStorage.setItem('trainmap-user-data-v1:uid:' + arg.uid, JSON.stringify({
        version: 1, deviceId: 'account-device', revision: 2, updatedAt: now,
        collections: {
          pins: { items: [], tombstones: [] },
          favs: { items: [], tombstones: [] },
          rides: {
            items: [item('tra_sched|9999|2026-08-22', arg.f.accountRide, now)],
            // 這個帳號裡「已經刪掉」訪客那筆 1234：deletedAt 比訪客的 updatedAt 新 ⇒ 合併後不得復活
            tombstones: [{ id: 'tra_sched|1234|2026-08-20', deletedAt: now }],
          },
          stations: { items: [], tombstones: [] },
        },
      }));
    } catch (e) {}
    window.RAIL_FIREBASE_CONFIG = { apiKey: 'x', authDomain: 'x', projectId: 'x' };
    window.RAIL_FIREBASE_TEST_MODULES = {
      initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}),
      onAuthStateChanged: (auth, cb) => { setTimeout(() => cb({ uid: arg.uid, email: 'me@example.com', displayName: '測試使用者' }), 30); },
    };
  }, { uid: ME, lastUid, seedAccount, f: fixtures() });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`[${tag}] pageerror: ${e}`));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/^Failed to load resource: the server responded with a status of/.test(m.text())) return;
    errors.push(`[${tag}] console.error: ${m.text().slice(0, 200)}`);
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { try { return typeof state !== 'undefined' && state.ready === true; } catch (e) { return false; } }, null, { timeout: 40000 });
  await page.waitForTimeout(250);

  // 語系閘門：中文字面判準的唯一前提。放在登入前，紅的時候一眼看得出是環境不是回歸。
  const lang = await page.evaluate(() => (typeof I18N_LANG === 'undefined' ? '(未定義)' : I18N_LANG));
  ok(`L0 ${engine} ${tag} 語系釘死在 zh-TW（下面所有中文字面判準的前提）`, lang === 'zh-TW', `I18N_LANG=${lang}`);

  // 護照只在 sched 模式畫；登入【前】切好，讓登入時的 userDataRenderAll() 走真實渲染路徑。
  await page.evaluate(() => { state.mode = 'sched'; renderPassport(); });

  await page.evaluate(() => { accountEnsureInit(); });
  const loggedIn = await page.waitForFunction(uid => state.account && state.account.user && state.account.user.uid === uid, ME, { timeout: 15000 })
    .then(() => true).catch(() => false);
  ok(`L1 ${engine} ${tag} 前置條件：真的走完 onAuthStateChanged 登入路徑（這條紅＝下面全部沒驗到）`, loggedIn === true, `loggedIn=${loggedIn}`);
  await page.waitForTimeout(300); // 讓 render/plusRefresh/accountSyncNow 收尾

  return { ctx, page, errors };
}

const snapshot = page => page.evaluate(() => ({
  rides: userDataLoadCollection('rides').map(x => `${x.sys}|${x.train}|${x.date}`).sort(),
  favs: userDataLoadCollection('favs').map(x => `${x.sys || 'tra_sched'}|${x.train}`).sort(),
  stations: userDataLoadCollection('stations').map(x => `${x.sys}|${x.name}`).sort(),
  pins: userDataLoadCollection('pins').map(x => x.label || '').sort(),
  pending: guestDataPending(state.account.user.uid),
  passport: (document.getElementById('passport').querySelector('.ph-stats') || {}).textContent || '(沒有 .ph-stats)',
  anonItems: (() => {
    try {
      const env = JSON.parse(localStorage.getItem('trainmap-user-data-v1'));
      return ['pins', 'favs', 'rides', 'stations'].reduce((n, k) => n + env.collections[k].items.length, 0);
    } catch (e) { return -1; }
  })(),
  btn: !!document.querySelector('#accountBody [data-action="guest-merge"]'),
  // 🔴 一定要指名 .guestbox：面板裡有三個 .account-syncbox（跨裝置同步／通行證／訪客紀錄），
  // 只寫 .account-syncbox 抓到的是第一個，判準會變成在量別人（形態 0：沒證明我在量的是誰）。
  boxText: (document.querySelector('#accountBody .account-syncbox.guestbox') || {}).textContent || '',
  err: (document.querySelector('#accountBody .account-error') || {}).textContent || '',
}));

async function clickMerge(page, engine, tag) {
  try {
    await page.click('#accountBody [data-action="guest-merge"]', { timeout: 5000 });
    return true;
  } catch (e) {
    // 點不到就記一條 FAIL 往下走，不讓 TimeoutError 把整支腳本以未捕捉例外中止
    // （中止會讓後面的斷言連同總計行一起消失＝假綠的一種）。
    ok(`${engine} ${tag} 併入鈕點得到`, false, String(e).split('\n')[0].slice(0, 90));
    return false;
  }
}

async function runEngine(browser, engine) {
  // ══════════ S1 主要情境：這台裝置記著別的帳號 → 登入後四份資料全空 → 按鈕 → 真點 → 回來 ══════════
  {
    const { ctx, page, errors } = await scenario(browser, engine, 'S1', { lastUid: STRANGER });
    const before = await snapshot(page);
    ok(`S1a ${engine} 事故重現：記著別的帳號時登入，rides／favs／stations／pins 四份【全部】讀不到`,
      before.rides.length === 0 && before.favs.length === 0 && before.stations.length === 0 && before.pins.length === 0,
      JSON.stringify({ rides: before.rides.length, favs: before.favs.length, stations: before.stations.length, pins: before.pins.length }));
    ok(`S1b ${engine} 事故重現（使用者看到的那一面）：旅程護照顯示 0 趟、總里程 0 km`,
      /完乘\s*0\s*趟/.test(before.passport) && /總里程\s*0\s*km/.test(before.passport), before.passport.trim());
    ok(`S1c ${engine} guestDataPending 算出「併進來會多 5 筆」（不是數匿名分區有幾筆的巧合——S3 用同一支函式驗 4 筆）`,
      before.pending === 5, `pending=${before.pending}`);

    await page.evaluate(() => accountOpen());
    const opened = await snapshot(page);
    ok(`S1d ${engine} 帳號面板出現訪客紀錄提示框與併入鈕`, opened.btn === true && !!opened.boxText, `btn=${opened.btn} boxText=${opened.boxText.slice(0, 60)}`);
    ok(`S1e ${engine} 提示文字把「5 筆」講出來（數字來自 guestDataPending，不是寫死的話術）`,
      /5\s*筆/.test(opened.boxText), opened.boxText.slice(0, 80));

    const clicked = await clickMerge(page, engine, 'S1');
    await page.waitForTimeout(200);
    const after = await snapshot(page);
    ok(`S1f ${engine} 真的點下去（不是只檢查 DOM 裡有這顆鈕）`, clicked === true);
    ok(`S1g ${engine} 併入後四份資料【全部】回來：2 趟完乘＋1 筆最愛列車＋1 座車站＋1 個釘選`,
      JSON.stringify(after.rides) === JSON.stringify(['tra_sched|1234|2026-08-20', 'tra_sched|5678|2026-08-21']) &&
      JSON.stringify(after.favs) === JSON.stringify(['tra_sched|1234']) &&
      JSON.stringify(after.stations) === JSON.stringify(['metro|台北']) &&
      JSON.stringify(after.pins) === JSON.stringify(['台中']),
      JSON.stringify({ rides: after.rides, favs: after.favs, stations: after.stations, pins: after.pins }));
    ok(`S1h ${engine} 旅程護照當場重畫成 2 趟、總里程 100 km（三個症狀的共同來源真的復原了）`,
      /完乘\s*2\s*趟/.test(after.passport) && /總里程\s*100\s*km/.test(after.passport), after.passport.trim());
    const toast = await page.evaluate(() => (document.getElementById('toasts') || {}).textContent || '');
    ok(`S1i ${engine} 有明確回饋：吐司說「訪客紀錄已併入這個帳號」`, /訪客紀錄已併入這個帳號/.test(toast), toast.trim().slice(0, 60));
    ok(`S1j ${engine} 冪等：併完 pending 歸零、按鈕自己消失（重複按不會出事，也不再打擾）`,
      after.pending === 0 && after.btn === false, JSON.stringify({ pending: after.pending, btn: after.btn }));
    ok(`S1k ${engine} 併入不是破壞性動作：匿名分區原封不動還在（這台裝置的別的帳號還用得到）`,
      after.anonItems === 5, `anonItems=${after.anonItems}`);
    ok(`S1 ${engine} 本情境零 pageerror／console.error`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ══════════ S2 反向對照：沒有記著別的帳號 → 首次登入本來就會繼承 → 不該冒出這顆鈕 ══════════
  // 這是「按鈕不是無條件出現」的唯一證據。少了它，把 guestDataPending 寫成 return 9 也會全綠。
  {
    const { ctx, page, errors } = await scenario(browser, engine, 'S2', { lastUid: '' });
    await page.evaluate(() => accountOpen());
    const s = await snapshot(page);
    ok(`S2a ${engine} 正向對照：沒記著別的帳號時，首次登入本來就把訪客資料繼承進來了（2 趟完乘）`,
      s.rides.length === 2 && s.favs.length === 1 && s.stations.length === 1 && s.pins.length === 1,
      JSON.stringify({ rides: s.rides.length, favs: s.favs.length, stations: s.stations.length, pins: s.pins.length }));
    ok(`S2b ${engine} 這種人 guestDataPending 是 0——沒有東西可併，不要拿這件事打擾他`, s.pending === 0, `pending=${s.pending}`);
    ok(`S2c ${engine} 反向對照：帳號面板【不】出現併入鈕`, s.btn === false, `btn=${s.btn}`);
    ok(`S2 ${engine} 本情境零 pageerror／console.error`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ══════════ S3 合併語意：不覆蓋帳號既有資料、也不復活帳號裡刪掉的那筆 ══════════
  // 若把 guestDataMerge 寫成「拿訪客那份直接蓋掉帳號分區」，S1 全部照樣綠——只有這一節會紅。
  {
    const { ctx, page, errors } = await scenario(browser, engine, 'S3', { lastUid: STRANGER, seedAccount: true });
    const before = await snapshot(page);
    ok(`S3a ${engine} 前置條件：帳號分區本來就有自己的一筆完乘（9999）與一筆刪除紀錄（1234）`,
      JSON.stringify(before.rides) === JSON.stringify(['tra_sched|9999|2026-08-22']), JSON.stringify(before.rides));
    ok(`S3b ${engine} pending 算的是「真的會多幾筆」：5 筆訪客資料裡有 1 筆被帳號的刪除紀錄擋掉 ⇒ 4`,
      before.pending === 4, `pending=${before.pending}`);

    await page.evaluate(() => accountOpen());
    const clicked = await clickMerge(page, engine, 'S3');
    await page.waitForTimeout(200);
    const after = await snapshot(page);
    ok(`S3c ${engine} 真的點下去`, clicked === true);
    ok(`S3d ${engine} 不覆蓋：帳號自己的那筆完乘（9999）併完仍在`, after.rides.includes('tra_sched|9999|2026-08-22'), JSON.stringify(after.rides));
    ok(`S3e ${engine} 墓碑勝出：帳號裡已刪掉的 1234 不會被訪客那份復活`, !after.rides.includes('tra_sched|1234|2026-08-20'), JSON.stringify(after.rides));
    ok(`S3f ${engine} 沒被刪過的 5678 照常併進來（證明 S3e 不是「整批沒併」的巧合）`, after.rides.includes('tra_sched|5678|2026-08-21'), JSON.stringify(after.rides));
    ok(`S3g ${engine} 併完 pending 歸零、鈕消失`, after.pending === 0 && after.btn === false, JSON.stringify({ pending: after.pending, btn: after.btn }));
    ok(`S3 ${engine} 本情境零 pageerror／console.error`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ══════════ S4 失敗路徑：寫不進去（儲存空間滿）要說出來，不能靜靜地什麼都沒發生 ══════════
  {
    const { ctx, page, errors } = await scenario(browser, engine, 'S4', { lastUid: STRANGER });
    await page.evaluate(() => accountOpen());
    // 只讓「寫入」失敗（模擬 QuotaExceeded），讀取與合併照常——這正是 guestDataMerge 回 false 的路徑。
    await page.evaluate(() => { window.__realWrite = window.userDataWrite; window.userDataWrite = () => false; });
    const clicked = await clickMerge(page, engine, 'S4');
    await page.waitForTimeout(200);
    const s = await page.evaluate(() => ({
      err: (document.querySelector('#accountBody .account-error') || {}).textContent || '',
      rides: userDataLoadCollection('rides').length,
      btn: !!document.querySelector('#accountBody [data-action="guest-merge"]'),
    }));
    ok(`S4a ${engine} 真的點下去`, clicked === true);
    ok(`S4b ${engine} 寫入失敗時畫面出現紅字（不是點了沒反應）`, /併入失敗/.test(s.err), s.err.slice(0, 60) || '(沒有 .account-error)');
    ok(`S4c ${engine} 失敗時資料維持原狀、鈕還在（使用者可以再試一次）`, s.rides === 0 && s.btn === true, JSON.stringify(s));
    await page.evaluate(() => { window.userDataWrite = window.__realWrite; });
    ok(`S4 ${engine} 本情境零 pageerror／console.error`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
}

// 突變測試時可用 ENGINES=chromium 只跑一顆引擎（省一半牆鐘）；預設兩顆都跑，
// 正式驗收與控制組一律不要帶這個 env——WebKit 是 macOS/iOS 使用者的真引擎。
const ENGINES = (process.env.ENGINES || 'chromium,webkit').split(',').map(x => x.trim());
for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]].filter(([name]) => ENGINES.includes(name))) {
  const browser = await launcher.launch();
  try { await runEngine(browser, engine); } finally { await browser.close(); }
}

server.close();
const failed = results.filter(r => !r.pass);
console.log(`\n總計 ${results.length} 項，通過 ${results.length - failed.length}，失敗 ${failed.length}`);
if (failed.length) { failed.forEach(f => console.log(`  FAIL ${f.name}${f.detail ? ' — ' + f.detail : ''}`)); process.exit(1); }
