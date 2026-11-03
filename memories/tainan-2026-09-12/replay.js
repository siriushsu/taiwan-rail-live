import * as THREE from './vendor/three.module.js';
import {makePath,formationPoses} from './vendor/train-path.js';
import {createWenhuGeometry,createWenhuMaterial} from './vendor/mesh.js';
import {buildRoads,ROAD} from './roads.js';
import {attachMapGestures} from './map-gestures.js';
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
 const [data,fleet,stationMeta,uncertainty,surroundingsMeta]=await Promise.all([json('snapshot.json'),json('fleet/catalog.json'),json('station/model.json'),json('uncertainty.json'),json('surroundings/model.json')]);
 const host=$('scene'),renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor('#e5e7dc');renderer.outputColorSpace=THREE.SRGBColorSpace;host.prepend(renderer.domElement);
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera();camera.up.set(0,0,1);camera.near=.1;camera.far=50000;
 scene.add(new THREE.HemisphereLight(0xffffff,0x788776,2));const sun=new THREE.DirectionalLight(0xfff3dc,2.2);sun.position.set(-600,-500,1000);scene.add(sun);
 const sx=111320*Math.cos(data.origin[1]*Math.PI/180),world=p=>[(p[0]-data.origin[0])*sx,(p[1]-data.origin[1])*111320];
 // 仰角 tilt：預設 atan2(6800,8000)≈40.4°（改版前固定的角度），可調 10°～89°；到 90° 相機 up 軸與視線平行，lookAt 會退化。
 const TILT0=Math.atan2(6800,8000),TILT_MIN=10*Math.PI/180,TILT_MAX=89*Math.PI/180;
 const target=new THREE.Vector3(0,0,0);let span=290,azimuth=3.6,tilt=TILT0,width=1,height=1,gestures=null,steering=false;
 // 標線只有 12～15 cm 寬：拉遠到一個像素超過約 0.3 m 就開始淡出、0.6 m 以上不畫，免得變成閃爍的細紋。
 let roadMeshes=null;function fadeMarkings(){if(!roadMeshes)return;const mpp=span/Math.max(1,height),o=Math.max(0,Math.min(1,(.6-mpp)/.3));for(const k of ['white','yellow']){roadMeshes[k].material.opacity=o;roadMeshes[k].visible=o>0;}}
 function view(){if(!steering)gestures?.halt();const aspect=width/height;camera.left=-span*aspect/2;camera.right=span*aspect/2;camera.top=span/2;camera.bottom=-span/2;tilt=Math.min(TILT_MAX,Math.max(TILT_MIN,tilt));const r=Math.cos(tilt)*10500;camera.position.copy(target).add(new THREE.Vector3(Math.cos(azimuth)*r,Math.sin(azimuth)*r,Math.sin(tilt)*10500));camera.lookAt(target);camera.updateProjectionMatrix();camera.updateMatrixWorld();fadeMarkings();}
 new ResizeObserver(()=>{width=host.clientWidth;height=host.clientHeight;renderer.setSize(width,height,false);view();}).observe(host);
 function meshBox(x,y,z,w,d,h,color){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,d,h),new THREE.MeshStandardMaterial({color,roughness:.9}));mesh.position.set(x,y,z+h/2);scene.add(mesh);return mesh;}
 meshBox(0,-3800,-2,15000,20000,1,'#e5e7dc');
 // 靜態量體依顏色合併成一批：原本每棟房子、每條路各一個 mesh，全線視圖每幀 600 多次繪製指令，手機吃不消。
 const batches=new Map();function batch(g,color,roughness){g=g.index?g.toNonIndexed():g;const key=color+'|'+roughness;if(!batches.has(key))batches.set(key,{color,roughness,parts:[]});batches.get(key).parts.push(g);}
 function flushBatches(){for(const {color,roughness,parts} of batches.values()){const n=parts.reduce((a,g)=>a+g.attributes.position.array.length,0),pos=new Float32Array(n),nrm=new Float32Array(n);let o=0;for(const g of parts){pos.set(g.attributes.position.array,o);nrm.set(g.attributes.normal.array,o);o+=g.attributes.position.array.length;g.dispose();}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('normal',new THREE.BufferAttribute(nrm,3));scene.add(new THREE.Mesh(g,new THREE.MeshStandardMaterial({color,roughness,side:roughness===1?THREE.DoubleSide:THREE.FrontSide})));}batches.clear();}
 function polygon(coords,z,h,color){if(coords.length<4)return;const shape=new THREE.Shape();coords.forEach((p,i)=>{const [x,y]=world(p);i?shape.lineTo(x,y):shape.moveTo(x,y);});const g=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false});g.translate(0,0,z);batch(g,color,.94);}
 function ribbons(lines,w,z,color){const vertices=[];for(const coords of lines)for(let i=1;i<coords.length;i++){const a=world(coords[i-1]),b=world(coords[i]),dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(!len)continue;const x=-dy/len*w/2,y=dx/len*w/2;vertices.push(a[0]+x,a[1]+y,z,a[0]-x,a[1]-y,z,b[0]+x,b[1]+y,z,b[0]+x,b[1]+y,z,a[0]-x,a[1]-y,z,b[0]-x,b[1]-y,z);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.computeVertexNormals();batch(g,color,1);}
 const stationId=stationMeta.osmId,surroundingIds=new Set(surroundingsMeta.buildings.map(b=>b.id));   // 周邊建物已改用 surroundings/ 的低細節網格，這裡只剩網格沒收的建物才退回舊的灰色擠出
 for(const f of data.features){
  if(f.tags.highway)continue;   // 馬路改由 roads.js 畫（柏油、標線、人行道）
  if(f.tags.railway==='platform')polygon(f.coordinates,.06,.82,'#bcbcb0');
  else if(f.tags.building==='roof')polygon(f.coordinates,5.0,.20,'#b6bdb4');   // 雨棚板底 5.0 m：高過最高的車（E500 降弓頂 4.44 m），低於電梯橋面 5.6 m
  // 跨站橋（building=bridge）懸在軌道上方，只畫橋面；當成一般房子從地面擠出會變成列車穿過的實心方塊。
  else if(f.tags.building==='bridge')polygon(f.coordinates,5.6,.5,'#d4d5ca');
  else if(f.tags.building&&!surroundingIds.has(f.id)&&f.id!==stationId&&!f.tags.construction&&f.tags.building!=='construction')polygon(f.coordinates,.03,Math.min(24,Math.max(3,parseFloat(f.tags.height)||parseFloat(f.tags['building:levels'])*3||6)),'#d4d5ca');
 }
 ribbons(data.rails.map(r=>r.coordinates),3.6,.05,'#aaa99b');flushBatches();
 const railVertices=[];for(const r of data.rails)for(let i=1;i<r.coordinates.length;i++){const a=world(r.coordinates[i-1]),b=world(r.coordinates[i]),dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(!len)continue;for(const side of [-1,1]){const ox=-dy/len*.5335*side,oy=dx/len*.5335*side;railVertices.push(a[0]+ox,a[1]+oy,.13,b[0]+ox,b[1]+oy,.13);}}
 const railGeo=new THREE.BufferGeometry();railGeo.setAttribute('position',new THREE.Float32BufferAttribute(railVertices,3));scene.add(new THREE.LineSegments(railGeo,new THREE.LineBasicMaterial({color:'#515d56'})));
 // 馬路：柏油、標線、人行道（roads.js；只用封存快照的 OSM 道路標籤，是示意、不是實地測繪）。每一層一個網格，共 5 次繪製。
 // 標線與路面只差 1.5 cm，低仰角時深度解析度不夠，用 polygonOffset 把標線往前推；標線半透明（淡出用）、不寫深度。
 const roads=buildRoads(data.features,world,data.rails.map(r=>r.coordinates.map(world)));roadMeshes={};
 for(const [name,l] of Object.entries(roads.layers)){const g=new THREE.BufferGeometry(),line=name==='white'||name==='yellow';g.setAttribute('position',new THREE.BufferAttribute(l.position,3));g.setAttribute('normal',new THREE.BufferAttribute(l.normal,3));
  const mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:ROAD.colors[name],roughness:line?.75:.95,metalness:0,transparent:line,depthWrite:!line,polygonOffset:line,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));mesh.name='road-'+name;scene.add(mesh);roadMeshes[name]=mesh;}
 fadeMarkings();
 const [stationRaw,surroundingsRaw]=await Promise.all([bytes('station/near.mesh.bin'),bytes('surroundings/near.mesh.bin')]),stationData=new Float32Array(stationRaw),buffer=new THREE.InterleavedBuffer(stationData,6),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(buffer,3,0));geometry.setAttribute('normal',new THREE.InterleavedBufferAttribute(buffer,3,3));const materials=[];
 for(const [i,g] of stationMeta.lods.near.drawGroups.entries()){geometry.addGroup(g.start,g.count,i);materials.push(new THREE.MeshStandardMaterial({color:new THREE.Color(...g.color),roughness:g.roughness,metalness:g.metalness}));}
 const building=new THREE.Mesh(geometry,materials);const stationXY=world(stationMeta.anchor);building.position.set(...stationXY,.04);building.rotation.z=stationMeta.rotationDeg*Math.PI/180;scene.add(building);
 // 周邊建物（低細節）：與站房同格式（Float32 交錯 stride 6、每種材質一個 drawGroup）；座標已是世界公尺（同 world()），網格放在 (0,0,0)、不旋轉。
 const surroundingsGeometry=new THREE.BufferGeometry(),surroundingsBuffer=new THREE.InterleavedBuffer(new Float32Array(surroundingsRaw),6),surroundingsMaterials=[];surroundingsGeometry.setAttribute('position',new THREE.InterleavedBufferAttribute(surroundingsBuffer,3,0));surroundingsGeometry.setAttribute('normal',new THREE.InterleavedBufferAttribute(surroundingsBuffer,3,3));
 for(const [i,g] of surroundingsMeta.lods.near.drawGroups.entries()){surroundingsGeometry.addGroup(g.start,g.count,i);surroundingsMaterials.push(new THREE.MeshStandardMaterial({color:new THREE.Color(...g.color),roughness:g.roughness,metalness:g.metalness}));}
 const surroundings=new THREE.Mesh(surroundingsGeometry,surroundingsMaterials);surroundings.position.set(0,0,0);scene.add(surroundings);
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
 function stationView(){state.follow='';$('train').value='';target.set(stationXY[0]+18,stationXY[1],0);span=140;azimuth=3.6;tilt=TILT0;view();}
 $('station').onclick=stationView;$('overview').onclick=()=>{state.follow='';$('train').value='';target.set(400,-3250,0);span=10500;view();};
 $('rotate').onclick=()=>{azimuth+=Math.PI/4;view();};$('zoomin').onclick=()=>{span=Math.max(34,span/1.5);view();};$('zoomout').onclick=()=>{span=Math.min(14000,span*1.5);view();};
 $('timeline').oninput=e=>jump(Number(e.target.value));$('time').onchange=e=>{const [h,m,s=0]=e.target.value.split(':').map(Number);jump(h*3600+m*60+s);};
 $('play').onclick=()=>{state.playing=!state.playing;$('play').textContent=state.playing?'暫停':'播放';$('play').setAttribute('aria-label',state.playing?'暫停重播':'播放重播');};
 $('speed').onchange=e=>state.speed=Number(e.target.value);
 $('next').onclick=()=>{const next=byArrival.find(tr=>tr.stops.find(s=>s.name.replace('台','臺')==='臺南').arrSec>state.sec+25)||byArrival[0];jump(next.stops.find(s=>s.name.replace('台','臺')==='臺南').arrSec-25);stationView();};
 $('train').onchange=e=>{state.follow=e.target.value;if(!state.follow)return;const tr=data.trains.find(t=>t.id===state.follow);if(!sample(tr,state.sec))jump(tr.spans[0].start);span=330;$('caption').textContent=tr.train+' 次 · '+tr.formation.caption+' · 依封存班表推演';};
 $('about').onclick=()=>{$('details').showModal();};
 // 手勢、滑鼠照網頁主地圖（map-gestures.js，同 MapLibre 5.9.0 的做法與常數）：單指、左鍵拖曳平移，地面跟著手指；右鍵或 Ctrl＋左鍵拖曳左右轉向（轉盤式）、
 // 往上拖鏡頭放低；雙指同時平移、捏合、扭轉，都繞兩指中點；兩指一起上下推改傾斜；滾輪以游標為準縮放；雙擊、雙點放大，雙指點一下縮小；放手有慣性。
 // 按下就取消跟車，鏡頭停在當下的位置；跟車中滾輪照舊以畫面中心（那班車）縮放。傾斜、縮放的範圍照舊；按鈕改鏡頭時停掉慣性（view() 開頭）。
 // 畫面上 (sx,sy)（畫面中心起算、y 向下）對到地面 right·sx·u − forward·sy·u／sin(仰角)，u＝span／畫面高。
 const ground=(x,y)=>{const sx=x-width/2,sy=y-height/2,u=span/height,k=u/Math.max(.05,Math.sin(tilt));return [-Math.sin(azimuth)*sx*u+Math.cos(azimuth)*sy*k,Math.cos(azimuth)*sx*u+Math.sin(azimuth)*sy*k];};
 gestures=attachMapGestures(renderer.domElement,{begin(){state.follow='';$('train').value='';},zoomLevel:()=>[-Math.log2(span),-Math.log2(14000),-Math.log2(34)],
  apply({pan,zoom=0,bearing=0,pitch=0,around}){
   const at=around||[width/2,height/2];let held;
   if(!state.follow&&(pan||around)){const g=ground(at[0]-(pan?.[0]||0),at[1]-(pan?.[1]||0));held=[target.x+g[0],target.y+g[1]];}
   azimuth-=bearing*Math.PI/180;tilt=Math.min(TILT_MAX,Math.max(TILT_MIN,tilt-pitch*Math.PI/180));span=Math.max(34,Math.min(14000,span/2**zoom));
   if(held){const g=ground(at[0],at[1]);target.set(held[0]-g[0],held[1]-g[1],0);}
   steering=true;view();steering=false;}});
 let last=performance.now(),lastSecond=-1;const active=[];
 function draw(now){requestAnimationFrame(draw);const dt=Math.min(.1,(now-last)/1000);last=now;if(document.hidden)return;if(state.nearReady)setLod(span<fleet.lod.nearBelowSpan?'near':span>fleet.lod.farAboveSpan?'far':state.lod);if(state.playing&&!$('details').open)state.sec=(state.sec+dt*state.speed)%86400;active.length=0;
  const uncertain=new Set(uncertainty.intervals.filter(i=>state.sec>=i.start&&state.sec<=i.end).flatMap(i=>i.trains));
  for(const tr of data.trains){const m=models.get(tr.id),p=sample(tr,state.sec);m.group.visible=!!p&&!uncertain.has(tr.id);m.label.coordinate=p?.coordinate||null;m.label.e.classList.toggle('uncertain',uncertain.has(tr.id));if(!p)continue;const poses=formationPoses(p.path,p.s,1,m.parts,()=>.16);if(!poses){m.group.visible=false;m.label.coordinate=null;continue;}active.push({id:tr.id,train:tr.train,direction:tr.direction,route:p.route,s:p.s,coordinate:p.coordinate,trackUncertain:uncertain.has(tr.id)});poses.forEach((pose,i)=>{const xy=world(pose.coordinate);m.cars[i].position.set(...xy,pose.height);m.cars[i].rotation.z=pose.angle;});if(state.follow===tr.id){target.set(...world(p.coordinate),0);view();}}
  const occupied=[];for(const l of labels){if(!l.coordinate){l.e.hidden=true;continue;}const xy=world(l.coordinate),p=new THREE.Vector3(...xy,7).project(camera),x=(p.x*.5+.5)*width,y=(-p.y*.5+.5)*height;const visible=p.z>=-1&&p.z<=1&&x>0&&x<width&&y>55&&y<height-30;l.e.hidden=!visible;if(visible){l.e.style.transform=`translate(${x}px,${y}px) translate(-50%,-100%)`;if(!l.e.classList.contains('train-label')){const b=l.e.getBoundingClientRect();if(occupied.some(a=>b.left<a.right&&b.right>a.left&&b.top<a.bottom&&b.bottom>a.top))l.e.hidden=true;else occupied.push(b);}}}
  renderer.render(scene,camera);state.frames++;if(Math.floor(state.sec)!==lastSecond){lastSecond=Math.floor(state.sec);updateTime();$('running').textContent='區間內 '+active.length+' 班';const pending=active.filter(t=>t.trackUncertain),follow=data.trains.find(t=>t.id===state.follow);$('caption').textContent=pending.length?'股道安排待確認：'+pending.map(t=>t.train).join('、')+' 次暫以車次標記呈現；位置仍依封存班表推演。':follow?follow.train+' 次 · '+follow.formation.caption+' · 依封存班表推演':'封存 '+data.trains.length+' 班 · 班表推演，非即時位置；未知編組採 3 節示意。';$('caption').classList.toggle('uncertain',!!pending.length);}}
 // 可重現的驗收介面：封存資料、時間與車廂沿軌座標均可核對，無外部寫入。
 window.tainanMemory={state,data,sample,paths,models,active,jump,stationView,renderer,camera,uncertainty,fleet,wrap,surroundings:{mesh:surroundings,meta:surroundingsMeta},roads:{meshes:roadMeshes,stats:roads.stats,ways:roads.ways}};stationView();updateTime();state.ready=true;status.hidden=true;requestAnimationFrame(draw);loadLod('near').then(()=>{state.nearReady=true;},e=>console.error(e));
}catch(error){console.error(error);status.replaceChildren();const p=document.createElement('p');p.textContent='這份回憶暫時無法載入：'+error.message;const retry=document.createElement('button');retry.textContent='重新載入';retry.onclick=()=>location.reload();status.append(p,retry);}
