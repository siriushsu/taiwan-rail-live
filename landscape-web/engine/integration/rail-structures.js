import * as THREE from "../vendor/three.module.js";
import { portalClearanceVolumes, outsidePortalClearance } from "./portal-clearance.js";
const GAUGE = 1.435, RAIL_W = 0.14, RAIL_H = 0.2, TIE_LEN = 2.5, TIE_W = 0.26, TIE_H = 0.15, TIE_SPACING = 0.65;
const DECK_W = 5, GIRDER_BOTTOM_W = 2.8, GIRDER_DEPTH = 1.8, DECK_DROP = 0.35, PARAPET_H = 0.9, PARAPET_W = 0.35, PIER_ALONG = 1.6, PIER_ACROSS = 2.2, CAP_ACROSS = 5, CAP_ALONG = 1.6, CAP_DEPTH = 1.2, NEIGHBOR_M = 6.5;
const BED_TOP_W = 3.4, BED_BOTTOM_W = 4.6, FILL_SLOPE = 1, BED_BOTTOM_MAX = 14;
export const VIADUCT_LIFT_M = 6;
const BORE_R = 3.2, BORE_FLOOR = -1.2, RING = 0.65, ARCH_SEGMENTS = 20;
const PORTAL_T = 1.2, PORTAL_EMBED = 0.8, PORTAL_DROP_MAX = 45;
import { PORTAL_DEPTH, PORTAL_WING } from "./tunnel-portals.js";
export function createRailStructures(scene, { track = true } = {}) {
  let geometry = new THREE.BufferGeometry();
  const bedStyles = {
    original: { top: BED_TOP_W, bottom: BED_BOTTOM_W, slope: FILL_SLOPE, max: BED_BOTTOM_MAX, ballast: "#9d978b", bank: "#c6c0b1", steel: "#6f6a62", tie: "#a8a299" },
    gravel: { top: 3, bottom: 3.6, slope: 0.35, max: 7, ballast: "#b2b7b1", bank: "#cbd0c2", steel: "#73817e", tie: "#c2c5bc" }
  };
  let bedStyle = "gravel", lastSet = null;
  const gravelAmount = { value: 0 };
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), mesh = new THREE.Mesh(geometry, material);
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute float railGlow; varying float vRailGlow;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvRailGlow=railGlow;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vRailGlow;").replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(1.,.74,.38)*vRailGlow;");
    shader.uniforms.railGravelAmount = gravelAmount;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute vec2 railBedUv; attribute float railBedSurface; varying vec2 vRailBedUv; varying float vRailBedSurface;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvRailBedUv=railBedUv; vRailBedSurface=railBedSurface;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
      uniform float railGravelAmount;
      varying vec2 vRailBedUv; varying float vRailBedSurface;
      vec2 bedHash(vec2 p){p=mod(p,512.);return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);}
      float bedGrain(vec2 metres){
        vec2 p=metres*8.,cell=floor(p),f=fract(p);float first=8.,second=8.,shade=.5;
        for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
          vec2 offset=vec2(float(x),float(y)),h=bedHash(cell+offset),delta=offset+.2+.6*h-f;
          float d=dot(delta,delta);
          if(d<first){second=first;first=d;shade=h.x;}else if(d<second)second=d;
        }
        float edge=smoothstep(.015,.08,second-first);
        float grain=mix(.91,1.05,shade)*mix(.91,1.,edge);
        // 顆粒小於螢幕像素時退成平均色，縮遠或低角度移動不會閃成椒鹽。
        float fade=1.-smoothstep(.5,1.4,max(fwidth(p.x),fwidth(p.y)));
        return mix(1.,grain,fade);
      }`).replace("#include <color_fragment>", "#include <color_fragment>\nif(railGravelAmount>0. && vRailBedSurface>.5) diffuseColor.rgb*=mix(1.,bedGrain(vRailBedUv),railGravelAmount);");
  };
  mesh.frustumCulled = false;
  mesh.layers.enable(2);
  mesh.renderOrder = -1;
  scene.add(mesh);
  const stats = { bedStyle, decks: 0, piers: 0, caps: 0, parapets: 0, beds: 0, rails: 0, ties: 0, portals: 0, portalTracks: 0, portalSamples: [], detail: 0, vertices: 0, samples: [], buildMs: 0 };
  function set(segments, piers, detail = 0, portals = []) {
    lastSet = [segments, piers, detail, portals];
    gravelAmount.value = bedStyle === "gravel" && detail >= 2 ? 1 : 0;
    const style = bedStyles[bedStyle], started = performance.now(), positions = [], colors = [], glows = [], bedSurfaces = [];
    const deck = new THREE.Color("#b2ad9e"), side = new THREE.Color("#989588"), ballast = new THREE.Color(style.ballast), steel = new THREE.Color(style.steel), tie = new THREE.Color(style.tie), lining = new THREE.Color("#344b52"), parapet = new THREE.Color("#cfcab9"), bank = new THREE.Color(style.bank), pierColor = new THREE.Color("#bdbbad"), pierSide = new THREE.Color("#b1afa2");
    stats.decks = stats.piers = stats.caps = stats.parapets = stats.beds = stats.rails = stats.ties = stats.portals = 0;
    stats.detail = detail;
    stats.samples = [];
    stats.portalTracks = 0;
    stats.portalSamples = [];
    let portalMasks = null, portalEmission = 0;
    function quad(a, b, c, d, color) {
      const polygons = portalMasks ? outsidePortalClearance([a, b, c, d], portalMasks) : [[a, b, c, d]];
      for (const poly of polygons) for (let i = 1; i < poly.length - 1; i++) for (const p of [poly[0], poly[i], poly[i + 1]]) {
        positions.push(...p);
        colors.push(color.r, color.g, color.b);
        glows.push(portalEmission);
        bedSurfaces.push(color === ballast ? 1 : 0);
      }
    }
    const joins = /* @__PURE__ */ new Map(), joinKey = (p) => p.map((v) => Math.round(v * 1e3)).join(",");
    for (const { a, b } of segments) {
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len < 1e-5) continue;
      for (const p of [a, b]) {
        const key = joinKey(p), items = joins.get(key) || [];
        items.push([-dy / len, dx / len]);
        joins.set(key, items);
      }
    }
    function edge(p, ux, uy) {
      const items = joins.get(joinKey(p)) || [];
      let x = ux, y = uy;
      for (const [nx, ny] of items) {
        const sign = nx * ux + ny * uy >= 0 ? 1 : -1;
        x += nx * sign;
        y += ny * sign;
      }
      const len = Math.hypot(x, y);
      x /= len;
      y /= len;
      const m = Math.max(0.7, x * ux + y * uy);
      return [x / m, y / m];
    }
    function prism(a, b, width, bottomA, bottomB, color, bottomWidth = width, flank = null, ribbon = null) {
      const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      if (length < 1e-5) return;
      const ux = -dy / length, uy = dx / length, nx = ux * width / 2, ny = uy * width / 2, bx = ux * bottomWidth / 2, by = uy * bottomWidth / 2;
      const ea = ribbon ? edge(ribbon.a, ux, uy) : [ux, uy], eb = ribbon ? edge(ribbon.b, ux, uy) : [ux, uy], wa = bottomWidth / 2, wb = (ribbon?.bottomEnd ?? bottomWidth) / 2;
      const p = [[a[0] + ea[0] * width / 2, a[1] + ea[1] * width / 2, a[2]], [a[0] - ea[0] * width / 2, a[1] - ea[1] * width / 2, a[2]], [b[0] - eb[0] * width / 2, b[1] - eb[1] * width / 2, b[2]], [b[0] + eb[0] * width / 2, b[1] + eb[1] * width / 2, b[2]]];
      const q = [[a[0] + ea[0] * wa, a[1] + ea[1] * wa, bottomA], [a[0] - ea[0] * wa, a[1] - ea[1] * wa, bottomA], [b[0] - eb[0] * wb, b[1] - eb[1] * wb, bottomB], [b[0] + eb[0] * wb, b[1] + eb[1] * wb, bottomB]];
      const flankColor = flank || (color === ballast ? ballast : side);
      quad(...p, color);
      quad(q[3], q[2], q[1], q[0], side);
      for (let i = 0; i < 4; i++) {
        if (ribbon && (i === 0 && (joins.get(joinKey(ribbon.a))?.length || 0) > 1 || i === 2 && (joins.get(joinKey(ribbon.b))?.length || 0) > 1)) continue;
        const j = (i + 1) % 4;
        quad(p[i], q[i], q[j], p[j], flankColor);
      }
    }
    function rail(a, b, offset, top, scale, endTop = top) {
      const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      if (length < 1e-5) return;
      const ux = -dy / length, uy = dx / length, cx = ux * offset * scale, cy = uy * offset * scale, hx = ux * RAIL_W * scale / 2, hy = uy * RAIL_W * scale / 2;
      const base = top - RAIL_H * scale, endBase = endTop - RAIL_H * scale;
      const p = [[a[0] + cx + hx, a[1] + cy + hy, top], [a[0] + cx - hx, a[1] + cy - hy, top], [b[0] + cx - hx, b[1] + cy - hy, endTop], [b[0] + cx + hx, b[1] + cy + hy, endTop]];
      quad(...p, steel);
      quad(p[0], [p[0][0], p[0][1], base], [p[3][0], p[3][1], endBase], p[3], steel);
      quad(p[2], [p[2][0], p[2][1], endBase], [p[1][0], p[1][1], base], p[1], steel);
      stats.rails++;
    }
    function ties(a, b, top, scale) {
      const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      if (length < 1e-5) return;
      const tx = dx / length, ty = dy / length, ux = -ty, uy = tx, step = TIE_SPACING * scale;
      const half = TIE_LEN * scale / 2, hw = TIE_W * scale / 2;
      for (let d = step / 2; d < length; d += step) {
        const cx = a[0] + tx * d, cy = a[1] + ty * d, z = top + (b[2] - a[2]) * d / length + 0.01 * scale;
        quad(
          [cx + ux * half - tx * hw, cy + uy * half - ty * hw, z],
          [cx - ux * half - tx * hw, cy - uy * half - ty * hw, z],
          [cx - ux * half + tx * hw, cy - uy * half + ty * hw, z],
          [cx + ux * half + tx * hw, cy + uy * half + ty * hw, z],
          tie
        );
        stats.ties++;
      }
    }
    const CELL = 12, cell = /* @__PURE__ */ new Map(), mids = segments.map(({ a, b }) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    if (detail >= 1) segments.forEach((s, i) => {
      if (!s.bridge) return;
      const m = mids[i], k = Math.floor(m[0] / CELL) + "," + Math.floor(m[1] / CELL);
      if (!cell.has(k)) cell.set(k, []);
      cell.get(k).push(i);
    });
    function neighbor(i, sign, scale) {
      const s = segments[i], m = mids[i], dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], len = Math.hypot(dx, dy);
      if (len < 1e-5) return false;
      const tx = dx / len, ty = dy / len, ux = -ty, uy = tx, cx = Math.floor(m[0] / CELL), cy = Math.floor(m[1] / CELL);
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) for (const j of cell.get(gx + "," + gy) || []) {
        if (j === i) continue;
        const o = segments[j], n = mids[j], ex = n[0] - m[0], ey = n[1] - m[1], lat = (ex * ux + ey * uy) * sign, along = ex * tx + ey * ty;
        if (lat < 2 * scale || lat > NEIGHBOR_M * scale || Math.abs(along) > 10 * scale) continue;
        const odx = o.b[0] - o.a[0], ody = o.b[1] - o.a[1], ol = Math.hypot(odx, ody);
        if (ol < 1e-5 || Math.abs((odx * tx + ody * ty) / ol) < 0.9) continue;
        return true;
      }
      return false;
    }
    segments.forEach(({ a, b, groundA, groundB, bridge, transition = false }, i) => {
      const scale = 1;
      const topA = [a[0], a[1], a[2] - DECK_DROP * scale], topB = [b[0], b[1], b[2] - DECK_DROP * scale];
      if (![...a, ...b, groundA, groundB, scale].every(Number.isFinite) || Math.min(topA[2] - groundA, topB[2] - groundB) < 0.05 * scale) return;
      const railLift = Math.max(0, Math.min(a[2] - groundA, b[2] - groundB));
      if (bridge || !transition && railLift >= VIADUCT_LIFT_M * scale) {
        prism(topA, topB, DECK_W * scale, Math.max(groundA - 0.3 * scale, topA[2] - GIRDER_DEPTH * scale), Math.max(groundB - 0.3 * scale, topB[2] - GIRDER_DEPTH * scale), deck, GIRDER_BOTTOM_W * scale, null, { a, b });
        stats.decks++;
        if (detail >= 1) {
          const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
          if (len > 1e-5) {
            const ux = -dy / len, uy = dx / len, e = (DECK_W - PARAPET_W) / 2 * scale;
            for (const sign of [1, -1]) {
              if (neighbor(i, sign, scale)) continue;
              prism([a[0] + ux * e * sign, a[1] + uy * e * sign, topA[2] + PARAPET_H * scale], [b[0] + ux * e * sign, b[1] + uy * e * sign, topB[2] + PARAPET_H * scale], PARAPET_W * scale, topA[2], topB[2], parapet);
              stats.parapets++;
            }
          }
        }
      } else if (track) {
        const widthAt = (top, ground) => Math.min(style.max * scale, style.bottom * scale + 2 * style.slope * Math.max(0, top - ground)), bottomW = widthAt(topA[2], groundA);
        prism(topA, topB, style.top * scale, transition ? Math.max(groundA - 0.3 * scale, topA[2] - 1.15 * scale) : groundA - 0.3 * scale, transition ? Math.max(groundB - 0.3 * scale, topB[2] - 1.15 * scale) : groundB - 0.3 * scale, ballast, transition ? style.bottom * scale : bottomW, bank, { a, b, bottomEnd: transition ? style.bottom * scale : widthAt(topB[2], groundB) });
        stats.beds++;
      }
      if (track && detail >= 2) ties(topA, topB, topA[2], scale);
      if (track && detail >= 1) {
        const top = a[2] - (detail >= 2 ? 0.15 * scale : 0.2 * scale);
        rail(topA, topB, GAUGE / 2, top, scale, top + b[2] - a[2]);
        rail(topA, topB, -GAUGE / 2, top, scale, top + b[2] - a[2]);
      }
    });
    function portal({ p, angle, ground, halfWidth = BORE_R, spring = 2.8, grade = 0, members = [], system }) {
      const scale = 1;
      if (![...p, angle, scale, halfWidth, spring].every(Number.isFinite)) return;
      const tx = Math.cos(angle), ty = Math.sin(angle), ux = -ty, uy = tx, outer = halfWidth + 2, top = spring + BORE_R + 1.3;
      const at = (u, z, d = 0) => [p[0] + (ux * u + tx * d) * scale, p[1] + (uy * u + ty * d) * scale, p[2] + (z + grade * d) * scale];
      const samples = (ground || []).map((z) => Number.isFinite(z) ? (z - p[2]) / scale : null), finite = samples.filter((z) => z !== null);
      const bottom = (u) => {
        if (samples.length < 2 || !finite.length) return BORE_FLOOR;
        const t = Math.max(0, Math.min(1, (u / (outer + 2) + 1) / 2)) * (samples.length - 1), i = Math.min(samples.length - 2, Math.floor(t)), f = t - i;
        const g = (samples[i] ?? finite[0]) * (1 - f) + (samples[i + 1] ?? finite.at(-1)) * f;
        return Math.max(-PORTAL_DROP_MAX, Math.min(BORE_FLOOR, g - PORTAL_EMBED));
      };
      const block = (u0, u1, z0, z1, d0, d1, c) => {
        const a = at(u0, z0, d0), b = at(u1, z0, d0), c1 = at(u1, z1, d0), d = at(u0, z1, d0), e = at(u0, z0, d1), f = at(u1, z0, d1), g = at(u1, z1, d1), h = at(u0, z1, d1);
        quad(a, b, c1, d, c);
        quad(f, e, h, g, c);
        quad(d, c1, g, h, c);
        quad(a, e, f, b, c);
        quad(a, d, h, e, c);
        quad(b, f, g, c1, c);
      };
      const pale = new THREE.Color("#c6c8bd"), trim = new THREE.Color("#e1decd"), joint = new THREE.Color("#89948c"), dark = new THREE.Color("#243237");
      for (const sign of [-1, 1]) {
        const u = sign * halfWidth, v = sign * outer, b0 = bottom(u), b1 = bottom(v);
        quad(at(u, b0), at(v, b1), at(v, top), at(u, top), pale);
        quad(at(v, b1), at(v, b1, PORTAL_T), at(v, top, PORTAL_T), at(v, top), side);
        block(Math.min(u, v), Math.max(u, v), top - 0.22, top + 0.12, -0.18, PORTAL_T + 0.18, trim);
        block(sign > 0 ? u : u - RING, sign > 0 ? u + RING : u, BORE_FLOOR, spring, -0.28, 0.12, trim);
        quad(at(u, BORE_FLOOR), at(u, spring), at(u, spring, PORTAL_DEPTH), at(u, BORE_FLOOR, PORTAL_DEPTH), lining);
        block(sign > 0 ? u - 0.38 : u, sign > 0 ? u : u + 0.38, -0.9, -0.5, 0, PORTAL_DEPTH, side);
        const u1 = sign * (outer + 2), tip = 0.6, b = bottom(u1), th = 0.45 * sign;
        quad(at(v, b1), at(v, top - 0.22), at(u1, tip, -PORTAL_WING), at(u1, b, -PORTAL_WING), pale);
        quad(at(v + th, b1, 0), at(u1 + th, b, -PORTAL_WING), at(u1 + th, tip, -PORTAL_WING), at(v + th, top - 0.22, 0), side);
        quad(at(v, top - 0.22), at(v + th, top - 0.22), at(u1 + th, tip, -PORTAL_WING), at(u1, tip, -PORTAL_WING), trim);
        quad(at(u1, b, -PORTAL_WING), at(u1, tip, -PORTAL_WING), at(u1 + th, tip, -PORTAL_WING), at(u1 + th, b, -PORTAL_WING), side);
        if (detail >= 2) {
          for (let z = 1; z < top - 0.5; z += 1.5) block(Math.min(u + sign * 0.75, v), Math.max(u + sign * 0.75, v), z, z + 0.045, -0.012, 0.012, joint);
          portalEmission = 1;
          for (const d of [1.8, 5.8, 9.8]) block(sign > 0 ? u - 0.035 : u, sign > 0 ? u : u + 0.035, 2.2, 2.32, d, d + 1.1, new THREE.Color("#eee0ae"));
          portalEmission = 0;
        }
      }
      for (let i = 0; i < ARCH_SEGMENTS; i++) {
        const a = i * Math.PI / ARCH_SEGMENTS, b = (i + 1) * Math.PI / ARCH_SEGMENTS;
        const point = (t, ring = 0, d = 0) => at((halfWidth + ring) * Math.cos(t), spring + (BORE_R + ring) * Math.sin(t), d);
        quad(point(a), point(b), at(halfWidth * Math.cos(b), top), at(halfWidth * Math.cos(a), top), pale);
        quad(point(a, 0, -0.28), point(a, RING, -0.28), point(b, RING, -0.28), point(b, 0, -0.28), i % 2 ? trim : pale);
        quad(point(a, 0, -0.28), point(b, 0, -0.28), point(b, 0, 0.12), point(a, 0, 0.12), side);
        quad(point(a, RING, -0.28), point(a, RING, 0.12), point(b, RING, 0.12), point(b, RING, -0.28), trim);
        for (const [d0, d1, c] of [[0, 3, lining], [3, 7, dark], [7, PORTAL_DEPTH, dark]]) quad(point(a, 0, d0), point(b, 0, d0), point(b, 0, d1), point(a, 0, d1), c);
        quad(point(a, 0.75, PORTAL_T), point(a, 0.75, PORTAL_DEPTH), point(b, 0.75, PORTAL_DEPTH), point(b, 0.75, PORTAL_T), pale);
        quad(point(a, 0, PORTAL_DEPTH), point(b, 0, PORTAL_DEPTH), point(b, 0.75, PORTAL_DEPTH), point(a, 0.75, PORTAL_DEPTH), side);
      }
      quad(at(-halfWidth, top), at(halfWidth, top), at(halfWidth, top, PORTAL_T), at(-halfWidth, top, PORTAL_T), trim);
      {
        const keep = portalMasks;
        portalMasks = null;
        quad(at(-halfWidth, -0.66, -4), at(halfWidth, -0.66, -4), at(halfWidth, -0.66), at(-halfWidth, -0.66), ballast);
        quad(at(-halfWidth, BORE_FLOOR, PORTAL_DEPTH), at(halfWidth, BORE_FLOOR, PORTAL_DEPTH), at(halfWidth, spring + BORE_R + 0.75, PORTAL_DEPTH), at(-halfWidth, spring + BORE_R + 0.75, PORTAL_DEPTH), dark);
        portalMasks = keep;
      }
      quad(at(-halfWidth, BORE_FLOOR), at(halfWidth, BORE_FLOOR), at(halfWidth, BORE_FLOOR, PORTAL_DEPTH), at(-halfWidth, BORE_FLOOR, PORTAL_DEPTH), lining);
      const base = Math.min(bottom(-halfWidth), bottom(halfWidth));
      if (base < BORE_FLOOR - 0.05) block(-halfWidth, halfWidth, base, BORE_FLOOR, 0, PORTAL_T, side);
      for (const member of members) for (let i = 1; i < (member.samples?.length || 0); i++) {
        const a = member.samples[i - 1], b = member.samples[i], k = member.scale || scale, aa = [a[0], a[1], a[2] - DECK_DROP * k], bb = [b[0], b[1], b[2] - DECK_DROP * k];
        prism(aa, bb, style.top * k, a[2] - 0.95 * k, b[2] - 0.95 * k, ballast);
        if (track) for (const offset of [-GAUGE / 2, GAUGE / 2]) rail(aa, bb, offset, a[2] - 0.15 * k, k, b[2] - 0.15 * k);
        if (track && detail >= 2) ties(aa, bb, aa[2], k);
      }
      stats.portals++;
      stats.portalTracks += members.length || 1;
      stats.portalSamples.push({ p, angle, scale, halfWidth, spring, grade, system, tracks: members.length || 1, coordinate: members[0]?.coordinate });
    }
    if (detail >= 1) {
      const masks = portalClearanceVolumes(portals);
      for (const item of portals) {
        const reach = (item.halfWidth + PORTAL_DEPTH + PORTAL_WING + 6) * item.scale;
        portalMasks = masks.filter((m) => m.box[0] < item.p[0] + reach && m.box[3] > item.p[0] - reach && m.box[1] < item.p[1] + reach && m.box[4] > item.p[1] - reach);
        portal(item);
      }
      portalMasks = null;
    }
    for (const { p, ground, angle, coordinate, railHeightM, groundM } of piers) {
      const scale = 1;
      const girderBottom = p[2] - (DECK_DROP + GIRDER_DEPTH) * scale, top = detail >= 1 ? girderBottom - CAP_DEPTH * scale : girderBottom;
      if (![...p, ground, angle, scale].every(Number.isFinite) || top - ground < 0.3 * scale) continue;
      const dx = Math.cos(angle), dy = Math.sin(angle);
      if (detail >= 1) {
        const h2 = CAP_ALONG / 2 * scale;
        prism([p[0] - dx * h2, p[1] - dy * h2, girderBottom], [p[0] + dx * h2, p[1] + dy * h2, girderBottom], CAP_ACROSS * scale, top, top, pierColor, CAP_ACROSS * scale, pierSide);
        stats.caps++;
      }
      const h = PIER_ALONG / 2 * scale;
      prism([p[0] - dx * h, p[1] - dy * h, top], [p[0] + dx * h, p[1] + dy * h, top], PIER_ACROSS * scale, ground - 0.5 * scale, ground - 0.5 * scale, pierColor, PIER_ACROSS * scale, pierSide);
      stats.piers++;
      if (stats.samples.length < 60) stats.samples.push({ coordinate, railHeightM, groundM, topM: railHeightM - (DECK_DROP + GIRDER_DEPTH) - (detail >= 1 ? CAP_DEPTH : 0), baseM: groundM - 0.5 });
    }
    const origin = segments[0]?.a || portals[0]?.p || piers[0]?.p || [0, 0, 0];
    const grainX = Math.floor(origin[0] / 64) * 64, grainY = Math.floor(origin[1] / 64) * 64, bedUvs = [];
    for (let i = 0; i < positions.length; i += 3) bedUvs.push(positions[i] - grainX, positions[i + 1] - grainY);
    for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) positions[i + k] -= origin[k];
    mesh.position.fromArray(origin);
    geometry.dispose();
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute("railGlow", new THREE.Float32BufferAttribute(glows, 1));
    geometry.setAttribute("railBedUv", new THREE.Float32BufferAttribute(bedUvs, 2));
    geometry.setAttribute("railBedSurface", new THREE.Float32BufferAttribute(bedSurfaces, 1));
    geometry.computeVertexNormals();
    mesh.geometry = geometry;
    stats.vertices = positions.length / 3;
    stats.buildMs = performance.now() - started;
  }
  return { stats, set, setBedStyle(value) {
    if (!Object.hasOwn(bedStyles, value)) throw new RangeError("未知道床樣式：" + value);
    if (value === bedStyle) return;
    bedStyle = value;
    stats.bedStyle = value;
    gravelAmount.value = value === "gravel" ? 1 : 0;
    if (lastSet) set(...lastSet);
  }, setVisible(visible) {
    mesh.visible = visible;
  }, destroy() {
    lastSet = null;
    scene.remove(mesh);
    geometry.dispose();
    material.dispose();
  } };
}
