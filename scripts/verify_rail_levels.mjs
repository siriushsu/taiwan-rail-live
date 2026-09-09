import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {makePath} from '../rail-3d/integration/train-path.js';import {createRouteRuntime} from '../rail-3d/physical/route-runtime.js';
const read=f=>JSON.parse(fs.readFileSync('rail-3d/physical/'+f)),levels=read('level-profiles.json'),segments=[],grid=new Map(),nodes=new Map();let shared=0;
for(const [nf,pf]of [['network.json','display-profiles.json'],['metro-network.json','metro-display-profiles.json']]){const n=read(nf),p=read(pf);for(const [id,e]of Object.entries(p.entries))e.level=levels.entries[id]||null;const r=createRouteRuntime(n,p);
 for(const w of n.ways){const path=makePath(w.coordinates);for(let i=0;i<w.nodes.length;i++){const key=w.system+':'+w.nodes[i],h=r.atHeight(w.id,path.d[i]),flat=r.atHeight(w.id,path.d[i],'flat');assert.ok(Number.isFinite(h)&&Number.isFinite(flat));if(nodes.has(key)){const prev=nodes.get(key);assert.ok(Math.abs(h-prev.h)<.005&&Math.abs(flat-prev.flat)<.005,'同股道節點高度不連續 '+key);shared++;}nodes.set(key,{h,flat});}
 for(let i=1;i<w.coordinates.length;i++){const a=w.coordinates[i-1],b=w.coordinates[i],seg={w,r,a,b,s:path.d[i-1],length:path.d[i]-path.d[i-1],index:i},k=segments.length;segments.push(seg);for(let x=Math.floor(Math.min(a[0],b[0])*250);x<=Math.floor(Math.max(a[0],b[0])*250);x++)for(let y=Math.floor(Math.min(a[1],b[1])*250);y<=Math.floor(Math.max(a[1],b[1])*250);y++){const key=x+','+y;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(k);}}
 }
}
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0],seen=new Set(),rows=[];
for(const ids of grid.values())for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){const key=ids[i]+':'+ids[j];if(seen.has(key))continue;seen.add(key);const a=segments[ids[i]],b=segments[ids[j]];if(a.w.id===b.w.id)continue;const da=[a.b[0]-a.a[0],a.b[1]-a.a[1]],db=[b.b[0]-b.a[0],b.b[1]-b.a[1]],q=[b.a[0]-a.a[0],b.a[1]-a.a[1]],den=cross(da,db);if(Math.abs(den)<1e-16)continue;let t=cross(q,db)/den,u=cross(q,da)/den;if(t< -1e-8||t>1+1e-8||u< -1e-8||u>1+1e-8)continue;t=t<1e-8?0:t>1-1e-8?1:t;u=u<1e-8?0:u>1-1e-8?1:u;
 const na=t===0?a.w.nodes[a.index-1]:t===1?a.w.nodes[a.index]:null,nb=u===0?b.w.nodes[b.index-1]:u===1?b.w.nodes[b.index]:null;if(na&&nb&&na===nb&&a.w.system===b.w.system)continue;
 const la=levels.entries[a.w.id]?.rank||0,lb=levels.entries[b.w.id]?.rank||0;if(la===lb)continue;const sa=a.s+a.length*t,sb=b.s+b.length*u,sign=Math.sign(la-lb),flat=(a.r.atHeight(a.w.id,sa,'flat')-b.r.atHeight(b.w.id,sb,'flat'))*sign,height=(a.r.atHeight(a.w.id,sa)-b.r.atHeight(b.w.id,sb))*sign;
 rows.push({a:a.w.id,b:b.w.id,la,lb,flat,height,coordinate:[a.a[0]+da[0]*t,a.a[1]+da[1]*t],pass:flat>5&&height>5});
}
fs.mkdirSync('output/rail-levels',{recursive:true});fs.writeFileSync('output/rail-levels/crossings.json',JSON.stringify(rows,null,2));console.log({ways:Object.keys(levels.entries).length,shared,crossings:rows.length,failed:rows.filter(r=>!r.pass).length,examples:rows.filter(r=>!r.pass).slice(0,8)});
for(const [id,e]of Object.entries(levels.entries)){assert.equal(e.offsets.length,e.distances.length);assert.equal(e.values.length,e.distances.length);assert.ok(e.values.every(Number.isFinite)&&e.offsets.every(Number.isFinite));for(let i=1;i<e.offsets.length;i++){assert.ok(e.distances[i]>e.distances[i-1],'取樣里程必須遞增 '+id);assert.ok(Math.abs(e.offsets[i]-e.offsets[i-1])<=(e.distances[i]-e.distances[i-1])*.08+.002,'顯示坡道不連續 '+id);}}
for(const [file,sha]of Object.entries(levels.inputSha256||{}))assert.equal(crypto.createHash('sha256').update(fs.readFileSync('rail-3d/physical/'+file)).digest('hex'),sha,'來源幾何或 DEM 剖面改變，須重建層位');
assert.equal(Object.keys(levels.inputSha256||{}).length,5);
assert.equal(levels.railElevationM,null);
if(rows.some(r=>!r.pass))process.exitCode=1;
