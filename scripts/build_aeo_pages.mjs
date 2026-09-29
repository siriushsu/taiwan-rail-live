import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMetroPages } from './build_metro_pages.mjs';
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

// 每站三語文字：title／summary／transfer。en／ja 只翻譯 zh 已有的說法，站名、系統名、路線名照站上既有譯法
// （i18n/stations.json、scripts/build_metro_pages.mjs、/en/ 與 /ja/ 著陸頁）；不新增 zh 沒有的斷言。
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
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="${canonical}">
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
  <link rel="stylesheet" href="/assets/aeo.css">
  <script type="application/ld+json">${jsonLd(schema)}</script>
</head>`;
}

function header() {
  return `<body>
  <a class="skip-link" href="#main">跳到主要內容</a>
  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href="/" aria-label="軌島首頁"><span class="brand-mark" aria-hidden="true">軌</span><span>軌島 Rail Island</span></a>
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
${footer()}`;
}

// ── 捷運路線圖頁（階段 A，2026-09-29）：scripts/build_metro_pages.mjs，三語共 60 頁，全部由 data/ 產生 ──
const metro = buildMetroPages(root, { stationPages: stations, zhShell: { header, footer }, escapeHtml });
for (const [relative, html] of metro.files) write(relative, html);
const metroLinkSection = ({ h, text, href, label }) => `<section class="content-section"><h2>${escapeHtml(h)}</h2><div class="answer-box"><p>${escapeHtml(text)}</p></div><p><a class="button secondary" href="${href}">${escapeHtml(label)}</a></p></section>`;
const zhMetroSection = () => metroLinkSection({ h: metro.linkSectionText.zh.h, text: metro.linkSectionText.zh.text, href: metro.overviewHref('zh'), label: metro.linkSectionText.zh.link });

const aboutDescription = '軌島是一張依官方時刻表與可用即時資料，呈現台灣台鐵、高鐵、捷運、輕軌與阿里山林鐵列車的動畫地圖，也能查看車站、班次與營運公告。';
write('about/index.html', renderPage({
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
}));

const accuracyDescription = '軌島不是所有列車的 GPS 地圖：台鐵套用官方即時誤點；其他系統依可取得的官方到站資訊、時刻表或班距推演，並清楚標示限制。';
write('accuracy/index.html', renderPage({
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
}));

const sourcesDescription = '軌島整合台鐵 OpenData、交通部 TDX、各捷運營運機構公開資料與 OpenStreetMap；不同資料分別負責班表、即時校正、車站與軌道幾何。';
write('data-sources/index.html', renderPage({
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
    <div class="fact-row"><div class="fact-label">地圖圖磚</div><div class="fact-value">網站街道圖使用 OpenFreeMap，衛星影像使用 Esri World Imagery；App 的 OpenFreeMap 載入失敗時改用 Stadia Maps。實際授權標示會顯示在地圖上。</div></div>
  </div></section>
  <section class="content-section"><h2>為什麼不只用一個 API</h2><div class="answer-box"><p>班表、站點、路線幾何、逐車狀態與營運公告通常分散在不同來源，而且每個鐵道系統公開的欄位不同。軌島保留來源差異：有即時訊號就校正，只有班表就明確當作推演，不用一種資料精度冒充所有系統。</p></div></section>
  <section class="content-section"><h2>更新與可追溯性</h2><div class="card-grid">
    <article class="card"><h3>資料狀態</h3><p>查看網站目前能否連上各項上游資料。</p><a class="card-link" href="/status.html">開啟狀態頁 →</a></article>
    <article class="card"><h3>公開原始碼</h3><p>資料管線與前端呈現方式都能在 GitHub 查閱。</p><a class="card-link" href="https://github.com/siriushsu/taiwan-rail-live">查看 GitHub →</a></article>
    <article class="card"><h3>解讀限制</h3><p>了解「即時」、「官方到站校正」與「班表推演」之間的差異。</p><a class="card-link" href="/accuracy/">準確度說明 →</a></article>
  </div></section>`,
}));

// ── 車站時刻頁與車站索引（中英日三語）───────────────────────────────────────────────────
// 資料：scripts/station_timetable.mjs（逐日班表 → 某站兩週逐班＋行駛日；純函式、不讀時鐘）。頁面一律用它的輸出，
// 不在這裡重算時刻、行駛日或班數。版型（head／頁首／頁尾／麵包屑／hreflang）沿用 build_metro_pages.mjs 的三語外殼。
// 內容紅線：每一句話都追得到 data/ 或站上既有文案；「軌島怎麼顯示這一站」照 index.html 現行導言；
// 不斷言官方有沒有公開某種資料，缺什麼只寫「軌島的資料來源沒有……」。
const sh = metro.shell;
const LANGS3 = ['zh', 'en', 'ja'];
const pick3 = (lang, zh, en, ja) => (lang === 'zh' ? zh : lang === 'en' ? en : ja);
const stationPrefix = { zh: '', en: '/en', ja: '/ja' };
const htmlLangOf = { zh: 'zh-Hant', en: 'en', ja: 'ja' };
const stationHref = (lang, slug) => `${stationPrefix[lang]}/stations/${slug}/`;
const stationIndexHref = lang => `${stationPrefix[lang]}/stations/`;
const outFile = pathname => `${pathname.replace(/^\//, '')}index.html`;
const joinList = (lang, items) => (lang === 'en' && items.length > 1
  ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
  : items.join(pick3(lang, '、', ', ', '・')));

const i18nStations = JSON.parse(fs.readFileSync(path.join(root, 'i18n/stations.json'), 'utf8'));
const ttInputs = loadStationTimetableInputs(root);
// 頁面日期取資料檔自己的抓取日期（不讀時鐘）：台鐵 dense 的 date、高鐵檔 fetched_at 的日期；範本改版日 2026-09-30 為下限。
const stationTemplateDate = '2026-09-30';
const stationModified = [stationTemplateDate, ttInputs.tra.date, String(ttInputs.thsr.fetched_at || '').slice(0, 10)].filter(Boolean).sort().pop();

const SYSTEM_NAMES = {
  zh: systemNames,
  en: { AFR: 'Alishan Forest Railway', KRTC: 'Kaohsiung MRT', THSR: 'Taiwan High Speed Rail (HSR)', TMRT: 'Taichung MRT', TRA: 'Taiwan Railway (TRA)', TRTC: 'Taipei MRT', TYMC: 'Taoyuan Airport MRT', NTMC: 'New Taipei Metro Circular Line' },
  ja: { AFR: '阿里山森林鉄道', KRTC: '高雄MRT', THSR: '台湾高速鉄道（高鉄）', TMRT: '台中MRT', TRA: '台鉄（TRA）', TRTC: '台北MRT', TYMC: '桃園空港MRT', NTMC: '新北メトロ環状線' },
};
const SYSTEM_SHORT = { zh: { TRA: '台鐵', THSR: '高鐵' }, en: { TRA: 'TRA', THSR: 'HSR' }, ja: { TRA: '台鉄', THSR: '高鉄' } };
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
// 路線名：台鐵取 TDX Rail/TRA/Line 字面（en＝英文名，ja＝TDX 只有中文，照抄不自己翻）；其餘取 i18n/stations.json 的 routes
function routeLabel(lang, key) {
  if (lang === 'zh') return routeNames[key] || key;
  if (key === 'THSR:THSR') return SYSTEM_NAMES[lang].THSR;
  const [sys, id] = key.split(':');
  if (sys === 'TRA') {
    const line = ttInputs.lineNames.lines[id];
    if (!line) throw new Error(`tra_line_names.json 缺台鐵路線 ${id}`);
    return lang === 'en' ? line.en : line.zh;
  }
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
const systemsOf = (lang, model) => model.sysCodes.map(code => SYSTEM_NAMES[lang][code]);
const routesOf = (lang, model) => [...new Set(model.routeKeys.map(key => routeLabel(lang, key)))];
const shortsOf = (lang, model) => model.ttSystems.map(code => SYSTEM_SHORT[lang][code]);

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
const WD_NAMES = { zh: ['一', '二', '三', '四', '五', '六', '日'], en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], ja: ['月', '火', '水', '木', '金', '土', '日'] };
const plainMd = md => { const cut = md.search(/[（(]/); return cut < 0 ? md : md.slice(0, cut).trim(); };
// 「9/28 週一（放假）」「Sep 28 Mon (holiday)」「9月28日 月曜（休日）」。回傳 HTML：手機窄欄時括號註記不准斷在中間
// （「（放／假）」），日期＋星期、括號註記各包成不斷行的單位（.nb），只允許在兩者之間換行。
const nb = html => `<span class="nb">${html}</span>`;
function dayCountLabel(lang, p) {
  const md = p.md[lang], plain = plainMd(md), note = md.slice(plain.length).trim(), wd = WD_NAMES[lang][p.weekday];
  const head = pick3(lang, `${plain} 週${wd}`, `${plain} ${wd}`, `${plain} ${wd}曜`);
  return nb(escapeHtml(head)) + (note ? pick3(lang, '', ' ', '') + nb(escapeHtml(note)) : '');
}
// 行駛日標籤裡的「日期＋括號註記」（9/28（放假）、Sep 28 (holiday)、10月9日（休日））同樣包成不斷行的單位；標籤本身是純文字（閘門與資料層用）
const NOTE_UNIT = /(?:(?:\d+\/\d+|[A-Z][a-z]{2} \d+|\d+月\d+日) ?)?[（(][^）)]*[）)]|\d+月\d+日/g;   // 日文的日期本身（10月10日）也不准斷在「月」與數字之間
const runLabelHtml = text => escapeHtml(text).replace(NOTE_UNIT, unit => nb(unit));
function rangeText(lang, tt, withWeekday = true) {
  const a = tt.perDay[0], b = tt.perDay[tt.perDay.length - 1];
  const pa = plainMd(a.md[lang]), pb = plainMd(b.md[lang]);
  if (!withWeekday) return pick3(lang, `${pa}–${pb}`, `${pa}–${pb}`, `${pa}〜${pb}`);
  const wa = WD_NAMES[lang][a.weekday], wb = WD_NAMES[lang][b.weekday];
  return pick3(lang, `${pa}（${wa}）至 ${pb}（${wb}）`, `${pa} (${wa}) to ${pb} (${wb})`, `${pa}（${wa}）〜${pb}（${wb}）`);
}

// ── 時刻表 ──
const timeHtml = t => (t.nextDay ? `${t.hm}<sup class="nd">+1</sup>` : t.hm);
const TH = {
  dep: { zh: '開車', en: 'Departs', ja: '発車' }, arr: { zh: '到站', en: 'Arrives', ja: '到着' },
  train: { zh: '車次', en: 'Train', ja: '列車' }, to: { zh: '終點', en: 'To', ja: '行き先' },
  from: { zh: '始發站', en: 'From', ja: '始発駅' }, run: { zh: '行駛日', en: 'Runs', ja: '運転日' },
};
// 手機版 CSS 把 table／tr／td 改成 display:block／inline（assets/aeo.css），Safari 在這種情況下會丟掉表格語意，
// 所以 role 一律明寫（ARIA 覆寫是標準解）。showType=false：高鐵每列的車種都一樣，是雜訊，不顯示。
function ttTable(lang, labelId, timeHead, otherHead, otherClass, rows, showType = true) {
  const car = r => (showType ? `<small class="car">${escapeHtml(r.type[lang])}</small>` : '');
  const body = rows.map(r => `<tr${r.label.special ? ' class="special"' : ''} role="row"><th scope="row" class="t" role="rowheader">${timeHtml(r.time)}</th><td class="c-train" role="cell">${escapeHtml(r.train)}${car(r)}</td><td class="${otherClass}" role="cell">${escapeHtml(r.other[lang])}</td><td class="c-run" role="cell">${runLabelHtml(r.label[lang])}</td></tr>`).join('');
  const colhead = text => `<th scope="col" role="columnheader">${escapeHtml(text)}</th>`;
  return `<div class="table-wrap tt-wrap"><table role="table" aria-labelledby="${labelId}"><thead role="rowgroup"><tr role="row">${colhead(timeHead)}${colhead(TH.train[lang])}${colhead(otherHead)}${colhead(TH.run[lang])}</tr></thead><tbody role="rowgroup">${body}</tbody></table></div>`;
}
const trainsN = (lang, n) => pick3(lang, `${n} 班`, `${n} train${n === 1 ? '' : 's'}`, `${n}本`);
function dirHeading(lang, sys, d) {
  const dests = d.destinations.slice(0, 2).map(x => x.name[lang]);
  if (sys === 'TRA') {
    if (!d.next || !d.next[lang]) throw new Error(`台鐵方向「${d.key}」缺 ${lang} 經由站名稱`);
    // 方向依「清單裡本站的下一個點」分，那個點可能是通過站、不是下一個停靠站，所以寫「經 X」不寫「下一站」
    return {
      main: pick3(lang, `往${dests.join('、')}方向`, `Towards ${joinList('en', dests)}`, `${dests.join('・')}方面`),
      sub: pick3(lang, `（經${d.next.zh}，${trainsN(lang, d.count)}）`, ` (via ${d.next.en}, ${trainsN(lang, d.count)})`, `（${d.next.ja}経由、${trainsN(lang, d.count)}）`),
    };
  }
  return {
    main: pick3(lang, `${d.label.zh}（往${dests.join('、')}）`, `${d.label.en} (towards ${joinList('en', dests)})`, `${d.label.ja}（${dests.join('・')}方面）`),
    sub: pick3(lang, `（${trainsN(lang, d.count)}）`, ` (${trainsN(lang, d.count)})`, `（${trainsN(lang, d.count)}）`),
  };
}
const ttBlockId = (rec, suffix) => `${rec.item.system.toLowerCase()}-${rec.item.stationId}-${suffix}`;

// 一個成員（台鐵或高鐵）的時刻段落；回傳 { html, toc }
function ttSection(lang, model, rec) {
  const { item, tt } = rec, sys = item.system;
  const short = SYSTEM_SHORT[lang][sys], name = tt.station[lang];
  const total = tt.directions.reduce((n, d) => n + d.count, 0), arrN = tt.arrivals.length;
  const range = rangeText(lang, tt);
  const h2 = pick3(lang, `${short}${name}站時刻表`, `${short} ${name} Station timetable`, `${short}${name}駅の時刻表`);
  const arrText = arrN ? pick3(lang, `；以本站為終點的 ${arrN} 班另列在到站時刻`, `; trains that end here (${arrN}) are listed separately under arrival times`, `。この駅が終点の列車（${arrN}本）は、到着時刻として別に載せています`) : '';
  // 「共 N」是整個資料區間內「不重複的班次列」（同車次、同時刻只算一個，不論行駛哪幾天），不是每天的班數——
  // 事實表寫的「每天開出班數」是另一個口徑，導言要讓人看得出這是 n 天合計。
  const n = tt.dates.length, one = total === 1;
  const intro = pick3(lang,
    `${range}，這 ${n} 天合計從${name}站開出 ${total} 個班次（同一車次、同一時刻只算一個，不論哪幾天行駛），依方向與開車時間排列${arrText}。「行駛日」標出不是每天都開的班次。`,
    `From ${range}, there ${one ? 'is' : 'are'} ${total} distinct ${short} departure${one ? '' : 's'} from ${name} Station over the ${n} days (each train number and departure time is counted once, however many days it runs), listed by direction and departure time${arrText}. Trains that don't run every day are highlighted in the "Runs" column.`,
    `${range}の${n}日間に${name}駅から発車する${short}は、列車番号と発車時刻の組み合わせごとに数えて合計${total}本です（運転日が違っても同じ組み合わせは1本と数えます）。方面と発車時刻の順に並べています${arrText}。毎日運転しない列車は「運転日」欄で目立たせています。`);
  const toc = [];
  const blocks = tt.directions.map((d, i) => {
    const id = ttBlockId(rec, sys === 'TRA' ? String(i + 1) : d.key);
    const { main, sub } = dirHeading(lang, sys, d);
    toc.push({ id, label: pick3(lang, `${short}${name}：${main}`, `${short} ${name}: ${main}`, `${short}${name}：${main}`) });
    const rows = d.rows.map(r => ({ time: r.dep, train: r.train, type: r.type, other: r.to, label: r.label }));
    return `<div class="dir-block"><h3 id="${id}">${escapeHtml(main)}<span class="dir-sub">${escapeHtml(sub)}</span></h3>${ttTable(lang, id, TH.dep[lang], TH.to[lang], 'c-to', rows, sys !== 'THSR')}</div>`;
  });
  if (arrN) {
    const id = ttBlockId(rec, 'arrivals');
    const main = pick3(lang, `以${name}站為終點的班次（到站時刻）`, `Trains ending at ${name} (arrival times)`, `${name}駅が終点の列車（到着時刻）`);
    const sub = pick3(lang, `（${trainsN(lang, arrN)}）`, ` (${trainsN(lang, arrN)})`, `（${trainsN(lang, arrN)}）`);
    toc.push({ id, label: pick3(lang, `${short}${name}：到站班次`, `${short} ${name}: arrivals`, `${short}${name}：到着列車`) });
    const rows = tt.arrivals.map(r => ({ time: r.arr, train: r.train, type: r.type, other: r.from, label: r.label }));
    blocks.push(`<div class="dir-block"><h3 id="${id}">${escapeHtml(main)}<span class="dir-sub">${escapeHtml(sub)}</span></h3>${ttTable(lang, id, TH.arr[lang], TH.from[lang], 'c-from', rows, sys !== 'THSR')}</div>`);
  }
  const afr = sys === 'TRA' && model.sysCodes.includes('AFR')
    ? `<p class="table-note">${escapeHtml(pick3(lang, '阿里山林鐵的班次不在本頁的時刻表內。', 'Alishan Forest Railway trips are not included in the timetables on this page.', '阿里山森林鉄道の列車は、このページの時刻表には含まれていません。'))}</p>` : '';
  const note = pick3(lang,
    '時刻捨去到分，與軌島地圖一致；標 +1 的是隔天凌晨。「行駛日」是資料涵蓋區間內實際行駛的日子，放假日依軌島的日曆資料（含國定假日、補假與補班）判定。',
    'Times are rounded down to the minute, as on the Rail Island map; +1 marks a time after midnight on the next day. "Runs" lists the days within the data period on which the train actually runs; holidays follow Rail Island\'s calendar data, including public holidays, make-up holidays and make-up working days.',
    '時刻は分未満を切り捨てており、軌島の地図と同じです。+1 は翌日の未明の時刻です。「運転日」は、データの対象期間内に実際に運転する日で、休日は軌島のカレンダーデータ（祝日、振替休日、振替出勤日を含む）で判定しています。');
  return {
    toc,
    html: `<section class="content-section tt" id="${sys.toLowerCase()}-${item.stationId}"><h2>${escapeHtml(h2)}</h2><p class="section-intro">${escapeHtml(intro)}</p>${blocks.join('')}${afr}<p class="table-note">${escapeHtml(note)}</p></section>`,
  };
}

// ── 車站頁 ──
const FACT_LABEL = {
  systems: { zh: '收錄系統', en: 'Systems', ja: '収録システム' },
  routes: { zh: '路線', en: 'Lines', ja: '路線' },
  ttdata: { zh: '時刻表涵蓋區間', en: 'Timetable period', ja: '時刻表の対象期間' },
  ttsource: { zh: '時刻表來源', en: 'Timetable source', ja: '時刻表の出典' },
  perday: { zh: '每天開出班數', en: 'Departures per day', ja: '1日の発車本数' },
  stations: { zh: '軌島站點', en: 'Rail Island stations', ja: '軌島の駅' },
  address: { zh: '台鐵地址', en: '', ja: '' },
  coords: { zh: '參考座標', en: 'Reference coordinates', ja: '参考座標' },
};
const TT_SOURCE = {
  TRA: { zh: '台鐵：臺鐵開放資料的逐日時刻表', en: 'TRA: daily timetables from the Taiwan Railway open data portal', ja: '台鉄：台湾鉄路の公式オープンデータ（毎日の時刻表）' },
  THSR: { zh: '高鐵：交通部 TDX 的高鐵每日時刻表', en: 'HSR: daily timetables from the Ministry of Transportation TDX platform', ja: '高鉄：交通部 TDX の日別時刻表' },
};

function factsSection(lang, model) {
  const rows = [];
  const add = (label, value) => rows.push(`<div class="fact-row"><div class="fact-label">${escapeHtml(label)}</div><div class="fact-value">${value}</div></div>`);
  const sep = pick3(lang, '；', '; ', '；');
  add(FACT_LABEL.systems[lang], systemsOf(lang, model).map(escapeHtml).join(pick3(lang, '、', ', ', '、')));
  add(FACT_LABEL.routes[lang], routesOf(lang, model).map(escapeHtml).join(pick3(lang, '、', ', ', '、')));
  if (model.tts.length) {
    const perSystem = code => model.tts.find(rec => rec.item.system === code);
    const ranges = model.ttSystems.map(code => `${SYSTEM_SHORT[lang][code]}${pick3(lang, '：', ': ', '：')}${rangeText(lang, perSystem(code).tt)}`).join(sep);
    add(FACT_LABEL.ttdata[lang], escapeHtml(pick3(lang, `${ranges}。每週更新一次。`, `${ranges}. Updated once a week.`, `${ranges}。週に1回更新します。`)));
    add(FACT_LABEL.ttsource[lang], escapeHtml(model.ttSystems.map(code => TT_SOURCE[code][lang]).join(pick3(lang, '；', '. ', '。')) + pick3(lang, '。', '.', '。')));
    const groups = model.tts.map(({ item, tt }) => {
      const title = pick3(lang, `${SYSTEM_SHORT.zh[item.system]}${tt.station.zh}站（不含以本站為終點的班次）`, `${SYSTEM_SHORT.en[item.system]} ${tt.station.en} Station (services ending here are not counted)`, `${SYSTEM_SHORT.ja[item.system]}${tt.station.ja}駅（この駅が終点の列車は含みません）`);
      const chips = tt.perDay.map(p => `<li${tt.offDates.includes(p.date) ? ' class="off"' : ''}><span>${dayCountLabel(lang, p)}</span><b>${p.departing}</b></li>`).join('');
      return `<p class="dc-title">${escapeHtml(title)}</p><ul class="day-counts">${chips}</ul>`;
    });
    add(FACT_LABEL.perday[lang], groups.join(''));
  }
  add(FACT_LABEL.stations[lang], model.details.map(item => `${escapeHtml(SYSTEM_NAMES[lang][item.system] || item.system)} ${escapeHtml(memberName(lang, item))}${pick3(lang, '（', ' (', '（')}${escapeHtml(item.stationId)}${pick3(lang, '）', ')', '）')}`).join(pick3(lang, '；', '; ', '；')));
  if (model.address && lang === 'zh') add(FACT_LABEL.address.zh, escapeHtml(model.address));
  add(FACT_LABEL.coords[lang], `${model.position[0].toFixed(6)}, ${model.position[1].toFixed(6)}`);
  return `<section class="content-section" id="facts"><h2>${escapeHtml(pick3(lang, '本站可以搭什麼', 'What you can ride here', 'この駅で乗れる路線'))}</h2><div class="fact-table">\n      ${rows.join('\n      ')}\n    </div></section>`;
}

function howParagraphs(lang, model) {
  const has = code => model.sysCodes.includes(code);
  const first = [
    has('TRA') && pick3(lang, '台鐵列車以官方班表為基礎，官方即時誤點可用時會校正時間軸位置。', 'TRA trains run from the official timetable, and when official real-time delay data is available it is used to correct their position on the timeline.', '台鉄の列車は公式時刻表をもとに走り、公式のリアルタイム遅延データが使える場合は、時間軸上の位置を補正します。'),
    has('THSR') && pick3(lang, '高鐵列車依官方時刻表推演，本站頁面不宣稱有高鐵逐車 GPS。', 'HSR trains run from the official timetable; this page does not claim per-train GPS for high speed rail.', '高鉄の列車は公式時刻表にもとづいて走らせています。このページでは、高鉄の列車ごとの GPS 位置は使っていません。'),
    METRO_SYSTEMS.some(has) && pick3(lang, '捷運列車依各營運機構可取得的官方時刻、班距、到站倒數或列車動態呈現；不同系統的即時程度不同。', 'Metro trains are shown from the official timetables, headways, arrival countdowns or train movements each operator makes available; the level of real-time data varies by system.', 'メトロの列車は、各運営会社が公開している公式の時刻、運転間隔、到着カウントダウン、列車の動きにもとづいて表示します。リアルタイム性はシステムによって異なります。'),
    has('AFR') && pick3(lang, '阿里山林鐵依公開班表與路線資料推演。', 'Alishan Forest Railway trains run from the published timetable and route data.', '阿里山森林鉄道は、公開されている時刻表と路線データにもとづいて走ります。'),
  ].filter(Boolean);
  const shorts = shortsOf(lang, model);
  const second = model.tts.length
    ? pick3(lang,
      `本頁的${joinList('zh', shorts)}時刻表每週更新一次，列的是資料涵蓋區間內的預定班次。當下班次、誤點、停駛與營運公告請回即時地圖查看，並以營運機構現場資訊為準。`,
      `The ${joinList('en', shorts)} timetables on this page are updated once a week and list the scheduled trains within the period the data covers. For current trains, delays, suspensions and operator announcements, use the live map, and rely on the operator's information at the station.`,
      `このページの${joinList('ja', shorts)}の時刻表は週に1回更新され、データの対象期間内の予定の列車を載せています。現在の列車、遅れ、運休、運営会社のお知らせはライブ地図で確認し、駅での案内など運営会社の情報を優先してください。`)
    : pick3(lang,
      '這一頁只放不會每分鐘過期的車站資訊。當下班次、誤點、停駛與營運公告請回即時地圖查看，並以營運機構現場資訊為準。',
      'This page only holds station information that does not go out of date every minute. For current trains, delays, suspensions and operator announcements, use the live map, and rely on the operator\'s information at the station.',
      'このページには、刻々と古くならない駅の情報だけを載せています。現在の列車、遅れ、運休、運営会社のお知らせはライブ地図で確認し、駅での案内など運営会社の情報を優先してください。');
  const metroLink = METRO_SYSTEMS.some(has)
    ? `<p>${pick3(lang,
      `捷運的路線、首末班車與班距請看<a href="${metro.overviewHref('zh')}">捷運路線圖</a>。`,
      `For metro lines, first and last trains and headways, see the <a href="${metro.overviewHref('en')}">metro maps</a>.`,
      `メトロの路線、始発・終電、運転間隔は、<a href="${metro.overviewHref('ja')}">メトロ路線図</a>をご覧ください。`)}</p>` : '';
  return `<p>${escapeHtml(first.join(pick3(lang, '', ' ', '')))}</p><p>${escapeHtml(second)}</p>${metroLink}`;
}

function stationPageHtml(lang, config, index) {
  const model = stationModel(config);
  const slug = config.slug, title = tOf(lang, config), summary = summaryOf(lang, config);
  const pathname = stationHref(lang, slug);
  const alts = Object.fromEntries(LANGS3.map(code => [code, stationHref(code, slug)]));
  const shorts = shortsOf(lang, model), hasTt = model.tts.length > 0;
  // 標題／meta description 的長度是搜尋結果會不會被截斷的問題：英文 title ≤70、description ≤160，中日文 description ≤100 字。
  // 描述只留「站名＋時刻表＋系統＋資料涵蓋區間」，站的簡介（summary）留在頁面導言，不進 description。
  const ranges = model.ttSystems.map(code => `${SYSTEM_SHORT[lang][code]} ${rangeText(lang, model.tts.find(rec => rec.item.system === code).tt, false)}`);
  const pageTitle = hasTt
    ? pick3(lang, `${title}時刻表：${joinList('zh', shorts)}逐班時刻與轉乘`, `${title} Timetable: ${joinList('en', shorts)} Times and Transfers`, `${title} 時刻表：${joinList('ja', shorts)}の列車時刻と乗り換え`)
    : pick3(lang, `${title}：路線、轉乘與軌島資料說明`, `${title}: Lines, Transfers and Rail Island Data`, `${title}：路線・乗り換えと軌島での表示`);
  const heading = hasTt ? pageTitle : title;
  const firstSentence = text => text.slice(0, (text.search(lang === 'en' ? /\.(\s|$)/ : /。/) + 1) || text.length);
  const description = hasTt
    ? pick3(lang, `${title}時刻表：${joinList('zh', shorts)}兩週內逐班的開車時間、終點與行駛日，涵蓋${ranges.join('、')}，每週更新，並附轉乘說明。`,
      `${title} timetable: ${joinList('en', shorts)} train times and running days for ${joinList('en', ranges)}, updated weekly, with transfer notes.`,
      `${title}の時刻表：${joinList('ja', shorts)}の列車ごとの発車時刻・行き先・運転日（${ranges.join('、')}、毎週更新）と乗り換えの説明。`)
    : pick3(lang, `${firstSentence(summary)}本頁說明收錄的系統與路線、轉乘的判讀方式、軌島如何顯示這一站，以及資料的限制。`, `${firstSentence(summary)} See the systems, lines, transfer notes and data limits.`, `${firstSentence(summary)}収録システム、路線、乗り換えの見方、データの限界を確認できます。`);
  if ([...description].length > (lang === 'en' ? 160 : 100)) throw new Error(`車站頁 ${lang}/${slug} 的 description 過長（${[...description].length}）：${description}`);
  if (lang === 'en' && [...pageTitle].length > 70) throw new Error(`車站頁 en/${slug} 的 title 過長（${[...pageTitle].length}）：${pageTitle}`);
  const lede = hasTt
    ? pick3(lang, `${summary}本頁列出${ranges.join('、')} 的逐班時刻與行駛日，每週更新一次。`,
      `${summary} This page lists train-by-train times and running days for ${joinList('en', ranges)}, updated once a week.`,
      `${summary} このページでは、${ranges.join('、')}の列車ごとの時刻と運転日を、週に1回更新して載せています。`)
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
    { id: 'transfer', label: pick3(lang, '轉乘與站體判讀', 'Transfers and how the stations relate', '乗り換えと駅の位置関係') },
    { id: 'how', label: pick3(lang, '軌島怎麼顯示這一站', 'How Rail Island shows this station', '軌島でのこの駅の表示') },
  ];
  const toc = hasTt
    ? `<nav class="page-toc" aria-label="${escapeHtml(pick3(lang, '本頁目錄', 'On this page', 'このページの内容'))}"><p class="toc-label">${escapeHtml(pick3(lang, '本頁目錄', 'On this page', 'このページの内容'))}</p><ul class="sibling-links">${tocItems.map(item => `<li><a href="#${item.id}">${escapeHtml(item.label)}</a></li>`).join('')}</ul></nav>` : '';
  const related = [stations[(index + 1) % stations.length], stations[(index + stations.length - 1) % stations.length]];
  const relatedCards = related.map(item => {
    const itemHasTt = stationModel(item).tts.length > 0;
    return `<article class="card station-card"><div class="station-systems">${escapeHtml(itemHasTt ? pick3(lang, '車站時刻與資料', 'Timetable and station guide', '時刻表と駅ガイド') : pick3(lang, '車站資料', 'Station guide', '駅ガイド'))}</div><h3>${escapeHtml(tOf(lang, item))}</h3><p>${escapeHtml(summaryOf(lang, item))}</p><a class="card-link" href="${stationHref(lang, item.slug)}">${escapeHtml(pick3(lang, `查看 ${tOf(lang, item)} →`, `View ${tOf(lang, item)} →`, `${tOf(lang, item)}を見る →`))}</a></article>`;
  }).join('');
  const crumbs = [
    { label: pick3(lang, '首頁', 'Home', 'ホーム'), href: sh.homeHref(lang) },
    { label: pick3(lang, '車站索引', 'Station index', '駅の索引'), href: stationIndexHref(lang) },
    { label: title, href: pathname },
  ];
  return `${sh.headHtml(lang, { title: pageTitle, description, pathname, alts, schema })}
${sh.headerHtml(lang, alts)}
  <main class="page-shell" id="main">
    ${sh.crumbsHtml(lang, crumbs)}
    <section class="hero">
      <p class="eyebrow">${hasTt ? 'STATION TIMETABLE' : 'STATION GUIDE'}</p>
      <h1>${escapeHtml(heading)}</h1>
      <p class="lede">${escapeHtml(lede)}</p>
      <div class="tag-row">${tags.map(item => `<span class="tag">${escapeHtml(item)}</span>`).join('')}</div>
      <div class="hero-actions"><a class="button" href="${escapeHtml(liveHref(lang, model))}">${escapeHtml(pick3(lang, '在即時地圖查看', 'View on the live map', 'ライブ地図で見る'))}</a><a class="button secondary" href="${stationIndexHref(lang)}">${escapeHtml(pick3(lang, '回車站索引', 'Back to the station index', '駅の索引へ戻る'))}</a></div>
    </section>
    ${factsSection(lang, model)}
    ${toc}
    ${sections.map(section => section.html).join('\n    ')}
    <section class="content-section st-anchor" id="transfer"><h2>${escapeHtml(pick3(lang, '轉乘與站體判讀', 'Transfers and how the stations relate', '乗り換えと駅の位置関係'))}</h2><div class="answer-box"><p>${escapeHtml(transferOf(lang, config))}</p><p>${escapeHtml(pick3(lang, '資料中的距離用於辨識共站與步行轉乘關係，不是站內導航，也不等於月台之間的實際步行時間。', 'Distances in the data are only used to recognise shared stations and walking transfers. They are not in-station navigation and do not equal the actual walking time between platforms.', 'データ上の距離は、共用駅や徒歩での乗り換え関係を見分けるために使っているもので、駅構内の案内ではなく、ホーム間の実際の所要時間でもありません。'))}</p></div></section>
    <section class="content-section st-anchor" id="how"><h2>${escapeHtml(pick3(lang, '軌島怎麼顯示這一站', 'How Rail Island shows this station', '軌島でのこの駅の表示'))}</h2><div class="answer-box">${howParagraphs(lang, model)}</div></section>
    <section class="content-section"><h2>${escapeHtml(pick3(lang, '附近的車站資料頁', 'Nearby station pages', '近くの駅のページ'))}</h2><div class="card-grid">${relatedCards}</div></section>
  </main>
${sh.footerHtml(lang, alts)}`;
}

// ── 車站索引（/stations/、/en/stations/、/ja/stations/）──
const INDEX_TEXT = {
  zh: {
    title: '台灣鐵路車站時刻表與轉乘站索引｜軌島', h1: '車站時刻表與轉乘站索引',
    description: n => `軌島車站索引整理 ${n} 個常查詢的台灣鐵路轉乘站與同名站，提供台鐵、高鐵逐班時刻與行駛日（每週更新），並說明路線、共站關係與資料限制。`,
    h2: '常查詢車站', intro: '同名不一定同站。索引特別把台鐵與高鐵的桃園、新竹、台中、台南、嘉義分開，避免搜尋時把不同地點誤認成同一站。',
    linkTt: '查看時刻表與車站資料 →', linkGuide: '查看車站資料 →',
    noticeLead: '沒有列出的車站不代表軌島沒有收錄。', noticeText: '這是第一批車站頁，台鐵、高鐵的時刻表每週更新一次；完整站點與當下發車資訊仍在即時地圖中。',
    live: '打開即時地圖', second: '查車站資料', eyebrow: 'STATION INDEX',
  },
  en: {
    title: 'Taiwan Railway Station Timetables and Transfer Stations | Rail Island', h1: 'Station Timetables and Transfer Stations',
    description: n => `Rail Island's station index covers ${n} frequently searched railway stations and same-name stations in Taiwan, with train-by-train TRA and HSR times and running days (updated weekly), plus lines, shared-station relationships and data limits.`,
    metaDescription: n => `Timetables for ${n} frequently searched railway stations in Taiwan: train-by-train TRA and HSR times and running days, updated weekly.`,
    h2: 'Frequently searched stations', intro: 'Same name does not always mean same station. The index keeps the TRA and HSR stations of Taoyuan, Hsinchu, Taichung, Tainan and Chiayi apart, so that different places are not mistaken for one station when searching.',
    linkTt: 'View timetable and station guide →', linkGuide: 'View station guide →',
    noticeLead: 'A station that is not listed here is not necessarily missing from Rail Island.', noticeText: 'These are the first station pages. TRA and HSR timetables are updated once a week; the full list of stations and current departures are on the live map.',
    live: 'Open the live map', second: 'Station guides', eyebrow: 'STATION INDEX',
  },
  ja: {
    title: '台湾の鉄道駅 時刻表・乗り換え駅の索引｜軌島', h1: '駅の時刻表と乗り換え駅の索引',
    description: n => `軌島の駅の索引では、台湾でよく検索される${n}の鉄道の乗り換え駅と同名駅について、台鉄・高鉄の列車ごとの時刻と運転日（毎週更新）、路線、駅の共用関係、データの限界を説明します。`,
    h2: 'よく検索される駅', intro: '同じ名前でも同じ駅とは限りません。この索引では、桃園・新竹・台中・台南・嘉義の台鉄と高鉄の駅を分けて載せ、検索するときに別の場所を同じ駅と取り違えないようにしています。',
    linkTt: '時刻表と駅ガイドを見る →', linkGuide: '駅ガイドを見る →',
    noticeLead: '載っていない駅が、軌島に収録されていないとは限りません。', noticeText: 'ここは最初の駅ページです。台鉄・高鉄の時刻表は週に1回更新しており、すべての駅と現在の発車情報はライブ地図で確認できます。',
    live: 'ライブ地図を開く', second: '駅ガイド', eyebrow: 'STATION INDEX',
  },
};

function stationIndexHtml(lang) {
  const t = INDEX_TEXT[lang], pathname = stationIndexHref(lang);
  const alts = Object.fromEntries(LANGS3.map(code => [code, stationIndexHref(code)]));
  const lede = t.description(stations.length);
  const description = (t.metaDescription || t.description)(stations.length);   // en 的頁面導言較長，meta description 另用 ≤160 字元的短版
  const schema = {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: t.title, description, url: `${siteUrl}${pathname}`,
    inLanguage: htmlLangOf[lang], dateModified: stationModified,
    isPartOf: { '@type': 'WebSite', name: '軌島 Rail Island', url: `${siteUrl}/` },
    mainEntity: { '@type': 'ItemList', numberOfItems: stations.length, itemListElement: stations.map((station, i) => ({ '@type': 'ListItem', position: i + 1, name: tOf(lang, station), url: `${siteUrl}${stationHref(lang, station.slug)}` })) },
  };
  const cards = stations.map(station => {
    const model = stationModel(station);
    return `<article class="card station-card"><div class="station-systems">${systemsOf(lang, model).map(escapeHtml).join(' · ')}</div><h3>${escapeHtml(tOf(lang, station))}</h3><p>${escapeHtml(summaryOf(lang, station))}</p><a class="card-link" href="${stationHref(lang, station.slug)}">${escapeHtml(model.tts.length ? t.linkTt : t.linkGuide)}</a></article>`;
  }).join('');
  const crumbs = [{ label: pick3(lang, '首頁', 'Home', 'ホーム'), href: sh.homeHref(lang) }, { label: t.h1, href: pathname }];
  const live = lang === 'zh' ? '/' : `/?lang=${lang}`;
  const linkText = metro.linkSectionText[lang];
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
    <section class="content-section"><h2>${escapeHtml(t.h2)}</h2><p class="section-intro">${escapeHtml(t.intro)}</p><div class="card-grid station-grid">${cards}</div></section>
  ${metroLinkSection({ h: linkText.h, text: linkText.text, href: metro.overviewHref(lang), label: linkText.link })}
  <section class="content-section"><div class="notice"><strong>${escapeHtml(t.noticeLead)}</strong>${lang === 'en' ? ' ' : ''}${escapeHtml(t.noticeText)}</div></section>
  </main>
${sh.footerHtml(lang, alts)}`;
}

for (const lang of LANGS3) {
  for (const [index, station] of stations.entries()) write(outFile(stationHref(lang, station.slug)), stationPageHtml(lang, station, index));
  write(outFile(stationIndexHref(lang)), stationIndexHtml(lang));
}

// ── 英日文獨立著陸頁（2026-09-29，v0929b）──────────────────────────────────────────────
// 首頁網頁版固定繁中（Googlebot 是 en-US，原本會被自動切成英文），外國旅客改由 /en/、/ja/ 進來，
// 再由 CTA 帶 ?lang= 進即時地圖。內容只改寫自上面 about／accuracy／data-sources 三頁與首頁英日文字典，不新增功能宣稱。
// 文案紅線：非 GPS 系統寫「依時刻表在地圖上跑」；高鐵沒有逐車誤點；不提收費與通行證；不寫錄影含音樂。
const landingUpdated = '2026-09-29';
const hreflangLinks = [
  ['zh-Hant', `${siteUrl}/`], ['en', `${siteUrl}/en/`], ['ja', `${siteUrl}/ja/`], ['x-default', `${siteUrl}/`],
];
const landings = {
  en: {
    htmlLang: 'en', ogLocale: 'en_US', pathname: '/en/', live: '/?lang=en',
    title: 'Taiwan Train Map: TRA, High Speed Rail, Taipei MRT & Airport MRT | Rail Island',
    description: 'Rail Island is an animated map of Taiwan\'s trains: Taiwan Railway (TRA), Taiwan High Speed Rail, Taipei MRT, Taoyuan Airport MRT, Kaohsiung MRT, Taichung MRT, light rail and the Alishan Forest Railway, running from official timetables and live data where available.',
    skip: 'Skip to main content', brandLabel: 'Rail Island home', nav: 'Main navigation',
    switchLabel: [['中文', '/', 'zh-Hant'], ['日本語', '/ja/', 'ja']],
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
    switchLabel: [['中文', '/', 'zh-Hant'], ['English', '/en/', 'en']],
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
      ] },
      { h: '地図を開く', type: 'cta', text: '軌島の地図は最初、繁体字中国語で表示されます。下のボタンから日本語表示で開けます。' },
      { h: '公式の運行情報の代わりにはなりません', type: 'notice', lead: '重要：', text: '軌島は路線網を眺めて楽しみ、理解するための地図です。列車に間に合うかどうかや安全にかかわる判断、運行管理の唯一の根拠にはしないでください。臨時運休やのりばの変更は、運行会社のアプリ、ウェブサイト、駅の案内、お知らせで確認してください。' },
    ],
    footer: '軌島は独立して運営している、ソースコード公開の台湾鉄道アニメーション地図です。各鉄道事業者とは関係ありません。',
    footerLinks: [['精度と限界（繁体字中国語）', '/accuracy/'], ['データの出典（繁体字中国語）', '/data-sources/'], ['GitHub ソースコード', 'https://github.com/siriushsu/taiwan-rail-live']],
    schemaName: '軌島 Rail Island：台湾鉄道ライブ地図',
  },
};

// /en/、/ja/ 第二段插入「捷運路線圖」入口（文字由 build_metro_pages.mjs 提供，和 zh 頁同一份來源）
for (const code of ['en', 'ja']) {
  const t = metro.linkSectionText[code];
  landings[code].sections.splice(1, 0, { h: t.h, type: 'link', text: t.text, href: metro.overviewHref(code), label: t.link });
}
// 車站時刻頁的入口（英日文首頁到 /en/stations/、/ja/stations/ 的內部連結；sitemap 之外的另一條路）
const stationLinkText = {
  en: { h: 'Station timetables', text: 'Train-by-train timetables and running days for Taiwan Railway (TRA) and Taiwan High Speed Rail (HSR) at major stations such as Taipei, Taichung and Kaohsiung, with transfer notes and how Rail Island shows each station.', link: 'Station timetables and transfers' },
  ja: { h: '駅の時刻表', text: '台北・台中・高雄などの主要駅について、台鉄と高鉄の列車ごとの時刻と運転日、乗り換えの説明、軌島での駅の表示をまとめています。', link: '駅の時刻表と乗り換えを見る' },
};
for (const code of ['en', 'ja']) {
  const t = stationLinkText[code];
  landings[code].sections.splice(2, 0, { h: t.h, type: 'link', text: t.text, href: stationIndexHref(code), label: t.link });
}

function landingHtml(config) {
  const canonical = `${siteUrl}${config.pathname}`;
  const schema = {
    '@context': 'https://schema.org', '@type': 'WebPage', name: config.schemaName, description: config.description, url: canonical,
    inLanguage: config.htmlLang, dateModified: landingUpdated, isPartOf: { '@type': 'WebSite', name: '軌島 Rail Island', url: `${siteUrl}/` },
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
  <meta property="og:site_name" content="軌島 Rail Island">
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
  <link rel="stylesheet" href="/assets/aeo.css">
  <script type="application/ld+json">${jsonLd(schema)}</script>
</head>
<body>
  <a class="skip-link" href="#main">${escapeHtml(config.skip)}</a>
  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href="${config.pathname}" aria-label="${escapeHtml(config.brandLabel)}"><span class="brand-mark" aria-hidden="true">軌</span><span>軌島 Rail Island</span></a>
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
      <div class="hero-actions"><a class="button" href="${config.live}">${escapeHtml(config.openMap)}</a><a class="button secondary" href="${config.secondary[1]}" hreflang="zh-Hant">${escapeHtml(config.secondary[0])}</a></div>
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
  '/about/',
  '/accuracy/',
  '/data-sources/',
  ...LANGS3.flatMap(lang => [stationIndexHref(lang), ...stations.map(station => stationHref(lang, station.slug))]),
  ...metro.paths,
  '/status.html',
  '/privacy.html',
  '/terms.html',
];
const metroPathSet = new Set(metro.paths);
const stationPathSet = new Set(LANGS3.flatMap(lang => [stationIndexHref(lang), ...stations.map(station => stationHref(lang, station.slug))]));
const lastmodOf = pathname => {
  if (metroPathSet.has(pathname)) return metro.date;
  if (stationPathSet.has(pathname)) return stationModified;
  if (pathname === '/en/' || pathname === '/ja/') return landingUpdated;
  // 首頁的 title／description 與「捷運路線圖」入口跟捷運頁同一批（09-29）改過
  if (pathname === '/' || pathname === '/about/') return metro.templateDate;
  return updated;
};
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapPaths.map(pathname => `  <url><loc>${siteUrl}${pathname}</loc><lastmod>${lastmodOf(pathname)}</lastmod></url>`).join('\n')}\n</urlset>\n`);

// ── 寫檔或比對 ────────────────────────────────────────────────────────────────────────
// 捷運頁與車站頁的目錄只由本腳本產生，所以磁碟上有、但這次沒產出的檔案＝孤兒（路線或車站被拿掉、改 slug），寫檔模式會刪、--check 會報。
const metroDirs = ['metro', 'en/metro', 'ja/metro', 'stations', 'en/stations', 'ja/stations'];
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
  console.log(`AEO pages built: ${stations.length * LANGS3.length} station pages (${stations.length} x zh/en/ja) + ${LANGS3.length} station indexes + 3 guide pages + en/ja landing pages + robots/sitemap + ${metroSummary}${orphans.length ? `; removed ${orphans.length} orphan files` : ''}`);
}
