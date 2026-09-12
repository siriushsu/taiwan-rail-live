import {createPhysicalMotion} from './motion.js';
import {createMetroPhysicalMotion} from './metro-motion.js';
import {bindPortalPaths} from './portal-paths.js';
import {createDisplayLevelLookup} from './display-level.js';
// 這裡的股道幾何與各系統既有的示意線形必須對得上,對不上的系統一律沿用原定位
// ——與本模組既有的「班表簽章不符時沿用原始定位」同一條原則,寧可不套也不要套錯。
//
// afr_sched(阿里山林鐵)目前對不上,實測(2026-09-07,11:00 全網掃描):
//   · 台鐵 130 班在跑、125 班走股道定位,離示意線形 >50m 者 0 班 ⇒ 兩邊幾何一致,照常使用。
//   · 林鐵停靠中的 39(阿里山)與 105(神木)離**所有**線形 94m/164m。神木一站兩邊差 163m
//     (OSM 股道 vs data/afr.json),兩份資料各自內部自洽,要判誰對得有官方營業里程才行。
// 而 2D 地圖畫的一律是 state.trackLines(示意線形,index.html 從不讀股道幾何),於是林鐵會出現
// 「車不在自己那條線上」。單線 762mm 登山鐵道本來也沒有股道可分流,套了沒有收益卻有這個代價。
// 兩邊幾何對齊之後把 afr_sched 從這裡拿掉即可恢復,不必動 motion.js。
const PHYSICAL_SYSTEMS=['tra_sched','thsr_sched'];
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
