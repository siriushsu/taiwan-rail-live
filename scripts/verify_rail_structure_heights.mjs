// 橋隧種類與顯示高度的守門人（issue #57）。
//
// 為什麼要新增這一支：既有四道閘門對 2026-09-11 這三個缺陷全部是綠的。
//   verify_rail_levels 驗相鄰 offset 差與交會淨距——橋面離地 40 公尺完全合法，它不看絕對值。
//   verify_rail_tunnel_grade 驗隧道**內部**的顯示縱坡——洞口外面那段高架俯衝它管不到，
//     而且隧道一旦被誤判成橋就整個退出它的分母，缺陷會讓判準的樣本自己消失。
//   verify_rail_grounding 驗的是「有沒有多長出橋墩」，方向相反。
// 所以這一支專驗三件事：反向改判有沒有生效且有地形證據、橋面離地高度、洞口兩側有沒有俯衝。
// 2026-09-11 晚間再加 G6：露天段（高架與平面）的顯示縱坡在各系統上限內、共用節點的股道高程一致。
//
// 期望值來源都不是實作自己算出來的數：
//   反向改判查 data/rail_structures_official.json 的官方判定與 DEM 地形起伏（兩個都是外部來源），
//   橋面高度的正向對照拿「舊規則 rank×8」當對照組，洞口俯衝比的是同一條高架自己遠離洞口處的高度。
//
// 用法：node scripts/verify_rail_structure_heights.mjs
import fs from 'node:fs';
import {makePath} from '../rail-3d/integration/train-path.js';
import {openRailDem} from './lib/local_rail_dem.mjs';
const levels=JSON.parse(fs.readFileSync('rail-3d/physical/level-profiles.json')),E=levels.entries;
const official=JSON.parse(fs.readFileSync('data/rail_structures_official.json'));
const ways=[];for(const f of ['network.json','metro-network.json'])ways.push(...JSON.parse(fs.readFileSync('rail-3d/physical/'+f)).ways);
const failures=[],notes={};
const at=(e,s,key)=>{let i=0,j=e.distances.length-1;while(j-i>1){const m=(i+j)>>1;if(e.distances[m]<=s)i=m;else j=m;}const t=(s-e.distances[i])/(e.distances[j]-e.distances[i]||1);return e[key][i]*(1-t)+e[key][j]*t;};

// ── G1 反向改判：生效了，而且每一條都有地形證據 ─────────────────────
// 這一格（來源與官方互指橋／隧道）以前被單向規則永久擋著，是 issue #57 的直接根因。
const overrides=Object.entries(official.entries).filter(([,e])=>e.override);
const RELIEF=official.params.reliefM;
if(!(RELIEF>0))failures.push('G1 對照表沒有 params.reliefM，地形門檻不明');
if(overrides.length<10)failures.push(`G1 反向改判只有 ${overrides.length} 條，2026-09-11 全網路盤點是 13 條——規則可能被關掉了`);
for(const [id,e] of overrides){
 // 地形必須站在官方那一邊：判成隧道就要有山（起伏 ≥ 門檻），判成橋就不能有山。
 if((e.kind==='tunnel')!==(e.reliefM>=RELIEF))failures.push(`G1 ${id} 改判成 ${e.kind}，但地形起伏 ${e.reliefM}m 對門檻 ${RELIEF}m 不支持這個方向`);
 // 產物必須真的吃到改判。只傳 kind 不傳整條 entry 會讓這一批靜默失效，2026-09-11 就踩過一次。
 if(E[id]&&E[id].kind!==e.kind)failures.push(`G1 ${id} 對照表判 ${e.kind}，產物卻是 ${E[id].kind}——classify 沒收到整條 entry`);
}
// 具名回歸：issue #57 回報者在 24.2738,120.6643 z20 看到的那兩條，各 732 公尺，
// OSM 標 tunnel=yes layer=-2，官方涵蓋率 100% 判橋，DEM 中段只高出洞口 8.7／9.0 公尺。
for(const id of ['103397339','103397328']){
 if(E[id]?.kind!=='bridge')failures.push(`G1 ${id}（issue #57 現場）應為高架橋，實際 ${E[id]?.kind}`);
 if(E[id]?.officialOverride!=='tunnel')failures.push(`G1 ${id} 應留下被推翻的來源判定 tunnel，供日後回查`);
 if(E[id]&&Math.min(...E[id].offsets)<0)failures.push(`G1 ${id} 高架橋不該有負的離地高度，最低 ${Math.min(...E[id].offsets).toFixed(1)}m`);
}
notes.反向改判 = overrides.length;

// ── G2 橋面離地高度 ────────────────────────────────────────────────
// OSM 的 layer 對橋梁只是相交記帳，不是橋面高度。舊規則 rank×8 讓 layer=4 的高鐵高架橋
// 畫在離地 32 公尺、全網路最高 40 公尺，一條股道二十公里內爬上去再掉下來。
const MAX_BRIDGE_M=25;
let worst=0,worstId='',oldWorst=0,oldId='';
for(const [id,e] of Object.entries(E)){
 if(e.kind!=='bridge')continue;
 const hi=Math.max(...e.offsets);if(hi>worst){worst=hi;worstId=id;}
 const old=Math.abs(e.rank)*8;if(old>oldWorst){oldWorst=old;oldId=id;}
}
if(worst>MAX_BRIDGE_M)failures.push(`G2 橋面離地 ${worst.toFixed(1)}m > ${MAX_BRIDGE_M}m @ way ${worstId}`);
// 正向對照：不加這一條，G2 在任何「把高度壓平」的實作下都恆綠，量不到自己有沒有牙。
if(oldWorst<=MAX_BRIDGE_M)failures.push(`G2 正向對照失效：舊規則 rank×8 最高只有 ${oldWorst}m，沒超過門檻 ${MAX_BRIDGE_M}m，這條判準測不到東西`);
notes.橋面最高 = +worst.toFixed(1);notes.舊規則會到 = oldWorst;

// ── G3 洞口兩側不得俯衝 ────────────────────────────────────────────
// 山岳隧道被推到地表下固定深度時，8% 顯示過渡會把相鄰高架一路拖下來：洞口前約 60 公尺
// 從離地 8 公尺俯衝到 0.2 公尺，出洞再爬回去。高鐵 167 條隧道 way 就重複 167 次，
// 這就是回報者說的「一下橋樑一下地下道」。
const MAX_DIP_M=3,INWARD_M=200;
const nodeWays=new Map();
for(const w of ways)for(const n of w.nodes){const k=w.system+':'+n;if(!nodeWays.has(k))nodeWays.set(k,[]);nodeWays.get(k).push(w);}
// 量一條接上洞口的股道：它在洞口那一端，比它自己遠離洞口 200 公尺處低多少。
// 拿同一條股道自己的遠端當基準，不引入任何外部常數，也不會被整體抬高／壓低騙過去。
const dipOf=(oe,oi,last)=>{
 if(oi!==0&&oi!==last)return null;                       // 只量真的以端點接上洞口的股道
 const len=oe.distances.at(-1);if(len<INWARD_M/2)return null;  // 太短的接續段沒有「遠離洞口」可比
 const portalS=oi===0?0:len,inwardS=oi===0?Math.min(INWARD_M,len):Math.max(0,len-INWARD_M);
 return at(oe,inwardS,'offsets')-at(oe,portalS,'offsets');
};
let dipWorst=0,dipAt='',checked=0,ramps=0,portalEnds=0,adjacent=0,tunnelAdjacent=0,noEntry=0,tooShort=0;const checkedKinds={};
for(const w of ways){
 const e=E[w.id];if(e?.kind!=='tunnel'||e.boreKind!=='mountain')continue;
 for(const i of [0,w.nodes.length-1]){
  const node=w.nodes[i];portalEnds++;
  for(const o of nodeWays.get(w.system+':'+node)||[]){
   if(String(o.id)===String(w.id))continue;adjacent++;
   const oe=E[o.id];if(!oe){noEntry++;continue;}if(oe.kind==='tunnel'){tunnelAdjacent++;continue;}  // 高架與平面都要量：兩種接法都會被拖下去
   const oi=o.nodes.indexOf(node),last=o.nodes.length-1;
   // 平面段的遠端若接著高架橋，這一段就是上橋引道，那個爬升是它該有的樣子不是洞口俯衝：
   // 實測 12 條最深的全是「洞口 0.00 公尺 → 遠端 4.6 公尺接上高架」的百餘公尺連接段。
   const farNode=oi===0?o.nodes[last]:o.nodes[0];
   if(oe.kind!=='bridge'&&(nodeWays.get(o.system+':'+farNode)||[]).some(x=>String(x.id)!==String(o.id)&&E[x.id]?.kind==='bridge')){ramps++;continue;}
   const dip=dipOf(oe,oi,last);if(dip===null){tooShort++;continue;}
   checked++;checkedKinds[oe.kind]=(checkedKinds[oe.kind]||0)+1;if(dip>dipWorst){dipWorst=dip;dipAt=`way ${o.id}（${oe.kind}）接 ${w.id}`;}
  }
 }
}
if(dipWorst>MAX_DIP_M)failures.push(`G3 洞口旁股道俯衝 ${dipWorst.toFixed(1)}m > ${MAX_DIP_M}m（${dipAt}）`);
// 覆蓋率具名斷言：分母無聲縮水時（例如山岳隧道整批被誤判成橋）G3 會變成恆綠。
// 2026-09-12 實測（普查數字隨閘門一起印出，見 notes.洞口普查）：586 個山岳隧道洞口端點、614 個相鄰段，
// 扣掉鄰段也是隧道的 200 筆、上橋引道 134 筆、太短無法比對的 72 筆，實際列入判準 208 筆（高架 136、平面 72）。
// 09-11 露天段求解器補齊 entry 之前是 170 筆（平面 34）：差的 38 筆是原本沒有 entry 的平面 way。
// 同一批對象在修改前的產物上量：204 筆可量，180 筆超過門檻，最深 16 公尺。
if(checked<150)failures.push(`G3 只量到 ${checked} 處洞口銜接，分母異常縮水（2026-09-11 基準 170）`);
// 正向對照：G3 的合格值是 0，而「恰為 0」本身零資訊。餵一段真的俯衝八公尺的剖面進同一個
// 量法，確認它會紅；不放這一條，任何把量測寫壞成恆回 0 的實作都能矇混過關。
const dive={distances:[0,60,200,400],offsets:[.2,3,8,8]};
const control=dipOf(dive,0,3);
if(!(control>MAX_DIP_M))failures.push(`G3 正向對照失效：合成的八公尺俯衝只量到 ${control?.toFixed(1)}m，量法本身壞了`);
notes.洞口銜接 = checked;notes.洞口普查 = {洞口端點:portalEnds,相鄰段:adjacent,鄰段也是隧道:tunnelAdjacent,沒有entry:noEntry,上橋引道:ramps,太短:tooShort,列入:checkedKinds};notes.上橋引道 = ramps;notes.最大俯衝 = +dipWorst.toFixed(1);notes.對照組俯衝 = +control.toFixed(1);

// ── G4 隧道分類的分母 ──────────────────────────────────────────────
const bores={};for(const e of Object.values(E))if(e.boreKind)bores[e.boreKind]=(bores[e.boreKind]||0)+1;
if(!(bores.mountain>=250))failures.push(`G4 山岳隧道只有 ${bores.mountain||0} 條 way，地形分類可能整批失效`);
if(!(bores.subsurface>=350))failures.push(`G4 都市地下段只有 ${bores.subsurface||0} 條 way`);
notes.隧道分類 = bores;

// ── G5 穿透地表的地下軌道，只留淺的 ────────────────────────────────
// live-underground-3d 會清深度緩衝，畫在那一層的軌道看得穿地表。都市地下段要這個效果，
// 山岳隧道不能要：線會浮在幾百公尺外的山坡上。門檻寫在 map3d.js，這裡驗它仍然站得住。
const src=fs.readFileSync('rail-3d/integration/map3d.js','utf8');
const limit=Number(/SEE_THROUGH_COVER_M=(\d+(?:\.\d+)?)/.exec(src)?.[1]);
if(!(limit>0))failures.push('G5 map3d.js 找不到 SEE_THROUGH_COVER_M，穿透門檻不明');
else{
 const sysOf=new Map();
 for(const w of ways)sysOf.set(String(w.id),w.system);
 const tally={};
 for(const [id,e] of Object.entries(E)){
  if(e.kind!=='tunnel'||!e.terrainValues)continue;
  const sys=sysOf.get(id)||'?';const t=tally[sys]??={n:0,see:0,deep:0,deepSee:0};
  for(let i=0;i<e.terrainValues.length;i++){
   const cover=e.values[i]-e.offsets[i]-e.terrainValues[i],see=cover<=limit;
   t.n++;if(see)t.see++;
   if(cover>100){t.deep++;if(see)t.deepSee++;}
  }
 }
 const metro=['mrt','krtc','tymc','ntalrt','ntdlrt'].map(s=>tally[s]).filter(Boolean);
 const mn=metro.reduce((a,t)=>a+t.n,0),ms=metro.reduce((a,t)=>a+t.see,0);
 // 都市捷運地下段的透視是刻意保留的功能，門檻訂太嚴會先犧牲掉它。
 if(!(mn>3000))failures.push(`G5 捷運地下段只取到 ${mn} 個取樣點，分母異常縮水（2026-09-11 基準 12447）`);
 else if(ms/mn<.9)failures.push(`G5 捷運地下段只剩 ${(100*ms/mn).toFixed(1)}% 看得穿地表，低於 90%——門檻把該留的也砍掉了`);
 // 反向：覆土超過 100 公尺的一定要被擋下來，否則就是那條規則沒生效。
 const deep=Object.values(tally).reduce((a,t)=>a+t.deep,0),deepSee=Object.values(tally).reduce((a,t)=>a+t.deepSee,0);
 if(!(deep>2000))failures.push(`G5 覆土超過 100m 的取樣點只有 ${deep} 個，分母異常縮水（2026-09-11 基準 5785）`);
 if(deepSee)failures.push(`G5 有 ${deepSee} 個覆土超過 100m 的取樣點仍會穿透地表`);
 notes.穿透門檻 = limit+'m';notes.捷運仍穿透 = +(100*ms/mn).toFixed(1)+'%';notes.深層仍穿透 = deepSee;
}

// ── G6 露天段顯示縱坡與接縫 ────────────────────────────────────────
// 舊做法橋面＝執行期地表＋層位，DEM 的每一個起伏都複製到橋面上（高鐵橋面最陡 67.7%、臺鐵 117.6%），
// 平面軌道直接踩 20 公尺 DTM 的雜訊。露天段求解器之後每條 way 都有 terrainValues：顯示縱坡在各系統
// 上限內，共用節點的股道（含隧道洞口）在該節點的高程一致。
// 期望值來源：縱坡上限取各系統的工程慣例（臺鐵高鐵 2.5%、林鐵 6%、捷運 4%），乘 1.6 容忍節點間
// Hermite 內插的過衝；分母取 network.json／metro-network.json 的 way 清單與節點，不是產物自己。
const GRADE_LIMIT={tra_sched:.025,thsr_sched:.025,afr_sched:.06},gradeLimit=s=>GRADE_LIMIT[s]??.04,GRADE_TOL=1.6;
const maxGrade=(e,key)=>{const h=e[key],D=e.distances;let g=0;for(let i=1;i<D.length;i++){const ds=D[i]-D[i-1];if(ds>=10)g=Math.max(g,Math.abs(h[i]-h[i-1])/ds);}return g;};
// 覆蓋率具名斷言：每一條 way 都要有顯示縱坡，少一條就是求解器漏了它。
const missing=ways.filter(w=>!E[w.id]?.terrainValues);
if(missing.length)failures.push(`G6 有 ${missing.length} 條 way 沒有顯示縱坡（例如 ${missing.slice(0,3).map(w=>w.system+'/'+w.id).join('、')}）`);
if(ways.length<4500)failures.push(`G6 路網只有 ${ways.length} 條 way，分母異常縮水（2026-09-11 基準 5008）`);
const steepest={};
for(const w of ways){const e=E[w.id];if(!e?.terrainValues||e.kind==='tunnel')continue;const g=maxGrade(e,'terrainValues');if(!steepest[w.system]||g>steepest[w.system].g)steepest[w.system]={g,id:w.id};}
for(const [s,{g,id}] of Object.entries(steepest))if(g>gradeLimit(s)*GRADE_TOL)failures.push(`G6 ${s} 露天段顯示縱坡 ${(100*g).toFixed(1)}% > ${(100*gradeLimit(s)*GRADE_TOL).toFixed(1)}% @ way ${id}`);
// 正向對照一：同一把尺量「地表＋層位」的原始剖面（values），高鐵與臺鐵都必須超標，否則這把尺量不到東西。
for(const s of ['thsr_sched','tra_sched']){let g=0;for(const w of ways){const e=E[w.id];if(w.system!==s||!e||e.kind==='tunnel')continue;g=Math.max(g,maxGrade(e,'values'));}
 if(!(g>gradeLimit(s)*GRADE_TOL))failures.push(`G6 正向對照失效：${s} 原始剖面最陡只有 ${(100*g).toFixed(1)}%，沒超過門檻`);}
// 正向對照二：合成一段 10% 的剖面餵同一個函式。
if(!(maxGrade({distances:[0,100,200],terrainValues:[0,10,10]},'terrainValues')>.04*GRADE_TOL))failures.push('G6 正向對照失效：合成的 10% 縱坡沒被量到');
// 接縫：同系統共用節點的股道在該節點的顯示高程要一致（含洞口：隧道的 terrainValues 必須接到露天段）。
const junctionSteps=(entries,wayList)=>{const byNode=new Map();
 for(const w of wayList){const e=entries[w.id];if(!e?.terrainValues)continue;for(const i of [0,w.nodes.length-1]){const k=w.system+':'+w.nodes[i],s=i===0?0:e.distances.at(-1);if(!byNode.has(k))byNode.set(k,[]);byNode.get(k).push(at(e,s,'terrainValues'));}}
 let n=0,worst=0,worstNode='';for(const [k,hs] of byNode){if(hs.length<2)continue;n++;const step=Math.max(...hs)-Math.min(...hs);if(step>worst){worst=step;worstNode=k;}}return {n,worst,worstNode};};
const seams=junctionSteps(E,ways);
if(seams.n<3500)failures.push(`G6 只找到 ${seams.n} 個共用節點，分母異常縮水（2026-09-11 基準 4145）`);
if(seams.worst>.5)failures.push(`G6 接縫落差 ${seams.worst.toFixed(2)}m > 0.5m @ ${seams.worstNode}`);
// 正向對照三：兩條 way 共用一個節點但高程差三公尺，同一個函式要量得到。
const seamControl=junctionSteps({a:{distances:[0,100],terrainValues:[10,10]},b:{distances:[0,100],terrainValues:[13,13]}},[{id:'a',system:'x',nodes:['n1','n2']},{id:'b',system:'x',nodes:['n2','n3']}]);
if(!(seamControl.worst>.5))failures.push('G6 正向對照失效：合成的三公尺接縫沒被量到');
// 平滑層有沒有在跑：只驗縱坡上限抓不到「平滑被拿掉」（縱坡內的雜訊一公尺上下仍會原封穿過去）。
// 拿每條 way 的「爬升＋下降減淨高差」當起伏量，高鐵與臺鐵的高架橋顯示剖面必須不到原始剖面的三成
//（2026-09-11 實測：高鐵 2.5 vs 12.0 公尺/公里、臺鐵 3.6 vs 14.8；沒有平滑層時是 4.5 與 5.4，比值 .37／.36）。
const excessOf=(e,key)=>{const h=e[key];let climb=0;for(let i=1;i<h.length;i++)climb+=Math.abs(h[i]-h[i-1]);return climb-Math.abs(h.at(-1)-h[0]);};
for(const s of ['thsr_sched','tra_sched']){let shown=0,raw=0;for(const w of ways){const e=E[w.id];if(w.system!==s||e?.kind!=='bridge'||!e.terrainValues)continue;shown+=excessOf(e,'terrainValues');raw+=excessOf(e,'values');}
 if(!(raw>0))failures.push(`G6 ${s} 高架橋原始剖面起伏為 0，比值無從計算`);
 else if(shown/raw>.3)failures.push(`G6 ${s} 高架橋顯示剖面的起伏是原始剖面的 ${(100*shown/raw).toFixed(0)}%，超過三成——平滑層沒在跑`);
 notes['起伏比_'+s]=+(shown/raw).toFixed(2);}
// G6e 平面段不埋進地形：節點每 100 公尺一個，節點之間的 DEM 突起沒被任何節點看到，2026-09-12 修前實測臺鐵平面段
// 19.6 公里低於原始 DEM 逾 .5 公尺（5.2 公里逾 1 公尺）；埋在地形底下的軌道畫了也看不見。每 10 公尺取一次原始 DEM
// （rail-3d/terrain 的 z12 圖磚，與 MapLibre 同一份），只算平面段（隧道本來就在地下、高架離地另有 G3 管）。
// 門檻 .1 公里：修後全網 0.00 公里；正向對照兩個——修前那份產物（28b0fc8b）要紅在 19.6 公里，合成「整段壓低 2 公尺」要被量到。
const dem=openRailDem(new URL('../',import.meta.url)),shownAt=(e,s)=>{let i=0,j=e.distances.length-1;while(j-i>1){const m=(i+j)>>1;if(e.distances[m]<=s)i=m;else j=m;}const t=Math.max(0,Math.min(1,(s-e.distances[i])/(e.distances[j]-e.distances[i]||1)));return e.terrainValues[i]*(1-t)+e.terrainValues[j]*t;};
let buriedKm=0,checkedKm=0;const buriedBy={};
for(const w of ways){const e=E[String(w.id)];if(!e?.terrainValues||e.kind!=='surface')continue;const path=makePath(w.coordinates);
 for(let s=5;s<path.length;s+=10){const g=await dem.ground(path.at(s).coordinate);if(!Number.isFinite(g))continue;checkedKm+=.01;if(shownAt(e,s)<g-.5){buriedKm+=.01;buriedBy[w.system]=+((buriedBy[w.system]||0)+.01).toFixed(2);}}}
if(checkedKm<1500)failures.push(`G6 平面段取樣只有 ${checkedKm.toFixed(0)} 公里，分母異常縮水（2026-09-12 基準約 1630）`);
if(buriedKm>.1)failures.push(`G6 平面段有 ${buriedKm.toFixed(2)} 公里埋在地形底下逾 .5 公尺（${JSON.stringify(buriedBy)}）`);
{const w=ways.find(w=>E[String(w.id)]?.kind==='surface'&&E[String(w.id)].terrainValues),e=E[String(w.id)],fake={...e,terrainValues:e.terrainValues.map(v=>v-2)},path=makePath(w.coordinates);let hit=0;
 for(let s=5;s<path.length;s+=10){const g=await dem.ground(path.at(s).coordinate);if(Number.isFinite(g)&&shownAt(fake,s)<g-.5)hit++;}
 if(!hit)failures.push(`G6 正向對照失效：平面 way ${w.id} 整段壓低 2 公尺沒被量到`);}
notes.平面埋沒公里 = +buriedKm.toFixed(2);notes.平面取樣公里 = +checkedKm.toFixed(0);
notes.露天縱坡最陡 = Object.fromEntries(Object.entries(steepest).map(([s,{g}])=>[s,(100*g).toFixed(1)+'%']));notes.接縫 = seams.n;notes.接縫最大落差 = +seams.worst.toFixed(2);


// ── G7 隧道要有證據：layer<0 不算 ──────────────────────────────────
// 2026-09-12 回報兩處「平地上立著一個洞口」：縱貫線中洲–大湖與宜蘭線牡丹。兩處的來源標記
// 都只有 layer=-1／-2、沒有 tunnel=yes，兩端接的還都是橋——OSM 用 layer 記「有東西從上面跨過去」，
// 被當成了隧道。症狀有兩個：洞口憑空出現，以及整段軌道被當成地下段而完全不畫（雙線只剩一條）。
// structure-kind.js 檔頭早就寫明「layer 不能單獨作為結構的證據」，橋的方向照做了，隧道沒有。
// 修法在 build_rail_levels.mjs：沒有明示標記的隧道段，要 DEM 地形起伏站得住腳才留。
// 這一條驗的是修法還在，而且**期望值不取產物自己算的 reliefM**（同源等於零資訊）——
// 這裡拿 DEM 重算一次，門檻直接從 build_rail_levels.mjs 的原始碼讀，不另抄一份常數。
{
 const src=fs.readFileSync('scripts/build_rail_levels.mjs','utf8');
 const RELIEF=Number(/MOUNTAIN_RELIEF_M=(\d+(?:\.\d+)?)/.exec(src)?.[1]);
 if(!(RELIEF>0))failures.push('G7 build_rail_levels.mjs 找不到 MOUNTAIN_RELIEF_M，山岳門檻不明');
 else{
  const officialKindOf=id=>official.entries[id]?.kind;
  const evidenceOf=w=>w.tags?.tunnel==='yes'||w.tags?.location==='underground'||officialKindOf(String(w.id))==='tunnel';
  const tunnelWay=w=>E[String(w.id)]?.kind==='tunnel';
  const byNode=new Map();for(const w of ways)for(const n of w.nodes){const k=w.system+':'+n;if(!byNode.has(k))byNode.set(k,[]);byNode.get(k).push(w);}
  // 與 build_rail_levels.mjs 同一套取樣：沿線每 50 公尺一點，基準取各洞口節點的地表平均。
  const reliefOf=async run=>{
   const member=new Set(run.map(w=>String(w.id))),grounds=[],portalGround=[];
   for(const w of run){const path=makePath(w.coordinates),len=path.length,n=Math.max(4,Math.min(240,Math.round(len/50)));
    for(let i=0;i<=n;i++){const g=await dem.ground(path.at(Math.min(len*i/n,len-1e-3)).coordinate);if(Number.isFinite(g))grounds.push(g);}
    for(const i of [0,w.nodes.length-1])if((byNode.get(w.system+':'+w.nodes[i])||[]).some(o=>!member.has(String(o.id)))){
     const g=await dem.ground(w.coordinates[i]);if(Number.isFinite(g))portalGround.push(g);}}
   if(!grounds.length)return null;
   const base=portalGround.length?portalGround.reduce((a,b)=>a+b,0)/portalGround.length:Math.min(...grounds);
   return Math.max(...grounds)-base;
  };
  const placed=new Set(),runs=[];
  for(const w of ways){if(!tunnelWay(w)||placed.has(String(w.id)))continue;
   const stack=[w],run=[];placed.add(String(w.id));
   while(stack.length){const cur=stack.pop();run.push(cur);
    for(const n of cur.nodes)for(const o of byNode.get(cur.system+':'+n)||[])if(tunnelWay(o)&&!placed.has(String(o.id))){placed.add(String(o.id));stack.push(o);}}
   runs.push(run);}
  let noEvidence=0,bad=[];
  for(const run of runs){
   if(run.some(evidenceOf))continue;
   noEvidence++;
   const relief=await reliefOf(run);
   if(relief===null||relief<RELIEF)bad.push(`${run[0].system}/${run.map(w=>w.id).join('+')} 起伏 ${relief===null?'?':relief.toFixed(1)}m`);
  }
  // 分母具名斷言。修好之後「整段都沒有明示標記」的連續段是 0（那正是合格的樣子），所以分母不能拿它，
  // 要拿**自己沒有明示標記、靠同段鄰居的標記留下來**的 way：那才是這條規則實際在裁決的對象。
  // 2026-09-12 實測：324→338 段（改判後拆出新的獨立段），靠鄰居留下的 way 恰好 2 條——
  // 宜蘭線 1181895950 與臺東線 1021846211，兩條都只有 layer=-1／-2、卻真的在穿山。
  // 這兩條就是下面具名回歸的對象；數字掉到 0 代表規則把它們一起砍了。
  const ridingOnNeighbour=ways.filter(w=>tunnelWay(w)&&!evidenceOf(w)).length;
  if(runs.length<300)failures.push(`G7 隧道連續段只有 ${runs.length} 段，分母異常縮水（2026-09-12 基準 338）`);
  if(ridingOnNeighbour<2)failures.push(`G7 只有 ${ridingOnNeighbour} 條隧道 way 是靠鄰居的標記留下來的，這條規則的作用面消失了（2026-09-12 基準 2）`);
  if(bad.length)failures.push(`G7 有 ${bad.length} 段隧道既無明示標記、DEM 也找不到山（${bad.slice(0,4).join('、')}）`);
  // 具名回歸：2026-09-12 回報的兩處改判成平面，而同樣只有 layer=-2、但真的穿山的三貂嶺那段留著。
  for(const id of ['213099735','193939712'])
   if(E[id]?.kind!=='surface')failures.push(`G7 ${id}（2026-09-12 回報現場）應改判成平面，實際 ${E[id]?.kind}`);
  for(const id of ['1181895950','1021846211'])
   if(E[id]?.kind!=='tunnel')failures.push(`G7 ${id}（只有 layer、但 DEM 有山）應維持隧道，實際 ${E[id]?.kind}`);
  // 正向對照：拿一條**確定在平地**的 way 餵同一個量法，它必須量到接近 0 的起伏。
  // 對照組不可以挑「已被改判的段」——那是被驗實作自己的產物，同源等於零資訊，而且規則被關掉時
  // 對照組會跟著消失（實測：關掉改判後這一條只會說「找不到對照」，看不出量法有沒有壞）。
  // 取臺中線后里那條 103 公尺的道路下穿段（DEM 起伏 0.1m），它在平原上，改判與否都存在。
  const CONTROL_ID='747411508',flatWay=ways.find(w=>String(w.id)===CONTROL_ID);
  const control=flatWay?await reliefOf([flatWay]):null;
  if(control===null)failures.push(`G7 正向對照失效：找不到對照 way ${CONTROL_ID}（來源重切了？換一條平原上的 way）`);
  else if(control>=RELIEF)failures.push(`G7 正向對照失效：平原上的 way ${CONTROL_ID} 量到起伏 ${control.toFixed(1)}m，量法沒有分辨力`);
  notes.隧道段 = runs.length;notes.整段無明示標記 = noEvidence;notes.靠鄰居留下的way = ridingOnNeighbour;notes.平地假隧道 = bad.length;
  notes.對照組平地起伏 = control===null?null:+control.toFixed(1);
 }
}

console.log(notes);
if(failures.length){console.log(failures);process.exit(1);}
console.log('橋隧種類與顯示高度：反向改判、橋面高度、洞口銜接、分類分母、穿透門檻、露天縱坡、接縫、平面埋沒與隧道證據皆通過');
