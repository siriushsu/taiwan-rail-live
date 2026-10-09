import {AFR_TURNBACKS} from './turnbacks.js';
import {segmentTime} from './timing.js';
// 林鐵只有班表資訊：實際停靠站的到離時刻不可被離線派軌等待順延。
// 以來源股道長度解加速／巡航／煞車；沿用前端林鐵模型的估計性能，非即時測速。
const A=.7/3.6,B=1.1/3.6,V=45/3.6;
function profile(L,T){
 if(!(L>0&&T>0))return null;
 const D=.5/A+.5/B,disc=T*T-4*D*L;
 if(disc<0)return null;
 const vc=2*L/(T+Math.sqrt(disc));
 if(vc>V)return null;
 const tAcc=vc/A,tDec=vc/B,tCru=T-tAcc-tDec;
 if(tCru<0)return null;
 return {T,L,a:A,b:B,c:0,vc,vb:vc,tAcc,tCru,tCoast:0,tDec,dAcc:vc*vc/(2*A),dCru:vc*tCru,dCoast:0,dDec:vc*vc/(2*B)};
}
export function createAfrTiming(source,lengths,passTimes=new Map()){
 const stops=source.map((s,i)=>passTimes.has(i)?{...s,arrSec:passTimes.get(i),depSec:passTimes.get(i)}:{...s});let start=0,fallbacks=0,runs=0;
 for(let end=1;end<stops.length;end++){
  if(stops[end].stop===false&&!AFR_TURNBACKS.has(stops[end].name)&&end<stops.length-1)continue;
  const L=lengths.slice(start,end).reduce((a,b)=>a+b,0),dep=stops[start].depSec,T=stops[end].arrSec-dep,knots=[];let cum=0;
  for(let i=start;i<end;i++){cum+=lengths[i];if(i+1<end&&passTimes.has(i+1))knots.push({t:passTimes.get(i+1)-dep,d:cum});}
  const rp=knots.length?anchoredProfile(L,T,knots):profile(L,T);runs++;
  let off=0;
  for(let i=start;i<end;i++){
   const s=stops[i];delete s.rp;delete s.rpDep;delete s.rpOff;delete s.rpSegKm;
   if(rp){s.rp=rp;s.rpDep=dep;s.rpOff=off;s.rpSegKm=lengths[i]/1000;}
   off+=lengths[i];
   // 通過時刻原本就是推估值；只重算通過站，不改任何正式到離站時刻。
   if(i+1<end&&stops[i+1].stop===false){
    const probe={depSec:dep,rp,rpDep:dep,rpOff:0,rpSegKm:L/1000};
    const t=rp?segmentTime(probe,{arrSec:dep+T},off/L):T*off/L;
    stops[i+1].arrSec=stops[i+1].depSec=dep+t;
   }
  }
  if(!rp)fallbacks++;
  start=end;
 }
 return {stops,runs,fallbacks};
}
// 只借派軌快照的站序、股道與班表，忽略它的等待。園區往返在共用停車點銜接顯示；
// 不跨支線、不搬車，也不宣稱是官方公布的車組運用。
export function createAfrTimetablePolicy(dispatch,pack){
 const plans=Object.entries(dispatch.plans).filter(([k])=>k.startsWith('afr_sched:')&&typeof dispatch.plans[k].stopSignature==='string').map(([key,plan])=>({key,plan,stops:JSON.parse(plan.stopSignature).map(([name,arrSec,depSec])=>({name:name.slice('afr_sched:'.length),arrSec,depSec}))}));
 return (tr,plan)=>{
  const stops=tr.stops,last=stops.at(-1),tail=pack.paths[plan.pathIds.at(-1)],passTimes=new Map();let hideAt=null;
  for(const peer of plans){if(peer.key===['afr_sched',tr.train,stops[0].depSec,last.arrSec].join(':'))continue;
   const first=peer.stops[0];
   if(tail&&pack.paths[peer.plan.pathIds[0]]&&last.name===first.name&&stops.at(-2).name===peer.stops[1]?.name&&tail.to===pack.paths[peer.plan.pathIds[0]].from
    &&first.arrSec>=last.arrSec&&first.arrSec<=last.depSec&&first.depSec>=last.arrSec&&first.depSec-last.arrSec<=1800)
    hideAt=hideAt==null?first.arrSec:Math.min(hideAt,first.arrSec);
   for(let i=1;i<stops.length-1;i++){
    const s=stops[i];if(s.stop!==false)continue;
    const j=peer.stops.findIndex(p=>p.name===s.name),p=peer.stops[j];if(!p||p.depSec<=p.arrSec)continue;
    // 對向交會：通過站是推算點，把它放進另一班的表定停站窗；正式時刻完全不變。
    if(j>0&&j<peer.stops.length-1&&stops[i-1].name===peer.stops[j+1].name&&stops[i+1].name===peer.stops[j-1].name
     &&p.arrSec>stops[i-1].depSec&&p.depSec<stops[i+1].arrSec)passTimes.set(i,(p.arrSec+p.depSec)/2);
    // 另一班在本站終到；留出車身通過站區的時間，餘裕由前後跑段速度分配。
    else if(j===peer.stops.length-1&&peer.stops[j-1]?.name===stops[i+1].name&&s.arrSec>=p.arrSec-60&&s.arrSec<=p.depSec+60
     &&p.depSec+60<stops[i+1].arrSec)passTimes.set(i,Math.max(passTimes.get(i)||0,p.depSec+60));
   }
  }
  return {hideAt,passTimes};
 };
}
function anchoredProfile(L,T,knots){
 const xs=[0,...knots.map(k=>k.t),T],ys=[0,...knots.map(k=>k.d),L],h=[],v=[];
 for(let i=0;i<xs.length-1;i++){h.push(xs[i+1]-xs[i]);v.push((ys[i+1]-ys[i])/h[i]);if(!(h[i]>0&&v[i]>0))return null;}
 const m=xs.map(()=>0);
 for(let i=1;i<m.length-1;i++){const a=2*h[i]+h[i-1],b=h[i]+2*h[i-1];m[i]=(a+b)/(a/v[i-1]+b/v[i]);}
 for(let i=0;i<h.length;i++){
  const a=3*m[i]+3*m[i+1]-6*v[i],b=-4*m[i]-2*m[i+1]+6*v[i];let peak=Math.max(m[i],m[i+1]);
  if(a<0){const u=-b/(2*a);if(u>0&&u<1)peak=Math.max(peak,a*u*u+b*u+m[i]);}
  if(peak>V)return null;
 }
 return {L,T,obs:true,xs,ys,h,m};
}
