#!/usr/bin/env node
// 車庫車站場景的站房：把照片校正過的站體模型（Blender 匯出的 near.glb）轉成車庫零件庫（garage-parts-v1），一種材質一個零件。
// 用法：node scripts/build_garage_stations.mjs <輸出資料夾> <id>=<near.glb>[,clip=<半長 m>][,box=x0:x1:y0:y1][,turn=1] …
// 座標：GLB 是 Y-up，轉成場景的 Z-up：X 沿軌道、−Y 街側（站房正面）、Z 朝上，單位公尺，原點在站房地面；場景放的時候自己縮放。
// turn=1：模型的長軸在 GLB 的 Z（高架站候選），先轉 90° 讓軌道沿 X。clip：切到 |X| ≤ 半長（整條高架橋不用全收）；box=x0:x1:y0:y1 切到這個矩形（三角形照平面切開，法向量內插）。
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import path from 'node:path';

const [out,...specs]=process.argv.slice(2);
if(!out||!specs.length)throw Error('用法：build_garage_stations.mjs <輸出資料夾> <id>=<near.glb>[,clip=…][,turn=1] …');
mkdirSync(out,{recursive:true});

function readGlb(file){
 const b=readFileSync(file);
 if(b.readUInt32LE(0)!==0x46546c67)throw Error('不是 GLB：'+file);
 const n=b.readUInt32LE(12),json=JSON.parse(b.subarray(20,20+n).toString('utf8')),bin=b.subarray(20+n+8);
 const read=i=>{const a=json.accessors[i],v=json.bufferViews[a.bufferView],at=(v.byteOffset??0)+(a.byteOffset??0),size={SCALAR:1,VEC3:3}[a.type];
  if(v.byteStride&&v.byteStride!==size*4)throw Error('不支援交錯緩衝');
  const out=[];for(let k=0;k<a.count*size;k++)out.push(a.componentType===5126?bin.readFloatLE(at+k*4):a.componentType===5125?bin.readUInt32LE(at+k*4):bin.readUInt16LE(at+k*2));return out;};
 return{json,read};
}

// 多邊形（頂點＝[位置, 法向量]）切掉 axis 軸上 sign×值 > limit 的部分。
function cut(poly,axis,sign,limit){
 const out=[],inside=v=>sign*v[0][axis]<=limit;
 poly.forEach((a,i)=>{const b=poly[(i+1)%poly.length];
  if(inside(a))out.push(a);
  if(inside(a)!==inside(b)){const t=(limit-sign*a[0][axis])/(sign*b[0][axis]-sign*a[0][axis]),mix=(p,q)=>p.map((v,k)=>v+(q[k]-v)*t);out.push([mix(a[0],b[0]),mix(a[1],b[1])]);}});
 return out;
}
for(const spec of specs){
 const [head,...opts]=spec.split(','),[id,file]=head.split('='),o=Object.fromEntries(opts.map(s=>s.split('=')));
 const {json,read}=readGlb(file),turn=o.turn==='1',clip=o.clip?Number(o.clip):Infinity,box=o.box?o.box.split(':').map(Number):[-clip,clip,-Infinity,Infinity];
 const toScene=(x,y,z)=>turn?[z,x,y]:[x,-z,y];   // turn：GLB 的 +Z 轉成 +X，右手系不變
 const groups=new Map();
 for(const node of json.nodes){
  if(node.mesh===undefined)continue;
  if(node.translation||node.rotation||node.scale||node.matrix)throw Error('節點帶變換，要先套用：'+node.name);
  for(const prim of json.meshes[node.mesh].primitives){
   const m=json.materials[prim.material],pos=read(prim.attributes.POSITION),nor=read(prim.attributes.NORMAL),idx=prim.indices===undefined?pos.map((_,i)=>i).slice(0,pos.length/3):read(prim.indices);
   if(!groups.has(m.name))groups.set(m.name,{m,data:[]});
   const g=groups.get(m.name);
   for(let t=0;t<idx.length;t+=3){
    const tri=[idx[t],idx[t+1],idx[t+2]].map(i=>[toScene(pos[i*3],pos[i*3+1],pos[i*3+2]),toScene(nor[i*3],nor[i*3+1],nor[i*3+2])]);
    let poly=tri;for(const [axis,sign,limit] of [[0,-1,-box[0]],[0,1,box[1]],[1,-1,-box[2]],[1,1,box[3]]])if(poly.length&&Number.isFinite(limit))poly=cut(poly,axis,sign,limit);
    for(let i=1;i+1<poly.length;i++)for(const [p,n] of [poly[0],poly[i],poly[i+1]])g.data.push(...p,...n);
   }
  }
 }
 const parts=[],floats=[];let start=0;
 for(const [name,{m,data}] of groups){
  if(!data.length)continue;
  const r=m.pbrMetallicRoughness??{},count=data.length/6,[cr,cg,cb]=r.baseColorFactor??[1,1,1,1];
  parts.push({name,start,count,pivot:[0,0,0],color:[cr,cg,cb].map(v=>+v.toFixed(4)),metalness:+(r.metallicFactor??0).toFixed(3),roughness:+(r.roughnessFactor??1).toFixed(3)});
  floats.push(data);start+=count;
 }
 const all=new Float32Array(start*6);let at=0;for(const d of floats){all.set(d,at);at+=d.length;}
 const raw=Buffer.from(all.buffer),gz=gzipSync(raw,{level:9}),bin=`${id}.bin.gz`;
 writeFileSync(path.join(out,bin),gz);
 writeFileSync(path.join(out,`${id}.json`),JSON.stringify({schema:'garage-parts-v1',id,kind:'station',units:'m',
  mesh:{file:bin,sha256:createHash('sha256').update(raw).digest('hex'),encoding:'float32-le',strideBytes:24,vertexCount:start,triangleCount:start/3,compression:'gzip'},parts}));
 const range=[0,1,2].map(a=>{let lo=Infinity,hi=-Infinity;for(let i=a;i<all.length;i+=6){lo=Math.min(lo,all[i]);hi=Math.max(hi,all[i]);}return[+lo.toFixed(2),+hi.toFixed(2)];});
 console.log(id,'三角形',start/3,'零件',parts.map(p=>p.name).join(' '),'範圍',JSON.stringify(range),`${(gz.length/1024).toFixed(0)} KB`);
}
