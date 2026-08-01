#!/usr/bin/env node
// 捷運班表健全性 gate。**自動化管線的煞車**:watch_official.mjs 偵測到 TDX 班表變動後,
// 重抓→重建→跑這支,全綠才准自動 commit/部署;任一紅就停下來給人看。
//
// 為什麼需要:TDX 給過亂序、整段重複、時間亂碼的髒值(見 build_metro_times.mjs 的 depsOf/drop 清單)。
// 自動管線最怕的不是「抓不到」,是把髒資料靜靜地上線——它不會噴錯,只會讓某條線今天少一半班次。
//
// 兩類判準,刻意分開:
//   [結構] 物理不變式,與基準無關:時刻必須遞增、班距不能是 0 或荒謬值、days 必須指到存在的 set。
//   [相對] 與基準版本比幅度。**判準不寫死班數**(那是會漂移的量,見 judgment.md 心得 35),
//          寫的是「相對變動不得超過門檻」——門檻本身才是常數。
//
// 用法:
//   node scripts/verify_metro_times.mjs                    # 相對基準 = HEAD
//   node scripts/verify_metro_times.mjs --baseline <ref>   # 指定 git ref
//   node scripts/verify_metro_times.mjs --structure-only   # 只跑結構(新線首次建檔時用)
// 離開碼:0=全過 1=有紅燈
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['data/trtc_times.json', 'data/krtc_times.json', 'data/tymc_times.json',
  'data/ntdlrt_times.json', 'data/ntalrt_times.json', 'data/tmrt_times.json', 'data/sanying_times.json'];

// 幅度門檻。班表改點通常是個位數百分比;超過就是「改點」或「資料壞了」,兩者都該有人看一眼。
const MAX_COUNT_DRIFT = 0.15;      // 單一 set 班次數相對變動上限
const MAX_EDGE_DRIFT_SEC = 60 * 60; // 首/末班時刻位移上限
const MIN_HEADWAY_SEC = 60;         // 同方向相鄰發車最小間隔(小於此=重複班或亂碼)
const MAX_GAP_GROWTH_SEC = 30 * 60; // 幹線最大空檔相對基準的增幅上限(中間掉了一整段就會超)

const argv = process.argv.slice(2);
const flagVal = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const BASELINE = flagVal('--baseline') || 'HEAD';
const STRUCT_ONLY = argv.includes('--structure-only');

let fail = 0, checks = 0;
const ck = (ok, msg) => { checks++; console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) fail++; };
const hm = s => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}`;
const pct = x => (x * 100).toFixed(1) + '%';

// 一班 = [idx,sec, idx,sec, ...] 攤平,見 build_metro_times.mjs 檔頭
const secsOf = tr => { const o = []; for (let i = 1; i < tr.length; i += 2) o.push(tr[i]); return o; };
const idxsOf = tr => { const o = []; for (let i = 0; i < tr.length; i += 2) o.push(tr[i]); return o; };
const depOf = tr => tr[1];

// 行進方向:取「站序 index 逐步變化的正負號總和」,不比首末站。
// 環線(高雄輕軌 C、38 站)首末站同為 index 0,首末比對會把順逆兩個方向併成一組,
// 於是「同時 06:30 發車的順時針與逆時針兩班」被誤判成過近發車(2026-08-01 初版報 77 處)。
// 正負號總和對環線與非環線都對:繞一圈只有一個 wrap 步是反號,總和仍指向真方向。
const dirOf = tr => {
  const idx = idxsOf(tr);
  let s = 0;
  for (let i = 1; i < idx.length; i++) s += Math.sign(idx[i] - idx[i - 1]);
  return s >= 0 ? 'asc' : 'desc';
};

// 依「方向@起站」分組發車時刻。捷運首班車會同時從多個站發車、尖峰另有中途始發加班車
// (板南線亞東醫院那種),不分起站就是拿蘋果比橘子——2026-08-01 初版漏了這層,
// R/平日/desc 報 58 處過近發車,實測 58/58 都是不同起站、同時 06:00 發的首班車群。
function groupRuns(trains) {
  const g = new Map();
  for (const tr of trains) {
    const k = `${dirOf(tr)}@${tr[0]}`;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(depOf(tr));
  }
  return g;
}

// 幹線 = 每個方向班次最多的那個起站。中途始發只在尖峰跑,中間本來就有數小時的洞,
// 拿它問「最大間隔」一定假紅。
function trunkGaps(trains) {
  const g = groupRuns(trains), out = {};
  for (const dir of ['asc', 'desc']) {
    const cand = [...g].filter(([k]) => k.startsWith(dir + '@')).sort((a, b) => b[1].length - a[1].length)[0];
    if (!cand || cand[1].length < 3) continue;
    const deps = [...cand[1]].sort((a, b) => a - b);
    let biggest = 0;
    for (let i = 1; i < deps.length; i++) biggest = Math.max(biggest, deps[i] - deps[i - 1]);
    out[dir] = { start: cand[0], biggest };
  }
  return out;
}

function loadBaseline(rel) {
  try {
    return JSON.parse(execFileSync('git', ['show', `${BASELINE}:${rel}`], { cwd: ROOT, maxBuffer: 1 << 28, encoding: 'utf8' }));
  } catch { return null; }
}

for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) { ck(false, `${rel} 不存在`); continue; }
  const cur = JSON.parse(readFileSync(abs, 'utf8'));
  const lines = cur.lines || cur;
  console.log(`\n[${rel}]`);

  for (const [lid, L] of Object.entries(lines)) {
    if (!L || !L.sets) { ck(false, `${lid} 沒有 sets`); continue; }
    const setNames = Object.keys(L.sets);
    ck(setNames.length > 0, `${lid} 有 ${setNames.length} 個營運日班表`);

    // ── 結構:days / holiday 必須指到真的存在的 set ──
    const days = L.days || [];
    ck(days.length === 7 && days.every(d => setNames.includes(d)),
      `${lid} days 七天皆指到存在的 set（${[...new Set(days)].join('/') || '缺'}）`);
    ck(!L.holiday || setNames.includes(L.holiday), `${lid} holiday「${L.holiday}」指到存在的 set`);

    for (const [tag, trains] of Object.entries(L.sets)) {
      ck(trains.length > 0, `${lid}/${tag} 有班次（${trains.length} 班）`);
      if (!trains.length) continue;

      // ── 結構:每班站數 ≥2、時刻嚴格遞增 ──
      let shortTrains = 0, nonMono = null;
      for (const tr of trains) {
        const s = secsOf(tr);
        if (s.length < 2) { shortTrains++; continue; }
        for (let i = 1; i < s.length; i++) {
          if (s[i] <= s[i - 1] && nonMono === null) nonMono = `發車 ${hm(s[0])} 第 ${i} 站 ${hm(s[i - 1])}→${hm(s[i])}`;
        }
      }
      ck(shortTrains === 0, `${lid}/${tag} 每班至少兩站（${shortTrains} 班不足）`);
      ck(nonMono === null, `${lid}/${tag} 逐站時刻嚴格遞增${nonMono ? `（首例：${nonMono}）` : ''}`);

      // ── 結構:發車間隔落在合理帶 ──
      // 方向用「首站 index vs 末站 index」判,不靠欄位:合成線與鏈匹配線的欄位不一致。
      // **必須按「起站」再分一層**:捷運首班車同時從多個站發車、尖峰另有中途始發加班車
      // (板南線亞東醫院那種),把不同起站的車放在一起比發車間隔是拿蘋果比橘子——
      // 2026-08-01 初版就是漏了這層,R/平日/desc 報 58 處「過近發車」,實測 58/58 都是
      // 不同起站、同時 06:00 發的首班車群,同起站分組後歸零。
      const groups = groupRuns(trains);
      let tooTight = 0, tightEx = null;
      for (const [k, deps] of groups) {
        if (deps.length < 3) continue;
        deps.sort((a, b) => a - b);
        for (let i = 1; i < deps.length; i++) {
          if (deps[i] - deps[i - 1] < MIN_HEADWAY_SEC) { tooTight++; tightEx ??= `${k} ${hm(deps[i - 1])}/${hm(deps[i])}`; }
        }
      }
      ck(tooTight === 0, `${lid}/${tag} 同起站同方向無過近發車（<${MIN_HEADWAY_SEC}s 的有 ${tooTight} 處${tightEx ? `，首例 ${tightEx}` : ''}）`);
    }
  }

  if (STRUCT_ONLY) continue;

  // ── 相對:與基準比幅度 ──
  const base = loadBaseline(rel);
  if (!base) { ck(false, `${rel} 取不到基準 ${BASELINE}（新檔就加 --structure-only）`); continue; }
  const bLines = base.lines || base;
  for (const lid of Object.keys(bLines)) {
    ck(lid in lines, `${lid} 仍存在（基準有這條線）`);
  }
  for (const [lid, L] of Object.entries(lines)) {
    const B = bLines[lid];
    if (!B || !B.sets) { console.log(`  · ${lid} 是基準沒有的新線，跳過相對比對`); continue; }
    for (const [tag, trains] of Object.entries(L.sets)) {
      const bt = B.sets[tag];
      if (!bt) { console.log(`  · ${lid}/${tag} 是新的營運日型別，跳過相對比對`); continue; }
      const drift = (trains.length - bt.length) / bt.length;
      ck(Math.abs(drift) <= MAX_COUNT_DRIFT,
        `${lid}/${tag} 班次數 ${bt.length}→${trains.length}（${drift >= 0 ? '+' : ''}${pct(drift)}，上限 ±${pct(MAX_COUNT_DRIFT)}）`);
      const edge = arr => { const d = arr.map(depOf); return [Math.min(...d), Math.max(...d)]; };
      const [cf, cl] = edge(trains), [bf, bl] = edge(bt);
      ck(Math.abs(cf - bf) <= MAX_EDGE_DRIFT_SEC, `${lid}/${tag} 首班 ${hm(bf)}→${hm(cf)}（位移 ≤ ${MAX_EDGE_DRIFT_SEC / 60} 分）`);
      ck(Math.abs(cl - bl) <= MAX_EDGE_DRIFT_SEC, `${lid}/${tag} 末班 ${hm(bl)}→${hm(cl)}（位移 ≤ ${MAX_EDGE_DRIFT_SEC / 60} 分）`);
      // 幹線最大空檔:刻意用「相對基準的增幅」而非絕對門檻。有些線本來就有大洞
      // (環狀線 Y 平日上行 19:23 之後直到 23:03,220 分),寫絕對值只會逼出一個
      // 遲早被下次改點推翻的魔術數字;要抓的是「新長出來的洞」。
      const cg = trunkGaps(trains), bg = trunkGaps(bt);
      for (const dir of ['asc', 'desc']) {
        if (!cg[dir] || !bg[dir]) continue;
        const grew = cg[dir].biggest - bg[dir].biggest;
        ck(grew <= MAX_GAP_GROWTH_SEC,
          `${lid}/${tag}/${dir} 幹線最大空檔 ${Math.round(bg[dir].biggest / 60)}→${Math.round(cg[dir].biggest / 60)} 分（增幅 ≤ ${MAX_GAP_GROWTH_SEC / 60} 分）`);
      }
    }
  }
}

console.log(`\n${fail ? `✗ ${fail}/${checks} 項未過` : `✓ 全部通過（${checks} 項）`}`);
process.exit(fail ? 1 : 0);
