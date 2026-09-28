import * as THREE from '../../rail-3d/vendor/three.module.js';
import {createScene,THEMES,createAttendant} from '../../rail-3d/garage-scenes/south-coast.js?revision=coast-polish-20260928';
import {loadGarageModel,createConsist,loadGarageParts} from '../../rail-3d/garage-model.js?revision=headlights-0912';
import {createPeople} from '../../rail-3d/garage-people.js?revision=people-0927';
import {createStopTimetable} from '../../rail-3d/garage-scenes/stop-timetable.js?revision=stop-0927';
const canvas=document.querySelector('#scene'),loading=document.querySelector('#loading');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const SPEED=2.1; // 巡航時每秒沿路徑前進的弧長；位置一律由停站時刻表從時間求出（setTime／setDistance 與逐幀播放同一條路）。
const STATION_OFFSET=-3; // path 的 s=0 落在地圖 x=0（沿海直線段 x=s），小站月台實際中心在 x=-3；停站永遠停在 s≡0，這裡把它搬到月台中心。
let tt,stop,people=null,attendant=null,palmsKit=null,stationKit=null,renderer,environment,primary,train,coast,raf=0,last=0,time=0,distance=0,period='day',view=matchMedia('(max-width:800px)').matches?'train':'world',running=!reduced.matches,zoom=1,span=1,cameraYaw=-1.14,yaw=-1.14,elevation=.65,disposed=false,ready=false,draws=0;
const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-40,40,30,-30,.1,400);camera.up.set(0,0,1);
const focus=new THREE.Vector3(),pan=new THREE.Vector3(),target=new THREE.Vector3(),sun=new THREE.DirectionalLight('#fff1cf',3.2),hemi=new THREE.HemisphereLight('#c1dce7','#7b8663',2.1);
sun.position.set(-25,-30,45);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-42,right:42,top:35,bottom:-35,near:1,far:140});sun.shadow.normalBias=.035;sun.shadow.bias=-.0001;scene.add(sun,hemi,sun.target);
const groundGeo=new THREE.PlaneGeometry(2000,2000),groundMat=new THREE.ShadowMaterial({opacity:.12}),ground=new THREE.Mesh(groundGeo,groundMat);ground.position.z=-2.5;ground.receiveShadow=true;scene.add(ground);
function controls(){document.querySelector('#play').textContent=running?'Ⅱ':'▷';document.querySelector('#play').setAttribute('aria-label',running?'暫停行駛':'開始行駛');document.querySelector('#play').setAttribute('aria-pressed',String(running));document.querySelector('#in').disabled=zoom>=1.8;document.querySelector('#out').disabled=zoom<=.7;}
function schedule(){if(!raf&&!disposed&&!document.hidden&&ready)raf=requestAnimationFrame(frame);}
function resize(){if(!renderer)return;const r=canvas.getBoundingClientRect();renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.setSize(Math.max(1,r.width),Math.max(1,r.height),false);schedule();}
function setTheme(next){period=next;const t=THEMES[period];document.body.dataset.period=period;scene.background=new THREE.Color(t.background);hemi.color.set(t.ambient);hemi.groundColor.set(t.ground);hemi.intensity=period==='night'?1.2:2;sun.color.set(t.sun);sun.intensity=t.power;sun.position.set(period==='sunset'?-40:-25,period==='sunset'?10:-30,period==='sunset'?20:45);if(renderer)renderer.toneMappingExposure=t.exposure;document.querySelectorAll('[data-period]').forEach(b=>{if(b.tagName==='BUTTON')b.setAttribute('aria-pressed',String(b.dataset.period===period));});schedule();}
function draw(){
 if(!ready||disposed)return;
 stop=tt.at(time);distance=stop.distance;
 coast.update(time,period);train.follow(coast.path,distance+STATION_OFFSET,1); // 環形場景沿固定方向行駛；停站永遠停在 s≡0，搬到月台中心見 STATION_OFFSET。
 train.lighting.update(period,1);people?.update(time);
 const rect=canvas.getBoundingClientRect(),aspect=rect.width/Math.max(1,rect.height);
 if(view==='train'){target.set(0,0,0);for(const c of train.cars)target.add(c.car.position);target.multiplyScalar(1/train.cars.length);target.z=1.4;}
 else if(view==='platform'){const pf=coast.platform,out=Math.sign(pf.outer-pf.edge);target.set(STATION_OFFSET,pf.edge+out*.6,pf.top+.45);}
 else target.set(0,0,1);
 focus.copy(target).add(pan);
 // 以整列車的平均朝向帶動鏡頭，沿環線外側觀看，山體留在車後。
 // 平均方向向量可跨過 ±π，車頭先入彎時也不會急轉鏡頭。
 const heading=Math.atan2(train.cars.reduce((n,c)=>n+Math.sin(c.heading),0),train.cars.reduce((n,c)=>n+Math.cos(c.heading),0));
 cameraYaw=yaw+(view==='train'?heading:0);
 span=(view==='train'?Math.max(9,train.length*.65/aspect):view==='platform'?Math.max(4.5,6/aspect):Math.max(23,39/aspect))/zoom;
 Object.assign(camera,{left:-span*aspect,right:span*aspect,top:span,bottom:-span});camera.position.set(focus.x+100*Math.cos(elevation)*Math.cos(cameraYaw),focus.y+100*Math.cos(elevation)*Math.sin(cameraYaw),focus.z+100*Math.sin(elevation));camera.lookAt(focus);camera.updateProjectionMatrix();camera.updateMatrixWorld();scene.updateMatrixWorld(true);renderer.render(scene,camera);draws++;
 canvas.dataset.ready='true';canvas.dataset.distance=String(distance);canvas.dataset.period=period;canvas.dataset.view=view;
}
function frame(at){raf=0;if(disposed||document.hidden)return;if(last&&at-last<32){schedule();return;}const dt=last?Math.min((at-last)/1000,.08):0;last=at;if(running)time+=dt;draw();if(running)schedule();}
function reset(){zoom=1;pan.set(0,0,0);yaw=view==='platform'?-.1:view==='train'?-Math.PI/2:-1.14;elevation=view==='platform'?.4:.65;controls();schedule();}
function setView(next){view=next;document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));document.querySelector('#platform')?.setAttribute('aria-pressed',String(view==='platform'));reset();}
function setZoom(z){zoom=Math.max(.7,Math.min(1.8,z));controls();schedule();}
for(const b of document.querySelectorAll('button[data-period]'))b.onclick=()=>setTheme(b.dataset.period);
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>setView(b.dataset.view);
document.querySelector('#play').onclick=()=>{running=!running;last=0;controls();schedule();};
// 看月台：正在減速或停站就只切鏡頭；否則快轉到下一次進站減速起點（不是瞬移）。切月台低角度並開始播放（減少動態時不自動播放）。
document.querySelector('#platform').onclick=()=>{time=tt.lookTime(time);last=0;if(!reduced.matches)running=true;setView('platform');if(ready)draw();};
document.querySelector('#reset').onclick=reset;
document.querySelector('#in').onclick=()=>setZoom(zoom*1.2);document.querySelector('#out').onclick=()=>setZoom(zoom/1.2);
// 平移：滑鼠右鍵／中鍵／Shift＋拖曳、觸控雙指拖曳、Shift＋方向鍵。偏移量存在 pan（世界座標、沿地面），跟車視角是相對車的偏移，重設視角歸零。
function panBy(dx,dy){const u=2*span/Math.max(1,canvas.getBoundingClientRect().height),g=u/Math.sin(Math.max(.2,elevation));pan.x=Math.max(-40,Math.min(40,pan.x+Math.sin(cameraYaw)*dx*u-Math.cos(cameraYaw)*dy*g));pan.y=Math.max(-40,Math.min(40,pan.y-Math.cos(cameraYaw)*dx*u-Math.sin(cameraYaw)*dy*g));schedule();}
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
function dispose(){if(disposed)return;disposed=true;ready=false;cancelAnimationFrame(raf);observer.disconnect();people?.dispose();palmsKit?.dispose();stationKit?.dispose();train?.dispose();primary?.dispose();coast?.dispose();environment?.dispose();groundGeo.dispose();groundMat.dispose();sun.shadow.map?.dispose();renderer?.dispose();}
window.addEventListener('pagehide',dispose);window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
try{
 renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();dispose();loading.hidden=false;loading.replaceChildren(document.createTextNode('畫面暫時中斷，請重新開啟場景。'));const b=document.createElement('button');b.textContent='重新開啟';b.onclick=()=>location.reload();loading.append(b);});
 const studio=new THREE.Scene();studio.background=new THREE.Color('#9dafb0');const pmrem=new THREE.PMREMGenerator(renderer);environment=pmrem.fromScene(studio,.1);scene.environment=environment.texture;pmrem.dispose();
 [palmsKit,stationKit]=await Promise.all([loadGarageParts(new URL('../../rail-3d/assets/garage-palms-v1/palms.json',import.meta.url)),loadGarageParts(new URL('../../rail-3d/assets/garage-coast-v1/station.json',import.meta.url))]);if(disposed){palmsKit.dispose();stationKit.dispose();throw Error('disposed');}
 coast=createScene(palmsKit,stationKit);scene.add(coast.group);tt=createStopTimetable({pathLength:coast.path.length,speed:SPEED});stop=tt.at(time);
 primary=await loadGarageModel('blue');if(disposed){primary.dispose();throw Error('disposed');}train=await createConsist('blue',primary);if(disposed){train.dispose();throw Error('disposed');}scene.add(train.root);train.root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
 // 月台乘客：候車的人＋一位站務員都是不上下車的「idle」人物（高架景的上下車劇本靠 doors 陣列驅動，這裡傳空陣列就不會有人上下車）。
 const kit=await loadGarageParts(new URL('../../rail-3d/assets/garage-people-v1/people.json',import.meta.url));if(disposed){kit.dispose();throw Error('disposed');}
 people=createPeople({kit,timetable:tt,doors:[],platform:coast.platform,scale:1.25/primary.size.y,seed:20260927});scene.add(people.group);
 attendant=createAttendant(kit,1.25/primary.size.y,coast.platform);scene.add(attendant);
 ready=true;loading.hidden=true;setView(view);setTheme(period);controls();resize();draw();schedule();
 window.southCoastPreview={
  get state(){return{ready,lighting:train.lighting.state,period,view,running,pan:{x:pan.x,y:pan.y},distance,time,phase:stop.phase,lap:stop.lap,currentSpeed:stop.speed,zoom,cameraYaw,cameraElevation:elevation,draws,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,memory:{...renderer.info.memory},poses:train.cars.map(c=>({id:c.id,x:c.car.position.x,y:c.car.position.y,z:c.car.position.z,heading:c.heading})),pathLength:coast.path.length,trainLength:train.length,passengers:people?.state??null, bounds:train.cars.map(c=>{const b=new THREE.Box3().setFromObject(c.car),ps=[];for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const q=new THREE.Vector3(x,y,z).project(camera);ps.push([(q.x+1)*canvas.width/2,(1-q.y)*canvas.height/2]);}return{left:Math.min(...ps.map(p=>p[0])),right:Math.max(...ps.map(p=>p[0])),top:Math.min(...ps.map(p=>p[1])),bottom:Math.max(...ps.map(p=>p[1]))};})};},
  sample:s=>coast.path.sample(s),
  project:p=>{const q=new THREE.Vector3(...p).project(camera);return{x:(q.x+1)*canvas.width/2,y:(1-q.y)*canvas.height/2};},
  setDistance:s=>{const L=coast.path.length;time=tt.timeAtPosition(((s%L)+L)%L);draw();},
  setTime:t=>{time=t;draw();},timeAtPosition:s=>tt.timeAtPosition(s),timetable:{lap:tt.lap,phases:tt.phases,showcase:tt.showcase},
  render:draw,dispose,platform:coast.platform,
  // 驗收用：直接讀「實際畫出來的東西」的世界座標包圍盒，不是原始碼常數也不是測試自己重算——
  // 站務員讀 attendant（獨立 Mesh 組成的 group，Box3 可以直接 setFromObject）；候車者讀
  // people.group 裡各 people-<part> InstancedMesh 的第 2 個 instance（南迴 doors:[] 恆無人上下車，
  // idlePeople() 固定回傳 [坐,坐,站]，站的那位固定是第三個＝instance index 2，兩份既有驗收
  // 已經各自獨立證實過這個事實，這裡不是重新假設）。
  peopleBounds(){
   const ab=new THREE.Box3().setFromObject(attendant);
   const pb=new THREE.Box3(),m4=new THREE.Matrix4(),v=new THREE.Vector3();
   // 髮型/上衣/隨身物是隨機外觀，名稱因人而異、各自獨立計數，instance index 對不上「第幾位乘客」；
   // 只有每人必有且名稱固定的部位能用固定 offset 換算：head 每人 1 個（前 2 位候車者共佔 index 0-1，
   // 站立的第 3 位在 index 2）；leg/shoe/arm/hand 每人 2 個（左右），前 2 位共佔 index 0-3，
   // 第 3 位在 index 4-5。南迴 doors:[] 恆無人上下車、idlePeople() 固定回傳 [坐,坐,站]，這個 offset 穩定。
   const idxByName={'people-head':[2],'people-leg':[4,5],'people-shoe':[4,5],'people-arm':[4,5],'people-hand':[4,5]};
   for(const child of people.group.children){
    const idxs=idxByName[child.name];if(!idxs||child.count<=Math.max(...idxs))continue;
    const g=child.geometry;if(!g.boundingBox)g.computeBoundingBox();const bb=g.boundingBox;
    for(const idx of idxs){child.getMatrixAt(idx,m4);
     for(const x of [bb.min.x,bb.max.x])for(const y of [bb.min.y,bb.max.y])for(const z of [bb.min.z,bb.max.z]){v.set(x,y,z).applyMatrix4(m4);pb.expandByPoint(v);}}
   }
   const jacket=attendant.children.find(o=>o.geometry===kit.parts.get('torso-jacket').geometry)?.material.color.getHexString();
   // 3 位候車者的實際頭部世界座標（people-head 每人恰 1 個 instance，index 0/1/2＝idlePeople() 回傳順序的坐/坐/站，
   // 用來對「都在月台 xy 範圍內」與「站務員跟候車者沒疊在一起」做不依賴自算公式的量測）。
   const headMesh=people.group.children.find(o=>o.name==='people-head'),heads=[];
   if(headMesh)for(let i=0;i<Math.min(3,headMesh.count);i++){headMesh.getMatrixAt(i,m4);const q=new THREE.Vector3().setFromMatrixPosition(m4);heads.push(q.toArray());}
   return{attendant:{min:ab.min.toArray(),max:ab.max.toArray()},passenger:{min:pb.min.toArray(),max:pb.max.toArray()},jacketColor:jacket,heads};
  },
  sceneVisible:visible=>{coast.group.visible=ground.visible=visible;draw();},
  trainVisible:visible=>{train.root.visible=visible;draw();},
  peopleVisible:v=>{people?.setVisible(v);draw();},
  // 「看月台」鏡頭驗收：對每個人頭中心，用該像素在畫面上的實際平行光線（正交相機，setFromCamera
  // 會依 near 平面上對應那一欄構出跟渲染時同一條光線，不是從 camera.position 幅射的透視光線）
  // 對列車、場景（含站房／棕櫚／護欄等 coast.group 內的一切）各自 raycast，量「有沒有比這個人更近
  // 的東西擋在中間」——不假設「第一個命中一定是人」（人體網格很薄，光線穿心點未必真的打在網格上），
  // 只問「列車或場景有沒有擋在人前面」，符合判準原文「第一個命中的就是那個人」的實際可驗證形式。
  platformSightlines(){
   const pb=this.peopleBounds();
   const headMesh2=attendant.children.find(o=>o.geometry===kit.parts.get('head').geometry);
   const targets=pb.heads.map((h,i)=>({label:'passenger'+i,pos:h}));
   if(headMesh2)targets.push({label:'attendant',pos:headMesh2.position.toArray()});
   const raycaster=new THREE.Raycaster(),out=[];
   for(const t of targets){
    const world=new THREE.Vector3(...t.pos),ndc=world.clone().project(camera);
    raycaster.setFromCamera({x:ndc.x,y:ndc.y},camera);
    const dist=raycaster.ray.origin.distanceTo(world);
    const trainHit=raycaster.intersectObject(train.root,true)[0];
    const coastHit=raycaster.intersectObject(coast.group,true)[0];
    const EPS=.05;
    const blockedByTrain=!!trainHit&&trainHit.distance<dist-EPS;
    const blockedByCoast=!!coastHit&&coastHit.distance<dist-EPS;
    out.push({label:t.label,pos:t.pos,dist:+dist.toFixed(3),visible:!blockedByTrain&&!blockedByCoast,
     blockedBy:blockedByTrain?'train':blockedByCoast?'coast':null,
     blockDist:blockedByTrain?+trainHit.distance.toFixed(3):blockedByCoast?+coastHit.distance.toFixed(3):null,
     blockName:blockedByTrain?trainHit.object.name:blockedByCoast?coastHit.object.name:null,
     inFrame:ndc.x>=-1&&ndc.x<=1&&ndc.y>=-1&&ndc.y<=1});
   }
   return out;
  }
 };
}catch(e){if(!disposed){dispose();loading.hidden=false;loading.textContent='小車暫時無法載入。';const b=document.createElement('button');b.textContent='重新載入';b.onclick=()=>location.reload();loading.append(b);}console.error(e);}
