import * as THREE from '../../rail-3d/vendor/three.module.js';
import {createScene,THEMES,createSkyLanterns} from '../../rail-3d/garage-scenes/shifen.js';
import {loadGarageModel,createConsist,loadGarageParts} from '../../rail-3d/garage-model.js?revision=headlights-0912';
import {createTerrainFollower} from '../../rail-3d/garage-scenes/consist-3d.js';
import {createStopTimetable} from '../../rail-3d/garage-scenes/stop-timetable.js?revision=stop-0927';
const canvas=document.querySelector('#scene'),loading=document.querySelector('#loading');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const SPEED=1.7; // 巡航時每秒沿路徑前進的弧長；位置一律由停站時刻表從時間求出（setTime／setDistance 與逐幀播放同一條路，跟南迴同一個模式）。
const STATION_OFFSET=13.2; // path 的 s=0 落在老街中段（x=0）；十分站月台中心在 x=13.2（前直線上 x===s），停站永遠停在 s≡0，這裡把它搬到月台中心。
let tt,stop,lanterns=null,follow3D,renderer,environment,primary,train,shifen,raf=0,last=0,time=0,distance=0,period='day',view=matchMedia('(max-width:800px)').matches?'train':'world',running=!reduced.matches,zoom=1,span=1,yaw=-1.12,elevation=.58,disposed=false,ready=false,draws=0,lastPhase=null;
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
 train.lighting.update(period,1);lanterns?.update(time,period);
 // 跟車視角在站區（減速／停站／加速）也會被同一片月台雨棚蓋住車頭（原因見下方月台特寫的說明）；只在
 // 階段真的切換的當下調整仰角（不是每幀都覆寫），使用者手動拖曳調的仰角在下一次階段切換前不會被搶走。
 if(view==='train'&&stop.phase!==lastPhase)elevation=stop.phase==='cruising'?.5:1.22;
 lastPhase=stop.phase;
 const rect=canvas.getBoundingClientRect(),aspect=rect.width/Math.max(1,rect.height);
 // 月台特寫：南迴「看月台」是壓低仰角貼近平視，但十分這裡試過同樣做法會被月台雨棚整片蓋住車身——
 // 正交相機沒有透視，物體在畫面上的位置只看「與視線方向垂直的偏移」，雨棚比車高又比車靠鏡頭這一側，
 // 仰角越平兩者在視線方向上越對齊、擋得越兇（量過：預設 .58 仰角偏移角 18°，壓到 .22 反而縮到 12°、
 // 更擋；換到雨棚另一側則會直接看穿對岸的山，一樣整片擋住，那座山比雨棚更沒得閃）。抬高仰角才是對的
 // 方向——正交投影下，仰角趨近90°（正上方往下看）時，任何物體的高度差都不影響它投到畫面上的位置，
 // 雨棚再高也不會跟著往車身那邊「斜」過去蓋住它，兩者会照世界座標的 y 差乾乾淨淨分開。仰角抬到 1.15
 // rad（約66°，仍看得出車身立體感，不是全垂直俯視）就把偏移角推開，雨棚退回車正後方一小截，
 // 不再橫著蓋住車身；鏡頭仍留在跟其他視角同一側（原本的 yaw，換到對岸那側會看到山）。
 if(view==='train'){target.set(0,0,0);for(const c of train.cars)target.add(c.car.position);target.multiplyScalar(1/train.cars.length);target.z+=1.4;}
 else if(view==='platform')target.set(STATION_OFFSET,-7.3,.95);
 else target.set(0,1.0,1.2);
 focus.copy(target).add(pan);
 span=(view==='train'?Math.max(9,train.length*.65/aspect):view==='platform'?Math.max(5.5,7.5/aspect):Math.max(24,35/aspect))/zoom;
 Object.assign(camera,{left:-span*aspect,right:span*aspect,top:span,bottom:-span});camera.position.set(focus.x+100*Math.cos(elevation)*Math.cos(yaw),focus.y+100*Math.cos(elevation)*Math.sin(yaw),focus.z+100*Math.sin(elevation));camera.lookAt(focus);camera.updateProjectionMatrix();camera.updateMatrixWorld();scene.updateMatrixWorld(true);renderer.render(scene,camera);draws++;
 canvas.dataset.ready='true';canvas.dataset.distance=String(distance);canvas.dataset.period=period;canvas.dataset.view=view;
}
function frame(at){raf=0;if(disposed||document.hidden)return;if(last&&at-last<32){schedule();return;}const dt=last?Math.min((at-last)/1000,.08):0;last=at;if(running)time+=dt;draw();if(running)schedule();}
function reset(){zoom=1;pan.set(0,0,0);yaw=-1.12;elevation=view==="platform"?1.15:view==='train'?(stop&&stop.phase!=='cruising'?1.22:.5):.58;controls();schedule();}   // 平地老街的跟車鏡頭抬高一點（.42→.5），近排店屋的屋頂才不會蓋掉車身下半；月台特寫／跟車在站區都抬高仰角（原因見 draw() 裡的說明），yaw 沿用原本那一側（換到對岸看得到山，一樣會擋）
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
function dispose(){if(disposed)return;disposed=true;ready=false;cancelAnimationFrame(raf);observer.disconnect();lanterns?.dispose();train?.dispose();primary?.dispose();shifen?.dispose();environment?.dispose();groundGeo.dispose();groundMat.dispose();sun.shadow.map?.dispose();renderer?.dispose();}
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
 lanterns=createSkyLanterns(lanternKit,1.25/primary.size.y,shifen.lanternZone,{seed:20260928});scene.add(lanterns.group);
 ready=true;loading.hidden=true;setView(view);setTheme(period);controls();resize();draw();schedule();
 window.shifenPreview={
  get state(){return{ready,lighting:train.lighting.state,period,view,running,pan:{x:pan.x,y:pan.y},distance,time,phase:stop.phase,lap:stop.lap,currentSpeed:stop.speed,zoom,draws,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,memory:{...renderer.info.memory},poses:train.cars.map(c=>({id:c.id,x:c.car.position.x,y:c.car.position.y,z:c.car.position.z,heading:c.heading,pitch:c.pitch,offset:c.offset,length:c.length})),trainLength:train.length,pathLength:shifen.path.length,params:shifen.params,speed:SPEED, bounds:train.cars.map(c=>{const b=new THREE.Box3().setFromObject(c.car),ps=[];for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const q=new THREE.Vector3(x,y,z).project(camera);ps.push([(q.x+1)*canvas.width/2,(1-q.y)*canvas.height/2]);}return{left:Math.min(...ps.map(p=>p[0])),right:Math.max(...ps.map(p=>p[0])),top:Math.min(...ps.map(p=>p[1])),bottom:Math.max(...ps.map(p=>p[1]))};})};},
  sample:s=>shifen.path.sample(s),
  project:p=>{const q=new THREE.Vector3(...p).project(camera);return{x:(q.x+1)*canvas.width/2,y:(1-q.y)*canvas.height/2};},
  setTime:t=>{time=t;draw();},timeAtPosition:s=>tt.timeAtPosition(s),timetable:{lap:tt.lap,phases:tt.phases,showcase:tt.showcase,stationOffset:STATION_OFFSET},
  render:draw,dispose,
  trainVisible:visible=>{train.root.visible=visible;draw();},
  sceneVisible:visible=>{shifen.group.visible=ground.visible=visible;draw();},   // 驗收用：只留車（連接影子的地面也收掉），量「車完全露出」的剪影當對照
  setVisible:(name,visible)=>{const o=shifen.group.getObjectByName(name)||lanterns?.group.getObjectByName(name);if(o)o.visible=visible;draw();return !!o;},   // 驗收用：把某個具名網格藏起來當對照（也找得到 lanterns.group 裡的東西，例如 sky-lantern-glow：跟 shifen.group 是兄弟關係，不是它的子節點）
  // 驗收用：天燈——實際畫出來的第 k 盞的世界座標／scale（見 shifen.js 的 readInstance），與靜態資訊（總數／回收高度／淡出窗）。
  lanternState:k=>lanterns?lanterns.readInstance(k):null,
  lanternInfo:()=>lanterns?{count:lanterns.count,H:lanterns.H,releaseZ:lanterns.releaseZ,fade:lanterns.FADE}:null
 };
}catch(e){if(!disposed){dispose();loading.hidden=false;loading.textContent='小車暫時無法載入。';const b=document.createElement('button');b.textContent='重新載入';b.onclick=()=>location.reload();loading.append(b);}console.error(e);}
