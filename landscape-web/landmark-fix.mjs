// 地標輪廓修正：圖磚資料把某些不是房子的東西當成一般建物（圍牆、牌樓），照建物畫會長出窗戶、樓層。
// 這裡按建物 id 改成專屬型別，由 buildings.worker 的 buildOne 交給 buildLandmark 畫。
// id 對不到（上游重產換了 id）就什麼都不做，退回原本的畫法。
import { orientedBox } from './engine/kit-building-appearance.js';

const CKS_WALL = { type: 'cks-wall', h: 4.6, floors: 1, wall: '#f3f2ee', roof: 'flat' };
const FIX = new Map([
  // 中正紀念堂四周的圍牆（含西側兩段弧牆）
  ...[
    'f955fd79-0d1c-47ca-9c5e-4af1c86f510d', 'cc929229-ac15-411a-aefe-39d5224c8348', '9d935cbf-3874-42f4-9eed-d0c4c9b5c186',
    '18e7e797-dac9-4735-ac94-80ce2b96bf6c', '675c021e-9fba-4eaa-ae66-0e7d1efb36aa', 'ec40e4bd-4752-4f33-843c-a1d025a16925',
    'ec6fb6d9-577a-4b9c-8955-48ce2b3cddb2',
  ].map(id => [id, CKS_WALL]),
  // 圍牆上的門樓、門亭（資料估成 14～17 m 的透天）
  ...[
    '0d424238-23fd-4147-8b1c-64c27fdf824f', 'ce093736-1bd9-471b-b2a1-7651887edb54', '791b3690-f8ff-4b18-96fe-1ced94e9fc16',
    '9d375490-ea4b-4883-b43f-9f059e7e3af3', 'b48e1627-60f5-4d66-bc5a-4ece55e3254c',
  ].map(id => [id, { type: 'cks-gate', h: 6.5, floors: 1, wall: '#f3f2ee', roof: 'flat' }]),
  // 自由廣場牌樓
  ['b8830d1f-b844-45fd-922b-8d7567db03de', { type: 'cks-arch', h: 30, floors: 1, wall: '#f3f2ee', roof: 'flat' }],
]);

export const LANDMARK_TYPES = new Set(['cks-wall', 'cks-gate', 'cks-arch']);

// tileData 讀到 buildings.json 之後呼叫一次（同一份陣列會被近景、中景共用）
export function fixLandmarks(list) {
  for (const b of list) {
    const f = FIX.get(b.id);
    if (f) Object.assign(b, f, { mark: null, markName: '', addon: 0 });
  }
}

const WHITE_WALL = '#f3f2ee', BLUE_TILE = '#2f5f9f', EAVE = '#3d6b86', PLINTH = '#d9d6cf', RIDGE = '#25497c';

// k：buildings.worker 的畫圖工具（quad／box／rgb／shade 與部件代號）
export function buildLandmark(b, k) {
  if (b.type === 'cks-wall') return wallRun(b, k);
  if (b.type === 'cks-gate') return gate(b, k);
  if (b.type === 'cks-arch') return paifang(b, k);
}

// 沿 u 從 u0 到 u1、深 depth 的廡殿頂（藍色琉璃瓦），底下封一片簷底
function hipRoof(k, at, ang, u0, u1, depth, z0, rise, over) {
  const { quad, tri, box, rgb, shade, P_DECK, P_TILE, P_PLAIN } = k, blue = rgb(BLUE_TILE);
  const a = u0 - over, c = u1 + over, d = depth / 2 + over, inset = Math.min(rise * 1.2, (c - a) / 3), uv = [[0, 0], [(c - a) / 2, 0], [(c - a) / 2, 1], [0, 1]];
  quad([at(a, -d, z0), at(c, -d, z0), at(c - inset, 0, z0 + rise), at(a + inset, 0, z0 + rise)], P_TILE, blue, uv);
  quad([at(c, d, z0), at(a, d, z0), at(a + inset, 0, z0 + rise), at(c - inset, 0, z0 + rise)], P_TILE, blue, uv);
  tri([at(a, d, z0), at(a, -d, z0), at(a + inset, 0, z0 + rise)], P_TILE, shade(blue, 0.9));
  tri([at(c, -d, z0), at(c, d, z0), at(c - inset, 0, z0 + rise)], P_TILE, shade(blue, 0.9));
  quad([at(a, d, z0), at(c, d, z0), at(c, -d, z0), at(a, -d, z0)], P_DECK, shade(rgb(EAVE), 0.7));
  box(at((a + c) / 2, 0, z0 + rise + 0.25), [c - a - 2 * inset + 1.2, 0.5, 0.5], P_PLAIN, rgb(RIDGE), ang);
}

const frame = (b) => {
  const obb = orientedBox(b.rings[0]);
  if (!obb) return null;
  const { center, u, v } = obb;
  return { obb, ang: Math.atan2(u[1], u[0]), at: (du, dv, z) => [center[0] + u[0] * du + v[0] * dv, center[1] + u[1] * du + v[1] * dv, z] };
};

// 門樓：白色牆身、簷下色帶、藍瓦廡殿頂
function gate(b, k) {
  const f = frame(b);
  if (!f) return;
  const { obb, ang, at } = f, { box, rgb, P_DECK } = k, g = b.ground, L = obb.length, D = obb.width;
  box(at(0, 0, (g - 0.6 + g + b.h) / 2), [L, D, b.h + 0.6], P_DECK, rgb(WHITE_WALL), ang);
  box(at(0, 0, g + b.h - 0.5), [L + 0.4, D + 0.4, 1], P_DECK, rgb(EAVE), ang);
  hipRoof(k, at, ang, -L / 2, L / 2, D, g + b.h, Math.min(3, D * 0.45 + 0.6), 1);
}

// 圍牆：輪廓照原樣拉高成白牆，頂上一圈藍色琉璃瓦壓頂
function wallRun(b, k) {
  const { quad, vert, rgb, shade, P_DECK, P_TILE, THREE, Z4, WHITE } = k;
  const ring = [...b.rings[0]];
  let a2 = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a2 += p[0] * q[1] - q[0] * p[1]; }
  if (a2 < 0) ring.reverse();
  const bottom = b.ground - 0.6, z = b.ground + b.h, zc = z - 0.9, white = rgb(WHITE_WALL), blue = rgb(BLUE_TILE), side = shade(blue, 0.82);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 0.2) continue;
    const uv = (z0, z1) => [[0, 0], [len / 6, 0], [len / 6, (z1 - z0) / 6], [0, (z1 - z0) / 6]];
    quad([[a[0], a[1], bottom], [c[0], c[1], bottom], [c[0], c[1], zc], [a[0], a[1], zc]], P_DECK, white, uv(bottom, zc));
    quad([[a[0], a[1], zc], [c[0], c[1], zc], [c[0], c[1], z], [a[0], a[1], z]], P_TILE, side, [[0, 0], [len / 2, 0], [len / 2, 0.75], [0, 0.75]]);
  }
  const s = b.id % 97;
  for (const [i, j, m] of THREE.ShapeUtils.triangulateShape(ring.map(p => new THREE.Vector2(p[0], p[1])), [])) {
    for (const q of [ring[i], ring[j], ring[m]]) vert([q[0], q[1], z], [0, 0, 1], [q[0] * 0.5 + s, q[1] * 0.5, 0, 0], Z4, [P_TILE, 0, 0, 0], Z4, blue, WHITE);
  }
}

// 牌樓：五門六柱，中門最高；白色柱與門楣、藍色琉璃瓦廡殿頂、屋簷下一道彩繪色帶
function paifang(b, k) {
  const f = frame(b);
  if (!f) return;
  const { obb, ang, at } = f, { box, rgb, P_DECK } = k, L = obb.length, g = b.ground;
  const white = rgb(WHITE_WALL), eave = rgb(EAVE), plinth = rgb(PLINTH);
  const PW = 2.8, PD = 3.4, ratio = [1, 1.15, 1.45, 1.15, 1], span = L - 6 * PW, unit = span / ratio.reduce((s, r) => s + r, 0);
  const clear = [9, 12, 15, 12, 9], roofBase = [15.5, 20, 25, 20, 15.5];
  // 柱心位置
  const cols = [];
  let x = -L / 2 + PW / 2;
  for (let i = 0; i < 6; i++) { cols.push(x); if (i < 5) x += PW + ratio[i] * unit; }
  const roof = (u0, u1, z0, depth, rise, over) => hipRoof(k, at, ang, u0, u1, depth, z0, rise, over);
  for (let i = 0; i < 6; i++) {
    const top = Math.max(roofBase[i - 1] ?? 0, roofBase[i] ?? 0) - 1.4;
    box(at(cols[i], 0, g + 0.5), [PW + 0.8, PD + 0.8, 1.6], P_DECK, plinth, ang);
    box(at(cols[i], 0, (g - 0.6 + top) / 2), [PW, PD, top - g + 0.6], P_DECK, white, ang);
  }
  for (let i = 0; i < 5; i++) {
    const u0 = cols[i] - PW / 2, u1 = cols[i + 1] + PW / 2, z0 = g + clear[i], z1 = g + roofBase[i];
    box(at((u0 + u1) / 2, 0, (z0 + z1 - 1.4) / 2), [u1 - u0, PD - 0.6, z1 - 1.4 - z0], P_DECK, white, ang, [0, 1, 2, 3, 4, 5]);
    box(at((u0 + u1) / 2, 0, z1 - 0.7), [u1 - u0 + 0.6, PD + 0.4, 1.4], P_DECK, eave, ang, [0, 1, 2, 3, 4, 5]);
    roof(u0, u1, z1, PD, i === 2 ? 4 : 3.2, 1.8);
  }
}
