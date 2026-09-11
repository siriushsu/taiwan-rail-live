// 用官方橋隧幾何補回「來源沒有標記、實際卻是結構」的路段。
//
// 為什麼需要這一份：OSM 的 bridge／tunnel 標記在台灣鐵道上是**有幾何但常缺標**——
// 高鐵有 8% 線長被標成地面（官方只有 1%），臺中捷運綠線整條全高架卻有兩段沒標。
// 那些缺口會讓連續高架中間憑空落地。反過來，layer 不能拿來補（它只表示相交上下序），
// 2026-09-09 就是因為把正 layer 當橋梁，讓 190 條普通路段長出橋墩。
//
// 來源＝內政部國土測繪中心「臺灣鐵路／高速鐵路／捷運」（政府資料開放授權條款第 1 版，
// 得不限目的利用，須顯名）。逐路段切分並標記結構種類，臺鐵那份另有橋隧專名。
// 授權與 OSM 的 ODbL 不同源，故不混寫進 network.json，另存一份對照表。
//
// 升級（來源標成地面、官方說是橋或隧道 → 補上）一律照做；官方說平面而來源明示結構的
// 一律保留原判，那多半是官方圖資把引道併進平面段，補了會讓連續高架斷開。
//
// 2026-09-11 追加**反向改判**，只開給「來源與官方互指橋／隧道」這一格：
// 回報者在 24.2738,120.6643 看到高鐵一下橋樑一下地下道，根因就是 OSM 把兩條各 732m 的
// 高架橋標成 tunnel=yes layer=-2，而單向規則永遠改不回來。這一格全網路只有 13 條
// （高鐵 6、北捷 5、機捷 2）＋反方向 1 條，不是靠比對兩份標記裁決，而是引入
// **第三來源**：DEM 地形本身。山岳隧道的中段地表必然遠高於洞口，高架橋不會。
// 實測三條對照隧道（新觀音 +525m、三義 +182m、中央 +590m）與那 13 條（−2.2～+9.0m）
// 之間有兩個數量級的空隙，門檻取 RELIEF_M=20 落在空隙正中間。
// 地形站哪邊就照哪邊；地形不表態（兩者都在門檻同側）就維持來源判定並記進 unresolved。
//
// 用法：node scripts/build_rail_structures_official.mjs [--refresh] [--out data/rail_structures_official.json]
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
import {openRailDem} from './lib/local_rail_dem.mjs';import {makePath} from '../rail-3d/integration/train-path.js';

const argv=process.argv.slice(2);
const OUT=(()=>{const i=argv.indexOf('--out');return i>=0?argv[i+1]:'data/rail_structures_official.json';})();
const REFRESH=argv.includes('--refresh');
const CACHE='.cache/nlsc';

// 政府資料開放平臺的資料集頁（人看的）與實際檔案直連（機器抓的）。
// 兩個都留：直連會隨改版換 GUID，屆時要回資料集頁重新取得。
const DATASETS=[
 {key:'rail',name:'臺灣鐵路',page:'https://data.gov.tw/dataset/73220',
  url:'https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/299841E1-714A-40BA-AF4B-D6527EEA2A41/resource/801DECA5-E75E-40A4-816C-1BD6A1F322C9/download',
  zip:'rail.zip',systems:['tra_sched','afr_sched'],type:'RAILTYPE',name_:'BRITUNNAME',line:'RAILNAME'},
 {key:'hsr',name:'高速鐵路',page:'https://data.gov.tw/dataset/73221',
  url:'https://www.tgos.tw/tgos/VirtualDir/Product/db6bff0a-58a5-40c1-81fb-ac8312213784/HSRAIL_1130417.zip',
  zip:'hsr.zip',systems:['thsr_sched'],type:'HSTYPE',name_:null,line:'HSNAME'},
 {key:'mrt',name:'捷運',page:'https://data.gov.tw/dataset/73222',
  url:'https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/159E4D93-A053-4382-A6BD-9DE6B5C4E19F/resource/9D9CF5D4-EEA3-4E1C-ACB0-ECDBBA27C713/download',
  zip:'mrt.zip',systems:null,type:'MRTTYPE',name_:null,line:'MRTSYS'}];

// 三份共用的結構種類碼。1=橋樑 2=一般平面 3=地下（都市地下化／捷運地下段）4=山岳隧道。
// 官方沒有附欄位字典，這組對照是用幾何交叉驗證出來的：捷運那份板南線與松山新店線
// 100% 落在 3、文湖線 96% 落在 1，與「全地下」「全高架」的事實吻合；
// 臺鐵那份 3 只有 11 段（中位 1.6km，含臺北與高雄地下化），4 有 184 段（中位 237m）。
const KIND={'1':'bridge','2':'surface','3':'tunnel','4':'tunnel'};

// ── Shapefile（PolyLine）與 DBF 最小讀取器 ─────────────────────────────
// 這台機器沒有 gdal／pyshp，且只需要「折線＋幾個字串欄位」，不引第三方相依。
function readDbf(buf){
 const n=buf.readUInt32LE(4),headerLen=buf.readUInt16LE(8),recLen=buf.readUInt16LE(10),fields=[];
 for(let o=32;buf[o]!==0x0D;o+=32)fields.push({name:buf.subarray(o,o+11).toString('utf8').replace(/\0.*$/,''),len:buf[o+16]});
 const rows=[];
 for(let i=0,p=headerLen;i<n;i++,p+=recLen){const row={};let o=p+1;
  for(const f of fields){row[f.name]=buf.subarray(o,o+f.len).toString('utf8').trim();o+=f.len;}rows.push(row);}
 return rows;
}
function readShp(buf){
 const out=[];
 for(let p=100;p<buf.length;){const contentWords=buf.readUInt32BE(p+4),body=buf.subarray(p+8,p+8+contentWords*2);p+=8+contentWords*2;
  if(body.readUInt32LE(0)!==3){out.push([]);continue;}                       // 3=PolyLine，其他型別本資料集不會出現
  const numParts=body.readUInt32LE(36),numPoints=body.readUInt32LE(40),starts=[];
  for(let i=0;i<numParts;i++)starts.push(body.readUInt32LE(44+i*4));
  const base=44+numParts*4,pts=[];
  for(let i=0;i<numPoints;i++)pts.push([body.readDoubleLE(base+i*16),body.readDoubleLE(base+i*16+8)]);
  const bounds=[...starts,numPoints],parts=[];
  for(let i=1;i<bounds.length;i++)parts.push(pts.slice(bounds[i-1],bounds[i]));
  out.push(parts);}
 return out;
}
// TWD97[2020] TM2 zone 121（EPSG:3826，.prj 逐字寫明）反投影回 WGS84。
// 中央經線 121°、尺度 0.9999、橫座標平移 250km、GRS80。
const A=6378137,F=1/298.257222101,E2=2*F-F*F,EP2=E2/(1-E2),K0=.9999,FE=25e4,LON0=121*Math.PI/180;
const E1=(1-Math.sqrt(1-E2))/(1+Math.sqrt(1-E2));
function toWgs([E,N]){
 const mu=N/K0/(A*(1-E2/4-3*E2**2/64-5*E2**3/256));
 const p=mu+(3*E1/2-27*E1**3/32)*Math.sin(2*mu)+(21*E1**2/16-55*E1**4/32)*Math.sin(4*mu)+(151*E1**3/96)*Math.sin(6*mu)+(1097*E1**4/512)*Math.sin(8*mu);
 const C=EP2*Math.cos(p)**2,T=Math.tan(p)**2,s=Math.sin(p);
 const N1=A/Math.sqrt(1-E2*s*s),R1=A*(1-E2)/(1-E2*s*s)**1.5,D=(E-FE)/(N1*K0);
 const lat=p-(N1*Math.tan(p)/R1)*(D**2/2-(5+3*T+10*C-4*C*C-9*EP2)*D**4/24+(61+90*T+298*C+45*T*T-252*EP2-3*C*C)*D**6/720);
 const lon=LON0+(D-(1+2*T+C)*D**3/6+(5-2*C+28*T-3*C*C+8*EP2+24*T*T)*D**5/120)/Math.cos(p);
 return [lon*180/Math.PI,lat*180/Math.PI];
}

// ── 取得原始檔（快取在 .cache，已列入 .gitignore 與 .assetsignore）──────
function fetchDataset(d){
 fs.mkdirSync(CACHE,{recursive:true});
 const zip=path.join(CACHE,d.zip),dir=path.join(CACHE,d.key);
 if(REFRESH||!fs.existsSync(zip)){
  console.log(`抓取 ${d.name} …`);
  execFileSync('curl',['-sSL','--fail','--max-time','120','-o',zip,d.url],{stdio:['ignore','inherit','inherit']});
 }
 const sha256=crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
 fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});
 execFileSync('unzip',['-o','-q',zip,'-d',dir]);
 const base=fs.readdirSync(dir).find(f=>f.endsWith('.shp')).replace(/\.shp$/,'');
 const prj=fs.readFileSync(path.join(dir,base+'.prj'),'utf8');
 if(!prj.includes('TM2_zone_121'))throw Error(`${d.name} 的投影不是 TM2 zone 121，反投影會整份偏移：${prj.slice(0,60)}`);
 const rows=readDbf(fs.readFileSync(path.join(dir,base+'.dbf'))),geoms=readShp(fs.readFileSync(path.join(dir,base+'.shp')));
 if(rows.length!==geoms.length)throw Error(`${d.name} 屬性 ${rows.length} 筆與幾何 ${geoms.length} 筆不符`);
 return {sha256,file:base,rows,geoms};
}

// ── 空間索引：0.002 度格網（約 200m），查最近的官方線段 ────────────────
const R_LAT=110574,R_LON=101751,CELL=500;
function makeIndex(){
 const grid=new Map(),segs=[];
 const add=(a,b,meta)=>{const i=segs.length;segs.push([a,b,meta]);
  for(let x=Math.floor(Math.min(a[0],b[0])*CELL);x<=Math.floor(Math.max(a[0],b[0])*CELL);x++)
   for(let y=Math.floor(Math.min(a[1],b[1])*CELL);y<=Math.floor(Math.max(a[1],b[1])*CELL);y++){
    const k=x+','+y;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(i);}};
 const nearest=(pt,max)=>{const x0=Math.floor(pt[0]*CELL),y0=Math.floor(pt[1]*CELL);let best=max,meta=null;
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const i of grid.get((x0+dx)+','+(y0+dy))||[]){
   const [a,b,m]=segs[i],py=(pt[1]-a[1])*R_LAT,px=(pt[0]-a[0])*R_LON,vy=(b[1]-a[1])*R_LAT,vx=(b[0]-a[0])*R_LON,l2=vy*vy+vx*vx;
   const t=l2?Math.max(0,Math.min(1,(py*vy+px*vx)/l2)):0,d=Math.hypot(py-t*vy,px-t*vx);
   if(d<best){best=d;meta=m;}}
  return {d:best,meta};};
 return {add,nearest,get size(){return segs.length;}};
}
// 沿折線每 STEP 公尺取樣（含每個原始頂點），讓長 way 與短 way 的判定顆粒度一致。
const STEP=20;
function densify(coords){
 const out=[coords[0]];
 for(let i=1;i<coords.length;i++){const p=coords[i-1],q=coords[i];
  const d=Math.hypot((q[1]-p[1])*R_LAT,(q[0]-p[0])*R_LON);
  for(let k=1;k<=Math.floor(d/STEP);k++){const t=k*STEP/d;out.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}
  out.push(q);}
 return out;
}

// ── 地形起伏：反向改判的第三來源 ────────────────────────────────────
// 沿 way 取樣 DEM，回「中段最高地表」減「兩端地表平均」。山岳隧道必然很大（實測 182～591m），
// 高架橋必然很小（實測 −2.2～+9.0m）。這個量與 OSM 標記、官方 shapefile 都不同源。
const RELIEF_M=20;     // 兩群之間的空隙是 9m 到 182m，門檻取 20m。
async function relief(coords,ground){
 const path=makePath(coords),len=path.d.at(-1);
 const n=Math.max(8,Math.min(160,Math.round(len/25))),g=[];
 for(let i=0;i<=n;i++)g.push(await ground(path.at(Math.min(len*i/n,len-1e-3)).coordinate));
 const ends=(g[0]+g[n])/2,inner=g.slice(1,n);
 return +((inner.length?Math.max(...inner):ends)-ends).toFixed(1);
}

// ── 主流程 ──────────────────────────────────────────────────────────
const MATCH_M=40;      // 取樣點認領官方線段的上限。實測匹配距離中位 2.5m、p90 7.9m，
                       // 40m 足以吃下雙線各自成 way 的橫向差，又不會跨到隔壁路廊。
const MIN_COVER=.6;    // 要有六成取樣點指向同一種結構才改判；其餘維持來源判定。
const MIN_MATCHED=.6;  // 官方涵蓋不到六成的 way（輕軌、信義東延段等新線）一律不動。

const indexes={};
const datasets=[];
for(const d of DATASETS){
 const {sha256,file,rows,geoms}=fetchDataset(d);
 const idx=makeIndex();
 rows.forEach((row,i)=>{const kind=KIND[row[d.type]];if(!kind)return;
  const meta={kind,name:d.name_?row[d.name_]:'',line:row[d.line]||''};
  for(const part of geoms[i])for(let j=1;j<part.length;j++)idx.add(toWgs(part[j-1]),toWgs(part[j]),meta);});
 indexes[d.key]=idx;
 datasets.push({dataset:d.name,page:d.page,url:d.url,file,sha256,records:rows.length,segments:idx.size});
 console.log(`  ${d.name}: ${rows.length} 筆、${idx.size} 段`);
}
const pick=system=>system==='thsr_sched'?indexes.hsr:['tra_sched','afr_sched'].includes(system)?indexes.rail:indexes.mrt;
// 與 structure-kind.js 同一套判定，但這裡只需要「來源標了什麼」，不需要 rank。
const osmKind=t=>{
 const bridge=!!t.bridge&&t.bridge!=='no';
 if(['avalanche_protector','building_passage'].includes(t.tunnel)&&!bridge)return 'surface';
 if(t.tunnel==='yes'||t.location==='underground')return 'tunnel';
 if(bridge)return 'bridge';
 return /^-\d/.test(String(t.layer??''))?'tunnel':'surface';
};

const entries={},summary={upgraded:{bridge:0,tunnel:0},overridden:{bridge:0,tunnel:0},unresolved:[],kept:{},uncovered:0,ways:0};
const dem=openRailDem(new URL('../',import.meta.url));
try{
for(const f of ['network.json','metro-network.json']){
 for(const w of JSON.parse(fs.readFileSync('rail-3d/physical/'+f)).ways){
  const idx=pick(w.system),samples=densify(w.coordinates),tally={bridge:0,tunnel:0,surface:0};
  let matched=0,sum=0;const names={};
  for(const pt of samples){const {d,meta}=idx.nearest(pt,MATCH_M);if(!meta)continue;
   matched++;sum+=d;tally[meta.kind]++;if(meta.name)names[meta.name]=(names[meta.name]||0)+1;}
  summary.ways++;
  if(matched/samples.length<MIN_MATCHED){summary.uncovered++;continue;}
  const [kind,count]=Object.entries(tally).sort((a,b)=>b[1]-a[1])[0];
  const cover=count/samples.length,source=osmKind(w.tags||{}),verdict=cover<MIN_COVER?'mixed':kind;
  const name=Object.entries(names).sort((a,b)=>b[1]-a[1])[0];
  const base={system:w.system,coverage:+cover.toFixed(3),medianDistM:+(sum/matched).toFixed(1),...(name?{name:name[0]}:{})};
  // 升級：來源說地面、官方說結構。兩邊只有一邊表態，直接補。
  if(source==='surface'&&['bridge','tunnel'].includes(verdict)){
   entries[w.id]={kind:verdict,...base};summary.upgraded[verdict]++;continue;}
  // 反向改判：兩邊互指橋／隧道。交給地形裁決，不自行比較兩份標記的可信度。
  if(source!==verdict&&['bridge','tunnel'].includes(source)&&['bridge','tunnel'].includes(verdict)){
   const reliefM=await relief(w.coordinates,dem.ground),mountain=reliefM>=RELIEF_M;
   // 地形與官方同一邊才改；地形支持來源、或它對這一格沒有鑑別力，就維持原判並記帳。
   if(mountain===(verdict==='tunnel')){
    entries[w.id]={kind:verdict,override:source,reliefM,...base};summary.overridden[verdict]++;
   }else{
    summary.unresolved.push({id:String(w.id),system:w.system,source,official:verdict,reliefM,coverage:+cover.toFixed(3)});
    summary.kept[source+'→'+verdict]=(summary.kept[source+'→'+verdict]||0)+1;}
   continue;}
  summary.kept[source+'→'+verdict]=(summary.kept[source+'→'+verdict]||0)+1;
 }
}
}finally{dem.close();}
fs.mkdirSync(path.dirname(OUT),{recursive:true});
fs.writeFileSync(OUT,JSON.stringify({
 _readme:'官方橋隧對照表，供 build_rail_levels.mjs 補正。兩類條目：沒有 override 的是升級'
  +'（OSM 標成地面、官方判定為橋或隧道）；帶 override 的是反向改判（兩邊互指橋／隧道，'
  +'由 DEM 地形起伏 reliefM 裁決，override 欄位記的是被推翻的來源判定）。'
  +'coverage 是該 way 取樣點落在該結構上的比例，medianDistM 是取樣點到官方線的中位距離。'
  +'官方說平面而來源標結構的一律保留來源判定，官方未涵蓋的新線也不動；'
  +'地形不支持任何一方的爭議路段列在 summary.unresolved，同樣保留來源判定。',
 generated:new Date().toISOString(),
 license:'政府資料開放授權條款-第1版（https://data.gov.tw/license）；顯名：內政部國土測繪中心',
 source:'內政部國土測繪中心 臺灣鐵路／高速鐵路／捷運（政府資料開放平臺）；地形＝隨站發布的固定 DEM 快照',
 datasets,params:{matchM:MATCH_M,minCover:MIN_COVER,minMatched:MIN_MATCHED,stepM:STEP,reliefM:RELIEF_M},
 summary,entries},null,1));
console.log(summary);
console.log(`已寫入 ${OUT}：${Object.keys(entries).length} 條`);
