import * as THREE from "../vendor/three.module.js";
import { TW2 } from "./tw2.mjs";
import { MOTO_COLORS } from "./street-objects.mjs";
function unitBox() {
  const F = [
    [[-0.5, 1, -0.5], [-0.5, 1, 0.5], [0.5, 1, 0.5], [0.5, 1, -0.5]],
    [[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5]],
    [[0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, -0.5], [0.5, 1, -0.5]],
    [[0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5]],
    [[-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0.5], [-0.5, 1, -0.5]]
  ];
  const pos = [], idx = [];
  F.forEach((f, k) => {
    for (const p of f) pos.push(...p);
    idx.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const poolMaterial = (uNight, fogDensity) => new THREE.ShaderMaterial({
  uniforms: { uNight, uK: { value: TW2.num("pool", 0.22) }, uFog: { value: fogDensity } },
  transparent: true,
  depthWrite: false,
  depthTest: true,
  blending: THREE.AdditiveBlending,
  fog: false,
  vertexShader: `varying vec2 vQ; varying vec3 vC; varying float vF; uniform float uFog;
void main(){ vQ = uv * 2. - 1.; vC = instanceColor; vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.); float d = -mv.z; vF = exp(-d * d * uFog * uFog); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uNight; uniform float uK; varying vec2 vQ; varying vec3 vC; varying float vF;
void main(){ float r2 = dot(vQ, vQ); if (r2 > 1.) discard; float a = (1. - r2); a *= a;
  gl_FragColor = vec4(vC * a * uK * uNight * vF, 1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`
});
export function createStreet({ coarse, LIMIT, lampUniform, fogDensity, treeSlots }) {
  const box = unitBox(), mat = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.25 }), glowMat = new THREE.MeshBasicMaterial({ toneMapped: true });
  const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat = TW2.pole && lampUniform ? poolMaterial(lampUniform, fogDensity) : null;
  const R = { pole: TW2.num("poler", coarse ? 150 : 220), sig: TW2.num("sigr", coarse ? 220 : 320), moto: TW2.num("motor", coarse ? 100 : 130), pool: TW2.num("poolr", coarse ? 300 : 450), mt: TW2.num("mtr", coarse ? 120 : 110), mt2: TW2.num("mtr2", coarse ? 240 : 240) };
  const st = { e: 1e12, n: 1e12, key: "", meshes: [], anchor: null };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  const drop = () => {
    for (const m of st.meshes) {
      m.parent?.remove(m);
      m.dispose();
    }
    st.meshes = [];
  };
  const put = (list, x, y, z, ux, uy, w, h, l, rgb) => list.push(x, y, z, Math.atan2(ux, -uy), w, h, l, rgb[0], rgb[1], rgb[2]);
  const build = (list, geo, material, cast) => {
    const n = list.length / 10;
    if (!n) return null;
    const m = new THREE.InstancedMesh(geo, material, n);
    for (let i = 0; i < n; i++) {
      const o = i * 10;
      q.setFromAxisAngle(up, list[o + 3]);
      m4.compose(v.set(list[o], list[o + 2], -list[o + 1]), q, sc.set(list[o + 4], list[o + 5], list[o + 6]));
      m.setMatrixAt(i, m4);
      m.setColorAt(i, col.setRGB(list[o + 7], list[o + 8], list[o + 9]));
    }
    m.castShadow = cast;
    m.receiveShadow = !!cast;
    m.frustumCulled = false;
    return m;
  };
  const GRAY = [0.42, 0.43, 0.44], HEAD = [0.5, 0.5, 0.5], SIGP = [0.36, 0.38, 0.37], BOXC = [0.05, 0.05, 0.05];
  const LIT = [[2.2, 0.12, 0.06], [2, 1.2, 0.05], [0.08, 1.9, 0.7]], DIM = [[0.09, 0.02, 0.02], [0.09, 0.07, 0.02], [0.02, 0.08, 0.05]];
  return {
    // tiles：ready 的圖磚；view：鏡頭目標（e, n）；每 0.25 秒呼叫一次
    update(tiles, view) {
      const e = view.e, n = view.n, ready = [...tiles].filter((t) => t.state === "ready"), Rmax = Math.max(R.pole, R.sig, R.moto, R.pool, R.mt);
      const key = ready.map((t) => t.id + (t.near?.street ? "s" : "") + (t.poles ? "p" : "") + (t.pools ? "q" : "")).join() + "@" + LIMIT.extraR;
      if (Math.hypot(e - st.e, n - st.n) < Math.min(R.pole, R.moto) / 4 && key === st.key) return false;
      const A = ready.find((t) => e >= t.e0 && e < t.e0 + 1280 && n >= t.n0 && n < t.n0 + 1280) || null;
      if (!A) return false;
      Object.assign(st, { e, n, key });
      drop();
      st.anchor = A;
      const boxes = [], glow = [], pools = [], rMoto = Math.min(R.moto, LIMIT.extraR > 0 ? LIMIT.extraR : 0);
      for (const t of ready) {
        const dx = t.e0 - A.e0, dy = t.n0 - A.n0, cx = e - t.e0, cy = n - t.n0;
        if (Math.max(Math.abs(cx - 640), Math.abs(cy - 640)) > 640 + Rmax) continue;
        const D = (x, y) => Math.hypot(x - cx, y - cy);
        if (t.poles) {
          const P = t.poles;
          for (let k = 0; k < P.length; k += 7) {
            const x = P[k], y = P[k + 1], ux = P[k + 2], uy = P[k + 3], H = P[k + 4], L = P[k + 5], z = P[k + 6], d = D(x, y);
            if (TW2.pole && d < R.pole) {
              const X = x + dx, Y = y + dy;
              put(boxes, X, Y, z, ux, uy, 0.2, H + 0.25, 0.2, GRAY);
              put(boxes, X + ux * (L + 0.3) / 2, Y + uy * (L + 0.3) / 2, z + H + 0.02, ux, uy, 0.16, 0.16, L + 0.3, HEAD);
            }
          }
        }
        if (poolMat && t.pools) {
          const P = t.pools, w = 2 * TW2.num("poolw", 10);
          for (let k = 0; k < P.length; k += 3) if (D(P[k], P[k + 1]) < R.pool) pools.push(P[k] + dx, P[k + 1] + dy, P[k + 2] + 0.38, 0, w, 1, w, 1, 0.68, 0.4);
        }
        const S = t.near?.street;
        if (!S || !t.near.group) continue;
        if (TW2.sig && S.sig) for (let k = 0; k < S.sig.length; k += 7) {
          const x = S.sig[k], y = S.sig[k + 1], z = S.sig[k + 2], fx = S.sig[k + 3], fy = S.sig[k + 4], L = S.sig[k + 5], lit = S.sig[k + 6];
          if (D(x, y) > R.sig) continue;
          const X = x + dx, Y = y + dy, ax = fy, ay = -fx;
          put(boxes, X, Y, z, ax, ay, 0.28, 6.6, 0.28, SIGP);
          put(boxes, X + ax * L / 2, Y + ay * L / 2, z + 6.1, ax, ay, 0.16, 0.16, L, SIGP);
          const hx = X + ax * (L - 1), hy = Y + ay * (L - 1);
          put(boxes, hx, hy, z + 5.55, ax, ay, 0.32, 0.5, 1.5, BOXC);
          for (let c = 0; c < 3; c++) {
            const o = (1 - c) * 0.46, px = hx + ax * o + fx * 0.17, py = hy + ay * o + fy * 0.17;
            put(glow, px, py, z + 5.66, ax, ay, 0.06, 0.28, 0.28, c === lit ? LIT[c] : DIM[c]);
          }
        }
        if (TW2.moto && S.moto && rMoto > 0) for (let k = 0; k < S.moto.length; k += 5) {
          const x = S.moto[k], y = S.moto[k + 1];
          if (D(x, y) > rMoto) continue;
          const z = S.moto[k + 2] + 0.3, a = S.moto[k + 3], c = MOTO_COLORS[S.moto[k + 4]] || MOTO_COLORS[0], hx = Math.cos(a), hy = Math.sin(a), X = x + dx, Y = y + dy;
          put(boxes, X, Y, z + 0.15, hx, hy, 0.6, 0.85, 1.75, c);
        }
      }
      const g = A.group, add = (m) => {
        if (m) {
          g.add(m);
          st.meshes.push(m);
        }
        return m;
      };
      add(build(boxes, box, mat, true));
      add(build(glow, box, glowMat, false));
      const p = add(build(pools, plane, poolMat, false));
      if (p) {
        p.renderOrder = 3;
        p.castShadow = p.receiveShadow = false;
      }
      if (TW2.mtree) {
        for (const t of ready) if (t.near?.treeMesh?.userData.mt) treeSlots(t, (x, y, k) => {
          const d = Math.hypot(x - (e - t.e0), y - (n - t.n0));
          return d < R.mt || d < R.mt2 && k % 2 === 0;
        });
      }
      return true;
    },
    setNight(on) {
      if (poolMat) poolMat.visible = on;
    },
    stat: () => ({ meshes: st.meshes.length, inst: st.meshes.map((m) => m.count) })
  };
}
