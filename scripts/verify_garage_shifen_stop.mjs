// 十分老街（Scene 04）輕量精緻化（停站／天燈）驗收。用法：node scripts/verify_garage_shifen_stop.mjs
// 伺服器：python3 -m http.server 5254（worktree 根目錄）。瀏覽器一律無視窗：channel:'chrome'+headless:true。
// 天燈外形／升空是純資料與純函式驗證，不需要瀏覽器（跟 verify_garage_south_coast_stop.mjs 讀棕櫚 instanced
// mesh 同一個原則：直接呼叫 createSkyLanterns() 讀 readInstance() 實際寫入的矩陣，不重算 stateAt() 的公式）；
// 停站／看老街快轉是 main.js 的時刻表接線＋相機切換，屬於整合邏輯，跟 south_coast_stop.mjs 一樣只測 chromium
// （這幾條不是逐引擎才會分歧的算繪細節，既有 verify_garage_shifen.mjs 已經涵蓋跨引擎算繪 baseline）。
import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import * as THREE from '../rail-3d/vendor/three.module.js';
import {buildGarageParts} from '../rail-3d/garage-parts.js';
import {createScene,createSkyLanterns,THEMES} from '../rail-3d/garage-scenes/shifen.js';
const PAGE_URL=process.env.GARAGE_SHIFEN_URL||'http://127.0.0.1:5254/prototypes/garage-shifen/';
const results=[];function check(name,pass,detail){results.push({name,pass:!!pass});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail??'').slice(0,300));}

function loadKit(assetDirName,jsonName,binName){
 const DIR=new URL(`../rail-3d/assets/${assetDirName}/`,import.meta.url);
 const meta=JSON.parse(readFileSync(new URL(jsonName,DIR),'utf8'));
 const raw=gunzipSync(readFileSync(new URL(binName,DIR)));
 return buildGarageParts(meta,raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
}

// ── 純 Node（不需要瀏覽器）：天燈外形／升空。直接呼叫 createSkyLanterns() 讀 readInstance()／材質
// 實際寫入的值，不重算 stateAt() 的公式；scale 參數用 1（外形比例與升空的 z/fade 都跟 scale 無關，
// 真正的比例尺換算——1.25/primary.size.y——只影響畫面大小，見 main.js 與 shifen.js 檔頭註解）。
// 09-28 二版：外形／高度比兩條改成直接讀「lantern-paper 這個 InstancedMesh 的頂點資料」
// （geometry.attributes.position，跟畫面渲染吃的是同一份 gzip 解出來的浮點數字），不再讀
// lanterns.json 的 rig.topRadius／rig.bottomRadius／rig.height 這些 JSON 宣告值——初版被退回的
// 根本原因就是舊判準只核對「宣告值本身的比例」，量不到「宣告值是否真的對應匯出的網格」。
// peopleKit.rig.height（乘客身高）維持讀 JSON 常數：那是另一份這輪沒有改動、已由 build_people.py
// 自己的自檢流程驗過的資產，不是本輪要重新質疑的對象。──
const lanternsKit=loadKit('garage-lanterns-v1','lanterns.json','lanterns.bin.gz');
const peopleKit=loadKit('garage-people-v1','people.json','people.bin.gz');
function localVerts(mesh){const pos=mesh.geometry.attributes.position,out=[];for(let i=0;i<pos.count;i++)out.push({x:pos.getX(i),y:pos.getY(i),z:pos.getZ(i)});return out;}
let LANTERN_RENDERED_HEIGHT=null; // 給下面瀏覽器區塊的「白天投影高度」判準共用，避免那邊另外又去讀 rig.height。
{
 const personHeight=peopleKit.rig.height;
 const sc0=createScene();
 const probe=createSkyLanterns(lanternsKit,1,sc0.lanternZone,{count:1,seed:1});
 const paperMesh0=probe.group.children.find(o=>o.name==='sky-lantern-paper');
 const paperVerts=localVerts(paperMesh0);
 const zs=paperVerts.map(v=>v.z),renderedHeight=Math.max(...zs)-Math.min(...zs);
 LANTERN_RENDERED_HEIGHT=renderedHeight;
 const heightRatio=renderedHeight/personHeight;
 const rOf=v=>Math.hypot(v.x,v.y);

 // 09-28 三版：形狀判準改量「實際畫出來的 mesh」在世界座標、套用 instance 矩陣後的頂點——getMatrixAt
 // 讀回真正寫進 InstancedMesh 的那個矩陣（跟 readInstance() 同一個原則），不是讀 geometry 的原始局部
 // 座標。挑 cycle=H/2（爬升週期正中央，遠離兩端 FADE 淡入淡出區）取樣，確保這顆 instance 當下
 // scale=1（fade=1），不是量到正在淡出淡入中途的縮小值。「肩部/底口/頂端半徑」的舊判準（bandR 固定
 // z 帶）鎖的是二版「腰身在 55% 高度」的錯誤形狀，三版整條刪掉，換成下面「找出實測最寬處在哪個高度、
 // 逐一核對 w10<w50<w90、最寬處≥80%高度、底口/最寬∈[0.5,0.67]」——判準本身不假設最寬處在哪裡，
 // 是從實測資料自己找出來的。
 probe.update((probe.H/2-probe.lanternSet[0].phase)/probe.lanternSet[0].rise,'day');
 paperMesh0.updateMatrixWorld(true);
 const im0=new THREE.Matrix4();paperMesh0.getMatrixAt(0,im0);
 const full0=new THREE.Matrix4().multiplyMatrices(paperMesh0.matrixWorld,im0);
 const centerV=new THREE.Vector3().setFromMatrixPosition(full0);
 const axisV=new THREE.Vector3(0,0,1).transformDirection(full0);
 const worldRadiusOf=v=>{
  const rel=new THREE.Vector3(v.x,v.y,v.z).applyMatrix4(full0).sub(centerV);
  const along=rel.dot(axisV);
  return rel.sub(axisV.clone().multiplyScalar(along)).length();
 };
 probe.dispose();sc0.dispose();
 // 逐一取得每一圈（同一個局部 z）的實測最大世界半徑——局部 z 相同的頂點，套用同一個 instance 矩陣後
 // 仍然對應同一個「沿天燈自己中軸的高度」（旋轉＋等比縮放＋平移不會打亂這個對應關係），所以可以放心
 // 照局部 z 分組，只是「半徑」這個量本身改成套用矩陣後的世界座標量出來的。
 const zMin=Math.min(...zs),zSpan=renderedHeight;
 const uniqZ=[...new Set(zs.map(z=>+z.toFixed(6)))].sort((a,b)=>a-b);
 const ringWidths=uniqZ.map(z=>({
  frac:(z-zMin)/zSpan,
  width:2*Math.max(...paperVerts.filter(v=>Math.abs(v.z-z)<1e-4).map(worldRadiusOf)),
 }));
 const widest=ringWidths.reduce((a,b)=>(b.width>a.width?b:a));
 const nearestByFrac=f=>ringWidths.reduce((a,b)=>(Math.abs(b.frac-f)<Math.abs(a.frac-f)?b:a));
 const w10=nearestByFrac(.10).width,w50=nearestByFrac(.50).width,w90=nearestByFrac(.90).width;
 const baseWidth=ringWidths[0].width,baseRatio=baseWidth/widest.width;
 check('十分-天燈外形 寬度隨高度變寬（10%／50%／90% 高度取樣：w90>w50>w10，實測世界座標套用 instance 矩陣後的頂點，不是 rig 宣告值）',
  w90>w50&&w50>w10,{w10:+w10.toFixed(4),w50:+w50.toFixed(4),w90:+w90.toFixed(4)});
 check('十分-天燈外形 最寬處（肩部）在 ≥80% 高度——「上寬下窄」，不是二版把最寬處放在 55% 高度的蛋形',
  widest.frac>=0.80,{widestFrac:+widest.frac.toFixed(3),widestWidth:+widest.width.toFixed(4)});
 check('十分-天燈外形 底口寬／最寬 落在 0.5～0.67（太寬太窄都算不過：既不是二版的蛋形收窄、也不是柱狀直筒）',
  baseRatio>=0.5&&baseRatio<=0.67,{baseWidth:+baseWidth.toFixed(4),widestWidth:+widest.width.toFixed(4),ratio:+baseRatio.toFixed(4)});
 check('十分-天燈外形 整顆高度相對站姿乘客身高的比例落在 1.1～1.4（實測 lantern-paper 網格頂點的 Z 範圍÷people.json 既有 rig.height，兩個方向都驗：≥1.1 且 ≤1.4）',
  heightRatio>=1.1&&heightRatio<=1.4,{renderedHeight:+renderedHeight.toFixed(4),personHeight,heightRatio:+heightRatio.toFixed(3)});
 const sc=createScene();
 const lanterns=createSkyLanterns(lanternsKit,1,sc.lanternZone,{count:12,seed:20260928});
 const paperMat=lanterns.group.children.find(o=>o.name==='sky-lantern-paper').material;
 const frameMat=lanterns.group.children.find(o=>o.name==='sky-lantern-frame').material;
 lanterns.update(0,'day');const paperDay=paperMat.emissiveIntensity;
 lanterns.update(0,'night');const paperNight=paperMat.emissiveIntensity;
 check('十分-天燈外形 材質自發光強度照 THEMES 的 day/night.paper 走、且夜裡遠亮於白天（白天紙色／夜裡透光）',
  paperDay===THEMES.day.paper&&paperNight===THEMES.night.paper&&paperNight>=paperDay*5,
  {paperDay,paperNight,themeDayPaper:THEMES.day.paper,themeNightPaper:THEMES.night.paper});
 check('十分-天燈外形 竹框材質沒有自發光設定（框架不透光，只有紙面會透光）',
  frameMat.emissive.getHex()===0,{frameEmissiveHex:frameMat.emissive.getHexString()});
 lanterns.dispose();sc.dispose();
}
{
 const sc=createScene();
 const lanterns=createSkyLanterns(lanternsKit,1,sc.lanternZone,{count:6,seed:20260928});
 const {H,FADE,lanternSet}=lanterns,k=0,L=lanternSet[k];
 const timeForCycle=c=>(c-L.phase)/L.rise; // stateAt() 內部 c=((t*rise+phase)%H+H)%H 的反函數（只取 n=0 那一圈解）
 const tA=timeForCycle(FADE*1.5),tB=timeForCycle(H-FADE*1.5);
 lanterns.update(tA,'night');const a=lanterns.readInstance(k);
 lanterns.update(tB,'night');const b=lanterns.readInstance(k);
 check('十分-天燈升空 同一盞燈的高度隨時間增加（升空中段兩個時間點取樣，實測 readInstance 的 z）',
  b.position[2]>a.position[2],{tA:+tA.toFixed(3),tB:+tB.toFixed(3),zA:a.position[2],zB:b.position[2]});
 // 回收：cycle 從 H 繞回 0 那一瞬間 z 會有一個大落差（releaseZ+H 掉回 releaseZ 附近）；用 readInstance
 // 實際的 scale（=scale參數(1)×fade，這裡就是 fade 本身）當「看不看得見」的判準，不重算 stateAt() 的公式。
 const samples=[];
 for(let dc=-FADE*1.3;dc<=FADE*1.3;dc+=FADE*.15){
  const c=((dc%H)+H)%H,t=timeForCycle(c);
  lanterns.update(t,'night');const inst=lanterns.readInstance(k);
  samples.push({dc:+dc.toFixed(3),scale:+inst.scale.toFixed(4),z:+inst.position[2].toFixed(4)});
 }
 let maxVisibleJump=0,wrapJump=0;
 for(let i=1;i<samples.length;i++){
  const dz=Math.abs(samples[i].z-samples[i-1].z),bothVisible=samples[i].scale>.15&&samples[i-1].scale>.15;
  if(bothVisible)maxVisibleJump=Math.max(maxVisibleJump,dz);
  if(dz>H/2)wrapJump=dz;
 }
 check('十分-天燈升空 回收發生在淡出後：wrap 前後兩端 scale 都很低、可見時沒有任何大跳動（不會瞬移穿幫）',
  wrapJump>H/2&&maxVisibleJump<.5,{wrapJump:+wrapJump.toFixed(3),maxVisibleJump:+maxVisibleJump.toFixed(3),samples});
 lanterns.dispose();sc.dispose();
}

// 月台世界座標的獨立真值：直接讀 shifen.js 場景自己的 anchors.station（車站方塊實際蓋的位置），
// 不是讀 main.js 的 STATION_OFFSET 常數——兩者理論上該相等，但拿「宣稱值」當「期待值」是零資訊的
// 同源比對（若 main.js 的常數本身錯了，用它自己核對自己永遠是綠燈）。突變測試已驗證這個分辨：
// 把 STATION_OFFSET 改成 0 時，若期待值改用 T.stationOffset 會一起變成 0、測試依然「通過」。
const stationAnchorX=(()=>{const sc=createScene();const x=sc.anchors.station[0];sc.dispose();return x;})();

// ── Playwright（chromium headless）：停站、看老街快轉。──
const state=p=>p.evaluate(()=>shifenPreview.state);
const b=await chromium.launch({channel:'chrome',headless:true});
try{
 const p=await b.newPage({viewport:{width:1400,height:900}});const errors=[];
 p.on('pageerror',e=>errors.push('PAGEERROR '+e.message));p.on('console',m=>{if(m.type()==='error'&&!/\/favicon\.ico(\?|$)/.test(m.location()?.url||''))errors.push('CONSOLE '+m.text());});
 await p.goto(PAGE_URL);await p.waitForFunction(()=>window.shifenPreview?.state.ready,null,{timeout:90000});
 const T=await p.evaluate(()=>shifenPreview.timetable);

 // 十分-停站：煞停前一刻仍在動、進站後 speed=0 全程（剛停穩／中途／發車前）、發車後一刻已經在動；
 // 中途時每節車中心都貼著月台中心（STATION_OFFSET），不是停在老街中段。n=0 這一圈，phases 都是絕對時間。
 const at=async t=>{await p.evaluate(t=>shifenPreview.setTime(t),t);return state(p);};
 const preBrake=await at(T.phases.brake-.15),justStopped=await at(T.phases.brake+.15),
  midDwell=await at((T.phases.brake+T.phases.departAt)/2),justBeforeDepart=await at(T.phases.departAt-.15),
  justAfterDepart=await at(T.phases.departAt+.15);
 check('十分-停站 煞停前一刻仍在減速中（未停）',preBrake.phase!=='stopped'&&preBrake.currentSpeed>0,{phase:preBrake.phase,v:preBrake.currentSpeed});
 check('十分-停站 進站後 speed=0（剛停穩／中途／發車前）三個時間點皆成立',
  [justStopped,midDwell,justBeforeDepart].every(s=>s.phase==='stopped'&&s.currentSpeed===0),
  {justStopped:justStopped.currentSpeed,midDwell:midDwell.currentSpeed,justBeforeDepart:justBeforeDepart.currentSpeed});
 check('十分-停站 發車後一刻已經在動（停站時間窗＝timetable 的 dwell，沒有多停或少停）',
  justAfterDepart.phase!=='stopped'&&justAfterDepart.currentSpeed>0,{phase:justAfterDepart.phase,v:justAfterDepart.currentSpeed});
 const midX=midDwell.poses[1].x;
 check('十分-停站 停站時中間那節車的中心對齊十分站月台中心（真值來自 shifen.js 場景自己的 anchors.station，不是 main.js 的 STATION_OFFSET 常數），不是停在老街中段',
  Math.abs(midX-stationAnchorX)<.05,{midX,stationAnchorX,mainStationOffset:T.stationOffset,allPoses:midDwell.poses.map(c=>c.x)});

 // 十分-看老街快轉：巡航中點擊→時間往未來跳（不是瞬移到別的位置）且落在下一次進站的減速段、自動切到
 // platform 視角；再快轉到停穩，確認真的停在月台（phase=stopped、speed=0），不是中途停下或衝過站。
 await p.evaluate(()=>shifenPreview.setTime(40));const beforeClick=await state(p); // 40 秒必落在巡航段（cruiseAt=26 < 40 ≪ lap）
 await p.click('#platform');const afterClick=await state(p);
 check('十分-看老街快轉 巡航中點擊：時間往前跳到下一次進站的減速段（不是瞬移到任意位置），並自動切到 platform 視角',
  afterClick.time>beforeClick.time+1&&(afterClick.phase==='braking'||afterClick.phase==='stopped')&&afterClick.view==='platform',
  {before:beforeClick.time,after:afterClick.time,phase:afterClick.phase,view:afterClick.view});
 const t1=afterClick.time;await p.click('#platform');const secondClick=await state(p);
 check('十分-看老街快轉 已經在減速／停站中再點一次不再跳',Math.abs(secondClick.time-t1)<1.5,{t1,t2:secondClick.time});
 await p.evaluate(t=>shifenPreview.setTime(t),t1+T.phases.brake+1);const stoppedState=await state(p);
 check('十分-看老街快轉 快轉後真的停在月台（phase=stopped、speed=0，不是瞬移也不是衝過站）',
  stoppedState.phase==='stopped'&&stoppedState.currentSpeed===0,{phase:stoppedState.phase,v:stoppedState.currentSpeed});

 // ── 天燈可見度：量渲染結果的實際像素，不是原始碼或公式。用 shifenPreview.lanternState(k) 讀
 // 「實際寫進 InstancedMesh 的那個 matrix」算世界座標、shifenPreview.project() 過當下那顆真實相機
 // 轉成畫面像素，最後從 WebGL canvas 實際畫出來的像素資料（renderer 開了 preserveDrawingBuffer）
 // 讀亮度，全程不重算投影或位置公式。「投影高度」用 LANTERN_RENDERED_HEIGHT（上面 Node 區塊量出來的
 // 真實網格高度，不是 rig.height 宣告值）乘上 readInstance 當下的實際 scale，一樣是量測、不是常數。
 const lanternCount=(await p.evaluate(()=>shifenPreview.lanternInfo()))?.count??0;
 // sampleLanterns()：「亮度明顯高於背景」的訊號來源改成同一個像素、同一個當下的「光暈開／關」
 // A/B（用 shifenPreview.setVisible('sky-lantern-glow',bool)，main.js 09-28 起也搜 lanterns.group
 // 才找得到這個節點），不是跟旁邊像素比。原因是踩過兩個坑：(1) 直接比中心點跟旁邊背景——紙燈殼
 // 自己的 emissive（THEMES.night.paper=1.1，本來就有、不是本輪新加的）加上這輪變大的尺寸，中心點
 // 本來就很亮，比不出光暈的貢獻；(2) 改比中心點往旁邊偏移 12px（原本設計是要避開紙殼本體、只落在
 // 光暈範圍）——結果量到的還是量不準，因為天燈飄在滿是既有裝飾（燈籠串、路燈）的老街上空，任何
 // 鄰近像素都可能剛好疊到別的光源，同一顆天燈四個方向的 delta 可以從 -128 跳到 +147，雜訊蓋過訊號。
 // 換成「同一像素、只切光暈可見度」直接把這兩個混淆源都消掉：背景（其他光源、紙殼本體本身的顏色）
 // 兩次讀值完全相同，唯一會變的只有光暈本身的 additive 貢獻。這個 A/B 也順手抓出一個真的渲染
 // bug：光暈原本釘在天燈 base（跟本體共用同一個基準點），沒有跟著抬到「腰身」高度，且
 // PointsMaterial 沒關 depthTest——整個點精靈只有一個深度值（等於點的位置），釘在本體中心會被
 // 本體自己不透明的前緣整片擋掉深度測試，兩個問題疊加的結果是「中心點的光暈開關幾乎讀不出差異」
 // （12 盞裡 9 盞 delta=0），跟這裡要驗的「光暈根本沒作用」長得一模一樣，靠這個 A/B 才把真正的
 // 渲染 bug（不是驗證方法的錯覺）揪出來——兩個都已在 shifen.js 修好（glowMidH、depthTest:false）。
 async function sampleLanterns(){
  return p.evaluate(({n,h})=>{
   const cvs=document.querySelector('#scene');
   const off=document.createElement('canvas');off.width=cvs.width;off.height=cvs.height;const octx=off.getContext('2d');
   const readAll=()=>{octx.drawImage(cvs,0,0);return(x,y)=>{const ix=Math.round(x),iy=Math.round(y);if(ix<0||iy<0||ix>=off.width||iy>=off.height)return null;const d=octx.getImageData(ix,iy,1,1).data;return .2126*d[0]+.7152*d[1]+.0722*d[2];};};
   const centers=[],tops=[],bottoms=[];
   for(let k=0;k<n;k++){
    const inst=shifenPreview.lanternState(k);
    const [x,y,z]=inst.position;
    centers.push(shifenPreview.project([x,y,z+.5*inst.scale*h]));
    tops.push(shifenPreview.project([x,y,z+inst.scale*h]));bottoms.push(shifenPreview.project([x,y,z]));
   }
   const inFrame=centers.map(c=>c.x>=0&&c.x<off.width&&c.y>=0&&c.y<off.height);
   const glowFound=shifenPreview.setVisible('sky-lantern-glow',true);const readOn=readAll();
   const on=centers.map((c,k)=>inFrame[k]?readOn(c.x,c.y):null);
   shifenPreview.setVisible('sky-lantern-glow',false);const readOff=readAll();
   const offv=centers.map((c,k)=>inFrame[k]?readOff(c.x,c.y):null);
   shifenPreview.setVisible('sky-lantern-glow',true); // 還原成正常顯示狀態，不影響其他判準
   const out=centers.map((c,k)=>({k,x:+c.x.toFixed(1),y:+c.y.toFixed(1),inFrame:inFrame[k],
    delta:(on[k]!=null&&offv[k]!=null)?+(on[k]-offv[k]).toFixed(1):null,
    pxHeightAt1000:+(Math.abs(tops[k].y-bottoms[k].y)/off.width*1000).toFixed(2)}));
   return{out,canvasW:off.width,canvasH:off.height,glowFound};
  },{n:lanternCount,h:LANTERN_RENDERED_HEIGHT});
 }
 // 門檻取 15：實測全數 12 盞開／關光暈的差值落在 20~59（見 scratchpad/garage-b/04-shifen-notes.md
 // 記錄的原始量測），15 comfortably 低於最小值、comfortably 高於「光暈關掉後理論上該讀到的 0」，
 // 不是抄公式湊出來的常數。
 const BRIGHT_DELTA=15;
 const HEIGHT_PX_MIN=8;
 await p.click('[data-period="night"]');await p.click('[data-view="world"]');await p.evaluate(()=>shifenPreview.setTime(40));
 const nightWorld=await sampleLanterns(),nightWorldBright=nightWorld.out.filter(o=>o.inFrame&&o.delta!=null&&o.delta>BRIGHT_DELTA);
 check('十分-天燈可見度 找得到 sky-lantern-glow 節點（setVisible 真的切到光暈，不是切了個不存在的名字而靜默無效）',nightWorld.glowFound===true,{glowFound:nightWorld.glowFound});
 check('十分-天燈可見度 夜晚老街全景：畫面內且亮度明顯高於背景的天燈 ≥5 盞',
  nightWorldBright.length>=5,{count:nightWorldBright.length,canvas:[nightWorld.canvasW,nightWorld.canvasH],samples:nightWorld.out});

 await p.evaluate(()=>shifenPreview.setTime(0));await p.click('[data-view="train"]');
 const midDwellT=(T.phases.brake+T.phases.departAt)/2;
 await p.evaluate(t=>shifenPreview.setTime(t),midDwellT);
 const nightFollow=await sampleLanterns(),nightFollowBright=nightFollow.out.filter(o=>o.inFrame&&o.delta!=null&&o.delta>BRIGHT_DELTA);
 check('十分-天燈可見度 夜晚陪它走走、列車停在十分站時：畫面內且亮度明顯高於背景的天燈 ≥3 盞',
  nightFollowBright.length>=3,{count:nightFollowBright.length,time:midDwellT,canvas:[nightFollow.canvasW,nightFollow.canvasH],samples:nightFollow.out});

 await p.click('[data-period="day"]');await p.click('[data-view="world"]');await p.evaluate(()=>shifenPreview.setTime(40));
 const dayWorld=await sampleLanterns(),dayWorldTall=dayWorld.out.filter(o=>o.inFrame&&o.pxHeightAt1000>=HEIGHT_PX_MIN);
 check('十分-天燈可見度 白天老街全景：畫面內且投影高度 ≥8px（1000px 寬正規化）的天燈 ≥3 盞',
  dayWorldTall.length>=3,{count:dayWorldTall.length,canvas:[dayWorld.canvasW,dayWorld.canvasH],samples:dayWorld.out});

 check('十分 頁面無 JS／console 錯誤',errors.length===0,errors);
}finally{await b.close();}

const fails=results.filter(r=>!r.pass).length;
console.log(`\n共 ${results.length} 項，失敗 ${fails}`);
if(fails)process.exitCode=1;
