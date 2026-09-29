#!/usr/bin/env node
// 把「車站收集」小工具的五種家族算繪成 PNG，並用一組閘門判定紅綠——不必進模擬器、不必上手機。
//
// 做法（與 render_widget_kit.mjs 同型）：CollectionCard.swift 是純 SwiftUI 的版面檔（只依賴
// RailWidgetKit／RailNativeL10n），整檔逐字交給 swiftc 編成 macOS 執行檔，用 ImageRenderer 出 PNG。
// 不抽宣告：抽取有「抽到舊版」的風險；整檔納入的話，檔案哪天開始依賴別的檔，編譯當場失敗。
// Widget／Provider／EntryView（要 AppIntents、Color(uiColor:)）不在這個檔裡，由
// verify_widget_typecheck.mjs 以 iOS 目標整批型別檢查補上。
//
// 🔴 期望值全部在這支腳本（node）從 payload 獨立重算，Swift 端只回報「量到什麼」：
//    Swift 端自己算的數字拿去對自己等於零資訊（判準與實作同源）。
//
// 閘門：
//   a1 文字框不與地圖框相交（PreferenceKey 回報的是每個 Text 自己的框，不是外層容器）
//   a2 文字【字形】不與地圖相交：地圖藏起來只佔位再算圖一次，地圖框內任何墨跡都是文字侵入
//   b1 Canvas 真的 fill 了幾個點（探針計數）＝ payload 依範圍濾出的點數（三種狀態各自）
//   b2 每個應畫的點，畫面上那個座標的像素不是底色（位置對得上）；b3 地圖寬高比＝payload.aspect
//   c  各數字（百分比、座數、各系統 v／n、最近蓋章日期）與 payload 一致；c2 進度條／直立條填滿比例
//   d  關鍵數字沒有被縮放或截成「…」（實際寬 ≥ 不受限的理想寬）
//   e  文字不超出內容框（16pt 內距；鎖屏 0）；h 文字與文字不互疊
//   g  淡色（s=1）明顯淡於實心（s=2）、又明顯深於未收集（s=0）——像素判準，用合成 payload 量
//
// 用法：node app/scripts/render_collect_widget.mjs [輸出目錄] [--quick] [--src <小工具原始碼目錄>]
//       node app/scripts/render_collect_widget.mjs --mutation-test [輸出目錄]
//       node app/scripts/render_collect_widget.mjs [輸出目錄] --lang en｜ja   英日文版面壓力測試：系統簡稱與文案換成該語言
//         （RailNativeL10n 在複本裡改讀 RailNativeL10n.json），c 閘門（繁中字串比對）不適用，其餘照跑；PNG 要人眼看
// 輸出：<目錄>/shots/*.png、contact-light.png、contact-dark.png、results.json

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const realSrc = join(repo, 'app/ios/App/RailBoardWidget');

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--src' && argv[i - 1] !== '--lang');
const LANG = opt('--lang'); // en｜ja：英日文版面壓力測試（見下方 langStress）
const outRoot = resolve(positional[0] ?? join(repo, 'tmp/collect-widget/ios-shots'));

// ── 尺寸：430pt 機型是設計基準，393pt 是 RailScale 下限那一側 ─────────────────────────
const SIZES = {
  430: { small: [170, 170], medium: [364, 170], large: [364, 382], rect: [160, 72], circ: [76, 76] },
  393: { small: [158, 158], medium: [338, 158], large: [338, 354], rect: [160, 72], circ: [76, 76] },
};
const INSET = 16;
const SCALE = 3;
const BG = { light: 0.98, dark: 0.09 };

// ── payload 樣本 ───────────────────────────────────────────────────────────────────────
const samplePath = join(repo, 'tmp/collect-widget/collection-widget-sample.json');
const emptyPath = join(repo, 'tmp/collect-widget/collection-widget-sample-empty.json');
const sample = JSON.parse(readFileSync(samplePath, 'utf8'));
const emptyPayload = JSON.parse(readFileSync(emptyPath, 'utf8'));

/**
 * --lang en｜ja：把 payload 的系統簡稱換成網頁端 COLLECT_SYS 在該語言實際送出的 label（index.html），
 * 最近蓋章換成較長的英文站名。用途只有一個：量英日文字串在各版面會不會被縮、被截、互疊。
 * 這個模式下 c 閘門（字串逐字比對，期望值是繁中）不適用，其餘閘門照跑。
 */
const LANG_LABELS = {
  en: ['TRA', 'THSR', 'Taipei', 'Airport', 'Taichung', 'Kaohsiung', 'Danhai', 'Ankeng', 'Sanying', 'Alishan'],
  ja: ['台鉄', '高鉄', '台北', '空港', '台中', '高雄', '淡海', '安坑', '三鶯', '阿里山'],
};
const LANG_RECENT = {
  en: [
    { name: 'Jingtong', line: 'Pingxi Line', k: 'tra', d: '2026-09-27' },
    { name: 'Shifen', line: 'Pingxi Line', k: 'tra', d: '2026-09-27' },
    { name: 'Chishang', line: 'Taitung Line', k: 'tra', d: '2026-09-21' },
    { name: 'Taoyuan Airport Terminal 1', line: 'Taoyuan Airport MRT', k: 'tymc', d: '2026-09-14' },
  ],
};
if (LANG) {
  if (!LANG_LABELS[LANG]) throw new Error(`--lang 只收 ${Object.keys(LANG_LABELS).join('、')}`);
  for (const p of [sample, emptyPayload]) {
    p.sys.forEach((sy, i) => { sy.label = LANG_LABELS[LANG][i]; });
    if (LANG_RECENT[LANG] && p.recent.length) p.recent = LANG_RECENT[LANG].slice(0, p.recent.length);
  }
}

/** 全收滿：n＝total、每系統 v＝n、每個點 s=2（測 100% 的寬度與滿條）。 */
function fullPayload() {
  const p = JSON.parse(JSON.stringify(sample));
  p.n = p.total;
  for (const s of p.sys) s.v = s.n;
  for (const pt of p.pts) pt[3] = 2;
  return p;
}
/** 只收 1 站：百分比四捨五入成 0%，進度條要靠 3% 下限才看得見。 */
function onePayload() {
  const p = JSON.parse(JSON.stringify(emptyPayload));
  p.n = 1;
  p.sys[0].v = 1;
  p.pts.find(pt => pt[4] === 0)[3] = 2;
  p.recent = [{ name: '菁桐', line: '平溪線', k: 'tra', d: '2026-09-27' }];
  return p;
}
/**
 * 合成的「三態」payload：十個系統各一列，每列 s=0／1／2 各一點，列距與欄距都遠大於點徑，
 * 每個點都孤立——拿來量「淡色 vs 實心 vs 未收集」的像素對比，不受相鄰點疊色干擾。
 */
function statesPayload() {
  // 取自真實線色，特意含最難分辨的淡色（黃、粉、淺藍、淺綠）與灰藍（台鐵幹線 #5D6D7E）。
  const colors = ['#5D6D7E', '#FFDB00', '#F48B9F', '#79BCE8', '#8CC8A0', '#6A8EAE', '#E85D0D', '#0070BD', '#C0392B', '#8246AF'];
  const p = JSON.parse(JSON.stringify(sample));
  p.pts = [];
  colors.forEach((c, row) => [0, 1, 2].forEach((s, col) => p.pts.push([200 + col * 300, 50 + row * 100, c, s, row])));
  p.sys.forEach((s, i) => { s.v = 2; s.n = 3; });
  p.n = 20; p.total = 30;
  return p;
}
const FIXTURES = {
  sample, empty: emptyPayload, none: null, full: fullPayload(), one: onePayload(), states: statesPayload(),
};

// ── 期望值：從 payload 獨立重算（不讀任何 Swift 端的數字）──────────────────────────────
function expected(fix, scope) {
  const idx = scope ? fix.sys.findIndex(s => s.k === scope) : -1;
  const scoped = idx >= 0;
  const v = scoped ? fix.sys[idx].v : fix.n;
  const total = scoped ? fix.sys[idx].n : fix.total;
  const pct = v > 0 && total > 0 ? Math.round((v * 100) / total) : 0;
  const dots = fix.pts.filter(p => (scoped ? p[4] === idx : true));
  const recent = scoped ? fix.recent.filter(r => r.k === scope) : fix.recent;
  const top = fix.sys.map((s, i) => ({ ...s, i })).filter(s => s.v > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i).slice(0, 5);
  return {
    scoped, v, total, pct, remain: Math.max(0, total - v), dots, recent, top,
    untouched: fix.sys.filter(s => s.v === 0).length,
    title: scoped ? fix.sys[idx].label : '全台',
    aspect: fix.aspect,
  };
}
const fillFrac = (v, n) => (n > 0 && v > 0 ? Math.min(1, Math.max(v / n, 0.03)) : 0);
const shortDate = d => { const m = d.split('-'); return m.length === 3 ? `${Number(m[1])}/${Number(m[2])}` : d; };
const nums = s => (s ?? '').match(/\d+/g)?.map(Number) ?? [];

// ── 出圖矩陣 ─────────────────────────────────────────────────────────────────────────
function buildCases(quick) {
  const cases = [];
  const add = (fam, scope, state, scheme, mono, width) => {
    const [w, h] = SIZES[width][fam];
    const tag = `${fam}${scope ? '-' + scope : ''}-${state}-${scheme}${mono ? '-tinted' : ''}-${width}`;
    cases.push({ name: tag, fam, scope, state, scheme, mono, width, w, h });
  };
  if (quick) {
    for (const st of ['sample', 'empty', 'none']) add('small', null, st, 'light', false, 430);
    add('small', 'tra', 'sample', 'light', false, 430);
    add('small', 'tra', 'sample', 'dark', false, 430);
    add('medium', null, 'sample', 'light', false, 430);
    add('medium', 'tra', 'sample', 'light', false, 430);
    add('large', null, 'sample', 'light', false, 430);
    add('large', null, 'sample', 'dark', false, 430);
    add('large', 'tra', 'sample', 'light', false, 430);
    add('rect', null, 'sample', 'dark', true, 430);
    add('circ', null, 'sample', 'dark', true, 430);
    add('small', null, 'states', 'light', false, 430);
    add('small', null, 'states', 'dark', false, 430);
    return cases;
  }
  const famList = [['small', null], ['small', 'tra'], ['medium', null], ['large', null], ['rect', null], ['circ', null]];
  for (const width of [430, 393]) {
    for (const [fam, scope] of famList) {
      for (const state of ['sample', 'empty', 'none']) {
        for (const scheme of ['light', 'dark']) {
          const lock = fam === 'rect' || fam === 'circ';
          add(fam, scope, state, scheme, lock, width);
        }
      }
    }
    // 單一系統的中卡／大卡
    for (const [fam, scope] of [['medium', 'tra'], ['large', 'tra'], ['medium', 'krtc'], ['large', 'krtc']]) {
      for (const scheme of ['light', 'dark']) add(fam, scope, 'sample', scheme, false, width);
    }
    // 邊界：全收滿（100%）、只收 1 站（0%＋3% 下限）
    for (const [fam, scope] of famList) {
      for (const state of ['full', 'one']) {
        const lock = fam === 'rect' || fam === 'circ';
        add(fam, scope, state, 'light', lock, width);
      }
    }
  }
  // 著色（tinted／accented）：桌面三種尺寸的淺色與深色
  for (const fam of ['small', 'medium', 'large']) {
    for (const scheme of ['light', 'dark']) add(fam, null, 'sample', scheme, true, 430);
  }
  // 合成三態（像素判準用）
  for (const scheme of ['light', 'dark']) add('small', null, 'states', scheme, false, 430);
  return cases;
}

// ── Swift 算繪 harness ──────────────────────────────────────────────────────────────────
const harnessSwift = `
import AppKit
import Foundation
import SwiftUI
import WidgetKit

struct CaseSpec: Decodable {
    let name: String
    let fam: String
    let w: Double
    let h: Double
    let scheme: String
    let mono: Bool
    let dir: String
    let scope: String?
}

final class FrameBox { var frames: [CollectionFrameReport] = [] }

func makeView(_ fam: String, _ content: CollectionContent) -> AnyView {
    switch fam {
    case "small": return AnyView(SmallCollectionView(content: content))
    case "medium": return AnyView(MediumCollectionView(content: content))
    case "large": return AnyView(LargeCollectionView(content: content))
    case "rect": return AnyView(RectangularCollectionView(content: content))
    case "circ": return AnyView(CircularCollectionView(content: content))
    default: fatalError("unknown family \\(fam)")
    }
}

@MainActor
func pngData<V: View>(_ view: V, w: CGFloat, h: CGFloat, scheme: ColorScheme, mono: Bool) -> Data {
    let renderer = ImageRenderer(
        content: view
            .frame(width: w, height: h)
            .background(Color(white: scheme == .dark ? ${BG.dark} : ${BG.light}))
            .environment(\\.colorScheme, scheme)
            .environment(\\.railMonochrome, mono)
    )
    renderer.scale = ${SCALE}
    guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:])
    else {
        FileHandle.standardError.write(Data("算繪失敗\\n".utf8)); exit(1)
    }
    return png
}

@main
struct Harness {
    @MainActor
    static func main() {
        let args = CommandLine.arguments
        let specs = try! JSONDecoder().decode([CaseSpec].self, from: Data(contentsOf: URL(fileURLWithPath: args[1])))
        let out = args[2]
        var results: [[String: Any]] = []
        for c in specs {
            let snap = CollectionStore.load(rootURL: URL(fileURLWithPath: c.dir))
            let content = CollectionContent.make(snap, scope: c.scope)
            let scheme: ColorScheme = c.scheme == "dark" ? .dark : .light
            let w = CGFloat(c.w), h = CGFloat(c.h)

            // A：出貨路徑（三個驗收環境值全是預設）——這張才是「使用者看到的」。
            let shipped = pngData(makeView(c.fam, content), w: w, h: h, scheme: scheme, mono: c.mono)
            try! shipped.write(to: URL(fileURLWithPath: out + "/" + c.name + ".png"))

            // B：量測——每個文字／進度條回報自己的範圍，Canvas 每畫一個點記一筆。
            let box = FrameBox()
            let probe = CollectionDrawProbe()
            _ = pngData(makeView(c.fam, content)
                            .environment(\\.collectMeasure, true)
                            .environment(\\.collectProbe, probe)
                            .onPreferenceChange(CollectionFramesKey.self) { box.frames = $0 },
                        w: w, h: h, scheme: scheme, mono: c.mono)

            // C：地圖藏起來只佔位——算出來的墨跡就只剩文字（與其他非地圖元素）。
            let hiddenPng = pngData(makeView(c.fam, content).environment(\\.collectMapHidden, true),
                                    w: w, h: h, scheme: scheme, mono: c.mono)
            try! hiddenPng.write(to: URL(fileURLWithPath: out + "/" + c.name + ".hidden.png"))

            results.append([
                "name": c.name,
                "probe": ["off": probe.off, "follow": probe.follow, "solid": probe.solid],
                "frames": box.frames.map { f -> [String: Any] in
                    ["id": f.id, "text": f.text.map { $0 as Any } ?? NSNull(), "key": f.key,
                     "x": f.x, "y": f.y, "w": f.w, "h": f.h]
                },
            ])
        }
        let data = try! JSONSerialization.data(withJSONObject: results, options: [.prettyPrinted])
        try! data.write(to: URL(fileURLWithPath: out + "/results.json"))
        print("算繪 \\(specs.count) 個案例")
    }
}
`;

function runHarness({ src, out, quick }) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'shots'), { recursive: true });
  mkdirSync(join(out, 'fix'), { recursive: true });
  const cases = buildCases(quick);
  // 每個 fixture 一個目錄，裡面放 collection.json；none＝空目錄（走真實的「沒檔案」路徑）。
  for (const [name, payload] of Object.entries(FIXTURES)) {
    const dir = join(out, 'fix', name);
    mkdirSync(dir, { recursive: true });
    if (payload) writeFileSync(join(dir, 'collection.json'), JSON.stringify(payload));
  }
  const specs = cases.map(c => ({ ...c, dir: join(out, 'fix', c.state) }));
  writeFileSync(join(out, 'cases.json'), JSON.stringify(specs));
  const harnessPath = join(out, 'harness.swift');
  writeFileSync(harnessPath, harnessSwift);
  const bin = join(out, 'harness');
  execFileSync('swiftc', ['-O', '-parse-as-library', harnessPath,
    join(src, 'CollectionCard.swift'), join(src, 'RailWidgetKit.swift'), join(src, 'RailNativeL10n.swift'),
    '-o', bin], { stdio: 'inherit' });
  execFileSync(bin, [join(out, 'cases.json'), join(out, 'shots')], {
    stdio: 'inherit',
    env: LANG ? { ...process.env, RAIL_L10N_LANG: LANG, RAIL_L10N_JSON: join(repo, 'app/android/app/src/main/assets/RailNativeL10n.json') } : process.env,
  });
  const results = JSON.parse(readFileSync(join(out, 'shots/results.json'), 'utf8'));
  return { cases: specs, results };
}

// ── 像素工具 ─────────────────────────────────────────────────────────────────────────
async function loadPixels(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
}
const px = (img, x, y) => {
  const i = (Math.min(img.h - 1, Math.max(0, y)) * img.w + Math.min(img.w - 1, Math.max(0, x))) * img.ch;
  return [img.data[i] / 255, img.data[i + 1] / 255, img.data[i + 2] / 255];
};
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

/** 地圖點在 PNG 裡的像素座標。公式是契約的一部分（x、y 為 0..1000，內距＝已收集點半徑）。 */
function dotPixel(dot, map) {
  const r = Math.max(1.0, map.h * 0.0075);
  const inset = r * 1.3;
  return [
    Math.round((map.x + inset + (dot[0] / 1000) * (map.w - 2 * inset)) * SCALE),
    Math.round((map.y + inset + (dot[1] / 1000) * (map.h - 2 * inset)) * SCALE),
  ];
}

// ── 閘門 ────────────────────────────────────────────────────────────────────────────
const GATES = ['a1', 'a2', 'b1', 'b2', 'b3', 'c', 'c2', 'd', 'e', 'g', 'h'];

async function judge({ specs, results, out, src }) {
  const fails = [];
  const counts = Object.fromEntries(GATES.map(g => [g, { pass: 0, fail: 0 }]));
  const fail = (gate, name, detail) => { counts[gate].fail += 1; fails.push({ gate, name, detail }); };
  const ok = gate => { counts[gate].pass += 1; };
  const check = (gate, name, cond, detail) => (cond ? ok(gate) : fail(gate, name, detail));

  for (const spec of specs) {
    const res = results.find(r => r.name === spec.name);
    const fix = FIXTURES[spec.state];
    const frames = res.frames;
    const texts = frames.filter(f => !f.id.endsWith('#ideal') && f.text !== null);
    const byId = id => texts.filter(f => f.id === id);
    const map = frames.find(f => f.id === 'map');
    const lock = spec.fam === 'rect' || spec.fam === 'circ';
    const inset = lock ? 0 : INSET;
    const ex = fix ? expected(fix, spec.scope) : null;
    const n = spec.name;

    // ── e：文字不超出內容框 ──
    for (const t of texts) {
      const inside = t.x >= inset - 0.6 && t.y >= inset - 0.6
        && t.x + t.w <= spec.w - inset + 0.6 && t.y + t.h <= spec.h - inset + 0.6;
      check('e', n, inside, `${t.id}「${t.text}」超出內容框：x ${t.x.toFixed(1)}–${(t.x + t.w).toFixed(1)}、y ${t.y.toFixed(1)}–${(t.y + t.h).toFixed(1)}（卡 ${spec.w}×${spec.h}，內距 ${inset}）`);
    }

    // ── h：文字與文字不互疊（溢出的關鍵數字會壓到隔壁那一列）──
    if (spec.state !== 'none') {
      for (let i = 0; i < texts.length; i += 1) for (let j = i + 1; j < texts.length; j += 1) {
        const a = texts[i], b = texts[j];
        const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        check('h', n, !(ix > 0.5 && iy > 0.5), `${a.id}「${a.text}」與 ${b.id}「${b.text}」互疊 ${ix.toFixed(1)}×${iy.toFixed(1)}pt`);
      }
    }

    // ── d：關鍵數字沒有被縮放或截成「…」 ──
    for (const t of texts.filter(f => f.key)) {
      const ideal = frames.find(f => f.id === t.id + '#ideal');
      if (!ideal) continue;
      check('d', n, t.w >= ideal.w - 0.5, `${t.id}「${t.text}」實際寬 ${t.w.toFixed(1)} < 理想寬 ${ideal.w.toFixed(1)}（被縮或被截）`);
    }

    // ── 「沒有檔案」：只該有提示文字，沒有地圖、沒有數字 ──
    if (spec.state === 'none') {
      // 圓形鎖屏只有一個「—」符號（圓環裡放不下句子），其餘家族要有那句提示。
      const lockCirc = spec.fam === 'circ';
      check('c', n, (lockCirc || byId('unavailable').length === 1) && !map && byId('pct').length === 0,
        `沒有 collection.json 時應只有提示文字：unavailable=${byId('unavailable').length}、map=${!!map}、pct=${byId('pct').length}`);
      if (!lockCirc) check('c', n, byId('unavailable')[0]?.text === '打開軌島一次，就會出現你的車站收集', '提示文案不對');
      // 文字不互疊、不超出內容框在沒有檔案時同樣要成立
      for (let i = 0; i < texts.length; i += 1) for (let j = i + 1; j < texts.length; j += 1) {
        const a = texts[i], b = texts[j];
        const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        check('h', n, !(ix > 0.5 && iy > 0.5), `${a.id}「${a.text}」與 ${b.id}「${b.text}」互疊 ${ix.toFixed(1)}×${iy.toFixed(1)}pt`);
      }
      continue;
    }

    // ── 有檔案的卡：地圖類閘門 ──
    if (map) {
      // a1：文字框與地圖框
      for (const t of texts) {
        const ix = Math.min(t.x + t.w, map.x + map.w) - Math.max(t.x, map.x);
        const iy = Math.min(t.y + t.h, map.y + map.h) - Math.max(t.y, map.y);
        check('a1', n, !(ix > 0.05 && iy > 0.05), `${t.id}「${t.text}」的框與地圖框相交 ${ix.toFixed(1)}×${iy.toFixed(1)}pt`);
      }
      // a2：地圖藏起來後，地圖框內不該有任何墨跡（那就是文字字形侵入）
      const hidden = await loadPixels(join(out, 'shots', `${n}.hidden.png`));
      const bg = px(hidden, 1, 1);
      const x0 = Math.ceil((map.x + 0.5) * SCALE), x1 = Math.floor((map.x + map.w - 0.5) * SCALE);
      const y0 = Math.ceil((map.y + 0.5) * SCALE), y1 = Math.floor((map.y + map.h - 0.5) * SCALE);
      let ink = 0;
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) if (dist(px(hidden, x, y), bg) > 0.07) ink += 1;
      check('a2', n, ink === 0, `地圖框內有 ${ink} 個文字墨跡像素（字形壓到地圖）`);

      // b3：寬高比
      check('b3', n, Math.abs(map.w / map.h - fix.aspect) / fix.aspect < 0.01,
        `地圖框 ${map.w.toFixed(1)}×${map.h.toFixed(1)}（比 ${(map.w / map.h).toFixed(4)}）≠ payload.aspect ${fix.aspect}`);
      // 地圖框在內容框內
      check('e', n, map.x >= inset - 0.6 && map.y >= inset - 0.6 && map.x + map.w <= spec.w - inset + 0.6 && map.y + map.h <= spec.h - inset + 0.6,
        `地圖框超出內容框：${JSON.stringify(map)}`);

      // b1：畫了幾個點（三種狀態分開數）
      const want = { off: 0, follow: 0, solid: 0 };
      for (const d of ex.dots) want[['off', 'follow', 'solid'][d[3]]] += 1;
      const got = res.probe;
      check('b1', n, got.off === want.off && got.follow === want.follow && got.solid === want.solid,
        `畫出的點數 未收集/跟完/實心 = ${got.off}/${got.follow}/${got.solid}，payload 應為 ${want.off}/${want.follow}/${want.solid}`);

      // b2：每個點的座標像素不是底色
      const shipped = await loadPixels(join(out, 'shots', `${n}.png`));
      const sbg = px(shipped, 1, 1);
      let missing = 0;
      for (const d of ex.dots) {
        const [X, Y] = dotPixel(d, map);
        if (dist(px(shipped, X, Y), sbg) < 0.1) missing += 1;
      }
      check('b2', n, missing === 0, `${missing}/${ex.dots.length} 個點的座標上是底色（位置對不上或沒畫）`);

      // g：淡色 vs 實心 vs 未收集（只在合成三態）
      if (spec.state === 'states') {
        const bad = [];
        for (let row = 0; row < 10; row += 1) {
          const p = [0, 1, 2].map(s => px(shipped, ...dotPixel([200 + s * 300, 50 + row * 100], map)));
          const d = p.map(c => dist(c, sbg));
          if (!(d[1] <= 0.75 * d[2])) bad.push(`第${row}列 淡色離底色${d[1].toFixed(2)} 不比實心${d[2].toFixed(2)}淡`);
          // 淡色與未收集的灰要分得出來：兩個點的像素差（色相不同也算，不只看明暗）
          if (!(dist(p[1], p[0]) >= 0.25)) bad.push(`第${row}列 淡色與未收集的灰只差${dist(p[1], p[0]).toFixed(2)}，分不出來`);
        }
        check('g', n, bad.length === 0, bad.join('；'));
      }
    }

    // ── c：數字與 payload 一致 ──
    const numsOf = id => byId(id).map(t => nums(t.text));
    const expectNums = (id, want, label = id) => {
      const got = numsOf(id);
      check('c', n, got.length >= 1 && got.every(g => JSON.stringify(g) === JSON.stringify(want)),
        `${label} 數字 ${JSON.stringify(got)} ≠ 期望 ${JSON.stringify(want)}`);
    };
    const expectText = (id, want) => {
      const t = byId(id)[0];
      check('c', n, t && t.text === want, `${id} 文字「${t?.text}」≠ 期望「${want}」`);
    };
    const expectAbsent = (id) => check('c', n, byId(id).length === 0, `${id} 不該出現`);
    const isEmpty = ex.v === 0;

    if (spec.fam === 'circ') {
      expectNums('pct', [ex.pct]);
      expectText('pct', `${ex.pct}%`);
    } else if (isEmpty) {
      // 邀請文案（全灰地圖已由 b1 保證：off＝全部、follow／solid＝0）
      check('c', n, byId('empty.title').length === 1 && byId('empty.title')[0].text === '還沒有收集的車站', '空狀態少了邀請標題');
      if (spec.fam === 'small') expectAbsent('pct');
      else expectNums('pct', [0]);
      if (spec.fam === 'medium') expectNums('countOf', [0, ex.total]);
      if (spec.fam === 'rect') expectNums('pct', [0]);
      if (spec.fam === 'large') {
        expectNums('count', [0]);
        expectNums('totalLine', [ex.total, ex.total]);
        expectAbsent('recent.head');
      }
    } else if (spec.fam === 'small') {
      expectNums('pct', [ex.pct]); expectText('pct', `${ex.pct}%`);
      expectNums('count', [ex.v]); expectText('count', `已收集 ${ex.v} 座`);
      expectNums('remain', [ex.remain]); expectText('remain', `還有 ${ex.remain} 座`);
      expectText('title', ex.title);
    } else if (spec.fam === 'medium') {
      expectNums('pct', [ex.pct]); expectText('pct', `${ex.pct}%`);
      expectNums('countOf', [ex.v, ex.total]); expectText('countOf', `已收集 ${ex.v}／${ex.total} 座`);
      if (!ex.scoped) {
        const ids = texts.filter(f => /^sys\.[a-z]+\.count$/.test(f.id)).map(f => f.id.split('.')[1]);
        check('c', n, JSON.stringify(ids) === JSON.stringify(ex.top.map(s => s.k)),
          `中卡系統列 ${JSON.stringify(ids)} ≠ 依總站數排序的前 5 個有收集的系統 ${JSON.stringify(ex.top.map(s => s.k))}`);
        for (const s of ex.top) {
          expectNums(`sys.${s.k}.count`, [s.v, s.n]);
          expectText(`sys.${s.k}.count`, `${s.v}/${s.n}`);
          expectText(`sys.${s.k}.label`, s.label);
        }
        if (ex.untouched > 0) { expectNums('untouched', [ex.untouched]); expectText('untouched', `還有 ${ex.untouched} 個系統還沒去過`); }
        else expectAbsent('untouched');
      } else {
        expectNums('remain', [ex.remain]);
        const rows = ex.recent.slice(0, 2);
        rows.forEach((r, i) => expectText(`recent.${i}.date`, shortDate(r.d)));
        expectAbsent(`recent.${rows.length}.date`);
      }
    } else if (spec.fam === 'large') {
      expectNums('pct', [ex.pct]); expectText('pct', `${ex.pct}%`);
      expectNums('count', [ex.v]); expectText('count', `已收集 ${ex.v} 座`);
      expectNums('totalLine', [ex.total, ex.remain]);
      expectText('totalLine', `${ex.title} ${ex.total} 座 · 還有 ${ex.remain} 座`);
      const rows = ex.recent.slice(0, 4);
      rows.forEach((r, i) => {
        expectText(`recent.${i}.date`, shortDate(r.d));
        expectText(`recent.${i}.name`, r.name);
        expectText(`recent.${i}.line`, r.line);
      });
      expectAbsent(`recent.${rows.length}.date`);
      check('c', n, rows.length === 0 ? byId('recent.head').length === 0 : byId('recent.head').length === 1, '「最近蓋章」標題與資料筆數不一致');
      // 圖例：兩段都在，且沒有「今年新增」
      expectText('legend.solid', '實心＝搭過／到訪');
      expectText('legend.follow', '淡色＝跟完');
      check('c', n, !texts.some(t => /今年新增|已踩/.test(t.text)), '出現了不准出現的文案（今年新增／已踩）');
      // 10 個系統的直立條標籤
      for (const s of fix.sys) expectText(`pill.${s.k}.label`, s.label);
    } else if (spec.fam === 'rect') {
      expectNums('pct', [ex.pct]);
      expectNums('countOf', [ex.v, ex.total]);
      expectText('countOf', `已收集 ${ex.v}／${ex.total} 座`);
    }
    check('c', n, !texts.some(t => /已踩/.test(t.text)), '文案出現「已踩」');

    // ── c2：填滿比例 ──
    const fills = [];
    if (spec.fam === 'medium' && !isEmpty) {
      if (!ex.scoped) for (const s of ex.top) fills.push([`sys.${s.k}`, fillFrac(s.v, s.n), 'w']);
      else fills.push(['scopebar', fillFrac(ex.v, ex.total), 'w']);
    }
    if (spec.fam === 'rect' && !isEmpty) fills.push(['bar', fillFrac(ex.v, ex.total), 'w']);
    if (spec.fam === 'large') for (const s of fix.sys) fills.push([`pill.${s.k}`, fillFrac(s.v, s.n), 'h']);
    for (const [id, frac, axis] of fills) {
      const tr = frames.find(f => f.id === `${id}.track`), fl = frames.find(f => f.id === `${id}.fill`);
      if (!tr || !fl) { fail('c2', n, `${id} 沒有回報軌道／填滿框`); continue; }
      const got = fl[axis] / tr[axis];
      check('c2', n, Math.abs(got - frac) < 0.004, `${id} 填滿 ${got.toFixed(3)} ≠ 期望 ${frac.toFixed(3)}（v/n，有收集至少 3%）`);
    }
  }

  // insets 與發車看板同值
  const boardSrc = readFileSync(join(src, 'RailBoardWidget.swift'), 'utf8');
  const board = boardSrc.match(/enum RailBoardInsets\s*\{\s*static let content: CGFloat = (\d+)/)?.[1];
  const mine = readFileSync(join(src, 'CollectionCard.swift'), 'utf8').match(/static let inset: CGFloat = (\d+)/)?.[1];
  check('e', 'insets', board !== undefined && board === mine, `CollectionMetrics.inset=${mine} 與 RailBoardInsets.content=${board} 不同值`);
  if (String(INSET) !== mine) fail('e', 'insets', `腳本的內距 ${INSET} 與原始碼 ${mine} 不同`);

  return { fails, counts };
}

// ── 拼圖（淺色、深色各一張：小／中／大）─────────────────────────────────────────────
async function contactSheet(out, scheme) {
  const names = ['small', 'medium', 'large'].map(f => join(out, 'shots', `${f}-sample-${scheme}-430.png`));
  const tiles = [];
  for (const [i, path] of names.entries()) {
    const meta = await sharp(path).metadata();
    const radius = 22 * SCALE;
    const mask = Buffer.from(`<svg width="${meta.width}" height="${meta.height}"><rect width="${meta.width}" height="${meta.height}" rx="${radius}" ry="${radius}"/></svg>`);
    tiles.push({ buf: await sharp(path).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer(), w: meta.width, h: meta.height, i });
  }
  const pad = 24 * SCALE;
  const width = pad * 2 + Math.max(...tiles.map(t => t.w));
  const height = pad * (tiles.length + 1) + tiles.reduce((s, t) => s + t.h, 0);
  let y = pad;
  const layers = tiles.map(t => { const layer = { input: t.buf, left: Math.round((width - t.w) / 2), top: y }; y += t.h + pad; return layer; });
  const bg = scheme === 'dark' ? { r: 24, g: 26, b: 32 } : { r: 224, g: 229, b: 238 };
  const file = join(out, `contact-${scheme}.png`);
  await sharp({ create: { width, height, channels: 3, background: bg } }).composite(layers).png().toFile(file);
  return file;
}

// ── 突變測試：改「複本」，不改真檔 ───────────────────────────────────────────────────
const MUTATIONS = [
  {
    id: 'M1 地圖加寬壓到字',
    file: 'CollectionCard.swift',
    find: `        let mapW = (mapH * f.aspect).rounded()
        let colW`,
    replace: `        let mapW = (mapH * f.aspect * 2.2).rounded()
        let colW`,
    expect: ['a1', 'a2'],
  },
  {
    id: 'M2 拿掉 s=1 的淡色',
    file: 'CollectionCard.swift',
    find: 'static let followAlpha = 0.6',
    replace: 'static let followAlpha = 1.0',
    expect: ['g'],
  },
  {
    id: 'M3 文字欄變窄、關鍵數字被縮',
    file: 'CollectionCard.swift',
    find: 'let textW = (size.width * 0.58).rounded()',
    replace: 'let textW = (size.width * 0.30).rounded()',
    expect: ['d'],
  },
  {
    id: 'M4 單一系統誤把其他系統的點也畫進來',
    file: 'CollectionCard.swift',
    find: 'snap.pts.filter { $0.sys == index }',
    replace: 'snap.pts.filter { $0.sys >= 0 }',
    expect: ['b1'],
  },
  {
    id: 'M5 百分比改成無條件捨去',
    file: 'CollectionCard.swift',
    find: 'return min(100, (v * 200 + total) / (2 * total))',
    replace: 'return min(100, v * 100 / total)',
    expect: ['c'],
  },
  {
    id: 'M6 地圖點座標多位移一格',
    file: 'CollectionCard.swift',
    find: 'return CGPoint(x: inset + dot.x / 1000 * (size.width - 2 * inset),',
    replace: 'return CGPoint(x: inset + 6 + dot.x / 1000 * (size.width - 2 * inset),',
    expect: ['b2'],
  },
  {
    id: 'M7 進度條填滿比例只畫一半',
    file: 'CollectionCard.swift',
    find: 'return min(1, max(Double(v) / Double(n), 0.03))',
    replace: 'return min(1, max(Double(v) / Double(n) * 0.5, 0.03))',
    expect: ['c2'],
  },
  {
    id: 'M8 系統列高度壓扁、文字互疊',
    file: 'CollectionCard.swift',
    find: `        }
        .frame(height: k.pt(13))
    }
}`,
    replace: `        }
        .frame(height: k.pt(6))
    }
}`,
    expect: ['h'],
  },
  {
    id: 'M9 中卡文字欄整欄右移、超出內容框',
    file: 'CollectionCard.swift',
    find: `            column(f, k)
                .frame(width: colW, alignment: .topLeading)`,
    replace: `            column(f, k)
                .frame(width: colW, alignment: .topLeading)
                .offset(x: 14)`,
    expect: ['e'],
  },
];

function stageSource(dest, mutation) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const f of ['CollectionCard.swift', 'RailWidgetKit.swift', 'RailNativeL10n.swift', 'RailBoardWidget.swift']) {
    cpSync(join(realSrc, f), join(dest, f));
  }
  if (mutation) {
    const path = join(dest, mutation.file);
    const text = readFileSync(path, 'utf8');
    const hits = text.split(mutation.find).length - 1;
    if (hits !== 1) throw new Error(`突變「${mutation.id}」的錨點在原始碼裡出現 ${hits} 次（要恰好 1 次）：${mutation.find}`);
    writeFileSync(path, text.replace(mutation.find, mutation.replace));
  }
}

function summarize(counts) {
  return GATES.map(g => `${g} ${counts[g].pass}/${counts[g].pass + counts[g].fail}`).join('  ');
}

async function main() {
  mkdirSync(outRoot, { recursive: true });
  if (flag('--mutation-test')) {
    const report = [];
    const control = async label => {
      const dest = join(outRoot, 'mut-src-control');
      stageSource(dest, null);
      const run = runHarness({ src: dest, out: join(outRoot, `mut-${label}`), quick: true });
      const { fails, counts } = await judge({ ...run, specs: run.cases, out: join(outRoot, `mut-${label}`), src: dest });
      report.push({ id: `控制組（${label}）`, red: fails.length ? [...new Set(fails.map(f => f.gate))] : [], ok: fails.length === 0, summary: summarize(counts) });
      return fails.length === 0;
    };
    let allOk = await control('before');
    for (const m of MUTATIONS) {
      const dest = join(outRoot, 'mut-src');
      stageSource(dest, m);
      const out = join(outRoot, `mut-${m.id.split(' ')[0]}`);
      const run = runHarness({ src: dest, out, quick: true });
      const { fails, counts } = await judge({ ...run, specs: run.cases, out, src: dest });
      const red = [...new Set(fails.map(f => f.gate))];
      const detected = m.expect.every(g => red.includes(g));
      allOk = allOk && detected;
      report.push({ id: m.id, expect: m.expect, red, ok: detected, summary: summarize(counts), sample: fails.filter(f => m.expect.includes(f.gate)).slice(0, 2) });
    }
    allOk = (await control('after')) && allOk;
    for (const r of report) {
      console.log(`${r.ok ? '✓' : '✗'} ${r.id}${r.expect ? `（要紅 ${r.expect.join('、')}）` : '（要全綠）'} → 紅的閘門：${r.red.length ? r.red.join('、') : '無'}`);
      console.log(`    ${r.summary}`);
      for (const s of r.sample ?? []) console.log(`    · [${s.gate}] ${s.name}：${s.detail}`);
    }
    writeFileSync(join(outRoot, 'mutation-report.json'), JSON.stringify(report, null, 2));
    console.log(allOk ? '\n突變測試通過：每個突變都被指名的閘門抓到，控制組（前後）全綠。' : '\n突變測試失敗。');
    process.exit(allOk ? 0 : 1);
  }

  let src = resolve(opt('--src') ?? realSrc);
  if (LANG) {
    // 英日文：複本裡的 RailNativeL10n 改讀生成的目錄 JSON（裸 swiftc 沒有 lproj 可查）；真檔不動。
    const dest = `${outRoot}-src`; // 不放進 outRoot：runHarness 開頭會清空它
    stageSource(dest, null);
    const f = join(dest, 'RailNativeL10n.swift');
    const text = readFileSync(f, 'utf8');
    const anchor = 'var result = bundle.localizedString(forKey: key, value: key, table: nil)';
    if (text.split(anchor).length !== 2) throw new Error('RailNativeL10n.text 的錨點不是恰好 1 次');
    writeFileSync(f, text.replace(anchor, `var result = Self.shimTable[key] ?? key`).replace('static func text(', `static let shimTable: [String: String] = {
        let env = ProcessInfo.processInfo.environment
        guard let path = env["RAIL_L10N_JSON"], let lang = env["RAIL_L10N_LANG"],
              let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let table = (root["languages"] as? [String: Any])?[lang] as? [String: String] else { return [:] }
        return table
    }()

    static func text(`));
    src = dest;
  }
  for (const f of ['CollectionCard.swift', 'RailWidgetKit.swift', 'RailNativeL10n.swift', 'RailBoardWidget.swift']) {
    if (!existsSync(join(src, f))) throw new Error(`找不到 ${join(src, f)}`);
  }
  const run = runHarness({ src, out: outRoot, quick: flag('--quick') });
  const judged = await judge({ ...run, specs: run.cases, out: outRoot, src });
  const counts = judged.counts;
  const fails = LANG ? judged.fails.filter(f => f.gate !== 'c') : judged.fails; // 語言壓力測試：c 的期望值是繁中字串
  writeFileSync(join(outRoot, 'gates.json'), JSON.stringify({ counts, fails, lang: LANG ?? 'zh-TW' }, null, 2));
  if (!flag('--quick')) {
    console.log('拼圖：', await contactSheet(outRoot, 'light'), await contactSheet(outRoot, 'dark'));
  }
  console.log(`\n${run.cases.length} 個案例　${summarize(counts)}`);
  if (fails.length) {
    const shown = new Map();
    for (const f of fails) { const k = f.gate; shown.set(k, (shown.get(k) ?? 0) + 1); }
    console.error(`\n閘門紅 ${fails.length} 條（${[...shown].map(([g, c]) => `${g}×${c}`).join('、')}）：`);
    for (const f of fails.slice(0, 40)) console.error(` ✗ [${f.gate}] ${f.name}：${f.detail}`);
    process.exit(1);
  }
  console.log('閘門全綠。');
}

main().catch(e => { console.error(e); process.exit(1); });
