// 官方平交道 XML 仍帶座標、現地已立體化或停用的平交道。build_crossings.mjs 讀這份不上圖，
// apply_crossings_removed.mjs 用同一份從現行 data/crossings.json 拿掉（不整檔重建，見該檔）。
// 依據：rail-3d/physical/network.json 的台鐵股道（OSM tunnel/bridge＋data/rail_structures_official.json 官方橋隧補正，
// 判定同 build_rail_levels.mjs 的 classifyRailStructure）在平交道 40 m 內只有隧道或高架，沒有地面股道；
// 且 OSM railway=level_crossing（scripts/.crossings_cache/osm_level_crossings.json，2026-07-12）最近一點都在 300 m 外
// （美術館路、華安街 24 m 處那兩點是 description=高雄環狀輕軌）。官方 XML 2026-10-31 重抓與 07-12 快取逐 byte 相同。
// 鍵：name＋county＋lnId（民族路在縱貫線南段有兩筆，只靠 name＋lnId 分不開）。
const group = (reason, county, lnId, names) => names.map(name => ({ name, county, lnId, reason }));

export const REMOVED_CROSSINGS = [
  ...group('高雄市區地下化：OSM way 576403132 隧道 7.1 km', '高雄市', '縱貫線南段',
    ['崇德路(舊名新莊路)', '華榮路', '明誠路', '美術館路', '華安街']),
  ...group('高雄市區地下化：OSM way 595516467 隧道 6.2 km', '高雄市', '屏東線', ['正義路', '中正路']),
  ...group('屏東市區高架：OSM way 132216818／45665574／45665566 高架橋（最長 5.5 km）', '屏東縣', '屏東線',
    ['大豐路', '大同路', '合興巷', '建民路', '工業四路', '歸來路']),
  ...group('臺中山線高架：OSM way 442204147／442204146 高架橋 13.4 km、442234249 高架橋 4.9 km', '臺中市', '山線',
    ['南陽路', '陽明街', '田心路', '豐南街', '祥和路', '中山路(一)', '人和路', '潭子街(一)', '圓通南路',
      '中山路(二)', '中興路', '碧柳一巷', '興進路', '十甲路', '三民路', '大慶街']),
  ...group('員林市區高架：OSM way 479816907／310770441 高架橋 4.0 km', '彰化縣', '縱貫線南段',
    ['北勢路', '員林外環道', '靜修路', '惠萊街']),
  ...group('橋梁段：OSM way 967676189 橋 2.2 km', '臺南市', '縱貫線南段', ['竹源埤', '農場路']),
  ...group('橋梁段：OSM way 461907781 曾文溪橋 2.5 km', '臺南市', '縱貫線南段', ['東勢寮北']),
  ...group('橋梁段：OSM way 162545456 高架橋 1.6 km', '臺南市', '縱貫線南段', ['車行']),
  ...group('橋梁段：OSM way 921834839 橋 0.9 km', '臺中市', '海線', ['山腳']),
  // 2026-10-17 臺南鐵路地下化第一階段通車，大橋–保安地面線停用（原由 reshape_tainan_underground_2d_1017.mjs 一次性拿掉，
  // 收進這裡，build_crossings.mjs 重建時才不會長回來）。
  ...group('臺南鐵路地下化第一階段 2026-10-17 通車，大橋–保安地面線停用', '臺南市', '縱貫線南段',
    ['實踐路(舊名大光路)', '東豐路', '青年路', '大同路141巷', '榮譽路', '生產路', '龍寶路', '空軍後勤部']),
];

export const removedKey = x => `${x.name}|${x.county}|${x.lnId}`;
