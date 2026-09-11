#!/usr/bin/env node
// 驗「最近站解析共用層」——捷運、台鐵、(單元 C 之後的)公車三個小工具共吃的那一層。
//
// 用法：JAVA_HOME=/opt/homebrew/opt/openjdk@21 node app/scripts/verify_widget_nearest.mjs
//
// 分三組：
//   R/S/K 組｜受測物 = 真的會出貨的 Java(WidgetNearestMath，javac 單獨編、單獨跑)。
//            它一個 android.* 都沒 import 就是為了這件事——服務範圍的比較、三態判定、
//            快取的記/清、退快取旗標，改版前【只有真機看得到】＝等於沒有人驗過。
//   D 組｜半徑單一來源：資料檔 === 本檔的期望表 === Android 真的算出來的值。
//        iOS 那一半在 verify_metro_nearest.mjs（那支要 swiftc，刻意不混在一起，
//        少一個工具鏈就整支跑不動的話兩邊都驗不到）。
//   W 組｜接線的靜態斷言：定位入口只有一個、資料檔真的會被複製進 Android assets、
//        兩端原始碼裡沒有殘留的半徑字面值。
//
// 🔴 本檔的期望表 EXPECT 是【刻意的第四份】，與被驗的三方都不同源。只改資料檔而沒改這裡，
//    D 組會紅——這兩個半徑是對站點密度實算出來的天然斷點，不該被順手改掉（要改就兩邊一起改，
//    而那一刻你會被迫看到這段註解）。判準與實作同源時「相等」是零資訊。
//
// 🔴 突變靶：WidgetNearestMath.inRange 的 `<=`。把它改成 `>=` 要讓
//    R1（門檻內側）與 R2（門檻外側）同時紅——兩顆探針除了距離之外逐格相同，
//    少了任何一側，「乾脆全部放行」與「乾脆全部擋掉」都能全綠。
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../..');
const ANDROID = join(ROOT, 'app/android/app/src/main/java/tw/railisland/app');
const DATA_PATH = join(ROOT, 'app/ios/App/RailBoardWidget/MetroWidgetData.json');

// 判準側的期望值（見檔頭：刻意的第四份）。
const EXPECT = { metro: 12000, rail: 5000 };

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};
const read = p => readFileSync(p, 'utf8');

// 🔴 靜態斷言一律掃【去掉註解】的原始碼。第一次跑這支腳本時 W3 就是紅的,而兩處命中都在
//    javadoc 裡（「改版前這裡自己讀 getLastKnownLocation…」）——記錄病史的註解被當成病灶本身。
//    純字串掃描對「這行會不會執行」完全失明,而註解正是最常提到舊寫法的地方。
//    逐字元走是因為 /\/\/.*$/ 會吃掉字串裡的 http:// 與註解符號。
const code = src => {
  let out = '', i = 0, str = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (str) {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === str) str = null;
      out += c; i += 1; continue;
    }
    if (c === '"' || c === "'") { str = c; out += c; i += 1; continue; }
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i += 1; }
      i += 2; continue;
    }
    out += c; i += 1;
  }
  return out;
};
const readCode = p => code(read(p));

// ── D 組：半徑單一來源 ────────────────────────────────────────────────────────
const data = JSON.parse(read(DATA_PATH));
const radii = data.serviceRadii;
ok('D0 產物有 serviceRadii', !!radii && typeof radii === 'object', JSON.stringify(radii));
for (const [modality, expect] of Object.entries(EXPECT)) {
  ok(`D1 資料檔 serviceRadii.${modality} === 判準表 ${expect}`,
     radii && radii[modality] === expect, `資料檔=${radii && radii[modality]}`);
}
// 公車的值屬單元 C（要對站牌密度實算）。實算之前資料檔裡不准有 bus——有了兩端就會讀去用。
ok('D2 公車半徑尚未填入（單元 C 實算前不准猜一個）',
   !radii || radii.bus === undefined, `bus=${radii && radii.bus}`);

// ── W 組：接線（靜態） ───────────────────────────────────────────────────────
const nearestGlue = readCode(join(ANDROID, 'WidgetNearest.java'));
const nearestMath = read(join(ANDROID, 'WidgetNearestMath.java'));  // 原文：要編譯它
const gradle = readCode(join(ROOT, 'app/android/app/build.gradle'));

// 純層的前提：一旦開始 import android.*，這支腳本的「javac 編得起來」就不成立，
// 而症狀會是一堆看不懂的編譯錯誤，不是「前提壞了」。
ok('W0 WidgetNearestMath 仍然零 android.* 相依（本腳本的前提）',
   !/^import\s+android/m.test(code(nearestMath)));
ok('W1 Android 從產物讀 serviceRadii（不是寫死）',
   /getAssets\(\)\.open\("MetroWidgetData\.json"\)/.test(nearestGlue)
   && /optJSONObject\("serviceRadii"\)/.test(nearestGlue));
// 那份產物是 iOS 與 Android 共用的同一個檔；gradle 的 Copy task 斷掉時 Android 會讀到
// 不存在的 asset ⇒ 半徑 0 ⇒ 全部落在範圍外，而程式碼一行都沒變。
ok('W2 build.gradle 仍把 iOS 那份 MetroWidgetData.json 複製進 assets',
   /syncMetroWidgetData/.test(gradle)
   && /ios\/App\/RailBoardWidget\/MetroWidgetData\.json/.test(gradle));

// 定位入口只有一個：改版前是兩支小工具各讀一次 getLastKnownLocation，
// 所以「Android 從來沒主動要過定位」這個病要修兩次（而只修了零次）。
const locationUsers = ['MetroWidgetData.java', 'RailWidgetData.java', 'MetroWidgetProvider.java',
                       'RailBoardWidgetProvider.java', 'MixedBoardWidgetProvider.java']
  .filter(f => /getLastKnownLocation/.test(readCode(join(ANDROID, f))));
ok('W3 getLastKnownLocation 只在共用層出現（三個小工具不各讀一次）',
   locationUsers.length === 0, `仍在讀：${locationUsers.join('、')}`);
ok('W3b 共用層確實是那個唯一入口（反向對照：它自己要有）',
   /getLastKnownLocation/.test(nearestGlue));

// ── 前景取位鏈（issue #55 的修法本體）─────────────────────────────────────────
// 🔴 這一條鏈整條都在 javac 跑不到的地方（Context／SharedPreferences／WebView／Capacitor 橋），
//    但它斷掉的症狀正是 issue #55 本身：小工具永遠拿不到新座標，而 App 一切正常、build 全綠。
//    所以至少要有靜態斷言把「每一個接頭都還接著」釘住——斷一節就紅一條，而不是等使用者回報。
// 🔴 斷言逐節寫、不合成一條：合成的話紅起來只知道「鏈斷了」，不知道斷在 JS、橋、還是原生。
const html = read(join(ROOT, 'index.html'));
const bridgeSrc = readCode(join(ROOT, 'app/src/native-bridge.mjs'));
const plugin = readCode(join(ANDROID, 'RailPlacesPlugin.java'));
// 🔴 只量 fix() 的【方法本體】，不量整個檔案。這一條是突變測試打出來的：第一版斷言寫成
//    「檔案裡有沒有 RailBoardWidgetProvider.updateAll」，而同一個檔案裡的既有 sync() 本來就
//    三顆都刷——所以把 fix() 裡那一行整個刪掉，G4 照樣全綠。判準沒有先回答「我在量的是誰」。
const methodBody = (src, header) => {
  const i = src.indexOf(header);
  if (i < 0) return '';
  const open = src.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < src.length; j += 1) {
    if (src[j] === '{') depth += 1;
    else if (src[j] === '}') { depth -= 1; if (!depth) return src.slice(open, j + 1); }
  }
  return '';
};
const fixBody = methodBody(plugin, 'public void fix(PluginCall call)');
ok('G1 前景定位真的會推給原生（acceptGeoFix 裡呼叫，沿用既有節流）',
   /function pushNativeGeoFix\(/.test(html)
   && /saveGeoCache\([^\n]*\);\s*\n\s*pushNativeGeoFix\(/.test(html));
ok('G2 橋有 fix（且只在 Android 註冊：iOS 小工具自己會取位，註冊只會每次拋 not implemented）',
   /fix:\s*platform === 'android'\s*\?/.test(bridgeSrc)
   && /RailPlaces\.fix\(\{\s*lat,\s*lon,\s*at\s*\}\)/.test(bridgeSrc));
ok('G0 抽得到 fix() 的方法本體（G3–G5 的前提；抽不到的話它們紅得沒有道理）',
   fixBody.length > 0 && fixBody.includes('call.resolve'), `len=${fixBody.length}`);
ok('G3 原生端 fix() 是 @PluginMethod 並寫進共用層',
   /@PluginMethod\s+public void fix\(PluginCall call\)/.test(plugin)
   && /WidgetNearest\.rememberFix\(getContext\(\)/.test(fixBody));
// 🔴 三個小工具都要刷新。只刷捷運那顆的話，台鐵／混合卡會一直等到系統下一次排程才更新，
//    而使用者的動作（開 App）與畫面變化之間就沒有因果關係可言了。
for (const provider of ['MetroWidgetProvider', 'RailBoardWidgetProvider', 'MixedBoardWidgetProvider']) {
  ok(`G4 收到座標後刷新 ${provider}`,
     new RegExp(`${provider}\\.updateAll\\(getContext\\(\\)\\)`).test(fixBody));
}
// 反向對照：時戳要用 WebView 量到的那一刻，不是原生收到的那一刻——
// 拿收到時間當時戳，過期的座標會被永遠續命成「剛剛量的」，新鮮度窗就形同不存在。
ok('G5 時戳取自呼叫端帶進來的量測時間（只有缺值才退回現在）',
   /call\.getLong\("at"/.test(fixBody) && /if \(at <= 0\) at = System\.currentTimeMillis\(\);/.test(fixBody));

// 兩端原始碼都不准再出現半徑字面值。
const swiftNearest = readCode(join(ROOT, 'app/ios/App/RailBoardWidget/MetroNearest.swift'));
const swiftPlaces = readCode(join(ROOT, 'app/ios/App/RailBoardWidget/RailBoardData.swift'));
ok('W4 iOS 捷運半徑從資料讀，不是字面值',
   /serviceRadiusMeters[^\n]*WidgetServiceRadius\.meters/.test(swiftNearest)
   && !/static let serviceRadiusMeters\s*=\s*[0-9]/.test(swiftNearest));
ok('W5 iOS 台鐵「我的地點」半徑從資料讀，不是字面值',
   /maximumDistanceMeters[\s\S]{0,120}WidgetServiceRadius\.meters/.test(swiftPlaces)
   && !/maximumDistanceMeters\s*=\s*[0-9]/.test(swiftPlaces));
const railData = readCode(join(ANDROID, 'RailWidgetData.java'));
ok('W6 Android 台鐵「我的地點」半徑從資料讀，不是字面值',
   /WidgetNearest\.radiusMeters\(context, WidgetNearestMath\.RAIL\)/.test(railData)
   && !/PLACE_MAX_METERS\s*=\s*[0-9]/.test(railData));
// 哨兵字面值也只准一份（改版前 MetroWidgetData 與 RailWidgetData 各寫死一個 "__auto__"）。
const autoLiterals = ['MetroWidgetData.java', 'RailWidgetData.java', 'MetroWidgetProvider.java',
                      'MixedBoardWidgetProvider.java', 'WidgetNearestMath.java']
  .filter(f => /"__auto__"/.test(readCode(join(ANDROID, f))));
ok('W7 "__auto__" 字面值只有一份（在純層）',
   autoLiterals.length === 1 && autoLiterals[0] === 'WidgetNearestMath.java', autoLiterals.join('、'));

// ── 組 Java harness、編譯、執行 ───────────────────────────────────────────────
// 探針的期望值在 JS 側【獨立算】（不呼叫 Java），Java 只負責輸出它自己的答案。
const RADIUS = EXPECT.metro;
const probes = [
  // R 組：服務範圍。兩顆邊界探針除了距離之外逐格相同 ⇒ 這是 inRange 的突變靶。
  { id: 'R1', name: `門檻內側 ${RADIUS - 100}m`, meters: RADIUS - 100, radius: RADIUS,
    fresh: true, hit: true, cached: null, expect: 'serviceable' },
  { id: 'R2', name: `門檻外側 ${RADIUS + 100}m`, meters: RADIUS + 100, radius: RADIUS,
    fresh: true, hit: true, cached: null, expect: 'outOfRange' },
  { id: 'R3', name: '門檻上恰好相等（<= 的等號那一邊）', meters: RADIUS, radius: RADIUS,
    fresh: true, hit: true, cached: null, expect: 'serviceable' },
  { id: 'R4', name: '半徑 0（資料檔沒接上）⇒ 一律範圍外，壞得看得見', meters: 1, radius: 0,
    fresh: true, hit: true, cached: null, expect: 'outOfRange' },
  // S 組：三態與退快取。
  { id: 'S1', name: '定位過期＋有快取 ⇒ 退快取並標示', meters: 100, radius: RADIUS,
    fresh: false, hit: true, cached: 'trtc|台北車站', expect: 'cache' },
  { id: 'S2', name: '定位過期＋沒快取 ⇒ 還不知道你在哪', meters: 100, radius: RADIUS,
    fresh: false, hit: true, cached: null, expect: 'none' },
  { id: 'S3', name: '沒有定位＋有快取 ⇒ 退快取並標示', meters: 0, radius: RADIUS,
    fresh: null, hit: false, cached: 'krtc|美麗島', expect: 'cache' },
  { id: 'S4', name: '沒有定位＋沒快取 ⇒ 還不知道你在哪', meters: 0, radius: RADIUS,
    fresh: null, hit: false, cached: null, expect: 'none' },
  { id: 'S5', name: '定位新鮮但目錄掃不到站 ⇒ 退快取', meters: 0, radius: RADIUS,
    fresh: true, hit: false, cached: 'trtc|動物園', expect: 'cache' },
  // K 組：範圍外清快取的正反對照（反向判準一定要配正向對照）。
  { id: 'K1', name: '範圍外＋有快取 ⇒ 仍判範圍外，而且要清快取', meters: RADIUS + 5000,
    radius: RADIUS, fresh: true, hit: true, cached: 'trtc|台北車站', expect: 'outOfRange' },
  { id: 'K2', name: '範圍內＋有快取 ⇒ 不清快取（K1 的正向對照）', meters: 10, radius: RADIUS,
    fresh: true, hit: true, cached: 'trtc|台北車站', expect: 'serviceable' },
];

// JS 側獨立實作的判定（判準，不碰 Java）。
const judge = p => {
  const freshFix = p.fresh === true;
  if (!freshFix || !p.hit) {
    return p.cached
      ? { kind: 'cache', key: p.cached, stale: true, clear: false }
      : { kind: 'none', key: null, stale: false, clear: false };
  }
  return p.meters <= p.radius
    ? { kind: 'serviceable', key: 'HIT', stale: false, clear: false }
    : { kind: 'outOfRange', key: null, stale: false, clear: true };
};

const linkProbes = [
  { id: 'L1', sys: 'trtc', station: '台北車站', expect: true, name: '解析出站 ⇒ 深連結帶站' },
  { id: 'L2', sys: 'trtc', station: '__auto__', expect: false, name: '哨兵 ⇒ 深連結不帶站' },
  { id: 'L3', sys: 'trtc', station: '', expect: false, name: '空站名 ⇒ 不帶' },
  { id: 'L4', sys: null, station: '台北車站', expect: false, name: '沒有系統 ⇒ 不帶' },
];

const kmProbes = [
  { id: 'M1', meters: 12000.0, expect: '12', name: '整數公里不進位' },
  { id: 'M2', meters: 12001.0, expect: '13', name: '超過一點點就進位（四捨五入會印出門檻值本身）' },
  { id: 'M3', meters: 12499.0, expect: '13', name: '四捨五入會給 12，這裡必須是 13' },
];

const java = (v) => JSON.stringify(String(v)).replace(/\$/g, '\\$');
const gate = `package tw.railisland.app;

import java.util.HashMap;
import java.util.Map;

public final class NearestGate {
    static final long NOW = 1_700_000_000_000L;
    static final String S = "\u0001";

    public static void main(String[] args) {
${probes.map(p => {
  const fixExpr = p.fresh === null ? 'null'
    : p.fresh ? 'new WidgetNearestMath.Fix(25.0, 121.5, NOW - 60_000L, true)'
    : `new WidgetNearestMath.Fix(25.0, 121.5, NOW - WidgetNearestMath.FIX_MAX_AGE_MS - 60_000L, true)`;
  const hitExpr = p.hit ? `new WidgetNearestMath.Hit("HIT", ${p.meters}d)` : 'null';
  return `        emit(${java(p.id)}, WidgetNearestMath.decide(${fixExpr}, NOW, ${hitExpr}, ${p.radius}d, ${p.cached === null ? 'null' : java(p.cached)}));`;
}).join('\n')}
${linkProbes.map(p => `        System.out.println(${java(p.id)} + S + "link" + S + WidgetNearestMath.linkable(${p.sys === null ? 'null' : java(p.sys)}, ${java(p.station)}));`).join('\n')}
${kmProbes.map(p => `        System.out.println(${java(p.id)} + S + "km" + S + WidgetNearestMath.outOfRangeKm(${p.meters}d));`).join('\n')}
        // 半徑查表：表由 JS 用【真的那份產物】的值餵進來，Java 這邊只負責查與守門。
        Map<String, Double> table = new HashMap<>();
${Object.entries(radii || {}).map(([k, v]) => `        table.put(${java(k)}, ${Number(v)}d);`).join('\n')}
        System.out.println("A1" + S + "radius" + S + WidgetNearestMath.radiusOf(table, WidgetNearestMath.METRO));
        System.out.println("A2" + S + "radius" + S + WidgetNearestMath.radiusOf(table, WidgetNearestMath.RAIL));
        System.out.println("A3" + S + "radius" + S + WidgetNearestMath.radiusOf(table, "bus"));
        System.out.println("A4" + S + "radius" + S + WidgetNearestMath.radiusOf(null, WidgetNearestMath.METRO));
        // 新鮮度窗的兩側。
        System.out.println("F1" + S + "fresh" + S + WidgetNearestMath.fresh(
            new WidgetNearestMath.Fix(25, 121.5, NOW - WidgetNearestMath.FIX_MAX_AGE_MS + 1000L, true), NOW));
        System.out.println("F2" + S + "fresh" + S + WidgetNearestMath.fresh(
            new WidgetNearestMath.Fix(25, 121.5, NOW - WidgetNearestMath.FIX_MAX_AGE_MS - 1000L, true), NOW));
        System.out.println("F3" + S + "fresh" + S + WidgetNearestMath.fresh(null, NOW));
        // 兩個來源取新的那一筆（App 前景 vs 系統快取）。
        System.out.println("F4" + S + "fresher" + S + WidgetNearestMath.fresher(
            new WidgetNearestMath.Fix(25, 121.5, NOW - 9_000L, false),
            new WidgetNearestMath.Fix(25, 121.5, NOW - 1_000L, true)).fromApp);
        System.out.println("F5" + S + "fresher" + S + WidgetNearestMath.fresher(
            new WidgetNearestMath.Fix(25, 121.5, NOW - 1_000L, false),
            new WidgetNearestMath.Fix(25, 121.5, NOW - 9_000L, true)).fromApp);
    }

    static void emit(String id, WidgetNearestMath.Outcome o) {
        String kind = o.outOfRange ? "outOfRange"
            : o.key == null ? "none" : (o.stale ? "cache" : "serviceable");
        System.out.println(id + S + "decide" + S + kind + S + o.key + S + o.stale + S
            + o.clearCache + S + o.noLocation() + S + o.farKey + S + o.farMeters);
    }
}
`;

const work = join(tmpdir(), `widget-nearest-${process.pid}`);
mkdirSync(join(work, 'src/tw/railisland/app'), { recursive: true });
mkdirSync(join(work, 'out'), { recursive: true });
// 複製而不是 symlink：javac 的輸出目錄與來源目錄混在一起會把 .class 寫回工作樹。
writeFileSync(join(work, 'src/tw/railisland/app/WidgetNearestMath.java'), nearestMath);
writeFileSync(join(work, 'src/tw/railisland/app/NearestGate.java'), gate);
const javacBin = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin/javac') : 'javac';
const javaBin = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin/java') : 'java';
execFileSync(javacBin, ['-encoding', 'UTF-8', '-nowarn', '-proc:none', '-d', join(work, 'out'),
                        join(work, 'src/tw/railisland/app/WidgetNearestMath.java'),
                        join(work, 'src/tw/railisland/app/NearestGate.java')],
             { stdio: ['ignore', 'inherit', 'inherit'] });
const lines = execFileSync(javaBin, ['-Dfile.encoding=UTF-8', '-cp', join(work, 'out'),
                                     'tw.railisland.app.NearestGate'], { encoding: 'utf8' })
  .trim().split('\n');
// 🔴 分隔符用 \u0001 不用 "|"：站鍵本身就是 "系統|站名"，第一版拿 "|" 切欄位，
//    S1/S3/S5 三顆探針的旗標全部讀到錯位的欄位而紅——紅的是我的 harness，不是被測物。
const got = new Map(lines.map(l => {
  const [id, ...rest] = l.split('\u0001');
  return [id, rest];
}));

console.log(`  （服務範圍半徑 metro=${radii?.metro} rail=${radii?.rail} 公尺，探針 ${probes.length + linkProbes.length + kmProbes.length} 顆）`);

// ── 比對 ────────────────────────────────────────────────────────────────────
let compared = 0;
for (const p of probes) {
  const row = got.get(p.id);
  const expect = judge(p);
  compared += 1;
  if (!row) { ok(`${p.id} ${p.name}`, false, '沒有輸出'); continue; }
  const [, kind, key, stale, clearCache, noLocation] = row;
  ok(`${p.id} ${p.name}｜三態`, kind === expect.kind, `java=${kind} 判準=${expect.kind}`);
  ok(`${p.id} ${p.name}｜退快取旗標`, stale === String(expect.stale),
     `java=${stale} 判準=${expect.stale}`);
  ok(`${p.id} ${p.name}｜清快取旗標`, clearCache === String(expect.clear),
     `java=${clearCache} 判準=${expect.clear}`);
  ok(`${p.id} ${p.name}｜noLocation()`, noLocation === String(expect.kind === 'none'),
     `java=${noLocation}`);
  if (expect.kind === 'cache') {
    ok(`${p.id} ${p.name}｜退的是【上次那一站】`, key === p.cached, `java=${key} 判準=${p.cached}`);
  }
}
// 探針集合本身要兩側都有，否則「一律放行」與「一律擋掉」都能全綠。
const kinds = probes.map(p => judge(p).kind);
ok('C1 探針同時覆蓋範圍內與範圍外（各 ≥2）',
   kinds.filter(k => k === 'serviceable').length >= 2 && kinds.filter(k => k === 'outOfRange').length >= 2,
   `serviceable=${kinds.filter(k => k === 'serviceable').length} outOfRange=${kinds.filter(k => k === 'outOfRange').length}`);
ok('C2 清快取的正反兩面都有探針（反向判準必配正向對照）',
   probes.some(p => judge(p).clear) && probes.some(p => !judge(p).clear && p.cached));
ok('C3 退快取標示的正反兩面都有探針',
   probes.some(p => judge(p).stale) && probes.some(p => !judge(p).stale));

for (const p of linkProbes) {
  const row = got.get(p.id);
  compared += 1;
  ok(`${p.id} ${p.name}`, !!row && row[1] === String(p.expect), `java=${row && row[1]}`);
}
for (const p of kmProbes) {
  const row = got.get(p.id);
  compared += 1;
  ok(`${p.id} ${p.name}`, !!row && row[1] === p.expect, `java=${row && row[1]} 判準=${p.expect}`);
}

// A 組：Android 真的算出來的半徑 === 資料檔 === 判準表。
ok(`A1 Android 算出來的 metro 半徑 === 判準表 ${EXPECT.metro}`,
   Number(got.get('A1')?.[1]) === EXPECT.metro, `java=${got.get('A1')?.[1]}`);
ok(`A2 Android 算出來的 rail 半徑 === 判準表 ${EXPECT.rail}`,
   Number(got.get('A2')?.[1]) === EXPECT.rail, `java=${got.get('A2')?.[1]}`);
ok('A3 查不到的運具回 0（不留字面值預設 ⇒ 壞了要壞得看得見）',
   Number(got.get('A3')?.[1]) === 0, `java=${got.get('A3')?.[1]}`);
ok('A4 整張表讀不到也回 0', Number(got.get('A4')?.[1]) === 0, `java=${got.get('A4')?.[1]}`);
ok('F1 新鮮度窗內判新鮮', got.get('F1')?.[1] === 'true');
ok('F2 新鮮度窗外判過期（F1 的另一側）', got.get('F2')?.[1] === 'false');
ok('F3 沒有定位判過期', got.get('F3')?.[1] === 'false');
ok('F4 兩個來源取比較新的（App 前景較新 ⇒ 取它）', got.get('F4')?.[1] === 'true');
ok('F5 兩個來源取比較新的（系統快取較新 ⇒ 取它，反向對照）', got.get('F5')?.[1] === 'false');

// 覆蓋率要有具名斷言：只把 N/M 印在細節裡等於沒 gate，分母會無聲縮水。
const total = probes.length + linkProbes.length + kmProbes.length;
ok('C4 每一顆探針都真的被比對過', compared === total, `${compared}/${total}`);

console.log(`\n總計 PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
