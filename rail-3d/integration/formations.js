// 原有程序式外觀另存 v2；編組依可辨識的車型／路線規格，不猜當班派車。來源：FORMATIONS.md。
const repeat=(n,x)=>Array(n).fill(x);
const spec=(id,lengths,widthM,quality='車型標準編組',extra={})=>({id,lengths,widthM,quality,countBasis:'standard',lengthKnown:true,...extra});
const approximate={lengthKnown:false};
const unknown=(id,lengths,widthM)=>spec(id,lengths,widthM,'當班編組待確認',{countBasis:'unknown',lengthKnown:false});
// 推估編組：節數有出處，但班表分不出當班是哪一代車／掛幾組，所以不是當班實測值。
// 逐條出處、信心與重驗期限寫在 FORMATIONS.md；閘門 verify_formations.mjs 有獨立的一桶在守。
const estimated=(id,lengths,widthM,quality)=>spec(id,lengths,widthM,quality,{countBasis:'estimated',lengthKnown:false});
export const FORMATIONS={
  '700t':spec('700t',[27,...repeat(10,25),27],3.38),
  emu3000:spec('emu3000',[21.35,...repeat(10,20.3),21.35],2.91),
  taroko:spec('temu1000',repeat(8,21),2.9,'車型標準 8 節；長度暫用近似值',approximate),
  puyuma:spec('temu2000',[22.095,...repeat(6,20.7),22.095],2.9),
  // 前後各一部 E1000＋12 節客車。台鐵官方售票說明寫「PP推拉式自強號第12車親子車廂」，
  // 班表車種名也出現「自強(PP障12)」，兩邊都指向 12 節客車；長度仍是近似值。
  pp:spec('e1000',[17.4,...repeat(12,20),17.4],2.9,'車型標準編組：前後機車＋12 節客車；長度暫用近似值',approximate),
  dr1000:estimated('dr1000',repeat(3,20),2.8,'支線柴聯車平日 2~3 輛，假日加掛 1 輛；班表看不出當班輛數，取平日常態 3 輛'),
  dr3100:estimated('dr3100',repeat(3,20),2.9,'柴聯自強固定 3 輛一組，連假最多 5 組重聯；班表看不出當班組數，取單組 3 輛'),
  // 🔴 區間車（推估 8 輛／160 公尺）與莒光（8 輛客車＋機車／177 公尺）的節數其實查得到出處
  //    （FORMATIONS.md〈推估編組〉），刻意還留在「待確認」的 3 節：實體股道的派車表是用 60 公尺
  //    車身解出來的，照真長畫會讓兩列車互穿。2026-09-12 晚間在月台修好之後**重量過**：
  //    A 類 5→9、A′ 類 19→31，verify_physical_no_overlap 的 G2 與 G7 當場紅（B 類 49→49 不動，
  //    因為 B 與車長無關）。也就是說**月台修復沒有把長度解鎖**，這是量出來的不是推的。
  //    要解鎖得先處理 A／A′ 那族（單線區間的放行，要裁示），FORMATIONS.md 有現況與已走死的路。
  commuter:unknown('emu800',repeat(3,20),2.9),
  chukuang:unknown('e200',[17,20,20],2.9),
  blue:unknown('blue',[17,20,20],2.9),
  haifeng:unknown('haifeng',repeat(3,20),2.9),
  shanlan:unknown('shanlan',repeat(3,20),2.9),
  mingri:unknown('mingri',[17,20,20],2.9),
  // 環島之星＝電力機車牽引＋莒光號 10500／10600 改造客車，不是自走式電聯車；機車世代 2025-07 起
  // 換 E500。節數維持未知：目前只有旅遊媒體寫「6 節」，沒有官方依據，不拿它當標準編組。
  star:unknown('e500',[17,20,20],2.9),
  forest:unknown('dl25',[10,12,12],2),
  wenhu:spec('wenhu',repeat(4,13.78),2.54,'路線標準編組'),
  c321:spec('c321',repeat(6,23.5),3.2,'路線標準編組'),
  c381:spec('c381',repeat(6,23.5),3.2,'路線標準編組'),
  'metro-short':spec('c381',repeat(3,23.5),3.2,'支線標準編組'),
  y100:spec('y100',repeat(4,68.4/4),2.65,'路線標準編組；單車均分示意'),
  sanying:spec('sanying',repeat(2,17.5),2.6,'路線標準編組；單車均分示意'),
  taichung:spec('taichung',repeat(2,22.17),2.98,'路線標準編組'),
  kaohsiung:spec('kaohsiung',repeat(3,65.45/3),3.15,'路線標準編組；單車均分示意'),
  airportlocal:spec('airportlocal',repeat(4,82/4),3.03,'普通車標準編組；總長約 82 m，單車均分'),
  airportexpress:spec('airportexpress',repeat(5,102/5),3.03,'直達車標準編組；總長約 102 m，單車均分'),
  airportunknown:unknown('airportlocal',repeat(3,20.5),3.03),
  danhai:spec('danhai',repeat(5,34.45/5),2.65,'路線標準 5 分節；單節長度示意',{articulated:true}),
  ankeng:spec('ankeng',repeat(5,34.45/5),2.65,'路線標準 5 分節；單節長度示意',{articulated:true}),
  caf:spec('caf',repeat(5,34/5),2.65,'路線標準 5 分節；CAF 代表外觀、長度約值',{articulated:true}),
};
function baseFormation(v){
  if(v.systemId==='thsr_sched')return FORMATIONS['700t'];
  if(v.systemId==='tra_sched'){
    const cn=v.carName||'',stock=v.stockId;
    // 名冊有固定車次的具名列車都要在這裡有一列，漏一列就默默退到下面的 emu800 代表外觀
    // （2026-07-25 環島之星補了 trainNos、這裡沒跟上，它就被畫成通勤電聯車七週）。
    // 山海號／平原號是本站虛構的環島觀光列車（兄弟車，在枋寮擦肩），沿用鳴日號那組機車＋
    // 觀景客車外觀——鳴日號本身無固定車次，這個外觀沒有任何實際班次在用，不會撞到真車。
    const named={'blue-train':'blue',haifeng:'haifeng',shanlan:'shanlan',mingri:'mingri',
      star:'star',shanhai:'mingri',pingyuan:'mingri'}[v.namedId];if(named)return FORMATIONS[named];
    if(stock==='emu3000'||/^自強\(3000|^110[KM]$/.test(cn))return FORMATIONS.emu3000;
    if(stock==='taroko'||cn.includes('(太,'))return FORMATIONS.taroko;
    if(stock==='puyuma'||cn.includes('(普,'))return FORMATIONS.puyuma;
    if(stock==='pp'||cn.includes('(PP'))return FORMATIONS.pp;
    if(stock==='dr3100'||cn.includes('(D31'))return FORMATIONS.dr3100;
    if(stock==='chukuang'||/莒光|普通車/.test(cn))return FORMATIONS.chukuang;
    if(/區間/.test(cn)&&['pingxi','shenao','jiji','neiwan'].includes(v.branchId))return FORMATIONS.dr1000;
    return FORMATIONS.commuter;
  }
  if(v.systemId==='afr_sched')return FORMATIONS.forest;
  if(['mrt','trtc'].includes(v.systemId)){
    if(v.routeId==='BR')return FORMATIONS.wenhu;if(v.routeId==='Y')return FORMATIONS.y100;
    if(['R_XBT','G_XBT'].includes(v.routeId))return FORMATIONS['metro-short'];
    if(v.routeId==='BL')return FORMATIONS.c321;
    if(/^(R|G|O_XINZHUANG|O_LUZHOU)$/.test(v.routeId))return FORMATIONS.c381;
  }
  if(v.systemId==='sanying')return FORMATIONS.sanying;if(v.systemId==='tmrt')return FORMATIONS.taichung;
  if(v.systemId==='tymc')return FORMATIONS['airport'+(v.airportService||'unknown')];
  if(v.systemId==='ntdlrt')return FORMATIONS.danhai;if(v.systemId==='ntalrt')return FORMATIONS.ankeng;
  if(v.systemId==='krtc')return v.routeId==='C'?FORMATIONS.caf:['R','O','KR','KO'].includes(v.routeId)?FORMATIONS.kaohsiung:null;
  return null;
}
const variants=new WeakMap();
export function formationFor(v,mode='actual'){
  const base=baseFormation(v);if(!base)return null;
  let pair=variants.get(base);if(!pair){pair={};variants.set(base,pair);}mode=mode==='three'?'three':'actual';if(pair[mode])return pair[mode];
  // 三節示意取首、中、尾；本來就不到三節的（臺中捷運、三鶯線各 2 節）維持原節數——
  // 示意模式是把長列車縮短，不該反而多長一節出來。
  const compact=(mode==='three'||base.countBasis==='unknown')&&base.lengths.length>3,
    lengths=compact?[base.lengths[0],base.lengths[Math.floor(base.lengths.length/2)],base.lengths.at(-1)]:base.lengths;
  const countBasis=base.countBasis,actualCarCount=countBasis==='unknown'?null:base.lengths.length;
  return pair[mode]={...base,lengths,compact,mode,countBasis,actualCarCount,key:[base.id,base.lengths.length,mode,countBasis].join(':'),
    caption:mode==='three'?'3 節示意':countBasis==='unknown'?'3 節示意 · 當班編組待確認'
      :`${base.lengths.length} ${base.articulated?'分節':'節'} · ${countBasis==='estimated'?'推估編組':'標準編組'}`};
}
// 環線回到起站不代表反向；用逐站的小幅前進判斷，真正折返的混合序列交回動態軌跡。
export function stationDirection(a,b,count,loop=false){let d=b-a;if(!Number.isFinite(d))return null;if(loop&&count>1){if(d>count/2)d-=count;if(d<-count/2)d+=count;}return Math.sign(d)||null;}
export function tripDirection(tr,count,loop=false){if(!Array.isArray(tr))return null;const signs=new Set();for(let i=2;i<tr.length;i+=2){const d=stationDirection(tr[i-2],tr[i],count,loop);if(d)signs.add(d);}return signs.size===1?[...signs][0]:null;}
export function assembleFormation(spec,catalog){
  const template=catalog.models[spec.id];if(!template)throw Error('缺少列車外觀 '+spec.id);
  let lengths=spec.lengths;
  // 鉸接外觀原本有長短節，照原節比例分配已知總長；短編組拿首、中、尾，不塞入三整列輕軌。
  const sources=spec.articulated?(spec.compact?[template.parts[0],template.parts[2],template.parts[4]]:template.parts):lengths.map((_,i)=>i===0?template.parts[0]:i===lengths.length-1?template.parts.at(-1):template.parts[1]);
  if(spec.articulated){const full=template.parts.map(p=>{const m=catalog.meshes[p.mesh];return m.max[0]-m.min[0];}),scale=(spec.compact?FORMATIONS[spec.id].lengths:spec.lengths).reduce((a,b)=>a+b,0)/full.reduce((a,b)=>a+b,0);lengths=sources.map(p=>{const m=catalog.meshes[p.mesh];return (m.max[0]-m.min[0])*scale;});}
  const lengthM=lengths.reduce((a,b)=>a+b,0);let front=lengthM/2;
  const parts=lengths.map((lengthM,i)=>{const first=i===0,last=i===lengths.length-1,source=sources[i],offsetM=front-lengthM/2;front-=lengthM;
    const gap=spec.articulated?.04:.16,leftGap=last?0:gap,rightGap=first?0:gap;
    return {...source,lengthM,bodyLengthM:lengthM-leftGap-rightGap,bodyShiftM:(leftGap-rightGap)/2,offsetM};});
  return {...template,...spec,displayWidthM:spec.widthM,lengthM,parts,illustrative:true,lengthScale:1};
}
