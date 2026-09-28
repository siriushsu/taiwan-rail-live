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
// 09-28 站房與站體設施精修第二版：改用 garage-coast-v1 零件庫（見
// scripts/blender/coast-20260928/build_coast_station.py），Node 端跟 palmsKit 同一套讀法。
const STATION_ASSET_DIR=new URL('../rail-3d/assets/garage-coast-v1/',import.meta.url);
const stationMeta=JSON.parse(readFileSync(new URL('station.json',STATION_ASSET_DIR),'utf8'));
const stationRaw=gunzipSync(readFileSync(new URL('station.bin.gz',STATION_ASSET_DIR)));
const stationKit=buildGarageParts(stationMeta,stationRaw.buffer.slice(stationRaw.byteOffset,stationRaw.byteOffset+stationRaw.byteLength));

function extract(scene){const list=[];scene.group.traverse(o=>{if(!o.isInstancedMesh)return;
 const vcount=o.geometry.attributes.position.count,color=o.material.color?o.material.color.getHexString():'?';
 const items=[];const m=new THREE.Matrix4(),pos=new THREE.Vector3(),quat=new THREE.Quaternion(),scl=new THREE.Vector3();
 for(let i=0;i<o.count;i++){o.getMatrixAt(i,m);m.decompose(pos,quat,scl);items.push({x:+pos.x.toFixed(6),y:+pos.y.toFixed(6),z:+pos.z.toFixed(6)});}
 list.push({name:o.name,vcount,color,count:o.count,items});});return list;}
const scene=createScene(palmsKit,stationKit),groups=extract(scene);
const meshByName=new Map();scene.group.traverse(o=>{if(o.isInstancedMesh&&o.name)meshByName.set(o.name,o);});
const oldBroadleaf=groups.filter(g=>['4e7158','668363','8c9c70'].includes(g.color)).reduce((s,g)=>s+g.count,0);
const betelTrunkMesh=meshByName.get('palm-betel-trunk'),cocoTrunkMesh=meshByName.get('palm-coco-trunk');
const betelFrondMesh=meshByName.get('palm-betel-fronds'),cocoFrondMesh=meshByName.get('palm-coco-fronds');
const betelCrownMesh=meshByName.get('palm-betel-crownshaft'),cocoFruitMesh=meshByName.get('palm-coco-fruit');
// 09-28 山上植被精修（評審第 2 項）新增四款：椰子彎幹 A/B（沿用 coco-fronds 葉冠，見
// south-coast.js 的 plantAs）與闊葉樹 A/B（各自 trunk+canopy）。
const cocoCurvedATrunkMesh=meshByName.get('palm-coco-curved-a-trunk'),cocoCurvedAFrondMesh=meshByName.get('palm-coco-curved-a-fronds');
const cocoCurvedBTrunkMesh=meshByName.get('palm-coco-curved-b-trunk'),cocoCurvedBFrondMesh=meshByName.get('palm-coco-curved-b-fronds');
const broadleafATrunkMesh=meshByName.get('palm-broadleaf-a-trunk'),broadleafACanopyMesh=meshByName.get('palm-broadleaf-a-canopy');
const broadleafBTrunkMesh=meshByName.get('palm-broadleaf-b-trunk'),broadleafBCanopyMesh=meshByName.get('palm-broadleaf-b-canopy');
const betelCount=betelTrunkMesh?.count??0,cocoCount=cocoTrunkMesh?.count??0;
const curvedACount=cocoCurvedATrunkMesh?.count??0,curvedBCount=cocoCurvedBTrunkMesh?.count??0;
const broadleafACount=broadleafATrunkMesh?.count??0,broadleafBCount=broadleafBTrunkMesh?.count??0;
const palmTotal=betelCount+cocoCount+curvedACount+curvedBCount,broadleafTotal=broadleafACount+broadleafBCount,totalVeg=palmTotal+broadleafTotal;
// 舊判準「總棵數 150～220」是棕櫚種滿整座山（未分海拔）時代的密度檢查；山上植被精修把大部分中高海拔
// 的棕櫚改成闊葉樹（見 south-coast.js 的 paletteAt），棕櫚本身棵數必然大減，改成量「全部植被
// （棕櫚 4 款＋闊葉 2 款）合計」延續同一個「不要太空也不要爆量」的密度把關（實測 213，見
// scratchpad/garage-b/polish-01-notes.md）。
check('南迴-棕櫚 species 六款植被（檳榔／椰子直幹／椰子彎幹A／椰子彎幹B／闊葉A／闊葉B）皆有實例、舊闊葉樹（3 色 crown）殘留數＝0、全部植被總棵數在 150～260',
 betelCount>0&&cocoCount>0&&curvedACount>0&&curvedBCount>0&&broadleafACount>0&&broadleafBCount>0&&oldBroadleaf===0&&totalVeg>=150&&totalVeg<=260,
 {betelCount,cocoCount,curvedACount,curvedBCount,broadleafACount,broadleafBCount,palmTotal,broadleafTotal,totalVeg,oldBroadleaf});

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
  // hubOffset：葉冠水平範圍中心 vs 樹幹底部世界座標的水平距離——直幹樹只有扇葉 jitter 帶來的雜訊
  // （實測 ≤0.113），彎幹樹因為葉冠掛點跟著彎曲樹梢偏移，這個值會明顯大（見下方彎幹棕櫚 curvature 判準）。
  const hubOffset=Math.hypot((bxMin+bxMax)/2-tp.x,(byMin+byMax)/2-tp.y);
  out.push({t,height,diam,thickRatio:(maxZ-minZ)/diam,ratio:diam/height,cx:tp.x,cy:tp.y,hubOffset});
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

// ── 09-28 山上植被精修（評審「01 藍皮」第 2 項）新增判準：彎幹棕櫚（curvature）／闊葉樹高度／
// 海拔限制（棕櫚只留海岸低坡）／稜線闊葉覆蓋／撒點間距（非等距）／貼地誤差。全部直接讀
// createScene() 真正畫出來的 instanced mesh 世界座標（不是重算原始碼公式），跟上面既有判準同一個
// 紀律。terrain（height 函式＋PEAK）直接從 scene 拿，不是 verify 自己重寫地形公式的另一份副本。──
const terrain=scene.terrain;
const cocoCurvedATrees=analyzeSpecies(cocoCurvedATrunkMesh,cocoCurvedAFrondMesh,COCO_FRONDS,null);
const cocoCurvedBTrees=analyzeSpecies(cocoCurvedBTrunkMesh,cocoCurvedBFrondMesh,COCO_FRONDS,null);
const curvedTrees=[...cocoCurvedATrees,...cocoCurvedBTrees];

// 彎幹可見度：hubOffset（葉冠掛點相對樹幹底部的水平偏移）≥0.25——實測直幹係對照組最高只到 0.113，
// 彎幹 A/B 實測最低 0.309，門檻卡在兩者中間，區分度很寬，不是卡在臨界值。
const curvedOffsetOk=curvedTrees.length>0&&curvedTrees.every(t=>t.hubOffset>=.25);
check('南迴-彎幹棕櫚 curvature 兩款彎幹椰子的葉冠掛點都明顯偏離樹幹底部正上方（水平偏移 ≥0.25，直幹對照組同一量測 ≤0.113，非卡在臨界值）',
 curvedOffsetOk,{curvedOffsetRange:minMax(curvedTrees,'hubOffset'),straightControlRange:minMax(analyzeSpecies(cocoTrunkMesh,cocoFrondMesh,COCO_FRONDS,null).filter(t=>t.cy<BACK_ROW_Y),'hubOffset'),n:curvedTrees.length});

// 彎幹椰子沿用跟直幹椰子完全相同的 cocoSize(s).trunkH 反推 uniform scale，理論上落在同一個既有
// coco 高度範圍內；這裡直接量測確認，不是只信公式推導。
const curvedHeightOk=curvedTrees.length>0&&curvedTrees.every(t=>t.height>=HEIGHT_RANGE.coco[0]&&t.height<=HEIGHT_RANGE.coco[1]);
check('南迴-彎幹棕櫚 height 兩款彎幹椰子整棵高度都落在跟直幹椰子相同的既有範圍內',curvedHeightOk,
 {curvedHeightRange:minMax(curvedTrees,'height'),target:HEIGHT_RANGE.coco,n:curvedTrees.length});

// 闊葉樹整棵高度（樹幹底部世界 z 到樹冠逐頂點世界最高點）：設計範圍見 south-coast.js 的
// BL_SCALE_MIN/MAX（絕對尺寸幾何×均勻縮放），這裡量真正渲染出來的結果，範圍留了餘裕
// （實測 A:2.156~3.496、B:1.762~2.843，門檻比實測寬，不是卡在臨界值）。
function canopyHeights(trunkMesh,canopyMesh){if(!trunkMesh||!canopyMesh)return[];const cv=localVerts(canopyMesh),out=[];
 for(let i=0;i<trunkMesh.count;i++){const {p:tp}=decomposeAt(trunkMesh,i);out.push(worldExtent(canopyMesh,i,cv).maxZ-tp.z);}return out;}
const HEIGHT_RANGE_BROADLEAF={a:[1.9,3.7],b:[1.5,3.0]};
const blAHeights=canopyHeights(broadleafATrunkMesh,broadleafACanopyMesh),blBHeights=canopyHeights(broadleafBTrunkMesh,broadleafBCanopyMesh);
const blHeightOk=blAHeights.length>0&&blBHeights.length>0&&blAHeights.every(h=>h>=HEIGHT_RANGE_BROADLEAF.a[0]&&h<=HEIGHT_RANGE_BROADLEAF.a[1])&&blBHeights.every(h=>h>=HEIGHT_RANGE_BROADLEAF.b[0]&&h<=HEIGHT_RANGE_BROADLEAF.b[1]);
check('南迴-闊葉樹 height 兩款闊葉樹整棵高度（樹幹底到樹冠逐頂點最高點）都落在設計範圍內',blHeightOk,
 {aRange:[Math.min(...blAHeights),Math.max(...blAHeights)].map(v=>+v.toFixed(3)),bRange:[Math.min(...blBHeights),Math.max(...blBHeights)].map(v=>+v.toFixed(3)),target:HEIGHT_RANGE_BROADLEAF});

// 海拔限制：棕櫚（四款合計）裡 ratio=height(x,y)/PEAK >0.35 的比例 ≤10%（海岸平地/低坡才長棕櫚，
// 不是評審批評的「種到稜線」）；ratio 直接用 terrain.height 對每棵樹實際世界座標算，不是撒點時的
// 中繼變數。
const allPalmMeshes=[betelTrunkMesh,cocoTrunkMesh,cocoCurvedATrunkMesh,cocoCurvedBTrunkMesh].filter(Boolean);
const allBroadleafMeshes=[broadleafATrunkMesh,broadleafBTrunkMesh].filter(Boolean);
function worldXY(mesh){const out=[];for(let i=0;i<mesh.count;i++){const {p}=decomposeAt(mesh,i);out.push(p);}return out;}
const palmPts=allPalmMeshes.flatMap(worldXY).filter(p=>p.y<BACK_ROW_Y); // 排除後排平地椰子（不在山坡上，ratio 概念不適用）。
const palmRatios=palmPts.map(p=>terrain.height(p.x,p.y)/terrain.peak);
const palmAbove35=palmRatios.filter(r=>r>.35).length,palmAbove35Pct=palmAbove35/palmRatios.length;
check('南迴-山上植被 elevation-restriction 棕櫚（檳榔＋三款椰子，排除後排平地）裡 ratio(高度/山頂)>0.35 的比例 ≤10%（實測 4.4%，海岸低坡才有棕櫚）',
 palmAbove35Pct<=.10,{palmAbove35,total:palmRatios.length,palmAbove35Pct:+palmAbove35Pct.toFixed(4)});

// 稜線覆蓋：ratio>=0.5 的「已種植」植被（棕櫚+闊葉，不含空位）裡闊葉佔比 ≥0.85。
const broadleafPts=allBroadleafMeshes.flatMap(worldXY);
const ridgePalmRatios=palmPts.map(p=>terrain.height(p.x,p.y)/terrain.peak).filter(r=>r>=.5).length;
const ridgeBroadleafRatios=broadleafPts.map(p=>terrain.height(p.x,p.y)/terrain.peak).filter(r=>r>=.5).length;
const ridgeTotal=ridgePalmRatios+ridgeBroadleafRatios,ridgeBroadleafPct=ridgeTotal?ridgeBroadleafRatios/ridgeTotal:NaN;
check('南迴-山上植被 ridge-coverage 稜線（ratio(高度/山頂)>=0.5）的植被裡闊葉佔比 ≥0.85（實測 97.1%）',
 ridgeTotal>0&&ridgeBroadleafPct>=.85,{ridgePalmCount:ridgePalmRatios,ridgeBroadleafCount:ridgeBroadleafRatios,ridgeTotal,ridgeBroadleafPct:+ridgeBroadleafPct.toFixed(4)});

// 撒點間距：全部山坡植被（棕櫚 4 款＋闊葉 2 款，不含後排平地）合併看最近鄰距離的變異係數，
// ≥0.25 代表不是等距排列的網格（評審批評「插滿牙籤」的另一半——不只物種單一，排列也規律）。
function nnCV(points){if(points.length<3)return NaN;const d=[];for(let a=0;a<points.length;a++){let best=Infinity;for(let b=0;b<points.length;b++){if(a===b)continue;const dist=Math.hypot(points[a].x-points[b].x,points[a].y-points[b].y);if(dist<best)best=dist;}d.push(best);}
 const mean=d.reduce((s,v)=>s+v,0)/d.length,vr=d.reduce((s,v)=>s+(v-mean)**2,0)/d.length;return Math.sqrt(vr)/mean;}
const spacingPts=[...palmPts,...broadleafPts];
const spacingCV=nnCV(spacingPts);
check('南迴-山上植被 spacing 山坡植被最近鄰距離變異係數 ≥0.25（不是等距排列的網格，實測 0.83）',
 spacingCV>=.25,{spacingCV:+spacingCV.toFixed(4),n:spacingPts.length});

// 貼地：樹幹底部世界 z 與 terrain.height(x,y) 誤差 ≤0.02（排除後排平地——那裡本來就不是用山坡
// 地形高度，是固定平地 z=.3，height(x,y) 在那裡不代表任何設計意圖）。
function groundErr(mesh,filterFn){if(!mesh)return[];const out=[];for(let i=0;i<mesh.count;i++){const {p}=decomposeAt(mesh,i);if(filterFn&&!filterFn(p))continue;out.push(Math.abs(p.z-terrain.height(p.x,p.y)));}return out;}
const groundErrs=[...groundErr(betelTrunkMesh),...groundErr(cocoTrunkMesh,p=>p.y<BACK_ROW_Y),
 ...groundErr(cocoCurvedATrunkMesh),...groundErr(cocoCurvedBTrunkMesh),...groundErr(broadleafATrunkMesh),...groundErr(broadleafBTrunkMesh)];
const maxGroundErr=groundErrs.length?Math.max(...groundErrs):Infinity;
check('南迴-山上植被 ground-snap 樹幹底部貼地誤差 ≤0.02（跟地形 terrain.height(x,y) 比對，排除後排平地）',
 groundErrs.length>0&&maxGroundErr<=.02,{maxGroundErr:+maxGroundErr.toFixed(5),n:groundErrs.length});

// ── 09-28 站房與站體設施精修第二版（評審「01 藍皮」第 3 項退回重做）：第一版全部用 box/cylinder
// 疊出來被使用者原話「細節還是都需要用 blender 製作」退回，第二版全部改用 Blender 建的
// garage-parts-v1 零件庫（rail-3d/assets/garage-coast-v1，見
// scripts/blender/coast-20260928/build_coast_station.py）。south-coast.js 的 place() helper
// 幫每個站體設施 instance 掛上 'sk-' 開頭的專屬名字，這裡直接用名字查 InstancedMesh，不再需要
// 舊版「材質色碼＋設計座標最近鄰」那套間接定位法。
//
// 下面每一條判準都標注它是「沿用舊判準邏輯、只換定位方式」還是「新增」還是「刪除」：
// 1（屋簷/屋脊）沿用意圖，改成量 Blender 版真實包圍盒＋三角形數。
// 2（窗框）沿用「窗框比玻璃寬一圈」，**刪除深度序子判準**——理由：窗框現在是 framed_hole() 挖出來的
//    真實四邊框＋真洞，玻璃嵌在洞裡，不管算繪/instancing順序如何都不可能被整片擋住，深度序這件事
//    在幾何層級已經不存在，不是「懶得驗」而是「沒有東西可驗」。可見度改由下面新增的夜間發光像素判準
//    （verify_garage_south_coast.mjs）實測證明。
// 3（門）保留高度 2.0～2.4m 判準，**刪除三層深度序子判準**——理由同上：門框/門片/把手現在合併成一個
//    kit part（框是真洞、把手是實體凸出的幾何），沒有「哪層在前」這件事。
// 4（門不重疊窗、在牆體內）沿用邏輯不變，只換成讀 Blender 版世界包圍盒。
// 5（雨庇）沿用邏輯不變，只換成讀 Blender 版世界包圍盒。
// 6（長椅靠背）沿用邏輯不變，只換成讀 Blender 版世界包圍盒。
// 7（站名牌圖標＋輪子）**整條刪除，改成垃圾桶判準**——理由：站名牌本身被使用者選項二換掉
//    （「不然就拿掉站牌，換成別的 Blender 站體設施」），輪子/圖標這兩個子判準的物件已不存在。
// 8（路燈頭/頂蓋/頂飾疊放＋直徑）調整：頂蓋與頂飾現在併進同一個 lamp-head kit part（不再是三個
//    分開疊放的獨立網格），改驗「頭在柱子上半段」＋「玻璃在頭的範圍內」＋直徑換算真實世界合理。
// 新增：非 kit 的程式幾何 0 個（這是評審要求的突變測試目標）＋各設施底部貼地/貼平台 ≤0.02。
const UNITS_PER_METER=0.4435; // 反推自既有 .754 單位≈1.7 公尺人形比例尺慣例（1 公尺＝.754/1.7）。
const PLATFORM_TOP=scene.platform.top; // 直接讀 createScene() 真正回傳的月台面，不是另外手打的常數。
function worldBBox(name){
 const o=meshByName.get('sk-'+name);if(!o)return null;
 const {p}=decomposeAt(o,0);
 if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();
 const bb=o.geometry.boundingBox;
 return {minX:bb.min.x+p.x,maxX:bb.max.x+p.x,minY:bb.min.y+p.y,maxY:bb.max.y+p.y,minZ:bb.min.z+p.z,maxZ:bb.max.z+p.z,
  sizeX:+(bb.max.x-bb.min.x).toFixed(5),sizeY:+(bb.max.y-bb.min.y).toFixed(5),sizeZ:+(bb.max.z-bb.min.z).toFixed(5)};
}

// ── 新增：站體設施群組裡非 kit 的程式幾何 0 個（評審原話：「細節還是都需要用 blender 製作」）。
// 走訪 scene graph 實際數每個 'sk-' 開頭 instance 用的是不是 stationKit 自己的零件幾何——這是本輪
// 突變測試唯一要打紅的判準：把任何一個 place() 呼叫換回 box 幾何，這裡就會抓到。
const stationMeshes=[];scene.group.traverse(o=>{if(o.isInstancedMesh&&o.name&&o.name.startsWith('sk-'))stationMeshes.push(o);});
const kitGeoSet=new Set([...stationKit.parts.values()].map(pt=>pt.geometry));
const nonKitGeo=stationMeshes.filter(o=>!kitGeoSet.has(o.geometry));
check('南迴-站房 站體設施群組裡非 kit 的程式幾何 0 個（評審原話：細節還是都需要用 blender 製作；突變測試目標）',
 stationMeshes.length>0&&nonKitGeo.length===0,
 {stationMeshCount:stationMeshes.length,nonKitGeoCount:nonKitGeo.length,nonKitNames:nonKitGeo.map(o=>o.name)});

// 簷口／屋脊：牆頂／屋頂本身的世界包圍盒——屋頂長寬要比牆體大一圈（真正的簷口出挑），且屋頂本身的
// 三角形數遠高於一片平板需要的數量（Blender 六角柱造型＋屋脊，見 build_coast_station.py 的
// gable_roof()；拓樸本身的正確性已由建置腳本自己的退化三角形／法向量自檢把關，這裡驗的是「JS
// 真的接到那個立體造型」而不是又疊了一片平板上去）。
const wallBB=worldBBox('wall'),roofBB=worldBBox('roof');
const roofPart=stationKit.parts.get('roof'),roofTriCount=roofPart.geometry.attributes.position.count/3;
const roofOverhang=!!wallBB&&!!roofBB&&roofBB.sizeX>wallBB.sizeX+.2&&roofBB.sizeY>wallBB.sizeY+.2;
const roofHasHeight=!!roofBB&&roofBB.sizeZ>=.5;
const roofComplex=roofTriCount>=100;
check('南迴-站房 屋頂有真正的簷口出挑與屋脊高度，非平板（評審原話：屋簷沒有厚度跟簷口）',
 roofOverhang&&roofHasHeight&&roofComplex,
 {wallSize:wallBB&&{x:wallBB.sizeX,y:wallBB.sizeY},roofSize:roofBB&&{x:roofBB.sizeX,y:roofBB.sizeY,z:roofBB.sizeZ},roofTriCount});

// 窗框：三扇窗，木框世界包圍盒要完全包住玻璃（框比玻璃寬一圈、真正挖空的洞——不是深度序戲法）。
const winIdx=[0,1,2];
const winFrames=winIdx.map(i=>worldBBox('window-frame'+i)),winGlass=winIdx.map(i=>worldBBox('window-glass'+i));
const winFound=winFrames.every(Boolean)&&winGlass.every(Boolean);
const frameContainsGlass=winFound&&winFrames.every((f,i)=>{const g=winGlass[i];
 return f.sizeX>=g.sizeX&&f.sizeZ>=g.sizeZ&&f.minX<=g.minX+1e-4&&f.maxX>=g.maxX-1e-4&&f.minZ<=g.minZ+1e-4&&f.maxZ>=g.maxZ-1e-4;});
check('南迴-站房 窗框存在且完全包住玻璃（真正挖空的洞，深度序判準已刪除——見檔頭理由 2；評審原話：三扇窗是平貼的色塊、沒有窗框）',
 winFound&&frameContainsGlass,{winFrames,winGlass});

// 門：高度換算真實世界要落在 2.0～2.4 公尺（三層深度序判準已刪除，見檔頭理由 3）。
const doorBB=worldBBox('door');
const doorHeightM=doorBB?doorBB.sizeZ/UNITS_PER_METER:0;
check('南迴-站房 門存在、高度換算真實 2.0～2.4 公尺（評審原話：看不到門；深度序判準已刪除，見檔頭理由 3）',
 !!doorBB&&doorHeightM>=2.0&&doorHeightM<=2.4,
 {doorBB,doorHeightM:+doorHeightM.toFixed(3)});

// 門不能跟任何窗框重疊、且整個門要在牆體 X 範圍內。
const doorXRange=doorBB?[doorBB.minX,doorBB.maxX]:null;
const winRanges=winFound?winFrames.map(f=>[f.minX,f.maxX]):[];
const noOverlap=!!doorXRange&&winFound&&winRanges.every(([lo,hi])=>doorXRange[1]<=lo||doorXRange[0]>=hi);
const withinWall=!!doorXRange&&!!wallBB&&doorXRange[0]>=wallBB.minX-1e-4&&doorXRange[1]<=wallBB.maxX+1e-4;
check('南迴-站房 門不跟任何窗框重疊、且整個門在牆體 X 範圍內',
 noOverlap&&withinWall,{doorXRange,winRanges,wallX:wallBB&&[wallBB.minX,wallBB.maxX]});

// 雨庇：比門寬、貼在門頂正上方、比牆面更凸出。
const canopyBB=worldBBox('canopy');
const canopyWiderThanDoor=!!canopyBB&&!!doorBB&&canopyBB.sizeX>doorBB.sizeX;
const canopyAboveDoor=!!canopyBB&&!!doorBB&&canopyBB.minZ>=doorBB.maxZ-.01;
const canopyProud=!!canopyBB&&!!wallBB&&canopyBB.minY<wallBB.minY;
check('南迴-站房 雨庇存在、比門寬、貼在門頂上方、比牆面凸出（評審建議詞「雨庇」）',
 canopyWiderThanDoor&&canopyAboveDoor&&canopyProud,
 {canopyBB,doorBB,wallBB,canopyWiderThanDoor,canopyAboveDoor,canopyProud});

// 長椅：三張都要有靠背，靠背底邊貼齊椅面頂（不浮空不埋入）、高度不誇張。
const benchIdx=[0,1,2];
const benchSeat=benchIdx.map(i=>worldBBox(`bench${i}-seat`)),benchBack=benchIdx.map(i=>worldBBox(`bench${i}-back`));
const benchFound=benchSeat.every(Boolean)&&benchBack.every(Boolean);
const backFlushWithSeat=benchFound&&benchBack.every((b,i)=>Math.abs(b.minZ-benchSeat[i].maxZ)<=.08);
const backModestHeight=benchFound&&benchBack.every(b=>(b.maxZ-b.minZ)<=.5);
check('南迴-長椅 三張長椅都有靠背，靠背底邊貼齊椅面頂（不浮空不埋入）、高度不誇張',
 benchFound&&backFlushWithSeat&&backModestHeight,{benchSeat,benchBack});

// 垃圾桶（取代站名牌，見 south-coast.js 註解「評審選項：拿掉站名牌換成別的 Blender 站體設施」）：
// 桶身＋桶緣存在、桶緣貼在桶身頂端、桶身底部貼平台面。
const binIdx=[0,1];
const binBody=binIdx.map(i=>worldBBox(`bin${i}-body`)),binRim=binIdx.map(i=>worldBBox(`bin${i}-rim`));
const binFound=binBody.every(Boolean)&&binRim.every(Boolean);
const rimAtopBody=binFound&&binRim.every((r,i)=>Math.abs(r.minZ-binBody[i].maxZ)<=.08);
const binOnPlatform=binFound&&binBody.every(b=>Math.abs(b.minZ-PLATFORM_TOP)<=.02);
check('南迴-垃圾桶 桶身＋桶緣存在、桶緣貼在桶身頂端、桶身底部貼平台面（取代站名牌，理由見檔頭 7）',
 rimAtopBody&&binOnPlatform,{binBody,binRim});

// 路燈：每盞都有燈頭（含頂蓋/頂飾，已合併成一個 kit part）與獨立玻璃，玻璃要落在燈頭的世界範圍內、
// 燈頭要在柱子的上半段、燈頭直徑換算真實世界要落在合理燈籠尺寸內。
const lampIdx=[0,1,2];
const lampPole=lampIdx.map(i=>worldBBox(`lamp${i}-pole`)),lampHead=lampIdx.map(i=>worldBBox(`lamp${i}-head`)),lampGlass=lampIdx.map(i=>worldBBox(`lamp${i}-glass`));
const lampFound=lampPole.every(Boolean)&&lampHead.every(Boolean)&&lampGlass.every(Boolean);
const headInUpperPole=lampFound&&lampHead.every((h,i)=>h.minZ>=lampPole[i].minZ+lampPole[i].sizeZ*.5);
const glassInsideHead=lampFound&&lampHead.every((h,i)=>{const g=lampGlass[i];return g.minZ>=h.minZ-.05&&g.maxZ<=h.maxZ+.05;});
const headDiamM=lampFound?lampHead.map(h=>Math.max(h.sizeX,h.sizeY)/UNITS_PER_METER):[];
const headSizeOk=lampFound&&headDiamM.every(d=>d>=.15&&d<=.9);
check('南迴-路燈 每盞都有燈頭（含頂蓋/頂飾）與獨立玻璃、燈頭在柱子上半段、玻璃在燈頭範圍內、燈頭直徑換算真實世界在合理燈籠尺寸內',
 headInUpperPole&&glassInsideHead&&headSizeOk,
 {lampPole,lampHead,lampGlass,headDiamM:headDiamM.map(v=>+v.toFixed(3))});

// 新增：各設施底部貼地／貼平台，誤差 ≤0.02（評審判準原話）。站房/路燈站在軌道旁地面（z=0，沿用
// 第一版就有的設計，這次沒有改動），長椅/垃圾桶站在乘客月台面（PLATFORM_TOP，見上面 scene.platform.top）。
const groundTol=.02;
const wallGround=!!wallBB&&Math.abs(wallBB.minZ-0)<=groundTol;
const lampGroundOk=lampFound&&lampPole.every(p=>Math.abs(p.minZ-0)<=groundTol);
const benchLegGroundOk=benchIdx.every(i=>[0,1].every(j=>{const lb=worldBBox(`bench${i}-leg${j}`);return !!lb&&Math.abs(lb.minZ-PLATFORM_TOP)<=groundTol;}));
const binGroundOk=binFound&&binBody.every(b=>Math.abs(b.minZ-PLATFORM_TOP)<=groundTol);
check('南迴-站體設施 各設施底部貼地／貼平台，誤差 ≤0.02',
 wallGround&&lampGroundOk&&benchLegGroundOk&&binGroundOk,
 {wallMinZ:wallBB?.minZ,lampPoleMinZ:lampPole.map(p=>p?.minZ),binBodyMinZ:binBody.map(b=>b?.minZ),platformTop:PLATFORM_TOP});

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

 // 南迴-看月台鏡頭 停站期間，鏡頭對 3 位候車者＋站務員的頭部中心各自用「該像素在畫面上的實際平行
 // 光線」（正交相機 setFromCamera，跟渲染時同一條光線，不是從 camera.position 幅射的透視光線）對
 // 列車（train.root）與場景（coast.group，含站房／雨棚／棕櫚／護欄等）分別 raycast，量「有沒有比
 // 這個人更近的東西擋在中間」——不驗「第一個命中是不是人體網格本身」（人體很薄，光線穿心點未必真的
 // 落在網格面上），這是本判準在「第一個命中的就是那個人」原文下唯一可驗證、不失真的形式。
 // 舊鏡頭（yaw=-1.3, elevation=.24，從海那側平視）曾讓列車整個擋住月台與站務員／候車者（見
 // scratchpad/garage-b/cam-baseline.png，4 人中 3 人被列車擋住）；新鏡頭改沿月台縱向斜看
 // （yaw=-.1, elevation=.4，見 main.js 的 reset()），4 人皆不被列車或場景擋住且都在畫面內。
 const sight=await p.evaluate(()=>southCoastPreview.platformSightlines());
 check('南迴-看月台鏡頭 停站期間 3 位候車者＋站務員的頭部，鏡頭到頭部之間沒有列車或場景（站房/雨棚等）擋住，且都在畫面內',
  sight.length===4&&sight.every(s=>s.visible&&s.inFrame),sight);

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
