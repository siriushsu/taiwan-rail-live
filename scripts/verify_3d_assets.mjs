import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {assembleFormation} from '../rail-3d/integration/formations.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','rail-3d');
const json=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const fleet=json('assets/blender-map-v1/manifest.json');
for(const [id,m] of Object.entries(fleet.meshes)){const b=fs.readFileSync(path.join(root,'assets/blender-map-v1',m.file));assert.equal(b.length,m.byteLength,id+' bytes');assert.equal(sha(b),m.sha256,id+' sha256');assert.ok(b.length<25*1024*1024,id+' 部署大小');}
// 全車隊掃描這次輕軌暴露的地面基準風險：一般車廂的各部件都是獨立完整車廂，
// minZ 應在同一軌面；五節鉸接車則是從同一列車切開，無轉向架的車節必須保留懸空高度。
let rigidModels=0,articulatedModels=0,maxRigidGroundSpread=0;
for(const [id,template] of Object.entries(fleet.models)){
  const metas=template.parts.map(part=>{const meta=fleet.meshes[part.mesh];assert.ok(meta,`${id} 缺少 ${part.mesh}`);return meta;});
  const minZ=metas.map(meta=>meta.min[2]),groundSpread=Math.max(...minZ)-Math.min(...minZ);
  if(!template.articulated){rigidModels++;maxRigidGroundSpread=Math.max(maxRigidGroundSpread,groundSpread);assert.ok(groundSpread<.001,`${id} 一般車廂的軌面原點相差 ${groundSpread}m`);continue;}
  articulatedModels++;assert.equal(template.parts.length,5,`${id} 鉸接車不是 5 分節`);
  const lengths=metas.map(meta=>meta.max[0]-meta.min[0]),widthM=Math.max(...metas.map(meta=>meta.max[1]-meta.min[1]));
  const model=assembleFormation({id,lengths,widthM,articulated:true,compact:false},fleet),ground=Math.min(...minZ);
  const clearances=model.parts.map(part=>{const meta=fleet.meshes[part.mesh],scale=widthM/(meta.max[1]-meta.min[1]);assert.ok(Math.abs(part.groundAnchorZ-ground)<1e-9,`${id} ${part.mesh} 沒有共用整列軌面基準`);return(meta.min[2]-part.groundAnchorZ)*scale;});
  assert.ok(Math.min(...clearances)<.002&&Math.max(...clearances)>.3,`${id} 未保留轉向架與懸掛車節的高度關係：${clearances.join('／')}`);
}
const terrain=json('terrain/manifest.json'),whole=createHash('sha256');let bytes=0;
for(const c of terrain.chunks){const b=fs.readFileSync(path.join(root,'terrain',c.file));assert.equal(b.length,c.bytes,c.file);assert.equal(sha(b),c.sha256,c.file);assert.ok(b.length<=terrain.chunkSize);bytes+=b.length;whole.update(b);}
assert.equal(bytes,terrain.byteLength);assert.equal(whole.digest('hex'),terrain.sha256);assert.equal(terrain.sha256,json('terrain/source.json').sha256);
console.log(`PASS ${Object.keys(fleet.models).length} 款列車（${rigidModels} 款一般車廂軌面最大誤差 ${(maxRigidGroundSpread*1000).toFixed(3)}mm；${articulatedModels} 款鉸接車共用軌面基準）、${Object.keys(fleet.meshes).length} 件模型及 ${terrain.chunks.length} 片地形均與來源位元組相符，無單檔超出部署上限`);
