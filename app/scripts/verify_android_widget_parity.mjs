#!/usr/bin/env node
// 平台能力 gate：iOS WidgetBundle 的出貨集合有對應 Android provider／Live Update 才算過。
// 這支故意驗「功能集合」，不是驗某個 provider 自己編得過；過去正是後者全綠卻漏了三項。
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');

export function verifyAndroidWidgetParity({ log = true } = {}) {
  const manifest = read('app/android/app/src/main/AndroidManifest.xml');
  const main = read('app/android/app/src/main/java/tw/railisland/app/MainActivity.java');
  const bridge = read('app/src/native-bridge.mjs');
  const bundle = read('app/ios/App/RailBoardWidget/RailBoardWidgetBundle.swift');
  const html = read('index.html');
  const gradle = read('app/android/app/build.gradle');
  const railData = read('app/android/app/src/main/java/tw/railisland/app/RailWidgetData.java');
  const railConfig = read('app/android/app/src/main/java/tw/railisland/app/RailWidgetConfigActivity.java');
  const railProvider = read('app/android/app/src/main/java/tw/railisland/app/RailBoardWidgetProvider.java');
  const railRender = read('app/android/app/src/main/java/tw/railisland/app/RailWidgetRender.java');
  const railReadable = read('app/android/app/src/main/res/layout/widget_rail_row_readable.xml');
  const railRow = read('app/android/app/src/main/res/layout/widget_rail_row.xml');
  const railKit = read('app/ios/App/RailBoardWidget/RailWidgetKit.swift');
  const follow = read('app/android/app/src/main/java/tw/railisland/app/RailFollowNotification.java');
  const audio = read('app/android/app/src/main/java/tw/railisland/app/RailAudioService.java');
  const rules = new Map([
    ['RailBoardWidget()', [manifest, /android:name="\.RailBoardWidgetProvider"/]],
    ['MetroBoardWidget()', [manifest, /android:name="\.MetroWidgetProvider"/]],
    ['MixedBoardWidget()', [manifest, /android:name="\.MixedBoardWidgetProvider"/]],
    ['RailFollowActivityWidget()', [main, /registerPlugin\(RailFollowLivePlugin\.class\)/]],
    ['MetroWaitActivityWidget()', [main, /registerPlugin\(RailMetroWaitPlugin\.class\)/]],
    ['TraWaitActivityWidget()', [main, /registerPlugin\(RailTraWaitPlugin\.class\)/]],
  ]);
  const body = bundle.match(/var\s+body\s*:\s*some\s+Widget\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? '';
  const shipped = [...body.matchAll(/^\s*(\w+\(\))\s*$/gm)].map(match => match[1]);
  const results = [...rules].map(([ios, rule]) => {
    return {
      label: `${ios} 在 iOS 出貨且有 Android 對應能力`,
      pass: shipped.includes(ios) && rule[1].test(rule[0])
    };
  });
  for (const ios of shipped.filter(name => !rules.has(name))) {
    results.push({ label: `${ios} 尚未定義 Android 對應規則`, pass: false });
  }
  results.push({
    label: 'Android native bridge 對 iOS／Android 都掛出跟車即時卡',
    pass: /platform === 'ios'\s*\|\|\s*platform === 'android'/.test(bridge)
      && /registerPlugin\([^\n]*'RailFollowLive'/.test(bridge)
  });
  // 逐車擁擠度：不比對函式名（v17 快照叫 trtcOfficialCrowdHtmlByNo、main 的實作叫
  // trtcOfficialCrowdHtml，同一個能力換過名字就假紅）。改成測那條鏈本身——
  //   (1) 有以車號為鍵的官方擁擠度對照表 state.trtcOfficialBoard.crowdByNo[<變數>]
  //   (2) 讀那張表的那個 helper，名字就地取自它的定義
  //   (3) 看板算 crowdHtml 時真的呼叫「那個」helper，而且傳的是該列的車號
  const crowdHelper = /function\s+(\w+)\s*\([^)]*\)\s*\{(?:(?!function\s)[^]){0,400}?trtcOfficialBoard\.crowdByNo/.exec(html)?.[1] || '';
  const contentRules = [
    ['Metro Core 看板以逐車車號補上官方擁擠度',
      /trtcOfficialBoard\.crowdByNo\[\s*[A-Za-z_$]/.test(html)
        && !!crowdHelper
        && new RegExp(`crowdHtml\\s*=\\s*${crowdHelper}\\(\\s*(?:label|rec\\.row\\.no)\\s*\\)`).test(html)],
    ['Android 小工具同步並動態解析「我的地點」',
      /registerPlugin\(RailPlacesPlugin\.class\)/.test(main)
        && /RAIL_NATIVE_PLACES/.test(bridge) && /resolvePlace\(/.test(railData)
        && /RailWidgetData\.places\(/.test(railConfig)],
    ['Android 發車看板支援車種／車次／方向篩選且 provider 真正套用',
      /showFilters\(\)/.test(railConfig) && /applyFilters\(/.test(railData)
        && /RailWidgetData\.fetch\(context, sys, origin, destination, filters\)/.test(railProvider)],
    ['Android 跟車卡在 WebView 關閉後仍抓官方動態',
      /refreshOfficial\(Context context\)/.test(follow) && /\/api\/tra-live/.test(follow)
        && /ACTION_REFRESH/.test(follow) && /staMap/.test(html)],
    ['Android 背景音訊使用 Media3 MediaSession 與鎖屏控制',
      /registerPlugin\(RailAudioPlugin\.class\)/.test(main)
        && /media3-session:1\.11\.0/.test(gradle)
        && /android:name="\.RailAudioService"/.test(manifest)
        && /addSession\(mediaSession\)/.test(audio)
        && /platform === 'ios'\s*\|\|\s*platform === 'android'[\s\S]*registerPlugin\('RailAudio'\)/.test(bridge)],
    ['Android 原生 Play 內評分與主動更新偵測皆已接線',
      /registerPlugin\(RailReviewPlugin\.class\)/.test(main)
        && /registerPlugin\(RailStorePlugin\.class\)/.test(main)
        && /com\.google\.android\.play:review:2\.0\.2/.test(gradle)
        && /com\.google\.android\.play:app-update:2\.1\.0/.test(gradle)
        && /RAIL_NATIVE_APPUPDATE/.test(bridge)],
    ['Android 發車小工具大字版會放大主要文字與列高，而非只減少班次',
      /widget_rail_row_readable/.test(railRender)
        && /android:layout_height="42dp"/.test(railReadable)
        && /android:textSize="16sp"/.test(railReadable)
        && /android:textSize="23sp"/.test(railReadable)],
    // 方向三角：iOS 有 RailHeadingMark 就要求 Android 整條鏈都在。這裡刻意驗【鏈】而不是
    // 單一字串——只驗 binder 會漏掉「layout 沒那顆 id」,只驗 layout 會漏掉「算出來沒人用」。
    // 兩個列 layout 都要有：少了好讀版那個，大字版會整批沒方向而小字版正常（最難發現的形態）。
    // 深入驗證（真的編、真的跑、與獨立重算逐車比對）在 verify_android_widget_direction.mjs，
    // 那支需要 Android SDK 與 JDK，不放進這條每次出貨都跑的鏈。
    ['Android 發車看板逐列標出北上／南下（對應 iOS RailHeadingMark）',
      /struct RailHeadingMark/.test(railKit)
        && /enum Heading \{ NORTH, SOUTH \}/.test(railData)
        && /row\.heading = heading\(system, origin, headingTo\)/.test(railData)
        && /out\.put\("heading", heading\.name\(\)\)/.test(railData)
        && /R\.drawable\.wg_heading_north/.test(railRender)
        && /R\.drawable\.wg_heading_south/.test(railRender)
        && /setContentDescription\(R\.id\.wrr_heading/.test(railRender)
        && /@\+id\/wrr_heading(?![A-Za-z0-9_])/.test(railRow)
        && /@\+id\/wrr_heading(?![A-Za-z0-9_])/.test(railReadable)],
    ['Android 使用說明涵蓋擁擠度、我的地點、篩選、大字、背景更新與評分',
      /同一車號，不會借用同方向另一班車/.test(html)
        && /起站與目的站可以選你在軌島儲存的地點/.test(html)
        && /依方向、車種或車次篩選/.test(html)
        && /大字好讀版/.test(html)
        && /WebView 關閉後/.test(html)
        && /key: 'appinfo'/.test(html)],
  ];
  for (const [label, pass] of contentRules) results.push({ label, pass });
  if (log) {
    for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.label}`);
  }
  const failed = results.filter(result => !result.pass);
  if (failed.length) {
    throw new Error(`Android/iOS 小工具 parity：${failed.map(result => result.label).join('；')}`);
  }
  if (log) console.log(`Android/iOS 小工具集合：${shipped.length}/${shipped.length}；內容能力：${contentRules.length}/${contentRules.length}`);
  return { shipped: shipped.length, content: contentRules.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    verifyAndroidWidgetParity();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
