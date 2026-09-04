#!/usr/bin/env node
/**
 * 軌島內部宣傳縮時批次產片器。
 *
 * 一般使用者介面沒有入口；本工具只在本機啟動軌島、注入 renderer，再把 WebM 轉成
 * Threads／Instagram 可直接使用的 1080×1350 H.264 MP4。
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const RENDERER = join(HERE, 'timelapse_renderer.js');
const AREA_ROWS = [
  ['all', '全島'], ['keelung', '基隆'], ['taipei', '台北'], ['ntpc', '新北'],
  ['taoyuan', '桃園'], ['hsinchu', '新竹'], ['miaoli', '苗栗'], ['taichung', '台中'],
  ['changhua', '彰化'], ['nantou', '南投'], ['yunlin', '雲林'], ['chiayi', '嘉義'],
  ['tainan', '台南'], ['kaohsiung', '高雄'], ['pingtung', '屏東'], ['yilan', '宜蘭'],
  ['hualien', '花蓮'], ['taitung', '台東'],
];
const AREA_LABEL = Object.fromEntries(AREA_ROWS);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};

function usage() {
  console.log(`用法：
  node scripts/render_timelapse.mjs --area all
  node scripts/render_timelapse.mjs --areas all,taipei,kaohsiung
  node scripts/render_timelapse.mjs --all-areas

選項：
  --output DIR       輸出資料夾（預設：輸出/縮時_YYYY-MM-DD）
  --duration SEC     每支片長，預設 16 秒
  --fps N            幀率，預設 30
  --scale N          尺寸倍率，預設 1（1080×1350）；0.5 為 540×675 草稿
  --still P          不錄影，只輸出指定進度 0..1 的 PNG
  --audio FILE       將授權確認過的音樂循環混入 MP4
  --keep-webm        保留 Chromium 產生的中間 WebM
  --headed           顯示產片用 Chromium 視窗
  --help             顯示本說明`);
}

function parseArgs(argv) {
  const args = { areas: ['all'], duration: 16, fps: 30, scale: 1, still: null,
    audio: '', keepWebm: false, headed: false, output: '' };
  const need = (i, key) => {
    if (i + 1 >= argv.length) throw new Error(`${key} 缺少值`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { usage(); process.exit(0); }
    else if (arg === '--all-areas') args.areas = AREA_ROWS.map(([id]) => id);
    else if (arg === '--area') args.areas = [need(i++, arg)];
    else if (arg === '--areas') args.areas = need(i++, arg).split(',').map(v => v.trim()).filter(Boolean);
    else if (arg === '--output') args.output = need(i++, arg);
    else if (arg === '--duration') args.duration = Number(need(i++, arg));
    else if (arg === '--fps') args.fps = Number(need(i++, arg));
    else if (arg === '--scale') args.scale = Number(need(i++, arg));
    else if (arg === '--still') args.still = Number(need(i++, arg));
    else if (arg === '--audio') args.audio = need(i++, arg);
    else if (arg === '--keep-webm') args.keepWebm = true;
    else if (arg === '--headed') args.headed = true;
    else throw new Error(`不認得選項：${arg}`);
  }
  args.areas = [...new Set(args.areas)];
  for (const id of args.areas) if (!AREA_LABEL[id]) throw new Error(`不認得地區：${id}`);
  if (!(args.duration >= 1 && args.duration <= 120)) throw new Error('--duration 必須介於 1..120 秒');
  if (!(args.fps >= 12 && args.fps <= 60)) throw new Error('--fps 必須介於 12..60');
  if (!(args.scale >= .25 && args.scale <= 2)) throw new Error('--scale 必須介於 0.25..2');
  if (args.still != null && !(args.still >= 0 && args.still <= 1)) throw new Error('--still 必須介於 0..1');
  if (args.audio) {
    args.audio = resolve(args.audio);
    if (!existsSync(args.audio)) throw new Error('找不到音樂檔：' + args.audio);
  }
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  args.output = resolve(args.output || join(ROOT, '輸出', `縮時_${day}`));
  return args;
}

function startServer() {
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const target = resolve(ROOT, '.' + pathname);
      if (target !== ROOT && !target.startsWith(ROOT + sep)) { response.writeHead(403); response.end('forbidden'); return; }
      if (!existsSync(target) || !statSync(target).isFile()) { response.writeHead(404); response.end('not found'); return; }
      response.writeHead(200, {
        'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      createReadStream(target).pipe(response);
    } catch (error) {
      response.writeHead(500); response.end(String(error));
    }
  });
  return new Promise((resolvePromise, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolvePromise({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${command} 結束碼 ${code}`)));
  });
}

function ffmpegArgs(webm, mp4, options) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', webm];
  if (options.audio) args.push('-stream_loop', '-1', '-i', options.audio);
  args.push('-map', '0:v:0');
  if (options.audio) args.push('-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k');
  // H.264 yuv420p 要求寬高皆為偶數；正式 1080×1350 原本就合法，0.5× 草稿會變 540×675，
  // 因此只在轉檔尾端向下補成最近的偶數，不改 renderer 的版面比例。
  args.push('-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-r', String(options.fps), '-t', String(options.duration), '-movflags', '+faststart', mp4);
  return args;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0 && options.still == null)
    throw new Error('找不到 ffmpeg；影片轉成社群可用 MP4 需要 ffmpeg');
  mkdirSync(options.output, { recursive: true });
  const { server, origin } = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: !options.headed });
    const width = Math.round(1080 * options.scale), height = Math.round(1350 * options.scale);
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, acceptDownloads: true });
    const page = await context.newPage();
    page.on('console', message => {
      if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) console.error('[browser]', message.text());
    });
    console.log(`載入軌島資料：${origin}`);
    await page.goto(origin + '/?g=all', { waitUntil: 'domcontentloaded', timeout: 60000 });
    // ready 代表十個系統的資料已裝好；是否已切進「全」不綁在這道等待，renderer.init 會用同一條
    // loadAllGroup 正式路徑切換。把 decoLines 寫進 wait 會在上次檢視不是「全」時永遠等不到。
    await page.waitForFunction(() => typeof state !== 'undefined' && state.ready && state.systems.length >= 10,
      null, { timeout: 90000 });
    await page.addScriptTag({ path: RENDERER });
    const initialized = await page.evaluate(async scale => window.RAIL_TIMELAPSE.init({ scale }), options.scale);
    console.log(`班表日 ${initialized.date}；畫布 ${initialized.width}×${initialized.height}`);

    for (let index = 0; index < options.areas.length; index++) {
      const area = options.areas[index], label = AREA_LABEL[area];
      const prefix = String(index).padStart(2, '0');
      const basename = `${prefix}_${label}_軌島一日縮時`;
      if (options.still != null) {
        const meta = await page.evaluate(({ areaId, progress }) => window.RAIL_TIMELAPSE.render(areaId, progress),
          { areaId: area, progress: options.still });
        const output = join(options.output, basename + '.png');
        await page.locator('#railTimelapseCanvas').screenshot({ path: output });
        console.log(`[${index + 1}/${options.areas.length}] ${label} PNG：${relative(ROOT, output)}（${meta.running} 班）`);
        continue;
      }

      const webm = join(options.output, basename + '.webm');
      const mp4 = join(options.output, basename + '.mp4');
      console.log(`[${index + 1}/${options.areas.length}] 錄製 ${label} ${options.duration}s…`);
      const downloadPromise = page.waitForEvent('download', { timeout: (options.duration + 30) * 1000 });
      const meta = await page.evaluate(async opts => window.RAIL_TIMELAPSE.record(opts), {
        area, duration: options.duration, fps: options.fps, bitrate: 12e6,
        filename: basename + '.webm',
      });
      const download = await downloadPromise;
      await download.saveAs(webm);
      await run('ffmpeg', ffmpegArgs(webm, mp4, options));
      if (!options.keepWebm) {
        const { unlink } = await import('node:fs/promises');
        await unlink(webm);
      }
      const mb = (statSync(mp4).size / 1048576).toFixed(1);
      console.log(`    完成 ${relative(ROOT, mp4)}（${mb} MB，來源 ${Math.round(meta.bytes / 1024)} KB）`);
    }
    await context.close();
    console.log(`全部完成：${options.output}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
}

main().catch(error => {
  console.error('縮時產片失敗：' + (error && error.stack || error));
  process.exitCode = 1;
});
