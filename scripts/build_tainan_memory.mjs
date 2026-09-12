// 一次性封存：由指定日期的官方班表與已上線股道模型取樣，重播端不再讀取即時資料。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {computeProfiles,readPassObs} from './build_run_profiles.mjs';
import {createPhysicalMotion} from '../rail-3d/physical/motion.js';
import {formationFor,assembleFormation} from '../rail-3d/integration/formations.js';
const root=path.resolve(import.meta.dirname,'..'), out=path.join(root,'memories/tainan-2026-09-12');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(fs.existsSync(path.join(out,'snapshot.json'))&&!process.argv.includes('--replace-local-snapshot'))throw Error('封存已存在；不可隨日常更新覆蓋。另選日期，或明確使用 --replace-local-snapshot 重建本機未上線版本。');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(path.join(out,'vendor'),{recursive:true});fs.mkdirSync(path.join(out,'fleet'),{recursive:true});
const date='2026-09-12',previous='2026-09-11',bounds=[120.19,22.928,120.255,23.023];
const inside=p=>p[0]>=bounds[0]&&p[0]<=bounds[2]&&p[1]>=bounds[1]&&p[1]<=bounds[3];
const schedule=read('data/tra_schedule_dense.json'),track=read('data/tra.json'),pack=read('rail-3d/physical/network.json'),profiles=read('rail-3d/physical/display-profiles.json'),dispatch=read('rail-3d/physical/dispatch.json');
const selected=[];
for(const [day,offset] of [[previous,-86400],[date,0]]){
 if(!schedule.dates[day])throw Error('班表沒有 '+day);
 for(const index of schedule.dates[day]){const tr=schedule.trains[index];
  const stop=tr.stops.find(s=>s.name.replace('台','臺')==='臺南');if(!stop)continue;
  if(offset&&stop.depSec<86400-1800)continue;
  selected.push({day,offset,index,tr:structuredClone(tr)});
 }
}
const original=selected.map(({day,index,tr})=>({serviceDate:day,sourceIndex:index,...structuredClone(tr)}));
computeProfiles({indexPath:path.join(root,'index.html'),schedule:{trains:selected.map(v=>v.tr)},track,passObs:readPassObs(path.join(root,'data/tra_pass_obs.json'))});
const motion=createPhysicalMotion(pack,profiles,dispatch),routes=[],routeKeys=new Map(),trains=[],misses=[],fleetSource=read('rail-3d/assets/blender-map-v1/manifest.json'),fleet={models:{},meshes:{}},formKeys=new Set();
for(const {tr,day,offset,index} of selected){
 const r=motion.record(tr);if(!r){misses.push(tr.train);continue;}
 const center=tr.stops.findIndex(s=>s.name.replace('台','臺')==='臺南'),a=Math.max(0,center-1),b=Math.min(tr.stops.length-1,center+1);
 const start=Math.max(-offset,Math.floor(r.schedule[a].arrSec)),end=Math.min(86399-offset,Math.ceil(r.schedule[b].depSec));
 const spans=[];let span=null,oldSample=null;
 for(let t=start;t<=end;t++){
  const p=motion.sample(tr,t,{wrap:(s,t)=>t});if(!p||!inside([p.lon,p.lat])){span=null;oldSample=null;continue;}
  if(!routeKeys.has(p.route.id)){routeKeys.set(p.route.id,routes.length);routes.push({id:p.route.id,coordinates:p.route.coordinates});}
  const ri=routeKeys.get(p.route.id),sec=t+offset;
  if(!span||span.route!==ri){
   if(span&&oldSample){const loc=oldSample.route.path.locate([p.lon,p.lat],oldSample.chainageM);if(!loc||loc.error>.1)throw Error('路段切換不連續 '+tr.train);span.s.push(+loc.s.toFixed(3));}
   span={route:ri,start:sec,s:[]};spans.push(span);
  }
  span.s.push(+p.chainageM.toFixed(3));oldSample=p;
 }
 if(!spans.length)continue;
 const spec=formationFor({systemId:'tra_sched',carName:tr.carName}),formation=assembleFormation(spec,fleetSource);formKeys.add(spec.id);
 trains.push({id:`${day}:${index}:${tr.train}`,train:tr.train,typeName:tr.typeName,carName:tr.carName,color:tr.color,serviceDate:day,direction:tr.stops[b].lat>tr.stops[a].lat?'北上':'南下',formation,spans,stops:tr.stops.slice(a,b+1).map(s=>({name:s.name,arrSec:s.arrSec+offset,depSec:s.depSec+offset,stop:s.stop!==false}))});
}
if(misses.length)throw Error('股道未匹配，不封存缺漏班次：'+misses.join(','));
for(const id of formKeys){fleet.models[id]=fleetSource.models[id];for(const p of fleet.models[id].parts){const m=fleetSource.meshes[p.mesh];fleet.meshes[p.mesh]=m;fs.copyFileSync(path.join(root,'rail-3d/assets/blender-map-v1',m.file),path.join(out,'fleet',m.file));}}
for(const [src,name] of [['rail-3d/vendor/three.module.js','three.module.js'],['rail-3d/vendor/three-LICENSE.txt','three-LICENSE.txt'],['rail-3d/integration/train-path.js','train-path.js'],['rail-3d/assets/wenhu-v1/wenhu.js','mesh.js']])fs.copyFileSync(path.join(root,src),path.join(out,'vendor',name));
const info=read('data/tra_station_info.json'),stations=['大橋','台南','保安'].map(name=>({name:info[name].name,lon:info[name].lon,lat:info[name].lat,id:info[name].id}));
// 路網獨立於班次；只封存營運軌道，排除施工中的未來線形。
const rails=pack.ways.filter(w=>w.system==='tra_sched'&&w.tags?.railway==='rail'&&w.coordinates.some(inside)).map(w=>({id:w.id,tags:w.tags,coordinates:w.coordinates}));
const context=read('prototypes/tiny-trains/blender/tainan-memory-v1/context-source.json');
const features=context.elements.filter(e=>e.geometry&&((e.tags?.highway&&!['footway','path','steps','cycleway','service'].includes(e.tags.highway))||e.tags?.railway==='platform'||e.tags?.building)).map(e=>({id:e.id,tags:e.tags,coordinates:e.geometry.map(p=>[p.lon,p.lat])}));
const inputFiles=['data/tra_schedule_dense.json','data/tra.json','data/tra_station_info.json','data/tra_pass_obs.json','rail-3d/physical/network.json','rail-3d/physical/display-profiles.json','rail-3d/physical/dispatch.json','prototypes/tiny-trains/blender/tainan-memory-v1/context-source.json'];
const snapshot={schema:1,date,timezone:'Asia/Taipei',bounds,origin:[120.21295,22.99681],startSec:0,endSec:86399,stepSec:1,stations,rails,routes,trains,features,sources:inputFiles.map(file=>({file,sha256:hash(fs.readFileSync(path.join(root,file)))})),note:'依 2026-09-12 封存班表與地面股道推演，非實際行車錄影或即時誤點。車型採本站代表外觀；未知當班編組顯示 3 節示意。道路與輪廓為封存時 OSM 資料，背景高度簡化；範圍為大橋至保安周邊，非工程計畫邊界。'};
fs.writeFileSync(path.join(out,'snapshot.json'),JSON.stringify(snapshot));fs.writeFileSync(path.join(out,'source-schedule.json'),JSON.stringify({date,sourceNotes:schedule.source_notes,trains:original}));fs.writeFileSync(path.join(out,'fleet/catalog.json'),JSON.stringify(fleet));
console.log(JSON.stringify({date,trains:trains.length,overnight:trains.filter(t=>t.serviceDate!==date).length,directions:Object.fromEntries(['北上','南下'].map(d=>[d,trains.filter(t=>t.direction===d).length])),routes:routes.length,rails:rails.length,samples:trains.reduce((n,t)=>n+t.spans.reduce((a,s)=>a+s.s.length,0),0),bytes:fs.statSync(path.join(out,'snapshot.json')).size}));
