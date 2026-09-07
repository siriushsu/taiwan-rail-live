import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','rail-3d');
const json=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const fleet=json('assets/blender-map-v1/manifest.json');
for(const [id,m] of Object.entries(fleet.meshes)){const b=fs.readFileSync(path.join(root,'assets/blender-map-v1',m.file));assert.equal(b.length,m.byteLength,id+' bytes');assert.equal(sha(b),m.sha256,id+' sha256');assert.ok(b.length<25*1024*1024,id+' 部署大小');}
const terrain=json('terrain/manifest.json'),whole=createHash('sha256');let bytes=0;
for(const c of terrain.chunks){const b=fs.readFileSync(path.join(root,'terrain',c.file));assert.equal(b.length,c.bytes,c.file);assert.equal(sha(b),c.sha256,c.file);assert.ok(b.length<=terrain.chunkSize);bytes+=b.length;whole.update(b);}
assert.equal(bytes,terrain.byteLength);assert.equal(whole.digest('hex'),terrain.sha256);assert.equal(terrain.sha256,json('terrain/source.json').sha256);
console.log(`PASS ${Object.keys(fleet.models).length} 款列車、${Object.keys(fleet.meshes).length} 件模型及 ${terrain.chunks.length} 片地形均與來源位元組相符，無單檔超出部署上限`);
