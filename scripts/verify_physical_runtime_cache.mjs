// 使用同一份真實班表與來源檔比較逐幀採樣，不把零衝突當作 gate。
import assert from 'node:assert/strict';import fs from 'node:fs';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';import path from 'node:path';
import {createPhysicalMotion} from '../rail-3d/physical/motion.js';import {makePath} from '../rail-3d/integration/train-path.js';
const read=p=>JSON.parse(fs.readFileSync(p));const root=process.cwd();
const original=async p=>{let s=execFileSync('git',['show','b5d7ff27:'+p],{encoding:'utf8'});s=s.replace(/from '([^']+)'/g,(_,rel)=>`from '${pathToFileURL(path.resolve(path.dirname(p),rel)).href}'`);return import('data:text/javascript;base64,'+Buffer.from(s).toString('base64'));};
const oldPath=(await original('rail-3d/integration/train-path.js')).makePath,oldMotion=(await original('rail-3d/physical/motion.js')).createPhysicalMotion;
let trains;
if(process.env.TRAINS_FIXTURE)trains=read(process.env.TRAINS_FIXTURE);
else {
  const {chromium}=await import('playwright'),browser=await chromium.launch();
  try {const page=await browser.newPage();await page.goto((process.env.BASE_URL||'http://127.0.0.1:5207/')+'?g=all&t=08:00');await page.waitForFunction(()=>state.ready&&state.trains.length>0&&window.railIslandPhysical);trains=await page.evaluate(()=>state.trains.map(tr=>({sys:tr.sys,train:tr.train,color:tr.color,stops:tr.stops.map(s=>({name:s.name,arrSec:s.arrSec,depSec:s.depSec,rp:s.rp,rpDep:s.rpDep,rpSegKm:s.rpSegKm,rpOff:s.rpOff}))})));}
  finally {await browser.close();}
}
const pack=read('rail-3d/physical/network.json'),profiles=read('rail-3d/physical/display-profiles.json'),dispatch=read('rail-3d/physical/dispatch.json');
const current=createPhysicalMotion(structuredClone(pack),profiles,dispatch),baseline=oldMotion(structuredClone(pack),profiles,dispatch);let samples=0,active=[],retained=0;
const payload=p=>p&&({lat:p.lat,lon:p.lon,chainageM:p.chainageM,route:p.route.id,dwell:p.dwell,formationFacing:p.formationFacing,rawTime:p.rawTime});
for(const tr of trains){for(const t of [tr.stops[0].depSec,28800,43200,tr.stops.at(-1).arrSec]){assert.deepEqual(payload(current.sample(tr,t)),payload(baseline.sample(tr,t)));samples++;}const p=current.sample(tr,28800);if(p)active.push([tr,p]);}
for(let frame=0;frame<5;frame++)for(const [tr,p]of active){const v=current.sample(tr,28800);assert.strictEqual(v.route,p.route,'活躍列車的路線不可因其他車擠滿 LRU 而每幀重建');retained++;}
let locate=0;for(const w of pack.ways.filter(w=>w.coordinates.length>8).slice(0,30)){for(const coords of [w.coordinates,w.coordinates.toReversed()]){const a=oldPath(coords),b=makePath(coords);for(const f of [0,.1,.5,.9,1]){const at=a.at(a.length*f);for(const hint of [undefined,null,0,at.s,at.s-350,at.s+350,a.length+500,NaN]){assert.deepEqual(b.locate(at.coordinate,hint),a.locate(at.coordinate,hint));locate++;}}}}
// 格網邊界、遠離走廊、長跨格線段與重複／折返路段，也必須與完整掃描逐值一致。
let seed=907;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
const metro=read('rail-3d/physical/metro-network.json');
for(const w of [...pack.ways,...metro.ways].filter(w=>w.coordinates.length>64).slice(0,100))for(const coords of [w.coordinates,w.coordinates.toReversed()]){
  const a=oldPath(coords),b=makePath(coords);
  for(let i=0;i<80;i++){const at=a.at(a.length*random()),scale=i%3===0?.5:i%3===1?.008:.00001,coord=[at.coordinate[0]+(random()-.5)*scale,at.coordinate[1]+(random()-.5)*scale];for(const hint of [undefined,null,at.s]){assert.deepEqual(b.locate(coord,hint),a.locate(coord,hint));locate++;}}
}
const crossing=Array.from({length:70},(_,i)=>[121+(i%2)*.5,25+(i%3)*.004]);
for(const coords of [crossing,crossing.toReversed()]){const a=oldPath(coords),b=makePath(coords);for(const coord of [[121,25],[121.004,25.004],[121.25,25.002],[0,0]])for(const hint of [undefined,null,0,a.length/2]){assert.deepEqual(b.locate(coord,hint),a.locate(coord,hint));locate++;}}
console.log({samples,active:active.length,retained,locate,directions:2});
