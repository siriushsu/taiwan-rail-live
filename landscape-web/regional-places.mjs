// 地景圖磚沒涵蓋到的地方（山區、郊外），網站的廟、校舍與場館原本由 MapLibre 的 place-*-regional 立體圖層畫：
// 那一層畫在地景畫布上面，不經過地景的霧、山霧、日夜光，也不被地景的山擋住，雨霧裡顏色鮮明地浮在霧上（11-24 汐止大尖山一帶的廟）。
// 這裡把同一份資料（taiwan-places 向量圖磚、同一條圖層篩選與顏色式）蓋成地景場景裡的網格：底貼地景自己的地面，材質走 engine 的光與霧。
// 蓋得出來的圖層才藏掉 MapLibre 那一層；樣式式子看不懂、或那裡沒有地景地面時照舊交給 MapLibre。
// 同一區（畫面中心不在地景細節圖磚裡，site.js 的 regionalContext）網站另外留著 OpenMapTiles 的 3D 建物 building-3d 與平面建物 building 當背景：
// 廟的外框在 OSM 也是一棟建物，廟改進地景後那棟米色建物反過來蓋在廟上（屋頂變米色、地面多一塊米色外框）。
// 所以開著 3D 建物時這兩層也一起改畫進地景：細節圖磚範圍內的跳過（engine 自己畫），落在廟外框裡的跳過（讓廟露出來）。
import * as THREE from './engine/vendor/three.module.js';
import { toTM2 } from './engine/proj/tm2.mjs';

export const REGIONAL_LAYERS = ['place-temple-regional', 'place-buildings-regional', 'place-architecture-regional'];
const CONTEXT_3D = 'building-3d', CONTEXT_LAYERS = [CONTEXT_3D, 'building'];
const SOURCE = 'taiwan-places', BURY = 4;   // 落在坡上的那一側往下多蓋 4 m，不懸空

// MapLibre 樣式式子：只認這幾個圖層用到的 get／id／coalesce／match／==／all／!／in／literal／to-number／zoom／interpolate linear／within，
// 其餘回 undefined（＝看不懂，不接手）。p 是要素屬性，c 是 { zoom, id, at: [lng, lat] }（within 用要素外框的中心點判斷）
const rgb = s => { const h = String(s).replace('#', ''); return h.length === 6 ? [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) : null; };
function evaluate(x, p, c = {}) {
  if (!Array.isArray(x)) return x;
  const [op, ...a] = x, ev = v => evaluate(v, p, c);
  if (op === 'get' && a.length === 1) return p[a[0]] ?? null;
  if (op === 'literal') return a[0];
  if (op === 'zoom') return c.zoom;
  if (op === 'id') return c.id ?? null;
  if (op === 'in') { const h = ev(a[1]); return Array.isArray(h) ? h.includes(ev(a[0])) : typeof h === 'string' ? h.includes(ev(a[0])) : false; }
  if (op === 'coalesce') { for (const v of a) { const r = ev(v); if (r != null) return r; } return null; }
  if (op === '==') return ev(a[0]) === ev(a[1]);
  if (op === 'all') return a.every(v => ev(v) === true);
  if (op === '!') return ev(a[0]) !== true;
  // to-number：依序試，null／false 轉成 0（MapLibre 的規則）
  if (op === 'to-number') { for (const v of a) { const r = ev(v); if (r == null || r === false) return 0; const n = +r; if (Number.isFinite(n)) return n; } return undefined; }
  if (op === 'within') return !!c.at && inside(c.at, a[0]?.type === 'Polygon' ? a[0].coordinates : null);
  if (op === 'match') {
    const v = ev(a[0]);
    for (let i = 1; i + 1 < a.length; i += 2) if (Array.isArray(a[i]) ? a[i].includes(v) : a[i] === v) return ev(a[i + 1]);
    return ev(a[a.length - 1]);
  }
  if (op === 'interpolate' && a[0]?.[0] === 'linear') {
    const v = ev(a[1]), st = a.slice(2);
    if (!Number.isFinite(v)) return undefined;
    let i = 0; while (i + 2 < st.length && v >= st[i + 2]) i += 2;
    const lo = ev(st[i + 1]), hi = ev(st[Math.min(i + 3, st.length - 1)]), t = i + 2 < st.length ? Math.max(0, Math.min(1, (v - st[i]) / (st[i + 2] - st[i]))) : 0;
    if (typeof lo === 'number' && typeof hi === 'number') return lo + (hi - lo) * t;
    const A = rgb(lo), B = rgb(hi);   // 顏色照 MapLibre 在 sRGB 分量上線性內插
    return A && B ? `rgb(${A.map((q, k) => Math.round(q + (B[k] - q) * t)).join(',')})` : undefined;
  }
  return undefined;
}
// 點在不在多邊形（第一圈外框、其餘是洞）裡：射線法
function inside([x, y], rings) {
  if (!rings?.length) return false;
  let r = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) r = !r;
  }
  return r;
}
const OPS = new Set(['get', 'id', 'literal', 'coalesce', '==', 'all', '!', 'in', 'match', 'to-number', 'zoom', 'interpolate', 'within']);
function readable(x) {
  if (!Array.isArray(x)) return true;
  const [op, ...a] = x;
  if (!OPS.has(op)) return false;
  if (op === 'literal' || op === 'get' || op === 'id' || op === 'within' || op === 'zoom') return true;
  if (op === 'interpolate') return a[0]?.[0] === 'linear' && a.slice(1).every((v, i) => i % 2 === 1 || readable(v));
  // match：[輸入, 標籤, 值, 標籤, 值, …, 預設]；標籤可以是字串陣列
  if (op === 'match') return readable(a[0]) && a.slice(1).every((v, i, r) => (i % 2 === 0 && i < r.length - 1) || readable(v));
  return a.every(readable);
}
// (e, n) 平面的有號面積：外圈逆時針、洞順時針，牆的法線與屋面三角形才朝外、朝上
const area = r => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a.x * b.y - b.x * a.y; } return s / 2; };

export function createRegionalPlaces(map, { api, groundLL, onChange, context = () => false, buildings3d = () => false }) {
  const group = new THREE.Group(); group.name = 'regional-places'; group.matrixAutoUpdate = true;
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: 0, side: THREE.DoubleSide });
  api.scene.add(group);
  let anchor = null, key = '', timer = 0, dirty = false, built3d = false;
  const meshes = new Map();   // 圖層 id → mesh
  // 這個圖層蓋不蓋得出來：style 裡有、是立體圖層、篩選與高度顏色的式子都看得懂
  // 每格 enforce 都會問：照圖層物件記住結果（換樣式會換成新的圖層物件）
  const cache = new WeakMap();
  function spec(id, source = SOURCE) {
    const obj = map.getLayer(id);
    if (!obj) return null;
    if (cache.has(obj)) return cache.get(obj);
    const l = obj.serialize(), p = l.paint || {}, color = p['fill-extrusion-color'], top = p['fill-extrusion-height'], base = p['fill-extrusion-base'] ?? 0;
    const ok = l.type === 'fill-extrusion' && l.source === source && readable(l.filter ?? true) && readable(color) && readable(top) && readable(base);
    const s = ok ? { id, source, sourceLayer: l['source-layer'], filter: l.filter, color, top, base, minzoom: l.minzoom ?? 0 } : null;
    cache.set(obj, s); return s;
  }
  const specs = () => REGIONAL_LAYERS.map(id => spec(id)).filter(Boolean);
  // OSM 建物：中心不在地景細節圖磚、使用者開著 3D 建物、而且 building-3d 的式子看得懂，才由這裡畫
  const contextSpec = () => context() && buildings3d() ? spec(CONTEXT_3D, 'openmaptiles') : null;
  const handles = id => REGIONAL_LAYERS.includes(id) ? !!spec(id) : CONTEXT_LAYERS.includes(id) && !!contextSpec();
  const inDetail = (e, n) => !!api.index?.tiles?.['E' + Math.floor(e / api.TILE_M) + '_N' + Math.floor(n / api.TILE_M)];

  // 一塊外框（經緯度，第一圈外框、其餘是洞）擠出成牆與頂，貼在地面 g 上；底在地面時往下多蓋 BURY 公尺
  function extrude(rings, g, b0, top, col, A, o) {
    const bottom = g + b0 - (b0 === 0 ? BURY : 0), y1 = g + top;
    const contour = rings.map(r => r.map(([lng, lat]) => { const [e, n] = toTM2(lng, lat); return new THREE.Vector2(e - A.e, n - A.n); }));
    for (const r of contour) if (r.length > 1 && r[0].equals(r[r.length - 1])) r.pop();
    if (contour[0].length < 3) return;
    contour.forEach((r, i) => { if ((area(r) > 0) !== (i === 0)) r.reverse(); });
    const flat = contour.flat();
    for (const t of THREE.ShapeUtils.triangulateShape(contour[0], contour.slice(1))) {
      const [a, b, c] = t.map(i => flat[i]), up = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y) > 0;
      for (const v of up ? [a, b, c] : [a, c, b]) { o.pos.push(v.x, y1, -v.y); o.nor.push(0, 1, 0); o.rgb.push(col.r, col.g, col.b); }
    }
    for (const r of contour) for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      if (!len) continue;
      const nx = dy / len, nz = dx / len;
      for (const [v, y] of [[a, bottom], [b, bottom], [b, y1], [a, bottom], [b, y1], [a, y1]]) { o.pos.push(v.x, y, -v.y); o.nor.push(nx, 0, nz); o.rgb.push(col.r, col.g, col.b); }
    }
  }
  const centroid = ring => ring.reduce((a, q) => [a[0] + q[0] / ring.length, a[1] + q[1] / ring.length], [0, 0]);
  const polygons = f => f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];

  function build() {
    timer = 0;
    if (!api.index) return;
    const out = new Map(), col = new THREE.Color(), grounds = new Map(), A = anchor || { e: api.origin.e, n: api.origin.n }, zoom = map.getZoom();
    const temples = [];   // 廟最底一層的外框（經緯度），OSM 建物落在裡面就不蓋
    let missing = 0, sig = '';
    for (const s of specs()) {
      const seen = new Set(), o = { pos: [], nor: [], rgb: [] };
      for (const f of map.querySourceFeatures(SOURCE, { sourceLayer: s.sourceLayer })) {
        const p = f.properties || {};
        if (s.filter && evaluate(s.filter, p) !== true) continue;
        for (const rings of polygons(f)) {
          const k = JSON.stringify(rings[0]?.slice(0, 3)) + '|' + p.base + '|' + p.top + '|' + p.h;   // 向量圖磚相鄰兩格會各給一份
          if (!rings[0]?.length || seen.has(k)) continue; seen.add(k);
          // 同一座廟分成一層一層的屋面：共用一個地面高度（以第一塊的中心查），屋面才疊得齊
          const gid = p.temple || k;
          let g = grounds.get(gid);
          if (g === undefined) { g = groundLL(...centroid(rings[0])); grounds.set(gid, g); }
          if (!Number.isFinite(g)) { missing++; continue; }
          const b0 = +evaluate(s.base, p) || 0, top = +evaluate(s.top, p), hex = evaluate(s.color, p);
          if (!(top > b0)) continue;
          if (s.id === 'place-temple-regional' && b0 === 0) temples.push(rings);
          col.set(hex || '#c9c5ae');
          extrude(rings, g, b0, top, col, A, o);
          sig += Math.round(g) + ',';
        }
      }
      out.set(s.id, { ...o, minzoom: s.minzoom, n: seen.size });
    }
    const cs = contextSpec(); built3d = !!cs;
    if (cs) {
      const seen = new Set(), o = { pos: [], nor: [], rgb: [] };
      for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer: cs.sourceLayer })) {
        const p = f.properties || {};
        for (const rings of polygons(f)) {
          if (!rings[0]?.length) continue;
          const at = centroid(rings[0]), k = at[0].toFixed(7) + ',' + at[1].toFixed(7);
          if (seen.has(k)) continue; seen.add(k);
          const [e, n] = toTM2(...at);
          if (inDetail(e, n) || temples.some(t => inside(at, t))) continue;
          const c = { zoom, at, id: f.id };
          if (cs.filter && evaluate(cs.filter, p, c) !== true) continue;
          const g = groundLL(...at);
          if (!Number.isFinite(g)) { missing++; continue; }
          const b0 = +evaluate(cs.base, p, c) || 0, top = +evaluate(cs.top, p, c), hex = evaluate(cs.color, p, c);
          if (!(top > b0)) continue;
          col.set(hex || '#d6c2a3');
          extrude(rings, g, b0, top, col, A, o);
          sig += Math.round(g) + ',';
        }
      }
      out.set(CONTEXT_3D, { ...o, minzoom: cs.minzoom, n: seen.size });
    }
    const next = [...out].map(([id, o]) => id + ':' + o.n + ':' + o.pos.length).join('|') + '|' + sig.length + ':' + hash(sig);
    if (next === key && !missing) return;
    key = next; anchor = A; dirty = !!missing;
    for (const m of meshes.values()) { group.remove(m); m.geometry.dispose(); }
    meshes.clear();
    for (const [id, o] of out) {
      if (!o.pos.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(o.nor, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(o.rgb, 3));
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, material); m.name = id; m.userData.minzoom = o.minzoom; m.frustumCulled = false;
      group.add(m); meshes.set(id, m);
    }
    onChange?.(); map.triggerRepaint();
  }
  const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
  const schedule = (ms = 250) => { if (!timer) timer = setTimeout(build, ms); };
  map.on('moveend', () => schedule());
  map.on('sourcedata', e => { if ((e.sourceId === SOURCE || e.sourceId === 'openmaptiles' && built3d) && e.isSourceLoaded) schedule(); });

  return {
    handles,
    // 每格畫之前：跟著 engine 的原點擺位、照圖層的 minzoom 開關；地面還沒到的那幾座等圖磚到了再補；
    // 進出細節圖磚範圍、開關 3D 建物時重蓋 OSM 建物
    frame(active) {
      if (!!contextSpec() !== built3d) schedule(0);
      group.visible = !!active;
      if (!active) return;
      if (anchor) group.position.set(anchor.e - api.origin.e, 0, -(anchor.n - api.origin.n));
      const z = map.getZoom();
      for (const m of meshes.values()) m.visible = z >= m.userData.minzoom;
      if (dirty && api.pending() === 0) { dirty = false; schedule(0); }
    },
    rebuild: () => schedule(0),
    get meshes() { return meshes; },
  };
}
