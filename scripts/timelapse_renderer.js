/*
 * 軌島內部宣傳縮時 renderer。
 *
 * 這支檔只會由 scripts/render_timelapse.mjs 透過 Playwright 注入本機頁面；
 * index.html 不引用、正式站也不會上傳 scripts/，因此不會替一般使用者增加入口。
 */
(() => {
  'use strict';

  const BASE_W = 1080;
  const BASE_H = 1350;
  const DAY_SEC = 86400;
  const CATEGORY = [
    { id: 'tra', label: '台鐵', color: '#55a8ff' },
    { id: 'thsr', label: '高鐵', color: '#ff8a4c' },
    { id: 'afr', label: '阿里山林鐵', color: '#f4cf63' },
    { id: 'metro', label: '捷運・輕軌', color: '#56dbb4' },
  ];
  const CITY_LABELS = [
    ['臺北', 25.0477, 121.5170], ['桃園', 24.9537, 121.2258],
    ['新竹', 24.8014, 120.9717], ['臺中', 24.1375, 120.6869],
    ['彰化', 24.0818, 120.5385], ['嘉義', 23.4790, 120.4412],
    ['臺南', 22.9971, 120.2129], ['高雄', 22.6397, 120.3028],
    ['屏東', 22.6694, 120.4860], ['宜蘭', 24.7543, 121.7580],
    ['花蓮', 23.9928, 121.6016], ['臺東', 22.7937, 121.1230],
  ];
  const AREA_ROWS = [
    ['all', '全島', [21.88, 119.90, 25.35, 122.05]],
    ...CITY_LIST.map(([id, label]) => [id, label, CITY_BBOX[id]]),
  ];
  const AREAS = Object.fromEntries(AREA_ROWS.map(([id, label, bbox]) => [id, { id, label, bbox }]));

  const runtime = {
    canvas: null,
    ctx: null,
    land: null,
    prepared: null,
    scale: 1,
    date: '',
    dateLabel: '',
    font: '-apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", sans-serif',
  };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function pad2(v) { return String(v).padStart(2, '0'); }
  function formatTime(sec) {
    const t = clamp(Math.floor(sec), 0, DAY_SEC - 1);
    return pad2(Math.floor(t / 3600)) + ':' + pad2(Math.floor(t / 60) % 60);
  }
  function formatNumber(value) { return Math.round(value).toLocaleString('zh-TW'); }
  function inside(pos, bbox) {
    return !!(pos && pos.lat >= bbox[0] && pos.lat <= bbox[2] && pos.lon >= bbox[1] && pos.lon <= bbox[3]);
  }
  function colorAlpha(hex, alpha) {
    const h = String(hex || '#ffffff').replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, 'f').slice(0, 6);
    return `rgba(${parseInt(full.slice(0, 2), 16)},${parseInt(full.slice(2, 4), 16)},${parseInt(full.slice(4, 6), 16)},${alpha})`;
  }

  function mercator(lat, lon) {
    const yLat = clamp(lat, -85.05112878, 85.05112878) * Math.PI / 180;
    return {
      x: (lon + 180) / 360,
      y: (1 - Math.log(Math.tan(yLat) + 1 / Math.cos(yLat)) / Math.PI) / 2,
    };
  }

  function projector(bbox, rect) {
    const nw = mercator(bbox[2], bbox[1]);
    const se = mercator(bbox[0], bbox[3]);
    const srcW = se.x - nw.x;
    const srcH = se.y - nw.y;
    const fit = Math.min(rect.w / srcW, rect.h / srcH);
    const usedW = srcW * fit;
    const usedH = srcH * fit;
    const ox = rect.x + (rect.w - usedW) / 2;
    const oy = rect.y + (rect.h - usedH) / 2;
    return (lat, lon) => {
      const p = mercator(lat, lon);
      return { x: ox + (p.x - nw.x) * fit, y: oy + (p.y - nw.y) * fit };
    };
  }

  function buildGeoPath(geometry, project) {
    const path = new Path2D();
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons || []) for (const ring of polygon || []) {
      ring.forEach((coord, index) => {
        const p = project(coord[1], coord[0]);
        if (index) path.lineTo(p.x, p.y); else path.moveTo(p.x, p.y);
      });
      path.closePath();
    }
    return path;
  }

  function buildLinePath(shape, project) {
    const path = new Path2D();
    let started = false;
    for (const coord of shape || []) {
      if (!coord || !Number.isFinite(+coord[0]) || !Number.isFinite(+coord[1])) continue;
      const p = project(+coord[0], +coord[1]);
      if (started) path.lineTo(p.x, p.y); else { path.moveTo(p.x, p.y); started = true; }
    }
    return started ? path : null;
  }

  function allTrackRows() {
    const rows = [];
    for (const sys of state.systems) {
      const isRail = sys.mode === 'sched';
      const source = isRail ? ((sys._track && sys._track.lines) || []) : ((sys.data && sys.data.lines) || []);
      for (const line of source) {
        const shape = line.shape && line.shape.length ? line.shape
          : (line.stations || []).map(st => [st.lat, st.lon]);
        rows.push({
          sys: sys.id,
          color: line.color || (isRail ? '#7f8c98' : '#56dbb4'),
          shape,
        });
      }
    }
    return rows;
  }

  function categoryOfTrain(train) {
    if (train.sys === 'thsr_sched') return 1;
    if (train.sys === 'afr_sched') return 2;
    return 0;
  }

  function collectFrame(sec, bbox, includePoints) {
    const counts = [0, 0, 0, 0];
    const points = includePoints ? [] : null;
    for (const train of state.trains) {
      if (train.loop) continue; // 宣傳縮時只放當日公開班表，排除軌島自製山海號／平原號。
      const pos = trainPosAt(train, sec);
      if (!inside(pos, bbox)) continue;
      const cat = categoryOfTrain(train);
      counts[cat]++;
      if (points) points.push({ pos, color: train.color || CATEGORY[cat].color, cat });
    }
    for (const line of state.decoLines || []) {
      for (const train of line._tt || []) {
        const pos = freqTrainPosAt(line, train, sec);
        if (!inside(pos, bbox)) continue;
        counts[3]++;
        if (points) points.push({ pos, color: line.color || CATEGORY[3].color, cat: 3 });
      }
    }
    return { counts, points };
  }

  function lineTouchesArea(line, bbox) {
    const source = line.shape && line.shape.length ? line.shape
      : (line.stations || []).map(st => [st.lat, st.lon]);
    return source.some(coord => coord && coord[0] >= bbox[0] && coord[0] <= bbox[2]
      && coord[1] >= bbox[1] && coord[1] <= bbox[3]);
  }

  function departureEvents(bbox) {
    const out = [];
    for (const train of state.trains) {
      if (train.loop || !(train.stops || []).some(stop => inside(stop, bbox))) continue;
      const first = train.stops && train.stops[0];
      if (first && Number.isFinite(+first.depSec)) out.push(clamp(+first.depSec, 0, DAY_SEC - 1));
    }
    for (const line of state.decoLines || []) {
      if (!lineTouchesArea(line, bbox)) continue;
      for (const train of line._tt || []) {
        if (Number.isFinite(+train[1])) out.push(clamp(+train[1], 0, DAY_SEC - 1));
      }
    }
    return out.sort((a, b) => a - b);
  }

  function departuresAt(events, sec) {
    let lo = 0, hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (events[mid] <= sec) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  function chartHistory(bbox) {
    const samples = [];
    for (let i = 0; i <= 96; i++) {
      const sec = Math.min(DAY_SEC - 1, i / 96 * DAY_SEC);
      samples.push(collectFrame(sec, bbox, false).counts);
    }
    return samples;
  }

  function preferredDate() {
    const tra = state.systems.find(sys => sys.id === 'tra_sched');
    return (tra && tra.data && (tra.data._schedDay || tra.data.date)) || todayStr('Asia/Taipei');
  }

  async function init(options = {}) {
    const all = GROUPS.find(group => group.id === 'all');
    if (!state.ready) throw new Error('軌島資料尚未載入完成');
    if (all && state.group !== 'all') loadAllGroup(all, false);
    state.playing = false;
    state.clockAtNow = false;
    state.powerSave = false;
    runtime.scale = clamp(Number(options.scale) || 1, 0.25, 2);
    runtime.date = options.date || preferredDate();
    runtime.dateLabel = String(runtime.date).replace(/-/g, '/');
    runtime.land = runtime.land || await fetch('./data/taiwan_land.json').then(response => {
      if (!response.ok) throw new Error('讀不到台灣輪廓資料');
      return response.json();
    });

    const old = document.getElementById('railTimelapseCanvas');
    if (old) old.remove();
    const canvas = document.createElement('canvas');
    canvas.id = 'railTimelapseCanvas';
    canvas.width = Math.round(BASE_W * runtime.scale);
    canvas.height = Math.round(BASE_H * runtime.scale);
    canvas.style.cssText = 'position:fixed;inset:0;z-index:99999;width:' + canvas.width + 'px;height:' + canvas.height + 'px;background:#05070b';
    document.body.appendChild(canvas);
    document.documentElement.style.background = '#05070b';
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
    runtime.canvas = canvas;
    runtime.ctx = canvas.getContext('2d', { alpha: false });
    runtime.prepared = null;
    return { areas: AREA_ROWS.map(([id, label]) => ({ id, label })), date: runtime.date,
      width: canvas.width, height: canvas.height };
  }

  function prepare(areaId) {
    const area = AREAS[areaId];
    if (!area) throw new Error('未知的縮時地區：' + areaId);
    if (runtime.prepared && runtime.prepared.area.id === areaId) return runtime.prepared;
    const mapRect = { x: 40, y: 178, w: 1000, h: 830 };
    const project = projector(area.bbox, mapRect);
    const landPath = buildGeoPath(runtime.land.geometry, project);
    const tracks = allTrackRows().map(row => ({ ...row, path: buildLinePath(row.shape, project) })).filter(row => row.path);
    const history = chartHistory(area.bbox);
    const departures = departureEvents(area.bbox);
    runtime.prepared = { area, mapRect, project, landPath, tracks, history, departures };
    return runtime.prepared;
  }

  function drawBackground(g, sec) {
    const h = sec / 3600;
    const dawn = clamp(1 - Math.abs(h - 7) / 3, 0, 1);
    const dusk = clamp(1 - Math.abs(h - 18.5) / 2.5, 0, 1);
    const grad = g.createLinearGradient(0, 0, 0, BASE_H);
    grad.addColorStop(0, dawn > dusk ? '#101823' : dusk > .15 ? '#17141a' : '#06080d');
    grad.addColorStop(.58, '#080b10');
    grad.addColorStop(1, '#05070b');
    g.fillStyle = grad;
    g.fillRect(0, 0, BASE_W, BASE_H);
  }

  function drawMap(g, prepared, frame, sec) {
    const { mapRect, landPath, tracks, project, area } = prepared;
    g.save();
    g.beginPath(); g.rect(mapRect.x, mapRect.y, mapRect.w, mapRect.h); g.clip();

    const sea = g.createRadialGradient(BASE_W * .52, mapRect.y + mapRect.h * .46, 20, BASE_W * .52, mapRect.y + mapRect.h * .46, mapRect.w * .7);
    sea.addColorStop(0, 'rgba(26,39,48,.38)'); sea.addColorStop(1, 'rgba(2,5,9,0)');
    g.fillStyle = sea; g.fillRect(mapRect.x, mapRect.y, mapRect.w, mapRect.h);

    g.save();
    g.shadowColor = 'rgba(171,220,214,.24)'; g.shadowBlur = 22;
    g.fillStyle = '#151c1e'; g.fill(landPath, 'evenodd');
    g.restore();
    g.strokeStyle = 'rgba(221,239,233,.65)'; g.lineWidth = 1.35; g.stroke(landPath);

    // 幾何輪廓內疊一層低對比「等高線感」紋理；不依賴第三方圖磚，批次離線仍可重現。
    g.save(); g.clip(landPath, 'evenodd');
    for (let i = -10; i < 52; i++) {
      const y = mapRect.y + i * 24;
      g.beginPath();
      for (let x = mapRect.x - 20; x <= mapRect.x + mapRect.w + 20; x += 18) {
        const yy = y + Math.sin(x * .017 + i * .71) * 9 + Math.sin(x * .006 - i * .43) * 15;
        if (x === mapRect.x - 20) g.moveTo(x, yy); else g.lineTo(x, yy);
      }
      g.strokeStyle = i % 4 ? 'rgba(178,197,185,.045)' : 'rgba(209,224,211,.075)';
      g.lineWidth = i % 4 ? .7 : 1.1; g.stroke();
    }
    g.restore();

    for (const row of tracks) {
      g.strokeStyle = 'rgba(1,4,7,.8)'; g.lineWidth = 5.6; g.stroke(row.path);
      g.strokeStyle = colorAlpha(row.color, row.sys === 'tra_sched' ? .48 : .38);
      g.lineWidth = row.sys === 'thsr_sched' ? 2.6 : row.sys === 'afr_sched' ? 1.5 : row.sys === 'tra_sched' ? 2.1 : 1.7;
      g.stroke(row.path);
    }

    const allView = area.id === 'all';
    g.font = `600 ${allView ? 14 : 16}px ${runtime.font}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [label, lat, lon] of CITY_LABELS) {
      if (lat < area.bbox[0] || lat > area.bbox[2] || lon < area.bbox[1] || lon > area.bbox[3]) continue;
      const p = project(lat, lon);
      g.lineWidth = 3; g.strokeStyle = 'rgba(3,6,9,.92)'; g.strokeText(label, p.x, p.y - 13);
      g.fillStyle = 'rgba(228,238,235,.7)'; g.fillText(label, p.x, p.y - 13);
    }

    // 光暈與實心分兩次畫，避免 canvas shadowBlur 對數千班次逐顆重算。
    for (const point of frame.points) {
      const p = project(point.pos.lat, point.pos.lon);
      g.beginPath(); g.arc(p.x, p.y, allView ? 4.8 : 6.5, 0, Math.PI * 2);
      g.fillStyle = colorAlpha(point.color, .18); g.fill();
    }
    for (const point of frame.points) {
      const p = project(point.pos.lat, point.pos.lon);
      g.beginPath(); g.arc(p.x, p.y, allView ? 2.05 : 2.9, 0, Math.PI * 2);
      g.fillStyle = colorAlpha(point.color, .98); g.fill();
    }

    // 日夜色溫只疊在地圖段，讓凌晨與傍晚的時間流動不只靠數字。
    const hour = sec / 3600;
    if (hour < 5.5 || hour > 20) {
      g.fillStyle = `rgba(4,8,18,${hour < 5.5 ? .2 : .13})`; g.fillRect(mapRect.x, mapRect.y, mapRect.w, mapRect.h);
    } else if (hour > 17 && hour < 20) {
      g.fillStyle = `rgba(91,39,21,${Math.sin((hour - 17) / 3 * Math.PI) * .10})`; g.fillRect(mapRect.x, mapRect.y, mapRect.w, mapRect.h);
    }
    g.restore();

    const vignette = g.createRadialGradient(BASE_W / 2, mapRect.y + mapRect.h / 2, mapRect.w * .2, BASE_W / 2, mapRect.y + mapRect.h / 2, mapRect.w * .7);
    vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,0,.38)');
    g.fillStyle = vignette; g.fillRect(mapRect.x, mapRect.y, mapRect.w, mapRect.h);
  }

  function drawHeader(g, prepared, frame, sec) {
    const running = frame.counts.reduce((sum, value) => sum + value, 0);
    const departed = departuresAt(prepared.departures, sec);
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#f7f4eb'; g.textAlign = 'left';
    g.font = `800 39px ${runtime.font}`;
    g.fillText('軌島 Rail Island', 52, 66);
    g.font = `650 19px ${runtime.font}`; g.fillStyle = 'rgba(230,235,232,.72)';
    const place = prepared.area.id === 'all' ? '全島鐵道' : prepared.area.label + '鐵道';
    g.fillText(`${place}・${runtime.dateLabel}・一日縮時`, 54, 98);

    g.textAlign = 'right'; g.fillStyle = '#f7f4eb';
    g.font = `300 58px ${runtime.font}`; g.fillText(formatTime(sec), 1028, 70);
    g.font = `700 20px ${runtime.font}`; g.fillStyle = 'rgba(230,235,232,.9)';
    g.fillText(`${formatNumber(running)} 班運行中`, 1027, 102);
    g.font = `600 14px ${runtime.font}`; g.fillStyle = 'rgba(230,235,232,.48)';
    g.fillText(`今日已發 ${formatNumber(departed)} / ${formatNumber(prepared.departures.length)} 班`, 1027, 124);
  }

  function drawChart(g, prepared, frame, progress) {
    const x = 52, y = 1062, w = 976, h = 150;
    const history = prepared.history;
    let max = 1;
    for (const row of history) max = Math.max(max, row.reduce((sum, value) => sum + value, 0));
    const yAt = value => y + h - value / max * h;

    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = `650 14px ${runtime.font}`; g.fillStyle = 'rgba(230,235,232,.54)';
    g.fillText('區域內同時運行班次', x, y - 18);
    g.textAlign = 'right';
    g.fillText(`${formatTime(progress * DAY_SEC)}・${formatNumber(frame.counts.reduce((a, b) => a + b, 0))} 班`, x + w, y - 18);

    for (let hour = 0; hour <= 24; hour += 6) {
      const gx = x + hour / 24 * w;
      g.beginPath(); g.moveTo(gx, y); g.lineTo(gx, y + h);
      g.strokeStyle = 'rgba(225,235,232,.08)'; g.lineWidth = 1; g.stroke();
      g.textAlign = hour === 0 ? 'left' : hour === 24 ? 'right' : 'center';
      g.font = `600 13px ${runtime.font}`; g.fillStyle = 'rgba(230,235,232,.38)';
      g.fillText(pad2(hour), gx, y + h + 23);
    }

    function stackedArea(categoryIndex, endProgress, alpha) {
      const last = Math.max(1, Math.floor((history.length - 1) * endProgress));
      const upper = [], lower = [];
      for (let i = 0; i <= last; i++) {
        const row = history[i];
        let base = 0;
        for (let j = 0; j < categoryIndex; j++) base += row[j];
        const xx = x + i / (history.length - 1) * w;
        upper.push([xx, yAt(base + row[categoryIndex])]);
        lower.push([xx, yAt(base)]);
      }
      if (upper.length < 2) return;
      g.beginPath(); g.moveTo(upper[0][0], upper[0][1]);
      for (let i = 1; i < upper.length; i++) g.lineTo(upper[i][0], upper[i][1]);
      for (let i = lower.length - 1; i >= 0; i--) g.lineTo(lower[i][0], lower[i][1]);
      g.closePath(); g.fillStyle = colorAlpha(CATEGORY[categoryIndex].color, alpha); g.fill();
    }
    for (let cat = 0; cat < CATEGORY.length; cat++) stackedArea(cat, 1, .12);
    for (let cat = 0; cat < CATEGORY.length; cat++) stackedArea(cat, clamp(progress, .01, 1), .78);

    const px = x + clamp(progress, 0, 1) * w;
    const total = frame.counts.reduce((sum, value) => sum + value, 0);
    g.beginPath(); g.arc(px, yAt(total), 4, 0, Math.PI * 2);
    g.fillStyle = '#f7f4eb'; g.fill();
    g.beginPath(); g.moveTo(px, y); g.lineTo(px, y + h);
    g.strokeStyle = 'rgba(247,244,235,.28)'; g.lineWidth = 1; g.stroke();

    let lx = 54;
    for (let i = 0; i < CATEGORY.length; i++) {
      g.beginPath(); g.arc(lx + 5, 1265, 5, 0, Math.PI * 2); g.fillStyle = CATEGORY[i].color; g.fill();
      g.textAlign = 'left'; g.font = `650 14px ${runtime.font}`; g.fillStyle = 'rgba(237,240,237,.68)';
      const text = `${CATEGORY[i].label} ${formatNumber(frame.counts[i])}`;
      g.fillText(text, lx + 17, 1270);
      lx += 64 + g.measureText(text).width;
    }
  }

  function drawFooter(g) {
    g.textBaseline = 'alphabetic'; g.font = `550 11.5px ${runtime.font}`;
    g.textAlign = 'left'; g.fillStyle = 'rgba(231,236,233,.42)';
    g.fillText('資料：台鐵・台灣高鐵・各捷運營運單位公開時刻表　｜　表定縮時，臨時異動以官方公告為準', 52, 1324);
    g.textAlign = 'right'; g.font = `750 13px ${runtime.font}`; g.fillStyle = 'rgba(247,244,235,.72)';
    g.fillText('railisland.tw', 1028, 1324);
  }

  function render(areaId, progress) {
    if (!runtime.canvas || !runtime.ctx) throw new Error('請先呼叫 RAIL_TIMELAPSE.init()');
    const prepared = prepare(areaId);
    const p = clamp(Number(progress) || 0, 0, 1);
    const sec = Math.min(DAY_SEC - 1, p * DAY_SEC);
    const frame = collectFrame(sec, prepared.area.bbox, true);
    const g = runtime.ctx;
    g.save(); g.setTransform(runtime.scale, 0, 0, runtime.scale, 0, 0);
    drawBackground(g, sec);
    drawHeader(g, prepared, frame, sec);
    drawMap(g, prepared, frame, sec);
    drawChart(g, prepared, frame, p);
    drawFooter(g);
    g.restore();
    return { area: prepared.area.id, label: prepared.area.label, progress: p, sec,
      running: frame.counts.reduce((sum, value) => sum + value, 0), counts: frame.counts,
      departed: departuresAt(prepared.departures, sec), totalTrips: prepared.departures.length };
  }

  function mimeType() {
    for (const type of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  }

  async function record(options = {}) {
    const areaId = options.area || 'all';
    const duration = clamp(Number(options.duration) || 16, 1, 120);
    const fps = clamp(Math.round(Number(options.fps) || 30), 12, 60);
    const filename = options.filename || `軌島_${areaId}_一日縮時.webm`;
    const type = mimeType();
    if (!type) throw new Error('目前 Chromium 沒有可用的 WebM encoder');
    prepare(areaId);
    render(areaId, 0);
    const stream = runtime.canvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: Number(options.bitrate) || 12e6 });
    const chunks = [];
    const done = new Promise((resolve, reject) => {
      recorder.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
      recorder.onerror = event => reject(event.error || new Error('MediaRecorder 錄製失敗'));
      recorder.onstop = () => resolve(new Blob(chunks, { type }));
    });
    recorder.start(1000);
    const started = performance.now();
    await new Promise(resolve => {
      const step = now => {
        const progress = clamp((now - started) / (duration * 1000), 0, 1);
        render(areaId, progress);
        if (progress < 1) requestAnimationFrame(step);
        else setTimeout(resolve, 180);
      };
      requestAnimationFrame(step);
    });
    recorder.stop();
    const blob = await done;
    for (const track of stream.getTracks()) track.stop();
    if (!blob.size) throw new Error('縮時影片是空檔');
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { area: areaId, filename, mime: type, bytes: blob.size, duration, fps };
  }

  window.RAIL_TIMELAPSE = {
    init, render, record,
    areas: AREA_ROWS.map(([id, label]) => ({ id, label })),
    categories: CATEGORY.map(item => ({ ...item })),
  };
})();
