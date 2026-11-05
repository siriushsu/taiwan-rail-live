// 官方平交道 XML 有這筆但 POS 是 NULL、現地仍在用的平交道。build_crossings.mjs 用這裡的座標補上。
// 座標：OSM railway=level_crossing 節點平均（scripts/.crossings_cache/osm_level_crossings.json）。
export const ADDED_CROSSINGS = [
  // issue #80：鶯歌–鳳鳴間 K050+780。OSM node 2561510773 等 6 點，投影到縱貫線北段離線 4 m、d=50.95
  { name: '尖山埔路', county: '新北市', lat: 24.948271, lon: 121.34167 },
];
