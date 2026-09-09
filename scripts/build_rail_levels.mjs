import {applyLinkouRailGrade} from './lib/linkou_rail_grade.mjs';
import {openRailDem} from './lib/local_rail_dem.mjs';
// layer 只代表相交處的上下關係。顯示間距與坡道均為估計，沒有改動 XY 或派軌。
import fs from 'node:fs';import crypto from 'node:crypto';import {makePath} from '../rail-3d/integration/train-path.js';
import {classifyRailStructure as classify} from '../rail-3d/physical/structure-kind.js';
// 南港東側兩個交叉的 layer 與明示樓層互相矛盾：此處採同來源 B1（高鐵）／-3（台鐵）的樓層上下序。
const rankOverrides={'706622459':-1};
const read=f=>JSON.parse(fs.readFileSync('rail-3d/physical/'+f));
// 官方橋隧幾何（國土測繪中心，政府資料開放授權條款第 1 版）：補回來源沒標記的橋與隧道。
// 產生器 scripts/build_rail_structures_official.mjs，只做單向升級，不推翻來源明示標記。
const officialFile='data/rail_structures_official.json',official=JSON.parse(fs.readFileSync(officialFile)).entries;
const records=[],segments=[],grid=new Map(),seen=new Set(),crossings=[];
for(const [nf,pf]of [['network.json','display-profiles.json'],['metro-network.json','metro-display-profiles.json']]){const n=read(nf),p=read(pf);for(const w of n.ways){const path=makePath(w.coordinates),e=p.entries[w.id],c={...classify(w.tags,official[w.id]?.kind),...(rankOverrides[w.id]!==undefined?{rank:rankOverrides[w.id],correction:'來源 level=B1；與 layer=-3 衝突，採與相鄰 B1 股道一致的樓層序'}:{})},at=s=>{let i=0,j=e.distances.length-1;while(j-i>1){const k=(i+j)>>1;if(e.distances[k]<=s)i=k;else j=k;}const f=(s-e.distances[i])/(e.distances[j]-e.distances[i]||1);return e.values[i]*(1-f)+e.values[j]*f;},r={w,path,e,c,at,pins:[]};records.push(r);
for(let i=1;i<w.coordinates.length;i++){const a=w.coordinates[i-1],b=w.coordinates[i],ix=segments.length;segments.push({r,a,b,i});for(let x=Math.floor(Math.min(a[0],b[0])*250);x<=Math.floor(Math.max(a[0],b[0])*250);x++)for(let y=Math.floor(Math.min(a[1],b[1])*250);y<=Math.floor(Math.max(a[1],b[1])*250);y++){const k=x+','+y;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(ix);}}}}
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
for(const ids of grid.values())for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){const key=ids[i]+':'+ids[j];if(seen.has(key))continue;seen.add(key);const a=segments[ids[i]],b=segments[ids[j]];if(a.r.w.id===b.r.w.id||a.r.c.rank===b.r.c.rank)continue;const da=[a.b[0]-a.a[0],a.b[1]-a.a[1]],db=[b.b[0]-b.a[0],b.b[1]-b.a[1]],q=[b.a[0]-a.a[0],b.a[1]-a.a[1]],den=cross(da,db);if(Math.abs(den)<1e-16)continue;let t=cross(q,db)/den,u=cross(q,da)/den;if(t< -1e-8||t>1+1e-8||u< -1e-8||u>1+1e-8)continue;t=t<1e-8?0:t>1-1e-8?1:t;u=u<1e-8?0:u>1-1e-8?1:u;
 const na=t===0?a.r.w.nodes[a.i-1]:t===1?a.r.w.nodes[a.i]:null,nb=u===0?b.r.w.nodes[b.i-1]:u===1?b.r.w.nodes[b.i]:null;if(na&&nb&&na===nb&&a.r.w.system===b.r.w.system)continue;
 const pins=[[a,t],[b,u]].map(([seg,f])=>{const r=seg.r,s=r.path.d[seg.i-1]+(r.path.d[seg.i]-r.path.d[seg.i-1])*f,pin={r,s};r.pins.push(pin);return pin;});crossings.push(pins.sort((a,b)=>b.r.c.rank-a.r.c.rank));}
const nodes=[],byKey=new Map(),edges=[];
for(const r of records){const {w,path,e,c}=r;const snap=s=>{let lo=0,hi=path.d.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(path.d[m]<=s)lo=m;else hi=m;}return Math.abs(path.d[lo]-s)<.001?path.d[lo]:Math.abs(path.d[hi]-s)<.001?path.d[hi]:s;};for(const p of r.pins)p.s=snap(p.s);
 const distances=[...new Set([...e.distances.filter((s,i)=>i===0||i===e.distances.length-1||Math.floor(s/20)>Math.floor(e.distances[i-1]/20)),...path.d,...r.pins.map(p=>p.s)].map(snap))].sort((a,b)=>a-b),source=new Map(path.d.map((s,i)=>[s,w.system+':'+w.nodes[i]]));r.distances=distances;r.ids=[];
 for(const s of distances){const key=source.get(s)||w.id+':s:'+s;let id=byKey.get(key);if(id===undefined){id=nodes.length;byKey.set(key,id);nodes.push({z:0,count:0,ground:-Infinity});}const node=nodes[id];node.z+=c.kind==='surface'?0:c.rank*8;node.count++;node.ground=Math.max(node.ground,r.at(s));r.ids.push(id);}
 for(let i=1;i<distances.length;i++)edges.push([r.ids[i-1],r.ids[i],(distances[i]-distances[i-1])*.08]);
 for(const pin of r.pins)pin.id=r.ids[distances.indexOf(pin.s)];
}
for(const n of nodes)n.z/=n.count;
// 交叉淨距與沿軌連續坡道同時求解，避免在來源短 way 或交叉點產生垂直折角。
// 8% 是顯示過渡的斜率上限，不是宣稱鐵路實際坡度。
let violation=Infinity,iterations=0;
for(;iterations<3000;iterations++){
 for(const [a,b,max]of edges){const x=nodes[a],y=nodes[b],d=y.z-x.z;if(Math.abs(d)>max){const shift=(Math.abs(d)-max)*Math.sign(d)/2;x.z+=shift;y.z-=shift;}}
 for(const [a,b]of crossings){const x=nodes[a.id],y=nodes[b.id],gap=Math.max(7,7+y.ground-x.ground),d=gap-(x.z-y.z);if(d>0){x.z+=d/2;y.z-=d/2;}}
 if(iterations%20===0){violation=0;for(const [a,b,max]of edges)violation=Math.max(violation,Math.abs(nodes[a].z-nodes[b].z)-max);if(violation<.001)break;}
}
if(violation>.01){const worst=edges.map(([a,b,max])=>({a,b,max,error:Math.abs(nodes[a].z-nodes[b].z)-max})).sort((a,b)=>b.error-a.error).slice(0,5);console.log(worst.map(e=>({...e,ways:records.filter(r=>r.ids.includes(e.a)||r.ids.includes(e.b)).map(r=>r.w.id)})));throw Error('高度過渡未收斂 '+violation);}
const entries={},counts={};for(const r of records){const offsets=r.ids.map(i=>+nodes[i].z.toFixed(4));if(r.c.rank===0&&offsets.every(z=>Math.abs(z)<.0001))continue;const values=r.ids.map(i=>+(nodes[i].ground+nodes[i].z).toFixed(4));entries[r.w.id]={...r.c,distances:r.distances,offsets,values};counts[r.c.kind]=(counts[r.c.kind]||0)+1;}
for(const [upper,lower] of crossings){upper.other=lower;upper.above=true;lower.other=upper;lower.above=false;}
const dem=openRailDem(new URL('../',import.meta.url));let corridor;try{corridor=await applyLinkouRailGrade(records,entries,dem.ground);}finally{dem.close();}console.log({linkouWays:corridor.length});
fs.writeFileSync('rail-3d/physical/level-profiles.json',JSON.stringify({version:1,railElevationM:null,basis:'OSM 明示 bridge/tunnel + 國土測繪中心官方橋隧幾何補正 + layer 交叉上下序 + 固定 DEM；地面初值 0m，橋隧 8m 層位初值、7m 相交淨距、8% 顯示過渡限制均為估計，不是工程標高。',inputSha256:Object.fromEntries([['network.json','rail-3d/physical/network.json'],['metro-network.json','rail-3d/physical/metro-network.json'],['display-profiles.json','rail-3d/physical/display-profiles.json'],['metro-display-profiles.json','rail-3d/physical/metro-display-profiles.json'],['../terrain/manifest.json','rail-3d/terrain/manifest.json'],['../../'+officialFile,officialFile]].map(([k,p])=>[k,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),sources:['https://data.gov.tw/dataset/73220','https://data.gov.tw/dataset/73221','https://data.gov.tw/dataset/73222','https://www.futsu.com.tw/p_transportation.html','https://wiki.openstreetmap.org/wiki/Key:layer','https://web.metro.taipei/pages2026/WebStation/051'],solver:{iterations,violation,crossings:crossings.length},entries}));console.log({ways:Object.keys(entries).length,counts,iterations,violation});
