// 固定 09/28 的原始輸入，不隨班表滾動換掉失敗案例；不改判準或官方到離站時刻。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {runInContext} from 'node:vm';
import {chromium, webkit} from 'playwright';
import {makeSandbox} from './build_run_profiles.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ctx=makeSandbox(path.join(ROOT,'index.html'));
// 同一份幾何反向鏡射，測兩向、已在前方／找不到共同上一停靠站不亂套、速限區內拒絕重錨。
const units=runInContext(`(() => {
 let checks=0;
 for(const direction of [1,-1]) for(const kind of ['arrival','ahead','missing','otherday','opposite','alreadyInside','farArrival','conflict']) {
  const perf={v:120,a:2.5,b:3}, names=['起站','和仁','上一停靠','通過站','候車站','終站'];
  const stops=names.map((name,i)=>({name,lat:24+direction*i*.02,lon:121,stop:i===0||i===5,
   arrSec:i===5?600:i*100,depSec:i===5?600:i*100,rpDep:0,rpOff:i*2000,rpSegKm:2}));
  const rp=buildObsProfile(10,600,[1,2,3,4].map(i=>({t:i*100,d:i*2000})),120);
  for(const st of stops)st.rp=rp;
  const at=new Map([['候車站',[{k:'Y',arr:kind==='alreadyInside'?380:kind==='farArrival'?430:420,dep:480,prev:'通過站',next:kind==='opposite'?'通過站':'終站',
   prevStop:kind==='missing'?'線外站':'上一停靠',prevDep:kind==='ahead'?250:180}]]]);
  if(kind==='conflict')at.get('候車站').push({k:'Z',arr:410,dep:440,prev:'通過站',next:'終站',prevStop:'上一停靠',prevDep:180});
  const stats={snapped:0,infeasible:0,unbuildable:0,tooFar:0,zoneSkipped:0,zoneArrivalSnapped:0,zoneArrivalRejected:0,log:[]};
  inferMeetRun({},stops,0,5,'X',perf,'regular',at,()=>kind!=='otherday',()=>false,stats);
  const zones=runSpeedZones(stops,0,5,[2,2,2,2,2],'regular',120,10000);
  if(kind==='arrival') {
   if(Math.abs(stops[4].arrSec-440)>.001||stats.zoneArrivalSnapped!==1)throw Error('雙向官方停靠窗未套用 '+direction);
  }else if(stops[4].arrSec!==400||stats.zoneArrivalSnapped!==0)throw Error('不符合的前後次序被改動');
  if(!zoneProfileOk(stops[0].rp,zones))throw Error('彎道超速');
  if(stops[0].depSec!==0||stops[5].arrSec!==600)throw Error('改了官方端點');
  if(reanchorRunProfile(stops,0,5,1,120,perf,10,zones)!==null)throw Error('移動了速限區內節點');
  if(reanchorRunProfile(stops,0,5,4,280,perf,10,zones,new Map([[6000,300]]))!==null)throw Error('後續重錨洗掉已確認的停靠窗');
  checks+=5;
 }
 return checks;
})()`,ctx);
console.log(`PASS ${units} 項雙向合成斷言：抵站窗、排除、官方端點與彎道保護`);

const REF='9b7978a52f0b5c50744e94669467ad95faeabce9';
const inputs=new Map(['tra_schedule_dense.json','tra_pass_obs.json','tra.json','tra_track_sections.json','tra_special_trains.json'].map(n=>
 ['/data/'+n,execFileSync('git',['show',`${REF}:data/${n}`],{cwd:ROOT,maxBuffer:64<<20})]));
let html=fs.readFileSync(path.join(ROOT,'index.html'));
if(process.env.TRA_ZONE_MUTATION==='skip'){
 const needle='if (zones && !zoneProfileOk(s[k0].rp, zones))';
 assert(html.includes(needle),'突變錨點存在');
 html=Buffer.from(html.toString().replace(needle,'if (zones)'));
}
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css'};
const server=createServer((req,res)=>{
 const u=new URL(req.url,'http://x'),rel=u.pathname==='/'?'/index.html':u.pathname;
 if(rel==='/data/tra_run_profiles.json'||rel.startsWith('/api/')){res.writeHead(404);res.end('{}');return;}
 const file=path.resolve(ROOT,'.'+decodeURIComponent(rel));
 if(!file.startsWith(ROOT+path.sep)){res.writeHead(403);res.end();return;}
 try{res.setHeader('content-type',mime[path.extname(file)]||'application/octet-stream');res.end(rel==='/index.html'?html:inputs.get(rel)||fs.readFileSync(file));}
 catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 for(const [name,engine] of Object.entries({chromium,webkit})){
  const browser=await engine.launch({headless:true,...(name==='chromium'?{channel:'chromium'}:{})});
  try{
   const p=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
   const errors=[];p.on('pageerror',e=>errors.push(e.message));
   await p.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');const D=Date,now=new D('2026-09-28T07:43:00+08:00').getTime();window.Date=class extends D{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}};});
   await p.goto(`http://127.0.0.1:${server.address().port}/?g=tra&t=07:43`,{waitUntil:'domcontentloaded'});
   await p.waitForFunction(()=>state.ready&&state.trains?.length>300&&window.railIslandPhysical,null,{timeout:120000});
   const report=await p.evaluate(()=>{
    const L=state.trains.find(t=>String(t.train)==='145'),F=state.trains.find(t=>String(t.train)==='5241');
    const a=L.stops.find(s=>s.name==='汐止'),b=F.stops.find(s=>s.name==='汐止');
    const flips=[];let prev=null;
    for(let t=63800;t<=64200;t++){
     const x=trainSeg(L,t),y=trainSeg(F,t),sign=Math.sign((x.d-y.d)*x.dir);
     if(prev&&sign&&sign!==prev)flips.push({t,dwell:x.dwell,station:L.stops[x.i].name});
     if(sign)prev=sign;
    }
    const j=F.stops.indexOf(b);let k0=j-1,k1=j+1;
    while(k0>0&&F.stops[k0].stop===false)k0--;
    while(k1<F.stops.length-1&&F.stops[k1].stop===false)k1++;
    const km=F.stops.slice(k0,k1).map(s=>s.rpSegKm),zones=runSpeedZones(F.stops,k0,k1,km,speedZoneClassOf(F),resolvePerf(F).v,km.reduce((a,b)=>a+b,0)*1000);
    return {day:state.data._schedDay,roster:state.trains.length,arr:a.arrSec,dep:a.depSec,pass:b.arrSec,
     falseWait:L.stops.some(s=>s.name==='百福'&&s._plannedDwell),flips,zoneCount:zones?.length,zoneSafe:zoneProfileOk(F.stops[k0].rp,zones),
     physical:[L,F].every(t=>trainPosAt(t,64040)?.physical)};
   });
   console.log(name,JSON.stringify(report));
   assert.equal(report.day,'2026-09-28');assert(report.roster>300);
   assert.equal(report.arr,64020);assert.equal(report.dep,64080);
   assert(report.pass>=report.arr+20-.001&&report.pass<=report.dep-20+.001,'5241 必須在 145 的既有官方停靠窗內通過');
   assert.equal(report.falseWait,false,'不再替 145 安排百福假待避');
   assert.equal(report.flips.length,1);assert(report.flips[0].dwell&&report.flips[0].station==='汐止','只在汐止停靠中交換次序');
   assert(report.zoneCount>0&&report.zoneSafe&&report.physical);assert.deepEqual(errors,[]);
   console.log(`PASS ${name} 固定 145／5241：官方停靠時刻不變、只在站內交換一次、彎道速限保留`);
  }finally{await browser.close();}
 }
}finally{server.close();}
