import * as THREE from '../../rail-3d/vendor/three.module.js';
import {createScene,THEMES} from '../../rail-3d/garage-scenes/alishan.js?revision=alishan-trees-fireflies-occlusion-20260928';
import {loadGarageModel,createConsist,loadGarageParts} from '../../rail-3d/garage-model.js?revision=headlights-0912';
import {createJourney} from '../../rail-3d/garage-scenes/alishan-route.js?revision=turnout-sign-0912';
import {createTerrainFollower} from '../../rail-3d/garage-scenes/consist-3d.js';
const canvas=document.querySelector('#scene'),loading=document.querySelector('#loading');
// 車身世界高度目標（跟 createConsist 的 scale=1.25/primary.size.y 同一個 1.25），車廂 car.position.z
// 只是底部基準，車身視覺中心要再加半個高度——遮擋淡出/raycast 判準跟相機取景都要用同一個數字。
const TRAIN_HEIGHT=1.25;
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let journey,follow3D,pose,renderer,environment,primary,train,coast,fxKit,treesKit,raf=0,last=0,time=0,distance=0,period='day',view=matchMedia('(max-width:800px)').matches?'train':'world',running=!reduced.matches,zoom=1,span=1,yaw=-1.35,elevation=.67,disposed=false,ready=false,draws=0;
const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-40,40,30,-30,.1,400);camera.up.set(0,0,1);
const focus=new THREE.Vector3(),pan=new THREE.Vector3(),target=new THREE.Vector3(),trainCenter=new THREE.Vector3(),sun=new THREE.DirectionalLight('#fff1cf',3.2),hemi=new THREE.HemisphereLight('#c1dce7','#7b8663',2.1);
sun.position.set(-25,-30,45);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-42,right:42,top:45,bottom:-45,near:1,far:140});sun.shadow.normalBias=.035;sun.shadow.bias=-.0001;scene.add(sun,hemi,sun.target);
const groundGeo=new THREE.PlaneGeometry(2000,2000),groundMat=new THREE.ShadowMaterial({opacity:.12}),ground=new THREE.Mesh(groundGeo,groundMat);ground.position.z=-3.05;ground.receiveShadow=true;scene.add(ground);
function controls(){document.querySelector('#play').textContent=running?'Ⅱ':'▷';document.querySelector('#play').setAttribute('aria-label',running?'暫停行駛':'開始行駛');document.querySelector('#play').setAttribute('aria-pressed',String(running));document.querySelector('#in').disabled=zoom>=1.8;document.querySelector('#out').disabled=zoom<=.7;}
function schedule(){if(!raf&&!disposed&&!document.hidden&&ready)raf=requestAnimationFrame(frame);}
function resize(){if(!renderer)return;const r=canvas.getBoundingClientRect();renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.setSize(Math.max(1,r.width),Math.max(1,r.height),false);schedule();}
function setTheme(next){period=next;const t=THEMES[period];document.body.dataset.period=period;scene.background=new THREE.Color(t.background);hemi.color.set(t.ambient);hemi.groundColor.set(t.ground);hemi.intensity=period==='night'?1.2:2;sun.color.set(t.sun);sun.intensity=t.power;sun.position.set(period==='sunset'?-40:-25,period==='sunset'?10:-30,period==='sunset'?20:45);if(renderer)renderer.toneMappingExposure=t.exposure;document.querySelectorAll('[data-period]').forEach(b=>{if(b.tagName==='BUTTON')b.setAttribute('aria-pressed',String(b.dataset.period===period));});schedule();}
function draw(){
 if(!ready||disposed)return;
 pose=journey.at(time);coast.update(time,period,pose);distance=pose.s;follow3D(coast.routes[pose.route],pose.s);const status=document.querySelector('#journey-status');const label=coast.turnouts.state.some(s=>s.moving)?pose.label.replace('停車換向','道岔轉向'):pose.label;if(status.textContent!==label)status.textContent=label;
 train.lighting.update(period,pose.sign);
 const rect=canvas.getBoundingClientRect(),aspect=rect.width/Math.max(1,rect.height);
 if(view==='train'){target.set(0,0,0);for(const c of train.cars)target.add(c.car.position);target.multiplyScalar(1/train.cars.length);target.z+=1.4;}else target.set(0,0,6.5);
 focus.copy(target).add(pan);
 span=(view==='train'?Math.max(9,train.length*.65/aspect):Math.max(29,43/aspect))/zoom;
 Object.assign(camera,{left:-span*aspect,right:span*aspect,top:span,bottom:-span});camera.position.set(focus.x+100*Math.cos(elevation)*Math.cos(yaw),focus.y+100*Math.cos(elevation)*Math.sin(yaw),focus.z+100*Math.sin(elevation));camera.lookAt(focus);camera.updateProjectionMatrix();camera.updateMatrixWorld();
 // 跟車鏡頭遮擋淡出：一定要在 camera.position 算好「之後」才能呼叫——coast.update() 在本函式
 // 開頭就執行，那時候 camera 還在上一幀的位置，塞進 update() 裡會晚一幀。trainCenter 每幀重算，
 // 不重用 view==='train' 時的 target（target 在 view==='world' 時是固定點，不是真正車centre）。
 // car.position.z 是車廂「底部」基準（body 的 bbox.min.z 被歸零到這個高度，見 garage-model.js
 // createConsist），不是車身視覺中心——+TRAIN_HEIGHT/2 抓到車身實際中段，不然遮擋線瞄準鐵軌
 // 高度，會擦過地形邊緣而不是真正穿過車身（見 alishan.js/raycastTrain 除錯記錄）。
 trainCenter.set(0,0,0);for(const c of train.cars)trainCenter.add(c.car.position);trainCenter.multiplyScalar(1/train.cars.length);trainCenter.z+=TRAIN_HEIGHT/2;coast.updateTreeFade(camera.position,trainCenter);
 scene.updateMatrixWorld(true);renderer.render(scene,camera);draws++;
 canvas.dataset.ready='true';canvas.dataset.direction=String(pose.sign);canvas.dataset.distance=String(distance);canvas.dataset.period=period;canvas.dataset.view=view;
}
function frame(at){raf=0;if(disposed||document.hidden)return;if(last&&at-last<32){schedule();return;}const dt=last?Math.min((at-last)/1000,.08):0;last=at;if(running){time+=dt;}draw();if(running)schedule();}
function reset(){zoom=1;pan.set(0,0,0);yaw=-1.35;elevation=view==='train'?.48:.67;controls();schedule();}
function setView(next){view=next;document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));reset();}
function setZoom(z){zoom=Math.max(.7,Math.min(1.8,z));controls();schedule();}
for(const b of document.querySelectorAll('button[data-period]'))b.onclick=()=>setTheme(b.dataset.period);
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>setView(b.dataset.view);
document.querySelector('#play').onclick=()=>{running=!running;last=0;controls();schedule();};
document.querySelector('#switchback').onclick=()=>{time=journey.stages[0].travel-2;running=!reduced.matches;last=0;controls();schedule();};document.querySelector('#reset').onclick=reset;
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
function dispose(){if(disposed)return;disposed=true;ready=false;cancelAnimationFrame(raf);observer.disconnect();train?.dispose();primary?.dispose();coast?.dispose();fxKit?.dispose();treesKit?.dispose();environment?.dispose();groundGeo.dispose();groundMat.dispose();sun.shadow.map?.dispose();renderer?.dispose();}
window.addEventListener('pagehide',dispose);window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
try{
 renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();dispose();loading.hidden=false;loading.replaceChildren(document.createTextNode('畫面暫時中斷，請重新開啟場景。'));const b=document.createElement('button');b.textContent='重新開啟';b.onclick=()=>location.reload();loading.append(b);});
 const studio=new THREE.Scene();studio.background=new THREE.Color('#9dafb0');const pmrem=new THREE.PMREMGenerator(renderer);environment=pmrem.fromScene(studio,.1);scene.environment=environment.texture;pmrem.dispose();
 fxKit=await loadGarageParts(new URL('../../rail-3d/assets/garage-alishan-fx-v1/alishan-fx.json',import.meta.url));if(disposed){fxKit.dispose();throw Error('disposed');}
 treesKit=await loadGarageParts(new URL('../../rail-3d/assets/garage-alishan-trees-v1/alishan-trees.json',import.meta.url));if(disposed){treesKit.dispose();throw Error('disposed');}
 coast=createScene(fxKit,treesKit);scene.add(coast.group);primary=await loadGarageModel('dl38');if(disposed){primary.dispose();throw Error('disposed');}train=await createConsist('dl38',primary,null,{locoAtTail:true});if(disposed){train.dispose();throw Error('disposed');}scene.add(train.root);train.root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
 // 螢火蟲離地高度換算真實世界公尺數要用「車模的縮放比例」——跟 garage-model.js createConsist
 // 內部算車廂長度用的是同一條公式（1.25/primary.size.y），這裡沒有匯出那個內部變數，直接照樣重算。
 coast.fx.setTrainScale(TRAIN_HEIGHT/primary.size.y);
 journey=createJourney(coast.routes,train.length);follow3D=createTerrainFollower(train);ready=true;loading.hidden=true;setView(view);setTheme(period);controls();resize();draw();schedule();
 window.alishanPreview={
  get state(){return{ready,turnouts:coast.turnouts.state,lighting:train.lighting.state,period,view,running,pan:{x:pan.x,y:pan.y},direction:pose?.sign,distance,time,zoom,draws,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,memory:{...renderer.info.memory},poses:train.cars.map(c=>({id:c.id,x:c.car.position.x,y:c.car.position.y,z:c.car.position.z,heading:c.heading,pitch:c.pitch,offset:c.offset,length:c.length})),pose,journeyDuration:journey.total,stages:journey.stages,trainLength:train.length,fx:coast.fx.state,forest:coast.forest, bounds:train.cars.map(c=>{const b=new THREE.Box3().setFromObject(c.car),ps=[];for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const q=new THREE.Vector3(x,y,z).project(camera);ps.push([(q.x+1)*canvas.width/2,(1-q.y)*canvas.height/2]);}return{left:Math.min(...ps.map(p=>p[0])),right:Math.max(...ps.map(p=>p[0])),top:Math.min(...ps.map(p=>p[1])),bottom:Math.max(...ps.map(p=>p[1]))};})};},
  sample:(route,s)=>coast.routes[route].sample(s),
  ground:p=>coast.groundHeight(...p),surface:p=>coast.surfaceHeight(...p),
  project:p=>{const q=new THREE.Vector3(...p).project(camera);return{x:(q.x+1)*canvas.width/2,y:(1-q.y)*canvas.height/2};},
  setTime:t=>{time=t;draw();},render:draw,dispose,
  trainVisible:visible=>{train.root.visible=visible;draw();},
  // 驗收用：強制開關雲海（不受時段影響），供「跟車鏡頭下列車露出比例」的像素比對測試使用；
  // 傳 null 恢復照時段（黃昏）自動判斷。
  cloudsVisible:v=>{coast.fx.setForceClouds(v);draw();},
  // 驗收用：強制開關螢火蟲（不受時段影響），供「螢火蟲可見度」的像素比對測試使用（跟
  // cloudsVisible 同一個模式：關掉拍一張當底、開了拍一張，兩張同背景只差螢火蟲，diff 出來的
  // 亮點才乾淨，不會被燈籠/車燈之類本來就亮的東西污染）；傳 null 恢復照時段（夜晚）自動判斷。
  fireflyVisible:v=>{coast.fx.setForceFireflies(v);draw();},
  // 驗收用：螢火蟲尺寸/柔邊度解耦測試——見 alishan.js 的 setFireflyHalo/setFireflyCore 註解。
  fireflyHalo:v=>{coast.fx.setFireflyHalo(v);draw();},
  fireflyCore:v=>{coast.fx.setFireflyCore(v);draw();},
  // 驗收用：螢火蟲顏色量測——halo 關閉後核心單獨的 on/off 像素差值振幅很小（peak 總和量級
  // 個位數~十幾），ACES 色調映射對composited 畫面做非線性壓縮，訊號越小、R/G/B 三通道的相對
  // 比例被這個非線性扭曲得越嚴重（實測會把材質本來 G≫R>B 的比例量成 R≈G 甚至打平）；關掉
  // tone mapping 讓 on/off 差值回到線性可加，才量得到材質自己真正的顏色比例，不受這個非線性
  // 干擾。傳 false 關閉、true 或 null 恢復 ACES。
  setToneMapping:v=>{renderer.toneMapping=v===false?THREE.NoToneMapping:THREE.ACESFilmicToneMapping;draw();},
  // 驗收用：跟車鏡頭遮擋——從目前相機位置對「目前列車中心」做一次 raycast，回傳第一個「未淡出
  // 到看穿」的命中是什麼（train/tree/other/none）。opacity<0.6 的樹視為淡出到看穿，略過看下一個
  // 命中，呼應淡出的視覺意圖（不是機械式「第一個命中什麼就算什麼」）。「是不是列車」用祖先鏈
  // 判斷是不是 train.root 的子孫——train.root 底下只有車身/連結器/集電弓，不需要逐一枚舉標記
  // （枚舉法漏標過連結器 THREE.Mesh，被誤判成 other，才改用這個更穩的判法）。
  raycastTrain:()=>{
   const camPos=camera.position.clone(),tc=new THREE.Vector3();for(const c of train.cars)tc.add(c.car.position);tc.multiplyScalar(1/train.cars.length);tc.z+=TRAIN_HEIGHT/2;// 見 draw() 內 trainCenter 註解：瞄準車身中段，不是底部基準
   const dir=tc.clone().sub(camPos),dist=dir.length();if(dist<1e-5)return{type:'none',dist:0};
   dir.multiplyScalar(1/dist);
   const rc=new THREE.Raycaster(camPos,dir,0,dist+.05);rc.camera=camera;// Sprite.raycast() 要求設定，否則螢火蟲會炸 matrixWorld null
   const hits=rc.intersectObjects(scene.children,true);
   const isTrainPart=o=>{for(let p=o;p;p=p.parent)if(p===train.root)return true;return false;};
   // debugHits：驗收判準紅了要能回答「打到什麼」，不只是「不是列車」——限前 6 個候選，
   // 含淡出前的原始 opacity（供人工複核淡出邏輯是否合理，不是只看最終結論）。
   const debugHits=hits.slice(0,6).map(h=>{const o=h.object,op=(o.isInstancedMesh&&o.geometry.attributes.instanceOpacity&&h.instanceId!=null)?o.geometry.attributes.instanceOpacity.array[h.instanceId]:null;return{name:o.name||o.type,parent:o.parent?.name||o.parent?.type||null,isTrain:isTrainPart(o),isTree:!!o.userData?.isTree,dist:h.distance,opacity:op};});
   for(const h of hits){
    const obj=h.object;
    if(obj.isInstancedMesh&&obj.geometry.attributes.instanceOpacity&&h.instanceId!=null){
     const op=obj.geometry.attributes.instanceOpacity.array[h.instanceId];
     if(op<0.6)continue;
     if(obj.userData?.isTree)return{type:'tree',dist:h.distance,opacity:op,debugHits};
    }
    if(isTrainPart(obj))return{type:'train',dist:h.distance,debugHits};
    return{type:'other',name:obj.name||obj.type,parent:obj.parent?.name||obj.parent?.type||null,dist:h.distance,debugHits};
   }
   return{type:'none',dist,debugHits};
  }
 };
}catch(e){if(!disposed){dispose();loading.hidden=false;loading.textContent='小車暫時無法載入。';const b=document.createElement('button');b.textContent='重新載入';b.onclick=()=>location.reload();loading.append(b);}console.error(e);}
