# 軌島 Plus 開張批次 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 把 Plus 訂閱從「宣告五項、實際只有一項」補成「宣告六項、每項都真的能用」，與北捷逐車同一版上架。

**Architecture：** 前端 `state.plus.active` 是唯一的資格判定來源，由 `plusRefresh()` 寫入——App 走 RevenueCat `customerInfo`（原生 adapter），**網站走 Worker 的 `/api/plus-status`**（`revenuecat-config.js` 只有 `iosApiKey`，沒有 Web Billing key，網站永遠 `plusConfigured() === false`，讀不到 RevenueCat）。`plusRefresh()` 在 `onAuthStateChanged` 登入當下就跑一次，不等使用者打開 Plus 面板。需要伺服器強制的走 Worker 的 Firebase ID token ＋ RevenueCat v2 `active_entitlements` 雙重驗證（`/api/delay-history` 已是此模式的參考實作）。純呈現層的加值（衛星高解析、創始徽章、行程分享發起端）採用戶端閘門，不做伺服器強制——使用者 2026-08-02 明確裁示。Live Activity 掛進**既有的** `RailBoardWidget` Extension，不新開 target。

**Tech Stack：** 單檔前端 `index.html`（純 JS，無框架、無模組）、Cloudflare Worker `worker.js`、Capacitor iOS 殼、SwiftUI WidgetKit ＋ ActivityKit、RevenueCat、Firebase Auth、Playwright（驗收）。

---

## Global Constraints

專案級規則，**每一個任務的驗收條件都隱含包含本節**：

- **工作樹**：本批次一律在專屬 worktree `/Users/xuxiang/Code/軌島-Plus開張`（分支 `feat/plus-launch`，基準 `origin/main`）進行。**禁止在主樹或 `軌島-北捷逐車` 動手**——同期有其他 session 在寫同一個 repo。
- **禁止一切 git 寫操作跨樹**：不得 `git stash`／`checkout`／`reset`，其他工作樹有未 commit 的變更。
- **回覆與 commit message 一律繁體中文。**
- **準確度不收費**：列車位置、誤點資訊、資料新鮮度、系統覆蓋永遠免費。任何任務都不得把這四類放進 Plus 閘門。
- **窄承諾**：對外文案只承諾「railisland.tw 網站免費，會繼續免費」。**禁用**「永遠」「一個都不會拿走」「更清晰」等絕對句。衛星那項一律寫「高解析度（支援 Retina 螢幕）」，不寫「更清晰」——DPR=1 螢幕看不出差別。
- **更新紀錄鐵則**：每個使用者看得到的變更都要在 `#msAbout` 的更新紀錄加一條**用戶語氣**的 `li`。新條目進「最近更新」區（`.foot-recent`），舊條目搬進巢狀主題組——**搬家不複製**。巢狀 `details` 不可掛 `.foot-box` class。
- **手機必驗**：任何 UI 變更的驗收條件必含 360／375／414／768 四個寬度的控件相交掃描＋真觸控 `elementFromPoint` 命中，且至少一路 WebKit。
- **驗收腳本自檢**：任何 `verify_*.mjs` 第一道 gate 必須印出「驗的是哪個目錄／哪個 build」＋關鍵檔 md5，並斷言與當前工作區逐 byte 相同。預設值指向當前工作區，不得指向暫存副本。
- **本機 wrangler 陷阱**：`wrangler dev` 只讀 `.dev.vars` 不讀 `.env`；必須 `--local-protocol https`；突變測試前必 `find .wrangler -delete`。`npx wrangler` 在這台是壞的，一律 `arch -arm64 node ./node_modules/wrangler/bin/wrangler.js <cmd>`。
- **公開 repo**：本 repo 是 PUBLIC。任何金鑰、secret、內部成本或談判資訊不得寫進 `index.html`／`worker.js`／`docs/`／測試檔。
- **不動北捷逐車的檔案**：`renderFreqBoard`／`trtcBoardRows`／`trainPos` 及其相關程式碼由 `feat/trtc-live` 負責，本批次不碰。

### 開賣清單（本批次結束時 `plusRender` 必須逐項對得上）

| # | 項目 | 由哪個 Task 交付 | 強制層級 |
|---|---|---|---|
| 1 | 每班車的誤點履歷與統計圖表 | 已完成（Task 7 補 happy-path 實測） | 伺服器強制 |
| 2 | 收藏跨裝置雲端同步 | Task 1 | 用戶端閘門（2026-08-02 裁示，與衛星同一套榮譽制；Firestore rules 不動） |
| 3 | 行程分享 | Task 2 | 用戶端閘門 |
| 4 | **App** 衛星高解析度（支援 Retina 螢幕） | Task 3 | 用戶端閘門（裁示）／**App 限定** |
| 5 | 創始會員徽章 | Task 4 | 用戶端閘門 |
| 6 | 跟車即時動態（鎖定畫面／動態島） | Task 5 | 用戶端閘門 |

---

## 檔案結構

| 檔案 | 責任 | 動它的 Task |
|---|---|---|
| `index.html` | 單檔前端全部。Plus 閘門、清單文案、護照徽章、行程分享入口、底圖切換 | 1,2,3,4,5,6,7 |
| `firebase-config.js`（repo 根） | 登入供應商開關（來源檔；App 副本由 `npm run sync` 產生） | 1 |
| `app/scripts/verify-release.mjs` | 發行前 CI 斷言 | 1,3 |
| `app/scripts/prepare-web.mjs` | App build 時注入 `RAIL_APP_CONFIG` | 3 |
| `worker.js` | `/api/basemap-token` rate limit | 3 |
| `app/ios/App/RailBoardWidget/RailFollowActivity.swift` | **新建**：Live Activity 的 SwiftUI 版面與 ActivityAttributes | 5 |
| `app/ios/App/RailBoardWidget/RailBoardWidgetBundle.swift` | 把 Live Activity 加進 WidgetBundle | 5 |
| `app/ios/App/App/RailLiveActivityPlugin.swift` | **新建**：JS↔ActivityKit 橋接 | 5 |
| `app/ios/App/App/RailPlacesPlugin.swift` | 註冊新 plugin 實例（`capacitorDidLoad`） | 5 |
| `app/ios/App/App/Info.plist` | `NSSupportsLiveActivities` | 5 |
| `app/src/native-bridge.mjs` | JS 側 `registerPlugin` | 5 |
| `scripts/verify_plus_subscription.mjs` | Plus 端到端驗收（既有，要修掉假登入注入） | 1,7 |
| `scripts/verify_plus_features.mjs` | **新建**：六項清單逐項對得上真功能 | 6 |

---

## Task 0：建立工作樹

**Files:** 無（環境準備）

**Interfaces:**
- Produces：可用的隔離工作樹 `/Users/xuxiang/Code/軌島-Plus開張`，後續所有 Task 都在裡面執行。

- [ ] **Step 1：從 origin/main 開工作樹**

```bash
cd /Users/xuxiang/Code/捷運小動畫
git fetch origin
git worktree add -b feat/plus-launch /Users/xuxiang/Code/軌島-Plus開張 origin/main
```

- [ ] **Step 2：借用 gitignored 的設定檔（symlink，不複製）** ✅ 已完成（2026-08-02 01:06）

```bash
cd /Users/xuxiang/Code/軌島-Plus開張
for f in .env node_modules _專案資訊.html; do
  [ -e "/Users/xuxiang/Code/捷運小動畫/$f" ] && ln -s "/Users/xuxiang/Code/捷運小動畫/$f" "$f"
done
```

實查結果（與原先假設有出入，記在這裡免得下一個人重踩）：
- `.env`／`node_modules`／`_專案資訊.html` → symlink 完成
- **`revenuecat-config.js` 其實是 git 追蹤檔**（不是 gitignored），checkout 就帶進來了，不需要 symlink
- **全機沒有 `.dev.vars`** ⇒ **Task 3 若要本機 `wrangler dev` 驗 rate limit，得自己建一份**。
  注意本機 wrangler 的坑：只讀 `.dev.vars` 不讀 `.env`、必須 `--local-protocol https`、
  突變測試前必 `find .wrangler -delete`、且 `npx wrangler` 在這台是壞的
  （一律 `arch -arm64 node ./node_modules/wrangler/bin/wrangler.js <cmd>`）。

- [ ] **Step 3：確認基準正確**

```bash
cd /Users/xuxiang/Code/軌島-Plus開張
grep -n "^const BUILD" index.html
git log --oneline -1
```

預期：`BUILD` 是 `v0801d` 或更新，`git log` 顯示的 commit 與 `origin/main` 相同。**若 BUILD 顯示 v0727 系列＝開錯基準，砍掉重來。**

---

## Task 1：帳號系統重開（雲端同步）

這是鏈最長的一項（要真機、要沙箱），先做。本 Task 的核心不是翻旗標，是**讓 `state.plus.active` 在該真的時候真、並讓雲端同步只給有資格的人**——Task 2/3/4/5 的用戶端閘門全部踩在這個前提上。

⚠️ 2026-08-02 修訂：初版計畫寫「翻開 `ACCOUNT_ENABLED` 與 `RAIL_APPLE_LOGIN` 兩個旗標」，那是錯的。翻開 `ACCOUNT_ENABLED` 會把帳號鈕放回所有人的主畫面（`setupAccountUi` 是互斥二選一），且**光翻旗標一層閘門都沒有**——`accountSyncNow` 與 `firestore.rules` 都不看資格，任何人登入就能免費同步。詳見 Step 3／Step 6。

**Files:**
- Modify: `index.html`（`onAuthStateChanged` 的 bootstrap、`plusRefresh` 的網站分支、`accountSyncNow` 的資格閘、`accountRender` 的同步鈕、更新紀錄）
- Modify: `firebase-config.js`（**repo 根目錄那份才是來源**；`app/ios/App/App/public/firebase-config.js` 是 `npm run sync` 產生的副本，改它會被蓋掉）
- Modify: `worker.js`（抽出 entitlement helper、新增 `/api/plus-status`）
- Modify: `scripts/verify_plus_subscription.mjs`（新斷言、`SHOT_DIR`、`BASE` 帶 `?plus=1`）
- **不動**：`index.html` 的 `const ACCOUNT_ENABLED`（維持 `false`）、`firestore.rules`（本批次採用戶端閘門）

**Interfaces:**
- Consumes：無（本批次第一個實作任務）
- Produces：
  - `state.plus.active`（boolean）——**登入後即可用**（`onAuthStateChanged` 會 `await plusRefresh()`），不再需要使用者先打開 Plus 面板。後續 Task 2/3/4/5 全部消費它。
  - `GET /api/plus-status`（`Authorization: Bearer <Firebase ID token>`）→ `200 {active:boolean}`｜`401`｜`503`。網站端資格的唯一來源。
  - `state.account.user`（Firebase User 物件）在登入後可用；`accountEnsureInit()` 為冪等延遲初始化。

- [ ] **Step 1：先寫會失敗的測試——證明現在買不了 Plus**

既有的 `scripts/verify_plus_subscription.mjs` 有個結構性缺陷：它注入假登入帳號，繞過了「未登入時 `plusOpen()` 會導去帳號流程」這條路徑。先把這個繞道拿掉，換成真的走一遍。

在 `scripts/verify_plus_subscription.mjs` 加一個新斷言（**不要動既有斷言**）：

```javascript
// 匿名使用者點 Plus 入口 → 必須看得到 Google＋Apple 兩顆登入鈕（不是空白視窗、也不是只有一顆）
// 這條在 RAIL_APPLE_LOGIN=false 時必失敗：accountRender 只畫得出 Google 一顆
async function assertAnonymousCanReachLogin(page) {
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => window.plusGateOpen('test-gate', () => {}));
  // 條件式等待,不用固定秒數:Firebase SDK 是延遲載入,冷載入比暖載入慢很多,
  // 固定 timeout 會讓這條斷言實際在量「載入快不快」而不是「旗標對不對」。
  await page.waitForSelector('[data-login="google"]', { timeout: 15000 }).catch(() => {});
  const loginBtns = await page.locator('[data-login="google"], [data-login="apple"]').count();
  return { name: '匿名使用者可抵達登入鈕', ok: loginBtns >= 2,
           detail: `找到 ${loginBtns} 顆登入鈕（需要 Google＋Apple 兩顆）` };
}
```

⚠️ **`ACCOUNT_ENABLED` 與這條斷言無關**——`plusGateOpen` → `plusOpen` 會自己呼叫 `accountEnsureInit()`（index.html:7130），而 `accountEnsureInit` 對「鈕已被移除→null」有處理（index.html:7001），所以免費層匿名時購買鏈照樣通。會讓這條紅的只有 `RAIL_APPLE_LOGIN`。

- [ ] **Step 2：跑它，確認失敗**

```bash
cd /Users/xuxiang/Code/軌島-Plus開張
node scripts/verify_plus_subscription.mjs 2>&1 | tail -20
```

預期：新斷言 FAIL，`找到 0 顆登入鈕`。

- [ ] **Step 3：只翻 `RAIL_APPLE_LOGIN`，`ACCOUNT_ENABLED` 維持 `false`**

repo 根目錄的 `firebase-config.js`（`index.html:33` 用 `<script src="firebase-config.js">` 載它，`prepare-web.mjs:86` 把它複製進 App bundle）：

```javascript
window.RAIL_APPLE_LOGIN = true;
```

⚠️ **不要改 `app/ios/App/App/public/firebase-config.js`**——那是建置產物，`npm run sync` 會用根目錄那份覆蓋它。改錯地方的症狀是「本機測試過了，App build 出來還是 false」。

🔴 **`ACCOUNT_ENABLED` 必須維持 `false`。** 2026-07-21 使用者拍板甲案：「免費層匿名、只有買 Plus 才登入」。`setupAccountUi()`（index.html:7049-7054）是**互斥二選一**不是疊加——`true` 會選中 eager 分支，把帳號鈕放回所有人的主畫面、對每個訪客載 Firebase，等於把 07-17 那次刻意下架（為了「收費前不再有免費用過同步的新增使用者」）整個倒回去。購買鏈不需要它：`plusOpen` 自己會 `accountEnsureInit()`。

- [ ] **Step 4：補開機資格 bootstrap（Task 2/3/4/5 全部靠這個）**

`state.plus.active` 目前**只有使用者主動打開 Plus 面板時才會被填**——`p.active` 全檔僅三處寫入（index.html:7203／7221／7239），分別在 `plusRefresh`／`plusPurchase`／`plusRestore` 內，開機序列（index.html:14992-14993 的 `setupAccountUi()`／`setupPlusUi()`）一個都沒呼叫。後果：付費者冷啟動後所有用戶端閘門都判他沒資格。

在 `onAuthStateChanged`（index.html:7031-7039）的 `if (user)` 分支，**`accountSyncNow('login')` 之前**插入：

```javascript
        if (user) {
          await plusRefresh(); // 先確認資格再決定要不要同步;plusRefresh 自帶 !plusConfigured() 早退,不會在無購買通道的平台亂初始化 SDK
          await accountSyncNow('login');
```

🔴 **光補這一行還不夠**，因為 `ACCOUNT_ENABLED=false` 時開機序列根本不會呼叫 `accountEnsureInit()`（`setupAccountUi` 走 `btn.remove()` 那條），`onAuthStateChanged` 連註冊都沒註冊——上面那行要等使用者先點過 Plus／帳號入口才會跑。付費者冷啟動、還沒互動之前，`state.plus.active` 仍是 false，Task 2/3/4 的**被動**閘門（衛星在圖層建立時判、創始徽章在護照渲染時判、行程分享鈕的顯示）會集體誤判他沒資格。

所以 `setupAccountUi()`（index.html:7054-7063）要多一個條件：**登入過的人開機就初始化**。判別依據用現成的 `localStorage['trainmap-last-sync-uid']`——它在同步成功時寫入（index.html:6893）、`accountClearLocal()` 時移除（登出與刪帳號都會走到），語意剛好是「這台裝置上有人登入過且還沒登出」。

```javascript
  // 登入過的人(本機還留著 last-sync-uid)開機就初始化,否則付費者冷啟動時所有用戶端閘門都會
  // 誤判他沒資格。從沒登入過的免費層仍然完全匿名:不載 Firebase、不建 state.account。
  let returning = false;
  try { returning = !!localStorage.getItem('trainmap-last-sync-uid'); } catch (e) {}
  if (ACCOUNT_ENABLED || accountIntent === 'delete' || returning) {
    await accountEnsureInit(); return;
  }
```

⚠️ 這**不是**把 `ACCOUNT_ENABLED` 偷偷打開：從沒登入過的訪客走的還是 `btn.remove()` 那條，一個 byte 的 Firebase 都不載。07-21 拍板的「免費層匿名」完整保留。

- [ ] **Step 5：網站端補 `/api/plus-status`**

`plusRefresh()` 卡在 `plusConfigured()`（index.html:7069-7076），而它在網站上要求 `c.webApiKey`——`revenuecat-config.js` 只設了 `iosApiKey`。所以**網站端 `state.plus.active` 恆為 false**，四項 Plus 功能在 railisland.tw 上全部不生效。2026-08-02 使用者裁示：補一支唯讀端點讓網站讀得到 App 買的資格，不設 Web Billing key、不開放網站購買。

`worker.js` 的 delay-history 處理器裡已經有這段驗證（`worker.js:524-545`：Firebase ID token 經 identitytoolkit lookup 換 uid → RevenueCat v2 `active_entitlements`）。把它**原封不動抽成 helper**（不要改判定邏輯，尤其 `items.length > 0` 那條——用 `entitlement_id` 比對會踩 v2 回傳內部不透明 id `entl...` 的靜默鎖死陷阱），delay-history 改呼叫 helper，再加：

```javascript
// GET /api/plus-status  Authorization: Bearer <Firebase ID token>
// → 200 {active:boolean}｜401 無 token｜503 上游或 secret 未設(fail-closed)
// 唯讀,不寫任何東西;no-store,不進共享 edge 快取(每個 uid 的答案不同)
```

回應一律 `Cache-Control: no-store`。secret 未設或上游錯 → 503，**不要回 `{active:false}`**——把「查不到」跟「沒資格」混在一起，會在 RevenueCat 短暫故障時把付費者的功能整批關掉。

`index.html` 端：`plusRefresh()` 在 `!plusConfigured()` 早退之前，先試這支端點——拿 `state.account.user.getIdToken()` 打 `/api/plus-status`，回 `{active:true}` 就寫進 `p.active` 並 `accountRender()`。網站沒有購買通道這件事不變（`plusConfigured()` 仍是 false，`plusOpen` 照舊停在「請在 App 內訂閱」畫面）。

- [ ] **Step 6：雲端同步接上資格閘門**

`accountSyncNow(reason)`（index.html:6862-6864）現在只檢查 `a.user／a.db／a.syncing`，任何人登入就能同步。守門條件改成：

```javascript
async function accountSyncNow(reason) {
  const a = state.account;
  if (!a || !a.user || !a.db || a.syncing) return false;
  // 雲端同步是 Plus 功能(2026-08-02 裁示:用戶端閘門)。logout 是刻意的例外——
  // 登出會清掉本機資料(accountClearLocal),不讓最後一次回寫完成就等於吃掉使用者的東西。
  // 用 startsWith 不用 !==:rules 擋下時 catch 會遞迴成 'logout-legacy' 重試(index.html:6904),
  // 寫死 !== 'logout' 會讓重試被閘門擋掉、而 accountSignOut 照樣清本機 ⇒ 真的掉資料。
  if (!reason.startsWith('logout') && !(state.plus && state.plus.active)) return false;
```

驗收要涵蓋 `'logout-legacy'`：斷言未訂閱使用者的 `accountSyncNow('logout-legacy')` **不被擋下**（回傳不是「因閘門而 false」）。只驗 `'logout'` 通過等於沒驗到這個洞。

一個入口擋住全部六個呼叫點（`login`／`manual`／`local-change`／`foreground`／`logout`／`-legacy`）。

`accountRender()`（index.html:6842-6844）的「立即同步」鈕與「跨裝置同步」狀態列，未訂閱時改成停用態＋一句說明（文案照 Global Constraints 的窄承諾，**不要**寫「永遠」「一個都不會拿走」）。

- [ ] **Step 7：`SHOT_DIR` 不要寫死 session 路徑**

`scripts/verify_plus_subscription.mjs:30` 目前是硬編的 session scratchpad 絕對路徑，每個 session 都要手改一次（本次就已經改過一次）。改成可推導：

```javascript
const SHOT_DIR = process.env.SHOT_DIR || path.join(os.tmpdir(), 'rail-plus-shots');
```

目錄不存在就 `fs.mkdirSync(SHOT_DIR, { recursive: true })`。

- [ ] **Step 4：跑測試，確認通過**

```bash
cd /Users/xuxiang/Code/軌島-Plus開張
node scripts/verify_plus_subscription.mjs 2>&1 | tail -20
```

預期：新斷言 PASS（2 顆登入鈕），且**既有斷言全數維持通過**。任何既有斷言由綠轉紅＝回歸，停手查明。

- [ ] **Step 8：跑測試，確認通過**

```bash
cd /Users/xuxiang/Code/軌島-Plus開張
node scripts/verify_plus_subscription.mjs 2>&1 | tail -20
```

預期：新斷言 PASS（2 顆登入鈕），且**既有斷言全數維持通過**。任何既有斷言由綠轉紅＝回歸，停手查明。

- [ ] **Step 9：閘門的突變測試（沒有牙的判準等於沒驗）**

把 Step 6 的資格條件暫時拿掉（`if (reason !== 'logout' && !(state.plus && state.plus.active)) return false;` 整行註解掉），加一條驗這件事的斷言並確認它**轉紅**；還原後確認轉綠。斷言的做法：注入一個假登入使用者但 `state.plus.active = false`，觸發 `accountSyncNow('manual')`，斷言它回 `false` 且沒有發出任何 Firestore 寫入。

沒轉紅＝判準沒有牙，回去修判準（心得 35）。

- [ ] **Step 10：確認 verify-release 的半套登入 gate**

```bash
cd /Users/xuxiang/Code/軌島-Plus開張/app
npm run sync 2>&1 | tail -5
RAIL_ALLOW_SAFE_BUILD=1 node scripts/verify-release.mjs 2>&1 | tail -20
```

⚠️ `verify-release.mjs:394-395` 那條的條件是「帳號功能已開啟時 `RAIL_APPLE_LOGIN` 必須是 true」。本 Task 讓 `ACCOUNT_ENABLED` 維持 `false` 而 `RAIL_APPLE_LOGIN` 轉 `true`——先跑一次看它怎麼判。若它因為「帳號沒開啟卻開了 Apple 登入」而紅，那是**判準過期**（07-21 之後帳號的實際入口是 `plusOpen` 不是 `ACCOUNT_ENABLED`），把斷言改成對「登入鈕實際會不會被畫出來」的條件式判斷，不要為了過關去翻旗標。

- [ ] **Step 11：手機四寬度驗證**

登入面板是新露出的 UI，照 Global Constraints 掃 360／375／414／768 四寬度：面板不出視窗、兩顆登入鈕的 `elementFromPoint` 各自命中自己（**不是量幾何不相交——並排按鈕要驗點下去會發生什麼**）。未訂閱時的停用態同步鈕也要一起掃（它是本 Task 新增的 UI）。

- [ ] **Step 12：更新紀錄加一條**

在 `#msAbout` 的 `.foot-recent` 最上方加（**文案必須說清楚這是 Plus 功能**，否則等於對外宣告同步免費）：

```html
<li><span class="d">8/2</span><span>訂閱軌島 Plus 後可以用軌島帳號登入，收藏的地點與完乘記錄會在手機和電腦之間同步</span></li>
```

被擠出「最近更新」的舊條目**搬進**巢狀主題組——搬家不複製，搬完 grep 確認全檔只剩一份。

- [ ] **Step 13：Commit**

```bash
cd /Users/xuxiang/Code/軌島-Plus開張
git add index.html firebase-config.js worker.js scripts/verify_plus_subscription.mjs
git commit -m "feat(Plus): 雲端同步接上訂閱資格閘門，網站端補 /api/plus-status 讀 App 買的資格"
```

- [ ] **Step 14：真機端到端（需要人，無法自動化）**

在 Xcode 用 Team `UCD3GAKML6` 跑到實機，走完整鏈：**登入 → 登出 → 重新登入 → 刪帳號**。四步都要成功，且刪帳號後 `/api/account-delete` 回 200、Firestore 該 uid 的資料真的消失。

⚠️ 這一步做不完就不要進 Task 7 的端到端驗收。

---

## Task 2：行程分享改接 entitlement

**Files:**
- Modify: `index.html`（`TRIP_SHARE_ENABLED` 定義處、`fpTripShare` 的 hidden 判斷）
- Test: `scripts/verify_plus_features.mjs`（Task 6 建立；本 Task 先手動驗，Task 6 補自動化）

**Interfaces:**
- Consumes：`state.plus.active`（Task 1）、`plusGateOpen(source, onGranted)`
- Produces：`tripShareVisible()` → boolean，Task 6 的清單驗收會呼叫它

- [ ] **Step 1：加一個資格判定函式**

在 `TRIP_SHARE_ENABLED` 定義的**下方**加：

```javascript
// 行程分享發起端＝Plus。這支只管「鈕要不要出現」,不等於放行——
// ?tripshare=1 是開發測試通道,它點亮入口讓版面看得到,但按下去仍會被 plusGateOpen 攔去訂閱。
// 兩段式(顯示 vs 放行)是刻意的:URL 參數可以被轉貼,不能讓它變成公開後門。
// 接收端 ?trip= 永遠免費解碼,不受這裡影響。
function tripShareVisible() {
  return TRIP_SHARE_ENABLED || !!(state.plus && state.plus.active);
}
```

⚠️ **命名刻意不叫 `Allowed`**——它回答的是「看不看得到」，不是「能不能用」。放行由 Step 2b 的 `plusGateOpen` 負責。若把兩者合成一支，`?tripshare=1` 就成了任何人轉貼網址就能白拿的後門。

- [ ] **Step 2：把發起鈕的顯示條件換掉**

`index.html` 原本這一行：

```javascript
  if (tsBtn) tsBtn.hidden = !(TRIP_SHARE_ENABLED && !tr.loop && !!tripSysCode(tr.sys));
```

改成：

```javascript
  if (tsBtn) tsBtn.hidden = !(tripShareVisible() && !tr.loop && !!tripSysCode(tr.sys));
```

- [ ] **Step 2b：按下去的地方接上 plusGateOpen**

找到 `#fpTripShare` 的 click handler（開啟「選目的站」面板的那一處），把原本直接開面板的呼叫包起來：

```javascript
document.getElementById('fpTripShare').onclick = (e) => {
  e.stopPropagation();
  plusGateOpen('trip-share', () => openTripSharePanel()); // 非 Plus→導去訂閱;已訂閱→直接開面板
};
```

現況（`index.html:16406`）是 `document.getElementById('fpTripShare').onclick = (e) => { e.stopPropagation(); openTripSharePanel(); };`——**只是把既有的 `openTripSharePanel()` 包進 gate 的 callback，不新造任何函式**。

驗證這一步的判準：`?tripshare=1` 且未訂閱時，鈕**看得到**但按下去出現的是 Plus 訂閱視窗，不是選站面板。

- [ ] **Step 3：確認接收端沒被波及**

```bash
cd /Users/xuxiang/Code/軌島-Plus開張
grep -n "TRIP_SHARE_ENABLED\|tripShareVisible" index.html
```

預期：接收端解碼 `?trip=` 的兩處（約 `16110` 與 `16348` 的註解段）**完全沒有**引用這兩個名字——payload 是公開的，接收端永遠免費。

- [ ] **Step 4：手動驗三態**

用本機 server 開三次：

1. 無參數 → 跟隨一班台鐵車 → `#fpTripShare` **不出現**
2. `?plus=1` → 同上 → **仍不出現**（`?plus=1` 只點亮 Plus UI，`state.plus.active` 仍 false；`tripShareVisible()` 讀的是 `active` 不是 `PLUS_ENABLED`）
3. `?tripshare=1` → 出現（開發測試通道）

⚠️ 情境 2 是本 Task 最容易寫錯的地方：`PLUS_ENABLED` 是**UI 總閘**，`state.plus.active` 才是**資格**。搞混會讓任何人加 `?plus=1` 就白拿。

- [ ] **Step 5：Commit**

```bash
git add index.html
git commit -m "feat(Plus): 行程分享發起端改吃訂閱資格，不再靠網址旗標"
```

---

## Task 3：衛星高解析度接 entitlement

裁示＝**用戶端閘門（榮譽制）**，不做 Worker 代理圖磚。理由：App 端的 `satRetina` 是 build 時注入的，實務上翻不動，而 App 佔 Esri 用量的絕大部分——成本最大的那塊本來就收得住。

⚠️ **2026-08-02 裁示：Retina 維持 App 限定。** `index.html` 的 `SAT_RETINA_DEFAULT` **不改**，仍是 `false` ⇒ 網站訂閱者也拿不到高解析（`baseLayers.satLQ` 在網站上根本不會被建立）。因此凡是會顯示在網站上的文案——`plusRender()` 的功能清單、`#msAbout` 的更新紀錄——**都必須標明 App 限定**，否則就是對網站訂閱者做假廣告。清單已有這個慣例（現有的「App 進階定位與 Live Activity」）。

⚠️ 這不是「條件改一行」。`SAT_RETINA` 現在是 false，所以 `baseLayers.satLQ` **根本沒被建出來**（`if (k === 'sat' && SAT_RETINA)`）。要做分層＝兩層都建、依資格選。

**Files:**
- Modify: `index.html`（圖層建構處、`setBasemap()` 的 `want` 判斷、`plusRefresh` 後的重掛）
- Modify: `app/scripts/prepare-web.mjs`（`satRetina: false` → `true`，讓 App 也建兩層）
- Modify: `app/scripts/verify-release.mjs`（反向改寫「不可殘留 Plus 付費閘」斷言）
- **不動** `worker.js`：初版寫「`basemapToken` 加 rate limit」，前提是錯的（見 Step 7）

**Interfaces:**
- Consumes：`state.plus.active`（Task 1）
- Produces：`satRetinaAllowed()` → boolean

- [ ] **Step 1：加資格判定，並讓兩層都建出來**

在 `SAT_RETINA` 定義處下方加：

```javascript
// 衛星高解析(Retina)＝Plus。SAT_RETINA 保留為「這個平台建不建得出高解析層」的總開關
// (Esri 額度止血用),資格判定另外走 satRetinaAllowed()——兩者是 AND。
function satRetinaAllowed() {
  return SAT_RETINA && !!(state.plus && state.plus.active);
}
```

### ⚠️ 動 setBasemap／衛星層之前必讀（2026-08-02 由 `feat/trtc-live` session 提供，皆為已踩過的坑）

1. **`satTileUrlBase` 必須維持頂層變數。** 把它移進函式裡讀 `TILES` 的症狀是**衛星鈕整顆消失**
   （不是圖磚壞掉，是按鈕不見了，很難往這個方向想）。本 Task 只改「選哪一層」與「建幾層」，
   **不要順手重構 URL 的取得方式**。
2. **`SAT_SESSION_AT = 40` 的混合門檻是刻意的，不准簡化。** 載滿 40 張才換 Esri session 計價——
   純 session 對「瞄一眼就走」的使用者更貴，損益兩平在 27 張。不要改成「一開站就換 session」。
3. **成本背景（影響驗收時的判斷，不影響做法）**：Esri 圖磚是按量計費且本期額度吃緊
   （實際數字、計費期與見底推估**只在私有記憶 `esri-session-billing`**，本 repo 是 PUBLIC，
   不在此處留用量比例、金額或日期）。
   Retina 是 4 倍圖磚量，但**只開給 Plus 訂閱者**（人數極少），淨增量有限。
   驗收時若量到圖磚量暴增，先確認閘門是不是漏了（非 Plus 也吃到 Retina），不要當成正常。

- [ ] **Step 2：圖層建構改成「兩層都建」**

原本（約 `index.html:15909-15910`）：

```javascript
    // SAT_RETINA 關閉時 sat 本身就是低解析度,不再養第二份(setBasemap 的 want 有 baseLayers.satLQ 存在性守門)
    if (k === 'sat' && SAT_RETINA) baseLayers.satLQ = L.tileLayer(t.url, { ...opt, detectRetina: false });
```

改成：

```javascript
    // 衛星兩層並存:sat=detectRetina(高解析,Plus 專屬)、satLQ=標準解析(免費層與跟車時用)。
    // 兩層都建才切得動——資格是 runtime 才知道的(要等 plusRefresh),不能在建層時決定。
    if (k === 'sat') baseLayers.satLQ = L.tileLayer(t.url, { ...opt, detectRetina: false });
```

- [ ] **Step 3：`setBasemap()` 的選層條件加上資格**

原本（約 `index.html:14625`）：

```javascript
  const want = sat ? (state.followTrain && baseLayers.satLQ ? 'satLQ' : 'sat') : (state.mapDark ? 'dark' : 'light');
```

改成：

```javascript
  // 跟車中鏡頭連續平移一律用標準解析(圖磚量 4 倍會拖慢載入),非 Plus 也一律標準解析。
  const wantLQ = !!baseLayers.satLQ && (state.followTrain || !satRetinaAllowed());
  const want = sat ? (wantLQ ? 'satLQ' : 'sat') : (state.mapDark ? 'dark' : 'light');
```

- [ ] **Step 4：訂閱狀態改變時要重掛圖層**

購買完成後畫面必須立刻變高解析，不能等下次切底圖。在 `plusRefresh()` 的 `accountRender(); plusFinishPending();` 那一行**之前**插入：

```javascript
    if (state.basemap === 'sat') setBasemap(); // 資格變動→衛星解析度跟著換,不必等使用者重切底圖
```

同樣在 `plusPurchase()` 的 `accountRender();` 之前插入同一行。

- [ ] **Step 5：App build 也要建兩層**

`app/scripts/prepare-web.mjs` 把 `satRetina: false` 改成：

```javascript
  satRetina: true, // 兩層都建;實際給不給高解析由 index.html 的 satRetinaAllowed()(訂閱資格)決定。額度吃緊時改 false＝全體降回標準解析
```

- [ ] **Step 6：反向改寫 CI 斷言**

`app/scripts/verify-release.mjs` 原本有兩條擋著 Plus 閘：

```javascript
    assert(!html.includes("plusGateOpen('satellite'"), 'App 第一版衛星免費，不可殘留 Plus 付費閘');
```
與 `satLine` 那條。**衛星本體仍然免費，只有 Retina 是 Plus**，所以：

- 保留 `satLine` 那條（`const sat = …` 判斷式仍不得含付費條件——衛星鈕本身要對所有人可見）
- 把 `plusGateOpen('satellite'` 那條**改成正向斷言**：

```javascript
    // 2026-08-02:衛星本體維持免費(satLine 那條顧),但高解析(Retina)是 Plus。
    // 這條反過來要求資格函式存在——移除它等於把付費層靜默送掉。
    assert(/function satRetinaAllowed\s*\(/.test(html),
      '衛星高解析的資格判定 satRetinaAllowed() 消失——Retina 會變成全體免費');
    assert(/const wantLQ = [^;]*satRetinaAllowed\(\)/.test(html),
      'setBasemap 的選層條件沒有消費 satRetinaAllowed()——資格判定形同虛設');
```

- [ ] **Step 7：`/api/basemap-token` 加 rate limit**

❌ **本步驟作廢，不要做。前提是錯的。**

初版寫「`worker.js` 的 `basemapToken` 目前零驗證零節流，加一道每 IP 每分鐘 12 次」。實查：07-29 的 `3625692`（`feat(worker): /api/basemap-token 加 rate limit(60 次/分鐘)`）**早就加過了**，`worker.js:666` 的 `rateLimited(env.BASEMAP_LIMITER, request)` 在跑。

🔴 而且**不能直接把這個 limiter 調小**：`worker.js:683` 顯示 `/api/basemap-session` 共用同一個 binding，那裡的註解明寫「每顆 session 都要錢，所以這條比 basemap-token 更該節流」。收緊到 12/分會連帶勒住更貴、更該保的 session 端點。真要分開就得先拆成兩個 binding——那是另一件事，不在本批次範圍。

（「零驗證」那半仍然成立：這支端點不檢查任何身分。但那是既有設計，本批次不處理。）

⚠️ 上限不能設太低：一個正常使用者在切換底圖／App 冷啟動時可能連打數次。12/分是「人不可能達到、腳本抓取會撞牆」的位置。

- [ ] **Step 8：驗證——量實際發出的圖磚 zoom 層級，不是量畫面糊不糊**

寫 `scripts/verify_sat_retina.mjs`，用 Playwright 攔 `ibasemaps-api.arcgis.com` 的請求：

```javascript
// 判準:非 Plus 時衛星圖磚的 z 必須等於 map.getZoom();Plus 時 detectRetina 會抓 z+1。
// 這是「實際發出的請求」——外部可觀測事實,不與實作共用任何推導假設。
const zooms = [];
page.on('request', r => {
  const m = r.url().match(/World_Imagery\/MapServer\/tile\/(\d+)\//);
  if (m) zooms.push(Number(m[1]));
});
```

四個情境各量一次：
1. 匿名 + 衛星 → 全部 `z === map.getZoom()`
2. 匿名 + 衛星 + 跟車 → 同上
3. `state.plus.active = true` 注入 + 衛星（不跟車）→ 出現 `z === map.getZoom() + 1`
4. Plus + 衛星 + 跟車 → 退回 `z === map.getZoom()`（跟車一律標準解析）

- [ ] **Step 9：突變測試（確認判準有牙）**

在隔離樹故意把 `satRetinaAllowed()` 改成 `return SAT_RETINA;`（拿掉資格），重跑 Step 8。預期情境 1 轉紅。**沒轉紅＝判準沒有牙，回去修判準。**還原後確認全綠。

- [ ] **Step 10：更新紀錄 + Commit**

```html
<li><span class="d">8/2</span><span>訂閱 Plus 後，衛星底圖會用高解析度圖磚（支援 Retina 螢幕）</span></li>
```

```bash
git add index.html worker.js app/scripts/prepare-web.mjs app/scripts/verify-release.mjs scripts/verify_sat_retina.mjs
git commit -m "feat(Plus): 衛星高解析度改為訂閱專屬（App 限定）"
```

---

## Task 4：創始會員徽章

**判定方式**：創始價與標準價是**同一個訂閱商品**（做法是「開賣時標準價直接設創始價 → 30 天後改價選 Option A」），所以 RevenueCat 的 entitlement 分不出來。唯一可用的訊號是**訂閱起始時刻**：`customerInfo.entitlements.active.plus.originalPurchaseDate`。

⚠️ **2026-08-02 補：這個訊號只有 App 路徑拿得到，徽章因此是 App 路徑限定。**
Task 1 之後 `plusRefresh()` 有兩條分支：`plusConfigured()` 為真時走 billing adapter（有 `customerInfo`，
`foundingFrom(info)` 可用）；網站走 `/api/plus-status`，而該端點**只回 `{active}`**。
根因不是懶得傳：Worker 的 `checkPlusEntitlement()` 打的 RevenueCat v2 `active_entitlements`，
其 item 欄位**只有** `object`／`entitlement_id`／`expires_at`（2026-08-02 查官方 API 文件確認，
無任何 purchase date 欄位）⇒ 網站要拿到訂閱起始時刻**必須多打一支 RevenueCat API**，
落在一條有限流、對延遲敏感的路徑上。

**裁示（例行判斷，非新政策）**：不為了一個裝飾性徽章加那支呼叫。理由是 v1 **只在 App 內購**
（網站 `PLUS_ENABLED` 要 `?plus=1`），所以**每一個創始會員在拿到徽章的當下都是 App 使用者**，
App 路徑覆蓋 100%。網站只在「事後用網頁看護照」時看不到徽章——優雅降級，不是壞掉。

⇒ **Step 2 只改 `plusConfigured()` 那條分支**（`/api/plus-status` 那條沒有 `info` 可傳，
硬加會是 `foundingFrom(undefined)` 恆 false 的死碼）。
⇒ **Step 7 的更新紀錄那條要寫「在 App 的旅程護照上」**——它顯示在網站上。
與衛星 Retina 那條的差別要分清楚：Retina 是**網站訂閱者根本拿不到**（真的會構成假廣告）；
徽章是**拿得到、只是網站看不到**，但既然這行字會被網站讀者看到，講清楚在哪裡看得到才誠實。
⇒ Step 3 徽章本體的文案不必動（它只在 App 裡渲染得出來，看得到它的人都在 App）。
⇒ 若日後開放網站購買，這個決定要重新評估（屆時網站會有真正的購買者拿不到徽章）。

🔴 **2026-08-02 二次更正（上面那條 ⚠️ 把兩件事併成一句，第二件是錯的，由 Task 4 實作者頂回來才沒出貨）**：

「創始資格判定是 App 限定」為真（上述 RevenueCat 欄位查證成立）。但由它推出的
「所以插入點 `renderPassport()` 就是 App 使用者看到的地方」**為假，且方向剛好相反**：

- `body.fs .passport { display:none }`，而 `body.fs` 在 `matchMedia('(max-width: 900px)')`
  成立時掛上（index.html:2910）⇒ **App 與手機使用者永遠看不到 `#passport`**。
- App／手機看到的是另一個元素與另一支函式：`#ridePanel`（index.html:3171）由
  `renderRidePanel()`（:9635）渲染，由 `#rideBtn` 開啟。

淨效果：照原稿出貨，這枚徽章**沒有任何人看得到**——創始會員在 App 裡看不到，
而網站根本拿不到 `founding`。⇒ **Step 2 補第三個寫入點、Step 3 同時接兩支渲染函式**（下方已改）。

同時出現在兩個介面**不是**新問題：`buildStamps(rides)`／`buildStationStamps(rides)`
現在就已經同時出現在 `renderPassport()` 與 `renderRidePanel()`，章族內容跨兩介面重複是
既有設計。徽章屬章族，跟著同一套走，不要為它另外加 CSS 或條件式。

因為改價是手動動作、且 App 審核通過日不可預知，**截止時刻用 build 時常數**寫死，並在同一天在行事曆釘上 ASC 改價提醒——兩件事綁同一個日期，就不會只做一半。

**Files:**
- Modify: `index.html`（常數、判定函式、`plusRefresh`／`plusPurchase` 寫入、護照渲染）

**Interfaces:**
- Consumes：`state.plus`（Task 1）、`renderPassport()`／`buildAchv()`
- Produces：`state.plus.founding`（boolean）、`FOUNDING_UNTIL_MS`（常數）

- [ ] **Step 1：加常數與判定**

在 `plusConfig()` 附近加：

```javascript
// 創始會員＝在創始價期間開始訂閱的人。判定用訂閱起始時刻,不是當下時刻——
// 改價後他們的價格被 Apple 的 Option A 保住(不斷訂就不受影響),徽章也要跟著保住。
// ⚠️ 這個日期與 ASC 上的改價日是同一天,改一個就要改另一個。
const FOUNDING_UNTIL_MS = Date.parse('2026-09-15T00:00:00+08:00'); // 開賣日 + 30 天,發版前依實際開賣日校正
function foundingFrom(info) {
  try {
    const ent = info && info.entitlements && info.entitlements.active && info.entitlements.active[plusConfig().entitlement || 'plus'];
    const t = ent && (ent.originalPurchaseDate || ent.latestPurchaseDate);
    return !!t && Date.parse(t) < FOUNDING_UNTIL_MS;
  } catch (e) { return false; }
}
```

- [ ] **Step 2：在兩個寫入點記錄它**

`plusRefresh()` 裡 `p.active = plusActiveFrom(info);` 的**下一行**加：

```javascript
    p.founding = p.active && foundingFrom(info);
```

`plusPurchase()` 裡 `p.active = plusActiveFrom(info);` 的**下一行**加同樣一行。（兩處都要，否則剛買完不會馬上拿到徽章。）

🔴 **第三個寫入點（原稿漏了，2026-08-02 由實作者找出）**：`plusRestore()`（index.html:7305）
也是 `p.active = plusActiveFrom(info);` 的同形寫入點，手上就有 `info`，但原稿沒列。
漏了的後果是**換機／重裝後按「恢復訂閱」的創始會員拿不到徽章**，要等下次登入才補上。
同樣在它的下一行加上那一行，形狀對齊前兩處。

- [ ] **Step 3：護照裡露出徽章**

`renderPassport()` 的 `stamps` 組裝行：

```javascript
  const stamps = buildStamps(rides) + buildStationStamps(rides) + buildLineBars() + buildCorrectSection() + buildAchv(rides, 'seal');
```

改成：

```javascript
  const stamps = buildFoundingSeal() + buildStamps(rides) + buildStationStamps(rides) + buildLineBars() + buildCorrectSection() + buildAchv(rides, 'seal');
```

並在 `renderPassport` 上方新增：

```javascript
// 創始會員徽章:只有創始期間訂閱的人看得到,放護照最上方(它不是靠跑車跑出來的,與收集章分開)
function buildFoundingSeal() {
  if (!state.plus || !state.plus.founding) return '';
  return '<div class="ph-founding"><span class="pf-mark">創</span>' +
    '<span class="pf-txt"><b>創始會員</b><i>謝謝你在最早的時候就決定支持軌島</i></span></div>';
}
```

🔴 **同時要接進 `renderRidePanel()`——這才是 App／手機唯一看得到的那條路**（見上方二次更正）。
在 `renderRidePanel()` 的 innerHTML 組裝裡，`buildStamps(rides) +` 的**前面**插入
`buildFoundingSeal() +`，與 `renderPassport()` 同序：

```javascript
    buildFoundingSeal() +
    buildStamps(rides) +
    buildStationStamps(rides) +
```

⚠️ `renderRidePanel()` 開頭是 `if (el.hidden) return;`——驗證時要先 `openRidePanel()`
或點 `#rideBtn`，否則整支不跑，會量到「徽章不存在」的假陰性。

- [ ] **Step 4：加樣式**

在 `.ph-` 家族樣式附近加（沿用既有的 `--` 色票，不要引入新色）：

```css
  .ph-founding { display:flex; align-items:center; gap:10px; margin:0 0 10px; padding:9px 12px;
                 border:1px solid var(--line); border-radius:var(--r-m); background:var(--bg-stage); }
  .ph-founding .pf-mark { flex:none; width:30px; height:30px; border-radius:var(--r-pill); display:grid; place-items:center;
                          font-weight:900; font-size:15px; color:var(--paper); background:var(--gold); }
  .ph-founding .pf-txt { display:flex; flex-direction:column; line-height:1.35; }
  .ph-founding .pf-txt b { font-size:13.5px; color:var(--ink-strong); }
  .ph-founding .pf-txt i { font-style:normal; font-size:11.5px; color:var(--faint); }
```

變數皆為 `:root` 既有值（`--gold:#D2A12A`、`--bg-stage`、`--paper`、`--faint`、`--ink-strong`、`--r-m`、`--r-pill`），不引入新色票。
⚠️ 暗色主題有一組覆寫（`html[data-theme=dark]`），改完要在暗色下看一眼——`--bg-stage` 與 `--gold` 的對比在暗色可能要另外調。

- [ ] **Step 5：驗證三態**

用 Playwright 注入三種 `state.plus`，**兩條渲染路徑各驗一次**（桌面 `renderPassport()`／
手機寬度開 `#ridePanel` 後 `renderRidePanel()`）：

1. `{active:false}` → `.ph-founding` 不存在
2. `{active:true, founding:false}` → 不存在
3. `{active:true, founding:true}` → 存在，且 `elementFromPoint(中心)` 命中它自己（不被護照的收合動畫或其他章蓋住）

情境 3 同時是情境 1／2 的正向對照：同一支選擇器在同一輪裡真的抓得到東西，
那兩個「不存在」才是證據而不是選擇器打錯字。**兩條路徑都要有自己的情境 3**，
不能用桌面那顆當手機那兩顆的對照。

再加一條純函式測試餵 `foundingFrom()`：截止日**前一天**的 ISO → true；**後一天** → false；`undefined` → false。

- [ ] **Step 6：手機四寬度**

**手機看到的是 `#ridePanel` 不是 `#passport`**（`.passport` 在 ≤900px 是 `display:none`）。
在 360／375／414／768 開 `#ridePanel`，`.ph-founding` 不得溢出、文字不得被裁，
且要 `elementFromPoint` 命中——本專案的既有教訓是幾何不相交只證明「看起來沒疊」。

- [ ] **Step 7：更新紀錄 + Commit**

```html
<li><span class="d">8/2</span><span>最早訂閱 Plus 的人，App 的旅程護照上會有一枚創始會員徽章</span></li>
```

```bash
git add index.html
git commit -m "feat(Plus): 創始會員徽章上護照，依訂閱起始時刻判定"
```

---

## Task 5：Live Activity LA-0（跟車即時動態）

**這是本批次唯一的原生 Swift 工作，也是最大一塊。** 好消息是門檻比預期低很多：`RailBoardWidget` Extension 已經存在（**已在 `origin/main`**，不必等小工具分支）、App Group `group.tw.railisland.app` 兩邊的 entitlements 都已設、JS↔Swift 橋接有 `RailPlacesPlugin` 當現成樣板。

🔴 **2026-08-02 更正（原文寫「deployment target 是 17.6」是錯的，會害實作者做出災難性的「修法」）**：
這個 xcodeproj 有**兩個** deployment target，實查 `App.xcodeproj/project.pbxproj`：

| target | bundle id | IPHONEOS_DEPLOYMENT_TARGET |
|---|---|---|
| App（主程式） | `tw.railisland.app` | **15.0** |
| Widget Extension | `tw.railisland.app.RailBoardWidget` | 17.6 |

`RailFollowActivity.swift` 放 Extension（17.6 ✓ 沒問題），但 **`RailLiveActivityPlugin.swift` 放 App target，
它是對 iOS 15.0 編譯的**，而 `ActivityKit` 的 `Activity.request()` 需要 **16.1+** ⇒ **直接編不過**。

⇒ **Plugin 裡所有碰 ActivityKit 的程式碼一律包 `if #available(iOS 16.1, *)`**
（或在型別上標 `@available(iOS 16.1, *)`），並在 else 分支回一個明確的失敗給 JS，
讓前端知道「這台裝置不支援」而不是靜默無反應。

⇒ 🔴🔴 **絕對不准把 App target 的 `IPHONEOS_DEPLOYMENT_TARGET` 從 15.0 往上調來「修」這個編譯錯誤。**
那會把所有 iOS 15／16.0 使用者**直接斷掉**，而且 diff 只有一行、複審極容易放過。
Live Activity 是加值功能，不能拿「誰能用這個 App」去換。
（這正是判準盲點形態 10 的形狀：規格寫錯 ⇒ 實作者「照著把它變成能跑」＝做出比原缺陷更嚴重的傷害。）

**LA-0 的邊界（做這些、不做那些）**：純客端，零後端、零 APNs、零推播金鑰。倒數用 SwiftUI 的 `Text(timerInterval:)` 在客端自走；App 在前景時由既有的即時校正層推更新。**App 進背景久了誤點數字會停在最後一次更新的值**——這是 LA-0 的已知限制，不是缺陷（LA-1 才用 APNs 解）。

**Files:**
- Create: `app/ios/App/RailBoardWidget/RailFollowActivity.swift`
- Modify: `app/ios/App/RailBoardWidget/RailBoardWidgetBundle.swift`
- Create: `app/ios/App/App/RailLiveActivityPlugin.swift`
- Modify: `app/ios/App/App/RailPlacesPlugin.swift`（`capacitorDidLoad` 註冊新 plugin）
- Modify: `app/ios/App/App/Info.plist`
- Modify: `app/src/native-bridge.mjs`
- Modify: `index.html`（跟車起訖時呼叫橋接）

**Interfaces:**
- Consumes：`state.plus.active`（Task 1）、`state.followTrain`
- Produces：
  - Swift：`RailFollowAttributes`（`ActivityAttributes`），`ContentState` 欄位＝`nextStop: String`、`arrivalDate: Date`、`delaySec: Int`、`terminus: String`
  - JS：`window.RAIL_NATIVE_LIVEACTIVITY`，方法 `start({trainNo, kind, nextStop, arrivalIso, delaySec, terminus})`、`update({...同上})`、`end()`，皆回 Promise

- [ ] **Step 0：借 gitignored 的建置輸入（不做的話第一發建置就掛）**

這棵是乾淨 worktree，`GoogleService-Info.plist` 是**刻意 gitignored** 的（`app/.gitignore:11`），
所以不在這裡。少了它 `xcodebuild` 會直接失敗，而錯誤訊息（`Build input file cannot be found`）
看起來像專案壞掉，其實只是環境條件。

```bash
ln -sf /Users/xuxiang/Code/捷運小動畫/app/ios/App/App/GoogleService-Info.plist \
       /Users/xuxiang/Code/軌島-Plus開張/app/ios/App/App/GoogleService-Info.plist
```

symlink 是 gitignored 的，不會被 commit。**2026-08-02 已實跑驗證**：補上這個 symlink 後
`xcodebuild -workspace App.xcworkspace -scheme App -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=27.0' -configuration Debug CODE_SIGNING_ALLOWED=NO build`
＝ **BUILD SUCCEEDED**、0 error、Widget Extension 一併建起來。所以原生迴圈在本機是通的。

⚠️ 跑建置指令時**尾端不要接管道**（`| tail`／`| grep`）：那會把 exit code 換成管道最後一支的，
`BUILD FAILED` 也會回 0。要看摘要就先導向檔案再讀。（2026-08-02 我自己踩過一次。）

- [ ] **Step 1：Info.plist 加開關**

`app/ios/App/App/Info.plist` 的最外層 `<dict>` 內加：

```xml
	<key>NSSupportsLiveActivities</key>
	<true/>
```

⚠️ 少了這一把，`Activity.request()` 會直接丟 `ActivityAuthorizationError`，而且錯誤訊息不會告訴你缺的是 plist。

- [ ] **Step 2：定義 Attributes 與版面**

建 `app/ios/App/RailBoardWidget/RailFollowActivity.swift`：

```swift
import ActivityKit
import SwiftUI
import WidgetKit

struct RailFollowAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var nextStop: String      // 下一站站名
        var arrivalDate: Date     // 預計抵達時刻(倒數由 SwiftUI 自走,不必逐秒推)
        var delaySec: Int         // 誤點秒數;0=準點、負值=早到
        var terminus: String      // 終點站,用於 minimal 版面
    }
    var trainNo: String           // 車次
    var kind: String              // 車種(自強/區間/…);建立後不變的放這裡
    var sys: String               // 系統別(tra_sched/thsr_sched/…)
}

private func delayText(_ sec: Int) -> String {
    if sec >= 60 { return "誤點 \(sec / 60) 分" }
    if sec <= -60 { return "早到 \(-sec / 60) 分" }
    return "準點"
}

struct RailFollowActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RailFollowAttributes.self) { context in
            // 鎖定畫面 / 橫幅
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(context.attributes.kind) \(context.attributes.trainNo)")
                        .font(.caption).foregroundStyle(.secondary)
                    Text(context.state.nextStop).font(.headline)
                    Text(delayText(context.state.delaySec))
                        .font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
                Text(timerInterval: Date()...context.state.arrivalDate, countsDown: true)
                    .font(.system(.title2, design: .rounded).monospacedDigit())
                    .frame(maxWidth: 88)
            }
            .padding()
            .activityBackgroundTint(Color.black.opacity(0.35))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.attributes.trainNo).font(.caption).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: Date()...context.state.arrivalDate, countsDown: true)
                        .font(.caption.monospacedDigit()).frame(maxWidth: 62)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text("下一站 \(context.state.nextStop) · \(delayText(context.state.delaySec))")
                        .font(.caption2)
                }
            } compactLeading: {
                Text(context.state.nextStop.prefix(2))
            } compactTrailing: {
                Text(timerInterval: Date()...context.state.arrivalDate, countsDown: true)
                    .frame(maxWidth: 44).monospacedDigit()
            } minimal: {
                Text(context.attributes.trainNo.prefix(3))
            }
        }
    }
}
```

- [ ] **Step 3：掛進 WidgetBundle**

`RailBoardWidgetBundle.swift` 改成：

```swift
import WidgetKit
import SwiftUI

@main
struct RailBoardWidgetBundle: WidgetBundle {
    var body: some Widget {
        RailBoardWidget()
        RailFollowActivityWidget()
    }
}
```

- [ ] **Step 4：先跑一次 build，確認 Swift 編得過**

```bash
cd /Users/xuxiang/Code/軌島-Plus開張/app
xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug \
  -destination 'generic/platform=iOS Simulator' build 2>&1 | tail -25
```

預期：`BUILD SUCCEEDED`。**這一步失敗就停在這裡修，不要往下寫橋接**——Swift 編譯錯誤混在橋接問題裡很難分。

- [ ] **Step 5：寫橋接 plugin**

建 `app/ios/App/App/RailLiveActivityPlugin.swift`：

```swift
import ActivityKit
import Capacitor
import Foundation

@objc(RailLiveActivityPlugin)
public final class RailLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RailLiveActivityPlugin"
    public let jsName = "RailLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
    ]

    private var current: Any?  // Activity<RailFollowAttributes>;用 Any 存,避免整個 class 被 @available 綁死

    private func state(from call: CAPPluginCall) -> RailFollowAttributes.ContentState {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let raw = call.getString("arrivalIso") ?? ""
        let date = iso.date(from: raw)
            ?? ISO8601DateFormatter().date(from: raw)
            ?? Date().addingTimeInterval(60)
        return RailFollowAttributes.ContentState(
            nextStop: call.getString("nextStop") ?? "",
            arrivalDate: date,
            delaySec: call.getInt("delaySec") ?? 0,
            terminus: call.getString("terminus") ?? ""
        )
    }

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(["ok": false, "why": "ios<16.2"]); return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.resolve(["ok": false, "why": "disabled"]); return
        }
        endCurrent()
        let attrs = RailFollowAttributes(
            trainNo: call.getString("trainNo") ?? "",
            kind: call.getString("kind") ?? "",
            sys: call.getString("sys") ?? ""
        )
        do {
            let act = try Activity.request(
                attributes: attrs,
                content: .init(state: state(from: call), staleDate: Date().addingTimeInterval(8 * 3600))
            )
            current = act
            call.resolve(["ok": true])
        } catch {
            call.resolve(["ok": false, "why": error.localizedDescription])
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *), let act = current as? Activity<RailFollowAttributes> else {
            call.resolve(["ok": false]); return
        }
        let next = state(from: call)
        Task { await act.update(.init(state: next, staleDate: Date().addingTimeInterval(8 * 3600)))
               call.resolve(["ok": true]) }
    }

    @objc func end(_ call: CAPPluginCall) {
        endCurrent(); call.resolve(["ok": true])
    }

    private func endCurrent() {
        guard #available(iOS 16.2, *), let act = current as? Activity<RailFollowAttributes> else { return }
        current = nil
        Task { await act.end(nil, dismissalPolicy: .immediate) }
    }
}
```

⚠️ 用 `iOS 16.2` 而不是 16.1 作為門檻：`ActivityContent`／`staleDate` API 是 16.2 才有的，寫 16.1 會編不過。

- [ ] **Step 6：註冊 plugin 實例**

`app/ios/App/App/RailPlacesPlugin.swift` 的 `capacitorDidLoad()` 改成：

```swift
    public override func capacitorDidLoad() {
        bridge?.registerPluginInstance(RailPlacesPlugin())
        bridge?.registerPluginInstance(RailLiveActivityPlugin())
    }
```

- [ ] **Step 7：JS 側註冊**

`app/src/native-bridge.mjs`，比照既有 `RailPlaces` 的寫法加：

```javascript
    const RailLiveActivity = registerPlugin('RailLiveActivity');
    window.RAIL_NATIVE_LIVEACTIVITY = {
      start: p => RailLiveActivity.start(p),
      update: p => RailLiveActivity.update(p),
      end: () => RailLiveActivity.end(),
    };
```

- [ ] **Step 8：前端接上跟車生命週期**

`index.html` 加（放在 `followTrainNo` 家族附近）：

```javascript
// 跟車即時動態(Live Activity)＝Plus 且原生殼才有。純客端:App 在前景時推更新,
// 進背景後倒數由系統自走、誤點數字停在最後一次的值(LA-0 的已知邊界)。
const LIVE_ACTIVITY_ENABLED = !!window.RAIL_NATIVE_LIVEACTIVITY;
function liveActivityAllowed() {
  return LIVE_ACTIVITY_ENABLED && !!(state.plus && state.plus.active);
}
// 下一站與倒數完全沿用跟隨面板那一套(updateFollowPanel):nextStopInfo() 回 {name, min, at},
// min=距抵達分鐘數、at=表定時刻(秒)。Live Activity 只是把它算好的值搬過去,不另造演算法。
function laPayload(tr) {
  const info = nextStopInfo(tr, effTLive(tr)); if (!info) return null;
  const last = tr.stops && tr.stops[tr.stops.length - 1];
  return {
    trainNo: String(tr.train || ''), kind: String(tr.kind || tr.typeName || ''),
    sys: String(tr.sys || ''),   // 🔴 車次不是唯一鍵:台鐵與捷運/高鐵真的有同號車。凡以車次為鍵一律帶系統別
    nextStop: String(info.name || ''),
    arrivalIso: new Date(Date.now() + Math.max(0, info.min) * 60000).toISOString(),
    delaySec: Math.round(liveDelaySec(tr) || 0),
    terminus: String((last && last.name) || ''),
  };
}
```

實名對照（皆為 `index.html` 既有符號，`updateFollowPanel` 正在用）：
- `nextStopInfo(tr, effTLive(tr))` → `{name, min, at}`；`info` 為 null＝已抵達終點，此時應呼叫 `end()` 不是 `update()`
- `liveDelaySec(tr)` → 誤點秒數（正=誤點、負=早到）
- 車次欄位是 `tr.train`（不是 `tr.no`）

⚠️ 兩個坑：①`liveDelaySec` **不是純函式**，只可在這裡讀值顯示，不要拿它的回傳去參與任何位置計算；②`effTLive(tr)` 必須傳，漏了會拿到未套即時校正的表定時刻，卡片上的倒數會與跟隨面板不一致。

呼叫點用一個 helper 收在一起，避免三處各寫一份 guard：

```javascript
let _laLast = 0;
function laSync(tr, force) {
  if (!LIVE_ACTIVITY_ENABLED) return;
  const api = window.RAIL_NATIVE_LIVEACTIVITY;
  if (!tr || !liveActivityAllowed()) { api.end(); _laLast = 0; return; }
  const p = laPayload(tr);
  if (!p) { api.end(); _laLast = 0; return; } // info 為 null＝已抵達終點,收卡片
  const now = Date.now();
  if (force || !_laLast) { _laLast = now; api.start(p); return; }
  if (now - _laLast < 10000) return;          // 節流:倒數由系統自走,逐秒推是浪費
  _laLast = now; api.update(p);
}
```

三處呼叫：
- `followTrainNo()` 成功跟上後（`updateFollowPanel(tr)` 那一行附近）：`laSync(tr, true)`
- `updateFollowPanel(tr)` 結尾：`laSync(tr, false)`——它本來就是每秒被叫的那支，節流交給 `laSync`
- `clearFollow()`：`laSync(null)`

⚠️ `updateFollowPanel` 開頭有 `if (fp.hidden || !tr) return;` 的早退，所以停止跟車不會走到結尾那行——`clearFollow()` 那一處是必要的，不能省。

- [ ] **Step 9：捷運接點（含北捷官方逐車）**

> 本節的結構事實由 `feat/trtc-live` session 於 2026-08-02 查碼回覆（行號取自他們的 `91b77c0`，會漂但結構不變）。使用者裁示 Live Activity 第一版**要涵蓋捷運、含北捷**。

台鐵走 `state.followTrain`／`updateFollowPanel`；**捷運完全是另一條路徑**，走 `state.freqFollow`／`updateFreqCard`。`updateFreqFollowCamera()` 的三個分支全部收斂到 `updateFreqCard(info)`：

| 分支 | `state.freqFollow` | 是什麼 | 發不發卡片 |
|---|---|---|---|
| `f.tr` | `{ln, tr}` | 實際時刻班次 | 發 |
| `f.ot` | `{ln, ot}` | **北捷官方逐車**（本版主打） | 發 |
| `f.k` | `{ln, k}` | 班距示意車 | **不發**——它不是一台真的車 |

⇒ 接點掛在 `updateFreqCard` 結尾**一處**即可，兩種真車同時涵蓋，與 `feat/trtc-live` 零耦合。

🔴 **守衛條件是 `f.tr || f.ot`，不是 `f.tr`。** 官方車沒有 `f.tr`——只判 `f.tr` 會把這一版的主打功能整個排除掉。

🔴 **官方列傳進來的 `info` 是最小合成物件**（只有 `{loop, termName}`，**沒有 `nextName`／`nextSec`**），所以台鐵那套 `nextSec - simSec + shift` 對官方車套不上。`updateFreqCard` 內部本來就直接讀 `state.freqFollow`，接點也照做：

```javascript
// 捷運的 payload 與台鐵刻意分開:兩邊的資料來源、欄位、生命週期都不同,硬合成一支會讓兩邊都變脆。
function laPayloadMetro() {
  const f = state.freqFollow; if (!f) return null;
  if (f.ot) {                                   // 北捷官方逐車
    const ot = f.ot;
    // 🔴 ot.no 是不透明字串鍵——文湖線的值是 "121,164"(兩個車廂編號當一個字串,不是車次)。
    //    只可原樣顯示,禁止 split(',')／數值化／拿去跨系統比對。
    // 🔴 path 第一筆偶爾就是「目前所在站」,不濾會把現在站顯示成下一站(實測「東門→東門」)。
    //    文湖線恆無 path ⇒ nx 為 null 是正常情況,不是錯誤。
    const nx = Array.isArray(ot.path) ? ot.path.find(p => p.i !== ot.i) : null;
    return { trainNo: String(ot.no || ''), kind: '', sys: 'trtc',
             nextStop: nx ? String(nx.name || '') : '',
             // 🔴 nx.eta 已經是絕對 epoch 秒、且錨在上游 NowDateTime。禁止再加 Date.now(),
             //    也不要自己從 CountDown 重算——那正是 feat/trtc-live e4f4b80 修掉的 bug
             //    (原本錨在我方 fetch 時刻,每份快照系統性多算 6~10 秒)。
             arrivalIso: nx ? new Date(nx.eta * 1000).toISOString() : '',
             delaySec: 0, terminus: String(ot.destName || '') };
  }
  if (f.tr) { /* 實際時刻班次:沿用 nextStopInfo 那一套,shift 走 metroShiftSec(f.ln, f.tr) */ }
  return null;                                  // f.k 班距示意車:不發卡片
}
```

✅ **官方到站倒數已可用**（`feat/trtc-live` 的 Task 6 已落地：`e4f4b80` 含基準修正 ＋ `14e9deb`）。`state.trtc.byLine` 裡每台官方車的 `path[]` 依 `eta` 遞增排序，`eta` 是**絕對 epoch 秒**。

🔴 **`eta` 已經錨在上游 `NowDateTime`，不要再加 `Date.now()`，也不要自己從 `CountDown` 重算。** 這正是他們修掉的 bug——原本 `path[].eta` 錨在我方 fetch 時刻，比上游實際時刻系統性多算一個延遲（實測每份快照內是 6～10 秒的單一常數；修完 215 組 path/board delta 全為 0）。同一個錯誤也曾讓地圖上官方車的位置推估整體偏移。

⚠️ **`path` 一定要濾掉 `p.i === t.i`**：它會含「列車進站」（0 秒）的**當前站**，不濾就會拿到「它正停著的那一站」當下一站。

⚠️ **文湖線（BR）的 `path` 恆為空陣列** ⇒ `arrivalIso` 拿不到，Swift 端的**降級渲染**（沒有 `arrivalIso` 就不畫 `Text(timerInterval:)` 那一列，只顯示車號／下一站／終點）仍然必要，不要因為高運量有倒數就省掉。前端另有 `trtcBoardEta(ln, i, nx, dir)` 走看板列解，但那是前端函式、解不出唯一列時回 `null` 不猜——要在 Swift 端用得另外從 worker 出一份，**本版不做**。

🔴 **拆卡片的接點：捷運是 `clearFreqFollow()`（`index.html:5047`，14 個呼叫點），不是 `clearFollow()`。** 兩個都要掛。掛在 `clearFreqFollow()` 函式**內部**一處，不要去改 14 個呼叫點。

🔴 **官方車的跟隨結束得比時刻表車頻繁得多，Live Activity 要能承受「開一秒就結束」。** `trtcActive(ln)` 一翻假就 `clearFreqFollow()` ＋ toast（`index.html:5120`），翻假條件包括**使用者調速、把時間軸拉離現在超過 120 秒、資料齡超過門檻、上游沒有這條線的車**——按一下加速鈕就會發生。Swift 端必須：`Activity.request()` 的 handle 要留著，`end()` 在 request 還沒 resolve 時被呼叫，要 await 完再 end，**不可讓 end 被丟掉**（否則鎖定畫面留下一張永不消失的孤兒卡片）。驗收要有這一條：`start()` 後 200ms 內 `end()`，確認卡片不殘留。

⚠️ **文湖線官方車的可達性浮動極大，不要當成恆定狀態**。`feat/trtc-live` 在同一台伺服器上量到 BR 存活 3/24，二十分鐘後 24/24；另一次抽測 18 台 0 台過舊。所以「文湖線跟不了」是**單次量測的假象**——但也因此它**不能當驗收樣本**（同一支測試在不同時段會得到不同結果，紅了分不清是產品壞了還是剛好上游沒車）。Live Activity 的驗收一律用高運量線。`feat/trtc-live` 會在他們的 Task 8 於不同時段各量一次後裁定門檻——**不要為此自己調 `TRTC_STALE_MID`**。

- [ ] **Step 10：模擬器實測**

```bash
cd /Users/xuxiang/Code/軌島-Plus開張/app && npm run sync
```

用 iOS Simulator 跑起來（模擬器支援 Live Activity 的鎖定畫面顯示），注入 `state.plus = {active:true}` 後跟一班台鐵車，確認：

1. 鎖定畫面出現卡片，車次／下一站／誤點文字正確
2. 倒數自己在走（不是靜止的數字）
3. 停止跟車 → 卡片消失
4. 換一班車 → 舊卡片被取代不是兩張並存

捷運三個情境（Step 9 的接點）——**三種 `state.freqFollow` 形狀各驗一次，只驗一種等於沒驗**：

5. `f.tr`（時刻表捷運，例：新北捷）→ 出卡片，下一站與倒數與跟車卡一致
6. `f.ot`（**北捷官方逐車，用高運量線**——文湖線的資料可達性浮動、當樣本會得到不穩定的紅）→ 出卡片，顯示車號／下一站／終點**與到站倒數**（`nx.eta`）；下一站不可以是它正停著的那一站（驗 `p.i !== ot.i` 的濾除真的有作用）；車號原樣顯示不做任何拆解
6b. 降級渲染：把 `arrivalIso` 手動塞成空字串（模擬文湖線 `path` 恆空）→ 卡片仍出現，只是不畫倒數列，**不是崩潰也不是顯示 1970**
7. `f.k`（班距示意車）→ **不出卡片**，且 console 零錯誤

8. 跟一台官方車後**按加速鈕** → `trtcActive` 翻假 → 卡片立刻收掉，不殘留
9. `start()` 後 200ms 內 `end()`（模擬「開一秒就結束」）→ 鎖定畫面不留孤兒卡片

- [ ] **Step 11：非 Plus 與非原生要安靜地什麼都不做**

驗證兩個負向情境：純網站（`window.RAIL_NATIVE_LIVEACTIVITY` 不存在）跟車 → console 零錯誤；App 內未訂閱跟車 → 不建立卡片、零錯誤。**台鐵與捷運兩條路徑各驗一次**。

- [ ] **Step 12：真機驗動態島**

模擬器的動態島行為與真機有差。在有動態島的實機上確認 compact／expanded／minimal 三種版面都不破版、文字不被裁。

- [ ] **Step 13：更新紀錄 + Commit**

```html
<li><span class="d">8/2</span><span>訂閱 Plus 後在 App 裡跟車，鎖定畫面和動態島會顯示下一站與到站倒數</span></li>
```

⚠️ 文案的邊界：台鐵與北捷高運量**有**倒數，文湖線**沒有**（`path` 恆空）。所以不要寫成「所有列車都有到站倒數」。上面那句「下一站與到站倒數」對絕大多數情況成立，可用；但若要更嚴謹可寫「下一站與到站時間」。

```bash
git add app/ios/App/RailBoardWidget/RailFollowActivity.swift app/ios/App/RailBoardWidget/RailBoardWidgetBundle.swift \
        app/ios/App/App/RailLiveActivityPlugin.swift app/ios/App/App/RailPlacesPlugin.swift \
        app/ios/App/App/Info.plist app/src/native-bridge.mjs index.html
git commit -m "feat(Plus): 跟車時在鎖定畫面與動態島顯示即時動態（Live Activity LA-0）"
```

---

## Task 6：Plus 功能清單與文案校正

放在功能任務**之後**，因為清單必須描述「真的存在的東西」。

**Files:**
- Modify: `index.html`（`plusRender()` 的 `feats` 陣列、`plus-trust` 那句）
- Create: `scripts/verify_plus_features.mjs`

**Interfaces:**
- Consumes：Task 2–5 產出的 `tripShareVisible()`／`satRetinaAllowed()`／`state.plus.founding`／`liveActivityAllowed()`

- [ ] **Step 0：把資格判定收斂成單一符號 `plusIsActive()`**

到這裡為止，`!!(state.plus && state.plus.active)` 這個判斷式會散在約六處（`plusRequire`／`plusGateOpen`／`accountSyncNow`／`tripShareVisible`／`satRetinaAllowed`／`liveActivityAllowed`）。**先抽成單一定義再做 Step 1 的稽核**：

```javascript
// Plus 資格的唯一判定式。刻意抽成具名函式而不是內聯——它讓「這個 repo 裡總共有哪幾道 Plus 閘門」
// 變成一次 grep 就答得完的問題,而不是要人肉掃六個不同的寫法。
function plusIsActive() { return !!(state.plus && state.plus.active); }
```

各功能自己的述詞（`satRetinaAllowed()` 等）維持不動，只把裡面的 `!!(state.plus && state.plus.active)` 換成 `plusIsActive()`。

⚠️ 這不只是 DRY。這是判準盲點形態 10 的破法第三條——**規格裡每一條「強制層級」的宣告都要指得到具體的程式碼位置**。收斂成單一符號之後，「開賣清單的六項是不是每一項都真的有閘門」才是一個可機械回答的問題，而不是靠人記得。

⚠️ 改完必須重跑 Task 1–5 的既有驗收腳本，確認一條都沒有由綠轉紅——這是純重構，任何行為變化都是缺陷。

🔴 **Step 0b：修掉「確定沒資格」與「查不出來」被前端收斂成同一件事**（2026-08-02 使用者裁示，
源自 Codex 付費牆稽核 Q4；與 Step 0 同一個主題＝資格判定的語意收斂，所以放在這裡）

後端**特地把兩種答案分開**（`worker.js:592-600`，註解寫明理由）：
- `200 {active:false}` ＝ **確定沒有資格**（`checkPlusEntitlement` 的 403 被轉成這個）
- 非 200 ＝ **查不出來**（503／401，上游故障）

前端卻把兩者收斂成同一個行為。`index.html:7256`：

```javascript
if (res.ok) { const data = await res.json(); if (data && data.active === true) p.active = true; }
```

`active:false`、非 200、例外，三者都**不動** `p.active` ⇒ 已經是 true 的暖頁面永遠不會被清掉。
後果：**取消訂閱／退款後，開著的分頁無限期保留 Plus**。軌島是刻意設計成長時間開著的
（放空模式、OBS 直播模式），「暖頁面」在這裡不是五分鐘，是好幾天。

⚠️ **修法只清「確定沒有」那一種，不要清「查不出來」那一種**：

```javascript
if (res.ok) {
  const data = await res.json();
  // 只有 200 才是「後端給了確定答案」:true 給資格、false 收回資格。非 200(503/401)是「查不出來」,
  // 一律維持現狀——把上游短暫故障誤讀成「沒訂閱」會讓付費者的功能整批閃爍消失(同一顧慮見
  // worker.js /api/plus-status 的註解,那裡就是為了讓前端能分辨才把 403 轉成 200 {active:false})。
  if (data && typeof data.active === 'boolean') p.active = data.active;
}
```

⚠️ **不要照「fail-open ⇒ 失敗就清掉」這個直覺改**——那會重新引入後端註解刻意要避免的閃爍。
判準要能分辨兩者：模擬 `200 {active:false}` 必須清掉；模擬 `503` 必須保留。**兩條都要有，
只驗一條等於沒驗到這個區分。**

- [ ] **Step 1：先寫會失敗的驗收腳本**

建 `scripts/verify_plus_features.mjs`。核心判準＝**清單上的每一項，都要能在程式裡指到一個真的資格判定**：

```javascript
// 判準寫「是什麼」不寫「有幾個」:逐項對映到一個必須存在的資格判定符號。
// 清單多一項少一項都會被抓到,而且改文案不會誤觸(對映的是符號不是字串長度)。
// ⚠️ needle 必須是「feats 那一項文案裡真的出現的子字串」——對映靠它,不是靠人眼。
//    改文案時若把 needle 也改掉,這支就會轉紅,那正是我們要的（清單與實作脫節必須有人知道）。
const REQUIRED = [
  { needle: '誤點履歷', symbol: /plusGateOpen\('delay-history'/ },
  { needle: '雲端同步', symbol: /!reason\.startsWith\('logout'\)/ },
  { needle: '行程分享', symbol: /function tripShareVisible\s*\(/ },
  { needle: '高解析',   symbol: /function satRetinaAllowed\s*\(/ },
  { needle: '創始會員', symbol: /function foundingFrom\s*\(/ },
  { needle: '動態島',   symbol: /function liveActivityAllowed\s*\(/ },
];
```

對映驗證（寫測試前先自己核一遍，needle 必須真的是子字串）：

| needle | 對應的 feats 文案 | 子字串成立？ |
|---|---|---|
| 誤點履歷 | `每班車的誤點履歷與統計圖表` | ✓ |
| 雲端同步 | `收藏與完乘記錄跨裝置雲端同步` | ✓ |
| 行程分享 | `行程分享：把你在哪班車上分享給朋友` | ✓ |
| 高解析 | `App 衛星底圖高解析度（支援 Retina 螢幕）` | ✓ |
| 創始會員 | `創始會員徽章` | ✓ |
| 動態島 | `跟車時在鎖定畫面與動態島顯示即時動態（App）` | ✓ |

腳本要做兩個方向的檢查（**雙向才算數**）：
- **正向**：`feats` 陣列裡的每一項，都能在 `REQUIRED` 找到對應且該 symbol 存在於 `index.html`
- **反向**：`REQUIRED` 裡的每一項，都出現在 `feats` 陣列裡（防「做了功能但忘了寫進清單」）

再加三條文案 gate：
- `feats` 與 `plus-trust` 那句不得出現「永遠」「一個都不會拿走」「更清晰」
- 衛星那項必須含「高解析」且含「Retina」
- `plus-trust` 必須保留「準確度」相關的免費承諾語

- [ ] **Step 2：跑它，確認失敗**

```bash
cd /Users/xuxiang/Code/軌島-Plus開張
node scripts/verify_plus_features.mjs
```

預期：FAIL——現行清單有「衛星底圖」「App 進階定位與 Live Activity」兩項對不上，且缺「行程分享」。

- [ ] **Step 3：改清單**

`plusRender()` 的 `feats` 改成：

```javascript
  const feats = [
    '<b>每班車的誤點履歷與統計圖表</b>',
    '收藏與完乘記錄跨裝置雲端同步',
    '行程分享：把你在哪班車上分享給朋友',
    'App 衛星底圖高解析度（支援 Retina 螢幕）', // App 限定(2026-08-02 裁示):網站的 SAT_RETINA_DEFAULT 維持 false,不標明就是對網站訂閱者做假廣告
    '跟車時在鎖定畫面與動態島顯示即時動態（App）',
    '創始會員徽章',
  ].map(t => `<div class="plus-feature"><span>✓</span>${t}</div>`).join('');
```

⚠️ 「App 進階定位」整項**移除**——它沒有實作，而且定位本身（平交道雷達、附近車站）是免費功能，寫進 Plus 會與「準確度不收費」的分界打架。

🔴 **「創始會員徽章」這一項有到期日，必須條件化（2026-08-02 Task 4 任務複審 I-3）**：
清單目前是**無條件**列出它。但創始資格的判定是 `Date.parse(t) < FOUNDING_UNTIL_MS`
（現值 2026-09-15，見 Task 4）——**過了那天之後才訂閱的人，永遠拿不到這枚徽章**，
而訂閱視窗還在對他們宣傳它。那是必然發生、有明確發生日期的假廣告，不是假設性風險。

修法二選一（實作者裁量，但**必須擇一**，不可留無條件版本）：
1. 到期後整項從 `feats` 移除：`...(Date.now() < FOUNDING_UNTIL_MS ? ['創始會員徽章'] : [])`；
2. 或改成不對新訂閱者構成承諾的措辭（例如標明限早鳥期間），並在期間結束後仍然成立。

⚠️ 這條的驗收要**跨過那個時點**：把時鐘（或常數）推到期後重繪，斷言清單裡不再出現對徽章的
無條件承諾。只在「今天」驗一次會全綠——今天還在創始期內，什麼都測不到。
（這正是本專案「只驗當下乾淨狀態＝沒驗」那一課；判準要寫成跨時點的，不是當下的。）

📌 **待使用者裁示（Codex 付費牆稽核 Q1，2026-08-02）**：第 1 項寫「誤點履歷**與統計圖表**」。
但 `/api/delay-stats`（30 天彙總）**零資格檢查**，只有 `/api/delay-history`（90 天逐日）有閘門。
若那份彙總本來就打算免費，這行文案要縮回只涵蓋逐日履歷；若不是，要補閘門。
**裁示到手前不要改這一項的文案**，兩個方向的改法相反。

✅ **已裁示（2026-08-02 使用者）：那份 30 天彙總本來就是免費的，不補閘門。**
⇒ 第 1 項的文案**必須縮回只涵蓋受保護的那一半**。現行寫法「誤點履歷**與統計圖表**」
把免費的彙總算進了賣點，屬宣稱與實作不符。改成指向 `/api/delay-history` 真正獨有的東西
（**逐日、回溯 90 天**），例如：

```javascript
    '<b>每班車的誤點履歷（逐日紀錄，回溯 90 天）</b>',
```

⚠️ 驗收要能分辨：把 `/api/delay-stats` 拿得到的東西視為「免費集合」，
斷言第 1 項的文案**不宣稱**任何落在該集合內的東西。
只檢查「文案有沒有提到誤點履歷」抓不到這個缺陷——它本來就提到了。

- [ ] **Step 4：跑測試，確認通過**

```bash
node scripts/verify_plus_features.mjs
```

預期：正向 6/6、反向 6/6、文案 gate 3/3 全綠。

- [ ] **Step 5：窄承諾覆核**

搜一遍全站對外文案：

```bash
grep -n "永遠\|一個都不會拿走\|更清晰" index.html terms.html privacy.html | grep -v "永遠免費\|永遠不" 
```

逐條看：「列車位置、誤點資訊與系統覆蓋永遠免費」這句**保留**（它是刻意的分界承諾）；其餘絕對句要改掉。

- [ ] **Step 6：手機四寬度看清單**

清單從 5 項變 6 項且文字變長，360 寬時 `.plus-feature` 不得斷行破版、不得溢出彈窗。

- [ ] **Step 6b：補上行程分享的更新紀錄（別的 session 刻意留給我們的債）**

修 `#tripBanner` 版面的那個 session **刻意沒加**更新紀錄條目，使用者裁示留給本批次，理由是：
行程分享在此之前 `TRIP_SHARE_ENABLED` 一直關著、站內更新紀錄從沒提過它，
先加等於**提前公告一個開不了的功能**。

而本批次**它就開了**（開賣清單第 3 項，Plus 訂閱者可見）⇒ 這條債現在到期。
草稿在 `TODO.md`「行程分享」節，寫的時候注意兩件事：

- 用使用者語氣寫（本專案更新紀錄的既有規矩），並照兩層結構放進正確的主題組。
- **要寫清楚它是 Plus 功能**，別讓免費使用者以為自己有——這與衛星 Retina 那條的
  「窄承諾」要求同源：講得到就要真的拿得到。

- [ ] **Step 7：Commit**

```bash
git add index.html scripts/verify_plus_features.mjs
git commit -m "feat(Plus): 訂閱清單改成六項，每一項都對得上真的能用的功能"
```

---

## Task 7：開閘與端到端驗收

**Files:**
- Modify: `index.html`（`PLUS_ENABLED` 的原生恆開那一行）
- Modify: `scripts/verify_plus_subscription.mjs`

**Interfaces:**
- Consumes：Task 1–6 全部

- [ ] **Step 1：恢復原生恆開**

`index.html` 的 `PLUS_ENABLED` 定義，把那行註解取消：

```javascript
const PLUS_ENABLED = (() => { try {
  if (window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()) return true; // App 內恆開:訂閱本來就是 App 功能,bridge 在頁面腳本前注入,判定可靠
  return new URLSearchParams(location.search).get('plus') === '1';
} catch (e) { return false; } })();
```

⚠️ 網站端**維持 `?plus=1`**——第一版只在 App 內購。

- [ ] **Step 2：跑齊驗收腳本**

```bash
cd /Users/xuxiang/Code/軌島-Plus開張
node scripts/verify_plus_subscription.mjs; node scripts/verify_plus_features.mjs; node scripts/verify_sat_retina.mjs; node scripts/verify_tripshare.mjs; node scripts/verify_public_repo_hygiene.mjs
```

全綠才往下。⚠️ 用 `;` 不用 `&&`——`&&` 會在第一支非零時**靜默跳過後面全部**，
看起來像「只有一支失敗」，實際上是「後面幾支根本沒跑」（判準盲點形態 11 的 shell 變體）。

- [ ] **Step 2b：🔴 push 前的歷史洩漏閘門（不可略過）**

本 repo 是 **PUBLIC**，`git log -p` 撈得到**中間 commit**。最終狀態乾淨 ≠ 歷史乾淨：
本批次有三處第三方服務成本數字是在中途才被移除的，原始字串仍留在中間 commit 裡。

📌 **2026-08-02 進度**：**commit message 那一面已清乾淨**（命中 7 → 0，用下方 Option 2 的
commit-tree 手法改寫，分支當時未 push、洩漏全程沒外流）。剩下的命中全是**檔案 diff 內容**，
分布在 4 顆 commit（`08a111a` `6f5ca0e` `88ec068` `2587a4d`，另 `2843a01` 已改寫為 `4c8cdbf`）
⇒ **這一面只能靠 Option 1 的 squash 處理，執行 Task 7 時仍要照跑一次確認數字。**

```bash
node scripts/verify_public_repo_hygiene.mjs   # 看「歷史掃描」那一段
```

**只要那段非空，這條分支就不能以現有 commit 序列 push。**

🔴🔴 **最容易踩的一步：把分支 push 上去開 PR，本身就已經公開了。**
`git push origin feat/plus-launch` 之後，那些中間 commit 在 GitHub 上**立刻可見**
（分支頁、commit 列表、PR 的 Commits 分頁都看得到）。**GitHub 的 squash-merge 按鈕只讓 `main`
乾淨，不會回頭抹掉你已經傳上去的分支歷史**——等到那時才想清乾淨已經來不及。
⇒ **順序只有一種是安全的：先在本機清乾淨，再 push。**

🔴 **掃描涵蓋三個面，不是兩個**（2026-08-02 範圍複審補上）：
檔案最終狀態、**檔案的中間 commit**、以及 **commit message 本體**。
第三面最容易漏——訊息不帶 `+` 前綴，原本兩段掃描結構上都照不到，
而本批次真的中過一次（描述「我修掉了什麼」時把原文整段引用進訊息裡）。腳本現已一併掃。

兩條合規路徑：

**Option 1：squash 合併（推薦）**
```bash
git checkout main && git pull
git merge --squash feat/plus-launch
git commit          # ⚠️ 訊息重新寫過,不要複製任何一顆舊訊息(它們正是洩漏源)
```

**Option 2：只改寫受影響 commit 的訊息（不動檔案內容時適用）**

🔴 **不要用 `git filter-branch`**：它**要求工作樹乾淨**，並行 subagent 在編輯時直接被拒。
（原稿寫的就是它，並據此把這件事標成「阻塞、等 implementer 收工」——**那是誤判**：
乾淨工作樹是 filter-branch 自己的限制，不是「改寫訊息」的限制。）

改走物件層 plumbing，**完全不碰 index 與工作樹**，並行期間隨時可跑：

```bash
NEW=$(git rev-parse "<第一顆要改的>^")          # 起點 = 它的父節點
for c in <依序列出 該顆..HEAD 的每一顆>; do
  TREE=$(git rev-parse "$c^{tree}")             # tree 沿用原 commit,內容保證不變
  MSG=<該顆的訊息檔>                             # 要改的那顆給新檔,其餘 git log --format=%B -1 $c 存檔
  export GIT_AUTHOR_NAME=$(git log --format=%an -1 "$c")
  export GIT_AUTHOR_EMAIL=$(git log --format=%ae -1 "$c")
  export GIT_AUTHOR_DATE=$(git log --format=%aI -1 "$c")
  export GIT_COMMITTER_NAME=$(git log --format=%cn -1 "$c")
  export GIT_COMMITTER_EMAIL=$(git log --format=%ce -1 "$c")
  export GIT_COMMITTER_DATE=$(git log --format=%cI -1 "$c")
  NEW=$(git commit-tree "$TREE" -p "$NEW" -F "$MSG")
done
git update-ref refs/heads/feat/plus-launch "$NEW" "$OLD_HEAD"   # ← 三參數
```

🔴 **三參數 `update-ref` 是 compare-and-swap**：並行 session 若在 commit-tree 與 update-ref
之間 commit，它會**當場失敗報錯**，而不是把對方的 commit 靜默丟掉。並行共樹期間永遠不要用兩參數。

**改完必驗三條**（少任何一條都不算驗過）：
`git diff <舊tip> <新tip>` 要空（證明只改訊息、內容逐 byte 相同）；
`git status --porcelain` 前後一致（證明別人進行中的編輯沒被碰）；
再跑一次衛生腳本確認 commit message 命中歸零。
> 那個「0」不是裸奔的零：同一支掃描器改寫前報 7、改寫後報 0，**前態自己就是正向對照**。
> 若你是第一次跑就得到 0，先確認掃描器真的在掃（本專案吃過「量測器沒在量」的虧）。

⚠️ `git log -n 1` 會被本機 PreToolUse hook 的旗標字串比對誤擋，寫成 `-1`。
同理，教訓文字若含被攔截的旗標名，用 Write/Edit 落檔，不要用 heredoc。

⚠️ 兩條路都記得：ledger 用 commit hash 當復原錨點，改寫／squash 後那些 hash 會失效，
完成後要把 ledger 的錨點換成新的。（Option 2 只有被改寫那顆**及其後代**換 hash，祖先不動。）

- [ ] **Step 3：發行前 CI**

```bash
cd /Users/xuxiang/Code/軌島-Plus開張/app
npm run sync && RAIL_ALLOW_SAFE_BUILD=1 node scripts/verify-release.mjs > /tmp/rel.txt 2>&1; echo "exit=$?"
```

🔴 **尾端不要接管道**。原稿寫的是 `... | tail -25`，而**管道會把真實 exit code 換成 `tail` 的 0**
——本批次已經因為這個吃過一次虧：`BUILD FAILED` 被吞掉、回報成 exit 0，只因為順手 grep 了輸出內容
才抓到。⇒ 一律「重導到檔案 → 印 `$?` → 再讀檔」。推廣版:**exit code 0 只有在指令尾端沒有管道時
才算證據。**

- [ ] **Step 4：ASC 沙箱購買 happy-path（需要人）**

**這是本批次最重要、也是唯一從沒跑過的一條路徑。**現有的付費牆只驗過 401／403 拒絕路徑。

用沙箱測試帳號在真機走：

1. 登入軌島帳號 → 開 Plus → 訂閱（年訂）
2. 購買完成後 `state.plus.active` 變 true
3. 打開一班台鐵車的誤點履歷 → **Worker 回 200 且真的帶資料**（不是 401／403）
4. 衛星底圖立刻變高解析（不必重切底圖）
5. 護照出現創始徽章
6. 跟車 → 鎖定畫面出現 Live Activity
7. 行程分享發起鈕出現
8. 刪帳號 → 資料清空、Plus 資格跟著失效

⚠️ 第 3 步是關鍵：若 Worker 回 403，先查 RevenueCat v2 金鑰的 `customer_information:customers:read` scope。

- [ ] **Step 5：Commit**

```bash
git add index.html scripts/verify_plus_subscription.mjs
git commit -m "feat(Plus): App 內開啟 Plus 入口，訂閱功能正式開張"
```

---

## Task 8：ASC 商品設定與改價提醒（使用者執行）

**這一項我做不了，需要你在 App Store Connect 後台操作。**

- [ ] **Step 1：建立／確認訂閱商品**

在 App Store Connect 的訂閱群組裡確認月訂與年訂兩個商品存在，且 entitlement 對應到 RevenueCat 的 `plus`。

- [ ] **Step 2：年訂標準價設為創始價**

**直接設標準價，不要設 introductory offer**——introductory offer 到期一定跳回原價，做不出「永久鎖定」。

- [ ] **Step 3：在行事曆釘上改價提醒**

日期＝`index.html` 的 `FOUNDING_UNTIL_MS` 那個常數。**兩個數字必須是同一天。**提醒內容要寫明：「到 App Store Connect 把年訂標準價改成正常價，改價時選 **Option A**（保留既有訂閱者價格）」。

⚠️ 選錯成 Option B 會把所有創始會員一起漲價。

- [ ] **Step 4：發版前校正常數**

App 送審通過、確定開賣日之後，回頭把 `FOUNDING_UNTIL_MS` 改成「實際開賣日 + 30 天」，並同步改行事曆。這一步做完才 build 正式版。

---

## 合併與上架

- [ ] **Step 1：等北捷逐車先併**

`feat/trtc-live` 動的是 `renderFreqBoard`／`trainPos` 一帶，`feat/plus-launch` 動的是 `plusRender`／`setBasemap`／跟隨面板／護照——重疊很少，但**仍要序列合併**，不要同時併。北捷先（它更接近完成、且是這一版的主打）。

🔴 **這一版有第三條分支要一起推（2026-08-02 使用者裁示，經跨 session 訊息轉達）**：
`claude/angry-hertz-74ce20`（worktree `.claude/worktrees/gracious-shannon-9ffc4f`），兩顆 commit
`8968c5a`／`5941bb3`，修的是 `#tripBanner` 的**既有**版面缺陷（手機蓋住時鐘徽章與地圖動作鈕、
桌面蓋住停靠站名牌），只動 `index.html` 兩處 CSS（+28/−2）。**已 commit、未 push、未部署**
（照跨 session 部署 hold）。使用者要求**之後推的時候要一起推**。

⚠️ 對驗收基準的影響：`scripts/verify_tripshare.mjs` 的那 5 條紅是**既有缺陷、非本批次迴歸**
（對方在乾淨 `origin/main` 上重跑一樣紅，已獨立確認）。所以在 `feat/plus-launch` 上跑到
**51/56 是正確的**；但**合併那條分支之後必須變 56/56**——合併後若仍是 51/56，代表那兩顆 commit
沒進來，不要當成「本來就這樣」放過。

- [ ] **Step 2：Plus 分支 rebase 到併完北捷的 main**

```bash
cd /Users/xuxiang/Code/軌島-Plus開張
git fetch origin && git rebase origin/main
```

衝突預期只在更新紀錄的 `li` 與版本字串——兩邊各自新增，兩條都留。

- [ ] **Step 3：rebase 後全部驗收重跑**

三支 Plus 腳本＋`verify-release.mjs`＋北捷自己的驗收腳本，全部重跑一遍。**rebase 過的分支等於沒驗過。**

- [ ] **Step 4：部署前必查**

```bash
git fetch origin && git log --oneline HEAD..origin/main
```

非空＝出貨會退掉這些 commit，先併再上傳。**「比正式站新」不是安全證明，基準要對 `origin/main`。**

- [ ] **Step 4b：🔴 出貨面的洩漏閘門（Step 2b 管 git，這條管部署——兩條路是分開的）**

`wrangler` 上傳的是**磁碟上的檔案**，`.gitignore` 對它完全無效，只有 `.assetsignore` 管得到。
本專案已經為這一課付過兩次代價（TDX 原始快取、icon 概念稿）。本批次又多了一個同形目錄：
`.superpowers/sdd/`（SDD 帳本與**每一輪的完整 diff 副本**——那些 diff 保存的是「改動前」的內容，
本批次剛移除的成本數字在裡面仍是原文）。已補進 `.assetsignore`，但**那只是一行文字，不會自己執行**：

1. **出貨清單只從乾淨 worktree 產生**（結構性只含追蹤檔，未追蹤／被忽略的檔進不去）：
   ```bash
   git worktree add --detach /tmp/rail-ship <要出貨的 commit>
   ```
   node_modules 與 gitignored 的設定檔用 symlink 借；**絕不從工作樹上傳**。
2. **部署後反向逐一探測「不該公開的都 404」**，至少涵蓋：
   `/.superpowers/sdd/2026-08-02-plus-launch/progress.md`、任一 `/.superpowers/sdd/**/review-*.diff`、
   `/scratchpad/`、`/.cache/`、任一 `/docs/superpowers/plans/*.md`。
   ⚠️ 用 `/usr/bin/curl -L`（`.html` 子路徑會 307；python urllib 會被注入 beacon 造成假不符）。
3. **正向對照**：同一支探測器對一條**確定公開**的路徑（`/index.html`）必須回 200。
   全部回 404 而沒有正向對照時，分不出「真的沒外洩」與「探測器根本沒打中站台」。

- [ ] **Step 5：先上預覽站給使用者親試，拿到明確「go」才升正式站**

這是大工程批次，不適用「小修直接部署」。

---

## 已知不做的（避免下一個 session 誤以為漏了）

- **LA-1／LA-2／LA-3**（APNs 即時更新、push-to-start、broadcast channel）——本批次只做 LA-0，零後端。
- **音樂歌單與睡眠定時**——它們卡在 `AVQueuePlayer`（iOS 上 `audio.volume` 被系統強制設回 1），與 Live Activity 沒有共用的前置，另排一版。
- **Worker 代理圖磚**——衛星高解析採用戶端閘門是 2026-08-02 的明確裁示，不要「順手做得更嚴」。
- **買斷／終身選項**——訂閱先上，之後再評估。
- **懸賞板與收集地圖**——`BOUNTY_ENABLED`／`COLLECT_MAP_ENABLED` 維持現況，不在本批次動。
- **北捷擁擠度是否進 Plus**——尚未裁示（與北捷企劃書「不單獨販賣原始資料」的承諾有張力），本批次不碰。
