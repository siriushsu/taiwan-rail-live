import fs from 'node:fs';import assert from 'node:assert/strict';import {createPhysicalMotion,physicalStopSignature} from '../rail-3d/physical/motion.js';import {distanceM}from'../rail-3d/integration/train-path.js';
const n=JSON.parse(fs.readFileSync('rail-3d/physical/network.json')),profiles=JSON.parse(fs.readFileSync('rail-3d/physical/display-profiles.json')),dispatch=JSON.parse(fs.readFileSync(process.env.DISPATCH||'output/dispatch-optimized-80.json')),all=JSON.parse(fs.readFileSync('.cache/physical-tracks/timetable.json'));let samples=0,boundaries=0;
for(const tr of all){const p=dispatch.plans[tr.id];if(p)p.stopSignature=physicalStopSignature(tr);}const motion=createPhysicalMotion(n,profiles,dispatch);
for(const tr of all.filter(t=>dispatch.plans[t.id])){const record=motion.record(tr);for(let i=0;i<tr.stops.length-1;i++){
 const start=record.schedule[i].depSec,end=record.schedule[i+1].arrSec,positions=[0,.25,.5,.75,.99999].map(f=>motion.sample(tr,start+(end-start)*f));
 for(const p of positions){assert.ok(p?.physical);const at=p.route.path.at(p.chainageM);assert.ok(distanceM(at.coordinate,[p.lon,p.lat])<1e-6);assert.ok(Number.isFinite(p.route.elevation(p.chainageM)));samples++;}
 if(i){const before=motion.sample(tr,record.schedule[i].arrSec-.001),after=motion.sample(tr,record.schedule[i].arrSec+.001);assert.ok(distanceM([before.lon,before.lat],[after.lon,after.lat])<1,'接站瞬移 '+tr.id);boundaries++;}
 }}
const tr=all.find(t=>dispatch.plans[t.id]),changed={...tr,stops:tr.stops.map((s,i)=>({...s,depSec:s.depSec+(i===1?1:0)}))};assert.equal(motion.has(changed),false,'班表改動不可沿用舊派車');console.log({trains:Object.keys(dispatch.plans).length,samples,boundaries});
