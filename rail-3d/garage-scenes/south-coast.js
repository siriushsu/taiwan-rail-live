// 南迴海岸的微縮印象；不是特定車站或實際線形的重建。沿線物件由固定 seed 生成。
import * as THREE from '../vendor/three.module.js';
import {personPose} from '../garage-people.js?revision=people-0927';
export const THEMES = {
 day:{background:'#eae7dd',sun:'#fff1cf',ambient:'#c1dce7',ground:'#7b8663',power:3.2,exposure:1.05,water:'#307c8c',shallow:'#71b3ae'},
 sunset:{background:'#e9d6c3',sun:'#ffbc77',ambient:'#d5b7b2',ground:'#6c7161',power:3.1,exposure:.95,water:'#547f89',shallow:'#9db5a4'},
 night:{background:'#172c38',sun:'#a4c8eb',ambient:'#69839d',ground:'#2d3b40',power:.7,exposure:.78,water:'#193e55',shallow:'#3b6975'}
};
export function createScene(palmsKit=null,stationKit=null){
 const group=new THREE.Group(),geometries=new Set(),materials=new Set();
 let seed=9184; const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const geo=g=>(geometries.add(g),g),mat=(color,more={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.88,...more});materials.add(m);return m;};
 const box=geo(new THREE.BoxGeometry(1,1,1)),stoneGeo=geo(new THREE.IcosahedronGeometry(1,0));
 // 棕櫚（檳榔／椰子）改用 Blender 建模的零件庫（rail-3d/assets/garage-palms-v1，見
 // scripts/blender/palms-20260928/README.md），取代舊版程式拼的細方柱樹幹＋薄三角形葉片
 // （使用者：「那個樹看起來像是個笑話」——側面看葉片變成一條線、樹幹比山還高）。palmsKit 由呼叫端
 // （main.js）非同步載入好才傳進來，跟站務員的 people kit 同一個道理：createScene() 這個純函式階段
 // 拿不到非同步資源（見檔尾 createAttendant 的說明）。沒有 kit 時就不種樹，其餘場景不受影響——
 // 沿用既有 Node 端 verify（scripts/verify_garage_south_coast_stop.mjs）呼叫 createScene() 的慣例。
 const grass=mat('#809475'),rock=mat('#879081'),sand=mat('#c1bb9f'),gravel=mat('#a69c84'),wood=mat('#5b4c3a'),steel=mat('#8a9291',{metalness:.65,roughness:.35}),cream=mat('#e9dfc3'),roof=mat('#557f7b'),red=mat('#a45c46');
 // lamp／windows 是發光材質，掛在路燈玻璃與窗玻璃兩個 Blender 零件（garage-coast-v1）上，
 // 材質物件本身不變，update() 照舊只切 emissiveIntensity 就能驅動日夜——見檔尾 update()。
 const lamp=mat('#f6d797',{emissive:'#ffc879',emissiveIntensity:.08});
 const windows=mat('#718e8a',{metalness:.15,roughness:.25,emissive:'#ffc47e',emissiveIntensity:0});
 function mesh(g,m,pos){const o=new THREE.Mesh(g,m);if(pos)o.position.set(...pos);o.castShadow=true;o.receiveShadow=true;group.add(o);return o;}
 function block(m,size,pos){const o=mesh(box,m,pos);o.scale.set(...size);return o;}
 function rounded(w,h,r){const s=new THREE.Shape();s.moveTo(-w/2+r,-h/2);s.lineTo(w/2-r,-h/2);s.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);s.lineTo(w/2,h/2-r);s.quadraticCurveTo(w/2,h/2,w/2-r,h/2);s.lineTo(-w/2+r,h/2);s.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);s.lineTo(-w/2,-h/2+r);s.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);return s;}
 const outline=rounded(66,40,4);
 mesh(geo(new THREE.ExtrudeGeometry(outline,{depth:1.05,bevelEnabled:true,bevelSize:.28,bevelThickness:.2,bevelSegments:2,steps:1,curveSegments:12})),mat('#a28c6a'),[0,0,-2]);
 mesh(geo(new THREE.ExtrudeGeometry(rounded(66.6,40.6,4.2),{depth:.23,bevelEnabled:true,bevelSize:.13,bevelThickness:.1,bevelSegments:2,curveSegments:12})),mat('#614f3a'),[0,0,-2.16]);
 const waterMat=mat(THEMES.day.water,{roughness:.35,metalness:.12});
 const water=mesh(geo(new THREE.ShapeGeometry(outline,24)),waterMat,[0,0,-.61]);water.castShadow=false;
 waterMat.onBeforeCompile=s=>{s.uniforms.coastTime={value:0};s.uniforms.shallow={value:new THREE.Color(THEMES.day.shallow)};waterMat.userData.shader=s;s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 coastPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\ncoastPosition=position;');s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform float coastTime; uniform vec3 shallow; varying vec3 coastPosition;').replace('#include <color_fragment>',`#include <color_fragment>
 float edge=-9.0+sin(coastPosition.x*.14)*.8+sin(coastPosition.x*.31)*.35;
 float d=edge-coastPosition.y;
 float wave=sin(d*5.3-coastTime*.8+sin(coastPosition.x*.4)*.5);
 float foam=smoothstep(.88,1.0,wave)*(1.0-smoothstep(0.,2.6,d))*smoothstep(-.1,.2,d);
 float glint=pow(max(0.,sin(coastPosition.x*.8+coastPosition.y*3.2+coastTime*.5)),28.)*smoothstep(.4,.8,sin(coastPosition.x*.61-coastPosition.y*.42))*.025;
 diffuseColor.rgb=mix(diffuseColor.rgb,shallow,exp(-max(d,0.)*.28)*.7)+foam*.2+glint;`);};
 const shore=x=>-9+Math.sin(x*.14)*.8+Math.sin(x*.31)*.35;
 function coastStrip(offset,width,z,material){const v=[],idx=[],N=160;for(let i=0;i<=N;i++){const x=-31+i/N*62;for(const k of [0,1])v.push(x,shore(x)+offset+k*width,z+(k? .03:0));if(i<N){const n=i*2;idx.push(n,n+1,n+2,n+1,n+3,n+2);}}const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();return mesh(g,material);}
 coastStrip(-.35,1.4,-.54,sand);coastStrip(.65,1.7,-.32,gravel);
 const shape=new THREE.Shape();shape.moveTo(-31,shore(-31)+1.1);for(let i=1;i<=160;i++){const x=-31+i/160*62;shape.lineTo(x,shore(x)+1.1);}shape.lineTo(31,16);shape.quadraticCurveTo(31,18,28,18);shape.lineTo(-28,18);shape.quadraticCurveTo(-31,18,-31,16);shape.closePath();
 mesh(geo(new THREE.ExtrudeGeometry(shape,{depth:.62,bevelEnabled:false,curveSegments:16})),grass,[0,0,-.7]);
 // 平緩的沿海環線；車與軌道共用同一個弧長取樣，藏在山後的回程不切換座標。
 const half=20,radius=7.4,length=half*4+2*Math.PI*radius,cy=2.4;
 function sample(s){let q=((s+half)%length+length)%length,x,y,heading;if(q<half*2){x=-half+q;y=cy-radius;heading=0;}else if((q-=half*2)<Math.PI*radius){const a=-Math.PI/2+q/radius;x=half+radius*Math.cos(a);y=cy+radius*Math.sin(a);heading=a+Math.PI/2;}else if((q-=Math.PI*radius)<half*2){x=half-q;y=cy+radius;heading=Math.PI;}else{q-=half*2;const a=Math.PI/2+q/radius;x=-half+radius*Math.cos(a);y=cy+radius*Math.sin(a);heading=a+Math.PI/2;}return{x,y,z:.18,heading};}
 const path={sample,length};
 function ribbon(offset,width,z,material){const v=[],idx=[],N=600;for(let i=0;i<=N;i++){const p=sample(i/N*length);for(const k of [-1,1])v.push(p.x-Math.sin(p.heading)*(offset+k*width/2),p.y+Math.cos(p.heading)*(offset+k*width/2),z);if(i<N){const n=i*2;idx.push(n,n+2,n+1,n+1,n+2,n+3);}}const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();return mesh(g,material);}
 ribbon(0,2.3,.015,gravel);ribbon(-.54,.08,.18,steel);ribbon(.54,.08,.18,steel);
 const dummy=new THREE.Object3D();
 function instances(g,m,items){const o=new THREE.InstancedMesh(g,m,items.length);items.forEach((p,i)=>{dummy.position.set(...p.pos);dummy.rotation.set(...(p.rot||[0,0,0]));dummy.scale.set(...p.scale);dummy.updateMatrix();o.setMatrixAt(i,dummy.matrix);});o.castShadow=true;o.receiveShadow=true;group.add(o);return o;}
 const ties=[];for(let s=0;s<length;s+=.42){const p=sample(s);ties.push({pos:[p.x,p.y,.08],rot:[0,0,p.heading],scale:[.17,1.7,.1]});}instances(box,wood,ties);
 // 中景山丘形成遮擋，遠處軌道從山後繞回；固定三角網格不需外部地形圖。
 const hills=[[-16,4.8,7.6,4.5,7],[-8,5.3,6.5,3.7,7.8],[2,5.2,7,4,6],[12,5.2,6.2,4.1,9.2],[19,4.8,5,3.2,6.5]];
 function height(x,y){let h=0;for(const [cx,cy,rx,ry,z]of hills){const d=((x-cx)/rx)**2+((y-cy)/ry)**2;h=Math.max(h,z*Math.max(0,1-d)**1.25);}return h;}
 const hv=[],hi=[],hc=[],cols=['#8b9a76','#7b8e6c','#93a17d','#748563'].map(x=>new THREE.Color(x));
 const nx=112,ny=28;for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){const x=-27+i/nx*54,y=.7+j/ny*8.6,h=height(x,y);hv.push(x,y,h-.05);const c=cols[0].clone().lerp(cols[3],Math.min(1,h/11)).multiplyScalar(.97+rand()*.06);hc.push(c.r,c.g,c.b);}
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const k=j*(nx+1)+i;hi.push(k,k+1,k+nx+1,k+1,k+nx+2,k+nx+1);}const hg=geo(new THREE.BufferGeometry());hg.setAttribute('position',new THREE.Float32BufferAttribute(hv,3));hg.setAttribute('color',new THREE.Float32BufferAttribute(hc,3));hg.setIndex(hi);hg.computeVertexNormals();mesh(hg,mat('#ffffff',{vertexColors:true,flatShading:true}));
 // 植被兩個迴圈（山坡 loop1、後排平地 loop2）抽 rand() 的次數與順序跟 HEAD 逐行相同：每棵先抽 x/y（loop1
 // 過地形門檻才抽 s），迴圈尾端再抽固定次數（loop1 六次、loop2 四次，原本是舊版扇葉的 jitter，現在不用了，
 // 但次數保留，下游石頭的亂數序列才不會動）。種不種、種哪個物種、哪一款、yaw、深淺都看已抽出的 i/z/s 做
 // 雜湊取餘數或地形高度的決定性判斷，不呼叫新的 rand()；闊葉樹的擺放與 HEAD 逐 byte 相同（verify 驗雜湊）。
 const uOf=s=>(s-.38)/.58; // s 正規化到 0~1（loop1 s∈[.38,.96]；loop2 s∈[.4,.9] 是子集）。
 // 棕櫚（第三版，09-28）：整棵樹在 Blender 建好（scripts/blender/palms-20260928/build_palms.py，椰子 3 款＋
 // 檳榔 2 款），一款樹＝零件庫裡同一個前綴的幾個零件（樹幹、環紋、樹冠、葉鞘、椰子果、枯葉，顏色不同所以
 // 分開存）；這裡只把它們接成一份幾何、每個零件上一個頂點色，一款樹＝一個 InstancedMesh。程式只管擺放：
 // 位置（樹幹底＝HEAD 的同一點）、yaw、等比縮放、每棵的深淺（instanceColor），形狀一律是 Blender 的。
 // 第二版「每片葉子一個 instance、下垂角由程式算」被使用者退回（原話：「只有藍皮的樹 感覺還是不太對」
 // 「棕梠樹的比例跟樣貌太奇怪」），主對話讀截圖歸納的問題：葉子從頂端直接往下垂、藍綠色、檳榔像牙籤、
 // 比旁邊的闊葉樹矮一截。
 // 顏色（sRGB）：椰子葉黃綠（色相約 79～83°）、檳榔葉綠（約 94～96°）、檳榔葉鞘比葉子亮；色相 150～200°
 // 的藍綠不用——色相範圍是主對話 09-28 派工訂的判準，verify_garage_south_coast_stop.mjs 會量。
 const PALM_COLORS={
  coco:{trunk:'#8a7c67',rings:'#716656',knob:'#766747',fronds:'#6f8f3c',young:'#86a24a',dry:'#9c7d52',fruit:'#8f6a34'},
  betel:{trunk:'#aba694',rings:'#827c6b',shaft:'#8fc25a',fronds:'#5d8c3a',young:'#6fa24e'}};
 const PALM_MODELS=['coco-straight','coco-curved-a','coco-curved-b','betel-a','betel-b'];
 const PALM_OF_KIND={coco:'coco-straight',cocoCurvedA:'coco-curved-a',cocoCurvedB:'coco-curved-b'}; // HEAD 的物種 → 三款椰子各自的樹幹
 // 整棵高度（場景單位，UNITS_PER_METER=.4435）：主對話 09-28 派工要求「棕櫚要讀得出是高大的樹，不能比同一坡帶
 // 的闊葉樹矮一截」。同一坡帶（ratio<.38）的闊葉樹實測 1.79～3.41（平均 2.47），所以椰子 2.8～3.5（6.3～7.9 m）、
 // 檳榔 3.0～3.7（6.8～8.3 m），用同一個 s 內插（樹越高冠越寬是同一個尺寸因子，等比縮放）。
 // 舊版註解寫「使用者裁示：檳榔 2.2~2.8、椰子 1.8~2.6」是錯的出處：那組數字是主對話 09-27 派工時自己訂的。
 const COCO_HEIGHT=[2.8,3.5],BETEL_HEIGHT=[3.0,3.7];
 // 後排（車站周邊內側平地，loop2）整棵等比縮成幼樹：它們在回程直線（y=9.8）的外側，跟車鏡頭從環線外側往內看時
 // 會擋在車前（main.js 的 train 視角）；係數沿用第二版量 verify_garage_follow_camera（可見比例 ≥.9）定案的 .45。
 const BACK_ROW_SCALE=.45;
 const palmItems=new Map(PALM_MODELS.map(m=>[m,[]]));
 // 椰子朝海側（-y）傾斜：樹的局部 +X 是傾斜／彎曲方向，yaw＝-π/2 再加 ±34° 的決定性偏移。
 const seaward=i=>-Math.PI/2+((((i*2869860233)>>>0)%1000)/1000-.5)*1.2;
 function placePalm(kind,i,pos,s,rowScale,yaw){
  const betel=kind==='betel',model=betel?(((i*1597334677)>>>0)%1000<500?'betel-a':'betel-b'):PALM_OF_KIND[kind];
  const [h0,h1]=betel?BETEL_HEIGHT:COCO_HEIGHT,tint=.9+.18*(((i*3812015801)>>>0)%1000)/1000;
  palmItems.get(model).push({pos,yaw,height:(h0+uOf(s)*(h1-h0))*rowScale,tint});
 }
 // 山上植被精修（獨立評審 2026-09-28「01 藍皮」第 2 項）：棕櫚（含彎幹）只留海岸平地/低坡，
 // 稜線改闊葉樹冠團塊——原本檳榔不分海拔種到山頂，遠看像「插滿牙籤的綠色軟糖」。物種取捨用
 // z（已經抽出來的地形高度，不是新抽樣）換算成的高度比例＋雜湊值做決定性判斷，跟上面 plant/coco
 // 判斷同一個紀律（雜湊取餘數、不呼叫新 rand()），不影響既有 rand() 序列（後排／礫石等下游
 // 取樣的抽樣次序不變）。闊葉樹零件（broadleaf-a/b-trunk+canopy）見
 // scripts/blender/coast-20260928/build_coast_flora.py。
 const PEAK=Math.max(...hills.map(h=>h[4])); // 9.2，跟地形同源用量的不手打常數。
 // 門檻由 scratchpad/garage-b/sim_exact.mjs 對正式 seed=9184 逐配置實測選定（不是猜的）：
 // [.18,.38,.01] 讓「棕櫚中 ratio>.35」≈5.8%（門檻 ≤10%）、「ridge(ratio≥.5) 已種植裡闊葉佔比」
 // ≈97.1%（門檻 ≥90%），兩條驗收判準都留足夠餘裕，不是卡在臨界值。
 const PALM_MAX_RATIO=.18,BROADLEAF_MIN_RATIO=.38,RIDGE_PALM_RESIDUAL=.01;
 function paletteAt(ratio,hashVal){
  if(ratio<PALM_MAX_RATIO)return'palm'; // 海岸平地/低坡：只長棕櫚。
  if(ratio>=BROADLEAF_MIN_RATIO)return hashVal<RIDGE_PALM_RESIDUAL?'palm':'broadleaf'; // 稜線：幾乎全闊葉，留極少量棕櫚點綴不做死板二分。
  const t=(ratio-PALM_MAX_RATIO)/(BROADLEAF_MIN_RATIO-PALM_MAX_RATIO);
  return hashVal<1-t*(1-RIDGE_PALM_RESIDUAL)?'palm':'broadleaf'; // 過渡帶：棕櫚機率線性遞減，避免硬邊界。
 }
 const broadleafTrunkMat=mat('#6b5d4a'),broadleafCanopyAMat=mat('#4a7048'),broadleafCanopyBMat=mat('#5c8a4f');
 const BL_SCALE_MIN=.85,BL_SCALE_MAX=1.4; // 闊葉樹整棵縮放範圍，重用同一個 s（見迴圈內），不額外抽樣。
 const boulders=[],broadleafATrunks=[],broadleafACanopy=[],broadleafBTrunks=[],broadleafBCanopy=[];
 for(let i=0;i<460;i++){const x=rand()*51-25.5,y=rand()*7.4+1.2,z=height(x,y);if(z<.6)continue;const s=.38+rand()*.58;
  const plant=((i*2654435761)>>>0)%1000<520; // 山坡「有沒有種東西」，跟原本一樣先決定，不因新的物種邏輯改變機率。
  const ratio=z/PEAK,speciesHash=((i*2246822519)>>>0)%1000/1000; // 高度比例＋獨立雜湊決定棕櫚／闊葉（見上方 paletteAt）。
  let kind='none';
  if(plant){
   if(paletteAt(ratio,speciesHash)==='palm'){
    if(z<1.35){ // 近山腳／海岸最低處才是「椰子系」（沿用原本 coco 的 z 門檻），其餘棕櫚範圍是檳榔。
     const vh=((i*3266489917)>>>0)%1000/1000; // 椰子系內再分直幹／彎幹 A／彎幹 B（多數彎幹，直接回應評審「同一款」的抱怨）。
     kind=vh<.25?'coco':vh<.625?'cocoCurvedA':'cocoCurvedB';
    }else kind='betel';
   }else{const lh=((i*668265263)>>>0)%1000/1000;kind=lh<.5?'broadleafA':'broadleafB';}
  }
  if(kind==='betel')placePalm(kind,i,[x,y,z],s,1,i*.71);
  else if(PALM_OF_KIND[kind])placePalm(kind,i,[x,y,z],s,1,seaward(i));
  else if(kind==='broadleafA'||kind==='broadleafB'){
   const bs=BL_SCALE_MIN+uOf(s)*(BL_SCALE_MAX-BL_SCALE_MIN),yawTrunk=i*.71; // 重用同一個 s，不額外抽樣。
   const trunks=kind==='broadleafA'?broadleafATrunks:broadleafBTrunks,canopy=kind==='broadleafA'?broadleafACanopy:broadleafBCanopy;
   trunks.push({pos:[x,y,z],rot:[0,0,yawTrunk],scale:[bs,bs,bs]});
   canopy.push({pos:[x,y,z],rot:[0,0,yawTrunk],scale:[bs,bs,bs]});
  }
  for(let j=0;j<6;j++)rand(); // 次數保留（見本段開頭）。
 }
 for(let i=0;i<110;i++){const x=rand()*55-27.5,y=12+rand()*4.4,s=.4+rand()*.5;
  const plant=((i*2654435761)>>>0)%1000<300; // 後排（車站周邊、內側平地）：椰子稀疏種，比例比山坡低很多。
  if(plant)placePalm('coco',i,[x,y,.3],s,BACK_ROW_SCALE,i*.53);
  for(let j=0;j<4;j++)rand(); // 次數保留（見本段開頭）。
 }
 for(let i=0;i<95;i++){const x=rand()*60-30,s=.15+rand()*.35;boulders.push({pos:[x,shore(x)+.4+rand()*.5,-.28],rot:[rand(),rand(),rand()],scale:[s*1.4,s,s*.8]});}
 if(palmsKit){
  const plant=(partName,material,items)=>{if(!items.length)return;const o=instances(palmsKit.parts.get(partName).geometry,material,items);o.name='palm-'+partName;};
  // 一款棕櫚＝零件庫裡 `<款>/<子零件>` 的幾個零件接成一份幾何，頂點色照 PALM_COLORS；子零件在幾何裡的
  // 範圍記在 userData.palmParts（verify 用它找樹冠、葉色、椰子果，不靠顏色反推）。
  const palmMat=mat('#ffffff',{vertexColors:true,side:THREE.DoubleSide}),tint=new THREE.Color();
  function palmGeometry(model){
   const colors=PALM_COLORS[model.split('-')[0]],subs=[...palmsKit.parts.values()].filter(p=>p.name.startsWith(model+'/'));
   if(!subs.length)throw Error('palms: 零件庫沒有 '+model);
   let n=0;for(const p of subs)n+=p.geometry.attributes.position.count;
   const pos=new Float32Array(n*3),nor=new Float32Array(n*3),col=new Float32Array(n*3),parts=[],c=new THREE.Color();let o=0;
   for(const p of subs){const sub=p.name.slice(model.length+1),pa=p.geometry.attributes.position,na=p.geometry.attributes.normal;
    if(!colors[sub])throw Error('palms: 沒有顏色 '+p.name);c.set(colors[sub]);parts.push({name:sub,start:o,count:pa.count});
    for(let k=0;k<pa.count;k++,o++){pos[o*3]=pa.getX(k);pos[o*3+1]=pa.getY(k);pos[o*3+2]=pa.getZ(k);nor[o*3]=na.getX(k);nor[o*3+1]=na.getY(k);nor[o*3+2]=na.getZ(k);col[o*3]=c.r;col[o*3+1]=c.g;col[o*3+2]=c.b;}}
   const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('normal',new THREE.BufferAttribute(nor,3));g.setAttribute('color',new THREE.BufferAttribute(col,3));
   g.userData.palmParts=parts;g.computeBoundingBox();g.computeBoundingSphere();return g;
  }
  for(const model of PALM_MODELS){const items=palmItems.get(model);if(!items.length)continue;
   const g=palmGeometry(model),H=g.boundingBox.max.z; // 模型整棵高（樹幹底 z=0），目標高度÷它＝等比縮放。
   const o=instances(g,palmMat,items.map(t=>({pos:t.pos,rot:[0,0,t.yaw],scale:[t.height/H,t.height/H,t.height/H]})));
   o.name='palm-'+model;items.forEach((t,k)=>o.setColorAt(k,tint.setScalar(t.tint)));
  }
  plant('broadleaf-a-trunk',broadleafTrunkMat,broadleafATrunks);plant('broadleaf-a-canopy',broadleafCanopyAMat,broadleafACanopy);
  plant('broadleaf-b-trunk',broadleafTrunkMat,broadleafBTrunks);plant('broadleaf-b-canopy',broadleafCanopyBMat,broadleafBCanopy);
 }
 instances(stoneGeo,rock,boulders);
 // 小站只取南迴沿線的意象，不標上真實站名。
 block(cream,[13,1.4,.5],[-3,-3.05,.20]);block(sand,[13.2,1.55,.10],[-3,-3.05,.49]);
 block(mat('#d2b675'),[13.1,.11,.035],[-3,-3.79,.565]);
 // 站房與站體設施：獨立評審 2026-09-28「01 藍皮」第 3 項第一版（純 box/cylinder 疊法）被使用者
 // 退回，原話「細節還是都需要用 blender 製作」。全部改用 Blender 建的 garage-parts-v1 零件庫
 // （rail-3d/assets/garage-coast-v1，見 scripts/blender/coast-20260928/build_coast_station.py），
 // stationKit 由呼叫端（main.js）跟 palmsKit 同一批非同步載入好才傳進來，沒有 kit 時就不畫站房，
 // 其餘場景不受影響（跟棕櫚 kit 同一個道理）。窗框／門框這次是真正挖空的洞，玻璃／門片嵌進洞裡，
 // 不再需要「哪一層比較貼近鏡頭」的 JS 深度戲法——第一版那個戲法曾經把順序寫反、窗框整片擋住玻璃，
 // 現在這個坑在幾何層級就不存在了。
 // 站名牌改成垃圾桶：使用者原話給的兩個選項之一（「不然就拿掉站牌，換成別的 Blender 站體設施」）。
 // 空白站名牌本來就是原評審點名的缺陷，沒有文字/圖標內容，牌子做得再精緻多半還是「看起來空空的」；
 // 垃圾桶不需要任何文字/圖案就能讀出「這是站體設施」。
 const PLATFORM_TOP=.54; // 跟下面 platform.top 常數同一個值（那個宣告在這裡之後，此處先各自命名）。
 if(stationKit){
  const part=(name)=>stationKit.parts.get(name).geometry;
  const place=(name,material,pos,label=name)=>{const o=instances(part(name),material,[{pos,rot:[0,0,0],scale:[1,1,1]}]);o.name='sk-'+label;return o;};
  // 09-28 第二版重排：新門(.5 寬)比舊版(.42)寬，舊的窗3/門X（-2.68/-1.90）會讓門伸出牆體右緣、
  // 雨庇底部也蓋進門框頂端——實測 verify_garage_south_coast_stop.mjs 抓到兩條真的重疊，不是
  // 判準寫太嚴。三扇窗與門整組往左重新分配，窗與窗、窗與門之間都留 .25 淨空，門距牆體左右緣
  // 都留 ≥.2 淨空（見該判準的 detail 輸出核對）；雨庇 Z 墊高到門頂上方留 ~.04 淨空。
  const WX=[-5.6,-4.4,-3.2],WY=-2.05,WZ=1.05,DOOR_X=-2.2,DOOR_Z=.52,CANOPY_Z=1.18;
  place('wall',cream,[-4,-.9,0]);
  place('roof',roof,[-4,-.9,1.8]);
  WX.forEach((x,i)=>{place('window-frame',wood,[x,WY,WZ],'window-frame'+i);place('window-glass',windows,[x,WY,WZ],'window-glass'+i);});
  place('door',wood,[DOOR_X,WY,DOOR_Z]);
  place('canopy',wood,[DOOR_X,WY,CANOPY_Z]);
  // 長椅：椅面 3 條座板＋靠背＋兩腳，腳貼平台面（PLATFORM_TOP）、座面在腳頂上方。
  [-7,1,4].forEach((x,i)=>{
   [-.44,.44].forEach((dx,j)=>place('bench-leg',wood,[x+dx,-3,PLATFORM_TOP],`bench${i}-leg${j}`));
   place('bench-seat',wood,[x,-3,PLATFORM_TOP+.35],`bench${i}-seat`);
   place('bench-back',wood,[x,-3.16,PLATFORM_TOP+.35],`bench${i}-back`);
  });
  // 路燈：柱／臂／頭／玻璃共用同一個貼地點（局部座標系見 build_coast_station.py 檔頭說明）。
  [-9,3,8].forEach((x,i)=>{
   const at=[x,-1.8,0];
   place('lamp-pole',wood,at,`lamp${i}-pole`);place('lamp-arm',wood,at,`lamp${i}-arm`);
   place('lamp-head',steel,at,`lamp${i}-head`);place('lamp-glass',lamp,at,`lamp${i}-glass`);
  });
  // 垃圾桶（取代站名牌），貼平台面。
  const binDark=mat('#2b2620');
  [-10.2,5.2].forEach((x,i)=>{place('bin-body',binDark,[x,-3.05,PLATFORM_TOP],`bin${i}-body`);place('bin-rim',steel,[x,-3.05,PLATFORM_TOP],`bin${i}-rim`);});
 }
 const lights=[];for(const x of [-9,3,8]){const l=new THREE.PointLight('#ffca84',0,5,2);l.position.set(x+.55,-1.8,2.4);group.add(l);lights.push(l);}
 // 海側的低紅欄杆留出列車視線。
 for(let x=-11;x<=7;x+=.72)block(red,[.07,.07,.6],[x,-7.2,.2]);block(red,[18.2,.07,.065],[-2,-7.2,.50]);
 // 站務員改用 garage-people-v1 零件庫拼（見檔尾 createAttendant，跟候車乘客走同一條 personPose 路徑同一個比例尺），
 // 這裡不再放方塊版——kit 要等 main.js 非同步載入完才有，createScene() 這個純函式階段拿不到。
 // 同材質的靜態方塊合批，欄杆、站房細節不各佔一次 draw call。
 const batches=new Map();for(const o of [...group.children])if(o.isMesh&&!o.isInstancedMesh&&o.geometry===box){if(!batches.has(o.material))batches.set(o.material,[]);batches.get(o.material).push({pos:o.position.toArray(),rot:[o.rotation.x,o.rotation.y,o.rotation.z],scale:o.scale.toArray()});group.remove(o);}for(const [m,items]of batches)instances(box,m,items);
 const anchors={water:[-4,-14,-.61],station:[-4,-1,1],rail:[0,-5,.18],mountain:[12,5,6],shore:[10,shore(10),-.45]};
 // 月台幾何（供停站與月台乘客用）：邊界抓在月台面（沙色頂層 x:[-9.6,3.6] y:[-3.825,-2.275] z 頂 .54）內側一點，
 // 兩張長椅取自實際擺放的長椅方塊（x=-7/1/4、y=-3、椅面頂 z=.97）；signs 只是給 idlePeople 排站位用的參考點，不對應實體招牌網格。
 const platform={edge:-3.8,outer:-2.3,top:.54,xMin:-9.5,xMax:3.5,
  benches:[{x:-7,y:-3,seat:.97},{x:1,y:-3,seat:.97},{x:4,y:-3,seat:.97}],
  signs:[{x:-6,y:-3.05},{x:-2.32,y:-3.05}],bridge:{x0:-3.05,x1:-2.95},obstacles:[],hutFront:-2.3};
 // terrain 給驗證用（山坡植被的高度比例判準）：height 跟撒點迴圈是同一個函式（不是重算的近似值），
 // peak 是同一個 PEAK 常數，hills 原始陣列一併附上供除錯；純資料，update()/dispose() 不會動它。
 const terrain={height,hills,peak:PEAK};
 return {group,path,anchors,platform,terrain,label:'南迴海岸',camera:{yaw:-1.15,elevation:.65,radius:48},themes:THEMES,
 update(time,period='day'){const t=THEMES[period]||THEMES.day;waterMat.color.set(t.water);if(waterMat.userData.shader){waterMat.userData.shader.uniforms.coastTime.value=time;waterMat.userData.shader.uniforms.shallow.value.set(t.shallow);}windows.emissiveIntensity=period==='night'?1.2:period==='sunset'?.35:0;lamp.emissiveIntensity=period==='night'?2:.08;lights.forEach(l=>l.intensity=period==='night'?5:0);return t;},
 dispose(){group.clear();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}
 };
}
// 站務員：跟候車乘客共用 kit 零件與 personPose（站姿、不走路、無隨身物），但不進 createPeople 的 InstancedMesh
// 合批系統（那個材質全場統一用 instanceColor 上色，換不了單獨一尊的顏色而不改共用模組）——改成自己組獨立
// Mesh，材質自己指定（外套/長褲/帽子深藍、頭/手膚色、鞋/髮深色），比例尺與姿勢仍是共用函式算出來的，
// 保證跟乘客「同一條路徑、同一個比例尺」。回傳的 group 靜態、不隨 update() 變動。
export function createAttendant(kit,scale,platform,pos={x:-.5,y:-3.4,heading:Math.PI/2}){
 const navy=new THREE.MeshStandardMaterial({color:'#16324f',roughness:.82}),
       skin=new THREE.MeshStandardMaterial({color:'#e0b088',roughness:.82}),
       dark=new THREE.MeshStandardMaterial({color:'#2b2620',roughness:.82});
 const matFor=name=>name==='head'||name==='hand'?skin:name.startsWith('hair')||name==='shoe'?dark:navy; // torso-jacket／leg／acc-hat 都算制服→深藍
 const v={look:{hair:'short',torso:'jacket',accessory:'hat',scale:1},pose:'stand',walking:false,hand:0};
 const s=scale*v.look.scale;
 const root=new THREE.Matrix4().makeTranslation(pos.x,pos.y,platform.top).multiply(new THREE.Matrix4().makeRotationZ(pos.heading)).multiply(new THREE.Matrix4().makeScale(s,s,s));
 const group=new THREE.Group();group.name='south-coast-attendant';
 const world=new THREE.Matrix4();
 for(const p of personPose(v,kit)){
  const part=kit.parts.get(p.name),mesh=new THREE.Mesh(part.geometry,matFor(p.name));
  world.multiplyMatrices(root,p.matrix);world.decompose(mesh.position,mesh.quaternion,mesh.scale);
  group.add(mesh);
 }
 return group;
}
