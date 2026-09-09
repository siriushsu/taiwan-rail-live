import fs from 'node:fs';import assert from 'node:assert/strict';
import {createPlanBinding,physicalTrainKey,physicalStopSignature} from '../rail-3d/physical/plan-binding.js';
const dispatch=JSON.parse(fs.readFileSync('rail-3d/physical/dispatch.json')),network=JSON.parse(fs.readFileSync('rail-3d/physical/network.json'));
const rows=Object.entries(dispatch.plans).filter(([k,p])=>k.startsWith('tra_sched:')&&!p.holds?.some(h=>h.arrival||h.departure));
const make=([key,p])=>({sys:'tra_sched',train:key.split(':')[1],stops:JSON.parse(p.stopSignature).map(([n,arrSec,depSec],i,a)=>({name:n.split(':')[1],arrSec,depSec,stop:i===0||i===a.length-1||arrSec!==depSec}))});
const entry=rows.find(e=>make(e).stops.slice(1,-1).some(s=>!s.stop)),tr=make(entry),bind=createPlanBinding(dispatch),pass=tr.stops.findIndex((s,i)=>i>0&&!s.stop);
assert.equal(bind(tr).basis,'exact');
const derived=structuredClone(tr);derived.stops[pass].arrSec+=.125;derived.stops[pass].depSec+=.125;assert.equal(bind(derived).basis,'derived-pass-times');assert.strictEqual(bind(derived).plan,entry[1]);
const backwards=structuredClone(derived);backwards.stops[pass].arrSec=backwards.stops[pass].depSec=backwards.stops[pass-1].depSec-1;assert.equal(bind(backwards),null,'時間倒退不可被當成通過曲線更新');
const changedStop=structuredClone(tr),stop=changedStop.stops.findIndex((s,i)=>i>0&&i<tr.stops.length-1&&s.stop);changedStop.stops[stop].depSec+=1;assert.equal(bind(changedStop),null,'正式停靠時間改變不可套舊派車');
const changedNames=structuredClone(tr);[changedNames.stops[pass].name,changedNames.stops[pass+1].name]=[changedNames.stops[pass+1].name,changedNames.stops[pass].name];assert.equal(bind(changedNames),null,'站序改變不可套舊路徑');
const held=structuredClone(dispatch);held.plans[entry[0]].holds[pass].departure=30;assert.equal(createPlanBinding(held)(derived),null,'通過時間更新不可沿用舊待避');
const onlyHeld={plans:{[entry[0]]:held.plans[entry[0]]}},extraHeld={...tr,train:'TEST-HELD-SOURCE'},fresh=createPlanBinding(onlyHeld)(extraHeld);assert.equal(fresh.basis,'route-template');assert(fresh.plan.holds.every(h=>h.arrival===0&&h.departure===0),'加開車不可繼承來源待避');assert.equal(onlyHeld.plans[entry[0]].holds[pass].departure,30,'不可改寫來源計畫');
for(const plan of rows.slice(0,30)){const source=make(plan),extra={...source,train:'TEST-EXTRA-'+source.train,stops:source.stops.map(s=>({...s,arrSec:s.arrSec+77,depSec:s.depSec+77}))},r=bind(extra);assert.equal(r.basis,'route-template');assert.equal(r.plan.pathIds.length,extra.stops.length-1);assert(r.plan.holds.every(h=>!h.arrival&&!h.departure));assert.equal(r.plan.stopSignature,physicalStopSignature(extra));for(let i=1;i<r.plan.pathIds.length;i++)assert.equal(network.paths[r.plan.pathIds[i-1]].to,network.paths[r.plan.pathIds[i]].from,'借用路徑必須使用同一來源接頭');}
const reverse={...tr,train:'TEST-REVERSE',stops:tr.stops.toReversed().map((s,i)=>({...s,arrSec:10000+i*120,depSec:10000+i*120+(s.stop?30:0)}))},reversePlan=bind(reverse);assert(reversePlan);const source=JSON.parse(dispatch.plans[reversePlan.sourceKey].stopSignature).map(s=>s[0].split(':')[1]);assert(source.some((_,start)=>reverse.stops.every((s,i)=>source[start+i]===s.name)),'反方向必須對到反向站序');
assert.equal(bind({...tr,train:'TEST-UNKNOWN',stops:tr.stops.map((s,i)=>({...s,name:i===pass?'不存在的測試站':s.name}))}),null);
assert.equal(bind({...tr,sys:'thsr_sched',train:'TEST-CROSS-SYSTEM'}),null);
assert.equal(bind({...tr,train:'TEST-LOOP',loop:true}),null);
console.log('台鐵股道綁定：通過時刻更新、停靠／待避防護、30 班加開模板、雙方向與未知路徑檢查通過');
