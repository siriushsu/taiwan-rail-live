#!/usr/bin/env node
/**
 * 車站收集 Android 小工具的驗收預言機。
 *
 * 裝置端（app/android/.../CollectionWidgetInstrumentedTest.java）只【回報觀察到的東西】：
 * 每案的 View 樹（文字、進度、字形範圍、被截斷與否）、每張地圖 Bitmap 的 PNG、reapply／狀態還原的指紋。
 * 這支從 payload（網頁端算好的 collection.json）用【另一份實作】獨立重算期望值再逐項比對——
 * 期望值不准取自 Provider／CollectionData／CollectionWidgetRender 的任何輸出（同源時「相等」是零資訊）：
 *   · 百分比字串：整數運算自己算（<1%、99% 邊界），不呼叫 percentLabel
 *   · 各系統列／進度條：自己排序、自己取前 5、自己算 3% 下限
 *   · 地圖：自己投影每個點、自己算單一系統的正方形視窗，再讀 PNG 像素看該點有沒有「那個狀態」的樣子
 *     （s=2 實心＝中心是線色；s=1 空心＝中心透明、外圈是線色；s=0 灰點）
 *   · 文字模板：自己讀 RailNativeL10n.json 查英／日字串
 *
 * 跑法（先由 app/scripts/android-collect-widget/run.sh 在你自己的模擬器上產出案例、obs.json 與 PNG）：
 *   ANDROID_SERIAL=<你的模擬器> zsh app/scripts/android-collect-widget/run.sh
 *   node app/scripts/verify_android_collect_widget.mjs [--out <collect-out 目錄>] [--cases <cases 目錄>]
 * 預設 out＝tmp/collect-widget/android/out/collect-out、cases＝tmp/collect-widget/android/cases（run.sh 的輸出位置）。
 * 找不到觀察檔＝紅（不是跳過）：沒有觀察就沒有驗證。
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? resolve(argv[i + 1]) : fallback; };
const OUT = opt('--out', join(ROOT, 'tmp/collect-widget/android/out/collect-out'));
const CASES = opt('--cases', join(ROOT, 'tmp/collect-widget/android/cases'));
const L10N_FILE = join(ROOT, 'app/android/app/src/main/assets/RailNativeL10n.json');

// ── 斷言登記：每個名字都有「檢查了幾次／失敗了幾次」，0 次檢查也算紅（分母縮水不准無聲）──────────────
const stats = new Map();
const failures = [];
function check(name, cond, detail) {
  const s = stats.get(name) ?? { n: 0, bad: 0 };
  s.n++;
  if (!cond) { s.bad++; failures.push(`[${name}] ${typeof detail === 'function' ? detail() : detail}`); }
  stats.set(name, s);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ── 讀輸入 ───────────────────────────────────────────────────────────────────
const need = file => { if (!existsSync(file)) { console.error(`找不到 ${file}——先在你自己的模擬器跑 ANDROID_SERIAL=<序號> zsh app/scripts/android-collect-widget/run.sh`); process.exit(2); } return file; };
const obsAll = JSON.parse(readFileSync(need(join(OUT, 'obs.json')), 'utf8'));
const cases = JSON.parse(readFileSync(need(join(CASES, 'cases.json')), 'utf8'));
const l10n = JSON.parse(readFileSync(L10N_FILE, 'utf8')).languages;
const payloadCache = new Map();
const payloadOf = file => { if (!payloadCache.has(file)) payloadCache.set(file, JSON.parse(readFileSync(join(CASES, file), 'utf8'))); return payloadCache.get(file); };

/** 查字串：zh-TW＝鍵本身；en／ja 查 RailNativeL10n.json；替換 {n} 之類的佔位。 */
function tr(lang, key, vars = {}) {
  const base = lang.startsWith('zh') ? key : (l10n[lang.split('-')[0]]?.[key] ?? key);
  return base.replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));
}

// ── 獨立實作 1：百分比字串（整數運算，不用浮點四捨五入）──────────────────────────────
function percentLabel(n, total) {
  if (total <= 0) return '0%';
  const rounded = Math.floor((200 * n + total) / (2 * total));   // round(100n/total)，0.5 進位
  if (n > 0 && rounded === 0) return '<1%';
  if (n < total && rounded >= 100) return '99%';
  return `${rounded}%`;
}
/** 進度條 1000 分之幾：有收集至少 3%。 */
const barProgress = (v, n) => (v <= 0 || n <= 0 ? 0 : Math.round(1000 * Math.min(1, Math.max(v / n, 0.03))));
const shortDate = iso => { const p = iso.split('-'); return p.length === 3 ? `${+p[1]}/${+p[2]}` : iso; };

/** 這個 payload＋範圍該顯示什麼（全部自己算）。 */
function expectFor(payload, scope) {
  const idx = scope === 'all' ? -1 : payload.sys.findIndex(s => s.k === scope);
  const sys = idx >= 0 ? payload.sys[idx] : null;
  const collected = sys ? sys.v : payload.n;
  const total = sys ? sys.n : payload.total;
  const ranked = payload.sys.map((s, i) => ({ ...s, i })).filter(s => s.v > 0)
    .sort((a, b) => (b.n - a.n) || (a.i - b.i)).slice(0, 5);
  return {
    idx, sys, collected, total,
    label: percentLabel(collected, total),
    remaining: Math.max(0, total - collected),
    ranked,
    untouched: payload.sys.filter(s => s.v === 0).length,
    recents: sys ? payload.recent.filter(r => r.k === sys.k) : payload.recent,
  };
}

// ── 獨立實作 2：PNG 解碼（8-bit、非交錯；灰階／RGB／RGBA／調色盤都收）──────────────────
function decodePng(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file} 不是 PNG`);
  let pos = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  let palette = null, trns = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`${file}：只支援 8-bit 非交錯 PNG（depth=${depth} interlace=${interlace}）`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? px[(y - 1) * stride + x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  const at = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return [0, 0, 0, 0];
    const o = y * stride + x * ch;
    if (ctype === 6) return [px[o], px[o + 1], px[o + 2], px[o + 3]];
    if (ctype === 2) return [px[o], px[o + 1], px[o + 2], 255];
    if (ctype === 0) return [px[o], px[o], px[o], 255];
    if (ctype === 4) return [px[o], px[o], px[o], px[o + 1]];
    const i = px[o];
    return [palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2], trns && i < trns.length ? trns[i] : 255];
  };
  return { w, h, at };
}
const pngCache = new Map();
const pngOf = file => { if (!pngCache.has(file)) pngCache.set(file, decodePng(join(OUT, file))); return pngCache.get(file); };
const hexRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/** 飽和度：最大通道減最小通道。灰（含深色模式偏藍的灰）≤ 40；線色（紅、綠、藍…）都遠大於 40。 */
const sat = c => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
/** WCAG 相對亮度與對比（sRGB 線性化）：從【量到的像素】算，不從常數算。 */
const wl = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const contrast = (a, b) => { const la = wl(a), lb = wl(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };

// ── 手寫的期望常數（不准讀 CollectionMapRender／dimens_collect.xml：同源時「相等」是零資訊）──────────────
/** Bitmap 的「出血」（dp）：點陣框四邊之外的透明邊。小卡左邊不出血（地圖在右、左邊就是文字欄，墨越不過 ImageView 的邊界）；中卡地圖在左、左邊是卡片內距，出血 8dp。
 *  三處要一起改：dimens_collect.xml、CollectionMapRender.bleed()、這裡。 */
const BLEED = { small: { start: 0, top: 2, end: 3, bottom: 18 }, medium: { start: 8, top: 2, end: 3, bottom: 18 } };
/** 顏色（手寫）：卡底 wg_paper、全台填色、單一系統細線、未收集灰點、其他系統灰。 */
const PAPER = { light: [253, 251, 244], dark: [16, 28, 46] };
const FILL = { light: [242, 241, 236], dark: [24, 35, 53] };
const LINE = { light: [226, 225, 222], dark: [48, 58, 76] };
const OFF = { light: [210, 210, 210], dark: [72, 81, 99] };
const OTHER = { light: [231, 231, 231], dark: [43, 52, 68] };
/** 契約的投影框 [lon0, lat0, lon1, lat1]（docs/collect-widget-contract.md；iOS 預言機 render_collect_widget.mjs 同值）與取樣點：
 *  手寫經緯度自己投影，離岸 ≥14 km（最小的地圖上仍 ≥4 px）。恆春半島南端投影後在點陣框底之下約 6%——裁到框就會被切平。 */
const BOX = [120.15, 22.2, 122.0, 25.27];
const lonLat = (lon, lat) => [((lon - BOX[0]) / (BOX[2] - BOX[0])) * 1000, ((BOX[3] - lat) / (BOX[3] - BOX[1])) * 1000];
const OUTLINE_LAND = [['玉山', 120.957, 23.47], ['埔里', 120.967, 23.964], ['台中', 120.679, 24.138], ['潮州', 120.54, 22.55],
  ['池上', 121.22, 23.12], ['宜蘭', 121.6, 24.75], ['嘉義', 120.45, 23.48], ['竹東', 121.09, 24.73],
  ['合歡山', 121.28, 24.14], ['阿里山', 120.8, 23.51], ['光復', 121.42, 23.67]];
const OUTLINE_SEA = [['台灣海峽中', 120.2, 24.2], ['太平洋', 121.95, 23.6], ['東南外海', 121.3, 22.23], ['北部外海', 121.2, 25.25], ['台灣海峽北', 120.25, 24.9]];
const OUTLINE_PENINSULA = [['恆春半島（lon 120.8／lat 22.0）', 120.8, 22.0], ['恆春半島北一點', 120.78, 22.02]];
/** 視窗內看得到海岸線、視窗中心在陸地內部的單一系統。 */
const OUTLINE_SCOPED = ['tra', 'trtc', 'krtc'];
/** 墨像素＝alpha ≥ 8（抗鋸齒的淡邊也算，不放寬）。 */
const INK_ALPHA = 8;
/** 蓋章膠囊尺寸（dp，改可點範圍前量到的值，尺寸不變）：高 17.9，寬依語言。 */
const STAMP_W = { zh: 35.8, en: 45.3, ja: 55.6 };
const totals = { land: 0, sea: 0, pen: 0, contrast: 0, inkBoxes: 0, scoped: 0, textPairs: 0, clipRegions: 0,
  headSmallBoth: 0, headSmallDropAll: 0, headSmallDropScoped: 0, headMedBoth: 0, headMedDrop: 0, headShrunk: 0, recent4: 0, recentMax: 0 };
/** 小卡標題與副標的間距（dp，版面宣告的 marginStart）；標題列「放得下」的判斷留 1.5dp 的取整帶（帶內兩種結果都收；Render 的餘裕是 1dp）。 */
const GAP_SMALL = 4, FIT_BAND = 1.5;
/** 最近蓋章「放得下再一列」的判斷：一列高在 0 筆時量不到，取 13sp 一行最矮的行高（拉丁字母，dp）。 */
const MIN_ROW_H = 15;
/** 取樣點覆蓋的下限＝2026-09-30 量到的實數（land 1080、sea 1350、pen 540、contrast 198、inkBoxes 2298、scoped 246）的約 90%：分母縮水就紅。 */
const LAND_MIN = 950, SEA_MIN = 1200, PEN_MIN = 480, CON_MIN = 170, INK_MIN = 2050, SCOPED_MIN = 220;
/** A9 版面關係的覆蓋下限（2026-09-30 量到 textPairs 8435、clipRegions 2193 的約 90%）。 */
const PAIRS_MIN = 7500, CLIPS_MIN = 1950;
/** 標題列各種畫法的覆蓋下限（2026-09-30 量到 小卡兩個都放 87／全台只留車站收集 42／單一系統只留系統名 19、中卡兩個都放 70／只留系統名 13、縮字 12 的約 90%）。 */
const HEAD_MIN = { headSmallBoth: 75, headSmallDropAll: 38, headSmallDropScoped: 17, headMedBoth: 60, headMedDrop: 11, headShrunk: 10,
  recent4: 11, recentMax: 42 };   // 最近蓋章：畫滿 4 筆的案 13、算過最大性的案 47（2026-09-30）的約 85–90%
/** 把 PNG 裁到點陣框：at(x,y)＝原圖 (x+start, y+top)；框外（出血區）用負座標或超過 w／h 取得。 */
function framed(raw, family, dpr) {
  const b = BLEED[family];
  const bs = Math.round(b.start * dpr), bt = Math.round(b.top * dpr), be = Math.round(b.end * dpr), bb = Math.round(b.bottom * dpr);
  return { w: raw.w - bs - be, h: raw.h - bt - bb, at: (x, y) => raw.at(x + bs, y + bt) };
}

// ── 觀察資料的取用 ───────────────────────────────────────────────────────────
const obsById = new Map(obsAll.map(o => [o.id, o]));
const nodes = (obs, id) => obs.nodes.filter(n => n.id === id);
const one = (obs, id) => nodes(obs, id).find(n => n.visible !== false) ?? nodes(obs, id)[0];
const visibleText = (obs, id) => nodes(obs, id).filter(n => n.kind === 'text' && n.visible);

/** 獨立算單一系統的正方形視窗（第二輪規格第 3 點）；全台＝整島。 */
function windowFor(payload, idx) {
  if (idx < 0) return { x0: 0, y0: 0, size: 1000 };
  const pts = payload.pts.filter(p => p[4] === idx);
  if (!pts.length) return { x0: 0, y0: 0, size: 1000 };
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  const pad = Math.max(0.12 * Math.max(w, h), 10);
  const size = Math.max(w + 2 * pad, h + 2 * pad, 40);
  return { x0: (minX + maxX) / 2 - size / 2, y0: (minY + maxY) / 2 - size / 2, size };
}

// ── 逐案檢查 ─────────────────────────────────────────────────────────────────
let mapsChecked = 0;
for (const c of cases) {
  const obs = obsById.get(c.id);
  check('每案都有觀察', !!obs, `${c.id}：obs.json 沒有這一案`);
  if (!obs) continue;
  const lang = c.lang ?? 'zh-TW';
  const light = c.theme !== 'dark';
  const small = c.family === 'small';
  const tag = `${c.id}`;

  // 沒檔案／壞檔＝「打開軌島一次」訊息版面，不畫任何地圖
  const payload = c.payload ? payloadOf(c.payload) : null;
  if (!payload || payload.v !== 1) {
    const msg = one(obs, 'wc_message');
    check('無檔案或版本不對→訊息版面', msg?.visible && msg.text === tr(lang, '打開軌島一次，就會出現你的車站收集'), () => `${tag}：wc_message=${JSON.stringify(msg?.text)}`);
    check('無檔案或版本不對→不畫地圖', nodes(obs, 'wc_map_light').length === 0, `${tag}：不該有地圖`);
    check('無檔案或版本不對→不畫百分比', nodes(obs, 'wc_pct').length === 0, `${tag}：不該有百分比`);
    continue;
  }

  const e = expectFor(payload, c.scope);
  const isAllScope = c.scope === 'all';

  // A1 百分比字串（含 <1%／99% 邊界）
  if (small && e.collected === 0) {
    check('空狀態：小卡不畫百分比與數字', visibleText(obs, 'wc_pct').length === 0 && visibleText(obs, 'wc_count').length === 0, `${tag}：空狀態不該有百分比／已收集`);
    const t = one(obs, 'wc_empty_title');
    check('空狀態：小卡有邀請文案', t?.visible && t.text === tr(lang, '還沒有收集的車站'), () => `${tag}：wc_empty_title=${JSON.stringify(t?.text)}`);
  } else {
    const pct = one(obs, 'wc_pct');
    check('百分比字串（獨立整數運算）', pct?.visible && pct.text === e.label, () => `${tag}：畫面 ${JSON.stringify(pct?.text)}，期望 ${e.label}（n=${e.collected}/${e.total}）`);
  }

  // A2 已收集／還有
  if (small) {
    if (e.collected > 0) {
      const count = one(obs, 'wc_count');
      check('小卡「已收集 N 座」', count?.visible && count.text === tr(lang, '已收集 {n} 座', { n: e.collected }), () => `${tag}：${JSON.stringify(count?.text)}，期望 N=${e.collected}`);
      const remain = one(obs, 'wc_remain');
      if (c.hDp >= 150) check('小卡夠高時有「還有 N 座」', remain?.visible && remain.text === tr(lang, '還有 {n} 座', { n: e.remaining }), () => `${tag}：${JSON.stringify(remain?.text)}，期望 剩 ${e.remaining}`);
      else if (remain?.visible) check('小卡「還有 N 座」數字', remain.text === tr(lang, '還有 {n} 座', { n: e.remaining }), () => `${tag}：${JSON.stringify(remain.text)}，期望 剩 ${e.remaining}`);
    }
  } else {
    const count = one(obs, 'wc_count');
    check('中卡「已收集 v／n 座」', count?.visible && count.text === tr(lang, '已收集 {v}／{n} 座', { v: e.collected, n: e.total }), () => `${tag}：${JSON.stringify(count?.text)}，期望 ${e.collected}／${e.total}`);
  }

  // A3 中卡中段內容
  if (!small) {
    if (e.collected === 0) {
      const t = one(obs, 'wc_empty_title');
      check('空狀態：中卡有邀請文案', t?.visible && t.text === tr(lang, '還沒有收集的車站'), () => `${tag}：${JSON.stringify(t?.text)}`);
      check('空狀態：中卡沒有進度條', nodes(obs, 'wc_row_bar').length === 0 && nodes(obs, 'wc_scope_bar').length === 0, `${tag}：空狀態不該有進度條`);
    } else if (isAllScope) {
      check('全台中卡不畫最近蓋章（位置給各系統進度條）', visibleText(obs, 'wc_recent_name').length === 0 && visibleText(obs, 'wc_recent_date').length === 0, () => `${tag}：全台中卡不該有最近蓋章`);
      const labels = nodes(obs, 'wc_row_label').filter(n => n.visible).map(n => n.text);
      const counts = nodes(obs, 'wc_row_count').filter(n => n.visible).map(n => n.text);
      const bars = nodes(obs, 'wc_row_bar').filter(n => n.visible);
      const expLabels = e.ranked.map(s => s.label), expCounts = e.ranked.map(s => `${s.v}/${s.n}`);
      // 高度不夠時列由後往前丟，但留下的一定是「排序後的前 k 個」
      check('全台列＝有收集的系統依總站數大到小的前 k 個', labels.length >= 1 && labels.every((l, i) => l === expLabels[i]), () => `${tag}：畫面 ${labels.join(',')}，期望前綴 ${expLabels.join(',')}`);
      check('全台列的 v/n', counts.length === labels.length && counts.every((t, i) => t === expCounts[i]), () => `${tag}：畫面 ${counts.join(',')}，期望 ${expCounts.join(',')}`);
      check('全台列的進度條值（3% 下限）', bars.length === labels.length && bars.every((b, i) => b.progress === barProgress(e.ranked[i].v, e.ranked[i].n)), () => `${tag}：畫面 ${bars.map(b => b.progress)}，期望 ${e.ranked.map(s => barProgress(s.v, s.n))}`);
      if (c.hDp >= 200) {
        check('夠高的中卡放滿 5 列（或有收集的系統數）', labels.length === e.ranked.length, () => `${tag}：只放了 ${labels.length} 列，期望 ${e.ranked.length}`);
        if (e.untouched > 0) {
          const note = one(obs, 'wc_note_line');
          check('夠高的中卡有「還有 K 個系統還沒去過」', note?.visible && note.text === tr(lang, '還有 {n} 個系統還沒去過', { n: e.untouched }), () => `${tag}：${JSON.stringify(note?.text)}，期望 K=${e.untouched}`);
        }
        const solid = one(obs, 'wc_legend_solid'), follow = one(obs, 'wc_legend_follow');
        const legendFits = !!solid;   // 放不下就整行不放是規格允許的；放了就要對
        if (legendFits) check('圖例文字', solid.text === tr(lang, '實心＝搭過／到訪') && follow.text === tr(lang, '空心＝跟完'), () => `${tag}：${solid.text}／${follow?.text}`);
        else if (lang.startsWith('zh')) check('繁中夠高的中卡一定放得下圖例', false, `${tag}：沒有圖例`);
      } else {
        const note = one(obs, 'wc_note_line');
        if (note?.visible) check('「還有 K 個系統還沒去過」的 K', note.text === tr(lang, '還有 {n} 個系統還沒去過', { n: e.untouched }), () => `${tag}：${note.text}`);
      }
    } else {
      const bar = one(obs, 'wc_scope_bar');
      check('單一系統進度條值（3% 下限）', bar?.visible && bar.progress === barProgress(e.collected, e.total), () => `${tag}：畫面 ${bar?.progress}，期望 ${barProgress(e.collected, e.total)}`);
      const remain = one(obs, 'wc_remain_line');
      check('單一系統「還有 N 座」', remain?.visible && remain.text === tr(lang, '還有 {n} 座', { n: e.remaining }), () => `${tag}：${JSON.stringify(remain?.text)}，期望 剩 ${e.remaining}`);
      const names = nodes(obs, 'wc_recent_name').filter(n => n.visible).map(n => n.text);
      const dates = nodes(obs, 'wc_recent_date').filter(n => n.visible).map(n => n.text);
      // 最近蓋章（契約〈畫法約定〉9）：放得下幾筆畫幾筆，上限 4、最少 0，畫篩出來的前 N 筆（順序照 payload，不重排）。
      const want = e.recents.slice(0, 4);
      check('單一系統最近蓋章＝篩出來的前 N 筆（N ≤ min(4, 筆數)，順序不變）',
        names.length <= Math.min(4, want.length) && names.every((t, i) => t === want[i]?.name) && dates.every((t, i) => t === shortDate(want[i]?.d ?? '')),
        () => `${tag}：畫面 ${names}／${dates}，期望前綴 ${want.map(r => r.name + '／' + shortDate(r.d))}`);
      if (names.length === 4) totals.recent4++;
      // 最大性：畫的筆數少於 min(4, 筆數)，就要證明剩下的空間（標題區塊與進度條之間的伸縮間隔＋最後一個元素到下一個元素的空隙）放不下再一列。
      // 一列高取實際畫出來的名稱框高；0 筆時取 13sp 一行最矮的行高（拉丁字母）。
      if (names.length < Math.min(4, want.length)) {
        const recN = nodes(obs, 'wc_recent_name').filter(n => n.visible);
        const rowsN = nodes(obs, 'wc_rows').find(n => n.kind === 'group' && n.visible);
        const bar = one(obs, 'wc_scope_bar'), remainN = one(obs, 'wc_remain_line');
        const legendN = nodes(obs, 'wc_legend_solid').find(n => n.visible);
        if (rowsN && bar?.box && remainN?.box) {
          const rowH = recN.length ? Math.max(...recN.map(n => n.box[3] - n.box[1])) : MIN_ROW_H;
          const lastBottom = Math.max(remainN.box[3], ...recN.map(n => n.box[3]));
          const nextTop = legendN ? legendN.box[1] : rowsN.box[3];
          const free = (bar.box[1] - rowsN.box[1]) + (nextTop - lastBottom);
          totals.recentMax++;
          check('單一系統最近蓋章：畫的筆數已是放得下的最大值（剩餘空間放不下再一列）', free < rowH - 0.5,
            () => `${tag}：只畫 ${names.length} 筆（可畫 ${Math.min(4, want.length)}），剩餘空間 ${free.toFixed(1)}dp ≥ 一列高 ${rowH.toFixed(1)}dp＝放得下卻沒畫`);
        }
      }
      if (c.hDp >= 200 && want.length > 0) check('夠高的單一系統中卡至少放 1 筆最近蓋章', names.length >= 1, `${tag}：沒有最近蓋章`);
      if (c.hDp >= 200) {
        const solid = one(obs, 'wc_legend_solid');
        if (solid) check('單一系統圖例文字', solid.text === tr(lang, '實心＝搭過／到訪'), () => `${tag}：${solid.text}`);
        else if (lang.startsWith('zh')) check('繁中夠高的單一系統中卡一定放得下圖例', false, `${tag}：沒有圖例`);
      }
    }
  }

  // A2b 標題列省略順序（契約〈畫法約定〉8，不因語言另設特例）：
  //   · 兩個名稱（範圍名、「車站收集」）在基準字級下的自然寬度加起來放得下那一行 → 兩個都在；
  //   · 放不下 → 全台只留「車站收集」、單一系統只留系統名；
  //   · 只剩一個名稱：放得下不縮字、放不下縮字（下限 75%）、縮到下限還放不下才准截斷。
  //   自然寬度與可用寬都是裝置端量到的（obs.head：Paint.measureText 與實際那一行的寬），預言機不讀 Render 的字寬估計；
  //   中卡全台的標題本來就只有「車站收集」。
  {
    const hd = obs.head;
    const expScope = isAllScope ? tr(lang, '全台') : e.sys.label, expKicker = tr(lang, '車站收集');
    const measured = !!hd && hd.scope === expScope && hd.kicker === expKicker && typeof hd.wScope === 'number' && Array.isArray(hd.rowBox);
    check('標題列：裝置端量到了兩個名稱的自然寬度（名稱與預期一致）', measured, () => `${tag}：head=${JSON.stringify(hd)}，期望 ${expScope}／${expKicker}`);
    const title = one(obs, 'wc_title');
    check('標題列：標題看得到', !!title?.visible, () => `${tag}：wc_title=${JSON.stringify(title)}`);
    if (measured && title?.visible) {
      const rowW = hd.rowBox[2] - hd.rowBox[0], base = hd.titleBaseSp;
      const sub = small ? nodes(obs, 'wc_subtitle').find(n => n.visible) : null;
      const wantBoth = small || !isAllScope;   // 中卡全台本來就只有「車站收集」
      const bothW = small ? hd.wScope + GAP_SMALL + hd.wKicker : hd.wBoth;
      let expectText;
      const mustBoth = wantBoth && bothW <= rowW - FIT_BAND, mustNot = wantBoth && bothW > rowW;
      if (!wantBoth) expectText = expKicker;
      else if (mustBoth) expectText = small ? expScope : `${expScope} · ${expKicker}`;
      else if (mustNot) expectText = isAllScope ? expKicker : expScope;
      if (expectText !== undefined) {
        const expectSub = small && mustBoth;
        check('標題列：兩個都放得下就都在；放不下全台只留「車站收集」、單一系統只留系統名', title.text === expectText && !!sub === expectSub,
          () => `${tag}：畫面 標題=${JSON.stringify(title.text)} 副標=${JSON.stringify(sub?.text)}；自然寬度 合計 ${bothW.toFixed(1)} 對 可用 ${rowW.toFixed(1)}dp，期望 標題=${JSON.stringify(expectText)} 副標=${expectSub}`);
      }
      if (small && sub) check('標題列：副標與標題的間距＝版面宣告的 4dp（手寫值沒有飄）', near(sub.box[0] - title.box[2], GAP_SMALL, 0.6), () => `${tag}：間距 ${(sub.box[0] - title.box[2]).toFixed(2)}dp`);
      // 覆蓋計數：每一種畫法都要真的被案例踩到（分母縮水就紅）
      if (small) totals[sub ? 'headSmallBoth' : (isAllScope ? 'headSmallDropAll' : 'headSmallDropScoped')]++;
      else if (!isAllScope) totals[title.text.includes(' · ') ? 'headMedBoth' : 'headMedDrop']++;
      const nat = title.text === expKicker ? hd.wKickerAsTitle : title.text === expScope ? hd.wScope : hd.wBoth;
      // 比例上界留 2%：版面 XML 宣告的字級（autoSize 的上限）會被取整成整數像素，實際字級比 sp 標稱值高最多約 1.5%
      const availW = title.box[2] - title.box[0], scale = title.sp / base;
      if (title.sp / base < 0.995) totals.headShrunk++;
      check('標題列：能放就不縮字；放不下縮字（下限 75%），縮到下限還放不下才截斷', scale >= 0.75 - 0.01 && scale <= 1.02 && (nat <= availW - FIT_BAND ? scale >= 0.995 : (nat * scale <= availW + 0.5 || scale <= 0.76)),
        () => `${tag}：${JSON.stringify(title.text)} 自然寬 ${nat.toFixed(1)}dp、可用 ${availW.toFixed(1)}dp、字級 ${title.sp.toFixed(2)}／基準 ${base.toFixed(2)}（比例 ${scale.toFixed(3)}）`);
    }
  }

  // A4 進度條像素：實際畫出來的填滿比例＝進度值（量的是像素，不是 setProgress 的參數）
  {
    const card = pngOf(`${c.id}.card.png`);
    const dpr = obs.density;
    for (const b of obs.nodes.filter(n => n.kind === 'progress' && n.visible)) {
      const [l, t, r, bt] = b.box.map(v => v * dpr);
      const y = Math.round((t + bt) / 2);
      let filled = 0, total = 0;
      for (let x = Math.ceil(l); x < Math.floor(r); x++) {
        const [pr, pg, pb, pa] = card.at(x, y);
        total++;
        // 填色是深藍（b 明顯大於 r），軌道是淺灰（三色接近）
        if (pa > 200 && pb - pr > 40) filled++;
      }
      const frac = total ? filled / total : 0;
      check('進度條像素填滿比例＝進度值', total > 20 && near(frac, b.progress / b.max, 0.04), () => `${tag}：${b.id} 畫面 ${(frac * 100).toFixed(1)}%，期望 ${(b.progress / b.max * 100).toFixed(1)}%`);
    }
  }

  // A5 文字完整性
  for (const n of obs.nodes.filter(n => n.kind === 'text' && n.visible)) {
    // 標題只剩一個名稱、縮到 75% 還放不下時，契約允許截斷（畫法約定 8）；判斷用裝置端量到的自然寬度
    const hd5 = obs.head;
    const nat5 = n.id === 'wc_title' && hd5 ? (n.text === hd5.kicker ? hd5.wKickerAsTitle : n.text === hd5.scope ? hd5.wScope : n.text === (hd5.scope + ' · ' + hd5.kicker) ? hd5.wBoth : undefined) : undefined;
    const truncOk = nat5 !== undefined && nat5 * 0.75 > (n.box[2] - n.box[0]) + 0.5;
    check('文字沒有被「…」截斷', (n.ellipsized !== true || truncOk) && (truncOk || !/…|\.\.\./.test(n.text)), () => `${tag}：${n.id}=${JSON.stringify(n.text)}`);
    check('文字沒有被水平／垂直裁掉', n.clippedH !== true && n.clippedV !== true, () => `${tag}：${n.id}=${JSON.stringify(n.text)} clippedH=${n.clippedH} clippedV=${n.clippedV}`);
    check('文字沒有被折到看不見的行', (n.hiddenLines ?? 0) === 0, () => `${tag}：${n.id}=${JSON.stringify(n.text)} hiddenLines=${n.hiddenLines}`);
    if (n.glyph) {
      const [gl, gt, gr, gb] = n.glyph;
      check('字形在卡片範圍內', gl >= -0.5 && gt >= -0.5 && gr <= c.wDp + 0.5 && gb <= c.hDp + 0.5, () => `${tag}：${n.id} 字形 [${n.glyph.map(v => v.toFixed(1))}] 超出 ${c.wDp}x${c.hDp}`);
    }
  }

  // A9 版面關係（不寫死任何尺寸，只看「誰跟誰不能碰」）：
  //    · 任兩個可見文字的字形框不相交（110dp 小卡的百分比壓進標題列時，兩個字形框重疊 3.9dp，舊判準只比對 view 自己與它的字，看不到）
  //    · 可見文字的字形框不超出祖先的裁切區（obs 的 clip：裝置端 harness 從實際 View 旗標算出來——clipToPadding 的祖先取內距框、
  //      被 clipChildren 的 view 取自己的邊界；文字欄的 paddingBottom 12dp＋clipToPadding 預設 true，就是這樣把百分比上半裁在欄上緣的）
  {
    const texts = obs.nodes.filter(n => n.kind === 'text' && n.visible && (n.text ?? '') !== '' && n.glyph);
    const f1 = v => v.toFixed(1);
    for (let i = 0; i < texts.length; i++) {
      const a = texts[i], g = a.glyph;
      if (a.clip) {
        totals.clipRegions++;
        check('可見文字的字形框不超出祖先的裁切區（例：文字欄的內距框）', g[0] >= a.clip[0] - 0.5 && g[1] >= a.clip[1] - 0.5 && g[2] <= a.clip[2] + 0.5 && g[3] <= a.clip[3] + 0.5,
          () => `${tag}：${a.id}=${JSON.stringify(a.text)} 字形 [${g.map(f1)}] 超出裁切區 [${a.clip.map(f1)}]`);
      }
      for (let j = i + 1; j < texts.length; j++) {
        const b = texts[j], h = b.glyph;
        const ix = Math.min(g[2], h[2]) - Math.max(g[0], h[0]), iy = Math.min(g[3], h[3]) - Math.max(g[1], h[1]);
        totals.textPairs++;
        check('任兩個可見文字的字形框不相交', !(ix > 0.5 && iy > 0.5),
          () => `${tag}：${a.id}=${JSON.stringify(a.text)} [${g.map(f1)}] 與 ${b.id}=${JSON.stringify(b.text)} [${h.map(f1)}] 相交 ${f1(ix)}x${f1(iy)}dp`);
      }
    }
  }

  // A8 蓋章按鈕（小卡：文字欄最下面、數字下方靠左；中卡：「已收集」那一列右端）：看得到、在卡片內、尺寸不變、
  //    不與【任何】可見文字（字形框）或進度條相交、位置對、可點容器包住膠囊且夠大。
  //    舊版只比對白名單 id，把鈕往下推進 wc_rows 區（wc_row_label／wc_row_bar 不在白名單）就抓不到（突變 M1 漏網）。
  {
    const st = one(obs, 'wc_stamp'), hitBox = one(obs, 'wc_stamp_hit');
    const shown = !!st && st.visible === true && st.text === tr(lang, '蓋章');
    check('蓋章鈕：看得到，文字＝原生字串目錄的「蓋章」', shown, () => `${tag}：wc_stamp=${JSON.stringify(st?.text)} visible=${st?.visible}（期望 ${tr(lang, '蓋章')}）`);
    if (shown) {
      const [l, t, r, b] = st.box;
      const f1 = v => v.toFixed(1);
      check('蓋章鈕：尺寸大於 0', r - l > 4 && b - t > 4, () => `${tag}：box [${st.box.map(f1)}]`);
      check('蓋章鈕：完全在小工具範圍內', l >= -0.5 && t >= -0.5 && r <= c.wDp + 0.5 && b <= c.hDp + 0.5, () => `${tag}：box [${st.box.map(f1)}] 超出 ${c.wDp}x${c.hDp}`);
      check('蓋章鈕：膠囊尺寸不變（高 17.9±0.5dp、寬 zh 35.8／en 45.3／ja 55.6 ±0.8）', near(b - t, 17.9, 0.5) && near(r - l, STAMP_W[lang.split('-')[0]] ?? STAMP_W.zh, 0.8), () => `${tag}：膠囊 ${f1(r - l)}x${f1(b - t)}dp`);
      let textBottom = -Infinity;
      for (const n of obs.nodes) {
        if (!n.visible || !n.box || ['wc_stamp', 'wc_stamp_hit', 'wc_root'].includes(n.id)) continue;
        const isText = n.kind === 'text' && (n.text ?? '') !== '';
        if (!isText && n.kind !== 'progress') continue;
        const g = isText ? (n.glyph ?? n.box) : n.box;
        if (isText) textBottom = Math.max(textBottom, g[3]);
        const ix = Math.min(r, g[2]) - Math.max(l, g[0]), iy = Math.min(b, g[3]) - Math.max(t, g[1]);
        check('蓋章鈕不與任何可見文字（字形框）或進度條相交', !(ix > 0.5 && iy > 0.5), () => `${tag}：wc_stamp [${st.box.map(f1)}] 與 ${n.id}=${JSON.stringify(n.text ?? n.kind)} [${g.map(f1)}] 相交 ${f1(ix)}x${f1(iy)}dp`);
      }
      if (small) {
        check('小卡蓋章鈕位置：左緣約 14dp、在標題與所有文字之下（數字下方靠左）', near(l, 14, 1.5) && t >= textBottom - 0.5, () => `${tag}：膠囊 [${st.box.map(f1)}]，文字最低 ${f1(textBottom)}`);
      } else {
        const pct = one(obs, 'wc_pct'), count = one(obs, 'wc_count');
        const cy = (t + b) / 2;
        check('中卡蓋章鈕位置：右緣約 W−16、在百分比之下、垂直落在「已收集」那一列', near(r, c.wDp - 16, 1.5) && !!pct?.glyph && t >= pct.glyph[3] - 0.5 && !!count?.box && cy >= count.box[1] - 3 && cy <= count.box[3] + 3, () => `${tag}：膠囊 [${st.box.map(f1)}]，百分比字形底 ${f1(pct?.glyph?.[3] ?? NaN)}，已收集列 [${count?.box?.[1]}, ${count?.box?.[3]}]`);
      }
      const minW = 48, minH = small ? 36 : 26;
      check('蓋章鈕可點容器 wc_stamp_hit：存在、包住膠囊、尺寸 ≥ 48×36（小）／48×26（中）', !!hitBox?.box && hitBox.box[0] <= l + 0.5 && hitBox.box[1] <= t + 0.5 && hitBox.box[2] >= r - 0.5 && hitBox.box[3] >= b - 0.5 && hitBox.box[2] - hitBox.box[0] >= minW - 0.5 && hitBox.box[3] - hitBox.box[1] >= minH - 0.5, () => `${tag}：容器 [${hitBox?.box?.map(f1)}] 膠囊 [${st.box.map(f1)}]`);
      if (hitBox?.box) {
        for (const n of obs.nodes) {
          if (!n.visible || !n.box || ['wc_stamp', 'wc_stamp_hit', 'wc_root'].includes(n.id)) continue;
          const isText = n.kind === 'text' && (n.text ?? '') !== '';
          if (!isText && n.kind !== 'progress') continue;
          const g = isText ? (n.glyph ?? n.box) : n.box;
          const ix = Math.min(hitBox.box[2], g[2]) - Math.max(hitBox.box[0], g[0]), iy = Math.min(hitBox.box[3], g[3]) - Math.max(hitBox.box[1], g[1]);
          check('蓋章鈕可點容器不與任何可見文字（字形框）或進度條相交', !(ix > 0.5 && iy > 0.5), () => `${tag}：wc_stamp_hit [${hitBox.box.map(f1)}] 與 ${n.id}=${JSON.stringify(n.text ?? n.kind)} [${g.map(f1)}] 相交 ${f1(ix)}x${f1(iy)}dp`);
        }
      }
    }
  }

  // A6 地圖：Bitmap 尺寸／位元組／深淺 alpha／像素
  const mapL = one(obs, 'wc_map_light'), mapD = one(obs, 'wc_map_dark');
  if (!mapL?.png || !mapD?.png || !mapL.visible) {
    // 允許拿掉地圖的小卡只有兩種：(1) 有資料、寬 110dp 的小卡（量到的實況：110×110 的資料卡沒地圖；137×137、140×222、158×158 的資料卡全有地圖）；
    // (2) 空狀態且說明文放不進文字欄：預言機自己估（拉丁 0.5em、CJK 1em、粗體 +5%、除以 58% 欄寬），說明文 >3 行或標題 >2 行才准丟。
    const colW = (c.wDp - 30) * 0.58;   // 文字欄寬（dp）：版面權重 58%、左右內距 14+16
    const lines = (text, sp, bold) => { let em = 0; for (const ch of text) em += ch.codePointAt(0) >= 0x2E80 ? 1 : 0.5; return Math.ceil(em * sp * (bold ? 1.05 : 1) / colW); };
    const emptyOverflow = e.collected === 0 && (lines(tr(lang, '跟一班車到終點，或到車站打卡就會蓋章'), 11, false) > 3 || lines(tr(lang, '還沒有收集的車站'), 13, true) > 2);
    check('有資料就有地圖（只有 110dp 寬的資料小卡、或說明文放不進文字欄的空狀態小卡可整個拿掉）', small && ((e.collected > 0 && c.wDp <= 110) || emptyOverflow), () => `${tag}：沒有地圖（${c.wDp}x${c.hDp}dp，文字欄 ${colW.toFixed(1)}dp，collected=${e.collected}）`);
    continue;
  }
  check('淺／深 alpha（淺色模式露淺、深色模式露深）', near(mapL.alpha, light ? 1 : 0, 0.01) && near(mapD.alpha, light ? 0 : 1, 0.01), () => `${tag}：light=${mapL.alpha} dark=${mapD.alpha} theme=${c.theme}`);
  {
    const fl = framed(pngOf(mapL.png), c.family, obs.density);
    check('點陣框寬＝框高×aspect（扣掉手寫的出血後）；淺深兩張同尺寸、PNG 尺寸＝回報尺寸', fl.w > 0 && fl.h > 0 && near(fl.w, fl.h * payload.aspect, 0.6) && mapL.bitmapW === mapD.bitmapW && mapL.bitmapH === mapD.bitmapH && pngOf(mapL.png).w === mapL.bitmapW && pngOf(mapL.png).h === mapL.bitmapH, () => `${tag}：Bitmap ${mapL.bitmapW}x${mapL.bitmapH}，扣出血後框 ${fl.w}x${fl.h}，aspect=${payload.aspect}`);
  }
  check('Bitmap 位元組＝寬×高×4', mapL.bitmapBytes === mapL.bitmapW * mapL.bitmapH * 4, () => `${tag}：${mapL.bitmapBytes}`);
  check('單張 Bitmap ≤ 560px 高且整卡兩張合計 ≤ 1 MB', mapL.bitmapH <= 560 && obs.bitmapBytes <= 1024 * 1024, () => `${tag}：h=${mapL.bitmapH} bytes=${obs.bitmapBytes}`);

  // 像素：獨立投影每個點
  const win = windowFor(payload, e.idx);
  const dpr = obs.density;
  for (const [which, node] of [['light', mapL], ['dark', mapD]]) {
    const img = framed(pngOf(node.png), c.family, dpr);
    const H = img.h, W = img.w;
    const r = Math.max(dpr, H * 0.0075), rs = r * 1.3, inset = rs;
    const project = p => [inset + (p[0] - win.x0) / win.size * (W - 2 * inset), inset + (p[1] - win.y0) / win.size * (H - 2 * inset)];
    const inWin = p => p[0] >= win.x0 && p[0] <= win.x0 + win.size && p[1] >= win.y0 && p[1] <= win.y0 + win.size;
    const drawn = payload.pts.filter(inWin);
    const drawnPos = drawn.map(project);
    const bg = which === 'light' ? [253, 251, 244] : [16, 28, 46];
    const gain = which === 'light' ? 1 : 1.25;
    const lineColor = p => hexRgb(p[2]).map(v => Math.min(255, Math.round(v * gain)));
    // 只驗「中心沒被別的點蓋到」的點：畫的順序是 其他系統灰 → s=0 灰點 → s=1 空心圈 → s=2 實心圓，
    // 各狀態被鄰居蓋到中心的距離不同（實心圓半徑 rs、灰點半徑 r，另加 2px 給抗鋸齒與取整）。
    // 重疊處被後畫的點蓋住是預期的行為，不是缺陷。
    const layer = p => (e.idx >= 0 && p[4] !== e.idx ? 'other' : `s${p[3]}`);
    const reach = q => (layer(q) === 's2' || layer(q) === 's1' ? rs : r) + 2;
    const isolated = p => {
      const [x, y] = project(p);
      const mine = layer(p);
      return drawn.every((q, i) => {
        if (q === p) return true;
        const d = Math.hypot(drawnPos[i][0] - x, drawnPos[i][1] - y);
        const lq = layer(q);
        if (mine === 's2') return !(lq === 's2' && d <= rs + 2);                       // 只有同層後畫的實心圓會蓋住
        if (mine === 's1') return d > reach(q);                                          // 空心中心要沒有任何點畫到
        if (mine === 's0') return !((lq === 's1' || lq === 's2') && d <= rs + 2);        // 灰點被空心圈／實心圓蓋住
        return !((lq === 's0' || lq === 's1' || lq === 's2') && d <= reach(q));          // 其他系統的灰被本系統的點蓋住
      });
    };
    const around = (x, y, pred, rad = 1) => {
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) if (pred(img.at(Math.round(x) + dx, Math.round(y) + dy))) return true;
      return false;
    };
    const scoped = payload.pts.filter(p => (e.idx < 0 || p[4] === e.idx) && inWin(p));
    const counts = { 0: 0, 1: 0, 2: 0 };
    for (const p of scoped) {
      if (!isolated(p)) continue;
      const [x, y] = project(p);
      counts[p[3]]++;
      if (p[3] === 2) {
        const want = lineColor(p);
        check(`地圖 ${which}：s=2 搭過／到訪＝中心是線色實心`, around(x, y, px => px[3] > 200 && dist(px, want) <= 14), () => `${tag}：點 ${p[0]},${p[1]} ${p[2]} 中心 ${img.at(Math.round(x), Math.round(y))} 期望 ${want}`);
      } else if (p[3] === 1) {
        const want = lineColor(p);
        const center = img.at(Math.round(x), Math.round(y));
        // 空心中心：透明，或露出底下的輪廓（全台填色／單一系統的細線）；絕不是線色（那是實心）
        const hollow = (center[3] < 60 || dist(center, FILL[which]) <= 12 || dist(center, LINE[which]) <= 12) && !(center[3] > 200 && dist(center, want) <= 40);
        check(`地圖 ${which}：s=1 跟完＝空心（中心透明或露出輪廓，不是線色）`, hollow, () => `${tag}：點 ${p[0]},${p[1]} 中心 ${center}（實心會是線色 ${want}）`);
        // 外圈：中心往外 [0.55rs, 1.15rs] 的環上找得到線色
        let ringHit = false;
        for (let a = 0; a < 360 && !ringHit; a += 15) {
          for (const k of [0.7, 0.85, 1.0]) {
            const px = img.at(Math.round(x + Math.cos(a * Math.PI / 180) * rs * k), Math.round(y + Math.sin(a * Math.PI / 180) * rs * k));
            if (px[3] > 160 && dist(px, want) <= 40) ringHit = true;
          }
        }
        check(`地圖 ${which}：s=1 跟完＝外圈是線色`, ringHit, () => `${tag}：點 ${p[0]},${p[1]} 找不到外圈線色 ${want}`);
      } else {
        const px = around(x, y, q => q[3] > 200) ? img.at(Math.round(x), Math.round(y)) : [0, 0, 0, 0];
        check(`地圖 ${which}：s=0 未收集＝灰色小點（手寫的灰）`, px[3] > 150 && dist(px, OFF[which]) <= 8, () => `${tag}：點 ${p[0]},${p[1]} 中心 ${img.at(Math.round(x), Math.round(y))} 期望 ${OFF[which]}`);
      }
    }
    // 沒有分母縮水：該範圍內至少各驗到一些孤立的實心點（有這種點的案才要求）
    if (which === 'light') {
      const has = s => scoped.some(p => p[3] === s);
      if (has(2) && c.scope !== 'all') check('單一系統：孤立的已收集點數 ≥1（否則像素判準是空的）', counts[2] >= 1 || scoped.filter(p => p[3] === 2).length < 2, `${tag}：沒有可驗的孤立實心點`);
      if (has(2) && c.scope === 'all') check('全台：孤立的實心點數 ≥ min(5, 該範圍的實心點數)', counts[2] >= Math.min(5, scoped.filter(p => p[3] === 2).length), () => `${tag}：只有 ${counts[2]} 個`);
    }
    // 視窗外的點不畫（單一系統）；其他系統的點在視窗內畫成更淡的灰
    if (e.idx >= 0) {
      const others = payload.pts.filter(p => p[4] !== e.idx);
      const inside = others.filter(p => inWin(p) && isolated(p)), outside = others.filter(p => !inWin(p));
      let midOther = null;
      for (const p of inside.slice(0, 40)) {
        const [x, y] = project(p);
        const px = img.at(Math.round(x), Math.round(y));
        check(`地圖 ${which}：視窗內其他系統的點畫成灰（手寫的灰）`, px[3] > 150 && dist(px, OTHER[which]) <= 8, () => `${tag}：其他系統點 ${p[0]},${p[1]} 中心 ${px} 期望 ${OTHER[which]}`);
        midOther = px;
      }
      // 「更淡一階」＝跟背景的反差比未收集的灰小
      const offPts = scoped.filter(p => p[3] === 0 && isolated(p));
      if (midOther && offPts.length) {
        const [x, y] = project(offPts[0]);
        const off = img.at(Math.round(x), Math.round(y));
        check(`地圖 ${which}：其他系統的灰比未收集的灰更淡（跟背景的反差更小）`, Math.abs(lum(midOther) - lum(bg)) < Math.abs(lum(off) - lum(bg)), () => `${tag}：其他 ${midOther} 未收集 ${off} 背景 ${bg}`);
      }
      for (const p of outside.slice(0, 60)) {
        const [x, y] = project(p);
        if (x < 0 || y < 0 || x >= W || y >= H) { check(`地圖 ${which}：視窗外的點不畫`, true, ''); continue; }
        check(`地圖 ${which}：視窗外的點不畫`, drawn.every((q, i) => Math.hypot(drawnPos[i][0] - x, drawnPos[i][1] - y) > 2 * rs) ? img.at(Math.round(x), Math.round(y))[3] < 30 : true, () => `${tag}：視窗外點 ${p[0]},${p[1]} 被畫了`);
      }
      // 該系統的點外框至少佔地圖短邊一半：量實際不透明像素（排除最淡的「其他系統」灰）
      if (which === 'light') {
        let x0 = W, x1 = -1, y0 = H, y1 = -1;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const px = img.at(x, y);
          if (px[3] < 200) continue;
          // 系統自己的未收集灰也算（它們是該系統的點）；排除「其他系統」的灰與輪廓細線（都不是該系統的點）
          if (dist(px, OTHER[which]) <= 8 || dist(px, LINE[which]) <= 8) continue;
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
        const span = Math.max(x1 - x0, y1 - y0), shortSide = Math.min(W, H);
        check('單一系統：點外框 ≥ 地圖短邊的 50%（放大到該系統，不是整島縮在角落）', x1 >= 0 && span >= 0.5 * shortSide, () => `${tag}：外框 ${x1 - x0}x${y1 - y0}px／短邊 ${shortSide}px`);
        mapsChecked++;
      }
    } else if (which === 'light') {
      // 全台：整島。點外框佔地圖寬的大部分（台灣本島東西向約 0.95 之後被 inset 吃掉一點）
      let x0 = W, x1 = -1, y0 = H, y1 = -1;
      // 只算「點」的像素：排除全台填色與透明（填色伸出點陣框，算進去外框就恆真）
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const px = img.at(x, y); if (px[3] > 200 && dist(px, FILL[which]) > 12) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
      check('全台：點外框涵蓋整張地圖（≥85% 寬、≥90% 高）', x1 - x0 >= 0.85 * W && y1 - y0 >= 0.9 * H, () => `${tag}：外框 ${x1 - x0}x${y1 - y0}／${W}x${H}`);
      mapsChecked++;
    }

    // ── 輪廓：全台＝陸地填色（畫得出點陣框）、單一系統＝細線；期望色與取樣點都是手寫的 ──
    // 取樣點要離所有畫出的點夠遠（點半徑 rs＋抗鋸齒 1.5px）；填色是均勻的不透明色，沒被點蓋到的像素就是填色本身
    const clear = pos => drawnPos.every(q => Math.hypot(q[0] - pos[0], q[1] - pos[1]) > rs + 1.5);
    const pxAt = pos => img.at(Math.round(pos[0]), Math.round(pos[1]));
    if (e.idx < 0) {
      let landN = 0, seaN = 0, penN = 0, F = null;
      for (const [name, lon, lat] of OUTLINE_LAND) {
        const pos = project(lonLat(lon, lat));
        if (!clear(pos)) continue;
        landN++;
        const px = pxAt(pos);
        F = F ?? px;
        check(`輪廓 ${which}：全台內陸取樣點＝填色`, px[3] > 240 && dist(px, FILL[which]) <= 6, () => `${tag}：${name} 像素 ${px} 應是填色 ${FILL[which]}`);
      }
      for (const [name, lon, lat] of OUTLINE_SEA) {
        const pos = project(lonLat(lon, lat));
        if (!clear(pos)) continue;
        seaN++;
        const px = pxAt(pos);
        check(`輪廓 ${which}：全台海上取樣點＝透明`, px[3] < INK_ALPHA, () => `${tag}：${name} 像素 ${px} 應是透明`);
      }
      for (const [name, lon, lat] of OUTLINE_PENINSULA) {
        const pos = project(lonLat(lon, lat));
        check('輪廓：恆春南端取樣點確實在點陣框底之下（取樣點自檢）', pos[1] > H + 2, () => `${tag}：${name} 投影 y=${pos[1].toFixed(1)}，框高 ${H}`);
        if (!clear(pos)) continue;
        penN++;
        const px = pxAt(pos);
        check(`輪廓 ${which}：恆春半島南端畫在點陣框外（沒被裁）＝填色`, px[3] > 240 && dist(px, FILL[which]) <= 6, () => `${tag}：${name} 框外像素 ${px} 應是填色 ${FILL[which]}（被切平了？）`);
      }
      totals.land += landN; totals.sea += seaN; totals.pen += penN;
      check('輪廓取樣點覆蓋：每張全台圖至少驗到 2 個內陸、2 個海上、1 個南端點', landN >= 2 && seaN >= 2 && penN >= 1, () => `${tag} ${which}：內陸 ${landN}／海上 ${seaN}／南端 ${penN}`);
      // 對比：灰點放在填色上，對比 ≥ 放在卡底上的 0.9 倍（量到的像素）；填色與卡底肉眼可分
      const dotOff = scoped.find(q => q[3] === 0 && isolated(q));
      if (dotOff && F) {
        const D = pxAt(project(dotOff));
        totals.contrast++;
        check(`輪廓 ${which}：灰點對填色的對比 ≥ 灰點對卡底的 0.9 倍（量到的像素算 WCAG）`, contrast(D, F) >= 0.9 * contrast(D, PAPER[which]), () => `${tag}：灰點 ${D} 填色 ${F}：對填色 ${contrast(D, F).toFixed(3)} 對卡底 ${contrast(D, PAPER[which]).toFixed(3)}`);
        check(`輪廓 ${which}：填色與卡底肉眼可分（亮度差 ≥ 3/255）`, Math.abs(lum(F) - lum(PAPER[which])) >= 3, () => `${tag}：填色 ${F} 卡底 ${PAPER[which]}`);
      }
    } else if (OUTLINE_SCOPED.includes(c.scope)) {
      totals.scoped++;
      let probe = null;
      for (let ring = 0; ring <= 12 && !probe; ring++) for (let a = 0; a < 8 && !probe; a++) {
        const pos = [W / 2 + Math.cos(a * Math.PI / 4) * ring * 3 * rs, H / 2 + Math.sin(a * Math.PI / 4) * ring * 3 * rs];
        if (clear(pos)) probe = pos;
      }
      check(`輪廓 ${which}：單一系統視窗中心附近找得到離所有點夠遠的取樣點`, !!probe, `${tag}：找不到取樣點`);
      if (probe) { const px = pxAt(probe); check(`輪廓 ${which}：單一系統是細線不是填色（視窗中心的陸地內部＝透明）`, px[3] < INK_ALPHA, () => `${tag}：中心附近像素 ${px}（被填色了？）`); }
      let lineN = 0, fillN = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const px = img.at(x, y); if (px[3] >= 100 && dist(px, LINE[which]) <= 12) lineN++; if (px[3] > 240 && dist(px, FILL[which]) <= 3) fillN++; }
      check(`輪廓 ${which}：單一系統的海岸線有畫（線色像素 ≥ 20）`, lineN >= 20, () => `${tag}：線色像素 ${lineN}`);
      check(`輪廓 ${which}：單一系統沒有大片填色（填色像素 < 框面積 3%）`, fillN < 0.03 * W * H, () => `${tag}：填色像素 ${fillN}／${W * H}`);
    }
  }

  // A7 輪廓與點的墨（alpha ≥ 8，抗鋸齒淡邊也算）不侵入任何可見文字的字形框、蓋章膠囊框、進度條框。判準不放寬：
  //    小卡的地圖 ImageView 從文字欄右緣開始（左邊不出血），所以這條對所有寬度、語言都是結構性成立，不是這一格剛好過。
  {
    const mapNode = light ? mapL : mapD;
    const raw = pngOf(mapNode.png);
    if (mapNode.drawn) {
      const [dl, dt, dr, db] = mapNode.drawn;
      const sx = (dr - dl) / raw.w, sy = (db - dt) / raw.h;
      let ink = 0;
      for (let y = 0; y < raw.h; y++) for (let x = 0; x < raw.w; x++) if (raw.at(x, y)[3] >= INK_ALPHA) ink++;
      check('墨像素量測有效：這張地圖確實有墨（否則「沒有侵入」是空話）', ink > 200 && sx > 0 && sy > 0, () => `${tag}：墨像素 ${ink}，drawn=${mapNode.drawn}`);
      const boxes = [];
      for (const n of obs.nodes) {
        if (!n.visible || !n.box) continue;
        if (n.id === 'wc_stamp') boxes.push(['wc_stamp（膠囊）', n.box]);
        else if (n.kind === 'text' && (n.text ?? '') !== '') boxes.push([`${n.id}（字形）「${n.text}」`, n.glyph ?? n.box]);
        else if (n.kind === 'progress') boxes.push([`${n.id}（進度條）`, n.box]);
      }
      for (const [name, [bl, bt, br, bb]] of boxes) {
        const x0 = Math.max(0, Math.floor((bl - dl) / sx)), x1 = Math.min(raw.w - 1, Math.ceil((br - dl) / sx));
        const y0 = Math.max(0, Math.floor((bt - dt) / sy)), y1 = Math.min(raw.h - 1, Math.ceil((bb - dt) / sy));
        let hit = 0;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          if (raw.at(x, y)[3] < INK_ALPHA) continue;
          const px = dl + (x + 0.5) * sx, py = dt + (y + 0.5) * sy;
          if (px >= bl && px <= br && py >= bt && py <= bb) hit++;
        }
        totals.inkBoxes++;
        check('輪廓與點不侵入任何可見文字的字形框、蓋章膠囊框、進度條框（alpha≥8 的墨像素＝0）', hit === 0, () => `${tag}：${name} 框內有 ${hit} 個墨像素`);
      }
    }
  }
}

// ── reapply：launcher 對同 layout 的新 RemoteViews 是 reapply 到舊 View 樹 ─────────────────────
{
  const reapply = JSON.parse(readFileSync(need(join(OUT, 'reapply.json')), 'utf8'));
  check('reapply：步數夠多且中／小兩型都有', reapply.length >= 20 && reapply.some(r => r.family === 'medium') && reapply.some(r => r.family === 'small'), `只有 ${reapply.length} 步`);
  for (const r of reapply) {
    check('reapply 之後的畫面＝全新 inflate 的畫面（舊狀態不漏進新畫面）', r.same === true && r.nodes > 5, () => `${r.family} 第 ${r.step} 步（${r.label}）：${r.diff}`);
  }
}
// ── 狀態存檔還原：同 id 的進度條不能被還原成一樣長 ────────────────────────────────────────
{
  const state = JSON.parse(readFileSync(need(join(OUT, 'state.json')), 'utf8'));
  for (const s of state) {
    check('存檔再還原 View 狀態之後，各條進度條的值不變', JSON.stringify(s.before) === JSON.stringify(s.after), () => `${s.label}：還原前 ${JSON.stringify(s.before)}，還原後 ${JSON.stringify(s.after)}`);
  }
  const all = state.find(s => s.label === 'medium all');
  check('狀態還原測試量得到東西：全台中卡的進度條值不全相同', !!all && all.before.length >= 3 && new Set(all.before).size >= 3, () => `${JSON.stringify(all?.before)}`);
}

// ── 點擊目標：蓋章鈕綁 checkin、整張卡仍綁 passport ──────────────────────────────────────────
{
  const rows = JSON.parse(readFileSync(need(join(OUT, 'stamp.json')), 'utf8'));
  check('點擊目標：小、中兩型都量到', rows.length === 2 && rows.some(r => r.family === 'small') && rows.some(r => r.family === 'medium'), `只有 ${rows.length} 筆`);
  for (const r of rows) {
    check('點擊目標：按鈕與整張卡都真的攔到 PendingIntent', r.stampClicked === true && r.rootClicked === true, () => `${r.family}：按鈕 ${r.stampClicked}／整張卡 ${r.rootClicked}`);
    check('點擊目標：蓋章鈕綁 railisland://checkin（不是 passport）', r.stampIsCheckin === true && r.stampIsPassport === false, () => `${r.family}：isCheckin=${r.stampIsCheckin} isPassport=${r.stampIsPassport}（字面 checkin 存在=${r.literalCheckinExists}）`);
    check('點擊目標：按鈕以外仍是開旅程護照（railisland://passport）', r.rootIsPassport === true && r.rootIsCheckin === false, () => `${r.family}：isPassport=${r.rootIsPassport} isCheckin=${r.rootIsCheckin}`);
    check('點擊目標：兩個入口是兩顆不同的 PendingIntent', r.samePending === false, () => `${r.family}：兩個入口是同一顆`);
    check('點擊目標：命中蓋章鈕膠囊的是 wc_stamp_hit、命中標題文字的是 wc_root', r.pillHitId === 'wc_stamp_hit' && r.titleHitId === 'wc_root', () => `${r.family}：膠囊命中 ${r.pillHitId}／標題命中 ${r.titleHitId}`);
    const [el, et, er, eb] = r.effective ?? [0, 0, 0, 0];
    check('點擊目標：實際可點範圍 ≥ 48×36.5dp（小）／48×26dp（中），且填滿（≥98%）', er - el >= 47.75 && eb - et >= (r.family === 'small' ? 36.25 : 25.75) && r.effectiveFilled >= 0.98, () => `${r.family}：可點 [${(r.effective ?? []).join(',')}] 填滿 ${r.effectiveFilled}`);
    check('點擊目標：蓋章鈕的 PendingIntent 建立者是本 App', /^tw\.railisland\.app/.test(r.stampCreator), () => `${r.family}：creator=${r.stampCreator}`);
  }
}

// ── 報表 ─────────────────────────────────────────────────────────────────────
let red = 0;
for (const [name, s] of [...stats].sort()) {
  const ok = s.bad === 0 && s.n > 0;
  if (!ok) red++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}（檢查 ${s.n} 次${s.bad ? `，失敗 ${s.bad}` : ''}）`);
}
check('地圖像素分析至少跑了 30 張', mapsChecked >= 30, `只跑了 ${mapsChecked} 張`);
check('取樣總數不縮水（輪廓的內陸、海上、南端、對比、墨框、單一系統，以及版面關係的文字對數、裁切區數，都不低於量到的實數的約 90%）',
  totals.land >= LAND_MIN && totals.sea >= SEA_MIN && totals.pen >= PEN_MIN && totals.contrast >= CON_MIN && totals.inkBoxes >= INK_MIN && totals.scoped >= SCOPED_MIN
    && totals.textPairs >= PAIRS_MIN && totals.clipRegions >= CLIPS_MIN && Object.entries(HEAD_MIN).every(([k, v]) => totals[k] >= v), () => `實際 ${JSON.stringify(totals)}`);
if (mapsChecked < 30) { red++; console.log(`FAIL 地圖像素分析至少跑了 30 張（只跑了 ${mapsChecked}）`); }
if (failures.length) {
  console.error(`\n失敗明細（前 40 筆／共 ${failures.length}）：`);
  for (const f of failures.slice(0, 40)) console.error(' ✗ ' + f);
}
console.log(`\n輪廓取樣點實數：${JSON.stringify(totals)}`);
console.log(`\n車站收集 Android 預言機：${cases.length} 案、${[...stats.values()].reduce((a, s) => a + s.n, 0)} 次檢查、${red} 項斷言紅`);
process.exit(red || failures.length ? 1 : 0);
