import {createPhysicalMotion} from './motion.js';
import {createMetroPhysicalMotion} from './metro-motion.js';
import {bindPortalPaths} from './portal-paths.js';
import {createDisplayLevelLookup} from './display-level.js';
// 這裡的股道幾何與各系統既有的示意線形必須對得上,對不上的系統一律沿用原定位
// ——與本模組既有的「班表簽章不符時沿用原始定位」同一條原則,寧可不套也不要套錯。
//
// afr_sched(阿里山林鐵)2026-09-08 曾被移出這份名單:當時停靠中的 39(阿里山)、105(神木)離
// **所有**畫出來的線 94m/164m(bf454d16),而 2D 地圖畫的一律是 state.trackLines(示意線形,
// index.html 從不讀股道幾何),那兩班車在任何倍率都不在自己那條線上。同一晚 939405bc 把缺的線
// 補齊(build_afr_station_tracks.mjs 產 8 條站內股道,同時進 data/afr.json 與
// data/track_lines.geojson),當時寫下的復原條件是「兩邊幾何對齊之後加回來」。
// 2026-09-12 確認條件已達成,加回:
//   · check-afr 具名斷言「37 個實體停靠點都在畫得出來的軌道上(>50m 者:無)」,並附控制組
//     「只用營業線時有 5 個停靠點離線 >50m」⇒ 該紅的時候真的會紅。
//   · 官方 21 個站點也都在畫得出來的軌道上,餘裕最小的北門 44m、嘉義 43m(仲裁來源非同源:
//     用 TDX 自己的站座標驗 TDX 自己的線形)。
//   · network.json 有 169 條 afr way,阿里山近景視野內 16 條 ⇒ 抽掉示意線形之後真的換得出
//     東西,不會重演 v0908a 那次「放大後整條軌道消失」;H 段判準同輪從「林鐵不該被抽換」
//     改成正向量「抽掉幾條、換回幾條」。
// 加回來的另一半收益:motion.js/timing.js/turnbacks.js 那組之字形折返的股道邏輯在名單外時
// covered() 恆 false、執行期一次都不會被呼叫到,現在才真的生效。
const PHYSICAL_SYSTEMS=['tra_sched','thsr_sched','afr_sched'];
export async function loadPhysicalMotion(){
 const json=async file=>{const r=await fetch(new URL(file,import.meta.url));if(!r.ok)throw Error('股道資料載入失敗');return r.json();};
 const [network,profiles,dispatch,metroNetwork,metroProfiles,levels]=await Promise.all(['network.json','display-profiles.json','dispatch.json','metro-network.json','metro-display-profiles.json','level-profiles.json'].map(json));
 for(const p of [profiles,metroProfiles])for(const [id,e]of Object.entries(p.entries))e.level=levels.entries[id]||null;
 const motion=createPhysicalMotion(network,profiles,dispatch),metro=createMetroPhysicalMotion(metroNetwork,metroProfiles);
 let displayLevelLookup=null,portalPaths=null;
 let visibleCache=null;const boxes=new WeakMap();
 function visibleRoutes(lines,bounds){const west=bounds.getWest()-.006,east=bounds.getEast()+.006,south=bounds.getSouth()-.006,north=bounds.getNorth()+.006,systems=new Map();
  for(const line of lines){const sys=line.systemId;if(PHYSICAL_SYSTEMS.includes(sys)&&!systems.has(sys))systems.set(sys,line.color);}
  const key=[...systems].flat().join(':');
  if(visibleCache?.key===key&&west>=visibleCache.west&&east<=visibleCache.east&&south>=visibleCache.south&&north<=visibleCache.north)return visibleCache.result;
  const area={west:west-.006,east:east+.006,south:south-.006,north:north+.006};
  const result=[...systems].flatMap(([sys,color])=>motion.geometry.drawingWays(sys,color)).filter(r=>{let b=boxes.get(r);if(!b){b=[Infinity,Infinity,-Infinity,-Infinity];for(const c of r.coordinates){b[0]=Math.min(b[0],c[0]);b[1]=Math.min(b[1],c[1]);b[2]=Math.max(b[2],c[0]);b[3]=Math.max(b[3],c[1]);}boxes.set(r,b);}return b[0]<=area.east&&b[2]>=area.west&&b[1]<=area.north&&b[3]>=area.south;});visibleCache={key,...area,result};return result;
 }
 // 未涵蓋的系統:sample 回 undefined(呼叫端既有的「沒有股道資料」訊號,會落回 posAlongShape)、
 // has 回 false(讓 blockHoldSec 等既有行為照舊)。motion 本身不動,離線驗證腳本語意不變。
 const covered=tr=>PHYSICAL_SYSTEMS.includes(tr.sys||tr.system);
 // systems 是這份白名單的**唯一**出處:rail-3d.js 決定「哪些線要把示意線形換成實體股道」時要讀它。
 // 兩邊各留一份的話,名單一改就會出現「宣告換圖、卻沒有東西可換」的空窗——線直接消失。
 // portals＝建置時算好的洞口位置與朝向（[經度,緯度,朝洞內方位角,系統]）。算繪端只取樣有車在跑的
 // 股道，沒車的隧道一個洞口都取樣不到，所以這份要隨產物出去。
 return {...motion,metro,dispatch,visibleRoutes,systems:PHYSICAL_SYSTEMS,portals:levels.portals||[],
  get portalPaths(){return portalPaths||(portalPaths=bindPortalPaths(levels.portals||[],[motion.geometry,metro.geometry]));},
  displayLevelAt(system,coordinate,angle){if(!displayLevelLookup)displayLevelLookup=createDisplayLevelLookup(network.ways,motion.geometry.levelAt);return displayLevelLookup(system,coordinate,angle);},
  sample:(tr,...rest)=>covered(tr)?motion.sample(tr,...rest):undefined,
  has:tr=>covered(tr)&&motion.has(tr)};
}
