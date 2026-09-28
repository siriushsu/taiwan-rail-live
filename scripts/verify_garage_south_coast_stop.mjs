// 南迴海岸輕量精緻化（停站／候車的人／站務員／棕櫚）驗收。用法：node scripts/verify_garage_south_coast_stop.mjs
// 伺服器：python3 -m http.server 5251（worktree 根目錄）。瀏覽器一律無視窗：channel:'chrome'+headless:true。
// 只用 chromium（不比照既有 south_coast/follow_camera/train_lights 三支再測 webkit）：
// 這幾條判準是「時刻表接線／相機切換／人數與座標」這類整合邏輯，不是逐引擎才會分歧的算繪細節，
// 既有三支既有 baseline 已經涵蓋跨引擎算繪，這裡刻意輕量、只測 chromium。
import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import * as THREE from '../rail-3d/vendor/three.module.js';
import {createScene} from '../rail-3d/garage-scenes/south-coast.js';
import {buildGarageParts} from '../rail-3d/garage-parts.js';
// 頁面網址不命名為 URL：那會蓋掉 Node 的全域 URL 類別（檔尾要用 new URL() 讀原始碼）。
const PAGE_URL='http://127.0.0.1:5251/prototypes/garage-south-coast/';
const results=[];function check(name,pass,detail){results.push({name,pass:!!pass});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail??'').slice(0,300));}

// ── 純 Node（不需要瀏覽器）：棕櫚（位置／物種雜湊、高度、樹冠比例與形狀、葉色、椰子果、預算）、闊葉樹不變、
// 站房與站體設施，直接讀 createScene() 的 instanced mesh。棕櫚用 Blender 零件庫（見 scripts/blender/palms-20260928/），
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

const scene=createScene(palmsKit,stationKit);
const meshByName=new Map();scene.group.traverse(o=>{if(o.isInstancedMesh&&o.name)meshByName.set(o.name,o);});
function decomposeAt(mesh,idx){const m=new THREE.Matrix4();mesh.getMatrixAt(idx,m);const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();m.decompose(p,q,s);return{m,p,q,s};}
function minMax(list,key){if(!list.length)return[null,null];let lo=Infinity,hi=-Infinity;for(const it of list){const v=key?it[key]:it;if(v<lo)lo=v;if(v>hi)hi=v;}return[+lo.toFixed(4),+hi.toFixed(4)];}
const sha=(parts)=>{const h=createHash('sha256');for(const x of parts)h.update(x);return h.digest('hex');};
const matBytes=o=>Buffer.from(o.instanceMatrix.array.buffer,o.instanceMatrix.array.byteOffset,o.count*16*4);

// ── 南迴-棕櫚（第三版，09-28）。使用者原話：「那個樹看起來像是個笑話 這什麼東西？」「細節還是都需要用blender製作」
// 「只有藍皮的樹 感覺還是不太對」「棕梠樹的比例跟樣貌太奇怪 其他的樹不用動」。
// 棕櫚改成整棵在 Blender 建好（scripts/blender/palms-20260928/build_palms.py，椰子 3 款＋檳榔 2 款），
// south-coast.js 一款樹＝一個 InstancedMesh（palm-<款>），幾何的子零件範圍在 geometry.userData.palmParts。
// 下面的判準全部讀 createScene() 真正畫出來的 instanced mesh（世界座標）或它的幾何本身，不重算 south-coast.js 的公式。
// 判準依據：「主對話派工」＝主對話 09-28 派工單訂的數字；「HEAD」＝c3050359 乾淨樹實測、寫死成字面值。──
const PALM_SPECIES={'coco-straight':'coco','coco-curved-a':'cocoCurvedA','coco-curved-b':'cocoCurvedB','betel-a':'betel','betel-b':'betel'};
const PALM_MODELS=Object.keys(PALM_SPECIES),isCoco=m=>m.startsWith('coco');
const palmMesh=Object.fromEntries(PALM_MODELS.map(k=>[k,meshByName.get('palm-'+k)]));
const BL_NAMES=['palm-broadleaf-a-trunk','palm-broadleaf-a-canopy','palm-broadleaf-b-trunk','palm-broadleaf-b-canopy'];
const blMesh=Object.fromEntries(BL_NAMES.map(n=>[n,meshByName.get(n)]));
const terrain=scene.terrain;
// 前／後排用樹幹底 y 分辨：loop1（山坡）y∈[1.2,8.6]，loop2（車站周邊平地）y∈[12,16.4]，10 是安全分界。
const BACK_ROW_Y=10;

// (1) 闊葉樹一棵都沒動（使用者：「其他的樹不用動」）：4 個闊葉 InstancedMesh 的「名稱|數量|instanceMatrix bytes」
//     雜湊＝HEAD 字面值。
const broadleafHash=BL_NAMES.every(n=>blMesh[n])?sha(BL_NAMES.flatMap(n=>[`${n}|${blMesh[n].count}|`,matBytes(blMesh[n])])):'missing';
check('南迴-闊葉樹 unchanged 4 個闊葉 InstancedMesh 的 instanceMatrix 雜湊＝HEAD（c3050359）字面值（依據：使用者「其他的樹不用動」）',
 broadleafHash==='70120545a3265f7140aaa7205323ecf83174e884bb8ca691b896f79ae50e18f3',{broadleafHash,counts:BL_NAMES.map(n=>blMesh[n]?.count)});

// (2) 棕櫚位置與物種（09-28 挪位後改寫）。48dfc156 的 90 棵裡，樹冠一半以上埋在闊葉樹冠裡的 20 棵山坡棕櫚挪了位
//     （south-coast.js 的 PALM_NUDGE。使用者原話 16:0x「棕梠樹的比例跟樣貌太奇怪 其他的樹不用動」；主對話 18:2x 問遮擋怎麼處理，
//     使用者 18:32 回「A」，主對話解讀為「移開」），其餘 70 棵不動。原本「整批位置＋物種雜湊＝HEAD」拆成四條（主對話派工）：
//     沒被挪的鎖 48dfc156 字面值、被挪的棵數、物種清單不變、每棵位移上限。物種＝款名對應回 HEAD 的物種（檳榔兩款都是 betel）。
//     被挪的樹用「物種＋yaw」認：yaw 由迴圈序號決定，跟位置、款式、高度都無關（改檳榔 a/b 分法、改高度的突變不會讓這裡認錯樹）；
//     同物種兩棵 yaw 最小差 4.8e-3 rad，容差 1e-3。MOVED＝那 20 棵在 48dfc156 的 [物種, yaw, 樹幹底 x, y]（instance 矩陣實測）。
const MOVED=[['coco',-1.068,16.5349,7.2561],['betel',-1.7027,15.6637,2.5675],['cocoCurvedB',-1.2408,6.5505,7.3979],['betel',-1.665,-22.0629,4.1864],['betel',2.595,.5409,2.5707],['betel',-2.7646,-21.4322,3.0076],['cocoCurvedB',-.9888,-13.308,8.3964],['betel',3.129,-20.5978,2.7708],['betel',-2.4442,21.0831,6.9988],['betel',-2.1928,10.188,8.4791],
 ['betel',.044,-10.7385,8.0525],['betel',-1.2692,-2.9344,6.6385],['coco',-1.92,-10.247,8.3887],['cocoCurvedA',-1.5348,-4.0349,7.6323],['betel',-1.2315,-4.0889,3.5577],['betel',2.5321,-21.7976,5.7191],['betel',1.5394,-7.8197,8.5074],['betel',-1.8661,-.1223,2.8294],['coco',-1.6812,-9.6822,8.5793],['betel',1.1875,15.2434,2.7471]];
const trees=[];
for(const model of PALM_MODELS){const o=palmMesh[model];if(!o)continue;
 for(let i=0;i<o.count;i++){const {m,p,s}=decomposeAt(o,i);trees.push({model,i,m,x:p.x,y:p.y,z:p.z,scale:s.x,scaleXYZ:[s.x,s.y,s.z]});}}
const yawOf=m=>Math.atan2(m.elements[1],m.elements[0]),yawGap=(a,b)=>{const d=Math.abs(a-b)%(2*Math.PI);return Math.min(d,2*Math.PI-d);};
const rowOf=t=>[PALM_SPECIES[t.model],t.x.toFixed(5),t.y.toFixed(5),t.z.toFixed(5)].join(',');
const movedHits=MOVED.map(([sp,yaw,x0,y0])=>{const hits=trees.filter(t=>PALM_SPECIES[t.model]===sp&&yawGap(yawOf(t.m),yaw)<1e-3);return {sp,hits,t:hits[0],d:hits.length===1?Math.hypot(hits[0].x-x0,hits[0].y-y0):NaN};});
const movedTrees=new Set(movedHits.flatMap(r=>r.hits));
const unmovedHash=sha([trees.filter(t=>!movedTrees.has(t)).map(rowOf).sort().join('\n')]);
check('南迴-棕櫚 unmoved 沒被挪的 70 棵棕櫚（山坡 37＋後排 33）物種＋樹幹底座標雜湊＝48dfc156 字面值（依據：主對話派工「沒被挪的所有棕櫚…要跟 48dfc156 逐筆相同」）',
 unmovedHash==='dec291a2f4bef7004b6036d77aab489bccf8825ca04006e4dc70bd68cc42c244',{unmovedHash,n:trees.length-movedTrees.size});
const movedOut=movedHits.filter(r=>r.hits.length===1&&r.d>1e-3);
check('南迴-棕櫚 moved count 被挪的棕櫚 20 棵：MOVED 每一筆恰好認到一棵，而且離開了 48dfc156 的原位',
 movedHits.length===20&&movedOut.length===20,{moved:movedOut.length,unmatched:movedHits.filter(r=>r.hits.length!==1).length});
const speciesCount={};for(const t of trees)speciesCount[PALM_SPECIES[t.model]]=(speciesCount[PALM_SPECIES[t.model]]??0)+1;
check('南迴-棕櫚 species list 物種清單不變：檳榔 36／直幹椰子 39（含後排）／彎幹 A 7／彎幹 B 8（48dfc156 實測）',
 Object.keys(speciesCount).length===4&&speciesCount.betel===36&&speciesCount.coco===39&&speciesCount.cocoCurvedA===7&&speciesCount.cocoCurvedB===8,speciesCount);
// 位移上限 9 單位（20.3 m）：實測最大 8.79（左端山腳的檳榔，分帶最窄處）；這條擋「挪到場景另一頭」這類錯，不是設計目標。
// 分帶與範圍是擺放端守的規則（主對話派工）：椰子系 z<1.35、檳榔 z≥1.35、山坡抽樣範圍 x∈[-25.5,25.5)、y∈[1.2,8.6)、z≥.6。
const movedOne=movedHits.filter(r=>r.hits.length===1),moveD=movedOne.map(r=>r.d);
const ruleBad=movedOne.filter(({sp,t,d})=>!(d<=9&&(sp==='betel'?t.z>=1.35:t.z<1.35)&&t.x>=-25.5&&t.x<25.5&&t.y>=1.2&&t.y<8.6&&t.z>=.6));
check('南迴-棕櫚 displacement 每棵被挪的位移 ≤9 單位，新位置仍守分帶（椰子系 z<1.35、檳榔 z≥1.35）與山坡抽樣範圍',
 movedOne.length>0&&ruleBad.length===0,{maxD:+Math.max(...moveD).toFixed(3),meanD:+(moveD.reduce((a,b)=>a+b,0)/moveD.length).toFixed(3),ruleBad:ruleBad.map(({sp,t})=>[sp,+t.x.toFixed(2),+t.y.toFixed(2),+t.z.toFixed(3)])});

// (2e) 沒有山坡棕櫚 ≥50% 被闊葉樹冠蓋住（主對話派工：≥50% 被蓋的山坡棕櫚要變 0）。擺放端找新位置用的是闊葉樹冠的橢球近似，
//      這裡刻意換一個來源：闊葉樹冠的實際網格。網格是幾顆互相重疊的封閉 20 面體，重疊處射線奇偶會抵銷，所以先依共用頂點拆成殼、
//      每條邊恰好屬於兩個三角形才算封閉（有殼不封閉就紅：奇偶判定在不封閉的殼上沒有意義），逐殼做射線奇偶，任一殼內＝在樹冠內。
//      取樣點：fronds／young 每個三角形的第一個頂點（世界座標）。
function canopyShells(g){const pa=g.attributes.position,key=k=>[pa.getX(k),pa.getY(k),pa.getZ(k)].map(v=>Math.round(v*1e5)).join(',');
 const par=new Map(),find=a=>{while(par.get(a)!==a)a=par.get(a);return a;};
 for(let k=0;k<pa.count;k++)par.set(key(k),key(k));
 for(let k=0;k<pa.count;k+=3){const a=find(key(k));par.set(find(key(k+1)),a);par.set(find(key(k+2)),a);}
 const shells=new Map();
 for(let k=0;k<pa.count;k+=3){const r=find(key(k));if(!shells.has(r))shells.set(r,{tris:[],edges:new Map()});const s=shells.get(r);
  s.tris.push([0,1,2].map(j=>new THREE.Vector3(pa.getX(k+j),pa.getY(k+j),pa.getZ(k+j))));
  for(const [a,b] of [[0,1],[1,2],[2,0]]){const e=[key(k+a),key(k+b)].sort().join('|');s.edges.set(e,(s.edges.get(e)??0)+1);}}
 return [...shells.values()].map(s=>({tris:s.tris,closed:[...s.edges.values()].every(c=>c===2)}));}
const ray=new THREE.Ray(new THREE.Vector3(),new THREE.Vector3(.31,.17,1).normalize()),rayHit=new THREE.Vector3(); // 斜一點，不會剛好擦過 20 面體的邊與頂點。
const inShell=(p,s)=>{ray.origin.copy(p);let n=0;for(const [a,b,c] of s.tris)if(ray.intersectTriangle(a,b,c,false,rayHit))n++;return n%2===1;};
const canopies=[];let shellCount=0,shellsClosed=true;
for(const n of ['palm-broadleaf-a-canopy','palm-broadleaf-b-canopy']){const o=blMesh[n];if(!o)continue;const shells=canopyShells(o.geometry);shellCount+=shells.length;shellsClosed&&=shells.every(s=>s.closed);
 if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();
 for(let i=0;i<o.count;i++){const {m}=decomposeAt(o,i);canopies.push({inv:m.clone().invert(),box:o.geometry.boundingBox.clone().applyMatrix4(m),shells});}}
const localPt=new THREE.Vector3(),inCanopy=w=>canopies.some(c=>c.box.containsPoint(w)&&c.shells.some(s=>inShell(localPt.copy(w).applyMatrix4(c.inv),s)));
const buriedOf=t=>{const g=palmMesh[t.model].geometry,pa=g.attributes.position,w=new THREE.Vector3();let n=0,hit=0;
 for(const p of g.userData.palmParts.filter(p=>p.name==='fronds'||p.name==='young'))for(let k=p.start;k<p.start+p.count;k+=3){w.fromBufferAttribute(pa,k).applyMatrix4(t.m);n++;if(inCanopy(w))hit++;}return hit/n;};
const hillBuried=trees.filter(t=>t.y<BACK_ROW_Y).map(t=>({t,f:buriedOf(t)})),worstBuried=hillBuried.reduce((a,b)=>b.f>a.f?b:a,{f:-1});
check('南迴-棕櫚 not buried 山坡棕櫚沒有一棵的樹冠取樣點 ≥50% 落在闊葉樹冠的實際網格內（逐殼射線奇偶，每一殼都封閉）',
 shellsClosed&&canopies.length>0&&hillBuried.length>0&&hillBuried.every(r=>r.f<.5),
 {max:+worstBuried.f.toFixed(3),at:worstBuried.t&&[worstBuried.t.model,+worstBuried.t.x.toFixed(2),+worstBuried.t.y.toFixed(2)],n50:hillBuried.filter(r=>r.f>=.5).length,n25:hillBuried.filter(r=>r.f>=.25).length,hill:hillBuried.length,shells:shellCount,shellsClosed});

// (3) 植被迴圈吃 rand() 的次數不變：迴圈之後第一個吃 rand() 的是礫石（95 顆，rock 材質 #879081），它的 instanceMatrix
//     雜湊＝HEAD 字面值。只看礫石、不看全場：站房等之後的改動不該讓這條紅。
const boulderMeshes=[];scene.group.traverse(o=>{if(o.isInstancedMesh&&o.material.color?.getHexString()==='879081'&&o.geometry.type==='IcosahedronGeometry')boulderMeshes.push(o);});
const boulderHash=boulderMeshes.length===1?sha([matBytes(boulderMeshes[0])]):'missing';
check('南迴-植被 rand-sequence 礫石（植被迴圈之後第一個用 rand() 的物件）instanceMatrix 雜湊＝HEAD 字面值（依據：主對話派工「rand() 呼叫次數與順序不變」）',
 boulderHash==='f1d4394ad138237f24dc4a37aff9867d7f2d798d6bf30909643c8fc6718bae81',{boulderHash,count:boulderMeshes[0]?.count});

// (4) 款數與棵數：5 款棕櫚各自的棵數（字面值，實測）、闊葉 A/B 棵數、舊闊葉樹（3 色 crown）殘留 0、全部植被 150～260。
//     物種總數（檳榔 36／直幹椰子 39 含後排／彎幹 A 7／彎幹 B 8）已由上面 base+species 雜湊鎖住；這裡鎖的是
//     「檳榔在兩款之間怎麼分」這種雜湊看不到的部分。
const EXPECT_COUNTS={'coco-straight':39,'coco-curved-a':7,'coco-curved-b':8,'betel-a':13,'betel-b':23};
const counts=Object.fromEntries(PALM_MODELS.map(m=>[m,palmMesh[m]?.count??0]));
const oldBroadleaf=(()=>{let n=0;scene.group.traverse(o=>{if(o.isInstancedMesh&&['4e7158','668363','8c9c70'].includes(o.material.color?.getHexString()))n+=o.count;});return n;})();
const broadleafTotal=(blMesh['palm-broadleaf-a-trunk']?.count??0)+(blMesh['palm-broadleaf-b-trunk']?.count??0);
const totalVeg=trees.length+broadleafTotal;
check('南迴-棕櫚 species 5 款棕櫚棵數＝實測字面值、闊葉 A/B 皆有、舊闊葉樹殘留 0、全部植被 150～260',
 PALM_MODELS.every(m=>counts[m]===EXPECT_COUNTS[m])&&broadleafTotal>0&&oldBroadleaf===0&&totalVeg>=150&&totalVeg<=260,{counts,broadleafTotal,oldBroadleaf,totalVeg});

// 每款樹的幾何：子零件（userData.palmParts）→ 局部座標頂點。樹的局部座標：原點＝樹幹底，+Z 朝上。
const geomInfo={};
for(const model of PALM_MODELS){const o=palmMesh[model];if(!o)continue;const g=o.geometry,pa=g.attributes.position,col=g.attributes.color;
 const parts=g.userData.palmParts||[];const sub=name=>parts.filter(p=>p.name===name);
 const verts=list=>{const out=[];for(const p of list)for(let k=p.start;k<p.start+p.count;k++)out.push(new THREE.Vector3(pa.getX(k),pa.getY(k),pa.getZ(k)));return out;};
 geomInfo[model]={g,pa,col,parts,sub,verts,tris:pa.count/3};}

// (5) 整棵高度（世界座標：全部頂點最高點－樹幹底）。前排椰子 2.8～3.5、檳榔 3.0～3.7、後排椰子＝前排×.45（1.26～1.575）；
//     而且前排最矮的棕櫚不能比同一坡帶（高度比 <.38，棕櫚生長的坡帶）闊葉樹的平均高度矮。
//     依據：主對話派工「棕櫚要讀得出是高大的樹，不能比同一坡帶的闊葉樹矮一截」；HEAD 同坡帶闊葉樹實測 1.79～3.41、平均 2.47。
const HEIGHT_RANGE={coco:[2.8,3.5],betel:[3.0,3.7]},BACK_ROW_SCALE=.45;
for(const t of trees){const gi=geomInfo[t.model];if(!gi.g.boundingBox)gi.g.computeBoundingBox();t.height=gi.g.boundingBox.max.z*t.scaleXYZ[2];t.back=t.y>=BACK_ROW_Y;}
const rangeOf=t=>{const r=HEIGHT_RANGE[isCoco(t.model)?'coco':'betel'];return t.back?r.map(v=>v*BACK_ROW_SCALE):r;};
const heightBad=trees.filter(t=>{const [lo,hi]=rangeOf(t);return !(t.height>=lo-1e-6&&t.height<=hi+1e-6);});
// 程式只准做等比縮放（主對話派工：形狀一律是 Blender 的，程式只管位置、yaw、等比縮放、深淺）。
const nonUniform=trees.filter(t=>Math.abs(t.scaleXYZ[0]-t.scaleXYZ[2])>1e-6||Math.abs(t.scaleXYZ[1]-t.scaleXYZ[2])>1e-6).length;
function canopyHeights(trunkName,canopyName){const tm=blMesh[trunkName],cm=blMesh[canopyName];if(!tm||!cm)return[];if(!cm.geometry.boundingBox)cm.geometry.computeBoundingBox();
 const pa=cm.geometry.attributes.position,v=new THREE.Vector3(),out=[];
 for(let i=0;i<tm.count;i++){const {m,p}=decomposeAt(cm,i);let mz=-Infinity;for(let k=0;k<pa.count;k++){v.fromBufferAttribute(pa,k).applyMatrix4(m);if(v.z>mz)mz=v.z;}out.push({h:mz-decomposeAt(tm,i).p.z,x:p.x,y:p.y});}return out;}
const blA=canopyHeights('palm-broadleaf-a-trunk','palm-broadleaf-a-canopy'),blB=canopyHeights('palm-broadleaf-b-trunk','palm-broadleaf-b-canopy');
const sameBand=[...blA,...blB].filter(b=>terrain.height(b.x,b.y)/terrain.peak<.38).map(b=>b.h);
const sameBandMean=sameBand.reduce((a,b)=>a+b,0)/Math.max(1,sameBand.length);
const frontPalmMin=Math.min(...trees.filter(t=>!t.back).map(t=>t.height));
check('南迴-棕櫚 height 每棵整棵高度在範圍內（前排椰子 2.8～3.5、檳榔 3.0～3.7、後排椰子×.45）、每棵等比縮放，且前排最矮的棕櫚 ≥ 同坡帶闊葉樹平均高',
 trees.length>0&&heightBad.length===0&&nonUniform===0&&frontPalmMin>=sameBandMean,
 {cocoFront:minMax(trees.filter(t=>isCoco(t.model)&&!t.back),'height'),betel:minMax(trees.filter(t=>!isCoco(t.model)),'height'),cocoBack:minMax(trees.filter(t=>t.back),'height'),
  bad:heightBad.slice(0,3).map(t=>[t.model,+t.height.toFixed(3)]),nonUniform,frontPalmMin:+frontPalmMin.toFixed(3),sameBandBroadleafMean:+sameBandMean.toFixed(3),sameBandN:sameBand.length});

// 樹冠（綠葉：fronds＋young）的水平直徑、垂直範圍、水平中心偏移：在樹的局部座標量（樹的前後左右兩軸取大者），
// 再乘上這棵的等比縮放。不在世界座標量：yaw 會讓「世界軸向包圍盒寬」隨方位角變化最多約 13%（8～9 片葉的檳榔實測
// .53～.61），量到的是轉角度而不是樹冠大小。
for(const model of PALM_MODELS){const gi=geomInfo[model];if(!gi)continue;const b=new THREE.Box3().setFromPoints(gi.verts([...gi.sub('fronds'),...gi.sub('young')]));
 gi.crown={diam:Math.max(b.max.x-b.min.x,b.max.y-b.min.y),thick:b.max.z-b.min.z,offset:Math.hypot((b.min.x+b.max.x)/2,(b.min.y+b.max.y)/2)};}
for(const t of trees){const c=geomInfo[t.model].crown;t.diam=c.diam*t.scale;t.thick=c.thick*t.scale;t.ratio=t.diam/t.height;t.hubOffset=c.offset*t.scale;}

// (6) 樹冠比例。檳榔：樹冠直徑÷整棵高 .45～.6（主對話派工）。椰子：樹冠直徑÷整棵高 ≥.5（沿用 HEAD 的「抓火柴棒」下限），
//     整個樹冠側面輪廓（樹冠基部、綠葉、乾葉、椰子果，不含樹幹）寬÷高 1.6～2.2（主對話派工）。
//     另外記錄「只算綠葉」的寬÷高（約 3.2，不設門檻）：派工同時要求「葉片先上揚 20～35°、只有外側約 1/3 下垂、葉尖約落在
//     樹冠底」，照這個形狀綠葉樹冠本身的寬÷高必然是 3～5（見 scratchpad palms-opus-notes.md 第 2 節），兩條要求只有把乾葉算進
//     樹冠輪廓時才同時成立；這裡以形狀要求為準，比例量整個輪廓。
const cocoSil={};
for(const model of PALM_MODELS.filter(isCoco)){const gi=geomInfo[model];
 const sil=gi.verts(gi.parts.filter(p=>!['trunk','rings'].includes(p.name))),green=gi.verts([...gi.sub('fronds'),...gi.sub('young')]);
 const ext=vs=>{const b=new THREE.Box3().setFromPoints(vs);return{w:Math.max(b.max.x-b.min.x,b.max.y-b.min.y),h:b.max.z-b.min.z};};
 const a=ext(sil),gr=ext(green);cocoSil[model]={silWH:+(a.w/a.h).toFixed(3),greenWH:+(gr.w/gr.h).toFixed(3)};}
const betelRatioOk=trees.filter(t=>!isCoco(t.model)).every(t=>t.ratio>=.45&&t.ratio<=.6);
const cocoRatioOk=trees.filter(t=>isCoco(t.model)).every(t=>t.ratio>=.5);
const cocoSilOk=Object.values(cocoSil).length===3&&Object.values(cocoSil).every(c=>c.silWH>=1.6&&c.silWH<=2.2);
check('南迴-棕櫚 crown ratio 檳榔樹冠直徑÷整棵高 .45～.6；椰子 ≥.5；椰子整個樹冠側面輪廓寬÷高 1.6～2.2',betelRatioOk&&cocoRatioOk&&cocoSilOk,
 {betel:minMax(trees.filter(t=>!isCoco(t.model)),'ratio'),coco:minMax(trees.filter(t=>isCoco(t.model)),'ratio'),cocoSil});

// (7) 樹冠形狀（幾何，逐片葉）。一片葉＝fronds／young 子零件裡「共用頂點相連」的一組三角形；掛點＝椰子樹冠基部（knob）
//     或檳榔葉鞘（shaft）的頂面。水平伸展不到最長葉一半的是中央新葉（spear），不算葉片。
//     椰子（主對話派工的形狀）：12～16 片；每片先上揚（葉片最高點比自己的葉基高 ≥ 伸展長度×.08，而且最高點在伸展
//     距離的 40% 以外＝內側至少四成是往上長的，對應派工「只有外側約 1/3 下垂」）、外側下垂（葉尖低於自己的最高點，
//     差距 ≥ 伸展長度 ×.1）；整個綠色樹冠最高點高於掛點；葉尖落在樹冠下半部（葉尖高度中位數在樹冠垂直範圍的下 40%）；
//     正上方看葉片方位相鄰間隙 ≤40°。檳榔：7～10 片、每片都上揚（同上兩個條件）、樹冠最高點高於掛點。
//     HEAD 的椰子葉從掛點直接往下垂（最高點＝葉基），「先上揚」這條就會紅。
function frondsOf(gi){
 const tris=[];for(const p of [...gi.sub('fronds'),...gi.sub('young')])for(let k=p.start;k<p.start+p.count;k+=3)tris.push(k);
 const key=k=>`${gi.pa.getX(k).toFixed(5)},${gi.pa.getY(k).toFixed(5)},${gi.pa.getZ(k).toFixed(5)}`;
 const parent=tris.map((_,i)=>i),find=i=>parent[i]===i?i:(parent[i]=find(parent[i])),owner=new Map();
 tris.forEach((k,i)=>{for(let j=0;j<3;j++){const kk=key(k+j);if(owner.has(kk))parent[find(i)]=find(owner.get(kk));else owner.set(kk,i);}});
 const groups=new Map();tris.forEach((k,i)=>{const r=find(i);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(k);});
 return [...groups.values()].map(ks=>{const vs=[];for(const k of ks)for(let j=0;j<3;j++)vs.push(new THREE.Vector3(gi.pa.getX(k+j),gi.pa.getY(k+j),gi.pa.getZ(k+j)));return vs;});
}
const shape={};
for(const model of PALM_MODELS){const gi=geomInfo[model];if(!gi)continue;
 const anchorVs=gi.verts(gi.sub(isCoco(model)?'knob':'shaft'));if(!anchorVs.length){shape[model]={missingAnchor:true};continue;}
 const ab=new THREE.Box3().setFromPoints(anchorVs),hub=new THREE.Vector3((ab.min.x+ab.max.x)/2,(ab.min.y+ab.max.y)/2,ab.max.z);
 const comps=frondsOf(gi).map(vs=>{const r=v=>Math.hypot(v.x-hub.x,v.y-hub.y);let base=vs[0],tip=vs[0],top=vs[0];
  for(const v of vs){if(r(v)<r(base))base=v;if(r(v)>r(tip))tip=v;if(v.z>top.z)top=v;}const cx=vs.reduce((a,v)=>a+v.x,0)/vs.length,cy=vs.reduce((a,v)=>a+v.y,0)/vs.length; // 方位角＝整片葉重心（兩側小葉對稱，≈葉軸方向；葉尖那一點會偏向一側小葉）。
  return{reach:r(tip),baseZ:base.z,tipZ:tip.z,topZ:top.z,apexFrac:r(top)/r(tip),az:Math.atan2(cy-hub.y,cx-hub.x)*180/Math.PI};});
 const maxReach=Math.max(...comps.map(c=>c.reach)),fr=comps.filter(c=>c.reach>=maxReach*.5);
 const green=gi.verts([...gi.sub('fronds'),...gi.sub('young')]),gz=green.map(v=>v.z),cMin=Math.min(...gz),cMax=Math.max(...gz);
 const az=fr.map(c=>c.az).sort((a,b)=>a-b),gaps=az.map((a,i)=>i?a-az[i-1]:a+360-az[az.length-1]);
 const tipFrac=fr.map(c=>(c.tipZ-cMin)/(cMax-cMin)).sort((a,b)=>a-b),tipFracMedian=tipFrac[Math.floor(tipFrac.length/2)];
 shape[model]={fronds:fr.length,allRise:fr.every(c=>c.topZ-c.baseZ>=.08*c.reach&&c.apexFrac>=.4),minRise:+Math.min(...fr.map(c=>(c.topZ-c.baseZ)/c.reach)).toFixed(3),minApexFrac:+Math.min(...fr.map(c=>c.apexFrac)).toFixed(3),
  allDroop:fr.every(c=>c.topZ-c.tipZ>=c.reach*.1),minDroopRatio:+Math.min(...fr.map(c=>(c.topZ-c.tipZ)/c.reach)).toFixed(3),
  crownAboveHub:+(cMax-hub.z).toFixed(3),tipFracMedian:+tipFracMedian.toFixed(3),maxAzGap:+Math.max(...gaps).toFixed(1)};}
const shapeOk=PALM_MODELS.every(m=>{const s=shape[m];if(!s||s.missingAnchor)return false;
 if(isCoco(m))return s.fronds>=12&&s.fronds<=16&&s.allRise&&s.allDroop&&s.crownAboveHub>0&&s.tipFracMedian<=.4&&s.maxAzGap<=40;
 return s.fronds>=7&&s.fronds<=10&&s.allRise&&s.crownAboveHub>0;});
check('南迴-棕櫚 crown shape 椰子 12～16 片、每片先上揚（內側四成以上往上）後外側下垂、樹冠最高點高於掛點、葉尖在樹冠下 40%、方位間隙 ≤40°；檳榔 7～10 片、每片上揚',shapeOk,
 {'款:[片數,最小上揚比,最小拱頂位置,最小下垂比,冠頂高於掛點,葉尖位置中位數,最大方位間隙]':Object.fromEntries(PALM_MODELS.map(m=>{const x=shape[m]||{};return[m,[x.fronds,x.minRise,x.minApexFrac,x.minDroopRatio,x.crownAboveHub,x.tipFracMedian,x.maxAzGap]];}))});

// (8) 樹冠有厚度（沿用 HEAD：不是扁平星形）：每棵綠色樹冠垂直範圍 ≥ .25×樹冠直徑。
check('南迴-棕櫚 canopy has volume 每棵綠色樹冠垂直範圍 ≥0.25×樹冠直徑（不是扁平的星形）',trees.every(t=>t.thick>=.25*t.diam),
 {coco:minMax(trees.filter(t=>isCoco(t.model)).map(t=>t.thick/t.diam)),betel:minMax(trees.filter(t=>!isCoco(t.model)).map(t=>t.thick/t.diam))});

// (9) 葉色（頂點色，sRGB 色相）。椰子葉（fronds／young）70～100°（黃綠），檳榔葉 90～120°，檳榔葉鞘比檳榔葉亮；任何棕櫚
//     頂點色都不准落在 150～200°（藍綠，主對話讀截圖指出的舊椰子葉 #3f6a5a≈158°）。每棵的 instanceColor 必須是灰階
//     （只調深淺、不改色相）。依據：主對話派工的色相範圍。
function hsl(c){const [r,g,b]=[c.r,c.g,c.b].map(x=>x<=.0031308?x*12.92:1.055*x**(1/2.4)-.055),mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2,d=mx-mn;
 if(d<1e-6)return{h:0,s:0,l};const s=d/(1-Math.abs(2*l-1));let h=mx===r?((g-b)/d)%6:mx===g?(b-r)/d+2:(r-g)/d+4;h*=60;if(h<0)h+=360;return{h,s,l};}
const hue={};let tealVerts=0,tintBad=0;
for(const model of PALM_MODELS){const gi=geomInfo[model];if(!gi?.col){hue[model]={noColor:true};continue;}
 const colAt=k=>new THREE.Color(gi.col.getX(k),gi.col.getY(k),gi.col.getZ(k)),partHues=name=>gi.sub(name).flatMap(p=>{const out=[];for(let k=p.start;k<p.start+p.count;k+=3)out.push(hsl(colAt(k)));return out;});
 for(let k=0;k<gi.col.count;k+=3){const c=hsl(colAt(k));if(c.s>.1&&c.h>=150&&c.h<=200)tealVerts++;}
 const leaf=[...partHues('fronds'),...partHues('young')],shaftL=partHues('shaft').map(c=>c.l);
 hue[model]={leafHue:minMax(leaf,'h'),leafL:minMax(leaf,'l'),shaftL:shaftL.length?minMax(shaftL):null};
 const o=palmMesh[model];if(o.instanceColor)for(let i=0;i<o.count;i++){const r=o.instanceColor.getX(i),g=o.instanceColor.getY(i),b=o.instanceColor.getZ(i);if(Math.abs(r-g)>1e-6||Math.abs(r-b)>1e-6)tintBad++;}}
const hueOk=PALM_MODELS.every(m=>{const h=hue[m];if(!h||h.noColor||h.leafHue[0]===null)return false;const [lo,hi]=isCoco(m)?[70,100]:[90,120];
 return h.leafHue[0]>=lo&&h.leafHue[1]<=hi&&(isCoco(m)||(h.shaftL&&h.shaftL[0]>h.leafL[1]));})&&tealVerts===0&&tintBad===0;
check('南迴-棕櫚 hue 椰子葉色相 70～100°、檳榔葉 90～120°、檳榔葉鞘比葉亮、棕櫚無 150～200° 藍綠頂點、每棵深淺是灰階',hueOk,{hue,tealVerts,tintBad});

// (10) 椰子果在樹冠正下方：每顆果（fruit 子零件裡相連的一組三角形）中心低於掛點、離掛點 ≤ 整棵高 ×.12，水平距離掛點
//      ≤ .3×樹冠半徑（沿用 HEAD「≤0.3×樹冠半徑」）。每款椰子至少一串（≥3 顆）。
const fruit={};
for(const model of PALM_MODELS.filter(isCoco)){const gi=geomInfo[model];const fv=gi.verts(gi.sub('fruit'));const ab=new THREE.Box3().setFromPoints(gi.verts(gi.sub('knob')));
 const hub=new THREE.Vector3((ab.min.x+ab.max.x)/2,(ab.min.y+ab.max.y)/2,ab.max.z),H=gi.g.boundingBox.max.z;
 const green=gi.verts([...gi.sub('fronds'),...gi.sub('young')]),gb=new THREE.Box3().setFromPoints(green),crownR=Math.max(gb.max.x-gb.min.x,gb.max.y-gb.min.y)/2;
 const balls=[];for(let k=0;k+60<=fv.length;k+=60){const c=new THREE.Vector3();for(let j=0;j<60;j++)c.add(fv[k+j]);c.multiplyScalar(1/60);balls.push(c);}
 const bad=balls.filter(c=>!(c.z<hub.z&&hub.z-c.z<=.12*H&&Math.hypot(c.x-hub.x,c.y-hub.y)<=.3*crownR));
 fruit[model]={n:balls.length,bad:bad.length,maxDrop:+Math.max(...balls.map(c=>hub.z-c.z)).toFixed(3),maxHoriz:+Math.max(...balls.map(c=>Math.hypot(c.x-hub.x,c.y-hub.y))).toFixed(3),limitHoriz:+(.3*crownR).toFixed(3)};}
check('南迴-棕櫚 coconut fruit 每款椰子 ≥3 顆果，每顆都在掛點下方（≤ 整棵高×.12）、水平距離 ≤0.3×樹冠半徑',
 Object.keys(fruit).length===3&&Object.values(fruit).every(f=>f.n>=3&&f.bad===0),fruit);

// (11) 預算：每棵三角形椰子 ≤900（含椰子果）、檳榔 ≤450；棕櫚 InstancedMesh 數（＝draw call 數）≤ HEAD 的 10。
const palmDrawMeshes=[...meshByName.keys()].filter(n=>n.startsWith('palm-')&&!BL_NAMES.includes(n)).length;
const trisPerTree=Object.fromEntries(PALM_MODELS.map(m=>[m,geomInfo[m]?.tris]));
check('南迴-棕櫚 budget 每棵三角形 椰子 ≤900、檳榔 ≤450；棕櫚 InstancedMesh ≤10（HEAD 10 個）',
 PALM_MODELS.every(m=>trisPerTree[m]>0&&trisPerTree[m]<=(isCoco(m)?900:450))&&palmDrawMeshes<=10,{trisPerTree,palmDrawMeshes});

// ── 09-28 山上植被精修（評審「01 藍皮」第 2 項）的判準，沿用、改讀新的 mesh：彎幹棕櫚／闊葉樹高度／海拔限制／
// 稜線闊葉覆蓋／撒點間距／貼地誤差。terrain（height 函式＋PEAK）直接從 scene 拿。──
// 彎幹可見度：綠色樹冠水平中心相對樹幹底的偏移，彎幹 A/B ≥0.25；直幹（前排）對照組同一量測列在 detail。
const curved=trees.filter(t=>t.model==='coco-curved-a'||t.model==='coco-curved-b'),straightFront=trees.filter(t=>t.model==='coco-straight'&&!t.back);
check('南迴-彎幹棕櫚 curvature 兩款彎幹椰子的樹冠中心都明顯偏離樹幹底部正上方（水平偏移 ≥0.25，直幹對照組列在 detail）',
 curved.length>0&&curved.every(t=>t.hubOffset>=.25),{curvedOffsetRange:minMax(curved,'hubOffset'),straightControlRange:minMax(straightFront,'hubOffset'),n:curved.length});

// 闊葉樹整棵高度（樹幹底到樹冠逐頂點最高點）：沿用（實測 A:2.156~3.496、B:1.762~2.843）。
const HEIGHT_RANGE_BROADLEAF={a:[1.9,3.7],b:[1.5,3.0]};
const blHeightOk=blA.length>0&&blB.length>0&&blA.every(b=>b.h>=HEIGHT_RANGE_BROADLEAF.a[0]&&b.h<=HEIGHT_RANGE_BROADLEAF.a[1])&&blB.every(b=>b.h>=HEIGHT_RANGE_BROADLEAF.b[0]&&b.h<=HEIGHT_RANGE_BROADLEAF.b[1]);
check('南迴-闊葉樹 height 兩款闊葉樹整棵高度（樹幹底到樹冠逐頂點最高點）都落在設計範圍內',blHeightOk,
 {aRange:minMax(blA,'h'),bRange:minMax(blB,'h'),target:HEIGHT_RANGE_BROADLEAF});

// 海拔限制：山坡棕櫚（排除後排平地）裡 ratio=height(x,y)/PEAK >0.35 的比例 ≤10%。
const palmPts=trees.filter(t=>!t.back);
const palmRatios=palmPts.map(p=>terrain.height(p.x,p.y)/terrain.peak);
const palmAbove35=palmRatios.filter(r=>r>.35).length,palmAbove35Pct=palmAbove35/palmRatios.length;
check('南迴-山上植被 elevation-restriction 棕櫚（檳榔＋三款椰子，排除後排平地）裡 ratio(高度/山頂)>0.35 的比例 ≤10%（海岸低坡才有棕櫚）',
 palmAbove35Pct<=.10,{palmAbove35,total:palmRatios.length,palmAbove35Pct:+palmAbove35Pct.toFixed(4)});

// 稜線覆蓋：ratio>=0.5 的已種植植被（棕櫚＋闊葉）裡闊葉佔比 ≥0.85。
function worldXY(mesh){const out=[];if(!mesh)return out;for(let i=0;i<mesh.count;i++)out.push(decomposeAt(mesh,i).p);return out;}
const broadleafPts=[...worldXY(blMesh['palm-broadleaf-a-trunk']),...worldXY(blMesh['palm-broadleaf-b-trunk'])];
const ridgePalm=palmRatios.filter(r=>r>=.5).length,ridgeBroadleaf=broadleafPts.map(p=>terrain.height(p.x,p.y)/terrain.peak).filter(r=>r>=.5).length;
const ridgeTotal=ridgePalm+ridgeBroadleaf,ridgeBroadleafPct=ridgeTotal?ridgeBroadleaf/ridgeTotal:NaN;
check('南迴-山上植被 ridge-coverage 稜線（ratio(高度/山頂)>=0.5）的植被裡闊葉佔比 ≥0.85',
 ridgeTotal>0&&ridgeBroadleafPct>=.85,{ridgePalm,ridgeBroadleaf,ridgeTotal,ridgeBroadleafPct:+ridgeBroadleafPct.toFixed(4)});

// 撒點間距：山坡植被（棕櫚＋闊葉，不含後排平地）最近鄰距離變異係數 ≥0.25（不是等距網格）。
function nnCV(points){if(points.length<3)return NaN;const d=[];for(let a=0;a<points.length;a++){let best=Infinity;for(let b=0;b<points.length;b++){if(a===b)continue;const dist=Math.hypot(points[a].x-points[b].x,points[a].y-points[b].y);if(dist<best)best=dist;}d.push(best);}
 const mean=d.reduce((s,v)=>s+v,0)/d.length,vr=d.reduce((s,v)=>s+(v-mean)**2,0)/d.length;return Math.sqrt(vr)/mean;}
const spacingPts=[...palmPts,...broadleafPts],spacingCV=nnCV(spacingPts);
check('南迴-山上植被 spacing 山坡植被最近鄰距離變異係數 ≥0.25（不是等距排列的網格）',spacingCV>=.25,{spacingCV:+spacingCV.toFixed(4),n:spacingPts.length});

// 貼地：樹幹底部世界 z 與 terrain.height(x,y) 誤差 ≤0.02（排除後排平地，那裡是固定 z=.3）。
const groundErrs=[...palmPts,...worldXY(blMesh['palm-broadleaf-a-trunk']),...worldXY(blMesh['palm-broadleaf-b-trunk'])].map(p=>Math.abs(p.z-terrain.height(p.x,p.y)));
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
