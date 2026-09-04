// 真機錄影對齊分析器(Leaflet→MapLibre 換引擎 M0,設計書 3.2)。
// 使用者在手機開 `?engine=maplibre&aligndot=lat,lng` 邊拖邊縮放邊錄影;本腳本用 ffmpeg 抽幀、sharp 讀像素,
// 量每一幀「底圖引擎畫的洋紅點」與「overlay 畫的青點」圓心距離。圓心用已知半徑的圓擬合(probe_centroids.mjs):
// 探針被列車卡片/HUD/路線壓掉一塊仍量得到;圓周看得見不到 35% 就擬合失敗。
//
// 每一幀分成六類(設計書 3.2「探針找不到＝該格失敗」的落地口徑,09-04 裁定):
//   ok          兩顆都量到、距離 ≤ 上限
//   over        兩顆都量到、距離 > 上限                          → 一格就 FAIL,零容忍
//   absent      兩顆都找不到(探針不在畫面上)                     → 不列判定,但受「覆蓋率」與「最長缺口」閘門管
//   orphanEdge  只找到一顆、且它貼著畫面邊緣(另一顆被裁掉是合理的) → 同 absent
//   orphanNear  只找到一顆、另一顆的顏色就在它附近但擬合不出圓心    → 兩層畫在同一處、只是被遮:同 absent
//   orphanBlind 只找到一顆、附近完全沒有另一顆的顏色              → 可能是一層沒畫(style 重載那幾格會這樣);
//                                                                    短暫可容忍,持續超過 --max-blind 秒或占比超過 --max-blind-share 就 FAIL
// 舊口徑「量到 ≥10 幀就能 PASS」的洞:278 幀的錄影只要 10 幀量到就過,覆蓋率可以無聲縮到 3.6%。
// 現在覆蓋率、最長缺口、盲區都是具名閘門,每個都會印出 值/上限,每個都能單獨紅。
//
// --selftest:用 sharp 畫 SVG 合成影片跑一遍——每條閘門各有一支「該紅就紅」的影片,加上「不該紅就不紅」的對照
// (邊緣孤兒、遮擋孤兒、短暫盲區都要 PASS),證明管線與每一條判準都有牙、也沒有假紅。
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { probeCentroids, colorMassNear, isMag, isCyn, MIN_PIX } from './probe_centroids.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const DEFAULTS = {
  fps: Number(opt('--fps', 10)), dpr: Number(opt('--dpr', 3)), threshold: Number(opt('--threshold', 2)),
  minMeasured: Number(opt('--min-measured', 10)), // 量到的影格絕對下限(太短的錄影不能 PASS)
  coverage: Number(opt('--coverage', 0.6)),        // 量到 / 抽幀總數 的下限
  maxGapSec: Number(opt('--max-gap', 3)),          // 連續量不到(任何原因)的最長秒數
  maxBlindSec: Number(opt('--max-blind', 2)),      // 連續 orphanBlind 的最長秒數(style 重載一次的合理上限)
  maxBlindShare: Number(opt('--max-blind-share', 0.05)), // orphanBlind 占抽幀總數的上限
};
const run = (cmd, a) => { const r = spawnSync(cmd, a, { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`${cmd} ${a.join(' ')}\n${r.stderr}`); return r.stdout; };
const longestRun = (rows, pred) => { let best = 0, cur = 0; for (const r of rows) { cur = pred(r) ? cur + 1 : 0; if (cur > best) best = cur; } return best; };

export async function analyze(video, out, o = {}) {
  const { fps, dpr, threshold, minMeasured, coverage, maxGapSec, maxBlindSec, maxBlindShare } = { ...DEFAULTS, ...o };
  const framesDir = path.join(out, 'frames');
  rmSync(framesDir, { recursive: true, force: true }); mkdirSync(framesDir, { recursive: true });
  const meta = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,duration', '-of', 'json', video])).streams[0];
  run('ffmpeg', ['-y', '-v', 'error', '-i', video, '-vf', `fps=${fps}`, path.join(framesDir, 'f_%05d.png')]);
  const files = readdirSync(framesDir).filter(f => f.endsWith('.png')).sort();
  const limitPx = threshold * dpr;
  const radii = { magR: 18 * dpr, cynR: 5 * dpr }; // index.html 的探針:aligndot circle-radius 18css、overlay ctx.arc 5css
  const edgeMargin = Math.max(radii.magR, radii.cynR) + limitPx; // 找到的那顆離邊緣不到這麼近,另一顆被裁掉就是合理的
  const nearR = 2 * radii.magR;                                   // 「附近」= 兩倍洋紅半徑
  const rows = [];
  for (const f of files) {
    const { data, info } = await sharp(path.join(framesDir, f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const c = probeCentroids(data, info.width, info.height, radii);
    let kind, d = null;
    if (c.mag && c.cyn) { d = Math.hypot(c.mag.x - c.cyn.x, c.mag.y - c.cyn.y); kind = d <= limitPx ? 'ok' : 'over'; }
    else if (!c.mag && !c.cyn) kind = 'absent';
    else {
      const found = c.mag || c.cyn, otherTest = c.mag ? isCyn : isMag;
      if (found.x < edgeMargin || found.y < edgeMargin || found.x > info.width - edgeMargin || found.y > info.height - edgeMargin) kind = 'orphanEdge';
      else if (colorMassNear(data, info.width, info.height, otherTest, found.x, found.y, nearR) >= MIN_PIX) kind = 'orphanNear';
      else kind = 'orphanBlind';
    }
    rows.push({ frame: f, mag: c.mag, cyn: c.cyn, dist: d, kind });
  }
  const kinds = { ok: 0, over: 0, absent: 0, orphanEdge: 0, orphanNear: 0, orphanBlind: 0 };
  for (const r of rows) kinds[r.kind]++;
  const measured = rows.filter(r => r.dist != null);
  const dists = measured.map(r => r.dist);
  const max = dists.length ? Math.max(...dists) : null, mean = dists.length ? dists.reduce((a, b) => a + b, 0) / dists.length : null;
  const arcMin = measured.length ? Math.min(...measured.map(r => Math.min(r.mag.arc, r.cyn.arc))) : null;
  const longestUnmeasuredRun = longestRun(rows, r => r.dist == null);
  const longestBlindRun = longestRun(rows, r => r.kind === 'orphanBlind');
  const frames = rows.length;
  // 每條閘門都印值與上限、都能單獨紅;pass 是全部同時綠。名字固定,自測用名字指名「這支影片考的是哪一條」。
  const gates = [
    { name: 'over', label: '每格 ≤ 上限(超標幀數)', value: kinds.over, limit: 0, pass: kinds.over === 0 },
    { name: 'min-measured', label: '量到的影格數 ≥', value: measured.length, limit: minMeasured, pass: measured.length >= minMeasured },
    { name: 'coverage', label: '覆蓋率(量到/抽幀) ≥', value: frames ? +(measured.length / frames).toFixed(3) : 0, limit: coverage, pass: frames > 0 && measured.length / frames >= coverage },
    { name: 'max-gap', label: '最長連續量不到(幀) ≤', value: longestUnmeasuredRun, limit: Math.round(maxGapSec * fps), pass: longestUnmeasuredRun <= Math.round(maxGapSec * fps) },
    { name: 'max-blind-run', label: '最長連續盲區(幀) ≤', value: longestBlindRun, limit: Math.round(maxBlindSec * fps), pass: longestBlindRun <= Math.round(maxBlindSec * fps) },
    { name: 'blind-share', label: '盲區占比 ≤', value: frames ? +(kinds.orphanBlind / frames).toFixed(3) : 0, limit: maxBlindShare, pass: !frames || kinds.orphanBlind / frames <= maxBlindShare },
  ];
  const pass = frames > 0 && gates.every(g => g.pass);
  const report = { video, width: meta.width, height: meta.height, fps, dpr, thresholdPt: threshold, limitPx, radii, edgeMargin, nearR,
    frames, measured: measured.length, unmeasured: frames - measured.length, kinds, longestUnmeasuredRun, longestBlindRun, arcMin, max, mean, over: kinds.over, gates, pass,
    worst: measured.slice().sort((a, b) => b.dist - a.dist).slice(0, 5).map(r => ({ frame: r.frame, dist: +r.dist.toFixed(2) })) };
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  const fx = (v, k) => v ? v[k].toFixed(k === 'arc' ? 2 : 1) : '';
  const csvRows = rows.map(r => [r.frame, r.kind, fx(r.mag, 'x'), fx(r.mag, 'y'), fx(r.cyn, 'x'), fx(r.cyn, 'y'), r.dist == null ? '' : r.dist.toFixed(2), fx(r.mag, 'arc'), fx(r.cyn, 'arc')].join(','));
  writeFileSync(path.join(out, 'report.csv'), ['frame,kind,magX,magY,cynX,cynY,dist,magArc,cynArc', ...csvRows].join('\n') + '\n');
  return report;
}

export const failedGates = r => r.gates.filter(g => !g.pass).map(g => g.name);

function printReport(r) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'} ${path.basename(r.video)} ${r.width}x${r.height} 抽幀 ${r.frames}(量到 ${r.measured}、未量到 ${r.unmeasured}) 上限 ${r.limitPx}px(=${r.thresholdPt}pt×dpr${r.dpr}) max=${r.max == null ? '-' : r.max.toFixed(2)} mean=${r.mean == null ? '-' : r.mean.toFixed(2)}`);
  console.log(`  影格分類: ok=${r.kinds.ok} over=${r.kinds.over} absent=${r.kinds.absent} orphanEdge=${r.kinds.orphanEdge} orphanNear=${r.kinds.orphanNear} orphanBlind=${r.kinds.orphanBlind}`);
  for (const g of r.gates) console.log(`  ${g.pass ? '✓' : '✗'} ${g.name.padEnd(14)} ${g.label} ${g.value} / ${g.limit}`);
  if (r.measured < 10) console.log('  ⚠ 量到的影格不足 10:錄影裡看不到兩顆探針(探針不在畫面上、被 UI 蓋掉超過六成、或沒帶 ?aligndot=)');
  if (r.worst.length) console.log('  最差五幀:' + r.worst.map(w => `${w.frame}=${w.dist}`).join(' '));
}

// 合成測試影片:390x844(iPhone 直向 CSS 尺寸,dpr 當 1 算)、10fps;每一幀各自指定——
//   mag/cyn:畫不畫那顆;cynDx:青點右移;occlude:深色矩形從圓心下方 3px 蓋到底(兩顆都只剩上半);
//   cx:圓心 x(負值＝貼左邊緣);cover:[{x,y,w,h}] 額外的深色矩形(做「遮到擬合不出、但顏色還在」的孤兒)。
const CX = 195, CY = 422;
async function synth(dir, name, frames) {
  const fdir = path.join(dir, name + '-frames'); rmSync(fdir, { recursive: true, force: true }); mkdirSync(fdir, { recursive: true });
  const W = 390, H = 844;
  let i = 0;
  for (const fr of frames) {
    const { mag = true, cyn = true, cynDx = 0, occlude = false, cx = CX, cy = CY, cover = [] } = fr;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#e8e8e8"/>` +
      (mag ? `<circle cx="${cx}" cy="${cy}" r="18" fill="#ff00ff"/>` : '') +
      (cyn ? `<circle cx="${cx + cynDx}" cy="${cy}" r="5" fill="#00ffff"/>` : '') +
      (occlude ? `<rect x="0" y="${cy + 3}" width="${W}" height="${H - cy - 3}" fill="#222"/>` : '') +
      cover.map(c => `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="#222"/>`).join('') + '</svg>';
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    writeFileSync(path.join(fdir, `f_${String(++i).padStart(3, '0')}.png`), png);
  }
  const f = path.join(dir, name + '.mp4');
  run('ffmpeg', ['-y', '-v', 'error', '-framerate', '10', '-i', path.join(fdir, 'f_%03d.png'), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', f]);
  return f;
}

async function selftest() {
  const out = path.join(HERE, '..', '.superpowers', 'device-recording-selftest');
  mkdirSync(out, { recursive: true });
  const A = (n, o = {}) => Array.from({ length: n }, () => ({ ...o }));
  const NONE = n => Array.from({ length: n }, () => ({ mag: false, cyn: false }));
  const only = (r, ...names) => failedGates(r).join(',') === names.join(','); // 紅的恰好是指名那幾條(考的是哪一層要說清楚)
  // 洋紅 r18 貼左緣:圓心 x=-4 → 洋紅可見弧 0.43 擬合得出、青 r5 只剩 1px 擬合不出 → 該判 orphanEdge、不能假紅
  const EDGE = { cx: -4 };
  // 上下兩條帶子把洋紅 r18 蓋到只剩中間 12px 高的橫帶(可見弧 ≈0.22 擬合不出、但顏色還在);青 r5 整顆在帶子裡 → orphanNear
  const NEAR = { cover: [{ x: CX - 18, y: CY - 18, w: 36, h: 12 }, { x: CX - 18, y: CY + 6, w: 36, h: 12 }] };
  const cases = [
    // 原有四支:管線與「遮擋不假紅、遮擋藏不住錯位」
    ['aligned', A(20), r => r.pass && r.measured >= 15 && r.mean < 1.5],
    ['offset', A(20, { cynDx: 27 }), r => !r.pass && only(r, 'over') && r.mean > 24 && r.mean < 30],
    ['occluded', A(20, { occlude: true }), r => r.pass && r.measured >= 15 && r.mean < 2.5],
    ['occluded-offset', A(20, { cynDx: 27, occlude: true }), r => !r.pass && only(r, 'over') && r.mean > 24 && r.mean < 30],
    // 對照組:三種「只找到一顆」都不該假紅,且要被分到對的類
    ['edge-orphan', [...A(20), ...A(5, EDGE)], r => r.pass && r.kinds.orphanEdge === 5 && r.measured === 20],
    ['near-orphan', [...A(20), ...A(5, NEAR)], r => r.pass && r.kinds.orphanNear === 5 && r.measured === 20],
    ['blind-transient', [...A(60), ...A(4, { cyn: false }), ...A(40)], r => r.pass && r.kinds.orphanBlind === 4],
    // 每條新閘門各一支該紅的:紅的必須恰好是那一條(blind-persistent 同時踩 run 與 share 兩條,兩條都是它該紅的理由)
    ['blind-persistent', [...A(60), ...A(25, { cyn: false }), ...A(40)], r => !r.pass && only(r, 'max-blind-run', 'blind-share') && r.kinds.orphanBlind === 25],
    ['low-coverage', [...A(12), ...NONE(28)], r => !r.pass && only(r, 'coverage') && r.measured === 12],
    ['long-gap', [...A(30), ...NONE(35), ...A(30)], r => !r.pass && only(r, 'max-gap') && r.longestUnmeasuredRun === 35],
    ['too-short', [...A(6), ...NONE(1)], r => !r.pass && only(r, 'min-measured') && r.measured === 6],
  ];
  let ok = true;
  for (const [name, frames, expect] of cases) {
    const r = await analyze(await synth(out, name, frames), path.join(out, name), { dpr: 1, threshold: 2 });
    printReport(r);
    const good = expect(r); ok = ok && good;
    console.log(`  ${good ? '✓' : '✗'} 自測 ${name}`);
  }
  console.log(ok ? `自測通過:${cases.length} 支——同心 PASS、偏移 27px 被抓到、遮擋不假紅也藏不住錯位;邊緣/遮擋/短暫盲區三種孤兒不假紅;持續盲區、覆蓋率、最長缺口、太短各自紅在指名的那條閘門` : '自測失敗');
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (args.includes('--selftest')) await selftest();
  else {
    const video = args.find(a => !a.startsWith('--') && /\.(mp4|mov|m4v|webm)$/i.test(a));
    if (!video) { console.error('用法:node scripts/analyze_device_recording.mjs <影片.mp4> [--fps 10] [--dpr 3] [--threshold 2] [--coverage 0.6] [--max-gap 3] [--max-blind 2] [--max-blind-share 0.05] [--min-measured 10] [--out 目錄]\n      node scripts/analyze_device_recording.mjs --selftest'); process.exit(2); }
    // iPhone 螢幕錄影預設檔名有空格(ScreenRecording_09-03-2026 16-43-18_1.MP4),沒加引號會被 shell 切成兩段;先驗檔案在不在,不要留 ffprobe 的堆疊給使用者猜。
    if (!existsSync(video)) { console.error(`找不到影片:${path.resolve(video)}\n  收到的參數:${JSON.stringify(args)}\n  檔名有空格要整段加引號(或把檔案拖進終端機讓它自動跳脫)`); process.exit(2); }
    const out = opt('--out', path.join(path.dirname(path.resolve(video)), path.basename(video).replace(/\.[^.]+$/, '') + '-align'));
    mkdirSync(out, { recursive: true });
    const r = await analyze(path.resolve(video), out);
    printReport(r); console.log('  報告:' + path.join(out, 'report.json'));
    process.exit(r.pass ? 0 : 1);
  }
}
