import fs from 'node:fs';import {chromium,webkit} from 'playwright';
const base=process.env.BASE_URL||'http://127.0.0.1:5245/',out='output/rail-grounding';fs.mkdirSync(out,{recursive:true});const rows=[];
for(const [engine,type]of Object.entries(process.env.ENGINE==='chromium'?{chromium}:{chromium,webkit})){
 const b=await type.launch(),p=await b.newPage({viewport:{width:1512,height:946},locale:'zh-TW',hasTouch:true});p.setDefaultTimeout(20000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));await p.goto(base+'?g=all&scene=3d&map=landscape&ground=flat&t=13:34');await p.waitForFunction(()=>state.ready&&window.railIslandPhysical&&railIslandIntegration.renderer,null,{timeout:90000});
  await p.locator('#fsFab').click();
  for(const [no,time]of [['0637',13*3600+34*60],['8889',13*3600+35*60],['8889',20*3600+35*60]]){
   console.log(engine,'select',no,time);await p.evaluate(({no,time})=>{setSimSec(time);state.playing=false;const tr=state.trains.find(t=>String(t.train)===no);setFollow(tr,false,true);railIslandIntegration.setModelMode('selected');setFollowLock(true);M.raw.jumpTo({zoom:18,pitch:75,bearing:35});}, {no,time});
   console.log(engine,'selected',no);await p.waitForFunction(()=>{const r=railIslandIntegration.renderer;return !state._transition&&!r.interacting&&r.stats.models>0&&r.stats.headLockErrorPx<1;},null,{timeout:45000});
   for(const mode of ['flat','terrain'])for(const bearing of [35,125,215,305]){
    await p.evaluate(({mode,bearing})=>{railIslandIntegration.setGroundMode(mode);M.raw.fire('rotatestart',{originalEvent:{}});M.raw.jumpTo({zoom:18,pitch:75,bearing});M.raw.fire('rotateend',{originalEvent:{}});}, {mode,bearing});
    await p.waitForFunction(()=>{const r=railIslandIntegration.renderer;return r.stats.models>0&&!r.interacting&&r.stats.headLockErrorPx<1;},null,{timeout:45000});
    const detail=await p.evaluate(()=>{const r=railIslandIntegration.renderer,f=railIslandIntegration.capture(),v=f.vehicles.find(v=>v.followed),pose=r.stats.poseSamples.find(p=>p.id===v.id),h=r.frontScreen(),pad=r.map.getPadding();return {no:v.publicLabel,position:[v.longitude,v.latitude],original:(()=>{const q=trainPos(state.followTrain,state.simSec);return[q.lon,q.lat];})(),error:r.stats.headLockErrorPx,screen:h,inside:h.x>pad.left+10&&h.x<r.map.getContainer().clientWidth-pad.right-10&&h.y>pad.top+10&&h.y<r.map.getContainer().clientHeight-pad.bottom-10,heightError:Math.max(...pose.cars.map(c=>{const a=pose.angle,l=v.route.physical?v.route.level(c.s):railIslandPhysical.displayLevelAt(v.systemId,c.coordinate,a);return Math.abs(c.height-(r.stats.groundMode==='terrain'?r.map.queryTerrainElevation(c.coordinate):0)-(l?.offsetM||0)-.65);})),level:pose.level,errors:r.stats.errors};});
    const pass=detail.error<1&&detail.inside&&detail.heightError<.02&&JSON.stringify(detail.position)===JSON.stringify(detail.original)&&!detail.errors.length;rows.push({engine,no,time,mode,bearing,pass,detail});console.log(engine,no,time,mode,bearing,pass);
    if(bearing===35)await p.screenshot({path:`${out}/${engine}-${no}-${time}-${mode}.png`});
   }
   // 解鎖後可離開，重新鎖定回原車頭。
   console.log(engine,'unlock',no);await p.locator('#followLockBtn').click();console.log(engine,'unlocked',no);await p.mouse.move(1050,550);await p.mouse.down();await p.mouse.move(1150,600,{steps:8});await p.mouse.up();console.log(engine,'panned',no);await p.locator('#followLockBtn').click();console.log(engine,'relocked',no);await p.waitForFunction(()=>railIslandIntegration.renderer.stats.headLockErrorPx<1,null,{timeout:15000});rows.push({engine,no,time,test:'桌面全畫面重新鎖回同車',pass:await p.evaluate(no=>state.followLock&&String(state.followTrain.train)===no,no)});
  }
  rows.push({engine,test:'無頁面錯誤',pass:!errors.length,errors});
 }catch(e){rows.push({engine,pass:false,error:String(e)});console.error(e.message);console.log(JSON.stringify(await p.evaluate(()=>({lock:state.followLock,head:followHeadLocked(),transition:state._transition,blocked:camBlocked(),size:M.getSize(),insets:mapInsets(),capture:railIslandIntegration.capture().selectedVehicleId,stats:railIslandIntegration.renderer.stats,center:M.raw.getCenter(),elevation:M.raw.getCenterElevation()})),(k,v)=>['cars','samples','poseSamples','modelFallbacks'].includes(k)?undefined:v));await p.screenshot({path:out+'/'+engine+'-case-failure.png'});}finally{await b.close();}
}
fs.writeFileSync(process.env.RESULT_FILE||out+'/follow-cases.json',JSON.stringify(rows,null,2));console.log({total:rows.length,failed:rows.filter(r=>!r.pass)});if(rows.some(r=>!r.pass))process.exitCode=1;
