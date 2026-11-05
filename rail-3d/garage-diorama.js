// 車庫第 4 格「場景」：七座精緻場景與預設車庫「田園小站」，畫在車庫共用的那一個 WebGL context 上。
// 鏡頭、光照、陰影、行駛照網頁原型 prototypes/garage-*/main.js；田園小站用十分老街的鏡頭、高架的速度（同 App）。
// 參數跟 native scripts/garage-scenes/bake.mjs 的 META 同一組：App 的場景也是拿這幾支場景模組烘出來的，幾何不另寫。
// 跟原型不同的只有三處：手機（lite）關陰影、像素比 1（10-30 A54 量測：十分老街跟車 22→57 fps），場景內容不砍；
// 各座的專屬按鈕（折返、停在月台、看涵洞）沒搬；手勢與滑鼠照主地圖（rail-3d/map-gestures.js），平移由 draw 的 pan 接。
import * as THREE from './vendor/three.module.js';
import {createConsist,loadGarageParts} from './garage-model.js';
import {createPeople} from './garage-people.js';
import {loadScooterKit} from './garage-scooter.js';
import {createTrainLamps} from './garage-coast.js';
import {createTerrainFollower} from './garage-scenes/consist-3d.js';
import {createJourney} from './garage-scenes/alishan-route.js';
import {createStopTimetable} from './garage-scenes/stop-timetable.js';

// drive：0 平面環線（garage-model.js follow）、1 車身跟坡度（consist-3d.js）、2 阿里山六段折返（機關車在下山端）、
// 3 穿越：一端開進、另一端開出，車身在 x＝±clip 被裁掉，整列開出去才繞回來；pass＝[一趟的弧長, 時間 0 的車心位置]。
// 一趟的弧長決定多久來一班：至少 2×clip＋最長編組（14.5），不然車頭進場時車尾還沒出場；雙線把 opposing 設半趟，兩股輪流來。
// focusZ：跟車焦點 0＝固定 1.4、1＝各節平均高度＋1.4。span：全景半高＝max(a, b/aspect)。沒寫 focus 的取場景模組的 focus。
// stop：每圈在月台停一次（stop-timetable.js），值是路徑 s≡0 要搬到的位置（月台中心）；doors：停站開月台側車門、乘客上下車。
// kits：場景要的 Blender 零件庫（rail-3d/assets/<名>.json；scooter＝光華街的機車），見下面 SCENE_ARGS 與掛件。ground：null＝不放接影子的地面。
// start：時間 0 往後挪幾秒（多良開頁就看得到車）；opposing：對向車晚幾秒（平交道 3 秒、一起過；九座的雙線半趟、輪流來）。
export const SCENES={
 'south-coast':{speed:2.1,yaw:-1.14,world:.65,train:.38,focus:[0,0,1],span:[23,39],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:0,drive:0,stop:-3,kits:['garage-palms-v1/palms','garage-coast-v1/station','garage-people-v1/people']},
 alishan:{speed:2.6,yaw:-1.35,world:.67,train:.48,focus:[0,0,6.5],span:[29,43],ground:-3.05,shadow:[-42,42,45,-45,1,140],focusZ:1,drive:2,locoAtTail:true,kits:['garage-alishan-fx-v1/alishan-fx','garage-alishan-trees-v1/alishan-trees']},
 viaduct:{speed:2.1,yaw:-1.12,world:.58,train:.42,focus:[0,1.5,2.6],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:1,stop:0,doors:true,kits:['garage-people-v1/people']},
 shifen:{speed:1.7,yaw:-1.12,world:.58,train:.5,focus:[0,1.0,1.2],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:1,stop:13.2,kits:['garage-lanterns-v1/lanterns','garage-shifen-v1/shifen-veg','garage-people-v1/people']},
 // 捷運、高鐵、機捷（metro-kit.js 骨架）：高架的照站前街的鏡頭與焦點。
 'taipei-metro':{speed:2.1,yaw:-1.12,world:.58,train:.42,focus:[0,1.5,2.6],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:3,pass:[100,-6],clip:33,opposing:23.8},
 wenhu:{speed:2.1,yaw:-1.12,world:.58,train:.42,focus:[0,1.5,2.6],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:3,pass:[100,-6],clip:33,opposing:23.8},
 'airport-mrt':{speed:2.1,yaw:-1.12,world:.58,train:.42,focus:[0,1.5,2.6],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:3,pass:[100,-6],clip:33,opposing:23.8},
 'ntpc-metro':{speed:2.1,yaw:-1.12,world:.58,train:.42,focus:[0,1.5,2.6],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:3,pass:[100,-6],clip:33,opposing:23.8},
 'ntpc-lrt':{speed:1.8,yaw:-1.12,world:.58,train:.5,focus:[0,1,1.2],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:1},
 'taichung-metro':{speed:2.1,yaw:-1.12,world:.58,train:.42,focus:[0,1.5,2.6],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:3,pass:[100,-6],clip:33,opposing:23.8},
 'kaohsiung-metro':{speed:2.1,yaw:-1.12,world:.58,train:.42,focus:[0,1,1.2],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:3,pass:[96,-6],clip:29.6,opposing:22.9},
 'kaohsiung-lrt':{speed:1.8,yaw:-1.12,world:.58,train:.5,focus:[0,1,1.2],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:1},
 thsr:{speed:2.5,yaw:-1.12,world:.58,train:.42,focus:[0,1.5,2.6],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:3,pass:[100,-6],clip:33,opposing:20.0},
 paddy:{module:'default-paddy',speed:2.1,yaw:-1.12,world:.58,train:.5,focus:[0,1.0,1.2],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:1},
 duoliang:{speed:2.6,yaw:-1.12,world:.61,train:.61,span:[28,42],ground:null,shadow:[-45,45,40,-38,1,150],drive:3,pass:[110,-30],clip:35,start:8,kits:['garage-people-v1/people','garage-camera-v1/camera']},
 crossing:{speed:2.6,yaw:-1.12,world:.61,train:.61,span:[28,42],ground:null,shadow:[-45,45,40,-38,1,150],drive:3,pass:[110,-30],clip:35,opposing:3},
 hsinchu:{speed:2.4,yaw:-1.12,trainYaw:2.02,world:.58,train:.42,focus:[0,-3,2],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:3,pass:[100,-6],clip:33,opposing:23.8,kits:['garage-stations-v1/hsinchu']},
 tainan:{speed:2.4,yaw:-1.12,trainYaw:2.02,world:.58,train:.42,focus:[0,-3,2],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:3,pass:[100,-6],clip:33,opposing:23.8,kits:['garage-stations-v1/tainan']},
 'taichung-old':{speed:2.4,yaw:-1.12,trainYaw:2.02,world:.58,train:.42,focus:[0,-3,2],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:3,pass:[100,-6],clip:33,opposing:23.8,kits:['garage-stations-v1/taichung-old']},
 chiayi:{speed:2.4,yaw:-1.12,trainYaw:2.02,world:.58,train:.42,focus:[0,-3,2],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:3,pass:[100,-6],clip:33,opposing:23.8,kits:['garage-stations-v1/chiayi']},
 baoan:{speed:2.4,yaw:-1.12,trainYaw:2.02,world:.58,train:.42,focus:[0,-3,2],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:3,pass:[100,-6],clip:33,opposing:23.8,kits:['garage-stations-v1/baoan']},
 jiji:{speed:2.4,yaw:-1.12,trainYaw:2.02,world:.58,train:.42,focus:[0,-2,2],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:3,pass:[100,-6],clip:33,kits:['garage-stations-v1/jiji']},
 haixian:{speed:2.4,yaw:-1.12,trainYaw:2.02,world:.58,train:.42,focus:[0,-2,2],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:3,pass:[100,-6],clip:33,opposing:23.8,kits:['garage-stations-v1/dashan']},
 dongshan:{speed:2.4,yaw:-1.12,trainYaw:2.02,world:.58,train:.42,focus:[0,-1,2],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:3,pass:[100,-6],clip:33,opposing:23.8,kits:['garage-stations-v1/dongshan']},
 'kaohsiung-old':{speed:2.4,yaw:-1.12,trainYaw:2.02,world:.58,train:.42,focus:[0,-2,2],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:3,pass:[100,-6],clip:33,opposing:23.8,kits:['garage-stations-v1/kaohsiung-imperial','garage-stations-v1/kaohsiung-canopy']},
 shengxing:{speed:2.4,yaw:-1.12,trainYaw:2.02,world:.58,train:.42,focus:[0,-3,2],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:3,pass:[100,-6],clip:33},
 'taipei-under':{speed:2.4,yaw:-1.12,trainYaw:2.02,world:.58,train:.42,focus:[0,-2,2],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:3,pass:[100,-6],clip:33,opposing:23.8},
 guanghua:{speed:2.6,yaw:-1.4,world:.42,train:.4,span:[10.5,21.5],ground:-2.5,shadow:[-42,42,35,-35,1,140],drive:3,pass:[90,-10],clip:26,trainZ:.9,kits:['garage-people-v1/people','garage-camera-v1/camera','scooter']},
 // 台南沿線：底座長 240，所以 followClamp（跟車鏡頭走多遠）、reach（全景平移多遠）、zoomMax（放大上限）、near（鏡頭擺在中段時兩端不被近裁切面切掉）都要放寬；沒寫的場景照舊。
 // speed 與 pass 讓一趟剛好是光華街機車週期的 3 倍（300÷26/9＝90÷2.6×3），本線車過涵洞時機車在洞裡；opposing 讓兩列在車站與光華街會車。
 'tainan-line':{speed:26/9,yaw:-1.38,trainYaw:2.02,world:.5,train:.58,focus:[0,0,2],span:[34,128],ground:-4.1,shadow:[-135,135,80,-80,-90,300],drive:3,pass:[300,81.9],clip:120,opposing:60.2,followClamp:118,reach:118,zoomMax:6,near:-170,kits:['garage-stations-v1/tainan','garage-people-v1/people','garage-camera-v1/camera','scooter']},
};
// 零件庫怎麼交給場景模組：南迴（棕櫚、站房）、阿里山（雲海螢火蟲、樹）照位置傳，多良、光華街整包傳；其餘不傳，零件庫給下面的掛件用。
const SCENE_ARGS={'south-coast':k=>[k[0],k[1]],alishan:k=>[k[0],k[1]],duoliang:k=>[k],guanghua:k=>[k],'tainan-line':k=>[k],...Object.fromEntries(['hsinchu','tainan','taichung-old','chiayi','baoan','jiji','haixian','dongshan'].map(id=>[id,k=>[k[0]]])),'kaohsiung-old':k=>[k]};
// 田園小站的電車線依車款（同 native railcore GarageCatenary）：電聯車、城際、電力機車畫，柴油客車不畫；輕軌只有淡海、安坑有架空線。
const WIRED=new Set(['railcar','express','electric']),DIESEL=new Set(['dr1000','dr2700','dr3000','dr3100']),OVERHEAD=new Set(['danhai','ankeng']);
export const catenaryFor=(id,family)=>WIRED.has(family)?!DIESEL.has(id):OVERHEAD.has(id);
// 場景只有白天、黃昏、夜晚三套；車庫的日出用黃昏那套（同 App R3DDiorama.theme）。
const themeOf=period=>period==='day'||period==='night'?period:'sunset';
// 車身 [q−半長, q+半長] 碰不碰到隧道段；環線取模（同 App touchesTunnel）。
function touchesTunnel(q,half,[start,end],length){let d=(q-(start+end)/2)%length;if(d<-length/2)d+=length;else if(d>length/2)d-=length;return Math.abs(d)<(end-start)/2+half;}
// 零件庫一起載；任一個失敗就把已載好的放掉再丟錯。
async function loadKits(names=[],signal){
 const r=await Promise.allSettled(names.map(n=>n==='scooter'?loadScooterKit(signal):loadGarageParts(new URL(`./assets/${n}.json`,import.meta.url),signal)));
 const bad=r.find(x=>x.status==='rejected');if(bad){r.forEach(x=>x.value?.dispose());throw bad.reason;}
 return r.map(x=>x.value);
}

export async function createDiorama(renderer,sceneId,carId,primary,{family,signal}={}){
 const m=SCENES[sceneId];if(!m)throw Error('scene missing');
 const mod=await import(`./garage-scenes/${m.module||sceneId}.js`),kits=await loadKits(m.kits,signal);
 if(signal?.aborted){kits.forEach(k=>k.dispose());throw new DOMException('aborted','AbortError');}
 let world;
 try{world=mod.createScene(...(SCENE_ARGS[sceneId]?.(kits)??[]));}catch(e){kits.forEach(k=>k.dispose());throw e;}
 const themes=mod.THEMES,consists=[];
 try{
  consists.push(await createConsist(carId,primary,signal,{locoAtTail:!!m.locoAtTail,doors:!!m.doors}));
  if(m.opposing)consists.push(await createConsist(carId,primary,signal));
 }catch(e){consists.forEach(c=>c.dispose());world.dispose();kits.forEach(k=>k.dispose());throw e;}
 const [consist,opposing]=consists,scale=1.25/primary.size.y;
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-40,40,30,-30,m.near??.1,400);camera.up.set(0,0,1);
 const sun=new THREE.DirectionalLight('#fff1cf',3.2),hemi=new THREE.HemisphereLight('#c1dce7','#7b8663',2.1);
 sun.position.set(-25,-30,45);sun.shadow.mapSize.set(1024,1024);const [l,r,t,b,n,f]=m.shadow;Object.assign(sun.shadow.camera,{left:l,right:r,top:t,bottom:b,near:n,far:f});sun.shadow.normalBias=.035;sun.shadow.bias=-.0001;scene.add(sun,hemi,sun.target);
 const groundGeo=new THREE.PlaneGeometry(2000,2000),groundMat=new THREE.ShadowMaterial({opacity:.12}),ground=new THREE.Mesh(groundGeo,groundMat);ground.position.z=m.ground??0;ground.receiveShadow=true;if(m.ground!=null)scene.add(ground);
 const studio=new THREE.Scene();studio.background=new THREE.Color('#9dafb0');const pmrem=new THREE.PMREMGenerator(renderer),environment=pmrem.fromScene(studio,.1);scene.environment=environment.texture;pmrem.dispose();
 scene.add(world.group,...consists.map(c=>c.root));
 // 車燈（同 App 的 dioramaLights）：每列車一套（平交道、光華街還有對向那列）。點光要在下面隧道透視把燈開進 XRAY 圖層之前加進場景，兩趟的燈數才一樣。
 const lamps=consists.map(c=>createTrainLamps(c,environment.texture));for(const l of lamps)scene.add(l.halos,l.beam);
 // 電車線依車款畫不畫（同 App GarageCatenary）：田園小站是 catenary 物件，多良那組由場景模組照 update 收到的 wires 開關。
 const wires=sceneId==='paddy'||sceneId==='duoliang'?catenaryFor(carId,family):null;
 if(wires!==null)world.group.traverse(o=>{if(o.name==='catenary')o.visible=wires;});
 // 集電弓頂到場景的接觸線；沒有電車線的場景（或田園小站這款車不畫線）降弓。
 for(const c of consists)c.setContactWire(wires===false?null:world.contactWireZ??null);
 // 隧道透視（田園小站，同 App 與網頁 3D 地圖的地下列車 .42）：被山擋住的車隔著山只透出最外層車殼，不透出車內與對面那片車殼。
 // 整幀畫完後只畫 XRAY 圖層再一趟，stencil 五步（同 App R3DRenderer／garage_scene.cpp）：mark 標出車身比深度遠的像素 →
 // unmark 車身看得到的像素取消（不然車窗玻璃、陰影會被疊色改掉）→ clearDepth 只在剩下的像素把深度清成最遠 → depth 寫車殼深度 → color 只畫最近那層。
 const XRAY=1,STEPS={
  mark:{colorWrite:false,depthWrite:false,depthFunc:THREE.GreaterDepth,stencilWrite:true,stencilFunc:THREE.AlwaysStencilFunc,stencilZPass:THREE.ReplaceStencilOp},
  unmark:{colorWrite:false,depthWrite:false,depthFunc:THREE.LessEqualDepth,stencilWrite:true,stencilFunc:THREE.AlwaysStencilFunc,stencilZPass:THREE.ReplaceStencilOp,stencilRef:0},
  depth:{colorWrite:false,depthWrite:true,depthFunc:THREE.LessDepth,stencilWrite:true,stencilWriteMask:0,stencilFunc:THREE.EqualStencilFunc},
  color:{blending:THREE.CustomBlending,opacity:.42,depthWrite:false,depthFunc:THREE.LessEqualDepth,stencilWrite:true,stencilWriteMask:0,stencilFunc:THREE.EqualStencilFunc},
 };
 const xrayMaterials=new Map(),xrayOf=(list,step)=>{if(!xrayMaterials.has(list))xrayMaterials.set(list,{});const by=xrayMaterials.get(list);return by[step]??=list.map(src=>{const x=src.clone();x.onBeforeCompile=src.onBeforeCompile;Object.assign(x,{transparent:false,stencilRef:1},STEPS[step]);return x;});};
 const clearDepth=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({vertexShader:'void main(){gl_Position=vec4(position.xy,1.,1.);}',fragmentShader:'void main(){gl_FragColor=vec4(0.);}',
  colorWrite:false,depthWrite:true,depthFunc:THREE.AlwaysDepth,stencilWrite:true,stencilWriteMask:0,stencilFunc:THREE.EqualStencilFunc,stencilRef:1}));
 clearDepth.frustumCulled=false;clearDepth.renderOrder=3;clearDepth.layers.set(XRAY);
 const xrays=world.tunnel?consist.cars.map(c=>Object.fromEntries(Object.keys(STEPS).map((step,k)=>{const x=new THREE.Mesh(c.asset.geometry,xrayOf(c.asset.materials,step));x.position.copy(c.body.position);x.renderOrder=[1,2,4,5][k];x.visible=false;x.layers.set(XRAY);c.car.add(x);return [step,x];}))):[];
 const xrayMeshes=new Set(xrays.flatMap(Object.values));
 if(xrays.length){scene.add(clearDepth);scene.traverse(o=>{if(o.isLight)o.layers.enable(XRAY);});}
 for(const c of consists)c.root.traverse(o=>{if(o.isMesh&&!xrayMeshes.has(o)){o.castShadow=true;o.receiveShadow=true;}});
 // 穿越的場景：車身在底座兩端被裁掉（同原型）。車頭那份材質車庫其他格也在用，所以裁切只在畫這一格時打開（localClippingEnabled），收掉時把裁切面拿掉。
 const clips=m.clip?[new THREE.Plane(new THREE.Vector3(1,0,0),m.clip),new THREE.Plane(new THREE.Vector3(-1,0,0),m.clip)]:null,clipped=new Set();
 if(clips)for(const c of consists){for(const car of c.cars){[...car.litMaterials,...car.asset.lockedMaterials].forEach(x=>clipped.add(x));car.body.traverse(o=>{if(o.isMesh&&o!==car.body)clipped.add(o.material);});}for(const o of c.root.children)if(o.isMesh)clipped.add(o.material);}
 // 車燈換上的頭燈、尾燈、車窗那幾份複本也要裁。
 if(clips)for(const l of lamps)l.materials.forEach(x=>clipped.add(x));
 for(const x of clipped){x.clippingPlanes=clips;x.clipShadows=true;x.needsUpdate=true;}
 const follow3D=createTerrainFollower(consist),followOpposing=opposing&&createTerrainFollower(opposing),journey=m.drive===2?createJourney(world.routes,consist.length):null;
 const tt=m.stop===undefined?null:createStopTimetable({pathLength:world.path.length,speed:m.speed});
 const passAt=m.pass&&(t=>{const [L,phase]=m.pass;return(((t*m.speed+phase+L/2)%L)+L)%L-L/2;});
 // 掛件：零件庫載好之後才建得出來的人、天燈、樹（同原型的 *-view.js）。比例尺跟車同一個 1.25/車寬。
 let people=null,attendant=null,lanterns=null,vegetation=null,visitors=null;const platformNormal=new THREE.Vector3();
 if(sceneId==='south-coast'){people=createPeople({kit:kits[2],timetable:tt,doors:[],platform:world.platform,scale,seed:20260927});attendant=mod.createAttendant(kits[2],scale,world.platform);scene.add(people.group,attendant);}
 if(sceneId==='viaduct'){
  // 乘客走向停站時的月台側車門：先把車放到 s=0、門關著，量每扇門的世界座標與「往車廂中心」的方向。沒有車門資料的車款是空陣列，沒有人上下車。
  platformNormal.set(0,Math.sign(world.platform.edge-world.platform.trackY),0);
  follow3D(world.path,world.path.length);consist.updateParts();consist.doors?.update(0,platformNormal);scene.updateMatrixWorld(true);
  const doors=consist.doors?consist.doors.points('platform').map(p=>({id:p.id,x:p.point.x,y:p.point.y,inboard:Math.sign(p.car.car.position.x-p.point.x)})):[];
  people=createPeople({kit:kits[0],timetable:tt,doors,platform:world.platform,scale});scene.add(people.group);
 }
 if(sceneId==='shifen'){lanterns=mod.createSkyLanterns(kits[0],scale,world.lanternZone,{seed:20260928});vegetation=mod.createVegetation(kits[1],world.treeSpots,world.bambooSpots);visitors=mod.createVisitors(kits[2],kits[0],scale,world.lanternZone,{seed:20260929});scene.add(lanterns.group,vegetation.group,visitors.group);}
 // 高架：雨棚擋到進站或停著的車門就淡到 .25（同原型）——月台側每扇門中心往鏡頭的射線穿過雨棚外框才淡，照真實時間漸變。
 // 沒有車門資料的車款取每節車月台側、車廂兩端往內 .2 車長、門高的點。
 const toCamera=new THREE.Vector3(),ray=new THREE.Ray();let canopy=1,lastDraw=0;
 function doorPoints(){
  const pts=consist.doors?consist.doors.points('platform').map(p=>p.point):[];if(pts.length)return pts;
  const pf=world.platform,side=Math.sign(pf.edge-pf.trackY);
  for(const c of consist.cars)for(const k of [-.3,.3]){const h=c.heading;pts.push(new THREE.Vector3(c.car.position.x+Math.cos(h)*c.length*k-Math.sin(h)*side*.625,c.car.position.y+Math.sin(h)*c.length*k+Math.cos(h)*side*.625,pf.top+.45));}
  return pts;
 }
 const target=new THREE.Vector3(),center=new THREE.Vector3(),point=new THREE.Vector3();let period,lite;
 function setTheme(next){period=next;const t=themes[next];scene.background=new THREE.Color(t.background);hemi.color.set(t.ambient);hemi.groundColor.set(t.ground);hemi.intensity=t.hemi??(next==='night'?1.2:2);scene.environmentIntensity=t.env??1;sun.color.set(t.sun);sun.intensity=t.power;sun.position.set(next==='sunset'?-40:-25,next==='sunset'?10:-30,next==='sunset'?20:45);}
 function setLite(next){lite=next;sun.castShadow=!lite;ground.visible=!lite;}
 // 穿越的車：擺好、更新集電弓；整列開出底座就整列藏起來（裁切面之外還有車鉤、陰影）。
 function pass(c,follow,path,d){follow(path,d);c.updateParts();c.root.visible=Math.abs(d)<m.clip+3+c.length/2+.8;}
 return{
  scene,camera,consist,meta:m,wires,
  // time：行駛累計秒數（同原型只在行駛時累加；停站與穿越都是時間的純函數）。回傳這一幀的狀態給 data-* 用。
  draw(w,h,{period:want='day',time=0,trainView=false,yaw=m.yaw,elevation=m.world,zoom=1,owned=true,lite:wantLite=false,lights=true,pan=[0,0]}={}){
   const p=themeOf(want);if(p!==period)setTheme(p);if(wantLite!==lite)setLite(wantLite);
   renderer.shadowMap.enabled=!lite;renderer.toneMappingExposure=themes[p].exposure;
   const now=time+(m.start||0);
   for(const c of consists)c.update(owned);if(owned)lamps.forEach(l=>l.apply());
   let route=0,s,stop=null,pose,travel=1;
   if(journey){pose=journey.at(now);route=pose.route;s=pose.s;travel=pose.sign;follow3D(world.routes[route],s);consist.updateParts();}
   else if(passAt){s=passAt(now);pass(consist,follow3D,world.path,s);if(opposing)pass(opposing,followOpposing,world.opposingPath,passAt(now-m.opposing));}
   else{if(tt){stop=tt.at(now);s=stop.distance+m.stop;}else s=now*m.speed;if(m.drive===0)consist.follow(world.path,s,1);else follow3D(world.path,s);consist.updateParts();}
   if(stop)consist.doors?.update(stop.doors,platformNormal);
   const cars=[];if(passAt)for(const c of consists)if(c.root.visible)for(const car of c.cars)cars.push(car.car.getWorldPosition(point).toArray());
   world.update(now,p,pose??(passAt?{id:carId,wires,distance:s,opposingDistance:opposing?passAt(now-m.opposing):undefined,length:consist.length,speed:m.speed,cars,scale:mod.UNIT_PER_M?.[carId]??mod.METER}:undefined));
   people?.update(now);lanterns?.update(now,p);vegetation?.update?.(now,p);visitors?.update?.(now,stop.distance,world.path,consist);
   const path=journey?world.routes[route]:world.path;let inTunnel=0;
   const touching=xrays.map((_,i)=>{const c=consist.cars[i];return touchesTunnel(s+c.offset,c.length/2,world.tunnel,path.length);});
   inTunnel=touching.filter(Boolean).length;
   // unmark 每一節都畫（不只碰到隧道的那節）：被前後車廂擋住的部分不透出來，只透過山與場景。
   xrays.forEach((parts,i)=>{const c=consist.cars[i],list=owned?c.asset.materials:c.asset.lockedMaterials;
    for(const [step,x] of Object.entries(parts)){x.material=xrayOf(list,step);x.visible=step==='unmark'?inTunnel>0:touching[i];}});
   const aspect=w/Math.max(1,h);center.set(0,0,0);for(const c of consist.cars)center.add(c.car.position);center.multiplyScalar(1/consist.cars.length);
   if(trainView&&passAt){const q=world.path.sample(THREE.MathUtils.clamp(s,-(m.followClamp??19),m.followClamp??19));target.set(q.x,q.y,q.z+(m.trainZ??1));}
   else if(trainView){target.copy(center);target.z=m.focusZ?target.z+1.4:1.4;}else target.set(...(m.focus||world.focus));
   // 平移：焦點從這裡挪 pan，限在場景中段（跟車時在編組長度內），車和場景拖不出畫面。
   const base=[target.x,target.y],reach=trainView?consist.length/2:m.reach??m.span[1]*.6,box=[base[0]-reach,base[1]-reach,base[0]+reach,base[1]+reach];
   target.x=Math.max(box[0],Math.min(box[2],base[0]+pan[0]));target.y=Math.max(box[1],Math.min(box[3],base[1]+pan[1]));
   const span=(trainView?(passAt?Math.max(8,consist.length*.7/aspect):Math.max(9,consist.length*.65/aspect)):Math.max(m.span[0],m.span[1]/aspect))/zoom;
   Object.assign(camera,{left:-span*aspect,right:span*aspect,top:span,bottom:-span});
   camera.position.set(target.x+100*Math.cos(elevation)*Math.cos(yaw),target.y+100*Math.cos(elevation)*Math.sin(yaw),target.z+100*Math.sin(elevation));camera.lookAt(target);camera.updateProjectionMatrix();camera.updateMatrixWorld();
   // 阿里山：鏡頭和車身之間的樹淡出；要在鏡頭擺好之後算，焦點取車身中段（車廂原點在車底，＋車高一半）。
   if(world.updateTreeFade){center.z+=.625;world.updateTreeFade(camera.position,center);}
   if(world.setCanopyOpacity&&stop){
    const at=performance.now(),dt=lastDraw?Math.min(.08,(at-lastDraw)/1000):1;lastDraw=at;toCamera.set(0,0,1).applyQuaternion(camera.quaternion); // 正交鏡頭：每一點看向鏡頭都是同一個方向
    const goal=(stop.phase==='braking'||stop.phase==='stopped')&&doorPoints().some(p=>ray.set(p,toCamera).intersectsBox(world.canopyBox))?.25:1;
    canopy=goal<canopy?Math.max(goal,canopy-2.5*dt):Math.min(goal,canopy+2.5*dt);world.setCanopyOpacity(canopy);
   }
   scene.updateMatrixWorld(true);
   // 車燈強度照時段（日出不併黃昏），同 App 的 lampStrength。開出底座藏起來的那列不亮、裁切線外的光暈與照地點光不畫（它們不跟著車身藏、也不吃裁切面）。
   const halos=lamps.reduce((n,l,i)=>n+l.lights(owned&&lights&&consists[i].root.visible,want,i?1:travel,camera.position,clips?m.clip:Infinity),0);
   renderer.localClippingEnabled=!!clips;renderer.render(scene,camera);
   if(inTunnel){
    // 透視那趟：不清畫面（背景是顏色時 three 會強制清，先拿掉）、不重算陰影圖、draw call 累加到同一幀。
    const background=scene.background,{autoClear}=renderer,{autoUpdate}=renderer.shadowMap;
    scene.background=null;renderer.autoClear=false;renderer.shadowMap.autoUpdate=false;renderer.info.autoReset=false;camera.layers.set(XRAY);
    renderer.render(scene,camera);
    camera.layers.set(0);scene.background=background;renderer.autoClear=autoClear;renderer.shadowMap.autoUpdate=autoUpdate;renderer.info.autoReset=true;
   }
   renderer.localClippingEnabled=false;
   return{period:p,distance:s,route,inTunnel,shadows:!lite,phase:stop?.phase??null,halos,span,base,box,focus:[target.x,target.y,target.z]};
  },
  dispose(){
   for(const x of clipped){x.clippingPlanes=null;x.clipShadows=false;x.needsUpdate=true;}
   people?.dispose();lanterns?.dispose();vegetation?.dispose();visitors?.dispose();attendant?.traverse(o=>{if(o.isMesh)[].concat(o.material).forEach(x=>x.dispose());});
   lamps.forEach(l=>l.dispose());consists.forEach(c=>c.dispose());world.dispose();kits.forEach(k=>k.dispose());for(const by of xrayMaterials.values())for(const list of Object.values(by))list.forEach(x=>x.dispose());clearDepth.geometry.dispose();clearDepth.material.dispose();environment.dispose();groundGeo.dispose();groundMat.dispose();sun.shadow.map?.dispose();sun.dispose();
  }
 };
}
