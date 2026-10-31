// 車庫第 4 格「場景」：四座精緻場景與預設車庫「田園小站」，畫在車庫共用的那一個 WebGL context 上。
// 鏡頭、光照、陰影、行駛照網頁原型 prototypes/garage-*/main.js；田園小站用十分老街的鏡頭、高架的速度（同 App）。
// 參數跟 native scripts/garage-scenes/bake.mjs 的 META 同一組：App 的場景也是拿這幾支場景模組烘出來的，幾何不另寫。
// 跟原型不同的只有三處：手機（lite）關陰影、像素比 1（10-30 A54 量測：十分老街跟車 22→57 fps），場景內容不砍；
// 平移手勢與各座的專屬按鈕（折返、停在月台）沒搬；車庫自己的旋轉、縮放照 App。
import * as THREE from './vendor/three.module.js';
import {createConsist} from './garage-model.js';
import {createTerrainFollower} from './garage-scenes/consist-3d.js';
import {createJourney} from './garage-scenes/alishan-route.js';

// drive：0 平面環線（garage-model.js follow）、1 車身跟坡度（consist-3d.js）、2 阿里山六段折返（機關車在下山端）。
// focusZ：跟車焦點 0＝固定 1.4、1＝各節平均高度＋1.4。span：全景半高＝max(a, b/aspect)。
export const SCENES={
 'south-coast':{speed:2.1,yaw:-1.14,world:.65,train:.38,focus:[0,0,1],span:[23,39],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:0,drive:0},
 alishan:{speed:2.6,yaw:-1.35,world:.67,train:.48,focus:[0,0,6.5],span:[29,43],ground:-3.05,shadow:[-42,42,45,-45,1,140],focusZ:1,drive:2,locoAtTail:true},
 viaduct:{speed:2.1,yaw:-1.12,world:.58,train:.42,focus:[0,1.5,2.6],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:1},
 shifen:{speed:1.7,yaw:-1.12,world:.58,train:.5,focus:[0,1.0,1.2],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:1},
 paddy:{module:'default-paddy',speed:2.1,yaw:-1.12,world:.58,train:.5,focus:[0,1.0,1.2],span:[24,35],ground:-2.5,shadow:[-42,42,35,-35,1,140],focusZ:1,drive:1},
};
// 田園小站的電車線依車款（同 native railcore GarageCatenary）：電聯車、城際、電力機車畫，柴油客車不畫；輕軌只有淡海、安坑有架空線。
const WIRED=new Set(['railcar','express','electric']),DIESEL=new Set(['dr1000','dr2700','dr3100']),OVERHEAD=new Set(['danhai','ankeng']);
export const catenaryFor=(id,family)=>WIRED.has(family)?!DIESEL.has(id):OVERHEAD.has(id);
// 場景只有白天、黃昏、夜晚三套；車庫的日出用黃昏那套（同 App R3DDiorama.theme）。
const themeOf=period=>period==='day'||period==='night'?period:'sunset';
// 車身 [q−半長, q+半長] 碰不碰到隧道段；環線取模（同 App touchesTunnel）。
function touchesTunnel(q,half,[start,end],length){let d=(q-(start+end)/2)%length;if(d<-length/2)d+=length;else if(d>length/2)d-=length;return Math.abs(d)<(end-start)/2+half;}

export async function createDiorama(renderer,sceneId,carId,primary,{family,signal}={}){
 const m=SCENES[sceneId];if(!m)throw Error('scene missing');
 const mod=await import(`./garage-scenes/${m.module||sceneId}.js`);
 if(signal?.aborted)throw new DOMException('aborted','AbortError');
 const world=mod.createScene(),themes=mod.THEMES;
 let consist;
 try{consist=await createConsist(carId,primary,signal,{locoAtTail:!!m.locoAtTail});}catch(e){world.dispose();throw e;}
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-40,40,30,-30,.1,400);camera.up.set(0,0,1);
 const sun=new THREE.DirectionalLight('#fff1cf',3.2),hemi=new THREE.HemisphereLight('#c1dce7','#7b8663',2.1);
 sun.position.set(-25,-30,45);sun.shadow.mapSize.set(1024,1024);const [l,r,t,b,n,f]=m.shadow;Object.assign(sun.shadow.camera,{left:l,right:r,top:t,bottom:b,near:n,far:f});sun.shadow.normalBias=.035;sun.shadow.bias=-.0001;scene.add(sun,hemi,sun.target);
 const groundGeo=new THREE.PlaneGeometry(2000,2000),groundMat=new THREE.ShadowMaterial({opacity:.12}),ground=new THREE.Mesh(groundGeo,groundMat);ground.position.z=m.ground;ground.receiveShadow=true;scene.add(ground);
 const studio=new THREE.Scene();studio.background=new THREE.Color('#9dafb0');const pmrem=new THREE.PMREMGenerator(renderer),environment=pmrem.fromScene(studio,.1);scene.environment=environment.texture;pmrem.dispose();
 scene.add(world.group,consist.root);
 const wires=sceneId==='paddy'?catenaryFor(carId,family):null;
 if(wires!==null)world.group.traverse(o=>{if(o.name==='catenary')o.visible=wires;});
 // 隧道透視（田園小站，同 App 與網頁 3D 地圖的地下列車 .42）：場景之後、車身之前多畫一趟，只畫比場景遠（被山擋住）的部分。
 // 車身 renderOrder 排在它後面，洞口看得到的部分照常由車身蓋過去。
 const xrayMaterials=new Map(),xrayOf=list=>{if(!xrayMaterials.has(list))xrayMaterials.set(list,list.map(src=>{const x=src.clone();x.onBeforeCompile=src.onBeforeCompile;Object.assign(x,{transparent:false,blending:THREE.CustomBlending,opacity:.42,depthFunc:THREE.GreaterDepth,depthWrite:false});return x;}));return xrayMaterials.get(list);};
 const xrays=world.tunnel?consist.cars.map(c=>{const x=new THREE.Mesh(c.asset.geometry,xrayOf(c.asset.materials));x.position.copy(c.body.position);x.renderOrder=1;x.visible=false;c.car.add(x);c.body.renderOrder=2;return x;}):[];
 consist.root.traverse(o=>{if(o.isMesh&&!xrays.includes(o)){o.castShadow=true;o.receiveShadow=true;}});
 const follow3D=createTerrainFollower(consist),journey=m.drive===2?createJourney(world.routes,consist.length):null;
 const target=new THREE.Vector3();let period,lite;
 function setTheme(next){period=next;const t=themes[next];scene.background=new THREE.Color(t.background);hemi.color.set(t.ambient);hemi.groundColor.set(t.ground);hemi.intensity=next==='night'?1.2:2;sun.color.set(t.sun);sun.intensity=t.power;sun.position.set(next==='sunset'?-40:-25,next==='sunset'?10:-30,next==='sunset'?20:45);}
 function setLite(next){lite=next;sun.castShadow=!lite;ground.visible=!lite;}
 return{
  scene,camera,consist,meta:m,wires,
  // time：行駛累計秒數（distance＝time×速度，同原型只在行駛時累加）。回傳這一幀的狀態給 data-* 用。
  draw(w,h,{period:want='day',time=0,trainView=false,yaw=m.yaw,elevation=m.world,zoom=1,owned=true,lite:wantLite=false}={}){
   const p=themeOf(want);if(p!==period)setTheme(p);if(wantLite!==lite)setLite(wantLite);
   renderer.shadowMap.enabled=!lite;renderer.toneMappingExposure=themes[p].exposure;
   world.update(time,p);consist.update(owned);
   let route=0,s=time*m.speed;
   if(journey){const pose=journey.at(time);route=pose.route;s=pose.s;follow3D(world.routes[route],s);}
   else if(m.drive===0)consist.follow(world.path,s,1);else follow3D(world.path,s);
   const path=journey?world.routes[route]:world.path;let inTunnel=0;
   xrays.forEach((x,i)=>{const c=consist.cars[i];x.material=xrayOf(owned?c.asset.materials:c.asset.lockedMaterials);x.visible=touchesTunnel(s+c.offset,c.length/2,world.tunnel,path.length);inTunnel+=x.visible;});
   const aspect=w/Math.max(1,h);
   if(trainView){target.set(0,0,0);for(const c of consist.cars)target.add(c.car.position);target.multiplyScalar(1/consist.cars.length);target.z=m.focusZ?target.z+1.4:1.4;}else target.set(...m.focus);
   const span=(trainView?Math.max(9,consist.length*.65/aspect):Math.max(m.span[0],m.span[1]/aspect))/zoom;
   Object.assign(camera,{left:-span*aspect,right:span*aspect,top:span,bottom:-span});
   camera.position.set(target.x+100*Math.cos(elevation)*Math.cos(yaw),target.y+100*Math.cos(elevation)*Math.sin(yaw),target.z+100*Math.sin(elevation));camera.lookAt(target);camera.updateProjectionMatrix();camera.updateMatrixWorld();scene.updateMatrixWorld(true);
   renderer.render(scene,camera);
   return{period:p,distance:s,route,inTunnel,shadows:!lite};
  },
  dispose(){consist.dispose();world.dispose();for(const list of xrayMaterials.values())list.forEach(x=>x.dispose());environment.dispose();groundGeo.dispose();groundMat.dispose();sun.shadow.map?.dispose();sun.dispose();}
 };
}
