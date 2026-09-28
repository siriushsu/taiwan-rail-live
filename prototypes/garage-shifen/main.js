import * as THREE from '../../rail-3d/vendor/three.module.js';
import {createScene,THEMES,createSkyLanterns,createVegetation,createVisitors} from '../../rail-3d/garage-scenes/shifen.js?revision=shifen-polish-20260928';
import {loadGarageModel,createConsist,loadGarageParts} from '../../rail-3d/garage-model.js?revision=headlights-0912';
import {createTerrainFollower} from '../../rail-3d/garage-scenes/consist-3d.js';
import {createStopTimetable} from '../../rail-3d/garage-scenes/stop-timetable.js?revision=stop-0927';
const canvas=document.querySelector('#scene'),loading=document.querySelector('#loading');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const SPEED=1.7; // 巡航時每秒沿路徑前進的弧長；位置一律由停站時刻表從時間求出（setTime／setDistance 與逐幀播放同一條路，跟南迴同一個模式）。
const STATION_OFFSET=13.2; // path 的 s=0 落在老街中段（x=0）；十分站月台中心在 x=13.2（前直線上 x===s），停站永遠停在 s≡0，這裡把它搬到月台中心。
let tt,stop,lanterns=null,vegetation=null,visitors=null,follow3D,renderer,environment,primary,train,shifen,raf=0,last=0,time=0,distance=0,period='day',view=matchMedia('(max-width:800px)').matches?'train':'world',running=!reduced.matches,zoom=1,span=1,yaw=-1.12,elevation=.58,disposed=false,ready=false,draws=0;
// 「看老街」的預設鏡頭角度：沿老街軸線（老街與軌道都沿世界 x 軸）從西端斜看向車站，仰角壓低到
// ≤25°（09-28 評審：舊版是仰角 1.15 rad≈66° 的俯視，只看到站房屋頂）。yaw 的偏移方向要同時滿足
// 兩件事——(a) offset.x<0（鏡頭在西側、看向 +x／車站方向，才是「沿軸看」不是「橫看」）；
// (b) offset.y<0（鏡頭偏南／月台這一側，遠排 2 樓街屋的正面法向量朝 -y，要從南側才看得到正面；
// 近排 1 樓矮店面法向量朝 +y、原本就是設計成「背面也開窗」給這個角度看背面，見 shifen.js 的
// townhouse(...,back:true) 那行）。PLATFORM_YAW=-2.7 rad（≈-155°）：cos>0 分量小、以近似
// 沿軸為主，sin 分量夠看到遠排店面正面又不致跌回舊版「橫看」被雨棚整片擋住車身的問題。
const PLATFORM_YAW=-2.7,PLATFORM_ELEVATION=.35;
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
 shifen.update(time,period);follow3D(shifen.path,distance+STATION_OFFSET);
 train.lighting.update(period,1);lanterns?.update(time,period);vegetation?.update?.(time,period);visitors?.update?.(time,distance,shifen.path,train);
 const rect=canvas.getBoundingClientRect(),aspect=rect.width/Math.max(1,rect.height);
 // 看老街：09-28 評審換掉舊版仰角 1.15 rad 的月台俯視（那個角度＋原本的站區目標點会被月台雨棚整片
 // 蓋住，見已刪除的舊註解／git 歷史）。新版改成沿老街走廊的低角度（PLATFORM_ELEVATION=.35
 // rad≈20°，在評審要求的 ≤25° 之內），目標點也從站區搬到老街中段（不再對著雨棚），這樣雨棚只會
 // 出現在畫面邊緣、不會擋住老街本身。span 加大到能同時涵蓋老街兩排店面＋軌道人群＋站區。
 // 跟車視角 09-28 起不再依站區階段（減速／停站／加速）自動拉高仰角到 1.22——同一次評審要求「停站時
 // 的跟車鏡頭也不要自動拉到 1.22」，固定用跟巡航時同一個仰角（.5，由 reset() 設定），使用者仍可
 // 手動拖曳調整。
 if(view==='train'){target.set(0,0,0);for(const c of train.cars)target.add(c.car.position);target.multiplyScalar(1/train.cars.length);target.z+=1.4;}
 else if(view==='platform')target.set(-2,-6.5,1.3);
 else target.set(0,1.0,1.2);
 focus.copy(target).add(pan);
 span=(view==='train'?Math.max(9,train.length*.65/aspect):view==='platform'?Math.max(7.5,11/aspect):Math.max(24,35/aspect))/zoom;
 Object.assign(camera,{left:-span*aspect,right:span*aspect,top:span,bottom:-span});camera.position.set(focus.x+100*Math.cos(elevation)*Math.cos(yaw),focus.y+100*Math.cos(elevation)*Math.sin(yaw),focus.z+100*Math.sin(elevation));camera.lookAt(focus);camera.updateProjectionMatrix();camera.updateMatrixWorld();scene.updateMatrixWorld(true);renderer.render(scene,camera);draws++;
 canvas.dataset.ready='true';canvas.dataset.distance=String(distance);canvas.dataset.period=period;canvas.dataset.view=view;
}
function frame(at){raf=0;if(disposed||document.hidden)return;if(last&&at-last<32){schedule();return;}const dt=last?Math.min((at-last)/1000,.08):0;last=at;if(running)time+=dt;draw();if(running)schedule();}
function reset(){zoom=1;pan.set(0,0,0);yaw=view==='platform'?PLATFORM_YAW:-1.12;elevation=view==='platform'?PLATFORM_ELEVATION:view==='train'?.5:.58;controls();schedule();}   // 平地老街的跟車鏡頭抬高一點（.42→.5），近排店屋的屋頂才不會蓋掉車身下半；看老街 09-28 改成沿街低角度（見 PLATFORM_YAW 說明），跟車視角不再依站區階段拉高仰角（同一次評審要求，見 draw() 的說明）
function setView(next){view=next;document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));document.querySelector('#platform')?.setAttribute('aria-pressed',String(view==='platform'));reset();}
function setZoom(z){zoom=Math.max(.7,Math.min(1.8,z));controls();schedule();}
for(const b of document.querySelectorAll('button[data-period]'))b.onclick=()=>setTheme(b.dataset.period);
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>setView(b.dataset.view);
document.querySelector('#play').onclick=()=>{running=!running;last=0;controls();schedule();};
// 看老街：正在減速或停站就只切鏡頭；否則快轉到下一次進站的減速起點（不是瞬移，照南迴「看月台」的做法：
// 快轉時間＋切到專屬的月台特寫視角，鈕的文字不變，內部行為與南迴的 #platform 一致）。
document.querySelector('#platform').onclick=()=>{time=tt.lookTime(time);last=0;if(!reduced.matches)running=true;setView('platform');if(ready)draw();};
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
function dispose(){if(disposed)return;disposed=true;ready=false;cancelAnimationFrame(raf);observer.disconnect();lanterns?.dispose();vegetation?.dispose();visitors?.dispose();train?.dispose();primary?.dispose();shifen?.dispose();environment?.dispose();groundGeo.dispose();groundMat.dispose();sun.shadow.map?.dispose();renderer?.dispose();}
window.addEventListener('pagehide',dispose);window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
try{
 renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();dispose();loading.hidden=false;loading.replaceChildren(document.createTextNode('畫面暫時中斷，請重新開啟場景。'));const b=document.createElement('button');b.textContent='重新開啟';b.onclick=()=>location.reload();loading.append(b);});
 const studio=new THREE.Scene();studio.background=new THREE.Color('#9dafb0');const pmrem=new THREE.PMREMGenerator(renderer);environment=pmrem.fromScene(studio,.1);scene.environment=environment.texture;pmrem.dispose();
 shifen=createScene();scene.add(shifen.group);tt=createStopTimetable({pathLength:shifen.path.length,speed:SPEED});stop=tt.at(time);
 primary=await loadGarageModel('dr1000');if(disposed){primary.dispose();throw Error('disposed');}train=await createConsist('dr1000',primary);if(disposed){train.dispose();throw Error('disposed');}scene.add(train.root);train.root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
 follow3D=createTerrainFollower(train);
 // 天燈：跟人／車同一個比例尺（1.25/primary.size.y），資產載入是非同步的，所以晚於 createScene() 才裝上去（見 shifen.js 的 createSkyLanterns 說明）。
 const lanternKit=await loadGarageParts(new URL('../../rail-3d/assets/garage-lanterns-v1/lanterns.json',import.meta.url));if(disposed){lanternKit.dispose();throw Error('disposed');}
 const shifenScale=1.25/primary.size.y;
 lanterns=createSkyLanterns(lanternKit,shifenScale,shifen.lanternZone,{seed:20260928});scene.add(lanterns.group);
 // 樹與竹叢、遊客與舉天燈：09-28 新增，跟天燈同一個「非同步資產、等 loadGarageParts() 完成後才裝上去」模式。
 const vegKit=await loadGarageParts(new URL('../../rail-3d/assets/garage-shifen-v1/shifen-veg.json',import.meta.url));if(disposed){vegKit.dispose();throw Error('disposed');}
 vegetation=createVegetation(vegKit,shifen.treeSpots,shifen.bambooSpots);scene.add(vegetation.group);
 const peopleKit=await loadGarageParts(new URL('../../rail-3d/assets/garage-people-v1/people.json',import.meta.url));if(disposed){peopleKit.dispose();throw Error('disposed');}
 visitors=createVisitors(peopleKit,lanternKit,shifenScale,shifen.lanternZone,{seed:20260929});scene.add(visitors.group);
 ready=true;loading.hidden=true;setView(view);setTheme(period);controls();resize();draw();schedule();
 window.shifenPreview={
  get state(){return{ready,lighting:train.lighting.state,period,view,running,pan:{x:pan.x,y:pan.y},yaw,elevation,distance,time,phase:stop.phase,lap:stop.lap,currentSpeed:stop.speed,zoom,draws,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,memory:{...renderer.info.memory},poses:train.cars.map(c=>({id:c.id,x:c.car.position.x,y:c.car.position.y,z:c.car.position.z,heading:c.heading,pitch:c.pitch,offset:c.offset,length:c.length})),trainLength:train.length,pathLength:shifen.path.length,params:shifen.params,speed:SPEED, bounds:train.cars.map(c=>{const b=new THREE.Box3().setFromObject(c.car),ps=[];for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const q=new THREE.Vector3(x,y,z).project(camera);ps.push([(q.x+1)*canvas.width/2,(1-q.y)*canvas.height/2]);}return{left:Math.min(...ps.map(p=>p[0])),right:Math.max(...ps.map(p=>p[0])),top:Math.min(...ps.map(p=>p[1])),bottom:Math.max(...ps.map(p=>p[1]))};})};},
  sample:s=>shifen.path.sample(s),
  project:p=>{const q=new THREE.Vector3(...p).project(camera);return{x:(q.x+1)*canvas.width/2,y:(1-q.y)*canvas.height/2};},
  setTime:t=>{time=t;draw();},timeAtPosition:s=>tt.timeAtPosition(s),timetable:{lap:tt.lap,phases:tt.phases,showcase:tt.showcase,stationOffset:STATION_OFFSET},
  render:draw,dispose,
  trainVisible:visible=>{train.root.visible=visible;draw();},
  sceneVisible:visible=>{shifen.group.visible=ground.visible=visible;draw();},   // 驗收用：只留車（連接影子的地面也收掉），量「車完全露出」的剪影當對照
  setVisible:(name,visible)=>{const o=shifen.group.getObjectByName(name)||lanterns?.group.getObjectByName(name)||vegetation?.group.getObjectByName(name)||visitors?.group.getObjectByName(name);if(o)o.visible=visible;draw();return !!o;},   // 驗收用：把某個具名網格藏起來當對照（也找得到 lanterns/vegetation/visitors 群組裡的東西，跟 shifen.group 是兄弟關係，不是它的子節點）
  // 驗收用：天燈——實際畫出來的第 k 盞的世界座標／scale（見 shifen.js 的 readInstance），與靜態資訊（總數／回收高度／淡出窗）。
  lanternState:k=>lanterns?lanterns.readInstance(k):null,
  lanternInfo:()=>lanterns?{count:lanterns.count,H:lanterns.H,releaseZ:lanterns.releaseZ,fade:lanterns.FADE}:null,
  // 驗收用：樹與竹叢——實際寫進樹幹 InstancedMesh 的第 i 棵世界座標／scale，與總數。
  vegInfo:()=>vegetation?{treeCount:vegetation.treeCount,canopyCount:vegetation.canopyCount,culmCount:vegetation.culmCount,leafCount:vegetation.leafCount}:null,
  vegTrunk:i=>vegetation?vegetation.readTrunk(i):null,
  // 驗收用：遊客——目前每個人的邏輯狀態（這一幀真的拿去 setMatrixAt 的那份，不是重算）；
  // readTorso/readLantern 額外讀回 GPU 端實際矩陣，連算繪管線本身有沒有寫對都驗得到。
  visitorInfo:()=>visitors?{count:visitors.count,holderIndices:visitors.holderIndices,walkSpeedWorld:visitors.walkSpeedWorld,maxWorldSpeedSeen:visitors.maxWorldSpeedSeen}:null,
  visitorState:()=>visitors?visitors.state():null,
  visitorTorso:i=>visitors?visitors.readTorso(i):null,
  visitorLantern:k=>visitors?visitors.readLantern(k):null,
  // 驗收用：每節車廂實際的世界座標軸對齊包圍盒（跟 state.bounds 同一個 THREE.Box3().setFromObject
  // 來源，只是不投影到螢幕——用來跟遊客世界座標做「車身表面到人」的獨立跨系統距離比對，不是
  // 重算 trainMinDistance() 內部公式）。
  trainWorldBounds:()=>train.cars.map(c=>{const b=new THREE.Box3().setFromObject(c.car);return{min:b.min.toArray(),max:b.max.toArray()};}),
  // 驗收用：掃「真的在畫面上的那個 scene」（含 vegetation/visitors/lanterns 這些跟 shifen.group
  // 平行加進 scene 的群組），找有沒有任何 material 用到某個十六進位色——vegetation 是另外用
  // loadGarageParts() 建的資產、不在 createScene() 探針裡，只有活頁面的 scene 才看得到它，所以
  // 這個判準不能用「另外 new 一個 createScene() 探針」代替，一定要掃這個真正的 scene。
  sceneHasMaterialColor:hex=>{let found=false;scene.traverse(o=>{if(o.material?.color&&o.material.color.getHexString()===hex.replace('#',''))found=true;});return found;}
 };
}catch(e){if(!disposed){dispose();loading.hidden=false;loading.textContent='小車暫時無法載入。';const b=document.createElement('button');b.textContent='重新載入';b.onclick=()=>location.reload();loading.append(b);}console.error(e);}
