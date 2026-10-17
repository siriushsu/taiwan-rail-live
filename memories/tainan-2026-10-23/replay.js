import * as THREE from './vendor/three.module.js';
import {makePath,formationPoses} from './vendor/train-path.js';
import {createWenhuGeometry,createWenhuMaterial} from './vendor/mesh.js';
import {buildRoads,ROAD} from './roads.js';
const $=id=>document.getElementById(id), status=$('loading');
const DEFAULT_SEC=30420,state={ready:false,nearReady:false,lod:'far',sec:DEFAULT_SEC,playing:true,speed:10,follow:'',frames:0};
const clock=sec=>[Math.floor(sec/3600),Math.floor(sec/60)%60,Math.floor(sec)%60].map(v=>String(v).padStart(2,'0')).join(':');
const cleanSec=s=>Math.max(0,Math.min(86399,Number.isFinite(s)?s:DEFAULT_SEC));
const query=new URLSearchParams(location.search),timeQuery=query.get('t');
// 沒帶 ?t= 時，開機後改用封存檔的 defaultSec（08:27）。
const timeGiven=!!timeQuery&&/^\d{1,2}:\d{2}(:\d{2})?$/.test(timeQuery);
if(timeGiven){const [h,m,s=0]=timeQuery.split(':').map(Number);state.sec=cleanSec(h*3600+m*60+s);}
// 跟車逐站時刻面板：寬版與橫向手機（高 520 以下）放在場景右側，直立的窄版接在場景下方；只有在跟車時才出現（沒跟車就不佔位置）。預設收合成一顆按鈕，使用者按過之後以按的為準，旋轉螢幕或改視窗大小不重設。
// 窄版展開時場景被壓到只剩一條，#scene 加 squeezed：CSS 把操作提示先收起來，免得疊在視角按鈕與車次標籤上。
const sideLayout=matchMedia('(min-width:900px), (max-height:520px)'),panel=$('fpanel');let panelUser=null;
const panelOpen=()=>panelUser??false;
function applyPanel(){const open=panelOpen();panel.classList.toggle('open',open);panel.classList.toggle('closed',!open);$('fpToggle').setAttribute('aria-expanded',String(open));$('scene').classList.toggle('squeezed',!sideLayout.matches&&open&&!panel.hidden);}
const setPanel=open=>{panelUser=open;applyPanel();};
$('fpToggle').onclick=()=>setPanel(!panelOpen());sideLayout.addEventListener('change',applyPanel);applyPanel();
let integrity;
// 網格以 .bin.gz 存放（Cloudflare 不壓 octet-stream，未壓縮要多下載約 9 MB）；解壓後仍比對原始 .bin 的封存雜湊。
async function gunzip(b){try{if(typeof DecompressionStream==='function')return await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();}catch{}const {gunzipSync}=await import('./vendor/fflate-gunzip.js'),a=gunzipSync(new Uint8Array(b));return a.buffer.slice(a.byteOffset,a.byteOffset+a.byteLength);}
async function bytes(file){let b;const gz=file.endsWith('.bin');for(let attempt=0;attempt<3;attempt++){try{const r=await fetch(new URL(gz?file+'.gz':file,import.meta.url));if(!r.ok)throw Error('HTTP '+r.status);b=await r.arrayBuffer();if(gz)b=await gunzip(b);break;}catch(e){if(attempt===2)throw Error('無法讀取封存檔案 '+file+'：'+e.message);await new Promise(resolve=>setTimeout(resolve,200*(attempt+1)));}}if(integrity?.files[file]){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==integrity.files[file])throw Error('封存檔案版本不一致：'+file);}return b;}
const json=async f=>JSON.parse(new TextDecoder().decode(await bytes(f)));
try{
 integrity=await json('integrity.json');
 const [data,fleet,stationMeta,uncertainty,surroundingsMeta,ugMeta,ugProfile]=await Promise.all([json('snapshot.json'),json('fleet/catalog.json'),json('station/model.json'),json('uncertainty.json'),json('surroundings/model.json'),json('underground/model.json'),json('underground/profile.json')]);
 if(!timeGiven)state.sec=cleanSec(data.defaultSec??DEFAULT_SEC);
 // 背景色（面紗也用這個顏色）、面紗的不透明度（可在執行時改，見 tainanMemory.underground）、半透明層的畫序、預設鏡頭。
 // 畫序：不透明的先畫；半透明的依 renderOrder 由小到大畫＝殼 → B1 → 面紗 → 地面以上的半透明物（站房外罩）。
 const BG='#e5e7dc',VEIL_OPACITY=.45,UG_ORDER={ug_shell:1,ug_b1:2,veil:3,above:4};
 const HOME={x:30,y:60,z:-6,span:260,azimuth:3.6,tilt:55*Math.PI/180};
 const host=$('scene'),renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(BG);renderer.outputColorSpace=THREE.SRGBColorSpace;host.prepend(renderer.domElement);
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera();camera.up.set(0,0,1);camera.near=.1;camera.far=50000;
 scene.add(new THREE.HemisphereLight(0xffffff,0x788776,2));const sun=new THREE.DirectionalLight(0xfff3dc,2.2);sun.position.set(-600,-500,1000);scene.add(sun);
 const sx=111320*Math.cos(data.origin[1]*Math.PI/180),world=p=>[(p[0]-data.origin[0])*sx,(p[1]-data.origin[1])*111320];
 // 仰角 tilt：預設 atan2(6800,8000)≈40.4°（改版前固定的角度），可調 10°～89°；到 90° 相機 up 軸與視線平行，lookAt 會退化。
 const TILT0=Math.atan2(6800,8000),TILT_MIN=10*Math.PI/180,TILT_MAX=89*Math.PI/180;
 const target=new THREE.Vector3(0,0,0);let span=290,azimuth=3.6,tilt=TILT0,width=1,height=1;
 // 標線只有 12～15 cm 寬：拉遠到一個像素超過約 0.3 m 就開始淡出、0.6 m 以上不畫，免得變成閃爍的細紋。
 let roadMeshes=null;function fadeMarkings(){if(!roadMeshes)return;const mpp=span/Math.max(1,height),o=Math.max(0,Math.min(1,(.6-mpp)/.3));for(const k of ['white','yellow']){roadMeshes[k].material.opacity=o;roadMeshes[k].visible=o>0;}}
 function view(){const aspect=width/height;camera.left=-span*aspect/2;camera.right=span*aspect/2;camera.top=span/2;camera.bottom=-span/2;tilt=Math.min(TILT_MAX,Math.max(TILT_MIN,tilt));const r=Math.cos(tilt)*10500;camera.position.copy(target).add(new THREE.Vector3(Math.cos(azimuth)*r,Math.sin(azimuth)*r,Math.sin(tilt)*10500));camera.lookAt(target);camera.updateProjectionMatrix();camera.updateMatrixWorld();fadeMarkings();}
 new ResizeObserver(()=>{width=host.clientWidth;height=host.clientHeight;renderer.setSize(width,height,false);view();}).observe(host);
 // 靜態量體依顏色合併成一批：原本每棟房子、每條路各一個 mesh，全線視圖每幀 600 多次繪製指令，手機吃不消。
 const batches=new Map();function batch(g,color,roughness){g=g.index?g.toNonIndexed():g;const key=color+'|'+roughness;if(!batches.has(key))batches.set(key,{color,roughness,parts:[]});batches.get(key).parts.push(g);}
 function flushBatches(){for(const {color,roughness,parts} of batches.values()){const n=parts.reduce((a,g)=>a+g.attributes.position.array.length,0),pos=new Float32Array(n),nrm=new Float32Array(n);let o=0;for(const g of parts){pos.set(g.attributes.position.array,o);nrm.set(g.attributes.normal.array,o);o+=g.attributes.position.array.length;g.dispose();}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('normal',new THREE.BufferAttribute(nrm,3));scene.add(new THREE.Mesh(g,new THREE.MeshStandardMaterial({color,roughness,side:roughness===1?THREE.DoubleSide:THREE.FrontSide})));}batches.clear();}
 function polygon(coords,z,h,color){if(coords.length<4)return;const shape=new THREE.Shape();coords.forEach((p,i)=>{const [x,y]=world(p);i?shape.lineTo(x,y):shape.moveTo(x,y);});const g=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false});g.translate(0,0,z);batch(g,color,.94);}
 function ribbons(lines,w,z,color,zs=[]){const vertices=[];lines.forEach((coords,li)=>{const zv=zs[li];for(let i=1;i<coords.length;i++){const a=world(coords[i-1]),b=world(coords[i]),dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(!len)continue;const x=-dy/len*w/2,y=dx/len*w/2,za=z+(zv?.[i-1]??0),zb=z+(zv?.[i]??0);vertices.push(a[0]+x,a[1]+y,za,a[0]-x,a[1]-y,za,b[0]+x,b[1]+y,zb,b[0]+x,b[1]+y,zb,a[0]-x,a[1]-y,za,b[0]-x,b[1]-y,zb);}});const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.computeVertexNormals();batch(g,color,1);}
 const stationId=stationMeta.osmId,surroundingIds=new Set(surroundingsMeta.buildings.map(b=>b.id));   // 周邊建物已改用 surroundings/ 的低細節網格，這裡只剩網格沒收的建物才退回舊的灰色擠出
 for(const f of data.features){
  if(f.tags.highway)continue;   // 馬路改由 roads.js 畫（柏油、標線、人行道）
  if(f.tags.railway==='platform')polygon(f.coordinates,.06,.82,'#bcbcb0');
  else if(f.tags.building==='roof')polygon(f.coordinates,5.0,.20,'#b6bdb4');   // 雨棚板底 5.0 m：高過最高的車（E500 降弓頂 4.44 m），低於電梯橋面 5.6 m
  // 跨站橋（building=bridge）懸在軌道上方，只畫橋面；當成一般房子從地面擠出會變成列車穿過的實心方塊。
  else if(f.tags.building==='bridge')polygon(f.coordinates,5.6,.5,'#d4d5ca');
  else if(f.tags.building&&!surroundingIds.has(f.id)&&f.id!==stationId&&!f.tags.construction&&f.tags.building!=='construction')polygon(f.coordinates,.03,Math.min(24,Math.max(3,parseFloat(f.tags.height)||parseFloat(f.tags['building:levels'])*3||6)),'#d4d5ca');
 }
 // 股道的 z（snapshot 的 rails[i].z，與座標逐頂點對應；整條都在地面的沒有 z 欄位）：道碴帶與鋼軌都跟著軌道面高程走，地面段維持原本的 0.05／0.13 m。
 ribbons(data.rails.map(r=>r.coordinates),3.6,.05,'#aaa99b',data.rails.map(r=>r.z));flushBatches();
 const railVertices=[];for(const r of data.rails)for(let i=1;i<r.coordinates.length;i++){const a=world(r.coordinates[i-1]),b=world(r.coordinates[i]),dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(!len)continue;const za=.13+(r.z?.[i-1]??0),zb=.13+(r.z?.[i]??0);for(const side of [-1,1]){const ox=-dy/len*.5335*side,oy=dx/len*.5335*side;railVertices.push(a[0]+ox,a[1]+oy,za,b[0]+ox,b[1]+oy,zb);}}
 const railGeo=new THREE.BufferGeometry();railGeo.setAttribute('position',new THREE.Float32BufferAttribute(railVertices,3));scene.add(new THREE.LineSegments(railGeo,new THREE.LineBasicMaterial({color:'#515d56'})));
 // 馬路：柏油、標線、人行道（roads.js；只用封存快照的 OSM 道路標籤，是示意、不是實地測繪）。每一層一個網格，共 5 次繪製。
 // 標線與路面只差 1.5 cm，低仰角時深度解析度不夠，用 polygonOffset 把標線往前推；標線半透明（淡出用）、不寫深度。
 const roads=buildRoads(data.features,world,data.rails.map(r=>r.coordinates.map((c,i)=>[...world(c),r.z?.[i]??0])));roadMeshes={};
 for(const [name,l] of Object.entries(roads.layers)){const g=new THREE.BufferGeometry(),line=name==='white'||name==='yellow';g.setAttribute('position',new THREE.BufferAttribute(l.position,3));g.setAttribute('normal',new THREE.BufferAttribute(l.normal,3));
  const mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:ROAD.colors[name],roughness:line?.75:.95,metalness:0,transparent:line,depthWrite:!line,polygonOffset:line,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));mesh.name='road-'+name;scene.add(mesh);roadMeshes[name]=mesh;}
 fadeMarkings();
 const [stationRaw,surroundingsRaw,ugRaw]=await Promise.all([bytes('station/near.mesh.bin'),bytes('surroundings/near.mesh.bin'),bytes('underground/near.mesh.bin')]),stationData=new Float32Array(stationRaw),buffer=new THREE.InterleavedBuffer(stationData,6),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(buffer,3,0));geometry.setAttribute('normal',new THREE.InterleavedBufferAttribute(buffer,3,3));const materials=[];
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
  wrap=new THREE.Mesh(g,mats);wrap.position.copy(building.position);wrap.rotation.copy(building.rotation);wrap.visible=wrapMeta.defaultVisible!==false;wrap.renderOrder=UG_ORDER.above;scene.add(wrap);}
 const wrapButton=$('wrap'),syncWrap=()=>{wrapButton.textContent=wrap.visible?'拿掉外罩':'蓋回外罩';};
 if(wrap){syncWrap();wrapButton.onclick=()=>{wrap.visible=!wrap.visible;syncWrap();};}else wrapButton.hidden=true;
 // ── 地下化後新增：地下結構（underground/）與地面面紗 ──
 // 結構網格與站房同格式（Float32 交錯 stride 6、每種材質一個 drawGroup）；座標已是世界公尺（同 world()），網格放在 (0,0,0)、不旋轉。
 // 每個 drawGroup 一個 Mesh（共用同一份交錯緩衝、各自 setDrawRange），才能各自設畫序。材質照 model.json：opacity<1 的半透明且不寫深度，doubleSided 才雙面（U 槽的牆是兩層反向法線，不能雙面）。
 // 半透明的殼與 B1 往後推（polygonOffset）：殼的上緣在地面（z＝0），路面柏油只高 1.5 公分（roads.js 的 asphaltZ），往後推讓路面一律壓過殼。U 槽牆頂高出地面 2.2 公尺，不在這個差距內。
 const ugBuffer=new THREE.InterleavedBuffer(new Float32Array(ugRaw),6),ugMeshes={};
 for(const g of ugMeta.lods.near.drawGroups){const geo=new THREE.BufferGeometry(),o=g.opacity??1;geo.setAttribute('position',new THREE.InterleavedBufferAttribute(ugBuffer,3,0));geo.setAttribute('normal',new THREE.InterleavedBufferAttribute(ugBuffer,3,3));geo.setDrawRange(g.start,g.count);
  const mat=new THREE.MeshStandardMaterial({color:new THREE.Color(...g.color),roughness:g.roughness,metalness:g.metalness,transparent:o<1,opacity:o,depthWrite:o>=1,side:g.doubleSided?THREE.DoubleSide:THREE.FrontSide,polygonOffset:o<1,polygonOffsetFactor:1,polygonOffsetUnits:4}),mesh=new THREE.Mesh(geo,mat);
  mesh.name=g.name;mesh.renderOrder=o<1?(UG_ORDER[g.name]??UG_ORDER.ug_shell):0;scene.add(mesh);ugMeshes[g.name]=mesh;}
 // 地面面紗：地面（z=0）上一片與背景同色的半透明大板，蓋在地下的東西上，用來分辨「地面上」與「地面下」。U 槽內側（model.json 的 cutouts）挖空，引道是露天的；路面與建物都在面紗之上，不被蓋。
 // 用 MeshBasicMaterial（不受光照），在空地上與背景一模一樣、看不出來；同樣往後推（推得比殼多一點），路面柏油只高 1.5 公分，一律壓過它。
 const vb=data.bounds,[vx0,vy0]=world([vb[0],vb[1]]),[vx1,vy1]=world([vb[2],vb[3]]),VM=300;
 const veilShape=new THREE.Shape([new THREE.Vector2(vx0-VM,vy0-VM),new THREE.Vector2(vx1+VM,vy0-VM),new THREE.Vector2(vx1+VM,vy1+VM),new THREE.Vector2(vx0-VM,vy1+VM)]);
 for(const c of ugMeta.cutouts||[])veilShape.holes.push(new THREE.Path(c.ring.map(p=>new THREE.Vector2(p[0],p[1]))));
 const veil=new THREE.Mesh(new THREE.ShapeGeometry(veilShape),new THREE.MeshBasicMaterial({color:BG,transparent:true,opacity:VEIL_OPACITY,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:2,polygonOffsetUnits:8}));
 veil.name='ground-veil';veil.renderOrder=UG_ORDER.veil;scene.add(veil);
 const setVeilOpacity=v=>{veil.material.opacity=v;veil.visible=v>0;};
 // 臺南站月台中心：剖面參考線（profile.json）在 centerD 的位置與軌道面高程；停靠時整列的中心停在這裡（snapshot.underground.stop）。
 const ugPlatform=data.underground.platform,refPoints=ugProfile.reference.points,ctl=ugProfile.controlPoints;
 const refAt=d=>{let lo=0,hi=refPoints.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(refPoints[mid][2]<=d)lo=mid;else hi=mid;}const a=refPoints[lo],b=refPoints[hi],f=Math.max(0,Math.min(1,(d-a[2])/((b[2]-a[2])||1)));return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];};
 const profileZ=d=>{let i=0;while(i<ctl.length-2&&ctl[i+1].d<=d)i++;const a=ctl[i],b=ctl[i+1],f=Math.max(0,Math.min(1,(d-a.d)/((b.d-a.d)||1)));return a.z+(b.z-a.z)*f;};
 const platformXY=refAt(ugPlatform.centerD),platformZ=profileZ(ugPlatform.centerD);
 // 車廂網格分兩級：遠景檔（約 90 KB）開機就載；近景檔（約 0.6 MB）首幀之後才在背景載入，載完 state.nearReady=true。
 // 車廂 1 單位＝1 公尺、一律不縮放；各車型真實連結器間距 pitchM 記在 fleet/catalog.json。
 const carMaterial=createWenhuMaterial(THREE),lodGeo={far:new Map(),near:new Map()},fleetMeshes=Object.entries(fleet.meshes);
 const loadLod=async kind=>{for(let i=0;i<fleetMeshes.length;i+=3)await Promise.all(fleetMeshes.slice(i,i+3).map(async([id,m])=>lodGeo[kind].set(id,createWenhuGeometry(THREE,{data:new Float32Array(await bytes('fleet/'+m[kind].file))}))));};
 await loadLod('far');
 const paths=data.routes.map(r=>makePath(r.coordinates)),models=new Map(),labels=[];
 // 軌道面高程（地面＝0）：routes[i].z 與座標逐頂點對應，沿里程線性內插；整條都在地面的路線沒有 z 欄位。
 const zOf=(route,s)=>{const z=data.routes[route].z;if(!z)return 0;const d=paths[route].d,n=d.length-1;if(s<=0)return z[0];if(s>=d[n])return z[n];let lo=0,hi=n;while(hi-lo>1){const mid=(lo+hi)>>1;if(d[mid]<=s)lo=mid;else hi=mid;}return z[lo]+(z[hi]-z[lo])*((s-d[lo])/((d[hi]-d[lo])||1));};
 function label(text,coordinate,kind=''){const e=document.createElement('span');e.className='map-label '+kind;e.textContent=text;$('labels').append(e);const item={e,coordinate,z:0};labels.push(item);return item;}
 data.stations.forEach(s=>label(s.name,[s.lon,s.lat]));label('臺南舊站房',stationMeta.anchor);
 // 新欄位（timing、stops[].src／schedArrSec／holdSec）一律用 ?. 防呆：缺欄位時只是少了旗標與逐站時刻，頁面照常開。
 const SRC={obs:'實測',interp:'內插',sched:'表定',est:'推定'},DEP_SRC={obs:'est',interp:'interp',est:'est',sched:'sched'},isTainan=s=>s.name.replace('台','臺')==='臺南',tainanStop=tr=>tr.stops.find(isTainan),anchorStop=tr=>tainanStop(tr)||tr.stops[0];
 // 標籤上的來源旗標：整班沒有即時動態紀錄＝「無即時動態紀錄」；其餘看 anchorStop（臺南那一列，沒經過臺南的班次看第一列）的來源：實測／內插／推定／表定。
 // 起點站沒有到站，那一列的 src 記的是開車時刻的來源（看板紀錄的誤點分鐘推出來的＝推定）。沒有來源就不掛旗標，不預設成實測。
 // 資料是預覽班表（snapshot.preview）時每一班都是表定：由徽章與說明文字統一標示，標籤不重複掛旗標；預覽消失後自動回到上面的規則。
 function trainFlag(tr){if(data.preview)return null;if(tr.timing==='scheduled')return {key:'sched',text:'無即時動態紀錄'};if(!tr.timing)return null;const k=anchorStop(tr)?.src;return SRC[k]?{key:k,text:SRC[k]}:null;}
 function trainLabel(tr){const e=document.createElement('span'),main=document.createElement('span'),flag=trainFlag(tr);e.className='map-label train-label';main.className='lt';main.textContent=tr.train+' '+tr.direction;e.append(main);
  if(flag){const f=document.createElement('span');f.className='flag flag-'+flag.key;f.textContent=flag.text;e.append(f);e.dataset.src=flag.key;}
  $('labels').append(e);const item={e,coordinate:null,z:0};labels.push(item);return item;}
 // 依真實比例重排編組：每輛用該車型的連結器間距（pitchM）首尾相接，以編組中心為基準置中；車體不拉伸。
 // 逐輛網格與轉向來自 catalog 的 formations（EP 集電弓車、機車端客車…），輛數必須與封存班表的編組一致。
 // listedFor＝車序是照哪個方向的領頭車排的（EMU3000 1 號車在屏東／高雄端＝南下領頭）；反方向就整列倒過來、每輛轉 180°。
 function arrange(tr){const rule=fleet.formations[tr.formation.id];if(!rule||rule.cars.length!==tr.formation.parts.length)throw Error('缺少編組規則：'+tr.formation.id);
  const cars=rule.listedFor&&tr.direction!==rule.listedFor?rule.cars.slice().reverse().map(c=>({mesh:c.mesh,flip:!c.flip})):rule.cars;
  const parts=cars.map(c=>({mesh:c.mesh,flip:c.flip,lengthM:fleet.meshes[c.mesh].pitchM,offsetM:0}));let front=parts.reduce((a,c)=>a+c.lengthM,0)/2;for(const c of parts){c.offsetM=front-c.lengthM/2;front-=c.lengthM;}return parts;}
 for(const tr of data.trains){const group=new THREE.Group(),parts=arrange(tr),cars=parts.map(part=>{const car=new THREE.Group(),mesh=new THREE.Mesh(lodGeo.far.get(part.mesh),carMaterial);mesh.userData.mesh=part.mesh;if(part.flip)mesh.rotation.z=Math.PI;car.add(mesh);group.add(car);return car;});group.visible=false;scene.add(group);models.set(tr.id,{group,cars,parts,label:trainLabel(tr)});}
 // 近景／遠景切換：只換每輛車的 geometry（catalog.lod 有門檻，中間帶保持現狀，避免縮放時來回跳）。
 const setLod=next=>{if(next===state.lod)return;state.lod=next;for(const m of models.values())for(const car of m.cars){const mesh=car.children[0];mesh.geometry=lodGeo[next].get(mesh.userData.mesh);}};
 const byArrival=[...data.trains].filter(tr=>tr.stops.length).sort((a,b)=>anchorStop(a).arrSec-anchorStop(b).arrSec);
 // 下拉選單照到臺南的時間排（沒經過臺南的班次看第一站）；預覽班表時每一班都是表定，不逐班加註。
 for(const tr of byArrival){const o=document.createElement('option');o.value=tr.id;o.textContent=clock(cleanSec(anchorStop(tr).arrSec)).slice(0,5)+' · '+tr.train+' '+tr.typeName+' '+tr.direction+(!data.preview&&tr.timing==='scheduled'?' · 表定':'');$('train').append(o);}
 function sample(tr,sec){const segment=tr.spans.find(s=>sec>=s.start&&sec<=s.start+s.s.length-1);if(!segment)return null;const f=sec-segment.start,i=Math.min(segment.s.length-1,Math.floor(f)),s=segment.s[i]+((segment.s[i+1]??segment.s[i])-segment.s[i])*(f-i),path=paths[segment.route],p=path.at(s);if(!p)return null;return {path,s,coordinate:p.coordinate,route:segment.route,z:zOf(segment.route,s)};}
 function updateTime(){const s=Math.floor(state.sec);$('clock').textContent=clock(s);$('timeline').value=s;if(document.activeElement!==$('time'))$('time').value=clock(s);}
 function jump(sec){state.sec=cleanSec(sec);updateTime();}
 // 開始（或取消）跟車。這班車此刻不在畫面內就跳到它進入畫面的第一秒。
 function followTrain(id){state.follow=id||'';$('train').value=state.follow;if(!state.follow)return;const tr=data.trains.find(t=>t.id===state.follow);if(!sample(tr,state.sec))jump(tr.spans[0].start);span=330;view();}
 // ── 跟車逐站時刻卡：站／表定／重播／來源／差多少／留置（holdSec≥90 秒才算）。來源緊接在重播後面：側欄窄、表格要左右捲時，先被切掉的是差與留置；右邊還有欄位時右緣有淡出提示。
 // 來源分到站與開車兩行。到站照 src：obs 實測、interp 內插、sched 表定。開車照 DEP_SRC：obs 的站（含被留置的通過站）是表定加誤點分鐘推得＝推定；interp 的站到站與開車都由鄰近的站推算＝內插；
 // 起點站（est）的紀錄是看板佔位，只用它的誤點分鐘推開車時刻＝推定；sched＝表定。起點站（end 'origin'）到站與開車同一秒＝沒有到站，終點站（end 'terminal'）同理沒有開車：
 // 那一行在表定、重播、來源、差都記「—」；到、開不同秒的起訖站照常兩行。通過站（沒有留置）只有一行。時間一律是當天的時鐘時間，跨午夜的前一營運日用「前日」「次日」標明。──
 const T=sec=>{if(!Number.isFinite(sec))return '—';const r=Math.round(sec),d=Math.floor(r/86400);return (d<0?'前日 ':d>0?'次日 ':'')+clock(r-d*86400);};
 const DUR=sec=>{const s=Math.round(Math.abs(sec)),m=Math.floor(s/60),r=s%60;return (m?m+'分':'')+(r||!m?r+'秒':'');},DIFF=d=>!Number.isFinite(d)?'—':Math.abs(d)<5?'準點':(d>0?'晚':'早')+DUR(d);
 const card=$('followcard'),FP_HINT=$('fpToggle').querySelector('.s').textContent;let cardFor=null,cardRows=[],cardStatus=null,cardMore=null;
 const lines=(tag,...ls)=>{const c=document.createElement(tag);for(const l of ls){const s=document.createElement('span');s.className='ln';s.textContent=l;c.append(s);}return c;};
 function renderCard(tr){card.replaceChildren();const h=document.createElement('h3'),no=document.createElement('span'),ty=document.createElement('span');no.textContent=tr.train+' 次';ty.className='ty';ty.textContent=tr.typeName+' '+tr.direction;h.append(no,ty);
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
  const note=document.createElement('p');note.className='note';note.textContent=tr.timing==='scheduled'?(data.preview?'預覽班表：這班車照表定時刻畫，沒有誤點；實際到離站紀錄之後補上。':'這班車沒有任何即時動態紀錄，整班照時刻表畫。'):'時刻依即時動態紀錄推算，到站誤差約半分鐘。實測＝取自紀錄的到站或通過時刻；內插＝這一站沒有可用的紀錄，到站與開車都由鄰近的站推算；推定＝紀錄裡沒有開車時刻，用表定加上當時的誤點分鐘推算，可能差一分鐘左右；留置＝比表定多停 90 秒以上；「—」＝起點站沒有到站、終點站沒有開車。';
  card.append(h,cardStatus,twr,note);}
 function refreshCard(){const tr=state.follow?data.trains.find(t=>t.id===state.follow):null,hint=$('fpToggle').querySelector('.s');if(!tr){card.hidden=true;if(!panel.hidden){panel.hidden=true;applyPanel();}if(cardFor!==null){cardFor=null;hint.textContent=FP_HINT;}return;}
  if(cardFor!==tr.id){renderCard(tr);cardFor=tr.id;hint.textContent='跟車中：'+tr.train+' 次的逐站時刻';}card.hidden=false;if(panel.hidden){panel.hidden=false;applyPanel();}const sec=state.sec;
  for(const {row,s} of cardRows){const slack=s.stop===false?10:0,st=sec>s.depSec+slack?'past':sec>=s.arrSec-slack?'now':'future';if(row.dataset.state!==st)row.dataset.state=st;}
  const first=tr.stops[0],last=tr.stops[tr.stops.length-1],here=tr.stops.find(s=>(s.stop!==false||Number(s.holdSec)>=90)&&sec>=s.arrSec&&sec<=s.depSec),next=tr.stops.find(s=>sec<s.arrSec);
  cardStatus.textContent=(here?'停在'+here.name:sec<first.arrSec?'尚未到'+first.name:sec>last.depSec?'已駛離最後一站':next?'行駛中，下一站'+next.name:'行駛中')+(sample(tr,sec)?'':'（目前在畫面範圍外）')+(tr.timing==='scheduled'?(data.preview?'；預覽班表，照表定時刻':'；沒有即時動態紀錄，照表定時刻'):'');}
 // ── 文案跟著資料走：預覽班表（snapshot.preview）才顯示的段落與徽章；預覽消失後徽章回到「實測時刻重建」、預覽段落自動隱藏 ──
 for(const e of document.querySelectorAll('[data-show="preview"]'))e.hidden=!data.preview;
 $('badge').textContent=data.preview?'預覽班表・表定時刻':'實測時刻重建';
 const PREVIEW_CAPTION='預覽版：依 10/15 發布的預覽班表、照表定時刻行駛；實際到離站紀錄之後補上。';
 // ── 字幕：不確定時段依 reason 分兩種寫法 ──
 const reasonsOf=id=>{const r=new Set();for(const i of uncertainty.intervals)if(state.sec>=i.start&&state.sec<=i.end&&i.trains.includes(id))r.add(i.reason||'track-overlap');return r.size?r:new Set(['track-overlap']);},TAIL=' 次暫以車次標記呈現；位置仍依重建的時刻推演。';
 function captionText(pending){
  if(pending.length){const g={'single-line-unresolved':[],'track-overlap':[]};for(const t of pending)for(const r of reasonsOf(t.id))(g[r]||g['track-overlap']).push(t.train);
   return [g['single-line-unresolved'].length&&'封鎖初期股道安排不明：'+g['single-line-unresolved'].join('、')+TAIL,g['track-overlap'].length&&'股道安排待確認：'+g['track-overlap'].join('、')+TAIL].filter(Boolean).join(' ');}
  const follow=data.trains.find(t=>t.id===state.follow);
  if(follow)return [follow.train+' 次',follow.formation.caption,follow.timing==='scheduled'?(data.preview?'預覽班表，照表定時刻':'無即時動態紀錄，照表定時刻'):follow.timing?'時刻依即時動態紀錄重建':'依封存班表推演'].filter(Boolean).join(' · ');
  return data.preview?PREVIEW_CAPTION:'封存 '+data.trains.length+' 班 · 時刻依即時動態紀錄重建，非 GPS 軌跡；區間車與莒光號的編組為推估。';}
 // 「舊站近景」連方位、仰角、縮放一起回預設；「下一班到臺南」「臺南發車」只跳時間、把畫面中心移到臺南站月台中央（在地下，連高度一起移），方位、仰角、縮放照按之前的。三顆都取消跟車。
 // 「下一班到臺南」只算會停臺南的班次：沒經過臺南的班次，anchorStop 是第一站，不能拿來排。在臺南始發的班次沒有到站，不算進「下一班到臺南」，
 // 另由「臺南發車」跳到開車前 LEAD 秒：始發車只有開車時刻，在開車那一秒才出現，所以先看到空月台，車出現就開走。
 function centerStation(){state.follow='';$('train').value='';target.set(stationXY[0]+18,stationXY[1],0);}
 function centerPlatform(){state.follow='';$('train').value='';target.set(platformXY[0],platformXY[1],platformZ);}
 function stationView(){centerStation();span=140;azimuth=3.6;tilt=TILT0;view();}
 function homeView(){state.follow='';$('train').value='';target.set(HOME.x,HOME.y,HOME.z);span=HOME.span;azimuth=HOME.azimuth;tilt=HOME.tilt;view();}
 // 驗收與截圖用：直接指定鏡頭（沒給的欄位不動），或讀目前的鏡頭。
 const getView=()=>({x:target.x,y:target.y,z:target.z,span,azimuth,tilt});
 function setView(v={}){if(v.x!=null)target.x=v.x;if(v.y!=null)target.y=v.y;if(v.z!=null)target.z=v.z;if(v.span!=null)span=v.span;if(v.azimuth!=null)azimuth=v.azimuth;if(v.tilt!=null)tilt=v.tilt;view();}
 $('station').onclick=stationView;$('overview').onclick=()=>{state.follow='';$('train').value='';target.set(400,-3250,0);span=10500;view();};
 $('rotate').onclick=()=>{azimuth+=Math.PI/4;view();};$('zoomin').onclick=()=>{span=Math.max(34,span/1.5);view();};$('zoomout').onclick=()=>{span=Math.min(14000,span*1.5);view();};
 $('timeline').oninput=e=>jump(Number(e.target.value));$('time').onchange=e=>{const [h,m,s=0]=e.target.value.split(':').map(Number);jump(h*3600+m*60+s);};
 $('play').onclick=()=>{state.playing=!state.playing;$('play').textContent=state.playing?'暫停':'播放';$('play').setAttribute('aria-label',state.playing?'暫停重播':'播放重播');};
 $('speed').onchange=e=>state.speed=Number(e.target.value);
 // 兩顆都只算重播範圍內（23:59:59 以前）到站／開車的班次：隔天凌晨才到臺南的跨午夜車（例如 0:01 到站）跳不過去，算進去的話按了會停在 23:59:59、再按也不動。
 const LEAD=25,toTainan=byArrival.filter(tr=>tainanStop(tr)&&tainanStop(tr).end!=='origin').filter(tr=>tainanStop(tr).arrSec<=86399),fromTainan=data.trains.filter(tr=>tainanStop(tr)?.end==='origin').filter(tr=>tainanStop(tr).depSec<=86399).sort((a,b)=>tainanStop(a).depSec-tainanStop(b).depSec);
 const jumpNext=(list,at)=>{const next=list.find(tr=>at(tr)>state.sec+LEAD)||list[0];jump(at(next)-LEAD);centerPlatform();view();};
 $('next').onclick=()=>jumpNext(toTainan,tr=>tainanStop(tr).arrSec);$('depart').onclick=()=>jumpNext(fromTainan,tr=>tainanStop(tr).depSec);$('depart').hidden=!fromTainan.length;
 $('train').onchange=e=>followTrain(e.target.value);
 $('about').onclick=$('aboutNav').onclick=()=>{$('details').showModal();};
 // 手勢：單指或左鍵拖曳平移；雙指捏合縮放＋轉動改方位、雙指一起上下推改傾斜（兩指合計移動 16 px 後判定是哪一種，這次手勢就鎖定，判定前的位移在判定當下一次補上）。
 // 判定要等兩指都離開起點 2 px 以上；只有一指在動（另一指按著不動）時，等那一指走到 48 px 再判定。傾斜＝兩指各自以上下為主、方向相同（同 MapLibre 的雙指傾斜）。
 // 不看兩指連線的角度與距離：瀏覽器一指一個 pointermove 依序送，判定當下常是一指多走一步或先動，兩指靠近或上下疊著推時連線會斜、距離會變，會被誤判成捏合、推了沒反應。
 // 三指以上不動鏡頭，回到兩指時用剩下的兩指重新起算。
 // 滑鼠右鍵（或按住 Shift／Ctrl／⌘／Alt）拖曳：左右改方位、上下改傾斜。往下推＝更接近俯視，往上推＝更接近地平。
 const pointers=new Map();let pair=null,rotating=false,menuBlockUntil=0;const ROT_PER_PX=.006,TILT_PER_PX=.005,turn=a=>Math.atan2(Math.sin(a),Math.cos(a));
 const twoFinger=()=>{const [a,b]=[...pointers.values()];return {a,b,d:Math.hypot(a[0]-b[0],a[1]-b[1]),angle:Math.atan2(b[1]-a[1],b[0]-a[0]),cy:(a[1]+b[1])/2};};
 const newPair=()=>{const g=twoFinger();return {start:g,last:g,mode:''};};
 renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
 // Windows 在放開右鍵時才送 contextmenu、目標是游標底下的元素：右鍵拖曳轉向後在畫布外（按鈕、面板）放開，也不跳選單。
 addEventListener('contextmenu',e=>{if(rotating||performance.now()<menuBlockUntil)e.preventDefault();},true);
 renderer.domElement.addEventListener('pointerdown',e=>{pointers.set(e.pointerId,[e.clientX,e.clientY]);try{renderer.domElement.setPointerCapture(e.pointerId);}catch{}pair=pointers.size===2?newPair():null;state.follow='';$('train').value='';});
 renderer.domElement.addEventListener('pointermove',e=>{const before=pointers.get(e.pointerId);if(!before)return;pointers.set(e.pointerId,[e.clientX,e.clientY]);const mx=e.clientX-before[0],my=e.clientY-before[1];
  if(pointers.size===2&&pair){const g=twoFinger(),s=pair.start,da=Math.hypot(g.a[0]-s.a[0],g.a[1]-s.a[1]),db=Math.hypot(g.b[0]-s.b[0],g.b[1]-s.b[1]);
   if(!pair.mode&&da+db>16&&(Math.min(da,db)>=2||Math.max(da,db)>48)){const ay=g.a[1]-s.a[1],by=g.b[1]-s.b[1],ax=g.a[0]-s.a[0],bx=g.b[0]-s.b[0];pair.mode=Math.min(da,db)>=2&&ay*by>0&&Math.abs(ay)>Math.abs(ax)&&Math.abs(by)>Math.abs(bx)?'tilt':'pinch';pair.last=s;}
   if(pair.mode==='tilt')tilt+=(g.cy-pair.last.cy)*TILT_PER_PX;else if(pair.mode==='pinch'){span=Math.max(34,Math.min(14000,span*pair.last.d/g.d));azimuth+=turn(g.angle-pair.last.angle);}
   pair.last=g;}
  else if(pointers.size===1&&e.pointerType==='mouse'&&(e.buttons&2||e.shiftKey||e.ctrlKey||e.metaKey||e.altKey)){azimuth-=mx*ROT_PER_PX;tilt+=my*TILT_PER_PX;rotating=true;}
  // 平移：地面點要跟著手指走。畫面上下移動 dy 對應地面沿視線方向移動 dy/sin(仰角)（up 軸水平分量長度＝sin(仰角)）。
  else if(pointers.size===1){const z0=target.z,dx=mx*span/height,dy=my*span/height;const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1),h=Math.max(.1,Math.hypot(up.x,up.y));target.addScaledVector(right,-dx);target.addScaledVector(up,dy/(h*h));target.z=z0;}
  view();});
 for(const event of ['pointerup','pointercancel','lostpointercapture'])renderer.domElement.addEventListener(event,e=>{if(!pointers.delete(e.pointerId))return;pair=pointers.size===2?newPair():null;if(rotating&&!pointers.size){rotating=false;menuBlockUntil=performance.now()+500;}});
 renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();span=Math.max(34,Math.min(14000,span*Math.exp(e.deltaY*.001)));view();},{passive:false});
 let last=performance.now(),lastSecond=-1,shownFollow=null;const active=[];
 // rAF 的時間戳可能比 last（宣告當下的 performance.now()）早一點：dt 不小於 0，免得第一幀把 22:00:00 倒退成 21:59:59。
 function draw(now){requestAnimationFrame(draw);const dt=Math.max(0,Math.min(.1,(now-last)/1000));last=now;if(document.hidden)return;if(state.nearReady)setLod(span<fleet.lod.nearBelowSpan?'near':span>fleet.lod.farAboveSpan?'far':state.lod);if(state.playing&&!$('details').open)state.sec=(state.sec+dt*state.speed)%86400;active.length=0;
  const uncertain=new Set(uncertainty.intervals.filter(i=>state.sec>=i.start&&state.sec<=i.end).flatMap(i=>i.trains));
  for(const tr of data.trains){const m=models.get(tr.id),p=sample(tr,state.sec);m.group.visible=!!p&&!uncertain.has(tr.id);m.label.coordinate=p?.coordinate||null;m.label.z=p?.z||0;m.label.e.classList.toggle('uncertain',uncertain.has(tr.id));m.label.e.classList.toggle('following',state.follow===tr.id);if(!p)continue;const poses=formationPoses(p.path,p.s,1,m.parts,c=>zOf(p.route,c)+.16);if(!poses){m.group.visible=false;m.label.coordinate=null;continue;}active.push({id:tr.id,train:tr.train,direction:tr.direction,route:p.route,s:p.s,z:p.z,coordinate:p.coordinate,trackUncertain:uncertain.has(tr.id)});poses.forEach((pose,i)=>{const xy=world(pose.coordinate);m.cars[i].position.set(...xy,pose.height);m.cars[i].rotation.set(0,-pose.pitch,pose.angle,'ZYX');});if(state.follow===tr.id){target.set(...world(p.coordinate),p.z);view();}}
  const occupied=[];for(const l of labels){if(!l.coordinate){l.e.hidden=true;continue;}const xy=world(l.coordinate),p=new THREE.Vector3(...xy,7+(l.z||0)).project(camera),x=(p.x*.5+.5)*width,y=(-p.y*.5+.5)*height;const visible=p.z>=-1&&p.z<=1&&x>0&&x<width&&y>55&&y<height-30;l.e.hidden=!visible;if(visible){l.e.style.transform=`translate(${x}px,${y}px) translate(-50%,-100%)`;if(!l.e.classList.contains('train-label')){const b=l.e.getBoundingClientRect();if(occupied.some(a=>b.left<a.right&&b.right>a.left&&b.top<a.bottom&&b.bottom>a.top))l.e.hidden=true;else occupied.push(b);}}}
  renderer.render(scene,camera);state.frames++;
  // 每個整秒、或跟車對象換了（下拉選單、拖曳取消跟車）就更新字幕與跟車卡。
  if(Math.floor(state.sec)!==lastSecond||shownFollow!==state.follow){lastSecond=Math.floor(state.sec);shownFollow=state.follow;updateTime();$('running').textContent='區間內 '+active.length+' 班';const pending=active.filter(t=>t.trackUncertain);$('caption').textContent=captionText(pending);$('caption').classList.toggle('uncertain',!!pending.length);refreshCard();}}
 // 可重現的驗收介面：封存資料、時間與車廂沿軌座標均可核對，無外部寫入。
 window.tainanMemory={state,data,sample,paths,models,active,jump,stationView,renderer,camera,uncertainty,fleet,wrap,surroundings:{mesh:surroundings,meta:surroundingsMeta},roads:{meshes:roadMeshes,stats:roads.stats,ways:roads.ways},underground:{meta:ugMeta,profile:ugProfile,meshes:ugMeshes,veil,setVeilOpacity,order:UG_ORDER,platform:{...ugPlatform,xy:platformXY,z:platformZ}},zOf,home:HOME,homeView,setView,getView,followTrain,panel:{isOpen:panelOpen,setOpen:setPanel}};homeView();updateTime();state.ready=true;status.hidden=true;requestAnimationFrame(draw);loadLod('near').then(()=>{state.nearReady=true;},e=>console.error(e));
}catch(error){console.error(error);status.replaceChildren();const p=document.createElement('p');p.textContent='這份回憶暫時無法載入：'+error.message;const retry=document.createElement('button');retry.textContent='重新載入';retry.onclick=()=>location.reload();status.append(p,retry);}
