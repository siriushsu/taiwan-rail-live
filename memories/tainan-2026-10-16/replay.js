import * as THREE from './vendor/three.module.js';
import {makePath,formationPoses} from './vendor/train-path.js';
import {createWenhuGeometry,createWenhuMaterial} from './vendor/mesh.js';
import {buildRoads,ROAD} from './roads.js';
import {attachMapGestures} from './map-gestures.js';
const $=id=>document.getElementById(id), status=$('loading');
const DEFAULT_SEC=79200,state={ready:false,nearReady:false,lod:'far',sec:DEFAULT_SEC,playing:true,speed:10,follow:'',frames:0};
const clock=sec=>[Math.floor(sec/3600),Math.floor(sec/60)%60,Math.floor(sec)%60].map(v=>String(v).padStart(2,'0')).join(':');
const cleanSec=s=>Math.max(0,Math.min(86399,Number.isFinite(s)?s:DEFAULT_SEC));
const query=new URLSearchParams(location.search),timeQuery=query.get('t');
// 沒帶 ?t= 時，開機後改用封存檔的 defaultSec（22:00）。
const timeGiven=!!timeQuery&&/^\d{1,2}:\d{2}(:\d{2})?$/.test(timeQuery);
if(timeGiven){const [h,m,s=0]=timeQuery.split(':').map(Number);state.sec=cleanSec(h*3600+m*60+s);}
// 「最後一夜」面板：寬版與橫向手機（高 520 以下）放在場景右側，直立的窄版接在場景下方。寬 900 以上與寬 700 以上的橫向手機預設展開，其餘預設收合；寬不到 700 的橫向手機收成場景右上角的按鈕（接在場景下方的話，場景底下放不下，面板會壓到重播控制）。使用者按過之後以按的為準，旋轉螢幕或改視窗大小不重設。
// 窄版點時間軸裡臺南站的事件會自動收合面板（goEvent）：這個收合記在 nightAuto，不算使用者的選擇，只在當下的版面有效；版面在側欄／非側欄之間切換時就失效，回到使用者按的或預設。
// 窄版展開時場景被壓到只剩一條，#scene 加 squeezed：CSS 把單線說明與操作提示先收起來，免得疊在視角按鈕與車次標籤上。
const sideLayout=matchMedia('(min-width:900px), (max-height:520px)'),openByDefault=matchMedia('(min-width:900px), (min-width:700px) and (max-height:520px)');let nightUser=null,nightAuto=null;
const nightOpen=()=>nightAuto??nightUser??openByDefault.matches;
function applyNight(){const n=$('night'),open=nightOpen();n.classList.toggle('open',open);n.classList.toggle('closed',!open);$('nightToggle').setAttribute('aria-expanded',String(open));$('scene').classList.toggle('squeezed',!sideLayout.matches&&open);}
const setNight=open=>{nightUser=open;nightAuto=null;applyNight();};
$('nightToggle').onclick=()=>setNight(!nightOpen());sideLayout.addEventListener('change',()=>{nightAuto=null;applyNight();});openByDefault.addEventListener('change',applyNight);applyNight();
let integrity;
// 網格以 .bin.gz 存放（Cloudflare 不壓 octet-stream，未壓縮要多下載約 9 MB）；解壓後仍比對原始 .bin 的封存雜湊。
async function gunzip(b){try{if(typeof DecompressionStream==='function')return await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();}catch{}const {gunzipSync}=await import('./vendor/fflate-gunzip.js'),a=gunzipSync(new Uint8Array(b));return a.buffer.slice(a.byteOffset,a.byteOffset+a.byteLength);}
async function bytes(file){let b;const gz=file.endsWith('.bin');for(let attempt=0;attempt<3;attempt++){try{const r=await fetch(new URL(gz?file+'.gz':file,import.meta.url));if(!r.ok)throw Error('HTTP '+r.status);b=await r.arrayBuffer();if(gz)b=await gunzip(b);break;}catch(e){if(attempt===2)throw Error('無法讀取封存檔案 '+file+'：'+e.message);await new Promise(resolve=>setTimeout(resolve,200*(attempt+1)));}}if(integrity?.files[file]){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==integrity.files[file])throw Error('封存檔案版本不一致：'+file);}return b;}
const json=async f=>JSON.parse(new TextDecoder().decode(await bytes(f)));
try{
 integrity=await json('integrity.json');
 const [data,fleet,stationMeta,uncertainty,surroundingsMeta,eventNotes]=await Promise.all([json('snapshot.json'),json('fleet/catalog.json'),json('station/model.json'),json('uncertainty.json'),json('surroundings/model.json'),json('event-notes.json')]);
 if(!timeGiven)state.sec=cleanSec(data.defaultSec??DEFAULT_SEC);
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
 // 站房模型（沿用 9/12 封存版）二樓以上包著半透明施工外罩：另一份網格，與站房同位置，預設蓋上；「拿掉外罩」鈕可看整棟站房。
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
 // ── 10/16 新增 ──
 // 新欄位（timing、mark、stops[].src／schedArrSec／holdSec、events、singleLine）一律用 ?. 防呆：缺欄位時只是少了旗標、時間軸與逐站時刻，頁面照常開。
 const SRC={obs:'實測',interp:'內插',sched:'表定',est:'推定'},DEP_SRC={obs:'est',interp:'interp',est:'est',sched:'sched'},isTainan=s=>s.name.replace('台','臺')==='臺南',tainanStop=tr=>tr.stops.find(isTainan),anchorStop=tr=>tainanStop(tr)||tr.stops[0];
 const MARK_LABEL={'last-ground':tr=>'地面最後一班 '+tr.train,'last-south':tr=>'最後南下・告別列車 '+tr.train},MARK_NAME={'last-ground':'地面最後一班','last-south':'最後南下・告別列車'};
 // 標籤上的來源旗標：整班沒有即時動態紀錄＝「無即時動態紀錄」；其餘看 anchorStop（臺南那一列，沒經過臺南的班次看第一列）的來源：實測／內插／推定／表定。
 // 起點站沒有到站，那一列的 src 記的是開車時刻的來源（看板紀錄的誤點分鐘推出來的＝推定）。沒有來源就不掛旗標，不預設成實測。
 function trainFlag(tr){if(tr.timing==='scheduled')return {key:'sched',text:'無即時動態紀錄'};if(!tr.timing)return null;const k=anchorStop(tr)?.src;return SRC[k]?{key:k,text:SRC[k]}:null;}
 // 終點是畫面裡的車站（data.stations：大橋、臺南、保安）的班次，標籤加「・終點○○」：重建的軌跡到站那一秒就結束，車會在月台上消失，先講明它開到這站為止。
 const viewStations=new Set(data.stations.map(s=>s.name.replace('台','臺'))),terminalOf=tr=>{const s=tr.stops.at(-1),n=s?.name.replace('台','臺');return s?.end==='terminal'&&viewStations.has(n)?n:null;};
 function trainLabel(tr){const e=document.createElement('span'),main=document.createElement('span'),flag=trainFlag(tr),end=terminalOf(tr);e.className='map-label train-label'+(MARK_LABEL[tr.mark]?' mark-'+tr.mark:'');main.className='lt';main.textContent=(MARK_LABEL[tr.mark]?MARK_LABEL[tr.mark](tr):tr.train+' '+tr.direction)+(end?'・終點'+end:'');e.append(main);
  if(MARK_LABEL[tr.mark])e.dataset.mark=tr.mark;if(flag){const f=document.createElement('span');f.className='flag flag-'+flag.key;f.textContent=flag.text;e.append(f);e.dataset.src=flag.key;}
  $('labels').append(e);const item={e,coordinate:null};labels.push(item);return item;}
 // 重點車的光暈，照主站列車光暈的散光做（rail-3d/integration/train-halo-style.js 的 HALO_STOPS 與 scatterCar、train-halo.js 的深度做法；封存目錄不引用主站檔，寫在這裡）：
 // 每節車兩片畫面上的橢圓柔光，透明度由中心往外漸淡到 0、沒有邊；第二片大一些、淡一些、往一側偏。大小、偏移、角度每節車固定一組（照車序算，不隨時間閃動）。
 // 主站的光是給遠看的小車用的，範圍大而淡；這裡是兩班重點車，橢圓外加的像素（GLOW_PAD_X／GLOW_PAD_Y）比主站小、濃度（GLOW_ALPHA）比主站高，光貼著車身。
 // 橢圓以畫面像素計、每幀照鏡頭重算（updateGlow），怎麼縮放、轉向、調仰角都一樣大；中心對準車身半高（離車底 GLOW_Z）。四個角投回離車底 GLOW_PLANE 的水平面上：高過月台雨棚頂（5.2 m），雨棚不會把光切出一條硬邊的色帶；比它高的天橋與建物照深度擋住它，地面也不會切掉它。
 // 柔光排在不透明物件裡、車身之前畫（renderOrder 1；車身 2），車身整個蓋過去：車身不會被染色，光只露在車身四周。
 // 混色只混顏色、不動畫布的 alpha（blendSrcAlpha 0、blendDstAlpha 1）：畫布帶 alpha 通道，照顏色那組係數混會讓光暈處的畫布變半透明，透出頁面底色，紅光變成粉白。
 // 貼圖直接算像素（RGB 全白，只有 alpha 照 HALO_STOPS 由中心淡出）：用 canvas 漸層當貼圖時，WebKit 畫出的光暈裡有一顆顆暗點，Chrome 沒有；改成直接算之後兩邊都沒有。
 const HALO_STOPS=[[0,1],[.18,.87],[.4,.5],[.64,.17],[.84,.025],[1,0]],GLOW_Z=1.75,GLOW_PLANE=5.4,GLOW_ALPHA=.55,GLOW_PAD_X=16,GLOW_PAD_Y=24,glows=[],glowV=new THREE.Vector3(),glowO=new THREE.Vector3(),glowD=new THREE.Vector3();let glowMesh=null;
 const haloVar=k=>[k,k+17,k+31,k+53].map(n=>{const x=Math.sin((n+1)*12.9898+7.2)*43758.5453;return x-Math.floor(x);});
 const glowTex=(()=>{const N=128,px=new Uint8Array(N*N*4);for(let y=0;y<N;y++)for(let x=0;x<N;x++){const r=Math.hypot(x+.5-N/2,y+.5-N/2)/(N/2),k=HALO_STOPS.findIndex(([at])=>at>=r),[a0,a1]=k<=0?[HALO_STOPS[0],HALO_STOPS[0]]:[HALO_STOPS[k-1],HALO_STOPS[k]],i=(y*N+x)*4;
 px[i]=px[i+1]=px[i+2]=255;px[i+3]=k<0?0:Math.round(255*(a1[0]===a0[0]?a1[1]:a0[1]+(a1[1]-a0[1])*(r-a0[0])/(a1[0]-a0[0])));}
 const t=new THREE.DataTexture(px,N,N,THREE.RGBAFormat);t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;})();
 function addGlow(cars,parts,tr){const entry={train:tr.id,color:new THREE.Color(tr.mark==='last-south'?'#d8453f':'#ffb300'),cars,list:cars.map((car,k)=>({n:haloVar(k),len:parts[k].lengthM||20})),w:tr.formation.widthM||2.9,visible:true};glows.push(entry);return entry;}
 function glowBuffers(){const n=2*glows.reduce((a,g)=>a+g.cars.length,0),geo=new THREE.BufferGeometry(),uv=new Float32Array(n*8),idx=[];for(let i=0;i<n;i++){uv.set([0,0,1,0,0,1,1,1],i*8);idx.push(4*i,4*i+1,4*i+2,4*i+2,4*i+1,4*i+3);}
  geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(n*12),3).setUsage(THREE.DynamicDrawUsage));geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));geo.setAttribute('color',new THREE.BufferAttribute(new Float32Array(n*16),4).setUsage(THREE.DynamicDrawUsage));geo.setIndex(idx);
  glowMesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({map:glowTex,vertexColors:true,side:THREE.DoubleSide,depthWrite:false,blending:THREE.CustomBlending,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendSrcAlpha:THREE.ZeroFactor,blendDstAlpha:THREE.OneFactor}));glowMesh.frustumCulled=false;glowMesh.renderOrder=1;scene.add(glowMesh);}
 const glowScreen=(x,y,z)=>{glowV.set(x,y,z).project(camera);return {x:(glowV.x*.5+.5)*width,y:(-glowV.y*.5+.5)*height,z:glowV.z};};
 function updateGlow(){if(!glowMesh)glowBuffers();const geo=glowMesh.geometry,pos=geo.attributes.position.array,col=geo.attributes.color.array;let n=0;camera.getWorldDirection(glowD);
  const emit=(x,y,ang,rx,ry,alpha,z,color)=>{const cs=Math.cos(ang),sn=Math.sin(ang);[[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([u,v],j)=>{const px=x+u*rx*cs-v*ry*sn,py=y+u*rx*sn+v*ry*cs;glowO.set(px/width*2-1,1-py/height*2,-1).unproject(camera);const t=(z-glowO.z)/glowD.z;
   pos.set([glowO.x+t*glowD.x,glowO.y+t*glowD.y,z],(4*n+j)*3);col.set([color.r,color.g,color.b,alpha],(4*n+j)*4);});n++;};
  for(const g of glows){if(!g.visible||!models.get(g.train).group.visible)continue;const c=g.cars.map(car=>({x:car.position.x,y:car.position.y,z:car.position.z+GLOW_Z,a:car.rotation.z})),p=c.map(v=>glowScreen(v.x,v.y,v.z)),last=c.length-1;
   // 編組兩端往外延半節車長，當第一節／最後一節的「前一節」「後一節」（同 train-halo.js）；只有一節車就沿車身方向延。
   const out=(i,j)=>{const a=c[i],L=g.list[i].len/2,d=j==null?null:Math.hypot(a.x-c[j].x,a.y-c[j].y)||1,ux=j==null?Math.cos(a.a):(a.x-c[j].x)/d,uy=j==null?Math.sin(a.a):(a.y-c[j].y)/d;return glowScreen(a.x+ux*L,a.y+uy*L,a.z);};
   const before=out(0,last?1:null),after=last?out(last,last-1):(()=>{const a=c[0],L=g.list[0].len/2;return glowScreen(a.x-Math.cos(a.a)*L,a.y-Math.sin(a.a)*L,a.z);})();
   let radius=2.5;c.forEach((v,i)=>{if(p[i].z<-1||p[i].z>1)return;for(const s of [-1,1])for(const dz of [.1-GLOW_Z,3.5-GLOW_Z]){const q=glowScreen(v.x-Math.sin(v.a)*s*g.w/2,v.y+Math.cos(v.a)*s*g.w/2,v.z+dz);radius=Math.max(radius,Math.hypot(q.x-p[i].x,q.y-p[i].y));}});radius=Math.min(26,radius);
   c.forEach((v,k)=>{const q=p[k],a=p[k-1]||before,b=p[k+1]||after;if(![q,a,b].every(s=>s.z>=-1&&s.z<=1))return;
    const dx=b.x-a.x,dy=b.y-a.y,ang=Math.atan2(dy,dx),spacing=Math.max(1,Math.hypot(dx,dy)/2),[n0,n1,n2,n3]=g.list[k].n,rx=spacing*(1.1+n0*.22)+GLOW_PAD_X,ry=(radius*1.25+GLOW_PAD_Y)*(.84+n1*.38),side=(n2-.5)*ry*.34,
     x=q.x-Math.sin(ang)*side,y=q.y+Math.cos(ang)*side,alpha=GLOW_ALPHA*Math.min(1,spacing/rx);
    const plane=v.z-GLOW_Z+GLOW_PLANE;emit(x,y,ang+(n3-.5)*.2,rx,ry,alpha,plane,g.color);emit(x-Math.sin(ang)*ry*.22,y+Math.cos(ang)*ry*.22,ang-.12,rx*1.3,ry*1.45,alpha*.34,plane,g.color);});}
  geo.setDrawRange(0,n*6);glowMesh.visible=n>0;if(n){geo.attributes.position.needsUpdate=true;geo.attributes.color.needsUpdate=true;}}
 // 依真實比例重排編組：每輛用該車型的連結器間距（pitchM）首尾相接，以編組中心為基準置中；車體不拉伸。
 // 逐輛網格與轉向來自 catalog 的 formations（EP 集電弓車、機車端客車…），輛數必須與封存班表的編組一致。
 // listedFor＝車序是照哪個方向的領頭車排的（EMU3000 1 號車在屏東／高雄端＝南下領頭）；反方向就整列倒過來、每輛轉 180°。
 function arrange(tr){const rule=fleet.formations[tr.formation.id];if(!rule||rule.cars.length!==tr.formation.parts.length)throw Error('缺少編組規則：'+tr.formation.id);
  const cars=rule.listedFor&&tr.direction!==rule.listedFor?rule.cars.slice().reverse().map(c=>({mesh:c.mesh,flip:!c.flip})):rule.cars;
  const parts=cars.map(c=>({mesh:c.mesh,flip:c.flip,lengthM:fleet.meshes[c.mesh].pitchM,offsetM:0}));let front=parts.reduce((a,c)=>a+c.lengthM,0)/2;for(const c of parts){c.offsetM=front-c.lengthM/2;front-=c.lengthM;}return parts;}
 for(const tr of data.trains){const group=new THREE.Group(),parts=arrange(tr),cars=parts.map(part=>{const car=new THREE.Group(),mesh=new THREE.Mesh(lodGeo.far.get(part.mesh),carMaterial);mesh.userData.mesh=part.mesh;mesh.renderOrder=2;if(part.flip)mesh.rotation.z=Math.PI;car.add(mesh);group.add(car);return car;});group.visible=false;scene.add(group);models.set(tr.id,{group,cars,parts,label:trainLabel(tr),glow:MARK_LABEL[tr.mark]?addGlow(cars,parts,tr):null});}
 // 近景／遠景切換：只換每輛車的 geometry（catalog.lod 有門檻，中間帶保持現狀，避免縮放時來回跳）。
 const setLod=next=>{if(next===state.lod)return;state.lod=next;for(const m of models.values())for(const car of m.cars){const mesh=car.children[0];mesh.geometry=lodGeo[next].get(mesh.userData.mesh);}};
 const byArrival=[...data.trains].filter(tr=>tr.stops.length).sort((a,b)=>anchorStop(a).arrSec-anchorStop(b).arrSec);
 // 下拉選單最上方固定兩班重點車（地面最後一班、最後南下），其餘照到臺南的時間排。
 const pinned=['last-ground','last-south'].map(k=>byArrival.find(t=>t.mark===k)).filter(Boolean),markMap=Object.fromEntries(pinned.map(t=>[t.mark,{id:t.id,train:t.train}]));
 for(const tr of [...pinned,...byArrival.filter(t=>!pinned.includes(t))]){const o=document.createElement('option');o.value=tr.id;o.textContent=(MARK_NAME[tr.mark]?'★ '+MARK_NAME[tr.mark]+' · ':'')+clock(cleanSec(anchorStop(tr).arrSec)).slice(0,5)+' · '+tr.train+' '+tr.typeName+' '+tr.direction+(tr.timing==='scheduled'?' · 表定':'');$('train').append(o);}
 function sample(tr,sec){const segment=tr.spans.find(s=>sec>=s.start&&sec<=s.start+s.s.length-1);if(!segment)return null;const f=sec-segment.start,i=Math.min(segment.s.length-1,Math.floor(f)),s=segment.s[i]+((segment.s[i+1]??segment.s[i])-segment.s[i])*(f-i),path=paths[segment.route],p=path.at(s);if(!p)return null;return {path,s,coordinate:p.coordinate,route:segment.route};}
 function updateTime(){const s=Math.floor(state.sec);$('clock').textContent=clock(s);$('timeline').value=s;if(document.activeElement!==$('time'))$('time').value=clock(s);refreshNight(s);}
 function jump(sec){state.sec=cleanSec(sec);updateTime();}
 // 開始（或取消）跟車。at＝同時跳到的時刻（驗收腳本用）；沒給的話，這班車此刻不在畫面內就跳到它進入畫面的第一秒。
 function followTrain(id,at){state.follow=id||'';$('train').value=state.follow;if(!state.follow)return;const tr=data.trains.find(t=>t.id===state.follow);if(at!=null)jump(at);else if(!sample(tr,state.sec))jump(tr.spans[0].start);span=330;view();}
 const trainByKey=(key,sec)=>{const exact=data.trains.find(t=>t.id===key);if(exact)return exact;const c=data.trains.filter(t=>t.train===String(key));return c.find(t=>t.stops.length&&sec>=t.stops[0].arrSec-900&&sec<=t.stops[t.stops.length-1].depSec+900)||c[0]||null;};
 // ── 最後一夜時間軸（snapshot.events）：每一列是一顆按鈕，點了跳到那個時刻、畫面留在臺南站（goEvent）。event-notes.json 有那一列的說明（desc／links，以事件 id 對應）就在按鈕下面接一塊說明與報導連結，點了那一列才展開，一次只展開一列。
 // 次日（t≥86400）在重播範圍外，只列文字，說明直接列出。──
 const events=(data.events||[]).slice().sort((a,b)=>a.t-b.t),KIND={official:'官方',observed:'實測',inferred:'推定'},nightRows=[],notes=eventNotes?.notes||{};
 const dayClock=sec=>(sec>=86400?'次日 ':'')+clock(((Math.floor(sec)%86400)+86400)%86400).slice(0,5);
 for(const ev of events){const li=document.createElement('li'),inDay=ev.t<86400,row=document.createElement(inDay?'button':'div'),when=document.createElement('span'),mk=document.createElement('span'),tm=document.createElement('time'),tx=document.createElement('span'),kd=document.createElement('span'),tr=ev.train!=null&&ev.train!==''?trainByKey(ev.train,ev.t):null;
  li.className='ev';li.dataset.kind=ev.kind||'';li.dataset.id=ev.id||'';li.dataset.t=String(ev.t);if(ev.train)li.dataset.train=String(ev.train);if(MARK_LABEL[tr?.mark])li.dataset.mark=tr.mark;
  row.className=inDay?'evb':'evs';if(inDay){row.type='button';row.onclick=()=>goEvent(ev);}
  when.className='when';mk.className='mk';mk.setAttribute('aria-hidden','true');tm.textContent=dayClock(ev.t);tx.className='tx';tx.textContent=ev.text;kd.className='kd';kd.textContent=KIND[ev.kind]||'';
  when.append(mk,tm);row.append(when,tx,kd);li.append(row);
  const note=notes[ev.id]||{},links=(note.links||[]).filter(l=>/^https:\/\//.test(l.url||'')&&l.outlet);
  if(note.desc||links.length){const d=document.createElement('div');d.className='evd';d.id='evd-'+(ev.id||nightRows.length);
   if(note.desc){const p=document.createElement('p');p.textContent=note.desc;d.append(p);}
   if(links.length){const p=document.createElement('p'),k=document.createElement('span');p.className='lk';k.textContent='報導';p.append(k);for(const l of links){const a=document.createElement('a');a.href=l.url;a.target='_blank';a.rel='noopener';a.textContent=l.outlet;if(l.title)a.title=l.title;p.append(a);}d.append(p);}
   if(inDay){d.hidden=true;row.setAttribute('aria-expanded','false');row.setAttribute('aria-controls',d.id);}li.append(d);}
  $('events').append(li);nightRows.push(li);}
 $('night').hidden=!events.length;
 // 面板下緣提示：展開的那一列還有一截在面板下緣以下（說明或報導連結要往下捲）時，#night 加 more，CSS 在底部畫一道淡出（同跟車卡的右緣提示）；
 // 捲動、面板或列表變大小時重算。面板收合時本體高 0，自然拿掉。
 const nbMore=document.createElement('span');nbMore.className='nb-more';nbMore.setAttribute('aria-hidden','true');$('night').append(nbMore);
 const syncNightMore=()=>{const body=$('nightBody'),h=body.clientHeight,li=nightRows.find(x=>x.firstElementChild.getAttribute('aria-expanded')==='true');$('night').classList.toggle('more',!!li&&h>0&&li.getBoundingClientRect().bottom>body.getBoundingClientRect().top+body.clientTop+h+1);};
 $('nightBody').addEventListener('scroll',syncNightMore,{passive:true});{const ro=new ResizeObserver(syncNightMore);ro.observe($('nightBody'));ro.observe($('events'));}
 // 展開 id 那一列的說明、收起其他列。面板開著的話，把那一列捲進面板的可見範圍：整列放得下就整列露出；放不下但說明（含報導連結）放得下，就讓說明整段露出、列標題可以捲出上緣（矮螢幕的面板本體只有一百 px 上下，展開的列常比它高）；說明也放不下就對齊列頂，其餘在面板內捲。
 function openEvent(id){let li=null;for(const x of nightRows){const d=x.querySelector('.evd'),b=x.firstElementChild;if(!d||b.tagName!=='BUTTON')continue;const on=x.dataset.id===id;d.hidden=!on;b.setAttribute('aria-expanded',String(on));if(on)li=x;}
  const body=$('nightBody');if(!li||!body.clientHeight)return;const r=li.getBoundingClientRect(),n=li.querySelector('.evd').getBoundingClientRect(),h=body.clientHeight,vt=body.getBoundingClientRect().top+body.clientTop,vb=vt+h,top=r.height<=h||r.bottom-n.top>h?r.top:n.top;
  if(r.bottom>vb)body.scrollTop+=Math.min(r.bottom-vb,top-vt);else if(top<vt)body.scrollTop-=vt-top;syncNightMore();}
 function refreshNight(sec){let cur=-1;events.forEach((ev,i)=>{if(ev.t<=sec)cur=i;});nightRows.forEach((li,i)=>{const st=i<cur?'past':i===cur?'current':'future';if(li.dataset.state===st)return;li.dataset.state=st;const b=li.firstElementChild;if(b.tagName==='BUTTON'){if(st==='current')b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');}li.querySelector('.mk').textContent=st==='past'?'✓':st==='current'?'●':'○';});}
 // 點時間軸的列：畫面留在臺南站、不跟車，方位、仰角、縮放照按之前的（同「下一班到臺南」），那一列展開說明。臺南站的事件跳到事件前 LEAD 秒，看得到車進站或開出；
 // 其他站的事件（永康在畫面範圍外，保安在畫面南端）跳到事件那一刻，靠說明交代。窄版點了臺南站的事件就收起面板，讓人看到場景；其他站的事件不收，說明留在畫面上。
 // 寬版面板在側邊，不收。這個收合記成 nightAuto（不是使用者按的），換版面就失效。跟車卡當下就收（不等下一幀），展開的那一列才捲得到對的位置。
 const LEAD=25,atTainan=ev=>!!ev.ref?.station&&isTainan({name:ev.ref.station});
 function goEvent(ev){const here=atTainan(ev);jump(here?ev.t-LEAD:ev.t);centerStation();view();refreshCard();openEvent(ev.id);if(here&&!sideLayout.matches){nightAuto=false;applyNight();}}
 // ── 跟車逐站時刻卡：站／表定／重播／來源／差多少／留置（holdSec≥90 秒才算）。來源緊接在重播後面：側欄窄、表格要左右捲時，先被切掉的是差與留置；右邊還有欄位時右緣有淡出提示。
 // 來源分到站與開車兩行。到站照 src：obs 實測、interp 內插、sched 表定。開車照 DEP_SRC：obs 的站（含被留置的通過站）是表定加誤點分鐘推得＝推定；interp 的站到站與開車都由鄰近的站推算＝內插；
 // 起點站（est）的紀錄是看板佔位，只用它的誤點分鐘推開車時刻＝推定；sched＝表定。起點站（end 'origin'）到站與開車同一秒＝沒有到站，終點站（end 'terminal'）同理沒有開車：
 // 那一行在表定、重播、來源、差都記「—」；到、開不同秒的起訖站照常兩行。通過站（沒有留置）只有一行。時間一律是當天的時鐘時間，跨午夜的前一營運日用「前日」「次日」標明。──
 const T=sec=>{if(!Number.isFinite(sec))return '—';const r=Math.round(sec),d=Math.floor(r/86400);return (d<0?'前日 ':d>0?'次日 ':'')+clock(r-d*86400);};
 const DUR=sec=>{const s=Math.round(Math.abs(sec)),m=Math.floor(s/60),r=s%60;return (m?m+'分':'')+(r||!m?r+'秒':'');},DIFF=d=>!Number.isFinite(d)?'—':Math.abs(d)<5?'準點':(d>0?'晚':'早')+DUR(d);
 const card=$('followcard'),NIGHT_HINT=$('nightToggle').querySelector('.s').textContent;let cardFor=null,cardRows=[],cardStatus=null,cardMore=null;
 const lines=(tag,...ls)=>{const c=document.createElement(tag);for(const l of ls){const s=document.createElement('span');s.className='ln';s.textContent=l;c.append(s);}return c;};
 function renderCard(tr){card.replaceChildren();const h=document.createElement('h3'),no=document.createElement('span'),ty=document.createElement('span');no.textContent=tr.train+' 次';ty.className='ty';ty.textContent=tr.typeName+' '+tr.direction;h.append(no,ty);
  if(MARK_NAME[tr.mark]){const g=document.createElement('span');g.className='tag'+(tr.mark==='last-south'?' south':'');g.textContent=MARK_NAME[tr.mark];h.append(g);}
  cardStatus=document.createElement('p');cardStatus.className='st';
  const wrap=document.createElement('div'),table=document.createElement('table'),head=document.createElement('tr'),body=document.createElement('tbody');wrap.className='tw';
  for(const [t,sub] of [['站'],['表定','到／開'],['重播','到／開'],['來源','到／開'],['差','重播−表定'],['留置']]){const th=document.createElement('th');th.scope='col';th.append(t);if(sub){th.append(document.createElement('br'),sub);}head.append(th);}
  const thead=document.createElement('thead');thead.append(head);
  cardRows=tr.stops.map(s=>{const row=document.createElement('tr'),pass=s.stop===false,hold=Number(s.holdSec)>=90?Number(s.holdSec):0,passed=pass&&!hold,has=Number.isFinite(s.schedArrSec),noArr=s.end==='origin'&&s.arrSec===s.depSec,noDep=s.end==='terminal'&&s.arrSec===s.depSec,ad=(a,d)=>[noArr?'—':a,noDep?'—':d];row.dataset.name=s.name;row.dataset.src=s.src||'';row.dataset.hold=String(hold);
   const name=document.createElement('th');name.scope='row';name.textContent=s.name;
   const sched=has?(pass?lines('td','通過',T(s.schedArrSec)):lines('td',...ad(T(s.schedArrSec),T(s.schedDepSec)))):lines('td','—'),act=passed?lines('td','通過',T(s.arrSec)):lines('td',...ad(T(s.arrSec),T(s.depSec)));
   const diff=has?(passed?lines('td',DIFF(s.arrSec-s.schedArrSec)):lines('td',...ad(DIFF(s.arrSec-s.schedArrSec),DIFF(s.depSec-s.schedDepSec)))):lines('td','—'),held=lines('td',hold?DUR(hold):'—');if(hold)held.className='hold';
   const src=document.createElement('td');for(const k of passed?[s.src]:ad(s.src,DEP_SRC[s.src])){const ln=document.createElement('span');ln.className='ln';if(SRC[k]){const chip=document.createElement('span');chip.className='src src-'+k;chip.textContent=SRC[k];ln.append(chip);}else ln.textContent='—';src.append(ln);}
   row.append(name,sched,act,src,diff,held);body.append(row);return {row,s};});
  table.append(thead,body);wrap.append(table);
  // 右緣提示：表格右邊還有內容（還沒捲到底）時，.twr 加 more，CSS 在右緣畫一道淡出（不接收指標）；捲到底或沒有溢出時拿掉。捲動、表格或外框變大小時重算。
  const twr=document.createElement('div'),more=document.createElement('span');twr.className='twr';more.className='tw-more';more.setAttribute('aria-hidden','true');twr.append(wrap,more);
  const syncMore=()=>twr.classList.toggle('more',wrap.scrollWidth-wrap.clientWidth-wrap.scrollLeft>1);wrap.addEventListener('scroll',syncMore,{passive:true});cardMore?.disconnect();cardMore=new ResizeObserver(syncMore);cardMore.observe(wrap);cardMore.observe(table);
  const note=document.createElement('p');note.className='note';note.textContent=tr.timing==='scheduled'?'這班車沒有任何即時動態紀錄，整班照時刻表畫。':'時刻依即時動態紀錄推算，到站誤差約半分鐘。實測＝取自紀錄的到站或通過時刻；內插＝這一站沒有可用的紀錄，到站與開車都由鄰近的站推算；推定＝紀錄裡沒有開車時刻，用表定加上當時的誤點分鐘推算，可能差一分鐘左右；留置＝比表定多停 90 秒以上；「—」＝起點站沒有到站、終點站沒有開車。';
  // 推定的等待原因寫在時間軸事件的文字裡（例如「等 3278」），逐站欄位沒有原因欄：把這班車自己的事件列在表下面。點了跟別班、時刻取自這班車停站的那一列（保安交會）也列進來。
  const mine=events.filter(e=>e.train!=null&&e.train!==''&&String(e.train)===String(tr.train)||e.ref?.trainId===tr.id),extra=[];
  if(mine.length){const h4=document.createElement('h4'),ul=document.createElement('ul');h4.textContent='這班車在最後一夜';ul.className='mine';for(const e of mine){const li=document.createElement('li'),tm=document.createElement('time'),tx=document.createElement('span');tm.textContent=dayClock(e.t);tx.textContent=e.text;li.append(tm,tx);ul.append(li);}extra.push(h4,ul);}
  card.append(h,cardStatus,twr,...extra,note);}
 function refreshCard(){const tr=state.follow?data.trains.find(t=>t.id===state.follow):null,hint=$('nightToggle').querySelector('.s');if(!tr){card.hidden=true;if(cardFor!==null){cardFor=null;hint.textContent=NIGHT_HINT;}return;}
  if(cardFor!==tr.id){renderCard(tr);cardFor=tr.id;hint.textContent='跟車中：'+tr.train+' 次的逐站時刻';}card.hidden=false;const sec=state.sec;
  for(const {row,s} of cardRows){const slack=s.stop===false?10:0,st=sec>s.depSec+slack?'past':sec>=s.arrSec-slack?'now':'future';if(row.dataset.state!==st)row.dataset.state=st;}
  const first=tr.stops[0],last=tr.stops[tr.stops.length-1],here=tr.stops.find(s=>(s.stop!==false||Number(s.holdSec)>=90)&&sec>=s.arrSec&&sec<=s.depSec),next=tr.stops.find(s=>sec<s.arrSec);
  cardStatus.textContent=(here?'停在'+here.name:sec<first.arrSec?'尚未到'+first.name:sec>last.depSec?'已駛離最後一站':next?'行駛中，下一站'+next.name:'行駛中')+(sample(tr,sec)?'':'（目前在畫面範圍外）')+(tr.timing==='scheduled'?'；沒有即時動態紀錄，照表定時刻':'');}
 // ── 單線雙向說明與文案裡跟資料有關的數字（說明文字的預設值與 spec 相同，資料不同時以資料為準）──
 const single=data.singleLine;
 function refreshSingleLine(){const e=$('singleline'),note=$('slNote'),on=!!single&&state.sec>=single.fromSec&&state.sec<=single.toSec;if(on&&!note.textContent){note.textContent=single.note||((single.section||[]).join('—')+'之間只剩一條線，對向列車輪流通過。');$('slSum').textContent=clock(single.fromSec).slice(0,5)+' 起單線雙向';}e.hidden=!on;placeSingleLine();}
// 窄版與矮螢幕（寬 899 以下或高 600 以下，見 replay.css）只顯示一行摘要，按「說明」才展開完整文字；其餘寬版的 CSS 不顯示這顆鈕、直接列出完整說明。展開狀態只存在 aria-expanded。
$('slToggle').onclick=()=>{const b=$('slToggle');b.setAttribute('aria-expanded',String(b.getAttribute('aria-expanded')!=='true'));placeSingleLine();};
 // 單線說明框的位置（窄版與矮螢幕＝寬 899 以下或高 600 以下，有「說明」鈕的那一段；寬版照 CSS）：框貼在場景左下角，上緣離視角按鈕實際的下緣 SL_GAP，按鈕折成兩排也照實際的下緣算。
 // 兩排之下連「說明」鈕都放不下時（例：568×320 打開最後一夜，場景只剩約 300 px 寬），框改放到最後一排最後一顆按鈕的右邊，上緣讓出上面那幾排。
 // 展開而且正在跟車時，框的上緣再往下讓出一條帶子，放得下被跟那班的標籤＋整班車＋SL_CAR_GAP（車身用 followReach 的最壞外框），liftFollow 把整班車放進這條帶子；框至少留摘要列＋一行說明（可捲）。
 // slBand：說明文字顯示中才有。bandTop＝標籤那一欄（場景中線兩側）最低的按鈕下緣，沒有按鈕就是場景頂端；boxTop／boxL／boxR＝說明框。座標都相對場景左上角。
 // SL_CAR_GAP：車身外框下緣離說明框上緣至少 8 px，含 2 px 給像素取整。兩班重點車的光暈（updateGlow）沒有邊、越往外越淡，伸進框裡的外圍被框的底色（95% 不透明）蓋住，不另讓位。
 const SL_GAP=10,SL_CAR_GAP=8,SL_LABEL_W=200;let slBand=null,slKey='';
 // 被跟那班在目前鏡頭下、車頭朝任何方位時，車身離跟車點（編組中心的地面）在畫面上最遠多少 px：up 往上、down 往下。
 // R＝各輛中心離編組中心的距離＋該輛 boundingBox 的水平半對角線，取最大；up＝R·sin(仰角)＋車頂高·cos(仰角)，down＝R·sin(仰角)−車底高·cos(仰角)，再乘每公尺像素（車輛離地 0.16 m 不到 0.2 px，不計）。
 // 不看列車當下的方位與位置（軌道彎的時候車身只會更靠近跟車點，上限照樣成立），所以帶子與讓位量只隨視窗尺寸、縮放、仰角、LOD 改變，不會隨列車移動或轉彎跳動。
 const bboxOf=g=>g.boundingBox||(g.computeBoundingBox(),g.boundingBox),followKey=()=>[state.follow,span,tilt,height,state.lod].join();
 function followReach(m){const ppm=height/span,s=Math.sin(tilt),c=Math.cos(tilt);let R=0,z0=Infinity,z1=-Infinity;
  m.cars.forEach((car,i)=>{const q=bboxOf(car.children[0].geometry);R=Math.max(R,Math.abs(m.parts[i].offsetM)+Math.hypot(Math.max(-q.min.x,q.max.x),Math.max(-q.min.y,q.max.y)));z0=Math.min(z0,q.min.z);z1=Math.max(z1,q.max.z);});
  return {up:(R*s+z1*c)*ppm,down:(R*s-z0*c)*ppm};}
 function placeSingleLine(){const box=$('singleline'),tg=$('slToggle'),st=box.style;slBand=null;slKey=followKey();if(box.hidden)return;
  const sr=host.getBoundingClientRect(),W=sr.width,H=sr.height,narrow=getComputedStyle(tg).display!=='none',open=!narrow||tg.getAttribute('aria-expanded')==='true';
  const rel=e=>{const r=e.getBoundingClientRect();return {l:r.left-sr.left,r:r.right-sr.left,t:r.top-sr.top,b:r.bottom-sr.top};},btns=[...host.querySelectorAll('.view-controls button')].filter(b=>b.getClientRects().length).map(rel);
  // 標籤那一欄：跟車時列車在場景中線上，標籤寬取被跟那班的實際寬度（還沒畫出來就用 SL_LABEL_W）；收起來浮在場景右上角的「最後一夜」鈕也算障礙。
  const nt=rel($('nightToggle')),floating=nt.r>0&&nt.l<W&&nt.b>0&&nt.t<H,cx=W/2,lw=(state.follow&&models.get(state.follow)?.label.e.offsetWidth)||SL_LABEL_W;
  const bandTop=Math.max(0,...[...btns,...(floating?[nt]:[])].filter(b=>b.r>cx-lw/2-4&&b.l<cx+lw/2+4).map(b=>b.b));
  if(narrow){const bottom=parseFloat(getComputedStyle(box).bottom)||0,low=Math.max(0,...btns.map(b=>b.b));let left=12,top=low+SL_GAP;
   if(H-bottom-top<tg.offsetHeight&&btns.length){const last=Math.max(...btns.map(b=>b.t)),upper=btns.filter(b=>b.t<last-1);if(upper.length){left=Math.max(...btns.filter(b=>b.t>=last-1).map(b=>b.r))+6;top=Math.max(...upper.map(b=>b.b))+SL_GAP;}}
   let maxH=H-bottom-top;const fm=open&&state.follow&&models.get(state.follow);
   // 帶子：標籤（底不高於 57、上緣在 bandTop＋2 之下，同 liftFollow）與車身最高點都在按鈕下緣＋2 之下，車身最低點再離框上緣 SL_CAR_GAP；放不下就退到框的最小高度。
   if(fm){const r=followReach(fm),k=7*Math.cos(tilt)*height/span,lh=fm.label.e.offsetHeight||26;maxH=Math.min(maxH,Math.max(tg.offsetHeight+24,H-bottom-(Math.max(57+k,bandTop+2+Math.max(lh+k,r.up))+r.down+SL_CAR_GAP)));}
   st.left=left+'px';st.maxWidth=Math.max(0,W-12-left)+'px';st.maxHeight=Math.max(0,maxH)+'px';}
  else st.left=st.maxWidth=st.maxHeight='';
  if(open&&getComputedStyle($('slNote')).display!=='none'){const b=rel(box);slBand={bandTop,boxTop:b.t,boxL:b.l,boxR:b.r};}}
 {const ro=new ResizeObserver(()=>placeSingleLine());ro.observe(host);ro.observe(host.querySelector('.view-controls'));}
 // 跟車置中點：平常是場景中心。說明文字顯示中、說明框橫跨場景中線時，解跟車點（編組中心的地面）在畫面上的高度 g（往下為正），三條限制：
 //  ① 標籤底（車上方 7 m 的投影，在跟車點上方 k）≤ 框上緣 − 3；② 標籤上緣 ≥ bandTop＋2，而且標籤底 ≥ 57（draw 的標籤可見門檻）；③ 最壞情況的車身下緣（跟車點往下 followReach 的 down）≤ 框上緣 − SL_CAR_GAP。
 // 不讓位時 g＝場景中線。三條都做得到時只往上推到剛好符合（g＝①、③ 上限的較小者）：讓位量隨縮放連續變，門檻上剛好是 0，縮放跨過門檻時畫面不跳。
 // 做不到時先保 ①、再保 ②，放棄 ③：標籤緊貼按鈕下緣、車盡量往上；連這樣標籤都會碰到框，就退到標籤底＝框上緣 − 3。
 // 車身用最壞外框，不看列車當下的方位與位置：down 只隨視窗、縮放、仰角、LOD 變，列車移動或轉彎時讓位量不變，畫面不跟著上下晃。
 // 只沿地面往鏡頭方向推 target（同平移，z 保持 0），標籤與車照舊畫在真實位置；只往上讓、不往下推。拖曳一開始就取消跟車，鏡頭停在當下的位置，不會跳回中心。收合、框沒橫跨中線或上限不高過中線時不動。
 // 縮放、仰角、場景高、LOD 或被跟的車換了（帶子跟著變），先重排說明框再讀 slBand。
 function liftFollow(m){if(slKey!==followKey())placeSingleLine();const b=slBand;if(!b||!(b.boxL<width/2&&b.boxR>width/2))return;
  const ppm=height/span,k=7*Math.cos(tilt)*ppm,lh=m.label.e.offsetHeight||26,gLo=Math.max(57,b.bandTop+2+lh)+k,gHi=Math.min(b.boxTop-3+k,b.boxTop-SL_CAR_GAP-followReach(m).down);
  const g=Math.min(height/2,gLo<=gHi?gHi:Math.min(gLo,b.boxTop-3+k));
  const dy=(height/2-g)/ppm;if(dy<=0)return;const up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1),h=Math.max(.1,Math.hypot(up.x,up.y));target.addScaledVector(up,-dy/(h*h));target.z=0;}
 for(const e of document.querySelectorAll('[data-fill]')){if(e.dataset.fill==='singleFrom'&&single)e.textContent=clock(single.fromSec).slice(0,5);if(e.dataset.fill==='scheduled'){const n=[...new Set(data.trains.filter(t=>t.timing==='scheduled').map(t=>t.train))].sort();if(n.length)e.textContent=n.join('、');}}
 // ── 字幕：不確定時段依 reason 分兩種寫法；單線雙向說明在場景裡另外顯示 ──
 // 不確定時段收不收車身（draw 每幀）：封鎖初期「同一區間同時有對向車」的時段（single-line-unresolved，basis＝section-overlap）照常畫車身，
 // 兩班照一般股道畫在不同股上、車身不重疊，只是實際走哪一股不確定（標籤虛線、字幕講明）；其餘時段（兩車畫在同一股上）收起車身、只留原位置的車次標記。
 const drawsBody=i=>i.reason==='single-line-unresolved'&&i.basis==='section-overlap';
 const reasonsOf=id=>{const r=new Set();for(const i of uncertainty.intervals)if(state.sec>=i.start&&state.sec<=i.end&&i.trains.includes(id))r.add(drawsBody(i)?'single-line-drawn':i.reason||'track-overlap');return r.size?r:new Set(['track-overlap']);},TAIL=' 次暫以車次標記呈現；位置仍依重建的時刻推演。',DRAWN_TAIL=' 次照一般股道畫出，實際走哪一股不確定。';
 function captionText(pending){
  if(pending.length){const g={'single-line-drawn':[],'single-line-unresolved':[],'track-overlap':[]};for(const t of pending)for(const r of reasonsOf(t.id))(g[r]||g['track-overlap']).push(t.train);
   return [g['single-line-drawn'].length&&'封鎖初期股道安排不明：'+g['single-line-drawn'].join('、')+DRAWN_TAIL,g['single-line-unresolved'].length&&'封鎖初期股道安排不明：'+g['single-line-unresolved'].join('、')+TAIL,g['track-overlap'].length&&'股道安排待確認：'+g['track-overlap'].join('、')+TAIL].filter(Boolean).join(' ');}
  const follow=data.trains.find(t=>t.id===state.follow);
  if(follow)return [follow.train+' 次',MARK_NAME[follow.mark],follow.formation.caption,follow.timing==='scheduled'?'無即時動態紀錄，照表定時刻':follow.timing?'時刻依即時動態紀錄重建':'依封存班表推演'].filter(Boolean).join(' · ');
  return '封存 '+data.trains.length+' 班 · 時刻依即時動態紀錄重建，非 GPS 軌跡；區間車與莒光號的編組為推估。';}
 // 「舊站近景」連方位、仰角、縮放一起回預設；「下一班到臺南」「臺南發車」只跳時間、把畫面中心移回臺南站，方位、仰角、縮放照按之前的。三顆都取消跟車。
 // 「下一班到臺南」只算會停臺南的班次：最後一夜 23:06 起有只跑仁德—保安的班次，它們的 anchorStop 是第一站，不能拿來排。在臺南始發的班次沒有到站，不算進「下一班到臺南」，
 // 另由「臺南發車」跳到開車前 LEAD 秒：重建的時刻只有開車，始發車在開車那一秒才出現，所以先看到空月台，車出現就開走。
 function centerStation(){state.follow='';$('train').value='';target.set(stationXY[0]+18,stationXY[1],0);}
 function stationView(){centerStation();span=140;azimuth=3.6;tilt=TILT0;view();}
 $('station').onclick=stationView;$('overview').onclick=()=>{state.follow='';$('train').value='';target.set(400,-3250,0);span=10500;view();};
 $('rotate').onclick=()=>{azimuth+=Math.PI/4;view();};$('zoomin').onclick=()=>{span=Math.max(34,span/1.5);view();};$('zoomout').onclick=()=>{span=Math.min(14000,span*1.5);view();};
 $('timeline').oninput=e=>jump(Number(e.target.value));$('time').onchange=e=>{const [h,m,s=0]=e.target.value.split(':').map(Number);jump(h*3600+m*60+s);};
 $('play').onclick=()=>{state.playing=!state.playing;$('play').textContent=state.playing?'暫停':'播放';$('play').setAttribute('aria-label',state.playing?'暫停重播':'播放重播');};
 $('speed').onchange=e=>state.speed=Number(e.target.value);
 const toTainan=byArrival.filter(tr=>tainanStop(tr)&&tainanStop(tr).end!=='origin'),fromTainan=data.trains.filter(tr=>tainanStop(tr)?.end==='origin').sort((a,b)=>tainanStop(a).depSec-tainanStop(b).depSec);
 const jumpNext=(list,at)=>{const next=list.find(tr=>at(tr)>state.sec+LEAD)||list[0];jump(at(next)-LEAD);centerStation();view();};
 $('next').onclick=()=>jumpNext(toTainan,tr=>tainanStop(tr).arrSec);$('depart').onclick=()=>jumpNext(fromTainan,tr=>tainanStop(tr).depSec);$('depart').hidden=!fromTainan.length;
 $('train').onchange=e=>followTrain(e.target.value);
 $('about').onclick=$('aboutNav').onclick=()=>{$('details').showModal();};
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
 let last=performance.now(),lastSecond=-1,shownFollow=null;const active=[];
 // rAF 的時間戳可能比 last（宣告當下的 performance.now()）早一點：dt 不小於 0，免得第一幀把 22:00:00 倒退成 21:59:59。
 function draw(now){requestAnimationFrame(draw);const dt=Math.max(0,Math.min(.1,(now-last)/1000));last=now;if(document.hidden)return;if(state.nearReady)setLod(span<fleet.lod.nearBelowSpan?'near':span>fleet.lod.farAboveSpan?'far':state.lod);if(state.playing&&!$('details').open)state.sec=(state.sec+dt*state.speed)%86400;active.length=0;
  const atNow=uncertainty.intervals.filter(i=>state.sec>=i.start&&state.sec<=i.end),uncertain=new Set(atNow.flatMap(i=>i.trains)),bodyless=new Set(atNow.filter(i=>!drawsBody(i)).flatMap(i=>i.trains));
  for(const tr of data.trains){const m=models.get(tr.id),p=sample(tr,state.sec);m.group.visible=!!p&&!bodyless.has(tr.id);m.label.coordinate=p?.coordinate||null;m.label.e.classList.toggle('uncertain',uncertain.has(tr.id));m.label.e.classList.toggle('following',state.follow===tr.id);if(!p)continue;const poses=formationPoses(p.path,p.s,1,m.parts,()=>.16);if(!poses){m.group.visible=false;m.label.coordinate=null;continue;}active.push({id:tr.id,train:tr.train,direction:tr.direction,route:p.route,s:p.s,coordinate:p.coordinate,trackUncertain:uncertain.has(tr.id)});poses.forEach((pose,i)=>{const xy=world(pose.coordinate);m.cars[i].position.set(...xy,pose.height);m.cars[i].rotation.z=pose.angle;});if(state.follow===tr.id){target.set(...world(p.coordinate),0);liftFollow(m);view();}}
  const occupied=[];for(const l of labels){if(!l.coordinate){l.e.hidden=true;continue;}const xy=world(l.coordinate),p=new THREE.Vector3(...xy,7).project(camera),x=(p.x*.5+.5)*width,y=(-p.y*.5+.5)*height;const visible=p.z>=-1&&p.z<=1&&x>0&&x<width&&y>55&&y<height-30;l.e.hidden=!visible;if(visible){l.e.style.transform=`translate(${x}px,${y}px) translate(-50%,-100%)`;if(!l.e.classList.contains('train-label')){const b=l.e.getBoundingClientRect();if(occupied.some(a=>b.left<a.right&&b.right>a.left&&b.top<a.bottom&&b.bottom>a.top))l.e.hidden=true;else occupied.push(b);}}}
  updateGlow();renderer.render(scene,camera);state.frames++;
  // 每個整秒、或跟車對象換了（下拉選單、時間軸事件、拖曳取消跟車）就更新字幕、單線說明與跟車卡。
  if(Math.floor(state.sec)!==lastSecond||shownFollow!==state.follow){lastSecond=Math.floor(state.sec);shownFollow=state.follow;updateTime();$('running').textContent='區間內 '+active.length+' 班';const pending=active.filter(t=>t.trackUncertain);$('caption').textContent=captionText(pending);$('caption').classList.toggle('uncertain',!!pending.length);refreshSingleLine();refreshCard();}}
 // 可重現的驗收介面：封存資料、時間與車廂沿軌座標均可核對，無外部寫入。
 window.tainanMemory={state,data,sample,paths,models,active,jump,stationView,renderer,camera,uncertainty,fleet,wrap,surroundings:{mesh:surroundings,meta:surroundingsMeta},roads:{meshes:roadMeshes,stats:roads.stats,ways:roads.ways},events,marks:markMap,singleLine:single,followTrain,goEvent,night:{isOpen:nightOpen,setOpen:setNight}};stationView();updateTime();state.ready=true;status.hidden=true;requestAnimationFrame(draw);loadLod('near').then(()=>{state.nearReady=true;},e=>console.error(e));
}catch(error){console.error(error);status.replaceChildren();const p=document.createElement('p');p.textContent='這份回憶暫時無法載入：'+error.message;const retry=document.createElement('button');retry.textContent='重新載入';retry.onclick=()=>location.reload();status.append(p,retry);}
