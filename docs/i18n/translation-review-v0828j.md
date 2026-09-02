# 軌島繁中／英文／日文翻譯全量複核稿

- 出貨 build：`v0828j`
- 產生日期：2026-08-28
- 唯一三語條目：2,350 筆
- 原生目錄中與網站／法務／站名完全相同、已合併來源而不重複列出的條目：1,849 筆
- 自動提示需留意：464 筆（多數日文站名沿用漢字屬正常情況，仍保留給複核者確認）

## 複核方式

這份文件直接讀取實際出貨字典、站名資料與 Xcode String Catalog 產生，不是另外手抄的翻譯清單。完全相同的「繁中／英文／日文」組合只列一次，來源欄會合併；同一繁中原文若因使用情境而有不同譯法，會保留成不同列。

若翻譯儲存格以 `[one]`／`[other]` 分行，代表網站 runtime 會依數量的 plural rule 選擇其中一個分支；這是複核用展開格式，介面不會顯示括號標記或整個物件。Xcode 目錄則只收入原生畫面實際可安全插值的純文字值。

複核時請特別檢查：語意是否自然、鐵道專名是否官方、按鈕字數是否過長、`{station}`／`{n}` 等插值是否完整、付費與權限文字是否可能誤導。可在最後一欄把 `□` 改成 `✓`，或直接在該列後方加註建議。

## 網站 UI、訊息與公開內容（1,351 筆）

| # | 來源 | 繁中原文 | English | 日本語 | 自動提示 | 複核 |
|---:|---|---|---|---|---|:---:|
| 1 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings |  · 列車暫時依時刻表位置顯示，未套用誤點，今日動態也暫時無法跟車 |  · Trains temporarily use scheduled positions without delays; following from Today’s TRA Status is also unavailable | ・列車は一時的に時刻表上の位置で表示し、遅延は反映しません。「今日の台湾鉄路」からの追跡も利用できません | — | □ |
| 2 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings |  ±10 分　 |  ±10 min ·  |  ±10分　 | — | □ |
| 3 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings |  起 |  onward | から | — | □ |
| 4 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ，同一顆倍率同時吃字級、列高與觸控目標，所以不會出現「字大了但按鈕沒變大」。 | . The same scale applies to text, row height and tap targets, so buttons grow together with the text. | 。同じ倍率を文字・行の高さ・タップ範囲へ適用するため、文字だけが大きくなってボタンが変わらないことはありません。 | — | □ |
| 5 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ，更新 {n} 個既有地點 | , updated {n} existing places | 、既存の{n}件を更新 | — | □ |
| 6 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ，看接下來有哪些車要進站、還有幾分鐘 |  to see upcoming trains and arrival times. | をタップすると次の列車と到着までの時間を確認できます。 | — | □ |
| 7 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ，排定時誤點 +{n} 分 | , {n} min late when scheduled | 、設定時は{n}分遅れ | — | □ |
| 8 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ，鏡頭就跟著那班車跑 |  to follow that train. | をタップすると追跡します。 | — | □ |
| 9 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 、 | ,  | 、 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 10 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ；{n} 個因收藏已滿略過 | ; skipped {n} because favourites are full | ；お気に入り上限のため{n}件を除外 | — | □ |
| 11 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ；另有 {n} 條線的即時資料異常，已改用官方名冊或班表 | ; {n} other lines have live-data issues and now use an official roster or timetable | ；ほか{n}路線はリアルタイムデータ異常のため公式名簿または時刻表を使用 | — | □ |
| 12 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ；有異常公告會提醒 | ; service alerts will be shown | ；運行情報がある場合は通知 | — | □ |
| 13 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ；災害觸發來源：NCDR 生效中示警 | ; hazard trigger: active NCDR warning | ；災害検出元：発令中のNCDR警報 | — | □ |
| 14 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ；班次名冊仍依官方班距推算 | ; the service roster is still estimated from official headways | ；列車名簿は公式運転間隔から推定 | — | □ |
| 15 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ；最近一次更新失敗：{error} | ; latest update failed: {error} | ；直近の更新失敗：{error} | — | □ |
| 16 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ：看板與時刻表明顯不符，位置僅供參考 | : arrival boards differ substantially from the timetable; positions are for reference only | ：案内表示と時刻表が大きく異なるため、位置は参考表示です | — | □ |
| 17 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 。示警來源暫時無法更新，目前沿用尚未到期的上次成功資料 | . The warning feed is temporarily unavailable, so the latest successful data is being used until it expires | 。警報データを一時更新できないため、有効期限内の前回取得データを使用しています | — | □ |
| 18 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | （分） | (min) | （分） | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 19 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | （沒定到位置，上車站先算搭過） |  (location unavailable; boarding station recorded as passed) | （位置を確認できないため乗車駅は通過として記録） | — | □ |
| 20 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | （其他系統部分路線為班距推算） |  (some routes on other systems are estimated from headways) | （他事業者の一部路線は運転間隔から推定） | — | □ |
| 21 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | （尚未取得資料） |  (no data received yet) | （まだデータを取得していません） | — | □ |
| 22 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | （待避／調度長停） |  (extended operational stop) | （待避・運行調整による長時間停車） | — | □ |
| 23 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | （停在 {time}） |  (stopped at {time}) | （{time}で停止） | — | □ |
| 24 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | （第 {n} 次） |  ({n}th visit) | （{n}回目） | — | □ |
| 25 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | （終點到達） | (Terminates here) | （当駅止まり） | — | □ |
| 26 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | （部分路線為班距推算） |  (some routes are estimated from headways) | （一部路線は運転間隔から推定） | — | □ |
| 27 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | （最後更新 {time}，已 {n} 分鐘未更新） |  (last update {time}, no update for {n} minutes) | （最終更新{time}、{n}分間更新なし） | — | □ |
| 28 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | （跟隨系統） |  (follows system) | （システムに追従） | — | □ |
| 29 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | （較表定約{speed}{n}分） |  (about {n} min {speed} than scheduled) | （予定より約{n}分{speed}） | — | □ |
| 30 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | （較表定約{status}{n}分） |  (about {n} min {status} vs schedule) | （所定より約{n}分{status}） | — | □ |
| 31 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | （顯示前 {n}） |  (showing first {n}) | （先頭{n}件を表示） | — | □ |
| 32 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {date}｜誤點 {n} 分 | {date} \| {n} min late | {date}｜{n}分遅れ | — | □ |
| 33 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {distance} 內有 {n} 條路線 | {n} routes within {distance} | {distance}以内に{n}路線 | — | □ |
| 34 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {from} → {to} | {from} → {to} | {from} → {to} | EN 沿用繁中，請確認；JA 沿用繁中，請確認是否為正式漢字 | □ |
| 35 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {from} → {to} 收集完成，{n} 座站進護照 | {from} → {to} complete; {n} stations added to the Passport | {from} → {to}の収集完了、{n}駅をパスポートに追加 | — | □ |
| 36 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {h} 小時 {m} 分 | {h} hr {m} min | {h}時間{m}分 | — | □ |
| 37 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {kind} {train} 通過——本列車待避禮讓 | {kind} {train} passed—this train waited to let it through | {kind} {train}が通過―この列車は待避 | — | □ |
| 38 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {n} 公尺 | {n} m | {n}m | — | □ |
| 39 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {n} 公里 | {n} km | {n}km | — | □ |
| 40 | i18n/translations.js、i18n/content-translations.js | {n} 分 | [one] {n} min<br>[other] {n} min | {n}分 | — | □ |
| 41 | i18n/translations.js、i18n/content-translations.js | {n} 分  | [one] {n} min <br>[other] {n} min  | {n}分 | — | □ |
| 42 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {n} 分鐘 | {n} min | {n}分 | — | □ |
| 43 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {n} 次 | {n} times | {n}回 | — | □ |
| 44 | i18n/translations.js、i18n/content-translations.js | {n} 秒 | [one] {n} sec<br>[other] {n} sec | {n}秒 | — | □ |
| 45 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {n} 個地點 | {n} places | {n}か所 | — | □ |
| 46 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {n} 班車 | {n} trains | {n}本 | — | □ |
| 47 | i18n/translations.js、i18n/content-translations.js | {n} 班奔跑中 | [one] {n} train running<br>[other] {n} trains running | {n}本運行中 | — | □ |
| 48 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {n} 站 | {n} stops | {n}駅 | — | □ |
| 49 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {n} 條線・{km} km | {n} routes · {km} km | {n}路線・{km} km | — | □ |
| 50 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {n} 項 | {n} items | {n}項目 | — | □ |
| 51 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {route}・{kind} {train}——用軌島看我到哪了 | {route} · {kind} {train}—see where I am on Rail Island | {route}・{kind} {train}―軌島で現在地を見る | — | □ |
| 52 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {station} · {time} 抵達 | {station} · arrived {time} | {station}・{time}着 | — | □ |
| 53 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {station} · 今日班次已收 | {station} · today’s service has ended | {station}・本日の運転終了 | — | □ |
| 54 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {station}　車站看板 | {station} · Station board | {station}　駅案内 | — | □ |
| 55 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {station}・{system}　車站看板 | {station} · {system} · Station board | {station}・{system}　駅案内 | — | □ |
| 56 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {stations} 收進護照 | {stations} added to the Passport | {stations}をパスポートに追加 | — | □ |
| 57 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {system}營運通阻公告 | {system} service alert | {system}運行情報 | — | □ |
| 58 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {systems}即時訊號中斷 {n} 分鐘： | {systems} live feed unavailable for {n} minutes:  | {systems}のリアルタイム情報が{n}分間中断： | — | □ |
| 59 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {systems}即時資料已 {n} 分鐘沒有更新； | {systems} live data has not updated for {n} minutes;  | {systems}のリアルタイム情報は{n}分間更新されていません； | — | □ |
| 60 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {time} · 約 {n} 列同時運行——點擊跳到該時刻 | {time} · about {n} trains running — tap to jump to this time | {time}・約{n}本運行中—タップしてこの時刻へ移動 | — | □ |
| 61 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {time} 發 | Departs {time} | {time}発 | — | □ |
| 62 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {train} 次 | Train {train} | {train}列車 | — | □ |
| 63 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {train} 次 {station} {mode} {n} 分鐘 | Train {train} · {station} · {n} min {mode} | {train}列車・{station}・{mode}{n}分 | — | □ |
| 64 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {train}次 | Train {train} | {train}列車 | — | □ |
| 65 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {types}示警生效，已啟動加強監看 | {types} warnings active; enhanced monitoring enabled | {types}警報が発令中・監視を強化しています | — | □ |
| 66 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | {weekday}平均誤點 {n} 分 | {weekday} average delay: {n} min | {weekday}曜平均遅延{n}分 | — | □ |
| 67 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 「{station}」今天已經蓋過章了 | “{station}” has already been stamped today. | 「{station}」は今日すでにスタンプ済みです。 | — | □ |
| 68 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 「大」只放大字級與列高，功能位置不變。「特大」會把誤點、方向這類次要欄位收進列的「更多」。 | Large increases text and row height without moving features. Extra large moves secondary fields such as delays and direction into each row’s More section. | 「大」は文字と行の高さだけを拡大し、機能の位置は変えません。「特大」では遅延や方向などの補助項目を各行の「その他」へまとめます。 | — | □ |
| 69 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 「大」只放大字級與列高，功能位置完全不變；跟隨系統只在字級進到輔助使用級別才介入。 | Larger settings increase text and row height without moving features. System following only takes effect at accessibility text sizes. | 大きい設定では文字と行の高さだけが変わり、機能の位置は変わりません。システム追従はアクセシビリティ文字サイズでだけ有効になります。 | — | □ |
| 70 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 「永保安康」吉祥車票的一端，日式木造站房 | One end of the auspicious “Yongkang–Bao’an” ticket, with a Japanese wooden station. | 縁起切符「永保安康」の一方で、木造駅舎が残ります。 | — | □ |
| 71 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 「更多」→ 今日台鐵動態 | More → Today’s TRA services | 「その他」→ 本日の台湾鉄路 | — | □ |
| 72 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 「更多」→ 打開「平交道記號」 | More → turn on Level-crossing markers | 「その他」→「踏切マーカー」をオン | — | □ |
| 73 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 「更多」→ 打開「面板半透明」 | More → turn on Translucent panels | 「その他」→「パネル半透明」をオン | — | □ |
| 74 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 「更多」→ 打開「儲存地點」 | More → turn on Saved places | 「その他」→「保存地点」をオン | — | □ |
| 75 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 「更多」→ 字級，開啟「顯示與字級」 | Open More, then Text size, to show Display and text size | 「その他」→「文字サイズ」から「表示と文字サイズ」を開く | — | □ |
| 76 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 「更多」→ 背景音樂 | More → Background music | 「その他」→「BGM」 | — | □ |
| 77 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 「更多」→ 軌道與路線 | More → Tracks and routes | 「その他」→「線路と路線」 | — | □ |
| 78 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 「更多」→ 衛星影像 | More → Satellite imagery | 「その他」→「衛星画像」 | — | □ |
| 79 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 「更多」→「已排提醒」可以查看與取消 | More → Scheduled reminders to review or cancel | 「その他」→「予定済み通知」で確認・取消 | — | □ |
| 80 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 「非即時」不是另一種資料，是同一份官方資料現在不夠新，畫面依稍早那份投射。手機沒有滑鼠停留可看，所以把原因都攤在這張卡裡。 | Not live is not a different data source. It means the same official data is no longer fresh, so the display projects from an earlier update. The card spells out the reasons for touch devices. | 「非リアルタイム」は別のデータではなく、公式データが古くなり、以前の更新から推定している状態です。タッチ端末でも分かるよう、理由をカード内に表示します。 | — | □ |
| 81 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 「追分成功」吉祥車票的一端，日式木造站房 | One end of the auspicious “Zhuifen–Chenggong” ticket, with a Japanese wooden station. | 縁起切符「追分成功」の一方で、日本統治期の木造駅舎が残ります。 | — | □ |
| 82 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 「追分成功」吉祥車票的另一端 | The other end of the auspicious “Zhuifen–Chenggong” ticket. | 縁起切符「追分成功」のもう一方です。 | — | □ |
| 83 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 「換首」跳下一首 | Press Next for another track | 「次の曲」で曲送り | — | □ |
| 84 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 「跟隨系統字級」可以關掉——手機字調大、但這一頁想維持資訊密度時用 | Turn off Follow system text size if your phone uses larger text but you want to keep this screen compact | 端末の文字が大きくてもこの画面の情報量を保ちたい場合は「システム文字サイズに合わせる」をオフにできます | — | □ |
| 85 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ↗ 分享畫面 | ↗ Share view | ↗ 画面を共有 | — | □ |
| 86 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ＝台鐵與林鐵、 |  = TRA and forest railways,  | ＝台湾鉄路と林業鉄路、 | — | □ |
| 87 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ＝全台一次看、 |  = all railways,  | ＝台湾全体、 | — | □ |
| 88 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ＝各家捷運與輕軌 |  = metro and light rail | ＝メトロとLRT | — | □ |
| 89 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ＝看接下來的班次與倒數 |  to see upcoming trains and countdowns | で次の列車と到着までの時間を表示 | — | □ |
| 90 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ＝高鐵、 |  = high-speed rail,  | ＝台湾高速鉄道、 | — | □ |
| 91 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ＝隨機跟隨 | = random follow | ＝ランダム追跡 | — | □ |
| 92 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ＝鏡頭跟著它跑，陪到終點蓋完乘章 |  to follow it to the terminus and earn a completion stamp | を終点まで追跡して完乗スタンプを獲得 | — | □ |
| 93 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ⏸ 停靠 {station} · {time}後開車 | ⏸ At {station} · departs in {time} | ⏸ {station}停車中・あと{time}で発車 | — | □ |
| 94 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ⏺ 錄影 Beta | ⏺ Recording Beta | ⏺ 録画 Beta | — | □ |
| 95 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ▶ 行進中 | ▶ In motion | ▶ 走行中 | — | □ |
| 96 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ◌ 放空模式 | ◌ Ambient mode | ◌ 鑑賞モード | — | □ |
| 97 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ◎ 附近車站 | ◎ Nearby stations | ◎ 現在地付近の駅 | — | □ |
| 98 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ● 已依官方{kind}校正 | ● Corrected using official {kind} | ● 公式{kind}で補正済み | — | □ |
| 99 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ● 已依官方列車動態校正 | ● Corrected with official train tracking | ● 公式列車位置情報で補正済み | — | □ |
| 100 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ● 已依官方到站看板校正 | ● Corrected with official arrival boards | ● 公式到着案内で補正済み | — | □ |
| 101 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ● 位置已依北捷官方秒級倒數逐車校正 | ● Positions corrected per train using Taipei Metro’s official second-level countdowns | ● 台北メトロ公式の秒単位カウントダウンで列車ごとに位置を補正 | — | □ |
| 102 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ● 車輛位置與站台預告共用同一份即時推演 | ● Train positions and platform arrivals use the same live model | ● 車両位置と駅の到着案内は同じリアルタイムモデルを使用 | — | □ |
| 103 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ● 依稍早官方{kind}資料推估 | ● Estimated from earlier official {kind} data | ● 少し前の公式{kind}データから推定 | — | □ |
| 104 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ● 依稍早官方列車動態資料推估 | ● Estimated from the latest official train tracking | ● 直近の公式列車位置情報から推定 | — | □ |
| 105 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ● 依稍早官方看板資料推估 | ● Estimated from the latest official boards | ● 直近の公式案内から推定 | — | □ |
| 106 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ● 官方即時名冊；到站時刻依北捷官方秒級資料 | ● Official live roster; arrivals use Taipei Metro second-level data | ● 公式リアルタイム名簿。到着時刻は台北メトロの秒単位公式データを使用 | — | □ |
| 107 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ◐ 外觀 | ◐ Appearance | ◐ 表示 | — | □ |
| 108 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ♪ 背景音樂 | ♪ Background music | ♪ BGM | — | □ |
| 109 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ⚠ 本路線有{system}通阻公告，班次可能停駛——以官方公告為準 | ⚠ {system} has issued an alert affecting this route. The train may be cancelled; follow the official notice. | ⚠ この路線に影響する{system}の運行情報があります。運休の可能性があるため公式情報をご確認ください。 | — | □ |
| 110 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ⚠ 偵測到營運異常跡象（本站推定），位置僅供參考 | ⚠ Possible disruption detected (Rail Island estimate); positions are for reference only | ⚠ 運行異常の可能性を検出（軌島による推定）。位置は参考表示です | — | □ |
| 111 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ⚠ 異常推定 | ⚠ Possible disruption | ⚠ 運行異常の可能性 | — | □ |
| 112 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ⚠ 營運異常公告中，位置僅供參考 | ⚠ Service disruption reported; positions are for reference only | ⚠ 運行情報があります。位置は参考表示です | — | □ |
| 113 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ⭐ 開源專案，歡迎貢獻 | ⭐ Open-source project—contributions welcome | ⭐ オープンソース・コントリビューション歓迎 | — | □ |
| 114 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 📊 資料來源與授權 | 📊 Data sources &amp; licenses | 📊 データ出典・ライセンス | — | □ |
| 115 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 📍 回報問題或建議 | 📍 Report an issue or suggestion | 📍 問題・翻訳を報告 | — | □ |
| 116 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 📖 使用說明 | 📖 Help | 📖 使い方 | — | □ |
| 117 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 🔒 隱私與服務條款 | 🔒 Privacy &amp; terms | 🔒 プライバシー・利用規約 | — | □ |
| 118 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 1998 年起投入的冷氣柴油客車，自帶柴油引擎、不靠電車線，專跑平溪、深澳、集集與內灣（竹中以南）等未電氣化支線。 | Air-conditioned diesel railcars introduced in 1998 for non-electrified branches including Pingxi, Shen’ao, Jiji and the southern Neiwan Line. | 1998年から運用する冷房付き気動車で、平渓、深澳、集集、内湾線南部など非電化支線を走ります。 | — | □ |
| 119 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 2021 年起投入的日立製城際電聯車，安靜平穩，設「騰雲座艙」商務車廂。 | A quiet, smooth Hitachi intercity EMU introduced in 2021, with the Tengyun business cabin. | 2021年登場の日立製都市間電車で、静かで滑らかな乗り心地とビジネスクラス「騰雲座艙」を備えます。 | — | □ |
| 120 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 30 分鐘 | 30 minutes | 30分 | — | □ |
| 121 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 60 分鐘 | 60 minutes | 60分 | — | □ |
| 122 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 762mm 窄軌登山鐵路的主力列車，由柴油機車與阿里山號客車編成，自海拔 30 公尺的嘉義爬升至 2,216 公尺的阿里山——途中螺旋繞行獨立山三圈半，再以之字形折返「碰壁」而上。 | The main 762 mm narrow-gauge mountain train climbs from Chiayi at 30 m to Alishan at 2,216 m, circling Duli Mountain three and a half times before negotiating switchbacks. | 762mm狭軌の主力登山列車で、標高30mの嘉義から2,216mの阿里山へ、独立山を3周半してスイッチバックを登ります。 | — | □ |
| 123 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 90 分鐘 | 90 minutes | 90分 | — | □ |
| 124 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 一日三乘 | Three in a day | 一日三乗 | — | □ |
| 125 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 一個框三種用法：站名、車次號碼、觀光列車名稱都查得到。 | One search box handles station names, train numbers and tourist-train names. | 一つの検索欄で駅名、列車番号、観光列車名を検索できます。 | — | □ |
| 126 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 一氣呵成 | One long run | 一気に完走 | — | □ |
| 127 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 一張只屬於你的地圖：全台路網轉灰，只有你搭過的區間亮起來。 | Your personal map greys out the network and highlights only segments you have travelled. | 全路線を灰色にし、乗車した区間だけを色付きで表示する自分専用の地図です。 | — | □ |
| 128 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 一等站 | first-class station | 一等駅 | — | □ |
| 129 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 人在車站時，從「附近車站」按該站的蓋章鈕，就升級成到訪章 | At the station, use its stamp button under Nearby stations to upgrade it to Visited | 駅にいる時に「周辺駅」のスタンプボタンで「訪問済み」に更新 | — | □ |
| 130 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 三階字級與跟隨系統字級。 | Three text sizes with optional system-text following. | 3段階の文字サイズとシステム文字サイズへの追従。 | — | □ |
| 131 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 三鶯線 | Sanying Line | 三鶯線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 132 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 三鶯線串起土城、三峽與鶯歌（2026-06-30 通車，8/31 前為免費試營運，8/16 起每日 06:00–24:00 行駛，此時段外看不到車；無公開逐班時刻，班次依官方班距推算）— 拖曳、縮放看看。 | The Sanying Line links Tucheng, Sanxia and Yingge. During the free trial through 31 August, service runs daily from 06:00 to 24:00; no per-train timetable is public, so trains are estimated from official headways. | 三鶯線は土城・三峡・鶯歌を結びます。8月31日までの無料試運転期間は毎日06:00〜24:00に運行し、列車ごとの公開時刻表がないため公式運転間隔から推定します。 | — | □ |
| 133 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 上次同步：{time} | Last synced: {time} | 前回の同期：{time} | — | □ |
| 134 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 上次成功更新 {time} | Last successful update {time} | 最終更新成功 {time} | — | □ |
| 135 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 上面 | Use  | 上部の | — | □ |
| 136 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 上面「全／台／高／捷」四顆選你想看的： | Choose a view with the four buttons above:  | 上の4ボタンで表示を選びます： | — | □ |
| 137 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 上榜 | Ranked | ランク入り | — | □ |
| 138 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 下一站 | Next stop | 次の駅 | — | □ |
| 139 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 下車站 | Exit station | 下車駅 | — | □ |
| 140 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 下車站要在上車站後面 | The destination must come after the boarding station. | 下車駅は乗車駅より後の駅を選んでください。 | — | □ |
| 141 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 久沒動會進「劇場模式」把介面淡掉，動一下就回來。 | After inactivity Theater mode fades the interface; interact to bring it back. | しばらく操作しないと劇場モードでUIが消え、操作すると戻ります。 | — | □ |
| 142 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 也可以。 | . | してください。 | — | □ |
| 143 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 也可以在 App 內從 Google Maps 的「已儲存」清單匯入（需軌島通行證）；檔案只在這台裝置解析，不會上傳。 | The app can also import Google Maps Saved lists with a Rail Island Pass. Files are processed only on this device and are never uploaded. | Appでは軌島パスを使ってGoogle Mapsの保存済みリストも読み込めます。ファイルは端末内だけで解析し、アップロードしません。 | — | □ |
| 144 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 也匯入其餘 {n} 個未預覽地點 | Also import the other {n} places not previewed | プレビューしていない残り{n}件も読み込む | — | □ |
| 145 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 千里鐵道 | 1,000 km railway | 1000 km鉄道 | — | □ |
| 146 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 土石流及大規模崩塌 | Landslide and large-scale slope failure | 土砂災害・大規模崩壊 | — | □ |
| 147 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 大 | Large | 大 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 148 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 大 1.25 | Large 1.25 | 大 1.25 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 149 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 子母隧道與觀海月台，攝影人的秘境 | Known for its paired old tunnels and sea-view platform, a favourite hidden photography spot. | 親子トンネルと海を望むホームで知られる撮影スポットです。 | — | □ |
| 150 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 小卡的 × 結束 | Use × on the card to stop | カードの×で終了 | — | □ |
| 151 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 山海平原 | Mountains, sea and plains | 山・海・平原 | — | □ |
| 152 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 山海號 | Mountain &amp; Sea | 山海号 | — | □ |
| 153 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已切成衛星影像——從「更多」再按一次可切回地圖 | Satellite imagery is on—switch it off under More to return to the map | 衛星画像に切り替えました。「その他」から地図へ戻せます。 | — | □ |
| 154 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已加入最愛車站 | Station added to favourites | 駅をお気に入りに追加しました | — | □ |
| 155 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已收藏 | Collected | 収集済み | — | □ |
| 156 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已把時間帶回「現在」才能追蹤這站 | The timeline was returned to Now so this station can be tracked. | この駅を追跡するため時刻を「現在」に戻しました。 | — | □ |
| 157 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已依即時誤點推估 | Estimated with live delays | 遅延情報から推定 | — | □ |
| 158 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已依官方即時資訊校正 | Corrected with official live data | 公式リアルタイム情報で補正済み | — | □ |
| 159 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已到達 | Arrived | 到着済み | — | □ |
| 160 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已取消預設啟動地點 | Default start place removed | 起動時の場所を解除しました | — | □ |
| 161 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已抵達終點 | Arrived at the terminus | 終点に到着しました | — | □ |
| 162 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已恢復訂閱資格 | Subscription restored. | サブスクリプションを復元しました。 | — | □ |
| 163 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已恢復通行證資格 | Pass access restored | パスの利用資格を復元しました | — | □ |
| 164 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已是最新版 | Up to date | 最新バージョンです | — | □ |
| 165 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已是最新版　{version} | Up to date　{version} | 最新版です　{version} | — | □ |
| 166 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已訂閱？恢復購買 | Already subscribed? Restore purchases | 購入済みですか？復元する | — | □ |
| 167 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已套用台鐵即時誤點 | TRA live delays applied | 台湾鉄路の遅延情報を反映 | — | □ |
| 168 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已排提醒 | Scheduled alerts | 設定済み通知 | — | □ |
| 169 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已移除地點 | Place removed | 場所を削除しました | — | □ |
| 170 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已移除最愛車站 | Station removed from favourites | 駅をお気に入りから削除しました | — | □ |
| 171 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已設「{label}」為預設啟動地點 | Set “{label}” as the default start place | 「{label}」を起動時の場所に設定しました | — | □ |
| 172 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已設為預設啟動地點 | Set as default start place | 起動時の場所に設定しました | — | □ |
| 173 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已進放空模式——動一下畫面就回到手動 | Ambient mode is on—interact to return to manual control | 鑑賞モードを開始しました。画面を操作すると手動へ戻ります。 | — | □ |
| 174 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已匯入 {n} 個新地點{updated}{skipped} | Imported {n} new places{updated}{skipped} | 新しい場所を{n}件読み込みました{updated}{skipped} | — | □ |
| 175 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已匯出最近 10 分鐘的捷運診斷 | Exported the last 10 minutes of metro diagnostics | 直近10分のメトロ診断情報を書き出しました | — | □ |
| 176 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已經在 App 訂閱了？登入以同步 | Already subscribed in the app? Sign in to sync | アプリで購入済みですか？ログインして同期 | — | □ |
| 177 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已暫停——按站台帶最左邊那顆就繼續 | Paused—press the leftmost timeline control to resume | 一時停止しました。時間軸左端のボタンで再生します。 | — | □ |
| 178 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已複製 ✓ | Copied ✓ | コピー済み ✓ | — | □ |
| 179 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已複製分享連結 | Share link copied | 共有リンクをコピーしました | — | □ |
| 180 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已複製行程連結 | Journey link copied | 旅程リンクをコピーしました | — | □ |
| 181 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已複製帳號 | Account number copied | 口座番号をコピーしました | — | □ |
| 182 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已選取帳號，請按 ⌘C／Ctrl+C 複製 | Account number selected. Press ⌘C or Ctrl+C to copy. | 口座番号を選択しました。⌘C／Ctrl+Cでコピーしてください。 | — | □ |
| 183 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已儲存地點 | Place saved | 場所を保存しました | — | □ |
| 184 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已儲存地點「{label}」 | Saved “{label}” | 「{label}」を保存しました | — | □ |
| 185 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已離開此班次的行駛時段 | This service is no longer running at the selected time. | 選択した時刻にはこの列車は運行していません。 | — | □ |
| 186 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已關閉省電模式 | Power saving is off. | 省電力モードを解除しました。 | — | □ |
| 187 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 已讀取 {n} 個清單檔案，請確認後再匯入。 | Read {n} list files. Review them before importing. | {n}個のリストファイルを読み取りました。確認してから読み込んでください。 | — | □ |
| 188 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 不支援的軌島資料格式 | Unsupported Rail Island data format | 対応していない軌島データ形式です | — | □ |
| 189 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 不再顯示 | Don’t show again | 今後表示しない | — | □ |
| 190 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 不同城市恰好同名的捷運站不再共用同一張看板：台北與台中的「市政府」現在只會顯示各自系統的路線與班次，其他跨系統同名站也一併分開 | Metro stations with the same name in different cities no longer share an arrival board; each now shows only its own system’s lines and services. | 別の都市にある同名のメトロ駅が同じ到着案内を共有しないようにし、それぞれの路線と列車だけを表示します。 | — | □ |
| 191 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 不知道要看哪班，交給它挑一班。 | Not sure what to watch? Let Rail Island choose. | どの列車を見るか迷ったら軌島に選ばせましょう。 | — | □ |
| 192 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 不喜歡再按一次換一班 | Press again to choose another | もう一度押して別の列車へ | — | □ |
| 193 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 中文原文 | Chinese source text | 中国語の原文 | — | □ |
| 194 | i18n/translations.js、i18n/content-translations.js | 中和新蘆線 | Zhonghe–Xinlu Line | 中和新蘆線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 195 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 中南部 | Central &amp; Southern Taiwan | 中南部 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 196 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 中斷 | OUTAGE | 中断 | — | □ |
| 197 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 之後不用管它——車每過一站就蓋一枚，到站自動結束 | Leave it running; each station is stamped and the ride ends at your destination | 列車が駅を通るたびに収集し、下車駅で自動終了 | — | □ |
| 198 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 之後點那個釘，看接下來經過的列車與倒數 | Tap its pin later for upcoming trains and countdowns | ピンをタップして次の列車とカウントダウンを確認 | — | □ |
| 199 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 五千公里俱樂部 | 5,000 km club | 5000 kmクラブ | — | □ |
| 200 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 今 | Now | 今 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 201 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 今天已蓋 ✓ | Stamped today ✓ | 本日押印済み ✓ | — | □ |
| 202 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 今天全台鐵每班車誤點多少、每一站怎麼延誤，一次看完。 | Review today’s delays across all TRA trains and every stop. | 本日の全列車の遅延と駅ごとの推移を確認できます。 | — | □ |
| 203 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 今天有哪些特別列車（觀光列車、加班車）與今日之最。 | Discover tourist trains, special services and today’s railway records. | 本日の観光列車・臨時列車・各種トップを紹介します。 | — | □ |
| 204 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 今天沒有這一類的班次可搭 | No services of this type run today. | 今日はこの種類の列車がありません。 | — | □ |
| 205 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 今天的末班車已經開走了 | Today’s last train has already departed. | 本日の終電はすでに発車しました。 | — | □ |
| 206 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 今日 | Today | 本日 | — | □ |
| 207 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 今日 {n} 班 | {n} services today | 本日{n}本 | — | □ |
| 208 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 今日已觀測 {total} 班・誤點≥5分：目前 {current} 班・今天曾有 {peak} 班 | {total} trains observed today · ≥5 min late: {current} now, {peak} at any time today | 本日{total}列車を観測・5分以上の遅れ：現在{current}列車、本日最大{peak}列車 | — | □ |
| 209 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 今日之最 | Today’s highlights | 本日のトップ | — | □ |
| 210 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 今日台鐵動態 | TRA today | 本日の台湾鉄路 | — | □ |
| 211 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 今日台鐵動態——全台鐵今天每班車的誤點排行與逐站歷程 | TRA today—delay ranking and station-by-station history | 本日の台湾鉄路—遅延ランキングと駅別履歴 | — | □ |
| 212 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 今日台鐵動態與誤點履歷 | Today’s TRA services and delay history | 本日の台湾鉄路と遅延履歴 | — | □ |
| 213 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 今日官方停駛 {n} 班 | {n} officially cancelled today | 本日の公式運休 {n}本 | — | □ |
| 214 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 今日亮點 | Today’s highlights | 今日の見どころ | — | □ |
| 215 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 今日亮點——特別列車與今日之最 | Today’s highlights—special trains and daily records | 本日の注目列車と記録 | — | □ |
| 216 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 今日最長征 | Longest journey today | 本日の最長距離 | — | □ |
| 217 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 今日資料累積中，清晨發車後陸續出現。 | Today’s data is accumulating and appears after morning departures begin. | 本日のデータを集計中です。早朝の始発後から順次表示されます。 | — | □ |
| 218 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 內灣線 | Neiwan Line | 内湾線 | — | □ |
| 219 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 內灣線終點，內灣老街與吊橋 | Neiwan Line terminus by Neiwan Old Street and its suspension bridge. | 内湾線の終点。内湾老街と吊り橋があります。 | — | □ |
| 220 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 六家線 | Liujia Line | 六家線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 221 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 六條支線全數完乘 | Complete all six branch lines | 6支線をすべて完乗 | — | □ |
| 222 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 分享 | Share | 共有 | — | □ |
| 223 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 分享目前畫面（地點＋時間，或正在跟的車） | Share this view (place, time or followed train) | 現在の画面を共有（場所・時刻・追跡中の列車） | — | □ |
| 224 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 分享行程 | Share journey | 旅程を共有 | — | □ |
| 225 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 分享行程只給班次與到站時間，不會分享你的位置。 | Trip sharing includes the train and arrival time, never your position. | 旅程共有には列車と到着時刻だけが含まれ、現在地は共有しません。 | — | □ |
| 226 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 分享軌島畫面 | Share Rail Island view | 軌島の画面を共有 | — | □ |
| 227 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 分享畫面 | Share view | 画面を共有 | — | □ |
| 228 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 分享與資料 | Sharing &amp; data | 共有・データ | — | □ |
| 229 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 分鐘 | min | 分 | — | □ |
| 230 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 切回一般地圖 | Switch back to the standard map | 通常の地図に戻す | — | □ |
| 231 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 切換：全台／台鐵／高鐵／捷運 | Switch: Nationwide / TRA / HSR / Metro | 切替：台湾全土／台湾鉄路／高鉄／メトロ | — | □ |
| 232 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 切換不會重新框景——你原本看的地方還在原地。字級調大時那顆鈕會跟著變大，但位置不變。 | Switching does not reset the map view. The button grows with larger text but stays in the same place. | 切り替えても地図の表示範囲は変わりません。文字を大きくするとボタンも大きくなりますが、位置は変わりません。 | — | □ |
| 233 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 切換到含車站的檢視再定位 | Switch to a view with stations and try again | 駅のある表示に切り替えて再度お試しください | — | □ |
| 234 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 切換衛星影像 | Toggle satellite imagery | 衛星画像を切り替え | — | □ |
| 235 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 太接近發車時間，來不及提醒 | It is too close to departure to schedule an alert. | 発車時刻が近すぎるため通知を設定できません。 | — | □ |
| 236 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 太魯閣自強號 | Taroko Express | 太魯閣自強号 | — | □ |
| 237 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 手動拖圖會解除所在地鏡頭，定位藍點仍持續更新 | Dragging the map releases the location camera, while the blue dot continues updating | 地図を手で動かすと現在地カメラは解除されますが、青い点は更新を続けます | — | □ |
| 238 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 手機：點頂端右邊那顆圓鈕（上面寫著目前在哪一群） | Phone: tap the round button at the top right, labelled with the current group | スマートフォン：現在のグループ名がある右上の丸いボタンを押す | — | □ |
| 239 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 手機拖時刻尺、桌面按 ← → 各移動 10 分鐘 | Drag the time ruler on phone or use ← → on desktop to move 10 minutes | スマートフォンは時刻目盛をドラッグ、デスクトップは← →で10分移動 | — | □ |
| 240 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 手機長時間掛著看，建議打開省電模式。 | Enable power saving when leaving the map open on a phone. | スマートフォンで長時間表示する場合は省電力モードをおすすめします。 | — | □ |
| 241 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 手機按底部「搜尋」、桌面點右上的搜尋框 | On a phone tap Search at the bottom; on desktop use the box at top right. | スマートフォンは下部の「検索」、デスクトップは右上の検索欄を使います。 | — | □ |
| 242 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 支線小火車 | Branch-line trains | 支線列車 | — | □ |
| 243 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 支線行腳 | Branch-line journeys | 支線の旅 | — | □ |
| 244 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 支線行腳　&lt;b&gt;{name}&lt;/b&gt; 蓋章！ | Branch Explorer · &lt;b&gt;{name}&lt;/b&gt; stamped! | 支線めぐり　&lt;b&gt;{name}&lt;/b&gt; スタンプ獲得！ | — | □ |
| 245 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 支線制霸 | Branch-line master | 支線制覇 | — | □ |
| 246 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 方向 | Direction | 方向 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 247 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 日期 | Date | 日付 | — | □ |
| 248 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 月台常客 | Platform regular | ホームの常連 | — | □ |
| 249 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 月訂閱 | Monthly | 月間プラン | — | □ |
| 250 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 月票與年票都是自動續訂方案；你可以隨時在 App Store 的訂閱設定中取消，取消後於當期結束時停止續訂。 | Monthly and annual passes renew automatically. You can cancel anytime in App Store subscription settings; cancellation takes effect after the current paid period. | 月間パスと年間パスは自動更新です。App Storeのサブスクリプション設定からいつでも解約でき、支払済み期間の終了時に更新が停止します。 | — | □ |
| 251 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 火山 | Volcanic activity | 火山 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 252 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 主要導覽 | Main navigation | メインナビゲーション | — | □ |
| 253 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 付款完成但尚未取得訂閱資格，請按「恢復購買」 | Payment completed, but the subscription is not active yet. Choose Restore Purchases. | 支払いは完了しましたが、サブスクリプションがまだ有効ではありません。「購入を復元」を選択してください。 | — | □ |
| 254 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 以上全在「更多」裡逐項開關 | Each option can be switched under More | すべて「その他」で個別に切替 | — | □ |
| 255 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 以下倒數與地圖上的列車位置都是依各站之間的固定行車時間推估的，可能與實際不符，也可能整段空著。 | The countdowns and train positions below are estimated from fixed inter-station travel times. They may differ from reality or be missing for an entire segment. | 以下のカウントダウンと地図上の列車位置は駅間の固定所要時間から推定しています。実際と異なる場合や、区間全体が表示されない場合があります。 | — | □ |
| 256 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 以月訂或年訂支持軌島持續運作。同一個軌島帳號可在網站與 App 使用與恢復訂閱資格。 | Support Rail Island with a monthly or annual subscription. The same account can use and restore Plus on the web and in the app. | 月額または年額プランで軌島の運営を支援できます。同じアカウントでWebとアプリの購入を利用・復元できます。 | — | □ |
| 257 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 加入最愛 | Add to favorites | お気に入りに追加 | — | □ |
| 258 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 加入最愛車站 | Add station to favourites | 駅をお気に入りに追加 | — | □ |
| 259 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 加速播放沒問題，中途跳時間就不算。 | Speed-up is allowed; jumping through time does not count. | 早送りは可能ですが、時間を飛ばすと対象外です。 | — | □ |
| 260 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 北北桃 | Greater Taipei &amp; Taoyuan | 台北・新北・桃園 | — | □ |
| 261 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 北捷 | Taipei Metro | 台北メトロ | — | □ |
| 262 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 北捷即時動畫正式換成同一套時間軸：地圖上的車、站台預告與點選跟隨現在會對到同一班車；官方資料更新時不會整批跳位或交換身分，後車在站外也不會貼到前車 100 公尺內。忠孝復興這類多條路線共用的車站，到站資訊會核對那班車實際屬於哪條線，確認不了就只顯示時刻、不亂標。若某條路線的即時資料忽然變少或不完整，只有那條線會自動退回原本模式，其餘照常 | Taipei Metro map positions, station forecasts and following now share one timeline and train identity. Interchange arrivals verify the correct line, while incomplete live data falls back only on the affected line. | 台北メトロの地図、駅予告、追跡を同じ時系列と列車識別に統一しました。乗換駅では実際の路線を確認し、不完全なリアルタイム情報は該当路線だけ従来方式へ戻します。 | — | □ |
| 263 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 北捷班次直接顯示官方即時倒數 | Taipei Metro services use the official live countdown | 台北メトロは公式リアルタイム到着秒数を表示します | — | □ |
| 264 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 半島縱走 | Island trekker | 島縦走 | — | □ |
| 265 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 半徑內無，顯示最近 {n} 站 | None within range; showing the {n} nearest stations | 範囲内にないため最寄り{n}駅を表示 | — | □ |
| 266 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 卡片上的「提醒」選要提醒的站 | Use Reminder on the card to choose a station | カードの「通知」で駅を選択 | — | □ |
| 267 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 去過的車站會變成一枚章，收在護照裡；同一座站去越多次，章上的數字越大。 | Visited stations become Passport stamps; repeat visits increase the number on each stamp. | 訪れた駅をパスポートに収集し、訪問回数をスタンプに表示します。 | — | □ |
| 268 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 另有 {n} 筆未列出；可先完成這批再重新匯入。 | {n} more are not shown. Finish this batch, then import again. | ほか{n}件は表示していません。この分を完了してから再度読み込めます。 | — | □ |
| 269 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 只在上車、下車兩個點用到你的位置，中間由列車自己的時刻推算，所以進隧道、關螢幕都不影響。上車時就要選下車站，否則忘了按下車會一路蓋到終點。 | Location is used only when boarding and alighting. The train timetable handles the journey, so tunnels and a locked screen are fine. Choose the destination when boarding or collection continues to the terminus. | 位置は乗車時と下車時だけ利用し、途中は時刻表で進行するためトンネルや画面ロックでも動作します。乗車時に下車駅を選んでください。 | — | □ |
| 270 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 可在網址列旁圖示→網站設定→位置 允許 | Use the icon beside the address bar → Site settings → allow Location | アドレスバー横のアイコン→サイト設定→位置情報を許可してください | — | □ |
| 271 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 可在網址列鎖頭圖示→位置 允許 | Use the lock icon in the address bar → allow Location | アドレスバーの鍵アイコン→位置情報を許可してください | — | □ |
| 272 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 可到 iPhone 設定→隱私權與安全性→定位服務 開啟並允許 Safari | On iPhone, open Settings → Privacy &amp; Security → Location Services and allow Safari | iPhoneの「設定」→「プライバシーとセキュリティ」→「位置情報サービス」でSafariを許可してください | — | □ |
| 273 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 可帶自行車（兩鐵） | Bicycles accepted | 自転車持込可 | — | □ |
| 274 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 可匯入 {n} | {n} ready | 読み込み可 {n} | — | □ |
| 275 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 可匯入台灣地點 | Places in Taiwan ready to import | 読み込める台湾の場所 | — | □ |
| 276 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 可點選已連結的班次跟隨動畫 | Tap a linked service to follow it | 対応済みの列車をタップして追跡できます | — | □ |
| 277 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 可點選的班次可跟隨動畫 | Tap an available service to follow it | タップできる列車はアニメーションを追跡できます | — | □ |
| 278 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 可轉乘 | Transfers | 乗換 | — | □ |
| 279 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台 | TRA | 台鉄 | — | □ |
| 280 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台中 | Taichung | 台中 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 281 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台中捷運 | Taichung Metro | 台中メトロ | — | □ |
| 282 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台中捷運與高雄捷運同框，高捷與輕軌營運時段依官方到站看板校正（台中捷運為班距推算）— 可在上方勾選要同時顯示的系統。 | Taichung and Kaohsiung metro systems run together. Kaohsiung Metro and light rail use official arrival-board corrections; Taichung is estimated from headways. | 台中メトロと高雄メトロを同時表示します。高雄メトロとライトレールは公式到着案内で補正し、台中メトロは運転間隔から推定します。 | — | □ |
| 283 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台北 | Taipei | 台北 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 284 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台北捷運 | Taipei Metro | 台北メトロ | — | □ |
| 285 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台北捷運、桃園機捷、新北捷運（環狀・淡海・安坑・三鶯）、台中捷運與高雄捷運（含輕軌）同框運行，營運時段依官方即時資訊校正（文湖線、三鶯線與台中捷運為班距推算）— 可在上方勾選要同時顯示的系統。 | Taipei, Taoyuan, New Taipei, Taichung and Kaohsiung metro and light-rail systems run together. Supported lines use official live corrections; Wenhu, Sanying and Taichung are estimated from headways. Choose systems above. | 台北・桃園・新北・台中・高雄のメトロとライトレールを同時表示します。対応路線は公式リアルタイム情報で補正し、文湖線・三鶯線・台中メトロは運転間隔から推定します。上部で表示する交通機関を選べます。 | — | □ |
| 286 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台北捷運、桃園機捷、新北捷運（環狀・淡海・安坑・三鶯）、台中捷運與高雄捷運（含輕軌）同框運行，營運時段依官方即時資訊校正（台北捷運與環狀線目前位置為班表推估，車站倒數仍是官方即時；文湖線、三鶯線與台中捷運為班距推算）— 可在上方勾選要同時顯示的系統。 | Taipei, Taoyuan, New Taipei, Taichung and Kaohsiung metro and light-rail systems run together. Taipei Metro and Circular Line positions currently use timetable estimates while station countdowns remain live; Wenhu, Sanying and Taichung are estimated from headways. | 台北・桃園・新北・台中・高雄のメトロとライトレールを同時表示します。台北メトロと環状線の位置は現在時刻表推定ですが、駅の到着秒数は公式リアルタイム情報です。文湖線・三鶯線・台中メトロは運転間隔から推定します。 | — | □ |
| 287 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台北捷運、新北捷運（環狀線・淡海・安坑・三鶯）與桃園機捷同框運行，北捷、新北捷與機捷營運時段依官方即時資訊校正（三鶯線、文湖線為班距推算）— 可在上方勾選要同時顯示的系統,拖曳、縮放地圖看看。 | Taipei, New Taipei and Taoyuan metro systems run together. Supported lines use official live corrections; Sanying and Wenhu are estimated from headways. Choose systems above, then drag or zoom the map. | 台北・新北・桃園のメトロを同時表示します。対応路線は公式リアルタイム情報で補正し、三鶯線と文湖線は運転間隔から推定します。上部で表示する交通機関を選び、地図をドラッグ・ズームできます。 | — | □ |
| 288 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台東 | Taitung | 台東 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 289 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台南 | Tainan | 台南 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 290 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台鐵 | TRA | 台湾鉄路 | — | □ |
| 291 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台鐵 · 高鐵 · 阿里山林鐵（真實時刻）｜ 捷運 · 輕軌（官方時刻表，主要路網看板校正） | TRA · HSR · Alishan trains (scheduled) \| Metro · light rail (official timetables; live-board correction where available) | 台湾鉄路・高鉄・阿里山森林鉄道（時刻表）｜メトロ・ライトレール（公式時刻表、対応路線は案内表示で補正） | — | □ |
| 292 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台鐵、高鐵與阿里山林鐵皆依真實時刻表運行（台鐵回到現在時刻自動套用即時誤點；林鐵依官方公告時刻表，無即時資訊）— 點列車跟隨、點車站看班次，或按地圖角落「探」看今日亮點。 | TRA, high-speed rail and Alishan Forest Railway trains follow official timetables. TRA live delays apply at the current time; Alishan has no live data. Tap trains or stations, or open Highlights. | 台湾鉄路・高速鉄道・阿里山森林鉄道は公式時刻表で運行します。現在時刻では台湾鉄路の遅延を反映し、阿里山森林鉄道にはリアルタイム情報がありません。列車や駅をタップするか、「選」で今日の見どころを表示できます。 | — | □ |
| 293 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台鐵{tier}　鐵路運輸的重要節點 | TRA {tier} · a major railway hub | 台湾鉄路の{tier}・鉄道輸送の主要拠点 | — | □ |
| 294 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台鐵列車的誤點履歷（逐日紀錄，回溯 90 天） | TRA delay history by day for the past 90 days | 台湾鉄路の列車別遅延履歴（過去90日の日別記録） | — | □ |
| 295 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台鐵列車經過不停靠的小站時，會有一瞬間停在站上、下一瞬間往前跳出去——車速愈快跳得愈遠，自強、太魯閣這類最快的車一次跳將近二十公尺。現在通過那一刻改成連續移動，不再停頓也不再跳。順手修掉另一個少見的狀況：頁面開著跨過午夜、再切換一次系統時，同編號的車會沿用前一天那班的誤點，最遠會把車畫到六公里外 | TRA trains now move continuously through non-stop stations instead of pausing and jumping. Switching systems after midnight also no longer reuses the previous day’s delay for a train with the same number. | 台湾鉄路の通過列車が非停車駅で一瞬止まって跳ぶ現象をなくし、連続して動くようにしました。日付をまたいで路線を切り替えた際、同じ列車番号に前日の遅延を引き継ぐ問題も修正しました。 | — | □ |
| 296 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台鐵即時資料中斷{stopped}，暫時無法從這裡跟車 | TRA live data is interrupted{stopped}; following from here is temporarily unavailable. | 台湾鉄路のリアルタイム情報が中断{stopped}しているため、ここからの追跡は一時利用できません。 | — | □ |
| 297 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台鐵即時資料中斷時會明講：時鐘旁出現「中斷」並寫明資料停在幾點，今日台鐵動態也會註明暫時無法跟車 | When TRA live data is interrupted, the clock now shows “Interrupted” with the last update time, and today’s service notice explains that following is temporarily unavailable. | 台湾鉄路のリアルタイム情報が途切れた場合、時計の横に「中断」と最終更新時刻を表示し、追跡できないことも案内します。 | — | □ |
| 298 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台鐵即時誤點已套用（每分鐘更新）· {n} 班誤點中 · 來源 {time} | TRA live delays applied (updated every minute) · {n} trains delayed · source {time} | 台湾鉄路の遅延を反映（毎分更新）・{n}列車が遅延中・データ時刻{time} | — | □ |
| 299 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台鐵即時誤點資料中斷 | TRA live delay feed unavailable | 台湾鉄路のリアルタイム遅延データが中断 | — | □ |
| 300 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台鐵即時誤點與車站地址介接交通部 TDX 平臺（TrainLiveBoard／Station，每分鐘更新） | TRA live delays and station addresses from the Ministry of Transportation TDX TrainLiveBoard and Station APIs, refreshed every minute. | 台湾鉄路のリアルタイム遅延と駅住所は交通部 TDX の TrainLiveBoard／Station API から毎分更新しています。 | — | □ |
| 301 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台鐵官方 OpenData（ods.railway.gov.tw）——每日時刻表、車站基本資料、車種代碼表，依「政府資料開放授權條款」使用 | TRA OpenData (ods.railway.gov.tw): daily timetables, station information and train-class codes, used under Taiwan’s Open Government Data Licence. | 台湾鉄路公式 OpenData（ods.railway.gov.tw）の毎日時刻表・駅基本情報・列車種別コードを、政府資料開放授権条款に基づき利用しています。 | — | □ |
| 302 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台鐵軌道及阿里山林鐵的 TDX 缺口補線取自 © OpenStreetMap 貢獻者（ODbL），經 Overpass／OSM API | Gaps in TRA and Alishan Forest Railway geometry are filled from © OpenStreetMap contributors (ODbL) through the Overpass and OSM APIs. | 台湾鉄路と阿里山林業鉄路の不足する線形は © OpenStreetMap contributors（ODbL）を Overpass／OSM API 経由で補っています。 | — | □ |
| 303 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台鐵套用官方即時誤點；北捷依官方秒級到站倒數逐班校正，高捷、機捷、高雄輕軌依官方到站看板校正。官方資料中斷或你的裝置時鐘明顯不準時，上方的「LIVE」會轉成灰色「非即時」，表示畫面是依稍早的資料投射——點一下時鐘可以看到是哪一項出狀況。台鐵當日官方公告停駛的班次不會出現在地圖上，但看板仍會列出並標成「停駛」。 | TRA uses official live delays. Taipei Metro is corrected train by train from official second-by-second countdowns; Kaohsiung Metro, Taoyuan Metro and Kaohsiung Light Rail use official arrival boards. If official data stops or your device clock is inaccurate, LIVE turns into a grey Not live label; tap the clock for details. Officially cancelled TRA services disappear from the map but remain marked Cancelled on station boards. | 台湾鉄路は公式のリアルタイム遅延を使用します。台北メトロは秒単位の公式到着カウントダウン、高雄メトロ・桃園メトロ・高雄ライトレールは公式到着案内で補正します。公式データの停止や端末時計のずれがあると、LIVEが灰色の「非リアルタイム」になります。時計を押すと原因を確認できます。公式に運休となった台湾鉄路の列車は地図から消えますが、駅案内には「運休」と表示されます。 | — | □ |
| 304 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台鐵套用官方即時誤點；北捷依官方秒級到站倒數逐班校正，高捷、機捷、高雄輕軌依官方到站看板校正。官方資料中斷或你的裝置時鐘明顯不準時，上方的「LIVE」會轉成灰色「推估」，表示畫面是依稍早的資料投射。台鐵當日官方公告停駛的班次不會出現在地圖上，但看板仍會列出並標成「停駛」。 | TRA uses official live delays. Supported metro systems are corrected from official arrival boards. If live data stops or your device clock is inaccurate, LIVE turns into a grey Estimate badge. Officially cancelled TRA trains disappear from the map but remain marked as cancelled on station boards. | 台湾鉄路は公式遅延、対応メトロは公式到着案内で補正します。公式データが途切れた場合や端末時刻が不正確な場合、LIVE は灰色の「推定」に変わります。公式運休の台湾鉄路列車は地図から消え、駅案内には「運休」と表示されます。 | — | □ |
| 305 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台鐵最高等級的城際列車。 | TRA’s highest-category intercity train. | 台湾鉄路で最上位の都市間列車です。 | — | □ |
| 306 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台鐵誤點目前非即時：依 {time} 的即時資料投射 · {n} 班誤點中 | TRA delays are not live: projected from the live data at {time} · {n} delayed trains | 台湾鉄路の遅延情報は非リアルタイムです：{time}時点のデータから推定・{n}本が遅延中 | — | □ |
| 307 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台鐵誤點推估（依 {time} 即時資料投射）· {n} 班誤點中 | TRA delay estimate projected from {time} live data · {n} trains delayed | {time}のリアルタイム情報から台湾鉄路の遅延を推定・{n}列車が遅延中 | — | □ |
| 308 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台鐵環島幹線與各支線依當日真實時刻表運行（回到現在時刻自動套用即時誤點），阿里山林鐵同框（依官方公告時刻表，無即時資訊）— 點列車跟隨、點車站看班次。 | TRA main and branch lines follow today’s timetable with live delays at the current time. Alishan Forest Railway trains use the official timetable without live data. Tap a train to follow it or a station for arrivals. | 台湾鉄路の幹線・支線は当日の時刻表で運行し、現在時刻では遅延情報を反映します。阿里山森林鉄道は公式時刻表のみでリアルタイム情報はありません。列車をタップすると追跡、駅をタップすると到着案内を表示します。 | — | □ |
| 309 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台灣高鐵即時軌跡 | Taiwan High Speed Rail Live | 台湾高速鉄道ライブ | — | □ |
| 310 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 台灣鐵道即時軌跡 | Taiwan Rail Live | 台湾鉄道ライブ | — | □ |
| 311 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 外觀 | Appearance | 表示 | — | □ |
| 312 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 外觀:自動 | Appearance: Auto | 表示：自動 | — | □ |
| 313 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 外觀:亮 | Appearance: Light | 表示：ライト | — | □ |
| 314 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 外觀：亮／暗／自動 | Appearance: light / dark / automatic | 外観：ライト／ダーク／自動 | — | □ |
| 315 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 外觀:暗 | Appearance: Dark | 表示：ダーク | — | □ |
| 316 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 外觀切換：亮／暗／自動 | Appearance: light / dark / auto | 表示：ライト／ダーク／自動 | — | □ |
| 317 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 左右拖曳調整時刻（1 像素＝1 分鐘），方向鍵每次 1 分鐘；點時間數字可直接指定時刻 | Drag to adjust time (1 px = 1 min); arrow keys adjust by one minute. Tap the time to enter it directly. | 左右にドラッグして時刻を調整（1px＝1分）。矢印キーは1分刻み。時刻をタップすると直接入力できます。 | — | □ |
| 318 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 平 | × | 踏 | — | □ |
| 319 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 平交道 | Level crossings | 踏切 | — | □ |
| 320 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 平交道：開 | Crossings: On | 踏切：オン | — | □ |
| 321 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 平交道記號 | Level-crossing markers | 踏切表示 | — | □ |
| 322 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 平交道記號已開——拉近地圖後點任一處，看接下來通過的車 | Level-crossing markers are on—zoom in and tap one for upcoming trains | 踏切マーカーを表示しました。拡大してマーカーをタップしてください。 | — | □ |
| 323 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 平交道顯示中（點擊關閉） | Level crossings are shown (tap to hide) | 踏切を表示中（タップで非表示） | — | □ |
| 324 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 平均最快 | Fastest average speed | 平均速度トップ | — | □ |
| 325 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 平均誤點 | Average delay | 平均遅延 | — | □ |
| 326 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 平原號 | Plains Explorer | 平原号 | — | □ |
| 327 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 平溪老街與天燈的故鄉，山城小站 | A mountain-town station known for Pingxi Old Street and sky lanterns. | 平渓老街と天燈で知られる山あいの駅です。 | — | □ |
| 328 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 平溪線 | Pingxi Line | 平渓線 | — | □ |
| 329 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 平溪線放天燈的中心，鄰近十分瀑布，鐵軌從老街店家門前穿過 | The heart of Pingxi Line sky-lantern culture, near Shifen Waterfall, with trains running directly through the old street. | 平渓線の天燈文化の中心。十分瀑布に近く、線路が老街の店先を通ります。 | — | □ |
| 330 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 平溪線終點，日式木造站房（歷史建築）與老街 | Pingxi Line terminus with a historic Japanese wooden station and old street. | 平渓線の終点。歴史建築の木造駅舎と老街があります。 | — | □ |
| 331 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 打開「護照」 | Open Passport | 「パスポート」を開く | — | □ |
| 332 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 未來 60 分鐘無列車 | No trains in the next 60 minutes | 今後60分間に列車はありません | — | □ |
| 333 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 未命名地點 | Unnamed place | 名称未設定の場所 | — | □ |
| 334 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 未連結動畫 | Not linked to animation | アニメーション未対応 | — | □ |
| 335 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 末班車次 | Last trains | 終電候補 | — | □ |
| 336 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 末班車提醒 | Last-train alert | 終電通知 | — | □ |
| 337 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 本站為個人愛好者專案，與台灣鐵路公司及各捷運公司皆無關。 | An independent hobby project, not affiliated with Taiwan’s railway or metro operators. | 個人運営の趣味プロジェクトで、台湾の鉄道・メトロ各社とは関係ありません。 | — | □ |
| 338 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 本站為個人愛好者專案，與台灣鐵路公司及各捷運公司皆無關。台鐵套用官方即時誤點；北捷、高捷、桃園機捷與高雄輕軌營運時段依官方到站看板即時校正；新北捷運（環狀線、淡海輕軌、安坑輕軌）營運時段依官方列車動態即時校正；其餘捷運／輕軌依當日官方時刻表推演（部分路線無公開逐班時刻，為班距推算）。實際到離站時刻請以各營運機構官方資訊為準。 | This independent enthusiast project is not affiliated with TRA or any metro operator. TRA official delays are applied; supported metro systems use official arrival boards or train tracking during service hours. Other systems follow official timetables, with some routes estimated from headways. Always confirm actual service with the operator. | 個人運営の非公式プロジェクトで、台湾鉄路および各交通事業者とは関係ありません。台湾鉄路の公式遅延と、対応メトロの公式到着案内・列車位置情報を反映します。その他は公式時刻表、一部は運転間隔から推定します。実際の運行は各事業者の公式情報をご確認ください。 | — | □ |
| 339 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 本站為個人愛好者專案，與台灣鐵路公司及各捷運公司皆無關。台鐵套用官方即時誤點；北捷與環狀線營運時段依北捷官方秒級到站倒數逐班校正位置（環狀線由新北捷運營運，其到站倒數同源於北捷到站看板）；高捷、桃園機捷與高雄輕軌依官方到站看板即時校正；新北捷運淡海輕軌與安坑輕軌依官方列車動態即時校正；其餘捷運／輕軌依當日官方時刻表推演（部分路線無公開逐班時刻，為班距推算）。實際到離站時刻請以各營運機構官方資訊為準。 | Rail Island is an independent hobby project and is not affiliated with any railway operator. Supported systems use official live delay, arrival-board or train-movement data; others are simulated from official daily timetables or published headways. Always follow the operator’s official information for actual arrivals and departures. | 軌島は個人運営の趣味プロジェクトで、各鉄道事業者とは関係ありません。対応路線では公式の遅延・到着案内・列車位置を反映し、それ以外は公式時刻表または運転間隔から推定します。実際の発着は各事業者の公式情報をご確認ください。 | — | □ |
| 340 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 本站觀測 | Rail Island observation | 軌島による観測 | — | □ |
| 341 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 本專案為免費工具、原始碼公開可查，您的支持幫助我們維護伺服器與持續改善內容 | Rail Island is free and open source. Your support helps cover servers and ongoing improvements. | 軌島は無料のオープンソースツールです。ご支援はサーバー維持と改善に役立てられます。 | — | □ |
| 342 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 本路線有{system}通阻公告，班次可能停駛——以官方公告為準 | There is a {system} service alert for this route; trains may be suspended—follow the official notice | この路線に影響する{system}の運行情報があります。運休の可能性があるため公式情報をご確認ください | — | □ |
| 343 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 正在合併這台裝置與雲端資料… | Merging this device with cloud data… | この端末とクラウドのデータを統合中… | — | □ |
| 344 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 正在定位你的位置… | Locating you… | 現在地を取得中… | — | □ |
| 345 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 正在重新取得統一捷運即時模型；尚未達到斷訊判定門檻 | Reconnecting to the unified metro model; the outage threshold has not yet been reached | 統合メトロモデルを再取得中です。まだ中断判定の時間には達していません | — | □ |
| 346 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 正在裝置內讀取與解析… | Reading and parsing on this device… | この端末で読み取り・解析中… | — | □ |
| 347 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 正在跟一班車——小卡的 × 可以結束 | Now following a train—use × on the card to stop | 列車を追跡中です。カードの×で終了できます。 | — | □ |
| 348 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 正在讀取方案與訂閱資格… | Loading plans and subscription status… | プランと購入状況を確認中… | — | □ |
| 349 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 正在讀取登入狀態… | Checking sign-in status… | ログイン状態を確認中… | — | □ |
| 350 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 正在讀取購買資格… | Checking purchase eligibility… | 購入資格を確認中… | — | □ |
| 351 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 用「視角」切換：跟車＝跟著一班車跑；群車＝鏡頭停在當下最忙的路段看列車交錯 | Change View: Follow tracks one train; Traffic watches trains cross at a busy section | 「視点」で切替：追跡は1列車、群列車は混雑区間を固定表示 | — | □ |
| 352 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 用頁尾的「回報問題或建議」告訴我， | Use “Report an issue or suggestion” in the footer, or  | フッターの「問題・提案を報告」または | — | □ |
| 353 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 用票根勾選要看的車種與路線 | Use the ticket controls to choose train types and routes | 切符型の項目で列車種別と路線を選択 | — | □ |
| 354 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 用瀏覽器開啟 | Open in browser | ブラウザで開く | — | □ |
| 355 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 目的站 | destination | 目的駅 | — | □ |
| 356 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 目前沒有即時或重播狀態 | No live or replay status is available | リアルタイム／リプレイ状態はありません | — | □ |
| 357 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 目前車數 | Trains now | 現在の列車数 | — | □ |
| 358 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 目前的檢視沒有「{station}」，請切到含該站的分頁再點 | “{station}” is not in the current view. Switch to a tab containing the station and try again. | 現在の表示に「{station}」がありません。この駅を含むタブへ切り替えてください。 | — | □ |
| 359 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 目前班次未連結動畫 | These arrivals are not currently linked to the animation | 現在、到着案内はアニメーションに対応していません | — | □ |
| 360 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 目前無法取得訂閱方案，請稍後再試。 | Subscription plans are unavailable right now. Please try again later. | 現在プランを取得できません。しばらくしてからお試しください。 | — | □ |
| 361 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 目前誤點 {n} 分 | {n} min late now | 現在{n}分遅れ | — | □ |
| 362 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 目前請在軌島 App 內訂閱；訂閱後同一個軌島帳號在網站也會自動生效。 | Please subscribe in the Rail Island app. Plus will then activate automatically on the web for the same account. | 現在は軌島アプリ内でご購入ください。同じアカウントでWeb版にも自動反映されます。 | — | □ |
| 363 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 立即同步 | Sync now | 今すぐ同期 | — | □ |
| 364 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 交通部 TDX 運輸資料流通服務——北捷／機捷／新北捷（淡海・安坑・三鶯）／中捷／高捷（含輕軌）的路線幾何、站序、逐班時刻表與班距資料 | Ministry of Transportation TDX: route geometry, station order, timetables and headways for Taipei, Taoyuan, New Taipei, Taichung and Kaohsiung metro and light rail systems. | 交通部 TDX の路線形状、駅順、列車別時刻表、運転間隔データを台北・桃園・新北・台中・高雄のメトロ／LRTに利用しています。 | — | □ |
| 365 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 先不要 | Not now | 後で | — | □ |
| 366 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 先看看軌島通行證有什麼 | See what the Rail Island Pass includes | 軌島パスの内容を見る | — | □ |
| 367 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 先跟一班車 | Follow a train | 列車を追跡 | — | □ |
| 368 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 先跟著你要搭的那班車 | First follow the train you are riding | 乗車する列車を追跡 | — | □ |
| 369 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 全 | All | 全 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 370 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 全／台／高／捷 | All / TRA / HSR / Metro | 全／台鉄／高鉄／メトロ | — | □ |
| 371 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 全日同時運行列車數（依時刻表）——點擊圖表跳到該時刻 | Trains running through the day (timetable) — tap the chart to jump to that time | 一日の運行列車数（時刻表）—グラフをタップして時刻を変更 | — | □ |
| 372 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 全日班次走勢 | All-day train volume | 一日の運行本数 | — | □ |
| 373 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 全台 415 處台鐵平交道，看接下來哪班車會通過。 | See upcoming trains at 415 TRA level crossings across Taiwan. | 台湾鉄路の踏切415か所で次に通過する列車を確認できます。 | — | □ |
| 374 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 全台同框 | All Taiwan | 台湾全体 | — | □ |
| 375 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 全台運量最大車站，台鐵、高鐵、捷運三鐵共構 | Taiwan’s busiest station, shared by TRA, high-speed rail and Taipei Metro. | 台湾最大の利用者数を持ち、台湾鉄路・高速鉄道・メトロが集まる駅です。 | — | □ |
| 376 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 全台鐵道一次看 — 台鐵、高鐵、阿里山林鐵與各捷運／輕軌皆依當日時刻表同一時間軸運行（台鐵套即時誤點；主要捷運營運時段依官方到站看板校正）。 | See railways across Taiwan on one timeline—TRA, high-speed rail, the Alishan Forest Railway, metros and light rail. TRA delays and supported metro arrival boards are applied live. | 台湾全土の鉄道を同じ時間軸で表示します。台湾鉄路、高速鉄道、阿里山森林鉄道、各都市のメトロとライトレールに対応し、遅延情報と公式到着案内も反映します。 | — | □ |
| 377 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 全畫面 |  fullscreen |  全画面 | — | □ |
| 378 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 全畫面　地圖下方 | fullscreen · below the map | 全画面・地図の下の | — | □ |
| 379 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 全畫面　地圖下方「隨機跟隨」鈕 | fullscreen · “Follow random train” below the map | 全画面・地図下の「ランダム追跡」ボタン | — | □ |
| 380 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 全畫面地圖（Esc 退出） | Full-screen map (Esc to exit) | 全画面地図（Escで終了） | — | □ |
| 381 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 全畫面自動導演，不用操作，掛著看就好。 | A fullscreen automatic director for watching without interaction. | 全画面の自動カメラで、操作せず眺められます。 | — | □ |
| 382 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 全畫面自動導演（跟車或群車視角），掛著放空用 | Fullscreen auto director (follow-train or train-cluster views) for ambient viewing | 全画面の自動ディレクター（列車追跡／列車群の視点） | — | □ |
| 383 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 全程速度曲線 | Full-trip speed profile | 全区間速度グラフ | — | □ |
| 384 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 全線走完 {n} | {n} routes completed | 全線完乗 {n} | — | □ |
| 385 | i18n/translations.js、i18n/content-translations.js | 共 {n} 站符合 | [one] {n} station found<br>[other] {n} stations found | {n}駅が見つかりました | — | □ |
| 386 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 再按一次或 Esc 退出 | Press again or Esc to exit | もう一度押すかEscで終了 | — | □ |
| 387 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 再按一次就恢復原本的實色紙面 | Turn it off to restore solid panels | オフにすると不透明へ戻る | — | □ |
| 388 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 再點一次取消收藏 | Tap the star again to remove it | もう一度押して解除 | — | □ |
| 389 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 列車 | train | 列車 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 390 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 列車已依北捷官方秒級到站倒數逐班校正： | Trains corrected using Taipei Metro’s official second-level countdowns:  | 台北メトロ公式の秒単位到着カウントダウンで列車ごとに補正： | — | □ |
| 391 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 列車已抵達終點 | The train has reached its terminus. | 列車は終点に到着しました。 | — | □ |
| 392 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 列車已離開官方即時名冊 | The train has left the official live roster. | 列車は公式リアルタイム名簿から離れました。 | — | □ |
| 393 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 列車方向箭頭 | Train direction arrows | 列車の進行方向 | — | □ |
| 394 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 列車行進方向箭頭 | Train direction arrows | 列車の進行方向 | — | □ |
| 395 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 列車行進方向箭頭（顯示中，點擊關閉） | Train direction arrows are shown (tap to hide) | 列車の進行方向を表示中（タップで非表示） | — | □ |
| 396 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 列車位置、誤點資訊與系統覆蓋永遠免費——Plus 不影響準確度。 | Train positions, delay information and system coverage will always stay free—Plus never changes accuracy. | 列車位置、遅延情報、対応路線は今後も無料です。Plusの有無で精度は変わりません。 | — | □ |
| 397 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 列車位置、誤點資訊與系統覆蓋現在免費提供——通行證不影響準確度。 | Train positions, delay information and system coverage remain free—the pass does not affect accuracy. | 列車位置、遅延情報、対応路線は引き続き無料です。パスの有無で精度は変わりません。 | — | □ |
| 398 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 列車依當日時刻表運行，回到現在時刻（1×）會自動套用台鐵即時誤點修正 — 點列車跟隨、點車站看班次，或按地圖角落「探」看今日亮點列車。 | Trains follow today’s timetable. At the current time (1×), TRA live delays are applied automatically. Tap a train to follow it, a station for arrivals, or Explore for today’s highlights. | 列車は当日の時刻表で運行し、現在時刻（1×）では台湾鉄路の遅延を自動反映します。列車をタップして追跡、駅をタップして到着案内を表示できます。 | — | □ |
| 399 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 列車動態 | train tracking | 列車運行情報 | — | □ |
| 400 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 列車跑起來就會記錄——停靠、交會、待避…… | Events appear as the train runs—stops, meets, overtakes and more. | 列車が走ると停車・交換・待避などを記録します。 | — | □ |
| 401 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 列車進站 | Train arriving | 列車が到着 | — | □ |
| 402 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 列車衛星定位 | train GPS | 列車GPS | — | □ |
| 403 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 各週幾平均誤點 | Average delay by weekday | 曜日別平均遅延 | — | □ |
| 404 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 各線列車依當日實際時刻表在城市裡穿梭，營運時段依官方到站看板即時校正（含環狀線；文湖線為班距推算）— 拖曳、縮放看看。 | Trains follow today’s timetable. Taipei Metro and the Circular Line use official live arrival-board corrections; the Wenhu Line is estimated from headways. | 各路線は当日の時刻表で運行します。台北メトロと環状線は公式到着案内でリアルタイム補正し、文湖線は運転間隔から推定します。 | — | □ |
| 405 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 各線列車依當日實際時刻表在城市裡穿梭，營運時段依官方到站看板即時校正（環狀線依新北捷運官方列車動態；文湖線為班距推算）— 拖曳、縮放看看。 | Trains follow today’s timetable. Supported lines use official arrival-board corrections; the Circular Line uses New Taipei Metro train tracking and the Wenhu Line is estimated from headways. | 各路線は当日の時刻表で運行し、対応路線は公式到着案内で補正します。環状線は新北メトロの列車位置情報、文湖線は運転間隔からの推定です。 | — | □ |
| 406 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 合作 | Partner | 協力 | — | □ |
| 407 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 同一天完乘 3 趟 | Complete 3 journeys in one day | 同じ日に3回完乗 | — | □ |
| 408 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 同一段路來回搭滿 100 次 | Travel the same segment 100 times | 同一区間を100回乗車 | — | □ |
| 409 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 同一段路來回搭滿 500 次 | Travel the same segment 500 times | 同一区間を500回乗車 | — | □ |
| 410 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 同名站或共構站（例如板橋的台鐵與捷運）會先讓你選是哪一個。 | For stations that share a name or complex, such as Banqiao, choose the operator you mean. | 同名駅や同一施設の駅では、板橋のように事業者を選択します。 | — | □ |
| 411 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 回 | ! | ! | — | □ |
| 412 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 回到列車 | Return to train | 列車へ戻る | — | □ |
| 413 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 回報問題或建議 | Report an issue or suggestion | 問題・提案を報告 | — | □ |
| 414 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 因存廢故事而得名的「愛情車站」 | The “Love Station,” preserved after a celebrated community campaign. | 保存活動の物語から「愛情駅」と呼ばれる駅です。 | — | □ |
| 415 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 在 App 匯入 Google Maps 已儲存清單，成為軌島的最愛地點 | Import Google Maps saved lists in the app as Rail Island favorite places | アプリでGoogleマップの保存済みリストを軌島のお気に入り場所として読み込み | — | □ |
| 416 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 在 Google 地圖開啟 ↗ | Open in Google Maps ↗ | Google マップで開く ↗ | — | □ |
| 417 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 在「路線完乘」那一列按「收集地圖」 | Press Collection map beside Route completion | 「路線完乗」の「収集マップ」を押す | — | □ |
| 418 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 在月台上等車時，把這一站的下一班倒數放上鎖定畫面與動態島，不用一直把 App 開著。 | While waiting on the platform, put the next-train countdown on the Lock Screen and Dynamic Island instead of keeping the app open. | ホームで待つ間、次の列車のカウントダウンをロック画面とDynamic Islandに表示し、アプリを開いたままにする必要がありません。 | — | □ |
| 419 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 在月台等某一班車時，把那一班的倒數放上鎖定畫面與動態島，不用一直把 App 開著。 | While waiting for a specific train, put its countdown on the Lock Screen and Dynamic Island instead of keeping the app open. | 特定の列車を待つ間、その列車のカウントダウンをロック画面とDynamic Islandに表示できます。 | — | □ |
| 420 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 在台鐵車站等一班車：鎖定畫面倒數 | Wait for a TRA train: Lock Screen countdown | 台湾鉄路の列車を待つ：ロック画面カウントダウン | — | □ |
| 421 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 在地圖定位 | Locate on map | 地図で指定 | — | □ |
| 422 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 在這站等車：鎖定畫面倒數 | Wait at this station: Lock Screen countdown | この駅で待つ：ロック画面カウントダウン | — | □ |
| 423 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 在網站用同一個軌島帳號登入，App 訂的資格就會生效（面板裡的「已經在 App 訂閱了？登入以同步」） | Sign in on the website with the same Rail Island account to use the app subscription here | 同じ軌島アカウントでWebにログインするとAppの購読資格を利用できます | — | □ |
| 424 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 地圖 | Map | 地図 | — | □ |
| 425 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 地圖資料還在載入中 | Map data is still loading | 地図データを読み込み中です | — | □ |
| 426 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 地圖顯示 | Map display | 地図表示 | — | □ |
| 427 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 地震 | Earthquake | 地震 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 428 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 地點 | Places | 場所 | — | □ |
| 429 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 地點 {n} | Place {n} | 場所 {n} | — | □ |
| 430 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 好，提醒我 | Yes, alert me | 通知を許可 | — | □ |
| 431 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 字 | A | A | — | □ |
| 432 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 字級 | Text size | 文字サイズ | — | □ |
| 433 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 字級多了三階（標準／大／特大）：「更多」→ 字級打開「顯示與字級」，選一個，整個介面的字、列高與可點範圍會一起放大，欄位一個都不會被收掉，面板下方有即時預覽。手機把系統字級調到輔助使用級別時，軌島也會自動跟著放大到特大——不想要的話，同一張面板裡可以把「跟隨系統字級」關掉 | Text size now has Standard, Large and Extra large settings under More → Text size. Text, row height and tap targets grow together without hiding fields, with a live preview. Rail Island also follows accessibility text sizes unless Follow system text size is turned off. | 文字サイズに標準／大／特大を追加しました。「その他」→「文字サイズ」で選ぶと、項目を隠さず文字・行・タップ範囲をまとめて拡大し、すぐプレビューできます。アクセシビリティ文字サイズにも追従し、不要なら同じ画面でオフにできます。 | — | □ |
| 434 | i18n/translations.js、i18n/content-translations.js | 安坑輕軌 | Ankeng Light Rail | 安坑ライトレール | — | □ |
| 435 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 安坑輕軌依官方當日時刻表沿安康路串起新店丘陵，營運時段依官方列車動態即時校正 — 拖曳、縮放看看。 | Ankeng light-rail trains follow today’s official timetable and use official train tracking during service hours. | 安坑ライトレールは当日の公式時刻表で運行し、運行時間中は公式列車位置情報で補正します。 | — | □ |
| 436 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 尖峰 | Peak | ラッシュ | — | □ |
| 437 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 年訂閱 | Annual | 年間プラン | — | □ |
| 438 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 成追線 | Chengzhui Line | 成追線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 439 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 成就 | achievements | 実績 | — | □ |
| 440 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 成就解鎖　&lt;b&gt;{achievement}&lt;/b&gt; | Achievement unlocked · &lt;b&gt;{achievement}&lt;/b&gt; | 実績解除　&lt;b&gt;{achievement}&lt;/b&gt; | — | □ |
| 441 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 成就徽章 | Achievement badges | 実績バッジ | — | □ |
| 442 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 收合 ▲ | Collapse ▲ | 閉じる ▲ | — | □ |
| 443 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 收起 ▴ | Show less ▴ | 折りたたむ ▴ | — | □ |
| 444 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 收起資訊卡（跟隨不中斷） | Collapse this card (following continues) | カードをたたむ（追跡は継続） | — | □ |
| 445 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 收集太魯閣號與普悠瑪號兩枚傾斜式車種章 | Collect both Taroko and Puyuma tilting-train stamps | 太魯閣号と普悠瑪号の車種スタンプを収集 | — | □ |
| 446 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 收集全部車種章 | Collect every rolling-stock stamp | 全車種スタンプを収集 | — | □ |
| 447 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 收集地圖 | Collection map | 収集マップ | — | □ |
| 448 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 收集地圖——全路網轉灰，只有你搭過的區間亮起 | Collection map—only the segments you have travelled remain highlighted | 収集マップ—乗車した区間だけを色付きで表示 | — | □ |
| 449 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 收集完成 · {from} → {to} 共 {n} 座站 | Collection complete · {from} → {to}, {n} stations | 収集完了・{from} → {to}、全{n}駅 | — | □ |
| 450 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 收集所有明星列車章 | Collect every star-train stamp | スター列車スタンプをすべて収集 | — | □ |
| 451 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 收集章 | Collection stamps | コレクションスタンプ | — | □ |
| 452 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 收藏台鐵列車後，這裡會集中列出它們近 30 天的準點表現，通行證訂閱者可完整比較——跟隨列車時點資訊卡的收藏鈕即可收藏。 | Favourite TRA trains to compare their past 30 days of punctuality here. Pass subscribers see the complete comparison; use the favourite button on a train card while following. | 台湾鉄路の列車をお気に入りにすると、過去30日の定時性をここで比較できます。完全な比較はパス購読者向けです。追跡中の列車カードから登録できます。 | — | □ |
| 453 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 收藏的台鐵列車，近 30 天準點表現一覽・點一列看 90 天履歷 | Punctuality of favourite TRA trains over 30 days · tap a row for 90-day history | お気に入りの台湾鉄路列車の過去30日定時性・行をタップして90日履歴 | — | □ |
| 454 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 收藏跨裝置雲端同步 | Cloud sync for favorites | お気に入りの端末間同期 | — | □ |
| 455 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 收藏與完乘記錄跨裝置雲端同步 | Cloud sync for favorites and completed journeys | お気に入りと完乗記録の端末間クラウド同期 | — | □ |
| 456 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 早 {n} 分 | {n} min early | {n}分早い | — | □ |
| 457 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 早鳥 | Early bird | 早起き | — | □ |
| 458 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 曲線 ▴ | Profile ▴ | グラフ ▴ | — | □ |
| 459 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 曲線 ▾ | Profile ▾ | グラフ ▾ | — | □ |
| 460 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 有班次的可以直接跟車 | Services running today can be followed directly | 本日運行する列車はそのまま追跡可能 | — | □ |
| 461 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 有新版可更新　{version} | Update available　{version} | 新しい版があります　{version} | — | □ |
| 462 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 此時段無停靠班次 | No stopping services at this time | この時間帯に停車する列車はありません | — | □ |
| 463 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 灰色的章可以點——它隨機挑一班該類列車，從發車前 20 秒開始重播給你跟 | Tap a grey stamp to replay and follow a random train of that type from 20 seconds before departure | 灰色のスタンプをタップすると同種の列車を発車20秒前から再生 | — | □ |
| 464 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 百里行者 | 100 km traveller | 100 kmの旅人 | — | □ |
| 465 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 百站達成 | 100 stations | 100駅達成 | — | □ |
| 466 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 老通勤族 | Veteran commuter | ベテラン通勤者 | — | □ |
| 467 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 自由座 {cars} 車 | Non-reserved cars {cars} | 自由席 {cars}号車 | — | □ |
| 468 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 自由瀏覽中：點擊回到列車，恢復置中跟隨 | Browsing freely: tap to return to the train and resume centred following. | 自由閲覧中：タップすると列車へ戻り、中央追跡を再開します。 | — | □ |
| 469 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 自動 | Auto | 自動 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 470 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 自動（夜間自動淡化） | Auto (fades at night) | 自動（夜間は薄く表示） | — | □ |
| 471 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 自動＝跟著系統的深色模式走。 | Automatic follows your system appearance. | 自動は端末のダークモードに従います。 | — | □ |
| 472 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 自強號 | Tze-Chiang Limited Express | 自強号 | — | □ |
| 473 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 行程已結束 | Journey ended | 旅程は終了しました | — | □ |
| 474 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 行程分享 | Journey sharing | 旅程共有 | — | □ |
| 475 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 行程分享：把你在哪班車上分享給朋友 | Trip sharing: tell friends which train you are on | 旅程共有：乗車中の列車を友だちに共有 | — | □ |
| 476 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 行駛中 | Running | 運行中 | — | □ |
| 477 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 西部幹線（山線） | Western Trunk Line (Mountain Line) | 西部幹線（山線） | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 478 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 西部幹線南端，南迴鐵路的起點 | Southern end of the western main line and starting point of the South Link Line. | 西部幹線の南端で、南廻線の起点です。 | — | □ |
| 479 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 伯朗大道與池上便當的故鄉 | Home of Brown Boulevard and the Chishang railway lunchbox. | 伯朗大道と池上弁当のふるさとです。 | — | □ |
| 480 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 你已經在搭乘中了，先下車再上車 | A ride is already being recorded. End it before boarding again. | すでに乗車記録中です。先に下車してください。 | — | □ |
| 481 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 你正在搭 {train} 次，先下車再上車 | You are riding train {train}. End that ride before boarding again. | {train}列車に乗車中です。先に下車してください。 | — | □ |
| 482 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 你的位置只在這台裝置上用來顯示，不會上傳、也不會在背景取用。不給權限也能用，改用下面的「儲存地點」。 | Your position is used only on this device, is never uploaded and is not read in the background. You can decline and use Saved places instead. | 位置は端末内の表示にのみ使用し、アップロードやバックグラウンド取得はしません。許可しなくても「保存地点」を利用できます。 | — | □ |
| 483 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 你的位置僅用於本機顯示、不會上傳。點站看接下來的班次。 | Your location is used only on this device and is not uploaded. Tap a station to see upcoming trains. | 位置情報はこの端末での表示だけに使い、アップロードしません。駅をタップして次の列車を確認できます。 | — | □ |
| 484 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 你的位置僅用於本機顯示與蓋章判定、不會上傳。點站看班次，按「蓋章」把這座站收進旅程護照。 | Your location is used only on this device to display your position and validate stamps; it is not uploaded. Tap a station for trains or Stamp to add it to your passport. | 位置情報はこの端末での表示とスタンプ判定だけに使い、アップロードしません。駅をタップして列車を確認し、「スタンプ」で旅のパスポートに追加できます。 | — | □ |
| 485 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 你附近沒有本圖收錄的車站 | No mapped station was found near you | 現在地付近に収録済みの駅はありません | — | □ |
| 486 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 你附近的車站 | Stations near you | 現在地付近の駅 | — | □ |
| 487 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 初乘紀念 | First journey | 初乗り記念 | — | □ |
| 488 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 刪除失敗：{error} | Delete failed: {error} | 削除できませんでした：{error} | — | □ |
| 489 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 刪除帳號與同步資料 | Delete account and synced data | アカウントと同期データを削除 | — | □ |
| 490 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 即時 | Live | リアルタイム | — | □ |
| 491 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 即時名單更新中；暫沿用這台車上一批已確認的軌跡 | Live roster updating; temporarily using this train’s last confirmed trajectory | リアルタイム名簿を更新中です。この列車は直前に確認できた軌跡を一時的に使用します | — | □ |
| 492 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 即時更新中 | Updating live data | リアルタイム情報を更新中 | — | □ |
| 493 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 即時資料 | Live data | リアルタイム情報 | — | □ |
| 494 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 即時資料異常 | Live data issue | リアルタイムデータ異常 | — | □ |
| 495 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 即時運行狀態請洽官方： | Check live service status with the operator:  | 最新の運行情報は公式サイトをご確認ください： | — | □ |
| 496 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 即時誤點 | live delays | リアルタイム遅延 | — | □ |
| 497 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 即時模型這一輪一台列車都沒有回報，已改用官方名冊或班表繼續顯示 | The live model reported no trains this cycle; an official roster or timetable is being used instead | この更新ではリアルタイムモデルから列車が一台も届かなかったため、公式名簿または時刻表で表示を継続します | — | □ |
| 498 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 即將 | Due | まもなく | — | □ |
| 499 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 即將抵達目的站 | Arriving at the destination | まもなく目的駅 | — | □ |
| 500 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 即將進站 | Arriving | まもなく到着 | — | □ |
| 501 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 吸附軌道依時刻表推算，僅供參考；拖曳釘子可微調位置。 | Track snapping is timetable-based and for reference only. Drag the pin to adjust its position. | 線路への吸着は時刻表に基づく参考表示です。ピンをドラッグして位置を調整できます。 | — | □ |
| 502 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 完成第一趟完乘 | Complete your first full journey | 最初の完乗を達成 | — | □ |
| 503 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 完乘 | Completed | 完乗 | — | □ |
| 504 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 完乘 15 趟 | Complete 15 journeys | 15回完乗 | — | □ |
| 505 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 完乘 5 趟 | Complete 5 journeys | 5回完乗 | — | □ |
| 506 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 完乘一班停靠 50 站以上的慢車 | Complete a train journey with at least 50 stops | 50駅以上に停車する列車を完乗 | — | □ |
| 507 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 完乘一班晚上 10 點後發車的列車 | Complete a train departing after 10 p.m. | 午後10時以降発の列車を完乗 | — | □ |
| 508 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 完乘一班清晨 6 點前發車的列車 | Complete a train departing before 6 a.m. | 午前6時前発の列車を完乗 | — | □ |
| 509 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 完乘記錄 | Completed trips | 完乗記録 | — | □ |
| 510 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 完乘達成　&lt;b&gt;{train} 次&lt;/b&gt; 抵達終點 | Journey complete · &lt;b&gt;train {train}&lt;/b&gt; reached its terminus | 完乗達成　&lt;b&gt;{train}列車&lt;/b&gt;が終点に到着 | — | □ |
| 511 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 完整更新歷史（依主題分類） | Earlier updates by topic | これまでの更新（テーマ別） | — | □ |
| 512 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 快 | early | 早着 | — | □ |
| 513 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 快捷鍵： | Keyboard:  | ショートカット： | — | □ |
| 514 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 我上車了 | I’m on board | 乗車する | — | □ |
| 515 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 我下車了 · 訂到 {station} | Get off · destination: {station} | 下車する・行先：{station} | — | □ |
| 516 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 我的 | My Rail Island | マイ軌島 | — | □ |
| 517 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 我的車・準點 | My trains · Punctuality | お気に入り列車・定時性 | — | □ |
| 518 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 我的最愛 | My favourites | お気に入り | — | □ |
| 519 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 我的最愛（點擊跟隨） | My favourites (tap to follow) | お気に入り（タップして追跡） | — | □ |
| 520 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 我的最愛列車 | Favorite trains | お気に入り列車 | — | □ |
| 521 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 找不到 CSV、JSON 或 GeoJSON 清單 | No CSV, JSON or GeoJSON lists found | CSV、JSON、GeoJSONのリストが見つかりません | — | □ |
| 522 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 找不到「{station}」，請手動搜尋車站 | Could not find “{station}”. Search for the station manually. | 「{station}」が見つかりません。駅を手動で検索してください。 | — | □ |
| 523 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 找不到軌道 | No track found | 線路が見つかりません | — | □ |
| 524 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 找不到這個行程連結對應的班次 | No train matches this journey link. | この旅程リンクに対応する列車が見つかりません。 | — | □ |
| 525 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 找不到就檢查一下車次是不是今天的班次——停駛或加班車不一定在時刻表裡。 | If you cannot find it, check that the train runs today. Cancelled or extra services may not appear in the timetable. | 見つからない場合は、本日の列車か確認してください。運休や臨時列車は時刻表にない場合があります。 | — | □ |
| 526 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 找不到路網資料（data/*.json 還在準備） | Rail network data is unavailable (data files are still being prepared). | 鉄道ネットワークデータを読み込めません（データを準備中です）。 | — | □ |
| 527 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 把介面收掉，只留地圖。 | Hide the interface and leave only the map. | UIを隠して地図だけを表示します。 | — | □ |
| 528 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 把地圖拉近就看得到記號 | Zoom in to see the markers | 地図を拡大してマーカーを表示 | — | □ |
| 529 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 把底圖換成衛星照片，看得到實際的軌道與站場。 | Switch to satellite imagery to see the real tracks and station grounds. | 背景を衛星画像に切り替え、実際の線路と駅構内を確認できます。 | — | □ |
| 530 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 把家、公司、拍車點存下來，看有哪些火車會經過那裡。 | Save home, work or a photography spot and see which trains pass nearby. | 自宅・職場・撮影地点を保存し、近くを通る列車を確認します。 | — | □ |
| 531 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 把捷運站放上主畫面或鎖定畫面，不開 App 就看得到下一班往哪裡、還有幾分鐘。 | Put a metro station on your Home or Lock Screen to see the next direction and countdown without opening the app. | メトロ駅をホーム画面やロック画面に置き、アプリを開かずに次の列車の方向と残り時間を確認できます。 | — | □ |
| 532 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 把現在的畫面（地點＋時間）或正在跟的車分享給別人，對方打開就是同一個畫面。 | Share the current place and time or the train you are following so someone else opens the same view. | 現在の場所と時刻、または追跡中の列車を共有し、同じ画面を開けます。 | — | □ |
| 533 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 更多 | More | その他 | — | □ |
| 534 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 更多設定：外觀、軌道與路線、平交道、站介紹、方向箭頭、省電模式 | More settings: appearance, tracks and routes, level crossings, station notes, direction arrows and power saving | その他の設定：表示、線路・路線、踏切、駅情報、進行方向、省電力 | — | □ |
| 535 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 更新紀錄 | Updates | 更新情報 | — | □ |
| 536 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 更新提醒 | Update alert | 通知を更新 | — | □ |
| 537 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 步行到車站 | Walking time to station | 駅までの徒歩時間 | — | □ |
| 538 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 每一列下面會說明原因——資料幾分鐘沒更新、裝置時鐘差幾秒、時間軸不在現在 | Each row explains the reason, such as stale data, device-clock difference or a timeline away from now | 各行に、データ更新の遅れ、端末時計の差、タイムラインが現在でないなどの理由が表示されます | — | □ |
| 539 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 每班車的誤點履歷與統計圖表 | Delay history and charts for each train | 列車ごとの遅延履歴・統計グラフ | — | □ |
| 540 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 決定地圖上要出現哪些系統的車。手機收在頂端那顆圓鈕裡，點一下展開四個選項。 | Choose which rail systems appear on the map. On phones, tap the round button at the top to reveal four choices. | 地図に表示する鉄道を選びます。スマートフォンでは上部の丸いボタンを押すと4項目が開きます。 | — | □ |
| 541 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 沒有可匯入的地點 | No places can be imported | 読み込める場所がありません | — | □ |
| 542 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 沒有資料 | No data | データがありません | — | □ |
| 543 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 沒有選擇可讀取的檔案 | No readable file was selected | 読み込めるファイルが選択されていません | — | □ |
| 544 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 沙崙線 | Shalun Line | 沙崙線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 545 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 災害觸發 | Hazard trigger | 災害情報による検出 | — | □ |
| 546 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 系統字級調到輔助使用級別時自動切到特大，調回來就跟著回來 | Automatically uses Extra large at accessibility text sizes, then returns when the system size does | システムがアクセシビリティ文字サイズになると自動で特大にし、元へ戻すと追従して戻ります | — | □ |
| 547 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 系統沒有回應，請再點一次 | The system did not respond. Tap again. | システムが応答しませんでした。もう一度タップしてください。 | — | □ |
| 548 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 身障友善座位 | Accessible seating | バリアフリー席 | — | □ |
| 549 | i18n/translations.js、i18n/content-translations.js | 車次 | Train | 列車 | — | □ |
| 550 | i18n/translations.js、i18n/content-translations.js | 車站 | station | 駅 | — | □ |
| 551 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 車站收集 | Station collection | 駅コレクション | — | □ |
| 552 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 車站收集章 | Station stamps | 駅スタンプ | — | □ |
| 553 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 車站收集達 100 座 | Collect 100 stations | 100駅収集 | — | □ |
| 554 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 車站收集達 25 座 | Collect 25 stations | 25駅収集 | — | □ |
| 555 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 車站巡禮 | Station pilgrimage | 駅めぐり | — | □ |
| 556 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 車站特色 | Station highlight | 駅の見どころ | — | □ |
| 557 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 車站預告與地圖上的 {n} 台列車共用同一份即時身分與時間軸 | Station arrivals and {n} trains on the map share one live identity and timeline | 駅の到着案内と地図上の{n}列車は同じリアルタイムの識別情報と時間軸を使用 | — | □ |
| 558 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 車廂擁擠度（北捷官方） | Car crowding（official Taipei Metro data） | 車両混雑度（台北メトロ公式） | — | □ |
| 559 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 車進站自動換成下一班，時間到自動收起 | The card advances after each arrival and closes when time expires | 到着すると次の列車へ進み、時間になると自動で閉じます | — | □ |
| 560 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 車號牌 | train label | 列車番号 | — | □ |
| 561 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 車號牌是可以點的。點了鏡頭就跟著那班車，左下角出現它的下一站與誤點。 | Train labels are interactive. Tap one to follow it and see its next stop and delay. | 列車番号をタップするとカメラが追跡し、次駅と遅延を表示します。 | — | □ |
| 562 | i18n/translations.js、i18n/content-translations.js | 車種 | Type | 列車種別 | — | □ |
| 563 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 車種（篩選列車） | Train type (filter) | 列車種別（絞り込み） | — | □ |
| 564 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 車種全圖鑑 | Complete train gallery | 車種図鑑完成 | — | □ |
| 565 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 車種圖鑑 | Rolling-stock gallery | 車種図鑑 | — | □ |
| 566 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 車種圖鑑　&lt;b&gt;{name}&lt;/b&gt; 蓋章！ | Fleet Gallery · &lt;b&gt;{name}&lt;/b&gt; stamped! | 車両図鑑　&lt;b&gt;{name}&lt;/b&gt; スタンプ獲得！ | — | □ |
| 567 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 並套用 |  and corrected with  | し、 | — | □ |
| 568 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 使用 Apple 登入 | Sign in with Apple | Appleでログイン | — | □ |
| 569 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 使用 Google 登入 | Sign in with Google | Googleでログイン | — | □ |
| 570 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 使用條款 | Terms of Use | 利用規約 | — | □ |
| 571 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 使用說明 | Help | 使い方 | — | □ |
| 572 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 來源： | Source:  | 出典： | — | □ |
| 573 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 來源：TDX 營運通阻／狀態公告（平時每 5 分鐘；災害示警生效時加強重查） | Source: TDX service/status alerts (every 5 minutes normally; checked more often during active hazard warnings) | 出典：TDX運行／状態情報（通常5分ごと、災害警報中は確認頻度を上げます） | — | □ |
| 574 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 來源：TDX 營運通阻／狀態公告（每 5 分鐘更新）· 動畫依當日時刻表推演，台鐵誤點已逐車套用、部分捷運營運時段依官方即時資訊校正；但停駛、取消或加開的班次與臨時班距調整不會反映——畫面上列車仍可能照表出現，實際運行以官方公告為準 | Source: TDX service alerts (updated every 5 minutes). The animation follows today’s timetable, applies TRA delays and corrects supported metro lines with official live data. Cancellations, extra services and temporary headway changes may not be reflected, so trains may still appear as scheduled. Always follow the operator’s official notice. | 出典：TDX運行情報（5分ごとに更新）。アニメーションは当日の時刻表を基に、台湾鉄路の遅延と対応路線の公式リアルタイム情報を反映します。運休・臨時列車・一時的な運転間隔変更は反映されず、列車が時刻表どおり表示される場合があります。実際の運行は公式情報をご確認ください。 | — | □ |
| 575 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 例如：家、公司、常去的車站 | For example: Home, work or a favorite station | 例：自宅、会社、よく使う駅 | — | □ |
| 576 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 依官方班距推算（未公告逐班時刻），位置為示意 | Estimated from official headways (no per-train timetable); positions are illustrative | 公式運転間隔から推定（列車ごとの時刻表なし）。位置はイメージです | — | □ |
| 577 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 依官方當日時刻表 | Official timetable | 公式時刻表 | — | □ |
| 578 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 依官方當日時刻表行駛 | Running to today’s official timetable | 当日の公式時刻表で運行 | — | □ |
| 579 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 依林鐵官方時刻表（無即時資訊） | Alishan official timetable (no live data) | 阿里山森林鉄道の公式時刻表（リアルタイム情報なし） | — | □ |
| 580 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 依時刻表（無誤點資訊） | Timetable only (no delay data) | 時刻表のみ（遅延情報なし） | — | □ |
| 581 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 依稍早官方資料推估 | Estimated from the latest official data | 直近の公式情報から推定 | — | □ |
| 582 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 其餘 {n} 筆預設不匯入；可用上方選項一次納入。 | The other {n} are excluded by default. Use the option above to include them all. | 残り{n}件は初期状態では読み込みません。上の項目から一括で追加できます。 | — | □ |
| 583 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 到 | To | 下車駅 | — | □ |
| 584 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 到站 | Arr. | 着 | — | □ |
| 585 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 到站看板 | arrival boards | 到着案内 | — | □ |
| 586 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 到站倒數會顯示在鎖定畫面與動態島，卡片上隨時可按「結束」收起。 | Arrival countdowns appear on the Lock Screen and Dynamic Island. Tap “End” on the card at any time to dismiss it. | 到着カウントダウンはロック画面とDynamic Islandに表示されます。カードの「終了」でいつでも閉じられます。 | — | □ |
| 587 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 到站提醒 | Arrival reminders | 到着通知 | — | □ |
| 588 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 到訪 | Visited | 訪問済み | — | □ |
| 589 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 到訪 {n} | {n} visited | 訪問 {n} | — | □ |
| 590 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 到達前 | Before arrival | 到着前 | — | □ |
| 591 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 取個名字存起來 | Name and save it | 名前を付けて保存 | — | □ |
| 592 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 取消 | Cancel | キャンセル | — | □ |
| 593 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 取消跟隨 | Stop following | 追跡を終了 | — | □ |
| 594 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 取消跟隨 {train} 次 | Stop following train {train} | {train}列車の追跡を終了 | — | □ |
| 595 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 取消跟隨（{service}） | Stop following ({service}) | 追跡を終了（{service}） | — | □ |
| 596 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 命名地點 | Name this place | 場所に名前を付ける | — | □ |
| 597 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 夜行者 | Night rider | 夜の旅人 | — | □ |
| 598 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 官方中斷 {n} 分 | Official feed down {n} min | 公式データ中断 {n}分 | — | □ |
| 599 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 官方名冊已更新，已結束這台車的跟隨 | The official roster changed, so following this train ended. | 公式名簿が更新されたため、この列車の追跡を終了しました。 | — | □ |
| 600 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 官方即時 | Official live | 公式リアルタイム | — | □ |
| 601 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 官方即時（{n} 線改用備案） | Official live ({n} lines using fallback) | 公式リアルタイム（{n}路線は代替データ） | — | □ |
| 602 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 官方到站時間；目前無法唯一對應動畫班次 | Official arrival time; this service cannot currently be matched uniquely to an animated train | 公式到着時刻です。現在はアニメーションの列車を一意に特定できません | — | □ |
| 603 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 官方訊號中斷 {n} 分鐘；位置與到站時刻皆為推估，僅供參考 | Official feed unavailable for {n} minutes; positions and arrivals are estimates for reference only | 公式データが{n}分間中断しています。位置と到着時刻は推定の参考表示です | — | □ |
| 604 | i18n/translations.js、i18n/content-translations.js | 定位 | Locate | 現在地 | — | □ |
| 605 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 定位我的位置，看附近有哪些平交道、火車是否快通過 | Locate me and show nearby stations, crossings and trains | 現在地と付近の駅・踏切・列車を表示 | — | □ |
| 606 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 定位逾時，請在收訊較好處再試一次；或用「釘」直接點你的位置看附近火車。 | Location timed out. Try again with a better signal, or use the pin to select your location and see nearby trains. | 位置情報の取得がタイムアウトしました。電波の良い場所で再試行するか、ピンで現在地を指定してください。 | — | □ |
| 607 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 定位與附近車站 | Location and nearby stations | 現在地と周辺駅 | — | □ |
| 608 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 宜蘭 | Yilan | 宜蘭 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 609 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 尚未完成第一次同步 | First sync not completed | 初回同期は未完了です | — | □ |
| 610 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 尚未取得北捷即時名冊，或時鐘已離開「現在」，目前使用班表備案 | The Taipei Metro live roster is unavailable or the clock is not at “now”; using the timetable fallback | 台北メトロのリアルタイム名簿を未取得、または時計が「現在」ではないため、時刻表を使用しています | — | □ |
| 611 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 尚未發車 | Not departed | 発車前 | — | □ |
| 612 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 尚無逐站記錄。 | No station records yet. | 駅ごとの記録はまだありません。 | — | □ |
| 613 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 底部「亮點」或工具列的「探」 | Open Highlights at the bottom or use the Highlights button on the toolbar | 下部またはツールバーの「見どころ」を開く | — | □ |
| 614 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 底圖 | Map | 地図 | — | □ |
| 615 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 往 {station} | To {station} | {station}方面 | — | □ |
| 616 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 往{station} | To {station} | {station}方面 | — | □ |
| 617 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 往九份、金瓜石的門戶，平溪／深澳線轉乘站 | Gateway to Jiufen and Jinguashi and a transfer station for the Pingxi and Shen’ao lines. | 九份・金瓜石への玄関口で、平渓線と深澳線の乗換駅です。 | — | □ |
| 618 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 或銀行轉帳 | Or make a bank transfer | 銀行振込 | — | □ |
| 619 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 或點角落「⋯」選「以外部瀏覽器開啟」 | Or tap ⋯ in the corner and choose “Open in external browser” | または隅の「⋯」から「外部ブラウザで開く」を選択してください | — | □ |
| 620 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 抵達前 | before arrival | 到着の | — | □ |
| 621 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 拉太近時衛星影像可能還沒有那麼清晰的圖資。 | Very close zoom levels may not have equally detailed imagery. | 最大拡大では同じ解像度の画像がない場合があります。 | — | □ |
| 622 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 拖曳地圖時，軌道與列車不再比底圖慢半拍；縮放（手機兩指、滑鼠滾輪）收尾的那一瞬，軌道不會先跳回原處再彈回來 | Tracks and trains now stay aligned with the base map while dragging. They also remain stable when pinch or wheel zooming ends. | 地図をドラッグするとき、線路と列車が背景地図から遅れなくなりました。ピンチ／ホイールズーム終了時の跳ね戻りも解消しました。 | — | □ |
| 623 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 拖倍速滑桿，1× 到 60× | Drag the speed slider from 1× to 60× | 速度スライダーを1×〜60×で調整 | — | □ |
| 624 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 放空模式 | Ambient mode | 鑑賞モード | — | □ |
| 625 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 放空模式的背景音樂重新整理過：曲目從 29 首增加到 57 首，分成 Afloat、Midnight stories、Moonlake、Rainy day、Star &amp; Neon、peaceful piano 六組不同氛圍 | Ambient-mode music grew from 29 to 57 tracks across six moods: Afloat, Midnight stories, Moonlake, Rainy day, Star &amp; Neon and peaceful piano. | 鑑賞モードのBGMを29曲から57曲へ増やし、Afloat、Midnight stories、Moonlake、Rainy day、Star &amp; Neon、peaceful pianoの6つの雰囲気に分けました。 | — | □ |
| 626 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 明星列車 | Star trains | スター列車 | — | □ |
| 627 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 明星列車　&lt;b&gt;{name}&lt;/b&gt; 蓋章！ | Named Train · &lt;b&gt;{name}&lt;/b&gt; stamped! | 名物列車　&lt;b&gt;{name}&lt;/b&gt; スタンプ獲得！ | — | □ |
| 628 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 明星集郵冊 | Star train album | スター列車アルバム | — | □ |
| 629 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 昔日產煤重鎮，如今以「貓村」聞名，保有煤礦遺跡 | A former coal-mining centre now famous for its cat village and mining remains. | かつての炭鉱の町。現在は「猫村」と炭鉱遺構で知られます。 | — | □ |
| 630 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 服務條款 | Terms of Service | 利用規約 | — | □ |
| 631 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 東部幹線 | Eastern Trunk Line | 東部幹線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 632 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 東部鐵路的門戶大站 | A major gateway station for eastern Taiwan. | 台湾東部鉄道の主要玄関駅です。 | — | □ |
| 633 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 沼平線 | Zhaoping Line | 沼平線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 634 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 狀態 | Status | 稼働状況 | — | □ |
| 635 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 直接指定時刻 | Enter a time | 時刻を入力 | — | □ |
| 636 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 空白鍵 | Space | Space | — | □ |
| 637 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 花東縱谷的稻香小鎮 | A rice-growing town in the East Rift Valley. | 花東縦谷の田園に囲まれた町です。 | — | □ |
| 638 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 花蓮 | Hualien | 花蓮 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 639 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 花蓮 → 樹林 · 終點 19:25 抵達 | Hualien → Shulin · arrives at terminus 19:25 | 花蓮 → 樹林・終点19:25着 | — | □ |
| 640 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 表定 {time} 到 | Scheduled {time} | 所定 {time}着 | — | □ |
| 641 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 表定 {time}{delay}。開軌島看即時位置 → | Scheduled {time}{delay}. Open Rail Island for the live position → | 所定{time}{delay}。軌島で現在位置を見る → | — | □ |
| 642 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 近 30 天平均誤點 {average} 分・準點 {rate}%（{days} 天） | 30-day average delay {average} min · {rate}% on time ({days} days) | 過去30日平均遅延{average}分・定時{rate}%（{days}日） | — | □ |
| 643 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 近 30 天最準點的 10 班車，依單日最糟全程誤點排序（同分再比平均誤點、有紀錄天數、車次號）；至少 20 天有紀錄才列入計算，資料來源台鐵 | The 10 most punctual trains over the past 30 days, ranked by their worst full-route delay day. Ties use average delay, days recorded and train number; at least 20 days of TRA records are required. | 過去30日で最も定時性の高い10列車。1日の全区間最大遅延で順位付けし、同点時は平均遅延・記録日数・列車番号を比較します。台湾鉄路の記録が20日以上ある列車が対象です。 | — | □ |
| 644 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 近 90 天逐日最終誤點 | Final daily delay over 90 days | 過去90日の日別最終遅延 | — | □ |
| 645 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 近 90 天逐日誤點長條圖 | Daily delays over the past 90 days | 過去90日の日別遅延グラフ | — | □ |
| 646 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 近期活動 | Recent events | 最近のイベント | — | □ |
| 647 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 近期活動（來源中文原文） | Recent events (Chinese source text) | 最近のイベント（中国語原文） | — | □ |
| 648 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 長按主畫面空白處進入編輯，從加入小工具的入口搜尋「軌島」 | Touch and hold an empty area on the Home Screen, enter edit mode and search for Rail Island in Add Widget | ホーム画面の空白を長押しして編集し、ウィジェット追加から「軌島」を検索 | — | □ |
| 649 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 阿里山林業鐵路從嘉義平原一路盤旋上山，途中經過獨立山螺旋與第一分道的之字形折返——列車依官方公告時刻表運行（本線無即時資訊，且常因天候或維修停駛）。祝山線觀日列車每天隨日出調整、前一日 16:30 才公告，畫面依官方日出時間表推算並標示「推算」，實際請以林鐵官網為準。 | The Alishan Forest Railway climbs from Chiayi through mountain spirals and switchbacks. Trains use the official timetable with no live data and may be suspended for weather or maintenance. Zhushan sunrise trains are estimated from the official sunrise table; confirm the previous-day announcement on the operator’s website. | 阿里山森林鉄道は嘉義から山岳区間を登り、ループ線やスイッチバックを通ります。リアルタイム情報はなく、天候や工事で運休する場合があります。祝山線の日の出列車は公式の日の出表から推定しているため、前日16:30の公式発表をご確認ください。 | — | □ |
| 650 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 阿里山林鐵 | Alishan Forest Railway | 阿里山森林鉄道 | — | □ |
| 651 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 阿里山站到沼平站 1.3 公里的園區支線，單程約 6 分鐘；站旁沼平公園種了約 600 株櫻花，是阿里山賞櫻密度最高的區域。 | A 1.3 km, six-minute park branch from Alishan to Zhaoping, beside a park with around 600 cherry trees. | 阿里山―沼平間1.3km、約6分の園内支線で、駅前には約600本の桜があります。 | — | □ |
| 652 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 阿里山站到神木站的園區支線，單程約 7 分鐘；神木站海拔 2,138 公尺，下車即達巨木群棧道，可步行親近香林神木與千年紅檜巨木群。 | A seven-minute park branch to Sacred Tree station at 2,138 m, beside the giant-tree boardwalks. | 阿里山から標高2,138mの神木駅へ約7分。駅から巨木群の遊歩道へ歩けます。 | — | □ |
| 653 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 阿里山森林鐵路的起點 | Starting point of the Alishan Forest Railway. | 阿里山林業鉄路の起点です。 | — | □ |
| 654 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 阿里山號 | Alishan Express | 阿里山号 | — | □ |
| 655 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 附上的只有版本、目前畫面、地圖視角、跟隨中的列車與瀏覽器版本，不含帳號與定位。開 issue 需要 GitHub 帳號，issue 內容是公開的。 | Attachments include only the app version, current screen, map view, followed train and browser version—not your account or location. A GitHub account is required and the issue is public. | 添付されるのはバージョン、現在の画面、地図表示、追跡中の列車、ブラウザ版だけで、アカウントや位置情報は含みません。GitHubアカウントが必要で、issueは公開されます。 | — | □ |
| 656 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 附近火車 | Nearby trains | 近くの列車 | — | □ |
| 657 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 附近找不到車站 | No nearby stations | 近くに駅がありません | — | □ |
| 658 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 附近沒有鐵路 | No railway nearby | 近くに鉄道がありません | — | □ |
| 659 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 附近車站 | Nearby stations | 近くの駅 | — | □ |
| 660 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 附近車站——我附近有哪些車站，最近的車什麼時候到 | Nearby stations and the next arriving trains | 現在地付近の駅と次の到着列車 | — | □ |
| 661 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 附掛郵政／行包車廂 | Mail or baggage car | 郵便・荷物車連結 | — | □ |
| 662 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 非即時 | Not live | 非リアルタイム | — | □ |
| 663 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 亮 | Light | ライト | — | □ |
| 664 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 亮點 | Highlights | 注目 | — | □ |
| 665 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 前往更新 | Update now | 更新する | — | □ |
| 666 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 南投 | Nantou | 南投 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 667 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 南迴與台東線交會的東南門戶 | Southeastern gateway where the South Link and Taitung lines meet. | 南廻線と台東線が交わる南東部の玄関駅です。 | — | □ |
| 668 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 南迴線 | South Link Line | 南廻線 | — | □ |
| 669 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 南迴線枋寮—臺東的觀光列車：柴電機車牽引的復古藍皮客車，全台最後可開窗、無空調的普快車廂。沿途貼著太平洋與中央山脈尾稜跑，2021 年整修後以觀光列車之姿復駛。 | A South Link tourist train from Fangliao to Taitung, formed of heritage blue coaches with opening windows and no air conditioning. It returned in 2021 after restoration. | 枋寮から台東へ南廻線を走る観光列車です。窓を開けられる非冷房のレトロな藍皮客車をディーゼル機関車が牽引し、2021年に復活しました。 | — | □ |
| 670 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 南迴線臺東—枋寮的觀光列車：柴電機車牽引的復古藍皮客車，全台最後可開窗、無空調的普快車廂。沿途貼著太平洋與中央山脈尾稜跑，2021 年整修後以觀光列車之姿復駛。 | A South Link tourist train from Taitung to Fangliao, formed of heritage blue coaches with opening windows and no air conditioning. It returned in 2021 after restoration. | 台東から枋寮へ南廻線を走る観光列車です。窓を開けられる非冷房のレトロな藍皮客車をディーゼル機関車が牽引し、2021年に復活しました。 | — | □ |
| 671 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 南部平原上的木造老站 | A historic wooden station on Taiwan’s southern plains. | 南部平原にたたずむ歴史ある木造駅です。 | — | □ |
| 672 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 屏東 | Pingtung | 屏東 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 673 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 恢復購買 | Restore purchases | 購入を復元 | — | □ |
| 674 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 按「分享」 | Press Share | 「共有」を押す | — | □ |
| 675 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 按「放空模式」 | Press Ambient mode | 「鑑賞モード」を押す | — | □ |
| 676 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 按「附近車站」回到目前位置，點清單裡的站直接開看板 | Tap Nearby stations to return to your current position, then tap a station to open its board | 「近くの駅」で現在地に戻り、一覧の駅を押すと案内を開けます | — | □ |
| 677 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 按「前往 GitHub 開 issue」，內容會幫你填好 | Tap Continue to GitHub issue; the report will be filled in for you | 「GitHubでissueを開く」を押すと内容が自動入力されます | — | □ |
| 678 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 按上方的「離開」回到即時地圖 | Press Leave at the top to return to the live map | 上部の「終了」でリアルタイム地図へ戻る | — | □ |
| 679 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 按小卡上的「結束」停止跟車(× 只是把卡收起來,車還在跟) | Use End on the card to stop following. × only hides the card; following continues. | カードの「終了」で列車追跡を止めます。×はカードを隠すだけで追跡は続きます。 | — | □ |
| 680 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 按卡片上的「我上車了」，並選好在哪一站下車 | Tap “I’m on board” on the card and choose where you will get off | カードの「乗車する」を押して下車駅を選択 | — | □ |
| 681 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 按地圖上的「附近車站」 | Tap Nearby stations on the map | 地図の「周辺駅」を押す | — | □ |
| 682 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 按地圖上的「隨機跟隨」 | Press Follow random train on the map | 地図の「ランダム追跡」を押す | — | □ |
| 683 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 按地圖右上的四角鈕 | Press the four-corner button at top right | 地図右上の四隅ボタンを押す | — | □ |
| 684 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 按頁尾（手機在「更多」的關於段）的「回報問題或建議」 | Select Report a problem or suggestion in the footer; on phones it is under About in More | フッターの「問題・提案を報告」を押す（スマートフォンでは「その他」の概要欄） | — | □ |
| 685 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 按站名下方的「追蹤這站」，選方向與要追蹤多久（30／60／90 分鐘） | Tap Follow this station below the station name, then choose a direction and 30, 60 or 90 minutes | 駅名の下にある「この駅を追跡」を押し、方向と30／60／90分を選ぶ | — | □ |
| 686 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 按站名旁的「追蹤一班車」 | Tap Follow a train beside the station name | 駅名の横にある「列車を追跡」を押す | — | □ |
| 687 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 查看 | View | 表示 | — | □ |
| 688 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 查看 {train} 次誤點履歷・近 30 天最糟單日全程誤點 {worst} 分、平均 {average} 分、{days} 天有紀錄 | View train {train} delay history · past 30 days: worst full-route delay {worst} min, average {average} min, {days} days recorded | {train}列車の遅延履歴を見る・過去30日の最大全区間遅延{worst}分、平均{average}分、記録{days}日 | — | □ |
| 689 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 查看通行證 | View Pass | パスを見る | — | □ |
| 690 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 查看價格 | View price | 価格を表示 | — | □ |
| 691 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 查無車次「{query}」 | No train found for “{query}” | 「{query}」に一致する列車はありません | — | □ |
| 692 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 查無車站、車次或列車 | No matching station, train number or train | 一致する駅・列車番号・列車はありません | — | □ |
| 693 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 查無班次 | Train not found | 列車が見つかりません | — | □ |
| 694 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 為避免手機卡頓，這些地點不逐筆顯示；勾選後會全部納入。 | These places are not shown one by one to keep phones responsive. Select this to include them all. | スマートフォンの負荷を抑えるため個別表示していません。選択するとすべて読み込みます。 | — | □ |
| 695 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 省電 | Power save | 省電力 | — | □ |
| 696 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 省電中 | Power saving | 省電力中 | — | □ |
| 697 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 省電模式（30fps） | Power saving (30 fps) | 省電力（30fps） | — | □ |
| 698 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 省電模式（更新降頻至約 30fps，手機掛著看更省電、更不易卡） | Power saving (about 30 fps for lower battery use) | 省電力モード（約30fps） | — | □ |
| 699 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 省電模式已開，畫面更新降到約 30fps | Power saving is on; display updates are limited to about 30 fps. | 省電力モードを有効にし、更新を約30fpsに制限しました。 | — | □ |
| 700 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 省電模式已開：更新降頻至約 30fps、關閉高速預抓（點擊關閉） | Power saving is on: about 30 fps with high-speed prefetch disabled (tap to turn off) | 省電力モード：更新を約30fpsに制限し高速先読みを停止（タップで解除） | — | □ |
| 701 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 看 {name} 介紹 | Read about {name} | {name}の紹介を見る | — | □ |
| 702 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 看下一站、誤點、全程速度曲線 | Check the next stop, delay and full-route speed curve | 次駅・遅延・全区間の速度曲線を確認 | — | □ |
| 703 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 看完整說明 | Full guide | 詳しい使い方 | — | □ |
| 704 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 看更新內容 | What’s new | 更新内容を見る | — | □ |
| 705 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 看車 | Watch trains | 列車を見る | — | □ |
| 706 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 看到不對的地方，可以帶著當下的畫面資訊回報。 | Report a problem together with details about the current screen. | 問題を見つけたら、現在の画面情報と一緒に報告できます。 | — | □ |
| 707 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 看板 | arrival boards | 案内表示 | — | □ |
| 708 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 看板由近到遠列出接下來要進站的車，還有幾分鐘到。 | The board lists approaching trains in arrival order with their countdowns. | 到着順に列車と残り時間を表示します。 | — | □ |
| 709 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 看板列出接下來的班次與倒數 | Read upcoming services and countdowns | 次の列車とカウントダウンを確認 | — | □ |
| 710 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 看板校正 | Arrival-board correction | 案内表示で補正 | — | □ |
| 711 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 看板推估 | Arrival-board estimate | 案内表示から推定 | — | □ |
| 712 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 看看這個地點的即時列車動態 | See live train movements at this place | この場所のリアルタイム列車を見る | — | □ |
| 713 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 看哪裡還是灰的，就是還沒去過的地方 | Grey segments are places you have not travelled yet | 灰色の場所が未乗車区間 | — | □ |
| 714 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 看得更清楚 | Clearer viewing | 見やすくする | — | □ |
| 715 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 約 {distance} | about {distance} | 約{distance} | — | □ |
| 716 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 約 {n} km/h | About {n} km/h | 約{n} km/h | — | □ |
| 717 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 紅橘兩線與環狀輕軌依當日實際時刻表在港都穿梭，營運時段依官方到站看板即時校正 — 拖曳、縮放看看。 | Kaohsiung Red and Orange lines and the Circular Light Rail follow today’s timetable with official live-board correction during service hours. | 高雄メトロの赤線・オレンジ線とライトレールは当日の時刻表で運行し、運行時間中は公式到着案内で補正します。 | — | □ |
| 718 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 背景音樂 | Background music | BGM | — | □ |
| 719 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 背景音樂（進放空模式會自動開始） | Background music (starts automatically in ambient mode) | BGM（鑑賞モードで自動再生） | — | □ |
| 720 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 苗栗 | Miaoli | 苗栗 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 721 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 英文與日文再補齊品牌介紹、使用說明、特色車站與列車、觀光列車圖鑑，以及旅程護照和成就；外語版更新紀錄保留最近八筆精簡內容，較早歷史改用主題摘要 | English and Japanese now cover the brand story, help guide, featured stations and trains, tourist-train gallery, Journey Passport and achievements. Other languages show eight concise recent updates plus earlier topic summaries. | 英語・日本語でブランド紹介、使い方、特色駅・列車、観光列車図鑑、旅程パスポート、実績を追加しました。最近8件は簡潔に翻訳し、以前の履歴はテーマ別にまとめています。 | — | □ |
| 722 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 英文與日文現在也會即時更新最愛、今日台鐵、誤點履歷、帳號同步、Google 清單匯入、分享與「追蹤這站」；並補上災害監看、捷運終點、點選列車／車站、成就說明，以及 iPhone 即時動態與小工具，官方活動只有中文時則標示「中文原文」 | English and Japanese now update favourites, Today’s TRA, delay history, account sync, Google list imports, sharing and Track this station immediately. Hazard monitoring, metro destinations, train/station pickers, achievement descriptions, iPhone Live Activities and widgets are also covered; Chinese-only official events are labelled as source text. | 英語・日本語で、お気に入り、本日の台湾鉄路、遅延履歴、アカウント同期、Googleリスト読み込み、共有、「この駅を追跡」もすぐ切り替わるようになりました。災害監視、メトロの行先、列車／駅の選択表示、実績の説明、iPhoneのライブアクティビティとウィジェットにも対応し、中国語だけの公式イベントは原文であることを明記します。 | — | □ |
| 723 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 英文與日文現在也會即時更新最愛、今日台鐵、誤點履歷、帳號同步、Google 清單匯入、分享與「追蹤這站」；並補上災害監看、捷運終點、點選列車／車站、成就說明、顯示與字級、所在地鏡頭，以及 iPhone 即時動態與小工具，官方活動只有中文時則標示「中文原文」 | English and Japanese now update favourites, Today’s TRA, delay history, account sync, Google list imports, sharing and Track this station immediately. Hazard monitoring, metro destinations, train/station pickers, achievement descriptions, display and text size, the location camera, iPhone Live Activities and widgets are also covered; Chinese-only official events are labelled as source text. | 英語・日本語で、お気に入り、本日の台湾鉄路、遅延履歴、アカウント同期、Googleリスト読み込み、共有、「この駅を追跡」もすぐ切り替わるようになりました。災害監視、メトロの行先、列車／駅の選択表示、実績の説明、表示と文字サイズ、現在地カメラ、iPhoneのライブアクティビティとウィジェットにも対応し、中国語だけの公式イベントは原文であることを明記します。 | — | □ |
| 724 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 訂閱月票 | Monthly pass | 月間パス | — | □ |
| 725 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 訂閱未完成：{error} | Subscription not completed: {error} | サブスクリプションを完了できませんでした：{error} | — | □ |
| 726 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 訂閱在軌島 App 內完成，網站不收費 | Subscriptions are purchased in the Rail Island app; the website does not charge | 購読は軌島App内で行い、Webサイトでは課金しません | — | □ |
| 727 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 訂閱年票 | Annual pass | 年間パス | — | □ |
| 728 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 訂閱到期前會依商店規則自動續訂扣款；你可以隨時在 App Store／Google Play 或帳號的訂閱設定中取消，取消後於當期結束時停止續訂。 | The subscription renews automatically under the store’s rules. You can cancel at any time in App Store, Google Play or your account subscription settings; access continues until the end of the current period. | サブスクリプションはストアの規則に従って自動更新されます。App Store、Google Play、またはアカウントの設定からいつでも解約でき、現在の期間終了後に更新が停止します。 | — | □ |
| 729 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 訂閱制的加值內容。列車位置、誤點資訊與系統覆蓋現在免費提供，不受訂閱影響。 | Optional subscription features. Train positions, delays and system coverage remain free and are not affected by subscribing. | 任意のサブスクリプション機能です。列車位置・遅延・対応路線は無料のままで、購読の影響を受けません。 | — | □ |
| 730 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 訂閱軌島通行證才會同步 | Subscribe to the Rail Island Pass to sync | 軌島パスの購読で同期できます | — | □ |
| 731 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 訂閱通行證，集中比較收藏的 {n} 班台鐵車準點表現 | Subscribe to compare punctuality for {n} favourite TRA trains | パスを購読してお気に入り{n}列車の定時性を比較 | — | □ |
| 732 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 訂閱通行證解鎖完整履歷 | Subscribe to unlock full history | パスを購読して全履歴を表示 | — | □ |
| 733 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 訂閱通行證解鎖我的車 | Subscribe to unlock My Trains | パスを購読してお気に入り列車を利用 | — | □ |
| 734 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 訂閱管理請至 App Store 的訂閱設定。 | Manage your subscription in App Store subscription settings. | サブスクリプションはApp Storeの設定で管理してください。 | — | □ |
| 735 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 訂閱管理請至 App Store／Google Play 的訂閱設定。 | Manage your subscription in App Store or Google Play subscription settings. | App StoreまたはGoogle Playのサブスクリプション設定で管理してください。 | — | □ |
| 736 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌 | ≋ | 軌 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 737 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌島 | Rail Island | 軌島 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 738 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌島 {version} 已經上架 | Rail Island {version} is available | 軌島 {version}を公開しました | — | □ |
| 739 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌島 {version} 有什麼新的 | What’s new in Rail Island {version} | 軌島 {version}の新機能 | — | □ |
| 740 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌島 {version} 更新了什麼 | What changed in Rail Island {version} | 軌島 {version}の更新内容 | — | □ |
| 741 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌島 Plus | Rail Island Plus | 軌島 Plus | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 742 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌島 Plus 已啟用 | Rail Island Plus is active. | 軌島 Plusが有効になりました。 | — | □ |
| 743 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌島 Plus 訂閱 | Rail Island Plus subscription | 軌島 Plus サブスクリプション | — | □ |
| 744 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌島 railisland.tw | Rail Island · railisland.tw | 軌島 railisland.tw | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 745 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌島 railisland.tw。看台鐵此刻準點嗎、捷運怎麼穿梭全台，一張會動的台灣鐵道地圖。 | Rail Island is a live animated map of Taiwan’s railways, from TRA and high-speed rail to metro and light rail. | 軌島は、台湾鉄路・高速鉄道・各都市のメトロとライトレールを一枚の地図で表示する鉄道アニメーションです。 | — | □ |
| 746 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌島行程分享 | Rail Island journey sharing | 軌島の旅程共有 | — | □ |
| 747 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌島使用者 | Rail Island user | 軌島ユーザー | — | □ |
| 748 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌島怎麼玩 | How to use Rail Island | 軌島の使い方 | — | □ |
| 749 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌島帳號 | Rail Island account | 軌島アカウント | — | □ |
| 750 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌島帳號與同步資料已刪除 | Rail Island account and synced data deleted | 軌島アカウントと同期データを削除しました | — | □ |
| 751 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌島通行證 | Rail Island Pass | 軌島パス | — | □ |
| 752 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌島通行證已啟用 | Rail Island Pass activated | 軌島パスを有効にしました | — | □ |
| 753 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌島通行證是 App 數位功能訂閱，不是實際乘車票券。 | Rail Island Pass is a subscription to digital app features, not a real travel ticket. | 軌島パスはアプリのデジタル機能のサブスクリプションで、実際の乗車券ではありません。 | — | □ |
| 754 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌島通行證與跨裝置同步 | Rail Island Pass and cloud sync | 軌島パスとクラウド同期 | — | □ |
| 755 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌道 | Tracks | 線路 | — | □ |
| 756 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌道:自動 | Tracks: Auto | 線路：自動 | — | □ |
| 757 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌道:淡化 | Tracks: Faint | 線路：薄く | — | □ |
| 758 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌道:隱藏 | Tracks: Hidden | 線路：非表示 | — | □ |
| 759 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌道要不要畫、要看哪些車種與路線，都在這裡。 | Choose track visibility and which train types or routes appear. | 線路表示と、表示する列車種別・路線を選びます。 | — | □ |
| 760 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌道與路線 | Tracks and routes | 線路と路線 | — | □ |
| 761 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌道與路線：顯示方式與車種/路線篩選 | Tracks and routes: display and filters | 線路・路線：表示と列車種別／路線フィルター | — | □ |
| 762 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌道顯示 | Track display | 線路表示 | — | □ |
| 763 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌道顯示：{mode} | Track display: {mode} | 線路表示：{mode} | — | □ |
| 764 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 軌道顯示：自動／淡化／隱藏 | Track display: automatic, faded or hidden | 線路表示：自動／薄く／非表示 | — | □ |
| 765 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 重新整理 | Refresh | 更新 | — | □ |
| 766 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 重播 | Replay | リプレイ | — | □ |
| 767 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 重播中 | Replaying | リプレイ中 | — | □ |
| 768 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 降雨 | Rainfall | 大雨 | — | □ |
| 769 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 面板半透明 | Translucent panels | パネルを半透明にする | — | □ |
| 770 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 音量 | Volume | 音量 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 771 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 音樂 | Music | 音楽 | — | □ |
| 772 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 首次會問一次定位權限 | The app asks for location permission the first time | 初回に位置情報の許可を確認 | — | □ |
| 773 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 首次會問定位權限；Android 建議開啟「精確位置」 | The app asks for location permission the first time. On Android, precise location is recommended. | 初回は位置情報の許可を求めます。Androidでは「正確な位置情報」を推奨します。 | — | □ |
| 774 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 修好 iPhone App 的語言按鈕：上一個測試版漏帶英、日文字典，按了仍全顯示繁中；現在 App 會完整帶入三語資源。英文與日文文案也完成第二輪複核，統一日文的「鑑賞模式」、車次與乘車按鈕用語，並修順英文災害監看句子 | Fixed the language buttons in the iPhone app: the previous test build omitted the English and Japanese dictionaries, so the interface stayed in Traditional Chinese. The app now bundles all three languages. A second copy review also standardized Japanese viewing-mode, train-number and ride-button wording and cleaned up the English hazard-monitoring sentence. | iPhone Appの言語ボタンを修正しました。前のテスト版では英語・日本語の辞書が同梱されず、切り替えても繁体字中国語のままでした。今後は3言語のデータをすべてAppに収録します。英語・日本語の文言も再校正し、日本語の「鑑賞モード」、列車番号、乗車ボタンを統一して、英語の災害監視文も整えました。 | — | □ |
| 775 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 倍速 | Speed | 速度 | — | □ |
| 776 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 倍速　 |  speed ·  |  倍速　 | — | □ |
| 777 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 倒數依官方即時到站資訊更新。這項不需要通行證。 | The countdown uses official live arrivals. No pass is required. | 公式リアルタイム到着情報で更新します。軌島パスは不要です。 | — | □ |
| 778 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 倒數照官方表定加即時誤點，車到站後自動收起。鎖定畫面同時只留一張等候卡——追蹤台鐵這班會把捷運那張收掉。時鐘不在「現在」時會先幫你帶回現在。這項不需要通行證。 | The countdown combines the official timetable and live delay, then closes after arrival. Only one waiting card can remain on the Lock Screen, so following a TRA train replaces a metro waiting card. If the timeline is away from Now, it returns first. No pass is required. | 公式時刻表とリアルタイム遅延からカウントダウンし、到着後に閉じます。ロック画面の待機カードは同時に1枚だけなので、台湾鉄路を追跡するとメトロのカードは終了します。時刻が「現在」でない場合は先に現在へ戻ります。軌島パスは不要です。 | — | □ |
| 779 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 候 | M | M | — | □ |
| 780 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 候補中 | Standby | 待機中 | — | □ |
| 781 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 原生登入沒有回傳可驗證的 ID token | Native sign-in did not return a verifiable ID token | ネイティブログインから検証可能なIDトークンが返されませんでした | — | □ |
| 782 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 原始碼公開，歡迎貢獻 | Open source—contributions welcome | オープンソース・コントリビューション歓迎 | — | □ |
| 783 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 展開 ▼ | Expand ▼ | 展開 ▼ | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 784 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 峰值{n}分 | Peak {n} min | 最大{n}分 | — | □ |
| 785 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 座 | stations | 駅 | — | □ |
| 786 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 扇形車庫「火車頭旅館」的所在 | Home of Changhua’s fan-shaped roundhouse, the “locomotive hotel.” | 扇形庫「機関車のホテル」で知られます。 | — | □ |
| 787 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 旅 | Pass | 旅 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 788 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 旅程日誌 | Journey log | 旅の記録 | — | □ |
| 789 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 旅程護照 | Travel passport | 旅のパスポート | — | □ |
| 790 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 旅程護照（完乘記錄與收集章） | Travel passport (completed trips and stamps) | 旅のパスポート（完乗記録・スタンプ） | — | □ |
| 791 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 旅程護照與完乘章 | Journey Passport and completion stamps | 旅程パスポートと完乗スタンプ | — | □ |
| 792 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 時刻表 ▴ | Timetable ▴ | 時刻表 ▴ | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 793 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 時刻表 ▾ | Timetable ▾ | 時刻表 ▾ | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 794 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 時刻表模擬 | Timetable simulation | 時刻表シミュレーション | — | □ |
| 795 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 時刻推算 | Estimated timetable | 推定時刻 | — | □ |
| 796 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 時段 | Service period | 時間帯 | — | □ |
| 797 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 時間 ±10 分 | time ±10 min | 時刻 ±10分 | — | □ |
| 798 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 時間軸：暫停、快轉、回看 | Timeline: pause, speed up and rewind | 時間軸：一時停止・早送り・巻き戻し | — | □ |
| 799 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 時間軸不在現在 | Timeline is not at the current time | 時間軸が現在時刻ではありません | — | □ |
| 800 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 時鐘旁邊就是資料狀態——畫面夠寬時直接寫出來（LIVE、非即時、尖峰…），窄的時候依序收成小色點，「即時」那顆最後才收。點一下時鐘，會逐項寫出每一項代表什麼、以及為什麼是這個狀態。 | The data status sits beside the clock. Wide screens show labels such as LIVE, Not live and Peak; narrow screens collapse them into colored dots, keeping the live indicator longest. Tap the clock to see what each item means and why it has that status. | 時計の横がデータ状態です。広い画面ではLIVE、非リアルタイム、ピークなどを文字で表示し、狭い画面では順に色付きの点へ縮小します。時計を押すと各項目の意味と理由を確認できます。 | — | □ |
| 801 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 柴聯自強號 | Diesel Tze-Chiang | ディーゼル自強号 | — | □ |
| 802 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 校 | Fix | 補 | — | □ |
| 803 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 校正，不是列車的實際 GPS 位置；實際到離站時刻請以各營運機構官方資訊為準。 | . They are not GPS positions. Follow each operator’s official information for actual arrivals and departures. | で補正しています。実際のGPS位置ではありません。発着時刻は各事業者の公式情報をご確認ください。 | — | □ |
| 804 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 桃園 | Taoyuan | 桃園 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 805 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 桃園捷運 | Taoyuan Metro | 桃園メトロ | — | □ |
| 806 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 桃園機捷 | Taoyuan Airport MRT | 桃園空港MRT | — | □ |
| 807 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 桌 | W | W | — | □ |
| 808 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 桌面：頂端資訊列上的四顆分頁直接點 | Desktop: select one of the four tabs in the top information bar | デスクトップ：上部情報バーの4つのタブから選ぶ | — | □ |
| 809 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 桌面也可以按 F | On desktop you can also press F | デスクトップではFキーも利用可能 | — | □ |
| 810 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 桌面版的四顆分頁就在頂端資訊列上，直接點就能換 | On desktop, use the four tabs in the top information bar. | デスクトップでは上部の4つのタブで切り替えます。 | — | □ |
| 811 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 桌面按工具列的「通行證」、手機從「更多」→「軌島通行證」，看裡面有哪些內容 | On desktop press Pass; on phone open More → Rail Island Pass | デスクトップは「パス」、スマートフォンは「その他」→「軌島パス」 | — | □ |
| 812 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 海外略過 {n} | {n} outside Taiwan skipped | 台湾外を除外 {n} | — | □ |
| 813 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 海嘯 | Tsunami | 津波 | — | □ |
| 814 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 海線 | Coast Line | 海線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 815 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 海線日式木造老站 | A historic Japanese wooden station on the Coast Line. | 海線に残る歴史ある木造駅です。 | — | □ |
| 816 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 海線最靠海的木造車站 | The Coast Line’s wooden station closest to the sea. | 海線で海に最も近い木造駅です。 | — | □ |
| 817 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 海線僅存的日式木造車站之一 | One of the Coast Line’s surviving Japanese wooden stations. | 海線に残る日本統治期の木造駅の一つです。 | — | □ |
| 818 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 特大 | Extra large | 特大 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 819 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 特大 1.5 | Extra large 1.5 | 特大 1.5 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 820 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 特別列車出沒中 | Special trains running now | 運行中の特別列車 | — | □ |
| 821 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 特殊站介紹 | Featured-station notes | 注目駅の案内 | — | □ |
| 822 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 特等站 | special-class station | 特等駅 | — | □ |
| 823 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 班 | T | T | — | □ |
| 824 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 班表備案 | Timetable fallback | 時刻表による代替 | — | □ |
| 825 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 班距示意列車 | Illustrative headway-based train | 運転間隔によるイメージ列車 | — | □ |
| 826 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 班距改變，已結束跟隨 | Service frequency changed; follow mode ended. | 運転間隔が変わったため追跡を終了しました。 | — | □ |
| 827 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 真的在車上時按一下，沿路每過一站就自動幫你蓋一枚章。 | While aboard, start ride mode to stamp every station you pass. | 実際に乗車中、通過する各駅を自動で収集します。 | — | □ |
| 828 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 真的要結束按卡片上的「結束」 | To stop following, use End on the card. | 追跡を終了するにはカードの「終了」を押します。 | — | □ |
| 829 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 祝山線 | Zhushan Line | 祝山線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 830 | i18n/translations.js、i18n/content-translations.js | 神木線 | Sacred Tree Line | 神木線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 831 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 站 | Stn | 駅 | — | □ |
| 832 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 站介紹 | Station notes | 駅案内 | — | □ |
| 833 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 站台預告與地圖列車共用同一份即時身分與時間軸 | Platform arrivals and map trains share the same live identity and timeline | 駅の到着案内と地図の列車は同じリアルタイム識別情報と時系列を使用します | — | □ |
| 834 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 站站是風景 | Every stop a view | すべての駅が風景 | — | □ |
| 835 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 站站皆停的通勤電聯車。 | A commuter EMU stopping at every station. | 各駅に停車する通勤電車です。 | — | □ |
| 836 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 站等 | Station class | 駅等級 | — | □ |
| 837 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 起 | from | から | — | □ |
| 838 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 追蹤中 | Tracking | 追跡中 | — | □ |
| 839 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 追蹤多久 | Track for | 追跡時間 | — | □ |
| 840 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 追蹤這站 | Track this station | この駅を追跡 | — | □ |
| 841 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 退出全畫面 | Exit full screen | 全画面を終了 | — | □ |
| 842 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 退出全畫面（Esc） | Exit fullscreen (Esc) | 全画面を終了（Esc） | — | □ |
| 843 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 退出極簡 | Exit minimal view | 最小表示を終了 | — | □ |
| 844 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 釘 | Pin | ピン | — | □ |
| 845 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 高 | HSR | 高鉄 | — | □ |
| 846 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 高雄 | Kaohsiung | 高雄 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 847 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 高雄捷運 | Kaohsiung Metro | 高雄メトロ | — | □ |
| 848 | i18n/translations.js、i18n/content-translations.js | 高鐵 | High Speed Rail | 台湾高速鉄道 | — | □ |
| 849 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 高鐵列車依當日真實時刻表沿西部走廊南北奔馳（南港－左營）— 點列車跟隨、點車站看班次。 | High-speed trains follow today’s timetable along the western corridor from Nangang to Zuoying. Tap a train to follow it or a station for arrivals. | 高速鉄道は当日の時刻表に沿って南港－左営間を運行します。列車をタップすると追跡、駅をタップすると到着案内を表示します。 | — | □ |
| 850 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 停最多站 | Most stops | 最多停車駅 | — | □ |
| 851 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 停靠 {n} 站 · 全程約 {duration} | {n} stops · about {duration} total | {n}駅停車・全区間約{duration} | — | □ |
| 852 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 停靠 {station} | Stopped at {station} | {station}に停車 | — | □ |
| 853 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 停靠 {station}（長時間停車——待避或調度） | Stopped at {station} (extended stop—overtake or operations) | {station}に停車（長時間停車―待避または運行調整） | — | □ |
| 854 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 停靠站 | Stops | 停車駅 | — | □ |
| 855 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 停駛 | Cancelled | 運休 | — | □ |
| 856 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 偵測到營運異常跡象（本站推定），位置僅供參考 | Possible service disruption detected by Rail Island; positions are for reference only | 軌島が運行異常の兆候を検出しました。位置は参考表示です | — | □ |
| 857 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 動一下畫面就回到手動 | Interact with the screen to return to manual control | 画面を操作すると手動に戻る | — | □ |
| 858 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 動畫已依官方即時資訊校正： | Animation corrected using official live data:  | 公式リアルタイム情報で補正済み： | — | □ |
| 859 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 動畫已依官方即時資訊校正（約每分鐘更新）： | Animation corrected with official live data (about once per minute):  | 公式リアルタイム情報で補正（約1分ごと）： | — | □ |
| 860 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 動畫依稍早官方資料推估： | Animation estimated from earlier official data:  | 少し前の公式データから推定： | — | □ |
| 861 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 動畫依當日時刻表推演，台鐵誤點已逐車套用、部分捷運營運時段依官方即時資訊校正；但停駛、取消或加開的班次與臨時班距調整不會反映——畫面上列車仍可能照表出現，實際運行以官方公告為準 | The animation follows today’s timetable, applies TRA delays per train and corrects supported metro services with official live data. Cancellations, extra services and temporary headway changes may not be reflected, so trains can still appear as scheduled. Follow official notices for actual service. | アニメーションは当日の時刻表を基に、台湾鉄路の遅延と対応メトロの公式リアルタイム情報を反映します。運休・臨時列車・一時的な運転間隔変更は反映されず、列車が時刻表どおり表示される場合があります。実際の運行は公式情報をご確認ください。 | — | □ |
| 862 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 國立海洋科技博物館的門戶車站 | Gateway station to the National Museum of Marine Science and Technology. | 国立海洋科技博物館の玄関駅です。 | — | □ |
| 863 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 國家鐵路 | National Rail | 都市間鉄道 | — | □ |
| 864 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 基隆 | Keelung | 基隆 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 865 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 將於 {time} 提醒你（以目前誤點 +{n} 分計） | You’ll be alerted at {time} (using the current {n}-min delay). | {time}に通知します（現在の{n}分遅れを反映）。 | — | □ |
| 866 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 將於 {time} 提醒你（依表定時刻） | You’ll be alerted at {time} (scheduled time). | {time}に通知します（所定時刻基準）。 | — | □ |
| 867 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 專為看日出而生的支線，從阿里山站經對高岳爬上 6.25 公里外、海拔 2,451 公尺的祝山車站——全台海拔最高的火車站；觀日列車每天隨日出時刻開行。 | A 6.25 km sunrise line to Zhushan at 2,451 m, Taiwan’s highest railway station; departures change with sunrise time. | 日の出観賞用の6.25kmの支線で、台湾最高所の祝山駅（標高2,451m）へ向かい、日の出時刻に合わせて運転します。 | — | □ |
| 868 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 帳 | Acct | アカ | — | □ |
| 869 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 帳號 | Account | アカウント | — | □ |
| 870 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 帳號同步 | Account sync | アカウント同期 | — | □ |
| 871 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 帳號與資料刪除 | Delete account and data | アカウントとデータの削除 | — | □ |
| 872 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 常看的車次與車站收起來，下次直接從「最愛」進去。 | Save frequently watched trains and stations for quick access. | よく見る列車と駅を保存して、次回すぐ開けます。 | — | □ |
| 873 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 強風 | Strong wind | 強風 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 874 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 從 {n} 班車裡挑出來的 · 點列車跟隨、點活動飛到那一站 | Highlights selected from {n} trains · tap a train to follow or an event to visit its station | {n}本から選んだ見どころ・列車をタップして追跡、イベントをタップして駅へ移動 | — | □ |
| 875 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 從 Google Takeout 選擇「Saved」匯出後，可直接選 ZIP；也支援解壓後的 CSV、JSON 或 GeoJSON。檔案只在這台裝置內解析，不會上傳。 | Export “Saved” from Google Takeout, then choose the ZIP directly. Extracted CSV, JSON and GeoJSON files are also supported. Files are parsed only on this device and are never uploaded. | Google Takeoutで「Saved」を書き出し、ZIPをそのまま選択できます。展開後のCSV、JSON、GeoJSONにも対応します。ファイルはこの端末内だけで解析し、アップロードしません。 | — | □ |
| 876 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 從「接下來的班次」挑你要等的那一班 | Choose your train from Upcoming services | 「次の列車」から待つ列車を選ぶ | — | □ |
| 877 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 從下拉選一項——選車次會直接開始跟車 | Choose a result. Selecting a train starts following it immediately. | 候補を選びます。列車を選ぶとすぐ追跡を開始します。 | — | □ |
| 878 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 從底部「最愛」看全部 | Open Favorites at the bottom to see everything | 下部の「お気に入り」で一覧表示 | — | □ |
| 879 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 從發車一路跟到終點就蓋一枚完乘章（調速可以・跳時間不算）· 灰色的章點了帶你從發車搭一趟 | Follow a train from departure to its terminus to earn a stamp (speed changes are OK; time jumps do not count). Tap a gray stamp to join from departure. | 始発から終点まで追跡すると完乗スタンプを獲得できます（速度変更は可、時刻変更は不可）。灰色のスタンプをタップすると始発から追跡します。 | — | □ |
| 880 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 從發車一路跟到終點就蓋一枚完乘章（調速可以・跳時間不算）· 灰色的章點了帶你搭一趟 | Follow a train from departure to its terminus to earn a stamp (speed changes are OK; time jumps do not count). Tap a gray stamp to take that trip. | 始発から終点まで追跡すると完乗スタンプを獲得できます（速度変更は可、時刻変更は不可）。灰色のスタンプをタップするとその列車に乗れます。 | — | □ |
| 881 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 從發車跟到終點 | Follow from departure to terminus | 始発から終点まで追跡 | — | □ |
| 882 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 從選單挑全台同框／台鐵／高鐵／捷運與輕軌 | Choose Nationwide, TRA, HSR, or Metro and light rail | 台湾全土／台湾鉄路／高鉄／メトロ・ライトレールから選ぶ | — | □ |
| 883 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 捷 | Metro | メトロ | — | □ |
| 884 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 捷運 | Metro | メトロ | — | □ |
| 885 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 捷運小工具（主畫面／鎖定畫面） | Metro widgets for Home and Lock Screens | メトロウィジェット（ホーム／ロック画面） | — | □ |
| 886 | i18n/translations.js、i18n/content-translations.js | 捷運看板 | Metro boards | メトロ案内 | — | □ |
| 887 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 捷運與輕軌 | Metro &amp; Light Rail | メトロ・ライトレール | — | □ |
| 888 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 掛著看車時的背景音樂，可以換首。 | Background music for watching trains, with track skipping. | 列車を眺めながら流すBGM。曲送りもできます。 | — | □ |
| 889 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 探 | Go | 見 | — | □ |
| 890 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 接下來 3 小時會有誰來 | Arrivals in the next 3 hours | 今後3時間の列車 | — | □ |
| 891 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 接下來的班車 | Upcoming trains | 次の列車 | — | □ |
| 892 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 推估 | Estimated | 推定 | — | □ |
| 893 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 推算 | Estimated | 推定 | — | □ |
| 894 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 晚 {n} 分 | {n} min late | {n}分遅れ | — | □ |
| 895 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 條款 | Terms | 規約 | — | □ |
| 896 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 淡化 | Faint | 薄く | — | □ |
| 897 | i18n/translations.js、i18n/content-translations.js | 淡海輕軌 | Danhai Light Rail | 淡海ライトレール | — | □ |
| 898 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 淡海輕軌・安坑輕軌的即時列車動態引用自新北大眾捷運股份有限公司官網「列車動態」公開頁面，著作權屬該公司所有 | Live train movements for Danhai and Ankeng light rail come from New Taipei Metro’s public train-status pages; copyright remains with the operator. | 淡海LRT・安坑LRTの列車位置は新北大衆捷運公司の公開ページを参照し、著作権は同社に帰属します。 | — | □ |
| 899 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 淡海輕軌綠山線與藍海線依官方當日時刻表在淡水穿梭，營運時段依官方列車動態即時校正 — 拖曳、縮放看看。 | Danhai light-rail trains follow today’s official timetable and use official train tracking during service hours. | 淡海ライトレールは当日の公式時刻表で運行し、運行時間中は公式列車位置情報で補正します。 | — | □ |
| 900 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 深夜重播 18:00 | Night replay 18:00 | 深夜リプレイ 18:00 | — | □ |
| 901 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 深澳線 | Shen’ao Line | 深澳線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 902 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 淹水 | Flooding | 浸水 | — | □ |
| 903 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 清單超過 {n} 筆，請拆成較小檔案再匯入 | The list has more than {n} entries. Split it into smaller files before importing. | リストが{n}件を超えています。小さいファイルに分けて読み込んでください。 | — | □ |
| 904 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 現在 | Now | 現在 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 905 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 現存最古老的站房之一（1913 年，國定古蹟） | One of Taiwan’s oldest surviving station buildings, completed in 1913 and now a national monument. | 1913年完成の、現存する最古級の駅舎。国定古跡です。 | — | □ |
| 906 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 異常推定 | Possible disruption | 異常の可能性 | — | □ |
| 907 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 票 | Pass | 票 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 908 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 視角：群車 | View: Train cluster | 視点：列車群 | — | □ |
| 909 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 視角：跟車 | View: Follow train | 視点：列車追跡 | — | □ |
| 910 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 移除 | Remove | 削除 | — | □ |
| 911 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 移除收藏 | Remove favorite | お気に入りから削除 | — | □ |
| 912 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 移除最愛 | Remove from favorites | お気に入りから削除 | — | □ |
| 913 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 移除最愛車站 | Remove station from favourites | 駅をお気に入りから削除 | — | □ |
| 914 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 移動到縣市 | Jump to an area | 地域へ移動 | — | □ |
| 915 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 第一次來？三步上手 | New here? Start in three steps | 初めての方へ・3ステップ | — | □ |
| 916 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 第三方軟體授權 | Third-party software licences | サードパーティソフトウェアのライセンス | — | □ |
| 917 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 累積完乘 1,000 km | Travel 1,000 km in completed journeys | 完乗距離1,000 km | — | □ |
| 918 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 累積完乘 100 km | Travel 100 km in completed journeys | 完乗距離100 km | — | □ |
| 919 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 累積完乘 5,000 km | Travel 5,000 km in completed journeys | 完乗距離5,000 km | — | □ |
| 920 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 累積完乘 500 km | Travel 500 km in completed journeys | 完乗距離500 km | — | □ |
| 921 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 終點 {time} 抵達 | Arrives at the terminus at {time} | 終点に{time}到着 | — | □ |
| 922 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 設定末班車提醒 | Set last-train alert | 終電通知を設定 | — | □ |
| 923 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 設定提醒 | Set alert | 通知を設定 | — | □ |
| 924 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 逐列看：台鐵即時誤點是 LIVE 還是「非即時」、捷運看板校正到哪、是不是在重播、目前時段與車數 | Review TRA live-delay status, metro board corrections, replay state, current period and train count | 台湾鉄路の遅延、メトロ案内の補正、リプレイ状態、現在の時間帯と列車数を確認 | — | □ |
| 925 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 逐車校正 | Per-train correction | 列車別補正 | — | □ |
| 926 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 這一站現在沒有官方班次資訊 | No official service information is available for this station right now. | この駅の公式列車情報は現在ありません。 | — | □ |
| 927 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 這不代表列車停駛，請以月台看板為準。 | This does not mean trains are suspended; check the platform display. | 列車の運休を意味するものではありません。駅の案内表示をご確認ください。 | — | □ |
| 928 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 這台車已超過 30 秒不在即時模型中，已結束跟隨 | This train has been absent from the live model for over 30 seconds, so following ended. | この列車は30秒以上リアルタイムモデルにないため追跡を終了しました。 | — | □ |
| 929 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 這份檔案沒有可匯入的台灣地點。 | This file has no places in Taiwan that can be imported. | このファイルには読み込める台湾の場所がありません。 | — | □ |
| 930 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 這列車已離開官方即時名冊 | This train has left the official live roster. | この列車は公式リアルタイム名簿から外れました。 | — | □ |
| 931 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 這列車目前沒有可唯一確認的官方身分 | This train cannot currently be matched to a unique official identity. | この列車は現在、公式データ上の一意な列車として確認できません。 | — | □ |
| 932 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 這是外部災害示警，不代表列車已停駛；軌島已加強重查台鐵、高鐵與捷運的官方營運公告{stale}。列車是否停駛請以各營運單位公告為準。來源：NCDR 民生示警公開資料平台。 | These external hazard warnings do not mean that train service has been suspended. Rail Island is checking official service notices from TRA, HSR and metro operators more frequently{stale}. Follow each operator’s official notice to confirm whether trains are running. Source: NCDR Public Warning Platform. | これは外部の災害警報であり、列車の運休を示すものではありません。軌島は台湾鉄路・高鉄・各メトロの公式運行情報を通常より頻繁に確認しています{stale}。運休の有無は各事業者の公式情報をご確認ください。出典：NCDR民生警報公開資料プラットフォーム。 | — | □ |
| 933 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 這是你的收集地圖——按上方「離開」回到即時地圖 | This is your collection map—press Leave above to return to the live map | 収集マップです。上部の「終了」でリアルタイム地図へ戻ります。 | — | □ |
| 934 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 這是資料狀態——卡片右上的 ✕ 或按 Esc 關掉 | This is the data-status card. Close it with ✕ at the top right or press Esc. | データ状態カードです。右上の✕またはEscキーで閉じられます。 | — | □ |
| 935 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 這個行程連結已過期（非今日班次） | This journey link has expired (not a service for today). | この旅程リンクは期限切れです（本日の列車ではありません）。 | — | □ |
| 936 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 這個位置 {distance} 內沒有鐵路，無法預測經過的火車。拖曳釘子靠近鐵路再試。 | There is no railway within {distance} of this point, so passing trains cannot be predicted. Drag the pin closer to a railway and try again. | この地点の{distance}以内に鉄道がないため、通過列車を予測できません。ピンを線路の近くへドラッグして再度お試しください。 | — | □ |
| 937 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 這個帳號目前沒有可恢復的 Plus 訂閱資格。 | This account has no Plus subscription to restore. | このアカウントには復元できるPlusサブスクリプションがありません。 | — | □ |
| 938 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 這個帳號目前沒有可恢復的通行證資格。 | This account currently has no Rail Island Pass purchase to restore. | このアカウントには現在、復元できる軌島パスの購入資格がありません。 | — | □ |
| 939 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 這個裝置或瀏覽器不支援定位 | This device or browser does not support location. | この端末またはブラウザは位置情報に対応していません。 | — | □ |
| 940 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 這個檢視沒有車站 | No stations in this view | この表示には駅がありません | — | □ |
| 941 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 這個檢視附近沒有車站，換個系統頁籤再試 | No station is near this view. Try another system tab. | この表示の近くに駅がありません。別のシステムタブでお試しください。 | — | □ |
| 942 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 這班車已經到終點了 | This train has reached its terminus. | この列車は終点に到着しました。 | — | □ |
| 943 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 這班車今天已經跑完了 | This train has finished for today. | この列車は本日の運行を終了しました。 | — | □ |
| 944 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 這班車沒有剩餘停站了（已接近終點），沒辦法再選目的站。 | This train has no remaining stops and is near its terminus, so a destination cannot be selected. | この列車は終点に近く、残りの停車駅がないため目的駅を選べません。 | — | □ |
| 945 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 這班車剩下的停靠站都來不及提醒了 | It is too late to alert for any remaining stop on this train. | この列車の残りの停車駅には通知が間に合いません。 | — | □ |
| 946 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 通行證 | Pass | パス | — | □ |
| 947 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 通行證已啟用 | Pass activated | パスは有効です | — | □ |
| 948 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 通行證內容：台鐵列車的誤點履歷（回溯 90 天的逐日紀錄）、收藏與完乘紀錄跨裝置雲端同步、行程分享、在 App 匯入 Google Maps 已儲存清單、App 非跟車時的衛星高解析圖磚，以及 iOS 17.6 以上可用的跟車鎖定畫面與動態島即時動態。 | Pass features include 90 days of daily TRA delay history, cloud sync for favorites and journeys, trip sharing, Google Maps list import, high-resolution satellite tiles when not following, and Lock Screen or Dynamic Island status on iOS 17.6+. | パスには台湾鉄路の90日日別遅延履歴、お気に入りと完乗のクラウド同期、旅程共有、Google Mapsリスト読込、高解像度衛星画像、iOS 17.6以降のロック画面／Dynamic Island表示が含まれます。 | — | □ |
| 949 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 通行證內容：台鐵列車的誤點履歷（回溯 90 天的逐日紀錄）、iPhone 桌面與鎖定畫面的捷運小工具放多站或用「自動（最近的站）」跟著你移動換站（免費可設定一站）、收藏與完乘紀錄跨裝置雲端同步、行程分享、在 App 匯入 Google Maps 已儲存清單、App 非跟車時的衛星高解析圖磚，以及 iOS 17.6 以上可用的跟車鎖定畫面與動態島即時動態。 | Pass features include 90 days of daily TRA delay history; multiple stations or Auto (nearest station) in iPhone Home and Lock Screen metro widgets, with one station free; cloud sync for favorites and completion records; journey sharing; importing Google Maps saved lists in the app; high-resolution satellite tiles when not following a train; and follow Live Activities on the Lock Screen and Dynamic Island on iOS 17.6 or later. | パスには、台湾鉄路の過去90日の日別遅延履歴、iPhoneのホーム／ロック画面メトロウィジェットでの複数駅または移動に合わせる「自動（最寄り駅）」（1駅は無料）、お気に入りと完乗記録の端末間同期、旅程共有、Googleマップ保存済みリストの読み込み、列車追跡中以外の高解像度衛星地図、iOS 17.6以降のロック画面／Dynamic Island追跡ライブ表示が含まれます。 | — | □ |
| 950 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 通知權限已關閉，請到 設定 &gt; 軌島 開啟 | Notifications are off. Enable them in Settings &gt; Rail Island. | 通知がオフです。「設定」&gt;「軌島」で許可してください。 | — | □ |
| 951 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 通阻公告 | Service alert | 運行情報 | — | □ |
| 952 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 通勤的證明 | Commuter credentials | 通勤の証 | — | □ |
| 953 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 速度 | speed | 速度 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 954 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 章 | ✓ | 章 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 955 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 章有三種：跟完（在 App 裡跟完動畫）、搭過（搭車經過）、到訪（人真的踏上月台） | Three levels: followed in the app, travelled through, and physically visited | 3段階：追跡完了・乗車通過・現地訪問 | — | □ |
| 956 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 章會出現在「護照」 | The stamp appears in Passport | スタンプは「パスポート」に追加 | — | □ |
| 957 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 最大誤點 | Maximum delay | 最大遅延 | — | □ |
| 958 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 最左邊那顆是暫停／播放 | The leftmost control pauses and resumes | 一番左が一時停止／再生 | — | □ |
| 959 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 最划算 | Best value | おすすめ | — | □ |
| 960 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 最快一班，全部方向 | Next train, any direction | 最も早い列車・全方向 | — | □ |
| 961 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 最快一班（全部方向） | Next train (all directions) | 最も早い列車（全方向） | — | □ |
| 962 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 最近 {date} | Latest {date} | 最近 {date} | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 963 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 最近 {n} 站 · {km} 公里內 | {n} nearest stations · within {km} km | 最寄り{n}駅・{km}km以内 | — | □ |
| 964 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 最近更新 | Recent updates | 最近の更新 | — | □ |
| 965 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 最近軌道：{route} · 約 {distance} | Nearest track: {route} · about {distance} | 最寄りの線路：{route}・約{distance} | — | □ |
| 966 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 最近軌道約 {distance} 外 | Nearest track is about {distance} away | 最寄りの線路まで約{distance} | — | □ |
| 967 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 最長一趟 | longest trip | 最長記録 | — | □ |
| 968 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 最後更新：2026/8/28 | Last updated: 2026/8/28 | 最終更新：2026/8/28 | — | □ |
| 969 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 最常搭 {segment} {n} 次 | Most travelled: {segment}, {n} times | 最多乗車：{segment}・{n}回 | — | □ |
| 970 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 最愛 | Favorites | お気に入り | — | □ |
| 971 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 最遠征 | Longest journey | 最長遠征 | — | □ |
| 972 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 最糟 {worst} 分・平均 {average} 分・{days} 天 | Worst {worst} min · avg {average} min · {days} days | 最大{worst}分・平均{average}分・{days}日 | — | □ |
| 973 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 最糟{worst}分・平均{average}分・{days}天 | Worst {worst} min · avg {average} min · {days} days | 最大{worst}分・平均{average}分・{days}日 | — | □ |
| 974 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 創 | F | 創 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 975 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 創始島民 | Founding Islander | 創始島民 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 976 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 創始會員徽章 | Founding member badge | 創設メンバーバッジ | — | □ |
| 977 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 單日最大誤點 {n} 分 | Largest single-day delay: {n} min | 1日の最大遅延{n}分 | — | □ |
| 978 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 單趟完乘 300 km 以上 | Complete a journey of at least 300 km | 1回で300 km以上完乗 | — | □ |
| 979 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 復興號 | Fu-Hsing Express | 復興号 | — | □ |
| 980 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 提早 {n} 分 | {n} min early | {n}分早着 | — | □ |
| 981 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 提前 | Lead time | 通知時刻 | — | □ |
| 982 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 提醒 | Alert | 通知 | — | □ |
| 983 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 提醒依時刻表與即時誤點推算，實際到站請以現場為準。 | Reminders use the timetable and live delay estimate. Follow station information for the actual arrival. | 通知は時刻表と遅延から推定します。実際の到着は現地案内をご確認ください。 | — | □ |
| 984 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 提醒站點 | Alert station | 通知する駅 | — | □ |
| 985 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 提醒基準 | Alert timing | 通知基準 | — | □ |
| 986 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 換一首 | Next track | 次の曲 | — | □ |
| 987 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 換一班 | Another train | 別の列車 | — | □ |
| 988 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 換首 | Next | 次へ | — | □ |
| 989 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 普悠瑪自強號 | Puyuma Express | 普悠瑪自強号 | — | □ |
| 990 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 曾誤點 {n} 分 | Earlier delay {n} min | 一時{n}分遅れ | — | □ |
| 991 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 無公路可達，只能搭火車或徒步抵達的秘境小站 | A secluded station with no road access, reachable only by train or on foot. | 道路が通じず、列車か徒歩でしか訪れられない秘境駅です。 | — | □ |
| 992 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 無固定車次 | No fixed service | 定期運行なし | — | □ |
| 993 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 無法自動定位，已改用「釘」：在地圖上點你的位置就能看附近火車。（{note}） | Automatic location failed, so pin mode is now active. Tap your location on the map to see nearby trains. ({note}) | 現在地を自動取得できないため、ピンモードに切り替えました。地図上の現在地をタップすると付近の列車を確認できます。（{note}） | — | □ |
| 994 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 無法刪除伺服器上的帳號資料，請稍後再試；目前帳號尚未刪除 | Server account data could not be deleted. Try again later; the account has not been deleted. | サーバー上のアカウントデータを削除できません。後でもう一度お試しください。アカウントはまだ削除されていません。 | — | □ |
| 995 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 無法保存這批清單 | Could not save this batch | このリストを保存できません | — | □ |
| 996 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 無法恢復訂閱：{error} | Unable to restore the subscription: {error} | サブスクリプションを復元できません：{error} | — | □ |
| 997 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 無法載入 Plus 購買元件，請檢查網路後再試 | Unable to load Plus purchases. Check your connection and try again. | Plus購入機能を読み込めません。通信状況を確認して再度お試しください。 | — | □ |
| 998 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 無法載入 ZIP 解壓元件；可先解壓縮後改選 CSV 或 GeoJSON | Could not load the ZIP extractor. Unzip the archive first, then choose a CSV or GeoJSON file. | ZIP展開機能を読み込めません。先に解凍してCSVまたはGeoJSONを選んでください。 | — | □ |
| 999 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 無法讀取 Plus：{error} | Unable to load Plus: {error} | Plusを読み込めません：{error} | — | □ |
| 1000 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 無法讀取這份檔案 | Could not read this file | このファイルを読み込めません | — | □ |
| 1001 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 無空調、可開窗的傳統客車，全台碩果僅存的普快車體。 | Traditional non-air-conditioned coaches with opening windows, the last ordinary-train coaches of their kind in Taiwan. | 窓を開けられる非冷房の伝統客車で、台湾に残る最後の普通客車です。 | — | □ |
| 1002 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 畫面上 {n} 台列車是依各站之間的固定行車時間往前推估的，位置與車站倒數都可能不準 | The {n} trains shown are projected using fixed inter-station travel times; positions and station countdowns may be inaccurate | 表示中の{n}列車は駅間の固定所要時間から推定しています。位置と駅のカウントダウンは正確でない場合があります | — | □ |
| 1003 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 畫面上的列車位置是依 | Train positions are  | 画面の列車位置は | — | □ |
| 1004 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 畫面名冊與到站時刻來自北捷即時資料，共 {n} 台 | The roster and arrivals come from Taipei Metro live data, {n} trains total | 表示中の名簿と到着時刻は台北メトロのリアルタイム情報を使用（計{n}台） | — | □ |
| 1005 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 畫面跑的是「今天的時刻表」，時間可以停、可以快、可以往回看。 | The animation follows today’s timetable. You can pause, accelerate or move back in time. | 当日の時刻表を再現し、一時停止・早送り・過去の表示ができます。 | — | □ |
| 1006 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 登入並訂閱通行證後，可看台鐵列車近 90 天逐日與週幾誤點履歷。 | Sign in and subscribe to view 90 days of daily and weekday delay history for TRA trains. | ログインしてパスを購読すると、台湾鉄路列車の過去90日の日別・曜日別遅延履歴を確認できます。 | — | □ |
| 1007 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 登入後會同步「最愛地點、最愛車站、最愛列車、完乘紀錄」。主題、音量與省電等裝置偏好不會同步。若這台裝置沒有記著別的帳號，首次登入時會把裝置上的訪客資料併入帳號；若這台裝置還記著上一個登入的別的帳號，訪客資料不會自動併入，但仍留在裝置上，不會遺失。 | Sign in to sync favourite places, stations and trains, plus completed journeys. Device preferences such as theme, volume and power saving do not sync. Guest data is merged on first sign-in unless this device still remembers a different account; in that case it remains safely on the device and is not merged automatically. | ログインするとお気に入りの場所・駅・列車と完乗記録を同期します。テーマ、音量、省電力など端末設定は同期しません。この端末に別のアカウントが記録されていなければ初回ログイン時にゲストデータを統合します。別のアカウントが残っている場合は自動統合せず、端末内に安全に保持します。 | — | □ |
| 1008 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 登入與同步目前無法使用。 | Sign-in and sync are currently unavailable. | ログインと同期は現在利用できません。 | — | □ |
| 1009 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 登入與跨裝置同步 | Sign in and sync across devices | ログインと端末間同期 | — | □ |
| 1010 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 登出 | Sign out | ログアウト | — | □ |
| 1011 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 登出會先完成最後同步，再把畫面切回訪客狀態。你的收藏留在這台裝置上，同一個帳號登入就會回來；換別人登入看不到，也不會被合併。要一併清除這台裝置上的收藏，請用下方的「刪除帳號與同步資料」。 | Signing out completes one last sync, then returns to guest mode. Your favourites remain on this device and return with the same account; another account cannot see or merge them. To remove the device copy too, use “Delete account and synced data” below. | ログアウト前に最後の同期を行い、ゲスト表示へ戻ります。お気に入りはこの端末に残り、同じアカウントで戻ります。別のアカウントからは見えず、統合もされません。端末内のお気に入りも消す場合は下の「アカウントと同期データを削除」を使ってください。 | — | □ |
| 1012 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 等 {n} 則 ·  | {n} alerts ·  | ほか{n}件・ | — | □ |
| 1013 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 等車卡修好「點了卻沒出現」：從桌面的捷運小工具點一下，現在會直接把卡片開起來，不用先打開軌島——點完馬上鎖屏、之後一直沒回 App，鎖定畫面上照樣會有那張卡（以前必須等你回到 App 才補得開，人沒回來那一次點擊就沒了）；萬一真的開不成，回到 App 時仍會自動補開，也不會再先空等二十秒。另外兩種也一起修好：動過播放速度或拖過時刻尺之後再追蹤，會自動把時間帶回「現在」再開卡，不會再誤說「這一站現在沒有官方班次資訊」；已經結束的舊卡不再被當成還在追蹤，按鈕不會變成「結束追蹤」害你白點一次。萬一系統遲遲沒有回應，也會明白告訴你再點一次，不會停在那裡沒反應。下次 App 更新生效 | Fixed wait cards opened from the metro widget: they now start immediately, recover on returning to the app, reset the timeline to now, ignore ended cards and show a clear retry message if the system does not respond. Available in the next app update. | メトロウィジェットからの列車待ちカードを修正しました。すぐに開始し、App復帰時にも補完し、時刻を現在へ戻し、終了済みカードを除外します。応答がない場合は再試行を案内します。次回App更新で反映されます。 | — | □ |
| 1014 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 等哪個方向 | Choose a direction | 方向を選択 | — | □ |
| 1015 | i18n/translations.js、i18n/content-translations.js | 結束 | Stop | 終了 | — | □ |
| 1016 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 結束追蹤 | End tracking | 追跡を終了 | — | □ |
| 1017 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 給軌島評分 | Rate Rail Island | 軌島を評価 | — | □ |
| 1018 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 統一即時模型暫時無法使用，已改用官方名冊或班表：{error} | The unified live model is temporarily unavailable; using an official roster or timetable: {error} | 統合リアルタイムモデルを一時利用できないため、公式名簿または時刻表を使用します：{error} | — | □ |
| 1019 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 統一捷運即時模型已 {n} 分鐘沒有取得可發布的新北捷資料；目前退回備援推估 | The unified metro model has received no publishable New Taipei Metro data for {n} minutes; fallback estimates are in use | 統合メトロモデルは{n}分間、公開可能な新北メトロデータを取得できていません。現在は代替推定を使用します | — | □ |
| 1020 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 統計區間 {range} | Period: {range} | 集計期間 {range} | — | □ |
| 1021 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 街道底圖載入異常，列車與路線不受影響。可切換到「衛星」底圖。 | The street map failed to load; trains and routes are unaffected. You can switch to Satellite. | 道路地図を読み込めませんが、列車と路線には影響ありません。「衛星」地図へ切り替えられます。 | — | □ |
| 1022 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 街道底圖載入異常，列車與路線不受影響。重新整理即可重試。 | The street map failed to load; trains and routes are unaffected. Refresh to try again. | 道路地図を読み込めませんが、列車と路線には影響ありません。再読み込みで再試行できます。 | — | □ |
| 1023 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 診斷資訊 | Diagnostics | 診断情報 | — | □ |
| 1024 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 貼到 Safari／Chrome 的網址列就能開 | Paste into the Safari or Chrome address bar to open | Safari／Chromeのアドレス欄に貼り付けて開けます | — | □ |
| 1025 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 距離 | Distance | 距離 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1026 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 週一 | Mon | 月 | — | □ |
| 1027 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 週二 | Tue | 火 | — | □ |
| 1028 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 週三 | Wed | 水 | — | □ |
| 1029 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 週五 | Fri | 金 | — | □ |
| 1030 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 週六 | Sat | 土 | — | □ |
| 1031 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 週日 | Sun | 日 | — | □ |
| 1032 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 週四 | Thu | 木 | — | □ |
| 1033 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 開 App 就落在你附近；「附近車站」告訴你最近的車站與下一班車還有幾分鐘。 | The app starts near you. Nearby stations shows the closest stations and next arrivals. | Appを開くと周辺を表示し、最寄り駅と次の列車までの時間を確認できます。 | — | □ |
| 1034 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 開一則 issue | open a GitHub issue | GitHub issueを作成 | — | □ |
| 1035 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 開卡失敗，請稍後再試 | Could not open the card. Try again later. | カードを開始できませんでした。後でもう一度お試しください。 | — | □ |
| 1036 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 開車 | Dep. | 発 | — | □ |
| 1037 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 開車前 | Before departure | 発車前 | — | □ |
| 1038 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 開車前叫你 | Get an alert before departure | 発車前にお知らせ | — | □ |
| 1039 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 開始收集 | Start collecting | 収集を開始 | — | □ |
| 1040 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 開始收集 · {from} → {to}{note} | Collection started · {from} → {to}{note} | 収集開始・{from} → {to}{note} | — | □ |
| 1041 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 開始看車 | Start watching | 列車を見る | — | □ |
| 1042 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 開始追蹤 往 {station} | Start tracking toward {station} | {station}方面の追跡を開始 | — | □ |
| 1043 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 開始追蹤 往{station} | Start tracking toward {station} | {station}方面を追跡開始 | — | □ |
| 1044 | i18n/translations.js、i18n/content-translations.js | 開啟設定 | Open settings | 設定を開く | — | □ |
| 1045 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 開最久 | Longest running time | 最長運転時間 | — | □ |
| 1046 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 階數＝ | Scale = | 倍率＝ | — | □ |
| 1047 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 集集線 | Jiji Line | 集集線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1048 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 集集線代表站，綠色隧道與檜木老站房 | The signature Jiji Line station, known for its green tunnel and old cypress station building. | 集集線を代表する駅。緑のトンネルとヒノキ造りの旧駅舎が見どころです。 | — | □ |
| 1049 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 集集線起點，與縱貫線在此交會 | Starting point of the Jiji Line, connecting with the Western Trunk Line. | 集集線の起点で、西部幹線と接続します。 | — | □ |
| 1050 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 集集線終點，昔日木業小鎮，有「最後的火車站」之稱 | Jiji Line terminus and former timber town, nicknamed “the last railway station.” | 集集線の終点で、かつての林業集落。「最後の駅」とも呼ばれます。 | — | □ |
| 1051 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 雲林 | Yunlin | 雲林 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1052 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 傾斜雙雄 | Tilting duo | 振り子式の双雄 | — | □ |
| 1053 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 匯 | Import | 読 | — | □ |
| 1054 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 匯入 | Import | 読込 | — | □ |
| 1055 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 匯入 {n} 個地點 | Import {n} places | {n}件の場所を読み込む | — | □ |
| 1056 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 匯入 Google 已儲存清單 | Import Google saved lists | Googleの保存済みリストを読み込む | — | □ |
| 1057 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 匯入 Google Maps 已儲存清單 | Import saved Google Maps lists | Google マップの保存済みリストを読み込む | — | □ |
| 1058 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 匯入已勾選地點 | Import selected places | 選択した場所を読み込む | — | □ |
| 1059 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 匯出捷運診斷 | Export metro diagnostics | メトロ診断情報を書き出す | — | □ |
| 1060 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 想回到真實時間按「現在」 | Press Now to return to real time | 「現在」で実時刻に戻る | — | □ |
| 1061 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 想放多站，或用「自動（最近的站）」讓它跟著你移動換站，需要軌島通行證（免費可設定一站） | A Rail Island Pass is required for multiple stations or Auto (nearest station), which changes as you move. One station is free. | 複数の駅、または移動に合わせて駅を変える「自動（最寄り駅）」には軌島パスが必要です。1駅は無料です。 | — | □ |
| 1062 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 想停就按卡片的 ×，或點地圖空白處 | Press × on the card or tap empty map space to stop | カードの×または地図の空白をタップして終了 | — | □ |
| 1063 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 感謝你的支持！ | Thank you for your support! | ご支援ありがとうございます！ | — | □ |
| 1064 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 搜尋 | Search | 検索 | — | □ |
| 1065 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 搜尋車站、車次、列車名 | Search stations, train numbers and train names | 駅・列車番号・列車名を検索 | — | □ |
| 1066 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 搜尋車站、車次或列車 | Search stations, train numbers or names | 駅・列車番号・列車を検索 | — | □ |
| 1067 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 搜尋車站/車次/列車名 | Search station, train no. or name | 駅名・列車番号・列車名を検索 | — | □ |
| 1068 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 搜尋框已填「台北」，從下拉挑一項 | The search box now contains Taipei—choose a result | 検索欄に「台北」を入力しました。候補を選んでください。 | — | □ |
| 1069 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 搭快車被跳過的小站也算走過——你確實通過了那段軌道。每條路線的完乘率分開算。 | Express trains still count the track through skipped stations. Completion is calculated separately for each route. | 快速列車で通過した区間も乗車済みになります。完乗率は路線ごとに計算します。 | — | □ |
| 1070 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 搭乘中 · {train} 次 | Riding · train {train} | 乗車中・{train}列車 | — | □ |
| 1071 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 搭乘模式：我上車了 | Ride mode: I’m on board | 乗車モード：乗車する | — | □ |
| 1072 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 搭過 | Travelled | 乗車済み | — | □ |
| 1073 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 新北 | New Taipei | 新北 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1074 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 新北捷 | New Taipei Metro | 新北メトロ | — | □ |
| 1075 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 新北捷運 | New Taipei Metro | 新北メトロ | — | □ |
| 1076 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 新竹 | Hsinchu | 新竹 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1077 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 新增繁中、English、日本語切換：車站與路線名稱、列車跟隨、來車看板、設定、營運提醒、通行證，以及隱私權政策與服務條款會一起切換；選過的語言也會記住 | Added Traditional Chinese, English and Japanese switching across station and route names, train following, arrival boards, settings, service alerts, the Pass, privacy policy and terms. Your choice is remembered. | 繁体字中国語・英語・日本語の切替を追加しました。駅・路線名、列車追跡、到着案内、設定、運行情報、パス、プライバシーポリシー、利用規約が切り替わり、選択した言語も保存されます。 | — | □ |
| 1078 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 暗 | Dark | ダーク | — | □ |
| 1079 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 極簡 | Minimal | 最小 | — | □ |
| 1080 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 極簡沉浸（只留地圖與列車） | Minimal view (map and trains only) | 最小表示（地図と列車のみ） | — | □ |
| 1081 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 極簡沉浸只留地圖與列車；省電模式降到約 30fps，手機掛著看更省電；還可以開列車方向箭頭、特殊站介紹、縣市快速移動。 | Minimal view keeps only the map and trains; power saving lowers rendering to about 30 fps. Direction arrows, station stories and county shortcuts are also available. | ミニマル表示は地図と列車だけを残し、省電力モードは約30fpsに下げます。進行方向矢印、特色駅紹介、県市ショートカットも利用できます。 | — | □ |
| 1082 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 準點 | On time | 定刻 | — | □ |
| 1083 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 準點排行 | Punctuality ranking | 定時運行ランキング | — | □ |
| 1084 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 準點率 | On-time rate | 定時率 | — | □ |
| 1085 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 當日時刻表推演 | simulated from today’s timetable | 当日の時刻表から推定 | — | □ |
| 1086 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 經過特殊車站時顯示介紹 | Show notes at featured stations | 注目駅で案内を表示 | — | □ |
| 1087 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 經過特殊車站顯示介紹（已開啟） | Featured-station notes are on | 注目駅の案内を表示中 | — | □ |
| 1088 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 落釘模式已開——點地圖任一處，看有哪些火車經過那裡 | Pin mode is on—tap the map to see trains passing that location | ピンモードを開始しました。地図をタップして通過列車を確認してください。 | — | □ |
| 1089 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 裝置時鐘與伺服器差 {n} 秒 | Device time differs from the server by {n} seconds | 端末時刻がサーバーと{n}秒ずれています | — | □ |
| 1090 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 裝置時鐘與伺服器差 {n} 秒，台鐵即時誤點暫停套用（校正裝置時間即可恢復） | Device time differs from the server by {n} seconds; TRA live delays are paused (correct the device clock to restore them) | 端末時刻がサーバーと{n}秒ずれているため、台湾鉄路の遅延反映を一時停止しています（端末時刻を直すと再開します） | — | □ |
| 1091 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 裝置儲存空間不足，這批清單沒有寫入 | Device storage is full; this batch was not saved | 端末の保存容量が不足し、このリストを保存できませんでした | — | □ |
| 1092 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 解除跟隨鎖定 | Unlock following | 追跡ロックを解除 | — | □ |
| 1093 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 解壓後資料超過 80 MB，為保護手機記憶體已停止讀取 | Expanded data exceeds 80 MB. Reading stopped to protect phone memory. | 展開後のデータが80MBを超えたため、端末メモリを保護するため読み込みを停止しました。 | — | □ |
| 1094 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 解鎖 90 天逐日與週幾誤點統計 | Unlock 90-day daily and weekday delay statistics | 90日の日別・曜日別遅延統計を解除 | — | □ |
| 1095 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 試一次 | Try it | 試す | — | □ |
| 1096 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 試試 | Try | 試す | — | □ |
| 1097 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 詳情 ▾ | Details ▾ | 詳細 ▾ | — | □ |
| 1098 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 資料: 交通部TDX | Data: Ministry of Transportation TDX | データ：交通部 TDX | — | □ |
| 1099 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 資料: 交通部TDX, | Data: Ministry of Transportation TDX, | データ：交通部 TDX、 | — | □ |
| 1100 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 資料：交通部 TDX 運輸資料流通服務平臺・軌島每日彙整 | Data: Ministry of Transportation TDX · compiled daily by Rail Island | データ：交通部TDX・軌島が毎日集計 | — | □ |
| 1101 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 資料已 {n} 分鐘未更新 | Data has not updated for {n} minutes | データは{n}分間更新されていません | — | □ |
| 1102 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 資料自今晨起累積，每天重新開始 | Data accumulates from this morning and resets daily | 今朝から集計し、毎日リセットします | — | □ |
| 1103 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 資料來源：台鐵官方每日時刻表與交通部 TDX 即時誤點。動畫依時刻表推演並在目前時刻套用誤點；停駛、取消或加開班次可能未反映。 | Sources: TRA official daily timetable and TDX live delays. The animation follows the timetable and applies delays at the current time; cancellations and extra services may not be reflected. | 出典：台湾鉄路公式日別時刻表と交通部TDX遅延情報。現在時刻では遅延を反映しますが、運休・臨時列車は反映されない場合があります。 | — | □ |
| 1104 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 資料來源：交通部 TDX 阿里山林業鐵路定期時刻表。本線無即時位置或誤點資料，且可能因天候或維修停駛；祝山觀日列車為推算，請以林鐵當日公告為準。 | Source: TDX Alishan Forest Railway regular timetable. No live position or delay data is available and services may be suspended for weather or maintenance. Zhushan sunrise trains are estimates; follow the operator’s daily notice. | 出典：交通部TDX 阿里山森林鉄道定期時刻表。現在位置・遅延情報はなく、天候や工事で運休する場合があります。祝山線の日の出列車は推定のため、当日の公式発表をご確認ください。 | — | □ |
| 1105 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 資料來源：交通部 TDX 高鐵每日時刻表。動畫依當日真實時刻表推演；營運異常請以高鐵官方公告為準。 | Source: TDX high-speed rail daily timetable. The animation follows today’s timetable; follow official HSR notices for disruptions. | 出典：交通部TDX 高速鉄道日別時刻表。アニメーションは当日の時刻表を基にしています。運行異常は公式発表をご確認ください。 | — | □ |
| 1106 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 資料來源：各捷運公司與交通部 TDX 官方時刻表。支援的路網在營運時段依官方即時資訊校正；部分路線無逐班時刻，以官方班距推算。 | Sources: official metro operators and TDX timetables. Supported systems use official live corrections during service hours; routes without per-train timetables are estimated from official headways. | 出典：各メトロ事業者と交通部TDXの公式時刻表。対応路線は運行時間中に公式リアルタイム情報で補正し、列車ごとの時刻表がない路線は公式運転間隔から推定します。 | — | □ |
| 1107 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 資料來源：各營運機構官方時刻表與交通部 TDX。台鐵套用即時誤點，支援的捷運路網依官方即時資訊校正；停駛、取消、加開與臨時班距調整可能未反映。 | Sources: official operator timetables and Taiwan’s TDX platform. TRA live delays and supported metro live corrections are applied. Cancellations, extra trains and temporary headway changes may not be reflected. | 出典：各交通事業者の公式時刻表と交通部TDX。台湾鉄路の遅延と対応メトロのリアルタイム補正を反映します。運休・臨時列車・一時的な運転間隔変更は反映されない場合があります。 | — | □ |
| 1108 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 資料來源與授權 | Data sources and licences | データ出典とライセンス | — | □ |
| 1109 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 資料狀態 | Data status | データ状態 | — | □ |
| 1110 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 資料源連線狀態頁 | Data-source status | データ接続状況 | — | □ |
| 1111 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 資訊 | Information | 情報 | — | □ |
| 1112 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 跟台鐵車時，卡片上的「誤點履歷 ›」可看這班車近 30 天的準點統計；回溯 90 天的逐日紀錄與週幾圖需要軌島通行證 | While following a TRA train, Delay history shows its free 30-day summary. Daily records and weekday charts covering 90 days require a Rail Island Pass. | 台湾鉄路を追跡中、カードの「遅延履歴」で無料の30日集計を確認できます。90日の日別記録と曜日グラフには軌島パスが必要です。 | — | □ |
| 1113 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 跟完 | Followed | 追跡完了 | — | □ |
| 1114 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 跟完一趟車，起訖站自動成章 | Completing a journey stamps its origin and destination | 完乗すると始発駅と終着駅を自動収集 | — | □ |
| 1115 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 跟完一整趟就蓋一枚章，收集起來變成你的旅程紀錄。 | Follow an entire journey to earn a stamp and build your travel record. | 全区間を追跡してスタンプを集め、自分の旅程記録を作ります。 | — | □ |
| 1116 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 跟車卡或看板標題的收藏鈕點一下收藏 | Tap the star on a follow card or station board | 追跡カードまたは駅案内の星をタップ | — | □ |
| 1117 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 跟車時在鎖定畫面與動態島顯示即時動態（iOS 17.6 以上） | Live train status on the Lock Screen and Dynamic Island while following (iOS 17.6+) | 列車追跡中にロック画面とDynamic Islandへライブ表示（iOS 17.6以降） | — | □ |
| 1118 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 跟到終點會蓋一枚完乘章（收在「護照」）。加速播放沒問題，但中途跳時間就不算。 | Following from origin to terminus earns a Journey Passport stamp. Speed-up is allowed; jumping through time is not. | 始発から終点まで追跡すると旅程パスポートに完乗スタンプが入ります。早送りは可能ですが、時間を飛ばすと対象外です。 | — | □ |
| 1119 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 跟到終點會蓋一枚完乘章（收在「護照」）。加速播放沒問題，但中途跳時間就不算。手機在跟車途中點車站，看板會和跟車小卡併成同一張卡的兩個分頁，不會互相蓋掉。 | Follow to the terminus to earn a completion stamp in Passport. Faster playback still counts, but jumping through time does not. On phones, a station board opens as a second tab in the follow card. | 終点まで追跡すると「パスポート」に完乗スタンプが付きます。早送りは対象ですが、途中で時刻を飛ばすと対象外です。スマートフォンで駅を押すと、追跡カード内の別タブとして案内が開きます。 | — | □ |
| 1120 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 跟這班車 → | Follow this train → | この列車を追跡 → | — | □ |
| 1121 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 跟著山海號或平原號連續跟滿半圈（臺北→折返點枋寮） | Follow Shanhai or Pingyuan continuously for half a circuit, from Taipei to Fangliao | 山海号または平原号を台北から折返しの枋寮まで連続追跡 | — | □ |
| 1122 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 跟著車的時候可以排提醒，快到站前手機會響。 | Schedule a notification while following a train and your phone alerts you before arrival. | 列車追跡中、到着前にスマートフォンへ通知できます。 | — | □ |
| 1123 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 跟隨 {train} 次 | Follow train {train} | {train}列車を追跡 | — | □ |
| 1124 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 跟隨 {train} 次　{destination} | Follow train {train} · {destination} | {train}列車を追跡　{destination} | — | □ |
| 1125 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 跟隨 {train} 次・近 30 天最糟單日全程誤點 {worst} 分、平均 {average} 分、{days} 天有紀錄 | Follow train {train} · Past 30 days: worst full-route delay {worst} min, average {average} min, {days} days recorded | {train}列車を追跡・過去30日：全区間最大遅延{worst}分、平均{average}分、{days}日分 | — | □ |
| 1126 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 跟隨列車（{service}） | Follow train ({service}) | 列車を追跡（{service}） | — | □ |
| 1127 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 跟隨系統字級 | Follow system text size | システム文字サイズに合わせる | — | □ |
| 1128 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 跟隨往 {station} 的班次 | Follow service to {station} | {station}方面の列車を追跡 | — | □ |
| 1129 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 跟隨鎖定中：地圖固定列車置中——點擊或直接拖曳地圖解鎖，可自由瀏覽 | Following locked: the map keeps the train centred. Tap or drag the map to unlock and browse freely. | 追跡ロック中：列車を中央に固定します。タップまたはドラッグで解除し、自由に閲覧できます。 | — | □ |
| 1130 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 跨裝置同步 | Cross-device sync | 端末間同期 | — | □ |
| 1131 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 跨裝置同步最多保存 {n} 個地點；超過時會保留既有收藏並略過多出的新地點。 | Cross-device sync stores up to {n} places. Existing favourites are kept when extra new places exceed the limit. | 端末間同期で保存できる場所は最大{n}件です。上限を超えた場合は既存のお気に入りを残し、新しい超過分を除外します。 | — | □ |
| 1132 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 路段 {n} | {n} segments | 区間 {n} | — | □ |
| 1133 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 路線完乘 | Route completion | 路線完乗 | — | □ |
| 1134 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 跳到現在的真實時間 | Return to the current time | 現在時刻に戻る | — | □ |
| 1135 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 跳站停靠的快速通勤電聯車。 | A fast commuter EMU that skips smaller stations. | 小駅を通過する速達通勤電車です。 | — | □ |
| 1136 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 載入中… | Loading… | 読み込み中… | — | □ |
| 1137 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 載入逐站歷程… | Loading station history… | 駅ごとの履歴を読み込み中… | — | □ |
| 1138 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 載入誤點履歷… | Loading delay history… | 遅延履歴を読み込み中… | — | □ |
| 1139 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 雷雨 | Thunderstorm | 雷雨 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1140 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 預計 {time} 抵達 · &lt;b&gt;{n} 分&lt;/b&gt; | Expected {time} · &lt;b&gt;{n} min&lt;/b&gt; | {time}到着予定・&lt;b&gt;あと{n}分&lt;/b&gt; | — | □ |
| 1141 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 預設關閉；這項設定只會記在目前這台裝置。 | Off by default and saved only on this device. | 初期設定はオフで、この端末だけに保存します。 | — | □ |
| 1142 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 預設關閉；這項設定只會記在目前這台裝置。半透明時字色會自動調整以維持可讀性（亮色加深、暗色提亮），不是靠在字外加光暈。 | Off by default and saved only on this device. With transparency enabled, text colors adjust automatically for contrast instead of adding a glow. | 初期設定はオフで、この端末だけに保存されます。半透明時は文字色を自動調整して読みやすさを保ち、文字の光彩には頼りません。 | — | □ |
| 1143 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 預覽 | Preview | プレビュー | — | □ |
| 1144 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 嘉義 | Chiayi | 嘉義 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1145 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 圖 | Map | 地図 | — | □ |
| 1146 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 圖鑑 | Gallery | 図鑑 | — | □ |
| 1147 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 團體專開列車 | Chartered group train | 団体専用列車 | — | □ |
| 1148 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 實際到離站時刻請以各營運機構官方資訊為準。 | Always confirm actual arrivals and departures with the operator’s official information. | 実際の発着時刻は各事業者の公式情報をご確認ください。 | — | □ |
| 1149 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 彰化 | Changhua | 彰化 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1150 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 慢 | late | 遅れ | — | □ |
| 1151 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 福隆海水浴場與福隆便當的所在 | Home of Fulong Beach and the famous Fulong railway lunchbox. | 福隆海水浴場と名物の福隆弁当で知られます。 | — | □ |
| 1152 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 管理到站提醒 | Manage arrival reminders | 到着通知を管理 | — | □ |
| 1153 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 管理訂閱 | Manage subscription | サブスクリプションを管理 | — | □ |
| 1154 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 綠線列車沿著文心路跑（無公開逐班時刻，班次依官方班距與首末班車推算）— 拖曳、縮放看看。 | Green Line trains run along Wenxin Road. No per-train timetable is public, so services are estimated from official headways and first/last train times. | 台中メトロ緑線は列車ごとの公開時刻表がないため、公式の運転間隔と始発・終電時刻から推定します。 | — | □ |
| 1155 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 網站版重新開啟北捷統一時間軸：地圖列車、車站預告與點選跟隨會使用同一份身分與軌跡；每次更新也會檢查軌跡內部，若列車在五秒內跨過半站以上，會先留在原位重新銜接，不把瞬間跳位送到畫面。Core 連線失敗或單線資料不完整時，仍會自動退回原本模式 | The website now uses the unified Taipei Metro timeline by default, so map trains, station forecasts and following share one identity and trajectory. A train that would cross more than half a station within five seconds is held for safe reconnection, while Core or line-level failures still fall back automatically. | Web版で台北メトロの統一タイムラインを標準で再開し、地図・駅予告・追跡が同じ列車IDと軌跡を使うようになりました。5秒以内に半駅以上飛ぶ軌跡はその場で保持して再接続し、Coreや路線単位の異常時は従来方式へ自動退避します。 | — | □ |
| 1156 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 網路連線失敗，請稍後再試 | Network request failed. Please try again later. | 通信に失敗しました。しばらくしてからお試しください。 | — | □ |
| 1157 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 緊鄰海岸，有「最靠近海的車站」之稱 | Right beside the coast and often called Taiwan’s closest station to the sea. | 海岸のすぐそばにあり、「海に最も近い駅」と呼ばれます。 | — | □ |
| 1158 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 臺北 ⇄ 枋寮 永續來回 · 一輪 12 小時 · 永不到站 | Taipei ⇄ Fangliao continuous loop · 12 hours per circuit | 台北 ⇄ 枋寮を連続往復・1周12時間 | — | □ |
| 1159 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 臺北⇄枋寮 永續來回中 | Taipei ⇄ Fangliao continuous loop | 台北⇄枋寮を連続往復中 | — | □ |
| 1160 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 臺北捷運各線與環狀線的秒級到站倒數取自臺北大眾捷運股份有限公司「臺北捷運 API」（會員申請制），依「政府資料開放授權條款」使用 | Second-by-second arrivals for Taipei Metro and the Circular Line come from Taipei Rapid Transit Corporation’s member API under the Open Government Data Licence. | 台北メトロ各線と環状線の秒単位到着情報は台北大衆捷運公司の会員制 API を利用し、政府資料開放授権条款に従っています。 | — | □ |
| 1161 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 臺灣輪廓：內政部 | Taiwan outline: Ministry of the Interior | 台湾の輪郭：内政部 | — | □ |
| 1162 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 臺灣輪廓：內政部, | Taiwan outline: Ministry of the Interior, | 台湾の輪郭：内政部、 | — | □ |
| 1163 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 與 {kind} {train} 交會 | Met {kind} {train} | {kind} {train}と交換 | — | □ |
| 1164 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 蓋章 | Stamp | スタンプ | — | □ |
| 1165 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 蓋章 · 第 {n} 次 | Stamp · visit {n} | スタンプ・{n}回目 | — | □ |
| 1166 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 蓋章只在你按下去的當下讀一次位置，不會在背景一直追蹤你。每站每天算一次。 | Stamping reads your location once when pressed and never tracks in the background. Each station counts once per day. | ボタンを押した時だけ位置を一度確認し、バックグラウンド追跡はしません。各駅1日1回です。 | — | □ |
| 1167 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 蓋章成功 · {station}{count} | Stamp added · {station}{count} | スタンプ獲得・{station}{count} | — | □ |
| 1168 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 語言 | Language | 言語 | — | □ |
| 1169 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 誤點 {n} 分 | {n} min late | {n}分遅れ | — | □ |
| 1170 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 誤點{n}分 | {n} min late | {n}分遅れ | — | □ |
| 1171 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 誤點資料每分鐘更新，來源是交通部 TDX。 | Delay data comes from the Ministry of Transportation TDX and refreshes every minute. | 遅延データは交通部 TDX から毎分更新します。 | — | □ |
| 1172 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 誤點履歷 | Delay history | 遅延履歴 | — | □ |
| 1173 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 誤點履歷 › | Delay history › | 遅延履歴 › | — | □ |
| 1174 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 誤點履歷資料累積中，天數足夠後會顯示完整圖表。 | Delay history is still accumulating. Full charts appear when enough days are available. | 遅延履歴を蓄積中です。日数が揃うとグラフを表示します。 | — | □ |
| 1175 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 需定位 {n} | {n} need locations | 位置確認が必要 {n} | — | □ |
| 1176 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 需要人工定位 | Need manual locations | 手動で位置確認が必要 | — | □ |
| 1177 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 颱風 | Typhoon | 台風 | — | □ |
| 1178 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 劇場模式・動一下回到地圖 | Theater mode · interact to return to the map | シアターモード・操作すると地図に戻ります | — | □ |
| 1179 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 影響路線： | Affected routes:  | 影響路線： | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1180 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 影響路線：{routes} | Affected routes: {routes} | 影響路線：{routes} | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1181 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 播放 | Play | 再生 | — | □ |
| 1182 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 播放/停止背景音樂 | Play / stop background music | BGMを再生／停止 | — | □ |
| 1183 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 暫時無法載入誤點履歷{status}，稍後再試。 | Delay history is temporarily unavailable{status}. Try again later. | 遅延履歴を一時取得できません{status}。後でもう一度お試しください。 | — | □ |
| 1184 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 暫時讀不到，稍後再試。 | Temporarily unavailable. Try again later. | 一時的に取得できません。後でもう一度お試しください。 | — | □ |
| 1185 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 暫停 | Pause | 一時停止 | — | □ |
| 1186 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 暫停　 |  pause ·  |  一時停止　 | — | □ |
| 1187 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 暫停／播放 | pause / play | 一時停止／再生 | — | □ |
| 1188 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 暫停／播放（空白鍵） | Pause / play (Space) | 一時停止／再生（Space） | — | □ |
| 1189 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 標準 | Standard | 標準 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1190 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 標準 1.0 | Standard 1.0 | 標準 1.0 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1191 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 模式與外觀 | Modes and appearance | モードと外観 | — | □ |
| 1192 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 模擬時刻：左右拖曳調整，方向鍵每次 1 分鐘 | Simulated time: drag horizontally; arrow keys adjust by one minute | 表示時刻：左右にドラッグ、矢印キーで1分ずつ調整 | — | □ |
| 1193 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 樣本天數 | Days sampled | 集計日数 | — | □ |
| 1194 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 確認要一起附上的資訊——每一項都可以單獨關掉 | Review the attached details; each item can be turned off separately | 添付する情報を確認する（各項目を個別にオフにできます） | — | □ |
| 1195 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 衛 | Sat | 衛 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1196 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 衛星 | Satellite | 衛星 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1197 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 衛星定位 | GPS | GPS | — | □ |
| 1198 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 衛星底圖 | Satellite basemap | 衛星地図 | — | □ |
| 1199 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 衛星影像 | Satellite imagery | 衛星画像 | — | □ |
| 1200 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 複製 | Copy | コピー | — | □ |
| 1201 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 複製這個分享連結： | Copy this share link: | この共有リンクをコピー： | — | □ |
| 1202 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 複製這個行程連結： | Copy this journey link: | この旅程リンクをコピー： | — | □ |
| 1203 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 複製連結傳出去 | Copy and send the link | リンクをコピーして送信 | — | □ |
| 1204 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 複製網址 | Copy URL | URLをコピー | — | □ |
| 1205 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 請先登入軌島帳號，訂閱資格才能跨裝置使用 | Sign in to Rail Island first so your subscription can work across devices. | サブスクリプションを端末間で利用するには、先に軌島アカウントへログインしてください。 | — | □ |
| 1206 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 請在地圖上點「{name}」的正確位置；點下後會回到確認畫面 | Tap the correct map location for “{name}”. You will then return to the confirmation screen. | 地図上で「{name}」の正しい位置をタップしてください。タップ後に確認画面へ戻ります。 | — | □ |
| 1207 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 請到 iOS 設定開啟「即時動態」才能顯示等車卡 | Enable Live Activities in iOS Settings to show a wait card. | 列車待ちカードを表示するにはiOS設定で「ライブアクティビティ」を有効にしてください。 | — | □ |
| 1208 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 趟 | trips | 回 | — | □ |
| 1209 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 趟 · 總里程 | trips · total | 回・総距離 | — | □ |
| 1210 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 遮斷機通常提前 30–60 秒動作，請以現場號誌為準。 | Barriers usually activate 30–60 seconds early. Always obey the signals on site. | 遮断機は通常30〜60秒前に作動します。必ず現地の信号に従ってください。 | — | □ |
| 1211 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 機車牽引的傳統對號列車。 | A traditional locomotive-hauled reserved-seat train. | 機関車牽引の伝統的な指定席列車です。 | — | □ |
| 1212 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 機車牽引的傳統對號快車，橘黃塗裝，1970 年登場，班次已越來越少。 | A traditional locomotive-hauled reserved train introduced in 1970, now increasingly rare. | 1970年登場のオレンジ色の機関車牽引指定席列車で、運転本数は減少しています。 | — | □ |
| 1213 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 機場捷運直達車與普通車依當日實際時刻表連結雙北與桃園機場，營運時段依官方到站看板即時校正 — 拖曳、縮放看看。 | Airport MRT express and commuter trains follow today’s timetable between Taipei, New Taipei and Taoyuan Airport, with official live-board correction during service hours. | 桃園空港MRTの直達・普通列車は当日の時刻表で運行し、運行時間中は公式到着案内で補正します。 | — | □ |
| 1214 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 縣 縣市快速移動 | Area shortcuts | 地域へ移動 | — | □ |
| 1215 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 縣市 | Area | 地域 | — | □ |
| 1216 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 縣市快速移動 | Quick city and county navigation | 市・県へすばやく移動 | — | □ |
| 1217 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 親子車廂 | Family car | ファミリー車両 | — | □ |
| 1218 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 輸入「台北」找車站、輸入「431」找那班車、輸入「鳴日」找列車介紹 | Enter “Taipei” for a station, “431” for a train, or “Future” for a tourist-train story. | 「台北」で駅、「431」で列車、「鳴日」で観光列車の紹介を検索できます。 | — | □ |
| 1219 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 選一個類型、寫一句說明 | Choose a category and add a short description | 種類を選び、短い説明を書く | — | □ |
| 1220 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 選一張適合你的票，開啟進階功能，也支持軌島繼續運轉。 | Choose the pass that suits you to unlock advanced features and support Rail Island. | 自分に合うパスを選び、高度な機能を利用しながら軌島の運営を応援できます。 | — | □ |
| 1221 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 選分享畫面或分享正在跟的車 | Choose the current view or followed train | 現在の画面または追跡列車を選択 | — | □ |
| 1222 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 選你的目的站，產生一個「活的」行程連結——對方看得到列車位置與到站時刻，你不用一直回傳定位。 | Choose your destination to create a live journey link. The recipient can see the train and arrival time without continuous location sharing. | 目的駅を選ぶと、列車位置と到着時刻が見えるライブ旅程リンクを作成します。位置情報を送り続ける必要はありません。 | — | □ |
| 1223 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 選要看哪個系統 |  to choose a system | で交通機関を選択 | — | □ |
| 1224 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 選捷運小工具，再挑一個車站；鎖定畫面也放得下 | Choose the Metro widget and select a station; it also fits on the Lock Screen | メトロウィジェットを選び、駅を指定します。ロック画面にも追加できます | — | □ |
| 1225 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 選標準／大／特大，面板下方會即時預覽 | Choose Standard, Large or Extra large; the preview updates immediately | 標準／大／特大を選ぶと、下部のプレビューがすぐ更新されます | — | □ |
| 1226 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 選擇介面語言 | Choose interface language | 表示言語を選択 | — | □ |
| 1227 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 選擇檔案後會先預覽，不會立刻寫入收藏。 | After choosing a file, you can preview it before anything is added to favourites. | ファイルを選ぶと先にプレビューし、すぐにはお気に入りへ追加しません。 | — | □ |
| 1228 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 錄 | Rec | 録 | — | □ |
| 1229 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 錄影 | Record | 録画 | — | □ |
| 1230 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 錄影 Beta（存成影片下載） | Record Beta (download a video) | 録画 Beta（動画を保存） | — | □ |
| 1231 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 隨機跟隨 | Follow a random train | ランダム追跡 | — | □ |
| 1232 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 隨機跟隨列車——再按一次換一班（小卡 × 結束） | Follow a random train—tap again to switch trains (× ends following) | 列車をランダム追跡—もう一度押すと列車を変更（×で追跡終了） | — | □ |
| 1233 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 儲存 | Save place | 保存 | — | □ |
| 1234 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 儲存地點 | Save place | 場所を保存 | — | □ |
| 1235 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 儲存地點，看附近經過的火車 | Save a place and see nearby passing trains | 場所を保存して付近の列車を見る | — | □ |
| 1236 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 儲存地點：點地圖標記你要記住的位置、看附近火車，按「存」收藏；再按一次關閉 | Tap the map to mark a place and see nearby trains. Choose Save to keep it; tap the tool again to exit. | 地図をタップして場所と付近の列車を表示します。「保存」で登録し、ツールをもう一度タップすると終了します。 | — | □ |
| 1237 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 儲存地點模式：點地圖標記位置、看附近火車（再按一次關閉） | Save-place mode: tap the map to mark a location and see nearby trains (tap again to exit) | 場所保存モード：地図をタップして地点と付近の列車を表示（もう一度タップで終了） | — | □ |
| 1238 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 壓縮檔內清單超過 {n} 個，請拆開後分批匯入 | The archive contains more than {n} lists. Split it and import in batches. | 圧縮ファイル内のリストが{n}個を超えています。分割して読み込んでください。 | — | □ |
| 1239 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 檔案超過 25 MB，請在 Google Takeout 選擇較小的分卷大小 | The file exceeds 25 MB. Choose a smaller archive size in Google Takeout. | ファイルが25MBを超えています。Google Takeoutで小さい分割サイズを選んでください。 | — | □ |
| 1240 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 營運異常公告中，位置僅供參考 | Service disruption reported; positions are for reference only | 運行情報が発表されています。位置は参考表示です | — | □ |
| 1241 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 營運異常公告中；到站時刻仍依官方即時資料 | Service disruption reported; arrivals still use official live data | 運行情報が発表されています。到着時刻は公式リアルタイム情報を使用します | — | □ |
| 1242 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 營運異常公告中；官方訊號亦中斷，位置與時刻皆為推估 | Service disruption reported; the official feed is also down, so positions and times are estimated | 運行情報が発表され、公式データも中断中です。位置と時刻は推定です | — | □ |
| 1243 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 營運通阻公告 | Service alert | 運行情報 | — | □ |
| 1244 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 營運通阻公告，點開看詳情 | Service status alerts; tap for details | 運行情報。タップして詳細を表示 | — | □ |
| 1245 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 環狀線循環 | Circular service | 環状運転 | — | □ |
| 1246 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 環島完乘 {n}% | Taiwan rail completion {n}% | 台湾鉄道 完乗率 {n}% | — | □ |
| 1247 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 縱貫線南段的日式木造車站 | A Japanese wooden station on the southern Western Trunk Line. | 西部幹線南部に残る日本統治期の木造駅です。 | — | □ |
| 1248 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 縱貫線最北端的端點站 | Northern terminus of the Western Trunk Line. | 西部幹線最北端の終着駅です。 | — | □ |
| 1249 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 總里程 | Total distance | 総距離 | — | □ |
| 1250 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 謝謝你在最早的時候就決定支持軌島 | Thank you for supporting Rail Island from the beginning. | 初期から軌島を支えていただき、ありがとうございます。 | — | □ |
| 1251 | i18n/translations.js、i18n/content-translations.js | 還有 {n} 分 | [one] {n} min<br>[other] {n} min | あと{n}分 | — | □ |
| 1252 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 還有 {n} 座 ▾ | {n} more stations ▾ | あと{n}駅 ▾ | — | □ |
| 1253 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 還有 4 分 | 4 min to go | あと4分 | — | □ |
| 1254 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 還有一張「鐵路＋捷運看板」大卡，把台鐵、高鐵與捷運的發車資訊列在同一張。點小工具會直接開啟軌島到那一站。 | The large Rail and Metro Board combines TRA, HSR and metro departures. Tap a widget to open Rail Island at that station. | 大きな「鉄道＋メトロ案内」では台湾鉄路、高鉄、メトロの発車情報をまとめて表示します。押すと軌島でその駅を開きます。 | — | □ |
| 1255 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 還沒有收藏——跟隨列車後點資訊卡的收藏鈕收藏列車；打開車站看板點收藏鈕收藏車站；用工具列「儲存」在地圖上存地點。 | No favourites yet. Follow a train and use its card’s favourite button; open a station board to favourite a station; or use Save on the toolbar to store a map place. | お気に入りはまだありません。列車追跡カードや駅案内のお気に入りボタン、ツールバーの「保存」から追加できます。 | — | □ |
| 1256 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 還沒有你的位置，先按一次「附近車站」定位 | Your location is not available yet. Use Nearby stations to locate first. | 現在地がまだありません。先に「現在地付近の駅」で測位してください。 | — | □ |
| 1257 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 還沒有完乘記錄——從地圖角落「探」挑一班有趣的車，陪它跑完全程吧。 | No completed trips yet. Use Pick below the map to find a train and follow it for the full trip. | 完乗記録はまだありません。地図の下にある「選」から列車を選び、終点まで追跡してみましょう。 | — | □ |
| 1258 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 還沒有排任何提醒 | No alerts scheduled yet | 設定済みの通知はありません | — | □ |
| 1259 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 還沒有搭乘記錄——用跟車面板的「我上車了」開始收集 | No travel records yet—use “I’m on board” in the follow panel to start collecting. | 乗車記録はまだありません。追跡パネルの「乗車する」から収集を始めましょう。 | — | □ |
| 1260 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 還沒搭過——點我去搭一班 | Not collected yet—tap to ride one | 未収集—タップして乗ってみる | — | □ |
| 1261 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 還是卡住？ | Still stuck? | まだ解決しませんか？ | — | □ |
| 1262 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 隱私 | Privacy | プライバシー | — | □ |
| 1263 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 隱私與服務條款 | Privacy and terms | プライバシーと利用規約 | — | □ |
| 1264 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 隱私權政策 | Privacy Policy | プライバシーポリシー | — | □ |
| 1265 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 隱藏 | Hide | 非表示 | — | □ |
| 1266 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 隱藏（全部壓到極淡，含跟隨路線） | Hidden (all tracks very faint, including the followed route) | 非表示（追跡路線を含め極薄表示） | — | □ |
| 1267 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點 | Tap  | タップ： | — | □ |
| 1268 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點北捷、高捷或機捷的車站打開看板 | Tap a Taipei, Kaohsiung or Taoyuan Metro station to open its board | 台北・高雄・桃園メトロの駅を押して案内を開く | — | □ |
| 1269 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點台鐵車站打開看板 | Tap a TRA station to open its board | 台湾鉄路の駅を押して案内を開く | — | □ |
| 1270 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點任一 | Tap any  | 任意の | — | □ |
| 1271 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點任一平交道，看接下來通過的列車與倒數 | Tap a crossing for upcoming trains and countdowns | 踏切をタップして次の列車とカウントダウンを確認 | — | □ |
| 1272 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點任一列車看介紹卡 | Tap a train to open its story card | 列車をタップして紹介カードを表示 | — | □ |
| 1273 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點任一車號牌 | Tap any train label | 列車番号をタップ | — | □ |
| 1274 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點任一班次看逐站歷程 | Tap a train for its stop-by-stop history | 列車をタップして駅ごとの履歴を表示 | — | □ |
| 1275 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點列車＝跟著它跑 | Tap a train to follow it | 列車をタップして追跡 | — | □ |
| 1276 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點地圖上任一位置 | Tap any point on the map | 地図上の場所をタップ | — | □ |
| 1277 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點地圖上任一車站 | Tap any station on the map | 地図上の駅をタップ | — | □ |
| 1278 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點地圖存點 | Tap map | 地図をタップ | — | □ |
| 1279 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點地圖空白處小卡會收成一顆膠囊——跟車不會斷，點膠囊就展開回來 | Tap empty map space to collapse the card into a pill. Following continues; tap the pill to expand it again. | 地図の空白を押すとカードが小さくなります。列車追跡は続き、もう一度押すと展開します。 | — | □ |
| 1280 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點我重播 | Tap to replay | タップして再生 | — | □ |
| 1281 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點車站＝接下來的班次看板 | Tap a station for upcoming trains | 駅をタップして次の列車を確認 | — | □ |
| 1282 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點車站開看板 · 點列車跟隨 · 點地點看附近火車 · × 移除 | Tap a station for arrivals · tap a train to follow · tap a place for nearby trains · × remove | 駅をタップして案内表示・列車をタップして追跡・場所をタップして近くの列車・×で削除 | — | □ |
| 1283 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點其中一班可以直接跟車；標題右邊的收藏鈕把這站加進最愛 | Tap a service to follow it, or use the star beside the title to save the station. | 列車をタップして追跡、タイトル横の星で駅をお気に入りに追加 | — | □ |
| 1284 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點看介紹 | View story | 紹介を見る | — | □ |
| 1285 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點時鐘＝現在的資料是不是即時的 | Tap the clock to check whether current data is live | 時計を押してデータがリアルタイムか確認 | — | □ |
| 1286 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點班次跟隨 | Tap a service to follow it | 列車をタップして追跡 | — | □ |
| 1287 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點站看接下來的班次 | Tap a station for upcoming trains | 駅をタップして次の列車を見る | — | □ |
| 1288 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點清單裡的站直接開看板 | Tap a listed station to open its board | 一覧の駅をタップして駅案内を開く | — | □ |
| 1289 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點頂端的時鐘（桌面點時鐘那張卡） | Tap the clock at the top; on desktop, tap the clock card | 上部の時計を押す（デスクトップでは時計カード） | — | □ |
| 1290 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點畫面上任一 | Tap any  | 画面上の | — | □ |
| 1291 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 點擊直接指定時刻 | Tap to enter a time | タップして時刻を入力 | — | □ |
| 1292 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 瀏覽器儲存空間不足，無法合併資料 | Browser storage is full; data could not be merged | ブラウザの保存容量が不足し、データを統合できません | — | □ |
| 1293 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 瀏覽器儲存空間不足，無法保存同步結果 | Browser storage is full; sync results could not be saved | ブラウザの保存容量が不足し、同期結果を保存できません | — | □ |
| 1294 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 簡 | Aa | 見 | — | □ |
| 1295 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 藍白塗裝的傳統對號列車。 | A traditional blue-and-white reserved-seat train. | 青と白の伝統的な指定席列車です。 | — | □ |
| 1296 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 藍皮普快 | Blue ordinary train | 藍皮普通列車 | — | □ |
| 1297 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 藍皮解憂號 | Breezy Blue | 藍皮解憂号 | — | □ |
| 1298 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 轉 {routes} | Transfer: {routes} | 乗換：{routes} | — | □ |
| 1299 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 離「{station}」還有 {distance} 公尺，走近一點再蓋（這站的範圍 {radius} 公尺） | You are {distance} m from “{station}”. Move closer to stamp it (station radius: {radius} m). | 「{station}」まであと{distance}mです。近づいてからスタンプしてください（判定範囲{radius}m）。 | — | □ |
| 1300 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 離峰 | Off-peak | 通常 | — | □ |
| 1301 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 離開 | Exit | 終了 | — | □ |
| 1302 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 離開收集地圖，回到即時地圖 | Leave the collection map and return to the live map | 収集マップを終了してライブ地図に戻る | — | □ |
| 1303 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 離開放空 | Exit ambient mode | 鑑賞モードを終了 | — | □ |
| 1304 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 關於 | About | 軌島について | — | □ |
| 1305 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 關閉 | Close | 閉じる | — | □ |
| 1306 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 關閉——這批公告本次不再跳出 | Close—do not show this set of alerts again this session | 閉じる—このセッションでは同じ運行情報を再表示しない | — | □ |
| 1307 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 關閉公告橫幅 | Close alert banner | 運行情報バナーを閉じる | — | □ |
| 1308 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 關閉列車卡（跟車不中斷） | Close train card (following continues) | 列車カードを閉じる（追跡は継続） | — | □ |
| 1309 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 懸 | ! | 募 | — | □ |
| 1310 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 蘇澳線 | Su’ao Line | 蘇澳線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1311 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 覺得有幫助？請支持開發者 | Enjoying Rail Island? Support its developer | 軌島を気に入ったら開発を応援してください | — | □ |
| 1312 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 護照 | Passport | パスポート | — | □ |
| 1313 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 鐵道路線（顯示／隱藏軌道） | Rail routes (show / hide tracks) | 鉄道路線（線路の表示／非表示） | — | □ |
| 1314 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 鐵道魂 | Railway spirit | 鉄道魂 | — | □ |
| 1315 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 歡迎搭乘 | Welcome aboard | ようこそ | — | □ |
| 1316 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 顯示平交道位置 | Show level crossings | 踏切の位置を表示 | — | □ |
| 1317 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 顯示列車行進方向箭頭 | Show train direction arrows | 列車の進行方向を表示 | — | □ |
| 1318 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 顯示車種與方向 | Show train type and direction | 列車種別と方向を表示 | — | □ |
| 1319 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 顯示資訊（退出極簡） | Show information (exit minimal view) | 情報を表示（最小表示を終了） | — | □ |
| 1320 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 顯示與字級 | Display and text size | 表示と文字サイズ | — | □ |
| 1321 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 讓看板、列車卡與跟隨面板透出後方地圖，面板底下的路線、車站都看得到；面板最上方的標題列也一起透。 | Let the map show through station boards, train cards and follow panels, including their title bars. | 駅案内、列車カード、追跡パネルとタイトルバーを半透明にし、背後の地図を見えるようにします。 | — | □ |
| 1322 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 讓看板、列車卡與跟隨面板透出後方地圖，面板底下的路線、車站都看得到。 | Make boards and train panels translucent so routes and stations remain visible beneath them. | 駅案内や列車パネルを半透明にし、背後の路線と駅を見えるようにします。 | — | □ |
| 1323 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 觀光列車 | Sightseeing train | 観光列車 | — | □ |
| 1324 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 觀光列車・無固定班次，開行日期與車次以台鐵公告為準 | Tourist train without a fixed daily service. Check TRA announcements for dates and train numbers. | 定期運行のない観光列車です。運転日と列車番号は台湾鉄路の発表をご確認ください。 | — | □ |
| 1325 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 觀光列車圖鑑（無固定車次） | Tourist-train gallery (no fixed service) | 観光列車図鑑（定期運行なし） | — | □ |
| 1326 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | 觀看模式 | Viewing mode | 表示モード | — | □ |
| 1327 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | App 版收起或鎖定螢幕也繼續播；跟車時鎖定畫面讓位給列車動態，其餘時候可在鎖定畫面暫停／換首 | In the app, music continues in the background. While following, train status uses the Lock Screen; otherwise music controls remain available. | Appではバックグラウンドでも再生します。追跡中はロック画面を列車情報に使い、それ以外は音楽操作を表示します。 | — | □ |
| 1328 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | App 非跟車時的衛星高解析圖磚（支援 Retina 螢幕） | High-resolution satellite tiles in the app when not following a train (Retina supported) | アプリで列車追跡中以外に高解像度衛星地図を表示（Retina対応） | — | □ |
| 1329 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | App 旅程護照的創始島民徽章 | Founding Islander badge in the app Journey Passport | アプリの旅のパスポートに創始島民バッジ | — | □ |
| 1330 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | App 留在前景時藍點與所在地鏡頭會持續跟著你；「附近車站」告訴你最近的車站與下一班車還有幾分鐘。 | While the app is in the foreground, the blue dot and location camera keep following you. Nearby stations shows the closest stations and minutes to the next train. | アプリが前面にある間、青い点と現在地カメラが移動を追います。「近くの駅」では最寄り駅と次の列車までの分数を確認できます。 | — | □ |
| 1331 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | App 進階定位與 Live Activity | Advanced app location and Live Activity | アプリの高度な位置情報とLive Activity | — | □ |
| 1332 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | Apple 重新登入沒有回傳可撤銷的授權憑證 | Apple reauthentication did not return a revocable authorization credential | Appleの再ログインから取り消し可能な認証情報が返されませんでした | — | □ |
| 1333 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | Apple 隱藏電子郵件 | Apple Hide My Email | Appleのメールを非公開 | — | □ |
| 1334 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | CARTO basemaps（© OpenStreetMap）、Esri World Imagery（衛星影像）與 Natural Earth（離線海陸輪廓） | CARTO basemaps (© OpenStreetMap), Esri World Imagery and Natural Earth offline land outlines. | CARTOベースマップ（© OpenStreetMap）、Esri World Imagery、Natural Earthのオフライン陸地輪郭。 | — | □ |
| 1335 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | DR1000 型柴油客車 | DR1000 diesel railcar | DR1000型気動車 | — | □ |
| 1336 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | DR2800／2900／3100 型柴油電聯車，不吃電、非電化區間也能跑。 | DR2800, 2900 and 3100 diesel multiple units that can run beyond electrified lines. | DR2800・2900・3100型気動車で、非電化区間も走行できます。 | — | □ |
| 1337 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | E1000 型推拉式自強號，前後機車頭一推一拉。 | A push–pull intercity train with a locomotive at each end. | 編成の前後に機関車を置くプッシュプル式都市間列車です。 | — | □ |
| 1338 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | EMU3000 新自強 | EMU3000 Tze-Chiang | EMU3000新自強号 | — | □ |
| 1339 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | Google 清單匯入 | Import Google lists | Google リストを読み込む | — | □ |
| 1340 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | Google 登入只用於軌島帳號，不會因此取得 Google Maps 已儲存清單；清單匯入仍需使用 Google Takeout。 | Google sign-in is only for your Rail Island account. It does not grant access to Google Maps saved lists; use Google Takeout to import them. | Googleログインは軌島アカウントだけに使います。Googleマップの保存済みリストにはアクセスしません。読み込みにはGoogle Takeoutを使用してください。 | — | □ |
| 1341 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | iPhone 主畫面 App 常無法自動定位，用 Safari 開較穩定 | Home-screen web apps on iPhone may not provide location reliably; opening in Safari is more reliable | iPhoneのホーム画面Webアプリでは位置情報が不安定な場合があります。Safariで開くとより確実です | — | □ |
| 1342 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | iPhone 的動態島展開畫面增加圓角安全留白：捷運等車、台鐵等站與列車跟隨的內容都往內收，文字與「結束」按鈕不再被邊緣切掉；繁中、English、日本語一起套用；文字大小設定的目前值與詳細選項也會完整切換語言 | Expanded Dynamic Island views now keep a safe margin from their rounded edges. Metro waiting, TRA station tracking and train following move inward so text and the End button are no longer clipped; the fix applies to Traditional Chinese, English and Japanese. The current text-size value and its detailed options now switch languages completely as well. | iPhoneのDynamic Island展開表示に角丸の安全余白を追加しました。メトロ待ち、台湾鉄路の駅待ち、列車追跡の内容を内側へ寄せ、文字や「終了」ボタンが端で欠けないようにしました。繁体字中国語・英語・日本語すべてに適用されます。文字サイズ設定の現在値と詳細項目もすべて選択中の言語へ切り替わります。 | — | □ |
| 1343 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | Ko-fi（信用卡 / PayPal） | Ko-fi（credit card / PayPal） | Ko-fi（クレジットカード／PayPal） | — | □ |
| 1344 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | OpenFreeMap（© OpenFreeMap © OpenMapTiles © OpenStreetMap 貢獻者，街道圖）、CARTO（© OpenStreetMap © CARTO，街道圖退路）、Esri World Imagery（衛星影像）與內政部「直轄市、縣市界線」（離線海陸輪廓，政府資料開放授權條款第1版） | OpenFreeMap (© OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors), CARTO (© OpenStreetMap, © CARTO fallback), Esri World Imagery, and Ministry of the Interior county boundaries for the offline Taiwan outline. | OpenFreeMap（© OpenFreeMap、© OpenMapTiles、© OpenStreetMap contributors）、CARTO、Esri World Imagery、内政部の県市境界データを利用しています。 | — | □ |
| 1345 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | OpenFreeMap（© OpenFreeMap © OpenMapTiles © OpenStreetMap，街道圖）、Stadia Maps（© Stadia Maps © OpenMapTiles © OpenStreetMap，街道圖退路）、Esri World Imagery（衛星影像）與內政部「直轄市、縣市界線」（離線海陸輪廓，政府資料開放授權條款第1版） | OpenFreeMap (© OpenFreeMap, © OpenMapTiles and © OpenStreetMap; street map), Stadia Maps (© Stadia Maps, © OpenMapTiles and © OpenStreetMap; street-map fallback), Esri World Imagery (satellite imagery), and Ministry of the Interior city and county boundaries (offline land-and-sea outline; Taiwan Government Data Open Licence 1.0). | OpenFreeMap（© OpenFreeMap、© OpenMapTiles、© OpenStreetMap・街路地図）、Stadia Maps（© Stadia Maps、© OpenMapTiles、© OpenStreetMap・街路地図のフォールバック）、Esri World Imagery（衛星画像）、内政部「直轄市・県市界」（オフライン海陸輪郭、政府資料開放授権条款第1版）を利用しています。 | — | □ |
| 1346 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | Plus 已啟用 | Plus is active | Plus は有効です | — | □ |
| 1347 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | Plus 購買元件載入失敗 | The Plus purchase component failed to load. | Plus購入コンポーネントを読み込めませんでした。 | — | □ |
| 1348 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | PP 自強號 | PP Tze-Chiang | PP自強号 | — | □ |
| 1349 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | TEMU1000 型傾斜式電聯車，過彎不必大幅減速，主跑東部幹線。 | TEMU1000 tilting EMU, primarily used on the eastern main line. | 曲線を高速で通過できるTEMU1000型振子式電車で、主に東部幹線を走ります。 | — | □ |
| 1350 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | TEMU2000 型傾斜式電聯車，2013 年起投入東部幹線。 | TEMU2000 tilting EMU, serving the eastern main line since 2013. | 2013年から東部幹線で運用するTEMU2000型振子式電車です。 | — | □ |
| 1351 | i18n/translations.js、i18n/content-translations.js；App／Widget／Live Activity Localizable.xcstrings | ZIP 解壓元件載入失敗 | Could not load the ZIP extraction component | ZIP展開機能を読み込めませんでした | — | □ |

## 特色列車、車種與支線故事（93 筆）

| # | 來源 | 繁中原文 | English | 日本語 | 自動提示 | 複核 |
|---:|---|---|---|---|---|:---:|
| 1352 | RAIL_I18N_CONTENT_DATA.rollingStock.chukuang.story | 1970 年登場、名字來自「毋忘在莒」的年代記憶，是台鐵第一款有冷氣的對號列車，當年票價是普通車的三倍。橘色塗裝跑了半世紀，全盛期一天 76 列次，2026 年 7 月改點後全台只剩 7 班，官方規劃 2028 年底前功成身退——看一班少一班。 | Introduced in 1970 as TRA’s first air-conditioned reserved-seat train, the orange-and-cream locomotive-hauled service once ran 76 times a day. Only seven daily services remain after the July 2026 timetable change. | 1970年登場の台湾鉄路初の冷房付き指定席列車です。最盛期は1日76本あったクリームとオレンジの客車列車も、2026年7月改正後は1日7本だけになりました。 | — | □ |
| 1353 | RAIL_I18N_CONTENT_DATA.rollingStock.pp.story | 1996 年登場的一代名車：前後各一顆機車頭一推一拉，中間全是客車廂，圓滾滾的車鼻讓鐵道迷暱稱它「豬頭」，也是台灣第一款流線型列車。2026 年 7 月改點後，服役 30 年的老 E1000 機車頭退出定期營運，改由全新日製 E500 機車頭接棒牽引，車廂則繼續服役。 | Introduced in 1996, this classic has a locomotive at each end of a long coach set. The original E1000 locomotives left scheduled service in July 2026; new Japanese E500 locomotives now haul the coaches. | 1996年登場。客車の前後に機関車を置いて押し引きする名車です。旧E1000機関車は2026年7月に定期運用を退き、新しい日本製E500機関車が客車を牽引しています。 | — | □ |
| 1354 | RAIL_I18N_CONTENT_DATA.rollingStock.dr3100.story | 1998 年日本車輛與唐榮聯手打造的不鏽鋼柴聯車，台鐵僅存還在定期營運的柴聯自強。自帶柴油引擎、不吃電車線，所以在早已電化的北迴線上照樣奔馳。2023 年退出西部幹線後，只剩樹林—花蓮少數班次，是活的鐵道史。 | Built in 1998 by Nippon Sharyo and Tang Eng, the stainless-steel DR3100 is TRA’s last diesel intercity multiple unit in regular service. Only a few Shulin–Hualien trains remain. | 1998年に日本車輌と唐栄が製造したステンレス製気動車で、台湾鉄路に残る最後の定期運行ディーゼル自強号です。現在は樹林―花蓮間の少数列車だけです。 | — | □ |
| 1355 | RAIL_I18N_CONTENT_DATA.branchLines.liujia.story | 2011 年通車的全高架通勤支線，從竹中站直達高鐵新竹站，讓台鐵與高鐵首次無縫接軌，是台鐵捷運化的代表作。 | This fully elevated commuter branch opened in 2011, linking TRA at Zhuzhong directly with Hsinchu HSR station and representing TRA’s metro-style modernisation. | 2011年開業の全線高架通勤支線です。竹中から高鉄新竹駅へ直結し、台湾鉄路の都市鉄道化を象徴します。 | — | □ |
| 1356 | RAIL_I18N_CONTENT_DATA.branchLines.shalun.story | 2011 年通車的高鐵聯絡線，台鐵最南端的支線，也是南迴線之後台鐵再次新築的路線；全程高架、首例跨越國道一號，串起台南市區與高鐵站。 | Opened in 2011, this elevated HSR connector links central Tainan with the high-speed rail station and is TRA’s southernmost branch line. | 2011年開業の高鉄連絡線で、台南市街と高鉄駅を結ぶ全線高架の台湾鉄路最南端の支線です。 | — | □ |
| 1357 | RAIL_I18N_CONTENT_DATA.namedTrains.steam.tags[2] | 一票難求 | Very limited tickets | 入手困難 | — | □ |
| 1358 | RAIL_I18N_CONTENT_DATA.branchLines.jiji.section | 二水—車埕 | Ershui–Checheng | 二水―車埕 | — | □ |
| 1359 | RAIL_I18N_CONTENT_DATA.branchLines.pingxi.section | 三貂嶺—菁桐 | Sandiaoling–Jingtong | 三貂嶺―菁桐 | — | □ |
| 1360 | RAIL_I18N_CONTENT_DATA.namedTrains.shanhai.name | 山海號 | Shanhai | 山海号 | — | □ |
| 1361 | RAIL_I18N_CONTENT_DATA.namedTrains.shanlan.name | 山嵐號 | Shanlan | 山嵐号 | — | □ |
| 1362 | RAIL_I18N_CONTENT_DATA.namedTrains.cruise.story | 不是一輛車，而是一種玩法：模仿郵輪「長時間停靠讓旅客上岸遊覽」的節奏，火車在各站多停一兩小時讓你下車玩，玩夠再上車。2008 年開辦至今，是台鐵行之有年的一日遊列車形式。 | Not one particular train but a way to travel: services stop for one or two hours so passengers can explore, then reboard for the next destination. TRA has offered these rail day trips since 2008. | 特定の車両名ではなく、各駅で1～2時間停車し、観光してから再び乗車するクルーズ船のような旅の方式です。台湾鉄路が2008年から実施しています。 | — | □ |
| 1363 | RAIL_I18N_CONTENT_DATA.branchLines.shalun.section | 中洲—沙崙（列車多自台南直通） | Zhongzhou–Shalun（most trains continue from Tainan） | 中洲―沙崙（多くは台南から直通） | — | □ |
| 1364 | RAIL_I18N_CONTENT_DATA.branchLines.neiwan.name | 內灣線 | Neiwan Line | 内湾線 | — | □ |
| 1365 | RAIL_I18N_CONTENT_DATA.branchLines.liujia.name | 六家線 | Liujia Line | 六家線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1366 | RAIL_I18N_CONTENT_DATA.rollingStock.emu3000.story | 日立團隊以「靜謐移動」為題設計的新世代城際列車，拿下日本 Good Design Best 100。2021 年登場、50 列 600 輛全數到齊，2026 年 7 月改點後正式升格為台鐵城際主力，也是首款設有商務車廂「騰雲座艙」的台鐵列車。 | Hitachi designed this new intercity train around “silent mobility,” earning a Good Design Best 100 award. All 50 twelve-car sets are in service, including TRA’s first business-class cabin, Tengyun. | 日立が「静謐な移動」をテーマに設計し、Good Design Best 100を受賞した新世代都市間列車です。12両編成50本が揃い、台湾鉄路初のビジネスクラス「騰雲座艙」も備えます。 | — | □ |
| 1367 | RAIL_I18N_CONTENT_DATA.namedTrains.mingri.tags[2] | 包車制 | Package only | ツアー限定 | — | □ |
| 1368 | RAIL_I18N_CONTENT_DATA.namedTrains.blue-train.tags[2] | 可自行購票 | Individual tickets available | 個人で乗車券購入可 | — | □ |
| 1369 | RAIL_I18N_CONTENT_DATA.rollingStock.local.story | 台鐵的日常擔當，全日班次占了整張班表七成以上。最新一代 EMU900 由韓國 Rotem 與法國 TGV 設計團隊合作，彎彎的「微笑頭燈」配亮綠色腰帶，還首創孕婦優先座與車內直立式自行車架，被媒體稱作「最美區間車」。 | The backbone of everyday TRA service. The newest EMU900 generation pairs curved “smiling” headlights with a bright green stripe and includes priority seating and upright bicycle racks. | 台湾鉄路の日常を支える列車です。最新のEMU900は「笑顔」のような前照灯と明るい緑の帯が特徴で、優先席や縦置き自転車ラックも備えます。 | — | □ |
| 1370 | RAIL_I18N_CONTENT_DATA.rollingStock.dr3100.facts[1] | 台鐵首批出廠就配自動門的柴油城際列車 | It was TRA’s first diesel intercity train delivered with automatic doors. | 台湾鉄路で初めて新製時から自動ドアを備えたディーゼル都市間列車です。 | — | □ |
| 1371 | RAIL_I18N_CONTENT_DATA.namedTrains.mingri.story | 台鐵首款五星級觀光列車，黑橘塗裝配檜木質感內裝，結合「鳴日廚房」供應在地食材料理，主打五感體驗的頂級鐵道旅行。每月僅約 6 班、限量預約制，是台鐵觀光列車的旗艦門面。 | TRA’s five-star sightseeing flagship pairs a black-and-orange exterior with a cypress-inspired interior. Future Dining serves dishes made with local ingredients; its limited package journeys are reservation only and have no fixed public timetable. | 黒とオレンジの外観、ヒノキ調の内装を備えた台湾鉄路の五つ星観光列車です。「鳴日キッチン」では台湾各地の食材を使った料理を提供し、少数限定の予約制ツアーとして運行します。 | — | □ |
| 1372 | RAIL_I18N_CONTENT_DATA.rollingStock.taroko.story | 台鐵第一款傾斜式列車，2006 年由日立打造、血統源自 JR 九州 885 系。車身過彎時最多傾斜 5 度，能比一般列車快 25 公里過彎，全車對號、不賣站票。2026 年 6 月改點後只跑樹林—花蓮，全台一天僅 6 列次，看到一班算一班。 | TRA’s first tilting train was built by Hitachi in 2006 from the JR Kyushu 885 family. Its body tilts up to five degrees through curves; reserved seats only. In 2026 it operates just six daily services between Shulin and Hualien. | JR九州885系をルーツに日立が2006年に製造した台湾鉄路初の振子式列車です。曲線で最大5度傾斜し、全車指定席。2026年は樹林―花蓮間を1日6本だけ運転します。 | — | □ |
| 1373 | RAIL_I18N_CONTENT_DATA.branchLines.jiji.story | 台鐵最長支線（29.7 公里），前身是興建水力電廠的運輸線。1930 年的檜木集集車站歷經 921 地震損毀又重生，終點車埕保留木業聚落風貌。 | TRA’s longest branch line began as transport for hydroelectric construction. Jiji’s 1930 cypress station was rebuilt after the 1999 earthquake, and Checheng preserves its timber-town character. | 水力発電所建設の輸送線を前身とする台湾鉄路最長の支線です。1930年建築の集集駅と木材の町・車埕の景観が残ります。 | — | □ |
| 1374 | RAIL_I18N_CONTENT_DATA.namedTrains.haifeng.story | 台灣第一輛甜點觀光列車，由 EMU500 改造，湛藍與翠綠塗裝呼應近海風情，全景大窗配面海座位，車上供應與烘焙工作室合作的限定甜點。2026 年夏季開出南港—宜蘭新路線，是班表上「電車(專)」神祕車次的真身。 | Taiwan’s first dessert sightseeing train is a rebuilt EMU500 in ocean blue and green. Panoramic windows, sea-facing seats and limited-edition pastries accompany its seasonal Nangang–Yilan journeys. | EMU500を改造した台湾初のスイーツ観光列車です。海を思わせる青緑の車体、パノラマ窓と海向き座席で、限定スイーツを楽しみながら南港―宜蘭を季節運行します。 | — | □ |
| 1375 | RAIL_I18N_CONTENT_DATA.namedTrains.pingyuan.name | 平原號 | Pingyuan | 平原号 | — | □ |
| 1376 | RAIL_I18N_CONTENT_DATA.branchLines.pingxi.name | 平溪線 | Pingxi Line | 平渓線 | — | □ |
| 1377 | RAIL_I18N_CONTENT_DATA.namedTrains.pingyuan.story | 本站原創的虛構觀光列車：自臺北往西南，沿縱貫線一路穿過桃竹苗丘陵與嘉南平原的稻浪，經高雄轉屏東線抵達枋寮。永不停駛，到站即折返，十二小時一輪來回。與走東部的山海號是兄弟車，在枋寮擦肩。 | A fictional Rail Island train from Taipei to Fangliao via the Western Trunk and Pingtung lines. It crosses northern hills and the Chianan Plain, turns back at Fangliao and meets its eastern sibling Shanhai there. | 軌島オリジナルの架空列車です。台北から縦貫線と屏東線で枋寮へ向かい、北部の丘陵と嘉南平原を横断します。枋寮で折り返し、東回りの兄弟列車・山海号とすれ違います。 | — | □ |
| 1378 | RAIL_I18N_CONTENT_DATA.namedTrains.shanhai.story | 本站原創的虛構觀光列車：自臺北往東，沿宜蘭線、北迴線、臺東線與南迴線直抵枋寮——一側太平洋、一側中央山脈，龜山島、清水斷崖與縱谷稻田輪流入窗。永不停駛，到枋寮即折返，十二小時一輪來回。與走西部的平原號是兄弟車，在枋寮擦肩。 | A fictional Rail Island train from Taipei to Fangliao via the Yilan, North Link, Taitung and South Link lines. Ocean, mountains and valley rice fields pass the windows; it turns back immediately at Fangliao for a continuous twelve-hour round trip. | 軌島オリジナルの架空列車です。台北から宜蘭線、北廻線、台東線、南廻線を通って枋寮へ向かい、海、山、縦谷の田園を眺めながら、到着後すぐ折り返して12時間で一往復します。 | — | □ |
| 1379 | RAIL_I18N_CONTENT_DATA.namedTrains.shanhai.tags[2] | 永不停駛 | Runs continuously | 終日運転 | — | □ |
| 1380 | RAIL_I18N_CONTENT_DATA.namedTrains.pingyuan.tags[2] | 永不停駛 | Runs continuously | 終日運転 | — | □ |
| 1381 | RAIL_I18N_CONTENT_DATA.namedTrains.steam.name | 仲夏寶島號（CT273 蒸汽火車） | Midsummer Formosa（CT273 steam train） | 仲夏宝島号（CT273蒸気機関車） | — | □ |
| 1382 | RAIL_I18N_CONTENT_DATA.namedTrains.star.story | 全台唯一環島觀光列車，13 小時繞台灣一圈。車廂主題隨年代改朝換代：初代 Hello Kitty、迪士尼「夢想號」，到現行三麗鷗「萌旅號」——布丁狗、酷洛米、美樂蒂彩繪滿車，車上還有卡拉 OK 與吧檯。 | Taiwan’s only round-island tourist train completes a circuit in about 13 hours. Today’s Sanrio-themed Cute Express features Pompompurin, Kuromi and My Melody, along with karaoke and a lounge counter. | 約13時間で台湾を一周する唯一の環島観光列車です。現行のサンリオ「萌旅号」はポムポムプリン、クロミ、マイメロディを装飾し、カラオケとバーカウンターも備えます。 | — | □ |
| 1383 | RAIL_I18N_CONTENT_DATA.namedTrains.blue-train.story | 全台唯一還在動態運行的骨董藍皮普快車廂：手動推窗、復古吊扇、綠皮座椅，1960–70 年代的慢車時光原封不動。行駛南迴線 98 公里的「微笑曲線」，一側太平洋、一側台灣海峽，2020 年停駛定期普快後，2021 年以觀光列車之姿復活。 | Taiwan’s only heritage blue ordinary coaches still in regular motion preserve hand-opened windows, vintage fans and green seats from the 1960s and 70s. The train follows the 98 km “smile curve” of the South Link Line between ocean and mountains, returning as a tourist service in 2021. | 手動窓、レトロな扇風機、緑色の座席を残す、台湾で唯一現役の藍皮普通客車です。南廻線98kmの「スマイルカーブ」を海と山に挟まれて走り、2021年に観光列車として復活しました。 | — | □ |
| 1384 | RAIL_I18N_CONTENT_DATA.rollingStock.taroko.facts[1] | 全車烤漆是台鐵車輛首創，配色神似高鐵 700T | It was TRA’s first train with a fully painted body, in colours reminiscent of the 700T high-speed train. | 台湾鉄路で初めて車体全面塗装を採用し、高鉄700Tに似た配色です。 | — | □ |
| 1385 | RAIL_I18N_CONTENT_DATA.rollingStock.dr3100.facts[0] | 同期的 DR2800／2900／3000 都已退役，只有它因年限未滿續留 | Contemporary DR2800, DR2900 and DR3000 fleets have retired; the younger DR3100 remains. | 同世代のDR2800・2900・3000は引退し、比較的新しいDR3100だけが残りました。 | — | □ |
| 1386 | RAIL_I18N_CONTENT_DATA.rollingStock.taroko.facts[0] | 名字來自公開徵名，擊敗「曙光號」「飛魚號」等候選 | Its public naming contest chose “Taroko” over candidates including Dawn and Flying Fish. | 一般公募で「曙光号」「飛魚号」などを抑えて「太魯閣号」に決まりました。 | — | □ |
| 1387 | RAIL_I18N_CONTENT_DATA.rollingStock.puyuma.story | 名字取自卑南族語，意為「團結」。日本車輛製造的第二代傾斜式列車，用空氣彈簧讓車身過彎傾斜 1 到 2 度——和新幹線 N700 系同一套原理。2013 年投入營運後長年擔當東部幹線主力，把台北到台東的時間大幅拉近。 | Named from a Puyuma word meaning unity, this second-generation Japanese tilting train uses air springs like the N700 Shinkansen. Since 2013 it has been a mainstay of eastern Taiwan services. | プユマ語の「団結」にちなむ、日本車輌製造の第2世代振子式列車です。N700系と同様の空気ばね方式を採用し、2013年から東部幹線の主力を担っています。 | — | □ |
| 1388 | RAIL_I18N_CONTENT_DATA.branchLines.liujia.section | 竹中—六家 | Zhuzhong–Liujia | 竹中―六家 | — | □ |
| 1389 | RAIL_I18N_CONTENT_DATA.rollingStock.chukuang.facts[1] | 米白配橘紅塗裝從 1979 年沿用至今 | Its cream-and-orange livery has been used since 1979. | クリームとオレンジの塗装は1979年から使われています。 | — | □ |
| 1390 | RAIL_I18N_CONTENT_DATA.namedTrains.bike.tags[0] | 自行車 | Bicycles | 自転車 | — | □ |
| 1391 | RAIL_I18N_CONTENT_DATA.rollingStock.pp.facts[1] | 你現在看到的 PP 自強，多半已是新 E500 機車頭在拉的「PP 2.0」 | Most PP trains today are “PP 2.0” sets hauled by new E500 locomotives. | 現在のPP自強号の多くは新E500機関車が牽引する「PP 2.0」です。 | — | □ |
| 1392 | RAIL_I18N_CONTENT_DATA.namedTrains.steam.story | 每年夏天限定的蒸汽火車專列：「蒸機女王」CT273 牽引六節莒光號車廂，噴煙鳴笛駛過花東縱谷。活動源於 CK124 與日本 JR 北海道「冬季濕原號」締結姊妹車的紀念，2026 年僅開 3 趟次，是鐵道迷的年度朝聖。 | A summer-only special hauled by steam locomotive CT273 with six Chu-Kuang coaches through the East Rift Valley. Smoke, whistles and only a handful of annual runs make it a highlight for railway enthusiasts. | 蒸気機関車CT273が莒光号客車6両を牽引して花東縦谷を走る夏限定列車です。煙と汽笛、年数回だけの運行で鉄道ファンの恒例行事になっています。 | — | □ |
| 1393 | RAIL_I18N_CONTENT_DATA.branchLines.shalun.name | 沙崙線 | Shalun Line | 沙崙線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1394 | RAIL_I18N_CONTENT_DATA.namedTrains.bike.name | 兩鐵列車（人車同行） | Bike-and-Rail Train | 両鉄列車（自転車同伴） | — | □ |
| 1395 | RAIL_I18N_CONTENT_DATA.rollingStock.emu3000.facts[0] | 和太魯閣、普悠瑪不同，它沒有傾斜機制——靠新路線標準與性能取勝 | Unlike Taroko and Puyuma trains, the EMU3000 has no tilting mechanism; it relies on modern performance and improved track standards. | 太魯閣号・普悠瑪号と異なり車体傾斜装置はなく、新しい線路規格と車両性能で高速化しています。 | — | □ |
| 1396 | RAIL_I18N_CONTENT_DATA.namedTrains.haifeng.tags[2] | 季節限定 | Seasonal | 季節運行 | — | □ |
| 1397 | RAIL_I18N_CONTENT_DATA.namedTrains.steam.tags[1] | 季節限定 | Seasonal | 季節運行 | — | □ |
| 1398 | RAIL_I18N_CONTENT_DATA.namedTrains.pingyuan.tags[0] | 往西・縱貫屏東線 | Western route · Western Trunk and Pingtung | 西回り・縦貫／屏東線 | — | □ |
| 1399 | RAIL_I18N_CONTENT_DATA.namedTrains.shanhai.tags[0] | 往東・宜蘭花東線 | Eastern route · Yilan and Hualien–Taitung | 東回り・宜蘭／花東線 | — | □ |
| 1400 | RAIL_I18N_CONTENT_DATA.namedTrains.shanlan.tags[1] | 花東縱谷 | East Rift Valley | 花東縦谷 | — | □ |
| 1401 | RAIL_I18N_CONTENT_DATA.rollingStock.pp.facts[0] | 客車廂是韓國現代精工製造，機車頭來自南非 | The coaches were built by Hyundai Precision in Korea and the original locomotives came from South Africa. | 客車は韓国の現代精工、旧機関車は南アフリカ製です。 | — | □ |
| 1402 | RAIL_I18N_CONTENT_DATA.namedTrains.cruise.tags[0] | 旅遊模式 | Travel format | 旅のスタイル | — | □ |
| 1403 | RAIL_I18N_CONTENT_DATA.rollingStock.local.facts[0] | 時刻表資料無法區分 EMU500／700／800／900 各世代，看到微笑頭燈就是 EMU900 | Timetable data cannot distinguish EMU500, 700, 800 and 900 generations; smiling headlights identify an EMU900. | 時刻表だけではEMU500・700・800・900を区別できません。笑顔のような前照灯がEMU900の目印です。 | — | □ |
| 1404 | RAIL_I18N_CONTENT_DATA.namedTrains.haifeng.name | 海風號 | Haifeng | 海風号 | — | □ |
| 1405 | RAIL_I18N_CONTENT_DATA.namedTrains.shanlan.story | 海風號的姊妹車，台灣第一輛行駛花東縱谷的觀光列車。黃綠色車身呼應縱谷稻浪，車廂裡飄著檀香與小荳蔻香氣，全景大窗把稻田與山嵐一次收進來。2024 年與海風號同步登場。 | Haifeng’s sister train and Taiwan’s first sightseeing train through the East Rift Valley. Its yellow-green livery, fragrant cabin and wide windows frame rice fields and mountain mist between Hualien and Chishang. | 海風号の姉妹列車で、花東縦谷を走る台湾初の観光列車です。黄緑色の車体と香りの演出、ワイドな窓から田園と山霧を望めます。 | — | □ |
| 1406 | RAIL_I18N_CONTENT_DATA.namedTrains.blue-train.tags[1] | 骨董車 | Heritage coaches | レトロ客車 | — | □ |
| 1407 | RAIL_I18N_CONTENT_DATA.rollingStock.fast-local.name | 區間快車 | Fast Local | 区間快車 | — | □ |
| 1408 | RAIL_I18N_CONTENT_DATA.rollingStock.local.name | 區間車（通勤電聯車） | Local train（commuter EMU） | 区間車（通勤電車） | — | □ |
| 1409 | RAIL_I18N_CONTENT_DATA.rollingStock.fast-local.story | 區間車的快跑版：同樣的通勤電聯車，但跳過小站只停主要車站，是通勤族搶時間的好朋友。想在地圖上分辨它，看它一路略過小站的跳站節奏就知道。 | The quicker version of a local train uses similar commuter EMUs but skips smaller stations. On the map, its rhythm of passing stops makes it easy to recognise. | 区間車と同じ通勤電車を使いながら小駅を通過する速達版です。地図では駅を飛ばして進む停車パターンで見分けられます。 | — | □ |
| 1410 | RAIL_I18N_CONTENT_DATA.namedTrains.bike.tags[1] | 常態服務 | Regular service | 通年サービス | — | □ |
| 1411 | RAIL_I18N_CONTENT_DATA.rollingStock.pp.name | 推拉式自強號（PP） | Push–pull Tze-Chiang（PP） | プッシュプル自強号（PP） | — | □ |
| 1412 | RAIL_I18N_CONTENT_DATA.branchLines.shenao.name | 深澳線 | Shen’ao Line | 深澳線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1413 | RAIL_I18N_CONTENT_DATA.rollingStock.puyuma.facts[1] | 現役 18 列，車頭的流線紅黑塗裝辨識度極高 | Eighteen sets remain in service, instantly recognisable by their streamlined red-and-black fronts. | 18編成が現役で、赤と黒の流線形先頭部が目印です。 | — | □ |
| 1414 | RAIL_I18N_CONTENT_DATA.namedTrains.haifeng.tags[1] | 甜點列車 | Dessert train | スイーツ列車 | — | □ |
| 1415 | RAIL_I18N_CONTENT_DATA.rollingStock.chukuang.name | 莒光號 | Chu-Kuang Express | 莒光号 | — | □ |
| 1416 | RAIL_I18N_CONTENT_DATA.namedTrains.mingri.tags[1] | 頂級 | Luxury | ラグジュアリー | — | □ |
| 1417 | RAIL_I18N_CONTENT_DATA.branchLines.shenao.story | 幾度停駛又復活的海岸支線，2014 年為海科館復駛，是台灣唯一山海相接的支線；停用的深澳段軌道變身鐵道自行車，在退役鐵軌上看北海岸。 | A coastal branch revived for the marine museum in 2014. Its disused extension now carries rail bikes along the north coast. | 2014年に海洋科技博物館へのアクセスとして復活した海岸支線です。廃止区間では北海岸を眺めるレールバイクが走ります。 | — | □ |
| 1418 | RAIL_I18N_CONTENT_DATA.namedTrains.shanhai.tags[1] | 虛構觀光列車 | Fictional tourist train | 架空の観光列車 | — | □ |
| 1419 | RAIL_I18N_CONTENT_DATA.namedTrains.pingyuan.tags[1] | 虛構觀光列車 | Fictional tourist train | 架空の観光列車 | — | □ |
| 1420 | RAIL_I18N_CONTENT_DATA.namedTrains.cruise.name | 郵輪式列車 | Cruise-style Train | クルーズ式列車 | — | □ |
| 1421 | RAIL_I18N_CONTENT_DATA.branchLines.jiji.name | 集集線 | Jiji Line | 集集線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1422 | RAIL_I18N_CONTENT_DATA.rollingStock.puyuma.facts[0] | 傾斜角度比太魯閣的 5 度小，但機構更簡單可靠 | Its one-to-two-degree tilt is smaller than Taroko’s, but the mechanism is simpler and more reliable. | 傾斜角は太魯閣号より小さい1～2度ですが、機構が簡潔で信頼性に優れます。 | — | □ |
| 1423 | RAIL_I18N_CONTENT_DATA.branchLines.neiwan.section | 新竹—內灣 | Hsinchu–Neiwan | 新竹―内湾 | — | □ |
| 1424 | RAIL_I18N_CONTENT_DATA.branchLines.shenao.section | 瑞芳—八斗子 | Ruifang–Badouzi | 瑞芳―八斗子 | — | □ |
| 1425 | RAIL_I18N_CONTENT_DATA.branchLines.pingxi.story | 運煤鐵道轉生的人文支線：十分老街的房子緊貼鐵軌而建，火車擦身而過是經典畫面；元宵放天燈與鹽水蜂炮並稱「南蜂炮北天燈」。 | A former coal railway turned cultural branch line. Trains pass directly beside the houses of Shifen Old Street, while sky lanterns are the area’s best-known tradition. | 炭鉱鉄道から文化観光路線へ生まれ変わった支線です。十分老街の家々すれすれを列車が走り、天燈上げでも知られます。 | — | □ |
| 1426 | RAIL_I18N_CONTENT_DATA.namedTrains.steam.tags[0] | 蒸汽火車 | Steam train | 蒸気列車 | — | □ |
| 1427 | RAIL_I18N_CONTENT_DATA.namedTrains.mingri.name | 鳴日號（含鳴日廚房） | Future（including Future Dining） | 鳴日号（鳴日キッチンを含む） | — | □ |
| 1428 | RAIL_I18N_CONTENT_DATA.branchLines.neiwan.story | 戰後台灣第一條新建支線，從礦業線轉型客家文化觀光線。合興車站被封為「愛情火車站」，春末螢火蟲季與內灣老街客家美食是招牌。 | Taiwan’s first new railway branch after World War II evolved from an industrial line into a Hakka cultural route. Hexing “Love Station,” fireflies and Neiwan Old Street are its signatures. | 戦後台湾初の新設支線で、産業路線から客家文化の観光路線へ転身しました。「愛情駅」と呼ばれる合興、ホタル、内湾老街が見どころです。 | — | □ |
| 1429 | RAIL_I18N_CONTENT_DATA.rollingStock.chukuang.facts[0] | 機車頭牽引的動力集中式列車，加減速慢是被電聯車取代的主因 | Slow acceleration from locomotive-hauled operation is a major reason electric multiple units replaced it. | 機関車牽引で加減速が遅いことが、電車に置き換えられた主因です。 | — | □ |
| 1430 | RAIL_I18N_CONTENT_DATA.namedTrains.star.tags[1] | 親子 | Family friendly | ファミリー | — | □ |
| 1431 | RAIL_I18N_CONTENT_DATA.namedTrains.star.tags[2] | 環島 | Round Taiwan | 台湾一周 | — | □ |
| 1432 | RAIL_I18N_CONTENT_DATA.namedTrains.star.name | 環島之星 萌旅號 | Formosa Star Cute Express | 環島之星 萌旅号 | — | □ |
| 1433 | RAIL_I18N_CONTENT_DATA.namedTrains.blue-train.name | 藍皮解憂號 | Breezy Blue | 藍皮解憂号 | — | □ |
| 1434 | RAIL_I18N_CONTENT_DATA.namedTrains.bike.story | 讓單車騎士連人帶車上火車的服務，「鐵馬＋鐵路」串起環島騎行的斷點。依車廂設計有 8 車到 30 車不等的容量，EMU900 區間車還有直立式車架可隨到隨上。 | A service that lets cyclists bring bicycles aboard to bridge gaps in a round-island ride. Capacity varies by train, while EMU900 local trains include upright bicycle racks. | 自転車をそのまま列車に載せ、台湾一周サイクリングの区間をつなぐサービスです。列車ごとに積載数が異なり、EMU900区間車には縦置きラックもあります。 | — | □ |
| 1435 | RAIL_I18N_CONTENT_DATA.namedTrains.blue-train.tags[0] | 觀光列車 | Tourist train | 観光列車 | — | □ |
| 1436 | RAIL_I18N_CONTENT_DATA.namedTrains.haifeng.tags[0] | 觀光列車 | Tourist train | 観光列車 | — | □ |
| 1437 | RAIL_I18N_CONTENT_DATA.namedTrains.shanlan.tags[0] | 觀光列車 | Tourist train | 観光列車 | — | □ |
| 1438 | RAIL_I18N_CONTENT_DATA.namedTrains.mingri.tags[0] | 觀光列車 | Tourist train | 観光列車 | — | □ |
| 1439 | RAIL_I18N_CONTENT_DATA.namedTrains.star.tags[0] | 觀光列車 | Tourist train | 観光列車 | — | □ |
| 1440 | RAIL_I18N_CONTENT_DATA.rollingStock.dr3100.name | DR3100 柴聯自強號 | DR3100 diesel Tze-Chiang | DR3100 ディーゼル自強号 | — | □ |
| 1441 | RAIL_I18N_CONTENT_DATA.rollingStock.emu3000.name | EMU3000 新自強號 | EMU3000 Tze-Chiang Limited Express | EMU3000 新自強号 | — | □ |
| 1442 | RAIL_I18N_CONTENT_DATA.rollingStock.local.facts[1] | EMU900 一列 10 輛可載近 1,800 人，是台鐵編組最長的通勤車 | A ten-car EMU900 can carry nearly 1,800 passengers, TRA’s longest commuter formation. | EMU900は10両で約1,800人を運べる、台湾鉄路最長の通勤編成です。 | — | □ |
| 1443 | RAIL_I18N_CONTENT_DATA.rollingStock.taroko.name | TEMU1000 太魯閣號 | TEMU1000 Taroko Express | TEMU1000 太魯閣号 | — | □ |
| 1444 | RAIL_I18N_CONTENT_DATA.rollingStock.puyuma.name | TEMU2000 普悠瑪號 | TEMU2000 Puyuma Express | TEMU2000 普悠瑪号 | — | □ |

## 隱私權政策與服務條款（161 筆）

| # | 來源 | 繁中原文 | English | 日本語 | 自動提示 | 複核 |
|---:|---|---|---|---|---|:---:|
| 1445 | i18n/legal-translations.js | ，以及這趟行程的路線資訊（系統、路線、車次、方向、乘車日期）與一組用來認列貢獻的隨機裝置識別碼——那組識別碼由 App 在你的裝置上隨機產生，與手機的硬體識別碼、Apple ID 或任何帳號無關。軌島伺服器不接受夾帶座標的資料——收到含經緯度欄位的內容會直接拒絕。 | , together with journey route information (system, route, train number, direction and travel date) and a random device identifier used to attribute contributions. The app generates that identifier randomly on your device; it is unrelated to hardware identifiers, Apple ID or any account. Rail Island servers do not accept coordinates and reject payloads containing latitude or longitude fields. | 、旅程の路線情報（交通機関、路線、列車番号、方向、乗車日）、貢献を記録するためのランダムな端末識別子です。この識別子はアプリが端末上でランダム生成し、端末のハードウェアID、Apple ID、いかなるアカウントとも無関係です。軌島サーバーは座標を含むデータを受け付けず、緯度・経度フィールドがあれば拒否します。 | — | □ |
| 1446 | i18n/legal-translations.js | ，用來列出你附近的車站與經過的列車。 | , used to list nearby stations and passing trains. | し、近くの駅と通過列車を表示します。 | — | □ |
| 1447 | i18n/legal-translations.js | ，用來把地圖直接落在你附近，不必等你操作。若你是從分享連結開啟，或已自行設定「預設啟動地點」，則不會啟動這次定位。你可以拒絕權限，拒絕後 App 一切功能照常，地圖改用上次的檢視位置。 | , used to open the map near you without waiting for input. This does not run when opening a shared link or when you have set a default start place. You may deny permission; all app features still work and the map uses your previous view. | し、操作を待たず近くの地図を表示します。共有リンクから開いた場合や既定の開始地点を設定している場合は実行しません。許可を拒否しても全機能を利用でき、地図は前回の表示位置を使います。 | — | □ |
| 1448 | i18n/legal-translations.js | ，用來更新地圖上的藍點與所在地鏡頭，讓你移動時地圖不會停在舊位置。若你是從分享連結開啟，或已自行設定「預設啟動地點」，App 不會自動啟動定位；你之後按「附近車站」才會開始。你手動拖曳地圖，或改為跟隨列車、隨機巡航、放空模式時，所在地鏡頭會讓出控制，但藍點仍持續更新；再按「附近車站」即可回到目前位置。App 進入背景或裝置鎖屏時會立即停止，回到前景後才重新開始，不會要求「永遠允許」或在背景持續定位。 | , used to update the blue dot and location camera so the map follows your movement instead of remaining at an old position. If you open the app from a shared link or have set a default start location, location does not start automatically; it begins only after you select Nearby stations. Dragging the map or switching to train following, random touring or ambient mode releases camera control, while the blue dot keeps updating. Select Nearby stations again to return to your current position. Location stops immediately when the app enters the background or the device locks, and resumes only in the foreground. Rail Island never asks for Always permission or continues location in the background. | 。地図上の青い点と現在地カメラを更新し、移動中に地図が以前の位置に残らないようにします。共有リンクから開いた場合、または「起動時の既定位置」を設定している場合は自動で位置取得を開始せず、後で「近くの駅」を押した時に開始します。地図を手で動かす、列車追跡、ランダム巡回、放置鑑賞モードへ切り替えると、現在地カメラは操作を譲りますが青い点は更新を続けます。「近くの駅」をもう一度押すと現在地へ戻ります。アプリがバックグラウンドへ移るか端末がロックされると直ちに停止し、前面へ戻った時だけ再開します。「常に許可」を求めたり、バックグラウンドで位置取得を続けたりしません。 | — | □ |
| 1449 | i18n/legal-translations.js | ，用來校正軌島對列車位置的推估。這件事完全由你發動：不接旅程就不會取樣，錄製途中畫面上有常駐的紅色狀態列，隨時可以停止；只在 App 於前景使用時取樣，不會在背景或鎖屏時繼續。（目前版本尚未開放校正旅程功能。） | , used to calibrate Rail Island’s train-position estimates. This is entirely user-initiated: no samples are taken unless you accept a journey; a persistent red status bar appears during recording and you can stop at any time. Sampling occurs only while the app is in the foreground, not in the background or on the Lock Screen. Calibration Journey is not available in the current version. | 。軌島の列車位置推定を補正するために使用します。利用者が開始した場合だけ動作し、旅程を引き受けなければ取得しません。記録中は常時表示される赤い状態バーからいつでも停止できます。アプリが前面にある時だけ取得し、バックグラウンドやロック画面では継続しません。現在のバージョンでは補正旅程を提供していません。 | — | □ |
| 1450 | i18n/legal-translations.js | ，軌島會以最新的前景定位列出附近車站與經過的列車，並重新啟用所在地鏡頭。若當時還沒有可用位置，才會再次嘗試取得定位。 | , Rail Island uses the latest foreground location to list nearby stations and passing trains, and re-enables the location camera. It attempts another location reading only if no usable position is available. | 、軌島は最新の前景位置情報から近くの駅と通過列車を表示し、現在地カメラを再び有効にします。利用可能な位置がない場合だけ、位置取得を再試行します。 | — | □ |
| 1451 | i18n/legal-translations.js | 「軌島 Rail Island」（以下稱「軌島」）由獨立開發者許翔（Hsu Hsiang）提供。本政策說明軌島網站及 iOS／Android App 如何處理使用者資料。 | Rail Island is provided by independent developer Hsu Hsiang. This policy explains how the Rail Island website and iOS/Android apps handle user data. | 「軌島 Rail Island」（以下「軌島」）は個人開発者Hsu Hsiangが提供しています。本ポリシーは、軌島のWebサイトおよびiOS／Androidアプリにおける利用者データの取扱いを説明します。 | — | □ |
| 1452 | i18n/legal-translations.js | 1. 服務性質 | 1. Nature of the service | 1. サービスの性質 | — | □ |
| 1453 | i18n/legal-translations.js | 1. 帳號資料 | 1.1 Account data | 1.1 アカウントデータ | — | □ |
| 1454 | i18n/legal-translations.js | 10. 聯絡方式 | 10. Contact | 10. 連絡先 | — | □ |
| 1455 | i18n/legal-translations.js | 2. 你主動保存或匯入的內容 | 1.2 Content you save or import | 1.2 保存・読み込みした内容 | — | □ |
| 1456 | i18n/legal-translations.js | 2. 帳號 | 2. Accounts | 2. アカウント | — | □ |
| 1457 | i18n/legal-translations.js | 3. 定位資料 | 1.3 Location data | 1.3 位置情報 | — | □ |
| 1458 | i18n/legal-translations.js | 3. 軌島 Plus 訂閱 | 3. Rail Island Plus subscription | 3. 軌島 Plusサブスクリプション | — | □ |
| 1459 | i18n/legal-translations.js | 3. 軌島通行證 | 3. Rail Island Pass | 3. 軌島パス | — | □ |
| 1460 | i18n/legal-translations.js | 4. 使用者資料與匯入內容 | 4. User data and imported content | 4. 利用者データと読み込み内容 | — | □ |
| 1461 | i18n/legal-translations.js | 4. 購買與 Plus 資格 | 1.4 Purchases and Plus entitlement | 1.4 購入とPlus資格 | — | □ |
| 1462 | i18n/legal-translations.js | 4. 購買與通行證資格 | 1.4 Purchases and pass eligibility | 1.4 購入とパス資格 | — | □ |
| 1463 | i18n/legal-translations.js | 5. 分享與錄影 | 5. Sharing and recording | 5. 共有と録画 | — | □ |
| 1464 | i18n/legal-translations.js | 5. 錄影、音樂與分享 | 1.5 Recording, music and sharing | 1.5 録画・音楽・共有 | — | □ |
| 1465 | i18n/legal-translations.js | 6. 第三方資料與服務 | 6. Third-party data and services | 6. 第三者データとサービス | — | □ |
| 1466 | i18n/legal-translations.js | 6. 網路與安全紀錄 | 1.6 Network and security logs | 1.6 通信・セキュリティ記録 | — | □ |
| 1467 | i18n/legal-translations.js | 7. 使用量測量 | 1.7 Aggregate usage measurement | 1.7 集計利用量 | — | □ |
| 1468 | i18n/legal-translations.js | 7. 禁止行為 | 7. Prohibited conduct | 7. 禁止行為 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1469 | i18n/legal-translations.js | 8. 服務變更與責任限制 | 8. Service changes and limitation of liability | 8. サービス変更と責任制限 | — | □ |
| 1470 | i18n/legal-translations.js | 9. 條款變更 | 9. Changes to these terms | 9. 規約の変更 | — | □ |
| 1471 | i18n/legal-translations.js | 一、軌島處理哪些資料 | 1. Data Rail Island processes | 1. 軌島が取り扱うデータ | — | □ |
| 1472 | i18n/legal-translations.js | 一般開啟 App 並在前景使用時持續取得位置 | Continuous location while the app is open and in the foreground | 通常のアプリ起動後、前面で使用している間の継続的な位置取得 | — | □ |
| 1473 | i18n/legal-translations.js | 七、政策變更 | 7. Policy changes | 7. ポリシーの変更 | — | □ |
| 1474 | i18n/legal-translations.js | 二、資料用途 | 2. Uses of data | 2. データの利用目的 | — | □ |
| 1475 | i18n/legal-translations.js | 八、聯絡方式 | 8. Contact | 8. 連絡先 | — | □ |
| 1476 | i18n/legal-translations.js | 三、服務供應商 | 3. Service providers | 3. サービス提供者 | — | □ |
| 1477 | i18n/legal-translations.js | 五、資料安全 | 5. Data security | 5. データの安全性 | — | □ |
| 1478 | i18n/legal-translations.js | 內政部「直轄市、縣市界線」開放資料：App 內建的離線海陸輪廓資料，不接收使用者資料。 | Ministry of the Interior municipal and county boundary open data: offline land/sea outlines bundled in the app; it does not receive user data. | 内政部の自治体境界オープンデータ：アプリ内蔵のオフライン海陸輪郭。利用者データは受け取りません。 | — | □ |
| 1479 | i18n/legal-translations.js | 六、兒童隱私 | 6. Children’s privacy | 6. 子どものプライバシー | — | □ |
| 1480 | i18n/legal-translations.js | 月票與年票都會在到期前依商店規則自動續訂扣款，直到你取消為止。取消方式：App Store 的訂閱管理；取消後通行證功能至少可使用到當期已付費的週期結束，因系統資格確認的技術限制，實際停用時間可能再晚最多一天——這段技術緩衝不是延長使用權益，不能另行主張。軌島可能調整訂閱價格；依商店規則，價格調整前已訂閱的使用者通常在維持訂閱有效期間不受影響，實際處理方式以當時 Apple App Store 的官方規則為準。 | Monthly and annual passes renew and charge automatically before expiry under store rules until cancelled. Cancel through App Store subscription management. Pass features remain available at least through the end of the paid period; due to technical eligibility checks, deactivation may occur up to one day later. This technical grace period does not extend your contractual benefit period. Rail Island may change subscription prices; existing subscribers are generally unaffected while maintaining an active subscription, subject to the Apple App Store rules in effect at the time. | 月間・年間パスは解約までストア規則に従って期限前に自動更新・課金されます。App Storeのサブスクリプション管理から解約できます。解約後も少なくとも支払済み期間の終了まで利用でき、資格確認の技術的制約により停止が最大1日遅れる場合があります。この技術的猶予は利用権の延長ではありません。価格を変更する場合があり、既存加入者の扱いはその時点のApple App Store規則に従います。 | — | □ |
| 1481 | i18n/legal-translations.js | 以彙總數字估算整體使用量、規劃底圖與流量成本； | Estimating aggregate usage and planning map/traffic costs; | 集計値による利用量・地図・通信費の計画； | — | □ |
| 1482 | i18n/legal-translations.js | 四、保存與刪除 | 4. Retention and deletion | 4. 保存と削除 | — | □ |
| 1483 | i18n/legal-translations.js | 未登入時的收藏與偏好保存在你的瀏覽器或裝置，直到你清除網站資料或移除 App。 | Signed-out favorites and preferences stay in your browser or device until you clear site data or remove the app. | ログインしていないお気に入りと設定は、サイトデータを消去またはアプリを削除するまでブラウザ／端末に保存されます。 | — | □ |
| 1484 | i18n/legal-translations.js | 本條款適用於「軌島 Rail Island」網站及 iOS／Android App。使用軌島即表示你同意本條款；若不同意，請停止使用。 | These terms apply to the Rail Island website and iOS/Android apps. By using Rail Island, you agree to these terms. If you disagree, stop using the service. | 本規約は軌島のWebサイトおよびiOS／Androidアプリに適用されます。軌島を利用することで本規約に同意したものとみなします。同意しない場合は利用を中止してください。 | — | □ |
| 1485 | i18n/legal-translations.js | 生效日期：2026 年 7 月 21 日 | Effective July 21, 2026 | 施行日：2026年7月21日 | — | □ |
| 1486 | i18n/legal-translations.js | 生效日期：2026 年 7 月 26 日（前版：2026 年 7 月 16 日） | Effective July 26, 2026 (previous version: July 16, 2026) | 施行日：2026年7月26日（前版：2026年7月16日） | — | □ |
| 1487 | i18n/legal-translations.js | 生效日期：2026 年 8 月 26 日（前版：2026 年 8 月 6 日） | Effective August 26, 2026 (previous version: August 6, 2026) | 施行日：2026年8月26日（前版：2026年8月6日） | — | □ |
| 1488 | i18n/legal-translations.js | 生效日期：2026 年 8 月 5 日（前版：2026 年 8 月 4 日） | Effective August 5, 2026 (previous version: August 4, 2026) | 施行日：2026年8月5日（前版：2026年8月4日） | — | □ |
| 1489 | i18n/legal-translations.js | 由瀏覽器 User-Agent 判定的「行動裝置或桌面」分類。 | Mobile or desktop classification inferred from the browser user agent. | ブラウザのUser-Agentから判定したモバイル／デスクトップ分類。 | — | □ |
| 1490 | i18n/legal-translations.js | 目前的地圖縮放層級； | Current map zoom level; | 現在のズームレベル； | — | □ |
| 1491 | i18n/legal-translations.js | 目前的地圖鏡頭模式（跟車、放空、劇場或一般瀏覽）； | Current camera mode (follow, ambient, theater or ordinary browsing); | 現在のカメラモード（追跡、環境、シアター、通常表示）； | — | □ |
| 1492 | i18n/legal-translations.js | 在 App 中，軌島會在以下兩種情形取得裝置位置，兩者都需要你授予系統定位權限： | In the app, Rail Island obtains device location in the following two situations, both requiring system location permission: | アプリでは、システムの位置情報許可を得たうえで、次の2つの場合に端末の位置を取得します： | — | □ |
| 1493 | i18n/legal-translations.js | 在 App 中，軌島會在以下情形取得裝置位置，皆需要你授予系統定位權限： | In the app, Rail Island obtains device location in the following situations, each requiring system location permission: | アプリでは次の場合に端末の位置情報を取得し、いずれもシステムの位置情報権限が必要です： | — | □ |
| 1494 | i18n/legal-translations.js | 位置只在你的裝置內使用：軌島不會把座標傳送到軌島伺服器，也不會存進帳號或跨裝置同步。為了讓下次開啟 App 時地圖能立刻落在正確位置，軌島會把最近一次取得的座標保存在裝置本機儲存空間，最長 30 天，逾期自動不再使用；移除 App 或清除網站資料即一併清除。 | Location is used only on your device. Rail Island does not send coordinates to its servers, save them to your account or sync them across devices. To place the map correctly the next time the app opens, the most recent coordinates are stored locally for up to 30 days and then expire. Removing the app or clearing site data removes them. | 位置情報は端末内だけで利用します。座標を軌島サーバーへ送信せず、アカウントへの保存や端末間同期もしません。次回起動時に地図をすぐ表示するため、最後の座標を端末内に最長30日間保存し、その後は自動的に利用を停止します。アプリの削除またはサイトデータの消去でも削除されます。 | — | □ |
| 1495 | i18n/legal-translations.js | 你不得利用軌島從事違法、侵權、詐欺、干擾服務、繞過購買驗證、未授權存取他人帳號或大量自動化請求等行為。 | Do not use Rail Island for unlawful, infringing or fraudulent activity; service interference; bypassing purchase verification; unauthorized account access; or excessive automated requests. | 違法、権利侵害、詐欺、サービス妨害、購入確認の回避、他人のアカウントへの不正アクセス、大量の自動要求などに利用してはなりません。 | — | □ |
| 1496 | i18n/legal-translations.js | 你可不登入使用核心地圖功能。登入本身免費；最愛地點、最愛列車、最愛車站與完乘紀錄的跨裝置同步屬軌島通行證功能。只有在通行證有效且登入時，這四類資料的新變更才會寫入雲端；沒有有效通行證資格時，新變更會先留在目前裝置。若你先前曾同步，停止訂閱或因到期、退款等原因失去通行證資格後，既有雲端副本不會自動刪除，會保留至你刪除軌島帳號；再次取得有效資格後可繼續同步。你應維護 Google 或 Apple 登入帳號的安全，不得冒用他人身分或干擾服務。 | You can use the core map without signing in, and sign-in itself is free. Cross-device sync for favorite places, favorite trains, favorite stations and completion records is a Rail Island Pass feature. New changes to these four categories are written to the cloud only while signed in with a valid pass; otherwise they remain on the current device. A cloud copy previously synced while eligible is not automatically deleted if you cancel or lose eligibility through expiry, refund or another reason. It remains until you delete your account and can resume syncing if eligibility returns. Keep your Google or Apple account secure; do not impersonate others or interfere with the service. | 基本地図機能はログインせず利用でき、ログイン自体は無料です。お気に入り場所、列車、駅、完乗記録の端末間同期は軌島パス機能です。新しい変更は有効なパスでログイン中だけクラウドへ書き込み、資格がない場合は現在の端末に保存します。有効期間中に同期したクラウド上のコピーは、解約、期限切れ、返金などで資格を失っても自動削除されず、アカウント削除まで保持されます。資格を再取得すると同期を再開できます。GoogleまたはAppleアカウントを安全に管理し、なりすましやサービス妨害をしないでください。 | — | □ |
| 1497 | i18n/legal-translations.js | 你可不登入使用核心地圖功能。登入後可同步最愛地點、最愛列車與完乘紀錄。你應維護 Google 或 Apple 登入帳號的安全，不得冒用他人身分或干擾服務。 | You can use the core map without signing in. After sign-in, you can sync favorite places, favorite trains and completion records. Keep your Google or Apple account secure; do not impersonate others or interfere with the service. | ログインせずに基本地図機能を利用できます。ログイン後はお気に入り場所、列車、完乗記録を同期できます。GoogleまたはAppleアカウントを安全に管理し、なりすましやサービス妨害をしないでください。 | — | □ |
| 1498 | i18n/legal-translations.js | 你可在 App 或網站的「軌島帳號」面板刪除帳號。即使已移除 App，也可前往： | You can delete your account in the Rail Island account panel in the app or website. After removing the app, you can still visit: | アプリまたはWebの軌島アカウントパネルから削除できます。アプリ削除後も次のページを利用できます： | — | □ |
| 1499 | i18n/legal-translations.js | 你可隨時在軌島帳號面板刪除帳號；刪除後無法復原同步資料。詳細處理方式如下： | You may delete your account from the Rail Island account panel at any time. Synced data cannot be recovered afterward. See: | 軌島アカウントパネルからいつでも削除できます。削除後は同期データを復元できません。詳細： | — | □ |
| 1500 | i18n/legal-translations.js | 你在目前裝置新增或修改的最愛地點、最愛列車、最愛車站與完乘紀錄，會先保存在該裝置；清除網站資料或移除 App 會刪除這些本機資料。 | Favorite places, favorite trains, favorite stations and completion records added or changed on the current device are first stored there. Clearing site data or removing the app deletes this local data. | 現在の端末で追加・変更したお気に入り場所、列車、駅、完乗記録はまずその端末に保存します。サイトデータの消去またはアプリ削除でローカルデータは削除されます。 | — | □ |
| 1501 | i18n/legal-translations.js | 你使用「附近車站」時 | When you use Nearby stations | 「近くの駅」を使用した時 | — | □ |
| 1502 | i18n/legal-translations.js | 你使用「附近車站」時取得較高精度位置 | A higher-accuracy reading when you use Nearby Stations | 「近くの駅」を使うときに高精度で取得 | — | □ |
| 1503 | i18n/legal-translations.js | 你應只匯入自己有權使用的 Google Takeout 清單或其他資料。原始 Takeout 檔案在裝置內解析；你確認匯入的地點只有在通行證有效且登入時，才會依帳號設定同步。你應自行保留重要資料備份。 | Import only Google Takeout lists or other data that you have the right to use. Original Takeout files are parsed on-device; confirmed places sync according to account settings only while signed in with a valid pass. Keep your own backup of important data. | 利用権限のあるGoogle Takeoutリストその他のデータだけを読み込んでください。元ファイルは端末内で解析し、確定した場所は有効なパスでログイン中だけアカウント設定に従って同期します。重要データは自身でバックアップしてください。 | — | □ |
| 1504 | i18n/legal-translations.js | 你應只匯入自己有權使用的 Google Takeout 清單或其他資料。原始 Takeout 檔案在裝置內解析；你確認匯入的地點可能依帳號設定同步。你應自行保留重要資料備份。 | Import only Google Takeout lists or other data that you have the right to use. Original Takeout files are parsed on-device; confirmed places may sync according to account settings. Keep your own backup of important data. | 利用権限のあるGoogle Takeoutリストその他のデータだけを読み込んでください。元ファイルは端末内で解析し、確定した場所はアカウント設定に応じて同期される場合があります。重要データは自身でバックアップしてください。 | — | □ |
| 1505 | i18n/legal-translations.js | 刪除軌島帳號不會自動取消進行中的訂閱，也不會自動產生退款；如需停止扣款，請先在 App Store 的訂閱設定取消訂閱。 | Deleting a Rail Island account does not cancel an active subscription or create a refund. To stop charges, first cancel in App Store subscription settings. | 軌島アカウントを削除しても継続中のサブスクリプションは自動解約されず、返金も発生しません。課金を止めるには先にApp Storeのサブスクリプション設定で解約してください。 | — | □ |
| 1506 | i18n/legal-translations.js | 刪除帳號會刪除 Firebase 帳號、三類同步資料及同一使用者識別碼的 RevenueCat customer profile，並清除目前裝置內的私人收藏。 | Account deletion removes the Firebase account, the three categories of synced data, the RevenueCat customer profile under the same user ID, and private favorites on the current device. | アカウント削除により、Firebaseアカウント、3種類の同期データ、同じユーザーIDのRevenueCat顧客プロフィール、現在の端末内の非公開お気に入りを削除します。 | — | □ |
| 1507 | i18n/legal-translations.js | 刪除帳號會刪除 Firebase 帳號、四類同步資料、你的通行證資格紀錄、同一使用者識別碼的 RevenueCat customer profile，以及該帳號與目前這台裝置在軌島伺服器上的校正旅程資料（含累積的貢獻點數），並清除目前裝置內的私人收藏。 | Deleting your account deletes the Firebase account, four synced data categories, pass-eligibility record, RevenueCat customer profile for the same user ID, and Calibration Journey data on Rail Island servers associated with that account and the current device, including accumulated contribution points. It also clears private collections on the current device. | アカウント削除により、Firebaseアカウント、4種類の同期データ、パス資格記録、同じユーザーIDのRevenueCat顧客プロフィール、そのアカウントと現在の端末に関連する軌島サーバー上の補正旅程データ（累積貢献ポイントを含む）を削除し、現在の端末内の非公開コレクションを消去します。 | — | □ |
| 1508 | i18n/legal-translations.js | 完乘日期、車次、路線與相關旅程紀錄。 | Completion dates, train numbers, routes and related trip records. | 完乗日、列車番号、路線および関連する乗車記録。 | — | □ |
| 1509 | i18n/legal-translations.js | 沒有有效通行證資格時，這四類資料的新變更不會寫入雲端，會先保存在目前裝置。若你曾在資格有效期間同步，停止訂閱或因到期、退款等原因失去通行證資格後，先前的雲端副本不會自動刪除，會保留到你刪除軌島帳號；再次取得有效資格後可繼續同步。 | Without a valid pass, new changes to these four data categories are not written to the cloud and remain on the current device. If you previously synced while eligible, the cloud copy is not deleted when you cancel or lose eligibility through expiry, refund or another reason. It remains until you delete your Rail Island account and can resume syncing if you later regain eligibility. | 有効なパスがない場合、この4種類の新しい変更はクラウドへ書き込まず、現在の端末に保存します。有効期間中に同期したクラウド上のコピーは、解約、期限切れ、返金などで資格を失っても自動削除されず、軌島アカウントを削除するまで保持されます。資格を再取得すると同期を再開できます。 | — | □ |
| 1510 | i18n/legal-translations.js | 系統定位直接取得的原始座標不會離開你的裝置；你主動保存或匯入為最愛地點的座標，則依前節在通行證有效且登入後同步到 Firebase。前兩種定位情形的位置只在裝置內使用；校正旅程則是在裝置上先把座標投影成「這條路線上的第幾公里」，只有以下換算後的數值會上傳到軌島伺服器： | Raw coordinates obtained directly from system location do not leave your device. Coordinates you explicitly save or import as favorite places sync to Firebase while signed in with a valid pass as described above. Location from the first two cases is used only on-device. For Calibration Journey, the device first projects coordinates into distance along the route; only the converted values below are uploaded to Rail Island servers: | システム位置情報から直接得た生の座標は端末外へ送信しません。利用者が保存またはお気に入りとして読み込んだ座標は、前節のとおり有効なパスでログイン後にFirebaseへ同期します。最初の2つの位置取得は端末内だけで使用します。補正旅程では端末上で座標を路線上の距離に変換し、次の変換後データだけを軌島サーバーへ送信します： | — | □ |
| 1511 | i18n/legal-translations.js | 使用量測量紀錄（見一之 7）以不含識別資訊的形式保存在 Cloudflare Analytics Engine，依其服務設定到期後自動刪除；因為不含識別資訊，無法對應到特定使用者，也就無法個別刪除。 | Aggregate usage records described in section 1.7 are stored without identifying information in Cloudflare Analytics Engine and automatically expire under its service settings. Because they cannot be linked to an individual, they cannot be deleted per user. | 1.7の利用量記録は識別情報を含まない形でCloudflare Analytics Engineに保存され、設定に従って期限切れ後に自動削除されます。個人に対応付けられないため、個別削除はできません。 | — | □ |
| 1512 | i18n/legal-translations.js | 定位功能只存在於 iOS／Android App；軌島網站版不會要求，也無法取得你的位置。 | Location features are available only in the iOS/Android apps. The Rail Island website does not request and cannot obtain your location. | 位置情報機能はiOS／Androidアプリにのみあります。Web版は位置情報を要求せず、取得できません。 | — | □ |
| 1513 | i18n/legal-translations.js | 服務條款 | Terms of Service | 利用規約 | — | □ |
| 1514 | i18n/legal-translations.js | 沿線里程、當日時間、速度、定位精度 | distance along the route, time of day, speed and location accuracy | 路線上の距離、時刻、速度、位置精度 | — | □ |
| 1515 | i18n/legal-translations.js | 返回軌島 | Return to Rail Island | 軌島に戻る | — | □ |
| 1516 | i18n/legal-translations.js | 查看服務條款 | View Terms of Service | 利用規約を見る | — | □ |
| 1517 | i18n/legal-translations.js | 查看隱私權政策 | View Privacy Policy | プライバシーポリシーを見る | — | □ |
| 1518 | i18n/legal-translations.js | 為了讓下次開啟 App 時地圖能立刻落在正確位置，軌島會把最近一次取得的座標保存在裝置本機儲存空間。超過 30 天的座標，軌島會自動不再使用（但不會主動刪除舊值，它會留在本機儲存空間，直到被下一次定位覆蓋，或你移除 App、清除網站資料）。 | To place the map correctly as soon as the app next opens, Rail Island stores the most recently obtained coordinates locally. Coordinates older than 30 days are no longer used automatically, but the old value is not proactively deleted; it remains in local storage until overwritten by a later location, the app is removed, or site data is cleared. | 次回のアプリ起動時に地図をすぐ適切な場所へ表示するため、直近の座標を端末内に保存します。30日を超えた座標は自動的に使用しませんが、古い値は積極的には削除せず、次の位置情報で上書きされるか、アプリ削除またはサイトデータ消去まで端末内に残ります。 | — | □ |
| 1519 | i18n/legal-translations.js | 為提供上述功能，資料可能由下列服務供應商依其各自政策處理： | The following providers may process data under their own policies to deliver these features: | 機能提供のため、次の事業者が各社のポリシーに従って処理する場合があります： | — | □ |
| 1520 | i18n/legal-translations.js | 若本條款有重大變更，軌島會更新生效日期，並在適當情況下於網站或 App 提示。 | If these terms change materially, Rail Island will update the effective date and, where appropriate, provide notice on the website or in the app. | 本規約に重大な変更がある場合、施行日を更新し、必要に応じてWebまたはアプリで通知します。 | — | □ |
| 1521 | i18n/legal-translations.js | 若地圖依目前位置移動到附近區域，底圖供應商仍會像一般地圖服務一樣收到所請求的圖磚區域、IP 位址與必要的網路資訊。你也可以不授予定位權限，改用手動落釘。 | When the map moves to your area, basemap providers receive the requested tile area, IP address and necessary network information as with ordinary map services. You can deny location permission and place a pin manually instead. | 現在地付近を地図に表示すると、一般の地図サービスと同様に、地図提供者は要求されたタイル範囲、IPアドレス、必要な通信情報を受け取ります。位置情報を許可せず、手動でピンを置くこともできます。 | — | □ |
| 1522 | i18n/legal-translations.js | 若你從未登入、只用匿名身分上傳過校正旅程：那些資料是以裝置上隨機產生的識別碼記錄的，軌島無從得知它屬於誰。要刪除的話，請在同一台裝置上登入後再刪除帳號——刪除流程會一併清掉這台裝置上傳的校正旅程資料。 | If you never signed in and uploaded Calibration Journey data anonymously, it is recorded under a randomly generated device identifier and Rail Island cannot know who it belongs to. To delete it, sign in on the same device and then delete the account; the deletion flow also removes Calibration Journey data uploaded by that device. | 一度もログインせず匿名で補正旅程を送信した場合、そのデータは端末でランダム生成した識別子で記録され、軌島は所有者を特定できません。削除するには同じ端末でログインしてからアカウントを削除してください。削除処理でその端末が送信した補正旅程も削除します。 | — | □ |
| 1523 | i18n/legal-translations.js | 若特定版本開放「校正旅程」功能，你主動接下一趟並開始錄製時，於乘車途中連續取得位置 | If a version enables Calibration Journey, continuous location readings during a ride after you explicitly accept a journey and start recording | 特定バージョンで「補正旅程」が提供され、利用者が旅程を引き受けて記録を開始した場合の乗車中の継続的な位置取得 | — | □ |
| 1524 | i18n/legal-translations.js | 若特定版本開放裝置內畫面錄影功能，錄影、背景音樂混音與輸出檔案會在裝置內產生；除非你主動使用系統分享功能選擇其他 App 或服務，軌島不會把影片上傳到軌島伺服器。（目前版本尚未開放畫面錄影功能。） | If a version enables on-device screen recording, recording, background-music mixing and exported files are produced on-device. Rail Island does not upload video to its servers unless you explicitly use the system share feature and select another app or service. Recording is not available in the current version. | 特定バージョンで端末内録画を提供する場合、録画、BGMのミックス、出力ファイルは端末内で生成します。利用者がシステム共有機能で別のアプリやサービスを選ばない限り、動画を軌島サーバーへアップロードしません。現在のバージョンでは録画機能を提供していません。 | — | □ |
| 1525 | i18n/legal-translations.js | 若資料處理方式有重大改變，軌島會更新本頁生效日期，並在適當情況下於網站或 App 提示。 | If data practices change materially, Rail Island will update the effective date and, where appropriate, provide notice on the website or in the app. | データ取扱いに重大な変更がある場合、施行日を更新し、必要に応じてWebまたはアプリで通知します。 | — | □ |
| 1526 | i18n/legal-translations.js | 訂閱會在到期前依商店規則自動續訂扣款，直到你取消為止。取消方式：App Store／Google Play 訂閱管理，或網站帳號的訂閱設定；取消後 Plus 功能會持續使用到當期已付費的週期結束為止。軌島可能調整訂閱價格；依各商店規則，價格調整前已訂閱的使用者通常在維持訂閱有效期間不受影響，實際處理方式以當時 Apple App Store／Google Play 的官方規則為準。 | The subscription renews and charges automatically before expiry under the store’s rules until you cancel. Cancel in App Store/Google Play subscription management or the website account subscription settings. Plus remains available through the end of the paid period. Rail Island may change prices; treatment of existing subscribers follows the applicable store rules at that time. | 解約するまで、ストアの規則に従い期限前に自動更新・課金されます。App Store／Google Playのサブスクリプション管理、またはWebアカウントの設定から解約できます。解約後も支払済み期間の終了までPlusを利用できます。価格を変更する場合があり、既存契約者の扱いはその時点の各ストア規則に従います。 | — | □ |
| 1527 | i18n/legal-translations.js | 軌島 · RAIL ISLAND | Rail Island · RAIL ISLAND | 軌島 · RAIL ISLAND | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1528 | i18n/legal-translations.js | 軌島 Plus 是自動續訂訂閱，提供月訂與年訂兩種週期，透過 Apple App Store、Google Play 或網站的 RevenueCat Web Billing 收費；三個平台的購買都對應同一個 | Rail Island Plus is an auto-renewing monthly or annual subscription sold through Apple App Store, Google Play or RevenueCat Web Billing on the website. Purchases on all three platforms use the same | 軌島 Plusは月間／年間の自動更新サブスクリプションで、Apple App Store、Google Play、WebのRevenueCat Web Billingを通じて販売します。3つの購入経路は同じ | — | □ |
| 1529 | i18n/legal-translations.js | 軌島 Rail Island 服務條款：適用於軌島網站及 iOS／Android App 的使用規範。 | Terms of Service for the Rail Island website and iOS/Android apps. | 軌島のWebサイトおよびiOS／Androidアプリに適用される利用規約です。 | — | □ |
| 1530 | i18n/legal-translations.js | 軌島 Rail Island 隱私權政策：說明軌島網站及 iOS／Android App 如何處理帳號、定位、購買與其他使用者資料。 | Rail Island Privacy Policy for the website and iOS/Android apps, including accounts, location, purchases and other user data. | 軌島のWebサイトおよびiOS／Androidアプリにおける、アカウント・位置情報・購入その他の利用者データの取扱いを説明します。 | — | □ |
| 1531 | i18n/legal-translations.js | 軌島不出售個人資料，也不使用你的收藏、定位或旅程紀錄投放個人化廣告。軌島不進行 Apple 定義的「追蹤」：不會把你的資料與第三方蒐集的資料串接，也不會提供給資料仲介。 | Rail Island does not sell personal data or use favorites, location or trip records for personalized advertising. It does not engage in tracking as defined by Apple: data is not linked with third-party data or provided to data brokers. | 個人データを販売せず、お気に入り、位置、乗車記録を個人向け広告に利用しません。Appleが定義する「トラッキング」は行わず、第三者データとの結合やデータ仲介業者への提供もしません。 | — | □ |
| 1532 | i18n/legal-translations.js | 軌島不是以兒童為主要對象，也不要求填寫年齡。若你認為兒童在未取得監護人同意下提供了個人資料，請使用下方聯絡方式提出刪除要求。 | Rail Island is not directed primarily to children and does not ask for age. If you believe a child provided personal data without guardian consent, use the contact below to request deletion. | 軌島は主に子どもを対象とせず、年齢入力を求めません。保護者の同意なく子どもが個人データを提供したと思われる場合は、下記連絡先から削除を依頼してください。 | — | □ |
| 1533 | i18n/legal-translations.js | 軌島以現況提供。開發者會合理維護資料與功能，但不保證完全正確、不中斷或適合特定用途。在法律允許的最大範圍內，開發者不對因依賴推演位置、營運資訊、第三方服務或使用者裝置狀況造成的間接損失負責。 | Rail Island is provided as is. The developer reasonably maintains data and features but does not guarantee complete accuracy, uninterrupted operation or fitness for a particular purpose. To the fullest extent permitted by law, the developer is not liable for indirect loss caused by reliance on simulated positions, operating information, third-party services or device conditions. | 軌島は現状有姿で提供されます。合理的にデータと機能を維持しますが、完全な正確性、無停止、特定目的への適合を保証しません。法令で認められる最大限の範囲で、推定位置、運行情報、第三者サービス、端末状況への依存による間接損害について責任を負いません。 | — | □ |
| 1534 | i18n/legal-translations.js | 軌島只在下列目的範圍處理資料： | Rail Island processes data only for these purposes: | 次の目的に限ってデータを処理します： | — | □ |
| 1535 | i18n/legal-translations.js | 軌島可讓你透過系統分享功能傳送目前畫面或跟車連結。若特定版本另外開放裝置內畫面錄影功能，你應依適用法律、平台規則及內容授權使用或分享輸出影片；軌島內建音樂與地圖標示的授權範圍，不代表第三方平台一定接受所有再次利用方式。（目前版本尚未開放畫面錄影功能。） | Rail Island can share the current view or a train-following link through the system share feature. If on-device recording is enabled in a version, use and share exports in accordance with applicable law, platform rules and content licenses. Licenses for built-in music and map labels do not guarantee every reuse is accepted by third-party platforms. Recording is not currently available. | システム共有機能で現在の画面や列車追跡リンクを送れます。端末内録画が提供される場合、適用法令、プラットフォーム規則、コンテンツライセンスに従って利用・共有してください。内蔵音楽や地図表示のライセンスが、第三者プラットフォームでのすべての再利用を保証するものではありません。現在、録画機能は提供していません。 | — | □ |
| 1536 | i18n/legal-translations.js | 軌島由獨立開發者許翔（Hsu Hsiang）維護。 | Rail Island is maintained by independent developer Hsu Hsiang. | 軌島は個人開発者Hsu Hsiangが運営しています。 | — | □ |
| 1537 | i18n/legal-translations.js | 軌島自行測量服務的整體使用量，用來估算底圖與資料流量成本、決定容量規劃。當網站或 App 向軌島的列車動態 API 取得資料時（約每分鐘一次），該次請求會附帶並記錄下列三項： | Rail Island measures aggregate service usage to estimate map/data traffic costs and plan capacity. When the website or app requests train updates (about once per minute), the request records these three items: | 地図・データ通信費の見積りと容量計画のため、サービス全体の利用量を測定します。Webまたはアプリが列車情報APIを取得する際（約1分ごと）、次の3項目を記録します： | — | □ |
| 1538 | i18n/legal-translations.js | 軌島使用交通開放資料、地圖、登入、雲端同步與付款服務。第三方服務可能變更、暫停或終止，軌島也可能因此調整功能。所有第三方商標與資料權利屬原權利人。 | Rail Island uses open transport data, maps, sign-in, cloud sync and payment services. Third-party services may change, pause or end, and Rail Island may adjust features as a result. Third-party trademarks and data rights belong to their owners. | 交通オープンデータ、地図、ログイン、クラウド同期、決済サービスを利用します。第三者サービスの変更・停止・終了に伴い機能を調整する場合があります。商標とデータの権利は各権利者に帰属します。 | — | □ |
| 1539 | i18n/legal-translations.js | 軌島服務條款｜Rail Island | Rail Island Terms of Service | 軌島利用規約｜Rail Island | — | □ |
| 1540 | i18n/legal-translations.js | 軌島的畫面錄影、背景音樂混音與輸出檔案在裝置內產生。除非你主動使用系統分享功能選擇其他 App 或服務，軌島不會把影片上傳到軌島伺服器。 | Screen recordings, background-music mixes and exported files are created on your device. Rail Island does not upload videos to its servers unless you actively use the system share feature and choose another app or service. | 画面録画、BGMのミックス、書き出しファイルは端末内で生成します。利用者が共有機能で別のアプリやサービスを選ばない限り、動画を軌島サーバーへアップロードしません。 | — | □ |
| 1541 | i18n/legal-translations.js | 軌島是依公開時刻表、即時資訊與地圖資料製作的鐵道動態視覺化工具。列車位置多為推演或估算，不是營運單位的行車控制、安全警示或官方旅運保證。實際乘車、平交道與營運決策應以交通營運單位及現場資訊為準。 | Rail Island is an animated railway visualization based on public timetables, live information and map data. Most train positions are simulated or estimated; they are not operational control, a safety warning or an official travel guarantee. Base travel, crossing and operating decisions on transport operators and on-site information. | 軌島は公開時刻表、リアルタイム情報、地図データに基づく鉄道可視化ツールです。列車位置の多くはシミュレーションまたは推定であり、事業者の運行管理、安全警告、公式な旅客案内の保証ではありません。乗車、踏切、運行に関する判断は交通事業者と現地情報に従ってください。 | — | □ |
| 1542 | i18n/legal-translations.js | 軌島透過 HTTPS 傳輸資料；同步資料的存取控制只允許本人讀取或刪除自己的資料，新增或更新雲端資料還需要有效的通行證資格。RevenueCat secret API key 僅存在伺服器環境，刪除購買資料前會驗證 Firebase ID token。任何網路服務都無法保證絕對安全，但軌島會採取與個人專案規模及資料性質相稱的合理保護措施。 | Rail Island transmits data over HTTPS. Access controls allow users only to read or delete their own synced data, and adding or updating cloud data also requires valid pass eligibility. The RevenueCat secret API key exists only in the server environment, and Firebase ID tokens are verified before purchase data is deleted. No network service can guarantee absolute security, but Rail Island uses reasonable safeguards proportionate to this personal project and the nature of the data. | 軌島はHTTPSでデータを送信します。同期データのアクセス制御は本人による自分のデータの読取・削除だけを許可し、クラウドへの追加・更新には有効なパス資格も必要です。RevenueCatのsecret API keyはサーバー環境だけに置き、購入データ削除前にFirebase ID tokenを検証します。絶対的な安全性は保証できませんが、個人プロジェクトの規模とデータの性質に応じた合理的な保護を行います。 | — | □ |
| 1543 | i18n/legal-translations.js | 軌島透過 HTTPS 傳輸資料；Firestore 規則只允許登入者讀寫本人資料。RevenueCat secret API key 僅存在伺服器環境，刪除購買資料前會驗證 Firebase ID token。任何網路服務都無法保證絕對安全，但軌島會採取與個人專案規模及資料性質相稱的合理保護措施。 | Rail Island transmits data over HTTPS. Firestore rules allow signed-in users to access only their own data. RevenueCat secret API keys exist only in the server environment, and a Firebase ID token is verified before purchase data is deleted. No online service can guarantee absolute security, but Rail Island uses reasonable safeguards appropriate to the project and data. | データはHTTPSで送信し、Firestore規則はログイン利用者本人のデータだけを読み書き可能にします。RevenueCatのsecret API keyはサーバー環境だけに置き、購入データ削除前にFirebase ID tokenを検証します。絶対的な安全性は保証できませんが、個人プロジェクトの規模とデータに応じた合理的な保護を行います。 | — | □ |
| 1544 | i18n/legal-translations.js | 軌島通行證是 App 數位功能的自動續訂訂閱，不是實際乘車票券。通行證提供「軌島通行證月票（月訂方案）」與「軌島通行證年票（年訂方案）」兩種週期，目前僅透過 Apple App Store 收費。完成訂閱後，可使用當時列明的通行證功能，例如：台鐵列車的誤點履歷（回溯 90 天的逐日紀錄）、收藏與完乘紀錄跨裝置雲端同步、行程分享、在 App 匯入 Google Maps 已儲存清單成為最愛地點、App 非跟車時的衛星高解析圖磚，以及 iOS 17.6 以上可用的跟車鎖定畫面與動態島即時動態；創始期間訂閱的島民，App 旅程護照另有創始島民徽章。 | Rail Island Pass is an auto-renewing subscription to digital app features, not a real travel ticket. It is offered as a monthly pass and an annual pass, currently charged only through Apple App Store. Features listed at the time may include 90 days of daily TRA train delay history, cross-device sync for collections and completed journeys, trip sharing, importing Google Maps saved lists in the app as favorite places, high-resolution satellite tiles in the app when not following a train, and Lock Screen/Dynamic Island live status while following on iOS 17.6 or later. People who subscribe during the founding period also receive a Founding Islander badge in the app Journey Passport. | 軌島パスはアプリのデジタル機能の自動更新サブスクリプションで、実際の乗車券ではありません。月間パスと年間パスを提供し、現在はApple App Storeだけで課金します。購入後は、その時点で記載された機能、たとえば台湾鉄路の過去90日の日別遅延履歴、コレクションと完乗記録の端末間同期、旅程共有、Googleマップ保存済みリストのお気に入り場所への読み込み、列車追跡中以外の高解像度衛星地図、iOS 17.6以降のロック画面／Dynamic Islandライブ表示を利用できます。創始期間の加入者にはアプリの旅のパスポートに創始島民バッジも提供します。 | — | □ |
| 1545 | i18n/legal-translations.js | 軌島通行證是 App 數位功能的自動續訂訂閱，不是實際乘車票券。通行證提供「軌島通行證月票（月訂方案）」與「軌島通行證年票（年訂方案）」兩種週期，目前僅透過 Apple App Store 收費。完成訂閱後，可使用當時列明的通行證功能，例如：台鐵列車的誤點履歷（回溯 90 天的逐日紀錄）、iPhone 桌面與鎖定畫面的捷運小工具放多站或用「自動（最近的站）」（免費可設定一站）、收藏與完乘紀錄跨裝置雲端同步、行程分享、在 App 匯入 Google Maps 已儲存清單成為最愛地點、App 非跟車時的衛星高解析圖磚，以及 iOS 17.6 以上可用的跟車鎖定畫面與動態島即時動態；創始期間訂閱的島民，App 旅程護照另有創始島民徽章。 | The Rail Island Pass is an auto-renewing subscription for digital app features, not a transport ticket. It is offered as a monthly or annual plan and is currently billed only through the Apple App Store. After subscribing, you can use the features listed at that time, such as 90 days of daily TRA delay history; multiple stations or Auto (nearest station) in iPhone Home and Lock Screen metro widgets, with one station available free; cloud sync for favorites and completion records; journey sharing; importing Google Maps saved lists as favorite places in the app; high-resolution satellite tiles when not following a train; and follow Live Activities on the Lock Screen and Dynamic Island on iOS 17.6 or later. Islanders who subscribe during the founding period also receive a Founding Islander badge in the app Journey Passport. | 軌島パスはアプリのデジタル機能の自動更新サブスクリプションで、実際の乗車券ではありません。月間パスと年間パスを提供し、現在はApple App Storeだけで課金します。購入後は、その時点で記載された機能、たとえば台湾鉄路の過去90日の日別遅延履歴、iPhoneのホーム／ロック画面メトロウィジェットでの複数駅または「自動（最寄り駅）」（1駅は無料）、お気に入りと完乗記録の端末間同期、旅程共有、Googleマップ保存済みリストのお気に入り場所への読み込み、列車追跡中以外の高解像度衛星地図、iOS 17.6以降のロック画面／Dynamic Island追跡ライブ表示を利用できます。創始期間の加入者にはアプリの旅のパスポートに創始島民バッジも提供します。 | — | □ |
| 1546 | i18n/legal-translations.js | 軌島通行證是 App 數位功能的自動續訂訂閱，不是實際乘車票券。通行證提供「軌島通行證月票（月訂方案）」與「軌島通行證年票（年訂方案）」兩種週期，目前僅透過 Apple App Store 收費。完成訂閱後，可使用當時列明的通行證功能，例如：台鐵列車的誤點履歷（回溯 90 天的逐日紀錄）、iPhone 桌面與鎖定畫面的捷運小工具設定多個車站或使用「自動（最近的站）」（免費可設定一站）、收藏與完乘紀錄跨裝置雲端同步、行程分享、在 App 匯入 Google Maps 已儲存清單成為最愛地點、App 非跟車時的衛星高解析圖磚，以及 iOS 17.6 以上可用的跟車鎖定畫面與動態島即時動態；創始期間訂閱的島民，App 旅程護照另有創始島民徽章。 | The Rail Island Pass is an auto-renewing subscription for digital app features, not a transport ticket. It is offered as a monthly or annual plan and is currently billed only through the Apple App Store. After subscribing, you can use the features listed at that time, such as 90 days of daily TRA delay history; multiple stations or Auto (nearest station) in iPhone Home and Lock Screen metro widgets, with one station available free; cloud sync for favorites and completion records; journey sharing; importing Google Maps saved lists as favorite places in the app; high-resolution satellite tiles when not following a train; and follow Live Activities on the Lock Screen and Dynamic Island on iOS 17.6 or later. Islanders who subscribe during the founding period also receive a Founding Islander badge in the app Journey Passport. | 軌島パスはアプリのデジタル機能の自動更新サブスクリプションで、実際の乗車券ではありません。月間パスと年間パスを提供し、現在はApple App Storeだけで課金します。購入後は、その時点で記載された機能、たとえば台湾鉄路の過去90日の日別遅延履歴、iPhoneのホーム／ロック画面メトロウィジェットでの複数駅または「自動（最寄り駅）」（1駅は無料）、お気に入りと完乗記録の端末間同期、旅程共有、Googleマップ保存済みリストのお気に入り場所への読み込み、列車追跡中以外の高解像度衛星地図、iOS 17.6以降のロック画面／Dynamic Island追跡ライブ表示を利用できます。創始期間の加入者にはアプリの旅のパスポートに創始島民バッジも提供します。 | — | □ |
| 1547 | i18n/legal-translations.js | 軌島通行證是 App 數位功能訂閱，不是實際乘車票券。App 內購買目前僅由 Apple App Store 處理；軌島不取得完整信用卡號。RevenueCat 會以你的 Firebase 使用者識別碼管理通行證購買資格、月票與年票商品、交易狀態與恢復購買。 | Rail Island Pass is a subscription to digital app features, not a real travel ticket. In-app purchases are currently processed only by Apple App Store; Rail Island does not receive full credit-card numbers. RevenueCat uses your Firebase user ID to manage pass eligibility, monthly and annual products, transaction status and purchase restoration. | 軌島パスはアプリのデジタル機能のサブスクリプションで、実際の乗車券ではありません。アプリ内購入は現在Apple App Storeだけが処理し、軌島は完全なクレジットカード番号を取得しません。RevenueCatはFirebaseユーザーIDを使い、パス資格、月間・年間商品、取引状態、購入復元を管理します。 | — | □ |
| 1548 | i18n/legal-translations.js | 軌島網站、靜態資產與 API 使用 Cloudflare 提供傳輸、快取與安全防護。Cloudflare 可能依其服務運作需要處理 IP 位址、請求時間、網址、裝置／瀏覽器資訊與安全事件紀錄。軌島沒有廣告 SDK，也沒有安裝任何第三方使用者行為分析 SDK（例如 Google Analytics、Firebase Analytics、Meta SDK）。 | Rail Island uses Cloudflare for delivery, caching and security of the website, static assets and APIs. Cloudflare may process IP addresses, request times, URLs, device/browser information and security-event logs as needed to operate its services. Rail Island has no advertising SDK and no third-party behavioral analytics SDK such as Google Analytics, Firebase Analytics or Meta SDK. | Webサイト、静的ファイル、APIの配信・キャッシュ・セキュリティにCloudflareを利用します。Cloudflareはサービス運用に必要なIPアドレス、要求時刻、URL、端末／ブラウザ情報、セキュリティイベントを処理する場合があります。軌島には広告SDKやGoogle Analytics、Firebase Analytics、Meta SDKなどの第三者行動分析SDKはありません。 | — | □ |
| 1549 | i18n/legal-translations.js | 軌島隱私權政策｜Rail Island | Rail Island Privacy Policy | 軌島プライバシーポリシー｜Rail Island | — | □ |
| 1550 | i18n/legal-translations.js | 原始碼 | Source code | ソースコード | — | □ |
| 1551 | i18n/legal-translations.js | 校正旅程上傳的資料（見一之 3：沿線里程、時間、速度、定位精度，以及該趟的系統、路線、車次、方向、乘車日期與一組隨機裝置識別碼）保存在 Cloudflare D1。這是軌島用來校正列車位置推估的基礎資料，沒有預設的到期時間，會保存到你要求刪除為止。 | Uploaded Calibration Journey data (see 1.3: route distance, time, speed, accuracy, plus system, route, train number, direction, travel date and a random device identifier) is stored in Cloudflare D1. It is foundational data for calibrating Rail Island’s train-position estimates, has no default expiry, and is retained until you request deletion. | 補正旅程で送信したデータ（1.3参照：路線上の距離、時刻、速度、位置精度、交通機関、路線、列車番号、方向、乗車日、ランダムな端末識別子）はCloudflare D1に保存します。列車位置推定を補正する基礎データで、既定の有効期限はなく、削除を依頼するまで保持します。 | — | □ |
| 1552 | i18n/legal-translations.js | 帳號刪除頁 | Account deletion page | アカウント削除ページ | — | □ |
| 1553 | i18n/legal-translations.js | 產生你主動要求的錄影與分享內容； | Creating recordings and shared content you request; | 要求した録画・共有内容の生成； | — | □ |
| 1554 | i18n/legal-translations.js | 這些供應商可能在不同國家或地區處理資料。軌島只提供完成相應功能所需的資料，並要求其依適用條款提供與本政策相當的資料保護。 | These providers may process data in different countries or regions. Rail Island provides only the data needed for the relevant function and requires protection comparable to this policy under applicable terms. | 各提供者は異なる国や地域でデータを処理する場合があります。軌島は各機能に必要なデータだけを提供し、適用される条件に基づき本ポリシーと同等の保護を求めます。 | — | □ |
| 1555 | i18n/legal-translations.js | 這些供應商可能在不同國家或地區處理資料。軌島只提供完成相應功能所需的資料。 | These providers may process data in different countries or regions. Rail Island supplies only the data needed for the relevant function. | 各事業者は異なる国・地域で処理する場合があります。軌島は該当機能に必要なデータだけを提供します。 | — | □ |
| 1556 | i18n/legal-translations.js | 這些紀錄不含帳號、電子郵件、裝置識別碼或廣告識別碼，軌島不會用它們建立個人檔案、辨識個別使用者或追蹤你在其他 App 與網站上的行為，也不會提供給廣告商或資料仲介。軌島只以彙總形式檢視這些數字（例如「有多少比例的使用時間在跟車模式」）。 | These records contain no account, email, device ID or advertising ID. Rail Island does not use them to profile or identify individuals, track activity in other apps/sites, or provide data to advertisers or data brokers. The figures are viewed only in aggregate. | 記録にはアカウント、メール、端末ID、広告IDを含みません。個人プロファイル作成、個人識別、他のアプリ／サイトでの追跡に利用せず、広告事業者やデータ仲介業者にも提供しません。数値は集計形式でのみ確認します。 | — | □ |
| 1557 | i18n/legal-translations.js | 通行證有效且登入後，軌島可透過 Firebase Firestore 同步以下內容： | While signed in with a valid pass, Rail Island can sync the following through Firebase Firestore: | 有効なパスでログインしている間、Firebase Firestoreを通じて次の内容を同期できます： | — | □ |
| 1558 | i18n/legal-translations.js | 最愛列車； | Favorite trains; | お気に入り列車； | — | □ |
| 1559 | i18n/legal-translations.js | 最愛地點的座標、名稱、清單名稱與來源連結； | Coordinates, names, list names and source links for favorite places; | お気に入り場所の座標、名称、リスト名、出典リンク； | — | □ |
| 1560 | i18n/legal-translations.js | 最愛車站； | Favorite stations; | お気に入り駅； | — | □ |
| 1561 | i18n/legal-translations.js | 提供 Plus 購買、資格驗證與恢復購買； | Plus purchases, entitlement verification and restoration; | Plus購入、資格確認、購入復元； | — | □ |
| 1562 | i18n/legal-translations.js | 提供軌島通行證購買、資格驗證與恢復購買； | provide Rail Island Pass purchasing, eligibility verification and purchase restoration; | 軌島パスの購入、資格確認、購入復元を提供するため； | — | □ |
| 1563 | i18n/legal-translations.js | 提供登入、跨裝置同步、資料備份與帳號刪除； | Sign-in, cross-device sync, backup and account deletion; | ログイン、端末間同期、バックアップ、アカウント削除； | — | □ |
| 1564 | i18n/legal-translations.js | 曾在通行證資格有效期間同步的四類資料保存在 Firebase；停止訂閱或資格失效不會自動刪除雲端副本，會保留到你在軌島帳號面板刪除帳號。 | The four data categories synced while pass eligibility was valid are stored in Firebase. Cancelling or losing eligibility does not automatically delete the cloud copy; it remains until you delete your account in the Rail Island account panel. | 有効なパス期間中に同期した4種類のデータはFirebaseに保存されます。解約または資格失効ではクラウド上のコピーを自動削除せず、軌島アカウントパネルでアカウントを削除するまで保持します。 | — | □ |
| 1565 | i18n/legal-translations.js | 登入後，軌島可透過 Firebase Firestore 同步以下內容： | After sign-in, Rail Island can sync the following through Firebase Firestore: | ログイン後、Firebase Firestoreを通じて次の内容を同期できます： | — | □ |
| 1566 | i18n/legal-translations.js | 登入後的同步資料保存在 Firebase，直到你在軌島帳號面板刪除帳號。 | Signed-in sync data remains in Firebase until you delete your account in the Rail Island account panel. | ログイン後の同期データは、軌島アカウントパネルで削除するまでFirebaseに保存されます。 | — | □ |
| 1567 | i18n/legal-translations.js | 開啟 App 時自動取得一次（低精度） | One automatic low-accuracy reading when the app opens | アプリ起動時に一度だけ低精度で自動取得 | — | □ |
| 1568 | i18n/legal-translations.js | 開發者：許翔（Hsu Hsiang） | Developer: Hsu Hsiang | 開発者：Hsu Hsiang | — | □ |
| 1569 | i18n/legal-translations.js | 開源專案 | Open-source project | オープンソース | — | □ |
| 1570 | i18n/legal-translations.js | 當你選擇以 Google 或 Apple 登入時，Firebase Authentication 會處理你的 Firebase 使用者識別碼、登入供應商，以及供應商提供的名稱、電子郵件地址或頭像（實際欄位依你的供應商設定與授權選擇而定）。軌島使用這些資料建立帳號、顯示登入狀態，並在通行證有效期間同步私人收藏，不用於廣告或行銷分析。 | When you choose Google or Apple sign-in, Firebase Authentication processes your Firebase user ID, sign-in provider, and any name, email address or profile image provided under your provider settings and permissions. Rail Island uses this data to create your account, show sign-in status and sync private collections while your pass is valid—not for advertising or marketing analytics. | GoogleまたはAppleログインを選ぶと、Firebase AuthenticationはFirebaseユーザーID、ログイン提供者、提供者の設定と許可に応じた氏名、メールアドレス、プロフィール画像を処理します。軌島はアカウント作成、ログイン状態表示、有効なパス期間中の非公開コレクション同期に使用し、広告やマーケティング分析には使用しません。 | — | □ |
| 1571 | i18n/legal-translations.js | 當你選擇以 Google 或 Apple 登入時，Firebase Authentication 會處理你的 Firebase 使用者識別碼、登入供應商，以及供應商提供的名稱、電子郵件地址或頭像（實際欄位依你的供應商設定與授權選擇而定）。軌島使用這些資料建立帳號、顯示登入狀態及同步私人收藏，不用於廣告或行銷分析。 | When you sign in with Google or Apple, Firebase Authentication processes your Firebase user ID, sign-in provider, and any name, email address or profile image supplied under your provider settings and permissions. Rail Island uses this data to create your account, show sign-in status and sync private favorites—not for advertising or marketing analytics. | GoogleまたはAppleでログインすると、Firebase AuthenticationがFirebaseユーザーID、ログイン事業者、および設定・許可に応じて提供される氏名、メールアドレス、プロフィール画像を処理します。軌島はアカウント作成、ログイン状態の表示、非公開のお気に入り同期にのみ利用し、広告やマーケティング分析には利用しません。 | — | □ |
| 1572 | i18n/legal-translations.js | 解析你主動選擇的 Google Takeout 清單； | Parsing Google Takeout lists you choose; | 選択したGoogle Takeoutリストの解析； | — | □ |
| 1573 | i18n/legal-translations.js | 維持服務安全、可靠性與除錯。 | Security, reliability and debugging. | 安全性、信頼性、デバッグ。 | — | □ |
| 1574 | i18n/legal-translations.js | 聯絡信箱： | Contact:  | 連絡先： | — | □ |
| 1575 | i18n/legal-translations.js | 隱私權政策 | Privacy Policy | プライバシーポリシー | — | □ |
| 1576 | i18n/legal-translations.js | 隱私權聯絡信箱： | Privacy contact:  | プライバシーに関する連絡先： | — | □ |
| 1577 | i18n/legal-translations.js | 顯示附近鐵道、平交道及列車； | Displaying nearby railways, crossings and trains; | 近くの鉄道、踏切、列車の表示； | — | □ |
| 1578 | i18n/legal-translations.js | Android 會向系統請求精確位置；你仍可在 Android 系統權限畫面選擇只提供概略位置，但藍點、附近車站與移動跟隨的準確度會降低。系統定位直接取得的原始座標不會離開你的裝置；你主動保存或匯入為最愛地點的座標，則依前節在通行證有效且登入後同步到 Firebase。前兩種定位情形的位置只在裝置內使用；校正旅程則是在裝置上先把座標投影成「這條路線上的第幾公里」，只有以下換算後的數值會上傳到軌島伺服器： | Android requests precise location from the system. You may still choose approximate location in Android permissions, but the blue dot, nearby stations and movement following will be less accurate. Raw coordinates obtained directly from system location do not leave your device. Coordinates that you actively save or import as favorite places are synced to Firebase after sign-in while your pass is active, as described above. Location from the first two cases is used only on the device. For a calibration journey, coordinates are first projected on the device into a distance along the route, and only the following converted values are uploaded to the Rail Island server: | Androidでは正確な位置情報をシステムに要求します。Androidの権限画面でおおよその位置だけを選ぶこともできますが、青い点、近くの駅、移動追跡の精度は下がります。システム位置情報から直接得た生の座標は端末外へ送信しません。利用者が保存またはお気に入りとして読み込んだ座標は、前節のとおり有効なパスでログイン後にFirebaseへ同期します。最初の2つの位置取得は端末内だけで使用します。補正旅程では端末上で座標を路線上の距離に変換し、次の変換後データだけを軌島サーバーへ送信します： | — | □ |
| 1579 | i18n/legal-translations.js | App 內付款、退款與交易爭議依 Apple App Store 或 Google Play 規則處理；網站付款依 RevenueCat Web Billing 及其付款處理服務規則處理。刪除軌島帳號不會自動取消進行中的訂閱，也不會自動產生退款；如需停止扣款，請先在 App Store／Google Play 或網站訂閱設定取消訂閱。 | In-app payments, refunds and disputes follow Apple App Store or Google Play rules; website payments follow RevenueCat Web Billing and its payment providers. Deleting a Rail Island account does not cancel an active subscription or create a refund. To stop charges, cancel first in App Store, Google Play or website subscription settings. | アプリ内の支払い・返金・取引紛争はApple App StoreまたはGoogle Play、Web決済はRevenueCat Web Billingと決済事業者の規則に従います。軌島アカウントを削除しても契約は自動解約されず、返金も発生しません。課金停止には先にストアまたはWeb設定で解約してください。 | — | □ |
| 1580 | i18n/legal-translations.js | App 內付款、退款與交易爭議依 Apple App Store 規則處理。刪除軌島帳號不會自動取消進行中的訂閱，也不會自動產生退款；如需停止扣款，請先在 App Store 的訂閱設定取消訂閱。 | In-app payments, refunds and transaction disputes follow Apple App Store rules. Deleting a Rail Island account does not cancel an active subscription or create a refund. To stop charges, first cancel in App Store subscription settings. | アプリ内の支払い、返金、取引紛争はApple App Store規則に従います。軌島アカウント削除では継続中の契約を自動解約せず、返金も発生しません。課金を止めるには先にApp Storeの設定で解約してください。 | — | □ |
| 1581 | i18n/legal-translations.js | App 內購買由 Apple App Store 或 Google Play 處理；網站付款由 RevenueCat Web Billing 及其付款處理服務處理。軌島不取得完整信用卡號。RevenueCat 會以你的 Firebase 使用者識別碼管理 Plus entitlement、商品、交易狀態與恢復購買；網站結帳時也可能使用你的帳號電子郵件地址，以完成付款與收據流程。 | In-app purchases are processed by Apple App Store or Google Play. Website payments are processed by RevenueCat Web Billing and its payment providers. Rail Island does not receive your full card number. RevenueCat uses your Firebase user ID to manage the Plus entitlement, products, transaction status and purchase restoration; website checkout may also use your account email for payment and receipts. | アプリ内購入はApple App StoreまたはGoogle Play、Web決済はRevenueCat Web Billingとその決済事業者が処理します。軌島は完全なカード番号を取得しません。RevenueCatはFirebaseユーザーIDを使ってPlus資格、商品、取引状態、購入復元を管理し、Web決済では支払い・領収書のためアカウントのメールアドレスを使う場合があります。 | — | □ |
| 1582 | i18n/legal-translations.js | App 支援 | App support | アプリサポート | — | □ |
| 1583 | i18n/legal-translations.js | App 為了下次開啟時快速落點而保存的最近一次定位座標，只留在裝置本機，最長 30 天。 | The app keeps the most recent location coordinates locally for up to 30 days to place the map quickly on the next launch. | 次回起動時の表示のため、最新の位置座標を端末内に最長30日保存します。 | — | □ |
| 1584 | i18n/legal-translations.js | App 為了下次開啟時快速落點而保存的最近一次定位座標，只留在裝置本機；超過 30 天不再被使用，但不會主動刪除，會留到被下一次定位覆蓋，或你移除 App、清除網站資料為止。 | The most recent coordinates saved so the app can open at the right place remain only on the device. After 30 days they are no longer used, but remain until overwritten by a later location, the app is removed, or site data is cleared. | 次回起動時の表示のために保存する最新の位置座標は端末内だけに残ります。30日を超えると使用しませんが、次の位置で上書きされるか、アプリ削除またはサイトデータ消去まで残ります。 | — | □ |
| 1585 | i18n/legal-translations.js | Apple 因法令、會計、防詐或爭議處理需要保留的交易紀錄，由其政策處理；刪除軌島帳號不等同申請刪除商店交易紀錄或退款。 | Transaction records Apple must retain for legal, accounting, fraud-prevention or dispute purposes are handled under Apple’s policies. Deleting a Rail Island account is not a request to delete store transaction records or issue a refund. | Appleが法令、会計、不正防止、紛争対応のため保持する取引記録はAppleのポリシーに従います。軌島アカウント削除はストア取引記録の削除や返金申請ではありません。 | — | □ |
| 1586 | i18n/legal-translations.js | Apple、Google Play 或付款服務因法令、會計、防詐或爭議處理需要保留的交易紀錄，由各平台依其政策處理；刪除軌島帳號不等同申請刪除商店交易紀錄或退款。 | Apple, Google Play or payment providers may retain transaction records for legal, accounting, fraud-prevention or dispute purposes under their policies. Deleting a Rail Island account does not request deletion of store records or a refund. | Apple、Google Play、決済事業者が法令、会計、不正防止、紛争対応のため保持する取引記録は各社のポリシーに従います。軌島アカウント削除はストア記録の削除や返金申請ではありません。 | — | □ |
| 1587 | i18n/legal-translations.js | Apple、Google Play：App 登入與商店交易； | Apple and Google Play: app sign-in and store transactions; | Apple、Google Play：アプリのログイン、ストア取引； | — | □ |
| 1588 | i18n/legal-translations.js | Apple：App 登入與商店交易； | Apple: app sign-in and store transactions; | Apple：アプリのログインとストア取引； | — | □ |
| 1589 | i18n/legal-translations.js | CARTO、OpenStreetMap、Esri 及其影像資料來源：線上底圖； | CARTO, OpenStreetMap, Esri and imagery sources: online basemaps; | CARTO、OpenStreetMap、Esriおよび画像提供元：オンライン地図； | — | □ |
| 1590 | i18n/legal-translations.js | CARTO：網站的街道底圖圖磚，僅在 OpenFreeMap 無法載入時使用； | CARTO: website street basemap tiles, used only if OpenFreeMap cannot load; | CARTO：OpenFreeMapを読み込めない場合だけ使用するWebサイトの道路地図タイル； | — | □ |
| 1591 | i18n/legal-translations.js | Cloudflare：網站、API、快取、安全防護與部分前端程式庫； | Cloudflare: website, APIs, caching, security and some front-end libraries; | Cloudflare：Webサイト、API、キャッシュ、セキュリティ、一部のフロントエンドライブラリ； | — | □ |
| 1592 | i18n/legal-translations.js | Cloudflare：網站、API、快取與安全防護； | Cloudflare: website, APIs, caching and security; | Cloudflare：Webサイト、API、キャッシュ、セキュリティ； | — | □ |
| 1593 | i18n/legal-translations.js | entitlement，可用同一個軌島帳號跨平台恢復。完成訂閱後，可使用當時列明的 Plus 功能，例如每班車的誤點歷史與統計圖表、收藏跨裝置雲端同步、衛星底圖與進階定位功能。 | entitlement and can be restored across platforms with the same Rail Island account. After subscribing, you can use the Plus features then listed, such as per-train delay history and charts, cross-device favorites sync, satellite maps and advanced location features. | 資格に対応し、同じ軌島アカウントで各プラットフォームから復元できます。購入後は、列車ごとの遅延履歴・統計、お気に入り同期、衛星地図、高度な位置情報など、その時点で記載されたPlus機能を利用できます。 | — | □ |
| 1594 | i18n/legal-translations.js | Esri 及其影像資料來源：衛星影像底圖； | Esri and its imagery sources: satellite basemap; | Esriとその画像提供元：衛星画像地図； | — | □ |
| 1595 | i18n/legal-translations.js | Google Firebase：登入與 Firestore 同步； | Google Firebase: sign-in and Firestore sync; | Google Firebase：ログイン、Firestore同期； | — | □ |
| 1596 | i18n/legal-translations.js | Google Takeout ZIP、CSV、JSON 或 GeoJSON 會先在你的裝置內解析，不會把原始檔案上傳。只有你在預覽後確認匯入的台灣地點，才會成為軌島最愛地點；通行證有效且登入時，這些地點會依上述方式同步。 | Google Takeout ZIP, CSV, JSON and GeoJSON files are parsed on your device; the original files are not uploaded. Only Taiwan places you confirm after preview become Rail Island favorite places. While signed in with a valid pass, those places sync as described above. | Google TakeoutのZIP、CSV、JSON、GeoJSONは端末内で解析し、元ファイルをアップロードしません。プレビュー後に確定した台湾の場所だけがお気に入りになり、有効なパスでログイン中は上記の方法で同期します。 | — | □ |
| 1597 | i18n/legal-translations.js | Google Takeout ZIP、CSV、JSON 或 GeoJSON 會先在你的裝置內解析，不會把原始檔案上傳。只有你在預覽後確認匯入的台灣地點，才會成為軌島最愛地點；登入狀態下，這些地點會依上述方式同步。 | Google Takeout ZIP, CSV, JSON and GeoJSON files are parsed on your device; the original files are not uploaded. Only Taiwan places that you confirm after preview become Rail Island favorites. When signed in, those places are synced as described above. | Google TakeoutのZIP、CSV、JSON、GeoJSONは端末内で解析し、元ファイルはアップロードしません。プレビュー後に確定した台湾の場所だけがお気に入りとなり、ログイン中は上記の方法で同期されます。 | — | □ |
| 1598 | i18n/legal-translations.js | iOS App 啟動時會初始化 Firebase Core 與 Firebase Authentication，並掛上登入狀態監聽器，讓 Google／Apple 登入功能隨時可用；這個動作本身不等於登入。在你尚未登入且本機沒有可還原的 Firebase 登入狀態時，這段初始化只會在裝置內讀取設定與 Keychain，並把 Firebase SDK 的 heartbeat 診斷資料記在本機；此時不會向 Google／Firebase 發出網路請求，也不會建立或傳送 Firebase 使用者識別碼。該 heartbeat 可能隨你之後發動的 Firebase 請求傳送，內容是裝置、作業系統、App bundle ID 與開發平台組成的 Firebase user agent；Firebase 說明這份 user agent 不會連結到使用者或裝置識別碼。Firebase Authentication 的網路連線與下述帳號資料處理，要到你選擇 Google 或 Apple 登入時才開始。App 的地圖、列車動態等基本功能仍會依本政策「網路與安全紀錄」及「使用量測量」所述，連線到軌島 API、Cloudflare 與底圖供應商。 | When the iOS app starts, it initializes Firebase Core and Firebase Authentication and attaches an authentication-state listener so Google/Apple sign-in is available. Initialization alone is not sign-in. If you are signed out and no Firebase session can be restored locally, initialization only reads configuration and Keychain data on the device and stores Firebase SDK heartbeat diagnostics locally; it does not contact Google/Firebase, create a Firebase user ID, or transmit one at that time. A heartbeat may be sent with a later Firebase request and contains a Firebase user agent made from device, operating system, app bundle ID and development-platform data; Firebase states that this user agent is not linked to a user or device identifier. Firebase Authentication network access and the account processing below begin only when you choose Google or Apple sign-in. Core map and train features still connect to Rail Island APIs, Cloudflare and basemap providers as described under Network and security logs and Usage measurement. | iOSアプリの起動時にFirebase CoreとFirebase Authenticationを初期化し、認証状態リスナーを設定してGoogle／Appleログインを利用可能にします。初期化だけではログインになりません。未ログインで復元可能なFirebaseセッションがない場合、この処理は端末内の設定とKeychainを読み、Firebase SDKのheartbeat診断情報を端末内に保存するだけで、この時点ではGoogle／Firebaseへ通信せず、FirebaseユーザーIDの作成・送信もしません。heartbeatは後に利用者が行うFirebaseリクエストと共に送信される場合があり、端末、OS、App bundle ID、開発プラットフォームから構成されるFirebase user agentを含みます。Firebaseは、このuser agentは利用者または端末識別子に関連付けられないと説明しています。Firebase Authenticationの通信と以下のアカウントデータ処理は、GoogleまたはAppleログインを選んだ時に開始します。地図や列車表示などの基本機能は、本ポリシーの「ネットワークとセキュリティ記録」「利用量測定」に従い、軌島API、Cloudflare、地図提供者へ接続します。 | — | □ |
| 1599 | i18n/legal-translations.js | jsDelivr：部分前端程式庫； | jsDelivr: some front-end libraries; | jsDelivr：一部のフロントエンドライブラリ； | — | □ |
| 1600 | i18n/legal-translations.js | Natural Earth：App 內建的離線海陸輪廓資料，不接收使用者資料。 | Natural Earth: bundled offline land/water outlines; it receives no user data. | Natural Earth：アプリ内蔵のオフライン地形データ。利用者データは受け取りません。 | — | □ |
| 1601 | i18n/legal-translations.js | OpenFreeMap：網站與 App 的街道底圖圖磚； | OpenFreeMap: street basemap tiles for the website and app; | OpenFreeMap：Webサイトとアプリの道路地図タイル； | — | □ |
| 1602 | i18n/legal-translations.js | OpenStreetMap 貢獻者與 OpenMapTiles：街道底圖的圖資來源，不接收使用者資料； | OpenStreetMap contributors and OpenMapTiles: street-basemap data sources; they do not receive user data; | OpenStreetMap contributorsとOpenMapTiles：道路地図のデータ提供元。利用者データは受け取りません； | — | □ |
| 1603 | i18n/legal-translations.js | RevenueCat 及其 Web Billing 付款處理服務：Plus 商品、entitlement、付款與恢復購買； | RevenueCat and its Web Billing payment providers: Plus products, entitlement, payments and restoration; | RevenueCatおよびWeb Billing決済事業者：Plus商品、資格、決済、購入復元； | — | □ |
| 1604 | i18n/legal-translations.js | RevenueCat：軌島通行證商品、購買資格、付款與恢復購買； | RevenueCat: Rail Island Pass products, purchase eligibility, payments and restoration; | RevenueCat：軌島パス商品、購入資格、決済、購入復元； | — | □ |
| 1605 | i18n/legal-translations.js | Stadia Maps：App 的街道底圖圖磚，僅在 OpenFreeMap 無法載入時使用； | Stadia Maps: app street basemap tiles, used only if OpenFreeMap cannot load; | Stadia Maps：OpenFreeMapを読み込めない場合だけ使用するアプリの道路地図タイル； | — | □ |

## 站名（541 筆）

| # | 來源 | 繁中原文 | English | 日本語 | 自動提示 | 複核 |
|---:|---|---|---|---|---|:---:|
| 1606 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 七堵 | Qidu | 七堵 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1607 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 七張 | Qizhang | 七張 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1608 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 九曲堂 | Jiuqutang | 九曲堂 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1609 | i18n/stations.json systems.tmrt；App／Widget／Live Activity Localizable.xcstrings | 九張犁 | Jiuzhangli | 九張犁 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1610 | i18n/stations.json systems.tmrt；App／Widget／Live Activity Localizable.xcstrings | 九德 | Jiude | 九德 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1611 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 九讚頭 | Jiuzantou | 九讃頭 | — | □ |
| 1612 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 二水 | Ershui | 二水 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1613 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 二結 | Erjie | 二結 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1614 | i18n/stations.json systems.afr_sched；App／Widget／Live Activity Localizable.xcstrings | 二萬平 | Erwanping | 二万平 | — | □ |
| 1615 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 八斗子 | Badouzi | 八斗子 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1616 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 八堵 | Badu | 八堵 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1617 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 十分 | Shifen | 十分 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1618 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 十四張 | Shisizhang | 十四張 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1619 | i18n/stations.json systems.ntalrt | 十四張 | Shisizhang | 十四張 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1620 | i18n/stations.json systems.afr_sched；App／Widget／Live Activity Localizable.xcstrings | 十字路 | Shizilu | 十字路 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1621 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 三民 | Sanmin | 三民 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1622 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 三民高中 | Sanmin Senior High School | 三民高校 | — | □ |
| 1623 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 三多商圈 | Sanduo Shopping District | 三多商圈 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1624 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 三坑 | Sankeng | 三坑 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1625 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 三和國中 | Sanhe Junior High School | 三和中学校 | — | □ |
| 1626 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 三姓橋 | Sanxingqiao | 三姓橋 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1627 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 三重 | Sanchong | 三重 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1628 | i18n/stations.json systems.tymc；App／Widget／Live Activity Localizable.xcstrings | 三重站 | Sanchong Station | 三重駅 | — | □ |
| 1629 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 三重國小 | Sanchong Elementary School | 三重小学校 | — | □ |
| 1630 | i18n/stations.json systems.sanying；App／Widget／Live Activity Localizable.xcstrings | 三峽 | Sanxia | 三峽 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1631 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 三貂嶺 | Sandiaoling | 三貂嶺 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1632 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 三塊厝 | Sankuaicuo | 三塊厝 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1633 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 三義 | Sanyi | 三義 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1634 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 上員 | Shangyuan | 上員 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1635 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 千甲 | Qianjia | 千甲 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1636 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 土城 | Tucheng | 土城 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1637 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 士林 | Shilin | 士林 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1638 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 大山 | Dashan | 大山 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1639 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 大甲 | Dajia | 大甲 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1640 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 大安 | Daan | 大安 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1641 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 大安森林公園 | Daan Park | 大安森林公園 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1642 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 大村 | Dacun | 大村 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1643 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 大肚 | Dadu | 大肚 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1644 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 大里 | Dali | 大里 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1645 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 大坪林 | Dapinglin | 大坪林 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1646 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 大東 | Dadong | 大東 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1647 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 大林 | Dalin | 大林 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1648 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 大武 | Dawu | 大武 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1649 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 大直 | Dazhi | 大直 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1650 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 大富 | Dafu | 大富 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1651 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 大湖 | Dahu | 大湖 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1652 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 大湖公園 | Dahu Park | 大湖公園 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1653 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 大華 | Dahua | 大華 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1654 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 大順民族 | Dashun Minzu | 大順民族 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1655 | i18n/stations.json systems.tymc；App／Widget／Live Activity Localizable.xcstrings | 大園站 | Dayuan Station | 大園駅 | — | □ |
| 1656 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 大溪 | Daxi | 大渓 | — | □ |
| 1657 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 大寮 | Daliao | 大寮 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1658 | i18n/stations.json systems.tmrt；App／Widget／Live Activity Localizable.xcstrings | 大慶 | Daqing | 大慶 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1659 | i18n/stations.json systems.tra_sched | 大慶 | Daqing | 大慶 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1660 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 大橋 | Daqiao | 大橋 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1661 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 大橋頭 | Daqiaotou | 大橋頭 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1662 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 小南門 | Xiaonanmen | 小南門 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1663 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 小港 | Siaogang | 小港 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1664 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 小碧潭 | Xiaobitan | 小碧潭 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1665 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 山里 | Shanli | 山里 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1666 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 山佳 | Shanjia | 山佳 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1667 | i18n/stations.json systems.tymc；App／Widget／Live Activity Localizable.xcstrings | 山鼻站 | Shanbi Station | 山鼻駅 | — | □ |
| 1668 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 中山 | Zhongshan | 中山 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1669 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 中山國小 | Zhongshan Elementary School | 中山小学校 | — | □ |
| 1670 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 中山國中 | Zhongshan Junior High School | 中山中学校 | — | □ |
| 1671 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 中央公園 | Central Park | 中央公園 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1672 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 中正紀念堂 | Chiang Kai-Shek Memorial Hall | 中正紀念堂 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1673 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 中里 | Zhongli_Yilan | 中里 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1674 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 中和 | Zhonghe | 中和 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1675 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 中洲 | Zhongzhou | 中洲 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1676 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 中原 | Zhongyuan | 中原 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1677 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 中壢 | Zhongli_Taoyuan | 中壢 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1678 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 丹鳳 | Danfeng | 丹鳳 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1679 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 五堵 | Wudu | 五堵 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1680 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 五塊厝 | Wukuaicuo | 五塊厝 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1681 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 五權 | Wuquan | 五権 | — | □ |
| 1682 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 五權國小站 | Wucyuan Elementary School | 五権小学校 | — | □ |
| 1683 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 仁德 | Rende | 仁徳 | — | □ |
| 1684 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 內惟 | Neiwei | 內惟 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1685 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 內惟藝術中心 | Neiwei Arts Center | 内惟芸術センター | — | □ |
| 1686 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 內湖 | Neihu | 内湖 | — | □ |
| 1687 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 內獅 | Neishi | 内獅 | — | □ |
| 1688 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 內壢 | Neili | 内壢 | — | □ |
| 1689 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 內灣 | Neiwan | 内湾 | — | □ |
| 1690 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 公館 | Gongguan | 公館 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1691 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 六家 | Liujia | 六家 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1692 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 六張犁 | Liuzhangli | 六張犁 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1693 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 六塊厝 | Liukuaicuo | 六塊厝 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1694 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 太原 | Taiyuan | 太原 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1695 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 太麻里 | Taimali | 太麻里 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1696 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 文化中心 | Cultural Center | 文化センター | — | □ |
| 1697 | i18n/stations.json systems.tmrt；App／Widget／Live Activity Localizable.xcstrings | 文心中清 | Wenxin Zhongqing | 文心中清 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1698 | i18n/stations.json systems.tmrt；App／Widget／Live Activity Localizable.xcstrings | 文心崇德 | Wenxin Chongde | 文心崇徳 | — | □ |
| 1699 | i18n/stations.json systems.tmrt；App／Widget／Live Activity Localizable.xcstrings | 文心森林公園 | Wenxin Forest Park | 文心森林公園 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1700 | i18n/stations.json systems.tmrt；App／Widget／Live Activity Localizable.xcstrings | 文心櫻花 | Wenxin Yinghua | 文心桜花 | — | □ |
| 1701 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 文武聖殿站 | Wenwu Temple | 文武聖殿 | — | □ |
| 1702 | i18n/stations.json systems.tmrt；App／Widget／Live Activity Localizable.xcstrings | 文華高中 | Wenhua Senior High School | 文華高校 | — | □ |
| 1703 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 文德 | Wende | 文徳 | — | □ |
| 1704 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 斗六 | Douliu | 斗六 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1705 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 斗南 | Dounan | 斗南 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1706 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 日南 | Rinan | 日南 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1707 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 木柵 | Muzha | 木柵 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1708 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 水上 | Shuishang | 水上 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1709 | i18n/stations.json systems.tmrt；App／Widget／Live Activity Localizable.xcstrings | 水安宮 | Shui-an Temple | 水安宮 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1710 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 水里 | Shuili | 水里 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1711 | i18n/stations.json systems.afr_sched；App／Widget／Live Activity Localizable.xcstrings | 水社寮 | Shuisheliao | 水社寮 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1712 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 世運 | World Game | ワールドゲームズ | — | □ |
| 1713 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 冬山 | Dongshan | 冬山 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1714 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 凹子底 | Aozihdi | 凹子底 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1715 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 加祿 | Jialu | 加禄 | — | □ |
| 1716 | i18n/stations.json systems.tmrt；App／Widget／Live Activity Localizable.xcstrings | 北屯總站 | Beitun Main Station | 北屯総駅 | — | □ |
| 1717 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 北投 | Beitou | 北投 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1718 | i18n/stations.json systems.afr_sched；App／Widget／Live Activity Localizable.xcstrings | 北門 | Beimen | 北門 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1719 | i18n/stations.json systems.mrt | 北門 | Beimen | 北門 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1720 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 北埔 | Beipu | 北埔 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1721 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 北湖 | Beihu | 北湖 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1722 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 北新竹 | North Hsinchu | 北新竹 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1723 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 古亭 | Guting | 古亭 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1724 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 台大醫院 | NTU Hospital | 台湾大学病院 | — | □ |
| 1725 | i18n/stations.json systems.thsr_sched | 台中 | Taichung | 台中 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1726 | i18n/stations.json systems.thsr_sched | 台北 | Taipei | 台北 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1727 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 台北101/世貿 | Taipei 101/World Trade Center | 台北101 / 世界貿易センター | — | □ |
| 1728 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 台北小巨蛋 | Taipei Arena | 台北アリーナ | — | □ |
| 1729 | i18n/stations.json systems.ntalrt；App／Widget／Live Activity Localizable.xcstrings | 台北小城 | Taipei Xiaocheng | 台北小城 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1730 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 台北車站 | Taipei Main Station | 台北駅 | — | □ |
| 1731 | i18n/stations.json systems.tymc | 台北車站 | Taipei Main Station | 台北駅 | — | □ |
| 1732 | i18n/stations.json systems.ntdlrt；App／Widget／Live Activity Localizable.xcstrings | 台北海洋大學 | Taipei University of Marine Technology | 台北海洋大学 | — | □ |
| 1733 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 台北橋 | Taipei Bridge | 台北橋 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1734 | i18n/stations.json systems.thsr_sched | 台南 | Tainan | 台南 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1735 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 台電大樓 | Taipower Building | 台湾電力ビル | — | □ |
| 1736 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 四城 | Sicheng | 四城 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1737 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 四腳亭 | Sijiaoting | 四脚亭 | — | □ |
| 1738 | i18n/stations.json systems.tmrt；App／Widget／Live Activity Localizable.xcstrings | 四維國小 | Sihwei Elementary School | 四維小学校 | — | □ |
| 1739 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 外澳 | Wai'ao | 外澳 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1740 | i18n/stations.json systems.thsr_sched | 左營 | Zuoying | 左營 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1741 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 左營 | Zuoying | 左営 | — | □ |
| 1742 | i18n/stations.json systems.tra_sched | 左營 | Zuoying | 左営 | — | □ |
| 1743 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 巨蛋 | Kaohsiung Arena | 高雄アリーナ | — | □ |
| 1744 | i18n/stations.json systems.tmrt；App／Widget／Live Activity Localizable.xcstrings | 市政府 | Taichung City Hall | 市政府 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1745 | i18n/stations.json systems.mrt | 市政府 | Taipei City Hall | 台北市政府 | — | □ |
| 1746 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 平和 | Pinghe | 平和 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1747 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 平溪 | Pingxi | 平渓 | — | □ |
| 1748 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 正義 | Zhengyi | 正義 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1749 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 民族 | Minzu | 民族 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1750 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 民雄 | Minxiong | 民雄 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1751 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 民權西路 | Minquan W. Rd. | 民権西路 | — | □ |
| 1752 | i18n/stations.json systems.sanying；App／Widget／Live Activity Localizable.xcstrings | 永吉公園 | Yongji Park | 永吉公園 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1753 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 永安市場 | Yongan Market | 永安市場 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1754 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 永春 | Yongchun | 永春 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1755 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 永康 | Yongkang | 永康 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1756 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 永靖 | Yongjing | 永靖 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1757 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 永寧 | Yongning | 永寧 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1758 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 永樂 | Yongle | 永楽 | — | □ |
| 1759 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 玉里 | Yuli | 玉里 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1760 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 生態園區 | Ecological District | 生態園区 | — | □ |
| 1761 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 田中 | Tianzhong | 田中 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1762 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 白沙屯 | Baishatun | 白沙屯 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1763 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 石城 | Shicheng | 石城 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1764 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 石牌 | Shipai | 石牌 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1765 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 石榴 | Shiliu | 石榴 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1766 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 石龜 | Shigui | 石亀 | — | □ |
| 1767 | i18n/stations.json systems.afr_sched；App／Widget／Live Activity Localizable.xcstrings | 交力坪 | Jiaoliping | 交力坪 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1768 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 先嗇宮 | Xianse Temple | 先嗇宮 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1769 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 光復 | Guangfu | 光復 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1770 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 光榮碼頭 | Glory Pier | 光栄埠頭 | — | □ |
| 1771 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 合興 | Hexing | 合興 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1772 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 吉安 | Ji'an | 吉安 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1773 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 后里 | Houli | 后里 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1774 | i18n/stations.json systems.afr_sched；App／Widget／Live Activity Localizable.xcstrings | 多林 | Duolin | 多林 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1775 | i18n/stations.json systems.ntalrt；App／Widget／Live Activity Localizable.xcstrings | 安康 | Ankang | 安康 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1776 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 成功 | Chenggong | 成功 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1777 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 汐止 | Xizhi | 汐止 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1778 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 汐科 | Xike | 汐科 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1779 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 江子翠 | Jiangzicui | 江子翠 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1780 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 池上 | Chishang | 池上 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1781 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 百福 | Baifu | 百福 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1782 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 竹中 | Zhuzhong | 竹中 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1783 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 竹北 | Zhubei | 竹北 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1784 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 竹田 | Zhutian | 竹田 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1785 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 竹東 | Zhudong | 竹東 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1786 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 竹南 | Zhunan | 竹南 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1787 | i18n/stations.json systems.afr_sched；App／Widget／Live Activity Localizable.xcstrings | 竹崎 | Zhuqi | 竹崎 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1788 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 竹圍 | Zhuwei | 竹囲 | — | □ |
| 1789 | i18n/stations.json systems.tymc；App／Widget／Live Activity Localizable.xcstrings | 老街溪站 | Laojie River Station | 老街溪駅 | — | □ |
| 1790 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 行天宮 | Xingtian Temple | 行天宮 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1791 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 西門 | Ximen | 西門 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1792 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 西湖 | Xihu | 西湖 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1793 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 西勢 | Xishi | 西勢 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1794 | i18n/stations.json systems.tymc；App／Widget／Live Activity Localizable.xcstrings | 坑口站 | Kengkou Station | 坑口駅 | — | □ |
| 1795 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 志學 | Zhixue | 志学 | — | □ |
| 1796 | i18n/stations.json systems.ntdlrt；App／Widget／Live Activity Localizable.xcstrings | 沙崙 | Shalun | 沙崙 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1797 | i18n/stations.json systems.tra_sched | 沙崙 | Shalun | 沙崙 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1798 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 沙鹿 | Shalu | 沙鹿 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1799 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 牡丹 | Mudan | 牡丹 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1800 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 秀朗橋 | Xiulang Bridge | 秀朗橋 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1801 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 車埕 | Checheng | 車埕 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1802 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 辛亥 | Xinhai | 辛亥 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1803 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 亞東醫院 | Far Eastern Hospital | 亜東病院 | — | □ |
| 1804 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 佳冬 | Jiadong | 佳冬 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1805 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 和仁 | Heren | 和仁 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1806 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 和平 | Heping | 和平 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1807 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 奇岩 | Qiyan | 奇岩 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1808 | i18n/stations.json systems.tra_sched | 宜蘭 | Yilan | 宜蘭 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1809 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 岡山 | Gangshan | 岡山 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1810 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 岡山車站 | Gangshan Station | 岡山駅 | — | □ |
| 1811 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 岡山高醫 | Kaohsiung Medical University Gangshan Hospital | 岡山高医 | — | □ |
| 1812 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 幸福 | Xingfu | 幸福 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1813 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 府中 | Fuzhong | 府中 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1814 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 忠孝復興 | Zhongxiao Fuxing | 忠孝復興 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1815 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 忠孝敦化 | Zhongxiao Dunhua | 忠孝敦化 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1816 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 忠孝新生 | Zhongxiao Xinsheng | 忠孝新生 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1817 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 忠義 | Zhongyi | 忠義 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1818 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 拔林 | Balin | 抜林 | — | □ |
| 1819 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 昆陽 | Kunyang | 昆陽 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1820 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 明德 | Mingde | 明徳 | — | □ |
| 1821 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 東竹 | Dongzhu | 東竹 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1822 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 東里 | Dongli | 東里 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1823 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 東門 | Dongmen | 東門 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1824 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 東海 | Donghai | 東海 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1825 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 東湖 | Donghu | 東湖 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1826 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 東澳 | Dong'ao | 東澳 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1827 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 松山 | Songshan | 松山 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1828 | i18n/stations.json systems.tra_sched | 松山 | Songshan | 松山 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1829 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 松山機場 | Songshan Airport | 松山空港 | — | □ |
| 1830 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 松江南京 | Songjiang Nanjing | 松江南京 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1831 | i18n/stations.json systems.tmrt；App／Widget／Live Activity Localizable.xcstrings | 松竹 | Songzhu | 松竹 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1832 | i18n/stations.json systems.tra_sched | 松竹 | Songzhu | 松竹 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1833 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 板新 | Banxin | 板新 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1834 | i18n/stations.json systems.thsr_sched；App／Widget／Live Activity Localizable.xcstrings | 板橋 | Banqiao | 板橋 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1835 | i18n/stations.json systems.mrt | 板橋 | Banqiao | 板橋 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1836 | i18n/stations.json systems.tra_sched | 板橋 | Banqiao | 板橋 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1837 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 枋山 | Fangshan | 枋山 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1838 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 枋寮 | Fangliao | 枋寮 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1839 | i18n/stations.json systems.tymc；App／Widget／Live Activity Localizable.xcstrings | 林口站 | Linkou Station | 林口駅 | — | □ |
| 1840 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 林內 | Linnei | 林内 | — | □ |
| 1841 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 林榮新光 | Linrong Shin Kong | 林栄新光 | — | □ |
| 1842 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 林鳳營 | Linfengying | 林鳳営 | — | □ |
| 1843 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 林邊 | Linbian | 林辺 | — | □ |
| 1844 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 武塔 | Wuta | 武塔 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1845 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 油廠國小 | Oil Refinery Elementary School | 油廠小学校 | — | □ |
| 1846 | i18n/stations.json systems.afr_sched；App／Widget／Live Activity Localizable.xcstrings | 沼平 | Zhaoping | 沼平 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1847 | i18n/stations.json systems.ntalrt；App／Widget／Live Activity Localizable.xcstrings | 玫瑰中國城 | Rose China Town | 玫瑰中国城 | — | □ |
| 1848 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 知本 | Zhiben | 知本 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1849 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 社頭 | Shetou | 社頭 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1850 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 芝山 | Zhishan | 芝山 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1851 | i18n/stations.json systems.tra_sched | 花蓮 | Hualien | 花蓮 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1852 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 花壇 | Huatan | 花壇 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1853 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 金崙 | Jinlun | 金崙 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1854 | i18n/stations.json systems.tymc；App／Widget／Live Activity Localizable.xcstrings | 長庚醫院站 | Chang Gung Memorial Hospital Station | 長庚病院駅 | — | □ |
| 1855 | i18n/stations.json systems.sanying；App／Widget／Live Activity Localizable.xcstrings | 長壽山 | Changshoushan | 長寿山 | — | □ |
| 1856 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 長榮大學 | Chang Jung Christian University | 長栄大学 | — | □ |
| 1857 | i18n/stations.json systems.afr_sched；App／Widget／Live Activity Localizable.xcstrings | 阿里山 | Alishan | 阿里山 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1858 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 青埔 | Cingpu | 青埔 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1859 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 保安 | Bao'an | 保安 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1860 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 信義安和 | Xinyi Anhe | 信義安和 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1861 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 信義國小 | Sinyi Elementary School | 信義小学校 | — | □ |
| 1862 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 前金 | Cianjin | 前金 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1863 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 前鎮之星 | Cianjhen Star | 前鎮之星 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1864 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 前鎮高中 | Cianjhen Senior High School | 前鎮高校 | — | □ |
| 1865 | i18n/stations.json systems.tmrt；App／Widget／Live Activity Localizable.xcstrings | 南屯 | Nantun | 南屯 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1866 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 南平 | Nanping | 南平 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1867 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 南州 | Nanzhou | 南州 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1868 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 南京三民 | Nanjing Sanmin | 南京三民 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1869 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 南京復興 | Nanjing Fuxing | 南京復興 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1870 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 南科 | Nanke | 南科 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1871 | i18n/stations.json systems.thsr_sched；App／Widget／Live Activity Localizable.xcstrings | 南港 | Nangang | 南港 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1872 | i18n/stations.json systems.mrt | 南港 | Nangang | 南港 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1873 | i18n/stations.json systems.tra_sched | 南港 | Nangang | 南港 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1874 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 南港展覽館 | Taipei Nangang Exhibition Center | 南港展覧館 | — | □ |
| 1875 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 南港軟體園區 | Nangang Software Park | 南港ソフトウェアパーク | — | □ |
| 1876 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 南勢 | Nanshi | 南勢 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1877 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 南勢角 | Nanshijiao | 南勢角 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1878 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 南靖 | Nanjing | 南靖 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1879 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 南樹林 | South Shulin | 南樹林 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1880 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 南澳 | Nan'ao | 南澳 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1881 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 哈瑪星 | Hamasen | 哈瑪星 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1882 | i18n/stations.json systems.tra_sched | 屏東 | Pingtung | 屏東 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1883 | i18n/stations.json systems.afr_sched；App／Widget／Live Activity Localizable.xcstrings | 屏遮那 | Pingzhena | 屏遮那 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1884 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 後山埤 | Houshanpi | 後山埤 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1885 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 後庄 | Houzhuang | 後庄 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1886 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 後勁 | Houjing | 後勁 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1887 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 後壁 | Houbi | 後壁 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1888 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 後龍 | Houlong | 後龍 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1889 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 後驛 | Houyi | 後駅 | — | □ |
| 1890 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 柳營 | Liuying | 柳営 | — | □ |
| 1891 | i18n/stations.json systems.krtc | 科工館 | Science and Technology Museum | 国立科学工芸博物館 | — | □ |
| 1892 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 科工館 | Science And Technology Museum | 国立科学技術博物館 | — | □ |
| 1893 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 科技大樓 | Technology Building | テクノロジービル | — | □ |
| 1894 | i18n/stations.json systems.ntdlrt；App／Widget／Live Activity Localizable.xcstrings | 竿蓁林 | Ganzhenlin | 竿蓁林 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1895 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 紅樹林 | Hongshulin | 紅樹林 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1896 | i18n/stations.json systems.ntdlrt | 紅樹林 | Hongshulin | 紅樹林 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1897 | i18n/stations.json systems.krtc | 美術館 | Kaohsiung Museum of Fine Arts | 美術館 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1898 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 美術館 | Museum of Fine Arts | 高雄美術館 | — | □ |
| 1899 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 美麗島 | Formosa Boulevard | 美麗島 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1900 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 苑裡 | Yuanli | 苑裡 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1901 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 苓雅運動園區 | Lingya Sports Park | 苓雅スポーツパーク | — | □ |
| 1902 | i18n/stations.json systems.thsr_sched | 苗栗 | Miaoli | 苗栗 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1903 | i18n/stations.json systems.tra_sched | 苗栗 | Miaoli | 苗栗 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1904 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 香山 | Xiangshan | 香山 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1905 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 員林 | Yuanlin | 員林 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1906 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 埔心 | Puxin | 埔心 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1907 | i18n/stations.json systems.ntdlrt；App／Widget／Live Activity Localizable.xcstrings | 崁頂 | Kanding | 崁頂 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1908 | i18n/stations.json systems.tra_sched | 崁頂 | Kanding | 崁頂 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1909 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 徐匯中學 | St.lgnatius High School | 徐匯高校 | — | □ |
| 1910 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 旅運中心 | Cruise Terminal | クルーズターミナル | — | □ |
| 1911 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 栗林 | Lilin | 栗林 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1912 | i18n/stations.json systems.thsr_sched | 桃園 | Taoyuan | 桃園 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1913 | i18n/stations.json systems.tra_sched | 桃園 | Taoyuan | 桃園 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1914 | i18n/stations.json systems.tymc；App／Widget／Live Activity Localizable.xcstrings | 桃園體育園區站 | Taoyuan Sports Park Station | 桃園体育園区駅 | — | □ |
| 1915 | i18n/stations.json systems.tymc；App／Widget／Live Activity Localizable.xcstrings | 泰山站 | Taishan Station | 泰山駅 | — | □ |
| 1916 | i18n/stations.json systems.tymc；App／Widget／Live Activity Localizable.xcstrings | 泰山貴和站 | Taishan Guihe Station | 泰山貴和駅 | — | □ |
| 1917 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 泰安 | Tai'an | 泰安 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1918 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 浮洲 | Fuzhou | 浮洲 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1919 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 海山 | Haishan | 海山 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1920 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 海科館 | Haikeguan | 海科館 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1921 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 海端 | Haiduan | 海端 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1922 | i18n/stations.json systems.tmrt；App／Widget／Live Activity Localizable.xcstrings | 烏日 | Wuri | 烏日 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1923 | i18n/stations.json systems.tra_sched | 烏日 | Wuri | 烏日 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1924 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 真愛碼頭 | Love Pier | 真愛埠頭 | — | □ |
| 1925 | i18n/stations.json systems.afr_sched；App／Widget／Live Activity Localizable.xcstrings | 祝山 | Zhushan | 祝山 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1926 | i18n/stations.json systems.afr_sched；App／Widget／Live Activity Localizable.xcstrings | 神木 | Shenmu | 神木 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1927 | i18n/stations.json systems.ntalrt；App／Widget／Live Activity Localizable.xcstrings | 耕莘安康院區 | Cardinal Tien Hospital An Kang Branch | 耕莘安康院区 | — | □ |
| 1928 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 草衙 | Caoya | 草衙 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1929 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 貢寮 | Gongliao | 貢寮 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1930 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 迴龍 | Huilong | 迴龍 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1931 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 追分 | Zhuifen | 追分 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1932 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 馬卡道 | Makadao | 馬卡道 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1933 | i18n/stations.json systems.tra_sched | 高雄 | Kaohsiung | 高雄 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1934 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 高雄車站 | Kaohsiung Main Station | 高雄駅 | — | □ |
| 1935 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 高雄展覽館 | Kaohsiung Exhibition Center | 高雄展覧館 | — | □ |
| 1936 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 高雄高工 | Kaohsiung Industrial High School | 高雄工業高校 | — | □ |
| 1937 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 高雄國際機場 | Kaohsiung International Airport | 高雄国際空港 | — | □ |
| 1938 | i18n/stations.json systems.tymc；App／Widget／Live Activity Localizable.xcstrings | 高鐵桃園站 | Taoyuan HSR Station | 高鉄桃園駅 | — | □ |
| 1939 | i18n/stations.json systems.tmrt；App／Widget／Live Activity Localizable.xcstrings | 高鐵臺中站 | HSR Taichung Station | 高速鉄道台中駅 | — | □ |
| 1940 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 動物園 | Taipei Zoo | 動物園 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1941 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 唭哩岸 | Qilian | 唭哩岸 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1942 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 國父紀念館 | Sun Yat-Sen Memorial Hall | 国父紀念館 | — | □ |
| 1943 | i18n/stations.json systems.sanying；App／Widget／Live Activity Localizable.xcstrings | 國華 | Guohua | 国華 | — | □ |
| 1944 | i18n/stations.json systems.tra_sched | 基隆 | Keelung | 基隆 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1945 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 崇德 | Chongde | 崇徳 | — | □ |
| 1946 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 崎頂 | Qiding | 崎頂 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1947 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 康樂 | Kangle | 康楽 | — | □ |
| 1948 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 望古 | Wanggu | 望古 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1949 | i18n/stations.json systems.afr_sched；App／Widget／Live Activity Localizable.xcstrings | 梨園寮 | Liyuanliao | 梨園寮 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1950 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 淡水 | Tamsui | 淡水 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1951 | i18n/stations.json systems.ntdlrt；App／Widget／Live Activity Localizable.xcstrings | 淡水行政中心 | Tamsui District Office | 淡水行政中心 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1952 | i18n/stations.json systems.ntdlrt；App／Widget／Live Activity Localizable.xcstrings | 淡水漁人碼頭 | Tamsui Fisherman's Wharf | 淡水漁人碼頭 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1953 | i18n/stations.json systems.ntdlrt；App／Widget／Live Activity Localizable.xcstrings | 淡江大學 | Tamkang University | 淡江大学 | — | □ |
| 1954 | i18n/stations.json systems.ntdlrt；App／Widget／Live Activity Localizable.xcstrings | 淡金北新 | Danjin Beixin | 淡金北新 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1955 | i18n/stations.json systems.ntdlrt；App／Widget／Live Activity Localizable.xcstrings | 淡金鄧公 | Danjin Denggong | 淡金鄧公 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1956 | i18n/stations.json systems.ntdlrt；App／Widget／Live Activity Localizable.xcstrings | 淡海新市鎮 | Danhai New Town | 淡海新市鎮 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1957 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 清水 | Qingshui | 清水 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1958 | i18n/stations.json systems.afr_sched；App／Widget／Live Activity Localizable.xcstrings | 第一分道 | 1st-Switch | 第一分道 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1959 | i18n/stations.json systems.afr_sched；App／Widget／Live Activity Localizable.xcstrings | 第二分道 | 2nd-Switch | 第二分道 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1960 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 軟體園區 | Software Technology Park | ソフトウェアパーク | — | □ |
| 1961 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 通霄 | Tongxiao | 通宵 | — | □ |
| 1962 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 造橋 | Zaoqiao | 造橋 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1963 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 都會公園 | Metropolitan Park | 都会公園 | — | □ |
| 1964 | i18n/stations.json systems.sanying；App／Widget／Live Activity Localizable.xcstrings | 陶瓷老街 | Ceramics Old Street | 陶瓷老街 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1965 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 頂埔 | Dingpu | 頂埔 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1966 | i18n/stations.json systems.sanying | 頂埔 | Dingpu | 頂埔 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1967 | i18n/stations.json systems.tra_sched | 頂埔 | Dingpu | 頂埔 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1968 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 頂溪 | Dingxi | 頂渓 | — | □ |
| 1969 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 鹿野 | Luye | 鹿野 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1970 | i18n/stations.json systems.afr_sched；App／Widget／Live Activity Localizable.xcstrings | 鹿麻產 | Lumachan | 鹿麻産 | — | □ |
| 1971 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 凱旋 | Kaisyuan | 凱旋 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1972 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 凱旋二聖站 | Kaisyuan Ersheng | 凱旋二聖 | — | □ |
| 1973 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 凱旋中華 | Kaisyuan Jhonghua | 凱旋中華 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1974 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 凱旋公園站 | Kaisyuan Park | 凱旋公園 | — | □ |
| 1975 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 凱旋武昌站 | Kaisyuan Wuchang | 凱旋武昌 | — | □ |
| 1976 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 凱旋瑞田 | Kaisyuan Rueitian | 凱旋瑞田 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1977 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 善化 | Shanhua | 善化 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1978 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 善導寺 | Shandao Temple | 善導寺 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1979 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 富里 | Fuli | 富里 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1980 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 富岡 | Fugang | 富岡 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1981 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 富貴 | Fugui | 富貴 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1982 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 富源 | Fuyuan | 富源 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1983 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 復興崗 | Fuxinggang | 復興崗 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1984 | i18n/stations.json systems.ntalrt；App／Widget／Live Activity Localizable.xcstrings | 景文科大 | Jinwen University of Science and Technology | 景文科大 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1985 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 景平 | Jingping | 景平 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1986 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 景安 | Jingan | 景安 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1987 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 景美 | Jingmei | 景美 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1988 | i18n/stations.json systems.tra_sched | 景美 | Jingmei | 景美 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1989 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 港墘 | Gangqian | 港墘 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1990 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 湖口 | Hukou | 湖口 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1991 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 猴硐 | Houtong | 侯硐 | — | □ |
| 1992 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 菁桐 | Jingtong | 菁桐 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1993 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 菜寮 | Cailiao | 菜寮 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1994 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 象山 | Xiangshan | 象山 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1995 | i18n/stations.json systems.ntalrt；App／Widget／Live Activity Localizable.xcstrings | 陽光運動公園 | Sunshine Sports Park | 陽光運動公園 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1996 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 隆田 | Longtian | 隆田 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1997 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 集集 | Jiji | 集集 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1998 | i18n/stations.json systems.thsr_sched | 雲林 | Yunlin | 雲林 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 1999 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 圓山 | Yuanshan | 圓山 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2000 | i18n/stations.json systems.sanying；App／Widget／Live Activity Localizable.xcstrings | 媽祖田 | Mazutian | 媽祖田 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2001 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 愛河之心 | Heart of Love River | 愛河之心 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2002 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 新上國小 | Sinshang Elementary School | 新上小学校 | — | □ |
| 2003 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 新北投 | Xinbeitou | 新北投 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2004 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 新北產業園區 | New Taipei Industrial Park | 新北産業園区 | — | □ |
| 2005 | i18n/stations.json systems.tymc；App／Widget／Live Activity Localizable.xcstrings | 新北產業園區站 | New Taipei Industrial Park Station | 新北産業園区駅 | — | □ |
| 2006 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 新左營 | Xinzuoying | 新左営 | — | □ |
| 2007 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 新市 | Xinshi | 新市 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2008 | i18n/stations.json systems.ntdlrt；App／Widget／Live Activity Localizable.xcstrings | 新市一路 | Xinshi 1st Rd. | 新市一路 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2009 | i18n/stations.json systems.thsr_sched | 新竹 | Hsinchu | 新竹 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2010 | i18n/stations.json systems.tra_sched | 新竹 | Hsinchu | 新竹 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2011 | i18n/stations.json systems.ntalrt；App／Widget／Live Activity Localizable.xcstrings | 新和國小 | Xinhe Elementary School | 新和小学校(新和国小) | — | □ |
| 2012 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 新店 | Xindian | 新店 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2013 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 新店區公所 | Xindian District Office | 新店区役所 | — | □ |
| 2014 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 新城 | Xincheng | 新城 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2015 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 新埔 | Xinpu | 新埔 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2016 | i18n/stations.json systems.tra_sched | 新埔 | Xinpu | 新埔 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2017 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 新埔民生 | Xinpu Minsheng | 新埔民生 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2018 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 新烏日 | Xinwuri | 新烏日 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2019 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 新莊 | Xinzhuang | 新荘 | — | □ |
| 2020 | i18n/stations.json systems.tra_sched | 新莊 | Xinzhuang | 新荘 | — | □ |
| 2021 | i18n/stations.json systems.tymc；App／Widget／Live Activity Localizable.xcstrings | 新莊副都心站 | Xinzhuang Fuduxin Station | 新荘副都心駅 | — | □ |
| 2022 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 新富 | Xinfu | 新富 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2023 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 新營 | Xinying | 新営 | — | □ |
| 2024 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 新豐 | Xinfeng | 新豊 | — | □ |
| 2025 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 暖暖 | Nuannuan | 暖暖 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2026 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 楊梅 | Yangmei | 楊梅 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2027 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 楠梓 | Nanzi | 楠梓 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2028 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 楠梓科技園區 | Nanzih Technology Industrial Park | 楠梓テクノロジーパーク | — | □ |
| 2029 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 源泉 | Yuanquan | 源泉 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2030 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 獅甲 | Shihjia | 獅甲 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2031 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 瑞和 | Ruihe | 瑞和 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2032 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 瑞芳 | Ruifang | 瑞芳 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2033 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 瑞源 | Ruiyuan | 瑞源 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2034 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 瑞穗 | Ruisui | 瑞穂 | — | □ |
| 2035 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 萬芳社區 | Wanfang Community | 万芳コミュニティ | — | □ |
| 2036 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 萬芳醫院 | Wanfang Hospital | 万芳病院 | — | □ |
| 2037 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 萬華 | Wanhua | 萬華 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2038 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 萬隆 | Wanlong | 万隆 | — | □ |
| 2039 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 萬榮 | Wanrong | 萬栄 | — | □ |
| 2040 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 經貿園區 | Commerce and Trade Park | 経済貿易パーク | — | □ |
| 2041 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 聖功醫院 | St.Joseph Hospital | 聖功病院(道明中学校) | — | □ |
| 2042 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 葫洲 | Huzhou | 葫洲 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2043 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 路竹 | Luzhu | 路竹 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2044 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 鼓山 | Gushan | 鼓山 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2045 | i18n/stations.json systems.tra_sched | 鼓山 | Gushan | 鼓山 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2046 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 鼓山區公所站 | Gushan District Office | 鼓山区役所 | — | □ |
| 2047 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 嘉北 | Jiabei | 嘉北 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2048 | i18n/stations.json systems.thsr_sched | 嘉義 | Chiayi | 嘉義 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2049 | i18n/stations.json systems.afr_sched | 嘉義 | Chiayi | 嘉義 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2050 | i18n/stations.json systems.tra_sched | 嘉義 | Chiayi | 嘉義 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2051 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 壽山公園站 | Shoushan Park | 寿山公園(金馬賓館現代美術館) | — | □ |
| 2052 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 壽豐 | Shoufeng | 寿豊 | — | □ |
| 2053 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 夢時代 | Dream Mall | 夢時代 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2054 | i18n/stations.json systems.afr_sched；App／Widget／Live Activity Localizable.xcstrings | 對高岳 | Duigaoyue | 対高岳 | — | □ |
| 2055 | i18n/stations.json systems.thsr_sched | 彰化 | Changhua | 彰化 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2056 | i18n/stations.json systems.tra_sched | 彰化 | Changhua | 彰化 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2057 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 榮華 | Ronghua | 栄華 | — | □ |
| 2058 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 漢本 | Hanben | 漢本 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2059 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 福隆 | Fulong | 福隆 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2060 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 精武 | Jingwu | 精武 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2061 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 臺中 | Taichung | 台中 | — | □ |
| 2062 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 臺中港 | Taichung Port | 台中港 | — | □ |
| 2063 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 臺北 | Taipei | 台北 | — | □ |
| 2064 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 臺北-環島 | Taipei Surround Island | 台北サラウンドアイランド | — | □ |
| 2065 | i18n/stations.json systems.sanying；App／Widget／Live Activity Localizable.xcstrings | 臺北大學 | National Taipei University | 台北大学 | — | □ |
| 2066 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 臺東 | Taitung | 台東 | — | □ |
| 2067 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 臺南 | Tainan | 台南 | — | □ |
| 2068 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 臺鐵美術館 | TRA Museum of Fine Arts | 台鉄美術館 | — | □ |
| 2069 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 輔大 | Fu Jen University | 輔仁大学 | — | □ |
| 2070 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 輕軌機廠站 | LRT Depot | LRT車両基地 | — | □ |
| 2071 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 銅鑼 | Tongluo | 銅羅 | — | □ |
| 2072 | i18n/stations.json systems.tymc；App／Widget／Live Activity Localizable.xcstrings | 領航站 | Linghang Station | 領航駅 | — | □ |
| 2073 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 駁二大義 | Dayi Pier-2 | 駁二大義 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2074 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 駁二蓬萊 | Penglai Pier-2 | 駁二蓬萊 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2075 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 鳳山 | Fongshan | 鳳山 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2076 | i18n/stations.json systems.tra_sched | 鳳山 | Fongshan | 鳳山 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2077 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 鳳山西站 | Fongshan West | 鳳山西(高雄市議会) | — | □ |
| 2078 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 鳳山國中 | Fongshan Junior High School | 鳳山中学校 | — | □ |
| 2079 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 鳳林 | Fenglin | 鳳林 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2080 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 鳳鳴 | Fengming | 鳳鳴 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2081 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 劍南路 | Jiannan Rd. | 剣南路 | — | □ |
| 2082 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 劍潭 | Jiantan | 剣潭 | — | □ |
| 2083 | i18n/stations.json systems.afr_sched；App／Widget／Live Activity Localizable.xcstrings | 樟腦寮 | Zhangnaoliao | 樟脳寮 | — | □ |
| 2084 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 潭子 | Tanzi | 潭子 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2085 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 潮州 | Chaozhou | 潮州 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2086 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 衛生局站 | Department of Health | 衛生局 | — | □ |
| 2087 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 衛武營 | Weiwuying | 衛武営 | — | □ |
| 2088 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 談文 | Tanwen | 談文 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2089 | i18n/stations.json systems.afr_sched；App／Widget／Live Activity Localizable.xcstrings | 奮起湖 | Fenqihu | 奮起湖 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2090 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 樹林 | Shulin | 樹林 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2091 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 樹德家商 | Shu-Te Home-Economics &amp; Commercial High School | 樹徳家事商業高校 | — | □ |
| 2092 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 橋和 | Qiaohe | 橋和 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2093 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 橋頭 | Qiaotou | 橋頭 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2094 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 橋頭火車站 | Ciaotou Station | 橋頭駅 | — | □ |
| 2095 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 橋頭糖廠 | Ciaotou Sugar Refinery | 橋頭製糖工場 | — | □ |
| 2096 | i18n/stations.json systems.tymc；App／Widget／Live Activity Localizable.xcstrings | 機場旅館站 | Airport Hotel Station | 空港ホテル駅 | — | □ |
| 2097 | i18n/stations.json systems.tymc；App／Widget／Live Activity Localizable.xcstrings | 機場第一航廈站 | Airport Terminal 1 Station | 空港第1ターミナル駅 | — | □ |
| 2098 | i18n/stations.json systems.tymc；App／Widget／Live Activity Localizable.xcstrings | 機場第二航廈站 | Airport Terminal 2 Station | 空港第2ターミナル駅 | — | □ |
| 2099 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 橫山 | Hengshan | 横山 | — | □ |
| 2100 | i18n/stations.json systems.tymc；App／Widget／Live Activity Localizable.xcstrings | 橫山站 | Hengshan Station | 橫山駅 | — | □ |
| 2101 | i18n/stations.json systems.sanying；App／Widget／Live Activity Localizable.xcstrings | 橫溪 | Hengxi | 横渓 | — | □ |
| 2102 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 濁水 | Zhuoshui | 濁水 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2103 | i18n/stations.json systems.afr_sched；App／Widget／Live Activity Localizable.xcstrings | 獨立山 | Dulishan | 独立山 | — | □ |
| 2104 | i18n/stations.json systems.tymc；App／Widget／Live Activity Localizable.xcstrings | 興南站 | Xingnan Station | 興南駅 | — | □ |
| 2105 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 頭前庄 | Touqianzhuang | 頭前庄 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2106 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 頭城 | Toucheng | 頭城 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2107 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 頭家厝 | Toujiacuo | 頭家厝 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2108 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 龍山寺 | Longshan Temple | 龍山寺 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2109 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 龍井 | Longjing | 龍井 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2110 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 龍泉 | Longquan | 龍泉 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2111 | i18n/stations.json systems.sanying；App／Widget／Live Activity Localizable.xcstrings | 龍埔 | Longpu | 龍埔 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2112 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 龍港 | Longgang | 龍港 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2113 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 龍華國小 | Longhua Elementary School | 龍華小学校 | — | □ |
| 2114 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 龜山 | Guishan | 亀山 | — | □ |
| 2115 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 嶺腳 | Lingjiao | 嶺脚 | — | □ |
| 2116 | i18n/stations.json systems.ntdlrt；App／Widget／Live Activity Localizable.xcstrings | 濱海沙崙 | Binhai Shalun | 浜海沙崙 | — | □ |
| 2117 | i18n/stations.json systems.ntdlrt；App／Widget／Live Activity Localizable.xcstrings | 濱海義山 | Binhai Yishan | 浜海義山 | — | □ |
| 2118 | i18n/stations.json systems.tymc；App／Widget／Live Activity Localizable.xcstrings | 環北站 | Huanbei Station | 環北駅 | — | □ |
| 2119 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 礁溪 | Jiaoxi | 礁渓 | — | □ |
| 2120 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 聯合醫院 | Kaohsiung Municipal United Hospital | 聯合病院 | — | □ |
| 2121 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 歸來 | Guilai | 帰来 | — | □ |
| 2122 | i18n/stations.json systems.tmrt；App／Widget／Live Activity Localizable.xcstrings | 舊社 | Jiushe | 旧社 | — | □ |
| 2123 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 豐田 | Fengtian | 豊田 | — | □ |
| 2124 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 豐原 | Fengyuan | 豊原 | — | □ |
| 2125 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 豐富 | Fengfu | 豊富 | — | □ |
| 2126 | i18n/stations.json systems.tmrt；App／Widget／Live Activity Localizable.xcstrings | 豐樂公園 | Feng-le Park | 豊楽公園 | — | □ |
| 2127 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 鎮安 | Zhen'an | 鎮安 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2128 | i18n/stations.json systems.ntalrt；App／Widget／Live Activity Localizable.xcstrings | 雙城 | Shuangcheng | 双城 | — | □ |
| 2129 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 雙連 | Shuanglian | 双連 | — | □ |
| 2130 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 雙溪 | Shuangxi | 双渓 | — | □ |
| 2131 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 瀧溪 | Longxi | 瀧渓 | — | □ |
| 2132 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 羅東 | Luodong | 羅東 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2133 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 關山 | Guanshan | 関山 | — | □ |
| 2134 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 關渡 | Guandu | 関渡 | — | □ |
| 2135 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 蘆洲 | Luzhou | 蘆洲 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2136 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 蘇澳 | Su'ao | 蘇澳 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2137 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 蘇澳新 | Su'aoxin | 蘇澳新 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2138 | i18n/stations.json systems.sanying；App／Widget／Live Activity Localizable.xcstrings | 鶯桃福德 | Yingtao Fude | 鶯桃福徳 | — | □ |
| 2139 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 鶯歌 | Yingge | 鶯歌 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2140 | i18n/stations.json systems.sanying；App／Widget／Live Activity Localizable.xcstrings | 鶯歌車站 | Yingge Station | 鶯歌駅 | — | □ |
| 2141 | i18n/stations.json systems.tymc；App／Widget／Live Activity Localizable.xcstrings | 體育大學站 | National Taiwan Sport University Station | 体育大学駅 | — | □ |
| 2142 | i18n/stations.json systems.mrt；App／Widget／Live Activity Localizable.xcstrings | 麟光 | Linguang | 麟光 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2143 | i18n/stations.json systems.tra_sched；App／Widget／Live Activity Localizable.xcstrings | 麟洛 | Linluo | 麟洛 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2144 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 鹽埕埔 | Yanchengpu | 塩埕埔 | — | □ |
| 2145 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 灣仔內(大順鼎山) | Wanzihnei(Dashun Dingshan) | 湾仔內(大順鼎山) | — | □ |
| 2146 | i18n/stations.json systems.krtc；App／Widget／Live Activity Localizable.xcstrings | 籬仔內 | Lizihnei | 籬仔內 | JA 沿用繁中，請確認是否為正式漢字 | □ |

## 路線名（19 筆）

| # | 來源 | 繁中原文 | English | 日本語 | 自動提示 | 複核 |
|---:|---|---|---|---|---|:---:|
| 2147 | i18n/stations.json routes.sanying | 三鶯線 | Sanying Line | 三鶯線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2148 | i18n/stations.json routes.mrt；App／Widget／Live Activity Localizable.xcstrings | 中和新蘆線 | Zhonghe-Xinlu Line | 中和新蘆線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2149 | i18n/stations.json routes.mrt；App／Widget／Live Activity Localizable.xcstrings | 文湖線 | Wenhu Line | 文湖線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2150 | i18n/stations.json routes.afr_sched；App／Widget／Live Activity Localizable.xcstrings | 本線(嘉義-阿里山) | Main Line(Chiayi-Alishan) | 本線(嘉義-阿里山) | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2151 | i18n/stations.json routes.ntalrt；App／Widget／Live Activity Localizable.xcstrings | 安坑輕軌 | Ankeng LRT | 安坑ライトレール | — | □ |
| 2152 | i18n/stations.json routes.mrt；App／Widget／Live Activity Localizable.xcstrings | 松山新店線 | Songshan-Xindian Line | 松山新店線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2153 | i18n/stations.json routes.mrt；App／Widget／Live Activity Localizable.xcstrings | 板南線 | Bannan Line | 板南線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2154 | i18n/stations.json routes.afr_sched | 沼平線 | Zhaoping Line | 沼平線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2155 | i18n/stations.json routes.krtc；App／Widget／Live Activity Localizable.xcstrings | 紅線 | Red Line | 赤線 | — | □ |
| 2156 | i18n/stations.json routes.tymc；App／Widget／Live Activity Localizable.xcstrings | 桃園機場捷運線 | Airport MRT Line | 桃園空港MRT | — | □ |
| 2157 | i18n/stations.json routes.tmrt；App／Widget／Live Activity Localizable.xcstrings | 烏日文心北屯線 | Wuriwenxin  Beitun Line | 烏日文心北屯線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2158 | i18n/stations.json routes.afr_sched | 祝山線 | Zhushan Line | 祝山線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2159 | i18n/stations.json routes.afr_sched；App／Widget／Live Activity Localizable.xcstrings | 神木線 | Shenmu Line | 神木線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2160 | i18n/stations.json routes.thsr_sched | 高鐵 | Taiwan High Speed Rail | 台湾高速鉄道 | — | □ |
| 2161 | i18n/stations.json routes.mrt；App／Widget／Live Activity Localizable.xcstrings | 淡水信義線 | Tamsui-Xinyi Line | 淡水信義線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2162 | i18n/stations.json routes.ntdlrt；App／Widget／Live Activity Localizable.xcstrings | 淡海輕軌 | Danhai LRT | 淡海ライトレール | — | □ |
| 2163 | i18n/stations.json routes.krtc；App／Widget／Live Activity Localizable.xcstrings | 橘線 | Orange Line | オレンジ線 | — | □ |
| 2164 | i18n/stations.json routes.krtc；App／Widget／Live Activity Localizable.xcstrings | 環狀輕軌 | Circular Light Rail | ライトレール | — | □ |
| 2165 | i18n/stations.json routes.mrt；App／Widget／Live Activity Localizable.xcstrings | 環狀線 | Circular Line | 環状線 | — | □ |

## 列車種類（10 筆）

| # | 來源 | 繁中原文 | English | 日本語 | 自動提示 | 複核 |
|---:|---|---|---|---|---|:---:|
| 2166 | i18n/stations.json trainTypes；App／Widget／Live Activity Localizable.xcstrings | 自強 | Tze-Chiang Limited Express | 自強号 | — | □ |
| 2167 | i18n/stations.json trainTypes；App／Widget／Live Activity Localizable.xcstrings | 其他 | Other | その他 | — | □ |
| 2168 | i18n/stations.json trainTypes | 沼平線 | Zhaoping Line | 沼平線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2169 | i18n/stations.json trainTypes | 阿里山號 | Alishan Express | 阿里山号 | — | □ |
| 2170 | i18n/stations.json trainTypes | 祝山線 | Zhushan Line | 祝山線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2171 | i18n/stations.json trainTypes | 神木線 | Shenmu Line | 神木線 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2172 | i18n/stations.json trainTypes；App／Widget／Live Activity Localizable.xcstrings | 高鐵 | High Speed Rail | 高速鉄道 | — | □ |
| 2173 | i18n/stations.json trainTypes；App／Widget／Live Activity Localizable.xcstrings | 區間快 | Fast Local | 区間快速 | — | □ |
| 2174 | i18n/stations.json trainTypes；App／Widget／Live Activity Localizable.xcstrings | 區間車 | Local Train | 区間車 | — | □ |
| 2175 | i18n/stations.json trainTypes；App／Widget／Live Activity Localizable.xcstrings | 莒光/復興 | Chu-Kuang / Fu-Hsing | 莒光号／復興号 | — | □ |

## App、Widget 與 Live Activity 專用文字（172 筆）

| # | 來源 | 繁中原文 | English | 日本語 | 自動提示 | 複核 |
|---:|---|---|---|---|---|:---:|
| 2176 | Localizable.xcstrings | · 下一班即將進站 | · Next train arriving soon | ・次の列車がまもなく到着 | — | □ |
| 2177 | Localizable.xcstrings | · 下一班進站 | · Next train arriving | ・次の列車が到着 | — | □ |
| 2178 | Localizable.xcstrings | · 今天最後一班 | · Last train today | ・本日の最終列車 | — | □ |
| 2179 | Localizable.xcstrings | · 再 {n} 分 | · Another in {n} min | ・次は{n}分後 | — | □ |
| 2180 | Localizable.xcstrings | · 再約 {n} 分 | · Another in about {n} min | ・次は約{n}分後 | — | □ |
| 2181 | Localizable.xcstrings | · 往 {station} | · To {station} | ・{station}方面 | — | □ |
| 2182 | Localizable.xcstrings | · 通過 | · Passing | ・通過 | — | □ |
| 2183 | Localizable.xcstrings | · 誤點 {n} 分 | · {n} min late | ・{n}分遅れ | — | □ |
| 2184 | Localizable.xcstrings | {line} · {n} 班 | {line} · {n} trains | {line}・{n}本 | — | □ |
| 2185 | Localizable.xcstrings | {line} · 往{station} | {line} · To {station} | {line}・{station}方面 | — | □ |
| 2186 | Localizable.xcstrings | {n} 分 | {n} min | {n}分 | — | □ |
| 2187 | Localizable.xcstrings | {n} 分  | {n} min  | {n}分 | — | □ |
| 2188 | Localizable.xcstrings | {n} 秒 | {n} sec | {n}秒 | — | □ |
| 2189 | Localizable.xcstrings | {n} 班 | {n} trains | {n}本 | — | □ |
| 2190 | Localizable.xcstrings | {n} 班奔跑中 | {n} trains running | {n}本運行中 | — | □ |
| 2191 | Localizable.xcstrings | {n} 條線 | {n} routes | {n}路線 | — | □ |
| 2192 | Localizable.xcstrings | {scheduled} {action} → {effective} | {scheduled} {action} → {effective} | {scheduled} {action} → {effective} | EN 沿用繁中，請確認；JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2193 | Localizable.xcstrings | {station} {time} 到 | {station} · arrived {time} | {station} {time}到着 | — | □ |
| 2194 | Localizable.xcstrings | {station} 車應已到 | Train should have arrived at {station} | {station}に到着した見込み | — | □ |
| 2195 | Localizable.xcstrings | {station} 進站中 | {station} arriving | {station}に到着中 | — | □ |
| 2196 | Localizable.xcstrings | {time} {action} | {time} {action} | {time} {action} | EN 沿用繁中，請確認；JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2197 | Localizable.xcstrings | {time} {suffix} | {time} {suffix} | {time} {suffix} | EN 沿用繁中，請確認；JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2198 | Localizable.xcstrings | {time} 更新 | Updated {time} | {time}更新 | — | □ |
| 2199 | Localizable.xcstrings | {time} 抵達 | Arrives {time} | {time}到着 | — | □ |
| 2200 | Localizable.xcstrings | {trainNo} 次 往 {station} | Train {trainNo} to {station} | {trainNo}列車・{station}方面 | — | □ |
| 2201 | Localizable.xcstrings | ⚠ 資料中斷・位置為預估 | ⚠ Data interrupted · position estimated | ⚠ データ中断・位置は推定 | — | □ |
| 2202 | Localizable.xcstrings | 1.5 公里內 {n} 條路線 | {n} routes within 1.5 km | 1.5km以内に{n}路線 | — | □ |
| 2203 | Localizable.xcstrings | 1.5 公里內沒有台鐵或高鐵路線 | No TRA or HSR route within 1.5 km | 1.5km以内に台湾鉄路・高鉄の路線はありません | — | □ |
| 2204 | Localizable.xcstrings | 1.5 公里內沒有路線 | No routes within 1.5 km | 1.5km以内に路線はありません | — | □ |
| 2205 | Localizable.xcstrings | 60 分鐘內無車 | No trains within 60 minutes | 60分以内に列車はありません | — | □ |
| 2206 | Localizable.xcstrings | 上次 {time} 更新 | Last updated {time} | 前回更新{time} | — | □ |
| 2207 | Localizable.xcstrings | 下一班 | Next | 次の列車 | — | □ |
| 2208 | Localizable.xcstrings | 下一班會自動接上 | The next train will update automatically | 次の列車へ自動で切り替わります | — | □ |
| 2209 | Localizable.xcstrings | 今天沒有列車經過 | No trains pass here today | 本日は列車が通過しません | — | □ |
| 2210 | Localizable.xcstrings | 今天沒有更晚的班次了 | No later trains today | 本日はこれ以降の列車がありません | — | □ |
| 2211 | Localizable.xcstrings | 今天最後一班 | Last train today | 本日の最終列車 | — | □ |
| 2212 | Localizable.xcstrings | 分 | min | 分 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2213 | Localizable.xcstrings | 方向（可留空） | Direction (optional) | 方向（任意） | — | □ |
| 2214 | Localizable.xcstrings | 方向（與下面的條件同時成立） | Direction (combined with the filters below) | 方向（以下の条件と同時に適用） | — | □ |
| 2215 | Localizable.xcstrings | 北上 | Northbound | 北行 | — | □ |
| 2216 | Localizable.xcstrings | 卡片不會自己接下一班，要看後續請回軌島重開 | This card will not advance automatically. Reopen it in Rail Island for later trains. | このカードは次の列車へ自動更新されません。続きは軌島で開き直してください。 | — | □ |
| 2217 | Localizable.xcstrings | 另 {n} 班 | {n} more | ほか{n}本 | — | □ |
| 2218 | Localizable.xcstrings | 只看這些（可留空） | Filters (optional) | 表示条件（任意） | — | □ |
| 2219 | Localizable.xcstrings | 只顯示有直達列車的車站 | Only stations with a direct train are shown | 直通列車のある駅のみ表示 | — | □ |
| 2220 | Localizable.xcstrings | 台鐵／高鐵 | TRA / HSR | 台湾鉄路／高鉄 | — | □ |
| 2221 | Localizable.xcstrings | 台鐵／高鐵起站 | TRA / HSR origin | 台湾鉄路／高鉄の出発駅 | — | □ |
| 2222 | Localizable.xcstrings | 台灣高鐵 | Taiwan High Speed Rail | 台湾高鉄 | — | □ |
| 2223 | Localizable.xcstrings | 未來 60 分鐘沒有列車 | No trains in the next 60 minutes | 今後60分間に列車はありません | — | □ |
| 2224 | Localizable.xcstrings | 未標示 | Not shown | 表示なし | — | □ |
| 2225 | Localizable.xcstrings | 末 | Last | 終 | — | □ |
| 2226 | Localizable.xcstrings | 末班 {time} | Last train {time} | 終電 {time} | — | □ |
| 2227 | Localizable.xcstrings | 末班車 | Last train | 最終列車 | — | □ |
| 2228 | Localizable.xcstrings | 正在讀取起站，先列出全部車站 | Reading the origin; showing all stations for now | 出発駅を読み込み中のため全駅を表示します | — | □ |
| 2229 | Localizable.xcstrings | 目的站（可留空） | Destination (optional) | 目的地（任意） | — | □ |
| 2230 | Localizable.xcstrings | 目前 | Current | 現在 | — | □ |
| 2231 | Localizable.xcstrings | 目前無即時誤點資訊 | No live delay information | 現在、リアルタイムの遅延情報はありません | — | □ |
| 2232 | Localizable.xcstrings | 共 {n} 站符合 | {n} stations found | {n}駅が見つかりました | — | □ |
| 2233 | Localizable.xcstrings | 共站（台鐵＋高鐵一起看） | Shared station (TRA + HSR) | 共用駅（台湾鉄路＋高鉄） | — | □ |
| 2234 | Localizable.xcstrings | 共站看板不看目的站，這格可留空 | Shared-station boards do not use a destination; leave this blank | 共用駅案内では目的地を使わないため空欄にできます | — | □ |
| 2235 | Localizable.xcstrings | 再下一班 往 {station} | Following train to {station} | 次々発は{station}方面 | — | □ |
| 2236 | Localizable.xcstrings | 再加一站 | Add another station | 別の駅を追加 | — | □ |
| 2237 | Localizable.xcstrings | 同一張卡查看台鐵／高鐵發車與捷運進站倒數。 | See TRA/HSR departures and metro arrival countdowns on one card. | 1枚のカードで台湾鉄路・高鉄の発車とメトロ到着カウントダウンを確認します。 | — | □ |
| 2238 | Localizable.xcstrings | 同一張卡看台鐵／高鐵發車與捷運進站倒數。 | TRA/HSR departures and metro countdowns on one card. | 台湾鉄路・高鉄の発車とメトロ到着カウントダウンを1枚で表示します。 | — | □ |
| 2239 | Localizable.xcstrings | 早到 {n} 分 | {n} min early | {n}分早着 | — | □ |
| 2240 | Localizable.xcstrings | 自動（最近的站） | Automatic (nearest station) | 自動（最寄り駅） | — | □ |
| 2241 | Localizable.xcstrings | 自動選站 | Automatic station | 駅を自動選択 | — | □ |
| 2242 | Localizable.xcstrings | 自動選最近的站是通行證功能。點一下開啟軌島看方案，或改選一個固定車站。 | Automatic nearest-station selection requires a Rail Island Pass. Tap to view plans, or choose a fixed station. | 最寄り駅の自動選択には軌島パスが必要です。タップしてプランを見るか、固定駅を選んでください。 | — | □ |
| 2243 | Localizable.xcstrings | 免費版可設定一站。點一下開啟軌島，用通行證解鎖多站。 | The free version supports one station. Tap to open Rail Island and unlock more with a pass. | 無料版では1駅を設定できます。軌島を開き、パスで複数駅を利用できます。 | — | □ |
| 2244 | Localizable.xcstrings | 免費版可設定一站（目前是「{station}」）。點一下開啟軌島，用通行證解鎖多站。 | The free version supports one station (currently “{station}”). Tap to unlock more with a pass. | 無料版では1駅を設定できます（現在は「{station}」）。パスで複数駅を利用できます。 | — | □ |
| 2245 | Localizable.xcstrings | 我的地點 | My places | 保存した場所 | — | □ |
| 2246 | Localizable.xcstrings | 找不到這個車站，請重新設定 | Station not found; please configure it again | 駅が見つかりません。再設定してください | — | □ |
| 2247 | Localizable.xcstrings | 系統 | System | システム | — | □ |
| 2248 | Localizable.xcstrings | 車次 | Train number | 列車番号 | — | □ |
| 2249 | Localizable.xcstrings | 車站 | Station | 駅 | — | □ |
| 2250 | Localizable.xcstrings | 車種 | Train type | 列車種別 | — | □ |
| 2251 | Localizable.xcstrings | 依 {date}（同週{weekday}）班表 · 請更新軌島 | Using the {date} timetable (same weekday) · update Rail Island | {date}（同じ曜日）の時刻表を使用・軌島を更新してください | 英文插值變數不一致；日文插值變數不一致 | □ |
| 2252 | Localizable.xcstrings | 官方目前沒有這一站的班次資訊 | No official service information is currently available for this station | この駅の公式列車情報は現在ありません | — | □ |
| 2253 | Localizable.xcstrings | 定位 | Location | 位置情報 | — | □ |
| 2254 | Localizable.xcstrings | 宜蘭縣 | Yilan County | 宜蘭県 | — | □ |
| 2255 | Localizable.xcstrings | 往 {station} 方向 | Toward {station} | {station}方面 | — | □ |
| 2256 | Localizable.xcstrings | 所選班次近期沒有行駛 | The selected service does not run in the current period | 選択した列車は当面運行しません | — | □ |
| 2257 | Localizable.xcstrings | 抵 | Arr. | 着 | — | □ |
| 2258 | Localizable.xcstrings | 抵 {time}{nextDay} | Arr. {time}{nextDay} | {time}{nextDay}着 | — | □ |
| 2259 | Localizable.xcstrings | 明天 | Tomorrow | 明日 | — | □ |
| 2260 | Localizable.xcstrings | 明天 {value} | Tomorrow {value} | 明日 {value} | — | □ |
| 2261 | Localizable.xcstrings | 花蓮縣 | Hualien County | 花蓮県 | — | □ |
| 2262 | Localizable.xcstrings | 表定 | Scheduled | 予定 | — | □ |
| 2263 | Localizable.xcstrings | 表定 {time} | Scheduled {time} | 予定 {time} | — | □ |
| 2264 | Localizable.xcstrings | 南下 | Southbound | 南行 | — | □ |
| 2265 | Localizable.xcstrings | 南投縣 | Nantou County | 南投県 | — | □ |
| 2266 | Localizable.xcstrings | 屏東縣 | Pingtung County | 屏東県 | — | □ |
| 2267 | Localizable.xcstrings | 查看台鐵或高鐵接下來的直達、停靠、終到與通過列車。 | See upcoming direct, stopping, terminating and passing TRA or HSR trains. | 台湾鉄路・高鉄の直通、停車、終着、通過列車を表示します。 | — | □ |
| 2268 | Localizable.xcstrings | 查無直達班次 | No direct trains found | 直通列車がありません | — | □ |
| 2269 | Localizable.xcstrings | 秒 | sec | 秒 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2270 | Localizable.xcstrings | 約 | about | 約 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2271 | Localizable.xcstrings | 約 {n} 分 | about {n} min | 約{n}分 | — | □ |
| 2272 | Localizable.xcstrings | 苗栗縣 | Miaoli County | 苗栗県 | — | □ |
| 2273 | Localizable.xcstrings | 桃園市 | Taoyuan City | 桃園市 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2274 | Localizable.xcstrings | 桃園機場捷運 | Taoyuan Airport MRT | 桃園空港MRT | — | □ |
| 2275 | Localizable.xcstrings | 班表只到 {date} · 請更新軌島 | Timetable ends {date} · update Rail Island | 時刻表は{date}までです・軌島を更新してください | — | □ |
| 2276 | Localizable.xcstrings | 班表準備中，先列出全部車站 | Timetable is loading; showing all stations | 時刻表の準備中は全駅を表示します | — | □ |
| 2277 | Localizable.xcstrings | 留空＝兩個方向都看 | Leave blank to show both directions | 空欄の場合は両方向を表示 | — | □ |
| 2278 | Localizable.xcstrings | 留空就是全部都看 | Leave blank to show all | 空欄の場合はすべて表示 | — | □ |
| 2279 | Localizable.xcstrings | 起站 | Origin | 出発駅 | — | □ |
| 2280 | Localizable.xcstrings | 起訖站清單依縣市由北到南分段，最上面可以直接選你在軌島存過的地點。目的站可留空，以查看所有停靠、終到與通過列車；起站選共站或我的地點時，請用「只看這些」依方向、車種或車次篩選。 | Origins and destinations are grouped north to south, with your saved places first. Leave the destination blank to show all stopping, terminating and passing trains. For a shared station or saved place, use Filters to narrow by direction, train type or number. | 出発駅と目的地は北から南へ地域別に表示され、保存した場所が先頭に並びます。目的地を空欄にすると停車・終着・通過列車をすべて表示します。共用駅や保存場所では「表示条件」で方向・列車種別・列車番号を絞り込めます。 | — | □ |
| 2281 | Localizable.xcstrings | 追蹤目標 | Tracking target | 追跡対象 | — | □ |
| 2282 | Localizable.xcstrings | 追蹤至 {time} | Tracking until {time} | {time}まで追跡 | — | □ |
| 2283 | Localizable.xcstrings | 追蹤到此結束，卡片會自動關閉 | Tracking has ended; this card will close automatically | 追跡は終了しました。このカードは自動で閉じます | — | □ |
| 2284 | Localizable.xcstrings | 追蹤這一站的車 | Track trains at this station | この駅の列車を追跡 | — | □ |
| 2285 | Localizable.xcstrings | 高雄市 | Kaohsiung City | 高雄市 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2286 | Localizable.xcstrings | 停靠 | Stopped | 停車 | — | □ |
| 2287 | Localizable.xcstrings | 停靠中 | At station | 停車中 | — | □ |
| 2288 | Localizable.xcstrings | 基隆市 | Keelung City | 基隆市 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2289 | Localizable.xcstrings | 捷運 · 自動選站 | Metro · Auto station | メトロ・駅を自動選択 | — | □ |
| 2290 | Localizable.xcstrings | 捷運 · 倒數 | Metro · Countdown | メトロ・到着まで | — | □ |
| 2291 | Localizable.xcstrings | 捷運方向（可留空） | Metro direction (optional) | メトロ方向（任意） | — | □ |
| 2292 | Localizable.xcstrings | 捷運系統 | Metro system | メトロ事業者 | — | □ |
| 2293 | Localizable.xcstrings | 捷運看板 | Metro board | メトロ到着案内 | — | □ |
| 2294 | Localizable.xcstrings | 捷運站 | Metro station | メトロ駅 | — | □ |
| 2295 | Localizable.xcstrings | 略擠 | Crowded | やや混雑 | — | □ |
| 2296 | Localizable.xcstrings | 終到本站 | Terminates here | 当駅止まり | — | □ |
| 2297 | Localizable.xcstrings | 終點 | Terminus | 終点 | — | □ |
| 2298 | Localizable.xcstrings | 這個地點附近今天沒有更晚的班次 | No later trains near this place today | この場所の周辺では本日これ以降の列車がありません | — | □ |
| 2299 | Localizable.xcstrings | 通過 | Passing | 通過 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2300 | Localizable.xcstrings | 通過 · 往{station} | Passing · To {station} | 通過・{station}方面 | — | □ |
| 2301 | Localizable.xcstrings | 通過不停靠 | Passes without stopping | 通過（停車しません） | — | □ |
| 2302 | Localizable.xcstrings | 連不上官方資料，稍後自動再試 | Cannot reach official data; retrying automatically | 公式データに接続できません。自動で再試行します | — | □ |
| 2303 | Localizable.xcstrings | 最上面是你存過的地點與共站，往下依縣市排 | Saved places and shared stations appear first, followed by counties and cities | 保存した場所と共用駅が先頭、その下に地域別で表示されます | — | □ |
| 2304 | Localizable.xcstrings | 普通 | Moderate | 普通 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2305 | Localizable.xcstrings | 發車看板 | Departure board | 発車案内 | — | □ |
| 2306 | Localizable.xcstrings | 結束 | End | 終了 | — | □ |
| 2307 | Localizable.xcstrings | 結束等車追蹤 | End station tracking | 駅の追跡を終了 | — | □ |
| 2308 | Localizable.xcstrings | 舒適 | Comfortable | 快適 | — | □ |
| 2309 | Localizable.xcstrings | 進站 | Arriving | 到着 | — | □ |
| 2310 | Localizable.xcstrings | 開 | Dep. | 発 | — | □ |
| 2311 | Localizable.xcstrings | 開啟 App 一次，或到「設定 › 軌島」允許取用位置 | Open the app once, or allow location access in Settings › Rail Island | Appを一度開くか、「設定 › 軌島」で位置情報を許可してください | — | □ |
| 2312 | Localizable.xcstrings | 開啟軌島以載入附近路線 | Open Rail Island to load nearby routes | 軌島を開いて周辺路線を読み込んでください | — | □ |
| 2313 | Localizable.xcstrings | 開啟軌島以載入班表 | Open Rail Island to load the timetable | 軌島を開いて時刻表を読み込んでください | — | □ |
| 2314 | Localizable.xcstrings | 開啟軌島更新附近路線 | Open Rail Island to refresh nearby routes | 軌島を開いて周辺路線を更新してください | — | □ |
| 2315 | Localizable.xcstrings | 開啟設定 | Open Settings | 設定を開く | — | □ |
| 2316 | Localizable.xcstrings | 雲林縣 | Yunlin County | 雲林県 | — | □ |
| 2317 | Localizable.xcstrings | 新北市 | New Taipei City | 新北市 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2318 | Localizable.xcstrings | 新竹市 | Hsinchu City | 新竹市 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2319 | Localizable.xcstrings | 新竹縣 | Hsinchu County | 新竹県 | — | □ |
| 2320 | Localizable.xcstrings | 經過 | Passing | 通過 | — | □ |
| 2321 | Localizable.xcstrings | 資料中斷・位置為預估 | Data interrupted · position estimated | データ中断・位置は推定 | — | □ |
| 2322 | Localizable.xcstrings | 資料未更新 | Data not updated | データ未更新 | — | □ |
| 2323 | Localizable.xcstrings | 資料時刻 {time} | Data updated at {time} | データ時刻 {time} | — | □ |
| 2324 | Localizable.xcstrings | 資料過舊，打開軌島即更新 | Data is stale; open Rail Island to refresh | データが古いため軌島を開いて更新してください | — | □ |
| 2325 | Localizable.xcstrings | 隔日 |  next day |  翌日 | — | □ |
| 2326 | Localizable.xcstrings | 嘉義市 | Chiayi City | 嘉義市 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2327 | Localizable.xcstrings | 嘉義縣 | Chiayi County | 嘉義県 | — | □ |
| 2328 | Localizable.xcstrings | 實際約 | Est. actual | 実到着見込 | — | □ |
| 2329 | Localizable.xcstrings | 彰化縣 | Changhua County | 彰化県 | — | □ |
| 2330 | Localizable.xcstrings | 臺中市 | Taichung City | 台中市 | — | □ |
| 2331 | Localizable.xcstrings | 臺北市 | Taipei City | 台北市 | — | □ |
| 2332 | Localizable.xcstrings | 臺北捷運 | Taipei Metro | 台北メトロ | — | □ |
| 2333 | Localizable.xcstrings | 臺東縣 | Taitung County | 台東県 | — | □ |
| 2334 | Localizable.xcstrings | 臺南市 | Tainan City | 台南市 | — | □ |
| 2335 | Localizable.xcstrings | 臺鐵・高鐵 · {name} | TRA / HSR · {name} | 台湾鉄路・高鉄・{name} | — | □ |
| 2336 | Localizable.xcstrings | 臺鐵・高鐵 · 時刻 | TRA / HSR · Times | 台湾鉄路・高鉄・時刻 | — | □ |
| 2337 | Localizable.xcstrings | 臺鐵・高鐵 · 經過 | TRA / HSR · Passing | 台湾鉄路・高鉄・通過 | — | □ |
| 2338 | Localizable.xcstrings | 誤點分鐘不會自己更新，要看最新請回軌島 | Delay minutes will not update automatically; return to Rail Island for the latest information | 遅延時分は自動更新されません。最新情報は軌島で確認してください | — | □ |
| 2339 | Localizable.xcstrings | 誤點資訊已過期 | Delay information expired | 遅延情報は期限切れです | — | □ |
| 2340 | Localizable.xcstrings | 暫無資料 | No data | データなし | — | □ |
| 2341 | Localizable.xcstrings | 請選擇車站 | Choose a station | 駅を選択 | — | □ |
| 2342 | Localizable.xcstrings | 請選擇起站 | Choose an origin | 出発駅を選択 | — | □ |
| 2343 | Localizable.xcstrings | 擁擠 | Very crowded | 混雑 | — | □ |
| 2344 | Localizable.xcstrings | 選一個捷運站，看下一班還有多久。 | Choose a metro station and see when the next train arrives. | メトロ駅を選んで次の列車までの時間を確認します。 | — | □ |
| 2345 | Localizable.xcstrings | 縱貫線北段 | Western Trunk Line (North Section) | 縦貫線北段 | — | □ |
| 2346 | Localizable.xcstrings | 還有 {n} 分 | {n} min | あと{n}分 | — | □ |
| 2347 | Localizable.xcstrings | 鐵路＋捷運看板 | Rail + metro board | 鉄道＋メトロ案内 | — | □ |

## iOS 系統權限與 App 名稱（3 筆）

| # | 來源 | 繁中原文 | English | 日本語 | 自動提示 | 複核 |
|---:|---|---|---|---|---|:---:|
| 2348 | InfoPlist.xcstrings：CFBundleDisplayName | 軌島 | Rail Island | 軌島 | JA 沿用繁中，請確認是否為正式漢字 | □ |
| 2349 | InfoPlist.xcstrings：NSLocationAlwaysAndWhenInUseUsageDescription | 軌島只在你使用 App 時持續更新藍點、所在地鏡頭與附近車站。App 進入背景或鎖屏就停止定位，也不會要求「永遠允許」；原始座標只在裝置內使用，不會上傳，拒絕授權仍可手動探索地圖。 | Rail Island accesses location only while you use the app, to move the map near you and show nearby stations and trains. It does not track you continuously in the background or request Always access. Raw coordinates stay on your device and are not uploaded; you can still explore manually if you decline. | 軌島はAppの使用中だけ位置情報を取得し、現在地付近へ地図を移動して周辺の駅と列車を表示します。バックグラウンドで継続的に追跡せず、「常に許可」も要求しません。座標は端末内だけで使用し、アップロードしません。許可しなくても手動で利用できます。 | — | □ |
| 2350 | InfoPlist.xcstrings：NSLocationWhenInUseUsageDescription | 軌島會在你使用 App 時持續更新地圖上的藍點與所在地鏡頭，並列出附近車站與列車。App 進入背景或鎖屏就停止定位；原始座標只在裝置內使用，不會上傳，拒絕授權仍可手動探索地圖。 | Rail Island uses your location while the app is open to move the map near you and show nearby stations and trains. Raw coordinates stay on your device and are not uploaded. You can still explore the map manually if you decline. | 軌島はAppの使用中、現在地付近へ地図を移動し、周辺の駅と列車を表示するために位置情報を使います。取得した座標は端末内だけで使用し、アップロードしません。許可しなくても地図を手動で利用できます。 | — | □ |

