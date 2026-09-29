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
  return i>0&&i<old.length-1&&p.stop===false&&s[1]===s[2]&&Number.isFinite(p.arrSec)&&Number.isFinite(p.depSec)
   &&(p.arrSec===p.depSec||p._plannedDwell===true&&p.depSec>p.arrSec);
 });
}
// own：沿用的是自己那份計畫時一併帶上「不可借給別班當模板」的標記（藍皮 5898／5899 的非電化股道靠它守）。
const borrow=(pathIds,tr,own)=>{const holds=tr.stops.map(()=>({arrival:0,departure:0}));return {pathIds,holds,departureHolds:holds.map(()=>0),officialDelaySec:0,stopSignature:physicalStopSignature(tr),...(own?.templateEligible===false&&{templateEligible:false})};};
const sameStations=(plan,tr)=>{let old;try{old=JSON.parse(plan.stopSignature);}catch{return false;}return old.length===tr.stops.length&&old.every((s,i)=>s[0]===stationKey(tr.sys||tr.system,tr.stops[i].name));};
// 停靠型態：中途每站是停是過要與原計畫相同（原計畫的正式停靠一律有停留秒數，通過站到離同秒）。
const sameStopPattern=(plan,tr)=>JSON.parse(plan.stopSignature).every((s,i,a)=>!i||i===a.length-1||(tr.stops[i].stop!==false)===(s[2]>s[1]));
// 可向既有計畫借路徑的系統:台鐵加開車、高鐵當日班表(車次或時刻與派車表不同的班次)、
// 林鐵祝山線觀日車(97/98 依官方日出表逐旬改發車時刻,而配對鍵含起訖秒,派車表只存得下一組
// 寫死的時刻——不借路徑的話一年裡只有恰好對上那兩天綁得到,其餘日子整班退回示意線形)。
const TEMPLATE_SYSTEMS=['tra_sched','thsr_sched','afr_sched'];
// canJoin(前一段路徑,下一段路徑)＝兩段在共用節點接不接得上（route-runtime.joinable）。給了才允許多班接力借路徑（見 bind 末段）；
// 離線修補腳本不給，行為不變。
export function createPlanBinding(dispatch,{canJoin}={}){
 const templates=new Map(),startsAt=new Map(),byTrain=new Map(),known=new Map();
 // 派車表沒有的台鐵中途站（2026-10 起的平鎮臨時站 1105）綁定時當作不存在：通過站直接略過，停靠站把前後兩段
 // 併回原本那一段——車走派車表原本的股道，停在那一站投影到那一段路徑上的點（motion.js 的 cuts）。回傳的 stops 是綁定實際用的站序（原班表的站物件），
 // stopIndexes 是它們在原班表的位置。起訖站不在派車表就不略過，照舊綁不到、退回示意線形。
 // 2D 地圖、看板、小工具照官方站序，不經過這裡。
 const knownOf=sys=>{let set=known.get(sys);if(!set){set=new Set();for(const [k,p] of Object.entries(dispatch.plans))if(k.startsWith(sys+':'))for(const s of JSON.parse(p.stopSignature))set.add(s[0]);known.set(sys,set);}return set;};
 const bind=tr=>{
  const sys=tr.sys||tr.system,key=physicalTrainKey(tr),exact=dispatch.plans[key];
  if(exact){if(exact.pathIds.length!==tr.stops.length-1)return null;
   if(exact.stopSignature===physicalStopSignature(tr))return {plan:exact,basis:'exact'};
   if(sameDerivedPasses(exact,tr))return {plan:exact,basis:'derived-pass-times'};
   if(!sameStations(exact,tr)||!validTimes(tr))return null;
   // 高鐵當日班表只改了到離站時刻(同車次、同站序):沿用自己原本的股道,時間與待避一律用今天的。
   // 台鐵改點(2026-10-03 起埔心、樹林、桃園幾班提早，首站發車與末站到站不變所以同鍵)同樣沿用自己的股道，
   // 但停靠型態要相同、原計畫不得帶待避——待避是替舊時刻解的交會，歸零後可能重新互穿。
   return sys==='thsr_sched'||sys==='tra_sched'&&noHolds(exact)&&sameStopPattern(exact,tr)?{basis:'retimed',sourceKey:key,plan:borrow(exact.pathIds,tr,exact)}:null;
  }
  // 台鐵改點改到首站發車或末站到站時鍵跟著變（2026-10-03 起 1248／1254 到基隆晚 1 分）：先找同車次、同站序、
  // 同停靠型態、不帶待避的自己的計畫，沿用自己驗收過的股道。借別班的路徑會把替這班修好的站場進路退回去
  // （1248 借 1128 會在汐止走回 09-13 修掉的舊股道、1254 借 1120 在鶯歌也是）。同車次有幾份就取時刻最接近的。
  if(sys==='tra_sched'&&!tr.loop&&validTimes(tr)){
   if(!byTrain.size)for(const [k,p] of Object.entries(dispatch.plans))if(k.startsWith(sys+':'))(byTrain.get(k.split(':')[1])||byTrain.set(k.split(':')[1],[]).get(k.split(':')[1])).push([k,p]);
   const gap=p=>JSON.parse(p.stopSignature).reduce((n,s,i)=>n+Math.abs(s[1]-tr.stops[i].arrSec)+Math.abs(s[2]-tr.stops[i].depSec),0);
   const own=(byTrain.get(String(tr.train))||[]).filter(([,p])=>p.pathIds.length===tr.stops.length-1&&noHolds(p)&&sameStations(p,tr)&&sameStopPattern(p,tr))
    .map(([k,p])=>({k,p,gap:gap(p)})).sort((a,b)=>a.gap-b.gap||(a.k<b.k?-1:1))[0];
   if(own)return {basis:'retimed',sourceKey:own.k,plan:borrow(own.p.pathIds,tr,own.p)};
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
  if(best)return {basis:'route-template',sourceKey:best.key,plan:borrow(best.plan.pathIds.slice(best.start,best.start+names.length-1),tr)};
  // 沒有一班既有計畫跑完整條路線的專車（2026-10-03 環島 6669 新左營→南迴→東線→臺北→山線→新左營、10-04 6509 花蓮→新左營）
  // 改成接力借：整條路線切成幾截、每截是某班既有計畫的連續切片，交接站前後兩截要接得上（canJoin：節點相同、道岔不倒車，
  // route-runtime.joinable）。挑法與上面單一模板同一順位：停靠型態不符最少優先——交接站兩側各算一次（前一截、下一截在那站
  // 各是停是過；切片起訖站對模板而言是停靠），其次截數最少；同分取先找到的（模板依 key 排序），結果穩定、不依車輛接近而換軌。
  // 只取最長切片會拿站站停的區間車股道給通過的專車（6669 樹林→嘉義曾借 2173，中途 58 站有 55 站型態不符＝一路切進月台線）。
  // 只有呼叫端給了 canJoin 才接（前端 motion.js）；離線修補腳本不給，照舊回 null 退示意線形。
  if(!canJoin)return null;
  if(!startsAt.has(sys)){const m=new Map();for(const t of [...templates.get(sys)].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0))for(let j=0;j<t.stops.length-1;j++)(m.get(t.stops[j][0])||m.set(t.stops[j][0],[]).get(t.stops[j][0])).push([t,j]);startsAt.set(sys,m);}
  const N=names.length,tStop=(t,j)=>j===0||j===t.stops.length-1||t.stops[j][2]>t.stops[j][1],off=(i,t,j)=>i>0&&i<N-1&&(tr.stops[i].stop!==false)!==tStop(t,j)?1:0;
  // dp[i]：以「進第 i 站的那段路徑」為鍵，記到這裡為止最好的（不符數、截數）與回溯用的來源。
  const dp=names.map(()=>new Map());dp[0].set(null,{cost:0,pieces:0});
  for(let p=0;p<N-1;p++)for(const [last,v] of dp[p])for(const [t,j] of startsAt.get(sys).get(names[p])||[]){
   const ids=t.plan.pathIds;if(last!==null&&!canJoin(last,ids[j]))continue;
   let cost=v.cost+off(p,t,j);
   for(let n=1;p+n<N&&j+n<t.stops.length&&t.stops[j+n][0]===names[p+n];n++){
    cost+=off(p+n,t,j+n);const cur=dp[p+n].get(ids[j+n-1]);
    if(!cur||cost<cur.cost||cost===cur.cost&&v.pieces+1<cur.pieces)dp[p+n].set(ids[j+n-1],{cost,pieces:v.pieces+1,from:p,last,t,j,n});
   }
  }
  let end=null;for(const v of dp[N-1].values())if(!end||v.cost<end.cost||v.cost===end.cost&&v.pieces<end.pieces)end=v;
  if(!end)return null;
  const pieces=[];for(let v=end;v.t;v=dp[v.from].get(v.last))pieces.unshift({key:v.t.key,ids:v.t.plan.pathIds.slice(v.j,v.j+v.n)});
  return {basis:'route-template-chain',sourceKey:pieces[0].key,sourceKeys:pieces.map(x=>x.key),mismatch:end.cost,plan:borrow(pieces.flatMap(x=>x.ids),tr)};
 };
 return tr=>{
  const sys=tr.sys||tr.system;if(sys!=='tra_sched'||tr.loop)return bind(tr);
  const set=knownOf(sys),last=tr.stops.length-1,stopIndexes=[];
  tr.stops.forEach((s,i)=>{if(!i||i===last||set.has(stationKey(sys,s.name)))stopIndexes.push(i);});
  if(stopIndexes.length===tr.stops.length)return bind(tr);
  const stops=stopIndexes.map(i=>tr.stops[i]),b=bind({...tr,stops});
  return b&&{...b,stops,stopIndexes};
 };
}
