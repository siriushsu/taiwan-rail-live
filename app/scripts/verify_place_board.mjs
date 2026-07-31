import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
  mkdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const work = resolve(
  process.env.RAIL_PLACE_VERIFY_DIR
    || '/private/tmp/placeboard-verification'
);
const writerPath = join(
  repoRoot,
  'app/ios/App/App/RailBoardScheduleWriter.swift'
);
const harnessPath = join(here, 'place_board_harness.swift');
const generatorPath = join(here, 'build_place_index.mjs');
const indexHTMLPath = join(repoRoot, 'index.html');
const traTrackPath = join(repoRoot, 'data/tra.json');
const thsrTrackPath = join(repoRoot, 'data/thsr_track.json');
const md5 = async path => createHash('md5')
  .update(await readFile(path))
  .digest('hex');
const candidateSamples = [4, 8, 16];

await mkdir(work, { recursive: true });
console.log(`[G0] directory=${repoRoot}`);
for (const [name, path] of [
  ['index', indexHTMLPath],
  ['generator', generatorPath],
  ['writer', writerPath],
  ['harness', harnessPath],
]) {
  console.log(`[G0] ${name}.md5=${await md5(path)}`);
}
console.log('[G0] byteSource=current-worktree compiledSource=current-worktree');

const harnessBinary = join(work, 'place-board-harness');
await execFileAsync('xcrun', [
  'swiftc',
  writerPath,
  harnessPath,
  '-o',
  harnessBinary,
], { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 });

const variantPaths = {};
for (const samples of candidateSamples) {
  const path = join(work, `place_index_n${samples}.json`);
  const result = await execFileAsync(process.execPath, [
    generatorPath,
    `--samples=${samples}`,
    `--output=${path}`,
  ], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  variantPaths[samples] = path;
}

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
    const relativePath = decodeURIComponent(
      url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    );
    const filePath = resolve(repoRoot, relativePath);
    if (filePath !== repoRoot && !filePath.startsWith(rootPrefix)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    response.writeHead(200, {
      'Content-Type': mime.get(extname(filePath).toLowerCase())
        || 'application/octet-stream',
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
const pageURL = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true });

let fixture;
try {
  const page = await browser.newPage();
  await page.goto(pageURL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => state.ready
      && state.passObs
      && state.systems.some(
        system => system.id === 'tra_sched' && system._track
      )
      && state.systems.some(
        system => system.id === 'thsr_sched' && system._track
      ),
    null,
    { timeout: 120_000 }
  );

  fixture = await page.evaluate(async () => {
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
    const allTrains = [];
    const allLines = [];
    for (const spec of specs) {
      const system = state.systems.find(
        candidate => candidate.id === spec.runtimeID
      );
      const document = await fetch(
        spec.scheduleURL,
        { cache: 'no-store' }
      ).then(response => response.json());
      const trains = document.trains || [];
      trains.forEach(train => { train.sys = spec.runtimeID; });
      state._segStats = { onShape: 0, straight: 0, bridged: 0 };
      assignSchedShapePathsFor(trains, system._track.lines);
      allTrains.push(...trains);
      for (const line of system._track.lines) {
        line._verifySystem = spec.outputID;
        ensureCum(line);
        allLines.push(line);
      }
    }
    state.trains = allTrains;
    state.mode = 'sched';
    state.schedSystems = [];
    state.live = null;

    const usedLines = [...railSegLines()];
    const usedIDs = new Set(usedLines.map(line => line.id));
    const lineByID = new Map(usedLines.map(line => [line.id, line]));
    let seed = 0x5eed1234;
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const pick = array => array[Math.floor(random() * array.length)];
    const offsetAt = (line, d, kilometers) => {
      const point = posAlongShape(line, d);
      if (!kilometers) return point;
      const span = Math.min(0.08, line.cum[line.cum.length - 1] / 100);
      const first = posAlongShape(line, Math.max(0, d - span));
      const second = posAlongShape(
        line,
        Math.min(line.cum[line.cum.length - 1], d + span)
      );
      const kx = Math.cos(point.lat * Math.PI / 180) * 111.32;
      const dx = (second.lon - first.lon) * kx;
      const dy = (second.lat - first.lat) * 111.32;
      const length = Math.hypot(dx, dy) || 1;
      const sign = random() < 0.5 ? -1 : 1;
      const ox = -dy / length * kilometers * sign;
      const oy = dx / length * kilometers * sign;
      return {
        lat: point.lat + oy / 111.32,
        lon: point.lon + ox / kx,
      };
    };
    const near = (lat, lon) => usedLines
      .map(line => ({
        line,
        ...projectOntoShape(line, lat, lon),
      }))
      .filter(candidate => candidate.d != null)
      .sort((a, b) => a.perpKm - b.perpKm);

    const stationsByName = new Map();
    for (const line of usedLines) {
      for (const station of line.stations || []) {
        if (!stationsByName.has(station.name)) {
          stationsByName.set(station.name, []);
        }
        stationsByName.get(station.name).push({ line, station });
      }
    }
    const sharedStations = [...stationsByName.entries()]
      .map(([name, entries]) => ({
        name,
        entries: entries.filter(
          (entry, index) => entries.findIndex(
            other => other.line.id === entry.line.id
          ) === index
        ),
      }))
      .filter(item => item.entries.length >= 2);

    const connections = [];
    for (const train of allTrains) {
      const stops = train.stops || [];
      for (let index = 1; index < stops.length - 1; index++) {
        const incoming = stops[index - 1];
        const outgoing = stops[index];
        if (
          !incoming.segLn
          || !outgoing.segLn
          || incoming.segLn === outgoing.segLn
          || !usedIDs.has(incoming.segLn.id)
          || !usedIDs.has(outgoing.segLn.id)
        ) {
          continue;
        }
        connections.push({
          name: stops[index].name,
          lat: stops[index].lat,
          lon: stops[index].lon,
          lineIDs: [incoming.segLn.id, outgoing.segLn.id],
        });
      }
    }
    const uniqueConnections = connections.filter(
      (item, index) => connections.findIndex(
        other => other.name === item.name
          && other.lineIDs.join('|') === item.lineIDs.join('|')
      ) === index
    );

    const samples = [];
    const quotas = new Map([
      ['貼線', 100],
      ['1.5km邊界', 100],
      ['兩線之間', 100],
      ['跨線接續', 100],
    ]);
    const add = (category, lat, lon, targetID) => {
      const candidates = near(lat, lon);
      const target = candidates.find(candidate => candidate.line.id === targetID);
      const within = candidates
        .filter(candidate => candidate.perpKm <= 1.5)
        .slice(0, 3);
      if (
        !target
        || target.perpKm > 1.5
        || !within.some(candidate => candidate.line.id === targetID)
      ) {
        return false;
      }
      samples.push({
        id: samples.length,
        category,
        label: `${category}-${samples.length}`,
        lat,
        lon,
        line: targetID,
        jsD: target.d * 1_000,
        jsPerp: target.perpKm * 1_000,
        jsSelected: within.map(candidate => candidate.line.id),
      });
      return true;
    };

    for (const [category, quota] of quotas) {
      let attempts = 0;
      while (
        samples.filter(sample => sample.category === category).length < quota
        && attempts++ < 20_000
      ) {
        if (category === '貼線' || category === '1.5km邊界') {
          const line = pick(usedLines);
          const end = line.cum[line.cum.length - 1];
          const d = end * (0.03 + random() * 0.94);
          const offset = category === '貼線'
            ? random() * 0.03
            : 1.42 + random() * 0.07;
          const point = offsetAt(line, d, offset);
          add(category, point.lat, point.lon, line.id);
        } else if (category === '兩線之間') {
          const shared = pick(sharedStations);
          const first = shared.entries[0];
          const second = shared.entries[1];
          const lat = (
            first.station.lat + second.station.lat
          ) / 2 + (random() - 0.5) * 0.002;
          const lon = (
            first.station.lon + second.station.lon
          ) / 2 + (random() - 0.5) * 0.002;
          add(
            category,
            lat,
            lon,
            random() < 0.5 ? first.line.id : second.line.id
          );
        } else {
          const connection = pick(uniqueConnections);
          const targetID = pick(connection.lineIDs);
          add(
            category,
            connection.lat + (random() - 0.5) * 0.001,
            connection.lon + (random() - 0.5) * 0.001,
            targetID
          );
        }
      }
    }
    if (samples.length < 400) {
      throw new Error(`只產生 ${samples.length}/400 個驗收地點`);
    }

    const windows = [
      0,
      3 * 3600,
      6 * 3600,
      9 * 3600,
      12 * 3600,
      15 * 3600,
      18 * 3600,
      21 * 3600,
    ];
    for (const sample of samples) {
      const truth = new Map();
      for (const now of windows) {
        state.simSec = now;
        for (const pass of crossingPasses({
          lnId: sample.line,
          d: sample.jsD / 1_000,
        })) {
          const sys = pass.tr.sys === 'tra_sched' ? 'tra' : 'thsr';
          const key = `${sys}|${pass.tr.train}|${pass.pass.toFixed(6)}`;
          truth.set(key, {
            sys,
            no: String(pass.tr.train),
            at: pass.pass,
            to: pass.dir,
          });
        }
      }
      sample.truth = [...truth.values()];
    }

    const g5 = [];
    for (const connection of uniqueConnections) {
      const candidates = near(connection.lat, connection.lon);
      const jsSelected = candidates
        .filter(candidate => candidate.perpKm <= 1.5)
        .slice(0, 3)
        .map(candidate => candidate.line.id);
      if (
        connection.lineIDs.every(lineID => jsSelected.includes(lineID))
        && !g5.some(item => item.name === connection.name)
      ) {
        g5.push({
          name: connection.name,
          lat: connection.lat,
          lon: connection.lon,
          pair: connection.lineIDs,
          jsSelected,
        });
      }
      if (g5.length >= 8) break;
    }

    return {
      samples,
      g5,
      lineCount: usedLines.length,
      connectionCount: uniqueConnections.length,
    };
  });
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}

const placesPath = join(work, 'sample-places.json');
await writeFile(
  placesPath,
  JSON.stringify({
    v: 1,
    places: fixture.samples.map(sample => ({
      label: sample.label,
      lat: sample.lat,
      lon: sample.lon,
      manual: true,
    })),
  })
);
const queriesPath = join(work, 'projection-queries.json');
await writeFile(
  queriesPath,
  JSON.stringify(fixture.samples.map(sample => ({
    id: sample.id,
    line: sample.line,
    lat: sample.lat,
    lon: sample.lon,
  })))
);

const percentile = (values, fraction) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
};
const metrics = {};
const boardsBySamples = {};
for (const samples of candidateSamples) {
  const output = join(work, `swift-boards-n${samples}.json`);
  await execFileAsync(harnessBinary, [
    'build',
    placesPath,
    variantPaths[samples],
    traTrackPath,
    thsrTrackPath,
    output,
  ], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
  const boards = JSON.parse(await readFile(output, 'utf8'));
  boardsBySamples[samples] = boards;
  const errors = [];
  const errorRecords = [];
  let missing = 0;
  let truthCount = 0;
  for (const sample of fixture.samples) {
    const line = boards[sample.id]?.lines.find(
      candidate => candidate.id === sample.line
    );
    for (const truth of sample.truth) {
      truthCount++;
      const candidates = (line?.pass || []).filter(
        pass => pass.sys === truth.sys && pass.no === truth.no
      );
      if (!candidates.length) {
        missing++;
        continue;
      }
      const error = Math.min(...candidates.map(
        pass => Math.abs(pass.at - truth.at)
      ));
      errors.push(error);
      errorRecords.push({
        error,
        category: sample.category,
        line: sample.line,
        no: truth.no,
        expected: truth.at,
        actual: candidates
          .map(pass => pass.at)
          .sort((a, b) => Math.abs(a - truth.at) - Math.abs(b - truth.at))[0],
      });
    }
  }
  const byCategory = Object.fromEntries(
    [...new Set(fixture.samples.map(sample => sample.category))].map(
      category => {
        const values = errorRecords
          .filter(record => record.category === category)
          .map(record => record.error);
        return [
          category,
          {
            count: values.length,
            p99: percentile(values, 0.99),
            max: values.length ? Math.max(...values) : null,
          },
        ];
      }
    )
  );
  metrics[samples] = {
    combinations: fixture.samples.length,
    truthCount,
    compared: errors.length,
    missing,
    p99: percentile(errors, 0.99),
    max: errors.length ? Math.max(...errors) : null,
    byCategory,
    largest: errorRecords
      .sort((a, b) => b.error - a.error)
      .slice(0, 10),
  };
}

const productionProjectionPath = join(work, 'projection-production.json');
const mutantProjectionPath = join(work, 'projection-mutant.json');
await execFileAsync(harnessBinary, [
  'project',
  queriesPath,
  traTrackPath,
  thsrTrackPath,
  productionProjectionPath,
  'production',
]);
await execFileAsync(harnessBinary, [
  'project',
  queriesPath,
  traTrackPath,
  thsrTrackPath,
  mutantProjectionPath,
  'mutant',
]);
const productionProjection = JSON.parse(
  await readFile(productionProjectionPath, 'utf8')
);
const mutantProjection = JSON.parse(
  await readFile(mutantProjectionPath, 'utf8')
);
const projectionMetrics = (values) => {
  const dErrors = [];
  const perpErrors = [];
  let failures = 0;
  for (const sample of fixture.samples) {
    const value = values[sample.id];
    if (value?.d == null || value?.perp == null) {
      failures++;
      continue;
    }
    const d = Math.abs(value.d - sample.jsD);
    const perp = Math.abs(value.perp - sample.jsPerp);
    dErrors.push(d);
    perpErrors.push(perp);
    if (d > 1 || perp > 1) failures++;
  }
  return {
    count: fixture.samples.length,
    maxD: Math.max(...dErrors),
    maxPerp: Math.max(...perpErrors),
    p99D: percentile(dErrors, 0.99),
    p99Perp: percentile(perpErrors, 0.99),
    failures,
  };
};
const g4 = {
  production: projectionMetrics(productionProjection),
  mutant: projectionMetrics(mutantProjection),
};

const chosenSamples = candidateSamples.find(
  samples => metrics[samples].missing === 0
    && metrics[samples].p99 <= 2
    && metrics[samples].max <= 5
) ?? null;
const chosenBoards = boardsBySamples[chosenSamples || 16];
const g5 = fixture.g5.map(item => {
  const sampleIndex = fixture.samples.findIndex(
    sample => Math.abs(sample.lat - item.lat) < 0.000_000_1
      && Math.abs(sample.lon - item.lon) < 0.000_000_1
  );
  let swiftSelected = [];
  if (sampleIndex >= 0) {
    swiftSelected = chosenBoards[sampleIndex].lines.map(line => line.id);
  }
  return { ...item, sampleIndex, swiftSelected };
});

// G5 的精確站點不一定剛好是 G3 隨機樣本；另建一小批，仍走同一個 production builder。
const g5PlacesPath = join(work, 'g5-places.json');
await writeFile(
  g5PlacesPath,
  JSON.stringify({
    v: 1,
    places: fixture.g5.map((item, index) => ({
      label: `G5-${index}-${item.name}`,
      lat: item.lat,
      lon: item.lon,
      manual: true,
    })),
  })
);
const g5BoardsPath = join(work, 'g5-swift-boards.json');
await execFileAsync(harnessBinary, [
  'build',
  g5PlacesPath,
  variantPaths[chosenSamples || 16],
  traTrackPath,
  thsrTrackPath,
  g5BoardsPath,
]);
const g5Boards = JSON.parse(await readFile(g5BoardsPath, 'utf8'));
for (let index = 0; index < g5.length; index++) {
  g5[index].swiftSelected = g5Boards[index].lines.map(line => line.id);
  g5[index].match = JSON.stringify(g5[index].jsSelected)
    === JSON.stringify(g5[index].swiftSelected);
}

const report = {
  g0: {
    directory: repoRoot,
    indexMD5: await md5(indexHTMLPath),
    generatorMD5: await md5(generatorPath),
    writerMD5: await md5(writerPath),
    harnessMD5: await md5(harnessPath),
    byteSource: 'current-worktree',
  },
  sampleCategories: Object.fromEntries(
    [...new Set(fixture.samples.map(sample => sample.category))].map(
      category => [
        category,
        fixture.samples.filter(sample => sample.category === category).length,
      ]
    )
  ),
  lineCount: fixture.lineCount,
  connectionCount: fixture.connectionCount,
  g3: {
    metrics,
    chosenSamples,
  },
  g4,
  g5,
};
const reportPath = join(work, 'report.json');
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(`[G3] categories=${JSON.stringify(report.sampleCategories)}`);
for (const samples of candidateSamples) {
  console.log(`[G3] N=${samples} ${JSON.stringify(metrics[samples])}`);
}
console.log(`[G3] chosenN=${chosenSamples}`);
console.log(`[G4] production=${JSON.stringify(g4.production)}`);
console.log(`[G4] mutant=${JSON.stringify(g4.mutant)}`);
console.log(
  `[G5] cases=${g5.length} matches=${g5.filter(item => item.match).length}`
);
console.log(`[report] ${reportPath}`);

const g3Pass = chosenSamples != null;
const g4Pass = g4.production.failures === 0 && g4.mutant.failures > 0;
const g5Pass = g5.length >= 3 && g5.slice(0, 3).every(item => item.match);
if (!g3Pass || !g4Pass || !g5Pass) {
  process.exitCode = 1;
}
