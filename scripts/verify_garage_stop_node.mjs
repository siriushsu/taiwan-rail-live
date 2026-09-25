// 高架停站開門：不需要瀏覽器的判準（時刻表、月台幾何、車門與集電弓數學、乘客劇本不變式）。
// 用法：node scripts/verify_garage_stop_node.mjs [T1|T2|T6|T8 …]；不帶參數跑全部。
import {readFileSync} from 'node:fs';
import * as THREE from '../rail-3d/vendor/three.module.js';
import {createScene} from '../rail-3d/garage-scenes/viaduct.js';
import {createStopTimetable} from '../rail-3d/garage-scenes/stop-timetable.js';
const want=new Set(process.argv.slice(2)),on=k=>!want.size||want.has(k);
const results=[];function check(name,pass,detail){results.push({name,pass:!!pass});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail??'').slice(0,400));}
const probe=createScene(),L=probe.path.length,SPEED=2.1,tt=createStopTimetable({pathLength:L,speed:SPEED}),P=tt.phases;
const asset=JSON.parse(readFileSync(new URL('../rail-3d/assets/garage-blender-v1/emu3000.json',import.meta.url),'utf8'));
const scale=1.25/asset.sizeM[1];

if(on('T1')){
 check('T1 一圈約 80.6 秒',Math.abs(tt.lap-80.63)<.02,{lap:tt.lap});
 {let prev=tt.at(0),back=0,jump=0,dv=0,doorsMoving=0,worst=0;
  for(let t=.01;t<=3*tt.lap;t+=.01){const s=tt.at(t),step=s.distance-prev.distance;if(step<-1e-9)back++;worst=Math.max(worst,step);if(step>SPEED*.01+1e-9)jump++;if(Math.abs(s.speed-prev.speed)>SPEED/5*.01+1e-9)dv++;if(s.doors>0&&s.speed!==0)doorsMoving++;prev=s;}
  check('T1 三圈位置不倒退、不跳、速度連續',back===0&&jump===0&&dv===0,{back,jump,dv,worst});
  check('T1 門只在速度 0 時開',doorsMoving===0,{doorsMoving});}
 for(const n of [0,1,7]){const s=tt.at(n*tt.lap+P.brake+1),m=((s.distance%L)+L)%L,err=Math.min(m,L-m);check('T1 第 '+n+' 圈停在月台中心',s.phase==='stopped'&&err<.01,{err});}
 check('T1 關好 0.5 秒後才起步',P.departAt-P.closeEnd>=.5-1e-9&&tt.at(P.closeEnd).doors===0&&tt.at(P.departAt-1e-6).doors===0,P);
 check('T1 上下車可用時間約 7.7 秒',Math.abs(P.closeStart-P.openEnd-7.7)<1e-9,{window:P.closeStart-P.openEnd});
 check('T1 展示時刻門全開',tt.at(tt.showcase).doors===1,{showcase:tt.showcase});
 const cruise=P.cruiseAt+10,brake=tt.lap*2+2,dwell=tt.lap*3+12,accel=P.departAt+2;
 check('T1 看月台：巡航中跳到下一次減速起點',tt.lookTime(cruise)===tt.lap&&tt.at(tt.lookTime(cruise)).phase==='braking',{to:tt.lookTime(cruise)});
 check('T1 看月台：減速、停站中不跳；出站加速中跳下一圈',tt.lookTime(brake)===brake&&tt.lookTime(dwell)===dwell&&tt.lookTime(accel)===tt.lap,{accel:tt.lookTime(accel)});
 check('T1 看月台連按兩次不再跳',tt.lookTime(tt.lookTime(cruise))===tt.lookTime(cruise));
 {let worst=0;for(let i=0;i<200;i++){const s=i/200*L,t=tt.timeAtPosition(s),m=((tt.at(t).distance-s)%L+L)%L;worst=Math.max(worst,Math.min(m,L-m));}check('T1 timeAtPosition 往返誤差 <1e-6',worst<1e-6,{worst});}
 {const a=tt.at(10800.3),k=Math.floor(10800.3/tt.lap),b=tt.at(10800.3-k*tt.lap),m=((a.distance-b.distance)%L+L)%L;check('T1 長跑 3 小時同一圈位置一致',a.phase===b.phase&&Math.abs(a.local-b.local)<1e-6&&Math.min(m,L-m)<1e-6&&a.doors===b.doors,{a:a.local,b:b.local});}
}

probe.dispose();
const fails=results.filter(r=>!r.pass).length;console.log(`共 ${results.length} 項：FAIL ${fails}`);if(fails)process.exitCode=1;
