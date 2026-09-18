#!/usr/bin/env node
// 站別記錄缺口修補:把 TDX 逐站時刻表「某幾站整段時間沒有記錄」造成的假折返班次補回真端點。
//
// 為什麼需要:build_metro_times.mjs 的 chainRoute 是沿站序串發車時刻。某站在某段時間整段
// 沒有記錄時,鏈只能串到缺口邊界站就收尾,產物看起來完全合法——一班有始有終、時刻遞增的
// 短程車。結構閘門(verify_metro_times.mjs)因此驗不出來,前端非即時模式照著班表畫,
// 使用者看到的就是「整個晚上每一班車都開到某站就不見了」。
//   實例:環狀線 Y 平日,大坪林～景安(站序 0–4)在 19:23–23:03 之間一筆記錄都沒有,
//   於是 19:52–22:56 從新北產業園區發的 19 班全部在中和收尾,反向同樣 19 班從中和才起跑。
//
// 判準刻意保守,只補「被兩側正常班次夾住的缺口」:
//   1. 補進去的每一個停靠,在該站該方向都要有記錄在它之前、也有記錄在它之後(缺口是內夾的);
//   2. 前後那兩筆記錄的間距要 >= HOLE_MIN_SEC,小洞是班距不是缺資料;
//   3. 補進去的時刻不得貼著既有(或本輪剛補的)班次,至少隔 MIN_SEP_SEC;
//   4. 同一個缺口、同一個邊界站要有 >= MIN_GROUP_TRIPS 班同時被截斷才算數。
//   任一站不過關就整班不補。末班車真的在中途折返(其後該段再無任何班次)因此不會被動到——
//   那種收班折返沒有「之後的記錄」,條件 1 就擋下來了;真正的營運型態(機捷環北折返、
//   首班車碎片)是零星幾班,條件 4 擋下來——記錄缺一段會把當時經過的**每一班**都截斷,
//   只截斷一兩班的不是缺資料。
// 站間時間用同一 set 同方向「跑完整段的班次」實測相鄰站時距中位數,不用線檔 segs 估——
// 補出來的班要跟當天其他班同一個節奏,才不會在畫面上看出接縫。
//
// 🔸 這一層只接「已經存在但被截斷的班次」,不生新班次。
//   2026-09-18 曾以為環狀線 Y 平日末班少了整班車(大坪林發平日 23:03 對假日 23:57)。重抓 TDX
//   並對過新北捷運官方各站時刻表後查明:平日 23:04–24:00 的班 TDX 與官方都有,是平日中和 Y12
//   的記錄整份抄成景安 Y11,鏈在兩站之間斷掉,末班那幾班被切碎或整班剔除。修法在
//   build_metro_times.mjs(排除中和、按行駛時間內插,與官方中和站 PDF 逐分吻合),不在這一層。
//   假日往大坪林 00:10/00:23/00:34 那三班是另一回事:官方 PDF 末班 00:00,官方 .odt(TDX 照抄)
//   末班 00:34,兩份官方來源打架,待使用者裁示——不要自己挑一份。
//
// 用法:
//   build_metro_times.mjs 於寫檔前呼叫 applyGapFill(out, lineFile);重建幾次都在。
//   node scripts/metro_times_gapfill.mjs            # 對現有 data/*_times.json 就地重跑(冪等)
//   node scripts/metro_times_gapfill.mjs --dry-run  # 只印會補什麼,不寫檔
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOLE_MIN_SEC = 30 * 60; // 內夾缺口的最小長度:短於此視為正常班距,不動
const MIN_SEP_SEC = 90;       // 補進去的停靠與既有班次的最小間隔
const MIN_GROUP_TRIPS = 3;    // 同一缺口同一邊界站至少要這麼多班被截斷才認定是缺資料

// 沒有中途折返營運型態的線:每一班都從端點跑到端點。這種線連「收班前最後幾班」被截斷
// 都可以判定成缺記錄,不必等缺口被兩側夾住——因為這條線根本不存在中途折返這回事。
// 這是營運事實,只能由知道的人裁示,不能從資料自己推(資料缺一段,看起來就像折返)。
//   Y 環狀線:使用者 2026-09-18 在專案裡明確說「車子應該都是有到終點」。
const NO_SHORT_TURN = new Set(['Y']);

const idxsOf = tr => { const o = []; for (let i = 0; i < tr.length; i += 2) o.push(tr[i]); return o; };
// 行進方向:站序逐步變化的正負號總和(與 verify_metro_times.mjs 的 dirOf 同一套)
const dirOf = tr => {
  const idx = idxsOf(tr);
  let s = 0;
  for (let i = 1; i < idx.length; i++) s += Math.sign(idx[i] - idx[i - 1]);
  return s >= 0 ? 'asc' : 'desc';
};
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// 相鄰站實測時距中位數:key = `${dir}|${from}|${to}`,只收「這一班真的相鄰經過」的配對
function adjacentOffsets(trains) {
  const acc = new Map();
  for (const tr of trains) {
    const dir = dirOf(tr);
    for (let i = 2; i < tr.length; i += 2) {
      const a = tr[i - 2], b = tr[i];
      if (Math.abs(b - a) !== 1) continue;
      const k = `${dir}|${a}|${b}`;
      if (!acc.has(k)) acc.set(k, []);
      acc.get(k).push(tr[i + 1] - tr[i - 1]);
    }
  }
  const out = new Map();
  for (const [k, v] of acc) out.set(k, median(v));
  return out;
}

// 每站每方向的既有停靠時刻(已排序)
function stopIndex(trains) {
  const m = new Map();
  for (const tr of trains) {
    const dir = dirOf(tr);
    for (let i = 0; i < tr.length; i += 2) {
      const k = `${dir}|${tr[i]}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(tr[i + 1]);
    }
  }
  for (const v of m.values()) v.sort((a, b) => a - b);
  return m;
}

// 一個擬補停靠落在哪個「被兩側正常班次夾住、且夠大」的缺口裡;不合格回 null。
// 回傳缺口本身(前後兩筆記錄)是為了分群:同一個缺口的截斷班次要一起看。
function boundedHole(times, t) {
  if (!times || times.length < 2) return null;
  let before = null, after = null;
  for (const x of times) { if (x < t) before = x; else if (after == null) after = x; }
  if (before == null || after == null) return null;           // 沒被夾住:收班折返、首班車碎片
  if (after - before < HOLE_MIN_SEC) return null;             // 是班距不是缺口
  if (t - before < MIN_SEP_SEC || after - t < MIN_SEP_SEC) return null;
  return { before, after };
}

// 沒被夠大的缺口夾住的擬補停靠(收班之後那一段,或兩班之間只是正常班距的小空檔):
// 只要跟該站該方向既有停靠都隔 MIN_SEP_SEC 以上就放得進去。判不出「這是折返還是缺記錄」,
// 所以只有宣告過沒有中途折返的線才准用(見 NO_SHORT_TURN)。
//   實例:環狀線平日 22:48 大坪林發那班,新埔民生以後的四筆時刻被一條髒碎片搶走後整條剔除,
//   車停在板橋;新埔民生前後兩班只隔 20 分,不夠算缺口,但 23:13 前後各 10 分都沒有車。
function clearOfStops(times, t) {
  if (!times || times.length < 2) return false;
  return times.every(x => Math.abs(x - t) >= MIN_SEP_SEC);
}

// 從 fromIdx 往 toIdx 逐站推出擬補停靠;缺任何一段中位數就放棄整段
function projectStops(offs, dir, fromIdx, fromSec, toIdx) {
  const step = toIdx > fromIdx ? 1 : -1;
  const out = [];
  let cur = fromIdx, t = fromSec;
  while (cur !== toIdx) {
    const nxt = cur + step;
    const d = offs.get(`${dir}|${cur}|${nxt}`);
    if (!(d > 0)) return null;
    t += d;
    out.push([nxt, Math.round(t)]);
    cur = nxt;
  }
  return out;
}

export function applyGapFill(out, lineFile, log = console.log) {
  for (const [lid, L] of Object.entries(out.lines || {})) {
    const line = (lineFile.lines || []).find(l => l.id === lid);
    if (!line || line.loop) continue;              // 環線的「端點」語意不同,不在這一層處理
    const n = line.stations.length;
    if (n < 3) continue;                           // 兩站支線沒有中途可缺
    for (const [setName, trains] of Object.entries(L.sets || {})) {
      if (!Array.isArray(trains) || !trains.length) continue;
      const offs = adjacentOffsets(trains);
      const stops = stopIndex(trains);             // 補之前的快照:同一輪的補值不互相遮蔽缺口
      // ── 第一輪:逐班算出擬補停靠,按「哪個缺口、哪個邊界站」分群 ──
      const groups = new Map();
      const noShortTurn = NO_SHORT_TURN.has(lid);
      const propose = (tr, dir, end, boundary, proj) => {
        if (!proj || !proj.length) return;
        let key = null, forced = false;
        for (const [i, t] of proj) {
          const hole = boundedHole(stops.get(`${dir}|${i}`), t);
          if (hole) { if (key == null) key = `${dir}|${end}|${boundary}|${hole.before}|${hole.after}`; continue; }
          // 沒被夠大的缺口夾住:只有宣告無中途折返的線、往終點延伸的尾端,且跟既有停靠不貼著,
          // 才當成缺記錄。頭端不放寬——首班車本來就從中途各站同時發車(環狀線 06:00),往回推會
          // 憑空生出 06:00 以前從端點發的車。
          if (!(noShortTurn && end === 'tail' && clearOfStops(stops.get(`${dir}|${i}`), t))) return;
          forced = true;
        }
        key = forced ? `${dir}|${end}|${boundary}|收班` : key;
        if (key == null) return;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ tr, dir, end, proj, forced });
      };
      for (const tr of trains) {
        const dir = dirOf(tr);
        const term = dir === 'asc' ? n - 1 : 0;    // 行進方向的終點
        const orig = dir === 'asc' ? 0 : n - 1;    // 行進方向的起點
        // 尾端:末站不是終點 → 往終點補
        const lastIdx = tr[tr.length - 2], lastSec = tr[tr.length - 1];
        if (lastIdx !== term) propose(tr, dir, 'tail', lastIdx, projectStops(offs, dir, lastIdx, lastSec, term));
        // 頭端:首站不是起點 → 往起點回推(時間往前走,所以逐站相減)
        const firstIdx = tr[0], firstSec = tr[1];
        if (firstIdx !== orig) {
          const back = [];
          let cur = firstIdx, t = firstSec, ok = true;
          const step = orig > firstIdx ? 1 : -1;
          while (cur !== orig) {
            const nxt = cur + step;
            const d = offs.get(`${dir}|${nxt}|${cur}`); // 行進方向上 nxt → cur 的時距
            if (!(d > 0)) { ok = false; break; }
            t -= d;
            back.unshift([nxt, Math.round(t)]);
            cur = nxt;
          }
          if (ok) propose(tr, dir, 'head', firstIdx, back);
        }
      }
      // ── 第二輪:只採用「整群被截斷」的缺口,並確保補進去的車彼此不貼著 ──
      const added = new Map();
      let tails = 0, heads = 0;
      for (const [, members] of groups) {
        // 零星幾班 = 真的營運型態,不是缺資料。無中途折返的線不受此限:那條線的營運事實
        // 本身就說了「沒有折返這回事」,一班被截斷也是被截斷。
        if (!members[0].forced && members.length < MIN_GROUP_TRIPS) continue;
        members.sort((a, b) => a.proj[0][1] - b.proj[0][1]);
        for (const m of members) {
          const clash = m.proj.some(([i, t]) => (added.get(`${m.dir}|${i}`) || [])
            .some(x => Math.abs(x - t) < MIN_SEP_SEC));
          if (clash) continue;
          for (const [i, t] of m.proj) {
            const k = `${m.dir}|${i}`;
            if (!added.has(k)) added.set(k, []);
            added.get(k).push(t);
          }
          if (m.end === 'tail') { for (const [i, t] of m.proj) m.tr.push(i, t); tails++; }
          else { m.tr.unshift(...m.proj.flat()); heads++; }
        }
      }
      if (tails || heads) {
        const nm = i => (line.stations[i] && line.stations[i].name) || `#${i}`;
        log(`  ⧉ ${lid}/${setName} 補回記錄缺口造成的假折返:尾端 ${tails} 班、頭端 ${heads} 班`
          + `(端點 ${nm(0)}／${nm(n - 1)})`);
      }
    }
  }
}

// ── CLI:對現有 data/*_times.json 就地重跑。缺口補起來之後再跑一次不會再動到任何一班(冪等)。
if (import.meta.url === `file://${process.argv[1]}`) {
  const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const DRY = process.argv.includes('--dry-run');
  const PAIRS = [['data/trtc_times.json', 'data/trtc.json'], ['data/krtc_times.json', 'data/krtc.json'],
    ['data/tymc_times.json', 'data/tymc.json'], ['data/ntdlrt_times.json', 'data/ntdlrt.json'],
    ['data/ntalrt_times.json', 'data/ntalrt.json'], ['data/tmrt_times.json', 'data/tmrt.json'],
    ['data/sanying_times.json', 'data/sanying.json']];
  for (const [timesPath, linePath] of PAIRS) {
    let times, lineFile;
    try {
      times = JSON.parse(readFileSync(path.join(ROOT, timesPath), 'utf8'));
      lineFile = JSON.parse(readFileSync(path.join(ROOT, linePath), 'utf8'));
    } catch { continue; }
    const before = JSON.stringify(times);
    console.log(`== ${timesPath}`);
    applyGapFill(times, lineFile);
    const after = JSON.stringify(times);
    if (before === after) { console.log('  · 無缺口可補'); continue; }
    if (DRY) { console.log('  (--dry-run:未寫檔)'); continue; }
    writeFileSync(path.join(ROOT, timesPath), after);
    console.log(`  → 已更新 ${(after.length / 1024).toFixed(0)}KB`);
  }
}
