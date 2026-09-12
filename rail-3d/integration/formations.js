// 原有程序式外觀另存 v2；編組依可辨識的車型／路線規格，不猜當班派車。來源：FORMATIONS.md。
const repeat=(n,x)=>Array(n).fill(x);
const spec=(id,lengths,widthM,quality='車型標準編組',extra={})=>({id,lengths,widthM,quality,countKnown:true,lengthKnown:true,...extra});
const approximate={lengthKnown:false};
const unknown=(id,lengths,widthM)=>spec(id,lengths,widthM,'當班編組待確認',{countKnown:false,lengthKnown:false});
export const FORMATIONS={
  '700t':spec('700t',[27,...repeat(10,25),27],3.38),
  emu3000:spec('emu3000',[21.35,...repeat(10,20.3),21.35],2.91),
  taroko:spec('temu1000',repeat(8,21),2.9,'車型標準 8 節；長度暫用近似值',approximate),
  puyuma:spec('temu2000',[22.095,...repeat(6,20.7),22.095],2.9),
  // 前後各一部 E1000＋12 節客車。台鐵官方售票說明寫「PP推拉式自強號第12車親子車廂」，
  // 班表車種名也出現「自強(PP障12)」，兩邊都指向 12 節客車；長度仍是近似值。
  pp:spec('e1000',[17.4,...repeat(12,20),17.4],2.9,'車型標準編組：前後機車＋12 節客車；長度暫用近似值',approximate),
  dr1000:unknown('dr1000',repeat(3,20),2.8),
  dr3100:unknown('dr3100',repeat(3,20),2.9),
  commuter:unknown('emu800',repeat(3,20),2.9),
  chukuang:unknown('e200',[17,20,20],2.9),
  blue:unknown('blue',[17,20,20],2.9),
  haifeng:unknown('haifeng',repeat(3,20),2.9),
  shanlan:unknown('shanlan',repeat(3,20),2.9),
  mingri:unknown('mingri',[17,20,20],2.9),
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
    const named={'blue-train':'blue',haifeng:'haifeng',shanlan:'shanlan',mingri:'mingri'}[v.namedId];if(named)return FORMATIONS[named];
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
  const compact=(mode==='three'||!base.countKnown)&&base.lengths.length>3,
    lengths=compact?[base.lengths[0],base.lengths[Math.floor(base.lengths.length/2)],base.lengths.at(-1)]:base.lengths;
  const countBasis=base.countKnown?'standard':'unknown',actualCarCount=base.countKnown?base.lengths.length:null;
  return pair[mode]={...base,lengths,compact,mode,countBasis,actualCarCount,key:[base.id,base.lengths.length,mode,base.countKnown].join(':'),
    caption:mode==='three'?'3 節示意':base.countKnown?`${base.lengths.length} ${base.articulated?'分節':'節'} · 標準編組`:'3 節示意 · 當班編組待確認'};
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
