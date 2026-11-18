// 平面道路的標線沿圖資中心走。圖磚只給道路等級與寬度，靠近的平行車道保留原有的分隔空間。
const CELL = 48;
const MEDIAN_GAP = 4;
const MIN_PAINT = 3;

function* cells(a, b, pad) {
  const right = Math.floor((Math.max(a[0], b[0]) + pad) / CELL);
  const top = Math.floor((Math.max(a[1], b[1]) + pad) / CELL);
  for (let x = Math.floor((Math.min(a[0], b[0]) - pad) / CELL); x <= right; x++) {
    for (let y = Math.floor((Math.min(a[1], b[1]) - pad) / CELL); y <= top; y++) yield x + ',' + y;
  }
}

// 求線段參數 t（0～1）落在另一段道路的縱向、橫向範圍內的區間。
function clip(interval, start, delta, lo, hi) {
  if (Math.abs(delta) < 1e-8) return start >= lo && start <= hi;
  const a = (lo - start) / delta, b = (hi - start) / delta;
  interval[0] = Math.max(interval[0], Math.min(a, b));
  interval[1] = Math.min(interval[1], Math.max(a, b));
  return interval[1] > interval[0];
}

const nodeKey = p => p[0] + ',' + p[1] + ',' + Math.round((p[2] || 0) * 10);

function hiddenIntervals(road, a, b, grid, degree) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
  const cuts = [], seen = new Set();
  const start = nodeKey(a), end = nodeKey(b);
  const joinA = degree.get(start) === 2, joinB = degree.get(end) === 2;
  for (const cell of cells(a, b, road.w / 2 + MEDIAN_GAP)) {
    for (const other of grid.get(cell) || []) {
      if (road === other.road || seen.has(other)) continue;
      seen.add(other);
      const { x, y, ux, uy } = other;
      const along = dx * ux + dy * uy, across = dy * ux - dx * uy;
      // 同一個彎被圖資切成兩筆時，只有兩個路臂的接頭要連續；摺回重疊的線仍須裁切。
      if ((joinA && start === other.start || joinB && end === other.end) && along < 0.5 * length) continue;
      if ((joinA && start === other.end || joinB && end === other.start) && along > -0.5 * length) continue;
      const parallel = Math.abs(along) >= 0.94 * length;
      // 道路分段接頭的投影只有一個端點。平行段只在長度真的重疊處留白。
      const half = other.road.w / 2 + (parallel && other.major ? road.w / 2 + MEDIAN_GAP : 0.5);
      const cap = parallel ? 0 : 0.5, interval = [0, 1];
      const projection = (a[0] - x) * ux + (a[1] - y) * uy;
      const height = (a[2] || 0) - other.height - projection * other.grade;
      const rise = (b[2] || 0) - (a[2] || 0) - along * other.grade;
      if (clip(interval, height, rise, -0.9, 0.9) && clip(interval, projection, along, -cap, other.length + cap) &&
          clip(interval, (a[1] - y) * ux - (a[0] - x) * uy, across, -half, half)) cuts.push(interval);
    }
  }
  return cuts.sort((u, v) => u[0] - v[0]);
}

const pointAt = (a, b, t) => t === 0 ? a : t === 1 ? b : [
  a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (a[2] || 0) + ((b[2] || 0) - (a[2] || 0)) * t,
];

export function* surfaceMarkings(roads, rank, covers = roads) {
  const marked = roads.filter(road => rank(road.cls) >= 4 && road.w >= 8 && road.cls !== 'motorway');
  if (!marked.length) return;
  const grid = new Map(), degree = new Map();
  for (const road of covers) {
    if (rank(road.cls) < 2 || road.cls === 'pedestrian' || road.cls === 'service') continue;
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1], b = road.pts[i], dx = b[0] - a[0], dy = b[1] - a[1];
      const length = Math.hypot(dx, dy);
      if (!length) continue;
      const start = nodeKey(a), end = nodeKey(b);
      degree.set(start, (degree.get(start) || 0) + 1);
      degree.set(end, (degree.get(end) || 0) + 1);
      const segment = { road, start, end, height: a[2] || 0, grade: ((b[2] || 0) - (a[2] || 0)) / length, x: a[0], y: a[1], ux: dx / length, uy: dy / length, length, major: rank(road.cls) >= 4 };
      for (const cell of cells(a, b, road.w / 2 + 1)) {
        if (!grid.has(cell)) grid.set(cell, []);
        grid.get(cell).push(segment);
      }
    }
  }
  for (const road of marked) {
    let run = [], meters = 0, firstRun = true;
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1], b = road.pts[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!length) continue;
      let t = 0;
      const append = (end) => {
        if (!run.length) run.push(pointAt(a, b, t));
        run.push(pointAt(a, b, end));
        meters += (end - t) * length;
      };
      for (const [lo, hi] of hiddenIntervals(road, a, b, grid, degree)) {
        if (hi <= t) continue;
        if (lo > t) append(lo);
        // 只移除兩個留白區中間的短線；圖磚邊界或道路分段處的線要接得上。
        if (meters > 0 && (firstRun || meters >= MIN_PAINT)) yield run;
        run = []; meters = 0; firstRun = false; t = hi;
      }
      if (t < 1) append(1);
    }
    if (meters > 0) yield run;
  }
}
