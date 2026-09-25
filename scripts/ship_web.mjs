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
//  - 同時只准一發正式出貨（2026-09-19 00:28 f418f5 要出 cb5fe11b、另一個 session 要出 51cd374e，
//    是用跨 session 訊息問了才沒撞）：兩發並行是「後收尾的贏」——較舊那發起跑時已過了落後檢查，
//    閘門跑完 20–35 分鐘照樣 upload＋升 100%，把較新的正式站蓋回去（BUILD、md5 都不同，步驟 4 不擋）。
//    鎖檔＝git common dir（所有 worktree 共用）下的 ship-web.lock，O_EXCL 建立，記 pid／ref／sha／起跑時間；
//    在落後檢查與所有閘門之前拿，第二發當場退、訊息點名持有者。
//    🔴 解鎖掛在 process 'exit'，不在 finally：fail() 走 process.exit，finally 根本不會跑。
//    被 kill／Ctrl-C 的那發連 'exit' 都不跑，鎖會留著；pid 已死 ⇒ 下一發自動接手。
//    --preview 不拿鎖、也不做下一條（只 upload 不升版，蓋不到正式站）。
//  - upload 前、deploy 前各認一次正式站，認不出或比出貨基準新就停：正式站 index.html 要逐 byte 等於
//    某顆 X 去註解的結果（用 X 自己的 strip 腳本重做）、data/data_manifest.json 要等於 X 那份，且 X 是
//    出貨基準的祖先（或就是它）。起跑時的落後檢查只保證「不比起跑那刻的 main 舊」，保證不了「不比正式站舊」——
//    正式站可能跑著部署時沒 push 的版本，或在閘門跑的那 30 分鐘裡被別處換掉。
//    限制（都是這個指紋照不到的地方；要補只能在出貨時把 sha 蓋進產物或版本標籤，還沒做）：
//    · 只改 worker.js 或清單外資料（*_times.json、events.json、軌道 geojson…）的 commit 指紋不變。
//      2026-09-19 量 main 最近 300 顆：動到執行期檔案的 53 顆裡有 19 顆屬此類。這種版本在線上時，
//      同指紋的祖先照樣放行——會把它的 worker／資料改動退掉。
//    · 鎖只管同一個 clone、而且只管有這段程式碼的 ship_web：別的 clone、別台機器、裸 wrangler、
//      `wrangler secret put`（會把最新上傳的版本升上線）、還沒併到這一版的舊 worktree 跑的 ship_web
//      （跑的是 cwd 那棵樹的這支檔，不是出貨 ref 裡的）都繞得過；它們只剩本發 deploy 前那次檢查擋得到，
//      而檢查到 deploy 之間仍有幾秒空窗。
//    · 判死只看 pid 在不在：pid 被別的程序重用時，死鎖會被當成活的擋下（寧可擋錯）——訊息列出 pid，
//      確認那不是 ship-web 再刪鎖檔。
//    兩道防線的邏輯在 scripts/ship_web_guard.mjs，測試：node scripts/verify_ship_web_guard.mjs
//    （本檔沒有 --help、不認得的旗標一律忽略，不帶 --preview 就是出正式站——永遠不要拿它試跑）。
//  - 內容與正式站不同但 BUILD 字串相同就停（內容不同的兩顆不准共用版號）
//  - versions deploy 的版本 ID 只取自同一次 upload 的輸出（versions list 取 [0] 會拿到最舊版）
//  - 收貨判準＝正式站 md5 與本地 stripped 檔逐 byte 相等（不是 BUILD 字串、不是抽 grep）

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { acquireShipLock, checkProductionAncestry } from './ship_web_guard.mjs';

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
if (!PREVIEW) {   // 出貨鎖：比落後檢查與所有閘門都早拿，第二發當場退（設計與限制見檔頭）
  const lockPath = path.join(path.resolve(repo, git('rev-parse', '--git-common-dir').trim()), 'ship-web.lock');
  const lock = acquireShipLock({ lockPath, ref: REF, sha });
  if (!lock.ok) fail(lock.message);
  if (lock.note) console.log(lock.note);
  console.log(`出貨鎖 ✓ ${lockPath}`);
}
const behind = git('log', '--oneline', `${sha}..origin/main`).trim();
if (behind) fail(`出貨基準落後 origin/main，整包替換會退掉這些 commit：\n${behind}`);
console.log(`出貨基準 ${REF} = ${sha.slice(0, 8)}`);

// ── 2. 乾淨 worktree（只含追蹤檔＝結構性排除所有未追蹤檔）──────────────────
const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-web-'));
git('worktree', 'add', '--detach', '--force', wt, sha);
let ok = false;
try {
  fs.symlinkSync(path.join(repo, 'node_modules'), path.join(wt, 'node_modules'));

  // ── 2.4 正式庫 schema：出貨的程式碼要讀寫的表與欄，正式 D1 都要有（唯讀查詢，約 3 秒）──────────
  // 2026-09-24 發現正式庫從沒套 0012，v0904d 起跟車卡每次綁定都 503、近三週靜默全停；本機驗收自己套齊
  // schema，照不到正式庫漏套。排在所有閘門之前：缺 migration 就別先跑 30 分鐘閘門。預覽也跑（共用同一個 D1）。
  // 查不到正式庫（exit 2）同樣擋下——驗不了不等於通過。
  const remoteSchema = spawnSync('node', [path.join(wt, 'scripts', 'verify_remote_schema.mjs')], { cwd: wt, encoding: 'utf8' });
  process.stdout.write(remoteSchema.stdout || ''); process.stderr.write(remoteSchema.stderr || '');
  if (remoteSchema.status !== 0) fail('正式庫 schema 與 schema/*.sql 不一致或查不到——先補套 migration（要使用者 go）再出貨（單獨重跑：node scripts/verify_remote_schema.mjs）');

  // ── 2.5 i18n 稽核閘門（漏譯不准出貨）──────────────────────────────────────
  // 🔴 位置不可移到 strip 之後:check_i18n 的 evaluateConstBlock 拿【註解】當區塊結束標記
  //    （'// 有精選特色'、'// 播放/速度/時間'），strip 把註解刪光之後它會報「找不到內容區塊」
  //    ——整條出貨鏈會每次都假紅卡死。2026-08-29 實測:同一顆 strip 前 exit 0、strip 後 exit 1。
  // 驗的是【這棵乾淨出貨樹】而不是呼叫者的工作樹（腳本 root 由自身檔案位置推導）；實測用
  // 「只弄壞乾淨樹的 index.html」確認過:乾淨樹紅、呼叫者工作樹綠，兩者確實獨立。
  const i18n = spawnSync('node', [path.join(wt, 'scripts', 'check_i18n.mjs')], { encoding: 'utf8' });
  process.stdout.write(i18n.stdout || ''); process.stderr.write(i18n.stderr || '');
  if (i18n.status !== 0) fail('i18n 稽核未過——補齊 en/ja 再出貨（單獨重跑：npm run check-i18n）');

  // ── 2.5b i18n 瀏覽器驗收（Chromium＋WebKit，約 70 秒）──────────────────────
  // 2.5 是靜態掃描，看不到「畫出來的畫面」：切換語言後殘留前一種語言、App 的「更多」面板、法務頁、
  // 手機四寬度的可見中文，都只有真的開瀏覽器才量得到(2026-09-19 使用者在 App 英日文實測回報的那一批，
  // 靜態掃描全綠)。這支此前沒有任何呼叫者，而且還要人先起一個 5178 的 server 才跑得動。
  // 🔴 洗掉繼承來的 RAIL_I18N_URL：有值時它改連既有 server、驗的可能是別棵樹（G0 會擋，但別讓它發生）。
  const i18nBrowser = spawnSync('node', [path.join(wt, 'scripts', 'verify_i18n.mjs')],
    { cwd: wt, encoding: 'utf8', env: { ...process.env, RAIL_I18N_URL: '' } });
  process.stdout.write(i18nBrowser.stdout || ''); process.stderr.write(i18nBrowser.stderr || '');
  if (i18nBrowser.status !== 0) fail('i18n 瀏覽器驗收未過——英日文畫面有中文殘留或切換語言殘留（單獨重跑：npm run check-i18n-browser）');

  // ── 2.6 部署設定的「整包覆蓋」防線 ────────────────────────────────────────
  // `triggers.crons` 與 `.assetsignore` 都是宣告式整包覆蓋:部署時拿檔案裡那份【取代】現況。
  // 少一條不會有任何錯誤訊息——git 不當衝突、wrangler 不報錯、worker.js 的程式碼一行不少,
  // 只是那個分支永遠不會被呼叫,而少掉的東西可能不可重現（北捷帳本每分鐘的官方取樣）。
  // 這是唯一會在部署前擋下來的地方。同 i18n:驗的是【這棵乾淨出貨樹】那一份。
  const cfg = spawnSync('node', [path.join(wt, 'scripts', 'check_deploy_config.mjs')], { encoding: 'utf8' });
  process.stdout.write(cfg.stdout || ''); process.stderr.write(cfg.stderr || '');
  if (cfg.status !== 0) fail('部署設定檢查未過——cron 或資產排除少了東西,出貨會靜默關掉功能'
    + '（單獨重跑：npm run check-deploy-config）');

  // ── 2.61 網頁登入的 CSP 防線 ──────────────────────────────────────────────
  // 2026-09-10 issue #54:CSP 少了 apis.google.com 與 frame-src,網頁登入從第一天就死在
  // auth/internal-error。三重靜默(不報錯、錯誤字面不提 CSP、本機 server 不送 CSP)⇒
  // 只有掛在出貨鏈上才擋得住(「不在出貨鏈上的驗收腳本等於不存在」)。純 node,毫秒級。
  const loginCsp = spawnSync('node', [path.join(wt, 'scripts', 'verify_web_login_csp.mjs')], { encoding: 'utf8' });
  process.stdout.write(loginCsp.stdout || ''); process.stderr.write(loginCsp.stderr || '');
  if (loginCsp.status !== 0) fail('網頁登入的 CSP 檢查未過——出貨會讓登入回到 auth/internal-error'
    + '（單獨重跑：npm run check-web-login-csp）');

  // ── 2.62 出貨防線自己的守門人(並行鎖、認正式站;純 node、離線、約 10 秒)────────────
  // 防線壞掉的症狀是「該擋的沒擋」,平常完全看不出來;而本檔不能試跑,只有這支測得到它。
  const shipGuard = spawnSync('node', [path.join(wt, 'scripts', 'verify_ship_web_guard.mjs')], { encoding: 'utf8' });
  process.stdout.write(shipGuard.stdout || ''); process.stderr.write(shipGuard.stderr || '');
  if (shipGuard.status !== 0) fail('出貨防線的守門人未過——並行鎖或認正式站的判定壞了'
    + '（單獨重跑：npm run check-ship-web-guard）');

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
  const platforms = spawnSync('node', [path.join(wt, 'scripts', 'verify_platforms.mjs')], { encoding: 'utf8' });
  process.stdout.write(platforms.stdout || ''); process.stderr.write(platforms.stderr || '');
  if (platforms.status !== 0) fail('月台日期、有效期限或代理快取檢查未通過');

  const wkCore = spawnSync('node', [path.join(wt, 'scripts', 'verify_weekend_core.mjs')], { encoding: 'utf8' });
  process.stdout.write(wkCore.stdout || ''); process.stderr.write(wkCore.stderr || '');
  if (wkCore.status !== 0) fail('週末活動純函式層未過——假期區間／分流／去重／標題文案壞了'
    + '（單獨重跑：npm run check-weekend-core）');

  const wkApi = spawnSync('node', [path.join(wt, 'scripts', 'verify_weekend_api.mjs')], { encoding: 'utf8' });
  process.stdout.write(wkApi.stdout || ''); process.stderr.write(wkApi.stderr || '');
  if (wkApi.status !== 0) fail('週末活動 API 未過——handler 的資產接線、快取金鑰或跨層欄位契約壞了'
    + '（單獨重跑：npm run check-weekend-api）');

  const historic = spawnSync('node', [path.join(wt, 'scripts', 'verify_historic_assets.mjs')], { encoding: 'utf8' });
  process.stdout.write(historic.stdout || ''); process.stderr.write(historic.stderr || '');
  if (historic.status !== 0) fail('歷史建物資產或定位契約未通過');
  const tainanMemory = spawnSync('node', [path.join(wt, 'scripts', 'verify_tainan_memory.mjs')], { encoding: 'utf8' });
  process.stdout.write(tainanMemory.stdout || ''); process.stderr.write(tainanMemory.stderr || '');
  if (tainanMemory.status !== 0) fail('台南地面鐵道封存雜湊、班次或沿軌接續未通過');
  const railLevels = spawnSync('node', [path.join(wt, 'scripts', 'verify_rail_levels.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(railLevels.stdout || ''); process.stderr.write(railLevels.stderr || '');
  if (railLevels.status !== 0) fail('軌道上下層、交叉淨距或來源剖面版本未通過');
  const flatGrade = spawnSync('node', [path.join(wt, 'scripts', 'verify_flat_rail_grade.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(flatGrade.stdout || ''); process.stderr.write(flatGrade.stderr || '');
  if (flatGrade.status !== 0) fail('平坦地圖的橋梁、引道或列車縱坡未通過');
  const railGrounding = spawnSync('node', [path.join(wt, 'scripts', 'verify_rail_grounding.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(railGrounding.stdout || ''); process.stderr.write(railGrounding.stderr || '');
  if (railGrounding.status !== 0) fail('橋梁來源判定或示意列車高度對應未通過');
  const linkou = spawnSync('node', [path.join(wt, 'scripts', 'verify_linkou_structures.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(linkou.stdout || ''); process.stderr.write(linkou.stderr || '');
  if (linkou.status !== 0) fail('林口台地橋隧縱坡或洞口連續性未通過');
  const tunnelGrade = spawnSync('node', [path.join(wt, 'scripts', 'verify_rail_tunnel_grade.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(tunnelGrade.stdout || ''); process.stderr.write(tunnelGrade.stderr || '');
  if (tunnelGrade.status !== 0) fail('隧道顯示縱坡未通過——隧道又跟著山坡起伏了（單獨重跑：node scripts/verify_rail_tunnel_grade.mjs）');
  // 2026-09-11 issue #57：上面四道對「OSM 隧道／官方橋梁互指」「layer 當高度」「洞口把鄰接高架
  // 拖下去」三個缺陷全是綠的——隧道被誤判成橋就整段退出 tunnelGrade 的分母，缺陷會讓判準的樣本
  // 自己消失。這一支專驗反向改判、橋面離地高度、洞口銜接與地表穿透門檻。
  const structureHeights = spawnSync('node', [path.join(wt, 'scripts', 'verify_rail_structure_heights.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(structureHeights.stdout || ''); process.stderr.write(structureHeights.stderr || '');
  if (structureHeights.status !== 0) fail('橋隧種類或顯示高度未通過（單獨重跑：npm run check-rail-structure-heights）');
  // 2026-09-12：地形分片的 Range 在 Cloudflare 靜態資產上不生效（要 16 KB 回 200 ＋整個 8 MB），
  // 開站一次白抓 96 MB。本機 dev_server 會正確回 206 ⇒ 瀏覽器驗收在這件事上結構性失明，
  // 這一支自己造一台照 Cloudflare 行為的伺服器來考，另配一台回 206 的當正向對照。
  // 兩列車互相穿越:issue #17 的防追撞在 0f5bb774 被 railIslandPhysical.has() 短路掉之後,台鐵整整
  // 五天是 100% 死碼,而唯一那支相關閘門(verify_no_overtake)量的是示意線形管線、照樣全綠。
  // 🔴 所以這支一定要掛在出貨鏈上,而且它自己會先具名斷言「physical 已就緒、has() 覆蓋 918/918」
  //    ——分母塌掉的話它會紅,不會像前一支那樣靜靜地驗錯管線。全日重放約五分鐘,不接受縮短取樣:
  //    BASE_A/B/C/OPP 那幾個棘輪基線是在 SAMPLE=120 下量的,改取樣密度會讓棘輪失去意義。
  const overlap = spawnSync('node', [path.join(wt, 'scripts', 'verify_physical_no_overlap.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(overlap.stdout || ''); process.stderr.write(overlap.stderr || '');
  if (overlap.status !== 0) fail('實體股道上的列車互穿檢查未通過（單獨重跑：npm run check-physical-overlap）');
  // 實體層畫車速度：立體地圖把剖面的進度比例乘到實體股道長上，#fpSpd 已夾過看不出來，
  // 只有直接量 railIslandPhysical.sample 才抓得到（issue #15，2026-09-19 修前 271 段超標）。
  const physSpeed = spawnSync('node', [path.join(wt, 'scripts', 'verify_phys_speed_cap.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(physSpeed.stdout || ''); process.stderr.write(physSpeed.stderr || '');
  if (physSpeed.status !== 0) fail('實體股道上的畫車速度超過車種極速（單獨重跑：npm run check-phys-speed-cap）');

  const stationRoutes = spawnSync('node', [path.join(wt, 'scripts', 'verify_verified_station_routes.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(stationRoutes.stdout || ''); process.stderr.write(stationRoutes.stderr || '');
  if (stationRoutes.status !== 0) fail('具名派軌、太麻里月台來源、非電化限制或接站連續驗證未通過');

  const remainingRoutes = spawnSync('node', [path.join(wt, 'scripts', 'verify_remaining_station_routes.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(remainingRoutes.stdout || ''); process.stderr.write(remainingRoutes.stderr || '');
  if (remainingRoutes.status !== 0) fail('多站改派、借路保護或進出站連續驗證未通過');

  const terrainChunks = spawnSync('node', [path.join(wt, 'scripts', 'verify_terrain_chunk_cache.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(terrainChunks.stdout || ''); process.stderr.write(terrainChunks.stderr || '');
  if (terrainChunks.status !== 0) fail('地形分片快取未通過——忽略 Range 的伺服器會被重複下載同一片（單獨重跑：npm run check-terrain-chunk-cache）');
  const guangci = spawnSync('node', [path.join(wt, 'scripts', 'verify_guangci_tracks.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(guangci.stdout || ''); process.stderr.write(guangci.stderr || '');
  if (guangci.status !== 0) fail('廣慈延伸段雙軌連通性或來源座標未通過');
  const formations = spawnSync('node', [path.join(wt, 'scripts', 'verify_formations.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(formations.stdout || ''); process.stderr.write(formations.stderr || '');
  if (formations.status !== 0) fail('列車編組節數未通過——有車種的實際編組退回 3 節示意（單獨重跑：npm run check-formations）');
  const dr1000 = spawnSync('node', [path.join(wt, 'scripts', 'verify_dr1000_perf.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(dr1000.stdout || ''); process.stderr.write(dr1000.stderr || '');
  if (dr1000.status !== 0) fail('DR1000 運動參數未通過——支線柴油客車拿到電聯車的加減速（單獨重跑：npm run check-dr1000-perf）');
  // 預算剖面表過期也是無聲失效：前端判過期只看 T／L，改了車種參數或位置模型卻沒重產表，舊值照樣被採用。
  // 要排在資料清單之前——照提示重產表之後，清單也跟著要重產。
  const runProf = spawnSync('node', [path.join(wt, 'scripts', 'build_run_profiles.mjs'), '--check'], { cwd:wt, encoding:'utf8' });
  process.stdout.write(runProf.stdout || ''); process.stderr.write(runProf.stderr || '');
  if (runProf.status !== 0) fail('台鐵預算剖面表與目前的模型不符（前端會照舊表畫位置），或 MR1 交會推論棘輪退步（單獨重跑：node scripts/build_run_profiles.mjs --check）');
  // 資料清單過期是無聲失效：網站宣稱什麼都沒變，App 就永遠不重抓那個檔。原本只有 App 的 prepare-web
  // 與每日巡檢會驗，網站出貨不驗——DR1000 那批重建了跑段剖面卻漏了重產清單，出貨前靠人工比對才發現。
  const manifest = spawnSync('node', [path.join(wt, 'scripts', 'verify_data_manifest.mjs'), wt], { cwd:wt, encoding:'utf8' });
  process.stdout.write(manifest.stdout || ''); process.stderr.write(manifest.stderr || '');
  if (manifest.status !== 0) fail('資料清單與資料檔不符——App 會以為檔案沒變、永遠不重抓（修法：npm run build-manifest 後一起 commit）');
  const fullFormations = spawnSync('node', [path.join(wt, 'scripts', 'verify_full_formations_browser.mjs')], { cwd:wt, encoding:'utf8', env:{...process.env,PORT:''} });
  process.stdout.write(fullFormations.stdout || ''); process.stderr.write(fullFormations.stderr || '');
  if (fullFormations.status !== 0) fail('完整／推估編組的實際渲染或手機切換未通過');
  const trackSide = spawnSync('node', [path.join(wt, 'scripts', 'verify_metro_track_side.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(trackSide.stdout || ''); process.stderr.write(trackSide.stderr || '');
  if (trackSide.status !== 0) fail('捷運雙軌左右未通過——有路線的來車與去車跑在真實相反的股道上（單獨重跑：npm run check-metro-track-side）');
  const trtcLineFallback = spawnSync('node', [path.join(wt, 'scripts', 'verify_trtc_line_fallback.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(trtcLineFallback.stdout || ''); process.stderr.write(trtcLineFallback.stderr || '');
  if (trtcLineFallback.status !== 0) fail('北捷單線 0 台的班表退路未通過——官方來源失效時可能整條線消失（單獨重跑：npm run check-trtc-line-fallback）');
  const nangangStop = spawnSync('node', [path.join(wt, 'scripts', 'verify_nangang_stop_position.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(nangangStop.stdout || ''); process.stderr.write(nangangStop.stderr || '');
  if (nangangStop.status !== 0) fail('文湖線南港展覽館停車位置未通過——兩方向必須停在月台內的 OSM 正式停車點（單獨重跑：npm run check-nangang-stop-position）');
  const sun = spawnSync('node', [path.join(wt, 'scripts', 'verify_sun.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(sun.stdout || ''); process.stderr.write(sun.stderr || '');
  if (sun.status !== 0) fail('日夜光影的太陽位置與時間連續性驗證未過');

  // 三鶯線營運時段(2026-09-11 掛上出貨鏈)。它守的是全網唯一一條「時刻表用官方公告的營運時段
  // ＋班距合成出來」的線:兩端寫錯過三次,每次的症狀都是使用者才看得到的——時段太寬就整晚畫
  // 幽靈車(v0711j,7.5 小時),太窄就該有車的時段整段空白(08-16~08-18,四小時)。腳本自己起
  // server(洗掉繼承來的 VURL,免得去驗別棵樹),資料層先驗官方首末班發車真的各有一班,再用
  // 兩引擎驗三條繪製路徑(單系統／北北桃群組／全台同框裝飾層)。
  const sanying = spawnSync('node', [path.join(wt, 'scripts', 'verify_sanying_hours.mjs')],
    { cwd: wt, encoding: 'utf8', env: { ...process.env, VURL: '' } });
  process.stdout.write(sanying.stdout || ''); process.stderr.write(sanying.stderr || '');
  if (sanying.status !== 0) fail('三鶯線營運時段守門人未過——官方首末班發車缺班,或營運窗外畫得出列車'
    + '（單獨重跑：npm run check-sanying）');

  const railStructures = spawnSync('node', [path.join(wt, 'scripts', 'verify_rail_structures.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(railStructures.stdout || ''); process.stderr.write(railStructures.stderr || '');
  if (railStructures.status !== 0) fail('軌道橋面與路基驗證未過');
  const traBinding = spawnSync('node', [path.join(wt, 'scripts', 'verify_tra_plan_binding.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(traBinding.stdout || ''); process.stderr.write(traBinding.stderr || '');
  if (traBinding.status !== 0) fail('台鐵班表與股道綁定防護未通過');
  // 同向預排待避是瀏覽器裡依當日車群決定，靜態派車檢查碰不到；固定順向 6563／207 與
  // 反向 114／228，在 Chromium＋WebKit 實測煞車提前量、站內停等、清站間隔與實體股道。
  const overtakeStation = spawnSync('node', [path.join(wt, 'scripts', 'verify_overtake_station_planning.mjs')],
    { cwd: wt, encoding: 'utf8', env: { ...process.env, PORT: '' } });
  process.stdout.write(overtakeStation.stdout || ''); process.stderr.write(overtakeStation.stderr || '');
  if (overtakeStation.status !== 0) fail('台鐵預排待避的煞車距離、站內停等或雙方向案例未通過');
  const thsrBinding = spawnSync('node', [path.join(wt, 'scripts', 'verify_thsr_plan_binding.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(thsrBinding.stdout || ''); process.stderr.write(thsrBinding.stderr || '');
  if (thsrBinding.status !== 0) fail('高鐵當日班表與股道綁定防護未通過(新車次或改時刻的班次會掉回示意線形而折疊)');
  const thsrTracks = spawnSync('node', [path.join(wt, 'scripts', 'verify_thsr_station_tracks.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(thsrTracks.stdout || ''); process.stderr.write(thsrTracks.stderr || '');
  if (thsrTracks.status !== 0) fail('高鐵車站股道規則未通過(停靠列車要停外側到發線、通過列車走內側正線)');
  const thsrOccupancy = spawnSync('node', [path.join(wt, 'scripts', 'verify_thsr_reservation_motion.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(thsrOccupancy.stdout || ''); process.stderr.write(thsrOccupancy.stderr || '');
  if (thsrOccupancy.status !== 0) fail('高鐵派車佔用模型與行車模型不同源(曲線指紋不符、通過時刻差超過 1 秒、或同日班次有股道交疊)——重跑六種日型派車');
  const traContinuity = spawnSync('node', [path.join(wt, 'scripts', 'verify_tra_binding_continuity.mjs')], { cwd:wt, encoding:'utf8' });
  process.stdout.write(traContinuity.stdout || ''); process.stderr.write(traContinuity.stderr || '');
  if (traContinuity.status !== 0) fail('台鐵雙向通過站或加開車股道連續性未通過');

  // 收藏車庫：出貨樹必須包含完整模型、縮圖、雜湊与 62 款可達成規則。
  const garage = spawnSync('node', [path.join(wt, 'scripts', 'verify_garage_assets.mjs')], { encoding: 'utf8' });
  process.stdout.write(garage.stdout || ''); process.stderr.write(garage.stderr || '');
  if (garage.status !== 0) fail('收藏車庫模型或收集規則檢查未通過');

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
  const xferCollapse = spawnSync('node', [path.join(wt, 'scripts', 'verify_transfer_collapse.mjs')], { encoding: 'utf8' });
  process.stdout.write(xferCollapse.stdout || ''); process.stderr.write(xferCollapse.stderr || '');
  if (xferCollapse.status !== 0) fail('轉乘接續的展開/收合未過——收合態把答案一起藏掉,或收合鈕點不動'
    + '（單獨重跑：npm run check-transfer-collapse）');

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

  // ── 2.9b 北捷模型載入器不跨 request 共用進行中的 promise ──────────────────────
  // 2026-09-23 事故之後補的：模組層快取曾經存【進行中的 promise】，發起它的 request 被取消時
  // I/O 跟著被取消、promise 永遠不 resolve，同一個 isolate 之後的 cron 每發都卡滿 15 分鐘被砍
  // （exceededWallTime），北捷帳本斷層、iPhone 捷運等車卡停推。這種回歸不會讓畫面或別的判準變紅，
  // 只會在某個晚上帳本又斷掉。純離線（ASSETS 替身讀這棵乾淨出貨樹的 data/），約 1 秒。
  const trtcMemo = spawnSync('node', [path.join(wt, 'scripts', 'verify_trtc_model_memo.mjs')], { encoding: 'utf8' });
  process.stdout.write(trtcMemo.stdout || ''); process.stderr.write(trtcMemo.stderr || '');
  if (trtcMemo.status !== 0) fail('北捷模型載入器閘門未過——模組層快取又存了進行中的 promise，一個 request 被取消就會卡死整個 isolate 的 cron'
    + '（單獨重跑：node scripts/verify_trtc_model_memo.mjs）');

  // ── 2.9c 台鐵即時動態的上游刷新去重不可無限期等別人的 I/O ─────────────────────
  // 與 2.9b 同一類（2026-09-23）：traLiveInflight 讓跟車卡、等站卡與訪客共搭一發 TDX 刷新（省點數，不能拿掉），
  // 但發起者被取消時那一發永遠不會結束；沒有上限的話，這個 isolate 之後每一次刷新都陪它卡到 15 分鐘。
  // 驗去重仍在、超齡放掉重刷、搭便車有限等待且不多打 TDX、被放掉的舊那發晚到不清掉新那發。純離線，約 3 秒。
  const traInflight = spawnSync('node', [path.join(wt, 'scripts', 'verify_tra_live_inflight.mjs')], { encoding: 'utf8' });
  process.stdout.write(traInflight.stdout || ''); process.stderr.write(traInflight.stderr || '');
  if (traInflight.status !== 0) fail('台鐵即時刷新去重閘門未過——搭便車又會無限期等別人的 I/O，或去重被拿掉而多打 TDX'
    + '（單獨重跑：node scripts/verify_tra_live_inflight.mjs）');

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

  // ── 2.11b 公車站牌搜尋與到站守門（單元 C 第一批）─────────────────────────
  // 🔴 不在出貨鏈上的驗收腳本等於不存在，所以本批一寫完就掛上來。這兩支守的是：
  //    五種到站語意不得被收斂成同一個「沒資料」、GoBack 2／3 不准猜方向、
  //    端點網址只能來自 data/bus_providers.json、五支公車端點都掛了 BUS_LIMITER
  //    （bus-transfer／bus-leg-live 是本批補的舊債，bus-route-stops 是 09-13 補的）、
  //    雙層 TTL 的算式與註解一致、授權署名沒被拿掉。
  const busStop = spawnSync('node', [path.join(wt, 'scripts', 'verify_bus_stop_worker.mjs')], { encoding: 'utf8' });
  process.stdout.write(busStop.stdout || ''); process.stderr.write(busStop.stderr || '');
  if (busStop.status !== 0) fail('公車站牌到站驗收未過（單獨重跑：npm run check-bus-stop）');
  const busStopFront = spawnSync('node', [path.join(wt, 'scripts', 'verify_bus_stop_frontend.mjs')], { encoding: 'utf8' });
  process.stdout.write(busStopFront.stdout || ''); process.stderr.write(busStopFront.stderr || '');
  if (busStopFront.status !== 0) fail('公車站牌前端／署名守門未過（單獨重跑：npm run check-bus-stop）');
  // 瀏覽器那一支（真的開 Chromium、真的打字、真的點下去）也掛上來：靜態守門看得到「文案在檔案裡」，
  // 看不到「按下去有沒有畫出來」，而本批第一次跑瀏覽器就抓到英日語顯示的是另一份字典的文案。
  const busStopBrowser = spawnSync('node', [path.join(wt, 'scripts', 'verify_bus_stop_browser.mjs')], { encoding: 'utf8' });
  process.stdout.write(busStopBrowser.stdout || ''); process.stderr.write(busStopBrowser.stderr || '');
  if (busStopBrowser.status !== 0) fail('公車站牌瀏覽器驗收未過（單獨重跑：node scripts/verify_bus_stop_browser.mjs）');

  // 高鐵對號座餘位與票價(2026-09-11 的設計批次)——這支閘門寫好之後一直沒掛上出貨鏈,等於沒有守門人。
  // 它自己就分四層(純函式／端點替身／Playwright 雙引擎／零回歸重跑 punctual＋my_trains),預設離線,
  // 真上游要 --real 才打(TDX 有節流),所以掛在這裡不會讓出貨依賴外部服務。
  const thsrSeat = spawnSync('node', [path.join(wt, 'scripts', 'verify_thsr_seat.mjs')], { cwd: wt, encoding: 'utf8' });
  process.stdout.write(thsrSeat.stdout || ''); process.stderr.write(thsrSeat.stderr || '');
  if (thsrSeat.status !== 0) fail('高鐵對號座餘位／票價驗收未過（單獨重跑：npm run check-thsr-seat）');

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
  // 🔴 preflight 主動洗掉繼承來的 QT_ONLY(空字串走 verify_query_tab.mjs 的 falsy 分支＝全跑)——
  // 「不設」不等於「不受影響」，出貨那個 shell 若曾 export QT_ONLY，spawnSync 預設會原樣繼承。
  const queryTab = spawnSync('node', [path.join(wt, 'scripts', 'verify_query_tab.mjs'), wt], { encoding: 'utf8', env: { ...process.env, QT_ONLY: '', QUERY_SECTION: '' } });
  process.stdout.write(queryTab.stdout || ''); process.stderr.write(queryTab.stderr || '');
  if (queryTab.status !== 0) fail('查詢分頁守門人未過——兩態 sheet／答案同源／自動開／更多抽屜之一壞了'
    + '（單獨重跑：npm run check-query-tab）');

  // ── 2.16 阿里山林鐵守門人(2026-09-08) ─────────────────────────────────────
  // 為什麼值得進出貨鏈:v0907n 分軌(實體股道定位)上線當天,就讓林鐵停在站裡的車被畫到軌道外
  // 94m／164m,而當時**沒有任何一支既有閘門紅**——「所有奔跑中列車都在軌道上」這條只有這裡有。
  // (根因是 OSM 股道與 data/afr.json 對神木差 163m、兩份各自自洽;修法是把林鐵排除在
  // rail-3d/physical/client.js 的 PHYSICAL_SYSTEMS 之外,見該檔註解。)
  // 順帶守 A–G:路網拼接與獨立山螺旋累積轉向、合成班次座標與軌道同源、看板文案、四種手機寬度
  // 的真點擊(#gtabOne → #gtabPop)。兩引擎約 3–4 分鐘。
  // 🔴 洗掉繼承來的 PORT:這支平常自己起 dev server 並用 md5 斷言「量到的是這棵樹」,但 PORT
  //    有值時它改連既有 server——出貨那個 shell 若 export 過 PORT(本機同時 30+ 個 worktree
  //    各有自己的 dev server),就會一聲不響地去驗別人的樹。空字串走 falsy 分支＝照常自起。
  const afr = spawnSync('node', [path.join(wt, 'scripts', 'verify_afr.mjs')], { encoding: 'utf8', env: { ...process.env, PORT: '' } });
  process.stdout.write(afr.stdout || ''); process.stderr.write(afr.stderr || '');
  if (afr.status !== 0) fail('阿里山林鐵守門人未過——路網／班次／看板／手機版,或「奔跑中列車都在軌道上」壞了'
    + '（單獨重跑：npm run check-afr）');
  const afrFacing = spawnSync('node', [path.join(wt, 'scripts', 'verify_afr_push_pull.mjs')], { cwd:wt, encoding:'utf8', env:{...process.env,PORT:'',ENGINE:'',MUTATE:'',OUT:''} });
  process.stdout.write(afrFacing.stdout || ''); process.stderr.write(afrFacing.stderr || '');
  if (afrFacing.status !== 0) fail('林鐵推進／牽引方向、折返車身或手機驗證未通過');

  // ── 2.17 issue #19 跟車面板時間軸守門人(2026-09-08) ───────────────────────
  // 為什麼值得進出貨鏈:它守的是「跟車面板宣稱的已行駛里程」與「地圖實際繪製的車輛座標」
  // 對不對得上,而判準刻意【不與實作同源】——不拿 nextStopInfo 去驗 journeyProgress(那兩者
  // 同軸、必然自洽),是把面板的里程換算回路線上的一點,量它與繪製點的實地距離,另一路用幾何
  // 投影反算里程互相對帳。這正是「別人改東西時會靜默壞掉」那一類:動誤點吸收、動 trainPos、
  // 動 journeyProgress、動阻擋 hold,畫面照樣有車、面板照樣有數字,只是差了一個誤點量。
  // 順帶守停靠態(狀態列/下一站/時速三處一致)與三種手機寬度下遙測列與跟隨小卡的一致性。
  // 單引擎 12 秒(含自己起 dev server),是本鏈最便宜的瀏覽器閘門。
  // 🔴 洗掉繼承來的 VURL:有值時它改連既有 server——出貨那個 shell 若 export 過 VURL
  //    (本機同時 30+ 個 worktree 各有自己的 dev server),就會一聲不響地去驗別人的樹。
  //    空字串走 falsy 分支＝照常自起(埠由 OS 指派),而且 G0 的 md5 閘門兩條路都會跑。
  const issue19 = spawnSync('node', [path.join(wt, 'scripts', 'verify_issue19.mjs')], { encoding: 'utf8', env: { ...process.env, VURL: '', PORT: '' } });
  process.stdout.write(issue19.stdout || ''); process.stderr.write(issue19.stderr || '');
  if (issue19.status !== 0) fail('跟車面板時間軸守門人未過——面板的里程與地圖畫的車對不上,或停靠態/遙測列壞了'
    + '（單獨重跑：npm run check-issue19）');

  // ── 2.18 字級雙倍率契約守門人(2026-09-08)——純靜態、0.16 秒、不需要 dev server ────
  // 設計檔 TURN 5/6 的對照表不是一顆倍率:主文 --ui 是 1／1.25／1.5,小標籤與次要說明
  // --uis 只有 1／1.14／1.29。兩者互相跑錯邊時畫面「看起來只是字大了一點」,沒有任何
  // 既有閘門會紅——2026-09-08 一次掃出六處違規,每一處都追得到具名的破壞 commit,
  // 而且四處落在轉乘接續卡與查詢答案區這兩塊後來才加的 UI(新程式碼沒跟上契約)。
  // 🔴 只掛 F0 這組靜態掃描,不掛整支 verify_font_scale:後者兩引擎 1468 條要 10 分 04 秒,
  //    放進每次出貨的前置閘門不可行。走的是腳本裡同一份 staticRamps(),不是複製一份正則。
  const fsRamp = spawnSync('node', [path.join(wt, 'scripts', 'verify_font_scale.mjs')],
    { encoding: 'utf8', env: { ...process.env, FS_STATIC_ONLY: '1' } });
  process.stdout.write(fsRamp.stdout || ''); process.stderr.write(fsRamp.stderr || '');
  if (fsRamp.status !== 0) fail('字級雙倍率契約未過——有字級跑錯倍率(主文 --ui／小標籤 --uis)'
    + '（單獨重跑：npm run check-font-ramp）');

  // ── 2.19 林鐵車次撞號守門人(2026-09-08) ──────────────────────────────────
  // 為什麼值得進出貨鏈:台鐵與阿里山林鐵的車次號碼大量重複(1、2、101、121…),而
  // data/tra_special_trains.json 是台鐵專屬——凡「拿車次／車型名／站名去 state.trains 撈」
  // 的地方漏了系統閘門,林鐵的車就會頂著台鐵具名列車的名字出現。issue#23(2026-08-04)只在
  // specialOf() 補了閘門,這支腳本當時也只驗 specialOf;2026-09-08 使用者回報「點環島之星
  // 會跑阿里山林鐵的車」,查出來是另外兩個消費端(護照收集章 dexCandidates、探索面板
  // computeHighlights)各自繞過 specialOf 自己比對。**這支腳本先前不在任何 npm script、
  // 也不在本鏈上,等於不存在**——這正是第二個洞活了一個月沒人發現的原因,所以這次一起掛上。
  // 單引擎約 40 秒(含自己起 dev server)。
  // 🔴 洗掉繼承來的 PORT:有值時它改連既有 server,出貨那個 shell 若 export 過 PORT
  //    (本機同時 30+ 個 worktree 各有自己的 dev server)就會一聲不響地去驗別人的樹。
  const afrNo = spawnSync('node', [path.join(wt, 'scripts', 'verify_afr_trainno.mjs'), wt],
    { encoding: 'utf8', env: { ...process.env, PORT: '' } });
  process.stdout.write(afrNo.stdout || ''); process.stderr.write(afrNo.stderr || '');
  if (afrNo.status !== 0) fail('林鐵車次撞號守門人未過——林鐵的車被當成台鐵具名列車,或收集章／今日亮點跟到別的系統'
    + '（單獨重跑：npm run check-afr-trainno）');

  // ── 2.20 捷運車次欄守門人(2026-09-08) ────────────────────────────────────
  // 為什麼值得進出貨鏈:這個欄位的風險不是「顯示不出來」,是「顯示了不該顯示的東西」。
  // 契約(trtc-official-lifecycle-contract 規則 7 與禁手表)寫死車次只是標籤——內部 vehicleId
  // 不准冒充車次、CarWeight 的車廂編號也不准;文湖線 BR 與環狀線 Y 官方本來就沒有這一欄。
  // 這一類「多顯示了一個看似合理的號碼」在畫面上完全不像壞掉,只有守門人抓得到。
  // 兩份磁碟 fixture 各驗一條路(北捷官方名冊／Core publicLabel),正反判準成對,約 60 秒。
  // 🔴 同 2.19:洗掉繼承來的 PORT,免得去驗別棵樹。
  const mrtNo = spawnSync('node', [path.join(wt, 'scripts', 'verify_metro_train_no.mjs'), wt],
    { encoding: 'utf8', env: { ...process.env, PORT: '' } });
  process.stdout.write(mrtNo.stdout || ''); process.stderr.write(mrtNo.stderr || '');
  if (mrtNo.status !== 0) fail('捷運車次欄守門人未過——有官方車次卻沒顯示,或沒有官方車次卻硬填了一個'
    + '（單獨重跑：npm run check-metro-train-no）');

  // ── 2.21 本地提醒守門人(2026-09-13) ──────────────────────────────────────
  // 為什麼值得進出貨鏈:這支此前【沒有任何呼叫者】,而且它自己已經紅了大約兩個月沒人知道——
  // 12 個案例倒在同一個原因(腳本用中文字串找元件,Playwright 預設語系讓 I18N_LANG 變成 en),
  // 另外 4 個倒在 2026-09-06 查詢分頁改版把提醒入口搬走而判準沒跟著搬。兩者都是
  // 「不在出貨鏈上的驗收腳本等於不存在」的教科書例子(同 2.7／2.8／2.9)。
  // 它守的東西沒有別的判準照得到:提醒是【純本地】功能(localStorage + Capacitor 本地通知),
  // 不經過任何 API,所以資料閘門一條都碰不到;而排程算錯的症狀是「時間到了沒響」或
  // 「響在錯的時間」——畫面永遠正常,使用者要等到隔天才發現,而且只在真機上發現。
  // 涵蓋:五個入口都還在、跨日與誤點快照、20 則上限、週期性規則的下次時間、原生排程格位
  // 不相撞、iOS 64 則預算、既有 v1 資料不被動到。實測 38 秒(22 案、自己起 dev server)。
  // 🔴 洗掉繼承來的 NOTIFY_BASE:它會讓整支跑去驗【別棵樹】而紅綠長得一模一樣(同 2.19 的 PORT)。
  const notify = spawnSync('node', [path.join(wt, 'scripts', 'verify_notify_p0.mjs')],
    { encoding: 'utf8', env: { ...process.env, NOTIFY_BASE: '', PORT: '' } });
  process.stdout.write(notify.stdout || ''); process.stderr.write(notify.stderr || '');
  if (notify.status !== 0) fail('本地提醒守門人未過——提醒入口不見了,或排程時間／格位／上限算錯'
    + '（單獨重跑：npm run check-notify）');

  // ── 2.22 台鐵誤點偏移的畫面行為守門人(2026-09-19) ─────────────────────────
  // 為什麼值得進出貨鏈:它守兩條使用者裁示——誤點一次加大 ≥5 分要一步跳回真實位置(09-05)、未滿 5 分要
  // 慢速前進不准定格(09-07)——外加「暫停時車不准自己動」「追回誤點時不得超過車種極速 2 倍」。受測的
  // easedShift／liveDelaySec／trainPos／實體股道 trainPosAt 都是別批常改的地方,改壞了畫面照樣有車,
  // 只是位置差一個誤點量,沒有別的閘門量得到。這支此前沒有任何呼叫者,而且深夜跑會因為選到沒在跑的車
  // 而假紅(2026-09-19 已釘鐘 12:00 修掉,另加 P0／D2 具名前提)。自己起純靜態 server(/api 一律 404,
  // 不打上游),雙引擎約 30 秒。
  // 🔴 洗掉繼承來的 PORT／ROOT:有值時它改連既有 server、驗的可能是別棵樹(同 2.16／2.17)。
  // 站點錨點是這批次新增的例外路徑：用真實班表的里程遞增／遞減班次各一，重放首見站點、
  // 換站已離站、同站小誤點與同號重複列。不掛進出貨鏈就會變成只有這次人工跑過的一次性腳本。
  for (const engine of ['chromium', 'webkit']) {
    const traAnchor = spawnSync('node', [path.join(wt, 'scripts', 'verify_tra_live_anchor.mjs')],
      { cwd: wt, encoding: 'utf8', env: { ...process.env, PORT: '', ROOT: '', ENGINE: engine } });
    process.stdout.write(traAnchor.stdout || ''); process.stderr.write(traAnchor.stderr || '');
    if (traAnchor.status !== 0) fail(`台鐵站點錨點守門人(${engine})未過——換站小誤點沒立即對齊、重複列蓋掉較大誤點，或雙向班次其一失效`
      + '（單獨重跑：ENGINE=webkit npm run check-tra-live-anchor）');
  }

  const traMotion = spawnSync('node', [path.join(wt, 'scripts', 'verify_tra_motion.mjs')],
    { cwd: wt, encoding: 'utf8', env: { ...process.env, PORT: '', ROOT: '', ENGINES: 'chromium,webkit' } });
  process.stdout.write(traMotion.stdout || ''); process.stderr.write(traMotion.stderr || '');
  if (traMotion.status !== 0) fail('台鐵誤點偏移守門人未過——大跳變沒一步跳回、小增量定格、暫停時車自己動,或追回時超速'
    + '（單獨重跑：ENGINES=chromium,webkit npm run check-tra-motion）');

  // ── 2.23 自家營運異常偵測守門人(2026-09-19) ─────────────────────────────
  // 為什麼值得進出貨鏈:捷運徽章(即時更新中／官方即時／官方中斷／班表備案)與台鐵大面積誤點橫幅是異常狀態機
  // 的兩個出口,改壞了畫面照樣有字、只是狀態錯,沒有別的閘門量得到。這支此前沒有任何呼叫者,判準一度過期
  // (Metro-Core 接管後的新字樣、橫幅清空只設 hidden),2026-09-19 修正並逐條突變驗過。純靜態 server、約 4 秒。
  // 🔴 PORT 傳 0:讓它自己挑空埠,不撞別的 session 正在用的預設 5188。
  const anomaly = spawnSync('node', [path.join(wt, 'scripts', 'verify_anomaly.mjs')],
    { cwd: wt, encoding: 'utf8', env: { ...process.env, PORT: '0' } });
  process.stdout.write(anomaly.stdout || ''); process.stderr.write(anomaly.stderr || '');
  if (anomaly.status !== 0) fail('營運異常偵測守門人未過——捷運即時徽章或台鐵大面積誤點橫幅的狀態錯了'
    + '（單獨重跑：npm run check-anomaly）');

  // 觀看入口是沉浸模式的退出路徑；雙引擎真點進入、重開、退出與重載。
  // 2026-09-25 加側欄模式（手機橫放、平板橫向）的觀看鈕位置：沒開卡片留在右上工具列、開卡片或跟車才讓到側欄左邊，
  // 先前只量手機直向與桌面，iPad 橫向鈕浮在畫面中間從 9/14 起沒有任何閘門看得到。約 40 秒。
  const viewControls = spawnSync('node', [path.join(wt, 'scripts', 'verify_view_controls_gate.mjs')], { cwd: wt, encoding: 'utf8' });
  process.stdout.write(viewControls.stdout || ''); process.stderr.write(viewControls.stderr || '');
  if (viewControls.status !== 0) fail('觀看設定、側欄模式觀看鈕位置或沉浸模式退出驗收未通過（單獨重跑：node scripts/verify_view_controls_gate.mjs）');

  // ── 2.24 護照成就章／收集章說明卡守門人(2026-09-25) ────────────────────────
  // 為什麼值得進出貨鏈(2.8 那把「成本 vs 保護」的尺):它守的缺陷 (a) 對真人 100% 復現——桌面滑鼠停在章上,
  // 說明卡與瀏覽器原生提示兩層疊著出現;(b) 別的閘門都量不到,verify_i18n 當時甚至把殘留的 title 當成規格斷言;
  // (c) 已經被別批無聲弄壞過一次——08-28 多語那批重套時把 title 加回來,這支不在鏈上,從 08-28 紅到 09-25 沒人看到。
  // 另守卡片內容／進度逐枚比對、鍵盤與讀螢幕軟體(Tab 開卡、Enter、Esc、無障礙樹描述)、觸控點按開收。
  // 雙引擎、自己起純靜態 server、埠號由系統挑(不撞別的 session 手動跑的同一支),約 14 秒。
  const achvHelp = spawnSync('node', [path.join(wt, 'scripts', 'verify_achv_help.mjs')], { cwd: wt, encoding: 'utf8' });
  process.stdout.write(achvHelp.stdout || ''); process.stderr.write(achvHelp.stderr || '');
  if (achvHelp.status !== 0) fail('護照說明卡守門人未過——原生 title 殘留、卡片內容或進度錯配、鍵盤或觸控開收失效'
    + '（單獨重跑：npm run check-achv-help）');

  // ── 2.25 面板 sticky 標題讓位守門人(2026-09-25) ────────────────────────────
  // 為什麼值得進出貨鏈(2.8 那把尺):(a) 對鍵盤使用者 100% 復現——手機 sheet 小段只有 230px,往回走的焦點
  // 整顆停在標題底下(修前我的最愛 700 步有 186 步被蓋);(b) 別的閘門量不到——founding_seal 的 G2.*.5 只量護照一張、
  // 而且不在鏈上;(c) 已經被無聲弄壞過一次——v0925k 護照那版用容器 scroll-padding-top,焦點一進標題裡的
  // × 內容就跳 128–130px,照樣上了正式站。另守 WebKit 文字欄位補捲、站名牌出現與換字級後讓位值跟上。
  // 雙引擎、自己起純靜態 server、埠號由系統挑,約 95 秒。要在 strip 之前:突變自檢會找 syncBoardHeadVar 的原始碼行。
  const boardPad = spawnSync('node', [path.join(wt, 'scripts', 'verify_board_scroll_pad.mjs')],
    { cwd: wt, encoding: 'utf8', env: { ...process.env, PORT: '' } });
  process.stdout.write(boardPad.stdout || ''); process.stderr.write(boardPad.stderr || '');
  if (boardPad.status !== 0) fail('面板標題讓位守門人未過——鍵盤聚焦被 sticky 標題蓋住、聚焦標題鈕時內容跳動，或讓位值沒跟上站名牌／字級'
    + '（單獨重跑：node scripts/verify_board_scroll_pad.mjs）');

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

  // ── 4.5 認正式站（判準與限制見檔頭）：上傳前、升版前各一次；--preview 不升版，不需要 ──────
  const prodGate = async (when, ifFail = '') => {
    const r = await checkProductionAncestry({ repo, sha, fetchProd, nodeModules: path.join(repo, 'node_modules') });
    if (!r.ok) fail(`${when}認正式站未過${ifFail}：${r.message}`);
    console.log(`${when}認正式站 ✓ ${r.message}`);
  };
  if (!PREVIEW) await prodGate('上傳前');

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
    await prodGate('升版前', `（已上傳的 ${verId} 沒有升版，正式站沒動）`);
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
    // 429 只重試不判死：2026-09-19 claude-4e 那輪收貨後這裡拿到 Cloudflare 邊緣限流(body「error code: 1015」、
    // retry-after 1),同一時間 /api/tra-live 與 /api/thsr-schedule 都 200、幾十秒後 trtc-live 也回 200——
    // 多個 session 同時打正式站就會踩到,與 Worker 壞沒壞無關。其他非 200 仍當場判死。
    let api = await fetchProd('/api/trtc-live');
    for (let attempt = 1; api.status === 429 && attempt <= 6; attempt++) {
      console.log(`  /api/trtc-live 回 429（${String(api.body).slice(0, 40)}），邊緣限流，10s 後重試 ${attempt}/6`);
      await new Promise(r => setTimeout(r, 10000));
      api = await fetchProd('/api/trtc-live');
    }
    if (api.status !== 200) fail(`/api/trtc-live 回 ${api.status}——Worker 路由疑似壞了`
      + (api.status === 429 ? '（連續一分鐘 429：先手動 curl 確認是不是邊緣限流還沒退）' : ''));
    console.log(`✅ 出貨完成：railisland.tw 逐 byte＝stripped(${sha.slice(0, 8)})，${stripped.length} bytes，BUILD '${newBuild}'，API 200`);
  }
  ok = true;
} finally {
  if (ok) { try { git('worktree', 'remove', '--force', wt); git('worktree', 'prune'); } catch {} }
  else console.error(`（出貨樹保留供除錯：${wt}）`);
}
