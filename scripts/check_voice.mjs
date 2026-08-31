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

function collect(surface) {
  const files = Array.isArray(surface.file) ? surface.file : [surface.file];
  const e = surface.extract;
  if (e.type === 'wholeFile') {
    const contents = files.map(f => sourceOf(f));
    return contents.some(c => c === null) ? null : contents;
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
  if (files.length > 1 && surface?.extract?.type !== 'wholeFile') {
    fail(`surface「${label}」給了 ${files.length} 個檔案但 extract.type 不是 wholeFile——非 wholeFile 只會讀 files[0],其餘會被靜默丟棄`);
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
  // wholeFile 類 surface 的逐檔內容下限——minCount 數的是「幾個檔案」不是「內容多寡」,
  // 一個檔被整個清空、另一個檔照樣完整時,檔案數不變,minCount 完全看不出來。
  if (surface.extract?.type === 'wholeFile' && surface.minCharsPerFile) {
    const files = Array.isArray(surface.file) ? surface.file : [surface.file];
    files.forEach((f, i) => {
      const need = surface.minCharsPerFile[f];
      if (need == null) { fail(`S0 surface「${surface.id}」的 minCharsPerFile 沒有 ${f} 的下限`); return; }
      const actual = items[i].length;
      if (actual < need) fail(`S0 surface「${surface.id}」的 ${f} 只有 ${actual} 字元,低於下限 ${need}——內容可能被清空或大量刪減`);
    });
  }
  collected.set(surface.id, items);
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
