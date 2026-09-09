// 太陽位置（NOAA Solar Calculator 演算法）
// 純數學：不需網路、不需資產、不需 API key。
// 輸入 UTC 毫秒＋經緯度，輸出方位角與高度角。
//
// 為什麼不用現成套件：這段約 60 行、零相依，比拉一個 npm 套件進 bundle 划算；
// 且軌島的「現在」有時區錨定（Asia/Taipei），時間必須由呼叫端給，不能在這裡拿 Date.now()。

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** UTC 毫秒 → 儒略世紀（J2000 起算） */
function julianCentury(utcMs) {
  const jd = utcMs / 86400000 + 2440587.5;
  return (jd - 2451545) / 36525;
}

/**
 * 太陽位置。
 * @param {number} utcMs   UTC 毫秒（由呼叫端提供，勿在此取系統時鐘）
 * @param {number} latDeg  緯度（北正）
 * @param {number} lonDeg  經度（東正）
 * @returns {{azimuth:number, elevation:number, declination:number, eqTimeMin:number}}
 *          azimuth: 0=正北, 90=正東, 180=正南, 270=正西
 *          elevation: 地平線上為正（未做大氣折射修正）
 */
export function sunPosition(utcMs, latDeg, lonDeg) {
  const t = julianCentury(utcMs);

  // 幾何平均黃經與平近點角
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

  // 中心差
  const C =
    Math.sin(M * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * M * RAD) * 0.000289;

  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);

  // 黃赤交角
  const seconds = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813));
  const e0 = 23 + (26 + seconds / 60) / 60;
  const eps = e0 + 0.00256 * Math.cos(omega * RAD);

  // 赤緯
  const declination =
    Math.asin(Math.sin(eps * RAD) * Math.sin(appLong * RAD)) * DEG;

  // 均時差（分鐘）
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTimeMin =
    4 * DEG *
    (y * Math.sin(2 * L0 * RAD) -
      2 * e * Math.sin(M * RAD) +
      4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) -
      0.5 * y * y * Math.sin(4 * L0 * RAD) -
      1.25 * e * e * Math.sin(2 * M * RAD));

  // 真太陽時 → 時角
  const utcMinutes = ((utcMs % 86400000) + 86400000) % 86400000 / 60000;
  const trueSolarMin = (utcMinutes + eqTimeMin + 4 * lonDeg + 1440) % 1440;
  const hourAngle = trueSolarMin / 4 < 0 ? trueSolarMin / 4 + 180 : trueSolarMin / 4 - 180;

  // 天頂角 → 高度角
  const latR = latDeg * RAD, decR = declination * RAD, haR = hourAngle * RAD;
  const cosZenith =
    Math.sin(latR) * Math.sin(decR) + Math.cos(latR) * Math.cos(decR) * Math.cos(haR);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZenith))) * DEG;
  const elevation = 90 - zenith;

  // 方位角（自正北順時針）
  let azimuth;
  const denom = Math.cos(latR) * Math.sin(zenith * RAD);
  if (Math.abs(denom) > 1e-9) {
    let c = (Math.sin(latR) * Math.cos(zenith * RAD) - Math.sin(decR)) / denom;
    c = Math.max(-1, Math.min(1, c));
    azimuth = hourAngle > 0 ? (Math.acos(c) * DEG + 180) % 360 : (540 - Math.acos(c) * DEG) % 360;
  } else {
    azimuth = latDeg > 0 ? 180 : 0;
  }

  return { azimuth, elevation, declination, eqTimeMin };
}

/** MapLibre light.position 是 [距離, 方位角, 極角]；anchor 必須為 map。 */
export function toMapLibreSunPosition(utcMs, latDeg, lonDeg) {
  const { azimuth, elevation } = sunPosition(utcMs, latDeg, lonDeg);
  return [1.15, azimuth, Math.max(0, Math.min(180, 90 - elevation))];
}

// 使用台北「曆日」，不能用凌晨 04:00 才換日的捷運營運日。
// 與既有時間軸相同：一天內回放，快轉過午夜回到該日 00:00。
export function solarTimeMs(date, simSec) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(simSec)) return NaN;
  return Date.parse(date + 'T00:00:00+08:00') + ((simSec % 86400 + 86400) % 86400) * 1000;
}

const clamp = x => Math.max(0, Math.min(1, x));
// 入夜後壓暗地面的其實是 landscape-hillshade：太陽落到地平線下時 illumination-altitude 被
// 夾成 0，整片地都算在陰影裡，於是 hillshade-shadow-color 以 0.82 的濃度蓋滿地被、土地利用
// 與水域。那層是 map3d.js 插在 'building' 之前的，所以【畫在它上面】的道路、機場鋪面、
// 底圖鐵道與 2D 建物入夜後仍是白天的淺色——2026-09-09 使用者回報「晚上道路都還是淺色的，
// 幾乎看不清楚軌道跟車」就是這件事。這裡把同一顆陰影色補塗到那批圖層，讓它們一起入夜。
const NIGHT_INK = [23, 38, 59];
// 地面吃到 0.82；鋪面只吃 0.72，仍看得出路網走向，但不再比我們自己畫的軌道亮。
const PAVED_NIGHT = .72;
// 【上界是 boundary_3】：再上面是行政界線與地名標籤,壓暗它們只會變成看不清楚的字。
// 名單刻意寫死而不在執行期依圖層順序推導:執行期那段還夾著本專案自己加的軌道與車輛圖層,
// 依順序取會把軌道也一起壓暗。漏掉新圖層由 verify_sun.mjs 對照樣式檔擋下。
export const PAVED_LAYERS = [
  ['building', 'fill-color'],
  ['tunnel_motorway_casing', 'line-color'], ['tunnel_motorway_inner', 'line-color'],
  ['aeroway-taxiway', 'line-color'], ['aeroway-runway-casing', 'line-color'],
  ['aeroway-area', 'fill-color'], ['aeroway-runway', 'line-color'],
  ['road_area_pier', 'fill-color'], ['road_pier', 'line-color'],
  ['highway_path', 'line-color'], ['highway_minor', 'line-color'],
  ['highway_major_casing', 'line-color'], ['highway_major_inner', 'line-color'],
  ['highway_major_subtle', 'line-color'],
  ['highway_motorway_casing', 'line-color'], ['highway_motorway_inner', 'line-color'],
  ['highway_motorway_subtle', 'line-color'],
  ['railway_transit', 'line-color'], ['railway_transit_dashline', 'line-color'],
  ['railway_service', 'line-color'], ['railway_service_dashline', 'line-color'],
  ['railway', 'line-color'], ['railway_dashline', 'line-color'],
  ['highway_motorway_bridge_casing', 'line-color'], ['highway_motorway_bridge_inner', 'line-color'],
];

// 樣式裡三種寫法都有:#rrggbb（道路）、rgba()（跑道）、hsl()（滑行道）。只認純色字串,
// 遇到 expression（陣列）就跳過不動,免得把資料驅動的配色換成一個死色。
export function parseColor(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (text[0] === '#') {
    const hex = text.length === 4 ? [...text.slice(1)].map(c => c + c).join('') : text.slice(1, 7);
    return /^[0-9a-f]{6}$/.test(hex) ? [[0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)), 1] : null;
  }
  const n = text.match(/-?\d*\.?\d+/g)?.map(Number);
  if (!n || n.length < 3) return null;
  const alpha = n.length > 3 ? clamp(n[3]) : 1;
  if (text.startsWith('rgb')) return [n.slice(0, 3).map(v => clamp(v / 255) * 255), alpha];
  if (!text.startsWith('hsl')) return null;
  const h = ((n[0] % 360) + 360) % 360 / 360, sat = clamp(n[1] / 100), l = clamp(n[2] / 100);
  const q = l < .5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q;
  const channel = t => { t = (t + 1) % 1;
    return (t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p) * 255; };
  return [[channel(h + 1 / 3), channel(h), channel(h - 1 / 3)], alpha];
}

/** 把一個色彩字串往夜色靠 alpha 這麼多；認不得的寫法原樣回傳。 */
export function shadeColor(value, ink, alpha) {
  // 白天（alpha 0）原樣退回，不做「解析再重組」——那會把 hsl()／rgba() 悄悄改寫成等值的
  // #rrggbb。畫面一樣，但樣式值不再等於樣式檔那份，之後任何逐字比對都會看到假差異。
  if (!(alpha > 0)) return value;
  const parsed = parseColor(value);
  if (!parsed) return value;
  const [rgb, a] = parsed, out = rgb.map((v, i) => Math.round(mix(v, ink[i], alpha)));
  return a >= 1 ? '#' + out.map(v => v.toString(16).padStart(2, '0')).join('')
    : `rgba(${out.join(',')},${a})`;
}
const mix = (a, b, t) => a + (b - a) * t;
const color = (a, b, t) => '#' + a.map((v, i) => Math.round(mix(v, b[i], t)).toString(16).padStart(2, '0')).join('');
// MapLibre 5.9.0 的 Sky.setSky 會合併值；還原局部 sky 時也要清掉本功能補入的值。
export const skyDefaults = { 'sky-color': '#88C6FC', 'horizon-color': '#ffffff',
  'fog-color': '#ffffff', 'fog-ground-blend': .5, 'horizon-fog-blend': .8,
  'sky-horizon-blend': .8, 'atmosphere-blend': .8 };

// 色彩是視覺調校，太陽位置才是天文計算；不將配色宣稱為當地天氣觀測。
// 以高度連續插值，拖曳時間軸或日出跨門檻時不會硬切。
export function sunlightAt(utcMs, lat, lon) {
  const sun = sunPosition(utcMs, lat, lon), e = sun.elevation;
  const evening = clamp((sun.azimuth - 160) / 40);
  const warm = [mix(246, 248, evening), mix(196, 157, evening), mix(155, 113, evening)];
  const stops = [
    [-18, [12, 21, 39], [28, 40, 66], [108, 126, 159], .24],
    [-6, [38, 56, 94], [129, 114, 144], [163, 166, 197], .3],
    [0, [91, 126, 166], warm, [255, 189, 139], .42],
    [8, [125, 174, 211], [246, 218, 184], [255, 227, 193], .52],
    [30, [125, 186, 231], [215, 233, 244], [255, 248, 232], .55],
  ];
  let i = stops.findIndex(s => e < s[0]);
  if (i < 0) i = stops.length - 1;
  const a = stops[Math.max(0, i - 1)], b = stops[i];
  let t = a === b ? 0 : clamp((e - a[0]) / (b[0] - a[0]));
  t = t * t * (3 - 2 * t);
  const horizon = color(a[2], b[2], t);
  let daylight = clamp((e + 6) / 14);
  daylight = daylight * daylight * (3 - 2 * daylight);
  return { ...sun, utcMs, lat, lon,
    phase: e < -12 ? 'night' : e < -6 ? 'blue-hour' : e < 8 ? (evening > .5 ? 'sunset' : 'dawn') : 'day',
    sky: {
      'sky-color': color(a[1], b[1], t), 'horizon-color': horizon,
      'fog-color': horizon, 'sky-horizon-blend': .65,
      'horizon-fog-blend': .5, 'fog-ground-blend': .7,
      'atmosphere-blend': 0, // 目前為平面 Mercator；globe 大氣散射不適用。
    },
    light: { anchor: 'map', position: [1.15, sun.azimuth, 90 - e],
      color: color(a[3], b[3], t), intensity: mix(a[4], b[4], t) },
    // 道路等畫在 hillshade 上面的鋪面：跟著同一條 daylight 曲線入夜，黃昏連續過渡不硬切。
    paved: { ink: NIGHT_INK, alpha: mix(PAVED_NIGHT, 0, daylight) },
    // standard 方法不讀太陽高度；basic 才以 DEM 坡面法線計算入射光。
    // 夜間只保留少量環境光的坡面對比，不改 map.setTerrain 的實際地形起伏。
    hillshade: {
      'hillshade-method': 'basic', 'hillshade-illumination-anchor': 'map',
      'hillshade-illumination-direction': Math.min(359, sun.azimuth),
      'hillshade-illumination-altitude': Math.max(0, Math.min(90, e)),
      'hillshade-exaggeration': mix(.08, .42, daylight),
      'hillshade-shadow-color': `rgba(23,38,59,${mix(.82, .54, daylight).toFixed(3)})`,
      'hillshade-highlight-color': `rgba(255,222,177,${mix(.32, .08, clamp(e / 35)).toFixed(3)})`,
    },
  };
}

/** 低頻套用，不添圖層、不改相機投影。style.load 後保存新底圖的原值再重掛。 */
export function createSunlight({ engine, context, enabled = true }) {
  const map = engine.raw;
  let on = enabled, original = null, key = '', current = null, disposed = false;
  let terrainOriginal = null;
  let pavedOriginal = null, pavedAlpha = null;
  const terrainId = 'landscape-hillshade';
  const stats = { calculations: 0, applications: 0 };
  function update(force = false) {
    if (disposed || !on || document.hidden || !engine.isStyleReady() || !original) return;
    const c = context();
    if (!c || ![c.utcMs, c.lat, c.lon].every(Number.isFinite)) return;
    // 真實時間每 30 秒、位置每約 2 km 才更新；快轉最多每秒一次。
    const nextKey = [Math.floor(c.utcMs / 30000), Math.round(c.lat * 50), Math.round(c.lon * 50)].join(':');
    if (!force && nextKey === key) return;
    current = sunlightAt(c.utcMs, c.lat, c.lon); stats.calculations++;
    const layer = map.getLayer(terrainId);
    if (layer && terrainOriginal?.layer !== layer) {
      terrainOriginal = { layer, paint: Object.fromEntries(Object.keys(current.hillshade)
        .map(k => [k, map.getPaintProperty(terrainId, k) ?? null])) };
    }
    // 5.9.0 的 Sky validator 不接受 *-transition，即使 getSky 仍回傳被拒收的設定。
    // 使用內建 300ms 漸變，驗收同時觀察實際畫面與 MapLibre error。
    map.setSky(current.sky);
    map.setLight(current.light);
    if (layer) for (const [k, value] of Object.entries(current.hillshade)) map.setPaintProperty(terrainId, k, value);
    // 🔴 只在地景底圖動鋪面:壓暗地面的是 landscape-hillshade,而 positron／dark 兩個底圖沒有
    //    那層——它們的地面整夜維持原色,道路卻與地景共用同一批圖層 id（positron 25 個全中）。
    //    不綁這個條件的話,淺色底圖入夜會變成「亮底＋暗路」,比原本的問題更糟。
    if (layer) {
      // 先存原值再塗:塗過之後才存會把夜色當成白天的底色,還原時整條路網停在夜色。
      if (!pavedOriginal) pavedOriginal = PAVED_LAYERS
        .filter(([id]) => map.getLayer(id))
        .map(([id, prop]) => [id, prop, map.getPaintProperty(id, prop)])
        .filter(([, , value]) => parseColor(value));
      // 濃度沒變就不重寫:setPaintProperty 每次都會觸發重繪與 sourcedata,而地景林冠是掛在
      // sourcedata 上重掃的。白天整天 0、深夜整晚 0.72,真正要寫的只有晨昏那兩段。
      if (pavedAlpha === null || Math.abs(current.paved.alpha - pavedAlpha) > .002) {
        for (const [id, prop, value] of pavedOriginal) {
          if (map.getLayer(id)) map.setPaintProperty(id, prop, shadeColor(value, current.paved.ink, current.paved.alpha));
        }
        pavedAlpha = current.paved.alpha;
      }
    }
    key = nextKey; stats.applications++;
  }
  function restore() {
    if (!original || !engine.isStyleReady()) return;
    map.setSky(original.sky ? {...skyDefaults, ...original.sky} : undefined);
    map.setLight(original.light);
    if (terrainOriginal && map.getLayer(terrainId) === terrainOriginal.layer) {
      for (const [k, value] of Object.entries(terrainOriginal.paint)) map.setPaintProperty(terrainId, k, value);
    }
    for (const [id, prop, value] of pavedOriginal || []) {
      if (map.getLayer(id)) map.setPaintProperty(id, prop, value);
    }
    pavedAlpha = null;
  }
  function styleLoad() {
    original = { sky: map.getSky(), light: map.getLight() };
    terrainOriginal = null; pavedOriginal = null; pavedAlpha = null;
    key = ''; update(true);
  }
  function resume() { if (!document.hidden) update(true); }
  engine.onStyleLoad(styleLoad);
  const timer = setInterval(update, 1000);
  document.addEventListener('visibilitychange', resume);
  return {
    update, stats, get enabled() { return on; }, get current() { return on ? current : null; },
    // 地景在非同步建立 3D 層時才設定基礎光源；收作關閉時的退路，不能蓋掉日夜光。
    setBaseLight(light) { if (!original || !engine.isStyleReady()) return; original.light = light; if (on) update(true); else map.setLight(light); },
    setEnabled(value) { on = !!value; key = ''; if (on) update(true); else restore(); },
    destroy() { disposed = true; clearInterval(timer); document.removeEventListener('visibilitychange', resume); map.off('style.load', styleLoad); restore(); },
  };
}
