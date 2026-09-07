#!/usr/bin/env node
// 平台能力 gate：iOS WidgetBundle 的出貨集合有對應 Android provider／Live Update 才算過。
// 這支故意驗「功能集合」，不是驗某個 provider 自己編得過；過去正是後者全綠卻漏了三項。
import { readFileSync, readdirSync } from 'node:fs';
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
  const mixedRender = read('app/android/app/src/main/java/tw/railisland/app/MixedWidgetRender.java');
  const railSmall = read('app/android/app/src/main/res/layout/widget_rail_2x2.xml');
  const railMedium = read('app/android/app/src/main/res/layout/widget_rail_4x2.xml');
  const railLarge = read('app/android/app/src/main/res/layout/widget_rail_4x4.xml');
  const mixedLarge = read('app/android/app/src/main/res/layout/widget_mixed_4x4.xml');
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
  // iOS 藝廊每個看板都列 小／中／大;Android 選單一個 provider 只顯示一張 ⇒ 尺寸各自一個 provider
  // (使用者 2026-09-02 裁示「種類要跟 iOS 一樣多」)。receiver 與 provider info 都要在,少一個
  // 那一項就從選單消失而 build 照樣綠。
  for (const [name, info] of [
    ['MetroWidgetSmallProvider', 'metro_board_widget_small_info'],
    ['MetroWidgetLargeProvider', 'metro_board_widget_large_info'],
    ['RailBoardWidgetSmallProvider', 'rail_board_widget_small_info'],
    ['RailBoardWidgetLargeProvider', 'rail_board_widget_large_info'],
  ]) {
    results.push({
      label: `${name} 尺寸分項 provider 已註冊且指向 @xml/${info}`,
      pass: new RegExp(`android:name="\\.${name}"[\\s\\S]{0,400}?@xml/${info}`).test(manifest)
        && /<appwidget-provider/.test(read(`app/android/app/src/main/res/xml/${info}.xml`))
    });
  }
  // 五格寬:中／大 targetCellWidth 寫 5(5 欄採用、4 欄被 launcher 丟掉改走 minWidth),且不得再寫 maxResizeWidth(舊版 5 欄只佔 4 格的原因)。
  for (const info of ['metro_board_widget_info', 'metro_board_widget_large_info', 'rail_board_widget_info', 'rail_board_widget_large_info', 'mixed_board_widget_info']) {
    const xml = read(`app/android/app/src/main/res/xml/${info}.xml`).replace(/<!--[\s\S]*?-->/g, '');
    results.push({
      label: `${info} 五欄給五:targetCellWidth=5、無 maxResizeWidth、四欄退路 minWidth≥320dp`,
      pass: /android:targetCellWidth="5"/.test(xml) && !/maxResizeWidth/.test(xml) && /android:minWidth="(3[2-9]\d|[4-9]\d\d)dp"/.test(xml)
    });
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
  // 🔴 2026-09-02：原本取【第一個】符合形狀的函式名當 crowdHelper，而那條 400 字視窗會跨過
  //   函式邊界 ⇒ 只要有第二個地方讀 crowdByNo（09-02 跟車卡加了逐節擁擠度欄就是），第一個
  //   命中就變成不相干的函式（實測抓到 clearFreqFollow），判準當場假紅，而 Core 板那條鏈
  //   一個字都沒動。判準盲點第 0 條：沒有指名「我在量的是誰」。改成蒐集【全部】候選，
  //   只要有任何一個真的被 crowdHtml 呼叫點用到就算過——功能被刪掉時仍然沒有候選成立 ⇒ 照樣紅。
  const crowdHelpers = [...html.matchAll(/function\s+(\w+)\s*\([^)]*\)\s*\{(?:(?!function\s)[^]){0,400}?trtcOfficialBoard\.crowdByNo/g)].map(m => m[1]);
  // previewLayout 示範列數的期望值全部從原始碼算出來，算不出來就直接炸掉整支腳本——這跟「這條
  // 規則沒過」是兩回事：後者是產品出問題，前者是判準本身瞎了（來源行被砍掉／改名時，判準絕不能
  // 安靜地一路綠燈，見 task-15-review.md I4）。
  function railBoardMaxRows(src) {
    const re = /board\(context, R\.layout\.(widget_rail_\w+), snapshot, (\d+), readable, (true|false)\)/g;
    const found = new Map();
    let match;
    while ((match = re.exec(src))) {
      const [, layoutName, rowsStr, compactStr] = match;
      const value = { rows: Number(rowsStr), compact: compactStr === 'true' };
      const prior = found.get(layoutName);
      if (prior && (prior.rows !== value.rows || prior.compact !== value.compact)) {
        throw new Error(`RailBoardWidgetProvider.java 對 ${layoutName} 的 board() 呼叫彼此不一致（${JSON.stringify(prior)} vs ${JSON.stringify(value)}），示範列期望值無法推導`);
      }
      found.set(layoutName, value);
    }
    for (const name of ['widget_rail_2x2', 'widget_rail_4x2', 'widget_rail_4x4']) {
      if (!found.has(name)) throw new Error(`RailBoardWidgetProvider.java 抓不到 board(context, R.layout.${name}, snapshot, N, readable, compact) 呼叫，示範列期望值無法推導`);
    }
    return found;
  }
  function mixedBoardLimits(src) {
    const metro = src.match(/Math\.min\((\d+),\s*plates\.size\(\)\)/);
    const rail = src.match(/Math\.min\((\d+),\s*rail\.rows\.size\(\)\)/);
    if (!metro) throw new Error('MixedWidgetRender.java 抓不到 Math.min(N, plates.size())，混合看板捷運段示範列期望值無法推導');
    if (!rail) throw new Error('MixedWidgetRender.java 抓不到 Math.min(N, rail.rows.size())，混合看板鐵路段示範列期望值無法推導');
    return { metroRows: Number(metro[1]), railRows: Number(rail[1]) };
  }
  function includesOf(section) {
    return [...section.matchAll(/<include\s+layout="@layout\/(\w+)"/g)].map(m => m[1]);
  }
  function demoRowTagCount(layoutName) {
    return (read(`app/android/app/src/main/res/layout/${layoutName}.xml`).match(/android:tag="demo-row"/g) || []).length;
  }
  function sumDemoRows(names) {
    return names.reduce((sum, name) => sum + demoRowTagCount(name), 0);
  }
  // initialLayout／previewLayout 分家（整枝複審必修 7，final-review-fixbatch.md §2.3）：示範列
  // 只准活在 previewLayout，initialLayout 永遠是中性卡 widget_loading——沒有 BOOT_COMPLETED
  // receiver、updatePeriodMillis=1800000，重開機或 App 更新後收到第一次官方資料前，桌面顯示的
  // 正是 initialLayout。分母用實際掃到的檔案數，不是寫死清單的長度和自己比——清單本身若漏了
  // 新增的第八個 provider，「分母對分母」永遠相等、零資訊（judgment.md 判準盲點第 0／1 條）。
  function widgetInfoFiles() {
    const dir = 'app/android/app/src/main/res/xml';
    return readdirSync(join(ROOT, dir))
      .filter(name => name.endsWith('_info.xml'))
      .filter(name => /<appwidget-provider/.test(read(`${dir}/${name}`)))
      .sort();
  }
  // removeAllViews 是否搶在 addView 前面，必須在「同一個函式」裡驗，否則兩個字串各自散落在檔案
  // 任何地方都會被 .includes() 誤判成過（task-15-fix1-review.md 必修 6 殘留）。先用大括號配對切出
  // 函式本體，再把 // 行註解剝掉──否則「把那行註解掉」這個突變會被純字串搜尋照樣命中，測不出來。
  function extractFunctionBody(src, functionName, label) {
    const signature = new RegExp(`static\\s+RemoteViews\\s+${functionName}\\s*\\([\\s\\S]*?\\)\\s*\\{`);
    const match = signature.exec(src);
    if (!match) throw new Error(`${label} 抓不到 ${functionName}() 函式定義，removeAllViews／addView 順序期望值無法推導`);
    const braceStart = match.index + match[0].length - 1;
    let depth = 0;
    let i = braceStart;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    if (depth !== 0) throw new Error(`${label} 的 ${functionName}() 大括號不成對，removeAllViews／addView 順序期望值無法推導`);
    return src.slice(braceStart, i).replace(/\/\/[^\n]*/g, '');
  }
  function removeBeforeFirstAdd(body, containerId) {
    const removeIdx = body.indexOf(`removeAllViews(R.id.${containerId})`);
    const addIdx = body.indexOf(`addView(R.id.${containerId}`);
    return removeIdx !== -1 && addIdx !== -1 && removeIdx < addIdx;
  }

  const railMaxRows = railBoardMaxRows(railProvider);
  const exp2x2 = railMaxRows.get('widget_rail_2x2');
  const exp4x2 = railMaxRows.get('widget_rail_4x2');
  const exp4x4 = railMaxRows.get('widget_rail_4x4');
  const mixedLimits = mixedBoardLimits(mixedRender);

  const railSmallIncludes = includesOf(railSmall);
  const railMediumIncludes = includesOf(railMedium);
  const railLargeIncludes = includesOf(railLarge);
  // 混合看板一個檔案裡有兩個示範列容器,用容器起訖的字串區間切開各自算(brief 指定做法)。
  const mixedMetroStart = mixedLarge.indexOf('id="@+id/wmx_metro_rows"');
  const mixedRailStart = mixedLarge.indexOf('id="@+id/wmx_rail_rows"');
  if (mixedMetroStart === -1 || mixedRailStart === -1 || mixedRailStart <= mixedMetroStart) {
    throw new Error('widget_mixed_4x4.xml 找不到 wmx_metro_rows／wmx_rail_rows 兩個容器的邊界，無法切分示範列區間');
  }
  const mixedMetroIncludes = includesOf(mixedLarge.slice(mixedMetroStart, mixedRailStart));
  const mixedRailIncludes = includesOf(mixedLarge.slice(mixedRailStart));

  const railSmallRows = sumDemoRows(railSmallIncludes);
  const railMediumRows = sumDemoRows(railMediumIncludes);
  const railLargeRows = sumDemoRows(railLargeIncludes);
  const mixedMetroRows = sumDemoRows(mixedMetroIncludes);
  const mixedRailRows = sumDemoRows(mixedRailIncludes);

  const allDemoFiles = [...new Set([
    ...railSmallIncludes, ...railMediumIncludes, ...railLargeIncludes,
    ...mixedMetroIncludes, ...mixedRailIncludes,
  ])];

  const infoFileNames = widgetInfoFiles();
  const infoFileXml = new Map(infoFileNames.map(name => [name, read(`app/android/app/src/main/res/xml/${name}`)]));
  const railBoardBody = extractFunctionBody(railRender, 'board', 'RailWidgetRender.java');
  const mixedBoardBody = extractFunctionBody(mixedRender, 'board', 'MixedWidgetRender.java');

  const contentRules = [
    // 🔴 判準寫「意圖」不寫「當下的函式名」：2026-08-29 把 trtcOfficialCrowdHtmlByNo 併回
    //    trtcOfficialCrowdHtml(no)，舊寫法的名字比對當場轉紅，但行為完全沒退步——那種紅
    //    跟真回歸長得一模一樣。這裡改成正反各一半：正向＝Core 板確實拿 publicLabel(官方車號)
    //    去要擁擠度、且資料源是逐車的 crowdByNo；反向＝同終點的 crowdByDest join 不得復活
    //    （它正是忠孝復興文湖線列長出板南線 6 格的成因）。兩半都要成立才算過：只留反向那半
    //    的話，整個功能被刪掉也會「通過」。
    ['Metro Core 看板以逐車車號補上官方擁擠度',
      /trtcOfficialBoard\.crowdByNo\[\s*[A-Za-z_$]/.test(html)
        && crowdHelpers.some(h =>
             new RegExp(`crowdHtml\\s*=\\s*${h}\\(\\s*(?:label|rec\\.row\\.no)\\s*\\)`).test(html))],
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
    ['Android 說明中心「加到桌面」橋接已接線（RailWidget plugin 註冊且真的呼叫 requestPinAppWidget）',
      /registerPlugin\(RailWidgetPlugin\.class\)/.test(main)
        && (() => { try { return /requestPinAppWidget\(/.test(read('app/android/app/src/main/java/tw/railisland/app/RailWidgetPlugin.java')); } catch (e) { return false; } })()],
    // 小工具挑選器／釘選框的 previewLayout 是靜態 XML,執行期從不跑 binder——沒有示範列就是空殼
    // （發車看板三尺寸）或只剩版面本身內建的單列預設文字（混合看板，容易被誤認成真資料）。
    // 上一輪只驗「有 include 就好」，結果 2×2 塞了 3 列非 compact 外觀，比真實情況（2 列、
    // 無狀態欄）還失真，且已經造成截斷（task-15-review.md C1）。這裡改成有牙的版本：
    // 示範列數／compact 外觀都要跟原始碼推導出的真實上限逐一比對，數字對不上就在標籤裡同時
    // 印出「實際 vs 期望」兩個數字，不必另外猜錯在哪裡；removeAllViews 條件原樣保留。
    [`widget_rail_2x2 示範列數＝${railSmallRows}（真實上限＝${exp2x2.rows}，RailBoardWidgetProvider.java board() maxRows）`,
      railSmallRows === exp2x2.rows],
    [`widget_rail_4x2 示範列數＝${railMediumRows}（真實上限＝${exp4x2.rows}，RailBoardWidgetProvider.java board() maxRows）`,
      railMediumRows === exp4x2.rows],
    [`widget_rail_4x4 示範列數＝${railLargeRows}（真實上限＝${exp4x4.rows}，RailBoardWidgetProvider.java board() maxRows）`,
      railLargeRows === exp4x4.rows],
    [`widget_mixed_4x4 捷運段(wmx_metro_rows)示範列數＝${mixedMetroRows}（真實上限＝${mixedLimits.metroRows}，MixedWidgetRender.java Math.min(N, plates.size())）`,
      mixedMetroRows === mixedLimits.metroRows],
    [`widget_mixed_4x4 鐵路段(wmx_rail_rows)示範列數＝${mixedRailRows}（真實上限＝${mixedLimits.railRows}，MixedWidgetRender.java Math.min(N, rail.rows.size())）`,
      mixedRailRows === mixedLimits.railRows],
    [`widget_rail_2x2 只准 include compact 示範檔（compact=${exp2x2.compact}）：${railSmallIncludes.join('、') || '(無 include)'}`,
      railSmallIncludes.length > 0 && railSmallIncludes.every(name => name.includes('_compact'))],
    [`widget_rail_4x2／4x4／widget_mixed_4x4 的 include 都不是 compact 示範檔：${[...railMediumIncludes, ...railLargeIncludes, ...mixedMetroIncludes, ...mixedRailIncludes].join('、')}`,
      [...railMediumIncludes, ...railLargeIncludes, ...mixedMetroIncludes, ...mixedRailIncludes].every(name => !name.includes('_compact'))],
    [`示範列檔全部不綁 android:id：${allDemoFiles.join('、')}`,
      allDemoFiles.length > 0 && allDemoFiles.every(name => !/android:id\s*=/.test(read(`app/android/app/src/main/res/layout/${name}.xml`)))],
    // task-15-fix1-review.md 必修 6 殘留：舊版把三個容器塞進同一顆 ok、標籤又宣稱「絕不會看到」
    // ——removeAllViews 只保證「收到 onUpdate 之後」不會看到，保證不了「收到第一次 onUpdate 之前」
    // （那個窗口的中性卡改由 initialLayout 那三條規則負責）。這裡拆成三顆，標籤只說它驗到的事。
    ['RailWidgetRender.board 對 R.id.wr_rows 在 addView 前先 removeAllViews',
      removeBeforeFirstAdd(railBoardBody, 'wr_rows')],
    ['MixedWidgetRender.board 對 R.id.wmx_metro_rows 在 addView 前先 removeAllViews',
      removeBeforeFirstAdd(mixedBoardBody, 'wmx_metro_rows')],
    ['MixedWidgetRender.board 對 R.id.wmx_rail_rows 在 addView 前先 removeAllViews',
      removeBeforeFirstAdd(mixedBoardBody, 'wmx_rail_rows')],
    // initialLayout／previewLayout 分家四條（必修 7）：分母用實際掃到的檔案數（見 widgetInfoFiles）
    // 而不是寫死清單長度，新增或刪掉一個 provider 不改這支腳本就會被 (d) 抓到。
    [`res/xml/*_info.xml 掃到的 appwidget-provider 檔數＝${infoFileNames.length}（期望＝7）：${infoFileNames.join('、') || '(無)'}`,
      infoFileNames.length === 7],
    [`七個 info 檔的 initialLayout 全部指向中性卡 @layout/widget_loading：${infoFileNames.join('、') || '(無)'}`,
      infoFileNames.length > 0 && infoFileNames.every(name => /android:initialLayout="@layout\/widget_loading"/.test(infoFileXml.get(name)))],
    [`七個 info 檔的 previewLayout 存在、≠ widget_loading、且所指 layout 檔存在：${infoFileNames.join('、') || '(無)'}`,
      infoFileNames.length > 0 && infoFileNames.every(name => {
        const m = infoFileXml.get(name).match(/android:previewLayout="@layout\/(\w+)"/);
        if (!m || m[1] === 'widget_loading') return false;
        try { read(`app/android/app/src/main/res/layout/${m[1]}.xml`); return true; }
        catch { return false; }
      })],
    ['widget_loading.xml 是中性卡：無 android:id、無 <include、無 demo-row、無時刻樣式（\\d{1,2}:\\d{2}）、無「往 」',
      (() => {
        const xml = read('app/android/app/src/main/res/layout/widget_loading.xml');
        return !/android:id\s*=/.test(xml)
          && !/<include/.test(xml)
          && !/demo-row/.test(xml)
          && !/\d{1,2}:\d{2}/.test(xml)
          && !/往 /.test(xml);
      })()],
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
