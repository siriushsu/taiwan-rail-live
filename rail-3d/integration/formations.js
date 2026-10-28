// 原有程序式外觀另存 v2；編組依可辨識的車型／路線規格，不猜當班派車。來源：FORMATIONS.md。
const repeat=(n,x)=>Array(n).fill(x);
const spec=(id,lengths,widthM,quality='車型標準編組',extra={})=>({id,lengths,widthM,quality,countBasis:'standard',lengthKnown:true,...extra});
const approximate={lengthKnown:false};
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
  dr1000:estimated('dr1000',repeat(3,20),2.8,'以有乘車紀錄的 3 輛編組作代表推估；可單輛或多輛聯結，班表未提供當班輛數'),
  dr3100:estimated('dr3100',repeat(3,20),2.9,'以官方編組圖的 3 輛單組推估；班表未提供當班重聯組數'),
  // 無當班派車資料者以代表編組推估；來源與限制見 FORMATIONS.md（2026-09-14）。
  commuter:estimated('emu800',repeat(8,20),2.9,'以 EMU700／800 的 8 輛推估；當班可能使用 4／8／10 輛等其他編組'),
  chukuang:estimated('e200',[17,...repeat(8,20)],2.9,'推估機車 1 輛＋客車 8 輛；當班掛車數未提供'),
  blue:estimated('blue',[17,...repeat(4,20)],2.9,'推估機車 1 輛＋客車 4 輛；實際依當班調度'),
  haifeng:spec('haifeng',repeat(4,20),2.9,'官方 4 輛編組；單車長度暫用近似值',approximate),
  shanlan:spec('shanlan',repeat(4,20),2.9,'官方 4 輛編組；單車長度暫用近似值',approximate),
  mingri:estimated('mingri',[17,...repeat(5,20)],2.9,'推估機車 1 輛＋客車 5 輛；鳴日廚房與包車可能採其他編組'),
  star:estimated('e500',[17,...repeat(6,20)],2.9,'推估機車 1 輛＋客車 6 輛；當班掛車數未提供'),
  forest:estimated('dl25',[10,...repeat(5,12)],2,'以林鐵包車資料推估機車 1 輛＋客車 5 輛；本線、園區支線與專列實際編組可能不同'),
  // ↑ 真車一律畫成 DL25(林鐵真車現有做法,見 baseFormation 的 afr_sched 分支)。自製列車選 dl38/dl39/dl45
  // 時各自換車模,不共用這個物件——見下面 ownForestFormation。
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
  airportunknown:estimated('airportlocal',repeat(4,20.5),3.03,'缺少官方車種時暫以普通車 4 輛推估；不代表已確認為普通車'),
  danhai:spec('danhai',repeat(5,34.45/5),2.65,'路線標準 5 分節；單節長度示意',{articulated:true}),
  ankeng:spec('ankeng',repeat(5,34.45/5),2.65,'路線標準 5 分節；單節長度示意',{articulated:true}),
  caf:spec('caf',repeat(5,34/5),2.65,'路線標準 5 分節；CAF 代表外觀、長度約值',{articulated:true}),
};
// 依車次細分的區間車（2026-10-28 網友整理的運用規則，見 FORMATIONS.md）。只有帶 trainNo 的呼叫端
// （畫 3D 車、跟車卡說明）會分到；防追撞、待避讀的長度不帶車次，照舊是 commuter 的 8 輛。
// 放在 FORMATIONS 表外（同下面的自製列車）：原生 App 的 golden 逐鍵比對那張表。
const COMMUTER_4=estimated('emu800',repeat(4,20),2.9,'依網友整理的運用規則：37、38 開頭（沙崙線）為 4 輛；代打或調度異動時可能不同');
const COMMUTER_10=estimated('emu800',repeat(10,20),2.9,'依網友整理的運用規則：1006、3029、3005、3028 為 10 輛；代打或調度異動時可能不同');
const COMMUTER_10_NOS=['1006','3029','3005','3028'];
// 自製列車:modelId 有值就用那款車,排在系統/車種推斷之前。
// 林鐵四款(含 dl25)不走 FORMATIONS.forest——那個物件的 id 寫死 dl25,四款都借會全部畫成同一顆車模。
const OWN_FOREST_IDS=['dl25','dl38','dl39','dl45'];
// modelId 直接命中既有標準編組(37 款自製車型裡有 14 款跟真車共用同一顆外觀)。
const OWN_TRAIN_STANDARD={dr1000:'dr1000',emu800:'commuter',haifeng:'haifeng',shanlan:'shanlan',e200:'chukuang',
  blue:'blue',temu1000:'taroko',temu2000:'puyuma',e1000:'pp',e500:'star',emu3000:'emu3000',dr3100:'dr3100',
  mingri:'mingri','700t':'700t'};
// 其餘 modelId 沒有已知標準編組,一律三節代表外觀;countBasis:'unknown' 讓 formationFor 在
// 'actual' 模式也自動縮成三節(跟真車那邊"當班編組待確認"共用同一條路徑,不必另外判斷)。
// 單節的機車(蒸汽機車 ck124/ct273/dt668)在 assembleFormation 裡補兩節 bluecoach,跟 garage-model.js
// createConsist 的 `if(parts.length===1)` 那一行一致——電力機車/柴電機車的 manifest 模板已經自帶
// 兩節莒光號客車,不需要這個補丁,但走同一段程式碼並不會被誤觸(parts.length 不等於 1)。
const OWN_LOCO_HAULED=['ck124','ct273','dt668','e300','e400','r200','r150','r180','dhl100','r100','r20'];
// 每個 modelId 只建一次 spec 物件並快取——formationFor/modelFor 都用物件identity 當快取鍵(WeakMap),
// 每幀重建新字面量會讓下游快取整條失效,自製車每幀都要重算 assembleFormation(白算,3D 效能歷來的坑)。
const ownFormationCache=new Map();
function ownFormation(id){
  let f=ownFormationCache.get(id);
  if(!f){
    if(OWN_FOREST_IDS.includes(id))f=estimated(id,[10,...repeat(5,12)],2,'以林鐵包車資料推估機車 1 輛＋客車 5 輛；本線、園區支線與專列實際編組可能不同');
    else{const std=OWN_TRAIN_STANDARD[id];
      if(std)f=FORMATIONS[std];
      else{const lengths=OWN_LOCO_HAULED.includes(id)?[17,20,20]:repeat(3,20);
        f={id,lengths,widthM:2.9,quality:'三節代表外觀；自製列車沒有官方編組資料',countBasis:'unknown',lengthKnown:false};}}
    ownFormationCache.set(id,f);
  }
  return f;
}
function baseFormation(v){
  if(v.modelId)return ownFormation(v.modelId);
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
    if(/區間/.test(cn)&&/^3[78]\d\d$/.test(v.trainNo))return COMMUTER_4;
    if(/區間/.test(cn)&&COMMUTER_10_NOS.includes(v.trainNo))return COMMUTER_10;
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
  // 單節機車(目前只有蒸汽機車 ck124/ct273/dt668)比照 garage-model.js 的 createConsist 補兩節 bluecoach,
  // 不是寫死家族清單——哪一款是單節,看 manifest 的 parts 長度,跟 createConsist 判斷同一件事同一種方式。
  // 🔴 變數故意不叫 parts:下面另有一個同名的 const parts(組出最終車廂資料),撞名會靜默覆蓋。
  const srcParts=template.parts.length===1?[template.parts[0],{mesh:'bluecoach',flip:false},{mesh:'bluecoach',flip:false}]:template.parts;
  // 鉸接外觀原本有長短節，照原節比例分配已知總長；短編組拿首、中、尾，不塞入三整列輕軌。
  const sources=spec.articulated?(spec.compact?[srcParts[0],srcParts[2],srcParts[4]]:srcParts):lengths.map((_,i)=>i===0?srcParts[0]:i===lengths.length-1?srcParts.at(-1):srcParts[1]);
  if(spec.articulated){const full=template.parts.map(p=>{const m=catalog.meshes[p.mesh];return m.max[0]-m.min[0];}),scale=(spec.compact?FORMATIONS[spec.id].lengths:spec.lengths).reduce((a,b)=>a+b,0)/full.reduce((a,b)=>a+b,0);lengths=sources.map(p=>{const m=catalog.meshes[p.mesh];return (m.max[0]-m.min[0])*scale;});}
  // 鉸接輕軌的無轉向架車節，網格底部原本就比整列軌面高。這些 section 是從同一個
  // 完整模型切出來的，Z 仍共用同一座標系；不能在載入時把每節的 minZ 各自歸零。
  const sharedGroundZ=spec.articulated?Math.min(...sources.map(p=>catalog.meshes[p.mesh].min[2])):null;
  const lengthM=lengths.reduce((a,b)=>a+b,0);let front=lengthM/2;
  const parts=lengths.map((lengthM,i)=>{const first=i===0,last=i===lengths.length-1,source=sources[i],offsetM=front-lengthM/2;front-=lengthM;
    const gap=spec.articulated?.04:.16,leftGap=last?0:gap,rightGap=first?0:gap,groundAnchorZ=sharedGroundZ??catalog.meshes[source.mesh].min[2];
    return {...source,lengthM,bodyLengthM:lengthM-leftGap-rightGap,bodyShiftM:(leftGap-rightGap)/2,offsetM,groundAnchorZ};});
  return {...template,...spec,displayWidthM:spec.widthM,lengthM,parts,illustrative:true,lengthScale:1};
}
