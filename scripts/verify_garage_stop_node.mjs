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

if(on('T2')){
 const pf=probe.platform,railTop=probe.path.sample(0).z,threshold=asset.doors?.threshold??.921;
 const M=new THREE.Matrix4(),pos=new THREE.Vector3(),rot=new THREE.Quaternion(),scl=new THREE.Vector3(),inst=[];
 for(const o of probe.group.children)if(o.isInstancedMesh)for(let i=0;i<o.count;i++){o.getMatrixAt(i,M);M.decompose(pos,rot,scl);inst.push({m:o.material.name||'',x:pos.x,y:pos.y,z:pos.z,sx:scl.x,sy:scl.y,sz:scl.z});}
 const slab=inst.find(b=>b.m==='concrete'&&Math.abs(b.sx-probe.params.platformLength)<1e-6&&b.sy>3);
 const bridge=inst.find(b=>b.m==='concrete'&&b.x>pf.bridge.x0&&b.x<pf.bridge.x1&&b.y<pf.outer&&b.y>pf.hutFront);
 check('T2 月台方塊內緣＝platform.edge、外緣＝platform.outer、頂面＝platform.top',slab&&Math.abs(slab.y+slab.sy/2-pf.edge)<1e-6&&Math.abs(slab.y-slab.sy/2-pf.outer)<1e-6&&Math.abs(slab.z+slab.sz/2-pf.top)<1e-6,slab);
 check('T2 車身側面到月台邊間隙 0.03～0.1（車身半寬由車模尺寸推得）',Math.abs(pf.trackY-pf.edge)-asset.sizeM[1]/2*scale>=.03&&Math.abs(pf.trackY-pf.edge)-asset.sizeM[1]/2*scale<=.1,{gap:Math.abs(pf.trackY-pf.edge)-asset.sizeM[1]/2*scale});
 check('T2 月台面與車門踏板高度差 <0.01',Math.abs(pf.top-(railTop+threshold*scale))<.01,{top:pf.top,sill:railTop+threshold*scale,threshold});
 check('T2 天橋面與月台面齊平（<0.01）且接上月台外緣',bridge&&Math.abs(bridge.z+bridge.sz/2-pf.top)<.01&&Math.abs(bridge.y-bridge.sy/2-pf.hutFront)<1e-6&&Math.abs(bridge.y+bridge.sy/2-pf.outer)<1e-6,bridge);
 const yellow=inst.filter(b=>Math.abs(b.sy-.16)<1e-6&&Math.abs(b.sz-.03)<1e-6);
 check('T2 黃線在新月台邊內側 0.12、貼在月台面上',yellow.length===1&&Math.abs(yellow[0].y-(pf.edge-.12))<1e-6&&Math.abs(yellow[0].z-(pf.top+.01))<1e-6,yellow);
 const box=probe.canopyBox;
 check('T2 雨棚外框：在接觸線之上、不伸過月台邊（範圍不往內加長）',box.min.z>probe.contactWireZ+.5&&box.max.y<pf.edge-1.5,{min:box.min,max:box.max,wire:probe.contactWireZ});
 const mats=[...new Set(probe.group.children.filter(o=>o.isInstancedMesh&&/^canopy-/.test(o.material.name)).map(o=>o.material))];
 const ver=()=>mats.map(m=>m.version).join(',');
 const v0=ver();probe.setCanopyOpacity(.25);const faded=mats.every(m=>m.transparent&&!m.depthWrite&&m.opacity===.25),v1=ver();
 probe.setCanopyOpacity(.5);const v2=ver();probe.setCanopyOpacity(1);const solid=mats.every(m=>!m.transparent&&m.depthWrite&&m.opacity===1),v3=ver();
 check('T2 雨棚四種材質一起淡；只有跨過不透明的那一下才重編 shader',mats.length===4&&faded&&solid&&v0!==v1&&v1===v2&&v2!==v3&&probe.canopyOpacity===1,{names:mats.map(m=>m.name),faded,solid});
 const shadowless=probe.group.children.filter(o=>o.isInstancedMesh&&['canopy-beam','canopy-lamp'].includes(o.material.name));
 check('T2 雨棚樑與燈板不投影',shadowless.length===2&&shadowless.every(o=>!o.castShadow),shadowless.map(o=>[o.material.name,o.castShadow]));
}

probe.dispose();
const fails=results.filter(r=>!r.pass).length;console.log(`共 ${results.length} 項：FAIL ${fails}`);if(fails)process.exitCode=1;
