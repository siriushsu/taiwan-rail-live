// 校舍身分、實測高度與運動場面和既有地形共用同一個 TM2 公尺座標系。
import { ShapeUtils, Vector2 } from './engine/vendor/three.module.js';

import {appendHeritageHall} from './heritage-geometry.mjs';
import { TW2 } from './engine/shared/tw2.mjs';
import { tw2Building } from './engine/shared/tw2-temple.mjs';
import { orientedBox } from './engine/kit-building-appearance.js';
import { appendStructures } from './place-structures.mjs';
function regionReader(path) {
  const directory = new URL(path,import.meta.url), chunks = new Map();
  let regionIndex;
  async function read(file) {
    const res=await fetch(new URL(file,directory));
    if (!res.ok) throw Error(String(res.status));
    return res.json();
  }
  return async url => {
    const tile=/\/(E(-?\d+)_N(-?\d+))\/$/.exec(url);
    if (!tile) return null;
    const region=Math.floor(tile[2]/8)+'_'+Math.floor(tile[3]/8);
    try {
      regionIndex ??= read('index.json').then(keys=>new Set(keys)).catch(e=>{regionIndex=null;throw e;});
      if (!(await regionIndex).has(region)) return null;
      let chunk=chunks.get(region);
      if (!chunk) {
        chunk=read(region+'.json');chunks.set(region,chunk);
        if (chunks.size>24) chunks.delete(chunks.keys().next().value);
      }
      try { return (await chunk)[tile[1]]||null; }
      catch(e) { if (chunks.get(region)===chunk) chunks.delete(region);throw e; }
    } catch { return null; }
  };
}
const facilities=regionReader('./places/detail/');
export const tunnelDetail=regionReader('./places/tunnels/');
export async function placeDetail(url) {
  const [places,tunnels]=await Promise.all([facilities(url),tunnelDetail(url)]);
  return places || tunnels ? {...places,tunnels} : null;
}

// tw2 temple 開著時，一般廟宇改由地景引擎的廟宇規則畫：templeSolids 不畫，被它取代的原建物留著。
// 逐座審過的廟（heritageHalls）照舊。被 templeSolids 蓋住一半以上的建物才算「為了廟拿掉的」，
// 圖磚沒標成廟的那些（透天、公寓…）沿用這裡認出的廟，標成廟再套一次引擎規則，高度取蓋住它的殿頂。
const inRing = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
function templeCover(ring, solids) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const st = Math.max(.5, Math.sqrt((x1 - x0) * (y1 - y0)) / 12); let n = 0, k = 0, top = 0;
  for (let x = x0 + st / 2; x < x1; x += st) for (let y = y0 + st / 2; y < y1; y += st) {
    if (!inRing(x, y, ring)) continue; n++;
    const s = solids.find(s => inRing(x, y, s[0][0])); if (s) { k++; top = Math.max(top, s[2]); }
  }
  return { f: n ? k / n : 0, top };
}
function useEngineTemples(buildings, detail) {
  const solids = detail.templeSolids, keep = new Set(detail.suppressed);
  for (const b of buildings) {
    const id = String(b.id).split('#')[0];
    if (!keep.has(id) || !b.rings?.[0]) continue;
    const c = templeCover(b.rings[0], solids);
    if (c.f < .5) continue;
    keep.delete(id);
    if (b.tw2T) continue;
    const t = tw2Building({ ...b, type: 'temple', roof: 'temple', h: c.top || b.h, floors: 1, addon: 0 }, TW2, orientedBox);
    Object.assign(b, t, { tw2TempleFrom: 'place' });
  }
  detail.suppressed = [...keep];
}

export function applyPlaceBuildings(buildings, detail) {
  // 圖磚把有分件的建物拆成 原 id#0、#1…（m82v 起），場館資料仍以原 id 記
  const whole = id => String(id).split('#')[0];
  if (TW2.temple && detail?.templeSolids?.length && detail.suppressed) useEngineTemples(buildings, detail);
  if (detail?.suppressed) {
    const skip=new Set(detail.suppressed);
    for (let i=buildings.length-1;i>=0;i--) if (skip.has(buildings[i].id) || skip.has(whole(buildings[i].id))) buildings.splice(i,1);
  }
  if (detail?.additional?.length) buildings.push(...detail.additional);
  if (!detail?.buildings) return;
  for (const b of buildings) {
    const p = detail.buildings[b.id] || detail.buildings[whole(b.id)];
    if (!p) continue;
    // 地景引擎 tw2 已依來源類別畫成體育館拱頂、看台、圓槽、溫室或棚架的，保留那個造型
    if (b.tw2Gym || b.tw2Stand || b.tw2Tank || b.tw2Gh || b.canopy && b.tw2Roof) continue;
    const mall = p.k === 'mall';
    // 原有有憑據的層數、高度、屋形優先；只有估製透天／公寓才換掉假設的樓型。
    if (b.illustrative && (p.h || p.levels)) {
      b.h = p.h || p.levels * (mall ? 4.3 : 3.5);
      b.floors = Math.max(1, Math.round(p.levels || b.h / (mall ? 4.3 : 3.5)));
    }
    if (b.illustrative && b.type !== 'school' && b.type !== 'hall') b.roof = 'flat';
    b.type = p.k === 'school' ? 'school' : 'hall';
    b.mark = p.k;
    if (p.k === 'library' && b.illustrative && !p.wall) b.wall = '#b9c5be';
    if (p.wall) b.wall = p.wall;
    if (p.roof) b.color = b.sceneRoof = p.roof;
    b.addon = 0;
  }
}

const tones = {
  track: 0xad6752, 'track-blue': 0x3886bf, basketball: 0xaf7862, tennis: 0x6a927f, volleyball: 0xae9178,
  soccer: 0x819767, baseball: 0x97a16e, pitch: 0x92a285, athletics: 0xa77863,
  running: 0xab715b, grass: 0x849a69, clay: 0xad765b, sand: 0xc1ae87, asphalt: 0x88918d,
  playground: 0xb5a285, line: 0xf2eadd,
};
const linear = byte => Math.round(255 * ((byte/255 + .055)/1.055)**2.4);
const colors = Object.fromEntries(Object.entries(tones).map(([kind, rgb]) => [
  kind, [linear(rgb >> 16), linear(rgb >> 8 & 255), linear(rgb & 255), 255],
]));

export function fieldMesh(detail, groundAt) {
  if (!detail?.surfaces?.length && !detail?.tunnels?.portals?.length && !detail?.equipment?.length) return null;
  const pos = [], col = [], nor = [];
  for (const [kind, rings] of detail.surfaces || []) {
    const contours = rings.map(r => r.map(([x,y]) => new Vector2(x,y)));
    const faces = ShapeUtils.triangulateShape(contours[0], contours.slice(1));
    const vertices = contours.flat();
    const tint = colors[kind] || colors.pitch, lift = kind === 'line' ? .29 : .20;
    // 基底與白線都貼合本格高程；長三角形切短，以免在緩坡兩端貼地、中段埋進地面。
    function triangle(a,b,c,depth) {
      const edges = [a.distanceToSquared(b), b.distanceToSquared(c), c.distanceToSquared(a)];
      const side = edges.indexOf(Math.max(...edges));
      if (edges[side] > 18*18 && depth < 10) {
        const p = [a,b,c], u = p[side], v = p[(side+1)%3], w = p[(side+2)%3];
        const mid = new Vector2((u.x+v.x)/2,(u.y+v.y)/2);
        triangle(u,mid,w,depth+1); triangle(mid,v,w,depth+1);
      } else {
        for (const p of [a,b,c]) {
          pos.push(p.x,groundAt(p.x,p.y)+lift,-p.y); col.push(...tint); nor.push(0,127,0,0);
        }
      }
    }
    for (const [a,b,c] of faces) triangle(vertices[a],vertices[b],vertices[c],0);
  }
  appendStructures(detail,groundAt,pos,col,nor);
  return {pos:Float32Array.from(pos),col:Uint8Array.from(col),nor:Int8Array.from(nor),n:pos.length/3};
}

// 各殿、門、廊各用自己的建物外框與地盤高程；天井留空。近景輸出有法線的牆與瓦頂。
export function templeMesh(detail, groundAt) {
  if (!detail?.templeSolids?.length || TW2.temple) return null;
  const pos=[],col=[],nor=[],tints=new Map();
  for (const [rings,bottom,top,hex,anchor] of detail.templeSolids||[]) {
    if (!rings[0]?.length) continue;
    const contours=rings.map(r=>r.map(([x,y])=>new Vector2(x,y)));
    const vertices=contours.flat(),ground=groundAt(...(anchor||rings[0][0]));
    let tint=tints.get(hex);
    if(!tint) {
      const n=parseInt(hex.slice(1),16);tint=[linear(n>>16),linear(n>>8&255),linear(n&255),255];tints.set(hex,tint);
    }
    function vertex(v,z,nx,ny,nz) {
      pos.push(v.x,ground+z,-v.y);col.push(...tint);nor.push(nx,ny,nz,0);
    }
    for(const [a,b,c] of ShapeUtils.triangulateShape(contours[0],contours.slice(1))) {
      for(const i of [a,b,c]) vertex(vertices[i],top,0,127,0);
    }
    for(const ring of contours) for(let i=0;i<ring.length;i++) {
      const a=ring[i],b=ring[(i+1)%ring.length],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
      if(!len) continue;
      const nx=Math.round(127*dy/len),nz=Math.round(127*dx/len);
      for(const [v,z] of [[a,bottom],[b,bottom],[b,top],[a,bottom],[b,top],[a,top]])vertex(v,z,nx,0,nz);
    }
  }
  return {pos:Float32Array.from(pos),col:Uint8Array.from(col),nor:Int8Array.from(nor),n:pos.length/3};
}

export function reviewedTempleMeshes(detail,groundAt){
  const halls=new Map();
  for(const part of detail?.heritageHalls||[]){
    if(!halls.has(part.id))halls.set(part.id,{pos:[],col:[],nor:[]});
    const {pos,col,nor}=halls.get(part.id);
    const center=part.ring.reduce(([x,y],[e,n])=>[x+e/part.ring.length,y+n/part.ring.length],[0,0]);
    appendHeritageHall(part,part.ring,groundAt(...center),pos,col,nor);
  }
  return Array.from(halls,([id,{pos,col,nor}])=>({id,pos:Float32Array.from(pos),col:Uint8Array.from(col),nor:Int8Array.from(nor),n:pos.length/3}));
}
