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
  const local = {};
  vm.createContext(local);
  vm.runInContext(`${source.slice(start, end)}\nglobalThis.__out = { ${names.join(', ')} };`, local);
  return local.__out || {};
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
  if (e.type === 'regex')
    return [...source.matchAll(new RegExp(e.pattern, 'g'))].map(m => m[e.group]);
  if (e.type === 'constBlock') {
    const block = evaluateConstBlock(source, e.start, e.end, e.names);
    return block === null ? null : flattenStrings(block);
  }
  if (e.type === 'controls') return extractControls(source);
  if (e.type === 'controlsDynamic') return extractControlsDynamic(source);
  return null;
}

// ── S0：surface 覆蓋率斷言 ────────────────────────────────────────────────
// 擋的是「宣告了卻定位失敗」(標記被改壞、檔案改名、區塊被刪)。
// 🔴 擋不了「根本沒宣告」——新增一個全新的對外文字容器而沒登記進 surfaces[],
//    S0 對它一無所知。所以下面一定要把「掃了哪幾個、各幾條」印出來,
//    讓漏登記在人眼前顯形。「S0 綠」≠「所有對外文字都驗過了」。
const collected = new Map();
for (const surface of spec.surfaces) {
  const items = collect(surface);
  if (items === null) {
    const fileLabel = Array.isArray(surface.file) ? surface.file.join('、') : surface.file;
    fail(`S0 surface「${surface.id}」定位失敗——${fileLabel} 裡找不到抽取標記,這一塊完全沒被驗到`);
    continue;
  }
  if (items.length < surface.minCount) {
    fail(`S0 surface「${surface.id}」只抓到 ${items.length} 條,低於下限 ${surface.minCount}——抽取式可能已失效`);
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
