// 台南地面鐵道重播的封存資料：每班車的到離站時刻沿已上線的實體股道逐秒取樣，重播頁不再讀任何即時資料。
// 日期設定在 scripts/tainan_memory_config.mjs；沒帶 --date 時是 2026-09-12，那一份已封存，這支一律拒跑（verify 照舊驗它）。
//
//   node scripts/build_tainan_memory.mjs --date 2026-10-16 --export-run-floor
//       匯出範圍內各班逐段段長與性能參數（tainan_actuals.py 的物理下限；與網站畫車同一組 schedSegKmOf／resolvePerf）。
//   python3 -I scripts/tainan_actuals.py --date 2026-10-16
//       重建實際到離站時刻（寫到 .cache）。
//   node scripts/build_tainan_memory.mjs --date 2026-10-16 [--replace-local-snapshot]
//       寫 snapshot.json、source-schedule.json、source-observations.json，報表寫到 .cache。
//       fleet/、頁面檔、uncertainty.json（build_tainan_track_ambiguities.mjs）與 integrity.json（seal）不在這裡。
//
// 10/16 的做法（docs/tainan-memory-2026-10-16-design.md 第 3、4、10 節）：
//   1. 停靠站換成重建的實際到離站時刻；被留置的通過站（比表定多停 90 秒以上）當成待避停車點；
//      有實測的通過站當成剖面折點（以扣掉留置的行駛時間算千分比，與 assignRunProfiles 讀 passObs 的換算一致）。
//      剖面要真的通過折點：畫面範圍內每顆折點的回填時刻與重建時刻相差超過 1 秒就停；沒有通過折點的通過站不標實測。
//   2. 剖面與通過站回填用網站同一段原始碼（build_run_profiles.mjs 的沙箱，呼叫順序同 computeProfiles）。
//   3. 股道沿用每班車照表定綁到的那一份派車計畫，時刻換成實際值後以自訂計畫精確綁定（改點不改股道）。
//   4. 單線雙向：從重建時刻找出對向列車開始輪流進入永康—保安的時刻；之後進入區間的南下列車改走北上股道反向，
//      渡線只用股道資料裡既有的（區間端點找不到就往外延伸）；22:00 之後、輪流開始之前的對向重疊列為不確定。
//   5. 物理可行性：每 0.5 秒差分實體取樣器的里程，點速不得超過車種極速。極速＝resolvePerf 的 v，也就是網站畫車的
//      speedCapOf 與 issue #15 閘門 verify_phys_speed_cap.mjs 用的同一張表（PERF_RULES／PERF_BY_TYPE，不留容差）。
//      超過的先拿掉該班的通過站折點重建，仍超過才整班退回表定，並列在 timingSource.fallbacks。
//      套用的極速依 (carName, typeName) 凍結進 timingSource.speedCaps（連同當時 index.html 的雜湊）；verify 只讀凍結值，
//      主站日後調整極速表，已封存的一天不會跟著變紅。
//   6. 設定檔的來源紀錄：snapshot.sources 裡 config 那一筆記的是「產生資料所用的設定欄位」的雜湊（欄位名單與算法在
//      tainan_memory_config.mjs 的 generationFields／generationConfigSha256），不是整個檔的雜湊——改註解、verify 的門檻與
//      主站入口都與資料無關，不該讓紀錄過期。verify 照這一筆記的欄位名單重算，要與目前的設定檔相符。
//   7. 預覽（設定的 preview）：整班照表定、不讀任何實測；snapshot 加 preview 標記與 timingSource.scheduledTimeSource（表定時刻的來源檔）。
//      設定沒有 singleLine、marks、時間軸事項、校準檔時，這幾塊整段略過：snapshot 沒有 singleLine，events 是空的。
//   8. 地下化（設定的 underground，docs/tainan-memory-2026-10-23-design.md 第 3、4 節）：
//      a. routes、rails 的每個頂點加軌道面高程 z（落在隧道、站體、U 槽外框內才有，框外是地面 0；整條都在地面的不寫 z）；
//      b. 臺南站的停靠點換成月台中央：整列的中心停在 profile.json 的 derived.platform.centerD（股道資料推定的停靠點在月台南端外約 127 公尺）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {runInContext} from 'node:vm';
import {makeSandbox,readPassObs,readTrackSections,readSpecial} from './build_run_profiles.mjs';
import {createPhysicalMotion,physicalTrainKey,physicalStopSignature} from '../rail-3d/physical/motion.js';
import {createRouteRuntime} from '../rail-3d/physical/route-runtime.js';
import {makeTopology} from '../rail-3d/physical/topology.js';
import {stationKey} from '../rail-3d/physical/timing.js';
import {formationFor,assembleFormation} from '../rail-3d/integration/formations.js';
import {configFor,dateFromArgv,resolveInput,generationFields,generationConfigSha256} from './tainan_memory_config.mjs';

const cfg=configFor(dateFromArgv()),root=cfg.root,out=cfg.outDir,argv=process.argv;
const EXPORT_FLOOR=argv.includes('--export-run-floor');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const repoFile=p=>path.join(root,p),readRepo=p=>JSON.parse(fs.readFileSync(repoFile(p),'utf8'));
const norm=n=>String(n).replace(/臺/g,'台').replace(/\s+/g,'');
if(cfg.sealed)throw Error(cfg.date+' 已封存（'+cfg.dir+'）：build 不重建封存；要重現驗收請跑 verify_tainan_memory.mjs。');
if(!cfg.actuals)throw Error(cfg.date+' 的設定沒有實測輸入（actuals）。');
if(!EXPORT_FLOOR){
 if(fs.existsSync(path.join(out,'integrity.json')))throw Error('已有 integrity.json（已封存），不重建：'+cfg.dir);
 if(fs.existsSync(path.join(out,'snapshot.json'))&&!argv.includes('--replace-local-snapshot'))throw Error('snapshot.json 已存在；確定要重建本機未封存的版本再加 --replace-local-snapshot。');
}

// ── 輸入 ──
const REPO_INPUTS_ALL=['data/tra_schedule_dense.json','data/tra.json','data/tra_station_info.json','data/tra_pass_obs.json','data/tra_track_sections.json',
 'data/tra_special_trains.json','rail-3d/physical/network.json','rail-3d/physical/display-profiles.json','rail-3d/physical/dispatch.json',
 'rail-3d/assets/blender-map-v1/manifest.json','prototypes/tiny-trains/blender/tainan-memory-v1/context-source.json','index.html',
 cfg.dir+'/fleet/catalog.json',
 'scripts/tainan_memory_config.mjs','scripts/tainan_actuals.py','scripts/build_tainan_memory.mjs'];
// 主站的密化班表只有設定指到它的日期才算輸入（ODS 轉出的檔放在 .cache，不讀它）；設定標了 convertedFrom:'ods' 的班表另記轉換用的三支腳本。
const REPO_INPUTS=[...REPO_INPUTS_ALL.filter(f=>f!=='data/tra_schedule_dense.json'||Object.values(cfg.schedules).some(r=>r.file===f)),
 ...(Object.values(cfg.schedules).some(r=>r.convertedFrom==='ods')?['scripts/tainan_ods_to_dense.py','scripts/fetch_tra_schedule.py','scripts/densify_schedule.py']:[])];
// 物理下限檔與這些輸入綁在一起：任一份改了，段長或性能參數就可能不同，要重新匯出、重跑重建。
const FLOOR_INPUTS=['data/tra.json','data/tra_track_sections.json','data/tra_special_trains.json','index.html'];
const indexPath=repoFile('index.html');
const special=readSpecial(repoFile('data/tra_special_trains.json'));
const trackSections=readTrackSections(repoFile('data/tra_track_sections.json'));
const passObsFile=readPassObs(repoFile('data/tra_pass_obs.json'))||{};
const track=readRepo('data/tra.json'),pack=readRepo('rail-3d/physical/network.json'),profiles=readRepo('rail-3d/physical/display-profiles.json');
const dispatch=readRepo('rail-3d/physical/dispatch.json'),manifest=readRepo('rail-3d/assets/blender-map-v1/manifest.json');

// 營運日 → 密化班表（前一日跨午夜的班次用那一天當時的版本）。
const schedFiles=new Map(),sched={};
for(const day of [cfg.previous,cfg.date]){
 const ref=cfg.schedules[day],file=resolveInput(cfg,ref);
 if(!schedFiles.has(file)){const buf=fs.readFileSync(file);schedFiles.set(file,{json:JSON.parse(buf),sha256:hash(buf)});}
 const s=schedFiles.get(file);if(ref.sha256&&ref.sha256!==s.sha256)throw Error('班表雜湊不符：'+file);
 if(!s.json.dates?.[day])throw Error('班表沒有 '+day+'：'+file);
 sched[day]={file,ref,...s,rel:file.startsWith(cfg.cacheRoot)?path.relative(cfg.cacheRoot,file):path.relative(root,file)};
}

// ── 選班：大橋、臺南、保安任一站（停靠或通過）的時刻落在當天 0–86399 秒 ──
const SEL=new Set(cfg.selection.stations.map(norm)),selected=[];
for(const [day,offset] of [[cfg.previous,-86400],[cfg.date,0]]){
 const sj=sched[day].json;
 for(const index of sj.dates[day]){const src=sj.trains[index];
  const hits=src.stops.flatMap((s,i)=>SEL.has(norm(s.name))?[i]:[]);if(!hits.length)continue;
  const w0=Math.min(...hits.map(i=>src.stops[i].arrSec))+offset,w1=Math.max(...hits.map(i=>src.stops[i].depSec))+offset;
  if(w1<0||w0>=86400)continue;
  selected.push({day,offset,index,hits,src,key:day+':'+src.train});
 }
}
// 同一車次在範圍內出現兩次（前一日跨午夜的尾段與當天的頭段）：實測模式下兩份的重建時刻與通過折點不同，passObs 與自訂計畫又以車次為鍵，會互相蓋掉，直接停。
// 預覽整班表定、沒有重建，兩份定義逐項相同時，鍵相同的兩份計畫內容也相同，才放行。
{const nos=selected.map(v=>String(v.src.train)),dup=[...new Set(nos.filter((n,i)=>nos.indexOf(n)!==i))];
 const same=dup.every(n=>{const xs=selected.filter(v=>String(v.src.train)===n);return xs.every(x=>JSON.stringify(x.src)===JSON.stringify(xs[0].src));});
 if(dup.length&&!(cfg.preview&&same))throw Error('範圍內同一車次出現兩次（passObs 與自訂計畫以車次為鍵）：'+dup);}

// 與 build_run_profiles.mjs 的 computeProfiles 同一串呼叫（canonicalize → 貼軌＋剖面 → 交會推論），另外留下沙箱給
// 留置通過站重算剖面（reassignTrainProfile）與段長匯出用。
function profilePipeline(trains,passObs){
 const ctx=makeSandbox(indexPath,special);
 ctx.state.passObs=passObs;ctx.state.trackSections=trackSections;ctx.trains=trains;ctx.lines=track.lines;
 for(const tr of trains)tr.sys='tra_sched';
 runInContext('canonicalizeAliasTrains(trains)',ctx);
 runInContext('clearPlannedOvertakes(trains); assignSchedShapePathsFor(trains, lines)',ctx);
 ctx.union={trains,dates:undefined};
 ctx.__meet=runInContext('inferMeetPassTimes(trains, union, state.trackSections)',ctx);
 runInContext('globalThis.__segKm=s=>s.slice(0,-1).map((_,i)=>schedSegKmOf(s,i));globalThis.__perf=tr=>{const p=resolvePerf(tr);return {a:p.a,b:p.b,v:p.v};};globalThis.__reassign=tr=>reassignTrainProfile(tr);',ctx);
 return ctx;
}
const sched0=selected.map(v=>structuredClone(v.src)),ctx0=profilePipeline(sched0,passObsFile);
const floorInputs=()=>[...[...schedFiles].map(([file,s])=>({path:file.startsWith(cfg.cacheRoot)?path.relative(cfg.cacheRoot,file):path.relative(root,file),sha256:s.sha256})),
 ...FLOOR_INPUTS.map(f=>({path:f,sha256:hash(fs.readFileSync(repoFile(f)))}))];

if(EXPORT_FLOOR){
 const trains=selected.map((v,i)=>{const tr=sched0[i],segKm=Array.from(ctx0.__segKm(tr.stops));
  tr.stops.slice(0,-1).forEach((s,k)=>{if(s.rpSegKm!=null&&Math.abs(s.rpSegKm-segKm[k])>1e-9)throw Error('段長與剖面用的不同：'+tr.train+' '+s.name);});
  return {serviceDate:v.day,train:String(tr.train),sourceIndex:v.index,names:tr.stops.map(s=>s.name),stop:tr.stops.map(s=>s.stop!==false),segKm,perf:{...ctx0.__perf(tr)}};});
 const file=resolveInput(cfg,cfg.actuals.runFloor);fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file,JSON.stringify({schema:1,date:cfg.date,generatedBy:'scripts/build_tainan_memory.mjs --export-run-floor',inputs:floorInputs(),trains}));
 console.log(JSON.stringify({out:file,trains:trains.length,bytes:fs.statSync(file).size}));
 process.exit(0);
}

// ── 實測重建檔：必須是對著目前這份輸入算的 ──
const floorFile=resolveInput(cfg,cfg.actuals.runFloor),floorJson=JSON.parse(fs.readFileSync(floorFile,'utf8'));
for(const want of floorInputs()){const got=floorJson.inputs.find(x=>x.path===want.path);if(!got||got.sha256!==want.sha256)throw Error('物理下限檔過期（'+want.path+' 已變）；重跑 --export-run-floor 與 tainan_actuals.py');}
const actFile=resolveInput(cfg,cfg.actuals.out),act=JSON.parse(fs.readFileSync(actFile,'utf8'));
{const want=new Map([[path.relative(cfg.cacheRoot,floorFile),hash(fs.readFileSync(floorFile))],...Object.values(sched).map(s=>[s.rel,s.sha256])]);
 for(const inp of act.inputs)if(want.has(inp.path)&&want.get(inp.path)!==inp.sha256)throw Error('實測檔不是對著目前的 '+inp.path+' 算的；重跑 tainan_actuals.py');
 for(const p of want.keys())if(!act.inputs.some(x=>x.path===p))throw Error('實測檔沒有記錄輸入 '+p);}
if(act.date!==cfg.date)throw Error('實測檔日期不符');
const actBy=new Map(act.trains.map(t=>[t.key,t]));
{const miss=selected.filter(v=>!actBy.has(v.key)).map(v=>v.key),extra=[...actBy.keys()].filter(k=>!selected.some(v=>v.key===k));
 if(miss.length||extra.length)throw Error('選班與實測檔不一致：缺 '+miss.join(',')+'；多 '+extra.join(','));}
for(const v of selected)v.act=actBy.get(v.key);

// ── 套實際時刻 ──
// mode：'observed'（停靠站＋留置通過站＋實測通過折點）、'no-knots'（不放通過折點）、'scheduled'（整班表定）。
const isEnd=(stops,i)=>i===0||i===stops.length-1;
function retime(v,mode){
 const tr=structuredClone(v.src),off=v.offset,a=v.act,res={mode,held:[],knots:0,knotAt:[],dropped:[],unmatched:[],passObs:null};
 if(mode==='scheduled'||a.timing==='scheduled')return {...res,tr,mode:'scheduled'};
 const S=tr.stops,real=S.flatMap((s,i)=>isEnd(S,i)||s.stop!==false?[i]:[]),chainStops=a.nodes.filter(n=>n.stop);
 const old=S.map(s=>({arr:s.arrSec,dep:s.depSec})),matched=new Map();let p=0;
 for(const i of real){const nm=norm(S[i].name);let k=p;while(k<chainStops.length&&norm(chainStops[k].name)!==nm)k++;if(k<chainStops.length){matched.set(i,chainStops[k]);p=k+1;}}
 for(const i of real){const n=matched.get(i);
  if(n){S[i].arrSec=Math.round(n.arr-off);S[i].depSec=Math.round(n.dep-off);continue;}
  // 不在重建鏈上的停靠站（站名查不到站碼）：照最近一個有對到的停靠站的延誤平移。
  let best=null;for(const [j,m] of matched)if(!best||Math.abs(j-i)<Math.abs(best[0]-i))best=[j,m];
  const d=best?Math.round(best[1].arr-off-old[best[0]].arr):0;S[i].arrSec=old[i].arr+d;S[i].depSec=old[i].dep+d;res.unmatched.push(S[i].name);
 }
 // 通過站先照表定比例內插到新的跑段上（剖面會再回填）；留置的通過站用重建的到離時刻。
 const passNodes=new Map(a.nodes.filter(n=>!n.stop).map(n=>[norm(n.name),n]));
 for(let r=0;r+1<real.length;r++){const k0=real[r],k1=real[r+1],d0=old[k0].dep,d1=old[k1].arr;
  for(let j=k0+1;j<k1;j++){const f=d1>d0?(old[j].arr-d0)/(d1-d0):0;S[j].arrSec=S[j].depSec=S[k0].depSec+f*(S[k1].arrSec-S[k0].depSec);
   const n=passNodes.get(norm(S[j].name));if(n?.held){S[j].arrSec=Math.round(n.arr-off);S[j].depSec=Math.round(n.dep-off);res.held.push({stop:S[j],arr:S[j].arrSec,dep:S[j].depSec});}}}
 // 通過站實測折點：千分比＝扣掉留置後的行駛時間比例（assignRunProfiles 在留置點把跑段切開時，照切點的千分比換算子跑段）。
 const heldSet=new Set(res.held.map(h=>h.stop));let ov=null;
 for(let r=0;r+1<real.length;r++){const k0=real[r],k1=real[r+1];if(k1-k0<2)continue;
  const inner=[];for(let j=k0+1;j<k1;j++)inner.push(j);
  const held=inner.filter(j=>heldSet.has(S[j])),knots=mode==='observed'?inner.filter(j=>{const n=passNodes.get(norm(S[j].name));return n&&!n.held&&/^obs-/.test(n.src);}):[];
  if(!held.length&&!knots.length)continue;
  ov??={...(passObsFile[tr.train]||{})};
  for(const j of inner)for(const k of [S[j].name,S[j].name.replace(/台/g,'臺'),S[j].name.replace(/臺/g,'台')])delete ov[k];
  const dep0=S[k0].depSec,M=S[k1].arrSec-dep0-held.reduce((t,j)=>t+S[j].depSec-S[j].arrSec,0);
  const mOf=t=>held.reduce((m,j)=>S[j].depSec<=t?m-(S[j].depSec-S[j].arrSec):m,t-dep0);
  let last=0;
  for(const j of inner){const isHeld=heldSet.has(S[j]),isKnot=knots.includes(j);if(!isHeld&&!isKnot)continue;
   const t=isHeld?S[j].arrSec:passNodes.get(norm(S[j].name)).arr-off,f=1000*mOf(t)/M;
   if(!(f>last&&f<1000)){if(isHeld)throw Error('留置通過站的千分比不在跑段內：'+tr.train+' '+S[j].name);res.dropped.push(S[j].name);continue;}
   ov[S[j].name]=f;last=f;if(isKnot){res.knots++;res.knotAt.push({j,t});}}
 }
 res.passObs=ov;return {...res,tr};
}
function buildAll(modes){
 const items=selected.map(v=>retime(v,modes.get(v.key))),trains=items.map(x=>x.tr),passObs={...passObsFile};
 for(const [i,x] of items.entries())if(x.passObs)passObs[selected[i].src.train]=x.passObs;
 const ctx=profilePipeline(trains,passObs);
 for(const x of items)if(x.held.length){for(const h of x.held){h.stop.arrSec=h.arr;h.stop.depSec=h.dep;h.stop._plannedDwell=true;}ctx.__reassign(x.tr);}
 for(const [i,tr] of trains.entries())tr.stops.forEach((s,k)=>{if(!(Number.isFinite(s.arrSec)&&Number.isFinite(s.depSec)&&s.depSec>=s.arrSec&&(!k||s.arrSec>=tr.stops[k-1].depSec)))throw Error('重建後時刻不單調：'+selected[i].key+' '+s.name);});
 return {items,trains,ctx};
}

// ── 綁股道：照表定綁到的計畫（同一份 pathIds），時刻換成實際值後以自訂計畫精確綁定 ──
const motion0=createPhysicalMotion(pack,profiles,dispatch);
const known=new Set();for(const [k,p] of Object.entries(dispatch.plans))if(k.startsWith('tra_sched:'))for(const s of JSON.parse(p.stopSignature))known.add(s[0]);
const reducedIdx=tr=>tr.stops.flatMap((s,i)=>isEnd(tr.stops,i)||known.has(stationKey('tra_sched',s.name))?[i]:[]);
const basePlans=selected.map((v,i)=>{const r=motion0.record(sched0[i]);if(!r)throw Error('照表定綁不到股道：'+v.key);
 const idx=reducedIdx(sched0[i]);if(JSON.stringify(idx)!==JSON.stringify(r.stopIndexes||sched0[i].stops.map((_,k)=>k)))throw Error('略過站與綁定不同：'+v.key);
 return {pathIds:r.plan.pathIds.slice(),basis:r.bindingBasis,sourceKey:r.sourceKey||null,idx};});
function customPlan(tr,pathIds){const idx=reducedIdx(tr),view={...tr,stops:idx.map(i=>tr.stops[i])};if(pathIds.length!==idx.length-1)throw Error('自訂計畫段數不符：'+tr.train);
 return {key:physicalTrainKey(view),plan:{pathIds,holds:idx.map(()=>({arrival:0,departure:0})),departureHolds:idx.map(()=>0),officialDelaySec:0,stopSignature:physicalStopSignature(view),templateEligible:false}};}

// ── 股道工具（單線反向用） ──
const topo=(()=>{const ways=pack.ways.filter(w=>w.system==='tra_sched'),nodes={};for(const w of ways)w.nodes.forEach((id,i)=>nodes[id]=w.coordinates[i]);
 return makeTopology({nodes,nodeTags:pack.nodeTags,systemByWay:Object.fromEntries(ways.map(w=>[w.id,w.system])),ways});})();
const wayIndex=new Map(pack.ways.map((w,i)=>[String(w.id),i]));
const walkNodes=rec=>{const ids=[];for(const [wi,start,count] of rec.walk){const w=pack.ways[wi],sign=Math.sign(count);for(let j=0;j<Math.abs(count);j++){const i=start+j*sign,a=i+(sign<0?1:0),b=i+(sign>0?1:0);if(!ids.length)ids.push(String(w.nodes[a]));ids.push(String(w.nodes[b]));}}return ids;};
const walkWays=rec=>new Set(rec.walk.map(([wi])=>wi));
const reverseRecord=rec=>({from:rec.to,to:rec.from,fromGroup:rec.toGroup,toGroup:rec.fromGroup,system:rec.system,lengthM:rec.lengthM,preference:rec.preference??0,
 walk:rec.walk.slice().reverse().map(([wi,s,c])=>c>0?[wi,s+c-1,-c]:[wi,s+1+c,-c])});
function walkFromPath(r){const walk=[];r.edgeIds.forEach((e,k)=>{const cut=e.lastIndexOf(':'),wi=wayIndex.get(e.slice(0,cut)),i=+e.slice(cut+1),w=pack.ways[wi],a=String(w.nodes[i]),b=String(w.nodes[i+1]);
  const el=r.nodeIds[k]===a&&r.nodeIds[k+1]===b?[wi,i,1]:r.nodeIds[k]===b&&r.nodeIds[k+1]===a?[wi,i,-1]:null;if(!el)throw Error('邊與節點對不上 '+e);
  const last=walk.at(-1);if(last&&last[0]===wi&&el[2]>0&&last[2]>0&&last[1]+last[2]===i)last[2]++;else if(last&&last[0]===wi&&el[2]<0&&last[2]<0&&last[1]+last[2]===i)last[2]--;else walk.push(el);});return walk;}
const nodeCoord=id=>topo.nodes.get(String(id))?.coordinate;
const headingOf=(a,b)=>{const x=nodeCoord(a),y=nodeCoord(b);return [(y[0]-x[0])*Math.cos(x[1]*Math.PI/180),y[1]-x[1]];};
// 派車表裡依序經過 names 的每一份連續切片（pathIds）；同一串只留一份並計次。
let sigCache=null;
function planSlices(names){
 sigCache??=Object.entries(dispatch.plans).filter(([k])=>k.startsWith('tra_sched:')).map(([k,p])=>({k,ids:p.pathIds,names:JSON.parse(p.stopSignature).map(s=>s[0])}));
 const want=names.map(n=>stationKey('tra_sched',n)),found=new Map();
 for(const s of sigCache)for(let i=0;i+want.length<=s.names.length;i++){if(!want.every((n,j)=>s.names[i+j]===n))continue;
  const ids=s.ids.slice(i,i+want.length-1),key=ids.join(',');if(!found.has(key))found.set(key,{ids,count:0,example:s.k});found.get(key).count++;}
 return [...found.values()].sort((a,b)=>b.count-a.count||(a.example<b.example?-1:1));
}

// ── 單線區間 ──
const inside=p=>p[0]>=cfg.bounds[0]&&p[0]<=cfg.bounds[2]&&p[1]>=cfg.bounds[1]&&p[1]<=cfg.bounds[3];
const SL=cfg.singleLine??null,SLN=SL?SL.stations.map(norm):[],ordSL=n=>SLN.indexOf(norm(n));
// 沒有單線雙向的日期（設定沒有 singleLine）：分析結果是空的，後面依賴它的段落自然什麼都不做。
const NO_SINGLE={overlaps:[],late:[],lastOverlapEnd:null,lastOverlap:null,fromSec:null,toSec:null,reversed:[],straddle:[],after:[],lastExit:null,lastSouth:null};
const dirOf=(tr,a,b)=>tr.stops[b].lat>tr.stops[a].lat?'北上':'南下';
// 取樣窗：選班站（第一個到最後一個）各往外一站；畫面外的部分取樣時再剪掉。
const windowOf=(v,tr)=>({a:Math.max(0,Math.min(...v.hits)-1),b:Math.min(tr.stops.length-1,Math.max(...v.hits)+1)});
// 子區間占用：相鄰兩站（北→南序相差 1）之間的 [離站, 到站]（當天秒）；leave＝離開到達站的時刻。
function sectionUse(v,tr){const S=tr.stops,out=[];
 for(let i=0;i+1<S.length;i++){const x=ordSL(S[i].name),y=ordSL(S[i+1].name);if(x<0||y<0||Math.abs(x-y)!==1)continue;
  out.push({sub:Math.min(x,y),dir:y>x?'南下':'北上',start:S[i].depSec+v.offset,end:S[i+1].arrSec+v.offset,leave:S[i+1].depSec+v.offset,to:S[i+1].name});}
 return out;}
function analyseSingleLine(trains){
 const use=selected.map((v,i)=>({i,u:sectionUse(v,trains[i])})).filter(x=>x.u.length),overlaps=[];
 for(const A of use)for(const B of use){if(A.i>=B.i)continue;
  for(const a of A.u)for(const b of B.u){if(a.sub!==b.sub||a.dir===b.dir)continue;const o0=Math.max(a.start,b.start),o1=Math.min(a.end,b.end);
   // 重疊在先離開子區間的那班抵達另一端時結束（endBy 記那一班與那一站）。
   if(o0<o1)overlaps.push({sub:SL.stations[a.sub]+'—'+SL.stations[a.sub+1],a:A.i,b:B.i,start:o0,end:o1,endBy:a.end<=b.end?{i:A.i,station:a.to}:{i:B.i,station:b.to}});}}
 // 起點＝官方封鎖之後最後一組對向重疊結束的下一個整分；起點落在「重疊結束」到這一分之間任何一刻，反向的班次都要相同。
 const late=overlaps.filter(o=>o.end>SL.officialSec),lastOverlapEnd=late.length?Math.max(...late.map(o=>o.end)):SL.officialSec,fromSec=Math.ceil(lastOverlapEnd/60)*60;
 const entry=x=>Math.min(...x.u.map(u=>u.start)),exit=x=>Math.max(...x.u.map(u=>u.end)),pair=new Set(late.flatMap(o=>[o.a,o.b]));
 const lastExit=use.reduce((b,x)=>!b||exit(x)>exit(b)?x:b,null),south=use.filter(x=>x.u[0].dir==='南下'),lastSouth=south.reduce((b,x)=>!b||entry(x)>entry(b)?x:b,null);
 // 反向：起點時仍在區間內、或之後才進入的南下列車（不含解不掉的重疊那幾班）。起點前就進入、起點後才離開的也算，
 // 因為那一段時間股道只剩一條；它們在區間內與對向車的會車由取樣後的占用檢查找出來。
 const revAt=t=>south.filter(x=>exit(x)>t&&!pair.has(x.i)).sort((a,b)=>entry(a)-entry(b)).map(x=>x.i);
 const reversed=revAt(fromSec);if(revAt(lastOverlapEnd).join()!==reversed.join())throw Error('單線起點的選法會改變反向的班次');
 return {overlaps,late,lastOverlapEnd,lastOverlap:late.find(o=>o.end===lastOverlapEnd)||null,fromSec,toSec:Math.max(...lastExit.u.map(u=>u.leave)),reversed,
  straddle:reversed.filter(i=>entry(use.find(x=>x.i===i))<fromSec),entryOf:i=>entry(use.find(x=>x.i===i)),exitOf:i=>exit(use.find(x=>x.i===i)),
  after:overlaps.filter(o=>o.end>fromSec),lastExit:lastExit.i,lastSouth:lastSouth.i};
}
// 其他班車的車站節點與區間股道占用，給反向路徑挑股道時算衝突。
function occupancy(trains,plans,skip,paths){
 const nodes=new Map(),ways=new Map(),add=(m,k,x)=>{(m.get(k)||m.set(k,[]).get(k)).push(x);};
 for(const [i,v] of selected.entries()){if(i===skip)continue;const tr=trains[i],{pathIds,idx}=plans[i],dir=dirOf(tr,0,tr.stops.length-1);
  pathIds.forEach((id,k)=>{const rec=paths[id],ns=walkNodes(rec),s0=tr.stops[idx[k]],s1=tr.stops[idx[k+1]];
   add(nodes,ns[0],{i,dir,a:s0.arrSec+v.offset,b:s0.depSec+v.offset});add(nodes,ns.at(-1),{i,dir,a:s1.arrSec+v.offset,b:s1.depSec+v.offset});
   for(const wi of walkWays(rec))add(ways,wi,{i,dir,a:s0.depSec+v.offset,b:s1.arrSec+v.offset});});}
 return {nodes,ways};
}
// 南下列車改走北上股道反向：區間內每一段換成派車表裡北上列車那一段的反向；區間兩端各找一條股道資料既有的渡線
// （找不到就把反向段往外延伸一站再找）。候選依「與其他班車的股道衝突數、派車表使用次數、總長」排序。
function reverseChain(ti,trains,plans,paths){
 const v=selected[ti],tr=trains[ti],{idx,pathIds:ids}=plans[ti],stopsR=idx.map(i=>tr.stops[i]),names=stopsR.map(s=>s.name);
 const secSegs=ids.map((_,k)=>k).filter(k=>ordSL(names[k])>=0&&ordSL(names[k+1])>=0&&Math.abs(ordSL(names[k])-ordSL(names[k+1]))===1);
 if(!secSegs.length)return {error:'不經過單線區間'};
 const occ=occupancy(trains,plans,ti,paths),margin=60,dir='南下',cands=[],tw=SL.tainanPlatformWay?wayIndex.get(String(SL.tainanPlatformWay)):null;
 for(let total=0;total<=6&&!cands.length;total++)for(let e=0;e<=Math.min(3,total);e++){const x=total-e;
  // 反向段從 k0 到 k1；起點站或終點站就在反向段的端點時，那一端不用接渡線。
  const k0=secSegs[0]-e,k1=secSegs.at(-1)+x,inK=k0-1,outK=k1+1;if(k0<0||k1>=ids.length)continue;
  const hasIn=inK>=0,hasOut=outK<ids.length,firstK=hasIn?inK:k0;
  const sbNames=names.slice(k0,k1+2),ti2=sbNames.findIndex(n=>norm(n)===norm('臺南'));
  for(const sl of planSlices(sbNames.slice().reverse())){
   const rev=sl.ids.slice().reverse().map(id=>reverseRecord(paths[id]));
   if(tw!=null&&ti2>=0&&![rev[ti2-1],rev[ti2]].filter(Boolean).some(r=>walkWays(r).has(tw)))continue;
   const revNodes=rev.map(walkNodes),lastRev=revNodes.at(-1);let recIn=null,recOut=null;
   if(hasIn){const baseIn=paths[ids[inK]],n=walkNodes(baseIn);
    const pIn=topo.shortestPath({from:n[0],to:revNodes[0][0],system:'tra_sched',startVector:headingOf(n[0],n[1]),endVector:headingOf(revNodes[0][0],revNodes[0][1]),maxLength:baseIn.lengthM*1.5+1000});
    if(!pIn)continue;recIn={from:baseIn.from,to:rev[0].from,fromGroup:baseIn.fromGroup,toGroup:rev[0].fromGroup,system:'tra_sched',lengthM:pIn.lengthM,preference:0,walk:walkFromPath(pIn)};}
   if(hasOut){const baseOut=paths[ids[outK]],n=walkNodes(baseOut);
    const pOut=topo.shortestPath({from:lastRev.at(-1),to:n.at(-1),system:'tra_sched',startVector:headingOf(lastRev.at(-2),lastRev.at(-1)),endVector:headingOf(n.at(-2),n.at(-1)),maxLength:baseOut.lengthM*1.5+1000});
    if(!pOut)continue;recOut={from:rev.at(-1).to,to:baseOut.to,fromGroup:rev.at(-1).toGroup,toGroup:baseOut.toGroup,system:'tra_sched',lengthM:pOut.lengthM,preference:0,walk:walkFromPath(pOut)};}
   const recs=[...(recIn?[recIn]:[]),...rev,...(recOut?[recOut]:[])],conflicts=new Map();
   // 衝突：與對向列車同一條股道、時間重疊；停站（含留置的通過站、起訖站）與其他班車同一個車站節點、時間重疊（前後各留 60 秒）。
   const nodeConflict=(n,k)=>{const s0=stopsR[k],sa=s0.arrSec+v.offset-margin,sb=s0.depSec+v.offset+margin;
    for(const o of occ.nodes.get(n)||[])if(o.a<sb&&sa<o.b)conflicts.set('node|'+names[k]+'|'+o.i,{kind:'node',station:names[k],node:n,train:selected[o.i].key,start:Math.max(sa,o.a),end:Math.min(sb,o.b)});};
   recs.forEach((rec,j)=>{const k=firstK+j,s0=stopsR[k],s1=stopsR[k+1],a=s0.depSec+v.offset,b=s1.arrSec+v.offset,ns=walkNodes(rec);
    for(const wi of walkWays(rec))for(const o of occ.ways.get(wi)||[])if(o.dir!==dir&&o.a<b&&a<o.b)
     conflicts.set('way|'+names[k]+'|'+o.i,{kind:'way',seg:names[k]+'→'+names[k+1],way:pack.ways[wi].id,train:selected[o.i].key,start:Math.max(a,o.a),end:Math.min(b,o.b)});
    if(j||!hasIn)nodeConflict(ns[0],k);if(j===recs.length-1&&!hasOut)nodeConflict(ns.at(-1),k+1);});
   cands.push({e,x,inK,outK,hasIn,hasOut,firstK,lastK:firstK+recs.length-1,slice:{count:sl.count,example:sl.example,ids:sl.ids},recs,conflicts:[...conflicts.values()],length:recs.reduce((t,r)=>t+r.lengthM,0)});
  }
 }
 if(!cands.length)return {error:'股道資料裡找不到可用的渡線'};
 cands.sort((a,b)=>a.conflicts.length-b.conflicts.length||b.slice.count-a.slice.count||a.length-b.length);
 return {ti,secSegs,best:cands[0],alternatives:cands.map(c=>({e:c.e,x:c.x,count:c.slice.count,conflicts:c.conflicts.length,lengthM:Math.round(c.length)}))};
}

// ── 地下化（設定的 underground；設計文件第 3、4 節） ──
// model.json 的外框 ring 與 profile.json 的參考線、控制點都是世界座標公尺（x=(lon−lon0)·111320·cos(lat0)、y=(lat−lat0)·111320）。
// 軌道面高程 z：點落在隧道、站體、U 槽外框內才取 z(d)，d 是點投影到參考線的累計長度、控制點之間線性；框外是地面 0。
const EDGE_M=.02;
const UG=cfg.underground&&(()=>{
 const U=cfg.underground,model=JSON.parse(fs.readFileSync(repoFile(U.model),'utf8')),profile=JSON.parse(fs.readFileSync(repoFile(U.profile),'utf8'));
 if(String(model.origin)!==String(profile.origin)||String(profile.origin)!==String(cfg.origin))throw Error('地下化的 model.json、profile.json 與設定的原點不一致');
 const [lon0,lat0]=profile.origin,kx=111320*Math.cos(lat0*Math.PI/180),P=profile.reference.points,CP=profile.controlPoints;
 const world=c=>[(c[0]-lon0)*kx,(c[1]-lat0)*111320];
 const project=([x,y])=>{let best=null;
  for(let i=0;i+1<P.length;i++){const [ax,ay,ad]=P[i],[bx,by,bd]=P[i+1],vx=bx-ax,vy=by-ay,L2=vx*vx+vy*vy,t=L2?Math.max(0,Math.min(1,((x-ax)*vx+(y-ay)*vy)/L2)):0,dist=Math.hypot(x-(ax+t*vx),y-(ay+t*vy));
   if(!best||dist<best.dist)best={d:ad+t*(bd-ad),dist};}
  return best;};
 const zOfD=d=>{if(d<=CP[0].d)return CP[0].z;for(let i=1;i<CP.length;i++)if(d<=CP[i].d)return CP[i-1].z+(CP[i].z-CP[i-1].z)*(d-CP[i-1].d)/(CP[i].d-CP[i-1].d);return CP.at(-1).z;};
 const rings=model.footprints.filter(f=>U.footprintKinds.includes(f.kind)).map(f=>f.ring);
 const inRing=([x,y],ring)=>{let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c;}return c;};
 // 外框邊上的頂點也算框內：南洞口的節點剛好落在 U 槽與隧道兩個外框的共用邊上，只看「在多邊形內」兩邊都不算，z 會在洞口跳回 0。
 const segDist=([x,y],[ax,ay],[bx,by])=>{const vx=bx-ax,vy=by-ay,L2=vx*vx+vy*vy,t=L2?Math.max(0,Math.min(1,((x-ax)*vx+(y-ay)*vy)/L2)):0;return Math.hypot(x-(ax+t*vx),y-(ay+t*vy));};
 const onRing=(q,ring)=>ring.some((a,i)=>segDist(q,ring[(i+ring.length-1)%ring.length],a)<=EDGE_M);
 const inFootprint=q=>rings.some(r=>inRing(q,r)||onRing(q,r));
 const zAt=c=>{const q=world(c);return inFootprint(q)?+zOfD(project(q).d).toFixed(3):0;};
 // 模型用的那一組股道（OSM way id）：路線與軌道在框內的線段應該都落在這一組裡。
 const al=model.params.alignment,wayIds=new Set([...al.referenceChain.ways,...al.eastChain,...['tunnel','cuttingSouth','cuttingNorth','atGradeSouth','atGradeNorth','stationLoops'].flatMap(k=>Object.values(al[k]))].map(String));
 return {model,profile,world,project,zOfD,inFootprint,zAt,wayIds,platform:profile.derived.platform,maxSlope:profile.maxAbsSlopePermille};
})();

// ── 臺南站的停靠點：整列中心停在月台中央 ──
// 股道資料推定的停靠點（network.json 的 inferredStops）在月台南端外約 127 公尺，不用它。
// 停靠點進入運動計算的地方是 route.offsets（每段路徑起點的里程）：sample() 用它算停站位置，也拿它當兩側跑段的端點。
// 這裡把臺南那一格換成月台中央的里程；進站、出站兩段仍照原本的速度剖面走完整段（剖面比例 f 由 0 到 1），
// 位置隨時間連續，沒有事後平移或跳點。取樣點是整列中心：replay.js 的 arrange 以編組中心為基準排車身。
const TAINAN=UG&&{name:norm(cfg.underground.stopStation),searchM:600,stepM:.5};
function platformChainage(route,O){
 const C=UG.platform.centerD,dAt=s=>UG.project(UG.world(route.path.at(Math.max(0,Math.min(route.path.length,s))).coordinate)).d,lo=Math.max(0,O-TAINAN.searchM),hi=Math.min(route.path.length,O+TAINAN.searchM),roots=[];
 let s0=lo,d0=dAt(lo);
 for(let s=lo+TAINAN.stepM;s<=hi+1e-9;s+=TAINAN.stepM){const d1=dAt(s);
  if((d0-C)*(d1-C)<=0&&d0!==d1){let a=s0,b=s;for(let k=0;k<60;k++){const m=(a+b)/2;if((dAt(m)-C)*(d0-C)<=0)b=m;else a=m;}roots.push((a+b)/2);}
  s0=s;d0=d1;}
 if(!roots.length)throw Error('月台中央（d='+C+'）不在這條路線離臺南停靠點 '+TAINAN.searchM+' 公尺內：'+route.id);
 roots.sort((x,y)=>Math.abs(x-O)-Math.abs(y-O));
 return {N:roots[0],roots:roots.length,dAtO:dAt(O)};
}
function withTainanStop(base){
 if(!UG)return base;
 const jOf=new WeakMap(),done=new WeakMap(),patched=new Map();
 function sample(tr,t,opts){
  const p=base.sample(tr,t,opts);if(!p)return p;
  const r=base.record(tr);let j=jOf.get(tr);if(j===undefined){j=r.stops.findIndex(x=>norm(x.name)===TAINAN.name);jOf.set(tr,j);}
  // 這次取樣用到的兩格邊界是 segmentIndex 與 segmentIndex+1（sample() 的 i 與 i+1；停在終點站時 segmentIndex 比 i 小 1，仍是同兩格）。
  if(j<0||j<r.routeFrom||j>r.routeTo||(j!==p.segmentIndex&&j!==p.segmentIndex+1))return p;
  const route=p.route,b=j-r.routeFrom;let set=done.get(route);if(!set)done.set(route,set=new Set());
  if(set.has(b))return p;
  set.add(b);
  const O=route.offsets[b],{N,roots,dAtO}=platformChainage(route,O),prev=route.offsets[b-1]??-Infinity,next=route.offsets[b+1]??Infinity;
  if(!(N>prev&&N<next))throw Error('月台中央的里程落在相鄰車站之外：'+route.id+' 邊界 '+b+' '+prev+' < '+N+' < '+next);
  route.offsets[b]=N;
  const at=route.path.at(N);
  patched.set(route.id+'#'+b,{route:route.id,boundary:b,fromM:+O.toFixed(3),toM:+N.toFixed(3),shiftM:+(N-O).toFixed(3),dAtOldStop:+dAtO.toFixed(2),roots,
   lateralM:+UG.project(UG.world(at.coordinate)).dist.toFixed(2),legM:[+prev.toFixed(1),+next.toFixed(1)]});
  return base.sample(tr,t,opts);
 }
 return {...base,sample,patched};
}

// 停靠點移到月台中央後，進站、出站兩段的實體路徑長各增減同一個距離（shift＝月台中央離原停靠點的里程，往行駛方向為正）。
// 變長的那一段，剖面的站間長度要補到實體路徑長（physKm，與單線反向段同一套做法）：點速＝剖面速度×(實體長÷剖面長)，
// 剖面長不小於實體長才保證點速不超過極速；沒補的話貼著極速巡航的班次會超過一點點。變短的那一段不動（剖面長取較大者）。
function tainanFit(trains,plans,ctx,pack2){
 const geoT=createRouteRuntime(pack2,profiles),shifts=new Map(),fits=[];
 const shiftOf=(pIn,pOut)=>{const key=pIn+'|'+pOut;if(shifts.has(key))return shifts.get(key);
  const route=geoT.route([pIn,pOut].filter(x=>x!=null),'tra_sched','#000',{prefixM:pIn==null?250:0,suffixM:pOut==null?250:0}),O=route.offsets[pIn==null?0:1],v=platformChainage(route,O).N-O;
  shifts.set(key,v);return v;};
 for(const [ti,tr] of trains.entries()){
  const {idx,pathIds}=plans[ti],k=idx.findIndex(a=>norm(tr.stops[a].name)===TAINAN.name);if(k<0)continue;
  const pIn=k>0?pathIds[k-1]:null,pOut=k<pathIds.length?pathIds[k]:null,shift=shiftOf(pIn,pOut);
  for(const [seg,pid,delta] of [[k-1,pIn,shift],[k,pOut,-shift]]){
   if(pid==null)continue;
   const a=idx[seg],b=idx[seg+1],lenM=geoT.unfold(pid).path.length+delta,seg0=Array.from(ctx.__segKm(tr.stops)).slice(a,b),sum=seg0.reduce((t,x)=>t+x,0);
   if(lenM/1000>sum+1e-9){for(let i=a;i<b;i++)tr.stops[i].physKm=seg0[i-a]*lenM/1000/sum;
    fits.push({train:tr.train,from:tr.stops[a].name,to:tr.stops[b].name,profileKm:+sum.toFixed(4),pathKm:+(lenM/1000).toFixed(4),shiftM:+delta.toFixed(2)});}}
  if(fits.some(f=>f.train===tr.train))ctx.__reassign(tr);
 }
 return fits;
}

// ── 主流程：重建 → 綁股道 → 單線反向 → 點速檢查；超速的班次換模式重來 ──
function assemble(modes){
 const built=buildAll(modes),{trains,ctx}=built,plans=basePlans.map(b=>({pathIds:b.pathIds.slice(),idx:b.idx}));
 // network.json 的 paths 是以數字字串為鍵的物件；反向段接在最大編號之後。
 const single=SL?analyseSingleLine(trains):NO_SINGLE,pack2={...pack,paths:{...pack.paths}},chains=[],customIds=new Set();
 let nextId=Math.max(...Object.keys(pack.paths).map(Number))+1;
 for(const ti of single.reversed){const c=reverseChain(ti,trains,plans,pack2.paths);if(c.error)throw Error('單線反向路徑：'+selected[ti].key+' '+c.error);
  c.newIds=c.best.recs.map(r=>{const id=nextId++;pack2.paths[id]=r;customIds.add(id);return id;});plans[ti].pathIds.splice(c.best.firstK,c.best.recs.length,...c.newIds);chains.push(c);
  // 反向路徑比剖面用的段長長時，把剖面建在實際走的長度上，點速才不會超過極速（schedSegKmOf 取 physKm 與示意長的較大者）。
  const tr=trains[ti],{idx}=plans[ti];c.physKm=[];
  c.best.recs.forEach((rec,j)=>{const k=c.best.firstK+j,a=idx[k],b=idx[k+1],km=rec.lengthM/1000,seg=Array.from(ctx.__segKm(tr.stops)).slice(a,b),sum=seg.reduce((t,x)=>t+x,0);
   if(km>sum+1e-9){for(let i=a;i<b;i++)tr.stops[i].physKm=seg[i-a]*km/sum;c.physKm.push({from:tr.stops[a].name,to:tr.stops[b].name,profileKm:+sum.toFixed(4),pathKm:+km.toFixed(4)});}});
  if(c.physKm.length)ctx.__reassign(tr);
 }
 const tainanFits=UG?tainanFit(trains,plans,ctx,pack2):[],dispatch2={...dispatch,plans:{...dispatch.plans}};
 for(const [i,tr] of trains.entries()){const {key,plan}=customPlan(tr,plans[i].pathIds);dispatch2.plans[key]=plan;}
 const motion=withTainanStop(createPhysicalMotion(pack2,profiles,dispatch2)),geo=createRouteRuntime(pack2,profiles),joins=[];
 for(const [i,tr] of trains.entries()){const r=motion.record(tr);if(!r||r.bindingBasis!=='exact'||r.plan.pathIds.join()!==plans[i].pathIds.join())throw Error('自訂計畫沒有精確綁定：'+selected[i].key+' '+r?.bindingBasis);
  for(let k=1;k<plans[i].pathIds.length;k++)if(!geo.joinable(plans[i].pathIds[k-1],plans[i].pathIds[k]))joins.push({key:selected[i].key,k,at:tr.stops[plans[i].idx[k]].name,custom:customIds.has(plans[i].pathIds[k])||customIds.has(plans[i].pathIds[k-1])});}
 if(joins.some(j=>j.custom))throw Error('反向路徑接不上：'+JSON.stringify(joins.filter(j=>j.custom)));
 // 點速：每 0.5 秒差分實體取樣器的里程（換路段時把新位置投回舊路段），範圍＝取樣窗。
 const speed=selected.map((v,i)=>{const tr=trains[i],r=motion.record(tr),{a,b}=windowOf(v,tr),cap=ctx.__perf(tr).v;let prev=null,max=0,maxIn=0;const over=[];
  for(let t=Math.floor(r.schedule[a].arrSec);t<=Math.ceil(r.schedule[b].depSec);t+=.5){const p=motion.sample(tr,t,{wrap:(s,x)=>x});if(!p){prev=null;continue;}
   if(prev){let ds=null;if(p.route.id===prev.route.id)ds=p.chainageM-prev.chainageM;else{const loc=prev.route.path.locate([p.lon,p.lat],prev.chainageM);if(loc&&loc.error<.5)ds=loc.s-prev.chainageM;}
    if(ds!=null){const kmh=Math.abs(ds)/.5*3.6;if(kmh>max)max=kmh;if(inside([p.lon,p.lat])&&kmh>maxIn)maxIn=kmh;if(kmh>cap+1e-6)over.push({t:t+v.offset,kmh:+kmh.toFixed(2)});}}
   prev=p;}
  return {cap,max,maxIn,over};});
 return {...built,plans,single,chains,pack2,motion,speed,joins,tainanFits};
}
const modes=new Map(selected.map(v=>[v.key,'observed'])),rounds=[];let A;
for(let round=0;;round++){
 A=assemble(modes);const bad=selected.flatMap((v,i)=>A.speed[i].over.length?[i]:[]);
 rounds.push(bad.map(i=>({key:selected[i].key,mode:modes.get(selected[i].key),max:+A.speed[i].max.toFixed(2),cap:A.speed[i].cap,first:A.speed[i].over[0]})));
 if(!bad.length)break;
 if(bad.some(i=>A.items[i].mode==='scheduled'))throw Error('表定時刻也超速（股道或剖面問題，不是重建時刻）：'+JSON.stringify(rounds.at(-1)));
 for(const i of bad){const k=selected[i].key;modes.set(k,A.items[i].mode==='observed'?'no-knots':'scheduled');}
}
const {trains,items,ctx,plans,single,chains,motion}=A;
// 剖面有沒有真的通過實測折點：index.html 的 buildObsProfile 對折點之間的平均速度設上限，超過就丟折點，丟光就退回梯形，
// 通過站改由梯形回填，不留任何紀錄。tainan_actuals.py 的折點閘門讓重建時刻本身過得了那道上限；這裡複驗畫面範圍內每顆折點的
// 回填時刻與重建時刻相差 ≤1 秒（剖面把折點時刻取整到秒），不符就停，不讓偏掉的時刻帶著實測標籤出貨。
const knotCheck={checked:0,maxDevSec:0};
{const miss=[];
 for(const [i,x] of items.entries()){if(x.mode!=='observed')continue;const tr=trains[i],{a,b}=windowOf(selected[i],tr);
  for(const k of x.knotAt){if(k.j<a||k.j>b)continue;const dev=Math.abs(tr.stops[k.j].arrSec-k.t);knotCheck.checked++;knotCheck.maxDevSec=Math.max(knotCheck.maxDevSec,+dev.toFixed(2));
   if(dev>1)miss.push({key:selected[i].key,station:tr.stops[k.j].name,knot:Math.round(k.t+selected[i].offset),drawn:Math.round(tr.stops[k.j].arrSec+selected[i].offset)});}}
 if(miss.length)throw Error('剖面沒有通過實測折點（重建時刻過不了 buildObsProfile 的速度上限）：'+JSON.stringify(miss));}

// ── 編組：與主站 carModelOf 相同的輸入（specialOf 的車型、支線、具名列車；具名列車依營運日） ──
const ctxF=makeSandbox(indexPath,readSpecial(repoFile('data/tra_special_trains.json')));
ctxF.state.special._hasDated=ctxF.state.special.namedTrains.some(n=>n.trainNosByDate);
runInContext('function traRunDay(tr){return tr._runDay||null;}',ctxF);
const formationOf=v=>{const s=v.src,sp=ctxF.specialOf({sys:'tra_sched',train:s.train,carName:s.carName,typeName:s.typeName,stops:s.stops,_runDay:v.day});
 const spec=formationFor({systemId:'tra_sched',carName:s.carName,typeName:s.typeName,stockId:sp?.stock?.id,branchId:sp?.branch?.id,namedId:sp?.named?.id},'actual');
 return {spec,formation:assembleFormation(spec,manifest),plain:formationFor({systemId:'tra_sched',carName:s.carName},'actual'),
  special:{stock:sp?.stock?.id||null,branch:sp?.branch?.id||null,named:sp?.named?.id||null}};};

// ── 取樣（與 9/12 相同：逐秒、只留畫面範圍內；換路段時把新位置投回舊路段，接縫 ≤ 0.1 m）。取樣點是整列中心。──
const routes=[],routeObjs=[],routeKeys=new Map(),outTrains=[],formRows=[];
// 起點站的紀錄是看板佔位，重建只用它的誤點分鐘推開車時刻（dep-only）：這一列沒有到站，來源記推定（est），不記實測。
const srcOf=n=>!n?null:/^obs-/.test(n.src)?'obs':/^dep-only-/.test(n.src)?'est':n.src==='sched'?'sched':'interp';
for(const [i,v] of selected.entries()){
 const tr=trains[i],r=motion.record(tr),{a,b}=windowOf(v,tr),mode=items[i].mode;
 const start=Math.max(-v.offset,Math.floor(r.schedule[a].arrSec)),end=Math.min(86399-v.offset,Math.ceil(r.schedule[b].depSec));
 const spans=[];let span=null,old=null;
 for(let t=start;t<=end;t++){
  const p=motion.sample(tr,t,{wrap:(s,x)=>x});if(!p||!inside([p.lon,p.lat])){span=null;old=null;continue;}
  if(!routeKeys.has(p.route.id)){routeKeys.set(p.route.id,routes.length);routes.push({id:p.route.id,coordinates:p.route.coordinates});routeObjs.push(p.route);}
  const ri=routeKeys.get(p.route.id),sec=t+v.offset;
  if(!span||span.route!==ri){
   if(span&&old){const loc=old.route.path.locate([p.lon,p.lat],old.chainageM);if(!loc||loc.error>.1)throw Error('路段切換不連續 '+v.key);span.s.push(+loc.s.toFixed(3));}
   span={route:ri,start:sec,s:[]};spans.push(span);
  }
  span.s.push(+p.chainageM.toFixed(3));old=p;
 }
 if(!spans.length)throw Error('範圍內沒有任何一秒在畫面內：'+v.key);
 const F=formationOf(v);
 formRows.push({key:v.key,train:String(tr.train),carName:tr.carName,typeName:tr.typeName,id:F.spec.id,cars:F.formation.parts.length,parts:F.formation.parts.map(p=>p.mesh),
  plainId:F.plain.id,plainCars:F.plain.lengths.length,special:F.special,lengthM:+F.formation.lengthM.toFixed(2)});
 const nodeOf=new Map(v.act.nodes.map(n=>[norm(n.name),n])),observed=mode!=='scheduled';
 // 通過站只有兩種情形取自實測：被留置（到離時刻直接用重建值），或是剖面通過的折點（上面已複驗）。其餘通過站的時刻是剖面回填的，
 // 例如 no-knots 模式整班不放折點，該站即使有紀錄也標內插。
 const knotIdx=new Set(items[i].knotAt.map(k=>k.j)),srcAt=(s,j)=>{const n=nodeOf.get(norm(s.name)),x=srcOf(n)||'interp';
  return x==='obs'&&s.stop===false&&!n.held&&!(mode==='observed'&&knotIdx.has(j))?'interp':x;};
 const stops=tr.stops.slice(a,b+1).map((s,k)=>{const o=v.src.stops[a+k];
  // 通過站的時刻是剖面回填的小數秒；頁面與時間軸只用到整秒（四捨五入不破壞先後順序）。
  // end：這班車的起點站與終點站（照班表的第一站、最後一站）。起點的到站與開車同一秒＝沒有到站，終點同理沒有開車。
  return {name:s.name,arrSec:Math.round(s.arrSec+v.offset),depSec:Math.round(s.depSec+v.offset),stop:s.stop!==false,schedArrSec:Math.round(o.arrSec+v.offset),schedDepSec:Math.round(o.depSec+v.offset),
   src:observed?srcAt(s,a+k):'sched',holdSec:Math.max(0,Math.round((s.depSec-s.arrSec)-(o.depSec-o.arrSec))),
   ...(a+k===0&&{end:'origin'}),...(a+k===v.src.stops.length-1&&{end:'terminal'})};});
 const row={id:v.key,train:String(tr.train),typeName:tr.typeName,carName:tr.carName,color:tr.color,serviceDate:v.day,direction:dirOf(tr,a,b),
  timing:mode==='scheduled'?'scheduled':'observed',formation:F.formation,spans,stops};
 const mark=(cfg.marks||[]).find(m=>m.train===String(tr.train)&&m.serviceDate===v.day);if(mark)row.mark=mark.mark;
 if(mode!=='observed'&&v.act.timing!=='scheduled')row.timingFallback=mode;
 outTrains.push(row);
}
// 重點車的身分從重建結果複驗：最後一班離開單線區間、最後一班南下進入區間。
for(const m of cfg.marks||[]){const w=m.mark==='last-ground'?selected[single.lastExit]:m.mark==='last-south'?selected[single.lastSouth]:null;
 if(!w||String(w.src.train)!==m.train||w.day!==m.serviceDate)throw Error('重點車身分與重建結果不符：'+m.mark+' 設定 '+m.train+'，重建 '+w?.key);}

// ── 軌道面高程 z（逐頂點，與 coordinates 一一對應；整條都在地面的不寫 z） ──
// 檢查：(1) 相鄰兩頂點的高程差 ≤ 剖面最大坡度×距離＋容差（框邊 z 要回到 0，頂點稀疏時才不會出現陡坡）；
// (2) 框內頂點離參考線的最大垂距（路線與模型是不是同一組股道）；(3) 框內線段的 OSM way 都在模型用的那一組裡。
const ZTOL_M=.05;
function addZ(list){for(const it of list){const z=it.coordinates.map(UG.zAt);if(z.some(v=>v!==0))it.z=z;}}
function zCheck(list,edgesOf){
 const st={items:list.length,withZ:0,vertices:0,inFootprint:0,minZ:0,maxZ:0,worstExcessM:-Infinity,worstAt:null,lateralMaxM:0,lateralAt:null,wayOutside:{}};
 for(const [li,it] of list.entries()){
  const W=it.coordinates.map(UG.world),inF=W.map(UG.inFootprint);st.vertices+=W.length;
  W.forEach((q,k)=>{if(!inF[k])return;st.inFootprint++;const pr=UG.project(q);if(pr.dist>st.lateralMaxM){st.lateralMaxM=+pr.dist.toFixed(2);st.lateralAt={id:it.id,k,d:+pr.d.toFixed(1)};}});
  if(it.z){st.withZ++;for(const v of it.z){if(v<st.minZ)st.minZ=v;if(v>st.maxZ)st.maxZ=v;}
   for(let k=1;k<W.length;k++){const dist=Math.hypot(W[k][0]-W[k-1][0],W[k][1]-W[k-1][1]),ex=Math.abs(it.z[k]-it.z[k-1])-UG.maxSlope/1000*dist;
    if(ex>st.worstExcessM){st.worstExcessM=+ex.toFixed(3);st.worstAt={id:it.id,k,distM:+dist.toFixed(2),dz:+(it.z[k]-it.z[k-1]).toFixed(3)};}}}
  const E=edgesOf(li,it);
  if(E)for(let k=0;k<W.length-1;k++){if(inF[k]&&inF[k+1]){const w=String(E[k]?.wayId??E[k]?.id);if(!UG.wayIds.has(w))st.wayOutside[w]=(st.wayOutside[w]||0)+1;}}
  else if(inF.some(Boolean)&&!UG.wayIds.has(String(it.id)))st.wayOutside[it.id]=inF.filter(Boolean).length;
 }
 if(st.worstExcessM>ZTOL_M)throw Error('高程坡度超過剖面上限（容差 '+ZTOL_M+' m）：'+JSON.stringify(st.worstAt)+' 超出 '+st.worstExcessM+' m');
 return st;
}
const zRoutes=UG&&(()=>{addZ(routes);return zCheck(routes,(i)=>routeObjs[i].edges);})();

// ── 時間軸：觀測類的時刻一律取自上面的重建結果 ──
const byNo=(train,day)=>outTrains.find(t=>t.train===String(train)&&t.serviceDate===day);
const stopOf=(t,name)=>t?.stops.find(s=>norm(s.name)===norm(name));
const hms=x=>[Math.floor(x/3600),Math.floor(x%3600/60),x%60].map(n=>String(n).padStart(2,'0')).join(':'),hm=x=>hms(x).slice(0,5);
// 單線起點的推導依據：官方封鎖後最後一組對向重疊，在哪一班抵達哪一站時結束（時間軸那一列與 singleLine.basis 共用）。
const LO=single.lastOverlap,slBasis=!SL?null:{rule:'官方封鎖之後，最後一組對向重疊（同一子區間、方向相反、時間重疊）結束後的下一個整分',officialSec:SL.officialSec,fromSec:single.fromSec,
 lastOverlap:LO&&(()=>{const e=outTrains[LO.endBy.i],s=stopOf(e,LO.endBy.station);if(!s||Math.abs(s.arrSec-LO.end)>.5)throw Error('最後一組重疊的結束時刻對不上 '+e.train+' 在 '+LO.endBy.station);
  return {sub:LO.sub,trains:[outTrains[LO.a].train,outTrains[LO.b].train],trainIds:[outTrains[LO.a].id,outTrains[LO.b].id],start:Math.floor(LO.start),end:s.arrSec,
   endBy:{train:e.train,trainId:e.id,station:s.name,field:'arrSec',src:s.src}};})()};
if(slBasis?.lastOverlap&&Math.ceil(slBasis.lastOverlap.end/60)*60!==single.fromSec)throw Error('單線起點與最後一組重疊的結束時刻不一致');
const DEP_RULE='離站時刻依誤點分鐘推得：表定離站＋max(0, 60×誤點分鐘−30) 秒，不早於到站＋20 秒；TDX 只記到站與誤點分鐘，誤點只到分鐘，誤差約一分鐘';
const events=(cfg.officialEvents||[]).map(e=>({...e}));
if(SL)events.push({id:'single-line-start',t:single.fromSec,text:SL.section.join('—')+'改單線雙向',kind:'inferred',
 ref:{basis:'last-opposing-overlap',rule:slBasis.rule,lastOverlap:slBasis.lastOverlap}});
for(const d of cfg.observedEvents||[]){
 const t=byNo(d.train,d.serviceDate),s=stopOf(t,d.station);if(!s)throw Error('時間軸找不到 '+d.train+' 在 '+d.station);
 const sec=s[d.field];let text=d.text.replace('{train}',t.train),wait=null,other=null;
 if(d.wait){const cands=outTrains.filter(u=>u!==t&&u.direction===d.wait.direction).map(u=>({u,x:stopOf(u,d.wait.at)})).filter(({x})=>x&&x.arrSec>=s.arrSec&&x.arrSec<=s.depSec);
  if(cands.length!==1)throw Error('時間軸「'+d.id+'」等的車不是唯一一班：'+cands.map(c=>c.u.train));
  wait={trainId:cands[0].u.id,train:cands[0].u.train,arrSec:cands[0].x.arrSec,src:cands[0].x.src};text=text.replace('{wait}',wait.train);}
 if(d.other){const u=byNo(d.other.train,d.other.serviceDate),x=stopOf(u,d.station);if(!(x&&x.arrSec<=sec&&sec<=x.depSec))throw Error('交會時刻不在對方停站時間內：'+d.id);
  other={trainId:u.id,train:u.train,arrSec:x.arrSec,depSec:x.depSec};text=text.replace('{other}',u.train);}
 // follow:'other'：點這一列跟的是對方那班（頁面依 train 跟車）；時刻與來源仍取 train 那班在該站的紀錄。
 if(d.follow!==undefined&&!(d.follow==='other'&&other))throw Error('時間軸「'+d.id+'」的 follow 只能是 other，而且要有 other');
 if(d.claim==='last-departure'&&outTrains.some(u=>u!==t&&stopOf(u,d.station)?.stop&&stopOf(u,d.station).depSec>sec))throw Error('不是最後一班離開 '+d.station);
 if(d.claim==='last-section-exit'&&selected[single.lastExit].key!==t.id)throw Error('不是最後一班離開單線區間');
 // 只有到站／通過時刻取自實測紀錄（起站的紀錄是看板佔位，不算）。離站時刻是表定離站加上誤點分鐘推得（TDX 不記離站），
 // 誤點只到分鐘，誤差約一分鐘，一律標推定。
 const node=selected.find(x=>x.key===t.id).act.nodes.find(n=>norm(n.name)===norm(s.name)),measured=d.field==='arrSec'&&s.src==='obs'&&/^obs-/.test(node?.src||'');
 events.push({id:d.id,t:sec,text,kind:measured?'observed':'inferred',train:(d.follow==='other'?other:t).train,ref:{trainId:t.id,station:s.name,field:d.field,src:s.src,
  ...(d.field==='depSec'&&{basis:'delay-minutes',rule:DEP_RULE}),...(wait&&{wait}),...(other&&{other})}});
}
events.sort((a,b)=>a.t-b.t);

// ── 單線占用檢查（畫面範圍內、逐秒）：車身＝中心前後各半個列車長，長度取 max(編組長, 車輛目錄的節距加總)，
// 與 replay.js 排車身用的長度一致。對向兩班車身蓋到同一條 way＝在同一條線上對撞，一律列進不確定時段。──
const catalog=readRepo(cfg.dir+'/fleet/catalog.json');
const lengthOf=f=>{const c=catalog.formations?.[f.id];if(!c)throw Error('車輛目錄沒有編組 '+f.id);
 return Math.max(f.lengthM,c.cars.reduce((t,car)=>{const m=catalog.meshes[car.mesh];if(!m)throw Error('車輛目錄沒有車廂 '+car.mesh);return t+m.pitchM;},0));};
const bodyLen=outTrains.map(t=>lengthOf(t.formation));
function bodyWays(R,s,L){const P=R.path,i0=P.at(Math.max(0,s-L/2)).index,i1=P.at(Math.min(P.length,s+L/2)).index,ws=new Set();for(let k=i0;k<=i1;k++)if(R.edges[k])ws.add(R.edges[k].wayId);return ws;}
function opposingOccupancy(from,to){
 const hits=new Map(),idx=outTrains.flatMap((t,i)=>t.spans.some(sp=>sp.start<=to&&sp.start+sp.s.length>from)?[i]:[]);
 for(let t=from;t<=to;t++){const act=[];
  for(const i of idx){const tr=outTrains[i],sp=tr.spans.find(x=>t>=x.start&&t<x.start+x.s.length);if(!sp)continue;act.push({i,dir:tr.direction,ws:bodyWays(routeObjs[sp.route],sp.s[t-sp.start],bodyLen[i])});}
  for(let x=0;x<act.length;x++)for(let y=x+1;y<act.length;y++){const A=act[x],B=act[y];if(A.dir===B.dir)continue;const shared=[...A.ws].filter(w=>B.ws.has(w));if(!shared.length)continue;
   const [a,b]=[A.i,B.i].sort((p,q)=>p-q),key=a+'|'+b;let list=hits.get(key);if(!list)hits.set(key,list=[]);const last=list.at(-1);
   if(last&&last.end>=t-1){last.end=t;shared.forEach(w=>last.ways.add(w));}else list.push({a,b,start:t,end:t,ways:new Set(shared)});}
 }
 return [...hits.values()].flat().map(h=>({...h,ways:[...h.ways].sort()}));
}
const occAfter=SL?opposingOccupancy(single.fromSec,86399):[];

// ── 反向區間占用檢查：每班反向車從反向段前一站開出、到反向段後一站抵達（含兩端渡線段），逐秒與其他所有班車比對，畫面內外都查。
// 對向：兩班車身蓋到同一條 way。同向：車身蓋到同一條 way，且沿股道的中心距小於兩車半長加 3 公尺（9/12 股道重疊的判準）。
// 車身長同上（max 規則）。兩班都在畫面內的秒數列進不確定時段；有一班在畫面外的不繪製，只記在報表。──
const runRange=selected.map((v,i)=>{const r=motion.record(trains[i]);return [r.schedule[0].arrSec+v.offset,r.schedule.at(-1).depSec+v.offset];});
const sampleDay=(i,T)=>T<runRange[i][0]||T>runRange[i][1]?null:motion.sample(trains[i],T-selected[i].offset,{wrap:(s,x)=>x});
const placeOf=(i,T)=>{const v=selected[i],S=trains[i].stops;let k=-1;for(let j=0;j<S.length;j++)if(S[j].arrSec+v.offset<=T)k=j;
 return k<0?S[0].name+'（開出前）':T<=S[k].depSec+v.offset||k===S.length-1?S[k].name:S[k].name+'→'+S[k+1].name;};
const revRange=c=>{const tr=trains[c.ti],idx=plans[c.ti].idx,off=selected[c.ti].offset;
 return [Math.floor(tr.stops[idx[c.best.firstK]].depSec+off),Math.ceil(tr.stops[idx[c.best.lastK+1]].arrSec+off)];};
function reversedOccupancy(){
 const hits=[];
 for(const c of chains){const ti=c.ti,L=bodyLen[ti],[tA,tB]=revRange(c),open=new Map();
  const others=selected.map((_,j)=>j).filter(j=>j!==ti&&runRange[j][0]<=tB&&runRange[j][1]>=tA);
  for(let T=tA;T<=tB;T++){const pR=sampleDay(ti,T);if(!pR)continue;const wR=bodyWays(pR.route,pR.chainageM,L),inR=inside([pR.lon,pR.lat]);
   for(const j of others){const pX=sampleDay(j,T);if(!pX)continue;const wX=bodyWays(pX.route,pX.chainageM,bodyLen[j]),shared=[...wR].filter(w=>wX.has(w));if(!shared.length)continue;
    let kind='opposing';
    if(outTrains[j].direction===outTrains[ti].direction){const loc=pR.route.path.locate([pX.lon,pX.lat],pR.chainageM);
     if(!loc||loc.error>=2.9||Math.abs(loc.s-pR.chainageM)>=(L+bodyLen[j])/2+3)continue;kind='following';}
    const key=j+'|'+kind;let h=open.get(key);
    if(!h||h.end<T-2){h={r:ti,x:j,kind,start:T,end:T,ways:new Set(),drawn:[],place:placeOf(ti,T)};open.set(key,h);hits.push(h);}
    h.end=T;shared.forEach(w=>h.ways.add(w));
    if(inR&&inside([pX.lon,pX.lat])){const d=h.drawn.at(-1);if(d&&d.end>=T-2)d.end=T;else h.drawn.push({start:T,end:T});}
   }}
 }
 return hits.map(h=>({...h,ways:[...h.ways].sort()}));
}
const occRev=reversedOccupancy();
// 反向段兩端接回一般股道的位置（股道資料既有的渡線）：渡線段離開原本南下路徑的那個節點。落在畫面內就不能直接畫（渡線位置不明），停下來處理。
function crossoverOf(c,end){const ti=c.ti,k=end==='in'?c.best.inK:c.best.outK,rec=end==='in'?c.best.recs[0]:c.best.recs.at(-1),S=trains[ti].stops,idx=plans[ti].idx;
 const base=new Set(walkNodes(pack.paths[basePlans[ti].pathIds[k]])),ns=walkNodes(rec),r=[...ns].reverse().findIndex(n=>!base.has(n));
 const j=end==='in'?ns.findIndex(n=>!base.has(n)):r<0?-1:ns.length-1-r;if(j<1||j>=ns.length-1)throw Error('找不到渡線分岔點：'+selected[ti].key+' '+end);
 const sw=end==='in'?ns[j-1]:ns[j+1],pts=[sw,ns[j]].map(nodeCoord);
 return {kind:'crossover',segment:S[idx[k]].name+'→'+S[idx[k+1]].name,node:sw,lon:+pts[0][0].toFixed(6),lat:+pts[0][1].toFixed(6),inView:pts.some(inside)};}
const endOf=(c,end)=>{const S=trains[c.ti].stops,idx=plans[c.ti].idx,has=end==='in'?c.best.hasIn:c.best.hasOut;if(has)return crossoverOf(c,end);
 const st=S[idx[end==='in'?c.best.firstK:c.best.lastK+1]];return {kind:end==='in'?'origin':'terminus',station:st.name,inView:inside([st.lon,st.lat])};};
const crossovers=chains.map(c=>({c,start:endOf(c,'in'),end:endOf(c,'out')}));
for(const x of crossovers)for(const e of [x.start,x.end])if(e.kind==='crossover'&&e.inView)throw Error('反向渡線落在畫面範圍內（'+selected[x.c.ti].key+' '+e.segment+'）：渡線位置不明，要標不確定，不能直接畫');
// 反向路線經過的每個分岔節點（同系統鄰點 ≥ 3）在哪裡換 way：轉轍要是股道資料既有、topology.canTurn 認可的，不自建連接。
const neighborCount=n=>new Set(topo.nodes.get(n).edges.filter(e=>e.system==='tra_sched').map(e=>e.a===n?e.b:e.a)).size;
function turnoutsOf(c){const seq=[];
 for(const rec of c.best.recs)for(const [wi,start,count] of rec.walk){const w=pack.ways[wi],sign=Math.sign(count);
  for(let j=0;j<Math.abs(count);j++){const i=start+j*sign;seq.push({a:String(w.nodes[i+(sign<0?1:0)]),b:String(w.nodes[i+(sign>0?1:0)]),edge:w.id+':'+i,way:String(w.id)});}}
 const out=[];
 for(let k=1;k<seq.length;k++){const x=seq[k-1],y=seq[k];if(x.b!==y.a)throw Error('反向路線不連續：'+selected[c.ti].key+' '+x.b+'→'+y.a);if(x.way===y.way||neighborCount(y.a)<3)continue;
  const e1=topo.edges.get(x.edge),e2=topo.edges.get(y.edge),p=nodeCoord(y.a);
  out.push({node:y.a,lon:+p[0].toFixed(6),lat:+p[1].toFixed(6),inView:inside(p),fromWay:x.way,toWay:y.way,osmTag:topo.nodes.get(y.a).tags?.railway||null,canTurn:!!(e1&&e2&&topo.canTurn(x.a,y.a,y.b,e1,e2))});}
 if(out.some(t=>!t.canTurn))throw Error('反向路線經過股道資料沒有的轉轍：'+selected[c.ti].key+' '+out.filter(t=>!t.canTurn).map(t=>t.node).join(','));
 return out;}
const turnouts=new Map(chains.map(c=>[c.ti,turnoutsOf(c)]));

// ── 單線雙向與不確定時段（uncertainty.json 由 build_tainan_track_ambiguities.mjs 讀 singleLine.unresolved 寫入） ──
// 三種：起點前解不掉的對向重疊（區間時刻表推得出、股道上放不下）；反向車在反向區間內與他車的車身占用；起點後其他對向車身占用。
// 前後各留 1 秒，與 9/12 的做法相同。
const unresolved=[];
for(const o of single.late){const s=Math.max(o.start,SL.officialSec),e=Math.min(o.end,single.fromSec);if(e<=s)continue;
 unresolved.push({start:Math.floor(s),end:Math.ceil(e),trains:[selected[o.a].key,selected[o.b].key],trainNos:[selected[o.a].src.train,selected[o.b].src.train].map(String),basis:'section-overlap',sub:o.sub});}
for(const h of occRev)for(const d of h.drawn)unresolved.push({start:Math.max(0,d.start-1),end:Math.min(86399,d.end+1),trains:[outTrains[h.r].id,outTrains[h.x].id],
 trainNos:[outTrains[h.r].train,outTrains[h.x].train],basis:'reversed-occupancy',kind:h.kind,ways:h.ways});
const covered=(A,B,s,e)=>unresolved.some(u=>u.trains.includes(A)&&u.trains.includes(B)&&u.start<=s&&u.end>=e);
for(const h of occAfter){const s=Math.max(0,h.start-1),e=Math.min(86399,h.end+1),A=outTrains[h.a].id,B=outTrains[h.b].id;if(covered(A,B,s,e))continue;
 unresolved.push({start:s,end:e,trains:[A,B],trainNos:[outTrains[h.a].train,outTrains[h.b].train],basis:'opposing-occupancy',ways:h.ways});}
unresolved.sort((a,b)=>a.start-b.start);
// 說明文字給一般訪客看；時刻、區間、車次都從上面的結果組出來。沒有單線雙向的日期沒有這一塊（snapshot 不寫 singleLine）。
let singleLine;
if(SL){
const subsLate=[...new Set(single.late.slice().sort((x,y)=>y.end-x.end).map(o=>o.sub))],straddleNos=single.straddle.map(i=>outTrains[i].train);
const meetDrawn=occRev.filter(h=>h.kind==='opposing'&&h.drawn.length),followDrawn=occRev.filter(h=>h.kind==='following'&&h.drawn.length);
const noteParts=['官方公告 '+hm(SL.officialSec)+' 起封鎖東正線。'];
if(subsLate.length)noteParts.push('依到站紀錄推算，'+hm(single.fromSec)+' 前'+subsLate.join('、')+'仍有對向列車同時在區間內，所以 '+hm(single.fromSec)+' 前照一般股道畫，對向重疊的時段標「封鎖初期股道安排不明」。');
noteParts.push(hm(single.fromSec)+' 起'+SL.section.join('—')+'只剩一條線：站與站之間同一時間只有一個方向的列車，對向列車在車站交會；南下列車畫在西正線（平常的北上股道）上反向行駛'
 +(straddleNos.length?'；'+straddleNos.join('、')+' 在 '+hm(single.fromSec)+' 前已進入區間、之後才離開，整段都畫在西正線上':'')+'。');
if(meetDrawn.length)noteParts.push(meetDrawn.every(h=>!h.place.includes('→'))?'對向列車同時停在同一座車站、資料分不出各停哪一股的時段，同樣標示。':'對向列車在單線上位置重疊、資料解不開的時段，同樣標示。');
if(followDrawn.length)noteParts.push('同向列車車身在畫面上重疊的時段，同樣標示。');
// 渡線都在畫面外（上面已檢查）；畫面內的轉轍都是股道資料既有的，走哪一股仍是推定。
noteParts.push('南下列車換到西正線、再換回東正線的位置都在畫面外；畫面內各站走哪一股，是依股道資料推定的走法。東正線對應南下那組股道，這一點也是推定。');
singleLine={fromSec:single.fromSec,toSec:single.toSec,section:SL.section,note:noteParts.join(''),basis:slBasis,
 officialSec:SL.officialSec,fullClosureSec:SL.fullClosureSec,lastOverlapEndSec:Math.ceil(single.lastOverlapEnd),
 reversed:crossovers.map(({c,start,end})=>{const tr=trains[c.ti],idx=plans[c.ti].idx,[a,b]=revRange(c);return {trainId:selected[c.ti].key,train:String(tr.train),
  from:tr.stops[idx[c.best.firstK]].name,to:tr.stops[idx[c.best.lastK+1]].name,startSec:a,endSec:b,enteredBeforeFrom:single.straddle.includes(c.ti),crossovers:{start,end},
  turnouts:{total:turnouts.get(c.ti).length,inView:turnouts.get(c.ti).filter(t=>t.inView).length,allCanTurn:turnouts.get(c.ti).every(t=>t.canTurn)},
  ways:[...new Set(c.best.recs.flatMap(r=>r.walk.map(([wi])=>String(pack.ways[wi].id))))],
  conflicts:c.best.conflicts.map(x=>({...x,start:Math.round(x.start),end:Math.round(x.end)}))};}),
 unresolved};
}

// ── 來源與實測校準 ──
const fileSource=f=>({file:f,sha256:hash(fs.readFileSync(repoFile(f)))});
// 設定檔不記整個檔的雜湊（檔頭第 6 點）：記產生資料所用的設定欄位與它們的雜湊。沒有 file 鍵，免得被當成檔案雜湊去比對。
const CONFIG_FILE='scripts/tainan_memory_config.mjs';
const configSource=()=>{const fields=generationFields(cfg.date);
 return {config:CONFIG_FILE,date:cfg.date,fields,note:'fields 列的設定欄位做成鍵遞迴排序的 JSON（canonicalJson）後取 sha256；verify 的門檻、主站入口與註解不在內。',
  sha256:generationConfigSha256(cfg.date,fields)};};
const cacheSource=ref=>{const f=resolveInput(cfg,ref);return fs.existsSync(f)?{file:'.cache/'+path.relative(cfg.cacheRoot,f),sha256:hash(fs.readFileSync(f))}:null;};
const sources=[...REPO_INPUTS.map(f=>f===CONFIG_FILE?configSource():fileSource(f)),
 ...(UG?[cfg.underground.model,cfg.underground.profile].map(fileSource):[]),
 ...Object.entries(sched).filter(([,s])=>s.ref.cache).map(([d,s])=>({file:'.cache/'+s.rel,sha256:s.sha256,commit:s.ref.commit,path:s.ref.path,serviceDate:d,...(s.ref.temporary&&{temporary:s.ref.temporary})})),
 ...[cfg.actuals.out,cfg.actuals.runFloor,cfg.actuals.stations,cfg.actuals.calibration,...cfg.actuals.hist,...cfg.actuals.d1,...cfg.actuals.recordOnly].filter(Boolean).map(cacheSource).filter(Boolean)];
const calib=cfg.actuals.calibration?JSON.parse(fs.readFileSync(resolveInput(cfg,cfg.actuals.calibration),'utf8')):null;
const fallbacks=selected.flatMap((v,i)=>items[i].mode!=='observed'&&v.act.timing!=='scheduled'?[{trainId:v.key,train:String(v.src.train),mode:items[i].mode,reason:'speed-cap'}]:[]);
// 極速上限凍結：每個 (carName, typeName) 一筆，值是這次實際套用的上限（A.speed[i].cap＝resolvePerf 的 v，範圍內沒有高鐵與 DR1000）。
// verify 照班次的 carName／typeName 查這張表，不讀主站；同一車種套到不同上限就凍結不成一張表，直接停。
const capByClass=new Map();
for(const [i,row] of outTrains.entries()){const carName=String(row.carName??''),typeName=String(row.typeName??''),k=JSON.stringify([carName,typeName]),cap=A.speed[i].cap,prev=capByClass.get(k);
 if(prev&&prev.capKmh!==cap)throw Error('同一車種套到不同的極速，凍結不成一張表：'+k+' '+prev.capKmh+' 與 '+cap);
 if(!prev)capByClass.set(k,{carName,typeName,capKmh:cap});}
const speedCaps={source:'index.html 的 PERF_RULES／PERF_BY_TYPE（resolvePerf；範圍內只有台鐵）',indexSha256:hash(fs.readFileSync(indexPath)),
 caps:[...capByClass].sort(([a],[b])=>a<b?-1:1).map(([,e])=>e)};
// 各營運日的班表來源（source-schedule.json 與預覽的 scheduledTimeSource 共用）。
const schedulesInfo=Object.entries(sched).map(([d,s])=>({serviceDate:d,file:s.ref.file||('.cache/'+s.rel),commit:s.ref.commit||null,sha256:s.sha256,...(s.ref.temporary&&{temporary:s.ref.temporary})}));
const timingSource={primary:cfg.preview?'scheduled':act.primary,histRows:act.counts.histRowsUsed,d1Rows:act.counts.d1RowsUsed,histFiles:act.histFilesUsed,
 calibration:calib&&{method:'2026-09-12 秒級歷史：已實測的站隨機保留 30% 不給重建，比對重建時刻與實測（到站誤差絕對值）',date:calib.date,params:calib.params,
  stopErrSec:{n:calib.stop.n,p50:Math.round(calib.stop.p50abs),p90:Math.round(calib.stop.p90abs)},passErrSec:{n:calib.pass.n,p50:Math.round(calib.pass.p50abs),p90:Math.round(calib.pass.p90abs)},
  d1ArrDiffSec:{n:calib.d1A.n,p50:Math.round(calib.d1A.p50abs),p90:Math.round(calib.d1A.p90abs)}},
 scheduledTrains:act.counts.scheduled,fallbacks,speedCaps,
 ...(cfg.preview&&{scheduledTimeSource:{kind:cfg.preview.kind,reason:cfg.preview.reason,schedules:schedulesInfo}})};

// ── 寫檔 ──
const info=readRepo('data/tra_station_info.json'),stations=['大橋','台南','保安'].map(name=>({name:info[name].name,lon:info[name].lon,lat:info[name].lat,id:info[name].id}));
const rails=pack.ways.filter(w=>w.system==='tra_sched'&&w.tags?.railway==='rail'&&w.coordinates.some(inside)).map(w=>({id:w.id,tags:w.tags,coordinates:w.coordinates}));
const zRails=UG&&(()=>{addZ(rails);return zCheck(rails,()=>null);})();
// 頁面讀的地下化說明：兩份輸入的相對路徑與雜湊、月台範圍、z 欄位與停靠點的意義。
const underground=UG&&{model:{file:path.relative(cfg.dir,cfg.underground.model),sha256:hash(fs.readFileSync(repoFile(cfg.underground.model)))},
 profile:{file:path.relative(cfg.dir,cfg.underground.profile),sha256:hash(fs.readFileSync(repoFile(cfg.underground.profile)))},
 platform:{centerD:UG.platform.centerD,d0:UG.platform.d0,d1:UG.platform.d1,lengthM:UG.platform.lengthM},maxAbsSlopePermille:UG.maxSlope,
 elevation:{field:'z',unit:'m',datum:'地面＝0，向上為正',appliesTo:['routes[i].z','rails[i].z'],
  rule:'與 coordinates 逐頂點對應；頂點落在隧道、站體、U 槽外框內取 profile.json 的 z(d)，框外是 0；整條都在地面的沒有 z 欄位'},
 stop:{station:cfg.underground.stopStation,point:'formation-center',centerD:UG.platform.centerD,
  rule:'臺南站停靠時整列的中心在 centerD，整列落在 platform.d0 到 platform.d1 內；d 是點投影到 profile.json 參考線的累計長度'}};
const context=readRepo('prototypes/tiny-trains/blender/tainan-memory-v1/context-source.json');
const features=context.elements.filter(e=>e.geometry&&((e.tags?.highway&&!['footway','path','steps','cycleway','service'].includes(e.tags.highway))||e.tags?.railway==='platform'||e.tags?.building)).map(e=>({id:e.id,tags:e.tags,coordinates:e.geometry.map(p=>[p.lon,p.lat])}));
const snapshot={schema:1,date:cfg.date,timezone:'Asia/Taipei',bounds:cfg.bounds,origin:cfg.origin,startSec:0,endSec:86399,stepSec:1,defaultSec:cfg.defaultSec,
 ...(cfg.preview&&{preview:cfg.preview}),...(underground&&{underground}),
 stations,rails,routes,trains:outTrains,features,events,singleLine,timingSource,sources,note:cfg.note};
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'snapshot.json'),JSON.stringify(snapshot));
fs.writeFileSync(path.join(out,'source-schedule.json'),JSON.stringify({date:cfg.date,
 sourceNotes:Object.fromEntries(Object.entries(sched).map(([d,s])=>[d,s.json.source_notes??null])),
 schedules:schedulesInfo,
 trains:selected.map(v=>({serviceDate:v.day,sourceIndex:v.index,...structuredClone(v.src)}))}));
fs.writeFileSync(path.join(out,'source-observations.json'),JSON.stringify({date:cfg.date,
 note:'範圍內各班在永康、大橋、臺南、保安、仁德與重建鏈上前後各一站的原始觀測列。tdx-historical＝TDX 歷史 LiveTrainDelay（SrcUpdateTime 為 UTC）；d1＝每分鐘記錄的逐站事件（obs_at 為取樣時刻）。',
 files:[...cfg.actuals.hist,...cfg.actuals.d1].map(cacheSource).filter(Boolean),
 trains:selected.map(v=>({trainId:v.key,train:String(v.src.train),serviceDate:v.day,rows:v.act.raw}))}));

// ── 報表（.cache，不出貨） ──
const anchorsOf=v=>{const i=selected.indexOf(v),tr=trains[i],row=outTrains[i];
 return v.act.anchors.map(a=>{const n=v.act.nodes.find(x=>x.sta===a.sta),s=tr.stops.find(x=>norm(x.name)===norm(n?.name)),got=s?(a.kind==='A'?s.arrSec:s.depSec)+v.offset:null;
  return {station:n?.name,kind:a.kind,src:a.src,anchor:+a.y.toFixed(1),fit:+a.fit.toFixed(1),final:got,diff:got==null?null:+(got-a.y).toFixed(1),inWindow:!!stopOf(row,n?.name)};});};
const byType=new Map();for(const [i] of selected.entries()){const k=outTrains[i].formation.id+'｜極速 '+A.speed[i].cap;(byType.get(k)||byType.set(k,[]).get(k)).push(A.speed[i].max);}
const keyed=o=>({...o,a:selected[o.a].key,b:selected[o.b].key});
const report={date:cfg.date,trains:outTrains.length,overnight:outTrains.filter(t=>t.serviceDate!==cfg.date).length,
 directions:Object.fromEntries(['北上','南下'].map(d=>[d,outTrains.filter(t=>t.direction===d).length])),routes:routes.length,
 samples:outTrains.reduce((n,t)=>n+t.spans.reduce((x,s)=>x+s.s.length,0),0),rounds,fallbacks,
 modes:Object.fromEntries(['observed','no-knots','scheduled'].map(m=>[m,items.filter(x=>x.mode===m).length])),
 knots:items.reduce((n,x)=>n+x.knots,0),knotCheck,droppedKnots:items.flatMap((x,i)=>x.dropped.map(d=>selected[i].key+' '+d)),unmatchedStops:items.flatMap((x,i)=>x.unmatched.map(d=>selected[i].key+' '+d)),
 heldPass:items.flatMap((x,i)=>x.held.map(h=>({train:selected[i].key,station:h.stop.name,arr:h.arr+selected[i].offset,dep:h.dep+selected[i].offset}))),
 speedByType:[...byType].map(([k,xs])=>{xs.sort((x,y)=>x-y);return {type:k,n:xs.length,min:+xs[0].toFixed(1),p50:+xs[xs.length>>1].toFixed(1),max:+xs.at(-1).toFixed(1)};}),
 speedTop:selected.map((v,i)=>({key:v.key,max:+A.speed[i].max.toFixed(2),maxInView:+A.speed[i].maxIn.toFixed(2),cap:A.speed[i].cap})).sort((x,y)=>y.max/y.cap-x.max/x.cap).slice(0,10),
 bindings:Object.fromEntries([...new Set(basePlans.map(b=>b.basis))].map(b=>[b,basePlans.filter(x=>x.basis===b).length])),joinsNotChecked:A.joins,
 formations:formRows,formationDiff:formRows.filter(r=>r.id!==r.plainId||r.cars!==r.plainCars),
 single:!SL?null:{fromSec:single.fromSec,toSec:single.toSec,overlapsNear:single.overlaps.filter(o=>o.end>SL.officialSec-1800).map(keyed),afterFrom:single.after.map(keyed),
  chains:chains.map(c=>({train:selected[c.ti].key,e:c.best.e,x:c.best.x,slice:c.best.slice,physKm:c.physKm,alternatives:c.alternatives})),
  reversed:singleLine.reversed,unresolved,lastExit:selected[single.lastExit].key,lastSouth:selected[single.lastSouth].key,basis:slBasis,note:singleLine.note,
  occupancy:occRev.map(h=>({train:outTrains[h.r].train,other:outTrains[h.x].train,otherDirection:outTrains[h.x].direction,kind:h.kind,start:h.start,end:h.end,span:hms(h.start)+'–'+hms(h.end),
   place:h.place,ways:h.ways,drawn:h.drawn.map(d=>hms(d.start)+'–'+hms(d.end)),status:h.drawn.length?'marked':'not-drawn'})),
  occAfter:occAfter.map(h=>({a:outTrains[h.a].train,b:outTrains[h.b].train,span:hms(h.start)+'–'+hms(h.end),ways:h.ways})),
  turnouts:Object.fromEntries(chains.map(c=>[outTrains[c.ti].train,turnouts.get(c.ti)]))},
 anchors:Object.fromEntries((cfg.marks||[]).map(m=>[m.train,anchorsOf(selected.find(x=>String(x.src.train)===m.train&&x.day===m.serviceDate))])),
 events,meet:ctx.__meet??null,
 ...(UG&&{underground:{platform:UG.platform,tainanStops:[...motion.patched.values()],tainanFits:A.tainanFits,z:{routes:zRoutes,rails:zRails}}})};
fs.writeFileSync(resolveInput(cfg,cfg.actuals.report),JSON.stringify(report,null,1)+'\n');
console.log(JSON.stringify({date:cfg.date,trains:report.trains,overnight:report.overnight,directions:report.directions,routes:routes.length,rails:rails.length,samples:report.samples,
 modes:report.modes,knotCheck,fallbacks:fallbacks.length,singleLine:SL?{fromSec:single.fromSec,toSec:single.toSec,reversed:singleLine.reversed.map(r=>r.train),unresolved:unresolved.length}:null,
 bytes:fs.statSync(path.join(out,'snapshot.json')).size}));
