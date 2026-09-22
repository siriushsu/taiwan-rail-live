// 洞口的共用展示斷面。相鄰股道保留原位，只合併靜態外殼的開口；不是實測洞型。
export const PORTAL_HALF_CLEAR=3.2;
export const PORTAL_DEPTH=12;
export const PORTAL_WING=8;
export const PORTAL_GROUND_U=[-1,-.5,0,.5,1];
export function groupTunnelPortals(items){
  const valid=items.filter(p=>p?.p?.length===3&&[...p.p,p.angle,p.scale??1].every(Number.isFinite)&&(p.scale??1)>0);
  const compatible=(a,b)=>{
    if(a.system!==b.system||Math.cos(a.angle-b.angle)<.985)return false;
    const scale=a.scale||1,dx=(b.p[0]-a.p[0])/scale,dy=(b.p[1]-a.p[1])/scale;
    return Math.abs(dx*Math.cos(a.angle)+dy*Math.sin(a.angle))<12&&
      Math.abs(-dx*Math.sin(a.angle)+dy*Math.cos(a.angle))<11&&Math.abs(a.p[2]-b.p[2])/scale<2;
  };
  const groups=[];
  for(const item of valid){let group=groups.find(g=>g.every(p=>compatible(p,item)));if(!group)groups.push(group=[]);group.push(item);}
  return groups.map(members=>{
    const first=members[0],scale=first.scale||1,angle=Math.atan2(members.reduce((s,p)=>s+Math.sin(p.angle),0),members.reduce((s,p)=>s+Math.cos(p.angle),0)),tx=Math.cos(angle),ty=Math.sin(angle),ux=-ty,uy=tx;
    const local=members.map(m=>{const points=(m.samples?.length?m.samples:[m.p]).map(p=>{const x=(p[0]-first.p[0])/scale,y=(p[1]-first.p[1])/scale;return{u:x*ux+y*uy,d:x*tx+y*ty,z:p[2]/scale};});return{m,points};});
    const all=local.flatMap(v=>v.points),lo=Math.min(...all.map(v=>v.u)),hi=Math.max(...all.map(v=>v.u)),mid=(lo+hi)/2,front=Math.min(...local.map(v=>v.points[0].d));
    const slopes=local.filter(v=>v.points.length>1).map(v=>{const a=v.points[0],b=v.points.at(-1);return (b.z-a.z)/Math.max(.1,b.d-a.d);}),grade=slopes.length?slopes.reduce((a,b)=>a+b,0)/slopes.length:0;
    const adjusted=all.map(v=>v.z-grade*(v.d-front)),base=Math.min(...adjusted),rise=Math.max(...adjusted)-base;
    const p=[first.p[0]+(ux*mid+tx*front)*scale,first.p[1]+(uy*mid+ty*front)*scale,base*scale];
    return {...first,p,angle,scale,grade,members,halfWidth:PORTAL_HALF_CLEAR+(hi-lo)/2,spring:2.8+rise,ground:undefined};
  });
}
