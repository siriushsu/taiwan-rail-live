// 公車轉乘 UI 的本機瀏覽器驗收伺服器：其餘檔案照靜態網站提供，只有兩支公車 API 用固定 fixture。
// 不供正式站使用；讓觸控／版面驗收可以證明「開站不查、按鈕才查、點路線才查車況」。
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 8793);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
const calls = { station: 0, leg: 0, lastStation: null };

const arrival = (key, routeName, state, etaSec, occupancy = 'not_provided') => ({
  key, scope: 'City/Tainan', routeUid: `TNN-${routeName}`, routeName, subRouteUid: '', subRouteName: '',
  direction: 0, headsign: routeName === '3' ? '安平／億載金城' : '南紡購物中心',
  stopUid: 'TNN33884', stopName: '臺南火車站（北站）', stopSequence: 12,
  stopPosition: { lat: 22.99794, lon: 120.21315 },
  access: { estimatedWalkMin: 3, estimatedWalkM: 210 },
  live: { state, sourceState: state, etaSec, ageSec: 12, staleAfterSec: 180 },
  routeMatch: 'exact', occupancy: { state: occupancy, level: null },
  vehicleBinding: { state: 'not_loaded', plate: null },
});

const stationBody = {
  schemaVersion: 1,
  station: { id: 'TRA:4220', name: '臺南', position: { lat: 22.9971, lon: 120.2127 } },
  generatedAt: new Date().toISOString(), trigger: 'user_open_only', polling: false, pilotOnly: false, coverage: 'all_active_tra_stations',
  live: { state: 'live', cache: 'miss', scheduleFallback: 'not_implemented' },
  arrivals: [
    arrival('fixture-3', '3', 'countdown', 248, 'not_loaded'),
    arrival('fixture-5', '5', 'arriving', 25),
    arrival('fixture-18', '18', 'not_departed', null),
    arrival('fixture-blue', '藍幹線', 'last_bus_passed', null),
  ],
  totals: { accepted: 4, returned: 4, rejected: 1 },
  rejected: [{ reason: 'route_not_in_current_static_index' }],
  caveats: { outdoorWalkOnly: true, indoorWalkIncluded: false, occupancyCoverage: 'taipei_only_when_bus_leg_is_opened', vehiclePosition: 'load_on_bus_leg_open' },
};

const noNearbyBody = {
  schemaVersion: 1,
  station: { id: 'TRA:1150', name: '北湖', position: { lat: 24.92218, lon: 121.05575 } },
  generatedAt: new Date().toISOString(), trigger: 'user_open_only', polling: false, pilotOnly: false,
  coverage: 'all_active_tra_stations', nearbyStopCount: 0,
  live: { state: 'no_nearby_stops', cache: 'not_applicable', scopes: [], scheduleFallback: 'not_implemented' },
  arrivals: [], totals: { accepted: 0, returned: 0, rejected: 0 }, rejected: [],
  caveats: { outdoorWalkOnly: true, indoorWalkIncluded: false, occupancyCoverage: 'taipei_only_when_bus_leg_is_opened', vehiclePosition: 'load_on_bus_leg_open' },
};

const legBody = key => ({
  generatedAt: new Date().toISOString(), trigger: 'user_route_open_only', polling: false, arrivalKey: key,
  binding: { state: 'exact_n1_plate', plate: 'TNN-001' },
  vehicles: [{
    plate: 'TNN-001', position: { lat: 22.99, lon: 120.21 }, ageSec: 14, fresh: true, inService: true,
    binding: 'n1_plate_verified',
    progress: { currentStopName: '小西門', currentStopSequence: 10, targetStopSequence: 12, stopsBefore: 2, state: 'approaching' },
    occupancy: { state: 'available', level: 'normal', ageSec: 30 },
  }],
  // 刻意用 Worker 真契約的 live，守住「正常來源不誤標降級」。
  live: { state: 'live', cache: 'miss', sources: [{ kind: 'A1', state: 'live' }, { kind: 'A2', state: 'live' }, { kind: 'occupancy', state: 'live' }] },
  totals: { candidates: 1, freshInService: 1, stale: 0 },
});

function sendJson(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__bus-test-stats') return sendJson(res, calls);
  if (url.pathname === '/api/bus-transfer') {
    calls.station += 1;
    calls.lastStation = url.searchParams.get('station');
    console.log(`BUS_TRANSFER station=${calls.station} leg=${calls.leg} id=${calls.lastStation}`);
    if (calls.lastStation === 'TRA:1150') return sendJson(res, noNearbyBody);
    return sendJson(res, { ...stationBody, station: { ...stationBody.station, id: calls.lastStation || stationBody.station.id } });
  }
  if (url.pathname === '/api/bus-leg-live') {
    calls.leg += 1;
    console.log(`BUS_LEG station=${calls.station} leg=${calls.leg}`);
    return sendJson(res, legBody(url.searchParams.get('arrival') || 'fixture-3'));
  }
  if (url.pathname.startsWith('/api/')) return sendJson(res, { error: 'fixture endpoint not implemented' }, 503);

  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.statusCode = 404; return res.end('not found'); }
  const segments = pathname.split('/').filter(Boolean);
  if (segments.some(segment => segment.startsWith('.'))) { res.statusCode = 404; return res.end('not found'); }
  let file = path.resolve(path.join(ROOT, pathname));
  let relative = path.relative(ROOT, file);
  const outside = () => relative.startsWith('..') || path.isAbsolute(relative);
  if (outside() || ['app', 'node_modules'].includes(relative.split(path.sep)[0])) { res.statusCode = 404; return res.end('not found'); }
  if (existsSync(file) && statSync(file).isDirectory()) { file = path.join(file, 'index.html'); relative = path.relative(ROOT, file); }
  const type = MIME[path.extname(file)];
  if (outside() || !type || !existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', type);
  res.end(readFileSync(file));
});
server.listen(PORT, '127.0.0.1', () => {
  const address = server.address();
  const actualPort = address && typeof address === 'object' ? address.port : PORT;
  console.log(`bus transfer UI fixture server http://127.0.0.1:${actualPort}`);
});
