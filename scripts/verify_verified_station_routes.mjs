// 來源接頭、實際月台停車點、雙向接站、PP 中繼資料的具名回歸；不用全日總數掩蓋局部退步。
import fs from 'node:fs';import assert from 'node:assert/strict';
import {restorePhysicalRoutes} from './lib/restore_physical_routes.mjs';
import {computeProfiles,readPassObs} from './build_run_profiles.mjs';
import {createPlanBinding} from '../rail-3d/physical/plan-binding.js';
import {createPhysicalMotion} from '../rail-3d/physical/motion.js';
import {distanceM} from '../rail-3d/integration/train-path.js';
const read=f=>JSON.parse(fs.readFileSync(f)),net=read(process.env.NETWORK||'rail-3d/physical/network.json'),dispatch=read(process.env.DISPATCH||'rail-3d/physical/dispatch.json'),proof=read('scripts/fixtures/taimali-platform-track-0912.json');
const w=net.ways.find(w=>String(w.id)===proof.allowedWay),source=proof.elements.find(e=>e.type==='way'&&String(e.id)===proof.allowedWay);assert(w,'太麻里月台股道不可再次被 spur 篩掉');
assert.deepEqual(w.nodes,source.nodes.map(String));assert.deepEqual(w.coordinates,source.geometry.map(p=>[p.lon,p.lat]));assert.deepEqual(w.tags,source.tags);assert.equal(w.tags.electrified,'contact_line');
assert.equal(net.nodeTags[proof.stopNode].railway,'stop');assert.equal(net.nodeTags[proof.stopNode].name,'太麻里');
const {g,paths}=restorePhysicalRoutes(net);for(const n of[w.nodes[0],w.nodes.at(-1)]){assert.equal(g.nodes.get(n).tags.railway,'switch');assert(g.nodes.get(n).edges.some(e=>e.wayId==='81151575'));}
const platform=proof.elements.find(e=>e.id===547476108),stop=g.nodes.get(proof.stopNode).coordinate;
const pointSegment=(p,a,b)=>{const scale=111320,co=Math.cos(p[1]*Math.PI/180),x=(a[0]-p[0])*scale*co,y=(a[1]-p[1])*scale,dx=(b[0]-a[0])*scale*co,dy=(b[1]-a[1])*scale,t=Math.max(0,Math.min(1,-(x*dx+y*dy)/(dx*dx+dy*dy)));return Math.hypot(x+t*dx,y+t*dy);};
const platformDistance=Math.min(...platform.geometry.slice(1).map((p,i)=>pointSegment(stop,[platform.geometry[i].lon,platform.geometry[i].lat],[p.lon,p.lat])));assert(platformDistance<4,'停車點須緊鄰來源月台面');
const dt=proof.dieselTrack,dw=net.ways.find(w=>String(w.id)===dt.allowedWay),ds=proof.elements.find(e=>e.type==='way'&&String(e.id)===dt.allowedWay);assert(dw,'藍皮的月台股道不可消失');
assert.deepEqual(dw.nodes,ds.nodes.map(String));assert.deepEqual(dw.coordinates,ds.geometry.map(p=>[p.lon,p.lat]));assert.deepEqual(dw.tags,ds.tags);assert.equal(dw.tags.electrified,'no');
assert.equal(net.nodeTags[dt.stopNode].railway,'stop');for(const n of[dw.nodes[0],dw.nodes.at(-1)]){assert.equal(g.nodes.get(n).tags.railway,'switch');assert(g.nodes.get(n).edges.some(e=>e.wayId==='81151575'));}
const dp=proof.elements.find(e=>e.id===dt.platformWay),dc=g.nodes.get(dt.stopNode).coordinate;assert(Math.min(...dp.geometry.slice(1).map((p,i)=>pointSegment(dc,[dp.geometry[i].lon,dp.geometry[i].lat],[p.lon,p.lat])))<4);
const scheduled=read('data/tra_schedule_dense.json');computeProfiles({indexPath:'index.html',schedule:scheduled,track:read('data/tra.json'),passObs:readPassObs('data/tra_pass_obs.json')});
const profiles=read('rail-3d/physical/display-profiles.json'),levels=read('rail-3d/physical/level-profiles.json');for(const[id,p]of Object.entries(profiles.entries))p.level=levels.entries[id];const motion=createPhysicalMotion(net,profiles,dispatch);
const routeFixes=read('scripts/fixtures/physical-route-conflicts-0912.json').repairs;
const targets=[...routeFixes.map(f=>f.train),'301','3021','410','431','5898','5899'];let samples=0,maxJump=0,forward=0,backward=0;const found=new Set();
for(const tr of scheduled.trains.filter(t=>targets.includes(String(t.train)))){
 const r=motion.record(tr);assert(r,`實際剖面重綁 ${tr.train}`);found.add(String(tr.train));const fix=routeFixes.find(f=>f.train===String(tr.train)),station=fix?fix.station.split('—')[0]:'太麻里',i=tr.stops.findIndex(s=>s.name===station);assert(i>=0);
 if(station==='太麻里')assert.equal(paths[r.plan.pathIds[i-1]].to,['5898','5899'].includes(String(tr.train))?proof.dieselTrack.stopNode:proof.stopNode,`${tr.train} 不得退回原本疊車的停車點`);
 else{const p=paths[r.plan.pathIds[i]],old=paths[fix.oldPath];assert.equal(p.from,old.from);assert.equal(p.to,old.to);assert(p.lengthM<old.lengthM+30);assert(!p.edgeIds.some(e=>fix.blocked.includes(g.edges.get(e).resource)),tr.train+' 不得重新侵入對向股道');}
 const ids=r.plan.pathIds;
 for(let j=Math.max(1,i-1);j<Math.min(ids.length,i+2);j++){const a=paths[ids[j-1]],b=paths[ids[j]];assert.equal(a.to,b.from);assert(g.canTurn(a.nodeIds.at(-2),a.to,b.nodeIds[1],g.edges.get(a.edgeIds.at(-1)),g.edges.get(b.edgeIds[0])),`${tr.train} 接站不得倒車`);}
 const from=tr.stops[Math.max(0,i-1)].depSec,to=tr.stops[Math.min(tr.stops.length-1,i+2)].arrSec;
 let prev=null;for(let t=from;t<=to;t++){const p=motion.sample(tr,t);assert(p?.physical);assert(Number.isFinite(p.route.elevation(p.chainageM,'terrain')));assert(Number.isFinite(p.route.elevation(p.chainageM,'flat')));if(prev)assert(distanceM([p.lon,p.lat],[prev.lon,prev.lat])<70,`${tr.train} 每秒不可瞬移`);prev=p;samples++;}
 for(let j=Math.max(1,i-1);j<=Math.min(tr.stops.length-2,i+2);j++)for(const t of[tr.stops[j].arrSec,tr.stops[j].depSec]){const a=motion.sample(tr,t-.001),b=motion.sample(tr,t+.001);assert(a&&b);const jump=distanceM([a.lon,a.lat],[b.lon,b.lat]);assert(jump<1,`${tr.train}@${tr.stops[j].name} 接站跳 ${jump} m`);maxJump=Math.max(maxJump,jump);if(b.lat>a.lat)forward++;if(b.lat<a.lat)backward++;}
}
assert.equal(found.size,10);assert(forward>0&&backward>0,'雙向都要驗');
const pp=Object.entries(dispatch.plans).filter(([k])=>k.startsWith('tra_sched:141:'));assert(pp.length);for(const[,p]of pp)assert(Math.abs(p.lengthM-274.8)<1e-6,'PP 計畫不能繼續寫成 54.8 m');
console.log({trains:found.size,samples,maxBoundaryJumpM:maxJump,forward,backward,platformDistanceM:platformDistance});

// 非電化的新股道僅限藍皮；所有 14 日名冊的其他車與合成加開電車都不能借入。
let dieselBound=0;for(const tr of scheduled.trains){const r=motion.record(tr);if(!r)continue;
 const diesel=r.plan.pathIds.some(id=>paths[id].edgeIds.some(e=>g.edges.get(e).wayId===proof.dieselTrack.allowedWay));if(!diesel)continue;
 assert(['5898','5899'].includes(String(tr.train)));assert.equal(r.plan.templateEligible,false);dieselBound++;
 const extra={...tr,train:'TEST-ELECTRIC-'+tr.train,carName:'自強(3000障)'};const borrowed=createPlanBinding(dispatch)(extra);
 assert(borrowed,'加開車仍應有普通路徑可借');assert(!borrowed.plan.pathIds.some(id=>paths[id].edgeIds.some(e=>g.edges.get(e).wayId===proof.dieselTrack.allowedWay)),'非電化月台不得借給加開電車');
}assert.equal(dieselBound,2);console.log({dieselBound,extraElectricProtected:2});
