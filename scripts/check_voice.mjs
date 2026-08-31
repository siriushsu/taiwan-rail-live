import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// root 由自身檔案位置推導,不用 cwd——ship_web 是拿乾淨 worktree 裡的這一份跑的。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'docs/voice-rules.json'), 'utf8'));
const failures = [];
function fail(message) { failures.push(message); }

const sourceCache = new Map();
function sourceOf(file) {
  if (!sourceCache.has(file)) {
    // 讀不到就存 null,交給呼叫端當「定位失敗」處理——不要讓整支腳本被 uncaught
    // exception 炸掉(那樣 exit code 雖然還是非 0,但錯誤訊息不會指名是哪個 surface)。
    let content = null;
    try { content = fs.readFileSync(path.join(root, file), 'utf8'); } catch { content = null; }
    sourceCache.set(file, content);
  }
  return sourceCache.get(file);
}

// 遞迴攤平物件/陣列裡的所有字串值(字典類 surface 用)。
function flattenStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach(v => flattenStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => flattenStrings(v, out));
  return out;
}

function evaluateConstBlock(source, startMarker, endMarker, names) {
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) return null;   // null = 定位失敗,交給 S0 報
  try {
    const local = {};
    vm.createContext(local);
    vm.runInContext(`${source.slice(start, end)}\nglobalThis.__out = { ${names.join(', ')} };`, local);
    return local.__out || {};
  } catch {
    // names 指到不存在的常數、區塊語法壞掉…等任何 vm 執行期例外,一律當定位失敗回報,
    // 不要讓整支腳本被 uncaught exception 中止——那樣後面所有 surface 都不會被檢查到,
    // 而且錯誤訊息(裸 stack trace)不會指名是哪個 surface。
    return null;
  }
}

// 只取真 HTML 的 <button>/<summary> 可見文字。先剝 <style>/<script>——
// CSS 註解裡出現「<button>」會被當成控件(實測會撈到一段談 .fp-close 的註解)。
// 不含 <script> 內動態產生的按鈕,那些交給 extractControlsDynamic。
function extractControls(source) {
  const html = source
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
  return [...html.matchAll(/<(button|summary)\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .map(m => m[2].replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);
}

// extractControls 的反面:只取 <script> 區塊內的 <button>/<summary> 內文——
// JS 樣板產生的控件(帳號面板、附近車站清單等 renderXxx() 組字串塞 innerHTML)。
// 內文常是原始碼片段(${...}、字串串接、變數名),不是乾淨文字,所以這個 surface
// 在 voice-rules.json 標了 contentExempt:V1/V2 詞表規則不吃它,只有 V6(符號棘輪)看。
function extractControlsDynamic(source) {
  const noStyle = source.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
  const scriptBodies = [...noStyle.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).join('\n');
  return [...scriptBodies.matchAll(/<(button|summary)\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .map(m => m[2].replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);
}

// 抽取原始碼裡每一個單／雙引號字串字面值(鍵與值都要)。用於 i18n 字典類 surface——
// 那三個檔的形態是 `'中文鍵': '譯文',`,鍵與值都是使用者看得到的文字。
// 不在乎跨字串邊界的語意(例如是 key 還是 value),V1/V2 詞表比對只在乎「這段文字出現過」。
function extractStringLiterals(source) {
  return [...source.matchAll(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g)].map(m => m[0].slice(1, -1));
}

function collect(surface) {
  const files = Array.isArray(surface.file) ? surface.file : [surface.file];
  const e = surface.extract;
  if (e.type === 'wholeFile') {
    const contents = files.map(f => sourceOf(f));
    return contents.some(c => c === null) ? null : contents;
  }
  if (e.type === 'stringLiterals') {
    const items = [];
    for (const f of files) {
      const source = sourceOf(f);
      if (source === null) return null;
      items.push(...extractStringLiterals(source));
    }
    return items;
  }
  const source = sourceOf(files[0]);
  if (source === null) return null;
  if (e.type === 'regex') {
    const matches = [...source.matchAll(new RegExp(e.pattern, 'g'))];
    const values = matches.map(m => m[e.group]).filter(v => typeof v === 'string');
    // group 指錯(該 pattern 沒有那個捕獲組)時 m[e.group] 是 undefined,filter 會把它濾掉——
    // 但濾掉不等於沒事:那代表這個 surface 的每一條都抓不到文字,只是「碰巧還匹配得到 <li>」。
    // 條數對不上就不是真的抽到東西,回 null 交給 S0 統一報「定位失敗」,不要靜默少算。
    if (values.length !== matches.length) return null;
    return values;
  }
  if (e.type === 'constBlock') {
    const block = evaluateConstBlock(source, e.start, e.end, e.names);
    return block === null ? null : flattenStrings(block);
  }
  if (e.type === 'controls') return extractControls(source);
  if (e.type === 'controlsDynamic') return extractControlsDynamic(source);
  return null;
}

// ── 正本自檢 ──────────────────────────────────────────────────────────────
// 這一段擋的是「voice-rules.json 這份正本自己被改壞」(欄位被刪、型別錯、整段清空),
// 跟下面 S0 主迴圈擋的「index.html 等來源檔案裡的文字被改壞」是兩件事。
// 正本會在後續 task 反覆修改,一次壞合併就可能讓整條文風閘門悄悄變成 no-op 卻回報通過。
if (!Array.isArray(spec.surfaces) || spec.surfaces.length === 0) {
  fail('surfaces 正本是空陣列或不是陣列——voice-rules.json 本身壞了,不是「這次沒有要驗的內容」');
}
const seenIds = new Set();
for (const surface of Array.isArray(spec.surfaces) ? spec.surfaces : []) {
  const label = (surface && typeof surface.id === 'string' && surface.id) || '(缺 id)';
  if (!surface || typeof surface.id !== 'string' || !surface.id) {
    fail(`有 surface 缺少合法 id：${JSON.stringify(surface).slice(0, 100)}`);
  } else if (seenIds.has(surface.id)) {
    fail(`surface id 重複：「${surface.id}」`);
  } else {
    seenIds.add(surface.id);
  }
  if (!Number.isInteger(surface?.minCount) || surface.minCount < 1) {
    fail(`surface「${label}」的 minCount 必須是 ≥1 的整數,現在是 ${JSON.stringify(surface?.minCount)}——沒有下限等於這個 surface 永遠通過`);
  }
  const files = Array.isArray(surface?.file) ? surface.file : [surface?.file];
  const MULTI_FILE_SAFE_TYPES = ['wholeFile', 'stringLiterals']; // 這兩種 collect() 會真的走遍 files[] 全部;其餘類型只讀 files[0]
  if (files.length > 1 && !MULTI_FILE_SAFE_TYPES.includes(surface?.extract?.type)) {
    fail(`surface「${label}」給了 ${files.length} 個檔案但 extract.type「${surface?.extract?.type}」不支援多檔——只有 ${MULTI_FILE_SAFE_TYPES.join('／')} 會真的讀完 files[] 全部,其餘只讀 files[0],其餘會被靜默丟棄`);
  }
}

// contentExempt 白名單——凡宣告 contentExempt:true 的 surface 集合,必須「恰好」等於
// docs/voice-rules.json 裡 contentExemptBaseline 這份清單(雙向比對:多一個或少一個都 fail)。
// 沒有這道檢查時,contentExempt 是一顆無治理的 per-surface 開關:誰改壞哪個 surface 的
// contentExempt 值,V1/V2 就對那個 surface 靜默失效,而且失效後的通過輸出跟真的乾淨
// 長得一模一樣。多加一份清單讓「新增豁免」得同時改兩處,那個摩擦是刻意的。
if (!Array.isArray(spec.contentExemptBaseline)) {
  fail('contentExemptBaseline 正本自檢失敗:不是陣列(或整個欄位不存在)——沒有這份清單,任何 surface 都能悄悄標 contentExempt:true 而不被發現');
} else {
  const declaredExempt = new Set(
    (Array.isArray(spec.surfaces) ? spec.surfaces : [])
      .filter(s => s && s.contentExempt)
      .map(s => s.id)
  );
  const baselineExempt = new Set(spec.contentExemptBaseline);
  for (const id of declaredExempt) {
    if (!baselineExempt.has(id)) fail(`contentExempt 白名單自檢失敗:surface「${id}」標了 contentExempt:true,但不在 contentExemptBaseline 清單裡——豁免內容規則的 surface 必須明文列在清單中`);
    const s = spec.surfaces.find(x => x && x.id === id);
    if (!s || typeof s.why !== 'string' || !s.why.trim()) fail(`surface「${id}」標了 contentExempt:true 但沒有非空的 why——豁免內容規則的理由必須說清楚`);
  }
  for (const id of baselineExempt) {
    if (!declaredExempt.has(id)) fail(`contentExempt 白名單自檢失敗:contentExemptBaseline 列了「${id}」,但沒有任何 surface 實際標 contentExempt:true——清單本身可能已經過期`);
  }
}

// ── rules 正本自檢 ────────────────────────────────────────────────────────
// 這一段擋的是「rules.V1 被整段刪掉／banned 被清空／allow 長出孤兒」——跟上面
// surfaces 正本自檢擋的是同一種事故,只是換了一個欄位。IMPLEMENTED_RULES 是這支
// 腳本自己「宣稱實作了哪些規則」的清單:少了任何一條在 spec.rules 裡,代表規則
// 整段被刪掉或改壞,底下的規則主檢查會直接跳過(靜默放行),必須在這裡先攔下來。
const IMPLEMENTED_RULES = ['V1'];
for (const ruleId of IMPLEMENTED_RULES) {
  const rule = spec.rules && spec.rules[ruleId];
  if (!rule || typeof rule !== 'object') {
    fail(`規則正本自檢失敗:「${ruleId}」在 rules 裡不存在或不是物件(rules 區塊被整段刪掉、清空或改壞)——閘門對它會靜默放行`);
    continue;
  }
  if (typeof rule.why !== 'string' || !rule.why.trim()) {
    fail(`規則正本自檢失敗:「${ruleId}」缺少非空的 why`);
  }
  const bannedOk = Array.isArray(rule.banned) && rule.banned.length > 0 && rule.banned.every(b => typeof b === 'string' && b);
  if (!bannedOk) {
    fail(`規則正本自檢失敗:「${ruleId}」的 banned 必須是非空字串陣列,現在是 ${JSON.stringify(rule.banned)}——banned 是空陣列或型別不對,等於這條規則永遠不會開火`);
  }
  const bannedSet = new Set(bannedOk ? rule.banned : []);
  for (const a of Array.isArray(rule.allow) ? rule.allow : []) {
    const aLabel = `surface=${a?.surface} term=${JSON.stringify(a?.term)}`;
    if (!bannedSet.has(a?.term)) {
      fail(`規則正本自檢失敗:「${ruleId}」的 allow 有一條 term 不在 banned 裡(${aLabel})——這條 allow 已經是孤兒,對不存在的禁詞放行沒有意義`);
    }
    if (typeof a?.why !== 'string' || !a.why.trim()) {
      fail(`規則正本自檢失敗:「${ruleId}」有一條 allow(${aLabel})缺少非空的 why`);
    }
    // match 非空且不得是 term 的子字串——這是「精確度下限」,2026-08-31 訂定:match="" 或
    // match===term 這兩種退化值都會讓 allow 對 term 的每一次出現全部放行,等於沒有 match
    // 這個欄位;「不是子字串」是能用一行條件式表達、且不會誤傷任何現有資料的最低要求
    // (現有兩條 allow 的 match 都是完整語句片段,遠不是 term 的子字串)。
    if (typeof a?.match !== 'string' || !a.match) {
      fail(`規則正本自檢失敗:「${ruleId}」有一條 allow(${aLabel})的 match 是空字串或缺漏——match 空字串時 text.includes(match) 恆真,等於對這個 term 整個 surface 全部放行`);
    } else if (typeof a?.term === 'string' && a.term.includes(a.match)) {
      fail(`規則正本自檢失敗:「${ruleId}」有一條 allow(${aLabel})的 match「${a.match}」是 term 本身的子字串(或與 term 相等)——這樣的 match 沒有分辨力,任何含 term 的文字都會被這條 allow 放行`);
    }
  }
}

// ── S0：surface 覆蓋率斷言 ────────────────────────────────────────────────
// 擋的是「宣告了卻定位失敗」(標記被改壞、檔案改名、區塊被刪)。
// 🔴 擋不了「根本沒宣告」——新增一個全新的對外文字容器而沒登記進 surfaces[],
//    S0 對它一無所知。所以下面一定要把「掃了哪幾個、各幾條」印出來,
//    讓漏登記在人眼前顯形。「S0 綠」≠「所有對外文字都驗過了」。
const collected = new Map();
for (const surface of Array.isArray(spec.surfaces) ? spec.surfaces : []) {
  const items = collect(surface);
  if (items === null) {
    const fileLabel = Array.isArray(surface.file) ? surface.file.join('、') : surface.file;
    fail(`S0 surface「${surface.id}」定位失敗——${fileLabel} 裡找不到抽取標記,這一塊完全沒被驗到`);
    continue;
  }
  // 硬不變量,獨立於 minCount 欄位是否存在/合法:抓到 0 條一律視為定位失敗。
  // 就算上面的正本自檢日後被繞過(例如某個 surface 忘了設 minCount 但沒被攔到),
  // 這一條還是會擋下「inventory 印出 xxx=0 但腳本說通過」這種最惡劣的假綠。
  if (items.length === 0) {
    fail(`S0 surface「${surface.id}」抓到 0 條——不論 minCount 設定為何,0 條一律視為定位失敗`);
    continue;
  }
  if (items.length < surface.minCount) {
    fail(`S0 surface「${surface.id}」只抓到 ${items.length} 條,低於下限 ${surface.minCount}——抽取式可能已失效`);
  }
  // 逐檔原始內容下限——minCount 數的是「條目數」(不論是幾個檔案還是幾個字串字面值),
  // 一個檔被整個清空、另一個檔照樣完整或補了大量條目時,總條目數不變,minCount 完全看不出來。
  // 直接重讀 sourceOf(f)(原始檔案字元數),獨立於 extract.type 與 items 的粒度——
  // i18n-dict 從 wholeFile 換成 stringLiterals 後,items 不再是「一個檔案一條」,這條檢查
  // 不能再靠 items[i] 對應第 i 個檔案,只能自己重讀檔案。
  if (surface.minCharsPerFile) {
    const files = Array.isArray(surface.file) ? surface.file : [surface.file];
    files.forEach((f) => {
      const need = surface.minCharsPerFile[f];
      if (need == null) { fail(`S0 surface「${surface.id}」的 minCharsPerFile 沒有 ${f} 的下限`); return; }
      const actual = (sourceOf(f) || '').length;
      if (actual < need) fail(`S0 surface「${surface.id}」的 ${f} 只有 ${actual} 字元,低於下限 ${need}——內容可能被清空或大量刪減`);
    });
  }
  collected.set(surface.id, items);
}

// ── V1：對外用語表 ────────────────────────────────────────────────────────
// 擋「Plus」「月費方案」「年費方案」這類 2026-08-05 更名後不該再對外出現的舊字——
// 判準是「使用者會不會看到」,所以只掃 surfaces(對外文字),不掃程式碼識別字本身。
const v1 = spec.rules && spec.rules.V1;
if (v1) {
  // banned/allow 的型別與內容已由上面「rules 正本自檢」驗過並各自 fail() 記錄;
  // 這裡仍要防禦式地轉成安全的陣列再迭代——自檢失敗不會中止腳本,若這裡直接
  // for...of 一個非陣列的 banned,會拋出未捕捉例外把整支腳本連同已收集的 failures
  // 一起炸掉(exit code 雖然還是非 0,但看不到任何一條具名訊息)。
  const bannedList = Array.isArray(v1.banned) ? v1.banned : [];
  const allowList = Array.isArray(v1.allow) ? v1.allow : [];
  for (const surface of Array.isArray(spec.surfaces) ? spec.surfaces : []) {
    // contentExempt 的 surface(如 ui-control-dynamic)內容是原始碼片段(${…}、字串串接),
    // 不是乾淨的對外文字,V1/V2 詞表比對對它必然誤判,故跳過——V6(符號棘輪)才看它。
    if (surface.contentExempt) continue;
    const items = collected.get(surface.id);
    if (!items) continue; // 這個 surface 在 S0 已經定位失敗,沒有內容可掃
    for (const text of items) {
      for (const term of bannedList) {
        if (!text.includes(term)) continue;
        const allowed = allowList.some(a =>
          a.surface === surface.id && a.term === term && typeof a.match === 'string' && text.includes(a.match));
        if (!allowed) fail(`V1 對外文字出現「${term}」（surface ${surface.id}）：${text.slice(0, 40)}`);
      }
    }
  }
  // allowlist 自身健康檢查,雙邊界:
  // - 下限(命中 0 條):那條文字已經改掉了,allow 該刪——否則 allowlist 會慢慢腐爛成
  //   一張「反正都放行」的清單,失去對應到真實文字的意義。
  // - 上限(命中 > MAX_ALLOW_RADIUS 條):match 太籠統(例如一個通用標點符號),放行的範圍
  //   遠超過「這一句話」,等於幫這個 term 開了後門。2026-08-31 實測現有 allow 全部只命中
  //   1 條,上限取 3 是留一格餘裕(允許同一句話因文案微調衍生出 2、3 個近似版本仍可沿用
  //   同一條 allow),再高就已經不是「精確豁免某一句話」,而是「豁免某一類文字」。
  const MAX_ALLOW_RADIUS = 3;
  for (const a of allowList) {
    const items = collected.get(a.surface) || [];
    const hits = items.filter(t => t.includes(a.term) && typeof a.match === 'string' && t.includes(a.match));
    if (hits.length === 0) {
      fail(`V1 allowlist 有一筆命中不到,該刪：surface=${a.surface} term=${a.term} match=${a.match}`);
    } else if (hits.length > MAX_ALLOW_RADIUS) {
      const preview = hits.slice(0, 2).map(t => t.slice(0, 20)).join('｜');
      fail(`V1 allowlist 有一筆 match 太籠統,放行了 ${hits.length} 條文字(上限 ${MAX_ALLOW_RADIUS})：surface=${a.surface} term=${a.term} match=${JSON.stringify(a.match)},前兩條開頭:${preview}`);
    }
  }
}

if (failures.length) {
  console.error(`文風稽核失敗（${failures.length} 項）`);
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

const inventory = spec.surfaces
  .map(s => `${s.id}=${collected.get(s.id).length}`)
  .join('、');
console.log(`文風稽核通過：掃了 ${spec.surfaces.length} 個 surface（${inventory}）`);
console.log('⚠ 只驗宣告過的 surface。新增對外文字容器要同輪登記進 docs/voice-rules.json。');
const exemptList = spec.surfaces.filter(s => s.contentExempt).map(s => s.id);
console.log(`⚠ V1／V2 內容規則豁免（contentExempt）：${exemptList.length ? exemptList.join('、') : '（無）'}`);
