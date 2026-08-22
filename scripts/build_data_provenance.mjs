// 產生 data/data_provenance.json:每個「開機會載入的資料檔」的來源、生效日、座標基準與雜湊。
//
// 為什麼要這個:這個 repo 已經被「以為知道資料哪來的」咬過——`data/tdx/` 底下的檔不保證來自
// TDX(三鶯線的幾何其實是 OSM),離線海陸輪廓換成內政部界線前那份與圖磚差 1–3 公里。來源與座標
// 基準是判斷「這份資料能不能拿來對齊/校正」的前提,不能只活在人的記憶裡。
//
// 🔴 刻意【不】掛進 data/data_manifest.json:那份是 App 每次開機都會抓的熱路徑檔,而且
// initDataFreshness() 是拿 `local[k] !== remote[k]` 直接比字串來決定哪些檔要回網站重抓
// (index.html:23056)。把值換成物件的話兩邊永遠不相等 ⇒ 每次開機都把全部資料檔重抓一遍,
// 而且完全無聲。所以本清單另開一檔,且刻意不被 index.html 載入(不進 manifest、不佔開機流量)。
//
// 設計原則:能從資料檔自己身上讀到的,一律讀出來當【逐字前綴】,不另寫一份轉述——轉述會漂移成
// 一個讀起來很合理的謊。只有檔內真的沒有內嵌來源的才寫在 HAND 表,而且每一條都在寫的當下驗過。
//
// 用法:node scripts/build_data_provenance.mjs   閘門:node scripts/verify_data_provenance.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from './build_data_manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'data/data_provenance.json';
const MAXDESC = 160;

// 每個資料檔的【幾何來源】。null = 本檔不含座標,座標基準因此也是 null。
// 這一格刻意手寫而非自動偵測:座標藏在 [[lat,lon],…] 這種裸數字陣列裡時偵測不到
// (tra_platforms.json 就是),漏判會讓「無座標」變成一句沒有人查過的話。
// 閘門要求 manifest 裡的每一個檔都在這張表裡 ⇒ 日後新增資料檔時一定得做這個判斷,不能靜默略過。
export const GEOMETRY_SOURCE = {
  'data/afr.json': 'TDX+OSM',                  // TDX v3 Rail/AFR/Shape + data/afr_osm_gap_fills.json 補缺口
  'data/afr_schedule_dense.json': 'TDX+OSM',   // 通過站沿 afr.json 線形內插
  'data/bounty_rules.json': null,
  'data/crossings.json': 'TRA-ODS',
  'data/krtc.json': 'TDX',
  'data/krtc_times.json': null,
  'data/ntalrt.json': 'TDX',
  'data/ntalrt_times.json': null,
  'data/ntdlrt.json': 'TDX',
  'data/ntdlrt_times.json': null,
  'data/rail_crossing_levels.json': 'OSM',
  'data/sanying.json': 'OSM',                  // TDX 尚未收錄三鶯線,幾何與站座標取自 OSM
  'data/sanying_times.json': null,
  'data/station_transfers.json': null,         // 輸出只有站名/距離,不含座標(距離由 data/tdx/*_Station.json 算)
  'data/taiwan_land.json': 'MOI',
  'data/thsr_schedule_dense.json': 'TDX',
  'data/thsr_track.json': 'TDX',
  'data/tmrt.json': 'TDX',
  'data/tmrt_times.json': null,
  'data/tra.json': 'TDX+OSM',                  // 主線形 OSM Overpass;山線三義–后里等區段以 TDX Shape 替換
  'data/tra_pass_obs.json': null,
  'data/tra_platforms.json': 'OSM',
  'data/tra_schedule_dense.json': 'TDX+OSM',   // 通過站沿 tra.json 線形內插
  'data/tra_special_trains.json': null,
  'data/tra_station_class.json': null,
  'data/tra_station_info.json': 'TDX',
  'data/trtc.json': 'TDX+OSM',                 // 環狀線 Y 自 mrt.json 搬入(OSM 幾何)
  'data/trtc_codes.json': null,
  'data/trtc_times.json': null,
  'data/tymc.json': 'TDX',
  'data/tymc_times.json': null,
};

// 座標基準:記【上游怎麼宣告的】,不是我推測它應該是什麼。上游沒宣告就寫「未載明」。
export const BASIS = {
  'OSM': 'WGS84(OpenStreetMap 定義即 WGS84)',
  'TDX': '未載明(TDX 回傳 PositionLat/PositionLon,payload 無 CRS 欄位)',
  'TDX+OSM': 'WGS84(OSM 段);TDX 段未載明(payload 無 CRS 欄位)——兩者實測同框,build_tdx.mjs 對 K03 的座標修正即以 OSM 座標落在 TDX 軌道幾何上離軌 0m 為據',
  'MOI': 'TWD97 經緯度(內政部資料集名稱即載明)',
  'TRA-ODS': 'WGS84(台鐵平交道公開資料的 POS 欄位標示 WGS84,見 scripts/build_crossings.mjs:6)',
};

// 少數檔把來源寫在別的欄位名底下。指定欄位名而不是把內容抄進 HAND,前綴逐字關係才守得住。
export const SOURCE_FIELD = {
  'data/tra_special_trains.json': 'note',
};

// 檔內沒有任何可用來源欄位的,來源寫在這裡。每一條都在 2026-08-21 當下實查過,證據寫在括號裡。
export const HAND = {
  // 檔內的 note 講的是「這份規則怎麼被兩端共讀」,不是來源;照抄會讓人以為它有上游。
  'data/bounty_rules.json':
    '本站自訂的懸賞門檻與文案定義,無外部資料源;客端即時提示與伺服器端隔日驗證共讀同一份(見檔內 note)',
  'data/station_transfers.json':
    '由 data/tdx/*_Station.json 與 *_StationOfLine.json 逐系統彙整(檔內 sourceSystems 列出 12 個系統的實際輸入檔);轉乘判定為站名正規化後 haversine < 450 公尺(檔內 criteria)',
  'data/tra_station_class.json':
    '維基百科「臺灣鐵路車站列表」表格(scripts/fetch_station_class.mjs;台鐵官方 OpenData 車站基本資料集無站等欄位)',
  'data/tra_station_info.json':
    '交通部 TDX v3 Rail/TRA/Station——站名、地址與座標(scripts/fetch_tra_station_info.mjs)',
  'data/trtc_codes.json':
    '交通部 TDX Rail/Metro/TRTC/Station 的站碼與站名(實查 data/tdx/TRTC_Station.json,121/121 逐筆一致);所屬路線取自同批 TRTC_StationOfLine',
};

// 取原文開頭、在 MAXDESC 內的【最後一個句號處】收尾;沒有句號就直接截 MAXDESC。
// 恆為原文(空白正規化後)的逐字前綴——閘門據此擋住「轉述成一句好聽的話」。
// 刻意不是「第一個句號」:很多檔的第一句只是檔名式的自我介紹(「台鐵特別列車故事檔案」),
// 真正的來源在第二句(「事實查證日期…」),切在第一句等於把來源丟掉。
const cut = s => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  if (t.length <= MAXDESC) return t;
  const head = t.slice(0, MAXDESC);
  const m = Math.max(head.lastIndexOf('。'), head.lastIndexOf(';'), head.lastIndexOf(';'));
  return m >= 24 ? head.slice(0, m + 1) : head;
};

// 從資料檔身上把來源與生效日讀出來。回 { text, field, date, dateField }。
export function extract(rel, j) {
  const P = j && typeof j === 'object' ? j.properties : null;
  let text = null, field = null;
  const ov = SOURCE_FIELD[rel];
  if (ov && typeof j?.[ov] === 'string') { text = j[ov]; field = ov; }
  else if (typeof j?.source_notes === 'string') { text = j.source_notes; field = 'source_notes'; }
  else if (typeof j?.source === 'string') { text = j.source; field = 'source'; }
  else if (typeof P?.source === 'string') { text = P.source; field = 'properties.source'; }

  let date = null, dateField = null;
  const pick = (v, f) => { if (date == null && typeof v === 'string' && v) { date = v; dateField = f; } };
  if (Array.isArray(j?.dateRange) && j.dateRange.length === 2) { date = j.dateRange.join('…'); dateField = 'dateRange'; }
  pick(j?.date, 'date');
  pick(j?.fetchedAt, 'fetchedAt');
  pick(j?.built_at, 'built_at');
  pick(j?.generated, 'generated');
  pick(P?.version, 'properties.version');
  return { text, field, date, dateField };
}

export function buildProvenance(root = ROOT) {
  const manifest = buildManifest(root);
  const files = {};
  for (const rel of Object.keys(manifest).sort()) {
    const raw = readFileSync(path.join(root, rel));
    let j = null;
    try { j = JSON.parse(raw.toString('utf8')); } catch (e) { /* 非 JSON:只留雜湊 */ }
    const e = extract(rel, j);
    const hand = HAND[rel];
    if (!e.text && !hand) throw new Error(`${rel}: 檔內沒有內嵌來源欄位,也不在 HAND 表裡——請查明來源再加進 HAND`);
    const gs = rel in GEOMETRY_SOURCE ? GEOMETRY_SOURCE[rel] : undefined;
    if (gs === undefined) throw new Error(`${rel}: 不在 GEOMETRY_SOURCE 表裡——請判斷它含不含座標、幾何來自哪裡`);
    files[rel] = {
      sourceDescription: e.text ? cut(e.text) : hand,
      sourceField: e.field,                       // null=檔內無內嵌來源,描述取自 HAND 表
      effectiveDate: e.date,
      effectiveDateField: e.dateField,
      geometrySource: gs,
      coordinateBasis: gs ? BASIS[gs] : null,
      checksum: createHash('md5').update(raw).digest('hex'),
    };
  }
  return {
    _readme: '每個開機會載入的資料檔的來源/生效日/座標基準/雜湊。重建:node scripts/build_data_provenance.mjs;'
      + '閘門:node scripts/verify_data_provenance.mjs。sourceDescription 恆為 sourceField 指到的那段原文的逐字前綴'
      + '(完整敘述請看資料檔本身);sourceField=null 表示該檔內無來源欄位,描述來自 build 腳本的 HAND 表。'
      + '刻意不放進 data_manifest.json:那份是 App 開機熱路徑,值必須維持字串才比得動(見 build 腳本開頭)。',
    files,
  };
}

// 🔴 判「是不是被直接執行」不可用 `import.meta.url === \`file://${process.argv[1]}\``:本 repo 路徑含中文,
// import.meta.url 會百分比編碼而 argv[1] 不會(比照 build_data_manifest.mjs)。
if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) {
  const p = buildProvenance();
  writeFileSync(path.join(ROOT, OUT), JSON.stringify(p, null, 1) + '\n');
  const geo = Object.values(p.files).filter(f => f.geometrySource).length;
  const dated = Object.values(p.files).filter(f => f.effectiveDate).length;
  console.log(`data_provenance: ${Object.keys(p.files).length} 個資料檔(含座標 ${geo}、有生效日 ${dated}) → ${OUT}`);
}
