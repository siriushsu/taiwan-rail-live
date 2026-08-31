#!/usr/bin/env node
// 驗 Android 小工具「北上／南下方向三角」這件事，三個互相獨立的層次：
//
//   A 型別層：把出貨用的 Java 真的編一次（R 由【真實 res/ 目錄】現場產生，所以少一個
//             android:id 就編不過，不是靠我手打的 stub 放行）。
//   B 行為層：把編出來的 class 真的【執行】一次，對真實班表逐車算方向；另一條路用這支
//             腳本自己從契約重算一次，兩邊必須逐車一致。
//             🔴 B 路的實作【不准】看 Java 怎麼寫，只依契約：發車取下一個停靠站、終到不給
//             方向、通過退用終點站、緯度高者為北。否則就變成拿實作驗實作（judgment 心得 29）。
//   C 結構層：兩個列 layout 都要有那顆 ImageView、兩個三角 drawable 的尖端方向真的相反、
//             binder 在沒有方向時收起來而不是留白格。
//
// 用法：node app/scripts/verify_android_widget_direction.mjs
// 需要：Android SDK platforms/android-36/android.jar、JDK 11+、gradle 快取裡的 org.json jar。
// 這三樣缺任何一樣就【明說跳過那一層】並以非零退出，不假裝通過。

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../..');
const ANDROID = join(ROOT, 'app/android/app/src/main');
const JAVA_DIR = join(ANDROID, 'java/tw/railisland/app');
const RES = join(ANDROID, 'res');
const WORK = resolve(process.argv[2] ?? join(ROOT, 'tmp/android-direction-verify'));

const results = [];
const check = (label, pass, detail = '') => results.push({ label, pass: !!pass, detail });

// ── 環境 ────────────────────────────────────────────────────────────────────
const SDK = process.env.ANDROID_HOME || join(homedir(), 'Library/Android/sdk');
const androidJar = ['android-36', 'android-37.0']
  .map(v => join(SDK, 'platforms', v, 'android.jar')).find(existsSync);
const jbr = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
const JAVAC = existsSync(join(jbr, 'bin/javac')) ? join(jbr, 'bin/javac') : 'javac';
const JAVA = existsSync(join(jbr, 'bin/java')) ? join(jbr, 'bin/java') : 'java';
let jsonJar = null;
try {
  jsonJar = execFileSync('/bin/sh', ['-c',
    `find "${homedir()}/.gradle/caches" -name 'json-*.jar' 2>/dev/null | head -1`],
    { encoding: 'utf8' }).trim() || null;
} catch { /* 找不到就走下面的缺件分支 */ }

if (!androidJar) { console.error('找不到 android.jar（platforms/android-36 或 37）'); process.exit(2); }
if (!jsonJar) { console.error('找不到可執行的 org.json jar（gradle 快取）'); process.exit(2); }

mkdirSync(WORK, { recursive: true });
const gen = join(WORK, 'gen/tw/railisland/app');
mkdirSync(gen, { recursive: true });
mkdirSync(join(WORK, 'gen/androidx/core/content'), { recursive: true });
const classes = join(WORK, 'classes');
mkdirSync(classes, { recursive: true });

// ── C-0：R.java 由真實資源產生 ───────────────────────────────────────────────
// 🔴 這是整支腳本的骨幹：R 的常數名單只來自 res/ 現場，所以 RailWidgetRender 引用了一個
//    layout 裡不存在的 id 時，是【編譯失敗】而不是被 stub 放行。
const ids = new Set(), layouts = new Set(), drawables = new Set(), colors = new Set();
for (const f of readdirSync(join(RES, 'layout'))) {
  layouts.add(f.replace(/\.xml$/, ''));
  for (const m of readFileSync(join(RES, 'layout', f), 'utf8').matchAll(/@\+id\/(\w+)/g)) ids.add(m[1]);
}
for (const f of readdirSync(join(RES, 'drawable'))) drawables.add(f.replace(/\.(xml|png|webp|jpg)$/, ''));
for (const dir of readdirSync(RES).filter(d => d.startsWith('values'))) {
  for (const f of readdirSync(join(RES, dir)).filter(n => n.endsWith('.xml'))) {
    for (const m of readFileSync(join(RES, dir, f), 'utf8').matchAll(/<color\s+name="(\w+)"/g)) colors.add(m[1]);
    for (const m of readFileSync(join(RES, dir, f), 'utf8').matchAll(/@\+id\/(\w+)/g)) ids.add(m[1]);
  }
}
const rClass = (name, keys) =>
  `  public static final class ${name} {\n` +
  [...keys].sort().map((k, i) => `    public static final int ${k} = ${0x7f000000 + i};`).join('\n') +
  '\n  }\n';
writeFileSync(join(gen, 'R.java'),
  'package tw.railisland.app;\npublic final class R {\n' +
  rClass('id', ids) + rClass('layout', layouts) + rClass('drawable', drawables) +
  rClass('color', colors) + rClass('string', new Set()) + '}\n');
writeFileSync(join(WORK, 'gen/androidx/core/content/ContextCompat.java'),
  'package androidx.core.content;\nimport android.content.Context;\n' +
  'public class ContextCompat {\n  public static int checkSelfPermission(Context c, String p) { return 0; }\n}\n');

check('R 由真實 res/ 產生且含 wrr_heading', ids.has('wrr_heading'),
  `layout ids ${ids.size} 個`);
check('兩個方向 drawable 都在 res/drawable', drawables.has('wg_heading_north') && drawables.has('wg_heading_south'));
check('三角用的顏色在淺色與深色都有定義',
  colors.has('wg_ink_faint') &&
  readFileSync(join(RES, 'values-night/colors_widget.xml'), 'utf8').includes('wg_ink_faint'));

// ── A：型別層（真的編一次）──────────────────────────────────────────────────
const sources = [
  join(JAVA_DIR, 'RailWidgetData.java'),
  join(JAVA_DIR, 'RailWidgetRender.java'),
  join(JAVA_DIR, 'RailNativeL10n.java'),
  join(gen, 'R.java'),
  join(WORK, 'gen/androidx/core/content/ContextCompat.java'),
];
let javacOut = '';
let compiled = false;
// 相依的同套件類別自動補進來（RailNativeL10n 會拉到 MetroWidgetPlate 之類）。上限 12 輪，
// 不用手打清單——手打的清單會在別人加檔案時無聲過期。
for (let round = 0; round < 12 && !compiled; round++) {
  try {
    execFileSync(JAVAC, ['-nowarn', '-encoding', 'UTF-8', '-d', classes,
      '-cp', `${androidJar}:${jsonJar}`, ...sources], { encoding: 'utf8', stdio: 'pipe' });
    compiled = true;
  } catch (e) {
    javacOut = `${e.stdout || ''}${e.stderr || ''}`;
    const missing = new Set();
    for (const m of javacOut.matchAll(/(?:package|symbol:\s*class|cannot find symbol[\s\S]{0,80}?class)\s+(\w+)/g)) missing.add(m[1]);
    for (const m of javacOut.matchAll(/package (\w+) does not exist/g)) missing.add(m[1]);
    let added = false;
    for (const name of missing) {
      const f = join(JAVA_DIR, `${name}.java`);
      if (existsSync(f) && !sources.includes(f)) { sources.push(f); added = true; }
    }
    if (!added) break;
  }
}
check('出貨 Java 對真實資源編譯通過', compiled, compiled ? '' : javacOut.split('\n').slice(0, 6).join('\n'));
if (!compiled) { report(); process.exit(1); }

// ── 準備真實班表 payload ────────────────────────────────────────────────────
const payload = join(WORK, 'RailWidgetData.json');
if (!existsSync(payload)) {
  execFileSync('node', [join(ROOT, 'app/scripts/build_rail_widget_data.mjs'), '--out', payload],
    { encoding: 'utf8', stdio: 'pipe' });
}
const doc = JSON.parse(readFileSync(payload, 'utf8'));

// 取樣車站刻意涵蓋四種形態，不是隨手挑三個熱門站：
//   幹線雙向（樹林）、山海線分家（竹南）、終到站（基隆）、支線（車埕所在的集集線）、高鐵（左營）
const SAMPLE = ['樹林', '竹南', '基隆', '彰化', '左營'];

// ── B-1：路徑 A＝真的執行出貨 Java ──────────────────────────────────────────
writeFileSync(join(gen, 'DirectionProbe.java'), `package tw.railisland.app;
import java.lang.reflect.*; import java.nio.file.*; import java.util.*; import org.json.*;
public class DirectionProbe {
  public static void main(String[] a) throws Exception {
    JSONObject doc = new JSONObject(new String(Files.readAllBytes(Paths.get(a[0])), "UTF-8"));
    String[] want = a[1].split(",");
    Class<?> D = Class.forName("tw.railisland.app.RailWidgetData");
    Class<?> SI = null, TR = null;
    for (Class<?> c : D.getDeclaredClasses()) {
      if (c.getSimpleName().equals("SystemInfo")) SI = c;
      if (c.getSimpleName().equals("Train")) TR = c;
    }
    Constructor<?> siC = SI.getDeclaredConstructor(JSONObject.class); siC.setAccessible(true);
    Method rowAt = null;
    for (Method m : D.getDeclaredMethods()) if (m.getName().equals("rowAt")) rowAt = m;
    rowAt.setAccessible(true);
    JSONArray out = new JSONArray();
    JSONArray systems = doc.optJSONArray("systems");
    for (int s = 0; s < systems.length(); s++) {
      Object system = siC.newInstance(systems.optJSONObject(s));
      Field fTrains = SI.getDeclaredField("trains"); fTrains.setAccessible(true);
      Field fId = SI.getDeclaredField("id"); fId.setAccessible(true);
      List<?> trains = (List<?>) fTrains.get(system);
      String sysId = (String) fId.get(system);
      for (String origin : want) {
        for (Object train : trains) {
          Object row = rowAt.invoke(null, train, system, origin, "", 0L);
          if (row == null) continue;
          Class<?> RW = row.getClass();
          Field fNo = RW.getDeclaredField("no"); fNo.setAccessible(true);
          Field fRel = RW.getDeclaredField("relation"); fRel.setAccessible(true);
          Field fHd = RW.getDeclaredField("heading"); fHd.setAccessible(true);
          Object hd = fHd.get(row);
          out.put(new JSONObject().put("sys", sysId).put("origin", origin)
            .put("no", fNo.get(row)).put("relation", String.valueOf(fRel.get(row)))
            .put("heading", hd == null ? JSONObject.NULL : String.valueOf(hd)));
        }
      }
    }
    Files.write(Paths.get(a[2]), out.toString().getBytes("UTF-8"));
  }
}
`);
execFileSync(JAVAC, ['-nowarn', '-encoding', 'UTF-8', '-d', classes,
  '-cp', `${androidJar}:${jsonJar}:${classes}`, join(gen, 'DirectionProbe.java')],
  { encoding: 'utf8', stdio: 'pipe' });
const javaOutFile = join(WORK, 'path_a.json');
// android.jar 也要在執行期 classpath：getDeclaredMethods() 會解析【整個類別】的方法簽名，
// 其他方法吃 Context 就會 NoClassDefFound。stub 只要不被呼叫就無妨；rowAt 全程不碰 android。
// 🔴 jsonJar 必須排在 android.jar 前面——android.jar 裡的 org.json 是會丟 "Stub!" 的空殼。
execFileSync(JAVA, ['-cp', `${jsonJar}:${classes}:${androidJar}`, 'tw.railisland.app.DirectionProbe',
  payload, SAMPLE.join(','), javaOutFile], { encoding: 'utf8', stdio: 'pipe' });
const pathA = JSON.parse(readFileSync(javaOutFile, 'utf8'));

// ── B-2：路徑 B＝依契約獨立重算（不看 Java 怎麼寫）─────────────────────────
const pathB = [];
for (const system of doc.systems) {
  const lat = new Map();
  for (const st of system.stations || []) if (!lat.has(st.name)) lat.set(st.name, st.lat);
  for (const train of system.trains || []) {
    const stops = train.stops || [];
    for (const origin of SAMPLE) {
      const at = stops.findIndex(s => s.name === origin);
      if (at < 0) continue;
      const onward = stops.slice(at + 1).filter(s => s.stop !== false);
      const relation = stops[at].stop === false ? 'PASS'
        : at === stops.length - 1 ? 'ARRIVAL' : 'DEPARTURE';
      // 契約：發車→下一個停靠站；終到→無方向；通過→終點站
      const target = relation === 'DEPARTURE' ? (onward[0]?.name ?? null)
        : relation === 'PASS' ? (stops[stops.length - 1]?.name ?? null) : null;
      const a = lat.get(origin), b = target == null ? undefined : lat.get(target);
      const heading = (target == null || !Number.isFinite(a) || !Number.isFinite(b) || a === b)
        ? null : (b > a ? 'NORTH' : 'SOUTH');
      pathB.push({ sys: system.id, origin, no: train.no, relation, heading });
    }
  }
}

// ── B-3：兩路逐車比對 ───────────────────────────────────────────────────────
const key = r => `${r.sys}|${r.origin}|${r.no}`;
const mapB = new Map(pathB.map(r => [key(r), r]));
let same = 0; const diffs = [];
for (const r of pathA) {
  const b = mapB.get(key(r));
  const hA = r.heading === null ? null : r.heading;
  if (!b) { diffs.push(`${key(r)} 只有 Java 有`); continue; }
  if (b.relation !== r.relation || b.heading !== hA) {
    diffs.push(`${key(r)} Java=${r.relation}/${hA} 契約=${b.relation}/${b.heading}`);
  } else same++;
}
check('兩條獨立路徑對每一班車的方向一致', diffs.length === 0 && pathA.length === pathB.length,
  `逐車比對 ${same} 筆一致、${diffs.length} 筆不一致、Java ${pathA.length} / 契約 ${pathB.length}${diffs.length ? '\n    ' + diffs.slice(0, 5).join('\n    ') : ''}`);

// ── B-4：鑑別力（判準真的有牙）──────────────────────────────────────────────
const north = pathA.filter(r => r.heading === 'NORTH').length;
const south = pathA.filter(r => r.heading === 'SOUTH').length;
const arrive = pathA.filter(r => r.relation === 'ARRIVAL');
check('取樣裡北上與南下都真的出現過', north > 0 && south > 0, `北上 ${north}／南下 ${south}`);
check('終到本站的車一律不給方向', arrive.length > 0 && arrive.every(r => r.heading === null),
  `終到 ${arrive.length} 筆`);
// 若「取下一停靠站」與「取終點站」永遠同答案，這條規則就沒被測到——要證明它有差別
let ruleMatters = 0;
for (const system of doc.systems) {
  const lat = new Map();
  for (const st of system.stations || []) if (!lat.has(st.name)) lat.set(st.name, st.lat);
  for (const train of system.trains || []) {
    const stops = train.stops || [];
    for (const origin of SAMPLE) {
      const at = stops.findIndex(s => s.name === origin);
      if (at < 0 || stops[at].stop === false || at === stops.length - 1) continue;
      const next = stops.slice(at + 1).find(s => s.stop !== false)?.name;
      const term = stops[stops.length - 1]?.name;
      const a = lat.get(origin);
      const h = t => { const b = lat.get(t); return (!Number.isFinite(a) || !Number.isFinite(b) || a === b) ? null : (b > a ? 'NORTH' : 'SOUTH'); };
      if (next && term && h(next) !== h(term)) ruleMatters++;
    }
  }
}
check('「取下一停靠站而非終點站」在真實班表上真的有差別', ruleMatters > 0,
  `${ruleMatters} 班車兩種取法會給出不同方向（含山海線繞行車）`);

// ── C：結構層 ───────────────────────────────────────────────────────────────
const rowXml = readFileSync(join(RES, 'layout/widget_rail_row.xml'), 'utf8');
const readXml = readFileSync(join(RES, 'layout/widget_rail_row_readable.xml'), 'utf8');
const hasHeadingId = xml => /@\+id\/wrr_heading(?![A-Za-z0-9_])/.test(xml);
check('兩個列 layout 都有方向三角（只有一個會讓好讀版整批沒方向）',
  hasHeadingId(rowXml) && hasHeadingId(readXml));
const northXml = readFileSync(join(RES, 'drawable/wg_heading_north.xml'), 'utf8');
const southXml = readFileSync(join(RES, 'drawable/wg_heading_south.xml'), 'utf8');
const apex = xml => {
  const d = /pathData="M([\d.]+),([\d.]+)/.exec(xml);
  const vh = parseFloat(/viewportHeight="([\d.]+)"/.exec(xml)[1]);
  return parseFloat(d[2]) < vh / 2 ? 'up' : 'down';
};
check('北上三角尖端朝上、南下朝下（兩者不可對調）',
  apex(northXml) === 'up' && apex(southXml) === 'down',
  `north=${apex(northXml)} south=${apex(southXml)}`);
const render = readFileSync(join(JAVA_DIR, 'RailWidgetRender.java'), 'utf8');
check('沒有方向時整顆收起來，不是留一個空格',
  /row\.heading == null\)\s*\{\s*out\.setViewVisibility\(R\.id\.wrr_heading, View\.GONE\)/.test(render));
check('方向有讀出來給無障礙（顏色與形狀之外還有文字）',
  /setContentDescription\(R\.id\.wrr_heading/.test(render)
  && /"北上"/.test(render) && /"南下"/.test(render));
check('空看板那一列也把三角收起來',
  /empty\.setViewVisibility\(R\.id\.wrr_heading, View\.GONE\)/.test(render));
const data = readFileSync(join(JAVA_DIR, 'RailWidgetData.java'), 'utf8');
check('方向跟著快取一起存（否則從快取還原會整批掉方向）',
  /out\.put\("heading", heading\.name\(\)\)/.test(data) && /raw\.optString\("heading"/.test(data));

report();
function report() {
  const pass = results.filter(r => r.pass).length;
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.label}${r.detail ? `\n    ${r.detail}` : ''}`);
  }
  console.log(`\n${pass}/${results.length} 通過`);
  if (pass !== results.length) process.exitCode = 1;
}
