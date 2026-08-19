// 來源:臺北大眾捷運公司「臺北捷運相鄰兩站間之行駛時間及停靠站時間」(生效日 2025-06-03)。
// 已逐段核對:北捷八條線與我們現用的 TDX 站間行駛時間 127 段全部相同(差 0 秒),
// 唯一缺口是環狀線 Y——data/trtc.json 的 Y 沒有 segs,於是每段都吃 trtcCensusRun 的預設 90 秒,
// 全線比官方快 447 秒。這支只補 Y,其餘線一律不動(比對不符就中止,不覆蓋)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSV = path.join(root, 'data/official/trtc_segment_times.csv');
const TRTC = path.join(root, 'data/trtc.json');
const norm = s => String(s).replace(/^捷運/, '').replace(/站$/, '').trim();
const ROUTE = { '淡水-象山': 'R', '動物園-南港展覽館': 'BR', '南港展覽館-頂埔': 'BL',
  '南勢角-迴龍': 'O_XINZHUANG', '松山-新店': 'G', '南勢角-蘆洲': 'O_LUZHOU',
  '新北產業園區-大坪林': 'Y', '北投-新北投': 'R_XBT', '七張-小碧潭': 'G_XBT' };
// 短程路線走的是同一段實體軌道,只用來補停靠秒,不參與 segs 比對。
const DWELL_ONLY = { '北投-大安': 'R', '南港展覽館-亞東醫院': 'BL', '松山-台電大樓': 'G' };
const rows = fs.readFileSync(CSV, 'utf8').trim().split(/\r?\n/).slice(1)
  .map(l => l.split(',')).filter(c => c.length >= 7);
const j = JSON.parse(fs.readFileSync(TRTC, 'utf8'));
const lines = new Map(j.lines.map(l => [l.id, l]));
let patched = 0, checked = 0, dwellWrote = 0;
const dwellOf = new Map();
for (const [route, id] of Object.entries(ROUTE)) {
  const ln = lines.get(id);
  if (!ln) { console.error(`✗ 找不到線 ${id}`); process.exit(1); }
  const names = ln.stations.map(s => norm(s.name));
  const want = new Map();
  for (const c of rows.filter(c => c[1] === route)) {
    const ia = names.indexOf(norm(c[2])), ib = names.indexOf(norm(c[3]));
    if (ia < 0 || ib < 0) { console.error(`✗ ${id} 對不到站:${c[2]}→${c[3]}`); process.exit(1); }
    want.set(Math.min(ia, ib), { run: Number(c[4]), dwell: Number(c[6]) });
    // stoptime 是「該段起點站」的停靠秒(全線起點那筆為 0)。同一站在多條路線出現時取最大,
    // 因為短程路線的那一筆有可能沒涵蓋到該站的完整停靠。
    const d = Number(c[6]);
    if (d > 0) dwellOf.set(id + '|' + ia, Math.max(dwellOf.get(id + '|' + ia) || 0, d));
  }
  const need = ln.stations.length - 1;
  const cur = Array.isArray(ln.segs) ? ln.segs : [];
  const hasAll = cur.length === need && cur.every(s => Number(s && s.run) > 0);
  if (hasAll) { // 既有值一律當權威,只驗不改
    for (const [i, v] of want) {
      checked++;
      if (Number(cur[i].run) !== v.run) {
        console.error(`✗ ${id} 第 ${i} 段與官方不符:現用 ${cur[i].run} vs 官方 ${v.run} ⇒ 中止,不覆蓋既有資料`);
        process.exit(1);
      }
    }
    continue;
  }
  const segs = [];
  for (let i = 0; i < need; i++) {
    const v = want.get(i);
    if (!v || !(v.run > 0)) { console.error(`✗ ${id} 第 ${i} 段官方沒給行駛秒 ⇒ 中止`); process.exit(1); }
    segs.push({ run: v.run });
  }
  ln.segs = segs; patched += segs.length;
  console.log(`✔ ${id} 補上 ${segs.length} 段官方行駛秒(合計 ${segs.reduce((s, x) => s + x.run, 0)}s)`);
}
for (const [route, id] of Object.entries(DWELL_ONLY)) {
  const ln = lines.get(id); if (!ln) continue;
  const names = ln.stations.map(s => norm(s.name));
  for (const c of rows.filter(c => c[1] === route)) {
    const ia = names.indexOf(norm(c[2])), d = Number(c[6]);
    if (ia >= 0 && d > 0) dwellOf.set(id + '|' + ia, Math.max(dwellOf.get(id + '|' + ia) || 0, d));
  }
}
// 每站停靠秒寫成與 stations 等長的陣列(端點與查不到的站為 0,呼叫端自行決定 fallback)。
for (const ln of j.lines) {
  const arr = ln.stations.map((_, i) => Number(dwellOf.get(ln.id + '|' + i) || 0));
  if (!arr.some(v => v > 0)) continue;
  ln.dwellSec = arr; dwellWrote++;
}
console.log(`每站停靠秒:${dwellWrote} 條線寫入,共 ${[...dwellOf.values()].length} 站有官方值` +
  `(範圍 ${Math.min(...dwellOf.values())}~${Math.max(...dwellOf.values())} 秒)`);
if (!patched && !dwellWrote) { console.log(`沒有需要補的線(已核對 ${checked} 段,全部與官方相同)`); process.exit(0); }
j.source_notes = String(j.source_notes || '') +
  ';環狀線站間行駛時間補用臺北捷運公司「相鄰兩站間之行駛時間及停靠站時間」(生效 2025-06-03)';
fs.writeFileSync(TRTC, JSON.stringify(j));
console.log(`已寫回 ${TRTC}｜另核對既有 ${checked} 段全部與官方相同`);
