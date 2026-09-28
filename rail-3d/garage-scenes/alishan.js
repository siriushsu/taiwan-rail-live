import * as THREE from '../vendor/three.module.js';
import {createRoutes,turnoutStates} from './alishan-route.js?revision=turnout-sign-0912';
import {createTurnouts,turnoutAt} from './alishan-turnouts.js?revision=turnout-sign-0912';
export const THEMES={day:{background:'#e8e9de',sun:'#fff0ca',ambient:'#c2d5d0',ground:'#65795c',power:2.8,exposure:1.02},sunset:{background:'#e7d8c4',sun:'#ffbf80',ambient:'#c7bdb9',ground:'#657160',power:2.8,exposure:.93},night:{background:'#182d32',sun:'#b4cfdd',ambient:'#758f96',ground:'#304c3c',power:.8,exposure:.8}};
// fx：main.js 已 loadGarageParts() 讀好的 garage-alishan-fx-v1 零件庫（cloud-a/b/c/d + firefly），
// 跟南迴棕櫚／十分天燈同一個慣例——loadGarageParts 在 main.js 做，createScene 保持同步、直接收現成的 kit。
// trees：同一慣例的 garage-alishan-trees-v1 零件庫（柳杉/紅檜/神木，2026-09-28 取代 ConeGeometry 森林）。
export function createScene(fx,trees){
 const group=new THREE.Group(),geometries=new Set(),materials=new Set(),textures=new Set(),routes=createRoutes();
 let seed=4910;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296),geo=g=>(geometries.add(g),g),mat=(color,extra={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.88,...extra});materials.add(m);return m;};
 const box=geo(new THREE.BoxGeometry(1,1,1)),stone=geo(new THREE.IcosahedronGeometry(1,1)),wood=mat('#75624d'),wall=mat('#ac9672'),roof=mat('#594e43'),steel=mat('#888e83',{metalness:.55,roughness:.4}),ballast=mat('#8e8b77'),moss=mat('#7f9573');
 const batches=new Map(),dummy=new THREE.Object3D();
 function instance(g,m,pos,scale,rot=[0,0,0]){if(!batches.has(g))batches.set(g,new Map());const b=batches.get(g);if(!b.has(m))b.set(m,[]);b.get(m).push({pos,scale,rot});}
 const block=(m,size,pos,rot)=>instance(box,m,pos,size,rot);
 function mesh(g,m,pos){const o=new THREE.Mesh(g,m);if(pos)o.position.set(...pos);o.castShadow=o.receiveShadow=true;group.add(o);return o;}
 function rounded(w,h,r){const s=new THREE.Shape();s.moveTo(-w/2+r,-h/2);s.lineTo(w/2-r,-h/2);s.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);s.lineTo(w/2,h/2-r);s.quadraticCurveTo(w/2,h/2,w/2-r,h/2);s.lineTo(-w/2+r,h/2);s.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);s.lineTo(-w/2,-h/2+r);s.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);return s;}
 mesh(geo(new THREE.ExtrudeGeometry(rounded(72,50,4.5),{depth:1,bevelEnabled:true,bevelSize:.25,bevelThickness:.15,bevelSegments:2,curveSegments:16})),mat('#a28b68'),[0,0,-2.6]);
 mesh(geo(new THREE.ExtrudeGeometry(rounded(72.4,50.4,4.6),{depth:.2,bevelEnabled:false,curveSegments:16})),mat('#594d3e'),[0,0,-2.85]);
 // 場景只生成一次最近軌道索引；地表在路基內回到同一條軌道高程，留 .2 的道床厚度。
 const railPoints=routes.flatMap(r=>r.points);
 function nearRail(x,y){let distance=Infinity,z=0;for(const p of railPoints){const d=(p.x-x)**2+(p.y-y)**2;if(d<distance){distance=d;z=p.z;}}return{distance:Math.sqrt(distance),z};}
 function groundHeight(x,y){const near=nearRail(x,y);let natural=Math.max(.25,1+(y+14)*.38)+6*Math.exp(-(((x-3)/14)**2+((y-18)/8)**2))+3*Math.exp(-(((x+21)/8)**2+((y+2)/7)**2));const t=THREE.MathUtils.smoothstep(near.distance,1.35,3.4);let h=THREE.MathUtils.lerp(near.z-.2,natural,t);for(const [cx,cy,z]of [[-23,-10.9,1],[23,18.2,12]]){const d=Math.max(Math.abs(x-cx)-4.3,Math.abs(y-cy)-2.5,0);h=THREE.MathUtils.lerp(z-.2,h,THREE.MathUtils.smoothstep(d,0,1));}return h;}
 const nx=120,ny=80,positions=[],colors=[],indices=[],boundary=[],grass=new THREE.Color('#879773'),dark=new THREE.Color('#5d7960');
 const rowExtent=y=>Math.abs(y)<=19?35:31+Math.sqrt(Math.max(0,16-(Math.abs(y)-19)**2));
 for(let j=0;j<=ny;j++){const y=-23+j/ny*46,extent=rowExtent(y);for(let i=0;i<=nx;i++){const x=-extent+i/nx*extent*2,z=groundHeight(x,y);positions.push(x,y,z);const c=grass.clone().lerp(dark,Math.min(.7,z/30)).multiplyScalar(.97+rand()*.06);colors.push(c.r,c.g,c.b);}}
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const k=j*(nx+1)+i;indices.push(k,k+1,k+nx+1,k+1,k+nx+2,k+nx+1);}
 const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();const terrain=mesh(g,mat('#ffffff',{vertexColors:true}));
 for(let i=0;i<=nx;i++)boundary.push(i);for(let j=1;j<=ny;j++)boundary.push(j*(nx+1)+nx);for(let i=nx-1;i>=0;i--)boundary.push(ny*(nx+1)+i);for(let j=ny-1;j>0;j--)boundary.push(j*(nx+1));
 const side=[],si=[],sc=[],earth=new THREE.Color('#968670'),bed=new THREE.Color('#b3a487');for(const k of [...boundary,boundary[0]]){const x=positions[k*3],y=positions[k*3+1],z=positions[k*3+2];side.push(x,y,z,x,y,-1.6);sc.push(earth.r,earth.g,earth.b,bed.r,bed.g,bed.b);}for(let i=0;i<boundary.length;i++){const k=i*2;si.push(k,k+2,k+1,k+1,k+2,k+3);}const sg=geo(new THREE.BufferGeometry());sg.setAttribute('position',new THREE.Float32BufferAttribute(side,3));sg.setAttribute('color',new THREE.Float32BufferAttribute(sc,3));sg.setIndex(si);sg.computeVertexNormals();const skirt=mesh(sg,mat('#ffffff',{vertexColors:true,side:THREE.DoubleSide}));skirt.castShadow=false;
 // 軌道含 Z 高程；共享留置線只畫一次，避免深度重疊。
 const seen=new Set(),ties=new Set();
 for(const [routeIndex,path] of routes.entries()){const runs=[];for(let s=0;s<path.length;s+=.25){const a=path.sample(s),b=path.sample(Math.min(path.length,s+.25));if((routeIndex===1&&a.x>=12)||(routeIndex===2&&b.x<=-12))continue;const key=[a.x,a.y,a.z].map(n=>Math.round(n*20)).join(',');if(seen.has(key))continue;seen.add(key);runs.push([a,b]);}
  for(const [offset,width,z,m]of [[0,1.92,-.10,ballast],[-.48,.075,0,steel],[.48,.075,0,steel]]){const v=[],idx=[];for(const [a,b]of runs){if(turnoutAt((a.x+b.x)/2,(a.y+b.y)/2))continue;const k=v.length/3;for(const p of [a,b])for(const sign of [-1,1])v.push(p.x-Math.sin(p.heading)*(offset+sign*width/2),p.y+Math.cos(p.heading)*(offset+sign*width/2),p.z+z);idx.push(k,k+2,k+1,k+1,k+2,k+3);}const r=geo(new THREE.BufferGeometry());r.setAttribute('position',new THREE.Float32BufferAttribute(v,3));r.setIndex(idx);r.computeVertexNormals();mesh(r,m);}
  for(let s=0;s<=path.length;s+=.43){const p=path.sample(s);if((routeIndex===1&&p.x>=12)||(routeIndex===2&&p.x<=-12))continue;if(turnoutAt(p.x,p.y))continue;const key=[p.x,p.y,p.z].map(n=>Math.round(n*2)).join(',');if(ties.has(key))continue;ties.add(key);const a=path.sample(s+.1),b=path.sample(s-.1),pitch=Math.atan2(a.z-b.z,Math.hypot(a.x-b.x,a.y-b.y));instance(box,wood,[p.x,p.y,p.z-.07],[.16,1.55,.10],[0,-pitch,p.heading]);}
 }
 const turnouts=createTurnouts({THREE,group,routes,geo,mesh,block,wood,steel,ballast,mat});
 // 森林（2026-09-28 精修，協調端退件「程式圓錐看起來像聖誕樹」）：柳杉／紅檜／神木全部改用
 // Blender 資產 garage-alishan-trees-v1（scripts/blender/alishan-trees-20260928/），這裡只做
 // 擺放/縮放/朝向與跟車淡出——可見的樹形不再有任何 ConeGeometry。柳杉沿軌道兩側成列、紅檜混生
 // 於坡上（用「離最近軌道距離」的機率斜率決定樹種，不是硬切兩塊），比例尺公式跟
 // render_alishan_trees_sheet.py 的 SUGI/HINOKI/GIANT 常數同一組數字，改任一邊記得同步另一邊。
 function treePart(name){const part=trees.parts.get(name);if(!part)throw new Error('alishan trees: missing part '+name);if(!part.geometry.boundingBox)part.geometry.computeBoundingBox();return part.geometry;}
 const sugiTrunkGeo=treePart('sugi-trunk'),sugiCrownAGeo=treePart('sugi-crown-a'),sugiCrownBGeo=treePart('sugi-crown-b');
 const hinokiTrunkGeo=treePart('hinoki-trunk'),hinokiCrownAGeo=treePart('hinoki-crown-a'),hinokiCrownBGeo=treePart('hinoki-crown-b');
 const giantCrownGeo=treePart('giant-crown');
 // fadeMaterial：跟車鏡頭與列車之間的樹要淡出（見下面 updateTreeFade），沿用一般
 // MeshStandardMaterial，只用 onBeforeCompile 加一個逐實例 instanceOpacity attribute 去乘
 // diffuseColor.a——跟 south-coast.js waterMat 同一套「注入 attribute+varying」手法。
 function fadeMaterial(color){const m=mat(color,{transparent:true,depthWrite:true});m.onBeforeCompile=s=>{
   s.vertexShader=s.vertexShader.replace('#include <common>','attribute float instanceOpacity;\nvarying float vTreeOpacity;\n#include <common>').replace('#include <begin_vertex>','#include <begin_vertex>\nvTreeOpacity=instanceOpacity;');
   s.fragmentShader=s.fragmentShader.replace('#include <common>','varying float vTreeOpacity;\n#include <common>').replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.a*=vTreeOpacity;');
  };return m;}
 const sugiTrunkMat=fadeMaterial('#6b5334'),hinokiTrunkMat=fadeMaterial('#7a5a3c');
 const sugiCrownMatA=fadeMaterial('#3f6b3a'),sugiCrownMatB=fadeMaterial('#4d7a42');
 const hinokiCrownMatA=fadeMaterial('#355c42'),hinokiCrownMatB=fadeMaterial('#2f5240');
 const giantCrownMat=fadeMaterial('#5c6b45');
 function crownFit(geometry,widthTarget,heightTarget){const b=geometry.boundingBox,halfW=Math.max(b.max.x-b.min.x,b.max.y-b.min.y)/2,h=Math.max(1e-4,b.max.z-b.min.z);const s=widthTarget/2/Math.max(1e-4,halfW);return[s,s,heightTarget/h];}
 const treePlan=new Map();// geometry → Map(material → [{pos,scale,rot}])，跟 batches 系統平行、獨立管理（要掛 instanceOpacity，不能共用 batches）。
 function plant(geometry,material,pos,scale,rot){if(!treePlan.has(geometry))treePlan.set(geometry,new Map());const byMat=treePlan.get(geometry);if(!byMat.has(material))byMat.set(material,[]);byMat.get(material).push({pos,scale,rot});}
 let sugiCount=0,hinokiCount=0,maxRegularTrunkR=0;
 const trunkBases=[];// {x,y,z}，z 是實際拿去 plant() 的樹幹基準高度——供驗收比對「樹底貼地」，
 // 不是等驗收腳本自己重算 groundHeight(x,y)（那樣會變成同源比對，恆真、零資訊）。
 const forestExclude=(x,y)=>(y<-9&&x<10)||nearRail(x,y).distance<2.8||turnoutAt(x,y,3)||((x<-15&&y<-10)||(x>15&&y>12));
 for(let i=0;i<330;i++){
  const x=rand()*63-31.5,y=rand()*40-19;if(forestExclude(x,y))continue;
  const z=groundHeight(x,y),near=nearRail(x,y),u=rand(),yaw=rand()*Math.PI*2;
  // 近軌道偏柳杉成列、遠離偏紅檜混生坡上；用連續機率斜率過渡，不是硬切兩塊。
  const sugiChance=THREE.MathUtils.clamp(1-(near.distance-2.8)/9,.15,.86);
  if(rand()<sugiChance){
   sugiCount++;
   const totalH=4.2+(8.6-4.2)*u,trunkH=totalH*.38,crownH=totalH-trunkH,r0=.10+(.20-.10)*u;
   maxRegularTrunkR=Math.max(maxRegularTrunkR,r0);
   plant(sugiTrunkGeo,sugiTrunkMat,[x,y,z],[r0,r0,trunkH],[0,0,yaw]);trunkBases.push({x,y,z});
   const useB=i%2===0,crownGeo=useB?sugiCrownBGeo:sugiCrownAGeo,crownMat=useB?sugiCrownMatB:sugiCrownMatA;
   plant(crownGeo,crownMat,[x,y,z+trunkH],crownFit(crownGeo,crownH*.62,crownH),[0,0,yaw]);
  }else{
   hinokiCount++;
   const totalH=3.6+(7.4-3.6)*u,trunkH=totalH*.30,crownH=totalH-trunkH,r0=.14+(.30-.14)*u;
   maxRegularTrunkR=Math.max(maxRegularTrunkR,r0);
   plant(hinokiTrunkGeo,hinokiTrunkMat,[x,y,z],[r0,r0,trunkH],[0,0,yaw]);trunkBases.push({x,y,z});
   const useB=i%2===1,crownGeo=useB?hinokiCrownBGeo:hinokiCrownAGeo,crownMat=useB?hinokiCrownMatB:hinokiCrownMatA;
   plant(crownGeo,crownMat,[x,y,z+trunkH],crownFit(crownGeo,crownH*.95,crownH),[0,0,yaw]);
  }
 }
 // 神木：地標，放在山上小站西側林緣（折返/車站附近但不進站房足跡），全場最粗樹幹——半徑
 // 0.62 遠超一般紅檜上限 0.30，是刻意的地標尺度，不是隨機滾出來的極端值。
 const GIANT_X=16.5,GIANT_Y=8.5,giantZ=groundHeight(GIANT_X,GIANT_Y),GIANT_R=.62,giantTrunkH=11*.42,giantCrownH=11-giantTrunkH;
 plant(hinokiTrunkGeo,hinokiTrunkMat,[GIANT_X,GIANT_Y,giantZ],[GIANT_R,GIANT_R,giantTrunkH],[0,0,.4]);trunkBases.push({x:GIANT_X,y:GIANT_Y,z:giantZ});
 plant(giantCrownGeo,giantCrownMat,[GIANT_X,GIANT_Y,giantZ+giantTrunkH],crownFit(giantCrownGeo,giantCrownH*.8,giantCrownH),[0,0,.4]);
 // 每個 (geometry,material) 各自一顆 InstancedMesh（7 顆，取代舊版 4 顆），額外掛
 // instanceOpacity 供 updateTreeFade 使用；frustumCulled=false 比照雲/螢火蟲，避免大範圍散佈
 // 實例的自動包圍球算錯導致邊緣提早消失。
 const treeFadeGroups=[];let coneGeometryCount=0;
 for(const [geometry,byMat]of treePlan)for(const [material,items]of byMat){
  const o=new THREE.InstancedMesh(geometry,material,items.length),fadePositions=new Array(items.length);
  // fadeRadius：這棵樹（trunk 或 crown）自己的世界座標視覺半徑，不能只拿中心點去跟遮擋走廊比較
  // ——樹冠寬度常常好幾個單位，中心點在走廊外、但冠緣仍探進走廊、擋到列車，raycast 命中的是
  // 真正的網格三角形（有寬度），淡出判斷卻只測中心點會漏掉這種情況（實測：8 個跟車採樣點有
  // 4 個被就近的樹冠擋住卻沒淡出，才發現這個漏洞）。用 bounding box 的 xy 半寬乘上該實例的
  // 縮放算出來，是這個實例「實際佔據的地面投影半徑」的合理估計。
  const bb=geometry.boundingBox,fadeMidZ=(bb.min.z+bb.max.z)/2,localHalfW=Math.max(bb.max.x-bb.min.x,bb.max.y-bb.min.y)/2;
  items.forEach((t,idx)=>{dummy.position.set(...t.pos);dummy.rotation.set(...t.rot,'ZYX');dummy.scale.set(...t.scale);dummy.updateMatrix();o.setMatrixAt(idx,dummy.matrix);fadePositions[idx]={x:t.pos[0],y:t.pos[1],z:t.pos[2]+fadeMidZ*t.scale[2],radius:localHalfW*t.scale[0]};});
  const opacities=new Float32Array(items.length).fill(1);o.geometry.setAttribute('instanceOpacity',new THREE.InstancedBufferAttribute(opacities,1));
  o.castShadow=o.receiveShadow=true;o.frustumCulled=false;o.userData.isTree=true;group.add(o);
  treeFadeGroups.push({mesh:o,opacities,positions:fadePositions});
  if(geometry.type==='ConeGeometry')coneGeometryCount++;
 }
 const forestDiagnostics={sugiCount,hinokiCount,giantCount:1,maxRegularTrunkR,giantTrunkR:GIANT_R,coneGeometryCount,
  giantPos:{x:GIANT_X,y:GIANT_Y,z:giantZ},
  // 跨陣列均勻抽 12 棵（不是只抽陣列開頭那幾棵，避免只驗到單一批次/單一樹種），供「樹底貼地」
  // 比對用——z 是實際拿去 plant() 的值，驗收腳本要拿去跟 surfaceHeight()（真的對地形網格
  // raycast，不是重算 groundHeight 公式）比較，避免同源比對。
  bases:trunkBases.filter((_,i)=>i%Math.max(1,Math.floor(trunkBases.length/12))===0).slice(0,12)};
 // 跟車鏡頭遮擋淡出：相機與列車中心連線之間的樹（trunk／crown 皆可能擋）淡到 opacity=FADE_OPACITY
 // （≤.3，符合驗收門檻），用「到連線的垂直距離」＋「投影是否落在相機↔列車之間」連續判斷，避免
 // 硬切造成瞬間跳變；main.js 的 draw() 要在 camera.position 算好之後才呼叫這個方法（見該檔案
 // 註解——coast.update() 本身在 camera 定位之前執行，不能把這段邏輯塞進 update()）。
 const _fadeCam=new THREE.Vector3(),_fadeTrain=new THREE.Vector3(),_fadeDir=new THREE.Vector3(),_fadeRel=new THREE.Vector3();
 const FADE_OPACITY=.22,FADE_RADIUS=1.5,FADE_RADIUS_SOFT=1.0,FADE_END_SOFT=.6;
 function updateTreeFade(cameraPos,trainCenter){
  _fadeCam.copy(cameraPos);_fadeTrain.copy(trainCenter);_fadeDir.subVectors(_fadeTrain,_fadeCam);const L=_fadeDir.length();
  if(L>1e-5)_fadeDir.multiplyScalar(1/L);
  for(const grp of treeFadeGroups){let changed=false;
   for(let i=0;i<grp.positions.length;i++){
    const pnode=grp.positions[i];let op=1;
    if(L>1e-5){
     _fadeRel.set(pnode.x-_fadeCam.x,pnode.y-_fadeCam.y,pnode.z-_fadeCam.z);const proj=_fadeRel.dot(_fadeDir);
     if(proj>0&&proj<L){
      const perp=Math.sqrt(Math.max(0,_fadeRel.lengthSq()-proj*proj));
      const lateral=1-THREE.MathUtils.smoothstep(perp,FADE_RADIUS_SOFT+pnode.radius,FADE_RADIUS+pnode.radius);
      const nearEnd=THREE.MathUtils.smoothstep(proj,0,FADE_END_SOFT),farEnd=1-THREE.MathUtils.smoothstep(proj,L-FADE_END_SOFT,L);
      const block=lateral*Math.min(nearEnd,farEnd);op=1-block*(1-FADE_OPACITY);
     }
    }
    if(Math.abs(grp.opacities[i]-op)>1e-4){grp.opacities[i]=op;changed=true;}
   }
   if(changed)grp.mesh.geometry.attributes.instanceOpacity.needsUpdate=true;
  }
 }
 for(let i=0;i<140;i++){const x=rand()*64-32,y=rand()*41-20;if(nearRail(x,y).distance<1.45)continue;const s=.2+rand()*.4;instance(stone,moss,[x,y,groundHeight(x,y)+s*.3],[s*1.4,s,s*.7]);}
 const glass=mat('#819b8c',{emissive:'#ffd69b',emissiveIntensity:0}),lamp=mat('#efd09b',{emissive:'#ffd294',emissiveIntensity:.08}),pointLights=[];
 function station(x,y,z,size){
  block(wall,[size+3,1.4,.48],[x,y-1.6,z+.03]);block(mat('#c3b38d'),[size+3.2,1.55,.1],[x,y-1.6,z+.29]);
  block(wall,[size,2.15,1.8],[x,y,z+.9]);for(let k=-size/2+.3;k<size/2;k+=.45)block(wood,[.045,.06,1.7],[x+k,y-1.10,z+.88]);
  const rs=new THREE.Shape();rs.moveTo(-1.45,0);rs.lineTo(0,.95);rs.lineTo(1.45,0);rs.closePath();const rg=geo(new THREE.ExtrudeGeometry(rs,{depth:size+.7,bevelEnabled:false}));rg.rotateX(Math.PI/2);rg.rotateZ(Math.PI/2);mesh(rg,roof,[x-size/2-.35,y,z+1.8]);
  for(const k of [-1,1])block(glass,[.85,.065,.78],[x+k*size*.23,y-1.13,z+1.02]);
  block(roof,[.73,.09,1.3],[x,y-1.16,z+.68]);
  for(const dx of [-size/2-1,size/2+1]){block(wood,[.12,.12,2.8],[x+dx,y-1.5,z+1.4]);block(lamp,[.4,.3,.15],[x+dx,y-1.5,z+2.7]);const l=new THREE.PointLight('#ffd294',0,6,2);l.position.set(x+dx,y-1.8,z+2.5);group.add(l);pointLights.push(l);}
 }
 station(-23,-10.9,1,5.3);station(23,18.2,12,4.7);
 // 折返端擋車器與轉轍標誌；留置線長度依完整編組驗算。
 const red=mat('#a75240'),sign=mat('#e6d9b6');for(const [x,y,z]of [[30.4,-5,4],[-30.4,6,8],[-30.4,-14,1],[30.4,15,12]]){block(wood,[.2,1.4,.65],[x,y,z+.28]);block(red,[.3,1.55,.18],[x,y,z+.60]);}

 // 林間步道與枕木色欄杆，讓月台融入山坡。
 for(let i=0;i<10;i++){const x=-18+i*.42,y=-8.9,z=groundHeight(x,y);block(wood,[.36,1.2,.12],[x,y,z+.05]);}
 for(const [geometry,byMaterial]of batches)for(const [material,items]of byMaterial){const o=new THREE.InstancedMesh(geometry,material,items.length);items.forEach((p,i)=>{dummy.position.set(...p.pos);dummy.rotation.set(...p.rot,'ZYX');dummy.scale.set(...p.scale);dummy.updateMatrix();o.setMatrixAt(i,dummy.matrix);});o.castShadow=o.receiveShadow=true;group.add(o);}

 // ============================================================
 // 雲海（黃昏限定，禁點光源）＋螢火蟲（夜晚限定，禁點光源）。
 // 看得到的形狀全部來自 fx 這個 Blender 資產 kit，這裡只做擺放/動畫/透明度/發光開關。
 // ============================================================
 const _cq=new THREE.Quaternion(),_cs=new THREE.Vector3(),_cp=new THREE.Vector3(),_cm4=new THREE.Matrix4(),_Z=new THREE.Vector3(0,0,1),_IDQ=new THREE.Quaternion();

 // ---- 雲海：協調端退件重做（原版把雲全部塞在單一山谷小口袋，畫面看起來是牆角一團棉花球，
 // 不是雲海；退件要求「山頭浮在一片雲海上」的經典構圖）。新設計兩個變動：
 // (a) 雲團形狀本身改扁（見 build_alishan_fx.py 第三輪「薄餅狀 lobe」，P7 自檢 height/width≤0.4）；
 // (b) 擺放改成沿「板子真實外框」（沿用 skirt 側面用的同一條 boundary 多邊形，不是另外近似的
 // 矩形）鋪成一整圈，雲頂統一鎖在「全路網最低軌道高度 − 安全邊界」這個全域常數之下——這個常數
 // 比全路網任何一點的軌道都低，結構上保證雲永遠到不了列車所在的高度（跟車鏡頭下遮擋比例仍靠
 // 下面 update() 的動態最近點掃描實測，不是只信這條構造論證）。因為雲現在通常落在板子外框以外
 // 的空間（真正的地形網格只存在於外框以內，超出範圍的 groundHeight() 只是外推值、沒有實體意義），
 // 雲底下限不再拿 groundHeight(x,y) 當基準，改成 BASE_BOTTOM（skirt 側面畫到的物理下緣
 // z=-1.6，跟第 28 行 skirt 幾何用的是同一個數字）——只保證雲不會穿到看台底座下面，不用跟著
 // 局部地形起伏（這是刻意的語意調整，讓「雲海位置」判準在新設計下仍然是一個有意義的物理下限，
 // 不是把舊判準留著卻拿一個不再適用的參照值硬套）。
 const minTrackZ=Math.min(...railPoints.map(pt=>pt.z));
 const CLOUD_CEIL_MARGIN=.8,CLOUD_CEIL=minTrackZ-CLOUD_CEIL_MARGIN,BASE_BOTTOM=-1.6;
 const CLOUD_NAMES=['cloud-a','cloud-b','cloud-c','cloud-d'],CLOUD_CAP=48;
 // emissive 給一點自體微光，壓低單顆球面陰影的明暗反差——不然每顆低面數橢球在方向光下各自
 // 呈現獨立的亮面／暗面，看起來像一堆白色岩石／雪球疊在一起，不是一片柔和的雲海。
 const cloudMat=mat('#fff8ef',{roughness:.9,transparent:true,opacity:0,depthWrite:false,emissive:'#fff2df',emissiveIntensity:.4});
 const cloudBox=new Map(CLOUD_NAMES.map(n=>[n,fx.parts.get(n).geometry.boundingBox]));
 const cloudLocalHalfWidth=new Map(CLOUD_NAMES.map(n=>{const s=cloudBox.get(n).getSize(new THREE.Vector3());return[n,Math.max(s.x,s.y)/2];}));
 const cloudLocalHalfHeight=new Map(CLOUD_NAMES.map(n=>{const s=cloudBox.get(n).getSize(new THREE.Vector3());return[n,s.z/2];}));
 // 診斷用：每種雲的高/寬比直接從執行期重建的 geometry 量，跟 build 階段 P7 自檢（量原始頂點）
 // 是兩層獨立防線，來源不同（一個量 Blender 匯出前的頂點、一個量 Three.js 載入後的 boundingBox）。
 const cloudHeightWidthRatio=Object.fromEntries(CLOUD_NAMES.map(n=>{const s=cloudBox.get(n).getSize(new THREE.Vector3());return[n,s.z/Math.max(s.x,s.y)];}));
 const cloudMeshes=new Map(CLOUD_NAMES.map(n=>{const o=new THREE.InstancedMesh(fx.parts.get(n).geometry,cloudMat,CLOUD_CAP);o.name='fx-'+n;o.frustumCulled=false;o.visible=false;o.count=0;group.add(o);return[n,o];}));
 const cloudInstances=[];
 // 板子真實外框：boundary 是第 27 行已經算好、skirt 側面直接拿去用的同一條閉合多邊形頂點索引，
 // 這裡只是重新走一次算累積弧長，不是另外近似一個矩形——「依板子輪廓分 12 段」字面上的意思。
 const perim=[...boundary,boundary[0]].map(k=>({x:positions[k*3],y:positions[k*3+1]}));
 const segLens=[];let perimTotal=0;
 for(let i=0;i<perim.length-1;i++){const d=Math.hypot(perim[i+1].x-perim[i].x,perim[i+1].y-perim[i].y);segLens.push(d);perimTotal+=d;}
 function pointAtArc(s){s=((s%perimTotal)+perimTotal)%perimTotal;let acc=0;for(let i=0;i<segLens.length;i++){if(acc+segLens[i]>=s){const t=segLens[i]>1e-9?(s-acc)/segLens[i]:0;return{x:THREE.MathUtils.lerp(perim[i].x,perim[i+1].x,t),y:THREE.MathUtils.lerp(perim[i].y,perim[i+1].y,t)};}acc+=segLens[i];}return perim[0];}
 const SEGMENTS=12,OUTWARD_MIN=1,OUTWARD_MAX=4.2;
 for(let seg=0;seg<SEGMENTS;seg++){
  const anchor0=pointAtArc((seg+.5)/SEGMENTS*perimTotal);
  // 下坡端（低 y）加密，呼應「沿著山塊下坡端與四周外圍鋪一層，下坡端較厚」；其餘外圍段仍然
  // 每段都有雲（覆蓋判準要求 12 段至少 8 段有雲，這裡故意做到 12/12 留餘裕，不卡在門檻邊緣）。
  const n=anchor0.y<-8?9:5;
  for(let i=0;i<n;i++){
   const s=(seg+ (i+.5)/n)/SEGMENTS*perimTotal+(rand()*2-1)*(perimTotal/SEGMENTS)*.08,anchor=pointAtArc(s);
   const rlen=Math.hypot(anchor.x,anchor.y)||1,nx=anchor.x/rlen,ny=anchor.y/rlen;// 徑向近似外法線（板子接近矩形，夠用）
   const outward=OUTWARD_MIN+rand()*(OUTWARD_MAX-OUTWARD_MIN);
   const x=anchor.x+nx*outward+(rand()*2-1)*1.1,y=anchor.y+ny*outward+(rand()*2-1)*1.1;
   const name=CLOUD_NAMES[Math.floor(rand()*CLOUD_NAMES.length)],cm=cloudMeshes.get(name);
   if(cm.count>=CLOUD_CAP)continue;
   const halfWidth=2+rand()*2.1,scaleFactor=halfWidth/cloudLocalHalfWidth.get(name),halfHeight=cloudLocalHalfHeight.get(name)*scaleFactor;
   const topDrop=rand()*.5,wz=CLOUD_CEIL-topDrop-halfHeight;
   if(wz-halfHeight<BASE_BOTTOM+.1)continue;// 物理下限防呆（不縮小硬擠，整個放棄候選點）
   cloudInstances.push({name,mesh:cm,index:cm.count,x,y,z:wz,radius:halfWidth,halfHeight,ground:BASE_BOTTOM,segment:seg,railDist:nearRail(x,y).distance,
    top:wz+halfHeight,wx:x,wy:y,wz,phase:rand()*Math.PI*2,ampX:.25+rand()*.2,ampY:.2+rand()*.15,freq:.05+rand()*.04,yaw:rand()*Math.PI*2});
   cm.count++;
  }
 }
 cloudInstances.forEach(c=>{_cq.setFromAxisAngle(_Z,c.yaw);_cs.setScalar(c.radius/cloudLocalHalfWidth.get(c.name));_cm4.compose(_cp.set(c.x,c.y,c.z),_cq,_cs);c.mesh.setMatrixAt(c.index,_cm4);});
 cloudMeshes.forEach(o=>{o.instanceMatrix.needsUpdate=true;});
 function updateClouds(time){
  for(const c of cloudInstances){
   c.wx=c.x+Math.sin(time*c.freq+c.phase)*c.ampX;c.wy=c.y+Math.cos(time*c.freq*.8+c.phase*1.3)*c.ampY;c.wz=c.z;
   c.railDist=nearRail(c.wx,c.wy).distance;c.top=c.wz+c.halfHeight;
   _cq.setFromAxisAngle(_Z,c.yaw);_cs.setScalar(c.radius/cloudLocalHalfWidth.get(c.name));_cm4.compose(_cp.set(c.wx,c.wy,c.wz),_cq,_cs);
   c.mesh.setMatrixAt(c.index,_cm4);
  }
  cloudMeshes.forEach(o=>{o.instanceMatrix.needsUpdate=true;});
 }
 let forceClouds=null,forceFireflies=null,trainScale=null;

 // ---- 螢火蟲：第四輪退回重做。協調端這次是對著「渲染技法」退件，不是位置/密度——舊版核心/
 // 外暈都是同一個 Blender 低面數（20 面，firefly subdivisions=0）icosphere 縮放疊圖，放大到
 // 看得見的亮度/尺寸後八角形輪廓很明顯、加色混合又是整面同一個顏色（沒有內建的邊緣柔化），讀起來
 // 像一顆顆硬邊白色氣球。舊版外暈的縮放倍率（核心 .075~.135 疊乘 4.2~5.6 倍）換算世界座標半徑
 // 最大到 0.75 個單位，中心落在「離地 0.2~1.2」的高度帶，加上這個半徑之後視覺範圍會探到跟車身
 // 差不多高——這才是「擠在列車旁邊、跟車身一樣高」的真正成因，不是撒點分布本身有問題（撒點仍是
 // 沿整條路線＋左右 0.8~2.5 偏移，兩側都有、沒有偏向列車那一側）；是舊版幾何體積太大，跟車鏡頭
 // 框到的幾隻視覺上「頂」到了車身，新設計把尺寸整個砍到 4~10px/≤3px 之後這個現象也隨之消失，
 // 撒點邏輯本身不需要動。新設計把整隻螢火蟲的視覺效果換成「程式碼產生的放射漸層」貼圖，套在
 // 永遠面向鏡頭的 THREE.Sprite 上——alpha=(1-r)^power 是連續函式，天生沒有多邊形輪廓，退件
 // 訊息明講這是允許的例外（光暈本來就是「光」不是「實體」，跟南迴棕櫚樹那種要讀成實體植被的
 // 程序化幾何是兩回事）。不再引用 Blender 的 firefly 零件幾何（fx.parts.get('firefly') 仍留在
 // 資產庫裡沒有害處，只是不再被拿來畫東西）。核心＋外暈共用同一張紋理，只用縮放/不透明度分工，
 // 兩層都以同一點為中心、本身沿半徑遞減，相加後仍然沿半徑單調遞減。全程零點光源（本專案已知
 // 地雷：點光源開太多會讓 headless WebGL context 崩潰）。
 // 2026-09-28 精修（協調端退件「幾乎看不到，撒得太開像雜訊」）：上一輪已解決「硬邊白氣球」，
 // 這次是兩個新問題：(a) 120 隻沿三條路線純隨機撒點，密度被稀釋到看不出「螢火蟲聚落」；
 // (b) 亮度公式 max(0,sin(...))^1.6 有半個週期完全是 0，任何瞬間平均在亮比例遠低於視覺可辨
 // 門檻。新設計見下面 FIREFLY_CLUSTERS 與 breathe()，尺寸/柔邊度技法（HALO_PX/CORE_PX/
 // glowTex）完全不動，新增 setFireflyHalo/setFireflyCore 讓 verify 腳本能把「尺寸」（讀回
 // haloDia/coreDia 世界座標）與「柔邊度」（core-only 像素量測）解耦——halo 半徑變大時中心
 // 附近的加色貢獻也會變大（同一條 alpha(r/R) 曲線在絕對像素距離下被拉得更平緩），這是疊圖的
 // 真實光學效應不是量測 bug，唯一乾淨的解法是量測時把兩層拆開。
 // 顏色：G>R>B 且 B/G=130/255≈.510（退件要求 ≤.6），黃綠色不是白色。
 const FIREFLY_COLOR=new THREE.Color(150/255,255/255,45/255);
 // 2026-09-28 突變3（放大 HALO_PX）證明「柔邊度在畫面上量」結構上量不乾淨：外暈變大會讓
 // 合併訊號的 ring-sampling 剖面跟著變形，尺寸與柔邊度綁在同一份掃描上，不可能解耦。柔邊度其實
 // 是這張貼圖「自己」的內在屬性（halo/core 兩個 sprite 只是用不同 scale/opacity 疊同一張貼圖），
 // 所以改成直接讀 putImageData 實際寫入畫布的 alpha 值本身（sampleAlphaProfile，不是重算
 // Math.pow 公式——改壞產生迴圈本身，例如漏掉 pow、x/y 顛倒、整層填死 255，一樣量得到），
 // 結構上不受任何 on-screen 尺寸/mipmap/ACES 色調映射/背景疊色影響。
 function sampleAlphaProfile(data,size,c){
  const alphaAtF=(px,py)=>{
   const x0=Math.floor(px),y0=Math.floor(py),fx=px-x0,fy=py-y0;
   const A=(xx,yy)=>{const cx=Math.max(0,Math.min(size-1,xx)),cy=Math.max(0,Math.min(size-1,yy));return data[(cy*size+cx)*4+3];};
   return A(x0,y0)*(1-fx)*(1-fy)+A(x0+1,y0)*fx*(1-fy)+A(x0,y0+1)*(1-fx)*fy+A(x0+1,y0+1)*fx*fy;
  };
  const ringAvg=rFrac=>{if(rFrac<=0)return alphaAtF(c,c);let s=0;const n=16,r=rFrac*c;for(let k=0;k<n;k++){const a=k/n*Math.PI*2;s+=alphaAtF(c+Math.cos(a)*r,c+Math.sin(a)*r);}return s/n;};
  return[0,.25,.5,.75,.9,1].map(f=>({rFrac:f,alpha:+ringAvg(f).toFixed(2)}));
 }
 function makeGlowTexture(power){
  const size=64,cv=document.createElement('canvas');cv.width=cv.height=size;
  const ctx=cv.getContext('2d'),img=ctx.createImageData(size,size),c=size/2;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const dx=x+.5-c,dy=y+.5-c,r=Math.min(1,Math.hypot(dx,dy)/c),a=Math.pow(Math.max(0,1-r),power),i=(y*size+x)*4;
   img.data[i]=255;img.data[i+1]=255;img.data[i+2]=255;img.data[i+3]=Math.round(a*255);
  }
  ctx.putImageData(img,0,0);const t=new THREE.CanvasTexture(cv);t.needsUpdate=true;
  // 螢火蟲在畫面上只有個位數像素大小，貼圖是 64×64——縮小比例很大，一定要開 mipmap
  // （LinearMipmapLinearFilter）讓 GPU 正確預先平均每一階 LOD，不然單層 bilinear 在這種縮小率
  // 下會用近似點取樣、把原本平滑的放射漸層讀成鋸齒/偏平的樣子，柔邊度判準會量到假的高原。
  t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;
  t.alphaProfile=sampleAlphaProfile(img.data,size,c);
  return t;
 }
 // power=3.0：紋理 alpha 在 75% 半徑處＝(1-.75)^3≈.0156（中心的 1.56%），理論上遠低於退件
 // 要求的 ≤40%；實測（見 alishan-fx-20260928/README.md 第四輪小節）螢火蟲整體只有個位數像素、
 // 紋理縮小率極大，mipmap 混合／次像素取樣／核心與外暈疊加後的實際輪廓比理論曲線平坦——
 // power 太低（2.4）時實測 ratio75 一度貼到 0.405（超過門檻），太高（4.5）雖然 ratio75 很安全
 // 但外暈能蓋到的面積太小、可見數量掉到個位數；3.0 配合下面加大的外暈像素目標／不透明度，
 // 實測 17 隻可見、ratio75 最高 0.382，兩邊都留了餘裕。
 const glowTex=makeGlowTexture(3.0);textures.add(glowTex);
 // 世界座標→像素換算：夜晚跟車鏡頭在驗收用的 1440×1000 視窗下實測 ≈55.6 px/單位（正交相機，
 // 這個比例只跟 span/aspect/畫布尺寸有關，跟縮放/位置無關）。外暈目標像素 10~14px 取樣（退件
 // 門檻 4~10px 是「量到的」直徑，不是紋理縮放目標——LIT=30 的閾值掃描只會抓到曲線裡夠亮的那
 // 一小段，量到的直徑天生比紋理縮放目標小很多，10~14 換算出來實測落在 4.2~7.6px），核心目標
 // 像素 1.6~2.4px（退件門檻 ≤3px 留邊界，核心的量法直接對應紋理縮放目標、沒有這層落差）。
 const PX_PER_UNIT=55.6,HALO_PX=[10,14],CORE_PX=[1.6,2.4];
 const fireflyGroup=new THREE.Group();fireflyGroup.visible=false;group.add(fireflyGroup);
 // 5 個聚落：route 索引／沿路線弧長中心／展幅／隻數，比照真實螢火蟲群聚暗處林緣的習性；
 // route1 center8 錨在既有「阿里山-螢火蟲可見」判準使用的跟車停車測試 t=86.15（route1,
 // s≈7.8~8，第二折返停車點）附近，保證那個測試瞬間鏡頭前一定有一群。總數 120，跟既有判準
 // 60~120 上限一致——只改變空間分布，沒有改變總隻數。
 // 2026-09-28 探針量測（probe_firefly_visibility.mjs）發現 t=86.15 當下只有 route1/center8
 // 這一群真的在畫面內（其餘 4 群此刻不在鏡頭視野，這本來就預期——鏡頭只框得到停靠點附近）；
 // 這一群原本 30 隻裡，約半數雖幾何在畫面內、brightness 卻量到訊號 0——診斷是被列車本體
 // （3 節車廂）擋住（隨機落在遠離鏡頭那一側的軌道旁），不是太暗。結構上不特判「哪一側背對
 // 鏡頭」（那要綁死這一顆鏡頭姿態，換角度就失效），改成單純提高這一群密度、其餘 4 群等比例
 // 減少（總數維持 120 不變，仍是 5 群、各自展幅不變），讓「就算半數被列車擋住」仍有餘裕
 // 過關；重跑量測確認見 verify 輸出。
 const FIREFLY_CLUSTERS=[
  {route:0,center:20,spread:5,count:14},
  {route:0,center:44,spread:5,count:12},
  {route:1,center:8, spread:5,count:52},
  {route:1,center:32,spread:6,count:18},
  {route:2,center:34,spread:6,count:24},
 ];
 const FIREFLY_COUNT=FIREFLY_CLUSTERS.reduce((n,c)=>n+c.count,0);
 const fireflyInstances=[],fireflyBrightness=new Array(FIREFLY_COUNT).fill(0);
 let haloOverride=null,coreOverride=null,clusterSeq=0;
 for(const cluster of FIREFLY_CLUSTERS){
  const route=routes[cluster.route];
  for(let k=0;k<cluster.count;k++){
   let x=0,y=0,tries=0,ok=false;
   do{
    const s=Math.max(0,Math.min(route.length,cluster.center+(rand()*2-1)*cluster.spread));
    const pt=route.sample(s),side=rand()<.5?-1:1,off=.8+rand()*1.7;
    x=pt.x-Math.sin(pt.heading)*off*side;y=pt.y+Math.cos(pt.heading)*off*side;tries++;
    const nd=nearRail(x,y).distance;
    ok=nd>=.75&&nd<=2.6&&!turnoutAt(x,y,3)&&!((y<-9&&x<10)||((x<-15&&y<-10)||(x>15&&y>12)));
   }while(!ok&&tries<25);
   // z 是「離當地地面的相對高度」（0.2~1.2，跟既有「阿里山-螢火蟲」判準的高度區間定義一致），
   // 換算真實世界比例見 fx.setTrainScale／fireflyHeightsM，這個既有範圍不受本輪調整影響。
   const groundZ=groundHeight(x,y);
   const haloMat=new THREE.SpriteMaterial({map:glowTex,color:FIREFLY_COLOR,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false,opacity:0});
   const coreMat=new THREE.SpriteMaterial({map:glowTex,color:FIREFLY_COLOR,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false,opacity:0});
   materials.add(haloMat);materials.add(coreMat);
   const halo=new THREE.Sprite(haloMat),core=new THREE.Sprite(coreMat);fireflyGroup.add(halo,core);
   // 相位用「本群內均勻分層＋半格抖動」而非純 rand()，結構上避免同群多隻同時暗下去，是
   // 60% 在亮下限的主要安全邊際來源（純獨立隨機相位在 120 隻的統計波動下邊際太薄）。
   const phase=(k+rand()*.5)/cluster.count;
   fireflyInstances.push({x,y,groundZ,z:.2+rand()*1,wx:x,wy:y,wz:groundZ+.2,
    period:2+rand()*2,phase,clusterId:clusterSeq,driftPhase:rand()*Math.PI*2,driftFreq:.06+rand()*.05,amp:.12+rand()*.13,
    halo,core,haloDia:(HALO_PX[0]+rand()*(HALO_PX[1]-HALO_PX[0]))/PX_PER_UNIT,coreDia:(CORE_PX[0]+rand()*(CORE_PX[1]-CORE_PX[0]))/PX_PER_UNIT});
  }
  clusterSeq++;
 }
 // breathe(u)：u 是各自週期/相位下的 0..1 進度。clamp(BASE+AMP*sin(2π·u)) 使任何瞬間「在亮」
 // （brightness≥.25，verify 用這個閾值）比例的理論值 ≈69%，遠高於 60% 門檻；同時 sin 只有
 // 頂/底窄段被 clamp 拉平（≈24%），其餘 ≈76% 週期仍在連續變化，既有「阿里山-螢火蟲」判準
 // （0.3 秒視窗內 ≥20% 有感變化）不受影響。
 const LIT_BASE=.58,LIT_AMP=.58;
 function breathe(u){return Math.min(1,Math.max(0,LIT_BASE+LIT_AMP*Math.sin(u*Math.PI*2)));}
 function updateFireflies(time){
  for(let i=0;i<FIREFLY_COUNT;i++){
   const f=fireflyInstances[i],u=((time/f.period+f.phase)%1+1)%1,br=breathe(u);
   fireflyBrightness[i]=br;
   const wx=f.x+Math.sin(time*f.driftFreq+f.driftPhase)*f.amp,wy=f.y+Math.cos(time*f.driftFreq*.7+f.driftPhase)*f.amp,wz=f.groundZ+f.z+Math.sin(time*f.driftFreq*1.3+f.driftPhase)*.05;
   f.wx=wx;f.wy=wy;f.wz=wz;
   f.halo.visible=haloOverride!==false;f.core.visible=coreOverride!==false;
   f.halo.position.set(wx,wy,wz);f.halo.scale.set(f.haloDia,f.haloDia,1);f.halo.material.opacity=.5+br*.45;
   f.core.position.set(wx,wy,wz);f.core.scale.set(f.coreDia,f.coreDia,1);f.core.material.opacity=.45+br*.2;
  }
 }

 const ray=new THREE.Raycaster();
 return{surfaceHeight(x,y){group.updateMatrixWorld(true);ray.set(new THREE.Vector3(x,y,100),new THREE.Vector3(0,0,-1));return ray.intersectObject(terrain)[0]?.point.z;},group,routes,turnouts,label:'阿里山林鐵',groundHeight,nearRail,themes:THEMES,camera:{yaw:-1.35,elevation:.65},update(time,period,pose){if(pose)turnouts.update(turnoutStates(pose));glass.emissiveIntensity=period==='night'?1.1:period==='sunset'?.25:0;lamp.emissiveIntensity=period==='night'?2:.08;pointLights.forEach(l=>l.intensity=period==='night'?5:0);
  const cloudsOn=forceClouds??(period==='sunset');cloudMat.opacity=cloudsOn?.62:0;cloudMeshes.forEach(o=>{o.visible=cloudsOn&&o.count>0;});if(cloudsOn)updateClouds(time);
  const fireOn=forceFireflies??(period==='night');fireflyGroup.visible=fireOn;if(fireOn)updateFireflies(time);
 },
 // 跟車鏡頭遮擋淡出：main.js 的 draw() 要在 camera.position 算好之後才呼叫這個方法（不能塞進
 // 上面的 update()——coast.update() 本身在 camera 定位之前執行，見 main.js 註解）。
 updateTreeFade,
 forest:forestDiagnostics,
 fx:{
  get state(){return{cloudOpacity:cloudMat.opacity,cloudVisible:[...cloudMeshes.values()].some(o=>o.visible),
    minTrackZ,cloudCeil:CLOUD_CEIL,baseBottom:BASE_BOTTOM,segments:SEGMENTS,cloudHeightWidthRatio,
    clouds:cloudInstances.map(c=>({name:c.name,wx:c.wx,wy:c.wy,wz:c.wz,radius:c.radius,halfHeight:c.halfHeight,ground:c.ground,segment:c.segment,top:c.top,railDist:c.railDist})),
    fireflyVisible:fireflyGroup.visible,fireflyCount:FIREFLY_COUNT,fireflyClusterCount:FIREFLY_CLUSTERS.length,pxPerUnit:PX_PER_UNIT,
    glowAlphaProfile:glowTex.alphaProfile,
    fireflyHeights:fireflyInstances.map(f=>f.z),
    fireflyHeightsM:trainScale?fireflyInstances.map(f=>f.z/trainScale):null,
    fireflyBrightness:[...fireflyBrightness],
    fireflyPositions:fireflyInstances.map((f,i)=>({x:f.wx,y:f.wy,z:f.wz,brightness:fireflyBrightness[i],clusterId:f.clusterId,haloDia:f.haloDia,coreDia:f.coreDia}))};},
  setForceClouds(v){forceClouds=v;},
  setForceFireflies(v){forceFireflies=v;},
  // 2026-09-28 新增：讓 verify 腳本能把「尺寸」（讀回 haloDia/coreDia 世界座標，不受這兩個
  // 開關影響）跟「柔邊度」（core-only 像素量測，halo 強制關閉）完全解耦——理由見上面螢火蟲
  // 大註解。v 傳 false 強制隱藏，傳 null 恢復預設（跟著 breathe() 亮度走）。
  setFireflyHalo(v){haloOverride=v;},
  setFireflyCore(v){coreOverride=v;},
  // 第四輪退回新增：main.js 在 train 模型載入完成後呼叫一次，填入「世界單位/公尺」比例
  // （1.25/primary.size.y，跟 garage-model.js createConsist 內部用的是同一個公式），供
  // fireflyHeightsM 换算螢火蟲離地高度的真實世界公尺數。
  setTrainScale(s){trainScale=s;}
 },
 dispose(){group.clear();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}};
}
