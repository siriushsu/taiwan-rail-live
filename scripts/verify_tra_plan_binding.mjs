import fs from 'node:fs';import assert from 'node:assert/strict';
import {createPlanBinding,physicalTrainKey,physicalStopSignature} from '../rail-3d/physical/plan-binding.js';
import {createPhysicalMotion} from '../rail-3d/physical/motion.js';
import {createRouteRuntime} from '../rail-3d/physical/route-runtime.js';import {profileProgress} from '../rail-3d/physical/timing.js';
import {makeSandbox,readPassObs,readTrackSections} from './build_run_profiles.mjs';import {farthestAlong} from './lib/track_section_via.mjs';
import {normSta,sectionKey} from './lib/parallel_tracks.mjs';import {runInContext} from 'node:vm';
const dispatch=JSON.parse(fs.readFileSync('rail-3d/physical/dispatch.json')),network=JSON.parse(fs.readFileSync('rail-3d/physical/network.json'));
const rows=Object.entries(dispatch.plans).filter(([k,p])=>k.startsWith('tra_sched:')&&!p.holds?.some(h=>h.arrival||h.departure));
const make=([key,p])=>({sys:'tra_sched',train:key.split(':')[1],stops:JSON.parse(p.stopSignature).map(([n,arrSec,depSec],i,a)=>({name:n.split(':')[1],arrSec,depSec,stop:i===0||i===a.length-1||arrSec!==depSec}))});
const entry=rows.find(e=>make(e).stops.slice(1,-1).some(s=>!s.stop)),tr=make(entry),bind=createPlanBinding(dispatch),pass=tr.stops.findIndex((s,i)=>i>0&&!s.stop);
assert.equal(bind(tr).basis,'exact');
const derived=structuredClone(tr);derived.stops[pass].arrSec+=.125;derived.stops[pass].depSec+=.125;assert.equal(bind(derived).basis,'derived-pass-times');assert.strictEqual(bind(derived).plan,entry[1]);
const planned=structuredClone(derived);planned.stops[pass]._plannedDwell=true;planned.stops[pass].depSec+=90;assert.equal(bind(planned).basis,'derived-pass-times');assert.strictEqual(bind(planned).plan,entry[1]);
const backwards=structuredClone(derived);backwards.stops[pass].arrSec=backwards.stops[pass].depSec=backwards.stops[pass-1].depSec-1;assert.equal(bind(backwards),null,'時間倒退不可被當成通過曲線更新');
// 改點（2026-10-03 起埔心、樹林、桃園幾班）：站序與停靠型態不變、原計畫沒有待避時，正式停靠改了時刻也沿用自己的股道，時間用今天的、待避歸零。
const changedStop=structuredClone(tr),stop=changedStop.stops.findIndex((s,i)=>i>0&&i<tr.stops.length-1&&s.stop);changedStop.stops[stop].depSec+=1;const retimed=bind(changedStop);
assert.equal(retimed?.basis,'retimed','正式停靠改時刻、站序與停靠型態不變時要沿用自己的股道');assert.deepEqual(retimed.plan.pathIds,entry[1].pathIds);assert.notStrictEqual(retimed.plan,entry[1]);assert.equal(retimed.plan.stopSignature,physicalStopSignature(changedStop));assert(retimed.plan.holds.every(h=>!h.arrival&&!h.departure)&&retimed.plan.departureHolds.every(v=>!v),'改點不可帶待避');
const earlyOrigin=structuredClone(tr);earlyOrigin.stops[0].arrSec-=300;assert.equal(bind(earlyOrigin)?.basis,'retimed','首站提早到站（406 型）要沿用自己的股道');
// 沿用自己的股道時一併帶上「不可借給別班當模板」的標記（藍皮 5898／5899 的非電化股道靠它守，verify_verified_station_routes 會查）；原計畫沒有這個標記就不加。
const blue=Object.entries(dispatch.plans).find(([k,p])=>k.startsWith('tra_sched:')&&p.templateEligible===false),blueTr=make(blue);blueTr.stops[0].arrSec-=60;const blueBind=bind(blueTr);assert.equal(blueBind?.basis,'retimed');assert.equal(blueBind.plan.templateEligible,false,'沿用自己股道要帶上不可當模板的標記');assert(!('templateEligible' in retimed.plan));
// 改到末站到站（1248／1254 型）派車鍵就變了：同車次、同站序、同停靠型態的自己的計畫照樣沿用，並回報沿用哪把鍵。
const lateEnd=structuredClone(tr);lateEnd.stops.at(-1).arrSec+=60;lateEnd.stops.at(-1).depSec+=60;const late=bind(lateEnd);assert.notEqual(physicalTrainKey(lateEnd),entry[0]);assert.equal(late?.basis,'retimed','末站改時刻（1248 型）要沿用自己的股道');assert.equal(late.sourceKey,entry[0]);assert.deepEqual(late.plan.pathIds,entry[1].pathIds);assert.equal(late.plan.stopSignature,physicalStopSignature(lateEnd));
// 鍵變了但停靠型態、站序不同或原計畫帶待避：不走沿用自己股道（retimed）這條，退回加開車的借路徑規則——
// 借到的仍可能是自己那份的路徑切片（加開車規則本來就允許），但待避一律歸零，不帶上替舊時刻解的交會。
const zeroHolds=r=>!r||r.plan.holds.every(h=>!h.arrival&&!h.departure)&&r.plan.departureHolds.every(v=>!v);
const lateSkipped=structuredClone(lateEnd);lateSkipped.stops[stop].stop=false;lateSkipped.stops[stop].depSec=lateSkipped.stops[stop].arrSec;const skippedBind=bind(lateSkipped);assert.notEqual(skippedBind?.basis,'retimed','鍵變了、停靠改通過不走 retimed');assert(zeroHolds(skippedBind));
const lateNames=structuredClone(lateEnd);[lateNames.stops[pass].name,lateNames.stops[pass+1].name]=[lateNames.stops[pass+1].name,lateNames.stops[pass].name];const namesBind=bind(lateNames);assert.notEqual(namesBind?.basis,'retimed','鍵變了、站序也變了不走 retimed');assert(zeroHolds(namesBind));
// 派車表若替同一車次存了兩版（日後重建時窗內兩版都在），取時刻最接近的那份。
const shift=(t,sec)=>({...t,stops:t.stops.map(s=>({...s,arrSec:s.arrSec+sec,depSec:s.depSec+sec}))}),twinKey=physicalTrainKey(shift(tr,3600)),twin={plans:{...dispatch.plans,[twinKey]:{...entry[1],pathIds:entry[1].pathIds.toReversed(),stopSignature:physicalStopSignature(shift(tr,3600))}}};
assert.equal(createPlanBinding(twin)(lateEnd).sourceKey,entry[0]);assert.equal(createPlanBinding(twin)(shift(lateEnd,3600)).sourceKey,twinKey,'同車次有兩份計畫時要取時刻最接近的那份');
const skipped=structuredClone(tr);skipped.stops[stop].stop=false;skipped.stops[stop].depSec=skipped.stops[stop].arrSec;assert.equal(bind(skipped),null,'停靠改通過不可套舊派車');
const added=structuredClone(tr);added.stops[pass].stop=true;added.stops[pass].depSec+=1;assert.equal(bind(added),null,'通過改停靠不可套舊派車');
const changedNames=structuredClone(tr);[changedNames.stops[pass].name,changedNames.stops[pass+1].name]=[changedNames.stops[pass+1].name,changedNames.stops[pass].name];assert.equal(bind(changedNames),null,'站序改變不可套舊路徑');
const held=structuredClone(dispatch);held.plans[entry[0]].holds[pass].departure=30;assert.equal(createPlanBinding(held)(derived),null,'通過時間更新不可沿用舊待避');assert.equal(createPlanBinding(held)(changedStop),null,'改點不可沿用帶待避的舊計畫');const heldLate=createPlanBinding(held)(lateEnd);assert.notEqual(heldLate?.basis,'retimed','鍵變了、原計畫帶待避時不走 retimed');assert(zeroHolds(heldLate),'借路徑時不可帶上舊待避');
const onlyHeld={plans:{[entry[0]]:held.plans[entry[0]]}},extraHeld={...tr,train:'TEST-HELD-SOURCE'},fresh=createPlanBinding(onlyHeld)(extraHeld);assert.equal(fresh.basis,'route-template');assert(fresh.plan.holds.every(h=>h.arrival===0&&h.departure===0),'加開車不可繼承來源待避');assert.equal(onlyHeld.plans[entry[0]].holds[pass].departure,30,'不可改寫來源計畫');
for(const plan of rows.slice(0,30)){const source=make(plan),extra={...source,train:'TEST-EXTRA-'+source.train,stops:source.stops.map(s=>({...s,arrSec:s.arrSec+77,depSec:s.depSec+77}))},r=bind(extra);assert.equal(r.basis,'route-template');assert.equal(r.plan.pathIds.length,extra.stops.length-1);assert(r.plan.holds.every(h=>!h.arrival&&!h.departure));assert.equal(r.plan.stopSignature,physicalStopSignature(extra));for(let i=1;i<r.plan.pathIds.length;i++)assert.equal(network.paths[r.plan.pathIds[i-1]].to,network.paths[r.plan.pathIds[i]].from,'借用路徑必須使用同一來源接頭');}
const reverse={...tr,train:'TEST-REVERSE',stops:tr.stops.toReversed().map((s,i)=>({...s,arrSec:10000+i*120,depSec:10000+i*120+(s.stop?30:0)}))},reversePlan=bind(reverse);assert(reversePlan);const source=JSON.parse(dispatch.plans[reversePlan.sourceKey].stopSignature).map(s=>s[0].split(':')[1]);assert(source.some((_,start)=>reverse.stops.every((s,i)=>source[start+i]===s.name)),'反方向必須對到反向站序');
assert.equal(bind({...tr,train:'TEST-UNKNOWN',stops:tr.stops.map((s,i)=>({...s,name:i===pass?'不存在的測試站':s.name}))}),null);
assert.equal(bind({...tr,sys:'thsr_sched',train:'TEST-CROSS-SYSTEM'}),null);
assert.equal(bind({...tr,train:'TEST-LOOP',loop:true}),null);
// 派車表沒有的中途站（2026-10 起的平鎮臨時站）3D 當作不存在：插在兩個相鄰站之間，通過或停靠都要綁回原本那份計畫，回傳綁定用的
// 站序（原班表的站物件）與它們在原班表的位置；首站前多一站、環島車不略過。現行資料沒有這種站，出貨鏈只有這裡會跑到這條路徑。
const gapAt=tr.stops.reduce((best,s,i)=>i&&s.arrSec-tr.stops[i-1].depSec>tr.stops[best].arrSec-tr.stops[best-1].depSec?i:best,1);
const withUnknown=(t,at,dwell)=>{const m=(t.stops[at-1].depSec+t.stops[at].arrSec)/2;return {...t,stops:[...t.stops.slice(0,at),{name:'派車表沒有的測試站',arrSec:m-dwell/2,depSec:m+dwell/2,stop:dwell>0},...t.stops.slice(at)]};};
for(const dwell of[0,30]){const u=withUnknown(tr,gapAt,dwell),r=bind(u);
 assert.equal(r?.basis,'exact',`派車表沒有的中途${dwell?'停靠':'通過'}站要略過、綁回原本那份計畫`);assert.strictEqual(r.plan,entry[1]);
 assert.deepEqual(r.stopIndexes,u.stops.map((_,i)=>i).filter(i=>i!==gapAt));assert(r.stops.every((s,i)=>s===u.stops[r.stopIndexes[i]]),'綁定站序要是原班表的站物件');}
const merged=withUnknown(tr,gapAt,0);
assert.equal(bind({...tr,stops:[{name:'派車表沒有的測試站',arrSec:tr.stops[0].arrSec-600,depSec:tr.stops[0].arrSec-600,stop:true},...tr.stops]}),null,'首站前多一個派車表沒有的站不可略過');
assert.equal(bind({...merged,loop:true}),null,'環島車不略過派車表沒有的站');
// 跨夜判斷（index.html schedWrapT）讀原班表陣列上的旗標（_prevNight 等）：取樣要把原陣列交給 wrap，不能交併段後新建的那份。
let wrapped=null;createPhysicalMotion(network,null,dispatch).sample(merged,0,{wrap:s=>{wrapped=s;return -1e9;}});
assert.strictEqual(wrapped,merged.stops,'跨夜判斷要拿原班表的站序陣列');
// ── 派車表沒有的中途「停靠」站（平鎮 C2）──────────────────────────────────────────────────────────────
// 3D 停在該站座標投影到原本那一段路徑上的點、停到官方離站時刻（motion.js 的 cuts），前後兩截各自照跑段剖面走；
// 剖面長 ≥ 那一截的實體長（index.html assignSchedShapePathsFor 拿股道表的 via 補下限，理由見 schedSegKmOf）。
// 現行資料沒有這種站，出貨鏈只有這裡跑得到：取一班真車「實體路徑比示意線形長最多」的一段，在 45% 處往左 20 m 插一個停 30 秒的
// 陌生站（其後各站 +120 秒，綁定走 retimed、沿用自己的股道），via 用產生器同一支 farthestAlong 算，剖面用 index.html 原文沙箱
// （build_run_profiles 的 makeSandbox）算。對照組：不補 via 時至少要有一截剖面比實體短——否則這組檢查沒有牙。
const hav=(a,b)=>{const r=Math.PI/180,x=Math.sin((b.lat-a.lat)*r/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin((b.lon-a.lon)*r/2)**2;return 2*6371000*Math.asin(Math.sqrt(x));};
const raw=fs.readFileSync('data/tra_schedule_dense.json','utf8'),sched=JSON.parse(raw),lines=JSON.parse(fs.readFileSync('data/tra.json')).lines,sections=readTrackSections('data/tra_track_sections.json');
const shaped=(trains,secs)=>{const ctx=makeSandbox('index.html');ctx.state.trackSections=secs;ctx.trains=trains;ctx.lines=lines;runInContext('canonicalizeAliasTrains(trains); clearPlannedOvertakes(trains); assignSchedShapePathsFor(trains, lines)',ctx);return ctx;};
const runtime=createRouteRuntime(network,null),motion=createPhysicalMotion(network,null,dispatch);
let best=null;
{const cands=sched.trains.slice(0,200).filter(t=>{const b=!t.loop&&bind({...t,sys:'tra_sched'});return b&&b.basis==='exact'&&!b.stopIndexes;}),clones=cands.map(t=>structuredClone({...t,sys:'tra_sched'})),ctx=shaped(clones,sections),segKm=runInContext('schedSegmentKm',ctx);
 clones.forEach((t,n)=>{const pl=bind(t).plan;t.stops.forEach((s,i)=>{const nx=t.stops[i+1];if(!nx||s.stop===false||nx.stop===false||nx.arrSec-s.depSec<300)return;
  const ratio=runtime.unfold(String(pl.pathIds[i])).path.length/(1000*(s.segLn?segKm(s):hav(s,nx)/1000));if(!best||ratio>best.ratio)best={src:cands[n],i,ratio,pid:pl.pathIds[i]};});});}
assert(best&&best.ratio>1.005,`要找得到實體路徑比示意線形長的站間（最大比例 ${best?.ratio}）`);
const I=best.i,K=I+1,s0=best.src.stops,path=runtime.unfold(String(best.pid)).path,sU=path.length*.45,[pa,pb,pc]=[sU-5,sU+5,sU].map(x=>path.at(x).coordinate),mx=111320*Math.cos(pc[1]*Math.PI/180);
const ex=(pb[0]-pa[0])*mx,ny=(pb[1]-pa[1])*111320,nn=Math.hypot(ex,ny),U=[pc[0]-ny/nn*20/mx,pc[1]+ex/nn*20/111320],NAME='派車表沒有的測試停靠站';
const uArr=Math.round(s0[I].depSec+(s0[K].arrSec-s0[I].depSec)*.45+30);
const synth=()=>({...best.src,sys:'tra_sched',stops:[...s0.slice(0,K).map(x=>({...x})),{name:NAME,lat:U[1],lon:U[0],arrSec:uArr,depSec:uArr+30,stop:true},...s0.slice(K).map(x=>({...x,arrSec:x.arrSec+120,depSec:x.depSec+120}))]});
const key=sectionKey(s0[I].name,s0[K].name),dirs=new Map();
for(const[pk,p]of Object.entries(dispatch.plans)){if(!pk.startsWith('tra_sched:'))continue;const sig=JSON.parse(p.stopSignature);
 for(let j=0;j+1<sig.length;j++){const a=sig[j][0].split(':')[1],b=sig[j+1][0].split(':')[1];if(sectionKey(a,b)===key&&!dirs.has(String(p.pathIds[j])))dirs.set(String(p.pathIds[j]),normSta(a)===key.split('|')[0]);}}
const far=farthestAlong(runtime,dirs,[U]),up=m=>+((Math.ceil(m*1000)+1)/1000).toFixed(3);
const syn=synth(),ctl=synth();shaped([syn],{...sections,[key]:{...sections[key],via:{[normSta(NAME)]:[up(far.first),up(far.second)]}}});shaped([ctl],sections);
const rec=motion.record(syn),loc=path.locate(U),Q=path.at(loc.s).coordinate,proj={lat:Q[1],lon:Q[0]};
assert(rec&&rec.plan.pathIds[I]===best.pid&&!rec.stopIndexes.includes(K)&&rec.stopIndexes.includes(I)&&rec.stopIndexes.includes(K+1),'陌生停靠站要略過、那一段照舊走原本的路徑');
assert.deepEqual(rec.cuts?.[I]?.map(c=>c.k),[K],'那一段要在陌生停靠站切開');assert(Math.abs(rec.cuts[I][0].at-loc.s)<1e-9,'切點＝站座標投影到那一段路徑上的位置');
for(let t=uArr;t<=uArr+30;t+=.5){const p=motion.sample(syn,t);assert(p?.physical&&p.dwell&&p.stopIndex===K&&hav(p,proj)<=.01,`${t} 秒：官方停留時段內要停在投影點`);}
for(const[t0,t1]of[[uArr-.01,uArr],[uArr+30,uArr+30.01]])assert(hav(motion.sample(syn,t0),motion.sample(syn,t1))<1,`${t0}→${t1} 秒：進出站不可跳`);
const pieces=[loc.s,path.length-loc.s],prof=x=>[x.stops[I].rpSegKm*1000,x.stops[K].rpSegKm*1000];
assert(syn.stops[I].rp&&syn.stops[K].rp&&syn.stops[I].rp!==syn.stops[K].rp,'兩截各有自己的跑段剖面');
assert(prof(syn).every((m,j)=>m>=pieces[j]),`兩截剖面長 ${prof(syn)} 要 ≥ 實體長 ${pieces}`);
assert(prof(ctl).some((m,j)=>m<pieces[j]),`對照組（不補 via）要有一截剖面比實體短，否則這組檢查沒有牙：${prof(ctl)} vs ${pieces}`);
let moving=0;
for(let t=syn.stops[I].depSec;t+.5<=syn.stops[K+1].arrSec;t+=.5){const a=motion.sample(syn,t),b=motion.sample(syn,t+.5);if(!a?.physical||!b?.physical||a.dwell||b.dwell||a.stopIndex!==b.stopIndex)continue;
 const st=a.rawTime<uArr?syn.stops[I]:syn.stops[K],D=x=>profileProgress(st.rp,x-st.rpDep)*st.rp.L;moving++;
 assert(b.chainageM-a.chainageM<=(D(b.rawTime)-D(a.rawTime))*(1+1e-9)+1e-9,`${t} 秒：點速不可超過剖面速度`);}
assert(moving>100,`兩截行駛取樣 ${moving}`);
// 同向待避不選實體股道表沒有的站（index.html planSameDirectionOvertakes）：拿現行資料第一天、照前端同一條每日管線選站，
// 把選中的第一個待避站從股道表拿掉重跑，那一站就不能再被選；表不動時要選得到（對照組，證明這條檢查有牙）。
const plannedOn=(day,secs)=>{const sc=JSON.parse(raw),ctx=makeSandbox('index.html');ctx.state.passObs=readPassObs('data/tra_pass_obs.json');ctx.state.trackSections=secs;
 for(const t of sc.trains)t.sys='tra_sched';ctx.trs=sc.dates[day].map(i=>sc.trains[i]);ctx.lines=lines;ctx.union={trains:sc.trains,dates:sc.dates};
 runInContext('canonicalizeAliasTrains(trs); clearPlannedOvertakes(trs); assignSchedShapePathsFor(trs, lines); resolveTraTraffic(trs, union, state.trackSections)',ctx);
 return ctx.trs.flatMap(t=>t.stops.filter(s=>s._plannedDwell).map(s=>({no:String(t.train),station:s.name})));};
const day=Object.keys(sched.dates).sort()[0],waits=plannedOn(day,sections);
assert(waits.length>0,`${day} 要有預排待避（對照組）`);
const X=normSta(waits[0].station),atX=waits.filter(p=>normSta(p.station)===X).length,untracked=Object.fromEntries(Object.entries(sections).filter(([pk])=>!pk.split('|').includes(X)));
assert(Object.keys(untracked).length<Object.keys(sections).length,`股道表要真的拿掉 ${X}`);
assert(!plannedOn(day,untracked).some(p=>normSta(p.station)===X),`股道表沒有 ${X} 時不可選它當待避站`);
console.log(`台鐵股道綁定：通過時刻更新、改點沿用股道、停靠型態／待避防護、30 班加開模板、雙方向與未知路徑、派車表沒有的中途站略過檢查通過；派車表沒有的中途停靠站（${best.src.train} 次 ${s0[I].name}→${s0[K].name}，實體／示意 ${best.ratio.toFixed(4)}）停在投影點、兩截剖面長 ≥ 實體、點速 ≤ 剖面速度（${moving} 個取樣）；${day} 拿掉 ${X} 後不選它待避（原本在那裡待避 ${atX} 次，當天共 ${waits.length} 次）`);
