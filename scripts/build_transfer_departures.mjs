#!/usr/bin/env node
// 9 個「跨兩個以上有班表系統」的轉乘站 → 對向發車表。
// 來源：data/station_transfers.json（轉乘群）＋ 三份 *_schedule_dense.json（時刻）。
// 只出當日：轉乘是當下的事；14 天全出是 198 KB gzip 而沒有人會查三天後的接續。
// 用法：node scripts/build_transfer_departures.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = f => path.join(ROOT, 'data', f);

// 有班表的系統。捷運不在此列——它沒有真班表，見規格 §2。
const SCHED_SYS = { TRA: 'tra_schedule_dense.json', THSR: 'thsr_schedule_dense.json',
                    AFR: 'afr_schedule_dense.json' };

const tf = JSON.parse(readFileSync(D('station_transfers.json'), 'utf8'));

// 1) 挑出「跨兩個以上有班表系統」的轉乘群。這個條件本身就是範圍定義，
//    不要改成寫死 9 個站名——來源資料若新增共構站，這裡要自動跟上。
const groups = [];
for (const key of Object.keys(tf.transferStations)) {
  const g = tf.transferStations[key];
  const bySys = {};
  for (const m of g.members) {
    const [sys, id] = m.split(':');
    if (!SCHED_SYS[sys]) continue;
    (bySys[sys] ||= []).push(id);
  }
  if (Object.keys(bySys).length >= 2) groups.push({ raw: g, bySys });
}

// 2) 站碼 → 班表用的站名。轉乘表用 StationID，班表用站名，要對起來。
//    tf.stations 以 "SYS:ID" 為鍵，帶 name。
const nameOf = (sys, id) => {
  const st = tf.stations[`${sys}:${id}`];
  return st && (st.name || st.normalizedName);
};

const out = { schemaVersion: 1, date: null, groups: [] };
// 依系統分開的站名清單——不能用單一共用 Set。
// 實例：左營群的 THSR 側站名是「左營」，TRA 側是「新左營」；但台鐵縱貫線上
// 另有一個真實存在、與高鐵無關的「左營」站（同名異地，非 902/972 的解析誤差，
// 是官方時刻表本來就有的站名）。若三系統共用一個 wantNames，THSR 需要的「左營」
// 會連帶命中台鐵那個不相干的站，讓台鐵輸出裡混進上百筆與轉乘無關的停靠
// （實測：740 筆台鐵車次中有 94 筆因此夾帶假的「左營」停靠）。逐系統分開查詢
// 才對：一個系統的站名，只能匹配「該系統」的班表。
const wantNamesBySys = { TRA: new Set(), THSR: new Set(), AFR: new Set() };
for (const { raw, bySys } of groups) {
  const members = {};
  for (const [sys, ids] of Object.entries(bySys)) {
    const names = ids.map(id => nameOf(sys, id)).filter(Boolean);
    if (!names.length) throw new Error(`轉乘群 ${raw.id} 的 ${sys} 站碼查不到站名：${ids}`);
    members[sys] = names;
    names.forEach(n => wantNamesBySys[sys].add(n));
  }
  out.groups.push({ id: raw.id, name: raw.normalizedName, members });
}

// 3) 逐系統抽停靠。只留 9 站，欄位只留畫面用得到的。
for (const [sys, file] of Object.entries(SCHED_SYS)) {
  const d = JSON.parse(readFileSync(D(file), 'utf8'));
  if (sys === 'TRA') out.date = d.date;      // 以台鐵當日鍵為準（守門人 G1 比對它）

  // 台鐵是「14 天跨日去重聯集」：d.trains 990 筆含其他 13 天才用得到、
  // 今天用不到的臨時改點變體（同車次可能出現兩筆不同時刻，例如本檔的車次
  // 2561：idx15 用於多數日、idx972 只用於 09-10）。d.dates[d.date] 是產生腳本
  // （fetch_tra_schedule.py）自己給的「今天實際發車的那份索引」，逐車次唯一、
  // 無重覆——直接對應本檔開頭「只出當日」的註解。THSR／AFR 沒有這層多日聯集
  // （各自的 trains 就是單日班表），不需要這步。
  const trains = sys === 'TRA' && Array.isArray(d.dates?.[d.date])
    ? d.dates[d.date].map(i => d.trains[i])
    : d.trains;

  const wantNames = wantNamesBySys[sys];
  const rows = [];
  for (const t of trains) {
    const st = t.stops, h = [];
    for (let i = 0; i < st.length; i++) {
      const s = st[i];
      if (!wantNames.has(s.name) || s.stop === false) continue;
      const isLast = i === st.length - 1;
      h.push([s.name, isLast ? s.arrSec : s.depSec, isLast ? 1 : 0]);
    }
    if (h.length) rows.push({ n: t.train, ty: t.typeName, de: st[st.length - 1].name, h });
  }
  out[sys.toLowerCase()] = rows;
}

writeFileSync(D('transfer_departures.json'), JSON.stringify(out));
const kb = n => (JSON.stringify(n).length / 1024).toFixed(1);
console.log(`transfer_departures.json  date=${out.date}  群 ${out.groups.length}`);
for (const s of ['tra', 'thsr', 'afr']) console.log(`  ${s}: ${out[s].length} 班  ${kb(out[s])} KB`);
