// 光華街涵洞場景的可掛載視圖（粗模）：寫法照 viaduct-view.js／south-coast-view.js，控制鈕與 handle 介面相同，外框頁（garage-scene.js 的 SCENE_MODULES）與原型頁共用這一份。
// mountGuanghua(root,{car,period,t,params}) 掛進一個含 canvas#scene 與控制鈕的容器，回傳 handle；dispose() 釋放 WebGL、監聽與觀察器，可重複呼叫。
// 列車怎麼跑照 crossing.js／prototypes/garage-new-scenes/main.js：直線環線、整列離景（x 超過 ±CLIP）後才循環，車身被兩個裁切面在 ±CLIP 切掉；涵洞橋那段是直線，車從上面過。
// params.opposing＝true 時另一股軌道再跑一班對向車（預設不開，粗模先省 draw call）。
import * as THREE from '../vendor/three.module.js';
import {createScene,THEMES,LAP,SPEED,CLIP,PHASE,METER,UNIT_PER_M} from './guanghua.js?revision=guanghua-scooter-0930';
import {loadScooterKit} from '../garage-scooter.js?revision=guanghua-scooter-0930';
import {loadGarageModel,createConsist,loadGarageParts} from '../garage-model.js?revision=doors-0924';
import {createTerrainFollower} from './consist-3d.js';
const OPPOSE_DELAY=26; // 對向車晚 OPPOSE_DELAY 秒（本輪自訂）；PHASE（時間 0 時本線車中心在 x＝-10，快到涵洞上方，開頁就看得到主題）改由 guanghua.js 匯出，機車時刻表共用同一個常數
const distanceAt=t=>(((t*SPEED+PHASE+LAP/2)%LAP)+LAP)%LAP-LAP/2;
// 三個視角的預設鏡頭：world 全景（正前方略偏右、抬高看，洞口正對鏡頭）、train 跟車、culvert 洞口低角度平視（鏡頭在巷子這一側，朝 +y 看洞口）。
// 第二輪（主對話判讀）：world 由 yaw -1.2／elevation .62 轉成 -1.4／.42，鏡頭幾乎正對路堤正面；取景由半高 25 縮到約 11（半寬約 21.5，洞口與擋土牆才看得清楚；底座同輪縮成 54 寬，縮小到 .7 倍就整塊放得進去），洞口與擋土牆才看得到；數值皆本輪自訂。
// 【照片比對，2026-09-30】使用者原話（12:15）：「我的預期是 我們應該能把角度轉到網路上大家拍攝的照片角度 然後要看起來相同」；選項回覆：照片角度放在「看涵洞」（選項文字是主對話寫的）。
// 以下是主對話依使用者 09-30 貼的兩張照片估計：機位在巷子中線、人眼高 1.5 m、正對洞口；兩張都像手機望遠端，水平視角約 24°；遠的那張離洞口約 30 m、近的那張約 10 m。
// 所以 culvert 視角改用透視鏡頭（遠處變小、洞內兩側牆看得到），其他視角照舊是正交的微縮俯視。這個視角裡：
//   ・鏡頭繞著洞口面上 aim 公尺高的那一點轉；elevation 是「在人眼高度之上再抬多少」（0＝人眼高），yaw 照舊。
//   ・「＋／−」與滾輪是前後移動：離洞口 d／zoom^power 公尺（zoom .7～1.8 ⇒ 約 31～10 m）。
// 【r6】看涵洞的預設改成照片 A（橫幅那張）的機位：使用者 09-30 15:25「預設可以改照片Ａ」。
//   以下是主對話判讀：數值用照片地標（洞口上緣兩角、斜紋頂、護欄頂、消失點、左紅線、車頂）擬合而來＝站在左紅線上方（x≈-1.4 m）、
//   離洞口約 24 m、眼高離外側地面約 1.2 m、朝右偏 1°、仰約 4°。zoom／pan 的換算在桌面 照片比對/工具/fit_camera.mjs。
const CAMERA={world:{yaw:-1.4,elevation:.42},train:{yaw:-1.32,elevation:.4},culvert:{yaw:-1.5908,elevation:-.0117,zoom:.8589,pan:[-.3745,0,-.0408]}};
const PHOTO={hfov:24,d:20,power:1.25,eye:1.5,aim:3.7};
// 【r6】照片角度白天的太陽改在鏡頭正後方偏左一點（主對話判讀：兩張照片都是順光，洞口兩側的鏽色橋台整面受光；原本的太陽從左前方來，左翼牆的影子會把左橋台整面蓋暗）。其他視角與夕陽、夜晚照舊。
const SUN={day:[-25,-30,45],sunset:[-40,10,20],night:[-25,-30,45]},PHOTO_SUN=[-3,-39,45];
const sunAt=(view,period)=>view==='culvert'&&period==='day'?PHOTO_SUN:SUN[period];
const MIN_ELEVATION=.08,MAX_ELEVATION=1.2,elevationRange=v=>v==='culvert'?[-.12,1]:[MIN_ELEVATION,MAX_ELEVATION];
// 照片角度的天空（主對話判讀：這個視角畫面上半是天空，照片裡是藍天；其他視角照舊用主題的平塗底色）。
const SKY={day:['#7fa7d2','#a9c2d4','#7e8b86'], // r6：白天下半段壓暗（這張貼圖只在照片角度當畫面背景，下半段只會從洞口看出去時露出來；照片裡洞口是一個暗洞，主對話判讀）
 sunset:['#9d93a8','#e6b99a','#f1d6bc'],night:['#070d18','#101b2c','#25324a']};
function skyTexture(stops){const c=document.createElement('canvas');c.width=2;c.height=256;const g=c.getContext('2d'),gr=g.createLinearGradient(0,0,0,256);gr.addColorStop(0,stops[0]);gr.addColorStop(.55,stops[1]);gr.addColorStop(1,stops[2]);g.fillStyle=gr;g.fillRect(0,0,2,256);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;}

export function mountGuanghua(root,{car='emu3000',period:initialPeriod,t=s=>s,params={}}={}){
const q=s=>root.querySelector(s),qa=s=>root.querySelectorAll(s);
const canvas=q('#scene'),loading=q('#loading');
const themeEl=root.nodeType===9?root.body:root;
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
// 登記所有自己加的監聽，dispose 時一次拆掉。
const offs=[];
function on(target,type,fn,opts){target.addEventListener(type,fn,opts);offs.push(()=>target.removeEventListener(type,fn,opts));}
let renderer,environment,primary,train,opposing,follower,opposingFollower,place,kits=null,trainShown=true,raf=0,last=0,time=0,distance=0,period=THEMES[initialPeriod]?initialPeriod:'day',view=matchMedia('(max-width:800px)').matches?'train':'world',running=!reduced.matches,zoom=1,span=1,yaw=CAMERA[view].yaw,elevation=CAMERA[view].elevation,disposed=false,ready=false,suspended=false,draws=0;
const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-40,40,30,-30,.1,400);camera.up.set(0,0,1);
const photoCamera=new THREE.PerspectiveCamera(30,1,.05,400);photoCamera.up.set(0,0,1);
let active=camera,plainSky=new THREE.Color('#e7e8e1');const skies={};
const focus=new THREE.Vector3(),pan=new THREE.Vector3(),target=new THREE.Vector3(),sun=new THREE.DirectionalLight('#fff1cf',3.2),hemi=new THREE.HemisphereLight('#c1dce7','#7b8663',2.1);
sun.position.set(-25,-30,45);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-42,right:42,top:35,bottom:-35,near:1,far:140});sun.shadow.normalBias=.035;sun.shadow.bias=-.0001;scene.add(sun,hemi,sun.target);
const groundGeo=new THREE.PlaneGeometry(2000,2000),groundMat=new THREE.ShadowMaterial({opacity:.12}),ground=new THREE.Mesh(groundGeo,groundMat);ground.position.z=-2.5;ground.receiveShadow=true;scene.add(ground);
const clips=[new THREE.Plane(new THREE.Vector3(1,0,0),CLIP),new THREE.Plane(new THREE.Vector3(-1,0,0),CLIP)],carPoint=new THREE.Vector3(),probe=new THREE.Raycaster();
function controls(){const p=q('#play');if(p){p.textContent=running?'Ⅱ':'▷';p.setAttribute('aria-label',t(running?'暫停行駛':'開始行駛'));p.setAttribute('aria-pressed',String(running));}const i=q('#in'),o=q('#out');if(i)i.disabled=zoom>=1.8;if(o)o.disabled=zoom<=.7;}
function schedule(){if(!raf&&!disposed&&!suspended&&!document.hidden&&ready)raf=requestAnimationFrame(frame);}
function resize(){if(!renderer||disposed)return;const r=canvas.getBoundingClientRect();renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.setSize(Math.max(1,r.width),Math.max(1,r.height),false);schedule();}
function setTheme(next){period=next;const th=THEMES[period];themeEl.dataset.period=period;plainSky=new THREE.Color(th.background);scene.background=plainSky;hemi.color.set(th.ambient);hemi.groundColor.set(th.ground);hemi.intensity=period==='night'?1.2:2;sun.color.set(th.sun);sun.intensity=th.power;sun.position.set(...sunAt(view,period));if(renderer)renderer.toneMappingExposure=th.exposure;qa('[data-period]').forEach(b=>{if(b.tagName==='BUTTON')b.setAttribute('aria-pressed',String(b.dataset.period===period));});schedule();}
// 一班車：依路徑擺好、更新集電弓與燈光、離景就隱藏（連頭燈精靈與聚光燈一起，它們不受裁切面管）。
function drawTrain(consist,follow,path,d){
 follow(path,d);consist.updateParts?.();consist.lighting.update(period,1);
 consist.root.visible=trainShown&&Math.abs(d)<CLIP+3+consist.length/2+.8;consist.root.updateMatrixWorld(true);
 consist.root.traverse(o=>{if(o.isSprite||o.isSpotLight){const p=new THREE.Vector3();o.getWorldPosition(p);o.visible=Math.abs(p.x)<CLIP;}});
}
function carPositions(){const out=[];for(const c of [train,opposing])if(c&&c.root.visible)for(const car of c.cars)out.push(car.car.getWorldPosition(carPoint).toArray());return out;}
function draw(){
 if(!ready||disposed)return;
 distance=distanceAt(time);
 drawTrain(train,follower,place.path,distance);if(opposing)drawTrain(opposing,opposingFollower,place.opposingPath,distanceAt(time-OPPOSE_DELAY));
 place.update(time,period,{cars:carPositions(),scale:UNIT_PER_M[car]??METER});
 const rect=canvas.getBoundingClientRect(),aspect=rect.width/Math.max(1,rect.height);
 sun.position.set(...sunAt(view,period));
 if(view==='culvert'){ // 照片角度（透視）：見檔頭 PHOTO 的說明
  const d=place.dims,dist=METER*PHOTO.d/Math.pow(zoom,PHOTO.power),asin=v=>Math.asin(THREE.MathUtils.clamp(v,-1,1));
  target.set(0,-d.mouthY,METER*PHOTO.aim);focus.copy(target).add(pan);
  const el=Math.max(asin((d.ZG+METER*PHOTO.eye-focus.z)/dist)+elevation,asin((d.ZG+METER*.3-focus.z)/dist)); // 鏡頭不低於外側地面 .3 m
  photoCamera.aspect=aspect;photoCamera.fov=2*Math.atan(Math.tan(PHOTO.hfov*Math.PI/360)/aspect)*180/Math.PI;
  photoCamera.position.set(focus.x+dist*Math.cos(el)*Math.cos(yaw),focus.y+dist*Math.cos(el)*Math.sin(yaw),focus.z+dist*Math.sin(el));photoCamera.lookAt(focus);photoCamera.updateProjectionMatrix();photoCamera.updateMatrixWorld();
  span=dist*Math.tan(photoCamera.fov*Math.PI/360);active=photoCamera;scene.background=skies[period]??=skyTexture(SKY[period]);
 }else{
  if(view==='train'){const p=place.path.sample(THREE.MathUtils.clamp(distance,-19,19));target.set(p.x,p.y,p.z+.9);}
  else target.set(...place.focus);
  focus.copy(target).add(pan);
  span=(view==='train'?Math.max(8,train.length*.7/aspect):Math.max(10.5,21.5/aspect))/zoom;
  Object.assign(camera,{left:-span*aspect,right:span*aspect,top:span,bottom:-span});camera.position.set(focus.x+100*Math.cos(elevation)*Math.cos(yaw),focus.y+100*Math.cos(elevation)*Math.sin(yaw),focus.z+100*Math.sin(elevation));camera.lookAt(focus);camera.updateProjectionMatrix();camera.updateMatrixWorld();
  active=camera;scene.background=plainSky;
 }
 scene.updateMatrixWorld(true);renderer.render(scene,active);draws++;
 canvas.dataset.ready='true';canvas.dataset.distance=String(distance);canvas.dataset.period=period;canvas.dataset.view=view;
}
function frame(at){raf=0;if(disposed||suspended||document.hidden)return;if(last&&at-last<32){schedule();return;}const dt=last?Math.min((at-last)/1000,.08):0;last=at;if(running)time+=dt;draw();if(running)schedule();}
function reset(){const c=CAMERA[view];zoom=c.zoom??1;pan.set(...(c.pan??[0,0,0]));yaw=c.yaw;elevation=c.elevation;controls();schedule();}
function setView(next){view=next;qa('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));const look=q('#culvert');if(look?.hasAttribute('aria-pressed'))look.setAttribute('aria-pressed',String(view==='culvert'));reset();}
function setZoom(z){zoom=Math.max(.7,Math.min(1.8,z));controls();schedule();}
// 看涵洞：把時間快轉到「機車經過洞口內側、本線車正在洞上」的下一次（時刻表綁列車圈時鐘，機車過洞中心＝車心過 x＝0，見 guanghua.js）；沒有機車資產時退回本線車中心在 x＝-6 的下一次。鏡頭切洞口低角度並開始播放（減少動態時不自動播放）。
// 照片比對輪再微調一步：把時間挪到「最靠近洞口的那節車廂中心正好在 x＝0」（主對話判讀：照片裡洞口上方是一整節車身；車廂數是偶數時列車中心是兩節之間的車鉤）。最多挪半節車（約 1.6 秒），機車仍在洞內或引道上。
function lookTime(now){
 let at;if(place?.scooter)at=place.scooter.run.lookTime(now);else{const a=-6-PHASE,n=Math.ceil((now*SPEED-a)/LAP);at=(a+n*LAP)/SPEED;}
 const d=distanceAt(at);let near=null;for(const c of train?.cars??[]){const x=d+c.offset;if(near===null||Math.abs(x)<Math.abs(near))near=x;}
 return near===null?at:at-near/SPEED;
}
for(const b of qa('button[data-period]'))on(b,'click',()=>setTheme(b.dataset.period));
for(const b of qa('[data-view]'))on(b,'click',()=>setView(b.dataset.view));
function bind(sel,fn){const el=q(sel);if(el)on(el,'click',fn);}
bind('#play',()=>{running=!running;last=0;controls();schedule();});
bind('#culvert',()=>{if(!ready)return;time=lookTime(time);last=0;if(!reduced.matches)running=true;setView('culvert');draw();});
bind('#reset',reset);
bind('#in',()=>setZoom(zoom*1.2));bind('#out',()=>setZoom(zoom/1.2));
// 平移：滑鼠右鍵／中鍵／Shift＋拖曳、觸控雙指拖曳、Shift＋方向鍵。偏移量存在 pan（世界座標、沿地面），重設視角歸零。
function panBy(dx,dy){const u=2*span/Math.max(1,canvas.getBoundingClientRect().height),g=view==='culvert'?u:u/Math.sin(Math.max(.2,elevation));pan.x=Math.max(-40,Math.min(40,pan.x+Math.sin(yaw)*dx*u-Math.cos(yaw)*dy*g));pan.y=Math.max(-40,Math.min(40,pan.y-Math.cos(yaw)*dx*u-Math.sin(yaw)*dy*g));schedule();}
const pointers=new Map();let gesture;
on(canvas,'contextmenu',e=>e.preventDefault());
on(canvas,'pointerdown',e=>{canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,pan:e.button===1||e.button===2||e.shiftKey});gesture=null;});
on(canvas,'pointermove',e=>{if(!pointers.has(e.pointerId))return;const old=pointers.get(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,pan:old.pan});if(pointers.size===1){if(old.pan||e.shiftKey)panBy(e.clientX-old.x,e.clientY-old.y);else{const [lo,hi]=elevationRange(view);yaw+=(e.clientX-old.x)*.007;elevation=Math.max(lo,Math.min(hi,elevation+(old.y-e.clientY)*.005));schedule();}}else{const [a,b]=[...pointers.values()],gap=Math.hypot(a.x-b.x,a.y-b.y),mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};if(gesture){setZoom(gesture.zoom*gap/gesture.gap);panBy(mid.x-gesture.mid.x,mid.y-gesture.mid.y);gesture.mid=mid;}else gesture={zoom,gap:Math.max(1,gap),mid};}});
const pointerEnd=e=>{pointers.delete(e.pointerId);gesture=null;};
for(const type of ['pointerup','pointercancel','lostpointercapture'])on(canvas,type,pointerEnd);
on(canvas,'wheel',e=>{e.preventDefault();setZoom(zoom*Math.exp(-Math.max(-150,Math.min(150,e.deltaY))*.002));},{passive:false});
on(canvas,'keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','0',' '].includes(e.key))return;e.preventDefault();if(e.key===' ')q('#play')?.click();else if(e.key==='0')reset();else if(e.key==='+')setZoom(zoom*1.2);else if(e.key==='-')setZoom(zoom/1.2);else if(e.shiftKey)panBy(e.key==='ArrowLeft'?40:e.key==='ArrowRight'?-40:0,e.key==='ArrowUp'?40:e.key==='ArrowDown'?-40:0);else{if(e.key==='ArrowLeft')yaw-=.15;if(e.key==='ArrowRight')yaw+=.15;const [lo,hi]=elevationRange(view);if(e.key==='ArrowUp')elevation=Math.min(hi,elevation+.1);if(e.key==='ArrowDown')elevation=Math.max(lo,elevation-.1);schedule();}});
const observer=new ResizeObserver(resize);observer.observe(canvas);
on(document,'visibilitychange',()=>{last=0;if(document.hidden){cancelAnimationFrame(raf);raf=0;}else schedule();});
on(reduced,'change',()=>{if(reduced.matches){running=false;controls();schedule();}});
on(window,'pagehide',dispose);
function disposeMaterial(m){for(const v of Object.values(m))if(v&&v.isTexture)v.dispose();m.dispose();}
function release(){
 kits?.forEach(k=>k.dispose());train?.dispose();opposing?.dispose();primary?.dispose();place?.dispose();environment?.dispose();groundGeo.dispose();groundMat.dispose();sun.shadow.map?.dispose();
 // 保底：場景裡走過的每個 mesh 都再清一次（各模組的 dispose 沒涵蓋到的漏網之魚；重複 dispose 無害）。
 scene.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)for(const m of [].concat(o.material))disposeMaterial(m);if(o.isInstancedMesh)o.dispose();});
 for(const s of Object.values(skies))s.dispose();renderer?.dispose();if(renderer&&!renderer.getContext().isContextLost())renderer.forceContextLoss(); // 載入途中被 dispose 時 release() 會被叫第二次；WebKit 對已掉的 context 再 loseContext 會噴 console error
}
function dispose(){
 if(disposed)return;disposed=true;ready=false;cancelAnimationFrame(raf);raf=0;
 for(const off of offs.splice(0))off();
 observer.disconnect();
 release();
 // 掉了的 WebGL context 不能在同一個 canvas 上重建；換一張乾淨的，才能在同一個容器再掛載一次。
 if(canvas?.isConnected){const fresh=canvas.cloneNode(false);for(const a of [...fresh.attributes])if(a.name.startsWith('data-'))fresh.removeAttribute(a.name);canvas.replaceWith(fresh);}
}
function showFailure(message,buttonText,onClick){if(!loading)return;loading.hidden=false;loading.replaceChildren(document.createTextNode(message));const b=document.createElement('button');b.textContent=buttonText;b.onclick=onClick;loading.append(b);}
const memory=()=>renderer?{geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,programs:renderer.info.programs?.length??0}:null;
// 【r6 照片比對】車底深色設備帶：只在這個景加、不動共用車模。使用者 09-30 貼的兩張照片裡，車底是一整條深色設備（儲氣筒、箱體），車輪大半看不到；
// 共用車模是玩具比例、車底是空的，從照片角度會整圈露出輪子、還從轉向架之間透出天空（評審 r5 第 4 項）。以下做法與數字是主對話判讀：
// 只加在電聯車、自強號、客車這三類（manifest 的 family 是 railcar／express／coach；機車頭、蒸機、林鐵的輪子是主角，不遮）。
// 每節一塊深色方塊：長 90％、寬 97％，上緣貼車底（從車底下往上打射線量到的最低點），下緣在車底離軌頂高度的 35％，車輪最多露出下緣約三分之一。
const SKIRTED=new Set(['railcar','express','coach']);
async function familyOf(id){try{const r=await fetch(new URL('../assets/blender-map-v1/manifest.json',import.meta.url));return (await r.json()).models?.[id]?.family??null;}catch{return null;}}
function addSkirts(c){
 const ray=new THREE.Raycaster(),o=new THREE.Vector3(),up=new THREE.Vector3(0,0,1),mat=new THREE.MeshStandardMaterial({color:'#24262a',roughness:.9,clippingPlanes:clips,clipShadows:true});mat.name='guanghua-skirt';
 c.root.updateMatrixWorld(true);
 for(const car of c.cars){const {x:L,y:W,z:H}=car.asset.size;let zu=Infinity;
  for(const fx of [-.15,0,.15])for(const fy of [-.25,0,.25]){o.set(fx*L,fy*W,.01*H);car.car.localToWorld(o);ray.set(o,up);const h=ray.intersectObject(car.body,false)[0];if(h)zu=Math.min(zu,car.car.worldToLocal(h.point.clone()).z);}
  if(!(zu>.02*H&&zu<.6*H))continue;
  const zb=zu*.35,top=zu+.02*H,m=new THREE.Mesh(new THREE.BoxGeometry(L*.9,W*.97,top-zb),mat);m.position.set(0,0,(zb+top)/2);m.name='guanghua-skirt';m.castShadow=m.receiveShadow=true;car.car.add(m);}
}
function clipConsist(c){
 for(const car of c.cars){for(const m of [].concat(car.body.material)){m.clippingPlanes=clips;m.clipShadows=true;m.needsUpdate=true;}
  car.body.traverse(o=>{if(o.isMesh&&o!==car.body){o.material.clippingPlanes=clips;o.material.clipShadows=true;o.material.needsUpdate=true;}}); // 集電弓掛在車身底下，一起被裁
 }
 for(const o of c.root.children)if(o.isMesh){o.material.clippingPlanes=clips;o.material.clipShadows=true;o.material.needsUpdate=true;} // 車鉤
}
const preview={};
const handle={
 get state(){return ready?preview.state:{ready:false,disposed,period,view,running,paused:suspended};},
 preview,memory,
 pause(){if(suspended)return;suspended=true;cancelAnimationFrame(raf);raf=0;},
 resume(){if(!suspended)return;suspended=false;last=0;schedule();},
 dispose,
 ready:null
};
handle.ready=(async()=>{
try{
 if(loading)loading.hidden=false;
 renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});renderer.localClippingEnabled=true;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 on(canvas,'webglcontextlost',e=>{e.preventDefault();const parent=loading;dispose();if(parent)showFailure(t('畫面暫時中斷，請重新開啟場景。'),t('重新開啟'),()=>location.reload());});
 const studio=new THREE.Scene();studio.background=new THREE.Color('#9dafb0');const pmrem=new THREE.PMREMGenerator(renderer);environment=pmrem.fromScene(studio,.1);scene.environment=environment.texture;pmrem.dispose();
 kits=await Promise.all([...['garage-people-v1/people','garage-camera-v1/camera'].map(n=>loadGarageParts(new URL(`../assets/${n}.json`,import.meta.url))),loadScooterKit()]);if(disposed)throw Error('disposed'); // [人零件庫, 相機, 機車]：機車的騎士沿用同一份人零件庫
 place=createScene(kits);scene.add(place.group);
 primary=await loadGarageModel(car);if(disposed)throw Error('disposed');
 train=await createConsist(car,primary);if(disposed)throw Error('disposed');
 if(params.opposing){opposing=await createConsist(car,primary);if(disposed)throw Error('disposed');}
 if(SKIRTED.has(await familyOf(car))){if(disposed)throw Error('disposed');for(const c of [train,opposing].filter(Boolean))addSkirts(c);}
 for(const c of [train,opposing].filter(Boolean)){clipConsist(c);c.setContactWire?.(place.contactWireZ);c.root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});scene.add(c.root);}
 follower=createTerrainFollower(train);if(opposing)opposingFollower=createTerrainFollower(opposing);
 ready=true;if(loading)loading.hidden=true;setView(view);setTheme(period);controls();resize();draw();schedule();
 // 不能用 Object.assign：它會把 state getter 當場取值，之後永遠是那一刻的快照。
 Object.defineProperties(preview,Object.getOwnPropertyDescriptors({
  get state(){return{ready,period,view,running,paused:suspended,pan:{x:pan.x,y:pan.y},time,distance,speed:SPEED,lap:LAP,zoom,yaw,elevation,draws,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,memory:{...renderer.info.memory},
   trainLength:train.length,trainVisible:train.root.visible,opposing:!!opposing,scale:UNIT_PER_M[car]??METER,scene:place.state,dims:place.dims,
   poses:train.cars.map(c=>({id:c.id,x:c.car.position.x,y:c.car.position.y,z:c.car.position.z,heading:c.heading,pitch:c.pitch,offset:c.offset,length:c.length})),
   bounds:train.cars.map(c=>{const b=new THREE.Box3().setFromObject(c.car),ps=[];for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const p=new THREE.Vector3(x,y,z).project(active);ps.push([(p.x+1)*canvas.width/2,(1-p.y)*canvas.height/2]);}return{left:Math.min(...ps.map(p=>p[0])),right:Math.max(...ps.map(p=>p[0])),top:Math.min(...ps.map(p=>p[1])),bottom:Math.max(...ps.map(p=>p[1]))};})};},
  sample:(s,which='main')=>(which==='opposing'?place.opposingPath:place.path).sample(s),
  project:p=>{const v=new THREE.Vector3(...p).project(active);return{x:(v.x+1)*canvas.width/2,y:(1-v.y)*canvas.height/2};},
  setTime:v=>{time=v;draw();},render:draw,dispose,
  // 把本線車的中心放到 x＝d（時間跟著換；每圈的同一位置取本圈第一次）。
  setDistance:d=>{const n=Math.ceil((time*SPEED-(d-PHASE))/LAP);time=((d-PHASE)+n*LAP)/SPEED;draw();return time;},
  lookTime:()=>lookTime(time),
  setCamera:({view:v,yaw:y,elevation:e,zoom:z,pan:pn}={})=>{if(v)setView(v);if(y!==undefined)yaw=y;if(e!==undefined)elevation=e;if(z!==undefined)setZoom(z);if(pn)pan.set(pn[0]??0,pn[1]??0,pn[2]??0);draw();},
  trainVisible:v=>{trainShown=v;draw();},sceneVisible:v=>{place.group.visible=ground.visible=v;draw();},
  people:()=>place.inspect(),
  // 從 origin 朝 dir 射線，回傳打到的東西（近→遠）：驗收量淨高、淨寬、橋面厚度用，量的是實際畫出來的網格。
  ray:(origin,dir,{withTrain=false}={})=>{scene.updateMatrixWorld(true);probe.set(new THREE.Vector3(...origin),new THREE.Vector3(...dir).normalize());probe.camera=active;const objs=withTrain?[place.group,train.root]:[place.group];
   return probe.intersectObjects(objs,true).map(h=>({distance:h.distance,point:h.point.toArray(),material:[].concat(h.object.material)[0]?.name||'',object:h.object.name||h.object.type,instanced:!!h.object.isInstancedMesh}));},
  // 車身（不含集電弓）在世界座標的包圍盒，每節一個。
  carBoxes:(which='main')=>{const c=which==='opposing'?opposing:train;if(!c)return[];scene.updateMatrixWorld(true);return c.cars.map(car=>{car.body.updateWorldMatrix(true,false);const b=car.body.geometry.boundingBox.clone().applyMatrix4(car.body.matrixWorld);return{id:car.id,min:b.min.toArray(),max:b.max.toArray()};});},
  // 給驗收腳本直接讀場景與列車（量結構、量網格）：THREE 用同一份模組實例。
  internals:()=>({THREE,scene,group:place.group,train,opposing,get camera(){return active;},orthoCamera:camera,photoCamera,renderer,place,primary,clips}),
  pantographs:()=>[train,opposing].filter(Boolean).flatMap((c,i)=>(c.pantographState?.()??[]).map(h=>({...h,train:i?'opposing':'main'})))
 }));
 return true;
}catch(e){
 if(!disposed){dispose();showFailure(t('小車暫時無法載入。'),t('重新載入'),()=>location.reload());console.error(e);}
 else release(); // 載入途中被 dispose：後到的資源在這裡補清
 return false;
}
})();
return handle;
}
