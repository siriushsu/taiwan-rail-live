// 微縮折返路網：三條有各自弧長的支路，共用兩端留置線。不是實際阿里山線形。
const smooth=t=>t*t*(3-2*t),mix=(a,b,t)=>a+(b-a)*t;
function makeRoute(nodes){
 const points=[],lengths=[0];
 for(let j=0;j<nodes.length-1;j++)for(let i=0;i<=120;i++){
  if(j&&i===0)continue;const a=nodes[j],b=nodes[j+1],t=i/120,u=smooth(t);
  const p={x:mix(a[0],b[0],t),y:mix(a[1],b[1],u),z:mix(a[2],b[2],u)};
  if(points.length){const prev=points.at(-1);lengths.push(lengths.at(-1)+Math.hypot(p.x-prev.x,p.y-prev.y,p.z-prev.z));}points.push(p);
 }
 const length=lengths.at(-1);
 function sample(s){s=Math.max(0,Math.min(length,s));let lo=0,hi=lengths.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(lengths[m]<=s)lo=m;else hi=m;}const a=points[lo],b=points[hi],u=(s-lengths[lo])/(lengths[hi]-lengths[lo]||1);return{x:mix(a.x,b.x,u),y:mix(a.y,b.y,u),z:mix(a.z,b.z,u),heading:Math.atan2(b.y-a.y,b.x-a.x)};}
 return{points,length,sample};
}
export function createRoutes(){return[
 makeRoute([[-30,-14,1],[-16,-14,1],[12,-5,4],[30,-5,4]]),
 makeRoute([[-30,6,8],[-12,6,8],[12,-5,4],[30,-5,4]]),
 makeRoute([[-30,6,8],[-12,6,8],[15,15,12],[30,15,12]])
];}
export function createJourney(routes,trainLength){
 const margin=trainLength/2+1;if(margin*2>=18)throw Error('編組超出折返留置線淨空');
 const entries=[[0,1,'沿坡上山','第一折返・停車換向'],[1,-1,'倒推上山','第二折返・停車換向'],[2,1,'林間上山','山上小站・停車'],[2,-1,'離站下山','第二折返・停車換向'],[1,1,'沿坡下山','第一折返・停車換向'],[0,-1,'返回山腳','山腳小站・停車']];
 let total=0;const stages=entries.map(([route,sign,label,stop])=>{const path=routes[route],length=path.length-margin*2,speed=2.6,travel=length/speed+1,stage={route,sign,label,stop,start:total,travel,duration:travel+3,length,speed,from:sign>0?margin:path.length-margin};total+=stage.duration;return stage;});
 function at(time){const t=((time%total)+total)%total,stage=stages.find(s=>t<s.start+s.duration)||stages.at(-1),elapsed=t-stage.start,u=Math.min(stage.travel,elapsed),v=stage.speed;let distance;if(u<1)distance=.5*v*u*u;else if(u<stage.travel-1)distance=v*(u-.5);else distance=stage.length-.5*v*(stage.travel-u)**2;return{route:stage.route,s:stage.from+stage.sign*distance,moving:elapsed<stage.travel,label:elapsed<stage.travel?stage.label:stage.stop,sign:stage.sign,stage:stages.indexOf(stage),remaining:Math.max(0,stage.travel-elapsed),dwell:Math.max(0,elapsed-stage.travel)};}
 return{at,total,stages,margin};
}
