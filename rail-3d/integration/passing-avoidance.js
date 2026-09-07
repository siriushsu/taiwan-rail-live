// 推估分軌仍有交疊時，依使用者允許的示意避讓讓一列暫時靠旁。
// 角色保持到車身完全分離；不改班表、官方誤點或來源股道。
const pointSegment=(p,a,b)=>{const x=b[0]-a[0],y=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/(x*x+y*y||1)));return Math.hypot(p[0]-a[0]-x*t,p[1]-a[1]-y*t);};
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function distance(a,b,c,d){if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return 0;return Math.min(pointSegment(a,c,d),pointSegment(b,c,d),pointSegment(c,a,b),pointSegment(d,a,b));}
export function offsetPose(p,metres){const mx=111320*Math.cos(p.coordinate[1]*Math.PI/180);return {...p,coordinate:[p.coordinate[0]-Math.sin(p.angle)*metres/mx,p.coordinate[1]+Math.cos(p.angle)*metres/111320]};}
export function createPassingAvoidance(){
 const memory=new Map();let serial=0,lastClock=null,lastWall=null;
 function update(vehicles,clock,wall=performance.now()/1000){const jump=lastClock!==null&&Math.abs(clock-lastClock)>30,dt=Math.min(.25,Math.max(0,wall-(lastWall??wall)));lastWall=wall;lastClock=clock;if(jump)memory.clear();
  if(!vehicles.length)return new Map();const origin=vehicles[0].cars[0].coordinate,mx=111320*Math.cos(origin[1]*Math.PI/180),xy=c=>[(c[0]-origin[0])*mx,(c[1]-origin[1])*111320];
  const segment=(v,offset,lookahead=0)=>v.cars.map((p,i)=>{const q=xy(offsetPose(p,offset).coordinate),half=v.lengths[i]/2,front=half+(i===0?lookahead:0),back=half+(i===v.cars.length-1?lookahead:0),dx=Math.cos(p.angle),dy=Math.sin(p.angle);return [[q[0]-dx*back,q[1]-dy*back],[q[0]+dx*front,q[1]+dy*front]];});
  const near=(a,oa,b,ob,lookahead=0)=>{if(Math.abs(a.cars[0].height-b.cars[0].height)>8)return false;const pa=xy(a.cars[0].coordinate),pb=xy(b.cars[0].coordinate),limit=a.lengthM+b.lengthM+lookahead*2+50;if(Math.hypot(pa[0]-pb[0],pa[1]-pb[1])>limit)return false;const gap=(a.widthM+b.widthM)/2+.8,aa=segment(a,oa,lookahead),bb=segment(b,ob,lookahead);return aa.some(([x,y])=>bb.some(([z,w])=>distance(x,y,z,w)<gap));};
  const linked=new Map(vehicles.map(v=>[v.id,new Set()]));for(let i=0;i<vehicles.length;i++)for(let j=i+1;j<vehicles.length;j++)if(near(vehicles[i],0,vehicles[j],0,220)){linked.get(vehicles[i].id).add(vehicles[j].id);linked.get(vehicles[j].id).add(vehicles[i].id);}
  const priorIds=new Set(memory.keys());for(const v of vehicles)if(!memory.has(v.id))memory.set(v.id,{offset:0,target:0,order:serial++,lastSeen:wall});
  const ordered=[...vehicles].sort((a,b)=>Number(priorIds.has(b.id))-Number(priorIds.has(a.id))||memory.get(a.id).order-memory.get(b.id).order),placed=[],result=new Map();
  for(const v of ordered){const m=memory.get(v.id),neighbors=linked.get(v.id),active=neighbors.size>0;let target=0;
   if(active){const step=Math.max(5,v.widthM+1.5),options=[m.target,0,step,-step,step*2,-step*2,step*3,-step*3];target=options.find(off=>placed.every(p=>!near(v,off,p.v,p.target,220)&&!near(v,off,p.v,p.current,220)))??m.target;}
   const first=!priorIds.has(v.id)||jump;if(first)m.offset=target;else{const change=Math.max(-dt*5,Math.min(dt*5,target-m.offset));m.offset+=change;if(Math.abs(m.offset-target)<.001)m.offset=target;}
   m.target=target;m.lastSeen=wall;placed.push({v,target,current:m.offset});result.set(v.id,m.offset);
  }
  for(const [id,m]of memory)if(wall-m.lastSeen>15)memory.delete(id);return result;
 }
 return {update};
}
