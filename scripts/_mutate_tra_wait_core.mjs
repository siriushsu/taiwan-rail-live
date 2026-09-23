// 台鐵等站卡純邏輯的突變測試:證明 verify_tra_wait_core.mjs 的判準真的有牙。
//
// 🔴 突變清單的產生方式是【逐條修法各還原一次】,不是「想幾個看起來像回歸的改動」——
//    後者由實作者自己列,會系統性地漏掉他沒想到的那一條(judgment 心得 37 的教訓,
//    metro-wait-card-start-failures 那次是靠這個分辨法才發現十項判準裡沒有一項測得到修法 3)。
//    所以下面每一發都對應 tra_wait_core.mjs 裡一個【刻意的設計決定】,把它還原成
//    「沒有想到那件事時最自然會寫出來的樣子」。
//
// 跑法:node scripts/_mutate_tra_wait_core.mjs
// 跑完自動還原並比對 md5——還原失敗會以非零離開,不會把突變過的檔留在樹上。
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, 'tra_wait_core.mjs');
const VERIFY = join(HERE, 'verify_tra_wait_core.mjs');

const original = readFileSync(TARGET, 'utf8');
const originalMd5 = createHash('md5').update(original).digest('hex');

// 每一發:from → to 的字面取代(必須恰好命中一次,否則整支中止——避免「突變根本沒套上去
// 卻因為全綠而誤以為判準沒牙」這種反向假象),外加預期會轉紅的判準代號。
const MUTATIONS = [
  {
    id: 'M1 拿掉嚴格數值轉換(num → Number)',
    why: '這是本檔真的寫錯過的形狀:Number(null)===0 讓「算不出到站時刻」被當成「早就到站」。',
    from: `function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}`,
    to: `function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}`,
    expect: ['C4r', 'F4', 'F5'],
  },
  {
    id: 'M2 查不到這班車就當成準點',
    why: '「不在官方動態窗裡」與「誤點 0 分」被合併——卡片會宣稱一個官方沒說過的事實。',
    from: `  const key = String(trainNo == null ? '' : trainNo).trim();
  if (!key) return miss;`,
    to: `  const key = String(trainNo == null ? '' : trainNo).trim();
  if (!key) return miss;
  const fallback = { delayMin: 0, known: true, dataAt };`,
    to2: { from: `  return found || miss;`, to: `  return found || fallback;` },
    expect: ['A2'],
  },
  {
    id: 'M3 不看資料齡',
    why: '上游掛掉時 worker 沿用舊 mem 回 200,不看齡就會把半小時前的誤點畫成現在的事實。',
    from: `  if (now == null || now - dataAt > TW_DELAY_MAX_AGE_SEC) return stale;`,
    to: `  if (now == null) return stale;`,
    expect: ['B2', 'B6'],
  },
  {
    id: 'M4 誤點未知時照抄髒值',
    why: 'known=false 卻把 delayMin 帶出去,等於讓過期/殘留的值靜靜地畫上卡片。',
    from: `    delayMin: known && raw != null ? Math.round(raw) : null,`,
    to: `    delayMin: raw != null ? Math.round(raw) : null,`,
    expect: ['D3r'],
  },
  {
    id: 'M5 完全不比對資料時刻(照抄捷運卡的作法)',
    why: '捷運卡的視圖不畫 dataAt 所以可以整個排除;這張卡畫了「HH:mm 更新」,排除就是印一個越來越假的時刻。',
    from: `  const pa = num(prev.dataAt), na = num(next.dataAt);
  if ((pa == null) !== (na == null)) return true;
  if (pa != null && Math.abs(na - pa) >= TW_DATA_AT_EPS_SEC) return true;`,
    to: `  // (突變:整段拿掉)`,
    expect: ['E4r'],
  },
  {
    id: 'M6 用數值比較誤點(0 與 null 併掉)',
    why: 'Number(null)===0 ⇒「準點 → 沒有資訊」與反向都不會推,卡片會一直宣稱準點。',
    from: `  if (s(prev.delayMin) !== s(next.delayMin)) return true;`,
    to: `  if (Number(prev.delayMin) !== Number(next.delayMin)) return true;`,
    expect: ['E2a', 'E2b'],
  },
  {
    id: 'M7 end_at 允許縮短(還原成最直覺的寫法:算出來就回傳)',
    why: '誤點縮回來時把 end_at 拉近會提前收卡,而且一伸一縮讓這一列每輪都在寫 D1。\n'
       + '     ⚠️ 第一版突變只拿掉兩道守衛的其中一道,另一道照樣擋住 ⇒ 全綠。'
       + '突變沒轉紅時先確認突變本身真的改變了行為,不要直接判定判準沒牙。',
    from: `  if (want <= cur) return null;`,
    to: `  // (突變:早退守衛拿掉)`,
    to2: {
      from: `  const next = Math.min(want, cap);
  return next > cur ? next : null;`,
      to: `  return Math.min(want, cap);`,
    },
    expect: ['G1', 'G3'],
  },
  {
    id: 'M8 拿掉 3.5 小時封頂',
    why: '沒有封頂的話,灌一個誤點 300 分的假資料就能讓一列在 D1 裡活到天荒地老。',
    from: `  const cap = bound == null ? want : bound + TW_MAX_TRACK_SEC;`,
    to: `  const cap = want;`,
    expect: ['G4'],
  },
  {
    id: 'M9 兩種 known=false 併掉(往「都不新鮮」那邊倒)',
    why: '沒想到「看板新鮮但這班車不在窗裡」是常態時最自然的寫法:只有一個 miss 物件。\n'
       + '     後果是南迴那種站間長跑的區段會讓主角時刻在 18:35↔18:32 之間來回跳。',
    from: `  const miss = { delayMin: null, known: false, dataAt, fresh: true };`,
    to: `  const miss = stale;`,
    expect: ['A6'],
  },
  {
    id: 'M10 兩種 known=false 併掉(往「都新鮮」那邊倒)',
    why: '反方向的併法:上游掛掉 30 分鐘以上時,呼叫端會無限期沿用一個過期的誤點,\n'
       + '     卡片繼續宣稱「誤點 3 分」——這正是「有資訊就一定要對」要擋的事。\n'
       + '     兩個方向各一發是刻意的:單向併只證明得了其中一條判準有牙。',
    from: `  const stale = { delayMin: null, known: false, dataAt, fresh: false };`,
    to: `  const stale = { delayMin: null, known: false, dataAt, fresh: true };`,
    expect: ['B6', 'B6r'],
  },
  {
    id: 'M11 同一車次多筆時後蓋前(還原成 Map.set 的舊行為)',
    why: '沒實測過上游會給重複列時,最自然的寫法就是逐筆覆蓋。實測(08-22 23:15/23:17)\n'
       + '     3782 與 288 都是兩筆且誤點值不同 ⇒ 上游換個排序,卡片就往前跳一分鐘。\n'
       + '     (原本這一發寫的是「找到就 return」,對準的是改成「取較大誤點」之前的程式碼,\n'
       + '      09-23 發現取代字串已命中 0 次、整支在這裡中止——改對準現行寫法。)',
    from: `    if (!found || candidate.delayMin > found.delayMin) found = candidate;`,
    to: `    found = candidate;`,
    expect: ['A7'],
  },
  // ── 2026-09-23 等車卡 B:行駛段每分鐘推(使用者裁示「先改伺服器每分鐘推播」)──────────
  {
    id: 'M12 誤點未知時拿表定充數(null 當 0)',
    why: '沒想到精度紅線時最自然的寫法:沒誤點就當準點算行駛段。後果:卡片照表定畫一台在走的車,\n'
       + '     等於宣稱這班車準點,而官方根本沒說。',
    from: `  if (p == null || s == null || d == null || p >= s) return null;
  return { from: Math.round(p + d * 60), to: Math.round(s + d * 60) };`,
    to: `  if (p == null || s == null || p >= s) return null;
  return { from: Math.round(p + (d || 0) * 60), to: Math.round(s + (d || 0) * 60) };`,
    expect: ['H2', 'H2r'],
  },
  {
    id: 'M13 行駛段終點用表定不加誤點',
    why: '只記得「上一站開車時刻要加誤點」卻忘了終點也要:車頭會比卡片主角「實際約」早一分鐘碰到本站,\n'
       + '     兩個數字互相矛盾。',
    from: `  return { from: Math.round(p + d * 60), to: Math.round(s + d * 60) };`,
    to: `  return { from: Math.round(p + d * 60), to: Math.round(s) };`,
    expect: ['H1'],
  },
  {
    id: 'M14 拿掉 tick(每一發內容可能逐字相同)',
    why: '「誤點沒變就沒什麼好送的」——行駛段那一發在 TDX 兩分鐘才更新的空檔裡會與上一發逐字相同,\n'
       + '     系統不保證重畫,車就停著。',
    from: `    tick: tick == null ? null : Math.round(tick),`,
    to: `    tick: null,`,
    expect: ['D5', 'D5r'],
  },
  {
    id: 'M15 tick 進遲滯比較',
    why: '把 tick 當成一般欄位一起比:每一輪都不一樣 ⇒ 車靜止的時段也每分鐘推一發(推播量回到最壞)。',
    from: `  if (s(prev.notice) !== s(next.notice)) return true;`,
    to: `  if (s(prev.notice) !== s(next.notice)) return true;
  if (s(prev.tick) !== s(next.tick)) return true;`,
    expect: ['D6'],
  },
  {
    id: 'M16 行駛段沒有起點(車還沒開也每分鐘推)',
    why: '「到站前都推」是最省事的寫法。後果:開卡後車還在上一站以前的那幾十分鐘也每分鐘推,\n'
       + '     而那段車根本不動(使用者裁示:車還沒到上一站時不要白推)。',
    from: `  if (now < win.from || now >= win.to) return false;`,
    to: `  if (now >= win.to) return false;`,
    expect: ['H6'],
  },
  {
    id: 'M17 行駛段沒有終點(到站後照推)',
    why: '忘了到站後由 stale-date 接手:到站寬限那三分鐘也每分鐘推,而且推出去的車位置已經爆出軌道。',
    from: `  if (now < win.from || now >= win.to) return false;`,
    to: `  if (now < win.from) return false;`,
    expect: ['H11'],
  },
  {
    id: 'M18 拿掉最小間隔(同一分鐘重跑會推兩發)',
    why: '「cron 本來就每分鐘一發」——但排程觸發是至少一次,重跑那一發會重推同一格。',
    from: `  return last == null || now - last >= TW_RUN_PUSH_GAP_SEC;`,
    to: `  return true;`,
    expect: ['H9'],
  },
];

// 跑一次判準,回傳「轉紅的判準代號」集合(代號＝每行 FAIL 後面那個空白前的 token)。
function runVerify() {
  try {
    execFileSync(process.execPath, [VERIFY], { encoding: 'utf8', stdio: 'pipe' });
    return [];
  } catch (e) {
    const out = String((e.stdout || '') + (e.stderr || ''));
    // 🔴 只取【代號】那一段:判準名稱後面常常緊接著中文說明而沒有空白(例:
    //    「FAIL C6(精度)誤點未知 ⇒ …」),用 \S+ 會抓成 `C6(精度)誤點未知`,
    //    於是預期的 C6 永遠對不上 ⇒ 有牙的判準被誤判成沒抓到。
    return [...out.matchAll(/^FAIL ([A-Z]+[0-9]+[a-z]*)/gm)].map(m => m[1]);
  }
}

// 控制組:沒突變的時候必須全綠。少了這一條,「每一發都轉紅」有可能只是因為判準本來就是紅的。
const baseline = runVerify();
if (baseline.length) {
  console.error(`控制組就不是全綠(${baseline.join(',')})——先修好判準再跑突變。`);
  process.exit(2);
}
console.log('控制組 全綠 ✓\n');

let bad = 0;
for (const m of MUTATIONS) {
  let mutated = original;
  const apply = (from, to) => {
    if (mutated.split(from).length - 1 !== 1) {
      console.error(`${m.id}:取代字串命中 ${mutated.split(from).length - 1} 次(必須恰好 1 次),整支中止`);
      writeFileSync(TARGET, original);
      process.exit(2);
    }
    mutated = mutated.replace(from, to);
  };
  apply(m.from, m.to);
  if (m.to2) apply(m.to2.from, m.to2.to);
  writeFileSync(TARGET, mutated);
  const red = runVerify();
  writeFileSync(TARGET, original);

  const got = new Set(red);
  const missing = m.expect.filter(x => !got.has(x));
  const extra = red.filter(x => !m.expect.includes(x));
  const pass = missing.length === 0 && red.length > 0;
  if (!pass) bad++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${m.id}`);
  console.log(`     預期轉紅 ${m.expect.join(',')}｜實際轉紅 ${red.length ? red.join(',') : '(全綠=判準沒牙)'}`);
  if (missing.length) console.log(`     🔴 沒被抓到:${missing.join(',')}`);
  if (extra.length) console.log(`     (另外連帶轉紅:${extra.join(',')})`);
  console.log(`     ${m.why}`);
}

const restoredMd5 = createHash('md5').update(readFileSync(TARGET, 'utf8')).digest('hex');
if (restoredMd5 !== originalMd5) {
  console.error(`\n🔴 還原失敗:md5 ${restoredMd5} ≠ ${originalMd5}`);
  process.exit(2);
}
console.log(`\n還原確認 md5=${originalMd5} ✓`);
console.log(`總計 ${MUTATIONS.length} 發,沒抓到的 ${bad} 發`);
process.exit(bad ? 1 : 0);
