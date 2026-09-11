import fs from 'node:fs';import assert from 'node:assert/strict';
import {createPlanBinding,physicalStopSignature} from '../rail-3d/physical/plan-binding.js';
// 2026-09-11 正式站當日高鐵班表 180 班有 33 班綁不上股道(24 班派車表沒有的新車次、9 班同車次只改了中途站到站時刻)。
// 綁不上的列車掉回示意線形,車廂逐節向附近股道借高度而折疊、在地面與地下之間跳。
// 這裡用派車表裡既有的 160 班合成同樣三種型態,守住「路徑可借、時間與待避不借」。
const dispatch=JSON.parse(fs.readFileSync('rail-3d/physical/dispatch.json')),network=JSON.parse(fs.readFileSync('rail-3d/physical/network.json'));
const rows=Object.entries(dispatch.plans).filter(([k])=>k.startsWith('thsr_sched:'));
const make=([key,p])=>({sys:'thsr_sched',train:key.split(':')[1],stops:JSON.parse(p.stopSignature).map(([n,arrSec,depSec])=>({name:n.split(':')[1],arrSec,depSec,stop:true}))});
const bind=createPlanBinding(dispatch);
const joined=ids=>ids.every((id,i)=>!i||network.paths[ids[i-1]].to===network.paths[id].from);
const clean=r=>r.plan.holds.every(h=>!h.arrival&&!h.departure)&&r.plan.departureHolds.every(h=>!h)&&!r.plan.officialDelaySec;
let retimed=0,renumbered=0,sliced=0;
for(const row of rows){const tr=make(row),[key,plan]=row;
  assert.equal(bind(tr).basis,'exact',key);
  if(tr.stops.length>2){ // 同車次、同站序、中途站到站時刻提早一分鐘(正式站 0627／0858／0862 等 9 班的型態)
    const r=structuredClone(tr);r.stops[1].arrSec-=60;const b=bind(r);
    assert(b,'改時刻的同車次要能綁上 '+key);assert.equal(b.basis,'retimed',key);
    assert.deepEqual(b.plan.pathIds,plan.pathIds,'改時刻要沿用自己原本的股道 '+key);assert(clean(b),'改時刻不可沿用舊待避 '+key);
    assert.equal(b.plan.stopSignature,physicalStopSignature(r));retimed++;}
  // 派車表沒有的新車次(正式站 1217／1563 等 24 班的型態):借同站序既有路徑,不借時間
  const extra={...tr,train:'9'+tr.train,stops:tr.stops.map(s=>({...s,arrSec:s.arrSec+77,depSec:s.depSec+77}))},e=bind(extra);
  assert(e,'新車次要借得到路徑 '+key);assert.equal(e.basis,'route-template',key);assert.equal(e.plan.pathIds.length,extra.stops.length-1);
  assert(joined(e.plan.pathIds),'借用路徑必須使用同一來源接頭 '+key);assert(clean(e),'新車次不可繼承來源待避 '+key);renumbered++;
  if(tr.stops.length>3){ // 只跑一段的新車次(正式站 3541 從台北起的型態):借既有路徑的連續切片
    const part={...tr,train:'8'+tr.train,stops:tr.stops.slice(1)},s=bind(part);
    assert(s&&s.basis==='route-template'&&s.plan.pathIds.length===part.stops.length-1&&joined(s.plan.pathIds),'切片新車次要借得到連續路徑 '+key);sliced++;}
}
assert(renumbered===rows.length&&retimed>=100&&sliced>=100,`覆蓋率不足 retimed ${retimed} renumbered ${renumbered} sliced ${sliced}`);
const tr=make(rows[0]);
const swapped=structuredClone(tr);[swapped.stops[1].name,swapped.stops[2].name]=[swapped.stops[2].name,swapped.stops[1].name];assert.equal(bind(swapped),null,'站序改變不可套舊路徑');
const backwards=structuredClone(tr);backwards.stops[1].arrSec=backwards.stops[1].depSec=backwards.stops[0].depSec-1;assert.equal(bind(backwards),null,'時間倒退不可綁');
const heldRow=rows.find(([,p])=>p.holds?.some(h=>h.arrival||h.departure));assert(heldRow,'派車表裡要有帶待避的高鐵計畫才驗得到待避防護');
{const r=make(heldRow);r.stops[1].arrSec-=60;const b=bind(r);assert(b&&b.basis==='retimed'&&clean(b),'改時刻不可繼承自己的舊待避');assert(heldRow[1].holds.some(h=>h.arrival||h.departure),'不可改寫來源計畫');}
assert.equal(bind({...tr,train:'TEST-UNKNOWN',stops:tr.stops.map((s,i)=>({...s,name:i===1?'不存在的測試站':s.name}))}),null,'未知站名不可借');
assert.equal(bind({...tr,sys:'tra_sched',train:'TEST-CROSS-SYSTEM'}),null,'高鐵站名不可借台鐵路徑');
assert.equal(bind({...tr,train:'TEST-LOOP',loop:true}),null,'環狀不可借');
const reverse={...tr,train:'TEST-REVERSE',stops:tr.stops.toReversed().map((s,i)=>({...s,arrSec:10000+i*600,depSec:10000+i*600+60}))},rp=bind(reverse);
assert(rp,'反方向新車次要對到反向站序');const src=JSON.parse(dispatch.plans[rp.sourceKey].stopSignature).map(s=>s[0].split(':')[1]);
assert(src.some((_,st)=>reverse.stops.every((s,i)=>src[st+i]===s.name)),'反方向必須對到反向站序');
console.log(`高鐵股道綁定：${rows.length} 班原計畫 exact、${retimed} 班改時刻 retimed、${renumbered} 班新車次與 ${sliced} 班切片 route-template、站序／倒退／待避／跨系統／環狀防護通過`);
