#!/usr/bin/env node
// 車站收集小工具（iOS）設定畫面「範圍」選單的名稱守門人。
//
// 要守的事：選單裡「全台＋十個系統」的名稱，開 App 前（沒有 collection.json，走原生目錄）與開 App 後（照抄 payload 的 label，
// 也就是網頁的 COLLECT_SYS）是同一組簡稱；語言跟 App 存的設定（App Group 的 rail.language），沒存才看系統語言。
//
// 🔴 期望值的來源都不是被驗的 Swift：簡稱三語、系統代碼與順序取 index.html 的 COLLECT_SYS（這支腳本直接解析），
//    語言決定的案例手寫，Swift 只回報「查到什麼」。判準與實作同源＝零資訊，所以不從 Swift 或 generator 讀期望值。
//
// 做法：CollectionCard.swift（整檔，連同它依賴的三個檔）加一支小 main 編成 macOS 執行檔，跟 render_collect_widget.mjs 的
// pendingGate 同型。查目錄走出貨的那條路——Bundle.main.path(forResource:ofType:"lproj")；裸執行檔的 Bundle.main 就是
// 執行檔所在目錄，所以把 Localizable.xcstrings 的英日文寫成 en.lproj／ja.lproj 的 Localizable.strings 放在執行檔旁邊
// （Xcode 編譯 xcstrings 也是產出這兩個檔）。
//
// 閘門：
//   r  resolveLanguage 手寫案例：存的語言優先、沒存才看系統語言第一個認得的、zh-* 一律繁中、其餘繁中、存的值不認得當沒存
//   n  沒有 payload 時的選單：三語 × 十一個名稱（全台＋十系統）逐一對 COLLECT_SYS；存值與順序＝COLLECT_SYS 的 k（all 在最前）
//   p  有 payload 時系統名稱照抄 payload（不查目錄）、全台仍走目錄；payload 是空的當沒有檔案
//   f  目錄查不到時退回繁中簡稱（不會露出帶前綴的 key）
//   d  currentLanguage 讀 App Group 的 rail.language（測試用替身 suite），存的優先、沒存看系統語言
//   c  兩份目錄產物（iOS Localizable.xcstrings、Android RailNativeL10n.json）的十一個 key × 英日文對 COLLECT_SYS；全台與卡片標題用的「全台」同值
//   w  靜態（CollectionIntent.swift 要 AppIntents，編不進這支小 main）：選單走 CollectionScopeName.menu＋currentLanguage、
//      有檔案時把 collection.json 的 label 交給它、不再碰 RailNativeL10n；
//      currentLanguage 讀的 suite 名稱與 key 和寫入端（RailLanguagePlugin）、RailNativeL10n 一致
//
// 用法：node app/scripts/verify_collect_scope_names.mjs [--src <小工具原始碼目錄>] [--products <含兩份目錄產物的樹>] [--out <暫存目錄>]
//       node app/scripts/verify_collect_scope_names.mjs --mutation-test [--only M1,M2]   （前後各一次控制組；突變都跑在暫存複本，不動真檔）
// 目錄產物還沒重產（generator 已有新 key、產物落後）時，先用 --products 指到暫存樹重產的結果。

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };

const realSrc = resolve(opt('--src') ?? join(repo, 'app/ios/App/RailBoardWidget'));
const products = resolve(opt('--products') ?? repo);
const outRoot = resolve(opt('--out') ?? join(repo, 'tmp/collect-scope-names'));
const appSrc = join(repo, 'app/ios/App/App');

const XCSTRINGS = 'app/ios/App/RailBoardWidget/Localizable.xcstrings';
const ANDROID_JSON = 'app/android/app/src/main/assets/RailNativeL10n.json';
const PREFIX = '範圍・';
const SWIFT_FILES = ['CollectionCard.swift', 'CollectionOutlineData.swift', 'RailWidgetKit.swift', 'RailNativeL10n.swift'];
const LANGS = ['zh-TW', 'en', 'ja'];

// ── 外部真值 ─────────────────────────────────────────────────────────────────────────
/** index.html 的 COLLECT_SYS（固定順序；label 三語）。找不到或形狀不對就直接丟錯，不拿空表去比。 */
function loadCollectSys() {
  const html = readFileSync(join(repo, 'index.html'), 'utf8');
  const m = html.match(/const COLLECT_SYS = (\[[\s\S]*?\n\]);/);
  if (!m) throw new Error('index.html 找不到 const COLLECT_SYS = [ … ];');
  const sys = vm.runInNewContext(`(${m[1]})`);
  if (!Array.isArray(sys) || sys.length < 2 || sys.some(d => !d.k || LANGS.some(l => !d.label?.[l]))) {
    throw new Error('COLLECT_SYS 的形狀不對（每項要有 k 與 zh-TW／en／ja 三語 label）');
  }
  return sys;
}
const COLLECT_SYS = loadCollectSys();
/** 「全台」沒有 COLLECT_SYS 項（payload 不送全台的名稱）；手寫，並在 c 閘門對卡片標題用的「全台」key。 */
const ALL_NAME = { 'zh-TW': '全台', en: 'All Taiwan', ja: '台湾全体' };
const expectedNames = lang => [ALL_NAME[lang], ...COLLECT_SYS.map(d => d.label[lang])];
const expectedKeys = ['all', ...COLLECT_SYS.map(d => d.k)];
/** 目錄裡該有的 key：前綴＋繁中簡稱（全台＋十系統）。 */
const CATALOG_KEYS = [ALL_NAME['zh-TW'], ...COLLECT_SYS.map(d => d.label['zh-TW'])].map(zh => PREFIX + zh);

// ── 手寫案例 ─────────────────────────────────────────────────────────────────────────
/** [存的語言, 系統語言偏好, 期望]。 */
const RESOLVE_CASES = [
  ['en', ['ja-JP'], 'en'], // 存的優先於系統
  ['zh-TW', ['en-US'], 'zh-TW'],
  ['ja', ['en-US'], 'ja'],
  ['en', [], 'en'],
  [null, ['fr-FR', 'en-US'], 'en'], // 沒存：略過不認得的，取第一個認得的
  [null, ['zh-Hant-TW'], 'zh-TW'],
  [null, ['ja-JP', 'en-US'], 'ja'],
  [null, ['en'], 'en'], // 沒有地區碼也認
  [null, ['ja'], 'ja'],
  [null, [], 'zh-TW'],
  [null, ['fr-FR', 'de-DE'], 'zh-TW'], // 一個都不認得
  [null, ['zh-Hans-CN', 'en-US'], 'zh-TW'], // App 只有繁中；網頁對 zh-* 一律給 zh-TW，不會跳去 en
  ['fr', ['ja-JP'], 'ja'], // 存的值不在白名單＝沒存
  ['', ['en-US'], 'en'],
];
const PAYLOAD = [['tra', '甲'], ['afr', '乙']];
const MISSING_ZH = '不存在的簡稱';
const NAME_CASES = [[MISSING_ZH, 'en', MISSING_ZH], [MISSING_ZH, 'ja', MISSING_ZH], ['台鐵', 'fr', '台鐵'], ['台鐵', 'zh-TW', '台鐵']];
const CURRENT_CASES = [['en', ['ja-JP'], 'en'], [null, ['ja-JP'], 'ja'], ['zh-TW', ['en-US'], 'zh-TW'], ['ja', [], 'ja'], [null, [], 'zh-TW']];

const MAIN_SWIFT = `import Foundation
// 只回報 CollectionScopeName 查到什麼；期望值都在 node。
@main struct Main {
    static func main() {
        let args = CommandLine.arguments
        let spec = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: args[1]))) as! [String: Any]
        var out: [String: Any] = [:]
        out["resolve"] = (spec["resolve"] as! [[Any]]).map { c -> String in
            CollectionScopeName.resolveLanguage(stored: c[0] as? String, preferred: c[1] as! [String])
        }
        out["menus"] = (spec["menus"] as! [[String: Any]]).map { m -> [[String]] in
            let payload = (m["payload"] as? [[String]])?.map { (k: $0[0], label: $0[1]) }
            return CollectionScopeName.menu(payload: payload, language: m["language"] as! String).map { [$0.k, $0.title] }
        }
        out["names"] = (spec["names"] as! [[String]]).map { CollectionScopeName.name($0[0], language: $0[1]) }
        let suiteName = spec["suite"] as! String
        let suite = UserDefaults(suiteName: suiteName)!
        out["current"] = (spec["current"] as! [[Any]]).map { c -> String in
            if let stored = c[0] as? String { suite.set(stored, forKey: "rail.language") } else { suite.removeObject(forKey: "rail.language") }
            return CollectionScopeName.currentLanguage(suite: suite, preferred: c[1] as! [String])
        }
        suite.removePersistentDomain(forName: suiteName)
        try! JSONSerialization.data(withJSONObject: out).write(to: URL(fileURLWithPath: args[2]))
    }
}
`;

// ── 目錄產物 ─────────────────────────────────────────────────────────────────────────
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
/** iOS：xcstrings 的 key → { en, ja }。 */
function xcstringsTable(root) {
  const strings = readJSON(join(root, XCSTRINGS)).strings;
  return Object.fromEntries(Object.entries(strings).map(([k, v]) => [k, {
    en: v.localizations?.en?.stringUnit?.value, ja: v.localizations?.ja?.stringUnit?.value,
  }]));
}
/** Android：RailNativeL10n.json 的 key → { en, ja }。 */
function androidTable(root) {
  const { languages } = readJSON(join(root, ANDROID_JSON));
  const keys = new Set([...Object.keys(languages.en ?? {}), ...Object.keys(languages.ja ?? {})]);
  return Object.fromEntries([...keys].map(k => [k, { en: languages.en?.[k], ja: languages.ja?.[k] }]));
}
const stringsEscape = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

/** 一次完整驗證：回傳 { fails, counts }。 */
function runGate({ src, products: productsRoot, out }) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'bin'), { recursive: true });
  const counts = {};
  const fails = [];
  const check = (gate, name, cond, detail) => {
    counts[gate] ??= { pass: 0, fail: 0 };
    if (cond) counts[gate].pass++;
    else { counts[gate].fail++; fails.push({ gate, name, detail }); }
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // c：兩份目錄產物對 COLLECT_SYS
  const tables = { 'iOS Localizable.xcstrings': xcstringsTable(productsRoot), 'Android RailNativeL10n.json': androidTable(productsRoot) };
  for (const [label, table] of Object.entries(tables)) {
    for (const lang of ['en', 'ja']) {
      const want = expectedNames(lang);
      CATALOG_KEYS.forEach((key, i) => {
        check('c', `${label} ${lang} ${key}`, table[key]?.[lang] === want[i], `${label} 的「${key}」${lang}：實際 ${JSON.stringify(table[key]?.[lang])}，期望 ${JSON.stringify(want[i])}（COLLECT_SYS／手寫全台）`);
      });
    }
    // 全台的選單名稱與卡片標題（RailNativeL10n.text("全台")）要是同一個詞
    for (const lang of ['en', 'ja']) {
      check('c', `${label} ${lang} 全台同值`, table[PREFIX + '全台']?.[lang] === table['全台']?.[lang],
        `${label} 的「${PREFIX}全台」${lang} 是 ${JSON.stringify(table[PREFIX + '全台']?.[lang])}，卡片標題用的「全台」是 ${JSON.stringify(table['全台']?.[lang])}`);
    }
  }

  // w：靜態
  const intent = readFileSync(join(src, 'CollectionIntent.swift'), 'utf8');
  const card = readFileSync(join(src, 'CollectionCard.swift'), 'utf8');
  const plugin = readFileSync(join(appSrc, 'RailLanguagePlugin.swift'), 'utf8');
  const l10n = readFileSync(join(src, 'RailNativeL10n.swift'), 'utf8');
  check('w', 'provider 走 CollectionScopeName.menu', /CollectionScopeName\.menu\(/.test(intent), 'CollectionIntent.swift 的選單沒有呼叫 CollectionScopeName.menu(');
  check('w', 'provider 語言取 currentLanguage()', /language:\s*CollectionScopeName\.currentLanguage\(\)/.test(intent), 'CollectionIntent.swift 沒有用 CollectionScopeName.currentLanguage() 決定語言');
  check('w', 'provider 不碰 RailNativeL10n', !/RailNativeL10n/.test(intent), 'CollectionIntent.swift 又用了 RailNativeL10n：沒存語言時會固定繁中、退回清單走全名');
  check('w', 'provider 有檔案時照抄 payload 的 label', /CollectionStore\.loadShared\(\)\.map\s*\{[^\n]*label:\s*\$0\.label/.test(intent), 'CollectionIntent.swift 沒有把 collection.json 的 sys[].label 交給 CollectionScopeName.menu（有檔案時該照抄網頁當下語言的名稱）');
  const fn = card.match(/static func currentLanguage\([\s\S]*?\n    \}\n/)?.[0] ?? '';
  const suiteOf = t => t.match(/suiteName:\s*"([^"]+)"/)?.[1];
  const keyOf = t => t.match(/forKey:\s*"([^"]+)"/)?.[1];
  check('w', 'currentLanguage 找得到', fn.length > 0, 'CollectionCard.swift 找不到 currentLanguage 函式');
  check('w', 'suite 名稱與寫入端一致', !!suiteOf(plugin) && suiteOf(fn) === suiteOf(plugin), `currentLanguage 的 suite ${suiteOf(fn)}，RailLanguagePlugin 寫的是 ${suiteOf(plugin)}`);
  check('w', 'key 與寫入端一致', !!keyOf(plugin) && keyOf(fn) === keyOf(plugin), `currentLanguage 讀的 key ${keyOf(fn)}，RailLanguagePlugin 寫的是 ${keyOf(plugin)}`);
  check('w', 'key 與 RailNativeL10n 一致', !!keyOf(l10n) && keyOf(fn) === keyOf(l10n), `currentLanguage 讀的 key ${keyOf(fn)}，RailNativeL10n 讀的是 ${keyOf(l10n)}`);

  // 目錄 → en.lproj／ja.lproj（只放「範圍・」那批 key，放在執行檔旁邊）
  const ios = tables['iOS Localizable.xcstrings'];
  for (const lang of ['en', 'ja']) {
    const dir = join(out, 'bin', `${lang}.lproj`);
    mkdirSync(dir, { recursive: true });
    const body = CATALOG_KEYS.filter(k => typeof ios[k]?.[lang] === 'string').map(k => `"${stringsEscape(k)}" = "${stringsEscape(ios[k][lang])}";`).join('\n');
    writeFileSync(join(dir, 'Localizable.strings'), body + '\n');
  }

  // 編譯、執行
  const suite = `i6.collect.scope.test.${process.pid}`;
  const spec = {
    resolve: RESOLVE_CASES.map(([stored, preferred]) => [stored, preferred]),
    menus: [
      ...LANGS.map(language => ({ payload: null, language })),
      { payload: PAYLOAD, language: 'en' }, { payload: PAYLOAD, language: 'zh-TW' },
      { payload: [], language: 'ja' },
    ],
    names: NAME_CASES.map(([zh, lang]) => [zh, lang]),
    suite,
    current: CURRENT_CASES.map(([stored, preferred]) => [stored, preferred]),
  };
  writeFileSync(join(out, 'spec.json'), JSON.stringify(spec));
  writeFileSync(join(out, 'main.swift'), MAIN_SWIFT);
  const bin = join(out, 'bin/scopenames');
  execFileSync('swiftc', ['-parse-as-library', join(out, 'main.swift'), ...SWIFT_FILES.map(f => join(src, f)), '-o', bin], { stdio: 'inherit' });
  execFileSync(bin, [join(out, 'spec.json'), join(out, 'results.json')], { stdio: 'inherit' });
  rmSync(join(homedir(), 'Library/Preferences', `${suite}.plist`), { force: true });
  const got = readJSON(join(out, 'results.json'));

  RESOLVE_CASES.forEach(([stored, preferred, want], i) => {
    check('r', `resolve ${JSON.stringify([stored, preferred])}`, got.resolve?.[i] === want, `resolveLanguage(stored: ${JSON.stringify(stored)}, preferred: ${JSON.stringify(preferred)})：實際 ${got.resolve?.[i]}，期望 ${want}`);
  });
  LANGS.forEach((lang, i) => {
    const menu = got.menus?.[i] ?? [];
    check('n', `${lang} 存值與順序`, same(menu.map(x => x[0]), expectedKeys), `${lang} 選單的存值 ${JSON.stringify(menu.map(x => x[0]))}，期望 ${JSON.stringify(expectedKeys)}（COLLECT_SYS 的順序，all 在最前）`);
    const want = expectedNames(lang);
    check('n', `${lang} 項數`, menu.length === want.length && want.length === COLLECT_SYS.length + 1, `${lang} 選單 ${menu.length} 項，期望 ${want.length} 項`);
    want.forEach((name, j) => {
      check('n', `${lang} ${expectedKeys[j]}`, menu[j]?.[1] === name, `${lang} 選單的「${expectedKeys[j]}」：實際 ${JSON.stringify(menu[j]?.[1])}，期望 ${JSON.stringify(name)}`);
    });
  });
  const pEn = got.menus?.[3], pZh = got.menus?.[4], pEmpty = got.menus?.[5];
  check('p', 'en 有 payload', same(pEn, [['all', ALL_NAME.en], ...PAYLOAD]), `有 payload（en）：實際 ${JSON.stringify(pEn)}，期望全台查目錄、系統照抄 ${JSON.stringify(PAYLOAD)}`);
  check('p', 'zh-TW 有 payload', same(pZh, [['all', ALL_NAME['zh-TW']], ...PAYLOAD]), `有 payload（zh-TW）：實際 ${JSON.stringify(pZh)}`);
  check('p', 'payload 空陣列＝沒有檔案', same(pEmpty, got.menus?.[2]) && pEmpty?.length === COLLECT_SYS.length + 1, `payload 是 [] 時（ja）：實際 ${JSON.stringify(pEmpty)}，應與沒有 payload 的選單相同`);
  NAME_CASES.forEach(([zh, lang, want], i) => {
    check('f', `name ${zh}／${lang}`, got.names?.[i] === want, `name(${JSON.stringify(zh)}, language: ${JSON.stringify(lang)})：實際 ${JSON.stringify(got.names?.[i])}，期望 ${JSON.stringify(want)}（目錄查不到要退回繁中簡稱）`);
  });
  CURRENT_CASES.forEach(([stored, preferred, want], i) => {
    check('d', `current ${JSON.stringify([stored, preferred])}`, got.current?.[i] === want, `currentLanguage（rail.language=${JSON.stringify(stored)}，系統 ${JSON.stringify(preferred)}）：實際 ${got.current?.[i]}，期望 ${want}`);
  });
  return { fails, counts };
}

const GATES = ['r', 'n', 'p', 'f', 'd', 'c', 'w'];
const summarize = counts => GATES.map(g => `${g} ${counts[g]?.pass ?? 0}/${(counts[g]?.pass ?? 0) + (counts[g]?.fail ?? 0)}`).join('  ');

// ── 突變 ─────────────────────────────────────────────────────────────────────────────
// 每個突變一處（或一組）文字替換，錨點在該檔必須恰好出現 1 次；expect＝要紅的閘門。
const CARD = 'CollectionCard.swift';
const MUTATIONS = [
  { id: 'M1 resolveLanguage 不認日文', expect: ['r', 'd'], edits: [{ file: CARD, find: 'if v == "ja" || v.hasPrefix("ja-") { return "ja" }\n', replace: '' }] },
  { id: 'M2 優先序反過來（先看系統語言）', expect: ['r'], edits: [
    { file: CARD, find: '        if let stored, ["zh-TW", "en", "ja"].contains(stored) { return stored }\n        for tag in preferred {', replace: '        for tag in preferred {' },
    { file: CARD, find: '        return "zh-TW"\n    }\n\n    /// 設定畫面現在該用的語言。', replace: '        if let stored, ["zh-TW", "en", "ja"].contains(stored) { return stored }\n        return "zh-TW"\n    }\n\n    /// 設定畫面現在該用的語言。' },
  ] },
  { id: 'M3 存的值不驗白名單', expect: ['r'], edits: [{ file: CARD, find: 'if let stored, ["zh-TW", "en", "ja"].contains(stored) { return stored }', replace: 'if let stored, !stored.isEmpty { return stored }' }] },
  { id: 'M4 zh-Hans 不當繁中', expect: ['r'], edits: [{ file: CARD, find: 'if v == "zh-tw" || v == "zh-hant" || v.hasPrefix("zh-") { return "zh-TW" }', replace: 'if v == "zh-tw" || v == "zh-hant" || v.hasPrefix("zh-hant") { return "zh-TW" }' }] },
  { id: 'M5 查目錄只查英文（少一個語言）', expect: ['n'], edits: [{ file: CARD, find: 'guard language != "zh-TW",\n              let path', replace: 'guard language == "en",\n              let path' }] },
  { id: 'M6 某系統的繁中簡稱拼錯（高捷→高接）', expect: ['n'], edits: [{ file: CARD, find: '("krtc", "高捷")', replace: '("krtc", "高接")' }] },
  { id: 'M7 某系統的代碼拼錯（krtc→krtv）', expect: ['n'], edits: [{ file: CARD, find: '("krtc", "高捷")', replace: '("krtv", "高捷")' }] },
  { id: 'M8 全台不查目錄', expect: ['n'], edits: [{ file: CARD, find: '[(CollectionScope.allKey, name(allTaiwan, language: language))]', replace: '[(CollectionScope.allKey, allTaiwan)]' }] },
  { id: 'M9 有 payload 也用退回清單', expect: ['p'], edits: [{ file: CARD, find: 'if let payload, !payload.isEmpty {', replace: 'if let payload, payload.count > 99 {' }] },
  { id: 'M10 payload 空陣列也照抄（選單只剩全台）', expect: ['p'], edits: [{ file: CARD, find: 'if let payload, !payload.isEmpty {', replace: 'if let payload {' }] },
  { id: 'M11 目錄查不到時露出帶前綴的 key', expect: ['f'], edits: [{ file: CARD, find: 'return value == key ? zh : value', replace: 'return value' }] },
  { id: 'M12 currentLanguage 讀錯 key', expect: ['d', 'w'], edits: [{ file: CARD, find: 'suite?.string(forKey: "rail.language")', replace: 'suite?.string(forKey: "rail.lang")' }] },
  { id: 'M13 currentLanguage 不看存的語言', expect: ['d'], edits: [{ file: CARD, find: 'resolveLanguage(stored: suite?.string(forKey: "rail.language"), preferred: preferred)', replace: 'resolveLanguage(stored: nil, preferred: preferred)' }] },
  { id: 'M14 選單語言改回 RailNativeL10n.language', expect: ['w'], edits: [{ file: 'CollectionIntent.swift', find: 'language: CollectionScopeName.currentLanguage()', replace: 'language: RailNativeL10n.language' }] },
  { id: 'M15 選單不走 CollectionScopeName.menu', expect: ['w'], edits: [{ file: 'CollectionIntent.swift', find: 'CollectionScopeName.menu(payload: payload,', replace: 'CollectionScopeName.menuOld(payload: payload,' }] },
  { id: 'M20 currentLanguage 的 App Group 名稱拼錯', expect: ['w'], edits: [{ file: CARD, find: 'UserDefaults(suiteName: "group.tw.railisland.app")', replace: 'UserDefaults(suiteName: "group.tw.railisland.apps")' }] },
  { id: 'M21 選單永遠不讀 collection.json（payload 恆 nil）', expect: ['w'], edits: [{ file: 'CollectionIntent.swift', find: 'let payload = CollectionStore.loadShared().map { $0.sys.map { (k: $0.k, label: $0.label) } }', replace: 'let payload: [(k: String, label: String)]? = nil' }] },
  // 以下改的是目錄產物：Swift 端與靜態檢查不動，考 c 與 n 對目錄的防線
  { id: 'M16 目錄少日文（十一個 key 都沒有 ja）', expect: ['c', 'n'], catalog: table => { for (const k of CATALOG_KEYS) delete table[k].ja; } },
  { id: 'M17 目錄某個 key 拼錯（範圍・高捷→範圍・高接）', expect: ['c', 'n'], catalog: table => { table['範圍・高接'] = table['範圍・高捷']; delete table['範圍・高捷']; } },
  { id: 'M18 目錄某個值不是簡稱而是全名（Kaohsiung→Kaohsiung Metro）', expect: ['c', 'n'], catalog: table => { table['範圍・高捷'].en = 'Kaohsiung Metro'; } },
  { id: 'M19 目錄的全台與卡片標題用的全台不同值', expect: ['c'], catalog: table => { table['範圍・全台'].en = 'Taiwan'; } },
];

/** 把 table（key → {en, ja}）改完寫回 xcstrings 與 Android JSON 的複本。兩份都改，閘門不會因為少改一份而假綠。 */
function stageProducts(dest, mutate) {
  rmSync(dest, { recursive: true, force: true });
  const xc = readJSON(join(products, XCSTRINGS));
  const js = readJSON(join(products, ANDROID_JSON));
  // 改動用的視圖（key → { en, ja }）：先收集目前值，mutate 改完，再寫回兩份產物
  const view = {};
  for (const k of [...CATALOG_KEYS, '全台']) view[k] = { en: xc.strings[k]?.localizations?.en?.stringUnit?.value, ja: xc.strings[k]?.localizations?.ja?.stringUnit?.value };
  mutate(view);
  for (const k of CATALOG_KEYS) { delete xc.strings[k]; delete js.languages.en[k]; delete js.languages.ja[k]; }
  for (const [k, v] of Object.entries(view)) {
    xc.strings[k] = { extractionState: 'manual', localizations: {} };
    for (const lang of ['en', 'ja']) {
      if (typeof v[lang] !== 'string') continue;
      xc.strings[k].localizations[lang] = { stringUnit: { state: 'translated', value: v[lang] } };
      js.languages[lang][k] = v[lang];
    }
  }
  for (const [rel, data] of [[XCSTRINGS, xc], [ANDROID_JSON, js]]) {
    mkdirSync(dirname(join(dest, rel)), { recursive: true });
    writeFileSync(join(dest, rel), JSON.stringify(data));
  }
}

function stageSource(dest, mutation) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const f of [...SWIFT_FILES, 'CollectionIntent.swift']) cpSync(join(realSrc, f), join(dest, f));
  for (const e of mutation?.edits ?? []) {
    const path = join(dest, e.file);
    const text = readFileSync(path, 'utf8');
    const hits = text.split(e.find).length - 1;
    if (hits !== 1) throw new Error(`突變「${mutation.id}」的錨點在 ${e.file} 出現 ${hits} 次（要恰好 1 次）：${e.find}`);
    writeFileSync(path, text.replace(e.find, () => e.replace));
  }
}

function main() {
  mkdirSync(outRoot, { recursive: true });
  if (!flag('--mutation-test')) {
    for (const f of [...SWIFT_FILES, 'CollectionIntent.swift']) if (!existsSync(join(realSrc, f))) throw new Error(`找不到 ${join(realSrc, f)}`);
    const { fails, counts } = runGate({ src: realSrc, products, out: join(outRoot, 'run') });
    console.log(summarize(counts));
    if (fails.length) {
      console.error(`\n閘門紅 ${fails.length} 條：`);
      for (const f of fails.slice(0, 40)) console.error(` ✗ [${f.gate}] ${f.name}：${f.detail}`);
      process.exit(1);
    }
    console.log('閘門全綠。');
    return;
  }
  const only = opt('--only')?.split(',');
  const report = [];
  const run = (label, src, productsRoot) => runGate({ src, products: productsRoot, out: join(outRoot, label) });
  const control = label => {
    stageSource(join(outRoot, 'mut-src-control'), null);
    const { fails, counts } = run(`mut-${label}`, join(outRoot, 'mut-src-control'), products);
    report.push({ id: `控制組（${label}）`, red: [...new Set(fails.map(f => f.gate))], ok: fails.length === 0, summary: summarize(counts), sample: fails.slice(0, 3), failCount: fails.length });
    return fails.length === 0;
  };
  let allOk = control('before');
  for (const m of MUTATIONS.filter(x => !only || only.includes(x.id.split(' ')[0]))) {
    const tag = m.id.split(' ')[0];
    let src = join(outRoot, 'mut-src');
    let productsRoot = products;
    if (m.catalog) {
      stageSource(src, null);
      productsRoot = join(outRoot, 'mut-products');
      stageProducts(productsRoot, m.catalog);
    } else {
      stageSource(src, m);
    }
    let result;
    try {
      result = run(`mut-${tag}`, src, productsRoot);
    } catch (e) { // 編譯失敗＝突變本身無效，不是「被抓到」
      allOk = false;
      report.push({ id: m.id, expect: m.expect, red: [], ok: false, summary: '', sample: [{ gate: '-', name: '突變後無法編譯或執行', detail: String(e.message).split('\n')[0] }], failCount: 0 });
      continue;
    }
    const { fails, counts } = result;
    const red = [...new Set(fails.map(f => f.gate))];
    const detected = m.expect.every(g => red.includes(g));
    allOk = allOk && detected;
    const byGate = g => fails.filter(f => f.gate === g).length;
    report.push({ id: m.id, expect: m.expect, red, ok: detected, summary: summarize(counts), sample: fails.filter(f => m.expect.includes(f.gate)).slice(0, 2), failCount: fails.length, byGate: Object.fromEntries(red.map(g => [g, byGate(g)])) });
  }
  allOk = control('after') && allOk;
  for (const r of report) {
    console.log(`${r.ok ? '✓' : '✗'} ${r.id}${r.expect ? `（要紅 ${r.expect.join('、')}）` : '（要全綠）'} → 紅的閘門：${r.red.length ? r.red.map(g => `${g}${r.byGate ? `×${r.byGate[g]}` : ''}`).join('、') : '無'}（共 ${r.failCount} 條）`);
    console.log(`    ${r.summary}`);
    for (const s of r.sample ?? []) console.log(`    · [${s.gate}] ${s.name}：${s.detail}`);
  }
  writeFileSync(join(outRoot, 'mutation-report.json'), JSON.stringify(report, null, 2));
  console.log(allOk ? '\n突變測試通過：每個突變都被指名的閘門抓到，控制組（前後）全綠。' : '\n突變測試失敗。');
  process.exit(allOk ? 0 : 1);
}

main();
