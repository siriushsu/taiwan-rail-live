// 機車（速克達）＋騎士：光華街涵洞景用。資產 garage-scooter-v1 是 Blender 做的（scripts/blender/scooter-20260930/build_scooter.py）；
// 騎士沿用 garage-people-v1 的零件（頭、身、手臂、拳、腿、鞋），坐姿在這裡自己算矩陣（garage-people.js 的 sit 是直腿，跨不上踏板）。
// 座標＝人的座標系（面向 +X、左手 +Y、地面 z＝0、單位公尺）；整個 group 乘 scale（每公尺幾個場景單位，例如 duoliang.js 的 UNIT_PER_M[車款]）後才放進場景。
// 畫法：不動的東西（車殼、座墊、騎士、安全帽）在建構時烤成「一個」帶頂點色的網格；兩個輪子是一個 InstancedMesh（一份幾何、兩個實例）；
// 前燈、尾燈各自一個網格（夜間才自發光）。所以整組（機車＋騎士＋安全帽）是 4 次 draw call。
import * as THREE from './vendor/three.module.js';
export const SCOOTER_URL = new URL('./assets/garage-scooter-v1/scooter.json', import.meta.url);
// 讀資產（瀏覽器用；garage-model.js 的 loadGarageParts 會驗大小與 sha256）。
export async function loadScooterKit(signal) {
  const {loadGarageParts} = await import('./garage-model.js?revision=doors-0924');
  return loadGarageParts(SCOOTER_URL, signal);
}
const THIGH_R = 1.2, LEG = .8; // 人零件庫的腿零件長度（髖到腳踝）
const DEFAULT_LOOK = {body: '#c9463d', helmet: '#e7e3d8', top: '#5c8f9b', bottom: '#384d5b', skin: '#e0b088', torso: 'jacket'};
const tmpV = new THREE.Vector3(), tmpN = new THREE.Vector3(), tmpNM = new THREE.Matrix3();
function bake(acc, geometry, matrix, color) {
  const pos = geometry.getAttribute('position'), nor = geometry.getAttribute('normal');
  tmpNM.getNormalMatrix(matrix);
  for (let i = 0; i < pos.count; i++) {
    tmpV.fromBufferAttribute(pos, i).applyMatrix4(matrix); tmpN.fromBufferAttribute(nor, i).applyMatrix3(tmpNM).normalize();
    acc.p.push(tmpV.x, tmpV.y, tmpV.z); acc.n.push(tmpN.x, tmpN.y, tmpN.z); acc.c.push(color.r, color.g, color.b);
  }
}
const toGeometry = acc => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(acc.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(acc.n, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(acc.c, 3)); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
};
const partColor = (part, look) => part.tint === 'fixed' ? new THREE.Color().setRGB(part.color[0], part.color[1], part.color[2]) : new THREE.Color(look[part.tint] ?? DEFAULT_LOOK[part.tint]);
const rotateTo = (from, to) => new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(from, to));
const DOWN = new THREE.Vector3(0, 0, -1);

// 騎士各部位的世界矩陣（機車座標系、公尺）。rig.rider：髖 hip、上身前傾 lean、頭回正 headPitch、大腿長 thigh、外八 splay、小腿後傾 shinBack。
// 上身（頭、帽、身、臂）繞髖軸整個前傾；手臂從肩膀瞄準握把（拳心 ＝ 肩＋.49 m 沿臂方向）；腿是同一個腿零件縮放成大腿＋小腿（兩節在膝蓋相接），
// 大腿下傾角由「腳底剛好踩在踏墊面」解出來；鞋不轉、平放在踏墊上。回傳 [{name, matrix, tint, hand?}]。
export function riderPose(peopleKit, rig, look = {}) {
  const R = rig.rider, [hx, , hz] = R.hip, pk = n => peopleKit.parts.get(n), hipP = peopleKit.rig.hip, out = [];
  const W = new THREE.Matrix4().makeTranslation(hx, 0, hz).multiply(new THREE.Matrix4().makeRotationY(R.lean)).multiply(new THREE.Matrix4().makeTranslation(0, 0, -hipP[2]));
  const at = (M, p, y = p[1]) => M.clone().multiply(new THREE.Matrix4().makeTranslation(p[0], y, p[2]));
  const head = at(W, pk('head').pivot).multiply(new THREE.Matrix4().makeRotationY(R.headPitch));
  out.push({name: 'head', matrix: head, tint: 'skin'});
  out.push({name: 'torso-' + (look.torso ?? DEFAULT_LOOK.torso), matrix: W.clone(), tint: 'top'});
  for (const c of [0, 1]) {
    const sgn = c ? -1 : 1, ap = pk('arm').pivot, S = new THREE.Vector3(0, sgn * ap[1], ap[2]).applyMatrix4(W);
    const G = new THREE.Vector3(rig.grip[0], sgn * rig.grip[1], rig.grip[2]), u = G.clone().sub(S).normalize();
    const M = new THREE.Matrix4().makeTranslation(S.x, S.y, S.z).multiply(rotateTo(DOWN, u));
    out.push({name: 'arm', copy: c, matrix: M, tint: 'top'}, {name: 'hand', copy: c, matrix: M.clone(), tint: 'skin'});
    // 腿：髖 H；大腿方向＝(cosα·cosγ, sgn·cosα·sinγ, −sinα)；小腿往後傾 β 垂到腳踝；腳踝離踏墊 .065（鞋底到腿零件下端）
    const H = new THREE.Vector3(hx, sgn * pk('leg').pivot[1], hz), Lt = R.thigh, Ls = LEG - Lt, be = R.shinBack, ga = R.splay;
    const az = rig.floorTop + .065, sa = Math.min(1, Math.max(-1, (hz - az - Ls * Math.cos(be)) / Lt)), al = Math.asin(sa);
    const dT = new THREE.Vector3(Math.cos(al) * Math.cos(ga), sgn * Math.cos(al) * Math.sin(ga), -sa), K = H.clone().addScaledVector(dT, Lt);
    const dS = new THREE.Vector3(-Math.sin(be), 0, -Math.cos(be)), A = K.clone().addScaledVector(dS, Ls);
    const scaleZ = (k, r = 1) => new THREE.Matrix4().makeScale(r, r, k);   // 沿腿軸縮到 k 倍、粗細 r 倍（大腿 1.2 倍，比小腿粗）
    out.push({name: 'leg', copy: c, part: 'thigh', matrix: new THREE.Matrix4().makeTranslation(H.x, H.y, H.z).multiply(rotateTo(DOWN, dT)).multiply(scaleZ(Lt / LEG, THIGH_R)), tint: 'bottom'});
    out.push({name: 'leg', copy: c, part: 'shin', matrix: new THREE.Matrix4().makeTranslation(K.x, K.y, K.z).multiply(rotateTo(DOWN, dS)).multiply(scaleZ(Ls / LEG)), tint: 'bottom'});
    out.push({name: 'shoe', copy: c, matrix: new THREE.Matrix4().makeTranslation(A.x, A.y, A.z + LEG), tint: 'fixed', joints: {H, K, A}});
  }
  if (look.hair && look.hair !== 'none' && look.helmet === false) out.push({name: 'hair-' + look.hair, matrix: head.clone(), tint: 'hair'});
  return out;
}

// createScooterRider({peopleKit, scooterKit, scale, look}) → {group, update(dt, speed), setNight(on), dims, state, rig, inspect(), dispose()}
//   peopleKit／scooterKit：buildGarageParts／loadGarageParts 的回傳（garage-people-v1、garage-scooter-v1）；peopleKit 給 null＝空車（不畫騎士與安全帽）。
//   scale：每公尺幾個場景單位（group 整個乘上去；輪子轉速也依它換算）；look：{body 車漆色, helmet 帽色, top 上衣, bottom 褲, skin 膚色, torso 'shirt'|'jacket'|'hoodie'}。
//   update(dt, speed)：dt 秒、speed＝場景單位／秒（車往 +X 走的速度；輪子轉角＝走過距離／輪半徑；車本身怎麼移動由呼叫端擺 group.position）。
//   setNight(true)：前大燈、尾燈自發光。inspect()：驗收用，回傳烤好的各部位 [{name, kind, copy, geometry, matrix}]（機車座標系、公尺）。
export function createScooterRider({peopleKit = null, scooterKit, scale = 1, look = {}, castShadow = true} = {}) {
  const L = {...DEFAULT_LOOK, ...look}, rig = scooterKit.rig, riding = !!peopleKit;
  const group = new THREE.Group(); group.name = 'garage-scooter'; group.scale.setScalar(scale);
  const I = new THREE.Matrix4(), items = [], wheel = {p: [], n: [], c: []}, stat = {p: [], n: [], c: []};
  let lampF = null, lampR = null;
  for (const [name, part] of scooterKit.parts) {
    if (name === 'helmet') continue;
    if (name.startsWith('wheel-')) { bake(wheel, part.geometry, I, partColor(part, L)); continue; }
    if (name === 'scooter-lamp-f') { lampF = part; continue; }
    if (name === 'scooter-lamp-r') { lampR = part; continue; }
    items.push({name, kind: 'scooter', copy: 0, geometry: part.geometry, matrix: I, color: partColor(part, L)});
  }
  if (riding) {
    let headM = null;
    for (const e of riderPose(peopleKit, rig, L)) {
      const part = peopleKit.parts.get(e.name), color = e.tint === 'fixed' ? partColor(part, L) : new THREE.Color(e.tint === 'hair' ? (L.hairColor ?? '#2b2320') : L[e.tint]);
      items.push({name: e.name + (e.part ? ':' + e.part : ''), kind: 'rider', copy: e.copy ?? 0, geometry: part.geometry, matrix: e.matrix, color});
      if (e.name === 'head') headM = e.matrix;
    }
    const hp = scooterKit.parts.get('helmet');   // 安全帽的網格相對頸軸，跟頭用同一個矩陣
    items.push({name: 'helmet', kind: 'helmet', copy: 0, geometry: hp.geometry, matrix: headM, color: new THREE.Color(L.helmet)});
  }
  for (const it of items) bake(stat, it.geometry, it.matrix, it.color);
  const paint = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .55, metalness: .06});
  const staticMesh = new THREE.Mesh(toGeometry(stat), paint); staticMesh.name = 'scooter-static';
  staticMesh.castShadow = staticMesh.receiveShadow = castShadow; group.add(staticMesh);
  const wheelGeo = toGeometry(wheel), wheels = new THREE.InstancedMesh(wheelGeo, paint, 2); wheels.name = 'scooter-wheels';
  wheels.castShadow = wheels.receiveShadow = castShadow; wheels.frustumCulled = false;
  const [fx, , fz] = rig.wheels.front, [rx, , rz] = rig.wheels.rear, fs = rig.wheels.frontRadius / rig.wheels.rearRadius;
  const ang = {f: 0, r: 0}, wm = new THREE.Matrix4(), ws = new THREE.Matrix4();
  function setWheels() {   // Ry(+θ) 讓輪頂往 +X 走＝車往前開；前輪比後輪小（110/70-12 對 120/70-12）
    wheels.setMatrixAt(0, wm.makeRotationY(ang.r).setPosition(rx, 0, rz));
    wheels.setMatrixAt(1, wm.makeRotationY(ang.f).premultiply(ws.makeScale(fs, fs, fs)).setPosition(fx, 0, fz));
    wheels.instanceMatrix.needsUpdate = true;
  }
  setWheels(); group.add(wheels);
  const lamps = [[lampF, 2.6, 'scooter-lamp-f'], [lampR, 2.2, 'scooter-lamp-r']].filter(x => x[0]).map(([part, on, name]) => {
    const c = new THREE.Color().setRGB(...part.color), mat = new THREE.MeshStandardMaterial({color: c, emissive: c.clone(), emissiveIntensity: 0, roughness: .3});
    const mesh = new THREE.Mesh(part.geometry, mat); mesh.name = name; mesh.castShadow = false; group.add(mesh); return {mesh, mat, part, on};
  });
  const tris = g => g.getAttribute('position').count / 3;
  const state = {drawCalls: 2 + lamps.length, triangles: tris(staticMesh.geometry) + 2 * tris(wheelGeo) + lamps.reduce((a, l) => a + tris(l.part.geometry), 0), night: false, wheelAngle: ang};
  const bb = staticMesh.geometry.boundingBox, R = Math.max(rig.wheels.rearRadius, rig.wheels.frontRadius);   // 公尺（不受 scale 影響）
  const dims = {min: bb.min.toArray(), max: bb.max.toArray(), length: bb.max.x - bb.min.x, width: bb.max.y - bb.min.y, height: bb.max.z,
    wheelsMinZ: Math.min(rz - rig.wheels.rearRadius, fz - rig.wheels.frontRadius), wheelbase: fx - rx};
  return {
    group, dims, state, rig,
    update(dt, speed) { ang.r += speed * dt / (rig.wheels.rearRadius * scale); ang.f += speed * dt / (rig.wheels.frontRadius * scale); setWheels(); },
    setNight(on) { state.night = !!on; for (const l of lamps) l.mat.emissiveIntensity = state.night ? l.on : 0; },
    inspect() {
      const list = items.map(({name, kind, copy, geometry, matrix}) => ({name, kind, copy, geometry, matrix}));
      for (const l of lamps) list.push({name: l.mesh.name, kind: 'scooter', copy: 0, geometry: l.part.geometry, matrix: I});
      for (const name of ['wheel-tire', 'wheel-disc', 'wheel-rim']) {
        const g = scooterKit.parts.get(name).geometry;
        list.push({name: name + ':rear', kind: 'wheel', copy: 0, geometry: g, matrix: new THREE.Matrix4().makeTranslation(rx, 0, rz)});
        list.push({name: name + ':front', kind: 'wheel', copy: 1, geometry: g, matrix: new THREE.Matrix4().makeScale(fs, fs, fs).setPosition(fx, 0, fz)});
      }
      return list;
    },
    dispose() { staticMesh.geometry.dispose(); wheelGeo.dispose(); paint.dispose(); wheels.dispose(); for (const l of lamps) l.mat.dispose(); }
  };
}
