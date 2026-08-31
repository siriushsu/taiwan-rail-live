#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const context = vm.createContext({ window: {} });
for (const rel of ['i18n/translations.js', 'i18n/content-translations.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), context, { filename: rel });
}

const web = context.window.RAIL_I18N_MESSAGES;
if (!web?.en || !web?.ja) throw new Error('找不到網站 en／ja 字典');
const entries = new Map();
// 網站 runtime 可依 Intl.PluralRules 選 one／other；原生這份目錄由 RailNativeL10n 做純文字
// 插值，不能把物件 String() 成「[object Object]」。原生目前沒有使用這幾個複數型網站 key，
// 仍取 other 作安全目錄值；相同字串的原生專用短格式會在下方 native 表覆寫。
const nativeString = value => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return value.other ?? value.one ?? Object.values(value).find(item => typeof item === 'string') ?? '';
  return value == null ? '' : String(value);
};
const add = (source, en, ja) => {
  if (!source || !en || !ja) return;
  entries.set(String(source), { en: nativeString(en), ja: nativeString(ja) });
};
for (const source of new Set([...Object.keys(web.en), ...Object.keys(web.ja)])) {
  add(source, web.en[source], web.ja[source]);
}

const stationCatalog = JSON.parse(fs.readFileSync(path.join(root, 'i18n/stations.json'), 'utf8'));
for (const system of Object.values(stationCatalog.systems || {})) {
  for (const [source, value] of Object.entries(system || {})) add(source, value.en, value.ja);
}
for (const system of Object.values(stationCatalog.routes || {})) {
  for (const [source, value] of Object.entries(system || {})) add(source, value.en, value.ja);
}
for (const [source, value] of Object.entries(stationCatalog.trainTypes || {})) add(source, value.en, value.ja);

// 原生專用字串。動態句一律使用 {name} 插值，由 RailNativeL10n 在顯示前安全替換。
const native = {
  '追蹤這一站的車': ['Track trains at this station', 'この駅の列車を追跡'],
  '結束等車追蹤': ['End station tracking', '駅の追跡を終了'],
  '追蹤目標': ['Tracking target', '追跡対象'],
  '捷運看板': ['Metro board', 'メトロ到着案内'],
  '選一個捷運站，看下一班還有多久。': ['Choose a metro station and see when the next train arrives.', 'メトロ駅を選んで次の列車までの時間を確認します。'],
  '系統': ['System', 'システム'], '車站': ['Station', '駅'], '方向（可留空）': ['Direction (optional)', '方向（任意）'],
  '捷運系統': ['Metro system', 'メトロ事業者'], '定位': ['Location', '位置情報'],
  '自動（最近的站）': ['Automatic (nearest station)', '自動（最寄り駅）'],
  '留空＝兩個方向都看': ['Leave blank to show both directions', '空欄の場合は両方向を表示'],
  '發車看板': ['Departure board', '発車案内'],
  '查看台鐵或高鐵接下來的直達、停靠、終到與通過列車。': ['See upcoming direct, stopping, terminating and passing TRA or HSR trains.', '台湾鉄路・高鉄の直通、停車、終着、通過列車を表示します。'],
  '起訖站清單依縣市由北到南分段，最上面可以直接選你在軌島存過的地點。目的站可留空，以查看所有停靠、終到與通過列車；起站選共站或我的地點時，請用「只看這些」依方向、車種或車次篩選。': ['Origins and destinations are grouped north to south, with your saved places first. Leave the destination blank to show all stopping, terminating and passing trains. For a shared station or saved place, use Filters to narrow by direction, train type or number.', '出発駅と目的地は北から南へ地域別に表示され、保存した場所が先頭に並びます。目的地を空欄にすると停車・終着・通過列車をすべて表示します。共用駅や保存場所では「表示条件」で方向・列車種別・列車番号を絞り込めます。'],
  '起站': ['Origin', '出発駅'], '目的站（可留空）': ['Destination (optional)', '目的地（任意）'],
  '只看這些（可留空）': ['Filters (optional)', '表示条件（任意）'],
  '共站看板不看目的站，這格可留空': ['Shared-station boards do not use a destination; leave this blank', '共用駅案内では目的地を使わないため空欄にできます'],
  '班表準備中，先列出全部車站': ['Timetable is loading; showing all stations', '時刻表の準備中は全駅を表示します'],
  '只顯示有直達列車的車站': ['Only stations with a direct train are shown', '直通列車のある駅のみ表示'],
  '正在讀取起站，先列出全部車站': ['Reading the origin; showing all stations for now', '出発駅を読み込み中のため全駅を表示します'],
  '方向（與下面的條件同時成立）': ['Direction (combined with the filters below)', '方向（以下の条件と同時に適用）'],
  '車種': ['Train type', '列車種別'], '車次': ['Train number', '列車番号'],
  '留空就是全部都看': ['Leave blank to show all', '空欄の場合はすべて表示'],
  '鐵路＋捷運看板': ['Rail + metro board', '鉄道＋メトロ案内'],
  '同一張卡查看台鐵／高鐵發車與捷運進站倒數。': ['See TRA/HSR departures and metro arrival countdowns on one card.', '1枚のカードで台湾鉄路・高鉄の発車とメトロ到着カウントダウンを確認します。'],
  '同一張卡看台鐵／高鐵發車與捷運進站倒數。': ['TRA/HSR departures and metro countdowns on one card.', '台湾鉄路・高鉄の発車とメトロ到着カウントダウンを1枚で表示します。'],
  '台鐵／高鐵起站': ['TRA / HSR origin', '台湾鉄路／高鉄の出発駅'], '捷運站': ['Metro station', 'メトロ駅'],
  '捷運方向（可留空）': ['Metro direction (optional)', 'メトロ方向（任意）'], '台鐵／高鐵': ['TRA / HSR', '台湾鉄路／高鉄'],
  '連不上官方資料，稍後自動再試': ['Cannot reach official data; retrying automatically', '公式データに接続できません。自動で再試行します'],
  '沒有資料': ['No data', 'データがありません'], '資料過舊，打開軌島即更新': ['Data is stale; open Rail Island to refresh', 'データが古いため軌島を開いて更新してください'],
  '官方目前沒有這一站的班次資訊': ['No official service information is currently available for this station', 'この駅の公式列車情報は現在ありません'],
  '自動選站': ['Automatic station', '駅を自動選択'], '再加一站': ['Add another station', '別の駅を追加'],
  '自動選最近的站是通行證功能。點一下開啟軌島看方案，或改選一個固定車站。': ['Automatic nearest-station selection requires a Rail Island Pass. Tap to view plans, or choose a fixed station.', '最寄り駅の自動選択には軌島パスが必要です。タップしてプランを見るか、固定駅を選んでください。'],
  '免費版可設定一站。點一下開啟軌島，用通行證解鎖多站。': ['The free version supports one station. Tap to open Rail Island and unlock more with a pass.', '無料版では1駅を設定できます。軌島を開き、パスで複数駅を利用できます。'],
  '免費版可設定一站（目前是「{station}」）。點一下開啟軌島，用通行證解鎖多站。': ['The free version supports one station (currently “{station}”). Tap to unlock more with a pass.', '無料版では1駅を設定できます（現在は「{station}」）。パスで複数駅を利用できます。'],
  '開啟 App 一次，或到「設定 › 軌島」允許取用位置': ['Open the app once, or allow location access in Settings › Rail Island', 'Appを一度開くか、「設定 › 軌島」で位置情報を許可してください'],
  '請選擇車站': ['Choose a station', '駅を選択'], '請選擇起站': ['Choose an origin', '出発駅を選択'],
  '找不到這個車站，請重新設定': ['Station not found; please configure it again', '駅が見つかりません。再設定してください'],
  '所選班次近期沒有行駛': ['The selected service does not run in the current period', '選択した列車は当面運行しません'],
  '開啟軌島以載入班表': ['Open Rail Island to load the timetable', '軌島を開いて時刻表を読み込んでください'],
  '開啟軌島以載入附近路線': ['Open Rail Island to load nearby routes', '軌島を開いて周辺路線を読み込んでください'],
  '開啟軌島更新附近路線': ['Open Rail Island to refresh nearby routes', '軌島を開いて周辺路線を更新してください'],
  '未命名地點': ['Unnamed place', '名称未設定の場所'], '我的地點': ['My places', '保存した場所'],
  '未標示': ['Not shown', '表示なし'], '台灣高鐵': ['Taiwan High Speed Rail', '台湾高鉄'],
  '臺北捷運': ['Taipei Metro', '台北メトロ'], '桃園機場捷運': ['Taoyuan Airport MRT', '桃園空港MRT'],
  '縱貫線北段': ['Western Trunk Line (North Section)', '縦貫線北段'], '末': ['Last', '終'],
  '共站（台鐵＋高鐵一起看）': ['Shared station (TRA + HSR)', '共用駅（台湾鉄路＋高鉄）'],
  '最上面是你存過的地點與共站，往下依縣市排': ['Saved places and shared stations appear first, followed by counties and cities', '保存した場所と共用駅が先頭、その下に地域別で表示されます'],
  '通過': ['Passing', '通過'], '通過不停靠': ['Passes without stopping', '通過（停車しません）'],
  '明天': ['Tomorrow', '明日'], '下一班': ['Next', '次の列車'], '今天最後一班': ['Last train today', '本日の最終列車'],
  '今天沒有列車經過': ['No trains pass here today', '本日は列車が通過しません'],
  '未來 60 分鐘沒有列車': ['No trains in the next 60 minutes', '今後60分間に列車はありません'],
  '60 分鐘內無車': ['No trains within 60 minutes', '60分以内に列車はありません'],
  '明天 {value}': ['Tomorrow {value}', '明日 {value}'],
  '分': ['min', '分'], '約': ['about', '約'], '秒': ['sec', '秒'],
  '暫無資料': ['No data', 'データなし'], '末班車': ['Last train', '最終列車'],
  '經過': ['Passing', '通過'],
  '資料時刻 {time}': ['Data updated at {time}', 'データ時刻 {time}'],
  '{time} {suffix}': ['{time} {suffix}', '{time} {suffix}'],
  '{station} {time} 到': ['{station} · arrived {time}', '{station} {time}到着'],
  '資料未更新': ['Data not updated', 'データ未更新'],
  '⚠ 資料中斷・位置為預估': ['⚠ Data interrupted · position estimated', '⚠ データ中断・位置は推定'],
  '{trainNo} 次 往 {station}': ['Train {trainNo} to {station}', '{trainNo}列車・{station}方面'],
  '誤點資訊已過期': ['Delay information expired', '遅延情報は期限切れです'],
  '目前無即時誤點資訊': ['No live delay information', '現在、リアルタイムの遅延情報はありません'],
  '追蹤到此結束，卡片會自動關閉': ['Tracking has ended; this card will close automatically', '追跡は終了しました。このカードは自動で閉じます'],
  '誤點分鐘不會自己更新，要看最新請回軌島': ['Delay minutes will not update automatically; return to Rail Island for the latest information', '遅延時分は自動更新されません。最新情報は軌島で確認してください'],
  '表定': ['Scheduled', '予定'], '實際約': ['Est. actual', '実到着見込'],
  '表定 {time}': ['Scheduled {time}', '予定 {time}'],
  '{station} 車應已到': ['Train should have arrived at {station}', '{station}に到着した見込み'],
  '舒適': ['Comfortable', '快適'], '普通': ['Moderate', '普通'],
  '略擠': ['Crowded', 'やや混雑'], '擁擠': ['Very crowded', '混雑'],
  '北上': ['Northbound', '北行'], '南下': ['Southbound', '南行'],
  '開': ['Dep.', '発'], '抵': ['Arr.', '着'],
  '{scheduled} {action} → {effective}': ['{scheduled} {action} → {effective}', '{scheduled} {action} → {effective}'],
  '{time} {action}': ['{time} {action}', '{time} {action}'],
  '捷運 · 自動選站': ['Metro · Auto station', 'メトロ・駅を自動選択'],
  '捷運 · 倒數': ['Metro · Countdown', 'メトロ・到着まで'],
  '臺鐵・高鐵 · {name}': ['TRA / HSR · {name}', '台湾鉄路・高鉄・{name}'],
  '臺鐵・高鐵 · 經過': ['TRA / HSR · Passing', '台湾鉄路・高鉄・通過'],
  '臺鐵・高鐵 · 時刻': ['TRA / HSR · Times', '台湾鉄路・高鉄・時刻'],
  '今天沒有更晚的班次了': ['No later trains today', '本日はこれ以降の列車がありません'],
  '這個地點附近今天沒有更晚的班次': ['No later trains near this place today', 'この場所の周辺では本日これ以降の列車がありません'],
  '進站': ['Arriving', '到着'], '停靠中': ['At station', '停車中'], '停靠': ['Stopped', '停車'],
  '{station} 進站中': ['{station} arriving', '{station}に到着中'],
  '目前': ['Current', '現在'], '下一站': ['Next stop', '次の駅'], '準點': ['On time', '定刻'],
  '資料中斷・位置為預估': ['Data interrupted · position estimated', 'データ中断・位置は推定'],
  '下一班會自動接上': ['The next train will update automatically', '次の列車へ自動で切り替わります'],
  '卡片不會自己接下一班，要看後續請回軌島重開': ['This card will not advance automatically. Reopen it in Rail Island for later trains.', 'このカードは次の列車へ自動更新されません。続きは軌島で開き直してください。'],
  '結束': ['End', '終了'], '自動': ['Auto', '自動'], '終點': ['Terminus', '終点'],
  '終到本站': ['Terminates here', '当駅止まり'], '查無直達班次': ['No direct trains found', '直通列車がありません'],
  '{n} 分': ['{n} min', '{n}分'], '約 {n} 分': ['about {n} min', '約{n}分'],
  '· 再 {n} 分': ['· Another in {n} min', '・次は{n}分後'],
  '· 再約 {n} 分': ['· Another in about {n} min', '・次は約{n}分後'],
  '· 下一班即將進站': ['· Next train arriving soon', '・次の列車がまもなく到着'],
  '· 下一班進站': ['· Next train arriving', '・次の列車が到着'],
  '誤點 {n} 分': ['{n} min late', '{n}分遅れ'], '早到 {n} 分': ['{n} min early', '{n}分早着'],
  '往 {station}': ['To {station}', '{station}方面'], '往{station}': ['To {station}', '{station}方面'],
  '再下一班 往 {station}': ['Following train to {station}', '次々発は{station}方面'],
  '追蹤至 {time}': ['Tracking until {time}', '{time}まで追跡'],
  '{time} 更新': ['Updated {time}', '{time}更新'], '上次 {time} 更新': ['Last updated {time}', '前回更新{time}'],
  '末班 {time}': ['Last train {time}', '終電 {time}'], '{n} 條線': ['{n} routes', '{n}路線'],
  '另 {n} 班': ['{n} more', 'ほか{n}本'], '{n} 班': ['{n} trains', '{n}本'],
  '{time} 抵達': ['Arrives {time}', '{time}到着'], '抵 {time}{nextDay}': ['Arr. {time}{nextDay}', '{time}{nextDay}着'],
  '隔日': [' next day', ' 翌日'], '· 往 {station}': ['· To {station}', '・{station}方面'],
  '· 誤點 {n} 分': ['· {n} min late', '・{n}分遅れ'], '· 通過': ['· Passing', '・通過'],
  '· 今天最後一班': ['· Last train today', '・本日の最終列車'],
  '{line} · {n} 班': ['{line} · {n} trains', '{line}・{n}本'],
  '{line} · 往{station}': ['{line} · To {station}', '{line}・{station}方面'],
  '往 {station} 方向': ['Toward {station}', '{station}方面'],
  '通過 · 往{station}': ['Passing · To {station}', '通過・{station}方面'],
  '1.5 公里內沒有路線': ['No routes within 1.5 km', '1.5km以内に路線はありません'],
  '1.5 公里內沒有台鐵或高鐵路線': ['No TRA or HSR route within 1.5 km', '1.5km以内に台湾鉄路・高鉄の路線はありません'],
  '1.5 公里內 {n} 條路線': ['{n} routes within 1.5 km', '1.5km以内に{n}路線'],
  '班表只到 {date} · 請更新軌島': ['Timetable ends {date} · update Rail Island', '時刻表は{date}までです・軌島を更新してください'],
  '依 {date}（同週{weekday}）班表 · 請更新軌島': ['Using the {date} timetable (same weekday) · update Rail Island', '{date}（同じ曜日）の時刻表を使用・軌島を更新してください'],
  '開啟設定': ['Open Settings', '設定を開く']
};
Object.assign(native, {
  // Android 1.5.0 原生設定頁、桌面小工具與鎖定畫面／Now Bar。
  '捷運看板小工具': ['Metro board widget', 'メトロ到着案内ウィジェット'],
  '選一個車站，桌面就會顯示官方的下一班還有幾分鐘。': ['Choose a station to show the official next-arrival time on your Home screen.', '駅を選ぶと、公式の次列車到着時分をホーム画面に表示します。'],
  '版型': ['Layout', 'レイアウト'],
  '琺瑯站牌（一站一班）': ['Enamel station sign (one station, one train)', '琺瑯駅名標（1駅・1列車）'],
  '夜行看板（多方向並排）': ['Night board (multiple directions)', '夜間案内（複数方向）'],
  '更新頻率': ['Refresh frequency', '更新頻度'],
  '省電（5 分鐘，進站前 2 分鐘）': ['Power saving (5 min; 2 min near arrival)', '省電力（5分、到着2分前）'],
  '標準（1 分鐘，進站前 30 秒）': ['Standard (1 min; 30 sec near arrival)', '標準（1分、到着30秒前）'],
  '積極（30 秒）': ['Frequent (30 sec)', '高頻度（30秒）'],
  '通行證已啟用：可以放多站，也可以用自動選站。': ['Pass active: use multiple stations and automatic station selection.', 'パス利用中：複数駅と駅の自動選択を利用できます。'],
  '免費版可以固定一站；多站與自動選站需要軌島通行證。（點這裡看通行證）': ['The free version supports one fixed station. Multiple stations and automatic selection require a Rail Island Pass. (Tap to view the Pass.)', '無料版では固定駅を1つ利用できます。複数駅と自動選択には軌島パスが必要です。（タップしてパスを表示）'],
  '免費版的那一站已經在用了。要再加一站請開通軌島通行證。（點這裡看通行證）': ['Your free station is already in use. Activate a Rail Island Pass to add another. (Tap to view the Pass.)', '無料枠の1駅は使用中です。別の駅を追加するには軌島パスを利用してください。（タップしてパスを表示）'],
  '自動（最近的站・通行證）': ['Automatic (nearest station · Pass)', '自動（最寄り駅・パス）'],
  '全部方向': ['All directions', '全方向'],
  '單位分鐘': ['minutes', '単位：分'],
  '發車看板小工具': ['Departure board widget', '発車案内ウィジェット'],
  '含通過列車': ['Include passing trains', '通過列車も表示'],
  '本站今日沒有停靠的列車': ['No trains stop here today', '本日この駅に停車する列車はありません'],
  '只有通過列車 · 可在設定開啟「含通過列車」': ['Only passing trains \u00b7 turn on "Include passing trains" in settings', '通過列車のみ・設定で「通過列車も表示」をオンにできます'],
  '全部目的地 · 停靠與終到': ['All destinations · stopping and terminating', '全目的地・停車と終着'],
  '選台鐵、高鐵或共站，查看接下來的停靠與終到列車；想看通過本站的車，在「只看這些」裡打開。': ['Choose TRA, HSR or a shared station to see upcoming stopping and terminating trains. Turn on passing trains under Filters.', '台湾鉄路、高鉄、共用駅を選び、次の停車・終着列車を確認します。通過列車は「表示条件」で表示できます。'],
  '選台鐵、高鐵或共站，查看接下來的停靠、終到與通過列車。': ['Choose TRA, HSR or a shared station to see upcoming stopping, terminating and passing trains.', '台湾鉄路、高鉄、共用駅を選び、次の停車・終着・通過列車を確認します。'],
  '鐵路系統': ['Rail system', '鉄道事業者'],
  '台鐵＋高鐵共站': ['TRA + HSR shared station', '台湾鉄路＋高鉄共用駅'],
  '大字好讀版': ['Large, easy-to-read text', '大きく読みやすい文字'],
  '加到桌面': ['Add to Home screen', 'ホーム画面に追加'],
  '全部目的地': ['All destinations', '全目的地'],
  '只看這些': ['Filters', '表示条件'],
  '只看這些（留空就是全部）': ['Filters (leave blank for all)', '表示条件（空欄ですべて表示）'],
  '這個起站目前沒有可用的篩選項目。': ['No filters are currently available for this origin.', 'この出発駅で利用できる表示条件はありません。'],
  '知道了': ['OK', 'OK'],
  '完成': ['Done', '完了'],
  '清除': ['Clear', 'クリア'],
  '已選 {n} 項篩選': ['{n} filters selected', '表示条件を{n}件選択'],
  '鐵路＋捷運雙看板': ['Rail + metro dual board', '鉄道＋メトロ二面案内'],
  '在同一張大卡片查看一個鐵路站和一個捷運站。': ['See one rail station and one metro station on the same large card.', '1枚の大きなカードで鉄道駅とメトロ駅を1駅ずつ表示します。'],
  '免費版可使用一個捷運站；多站與自動選站需啟用軌島通行證。': ['The free version supports one metro station. Multiple stations and automatic selection require a Rail Island Pass.', '無料版ではメトロ1駅を利用できます。複数駅と自動選択には軌島パスが必要です。'],
  '自動（最近的捷運站）': ['Automatic (nearest metro station)', '自動（最寄りのメトロ駅）'],
  '自動（最近的台鐵站）': ['Automatic (nearest TRA station)', '自動（最寄りの台湾鉄路駅）'],
  '共站': ['Shared station', '共用駅'],
  '我的地點 · {name}（{system} {station}）': ['My place · {name} ({system} {station})', '保存した場所・{name}（{system} {station}）'],
  '方向 · 往 {station}': ['Direction · To {station}', '方向・{station}方面'],
  '車種 · {type}（{n} 班）': ['Train type · {type} ({n} trains)', '列車種別・{type}（{n}本）'],
  '車次 · {trainNo}': ['Train · {trainNo}', '列車番号・{trainNo}'],
  '{station}雙看板': ['{station} dual board', '{station}・二面案内'],
  '{station}發車看板': ['{station} departures', '{station}・発車案内'],
  '捷運 · {system} · {station}': ['Metro · {system} · {station}', 'メトロ・{system}・{station}'],
  '鐵路 · {system} · {station}': ['Rail · {system} · {station}', '鉄道・{system}・{station}'],
  '部分資料延遲 · 顯示上次成功結果': ['Some data is delayed · showing the last successful result', '一部データ遅延・前回取得結果を表示'],
  '捷運即時 · 台鐵誤點 · 高鐵表定': ['Live metro · TRA delays · scheduled HSR', 'メトロ即時・台湾鉄路遅延・高鉄予定'],
  '本站列車': ['Trains at this station', '当駅の列車'],
  '全部目的地 · 直達／停靠／終到／通過': ['All destinations · direct / stopping / terminating / passing', '全目的地・直通／停車／終着／通過'],
  '往 {station} · 直達列車': ['To {station} · direct trains', '{station}方面・直通列車'],
  '台鐵即時誤點 · 高鐵表定時刻': ['Live TRA delays · scheduled HSR times', '台湾鉄路リアルタイム遅延・高鉄予定時刻'],
  '資料延遲 · 顯示上次成功結果': ['Data delayed · showing the last successful result', 'データ遅延・前回取得結果を表示'],
  '目前沒有接下來的班次': ['No upcoming trains', 'この先の列車はありません'],
  '請稍後再看或點卡片開啟軌島': ['Check again later or tap the card to open Rail Island', 'しばらくしてから確認するか、カードをタップして軌島を開いてください'],
  '更新': ['updated', '更新'],
  '依 {date} 同星期班表': ['Using the {date} timetable for the same weekday', '{date}の同曜日時刻表を使用'],
  '高鐵 {date} 當日班表': ['HSR timetable for {date}', '高鉄{date}当日時刻表'],
  '選一個捷運站': ['Choose a metro station', 'メトロ駅を選択'],
  '設定之後，這一格就會顯示下一班車還有幾分鐘。': ['After setup, this widget will show minutes until the next train.', '設定すると、次の列車までの分数を表示します。'],
  '選擇車站': ['Choose station', '駅を選択'],
  '了解通行證': ['View the Pass', 'パスを見る'],
  '免費可以固定一站。通行證解鎖多站、自動選站與擁擠度。': ['The free version supports one fixed station. A Pass unlocks multiple stations, automatic selection and crowding.', '無料版では固定駅を1つ利用できます。パスで複数駅、自動選択、混雑度を利用できます。'],
  '還不知道你在哪': ['Location not available yet', '現在地をまだ取得できません'],
  '請開啟軌島並允許「大概位置」，之後這一格會自己跟著最近的車站。': ['Open Rail Island and allow approximate location. This widget will then follow the nearest station.', '軌島を開いて「おおよその位置」を許可すると、最寄り駅へ自動で切り替わります。'],
  '開啟軌島': ['Open Rail Island', '軌島を開く'],
  '暫時連不上': ['Temporarily unavailable', '一時的に接続できません'],
  '目前無法取得官方班次。點一下開啟軌島看完整看板。': ['Official arrivals are unavailable. Tap to open the full board in Rail Island.', '公式列車情報を取得できません。タップして軌島の案内を開いてください。'],
  '跟隨列車': ['Train following', '列車追跡'],
  '在鎖定畫面與 Now Bar 顯示正在跟隨列車的下一站': ['Show the next stop of the followed train on the lock screen and Now Bar', '追跡中列車の次駅をロック画面とNow Barに表示します'],
  '{kind} {trainNo}': ['{kind} {trainNo}', '{kind} {trainNo}'],
  '停靠 {station}': ['At {station}', '{station}に停車中'],
  '下一站 {station}': ['Next stop {station}', '次は{station}'],
  '{status} · 往 {station}': ['{status} · To {station}', '{status}・{station}方面'],
  '軌島 · {status}': ['Rail Island · {status}', '軌島・{status}'],
  '結束跟車': ['End following', '追跡を終了'],
  '稍有延誤': ['Slight delay', '少々遅れ'],
  '提早': ['Running early', '早着'],
  '晚 {n} 分': ['{n} min late', '{n}分遅れ'],
  '早 {n} 分': ['{n} min early', '{n}分早着'],
  '等車資訊卡': ['Station tracking card', '駅待ち情報カード'],
  '在鎖定畫面顯示正在追蹤車站的下一班車': ['Show the next train at the tracked station on the lock screen', '追跡中の駅の次列車をロック画面に表示します'],
  '再下一班': ['Following train', '次々発'],
  '車廂鬆緊': ['Car crowding', '車両混雑度'],
  '軌島・等車中': ['Rail Island · Waiting', '軌島・列車待ち'],
  '{trainType} {trainNo} 次列車': ['{trainType} {trainNo}', '{trainType} {trainNo}列車'],
  '{status} {time}': ['{status} {time}', '{status} {time}'],
  '{time} 發車': ['Departs {time}', '{time}発'],
  '{time} 資料': ['Data {time}', 'データ {time}'],
  '了解': ['Got it', '了解'],
  '已收班': ['Service ended', '運行終了'],
  '台鐵＋高鐵': ['TRA + HSR', '台湾鉄路＋高鉄'],
  '台鐵等車': ['TRA station tracking', '台湾鉄路の駅待ち'],
  '捷運等車': ['Metro station tracking', 'メトロの駅待ち'],
  '末班': ['Last train', '終電'],
  '本日最後一班': ['Last train today', '本日の最終列車'],
  '正在重新連線': ['Reconnecting', '再接続中'],
  '目前無班次': ['No trains now', '現在列車はありません'],
  '再下班 {value} 分': ['Following train in {value} min', '次々発は{value}分後'],
  '再下班 {second} 分 · {third} 分': ['Following trains in {second} min · {third} min', '次々発は{second}分後・その次は{third}分後'],
  '尚未取得資料': ['No data received yet', 'データをまだ取得していません'],
  '尚無讀數': ['No reading', 'データなし'],
  '約 {n}': ['about {n}', '約{n}'],
  '首班 {time}': ['First train {time}', '始発 {time}'],
  '第 2 站起需要通行證': ['A Pass is required from the second station', '2駅目からパスが必要です'],
  '請稍後再看': ['Check again later', 'しばらくしてから確認してください'],
  '請預留進站時間': ['Allow time to enter the station', '駅へ入る時間に余裕を持ってください'],
  '營運異常': ['Service alert', '運行情報'],
  '還有 {m} 分': ['{m} min remaining', '残り{m}分'],
  '還有 {h} 小時 {m} 分': ['{h} hr {m} min remaining', '残り{h}時間{m}分'],
  '顯示 {time} 最後資料': ['Showing the last data from {time}', '{time}の最終データを表示'],
});
Object.assign(native, {
  '基隆市': ['Keelung City', '基隆市'], '臺北市': ['Taipei City', '台北市'], '新北市': ['New Taipei City', '新北市'],
  '桃園市': ['Taoyuan City', '桃園市'], '新竹市': ['Hsinchu City', '新竹市'], '新竹縣': ['Hsinchu County', '新竹県'],
  '苗栗縣': ['Miaoli County', '苗栗県'], '臺中市': ['Taichung City', '台中市'], '彰化縣': ['Changhua County', '彰化県'],
  '南投縣': ['Nantou County', '南投県'], '雲林縣': ['Yunlin County', '雲林県'], '嘉義市': ['Chiayi City', '嘉義市'],
  '嘉義縣': ['Chiayi County', '嘉義県'], '臺南市': ['Tainan City', '台南市'], '高雄市': ['Kaohsiung City', '高雄市'],
  '屏東縣': ['Pingtung County', '屏東県'], '宜蘭縣': ['Yilan County', '宜蘭県'], '花蓮縣': ['Hualien County', '花蓮県'],
  '臺東縣': ['Taitung County', '台東県'], '其他': ['Other', 'その他']
});
for (const [source, [en, ja]] of Object.entries(native)) add(source, en, ja);

const strings = {};
for (const source of [...entries.keys()].sort((a, b) => a.localeCompare(b, 'zh-Hant'))) {
  const value = entries.get(source);
  strings[source] = {
    extractionState: 'manual',
    localizations: {
      en: { stringUnit: { state: 'translated', value: value.en } },
      ja: { stringUnit: { state: 'translated', value: value.ja } },
    },
  };
}
const catalog = { sourceLanguage: 'zh-Hant', strings, version: '1.0' };
const output = path.join(root, 'app/ios/App/RailBoardWidget/Localizable.xcstrings');
fs.writeFileSync(output, JSON.stringify(catalog, null, 2) + '\n');

const info = {
  sourceLanguage: 'zh-Hant',
  strings: {
    CFBundleDisplayName: { localizations: {
      en: { stringUnit: { state: 'translated', value: 'Rail Island' } },
      ja: { stringUnit: { state: 'translated', value: '軌島' } },
    } },
    NSLocationWhenInUseUsageDescription: { localizations: {
      en: { stringUnit: { state: 'translated', value: 'Rail Island uses your location while the app is open to move the map near you and show nearby stations and trains. Raw coordinates stay on your device and are not uploaded. You can still explore the map manually if you decline.' } },
      ja: { stringUnit: { state: 'translated', value: '軌島はAppの使用中、現在地付近へ地図を移動し、周辺の駅と列車を表示するために位置情報を使います。取得した座標は端末内だけで使用し、アップロードしません。許可しなくても地図を手動で利用できます。' } },
    } },
    NSLocationAlwaysAndWhenInUseUsageDescription: { localizations: {
      en: { stringUnit: { state: 'translated', value: 'Rail Island accesses location only while you use the app, to move the map near you and show nearby stations and trains. It does not track you continuously in the background or request Always access. Raw coordinates stay on your device and are not uploaded; you can still explore manually if you decline.' } },
      ja: { stringUnit: { state: 'translated', value: '軌島はAppの使用中だけ位置情報を取得し、現在地付近へ地図を移動して周辺の駅と列車を表示します。バックグラウンドで継続的に追跡せず、「常に許可」も要求しません。座標は端末内だけで使用し、アップロードしません。許可しなくても手動で利用できます。' } },
    } },
  },
  version: '1.0',
};
fs.writeFileSync(path.join(root, 'app/ios/App/App/InfoPlist.xcstrings'), JSON.stringify(info, null, 2) + '\n');

// Android 沒有 String Catalog，也不能讓 Widget／通知依 WebView localStorage 自己猜語言；
// 將同一份人工複核過的來源輸出成唯讀 asset，由 RailNativeL10n 依網頁同步的白名單語言讀取。
const android = { sourceLanguage: 'zh-TW', languages: { en: {}, ja: {} } };
for (const [source, value] of entries) {
  android.languages.en[source] = value.en;
  android.languages.ja[source] = value.ja;
}
const androidOutput = path.join(root, 'app/android/app/src/main/assets/RailNativeL10n.json');
fs.mkdirSync(path.dirname(androidOutput), { recursive: true });
fs.writeFileSync(androidOutput, JSON.stringify(android, null, 2) + '\n');
console.log(`原生字串目錄已產生：${Object.keys(strings).length} keys（iOS String Catalog + Android JSON）`);
