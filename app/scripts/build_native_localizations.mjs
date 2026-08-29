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
const add = (source, en, ja) => {
  if (!source || !en || !ja) return;
  entries.set(String(source), { en: String(en), ja: String(ja) });
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
  '沒有資料': ['No data', 'データがありません'],
  // 等車卡「資料暫時斷了」的狀態，與上面「沒有資料」（本來就沒有這一站）刻意分開講。
  '暫無資料': ['No data yet', 'データなし'], '資料過舊，打開軌島即更新': ['Data is stale; open Rail Island to refresh', 'データが古いため軌島を開いて更新してください'],
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
  '進站': ['Arriving', '到着'], '停靠中': ['At station', '停車中'], '停靠': ['Stopped', '停車'],
  '目前': ['Current', '現在'], '下一站': ['Next stop', '次の駅'], '準點': ['On time', '定刻'],
  '資料中斷・位置為預估': ['Data interrupted · position estimated', 'データ中断・位置は推定'],
  '下一班會自動接上': ['The next train will update automatically', '次の列車へ自動で切り替わります'],
  '卡片不會自己接下一班，要看後續請回軌島重開': ['This card will not advance automatically. Reopen it in Rail Island for later trains.', 'このカードは次の列車へ自動更新されません。続きは軌島で開き直してください。'],
  '結束': ['End', '終了'], '自動': ['Auto', '自動'], '終點': ['Terminus', '終点'],
  '終到本站': ['Terminates here', '当駅止まり'], '查無直達班次': ['No direct trains found', '直通列車がありません'],
  '{n} 分': ['{n} min', '{n}分'], '約 {n} 分': ['about {n} min', '約{n}分'],
  '誤點 {n} 分': ['{n} min late', '{n}分遅れ'], '早到 {n} 分': ['{n} min early', '{n}分早着'],
  '往 {station}': ['To {station}', '{station}方面'], '往{station}': ['To {station}', '{station}方面'],
  '再下一班 往 {station}': ['Following train to {station}', '次々発は{station}方面'],
  '追蹤至 {time}': ['Tracking until {time}', '{time}まで追跡'],
  '{time} 更新': ['Updated {time}', '{time}更新'],
  // 我的地點卡：列車經過這個地點的時刻。與上面的『通過』(Passing) 同一組詞。
  '{time} 經過': ['Passing {time}', '{time}通過'], '上次 {time} 更新': ['Last updated {time}', '前回更新{time}'],
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
console.log(`原生字串目錄已產生：${Object.keys(strings).length} keys`);
