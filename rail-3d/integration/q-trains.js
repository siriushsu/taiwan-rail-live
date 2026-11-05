// Q 版列車（trainSizeMode='q'）：車庫網格本來就是短車身，不拉成真車長度，固定三節，整列等比放大，
// 讓車寬在畫面上維持 Q_TARGET_PX。倍率只看縮放；拉近到 1 倍就是網格原尺寸、回到真實軌道上。
// 這裡只改畫面，車輛座標、里程、班表、待避都不動。數字與判斷跟 railcore R3dQTrains.kt 一條一條對應，兩邊要一起改。
export const Q_TARGET_PX=22,Q_MAX_SCALE=14,Q_BASE_WIDTH_M=3,Q_CAR_GAP_M=.16;
export const Q_REACH_M=19; // 半列長加側移，畫面外候選範圍用（一倍時約 15＋4 m）
export const Q_LANE_SWITCH_S=2.5,Q_GIVE_S=1.5,Q_STILL_S=1,Q_STILL_M=.2,Q_YIELD_AHEAD_M=60,Q_SNAP_S=1.5;
const METERS_PER_PX_Z0=78271.5*.906; // 512 px 圖磚、北緯 25 度
const SURFACE_M=.65;

export const qScale=zoom=>Math.max(1,Math.min(Q_MAX_SCALE,Q_TARGET_PX*METERS_PER_PX_Z0/2**zoom/Q_BASE_WIDTH_M));

// 三節照網格原長排，modelFor 拿 assembleFormation 的結果換掉長度。
export function qFormation(model,catalog){
  const size=p=>{const m=catalog.meshes[p.mesh];return [m.max[0]-m.min[0],m.max[1]-m.min[1]];};
  const lengths=model.parts.map(p=>size(p)[0]+Q_CAR_GAP_M),lengthM=lengths.reduce((a,b)=>a+b,0);let front=lengthM/2;
  const parts=model.parts.map((p,i)=>{const len=lengths[i],offsetM=front-len/2;front-=len;return {...p,lengthM:len,bodyLengthM:len-Q_CAR_GAP_M,bodyShiftM:0,offsetM};});
  const widthM=Math.max(...model.parts.map(p=>size(p)[1]));
  return {...model,parts,lengthM,widthM,displayWidthM:widthM,q:true};
}

// 放大後車身比原本的 16 m 取樣窗長得多，方向要用整節車的弦，不然彎道上車尾會甩出去。
export const qParts=(parts,S)=>parts.map(p=>({...p,lengthM:p.lengthM*S,bodyLengthM:p.bodyLengthM*S,bodyShiftM:p.bodyShiftM*S,offsetM:p.offsetM*S,poseHalfM:p.lengthM*S*.32}));

// 放大後整列可能比到終點的剩餘路線長；formationPoses 會因此整列不畫，所以把錨點夾在路線內。
export const clampAnchor=(s,halfM,lengthM)=>lengthM>halfM*2?Math.max(halfM,Math.min(lengthM-halfM,s)):s;

// 各靠一邊：跟著現實行車方向，台鐵、高鐵、林鐵靠左，捷運、輕軌靠右。+1＝行進方向左側。
const KEEP_LEFT=new Set(['tra_sched','thsr_sched','afr_sched']);
export const laneSide=systemId=>KEEP_LEFT.has(systemId)?1:-1;
export const createLane=()=>({unit:0,give:0,giveTarget:0,heading:0,stillSec:0,lon:NaN,lat:NaN,fresh:true});

const toward=(from,to,step)=>from+Math.max(-step,Math.min(step,to-from));

// 每幀一次。側移只跟縮放與行進方向有關，所以行駛中不會跳；折返換邊與讓開都是緩動，跟著真實秒數走。
export function stepLane(lane,{heading,side,dt,lon,lat}){
  const moved=Number.isFinite(lane.lon)?Math.hypot((lon-lane.lon)*101000,(lat-lane.lat)*111320):Infinity;
  if(lane.fresh||dt>Q_SNAP_S){lane.unit=side;lane.give=lane.giveTarget;lane.fresh=false;}
  else{
    // 折返時行進方向反過來，左右也跟著反；先換號維持車在原地，再慢慢滑到新的一邊。
    if(Math.cos(heading-lane.heading)<0)lane.unit=-lane.unit;
    lane.unit=toward(lane.unit,side,dt*2/Q_LANE_SWITCH_S);
    lane.give=toward(lane.give,lane.giveTarget,dt/Q_GIVE_S);
  }
  lane.stillSec=moved<Q_STILL_M?lane.stillSec+dt:0;
  lane.heading=heading;lane.lon=lon;lane.lat=lat;
}

// 往行進方向左側為正的側移公尺。S＝1 時靠邊是 0，車在真實股道上。
export const laneOffsetM=(lane,S,widthM)=>lane.unit*((S-1)*widthM/2+lane.give*S*widthM);

export function shiftCoordinate(c,angle,meters){
  return [c[0]+Math.cos(angle)*meters/(111320*Math.cos(c[1]*Math.PI/180)),c[1]+Math.sin(angle)*meters/110574];
}

// 停靠車讓開：同方向、車身疊在一起時，停著的車往外滑到剛好不疊。回傳 id→讓開幾個車寬。
// trains：{id,x,y（公尺）,heading,side,halfM,widthM（畫面車寬）,stopped,followed}
export function yieldTargets(trains){
  const out=new Map();
  for(let i=0;i<trains.length;i++)for(let j=i+1;j<trains.length;j++){
    const a=trains[i],b=trains[j];
    if(a.side!==b.side||Math.cos(a.heading-b.heading)<.7)continue;
    const giver=pickGiver(a,b);if(!giver)continue;
    const other=giver===a?b:a,dx=giver.x-other.x,dy=giver.y-other.y,tx=Math.cos(giver.heading),ty=Math.sin(giver.heading);
    if(Math.abs(dx*tx+dy*ty)>giver.halfM+other.halfM+Q_YIELD_AHEAD_M)continue;
    const width=(giver.widthM+other.widthM)/2,lateral=(dx*-ty+dy*tx)*giver.side; // >0：讓開的車已經比較靠外
    if(Math.abs(lateral)>=width)continue;
    out.set(giver.id,Math.max(out.get(giver.id)||0,(width-lateral)/width));
  }
  return out;
}
function pickGiver(a,b){
  if(a.stopped!==b.stopped)return a.stopped?a:b;
  if(!a.stopped)return null; // 兩列都在跑就各跑各的：移動中的車不做避讓
  if(a.followed!==b.followed)return a.followed?b:a;
  return String(a.id)>String(b.id)?a:b;
}

// 上下層：不同線交會時，誰蓋住誰照真實軌面高度決定。把整節車以鏡頭為中心等比縮放，畫面上的位置與大小完全不變，
// 只改深度，所以不必動著色器。heightM＝離地面的公尺；1 m 高低差換成 2×(S-1) m 的深度：高低差 2 m 就超過放大後的車高。
export const depthLiftM=(heightM,S)=>(heightM-SURFACE_M)*2*(S-1);
export const depthScale=(liftM,distanceM)=>Math.max(.5,Math.min(1.5,1-liftM/Math.max(1,distanceM)));
// 地下那一趟的遠裁切面要裝得下被推遠的車：地下 60 m 的軌道推遠後約 60＋121×(S-1) m。一倍時就是原本的 50 m。
export const qUndergroundFloorM=S=>50+130*(S-1);
