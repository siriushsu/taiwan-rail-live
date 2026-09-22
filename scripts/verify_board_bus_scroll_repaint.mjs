import {chromium,webkit} from 'playwright';
let failed=0,checks=0;
for(const [name,engine]of Object.entries({chromium,webkit})){
 const b=await engine.launch(),c=await b.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,locale:'zh-TW'}),p=await c.newPage();
 await c.addInitScript(()=>localStorage.setItem('trainmap-howto-seen','1'));
 try{await p.goto('http://127.0.0.1:5208/?g=all&t=09:41&lang=zh-TW');await p.waitForFunction(()=>state.ready);const r=await p.evaluate(()=>{
  state.playing=false;const st=state.schedStations.find(s=>s.name==='新竹'&&s.sys==='tra_sched');openBoard(st);const b=document.getElementById('board'),slot=b.querySelector('[data-bus-transfer-slot]');slot.scrollIntoView({block:'start'});const before=b.scrollTop;renderBoard();const after=b.scrollTop;return {before,after,delta:after-before,slot:!!slot};
 });const pass=r.slot&&r.before>0&&Math.abs(r.delta)<1;checks++;if(!pass)failed++;console.log({name,pass,...r});}finally{await b.close();}
}console.log(`${checks-failed}/${checks}`);if(failed)process.exitCode=1;
