// 產生 data/trip_impact_lines.json：AI 串聯行程 P4「出狀況判斷」用的精簡站序與車種表。
// 比對（scripts/trip_impact.mjs，Worker 用）與原生 railcore（TripImpact.kt）讀同一份內容：
// native 那邊由 native/scripts/sync-trip-impact.mjs 把這個檔原樣嵌進 railcore，不要兩邊手抄。
//
// 來源：台鐵＝data/tra_station_of_line.json（TDX StationOfLine）；高鐵＝12 站固定順序（同 rail_ai_status.mjs 的清單）。
// 用法：node scripts/build_trip_impact_lines.mjs（重跑結果相同；來源改了就重跑並一起 commit，再到 native 跑同步腳本）。
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'data/trip_impact_lines.json';

const THSR_STATIONS = ['南港', '台北', '板橋', '桃園', '新竹', '苗栗', '台中', '彰化', '雲林', '嘉義', '台南', '左營'];

// 車種歸類：車種原文含左欄任一字串就歸那一類（先比對號）；都不含＝認不得（比對時落「可能受影響」）。
// 原生 App 的車種是 TripPlanBook.traKind（自強、莒光、復興、區間車、區間快、普快車，其他照班表 typeName／carName）。
const TRAIN_CLASS = {
  '對號': ['自強', '莒光', '復興', '普悠瑪', '太魯閣', 'EMU3000', '觀光', '環島之星', '鳴日'],
  '非對號': ['區間', '普快', '普通'],
};

// 繞行線：兩端都在受影響範圍內時整條算在範圍內（海線竹南=彰化、成追線成功=追分；契約第 2 節第 5 條）。
const BYPASS = { tra: ['WL-C', 'CZ'] };

export function buildTripImpactLines(root = ROOT) {
  const src = JSON.parse(readFileSync(path.join(root, 'data/tra_station_of_line.json'), 'utf8'));
  const tra = {};
  for (const l of src.lines) {
    // 「臺北-環島」這類同里程的虛擬站（環島列車用）不是真的站，拿掉
    tra[l.lineId] = l.stations.filter(s => !s.name.includes('-')).map(s => [s.name, s.cumKm]);
  }
  return {
    note: '由 scripts/build_trip_impact_lines.mjs 產生，不要手改。lines.<系統 id>.<路線代號>＝依序 [站名, 累計公里]（高鐵的公里是站序，只用來排順序）。站名比對時「台」一律換成「臺」。',
    source: { tra: `data/tra_station_of_line.json（${src.source}，${src.fetched_at}）`, thsr: '高鐵 12 站，由北到南' },
    lines: { tra, thsr: { THSR: THSR_STATIONS.map((n, i) => [n, i]) } },
    bypass: BYPASS,
    trainClass: TRAIN_CLASS,
  };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) {
  const out = buildTripImpactLines();
  // 每站一行太長：[站名, 公里] 收成一行
  const text = JSON.stringify(out, null, 1).replace(/\[\n\s+("[^"\n]*"),\n\s+(-?[\d.]+)\n\s+\]/g, '[$1, $2]') + '\n';
  writeFileSync(path.join(ROOT, OUT), text);
  const n = Object.values(out.lines).reduce((a, sys) => a + Object.values(sys).reduce((b, l) => b + l.length, 0), 0);
  console.log(`trip_impact_lines: ${Object.keys(out.lines.tra).length} 條台鐵路線＋高鐵，${n} 站次，${Buffer.byteLength(text)} bytes → ${OUT}`);
}
