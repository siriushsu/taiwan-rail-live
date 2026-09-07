import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const root=new URL('../rail-3d/assets/blender-buildings-v1/',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root))),catalog=read('catalog.json'),placement=read('placement.json');
assert.equal(catalog.length,22);let vertices=0;
for(const entry of catalog){const model=read(entry.id+'/model.json'),p=placement.entries[entry.id];assert.equal(p.railElevationM,null);assert.ok(p.anchor.every(Number.isFinite));assert.ok(p.footprint);if(model.orientationMode==='ENU-baked')assert.equal(p.rotationDeg,0,entry.id+' 不可重複旋轉');
 for(const lod of ['near','far']){const spec=model.lods[lod],bytes=fs.readFileSync(new URL(entry.id+'/'+spec.file,root));assert.equal(bytes.byteLength,spec.vertexCount*24);assert.equal(createHash('sha256').update(bytes).digest('hex'),spec.sha256);assert.ok(bytes.byteLength<25*1024*1024);
  const data=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);for(const v of data)assert.ok(Number.isFinite(v));let end=0;for(const g of spec.drawGroups){assert.equal(g.start,end);assert.ok(g.color.every(n=>n>=0&&n<=1));end+=g.count;}assert.equal(end,spec.vertexCount);vertices+=spec.vertexCount;
 }
}
console.log(`PASS 22 款／44 份 Blender LOD，${vertices} 頂點，網格雜湊、材質、定位與 ENU 方向契約`);
