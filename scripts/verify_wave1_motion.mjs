import {chromium,webkit} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const out='output/garage-wave1-motion';mkdirSync(out,{recursive:true});const results=[];
for(const [engine,type]of Object.entries({chromium,webkit})){
 const b=await type.launch();try{for(const kind of ['duoliang','crossing']){
 const p=await b.newPage({viewport:{width:1280,height:920},reducedMotion:'reduce'}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(`http://127.0.0.1:5291/prototypes/garage-${kind}/`);await p.waitForFunction(()=>window.newScenePreview?.state.ready);await p.evaluate(()=>{newScenePreview.setTime(30/2.6);newScenePreview.setView('world');newScenePreview.setPeriod('day');newScenePreview.render();});
 const a=await p.evaluate(()=>newScenePreview.state);await p.click('#play');await p.waitForFunction(t=>newScenePreview.state.time>t+1.5,a.time,{timeout:15000});await p.click('#play');const c=await p.evaluate(()=>newScenePreview.state);await p.waitForTimeout(400);const d=await p.evaluate(()=>newScenePreview.state);
 const pass=c.poses[1].position[0]>a.poses[1].position[0]&&c.time===d.time&&(!a.opposing||c.opposing.poses[1].position[0]<a.opposing.poses[1].position[0])&&!errors.length;
 const row={engine,kind,pass,frames:c.draws-a.draws,elapsed:c.time-a.time,errors};results.push(row);console.log(pass?'PASS':'FAIL',JSON.stringify(row));
 await p.screenshot({path:`${out}/${engine}-${kind}-day.png`});for(let i=0;i<12;i++)await p.locator('#scene').press('ArrowRight');await p.evaluate(()=>newScenePreview.render());await p.screenshot({path:`${out}/${engine}-${kind}-back.png`});await p.click('#reset');await p.click('[data-period="night"]');await p.click('[data-view="train"]');await p.screenshot({path:`${out}/${engine}-${kind}-night.png`});await p.close();
 }}finally{await b.close();}
}
writeFileSync(`${out}/verification.json`,JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;
