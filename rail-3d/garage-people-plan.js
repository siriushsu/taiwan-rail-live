// 月台乘客劇本：純函式，Node 與瀏覽器共用。每一站（圈）一份劇本，以站號當亂數種子，同一站號永遠同一份。
// 座標是世界單位；月台由「深度」描述：depth＝從月台邊往月台內走的距離（0＝月台邊，負值＝跨過間隙進車內）。
export const PEOPLE=Object.freeze({walk:.6,radius:.12,spacing:.3,exitGap:.9,clear:1.6,boardGap:.9,emerge:34,arriveBy:1,
 waitDepth:.45,frontDepth:.2,boardLaneDepth:1.3,laneDepth:.95,laneStep:.32,columnStep:.32,spotOffsets:[-.55,.55,-.91,.91],spotClear:.34,maxPerDoor:3,maxAlightPerDoor:2,maxAlightDoors:4,idle:3});
const TORSOS=['shirt','jacket','hoodie','dress'],HAIRS=['short','long','bun'],ACCESSORIES=[null,'backpack','suitcase','handbag','hat'];
const TOPS=['#d9c7a3','#6f8fa8','#b8574a','#e8e3d6','#4e5d6c','#8a9a5b','#c98f5d','#7b6a8f'],BOTTOMS=['#3d4450','#6b5a48','#2f3a4c','#8c8374'];
const HAIR_COLORS=['#2b2320','#4a3426','#1f1f24','#7a5a3a'],SKINS=['#e9c8a8','#d6a987','#b98663','#f1d3b8'],ACCENTS=['#c9463d','#2f6f8f','#e0b44c','#3b3b3b'];
export function mulberry32(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
const pick=(r,list)=>list[Math.floor(r()*list.length)];
function makeLook(r){const child=r()<.14;return{torso:pick(r,TORSOS),hair:pick(r,HAIRS),accessory:child?null:pick(r,ACCESSORIES),top:pick(r,TOPS),bottom:pick(r,BOTTOMS),hairColor:pick(r,HAIR_COLORS),skin:pick(r,SKINS),accent:pick(r,ACCENTS),scale:child?.7:.94+r()*.12};}
// 路徑：從 start 出發、依序走過 points；每段依步行速度排時間。keys 帶累積距離 d（走路擺動用）與停下時的朝向 face。
function route(t0,start,points,speed){
 const keys=[{t:t0,x:start[0],y:start[1],d:0,face:0}];
 for(const [x,y]of points){const a=keys[keys.length-1],len=Math.hypot(x-a.x,y-a.y);a.face=len>0?Math.atan2(y-a.y,x-a.x):a.face;keys.push({t:a.t+len/speed,x,y,d:a.d+len,face:a.face});}
 return keys;
}
function hold(keys,until,face){const a=keys[keys.length-1];if(face!==undefined)a.face=face;if(until>a.t)keys.push({...a,t:until});return keys;}
// 每一段的朝向：走路那段＝行進方向，停著那段＝停下時的朝向 face。
const TURN=.15,DIP=.3,wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
function pieceHeading(k,i){const a=k[i],b=k[i+1];return b&&b.t>a.t&&(b.x!==a.x||b.y!==a.y)?Math.atan2(b.y-a.y,b.x-a.x):a.face;}
function pieceAt(k,t){let i=0;while(i<k.length-2&&t>=k[i+1].t)i++;return i;}
export function personAt(p,t){
 if(t<p.appear||t>=p.vanish)return null;
 const k=p.keys,i=pieceAt(k,t);
 const a=k[i],b=k[i+1]??a,span=b.t-a.t,f=span>0?Math.min(1,Math.max(0,(t-a.t)/span)):0,moving=span>0&&(b.x!==a.x||b.y!==a.y);
 const x=a.x+(b.x-a.x)*f,y=a.y+(b.y-a.y)*f;
 // 轉身不在路點瞬間跳：路點前後各 TURN 秒（也不超過前後兩段各一半的時間）內，朝向從上一段等速轉到下一段。第一段開頭、最後一段結尾不轉。
 // 轉身時步子縮小：路點前後 DIP 秒（不超過這一段）內，擺幅乘上 step，轉 90° 時在路點那一刻降到 0（原地換腳）。
 let heading=pieceHeading(k,i),step=1;
 if(i>0){const h0=pieceHeading(k,i-1),turn=wrap(heading-h0),d=Math.min(TURN,(a.t-k[i-1].t)/2,span/2),g=Math.min(DIP,span);
  if(d>0&&t<a.t+d)heading=h0+turn*(t-a.t+d)/(2*d);if(g>0&&t<a.t+g)step=Math.min(step,1-Math.min(1,Math.abs(turn)/(Math.PI/2))*(1-(t-a.t)/g));}
 if(i+2<k.length){const turn=wrap(pieceHeading(k,i+1)-pieceHeading(k,i)),d=Math.min(TURN,span/2,(k[i+2].t-b.t)/2),g=Math.min(DIP,span);
  if(d>0&&t>b.t-d)heading+=turn*(t-b.t+d)/(2*d);if(g>0&&t>b.t-g)step=Math.min(step,1-Math.min(1,Math.abs(turn)/(Math.PI/2))*(1-(b.t-t)/g));}
 return{id:p.id,x,y,heading,walking:moving,step,stride:a.d+Math.hypot(x-a.x,y-a.y),pose:p.pose||'stand',look:p.look,hand:p.hand,tuck:(a.tuck??0)+((b.tuck??0)-(a.tuck??0))*f};
}
// 拖在身後的東西（行李箱）：沿走過的路往回量弧長 back 的那一點（世界座標）；路不夠長就從起點沿第一段反方向延伸，沒走過路就往朝向的反方向。
// 用弧長不用「離肩膀恰好多遠」：後者在轉角會從一段路跳到另一段（肩膀不在路上，往回走時離肩膀的距離先變近再變遠）。
export function trailPoint(p,t,back){
 const k=p.keys,i=pieceAt(k,t),v=personAt(p,t),d=(v?v.stride:k[i].d)-back;
 for(let j=i;j>=0;j--){const a=k[j],b=k[j+1];if(!b||!(b.d>a.d)||d<a.d)continue;const f=Math.min(1,(d-a.d)/(b.d-a.d));return[a.x+(b.x-a.x)*f,a.y+(b.y-a.y)*f];}
 let j=0;while(j<k.length-1&&!(k[j+1].d>k[j].d))j++;
 const n=k[j+1],L=n?n.d-k[j].d:0,h=v?v.heading:k[0].face,dx=L?(k[j].x-n.x)/L:-Math.cos(h),dy=L?(k[j].y-n.y)/L:-Math.sin(h),o=k[0].d-d;
 return[k[0].x+dx*o,k[0].y+dy*o];
}
// 走道：上天橋那一段的直行道（柱距 0.32、避開擋在天橋前的長椅），由右往左排。
function columnsFor(platform,R){
 const {bridge,obstacles}=platform,front=Math.min(platform.outer,platform.edge),back=Math.max(platform.outer,platform.edge);
 let hi=bridge.x1-R-.03;for(const o of obstacles)if(o.x1>bridge.x0&&o.x0<bridge.x1&&o.y1>front&&o.y0<back)hi=Math.min(hi,o.x0-R-.03);
 const lo=bridge.x0+R+.03,cols=[];for(let x=hi;x>=lo-1e-9;x-=PEOPLE.columnStep)cols.push(x);return cols;
}
export function planStop(stop,{timetable,doors,platform,seed=20260924}){
 const P=PEOPLE,R=P.radius,r=mulberry32(seed^Math.imul(stop+1,0x9E3779B1)),T0=stop*timetable.lap,ph=timetable.phases;
 const out=Math.sign(platform.outer-platform.edge),Y=depth=>platform.edge+out*depth,openEnd=T0+ph.openEnd,closeStart=T0+ph.closeStart;
 const cols=columnsFor(platform,R),xIn=(cols[0]+cols[cols.length-1])/2,hutY=platform.hutFront,hideY=platform.hutFront+out*.5;
 const B=4+Math.floor(r()*(Math.min(8,12-P.idle-2)-4+1)),A=2+Math.floor(r()*(Math.min(6,12-P.idle-B)-2+1));
 const people=[],byDoor=new Map(doors.map(d=>[d.id,{door:d,alight:[],board:[],spots:[]}]));
 // 候車點：門兩側、黃線後；離任何一扇門的中線與別的候車點都 ≥0.34（下車者沿門的中線走出來）。
 const taken=[];for(const s of byDoor.values())for(const off of P.spotOffsets){const x=s.door.x+off;
  if(x<platform.xMin+R+.2||x>platform.xMax-R-.2)continue;if(doors.some(d=>Math.abs(d.x-x)<P.spotClear)||taken.some(v=>Math.abs(v-x)<P.spotClear))continue;taken.push(x);s.spots.push(x);}
 const order=[...byDoor.values()];for(let i=order.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
 // 下車：最多 4 扇門、每門 ≤2 人；第一輪每門 1～2 人，不夠再把只下 1 人的門補到 2 人。
 let left=A,used=0;for(const s of order){if(!left||used===P.maxAlightDoors)break;const n=Math.min(left,P.maxAlightPerDoor,1+Math.floor(r()*2));for(let k=0;k<n;k++)s.alight.push(k);left-=n;used++;}
 for(const s of order){if(!left)break;if(s.alight.length===1){s.alight.push(1);left--;}}
 // 上車：依序填各門的候車點，每門 ≤3 人。
 let need=B;for(let pass=0;pass<P.maxPerDoor&&need;pass++)for(const s of order){if(!need)break;if(s.board.length<Math.min(P.maxPerDoor,s.spots.length)&&s.board.length===pass){s.board.push(s.spots[pass]);need--;}}
 // 下車者的走道：天橋左右兩群分開、近的門走靠軌道的走道與靠內側的直行道，路線不交叉。
 const alightDoors=[...byDoor.values()].filter(s=>s.alight.length),hi=cols[0];
 const right=alightDoors.filter(s=>s.door.x>hi).sort((a,b)=>a.door.x-b.door.x),leftGroup=alightDoors.filter(s=>s.door.x<=hi).sort((a,b)=>b.door.x-a.door.x);
 right.forEach((s,i)=>{s.column=cols[right.length-1-i];s.lane=i;});leftGroup.forEach((s,i)=>{s.column=cols[right.length+i];s.lane=i;});
 // 車內路點（世界單位；a＝沿車身往車廂中心、e＝從門往車內），由車模量得（車模公尺×.4124）：隔間牆離門中心 1.10 m、通道口在 |y| .875～1.225、
 // 門廳背牆在 |y| .875 從車端延伸到隔間牆。上車者沿門廳走到通道口、穿過去、往車中心線走（繞過背牆端點），最後轉向車廂中心走一小步才隱藏：
 // 這時連拖在身後的行李箱都在背牆後面，從自家門洞任何角度都看不到（T8 用正式車模驗）。下車者從車中心線上、背牆後面出現，面向門走出來。
 const IN={mouth:[.41,.165],through:[.495,.186],center:[.495,.62],hide:[.557,.62],appear:[.495,.64]};
 let id=0;const inside=d=>[d.x,d.y-out*.12],car=(d,[a,e])=>[d.x+d.inboard*a,d.y-out*e],sill=d=>[d.x,Y(.05)];
 // 門檻（深 .05）以內與車內 tuck＝1：手提包收到身前、行李箱立起來貼在身後，月台上 0，中間照時間內插（畫法在 garage-people.js）。
 const tuck=keys=>{for(const k of keys)k.tuck=out*(k.y-platform.edge)<=.05+1e-9?1:0;return keys;};
 // 拉行李箱的手（1＝左手、−1＝右手）：門內那個 90° 轉角外側的那隻手，轉身時箱子留在外側，不會甩到另一隻腳後面。
 const hand=(d,role)=>(role==='alight'?1:-1)*Math.sign(out*d.inboard);
 const walkIn=d=>[inside(d),car(d,IN.mouth),car(d,IN.through),car(d,IN.center),car(d,IN.hide)],walkOut=d=>[car(d,IN.through),car(d,IN.mouth),inside(d)];
 const len=(a,pts)=>pts.reduce((L,b)=>{L+=Math.hypot(b[0]-a[0],b[1]-a[1]);a=b;return L;},0);
 let firstBoard=null;
 for(const s of byDoor.values()){const d=s.door;let lastExit=-Infinity;
  for(const k of s.alight){const exit=openEnd+k*P.exitGap,start=car(d,IN.appear),t0=exit-len(start,walkOut(d))/P.walk,laneY=Y(P.laneDepth+s.lane*P.laneStep);
   const keys=tuck(route(t0,start,[...walkOut(d),sill(d),[d.x,laneY],[s.column,laneY],[s.column,platform.outer],[s.column,hutY],[s.column,hideY]],P.walk));
   people.push({id:'s'+stop+'-'+id++,stop,role:'alight',door:d.id,look:makeLook(r),hand:hand(d,'alight'),appear:t0,vanish:keys[keys.length-1].t,keys});lastExit=Math.max(lastExit,exit);}
  const boardStart=Number.isFinite(lastExit)?lastExit+P.clear:openEnd+.3;
  s.board.forEach((x,j)=>{const t=boardStart+j*P.boardGap;s.boardTimes=(s.boardTimes||[]).concat(t);});
 }
 // 進站前：候車者由遠到近陸續從樓梯口小屋走出來，站到候車點面向軌道。
 const boarders=[];for(const s of byDoor.values())s.board.forEach((x,j)=>boarders.push({s,x,j,len:Math.abs(x-xIn)+Math.abs(Y(P.boardLaneDepth)-hutY)}));
 boarders.sort((a,b)=>b.len-a.len);let emerge=T0-P.emerge;const faceTrack=Math.atan2(-out,0);
 for(const b of boarders){const d=b.s.door,waitY=Y(P.waitDepth),laneY=Y(P.boardLaneDepth),t0=emerge;emerge+=1.2+r()*1.8;
  const keys=route(t0,[xIn,hideY],[[xIn,hutY],[xIn,laneY],[b.x,laneY],[b.x,waitY]],P.walk),arrived=keys[keys.length-1].t,go=b.s.boardTimes[b.j];
  // 上車先走到門正前方（深 frontDepth）再直直走進門：拖在身後的行李箱跟著從門洞正中進去，斜著進門箱子會掃到門邊的車殼。
  hold(keys,go,faceTrack);const base=keys[keys.length-1].d,board=route(go,[b.x,waitY],[[d.x,Y(P.frontDepth)],sill(d),...walkIn(d)],P.walk);for(const k of board.slice(1)){k.d+=base;keys.push(k);}
  const person={id:'s'+stop+'-'+id++,stop,role:'board',door:d.id,look:makeLook(r),hand:hand(d,'board'),appear:t0,vanish:keys[keys.length-1].t,keys:tuck(keys),arrived,boardAt:go};people.push(person);
  if(!firstBoard||go<firstBoard.boardAt)firstBoard=person;}
 const showcaseTime=firstBoard?(firstBoard.boardAt+firstBoard.vanish)/2:T0+ph.openEnd+1;
 return{stop,people,showcaseTime,counts:{board:boarders.length,alight:people.filter(p=>p.role==='alight').length,idle:P.idle},closeStart,openEnd};
}
// 不搭車的人：長椅上坐兩位、站名牌前站一位；整天都在，不隨站號變。
export function idlePeople(platform,seed=20260924){
 const r=mulberry32(seed^0x51ED27),out=Math.sign(platform.outer-platform.edge),faceTrack=Math.atan2(-out,0),seats=platform.benches.slice(0,2),sign=platform.signs[1]??platform.signs[0];
 const at=(x,y,face,pose,i)=>({id:'idle-'+i,role:'idle',pose,look:makeLook(r),appear:-Infinity,vanish:Infinity,keys:[{t:-Infinity,x,y,d:0,face}]});
 return[at(seats[0].x-.35,seats[0].y,faceTrack,'sit',0),at(seats[1].x+.35,seats[1].y,faceTrack,'sit',1),at(sign.x+.32,sign.y-out*.34,Math.atan2(out,0),'stand',2)];
}
