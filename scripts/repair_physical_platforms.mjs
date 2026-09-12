// 台鐵月台指派的局部修復:把「兩班車同時停在同一個停車節點」的那一族拆到不同月台股道。
//
// 為什麼不是重跑 optimize_physical_dispatch：
//   CP-SAT 全解在 2026-09-12 連續四種預算(30/60/120/240/900 秒)都回 UNKNOWN,加了 FOCUS
//   把非衝突車釘在現況也一樣。而且它的目標函數是「佔用預約無重疊」,那個模型我做不出可信的
//   正向對照 —— 拿高鐵(出貨閘門宣稱零重疊、當天才剛修好)重算,同一日型內照樣量到 811~1296 筆,
//   代表我重建不出求解器當初的輸入。所以這支**不用佔用模型**,只用停站時刻的區間重疊:
//   兩班車的停站時窗在同一個節點上相交 —— 這件事跟行車曲線、跟車長都無關,不會漂。
//
// 只做一件事:換停車節點,同時改該站的進出兩段路徑(起訖站只有一側)。
//   * 不新增股道:候選節點一律取「整份派車表曾經派過該站的節點」,不憑空造月台。
//   * 不動 network.json ⇒ 不必重跑 build_rail_levels(層位雜湊不變)。
//   * 不加任何 hold ⇒ derived-pass-times 的重綁不會失效(plan-binding.js 的 noHolds)。
//   * 一份計畫被 14 天共用,所以每次試換都對整個視窗重算,不是只看今天。
//   * 借路徑(route-template)的車要改就得先落成自己的計畫,順帶把它升成 exact。
//
// 2026-09-12 實測:同月台同時佔用 14 天合計 1626 → 449 筆(去重 229 → 49 對),動 94 班、
// 新落成 25 份計畫;出貨閘門 verify_physical_no_overlap 的 B 類 188 → 51 筆。
// 剩下的修不掉,原因分三種:該站在拓樸裡只有一個停車節點(例:太麻里)、換過去沒有可接的
// 進出路徑、或換了反而更糟。要再往下清得補拓樸或重解,不是這支的範圍。
//
// 跑法:node scripts/repair_physical_platforms.mjs   (預設寫 output/dispatch-tra-repaired.json,
// 檢查過再自己覆蓋 rail-3d/physical/dispatch.json;OUT= 可換輸出路徑)
// 🔴 重抓班表(npm run fetch-schedule)之後要重跑這支,否則新班次會回到同月台疊車。
import fs from 'node:fs';
import {restorePhysicalRoutes} from './lib/restore_physical_routes.mjs';
import {createPlanBinding,physicalTrainKey,physicalStopSignature} from '../rail-3d/physical/plan-binding.js';
import {stationKey} from '../rail-3d/physical/timing.js';
import {formationFor} from '../rail-3d/integration/formations.js';

const SYS='tra_sched',OUT=process.env.OUT||'output/dispatch-tra-repaired.json';
const dispatch=JSON.parse(fs.readFileSync('rail-3d/physical/dispatch.json'));
const net=JSON.parse(fs.readFileSync('rail-3d/physical/network.json'));
const sched=JSON.parse(fs.readFileSync('data/tra_schedule_dense.json'));
const {paths}=restorePhysicalRoutes(net);
const link=new Map();                       // from>to → [pathId]
paths.forEach((p,id)=>{if(!p||p.system!==SYS)return;const k=p.from+'>'+p.to;(link.get(k)??link.set(k,[]).get(k)).push(id);});

// 站 → 該站曾被派過的停車節點(整份派車表的證據,不憑空造月台)
const nodesOf=new Map();
for(const [id,p] of Object.entries(dispatch.plans)){
  if(!id.startsWith(SYS+':'))continue;let sig;try{sig=JSON.parse(p.stopSignature);}catch{continue;}
  if(sig.length!==p.pathIds.length+1)continue;
  for(let i=0;i<p.pathIds.length;i++){const pa=paths[p.pathIds[i]];if(!pa)continue;
    (nodesOf.get(sig[i][0])??nodesOf.set(sig[i][0],new Set()).get(sig[i][0])).add(pa.from);
    (nodesOf.get(sig[i+1][0])??nodesOf.set(sig[i+1][0],new Set()).get(sig[i+1][0])).add(pa.to);}}

// 逐日名冊:每班綁到的 pathIds(綁不到的跳過,它們畫示意線形、不吃股道)
const bind=createPlanBinding(dispatch);
const days=Object.keys(sched.dates).sort(),roster=new Map();
const plans=JSON.parse(JSON.stringify(dispatch.plans));   // 要改的副本
for(const day of days){const list=[];
  for(const ix of sched.dates[day]){const t=sched.trains[ix];
    const tr={sys:SYS,system:SYS,train:String(t.train),stops:t.stops.map(s=>({name:s.name,arrSec:s.arrSec,depSec:s.depSec,stop:s.stop}))};
    const b=bind(tr);if(!b?.plan||b.plan.pathIds.length!==tr.stops.length-1)continue;
    list.push({key:physicalTrainKey(tr),no:tr.train,stops:tr.stops,basis:b.basis,
      names:tr.stops.map(s=>stationKey(SYS,s.name)),bound:b.plan.pathIds.slice()});}
  roster.set(day,list);}
console.log('逐日名冊:',days.map(d=>d.slice(5)+':'+roster.get(d).length).join(' '));

// 目前每班實際用的 pathIds:有自己的計畫就用計畫(可改),借的就用借到的(要改得先落成自己的計畫)
const current=new Map();                    // key → pathIds(參照 plans[key] 或借來的副本)
const borrowed=new Map();                   // key → 借到的 pathIds(尚未落成計畫)
for(const day of days)for(const t of roster.get(day)){
  if(plans[t.key])current.set(t.key,plans[t.key].pathIds);
  else if(!borrowed.has(t.key)){borrowed.set(t.key,t.bound);current.set(t.key,t.bound);}}
console.log('有自己計畫的車次鍵',[...current.keys()].filter(k=>plans[k]).length,'借路徑的',borrowed.size);

const carName=new Map();for(const day of days)for(const ix of sched.dates[day]){const t=sched.trains[ix];if(!carName.has(String(t.train)))carName.set(String(t.train),t.carName);}
const lenOf=no=>{const f=formationFor({systemId:SYS,carName:carName.get(no)},'actual');return f?f.lengths.reduce((a,b)=>a+b,0):null;};
const nodeAt=(pathIds,i)=>i===0?paths[pathIds[0]]?.from:paths[pathIds[i-1]]?.to;
const ov=(a0,a1,b0,b1)=>Math.min(a1,b1)-Math.max(a0,b0);

// 逐日的節點佔用:node → [{key,no,day,i,a,b}]
function occupancy(){const byDay=new Map();
  for(const day of days){const node=new Map();
    for(const t of roster.get(day)){const ids=current.get(t.key);if(!ids)continue;
      for(let i=0;i<t.stops.length;i++){if(t.stops[i].stop===false)continue;
        const n=nodeAt(ids,i);if(n===undefined)continue;
        (node.get(n)??node.set(n,[]).get(n)).push({key:t.key,no:t.no,day,i,a:t.stops[i].arrSec,b:t.stops[i].depSec,station:t.names[i]});}}
    byDay.set(day,node);}
  return byDay;}
function conflicts(byDay){const out=[];
  for(const day of days)for(const [n,l] of byDay.get(day))
    for(let i=0;i<l.length;i++)for(let j=i+1;j<l.length;j++)
      if(l[i].key!==l[j].key&&ov(l[i].a,l[i].b,l[j].a,l[j].b)>0)out.push({node:n,day,x:l[i],y:l[j]});
  return out;}

let byDay=occupancy(),list=conflicts(byDay);
const dedup=c=>new Set(c.map(x=>[x.x.no,x.y.no].sort().join('×')+'@'+x.node)).size;
console.log('修復前:同月台同時',list.length,'筆,去重',dedup(list),'對,涉及站',new Set(list.map(c=>c.x.station)).size);

// 貪婪修:每一筆衝突試著把「其中一班」搬到同站別的停車節點。
// 只改該站的進出兩段,前後站節點不動 ⇒ 影響範圍最小,也不會動到別站的佔用。
const stats={修好:0,無替代節點:0,無可用路徑:0,換了會更糟:0};
const changed=new Map();                    // key → [{i,station,from,to}]
function tryMove(t,i){
  const ids=current.get(t.key);if(!ids)return false;
  const last=t.stops.length-1,cur=nodeAt(ids,i);
  // 起訖站只有一側有相鄰段,反而更好換:只要改那一段的端點。中途站要進出兩段都有候選路徑。
  const prev=i>0?paths[ids[i-1]]?.from:null,next=i<last?paths[ids[i]]?.to:null;
  if((i>0&&prev===undefined)||(i<last&&next===undefined))return false;
  const options=[...(nodesOf.get(t.names[i])||[])].filter(n=>n!==cur);
  if(!options.length){stats.無替代節點++;return false;}
  let any=false;
  for(const n of options){
    const inL=i>0?(link.get(prev+'>'+n)||[]):[null],outL=i<last?(link.get(n+'>'+next)||[]):[null];
    if(!inL.length||!outL.length)continue;any=true;
    for(const a of inL)for(const b of outL){
      const save=[i>0?ids[i-1]:null,i<last?ids[i]:null];
      if(a!==null)ids[i-1]=a;if(b!==null)ids[i]=b;
      const after=conflicts(occupancy());
      if(after.length<best.length){best=after;stats.修好++;
        (changed.get(t.key)??changed.set(t.key,[]).get(t.key)).push({i,station:t.names[i],from:cur,to:n});return true;}
      if(save[0]!==null)ids[i-1]=save[0];if(save[1]!==null)ids[i]=save[1];}}
  if(!any)stats.無可用路徑++;else stats.換了會更糟++;
  return false;}

let best=list;
const trainOf=new Map();for(const day of days)for(const t of roster.get(day))if(!trainOf.has(t.key))trainOf.set(t.key,t);
for(let round=0;round<12;round++){
  const before=best.length;
  // 衝突多的車次先處理
  const load=new Map();for(const c of best)for(const s of [c.x,c.y])load.set(s.key+'@'+s.i,(load.get(s.key+'@'+s.i)||0)+1);
  const order=[...load.entries()].sort((a,b)=>b[1]-a[1]).map(([k])=>k);
  for(const k of order){const [key,i]=[k.slice(0,k.lastIndexOf('@')),+k.slice(k.lastIndexOf('@')+1)];
    const t=trainOf.get(key);if(t)tryMove(t,i);}
  console.log(`第 ${round+1} 輪:${before} → ${best.length} 筆 ${JSON.stringify(stats)}`);
  if(best.length===before)break;}

console.log('修復後:同月台同時',best.length,'筆,去重',dedup(best),'對;動過的車次',changed.size);
// 落成:借路徑的要變成自己的計畫,才存得下改過的 pathIds
const sigOf=new Map();
for(const day of days)for(const t of roster.get(day))if(!sigOf.has(t.key))sigOf.set(t.key,physicalStopSignature({sys:SYS,train:t.no,stops:t.stops}));
let materialised=0;
for(const [key,ids] of current){
  if(!changed.has(key))continue;
  if(plans[key]){plans[key]={...plans[key],pathIds:ids};}
  else{const t=trainOf.get(key),holds=t.stops.map(()=>({arrival:0,departure:0}));
    plans[key]={pathIds:ids,holds,departureHolds:holds.map(()=>0),officialDelaySec:0,
      stopSignature:sigOf.get(key),lengthM:lenOf(t.no)??240};materialised++;}}
fs.writeFileSync(OUT,JSON.stringify({...dispatch,plans}));
console.log('已寫',OUT,'|台鐵計畫',Object.keys(plans).filter(k=>k.startsWith(SYS+':')).length,'(新落成',materialised,')');
console.log('動過的前 12 筆:',[...changed.entries()].slice(0,12).map(([k,v])=>k.split(':')[1]+' '+v.map(c=>c.station.replace(SYS+':','')+':'+c.from+'→'+c.to).join(',')).join(' | '));
