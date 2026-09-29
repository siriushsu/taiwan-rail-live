import * as THREE from './vendor/three.module.js';
import {makePath,formationPoses} from './vendor/train-path.js';
import {createWenhuGeometry,createWenhuMaterial} from './vendor/mesh.js';
const $=id=>document.getElementById(id), status=$('loading');
const state={ready:false,nearReady:false,lod:'far',sec:28800,playing:true,speed:10,follow:'',frames:0};
const clock=sec=>[Math.floor(sec/3600),Math.floor(sec/60)%60,Math.floor(sec)%60].map(v=>String(v).padStart(2,'0')).join(':');
const cleanSec=s=>Math.max(0,Math.min(86399,Number.isFinite(s)?s:28800));
const query=new URLSearchParams(location.search),timeQuery=query.get('t');
if(timeQuery&&/^\d{1,2}:\d{2}(:\d{2})?$/.test(timeQuery)){const [h,m,s=0]=timeQuery.split(':').map(Number);state.sec=cleanSec(h*3600+m*60+s);}
let integrity;
// 網格以 .bin.gz 存放（Cloudflare 不壓 octet-stream，未壓縮要多下載約 9 MB）；解壓後仍比對原始 .bin 的封存雜湊。
async function gunzip(b){try{if(typeof DecompressionStream==='function')return await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();}catch{}const {gunzipSync}=await import('./vendor/fflate-gunzip.js'),a=gunzipSync(new Uint8Array(b));return a.buffer.slice(a.byteOffset,a.byteOffset+a.byteLength);}
async function bytes(file){let b;const gz=file.endsWith('.bin');for(let attempt=0;attempt<3;attempt++){try{const r=await fetch(new URL(gz?file+'.gz':file,import.meta.url));if(!r.ok)throw Error('HTTP '+r.status);b=await r.arrayBuffer();if(gz)b=await gunzip(b);break;}catch(e){if(attempt===2)throw Error('無法讀取封存檔案 '+file+'：'+e.message);await new Promise(resolve=>setTimeout(resolve,200*(attempt+1)));}}if(integrity?.files[file]){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==integrity.files[file])throw Error('封存檔案版本不一致：'+file);}return b;}
const json=async f=>JSON.parse(new TextDecoder().decode(await bytes(f)));
try{
 integrity=await json('integrity.json');
 const [data,fleet,stationMeta,uncertainty]=await Promise.all([json('snapshot.json'),json('fleet/catalog.json'),json('station/model.json'),json('uncertainty.json')]);
 const host=$('scene'),renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor('#e5e7dc');renderer.outputColorSpace=THREE.SRGBColorSpace;host.prepend(renderer.domElement);
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera();camera.up.set(0,0,1);camera.near=.1;camera.far=50000;
 scene.add(new THREE.HemisphereLight(0xffffff,0x788776,2));const sun=new THREE.DirectionalLight(0xfff3dc,2.2);sun.position.set(-600,-500,1000);scene.add(sun);
 const sx=111320*Math.cos(data.origin[1]*Math.PI/180),world=p=>[(p[0]-data.origin[0])*sx,(p[1]-data.origin[1])*111320];
 const target=new THREE.Vector3(0,0,0);let span=290,azimuth=3.6,width=1,height=1;
 function view(){const aspect=width/height;camera.left=-span*aspect/2;camera.right=span*aspect/2;camera.top=span/2;camera.bottom=-span/2;camera.position.copy(target).add(new THREE.Vector3(Math.cos(azimuth)*8000,Math.sin(azimuth)*8000,6800));camera.lookAt(target);camera.updateProjectionMatrix();camera.updateMatrixWorld();}
 new ResizeObserver(()=>{width=host.clientWidth;height=host.clientHeight;renderer.setSize(width,height,false);view();}).observe(host);
 function meshBox(x,y,z,w,d,h,color){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,d,h),new THREE.MeshStandardMaterial({color,roughness:.9}));mesh.position.set(x,y,z+h/2);scene.add(mesh);return mesh;}
 meshBox(0,-3800,-2,15000,20000,1,'#e5e7dc');
 // 靜態量體依顏色合併成一批：原本每棟房子、每條路各一個 mesh，全線視圖每幀 600 多次繪製指令，手機吃不消。
 const batches=new Map();function batch(g,color,roughness){g=g.index?g.toNonIndexed():g;const key=color+'|'+roughness;if(!batches.has(key))batches.set(key,{color,roughness,parts:[]});batches.get(key).parts.push(g);}
 function flushBatches(){for(const {color,roughness,parts} of batches.values()){const n=parts.reduce((a,g)=>a+g.attributes.position.array.length,0),pos=new Float32Array(n),nrm=new Float32Array(n);let o=0;for(const g of parts){pos.set(g.attributes.position.array,o);nrm.set(g.attributes.normal.array,o);o+=g.attributes.position.array.length;g.dispose();}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('normal',new THREE.BufferAttribute(nrm,3));scene.add(new THREE.Mesh(g,new THREE.MeshStandardMaterial({color,roughness,side:roughness===1?THREE.DoubleSide:THREE.FrontSide})));}batches.clear();}
 function polygon(coords,z,h,color){if(coords.length<4)return;const shape=new THREE.Shape();coords.forEach((p,i)=>{const [x,y]=world(p);i?shape.lineTo(x,y):shape.moveTo(x,y);});const g=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false});g.translate(0,0,z);batch(g,color,.94);}
 function ribbons(lines,w,z,color){const vertices=[];for(const coords of lines)for(let i=1;i<coords.length;i++){const a=world(coords[i-1]),b=world(coords[i]),dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(!len)continue;const x=-dy/len*w/2,y=dx/len*w/2;vertices.push(a[0]+x,a[1]+y,z,a[0]-x,a[1]-y,z,b[0]+x,b[1]+y,z,b[0]+x,b[1]+y,z,a[0]-x,a[1]-y,z,b[0]-x,b[1]-y,z);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.computeVertexNormals();batch(g,color,1);}
 const stationId=stationMeta.osmId;
 for(const f of data.features){
  if(f.tags.highway)ribbons([f.coordinates],{primary:15,secondary:12,tertiary:9}[f.tags.highway]||6,.015,'#f7f5ee');
  else if(f.tags.railway==='platform')polygon(f.coordinates,.06,.82,'#bcbcb0');
  else if(f.tags.building==='roof')polygon(f.coordinates,5.0,.20,'#b6bdb4');   // 雨棚板底 5.0 m：高過最高的車（E500 降弓頂 4.44 m），低於電梯橋面 5.6 m
  // 跨站橋（building=bridge）懸在軌道上方，只畫橋面；當成一般房子從地面擠出會變成列車穿過的實心方塊。
  else if(f.tags.building==='bridge')polygon(f.coordinates,5.6,.5,'#d4d5ca');
  else if(f.tags.building&&f.id!==stationId&&!f.tags.construction&&f.tags.building!=='construction')polygon(f.coordinates,.03,Math.min(24,Math.max(3,parseFloat(f.tags.height)||parseFloat(f.tags['building:levels'])*3||6)),'#d4d5ca');
 }
 ribbons(data.rails.map(r=>r.coordinates),3.6,.05,'#aaa99b');flushBatches();
 const railVertices=[];for(const r of data.rails)for(let i=1;i<r.coordinates.length;i++){const a=world(r.coordinates[i-1]),b=world(r.coordinates[i]),dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(!len)continue;for(const side of [-1,1]){const ox=-dy/len*.5335*side,oy=dx/len*.5335*side;railVertices.push(a[0]+ox,a[1]+oy,.13,b[0]+ox,b[1]+oy,.13);}}
 const railGeo=new THREE.BufferGeometry();railGeo.setAttribute('position',new THREE.Float32BufferAttribute(railVertices,3));scene.add(new THREE.LineSegments(railGeo,new THREE.LineBasicMaterial({color:'#515d56'})));
 const stationData=new Float32Array(await bytes('station/near.mesh.bin')),buffer=new THREE.InterleavedBuffer(stationData,6),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(buffer,3,0));geometry.setAttribute('normal',new THREE.InterleavedBufferAttribute(buffer,3,3));const materials=[];
 for(const [i,g] of stationMeta.lods.near.drawGroups.entries()){geometry.addGroup(g.start,g.count,i);materials.push(new THREE.MeshStandardMaterial({color:new THREE.Color(...g.color),roughness:g.roughness,metalness:g.metalness}));}
 const building=new THREE.Mesh(geometry,materials);const stationXY=world(stationMeta.anchor);building.position.set(...stationXY,.04);building.rotation.z=stationMeta.rotationDeg*Math.PI/180;scene.add(building);
 // 9/12 當天二樓以上包著半透明施工外罩：另一份網格，與站房同位置，預設蓋上；「拿掉外罩」鈕可看整棟站房。
 // 半透明群組不寫深度：同一個 draw call 裡的三角形不排序，寫深度會讓先畫的那層布把後面的布整片擋掉（主棟外罩與翼樓重疊處會缺一塊）。
 const wrapMeta=stationMeta.lods.wrap;let wrap=null;
 if(wrapMeta){const d=new Float32Array(await bytes('station/'+wrapMeta.file)),b=new THREE.InterleavedBuffer(d,6),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.InterleavedBufferAttribute(b,3,0));g.setAttribute('normal',new THREE.InterleavedBufferAttribute(b,3,3));const mats=[];for(const [i,dg] of wrapMeta.drawGroups.entries()){g.addGroup(dg.start,dg.count,i);const o=dg.opacity??1;mats.push(new THREE.MeshStandardMaterial({color:new THREE.Color(...dg.color),roughness:dg.roughness,metalness:dg.metalness,transparent:o<1,opacity:o,depthWrite:o>=1,side:wrapMeta.doubleSided?THREE.DoubleSide:THREE.FrontSide}));}
  wrap=new THREE.Mesh(g,mats);wrap.position.copy(building.position);wrap.rotation.copy(building.rotation);wrap.visible=wrapMeta.defaultVisible!==false;scene.add(wrap);}
 const wrapButton=$('wrap'),syncWrap=()=>{wrapButton.textContent=wrap.visible?'拿掉外罩':'蓋回外罩';};
 if(wrap){syncWrap();wrapButton.onclick=()=>{wrap.visible=!wrap.visible;syncWrap();};}else wrapButton.hidden=true;
 // 車廂網格分兩級：遠景檔（約 90 KB）開機就載；近景檔（約 0.6 MB）首幀之後才在背景載入，載完 state.nearReady=true。
 // 車廂 1 單位＝1 公尺、一律不縮放；各車型真實連結器間距 pitchM 記在 fleet/catalog.json。
 const carMaterial=createWenhuMaterial(THREE),lodGeo={far:new Map(),near:new Map()},fleetMeshes=Object.entries(fleet.meshes);
 const loadLod=async kind=>{for(let i=0;i<fleetMeshes.length;i+=3)await Promise.all(fleetMeshes.slice(i,i+3).map(async([id,m])=>lodGeo[kind].set(id,createWenhuGeometry(THREE,{data:new Float32Array(await bytes('fleet/'+m[kind].file))}))));};
 await loadLod('far');
 const paths=data.routes.map(r=>makePath(r.coordinates)),models=new Map(),labels=[];
 function label(text,coordinate,kind=''){const e=document.createElement('span');e.className='map-label '+kind;e.textContent=text;$('labels').append(e);const item={e,coordinate};labels.push(item);return item;}
 data.stations.forEach(s=>label(s.name,[s.lon,s.lat]));label('臺南舊站房',stationMeta.anchor);
 // 依真實比例重排編組：每輛用該車型的連結器間距（pitchM）首尾相接，以編組中心為基準置中；車體不拉伸。
 // 逐輛網格與轉向來自 catalog 的 formations（EP 集電弓車、機車端客車…），輛數必須與封存班表的編組一致。
 // listedFor＝車序是照哪個方向的領頭車排的（EMU3000 1 號車在屏東／高雄端＝南下領頭）；反方向就整列倒過來、每輛轉 180°。
 function arrange(tr){const rule=fleet.formations[tr.formation.id];if(!rule||rule.cars.length!==tr.formation.parts.length)throw Error('缺少編組規則：'+tr.formation.id);
  const cars=rule.listedFor&&tr.direction!==rule.listedFor?rule.cars.slice().reverse().map(c=>({mesh:c.mesh,flip:!c.flip})):rule.cars;
  const parts=cars.map(c=>({mesh:c.mesh,flip:c.flip,lengthM:fleet.meshes[c.mesh].pitchM,offsetM:0}));let front=parts.reduce((a,c)=>a+c.lengthM,0)/2;for(const c of parts){c.offsetM=front-c.lengthM/2;front-=c.lengthM;}return parts;}
 for(const tr of data.trains){const group=new THREE.Group(),parts=arrange(tr),cars=parts.map(part=>{const car=new THREE.Group(),mesh=new THREE.Mesh(lodGeo.far.get(part.mesh),carMaterial);mesh.userData.mesh=part.mesh;if(part.flip)mesh.rotation.z=Math.PI;car.add(mesh);group.add(car);return car;});group.visible=false;scene.add(group);models.set(tr.id,{group,cars,parts,label:label(tr.train+' '+tr.direction,null,'train-label')});}
 // 近景／遠景切換：只換每輛車的 geometry（catalog.lod 有門檻，中間帶保持現狀，避免縮放時來回跳）。
 const setLod=next=>{if(next===state.lod)return;state.lod=next;for(const m of models.values())for(const car of m.cars){const mesh=car.children[0];mesh.geometry=lodGeo[next].get(mesh.userData.mesh);}};
 const byArrival=[...data.trains].sort((a,b)=>a.stops.find(s=>s.name.replace('台','臺')==='臺南').arrSec-b.stops.find(s=>s.name.replace('台','臺')==='臺南').arrSec);
 for(const tr of byArrival){const st=tr.stops.find(s=>s.name.replace('台','臺')==='臺南'),o=document.createElement('option');o.value=tr.id;o.textContent=clock(cleanSec(st.arrSec)).slice(0,5)+' · '+tr.train+' '+tr.typeName+' '+tr.direction;$('train').append(o);}
 function sample(tr,sec){const segment=tr.spans.find(s=>sec>=s.start&&sec<=s.start+s.s.length-1);if(!segment)return null;const f=sec-segment.start,i=Math.min(segment.s.length-1,Math.floor(f)),s=segment.s[i]+((segment.s[i+1]??segment.s[i])-segment.s[i])*(f-i),path=paths[segment.route],p=path.at(s);if(!p)return null;return {path,s,coordinate:p.coordinate,route:segment.route};}
 function updateTime(){const s=Math.floor(state.sec);$('clock').textContent=clock(s);$('timeline').value=s;if(document.activeElement!==$('time'))$('time').value=clock(s);}
 function jump(sec){state.sec=cleanSec(sec);updateTime();}
 function stationView(){state.follow='';$('train').value='';target.set(stationXY[0]+18,stationXY[1],0);span=140;azimuth=3.6;view();}
 $('station').onclick=stationView;$('overview').onclick=()=>{state.follow='';$('train').value='';target.set(400,-3250,0);span=10500;view();};
 $('rotate').onclick=()=>{azimuth+=Math.PI/4;view();};$('zoomin').onclick=()=>{span=Math.max(34,span/1.5);view();};$('zoomout').onclick=()=>{span=Math.min(14000,span*1.5);view();};
 $('timeline').oninput=e=>jump(Number(e.target.value));$('time').onchange=e=>{const [h,m,s=0]=e.target.value.split(':').map(Number);jump(h*3600+m*60+s);};
 $('play').onclick=()=>{state.playing=!state.playing;$('play').textContent=state.playing?'暫停':'播放';$('play').setAttribute('aria-label',state.playing?'暫停重播':'播放重播');};
 $('speed').onchange=e=>state.speed=Number(e.target.value);
 $('next').onclick=()=>{const next=byArrival.find(tr=>tr.stops.find(s=>s.name.replace('台','臺')==='臺南').arrSec>state.sec+25)||byArrival[0];jump(next.stops.find(s=>s.name.replace('台','臺')==='臺南').arrSec-25);stationView();};
 $('train').onchange=e=>{state.follow=e.target.value;if(!state.follow)return;const tr=data.trains.find(t=>t.id===state.follow);if(!sample(tr,state.sec))jump(tr.spans[0].start);span=330;$('caption').textContent=tr.train+' 次 · '+tr.formation.caption+' · 依封存班表推演';};
 $('about').onclick=()=>{$('details').showModal();};
 const pointers=new Map();let pinch=null;
 renderer.domElement.addEventListener('pointerdown',e=>{pointers.set(e.pointerId,[e.clientX,e.clientY]);renderer.domElement.setPointerCapture(e.pointerId);state.follow='';$('train').value='';});
 renderer.domElement.addEventListener('pointermove',e=>{const before=pointers.get(e.pointerId);if(!before)return;pointers.set(e.pointerId,[e.clientX,e.clientY]);if(pointers.size===2){const [a,b]=[...pointers.values()],d=Math.hypot(a[0]-b[0],a[1]-b[1]);if(pinch)span=Math.max(34,Math.min(14000,span*pinch/d));pinch=d;}else{const dx=(e.clientX-before[0])*span/height,dy=(e.clientY-before[1])*span/height;const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1);target.addScaledVector(right,-dx);target.addScaledVector(up,dy/Math.max(.1,Math.hypot(up.x,up.y)));target.z=0;}view();});
 for(const event of ['pointerup','pointercancel','lostpointercapture'])renderer.domElement.addEventListener(event,e=>{pointers.delete(e.pointerId);pinch=null;});
 renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();span=Math.max(34,Math.min(14000,span*Math.exp(e.deltaY*.001)));view();},{passive:false});
 let last=performance.now(),lastSecond=-1;const active=[];
 function draw(now){requestAnimationFrame(draw);const dt=Math.min(.1,(now-last)/1000);last=now;if(document.hidden)return;if(state.nearReady)setLod(span<fleet.lod.nearBelowSpan?'near':span>fleet.lod.farAboveSpan?'far':state.lod);if(state.playing&&!$('details').open)state.sec=(state.sec+dt*state.speed)%86400;active.length=0;
  const uncertain=new Set(uncertainty.intervals.filter(i=>state.sec>=i.start&&state.sec<=i.end).flatMap(i=>i.trains));
  for(const tr of data.trains){const m=models.get(tr.id),p=sample(tr,state.sec);m.group.visible=!!p&&!uncertain.has(tr.id);m.label.coordinate=p?.coordinate||null;m.label.e.classList.toggle('uncertain',uncertain.has(tr.id));if(!p)continue;const poses=formationPoses(p.path,p.s,1,m.parts,()=>.16);if(!poses){m.group.visible=false;m.label.coordinate=null;continue;}active.push({id:tr.id,train:tr.train,direction:tr.direction,route:p.route,s:p.s,coordinate:p.coordinate,trackUncertain:uncertain.has(tr.id)});poses.forEach((pose,i)=>{const xy=world(pose.coordinate);m.cars[i].position.set(...xy,pose.height);m.cars[i].rotation.z=pose.angle;});if(state.follow===tr.id){target.set(...world(p.coordinate),0);view();}}
  const occupied=[];for(const l of labels){if(!l.coordinate){l.e.hidden=true;continue;}const xy=world(l.coordinate),p=new THREE.Vector3(...xy,7).project(camera),x=(p.x*.5+.5)*width,y=(-p.y*.5+.5)*height;const visible=p.z>=-1&&p.z<=1&&x>0&&x<width&&y>55&&y<height-30;l.e.hidden=!visible;if(visible){l.e.style.transform=`translate(${x}px,${y}px) translate(-50%,-100%)`;if(!l.e.classList.contains('train-label')){const b=l.e.getBoundingClientRect();if(occupied.some(a=>b.left<a.right&&b.right>a.left&&b.top<a.bottom&&b.bottom>a.top))l.e.hidden=true;else occupied.push(b);}}}
  renderer.render(scene,camera);state.frames++;if(Math.floor(state.sec)!==lastSecond){lastSecond=Math.floor(state.sec);updateTime();$('running').textContent='區間內 '+active.length+' 班';const pending=active.filter(t=>t.trackUncertain),follow=data.trains.find(t=>t.id===state.follow);$('caption').textContent=pending.length?'股道安排待確認：'+pending.map(t=>t.train).join('、')+' 次暫以車次標記呈現；位置仍依封存班表推演。':follow?follow.train+' 次 · '+follow.formation.caption+' · 依封存班表推演':'封存 '+data.trains.length+' 班 · 班表推演，非即時位置；未知編組採 3 節示意。';$('caption').classList.toggle('uncertain',!!pending.length);}}
 // 可重現的驗收介面：封存資料、時間與車廂沿軌座標均可核對，無外部寫入。
 window.tainanMemory={state,data,sample,paths,models,active,jump,stationView,renderer,camera,uncertainty,fleet,wrap};stationView();updateTime();state.ready=true;status.hidden=true;requestAnimationFrame(draw);loadLod('near').then(()=>{state.nearReady=true;},e=>console.error(e));
}catch(error){console.error(error);status.replaceChildren();const p=document.createElement('p');p.textContent='這份回憶暫時無法載入：'+error.message;const retry=document.createElement('button');retry.textContent='重新載入';retry.onclick=()=>location.reload();status.append(p,retry);}
