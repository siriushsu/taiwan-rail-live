# 跟車即時動態鎖屏自動換站 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 iOS 鎖定畫面／動態島上的跟車卡在 App 進背景後仍會自動換成下一站。

**Architecture:** 站名來自 TDX `TrainLiveBoard` 的 `StationID` 觀測（查表，零推算），只有倒數是預測（表定 + 當前誤點）。前端跟車時把「表定時刻表 + 站碼映射表 + push token」交給 Worker，Worker 每分鐘 cron 比對，換站了才推一發 APNs。前景更新路徑完全不動。

**Tech Stack:** Swift / ActivityKit / WidgetKit、Capacitor plugin、vanilla JS（`index.html` 單檔）、Cloudflare Worker + D1、APNs HTTP/2 + ES256 JWT、Playwright（驗收）

**設計書：** `docs/superpowers/specs/2026-08-07-live-activity-push-design.md`（動手前必讀，本計畫只講怎麼做，不重述為什麼）

---

## Global Constraints

- **工作樹**：主樹 `feat/changelog-slim` 落後 `origin/main` 三百多顆 commit，**絕對不要在主樹實作**。
  一律 `git worktree add --detach <路徑> origin/main` 另開乾淨樹。
- **並行寫入**：本機有 30+ 個 worktree、多個 session 同時在寫。`git add` 前必跑 `git diff --stat <檔>`
  確認行數量級與自己的編輯相符；`git commit` **一律不帶 pathspec**（帶了會拿工作樹內容，隔離全白做）。
- **iOS 版本**：App target `IPHONEOS_DEPLOYMENT_TARGET = 15.0`（不可抬高），
  `RailBoardWidgetExtension` target `= 17.6`。Live Activity push token 需 16.2，Widget target 已滿足。
- **Bundle ID**：`tw.railisland.app`；Widget `tw.railisland.app.RailBoardWidget`；
  App Group `group.tw.railisland.app`（兩個 target 都已宣告）。
- **APNs topic**：`tw.railisland.app.push-type.liveactivity`，
  header `apns-push-type: liveactivity`、`apns-priority: 5`（**5 不計入更新預算，不指定則預設 10 且計入**）。
- **ContentState 只准加 Optional 欄位**（非 Optional 會讓「App 更新前開的卡」解不出來）。
- **`wrangler` 在這台機器要用完整寫法**：`arch -arm64 node ./node_modules/wrangler/bin/wrangler.js <cmd>`。
  `npx wrangler` 是壞的。
- **新增一支 API 端點要同步改三處**（漏第二處會被方法白名單擋成 405）：
  1. `worker.js:3868` 附近的 `if/else if` dispatch
  2. `worker.js:2387` 的 `API_POST_ALLOWED`（Set）—— 收 POST 必加
  3. `worker.js:2390` 的 `API_ENDPOINTS`（Set）—— 埋點用，路徑是 `pathname.slice(5)`（`/api/la/bind` → `la/bind`）
- **不准動 `wrangler.jsonc` 的 `triggers.crons`**。第二條 cron `"15 4 * * *"` 是 owner 2026-07-29 刻意停用的，
  檔內註解明寫「agent 不得自行加回」。新的每分鐘工作掛進**既有**的 `event.cron === '* * * * *'` 分支。
- **secret 不進 `wrangler.jsonc`**，一律 `wrangler secret put`；`vars` 只放非機密識別值。
- **回歸底線**：`scripts/verify_live_activity.mjs` 既有 15 組案例必須全數維持通過。
- **不順手重構**：`index.html` 有 10 處以上 inline 的 `.replace(/臺/g,'台')`，**不要合併它們**——
  與本功能無關，屬於另一次改動。
- **語言**：commit message 與程式碼註解一律繁體中文。

---

## 檔案結構

| 檔案 | 職責 | 動作 |
|---|---|---|
| `app/ios/App/App/App.entitlements` | 補 `aps-environment` | 修改 |
| `app/ios/App/RailBoardWidget/RailBoardWidgetExtension.entitlements` | 補 `aps-environment` | 修改 |
| `app/ios/App/App/RailLiveActivityPlugin.swift` | `pushType:.token`＋token 監聽與生命週期 | 修改 |
| `app/ios/App/App/RailFollowAttributes.swift` | ContentState 加 `departedDate: Date?` | 修改 |
| `app/ios/App/RailBoardWidget/RailFollowActivity.swift` | 進度條＋numericText 轉場 | 修改 |
| `app/src/native-bridge.mjs` | 暴露 `addListener` | 修改 |
| `index.html` | `traStnKey` / `buildStaMap` / `buildStopCodes` / `laBind` / `laUnbind` | 修改 |
| `schema/0003_live_activity.sql` | `la_bindings` 表的 DDL（`DELAY_DB` 的權威建表法） | 新增 |
| `worker.js` | `/api/la/bind`、`/api/la/unbind`、`laNextIdx()`、cron 分支、APNs | 修改 |
| `wrangler.jsonc` | 只加一顆 `LA_LIMITER`（**secret 不進此檔**，走 `wrangler secret put`） | 修改 |
| `scripts/verify_la_stamap.mjs` | Task 1 的純函式驗收 | 新增 |
| `scripts/verify_la_backend.mjs` | Task 5 的換站決策驗收（含突變） | 新增 |
| `scripts/verify_live_activity.mjs` | 追加 bind／unbind 的 JS 側案例 | 修改 |

---

## Task 0：硬前置（使用者親自做，工程無法代勞）

- [ ] **Step 1: 產生 APNs 金鑰**

到 <https://developer.apple.com/account/resources/authkeys/list> → `+` → 勾 **Apple Push Notifications service (APNs)** → Continue → Register → **Download**。

`.p8` 檔**只能下載一次**。同時記下 **Key ID**（10 碼）與 **Team ID**（帳號頁右上角，10 碼）。

- [ ] **Step 2: App ID 開啟 Push Notifications**

<https://developer.apple.com/account/resources/identifiers/list> → 選 `tw.railisland.app` → 勾 **Push Notifications** → Save。

- [ ] **Step 3: 三個 secret 寫進 Cloudflare**

```bash
arch -arm64 node ./node_modules/wrangler/bin/wrangler.js secret put APNS_KEY_P8
```

```bash
arch -arm64 node ./node_modules/wrangler/bin/wrangler.js secret put APNS_KEY_ID
```

```bash
arch -arm64 node ./node_modules/wrangler/bin/wrangler.js secret put APNS_TEAM_ID
```

`APNS_KEY_P8` 貼整個 `.p8` 檔內容（含 `-----BEGIN PRIVATE KEY-----` 與結尾那行）。

> **Task 6 之前不需要完成 Task 0。** Task 1–5、7 都可以先做。

---

## Task 1：站名正規化與 staMap 建構（純函式）

**Files:**
- Modify: `index.html`（`traStnName()` 附近，約 12950 行）
- Create: `scripts/verify_la_stamap.mjs`

**Interfaces:**
- Consumes: `state.stnInfoMap`（站名→`{id,lat,lon}`，開機時載入，`index.html:17707`）
- Produces:
  - `traStnKey(name: string) → string`
  - `buildStaMap(stops: Stop[], stnInfoMap: object) → {[stationId: string]: number}`
  - `buildStopCodes(stops: Stop[], stnInfoMap: object) → (string|null)[]`

> `Stop` 是班表既有形狀：`{name, lat, lon, order, arrSec, depSec, stop}`，`stop === false` 代表通過不停靠。

- [ ] **Step 1: 寫失敗的測試**

建立 `scripts/verify_la_stamap.mjs`。照 `verify_live_activity.mjs` 的既有紀律：`ROOT` 由本檔路徑推導（不吃參數）、印出 md5 自檢、每條斷言可被突變打紅。

```js
// staMap 建構驗收:站名正規化 → 站碼 → 下一停靠站索引。
// 判準對象是 index.html 裡的【產品函式】,不是本檔複製的版本——用 Playwright 求值真頁面。
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
console.log(`[G0] ROOT=${ROOT}`);
console.log(`[G0] index.html md5=${createHash('md5').update(readFileSync(path.join(ROOT, 'index.html'))).digest('hex')}`);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) { res.statusCode = 200; res.setHeader('content-type', 'application/json'); return res.end('{}'); }
  let fp = path.join(ROOT, decodeURIComponent(url.pathname));
  if (existsSync(fp) && statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!path.resolve(fp).startsWith(ROOT) || !existsSync(fp)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(fp)] || 'application/octet-stream');
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;

const results = [];
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(() => { try { localStorage.setItem('trainmap-howto-seen', '1'); } catch (e) {} });
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.state && state.stnInfoMap && Object.keys(state.stnInfoMap).length > 200, null, { timeout: 60000 });

// T1 全班表站名都對得上站碼(異體字＋括號註記)
const cover = await page.evaluate(() => {
  const names = new Set();
  for (const s of state.systems) {
    if (s.id !== 'tra_sched' || !s.data) continue;
    for (const t of (s.data.trains || [])) for (const st of (t.stops || [])) names.add(st.name);
  }
  const miss = [...names].filter(n => !state.stnInfoMap[traStnKey(n)]);
  return { total: names.size, miss };
});
ok('T1 班表站名 100% 對得上站碼', cover.total > 200 && cover.miss.length === 0,
   `${cover.total - cover.miss.length}/${cover.total}${cover.miss.length ? ' 缺:' + cover.miss.join(' ') : ''}`);

// T2 座標守門:名稱對上之後座標必須同點(專案原則:別名守門用座標,不用「名稱不撞」)
const geo = await page.evaluate(() => {
  let worst = 0, worstName = '';
  for (const s of state.systems) {
    if (s.id !== 'tra_sched' || !s.data) continue;
    for (const t of (s.data.trains || [])) for (const st of (t.stops || [])) {
      const i = state.stnInfoMap[traStnKey(st.name)];
      if (!i || st.lat == null) continue;
      const d = Math.hypot((i.lat - st.lat) * 111, (i.lon - st.lon) * 101);
      if (d > worst) { worst = d; worstName = `${st.name}→${i.name}`; }
    }
  }
  return { worst, worstName };
});
ok('T2 座標守門 全部 <1km', geo.worst < 1.0, `最大 ${geo.worst.toFixed(3)}km (${geo.worstName})`);

// T3 staMap 語意:通過站與停靠站都指向正確的「下一個停靠站」
const sem = await page.evaluate(() => {
  const sys = state.systems.find(s => s.id === 'tra_sched');
  const t = (sys.data.trains || []).find(x => String(x.train) === '554');
  if (!t) return { err: '班表無 554' };
  const map = buildStaMap(t.stops, state.stnInfoMap);
  const stopOnly = t.stops.filter(s => s.stop !== false);
  const idOf = n => state.stnInfoMap[traStnKey(n)].id;
  return {
    n: Object.keys(map).length, stops: stopOnly.length, passed: t.stops.length,
    fromStop: map[idOf('潮州')], fromPass: map[idOf('竹田')],
    fromStopName: stopOnly[map[idOf('潮州')]] && stopOnly[map[idOf('潮州')]].name,
    fromPassName: stopOnly[map[idOf('竹田')]] && stopOnly[map[idOf('竹田')]].name,
    terminusHas: map[idOf(t.stops[t.stops.length - 1].name)],
  };
});
ok('T3a 離開停靠站→下一停靠站正確', sem.fromStopName === '屏東', `潮州→${sem.fromStopName}(idx ${sem.fromStop})`);
ok('T3b 離開通過站→下一停靠站正確', sem.fromPassName === '屏東', `竹田→${sem.fromPassName}(idx ${sem.fromPass})`);
ok('T3c 終點站沒有下一站', sem.terminusHas === undefined, `終點值=${sem.terminusHas}`);

// T4 全車次都建得出非空 staMap(正向對照:證明不是「函式回空物件也全過」)
const all = await page.evaluate(() => {
  const sys = state.systems.find(s => s.id === 'tra_sched');
  let empty = 0, tot = 0, maxN = 0;
  for (const t of (sys.data.trains || [])) {
    const n = Object.keys(buildStaMap(t.stops, state.stnInfoMap)).length;
    tot++; if (!n) empty++; if (n > maxN) maxN = n;
  }
  return { tot, empty, maxN };
});
ok('T4 全車次 staMap 皆非空', all.tot > 500 && all.empty === 0 && all.maxN > 50,
   `${all.tot} 車次、空 ${all.empty} 個、最大 ${all.maxN} 筆`);

// T5 stopCodes 與停靠站同序同長且無 null
const sc = await page.evaluate(() => {
  const sys = state.systems.find(s => s.id === 'tra_sched');
  const t = (sys.data.trains || []).find(x => String(x.train) === '554');
  const codes = buildStopCodes(t.stops, state.stnInfoMap);
  const stopOnly = t.stops.filter(s => s.stop !== false);
  return { len: codes.length, want: stopOnly.length, nulls: codes.filter(x => !x).length, first: codes[0] };
});
ok('T5 stopCodes 同序同長且無 null', sc.len === sc.want && sc.nulls === 0,
   `${sc.len}/${sc.want}、null ${sc.nulls}、首筆 ${sc.first}`);

await browser.close(); server.close();
const bad = results.filter(r => !r.p).length;
console.log(`\n總計 ${results.length} 項,FAIL ${bad}`);
process.exit(bad ? 1 : 0);
```

- [ ] **Step 2: 跑它，確認失敗**

```bash
node scripts/verify_la_stamap.mjs
```

預期：所有 T 項 FAIL，錯誤訊息含 `traStnKey is not defined`。

- [ ] **Step 3: 寫最小實作**

在 `index.html` 的 `traStnName()`（約 12950 行）**下方**插入：

```js
// 站名 → stnInfoMap 的鍵。兩條規則:
//  (a) 臺→台:stnInfoMap 的鍵一律用「台」(該檔自述),而班表兩種寫法混用
//  (b) 剝尾端括號註記:班表「左營(舊城)」「新城 (太魯閣)」對應站碼表的「左營」「新城」
//      安全性:stnInfoMap 245 個鍵沒有任何一個含括號,剝除不可能撞到別的站(已實測)
//      不可剝「-環島」:台北-環島(1001) 與 台北(1000) 是不同站碼,是刻意的別名
function traStnKey(name) {
  return String(name).replace(/臺/g, '台').replace(/\s*\([^)]*\)\s*$/, '').trim();
}
// 這班車的「經過站碼 → 下一個停靠站索引」。涵蓋通過站,所以車經過任何小站都對得上。
// 語意:staMap[X] =「車已離開 X 之後,下一個要停的站」;X 自己是停靠站時,值指向它的【後一個】。
function buildStaMap(stops, stnInfoMap) {
  const map = {}, idxOfStop = [];
  let k = 0;
  for (let i = 0; i < stops.length; i++) if (stops[i].stop !== false) idxOfStop[i] = k++;
  let nextStopIdx = null;
  for (let i = stops.length - 1; i >= 0; i--) {          // 由後往前掃,一路記住最近的停靠站
    const info = stnInfoMap[traStnKey(stops[i].name)];
    if (info && info.id && nextStopIdx !== null) map[info.id] = nextStopIdx;
    if (stops[i].stop !== false) nextStopIdx = idxOfStop[i];
  }
  return map;
}
// 停靠站的站碼,與 stops 過濾後同序。後端用它解 status=0(車還沒到 X)⇒ 下一站是 X 自己。
function buildStopCodes(stops, stnInfoMap) {
  return stops.filter(s => s.stop !== false)
    .map(s => { const i = stnInfoMap[traStnKey(s.name)]; return (i && i.id) || null; });
}
```

- [ ] **Step 4: 跑測試，確認通過**

```bash
node scripts/verify_la_stamap.mjs
```

預期：`總計 7 項, FAIL 0`。T1 應印 `244/244`，T2 最大偏差約 `0.182km`，T3 兩項都是「屏東」，T4 應是 998 車次、空 0 個。

- [ ] **Step 5: 突變測試（判準有沒有牙）**

三發，每發改完跑一次測試、確認**指定那幾項**變紅，然後還原：

| 突變 | 預期變紅 |
|---|---|
| `traStnKey` 拿掉 `.replace(/臺/g,'台')` | T1（缺 6 個臺字站） |
| `traStnKey` 的括號規則改成 `.replace(/-環島$/,'')` | T1（台北-環島 對不上） |
| `buildStaMap` 的迴圈改成由前往後 | T3a／T3b |

> 三發都要真的跑。若某發沒讓預期的項目變紅，代表那條斷言沒有牙，要先修判準再繼續。

- [ ] **Step 6: 確認既有回歸沒破**

```bash
node scripts/verify_live_activity.mjs
```

預期：既有 15 組全 PASS（本 Task 只新增函式，不動任何既有路徑）。

- [ ] **Step 7: Commit**

```bash
git diff --stat index.html
git add index.html scripts/verify_la_stamap.mjs
git diff --cached --stat
git commit -m "feat(LA): 站名→站碼正規化與 staMap 建構

跟車即時動態要讓後端用 TrainLiveBoard 的 StationID 認出「車現在到哪一站」,
但班表 stops 只有站名、沒有站碼,中間需要一張對照表。

traStnKey 處理兩件事:臺→台(stnInfoMap 的鍵一律用台),以及剝尾端括號註記
(左營(舊城)→左營、新城 (太魯閣)→新城)。不可剝「-環島」——台北-環島 1001
與台北 1000 是不同站碼。

buildStaMap 涵蓋通過站,所以快車經過不停靠的小站也認得出來;
驗收含座標守門(別名守門用座標不用名稱不撞)與三發突變測試。"
git show --numstat HEAD
```

---

## Task 2：iOS 推播能力與 push token 通道

**Files:**
- Modify: `app/ios/App/App/App.entitlements`
- Modify: `app/ios/App/RailBoardWidget/RailBoardWidgetExtension.entitlements`
- Modify: `app/ios/App/App/RailLiveActivityPlugin.swift`

**Interfaces:**
- Produces: Capacitor 事件 `pushToken`，payload `{ token: String (hex), key: String }`

> `key` 是前端傳進 `start` 的識別字串（格式 `<sys>#<trainNo>`），原樣回傳，供 JS 判斷這個 token 屬於哪張卡。

- [ ] **Step 1: 兩份 entitlements 補推播能力**

兩檔各在 `<dict>` 內加：

```xml
<key>aps-environment</key>
<string>development</string>
```

> 送審／TestFlight 時 Xcode 會自動換成 `production`，這裡寫 `development` 是開發期的值。

- [ ] **Step 2: plugin 改成申請 push token**

`RailLiveActivityPlugin.swift`：class 內加一個欄位，與 `current`／`chain` 並列。

```swift
private var tokenTask: Task<Void, Never>?
```

`endAll()` 開頭加一行（**必須在 `current = nil` 之前**，讓舊卡的 token 監聽先停）：

```swift
tokenTask?.cancel(); tokenTask = nil
```

`start` 的 `Activity.request` 改成帶 `pushType`，並在成功後掛上監聽：

```swift
let act = try Activity.request(
    attributes: attrs,
    content: .init(state: st, staleDate: Date().addingTimeInterval(8 * 3600)),
    pushType: .token          // 🔴 少了這個參數就拿不到 token,卡片只能靠前景更新
)
self.current = act
// pushTokenUpdates 是 AsyncSequence,token 會【多次】輪替,不是拿一次就結束。
// 這條 Task 的生命週期綁在 endAll()——換車時先 cancel,否則舊卡的 token 會被當成新卡的送上去。
let key = call.getString("key") ?? ""
self.tokenTask = Task { @MainActor in
    for await data in act.pushTokenUpdates {
        let hex = data.map { String(format: "%02x", $0) }.joined()
        self.notifyListeners("pushToken", data: ["token": hex, "key": key])
    }
}
call.resolve(["ok": true])
```

> **開卡不等 token。** `call.resolve` 立刻回，token 之後才透過事件送出。
> token 永遠不來（權限關閉／模擬器）時卡片照開，行為與現在完全相同。

- [ ] **Step 3: 編譯**

```bash
cd app/ios/App && xcodebuild -workspace App.xcworkspace -scheme App -sdk iphoneos -configuration Debug build CODE_SIGNING_ALLOWED=NO 2>&1 | tail -5
```

預期：`** BUILD SUCCEEDED **`。

> `pushTokenUpdates` 需要 iOS 16.2+。`start` 已被 `guard #available(iOS 17.6, *)` 包住，所以不需要再加版本判斷；若編譯器仍抱怨，檢查那個 guard 是否還在。

- [ ] **Step 4: 真機驗證拿得到 token**

**模擬器拿不到 push token，這一步只能用真 iPhone。**

接上真機跑起 App → 跟任一台車 → Xcode Console 應出現 `pushToken` 事件、`token` 是 64 碼十六進位字串。

若沒出現，依序檢查：(a) 裝置設定 → 軌島 → 即時動態是否開啟；(b) App ID 是否已勾 Push（Task 0 Step 2）；(c) entitlements 是否真的進了 build（`codesign -d --entitlements - <App路徑>`）。

- [ ] **Step 5: Commit**

```bash
git add app/ios/App/App/App.entitlements app/ios/App/RailBoardWidget/RailBoardWidgetExtension.entitlements app/ios/App/App/RailLiveActivityPlugin.swift
git diff --cached --stat
git commit -m "feat(LA): 開啟推播能力並把 push token 送回 JS

Activity.request 加 pushType:.token,並用 pushTokenUpdates 監聽 token
(它是 AsyncSequence、token 會多次輪替,不是一次性 callback)。

tokenTask 的取消放在 endAll() 開頭、current=nil 之前——換車時若不先停掉,
舊卡的 token 會被當成新卡的送上去,推到一張已經收掉的卡。

開卡不等 token:start 照舊立刻 resolve,拿不到 token 就退化成現有的純前景行為。"
```

---

## Task 3：橋接事件與前端交班

**Files:**
- Modify: `app/src/native-bridge.mjs`（`RAIL_NATIVE_LIVEACTIVITY` 區塊，約 24 行）
- Modify: `index.html`（`laSync` 區塊）
- Modify: `scripts/verify_live_activity.mjs`（追加案例）

**Interfaces:**
- Consumes: Task 1 的 `buildStaMap` / `buildStopCodes`；Task 2 的 `pushToken` 事件
- Produces: `POST /api/la/bind`、`POST /api/la/unbind` 的請求（端點由 Task 4 實作）

- [ ] **Step 1: 橋接暴露 addListener**

`app/src/native-bridge.mjs` 的 `window.RAIL_NATIVE_LIVEACTIVITY` 物件加一支：

```js
addListener: (ev, cb) => RailLiveActivity.addListener(ev, cb),
```

- [ ] **Step 2: 寫失敗的測試**

在 `scripts/verify_live_activity.mjs` 的假橋接（`addInitScript` 內）加上事件模擬能力：

```js
    // 假橋接補上事件通道:讓測試能模擬原生端送回 push token
    window.__laListeners = {};
    window.RAIL_NATIVE_LIVEACTIVITY.addListener = (ev, cb) => {
      (window.__laListeners[ev] = window.__laListeners[ev] || []).push(cb);
      return Promise.resolve({ remove: () => {} });
    };
    window.__laEmit = (ev, payload) => (window.__laListeners[ev] || []).forEach(f => f(payload));
    // 攔截 bind/unbind 的網路請求,記錄下來(不真的打後端)
    window.__laBindCalls = [];
    const _fetch = window.fetch;
    window.fetch = (u, o) => {
      const s = String(u);
      if (s.includes('/api/la/')) {
        window.__laBindCalls.push({ url: s, body: o && o.body ? JSON.parse(o.body) : null });
        return Promise.resolve(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return _fetch(u, o);
    };
```

在檔尾追加四組案例：

```js
// T14 收到 token → 送出 bind,payload 含四個必要欄位
{
  const page = await boot(chromium, { plus: true });
  await page.evaluate(() => followTrainNo('554', { sys: 'tra_sched' }));
  await page.waitForFunction(() => (window.__laCalls || []).some(c => c.m === 'start'), null, { timeout: 15000 });
  const key = await page.evaluate(() => window.__laCalls.find(c => c.m === 'start').p.sys + '#' + window.__laCalls.find(c => c.m === 'start').p.trainNo);
  await page.evaluate(k => window.__laEmit('pushToken', { token: 'deadbeef'.repeat(8), key: k }), key);
  await page.waitForFunction(() => (window.__laBindCalls || []).length > 0, null, { timeout: 10000 });
  const b = await page.evaluate(() => window.__laBindCalls[0]);
  ok('T14a token 到達後送出 bind', /\/api\/la\/bind$/.test(b.url), b.url);
  ok('T14b bind payload 四欄齊備',
     !!(b.body && b.body.token && b.body.trainNo && Array.isArray(b.body.stops) && b.body.staMap && Array.isArray(b.body.stopCodes)),
     JSON.stringify(Object.keys(b.body || {})));
  const nowS = Math.floor(Date.now() / 1000);
  ok('T14c stops 帶的是【絕對 epoch】且遞增',
     b.body.stops.length > 1
     && b.body.stops.every(s => Number.isFinite(s.at) && Math.abs(s.at - nowS) < 86400)
     && b.body.stops.every((s, i) => i === 0 || s.at > b.body.stops[i - 1].at),
     `${b.body.stops.length} 站,首站 at=${b.body.stops[0].at}(now=${nowS})`);
  await page.context().close();
}

// T14d 跨午夜車次:arrSec 超過 86400 的班次,換算出來的 at 仍在「現在前後一天內」
// (若用「台北今日午夜＋arrSec」的算法,這裡會整整差一天——這條就是為了 gate 那個做法)
{
  const page = await boot(chromium, { plus: true });
  const cross = await page.evaluate(() => {
    const sys = state.systems.find(s => s.id === 'tra_sched');
    const t = (sys.data.trains || []).find(x => (x.stops || []).some(s => s.arrSec > 86400));
    return t ? String(t.train) : null;
  });
  if (!cross) { ok('T14d 跨午夜車次換算正確', true, '今日班表無跨午夜車次,略過'); }
  else {
    await page.evaluate(no => followTrainNo(no, { sys: 'tra_sched' }), cross);
    await page.waitForFunction(() => (window.__laCalls || []).some(c => c.m === 'start'), null, { timeout: 15000 });
    const k = await page.evaluate(() => { const s = window.__laCalls.find(c => c.m === 'start').p; return s.sys + '#' + s.trainNo; });
    await page.evaluate(kk => window.__laEmit('pushToken', { token: 'dd'.repeat(32), key: kk }), k);
    await page.waitForFunction(() => (window.__laBindCalls || []).length > 0, null, { timeout: 10000 });
    const bb = await page.evaluate(() => window.__laBindCalls[0].body);
    const n2 = Math.floor(Date.now() / 1000);
    const worst = Math.max(...bb.stops.map(s => Math.abs(s.at - n2)));
    ok('T14d 跨午夜車次換算正確', worst < 86400, `車次 ${cross},最遠一站距現在 ${(worst / 3600).toFixed(1)} 小時`);
  }
  await page.context().close();
}

// T15 key 不符的 token 被丟掉(換車競態)——負向斷言,配 T14 當正向對照
{
  const page = await boot(chromium, { plus: true });
  await page.evaluate(() => followTrainNo('554', { sys: 'tra_sched' }));
  await page.waitForFunction(() => (window.__laCalls || []).some(c => c.m === 'start'), null, { timeout: 15000 });
  await page.evaluate(() => window.__laEmit('pushToken', { token: 'aa'.repeat(32), key: 'tra_sched#9999' }));
  await page.waitForTimeout(600);
  const n = await page.evaluate(() => window.__laBindCalls.length);
  ok('T15 key 不符的 token 不送 bind', n === 0, `bind 呼叫 ${n} 次(T14 證明同一支記錄器抓得到)`);
  await page.context().close();
}

// T16 停止跟車 → 送出 unbind
{
  const page = await boot(chromium, { plus: true });
  await page.evaluate(() => followTrainNo('554', { sys: 'tra_sched' }));
  await page.waitForFunction(() => (window.__laCalls || []).some(c => c.m === 'start'), null, { timeout: 15000 });
  const key = await page.evaluate(() => { const s = window.__laCalls.find(c => c.m === 'start').p; return s.sys + '#' + s.trainNo; });
  await page.evaluate(k => window.__laEmit('pushToken', { token: 'bb'.repeat(32), key: k }), key);
  await page.waitForFunction(() => window.__laBindCalls.length > 0, null, { timeout: 10000 });
  await page.evaluate(() => clearFollow());
  await page.waitForFunction(() => window.__laBindCalls.some(c => /unbind$/.test(c.url)), null, { timeout: 10000 });
  ok('T16 停止跟車送出 unbind', true);
  await page.context().close();
}

// T17 未訂閱者不送 bind(負向,對照 T14)
{
  const page = await boot(chromium, { plus: false });
  await page.evaluate(() => followTrainNo('554', { sys: 'tra_sched' }));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__laEmit('pushToken', { token: 'cc'.repeat(32), key: 'tra_sched#554' }));
  await page.waitForTimeout(600);
  const n = await page.evaluate(() => window.__laBindCalls.length);
  ok('T17 未訂閱者零 bind', n === 0, `bind 呼叫 ${n} 次`);
  await page.context().close();
}
```

- [ ] **Step 3: 跑測試，確認失敗**

```bash
node scripts/verify_live_activity.mjs
```

預期：既有 15 組 PASS，新增的 T14–T17 FAIL（`__laBindCalls` 恆為空，因為還沒實作）。

- [ ] **Step 4: 寫最小實作**

`index.html` 的 `laStop()` **下方**插入：

```js
// 跟車即時動態的後端交班。前端只交【表定】時刻與站碼映射,誤點由後端每分鐘自己算——
// 這樣這張表永不過期(鎖屏時前端也重傳不了),而 offset 是後端唯一的動態量。
let _laBound = '';                     // 已交班的 key,避免同一台車重複 bind
function laBind(token, key, tr) {
  // 把表定 arrSec(自服務日午夜起算)換成【絕對 epoch 秒】,後端就完全不必碰時區與服務日。
  // 錨點取「卡片此刻正在顯示的那一站」——它距現在幾分鐘,nextStopInfo 已經算出來了;
  // 其餘各站用 arrSec 差值平移。這樣跨午夜車次(arrSec > 86400)也天然正確,
  // 不需要猜「這班車屬於哪個服務日」——那個猜法會在 00:00-04:00 整整錯開一天。
  const t = state.simSec;              // 與 laPayload 用同一個時間來源,不要另取
  const ref = nextStopInfo(tr, t);
  if (!ref) return;                    // 已過終點:沒有下一站可推,不交班
  const originSec = Math.floor(Date.now() / 1000) - (t + ref.min * 60);   // arrSec → epoch 的常數位移
  const stops = tr.stops.filter(s => s.stop !== false)
    .map(s => ({ name: s.name, at: Math.round(originSec + s.arrSec) }));
  fetch(apiUrl('api/la/bind'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token, sys: String(tr.sys || ''), trainNo: String(tr.train || ''),
      stops, staMap: buildStaMap(tr.stops, state.stnInfoMap || {}),
      stopCodes: buildStopCodes(tr.stops, state.stnInfoMap || {}),
    }),
  }).then(() => { _laBound = key; }).catch(() => {});   // 失敗靜默:卡片仍是 LA-0 行為,不是壞掉
}
function laUnbind() {
  if (!_laBound) return;               // 沒交過班就不送,未訂閱者每秒走到這裡不該打後端
  _laBound = '';
  fetch(apiUrl('api/la/unbind'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: _laToken }),
  }).catch(() => {});
}
```

`laStop(api)` 內、`_laLast = 0; _laKey = '';` 那行**之前**插入一行：

```js
  laUnbind();
```

在 `laSync` 的 `const api = window.RAIL_NATIVE_LIVEACTIVITY;` 之後，掛一次性的事件監聽：

```js
  if (!_laListening && api.addListener) {
    _laListening = true;
    api.addListener('pushToken', ({ token, key }) => {
      // 🔴 比對 key:換車很快時 token 回來的可能是【舊卡】的,推到已收掉的卡上
      //    (與既有 start 回呼那條「比較新的那張卡不能被舊的失敗回呼清掉」同一個思路)
      if (key !== _laKey || !liveActivityAllowed()) return;
      _laToken = token;
      if (state.followTrain) laBind(token, key, state.followTrain);
    });
  }
```

檔案上方 `let _laLast = 0, _laKey = '', _laDead = false;` 那行改成：

```js
let _laLast = 0, _laKey = '', _laDead = false, _laListening = false, _laToken = '';
```

並在 `api.start(p)` 的呼叫 payload 加上 `key`（原生端要原樣回傳）：`laPayload` 的 return 物件加一欄 `key: p.sys + '#' + p.trainNo` —— 實作時直接在 `laSync` 內組好再傳：

```js
    _laKey = key; _laLast = now;
    Promise.resolve(api.start(Object.assign({ key }, p))).then(r => {
```

- [ ] **Step 5: 跑測試，確認通過**

```bash
node scripts/verify_live_activity.mjs
```

預期：`FAIL 0`，既有 15 組 + 新增 7 條斷言（T14a/b/c/d、T15、T16、T17）全數 PASS。

- [ ] **Step 6: 突變測試**

| 突變 | 預期變紅 |
|---|---|
| `pushToken` 回呼拿掉 `if (key !== _laKey ...) return` | T15 |
| `laBind` 的 body 拿掉 `stopCodes` | T14b |
| `at` 改成用「台北今日午夜 + arrSec」（`Math.floor(Date.now()/1000) - nowSecOfDay() + s.arrSec`） | **T14d**（T14c 對非跨午夜車次仍會過——這正是為什麼要有 T14d） |
| `laStop` 拿掉 `laUnbind()` | T16 |
| `pushToken` 回呼拿掉 `!liveActivityAllowed()` 那半 | T17 |

五發都要真的跑並還原。第三發若讓 T14c 也變紅，代表 T14c 的窗開得太窄，先修判準。

> 若當日班表恰好沒有跨午夜車次（T14d 會印「略過」），**第三發突變就無法驗證**。
> 這時改用手工資料驗 `laBind` 的換算：在 console 餵一個 `arrSec > 86400` 的假 `tr`，
> 確認算出的 `at` 落在現在前後一天內。不要因為「今天沒樣本」就跳過這個維度。

- [ ] **Step 7: Commit**

```bash
git diff --stat index.html app/src/native-bridge.mjs
git add index.html app/src/native-bridge.mjs scripts/verify_live_activity.mjs
git diff --cached --stat
git commit -m "feat(LA): 橋接事件通道與後端交班

原生端拿到 push token 後透過 Capacitor 事件送回 JS,前端比對 key
(換車很快時回來的可能是舊卡的 token)後,把【表定】時刻表與站碼映射交給後端。

交表定而非交「已套誤點」的時刻是刻意的:這張表永不過期,鎖屏時前端也重傳不了;
誤點由後端每分鐘自己算,是唯一的動態量。

驗收新增 T14-T17 四組(含兩條負向斷言各配正向對照),四發突變全數確認有牙。"
```

---

## Task 4：Worker 的 D1 表與交班端點

**Files:**
- Create: `schema/0003_live_activity.sql`
- Create: `scripts/verify_la_backend.mjs`
- Modify: `worker.js`（`API_POST_ALLOWED` 2387、`API_ENDPOINTS` 2390、dispatch 3868、`stationEvents` 下方）
- Modify: `wrangler.jsonc`（只加一顆 rate limiter）

**Interfaces:**
- Consumes: Task 3 送出的 bind／unbind 請求
- Consumes（既有，簽名照抄不要改）：
  - `jsonRes(obj, status, cc)` — `worker.js:87`
  - `rateLimited(limiter, request, failClosed)` — `worker.js:1360`，寫入端點一律傳 `true`
  - `checkPlusEntitlement(request, env)` — `worker.js:1908`，**吃整個 request 不是 token**；
    回 `{ ok, status, error, uid, subscriptions, ... }`，`ok===false` 時看 `status`（401／403／503）
- Produces: D1 表 `la_bindings`；供 Task 6 讀取的資料列

> **為什麼放 `DELAY_DB` 而不另開一個 database：** 這張表要跟 `tra_station_events` 同庫，
> Task 6 之後若要做「推播準不準」的回溯分析得 JOIN 它們。`DELAY_DB` 的權威建表法是
> `schema/000N_*.sql` 檔（`schema/README.md` 明文：「不要再用 wrangler d1 execute --command 手打 DDL」），
> **不是** `TRTC_LEDGER` 那套 runtime `ensureXxx()`。兩套慣例在這個 repo 真實並存，本 Task 選前者。

- [ ] **Step 1: 建立 schema 檔**

`schema/0003_live_activity.sql`：

```sql
-- 跟車即時動態(Live Activity)的推播交班表。
-- 一列 = 一張正在鎖屏上跑的卡。token 是 APNs device token,天然唯一。
-- stops/sta_map/stop_codes 存前端交來的【表定】資料(JSON 字串),永不過期;
-- last_idx/last_delay 是後端每分鐘更新的狀態,用來判斷「有沒有變、要不要推」。
CREATE TABLE IF NOT EXISTS la_bindings (
  token       TEXT PRIMARY KEY,
  uid         TEXT NOT NULL,
  sys         TEXT NOT NULL,
  train_no    TEXT NOT NULL,
  stops       TEXT NOT NULL,
  sta_map     TEXT NOT NULL,
  stop_codes  TEXT NOT NULL,
  last_idx    INTEGER NOT NULL DEFAULT -1,
  last_delay  INTEGER NOT NULL DEFAULT 0,
  bound_at    INTEGER NOT NULL,
  expire_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_la_expire ON la_bindings(expire_at);
```

`scripts/d1_local.mjs` 會把 `schema/*.sql` 依檔名排序全部執行，所以本機測試自動吃得到這個檔，
不需要額外註冊。**套到正式庫是上線步驟（Task 8），不在本 Task 內。**

- [ ] **Step 2: 寫失敗的測試**

建立 `scripts/verify_la_backend.mjs`（Task 5、6 會繼續往裡面加）：

```js
// LA 後端驗收。本檔【不打正式站】,一律對本機 wrangler dev 跑。
// 起 server 的指令見計畫 Task 4 Step 3;埠由呼叫端指定並傳進 LA_BASE。
const BASE = process.env.LA_BASE;
if (!BASE) { console.error('請設 LA_BASE=http://localhost:<port>'); process.exit(2); }
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
```

- [ ] **Step 3: 跑測試，確認失敗**

先建本機測試用的 `.dev.vars`（**已被 `.gitignore` 排除，不會進版控**）：

```bash
printf 'LA_TEST_BEARER=LA-LOCAL-TEST\n' >> .dev.vars
```

起 server 並跑：

```bash
arch -arm64 node ./node_modules/wrangler/bin/wrangler.js dev --local --port 8799
```

```bash
LA_BASE=http://localhost:8799 node scripts/verify_la_backend.mjs
```

預期：B0–B8 全 FAIL（端點還不存在，`/api/la/bind` 會被 assets fallback 接走）。

> **關於 `LA_TEST_BEARER` 這個測試旁路：** 它是**具名的兩側閘門**——設了才開、且只認那個確切的值。
> 正式環境不設這顆 secret，所以旁路根本不存在；B1／B2 驗的是真的拒絕行為，B0 是它們的正向對照。
> 這比「靠某顆 secret 沒設來推斷是不是本機」可靠，那種寫法在 secret 順序變動時會靜默開門。

- [ ] **Step 4: 寫實作**

**(a)** `worker.js:2387` 的 `API_POST_ALLOWED` 加兩條（**漏這步會全部被擋成 405，B0 永遠紅**）：

```js
const API_POST_ALLOWED = new Set(['/api/account-delete', '/api/bounty-claim', '/api/bounty-submit', '/api/bounty-merge', '/api/revenuecat-webhook', '/api/la/bind', '/api/la/unbind']);
```

**(b)** `worker.js:2390` 的 `API_ENDPOINTS` 加兩條（埋點用，路徑是 `pathname.slice(5)`）：

```js
  'bounty-board', 'bounty-claim', 'bounty-submit', 'bounty-me', 'bounty-merge', 'plus-status', 'revenuecat-webhook',
  'la/bind', 'la/unbind',
```

**(c)** `wrangler.jsonc` 的 `unsafe.bindings` 加第六顆（`namespace_id` 取下一個號；`period` 只接受 10 或 60）：

```jsonc
      { "name": "LA_LIMITER", "type": "ratelimit", "namespace_id": "1006", "simple": { "limit": 20, "period": 60 } },
```

**(d)** `worker.js` 的 `stationEvents` 函式**下方**加兩支端點：

```js
// ── 跟車即時動態:交班與註銷 ──
// 端點外部可打,限流擋在任何 D1 寫入之前(照本檔慣例,寫入型一律 failClosed=true)。
async function laBind(request, env) {
  if (await rateLimited(env.LA_LIMITER, request, true)) return jsonRes({ error: 'rate_limited' }, 429, 'no-store');
  let b;
  try { b = await request.json(); } catch (e) { return jsonRes({ error: 'bad_json' }, 400, 'no-store'); }
  if (!b) return jsonRes({ error: 'bad_json' }, 400, 'no-store');
  if (!/^[0-9a-f]{64}$/.test(String(b.token || ''))) return jsonRes({ error: 'bad_token' }, 400, 'no-store');
  if (b.sys !== 'tra_sched' && b.sys !== 'thsr_sched') return jsonRes({ error: 'bad_sys' }, 400, 'no-store');
  if (!/^[0-9A-Za-z]{1,8}$/.test(String(b.trainNo || ''))) return jsonRes({ error: 'bad_train' }, 400, 'no-store');
  if (!Array.isArray(b.stops) || !b.stops.length || b.stops.length > 200) return jsonRes({ error: 'bad_stops' }, 400, 'no-store');
  // at 是絕對 epoch 秒,且必須落在現在前後一天內——擋掉「服務日算錯整整差一天」那類壞資料,
  // 否則後端會安靜地推出一張倒數 23 小時的卡。
  const nowSec = Math.floor(Date.now() / 1000);
  if (!b.stops.every(s => s && typeof s.name === 'string' && Number.isFinite(Number(s.at))
      && Math.abs(Number(s.at) - nowSec) < 86400))
    return jsonRes({ error: 'bad_stops' }, 400, 'no-store');
  if (!Array.isArray(b.stopCodes) || b.stopCodes.length !== b.stops.length) return jsonRes({ error: 'bad_codes' }, 400, 'no-store');
  if (!b.staMap || typeof b.staMap !== 'object' || Array.isArray(b.staMap)) return jsonRes({ error: 'bad_map' }, 400, 'no-store');

  // 具名的本機測試閘門:設了才開,且只認那個確切的值。正式環境不設這顆 secret ⇒ 這條路徑不存在。
  const auth = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  let uid;
  if (env.LA_TEST_BEARER && auth && auth[1] === env.LA_TEST_BEARER) uid = 'local-test';
  else {
    const check = await checkPlusEntitlement(request, env);
    if (!check.ok) return jsonRes({ error: check.error }, check.status, 'no-store');
    uid = check.uid;
  }
  try {
    const now = Math.floor(Date.now() / 1000);
    await env.DELAY_DB.prepare(
      'INSERT INTO la_bindings (token,uid,sys,train_no,stops,sta_map,stop_codes,last_idx,last_delay,bound_at,expire_at)' +
      ' VALUES (?,?,?,?,?,?,?,-1,0,?,?) ON CONFLICT(token) DO UPDATE SET' +
      ' uid=excluded.uid, sys=excluded.sys, train_no=excluded.train_no, stops=excluded.stops,' +
      ' sta_map=excluded.sta_map, stop_codes=excluded.stop_codes, last_idx=-1, last_delay=0,' +
      ' bound_at=excluded.bound_at, expire_at=excluded.expire_at'
    ).bind(String(b.token), uid, String(b.sys), String(b.trainNo),
      JSON.stringify(b.stops), JSON.stringify(b.staMap), JSON.stringify(b.stopCodes),
      now, now + 8 * 3600).run();
    return jsonRes({ ok: true }, 200, 'no-store');
  } catch (e) {
    return jsonRes({ error: 'bind_failed' }, 503, 'no-store');
  }
}

async function laUnbind(request, env) {
  if (await rateLimited(env.LA_LIMITER, request, true)) return jsonRes({ error: 'rate_limited' }, 429, 'no-store');
  let b;
  try { b = await request.json(); } catch (e) { return jsonRes({ ok: true }, 200, 'no-store'); }
  // 冪等:不存在也回 200。註銷不另驗身分——APNs token 本身就是難以猜中的憑證,
  // 而誤刪的成本只是一張卡停止自動換站(退化成 LA-0 的前景行為),不是資料損失。
  if (b && /^[0-9a-f]{64}$/.test(String(b.token || ''))) {
    try { await env.DELAY_DB.prepare('DELETE FROM la_bindings WHERE token=?').bind(String(b.token)).run(); }
    catch (e) { /* 表還沒建或 D1 暫時不可用:回 200,前端沒有可做的補救 */ }
  }
  return jsonRes({ ok: true }, 200, 'no-store');
}
```

**(e)** dispatch 區（`/api/bounty-merge` 那行下方）加兩行：

```js
    else if (url.pathname === '/api/la/bind') res = await laBind(request, env);
    else if (url.pathname === '/api/la/unbind') res = await laUnbind(request, env);
```

- [ ] **Step 5: 跑測試，確認通過**

```bash
LA_BASE=http://localhost:8799 node scripts/verify_la_backend.mjs
```

預期：`總計 9 項, FAIL 0`。

- [ ] **Step 6: 突變測試**

| 突變 | 預期變紅 |
|---|---|
| `API_POST_ALLOWED` 拿掉 `/api/la/bind` | B0（變 405） |
| 拿掉 `checkPlusEntitlement` 那個 `else` 分支（無條件給 uid） | B1、B2 |
| 拿掉 `b.stops.every(...)` 整條 | B3、B6 |
| 只拿掉 `Math.abs(Number(s.at) - nowSec) < 86400` 那半 | **只有 B6**（證明 B3／B6 不是同一條斷言的兩個名字） |
| `b.sys !== 'tra_sched' && ...` 整條拿掉 | B5 |
| `laUnbind` 對不存在的 token 回 404 | B8 |

六發都要真的跑並還原。第四發是**判準獨立性**的檢查：兩條斷言若總是一起紅，其中一條就是裝飾。

- [ ] **Step 7: Commit**

```bash
git diff --stat worker.js wrangler.jsonc
git add worker.js wrangler.jsonc schema/0003_live_activity.sql scripts/verify_la_backend.mjs
git diff --cached --stat
git commit -m "feat(LA): D1 交班表與 bind/unbind 端點

la_bindings 存 push token 與該班車的表定時刻表、站碼映射。
建表走 schema/0003_*.sql——DELAY_DB 的權威做法(schema/README.md 明文禁止手打 DDL),
不是 TRTC_LEDGER 那套 runtime ensureXxx();選它是因為之後要與 tra_station_events 同庫 JOIN。

bind 驗 Plus entitlement 並掛 fail-closed 限流(寫入端點的既有慣例);
unbind 冪等且不另驗身分——APNs token 本身就是憑證,誤刪成本只是一張卡退回前景行為。

新端點的三處註冊都補齊了(dispatch／API_POST_ALLOWED／API_ENDPOINTS),
其中 API_POST_ALLOWED 漏掉會被方法白名單靜默擋成 405,故 B6 專門 gate 這件事。"
git show --numstat HEAD
```

---

## Task 5：換站決策與降級（純函式）

**Files:**
- Create: `scripts/la_push_core.mjs`
- Modify: `worker.js`（頂部 import）
- Modify: `scripts/verify_la_backend.mjs`

**Interfaces:**
- Produces（皆由 `scripts/la_push_core.mjs` 匯出）：
  - `laNextIdx(sta, status, staMap, stopCodes, lastIdx) → number` — 有即時觀測時，該顯示第幾站
  - `laSchedIdx(stops, delaySec, nowSec, lastIdx) → number` — 沒有觀測時的表定退路
  - `laArrivalIso(atSec, delaySec, nowSec) → string | null` — 到站時刻，已過回 `null`

> **為什麼獨立成檔而不放 worker.js：** 測試要能 `import` 它直接測邏輯，而 `worker.js` 有 top-level import
> 與 Worker-only 的相依，從 Node 直接 import 不可靠。專案既有做法就是這樣——`worker.js:2` 從
> `scripts/trtc_board_ledger.mjs` import `TRTC_LEDGER_SCHEMA`。照抄那個型態，不要自創第三種。
>
> 這支刻意做成無副作用的純函式，才驗得動。cron（Task 6）只負責餵資料與推播。

- [ ] **Step 1: 寫失敗的測試**

`scripts/verify_la_backend.mjs` 追加（**檔案頂部**加 import，其餘接在 B 系列之後）：

```js
// N 系列:換站決策純函式。不經 HTTP,直接測邏輯。
import { laNextIdx, laSchedIdx, laArrivalIso } from './la_push_core.mjs';
const MAP = { '5050': 1, '5040': 1, '5030': 1, '5000': 2 };   // 潮州→1, 竹田/西勢(通過)→1, 屏東→2
const CODES = ['5050', '5000', '4340'];                        // 停靠站:潮州(0) 屏東(1) 新左營(2)
const nx = (...a) => laNextIdx(...a);

ok('N1 已離站(status2)→下一個停靠站', nx('5050', 2, MAP, CODES, -1) === 1, String(nx('5050', 2, MAP, CODES, -1)));
ok('N2 進站中(status0)且該站是停靠站→就是它自己', nx('5050', 0, MAP, CODES, -1) === 0, String(nx('5050', 0, MAP, CODES, -1)));
// N3 是設計書 §8 明列的案例:在站上仍顯示該站(月台顯示器語意),不是提前翻到下一站
ok('N3 在站上(status1)且該站是停靠站→仍是它自己', nx('5050', 1, MAP, CODES, -1) === 0, String(nx('5050', 1, MAP, CODES, -1)));
ok('N4 通過站不論 status 都走映射', nx('5040', 0, MAP, CODES, -1) === 1, String(nx('5040', 0, MAP, CODES, -1)));
ok('N5 單調閘門:回報較早的站不倒退', nx('5050', 2, MAP, CODES, 2) === 2, String(nx('5050', 2, MAP, CODES, 2)));
ok('N6 認不出的站碼→維持現狀', nx('9999', 2, MAP, CODES, 1) === 1, String(nx('9999', 2, MAP, CODES, 1)));
ok('N7 終點之後(映射無值)→維持現狀', nx('4340', 2, MAP, CODES, 2) === 2, String(nx('4340', 2, MAP, CODES, 2)));

// ── 車不在 feed 的退路:必須【繼續前進】,不是凍住(設計書 §6) ──
const T0 = 1_800_000_000;
const SCH = [{ at: T0 + 600 }, { at: T0 + 1800 }, { at: T0 + 3600 }];
ok('N8 表定推進:第一站還沒到 → idx 0', laSchedIdx(SCH, 0, T0, -1) === 0, String(laSchedIdx(SCH, 0, T0, -1)));
ok('N9 表定推進:第一站已過 → 前進到 idx 1', laSchedIdx(SCH, 0, T0 + 900, 0) === 1, String(laSchedIdx(SCH, 0, T0 + 900, 0)));
ok('N10 表定推進吃誤點:誤點 10 分 ⇒ 同一時刻仍在 idx 0', laSchedIdx(SCH, 600, T0 + 900, 0) === 0, String(laSchedIdx(SCH, 600, T0 + 900, 0)));
ok('N11 表定推進也守單調閘門', laSchedIdx(SCH, 0, T0, 2) === 2, String(laSchedIdx(SCH, 0, T0, 2)));
ok('N12 全部過完 → 回 stops.length(呼叫端據此收卡)', laSchedIdx(SCH, 0, T0 + 9999, 0) === 3, String(laSchedIdx(SCH, 0, T0 + 9999, 0)));

// ── 到站時刻已過 → arrivalDate = nil(設計書 §6 那條吃掉交會待避/停站不更新的規則) ──
ok('N13 未到站 → 回 ISO 字串', laArrivalIso(T0 + 600, 0, T0) === new Date((T0 + 600) * 1000).toISOString(), String(laArrivalIso(T0 + 600, 0, T0)));
ok('N14 到站時刻已過 → 回 null', laArrivalIso(T0 + 600, 0, T0 + 601) === null, String(laArrivalIso(T0 + 600, 0, T0 + 601)));
ok('N15 誤點把到站推到未來 → 又回 ISO(不是永久 null)', typeof laArrivalIso(T0 + 600, 600, T0 + 700) === 'string', String(laArrivalIso(T0 + 600, 600, T0 + 700)));
```

- [ ] **Step 2: 跑測試，確認失敗**

```bash
LA_BASE=http://localhost:8799 node scripts/verify_la_backend.mjs
```

預期：整支在 import 就爆（`Cannot find module './la_push_core.mjs'`），N1–N15 一條都跑不到。

- [ ] **Step 3: 寫實作**

建立 `scripts/la_push_core.mjs`：

```js
// 跟車即時動態的純邏輯。獨立成檔的理由:測試要能直接 import,而 worker.js 從 Node import 不可靠。
// 型態照抄 scripts/trtc_board_ledger.mjs(worker.js:2 就是這樣吃它的)。

// 「現在該顯示第幾個停靠站」。純函式,無副作用——這是唯一決定卡片站名的邏輯,必須驗得動。
// sta/status 來自 TDX TrainLiveBoard,語意(Swagger 原文):
//   TrainStationStatus = [0:'進站中', 1:'在站上', 2:'已離站']
//   StationID =「列車目前所在之車站」,且【含通過不停靠站】
export function laNextIdx(sta, status, staMap, stopCodes, lastIdx) {
  let idx;
  const own = stopCodes.indexOf(sta);
  // 進站中(0)或在站上(1)且該站是停靠站 ⇒ 車還沒離開它,卡片就顯示它。
  // 這正是月台顯示器的語意:進站中「下一站 潮州」、停靠中仍是潮州、離站後才翻成屏東。
  // 通過站不適用(own = -1),不論什麼 status 都走映射表。
  if ((status === 0 || status === 1) && own >= 0) idx = own;
  else idx = staMap[sta];
  if (idx == null) return lastIdx;              // 認不出來就維持現狀,不亂跳
  return Math.max(idx, lastIdx);                // 單調閘門:只進不退
}

// 車不在即時 feed 時的退路(支線 92 站無觀測)。純表定推進:表定到站＋最後已知誤點已過 ⇒ 那站算過了。
// 精度會下降,但卡片【仍然前進】——凍住不動比慢一兩分鐘更糟,使用者會直接認定功能壞了。
// 回傳值可能等於 stops.length(全部過完),呼叫端據此收卡。
export function laSchedIdx(stops, delaySec, nowSec, lastIdx) {
  for (let i = 0; i < stops.length; i++)
    if (stops[i].at + delaySec > nowSec) return Math.max(i, lastIdx);
  return Math.max(stops.length, lastIdx);
}

// 到站時刻 → 卡片上的 arrivalDate。【已過就回 null】,讓 Widget 只畫站名不畫假倒數。
// 這一條同時吃掉交會待避、臨時停車、以及「車停在站上時 DelayTime 不更新」(CTC 是離站觸發)三種情況。
export function laArrivalIso(atSec, delaySec, nowSec) {
  const arrive = atSec + delaySec;
  return arrive > nowSec ? new Date(arrive * 1000).toISOString() : null;
}
```

`worker.js` 頂部的既有 import（第 2 行）下方加一行：

```js
import { laNextIdx, laSchedIdx, laArrivalIso } from './scripts/la_push_core.mjs';
```

- [ ] **Step 4: 跑測試，確認通過**

```bash
LA_BASE=http://localhost:8799 node scripts/verify_la_backend.mjs
```

預期：B0–B8 + N1–N15 全 PASS，共 24 項。

- [ ] **Step 5: 突變測試**

| 突變 | 預期變紅 |
|---|---|
| 拿掉 `Math.max(idx, lastIdx)`，直接 `return idx` | N5 |
| `(status === 0 \|\| status === 1)` 改成 `status === 2` | N1、N2、N3 |
| `(status === 0 \|\| status === 1)` 改成只留 `status === 0` | **只有 N3**（證明 N2／N3 不是同一條斷言） |
| `if (idx == null) return lastIdx` 改成 `return 0` | N6、N7 |
| `stopCodes.indexOf` 改成恆回 `-1` | N2、N3 |
| `laSchedIdx` 的 `+ delaySec` 拿掉 | N10 |
| `laSchedIdx` 全部過完時回 `lastIdx` 而不是 `stops.length` | N12 |
| `laArrivalIso` 的 `arrive > nowSec` 改成恆真 | N14 |
| `laArrivalIso` 的 `arrive > nowSec` 改成恆假 | N13、N15 |

九發都要跑。**若某發沒讓預期項目變紅，先修判準再繼續**——這幾支是整個功能唯一決定
「顯示哪一站、畫不畫倒數」的地方，判準沒牙等於沒驗。第三發與最後兩發是**判準獨立性**檢查。

- [ ] **Step 6: Commit**

```bash
git add worker.js scripts/la_push_core.mjs scripts/verify_la_backend.mjs
git diff --cached --stat
git commit -m "feat(LA): 換站決策三支純函式

卡片顯示哪一站、畫不畫倒數,全由這三支決定;刻意做成無副作用的純函式才驗得動,
放 scripts/ 而非 worker.js 是因為測試要能直接 import(照 trtc_board_ledger.mjs 的型態)。

laNextIdx:sta/status 語意依 TDX Swagger 原文(0=進站中、1=在站上、2=已離站),
StationID 官方明文含通過站。進站中或在站上仍顯示該站——月台顯示器的語意,
離站後才翻頁;單調閘門讓索引只進不退。

laSchedIdx:支線 92 站無即時觀測時的表定退路,卡片仍前進而不是凍住。
laArrivalIso:到站時刻已過就回 null,一條規則同時吃掉交會待避、臨時停車、
以及車停在站上時 DelayTime 不更新(CTC 是離站觸發)。

十五組驗收,九發突變全數確認有牙,含三發判準獨立性檢查。"
```

---

## Task 6：cron 推播與 APNs

**Files:**
- Modify: `scripts/la_push_core.mjs`（加 `laJwt`）
- Modify: `worker.js`（`laPushAll` + cron 掛載）
- Modify: `scripts/verify_la_backend.mjs`

**Interfaces:**
- Consumes: Task 5 的 `laNextIdx`；既有 `traLive(request, env, ctx)`（`worker.js:86`，
  內部呼叫的既有寫法見 `worker.js:407`）
- Produces: `laJwt(env) → Promise<string>`（`la_push_core.mjs`）、
  `laPushAll(env, ctx, baseUrl) → Promise<{sent, dropped}>`（`worker.js`）

**依賴 Task 0**（沒有 p8 金鑰無法完成 Step 5 之後）。

- [ ] **Step 1: 寫失敗的測試（JWT 簽章）**

`scripts/verify_la_backend.mjs` 追加：

```js
// J 系列:APNs JWT。只驗結構與可解性,不驗 Apple 會不會接受(那要真金鑰,見 Step 6)。
// 註:把 laJwt 併進檔案頂部那行既有的 import,不要另開一行。
{
  // 測試用的 EC P-256 金鑰(僅供本檔驗結構,不是任何真實憑證)
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8))).replace(/(.{64})/g, '$1\n');
  const fakeEnv = { APNS_KEY_P8: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----`, APNS_KEY_ID: 'ABC1234567', APNS_TEAM_ID: 'TEAM123456' };
  const jwt = await laJwt(fakeEnv);
  const [h, p, s] = String(jwt).split('.');
  const dec = x => JSON.parse(atob(x.replace(/-/g, '+').replace(/_/g, '/')));
  ok('J1 JWT 三段結構', !!(h && p && s), `len=${String(jwt).length}`);
  ok('J2 header alg=ES256 且帶 kid', dec(h).alg === 'ES256' && dec(h).kid === 'ABC1234567', JSON.stringify(dec(h)));
  ok('J3 payload iss=TeamID 且 iat 是現在', dec(p).iss === 'TEAM123456' && Math.abs(dec(p).iat - Math.floor(Date.now() / 1000)) < 60, JSON.stringify(dec(p)));
}
```

- [ ] **Step 2: 跑測試，確認失敗**

```bash
LA_BASE=http://localhost:8799 node scripts/verify_la_backend.mjs
```

預期：J1–J3 FAIL。

- [ ] **Step 3: 寫 JWT 實作**

加進 `scripts/la_push_core.mjs`（與 `laNextIdx` 並列）：

```js
// APNs 的 provider token(ES256 JWT)。Apple 規定至少 20 分鐘才可換新、最長 60 分鐘,
// 所以快取 50 分鐘——每次都重簽會被 Apple 當濫用擋掉。
let _laJwt = null, _laJwtAt = 0;
export async function laJwt(env) {
  const now = Math.floor(Date.now() / 1000);
  if (_laJwt && now - _laJwtAt < 3000) return _laJwt;
  const pem = String(env.APNS_KEY_P8).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const b64u = o => btoa(typeof o === 'string' ? o : JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const head = b64u({ alg: 'ES256', kid: String(env.APNS_KEY_ID) });
  const body = b64u({ iss: String(env.APNS_TEAM_ID), iat: now });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' },
    key, new TextEncoder().encode(`${head}.${body}`));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  _laJwt = `${head}.${body}.${sigB64}`; _laJwtAt = now;
  return _laJwt;
}
```

- [ ] **Step 4: 跑測試，確認通過**

```bash
LA_BASE=http://localhost:8799 node scripts/verify_la_backend.mjs
```

預期：J1–J3 PASS。

- [ ] **Step 5: 寫推播主迴圈**

`worker.js` 頂部 Task 5 那行 import 補上 `laJwt`：

```js
import { laNextIdx, laSchedIdx, laArrivalIso, laJwt } from './scripts/la_push_core.mjs';
```

然後在 `laUnbind` 下方加主迴圈：

```js
// 每分鐘掃一次所有未過期的交班,算出「現在該顯示哪一站」,變了才推。
// 讀 traLive 走既有雙層快取(與訪客共用)⇒ 零新增 TDX 呼叫。
async function laPushAll(env, ctx, baseUrl) {
  if (!env.APNS_KEY_P8 || !env.DELAY_DB) return { sent: 0, dropped: 0 };   // 未設定就整支不動
  const now = Math.floor(Date.now() / 1000);
  await env.DELAY_DB.prepare('DELETE FROM la_bindings WHERE expire_at < ?').bind(now).run();
  const rs = await env.DELAY_DB.prepare('SELECT * FROM la_bindings').all();
  const rows = rs.results || [];
  if (!rows.length) return { sent: 0, dropped: 0 };

  // 台鐵即時:整批共用一次
  let live = {};
  if (rows.some(r => r.sys === 'tra_sched')) {
    try {
      const r = await traLive(new Request(baseUrl + '/api/tra-live'), env, ctx);
      const j = await r.json();
      for (const t of (j.trains || [])) live[String(t.no)] = t;
    } catch (e) { /* 上游掛掉:live 留空,下面一律走 last_delay 的 fallback */ }
  }

  const jwt = await laJwt(env);
  let sent = 0, dropped = 0;
  for (const row of rows) {
    const stops = JSON.parse(row.stops), staMap = JSON.parse(row.sta_map), stopCodes = JSON.parse(row.stop_codes);
    const t = row.sys === 'tra_sched' ? live[String(row.train_no)] : null;
    // 誤點:拿得到就用,拿不到沿用最後已知值(不歸零——歸零會讓卡片跳)
    const delaySec = t ? (Number(t.delay) || 0) * 60 : row.last_delay;
    // 有觀測就用觀測(承重牆 1);沒有(支線 92 站缺口、高鐵、上游掛掉)就走表定退路,
    // 卡片【仍然前進】——凍住不動比慢一兩分鐘更糟。
    const idx = t ? laNextIdx(String(t.sta), Number(t.status), staMap, stopCodes, row.last_idx)
                  : laSchedIdx(stops, delaySec, now, row.last_idx);
    if (idx >= stops.length) {                            // 走完全程 → 收卡
      await env.DELAY_DB.prepare('DELETE FROM la_bindings WHERE token=?').bind(row.token).run();
      continue;
    }
    // 🔴 idx < 0 是「剛 bind、TDX 還沒回報過這台車」,不是走完了。
    //    把它併進上面那條會讓新卡在第一分鐘就被刪掉——不推也不收卡,下一分鐘再說。
    if (idx < 0) continue;
    if (idx === row.last_idx && delaySec === row.last_delay) continue;   // 沒變就不推

    const st = stops[idx];
    const prev = idx > 0 ? stops[idx - 1] : null;
    const body = {
      aps: {
        timestamp: now, event: 'update',
        'content-state': {
          nextStop: st.name,
          // st.at 已是絕對 epoch(前端換算好),後端零時區運算。
          // 到站時刻已過 ⇒ laArrivalIso 回 null,卡片只剩站名不畫假倒數。
          arrivalDate: laArrivalIso(st.at, delaySec, now),
          departedDate: prev ? new Date((prev.at + delaySec) * 1000).toISOString() : null,
          delaySec, terminus: stops[stops.length - 1].name,
        },
      },
    };
    // 🔴 開發 build(entitlements aps-environment=development)拿到的是 sandbox token,
    //    打 production host 一律回 400 BadDeviceToken。用 env 切,不要寫死。
    const host = env.APNS_HOST || 'api.push.apple.com';
    const res = await fetch(`https://${host}/3/device/${row.token}`, {
      method: 'POST',
      headers: {
        authorization: 'bearer ' + jwt,
        'apns-topic': 'tw.railisland.app.push-type.liveactivity',
        'apns-push-type': 'liveactivity',
        'apns-priority': '5',        // 5 不計入更新預算;不指定會是 10 且計入
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 410 || res.status === 400) {      // token 失效 → 清掉不再推
      await env.DELAY_DB.prepare('DELETE FROM la_bindings WHERE token=?').bind(row.token).run();
      dropped++; continue;
    }
    if (res.ok) {
      await env.DELAY_DB.prepare('UPDATE la_bindings SET last_idx=?, last_delay=? WHERE token=?')
        .bind(idx, delaySec, row.token).run();
      sent++;
    }
    // 其餘(429／5xx)：不更新 last_idx,下一分鐘自然重試
  }
  return { sent, dropped };
}
```

> **後端沒有任何時區運算**，因為 `stops[].at` 在 Task 3 就已經是絕對 epoch 秒了。
> 這是刻意的：若在後端做「台北服務日午夜 + arrSec」，00:00–04:00 跟一班昨晚發車的車會整整差一天，
> 而那個錯法會安靜地推出一張「倒數 23 小時」的卡，沒有任何一層會擋。

**掛進 cron**：`scheduled` handler 的**既有** `event.cron === '* * * * *'` 分支內，
緊接在 `ctx.waitUntil(hazardTask)` 那行之後、`try { const ledger = ... }` 之前插入。
仿 `hazardMonitorWithTimeout` 的形狀——**獨立 try／catch、失敗只 log 不 rethrow**，
因為 `trtcLedgerScheduled` 是唯一該把 cron 標紅的分支，LA 推播掛掉不該拖垮北捷帳本：

```js
      const laTask = laPushAll(env, ctx, 'https://railisland.tw').catch(e => {
        console.error('[cron la-push] 失敗:', (e && e.stack) || String(e));
        return { error: String((e && e.message) || e) };
      });
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(laTask);
```

> **不要新增 cron 字串、不要動 `wrangler.jsonc` 的 `triggers.crons`。** `"* * * * *"` 已經註冊，
> 掛進去就會跑；那個陣列裡第二條的停用是 owner 刻意的決定（檔內註解明寫 agent 不得自行加回）。

- [ ] **Step 6: 對真 APNs 冒煙測試一發**

需要 Task 0 完成，以及 Task 2 真機拿到的一個真 token。

`.dev.vars` 補上（開發 build 的 token 是 sandbox 的）：

```bash
printf 'APNS_HOST=api.sandbox.push.apple.com\n' >> .dev.vars
```

先確認自動驗收仍全綠：

```bash
LA_BASE=http://localhost:8799 node scripts/verify_la_backend.mjs
```

真機跟一台車讓它 bind，然後手動觸發一次 cron：

```bash
curl "http://localhost:8799/__scheduled?cron=*+*+*+*+*"
```

確認三件事：
- Worker log 印出 `sent=1`
- **真 iPhone 的鎖定畫面上，卡片的站名真的變了**（log 說送出去了不算數）
- **那列還在 D1**——`laPushAll` 的迴圈是唯一沒有純函式測試覆蓋的部分，
  它最容易錯的地方是「把剛 bind 還沒被 TDX 回報的車誤判成走完全程而刪掉」：

```bash
arch -arm64 node ./node_modules/wrangler/bin/wrangler.js d1 execute DELAY_DB --local --command "SELECT train_no, last_idx, last_delay FROM la_bindings"
```

跑兩次 cron 之間都要看得到那一列，`last_idx` 從 `-1` 變成 `>= 0`。
若列不見了，就是 `idx < 0` 被併進收卡條件——回頭看那兩行的註解。

排錯對照：403 `InvalidProviderToken` → Key ID／Team ID／p8 沒配對；
400 `BadDeviceToken` → sandbox／production host 用錯（見上面的 `APNS_HOST`）；
403 `TopicDisallowed` → `apns-topic` 少了 `.push-type.liveactivity` 後綴。

- [ ] **Step 7: Commit**

```bash
git add worker.js scripts/la_push_core.mjs scripts/verify_la_backend.mjs
git diff --cached --stat
git commit -m "feat(LA): cron 推播與 APNs 送出

每分鐘掃未過期交班,用 laNextIdx 算出該顯示哪一站,變了才推。
traLive 走既有雙層快取(與訪客共用)⇒ 零新增 TDX 呼叫。

三條降級都往誠實那側倒:上游掛掉沿用最後已知誤點(不歸零,歸零會讓卡片跳)、
車不在 feed 就維持現狀、到站時刻已過送 arrivalDate=null 讓卡片只剩站名。
JWT 快取 50 分鐘(Apple 規定 20-60 分鐘,每次重簽會被當濫用)。"
```

---

## Task 7：Widget 進度條與轉場

**Files:**
- Modify: `app/ios/App/App/RailFollowAttributes.swift`
- Modify: `app/ios/App/RailBoardWidget/RailFollowActivity.swift`

**Interfaces:**
- Consumes: Task 6 推送的 `departedDate`

- [ ] **Step 1: ContentState 加欄位**

`RailFollowAttributes.swift` 的 `ContentState` 內，`arrivalDate` 下方加：

```swift
        // 進度條起點(上一站表定發車＋當前誤點)。🔴 必須是 Optional——
        // 非 Optional 欄位會讓「App 更新前開的卡」解不出來(Codable 對 Optional 走 decodeIfPresent)。
        var departedDate: Date?
```

- [ ] **Step 2: Widget 加進度條與轉場**

`RailFollowActivity.swift` 加一個與 `countdown` 並列的 helper：

```swift
    // 距下一站的進度。兩端都有值才畫——系統會逐幀自走,不需要推播。
    // 🔴 ProgressView(timerInterval:) 與 Text(timerInterval:) 是【唯二】會自己動的元件;
    //    withAnimation/.repeatForever 等修飾子被系統忽略(ActivityKit 文件明文),跑馬燈做不到。
    @ViewBuilder
    private func progress(_ from: Date?, _ to: Date?) -> some View {
        if let from, let to, to > from, to > Date() {
            ProgressView(timerInterval: from...to, countsDown: false)
                .labelsHidden()
        }
    }
```

鎖定畫面版面：`Text(context.state.nextStop).font(.headline)` 下方插入

```swift
                    progress(context.state.departedDate, context.state.arrivalDate)
```

倒數那兩處加轉場（換站時數字滾動）：

```swift
                .contentTransition(.numericText())
```

- [ ] **Step 3: 編譯**

```bash
cd app/ios/App && xcodebuild -workspace App.xcworkspace -scheme App -sdk iphoneos -configuration Debug build CODE_SIGNING_ALLOWED=NO 2>&1 | tail -5
```

預期：`** BUILD SUCCEEDED **`。

- [ ] **Step 4: 真機看三態**

真機跟一台車，逐一確認：
- **鎖定畫面**：進度條在動、沒有溢出、深淺色都可讀
- **動態島 compact**（左右兩小塊）：站名前兩字與倒數沒被裁掉
- **動態島 minimal**（只有一小圈）：車次前三碼可辨識
- **動態島 expanded**（長按展開）：三個區域版面沒破

`.contentTransition(.numericText())` 若在真機沒有動畫效果，先確認是不是 iOS 17.0–17.1（該版本有已知 bug，17.2+ 已修）；不是的話就移除這個修飾子——它是加分項，不值得為它卡住。

- [ ] **Step 5: 跨版本相容性驗證（不可省）**

這一步驗的是 §5.1 那個「我判斷 Optional 安全，但沒實測」的假設：

1. 用**加欄位之前**的 build 安裝到真機，開一張卡（跟車）
2. 不要停止跟車，直接安裝**加欄位之後**的 build
3. 看鎖定畫面那張舊卡：**必須仍正常顯示**，不可變空白或消失

若變空白，代表 Optional 假設不成立，退回方案是不加欄位、放棄進度條（改用其他不需新欄位的視覺）。

- [ ] **Step 6: Commit**

```bash
git add app/ios/App/App/RailFollowAttributes.swift app/ios/App/RailBoardWidget/RailFollowActivity.swift
git diff --cached --stat
git commit -m "feat(LA): 距下一站進度條與換站數字轉場

ProgressView(timerInterval:) 與 Text(timerInterval:) 是 ActivityKit 唯二會自己走的元件,
持續動畫(跑馬燈/脈動)被系統明文忽略,所以「一直在跑」的感覺靠進度條。

departedDate 是 Optional——非 Optional 會讓 App 更新前開的卡解不出來;
已在真機做過跨版本驗證(舊 build 開卡→換新 build→卡片仍正常)。"
```

---

## Task 8：端到端真機驗證

**Files:** 無（純驗證）

**依賴 Task 1–7 全部完成。**

- [ ] **Step 1: 把 schema 套到正式 D1（人工步驟，只需做一次）**

照 `schema/README.md` 的規矩，新表要人工套用，沒有自動 CI：

```bash
arch -arm64 node ./node_modules/wrangler/bin/wrangler.js d1 execute DELAY_DB --remote --file=schema/0003_live_activity.sql
```

全部 `IF NOT EXISTS`，重跑無害。**部署 Worker 之前先做這步**——反過來的話 cron 會對不存在的表查詢。

驗證表真的建起來了：

```bash
arch -arm64 node ./node_modules/wrangler/bin/wrangler.js d1 execute DELAY_DB --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name='la_bindings'"
```

- [ ] **Step 2: 部署到預覽環境**

```bash
git fetch origin && git log --oneline HEAD..origin/main
```

非空代表出貨會退掉那些 commit，**先併 `origin/main` 再上傳**。確認為空後：

```bash
arch -arm64 node ./node_modules/wrangler/bin/wrangler.js versions upload
```

（`npx wrangler` 在這台機器是壞的，必須用這個完整寫法。）

- [ ] **Step 3: 全套自動驗收重跑**

```bash
node scripts/verify_live_activity.mjs
```

```bash
node scripts/verify_la_stamap.mjs
```

前兩支全綠才往下。**先看每支開頭的 `[G0]` 兩行**印的路徑與 md5 是不是當前工作區——驗錯目標的假綠這個專案踩過。

`verify_la_backend.mjs` 的 B 系列**不要對預覽站跑**——它依賴 `LA_TEST_BEARER` 這顆只在本機
`.dev.vars` 存在的閘門，對線上跑只會得到「全部被拒」的假紅。線上驗證靠 Step 4 的真車實測。

- [ ] **Step 4: 真車實測（唯一能證明功能成立的一步）**

> **裝 TestFlight build，不要裝 Xcode 直接跑的 Debug build。** Debug build 的
> `aps-environment` 是 `development`，拿到的是 sandbox token，而線上 Worker 打的是
> production host（`APNS_HOST` 未設 → 預設值），一律回 400 BadDeviceToken。

挑一班**台鐵長途車**（自強／莒光，站間 5 分鐘以上，方便觀察），跟車後鎖屏，全程不要打開 App：

- [ ] 鎖屏後至少經過**兩站**，站名各換一次
- [ ] 站名換的時機與實際到站相符（誤差在一分鐘內）
- [ ] 倒數歸零後沒有顯示假的負數或亂跳
- [ ] 動態島（若是 iPhone 14 Pro 以上）三態都正常
- [ ] 停止跟車後卡片消失

- [ ] **Step 5: 降級路徑抽驗**

- [ ] 在**系統設定關閉即時動態**的狀態下跟車 → 不當機、不報錯，行為與現況相同
- [ ] 跟一班**支線車**（平溪／內灣／集集，那 92 站無即時觀測）→ 卡片仍前進（走 fallback），不卡死
- [ ] 跟一班**高鐵** → 站名照表定換
- [ ] **非 Plus 帳號**跟車 → 卡片照開（前景會動），但後端零 bind、鎖屏不換站

- [ ] **Step 6: 升正式站**

真車實測全過之後才升。**升之前**：

```bash
git fetch origin && git log --oneline HEAD..origin/main    # 必須為空
curl -sL "https://railisland.tw/api/la/bind" -o /tmp/_p.json -w "%{http_code}\n"   # 確認線上沒有你沒有的東西
```

依專案慣例，功能批次要**先給預覽 URL 讓使用者親試、拿到明確 go** 才升正式站。

---

## 附錄：實作前已驗證的事實（不必重測）

| 事實 | 值 | 怎麼來的 |
|---|---|---|
| 班表站名 → 站碼涵蓋率 | **244/244**（用 `traStnKey` 正規化後） | 本機實測 |
| 座標守門最大偏差 | **0.182 km**（漢本） | 本機實測 |
| 全車次 staMap | **998 個車次，0 個空**，筆數中位 26、最大 194 | 本機實測 |
| 554 的 `staMap + stopCodes` | **1821 bytes** | 本機實測 |
| `stnInfoMap` 含括號的鍵 | **0 個**（所以剝括號不可能撞站） | 本機實測 |
| `TrainStationStatus` 語意 | `[0:'進站中',1:'在站上',2:'已離站']` | TDX Swagger 原文 |
| `StationID` 含通過站 | 官方明文「並非僅提供列車停靠站資料」 | TDX Swagger 原文 |
| 持續動畫 | 官方明文忽略 `withAnimation`／`animation(_:value:)` | ActivityKit 文件原文 |
| `traLive` 快取 | 邊緣 55 秒 + 記憶體，cron 可內部呼叫 | `worker.js:86`、`worker.js:407` 的既有 pattern |

更完整的實測分布（誤點震盪、凍結 offset 誤差）與逐字引用，見設計書 §11。
