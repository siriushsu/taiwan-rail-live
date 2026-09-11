// 橋隧種類與顯示高度的守門人（issue #57）。
//
// 為什麼要新增這一支：既有四道閘門對 2026-09-11 這三個缺陷全部是綠的。
//   verify_rail_levels 驗相鄰 offset 差與交會淨距——橋面離地 40 公尺完全合法，它不看絕對值。
//   verify_rail_tunnel_grade 驗隧道**內部**的顯示縱坡——洞口外面那段高架俯衝它管不到，
//     而且隧道一旦被誤判成橋就整個退出它的分母，缺陷會讓判準的樣本自己消失。
//   verify_rail_grounding 驗的是「有沒有多長出橋墩」，方向相反。
// 所以這一支專驗三件事：反向改判有沒有生效且有地形證據、橋面離地高度、洞口兩側有沒有俯衝。
//
// 期望值來源都不是實作自己算出來的數：
//   反向改判查 data/rail_structures_official.json 的官方判定與 DEM 地形起伏（兩個都是外部來源），
//   橋面高度的正向對照拿「舊規則 rank×8」當對照組，洞口俯衝比的是同一條高架自己遠離洞口處的高度。
//
// 用法：node scripts/verify_rail_structure_heights.mjs
import fs from 'node:fs';
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
let dipWorst=0,dipAt='',checked=0,ramps=0;
for(const w of ways){
 const e=E[w.id];if(e?.kind!=='tunnel'||e.boreKind!=='mountain')continue;
 for(const i of [0,w.nodes.length-1]){
  const node=w.nodes[i];
  for(const o of nodeWays.get(w.system+':'+node)||[]){
   if(String(o.id)===String(w.id))continue;
   const oe=E[o.id];if(!oe||oe.kind==='tunnel')continue;  // 高架與平面都要量：兩種接法都會被拖下去
   const oi=o.nodes.indexOf(node),last=o.nodes.length-1;
   // 平面段的遠端若接著高架橋，這一段就是上橋引道，那個爬升是它該有的樣子不是洞口俯衝：
   // 實測 12 條最深的全是「洞口 0.00 公尺 → 遠端 4.6 公尺接上高架」的百餘公尺連接段。
   const farNode=oi===0?o.nodes[last]:o.nodes[0];
   if(oe.kind!=='bridge'&&(nodeWays.get(o.system+':'+farNode)||[]).some(x=>String(x.id)!==String(o.id)&&E[x.id]?.kind==='bridge')){ramps++;continue;}
   const dip=dipOf(oe,oi,last);if(dip===null)continue;
   checked++;if(dip>dipWorst){dipWorst=dip;dipAt=`way ${o.id}（${oe.kind}）接 ${w.id}`;}
  }
 }
}
if(dipWorst>MAX_DIP_M)failures.push(`G3 洞口旁股道俯衝 ${dipWorst.toFixed(1)}m > ${MAX_DIP_M}m（${dipAt}）`);
// 覆蓋率具名斷言：分母無聲縮水時（例如山岳隧道整批被誤判成橋）G3 會變成恆綠。
// 2026-09-11 實測：586 個山岳隧道洞口端點、614 個相鄰段，扣掉鄰段也是隧道的 250 筆、
// 上橋引道 134 筆、太短無法比對的 60 筆，實際列入判準 170 筆（高架 136、平面 34）。
// 同一批對象在修改前的產物上量：204 筆可量，180 筆超過門檻，最深 16 公尺。
if(checked<150)failures.push(`G3 只量到 ${checked} 處洞口銜接，分母異常縮水（2026-09-11 基準 170）`);
// 正向對照：G3 的合格值是 0，而「恰為 0」本身零資訊。餵一段真的俯衝八公尺的剖面進同一個
// 量法，確認它會紅；不放這一條，任何把量測寫壞成恆回 0 的實作都能矇混過關。
const dive={distances:[0,60,200,400],offsets:[.2,3,8,8]};
const control=dipOf(dive,0,3);
if(!(control>MAX_DIP_M))failures.push(`G3 正向對照失效：合成的八公尺俯衝只量到 ${control?.toFixed(1)}m，量法本身壞了`);
notes.洞口銜接 = checked;notes.上橋引道 = ramps;notes.最大俯衝 = +dipWorst.toFixed(1);notes.對照組俯衝 = +control.toFixed(1);

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

console.log(notes);
if(failures.length){console.log(failures);process.exit(1);}
console.log('橋隧種類與顯示高度：反向改判、橋面高度、洞口銜接、分類分母、穿透門檻皆通過');
