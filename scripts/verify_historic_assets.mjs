// 守住乾淨出貨樹的資產接線；只驗可證明的格式與來源契約，不宣稱現實測繪精度。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=path.join(root,'rail-3d/assets/historic-buildings-v2');
const read=name=>JSON.parse(fs.readFileSync(path.join(base,name)));
const catalog=read('catalog.json'),placements=read('placement.json').entries,ids=new Set();let bytes=0,parts=0;
assert.equal(catalog.length,25);assert.deepEqual(Object.keys(placements).sort(),catalog.map(e=>e.id).sort());
for(const e of catalog){
 assert(!ids.has(e.id));ids.add(e.id);
 const m=read(e.metadata),p=placements[e.id];assert.equal(m.id,e.id);assert(m.mapEligible);assert.equal(m.orientationMode,'ENU-baked');assert.deepEqual(m.anchor,p.anchor);assert.equal(p.railElevationM,null);assert.equal(m.railElevationM,null);
 const components=new Set(m.calibration.parts.map(p=>p.id));parts+=components.size;assert(components.size>0);assert(m.sources.length>0);
 for(const part of m.calibration.parts){assert(part.anchor.every(Number.isFinite));if(part.terrainAnchor){assert.equal(part.terrainAnchor.length,2);assert(part.terrainAnchor.every(Number.isFinite));}if(part.flatGroundOffsetM!==undefined)assert(Number.isFinite(part.flatGroundOffsetM));assert(part.basis);assert(p.footprint.features.some(f=>f.properties.component===part.id));}
 for(const [lod,s] of Object.entries(m.lods)){
  assert(['near','far'].includes(lod));const b=fs.readFileSync(path.join(base,e.id,s.file));bytes+=b.length;assert.equal(b.length,s.vertexCount*24);assert.equal(createHash('sha256').update(b).digest('hex'),s.sha256);assert.equal(s.vertexCount,s.triangleCount*3);
  let end=0;for(const g of s.drawGroups){assert.equal(g.start,end);end+=g.count;assert(components.has(g.component));}assert.equal(end,s.vertexCount);
  for(let i=0;i<b.length;i+=24){for(let k=0;k<6;k++)assert(Number.isFinite(b.readFloatLE(i+k*4)));const norm=Math.hypot(...[3,4,5].map(k=>b.readFloatLE(i+k*4)));assert(Math.abs(norm-1)<.002);}
 }
 assert(m.lods.far.triangleCount<=m.lods.near.triangleCount);
}
console.log(`歷史建物資產通過：${ids.size} 組、${parts} 個定位部件、${bytes} bytes，雙 LOD 雜湊與元件完整。`);
