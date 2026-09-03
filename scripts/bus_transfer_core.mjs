// 公車轉乘垂直切片的純函式核心。
//
// 這個模組刻意不碰 DOM、timer、fetch 或 Cloudflare binding：
// - 離線建置用它把 StopOfRoute 收斂成各台鐵營運站的分站靜態索引。
// - Worker 用它把使用者點開當下取得的 N1 正規化成穩定資料契約。
// - 測試可用固定 fixture 驗「退役路線不得混入」「N1 空值不得都說成沒車」等語意。

export const BUS_TRANSFER_SCHEMA = 1;
export const N1_STALE_AFTER_SEC = 180;
export const WALK_DETOUR_FACTOR = 1.25;
export const WALK_METERS_PER_MINUTE = 75;

const TO_RAD = Math.PI / 180;
const EARTH_M = 6371000;

const valueOf = (obj, ...keys) => {
  for (const key of keys) if (obj && obj[key] != null && obj[key] !== '') return obj[key];
  return null;
};

const finiteNumber = value => {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const zhName = value => value && (value.Zh_tw || value.ZhTw || value.zh_tw || value.En) || '';

export function haversineMeters(a, b) {
  const lat1 = finiteNumber(a && (a.lat ?? a.PositionLat));
  const lon1 = finiteNumber(a && (a.lon ?? a.PositionLon));
  const lat2 = finiteNumber(b && (b.lat ?? b.PositionLat));
  const lon2 = finiteNumber(b && (b.lon ?? b.PositionLon));
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;
  const dLat = (lat2 - lat1) * TO_RAD;
  const dLon = (lon2 - lon1) * TO_RAD;
  const la1 = lat1 * TO_RAD;
  const la2 = lat2 * TO_RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}

// 只估「車站座標到路邊站牌」的戶外步行；不含月台、閘門、地下街或站內轉乘時間。
// 沒有步行路網時，用直線距離乘 1.25 作保守估算，契約保留 method／includesIndoor，
// UI 不得把它改寫成精確導航時間。
export function outdoorWalkEstimate(stationPosition, stopPosition) {
  const straightLineM = haversineMeters(stationPosition, stopPosition);
  if (!Number.isFinite(straightLineM)) return null;
  const estimatedM = straightLineM * WALK_DETOUR_FACTOR;
  return {
    kind: 'estimated_outdoor',
    straightLineM: Math.round(straightLineM),
    estimatedWalkM: Math.round(estimatedM / 10) * 10,
    estimatedWalkMin: Math.max(1, Math.ceil(estimatedM / WALK_METERS_PER_MINUTE)),
    includesIndoor: false,
    method: 'great_circle_x1.25_at_75m_per_min',
  };
}

export function routeKeyOf(row, scope = '') {
  const routeUid = String(valueOf(row, 'RouteUID', 'RouteID') || '');
  const subRouteUid = String(valueOf(row, 'SubRouteUID', 'SubRouteID') || '');
  const directionRaw = valueOf(row, 'Direction');
  const direction = directionRaw == null ? '' : String(directionRaw);
  return [scope, routeUid, subRouteUid, direction].join('|');
}

export function stopPositionOf(stop) {
  const p = valueOf(stop, 'StopPosition', 'StationPosition', 'Position');
  const lat = finiteNumber(p && valueOf(p, 'PositionLat', 'Lat', 'Latitude'));
  const lon = finiteNumber(p && valueOf(p, 'PositionLon', 'Lon', 'Longitude'));
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function routeRefOf(row, scope) {
  const stops = Array.isArray(row && row.Stops) ? row.Stops : [];
  const lastStop = stops.at(-1);
  return {
    key: routeKeyOf(row, scope),
    scope,
    routeUid: String(valueOf(row, 'RouteUID', 'RouteID') || ''),
    routeName: zhName(valueOf(row, 'RouteName')),
    subRouteUid: String(valueOf(row, 'SubRouteUID', 'SubRouteID') || ''),
    subRouteName: zhName(valueOf(row, 'SubRouteName')),
    direction: finiteNumber(valueOf(row, 'Direction')),
    headsign: zhName(lastStop && lastStop.StopName),
  };
}

// 把一個 scope 的 StopOfRoute 全表縮成「本站附近的實體站牌＋經過路線」。
// maxStopUids 是 live query 的 URL／用量上界，不是 UI 顯示上限；依距離選最近的實體 StopUID。
export function buildNearbyScope({ station, scope, stopOfRouteRows, radiusM = 600, maxStopUids = 24 }) {
  if (!station || !station.position || !scope) throw new Error('buildNearbyScope 缺 station.position／scope');
  const candidates = new Map();
  for (const row of stopOfRouteRows || []) {
    const ref = routeRefOf(row, scope);
    if (!ref.routeUid || !ref.routeName) continue;
    for (const stop of row.Stops || []) {
      const stopUid = String(valueOf(stop, 'StopUID', 'StopID') || '');
      const position = stopPositionOf(stop);
      if (!stopUid || !position) continue;
      const access = outdoorWalkEstimate(station.position, position);
      if (!access || access.straightLineM > radiusM) continue;
      if (!candidates.has(stopUid)) candidates.set(stopUid, {
        stopUid,
        stopName: zhName(valueOf(stop, 'StopName')),
        position,
        stationUid: String(valueOf(stop, 'StationUID', 'StationID') || ''),
        access,
        routeRefs: new Map(),
      });
      const stopSequenceRaw = valueOf(stop, 'StopSequence');
      const stopSequence = finiteNumber(stopSequenceRaw);
      candidates.get(stopUid).routeRefs.set(ref.key, { ref, stopSequence });
    }
  }

  const selected = [...candidates.values()]
    .sort((a, b) => a.access.straightLineM - b.access.straightLineM || a.stopUid.localeCompare(b.stopUid))
    .slice(0, maxStopUids);
  const routeRefs = [...new Map(selected.flatMap(stop => [...stop.routeRefs.values()].map(item => item.ref)).map(ref => [ref.key, ref])).values()]
    .sort((a, b) => a.key.localeCompare(b.key));
  const stops = selected.map(stop => ({
    stopUid: stop.stopUid,
    stopName: stop.stopName,
    position: stop.position,
    stationUid: stop.stationUid,
    access: stop.access,
    routeStops: [...stop.routeRefs.values()].map(item => ({ routeKey: item.ref.key, stopSequence: item.stopSequence })).sort((a, b) => a.routeKey.localeCompare(b.routeKey)),
  }));
  return { scope, radiusM, maxStopUids, stops, routeRefs };
}

export function parseTimeMs(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

// TDX StopStatus：0 正常、1 尚未發車、2 交管不停靠、3 末班車已過、4 今日未營運。
// EstimateTime 與 NextBusTime 都空時，必須保留這五種語意，不能收斂成同一個「無資料」。
export function normalizeN1State(row, nowMs = Date.now(), staleAfterSec = N1_STALE_AFTER_SEC) {
  const sourceUpdatedAt = String(valueOf(row, 'SrcUpdateTime', 'UpdateTime') || '') || null;
  const sourceMs = parseTimeMs(sourceUpdatedAt);
  const ageSec = sourceMs == null ? null : Math.max(0, Math.floor((nowMs - sourceMs) / 1000));
  const estimateRaw = valueOf(row, 'EstimateTime');
  const estimateSecAtSource = estimateRaw == null ? null : Number(estimateRaw);
  const nextBusTime = String(valueOf(row, 'NextBusTime') || '') || null;
  const nextBusMs = parseTimeMs(nextBusTime);
  const stopStatus = finiteNumber(valueOf(row, 'StopStatus'));

  let sourceState;
  let etaSec = null;
  if (Number.isFinite(estimateSecAtSource) && estimateSecAtSource >= 0) {
    etaSec = Math.max(0, Math.round(estimateSecAtSource - (ageSec || 0)));
    sourceState = etaSec <= 60 ? 'arriving' : 'countdown';
  } else if (nextBusMs != null && nextBusMs >= nowMs) {
    etaSec = Math.max(0, Math.round((nextBusMs - nowMs) / 1000));
    sourceState = 'scheduled';
  } else {
    sourceState = ({ 0: 'no_estimate', 1: 'not_departed', 2: 'skipped', 3: 'last_bus_passed', 4: 'not_operating' })[stopStatus] || 'unknown';
  }
  const stale = ageSec == null || ageSec > staleAfterSec;
  return {
    state: stale ? 'stale' : sourceState,
    sourceState,
    etaSec,
    estimateSecAtSource: Number.isFinite(estimateSecAtSource) ? estimateSecAtSource : null,
    nextBusTime,
    stopStatus: Number.isFinite(stopStatus) ? stopStatus : null,
    sourceUpdatedAt,
    ageSec,
    staleAfterSec,
  };
}

const stateRank = state => ({ arriving: 0, countdown: 1, scheduled: 2, not_departed: 3, no_estimate: 4, unknown: 5, skipped: 6, last_bus_passed: 7, not_operating: 8, stale: 9 })[state] ?? 10;

export function resolveStationN1({ pilotStation, rowsByScope, nowMs = Date.now(), staleAfterSec = N1_STALE_AFTER_SEC, limit = 40 }) {
  if (!pilotStation || !Array.isArray(pilotStation.scopes)) throw new Error('resolveStationN1 缺 pilotStation.scopes');
  const acceptedByKey = new Map();
  const rejected = [];
  for (const scopeData of pilotStation.scopes) {
    const scope = scopeData.scope;
    const stops = new Map((scopeData.stops || []).map(stop => [stop.stopUid, stop]));
    const refs = new Map((scopeData.routeRefs || []).map(ref => [ref.key, ref]));
    const refsAtStop = new Map((scopeData.stops || []).map(stop => [stop.stopUid, (stop.routeStops || []).map(item => refs.get(item.routeKey)).filter(Boolean)]));
    for (const row of rowsByScope[scope] || []) {
      const stopUid = String(valueOf(row, 'StopUID', 'StopID') || '');
      const key = routeKeyOf(row, scope);
      const stop = stops.get(stopUid);
      const liveRouteUid = String(valueOf(row, 'RouteUID', 'RouteID') || '');
      const liveSubRouteUid = String(valueOf(row, 'SubRouteUID', 'SubRouteID') || '');
      const liveDirectionRaw = finiteNumber(valueOf(row, 'Direction'));
      const liveDirection = liveDirectionRaw === 0 || liveDirectionRaw === 1 ? liveDirectionRaw : null;
      const stopRefs = refsAtStop.get(stopUid) || [];
      let routeMatch = 'exact';
      let candidates = [];
      let ref = refs.get(key);
      if (!ref && liveSubRouteUid) {
        candidates = stopRefs.filter(candidate => candidate.subRouteUid === liveSubRouteUid);
        if (candidates.length === 1) { ref = candidates[0]; routeMatch = 'subroute_uid'; }
      }
      if (!ref) {
        candidates = stopRefs.filter(candidate => candidate.routeUid === liveRouteUid && (liveDirection == null || candidate.direction === liveDirection));
        if (candidates.length === 1) { ref = candidates[0]; routeMatch = liveDirection == null ? 'route_uid' : 'route_direction'; }
        else if (candidates.length > 1) {
          const unique = values => [...new Set(values.filter(Boolean))];
          const headsigns = unique(candidates.map(candidate => candidate.headsign));
          const routeNames = unique(candidates.map(candidate => candidate.routeName));
          const directions = unique(candidates.map(candidate => candidate.direction));
          ref = {
            key: `${scope}|${liveRouteUid}||${liveDirection ?? ''}`,
            scope,
            routeUid: liveRouteUid,
            routeName: zhName(valueOf(row, 'RouteName')) || routeNames[0] || '',
            subRouteUid: '',
            subRouteName: '',
            direction: liveDirection ?? (directions.length === 1 ? directions[0] : null),
            headsign: headsigns.length === 1 ? headsigns[0] : '',
          };
          routeMatch = liveDirection == null ? 'route_uid_ambiguous_subroute' : 'route_direction_ambiguous_subroute';
        }
      }
      if (!stop || !ref) {
        rejected.push({ scope, stopUid, routeUid: liveRouteUid, routeName: zhName(valueOf(row, 'RouteName')), reason: !stop ? 'stop_not_in_static_index' : 'route_not_in_current_static_index' });
        continue;
      }
      const live = normalizeN1State(row, nowMs, staleAfterSec);
      const plateHint = String(valueOf(row, 'PlateNumb', 'PlateNumber') || '') || null;
      const resolvedKey = `${ref.key}|${stopUid}`;
      const sequenceCandidates = (stop.routeStops || [])
        .filter(item => item.routeKey === ref.key || candidates.some(candidate => candidate.key === item.routeKey))
        .map(item => item.stopSequence).filter(Number.isFinite);
      const uniqueSequences = [...new Set(sequenceCandidates)];
      const arrival = {
        key: resolvedKey,
        scope,
        routeUid: ref.routeUid,
        routeName: ref.routeName,
        subRouteUid: ref.subRouteUid,
        subRouteName: ref.subRouteName,
        direction: ref.direction,
        headsign: ref.headsign,
        stopUid,
        stopName: stop.stopName,
        stopSequence: uniqueSequences.length === 1 ? uniqueSequences[0] : null,
        stopPosition: stop.position,
        access: stop.access,
        live,
        routeMatch,
        occupancy: { state: scope === 'City/Taipei' ? 'not_loaded' : 'not_provided', level: null },
        vehicleBinding: { state: 'not_loaded', plate: null, plateHint },
      };
      const previous = acceptedByKey.get(resolvedKey);
      if (!previous || (arrival.live.ageSec ?? Infinity) < (previous.live.ageSec ?? Infinity) ||
        ((arrival.live.ageSec ?? Infinity) === (previous.live.ageSec ?? Infinity) && (arrival.live.etaSec ?? Infinity) < (previous.live.etaSec ?? Infinity))) {
        acceptedByKey.set(resolvedKey, arrival);
      }
    }
  }
  const accepted = [...acceptedByKey.values()];
  accepted.sort((a, b) => {
    const rank = stateRank(a.live.state) - stateRank(b.live.state);
    if (rank) return rank;
    const eta = (a.live.etaSec ?? Infinity) - (b.live.etaSec ?? Infinity);
    return eta || a.routeName.localeCompare(b.routeName) || a.stopName.localeCompare(b.stopName);
  });
  return {
    schemaVersion: BUS_TRANSFER_SCHEMA,
    station: {
      id: pilotStation.id,
      name: pilotStation.name,
      position: pilotStation.position,
    },
    generatedAt: new Date(nowMs).toISOString(),
    trigger: 'user_open_only',
    polling: false,
    arrivals: accepted.slice(0, limit),
    totals: { accepted: accepted.length, returned: Math.min(accepted.length, limit), rejected: rejected.length },
    rejected,
    caveats: {
      outdoorWalkOnly: true,
      indoorWalkIncluded: false,
      occupancyCoverage: 'taipei_only_when_bus_leg_is_opened',
      vehiclePosition: 'load_on_bus_leg_open',
    },
  };
}

export function normalizedPlate(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function busPositionOf(row) {
  const p = valueOf(row, 'BusPosition', 'VehiclePosition', 'Position');
  const lat = finiteNumber(p && valueOf(p, 'PositionLat', 'Lat', 'Latitude'));
  const lon = finiteNumber(p && valueOf(p, 'PositionLon', 'Lon', 'Longitude'));
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function busRowMatchesArrival(row, arrival) {
  const routeUid = String(valueOf(row, 'RouteUID', 'RouteID') || '');
  if (!routeUid || routeUid !== arrival.routeUid) return false;
  const subRouteUid = String(valueOf(row, 'SubRouteUID', 'SubRouteID') || '');
  if (arrival.subRouteUid && subRouteUid && subRouteUid !== arrival.subRouteUid) return false;
  const direction = finiteNumber(valueOf(row, 'Direction'));
  if ((arrival.direction === 0 || arrival.direction === 1) && (direction === 0 || direction === 1) && direction !== arrival.direction) return false;
  return true;
}

function officialOccupancy(scope, plate, occupancyByPlate, occupancyUpdatedAt, nowMs, staleAfterSec) {
  if (scope !== 'City/Taipei') return { state: 'not_provided', level: null, updatedAt: null, ageSec: null };
  const row = occupancyByPlate.get(normalizedPlate(plate));
  const level = Number(row && row.Level);
  const updatedMs = parseTimeMs(occupancyUpdatedAt);
  const ageSec = updatedMs == null ? null : Math.max(0, Math.floor((nowMs - updatedMs) / 1000));
  if (!row || ![0, 1, 2].includes(level)) return { state: 'unavailable', level: null, updatedAt: occupancyUpdatedAt || null, ageSec };
  if (ageSec == null || ageSec > staleAfterSec) return { state: 'stale', level: null, sourceLevel: level, updatedAt: occupancyUpdatedAt || null, ageSec };
  return { state: 'available', level: ['comfortable', 'normal', 'crowded'][level], sourceLevel: level, updatedAt: occupancyUpdatedAt || null, ageSec };
}

// A1/A2 只在使用者展開某一路公車時載入。沒有 N1 車牌時，回傳的是同路線方向的候選集合，
// 不硬把某一台車宣稱成倒數那班；有 plateHint 時也要能在 A1/A2 重新驗到才算 exact。
export function resolveBusLegVehicles({ arrival, a1Rows, a2Rows, occupancyRows = [], occupancyUpdatedAt = null, nowMs = Date.now(), staleAfterSec = 180 }) {
  if (!arrival || !arrival.scope || !arrival.routeUid) throw new Error('resolveBusLegVehicles 缺 arrival scope／routeUid');
  const occupancyByPlate = new Map((occupancyRows || []).map(row => [normalizedPlate(valueOf(row, 'BusID', 'PlateNumb')), row]).filter(([plate]) => plate));
  const a2ByPlate = new Map();
  for (const row of a2Rows || []) {
    if (!busRowMatchesArrival(row, arrival)) continue;
    const plate = String(valueOf(row, 'PlateNumb', 'PlateNumber') || '');
    if (!plate) continue;
    const at = parseTimeMs(valueOf(row, 'GPSTime', 'SrcUpdateTime', 'UpdateTime')) || -Infinity;
    const previous = a2ByPlate.get(normalizedPlate(plate));
    if (!previous || at > previous.at) a2ByPlate.set(normalizedPlate(plate), { row, at });
  }

  const vehiclesByPlate = new Map();
  for (const [rowIndex, row] of (a1Rows || []).entries()) {
    if (!busRowMatchesArrival(row, arrival)) continue;
    const plate = String(valueOf(row, 'PlateNumb', 'PlateNumber') || '') || null;
    const plateKey = normalizedPlate(plate);
    const position = busPositionOf(row);
    // 部分縣市（實測包含花蓮）會給 A1 定位但不給車牌。仍保留路線候選位置，
    // 但不與 A2 或 N1 強行綁定，避免把「有車無車牌」誤顯示成無車。
    if (!position) continue;
    const vehicleKey = plateKey || `unidentified:${rowIndex}`;
    const gpsAt = String(valueOf(row, 'GPSTime', 'SrcUpdateTime', 'UpdateTime') || '') || null;
    const gpsMs = parseTimeMs(gpsAt);
    const ageSec = gpsMs == null ? null : Math.max(0, Math.floor((nowMs - gpsMs) / 1000));
    const dutyStatus = finiteNumber(valueOf(row, 'DutyStatus'));
    const busStatus = finiteNumber(valueOf(row, 'BusStatus'));
    const inService = dutyStatus === 1 && busStatus !== 99;
    const a2 = plateKey ? a2ByPlate.get(plateKey)?.row || null : null;
    const currentSequenceRaw = valueOf(a2, 'StopSequence');
    const currentSequence = finiteNumber(currentSequenceRaw);
    const stopsBefore = Number.isFinite(arrival.stopSequence) && Number.isFinite(currentSequence) ? arrival.stopSequence - currentSequence : null;
    const tripStartTime = String(valueOf(a2, 'TripStartTime') || '') || null;
    const tripStartTimeTypeRaw = valueOf(a2, 'TripStartTimeType');
    const tripStartTimeType = finiteNumber(tripStartTimeTypeRaw);
    const plateHint = normalizedPlate(arrival.vehicleBinding && arrival.vehicleBinding.plateHint);
    const vehicle = {
      plate,
      position,
      gpsAt,
      ageSec,
      fresh: ageSec != null && ageSec <= staleAfterSec,
      inService,
      dutyStatus: Number.isFinite(dutyStatus) ? dutyStatus : null,
      busStatus: Number.isFinite(busStatus) ? busStatus : null,
      routeUid: String(valueOf(row, 'RouteUID', 'RouteID') || ''),
      subRouteUid: String(valueOf(row, 'SubRouteUID', 'SubRouteID') || ''),
      direction: finiteNumber(valueOf(row, 'Direction')),
      binding: plateKey && plateHint && plateHint === plateKey
        ? 'n1_plate_verified'
        : (plateKey ? 'route_candidate' : 'route_candidate_unidentified'),
      progress: {
        currentStopUid: String(valueOf(a2, 'StopUID', 'StopID') || '') || null,
        currentStopName: zhName(valueOf(a2, 'StopName')) || null,
        currentStopSequence: currentSequence,
        targetStopSequence: Number.isFinite(arrival.stopSequence) ? arrival.stopSequence : null,
        stopsBefore,
        state: stopsBefore == null ? 'unknown' : (stopsBefore >= 0 ? 'approaching' : 'passed'),
        tripStartTime,
        tripStartTimeType,
      },
      occupancy: officialOccupancy(arrival.scope, plate, occupancyByPlate, occupancyUpdatedAt, nowMs, staleAfterSec),
    };
    const previous = vehiclesByPlate.get(vehicleKey);
    if (!previous || (vehicle.ageSec ?? Infinity) < (previous.ageSec ?? Infinity)) vehiclesByPlate.set(vehicleKey, vehicle);
  }

  const vehicles = [...vehiclesByPlate.values()].sort((a, b) => {
    if (a.binding !== b.binding) return a.binding === 'n1_plate_verified' ? -1 : 1;
    if (a.inService !== b.inService) return a.inService ? -1 : 1;
    if (a.fresh !== b.fresh) return a.fresh ? -1 : 1;
    const aStops = a.progress.stopsBefore != null && a.progress.stopsBefore >= 0 ? a.progress.stopsBefore : Infinity;
    const bStops = b.progress.stopsBefore != null && b.progress.stopsBefore >= 0 ? b.progress.stopsBefore : Infinity;
    return aStops - bStops || (a.ageSec ?? Infinity) - (b.ageSec ?? Infinity) || String(a.plate || '').localeCompare(String(b.plate || ''));
  });
  const verified = vehicles.filter(vehicle => vehicle.binding === 'n1_plate_verified');
  return {
    generatedAt: new Date(nowMs).toISOString(),
    trigger: 'user_route_open_only',
    polling: false,
    arrivalKey: arrival.key,
    binding: verified.length === 1 ? { state: 'exact_n1_plate', plate: verified[0].plate } : { state: 'candidate_set', plate: null },
    vehicles,
    totals: {
      candidates: vehicles.length,
      freshInService: vehicles.filter(vehicle => vehicle.fresh && vehicle.inService).length,
      stale: vehicles.filter(vehicle => !vehicle.fresh).length,
    },
  };
}

// 使用者明確選定一路公車後才載入 StopOfRoute，供接續旅程選擇下車站。
// 這裡不把同 RouteUID 的多個支線揉成一條：SubRouteUID／Direction 對不上時寧可回 ambiguous，
// 否則畫面會讓人選到實際那班車不會經過的下車站。
export function resolveBusRouteStops({ arrival, stopOfRouteRows }) {
  if (!arrival || !arrival.routeUid || !arrival.stopUid) throw new Error('resolveBusRouteStops 缺 routeUid／stopUid');
  const rows = (stopOfRouteRows || []).filter(row => {
    const routeUid = String(valueOf(row, 'RouteUID', 'RouteID') || '');
    if (routeUid !== String(arrival.routeUid)) return false;
    const subRouteUid = String(valueOf(row, 'SubRouteUID', 'SubRouteID') || '');
    if (arrival.subRouteUid && subRouteUid && subRouteUid !== String(arrival.subRouteUid)) return false;
    const direction = finiteNumber(valueOf(row, 'Direction'));
    if ((arrival.direction === 0 || arrival.direction === 1) &&
        (direction === 0 || direction === 1) && direction !== arrival.direction) return false;
    return true;
  }).map(row => {
    const stops = Array.isArray(valueOf(row, 'Stops')) ? valueOf(row, 'Stops') : [];
    const normalized = stops.map((stop, index) => {
      const sequence = finiteNumber(valueOf(stop, 'StopSequence'));
      const p = valueOf(stop, 'StopPosition', 'Position');
      const lat = finiteNumber(p && valueOf(p, 'PositionLat', 'Lat', 'Latitude'));
      const lon = finiteNumber(p && valueOf(p, 'PositionLon', 'Lon', 'Longitude'));
      return {
        stopUid: String(valueOf(stop, 'StopUID', 'StopID') || ''),
        stopName: zhName(valueOf(stop, 'StopName')) || '',
        stopSequence: Number.isFinite(sequence) ? sequence : index + 1,
        position: Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null,
      };
    }).filter(stop => stop.stopUid && stop.stopName);
    const boardIndex = normalized.findIndex(stop => stop.stopUid === String(arrival.stopUid));
    return {
      subRouteUid: String(valueOf(row, 'SubRouteUID', 'SubRouteID') || ''),
      direction: finiteNumber(valueOf(row, 'Direction')),
      boardIndex,
      stops: normalized,
    };
  }).filter(row => row.boardIndex >= 0);

  if (!rows.length) {
    return { state: 'unavailable', boardStopUid: String(arrival.stopUid), stops: [], variants: 0 };
  }
  // 完整站序完全相同的重複列不算歧義（TDX 偶爾會為相同營運型態重複列出）。
  const signatures = new Map();
  for (const row of rows) {
    const downstream = row.stops.slice(row.boardIndex + 1);
    const signature = downstream.map(stop => `${stop.stopUid}@${stop.stopSequence}`).join('|');
    if (!signatures.has(signature)) signatures.set(signature, { row, downstream });
  }
  if (signatures.size !== 1) {
    return { state: 'ambiguous', boardStopUid: String(arrival.stopUid), stops: [], variants: signatures.size };
  }
  const selected = [...signatures.values()][0];
  return {
    state: selected.downstream.length ? 'ready' : 'no_downstream',
    boardStopUid: String(arrival.stopUid),
    boardStopName: arrival.stopName || selected.row.stops[selected.row.boardIndex]?.stopName || '',
    routeUid: String(arrival.routeUid),
    subRouteUid: selected.row.subRouteUid || String(arrival.subRouteUid || ''),
    direction: selected.row.direction,
    variants: 1,
    stops: selected.downstream,
  };
}
