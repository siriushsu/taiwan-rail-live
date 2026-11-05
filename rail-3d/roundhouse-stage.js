// 機務段（自製列車的扇形車庫）的舞台：渲染器、六股上的車、轉車台、鏡頭、發車動畫。畫面上的文字與按鈕在 my-train-depot.js。
// 自己一個 WebGL context，開頁才建、關頁就放掉。畫面沒動就不畫，陰影只在有東西動的那一幀重畫（量過每幀畫陰影 A54 總覽 52 掉到 33 fps）。
// 手機（lite）照車庫場景的規矩：不畫陰影、像素比 1。
import * as T from './vendor/three.module.js';
import {createRoundhouseWorld} from './garage-scenes/roundhouse.js';
import {loadGarageModel,createConsist} from './garage-model.js';
import {createTrainLamps} from './garage-coast.js';
import {attachMapGestures} from './map-gestures.js';
import {HEAD_MARKS} from './head-marks.js';

const {PI,sin,cos,atan2,tan,min,max,abs,pow}=Math;
const clamp=(v,a,b)=>min(b,max(a,v)),lerp=(a,b,t)=>a+(b-a)*t,io=t=>t<.5?4*t*t*t:1-pow(-2*t+2,3)/2;
// 扇形幾何（公尺）：三節編組約 31 公尺，轉車台要放得下整列車
export const TRACKS=6;
const STEP=14*PI/180,HS=STEP/2,RC=1/cos(HS),RP=16.6,RD=24.5,RB=56,RAIL=.24,R_PARK=21.6,R_FOCUS=17.6;
const phiOf=i=>(2.5-i)*STEP,P=(r,a,y)=>[sin(a)*r,y,cos(a)*r];
const rad=(d,r=58)=>{const a=d*PI/180;return[sin(a)*(RP+.08),cos(a)*(RP+.08),sin(a)*r,cos(a)*r,2.9];};
const YARD=[rad(64,56),rad(-64,56),rad(86),rad(-86),rad(108,57),rad(-112,54),[0,-RP-.08,0,-430,2.9],[0,-40,-6,-66],[-6,-66,-6,-430],[-6,-76,-12,-102],[-12,-102,-12,-430],[0,-52,6,-78],[6,-78,6,-300],[6,-88,12,-114],[12,-114,12,-300]];
const THEMES={
 day:{sun:'#fff0ce',amb:'#c9dce4',gnd:'#8a8468',power:3.1,exp:1,hemi:1.85,env:.7,glow:0,key:6,pos:[-54,84,-74],win:'#b8c6cf',
  sky:{top:'#4f86bf',mid:'#9cc3df',hor:'#e3e4d8',sunC:'#fff2d0',cl:'#ffffff',cs:'#98a7b8',mt:'#7f9aa6',cover:.56,star:0},env3:['#9cc3df','#eef0e6','#8d8a73']},
 dusk:{sun:'#ffae6a',amb:'#b9c6de',gnd:'#7a6a58',power:2.7,exp:.96,hemi:1.3,env:.62,glow:.55,key:30,pos:[-98,34,-62],win:'#f2c9a0',
  sky:{top:'#45608f',mid:'#d49f8c',hor:'#f6c08a',sunC:'#ffb070',cl:'#ffd6ad',cs:'#7e6a86',mt:'#6c6478',cover:.56,star:0},env3:['#8fa7c0','#f2c79a','#6f5f52']},
 night:{sun:'#a9c7df',amb:'#7694b0',gnd:'#243a36',power:.7,exp:1,hemi:1,env:.22,glow:1,key:130,pos:[-36,84,-30],win:'#1a2638',
  sky:{top:'#081222',mid:'#12233a',hor:'#25394e',sunC:'#223a55',cl:'#22344a',cs:'#0e1826',mt:'#101c2a',cover:.6,star:1},env3:['#101c2c','#2c4552','#10161a']},
};
const LAMP_PERIOD={day:'day',dusk:'sunset',night:'night'};

// layout()：畫面上被文字蓋住的範圍 {top,bottom,side,under,narrow}。總覽避開上下兩條，特寫避開畫框（寬螢幕 side 在右、窄螢幕 under 在下）。
// markImage(id)：頭牌那張圖的 canvas。
export async function createRoundhouseStage({canvas,lite,label,layout,markImage,reduced=false,onPick=()=>{},onLost=()=>{}}){
 const renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
 renderer.setPixelRatio(lite?1:min(devicePixelRatio||1,2));
 renderer.shadowMap.enabled=!lite;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
 renderer.toneMapping=T.ACESFilmicToneMapping;
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(30,1,1,4200);
 scene.fog=new T.Fog('#e3e4d8',260,1500);
 const MATS=[],std=o=>{const m=new T.MeshStandardMaterial(o);MATS.push(m);return m;};
 const world=createRoundhouseWorld({renderer,scene,std,MATS,phone:lite,label,G:{RP,RD,RB,STEP,HS,RC,RAIL,NS:TRACKS,phiOf,P,YARD}});
 const {bridge,doors,signs,mOut,mEmpty,mPlates,mGlow,mGlass,mSky,mCity,poolMat,doorGlow,heads,sky,mRed,mGreen}=world;
 let disposed=false,theme='day',dirty=true,shadowDirty=true,raf=0,lost=false,bridgeA=phiOf(2)+PI,cur=-1,busy=false,view='overview',looking=false;
 const trains=Array(TRACKS).fill(null),slots=Array.from({length:TRACKS},()=>({model:null,state:'empty',mark:null,ticket:0}));
 const placeBridge=()=>{bridge.rotation.y=bridgeA;shadowDirty=true;};placeBridge();
 const signal=go=>{mRed.emissiveIntensity=go?0:3;mGreen.emissiveIntensity=go?4:0;dirty=true;};

 // ── 燈光 ──
 const hemi=new T.HemisphereLight('#fff','#888',1),sun=new T.DirectionalLight('#fff',3),key=new T.SpotLight('#fff0d6',0,70,.42,.7,1.2);
 sun.target.position.set(0,0,-6);sun.castShadow=!lite;{const q=2048;sun.shadow.mapSize.set(q,q);}
 Object.assign(sun.shadow.camera,{left:-112,right:112,top:112,bottom:-112,near:8,far:340});sun.shadow.bias=-.0004;sun.shadow.normalBias=.05;
 const wash=new T.DirectionalLight('#ffd9a6',0);wash.position.set(0,16,-40);wash.target.position.set(0,3,28);
 scene.add(hemi,sun,sun.target,key,key.target,wash,wash.target);
 const pmrem=new T.PMREMGenerator(renderer),envs={};
 function skyEnv(n){if(envs[n])return envs[n];const[a,b,c]=THEMES[n].env3,sc=new T.Scene();
  sc.add(new T.Mesh(new T.SphereGeometry(10,32,16),new T.ShaderMaterial({side:T.BackSide,uniforms:{a:{value:new T.Color(a)},b:{value:new T.Color(b)},c:{value:new T.Color(c)}},
   vertexShader:'varying vec3 p;void main(){p=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
   fragmentShader:'varying vec3 p;uniform vec3 a,b,c;void main(){float h=p.y;gl_FragColor=vec4(h>0.?mix(b,a,pow(h,.6)):mix(b,c,pow(-h,.5)),1.);}'})));
  const texture=pmrem.fromScene(sc,.02).texture;sc.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});return envs[n]=texture;}
 const trainEnv=t=>t.holder.traverse(o=>{if(!o.isMesh)return;for(const m of [].concat(o.material))m.envMapIntensity=THEMES[theme].env*1.5;});
 function setTheme(n){theme=n;const t=THEMES[n],u=sky.material.uniforms;scene.fog.color.set(t.sky.hor);
  for(const k of['top','mid','hor','sunC','cl','cs','mt'])u[k].value.set(t.sky[k]);u.cover.value=t.sky.cover;u.star.value=t.sky.star;u.sunD.value.set(...t.pos).normalize();
  hemi.color.set(t.amb);hemi.groundColor.set(t.gnd);hemi.intensity=t.hemi;sun.color.set(t.sun);sun.intensity=t.power;sun.position.set(...t.pos);renderer.toneMappingExposure=t.exp;
  scene.environment=skyEnv(n);for(const m of MATS)m.envMapIntensity=t.env;
  mGlow.emissiveIntensity=t.glow*2.6;mGlass.emissiveIntensity=t.glow*.22;mSky.color.set(t.win);for(const m of mPlates)m.emissiveIntensity=t.glow*.55;
  for(const m of mCity){m.emissiveIntensity=t.glow*.62;m.color.set(n==='night'?'#66707e':'#ffffff');}for(const m of world.towns){m.material.map=n==='night'?m.userData.lit:m.userData.day;m.material.color.set(n==='dusk'?'#e6b791':'#ffffff');m.material.needsUpdate=true;}
  poolMat.opacity=t.glow*.34;wash.intensity=t.glow*1.9;doorGlow.opacity=t.glow*.2;for(const h of heads)h.material.opacity=t.glow*.9;
  for(const tr of trains)if(tr){trainEnv(tr);lightUp(tr);tr.mark.material.emissiveIntensity=t.glow*.55;}shadowDirty=true;dirty=true;wake();}

 // ── 列車：車庫同一套車模與三節編組，縮回車模原尺寸（1 單位約 1 公尺）──
 const eye=new T.Vector3();
 function lightUp(t){if(!t.lamps)return;camera.getWorldPosition(eye);t.lamps.lights(t.lamp>0,LAMP_PERIOD[theme],1,eye);dirty=true;}
 function placeTrain(t){t.g.position.set(sin(t.phi)*t.r,RAIL,cos(t.phi)*t.r);t.g.rotation.y=atan2(cos(t.phi),-sin(t.phi));t.g.updateMatrixWorld(true);shadowDirty=true;dirty=true;}
 const signal0=new AbortController();
 async function makeTrain(i,model){
  const primary=await loadGarageModel(model,signal0.signal);
  let consist;
  try{consist=await createConsist(model,primary,signal0.signal);}catch(e){primary.dispose();throw e;}
  const s=primary.size.y/1.25,g=new T.Group(),holder=new T.Group();
  consist.straight(-1);consist.root.updateMatrixWorld(true);
  const lamps=createTrainLamps(consist,scene.environment);lamps.apply();
  holder.add(consist.root);holder.rotation.x=-PI/2;holder.scale.setScalar(s);holder.position.set(-consist.length*s/2,-.18*s,0);g.add(holder);
  scene.add(g,lamps.halos); // lamps.beam 不掛：車庫場景只有一列所以掛得起，這裡六列就是六盞點光，整個畫面每個像素都多算六盞（量過 A54 特寫 60 掉到 27 fps）
  holder.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  const mark=makeMark(model);consist.cars[0].body.add(mark.group);
  return{i,model,primary,consist,lamps,g,holder,mark,half:consist.length*s/2,phi:phiOf(i),r:R_PARK,lamp:0,tk:0,tail:consist.cars[2].car};
 }
 function dropTrain(t){scene.remove(t.g,t.lamps.halos);t.mark.dispose();t.lamps.dispose();t.consist.dispose();t.primary.dispose();}
 // 頭牌：掛在頭車車身上，座標跟車模同一套（+X 車頭、Z 往上）。不加點光，理由同上面的 lamps.beam。
 const mRim=std({color:'#b8923e',roughness:.4,metalness:.7}),rimGeo=new Map(),discGeo=new Map(),markTex=new Map();
 function makeMark(model){const h=HEAD_MARKS[model],group=new T.Group(),material=new T.MeshStandardMaterial({color:'#fff',roughness:.62,metalness:0,emissive:'#fff',emissiveIntensity:THEMES[theme].glow*.55});
  if(!discGeo.has(h.r)){discGeo.set(h.r,new T.CircleGeometry(h.r,40));rimGeo.set(h.r,new T.CylinderGeometry(h.r+.035,h.r+.035,.09,40));}
  const disc=new T.Mesh(discGeo.get(h.r),material),rim=new T.Mesh(rimGeo.get(h.r),mRim);
  rim.rotation.x=PI/2;disc.position.z=.05;group.add(rim,disc);
  // 牌面朝車頭、順著車鼻往上仰 t，圖的上方朝車頂。
  group.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(new T.Vector3(0,1,0),new T.Vector3(-sin(h.t),0,cos(h.t)),new T.Vector3(cos(h.t),0,sin(h.t))));
  group.position.set(h.x+.02,0,h.z);group.visible=false;
  return{group,material,dispose(){material.dispose();}};}
 function markTexture(id){if(!markTex.has(id)){const t=new T.CanvasTexture(markImage(id));t.colorSpace=T.SRGBColorSpace;t.anisotropy=8;markTex.set(id,t);}return markTex.get(id);}
 function showMark(t,id){if(t.mark.id===id)return;t.mark.id=id;t.mark.group.visible=!!id;if(id){const x=markTexture(id),m=t.mark.material;m.map=x;m.emissiveMap=x;m.needsUpdate=true;}shadowDirty=true;dirty=true;wake();}
 // 列車尾段在屋頂下看不到，停著的時候不畫；開出去才露面。
 const seat=t=>{t.r=R_PARK;t.phi=phiOf(t.i);t.tail.visible=false;t.lamp=0;placeTrain(t);lightUp(t);};
 function applySlot(i){const s=slots[i],t=trains[i],on=s.state==='out'||s.state==='empty';if(t)t.g.visible=s.state==='home';doors[i].visible=false;signs[i].visible=on;signs[i].userData.post.visible=on;if(on)signs[i].material=s.state==='out'?mOut:mEmpty;shadowDirty=true;dirty=true;wake();}
 // rows[i]：{model:車款或 null, state:'home'|'out'|'empty', mark:頭牌或 null}。車款沒變的不重建；同時改很多列時各股各自等自己的車模。
 async function setFleet(rows){
  await Promise.all(rows.map(async(row,i)=>{const s=slots[i],same=s.model===row.model;s.state=row.state;s.model=row.model;s.mark=row.mark;
   if(same){applySlot(i);if(trains[i])showMark(trains[i],row.mark);return;}
   const ticket=++s.ticket;if(trains[i]){dropTrain(trains[i]);trains[i]=null;}applySlot(i);if(!row.model)return;
   let t;try{t=await makeTrain(i,row.model);}catch(e){if(e?.name!=='AbortError')console.error('roundhouse train',row.model,e);return;}
   if(disposed||ticket!==s.ticket){dropTrain(t);return;}
   trains[i]=t;seat(t);trainEnv(t);showMark(t,s.mark);applySlot(i);}));
 }

 // ── 轉場 ──
 const tws=new Set();let skipping=false;
 function play(d,fn,ease=x=>x){if(reduced)d=min(d,.2);if(skipping)d=0;return new Promise(res=>{tws.add({t0:performance.now(),d:d*1e3,fn,res,ease});dirty=true;wake();});}
 function rollTo(i,r,d=1.25,lamp){const t=trains[i];if(!t)return;const k=++t.tk,r0=t.r,l0=t.lamp;play(d,u=>{if(k!==t.tk)return;t.r=lerp(r0,r,u);placeTrain(t);if(lamp!==undefined){t.lamp=lerp(l0,lamp,u);lightUp(t);}},io);}
 function turnBridge(phi,d=1.3){const a0=bridgeA;let dl=((phi+PI-a0)%(2*PI)+2*PI)%(2*PI);if(dl>PI)dl-=2*PI;return play(d,u=>{bridgeA=a0+dl*u;placeBridge();},io);}

 // ── 鏡頭：goal 是這個畫面的基本位置，user 是手勢疊上去的量，換畫面時歸零 ──
 const cam={tx:0,ty:3,tz:19,az:0,el:.6,rad:200,sx:0,sy:0,w:0},fix=new T.Vector3(11,2.4,-96),user={az:0,el:0,zoom:0,x:0,z:0};let camTk=0,W=1,H=1;
 const resetUser=()=>{user.az=user.el=user.zoom=user.x=user.z=0;};
 function camTo(goal,d,ease=io){const tk=++camTk,a={...cam},daz=goal.az===undefined?0:((goal.az-a.az+PI)%(2*PI)+2*PI)%(2*PI)-PI;
  return play(d,u=>{if(tk!==camTk)return;for(const k in goal)cam[k]=lerp(a[k],goal[k],u);cam.az=a.az+daz*u;},ease);}
 const halfTan=()=>tan(camera.fov*PI/360);
 function overviewGoal(){const{top,bottom}=layout(),aH=max(120,H-top-bottom),aW=W-20,ht=halfTan(),needW=W<H?60:82,needH=56,rad=max(needW/(2*ht*(W/H))*(W/aW),needH/(2*ht)*(H/aH));
  return{tx:0,ty:2,tz:W<H?21:19,az:0,el:W<H?.78:.6,rad,sx:0,sy:(bottom-top)/2,w:0};}
 function focusGoal(i){const{side:fw,under:fh,narrow}=layout(),phi=phiOf(i),has=!!(trains[i]&&trains[i].g.visible),hr=has?R_FOCUS+4.7:RD+2,turn=i<3?-1:1,ht=halfTan(),aW=W-fw,aH=H-fh-44,need=has?11:15;
  const rad=max(need/(2*ht*(W/H))*(W/aW),(has?6.6:10)/(2*ht)*(H/aH));
  return{tx:sin(phi)*hr,ty:has?2.2:3.4,tz:cos(phi)*hr,az:-phi+turn*.62,el:has?.13:.2,rad,sx:fw/2,sy:narrow?(fh-44)/2:-22,w:0};}
 // 換外觀：拉近到車頭，看得到頭牌。
 function lookGoal(i){if(!trains[i]?.g.visible)return focusGoal(i);const{side:fw,under:fh}=layout(),phi=phiOf(i),turn=i<3?-1:1,hr=R_FOCUS+1.4,ht=halfTan(),rad=max(5.4/(2*ht*(W/H))*(W/(W-fw)),3.8/(2*ht)*(H/(H-fh-44)));
  return{...focusGoal(i),tx:sin(phi)*hr,ty:1.8,tz:cos(phi)*hr,az:-phi+turn*.34,el:.07,rad};}
 const tgt=new T.Vector3();
 function applyCam(){const az=cam.az+user.az,el=clamp(cam.el+user.el,.03,1.4),r=cam.rad/pow(2,user.zoom),tx=cam.tx+user.x,tz=cam.tz+user.z,cx=tx+r*cos(el)*sin(az),cy=cam.ty+r*sin(el),cz=tz-r*cos(el)*cos(az);
  camera.position.set(lerp(cx,fix.x,cam.w),lerp(cy,fix.y,cam.w),lerp(cz,fix.z,cam.w));camera.lookAt(tx,cam.ty,tz);
  const d=camera.position.distanceTo(tgt.set(tx,cam.ty,tz));camera.near=clamp(min(d*.25,camera.position.y*1.6),1,60);camera.setViewOffset(W,H,cam.sx,cam.sy,W,H);scene.fog.near=d+70;scene.fog.far=d+820;}
 function resize(){const r=canvas.getBoundingClientRect();W=max(1,r.width);H=max(1,r.height);camera.aspect=W/H;camera.fov=W<H?36:30;camera.updateProjectionMatrix();renderer.setSize(W,H,false);
  if(!busy)Object.assign(cam,view==='overview'?overviewGoal():looking?lookGoal(cur):focusGoal(cur));dirty=true;wake();}

 // ── 選車 ──
 function select(i){if(busy||i===cur)return;const prev=cur;cur=i;view='focus';looking=false;resetUser();if(prev>=0&&prev!==i)rollTo(prev,R_PARK,1.25,0);
  const has=!!(trains[i]&&trains[i].g.visible);if(has)rollTo(i,R_FOCUS,1.45,.75);turnBridge(phiOf(i));
  key.intensity=0;camTo(focusGoal(i),1.55).then(()=>{if(cur===i&&has&&view==='focus'){const a=phiOf(i),r=R_FOCUS+3;key.position.set(sin(a)*(r-9),10,cos(a)*(r-9));key.target.position.set(sin(a)*(r+1),1.4,cos(a)*(r+1));key.target.updateMatrixWorld();key.intensity=THEMES[theme].key;dirty=true;wake();}});}
 function back(){if(busy)return;if(cur>=0)rollTo(cur,R_PARK,1.25,0);cur=-1;view='overview';looking=false;resetUser();key.intensity=0;camTo(overviewGoal(),1.5);}
 function look(on){if(busy||cur<0||looking===on)return;looking=on;resetUser();camTo(on?lookGoal(cur):focusGoal(cur),1.1);}
 // 看著的這一股換了車（剛排進來、刪掉）：鏡頭照新的狀況重新對一次。
 function refocus(){if(busy||cur<0)return;const i=cur;cur=-1;select(i);}

 // ── 發車：號誌、開上轉車台、對準出庫線、開出去。caption 給畫面上的字；車開遠了叫 onLeave，頁面從那時淡到地圖 ──
 async function depart(i,caption=()=>{},onLeave=()=>{}){const t=trains[i];if(!t||busy)return false;busy=true;view='depart';skipping=false;resetUser();key.intensity=0;t.tk++;
  const narrow=layout().narrow,turn=i<3?-1:1,phi=phiOf(i);
  caption('signal');signal(true);
  await Promise.all([play(1.2,u=>{t.lamp=lerp(.75,1,u);lightUp(t);}),camTo({tx:sin(phi)*(t.r+1),ty:2.4,tz:cos(phi)*(t.r+1),az:-phi+turn*.9,el:.2,rad:narrow?52:36,sx:0,sy:0},1.2)]);
  caption('onto');const r0=t.r,r1=-t.half;t.tail.visible=true;
  await Promise.all([play(5,u=>{t.r=lerp(r0,r1,u);placeTrain(t);},io),camTo({tx:0,ty:2.2,tz:0,az:-phi+turn*1.25,el:.3,rad:narrow?96:60},5)]);
  caption('align');const b0=bridgeA,p0=t.phi;
  await Promise.all([play(2.6,u=>{t.phi=p0*(1-u);bridgeA=b0-p0*u;placeBridge();placeTrain(t);},io),camTo({az:turn*1.05,el:.22,rad:narrow?90:56},2.6)]);
  caption('out');const c0={...cam};
  let left=false;
  await play(6.8,u=>{t.r=r1-430*pow(u,2.4);placeTrain(t);const zc=t.r+t.half,k=io(min(1,u*2.2));cam.tz=lerp(c0.tz,zc,k);cam.w=k;cam.ty=lerp(c0.ty,2,k);if(u>.72&&!left){left=true;onLeave();}});
  busy=false;skipping=false;return true;}
 function skip(){skipping=true;for(const t of tws)t.d=0;}

 // ── 點選與手勢：手勢照主地圖（map-gestures.js），單點換車 ──
 const ray=new T.Raycaster(),hits=[];for(let i=0;i<TRACKS;i++){const a=phiOf(i),b=new T.Mesh(new T.BoxGeometry(5.6,9,36),new T.MeshBasicMaterial());b.position.set(...P(R_PARK+15,a,4.5));b.rotation.y=a;b.userData.i=i;b.visible=false;b.updateMatrixWorld();scene.add(b);hits.push(b);}
 function pick(x,y){const r=canvas.getBoundingClientRect(),v=new T.Vector2((x-r.left)/r.width*2-1,-(y-r.top)/r.height*2+1);camera.updateMatrixWorld();ray.setFromCamera(v,camera);const h=ray.intersectObjects(hits,false)[0];return h?h.object.userData.i:-1;}
 let press=null;
 const onDown=e=>{press={x:e.clientX,y:e.clientY,moved:0};};
 const onMove=e=>{if(press)press.moved=max(press.moved,abs(e.clientX-press.x)+abs(e.clientY-press.y));else if(e.pointerType==='mouse'&&!busy)canvas.classList.toggle('hot',pick(e.clientX,e.clientY)>=0);};
 const onUp=e=>{const p=press;press=null;if(!p||p.moved>=6||busy)return;onPick(pick(e.clientX,e.clientY));};
 canvas.addEventListener('pointerdown',onDown);canvas.addEventListener('pointermove',onMove);canvas.addEventListener('pointerup',onUp);canvas.addEventListener('pointercancel',()=>{press=null;});
 const lens={
  begin(){},
  zoomLevel:()=>[user.zoom,-.4,1.8],
  apply({pan,zoom=0,bearing=0,pitch=0}){if(busy)return;
   user.zoom=clamp(user.zoom+zoom,-.4,1.8);user.az=clamp(user.az+bearing*PI/180,-1.1,1.1);user.el=clamp(user.el-pitch*PI/180,-.5,.5);
   if(pan){const d=cam.rad/pow(2,user.zoom),m=2*d*halfTan()/H,az=cam.az+user.az,el=clamp(cam.el+user.el,.2,1.4);
    // 地面跟著手指走：往右拖＝鏡頭往左；往下拖＝鏡頭往畫面上方（仰角低時地面壓縮，要除回來）。
    const rx=cos(az),rz=sin(az),fx=-sin(az),fz=cos(az),dy=pan[1]/sin(el);
    user.x=clamp(user.x+(-pan[0]*rx+dy*fx)*m,-44,44);user.z=clamp(user.z+(-pan[0]*rz+dy*fz)*m,-44,44);}
   dirty=true;wake();},
 };
 const gestures=attachMapGestures(canvas,lens);
 const onLostContext=e=>{e.preventDefault();lost=true;onLost();};canvas.addEventListener('webglcontextlost',onLostContext);

 // ── 主迴圈：有轉場或有變動才畫 ──
 function wake(){if(!raf&&!disposed&&!lost)raf=requestAnimationFrame(tick);}
 function tick(now){raf=0;let moving=false;for(const t of tws){const u=t.d?min(1,(now-t.t0)/t.d):1;t.fn(t.ease(max(0,u)));moving=true;if(u>=1){tws.delete(t);t.res();}}
  if(disposed)return; // 發車尾段的回呼可能當場關頁（減少動態時沒有淡出）
  if(moving||dirty){dirty=false;applyCam();if(shadowDirty&&!lite){renderer.shadowMap.needsUpdate=true;}shadowDirty=false;renderer.render(scene,camera);}
  if(tws.size||dirty)wake();}

 for(let i=0;i<TRACKS;i++)applySlot(i);
 setTheme('day');resize();Object.assign(cam,overviewGoal());applyCam();
 return{
  setFleet,setTheme,select,back,look,refocus,depart,skip,resize,
  get view(){return view;},get busy(){return busy;},get current(){return cur;},
  markOf:i=>trains[i]?.mark.id, // 測試用：這一股車頭掛的牌。
  info:()=>({calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries}),
  // 測試用：把這一幀立刻畫出來，不等下一個 requestAnimationFrame。
  frame(){applyCam();if(!lite)renderer.shadowMap.needsUpdate=true;renderer.render(scene,camera);},
  dispose(){disposed=true;cancelAnimationFrame(raf);signal0.abort();gestures.stop();for(const t of markTex.values())t.dispose();canvas.removeEventListener('webglcontextlost',onLostContext);
   canvas.removeEventListener('pointerdown',onDown);canvas.removeEventListener('pointermove',onMove);canvas.removeEventListener('pointerup',onUp);
   for(let i=0;i<TRACKS;i++){slots[i].ticket++;if(trains[i]){dropTrain(trains[i]);trains[i]=null;}}
   const seen=new Set();scene.traverse(o=>{o.geometry?.dispose();for(const m of [].concat(o.material||[])){if(seen.has(m))continue;seen.add(m);for(const v of Object.values(m))if(v?.isTexture)v.dispose();m.dispose();}});
   for(const n in envs)envs[n].dispose();pmrem.dispose();renderer.dispose();renderer.forceContextLoss();},
 };
}
