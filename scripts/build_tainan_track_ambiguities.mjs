// 已有班表不能證明當班月台／渡線派用。把模型無法分開的車身標成不確定，而非橫移造股道。
// 用法：node scripts/build_tainan_track_ambiguities.mjs [--date YYYY-MM-DD] [--check]
//   沒帶 --date 時是 2026-09-12。已封存的日期只准 --check：重算後與既有 uncertainty.json 逐字比對，不寫檔。
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {configFor,dateFromArgv,resolveInput} from './tainan_memory_config.mjs';
const cfg=configFor(dateFromArgv()),dir=cfg.outDir,CHECK=process.argv.includes('--check'),AMB=cfg.ambiguity||null;
// ambiguity.deepOverlapM（選用）：兩車車身橫向重疊的深度超過它的秒也算重疊，不看兩車共不共用 way，也不看車身中心有沒有落在對方的路線上。
// 深度＝兩車車寬的平均 − 兩車車身中心線之間的最短距離（sideBySide）。沒有這一項的日期，輸出與只看共用 way 的舊判準完全相同。
const DEEP=AMB?.deepOverlapM??null;
if(DEEP!==null&&!(Number.isFinite(DEEP)&&DEEP>0))throw Error('ambiguity.deepOverlapM 要是正數：'+DEEP);
if(cfg.sealed&&!CHECK)throw Error(cfg.date+' 已封存：只能加 --check 重算比對，不寫檔。');
const {makePath}=await import(pathToFileURL(path.join(dir,'vendor/train-path.js')).href);
const data=JSON.parse(fs.readFileSync(path.join(dir,'snapshot.json'))),paths=data.routes.map(r=>makePath(r.coordinates)),hits=new Map();
// 車身長：已封存的日期照封存當時用編組長；之後的日期取 max(編組長, 車輛目錄節距加總)，與頁面排車身用的長度一致。
const catalog=cfg.sealed?null:JSON.parse(fs.readFileSync(path.join(dir,'fleet/catalog.json')));
const carsOf=f=>{const c=catalog.formations?.[f.id];if(!c)throw Error('車輛目錄沒有編組 '+f.id);return c.cars.map(car=>{const m=catalog.meshes[car.mesh];if(!m)throw Error('車輛目錄沒有車廂 '+car.mesh);return m;});};
const lengthOf=f=>catalog?Math.max(f.lengthM,carsOf(f).reduce((t,m)=>t+m.pitchM,0)):f.lengthM;
const len=new Map(data.trains.map(t=>[t.id,lengthOf(t.formation)]));

// shared-way 判準：路段的每一小段對上 snapshot.rails 的 way（座標逐點相同）；車身＝中心前後各半個車長蓋到的 way。
let routeWays=null,bodyWays=null,sideBySide=null;
if(AMB){
 if(AMB.criterion!=='shared-way')throw Error('不認得的股道重疊判準：'+AMB.criterion);
 const key=c=>c[0].toFixed(7)+','+c[1].toFixed(7),seg=new Map();
 for(const r of data.rails)for(let i=0;i+1<r.coordinates.length;i++){const a=key(r.coordinates[i]),b=key(r.coordinates[i+1]);seg.set(a+'|'+b,r.id);seg.set(b+'|'+a,r.id);}
 routeWays=data.routes.map(r=>r.coordinates.slice(1).map((c,i)=>seg.get(key(r.coordinates[i])+'|'+key(c))??null));
 bodyWays=(ri,s,L)=>{const P=paths[ri],i0=P.at(Math.max(0,s-L/2)).index,i1=P.at(Math.min(P.length,s+L/2)).index,ws=new Set();
  for(let q=i0;q<=i1;q++){const w=routeWays[ri][Math.min(q,routeWays[ri].length-1)];if(w!=null)ws.add(w);}return ws;};
 // 兩車身並排的幾何（只給報表）：沿一車車身每 1 m 取點，量到另一車車身中心線的距離；投影落在對方車身範圍內才算並排。
 const [ox,oy]=data.origin,sx=111320*Math.cos(oy*Math.PI/180),xy=c=>[(c[0]-ox)*sx,(c[1]-oy)*111320];
 const pts=(ri,s,L)=>{const P=paths[ri],s0=Math.max(0,s-L/2),s1=Math.min(P.length,s+L/2),out=[];for(let x=s0;x<s1;x+=1)out.push(xy(P.at(x).coordinate));out.push(xy(P.at(s1).coordinate));return out;};
 const along=(A,B)=>{let min=Infinity,n=0;for(const q of A){let best=Infinity,inner=false;
   for(let i=1;i<B.length;i++){const a=B[i-1],b=B[i],dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy,t=l?((q[0]-a[0])*dx+(q[1]-a[1])*dy)/l:0,u=Math.max(0,Math.min(1,t)),d=Math.hypot(q[0]-a[0]-u*dx,q[1]-a[1]-u*dy);
    if(d<best){best=d;inner=(i>1||t>0)&&(i<B.length-1||t<1);}}
   if(inner&&best<10){n++;if(best<min)min=best;}}return {min,n};};
 sideBySide=(a,b)=>{const A=pts(a.ri,a.s,a.L),B=pts(b.ri,b.s,b.L),x=along(A,B),y=along(B,A);return {centerM:Math.min(x.min,y.min),overlapM:Math.max(x.n,y.n)};};
}
const widthOf=f=>Math.max(...carsOf(f).map(m=>m.widthM));
const wid=DEEP!==null?new Map(data.trains.map(t=>[t.id,widthOf(t.formation)])):null;
for(let t=0;t<86400;t++){
 const active=[];for(const tr of data.trains){const span=tr.spans.find(s=>t>=s.start&&t<s.start+s.s.length);if(!span)continue;const s=span.s[t-span.start],p=paths[span.route];active.push({tr,s,p,ri:span.route,c:p.at(s).coordinate});}
 for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
  const a=active[i],b=active[j],limit=(len.get(a.tr.id)+len.get(b.tr.id))/2+3;
  if(Math.hypot((a.c[0]-b.c[0])*102000,(a.c[1]-b.c[1])*111320)>limit+3)continue;
  const loc=a.p.locate(b.c,a.s),near=!(!loc||loc.error>=2.9||Math.abs(loc.s-a.s)>=limit);
  // 候選秒＝b 的車身中心落在 a 的路線 2.9 m 內（near），或（有 deepOverlapM 時）兩車車身橫向重疊得夠深。後者不靠車身中心：
  // 車身中心已離開岔心、車尾還壓在道岔上的秒，near 找不到。
  const A={ri:a.ri,s:a.s,L:len.get(a.tr.id)},B={ri:b.ri,s:b.s,L:len.get(b.tr.id)};let g=null,depth=null;
  if(AMB&&(near||DEEP!==null)){g=sideBySide(A,B);if(DEEP!==null)depth=(wid.get(a.tr.id)+wid.get(b.tr.id))/2-g.centerM;}
  if(!near&&!(depth>DEEP))continue;
  const key=[a.tr.id,b.tr.id].sort().join('|');let spans=hits.get(key);if(!spans)hits.set(key,spans=[]);
  const last=spans.at(-1);let span=last;
  if(last&&last.end>=t-2)last.end=t+1;else spans.push(span={start:Math.max(0,t-1),end:Math.min(86399,t+1),trains:[a.tr.id,b.tr.id],trainNos:[a.tr.train,b.tr.train]});
  if(AMB){const wa=bodyWays(A.ri,A.s,A.L),wb=bodyWays(B.ri,B.s,B.L),shared=[...wa].filter(w=>wb.has(w));
   (span.seconds||=[]).push({t,shared,waysA:[...wa],waysB:[...wb],centerM:g.centerM,overlapM:g.overlapM,...(DEEP!==null&&{depthM:depth})});}
 }
}
let intervals=[...hits.values()].flat().sort((a,b)=>a.start-b.start);
let basis='逐秒檢查模型車身的股道佔用範圍；不是現實碰撞紀錄。公開圖資與班表不足以核實當班渡線／月台安排，這些時段只顯示原位置的車次標記。',dropped=null;
if(AMB){
 // 共用 way 的秒數 > 0 才保留；沒有共用、但兩條 way 中心線相距 < closeWayM 的秒數超過 closeWaySec 的，也保留（可能同一條實體股道）。
 // 有 deepOverlapM 時，車身橫向重疊超過它的秒（deepOverlapSec）> 0 也保留，不論有沒有共用 way。
 const byId=new Map(data.trains.map(t=>[t.id,t])),kept=[];dropped=[];
 for(const i of intervals){const sec=i.seconds,sharedSec=sec.filter(x=>x.shared.length).length,closeSec=sec.filter(x=>x.centerM<AMB.closeWayM).length,deepSec=DEEP!==null?sec.filter(x=>x.depthM>DEEP).length:0;
  const [A,B]=i.trains.map(id=>byId.get(id)),half=(widthOf(A.formation)+widthOf(B.formation))/2,worst=sec.reduce((m,x)=>x.centerM<m.centerM?x:m,sec[0]);
  const row={start:i.start,end:i.end,trains:i.trains,trainNos:i.trainNos};
  const info={...row,sharedWaySec:sharedSec,closeWaySec:closeSec,...(DEEP!==null&&{deepOverlapSec:deepSec,maxOverlapDepthM:+Math.max(0,...sec.map(x=>x.depthM)).toFixed(2)}),waysA:[...new Set(sec.flatMap(x=>x.waysA))],waysB:[...new Set(sec.flatMap(x=>x.waysB))],
   minCenterM:+worst.centerM.toFixed(2),minClearanceM:+(worst.centerM-half).toFixed(2),halfWidthsM:+half.toFixed(3),maxOverlapM:Math.max(...sec.map(x=>x.overlapM))};
  if(sharedSec>0||closeSec>AMB.closeWaySec||deepSec>0)kept.push({row,info});else dropped.push(info);}
 intervals=kept.map(k=>k.row);
 basis='逐秒檢查模型車身的股道佔用範圍；不是現實碰撞紀錄。兩車車身共用同一條股道（OSM way）才算重疊，岔心旁兩條相鄰股道的近接不算。'
  +(DEEP!==null?'但兩車車身橫向重疊的深度（兩車車寬的平均，減去兩車車身中心線之間的最短距離）超過 '+DEEP+' m 的秒也算，因為車身中心離開岔心後，車尾仍可能壓在道岔上。':'')
  +'公開圖資與班表不足以核實當班渡線／月台安排，這些時段只顯示原位置的車次標記。';
 var keptInfo=kept.map(k=>k.info);
}
// 有單線雙向的日期：build 找出的解不掉的時段（singleLine.unresolved）標 single-line-unresolved。車身重疊與它是同一對車、時間相交的，
// 是同一件事，併進那一段；其餘標 track-overlap。
if(data.singleLine){
 const single=data.singleLine.unresolved.map(u=>({...u,reason:'single-line-unresolved'})),same=(x,y)=>x.trains.length===y.trains.length&&x.trains.every(id=>y.trains.includes(id));
 const rest=[];
 for(const i of intervals){const u=single.find(u=>same(u,i)&&u.start<=i.end&&i.start<=u.end);
  if(u){u.start=Math.min(u.start,i.start);u.end=Math.max(u.end,i.end);u.mergedTrackOverlap=true;}else rest.push({...i,reason:'track-overlap'});}
 intervals=[...single,...rest].sort((a,b)=>a.start-b.start||a.end-b.end);
 basis+='單線雙向期間另列 build 推得、股道上放不下的對向重疊與車身占用（reason＝single-line-unresolved）。';
}
// 沒有單線雙向、但有 ambiguity 的日期：每段也標 reason（頁面端本來就把沒標的當 track-overlap）。沒有 ambiguity 的日期（9/12）一個字都不動。
else if(AMB)intervals=intervals.map(i=>({...i,reason:'track-overlap'}));
const text=JSON.stringify({schema:1,date:data.date,...(AMB&&{criterion:AMB.criterion}),basis,intervals},null,2)+'\n',file=path.join(dir,'uncertainty.json');
if(CHECK){
 const now=fs.existsSync(file)?fs.readFileSync(file,'utf8'):null;
 if(now!==text)throw Error('重算結果與 '+path.relative(cfg.root,file)+' 不同');
 console.log('比對一致：'+intervals.length+' 個時段（未寫檔）。');
}else{
 fs.writeFileSync(file,text);
 if(AMB)fs.writeFileSync(resolveInput(cfg,AMB.report),JSON.stringify({date:cfg.date,criterion:AMB.criterion,closeWayM:AMB.closeWayM,closeWaySec:AMB.closeWaySec,...(DEEP!==null&&{deepOverlapM:DEEP}),kept:keptInfo,dropped},null,1)+'\n');
 console.log('股道安排待確認：'+intervals.length+' 個時段，'+new Set(intervals.flatMap(i=>i.trains)).size+' 班涉及。'+(AMB?'（'+AMB.criterion+'：保留 '+keptInfo.length+'、刪 '+dropped.length+' 段近接'+(DEEP!==null?'；車身橫向重疊超過 '+DEEP+' m 的有 '+keptInfo.reduce((n,k)=>n+k.deepOverlapSec,0)+' 秒':'')+'）':''));
}
