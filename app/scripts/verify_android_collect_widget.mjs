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
    const title = one(obs, 'wc_title');
    const expTitle = isAllScope ? tr(lang, '全台') : e.sys.label;
    check('小卡標題＝範圍名', title?.visible && title.text === expTitle, () => `${tag}：${JSON.stringify(title?.text)}，期望 ${expTitle}`);
  } else {
    const count = one(obs, 'wc_count');
    check('中卡「已收集 v／n 座」', count?.visible && count.text === tr(lang, '已收集 {v}／{n} 座', { v: e.collected, n: e.total }), () => `${tag}：${JSON.stringify(count?.text)}，期望 ${e.collected}／${e.total}`);
    const title = one(obs, 'wc_title');
    const kicker = tr(lang, '車站收集');
    const okTitle = isAllScope ? title?.text === kicker : (title?.text === `${e.sys.label} · ${kicker}` || title?.text === e.sys.label);
    check('中卡標題（全台＝車站收集；單一系統＝系統名［· 車站收集］）', okTitle, () => `${tag}：${JSON.stringify(title?.text)}`);
  }

  // A3 中卡中段內容
  if (!small) {
    if (e.collected === 0) {
      const t = one(obs, 'wc_empty_title');
      check('空狀態：中卡有邀請文案', t?.visible && t.text === tr(lang, '還沒有收集的車站'), () => `${tag}：${JSON.stringify(t?.text)}`);
      check('空狀態：中卡沒有進度條', nodes(obs, 'wc_row_bar').length === 0 && nodes(obs, 'wc_scope_bar').length === 0, `${tag}：空狀態不該有進度條`);
    } else if (isAllScope) {
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
      const want = e.recents.slice(0, 2);
      check('單一系統最近蓋章＝該系統最近的前 ≤2 筆', names.length <= 2 && names.every((t, i) => t === want[i]?.name) && dates.every((t, i) => t === shortDate(want[i]?.d ?? '')), () => `${tag}：畫面 ${names}／${dates}，期望 ${want.map(r => r.name + '／' + shortDate(r.d))}`);
      if (c.hDp >= 200 && want.length > 0) check('夠高的單一系統中卡至少放 1 筆最近蓋章', names.length >= 1, `${tag}：沒有最近蓋章`);
      if (c.hDp >= 200) {
        const solid = one(obs, 'wc_legend_solid');
        if (solid) check('單一系統圖例文字', solid.text === tr(lang, '實心＝搭過／到訪'), () => `${tag}：${solid.text}`);
        else if (lang.startsWith('zh')) check('繁中夠高的單一系統中卡一定放得下圖例', false, `${tag}：沒有圖例`);
      }
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
    check('文字沒有被「…」截斷', n.ellipsized !== true && !/…|\.\.\./.test(n.text), () => `${tag}：${n.id}=${JSON.stringify(n.text)}`);
    check('文字沒有被水平／垂直裁掉', n.clippedH !== true && n.clippedV !== true, () => `${tag}：${n.id}=${JSON.stringify(n.text)} clippedH=${n.clippedH} clippedV=${n.clippedV}`);
    check('文字沒有被折到看不見的行', (n.hiddenLines ?? 0) === 0, () => `${tag}：${n.id}=${JSON.stringify(n.text)} hiddenLines=${n.hiddenLines}`);
    if (n.glyph) {
      const [gl, gt, gr, gb] = n.glyph;
      check('字形在卡片範圍內', gl >= -0.5 && gt >= -0.5 && gr <= c.wDp + 0.5 && gb <= c.hDp + 0.5, () => `${tag}：${n.id} 字形 [${n.glyph.map(v => v.toFixed(1))}] 超出 ${c.wDp}x${c.hDp}`);
    }
  }

  // A6 地圖：Bitmap 尺寸／位元組／深淺 alpha／像素
  const mapL = one(obs, 'wc_map_light'), mapD = one(obs, 'wc_map_dark');
  if (!mapL?.png || !mapD?.png || !mapL.visible) {
    // 小卡窄到文字放不下時整個拿掉地圖（關鍵數字優先）；其餘情況有資料就一定有地圖
    check('有資料就有地圖（只有窄小卡可整個拿掉）', small && c.wDp <= 140, `${tag}：沒有地圖`);
    continue;
  }
  check('淺／深 alpha（淺色模式露淺、深色模式露深）', near(mapL.alpha, light ? 1 : 0, 0.01) && near(mapD.alpha, light ? 0 : 1, 0.01), () => `${tag}：light=${mapL.alpha} dark=${mapD.alpha} theme=${c.theme}`);
  check('Bitmap 寬＝高×aspect', near(mapL.bitmapW, mapL.bitmapH * payload.aspect, 1) && mapL.bitmapW === mapD.bitmapW && mapL.bitmapH === mapD.bitmapH, () => `${tag}：${mapL.bitmapW}x${mapL.bitmapH} aspect=${payload.aspect}`);
  check('Bitmap 位元組＝寬×高×4', mapL.bitmapBytes === mapL.bitmapW * mapL.bitmapH * 4, () => `${tag}：${mapL.bitmapBytes}`);
  check('單張 Bitmap ≤ 560px 高且整卡兩張合計 ≤ 1 MB', mapL.bitmapH <= 560 && obs.bitmapBytes <= 1024 * 1024, () => `${tag}：h=${mapL.bitmapH} bytes=${obs.bitmapBytes}`);

  // 像素：獨立投影每個點
  const win = windowFor(payload, e.idx);
  const dpr = obs.density;
  for (const [which, node] of [['light', mapL], ['dark', mapD]]) {
    const img = pngOf(node.png);
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
        check(`地圖 ${which}：s=1 跟完＝空心（中心透明）`, center[3] < 60, () => `${tag}：點 ${p[0]},${p[1]} 中心 alpha=${center[3]}（實心會是 255）`);
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
        check(`地圖 ${which}：s=0 未收集＝灰色小點`, px[3] > 150 && sat(px) <= 40, () => `${tag}：點 ${p[0]},${p[1]} 中心 ${img.at(Math.round(x), Math.round(y))}`);
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
        check(`地圖 ${which}：視窗內其他系統的點畫成灰`, px[3] > 150 && sat(px) <= 40, () => `${tag}：其他系統點 ${p[0]},${p[1]} 中心 ${px}`);
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
          const isGray = sat(px) <= 40;
          // 系統自己的未收集灰也算（它們是該系統的點）；只排除比它更淡的「其他系統」灰
          if (isGray && lum(px) > 225) continue;
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
        const span = Math.max(x1 - x0, y1 - y0), shortSide = Math.min(W, H);
        check('單一系統：點外框 ≥ 地圖短邊的 50%（放大到該系統，不是整島縮在角落）', x1 >= 0 && span >= 0.5 * shortSide, () => `${tag}：外框 ${x1 - x0}x${y1 - y0}px／短邊 ${shortSide}px`);
        mapsChecked++;
      }
    } else if (which === 'light') {
      // 全台：整島。點外框佔地圖寬的大部分（台灣本島東西向約 0.95 之後被 inset 吃掉一點）
      let x0 = W, x1 = -1, y0 = H, y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (img.at(x, y)[3] > 100) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      check('全台：點外框涵蓋整張地圖（≥85% 寬、≥90% 高）', x1 - x0 >= 0.85 * W && y1 - y0 >= 0.9 * H, () => `${tag}：外框 ${x1 - x0}x${y1 - y0}／${W}x${H}`);
      mapsChecked++;
    }
  }

  // A7 幾何：地圖畫出的矩形與可見文字不相交
  {
    const mapNode = light ? mapL : mapD;
    if (mapNode.drawn) {
      const [dl, dt, dr, db] = mapNode.drawn;
      for (const n of obs.nodes.filter(n => n.kind === 'text' && n.visible && n.glyph)) {
        const [gl, gt, gr, gb] = n.glyph;
        const ix = Math.min(dr, gr) - Math.max(dl, gl), iy = Math.min(db, gb) - Math.max(dt, gt);
        check('地圖與文字不重疊', !(ix > 1 && iy > 1), () => `${tag}：${n.id}=${JSON.stringify(n.text)} 字形 [${n.glyph.map(v => v.toFixed(1))}] 與地圖 [${mapNode.drawn.map(v => v.toFixed(1))}] 相交 ${ix.toFixed(1)}x${iy.toFixed(1)}dp`);
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

// ── 報表 ─────────────────────────────────────────────────────────────────────
let red = 0;
for (const [name, s] of [...stats].sort()) {
  const ok = s.bad === 0 && s.n > 0;
  if (!ok) red++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}（檢查 ${s.n} 次${s.bad ? `，失敗 ${s.bad}` : ''}）`);
}
check('地圖像素分析至少跑了 30 張', mapsChecked >= 30, `只跑了 ${mapsChecked} 張`);
if (mapsChecked < 30) { red++; console.log(`FAIL 地圖像素分析至少跑了 30 張（只跑了 ${mapsChecked}）`); }
if (failures.length) {
  console.error(`\n失敗明細（前 40 筆／共 ${failures.length}）：`);
  for (const f of failures.slice(0, 40)) console.error(' ✗ ' + f);
}
console.log(`\n車站收集 Android 預言機：${cases.length} 案、${[...stats.values()].reduce((a, s) => a + s.n, 0)} 次檢查、${red} 項斷言紅`);
process.exit(red || failures.length ? 1 : 0);
