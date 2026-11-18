import * as THREE from "../vendor/three.module.js";
import { jget } from "./fetch-v.mjs";
const COLORS = [
  ["mrt", "文湖", "#C48C31"],
  ["mrt", "新北投", "#F48B9F"],
  ["mrt", "淡水信義", "#E3002C"],
  ["mrt", "信義線", "#E3002C"],
  ["mrt", "小碧潭", "#8CC8A0"],
  ["mrt", "松山新店", "#008659"],
  ["mrt", "中和新蘆", "#F8B61C"],
  ["mrt", "板南", "#0070BD"],
  ["mrt", "亞東醫院", "#0070BD"],
  ["mrt", "環狀", "#FFDB00"],
  ["mrt", "", "#0F9582"],
  ["krtc", "輕軌", "#77C043"],
  ["krtc", "紅線", "#E4002B"],
  ["krtc", "橘線", "#F8981D"],
  ["krtc", "", "#D62740"],
  ["tymc", "", "#8246AF"],
  ["ntalrt", "", "#9E925E"],
  ["ntdlrt", "", "#FF2A00"],
  ["sanying", "", "#79BCE8"],
  ["tmrt", "", "#79BB29"],
  ["thsr_sched", "", "#E85D0D"],
  ["tra_sched", "", "#2A62AD"],
  ["afr_sched", "", "#B03A2E"]
];
const colorCache = /* @__PURE__ */ new Map();
export function railColor(system, name = "") {
  const k = system + "|" + name;
  let c = colorCache.get(k);
  if (c) return c;
  const hit = COLORS.find(([s, n]) => s === system && name.includes(n)), col = new THREE.Color(hit ? hit[2] : "#56606C");
  colorCache.set(k, c = [col.r, col.g, col.b]);
  return c;
}
const BASE = { ug: true, ugA: 0.32, ugGhost: 0.3, ugCorePx: 5, surf: false, surfA: 1, surfGhost: 0, corePx: 3, worldM: 3, outPx: 0, dashPx: 0, far: false, band: false, fade: false };
const STYLES = {
  app: {},
  a: { surf: true, far: true },
  b: { surf: true, surfGhost: 0.45, ugA: 0.9, ugGhost: 0.45, ugCorePx: 3, dashPx: 16, far: true },
  c: { band: true },
  d: { surf: true, far: true, fade: true },
  e: { surf: true, surfGhost: 0.45, ugA: 0.9, ugGhost: 0.45, ugCorePx: 3.5, corePx: 3.5, dashPx: 16, outPx: 1.5, far: true }
};
export const FAR_FROM = 2600;
const VS = `
attribute vec3 aNext; attribute vec4 aInfo; attribute vec3 aCol;
uniform vec2 uRes; uniform float uPx, uCore, uUgCore, uWorld, uOut, uNearW;
varying vec3 vCol; varying float vKind, vAcross, vHalfCore, vHalfOut, vDash;
void main() {
  float side = aInfo.x, kind = aInfo.y, lift = aInfo.w;
  vec4 c0 = projectionMatrix * modelViewMatrix * vec4(position, 1.), c1 = projectionMatrix * modelViewMatrix * vec4(aNext, 1.);
  vCol = aCol; vKind = kind; vAcross = 0.; vHalfCore = 1.; vHalfOut = 1.; vDash = 0.;
  if (c0.w < uNearW || c1.w < uNearW) { gl_Position = c0; return; }   // 鏡頭後面的點不推寬（交給硬體裁切）
  vec2 s0 = c0.xy / c0.w * uRes * .5, s1 = c1.xy / c1.w * uRes * .5, d = s1 - s0; d = length(d) > 1e-4 ? normalize(d) : vec2(1., 0.);
  float mpp = c0.w / (projectionMatrix[1][1] * uRes.y * .5);   // 這一點每個畫面像素幾公尺
  float core = kind > 1.5 ? uUgCore * uPx : max(uCore * uPx, uWorld / mpp), hw = core * .5 + uOut * uPx + 1.;
  vAcross = side * hw; vHalfCore = core * .5; vHalfOut = core * .5 + uOut * uPx; vDash = aInfo.z / mpp / uPx;
  vec4 cd = lift != 0. ? projectionMatrix * modelViewMatrix * vec4(position + vec3(0., lift, 0.), 1.) : c0;   // 深度用抬高後那一點（地下段＝地面上 1 m：被地面以上的東西擋、不被地面擋）
  if (cd.w < uNearW) cd = c0;
  vec2 ndc = (s0 + vec2(-d.y, d.x) * side * hw) / (uRes * .5);
  gl_Position = vec4(ndc * cd.w, cd.z, cd.w);
}`;
const FS = `
uniform float uSurfA, uUgA, uOut, uDash; uniform vec3 uOutCol;
varying vec3 vCol; varying float vKind, vAcross, vHalfCore, vHalfOut, vDash;
void main() {
  float a = vKind > 1.5 ? uUgA : uSurfA; if (a <= 0.) discard;
  float d = abs(vAcross); a *= 1. - smoothstep(vHalfOut - .5, vHalfOut + .5, d);
  vec3 c = vCol; if (uOut > 0.) c = mix(c, uOutCol, smoothstep(vHalfCore - .5, vHalfCore + .5, d));
  if (uDash > 0. && vKind > 1.5 && fract(vDash / uDash) > .62) a *= .22;
  if (a <= .003) discard;
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;
function ribbon(lines) {
  let nv = 0, ni = 0;
  for (const l of lines) {
    nv += l.pts.length * 2;
    ni += (l.pts.length - 1) * 6;
  }
  const pos = new Float32Array(nv * 3), nxt = new Float32Array(nv * 3), info = new Float32Array(nv * 4), col = new Float32Array(nv * 3), idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v = 0, k = 0;
  for (const l of lines) {
    const P = l.pts, m = P.length;
    for (let i = 0; i < m; i++) {
      const p = P[i], a = P[Math.max(0, i - 1)], b = P[Math.min(m - 1, i + 1)], q = [p[0] + (b[0] - a[0]) * 0.5, p[1] + (b[1] - a[1]) * 0.5, p[2] + (b[2] - a[2]) * 0.5];
      for (const side of [-1, 1]) {
        pos.set(p, v * 3);
        nxt.set(q, v * 3);
        info.set([side, l.kind, l.s[i], l.lift ? l.lift[i] : 0], v * 4);
        col.set(l.col, v * 3);
        v++;
      }
      if (i > 0) {
        const c = v - 4;
        idx.set([c, c + 1, c + 3, c, c + 3, c + 2], k);
        k += 6;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aNext", new THREE.BufferAttribute(nxt, 3));
  g.setAttribute("aInfo", new THREE.BufferAttribute(info, 4));
  g.setAttribute("aCol", new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.userData.verts = nv;
  return g;
}
export function createRailHl({ params, DATA, index, TILE_M, scene, origin, shared, jv }) {
  const code = params.get("railhl");
  if (!code || !STYLES[code]) return null;
  const S = { ...BASE, ...STYLES[code] };
  const U = { uRes: { value: new THREE.Vector2(1, 1) }, uPx: { value: 1 }, uNearW: { value: 1 } };
  const mat = ({ surfA, ugA, depthFunc, depthTest = true, far: far2 = false }) => new THREE.ShaderMaterial({
    uniforms: {
      ...U,
      uCore: { value: far2 ? 2.5 : S.corePx },
      uUgCore: { value: far2 ? 2.5 : S.ugCorePx },
      uWorld: { value: far2 ? 0 : S.worldM },
      uOut: { value: far2 ? S.outPx * 0.8 : S.outPx },
      uSurfA: { value: surfA },
      uUgA: { value: ugA },
      uDash: { value: S.dashPx },
      uOutCol: { value: far2 ? new THREE.Color(0.01, 0.012, 0.02) : new THREE.Color(1, 1, 1) }
    },
    vertexShader: VS,
    fragmentShader: FS,
    transparent: true,
    depthWrite: false,
    depthTest,
    depthFunc,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false
  });
  const visMat = mat({ surfA: S.surf ? S.surfA : 0, ugA: S.ug ? S.ugA : 0, depthFunc: THREE.LessEqualDepth });
  const ghostOn = S.surf && S.surfGhost > 0 || S.ug && S.ugGhost > 0;
  const ghostMat = ghostOn ? mat({ surfA: S.surf ? S.surfA * S.surfGhost : 0, ugA: S.ug ? S.ugA * S.ugGhost : 0, depthFunc: THREE.GreaterDepth }) : null;
  const farMat = S.far ? mat({ surfA: 0.95, ugA: 0.95 * (S.dashPx ? 1 : 0.55), depthFunc: THREE.AlwaysDepth, depthTest: false, far: true }) : null;
  const mats = [visMat, ghostMat, farMat].filter(Boolean);
  const nearMeshes = /* @__PURE__ */ new Set(), stat = { tiles: 0, verts: 0, farVerts: 0, farTiles: 0 };
  function tileLines(t, rails, local) {
    const lines = [];
    for (const tr of rails.tracks) {
      const ug = tr.kind === 2;
      if (ug ? !S.ug : !S.surf) continue;
      if (code !== "app" && tr.service) continue;
      const m = tr.p.length / 4, pts = [], s = [], lift = [];
      let acc = 0;
      for (let i = 0; i < m; i++) {
        const x = tr.p[i * 4], y = tr.p[i * 4 + 1], z = tr.p[i * 4 + 2];
        if (i) acc += Math.hypot(x - tr.p[i * 4 - 4], y - tr.p[i * 4 - 3]);
        pts.push([x, z + 0.3, -y]);
        s.push(acc);
        lift.push(ug ? Math.max(1, local(x, y) + 1 - z) : 1.5);
      }
      if (m > 1) lines.push({ pts, s, lift, kind: tr.kind, col: railColor(tr.system, tr.name) });
    }
    if (!lines.length) return;
    const g = ribbon(lines), add = (mt) => {
      const o = new THREE.Mesh(g, mt);
      o.renderOrder = 3;
      o.castShadow = o.receiveShadow = false;
      t.group.add(o);
      nearMeshes.add(o);
      return o;
    };
    t.hl = [add(visMat), ghostMat && add(ghostMat)].filter(Boolean);
    stat.tiles++;
    stat.verts += g.userData.verts;
    g.addEventListener("dispose", () => {
      if (g.userData.gone) return;
      g.userData.gone = true;
      stat.tiles--;
      stat.verts -= g.userData.verts;
      for (const o of t.hl) nearMeshes.delete(o);
    });
  }
  const far = { cache: /* @__PURE__ */ new Map(), loading: 0, queue: [], mesh: null, dirty: false, key: "", lastBuild: 0, anchor: null };
  const trackTiles = Object.entries(index.tiles).filter(([, v]) => {
    const m = v.counts?.trackM;
    return m && m.surface + m.bridge + m.tunnel > 0;
  }).map(([id]) => {
    const [i, j] = id.slice(1).split("_N").map(Number);
    return { id, i, j };
  });
  async function farFetch(id, i, j) {
    try {
      const r = await jget(DATA + id + "/rails.json", jv?.(id));
      const rails = await r.json(), out = [];
      for (const tr of rails.tracks) {
        if (tr.service) continue;
        const m = tr.p.length / 4, e0 = i * TILE_M, n0 = j * TILE_M, pts = [], s = [];
        let acc = 0, last = -1e9;
        for (let k = 0; k < m; k++) {
          const x = tr.p[k * 4], y = tr.p[k * 4 + 1];
          if (k) acc += Math.hypot(x - tr.p[k * 4 - 4], y - tr.p[k * 4 - 3]);
          if (k === 0 || k === m - 1 || acc - last >= 30) {
            pts.push([e0 + x, n0 + y, tr.p[k * 4 + 2]]);
            s.push(acc);
            last = acc;
          }
        }
        if (pts.length > 1) out.push({ pts, s, kind: tr.kind, col: railColor(tr.system, tr.name) });
      }
      far.cache.set(id, out);
    } catch {
      far.cache.set(id, []);
    } finally {
      far.loading--;
      far.dirty = true;
    }
  }
  function farSchedule(view) {
    const R = Math.min(7e4, Math.max(9e3, view.dist * 2.2)), want = [];
    for (const t of trackTiles) {
      const d = Math.hypot(Math.max(t.i * TILE_M - view.e, 0, view.e - t.i * TILE_M - TILE_M), Math.max(t.j * TILE_M - view.n, 0, view.n - t.j * TILE_M - TILE_M));
      if (d <= R) want.push([d, t]);
    }
    want.sort((a, b) => a[0] - b[0]);
    far.want = new Set(want.map((w) => w[1].id));
    for (const [, t] of want) {
      if (far.cache.has(t.id) || far.cache.get(t.id) === null) continue;
      if (far.loading >= 8) break;
      far.cache.set(t.id, null);
      far.loading++;
      farFetch(t.id, t.i, t.j);
    }
    far.missing = want.filter(([, t]) => !far.cache.get(t.id)).length;
    const key = [...far.want].filter((id) => far.cache.get(id)).join();
    if ((far.dirty || key !== far.key) && (performance.now() - far.lastBuild > 400 || !far.missing)) {
      far.dirty = false;
      far.key = key;
      far.lastBuild = performance.now();
      farBuild();
    }
  }
  function farBuild() {
    if (!far.anchor) far.anchor = { e: origin.e, n: origin.n };
    const A = far.anchor, lines = [];
    for (const id of far.want) {
      const L = far.cache.get(id);
      if (!L) continue;
      for (const l of L) lines.push({ pts: l.pts.map((p) => [p[0] - A.e, p[2] + 0.3, -(p[1] - A.n)]), s: l.s, kind: l.kind, col: l.col });
    }
    if (far.mesh) {
      scene.remove(far.mesh);
      far.mesh.geometry.dispose();
      far.mesh = null;
    }
    stat.farVerts = 0;
    stat.farTiles = [...far.want].filter((id) => far.cache.get(id)?.length).length;
    if (!lines.length) return;
    far.mesh = new THREE.Mesh(ribbon(lines), farMat);
    far.mesh.renderOrder = 20;
    far.mesh.frustumCulled = false;
    scene.add(far.mesh);
    stat.farVerts = far.mesh.geometry.userData.verts;
  }
  const band = S.band ? {
    SEC: [[-2.6, -0.3], [-1.2, -0.17], [1.2, -0.17], [2.6, -0.3]],
    // 寬度照舊 ±2.6；平的那段 ±1.7 → ±1.2、坡腳 −.62 → −.3（橋面頂在 −.35、護欄在 ±2.3：坡面要高過橋面才看得到），|u| > 1.25 塗路線色
    color: (tr) => railColor(tr.system, tr.name),
    patch(m) {
      const ob = m.onBeforeCompile, key = m.customProgramCacheKey;
      m.onBeforeCompile = (sh, r) => {
        if (ob) ob.call(m, sh, r);
        sh.uniforms.uNight = shared.uNight;
        const need = (src, a, b) => {
          if (!src.includes(a)) throw Error("軌道帶著色器對不上（第 158 包）：" + a.slice(0, 40));
          return src.replace(a, b);
        };
        sh.vertexShader = need(sh.vertexShader, "attribute vec3 aRail; varying vec3 vRail3;", "attribute vec3 aRail; varying vec3 vRail3; attribute vec3 aRCol; varying vec3 vRCol;");
        sh.vertexShader = need(sh.vertexShader, "vRail3 = aRail;", "vRail3 = aRail; vRCol = aRCol;");
        sh.fragmentShader = need(sh.fragmentShader, "varying vec3 vRail3;", "varying vec3 vRail3; varying vec3 vRCol; uniform float uNight;");
        sh.fragmentShader = need(sh.fragmentShader, "  diffuseColor.rgb = rc;", `  float hlEdge = smoothstep(1.2 - px, 1.3 + px, abs(ru));
  rc = mix(rc * 1.55 + .04, vRCol, hlEdge); rRough = mix(rRough, .8, hlEdge); rMetal *= 1. - hlEdge;
  diffuseColor.rgb = rc;`);
        sh.fragmentShader = need(sh.fragmentShader, "#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n  totalEmissiveRadiance += vRCol * hlEdge * mix(.35, .9, uNight);");
      };
      m.customProgramCacheKey = () => (key ? key.call(m) : "") + "-hl158c";
      m.needsUpdate = true;
    }
  } : null;
  const fade = S.fade ? (m) => {
    const ob = m.onBeforeCompile, key = m.customProgramCacheKey;
    m.onBeforeCompile = (sh, r) => {
      if (ob) ob.call(m, sh, r);
      sh.uniforms.uHlNight = shared.uNight;
      const a = "#include <tonemapping_fragment>";
      if (!sh.fragmentShader.includes(a)) throw Error("建物壓淡對不上（第 158 包）");
      sh.fragmentShader = sh.fragmentShader.replace("void main() {", "uniform float uHlNight;\nvoid main() {").replace(a, `{ vec3 hc = gl_FragColor.rgb; float hl = dot(hc, vec3(.2126, .7152, .0722));
  hc = mix(hc, vec3(hl), .75); hc = mix(hc, vec3(mix(.42, .012, uHlNight)), mix(.45, .6, uHlNight)); gl_FragColor.rgb = hc; }
${a}`);
    };
    m.customProgramCacheKey = () => (key ? key.call(m) : "") + "-hl158d";
    m.needsUpdate = true;
  } : null;
  const size = new THREE.Vector2(), outDay = new THREE.Color(1, 1, 1), outNight = new THREE.Color(0.01, 0.012, 0.02);
  function update(renderer, camera, view, night) {
    renderer.getDrawingBufferSize(size);
    U.uRes.value.copy(size);
    U.uPx.value = renderer.getPixelRatio();
    U.uNearW.value = camera.near;
    const farOn = S.far && view.dist >= FAR_FROM;
    for (const o of nearMeshes) o.visible = !farOn;
    for (const m of mats) if (m !== farMat) m.uniforms.uOutCol.value.copy(outDay).lerp(outNight, night);
    if (farOn) {
      farSchedule(view);
    } else far.missing = 0;
    if (far.mesh) {
      far.mesh.visible = farOn;
      far.mesh.position.set(far.anchor.e - origin.e, 0, -(far.anchor.n - origin.n));
    }
  }
  return { code, S, band, fade, tileLines, update, pending: () => far.loading + (far.missing || 0), stat };
}
