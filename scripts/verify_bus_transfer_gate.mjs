#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const ship = fs.readFileSync(new URL('./ship_web.mjs', import.meta.url), 'utf8');
const all = fs.readFileSync(new URL('./verify_bus_transfer_all.mjs', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const nativeBridge = fs.readFileSync(new URL('../app/src/native-bridge.mjs', import.meta.url), 'utf8');
const androidManifest = fs.readFileSync(new URL('../app/android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const iosInfo = fs.readFileSync(new URL('../app/ios/App/App/Info.plist', import.meta.url), 'utf8');

assert.equal(packageJson.scripts?.['check-bus-transfer'], 'node scripts/verify_bus_transfer_all.mjs',
  'package.json 必須保留公車轉乘總驗收入口');
assert.match(ship, /verify_bus_transfer_all\.mjs/,
  'ship-web preflight 必須執行公車轉乘總驗收');

// 只斷言「有執行」擋不住「執行了但不擋」：把 `if (x.status !== 0) fail(...)` 改成
// `if (false)`，驗收照跑、紅字照印，版本仍然出得去，而 diff 只有一行。
// 判準綁在總驗收的結果變數怎麼被用，不寫死變數名，改名重構仍跟得住。
const spawnMatch = ship.match(/(?:const|let)\s+(\w+)\s*=\s*spawnSync\([^;]*verify_bus_transfer_all\.mjs/);
assert(spawnMatch, 'ship-web 必須把公車轉乘總驗收的結果指派給變數，才能判斷它過了沒');
assert.match(ship, new RegExp(`if\\s*\\(\\s*${spawnMatch[1]}\\.status\\s*!==\\s*0\\s*\\)\\s*fail\\(`),
  'ship-web 必須在公車轉乘總驗收非 0 時 fail——只執行不擋等於沒有守門');
for (const script of [
  'verify_bus_transfer_core.mjs',
  'verify_bus_transfer_index.mjs',
  'verify_bus_transfer_ui.mjs',
  'verify_bus_transfer_worker.mjs',
  'verify_journey_share_worker.mjs',
  'verify_bus_transfer_ui_browser.mjs',
]) {
  assert(all.includes(script), `總驗收漏掉 ${script}`);
}

// 子入口是壞掉時單獨重跑的唯一便道；總入口還在會讓 gate 空過，故逐支釘住。
for (const [name, script] of [
  ['check-bus-transfer-core', 'verify_bus_transfer_core.mjs'],
  ['check-bus-transfer-index', 'verify_bus_transfer_index.mjs'],
  ['check-bus-transfer-ui', 'verify_bus_transfer_ui.mjs'],
  ['check-bus-transfer-worker', 'verify_bus_transfer_worker.mjs'],
  ['check-journey-share-worker', 'verify_journey_share_worker.mjs'],
  ['check-bus-transfer-gate', 'verify_bus_transfer_gate.mjs'],
]) {
  assert.equal(packageJson.scripts?.[name], `node scripts/${script}`,
    `package.json 必須保留 ${name} 子入口，指向 scripts/${script}`);
}

// 公車卡自帶的 apiBase 預設是空字串＝相對路徑。App 載本地打包檔(origin capacitor://localhost),
// 相對路徑打不到 Worker ⇒ 卡片在 App 裡永遠顯示「暫時無法取得」,而固定文案讓它看起來只是暫時故障。
// 本機瀏覽器 harness 與頁面同源,結構上驗不到這件事,只能在這裡靜態釘住。
const mountCall = index.match(/BusTransferUI\.mount\(\{[\s\S]*?\n\s*\}\)/);
assert(mountCall, 'index.html 必須以物件參數呼叫 BusTransferUI.mount');
assert.match(mountCall[0], /apiBase:\s*API_BASE\b/,
  'BusTransferUI.mount 必須傳 apiBase: API_BASE——App 裡相對路徑打不到 Worker,卡片會全程失敗');
assert.match(index, /const\s+API_BASE\s*=\s*window\.RAIL_API_BASE/,
  'index.html 的 API_BASE 必須來自 window.RAIL_API_BASE(原生殼注入正式網域),寫死網域會讓預覽站打到正式站');

// 整段旅程分享沿用同一個原生 API base；App 注入值含尾斜線，POST 不得因此變成 //api。
assert.match(index, /const apiRoot = String\(API_BASE \|\| ''\)\.replace\(\/\\\/\$\/, ''\);[\s\S]{0,180}`\$\{apiRoot\}\/api\/journey-share/,
  '整段旅程分享必須先正規化 API_BASE 尾斜線，再組 /api/journey-share');
assert.doesNotMatch(index, /RAIL_NATIVE_JOURNEY_SHARE/,
  '目前只允許前景定位；不得留下未實作或會暗示鎖屏背景定位的原生分享橋接');
assert.match(index, /id="journeyShareLocation" type="checkbox"/,
  '手機位置必須是獨立、預設未勾選的 checkbox，不能跟建立分享連結綁成預設同意');

// 旅程分享不只要在 Web 成立：兩個原生殼都必須實際掛上定位與系統分享，
// 而且權限只能到使用期間。iOS 的 Always 用途鍵是 Apple 掃 binary 引用所要求，
// 不代表 App 可以請求 Always；真正的不變條件是 bridge 不呼叫 requestAlways，且
// UIBackgroundModes 不含 location。少任一邊，網頁測試仍會全綠，實體 App 卻會失效或過度要求權限。
assert.match(nativeBridge, /window\.RAIL_NATIVE_GEOLOCATION\s*=\s*\{/,
  'App 原生 bridge 必須對 iOS／Android 掛出 RAIL_NATIVE_GEOLOCATION');
assert.match(nativeBridge, /window\.RAIL_NATIVE_SHARE\s*=\s*\{/,
  'App 原生 bridge 必須對 iOS／Android 掛出系統分享');
assert.doesNotMatch(nativeBridge, /requestAlways(?:Authorization|Permission)?/i,
  '旅程位置只允許前景使用，原生 bridge 不得請求 Always 定位');
assert.match(androidManifest, /android\.permission\.ACCESS_COARSE_LOCATION/,
  'Android 必須宣告使用期間的大致定位權限');
assert.match(androidManifest, /android\.permission\.ACCESS_FINE_LOCATION/,
  'Android 必須宣告使用期間的精確定位權限');
assert.doesNotMatch(androidManifest, /ACCESS_BACKGROUND_LOCATION|FOREGROUND_SERVICE_LOCATION/,
  'Android 不得宣告背景定位或定位前景服務');
assert.match(iosInfo, /<key>NSLocationWhenInUseUsageDescription<\/key>/,
  'iOS 必須宣告 When In Use 定位用途');
assert.match(iosInfo, /<key>NSLocationAlwaysAndWhenInUseUsageDescription<\/key>/,
  'Capacitor Geolocation binary 會引用 Always API，iOS 上傳驗證要求保留對應用途鍵');
assert.doesNotMatch(iosInfo, /<string>location<\/string>/,
  'iOS UIBackgroundModes 不得加入 location；手機位置只能在 App 前景更新');

// 車站名來自資料源，t() 只做翻譯插值，不會逃脫 HTML；showToast 會進 innerHTML。
// App 發行閤門曾實際擋下這個漏洞，這裡再綁定轉乘功能本身，避免只跑 Web 出貨鏈時沒看到。
assert.match(index,
  /showToast\(t\('已設定在 \{station\} 接公車', \{ station: escHtml\(target\.stationName\) \}\)\)/,
  '設定轉乘站的 toast 必須先 escHtml 站名，不得把資料值直接送進 innerHTML');

console.log('公車轉乘出貨鏈掛載守門通過。');
