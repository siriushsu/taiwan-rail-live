import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const repoRoot = resolve(appRoot, '..');
const defaultOut = join(appRoot, 'www');

const fail = message => { throw new Error(`App 發行檢查失敗：${message}`); };
const assert = (condition, message) => { if (!condition) fail(message); };

// Stadia 官方要求的逐字署名(prepare-web 注入、本檔驗證,單一事實來源)
export const STADIA_ATTRIBUTION = '&copy; <a href="https://stadiamaps.com/" target="_blank">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

async function walk(root) {
  const files = [];
  const visit = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      const info = await lstat(full);
      assert(!info.isSymbolicLink(), `發行包不可含符號連結：${relative(root, full)}`);
      if (info.isDirectory()) await visit(full);
      else files.push(full);
    }
  };
  await visit(root);
  return files;
}

export async function readReleasePolicy() {
  return JSON.parse(await readFile(join(appRoot, 'release-policy.json'), 'utf8'));
}

// 發行版不得允許 sandbox 資格。背景:RevenueCat 的 entitlements.active 等同 activeInAnyEnvironment
// (SDK doc comment),所以 index.html 的 plusActiveFrom 用建置期注入的 window.RAIL_PLUS_SANDBOX_OK
// 把 sandbox 購買擋在正式 build 之外;那個旗標只給「要實測購買流程」的內部版打開
// (RAIL_PLUS_SANDBOX_OK=1 npm run build)。這道閘門就是「內部版上不了架」的那把鎖——沒有它,
// 那個建置旗標就只是一個沒人看守的後門。
// 判準刻意是「必須明確寫著 false」而不是「不得出現 true」:注入整段被拿掉時,後者會沉默放行
// (constraint 10 的沉默不是證據)。抽成獨立導出函式是為了能單元測試——餵合成 HTML 就驗得到
// 紅/綠,不必先建出一整包 www(見 scripts/verify_plus_entitlement_env.mjs)。
export function assertPlusSandboxOff(html) {
  assert(/window\.RAIL_PLUS_SANDBOX_OK=(true|false)/.test(html),
    '發行包缺少 window.RAIL_PLUS_SANDBOX_OK 注入——sandbox 資格閘門的建置旗標不見了,'
    + '請確認 app/scripts/prepare-web.mjs 仍在注入這個值');
  assert(!/window\.RAIL_PLUS_SANDBOX_OK=true/.test(html),
    '發行包把 sandbox 資格打開了(window.RAIL_PLUS_SANDBOX_OK=true)——TestFlight/模擬器的 sandbox 購買'
    + '會解鎖正式付費功能。這個旗標只給內部測試版用,送審/上架的 build 請不要帶 RAIL_PLUS_SANDBOX_OK=1');
  assert(/window\.RAIL_PLUS_SANDBOX_BUILD=null/.test(html),
    '正式發行包仍帶著 RAIL_PLUS_SANDBOX_BUILD——即使 SANDBOX_OK=false 也拒絕留下含糊的測試通道標記');
}

// TestFlight 內部測試包也要有自己的 fail-closed 閘門：只有 boolean=true 不夠，還必須把這次
// 明確核准的 build 號逐字打進包內。正式 verify 不傳 expect 值，仍走上面的嚴格關閉檢查。
export function assertPlusSandboxTestBuild(html, expectedBuild) {
  const build = String(expectedBuild || '');
  assert(/^[1-9]\d*$/.test(build), 'TestFlight Sandbox build 號必須是正整數');
  assert(/window\.RAIL_PLUS_SANDBOX_OK=true/.test(html),
    'TestFlight Sandbox 包沒有注入 window.RAIL_PLUS_SANDBOX_OK=true——購買後只會看到價格、不會解鎖');
  assert(html.includes(`window.RAIL_PLUS_SANDBOX_BUILD=${JSON.stringify(build)}`),
    `TestFlight Sandbox 包的測試通道 build 標記不是 ${build}`);
}

export async function assertLicensedBuildAllowed({ includeLicensedMusic, includeLicensedBasemaps }) {
  const policy = await readReleasePolicy();
  if (includeLicensedMusic) {
    assert(policy.music?.allTracksCommercialRightsVerified === true,
      '音樂授權政策尚未核准，不可建立含 Suno 音樂的 App');
    const checklist = await readFile(join(appRoot, 'MUSIC_LICENSE_CHECKLIST.md'), 'utf8');
    const trackRows = checklist.split('\n').filter(line => /^\| .+\.mp3 \|/.test(line));
    assert(trackRows.length === 29, `音樂核對表應有 29 首，目前是 ${trackRows.length} 首`);
    assert(trackRows.every(line => /\| 已核對 \|\s*$/.test(line)),
      '音樂核對表仍有未核對曲目');
    const config = await readFile(join(repoRoot, 'revenuecat-config.js'), 'utf8');
    assert(/musicRecordingLicensed\s*:\s*true/.test(config),
      'revenuecat-config.js 尚未明確啟用 musicRecordingLicensed:true');
  }
  const basemapRights = [
    ['paidAppUseVerified', '付費 App 商用'],
    ['leafletAndCapacitorUseVerified', 'Leaflet／Capacitor'],
    ['recordedVideoOutputVerified', '錄影輸出'],
    ['attributionRequirementsVerified', '署名要求']
  ];
  const rights = policy.onlineBasemaps || {};
  if (includeLicensedBasemaps) {
    for (const [key, label] of basemapRights) assert(rights[key] === true, `線上底圖的「${label}」授權尚未核准`);
  } else if (basemapRights.every(([key]) => rights[key] === true) && process.env.RAIL_ALLOW_SAFE_BUILD !== '1') {
    // 防呆（靜默降級）：release-policy 已核准線上底圖，卻要建「安全 build」（不含 Stadia／Esri 衛星）＝
    // 多半是忘了帶 RAIL_INCLUDE_LICENSED_BASEMAPS=1。此檢查在 prepare-web 清空 www 之前就擋下，保住既有
    // 授權版 www、避免把降級版本 cap sync 進原生或送審。刻意要出安全 build 就設 RAIL_ALLOW_SAFE_BUILD=1。
    fail('release-policy 已核准線上底圖，但目前要建的是「安全 build」（不含 Stadia／Esri 衛星）——多半是忘了帶授權旗標。'
      + '請改用 npm run build:release／npm run sync:release（或 RAIL_INCLUDE_LICENSED_BASEMAPS=1 npm run build）。'
      + '若確實要建安全 build，設 RAIL_ALLOW_SAFE_BUILD=1 再跑。');
  }
}

// ── showToast 注入面的審查帳本 ──────────────────────────────────────────────
// 指紋＝呼叫參數拿掉「所有字串literal內容」與空白之後剩下的程式結構。
// 這樣改文案不會動到指紋（不會為了改一句話就紅燈），改結構才會。
const TOAST_REVIEWED = new Map([
  [`info.done?'':''`, '兩個寫死字串二選一,無插入'],
  [`on?'':''`, '兩個寫死字串二選一,無插入'],
  [`''+note+''`, 'onLocateFail:note 只可能是四個寫死常數之一,無使用者資料'],
  [`m`, 'announceCollections:msgs 每個插值都已 escHtml;此處刻意傳 <b> 做粗體'],
  ['`${escHtml(item.title)}`', '眾包校正提示,已逸出'],
  ["`${out.added}${out.updated?`${out.updated}`:''}${out.skipped?`${out.skipped}`:''}`", '匯入結果的三個筆數,皆為數字'],
  [`label?(''+escHtml(label)+''):''`, '儲存地點:地點名可由 Takeout 匯入/帳號同步汙染,已逸出'],
  [`p.label?(''+escHtml(p.label)+''):''`, '設預設啟動地點:同上,已逸出'],
  // 2026-07-27 登記:使用說明中心「試一次」。helpRun() 只做 `const t = HELP_TRY[key]; if (!t) return;`,
  // 所以 t 必為 HELP_TRY 的成員;該表每個 toast 都是寫死的字面字串(實測:非字面值的 `toast:` grep 回 0,
  // 全檔無 `.toast =` 賦值),零插值、零使用者資料。新增 HELP_TRY 條目時若 toast 改成樣板字串要重審。
  [`t.toast`, '使用說明「試一次」:t 必為 HELP_TRY 成員,其 toast 全是寫死字面字串,無插入'],
  ["j.why===''?'':`${st.name}${Math.round(j.distM)},(${j.r})`", '單站打卡:st.name 來自內建班表/路線資料;distM 是 haversineKm 計算值,r 是 CHECKIN_RADIUS_M 數字常數'],
  ['`${st.name}`', '單站打卡:st 只由 nearbyStationCandidates 的內建班表/路線車站產生,站名不可由使用者編輯'],
  // 2026-08-14 登記:捷運等車卡(Task 6)。
  [`res&&res.why===''?'':''`, '等車卡開卡失敗:兩個寫死字串二選一(why===disabled 與否),無插入'],
  [`''+escHtml(String(station||''))+''`, '等車卡深連結找不到站:station 來自小工具深連結(外部輸入),已 escHtml 逸出;verify_metro_wait_entry.mjs H 組實測覆蓋'],
  ['`${st.name}${e&&e.n>1?`(${escHtml(e.n)})`:\'\'}`', '單站打卡成功:站名來自內建資料;e.n 從 localStorage 重讀且寫入失敗時可能保留髒值,故已逸出'],
  ['`${st.name}${tr.stops[toIdx].name}`+(j.ok?\'\':\'\')', '開始搭乘:兩個站名都來自 state.trains 的內建班表停靠站;j.ok 只選擇兩個寫死字串'],
  ['`${escHtml(r.fromName)}${st.name}${n}`', '完成搭乘:r.fromName 從 localStorage 還原故已逸出;st.name 由內建班表重建,n 是索引相減後的數字'],
  ['`${pts}24`', '懸賞認領成功:示範卡與 API 點數都先經 bountyNum 收斂為有限非負整數'],
  [`''+(j.error===''?'':'')`, '懸賞 API 的 error 只用來選擇兩個寫死字串,API 回傳內容本身沒有插入'],
  ['`${pts}`', '懸賞認領落盤失敗提示:pts 已先經 bountyNum 收斂為有限非負整數'],
  ['`${escHtml(r.train)},`', '搭乘衝突提示:r.train 從 localStorage 還原,已在進入 innerHTML 前逸出'],
  // 2026-08-18 登記:北捷官方位置的兩則說明。兩者插入的**全部是我們自己算出來的數字**
  // (count/maxM 經 Math.round、mins/count/removed 經 Math.max/Math.round/Number),
  // 沒有任何官方或使用者字串進得來;<b> 是刻意的排版。
  // 🔴 變數名故意不叫 `msg`:指紋是「拿掉字串內容後的結構」,登記 `msg,{wrap:true}` 等於放行
  //    未來所有同形呼叫。取專屬名字讓這兩條只涵蓋這兩個呼叫點,新的通用 msg 仍會被擋下來。
  [`resyncMsg,{wrap:true}`, 'trtcOfficialResyncTick:只插入 mins/count/removed,三者皆先經 Math 收斂為數字'],
]);

// 掃出每一個 showToast( 呼叫的完整參數（括號配對，不是 regex 抓一行）。
export function showToastCalls(src) {
  const out = [];
  let i = 0;
  while ((i = src.indexOf('showToast(', i)) !== -1) {
    if (/[\w$.]/.test(src[i - 1] || '')) { i += 10; continue; }   // 別把 xxxShowToast( 當成它
    const isDecl = /function\s+showToast\s*\($/.test(src.slice(Math.max(0, i - 12), i + 10));
    let j = i + 10, depth = 1;
    const start = j;
    while (j < src.length && depth > 0) {
      const c = src[j];
      if (c === '(') depth++; else if (c === ')') depth--;
      j++;
    }
    if (!isDecl) out.push(src.slice(start, j - 1));
    i = j;
  }
  return out;
}

const blankLiterals = s => s.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
export const toastFingerprint = raw => blankLiterals(raw).replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, '');

// 有沒有東西被插進去：拿掉 escHtml(...) 與字串內容後還剩識別字 ⇒ 有。
export function toastHasInjection(raw) {
  const rest = blankLiterals(raw.replace(/escHtml\([^()]*\)/g, '')).replace(/[^\x20-\x7E]/g, '');
  return (rest.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g) || [])
    .some(id => !['true', 'false', 'null', 'undefined'].includes(id));
}

export function assertToastSinksReviewed(html) {
  // 自檢：壞掉的偵測器不會報錯，它會安靜地讓每一樣東西通過——那比沒有閘門更糟，因為看起來是綠的。
  // 所以每次建置都先拿一個合成的惡意呼叫試它一次，認不出來就當場失敗。
  const canary = showToastCalls(`showToast('嗨' + attackerControlledName + '你好')`);
  assert(canary.length === 1 && toastHasInjection(canary[0]),
    'showToast 注入偵測器失效——連合成的未逸出拼接都認不出來,這道閘門已經沒有牙,不可發行');
  assert(!TOAST_REVIEWED.has(toastFingerprint(canary[0])), '合成樣本不該出現在審查帳本裡');

  const calls = showToastCalls(html);
  assert(calls.length >= 25, `showToast 呼叫點只掃到 ${calls.length} 個——掃描器壞了,不可當作通過`);
  const unreviewed = calls.filter(toastHasInjection).map(toastFingerprint).filter(fp => !TOAST_REVIEWED.has(fp));
  assert(unreviewed.length === 0,
    `showToast 有未經審查的動態插入（會直接進 innerHTML）,不可發行。\n` +
    unreviewed.map(fp => `      ${fp}`).join('\n') +
    `\n    請確認插入的值是否含使用者資料:含就包 escHtml(),確定安全就把上面的指紋登記進 verify-release.mjs 的 TOAST_REVIEWED 並寫明理由。`);
}

// ── Esri 金鑰活體檢查 ───────────────────────────────────────────────────────
// 為什麼需要它:2026-07-26 稽核發現網站那把 Esri token 早就失效,卻九天沒人察覺——因為判斷
// 「金鑰還活著嗎」用的證據是「衛星圖出得來」,而那個證據是假的:Esri 的**圖磚**端點只檢查
// token 參數在不在、不看值(實測撒哈拉 z17 冷門座標,真 token／`token=x`／亂打字串三者都回
// HTTP 200 且同樣 6416 bytes,完全不帶 token= 才回 499)。所以:
//   (1) 一律改打會真的驗證的 basemapstyles v2,不准用圖磚端點驗任何金鑰;
//   (2) 一定要**同時**打一串亂打的假金鑰當對照組。少了對照組,這道閘門哪天被換到另一個
//       不驗證的端點上,它會安靜地一直亮綠燈——那比沒有閘門更糟。
// 回應形狀(2026-07-26 實測):有效金鑰=HTTP 200 樣式 JSON;無效金鑰=HTTP 401 且 body 為
// {"error":{"code":498,...}};不帶 token=則是 499。故以「HTTP 狀態/錯誤碼」的組合當判準。
const ESRI_STYLE_PROBE = 'https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/arcgis/imagery';

export async function probeEsriKey(token, fetchImpl = fetch) {
  const res = await fetchImpl(`${ESRI_STYLE_PROBE}?token=${encodeURIComponent(token)}`,
    { signal: AbortSignal.timeout(20000) });
  const body = await res.text();
  let errorCode = null;
  try { errorCode = JSON.parse(body)?.error?.code ?? null; } catch { /* 非 JSON 或無 error 欄=正常樣式回應 */ }
  return { status: res.status, errorCode, verdict: `HTTP ${res.status}/${errorCode ?? 'ok'}`, alive: res.ok && errorCode === null };
}

export async function assertEsriKeyAlive(token, fetchImpl = fetch) {
  assert(token, 'App 包裡找不到 Esri token,無法檢查金鑰死活');
  // 對照組刻意做成與真金鑰同長度,免得失敗被歸因成「格式不對才被擋」而不是「值無效」。
  const decoy = 'AAPT' + 'x'.repeat(Math.max(60, token.length - 4));
  let live, dead;
  try {
    [live, dead] = await Promise.all([probeEsriKey(token, fetchImpl), probeEsriKey(decoy, fetchImpl)]);
  } catch (e) {
    fail(`連不上 ArcGIS,無法確認 Esri 金鑰死活（${e.message}）——這道閘門根本沒跑過,不可當作通過。`
      + '請確認網路後重跑;確實要在離線環境建置,設 RAIL_SKIP_KEY_LIVENESS=1 自行負責。');
  }
  // (1) 對照組先判:假金鑰擋不掉 ⇒ 這個端點不驗證 token 的值。
  assert(dead.errorCode === 498,
    `Esri 金鑰活體檢查沒有鑑別力:一串亂打的假金鑰竟拿到 ${dead.verdict}（預期 HTTP 401/498 Token Invalid）——`
    + '驗到的是一個不驗證的端點,等於沒驗。這正是 2026-07-26 那把死了九天的網站金鑰能一直「看起來正常」的原因。'
    + `請確認 ${ESRI_STYLE_PROBE} 仍是會驗證 API key 的端點,修好探針再發行——不要放寬判準讓它過。`);
  // (2) 正負對照:走到這裡代表假金鑰已被擋下,所以「兩邊一樣」只可能是真金鑰也被擋=它死了。
  assert(live.verdict !== dead.verdict,
    `Esri 金鑰已失效:打包進 App 的金鑰與對照用的假金鑰拿到完全相同的結果（${live.verdict}）,`
    + 'ArcGIS 對兩者一視同仁 ⇒ 這把金鑰的值沒有任何效力。'
    + '請到 https://location.arcgis.com/ 開一張新憑證（先設權限、最後才 Generate;只勾 Basemaps）,'
    + '更新 repo 根 .env 的 ESRI_API_KEY 後重建。切勿用「衛星圖還出得來」當作金鑰有效的證據。');
  // (3) 真金鑰必須真的通過,而不只是「跟假的不一樣」。
  assert(live.alive,
    `打包進 App 的 Esri 金鑰未通過 ArcGIS 驗證（${live.verdict}）,不可發行。`
    + '請確認 repo 根 .env 的 ESRI_API_KEY 是有效且權限含 Basemaps 的憑證。');
  return { live, dead };
}

export async function verifyRelease({
  out = defaultOut,
  expectLicensedMusic,
  expectLicensedBasemaps,
  expectPlusSandboxBuild = process.env.RAIL_PLUS_SANDBOX_OK === '1'
    ? String(process.env.RAIL_PLUS_SANDBOX_BUILD || '') : null,
  skipNativeSyncCheck = false
} = {}) {
  const output = resolve(out);
  const files = await walk(output);
  const relativeFiles = files.map(file => relative(output, file).replaceAll('\\', '/'));
  const indexPath = join(output, 'index.html');
  const html = await readFile(indexPath, 'utf8');

  // ── 創始會員截止時刻的「上線錨點」(B-4,2026-08-03 裁示)───────────────────────
  // 創始價視窗＝上線錨點時刻起算固定 30 天。上線錨點由 revenuecat-config.js 的
  // window.RAIL_REVENUECAT_CONFIG.foundingLaunchAt 提供(見該檔註解),程式碼本身不留猜的
  // 日期。index.html 端「未設定」有安全預設(foundingFrom() 一律回傳 false,沒人是創始
  // 會員)——但那個安全預設是給網站用的(網站部署不經過這支腳本,沒有等效閘門);App 一旦
  // 送審就無法即時改,所以這裡是唯一會把「忘了填」或「填了過去式舊值」擋成 build 失敗的地方,
  // 不讓需要人為決定的值靠「安全預設」矇混過關溜上線。
  const revenuecatSource = await readFile(join(output, 'revenuecat-config.js'), 'utf8');
  const foundingLaunchAtMatch = revenuecatSource.match(/foundingLaunchAt\s*:\s*(null|false|'([^']*)'|"([^"]*)")/);
  assert(foundingLaunchAtMatch,
    'revenuecat-config.js 找不到 foundingLaunchAt 欄位——請在該檔 window.RAIL_REVENUECAT_CONFIG 補上 '
    + "foundingLaunchAt(ISO8601 時刻字串,建議台北時區午夜整點,例如 '2026-09-01T00:00:00+08:00';"
    + '這一版不辦創始期就填 false)');
  // false ＝「明確裁示這一版不辦創始期」(2026-08-09)。刻意與 null 分開:null 是「還沒決定」,
  // 兩者若共用同一個值,這道閘門就再也分不出「決定不辦」與「忘了決定」——而它存在的唯一理由
  // 正是後者。false 直接放行,不必也不該再比對日期(沒有窗,自然沒有「早於 build 日」可言);
  // index.html 的 FOUNDING_LAUNCH_MS 對它解析出 NaN,foundingFrom() 一律回 false ⇒ 沒人是創始會員。
  if (foundingLaunchAtMatch[1] === 'false') {
    console.log('  · foundingLaunchAt=false：本版不辦創始期（明確裁示,非「忘了填」）');
  } else {
    const foundingLaunchAtRaw = foundingLaunchAtMatch[1] === 'null'
      ? null
      : (foundingLaunchAtMatch[2] !== undefined ? foundingLaunchAtMatch[2] : foundingLaunchAtMatch[3]);
    assert(foundingLaunchAtRaw !== null && foundingLaunchAtRaw !== '',
      `revenuecat-config.js 的 foundingLaunchAt 尚未設定(目前是${foundingLaunchAtRaw === null ? ' null' : '空字串'})——`
      + '這是發版流程要在按下發版當下才決定的值,請把實際上線日期填進 revenuecat-config.js 的 '
      + 'window.RAIL_REVENUECAT_CONFIG.foundingLaunchAt 後重新建置');
    const foundingLaunchAtMs = Date.parse(foundingLaunchAtRaw);
    assert(Number.isFinite(foundingLaunchAtMs),
      `revenuecat-config.js 的 foundingLaunchAt 不是可解析的日期(目前值：${foundingLaunchAtRaw})——`
      + '請改成 ISO8601 時刻字串並修正 revenuecat-config.js 的 window.RAIL_REVENUECAT_CONFIG.foundingLaunchAt');
    // 用台北時區的「今天 00:00」當比較基準(不比對時分秒),避免同一個日曆日內因為 build 執行的
    // 時刻不同而誤判。
    const buildDayTaipei = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
    const buildDayStartMs = Date.parse(`${buildDayTaipei}T00:00:00+08:00`);
    // 🔴 2026-08-11 改判準。原本這裡斷言「錨點不得早於 build 當天」——那是在「先訂上線日、
    // 再出 build」的世界寫的。8/10 12:00 窗一開跑,之後每一顆 build 的日期都必然晚於錨點,
    // 原判準會把整個窗期內的出貨全部擋死(1.4.2(43) 就是第一顆撞上的),而那些 build 完全合法。
    // 它真正要防的從來不是「錨點在過去」,而是「一個沒人在看的過期日期溜上線」——那件事的特徵
    // 是**窗已經關了、程式碼卻還宣稱在辦創始期**。故改成：build 當天必須落在窗內。
    // 窗長不手打,從 index.html 的 FOUNDING_UNTIL_MS 讀回來(判準的數字要跟受測物同源,心得 35);
    // 讀不到就 FAIL,不准退回猜一個預設值——窗長改寫法時這道閘門必須跟著被迫更新。
    const windowDaysMatch = html.match(/FOUNDING_LAUNCH_MS\s*\+\s*(\d+)\s*\*\s*86400000/);
    assert(windowDaysMatch,
      'index.html 找不到創始期窗長的定義(FOUNDING_LAUNCH_MS + N * 86400000)——窗長改寫法時,'
      + '這道閘門要跟著改;它刻意不設預設值,免得判準與程式碼各說各話');
    const windowDays = Number(windowDaysMatch[1]);
    const foundingUntilMs = foundingLaunchAtMs + windowDays * 86400000;
    assert(buildDayStartMs < foundingUntilMs,
      `revenuecat-config.js 的 foundingLaunchAt(${foundingLaunchAtRaw})起算 ${windowDays} 天的創始期視窗,`
      + `在本次 build 的日期(${buildDayTaipei})之前就已經結束——程式碼還宣稱在辦創始期,但窗早就關了。`
      + '請更新 window.RAIL_REVENUECAT_CONFIG.foundingLaunchAt;若這一版不打算辦創始期,把它改成 false');
    const daysLeft = Math.ceil((foundingUntilMs - buildDayStartMs) / 86400000);
    console.log(`  · foundingLaunchAt=${foundingLaunchAtRaw}（窗 ${windowDays} 天，本次 build 當天起還剩 ${daysLeft} 天）`);
  }

  const musicEnabled = html.includes('window.RAIL_MUSIC_AVAILABLE=true');
  const basemapsEnabled = html.includes('window.RAIL_ONLINE_BASEMAPS_AVAILABLE=true');

  if (expectLicensedMusic !== undefined) {
    assert(musicEnabled === expectLicensedMusic, '音樂功能旗標與本次 build 模式不一致');
  }
  if (expectLicensedBasemaps !== undefined) {
    assert(basemapsEnabled === expectLicensedBasemaps, '線上底圖旗標與本次 build 模式不一致');
  }

  // 版本號對**所有** build 模式都必須注入(不是只有授權底圖 build)——App 內的更新提示與評分
  // 全靠它判斷「手上這顆是哪一版」。刻意寫在模式分支之外:放進安全 build 的條件裡就漏掉另一半。
  const appVerMatch = /window\.RAIL_APP_VERSION="([^"]+)"/.exec(html);
  assert(appVerMatch, '所有 build 都必須注入 window.RAIL_APP_VERSION（更新提示與評分靠它判版本）');
  assert(/^\d+(\.\d+)*$/.test(appVerMatch[1]),
    `RAIL_APP_VERSION 格式無法解析：${appVerMatch[1]}——版本比較會直接放棄,提示永遠不出現`);

  if (expectPlusSandboxBuild !== null) assertPlusSandboxTestBuild(html, expectPlusSandboxBuild);
  else assertPlusSandboxOff(html);

  await assertLicensedBuildAllowed({
    includeLicensedMusic: musicEnabled,
    includeLicensedBasemaps: basemapsEnabled
  });

  const required = [
    'index.html', 'account-deletion.html', 'app-support.html',
    'privacy.html', 'terms.html',
    'firebase-config.js', 'revenuecat-config.js', 'native-bridge.js',
    'third-party-notices.txt',
    'data/taiwan_land.json', 'vendor/leaflet/leaflet.css',
    'vendor/leaflet/leaflet.js', 'vendor/fflate.js', 'vendor/firebase.mjs'
  ];
  for (const file of required) assert(relativeFiles.includes(file), `缺少必要檔案：${file}`);

  // 首頁相對連結完整性：頁面內每個指向本機 .html／.txt 的連結都要有對應檔案,
  // 否則像 privacy.html／terms.html 那樣在 Capacitor 本機來源回 404（QA 2026-07-21）。
  const relativeSet = new Set(relativeFiles);
  const linkTargets = new Set();
  for (const [, value] of html.matchAll(/href="([^"#]+\.(?:html|txt))"/g)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) continue; // 略過 http(s):／mailto: 等外部連結
    linkTargets.add(value.replace(/^\.?\//, ''));
  }
  for (const target of linkTargets) {
    assert(relativeSet.has(target), `首頁連結指向未打包檔案（會 404）：${target}`);
  }

  const forbiddenNames = [
    /(^|\/)AGENTS\.md$/i,
    /(^|\/)TODO\.md$/i,
    /(^|\/)火車頭(\/|$)/,
    /(^|\/)\.env(?:\.|$)/i,
    /(^|\/)授權查證[^/]*$/,
    /(^|\/)安全審查[^/]*$/,
    /(^|\/)_專案資訊\.html$/,
    /(^|\/)hand off(\/|$)/i,
    /\.map$/i
  ];
  for (const file of relativeFiles) {
    assert(!forbiddenNames.some(pattern => pattern.test(file)), `含內部或禁止發行檔案：${file}`);
  }

  assert(html.includes('vendor/leaflet/leaflet.css') && html.includes('vendor/leaflet/leaflet.js'),
    'App 必須使用內建 Leaflet');
  assert(!html.includes('cdnjs.cloudflare.com/ajax/libs/leaflet'), 'App 仍依賴遠端 Leaflet CDN');
  assert(!/ko-fi|PayPal|111010691056|web-only-donation-log|贊助方式更新/i.test(html),
    'App 仍含網站外部贊助內容');
  assert(!html.includes('class="foot-box foot-donate"') && !html.includes('id="donateCopy"'),
    'App 仍含外部贊助操作元件');
  assert(!/cartocdn\.com|arcgisonline\.com/i.test(html),
    'App 不可含 CARTO／Esri legacy 圖磚網址');
  assert(/href="third-party-notices\.txt"[^>]*min-height:44px/.test(html),
    'App 頁尾缺少 44px 觸控高度的第三方軟體授權入口');
  const notices = await readFile(join(output, 'third-party-notices.txt'), 'utf8');
  // 'Noto Emoji'：唯一一條不是 npm 依賴的授權（換圖批次內嵌的字型子集）。列進來是因為
  // third-party-notices.txt 是每次 build 重新生成的——條目從 prepare-web 的陣列裡消失時，
  // 產物看起來一樣正常，沒有人會發現我們在沒有附授權的情況下散布一份 OFL 字型。
  for (const name of ['Capacitor', 'Firebase', 'RevenueCat', 'Leaflet', 'fflate', 'Noto Emoji']) {
    assert(notices.includes(name), `第三方軟體授權聲明缺少 ${name}`);
  }

  const musicFiles = relativeFiles.filter(file => file.startsWith('suno musics/'));
  if (musicEnabled) assert(musicFiles.filter(file => /\.mp3$/i.test(file)).length === 29,
    '含音樂 build 必須恰好帶入 29 首已核對曲目');
  else {
    assert(musicFiles.length === 0, '安全 build 不可含 suno musics/');
    assert(html.includes('window.RAIL_MUSIC_AVAILABLE=false'), '安全 build 必須明確關閉音樂');
  }

  if (basemapsEnabled) {
    // 授權底圖走「注入 window.RAIL_APP_CONFIG＋index.html 讀設定」機制(2026-07-22 起),
    // 驗證對象=(1)注入的設定內容 (2)index.html 端的消費機制還活著。不再比對被改寫的程式碼字串。
    assert(html.includes('window.RAIL_APP_CONFIG='), 'App 缺少 RAIL_APP_CONFIG 設定注入');
    assert(html.includes('APP_CFG.tiles'), 'index.html 的 APP_CFG.tiles 圖磚設定機制消失——注入的授權底圖不會被使用');
    assert(/tiles\.stadiamaps\.com\/tiles\/alidade_smooth\/\{z\}\/\{x\}\/\{y\}\.png\?api_key=[^'"\s]+/.test(html),
      '亮色底圖不是含 api_key 的 Stadia alidade_smooth');
    assert(/tiles\.stadiamaps\.com\/tiles\/alidade_smooth_dark\/\{z\}\/\{x\}\/\{y\}\.png\?api_key=[^'"\s]+/.test(html),
      '暗色底圖不是含 api_key 的 Stadia alidade_smooth_dark');
    const satTokenMatch = html.match(/ibasemaps-api\.arcgis\.com\/arcgis\/rest\/services\/World_Imagery\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}\?token=([^'"\s]+)/);
    assert(satTokenMatch, '衛星底圖必須是含 token 的授權 Esri ibasemaps');
    // 2026-08-02:衛星本體維持免費(satLine 那條顧),但高解析(Retina)是 Plus。
    // 這條反過來要求資格函式存在——移除它等於把付費層靜默送掉。
    assert(/function satRetinaAllowed\s*\(/.test(html),
      '衛星高解析的資格判定 satRetinaAllowed() 消失——Retina 會變成全體免費');
    assert(/const wantLQ = [^;]*satRetinaAllowed\(\)/.test(html),
      'setBasemap 的選層條件沒有消費 satRetinaAllowed()——資格判定形同虛設');
    // 原本是逐字比對整行 `const sat = online && state.basemap === 'sat';`，但那樣任何無關的條件
    // （2026-07-26 加的 token 就緒判斷）也會誤擋。改成檢查意圖：判斷式裡不得出現付費條件。
    const satLine = (html.match(/const sat = online && state\.basemap === 'sat'[^;\n]*;/) || [])[0];
    assert(satLine, 'index.html 找不到衛星顯示判斷（const sat = …）——「衛星免費開放」這條檢查已失效');
    assert(!/plus|entitle|paid|subscri|premium/i.test(satLine),
      `App 第一版衛星顯示必須免費開放（不綁 Plus），但判斷式含付費條件：${satLine}`);
    assert(html.includes('  prefetchFollowAhead(dt);'),
      'Stadia App 必須保留既有高速跟車預抓；手機省電模式會自行停用，避免 iPad／關省電模式高速跟車露白');
    // 跟車 zoom 上限:設定要載明 16,且 index.html 的消費機制(FOLLOW_ZOOM_CAP/followEntryZoom)未被移除
    assert(html.includes('"followZoomCap":16'), 'RAIL_APP_CONFIG 未載明 followZoomCap:16(計量底圖跟車上限)');
    // 衛星 Retina 止血開關:只驗機制還活著(值可為 true/false,由 Esri 額度狀況決定)
    assert(/"satRetina":(true|false)/.test(html), 'RAIL_APP_CONFIG 未載明 satRetina(衛星高解析止血開關)');
    assert(html.includes('APP_CFG.satRetina'), 'index.html 的 SAT_RETINA 消費機制消失——App 端衛星解析度開關失效');
    assert(html.includes('Math.min(18, FOLLOW_ZOOM_CAP)'),
      'DIRECTOR_FOLLOW_Z 未由 FOLLOW_ZOOM_CAP 收斂——App 導播跟車 z16 上限失效');
    assert((html.match(/followEntryZoom\(\), \{ animate: false \}/g) || []).length >= 3,
      '跟車進場 followEntryZoom 呼叫點少於 3 處——台鐵／高鐵／捷運跟車 zoom 上限未完整覆蓋');
    assert(html.includes(JSON.stringify(STADIA_ATTRIBUTION)),
      'Stadia 圖磚署名不是官方要求的三組連結逐字內容');
    assert(html.includes('Stadia Maps（© Stadia Maps © OpenMapTiles © OpenStreetMap）、Esri World Imagery（衛星影像）與內政部「直轄市、縣市界線」（離線海陸輪廓，政府資料開放授權條款第1版）'),
      'App 頁尾底圖來源未包含 Esri 衛星或離線輪廓的內政部署名');
    // 放在本區塊最後:上面全是免費的本機檢查,先讓它們失敗;這一項要連外,擺最後才不會為了
    // 一個過期產物白等網路。驗的是**實際打包進這個 build 的那把金鑰**(不是 .env 當下的值——
    // 兩者可能已經分岔),所以送審包裡的金鑰死活,這裡是最後一道、也是唯一一道會發現的閘門。
    if (process.env.RAIL_SKIP_KEY_LIVENESS === '1') {
      console.warn('⚠️  已跳過 Esri 金鑰活體檢查（RAIL_SKIP_KEY_LIVENESS=1）——這個 build 沒有任何人確認過金鑰還活著。');
    } else {
      await assertEsriKeyAlive(decodeURIComponent(satTokenMatch[1]));
    }
  } else {
    assert(html.includes('window.RAIL_ONLINE_BASEMAPS_AVAILABLE=false'), '安全 build 必須明確關閉線上底圖');
    assert(!html.includes('tiles.stadiamaps.com'), '安全 build 不可含 Stadia 圖磚網址或 API key');
    assert(!html.includes('window.RAIL_APP_CONFIG='), '安全 build 不應注入 RAIL_APP_CONFIG(授權圖磚設定)');
  }

  // Stored XSS 迴歸（QA 2026-07-21）：「我的最愛」的列車／站名是使用者資料,可能來自被污染的
  // 匯入或 localStorage。渲染必須以 escHtml 逸出後才進 innerHTML,否則可在 Capacitor WebView 執行 script。
  assert(html.includes('escHtml(f.train)') && html.includes('escHtml(f.label)'),
    '「我的最愛」未以 escHtml 逸出使用者資料——stored XSS 迴歸,不可發行');
  assert(!/<b>\$\{f\.train\}<\/b>/.test(html),
    '「我的最愛」仍把未逸出的 ${f.train} 直接插入 innerHTML——stored XSS 迴歸,不可發行');

  // Stored XSS：showToast 的參數直接進 innerHTML（announceCollections 等呼叫端刻意傳 <b>），
  // 所以「逸出」的責任在呼叫端。
  //
  // 這裡刻意**不是**逐一比對已知的幾個呼叫點。2026-07-26 上架版的 XSS 之所以能溜到 App Store，
  // 就是因為發行閘門只驗打包正確性、沒有任何安全斷言；而事後補的三條逐字規則同樣只認得那三個
  // 點——新寫的第四個動態 toast 一樣會直接過關。改成結構性規則：**掃描每一個 showToast 呼叫，
  // 凡是有東西被插進字串的，都必須在下面的審查帳本裡**。新增動態 toast ⇒ 閘門紅燈 ⇒ 有人得
  // 真的看過它插的是什麼、決定要不要 escHtml，才能登記放行。預設是擋，不是放。
  assertToastSinksReviewed(html);

  // 版本一致性（QA 2026-07-21）：確保發行包確實含最新網站修正,而不是舊產物綠燈通過。
  const extractBuild = source => source.match(/const BUILD\s*=\s*'([^']+)'/)?.[1] ?? null;
  const wwwBuild = extractBuild(html);
  assert(wwwBuild, 'app/www/index.html 找不到 BUILD 版本戳記');
  const repoIndex = await readFile(join(repoRoot, 'index.html'), 'utf8');
  const repoBuild = extractBuild(repoIndex);
  assert(repoBuild, '根目錄 index.html 找不到 BUILD 版本戳記');

  // 金鑰不得寫死進公開 repo（稽核 2026-07-26）：2026-07-25 的 commit 5aab5c4 把網站用的 Esri
  // token 直接寫進 index.html，於是隨 public repo 推上 GitHub、也印在 railisland.tw 的網頁原始碼裡。
  // 實測那把 token 無任何 referrer 限制（偽造來源照樣回 200 真圖磚），而 PAYG 是開著的＝被盜用時
  // 帳單沒有天花板。網站金鑰一律改由 Worker 的 /api/basemap-token 下發；App 金鑰由 prepare-web
  // 注入 www（build 產物、不進版控），所以這裡只檢查 repo 根的**原始檔**，不檢查 www。
  assert(!/ibasemaps-api\.arcgis\.com[^'"`\s]*[?&]token=[A-Za-z0-9]/.test(repoIndex),
    'repo 根 index.html 寫死了 Esri token——這個 repo 是公開的,金鑰必須改由 Worker /api/basemap-token 下發');
  assert(!/tiles\.stadiamaps\.com[^'"`\s]*[?&]api_key=[A-Za-z0-9]/.test(repoIndex),
    'repo 根 index.html 寫死了 Stadia api_key——這個 repo 是公開的,App 金鑰只能由 prepare-web 注入 www');
  assert(wwwBuild === repoBuild,
    `App 產物版本落後：app/www 為 ${wwwBuild},但根目錄網站已是 ${repoBuild};請執行 npm run sync 重建並同步後再送審`);

  // 原生內嵌資產一致性：iOS／Android 打包的 public/ 必須與 app/www 同版。
  // build 結尾呼叫時 cap sync 尚未跑,故 skipNativeSyncCheck=true;獨立 npm run verify 才做此比對。
  if (!skipNativeSyncCheck) {
    const nativeIndexes = [
      ['iOS', join(appRoot, 'ios/App/App/public/index.html')]
      // Android 生成後補上 ['Android', join(appRoot, 'android/app/src/main/assets/public/index.html')]
    ];
    for (const [label, nativeIndex] of nativeIndexes) {
      let nativeHtml;
      try { nativeHtml = await readFile(nativeIndex, 'utf8'); }
      catch {
        // 原生專案尚未生成則略過。但在 CI（cap sync 之後）這個「略過」等於整條檢查從沒跑過——
        // 乾淨 clone 沒有 App/public,發行閘門會在完全沒比對內嵌資產的情況下亮綠燈。
        // 故 ci_post_clone 的同步後複驗帶 RAIL_REQUIRE_NATIVE=1,把略過改成失敗。
        assert(!process.env.RAIL_REQUIRE_NATIVE,
          `${label} 內嵌資產不存在（${relative(repoRoot, nativeIndex)}）——cap sync 未產生打包用網頁,不可發行`);
        continue;
      }
      const nativeBuild = extractBuild(nativeHtml);
      assert(nativeBuild === wwwBuild,
        `${label} 內嵌資產版本不一致：${relative(repoRoot, nativeIndex)} 為 ${nativeBuild},app/www 為 ${wwwBuild};請執行 npm run sync（build + cap sync）`);
    }
  }

  // 🔴 自製原生 plugin 必須在 capacitorDidLoad() 註冊,否則 JS 端 registerPlugin('X') 的呼叫
  // 全部靜默拒絕——功能整條死掉,而 build 照樣 SUCCEEDED、沒有任何紅字。這個坑已經踩過兩次
  // (build 38 音樂全滅＝RailAudioPlugin 漏註冊;1.4.2 的評分＝RailReviewPlugin 漏註冊),
  // 而 RailPlacesPlugin.swift 裡就寫著警告註解仍然再犯 ⇒ 靠人記得是不夠的,改成機械判準。
  // 判的是「宣告出來的每一顆都被註冊」(是什麼/怎麼配對),不是「有幾顆」——新增 plugin 不必改這裡。
  {
    const iosSrcDir = join(appRoot, 'ios/App/App');
    let swiftFiles = [];
    try { swiftFiles = (await readdir(iosSrcDir)).filter(name => name.endsWith('.swift')); }
    catch { swiftFiles = []; }
    if (!swiftFiles.length) {
      assert(!process.env.RAIL_REQUIRE_NATIVE,
        `iOS 原生原始碼不存在（${relative(repoRoot, iosSrcDir)}）——無法檢查自製 plugin 註冊,不可發行`);
    } else {
      const swiftSource = (await Promise.all(
        swiftFiles.map(name => readFile(join(iosSrcDir, name), 'utf8'))
      )).join('\n');
      // 只要求「繼承串裡有 CAPBridgedPlugin」,不綁協定順序也不綁還列了哪些協定——
      // 綁死 `: CAPPlugin, CAPBridgedPlugin` 的話,新 plugin 只要把兩個協定寫反就整顆隱形,
      // 而其餘三顆仍在 ⇒ 分母守衛不會響、漏註冊照樣溜過去(突變測試就是這樣抓到的)。
      // \b 是必要的:少了它,CAPBridgedPluginX 之類的改名也會被當成命中。
      const declared = [...swiftSource.matchAll(/class\s+(\w+)\s*:[^{\n]*\bCAPBridgedPlugin\b/g)]
        .map(match => match[1]);
      // 分母守衛：宣告一顆都抓不到＝正則跟不上寫法改動,此時 missing 必為空、下面那條會假綠。
      assert(declared.length > 0,
        `${relative(repoRoot, iosSrcDir)} 裡找不到任何 CAPBridgedPlugin 宣告——`
        + '要嘛自製 plugin 真的一顆都不剩了,要嘛這道閘門的比對寫法已經跟不上原始碼,請先確認是哪一種');
      const registered = new Set(
        [...swiftSource.matchAll(/registerPluginInstance\(\s*(\w+)\s*\(/g)].map(match => match[1])
      );
      const missing = declared.filter(name => !registered.has(name));
      assert(missing.length === 0,
        `自製原生 plugin 宣告了卻沒有註冊：${missing.join('、')}——請在 RailBridgeViewController`
        + '.capacitorDidLoad() 補 bridge?.registerPluginInstance(該類別());少了它,JS 端對應的功能會'
        + '整條靜默失效,而 build 仍然會 SUCCEEDED(build 38 音樂全滅就是這個)');
      console.log(`  · 自製原生 plugin ${declared.length} 顆全部已註冊：${declared.join('、')}`);
    }
  }

  // 半套登入 gate（STORE_SUBMISSION_CHECKLIST 步驟 4）：帳號開了但 Sign in with Apple 沒開
  // ＝App Store Guideline 4.8 退件主因。檢查對象是重建後的 www/，舊副本綠燈不算數。
  // 🔴 判準不綁 ACCOUNT_ENABLED(2026-08-02 判準過期修正):2026-07-21 起帳號實際入口是
  // plusOpen→accountEnsureInit,ACCOUNT_ENABLED 只決定帳號鈕要不要 eager 顯示在主畫面——
  // ACCOUNT_ENABLED=false 時 Google 登入鈕仍可能經由購買流程或 ?account=delete 深連結被畫出來
  // (index.html 的 accountConfigured() 本身就與 ACCOUNT_ENABLED 無關)。舊判準綁 ACCOUNT_ENABLED
  // 的後果不是誤紅,是永遠不跑(ACCOUNT_ENABLED 現在恆 false)——半套登入的防線形同不存在。
  // 改綁 firebase-config.js 是否配置齊全(accountConfigured() 的靜態等價條件),才是登入鈕
  // 實際會不會被畫出來的真正判準。
  const firebaseConfig = await readFile(join(output, 'firebase-config.js'), 'utf8');
  const firebaseConfigured = /apiKey\s*:/.test(firebaseConfig) && /authDomain\s*:/.test(firebaseConfig) && /projectId\s*:/.test(firebaseConfig);
  if (firebaseConfigured) {
    assert(/window\.RAIL_APPLE_LOGIN\s*=\s*true/.test(firebaseConfig),
      '登入鈕可能被畫出(Firebase 已配置)但 RAIL_APPLE_LOGIN 不是 true——半套登入（有 Google 無 Apple）會被 App Store 4.8 退件');
  }

  const textExtensions = new Set(['.html', '.js', '.mjs', '.json', '.css', '.webmanifest', '.txt', '.md']);
  const suspiciousSecretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /REVENUECAT_V2_SECRET_KEY\s*[:=]\s*["'][^"']+/,
    /TDX_CLIENT_SECRET\s*[:=]\s*["'][^"']+/,
    /FIREBASE_WEB_API_KEY\s*[:=]\s*["'][^"']+/
  ];
  for (const file of files) {
    const extension = basename(file).includes('.') ? `.${basename(file).split('.').pop()}` : '';
    if (!textExtensions.has(extension)) continue;
    const content = await readFile(file, 'utf8');
    assert(!suspiciousSecretPatterns.some(pattern => pattern.test(content)),
      `疑似含伺服器密鑰：${relative(output, file)}`);
  }

  const size = (await Promise.all(files.map(file => lstat(file)))).reduce((sum, info) => sum + info.size, 0);
  console.log(`App 發行檢查通過：${relative(repoRoot, output)}，${wwwBuild}，${files.length} 個檔案，${(size / 1024 / 1024).toFixed(1)} MB，音樂 ${musicEnabled ? '開啟' : '關閉'}，線上底圖 ${basemapsEnabled ? '開啟' : '關閉'}`);
  return { files: files.length, bytes: size, musicEnabled, basemapsEnabled };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verifyRelease();
}
