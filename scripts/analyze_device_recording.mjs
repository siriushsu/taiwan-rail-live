// 真機錄影對齊分析器(Leaflet→MapLibre 換引擎 M0,設計書 3.2)。
// 使用者在手機開 `?engine=maplibre&aligndot=lat,lng` 邊拖邊縮放邊錄影;本腳本用 ffmpeg 抽幀、sharp 讀像素,
// 量每一幀「底圖引擎畫的洋紅點」與「overlay 畫的青點」質心距離,全部影格 ≤ threshold×dpr 影片像素才 PASS。
// --selftest:用 ffmpeg lavfi 合成兩支影片(同心=應 PASS、青點偏 27px=應 FAIL)跑一遍,證明管線與判準有牙。
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
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
  const rows = [];
  for (const f of files) {
    const { data, info } = await sharp(path.join(framesDir, f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const c = probeCentroids(data, info.width, info.height);
    const d = c.mag && c.cyn ? Math.hypot(c.mag.x - c.cyn.x, c.mag.y - c.cyn.y) : null;
    rows.push({ frame: f, mag: c.mag, cyn: c.cyn, dist: d });
  }
  const measured = rows.filter(r => r.dist != null);
  const dists = measured.map(r => r.dist);
  const max = dists.length ? Math.max(...dists) : null, mean = dists.length ? dists.reduce((a, b) => a + b, 0) / dists.length : null;
  const over = measured.filter(r => r.dist > limitPx);
  const pass = measured.length >= 10 && over.length === 0;
  const report = { video, width: meta.width, height: meta.height, fps, dpr, thresholdPt: threshold, limitPx, frames: rows.length, measured: measured.length, max, mean, over: over.length, pass,
    worst: measured.slice().sort((a, b) => b.dist - a.dist).slice(0, 5).map(r => ({ frame: r.frame, dist: +r.dist.toFixed(2) })) };
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  const csvRows = rows.map(r => [r.frame, r.mag && r.mag.x.toFixed(1), r.mag && r.mag.y.toFixed(1), r.cyn && r.cyn.x.toFixed(1), r.cyn && r.cyn.y.toFixed(1), r.dist == null ? '' : r.dist.toFixed(2)].join(','));
  writeFileSync(path.join(out, 'report.csv'), ['frame,magX,magY,cynX,cynY,dist', ...csvRows].join('\n') + '\n');
  return report;
}

function printReport(r) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'} ${path.basename(r.video)} ${r.width}x${r.height} 抽幀 ${r.frames}(有探針 ${r.measured}) 上限 ${r.limitPx}px(=${r.thresholdPt}pt×dpr${r.dpr}) max=${r.max == null ? '-' : r.max.toFixed(2)} mean=${r.mean == null ? '-' : r.mean.toFixed(2)} 超標 ${r.over} 幀`);
  if (r.measured < 10) console.log('  ⚠ 有探針的影格不足 10:錄影裡看不到兩顆探針(顏色門檻、探針被 UI 蓋住、或沒帶 ?aligndot=)——不算 PASS');
  if (r.worst.length) console.log('  最差五幀:' + r.worst.map(w => `${w.frame}=${w.dist}`).join(' '));
}

async function selftest() {
  const out = path.join(HERE, '..', '.superpowers', 'device-recording-selftest');
  mkdirSync(out, { recursive: true });
  // 390x844(iPhone 直向 CSS 尺寸,dpr 當 1 算)、10fps、2 秒;洋紅 36px 方塊在 (177,404),青 24px 方塊同心 / 右移 27px
  const mk = (name, cynX) => { const f = path.join(out, name); run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=black:s=390x844:r=10:d=2,drawbox=x=177:y=404:w=36:h=36:color=magenta:t=fill,drawbox=x=${cynX}:y=410:w=24:h=24:color=cyan:t=fill`, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', f]); return f; };
  const aligned = await analyze(mk('aligned.mp4', 183), path.join(out, 'aligned'), { dpr: 1, threshold: 2 });
  const offset = await analyze(mk('offset.mp4', 210), path.join(out, 'offset'), { dpr: 1, threshold: 2 });
  printReport(aligned); printReport(offset);
  const ok = aligned.pass && aligned.measured >= 15 && !offset.pass && offset.mean > 20 && offset.mean < 34;
  console.log(ok ? '自測通過:同心 PASS、偏移 27px 被抓到' : '自測失敗');
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (args.includes('--selftest')) await selftest();
  else {
    const video = args.find(a => !a.startsWith('--') && /\.(mp4|mov|m4v|webm)$/i.test(a));
    if (!video) { console.error('用法:node scripts/analyze_device_recording.mjs <影片.mp4> [--fps 10] [--dpr 3] [--threshold 2] [--out 目錄]\n      node scripts/analyze_device_recording.mjs --selftest'); process.exit(2); }
    const out = opt('--out', path.join(path.dirname(path.resolve(video)), path.basename(video).replace(/\.[^.]+$/, '') + '-align'));
    mkdirSync(out, { recursive: true });
    const r = await analyze(path.resolve(video), out);
    printReport(r); console.log('  報告:' + path.join(out, 'report.json'));
    process.exit(r.pass ? 0 : 1);
  }
}
