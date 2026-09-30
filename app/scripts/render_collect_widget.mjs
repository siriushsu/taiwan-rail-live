#!/usr/bin/env node
// 把「車站收集」小工具的四種家族（小、中、鎖屏矩形、鎖屏圓形）算繪成 PNG，並用一組閘門判定紅綠——
// 不必進模擬器、不必上手機。（2026-09-29 23:04 使用者裁示拿掉大卡，harness 的 large 案例與拼圖同步拿掉。）
//
// 做法（與 render_widget_kit.mjs 同型）：CollectionCard.swift 是純 SwiftUI 的版面檔（只依賴
// RailWidgetKit／RailNativeL10n），整檔逐字交給 swiftc 編成 macOS 執行檔，用 ImageRenderer 出 PNG。
// 不抽宣告：抽取有「抽到舊版」的風險；整檔納入的話，檔案哪天開始依賴別的檔，編譯當場失敗。
// Widget／Provider／EntryView（要 AppIntents、Color(uiColor:)）不在這個檔裡，由
// verify_widget_typecheck.mjs 以 iOS 目標整批型別檢查補上；它們只能靠 u 閘門靜態掃描。
//
// 🔴 期望值全部在這支腳本（node）從 payload 獨立重算，Swift 端只回報「量到什麼」：
//    Swift 端自己算的數字拿去對自己等於零資訊（判準與實作同源）。
//
// 閘門：
//   a1 文字框不與地圖框相交（PreferenceKey 回報的是每個 Text 自己的框，不是外層容器）
//   a2 文字【字形】不與地圖相交：地圖藏起來只佔位再算圖一次，地圖框內任何墨跡都是文字侵入
//   b1 Canvas 真的畫了幾個點（探針每畫一個記一筆）＝ payload 依範圍濾出的點數（其他系統灰／未收集／跟完／實心各自）
//   b2 每個應畫的點，畫面上那個座標的圓盤內有墨跡（位置對得上；空心圈的圓心是底色，所以量圓盤不量圓心）；b3 地圖寬高比＝payload.aspect
//   c  各數字（百分比含「<1%」「99%」邊界、座數、各系統 v／n、最近蓋章）與 payload 一致；圖例文字；c2 進度條填滿比例；
//      另含「內建示意資料 CollectionWidgetPreview.json ＝ 本腳本的樣本」
//   d  關鍵數字沒有被縮放或截成「…」（實際寬 ≥ 不受限的理想寬）
//   e  文字不超出內容框（16pt 內距；鎖屏 0）；h 文字與文字不互疊
//   v  【單一系統視窗】規格第二輪第 3 點：探針記下的每個圓心，與 node 依規格公式（外框＋pad、正方形視窗、
//      等比填滿地圖框）從 payload 獨立算出的座標一致（容差 ≤1.5pt；全台範圍同樣照整島框公式驗）；
//      單一系統（≥2 座站）的點陣外框至少撐開地圖框短邊的 50%；地圖框位置大小與同條件的全台卡一樣（版面不跳）
//   r  【空心圈】規格第二輪第 4 點，用合成三態 payload 量像素：s=2 圓心＝線色；s=1 圓心接近底色、圈上接近線色；
//      s=0 圓心＝未收集灰；淺色、深色、著色各驗一次。取代舊的 g（淡色 vs 實心；淡色已被空心圈取代）
//   u  【點小工具開旅程護照】靜態掃 Swift 原始碼：四種家族共用的最外層掛且只掛一次
//      widgetURL(railisland://passport)；supportedFamilies 沒有 systemLarge；RailMetroWaitPlugin 收 host passport
//      並帶 view:"passport"（小工具 target 編不進 harness，動態量不到，靜態掃是唯一守門人）
//
// 用法：node app/scripts/render_collect_widget.mjs [輸出目錄] [--quick] [--src <小工具原始碼目錄>]
//       node app/scripts/render_collect_widget.mjs --mutation-test [輸出目錄]
//       node app/scripts/render_collect_widget.mjs --emit-preview <路徑>   重寫 CollectionWidgetPreview.json（＝本腳本的樣本）
//       node app/scripts/render_collect_widget.mjs [輸出目錄] --lang en｜ja   英日文版面壓力測試：系統簡稱與文案換成該語言
//         （RailNativeL10n 在複本裡改讀 RailNativeL10n.json），c 閘門（繁中字串比對）不適用，其餘照跑；PNG 要人眼看
// 輸出：<目錄>/shots/*.png、contact-*.png、results.json、gates.json

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const realSrc = join(repo, 'app/ios/App/RailBoardWidget');
const appSrc = join(repo, 'app/ios/App/App');

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !['--src', '--lang', '--emit-preview'].includes(argv[i - 1]));
const LANG = opt('--lang'); // en｜ja：英日文版面壓力測試（見下方 langStress）
const outRoot = resolve(positional[0] ?? join(repo, 'tmp/collect-widget/ios-shots'));

// ── 尺寸：430pt 機型是設計基準，393pt 是 RailScale 下限那一側 ─────────────────────────
const SIZES = {
  430: { small: [170, 170], medium: [364, 170], rect: [160, 72], circ: [76, 76] },
  393: { small: [158, 158], medium: [338, 158], rect: [160, 72], circ: [76, 76] },
};
const INSET = 16;
const SCALE = 3;
const BG = { light: 0.98, dark: 0.09 };
/** 未收集灰（CollectionPalette.off）——r 閘門用；契約值，不是從 Swift 讀的。 */
const OFF_GRAY = { light: 0.88, dark: 0.24 };
const DOT_RADIUS_RATIO = 0.0075, DOT_RADIUS_FLOOR = 1.0, SOLID_SCALE = 1.3, RING_RATIO = 0.45;

// ── payload 樣本 ───────────────────────────────────────────────────────────────────────
// 樣本＝已進版控的 CollectionWidgetPreview.json（網頁 collectionWidgetPayload() 產生的示範 payload，recent 是下面
// RECENT_BY_SYS 合成的每系統最近蓋章；withRecent 對它是冪等的，c 閘門因此抓得到「合成表與預覽檔漂移」）。
// 空狀態＝同一份歸零：與網頁在沒有任何蓋章時送出的 payload 扣掉 at 逐欄相等（2026-09-30 對過）。
// Android 的案例產生器（app/scripts/android-collect-widget/gen_cases.py）讀同一份，兩個平台的示範資料不會分岔。
const samplePath = join(repo, 'app/ios/App/RailBoardWidget/CollectionWidgetPreview.json');
const sample = JSON.parse(readFileSync(samplePath, 'utf8'));
const emptyPayload = JSON.parse(JSON.stringify(sample));
emptyPayload.n = 0;
for (const sy of emptyPayload.sys) sy.v = 0;
for (const pt of emptyPayload.pts) pt[3] = 0;

/**
 * 每個系統各 4 筆以內的最近蓋章（規格第二輪第 2 點：payload 改成每系統各取最近 4 筆，
 * 合併後整體依 d 新到舊）。站名、線名都是示意資料。
 */
const RECENT_BY_SYS = {
  tra: [['菁桐', '平溪線', '2026-09-27'], ['十分', '平溪線', '2026-09-27'], ['池上', '臺東線', '2026-09-21'], ['瑞芳', '宜蘭線', '2026-09-12']],
  thsr: [['左營', '高鐵', '2026-09-20'], ['臺中', '高鐵', '2026-08-30']],
  trtc: [['淡水', '淡水信義線', '2026-09-25'], ['象山', '淡水信義線', '2026-09-25'], ['南港展覽館', '板南線', '2026-09-19'], ['動物園', '文湖線', '2026-09-08']],
  tymc: [['機場第一航廈', '機場捷運', '2026-09-14'], ['桃園', '機場捷運', '2026-09-14']],
  tmrt: [['高鐵臺中站', '綠線', '2026-09-16'], ['文心崇德', '綠線', '2026-09-16']],
  krtc: [['美麗島', '橘線', '2026-09-22'], ['西子灣', '橘線', '2026-09-22'], ['巨蛋', '紅線', '2026-09-20'], ['小港', '紅線', '2026-09-18']],
  ntdlrt: [['漁人碼頭', '藍海線', '2026-09-11']],
  sanying: [['鶯歌', '三鶯線', '2026-09-05']],
  afr: [['阿里山', '阿里山林鐵', '2026-09-10']],
};
/** --lang en 時把示意站名換成較長的英文（壓力測試用）；ja 保留原字。 */
const EN_NAMES = {
  菁桐: 'Jingtong', 十分: 'Shifen', 池上: 'Chishang', 瑞芳: 'Ruifang', 平溪線: 'Pingxi Line', 臺東線: 'Taitung Line', 宜蘭線: 'Yilan Line',
  左營: 'Zuoying', 臺中: 'Taichung', 高鐵: 'THSR', 淡水: 'Tamsui', 象山: 'Xiangshan', 南港展覽館: 'Taipei Nangang Exhibition Center',
  動物園: 'Taipei Zoo', 淡水信義線: 'Tamsui-Xinyi Line', 板南線: 'Bannan Line', 文湖線: 'Wenhu Line', 機場第一航廈: 'Taoyuan Airport Terminal 1',
  桃園: 'Taoyuan', 機場捷運: 'Taoyuan Airport MRT', 高鐵臺中站: 'HSR Taichung', 文心崇德: 'Wenxin Chongde', 綠線: 'Green Line',
  美麗島: 'Formosa Boulevard', 西子灣: 'Sizihwan', 巨蛋: 'Kaohsiung Arena', 小港: 'Siaogang', 橘線: 'Orange Line', 紅線: 'Red Line',
  漁人碼頭: "Fisherman's Wharf", 藍海線: 'Blue Ocean Line', 鶯歌: 'Yingge', 三鶯線: 'Sanying Line', 阿里山: 'Alishan', 阿里山林鐵: 'Alishan Forest Railway',
};
/** 依 payload 的 sys.v 產生 recent：有收集的系統才有；整體依 d 新到舊，同日依系統順序（fixture 沒有 n 可比）。 */
function withRecent(p) {
  const items = [];
  p.sys.forEach((sy, i) => {
    if (sy.v > 0) for (const [name, line, d] of RECENT_BY_SYS[sy.k] ?? []) items.push({ name, line, k: sy.k, d, i });
  });
  items.sort((a, b) => b.d.localeCompare(a.d) || a.i - b.i);
  p.recent = items.map(({ i, ...rest }) => rest);
  return p;
}
withRecent(sample);
withRecent(emptyPayload);

/**
 * --lang en｜ja：把 payload 的系統簡稱換成網頁端 COLLECT_SYS 在該語言實際送出的 label（index.html），
 * 最近蓋章的站名換成較長的英文。用途只有一個：量英日文字串在各版面會不會被縮、被截、互疊。
 * 這個模式下 c 閘門（字串逐字比對，期望值是繁中）不適用，其餘閘門照跑。
 */
const LANG_LABELS = {
  en: ['TRA', 'THSR', 'Taipei', 'Airport', 'Taichung', 'Kaohsiung', 'Danhai', 'Ankeng', 'Sanying', 'Alishan'],
  ja: ['台鉄', '高鉄', '台北', '空港', '台中', '高雄', '淡海', '安坑', '三鶯', '阿里山'],
};
const langStress = p => {
  p.sys.forEach((sy, i) => { sy.label = LANG_LABELS[LANG][i]; });
  if (LANG === 'en') for (const r of p.recent) { r.name = EN_NAMES[r.name] ?? r.name; r.line = EN_NAMES[r.line] ?? r.line; }
  return p;
};
if (LANG) {
  if (!LANG_LABELS[LANG]) throw new Error(`--lang 只收 ${Object.keys(LANG_LABELS).join('、')}`);
  langStress(sample);
  langStress(emptyPayload);
}

const clone = o => JSON.parse(JSON.stringify(o));
/** 全收滿：n＝total、每系統 v＝n、每個點 s=2（測 100% 的寬度與滿條）。 */
function fullPayload() {
  const p = clone(sample);
  p.n = p.total;
  for (const s of p.sys) s.v = s.n;
  for (const pt of p.pts) pt[3] = 2;
  return withRecent(p);
}
/** 只收 1 站：全台 1/538 與台鐵 1/241 都四捨五入成 0 → 「<1%」，進度條要靠 3% 下限才看得見。 */
function onePayload() {
  const p = clone(emptyPayload);
  p.n = 1;
  p.sys[0].v = 1;
  p.pts.find(pt => pt[4] === 0)[3] = 2;
  return withRecent(p);
}
/** 只差 1 站收滿：全台 537/538＝99.81%、台鐵 240/241＝99.59%，都四捨五入成 100 → 顯示「99%」。 */
function almostPayload() {
  const p = clone(sample);
  p.n = p.total - 1;
  for (const s of p.sys) s.v = s.n;
  p.sys[0].v -= 1;
  for (const pt of p.pts) pt[3] = 2;
  p.pts.find(pt => pt[4] === 0)[3] = 0;
  return withRecent(p);
}
/** 林鐵只剩 1 座站（且已收集）：單一系統視窗的下限路徑（w＝h＝0 → pad 10、邊長 40），外框門檻對它豁免。 */
function soloPayload() {
  const p = clone(sample);
  const first = p.pts.findIndex(pt => pt[4] === 9);
  p.pts = p.pts.filter((pt, i) => pt[4] !== 9 || i === first);
  p.pts[p.pts.findIndex(pt => pt[4] === 9)][3] = 2;
  p.sys[9].v = 1; p.sys[9].n = 1;
  p.n += 1; p.total -= 20;
  return withRecent(p);
}
/**
 * 合成的「三態」payload：十個系統各一列，每列 s=0／1／2 各一點，列距與欄距都遠大於點徑，
 * 每個點都孤立——拿來量「空心 vs 實心 vs 未收集」的像素，不受相鄰點疊色干擾。
 */
const STATE_COLORS = ['#5D6D7E', '#FFDB00', '#F48B9F', '#79BCE8', '#8CC8A0', '#6A8EAE', '#E85D0D', '#0070BD', '#C0392B', '#8246AF'];
function statesPayload() {
  // 取自真實線色，特意含最難分辨的淡色（黃、粉、淺藍、淺綠）與灰藍（台鐵幹線 #5D6D7E）。
  const p = clone(sample);
  p.pts = [];
  STATE_COLORS.forEach((c, row) => [0, 1, 2].forEach((s, col) => p.pts.push([200 + col * 300, 50 + row * 100, c, s, row])));
  p.sys.forEach(s => { s.v = 2; s.n = 3; });
  p.n = 20; p.total = 30;
  return p;
}
const FIXTURES = {
  sample, empty: emptyPayload, none: null, full: fullPayload(), one: onePayload(), almost: almostPayload(),
  solo: soloPayload(), states: statesPayload(),
};

// ── 期望值：從 payload 獨立重算（不讀任何 Swift 端的數字）──────────────────────────────
/** 百分比數字部分（規格第二輪第 5 點）：四捨五入；有收集卻成 0 → '<1'；沒收滿卻成 100 → '99'。 */
function pctNumber(v, total) {
  const p = v > 0 && total > 0 ? Math.min(100, Math.round((v * 100) / total)) : 0;
  if (v > 0 && p === 0) return '<1';
  if (v < total && p >= 100) return '99';
  return String(p);
}
/** 單一系統視窗（規格第二輪第 3 點）：外框＋pad、正方形、以外框中心為中心。 */
function windowOf(pts) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  const pad = Math.max(0.12 * Math.max(w, h), 10);
  const S = Math.max(w + 2 * pad, h + 2 * pad, 40);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return { x0: cx - S / 2, y0: cy - S / 2, S };
}
const inWindow = (vp, p) => p[0] >= vp.x0 && p[0] <= vp.x0 + vp.S && p[1] >= vp.y0 && p[1] <= vp.y0 + vp.S;

function expected(fix, scope) {
  const idx = scope ? fix.sys.findIndex(s => s.k === scope) : -1;
  const scoped = idx >= 0;
  const v = scoped ? fix.sys[idx].v : fix.n;
  const total = scoped ? fix.sys[idx].n : fix.total;
  const own = fix.pts.filter(p => (scoped ? p[4] === idx : true));
  const vp = scoped && own.length ? windowOf(own) : null;
  const others = scoped ? fix.pts.filter(p => p[4] !== idx && (!vp || inWindow(vp, p))) : [];
  const recent = (scoped ? fix.recent.filter(r => r.k === scope) : fix.recent).slice(0, 4);
  const top = fix.sys.map((s, i) => ({ ...s, i })).filter(s => s.v > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i).slice(0, 5);
  const pctNum = pctNumber(v, total);
  return {
    scoped, v, total, pctNum, pctText: `${pctNum}%`, remain: Math.max(0, total - v),
    dots: own, vp, others, recent, top,
    untouched: fix.sys.filter(s => s.v === 0).length,
    title: scoped ? fix.sys[idx].label : '全台',
    aspect: fix.aspect,
  };
}
const fillFrac = (v, n) => (n > 0 && v > 0 ? Math.min(1, Math.max(v / n, 0.03)) : 0);
const shortDate = d => { const m = d.split('-'); return m.length === 3 ? `${Number(m[1])}/${Number(m[2])}` : d; };
const nums = s => (s ?? '').match(/\d+/g)?.map(Number) ?? [];

/** 點在地圖框內（Canvas 座標，pt）的期望圓心。公式是契約的一部分：留出已收集點半徑當內距；全台 u＝x/1000，單一系統 u＝(x−x0)/S。 */
function expectedCenters(ex, map) {
  const r = Math.max(DOT_RADIUS_FLOOR, map.h * DOT_RADIUS_RATIO), inset = r * SOLID_SCALE;
  const at = d => {
    const u = ex.vp ? (d[0] - ex.vp.x0) / ex.vp.S : d[0] / 1000;
    const v = ex.vp ? (d[1] - ex.vp.y0) / ex.vp.S : d[1] / 1000;
    return [inset + u * (map.w - 2 * inset), inset + v * (map.h - 2 * inset)];
  };
  const out = { other: ex.others.map(at), off: [], follow: [], solid: [] };
  for (const d of ex.dots) out[['off', 'follow', 'solid'][d[3]]].push(at(d));
  return { ...out, r, R: r * SOLID_SCALE };
}

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
    for (const sc of ['tra', 'krtc']) for (const scheme of ['light', 'dark']) add('small', sc, 'sample', scheme, false, 430);
    add('medium', null, 'sample', 'light', false, 430);
    add('medium', null, 'sample', 'dark', false, 430);
    add('medium', null, 'sample', 'light', false, 393);
    for (const sc of ['tra', 'krtc']) add('medium', sc, 'sample', 'light', false, 430);
    add('rect', null, 'sample', 'dark', true, 430);
    add('circ', null, 'sample', 'dark', true, 430);
    // 百分比兩個邊界（<1%、99%）：小／中／鎖屏矩形／鎖屏圓形，全台與單一系統
    for (const st of ['one', 'almost']) {
      add('small', null, st, 'light', false, 430);
      add('small', 'tra', st, 'light', false, 430);
      add('medium', null, st, 'light', false, 430);
      add('rect', null, st, 'light', true, 430);
      add('circ', null, st, 'light', true, 430);
    }
    for (const [scheme, mono] of [['light', false], ['dark', false], ['light', true], ['dark', true]]) add('small', null, 'states', scheme, mono, 430);
    return cases;
  }
  const famList = [['small', null], ['small', 'tra'], ['medium', null], ['medium', 'tra'], ['rect', null], ['circ', null]];
  const isLock = fam => fam === 'rect' || fam === 'circ';
  for (const width of [430, 393]) {
    for (const [fam, scope] of famList) {
      for (const state of ['sample', 'empty', 'none']) {
        for (const scheme of ['light', 'dark']) add(fam, scope, state, scheme, isLock(fam), width);
      }
    }
    // 其他單一系統：北捷（緊湊、寬高比接近方）、高捷（單線且有最近蓋章）淺深色；
    // 安坑（一站都沒收）、三鶯（只收 1 站、最近蓋章 1 筆）淺色
    for (const fam of ['small', 'medium']) {
      for (const sc of ['trtc', 'krtc']) for (const scheme of ['light', 'dark']) add(fam, sc, 'sample', scheme, false, width);
      for (const sc of ['ntalrt', 'sanying']) add(fam, sc, 'sample', 'light', false, width);
      add(fam, 'afr', 'solo', 'light', false, width); // 只有 1 座站的系統（視窗下限路徑）
    }
    // 邊界：全收滿（100%）、只收 1 站（<1%）、只差 1 站（99%）
    for (const [fam, scope] of famList) {
      for (const state of ['full', 'one', 'almost']) add(fam, scope, state, 'light', isLock(fam), width);
    }
  }
  // 著色（tinted／accented）：桌面兩種尺寸的淺色與深色，全台與單一系統
  for (const fam of ['small', 'medium']) {
    for (const scheme of ['light', 'dark']) { add(fam, null, 'sample', scheme, true, 430); add(fam, 'tra', 'sample', scheme, true, 430); }
  }
  // 合成三態（像素判準用）：淺色、深色、著色淺色、著色深色
  for (const [scheme, mono] of [['light', false], ['dark', false], ['light', true], ['dark', true]]) add('small', null, 'states', scheme, mono, 430);
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
    // 蓋章鈕在 harness 只畫外觀（{ $0 }）：小卡的 Button(intent:)、中卡的 Link 都在 CollectionWidget.swift
    // （AppIntents 編不進來、ImageRenderer 畫不出 Link），由 s 閘門靜態掃。
    case "small": return AnyView(SmallCollectionView(content: content) { $0 })
    case "medium": return AnyView(MediumCollectionView(content: content) { $0 })
    case "rect": return AnyView(RectangularCollectionView(content: content))
    case "circ": return AnyView(CircularCollectionView(content: content))
    default: fatalError("unknown family \\(fam)")
    }
}

func pts(_ a: [CGPoint]) -> [[Double]] { a.map { [Double($0.x), Double($0.y)] } }

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

            // B：量測——每個文字／進度條回報自己的範圍，Canvas 每畫一個點記下圓心。
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
                "probe": ["other": pts(probe.other), "off": pts(probe.off),
                          "follow": pts(probe.follow), "solid": pts(probe.solid)],
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
/** 圓盤（半徑 rad px）內有沒有任何像素離底色 ≥ 0.1（有墨跡）。cx、cy 是浮點 px 座標。 */
function inkWithin(img, cx, cy, rad, bg) {
  for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y += 1) {
    for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x += 1) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= rad * rad && dist(px(img, x, y), bg) >= 0.1) return true;
    }
  }
  return false;
}
/**
 * 期望線色（r 閘門）：淺色＝原色；深色＝各通道 ×1.25 夾到 1（CollectionPalette.color 的契約）；
 * 著色＝primary（淺黑深白）。harness 跑在 macOS，`Color.primary` 是 labelColor＝alpha 0.85 的黑／白，
 * 疊在底色上：淺色 0.85×0＋0.15×0.98＝0.147、深色 0.85×1＋0.15×0.09＝0.864（iOS 上是不透明黑／白，
 * 那邊的著色由系統統一上色，不歸這道閘門管）。
 */
function lineColor(hex, scheme, mono) {
  if (mono) { const v = scheme === 'dark' ? 0.85 + 0.15 * BG.dark : 0.15 * BG.light; return [v, v, v]; }
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(c => Math.min(1, (c / 255) * (scheme === 'dark' ? 1.25 : 1)));
}
/** 兩組圓心（pt）做最近鄰配對，回最大距離；筆數不同回 Infinity。 */
function matchMaxDist(got, want) {
  if (got.length !== want.length) return Infinity;
  const used = new Array(got.length).fill(false);
  let worst = 0;
  for (const w of want) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < got.length; i += 1) {
      if (used[i]) continue;
      const d = Math.hypot(got[i][0] - w[0], got[i][1] - w[1]);
      if (d < bd) { bd = d; best = i; }
    }
    used[best] = true;
    worst = Math.max(worst, bd);
  }
  return worst;
}

// ── 靜態掃描（u 閘門）──────────────────────────────────────────────────────────────
// 去掉 Swift 的行註解與區塊註解（不處理字串裡的雙斜線——這幾支檔的字串沒有）。
const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/[^\n"]*$/gm, '');
/** 從 open（含 '{'）位置起配對大括號，回結束位置。 */
function matchBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}
/** src 目錄有就用（突變測試的複本、--src），沒有就退回 repo 內的真檔。 */
function srcFile(src, name) {
  const inSrc = join(src, name);
  if (existsSync(inSrc)) return readFileSync(inSrc, 'utf8');
  for (const dir of [realSrc, appSrc]) if (existsSync(join(dir, name))) return readFileSync(join(dir, name), 'utf8');
  throw new Error(`找不到 ${name}`);
}
function staticGate(src, check) {
  const widget = stripComments(srcFile(src, 'CollectionWidget.swift'));
  const card = stripComments(srcFile(src, 'CollectionCard.swift'));
  const plugin = stripComments(srcFile(src, 'RailMetroWaitPlugin.swift'));
  const URL_CALL = '.widgetURL(URL(string: "railisland://passport"))';
  const calls = widget.split('.widgetURL(').length - 1;
  check('u', 'CollectionWidget.swift', calls === 1 && widget.includes(URL_CALL),
    `CollectionWidget.swift 的 .widgetURL( 出現 ${calls} 次（要恰好 1 次，且是 ${URL_CALL}）`);
  // 掛在 EntryView 的最外層：在 body 裡、且位於家族 switch 的大括號【之外】（掛在某個 case 裡只會有那一種尺寸點得開）
  const body = widget.indexOf('struct CollectionEntryView');
  const sw = widget.indexOf('switch family {', body);
  const swEnd = sw >= 0 ? matchBrace(widget, sw + 'switch family '.length) : -1;
  const at = widget.indexOf('.widgetURL(');
  check('u', 'CollectionWidget.swift', body >= 0 && sw >= 0 && swEnd > sw && at > swEnd && at < widget.indexOf('struct CollectionWidget:'),
    `.widgetURL 的位置不在 CollectionEntryView 的家族 switch 之外（位置 ${at}，switch ${sw}–${swEnd}）——鎖屏或某個尺寸點了不會開護照`);
  const fam = widget.match(/\.supportedFamilies\(\[([^\]]*)\]\)/)?.[1] ?? '';
  const list = fam.split(',').map(s => s.trim()).filter(Boolean);
  check('u', 'CollectionWidget.swift', JSON.stringify(list) === JSON.stringify(['.systemSmall', '.systemMedium', '.accessoryRectangular', '.accessoryCircular']),
    `supportedFamilies＝${JSON.stringify(list)}，應只有 小、中、鎖屏矩形、鎖屏圓形（使用者不要大卡）`);
  check('u', 'CollectionCard.swift', !/systemLarge|LargeCollectionView/.test(widget + card), 'Collection*.swift 裡還有 systemLarge／LargeCollectionView');
  // plugin：handleOpen 接受 host passport，forwardOpen 對 passport 帶 view:"passport"
  const guardLine = plugin.match(/guard url\.scheme == "railisland",[\s\S]*?else \{ return false \}/)?.[0] ?? '';
  check('u', 'RailMetroWaitPlugin.swift', /url\.host == "passport"/.test(guardLine), 'handleOpen 沒有接受 host passport');
  check('u', 'RailMetroWaitPlugin.swift', /comps\.host == "passport"\s*\{\s*data\["view"\]\s*=\s*"passport"\s*\}/.test(plugin),
    'forwardOpen 沒有對 passport 帶 view:"passport"');
}

// ── 閘門 ────────────────────────────────────────────────────────────────────────────
const GATES = ['a1', 'a2', 'b1', 'b2', 'b3', 'c', 'c2', 'd', 'e', 'h', 'v', 'r', 'u'];

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
    for (let i = 0; i < texts.length; i += 1) for (let j = i + 1; j < texts.length; j += 1) {
      const a = texts[i], b = texts[j];
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      check('h', n, !(ix > 0.5 && iy > 0.5), `${a.id}「${a.text}」與 ${b.id}「${b.text}」互疊 ${ix.toFixed(1)}×${iy.toFixed(1)}pt`);
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

      // b1：畫了幾個點（其他系統灰／未收集／跟完／實心分開數）
      const exp = expectedCenters(ex, map);
      const got = res.probe;
      const kinds = ['other', 'off', 'follow', 'solid'];
      check('b1', n, kinds.every(k => got[k].length === exp[k].length),
        `畫出的點數 其他系統灰/未收集/跟完/實心 = ${kinds.map(k => got[k].length).join('/')}，payload 應為 ${kinds.map(k => exp[k].length).join('/')}`);

      // b2：每個點的座標圓盤內有墨跡（含視窗內的其他系統灰點）
      const shipped = await loadPixels(join(out, 'shots', `${n}.png`));
      const sbg = px(shipped, 1, 1);
      let missing = 0, total = 0;
      for (const k of kinds) for (const [lx, ly] of exp[k]) {
        total += 1;
        if (!inkWithin(shipped, (map.x + lx) * SCALE, (map.y + ly) * SCALE, exp.R * SCALE + 0.5, sbg)) missing += 1;
      }
      check('b2', n, missing === 0, `${missing}/${total} 個點的座標上是底色（位置對不上或沒畫）`);

      // v：圓心位置（全台整島框、單一系統視窗，同一套公式）、單一系統的外框、地圖框不因範圍而跳
      const worst = {};
      for (const k of kinds) worst[k] = matchMaxDist(got[k], exp[k]);
      check('v', n, kinds.every(k => worst[k] <= 1.5),
        `圓心與公式座標不符（容差 1.5pt）：${kinds.map(k => `${k} 最大差 ${Number.isFinite(worst[k]) ? worst[k].toFixed(1) + 'pt' : '筆數不同'}`).join('、')}${ex.vp ? `；視窗 x0=${ex.vp.x0.toFixed(1)} y0=${ex.vp.y0.toFixed(1)} S=${ex.vp.S.toFixed(1)}` : '（全台整島框）'}`);
      if (ex.scoped && ex.dots.length > 1) {
        const c = [...got.off, ...got.follow, ...got.solid];
        const xs = c.map(p => p[0]), ys = c.map(p => p[1]);
        const ext = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        const short = Math.min(map.w, map.h);
        check('v', n, ext >= 0.5 * short,
          `單一系統的點陣外框只撐開地圖框短邊的 ${(100 * ext / short).toFixed(0)}%（<50%；${ex.dots.length} 座站，像是仍用整島框）`);
      }
      if (ex.scoped) {
        const baseSpec = specs.find(s => !s.scope && s.fam === spec.fam && s.state === spec.state && s.scheme === spec.scheme && s.mono === spec.mono && s.width === spec.width);
        const baseMap = baseSpec && results.find(r => r.name === baseSpec.name)?.frames.find(f => f.id === 'map');
        if (baseMap) {
          check('v', n, ['x', 'y', 'w', 'h'].every(k => Math.abs(baseMap[k] - map[k]) <= 0.5),
            `單一系統的地圖框 ${JSON.stringify(map)} 與全台的 ${JSON.stringify(baseMap)} 不同（版面會跳）`);
        }
      }

      // r：合成三態的像素（空心圈）
      if (spec.state === 'states') {
        const bad = [];
        const r = exp.r, R = exp.R, ringMid = R - (R * RING_RATIO) / 2;
        const bgc = [BG[spec.scheme], BG[spec.scheme], BG[spec.scheme]];
        const off = [OFF_GRAY[spec.scheme], OFF_GRAY[spec.scheme], OFF_GRAY[spec.scheme]];
        const cell = (x, y) => px(shipped, Math.floor(x), Math.floor(y));
        for (let row = 0; row < 10; row += 1) {
          const line = lineColor(STATE_COLORS[row], spec.scheme, spec.mono);
          const gap = dist(line, bgc);
          if (gap < 0.5) bad.push(`第${row}列 線色離底色只有 ${gap.toFixed(2)}，fixture 分不出來`);
          const at = s => {
            const d = [200 + s * 300, 50 + row * 100];
            const inset2 = r * SOLID_SCALE;
            return [(map.x + inset2 + (d[0] / 1000) * (map.w - 2 * inset2)) * SCALE, (map.y + inset2 + (d[1] / 1000) * (map.h - 2 * inset2)) * SCALE];
          };
          const [c0, c1, c2] = [0, 1, 2].map(at);
          const p0 = cell(...c0), p1 = cell(...c1), p2 = cell(...c2);
          if (!(dist(p2, line) <= 0.12)) bad.push(`第${row}列 實心圓心 ${p2.map(v => v.toFixed(2))} 離線色 ${line.map(v => v.toFixed(2))} 太遠`);
          if (!(dist(p1, bgc) <= 0.08)) bad.push(`第${row}列 空心圈圓心 ${p1.map(v => v.toFixed(2))} 不是底色（圈中間被填了）`);
          if (!(dist(p0, off) <= 0.08)) bad.push(`第${row}列 未收集點圓心 ${p0.map(v => v.toFixed(2))} 不是未收集灰`);
          if (!(dist(p1, p2) >= 0.5 * gap)) bad.push(`第${row}列 空心圓心與實心圓心只差 ${dist(p1, p2).toFixed(2)}，分不出空心與實心`);
          // 圈上：圈寬中線半徑上、八個方向各取一點，都要比「一半」更接近線色
          const ringPx = ringMid * SCALE;
          const weak = [];
          for (let a = 0; a < 8; a += 1) {
            const q = cell(c1[0] + ringPx * Math.cos((a * Math.PI) / 4), c1[1] + ringPx * Math.sin((a * Math.PI) / 4));
            if (!(dist(q, line) <= 0.5 * gap)) weak.push(a * 45);
          }
          if (weak.length) bad.push(`第${row}列 圈上 ${weak.join('、')}° 的像素不接近線色（圈不見或太細）`);
        }
        check('r', n, bad.length === 0, bad.slice(0, 4).join('；'));
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
    const expectAbsent = id => check('c', n, byId(id).length === 0, `${id} 不該出現`);
    const isEmpty = ex.v === 0;

    if (spec.fam === 'circ') {
      expectText('pct', ex.pctText);
    } else if (isEmpty) {
      // 邀請文案（全灰地圖已由 b1 保證：off＝全部、follow／solid＝0）
      check('c', n, byId('empty.title').length === 1 && byId('empty.title')[0].text === '還沒有收集的車站', '空狀態少了邀請標題');
      if (spec.fam === 'small') expectAbsent('pct');
      else expectText('pct', '0%');
      if (spec.fam === 'medium') expectNums('countOf', [0, ex.total]);
      if (spec.fam === 'medium') { expectAbsent('legend.solid'); expectAbsent('legend.follow'); } // 空狀態沒有實心也沒有空心，不放圖例
    } else if (spec.fam === 'small') {
      expectText('pct', ex.pctText); expectNums('pct', nums(ex.pctText));
      expectNums('count', [ex.v]); expectText('count', `已收集 ${ex.v} 座`);
      expectNums('remain', [ex.remain]); expectText('remain', `還有 ${ex.remain} 座`);
      expectText('title', ex.title);
    } else if (spec.fam === 'medium') {
      expectText('pct', ex.pctText); expectNums('pct', nums(ex.pctText));
      expectNums('countOf', [ex.v, ex.total]); expectText('countOf', `已收集 ${ex.v}／${ex.total} 座`);
      // 圖例：兩段都在（規格第二輪第 4 點：「實心＝搭過／到訪」「空心＝跟完」）
      expectText('legend.solid', '實心＝搭過／到訪');
      expectText('legend.follow', '空心＝跟完');
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
        expectAbsent('recent.0.date'); // 全台中卡不畫最近蓋章
      } else {
        expectNums('remain', [ex.remain]);
        // 單一系統的最近蓋章：只取 k 相符的；中卡放得下 2 筆（放不下的量測見回報）
        const rows = ex.recent.slice(0, 2);
        rows.forEach((r, i) => {
          expectText(`recent.${i}.date`, shortDate(r.d));
          expectText(`recent.${i}.name`, r.name);
          expectText(`recent.${i}.line`, r.line);
        });
        expectAbsent(`recent.${rows.length}.date`);
      }
    } else if (spec.fam === 'rect') {
      expectText('pct', ex.pctText);
      expectNums('countOf', [ex.v, ex.total]);
      expectText('countOf', `已收集 ${ex.v}／${ex.total} 座`);
    }
    check('c', n, !texts.some(t => /已踩|今年新增|淡色/.test(t.text)), '出現了不准出現的文案（已踩／今年新增／淡色）');
    if (spec.fam !== 'medium') { expectAbsent('legend.solid'); expectAbsent('legend.follow'); }

    // ── c2：填滿比例 ──
    const fills = [];
    if (spec.fam === 'medium' && !isEmpty) {
      if (!ex.scoped) for (const s of ex.top) fills.push([`sys.${s.k}`, fillFrac(s.v, s.n), 'w']);
      else fills.push(['scopebar', fillFrac(ex.v, ex.total), 'w']);
    }
    if (spec.fam === 'rect' && !isEmpty) fills.push(['bar', fillFrac(ex.v, ex.total), 'w']);
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

  // 內建示意資料（小工具圖庫預覽與 placeholder 用）＝本腳本的樣本：兩邊不一致，圖庫看到的就不是驗過的那份
  if (!LANG) {
    const previewPath = join(realSrc, 'CollectionWidgetPreview.json');
    const preview = existsSync(previewPath) ? JSON.parse(readFileSync(previewPath, 'utf8')) : null;
    check('c', 'CollectionWidgetPreview.json', preview && JSON.stringify(preview) === JSON.stringify(sample),
      'CollectionWidgetPreview.json 與本腳本的樣本（它自己＋RECENT_BY_SYS 合成的每系統最近蓋章）不同——RECENT_BY_SYS 改過就用 --emit-preview 重寫');
    if (preview) {
      const withRecents = preview.sys.filter(s => s.v > 0).every(s => preview.recent.some(r => r.k === s.k));
      check('c', 'CollectionWidgetPreview.json', withRecents, '內建示意資料：有收集的系統沒有最近蓋章（單一系統中卡會畫不出來）');
    }
  }

  staticGate(src, check);
  return { fails, counts };
}

// ── 拼圖 ─────────────────────────────────────────────────────────────────────────────
/** rows：每列一串 shots 檔名（不含 .png）。每張圓角裁切，背景依 scheme；輸出到 out/<file>。 */
async function contactSheet(out, file, rows, scheme) {
  const laid = [];
  for (const row of rows) {
    const tiles = [];
    for (const name of row) {
      const path = join(out, 'shots', `${name}.png`);
      const meta = await sharp(path).metadata();
      const radius = /^circ/.test(name) ? meta.width / 2 : (/^rect/.test(name) ? 14 : 22) * SCALE;
      const mask = Buffer.from(`<svg width="${meta.width}" height="${meta.height}"><rect width="${meta.width}" height="${meta.height}" rx="${radius}" ry="${radius}"/></svg>`);
      tiles.push({ buf: await sharp(path).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer(), w: meta.width, h: meta.height });
    }
    laid.push(tiles);
  }
  const pad = 24 * SCALE;
  const width = pad + Math.max(...laid.map(r => r.reduce((s, t) => s + t.w + pad, 0)));
  const height = pad + laid.reduce((s, r) => s + Math.max(...r.map(t => t.h)) + pad, 0);
  const layers = [];
  let y = pad;
  for (const tiles of laid) {
    let x = pad;
    for (const t of tiles) { layers.push({ input: t.buf, left: x, top: y }); x += t.w + pad; }
    y += Math.max(...tiles.map(t => t.h)) + pad;
  }
  const bg = scheme === 'dark' ? { r: 24, g: 26, b: 32 } : { r: 224, g: 229, b: 238 };
  const path = join(out, file);
  await sharp({ create: { width, height, channels: 3, background: bg } }).composite(layers).png().toFile(path);
  return path;
}
async function contactSheets(out) {
  const s = (fam, scope, state, scheme, mono = false, width = 430) => `${fam}${scope ? '-' + scope : ''}-${state}-${scheme}${mono ? '-tinted' : ''}-${width}`;
  const pair = (scope, state, scheme, mono = false, width = 430) => [s('small', scope, state, scheme, mono, width), s('medium', scope, state, scheme, mono, width)];
  const made = [];
  made.push(await contactSheet(out, 'contact-light.png', [pair(null, 'sample', 'light'), pair(null, 'empty', 'light'), pair(null, 'sample', 'light', false, 393)], 'light'));
  made.push(await contactSheet(out, 'contact-dark.png', [pair(null, 'sample', 'dark'), pair(null, 'empty', 'dark'), pair(null, 'sample', 'dark', false, 393)], 'dark'));
  made.push(await contactSheet(out, 'contact-scoped.png',
    [pair('tra', 'sample', 'light'), pair('trtc', 'sample', 'light'), pair('krtc', 'sample', 'light'), pair('ntalrt', 'sample', 'light'), pair('sanying', 'sample', 'light'), pair('afr', 'solo', 'light')], 'light'));
  made.push(await contactSheet(out, 'contact-scoped-dark.png', [pair('tra', 'sample', 'dark'), pair('trtc', 'sample', 'dark'), pair('krtc', 'sample', 'dark'), pair('krtc', 'sample', 'dark', false, 393)], 'dark'));
  made.push(await contactSheet(out, 'contact-lock.png', [
    [s('rect', null, 'sample', 'dark', true), s('circ', null, 'sample', 'dark', true)],
    [s('rect', null, 'sample', 'light', true), s('circ', null, 'sample', 'light', true)],
    [s('rect', null, 'one', 'light', true), s('circ', null, 'one', 'light', true)],
    [s('rect', null, 'almost', 'light', true), s('circ', null, 'almost', 'light', true)],
    [s('rect', null, 'full', 'light', true), s('circ', null, 'full', 'light', true)],
    [s('rect', null, 'empty', 'light', true), s('circ', null, 'none', 'light', true)],
  ], 'dark'));
  made.push(await contactSheet(out, 'contact-tinted.png',
    [pair(null, 'sample', 'light', true), pair(null, 'sample', 'dark', true), pair('tra', 'sample', 'light', true), pair('tra', 'sample', 'dark', true)], 'light'));
  made.push(await contactSheet(out, 'contact-edge.png',
    [pair(null, 'one', 'light'), pair('tra', 'one', 'light'), pair(null, 'almost', 'light'), pair('tra', 'almost', 'light'), pair(null, 'full', 'light')], 'light'));
  made.push(await contactSheet(out, 'contact-states.png', [
    [s('small', null, 'states', 'light'), s('small', null, 'states', 'dark'), s('small', null, 'states', 'light', true), s('small', null, 'states', 'dark', true)],
  ], 'light'));
  return made;
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
    id: 'M2 跟完畫成實心（空心圈退回實心圓）',
    file: 'CollectionCard.swift',
    find: `                            ctx.stroke(Path(ellipseIn: CGRect(x: c.x - mid, y: c.y - mid, width: 2 * mid, height: 2 * mid)),
                                       with: .color(paint), lineWidth: ring)`,
    replace: `                            ctx.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)),
                                     with: .color(paint))`,
    expect: ['r'],
  },
  {
    id: 'M3 文字欄變窄、關鍵數字被縮',
    file: 'CollectionCard.swift',
    find: 'let textW = (size.width * 0.58).rounded()',
    replace: 'let textW = (size.width * 0.30).rounded()',
    expect: ['d'],
  },
  {
    id: 'M4 單一系統誤把其他系統的點也當成自己的',
    file: 'CollectionCard.swift',
    find: 'let own = snap.pts.filter { $0.sys == index }.map(dot)',
    replace: 'let own = snap.pts.filter { $0.sys >= 0 }.map(dot)',
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
    find: 'return CGPoint(x: inset + u * (size.width - 2 * inset),',
    replace: 'return CGPoint(x: inset + 6 + u * (size.width - 2 * inset),',
    expect: ['b2', 'v'],
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
  {
    id: 'M10 單一系統仍用整島框（沒有放大視窗）',
    file: 'CollectionCard.swift',
    find: 'let viewport = CollectionViewport.fitting(own)',
    replace: 'let viewport: CollectionViewport? = nil',
    expect: ['v'],
  },
  {
    id: 'M11 「<1%」退回四捨五入成 0%',
    file: 'CollectionCard.swift',
    find: '        if v > 0 && p == 0 { return "<1" }\n',
    replace: '',
    expect: ['c'],
  },
  {
    id: 'M12 「99%」退回四捨五入成 100%',
    file: 'CollectionCard.swift',
    find: '        if v < total && p >= 100 { return "99" }\n',
    replace: '',
    expect: ['c'],
  },
  {
    id: 'M13 widgetURL 拿掉（點小工具不開護照）',
    file: 'CollectionWidget.swift',
    find: '        .widgetURL(URL(string: "railisland://passport"))\n',
    replace: '',
    expect: ['u'],
  },
  {
    id: 'M14 視窗外的其他系統點也畫出來',
    file: 'CollectionCard.swift',
    find: '.map(dot).filter { viewport?.contains($0) ?? true }',
    replace: '.map(dot).filter { _ in true }',
    expect: ['v'],
  },
  {
    id: 'M15 視窗邊距漏加（pad 歸零）',
    file: 'CollectionCard.swift',
    find: 'let pad = max(0.12 * max(w, h), 10)',
    replace: 'let pad = 0.0',
    expect: ['v'],
  },
  {
    id: 'M16 handleOpen 不收 host passport',
    file: 'RailMetroWaitPlugin.swift',
    find: `
                || url.host == "passport"`,
    replace: '',
    expect: ['u'],
  },
  {
    id: 'M17 空心圈圈寬太細（圈上幾乎沒有線色）',
    file: 'CollectionCard.swift',
    find: 'static let hollowRingRatio: CGFloat = 0.45',
    replace: 'static let hollowRingRatio: CGFloat = 0.06',
    expect: ['r'],
  },
];

function stageSource(dest, mutation) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const f of ['CollectionCard.swift', 'CollectionWidget.swift', 'RailWidgetKit.swift', 'RailNativeL10n.swift', 'RailBoardWidget.swift']) {
    cpSync(join(realSrc, f), join(dest, f));
  }
  cpSync(join(appSrc, 'RailMetroWaitPlugin.swift'), join(dest, 'RailMetroWaitPlugin.swift'));
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
  if (flag('--emit-preview')) {
    // 把本腳本的樣本（CollectionWidgetPreview.json＋RECENT_BY_SYS 合成的每系統最近蓋章）寫回 CollectionWidgetPreview.json，
    // 讓「小工具圖庫預覽看到的資料」與「閘門驗過的資料」是同一份；judge 的 c 閘門會比對兩者。
    if (LANG) throw new Error('--emit-preview 不能和 --lang 併用');
    writeFileSync(resolve(opt('--emit-preview')), JSON.stringify(sample));
    console.log(`已寫出 ${resolve(opt('--emit-preview'))}`);
    return;
  }
  mkdirSync(outRoot, { recursive: true });
  if (flag('--mutation-test')) {
    const report = [];
    const control = async label => {
      const dest = join(outRoot, 'mut-src-control');
      stageSource(dest, null);
      const run = runHarness({ src: dest, out: join(outRoot, `mut-${label}`), quick: true });
      const { fails, counts } = await judge({ ...run, specs: run.cases, out: join(outRoot, `mut-${label}`), src: dest });
      report.push({ id: `控制組（${label}）`, red: fails.length ? [...new Set(fails.map(f => f.gate))] : [], ok: fails.length === 0, summary: summarize(counts), sample: fails.slice(0, 3) });
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
    console.log('拼圖：', (await contactSheets(outRoot)).join('\n      '));
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
