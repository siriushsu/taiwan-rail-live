import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { buildMetroPages, THEME_BOOT, BRAND_MARK } from './build_metro_pages.mjs';
import { loadStationTimetableInputs, traStationTimetable, thsrStationTimetable } from './station_timetable.mjs';

// 預設：重產所有頁面並寫檔。--check：在記憶體重產，和磁碟逐 byte 比對，有差異就列出檔名並以非零離開（不寫檔）。
const checkMode = process.argv.includes('--check');
const unknownArgs = process.argv.slice(2).filter(arg => arg !== '--check');
if (unknownArgs.length) {
  console.error(`不認識的參數：${unknownArgs.join(' ')}（只支援 --check）`);
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteUrl = 'https://railisland.tw';
const updated = '2026-09-03';
const transfers = JSON.parse(fs.readFileSync(path.join(root, 'data/station_transfers.json'), 'utf8'));
const traInfo = JSON.parse(fs.readFileSync(path.join(root, 'data/tra_station_info.json'), 'utf8'));

// 韓文靜態頁的介面字串與說明頁全文查站上現成的字典（網頁版韓文介面同一份），查不到就 throw，不在這裡另翻一份。
const koBox = { window: { RAIL_I18N_MESSAGES: { en: {}, ja: {} } } };
vm.createContext(koBox);
for (const file of ['ko-translations', 'ko-public-pages']) vm.runInContext(fs.readFileSync(path.join(root, 'i18n', `${file}.js`), 'utf8'), koBox);
const koDict = { ...koBox.window.RAIL_I18N_MESSAGES.ko, ...koBox.window.RAIL_I18N_LEGAL_MESSAGES.ko };
function K(source) {
  if (koDict[source] === undefined) throw new Error(`韓文字典（i18n/ko-translations.js、i18n/ko-public-pages.js）缺「${source}」`);
  return koDict[source];
}

const systemNames = {
  AFR: '阿里山林業鐵路',
  KRTC: '高雄捷運',
  THSR: '台灣高鐵',
  TMRT: '台中捷運',
  TRA: '台鐵',
  TRTC: '台北捷運',
  TYMC: '桃園機場捷運',
  NTMC: '新北捷運環狀線',
};

const routeNames = {
  'THSR:THSR': '台灣高鐵',
  ...Object.fromEntries(Object.entries(transfers.routes).map(([key, route]) => [key, route.name || systemNames[route.system] || key])),
};

// 轉乘資料裡兩站的距離（公尺，取整）與兩站座標的直線距離（公里，取整）；新開的高鐵頁把數字算進說明文字，資料換了不會留下過期的數字。
function pairM(a, b) {
  for (const group of transfers.transferStations) {
    const hit = group.pairs.find(pair => (pair.a === a && pair.b === b) || (pair.a === b && pair.b === a));
    if (hit) return Math.round(hit.distanceM);
  }
  throw new Error(`station_transfers.json 沒有 ${a} 與 ${b} 的轉乘距離`);
}
function kmBetween(a, b) {
  const [p, q] = [transfers.stations[a], transfers.stations[b]];
  if (!p || !q) throw new Error(`station_transfers.json 找不到 ${!p ? a : b}`);
  const rad = deg => deg * Math.PI / 180;
  const dLat = rad(q.position[0] - p.position[0]), dLon = rad(q.position[1] - p.position[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(p.position[0])) * Math.cos(rad(q.position[0])) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)));
}

// 每站四語文字：title／summary／transfer。en／ja／ko 只翻譯 zh 已有的說法，站名、系統名、路線名照站上既有譯法
// （i18n/stations.json、scripts/build_metro_pages.mjs、/en/ 與 /ja/ 著陸頁）；不新增 zh 沒有的斷言。
// ko 取自 docs/i18n/korean-station-pages-draft.json，用語統一成 native docs/m9/lanes/korean-179-handoff.md 的定案。
const stations = [
  {
    slug: 'taipei',
    title: '台北車站',
    members: ['THSR:1000', 'TRA:1000', 'TRTC:BL12', 'TRTC:R10', 'TYMC:A1'],
    summary: '台北車站是台鐵、高鐵、台北捷運板南線與淡水信義線的共站區域；桃園機場捷運 A1 台北車站也在步行轉乘範圍內。軌島把這些系統分別呈現，再以轉乘資料連結。',
    transfer: '台鐵與高鐵站點相鄰；兩條台北捷運路線使用同一捷運站名。桃園機場捷運 A1 與台鐵站點在資料中相距約 304 公尺，屬步行轉乘，不代表同一月台。',
    en: {
      title: 'Taipei Main Station',
      summary: 'Taipei Main Station is a shared station area for Taiwan Railway (TRA), Taiwan High Speed Rail (HSR) and the Taipei MRT Bannan and Tamsui-Xinyi lines. Taoyuan Airport MRT station A1 Taipei Main Station is also within walking distance for transfers. Rail Island shows each system separately and links them with transfer data.',
      transfer: 'The TRA and HSR stations are next to each other, and the two Taipei MRT lines use the same station name. In the data, Airport MRT A1 is about 304 m from the TRA station: a walking transfer, not the same platform.',
    },
    ja: {
      title: '台北駅',
      summary: '台北駅は、台鉄（TRA）、台湾高速鉄道（高鉄）、台北MRTの板南線と淡水信義線が集まる駅エリアです。桃園空港MRTのA1台北駅も、徒歩で乗り換えられる範囲にあります。軌島はこれらのシステムを別々に表示し、乗り換えデータで結び付けています。',
      transfer: '台鉄と高鉄の駅は隣り合っていて、台北MRTの2路線は同じ駅名を使っています。桃園空港MRTのA1は、データ上では台鉄の駅から約304 m離れており、徒歩での乗り換えにあたります。同じホームという意味ではありません。',
    },
    ko: {
      title: '타이베이역',
      summary: '타이베이역은 대만철도 · 고속철도 · 타이베이 MRT 반난선 · 단수이신이선의 환승 구역이에요. 타오위안 공항 MRT A1 타이베이역도 도보 환승 범위에 있어요. Rail Island는 각 시스템을 따로 표시하고 환승 정보로 연결해요.',
      transfer: '대만철도 · 고속철도 지점은 서로 가까이 있고 두 타이베이 MRT 노선은 같은 역명을 사용해요. 타오위안 공항 MRT A1은 대만철도 지점에서 데이터상 약 304m 떨어진 도보 환승이며 같은 승강장이 아니에요.',
    },
  },
  {
    slug: 'banqiao',
    title: '板橋車站',
    members: ['NTMC:Y16', 'THSR:1010', 'TRA:1020', 'TRTC:BL07'],
    summary: '板橋車站可轉乘台鐵、高鐵、台北捷運板南線與新北捷運環狀線，是新北市的多系統轉乘站。軌島會把同名但分屬不同系統的站點合併提示。',
    transfer: '台鐵與高鐵站點在資料中相距約 14 公尺；板南線與環狀線也在步行轉乘範圍內。各系統仍有自己的月台、班表與即時資訊。',
    en: {
      title: 'Banqiao Station',
      summary: 'Banqiao Station connects TRA, HSR, the Taipei MRT Bannan Line and the New Taipei Metro Circular Line, making it a multi-system transfer station in New Taipei City. Rail Island groups same-name stations of different systems into one transfer hint.',
      transfer: 'In the data, the TRA and HSR stations are about 14 m apart, and the Bannan Line and the Circular Line are also within walking-transfer range. Each system still has its own platforms, timetable and live information.',
    },
    ja: {
      title: '板橋駅',
      summary: '板橋駅は、台鉄、高鉄、台北MRTの板南線、新北メトロ環状線に乗り換えられる、新北市の複数システムが集まる乗り換え駅です。軌島は、名前が同じでも別のシステムに属する駅を、ひとつの乗り換え案内にまとめて表示します。',
      transfer: 'データ上、台鉄と高鉄の駅は約14 m離れています。板南線と環状線も、徒歩で乗り換えられる範囲にあります。ホーム、時刻表、リアルタイム情報は、システムごとに別々です。',
    },
    ko: {
      title: '반차오역',
      summary: '반차오역은 대만철도 · 고속철도 · 타이베이 MRT 반난선 · 신베이 MRT 순환선 사이를 환승하는 신베이시의 주요 역이에요. 같은 이름의 다른 시스템 역을 환승 안내로 묶어요.',
      transfer: '데이터상 대만철도 · 고속철도 지점은 약 14m 떨어져 있고 반난선 · 순환선도 도보 환승 범위에 있어요. 각 시스템은 별도의 승강장 · 시간표 · 실시간 정보를 사용해요.',
    },
  },
  {
    slug: 'nangang',
    title: '南港車站',
    members: ['THSR:0990', 'TRA:0980', 'TRTC:BL22'],
    summary: '南港車站是台鐵、高鐵與台北捷運板南線的共站區域。軌島同時顯示三個系統，但不把「南港」與下一站「南港展覽館」混為一談。',
    transfer: '台鐵與高鐵站點相距約 25 公尺；板南線南港站在同一轉乘區域。南港展覽館是另一個捷運站，請依實際站內指標前往。',
    en: {
      title: 'Nangang Station',
      summary: 'Nangang Station is a shared station area for TRA, HSR and the Taipei MRT Bannan Line. Rail Island shows all three systems, and does not confuse Nangang with the next station, Taipei Nangang Exhibition Center.',
      transfer: 'The TRA and HSR stations are about 25 m apart, and Bannan Line Nangang Station is in the same transfer area. Taipei Nangang Exhibition Center is a different metro station, so follow the signs inside the station.',
    },
    ja: {
      title: '南港駅',
      summary: '南港駅は、台鉄、高鉄、台北MRT板南線が集まる駅エリアです。軌島は3つのシステムを同時に表示しますが、「南港」と次の駅「南港展覧館」は区別して扱います。',
      transfer: '台鉄と高鉄の駅は約25 m離れており、板南線の南港駅も同じ乗り換えエリアにあります。南港展覧館は別のMRT駅なので、駅構内の案内表示に従って向かってください。',
    },
    ko: {
      title: '난강역',
      summary: '난강역은 대만철도 · 고속철도 · 타이베이 MRT 반난선의 환승 구역이에요. 세 시스템을 함께 표시하되 다음 역인 난강전람관과 혼동하지 않아요.',
      transfer: '대만철도 · 고속철도 지점은 약 25m 떨어져 있고 반난선 난강역도 같은 환승 구역에 있어요. 난강전람관은 다른 역이니 현장 표지판을 확인하세요.',
    },
  },
  {
    slug: 'songshan',
    title: '松山車站',
    members: ['TRA:0990', 'TRTC:G19'],
    summary: '松山車站可轉乘台鐵與台北捷運松山新店線。軌島會把兩個系統的同名站點連結，但列車位置、班表與看板仍各自依來源計算。',
    transfer: '台鐵松山站與捷運松山站在資料中相距約 166 公尺，屬步行轉乘。這裡的松山站不是松山機場站。',
    en: {
      title: 'Songshan Station',
      summary: 'Songshan Station connects TRA and the Taipei MRT Songshan-Xindian Line. Rail Island links the same-name stations of the two systems, but train positions, timetables and departure boards are still calculated from each system\'s own sources.',
      transfer: 'In the data, TRA Songshan Station and the metro\'s Songshan Station are about 166 m apart, a walking transfer. This Songshan is not Songshan Airport Station.',
    },
    ja: {
      title: '松山駅',
      summary: '松山駅では、台鉄と台北MRTの松山新店線に乗り換えられます。軌島は2つのシステムの同名駅を結び付けますが、列車の位置、時刻表、発車案内は、それぞれの情報源から計算します。',
      transfer: 'データ上、台鉄の松山駅とMRTの松山駅は約166 m離れており、徒歩での乗り換えにあたります。ここでいう松山駅は、松山空港駅ではありません。',
    },
    ko: {
      title: '쑹산역',
      summary: '쑹산역에서는 대만철도와 타이베이 MRT 쑹산신뎬선을 환승해요. 동명 역을 연결하되 위치 · 시간표 · 전광판은 각각의 출처로 계산해요.',
      transfer: '대만철도 쑹산역 · MRT 쑹산역은 데이터상 약 166m 떨어져 있어 도보 환승이에요. 이곳 쑹산역은 쑹산 공항역과 달라요.',
    },
  },
  {
    slug: 'taoyuan',
    title: '台鐵桃園車站',
    members: ['TRA:1080'],
    summary: '台鐵桃園車站位於桃園市桃園區，軌島以台鐵西部幹線的班表與官方即時誤點呈現列車。它不是位於青埔的高鐵桃園站。',
    transfer: '台鐵桃園站與高鐵桃園站是不同地點，不能在同一站體內轉乘；查詢與集合時應確認自己要去的是「台鐵桃園」或「高鐵桃園」。',
    en: {
      title: 'TRA Taoyuan Station',
      summary: 'TRA Taoyuan Station is in Taoyuan District, Taoyuan City. Rail Island shows its trains from the TRA Western Main Line timetable and official real-time delays. It is not Taoyuan HSR Station in Cingpu.',
      transfer: 'TRA Taoyuan and Taoyuan HSR are different places and cannot be transferred between inside one station building. When searching or arranging to meet, check whether you mean "TRA Taoyuan" or "HSR Taoyuan".',
    },
    ja: {
      title: '台鉄桃園駅',
      summary: '台鉄桃園駅は桃園市桃園区にあります。軌島は台鉄西部幹線の時刻表と公式のリアルタイム遅延情報で列車を表示します。青埔にある高鉄桃園駅とは別の駅です。',
      transfer: '台鉄桃園駅と高鉄桃園駅は別の場所にあり、ひとつの駅舎の中で乗り換えることはできません。検索や待ち合わせでは、「台鉄桃園」なのか「高鉄桃園」なのかを確認してください。',
    },
    ko: {
      title: '대만철도 타오위안역',
      summary: '대만철도 타오위안역은 타오위안시 타오위안구에 있어요. 서부 간선 시간표와 공식 실시간 지연을 반영하며 칭푸의 고속철도 타오위안역과는 달라요.',
      transfer: '대만철도 · 고속철도 타오위안역은 서로 다른 장소이며 한 역사 안에서 환승할 수 없어요. 조회하거나 약속을 잡을 때 어느 역인지 확인하세요.',
    },
  },
  {
    slug: 'taoyuan-hsr',
    title: '高鐵桃園站',
    members: ['THSR:1020', 'TYMC:A18'],
    summary: '高鐵桃園站位於桃園青埔，可轉乘桃園機場捷運 A18 高鐵桃園站。軌島把高鐵與機場捷運分別呈現，再標示為可轉乘。',
    transfer: '高鐵與機場捷運站點在資料中相距約 119 公尺。本站與桃園市區的台鐵桃園車站不是同一站。',
    en: {
      title: 'Taoyuan HSR Station',
      summary: 'Taoyuan HSR Station is in Cingpu, Taoyuan, and connects to Taoyuan Airport MRT station A18 Taoyuan HSR Station. Rail Island shows HSR and the Airport MRT separately, then marks them as a transfer.',
      transfer: 'In the data, the HSR station and the Airport MRT station are about 119 m apart. This station is not the same as TRA Taoyuan Station in downtown Taoyuan.',
    },
    ja: {
      title: '高鉄桃園駅',
      summary: '高鉄桃園駅は桃園の青埔にあり、桃園空港MRTのA18高鉄桃園駅に乗り換えられます。軌島は高鉄と空港MRTを別々に表示し、そのうえで乗り換え可能として示します。',
      transfer: 'データ上、高鉄の駅と空港MRTの駅は約119 m離れています。この駅は、桃園市街地の台鉄桃園駅とは別の駅です。',
    },
    ko: {
      title: '고속철도 타오위안역',
      summary: '고속철도 타오위안역은 칭푸에 있으며 타오위안 공항 MRT A18로 환승할 수 있어요. 각 시스템을 따로 표시하고 환승 가능함을 안내해요.',
      transfer: '고속철도 · 타오위안 공항 MRT 지점은 데이터상 약 119m 떨어져 있어요. 타오위안 도심의 대만철도 타오위안역과는 달라요.',
    },
  },
  {
    slug: 'hsinchu',
    title: '台鐵新竹車站',
    members: ['TRA:1210'],
    summary: '台鐵新竹車站位於新竹市區，軌島以台鐵西部幹線班表與官方即時誤點呈現列車。它與竹北六家地區的高鐵新竹站不是同一地點。',
    transfer: '要轉乘高鐵時，需前往高鐵新竹站／台鐵六家站的共站區域；不能把台鐵新竹站視為高鐵共站。',
    en: {
      title: 'TRA Hsinchu Station',
      summary: 'TRA Hsinchu Station is in the city of Hsinchu. Rail Island shows its trains from the TRA Western Main Line timetable and official real-time delays. It is not the same place as Hsinchu HSR Station in the Zhubei Liujia area.',
      transfer: 'To transfer to HSR, go to the shared station area of Hsinchu HSR Station and TRA Liujia Station. TRA Hsinchu Station should not be treated as sharing a station with HSR.',
    },
    ja: {
      title: '台鉄新竹駅',
      summary: '台鉄新竹駅は新竹市街地にあります。軌島は台鉄西部幹線の時刻表と公式のリアルタイム遅延情報で列車を表示します。竹北の六家エリアにある高鉄新竹駅とは別の場所です。',
      transfer: '高鉄に乗り換えるには、高鉄新竹駅と台鉄六家駅が並ぶエリアへ向かう必要があります。台鉄新竹駅は高鉄と駅を共用していません。',
    },
    ko: {
      title: '대만철도 신주역',
      summary: '대만철도 신주역은 신주시 중심부에 있어요. 서부 간선 시간표와 공식 실시간 지연을 반영하며 주베이 류자 지역의 고속철도 신주역과는 다른 장소예요.',
      transfer: '고속철도로 환승하려면 고속철도 신주역 · 대만철도 류자역 구역으로 이동해야 해요. 대만철도 신주역을 고속철도 공용 역으로 생각하면 안 돼요.',
    },
  },
  {
    slug: 'hsinchu-hsr',
    title: '高鐵新竹站',
    members: ['THSR:1030', 'TRA:1194'],
    summary: '高鐵新竹站可步行轉乘台鐵六家線的六家站。軌島把高鐵新竹與台鐵六家視為轉乘組，但保留兩個實際站名。',
    transfer: '高鐵新竹站與台鐵六家站在資料中相距約 122 公尺。它們與新竹市區的台鐵新竹站是不同地點。',
    en: {
      title: 'Hsinchu HSR Station',
      summary: 'Hsinchu HSR Station is a walking transfer to TRA Liujia Station on the Liujia Line. Rail Island treats HSR Hsinchu and TRA Liujia as one transfer group but keeps the two actual station names.',
      transfer: 'In the data, Hsinchu HSR Station and TRA Liujia Station are about 122 m apart. They are different places from TRA Hsinchu Station in downtown Hsinchu.',
    },
    ja: {
      title: '高鉄新竹駅',
      summary: '高鉄新竹駅からは、台鉄六家線の六家駅へ徒歩で乗り換えられます。軌島は高鉄新竹と台鉄六家を乗り換えのグループとして扱いますが、実際の駅名は両方そのまま残しています。',
      transfer: 'データ上、高鉄新竹駅と台鉄六家駅は約122 m離れています。どちらも、新竹市街地の台鉄新竹駅とは別の場所です。',
    },
    ko: {
      title: '고속철도 신주역',
      summary: '고속철도 신주역에서는 대만철도 류자선 류자역으로 걸어서 환승해요. 환승 구역으로 묶되 두 역명을 유지해요.',
      transfer: '고속철도 신주역 · 대만철도 류자역은 데이터상 약 122m 떨어져 있어요. 신주 도심의 대만철도 신주역과는 다른 장소예요.',
    },
  },
  {
    slug: 'miaoli-hsr',
    title: '高鐵苗栗站',
    members: ['THSR:1035', 'TRA:3150'],
    summary: '高鐵苗栗站可步行轉乘台鐵豐富站。軌島把高鐵苗栗與台鐵豐富視為轉乘組，但保留兩個實際站名。',
    transfer: `高鐵苗栗站與台鐵豐富站在資料中相距約 ${pairM('THSR:1035', 'TRA:3150')} 公尺。台鐵另有苗栗站，與高鐵苗栗站在資料中相距約 ${kmBetween('THSR:1035', 'TRA:3160')} 公里，不是同一站。`,
    en: {
      title: 'Miaoli HSR Station',
      summary: 'Miaoli HSR Station is a walking transfer to TRA Fengfu Station. Rail Island treats HSR Miaoli and TRA Fengfu as one transfer group but keeps the two actual station names.',
      transfer: `In the data, Miaoli HSR Station and TRA Fengfu Station are about ${pairM('THSR:1035', 'TRA:3150')} m apart. TRA also has a separate Miaoli Station, which is about ${kmBetween('THSR:1035', 'TRA:3160')} km from Miaoli HSR Station in the data and is not the same station.`,
    },
    ja: {
      title: '高鉄苗栗駅',
      summary: '高鉄苗栗駅は、台鉄の豊富駅に徒歩で乗り換えられます。軌島は高鉄苗栗と台鉄豊富を乗り換えのグループとして扱いますが、実際の駅名は両方そのまま残しています。',
      transfer: `データ上、高鉄苗栗駅と台鉄豊富駅は約${pairM('THSR:1035', 'TRA:3150')} m離れています。台鉄には別に苗栗駅があり、データ上は高鉄苗栗駅から約${kmBetween('THSR:1035', 'TRA:3160')} km離れていて、同じ駅ではありません。`,
    },
    ko: {
      title: '고속철도 먀오리역',
      summary: '고속철도 먀오리역에서는 대만철도 펑푸역으로 걸어서 환승해요. 환승 구역으로 묶되 두 역명을 유지해요.',
      transfer: `고속철도 먀오리역 · 대만철도 펑푸역은 데이터상 약 ${pairM('THSR:1035', 'TRA:3150')}m 떨어져 있어요. 대만철도에는 먀오리역이 따로 있으며 고속철도 먀오리역에서 데이터상 약 ${kmBetween('THSR:1035', 'TRA:3160')}km 떨어진 다른 역이에요.`,
    },
  },
  {
    slug: 'taichung',
    title: '台鐵台中車站',
    members: ['TRA:3300'],
    summary: '台鐵台中車站位於台中市中區，軌島以台鐵西部幹線班表與官方即時誤點呈現列車。它不是烏日的高鐵台中站。',
    transfer: '高鐵台中站的鐵路轉乘點是台鐵新烏日站與台中捷運高鐵台中站；台鐵台中站是另一個車站。',
    en: {
      title: 'TRA Taichung Station',
      summary: 'TRA Taichung Station is in the Central District of Taichung. Rail Island shows its trains from the TRA Western Main Line timetable and official real-time delays. It is not Taichung HSR Station in Wuri.',
      transfer: 'The railway transfer points for Taichung HSR Station are TRA Xinwuri Station and Taichung MRT HSR Taichung Station; TRA Taichung Station is a different station.',
    },
    ja: {
      title: '台鉄台中駅',
      summary: '台鉄台中駅は台中市中区にあります。軌島は台鉄西部幹線の時刻表と公式のリアルタイム遅延情報で列車を表示します。烏日にある高鉄台中駅とは別の駅です。',
      transfer: '高鉄台中駅の鉄道の乗り換え先は、台鉄新烏日駅と台中MRTの高速鉄道台中駅です。台鉄台中駅は、それらとは別の駅です。',
    },
    ko: {
      title: '대만철도 타이중역',
      summary: '대만철도 타이중역은 타이중시 중구에 있어요. 서부 간선 시간표 · 공식 실시간 지연을 반영하며 우르의 고속철도 타이중역과는 달라요.',
      transfer: '고속철도 타이중역의 철도 환승역은 대만철도 신우르역과 타이중 MRT 고속철도 타이중역이에요. 대만철도 타이중역은 별개의 역이에요.',
    },
  },
  {
    slug: 'taichung-hsr',
    title: '高鐵台中站',
    members: ['THSR:1040', 'TMRT:G17', 'TRA:3340'],
    summary: '高鐵台中站位於烏日，可轉乘台鐵新烏日站與台中捷運高鐵台中站。軌島保留三個系統各自的站名與班表，再標示轉乘關係。',
    transfer: '台中捷運站與台鐵新烏日站在資料中相距約 84 公尺；高鐵站點與兩者也在步行轉乘範圍內。這裡不是台中市區的台鐵台中站。',
    en: {
      title: 'Taichung HSR Station',
      summary: 'Taichung HSR Station is in Wuri and connects to TRA Xinwuri Station and Taichung MRT HSR Taichung Station. Rail Island keeps each system\'s own station name and timetable, then marks the transfer relationships.',
      transfer: 'In the data, the Taichung MRT station and TRA Xinwuri Station are about 84 m apart, and the HSR station is also within walking-transfer range of both. This is not TRA Taichung Station in downtown Taichung.',
    },
    ja: {
      title: '高鉄台中駅',
      summary: '高鉄台中駅は烏日にあり、台鉄新烏日駅と台中MRTの高速鉄道台中駅に乗り換えられます。軌島は3つのシステムそれぞれの駅名と時刻表を残したうえで、乗り換え関係を示します。',
      transfer: 'データ上、台中MRTの駅と台鉄新烏日駅は約84 m離れており、高鉄の駅もその両方から徒歩で乗り換えられる範囲にあります。ここは、台中市街地の台鉄台中駅ではありません。',
    },
    ko: {
      title: '고속철도 타이중역',
      summary: '고속철도 타이중역은 우르에 있고 대만철도 신우르역 · 타이중 MRT 고속철도 타이중역과 환승해요. 세 시스템의 역명과 시간표를 유지하며 환승 관계를 표시해요.',
      transfer: '타이중 MRT · 대만철도 신우르역은 데이터상 약 84m 떨어져 있고 고속철도역도 도보 환승 범위에 있어요. 이곳은 타이중 도심의 대만철도 타이중역과 달라요.',
    },
  },
  {
    slug: 'changhua-hsr',
    title: '高鐵彰化站',
    members: ['THSR:1043'],
    summary: '高鐵彰化站是台灣高鐵車站。軌島的轉乘資料沒有列出它與其他鐵路站點的轉乘關係，台鐵彰化站是另一個車站，兩者不能混為一談。',
    transfer: `台鐵彰化站與高鐵彰化站在資料中相距約 ${kmBetween('THSR:1043', 'TRA:3360')} 公里，不是同一站。軌島的轉乘資料沒有把本站與任何台鐵站列為轉乘組；接駁與公車班次可能變動，請以營運單位或現場資訊為準。`,
    en: {
      title: 'Changhua HSR Station',
      summary: 'Changhua HSR Station is a Taiwan High Speed Rail station. Rail Island\'s transfer data does not list any transfer between it and another railway station. TRA Changhua Station is a different station, and the two should not be confused.',
      transfer: `In the data, TRA Changhua Station is about ${kmBetween('THSR:1043', 'TRA:3360')} km from Changhua HSR Station, so they are not the same station. Rail Island's transfer data does not group this station with any TRA station. Shuttle and bus services may change, so check the operator's information or the signs on site.`,
    },
    ja: {
      title: '高鉄彰化駅',
      summary: '高鉄彰化駅は台湾高速鉄道の駅です。軌島の乗り換えデータには、この駅とほかの鉄道駅との乗り換え関係は載っていません。台鉄彰化駅は別の駅なので、両者を取り違えないようにしてください。',
      transfer: `データ上、台鉄彰化駅と高鉄彰化駅は約${kmBetween('THSR:1043', 'TRA:3360')} km離れていて、同じ駅ではありません。軌島の乗り換えデータでは、この駅をどの台鉄の駅とも乗り換えのグループにしていません。シャトルバスや路線バスの運行は変わることがあるため、運営会社の情報や現地の案内で確認してください。`,
    },
    ko: {
      title: '고속철도 장화역',
      summary: '고속철도 장화역은 대만 고속철도의 역이에요. Rail Island의 환승 정보에는 다른 철도역과의 환승 관계가 없어요. 대만철도 장화역은 별개의 역이니 혼동하지 마세요.',
      transfer: `대만철도 장화역과 고속철도 장화역은 데이터상 약 ${kmBetween('THSR:1043', 'TRA:3360')}km 떨어진 다른 역이에요. Rail Island의 환승 정보는 이 역을 어떤 대만철도역과도 환승 구역으로 묶지 않아요. 셔틀 · 버스 시간은 바뀔 수 있으니 운영사나 현장 안내를 확인하세요.`,
    },
  },
  {
    slug: 'yunlin-hsr',
    title: '高鐵雲林站',
    members: ['THSR:1047'],
    summary: '高鐵雲林站是台灣高鐵車站。軌島的轉乘資料沒有列出它與其他鐵路站點的轉乘關係。',
    transfer: '軌島的轉乘資料沒有把本站與任何其他鐵路站點列為轉乘組。本站頁面只描述軌島收錄的鐵路系統；接駁與公車班次可能變動，請以營運單位或現場資訊為準。',
    en: {
      title: 'Yunlin HSR Station',
      summary: 'Yunlin HSR Station is a Taiwan High Speed Rail station. Rail Island\'s transfer data does not list any transfer between it and another railway station.',
      transfer: 'Rail Island\'s transfer data does not group this station with any other railway station. This page only describes the railway systems Rail Island includes. Shuttle and bus services may change, so check the operator\'s information or the signs on site.',
    },
    ja: {
      title: '高鉄雲林駅',
      summary: '高鉄雲林駅は台湾高速鉄道の駅です。軌島の乗り換えデータには、この駅とほかの鉄道駅との乗り換え関係は載っていません。',
      transfer: '軌島の乗り換えデータでは、この駅をほかのどの鉄道駅とも乗り換えのグループにしていません。この駅のページでは、軌島が収録している鉄道システムだけを説明します。シャトルバスや路線バスの運行は変わることがあるため、運営会社の情報や現地の案内で確認してください。',
    },
    ko: {
      title: '고속철도 윈린역',
      summary: '고속철도 윈린역은 대만 고속철도의 역이에요. Rail Island의 환승 정보에는 다른 철도역과의 환승 관계가 없어요.',
      transfer: 'Rail Island의 환승 정보는 이 역을 다른 철도역과 환승 구역으로 묶지 않아요. 이 페이지는 Rail Island에 수록된 철도 시스템만 설명해요. 셔틀 · 버스 시간은 바뀔 수 있으니 운영사나 현장 안내를 확인하세요.',
    },
  },
  {
    slug: 'tainan',
    title: '台鐵台南車站',
    members: ['TRA:4220'],
    summary: '台鐵台南車站位於台南市東區，軌島以台鐵西部幹線班表與官方即時誤點呈現列車。它不是歸仁的高鐵台南站。',
    transfer: '前往高鐵台南站通常要轉往與高鐵共站的台鐵沙崙站；「台鐵台南」與「高鐵台南」不可當成同一站。',
    en: {
      title: 'TRA Tainan Station',
      summary: 'TRA Tainan Station is in the East District of Tainan. Rail Island shows its trains from the TRA Western Main Line timetable and official real-time delays. It is not Tainan HSR Station in Guiren.',
      transfer: 'To reach Tainan HSR Station you usually go via TRA Shalun Station, which shares the HSR station area. "TRA Tainan" and "HSR Tainan" must not be treated as the same station.',
    },
    ja: {
      title: '台鉄台南駅',
      summary: '台鉄台南駅は台南市東区にあります。軌島は台鉄西部幹線の時刻表と公式のリアルタイム遅延情報で列車を表示します。帰仁にある高鉄台南駅とは別の駅です。',
      transfer: '高鉄台南駅へ行くには、高鉄と駅を共用している台鉄沙崙駅を経由するのが一般的です。「台鉄台南」と「高鉄台南」を同じ駅として扱わないでください。',
    },
    ko: {
      title: '대만철도 타이난역',
      summary: '대만철도 타이난역은 타이난시 동구에 있어요. 서부 간선 시간표 · 공식 실시간 지연을 반영하며 구이런의 고속철도 타이난역과는 달라요.',
      transfer: '고속철도 타이난역으로 가려면 보통 같은 구역의 대만철도 사룬역으로 이동해요. 대만철도 타이난역과 고속철도 타이난역을 같은 역으로 생각하면 안 돼요.',
    },
  },
  {
    slug: 'tainan-hsr',
    title: '高鐵台南站',
    members: ['THSR:1060', 'TRA:4272'],
    summary: '高鐵台南站位於歸仁，可步行轉乘台鐵沙崙線的沙崙站。軌島把兩者列為轉乘組，但保留「台南」與「沙崙」兩個站名。',
    transfer: '高鐵台南站與台鐵沙崙站在資料中相距約 112 公尺。它們與台南市區的台鐵台南站是不同地點。',
    en: {
      title: 'Tainan HSR Station',
      summary: 'Tainan HSR Station is in Guiren and is a walking transfer to TRA Shalun Station on the Shalun Line. Rail Island lists them as a transfer group but keeps the two names, "Tainan" and "Shalun".',
      transfer: 'In the data, Tainan HSR Station and TRA Shalun Station are about 112 m apart. They are different places from TRA Tainan Station in downtown Tainan.',
    },
    ja: {
      title: '高鉄台南駅',
      summary: '高鉄台南駅は帰仁にあり、台鉄沙崙線の沙崙駅へ徒歩で乗り換えられます。軌島は両者を乗り換えのグループとして扱いますが、「台南」と「沙崙」の2つの駅名は残しています。',
      transfer: 'データ上、高鉄台南駅と台鉄沙崙駅は約112 m離れています。どちらも、台南市街地の台鉄台南駅とは別の場所です。',
    },
    ko: {
      title: '고속철도 타이난역',
      summary: '고속철도 타이난역은 구이런에 있고 대만철도 사룬선 사룬역으로 걸어서 환승해요. 환승으로 묶되 타이난 · 사룬 역명을 각각 유지해요.',
      transfer: '고속철도 타이난역 · 대만철도 사룬역은 데이터상 약 112m 떨어져 있어요. 타이난 도심의 대만철도 타이난역과는 다른 장소예요.',
    },
  },
  {
    slug: 'zuoying',
    title: '左營轉乘站',
    members: ['KRTC:R16', 'THSR:1070', 'TRA:4340'],
    summary: '左營轉乘區可搭高鐵、台鐵新左營站與高雄捷運紅線左營站。軌島用各系統的正式站名顯示，再以轉乘組連結。',
    transfer: '高鐵左營與台鐵新左營站點相距約 74 公尺；捷運左營站也在步行轉乘範圍內。台鐵另外還有「左營（舊城）」站名脈絡，查詢時以畫面標示為準。',
    en: {
      title: 'Zuoying Transfer Station',
      summary: 'The Zuoying transfer area has HSR, TRA Xinzuoying Station and Kaohsiung MRT Red Line Zuoying Station. Rail Island shows each system\'s official station name and links them as a transfer group.',
      transfer: 'HSR Zuoying and TRA Xinzuoying are about 74 m apart, and the metro\'s Zuoying Station is also within walking-transfer range. TRA also has a station name in the "Zuoying (Old City)" context; when searching, go by the label shown on screen.',
    },
    ja: {
      title: '左営乗り換え駅',
      summary: '左営の乗り換えエリアでは、高鉄、台鉄新左営駅、高雄MRT赤線の左営駅を利用できます。軌島は各システムの正式な駅名で表示し、乗り換えのグループとして結び付けます。',
      transfer: '高鉄の左営駅と台鉄の新左営駅は約74 m離れており、MRTの左営駅も徒歩で乗り換えられる範囲にあります。台鉄には「左営（旧城）」という駅名の系統もあるため、検索するときは画面の表示に従ってください。',
    },
    ko: {
      title: '쭤잉 환승역',
      summary: '쭤잉 환승 구역에는 고속철도 · 대만철도 신쭤잉역 · 가오슝 MRT 레드라인 쭤잉역이 있어요. 각 정식 역명을 표시하고 환승 구역으로 연결해요.',
      transfer: '고속철도 쭤잉 · 대만철도 신쭤잉은 약 74m 떨어져 있고 MRT 쭤잉역도 도보 환승 범위에 있어요. 대만철도에는 쭤잉(구도시)역도 있으니 화면의 역명을 확인하세요.',
    },
  },
  {
    slug: 'kaohsiung',
    title: '高雄車站',
    members: ['KRTC:R11', 'TRA:4400'],
    summary: '高雄車站可轉乘台鐵與高雄捷運紅線。軌島會連結兩個系統的同名站點，但台鐵班表與捷運到站資訊仍分開處理。',
    transfer: '台鐵與高雄捷運站點在資料中相距約 34 公尺，屬同一轉乘區域。高鐵在左營，不在高雄車站停靠。',
    en: {
      title: 'Kaohsiung Main Station',
      summary: 'Kaohsiung Main Station connects TRA and the Kaohsiung MRT Red Line. Rail Island links the same-name stations of the two systems, but TRA timetables and metro arrival information are still handled separately.',
      transfer: 'In the data, the TRA and Kaohsiung MRT stations are about 34 m apart, in the same transfer area. HSR trains use Zuoying and do not stop at Kaohsiung Main Station.',
    },
    ja: {
      title: '高雄駅',
      summary: '高雄駅では、台鉄と高雄MRT赤線に乗り換えられます。軌島は2つのシステムの同名駅を結び付けますが、台鉄の時刻表とMRTの到着情報は別々に扱います。',
      transfer: 'データ上、台鉄と高雄MRTの駅は約34 m離れており、同じ乗り換えエリアにあります。高鉄は左営に停車し、高雄駅には停車しません。',
    },
    ko: {
      title: '가오슝역',
      summary: '가오슝역에서는 대만철도 · 가오슝 MRT 레드라인으로 환승해요. 동명 역을 연결하되 철도 시간표와 MRT 도착 정보는 따로 처리해요.',
      transfer: '대만철도 · 가오슝 MRT 지점은 데이터상 약 34m 떨어진 같은 환승 구역이에요. 고속철도는 쭤잉에 정차하며 가오슝역에는 정차하지 않아요.',
    },
  },
  {
    slug: 'hualien',
    title: '花蓮車站',
    members: ['TRA:7000'],
    summary: '花蓮車站是台鐵東部幹線的重要車站。軌島依官方班表繪製列車，並在台鐵即時資料可用時套用官方誤點。',
    transfer: '本站的主要鐵路服務是台鐵；軌島不會把公路客運或觀光接駁班次混入鐵路發車看板。實際轉乘請查看現場與營運單位資訊。',
    en: {
      title: 'Hualien Station',
      summary: 'Hualien Station is a major station on the TRA Eastern Main Line. Rail Island draws trains from the official timetable and applies official delays when TRA real-time data is available.',
      transfer: 'The main rail service at this station is TRA. Rail Island does not mix road coach or sightseeing shuttle services into the rail departure boards. For actual transfers, check the information on site and from the operators.',
    },
    ja: {
      title: '花蓮駅',
      summary: '花蓮駅は台鉄東部幹線の主要駅です。軌島は公式時刻表から列車を描き、台鉄のリアルタイムデータが使える場合は公式の遅れを反映します。',
      transfer: 'この駅の主な鉄道サービスは台鉄です。軌島は、路線バスや観光シャトルの便を鉄道の発車案内に混ぜて表示しません。実際の乗り換えは、現地や運営会社の情報で確認してください。',
    },
    ko: {
      title: '화롄역',
      summary: '화롄역은 대만철도 동부 간선의 주요 역이에요. 공식 시간표로 열차를 그리고 실시간 정보가 있으면 공식 지연을 반영해요.',
      transfer: '이 역의 주요 철도 서비스는 대만철도예요. 시외버스 · 관광 셔틀은 철도 출발 전광판에 섞지 않아요. 실제 환승은 현장 · 운영사 안내를 확인하세요.',
    },
  },
  {
    slug: 'taitung',
    title: '台東車站',
    members: ['TRA:6000'],
    summary: '台東車站是台鐵東部幹線與南迴線的交會站。軌島依官方班表呈現列車，並在即時資料可用時套用台鐵官方誤點。',
    transfer: '軌島的轉乘資料在本站著重鐵路路線交會，不代表不同月台間的實際步行時間。是否趕得上轉乘仍應以現場資訊判斷。',
    en: {
      title: 'Taitung Station',
      summary: 'Taitung Station is where the TRA Eastern Main Line and the South Link Line meet. Rail Island shows trains from the official timetable and applies official TRA delays when real-time data is available.',
      transfer: 'For this station, Rail Island\'s transfer data focuses on where railway lines meet. It does not show the actual walking time between platforms, so check on-site information to judge whether you can make a connection.',
    },
    ja: {
      title: '台東駅',
      summary: '台東駅は、台鉄東部幹線と南迴線が交わる駅です。軌島は公式時刻表にもとづいて列車を表示し、リアルタイムデータが使える場合は台鉄の公式の遅れを反映します。',
      transfer: 'この駅について、軌島の乗り換えデータは鉄道路線が交わる点に重点を置いています。ホーム間の実際の歩行時間を示すものではなく、乗り継ぎに間に合うかどうかは現地の案内で判断してください。',
    },
    ko: {
      title: '타이둥역',
      summary: '타이둥역은 동부 간선과 남회선이 만나는 역이에요. 공식 시간표를 바탕으로 실시간 정보가 있으면 공식 지연을 반영해요.',
      transfer: '이 역의 환승 정보는 철도 노선이 만나는 관계를 나타내며 실제 승강장 간 도보 시간이 아니에요. 환승 가능 여부는 현장 정보를 확인하세요.',
    },
  },
  {
    slug: 'yilan',
    title: '宜蘭車站',
    members: ['TRA:7190'],
    summary: '宜蘭車站位於台鐵東部幹線的宜蘭線。軌島依官方班表呈現列車，並在台鐵即時資料可用時套用官方誤點。',
    transfer: '本頁提供車站與路線資訊，以及每週更新一次的時刻表；當下的發車班次、停駛與誤點請直接回到軌島即時地圖查看。',
    en: {
      title: 'Yilan Station',
      summary: 'Yilan Station is on the Yilan Line of the TRA Eastern Main Line. Rail Island shows trains from the official timetable and applies official delays when TRA real-time data is available.',
      transfer: 'This page gives station and line information plus a timetable that is updated once a week. For current departures, suspensions and delays, go back to the Rail Island live map.',
    },
    ja: {
      title: '宜蘭駅',
      summary: '宜蘭駅は、台鉄東部幹線の宜蘭線にあります。軌島は公式時刻表にもとづいて列車を表示し、台鉄のリアルタイムデータが使える場合は公式の遅れを反映します。',
      transfer: 'このページでは、駅と路線の情報に加えて、週に1回更新する時刻表を掲載しています。現在の発車、運休、遅れは、軌島のライブ地図で確認してください。',
    },
    ko: {
      title: '이란역',
      summary: '이란역은 동부 간선의 이란선에 있어요. 공식 시간표를 바탕으로 실시간 정보가 있으면 공식 지연을 반영해요.',
      transfer: '이 페이지는 역 · 노선 정보와 주 1회 갱신되는 시간표를 담고 있어요. 현재 출발 열차 · 운휴 · 지연은 Rail Island 실시간 지도에서 확인하세요.',
    },
  },
  {
    slug: 'chiayi',
    title: '嘉義車站',
    members: ['AFR:360', 'TRA:4080'],
    summary: '嘉義車站可搭台鐵，也與阿里山林業鐵路嘉義站共站。軌島分別顯示兩種鐵路的班表與列車，再標示為可轉乘。',
    transfer: '台鐵與阿里山林鐵站點在資料中相距約 18 公尺。高鐵嘉義站位於另一地點，不屬於這個共站區域。',
    en: {
      title: 'Chiayi Station',
      summary: 'Chiayi Station is served by TRA and shares its site with Alishan Forest Railway Chiayi Station. Rail Island shows the timetables and trains of the two railways separately, then marks them as a transfer.',
      transfer: 'In the data, the TRA station and the Alishan Forest Railway station are about 18 m apart. Chiayi HSR Station is at a different location and is not part of this shared station area.',
    },
    ja: {
      title: '嘉義駅',
      summary: '嘉義駅では台鉄に乗れるほか、阿里山森林鉄道の嘉義駅と駅を共用しています。軌島は2つの鉄道の時刻表と列車を別々に表示し、そのうえで乗り換え可能として示します。',
      transfer: 'データ上、台鉄の駅と阿里山森林鉄道の駅は約18 m離れています。高鉄の嘉義駅は別の場所にあり、この共用駅エリアには含まれません。',
    },
    ko: {
      title: '자이역',
      summary: '자이역에서는 대만철도 · 아리산 삼림철도를 이용할 수 있어요. 각 시간표와 열차를 따로 표시하며 환승 가능함을 안내해요.',
      transfer: '대만철도 · 아리산 삼림철도 지점은 데이터상 약 18m 떨어져 있어요. 고속철도 자이역은 다른 곳에 있어 이 환승 구역에 속하지 않아요.',
    },
  },
  {
    slug: 'chiayi-hsr',
    title: '高鐵嘉義站',
    members: ['THSR:1050'],
    summary: '高鐵嘉義站是台灣高鐵車站，與嘉義市區的台鐵嘉義站不是同一地點。軌島在地圖與索引中把兩者分開，避免同名誤認。',
    transfer: '本站頁面只描述軌島收錄的鐵路系統；接駁與公車班次可能變動，請以營運單位或現場資訊為準。',
    en: {
      title: 'Chiayi HSR Station',
      summary: 'Chiayi HSR Station is a Taiwan High Speed Rail station and is not in the same place as TRA Chiayi Station in downtown Chiayi. Rail Island keeps the two apart on the map and in the index to avoid mixing up same-name stations.',
      transfer: 'This page only describes the railway systems Rail Island includes. Shuttle and bus services may change, so check the operator\'s information or the signs on site.',
    },
    ja: {
      title: '高鉄嘉義駅',
      summary: '高鉄嘉義駅は台湾高速鉄道の駅で、嘉義市街地の台鉄嘉義駅とは別の場所にあります。軌島は同名駅の取り違えを避けるため、地図でも索引でも両者を分けています。',
      transfer: 'この駅のページでは、軌島が収録している鉄道システムだけを説明します。シャトルバスや路線バスの運行は変わることがあるため、運営会社の情報や現地の案内で確認してください。',
    },
    ko: {
      title: '고속철도 자이역',
      summary: '고속철도 자이역은 자이 도심의 대만철도 자이역과 다른 장소예요. 지도와 목록에서도 따로 표시해 혼동을 줄여요.',
      transfer: '이 페이지는 Rail Island에 수록된 철도 시스템만 설명해요. 셔틀 · 버스 시간은 바뀔 수 있으니 운영사나 현장 안내를 확인하세요.',
    },
  },
  {
    slug: 'formosa-boulevard',
    title: '美麗島站',
    members: ['KRTC:O5', 'KRTC:R10'],
    summary: '美麗島站是高雄捷運紅線與橘線的轉乘站。軌島會把兩條路線的同名站點合併為轉乘提示，但各線列車與到站資訊仍分開計算。',
    transfer: '紅線與橘線在同一捷運轉乘站交會。資料中的兩個路線站點座標略有差異，代表不同路線的定位點，不是兩座互不相通的車站。',
    en: {
      title: 'Formosa Boulevard Station',
      summary: 'Formosa Boulevard Station is the transfer station between the Kaohsiung MRT Red Line and Orange Line. Rail Island merges the same-name stops of the two lines into one transfer hint, but each line\'s trains and arrival information are still calculated separately.',
      transfer: 'The Red Line and the Orange Line meet at the same metro transfer station. The two lines\' station points in the data differ slightly in coordinates because they are each line\'s positioning point, not two unconnected stations.',
    },
    ja: {
      title: '美麗島駅',
      summary: '美麗島駅は、高雄MRTの赤線とオレンジ線が乗り換える駅です。軌島は2路線の同名駅をひとつの乗り換え案内にまとめますが、各路線の列車と到着情報は別々に計算します。',
      transfer: '赤線とオレンジ線は、同じMRTの乗り換え駅で交わります。データ上の2つの路線の駅は座標がわずかに異なりますが、それぞれの路線の位置決めの点であり、互いにつながっていない2つの駅という意味ではありません。',
    },
    ko: {
      title: '메이리다오역',
      summary: '메이리다오역은 가오슝 MRT 레드라인 · 오렌지라인의 환승역이에요. 동명 노선 역을 환승 안내로 묶되 각 노선의 열차 · 도착 정보는 따로 계산해요.',
      transfer: '레드라인 · 오렌지라인은 같은 MRT 환승역에서 만나요. 데이터상 노선별 지점 좌표가 조금 다른 것은 각 노선의 기준점이며 서로 연결되지 않은 두 역이라는 뜻이 아니에요.',
    },
  },
];

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function jsonLd(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

// 所有輸出先收進記憶體，檔尾再依模式寫檔或比對。
const outputs = new Map();
function write(relative, content) {
  outputs.set(relative, content);
}

function head({ title, description, pathname, schema }) {
  const canonical = `${siteUrl}${pathname}`;
  const alternates = [['zh-Hant', canonical], ['ko', `${siteUrl}/ko${pathname}`], ['x-default', canonical]];
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="${canonical}">
${alternates.map(([code, href]) => `  <link rel="alternate" hreflang="${code}" href="${href}">`).join('\n')}
  <meta property="og:locale" content="zh_TW">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="軌島 Rail Island">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${siteUrl}/og-1200x630.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-180.png">
  <meta name="theme-color" content="#F2EDE2">
  ${THEME_BOOT}
  <link rel="stylesheet" href="/assets/aeo.css">
  <script type="application/ld+json">${jsonLd(schema)}</script>
</head>`;
}

function header() {
  return `<body>
  <a class="skip-link" href="#main">跳到主要內容</a>
  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href="/" aria-label="軌島首頁">${BRAND_MARK}<span>軌島 Rail Island</span></a>
      <nav class="site-nav" aria-label="主要導覽">
        <a href="/about/">關於</a>
        <a href="/accuracy/">準確度</a>
        <a href="/data-sources/">資料來源</a>
        <a href="/stations/">車站索引</a>
        <a class="nav-live" href="/">打開即時地圖</a>
      </nav>
    </div>
  </header>`;
}

function breadcrumbs(items) {
  return `<nav class="breadcrumbs" aria-label="麵包屑"><ol>${items.map((item, index) => `<li>${index === items.length - 1 ? escapeHtml(item.label) : `<a href="${item.href}">${escapeHtml(item.label)}</a>`}</li>`).join('')}</ol></nav>`;
}

function footer(extraLinks = '') {
  return `<footer class="site-footer">
    <div class="site-footer-inner">
      <div>軌島是獨立維護、原始碼公開可查的台灣鐵道即時動畫地圖，與各營運機構無關。</div>
      <div class="footer-links"><a href="/accuracy/">準確度與限制</a><a href="/data-sources/">資料來源</a><a href="https://github.com/siriushsu/taiwan-rail-live">GitHub 原始碼</a>${extraLinks}</div>
    </div>
  </footer>
</body>
</html>
`;
}

function pageSchema({ title, description, pathname, type = 'WebPage', extra = {}, modified = updated }) {
  return {
    '@context': 'https://schema.org',
    '@type': type,
    name: title,
    description,
    url: `${siteUrl}${pathname}`,
    inLanguage: 'zh-Hant',
    dateModified: modified,
    isPartOf: { '@type': 'WebSite', name: '軌島 Rail Island', url: `${siteUrl}/` },
    ...extra,
  };
}

function renderPage({ title, description, pathname, eyebrow, heading, lede, content, schema, crumbs = [] }) {
  return `${head({ title, description, pathname, schema })}
${header()}
  <main class="page-shell" id="main">
    ${breadcrumbs([{ label: '首頁', href: '/' }, ...crumbs, { label: heading }])}
    <section class="hero">
      <p class="eyebrow">${escapeHtml(eyebrow)}</p>
      <h1>${escapeHtml(heading)}</h1>
      <p class="lede">${escapeHtml(lede)}</p>
      <div class="hero-actions"><a class="button" href="/">打開即時地圖</a><a class="button secondary" href="/stations/">查車站資料</a></div>
    </section>
    ${content}
  </main>
${footer(`<a href="/ko${pathname}" hreflang="ko" lang="ko">한국어</a>`).replace('</body>', '<script src="/i18n/ko-public-pages.js"></script>\n<script src="/i18n/legal-pages.js"></script>\n</body>')}`;
}

// ── 捷運路線圖頁（階段 A，2026-09-29）：scripts/build_metro_pages.mjs，三語共 60 頁，全部由 data/ 產生 ──
const metro = buildMetroPages(root, { stationPages: stations, zhShell: { header, footer }, koText: K, escapeHtml });
for (const [relative, html] of metro.files) write(relative, html);
const sh = metro.shell;
const metroLinkSection = ({ h, text, href, label, hreflang }) => `<section class="content-section"><h2>${escapeHtml(h)}</h2><div class="answer-box"><p>${escapeHtml(text)}</p></div><p><a class="button secondary" href="${href}"${hreflang ? ` hreflang="${hreflang}"` : ''}>${escapeHtml(label)}</a></p></section>`;
const zhMetroSection = () => metroLinkSection({ h: metro.linkSectionText.zh.h, text: metro.linkSectionText.zh.text, href: metro.overviewHref('zh'), label: metro.linkSectionText.zh.link });
// 韓文沒有路線圖頁：入口文字查字典，連到英文版（overviewHref('ko')），按鈕標明語言
metro.linkSectionText.ko = { h: K(metro.linkSectionText.zh.h), text: K(metro.linkSectionText.zh.text), link: `${K(metro.linkSectionText.zh.link)}(영어)` };

// ── 關於／準確度／資料來源：中文頁與 /ko/ 韓文頁 ──
// 韓文頁把中文內文的文字節點換成字典譯文（i18n/legal-pages.js 在瀏覽器裡做的同一件事），只換外殼與站內連結；
// 內文新增一句中文而字典沒有，建置就 throw，兩邊不會漂開。
const koGuideDate = '2026-11-05';
const KO_GUIDE_LINKS = {
  '/': { href: '/?lang=ko' }, '/about/': { href: '/ko/about/' }, '/accuracy/': { href: '/ko/accuracy/' }, '/data-sources/': { href: '/ko/data-sources/' },
  '/stations/': { href: '/ko/stations/' }, '/metro/': { href: metro.overviewHref('ko'), hreflang: 'en' }, '/status.html': { href: '/status.html', hreflang: 'zh-Hant' },
};
const KO_GUIDE_ALT = { 'TDX 運輸資料流通服務標章 / Transport Data eXchange': 'TDX / Transport Data eXchange' };
function koGuideContent(html) {
  const out = html
    .replace(/href="(\/[^"]*)"/g, (all, href) => {
      const link = KO_GUIDE_LINKS[href];
      if (!link) throw new Error(`韓文說明頁沒有對應 ${href} 的連結（KO_GUIDE_LINKS）`);
      return `href="${link.href}"${link.hreflang ? ` hreflang="${link.hreflang}"` : ''}`;
    })
    .replace(/alt="([^"]*)"/g, (all, alt) => {
      if (!KO_GUIDE_ALT[alt]) throw new Error(`韓文說明頁沒有對應的圖片替代文字「${alt}」（KO_GUIDE_ALT）`);
      return `alt="${escapeHtml(KO_GUIDE_ALT[alt])}"`;
    })
    .replace(/>([^<>]+)</g, (all, text) => {
      const source = text.trim();
      if (!/\p{Script=Han}/u.test(source)) return all;
      const ko = source === metro.linkSectionText.zh.link ? metro.linkSectionText.ko.link : K(source);
      return `>${text.replace(source, () => escapeHtml(ko))}<`;
    });
  return out;
}
function koGuideHtml(page) {
  const pathname = `/ko${page.pathname}`, title = K(page.title), description = K(page.description), heading = K(page.heading);
  const alts = { zh: page.pathname, ko: pathname };
  const schema = { ...page.schema, name: title, description, url: `${siteUrl}${pathname}`, inLanguage: 'ko', dateModified: koGuideDate, isPartOf: { '@type': 'WebSite', name: 'Rail Island', url: `${siteUrl}/` } };
  return `${sh.headHtml('ko', { title, description, pathname, alts, schema })}
${sh.headerHtml('ko', alts)}
  <main class="page-shell" id="main">
    ${sh.crumbsHtml('ko', [{ label: K('首頁'), href: sh.homeHref('ko') }, { label: heading, href: pathname }])}
    <section class="hero">
      <p class="eyebrow">${escapeHtml(page.eyebrow)}</p>
      <h1>${escapeHtml(heading)}</h1>
      <p class="lede">${escapeHtml(K(page.lede))}</p>
      <div class="hero-actions"><a class="button" href="/?lang=ko">${escapeHtml(K('打開即時地圖'))}</a><a class="button secondary" href="/ko/stations/">${escapeHtml(K('查車站資料'))}</a></div>
    </section>
    ${koGuideContent(page.content)}
  </main>
${sh.footerHtml('ko', alts)}`;
}
function writeGuide(page) {
  write(`${page.pathname.slice(1)}index.html`, renderPage(page));
  write(`ko${page.pathname}index.html`, koGuideHtml(page));
}

const aboutDescription = '軌島是一張依官方時刻表與可用即時資料，呈現台灣台鐵、高鐵、捷運、輕軌與阿里山林鐵列車的動畫地圖，也能查看車站、班次與營運公告。';
writeGuide({
  title: '關於軌島：台灣鐵道即時動畫地圖',
  description: aboutDescription,
  pathname: '/about/',
  eyebrow: 'ABOUT RAIL ISLAND',
  heading: '軌島是什麼？',
  lede: aboutDescription,
  schema: pageSchema({ title: '關於軌島：台灣鐵道即時動畫地圖', description: aboutDescription, pathname: '/about/', type: 'AboutPage', modified: metro.templateDate }),
  content: `<section class="content-section"><h2>它怎麼運作</h2><div class="card-grid">
    <article class="card"><h3>收進同一張地圖</h3><p>台鐵、高鐵、各地捷運與輕軌、阿里山林鐵使用不同資料格式；軌島先整理路線、車站與班表，再放到同一時間軸。</p><a class="card-link" href="/data-sources/">看資料來源 →</a></article>
    <article class="card"><h3>依證據區分即時與推估</h3><p>有官方即時訊號的系統會用來校正；沒有逐車 GPS 的系統，列車位置是依班表、站間時間或官方到站倒數推演。</p><a class="card-link" href="/accuracy/">看準確度說明 →</a></article>
    <article class="card"><h3>免費、原始碼公開、獨立維護</h3><p>這是個人興趣專案，不是營運機構的官方服務。原始碼依 source-available 授權公開，可供檢視與個人研究；網站基本地圖與列車資訊免費使用。</p><a class="card-link" href="https://github.com/siriushsu/taiwan-rail-live">查看原始碼與授權 →</a></article>
  </div></section>
  ${zhMetroSection()}
  <section class="content-section"><h2>軌島適合回答什麼</h2><div class="answer-box"><ul class="answer-list">
    <li>現在地圖上有哪些台鐵、高鐵、捷運與輕軌列車？</li>
    <li>某個車站屬於哪些系統、可在哪裡轉乘？</li>
    <li>台鐵列車在官方即時資料可用時，目前大約準點或誤點多久？</li>
    <li>某個系統的列車位置是即時訊號，還是依班表推估？</li>
  </ul></div></section>
  <section class="content-section"><h2>不能取代官方行車資訊</h2><div class="notice"><strong>重要：</strong>軌島適合探索與輔助理解路網，不應作為趕車、安全決策或營運調度的唯一依據。臨時停駛、月台異動與現場狀況請以營運機構公告為準。</div></section>`,
});

const accuracyDescription = '軌島不是所有列車的 GPS 地圖：台鐵套用官方即時誤點；其他系統依可取得的官方到站資訊、時刻表或班距推演，並清楚標示限制。';
writeGuide({
  title: '軌島準確嗎？即時資料、推估方式與限制',
  description: accuracyDescription,
  pathname: '/accuracy/',
  eyebrow: 'ACCURACY & LIMITS',
  heading: '軌島準確嗎？',
  lede: accuracyDescription,
  schema: pageSchema({ title: '軌島準確嗎？即時資料、推估方式與限制', description: accuracyDescription, pathname: '/accuracy/' }),
  content: `<section class="content-section"><h2>一眼看懂資料層級</h2><div class="fact-table">
    <div class="fact-row"><div class="fact-label">台鐵</div><div class="fact-value">以官方時刻表為基礎；官方即時誤點可用時，校正列車在時間軸上的位置。資料過舊時會退回推估，不把舊資料假裝成 LIVE。</div></div>
    <div class="fact-row"><div class="fact-label">高鐵</div><div class="fact-value">依官方時刻表推演；軌島目前不宣稱有高鐵逐車 GPS 或官方即時誤點。</div></div>
    <div class="fact-row"><div class="fact-label">捷運與輕軌</div><div class="fact-value">依各系統可取得的官方逐班時刻、班距、到站倒數或列車動態校正。不同系統的即時程度不同。</div></div>
    <div class="fact-row"><div class="fact-label">阿里山林鐵</div><div class="fact-value">依公開班表與路線資料推演；日出相關列車會依日期資料處理，但仍應以官方公告為準。</div></div>
  </div></section>
  <section class="content-section"><h2>「列車在這裡」代表什麼</h2><div class="answer-box"><p>多數營運機構不提供可公開使用的逐車 GPS 座標。因此地圖上的移動位置常是把官方班表、站間行駛時間、停站時間與可用的即時到站訊號放在一起推算的結果。它能呈現列車大致行進情形，但不是安全定位設備。</p><p>隧道、臨時調度、上游斷訊、裝置時間不準或瀏覽器暫停背景分頁，都可能讓畫面與現場產生差異。</p></div></section>
  <section class="content-section"><h2>怎麼判斷最新狀態</h2><div class="card-grid">
    <article class="card"><h3>看畫面標示</h3><p>軌島會區分即時、推估與中斷等狀態。顯示推估時，不應把分鐘數當成官方保證。</p><a class="card-link" href="/">打開地圖 →</a></article>
    <article class="card"><h3>看資料狀態</h3><p>狀態頁整理資料源目前是否能連線，協助分辨是上游服務或裝置網路問題。</p><a class="card-link" href="/status.html">資料源狀態 →</a></article>
    <article class="card"><h3>最後以官方為準</h3><p>要趕車、確認停駛或月台時，請再查營運機構 App、網站、車站看板或現場廣播。</p><a class="card-link" href="/data-sources/">資料來源 →</a></article>
  </div></section>`,
});

const sourcesDescription = '軌島整合台鐵 OpenData、交通部 TDX、各捷運營運機構公開資料與 OpenStreetMap；不同資料分別負責班表、即時校正、車站與軌道幾何。';
writeGuide({
  title: '軌島資料來源：台鐵、TDX、捷運與 OpenStreetMap',
  description: sourcesDescription,
  pathname: '/data-sources/',
  eyebrow: 'DATA PROVENANCE',
  heading: '軌島的資料從哪裡來？',
  lede: sourcesDescription,
  schema: pageSchema({ title: '軌島資料來源：台鐵、TDX、捷運與 OpenStreetMap', description: sourcesDescription, pathname: '/data-sources/' }),
  content: `<section class="content-section"><h2>主要來源與用途</h2><div class="fact-table">
    <div class="fact-row"><div class="fact-label">台鐵 OpenData</div><div class="fact-value">每日時刻表、車站基本資料與車種代碼等穩定資料。</div></div>
    <div class="fact-row"><div class="fact-label">交通部 TDX</div><div class="fact-value">台鐵即時誤點與車站資訊，以及高鐵、捷運、輕軌等系統的路線、站序、時刻表或班距資料，依政府資料開放授權條款第1版使用。<a href="https://motc-ptx.gitbook.io/tdx-xin-shou-zhi-yin/api-shi-yong-shuo-ming/zi-liao-shi-yong-chang-jian-wen-ti"><img src="/assets/tdx-logo.svg" alt="TDX 運輸資料流通服務標章 / Transport Data eXchange" width="184" height="34" style="display:block;max-width:100%;height:auto;margin-top:8px"></a></div></div>
    <div class="fact-row"><div class="fact-label">營運機構資料</div><div class="fact-value">在授權與技術條件允許時，使用各營運機構的到站倒數、列車動態或營運公告校正畫面。</div></div>
    <div class="fact-row"><div class="fact-label">OpenStreetMap</div><div class="fact-value">補足部分軌道幾何；資料來自 OpenStreetMap 貢獻者並依 ODbL 使用。</div></div>
    <div class="fact-row"><div class="fact-label">臺灣鐵道維基館</div><div class="fact-value">區間車車型推估改編自社群整理的編組運用表（CC BY-SA 4.0）；官方班表不分世代，僅供參考。</div></div>
    <div class="fact-row"><div class="fact-label">地圖圖磚</div><div class="fact-value">網站街道圖使用 OpenFreeMap，衛星影像使用 Esri World Imagery；App 的 OpenFreeMap 載入失敗時改用 Stadia Maps。實際授權標示會顯示在地圖上。</div></div>
  </div></section>
  <section class="content-section"><h2>為什麼不只用一個 API</h2><div class="answer-box"><p>班表、站點、路線幾何、逐車狀態與營運公告通常分散在不同來源，而且每個鐵道系統公開的欄位不同。軌島保留來源差異：有即時訊號就校正，只有班表就明確當作推演，不用一種資料精度冒充所有系統。</p></div></section>
  <section class="content-section"><h2>更新與可追溯性</h2><div class="card-grid">
    <article class="card"><h3>資料狀態</h3><p>查看網站目前能否連上各項上游資料。</p><a class="card-link" href="/status.html">開啟狀態頁 →</a></article>
    <article class="card"><h3>公開原始碼</h3><p>資料管線與前端呈現方式都能在 GitHub 查閱。</p><a class="card-link" href="https://github.com/siriushsu/taiwan-rail-live">查看 GitHub →</a></article>
    <article class="card"><h3>解讀限制</h3><p>了解「即時」、「官方到站校正」與「班表推演」之間的差異。</p><a class="card-link" href="/accuracy/">準確度說明 →</a></article>
  </div></section>`,
});

// ── 車站時刻頁與車站索引（中英日韓四語）─────────────────────────────────────────────────
// 資料：scripts/station_timetable.mjs（逐日班表 → 某站兩週逐班＋行駛日；純函式、不讀時鐘）。頁面一律用它的輸出，
// 不在這裡重算時刻、行駛日或班數。版型（head／頁首／頁尾／麵包屑／hreflang）沿用 build_metro_pages.mjs 的外殼。
// 內容紅線：每一句話都追得到 data/ 或站上既有文案；「軌島怎麼顯示這一站」照 index.html 現行導言；
// 不斷言官方有沒有公開某種資料，缺什麼只寫「軌島的資料來源沒有……」。
const LANGS4 = ['zh', 'en', 'ja', 'ko'];
const pick4 = (lang, zh, en, ja, ko) => (lang === 'zh' ? zh : lang === 'en' ? en : lang === 'ja' ? ja : ko);
const stationPrefix = { zh: '', en: '/en', ja: '/ja', ko: '/ko' };
const htmlLangOf = { zh: 'zh-Hant', en: 'en', ja: 'ja', ko: 'ko' };
const stationHref = (lang, slug) => `${stationPrefix[lang]}/stations/${slug}/`;
const stationIndexHref = lang => `${stationPrefix[lang]}/stations/`;
const outFile = pathname => `${pathname.replace(/^\//, '')}index.html`;
const joinList = (lang, items) => (lang === 'en' && items.length > 1
  ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
  : items.join(pick4(lang, '、', ', ', '・', ' · ')));

const i18nStations = JSON.parse(fs.readFileSync(path.join(root, 'i18n/stations.json'), 'utf8'));
const ttInputs = loadStationTimetableInputs(root);
// 頁面日期取資料檔自己的抓取日期（不讀時鐘）：台鐵 dense 的 date、高鐵檔 fetched_at 的日期；範本改版日 2026-09-30 為下限。
const stationTemplateDate = '2026-09-30';
const stationModified = [stationTemplateDate, ttInputs.tra.date, String(ttInputs.thsr.fetched_at || '').slice(0, 10)].filter(Boolean).sort().pop();

const SYSTEM_NAMES = {
  zh: systemNames,
  en: { AFR: 'Alishan Forest Railway', KRTC: 'Kaohsiung MRT', THSR: 'Taiwan High Speed Rail (HSR)', TMRT: 'Taichung MRT', TRA: 'Taiwan Railway (TRA)', TRTC: 'Taipei MRT', TYMC: 'Taoyuan Airport MRT', NTMC: 'New Taipei Metro Circular Line' },
  ja: { AFR: '阿里山森林鉄道', KRTC: '高雄MRT', THSR: '台湾高速鉄道（高鉄）', TMRT: '台中MRT', TRA: '台鉄（TRA）', TRTC: '台北MRT', TYMC: '桃園空港MRT', NTMC: '新北メトロ環状線' },
  ko: { AFR: K('阿里山林鐵'), KRTC: K('高雄捷運'), THSR: K('台灣高鐵'), TMRT: K('台中捷運'), TRA: K('台鐵'), TRTC: K('台北捷運'), TYMC: '타오위안 공항 MRT', NTMC: `${K('新北捷運')} ${K('環狀線')}` },
};
const SYSTEM_SHORT = { zh: { TRA: '台鐵', THSR: '高鐵' }, en: { TRA: 'TRA', THSR: 'HSR' }, ja: { TRA: '台鉄', THSR: '高鉄' }, ko: { TRA: K('台鐵'), THSR: K('高鐵') } };
const TT_ORDER = ['TRA', 'THSR'];
const METRO_SYSTEMS = ['TRTC', 'TYMC', 'KRTC', 'TMRT', 'NTMC'];
const NAME_DICT = { TRA: 'tra_sched', THSR: 'thsr_sched', TRTC: 'mrt', NTMC: 'mrt', TYMC: 'tymc', KRTC: 'krtc', TMRT: 'tmrt', AFR: 'afr_sched' };
const ROUTE_DICT = { TRTC: 'mrt', NTMC: 'mrt', TYMC: 'tymc', KRTC: 'krtc', TMRT: 'tmrt', AFR: 'afr_sched' };

function memberName(lang, item) {
  if (lang === 'zh') return item.name;
  const hit = i18nStations.systems[NAME_DICT[item.system]]?.[item.name]?.[lang];
  if (!hit) throw new Error(`i18n/stations.json 缺 ${item.system} 站名「${item.name}」的 ${lang} 譯名`);
  return hit.replace(/\s+/g, ' ').trim();
}
// 路線名：台鐵三語都取 TDX Rail/TRA/Line 字面（zh／ja＝官方中文名，照抄不改寫，如「西部幹線 (海線)」的半形括號；en＝英文名；
// TDX 沒有日文，ja 照抄中文；ko＝字典裡的路線名，TDX 的字面字典沒有的三條見 TRA_LINE_KO）。不取 station_transfers.json 的 routes[].name：那是 App 用的簡稱，TRA:WL 寫成「西部幹線（山線）」
// 但它涵蓋基隆到屏東，真正的山線只有竹南–彰化，寫進站頁會變成事實錯誤。其餘系統中文取 routeNames、en／ja 取 i18n/stations.json 的 routes
const TRA_LINE_KO = { WL: '서부 간선', 'WL-C': `서부 간선(${K('海線')})`, SU: `${i18nStations.systems.tra_sched['蘇澳新'].ko}–${i18nStations.systems.tra_sched['蘇澳'].ko}` };
function routeLabel(lang, key) {
  const [sys, id] = key.split(':');
  if (sys === 'TRA') {
    const line = ttInputs.lineNames.lines[id];
    if (!line) throw new Error(`tra_line_names.json 缺台鐵路線 ${id}`);
    if (lang === 'ko') return TRA_LINE_KO[id] || K(line.zh);
    return lang === 'en' ? line.en : line.zh;
  }
  if (lang === 'zh') return routeNames[key] || key;
  if (key === 'THSR:THSR') return SYSTEM_NAMES[lang].THSR;
  const hit = i18nStations.routes[ROUTE_DICT[sys]]?.[routeNames[key]]?.[lang];
  if (!hit) throw new Error(`i18n/stations.json routes 缺 ${key}「${routeNames[key]}」的 ${lang} 譯名`);
  return hit;
}

function stationDetails(config) {
  return config.members.map(key => {
    const item = transfers.stations[key];
    if (!item) throw new Error(`${config.slug} 找不到站點 ${key}`);
    return { key, ...item };
  });
}

function stationAddress(details) {
  const tra = details.find(item => item.system === 'TRA');
  if (!tra) return '';
  const info = Object.values(traInfo).find(item => String(item.id) === String(tra.stationId));
  return info?.address || '';
}

// 台鐵成員取官方站名（transfers 的 name，如「臺北」），高鐵取 TDX 中文站名；找不到任何班次資料層會直接 throw
function timetableOf(item) {
  if (item.system === 'TRA') return traStationTimetable(item.name, ttInputs);
  if (item.system === 'THSR') return thsrStationTimetable(item.name, ttInputs);
  return null;
}

const stationModels = new Map();
function stationModel(config) {
  if (!stationModels.has(config.slug)) {
    const details = stationDetails(config);
    const tts = details.map(item => ({ item, tt: timetableOf(item) })).filter(rec => rec.tt)
      .sort((a, b) => TT_ORDER.indexOf(a.item.system) - TT_ORDER.indexOf(b.item.system));
    stationModels.set(config.slug, {
      config, details, tts,
      sysCodes: [...new Set(details.map(item => item.system))],
      routeKeys: [...new Set(details.flatMap(item => item.routes))],
      ttSystems: [...new Set(tts.map(rec => rec.item.system))],
      address: stationAddress(details),
      position: details[0].position,
    });
  }
  return stationModels.get(config.slug);
}
const tOf = (lang, config) => (lang === 'zh' ? config.title : config[lang].title);
const summaryOf = (lang, config) => (lang === 'zh' ? config.summary : config[lang].summary);
const transferOf = (lang, config) => (lang === 'zh' ? config.transfer : config[lang].transfer);
// 轉乘段的 HTML：有 transferHtml（中文，內含連結）就用它，否則把純文字跳脫後輸出。transferHtml 的可見文字必須等於 transfer。
const transferHtmlOf = (lang, config) => (lang === 'zh' && config.transferHtml) || escapeHtml(transferOf(lang, config));
const systemsOf = (lang, model) => model.sysCodes.map(code => SYSTEM_NAMES[lang][code]);
const routesOf = (lang, model) => [...new Set(model.routeKeys.map(key => routeLabel(lang, key)))];
const shortsOf = (lang, model) => model.ttSystems.map(code => SYSTEM_SHORT[lang][code]);

// ── 第二批：其餘台鐵站（2026-09-30，B2）──────────────────────────────────────────────────────
// 中文頁＝資料裡兩週內有停靠的每一個台鐵站，扣掉第一批 23 頁已含的 18 站、環島別名與待通車站（見 pendingTraNames；應為 221 站）；
// 瑞芳、十分、菁桐、礁溪、福隆、集集、知本另有英日韓文頁。站清單、網址、導言、轉乘句、附近車站全部從 data/ 算，不寫站名清單
// （換班表、新站、改站名都自動跟著變）；資料拿不到就 throw（缺英文站名、地址取不出縣市或鄉鎮市區、網址撞名），不編造。
// 導言每一句都追得到資料：路線＝station_transfers 的 routes、縣市與鄉鎮市區＝tra_station_info 的地址、轉乘＝station_transfers 的 pairs。
const TRA_ROUND_ISLAND_ALIAS = '臺北-環島';   // 環島列車的終點別名（站碼 1001），不是車站
const SECOND_EN_JA = ['瑞芳', '十分', '菁桐', '礁溪', '福隆', '集集', '知本'];   // 外國旅客常去的站，第二批也做英日文頁
const SECOND_SLUG_OVERRIDE = { 左營: 'zuoying-tra' };   // 台鐵左營（4350）的英文名 Zuoying 與第一批 /stations/zuoying/（左營轉乘站）撞名
const SECOND_TITLE_OVERRIDE = { 左營: '台鐵左營車站' };   // 跟「左營轉乘站」分開
const TRA_COUNTY_ORDER = ['基隆市', '臺北市', '新北市', '桃園市', '新竹市', '新竹縣', '苗栗縣', '臺中市', '彰化縣', '南投縣', '雲林縣', '嘉義市', '嘉義縣', '臺南市', '高雄市', '屏東縣', '臺東縣', '花蓮縣', '宜蘭縣'];
// 轉乘夥伴的系統名（中文頁用）：KRTC、TMRT 沿用 systemNames；環狀輕軌與三鶯線照 build_metro_pages.mjs 的頁面標題寫法（headName：系統名＋路線名）
const PARTNER_SYSTEM_ZH = { KRTC: systemNames.KRTC, TMRT: systemNames.TMRT, KLRT: '高雄捷運環狀輕軌', SANYING: '新北捷運三鶯線' };

const traStopsOf = train => (typeof train.stops === 'string' ? JSON.parse(train.stops) : train.stops);
const servedTraNames = new Set();
for (const i of new Set(Object.values(ttInputs.tra.dates).flat())) for (const p of traStopsOf(ttInputs.tra.trains[i])) if (p.stop) servedTraNames.add(p.name);

// 待通車站＝scripts/fetch_tra.py 的 PENDING_STATIONS（班表抓取的待上架站閘門讀同一份；閘門 verify_station_pages.mjs 自己再解析一次）。
// 站還在整合時（例：2026-10 平鎮臨時站），班表可能先有它的停靠，官方英文站名、地址、轉乘表卻還沒有：
// 先不產它的頁、印一行警告、不 throw，否則每週重抓班表會在最後這一步中斷。站名比對照 fetch_tra_schedule.py：去括號後綴、臺→台、「包含」。
// 整合完把那一筆從 PENDING_STATIONS 移除，這站就照一般規則產頁（仍缺官方譯名照樣 throw，不編造；前置條件見 fetch_tra.py 名單的註解）。
const pendingTraNames = (() => {
  const dict = fs.readFileSync(path.join(root, 'scripts/fetch_tra.py'), 'utf8').match(/^PENDING_STATIONS\b[^=\n]*=\s*\{([^}]*)\}/m);
  if (!dict) throw new Error('scripts/fetch_tra.py 找不到 PENDING_STATIONS（被改名或刪掉了？）');
  return [...dict[1].matchAll(/(?:^|[{,])\s*(["'])([^"'\n]+)\1\s*:/gm)].map(m => m[2]);
})();
const traNameKey = name => name.replace(/\s*[（(].*$/, '').replace(/臺/g, '台');
const isPendingTra = name => pendingTraNames.some(pending => traNameKey(name).includes(traNameKey(pending)));
const pendingServed = [...servedTraNames].filter(isPendingTra).sort();
if (pendingServed.length) console.warn(`⏸ 待通車站 ${pendingServed.join('、')} 班表已有停靠，仍在 scripts/fetch_tra.py 的 PENDING_STATIONS：先不產生車站頁（整合完再移除那一筆，前置條件見那份名單的註解）`);

const traKeyByName = new Map();
for (const [key, item] of Object.entries(transfers.stations)) {
  if (item.system !== 'TRA') continue;
  if (traKeyByName.has(item.name)) throw new Error(`station_transfers.json 有兩個台鐵站都叫「${item.name}」：${traKeyByName.get(item.name)}、${key}`);
  traKeyByName.set(item.name, key);
}
const thsrKeyByName = new Map(Object.entries(transfers.stations).filter(([, item]) => item.system === 'THSR').map(([key, item]) => [item.name.replace(/台/g, '臺'), key]));
const transferGroupById = new Map(transfers.transferStations.map(group => [group.id, group]));
const traInfoById = new Map(Object.values(traInfo).map(rec => [String(rec.id), rec]));
const traLineStations = new Map(JSON.parse(fs.readFileSync(path.join(root, 'data/tra_station_of_line.json'), 'utf8')).lines
  .map(line => [line.lineId, [...line.stations].sort((a, b) => a.seq - b.seq)]));

// 地址：去郵遞區號；縣市與區之間有空白的（「新竹市 東區」「嘉義市 西區」）一併去掉，否則區名會帶著前導空白
const traAddressOf = item => String(traInfoById.get(String(item.stationId))?.address || '').replace(/^\d+/, '').replace(/\s+/g, '');
function traCity(item) {
  const city = traAddressOf(item).slice(0, 3);
  if (!/^\S{2}[縣市]$/.test(city)) throw new Error(`台鐵「${item.name}」（${item.stationId}）的地址取不出縣市：「${traAddressOf(item)}」`);
  return city;
}
// 鄉鎮市區：縣市之後先取「最短、以區結尾（2–4 字）」；沒有才取「最短、以鄉／鎮／市結尾（2–4 字）」。
// 臺南市新市區必須是「新市區」，不是先被「市」截成「新市」。
function traDistrict(item) {
  const after = traAddressOf(item).slice(3);
  const shortest = ends => { for (let n = 2; n <= 4; n++) if (after[n - 1] && ends.includes(after[n - 1])) return after.slice(0, n); return null; };
  const district = shortest('區') || shortest('鄉鎮市');
  if (!district) throw new Error(`台鐵「${item.name}」（${item.stationId}）的地址取不出鄉鎮市區：「${traAddressOf(item)}」`);
  return district;
}
// 轉乘夥伴：同一轉乘組裡本站以外的成員，距離取 pairs（pairM 找不到就 throw）；夥伴也是台鐵站的形狀第二批沒有，遇到就停
function traPartners(key) {
  const groupId = transfers.stations[key].transferId;
  const group = groupId && transferGroupById.get(groupId);
  if (!group) return [];
  return group.members.filter(member => member !== key).map(member => {
    const item = transfers.stations[member];
    if (item.system === 'TRA') throw new Error(`${key} 與台鐵站 ${member} 在同一轉乘組，第二批的轉乘句沒有處理這種形狀`);
    if (!PARTNER_SYSTEM_ZH[item.system]) throw new Error(`轉乘夥伴 ${member} 的系統 ${item.system} 沒有中文系統名（PARTNER_SYSTEM_ZH）`);
    return { key: member, item, m: pairM(key, member) };
  });
}
const zhStop = name => (name.endsWith('站') ? name : `${name}站`);   // 夥伴站名有「橋頭火車站」「岡山車站」，不再多加一個「站」
const partnerLabelZh = partner => `${PARTNER_SYSTEM_ZH[partner.item.system]}${zhStop(partner.item.name)}`;
const segText = segs => segs.map(seg => (typeof seg === 'string' ? seg : seg.text)).join('');
const segHtml = segs => segs.map(seg => (typeof seg === 'string' ? escapeHtml(seg) : `<a href="${seg.href}">${escapeHtml(seg.text)}</a>`)).join('');
const slugOfEn = en => en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const firstBatchTraKeys = new Set(stations.flatMap(config => config.members).filter(key => key.startsWith('TRA:')));
const secondKeys = [...servedTraNames].filter(name => name !== TRA_ROUND_ISLAND_ALIAS && !isPendingTra(name)).map(name => {
  const key = traKeyByName.get(name);
  if (!key) throw new Error(`班表有停靠的站「${name}」在 station_transfers.json 找不到`);
  return key;
}).filter(key => !firstBatchTraKeys.has(key)).sort();   // 依站碼（四位數字字串）排序，決定性

function secondConfig(key) {
  const item = transfers.stations[key], name = item.name;
  const enName = i18nStations.systems.tra_sched[name]?.en;
  if (!enName) throw new Error(`i18n/stations.json 的 tra_sched 沒有「${name}」（${key}）的英文站名，無法產生網址；先在 scripts/build_i18n_station_names.mjs 補官方譯名`);
  const slug = SECOND_SLUG_OVERRIDE[name] || slugOfEn(enName);
  if (!slug) throw new Error(`「${name}」（${key}）的英文站名「${enName}」轉不出網址`);
  const enJa = SECOND_EN_JA.includes(name);
  const title = SECOND_TITLE_OVERRIDE[name] || `${name}車站`;
  const routeKeys = item.routes;
  if (!routeKeys.length) throw new Error(`station_transfers.json 的 ${key}（${name}）沒有路線`);
  const partners = traPartners(key);
  const hsrKey = thsrKeyByName.get(name.replace(/台/g, '臺'));
  // 同名高鐵站在別處（苗栗、彰化、左營）：在同一轉乘組就是夥伴（上面處理過），不在才算「別處」
  const hsrElsewhere = hsrKey && !partners.some(partner => partner.key === hsrKey) ? hsrKey : null;
  let hsrPage = null;
  if (hsrElsewhere) {
    hsrPage = stations.find(config => config.members.includes(hsrElsewhere));
    if (!hsrPage) throw new Error(`「${name}」有同名高鐵站 ${hsrElsewhere}，但第一批沒有頁面收它`);
  }
  const routes = lang => routeKeys.map(routeKey => routeLabel(lang, routeKey));
  const guard = (lang, what) => { throw new Error(`第二批 ${lang}/${slug}：${what}的英日文措辭沒有寫（規格只涵蓋 ${SECOND_EN_JA.join('、')}，這些站沒有轉乘夥伴或同名高鐵站）`); };

  // 中文：導言與轉乘段
  const place = `${traCity(item)}${traDistrict(item)}`;
  const zhSummary = `${name}車站是台鐵${routes('zh').join('、')}的車站，位於${place}。${partners.length ? `可步行轉乘${partners.map(partnerLabelZh).join('、')}。` : ''}`;
  const zhSegs = [];
  for (const partner of partners) zhSegs.push(`${partnerLabelZh(partner)}與台鐵站點在資料中相距約 ${partner.m} 公尺，屬步行轉乘，不代表同一月台。`);
  if (routeKeys.length > 1) zhSegs.push(`本站同時屬於台鐵${routes('zh').slice(0, -1).join('、')}與${routes('zh').at(-1)}。`);
  if (hsrPage) zhSegs.push(`高鐵${transfers.stations[hsrElsewhere].name}站是另一個車站，與本站在資料中直線相距約 ${kmBetween(hsrElsewhere, key)} 公里，請看〈`, { text: hsrPage.title, href: stationHref('zh', hsrPage.slug) }, '〉。');
  if (!zhSegs.length) zhSegs.push('軌島的轉乘資料沒有列出本站與其他軌道系統的轉乘。');

  const config = {
    slug, key, name, title, members: [key], batch: 2, enJa,
    summary: zhSummary, transfer: segText(zhSegs), transferHtml: segHtml(zhSegs),
    distanceNote: partners.length > 0 || Boolean(hsrPage),   // 轉乘段有公尺或公里數，才接「資料中的距離用於辨識…」那段（規則 3）
  };
  if (enJa) {
    if (partners.length) guard('en/ja', '轉乘夥伴');
    if (hsrPage) guard('en/ja', '同名高鐵站');
    const en = memberName('en', item), ja = memberName('ja', item), ko = memberName('ko', item);
    const multi = routeKeys.length > 1;
    config.en = {
      title: `${en} Station`,
      summary: `${en} Station is a Taiwan Railway (TRA) station on the ${joinList('en', routes('en'))}.`,
      transfer: multi
        ? `This station belongs to both the ${joinList('en', routes('en'))} of Taiwan Railway (TRA).`
        : 'Rail Island\'s transfer data does not list any transfer between this station and other railway systems.',
    };
    config.ja = {
      title: `${ja}駅`,
      summary: `${ja}駅は台鉄（TRA）の${routes('ja').join('・')}の駅です。`,
      transfer: multi
        ? `この駅は台鉄（TRA）の${routes('ja').join('と')}の両方に属しています。`
        : '軌島の乗り換えデータには、この駅とほかの鉄道システムとの乗り換え関係は載っていません。',
    };
    config.ko = {
      title: `${ko}역`,
      summary: `${ko}역은 ${SYSTEM_NAMES.ko.TRA} ${routes('ko').join(' · ')}의 역이에요.`,
      transfer: multi
        ? `이 역은 ${SYSTEM_NAMES.ko.TRA} ${routes('ko').join(' · ')}에 모두 속해요.`
        : 'Rail Island의 환승 정보에는 이 역과 다른 철도 시스템 사이의 환승 관계가 없어요.',
    };
  }
  return config;
}
const secondBatch = secondKeys.map(secondConfig);
{
  const slugOwner = new Map(stations.map(config => [config.slug, config.title]));
  for (const config of secondBatch) {
    if (slugOwner.has(config.slug)) throw new Error(`車站網址撞名：/stations/${config.slug}/ 已是「${slugOwner.get(config.slug)}」，「${config.title}」（${config.key}）不能再用；到 SECOND_SLUG_OVERRIDE 指定另一個網址`);
    slugOwner.set(config.slug, config.title);
  }
}

// 第一批三頁（中文高鐵苗栗、高鐵彰化、左營轉乘站）的轉乘段提到的台鐵同名站，連到新開的頁；可見文字逐字不變，只加連結。
for (const link of [
  { slug: 'miaoli-hsr', station: '苗栗', before: '台鐵另有', phrase: '苗栗站' },
  { slug: 'changhua-hsr', station: '彰化', before: '', phrase: '台鐵彰化站' },
  { slug: 'zuoying', station: '左營', before: '「', phrase: '左營（舊城）' },
]) {
  const config = stations.find(item => item.slug === link.slug), target = secondBatch.find(item => item.name === link.station);
  if (!config || !target) throw new Error(`反向連結：找不到第一批頁 ${link.slug} 或第二批的台鐵${link.station}站`);
  const anchor = link.before + link.phrase, at = config.transfer.indexOf(anchor);
  if (at < 0 || config.transfer.indexOf(anchor, at + 1) >= 0) throw new Error(`反向連結：${link.slug} 的轉乘段找不到唯一的「${anchor}」`);
  const from = at + link.before.length, to = from + link.phrase.length;
  config.transferHtml = `${escapeHtml(config.transfer.slice(0, from))}<a href="${stationHref('zh', target.slug)}">${escapeHtml(link.phrase)}</a>${escapeHtml(config.transfer.slice(to))}`;
}

// 每個語言有頁面的站（中文：第一批 23＋第二批 221；en／ja／ko：第一批 23＋第二批的 7 站）
const pageLangs = config => (config.enJa === false ? ['zh'] : LANGS4);
const pagesIn = lang => [...stations, ...secondBatch].filter(config => pageLangs(config).includes(lang));
// 台鐵站碼 → 該站的頁面設定（第一批成員連到它所在的第一批頁）
const pageOfTraId = new Map();
for (const config of [...stations, ...secondBatch]) for (const key of config.members) if (key.startsWith('TRA:')) pageOfTraId.set(String(transfers.stations[key].stationId), config);

// 第二批頁的「附近的車站資料頁」：本站每條路線（station_transfers 的 routes 順序）在 tra_station_of_line 站序上，
// 往前、往後各找第一個「這個語言有頁面」的站，去重，最多 4 個。
function nearbyPages(config, lang) {
  const item = transfers.stations[config.key], out = [];
  for (const routeKey of item.routes) {
    const seq = traLineStations.get(routeKey.replace(/^TRA:/, ''));
    const at = seq ? seq.findIndex(station => String(station.id) === String(item.stationId)) : -1;
    if (at < 0) throw new Error(`tra_station_of_line.json 的 ${routeKey} 找不到 ${config.key}（${config.name}）`);
    for (const step of [-1, 1]) {
      for (let j = at + step; j >= 0 && j < seq.length; j += step) {
        const page = pageOfTraId.get(String(seq[j].id));
        if (page && pageLangs(page).includes(lang)) { if (!out.includes(page)) out.push(page); break; }
      }
    }
  }
  return out.slice(0, 4);
}

// 深連結：/?g=<群組>&at=<lat>,<lon>&z=15（index.html 的 deepG／deepAt／deepZ）。群組只用 GROUPS 裡真有的 id：
// 只有台鐵（含林鐵）→ tra、只有高鐵 → hsr、只有捷運 → metro，混合 → all（全台同框）。
function liveGroup(sysCodes) {
  const has = code => sysCodes.includes(code);
  const rail = has('TRA') || has('AFR'), hsr = has('THSR'), metroSys = METRO_SYSTEMS.some(has);
  if (metroSys && !rail && !hsr) return 'metro';
  if (hsr && !rail && !metroSys) return 'hsr';
  if (rail && !hsr && !metroSys) return 'tra';
  return 'all';
}
const liveHref = (lang, model) => `/?g=${liveGroup(model.sysCodes)}&at=${model.position[0].toFixed(4)},${model.position[1].toFixed(4)}&z=15${lang === 'zh' ? '' : `&lang=${lang}`}`;

// ── 日期與班數文字 ──
const WD_NAMES = { zh: ['一', '二', '三', '四', '五', '六', '日'], en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], ja: ['月', '火', '水', '木', '金', '土', '日'], ko: ['월', '화', '수', '목', '금', '토', '일'] };
const plainMd = md => { const cut = md.search(/[（(]/); return cut < 0 ? md : md.slice(0, cut).trim(); };
// 「9/28 週一（放假）」「Sep 28 Mon (holiday)」「9月28日 月曜（休日）」「9월 28일 월요일(휴일)」。回傳 HTML：手機窄欄時括號註記不准斷在中間
// （「（放／假）」），日期＋星期、括號註記各包成不斷行的單位（.nb），只允許在兩者之間換行。
const nb = html => `<span class="nb">${html}</span>`;
// TDX 路線名「西部幹線 (海線)」含半形空白與括號，手機窄欄會從名稱中間斷成「(海／線)」；把這類路線名包成不斷行的單位（字面不變）
const PAREN_ROUTE_LABELS = Object.values(ttInputs.lineNames.lines).map(line => escapeHtml(line.zh)).filter(label => label.includes('('));
const nbRoutes = html => PAREN_ROUTE_LABELS.reduce((out, label) => out.split(label).join(nb(label)), html);
function dayCountLabel(lang, p) {
  const md = p.md[lang], plain = plainMd(md), note = md.slice(plain.length).trim(), wd = WD_NAMES[lang][p.weekday];
  const head = pick4(lang, `${plain} 週${wd}`, `${plain} ${wd}`, `${plain} ${wd}曜`, `${plain} ${wd}요일`);
  return nb(escapeHtml(head)) + (note ? pick4(lang, '', ' ', '', '') + nb(escapeHtml(note)) : '');
}
// 行駛日標籤裡的「日期＋括號註記」（9/28（放假）、Sep 28 (holiday)、10月9日（休日））同樣包成不斷行的單位；標籤本身是純文字（閘門與資料層用）
const NOTE_UNIT = /(?:(?:\d+\/\d+|[A-Z][a-z]{2} \d+|\d+月\d+日|\d+월 \d+일) ?)?[（(][^）)]*[）)]|\d+月\d+日|\d+월 \d+일/g;   // 日文、韓文的日期本身（10月10日、10월 10일）也不准斷在「月」與數字之間
const runLabelHtml = text => escapeHtml(text).replace(NOTE_UNIT, unit => nb(unit));
function rangeText(lang, tt, withWeekday = true) {
  const a = tt.perDay[0], b = tt.perDay[tt.perDay.length - 1];
  const pa = plainMd(a.md[lang]), pb = plainMd(b.md[lang]);
  if (!withWeekday) return pick4(lang, `${pa}–${pb}`, `${pa}–${pb}`, `${pa}〜${pb}`, `${pa}~${pb}`);
  const wa = WD_NAMES[lang][a.weekday], wb = WD_NAMES[lang][b.weekday];
  return pick4(lang, `${pa}（${wa}）至 ${pb}（${wb}）`, `${pa} (${wa}) to ${pb} (${wb})`, `${pa}（${wa}）〜${pb}（${wb}）`, `${pa}(${wa})~${pb}(${wb})`);
}

// ── 時刻表 ──
const timeHtml = t => (t.nextDay ? `${t.hm}<sup class="nd">+1</sup>` : t.hm);
const TH = {
  dep: { zh: '開車', en: 'Departs', ja: '発車', ko: K('開車') }, arr: { zh: '到站', en: 'Arrives', ja: '到着', ko: K('到站') },
  train: { zh: '車次', en: 'Train', ja: '列車', ko: K('車次') }, to: { zh: '終點', en: 'To', ja: '行き先', ko: '종점' },
  from: { zh: '始發站', en: 'From', ja: '始発駅', ko: K('起站') }, run: { zh: '行駛日', en: 'Runs', ja: '運転日', ko: '운행일' },
};
// 手機版 CSS 把 table／tr／td 改成 display:block／inline（assets/aeo.css），Safari 在這種情況下會丟掉表格語意，
// 所以 role 一律明寫（ARIA 覆寫是標準解）。showType=false：高鐵每列的車種都一樣，是雜訊，不顯示。
function ttTable(lang, labelId, timeHead, otherHead, otherClass, rows, showType = true) {
  const car = r => (showType ? `<small class="car">${escapeHtml(r.type[lang])}</small>` : '');
  const body = rows.map(r => `<tr${r.label.special ? ' class="special"' : ''} role="row"><th scope="row" class="t" role="rowheader">${timeHtml(r.time)}</th><td class="c-train" role="cell">${escapeHtml(r.train)}${car(r)}</td><td class="${otherClass}" role="cell">${escapeHtml(r.other[lang])}</td><td class="c-run" role="cell">${runLabelHtml(r.label[lang])}</td></tr>`).join('');
  const colhead = text => `<th scope="col" role="columnheader">${escapeHtml(text)}</th>`;
  return `<div class="table-wrap tt-wrap"><table role="table" aria-labelledby="${labelId}"><thead role="rowgroup"><tr role="row">${colhead(timeHead)}${colhead(TH.train[lang])}${colhead(otherHead)}${colhead(TH.run[lang])}</tr></thead><tbody role="rowgroup">${body}</tbody></table></div>`;
}
const trainsN = (lang, n) => pick4(lang, `${n} 班`, `${n} train${n === 1 ? '' : 's'}`, `${n}本`, `${n}편`);
function dirHeading(lang, sys, d) {
  const dests = d.destinations.slice(0, 2).map(x => x.name[lang]);
  if (sys === 'TRA') {
    if (!d.next || !d.next[lang]) throw new Error(`台鐵方向「${d.key}」缺 ${lang} 經由站名稱`);
    // 方向依「清單裡本站的下一個點」分，那個點可能是通過站、不是下一個停靠站，所以寫「經 X」不寫「下一站」
    return {
      main: pick4(lang, `往${dests.join('、')}方向`, `Towards ${joinList('en', dests)}`, `${dests.join('・')}方面`, `${joinList('ko', dests)} 방면`),
      sub: pick4(lang, `（經${d.next.zh}，${trainsN(lang, d.count)}）`, ` (via ${d.next.en}, ${trainsN(lang, d.count)})`, `（${d.next.ja}経由、${trainsN(lang, d.count)}）`, ` (${d.next.ko} 경유, ${trainsN(lang, d.count)})`),
    };
  }
  return {
    main: pick4(lang, `${d.label.zh}（往${dests.join('、')}）`, `${d.label.en} (towards ${joinList('en', dests)})`, `${d.label.ja}（${dests.join('・')}方面）`, `${d.label.ko}(${joinList('ko', dests)} 방면)`),
    sub: pick4(lang, `（${trainsN(lang, d.count)}）`, ` (${trainsN(lang, d.count)})`, `（${trainsN(lang, d.count)}）`, ` (${trainsN(lang, d.count)})`),
  };
}
const ttBlockId = (rec, suffix) => `${rec.item.system.toLowerCase()}-${rec.item.stationId}-${suffix}`;

// 一個成員（台鐵或高鐵）的時刻段落；回傳 { html, toc }
function ttSection(lang, model, rec) {
  const { item, tt } = rec, sys = item.system;
  const short = SYSTEM_SHORT[lang][sys], name = tt.station[lang];
  const total = tt.directions.reduce((n, d) => n + d.count, 0), arrN = tt.arrivals.length;
  const range = rangeText(lang, tt);
  const h2 = pick4(lang, `${short}${name}站時刻表`, `${short} ${name} Station timetable`, `${short}${name}駅の時刻表`, `${short} ${name}역 시간표`);
  const arrText = arrN ? pick4(lang, `；以本站為終點的 ${arrN} 班另列在到站時刻`, `; trains that end here (${arrN}) are listed separately under arrival times`, `。この駅が終点の列車（${arrN}本）は、到着時刻として別に載せています`, ` 이 역이 종점인 ${arrN}편은 도착 시각으로 따로 실었어요.`) : '';
  // 「共 N」是整個資料區間內「不重複的班次列」（同車次、同時刻只算一個，不論行駛哪幾天），不是每天的班數——
  // 事實表寫的「每天開出班數」是另一個口徑，導言要讓人看得出這是 n 天合計。
  const n = tt.dates.length, one = total === 1;
  const intro = pick4(lang,
    `${range}，這 ${n} 天合計從${name}站開出 ${total} 個班次（同一車次、同一時刻只算一個，不論哪幾天行駛），依方向與開車時間排列${arrText}。「行駛日」標出不是每天都開的班次。`,
    `From ${range}, there ${one ? 'is' : 'are'} ${total} distinct ${short} departure${one ? '' : 's'} from ${name} Station over the ${n} days (each train number and departure time is counted once, however many days it runs), listed by direction and departure time${arrText}. Trains that don't run every day are highlighted in the "Runs" column.`,
    `${range}の${n}日間に${name}駅から発車する${short}は、列車番号と発車時刻の組み合わせごとに数えて合計${total}本です（運転日が違っても同じ組み合わせは1本と数えます）。方面と発車時刻の順に並べています${arrText}。毎日運転しない列車は「運転日」欄で目立たせています。`,
    `${range}의 ${n}일 동안 ${name}역에서 출발하는 ${short} 열차는 열차번호와 출발 시각 조합 기준으로 모두 ${total}편이에요(운행일이 달라도 같은 조합은 1편으로 세요). 방면과 출발 시각순으로 정리했어요.${arrText} 매일 운행하지 않는 열차는 ‘운행일’ 칸에 표시했어요.`);
  const toc = [];
  const blocks = tt.directions.map((d, i) => {
    const id = ttBlockId(rec, sys === 'TRA' ? String(i + 1) : d.key);
    const { main, sub } = dirHeading(lang, sys, d);
    toc.push({ id, label: pick4(lang, `${short}${name}：${main}`, `${short} ${name}: ${main}`, `${short}${name}：${main}`, `${short} ${name}: ${main}`) });
    const rows = d.rows.map(r => ({ time: r.dep, train: r.train, type: r.type, other: r.to, label: r.label }));
    return `<div class="dir-block"><h3 id="${id}">${escapeHtml(main)}<span class="dir-sub">${escapeHtml(sub)}</span></h3>${ttTable(lang, id, TH.dep[lang], TH.to[lang], 'c-to', rows, sys !== 'THSR')}</div>`;
  });
  if (arrN) {
    const id = ttBlockId(rec, 'arrivals');
    const main = pick4(lang, `以${name}站為終點的班次（到站時刻）`, `Trains ending at ${name} (arrival times)`, `${name}駅が終点の列車（到着時刻）`, `${name}역이 종점인 열차(도착 시각)`);
    const sub = pick4(lang, `（${trainsN(lang, arrN)}）`, ` (${trainsN(lang, arrN)})`, `（${trainsN(lang, arrN)}）`, ` (${trainsN(lang, arrN)})`);
    toc.push({ id, label: pick4(lang, `${short}${name}：到站班次`, `${short} ${name}: arrivals`, `${short}${name}：到着列車`, `${short} ${name}: 도착 열차`) });
    const rows = tt.arrivals.map(r => ({ time: r.arr, train: r.train, type: r.type, other: r.from, label: r.label }));
    blocks.push(`<div class="dir-block"><h3 id="${id}">${escapeHtml(main)}<span class="dir-sub">${escapeHtml(sub)}</span></h3>${ttTable(lang, id, TH.arr[lang], TH.from[lang], 'c-from', rows, sys !== 'THSR')}</div>`);
  }
  const afr = sys === 'TRA' && model.sysCodes.includes('AFR')
    ? `<p class="table-note">${escapeHtml(pick4(lang, '阿里山林鐵的班次不在本頁的時刻表內。', 'Alishan Forest Railway trips are not included in the timetables on this page.', '阿里山森林鉄道の列車は、このページの時刻表には含まれていません。', '아리산 삼림철도 열차는 이 페이지의 시간표에 포함되지 않아요.'))}</p>` : '';
  const note = pick4(lang,
    '時刻捨去到分，與軌島地圖一致；標 +1 的是隔天凌晨。「行駛日」是資料涵蓋區間內實際行駛的日子，放假日依軌島的日曆資料（含國定假日、補假與補班）判定。',
    'Times are rounded down to the minute, as on the Rail Island map; +1 marks a time after midnight on the next day. "Runs" lists the days within the data period on which the train actually runs; holidays follow Rail Island\'s calendar data, including public holidays, make-up holidays and make-up working days.',
    '時刻は分未満を切り捨てており、軌島の地図と同じです。+1 は翌日の未明の時刻です。「運転日」は、データの対象期間内に実際に運転する日で、休日は軌島のカレンダーデータ（祝日、振替休日、振替出勤日を含む）で判定しています。',
    '시각은 분 미만을 버려 Rail Island 지도와 같아요. +1은 다음 날 새벽 시각이에요. ‘운행일’은 데이터 기간 안에서 실제로 운행하는 날이며, 휴일은 Rail Island의 달력 데이터(공휴일 · 대체 휴일 · 대체 근무일 포함)로 판단해요.');
  return {
    toc,
    html: `<section class="content-section tt" id="${sys.toLowerCase()}-${item.stationId}"><h2>${escapeHtml(h2)}</h2><p class="section-intro">${escapeHtml(intro)}</p>${blocks.join('')}${afr}<p class="table-note">${escapeHtml(note)}</p></section>`,
  };
}

// ── 車站頁 ──
const FACT_LABEL = {
  systems: { zh: '收錄系統', en: 'Systems', ja: '収録システム', ko: '지원 시스템' },
  routes: { zh: '路線', en: 'Lines', ja: '路線', ko: K('路線') },
  ttdata: { zh: '時刻表涵蓋區間', en: 'Timetable period', ja: '時刻表の対象期間', ko: '시간표 기간' },
  ttsource: { zh: '時刻表來源', en: 'Timetable source', ja: '時刻表の出典', ko: '시간표 출처' },
  perday: { zh: '每天開出班數', en: 'Departures per day', ja: '1日の発車本数', ko: '일별 출발 편수' },
  stations: { zh: '軌島站點', en: 'Rail Island stations', ja: '軌島の駅', ko: 'Rail Island 역 지점' },
  address: { zh: '台鐵地址', en: '', ja: '', ko: '' },
  coords: { zh: '參考座標', en: 'Reference coordinates', ja: '参考座標', ko: '참고 좌표' },
};
const TT_SOURCE = {
  TRA: { zh: '台鐵：臺鐵開放資料的逐日時刻表', en: 'TRA: daily timetables from the Taiwan Railway open data portal', ja: '台鉄：台湾鉄路の公式オープンデータ（毎日の時刻表）', ko: '대만철도: 대만철도 OpenData의 일별 시간표' },
  THSR: { zh: '高鐵：交通部 TDX 的高鐵每日時刻表', en: 'HSR: daily timetables from the Ministry of Transportation TDX platform', ja: '高鉄：交通部 TDX の日別時刻表', ko: '고속철도: 교통부 TDX의 고속철도 일별 시간표' },
};

function factsSection(lang, model) {
  const rows = [];
  const add = (label, value) => rows.push(`<div class="fact-row"><div class="fact-label">${escapeHtml(label)}</div><div class="fact-value">${value}</div></div>`);
  const sep = pick4(lang, '；', '; ', '；', '; ');
  add(FACT_LABEL.systems[lang], systemsOf(lang, model).map(escapeHtml).join(pick4(lang, '、', ', ', '、', ' · ')));
  add(FACT_LABEL.routes[lang], routesOf(lang, model).map(route => nbRoutes(escapeHtml(route))).join(pick4(lang, '、', ', ', '、', ' · ')));
  if (model.tts.length) {
    const perSystem = code => model.tts.find(rec => rec.item.system === code);
    const ranges = model.ttSystems.map(code => `${SYSTEM_SHORT[lang][code]}${pick4(lang, '：', ': ', '：', ': ')}${rangeText(lang, perSystem(code).tt)}`).join(sep);
    add(FACT_LABEL.ttdata[lang], escapeHtml(pick4(lang, `${ranges}。每週更新一次。`, `${ranges}. Updated once a week.`, `${ranges}。週に1回更新します。`, `${ranges}. 주 1회 갱신해요.`)));
    add(FACT_LABEL.ttsource[lang], escapeHtml(model.ttSystems.map(code => TT_SOURCE[code][lang]).join(pick4(lang, '；', '. ', '。', '. ')) + pick4(lang, '。', '.', '。', '.')));
    const groups = model.tts.map(({ item, tt }) => {
      const title = pick4(lang, `${SYSTEM_SHORT.zh[item.system]}${tt.station.zh}站（不含以本站為終點的班次）`, `${SYSTEM_SHORT.en[item.system]} ${tt.station.en} Station (services ending here are not counted)`, `${SYSTEM_SHORT.ja[item.system]}${tt.station.ja}駅（この駅が終点の列車は含みません）`, `${SYSTEM_SHORT.ko[item.system]} ${tt.station.ko}역(이 역이 종점인 열차 제외)`);
      const chips = tt.perDay.map(p => `<li${tt.offDates.includes(p.date) ? ' class="off"' : ''}><span>${dayCountLabel(lang, p)}</span><b>${p.departing}</b></li>`).join('');
      return `<p class="dc-title">${escapeHtml(title)}</p><ul class="day-counts">${chips}</ul>`;
    });
    add(FACT_LABEL.perday[lang], groups.join(''));
  }
  add(FACT_LABEL.stations[lang], model.details.map(item => `${escapeHtml(SYSTEM_NAMES[lang][item.system] || item.system)} ${escapeHtml(memberName(lang, item))}${pick4(lang, '（', ' (', '（', ' (')}${escapeHtml(item.stationId)}${pick4(lang, '）', ')', '）', ')')}`).join(pick4(lang, '；', '; ', '；', '; ')));
  if (model.address && lang === 'zh') add(FACT_LABEL.address.zh, escapeHtml(model.address));
  add(FACT_LABEL.coords[lang], `${model.position[0].toFixed(6)}, ${model.position[1].toFixed(6)}`);
  return `<section class="content-section" id="facts"><h2>${escapeHtml(pick4(lang, '本站可以搭什麼', 'What you can ride here', 'この駅で乗れる路線', '이 역에서 탈 수 있는 열차'))}</h2><div class="fact-table">\n      ${rows.join('\n      ')}\n    </div></section>`;
}

function howParagraphs(lang, model) {
  const has = code => model.sysCodes.includes(code);
  const first = [
    has('TRA') && pick4(lang, '台鐵列車以官方班表為基礎，官方即時誤點可用時會校正時間軸位置。', 'TRA trains run from the official timetable, and when official real-time delay data is available it is used to correct their position on the timeline.', '台鉄の列車は公式時刻表をもとに走り、公式のリアルタイム遅延データが使える場合は、時間軸上の位置を補正します。', '대만철도는 공식 시간표를 바탕으로 공식 실시간 지연이 있으면 시간축 위치를 보정해요.'),
    has('THSR') && pick4(lang, '高鐵列車依官方時刻表推演，本站頁面不宣稱有高鐵逐車 GPS。', 'HSR trains run from the official timetable; this page does not claim per-train GPS for high speed rail.', '高鉄の列車は公式時刻表にもとづいて走らせています。このページでは、高鉄の列車ごとの GPS 位置は使っていません。', '고속철도는 공식 시간표로 추정하며 열차별 GPS를 제공한다고 주장하지 않아요.'),
    METRO_SYSTEMS.some(has) && pick4(lang, '捷運列車依各營運機構可取得的官方時刻、班距、到站倒數或列車動態呈現；不同系統的即時程度不同。', 'Metro trains are shown from the official timetables, headways, arrival countdowns or train movements each operator makes available; the level of real-time data varies by system.', 'メトロの列車は、各運営会社が公開している公式の時刻、運転間隔、到着カウントダウン、列車の動きにもとづいて表示します。リアルタイム性はシステムによって異なります。', 'MRT는 각 운영사에서 이용 가능한 공식 시간 · 배차간격 · 도착 카운트다운 · 운행 정보로 표시하며 실시간 수준은 시스템마다 달라요.'),
    has('AFR') && pick4(lang, '阿里山林鐵依公開班表與路線資料推演。', 'Alishan Forest Railway trains run from the published timetable and route data.', '阿里山森林鉄道は、公開されている時刻表と路線データにもとづいて走ります。', '아리산 삼림철도는 공개 시간표와 노선 정보로 추정해요.'),
  ].filter(Boolean);
  const shorts = shortsOf(lang, model);
  const second = model.tts.length
    ? pick4(lang,
      `本頁的${joinList('zh', shorts)}時刻表每週更新一次，列的是資料涵蓋區間內的預定班次。當下班次、誤點、停駛與營運公告請回即時地圖查看，並以營運機構現場資訊為準。`,
      `The ${joinList('en', shorts)} timetables on this page are updated once a week and list the scheduled trains within the period the data covers. For current trains, delays, suspensions and operator announcements, use the live map, and rely on the operator's information at the station.`,
      `このページの${joinList('ja', shorts)}の時刻表は週に1回更新され、データの対象期間内の予定の列車を載せています。現在の列車、遅れ、運休、運営会社のお知らせはライブ地図で確認し、駅での案内など運営会社の情報を優先してください。`,
      `이 페이지의 ${joinList('ko', shorts)} 시간표는 주 1회 갱신되며 데이터 기간 안의 예정 열차를 실었어요. 현재 열차 · 지연 · 운휴 · 운행 공지는 실시간 지도로 돌아가 확인하고 현장 공식 안내를 따라 주세요.`)
    : pick4(lang,
      '這一頁只放不會每分鐘過期的車站資訊。當下班次、誤點、停駛與營運公告請回即時地圖查看，並以營運機構現場資訊為準。',
      'This page only holds station information that does not go out of date every minute. For current trains, delays, suspensions and operator announcements, use the live map, and rely on the operator\'s information at the station.',
      'このページには、刻々と古くならない駅の情報だけを載せています。現在の列車、遅れ、運休、運営会社のお知らせはライブ地図で確認し、駅での案内など運営会社の情報を優先してください。',
      '이 페이지는 매분 바뀌지 않는 역 정보만 제공해요. 현재 열차 · 지연 · 운휴 · 운행 공지는 실시간 지도로 돌아가 확인하고 현장 공식 안내를 따라 주세요.');
  const metroLink = METRO_SYSTEMS.some(has)
    ? `<p>${pick4(lang,
      `捷運的路線、首末班車與班距請看<a href="${metro.overviewHref('zh')}">捷運路線圖</a>。`,
      `For metro lines, first and last trains and headways, see the <a href="${metro.overviewHref('en')}">metro maps</a>.`,
      `メトロの路線、始発・終電、運転間隔は、<a href="${metro.overviewHref('ja')}">メトロ路線図</a>をご覧ください。`,
      `MRT 노선, 첫차 · 막차, 배차간격은 <a href="${metro.overviewHref('ko')}" hreflang="en">MRT 노선도(영어)</a>에서 볼 수 있어요.`)}</p>` : '';
  return `<p>${escapeHtml(first.join(pick4(lang, '', ' ', '', ' ')))}</p><p>${escapeHtml(second)}</p>${metroLink}`;
}

// related：「附近的車站資料頁」要放的設定（呼叫端決定：第一批是名單裡的前後輪，第二批是同路線相鄰站）。
// alts 只放這一站真的有頁面的語言（第二批 214 站只有中文）：hreflang 只指向存在的頁面。
function stationPageHtml(lang, config, related) {
  const model = stationModel(config);
  const slug = config.slug, title = tOf(lang, config), summary = summaryOf(lang, config);
  const pathname = stationHref(lang, slug);
  const alts = Object.fromEntries(pageLangs(config).map(code => [code, stationHref(code, slug)]));
  const shorts = shortsOf(lang, model), hasTt = model.tts.length > 0;
  // 標題／meta description 的長度是搜尋結果會不會被截斷的問題：英文 title ≤70、description ≤160，中日文 description ≤100 字。
  // 描述只留「站名＋時刻表＋系統＋資料涵蓋區間」，站的簡介（summary）留在頁面導言，不進 description。
  const ranges = model.ttSystems.map(code => `${SYSTEM_SHORT[lang][code]} ${rangeText(lang, model.tts.find(rec => rec.item.system === code).tt, false)}`);
  const pageTitle = hasTt
    ? pick4(lang, `${title}時刻表：${joinList('zh', shorts)}逐班時刻與轉乘`, `${title} Timetable: ${joinList('en', shorts)} Times and Transfers`, `${title} 時刻表：${joinList('ja', shorts)}の列車時刻と乗り換え`, `${title} 시간표: ${joinList('ko', shorts)} 열차 시각과 환승`)
    : pick4(lang, `${title}：路線、轉乘與軌島資料說明`, `${title}: Lines, Transfers and Rail Island Data`, `${title}：路線・乗り換えと軌島での表示`, `${title}: 노선 · 환승 · Rail Island 표시 안내`);
  const heading = hasTt ? pageTitle : title;
  const firstSentence = text => text.slice(0, (text.search(lang === 'en' || lang === 'ko' ? /\.(\s|$)/ : /。/) + 1) || text.length);
  const description = hasTt
    ? pick4(lang, `${title}時刻表：${joinList('zh', shorts)}兩週內逐班的開車時間、終點與行駛日，涵蓋${ranges.join('、')}，每週更新，並附轉乘說明。`,
      `${title} timetable: ${joinList('en', shorts)} train times and running days for ${joinList('en', ranges)}, updated weekly, with transfer notes.`,
      `${title}の時刻表：${joinList('ja', shorts)}の列車ごとの発車時刻・行き先・運転日（${ranges.join('、')}、毎週更新）と乗り換えの説明。`,
      `${title} 시간표: ${joinList('ko', shorts)} 열차별 시각 · 운행일(${ranges.join(', ')}, 매주 갱신)과 환승 안내.`)
    : pick4(lang, `${firstSentence(summary)}本頁說明收錄的系統與路線、轉乘的判讀方式、軌島如何顯示這一站，以及資料的限制。`, `${firstSentence(summary)} See the systems, lines, transfer notes and data limits.`, `${firstSentence(summary)}収録システム、路線、乗り換えの見方、データの限界を確認できます。`, `${firstSentence(summary)} 시스템 · 노선 · 환승 안내와 데이터 한계를 확인하세요.`);
  if ([...description].length > (lang === 'en' ? 160 : 100)) throw new Error(`車站頁 ${lang}/${slug} 的 description 過長（${[...description].length}）：${description}`);
  if (lang === 'en' && [...pageTitle].length > 70) throw new Error(`車站頁 en/${slug} 的 title 過長（${[...pageTitle].length}）：${pageTitle}`);
  const lede = hasTt
    ? pick4(lang, `${summary}本頁列出${ranges.join('、')} 的逐班時刻與行駛日，每週更新一次。`,
      `${summary} This page lists train-by-train times and running days for ${joinList('en', ranges)}, updated once a week.`,
      `${summary} このページでは、${ranges.join('、')}の列車ごとの時刻と運転日を、週に1回更新して載せています。`,
      `${summary} 이 페이지에는 ${ranges.join(', ')}의 열차별 시각과 운행일을 주 1회 갱신해 실었어요.`)
    : summary;
  const place = {
    '@type': 'Place', name: title,
    geo: { '@type': 'GeoCoordinates', latitude: model.position[0], longitude: model.position[1] },
    ...(model.address && lang === 'zh' ? { address: model.address } : {}),
  };
  const schema = {
    '@context': 'https://schema.org', '@type': 'WebPage', name: pageTitle, description, url: `${siteUrl}${pathname}`,
    inLanguage: htmlLangOf[lang], dateModified: stationModified,
    isPartOf: { '@type': 'WebSite', name: '軌島 Rail Island', url: `${siteUrl}/` },
    about: place, mainEntity: place,
  };
  const tags = [...new Set([...systemsOf(lang, model), ...routesOf(lang, model)])];
  const sections = model.tts.map(rec => ttSection(lang, model, rec));
  const tocItems = [
    ...sections.flatMap(section => section.toc),
    { id: 'transfer', label: pick4(lang, '轉乘與站體判讀', 'Transfers and how the stations relate', '乗り換えと駅の位置関係', '환승과 역 구역 안내') },
    { id: 'how', label: pick4(lang, '軌島怎麼顯示這一站', 'How Rail Island shows this station', '軌島でのこの駅の表示', 'Rail Island의 이 역 표시 방식') },
  ];
  const toc = hasTt
    ? `<nav class="page-toc" aria-label="${escapeHtml(pick4(lang, '本頁目錄', 'On this page', 'このページの内容', '이 페이지 목차'))}"><p class="toc-label">${escapeHtml(pick4(lang, '本頁目錄', 'On this page', 'このページの内容', '이 페이지 목차'))}</p><ul class="sibling-links">${tocItems.map(item => `<li><a href="#${item.id}">${escapeHtml(item.label)}</a></li>`).join('')}</ul></nav>` : '';
  const relatedCards = related.map(item => {
    const itemHasTt = stationModel(item).tts.length > 0;
    return `<article class="card station-card"><div class="station-systems">${escapeHtml(itemHasTt ? pick4(lang, '車站時刻與資料', 'Timetable and station guide', '時刻表と駅ガイド', '시간표와 역 정보') : pick4(lang, '車站資料', 'Station guide', '駅ガイド', K('車站資料')))}</div><h3>${escapeHtml(tOf(lang, item))}</h3><p>${escapeHtml(summaryOf(lang, item))}</p><a class="card-link" href="${stationHref(lang, item.slug)}">${escapeHtml(pick4(lang, `查看 ${tOf(lang, item)} →`, `View ${tOf(lang, item)} →`, `${tOf(lang, item)}を見る →`, `${tOf(lang, item)} 보기 →`))}</a></article>`;
  }).join('');
  const crumbs = [
    { label: pick4(lang, '首頁', 'Home', 'ホーム', K('首頁')), href: sh.homeHref(lang) },
    { label: pick4(lang, '車站索引', 'Station index', '駅の索引', K('車站索引')), href: stationIndexHref(lang) },
    { label: title, href: pathname },
  ];
  return `${sh.headHtml(lang, { title: pageTitle, description, pathname, alts, schema })}
${sh.headerHtml(lang, alts)}
  <main class="page-shell" id="main">
    ${sh.crumbsHtml(lang, crumbs)}
    <section class="hero">
      <p class="eyebrow">${hasTt ? 'STATION TIMETABLE' : 'STATION GUIDE'}</p>
      <h1>${escapeHtml(heading)}</h1>
      <p class="lede">${nbRoutes(escapeHtml(lede))}</p>
      <div class="tag-row">${tags.map(item => `<span class="tag">${escapeHtml(item)}</span>`).join('')}</div>
      <div class="hero-actions"><a class="button" href="${escapeHtml(liveHref(lang, model))}">${escapeHtml(pick4(lang, '在即時地圖查看', 'View on the live map', 'ライブ地図で見る', '실시간 지도에서 보기'))}</a><a class="button secondary" href="${stationIndexHref(lang)}">${escapeHtml(pick4(lang, '回車站索引', 'Back to the station index', '駅の索引へ戻る', '역 목록으로 돌아가기'))}</a></div>
    </section>
    ${factsSection(lang, model)}
    ${toc}
    ${sections.map(section => section.html).join('\n    ')}
    <section class="content-section st-anchor" id="transfer"><h2>${escapeHtml(pick4(lang, '轉乘與站體判讀', 'Transfers and how the stations relate', '乗り換えと駅の位置関係', '환승과 역 구역 안내'))}</h2><div class="answer-box"><p>${nbRoutes(transferHtmlOf(lang, config))}</p>${config.distanceNote === false ? '' : `<p>${escapeHtml(pick4(lang, '資料中的距離用於辨識共站與步行轉乘關係，不是站內導航，也不等於月台之間的實際步行時間。', 'Distances in the data are only used to recognise shared stations and walking transfers. They are not in-station navigation and do not equal the actual walking time between platforms.', 'データ上の距離は、共用駅や徒歩での乗り換え関係を見分けるために使っているもので、駅構内の案内ではなく、ホーム間の実際の所要時間でもありません。', '데이터의 거리는 공동 역 구역 · 도보 환승 관계를 구분하기 위한 것이며 역내 길 안내나 실제 승강장 간 도보 시간이 아니에요.'))}</p>`}</div></section>
    <section class="content-section st-anchor" id="how"><h2>${escapeHtml(pick4(lang, '軌島怎麼顯示這一站', 'How Rail Island shows this station', '軌島でのこの駅の表示', 'Rail Island의 이 역 표시 방식'))}</h2><div class="answer-box">${howParagraphs(lang, model)}</div></section>
    ${relatedCards ? `<section class="content-section"><h2>${escapeHtml(pick4(lang, '附近的車站資料頁', 'Nearby station pages', '近くの駅のページ', '근처 역 정보 페이지'))}</h2><div class="card-grid">${relatedCards}</div></section>` : ''}
  </main>
${sh.footerHtml(lang, alts, { en: stationIndexHref('en'), ja: stationIndexHref('ja'), ko: stationIndexHref('ko') })}`;
}

// ── 車站索引（/stations/、/en/stations/、/ja/stations/、/ko/stations/）──
const INDEX_TEXT = {
  zh: {
    title: '台灣鐵路車站時刻表與轉乘站索引｜軌島', h1: '車站時刻表與轉乘站索引',
    description: ({ n, traAll }) => `軌島車站索引整理 ${n} 個常查詢的台灣鐵路轉乘站與同名站，並依縣市列出全部 ${traAll} 個台鐵車站，提供台鐵、高鐵逐班時刻與行駛日（每週更新），並說明路線、共站關係與資料限制。`,
    h2: '常查詢車站', intro: '同名不一定同站。索引特別把台鐵與高鐵的桃園、新竹、台中、台南、嘉義分開，避免搜尋時把不同地點誤認成同一站。',
    linkTt: '查看時刻表與車站資料 →', linkGuide: '查看車站資料 →',
    noticeLead: '沒有列出的車站不代表軌島沒有收錄。', noticeText: '台鐵、高鐵的時刻表每週更新一次；完整站點與當下發車資訊仍在即時地圖中。',
    live: '打開即時地圖', second: '查車站資料', eyebrow: 'STATION INDEX',
  },
  en: {
    title: 'Taiwan Railway Station Timetables and Transfer Stations | Rail Island', h1: 'Station Timetables and Transfer Stations',
    description: ({ n }) => `Rail Island's station index covers ${n} frequently searched railway stations and same-name stations in Taiwan, with train-by-train TRA and HSR times and running days (updated weekly), plus lines, shared-station relationships and data limits.`,
    metaDescription: ({ n }) => `Timetables for ${n} frequently searched railway stations in Taiwan: train-by-train TRA and HSR times and running days, updated weekly.`,
    h2: 'Frequently searched stations', intro: 'Same name does not always mean same station. The index keeps the TRA and HSR stations of Taoyuan, Hsinchu, Taichung, Tainan and Chiayi apart, so that different places are not mistaken for one station when searching.',
    linkTt: 'View timetable and station guide →', linkGuide: 'View station guide →',
    noticeLead: 'A station that is not listed here is not necessarily missing from Rail Island.', noticeText: 'TRA and HSR timetables are updated once a week; the full list of stations and current departures are on the live map.',
    // 英日文只有 n 站：完整的台鐵站清單在中文索引（連過去，標 hreflang zh-Hant）
    zhIndexNote: n => `English and Japanese pages exist for ${n} stations. The complete list of TRA stations is in the <a href="/stations/" hreflang="zh-Hant">station index (Traditional Chinese)</a>.`,
    live: 'Open the live map', second: 'Station guides', eyebrow: 'STATION INDEX',
  },
  ja: {
    title: '台湾の鉄道駅 時刻表・乗り換え駅の索引｜軌島', h1: '駅の時刻表と乗り換え駅の索引',
    description: ({ n }) => `軌島の駅の索引では、台湾でよく検索される${n}の鉄道の乗り換え駅と同名駅について、台鉄・高鉄の列車ごとの時刻と運転日（毎週更新）、路線、駅の共用関係、データの限界を説明します。`,
    h2: 'よく検索される駅', intro: '同じ名前でも同じ駅とは限りません。この索引では、桃園・新竹・台中・台南・嘉義の台鉄と高鉄の駅を分けて載せ、検索するときに別の場所を同じ駅と取り違えないようにしています。',
    linkTt: '時刻表と駅ガイドを見る →', linkGuide: '駅ガイドを見る →',
    noticeLead: '載っていない駅が、軌島に収録されていないとは限りません。', noticeText: '台鉄・高鉄の時刻表は週に1回更新しており、すべての駅と現在の発車情報はライブ地図で確認できます。',
    zhIndexNote: n => `英語・日本語のページがある駅は${n}駅です。台鉄の全駅の一覧は、<a href="/stations/" hreflang="zh-Hant">駅の索引（繁体字中国語）</a>をご覧ください。`,
    live: 'ライブ地図を開く', second: '駅ガイド', eyebrow: 'STATION INDEX',
  },
  ko: {
    title: '대만 철도역 시간표 · 환승역 목록 | Rail Island', h1: '역 시간표 · 환승역 목록',
    description: ({ n }) => `자주 찾는 대만 환승역 · 동명 역 ${n}곳의 대만철도 · 고속철도 열차별 시각과 운행일(매주 갱신), 노선, 공동 환승 구역, 데이터 한계를 정리했어요.`,
    h2: '자주 찾는 역', intro: '이름이 같아도 같은 역은 아니에요. 대만철도와 고속철도의 타오위안 · 신주 · 타이중 · 타이난 · 자이를 구분해 서로 다른 장소를 같은 역으로 오해하지 않게 했어요.',
    linkTt: '시간표와 역 정보 보기 →', linkGuide: '역 정보 보기 →',
    noticeLead: '목록에 없어도 Rail Island에 없는 역이라는 뜻은 아니에요.', noticeText: '대만철도 · 고속철도 시간표는 주 1회 갱신해요. 전체 역과 현재 출발 정보는 실시간 지도에서 확인하세요.',
    zhIndexNote: n => `한국어 페이지가 있는 역은 ${n}곳이에요. 대만철도 전체 역 목록은 <a href="/stations/" hreflang="zh-Hant">역 목록(번체 중국어)</a>에서 볼 수 있어요.`,
    live: K('打開即時地圖'), second: K('車站資料'), eyebrow: 'STATION INDEX',
  },
};

// 全部台鐵車站（第一批成員＋第二批，每站一筆）：站名、縣市（取台鐵地址）、站碼、連結目標（第一批成員連到它所在的第一批頁）
const traEntries = [...stations, ...secondBatch].flatMap(config => config.members.filter(key => key.startsWith('TRA:')).map(key => {
  const item = transfers.stations[key];
  return { key, id: String(item.stationId), name: item.name, city: traCity(item), page: config };
}));

// 中文索引的「全部台鐵車站」分組區塊（依縣市分組，縣市內依站碼排序）。將來改成依路線分組，只要換掉這個函式。
// 版面：上方一排縣市跳轉按鈕（純錨點，不用 JS），每個縣市一個 h3＋一排 .sibling-links 膠囊，每站一個連結。
function traStationGroupsHtml() {
  const byCounty = new Map(TRA_COUNTY_ORDER.map(county => [county, []]));
  for (const entry of traEntries) {
    if (!byCounty.has(entry.city)) throw new Error(`台鐵「${entry.name}」的縣市「${entry.city}」不在索引的縣市順序裡（TRA_COUNTY_ORDER）`);
    byCounty.get(entry.city).push(entry);
  }
  const groups = [...byCounty].filter(([, list]) => list.length).map(([county, list], i) => ({
    county, id: `tra-county-${String(i + 1).padStart(2, '0')}`, list: list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  }));
  const jump = groups.map(g => `<li><a href="#${g.id}">${escapeHtml(g.county)}<small>${g.list.length}</small></a></li>`).join('');
  const body = groups.map(g => `<h3 id="${g.id}">${escapeHtml(g.county)}<small>${g.list.length} 站</small></h3><ul class="sibling-links chips">${g.list.map(entry => `<li><a href="${stationHref('zh', entry.page.slug)}">${escapeHtml(entry.name)}</a></li>`).join('')}</ul>`).join('');
  return `<section class="content-section tra-groups" id="all-tra"><h2>全部台鐵車站</h2><p class="section-intro">列出班表資料涵蓋的兩週內有列車停靠的 ${traEntries.length} 個台鐵車站，依所在縣市分組（縣市取自台鐵車站地址），縣市內依站碼排序；點站名可看該站的逐班時刻。</p><nav aria-label="依縣市跳轉"><ul class="sibling-links jump">${jump}</ul></nav>${body}</section>`;
}

function stationIndexHtml(lang) {
  const t = INDEX_TEXT[lang], pathname = stationIndexHref(lang);
  const alts = Object.fromEntries(LANGS4.map(code => [code, stationIndexHref(code)]));
  // 卡片：中文＝原本 23 張常查詢車站（其餘台鐵站在下面的分組區塊）；英日韓文＝30 站（第一批 23＋第二批 7），不分組。ItemList 收這個語言的每一頁。
  const featured = lang === 'zh' ? stations : pagesIn(lang), listed = pagesIn(lang);
  const counts = { n: featured.length, traAll: traEntries.length };
  const lede = t.description(counts);
  const description = (t.metaDescription || t.description)(counts);   // en 的頁面導言較長，meta description 另用 ≤160 字元的短版
  const schema = {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: t.title, description, url: `${siteUrl}${pathname}`,
    inLanguage: htmlLangOf[lang], dateModified: stationModified,
    isPartOf: { '@type': 'WebSite', name: '軌島 Rail Island', url: `${siteUrl}/` },
    mainEntity: { '@type': 'ItemList', numberOfItems: listed.length, itemListElement: listed.map((station, i) => ({ '@type': 'ListItem', position: i + 1, name: tOf(lang, station), url: `${siteUrl}${stationHref(lang, station.slug)}` })) },
  };
  const cards = featured.map(station => {
    const model = stationModel(station);
    return `<article class="card station-card"><div class="station-systems">${systemsOf(lang, model).map(escapeHtml).join(' · ')}</div><h3>${escapeHtml(tOf(lang, station))}</h3><p>${escapeHtml(summaryOf(lang, station))}</p><a class="card-link" href="${stationHref(lang, station.slug)}">${escapeHtml(model.tts.length ? t.linkTt : t.linkGuide)}</a></article>`;
  }).join('');
  const crumbs = [{ label: pick4(lang, '首頁', 'Home', 'ホーム', K('首頁')), href: sh.homeHref(lang) }, { label: t.h1, href: pathname }];
  const live = lang === 'zh' ? '/' : `/?lang=${lang}`;
  const linkText = metro.linkSectionText[lang], gap = pick4(lang, '', ' ', '', ' ');
  return `${sh.headHtml(lang, { title: t.title, description, pathname, alts, schema })}
${sh.headerHtml(lang, alts)}
  <main class="page-shell" id="main">
    ${sh.crumbsHtml(lang, crumbs)}
    <section class="hero">
      <p class="eyebrow">${t.eyebrow}</p>
      <h1>${escapeHtml(t.h1)}</h1>
      <p class="lede">${escapeHtml(lede)}</p>
      <div class="hero-actions"><a class="button" href="${live}">${escapeHtml(t.live)}</a>${lang === 'zh' ? `<a class="button secondary" href="${pathname}">${escapeHtml(t.second)}</a>` : ''}</div>
    </section>
    <section class="content-section"><h2>${escapeHtml(t.h2)}</h2><p class="section-intro">${escapeHtml(t.intro)}</p><div class="card-grid station-grid">${cards}</div></section>${lang === 'zh' ? `\n    ${traStationGroupsHtml()}` : ''}
  ${metroLinkSection({ h: linkText.h, text: linkText.text, href: metro.overviewHref(lang), label: linkText.link, hreflang: lang === 'ko' ? 'en' : undefined })}
  <section class="content-section"><div class="notice"><strong>${escapeHtml(t.noticeLead)}</strong>${gap}${[t.zhIndexNote ? t.zhIndexNote(featured.length) : '', escapeHtml(t.noticeText)].filter(Boolean).join(gap)}</div></section>
  </main>
${sh.footerHtml(lang, alts)}`;
}

// 第一批頁的「附近的車站資料頁」＝名單裡的前後輪（照舊）；第二批頁＝同路線相鄰、這個語言有頁面的站（nearbyPages）
for (const lang of LANGS4) {
  for (const [index, station] of stations.entries()) {
    const related = [stations[(index + 1) % stations.length], stations[(index + stations.length - 1) % stations.length]];
    write(outFile(stationHref(lang, station.slug)), stationPageHtml(lang, station, related));
  }
  for (const station of secondBatch) if (pageLangs(station).includes(lang)) write(outFile(stationHref(lang, station.slug)), stationPageHtml(lang, station, nearbyPages(station, lang)));
  write(outFile(stationIndexHref(lang)), stationIndexHtml(lang));
}

// ── 英日文獨立著陸頁（2026-09-29，v0929b）──────────────────────────────────────────────
// 首頁網頁版固定繁中（Googlebot 是 en-US，原本會被自動切成英文），外國旅客改由 /en/、/ja/ 進來，
// 再由 CTA 帶 ?lang= 進即時地圖。內容只改寫自上面 about／accuracy／data-sources 三頁與首頁英日文字典，不新增功能宣稱。
// 文案紅線：非 GPS 系統寫「依時刻表在地圖上跑」；高鐵沒有逐車誤點；不提收費與通行證；不寫錄影含音樂。
const landingUpdated = '2026-09-29';
const hreflangLinks = [
  ['zh-Hant', `${siteUrl}/`], ['en', `${siteUrl}/en/`], ['ja', `${siteUrl}/ja/`], ['ko', `${siteUrl}/ko/`], ['x-default', `${siteUrl}/`],
];
const landings = {
  en: {
    htmlLang: 'en', ogLocale: 'en_US', pathname: '/en/', live: '/?lang=en',
    title: 'Taiwan Train Map: TRA, High Speed Rail, Taipei MRT & Airport MRT | Rail Island',
    description: 'Rail Island is an animated map of Taiwan\'s trains: Taiwan Railway (TRA), Taiwan High Speed Rail, Taipei MRT, Taoyuan Airport MRT, Kaohsiung MRT, Taichung MRT, light rail and the Alishan Forest Railway, running from official timetables and live data where available.',
    skip: 'Skip to main content', brandLabel: 'Rail Island home', nav: 'Main navigation',
    switchLabel: [['中文', '/', 'zh-Hant'], ['日本語', '/ja/', 'ja'], ['한국어', '/ko/', 'ko']],
    openMap: 'Open the live map',
    eyebrow: 'RAIL ISLAND · TAIWAN TRAIN MAP',
    h1: 'Rail Island: a live animated map of Taiwan\'s trains',
    lede: 'See Taiwan Railway (TRA), Taiwan High Speed Rail, Taipei MRT, Taoyuan Airport MRT, Kaohsiung MRT, Taichung MRT, light rail and the Alishan Forest Railway on one map. Trains move along the tracks by official timetable, corrected with official real-time data wherever it is available.',
    secondary: ['Accuracy and limits (Traditional Chinese)', '/accuracy/'],
    sections: [
      { h: 'Which railways are on the map', type: 'facts', rows: [
        ['Taiwan Railway (TRA)', 'Intercity and commuter trains around the island, drawn from the official timetable. When official real-time delay data is available it is used to correct where each train is on the timeline.'],
        ['Taiwan High Speed Rail', 'Drawn from the official timetable. Rail Island does not claim per-train GPS or official real-time delays for high speed rail.'],
        ['Taipei MRT and Taoyuan Airport MRT', 'Taipei Metro lines and the Taoyuan Airport MRT, including the link between Taipei Main Station and the airport.'],
        ['Kaohsiung MRT, Taichung MRT and New Taipei Circular Line', 'Other city metros, shown from the official schedules, headways or arrival countdowns each system makes available.'],
        ['Light rail and Alishan Forest Railway', 'Light rail lines and the Alishan Forest Railway run from public timetables and route data.'],
      ] },
      { h: 'How to use it', type: 'cards', cards: [
        ['Pick a system', 'Use the tabs at the top to choose which railway to watch: TRA, high speed rail, metro or all of them together.'],
        ['Tap a train', 'The camera follows that train until its terminal.'],
        ['Tap a station', 'See upcoming departures and countdowns for that station.'],
      ] },
      { h: 'How accurate is it?', type: 'answer', paras: [
        'Most operators do not publish per-train GPS positions. A moving train on the map is usually placed by combining the official timetable, running times between stations, stop times and any real-time arrival signal that is available. Systems without a per-train GPS feed run on the timetable, or on official arrival countdowns where those exist.',
        'Tunnels, temporary changes, upstream outages or a device with the wrong clock can make the screen differ from what is happening on the tracks.',
      ] },
      { h: 'Where the data comes from', type: 'facts', rows: [
        ['Taiwan Railway OpenData', 'Daily timetables, station information and train type codes.'],
        ['Ministry of Transportation TDX', 'TRA real-time delays and station information, plus routes, stop sequences, timetables or headways for high speed rail, metro and light rail, used under the Open Government Data License, version 1.'],
        ['Operator public data', 'Arrival countdowns, train movements or service notices, used where licensing and technical conditions allow.'],
        ['OpenStreetMap', 'Fills in some track geometry. Data by OpenStreetMap contributors under the ODbL.'],
        ['Taiwan Railway Wiki', 'Estimated models for local trains are adapted from a community-compiled rolling-stock roster (CC BY-SA 4.0). Official timetables do not separate these series, so treat them as estimates.'],
      ] },
      { h: 'Open the map', type: 'cta', text: 'Rail Island opens in Traditional Chinese by default. The button below opens the live map in English.' },
      { h: 'Not a replacement for official travel information', type: 'notice', lead: 'Important:', text: 'Rail Island is good for exploring the network, not as the only basis for catching a train, safety decisions or operations. Check the operator\'s app, website, station boards or announcements for temporary suspensions and platform changes.' },
    ],
    footer: 'Rail Island is an independently maintained, source-available animated map of Taiwan\'s railways and is not affiliated with any operator.',
    footerLinks: [['Accuracy and limits (Traditional Chinese)', '/accuracy/'], ['Data sources (Traditional Chinese)', '/data-sources/'], ['GitHub source', 'https://github.com/siriushsu/taiwan-rail-live']],
    schemaName: 'Rail Island: Taiwan Train Map',
  },
  ja: {
    htmlLang: 'ja', ogLocale: 'ja_JP', pathname: '/ja/', live: '/?lang=ja',
    title: '台湾鉄道ライブ地図｜台鉄・台湾新幹線・台北MRT・桃園空港MRT｜軌島 Rail Island',
    description: '軌島（Rail Island）は、台鉄（TRA）、台湾高速鉄道（台湾新幹線）、台北MRT、桃園空港MRT、高雄MRT、台中MRT、ライトレール、阿里山森林鉄道の列車を、公式時刻表と利用できる公式リアルタイムデータで動かす台湾鉄道の地図です。',
    skip: 'メインコンテンツへ', brandLabel: '軌島 ホーム', nav: 'メインナビゲーション',
    switchLabel: [['中文', '/', 'zh-Hant'], ['English', '/en/', 'en'], ['한국어', '/ko/', 'ko']],
    openMap: 'ライブ地図を開く',
    eyebrow: 'RAIL ISLAND · 台湾鉄道ライブ地図',
    h1: '軌島：台湾の列車が動くライブ地図',
    lede: '台鉄（TRA）、台湾高速鉄道（台湾新幹線）、台北MRT、桃園空港MRT、高雄MRT、台中MRT、ライトレール、阿里山森林鉄道をひとつの地図で。列車は公式時刻表にそって走り、公式のリアルタイムデータが使える場合はそれで位置を補正します。',
    secondary: ['精度と限界（繁体字中国語）', '/accuracy/'],
    sections: [
      { h: '地図に載っている鉄道', type: 'facts', rows: [
        ['台鉄（TRA）', '台湾各地を走る特急（自強号・莒光号）や区間車を公式時刻表から描きます。公式のリアルタイム遅延データが使える場合は、時間軸上の列車位置の補正に使います。'],
        ['台湾高速鉄道（高鉄・台湾新幹線）', '公式時刻表から描きます。列車ごとの GPS 位置や公式のリアルタイム遅延情報は反映していません。'],
        ['台北MRT・桃園空港MRT', '台北MRTの各路線と、台北駅と桃園国際空港を結ぶ桃園空港MRTです。台北MRTは全路線とも、公式の列車ごとのリアルタイム情報で位置と到着カウントダウンを表示します。'],
        ['高雄MRT・台中MRT・新北環状線', 'そのほかの都市のメトロは、各システムが公開している公式の時刻、運転間隔、到着カウントダウンにもとづいて表示します。'],
        ['ライトレール・阿里山森林鉄道', 'ライトレールと阿里山森林鉄道は、公開されている時刻表と路線データにもとづいて走ります。'],
      ] },
      { h: '使い方', type: 'cards', cards: [
        ['システムを選ぶ', '画面上部のタブで、台鉄・高鉄・メトロ、またはすべてから見たい鉄道を選びます。'],
        ['列車をタップ', '地図がその列車を終点まで追いかけて表示します。'],
        ['駅をタップ', 'その駅にこれから来る列車と、到着までのカウントダウンを確認できます。'],
      ] },
      { h: '精度はどのくらい？', type: 'answer', paras: [
        '多くの運行会社は、列車ごとの GPS 位置を公開していません。地図上で動く列車は、公式時刻表、駅間の走行時間、停車時間、利用できるリアルタイムの到着情報を組み合わせて位置を求めています。列車ごとの GPS がないシステムは時刻表どおりに、公式の到着カウントダウンがあればそれにそって走ります。',
        'トンネル、臨時の運行変更、情報源の停止、端末の時計のずれなどで、画面が現場と異なることがあります。',
      ] },
      { h: 'データの出典', type: 'facts', rows: [
        ['台鉄 OpenData', '毎日の時刻表、駅の基本情報、列車種別コードなど。'],
        ['交通部 TDX', '台鉄のリアルタイム遅延と駅情報、高鉄・メトロ・ライトレールの路線、停車駅順、時刻表または運転間隔。政府資料オープンライセンス第1版にもとづいて利用しています。'],
        ['運行会社の公開データ', '許諾と技術的な条件が許す範囲で、到着カウントダウン、列車の動き、運行のお知らせを使います。'],
        ['OpenStreetMap', '一部の線路形状を補います。OpenStreetMap の貢献者によるデータで、ODbL にもとづいて利用しています。'],
        ['臺灣鐵道維基館', '区間車の車種推定は、有志がまとめた編成運用表（CC BY-SA 4.0）を改変して使っています。公式時刻表は世代を区別しないため、参考情報です。'],
      ] },
      { h: '地図を開く', type: 'cta', text: '軌島の地図は最初、繁体字中国語で表示されます。下のボタンから日本語表示で開けます。' },
      { h: '公式の運行情報の代わりにはなりません', type: 'notice', lead: '重要：', text: '軌島は路線網を眺めて楽しみ、理解するための地図です。列車に間に合うかどうかや安全にかかわる判断、運行管理の唯一の根拠にはしないでください。臨時運休やのりばの変更は、運行会社のアプリ、ウェブサイト、駅の案内、お知らせで確認してください。' },
    ],
    footer: '軌島は独立して運営している、ソースコード公開の台湾鉄道アニメーション地図です。各鉄道事業者とは関係ありません。',
    footerLinks: [['精度と限界（繁体字中国語）', '/accuracy/'], ['データの出典（繁体字中国語）', '/data-sources/'], ['GitHub ソースコード', 'https://github.com/siriushsu/taiwan-rail-live']],
    schemaName: '軌島 Rail Island：台湾鉄道ライブ地図',
  },
  // 韓文用 K() 取字典既有譯文；字典沒有的只剩標題與操作說明。品牌只寫 Rail Island，說明頁有韓文版，所以連 /ko/accuracy/。
  ko: {
    htmlLang: 'ko', ogLocale: 'ko_KR', pathname: '/ko/', live: '/?lang=ko', brand: 'Rail Island', updated: koGuideDate,
    title: '대만 철도 실시간 지도: 대만철도 · 고속철도 · 타이베이 MRT · 타오위안 공항 MRT | Rail Island',
    description: K('軌島是一張依官方時刻表與可用即時資料，呈現台灣台鐵、高鐵、捷運、輕軌與阿里山林鐵列車的動畫地圖，也能查看車站、班次與營運公告。'),
    skip: K('跳到主要內容'), brandLabel: 'Rail Island 홈', nav: '주요 메뉴',
    switchLabel: [['中文', '/', 'zh-Hant'], ['English', '/en/', 'en'], ['日本語', '/ja/', 'ja']],
    openMap: K('打開即時地圖'),
    eyebrow: 'RAIL ISLAND · 대만 철도 지도',
    h1: 'Rail Island: 대만 철도 실시간 애니메이션 지도',
    lede: K('軌島是一張依官方時刻表與可用即時資料，呈現台灣台鐵、高鐵、捷運、輕軌與阿里山林鐵列車的動畫地圖，也能查看車站、班次與營運公告。'),
    secondary: [K('準確度與限制'), '/ko/accuracy/'], secondaryLang: 'ko',
    sections: [
      { h: '지도에 있는 철도', type: 'facts', rows: [
        [K('台鐵'), K('以官方時刻表為基礎；官方即時誤點可用時，校正列車在時間軸上的位置。資料過舊時會退回推估，不把舊資料假裝成 LIVE。')],
        [K('高鐵'), K('依官方時刻表推演；軌島目前不宣稱有高鐵逐車 GPS 或官方即時誤點。')],
        [K('捷運與輕軌'), K('依各系統可取得的官方逐班時刻、班距、到站倒數或列車動態校正。不同系統的即時程度不同。')],
        [K('阿里山林鐵'), K('依公開班表與路線資料推演；日出相關列車會依日期資料處理，但仍應以官方公告為準。')],
      ] },
      { h: '사용 방법', type: 'cards', cards: [
        ['시스템 고르기', '화면 위쪽 탭에서 대만철도 · 고속철도 · MRT 또는 전체 중 보고 싶은 철도를 고르세요.'],
        ['열차 누르기', '열차를 누르면 지도가 종점까지 따라가요.'],
        ['역 누르기', '역을 누르면 다음 열차와 도착까지 남은 시간을 확인해요.'],
      ] },
      { h: K('軌島準確嗎？'), type: 'answer', paras: [
        K('多數營運機構不提供可公開使用的逐車 GPS 座標。因此地圖上的移動位置常是把官方班表、站間行駛時間、停站時間與可用的即時到站訊號放在一起推算的結果。它能呈現列車大致行進情形，但不是安全定位設備。'),
        K('隧道、臨時調度、上游斷訊、裝置時間不準或瀏覽器暫停背景分頁，都可能讓畫面與現場產生差異。'),
      ] },
      { h: K('主要來源與用途'), type: 'facts', rows: [
        [K('台鐵 OpenData'), K('每日時刻表、車站基本資料與車種代碼等穩定資料。')],
        [K('交通部 TDX'), K('台鐵即時誤點與車站資訊，以及高鐵、捷運、輕軌等系統的路線、站序、時刻表或班距資料，依政府資料開放授權條款第1版使用。')],
        [K('營運機構資料'), K('在授權與技術條件允許時，使用各營運機構的到站倒數、列車動態或營運公告校正畫面。')],
        ['OpenStreetMap', K('補足部分軌道幾何；資料來自 OpenStreetMap 貢獻者並依 ODbL 使用。')],
        [K('臺灣鐵道維基館'), K('區間車車型推估改編自社群整理的編組運用表（CC BY-SA 4.0）；官方班表不分世代，僅供參考。')],
      ] },
      { h: '지도 열기', type: 'cta', text: 'Rail Island 지도는 처음에 번체 중국어로 열려요. 아래 버튼을 누르면 한국어 화면으로 열려요.' },
      { h: K('不能取代官方行車資訊'), type: 'notice', lead: K('重要：').trim(), text: K('軌島適合探索與輔助理解路網，不應作為趕車、安全決策或營運調度的唯一依據。臨時停駛、月台異動與現場狀況請以營運機構公告為準。') },
    ],
    footer: K('軌島是獨立維護、原始碼公開可查的台灣鐵道即時動畫地圖，與各營運機構無關。'),
    footerLinks: [[K('準確度與限制'), '/ko/accuracy/'], [K('資料來源'), '/ko/data-sources/'], [K('GitHub 原始碼'), 'https://github.com/siriushsu/taiwan-rail-live']],
    schemaName: 'Rail Island: 대만 철도 실시간 지도',
  },
};

// /en/、/ja/、/ko/ 第二段插入「捷運路線圖」入口（文字由 build_metro_pages.mjs 提供，和 zh 頁同一份來源；韓文沒有捷運頁，連英文版）
for (const code of ['en', 'ja', 'ko']) {
  const t = metro.linkSectionText[code];
  landings[code].sections.splice(1, 0, { h: t.h, type: 'link', text: t.text, href: metro.overviewHref(code), label: t.link, hreflang: code === 'ko' ? 'en' : undefined });
}
// 車站時刻頁的入口（英日韓文首頁到 /en/stations/、/ja/stations/、/ko/stations/ 的內部連結；sitemap 之外的另一條路）
const stationLinkText = {
  en: { h: 'Station timetables', text: 'Train-by-train timetables and running days for Taiwan Railway (TRA) and Taiwan High Speed Rail (HSR) at major stations such as Taipei, Taichung and Kaohsiung, with transfer notes and how Rail Island shows each station.', link: 'Station timetables and transfers' },
  ja: { h: '駅の時刻表', text: '台北・台中・高雄などの主要駅について、台鉄と高鉄の列車ごとの時刻と運転日、乗り換えの説明、軌島での駅の表示をまとめています。', link: '駅の時刻表と乗り換えを見る' },
  ko: { h: '역 시간표', text: '타이베이 · 타이중 · 가오슝 등 주요 역의 대만철도 · 고속철도 열차별 시각과 운행일, 환승 안내, Rail Island의 역 표시 방식을 정리했어요.', link: '역 시간표와 환승 보기' },
};
for (const code of ['en', 'ja', 'ko']) {
  const t = stationLinkText[code];
  landings[code].sections.splice(2, 0, { h: t.h, type: 'link', text: t.text, href: stationIndexHref(code), label: t.link });
}

function landingHtml(config) {
  const canonical = `${siteUrl}${config.pathname}`, brand = config.brand || '軌島 Rail Island';
  const schema = {
    '@context': 'https://schema.org', '@type': 'WebPage', name: config.schemaName, description: config.description, url: canonical,
    inLanguage: config.htmlLang, dateModified: config.updated || landingUpdated, isPartOf: { '@type': 'WebSite', name: '軌島 Rail Island', url: `${siteUrl}/` },
  };
  const renderSection = section => {
    const h2 = `<h2>${escapeHtml(section.h)}</h2>`;
    if (section.type === 'facts') return `<section class="content-section">${h2}<div class="fact-table">${section.rows.map(([label, value]) => `<div class="fact-row"><div class="fact-label">${escapeHtml(label)}</div><div class="fact-value">${escapeHtml(value)}</div></div>`).join('')}</div></section>`;
    if (section.type === 'cards') return `<section class="content-section">${h2}<div class="card-grid">${section.cards.map(([title, body]) => `<article class="card"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p></article>`).join('')}</div></section>`;
    if (section.type === 'answer') return `<section class="content-section">${h2}<div class="answer-box">${section.paras.map(text => `<p>${escapeHtml(text)}</p>`).join('')}</div></section>`;
    if (section.type === 'link') return metroLinkSection(section);
    if (section.type === 'cta') return `<section class="content-section">${h2}<div class="answer-box"><p>${escapeHtml(section.text)}</p></div><p><a class="button" href="${config.live}">${escapeHtml(config.openMap)}</a></p></section>`;
    return `<section class="content-section">${h2}<div class="notice"><strong>${escapeHtml(section.lead)}</strong> ${escapeHtml(section.text)}</div></section>`;
  };
  return `<!doctype html>
<html lang="${config.htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${escapeHtml(config.title)}</title>
  <meta name="description" content="${escapeHtml(config.description)}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="${canonical}">
${hreflangLinks.map(([code, href]) => `  <link rel="alternate" hreflang="${code}" href="${href}">`).join('\n')}
  <meta property="og:locale" content="${config.ogLocale}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${brand}">
  <meta property="og:title" content="${escapeHtml(config.title)}">
  <meta property="og:description" content="${escapeHtml(config.description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${siteUrl}/og-1200x630.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-180.png">
  <meta name="theme-color" content="#F2EDE2">
  ${THEME_BOOT}
  <link rel="stylesheet" href="/assets/aeo.css">
  <script type="application/ld+json">${jsonLd(schema)}</script>
</head>
<body>
  <a class="skip-link" href="#main">${escapeHtml(config.skip)}</a>
  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href="${config.pathname}" aria-label="${escapeHtml(config.brandLabel)}">${BRAND_MARK}<span>${brand}</span></a>
      <nav class="site-nav" aria-label="${escapeHtml(config.nav)}">
        ${config.switchLabel.map(([label, href, code]) => `<a href="${href}" hreflang="${code}" lang="${code}">${escapeHtml(label)}</a>`).join('\n        ')}
        <a class="nav-live" href="${config.live}">${escapeHtml(config.openMap)}</a>
      </nav>
    </div>
  </header>
  <main class="page-shell" id="main">
    <section class="hero">
      <p class="eyebrow">${escapeHtml(config.eyebrow)}</p>
      <h1>${escapeHtml(config.h1)}</h1>
      <p class="lede">${escapeHtml(config.lede)}</p>
      <div class="hero-actions"><a class="button" href="${config.live}">${escapeHtml(config.openMap)}</a><a class="button secondary" href="${config.secondary[1]}" hreflang="${config.secondaryLang || 'zh-Hant'}">${escapeHtml(config.secondary[0])}</a></div>
    </section>
    ${config.sections.map(renderSection).join('\n    ')}
  </main>
  <footer class="site-footer">
    <div class="site-footer-inner">
      <div>${escapeHtml(config.footer)}</div>
      <div class="footer-links">${config.footerLinks.map(([label, href]) => `<a href="${href}">${escapeHtml(label)}</a>`).join('')}</div>
    </div>
  </footer>
</body>
</html>
`;
}
for (const [code, config] of Object.entries(landings)) write(`${code}/index.html`, landingHtml(config));

write('robots.txt', `User-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`);

const sitemapPaths = [
  '/',
  '/en/',
  '/ja/',
  '/ko/',
  '/about/',
  '/accuracy/',
  '/data-sources/',
  '/ko/about/',
  '/ko/accuracy/',
  '/ko/data-sources/',
  ...LANGS4.flatMap(lang => [stationIndexHref(lang), ...pagesIn(lang).map(station => stationHref(lang, station.slug))]),
  ...metro.paths,
  '/status.html',
  '/privacy.html',
  '/terms.html',
];
const metroPathSet = new Set(metro.paths);
const stationPathSet = new Set(LANGS4.flatMap(lang => [stationIndexHref(lang), ...pagesIn(lang).map(station => stationHref(lang, station.slug))]));
const lastmodOf = pathname => {
  if (metroPathSet.has(pathname)) return metro.date;
  if (stationPathSet.has(pathname)) return stationModified;
  if (pathname === '/en/' || pathname === '/ja/') return landingUpdated;
  if (pathname === '/ko/' || pathname.startsWith('/ko/')) return koGuideDate;
  // 首頁的 title／description 與「捷運路線圖」入口跟捷運頁同一批（09-29）改過
  if (pathname === '/' || pathname === '/about/') return metro.templateDate;
  return updated;
};
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapPaths.map(pathname => `  <url><loc>${siteUrl}${pathname}</loc><lastmod>${lastmodOf(pathname)}</lastmod></url>`).join('\n')}\n</urlset>\n`);

// ── 寫檔或比對 ────────────────────────────────────────────────────────────────────────
// 捷運頁與車站頁的目錄只由本腳本產生，所以磁碟上有、但這次沒產出的檔案＝孤兒（路線或車站被拿掉、改 slug），寫檔模式會刪、--check 會報。
const metroDirs = ['metro', 'en/metro', 'ja/metro', 'stations', 'en/stations', 'ja/stations', 'ko/stations'];
function filesUnder(relativeDir) {
  const dir = path.join(root, relativeDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const child = `${relativeDir}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(child) : [child];
  });
}
const orphans = metroDirs.flatMap(filesUnder).filter(relative => !outputs.has(relative)).sort();
const metroSummary = `${metro.paths.length} metro pages (${Object.entries(metro.counts).map(([kind, n]) => `${kind} ${n}`).join(' / ')}), missing en/ja station names: ${metro.missingNames.length}`;

if (checkMode) {
  const problems = [];
  for (const [relative, content] of outputs) {
    const target = path.join(root, relative);
    if (!fs.existsSync(target)) problems.push(`缺檔      ${relative}`);
    else if (!fs.readFileSync(target).equals(Buffer.from(content, 'utf8'))) problems.push(`內容不同  ${relative}`);
  }
  for (const relative of orphans) problems.push(`多餘      ${relative}`);
  if (problems.length) {
    console.error(`AEO pages out of date（${problems.length} 個檔案和產生器輸出不同）：\n${problems.join('\n')}\n請執行 node scripts/build_aeo_pages.mjs 重產後一起 commit。`);
    process.exit(1);
  }
  console.log(`AEO pages up to date: ${outputs.size} files checked, ${metroSummary}`);
} else {
  for (const [relative, content] of outputs) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  for (const relative of orphans) {
    fs.unlinkSync(path.join(root, relative));
    // 刪完若目錄空了就一併移除（只往上收到 metro 根目錄以內）
    for (let dir = path.dirname(path.join(root, relative)); metroDirs.every(d => dir !== path.join(root, d)) && fs.readdirSync(dir).length === 0; dir = path.dirname(dir)) fs.rmdirSync(dir);
  }
  console.log(`AEO pages built: ${LANGS4.reduce((n, lang) => n + pagesIn(lang).length, 0)} station pages (zh ${pagesIn('zh').length} / en ${pagesIn('en').length} / ja ${pagesIn('ja').length} / ko ${pagesIn('ko').length}) + ${LANGS4.length} station indexes + 6 guide pages + en/ja/ko landing pages + robots/sitemap + ${metroSummary}${orphans.length ? `; removed ${orphans.length} orphan files` : ''}`);
}
