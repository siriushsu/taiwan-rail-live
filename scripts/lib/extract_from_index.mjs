// 從 index.html 的主 script 切出頂層宣告的【原始碼文字】，供離線腳本在 vm 沙箱裡執行。
//
// 為什麼是「切原始碼」而不是「另外寫一份」：位置模型（buildObsProfile／speedZoneKnots／
// assignRunProfiles…）是全站最容易靜默出錯的一塊，維護兩份實作等於保證兩份會漂移。
// 切原始碼則是【定義上不可能漂移】——離線算的與瀏覽器跑的是同一段文字。
//
// 🔴 切法必須守住兩件事，否則會靜默切錯（曾踩過：大括號配對法把後面的宣告一起吞進來，
// 同一個函式在沙箱裡被定義兩次，突變打到被遮蔽的那一份 ⇒ 測試對修改無感）：
//   1. 邊界只認「行首第一個字元」。index.html 的主 script 裡，頂層宣告一律頂格，
//      巢狀內容一律有縮排，函式的收尾 `}` 也頂格但不是字母 ⇒ 下一個「行首是字母或註解」
//      的行就是下一個頂層宣告的開頭。
//   2. 切完要驗：切出來的文字【本身是合法的完整 JS】，且該名字在最終沙箱原始碼裡
//      【恰好宣告一次】。合法性用真的 JS 解析器驗，不要自己數括號——PERF_RULES 裡
//      `/\(太/` 這種正則字面的括號本來就不配對，手寫的配對檢查會誤判（實際踩過）。
//      反過來「切太短」會讓構造殘缺 ⇒ 一樣是語法錯，同一道閘門就擋住了。
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const DECL_RE = /^(?:async\s+function|function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
// 下一個頂層宣告的起點：行首是字母（宣告或裸述句）或註解。`}`、`)` 、空行、縮排行都不算。
const NEXT_TOP_RE = /^[A-Za-z/]/;

export function loadIndexSource(path) {
  return readFileSync(path, 'utf8').split('\n');
}

// 回傳 name → { start, end, text }（end 為不含的行索引）
export function indexDeclarations(lines) {
  const decls = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = DECL_RE.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && !NEXT_TOP_RE.test(lines[j])) j++;
    // 只有第一次出現才記；重複名字（不同 scope 的同名函式）留給下面的 assert 抓
    if (!decls.has(m[1])) decls.set(m[1], { start: i, end: j, text: lines.slice(i, j).join('\n') });
  }
  return decls;
}

function parses(text) {
  try { new Script(text); return true; } catch { return false; }
}

// 取出指定名稱的宣告，串成一段沙箱原始碼。缺任何一個、或切出來不平衡、或某個名字在
// 成品裡宣告超過一次，都直接拋——寧可停在這裡，也不要讓離線結果悄悄跟前端不同。
export function extract(lines, names) {
  const decls = indexDeclarations(lines);
  const missing = names.filter(n => !decls.has(n));
  if (missing.length) throw new Error('index.html 裡找不到這些頂層宣告：' + missing.join(', '));
  const parts = [];
  for (const n of names) {
    const d = decls.get(n);
    if (!parses(d.text)) throw new Error(`切出來的 ${n} 不是合法完整的 JS（第 ${d.start + 1}–${d.end} 行）——切法要修，不要放行`);
    parts.push(d.text);
  }
  const src = parts.join('\n');
  for (const n of names) {
    const re = new RegExp(`^(?:async\\s+function|function|const|let|var|class)\\s+${n}\\b`, 'gm');
    const hits = (src.match(re) || []).length;
    if (hits !== 1) throw new Error(`${n} 在沙箱原始碼裡宣告了 ${hits} 次（必須恰好 1 次）——切法吞掉了相鄰宣告`);
  }
  return src;
}
