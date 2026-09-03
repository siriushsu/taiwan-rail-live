// 真機錄影對齊分析器(Leaflet→MapLibre 換引擎 M0,設計書 3.2)。
// 使用者在手機開 `?engine=maplibre&aligndot=lat,lng` 邊拖邊縮放邊錄影;本腳本用 ffmpeg 抽幀、sharp 讀像素,
// 量每一幀「底圖引擎畫的洋紅點」與「overlay 畫的青點」圓心距離,量得到的影格全部 ≤ threshold×dpr 影片像素才 PASS。
// 圓心用已知半徑的圓擬合(probe_centroids.mjs):探針被列車卡片/HUD/路線壓掉一塊仍量得到;圓周看得見不到 35%
// 或探針不在畫面上的影格算「未量到」,不列入判定,但量到的要 ≥10 幀才能 PASS。
// --selftest:用 sharp 畫 SVG 圓合成四支影片跑一遍——同心=PASS、青點偏 27px=FAIL、同心但兩顆下半被遮=仍 PASS、
// 偏 27px 且被遮=仍 FAIL——證明管線、判準,以及「遮擋不會假紅、也不會把真錯位藏起來」都有牙。
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { probeCentroids } from './probe_centroids.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const FPS = Number(opt('--fps', 10)), DPR = Number(opt('--dpr', 3)), THR = Number(opt('--threshold', 2));
const run = (cmd, a) => { const r = spawnSync(cmd, a, { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`${cmd} ${a.join(' ')}\n${r.stderr}`); return r.stdout; };

export async function analyze(video, out, { fps = FPS, dpr = DPR, threshold = THR } = {}) {
  const framesDir = path.join(out, 'frames');
  rmSync(framesDir, { recursive: true, force: true }); mkdirSync(framesDir, { recursive: true });
  const meta = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,duration', '-of', 'json', video])).streams[0];
  run('ffmpeg', ['-y', '-v', 'error', '-i', video, '-vf', `fps=${fps}`, path.join(framesDir, 'f_%05d.png')]);
  const files = readdirSync(framesDir).filter(f => f.endsWith('.png')).sort();
  const limitPx = threshold * dpr;
  const radii = { magR: 18 * dpr, cynR: 5 * dpr }; // index.html 的探針:aligndot circle-radius 18css、overlay ctx.arc 5css
  const rows = [];
  for (const f of files) {
    const { data, info } = await sharp(path.join(framesDir, f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const c = probeCentroids(data, info.width, info.height, radii);
    const d = c.mag && c.cyn ? Math.hypot(c.mag.x - c.cyn.x, c.mag.y - c.cyn.y) : null;
    rows.push({ frame: f, mag: c.mag, cyn: c.cyn, dist: d });
  }
  const measured = rows.filter(r => r.dist != null);
  const dists = measured.map(r => r.dist);
  const max = dists.length ? Math.max(...dists) : null, mean = dists.length ? dists.reduce((a, b) => a + b, 0) / dists.length : null;
  const over = measured.filter(r => r.dist > limitPx);
  const pass = measured.length >= 10 && over.length === 0;
  const arcMin = measured.length ? Math.min(...measured.map(r => Math.min(r.mag.arc, r.cyn.arc))) : null;
  const report = { video, width: meta.width, height: meta.height, fps, dpr, thresholdPt: threshold, limitPx, radii, frames: rows.length, measured: measured.length, unmeasured: rows.length - measured.length, arcMin, max, mean, over: over.length, pass,
    worst: measured.slice().sort((a, b) => b.dist - a.dist).slice(0, 5).map(r => ({ frame: r.frame, dist: +r.dist.toFixed(2) })) };
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  const fx = (v, k) => v ? v[k].toFixed(k === 'arc' ? 2 : 1) : '';
  const csvRows = rows.map(r => [r.frame, fx(r.mag, 'x'), fx(r.mag, 'y'), fx(r.cyn, 'x'), fx(r.cyn, 'y'), r.dist == null ? '' : r.dist.toFixed(2), fx(r.mag, 'arc'), fx(r.cyn, 'arc')].join(','));
  writeFileSync(path.join(out, 'report.csv'), ['frame,magX,magY,cynX,cynY,dist,magArc,cynArc', ...csvRows].join('\n') + '\n');
  return report;
}

function printReport(r) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'} ${path.basename(r.video)} ${r.width}x${r.height} 抽幀 ${r.frames}(量到 ${r.measured}、未量到 ${r.unmeasured}) 上限 ${r.limitPx}px(=${r.thresholdPt}pt×dpr${r.dpr}) max=${r.max == null ? '-' : r.max.toFixed(2)} mean=${r.mean == null ? '-' : r.mean.toFixed(2)} 超標 ${r.over} 幀`);
  if (r.measured < 10) console.log('  ⚠ 量到的影格不足 10:錄影裡看不到兩顆探針(探針不在畫面上、被 UI 蓋掉超過六成、或沒帶 ?aligndot=)——不算 PASS');
  if (r.worst.length) console.log('  最差五幀:' + r.worst.map(w => `${w.frame}=${w.dist}`).join(' '));
}

// 合成測試影片:390x844(iPhone 直向 CSS 尺寸,dpr 當 1 算)、10fps、2 秒;洋紅 r18 圓心 (195,422),青 r5 同心 / 右移 cynDx。
// occlude:深色矩形從圓心下方 3px 蓋到底,兩顆探針都只剩上半——舊的像素質心法在這裡會把兩顆質心推開 ~6px 而假紅。
async function synth(dir, name, { cynDx = 0, occlude = false } = {}) {
  const fdir = path.join(dir, name + '-frames'); rmSync(fdir, { recursive: true, force: true }); mkdirSync(fdir, { recursive: true });
  const W = 390, H = 844, cx = 195, cy = 422;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#e8e8e8"/><circle cx="${cx}" cy="${cy}" r="18" fill="#ff00ff"/><circle cx="${cx + cynDx}" cy="${cy}" r="5" fill="#00ffff"/>${occlude ? `<rect x="0" y="${cy + 3}" width="${W}" height="${H - cy - 3}" fill="#222"/>` : ''}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  for (let i = 1; i <= 20; i++) writeFileSync(path.join(fdir, `f_${String(i).padStart(3, '0')}.png`), png);
  const f = path.join(dir, name + '.mp4');
  run('ffmpeg', ['-y', '-v', 'error', '-framerate', '10', '-i', path.join(fdir, 'f_%03d.png'), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', f]);
  return f;
}

async function selftest() {
  const out = path.join(HERE, '..', '.superpowers', 'device-recording-selftest');
  mkdirSync(out, { recursive: true });
  const cases = [
    ['aligned', { cynDx: 0 }, r => r.pass && r.measured >= 15 && r.mean < 1.5],
    ['offset', { cynDx: 27 }, r => !r.pass && r.mean > 24 && r.mean < 30],
    ['occluded', { cynDx: 0, occlude: true }, r => r.pass && r.measured >= 15 && r.mean < 2.5],
    ['occluded-offset', { cynDx: 27, occlude: true }, r => !r.pass && r.mean > 24 && r.mean < 30],
  ];
  let ok = true;
  for (const [name, o, expect] of cases) {
    const r = await analyze(await synth(out, name, o), path.join(out, name), { dpr: 1, threshold: 2 });
    printReport(r);
    const good = expect(r); ok = ok && good;
    console.log(`  ${good ? '✓' : '✗'} 自測 ${name}`);
  }
  console.log(ok ? '自測通過:同心 PASS、偏移 27px 被抓到、下半被遮仍量得到、被遮的錯位仍被抓到' : '自測失敗');
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (args.includes('--selftest')) await selftest();
  else {
    const video = args.find(a => !a.startsWith('--') && /\.(mp4|mov|m4v|webm)$/i.test(a));
    if (!video) { console.error('用法:node scripts/analyze_device_recording.mjs <影片.mp4> [--fps 10] [--dpr 3] [--threshold 2] [--out 目錄]\n      node scripts/analyze_device_recording.mjs --selftest'); process.exit(2); }
    // iPhone 螢幕錄影預設檔名有空格(ScreenRecording_09-03-2026 16-43-18_1.MP4),沒加引號會被 shell 切成兩段;先驗檔案在不在,不要留 ffprobe 的堆疊給使用者猜。
    if (!existsSync(video)) { console.error(`找不到影片:${path.resolve(video)}\n  收到的參數:${JSON.stringify(args)}\n  檔名有空格要整段加引號(或把檔案拖進終端機讓它自動跳脫)`); process.exit(2); }
    const out = opt('--out', path.join(path.dirname(path.resolve(video)), path.basename(video).replace(/\.[^.]+$/, '') + '-align'));
    mkdirSync(out, { recursive: true });
    const r = await analyze(path.resolve(video), out);
    printReport(r); console.log('  報告:' + path.join(out, 'report.json'));
    process.exit(r.pass ? 0 : 1);
  }
}
