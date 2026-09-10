#!/usr/bin/env node
// 「跨兩個以上有班表系統」的轉乘站 → 對向發車表。
// 來源：data/station_transfers.json（轉乘群）＋ 台鐵/高鐵/林鐵的 *_schedule_dense.json
//       ＋ 機捷/高捷的 *_times.json（TDX StationTimeTable 逐班發車時刻）。
// 只出當日：轉乘是當下的事；14 天全出是 198 KB gzip 而沒有人會查三天後的接續。
// 用法：node scripts/build_transfer_departures.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = f => path.join(ROOT, 'data', f);
const J = f => JSON.parse(readFileSync(D(f), 'utf8'));

// 「有逐班車次班表」的長途系統：一班車自己帶車次與逐站到離。
const SCHED_SYS = { TRA: 'tra_schedule_dense.json', THSR: 'thsr_schedule_dense.json',
                    AFR: 'afr_schedule_dense.json' };

// ── 捷運：納入判準是「官方逐班時刻表」，不是「是不是捷運」 ──────────────────────
// ✅ 機捷 TYMC、高捷 KRTC —— TDX StationTimeTable 的逐班發車時刻（*_times.json），
//    一班 = [站idx,發車秒, 站idx,發車秒, ...]，站 idx 指向線檔 geo 的站序。
// ❌ 北捷 TRTC —— 位置與到站走官方逐站倒數（TRTC API），倒數只涵蓋未來幾分鐘；
//    你 40 分鐘後才到那站，那時的倒數現在還不存在，做不出「我到站時還有哪幾班」。
// ❌ 台中捷運 tmrt、三鶯線 sanying —— *_times.json 自帶 estimated:true（官方班距合成，
//    非公告時刻）。下面的 estimated 閘門會擋，不必靠人記得。
// ❌ 高雄輕軌 KLRT（krtc_times 的 C 線）—— 資料是真的，但它是環線：終點欄會寫出
//    「往 籬仔內」這種不是端點的站名，而 App 對環線的既有寫法是「環狀線循環」
//    （index.html 的 updateFreqCard）。要先把環線的目的地寫法談定才納入。
const METRO_SYS = {
  TYMC: { times: 'tymc_times.json', geo: 'tymc.json', lines: ['A'] },
  KRTC: { times: 'krtc_times.json', geo: 'krtc.json', lines: ['KR', 'KO'] },
};
// 機捷車種：TDX TrainType 原值（1=普通車 2=直達車）→ 前端 TYMC_KIND_NAME 用的同一組字串，
// 讓畫面直接把它丟進 t() 吃既有翻譯鍵。'0'＝官方沒標 ⇒ 留白，不由停靠樣態回推
// （官方另有跳站的普通車，猜錯比不標更糟）。守門人 G6 會比對這兩份字串一致。
const METRO_KIND = { TYMC: { 1: '普通車', 2: '直達車' } };

const ALL_SYS = [...Object.keys(SCHED_SYS), ...Object.keys(METRO_SYS)];
const tf = J('station_transfers.json');

// 產出日：以台鐵當日鍵為準（守門人 G1 比對它）。捷運選平日/假日班表也吃這一天，
// 整份檔案必須是同一個營運日，不能一半今天一半昨天。
const DATE = J(SCHED_SYS.TRA).date;
// 國定假日/補班表：與 index.html 的 TW_DAYTYPE 同一份來源（已逐鍵比對相同），
// 捷運的平日/假日選法必須跟前端 prepFreqTimes 一致，否則畫面與接續表會挑到不同班表。
const DAYTYPE = J('tw_daytype.json');

// 1) 挑出「跨兩個以上有班表系統」的轉乘群。這個條件本身就是範圍定義，
//    不要改成寫死幾個站名——來源資料若新增共構站，或上面的系統表加一個系統，這裡要自動跟上。
const groups = [];
for (const key of Object.keys(tf.transferStations)) {
  const g = tf.transferStations[key];
  const bySys = {};
  for (const m of g.members) {
    const [sys, id] = m.split(':');
    if (!ALL_SYS.includes(sys)) continue;
    (bySys[sys] ||= []).push(id);
  }
  if (Object.keys(bySys).length >= 2) groups.push({ raw: g, bySys });
}

// 2) 站碼 → 班表用的站名。轉乘表用 StationID，班表用站名，要對起來。
//    tf.stations 以 "SYS:ID" 為鍵，帶 name。捷運線檔的站名與這裡同源（都是 TDX StationName），
//    所以捷運那半也用同一個字串比對，不必再維護第二份對照表。
const nameOf = (sys, id) => {
  const st = tf.stations[`${sys}:${id}`];
  return st && (st.name || st.normalizedName);
};

const out = { schemaVersion: 1, date: DATE, groups: [] };
// 依系統分開的站名清單——不能用單一共用 Set。
// 實例：左營群的 THSR 側站名是「左營」，TRA 側是「新左營」；但台鐵縱貫線上
// 另有一個真實存在、與高鐵無關的「左營」站（同名異地，非 902/972 的解析誤差，
// 是官方時刻表本來就有的站名）。若三系統共用一個 wantNames，THSR 需要的「左營」
// 會連帶命中台鐵那個不相干的站，讓台鐵輸出裡混進上百筆與轉乘無關的停靠
// （實測：740 筆台鐵車次中有 94 筆因此夾帶假的「左營」停靠）。逐系統分開查詢
// 才對：一個系統的站名，只能匹配「該系統」的班表。高捷 R16「左營」與台鐵 4340
// 「新左營」同群不同名，正是同一個坑的第二個實例。
const wantNamesBySys = Object.fromEntries(ALL_SYS.map(s => [s, new Set()]));
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

// 3) 逐系統抽停靠。只留轉乘站，欄位只留畫面用得到的。
for (const [sys, file] of Object.entries(SCHED_SYS)) {
  const d = J(file);

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

// 4) 捷運。選「今天跑哪一份班表」的規則必須與前端 prepFreqTimes 逐條相同：
//    國定假日/補假(daytype 1) → holiday；補行上班(2) → days[1]；其餘看台北營運日的週幾；
//    臨時營運調整(special_ops 寫進 times.dates) 最優先。任何一條走岔，畫面上跑的車與
//    這張接續表就是兩份不同的班表。
function serviceSetName(t) {
  const dt = DAYTYPE[DATE];
  let day;
  if (dt === 1) day = t.holiday || (t.days && t.days[0]);
  else if (dt === 2) day = t.days && t.days[1];
  else day = t.days ? t.days[new Date(`${DATE}T00:00:00Z`).getUTCDay()] : null;
  if (t.dates && t.dates[DATE] && t.sets && t.sets[t.dates[DATE]]) day = t.dates[DATE];
  return day;
}
for (const [sys, cfg] of Object.entries(METRO_SYS)) {
  const T = J(cfg.times), G = J(cfg.geo);
  // 閘門：班距合成的班表不准進來。這件事只有這個旗標照得到——合成班表的形狀與真班表
  // 一模一樣，錯誤地加進 METRO_SYS 不會有任何症狀，只會讓畫面上的「16:42」是我們自己編的。
  if (T.estimated) throw new Error(`${cfg.times} 是 estimated（班距合成）班表，不得作為接續來源`);
  const wantNames = wantNamesBySys[sys];
  const kindMap = METRO_KIND[sys] || null;
  const rows = [];
  for (const lid of cfg.lines) {
    const lt = T.lines[lid], lg = (G.lines || []).find(l => l.id === lid);
    if (!lt) throw new Error(`${cfg.times} 沒有 ${lid} 線`);
    if (!lg) throw new Error(`${cfg.geo} 沒有 ${lid} 線（站 idx 無從對回站名）`);
    const day = serviceSetName(lt);
    const set = (lt.sets && lt.sets[day]) || [];
    if (!set.length) throw new Error(`${sys}/${lid} 在 ${DATE}（班表 ${day}）沒有任何班次`);
    // 車種字串與同名 set 等長同序、一班一字元。長度對不上就整條線不採用車種——
    // 寧可留白也不標錯（與前端 prepFreqTimes 同一個約定）。
    const kd = lt.kinds && lt.kinds[day];
    const kinds = kd && kd.length === set.length ? kd : null;
    const stn = lg.stations.map(s => s.name);
    set.forEach((tr, i) => {
      const h = [];
      for (let p = 0; p < tr.length; p += 2) {
        const name = stn[tr[p]];
        if (!wantNames.has(name)) continue;
        h.push([name, tr[p + 1], p + 2 >= tr.length ? 1 : 0]);
      }
      // n 留空：捷運沒有對外公告的車次，硬塞線代號或我們自己合成的內部編號都是假車次
      // （使用者裁示：官方沒有就整欄消失）。畫面靠 ty＋終點站辨識這一班。
      if (h.length) rows.push({ n: '', ty: (kinds && kindMap && kindMap[kinds[i]]) || '',
                                de: stn[tr[tr.length - 2]], h });
    });
  }
  out[sys.toLowerCase()] = rows;
}

writeFileSync(D('transfer_departures.json'), JSON.stringify(out));
const kb = n => (JSON.stringify(n).length / 1024).toFixed(1);
console.log(`transfer_departures.json  date=${out.date}  群 ${out.groups.length}`);
for (const s of ALL_SYS.map(x => x.toLowerCase())) console.log(`  ${s}: ${out[s].length} 班  ${kb(out[s])} KB`);
