import {stationKey} from './timing.js';
export const physicalTrainKey=tr=>[tr.sys||tr.system,tr.train,tr.stops[0].depSec,tr.stops.at(-1).arrSec].join(':');
export const physicalStopSignature=tr=>JSON.stringify(tr.stops.map(s=>[stationKey(tr.sys||tr.system,s.name),s.arrSec,s.depSec]));
const validTimes=tr=>tr.stops.every((s,i)=>Number.isFinite(s.arrSec)&&Number.isFinite(s.depSec)&&s.depSec>=s.arrSec&&(!i||s.arrSec>=tr.stops[i-1].depSec));
const noHolds=p=>!(p.holds||[]).some(h=>h.arrival||h.departure)&&!(p.departureHolds||[]).some(Boolean)&&!p.officialDelaySec;
// 通過時間是行車曲線的產物；只允許明確標成不停靠的中途站重算時間。
// 正式停靠、站序、起終點與帶待避安排的舊計畫仍要完整吻合。
export function sameDerivedPasses(plan,tr){
 if(!noHolds(plan)||!validTimes(tr)||(tr.sys||tr.system)!=='tra_sched')return false;
 let old;try{old=JSON.parse(plan.stopSignature);}catch{return false;}
 return old.length===tr.stops.length&&old.every((s,i)=>{
  const p=tr.stops[i];if(s[0]!==stationKey(tr.sys||tr.system,p.name))return false;
  if(s[1]===p.arrSec&&s[2]===p.depSec)return true;
  return i>0&&i<old.length-1&&p.stop===false&&s[1]===s[2]&&p.arrSec===p.depSec&&Number.isFinite(p.arrSec);
 });
}
const borrow=(pathIds,tr)=>{const holds=tr.stops.map(()=>({arrival:0,departure:0}));return {pathIds,holds,departureHolds:holds.map(()=>0),officialDelaySec:0,stopSignature:physicalStopSignature(tr)};};
const sameStations=(plan,tr)=>{let old;try{old=JSON.parse(plan.stopSignature);}catch{return false;}return old.length===tr.stops.length&&old.every((s,i)=>s[0]===stationKey(tr.sys||tr.system,tr.stops[i].name));};
// 可向既有計畫借路徑的系統:台鐵加開車、高鐵當日班表(車次或時刻與派車表不同的班次)、
// 林鐵祝山線觀日車(97/98 依官方日出表逐旬改發車時刻,而配對鍵含起訖秒,派車表只存得下一組
// 寫死的時刻——不借路徑的話一年裡只有恰好對上那兩天綁得到,其餘日子整班退回示意線形)。
const TEMPLATE_SYSTEMS=['tra_sched','thsr_sched','afr_sched'];
export function createPlanBinding(dispatch){
 const templates=new Map();
 return tr=>{
  const sys=tr.sys||tr.system,key=physicalTrainKey(tr),exact=dispatch.plans[key];
  if(exact){if(exact.pathIds.length!==tr.stops.length-1)return null;
   if(exact.stopSignature===physicalStopSignature(tr))return {plan:exact,basis:'exact'};
   if(sameDerivedPasses(exact,tr))return {plan:exact,basis:'derived-pass-times'};
   // 高鐵當日班表只改了到離站時刻(同車次、同站序):沿用自己原本的股道,時間與待避一律用今天的。
   return sys==='thsr_sched'&&sameStations(exact,tr)&&validTimes(tr)?{basis:'retimed',sourceKey:key,plan:borrow(exact.pathIds,tr)}:null;
  }
  // 加開車只借用完整、有序的既有路徑切片，不借用別班的時間、待避或接車關係。
  if(!TEMPLATE_SYSTEMS.includes(sys)||tr.loop||tr.stops.length<2||!validTimes(tr))return null;
  // 限定車種的站內股道（例如藍皮的非電化月台）不能被其他加開車借走。
  if(!templates.has(sys))templates.set(sys,Object.entries(dispatch.plans).filter(([k,p])=>k.startsWith(sys+':')&&p.templateEligible!==false).map(([key,plan])=>({key,plan,stops:JSON.parse(plan.stopSignature)})));
  const names=tr.stops.map(s=>stationKey(sys,s.name));let best=null;
  for(const t of templates.get(sys))for(let start=0;start<=t.stops.length-names.length;start++){
   if(!names.every((name,i)=>t.stops[start+i][0]===name))continue;
   // 優先使用相同停靠型態、同長度區間；最後用穩定的來源 key 決勝，不依車輛接近而換軌。
   const mismatch=tr.stops.reduce((n,s,i)=>n+(i>0&&i<names.length-1&&((s.stop!==false)!==(t.stops[start+i][2]>t.stops[start+i][1]))?1:0),0),score=mismatch*10000+t.stops.length-names.length;
   if(!best||score<best.score||(score===best.score&&t.key<best.key))best={...t,start,score};
  }
  if(!best)return null;
  return {basis:'route-template',sourceKey:best.key,plan:borrow(best.plan.pathIds.slice(best.start,best.start+names.length-1),tr)};
 };
}
