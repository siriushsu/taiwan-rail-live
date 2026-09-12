import {applyLinkouRailGrade} from './lib/linkou_rail_grade.mjs';
import {applyTunnelGrade} from './lib/tunnel_rail_grade.mjs';
import {applyOutdoorRailGrade} from './lib/outdoor_rail_grade.mjs';
import {openRailDem} from './lib/local_rail_dem.mjs';
// layer 只代表相交處的上下關係。顯示間距與坡道均為估計，沒有改動 XY 或派軌。
import fs from 'node:fs';import crypto from 'node:crypto';import {makePath} from '../rail-3d/integration/train-path.js';
import {classifyRailStructure as classify} from '../rail-3d/physical/structure-kind.js';
// 南港東側兩個交叉的 layer 與明示樓層互相矛盾：此處採同來源 B1（高鐵）／-3（台鐵）的樓層上下序。
const rankOverrides={'706622459':-1};
const read=f=>JSON.parse(fs.readFileSync('rail-3d/physical/'+f));
// 官方橋隧幾何（國土測繪中心，政府資料開放授權條款第 1 版）：補回來源沒標記的橋與隧道，
// 另含以 DEM 地形裁決過的反向改判（帶 override 欄位）。產生器 build_rail_structures_official.mjs。
// 整條 entry 傳進 classify，不是只傳 kind——只傳 kind 會讓反向改判整批靜默失效。
const officialFile='data/rail_structures_official.json',official=JSON.parse(fs.readFileSync(officialFile)).entries;
const records=[],segments=[],grid=new Map(),seen=new Set(),crossings=[];
for(const [nf,pf]of [['network.json','display-profiles.json'],['metro-network.json','metro-display-profiles.json']]){const n=read(nf),p=read(pf);for(const w of n.ways){const path=makePath(w.coordinates),e=p.entries[w.id],c={...classify(w.tags,official[w.id]),...(rankOverrides[w.id]!==undefined?{rank:rankOverrides[w.id],correction:'來源 level=B1；與 layer=-3 衝突，採與相鄰 B1 股道一致的樓層序'}:{})},at=s=>{let i=0,j=e.distances.length-1;while(j-i>1){const k=(i+j)>>1;if(e.distances[k]<=s)i=k;else j=k;}const f=(s-e.distances[i])/(e.distances[j]-e.distances[i]||1);return e.values[i]*(1-f)+e.values[j]*f;},r={w,path,e,c,at,pins:[]};records.push(r);
for(let i=1;i<w.coordinates.length;i++){const a=w.coordinates[i-1],b=w.coordinates[i],ix=segments.length;segments.push({r,a,b,i});for(let x=Math.floor(Math.min(a[0],b[0])*250);x<=Math.floor(Math.max(a[0],b[0])*250);x++)for(let y=Math.floor(Math.min(a[1],b[1])*250);y<=Math.floor(Math.max(a[1],b[1])*250);y++){const k=x+','+y;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(ix);}}}}
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
for(const ids of grid.values())for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){const key=ids[i]+':'+ids[j];if(seen.has(key))continue;seen.add(key);const a=segments[ids[i]],b=segments[ids[j]];if(a.r.w.id===b.r.w.id||a.r.c.rank===b.r.c.rank)continue;const da=[a.b[0]-a.a[0],a.b[1]-a.a[1]],db=[b.b[0]-b.a[0],b.b[1]-b.a[1]],q=[b.a[0]-a.a[0],b.a[1]-a.a[1]],den=cross(da,db);if(Math.abs(den)<1e-16)continue;let t=cross(q,db)/den,u=cross(q,da)/den;if(t< -1e-8||t>1+1e-8||u< -1e-8||u>1+1e-8)continue;t=t<1e-8?0:t>1-1e-8?1:t;u=u<1e-8?0:u>1-1e-8?1:u;
 const na=t===0?a.r.w.nodes[a.i-1]:t===1?a.r.w.nodes[a.i]:null,nb=u===0?b.r.w.nodes[b.i-1]:u===1?b.r.w.nodes[b.i]:null;if(na&&nb&&na===nb&&a.r.w.system===b.r.w.system)continue;
 const pins=[[a,t],[b,u]].map(([seg,f])=>{const r=seg.r,s=r.path.d[seg.i-1]+(r.path.d[seg.i]-r.path.d[seg.i-1])*f,pin={r,s};r.pins.push(pin);return pin;});crossings.push(pins.sort((a,b)=>b.r.c.rank-a.r.c.rank));}
// ── 顯示層位：用 tier，不用 rank ────────────────────────────────────
// rank 直接取自 OSM layer。**橋梁**的 layer 純粹是相交上下序的記帳，不是橋面高度：
// 拿它乘 8 公尺，layer=4 的高鐵高架橋就畫在離地 32 公尺（全網路最高 40 公尺），
// 一條股道在 20 公里內從 8 公尺爬到 32 公尺再掉回來——2026-09-11 回報的長波長
// 「上上下下」就是這個。所以橋一律 +1（8 公尺），真的有上下疊的交叉點交給下面的
// 相交淨距求解器拉開就好。
// **地下段**相反，layer 對應真實的 B1／B2／B3 疊層，2026-09-09 已拿北捷車站資料
// 交叉核對過台北車站板南線 B3、淡水信義線 B4，所以保留 rank 原值；收掉它會讓所有疊層
// 隧道從同一個深度起算，全靠淨距求解器硬拉，實測求解殘差從 2.5 公尺惡化到 10.9 公尺。
const tierOf=c=>c.kind==='bridge'?1:c.kind==='tunnel'?-1:0;
// 隧道再分兩種，顯示高度完全相反：
//  山岳隧道——軌面照原高度直行，是山升上去把它蓋住。把它推到地表下固定深度，會沿 8% 過渡
//    把相鄰高架橋一路拖下來，每個洞口前後各俯衝再爬升八公尺（實測高鐵每個洞口都這樣），
//    那正是「一下橋樑一下地下道」。改成沿用洞口外側相接股道的層位，洞口兩側就沒有高差。
//  地下段（都市地下化、捷運）——軌面真的降到地面下，維持 −1。
// 兩者用 DEM 地形起伏區分，與 OSM 標記、官方橋隧圖資都不同源；門檻與
// build_rail_structures_official.mjs 的 RELIEF_M 同一個 20 公尺，取樣理由見該檔。
const MOUNTAIN_RELIEF_M=20;
const dem=openRailDem(new URL('../',import.meta.url));
let corridor,outdoor,tunnels,bores={mountain:0,subsurface:0};
// 只靠 layer<0 被判成隧道、DEM 又找不到山的段：改判成平面，理由隨產物出去供回查。
const demoted=[];
// 洞口清單給算繪端畫拱圈用。算繪端只走「當下有車在跑」的股道，沒車的隧道連洞口都取樣不到，
// 所以位置要在這裡算好隨產物出去。bearing 指向洞內。
const portalList=[];
const bearingTo=(a,b)=>{const y=Math.sin((b[0]-a[0])*Math.PI/180)*Math.cos(b[1]*Math.PI/180),
 x=Math.cos(a[1]*Math.PI/180)*Math.sin(b[1]*Math.PI/180)-Math.sin(a[1]*Math.PI/180)*Math.cos(b[1]*Math.PI/180)*Math.cos((b[0]-a[0])*Math.PI/180);
 return (Math.atan2(y,x)*180/Math.PI+360)%360;};
try{
const nodeWays=new Map();for(const r of records)for(const n of r.w.nodes){const k=r.w.system+':'+n;if(!nodeWays.has(k))nodeWays.set(k,[]);nodeWays.get(k).push(r);}
const tunnelSet=new Set(records.filter(r=>r.c.kind==='tunnel')),placed=new Set();
for(const seed of tunnelSet){
 if(placed.has(seed))continue;
 const stack=[seed],run=[];placed.add(seed);
 while(stack.length){const cur=stack.pop();run.push(cur);for(const n of cur.w.nodes)for(const o of nodeWays.get(cur.w.system+':'+n)||[])if(tunnelSet.has(o)&&!placed.has(o)){placed.add(o);stack.push(o);}}
 const member=new Set(run),grounds=[],portals=[];
 for(const r of run){
  const len=r.path.d.at(-1),n=Math.max(4,Math.min(240,Math.round(len/50)));
  for(let i=0;i<=n;i++)grounds.push(await dem.ground(r.path.at(Math.min(len*i/n,len-1e-3)).coordinate));
  // 洞口＝與非本段股道相接的節點。整段封閉（兩端都不接東西）時退回自身兩端地表當基準。
  for(const i of [0,r.w.nodes.length-1])if((nodeWays.get(r.w.system+':'+r.w.nodes[i])||[]).some(o=>!member.has(o)))portals.push({r,i});
 }
 const portalGround=[];for(const p of portals)portalGround.push(await dem.ground(p.r.w.coordinates[p.i]));
 const base=portalGround.length?portalGround.reduce((a,b)=>a+b,0)/portalGround.length:Math.min(...grounds);
 const reliefM=+(Math.max(...grounds)-base).toFixed(1),mountain=reliefM>=MOUNTAIN_RELIEF_M;
 // 只靠 layer<0 判成隧道的段，要地形站得住腳才留下來。
 // structure-kind.js 檔頭的原則是「layer 表達交叉上下序，不能單獨作為結構的證據」，橋的方向
 // 早就照做（只認 tags.bridge），隧道的方向一直沒有——於是「有道路從上面跨過去」的平地路段
 // 被整段當成地下段。症狀有兩個而且都看得見：(1) 平地上立起一個洞口面牆；(2) 整段軌道因為
 // 被當成地下段、而軌面又高於地表，buriedDraw 判 'none' 完全不畫，雙線只剩一條。
 // 2026-09-12 回報的兩處都是這一格：縱貫線中洲–大湖 8.4 公里（兩端接二層行溪橋、起伏 12.7m）、
 // 宜蘭線牡丹 474 公尺（兩端都接橋、起伏 7.1m）。全網 15 段 17.7 公里，全部是單條 way。
 // 判準用的是這裡本來就算好的兩個量，不引入新常數：明示標記（來源 tunnel=yes／location=underground
 // 或官方橋隧圖資判隧道）與 DEM 起伏。有山的（起伏 ≥20m）一律留著，所以三貂嶺那條只有 layer=-2
 // 的 372 公尺（起伏 235.9m）不受影響。
 const evidence=run.some(r=>r.w.tags?.tunnel==='yes'||r.w.tags?.location==='underground'||official[r.w.id]?.kind==='tunnel');
 if(!evidence&&!mountain){
  for(const r of run){r.c.kind='surface';r.c.layerOnlyTunnel=true;r.c.reliefM=reliefM;}
  demoted.push({system:run[0].w.system,ways:run.map(r=>String(r.w.id)),reliefM,km:+(run.reduce((a,r)=>a+r.path.d.at(-1),0)/1000).toFixed(2)});
  continue;
 }
 const outside=portals.flatMap(p=>(nodeWays.get(p.r.w.system+':'+p.r.w.nodes[p.i])||[]).filter(o=>!member.has(o)));
 const tier=outside.length?Math.max(...outside.map(o=>tierOf(o.c))):0;
 // 山岳隧道沿用洞口外側股道的層位；都市地下段維持 rank 的疊層深度。
 for(const r of run){r.tier=mountain?tier:r.c.rank;r.c.boreKind=mountain?'mountain':'subsurface';r.c.reliefM=reliefM;}
 bores[mountain?'mountain':'subsurface']++;
 for(const p of portals){
  const cs=p.r.w.coordinates,c=cs[p.i],inward=cs[p.i===0?Math.min(6,cs.length-1):Math.max(0,cs.length-7)];
  if(c&&inward&&(c[0]!==inward[0]||c[1]!==inward[1]))
   portalList.push([+c[0].toFixed(6),+c[1].toFixed(6),+bearingTo(c,inward).toFixed(1),p.r.w.system]);
 }
}
for(const r of records)if(r.tier===undefined)r.tier=tierOf(r.c);
const nodes=[],byKey=new Map(),edges=[];
for(const r of records){const {w,path,e,c}=r;const snap=s=>{let lo=0,hi=path.d.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(path.d[m]<=s)lo=m;else hi=m;}return Math.abs(path.d[lo]-s)<.001?path.d[lo]:Math.abs(path.d[hi]-s)<.001?path.d[hi]:s;};for(const p of r.pins)p.s=snap(p.s);
 const distances=[...new Set([...e.distances.filter((s,i)=>i===0||i===e.distances.length-1||Math.floor(s/20)>Math.floor(e.distances[i-1]/20)),...path.d,...r.pins.map(p=>p.s)].map(snap))].sort((a,b)=>a-b),source=new Map(path.d.map((s,i)=>[s,w.system+':'+w.nodes[i]]));r.distances=distances;r.ids=[];
 for(const s of distances){const key=source.get(s)||w.id+':s:'+s;let id=byKey.get(key);if(id===undefined){id=nodes.length;byKey.set(key,id);nodes.push({z:0,count:0,ground:-Infinity});}const node=nodes[id];node.z+=r.tier*8;node.count++;node.ground=Math.max(node.ground,r.at(s));r.ids.push(id);}
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
corridor=await applyLinkouRailGrade(records,entries,dem.ground);
// 露天段先於隧道：洞口要接到露天段求出的顯示高程，交會處的上下界也要對著顯示高程算。
outdoor=await applyOutdoorRailGrade(records,entries,dem.ground,crossings);
tunnels=await applyTunnelGrade(records,entries,dem.ground);
console.log({linkouWays:corridor.length,outdoorWays:outdoor.ids.length,outdoorKnots:outdoor.knots,outdoorPasses:outdoor.passes,outdoorTents:outdoor.tents,outdoorBlocked:outdoor.blocked,outdoorResidual:outdoor.residual,outdoorBelow:outdoor.below,outdoorBuried:outdoor.buried,outdoorDeviation:outdoor.deviation,tunnelWays:tunnels.ids.length,tunnelRuns:tunnels.runs,tunnelSolver:tunnels.worst,tunnelSteep:tunnels.steep,bores,layerOnlyDemoted:{runs:demoted.length,km:+demoted.reduce((a,d)=>a+d.km,0).toFixed(2)}});if(process.env.TUNNEL_REPORT)console.log(tunnels.report.filter(r=>r.error>.01).sort((a,b)=>b.error-a.error).slice(0,10).map(r=>({system:r.system,error:r.error,knots:r.knots,n:r.ways.length,head:r.ways.slice(0,4)})));
fs.writeFileSync('rail-3d/physical/level-profiles.json',JSON.stringify({version:1,railElevationM:null,basis:'OSM 明示 bridge/tunnel + 國土測繪中心官方橋隧幾何補正（含 DEM 地形裁決過的反向改判）+ layer 交叉上下序 + 固定 DEM；地面初值 0m，橋隧 ±8m 層位初值、7m 相交淨距、8% 顯示過渡限制均為估計，不是工程標高。層位初值只取結構種類的正負號，不乘 layer 數值——layer 只表示相交上下序。隧道依 DEM 地形起伏分兩種：山岳隧道沿用洞口外側股道的層位（軌面直行、山蓋過去），都市地下段維持地面下一層；兩者都以 terrainValues 給洞口間的連續縱坡，內部沿里程直線，不隨山坡起伏。露天段（高架與平面）也以 terrainValues 給連續縱坡：以原始 DEM 加層位為目標，在各系統縱坡上限（臺鐵高鐵 2.5%、林鐵 6%、捷運 4%）內取最接近的剖面，高架至少離地 6 公尺、平面不低於地表，交會處抬上方股道；橋面不再逐點複製 DEM 起伏。',inputSha256:Object.fromEntries([['network.json','rail-3d/physical/network.json'],['metro-network.json','rail-3d/physical/metro-network.json'],['display-profiles.json','rail-3d/physical/display-profiles.json'],['metro-display-profiles.json','rail-3d/physical/metro-display-profiles.json'],['../terrain/manifest.json','rail-3d/terrain/manifest.json'],['../../'+officialFile,officialFile]].map(([k,p])=>[k,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),sources:['https://data.gov.tw/dataset/73220','https://data.gov.tw/dataset/73221','https://data.gov.tw/dataset/73222','https://www.futsu.com.tw/p_transportation.html','https://wiki.openstreetmap.org/wiki/Key:layer','https://web.metro.taipei/pages2026/WebStation/051'],solver:{iterations,violation,crossings:crossings.length},layerOnlyDemoted:demoted,portals:portalList,entries}));console.log({ways:Object.keys(entries).length,counts,iterations,violation,portals:portalList.length});
}finally{dem.close();}
