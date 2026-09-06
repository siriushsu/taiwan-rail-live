#!/usr/bin/env node
// 網站出貨鏈（railisland.tw 正式站）——固化成唯一入口：npm run ship-web [-- --ref <ref>] [--preview]
//
// --preview：只做到 upload（不升 100%），給使用者親試用。預覽也走同一條乾淨樹＋strip，
// 因為預覽的用途是「試那顆待出貨的產物」——上傳未 strip 的原始檔，等於試的跟要出的不是同一份，
// 而且它一旦被 promote 就是把去註解靜默退掉（本檔開頭那個 08-27 事故的成因）。
// 🔴 預覽 URL 在 Cloudflare Access 後面：curl／Playwright 只會拿到登入頁，自動化驗不了，
// 只有使用者本人開得起來——所以這條路徑刻意沒有收貨檢查，不要假裝有。
//
// 為什麼要有這條：去註解（strip_ship_comments）是出貨的必經步驟，但它以前只是一個獨立
// npm script——任何一次「直接 wrangler versions upload」都會把原始檔出上去，去註解靜默
// 回歸（2026-08-27 音樂曲庫那次部署就是這樣把 08-26 的去註解版蓋掉的）。這支把
// 乾淨 worktree → strip（自帶 esbuild 逐 byte 等價證明）→ 上傳 → 升 100% → 對正式站
// 逐 byte 收貨 整條固化。防呆全是實際踩過的坑：
//  - 只從乾淨 detached worktree 出貨（wrangler 傳磁碟檔，.gitignore 管不到未追蹤檔）
//  - 出貨基準落後 origin/main 就停（整包替換會退掉別人的 commit）
//  - 內容與正式站不同但 BUILD 字串相同就停（內容不同的兩顆不准共用版號）
//  - versions deploy 的版本 ID 只取自同一次 upload 的輸出（versions list 取 [0] 會拿到最舊版）
//  - 收貨判準＝正式站 md5 與本地 stripped 檔逐 byte 相等（不是 BUILD 字串、不是抽 grep）

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

const args = process.argv.slice(2);
const REF = (() => { const i = args.indexOf('--ref'); return i >= 0 ? args[i + 1] : 'origin/main'; })();
const PREVIEW = args.includes('--preview');
const PROD = 'https://railisland.tw';

const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
const md5 = buf => crypto.createHash('md5').update(buf).digest('hex');
const fail = msg => { console.error('❌ ' + msg); process.exit(1); };
async function fetchProd(pathname = '/') {
  const url = `${PROD}${pathname}${pathname.includes('?') ? '&' : '?'}bust=${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  try {
    const res = await fetch(url, { redirect: 'follow' });
    return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
  } catch { return { status: 0, body: Buffer.alloc(0) }; }
}

// ── 1. preflight ──────────────────────────────────────────────────────────
git('fetch', 'origin');
const sha = git('rev-parse', REF).trim();
const behind = git('log', '--oneline', `${sha}..origin/main`).trim();
if (behind) fail(`出貨基準落後 origin/main，整包替換會退掉這些 commit：\n${behind}`);
console.log(`出貨基準 ${REF} = ${sha.slice(0, 8)}`);

// ── 2. 乾淨 worktree（只含追蹤檔＝結構性排除所有未追蹤檔）──────────────────
const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-web-'));
git('worktree', 'add', '--detach', '--force', wt, sha);
let ok = false;
try {
  fs.symlinkSync(path.join(repo, 'node_modules'), path.join(wt, 'node_modules'));

  // ── 2.5 i18n 稽核閘門（漏譯不准出貨）──────────────────────────────────────
  // 🔴 位置不可移到 strip 之後:check_i18n 的 evaluateConstBlock 拿【註解】當區塊結束標記
  //    （'// 有精選特色'、'// 播放/速度/時間'），strip 把註解刪光之後它會報「找不到內容區塊」
  //    ——整條出貨鏈會每次都假紅卡死。2026-08-29 實測:同一顆 strip 前 exit 0、strip 後 exit 1。
  // 驗的是【這棵乾淨出貨樹】而不是呼叫者的工作樹（腳本 root 由自身檔案位置推導）；實測用
  // 「只弄壞乾淨樹的 index.html」確認過:乾淨樹紅、呼叫者工作樹綠，兩者確實獨立。
  const i18n = spawnSync('node', [path.join(wt, 'scripts', 'check_i18n.mjs')], { encoding: 'utf8' });
  process.stdout.write(i18n.stdout || ''); process.stderr.write(i18n.stderr || '');
  if (i18n.status !== 0) fail('i18n 稽核未過——補齊 en/ja 再出貨（單獨重跑：npm run check-i18n）');

  // ── 2.6 部署設定的「整包覆蓋」防線 ────────────────────────────────────────
  // `triggers.crons` 與 `.assetsignore` 都是宣告式整包覆蓋:部署時拿檔案裡那份【取代】現況。
  // 少一條不會有任何錯誤訊息——git 不當衝突、wrangler 不報錯、worker.js 的程式碼一行不少,
  // 只是那個分支永遠不會被呼叫,而少掉的東西可能不可重現（北捷帳本每分鐘的官方取樣）。
  // 這是唯一會在部署前擋下來的地方。同 i18n:驗的是【這棵乾淨出貨樹】那一份。
  const cfg = spawnSync('node', [path.join(wt, 'scripts', 'check_deploy_config.mjs')], { encoding: 'utf8' });
  process.stdout.write(cfg.stdout || ''); process.stderr.write(cfg.stderr || '');
  if (cfg.status !== 0) fail('部署設定檢查未過——cron 或資產排除少了東西,出貨會靜默關掉功能'
    + '（單獨重跑：npm run check-deploy-config）');

  // ── 2.65 辦公日曆表兩份副本的同步 ──────────────────────────────────────────
  // index.html 的 TW_DAYTYPE(前端選捷運班表)與 data/tw_daytype.json(worker 做北捷逐班綁定)
  // 是同一份資料的兩個副本,補新年度時「補一邊忘另一邊」不會有任何錯誤訊息——
  // 只有某個假日的班表與綁定會靜靜出錯。同上:驗的是【這棵乾淨出貨樹】那一份。
  const daytype = spawnSync('node', [path.join(wt, 'scripts', 'check_daytype_sync.mjs')], { encoding: 'utf8' });
  process.stdout.write(daytype.stdout || ''); process.stderr.write(daytype.stderr || '');
  if (daytype.status !== 0) fail('辦公日曆表同步檢查未過——兩份副本分岔了'
    + '（單獨重跑：npm run check-daytype-sync）');

  // ── 2.66 週末／連假活動（純 node 兩支，合計不到 0.1 秒）────────────────────────
  // 同 2.8 的判例：這兩支不吃瀏覽器，沒有理由不掛（「不在出貨鏈上的驗收腳本等於不存在」）。
  // core 驗純函式層的判定（假期區間、兩層分流、去重、標題文案）；api 除了回傳形狀之外，
  // 還【真的把 weekendBoard() 執行一次】驗資產接線，以及把 weekend.html 的算繪函式抽出來
  // 餵核心層真的產出的資料，守住「核心層改欄位名 → 頁面站名整批消失」那條接縫。
  // 🔴 這兩件事都是【別人改東西時會靜默壞掉】的類型：改 worker.js 的資產順序、改
  // weekend_core 的欄位名，畫面照樣有東西、HTTP 照樣 200，只是永遠 0 場或站名全空。
  //
  // 另外兩支（verify_weekend_page／verify_weekend_entry）刻意【不】掛進來，理由用 2.8 同一把尺：
  //   (a) 它們要 Playwright ＋一個服著整棵樹的靜態站（現在吃 VURL），而本鏈的乾淨 worktree
  //       沒有人在服它——要掛就得先把兩支改成自己起 server（follow_pin／boot_partial_sched
  //       的做法），那是在併入前一輪動兩支已經全綠的腳本，風險大於收益；
  //   (b) 它們獨有的涵蓋範圍是「瀏覽器裡的渲染、點擊、注入防護」，而那些只在有人動
  //       weekend.html 或探索面板那一列時才會回歸——那時人就在跑它們。會被【別人】無聲弄壞的
  //       那一半（接線與跨層欄位契約）已經由上面的 api 這支接住了。
  //   單獨重跑（要自己起靜態站）：
  //       python3 -m http.server 5187 &  然後 npm run check-weekend-page / check-weekend-entry
  const wkCore = spawnSync('node', [path.join(wt, 'scripts', 'verify_weekend_core.mjs')], { encoding: 'utf8' });
  process.stdout.write(wkCore.stdout || ''); process.stderr.write(wkCore.stderr || '');
  if (wkCore.status !== 0) fail('週末活動純函式層未過——假期區間／分流／去重／標題文案壞了'
    + '（單獨重跑：npm run check-weekend-core）');

  const wkApi = spawnSync('node', [path.join(wt, 'scripts', 'verify_weekend_api.mjs')], { encoding: 'utf8' });
  process.stdout.write(wkApi.stdout || ''); process.stderr.write(wkApi.stderr || '');
  if (wkApi.status !== 0) fail('週末活動 API 未過——handler 的資產接線、快取金鑰或跨層欄位契約壞了'
    + '（單獨重跑：npm run check-weekend-api）');

  // ── 2.7 對外用語閘門（更名後的舊名不准出貨）────────────────────────────────
  // 🔴 位置與 2.5 同一個理由,不可移到 strip 之後:check_voice 的 constBlock surface
  //    content-station／content-sys 用的 end 標記就是【註解】（'// 有精選特色'、
  //    '// 播放/速度/時間',與 check_i18n 同兩條),strip 刪光註解後抽不到區塊。
  // 這支此前【沒有任何呼叫者】（不在 package.json、不在本鏈、無 CI）——等於 2026-08-05
  // 產品更名(軌島 Plus → 軌島通行證)之後,對外文字再冒出「Plus」完全沒人守,跟 check_i18n
  // 在 2026-08-29 之前的處境一模一樣。同 i18n:驗的是【這棵乾淨出貨樹】那一份。
  const voice = spawnSync('node', [path.join(wt, 'scripts', 'check_voice.mjs')], { encoding: 'utf8' });
  process.stdout.write(voice.stdout || ''); process.stderr.write(voice.stderr || '');
  if (voice.status !== 0) fail('對外用語稽核未過——出貨文字用了更名前的舊名或未登記的 surface'
    + '（單獨重跑：npm run check-voice）');

  // ── 2.8 轉乘接續資料閘門（純 node、無瀏覽器，兩支合計數十毫秒，不划算不放進來的理由不成立）─
  // 只放這兩支（departures/connections),不放 pin/transitions/mobile——那三支要開瀏覽器
  // (Playwright),每次出貨多開一次瀏覽器的成本换不到對應的保護(它們驗的是互動/過渡態,
  // 不是「班表更新後資料還接得上」這種每次出貨都可能出錯的東西)。同 i18n/voice:驗的是
  // 【這棵乾淨出貨樹】那一份。「不在出貨鏈上的驗收腳本等於不存在」——這兩支本來就不吃
  // 瀏覽器,沒有理由不掛。
  //
  // 🔴 2026-09-02 例外:follow_pin 也掛上來(第四支,上面那段寫的時候它還不存在)。它不屬於
  // 「互動/過渡態」那一類——它守的是【跟車面板每幀重寫 innerHTML 會把點擊整個吃掉】,而那個
  // 缺陷 (a) 對真人 100% 復現、(b) 其餘 148 條斷言全綠照不到(它們都繞開跟車迴圈)、
  // (c) 任何一次改到面板算繪路徑都會原地復發。實測整支 6 秒(42 條斷言、兩引擎各 2 次 boot),
  // 用上面同一把「成本 vs 保護」的尺量,結論和那三支相反。見 [[follow-panel-repaint-eats-clicks]]。
  const xferDep = spawnSync('node', [path.join(wt, 'scripts', 'verify_transfer_departures.mjs')], { encoding: 'utf8' });
  process.stdout.write(xferDep.stdout || ''); process.stderr.write(xferDep.stderr || '');
  if (xferDep.status !== 0) fail('轉乘接續資料未過——多半是班表更新後沒重產'
    + '（單獨重跑：npm run check-transfer-departures）');

  const xferConn = spawnSync('node', [path.join(wt, 'scripts', 'verify_transfer_connections.mjs')], { encoding: 'utf8' });
  process.stdout.write(xferConn.stdout || ''); process.stderr.write(xferConn.stderr || '');
  if (xferConn.status !== 0) fail('轉乘接續查詢層未過——transferConnections/transferConnectionHtml 邏輯壞了'
    + '（單獨重跑：npm run check-transfer-connections）');

  const xferFollow = spawnSync('node', [path.join(wt, 'scripts', 'verify_transfer_follow_pin.mjs')], { encoding: 'utf8' });
  process.stdout.write(xferFollow.stdout || ''); process.stderr.write(xferFollow.stderr || '');
  if (xferFollow.status !== 0) fail('跟車中的接續釘選未過——面板算繪把點擊吃掉,或窄卡版面溢出'
    + '（單獨重跑：npm run check-transfer-follow-pin）');

  // 釘選成功不代表背景中的旅程會交棒。這支用真 D1＋laPushAll＋APNs body 驗證來源列車
  // 抵達轉乘站後，卡片身分、發車倒數與後續站序確實切到已選班次。
  const xferHandoff = spawnSync('node', [path.join(wt, 'scripts', 'verify_transfer_live_handoff.mjs')], { encoding: 'utf8' });
  process.stdout.write(xferHandoff.stdout || ''); process.stderr.write(xferHandoff.stderr || '');
  if (xferHandoff.status !== 0) fail('跨車轉乘接棒未過——鎖屏卡會在轉乘站繼續跟來源列車'
    + '（單獨重跑：npm run check-transfer-live-handoff）');

  // 機捷車種不能只驗「程式裡有直／普兩個字」：真正的驗收是畫面同時能看出兩種車，且
  // 跟車卡、車站看板與首末班特殊班次都不硬猜。瀏覽器 gate 另鎖住放大、尖頭／圓角與
  // 實心／白底；資料 gate 確認官方直達車端點與兩方向樣態沒有在班表更新後走樣。
  const tymcKind = spawnSync('node', [path.join(wt, 'scripts', 'verify_tymc_train_kind.mjs')], { encoding: 'utf8' });
  process.stdout.write(tymcKind.stdout || ''); process.stderr.write(tymcKind.stderr || '');
  if (tymcKind.status !== 0) fail('桃園機捷車種顯示未過——直達／普通車的文字、大小、形狀或反白有回歸'
    + '（單獨重跑：npm run check-tymc-kind）');

  const tymcEndpoints = spawnSync('node', [path.join(wt, 'scripts', 'verify_tymc_express_endpoints.mjs')], { encoding: 'utf8' });
  process.stdout.write(tymcEndpoints.stdout || ''); process.stderr.write(tymcEndpoints.stderr || '');
  if (tymcEndpoints.status !== 0) fail('桃園機捷直達車資料未過——端點、方向或官方樣態有回歸'
    + '（單獨重跑：npm run check-tymc-kind）');

  // ── 2.9 北捷上游呼叫量閘門 ────────────────────────────────────────────────
  // 2026-09-02 北捷來函「8 月三支 API 各逾 60 萬次、不似正常使用方式」之後補的。
  // 這裡守的是兩件會【靜默】退回去的事：營運窗外的閘門、CarWeight 的 60 秒節流。
  // 兩者都不影響畫面，所以任何回歸都不會被別的判準或人眼發現——只會在一個月後
  // 變成下一封信。同 2.7／2.8：這支此前沒有任何呼叫者（那條路徑的守門人一直是空的，
  // worker.js 註解指名的 verify_trtc_freshness.mjs 從來不存在）。
  // 純離線（自帶 fetch／caches 替身，不打真實上游），驗的是這棵乾淨出貨樹那一份。
  const budget = spawnSync('node', [path.join(wt, 'scripts', 'verify_trtc_call_budget.mjs')], { encoding: 'utf8' });
  process.stdout.write(budget.stdout || ''); process.stderr.write(budget.stderr || '');
  if (budget.status !== 0) fail('北捷呼叫量閘門未過——營運窗閘門或 CarWeight 節流被改掉了'
    + '（單獨重跑：node scripts/verify_trtc_call_budget.mjs）');

  // ── 2.10 OBS 直播／導播模式守門人 ───────────────────────────────────────────
  // 2026-09-03 刪掉 ?live=1／?live=2 之後補的。守的是「刪掉的東西不會被某條舊分支的合併
  // 靜默帶回來」——這個 repo 的合併吃掉／帶回東西從來不會讓 build 紅（見 app/scripts/
  // verify_no_ship_regression.mjs 檔頭那次事故）。G1 靜態 grep 兩個 HTML、G2 帶 ?live=1 開機
  // 不得有 OBS 痕跡且零 pageerror、G3 正向對照（同名的 LIVE 徽章家族必須還在，否則把整包
  // 叫 live 的東西砍掉也會全綠）。/api 走正式站，約 1 分鐘。
  const obs = spawnSync('node', [path.join(wt, 'scripts', 'verify_obs_removed.mjs')], { encoding: 'utf8' });
  process.stdout.write(obs.stdout || ''); process.stderr.write(obs.stderr || '');
  if (obs.status !== 0) fail('OBS 直播／導播守門人未過——被刪掉的 ?live 機制回來了，或 LIVE 徽章家族被誤刪'
    + '（單獨重跑：npm run check-obs-removed）');
  // ── 2.11 公車轉乘完整守門 ───────────────────────────────────────────────
  // 這裡刻意包含真實 Chromium＋WebKit 手機觸控與故障回應矩陣。公車卡是按需查詢，
  // 靜態檢查只能證明「看起來有那段程式」，不能證明按鈕真的可點、原始狀態碼不會外露。
  const busTransfer = spawnSync('node', [path.join(wt, 'scripts', 'verify_bus_transfer_all.mjs')], { encoding: 'utf8' });
  process.stdout.write(busTransfer.stdout || ''); process.stderr.write(busTransfer.stderr || '');
  if (busTransfer.status !== 0) fail('公車轉乘驗收未過——修正資料索引、Worker、UI、手機互動或錯誤降級後再出貨'
    + '（單獨重跑：npm run check-bus-transfer）');

  // ── 2.12 地圖引擎適配層閘門(換引擎 M0,2026-09-03)——純靜態、毫秒級:index.html 裡任何繞過適配層 M 直接
  // 呼叫 Leaflet `map.xxx(` 的程式碼都會在這裡擋下(否則 MapLibre 引擎一開就炸,而 Leaflet 路徑全綠照不到)。
  // 只跑靜態半段:動態半段(Playwright 開機比對)留給 npm run check-engine。
  const eng = spawnSync('node', [path.join(wt, 'scripts', 'verify_engine_adapter.mjs')], { encoding: 'utf8', env: { ...process.env, ENGINE_GATE_STRICT: '1', ENGINE_GATE_STATIC_ONLY: '1' } });
  process.stdout.write(eng.stdout || ''); process.stderr.write(eng.stderr || '');
  if (eng.status !== 0) fail('地圖引擎適配層閘門未過——有程式碼繞過 M 直接呼叫 Leaflet map.*（單獨重跑：npm run check-engine）');

  // ── 2.13 軌道 GeoJSON 守門人(換引擎 M1a,2026-09-03):磁碟上的 geojson 必須等於重建結果(G0),
  //    否則 MapLibre 的 GL 軌道會畫到手改過／忘了重產的資料;G1–G10 順便一起過 ────────────────
  const trk = spawnSync('node', [path.join(wt, 'scripts', 'verify_track_geojson.mjs')], { encoding: 'utf8' });
  process.stdout.write(trk.stdout || ''); if (trk.stderr) process.stderr.write(trk.stderr);
  if (trk.status !== 0) fail('軌道 GeoJSON 守門人未過(npm run check-track-geojson)');
  // ── 2.14 開機期班表殘缺守門人 ─────────────────────────────────────────────
  // 2026-09-04 check-obs-removed 偶發紅一次（`sys.data.trains is not iterable` ＋ 60 秒沒
  // state.ready ＝ 使用者看到空白 App）之後補的。走得到的路徑是「上游回 HTTP 200，body 是
  // 合法 JSON 但沒有 trains 陣列」——resolveScheduleDay 把它原樣放行，系統就這樣帶著
  // data.trains=undefined 進了 state.systems。（回 500／空 body 反而安全：整個系統會被丟掉。）
  // 三個 sched 系統各注入一次，因為各自的第一個炸點不同：台鐵 buildLoopTrains、
  // 高鐵 applySchedSystems 的 for、林鐵 addSunriseTrains。每組都驗「其餘兩個系統仍畫得出車」，
  // 擋掉「乾脆整包不畫就不會拋錯」那種假修法。全程離線（/api 一律 404），約 1 分鐘。
  const bootSched = spawnSync('node', [path.join(wt, 'scripts', 'verify_boot_partial_schedule.mjs'), wt], { encoding: 'utf8' });
  process.stdout.write(bootSched.stdout || ''); process.stderr.write(bootSched.stderr || '');
  if (bootSched.status !== 0) fail('開機期班表殘缺守門人未過——某個系統班表殘缺會讓整頁開不起來'
    + '（單獨重跑：npm run check-boot-partial-sched）');
  // ── 2.15 查詢分頁(2026-09-06)守門人 ──────────────────────────────────────
  // 兩態 sheet、答案區與看板同源、自動開的正反對照、更多抽屜三列、重畫不吃點擊——全都是
  // 「改到面板算繪或 sheet 家族就原地復發、其餘閘門照不到」的那種。兩引擎約 2–3 分鐘。
  const queryTab = spawnSync('node', [path.join(wt, 'scripts', 'verify_query_tab.mjs'), wt], { encoding: 'utf8' });
  process.stdout.write(queryTab.stdout || ''); process.stderr.write(queryTab.stderr || '');
  if (queryTab.status !== 0) fail('查詢分頁守門人未過——兩態 sheet／答案同源／自動開／更多抽屜之一壞了'
    + '（單獨重跑：npm run check-query-tab）');

  // ── 3. strip（腳本內建 esbuild AST 重印等價證明，任何不等價都非零退出）────
  const rawBytes = fs.readFileSync(path.join(wt, 'index.html'));
  execFileSync('node', [path.join(wt, 'scripts', 'strip_ship_comments.mjs'), wt], { stdio: 'inherit' });
  const stripped = fs.readFileSync(path.join(wt, 'index.html'));
  const strippedMd5 = md5(stripped);
  if (stripped.length >= rawBytes.length * 0.85)
    fail(`strip 後只小了 ${(100 - stripped.length / rawBytes.length * 100).toFixed(1)}%——疑似沒生效`);
  const anchors = s => (String(s).match(/APP_REPLACE_START/g) || []).length;
  if (anchors(stripped) !== anchors(rawBytes)) fail('APP_REPLACE 錨點數量變了——HTML 註解被動到');
  console.log(`strip ✓ ${rawBytes.length} → ${stripped.length} bytes（−${(100 - stripped.length / rawBytes.length * 100).toFixed(1)}%），md5 ${strippedMd5}`);

  // ── 4. BUILD 版號防撞 ────────────────────────────────────────────────────
  const buildOf = s => (String(s).match(/const BUILD = '([^']+)'/) || [])[1] || '';
  const newBuild = buildOf(stripped);
  const prodNow = await fetchProd('/');
  if (prodNow.status === 200 && md5(prodNow.body) !== strippedMd5 && buildOf(prodNow.body) === newBuild)
    fail(`內容與正式站不同但 BUILD 同為 '${newBuild}'——先 bump BUILD 再出貨`);

  // ── 5. upload ────────────────────────────────────────────────────────────
  const wrangler = path.join(repo, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const up = spawnSync('arch', ['-arm64', 'node', wrangler, 'versions', 'upload'], { cwd: wt, encoding: 'utf8' });
  process.stdout.write(up.stdout || ''); process.stderr.write(up.stderr || '');
  if (up.status !== 0) fail('versions upload 失敗');
  const verId = ((up.stdout || '') + (up.stderr || '')).match(/Worker Version ID:\s*([0-9a-f-]{36})/)?.[1];
  if (!verId) fail('upload 輸出裡找不到 Worker Version ID');
  console.log(`upload ✓ version ${verId}`);

  if (PREVIEW) {
    const out = (up.stdout || '') + (up.stderr || '');
    const url = out.match(/https:\/\/[0-9a-z-]+\.workers\.dev\S*/)?.[0]
      || `https://${verId.slice(0, 8)}-taiwan-rail-live.sirius1984.workers.dev`;
    console.log(`\n✅ 預覽已上傳（未升正式站）：${url}`);
    console.log(`   版本 ${verId}｜基底 ${sha.slice(0, 8)}｜BUILD '${newBuild}'｜stripped md5 ${strippedMd5}`);
    console.log(`   升正式站：把這條分支併進 main 之後跑 npm run ship-web`);
  } else {
    // ── 6. deploy @100%（ID 只取自上面那次 upload 的輸出）──────────────────
    const dep = spawnSync('arch', ['-arm64', 'node', wrangler, 'versions', 'deploy', `${verId}@100%`, '--yes'],
      { cwd: wt, encoding: 'utf8' });
    process.stdout.write(dep.stdout || ''); process.stderr.write(dep.stderr || '');
    if (dep.status !== 0) fail('versions deploy 失敗');

    // ── 7. 收貨：正式站逐 byte＝本地 stripped（邊緣快取最長等 ~3 分鐘）─────
    let live = null;
    for (let attempt = 1; attempt <= 10; attempt++) {
      const got = await fetchProd('/');
      if (got.status === 200 && md5(got.body) === strippedMd5) { live = got; break; }
      console.log(`  收貨重試 ${attempt}/10（拿到 ${got.status}／md5 ${md5(got.body).slice(0, 8)}…，等 20s）`);
      await new Promise(r => setTimeout(r, 20000));
    }
    if (!live) fail('正式站內容在 ~3 分鐘內未收斂到本次 stripped md5——查 deployments list 與快取');
    const api = await fetchProd('/api/trtc-live');
    if (api.status !== 200) fail(`/api/trtc-live 回 ${api.status}——Worker 路由疑似壞了`);
    console.log(`✅ 出貨完成：railisland.tw 逐 byte＝stripped(${sha.slice(0, 8)})，${stripped.length} bytes，BUILD '${newBuild}'，API 200`);
  }
  ok = true;
} finally {
  if (ok) { try { git('worktree', 'remove', '--force', wt); git('worktree', 'prune'); } catch {} }
  else console.error(`（出貨樹保留供除錯：${wt}）`);
}
