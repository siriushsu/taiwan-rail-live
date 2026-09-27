// 南迴海岸輕量精緻化（停站／候車的人／站務員／棕櫚）驗收。用法：node scripts/verify_garage_south_coast_stop.mjs
// 伺服器：python3 -m http.server 5251（worktree 根目錄）。瀏覽器一律無視窗：channel:'chrome'+headless:true。
// 只用 chromium（不比照既有 south_coast/follow_camera/train_lights 三支再測 webkit）：
// 這幾條判準是「時刻表接線／相機切換／人數與座標」這類整合邏輯，不是逐引擎才會分歧的算繪細節，
// 既有三支既有 baseline 已經涵蓋跨引擎算繪，這裡刻意輕量、只測 chromium。
import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import * as THREE from '../rail-3d/vendor/three.module.js';
import {createScene} from '../rail-3d/garage-scenes/south-coast.js';
import {buildGarageParts} from '../rail-3d/garage-parts.js';
// 頁面網址不命名為 URL：那會蓋掉 Node 的全域 URL 類別（檔尾要用 new URL() 讀原始碼）。
const PAGE_URL='http://127.0.0.1:5251/prototypes/garage-south-coast/';
const results=[];function check(name,pass,detail){results.push({name,pass:!!pass});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail??'').slice(0,300));}

// ── 純 Node（不需要瀏覽器）：棕櫚物種計數／整棵高度／樹冠體積／椰子果位置＋站務員方塊座標一致性，
// 直接讀 createScene() 的 instanced mesh。棕櫚改用 Blender 零件庫（見 scripts/blender/palms-20260928/），
// 這裡跟瀏覽器端 main.js 一樣用 loadGarageParts 的 Node 版本（fs+zlib 取代 fetch）讀同一份正式資產。──
const ASSET_DIR=new URL('../rail-3d/assets/garage-palms-v1/',import.meta.url);
const palmsMeta=JSON.parse(readFileSync(new URL('palms.json',ASSET_DIR),'utf8'));
const palmsRaw=gunzipSync(readFileSync(new URL('palms.bin.gz',ASSET_DIR)));
const palmsKit=buildGarageParts(palmsMeta,palmsRaw.buffer.slice(palmsRaw.byteOffset,palmsRaw.byteOffset+palmsRaw.byteLength));

function extract(scene){const list=[];scene.group.traverse(o=>{if(!o.isInstancedMesh)return;
 const vcount=o.geometry.attributes.position.count,color=o.material.color?o.material.color.getHexString():'?';
 const items=[];const m=new THREE.Matrix4(),pos=new THREE.Vector3(),quat=new THREE.Quaternion(),scl=new THREE.Vector3();
 for(let i=0;i<o.count;i++){o.getMatrixAt(i,m);m.decompose(pos,quat,scl);items.push({x:+pos.x.toFixed(6),y:+pos.y.toFixed(6),z:+pos.z.toFixed(6)});}
 list.push({name:o.name,vcount,color,count:o.count,items});});return list;}
const scene=createScene(palmsKit),groups=extract(scene);
const meshByName=new Map();scene.group.traverse(o=>{if(o.isInstancedMesh&&o.name)meshByName.set(o.name,o);});
const oldBroadleaf=groups.filter(g=>['4e7158','668363','8c9c70'].includes(g.color)).reduce((s,g)=>s+g.count,0);
const betelTrunkMesh=meshByName.get('palm-betel-trunk'),cocoTrunkMesh=meshByName.get('palm-coco-trunk');
const betelFrondMesh=meshByName.get('palm-betel-fronds'),cocoFrondMesh=meshByName.get('palm-coco-fronds');
const betelCrownMesh=meshByName.get('palm-betel-crownshaft'),cocoFruitMesh=meshByName.get('palm-coco-fruit');
const betelCount=betelTrunkMesh?.count??0,cocoCount=cocoTrunkMesh?.count??0,totalTrees=betelCount+cocoCount;
check('南迴-棕櫚 species 檳榔與椰子皆有實例、舊闊葉樹（3 色 crown）殘留數＝0、總棵數在 150～220',
 betelCount>0&&cocoCount>0&&oldBroadleaf===0&&totalTrees>=150&&totalTrees<=220,
 {betelCount,cocoCount,totalTrees,oldBroadleaf});

// 逐頂點量測世界座標範圍（不是 peopleBounds() 那套「轉局部包圍盒 8 角」）：棕櫚扇葉剖面是「風箏」
// 四點，局部包圍盒角大多是幽靈角（不對應任何真實頂點——例如 y=±寬度 同時 z=+摺痕高，這兩者只在不同
// 頂點各自成立，不會同時發生），轉包圍盒角在這個剖面上會嚴重高估：本輪第一版曾量到某棵椰子樹「高度」
// 3.68，逐頂點重量只有 2.3 附近，差距純粹是測量假象。这份 verify 刻意不沿用 peopleBounds() 的技巧。
function localVerts(mesh){const pos=mesh.geometry.attributes.position,out=[];for(let i=0;i<pos.count;i++)out.push(new THREE.Vector3(pos.getX(i),pos.getY(i),pos.getZ(i)));return out;}
function decomposeAt(mesh,idx){const m=new THREE.Matrix4();mesh.getMatrixAt(idx,m);const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();m.decompose(p,q,s);return{m,p,q,s};}
function worldExtent(mesh,idx,verts){const {m}=decomposeAt(mesh,idx);let minZ=Infinity,maxZ=-Infinity,minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;const v=new THREE.Vector3();
 for(const lv of verts){v.copy(lv).applyMatrix4(m);if(v.z<minZ)minZ=v.z;if(v.z>maxZ)maxZ=v.z;if(v.x<minX)minX=v.x;if(v.x>maxX)maxX=v.x;if(v.y<minY)minY=v.y;if(v.y>maxY)maxY=v.y;}
 return{minZ,maxZ,minX,maxX,minY,maxY};}
function minMax(list,key){if(!list.length)return[null,null];let lo=Infinity,hi=-Infinity;for(const it of list){if(it[key]<lo)lo=it[key];if(it[key]>hi)hi=it[key];}return[+lo.toFixed(4),+hi.toFixed(4)];}

const BETEL_FRONDS=9,COCO_FRONDS=13;
const HEIGHT_RANGE={betel:[2.2,2.8],coco:[1.8,2.6]}; // 使用者裁示的整棵高度範圍（縮景比例，非真實比例，見 AGENTS.md 同族裁示的記法）。
// 09-28 退回重做：後排（south-coast.js loop2，車站周邊平地）原本只縮樹冠、樹幹留全高，全景看起來是
// 「光禿的火柴棒」。改成整棵（樹幹高／粗／topZ／設計 diam）用同一個 BACK_ROW_SCALE 等比例縮小成幼樹
// ——兩邊改這個值要一起改。後排高度範圍＝前排 coco 範圍乘上同一個縮放係數（不是另外憑空訂的數字），
// 前／後排用 trunk 世界座標 y 分辨：loop1（山坡）y∈[1.2,8.6]，loop2（平地）y∈[12,16.4]，10 是安全分界。
const BACK_ROW_SCALE=.45,BACK_ROW_Y=10;
const HEIGHT_RANGE_COCO_BACK=[HEIGHT_RANGE.coco[0]*BACK_ROW_SCALE,HEIGHT_RANGE.coco[1]*BACK_ROW_SCALE];
// 樹冠比例門檻（抓火柴棒）：只縮樹冠、不縮樹幹會讓 diam/height 掉到很小；.35／.5 分別是 betelSize()／
// cocoSize() 設計公式裡 diam/topZ 的下限（u=0 時），量測後前排最細的樹一度貼著／略低於這兩個數字，
// 已把 BETEL_SPREAD_MULT／COCO_SPREAD_MULT（south-coast.js）小幅調大到全數清門檻，不是改門檻遷就它。
const CANOPY_RATIO_FLOOR={betel:.35,coco:.5};
function analyzeSpecies(trunkMesh,frondMesh,frondsPerTree,crownMesh){
 if(!trunkMesh||!frondMesh)return[];
 const frondVerts=localVerts(frondMesh),out=[];
 for(let t=0;t<trunkMesh.count;t++){
  const {p:tp}=decomposeAt(trunkMesh,t),groundZ=tp.z;
  let maxZ=-Infinity,minZ=Infinity,bxMin=Infinity,bxMax=-Infinity,byMin=Infinity,byMax=-Infinity;
  const s=t*frondsPerTree,e=Math.min(s+frondsPerTree,frondMesh.count);
  for(let i=s;i<e;i++){const ext=worldExtent(frondMesh,i,frondVerts);
   maxZ=Math.max(maxZ,ext.maxZ);minZ=Math.min(minZ,ext.minZ);
   bxMin=Math.min(bxMin,ext.minX);bxMax=Math.max(bxMax,ext.maxX);byMin=Math.min(byMin,ext.minY);byMax=Math.max(byMax,ext.maxY);}
  const diam=Math.max(bxMax-bxMin,byMax-byMin);let crownTop=maxZ;
  if(crownMesh){const {p:cp,s:cs}=decomposeAt(crownMesh,t);crownTop=Math.max(crownTop,cp.z+cs.z);}
  const height=crownTop-groundZ;
  out.push({t,height,diam,thickRatio:(maxZ-minZ)/diam,ratio:diam/height,cx:tp.x,cy:tp.y});
 }
 return out;
}
const betelTrees=analyzeSpecies(betelTrunkMesh,betelFrondMesh,BETEL_FRONDS,betelCrownMesh);
const cocoTrees=analyzeSpecies(cocoTrunkMesh,cocoFrondMesh,COCO_FRONDS,null);
const cocoFront=cocoTrees.filter(t=>t.cy<BACK_ROW_Y),cocoBack=cocoTrees.filter(t=>t.cy>=BACK_ROW_Y);

const betelHeightOk=betelTrees.every(t=>t.height>=HEIGHT_RANGE.betel[0]&&t.height<=HEIGHT_RANGE.betel[1]);
const cocoFrontHeightOk=cocoFront.every(t=>t.height>=HEIGHT_RANGE.coco[0]&&t.height<=HEIGHT_RANGE.coco[1]);
const cocoBackHeightOk=cocoBack.length>0&&cocoBack.every(t=>t.height>=HEIGHT_RANGE_COCO_BACK[0]&&t.height<=HEIGHT_RANGE_COCO_BACK[1]);
check('南迴-棕櫚 height 每棵樹整棵高度都落在該物種目標範圍內（前排/後排 coco 分開比對各自範圍，太高或太矮都算不過）',
 betelHeightOk&&cocoFrontHeightOk&&cocoBackHeightOk,
 {betelRange:minMax(betelTrees,'height'),cocoFrontRange:minMax(cocoFront,'height'),cocoBackRange:minMax(cocoBack,'height'),
  target:{betel:HEIGHT_RANGE.betel,cocoFront:HEIGHT_RANGE.coco,cocoBack:HEIGHT_RANGE_COCO_BACK},cocoBackCount:cocoBack.length});

const volumeOk=[...betelTrees,...cocoTrees].every(t=>t.thickRatio>=.25);
check('南迴-棕櫚 canopy has volume 每棵樹樹冠垂直厚度都 ≥0.25×樹冠直徑（不是扁平的星形）',volumeOk,
 {betelThickRange:minMax(betelTrees,'thickRatio'),cocoThickRange:minMax(cocoTrees,'thickRatio')});

const betelRatioOk=betelTrees.every(t=>t.ratio>=CANOPY_RATIO_FLOOR.betel);
const cocoRatioOk=cocoTrees.every(t=>t.ratio>=CANOPY_RATIO_FLOOR.coco);
check('南迴-棕櫚 canopy ratio 每棵樹冠直徑÷整棵高度都達門檻（抓火柴棒：只縮樹冠不縮樹幹會被這條逮到）',
 betelRatioOk&&cocoRatioOk,
 {betelRatioRange:minMax(betelTrees,'ratio'),cocoRatioRange:minMax(cocoTrees,'ratio'),floor:CANOPY_RATIO_FLOOR});

// 椰子果：每顆果都要落在「離自己最近那棵椰子樹」樹頂 15% 高度內，且水平距離 ≤0.3×該樹樹冠半徑。
let fruitOk=true;const fruitBad=[];
if(cocoFruitMesh&&cocoTrunkMesh&&cocoTrees.length){
 for(let i=0;i<cocoFruitMesh.count;i++){
  const {p:fp}=decomposeAt(cocoFruitMesh,i);
  let best=null,bestD=Infinity;
  for(const tr of cocoTrees){const d=Math.hypot(fp.x-tr.cx,fp.y-tr.cy);if(d<bestD){bestD=d;best=tr;}}
  const {p:tp}=decomposeAt(cocoTrunkMesh,best.t);
  const topZ=tp.z+best.height,horiz=Math.hypot(fp.x-tp.x,fp.y-tp.y),radius=best.diam/2;
  const withinTop15=fp.z>=topZ-best.height*.15,withinRadius=horiz<=radius*.3;
  if(!withinTop15||!withinRadius){fruitOk=false;fruitBad.push({i,withinTop15,withinRadius,horiz:+horiz.toFixed(3),radius:+radius.toFixed(3)});}
 }
}
check('南迴-棕櫚 coconut position 每顆椰子果都在該樹樹頂 15% 高度內、且水平距離 ≤0.3×樹冠半徑',fruitOk&&(cocoFruitMesh?.count??0)>0,
 {fruitCount:cocoFruitMesh?.count??0,badCount:fruitBad.length,sample:fruitBad.slice(0,3)});

// 站務員第二輪已改成 garage-people-v1 零件庫拼的獨立 Mesh（見 rail-3d/garage-scenes/south-coast.js
// 的 createAttendant，跟候車乘客共用 personPose／同一比例尺），不再是這裡能直接 extract 的方塊；
// 對應判準搬到下面瀏覽器區塊，直接讀 southCoastPreview.peopleBounds()「實際畫出來的東西」。

// ── Playwright（chromium headless）：停站、看月台快轉、候車的人（數量／腳的高度／範圍內）。──
const b=await chromium.launch({channel:'chrome',headless:true});
try{
 const p=await b.newPage({viewport:{width:1400,height:900}});const errors=[];
 // channel:'chrome' 無視窗模式會自動要 /favicon.ico，原型頁本來就沒有這個檔；濾掉這筆已知無關 404（比照 verify_garage_viaduct_stop.mjs 的作法）。
 p.on('pageerror',e=>errors.push('PAGEERROR '+e.message));p.on('console',m=>{if(m.type()==='error'&&!/\/favicon\.ico(\?|$)/.test(m.location()?.url||''))errors.push('CONSOLE '+m.text());});
 await p.goto(PAGE_URL);await p.waitForFunction(()=>window.southCoastPreview?.state.ready,null,{timeout:90000});
 const T=await p.evaluate(()=>southCoastPreview.timetable),platform=await p.evaluate(()=>southCoastPreview.platform);
 const t0=await p.evaluate(()=>southCoastPreview.timeAtPosition(0));

 // 南迴-停站：煞停前一刻仍在動、停站窗口內 speed=0 全程、發車後一刻已經在動；窗口長度＝timetable 宣告的 departAt-brake。
 const at=async dt=>{await p.evaluate(([t0,dt])=>southCoastPreview.setTime(t0+dt),[t0,dt]);return p.evaluate(()=>southCoastPreview.state);};
 const preBrake=await at(-.15),justStopped=await at(.15),midDwell=await at((T.phases.departAt-T.phases.brake)/2),justBeforeDepart=await at(T.phases.departAt-T.phases.brake-.15),justAfterDepart=await at(T.phases.departAt-T.phases.brake+.15);
 check('南迴-停站 煞停前一刻仍在減速中（未停）',preBrake.phase!=='stopped'&&preBrake.currentSpeed>0,{phase:preBrake.phase,v:preBrake.currentSpeed});
 check('南迴-停站 進站後 speed=0（剛停穩／中途／發車前）三個時間點皆成立',[justStopped,midDwell,justBeforeDepart].every(s=>s.phase==='stopped'&&s.currentSpeed===0),{justStopped:justStopped.currentSpeed,midDwell:midDwell.currentSpeed,justBeforeDepart:justBeforeDepart.currentSpeed});
 check('南迴-停站 發車後一刻已經在動（停站時間窗＝timetable 的 dwell，沒有多停或少停）',justAfterDepart.phase!=='stopped'&&justAfterDepart.currentSpeed>0,{phase:justAfterDepart.phase,v:justAfterDepart.currentSpeed});
 const xs=midDwell.poses.map(c=>c.x),front=Math.max(...xs)+3.67-1.577,back=Math.min(...xs)-(3.67-1.577); // 車頭/尾伸出各車中心的量，用已知 blue(head) x=1.577 時全車范围[-9.67,+3.67]反推的半長
 const centersInRange=midDwell.poses.every(c=>c.x>=platform.xMin-.05&&c.x<=platform.xMax+.05);
 const overhang=Math.max(0,platform.xMin-back,front-platform.xMax);
 check('南迴-停站 停站時每節車中心都在月台範圍內，且兩端伸出月台不超過 0.5（車略長於月台屬既有月台尺寸，非本次改動）',centersInRange&&overhang<=.5,{poses:midDwell.poses.map(c=>c.x),xMin:platform.xMin,xMax:platform.xMax,overhang:+overhang.toFixed(3)});

 // 南迴-看月台快轉：巡航中點擊→時間前進（不是瞬移到別的位置、是往未來跳）且落在下一次進站的減速段；再點一次不再跳；停站中點擊也不跳。
 await p.evaluate(t=>southCoastPreview.setTime(t),T.phases.cruiseAt+3);const beforeClick=await p.evaluate(()=>southCoastPreview.state);
 await p.click('#platform');const afterClick=await p.evaluate(()=>southCoastPreview.state);
 check('南迴-看月台快轉 巡航中點擊：時間往前跳到下一次進站的減速段（不是瞬移到任意位置)，並自動切到 platform 視角',afterClick.time>beforeClick.time+1&&afterClick.phase==='braking'&&afterClick.view==='platform',{before:beforeClick.time,after:afterClick.time,phase:afterClick.phase,view:afterClick.view});
 const t1=afterClick.time;await p.click('#platform');const secondClick=await p.evaluate(()=>southCoastPreview.state);
 check('南迴-看月台快轉 已經在減速／停站中再點一次不再跳',Math.abs(secondClick.time-t1)<1.5,{t1,t2:secondClick.time});
 // 煞停要 T.phases.brake 秒（此時刻表為 5 秒）：從剛進入 braking 的 t1 再往前推 brake+1 秒緩衝，才保證已經停穩。
 await p.evaluate(t=>southCoastPreview.setTime(t),t1+T.phases.brake+1);const stoppedState=await p.evaluate(()=>southCoastPreview.state);
 check('南迴-看月台快轉 快轉後真的停在月台（phase=stopped、speed=0）',stoppedState.phase==='stopped'&&stoppedState.currentSpeed===0,{phase:stoppedState.phase,v:stoppedState.currentSpeed});

 // 南迴-候車的人：人數固定 3（2 坐 1 站，皆為 idle，不上下車）——這條讀 state.passengers，是既有共用模組
 // 自己算好的統計、跟畫面即時同步，不是測試自己重猜的公式。
 await p.evaluate(t=>southCoastPreview.setTime(t),t0+2.5);
 const passengers=await p.evaluate(()=>southCoastPreview.state.passengers);
 check('南迴-候車的人 人數為 3，且 0 人上下車（idle，不開門不上下車）',passengers.onPlatform===3&&passengers.boarding===0&&passengers.alighting===0,passengers);

 // 第二輪起：站務員／候車者座標與尺寸一律讀 peopleBounds()——直接從畫面裡的 instanced mesh／Mesh 讀世界座標包圍盒，
 // 不是原始碼常數也不是測試自己重算的公式（上一輪的教訓：腳高比對原始碼字串、候車者座標測試自己重算，
 // 兩者都跟實作同源，站務員被畫成三倍高一樣全綠）。
 const pb=await p.evaluate(()=>southCoastPreview.peopleBounds());
 const yLo=Math.min(platform.edge,platform.outer),yHi=Math.max(platform.edge,platform.outer);
 const attHeight=pb.attendant.max[2]-pb.attendant.min[2],paxHeight=pb.passenger.max[2]-pb.passenger.min[2],heightRatio=attHeight/paxHeight;
 check('南迴-站務員 身高跟站姿候車乘客的比例在 0.9～1.1 之間（同一條 personPose／同一比例尺量出來的實際網格高度)',heightRatio>=.9&&heightRatio<=1.1,{attHeight:+attHeight.toFixed(3),paxHeight:+paxHeight.toFixed(3),heightRatio:+heightRatio.toFixed(3)});
 check('南迴-站務員 腳底 z 貼合月台面（±0.03，實測包圍盒下緣，非原始碼字串比對）',Math.abs(pb.attendant.min[2]-platform.top)<=.03,{footZ:+pb.attendant.min[2].toFixed(4),platformTop:platform.top});
 const attCenter=[(pb.attendant.min[0]+pb.attendant.max[0])/2,(pb.attendant.min[1]+pb.attendant.max[1])/2];
 check('南迴-站務員 在月台 xy 範圍內',attCenter[0]>=platform.xMin&&attCenter[0]<=platform.xMax&&attCenter[1]>=yLo-.1&&attCenter[1]<=yHi+.1,{attCenter,xMin:platform.xMin,xMax:platform.xMax,yLo,yHi});
 check('南迴-站務員 外套顏色是深藍(#16324f)',pb.jacketColor==='16324f',{jacketColor:pb.jacketColor});

 check('南迴-候車的人 站立者腳底 z 貼合月台面（±0.03，實測包圍盒下緣）',Math.abs(pb.passenger.min[2]-platform.top)<=.03,{footZ:+pb.passenger.min[2].toFixed(4),platformTop:platform.top});
 const headsOk=pb.heads.length===3&&pb.heads.every(([x,y])=>x>=platform.xMin&&x<=platform.xMax&&y>=yLo-.1&&y<=yHi+.1);
 check('南迴-候車的人 三位候車者（實測頭部世界座標）都落在月台 xy 範圍內',headsOk,{heads:pb.heads,xMin:platform.xMin,xMax:platform.xMax,yLo,yHi});
 const standingHead=pb.heads[2],minDistToIdle=Math.min(...pb.heads.map(([x,y])=>Math.hypot(x-attCenter[0],y-attCenter[1])));
 check('南迴-候車的人／站務員 站務員跟三位候車者（實測頭部座標）不重疊（距離 >0.5）',minDistToIdle>.5,{minDistToIdle:+minDistToIdle.toFixed(3)});

 check('南迴 頁面無 JS／console 錯誤',errors.length===0,errors);
}finally{await b.close();}

const fails=results.filter(r=>!r.pass).length;
console.log(`\n共 ${results.length} 項，失敗 ${fails}`);
if(fails)process.exitCode=1;
