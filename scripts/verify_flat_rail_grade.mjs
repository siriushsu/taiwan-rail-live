import fs from 'node:fs';import assert from 'node:assert/strict';
import {makePath,formationPoses} from '../rail-3d/integration/train-path.js';
import {createRouteRuntime} from '../rail-3d/physical/route-runtime.js';
const dir='rail-3d/physical/',read=f=>JSON.parse(fs.readFileSync(dir+f)),levels=read('level-profiles.json'),report={systems:{},cases:[],sample167:[]},grade=s=>s==='tra_sched'||s==='thsr_sched'?.025:s==='afr_sched'?.06:.04;
const sample=(e,s,key)=>{let i=0,j=e.distances.length-1;while(j-i>1){const k=(i+j)>>1;if(e.distances[k]<=s)i=k;else j=k;}const t=(s-e.distances[i])/(e.distances[j]-e.distances[i]||1);return e[key][i]*(1-t)+e[key][j]*t;};
const stations=Object.values(JSON.parse(fs.readFileSync('data/tra_station_info.json')));let pairs=0,legacyFailures=0,tunnelPairs=0;const violations=[];
for(const [nf,pf]of [['network.json','display-profiles.json'],['metro-network.json','metro-display-profiles.json']]){
 const pack=read(nf),profiles=read(pf);for(const [id,e]of Object.entries(profiles.entries))e.level=levels.entries[id];const runtime=createRouteRuntime(pack,profiles);
 for(const w of pack.ways){
  const e=levels.entries[w.id],path=makePath(w.coordinates);assert.equal(e.flatOffsets?.length,e.distances.length,'缺少平坦剖面 '+w.id);assert.ok(e.flatOffsets.every(Number.isFinite));
  const summary=report.systems[w.system]??={ways:0,outdoorWays:0,oldSteepWays:0,bridgeSteepWays:0,oldSteepKm:0,maxGrade:0};summary.ways++;
  // 所有樣本（含很短的來源節點間距）都驗，不只看 10m 以上的段。
  const cap=e.kind==='tunnel'?.08:grade(w.system);let oldMax=0,max=0,oldKm=0;
  for(let i=1;i<e.distances.length;i++){
   const ds=e.distances[i]-e.distances[i-1],dz=Math.abs(e.flatOffsets[i]-e.flatOffsets[i-1]);assert.ok(ds>0);
   if(dz>cap*ds+.001)violations.push({id:w.id,i,ds,dz,cap});
   if(e.kind==='tunnel'){tunnelPairs++;continue;}pairs++;
   const old=Math.abs(e.offsets[i]-e.offsets[i-1]);if(old>cap*ds+.001){legacyFailures++;oldKm+=ds/1000;}
   if(ds>=1){oldMax=Math.max(oldMax,old/ds);max=Math.max(max,dz/ds);}
  }
  if(e.kind==='tunnel')continue;summary.outdoorWays++;summary.maxGrade=Math.max(summary.maxGrade,max);summary.oldSteepKm+=oldKm;
  if(oldKm>0){summary.oldSteepWays++;if(e.kind==='bridge')summary.bridgeSteepWays++;
   const coordinate=path.at(path.length/2).coordinate,near=stations.map(s=>({name:s.name,d:(s.lon-coordinate[0])**2*Math.cos(coordinate[1]*Math.PI/180)**2+(s.lat-coordinate[1])**2})).sort((a,b)=>a.d-b.d).slice(0,2).map(s=>s.name);
   report.cases.push({id:w.id,system:w.system,kind:e.kind,km:path.length/1000,oldSteepKm:oldKm,oldMaxGrade:oldMax,maxGrade:max,coordinate,near});
  }
  for(const s of [0,path.length/2,path.length]){assert.ok(Math.abs(runtime.atHeight(w.id,s,'flat')-sample(e,s,'flatOffsets'))<1e-6);assert.ok(Math.abs(runtime.levelAt(w.id,s).offsetM-sample(e,s,'offsets'))<1e-6,'不得改地形或地下分類使用的原始層位');}
 }
 if(nf==='network.json'){
  // 截圖：南迴線 167 次，22:12，太麻里往知本。使用原實體路徑與 12 節車的兩個方向。
  const route=runtime.route(['6190','6194','6201'],'tra_sched','#C0392B'),parts=Array.from({length:12},(_,i)=>({offsetM:111.65-i*20.3,lengthM:20.3}));
  for(const direction of [1,-1]){
   let maxGrade=0,maxSpan=0,oldSpan=0,maxJoint=0;
   for(let s=14600;s<=15000;s+=5){const poses=formationPoses(route.path,s,direction,parts,x=>route.elevation(x,'flat')+.65);assert.equal(poses.length,12);
    maxSpan=Math.max(maxSpan,Math.max(...poses.map(p=>p.height))-Math.min(...poses.map(p=>p.height)));oldSpan=Math.max(oldSpan,Math.max(...poses.map(p=>route.level(p.s).offsetM))-Math.min(...poses.map(p=>route.level(p.s).offsetM)));
    for(let i=1;i<poses.length;i++)maxGrade=Math.max(maxGrade,Math.abs((poses[i].height-poses[i-1].height)/(poses[i].s-poses[i-1].s)));
    for(let i=1;i<poses.length;i++)maxJoint=Math.max(maxJoint,Math.abs(poses[i].pitch-poses[i-1].pitch));
   }
   assert.ok(oldSpan>5,'舊版突起的負向對照未重現');assert.ok(maxGrade<.012&&maxSpan<1.7&&maxJoint<.01,'167 次仍明顯突起');report.sample167.push({direction,maxGrade,maxSpan,oldSpan,maxJoint});
  }
 }
}
assert.ok(Object.values(report.systems).reduce((s,x)=>s+x.ways,0)>=5008);assert.ok(pairs>150000&&tunnelPairs>30000,'全網掃描分母不足');assert.ok(legacyFailures>1000,'舊版陡坡沒有被同一判準抓出來');assert.deepEqual(violations,[]);
report.pairs=pairs;report.tunnelPairs=tunnelPairs;report.legacyFailures=legacyFailures;report.violations=violations;for(const x of Object.values(report.systems))x.oldSteepKm=+x.oldSteepKm.toFixed(3);
fs.mkdirSync('output/flat-rail-grade',{recursive:true});fs.writeFileSync('output/flat-rail-grade/audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,cases:report.cases.length},null,2));
