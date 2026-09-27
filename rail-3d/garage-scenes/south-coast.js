// 南迴海岸的微縮印象；不是特定車站或實際線形的重建。沿線物件由固定 seed 生成。
import * as THREE from '../vendor/three.module.js';
import {personPose} from '../garage-people.js?revision=people-0927';
export const THEMES = {
 day:{background:'#eae7dd',sun:'#fff1cf',ambient:'#c1dce7',ground:'#7b8663',power:3.2,exposure:1.05,water:'#307c8c',shallow:'#71b3ae'},
 sunset:{background:'#e9d6c3',sun:'#ffbc77',ambient:'#d5b7b2',ground:'#6c7161',power:3.1,exposure:.95,water:'#547f89',shallow:'#9db5a4'},
 night:{background:'#172c38',sun:'#a4c8eb',ambient:'#69839d',ground:'#2d3b40',power:.7,exposure:.78,water:'#193e55',shallow:'#3b6975'}
};
export function createScene(palmsKit=null){
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
 const grass=mat('#809475'),rock=mat('#879081'),sand=mat('#c1bb9f'),gravel=mat('#a69c84'),wood=mat('#5b4c3a'),steel=mat('#8a9291',{metalness:.65,roughness:.35}),cream=mat('#e9dfc3'),roof=mat('#557f7b'),red=mat('#a45c46'),trunk=mat('#71664e');
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
 // 檳榔（細直高幹＋綠色葉鞘）與椰子（略彎粗幹＋大片下垂葉＋懸掛的果）：沿用原本闊葉樹兩個迴圈抽 rand() 的
 // 次數與順序完全不變（每棵樹抽幾次、抽到的值判斷是否要種樹，逐行比對過），只把抽到的值拿去算棕櫚的尺寸與
 // 位置；種不種、種哪個物種改成看已抽出的 i/x/y/z/s 做決定性判斷（雜湊取餘數／地形高度，不呼叫新的
 // rand()），其餘道具（欄杆、石頭等）的亂數序列因此不受影響。
 const crownMat=mat('#4f7a4a'),betelFrondMat=mat('#5a7a3f'),cocoFrondMat=mat('#3f6a5a'),fruitMat=mat('#5b4530');
 // 整棵高度／樹冠直徑（使用者裁示：檳榔 2.2~2.8、椰子 1.8~2.6，縮景比例不是真實比例，樹冠直徑＝高度×
 // 檳榔.35~.55／椰子.5~.9）：兩者都用同一個 s（原本就用來決定樹幹粗細的隨機值）內插，樹越高冠越寬是同一個
 // 尺寸因子帶出來的，不是獨立抽樣。u 是 s 正規化到 0~1（loop1 的 s∈[.38,.96]；loop2 的 s∈[.4,.9] 是子集，
 // 不需要另外 clamp）。
 const uOf=s=>(s-.38)/.58;
 // trunkH 上限縮到 2.30（原 2.4）：改成四元數正確合成 droop+yaw 後，扇葉的「上揚」對每棵樹都是全量套用
 // （不再被舊版錯誤矩陣的 cos(yaw) 削弱），topZ 頂加扇葉揚起量必須留夠餘裕給 2.8 上限，見下面 BETEL_DROOP。
 const betelSize=s=>{const u=uOf(s),trunkH=1.95+u*.31,trunkR=.045+u*.03,crownH=trunkH*.13,crownR=trunkR*1.18,topZ=trunkH+crownH;return{trunkH,trunkR,crownH,crownR,topZ,diam:topZ*(.35+u*.20)};};
 // trunkH 上限縮到 2.52（原 2.55）：留一點餘裕給 hub 附近葉片摺痕本身殘留的小凸起（見量測筆記），
 // 不然量到的整棵高度會貼著 2.6 上限只差 0.001，任何微調都可能反紅。
 const cocoSize=s=>{const u=uOf(s),trunkH=1.85+u*.67,trunkR=.10+u*.05;return{trunkH,trunkR,topZ:trunkH,diam:trunkH*(.5+u*.4)};};
 // 後排（車站周邊平地，loop2）退回重做：使用者截圖抓到最遠那排椰子只縮樹冠（原本 spread 乘 .5）、
 // 樹幹留全高，全景看起來是「光禿的火柴棒」（量到的最小樹冠直徑僅 0.328）。改成整棵（樹幹高／粗、
 // topZ、設計 diam 四個量）用同一個係數 BACK_ROW_SCALE 等比例縮小成幼樹——uniform scaling 不改變
 // diam/topZ 的比例，所以樹冠÷樹高比例自動跟前排一樣，不必另外調。BACK_ROW_SCALE=.45 是量過
 // verify_garage_follow_camera（跟車鏡頭遮擋比門檻 ≥0.9）與 verify_garage_south_coast_stop 的
 // 「南迴-棕櫚」樹冠比例／後排高度檢查後定案的值，改這個值兩支 verify 都要重跑。
 const BACK_ROW_SCALE=.45;
 const cocoSizeMini=(s,k)=>{const f=cocoSize(s);return{trunkH:f.trunkH*k,trunkR:f.trunkR*k,topZ:f.topZ*k,diam:f.diam*k};};
 // BETEL 的「上揚」主要靠扇葉幾何本身的摺痕弧度（見 build_palms.py 的 BETEL_FROND_RINGS 中環 centerZ=.06）
 // 帶出來；droop 範圍刻意做成不對稱（負向上限壓低、正向下限放寬）：負向（上揚）決定整棵樹的最高點，
 // 必須壓在很小的角度才不會衝出 2.8 上限，正向（下垂）不影響最高點（低於 hub 的點不會拉高 crownTop），
 // 可以放大來讓 9 片扇葉的俯仰角分散、撐出樹冠應有的垂直厚度（否則全部扇葉幾乎同高，樹冠讀起來像一片扁盤）。
 const BETEL_FRONDS=9,COCO_FRONDS=13,BETEL_DROOP=.10,BETEL_DROOP_AMP=.29,COCO_DROOP=.68,COCO_DROOP_AMP=.25;
 // 樹冠扇葉長度倍率（spread=設計 diam/2 × 這個倍率）：原本 betel 1.15／coco 1.40 在最細的樹（u≈0）
 // 量到的「實際樹冠直徑÷整棵高」只有 .334／.476，比新判準門檻 .35／.5 還低一點點（不是本輪要修的
 // 後排火柴棒，是量測後才發現前排最細的樹也貼著門檻），故小幅調大到量測後全數過門檻、且不頂到高度
 // 上限的值——調整前排同時也讓後排幼樹（用同一個倍率，見 BACK_ROW_SCALE）的比例維持跟前排一致。
 const BETEL_SPREAD_MULT=1.30,COCO_SPREAD_MULT=1.55;
 const betelTrunks=[],betelCrowns=[],betelFronds=[],cocoTrunks=[],cocoFronds=[],cocoFruit=[],boulders=[];
 // 一棵樹的樹冠扇葉：count 片羽狀葉繞 hub 均勻分布（baseYaw 用 i*2.399963 錯開每棵樹的起始角，跟舊版同一招）；
 // droop 依 j 用 sin(j*2.399963) 做決定性變化（非 rand()）——不讓全部扇葉共用同一個俯仰角，樹冠才不會讀起來
 // 像完美對稱的風車（舊版的抱怨之一），也讓樹冠有足夠的垂直厚度。jitters 只有前 2～3 片有（loop1/loop2 抽到的
 // jx/jy 組數不同，見下方呼叫端），其餘沿用 droopBase+變化量本身、長度用固定的 .9 倍。
 const Y_AXIS=new THREE.Vector3(0,1,0),Z_AXIS=new THREE.Vector3(0,0,1),_qd=new THREE.Quaternion(),_qy=new THREE.Quaternion(),_qc=new THREE.Quaternion(),_eu=new THREE.Euler();
 // 扇葉旋轉必須「droop 先套、yaw 後套」（沿葉片自己局部 +X 先垂下，再把整片轉到徑向角度）。直接用預設
 // Euler('XYZ') 寫 rotation.set(0,droop,yaw) 得到的矩陣是 Ry(droop)·Rz(yaw)＝yaw 先套、droop 後繞
 // 「固定」Y 軸套——yaw≈180° 的葉子會被同一個 droop 往上翹而不是往下垂（實測葉尖 tip.z 從應垂的 -0.9
 // 翹成 +0.63，是棕櫚整棵高度大幅超出使用者裁示範圍的根因，逐頂點量測＋人工三角函數重算兩次交叉確認）。
 // 改用四元數 Rz(yaw)·Ry(droop) 合成再換算回 Euler 三元組，套進同一個 instances() 泛用管線，管線本身不動。
 function frondRot(droop,yaw){
  _qd.setFromAxisAngle(Y_AXIS,droop);_qy.setFromAxisAngle(Z_AXIS,yaw);_qc.multiplyQuaternions(_qy,_qd);
  _eu.setFromQuaternion(_qc,'XYZ');return [_eu.x,_eu.y,_eu.z];
 }
 function pushFronds(list,hub,count,droopBase,droopAmp,spread,i,jitters){
  for(let j=0;j<count;j++){const yaw=i*2.399963+j*(Math.PI*2/count),droop=droopBase+droopAmp*Math.sin(j*2.399963);
   const jit=jitters[j],jx=jit?jit[0]:0,jy=jit?jit[1]:0,len=spread*(jit?.85+Math.abs(jx)*.3:.9);
   list.push({pos:hub,rot:frondRot(droop+jy*.2,yaw+(jit?jx*.3:0)),scale:[len,len,len]});}
 }
 for(let i=0;i<460;i++){const x=rand()*51-25.5,y=rand()*7.4+1.2,z=height(x,y);if(z<.6)continue;const s=.38+rand()*.58;
  const plant=((i*2654435761)>>>0)%1000<520,coco=plant&&z<1.35; // 山坡以檳榔為主、近山腳（z 較低）才偶爾種椰子。
  let count=0,droopBase=0,droopAmp=0,spread=0,hub=[0,0,0];
  if(plant){
   if(coco){const sz=cocoSize(s);hub=[x,y,z+sz.topZ];
    cocoTrunks.push({pos:[x,y,z],rot:[(s-.5)*.5,0,i*.71],scale:[sz.trunkR,sz.trunkR,sz.trunkH]});
    count=COCO_FRONDS;droopBase=COCO_DROOP;droopAmp=COCO_DROOP_AMP;spread=(sz.diam/2)*COCO_SPREAD_MULT; // 前排：跟車鏡頭遮擋量測顯示這一圈扇葉幾乎不影響能見度，維持較大尺寸。
    // fr（果實離主幹的水平半徑）用 spread（實際扇葉長度基準）算、不是 sz.diam/2（設計目標值）：
    // 這一排的扇葉刻意放大 1.40 倍，用未放大的 sz.diam/2 算 fr 會讓果實看起來飄在縮小版樹冠外面。
    const fruitZ=z+sz.topZ*.92,fr=spread*.15;
    for(let k=0;k<8;k++){const a=k*2.399963+i;cocoFruit.push({pos:[x+fr*Math.cos(a),y+fr*Math.sin(a),fruitZ-k*.004],rot:[0,0,0],scale:[.09,.09,.09]});}
   }else{const sz=betelSize(s);hub=[x,y,z+sz.topZ];
    betelTrunks.push({pos:[x,y,z],rot:[(s-.5)*.05,0,i*.71],scale:[sz.trunkR,sz.trunkR,sz.trunkH]});
    betelCrowns.push({pos:[x,y,z+sz.trunkH-sz.crownH*.3],rot:[(s-.5)*.05,0,i*.71],scale:[sz.crownR,sz.crownR,sz.crownH]});
    count=BETEL_FRONDS;droopBase=BETEL_DROOP;droopAmp=BETEL_DROOP_AMP;spread=(sz.diam/2)*BETEL_SPREAD_MULT;
   }
  }
  const jitters=[];for(let j=0;j<3;j++){jitters.push([(rand()-.5)*s,(rand()-.5)*s]);}
  if(plant)pushFronds(coco?cocoFronds:betelFronds,hub,count,droopBase,droopAmp,spread,i,jitters);
 }
 for(let i=0;i<110;i++){const x=rand()*55-27.5,y=12+rand()*4.4,s=.4+rand()*.5;
  const plant=((i*2654435761)>>>0)%1000<300; // 後排（車站周邊、內側平地）：椰子稀疏種，比例比山坡低很多。
  let count=0,droopBase=0,droopAmp=0,spread=0,hub=[0,0,0];
  if(plant){const sz=cocoSizeMini(s,BACK_ROW_SCALE);hub=[x,y,.3+sz.topZ]; // 整棵縮小成幼樹，見 BACK_ROW_SCALE 註解。
   cocoTrunks.push({pos:[x,y,.3],rot:[(s-.5)*.4,0,i*.53],scale:[sz.trunkR,sz.trunkR,sz.trunkH]});
   // spread 倍率沿用跟前排同一個 1.40（不是舊版單獨砍半的 .5）：樹幹已經整棵縮小，這裡若再用更小的
   // 倍率，樹冠÷樹高比例會比前排還瘦，違背「像幼樹、比例跟前排一樣」的要求。
   count=COCO_FRONDS;droopBase=COCO_DROOP;droopAmp=COCO_DROOP_AMP;spread=(sz.diam/2)*COCO_SPREAD_MULT;
   // 同前排：fr 用 spread 算（實際扇葉長度），不是未縮放的 sz.diam/2，否則果實會飄到樹冠外面。
   const fruitZ=.3+sz.topZ*.92,fr=spread*.15,fs=.08*BACK_ROW_SCALE;
   for(let k=0;k<6;k++){const a=k*2.399963+i;cocoFruit.push({pos:[x+fr*Math.cos(a),y+fr*Math.sin(a),fruitZ-k*.004],rot:[0,0,0],scale:[fs,fs,fs]});}
  }
  const jitters=[];for(let j=0;j<2;j++){jitters.push([(rand()-.5)*s,(rand()-.5)*s]);}
  if(plant)pushFronds(cocoFronds,hub,count,droopBase,droopAmp,spread,i,jitters);
 }
 for(let i=0;i<95;i++){const x=rand()*60-30,s=.15+rand()*.35;boulders.push({pos:[x,shore(x)+.4+rand()*.5,-.28],rot:[rand(),rand(),rand()],scale:[s*1.4,s,s*.8]});}
 if(palmsKit){
  const plant=(partName,material,items)=>{if(!items.length)return;const o=instances(palmsKit.parts.get(partName).geometry,material,items);o.name='palm-'+partName;};
  plant('betel-trunk',trunk,betelTrunks);plant('betel-crownshaft',crownMat,betelCrowns);plant('betel-fronds',betelFrondMat,betelFronds);
  plant('coco-trunk',trunk,cocoTrunks);plant('coco-fronds',cocoFrondMat,cocoFronds);plant('coco-fruit',fruitMat,cocoFruit);
 }
 instances(stoneGeo,rock,boulders);
 // 小站只取南迴沿線的意象，不標上真實站名。
 block(cream,[13,1.4,.5],[-3,-3.05,.20]);block(sand,[13.2,1.55,.10],[-3,-3.05,.49]);
 block(mat('#d2b675'),[13.1,.11,.035],[-3,-3.79,.565]);
 block(cream,[4.6,2.3,1.8],[-4,-.9,.9]);
 const roofShape=new THREE.Shape();roofShape.moveTo(-1.5,0);roofShape.lineTo(0,.75);roofShape.lineTo(1.5,0);roofShape.closePath();const rg=geo(new THREE.ExtrudeGeometry(roofShape,{depth:5.2,bevelEnabled:false}));rg.rotateX(Math.PI/2);rg.rotateZ(Math.PI/2);mesh(rg,roof,[-6.6,-.9,1.9]);
 for(const x of [-5.5,-4,-2.5])block(windows,[.85,.04,.76],[x,-2.071,1.05]);
 for(const x of [0,3]){block(wood,[.1,.1,2.1],[x,-2.6,1.05]);block(wood,[.1,.1,2.1],[x,-1.4,1.05]);}block(roof,[4.3,2,.16],[1.4,-2,2.12]);
 for(const x of [-7,1,4]){block(wood,[1.25,.36,.12],[x,-3,.91]);for(const dx of [-.44,.44])block(wood,[.09,.24,.37],[x+dx,-3,.7]);}
 for(const x of [-10.2,5.2]){block(wood,[.10,.1,2.35],[x,-3.05,1.55]);block(cream,[1.3,.12,.64],[x,-3.05,2.1]);block(roof,[1.3,.14,.13],[x,-3.05,1.88]);}
 const lights=[];for(const x of [-9,3,8]){block(wood,[.11,.11,2.8],[x,-1.8,1.4]);block(wood,[.7,.1,.08],[x+.3,-1.8,2.75]);block(lamp,[.35,.27,.12],[x+.55,-1.8,2.68]);const l=new THREE.PointLight('#ffca84',0,5,2);l.position.set(x+.55,-1.8,2.4);group.add(l);lights.push(l);}
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
 return {group,path,anchors,platform,label:'南迴海岸',camera:{yaw:-1.15,elevation:.65,radius:48},themes:THEMES,
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
