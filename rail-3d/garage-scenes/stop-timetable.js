// 高架停站時刻表：時間 → 位置、速度、圈數、階段、門開度。純函式，Node 與瀏覽器共用。
// t=0 是第 0 圈進站減速的起點；每圈在路徑 s=0（月台中心）停一次。distance 單調遞增，每圈加一個路徑長。
export const STOP_DEFAULTS=Object.freeze({brake:5,dwell:15,accel:6,doorMove:3,settle:.8,closeHold:.5});
export function createStopTimetable({pathLength,speed,...options}){
 const o={...STOP_DEFAULTS,...options};
 const brakeDist=speed*o.brake/2,accelDist=speed*o.accel/2,cruiseDist=pathLength-brakeDist-accelDist;
 if(!(cruiseDist>0))throw Error('stop timetable: path too short');
 const departAt=o.brake+o.dwell,cruiseAt=departAt+o.accel,lap=cruiseAt+cruiseDist/speed;
 const openStart=o.brake+o.settle,openEnd=openStart+o.doorMove,closeEnd=departAt-o.closeHold,closeStart=closeEnd-o.doorMove;
 if(!(closeStart>openEnd))throw Error('stop timetable: dwell too short for doors');
 function doorsAt(u){if(u<openStart||u>=closeEnd)return 0;if(u<openEnd)return (u-openStart)/o.doorMove;if(u<closeStart)return 1;return 1-(u-closeStart)/o.doorMove;}
 function at(t){
  const n=Math.floor(t/lap),u=t-n*lap;let phase,v,d;
  if(u<o.brake){phase='braking';v=speed*(1-u/o.brake);d=speed*u-speed*u*u/(2*o.brake);}
  else if(u<departAt){phase='stopped';v=0;d=brakeDist;}
  else if(u<cruiseAt){const w=u-departAt;phase='accelerating';v=speed*w/o.accel;d=brakeDist+speed*w*w/(2*o.accel);}
  else{phase='cruising';v=speed;d=brakeDist+accelDist+speed*(u-cruiseAt);}
  return{t,lap:n,local:u,phase,speed:v,distance:(n+1)*pathLength-brakeDist+d,doors:phase==='stopped'?doorsAt(u):0};
 }
 // 看月台：減速或停站中不跳；其餘跳到下一次減速起點。
 function lookTime(t){const s=at(t);return s.phase==='braking'||s.phase==='stopped'?t:(s.lap+1)*lap;}
 // 路徑位置 s（取模）→ 一圈內第一次經過它的時間；給「把車放到環線某處」的驗收用。
 function timeAtPosition(s){
  const u=(((s+brakeDist)%pathLength)+pathLength)%pathLength;
  if(u<=brakeDist)return o.brake*(1-Math.sqrt(Math.max(0,1-2*u/(speed*o.brake))));
  if(u<brakeDist+accelDist)return departAt+Math.sqrt(2*o.accel*(u-brakeDist)/speed);
  return cruiseAt+(u-brakeDist-accelDist)/speed;
 }
 return{at,lookTime,timeAtPosition,lap,pathLength,speed,brakeDist,accelDist,
  phases:{brake:o.brake,openStart,openEnd,closeStart,closeEnd,departAt,cruiseAt},
  showcase:openEnd+(closeStart-openEnd)*.6};
}
