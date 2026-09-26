import * as THREE from '../../rail-3d/vendor/three.module.js';
import {createScene,THEMES} from '../../rail-3d/garage-scenes/viaduct.js?revision=stop-0924';
import {loadGarageModel,createConsist,loadGarageParts} from '../../rail-3d/garage-model.js?revision=doors-0924';
import {createPeople} from '../../rail-3d/garage-people.js?revision=people-0924';
import {createTerrainFollower} from '../../rail-3d/garage-scenes/consist-3d.js';
import {createStopTimetable} from '../../rail-3d/garage-scenes/stop-timetable.js?revision=stop-0924';
const canvas=document.querySelector('#scene'),loading=document.querySelector('#loading');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const SPEED=2.1; // 巡航時每秒沿路徑前進的弧長；位置一律由停站時刻表從時間求出（setTime 與逐幀播放同一條路）。
let follow3D,renderer,environment,primary,train,viaduct,tt,stop,people=null,stopDoors=[],raf=0,last=0,time=0,distance=0,period='day',view=matchMedia('(max-width:800px)').matches?'train':'world',running=!reduced.matches,zoom=1,span=1,yaw=-1.12,elevation=.58,disposed=false,ready=false,draws=0;
const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-40,40,30,-30,.1,400);camera.up.set(0,0,1);
const focus=new THREE.Vector3(),pan=new THREE.Vector3(),target=new THREE.Vector3(),sun=new THREE.DirectionalLight('#fff1cf',3.2),hemi=new THREE.HemisphereLight('#c1dce7','#7b8663',2.1);
sun.position.set(-25,-30,45);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-42,right:42,top:35,bottom:-35,near:1,far:140});sun.shadow.normalBias=.035;sun.shadow.bias=-.0001;scene.add(sun,hemi,sun.target);
const groundGeo=new THREE.PlaneGeometry(2000,2000),groundMat=new THREE.ShadowMaterial({opacity:.12}),ground=new THREE.Mesh(groundGeo,groundMat);ground.position.z=-2.5;ground.receiveShadow=true;scene.add(ground);
function controls(){document.querySelector('#play').textContent=running?'Ⅱ':'▷';document.querySelector('#play').setAttribute('aria-label',running?'暫停行駛':'開始行駛');document.querySelector('#play').setAttribute('aria-pressed',String(running));document.querySelector('#in').disabled=zoom>=1.8;document.querySelector('#out').disabled=zoom<=.7;}
function schedule(){if(!raf&&!disposed&&!document.hidden&&ready)raf=requestAnimationFrame(frame);}
function resize(){if(!renderer)return;const r=canvas.getBoundingClientRect();renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.setSize(Math.max(1,r.width),Math.max(1,r.height),false);schedule();}
function setTheme(next){period=next;const t=THEMES[period];document.body.dataset.period=period;scene.background=new THREE.Color(t.background);hemi.color.set(t.ambient);hemi.groundColor.set(t.ground);hemi.intensity=period==='night'?1.2:2;sun.color.set(t.sun);sun.intensity=t.power;sun.position.set(period==='sunset'?-40:-25,period==='sunset'?10:-30,period==='sunset'?20:45);if(renderer)renderer.toneMappingExposure=t.exposure;document.querySelectorAll('[data-period]').forEach(b=>{if(b.tagName==='BUTTON')b.setAttribute('aria-pressed',String(b.dataset.period===period));});schedule();}
// 月台側車門中心（世界座標）：有車門中繼資料就用它；舊車模沒有，就取每節車月台側車身面、車廂兩端往內 0.2 車長、門高的點。
function doorPoints(which='platform'){
 if(train.doors)return train.doors.points(which).map(p=>p.point);
 const pf=viaduct.platform,side=Math.sign(pf.edge-pf.trackY)*(which==='platform'?1:-1),out=[];
 for(const c of train.cars)for(const k of [-.3,.3]){const h=c.heading;out.push(new THREE.Vector3(c.car.position.x+Math.cos(h)*c.length*k-Math.sin(h)*side*.625,c.car.position.y+Math.sin(h)*c.length*k+Math.cos(h)*side*.625,pf.top+.45));}
 return out;
}
// 雨棚擋到進站或停著的車門就淡：月台側每扇門中心往鏡頭的射線穿過雨棚外框 → 目標 0.25，否則 1；真實時間漸變（暫停時也反應鏡頭）。
const toCamera=new THREE.Vector3(),ray=new THREE.Ray(),platformNormal=new THREE.Vector3();let canopyGoal=1,canopyNow=1,canopyFade=true;
function fadeCanopy(dt){
 toCamera.set(0,0,1).applyQuaternion(camera.quaternion);   // 正交鏡頭：每一點看向鏡頭都是同一個方向
 const atPlatform=stop.phase==='braking'||stop.phase==='stopped';
 canopyGoal=canopyFade&&atPlatform&&doorPoints().some(p=>ray.set(p,toCamera).intersectsBox(viaduct.canopyBox))?.25:1;
 canopyNow=canopyGoal<canopyNow?Math.max(canopyGoal,canopyNow-2.5*dt):Math.min(canopyGoal,canopyNow+2.5*dt);
 viaduct.setCanopyOpacity(canopyNow);
}
function draw(dt=0){
 if(!ready||disposed)return;
 stop=tt.at(time);distance=stop.distance;
 viaduct.update(time,period);follow3D(viaduct.path,distance);train.updateParts?.();
 // 車燈先更新：門廳透光讀的是這一幀的窗燈強度。
 train.lighting.update(period,1);train.doors?.update(stop.doors,platformNormal);people?.update(time);
 const rect=canvas.getBoundingClientRect(),aspect=rect.width/Math.max(1,rect.height);
 if(view==='train'){target.set(0,0,0);for(const c of train.cars)target.add(c.car.position);target.multiplyScalar(1/train.cars.length);target.z+=1.4;}else if(view==='platform'){const pf=viaduct.platform;target.set(1.6,pf.edge-.4,pf.top+.45);}else target.set(0,1.5,2.6);
 focus.copy(target).add(pan);
 span=(view==='train'?Math.max(9,train.length*.65/aspect):view==='platform'?Math.max(4.5,6/aspect):Math.max(24,35/aspect))/zoom;
 Object.assign(camera,{left:-span*aspect,right:span*aspect,top:span,bottom:-span});camera.position.set(focus.x+100*Math.cos(elevation)*Math.cos(yaw),focus.y+100*Math.cos(elevation)*Math.sin(yaw),focus.z+100*Math.sin(elevation));camera.lookAt(focus);camera.updateProjectionMatrix();camera.updateMatrixWorld();scene.updateMatrixWorld(true);fadeCanopy(dt);renderer.render(scene,camera);draws++;
 canvas.dataset.ready='true';canvas.dataset.distance=String(distance);canvas.dataset.period=period;canvas.dataset.view=view;
}
function frame(at){raf=0;if(disposed||document.hidden)return;if(last&&at-last<32){schedule();return;}const dt=last?Math.min((at-last)/1000,.08):0;last=at;if(running)time+=dt;draw(dt);if(running||canopyNow!==canopyGoal)schedule();}
function reset(){zoom=1;pan.set(0,0,0);yaw=view==='platform'?-1.35:-1.12;elevation=view==='train'?.42:view==='platform'?.2:.58;controls();schedule();}
function setView(next){view=next;document.querySelectorAll('button[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));document.querySelector('#platform').setAttribute('aria-pressed',String(view==='platform'));reset();}
function setZoom(z){zoom=Math.max(.7,Math.min(1.8,z));controls();schedule();}
for(const b of document.querySelectorAll('button[data-period]'))b.onclick=()=>setTheme(b.dataset.period);
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>setView(b.dataset.view);
document.querySelector('#play').onclick=()=>{running=!running;last=0;controls();schedule();};
// 看月台：正在減速或停站就只切鏡頭；否則快轉到下一次進站減速起點。切月台低角度並開始播放（減少動態時不自動播放）。
// 當場重畫一次（同 setTime）：跳過去的那一格立刻上畫面，state 也不會停在按之前。載入中還沒有車，等第一幀再畫。
document.querySelector('#platform').onclick=()=>{time=tt.lookTime(time);last=0;if(!reduced.matches)running=true;setView('platform');if(ready)draw(0);};
document.querySelector('#reset').onclick=reset;
document.querySelector('#in').onclick=()=>setZoom(zoom*1.2);document.querySelector('#out').onclick=()=>setZoom(zoom/1.2);
// 平移：滑鼠右鍵／中鍵／Shift＋拖曳、觸控雙指拖曳、Shift＋方向鍵。偏移量存在 pan（世界座標、沿地面），跟車視角是相對車的偏移，重設視角歸零。
function panBy(dx,dy){const u=2*span/Math.max(1,canvas.getBoundingClientRect().height),g=u/Math.sin(Math.max(.2,elevation));pan.x=Math.max(-40,Math.min(40,pan.x+Math.sin(yaw)*dx*u-Math.cos(yaw)*dy*g));pan.y=Math.max(-40,Math.min(40,pan.y-Math.cos(yaw)*dx*u-Math.sin(yaw)*dy*g));schedule();}
const pointers=new Map();let gesture;
canvas.oncontextmenu=e=>e.preventDefault();
canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,pan:e.button===1||e.button===2||e.shiftKey});gesture=null;};
canvas.onpointermove=e=>{if(!pointers.has(e.pointerId))return;const old=pointers.get(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,pan:old.pan});if(pointers.size===1){if(old.pan||e.shiftKey)panBy(e.clientX-old.x,e.clientY-old.y);else{yaw+=(e.clientX-old.x)*.007;elevation=Math.max(.2,Math.min(1.2,elevation+(old.y-e.clientY)*.005));schedule();}}else{const [a,b]=[...pointers.values()],gap=Math.hypot(a.x-b.x,a.y-b.y),mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};if(gesture){setZoom(gesture.zoom*gap/gesture.gap);panBy(mid.x-gesture.mid.x,mid.y-gesture.mid.y);gesture.mid=mid;}else gesture={zoom,gap:Math.max(1,gap),mid};}};
canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=e=>{pointers.delete(e.pointerId);gesture=null;};
canvas.addEventListener('wheel',e=>{e.preventDefault();setZoom(zoom*Math.exp(-Math.max(-150,Math.min(150,e.deltaY))*.002));},{passive:false});
canvas.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','0',' '].includes(e.key))return;e.preventDefault();if(e.key===' ')document.querySelector('#play').click();else if(e.key==='0')reset();else if(e.key==='+')setZoom(zoom*1.2);else if(e.key==='-')setZoom(zoom/1.2);else if(e.shiftKey)panBy(e.key==='ArrowLeft'?40:e.key==='ArrowRight'?-40:0,e.key==='ArrowUp'?40:e.key==='ArrowDown'?-40:0);else{if(e.key==='ArrowLeft')yaw-=.15;if(e.key==='ArrowRight')yaw+=.15;if(e.key==='ArrowUp')elevation=Math.min(1.2,elevation+.1);if(e.key==='ArrowDown')elevation=Math.max(.2,elevation-.1);schedule();}};
const observer=new ResizeObserver(resize);observer.observe(canvas);
document.addEventListener('visibilitychange',()=>{last=0;if(document.hidden){cancelAnimationFrame(raf);raf=0;}else schedule();});
reduced.addEventListener('change',()=>{if(reduced.matches){running=false;controls();schedule();}});
function dispose(){if(disposed)return;disposed=true;ready=false;cancelAnimationFrame(raf);observer.disconnect();people?.dispose();train?.dispose();primary?.dispose();viaduct?.dispose();environment?.dispose();groundGeo.dispose();groundMat.dispose();sun.shadow.map?.dispose();renderer?.dispose();}
window.addEventListener('pagehide',dispose);window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
try{
 renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();dispose();loading.hidden=false;loading.replaceChildren(document.createTextNode('畫面暫時中斷，請重新開啟場景。'));const b=document.createElement('button');b.textContent='重新開啟';b.onclick=()=>location.reload();loading.append(b);});
 const studio=new THREE.Scene();studio.background=new THREE.Color('#9dafb0');const pmrem=new THREE.PMREMGenerator(renderer);environment=pmrem.fromScene(studio,.1);scene.environment=environment.texture;pmrem.dispose();
 viaduct=createScene();scene.add(viaduct.group);tt=createStopTimetable({pathLength:viaduct.path.length,speed:SPEED});stop=tt.at(time);primary=await loadGarageModel('emu3000');if(disposed){primary.dispose();throw Error('disposed');}train=await createConsist('emu3000',primary);if(disposed){train.dispose();throw Error('disposed');}scene.add(train.root);train.root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
 platformNormal.set(0,Math.sign(viaduct.platform.edge-viaduct.platform.trackY),0);train.setContactWire?.(viaduct.contactWireZ);
 follow3D=createTerrainFollower(train);
 // 乘客用停站時的月台側車門：把車放到 s=0、門關著，量每扇門的世界座標與「往車廂中心」的方向。
 follow3D(viaduct.path,viaduct.path.length);train.updateParts?.();train.doors?.update(0,platformNormal);scene.updateMatrixWorld(true);
 stopDoors=train.doors?train.doors.points('platform').map(p=>({id:p.id,x:p.point.x,y:p.point.y,inboard:Math.sign(p.car.car.position.x-p.point.x)})):[];
 const kit=await loadGarageParts(new URL('../../rail-3d/assets/garage-people-v1/people.json',import.meta.url));if(disposed){kit.dispose();throw Error('disposed');}
 people=createPeople({kit,timetable:tt,doors:stopDoors,platform:viaduct.platform,scale:1.25/primary.size.y});scene.add(people.group);
 if(reduced.matches){time=people.plan(0).showcaseTime;stop=tt.at(time);}
 ready=true;loading.hidden=true;setView(view);setTheme(period);controls();resize();draw();schedule();
 window.viaductPreview={
  get state(){return{ready,lighting:train.lighting.state,period,view,running,pan:{x:pan.x,y:pan.y},distance,time,phase:stop.phase,lap:stop.lap,doors:stop.doors,currentSpeed:stop.speed,canopyOpacity:viaduct.canopyOpacity,canopyTarget:canopyGoal,passengers:people?.state??null,zoom,draws,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,memory:{...renderer.info.memory},poses:train.cars.map(c=>({id:c.id,x:c.car.position.x,y:c.car.position.y,z:c.car.position.z,heading:c.heading,pitch:c.pitch,offset:c.offset,length:c.length})),trainLength:train.length,pathLength:viaduct.path.length,params:viaduct.params,speed:SPEED, bounds:train.cars.map(c=>{const b=new THREE.Box3().setFromObject(c.car),ps=[];for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const q=new THREE.Vector3(x,y,z).project(camera);ps.push([(q.x+1)*canvas.width/2,(1-q.y)*canvas.height/2]);}return{left:Math.min(...ps.map(p=>p[0])),right:Math.max(...ps.map(p=>p[0])),top:Math.min(...ps.map(p=>p[1])),bottom:Math.max(...ps.map(p=>p[1]))};})};},
  sample:s=>viaduct.path.sample(s),
  project:p=>{const q=new THREE.Vector3(...p).project(camera);return{x:(q.x+1)*canvas.width/2,y:(1-q.y)*canvas.height/2};},
  setTime:t=>{time=t;draw(0);schedule();},render:()=>draw(0),dispose,
  trainVisible:visible=>{train.root.visible=visible;draw();},
  timeAtPosition:s=>tt.timeAtPosition(s),timetable:{lap:tt.lap,phases:tt.phases,showcase:tt.showcase},
  setCanopyFade:on=>{canopyFade=on;draw(0);schedule();},
  setCamera:({view:v,yaw:y,elevation:e,zoom:z}={})=>{if(v)setView(v);if(y!==undefined)yaw=y;if(e!==undefined)elevation=e;if(z!==undefined)setZoom(z);draw(0);schedule();},
  doorPoints:(which='platform')=>doorPoints(which).map(p=>p.toArray()),
  platform:viaduct.platform,
  cars:()=>train.cars.map(c=>{const b=new THREE.Box3().setFromObject(c.body);return{id:c.id,x:c.car.position.x,y:c.car.position.y,heading:c.heading,length:c.length,min:b.min.toArray(),max:b.max.toArray()};}),
  sill:()=>viaduct.path.sample(0).z+(primary.doors?.threshold??.921)*1.25/primary.size.y,
  isolate:on=>{viaduct.group.visible=!on;ground.visible=!on;people?.setVisible(!on);scene.background=on?new THREE.Color('#ff00ff'):new THREE.Color(THEMES[period].background);draw(0);},
  pantographs:()=>train.pantographState?.()??[],
  setContactWire:z=>{train.setContactWire?.(z);draw(0);},
  contactWireZ:viaduct.contactWireZ,
  wireBox:()=>{const b=new THREE.Box3().setFromObject(viaduct.group.getObjectByName('contact-wire'));return{min:b.min.toArray(),max:b.max.toArray()};},
  get passengers(){return people?{...people.state,stopDoors,showcaseTime:people.plan(0).showcaseTime}:null;},
  peopleVisible:v=>{people?.setVisible(v);draw(0);},
  lampsVisible:v=>{viaduct.group.traverse(o=>{if(o.isLight&&o.name.startsWith('platform-lamp'))o.visible=v;});draw(0);}
 };
}catch(e){if(!disposed){dispose();loading.hidden=false;loading.textContent='小車暫時無法載入。';const b=document.createElement('button');b.textContent='重新載入';b.onclick=()=>location.reload();loading.append(b);}console.error(e);}
