import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const args = new Map(
  process.argv.slice(2).map(argument => {
    const [key, ...rest] = argument.split('=');
    return [key, rest.join('=')];
  })
);
const samples = Number(args.get('--samples') || process.env.RAIL_PLACE_INDEX_SAMPLES || 16);
const outputPath = resolve(args.get('--output') || join(repoRoot, 'data/place_index.json'));

if (!Number.isInteger(samples) || samples < 1 || samples > 128) {
  throw new Error(`--samples 必須是 1...128 的整數，收到 ${samples}`);
}

const md5 = async path => createHash('md5').update(await readFile(path)).digest('hex');
const indexPath = join(repoRoot, 'index.html');
const ownPath = fileURLToPath(import.meta.url);
console.log(`[G0] directory=${repoRoot}`);
console.log(`[G0] index.md5=${await md5(indexPath)}`);
console.log(`[G0] generator.md5=${await md5(ownPath)}`);
console.log(`[G0] pageSource=${relative(repoRoot, indexPath)} byteSource=current-worktree`);

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'],
]);
const rootPrefix = repoRoot.endsWith(sep) ? repoRoot : `${repoRoot}${sep}`;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const relativePath = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    const filePath = resolve(repoRoot, relativePath);
    if (filePath !== repoRoot && !filePath.startsWith(rootPrefix)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    response.writeHead(200, {
      'Content-Type': mime.get(extname(filePath).toLowerCase()) || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(await readFile(filePath));
  } catch {
    response.writeHead(404).end('Not found');
  }
});

await new Promise((resolveListen, rejectListen) => {
  server.once('error', rejectListen);
  server.listen(0, '127.0.0.1', resolveListen);
});
const address = server.address();
const pageURL = `http://127.0.0.1:${address.port}/`;
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.goto(pageURL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => state.ready
      && state.passObs
      && state.systems.some(system => system.id === 'tra_sched' && system._track)
      && state.systems.some(system => system.id === 'thsr_sched' && system._track),
    null,
    { timeout: 120_000 }
  );

  const output = await page.evaluate(async ({ samples }) => {
    const specs = [
      {
        runtimeID: 'tra_sched',
        outputID: 'tra',
        scheduleURL: './data/tra_schedule_dense.json',
      },
      {
        runtimeID: 'thsr_sched',
        outputID: 'thsr',
        scheduleURL: './data/thsr_schedule_dense.json',
      },
    ];
    const lines = {};
    const segs = [];
    const trains = [];
    const stats = {};
    const linearLegs = [];

    for (const spec of specs) {
      const system = state.systems.find(candidate => candidate.id === spec.runtimeID);
      if (!system || !system._track) throw new Error(`頁面缺少系統或線形：${spec.runtimeID}`);
      const response = await fetch(spec.scheduleURL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`讀不到 ${spec.scheduleURL}: HTTP ${response.status}`);
      const document = await response.json();
      const rawTrains = document.trains || [];
      rawTrains.forEach(train => { train.sys = spec.runtimeID; });

      state._segStats = { onShape: 0, straight: 0, bridged: 0 };
      assignSchedShapePathsFor(rawTrains, system._track.lines);
      stats[spec.outputID] = { ...state._segStats, trains: rawTrains.length };

      const segmentLineOrder = new Map();
      for (const train of rawTrains) {
        for (const stop of train.stops || []) {
          if (
            stop.segLn
            && !segmentLineOrder.has(stop.segLn.id)
          ) {
            segmentLineOrder.set(stop.segLn.id, segmentLineOrder.size);
          }
        }
      }
      const orderBase = Object.keys(lines).length;
      for (const line of system._track.lines) {
        ensureCum(line);
        lines[line.id] = {
          sys: spec.outputID,
          name: pinLnName(line),
          color: line.color || '#7a6c50',
          order: orderBase + (
            segmentLineOrder.get(line.id)
              ?? segmentLineOrder.size
                + system._track.lines.indexOf(line)
          ),
        };
      }

      const dayKeys = Object.keys(document.dates || {}).sort();
      const masks = new Array(rawTrains.length).fill(0);
      if (dayKeys.length) {
        dayKeys.forEach((day, dayIndex) => {
          for (const trainIndex of document.dates[day] || []) {
            masks[trainIndex] |= 1 << dayIndex;
          }
        });
      } else {
        masks.fill((1 << 14) - 1);
      }

      rawTrains.forEach((train, sourceTrainIndex) => {
        const days = masks[sourceTrainIndex] || 0;
        if (!days) return;
        const trainIndex = trains.length;
        const stops = train.stops || [];
        trains.push({
          no: String(train.train),
          ty: train.typeName || '',
          days,
          sys: spec.outputID,
          to: stops.length ? stops[stops.length - 1].name : '',
        });

        for (let stopIndex = 0; stopIndex < stops.length - 1; stopIndex++) {
          const segment = stops[stopIndex];
          const next = stops[stopIndex + 1];
          if (!segment.segLn || segment.dA == null || segment.dB == null) continue;
          const lineKm = Math.abs(segment.dB - segment.dA);
          const totalKm = schedSegmentKm(segment);
          if (!(lineKm > 0) || !(totalKm > 0)) continue;
          if (!segment.rp) {
            // 缺 rp 分兩種:時刻表對本跑段要求超過車種極速時,頁面依設計拒建曲線、消費端退等速
            // (實例:4041 於 08-19/20 改點加停冬山,蘇澳新→冬山 5.2km 只給 180 秒,需 150km/h);
            // 或 enrich 管線真的失效。用「跑段可行性」分辨:重解梯形建得出來=頁面本該有 rp=真失敗;
            // 建不出來=模型合法拒絕,取樣端比照網站消費端退線性,不擋 build。
            let k0 = stopIndex;
            while (k0 > 0 && stops[k0].stop === false) k0--;
            let k1 = stopIndex + 1;
            while (k1 < stops.length - 1 && stops[k1].stop === false) k1++;
            let runKm = 0;
            for (let i = k0; i < k1; i++) {
              runKm += stops[i].segLn ? schedSegmentKm(stops[i]) : haversineKm(stops[i], stops[i + 1]);
            }
            const runT = stops[k1].arrSec - stops[k0].depSec;
            const perf = resolvePerf(train) || {};
            if (buildProfile(runKm, runT, perf.a, perf.b, perf.v)) {
              throw new Error(
                `頁面未替 ${train.train} ${segment.name}→${next.name} 建立速度曲線`
                  + `(跑段 ${runKm.toFixed(1)}km/${runT}s 梯形可解,enrich 疑似失效)`
              );
            }
            linearLegs.push(`${train.train} ${segment.name}→${next.name}(${runKm.toFixed(1)}km/${runT}s)`);
          }

          const timeAt = segment.rp
            ? (lineProgress => {
              const segmentProgress = lineProgress * lineKm / totalKm;
              return segProgToTime(segment, segmentProgress);
            })
            : (lineProgress => {
              const segmentProgress = lineProgress * lineKm / totalKm;
              return segment.depSec + segmentProgress * (next.arrSec - segment.depSec);
            });
          const evaluateInterval = (left, right) => {
            let best = null;
            for (const local of [0.1, 0.25, 0.5, 0.75, 0.9]) {
              const x = left.x + (right.x - left.x) * local;
              const time = timeAt(x);
              const linear = left.time
                + (right.time - left.time)
                  * (x - left.x) / (right.x - left.x);
              const error = Math.abs(time - linear);
              if (!best || error > best.error) best = { x, time, error };
            }
            return { left, right, best };
          };

          // 固定 N 個區間，但不浪費切點在已接近直線的巡航段：每輪找目前線性
          // 內插誤差最大的區間細分。真值仍只呼叫頁面自己的 segProgToTime。
          const nodes = [
            { x: 0, time: timeAt(0) },
            { x: 1, time: timeAt(1) },
          ];
          let intervals = [evaluateInterval(nodes[0], nodes[1])];
          while (nodes.length < samples + 1) {
            intervals.sort((a, b) => b.best.error - a.best.error);
            const interval = intervals.shift();
            const node = {
              x: interval.best.x,
              time: interval.best.time,
            };
            nodes.push(node);
            intervals.push(
              evaluateInterval(interval.left, node),
              evaluateInterval(node, interval.right)
            );
          }
          nodes.sort((a, b) => a.x - b.x);
          segs.push([
            trainIndex,
            segment.segLn.id,
            Math.round(segment.dA * 1000),
            Math.round(segment.dB * 1000),
            nodes.map(node => Math.round(node.x * 1_000_000)),
            nodes.map(node => Math.round(node.time)),
          ]);
        }
      });
    }

    if (linearLegs.length) stats.linearLegs = linearLegs; // 退線性的腿全數列出,不做無聲上限
    return { v: 1, samples, lines, segs, trains, stats };
  }, { samples });

  if (pageErrors.length) {
    throw new Error(`頁面發生 ${pageErrors.length} 個未處理錯誤：${pageErrors.slice(0, 3).join(' | ')}`);
  }
  if (!output.segs.length || !output.trains.length) {
    throw new Error('頁面 runtime 沒有產出車次或區間');
  }

  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, JSON.stringify(output));
  await rename(temporaryPath, outputPath);
  console.log(
    `place_index v1 samples=${samples} trains=${output.trains.length} `
      + `segments=${output.segs.length} lines=${Object.keys(output.lines).length} `
      + `bytes=${(await stat(outputPath)).size} output=${outputPath}`
  );
  console.log(`[place_index] runtimeStats=${JSON.stringify(output.stats)}`);
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
