// 乘客劇本的不變式：純計算，Node 單元測試與瀏覽器驗收共用同一份判準。
// plan 傳入 garage-people-plan.js 的模組（或瀏覽器裡同一個模組），doors 是月台側車門 [{id,x,y,inboard}]（世界座標）。
export function peopleInvariants({plan:{planStop,personAt,idlePeople,PEOPLE},timetable,doors,platform,stops=60,step=.05}){
 const R=PEOPLE.radius,ctx={timetable,doors,platform},idle=idlePeople(platform),cache=new Map(),plan=n=>{if(!cache.has(n))cache.set(n,planStop(n,ctx));return cache.get(n);};
 const out=Math.sign(platform.outer-platform.edge),depth=y=>(y-platform.edge)*out,doorPlane=Math.max(...doors.map(d=>depth(d.y)));
 let counts=true,maxOn=0,minGap=Infinity,worstPair=null,obst=0,thresh=0,bounds=0,late=0,arrive=0,exitEarly=0;
 for(let n=0;n<stops;n++){const p=plan(n),T0=n*timetable.lap;
  if(!(p.counts.board>=4&&p.counts.board<=7&&p.counts.alight>=2&&p.counts.alight<=12-p.counts.idle-p.counts.board))counts=false;
  for(const q of p.people){
   if(q.role==='board'){if(q.vanish>T0+timetable.phases.closeStart-.2)late++;if(q.arrived>T0-PEOPLE.arriveBy)arrive++;}
   if(q.role==='alight'&&q.keys[1].t<T0+timetable.phases.openEnd-1e-9)exitEarly++;
  }
  for(let t=T0-40;t<T0+45;t+=step){
   const vis=[...[n-1,n,n+1].filter(k=>k>=0).flatMap(k=>plan(k).people),...idle].map(q=>personAt(q,t)).filter(Boolean);
   maxOn=Math.max(maxOn,vis.filter(v=>depth(v.y)>=0).length);
   for(let i=0;i<vis.length;i++){const a=vis[i];
    for(let j=i+1;j<vis.length;j++){const b=vis[j],g=Math.hypot(a.x-b.x,a.y-b.y);if(g<minGap){minGap=g;worstPair={t:+t.toFixed(2),a:a.id,b:b.id,g};}}
    if(a.pose!=='sit'&&!a.id.startsWith('idle'))for(const o of platform.obstacles){const dx=Math.max(o.x0-a.x,0,a.x-o.x1),dy=Math.max(o.y0-a.y,0,a.y-o.y1);if(Math.hypot(dx,dy)<R)obst++;}
    const dd=depth(a.y),near=doors.reduce((m,d)=>Math.min(m,Math.abs(d.x-a.x)),Infinity);
    if(dd<.05&&dd>doorPlane&&near>.03)thresh++;   // 跨過月台間隙只能在門的正中
    if(dd<=doorPlane&&near>.3)thresh++;           // 進到車內只能在門內那一小段
    const onPlat=dd>=0&&dd<=depth(platform.outer)&&a.x>=platform.xMin+R&&a.x<=platform.xMax-R;
    const onBridge=dd>depth(platform.outer)-1e-9&&a.x>=platform.bridge.x0+R&&a.x<=platform.bridge.x1-R;
    if(!(onPlat||onBridge||dd<.05))bounds++;
   }
  }
 }
 const looks=new Set();for(let n=0;n<Math.min(5,stops);n++)for(const q of plan(n).people)looks.add(JSON.stringify(q.look));
 const s=plan(Math.min(3,stops-1)),at=s.showcaseTime;
 const showcase={t:at,doors:timetable.at(at).doors,boarding:s.people.some(q=>q.role==='board'&&q.boardAt<=at&&at<q.vanish)};
 const deterministic=JSON.stringify(planStop(7,ctx))===JSON.stringify(planStop(7,ctx));
 return{counts,maxOn,minGap,worstPair,obst,thresh,bounds,late,arrive,exitEarly,looks:looks.size,showcase,deterministic};
}
// 把不變式結果轉成逐項判定；Node 與瀏覽器驗收都呼叫這一個，判準只有一份。
export function peopleChecks(v,spacing){
 return[
  ['每站人數在範圍內（上 4～7、下 2～(9−上)、不搭車 3）',v.counts,{}],
  ['月台上同時最多 12 人',v.maxOn<=12,{maxOn:v.maxOn}],
  ['任兩人距離 ≥0.3',v.minGap>=spacing-1e-9,v.worstPair],
  ['不穿過雨棚柱、長椅、站名牌柱',v.obst===0,{obst:v.obst}],
  ['跨過間隙只在門的正中（±0.03）、車內不超出門內（±0.3）',v.thresh===0,{thresh:v.thresh}],
  ['人都在月台或天橋上（或正在進出車門）',v.bounds===0,{bounds:v.bounds}],
  ['上車者都在開始關門前 0.2 秒進門並隱藏',v.late===0,{late:v.late}],
  ['候車者在列車開始減速前 1 秒就定位',v.arrive===0,{arrive:v.arrive}],
  ['下車者在開門完成後才跨出車門',v.exitEarly===0,{exitEarly:v.exitEarly}],
  ['同一站號兩次劇本完全相同',v.deterministic,{}],
  ['五站內至少 10 種外型',v.looks>=10,{looks:v.looks}],
  ['展示時刻：門全開且有人正在上車',v.showcase.doors===1&&v.showcase.boarding,v.showcase]
 ];
}
